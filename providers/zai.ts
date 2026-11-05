/**
 * Z.ai / BigModel (Zhipu GLM) provider.
 *
 * API (OpenAI-compatible, both endpoints use /api/paas/v4):
 *   - International: https://api.z.ai/api/paas/v4
 *   - China (BigModel): https://open.bigmodel.cn/api/paas/v4
 * Reasoning-capable models (GLM-4.5 and newer, including GLM-5.x) accept
 * `thinking: { type: "enabled" | "disabled" }` and stream the trace back
 * via `delta.reasoning_content`.
 *
 * Note: Z.ai ALSO exposes an Anthropic-compatible endpoint
 * (https://api.z.ai/api/anthropic) for Claude Code — that style is NOT
 * implemented here; this adapter is OpenAI-style only.
 *
 * Docs: https://docs.z.ai/api-reference/introduction
 */

import type { LlmProvider, LlmCallOptions, LlmStream, LlmResponse } from './types';
import { parseSSEStream, textChunk, reasoningChunk, usageChunk, normalizeBaseUrl } from './transform/shared';

/** Base URL used when the user leaves it empty. */
const DEFAULT_BASE_URL = 'https://api.z.ai/api/paas/v4';

/** GLM-4.5 and newer are hybrid thinking models (glm-4.5, glm-4.6, glm-5, ...). */
const THINKING_MODEL_RE = /^glm-(4\.[5-9]|[5-9])/i;

export class ZaiProvider implements LlmProvider {
  readonly id = 'zai';
  readonly label = 'Z.ai (GLM)';
  readonly supportsReasoning = true;
  readonly docsUrl = 'https://docs.z.ai/api-reference/introduction';
  readonly apiStyle = 'OpenAI-compatible (thinking param)';
  readonly defaultBaseUrl = 'https://api.z.ai/api/paas/v4';

  /**
   * Hybrid GLM models default thinking ON server-side; make every app
   * reasoning mode explicit so translations are deterministic.
   * Non-hybrid models (glm-4.x, non-GLM names): no thinking param,
   * except an explicit force.
   */
  private thinkingParam(model: string, reasoning: LlmCallOptions['reasoning']): { thinking: { type: 'enabled' | 'disabled' } } | Record<string, never> {
    if (!THINKING_MODEL_RE.test(model)) {
      return reasoning?.mode === 'force' ? { thinking: { type: 'enabled' } } : {};
    }
    if (reasoning?.mode === 'off') {
      return { thinking: { type: 'disabled' } };
    }
    return { thinking: { type: 'enabled' } };
  }

  async *stream({ config, messages, reasoning, signal }: LlmCallOptions): LlmStream {
    const { apiKey, model } = config;
    const baseUrl = config.baseUrl?.trim() || DEFAULT_BASE_URL;
    const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;

    const body: Record<string, unknown> = {
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.3,
      ...this.thinkingParam(model, reasoning),
    };

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

      // ── Reasoning content (GLM hybrid thinking) ─────────────────────────
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
        });
      }
    }
  }

  async complete({ config, messages, reasoning, signal }: LlmCallOptions): Promise<LlmResponse> {
    const { apiKey, model } = config;
    const baseUrl = config.baseUrl?.trim() || DEFAULT_BASE_URL;
    const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;

    const body: Record<string, unknown> = {
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: false,
      temperature: 0.3,
      ...this.thinkingParam(model, reasoning),
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

    const data = await response.json() as Record<string, unknown>;
    const message = (data.choices as Array<Record<string, unknown>>)?.[0]?.message as Record<string, unknown> | undefined;

    return {
      content: String(message?.content || ''),
      reasoning: (message?.reasoning_content as string) || null,
      provider: this.id,
    };
  }
}
