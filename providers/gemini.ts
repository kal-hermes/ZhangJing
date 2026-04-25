/**
 * Google AI (AI Studio / generativelanguage.googleapis.com) provider.
 * NOT the same as Vertex AI — this is the consumer-facing Google AI API.
 *
 * API: https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent
 * API key: passed as ?key= query param
 * Models: gemini-2.0-flash, gemini-1.5-flash, gemini-1.5-pro, etc.
 * Reasoning: Gemini 2.0 thinking experimental — set `thinkingConfig: { thinkingBudget: N }`
 * Streaming: SSE with `data: {...}` format
 * Message format: `{ contents: [{ role: 'user'/'model', parts: [{ text: '...' }] }] }`
 */

import type { LlmProvider, LlmCallOptions, LlmStreamChunk, LlmStream, LlmResponse } from './types';
import { textChunk, reasoningChunk, usageChunk } from './transform/shared';

export class GeminiProvider implements LlmProvider {
  readonly id = 'gemini';
  readonly label = 'Google AI (AI Studio)';
  readonly supportsReasoning = true;
  readonly docsUrl = 'https://ai.google.dev/api/generate-content';

  async *stream({ config, messages, reasoning, signal }: LlmCallOptions): LlmStream {
    const { baseUrl, apiKey, model } = config;
    const modelName = model || 'gemini-2.0-flash';
    const key = apiKey;

    // Determine base URL
    let base = baseUrl;
    if (!base) {
      base = 'https://generativelanguage.googleapis.com/v1beta';
    }
    const url = `${base}/models/${modelName}:streamGenerateContent?key=${key}&alt=sse`;

    // Build contents
    const contents = this._convertMessages(messages);

    // Build request body
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: 0.3,
        topP: 0.95,
      },
      stream: true,
    };

    // Add thinking config for reasoning models
    if (reasoning?.mode !== 'off') {
      const budget = reasoning?.budgetTokens ?? 4096;
      (body as Record<string, unknown>).thinkingConfig = { thinkingBudget: budget };
    }

    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    };

    const response = await fetch(url, init);
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`${this.id} API error ${response.status}: ${errText || response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error(`${this.id}: response body is not readable`);

    const decoder = new TextDecoder();
    let buffer = '';
    let usageEmitted = false;

    try {
      while (true) {
        if (signal?.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          try {
            const chunk = JSON.parse(trimmed.slice(6)) as Record<string, unknown>;

            // Candidate / content block
            const candidates = chunk.candidates as Array<Record<string, unknown>> | undefined;
            const content = candidates?.[0]?.content as Record<string, unknown> | undefined;
            const parts = content?.parts as Array<Record<string, unknown>> | undefined;

            if (!parts) continue;

            for (const part of parts) {
              if (part.text) {
                yield textChunk(String(part.text));
              }
              // Gemini thinking: part.thought (boolean) or part.thinking ?
              // Actually in streaming, thinking content comes as text with a thought marker
              if ('thought' in part && part.thought === true) {
                // This part contains internal thought — emit as reasoning
                if (part.text) yield reasoningChunk(String(part.text));
              }
            }

            // Usage in final chunk
            if (!usageEmitted && chunk.usageMetadata) {
              usageEmitted = true;
              const u = chunk.usageMetadata as Record<string, unknown>;
              yield usageChunk({
                inputTokens: (u.promptTokenCount as number) || 0,
                outputTokens: (u.candidatesTokenCount as number) || 0,
                cacheReadTokens: (u.cachedContentTokenCount as number) || 0,
                reasoningTokens: (u.thoughtsTokenCount as number) || 0,
              });
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async complete({ config, messages, reasoning, signal }: LlmCallOptions): Promise<LlmResponse> {
    const stream = this.stream({ config, messages, reasoning, signal });
    const contentParts: string[] = [];
    const reasoningParts: string[] = [];

    for await (const chunk of stream) {
      if (chunk.type === 'text') contentParts.push(chunk.text);
      if (chunk.type === 'reasoning') reasoningParts.push(chunk.reasoning);
    }

    return {
      content: contentParts.join(''),
      reasoning: reasoningParts.join('') || null,
      provider: this.id,
    };
  }

  private _convertMessages(messages: LlmCallOptions['messages']): Array<{ role: string; parts: Array<{ text: string }> }> {
    const result: Array<{ role: string; parts: Array<{ text: string }> }> = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Prepend system as a user message (Gemini doesn't have system role)
        result.push({ role: 'user', parts: [{ text: `[System] ${msg.content}` }] });
      } else {
        result.push({
          role: msg.role === 'assistant' ? 'model' : msg.role,
          parts: [{ text: msg.content }],
        });
      }
    }

    return result;
  }
}
