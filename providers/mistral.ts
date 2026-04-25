/**
 * Mistral AI provider for ZhangJing.
 *
 * API: https://api.mistral.ai/v1 (OpenAI-compatible format)
 * Authentication: MISTRAL_API_KEY
 * Reasoning: Not supported — Mistral does not have a native reasoner model.
 */

import { OpenAICompatibleProvider } from './openai-compatible';
import type { LlmCallOptions } from './types';

export class MistralProvider extends OpenAICompatibleProvider {
  readonly id = 'mistral';
  readonly label = 'Mistral';
  readonly supportsReasoning = false;
  readonly docsUrl = 'https://docs.mistral.ai/api/api-reference/chat';

  /**
   * Mistral has no native reasoning/thinking support.
   * Always returns null regardless of reasoning spec.
   */
  protected override _buildReasoningParam(
    _reasoning: LlmCallOptions['reasoning'],
    _model: string
  ): object | null {
    return null;
  }
}
