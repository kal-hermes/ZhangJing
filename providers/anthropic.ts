/**
 * Anthropic provider (direct API).
 *
 * Uses the Anthropic SDK to call the Anthropic API directly.
 * Reasoning/thinking is handled via the `thinking` parameter.
 * The SDK returns thinking as structured content blocks (type: 'thinking').
 *
 * Docs: https://docs.anthropic.com/claude/reference
 */

import type { LlmProvider, LlmCallOptions, LlmStreamChunk, LlmStream, LlmResponse } from './types';
import { textChunk, reasoningChunk, usageChunk } from './transform/shared';

export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic';
  readonly label = 'Anthropic (Direct)';
  readonly supportsReasoning = true;
  readonly docsUrl = 'https://docs.anthropic.com/claude/reference';

  // Lazy-loaded SDK instance
  private _sdk: unknown = null;

  private async _getSdk() {
    if (this._sdk) return this._sdk as { messages: { stream: Function; create: Function } };

    // Dynamically import Anthropic SDK from CDN
    // @ts-ignore
    const { Anthropic } = await import('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.30.1/+esm');
    this._sdk = new Anthropic();
    return this._sdk as { messages: { stream: Function; create: Function } };
  }

  async *stream({ config, messages, reasoning, signal }: LlmCallOptions): LlmStream {
    const sdk = await this._getSdk();

    const systemMessages: string[] = [];
    const chatMessages: Array<{ role: string; content: string }> = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemMessages.push(msg.content);
      } else {
        chatMessages.push({ role: msg.role, content: msg.content });
      }
    }

    const enableThinking = reasoning?.mode !== 'off';
    const budgetTokens = reasoning?.budgetTokens ?? 4096;

    const stream = await sdk.messages.stream({
      model: config.model || 'claude-sonnet-4-7-20250620',
      max_tokens: 8192,
      system: systemMessages.join('\n'),
      messages: chatMessages,
      thinking: enableThinking ? { type: 'enabled', budget_tokens: budgetTokens } : undefined,
      temperature: 0.3,
      stream: true,
    } as Record<string, unknown>);

    let lastUsage: Record<string, unknown> | null = null;

    // The Anthropic SDK streams content blocks with types:
    //   content_block_start → { type: 'thinking' } or { type: 'text' }
    //   content_block_delta → { thinking_delta: { text: '...' } } or { text_delta: { text: '...' } }
    //   content_block_stop
    //   message_start       → { usage: { ... } }
    //   message_delta       → { usage: { ... } }

    try {
      // @ts-ignore - SDK stream types are complex
      for await (const event of stream) {
        if (signal?.aborted) break;

        switch (event.type) {
          case 'content_block_start': {
            // We just need to know the block type; delta comes next
            break;
          }
          case 'content_block_delta': {
            const delta = event.delta as Record<string, unknown>;
            if (delta.thinking_delta) {
              yield reasoningChunk(String((delta.thinking_delta as Record<string, unknown>).text || ''));
            }
            if (delta.text_delta) {
              yield textChunk(String((delta.text_delta as Record<string, unknown>).text || ''));
            }
            break;
          }
          case 'message_start': {
            const msg = event.message as Record<string, unknown>;
            if (msg.usage) lastUsage = msg.usage as Record<string, unknown>;
            break;
          }
          case 'message_delta': {
            const delta = event.delta as Record<string, unknown>;
            if (delta.usage) lastUsage = { ...lastUsage, ...(delta.usage as Record<string, unknown>) };
            break;
          }
          case 'message_stop': {
            if (lastUsage) {
              const u = lastUsage;
              yield usageChunk({
                inputTokens: (u.input_tokens as number) || 0,
                outputTokens: (u.output_tokens as number) || 0,
                cacheReadTokens: (u.cache_read_tokens as number) || 0,
                cacheWriteTokens: (u.cache_creation_input_tokens as number) || 0,
              });
            }
            break;
          }
        }
      }
    } catch (e) {
      throw new Error(`${this.id} stream error: ${e}`);
    }
  }

  async complete({ config, messages, reasoning, signal }: LlmCallOptions): Promise<LlmResponse> {
    const sdk = await this._getSdk();

    const systemMessages: string[] = [];
    const chatMessages: Array<{ role: string; content: string }> = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemMessages.push(msg.content);
      } else {
        chatMessages.push({ role: msg.role, content: msg.content });
      }
    }

    const enableThinking = reasoning?.mode !== 'off';
    const budgetTokens = reasoning?.budgetTokens ?? 4096;

    const response = await sdk.messages.create({
      model: config.model || 'claude-sonnet-4-7-20250620',
      max_tokens: 8192,
      system: systemMessages.join('\n'),
      messages: chatMessages,
      thinking: enableThinking ? { type: 'enabled', budget_tokens: budgetTokens } : undefined,
      temperature: 0.3,
      stream: false,
    } as Record<string, unknown>);

    const resp = response as Record<string, unknown>;
    const content = resp.content as Array<Record<string, unknown>> | undefined;
    const usage = resp.usage as Record<string, unknown> | undefined;

    let reasoningText = '';
    let contentText = '';

    if (content) {
      for (const block of content) {
        if (block.type === 'thinking') {
          reasoningText += String(block.thinking || '');
        } else if (block.type === 'text') {
          contentText += String(block.text || '');
        }
      }
    }

    return {
      content: contentText,
      reasoning: reasoningText || null,
      provider: this.id,
      usage: usage ? {
        inputTokens: (usage.input_tokens as number) || 0,
        outputTokens: (usage.output_tokens as number) || 0,
        cacheReadTokens: (usage.cache_read_tokens as number) || 0,
        cacheWriteTokens: (usage.cache_creation_input_tokens as number) || 0,
      } : undefined,
    };
  }
}
