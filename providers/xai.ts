/**
 * xAI (x.com/grok) provider.
 *
 * API: https://api.x.ai/v1
 * OpenAI-compatible format
 * API key: XAI_API_KEY
 * Reasoning: Grok-3 has thinking/reasoning mode — set `thinking: { type: "enabled" }`
 */

import { OpenAICompatibleProvider } from './openai-compatible';
import type { LlmCallOptions } from './types';

export class XAIProvider extends OpenAICompatibleProvider {
  readonly id = 'xai';
  readonly label = 'xAI (Grok)';
  readonly supportsReasoning = true;
  readonly docsUrl = 'https://docs.x.ai';
  readonly apiStyle = 'OpenAI-compatible';
  readonly defaultBaseUrl = 'https://api.x.ai/v1';

  protected _buildReasoningParam(reasoning: LlmCallOptions['reasoning'], model: string): object | null {
    if (!reasoning || reasoning.mode === 'off') return null;

    const isGrokReasoner = /grok-3/i.test(model) || /grok[_-]?(reasoner|thinking)/i.test(model);

    if (isGrokReasoner) {
      return { thinking: { type: 'enabled' } };
    }

    return null;
  }
}
