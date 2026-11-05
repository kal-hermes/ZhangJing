/**
 * Ollama provider for ZhangJing.
 *
 * Uses the Ollama browser SDK via CDN with non-standard streaming format.
 * Each streaming chunk provides:
 *   - chunk.message.content  — text content
 *   - chunk.eval_count        — output token count
 *   - chunk.prompt_eval_count — input token count
 *
 * Note: Ollama does not support reasoning/thinking natively.
 */

import type { LlmProvider, LlmCallOptions, LlmStream, LlmStreamChunk } from './types';
import { textChunk, usageChunk } from './transform/shared';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_NUM_CTX = 32768;
const SDK_CDN = 'https://cdn.jsdelivr.net/npm/ollama@0.5.8/+esm';

export class OllamaProvider implements LlmProvider {
  readonly id = 'ollama';
  readonly label = 'Ollama (local)';
  readonly supportsReasoning = false;
  readonly docsUrl = 'https://github.com/ollama/ollama';
  readonly apiStyle = 'Ollama native (SDK)';
  readonly defaultBaseUrl = 'http://localhost:11434';

  stream({ config, messages, signal, timeout }: LlmCallOptions): LlmStream {
    return this._stream({ config, messages, signal, timeout });
  }

  private async *_stream(opts: LlmCallOptions): LlmStream {
    const { config, messages, signal, timeout = DEFAULT_TIMEOUT_MS } = opts;
    const { baseUrl = 'http://localhost:11434', apiKey, model } = config;

    // Build host URL — append auth query param if apiKey is present
    let host = baseUrl.trim().replace(/\/$/, '');
    if (apiKey) {
      host += `?auth=${encodeURIComponent(apiKey)}`;
    }

    // Lazy-load the Ollama SDK
    const { Ollama } = await import(/* @vite-ignore */ SDK_CDN);

    const client = new Ollama({ host, fetch: window.fetch.bind(window) });

    const numCtx = (config as { numCtx?: number }).numCtx ?? DEFAULT_NUM_CTX;

    const chatPromise = client.chat({
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: true,
      options: { num_ctx: numCtx },
    });

    // Timeout wrapper
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Ollama request timed out after ${timeout}ms`)), timeout);
    });

    try {
      // Race between the stream and the timeout
      const stream = await Promise.race([chatPromise, timeoutPromise]);

      let pendingText = '';
      let usageEmitted = false;

      for await (const chunk of stream as AsyncIterable<Record<string, unknown>>) {
        // Abort if signal was cancelled
        if (signal?.aborted) break;

        const message = chunk.message as Record<string, unknown> | undefined;
        const content = message?.content as string | undefined;

        if (content) {
          pendingText += content;
          yield textChunk(content);
        }

        // Emit usage once at the end of the stream
        if (!usageEmitted) {
          const evalCount = chunk.eval_count as number | undefined;
          const promptEvalCount = chunk.prompt_eval_count as number | undefined;
          if (evalCount !== undefined || promptEvalCount !== undefined) {
            usageEmitted = true;
            yield usageChunk({
              inputTokens: promptEvalCount ?? 0,
              outputTokens: evalCount ?? 0,
            });
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('timed out')) {
        throw err;
      }
      // Re-throw original error
      throw err;
    }
  }
}
