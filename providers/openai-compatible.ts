/**
 * OpenAI-compatible provider — generic handler for all OpenAI-compatible APIs.
 *
 * Covers: OpenAI (direct), Groq, Fireworks, Mistral, Moonshot, SambaNova,
 * Together AI, Hyperbolic, and any custom OpenAI-compatible endpoint.
 *
 * Reasoning: checks model name for DeepSeek-R1 / o1/o3 patterns and injects
 * the correct `thinking` / `reasoning_content` param. Falls back to stripping
 * <thinking> tags from content for providers that embed thinking in the text.
 */

import type { LlmProvider, LlmCallOptions, LlmStreamChunk, LlmStream } from './types';
import { buildOpenAIRequest, parseSSEStream, textChunk, reasoningChunk, usageChunk } from './transform/shared';
import { normalizeBaseUrl } from './transform/shared';

export class OpenAICompatibleProvider implements LlmProvider {
  readonly id: string = 'openai-compatible';
  readonly label: string = 'OpenAI-Compatible';
  readonly supportsReasoning: boolean = true;
  readonly docsUrl: string = 'https://platform.openai.com/docs/api-reference/chat';
  readonly apiStyle: string = 'OpenAI chat completions';
  readonly defaultBaseUrl: string = '';

  stream({ config, messages, reasoning, signal }: LlmCallOptions): LlmStream {
    return this._stream({ config, messages, reasoning, signal });
  }

  protected async *_stream(opts: LlmCallOptions): LlmStream {
    const { config, messages, reasoning, signal } = opts;
    const { baseUrl, apiKey, model } = config;

    const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;

    // Build reasoning param based on model family
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

      // Top-level error object
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

      // ── Reasoning content (DeepSeek R1, some o1/o3 via reasoning_content) ──
      if (delta && 'reasoning_content' in delta && delta.reasoning_content) {
        const rc = String(delta.reasoning_content);
        reasoningBuffer += rc;
        yield reasoningChunk(rc);
      }

      // ── Text content ──────────────────────────────────────────────────────
      if (delta?.content) {
        // If we were buffering reasoning and now get plain content,
        // the thinking section is done
        if (reasoningBuffer) {
          reasoningBuffer = '';
        }
        yield textChunk(String(delta.content));
      }

      // ── Usage (usually on the final chunk) ─────────────────────────────────
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

  /** Determine the reasoning param based on model name */
  protected _buildReasoningParam(reasoning: LlmCallOptions['reasoning'], model: string): object | null {
    if (!reasoning || reasoning.mode === 'off') return null;

    const isOSeries = /^o[1-9]/i.test(model);
    const isDeepSeekReasoner = /deepseek[_-]?r1/i.test(model) || /deepseek[_-]?reasoner/i.test(model);

    if (isOSeries) {
      // o1/o3: reasoning is server-side only, no client param
      return null;
    }

    if (isDeepSeekReasoner || reasoning.mode === 'force') {
      return { thinking: { type: 'enabled' } };
    }

    return null;
  }
}
