/**
 * Provider registry — maps config.provider values to LlmProvider implementations.
 * Import all providers here to register them.
 */

import type { LlmProvider, ProviderRegistry, ProviderConfig } from './types';

const _providers = new Map<string, LlmProvider>();

/* ── Registration ────────────────────────────────────────────────────────── */

function register(p: LlmProvider): void {
  _providers.set(p.id, p);
}

/* ── Built-in providers ──────────────────────────────────────────────────── */

import { OpenAICompatibleProvider } from './openai-compatible';
register(new OpenAICompatibleProvider());

import { MiniMaxProvider } from './minimax';
register(new MiniMaxProvider());

import { DeepSeekProvider } from './deepseek';
register(new DeepSeekProvider());

import { AnthropicProvider } from './anthropic';
register(new AnthropicProvider());

import { OpenRouterProvider } from './openrouter';
register(new OpenRouterProvider());

import { OllamaProvider } from './ollama';
register(new OllamaProvider());

import { LMStudioProvider } from './lm-studio';
register(new LMStudioProvider());

import { GroqProvider } from './groq';
register(new GroqProvider());

import { FireworksProvider } from './fireworks';
register(new FireworksProvider());

import { OpenAINativeProvider } from './openai-native';
register(new OpenAINativeProvider());

import { VertexProvider } from './vertex';
register(new VertexProvider());

import { BedrockProvider } from './bedrock';
register(new BedrockProvider());

import { GeminiProvider } from './gemini';
register(new GeminiProvider());

import { MistralProvider } from './mistral';
register(new MistralProvider());

import { MoonshotProvider } from './moonshot';
register(new MoonshotProvider());

import { XAIProvider } from './xai';
register(new XAIProvider());

import { SambaNovaProvider } from './sambanova';
register(new SambaNovaProvider());

import { VercelAIGatewayProvider } from './vercel-ai-gateway';
register(new VercelAIGatewayProvider());

import { TogetherProvider } from './together';
register(new TogetherProvider());

import { HyperbolicProvider } from './hyperbolic';
register(new HyperbolicProvider());

import { ZaiProvider } from './zai';
register(new ZaiProvider());

/* ── Public API ──────────────────────────────────────────────────────────── */

export function getProvider(id: string): LlmProvider | undefined {
  return _providers.get(id);
}

export function listProviders(): Array<{ id: string; label: string; supportsReasoning: boolean }> {
  return Array.from(_providers.values()).map(p => ({
    id: p.id,
    label: p.label,
    supportsReasoning: p.supportsReasoning,
  }));
}

export function resolveProvider(config: ProviderConfig): LlmProvider {
  const p = _providers.get(config.provider);
  if (p) return p;
  // Fallback to generic OpenAI-compatible
  const fallback = _providers.get('openai-compatible');
  if (!fallback) throw new Error('No provider found and no fallback available');
  return fallback;
}

export type { ProviderRegistry };
