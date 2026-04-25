/**
 * Shared streaming chunk types used across all providers.
 * Adapted from Cline/RooCode's ApiStream model.
 */

/* ========== Chunk type constants ========== */

export const CHUNK_TYPES = {
  TEXT: 'text',
  REASONING: 'reasoning',
  USAGE: 'usage',
  TOOL_CALL_PARTIAL: 'tool_call_partial',
  TOOL_CALL_END: 'tool_call_end',
} as const;

/* ========== Chunk interfaces ========== */

export interface ApiStreamTextChunk {
  type: 'text';
  text: string;
}

export interface ApiStreamThinkingChunk {
  type: 'reasoning';
  reasoning: string;
  details?: unknown;
  signature?: string;
  redacted_data?: string;
}

export interface ApiStreamUsageChunk {
  type: 'usage';
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  reasoningTokens?: number;
  totalCost?: number;
}

export interface ApiStreamToolCallsChunk {
  type: 'tool_call_partial' | 'tool_call_end';
  index?: number;
  id?: string;
  name?: string;
  arguments?: string;
}

export type ApiStreamChunk =
  | ApiStreamTextChunk
  | ApiStreamThinkingChunk
  | ApiStreamUsageChunk
  | ApiStreamToolCallsChunk;

/* ========== Helpers ========== */

/**
 * Collect a streaming async generator into a { content, reasoning } object.
 */
export async function collectStream(
  stream: AsyncGenerator<ApiStreamChunk, void, unknown>,
  signal?: AbortSignal
): Promise<{ content: string; reasoning: string }> {
  const parts: string[] = [];
  const reasoningParts: string[] = [];
  const errors: string[] = [];

  try {
    for await (const chunk of stream) {
      if (signal?.aborted) break;
      switch (chunk.type) {
        case 'text':
          if (chunk.text) parts.push(chunk.text);
          break;
        case 'reasoning':
          if (chunk.reasoning) reasoningParts.push(chunk.reasoning);
          break;
        // tool_call_partial / tool_call_end — not relevant for ZhangJing translation
      }
    }
  } catch (e) {
    errors.push(String(e));
  }

  return {
    content: parts.join(''),
    reasoning: reasoningParts.join(''),
  };
}

/**
 * Parse a server-sent event (SSE) data field.
 * Handles both SSE format (data: {"..."}) and raw JSON lines.
 */
export function parseSSEDataLine(line: string): object | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return null;
  const jsonStr = trimmed.slice(5).trim();
  if (jsonStr === '[DONE]') return null;
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * Read an SSE/NDJSON stream and yield parsed JSON objects line-by-line.
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
    // Process remaining buffer
    if (buffer.trim()) {
      const obj = parseSSEDataLine(buffer);
      if (obj) yield obj;
    }
  } finally {
    reader.releaseLock();
  }
}
