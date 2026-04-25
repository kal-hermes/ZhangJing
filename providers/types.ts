/**
 * ZhangJing LLM Provider System — Core Types
 * =========================================
 *
 * Architecture: each provider module exports a single function that implements
 * the provider's API quirks. The registry maps provider names to these functions.
 *
 * This is deliberately simpler than Cline/RooCode's class-based approach,
 * since ZhangJing only needs single-shot chat completions (no tool calls,
 * no multi-turn agent loops).
 */

/* ─────────────────────────────────────────────────────────────────────────────
   Stream chunks — normalized across all providers
───────────────────────────────────────────────────────────────────────────── */

export type LlmStreamChunk =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; reasoning: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number };

export type LlmStream = AsyncGenerator<LlmStreamChunk, void, unknown>;

/* ─────────────────────────────────────────────────────────────────────────────
   LLM call options and result
───────────────────────────────────────────────────────────────────────────── */

export interface LlmMessages {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCallOptions {
  /** Full provider config */
  config: ProviderConfig;
  /** Chat messages */
  messages: LlmMessages[];
  /** Reasoning/thinking mode */
  reasoning?: ReasoningSpec;
  /** Abort signal */
  signal?: AbortSignal;
  /** Request timeout in ms */
  timeout?: number;
}

export interface LlmResponse {
  /** The visible output (translation, chat response) */
  content: string;
  /** Chain-of-thought / reasoning trace. null if not applicable */
  reasoning: string | null;
  /** Provider id that handled this call */
  provider: string;
  /** Token usage (optional) */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
   Reasoning specification
───────────────────────────────────────────────────────────────────────────── */

/** How to handle reasoning/thinking for a given call */
export interface ReasoningSpec {
  /** 'auto' = use reasoning if model supports it; 'force' = always on; 'off' = never */
  mode: 'auto' | 'force' | 'off';
  /** Token budget for Anthropic-style thinking (ignored by other providers) */
  budgetTokens?: number;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Provider configuration (matches state.cfg.transLlm)
───────────────────────────────────────────────────────────────────────────── */

export interface ProviderConfig {
  /** Provider identifier: 'openai', 'minimax', 'deepseek', etc. */
  provider: string;
  /** Model identifier: 'gpt-4o', 'MiniMax-M2.7', etc. */
  model: string;
  /** Base URL of the API endpoint */
  baseUrl: string;
  /** API key */
  apiKey: string;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Provider function signature
───────────────────────────────────────────────────────────────────────────── */

/**
 * A provider implementation handles API calls for one provider family.
 * Each provider module exports a single function (or class constructor) that
 * matches this interface.
 *
 * @param options  - Contains config, messages, reasoning mode, signal
 * @returns Async generator yielding normalized stream chunks.
 *                   Collect chunks to get { content, reasoning }.
 *
 * Design note: we use a functional interface (options object + async generator)
 * rather than a class, to keep it lightweight and easy to implement per provider.
 */
export interface LlmProvider {
  readonly id: string;
  readonly label: string;
  readonly supportsReasoning: boolean;
  readonly docsUrl: string;

  /**
   * Make a streaming request to the LLM.
   * @param options  - config, messages, reasoning, signal
   * @yields LlmStreamChunk objects normalized from provider-specific responses
   */
  stream(options: LlmCallOptions): LlmStream;

  /**
   * Make a non-streaming (complete) request.
   * Default implementation calls stream() and collects. Override for non-streaming quirks.
   */
  complete?(options: LlmCallOptions): Promise<LlmResponse>;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Registry
───────────────────────────────────────────────────────────────────────────── */

export interface ProviderRegistry {
  /** Get a provider by id */
  get(id: string): LlmProvider | undefined;
  /** List all registered providers */
  list(): Array<{ id: string; label: string; supportsReasoning: boolean }>;
  /** Resolve the right provider from a config object */
  resolve(config: ProviderConfig): LlmProvider;
}

export { getProvider, listProviders, resolveProvider, register } from './registry';
