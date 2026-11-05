/**
 * OpenAI Native provider — handles OpenAI's official API with special handling
 * for o1/o3 reasoning models which have server-side reasoning only.
 *
 * API: https://api.openai.com/v1
 * Reasoning: o1/o3 have server-side reasoning only (reasoning_content not in API response).
 * For DeepSeek R1 passed through OpenAI, we still support it via `thinking` param.
 */

import { OpenAICompatibleProvider } from './openai-compatible';
import type { LlmCallOptions } from './types';

export class OpenAINativeProvider extends OpenAICompatibleProvider {
  readonly id = 'openai';
  readonly label = 'OpenAI (direct)';
  readonly docsUrl = 'https://platform.openai.com/docs/api-reference/chat';
  readonly apiStyle = 'OpenAI chat completions';
  readonly defaultBaseUrl = 'https://api.openai.com/v1';

  protected _buildReasoningParam(reasoning: LlmCallOptions['reasoning'], model: string): object | null {
    if (!reasoning || reasoning.mode === 'off') return null;

    const isOSeries = /^o[1-9]/i.test(model);

    if (isOSeries) {
      // o1/o3: reasoning is server-side only, no client parameter needed
      return null;
    }

    // DeepSeek R1 through OpenAI-compatible endpoint
    const isDeepSeekR1 = /deepseek[_-]?r1/i.test(model);
    if (isDeepSeekR1) {
      return { thinking: { type: 'enabled' } };
    }

    return null;
  }
}
