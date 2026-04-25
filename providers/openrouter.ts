/**
 * OpenRouter provider — OpenAI-compatible gateway with ranking headers
 * and OpenRouter-specific error format.
 *
 * Extends OpenAICompatibleProvider to:
 * - Add HTTP-Referer and X-Title headers for OpenRouter ranking
 * - Handle OpenRouter's { error: { message, code, metadata: { raw } } } format
 * - Pass through reasoning_content from upstream providers (DeepSeek R1, o1, etc.)
 */

import type { LlmProvider, LlmCallOptions, LlmStreamChunk, LlmStream } from './types';
import { buildOpenAIRequest, parseSSEStream, textChunk, reasoningChunk, usageChunk } from './transform/shared';
import { normalizeBaseUrl } from './transform/shared';
import { OpenAICompatibleProvider } from './openai-compatible';

export class OpenRouterProvider extends OpenAICompatibleProvider {
  readonly id = 'openrouter';
  readonly label = 'OpenRouter';
  /** OpenRouter supports reasoning when the underlying model does (DeepSeek R1, o1, etc.) */
  readonly supportsReasoning = true;
  readonly docsUrl = 'https://openrouter.ai/docs/api-reference/chat';

  stream({ config, messages, reasoning, signal }: LlmCallOptions): LlmStream {
    return this._stream({ config, messages, reasoning, signal });
  }

  private async *_stream(opts: LlmCallOptions): LlmStream {
    const { config, messages, reasoning, signal } = opts;
    const { baseUrl, apiKey, model } = config;

    const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;

    // Build reasoning param — reused from parent; handles deepseek-reasoner, o1/o3
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

    // Merge OpenRouter-specific headers for ranking
    const mergedInit: RequestInit = {
      ...init,
      headers: {
        ...init.headers,
        'HTTP-Referer': 'https://github.com/ZhangJing',
        'X-Title': 'ZhangJing Translator',
      },
    };

    const response = await fetch(url, { ...mergedInit, signal });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      // OpenRouter error format: { error: { message, code, metadata: { raw } } }
      try {
        const errJson = JSON.parse(errText);
        if (errJson?.error) {
          const e = errJson.error as Record<string, unknown>;
          const msg = e.message ?? JSON.stringify(e);
          const code = e.code ?? '';
          const raw = (e.metadata as Record<string, unknown>)?.raw ?? '';
          throw new Error(
            `${this.id} error${code ? ` [${code}]` : ''}: ${msg}${raw ? ` — ${raw}` : ''}`
          );
        }
      } catch (e2) {
        if (e2 instanceof Error) throw e2;
      }
      throw new Error(`${this.id} API error ${response.status}: ${errText || response.statusText}`);
    }

    let reasoningBuffer = '';
    let usageEmitted = false;

    for await (const obj of parseSSEStream(response)) {
      const chunk = obj as Record<string, unknown>;

      // OpenRouter error format in stream
      if (chunk.error) {
        const err = chunk.error as Record<string, unknown>;
        const msg = err.message ?? JSON.stringify(err);
        const code = err.code ?? '';
        const raw = (err.metadata as Record<string, unknown>)?.raw ?? '';
        throw new Error(
          `${this.id} error${code ? ` [${code}]` : ''}: ${msg}${raw ? ` — ${raw}` : ''}`
        );
      }

      const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
      if (!choices?.length) continue;

      const delta = choices[0].delta as Record<string, unknown> | undefined;
      const finishReason = choices[0].finish_reason as string | undefined;

      if (finishReason === 'error') {
        throw new Error(`${this.id} stream error: ${JSON.stringify(chunk)}`);
      }

      // OpenRouter can inject reasoning_content from upstream providers (DeepSeek R1, o1, etc.)
      if (delta && 'reasoning_content' in delta && delta.reasoning_content) {
        const rc = String(delta.reasoning_content);
        reasoningBuffer += rc;
        yield reasoningChunk(rc);
      }

      // Text content
      if (delta?.content) {
        // If we were buffering reasoning and now get plain content, thinking is done
        if (reasoningBuffer) {
          reasoningBuffer = '';
        }
        yield textChunk(String(delta.content));
      }

      // Usage (usually on the final chunk)
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
}
