/**
 * Google Vertex AI provider for ZhangJing.
 *
 * Auth: Bearer token from config.apiKey, or gcloud ADC fallback.
 * Base URL: https://{location}-aiplatform.googleapis.com/v1beta1
 * Model ID: full resource name projects/{project}/locations/{location}/publishers/google/models/{model}
 * Reasoning: thinkingConfig: { thinkingBudget: N }
 * Streaming: SSE with data: { candidates: [{ content: { parts: [{ text }] } }] }
 */

import type { LlmProvider, LlmCallOptions, LlmStreamChunk, LlmStream, LlmMessages } from './types';
import { parseSSEStream, textChunk, reasoningChunk, usageChunk } from './transform/shared';
import { normalizeBaseUrl } from './transform/shared';

export class VertexProvider implements LlmProvider {
  readonly id = 'vertex';
  readonly label = 'Google Vertex AI';
  readonly supportsReasoning = true;
  readonly docsUrl = 'https://cloud.google.com/vertex-ai/docs/generative-ai/model-reference';

  stream({ config, messages, reasoning, signal }: LlmCallOptions): LlmStream {
    return this._stream({ config, messages, reasoning, signal });
  }

  private async *_stream(opts: LlmCallOptions): LlmStream {
    const { config, messages, reasoning, signal } = opts;
    const { apiKey, model } = config;

    // Parse project/location from model (full resource name format)
    // e.g. projects/xxx/locations/us-central1/publishers/google/models/gemini-2.0-flash
    const resourceMatch = model.match(
      /^projects\/([^/]+)\/locations\/([^/]+)\/publishers\/google\/models\/(.+)$/
    );
    if (!resourceMatch) {
      throw new Error(
        `${this.id}: model must be the full Vertex resource name ` +
        `'projects/{project}/locations/{location}/publishers/google/models/{model}'. ` +
        `Got: '${model}'`
      );
    }
    const [, project, location, modelName] = resourceMatch;

    // Build base URL from location
    const baseUrl = `https://${location}-aiplatform.googleapis.com/v1beta1`;

    // Build request body
    const body = this._buildBody(model, messages, reasoning);

    // Build headers — try Bearer token first, then gcloud ADC
    const authHeader = await this._getAuthHeader(apiKey);

    const url = `${baseUrl}/projects/${project}/locations/${location}/publishers/google/models/${modelName}:streamGenerateContent`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      let errMessage = response.statusText;
      try {
        const errBody = await response.json();
        if (errBody?.error) {
          errMessage = `${errBody.error.status ?? response.status} ${errBody.error.message}`;
        }
      } catch {
        // ignore parse failure
      }
      throw new Error(`${this.id} API error ${response.status}: ${errMessage}`);
    }

    let reasoningBuffer = '';
    let usageEmitted = false;

    for await (const obj of parseSSEStream(response)) {
      const chunk = obj as Record<string, unknown>;

      // Top-level error object
      if (chunk.error) {
        const err = chunk.error as Record<string, unknown>;
        throw new Error(`${this.id} error: ${err.message ?? JSON.stringify(err)}`);
      }

      const candidates = chunk.candidates as Array<Record<string, unknown>> | undefined;
      if (!candidates?.length) continue;

      // Vertex streaming chunk: candidates[0].content.parts[0]
      const candidate = candidates[0];
      const content = candidate.content as Record<string, unknown> | undefined;
      if (!content) continue;

      const parts = content.parts as Array<Record<string, unknown>> | undefined;
      if (!parts?.length) continue;

      const part = parts[0];

      // Usage — typically on the final chunk
      if (!usageEmitted && chunk.usageMetadata) {
        usageEmitted = true;
        const u = chunk.usageMetadata as Record<string, unknown>;
        yield usageChunk({
          // Vertex token counts live under different field names
          inputTokens: (u.promptTokenCount as number) || 0,
          outputTokens: (u.candidatesTokenCount as number) || 0,
          cacheReadTokens: (u.promptTokensDetails as Record<string, unknown>)?.cachedPromptTokenCount as number,
          reasoningTokens: (u.thinkingMetadata as Record<string, unknown>)?.thoughtsTokenCount as number,
        });
      }

      // Reasoning/thinking text — Vertex streams this separately
      if (part.thought) {
        const thoughtText = String(part.thought ?? '');
        reasoningBuffer += thoughtText;
        yield reasoningChunk(thoughtText);
      }

      // Text content
      if (part.text) {
        // If we were buffering reasoning and now get plain text,
        // the thinking section is done
        if (reasoningBuffer) {
          reasoningBuffer = '';
        }
        yield textChunk(String(part.text));
      }
    }
  }

  /** Build the Vertex API request body */
  private _buildBody(model: string, messages: LlmMessages[], reasoning?: LlmCallOptions['reasoning']): Record<string, unknown> {
    const contents = messages.map(msg => this._toVertexContent(msg));

    const generationConfig: Record<string, unknown> = {
      temperature: 0.3,
    };

    // Enable thinking/reasoning for Gemini 2.0
    if (reasoning && reasoning.mode !== 'off') {
      generationConfig.thinkingConfig = {
        thinkingBudget: reasoning.budgetTokens ?? 4096,
      };
    }

    return {
      model, // full resource name
      contents,
      generationConfig,
      stream: true,
    };
  }

  /** Convert a ZhangJing LlmMessage to Vertex content format */
  private _toVertexContent(msg: LlmMessages): { role: string; parts: Array<{ text: string }> } {
    // Vertex uses 'user' and 'model' roles (no 'system' or 'assistant')
    let role: string;
    switch (msg.role) {
      case 'user':
        role = 'user';
        break;
      case 'assistant':
        role = 'model';
        break;
      case 'system':
        // Fold system message into the first user message as a prefix
        role = 'user';
        break;
      default:
        role = 'user';
    }

    return {
      role,
      parts: [{ text: msg.content }],
    };
  }

  /**
   * Build authorization headers.
   * Prefer Bearer token from config.apiKey.
   * If the token looks like a service account JSON or empty, fall back to gcloud ADC.
   */
  private async _getAuthHeader(apiKey: string): Promise<Record<string, string>> {
    if (apiKey && !apiKey.startsWith('{')) {
      // Plain Bearer token
      return { Authorization: `Bearer ${apiKey}` };
    }

    // Try to use gcloud ADC (Application Default Credentials)
    try {
      const { execSync } = await import('child_process');
      const token = execSync('gcloud auth print-access-token', { timeout: 10000 })
        .toString()
        .trim();
      return { Authorization: `Bearer ${token}` };
    } catch {
      // gcloud not available or not logged in
    }

    throw new Error(
      `${this.id}: no valid auth found. Set apiKey to a Bearer token, ` +
      `or ensure 'gcloud auth application-default login' has been run.`
    );
  }
}
