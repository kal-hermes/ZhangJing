/**
 * DeepSeek provider.
 *
 * Supports:
 *   - DeepSeek Chat (standard)
 *   - DeepSeek R1 / deepseek-reasoner (reasoning mode)
 *
 * Reasoning mode: set `thinking: { type: "enabled" }` in the request body.
 * The reasoning trace comes through `delta.reasoning_content` in streaming.
 *
 * Docs: https://api-docs.deepseek.com/guides/thinking_mode
 */

import type { LlmProvider, LlmCallOptions, LlmStreamChunk, LlmStream, LlmResponse } from './types';
import { parseSSEStream, textChunk, reasoningChunk, usageChunk, normalizeBaseUrl } from './transform/shared';

export class DeepSeekProvider implements LlmProvider {
  readonly id = 'deepseek';
  readonly label = 'DeepSeek';
  readonly supportsReasoning = true;
  readonly docsUrl = 'https://api-docs.deepseek.com/api-reference/chat';

  async *stream({ config, messages, reasoning, signal }: LlmCallOptions): LlmStream {
    const { baseUrl, apiKey, model } = config;
    const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;

    const isReasoner = /deepseek[_-]?(reasoner|r1)/i.test(model);

    // Determine if we should enable thinking
    const enableThinking = isReasoner || reasoning?.mode === 'force';

    const body: Record<string, unknown> = {
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.3,
    };

    if (enableThinking) {
      (body as Record<string, unknown>).thinking = { type: 'enabled' };
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

      if (chunk.error) {
        throw new Error(`${this.id} error: ${(chunk.error as Record<string, unknown>).message ?? JSON.stringify(chunk.error)}`);
      }

      const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
      if (!choices?.length) continue;

      const delta = choices[0].delta as Record<string, unknown> | undefined;

      // ── Reasoning content (DeepSeek R1) ──────────────────────────────────
      if (delta && 'reasoning_content' in delta && delta.reasoning_content) {
        yield reasoningChunk(String(delta.reasoning_content));
      }

      // ── Text content ────────────────────────────────────────────────────
      if (delta?.content) {
        yield textChunk(String(delta.content));
      }

      // ── Usage ──────────────────────────────────────────────────────────
      if (!usageEmitted && chunk.usage) {
        usageEmitted = true;
        const u = chunk.usage as Record<string, unknown>;
        yield usageChunk({
          inputTokens: (u.prompt_tokens as number) || 0,
          outputTokens: (u.completion_tokens as number) || 0,
          cacheReadTokens: (u.prompt_tokens_details as Record<string, unknown>)?.cached_tokens as number || 0,
          cacheWriteTokens: (u.prompt_tokens_details as Record<string, unknown>)?.cache_write_tokens as number || 0,
        });
      }
    }
  }

  async complete({ config, messages, reasoning, signal }: LlmCallOptions): Promise<LlmResponse> {
    const { baseUrl, apiKey, model } = config;
    const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;

    const isReasoner = /deepseek[_-]?(reasoner|r1)/i.test(model);
    const enableThinking = isReasoner || reasoning?.mode === 'force';

    const body: Record<string, unknown> = {
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: false,
      temperature: 0.3,
    };

    if (enableThinking) {
      (body as Record<string, unknown>).thinking = { type: 'enabled' };
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
    const message = (data.choices as Array<Record<string, unknown>>)?.[0]?.message as Record<string, unknown> | undefined;

    return {
      content: String(message?.content || ''),
      reasoning: (message?.reasoning_content as string) || null,
      provider: this.id,
    };
  }
}
