/**
 * Together AI provider — OpenAI-compatible API with DeepSeek R1 support.
 *
 * OpenAI-compatible at https://api.together.xyz/v1
 * API key: TOGETHER_API_KEY
 *
 * Supports DeepSeek R1 and other reasoning models.
 * For DeepSeek R1: set { thinking: { type: 'enabled' } } in request body.
 * Standard SSE streaming with delta.content and reasoning_content fields.
 */

import { OpenAICompatibleProvider } from './openai-compatible';
import type { LlmCallOptions, LlmStream } from './types';

export class TogetherProvider extends OpenAICompatibleProvider {
  readonly id = 'together';
  readonly label = 'Together AI';
  readonly supportsReasoning = true;
  readonly docsUrl = 'https://docs.together.ai/docs';
  readonly apiStyle = 'OpenAI-compatible (endpoint hardcoded in adapter)';
  readonly defaultBaseUrl = 'https://api.together.xyz/v1';

  stream(opts: LlmCallOptions): LlmStream {
    return this._togetherStream(opts);
  }

  private async *_togetherStream(opts: LlmCallOptions): LlmStream {
    // Together AI uses a fixed base URL; ignore config.baseUrl to avoid misconfiguration
    const baseUrl = 'https://api.together.xyz/v1';
    const url = `${baseUrl}/chat/completions`;

    const { config, messages, reasoning, signal } = opts;
    const { apiKey, model } = config;

    const reasoningParam = this._buildReasoningParam(reasoning, model);

    const body: Record<string, unknown> = {
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.3,
      ...(reasoningParam && { reasoning: reasoningParam }),
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`${this.id} API error ${response.status}: ${errText || response.statusText}`);
    }

    const { parseSSEStream, textChunk, reasoningChunk, usageChunk } = await import('./transform/shared');

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

      // Reasoning content via reasoning_content field (DeepSeek R1)
      if (delta && 'reasoning_content' in delta && delta.reasoning_content) {
        const rc = String(delta.reasoning_content);
        reasoningBuffer += rc;
        yield reasoningChunk(rc);
      }

      // Text content
      if (delta?.content) {
        if (reasoningBuffer) {
          reasoningBuffer = '';
        }
        yield textChunk(String(delta.content));
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
   * Together AI reasoning param builder.
   * - DeepSeek R1 models: { thinking: { type: 'enabled' } }
   * - o1/o3 (server-side reasoning): null
   * - All others: null
   */
  protected override _buildReasoningParam(
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
