/**
 * Groq provider — low-latency OpenAI-compatible API.
 *
 * Supports DeepSeek R1 models via `reasoning_format: 'parsed'` in the request body.
 * API docs: https://console.groq.com/docs/api
 */

import type { LlmProvider, LlmCallOptions, LlmStream } from './types';
import { OpenAICompatibleProvider } from './openai-compatible';

export class GroqProvider extends OpenAICompatibleProvider {
  readonly id = 'groq';
  readonly label = 'Groq';
  readonly supportsReasoning = true;
  readonly docsUrl = 'https://console.groq.com/docs/api';

  protected override _buildReasoningParam(
    reasoning: LlmCallOptions['reasoning'],
    model: string,
  ): object | null {
    if (!reasoning || reasoning.mode === 'off') return null;

    const isOSeries = /^o[1-9]/i.test(model);
    if (isOSeries) {
      // o1/o3: reasoning is server-side only, no client param needed
      return null;
    }

    const isDeepSeekR1 =
      /deepseek-r1-distill-qwen/i.test(model) ||
      /deepseek-r1-distill-llama/i.test(model);

    if (isDeepSeekR1) {
      return { reasoning_format: 'parsed' };
    }

    return null;
  }
}
