/**
 * Fireworks AI provider — DeepSeek R1 support and <thinking> tag stripping.
 *
 * OpenAI-compatible at https://api.fireworks.ai/inference/v1
 * API key: FIREWORKS_API_KEY
 *
 * Key differences from generic OpenAI-compatible:
 * - DeepSeek R1 requires { thinking: { type: 'enabled' } } in request body
 * - May emit <thinking>...</thinking> tags embedded IN the content string,
 *   so we strip them in stream() before yielding text chunks.
 */

import { OpenAICompatibleProvider } from './openai-compatible';
import type { LlmCallOptions, LlmStream, LlmStreamChunk } from './types';
import { buildOpenAIRequest, parseSSEStream, textChunk, reasoningChunk, usageChunk, stripThinkingTags } from './transform/shared';
import { normalizeBaseUrl } from './transform/shared';

export class FireworksProvider extends OpenAICompatibleProvider {
  readonly id = 'fireworks';
  readonly label = 'Fireworks AI';
  readonly supportsReasoning = true;
  readonly docsUrl = 'https://docs.fireworks.ai/inference';

  stream(opts: LlmCallOptions): LlmStream {
    return this._fireworksStream(opts);
  }

  private async *_fireworksStream(opts: LlmCallOptions): LlmStream {
    const { config, messages, reasoning, signal } = opts;
    const { apiKey, model } = config;

    // Fireworks uses a fixed base URL; ignore config.baseUrl to avoid misconfiguration
    const baseUrl = 'https://api.fireworks.ai/inference/v1';
    const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;

    const reasoningParam = this._buildReasoningParam(reasoning, model);

    const { init } = await buildOpenAIRequest({
      url,
      apiKey,
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: 0.3,
      reasoning: reasoningParam,
      stream: true,
      signal,
    });

    const response = await fetch(url, { ...init, signal });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`${this.id} API error ${response.status}: ${errText || response.statusText}`);
    }

    let reasoningBuffer = '';
    let usageEmitted = false;

    for await (const obj of parseSSEStream(response)) {
      const chunk = obj as Record<string, unknown>;

      if (chunk.error) {
        const err = chunk.error as Record<string, unknown>;
        throw new Error(`${this.id} error: ${err.message ?? JSON.stringify(err)}`);
      }

      const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
      if (!choices?.length) continue;

      const delta = choices[0].delta as Record<string, unknown> | undefined;
      const finishReason = choices[0].finish_reason as string | undefined;

      if (finishReason === 'error') {
        throw new Error(`${this.id} stream error: ${JSON.stringify(chunk)}`);
      }

      // Reasoning content via reasoning_content field
      if (delta && 'reasoning_content' in delta && delta.reasoning_content) {
        const rc = String(delta.reasoning_content);
        reasoningBuffer += rc;
        yield reasoningChunk(rc);
      }

      // Text content — strip <thinking> tags that Fireworks may embed inline
      if (delta?.content) {
        if (reasoningBuffer) {
          reasoningBuffer = '';
        }
        const rawText = String(delta.content);
        const cleanText = stripThinkingTags(rawText);
        if (cleanText) {
          yield textChunk(cleanText);
        }
      }

      // Usage
      if (!usageEmitted && chunk.usage) {
        usageEmitted = true;
        const u = chunk.usage as Record<string, unknown>;
        yield usageChunk({
          inputTokens: (u.prompt_tokens as number) || 0,
          outputTokens: (u.completion_tokens as number) || 0,
          cacheReadTokens: (u.prompt_tokens_details as Record<string, unknown>)?.cached_tokens as number || 0,
          reasoningTokens: (u.completion_tokens_details as Record<string, unknown>)?.reasoning_tokens as number || 0,
        });
      }
    }
  }

  /**
   * Fireworks-specific reasoning param builder.
   * - DeepSeek R1 models: { thinking: { type: 'enabled' } }
   * - o1/o3 (server-side reasoning): null
   * - All others: null
   */
  protected _buildReasoningParam(
    reasoning: LlmCallOptions['reasoning'],
    model: string,
  ): object | null {
    if (!reasoning || reasoning.mode === 'off') return null;

    const isOSeries = /^o[1-9]/i.test(model);
    if (isOSeries) return null; // o1/o3 handle reasoning server-side

    const isDeepSeekR1 = /deepseek[_-]?r1/i.test(model);
    if (isDeepSeekR1) {
      return { thinking: { type: 'enabled' } };
    }

    return null;
  }
}
