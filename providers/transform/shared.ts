/**
 * Shared streaming utilities for LLM providers.
 * Handles SSE/NDJSON parsing and chunk normalization.
 */

import type { LlmStreamChunk } from '../types';

/* ========== SSE/NDJSON parsing ========== */

/**
 * Parse a single line from an SSE stream.
 * Returns null for non-data lines, null for [DONE], and the parsed JSON otherwise.
 */
export function parseSSEDataLine(line: string): object | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return null;
  const jsonStr = trimmed.slice(5).trim();
  if (jsonStr === '[DONE]' || jsonStr === 'done') return null;
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * Read an SSE/NDJSON stream from a fetch Response and yield parsed JSON objects.
 */
export async function* parseSSEStream(
  response: Response
): AsyncGenerator<object, void, unknown> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // keep incomplete line in buffer

      for (const line of lines) {
        const obj = parseSSEDataLine(line);
        if (obj) yield obj;
      }
    }
    // Process any remaining buffer
    const remaining = buffer.trim();
    if (remaining) {
      const obj = parseSSEDataLine(remaining);
      if (obj) yield obj;
    }
  } finally {
    reader.releaseLock();
  }
}

/* ========== Shared streaming chunk builders ========== */

export function textChunk(text: string): LlmStreamChunk {
  return { type: 'text', text };
}

export function reasoningChunk(reasoning: string): LlmStreamChunk {
  return { type: 'reasoning', reasoning };
}

export function usageChunk(opts: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}): LlmStreamChunk {
  return { type: 'usage', ...opts };
}

/* ========== Shared helpers ========== */

/**
 * Build a raw OpenAI-compatible fetch request.
 */
export async function buildOpenAIRequest(opts: {
  url: string;
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  reasoning?: object | null;
  stream?: boolean;
  signal?: AbortSignal;
}): Promise<{ url: string; init: RequestInit }> {
  const {
    url,
    apiKey,
    model,
    messages,
    temperature = 0.3,
    maxTokens,
    reasoning = null,
    stream = true,
    signal,
  } = opts;

  const body: Record<string, unknown> = {
    model,
    messages,
    stream,
    ...(temperature !== undefined && { temperature }),
    ...(maxTokens && { max_tokens: maxTokens }),
    ...(reasoning && { reasoning }),
    ...(stream && { stream_options: { include_usage: true } }),
  };

  return {
    url,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    },
  };
}

/**
 * Collect a stream into { content, reasoning }.
 */
export async function collectStream(
  stream: AsyncGenerator<LlmStreamChunk, void, unknown>
): Promise<{ content: string; reasoning: string }> {
  const contentParts: string[] = [];
  const reasoningParts: string[] = [];

  for await (const chunk of stream) {
    if (chunk.type === 'text' && chunk.text) contentParts.push(chunk.text);
    else if (chunk.type === 'reasoning' && chunk.reasoning) reasoningParts.push(chunk.reasoning);
  }

  return { content: contentParts.join(''), reasoning: reasoningParts.join('') };
}

/**
 * Strip common thinking/reasoning wrapper tags from content.
 * Used as fallback for providers that embed thinking in the content String.
 */
export function stripThinkingTags(content: string): string {
  return content
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
}

/**
 * Normalize a user-entered base URL — trim whitespace and trailing slashes only.
 */
export function normalizeBaseUrl(url: string): string {
  // Trim whitespace and trailing slashes ONLY. Deliberately does NOT strip
  // version segments like /v1: OpenAI, OpenRouter and Groq require them in
  // the final path, and appending /chat/completions to the base as entered
  // keeps every OpenAI-style family correct. Base URLs without a version
  // segment (e.g. https://api.deepseek.com) keep working unchanged.
  return url.trim().replace(/\/+$/, '');
}
