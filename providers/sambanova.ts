/**
 * SambaNova provider — extends OpenAI-compatible API.
 *
 * API: https://api.sambanova.ai/api/v1
 * Supports DeepSeek R1 reasoning models via `thinking` block.
 */

import { OpenAICompatibleProvider } from './openai-compatible';
import type { LlmCallOptions } from './types';

export class SambaNovaProvider extends OpenAICompatibleProvider {
  readonly id = 'sambanova';
  readonly label = 'SambaNova';
  readonly supportsReasoning = true;
  readonly docsUrl = 'https://docs.sambanova.ai';

  protected _buildReasoningParam(reasoning: LlmCallOptions['reasoning'], model: string): object | null {
    if (!reasoning || reasoning.mode === 'off') return null;

    const isDeepSeekR1 = /deepseek[_-]?r1/i.test(model);

    if (isDeepSeekR1) {
      return { thinking: { type: 'enabled' } };
    }

    return null;
  }
}
