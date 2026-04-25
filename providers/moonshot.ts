/**
 * Moonshot (Kimim/moonshot-v1) provider for ZhangJing.
 *
 * API: https://api.moonshot.cn/v1
 * Models: moonshot-v1-8k, moonshot-v1-32k, moonshot-v1-128k
 *
 * Moonshot uses the OpenAI-compatible format with standard SSE streaming.
 * No native reasoning/thinking support.
 */

import { OpenAICompatibleProvider } from './openai-compatible';
import type { LlmCallOptions } from './types';

export class MoonshotProvider extends OpenAICompatibleProvider {
  readonly id = 'moonshot';
  readonly label = 'Moonshot (Kimim)';
  readonly supportsReasoning = false;
  readonly docsUrl = 'https://platform.moonshot.cn/docs/api/chat';

  /**
   * Moonshot has no native reasoning/thinking support.
   * Always return null regardless of reasoning mode.
   */
  protected override _buildReasoningParam(
    _reasoning: LlmCallOptions['reasoning'],
    _model: string
  ): object | null {
    return null;
  }
}
