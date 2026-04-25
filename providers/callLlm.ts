/**
 * ZhangJing LLM API — single entry point for all LLM calls.
 *
 * Usage:
 *   import { callLlm } from './providers/callLlm';
 *   const result = await callLlm({
 *     config: { provider: 'minimax', model: 'MiniMax-M2.7', baseUrl: '...', apiKey: '...' },
 *     messages: [{ role: 'system', content: '...' }, { role: 'user', content: '...' }],
 *     reasoning: { mode: 'auto' },
 *   });
 *   // result.content  → translation text
 *   // result.reasoning → chain-of-thought (or null)
 *
 * Streaming:
 *   import { streamLlm } from './providers/callLlm';
 *   for await (const chunk of streamLlm({ config, messages, reasoning })) {
 *     if (chunk.type === 'text') process.stdout.write(chunk.text);
 *     if (chunk.type === 'reasoning') process.stdout.write(chunk.reasoning);
 *   }
 */

import type { LlmResponse, LlmCallOptions, LlmStreamChunk } from './types';
import { resolveProvider } from './registry';

/* ========== Non-streaming call ========== */

export interface CallLlmOptions extends LlmCallOptions {
  /** Request timeout in ms (default: 60000) */
  timeout?: number;
}

export async function callLlm(opts: CallLlmOptions): Promise<LlmResponse> {
  const { timeout = 60000, ...rest } = opts;
  const config = opts.config;
  const messages = opts.messages;
  const reasoning = opts.reasoning ?? { mode: 'auto' };
  const signal = opts.signal;

  const provider = resolveProvider(config);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const effectiveSignal = signal
    ? (() => { const s = new AbortSignal(); signal.addEventListener('abort', () => s.abort()); return s; })()
    : controller.signal;

  try {
    const stream = provider.stream({ config, messages, reasoning, signal: effectiveSignal });
    const result = await collectStream(stream);
    return {
      content: result.content,
      reasoning: result.reasoning || null,
      provider: provider.id,
    };
  } finally {
    clearTimeout(timeoutId);
    controller.abort();
  }
}

/* ========== Streaming call ========== */

export async function* streamLlm(opts: CallLlmOptions): LlmStreamChunk {
  const provider = resolveProvider(opts.config);
  yield* provider.stream(opts);
}

/* ========== Internal helpers ========== */

async function collectStream(
  stream: AsyncGenerator<LlmStreamChunk, void, unknown>
): Promise<{ content: string; reasoning: string }> {
  const contentParts: string[] = [];
  const reasoningParts: string[] = [];

  for await (const chunk of stream) {
    switch (chunk.type) {
      case 'text':
        if (chunk.text) contentParts.push(chunk.text);
        break;
      case 'reasoning':
        if (chunk.reasoning) reasoningParts.push(chunk.reasoning);
        break;
    }
  }

  return {
    content: contentParts.join(''),
    reasoning: reasoningParts.join(''),
  };
}
