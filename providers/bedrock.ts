/**
 * AWS Bedrock provider for ZhangJing.
 *
 * Supports:
 *  - Anthropic Claude models on Bedrock (claude-sonnet-4, claude-opus-4, etc.)
 *  - Amazon Nova models on Bedrock
 *  - Any model family with a compatible chat format
 *
 * Authentication:
 *  - For browser use: uses `config.apiKey` as a Bearer token (common when Bedrock
 *    is fronted by an API Gateway that accepts Bearer tokens).
 *  - Real AWS SigV4 signing (access key + secret key + session token) requires
 *    a server-side proxy and is not implemented here. Document this limitation.
 *
 * Request format:
 *  - Claude on Bedrock: uses `anthropic_version: "bedrock-2023-05-31"` with
 *    standard Claude message format. Supports `thinking: { type: "enabled", budget_tokens: N }`.
 *  - Amazon Nova: uses `{"messages": [...], "inferenceConfig": {...}}` format.
 *  - Default: generic OpenAI-like format.
 *
 * Streaming:
 *  - Server-Side Events (SSE) with `data: {"chunk": {"bytes": "base64-encoded-json"}}`.
 *  - The inner JSON is decoded and yields normalized text/reasoning chunks.
 *
 * Error format:
 *  - `{ message, code, "__type": "ValidationException" }`
 */

import type { LlmProvider, LlmCallOptions, LlmStreamChunk, LlmStream, ProviderConfig } from './types';
import {
  parseSSEStream,
  textChunk,
  reasoningChunk,
  usageChunk,
  collectStream,
  normalizeBaseUrl,
} from './transform/shared';

/** Detect model family from model ID string */
type ModelFamily = 'anthropic' | 'nova' | 'generic';

function detectModelFamily(model: string): ModelFamily {
  const m = model.toLowerCase();
  if (m.startsWith('anthropic.')) return 'anthropic';
  if (m.includes('amazon.nova') || m.includes('nova')) return 'nova';
  return 'generic';
}

/** Build the request body for Anthropic Claude on Bedrock */
function buildAnthropicBody(opts: {
  messages: LlmCallOptions['messages'];
  reasoning: LlmCallOptions['reasoning'];
  maxTokens: number;
}): Record<string, unknown> {
  const { messages, reasoning, maxTokens } = opts;

  const body: Record<string, unknown> = {
    messages: messages.map(m => ({
      role: m.role === 'system' ? 'user' : m.role, // Bedrock Claude doesn't accept system role directly in messages
      content: m.content,
    })),
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
  };

  // Add thinking block if reasoning is enabled
  if (reasoning && reasoning.mode !== 'off') {
    const budgetTokens = reasoning.budgetTokens ?? 1024;
    body.thinking = {
      type: 'enabled',
      budget_tokens: budgetTokens,
    };
  }

  return body;
}

/** Build the request body for Amazon Nova on Bedrock */
function buildNovaBody(opts: {
  messages: LlmCallOptions['messages'];
  inferenceConfig: Record<string, unknown>;
}): Record<string, unknown> {
  const { messages, inferenceConfig } = opts;

  return {
    messages: messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
    inferenceConfig,
  };
}

/** Build the default/generic request body */
function buildGenericBody(opts: {
  messages: LlmCallOptions['messages'];
  maxTokens: number;
}): Record<string, unknown> {
  const { messages, maxTokens } = opts;

  return {
    messages: messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
    max_tokens: maxTokens,
  };
}

export class BedrockProvider implements LlmProvider {
  readonly id = 'bedrock';
  readonly label = 'AWS Bedrock';
  readonly supportsReasoning = true; // Claude models on Bedrock support thinking
  readonly docsUrl = 'https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html';
  readonly apiStyle = 'AWS Bedrock invoke (needs gateway; SigV4 not implemented in-browser)';
  readonly defaultBaseUrl = '';

  stream({ config, messages, reasoning, signal, timeout }: LlmCallOptions): LlmStream {
    return this._stream({ config, messages, reasoning, signal, timeout });
  }

  private async *_stream(opts: LlmCallOptions): LlmStream {
    const { config, messages, reasoning, signal, timeout } = opts;
    const { apiKey, model } = config;

    // Bedrock requires a region. We support:
    // 1. config.baseUrl containing the full region URL (recommended for browser/API Gateway use)
    // 2. config.region passed as a provider-specific field (for typed configs)
    // Cast to allow provider-specific fields not in the base ProviderConfig interface.
    const cfg = config as ProviderConfig & { region?: string; temperature?: number };
    const resolvedRegion = cfg.region || 'us-east-1';
    const baseUrl = normalizeBaseUrl(config.baseUrl || `https://bedrock-runtime.${resolvedRegion}.amazonaws.com`);

    // Determine model family and build appropriate URL and body
    const family = detectModelFamily(model);

    // Build URL — model ID is appended directly for invoke
    const url = `${baseUrl}/${model}/invoke`;

    // Determine max tokens from reasoning budget or use default
    const maxTokens = reasoning?.budgetTokens ? reasoning.budgetTokens * 2 : 8192;

    let body: Record<string, unknown>;

    if (family === 'anthropic') {
      body = buildAnthropicBody({ messages, reasoning, maxTokens });
    } else if (family === 'nova') {
      body = buildNovaBody({
        messages,
        inferenceConfig: {
          maxTokens,
          temperature: 0.3,
        },
      });
    } else {
      body = buildGenericBody({ messages, maxTokens });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // For browser use: Bearer token auth via API Gateway in front of Bedrock.
      // Real AWS SigV4 signing (access key + secret key + session token) requires
      // server-side code and is NOT implemented here.
      Authorization: `Bearer ${apiKey}`,
    };

    const fetchOpts: RequestInit = {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    };

    const response = await fetch(url, fetchOpts);

    if (!response.ok) {
      let errMessage = response.statusText;
      try {
        const errBody = await response.json();
        // Bedrock error format: { message, code, "__type": "ValidationException" }
        if (errBody.message) {
          errMessage = `${errBody.__type ?? 'AWSError'}: ${errBody.message} (code: ${errBody.code})`;
        }
      } catch {
        // ignore parse errors
      }
      throw new Error(`${this.id} API error ${response.status}: ${errMessage}`);
    }

    // SSE streaming with base64-encoded chunks:
    // data: {"chunk": {"bytes": "base64..."}}
    // The inner bytes field contains a base64-encoded JSON string.
    for await (const obj of parseSSEStream(response)) {
      const event = obj as Record<string, unknown>;

      // Handle error events
      if (event.error) {
        const err = event.error as Record<string, unknown>;
        throw new Error(`${this.id} stream error: ${err.message ?? JSON.stringify(err)}`);
      }

      const chunk = event.chunk as Record<string, unknown> | undefined;
      if (!chunk) continue;

      const bytesStr = chunk.bytes as string | undefined;
      if (!bytesStr) continue;

      // Decode base64 to get inner JSON
      let innerObj: Record<string, unknown>;
      try {
        const decoded = atob(bytesStr);
        innerObj = JSON.parse(decoded) as Record<string, unknown>;
      } catch {
        // Skip malformed chunks
        continue;
      }

      // ── Anthropic streaming format ───────────────────────────────────────────
      if (family === 'anthropic') {
        // Inner format: { type: "content_block_delta", index, delta: { type: "text_delta", text } }
        // or { type: "content_block_delta", index, delta: { type: "thinking_delta", thinking } }
        // or { type: "message_delta", usage: { ... } }

        const delta = innerObj.delta as Record<string, unknown> | undefined;
        const innerType = innerObj.type as string | undefined;

        if (innerType === 'content_block_delta' && delta) {
          const deltaType = delta.type as string | undefined;

          if (deltaType === 'thinking_delta') {
            yield reasoningChunk(String(delta.thinking ?? ''));
          } else if (deltaType === 'text_delta') {
            yield textChunk(String(delta.text ?? ''));
          }
        }

        if (innerType === 'message_delta') {
          const usage = innerObj.usage as Record<string, unknown> | undefined;
          if (usage) {
            yield usageChunk({
              inputTokens: (usage.input_tokens as number) || 0,
              outputTokens: (usage.output_tokens as number) || 0,
              reasoningTokens: (usage.thinking_tokens as number) || 0,
            });
          }
        }
        continue;
      }

      // ── Nova streaming format ─────────────────────────────────────────────────
      if (family === 'nova') {
        // Nova format: { token: { text, type }, usage: { inputTokens, outputTokens } }
        const token = innerObj.token as Record<string, unknown> | undefined;
        if (token?.text) {
          yield textChunk(String(token.text));
        }

        const usage = innerObj.usage as Record<string, unknown> | undefined;
        if (usage) {
          yield usageChunk({
            inputTokens: (usage.inputTokens as number) || 0,
            outputTokens: (usage.outputTokens as number) || 0,
          });
        }
        continue;
      }

      // ── Generic / fallback format ─────────────────────────────────────────────
      // Assume OpenAI-like delta format: { choices: [{ delta: { content } }] }
      const choices = innerObj.choices as Array<Record<string, unknown>> | undefined;
      if (choices?.length) {
        const delta = choices[0].delta as Record<string, unknown> | undefined;
        if (delta?.content) {
          yield textChunk(String(delta.content));
        }
      }
    }
  }

  async complete(opts: LlmCallOptions): Promise<import('./types').LlmResponse> {
    const { config, messages, reasoning, signal, timeout } = opts;

    const { content, reasoning: rawReasoning } = await collectStream(
      this.stream({ config, messages, reasoning, signal, timeout })
    );

    return {
      content,
      reasoning: rawReasoning || null,
      provider: this.id,
    };
  }
}
