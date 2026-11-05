/**
 * Vercel AI Gateway provider.
 *
 * Vercel AI Gateway (https://vercel.com/docs/ai) is a proxy that provides
 * a unified OpenAI-compatible API across multiple providers with built-in
 * caching, fallbacks, and rate limiting.
 *
 * API: configurable base URL (user provides it)
 * OpenAI-compatible format
 * API key: user's Vercel auth token or gateway API key
 * Reasoning: depends on the upstream provider — pass through reasoning params
 */

import { OpenAICompatibleProvider } from './openai-compatible';
import type { LlmCallOptions } from './types';

export class VercelAIGatewayProvider extends OpenAICompatibleProvider {
  readonly id = 'vercel-ai-gateway';
  readonly label = 'Vercel AI Gateway';
  readonly supportsReasoning = true;
  readonly docsUrl = 'https://vercel.com/docs/ai';
  readonly apiStyle = 'OpenAI-compatible';
  readonly defaultBaseUrl = 'https://ai-gateway.vercel.sh/v1';

  // Vercel AI Gateway passes through reasoning params to the upstream provider.
  // We inherit the base class _buildReasoningParam which handles DeepSeek R1,
  // o1/o3 detection automatically.
}
