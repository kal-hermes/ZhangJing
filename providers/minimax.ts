/**
 * MiniMax provider.
 *
 * MiniMax supports two API modes:
 *   1. Anthropic SDK → https://api.minimax.io/anthropic  (MiniMax-recommended)
 *   2. OpenAI-compatible → https://api.minimax.io/v1     (simpler, supports reasoning_split)
 *
 * This implementation uses the OpenAI-compatible endpoint with `reasoning_split: true`
 * in extra_body, which separates the reasoning trace into `message.reasoning_details`
 * and the content into `message.content`.
 *
 * Streaming: each reasoning_detail delta is yielded as a 'reasoning' chunk.
 * Non-streaming: `message.reasoning_details` is collected into the reasoning string.
 *
 * Docs: https://platform.minimax.io/docs/api-reference/text-openai-api
 */

import type { LlmProvider, LlmCallOptions, LlmStreamChunk, LlmStream, LlmResponse } from './types';
import { parseSSEStream, textChunk, reasoningChunk, usageChunk, normalizeBaseUrl } from './transform/shared';

export class MiniMaxProvider implements LlmProvider {
  readonly id = 'minimax';
  readonly label = 'MiniMax';
  readonly supportsReasoning = true;
  readonly docsUrl = 'https://platform.minimax.io/docs/api-reference/text-openai-api';
  readonly apiStyle = 'OpenAI-compatible (extra_body reasoning_split)';
  readonly defaultBaseUrl = 'https://api.minimax.io/v1';

  async *stream({ config, messages, reasoning, signal }: LlmCallOptions): LlmStream {
    const { baseUrl, apiKey, model } = config;
    const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;

    const body: Record<string, unknown> = {
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.3,
    };

    // Enable reasoning_split so MiniMax puts thinking in message.reasoning_details
    if (reasoning?.mode !== 'off') {
      (body as Record<string, unknown>).extra_body = { reasoning_split: true };
    }

    const init: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    };

    const response = await fetch(url, init);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`${this.id} API error ${response.status}: ${errText || response.statusText}`);
    }

    let usageEmitted = false;

    for await (const obj of parseSSEStream(response)) {
      const chunk = obj as Record<string, unknown>;

      // MiniMax may embed error in base_resp
      if ((chunk as Record<string, unknown>).base_resp) {
        const br = (chunk as Record<string, unknown>).base_resp as Record<string, unknown>;
        if (br.status_code && Number(br.status_code) !== 0) {
          throw new Error(`${this.id} API error ${br.status_code}: ${br.status_msg || 'unknown'}`);
        }
      }

      const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
      if (!choices?.length) continue;

      const delta = choices[0].delta as Record<string, unknown> | undefined;

      // ── MiniMax: reasoning_details field ──────────────────────────────────
      if (delta && 'reasoning_details' in delta && delta.reasoning_details) {
        const details = delta.reasoning_details;
        if (Array.isArray(details)) {
          for (const detail of details) {
            if (detail && typeof detail === 'object' && 'text' in detail) {
              yield reasoningChunk(String((detail as Record<string, unknown>).text));
            }
          }
        }
      }

      // ── Text content ────────────────────────────────────────────────────
      if (delta?.content) {
        yield textChunk(String(delta.content));
      }

      // ── Usage ───────────────────────────────────────────────────────────
      if (!usageEmitted && chunk.usage) {
        usageEmitted = true;
        const u = chunk.usage as Record<string, unknown>;
        yield usageChunk({
          inputTokens: (u.prompt_tokens as number) || 0,
          outputTokens: (u.completion_tokens as number) || 0,
          cacheReadTokens: (u.prompt_tokens_details as Record<string, unknown>)?.cached_tokens as number || 0,
        });
      }
    }
  }

  async complete({ config, messages, reasoning, signal }: LlmCallOptions): Promise<LlmResponse> {
    const { baseUrl, apiKey, model } = config;
    const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;

    const body: Record<string, unknown> = {
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: false,
      temperature: 0.3,
    };

    if (reasoning?.mode !== 'off') {
      (body as Record<string, unknown>).extra_body = { reasoning_split: true };
    }

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

    const data = await response.json() as Record<string, unknown>;
    const choice = (data.choices as Array<Record<string, unknown>>)?.[0];
    const message = choice?.message as Record<string, unknown> | undefined;

    // Collect reasoning_details
    let reasoningText = '';
    if (message?.reasoning_details) {
      const details = message.reasoning_details;
      if (Array.isArray(details)) {
        reasoningText = details
          .filter(d => d && typeof d === 'object' && 'text' in d)
          .map(d => String((d as Record<string, unknown>).text))
          .join('');
      }
    }

    return {
      content: String(message?.content || ''),
      reasoning: reasoningText || null,
      provider: this.id,
    };
  }
}
