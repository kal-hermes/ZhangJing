/**
 * LM Studio provider — local OpenAI-compatible inference.
 *
 * LM Studio exposes an OpenAI-compatible API at a configurable base URL
 * (default: http://localhost:1234/v1). No API key is required by default.
 * LM Studio does not support native reasoning/thinking parameters.
 */

import { OpenAICompatibleProvider } from './openai-compatible';
import type { LlmCallOptions } from './types';

export class LMStudioProvider extends OpenAICompatibleProvider {
  readonly id = 'lm-studio';
  readonly label = 'LM Studio (local)';
  readonly supportsReasoning = false;
  readonly docsUrl = 'https://lmstudio.ai/docs';
  readonly apiStyle = 'OpenAI-compatible';
  readonly defaultBaseUrl = 'http://localhost:1234/v1';

  /**
   * LM Studio does not support reasoning/thinking parameters,
   * so we always return null regardless of reasoning mode.
   */
  protected _buildReasoningParam(
    _reasoning: LlmCallOptions['reasoning'],
    _model: string
  ): object | null {
    return null;
  }
}
