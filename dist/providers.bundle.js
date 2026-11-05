var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// providers/shims.mjs
var init_shims = __esm({
  "providers/shims.mjs"() {
    "use strict";
  }
});

// providers/transform/shared.ts
var shared_exports = {};
__export(shared_exports, {
  buildOpenAIRequest: () => buildOpenAIRequest,
  collectStream: () => collectStream,
  normalizeBaseUrl: () => normalizeBaseUrl,
  parseSSEDataLine: () => parseSSEDataLine,
  parseSSEStream: () => parseSSEStream,
  reasoningChunk: () => reasoningChunk,
  stripThinkingTags: () => stripThinkingTags,
  textChunk: () => textChunk,
  usageChunk: () => usageChunk
});
function parseSSEDataLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const jsonStr = trimmed.slice(5).trim();
  if (jsonStr === "[DONE]" || jsonStr === "done") return null;
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}
async function* parseSSEStream(response) {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const obj = parseSSEDataLine(line);
        if (obj) yield obj;
      }
    }
    const remaining = buffer.trim();
    if (remaining) {
      const obj = parseSSEDataLine(remaining);
      if (obj) yield obj;
    }
  } finally {
    reader.releaseLock();
  }
}
function textChunk(text) {
  return { type: "text", text };
}
function reasoningChunk(reasoning) {
  return { type: "reasoning", reasoning };
}
function usageChunk(opts) {
  return { type: "usage", ...opts };
}
async function buildOpenAIRequest(opts) {
  const {
    url,
    apiKey,
    model,
    messages,
    temperature = 0.3,
    maxTokens,
    reasoning = null,
    stream = true,
    signal
  } = opts;
  const body = {
    model,
    messages,
    stream,
    ...temperature !== void 0 && { temperature },
    ...maxTokens && { max_tokens: maxTokens },
    ...reasoning && { reasoning },
    ...stream && { stream_options: { include_usage: true } }
  };
  return {
    url,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal
    }
  };
}
async function collectStream(stream) {
  const contentParts = [];
  const reasoningParts = [];
  for await (const chunk of stream) {
    if (chunk.type === "text" && chunk.text) contentParts.push(chunk.text);
    else if (chunk.type === "reasoning" && chunk.reasoning) reasoningParts.push(chunk.reasoning);
  }
  return { content: contentParts.join(""), reasoning: reasoningParts.join("") };
}
function stripThinkingTags(content) {
  return content.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}
function normalizeBaseUrl(url) {
  return url.trim().replace(/\/+$/, "");
}
var init_shared = __esm({
  "providers/transform/shared.ts"() {
    "use strict";
    init_shims();
  }
});

// providers/index.ts
init_shims();

// providers/callLlm.ts
init_shims();

// providers/registry.ts
init_shims();

// providers/openai-compatible.ts
init_shims();
init_shared();
init_shared();
var OpenAICompatibleProvider = class {
  constructor() {
    this.id = "openai-compatible";
    this.label = "OpenAI-Compatible";
    this.supportsReasoning = true;
    this.docsUrl = "https://platform.openai.com/docs/api-reference/chat";
    this.apiStyle = "OpenAI chat completions";
    this.defaultBaseUrl = "";
  }
  stream({ config, messages, reasoning, signal }) {
    return this._stream({ config, messages, reasoning, signal });
  }
  async *_stream(opts) {
    const { config, messages, reasoning, signal } = opts;
    const { baseUrl, apiKey, model } = config;
    const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
    const reasoningParam = this._buildReasoningParam(reasoning, model);
    const { init } = await buildOpenAIRequest({
      url,
      apiKey,
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: 0.3,
      reasoning: reasoningParam,
      stream: true,
      signal
    });
    const response = await fetch(url, { ...init, signal });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`${this.id} API error ${response.status}: ${errText || response.statusText}`);
    }
    let reasoningBuffer = "";
    let usageEmitted = false;
    for await (const obj of parseSSEStream(response)) {
      const chunk = obj;
      if (chunk.error) {
        const err = chunk.error;
        throw new Error(`${this.id} error: ${err.message ?? JSON.stringify(err)}`);
      }
      const choices = chunk.choices;
      if (!choices?.length) continue;
      const delta = choices[0].delta;
      const finishReason = choices[0].finish_reason;
      if (finishReason === "error") {
        throw new Error(`${this.id} stream error: ${JSON.stringify(chunk)}`);
      }
      if (delta && "reasoning_content" in delta && delta.reasoning_content) {
        const rc = String(delta.reasoning_content);
        reasoningBuffer += rc;
        yield reasoningChunk(rc);
      }
      if (delta?.content) {
        if (reasoningBuffer) {
          reasoningBuffer = "";
        }
        yield textChunk(String(delta.content));
      }
      if (!usageEmitted && chunk.usage) {
        usageEmitted = true;
        const u = chunk.usage;
        yield usageChunk({
          inputTokens: u.prompt_tokens || 0,
          outputTokens: u.completion_tokens || 0,
          cacheReadTokens: u.prompt_tokens_details?.cached_tokens || 0,
          reasoningTokens: u.completion_tokens_details?.reasoning_tokens || 0
        });
      }
    }
  }
  /** Determine the reasoning param based on model name */
  _buildReasoningParam(reasoning, model) {
    if (!reasoning || reasoning.mode === "off") return null;
    const isOSeries = /^o[1-9]/i.test(model);
    const isDeepSeekReasoner = /deepseek[_-]?r1/i.test(model) || /deepseek[_-]?reasoner/i.test(model);
    if (isOSeries) {
      return null;
    }
    if (isDeepSeekReasoner || reasoning.mode === "force") {
      return { thinking: { type: "enabled" } };
    }
    return null;
  }
};

// providers/minimax.ts
init_shims();
init_shared();
var MiniMaxProvider = class {
  constructor() {
    this.id = "minimax";
    this.label = "MiniMax";
    this.supportsReasoning = true;
    this.docsUrl = "https://platform.minimax.io/docs/api-reference/text-openai-api";
    this.apiStyle = "OpenAI-compatible (extra_body reasoning_split)";
    this.defaultBaseUrl = "https://api.minimax.io/v1";
  }
  async *stream({ config, messages, reasoning, signal }) {
    const { baseUrl, apiKey, model } = config;
    const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
    const body = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.3
    };
    if (reasoning?.mode !== "off") {
      body.extra_body = { reasoning_split: true };
    }
    const init = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal
    };
    const response = await fetch(url, init);
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`${this.id} API error ${response.status}: ${errText || response.statusText}`);
    }
    let usageEmitted = false;
    for await (const obj of parseSSEStream(response)) {
      const chunk = obj;
      if (chunk.base_resp) {
        const br = chunk.base_resp;
        if (br.status_code && Number(br.status_code) !== 0) {
          throw new Error(`${this.id} API error ${br.status_code}: ${br.status_msg || "unknown"}`);
        }
      }
      const choices = chunk.choices;
      if (!choices?.length) continue;
      const delta = choices[0].delta;
      if (delta && "reasoning_details" in delta && delta.reasoning_details) {
        const details = delta.reasoning_details;
        if (Array.isArray(details)) {
          for (const detail of details) {
            if (detail && typeof detail === "object" && "text" in detail) {
              yield reasoningChunk(String(detail.text));
            }
          }
        }
      }
      if (delta?.content) {
        yield textChunk(String(delta.content));
      }
      if (!usageEmitted && chunk.usage) {
        usageEmitted = true;
        const u = chunk.usage;
        yield usageChunk({
          inputTokens: u.prompt_tokens || 0,
          outputTokens: u.completion_tokens || 0,
          cacheReadTokens: u.prompt_tokens_details?.cached_tokens || 0
        });
      }
    }
  }
  async complete({ config, messages, reasoning, signal }) {
    const { baseUrl, apiKey, model } = config;
    const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
    const body = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
      temperature: 0.3
    };
    if (reasoning?.mode !== "off") {
      body.extra_body = { reasoning_split: true };
    }
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`${this.id} API error ${response.status}: ${errText || response.statusText}`);
    }
    const data = await response.json();
    const choice = data.choices?.[0];
    const message = choice?.message;
    let reasoningText = "";
    if (message?.reasoning_details) {
      const details = message.reasoning_details;
      if (Array.isArray(details)) {
        reasoningText = details.filter((d) => d && typeof d === "object" && "text" in d).map((d) => String(d.text)).join("");
      }
    }
    return {
      content: String(message?.content || ""),
      reasoning: reasoningText || null,
      provider: this.id
    };
  }
};

// providers/deepseek.ts
init_shims();
init_shared();
var DeepSeekProvider = class {
  constructor() {
    this.id = "deepseek";
    this.label = "DeepSeek";
    this.supportsReasoning = true;
    this.docsUrl = "https://api-docs.deepseek.com/api-reference/chat";
    this.apiStyle = "OpenAI-compatible (thinking param)";
    this.defaultBaseUrl = "https://api.deepseek.com/v1";
  }
  async *stream({ config, messages, reasoning, signal }) {
    const { baseUrl, apiKey, model } = config;
    const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
    const isReasoner = /deepseek[_-]?(reasoner|r1)/i.test(model);
    const enableThinking = isReasoner || reasoning?.mode === "force";
    const body = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.3
    };
    if (enableThinking) {
      body.thinking = { type: "enabled" };
    }
    const init = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal
    };
    const response = await fetch(url, init);
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`${this.id} API error ${response.status}: ${errText || response.statusText}`);
    }
    let usageEmitted = false;
    for await (const obj of parseSSEStream(response)) {
      const chunk = obj;
      if (chunk.error) {
        throw new Error(`${this.id} error: ${chunk.error.message ?? JSON.stringify(chunk.error)}`);
      }
      const choices = chunk.choices;
      if (!choices?.length) continue;
      const delta = choices[0].delta;
      if (delta && "reasoning_content" in delta && delta.reasoning_content) {
        yield reasoningChunk(String(delta.reasoning_content));
      }
      if (delta?.content) {
        yield textChunk(String(delta.content));
      }
      if (!usageEmitted && chunk.usage) {
        usageEmitted = true;
        const u = chunk.usage;
        yield usageChunk({
          inputTokens: u.prompt_tokens || 0,
          outputTokens: u.completion_tokens || 0,
          cacheReadTokens: u.prompt_tokens_details?.cached_tokens || 0,
          cacheWriteTokens: u.prompt_tokens_details?.cache_write_tokens || 0
        });
      }
    }
  }
  async complete({ config, messages, reasoning, signal }) {
    const { baseUrl, apiKey, model } = config;
    const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
    const isReasoner = /deepseek[_-]?(reasoner|r1)/i.test(model);
    const enableThinking = isReasoner || reasoning?.mode === "force";
    const body = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
      temperature: 0.3
    };
    if (enableThinking) {
      body.thinking = { type: "enabled" };
    }
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`${this.id} API error ${response.status}: ${errText || response.statusText}`);
    }
    const data = await response.json();
    const message = data.choices?.[0]?.message;
    return {
      content: String(message?.content || ""),
      reasoning: message?.reasoning_content || null,
      provider: this.id
    };
  }
};

// providers/anthropic.ts
init_shims();
init_shared();
var AnthropicProvider = class {
  constructor() {
    this.id = "anthropic";
    this.label = "Anthropic (Direct)";
    this.supportsReasoning = true;
    this.docsUrl = "https://docs.anthropic.com/claude/reference";
    this.apiStyle = "Anthropic Messages API (direct SDK)";
    this.defaultBaseUrl = "";
    // Lazy-loaded SDK instance
    this._sdk = null;
  }
  async _getSdk() {
    if (this._sdk) return this._sdk;
    const { Anthropic } = await import("https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.30.1/+esm");
    this._sdk = new Anthropic();
    return this._sdk;
  }
  async *stream({ config, messages, reasoning, signal }) {
    const sdk = await this._getSdk();
    const systemMessages = [];
    const chatMessages = [];
    for (const msg of messages) {
      if (msg.role === "system") {
        systemMessages.push(msg.content);
      } else {
        chatMessages.push({ role: msg.role, content: msg.content });
      }
    }
    const enableThinking = reasoning?.mode !== "off";
    const budgetTokens = reasoning?.budgetTokens ?? 4096;
    const stream = await sdk.messages.stream({
      model: config.model || "claude-sonnet-4-7-20250620",
      max_tokens: 8192,
      system: systemMessages.join("\n"),
      messages: chatMessages,
      thinking: enableThinking ? { type: "enabled", budget_tokens: budgetTokens } : void 0,
      temperature: 0.3,
      stream: true
    });
    let lastUsage = null;
    try {
      for await (const event of stream) {
        if (signal?.aborted) break;
        switch (event.type) {
          case "content_block_start": {
            break;
          }
          case "content_block_delta": {
            const delta = event.delta;
            if (delta.thinking_delta) {
              yield reasoningChunk(String(delta.thinking_delta.text || ""));
            }
            if (delta.text_delta) {
              yield textChunk(String(delta.text_delta.text || ""));
            }
            break;
          }
          case "message_start": {
            const msg = event.message;
            if (msg.usage) lastUsage = msg.usage;
            break;
          }
          case "message_delta": {
            const delta = event.delta;
            if (delta.usage) lastUsage = { ...lastUsage ?? {}, ...delta.usage };
            break;
          }
          case "message_stop": {
            if (lastUsage) {
              const u = lastUsage;
              yield usageChunk({
                inputTokens: u.input_tokens || 0,
                outputTokens: u.output_tokens || 0,
                cacheReadTokens: u.cache_read_tokens || 0,
                cacheWriteTokens: u.cache_creation_input_tokens || 0
              });
            }
            break;
          }
        }
      }
    } catch (e) {
      throw new Error(`${this.id} stream error: ${e}`);
    }
  }
  async complete({ config, messages, reasoning, signal }) {
    const sdk = await this._getSdk();
    const systemMessages = [];
    const chatMessages = [];
    for (const msg of messages) {
      if (msg.role === "system") {
        systemMessages.push(msg.content);
      } else {
        chatMessages.push({ role: msg.role, content: msg.content });
      }
    }
    const enableThinking = reasoning?.mode !== "off";
    const budgetTokens = reasoning?.budgetTokens ?? 4096;
    const response = await sdk.messages.create({
      model: config.model || "claude-sonnet-4-7-20250620",
      max_tokens: 8192,
      system: systemMessages.join("\n"),
      messages: chatMessages,
      thinking: enableThinking ? { type: "enabled", budget_tokens: budgetTokens } : void 0,
      temperature: 0.3,
      stream: false
    });
    const resp = response;
    const content = resp.content;
    const usage = resp.usage;
    let reasoningText = "";
    let contentText = "";
    if (content) {
      for (const block of content) {
        if (block.type === "thinking") {
          reasoningText += String(block.thinking || "");
        } else if (block.type === "text") {
          contentText += String(block.text || "");
        }
      }
    }
    return {
      content: contentText,
      reasoning: reasoningText || null,
      provider: this.id,
      usage: usage ? {
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
        cacheReadTokens: usage.cache_read_tokens || 0,
        cacheWriteTokens: usage.cache_creation_input_tokens || 0
      } : void 0
    };
  }
};

// providers/openrouter.ts
init_shims();
init_shared();
init_shared();
var OpenRouterProvider = class extends OpenAICompatibleProvider {
  constructor() {
    super(...arguments);
    this.id = "openrouter";
    this.label = "OpenRouter";
    /** OpenRouter supports reasoning when the underlying model does (DeepSeek R1, o1, etc.) */
    this.supportsReasoning = true;
    this.docsUrl = "https://openrouter.ai/docs/api-reference/chat";
    this.apiStyle = "OpenAI-compatible";
    this.defaultBaseUrl = "https://openrouter.ai/api/v1";
  }
  stream({ config, messages, reasoning, signal }) {
    return this._stream({ config, messages, reasoning, signal });
  }
  async *_stream(opts) {
    const { config, messages, reasoning, signal } = opts;
    const { baseUrl, apiKey, model } = config;
    const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
    const reasoningParam = this._buildReasoningParam(reasoning, model);
    const { init } = await buildOpenAIRequest({
      url,
      apiKey,
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: 0.3,
      reasoning: reasoningParam,
      stream: true,
      signal
    });
    const mergedInit = {
      ...init,
      headers: {
        ...init.headers,
        "HTTP-Referer": "https://github.com/ZhangJing",
        "X-Title": "ZhangJing Translator"
      }
    };
    const response = await fetch(url, { ...mergedInit, signal });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      try {
        const errJson = JSON.parse(errText);
        if (errJson?.error) {
          const e = errJson.error;
          const msg = e.message ?? JSON.stringify(e);
          const code = e.code ?? "";
          const raw = e.metadata?.raw ?? "";
          throw new Error(
            `${this.id} error${code ? ` [${code}]` : ""}: ${msg}${raw ? ` \u2014 ${raw}` : ""}`
          );
        }
      } catch (e2) {
        if (e2 instanceof Error) throw e2;
      }
      throw new Error(`${this.id} API error ${response.status}: ${errText || response.statusText}`);
    }
    let reasoningBuffer = "";
    let usageEmitted = false;
    for await (const obj of parseSSEStream(response)) {
      const chunk = obj;
      if (chunk.error) {
        const err = chunk.error;
        const msg = err.message ?? JSON.stringify(err);
        const code = err.code ?? "";
        const raw = err.metadata?.raw ?? "";
        throw new Error(
          `${this.id} error${code ? ` [${code}]` : ""}: ${msg}${raw ? ` \u2014 ${raw}` : ""}`
        );
      }
      const choices = chunk.choices;
      if (!choices?.length) continue;
      const delta = choices[0].delta;
      const finishReason = choices[0].finish_reason;
      if (finishReason === "error") {
        throw new Error(`${this.id} stream error: ${JSON.stringify(chunk)}`);
      }
      if (delta && "reasoning_content" in delta && delta.reasoning_content) {
        const rc = String(delta.reasoning_content);
        reasoningBuffer += rc;
        yield reasoningChunk(rc);
      }
      if (delta?.content) {
        if (reasoningBuffer) {
          reasoningBuffer = "";
        }
        yield textChunk(String(delta.content));
      }
      if (!usageEmitted && chunk.usage) {
        usageEmitted = true;
        const u = chunk.usage;
        yield usageChunk({
          inputTokens: u.prompt_tokens || 0,
          outputTokens: u.completion_tokens || 0,
          cacheReadTokens: u.prompt_tokens_details?.cached_tokens || 0,
          reasoningTokens: u.completion_tokens_details?.reasoning_tokens || 0
        });
      }
    }
  }
};

// providers/ollama.ts
init_shims();
init_shared();
var DEFAULT_TIMEOUT_MS = 3e4;
var DEFAULT_NUM_CTX = 32768;
var SDK_CDN = "https://cdn.jsdelivr.net/npm/ollama@0.5.8/+esm";
var OllamaProvider = class {
  constructor() {
    this.id = "ollama";
    this.label = "Ollama (local)";
    this.supportsReasoning = false;
    this.docsUrl = "https://github.com/ollama/ollama";
    this.apiStyle = "Ollama native (SDK)";
    this.defaultBaseUrl = "http://localhost:11434";
  }
  stream({ config, messages, signal, timeout }) {
    return this._stream({ config, messages, signal, timeout });
  }
  async *_stream(opts) {
    const { config, messages, signal, timeout = DEFAULT_TIMEOUT_MS } = opts;
    const { baseUrl = "http://localhost:11434", apiKey, model } = config;
    let host = baseUrl.trim().replace(/\/$/, "");
    if (apiKey) {
      host += `?auth=${encodeURIComponent(apiKey)}`;
    }
    const { Ollama } = await import(
      /* @vite-ignore */
      SDK_CDN
    );
    const client = new Ollama({ host, fetch: window.fetch.bind(window) });
    const numCtx = config.numCtx ?? DEFAULT_NUM_CTX;
    const chatPromise = client.chat({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      options: { num_ctx: numCtx }
    });
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Ollama request timed out after ${timeout}ms`)), timeout);
    });
    try {
      const stream = await Promise.race([chatPromise, timeoutPromise]);
      let pendingText = "";
      let usageEmitted = false;
      for await (const chunk of stream) {
        if (signal?.aborted) break;
        const message = chunk.message;
        const content = message?.content;
        if (content) {
          pendingText += content;
          yield textChunk(content);
        }
        if (!usageEmitted) {
          const evalCount = chunk.eval_count;
          const promptEvalCount = chunk.prompt_eval_count;
          if (evalCount !== void 0 || promptEvalCount !== void 0) {
            usageEmitted = true;
            yield usageChunk({
              inputTokens: promptEvalCount ?? 0,
              outputTokens: evalCount ?? 0
            });
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("timed out")) {
        throw err;
      }
      throw err;
    }
  }
};

// providers/lm-studio.ts
init_shims();
var LMStudioProvider = class extends OpenAICompatibleProvider {
  constructor() {
    super(...arguments);
    this.id = "lm-studio";
    this.label = "LM Studio (local)";
    this.supportsReasoning = false;
    this.docsUrl = "https://lmstudio.ai/docs";
    this.apiStyle = "OpenAI-compatible";
    this.defaultBaseUrl = "http://localhost:1234/v1";
  }
  /**
   * LM Studio does not support reasoning/thinking parameters,
   * so we always return null regardless of reasoning mode.
   */
  _buildReasoningParam(_reasoning, _model) {
    return null;
  }
};

// providers/groq.ts
init_shims();
var GroqProvider = class extends OpenAICompatibleProvider {
  constructor() {
    super(...arguments);
    this.id = "groq";
    this.label = "Groq";
    this.supportsReasoning = true;
    this.docsUrl = "https://console.groq.com/docs/api";
    this.apiStyle = "OpenAI-compatible";
    this.defaultBaseUrl = "https://api.groq.com/openai/v1";
  }
  _buildReasoningParam(reasoning, model) {
    if (!reasoning || reasoning.mode === "off") return null;
    const isOSeries = /^o[1-9]/i.test(model);
    if (isOSeries) {
      return null;
    }
    const isDeepSeekR1 = /deepseek-r1-distill-qwen/i.test(model) || /deepseek-r1-distill-llama/i.test(model);
    if (isDeepSeekR1) {
      return { reasoning_format: "parsed" };
    }
    return null;
  }
};

// providers/fireworks.ts
init_shims();
init_shared();
init_shared();
var FireworksProvider = class extends OpenAICompatibleProvider {
  constructor() {
    super(...arguments);
    this.id = "fireworks";
    this.label = "Fireworks AI";
    this.supportsReasoning = true;
    this.docsUrl = "https://docs.fireworks.ai/inference";
    this.apiStyle = "OpenAI-compatible (endpoint hardcoded in adapter)";
    this.defaultBaseUrl = "https://api.fireworks.ai/inference/v1";
  }
  stream(opts) {
    return this._fireworksStream(opts);
  }
  async *_fireworksStream(opts) {
    const { config, messages, reasoning, signal } = opts;
    const { apiKey, model } = config;
    const baseUrl = "https://api.fireworks.ai/inference/v1";
    const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
    const reasoningParam = this._buildReasoningParam(reasoning, model);
    const { init } = await buildOpenAIRequest({
      url,
      apiKey,
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: 0.3,
      reasoning: reasoningParam,
      stream: true,
      signal
    });
    const response = await fetch(url, { ...init, signal });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`${this.id} API error ${response.status}: ${errText || response.statusText}`);
    }
    let reasoningBuffer = "";
    let usageEmitted = false;
    for await (const obj of parseSSEStream(response)) {
      const chunk = obj;
      if (chunk.error) {
        const err = chunk.error;
        throw new Error(`${this.id} error: ${err.message ?? JSON.stringify(err)}`);
      }
      const choices = chunk.choices;
      if (!choices?.length) continue;
      const delta = choices[0].delta;
      const finishReason = choices[0].finish_reason;
      if (finishReason === "error") {
        throw new Error(`${this.id} stream error: ${JSON.stringify(chunk)}`);
      }
      if (delta && "reasoning_content" in delta && delta.reasoning_content) {
        const rc = String(delta.reasoning_content);
        reasoningBuffer += rc;
        yield reasoningChunk(rc);
      }
      if (delta?.content) {
        if (reasoningBuffer) {
          reasoningBuffer = "";
        }
        const rawText = String(delta.content);
        const cleanText = stripThinkingTags(rawText);
        if (cleanText) {
          yield textChunk(cleanText);
        }
      }
      if (!usageEmitted && chunk.usage) {
        usageEmitted = true;
        const u = chunk.usage;
        yield usageChunk({
          inputTokens: u.prompt_tokens || 0,
          outputTokens: u.completion_tokens || 0,
          cacheReadTokens: u.prompt_tokens_details?.cached_tokens || 0,
          reasoningTokens: u.completion_tokens_details?.reasoning_tokens || 0
        });
      }
    }
  }
  /**
   * Fireworks-specific reasoning param builder.
   * - DeepSeek R1 models: { thinking: { type: 'enabled' } }
   * - o1/o3 (server-side reasoning): null
   * - All others: null
   */
  _buildReasoningParam(reasoning, model) {
    if (!reasoning || reasoning.mode === "off") return null;
    const isOSeries = /^o[1-9]/i.test(model);
    if (isOSeries) return null;
    const isDeepSeekR1 = /deepseek[_-]?r1/i.test(model);
    if (isDeepSeekR1) {
      return { thinking: { type: "enabled" } };
    }
    return null;
  }
};

// providers/openai-native.ts
init_shims();
var OpenAINativeProvider = class extends OpenAICompatibleProvider {
  constructor() {
    super(...arguments);
    this.id = "openai";
    this.label = "OpenAI (direct)";
    this.docsUrl = "https://platform.openai.com/docs/api-reference/chat";
    this.apiStyle = "OpenAI chat completions";
    this.defaultBaseUrl = "https://api.openai.com/v1";
  }
  _buildReasoningParam(reasoning, model) {
    if (!reasoning || reasoning.mode === "off") return null;
    const isOSeries = /^o[1-9]/i.test(model);
    if (isOSeries) {
      return null;
    }
    const isDeepSeekR1 = /deepseek[_-]?r1/i.test(model);
    if (isDeepSeekR1) {
      return { thinking: { type: "enabled" } };
    }
    return null;
  }
};

// providers/vertex.ts
init_shims();
init_shared();
var VertexProvider = class {
  constructor() {
    this.id = "vertex";
    this.label = "Google Vertex AI";
    this.supportsReasoning = true;
    this.docsUrl = "https://cloud.google.com/vertex-ai/docs/generative-ai/model-reference";
    this.apiStyle = "Google Vertex AI (Gemini-style; needs Bearer access token)";
    this.defaultBaseUrl = "";
  }
  stream({ config, messages, reasoning, signal }) {
    return this._stream({ config, messages, reasoning, signal });
  }
  async *_stream(opts) {
    const { config, messages, reasoning, signal } = opts;
    const { apiKey, model } = config;
    const resourceMatch = model.match(
      /^projects\/([^/]+)\/locations\/([^/]+)\/publishers\/google\/models\/(.+)$/
    );
    if (!resourceMatch) {
      throw new Error(
        `${this.id}: model must be the full Vertex resource name 'projects/{project}/locations/{location}/publishers/google/models/{model}'. Got: '${model}'`
      );
    }
    const [, project, location, modelName] = resourceMatch;
    const baseUrl = `https://${location}-aiplatform.googleapis.com/v1beta1`;
    const body = this._buildBody(model, messages, reasoning);
    const authHeader = await this._getAuthHeader(apiKey);
    const url = `${baseUrl}/projects/${project}/locations/${location}/publishers/google/models/${modelName}:streamGenerateContent`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader
      },
      body: JSON.stringify(body),
      signal
    });
    if (!response.ok) {
      let errMessage = response.statusText;
      try {
        const errBody = await response.json();
        if (errBody?.error) {
          errMessage = `${errBody.error.status ?? response.status} ${errBody.error.message}`;
        }
      } catch {
      }
      throw new Error(`${this.id} API error ${response.status}: ${errMessage}`);
    }
    let reasoningBuffer = "";
    let usageEmitted = false;
    for await (const obj of parseSSEStream(response)) {
      const chunk = obj;
      if (chunk.error) {
        const err = chunk.error;
        throw new Error(`${this.id} error: ${err.message ?? JSON.stringify(err)}`);
      }
      const candidates = chunk.candidates;
      if (!candidates?.length) continue;
      const candidate = candidates[0];
      const content = candidate.content;
      if (!content) continue;
      const parts = content.parts;
      if (!parts?.length) continue;
      const part = parts[0];
      if (!usageEmitted && chunk.usageMetadata) {
        usageEmitted = true;
        const u = chunk.usageMetadata;
        yield usageChunk({
          // Vertex token counts live under different field names
          inputTokens: u.promptTokenCount || 0,
          outputTokens: u.candidatesTokenCount || 0,
          cacheReadTokens: u.promptTokensDetails?.cachedPromptTokenCount,
          reasoningTokens: u.thinkingMetadata?.thoughtsTokenCount
        });
      }
      if (part.thought) {
        const thoughtText = String(part.thought ?? "");
        reasoningBuffer += thoughtText;
        yield reasoningChunk(thoughtText);
      }
      if (part.text) {
        if (reasoningBuffer) {
          reasoningBuffer = "";
        }
        yield textChunk(String(part.text));
      }
    }
  }
  /** Build the Vertex API request body */
  _buildBody(model, messages, reasoning) {
    const contents = messages.map((msg) => this._toVertexContent(msg));
    const generationConfig = {
      temperature: 0.3
    };
    if (reasoning && reasoning.mode !== "off") {
      generationConfig.thinkingConfig = {
        thinkingBudget: reasoning.budgetTokens ?? 4096
      };
    }
    return {
      model,
      // full resource name
      contents,
      generationConfig,
      stream: true
    };
  }
  /** Convert a ZhangJing LlmMessage to Vertex content format */
  _toVertexContent(msg) {
    let role;
    switch (msg.role) {
      case "user":
        role = "user";
        break;
      case "assistant":
        role = "model";
        break;
      case "system":
        role = "user";
        break;
      default:
        role = "user";
    }
    return {
      role,
      parts: [{ text: msg.content }]
    };
  }
  /**
   * Build authorization headers from the configured apiKey.
   *
   * Browser note: gcloud CLI / service-account JSON are Node.js concepts.
   * For browser deployments, set apiKey to a plain Bearer access token
   * (from `gcloud auth print-access-token`) or configure a BFF proxy that
   * bridges the browser to Vertex AI with server-side credentials.
   */
  async _getAuthHeader(apiKey) {
    if (apiKey && !apiKey.startsWith("{")) {
      return { Authorization: `Bearer ${apiKey}` };
    }
    throw new Error(
      `${this.id}: Vertex AI in the browser requires a Bearer access token in the apiKey field. Run 'gcloud auth print-access-token' to obtain one, or set up an OAuth client / BFF proxy for production multi-user deployments.`
    );
  }
};

// providers/bedrock.ts
init_shims();
init_shared();
function detectModelFamily(model) {
  const m = model.toLowerCase();
  if (m.startsWith("anthropic.")) return "anthropic";
  if (m.includes("amazon.nova") || m.includes("nova")) return "nova";
  return "generic";
}
function buildAnthropicBody(opts) {
  const { messages, reasoning, maxTokens } = opts;
  const body = {
    messages: messages.map((m) => ({
      role: m.role === "system" ? "user" : m.role,
      // Bedrock Claude doesn't accept system role directly in messages
      content: m.content
    })),
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: maxTokens
  };
  if (reasoning && reasoning.mode !== "off") {
    const budgetTokens = reasoning.budgetTokens ?? 1024;
    body.thinking = {
      type: "enabled",
      budget_tokens: budgetTokens
    };
  }
  return body;
}
function buildNovaBody(opts) {
  const { messages, inferenceConfig } = opts;
  return {
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content
    })),
    inferenceConfig
  };
}
function buildGenericBody(opts) {
  const { messages, maxTokens } = opts;
  return {
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content
    })),
    max_tokens: maxTokens
  };
}
var BedrockProvider = class {
  constructor() {
    this.id = "bedrock";
    this.label = "AWS Bedrock";
    this.supportsReasoning = true;
    // Claude models on Bedrock support thinking
    this.docsUrl = "https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html";
    this.apiStyle = "AWS Bedrock invoke (needs gateway; SigV4 not implemented in-browser)";
    this.defaultBaseUrl = "";
  }
  stream({ config, messages, reasoning, signal, timeout }) {
    return this._stream({ config, messages, reasoning, signal, timeout });
  }
  async *_stream(opts) {
    const { config, messages, reasoning, signal, timeout } = opts;
    const { apiKey, model } = config;
    const cfg = config;
    const resolvedRegion = cfg.region || "us-east-1";
    const baseUrl = normalizeBaseUrl(config.baseUrl || `https://bedrock-runtime.${resolvedRegion}.amazonaws.com`);
    const family = detectModelFamily(model);
    const url = `${baseUrl}/${model}/invoke`;
    const maxTokens = reasoning?.budgetTokens ? reasoning.budgetTokens * 2 : 8192;
    let body;
    if (family === "anthropic") {
      body = buildAnthropicBody({ messages, reasoning, maxTokens });
    } else if (family === "nova") {
      body = buildNovaBody({
        messages,
        inferenceConfig: {
          maxTokens,
          temperature: 0.3
        }
      });
    } else {
      body = buildGenericBody({ messages, maxTokens });
    }
    const headers = {
      "Content-Type": "application/json",
      // For browser use: Bearer token auth via API Gateway in front of Bedrock.
      // Real AWS SigV4 signing (access key + secret key + session token) requires
      // server-side code and is NOT implemented here.
      Authorization: `Bearer ${apiKey}`
    };
    const fetchOpts = {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal
    };
    const response = await fetch(url, fetchOpts);
    if (!response.ok) {
      let errMessage = response.statusText;
      try {
        const errBody = await response.json();
        if (errBody.message) {
          errMessage = `${errBody.__type ?? "AWSError"}: ${errBody.message} (code: ${errBody.code})`;
        }
      } catch {
      }
      throw new Error(`${this.id} API error ${response.status}: ${errMessage}`);
    }
    for await (const obj of parseSSEStream(response)) {
      const event = obj;
      if (event.error) {
        const err = event.error;
        throw new Error(`${this.id} stream error: ${err.message ?? JSON.stringify(err)}`);
      }
      const chunk = event.chunk;
      if (!chunk) continue;
      const bytesStr = chunk.bytes;
      if (!bytesStr) continue;
      let innerObj;
      try {
        const decoded = atob(bytesStr);
        innerObj = JSON.parse(decoded);
      } catch {
        continue;
      }
      if (family === "anthropic") {
        const delta = innerObj.delta;
        const innerType = innerObj.type;
        if (innerType === "content_block_delta" && delta) {
          const deltaType = delta.type;
          if (deltaType === "thinking_delta") {
            yield reasoningChunk(String(delta.thinking ?? ""));
          } else if (deltaType === "text_delta") {
            yield textChunk(String(delta.text ?? ""));
          }
        }
        if (innerType === "message_delta") {
          const usage = innerObj.usage;
          if (usage) {
            yield usageChunk({
              inputTokens: usage.input_tokens || 0,
              outputTokens: usage.output_tokens || 0,
              reasoningTokens: usage.thinking_tokens || 0
            });
          }
        }
        continue;
      }
      if (family === "nova") {
        const token = innerObj.token;
        if (token?.text) {
          yield textChunk(String(token.text));
        }
        const usage = innerObj.usage;
        if (usage) {
          yield usageChunk({
            inputTokens: usage.inputTokens || 0,
            outputTokens: usage.outputTokens || 0
          });
        }
        continue;
      }
      const choices = innerObj.choices;
      if (choices?.length) {
        const delta = choices[0].delta;
        if (delta?.content) {
          yield textChunk(String(delta.content));
        }
      }
    }
  }
  async complete(opts) {
    const { config, messages, reasoning, signal, timeout } = opts;
    const { content, reasoning: rawReasoning } = await collectStream(
      this.stream({ config, messages, reasoning, signal, timeout })
    );
    return {
      content,
      reasoning: rawReasoning || null,
      provider: this.id
    };
  }
};

// providers/gemini.ts
init_shims();
init_shared();
var GeminiProvider = class {
  constructor() {
    this.id = "gemini";
    this.label = "Google AI (AI Studio)";
    this.supportsReasoning = true;
    this.docsUrl = "https://ai.google.dev/api/generate-content";
    this.apiStyle = "Google Gemini generateContent (SSE)";
    this.defaultBaseUrl = "https://generativelanguage.googleapis.com/v1beta";
  }
  async *stream({ config, messages, reasoning, signal }) {
    const { baseUrl, apiKey, model } = config;
    const modelName = model || "gemini-2.0-flash";
    const key = apiKey;
    let base = baseUrl;
    if (!base) {
      base = "https://generativelanguage.googleapis.com/v1beta";
    }
    const url = `${base}/models/${modelName}:streamGenerateContent?key=${key}&alt=sse`;
    const contents = this._convertMessages(messages);
    const body = {
      contents,
      generationConfig: {
        temperature: 0.3,
        topP: 0.95
      },
      stream: true
    };
    if (reasoning?.mode !== "off") {
      const budget = reasoning?.budgetTokens ?? 4096;
      body.thinkingConfig = { thinkingBudget: budget };
    }
    const init = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal
    };
    const response = await fetch(url, init);
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`${this.id} API error ${response.status}: ${errText || response.statusText}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error(`${this.id}: response body is not readable`);
    const decoder = new TextDecoder();
    let buffer = "";
    let usageEmitted = false;
    try {
      while (true) {
        if (signal?.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          try {
            const chunk = JSON.parse(trimmed.slice(6));
            const candidates = chunk.candidates;
            const content = candidates?.[0]?.content;
            const parts = content?.parts;
            if (!parts) continue;
            for (const part of parts) {
              if (part.text) {
                yield textChunk(String(part.text));
              }
              if ("thought" in part && part.thought === true) {
                if (part.text) yield reasoningChunk(String(part.text));
              }
            }
            if (!usageEmitted && chunk.usageMetadata) {
              usageEmitted = true;
              const u = chunk.usageMetadata;
              yield usageChunk({
                inputTokens: u.promptTokenCount || 0,
                outputTokens: u.candidatesTokenCount || 0,
                cacheReadTokens: u.cachedContentTokenCount || 0,
                reasoningTokens: u.thoughtsTokenCount || 0
              });
            }
          } catch {
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
  async complete({ config, messages, reasoning, signal }) {
    const stream = this.stream({ config, messages, reasoning, signal });
    const contentParts = [];
    const reasoningParts = [];
    for await (const chunk of stream) {
      if (chunk.type === "text") contentParts.push(chunk.text);
      if (chunk.type === "reasoning") reasoningParts.push(chunk.reasoning);
    }
    return {
      content: contentParts.join(""),
      reasoning: reasoningParts.join("") || null,
      provider: this.id
    };
  }
  _convertMessages(messages) {
    const result = [];
    for (const msg of messages) {
      if (msg.role === "system") {
        result.push({ role: "user", parts: [{ text: `[System] ${msg.content}` }] });
      } else {
        result.push({
          role: msg.role === "assistant" ? "model" : msg.role,
          parts: [{ text: msg.content }]
        });
      }
    }
    return result;
  }
};

// providers/mistral.ts
init_shims();
var MistralProvider = class extends OpenAICompatibleProvider {
  constructor() {
    super(...arguments);
    this.id = "mistral";
    this.label = "Mistral";
    this.supportsReasoning = false;
    this.docsUrl = "https://docs.mistral.ai/api/api-reference/chat";
    this.apiStyle = "OpenAI-compatible";
    this.defaultBaseUrl = "https://api.mistral.ai/v1";
  }
  /**
   * Mistral has no native reasoning/thinking support.
   * Always returns null regardless of reasoning spec.
   */
  _buildReasoningParam(_reasoning, _model) {
    return null;
  }
};

// providers/moonshot.ts
init_shims();
var MoonshotProvider = class extends OpenAICompatibleProvider {
  constructor() {
    super(...arguments);
    this.id = "moonshot";
    this.label = "Moonshot (Kimi)";
    this.supportsReasoning = false;
    this.docsUrl = "https://platform.moonshot.cn/docs/api/chat";
    this.apiStyle = "OpenAI-compatible";
    this.defaultBaseUrl = "https://api.moonshot.cn/v1";
  }
  /**
   * Moonshot has no native reasoning/thinking support.
   * Always return null regardless of reasoning mode.
   */
  _buildReasoningParam(_reasoning, _model) {
    return null;
  }
};

// providers/xai.ts
init_shims();
var XAIProvider = class extends OpenAICompatibleProvider {
  constructor() {
    super(...arguments);
    this.id = "xai";
    this.label = "xAI (Grok)";
    this.supportsReasoning = true;
    this.docsUrl = "https://docs.x.ai";
    this.apiStyle = "OpenAI-compatible";
    this.defaultBaseUrl = "https://api.x.ai/v1";
  }
  _buildReasoningParam(reasoning, model) {
    if (!reasoning || reasoning.mode === "off") return null;
    const isGrokReasoner = /grok-3/i.test(model) || /grok[_-]?(reasoner|thinking)/i.test(model);
    if (isGrokReasoner) {
      return { thinking: { type: "enabled" } };
    }
    return null;
  }
};

// providers/sambanova.ts
init_shims();
var SambaNovaProvider = class extends OpenAICompatibleProvider {
  constructor() {
    super(...arguments);
    this.id = "sambanova";
    this.label = "SambaNova";
    this.supportsReasoning = true;
    this.docsUrl = "https://docs.sambanova.ai";
    this.apiStyle = "OpenAI-compatible";
    this.defaultBaseUrl = "https://api.sambanova.ai/v1";
  }
  _buildReasoningParam(reasoning, model) {
    if (!reasoning || reasoning.mode === "off") return null;
    const isDeepSeekR1 = /deepseek[_-]?r1/i.test(model);
    if (isDeepSeekR1) {
      return { thinking: { type: "enabled" } };
    }
    return null;
  }
};

// providers/vercel-ai-gateway.ts
init_shims();
var VercelAIGatewayProvider = class extends OpenAICompatibleProvider {
  constructor() {
    super(...arguments);
    this.id = "vercel-ai-gateway";
    this.label = "Vercel AI Gateway";
    this.supportsReasoning = true;
    this.docsUrl = "https://vercel.com/docs/ai";
    this.apiStyle = "OpenAI-compatible";
    this.defaultBaseUrl = "https://ai-gateway.vercel.sh/v1";
  }
  // Vercel AI Gateway passes through reasoning params to the upstream provider.
  // We inherit the base class _buildReasoningParam which handles DeepSeek R1,
  // o1/o3 detection automatically.
};

// providers/together.ts
init_shims();
var TogetherProvider = class extends OpenAICompatibleProvider {
  constructor() {
    super(...arguments);
    this.id = "together";
    this.label = "Together AI";
    this.supportsReasoning = true;
    this.docsUrl = "https://docs.together.ai/docs";
    this.apiStyle = "OpenAI-compatible (endpoint hardcoded in adapter)";
    this.defaultBaseUrl = "https://api.together.xyz/v1";
  }
  stream(opts) {
    return this._togetherStream(opts);
  }
  async *_togetherStream(opts) {
    const baseUrl = "https://api.together.xyz/v1";
    const url = `${baseUrl}/chat/completions`;
    const { config, messages, reasoning, signal } = opts;
    const { apiKey, model } = config;
    const reasoningParam = this._buildReasoningParam(reasoning, model);
    const body = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.3,
      ...reasoningParam && { reasoning: reasoningParam }
    };
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`${this.id} API error ${response.status}: ${errText || response.statusText}`);
    }
    const { parseSSEStream: parseSSEStream2, textChunk: textChunk2, reasoningChunk: reasoningChunk2, usageChunk: usageChunk2 } = await Promise.resolve().then(() => (init_shared(), shared_exports));
    let reasoningBuffer = "";
    let usageEmitted = false;
    for await (const obj of parseSSEStream2(response)) {
      const chunk = obj;
      if (chunk.error) {
        const err = chunk.error;
        throw new Error(`${this.id} error: ${err.message ?? JSON.stringify(err)}`);
      }
      const choices = chunk.choices;
      if (!choices?.length) continue;
      const delta = choices[0].delta;
      const finishReason = choices[0].finish_reason;
      if (finishReason === "error") {
        throw new Error(`${this.id} stream error: ${JSON.stringify(chunk)}`);
      }
      if (delta && "reasoning_content" in delta && delta.reasoning_content) {
        const rc = String(delta.reasoning_content);
        reasoningBuffer += rc;
        yield reasoningChunk2(rc);
      }
      if (delta?.content) {
        if (reasoningBuffer) {
          reasoningBuffer = "";
        }
        yield textChunk2(String(delta.content));
      }
      if (!usageEmitted && chunk.usage) {
        usageEmitted = true;
        const u = chunk.usage;
        yield usageChunk2({
          inputTokens: u.prompt_tokens || 0,
          outputTokens: u.completion_tokens || 0,
          cacheReadTokens: u.prompt_tokens_details?.cached_tokens || 0,
          reasoningTokens: u.completion_tokens_details?.reasoning_tokens || 0
        });
      }
    }
  }
  /**
   * Together AI reasoning param builder.
   * - DeepSeek R1 models: { thinking: { type: 'enabled' } }
   * - o1/o3 (server-side reasoning): null
   * - All others: null
   */
  _buildReasoningParam(reasoning, model) {
    if (!reasoning || reasoning.mode === "off") return null;
    const isOSeries = /^o[1-9]/i.test(model);
    if (isOSeries) return null;
    const isDeepSeekR1 = /deepseek[_-]?r1/i.test(model);
    if (isDeepSeekR1) {
      return { thinking: { type: "enabled" } };
    }
    return null;
  }
};

// providers/hyperbolic.ts
init_shims();
init_shared();
var HyperbolicProvider = class {
  constructor() {
    this.id = "hyperbolic";
    this.label = "Hyperbolic";
    this.supportsReasoning = true;
    this.docsUrl = "https://docs.hyperbolic.xyz/docs/api-reference/chat";
    this.apiStyle = "OpenAI-compatible";
    this.defaultBaseUrl = "https://api.hyperbolic.xyz/v1";
  }
  stream({ config, messages, reasoning, signal }) {
    return this._stream({ config, messages, reasoning, signal });
  }
  async *_stream(opts) {
    const { config, messages, reasoning, signal } = opts;
    const { baseUrl, apiKey, model } = config;
    const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
    const reasoningParam = this._buildReasoningParam(reasoning, model);
    const { init } = await buildOpenAIRequest({
      url,
      apiKey,
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: 0.3,
      reasoning: reasoningParam,
      stream: true,
      signal
    });
    const response = await fetch(url, { ...init, signal });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`${this.id} API error ${response.status}: ${errText || response.statusText}`);
    }
    let reasoningBuffer = "";
    let usageEmitted = false;
    for await (const obj of parseSSEStream(response)) {
      const chunk = obj;
      if (chunk.error) {
        const err = chunk.error;
        throw new Error(`${this.id} error: ${err.message ?? JSON.stringify(err)}`);
      }
      const choices = chunk.choices;
      if (!choices?.length) continue;
      const delta = choices[0].delta;
      const finishReason = choices[0].finish_reason;
      if (finishReason === "error") {
        throw new Error(`${this.id} stream error: ${JSON.stringify(chunk)}`);
      }
      if (delta && "reasoning_content" in delta && delta.reasoning_content) {
        const rc = String(delta.reasoning_content);
        reasoningBuffer += rc;
        yield reasoningChunk(rc);
      }
      if (delta?.content) {
        if (reasoningBuffer) {
          reasoningBuffer = "";
        }
        yield textChunk(String(delta.content));
      }
      if (!usageEmitted && chunk.usage) {
        usageEmitted = true;
        const u = chunk.usage;
        yield usageChunk({
          inputTokens: u.prompt_tokens || 0,
          outputTokens: u.completion_tokens || 0,
          cacheReadTokens: u.prompt_tokens_details?.cached_tokens || 0,
          reasoningTokens: u.completion_tokens_details?.reasoning_tokens || 0
        });
      }
    }
  }
  /** Determine the reasoning param based on model name */
  _buildReasoningParam(reasoning, model) {
    if (!reasoning || reasoning.mode === "off") return null;
    const isDeepSeekR1 = /deepseek[_-]?r1/i.test(model) || /deepseek[_-]?reasoner/i.test(model);
    if (isDeepSeekR1) {
      return { thinking: { type: "enabled" } };
    }
    return null;
  }
};

// providers/zai.ts
init_shims();
init_shared();
var DEFAULT_BASE_URL = "https://api.z.ai/api/paas/v4";
var THINKING_MODEL_RE = /^glm-(4\.[5-9]|[5-9])/i;
var ZaiProvider = class {
  constructor() {
    this.id = "zai";
    this.label = "Z.ai (GLM)";
    this.supportsReasoning = true;
    this.docsUrl = "https://docs.z.ai/api-reference/introduction";
    this.apiStyle = "OpenAI-compatible (thinking param)";
    this.defaultBaseUrl = "https://api.z.ai/api/paas/v4";
  }
  /**
   * Hybrid GLM models default thinking ON server-side; make every app
   * reasoning mode explicit so translations are deterministic.
   * Non-hybrid models (glm-4.x, non-GLM names): no thinking param,
   * except an explicit force.
   */
  thinkingParam(model, reasoning) {
    if (!THINKING_MODEL_RE.test(model)) {
      return reasoning?.mode === "force" ? { thinking: { type: "enabled" } } : {};
    }
    if (reasoning?.mode === "off") {
      return { thinking: { type: "disabled" } };
    }
    return { thinking: { type: "enabled" } };
  }
  async *stream({ config, messages, reasoning, signal }) {
    const { apiKey, model } = config;
    const baseUrl = config.baseUrl?.trim() || DEFAULT_BASE_URL;
    const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
    const body = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.3,
      ...this.thinkingParam(model, reasoning)
    };
    const init = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal
    };
    const response = await fetch(url, init);
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`${this.id} API error ${response.status}: ${errText || response.statusText}`);
    }
    let usageEmitted = false;
    for await (const obj of parseSSEStream(response)) {
      const chunk = obj;
      if (chunk.error) {
        throw new Error(`${this.id} error: ${chunk.error.message ?? JSON.stringify(chunk.error)}`);
      }
      const choices = chunk.choices;
      if (!choices?.length) continue;
      const delta = choices[0].delta;
      if (delta && "reasoning_content" in delta && delta.reasoning_content) {
        yield reasoningChunk(String(delta.reasoning_content));
      }
      if (delta?.content) {
        yield textChunk(String(delta.content));
      }
      if (!usageEmitted && chunk.usage) {
        usageEmitted = true;
        const u = chunk.usage;
        yield usageChunk({
          inputTokens: u.prompt_tokens || 0,
          outputTokens: u.completion_tokens || 0
        });
      }
    }
  }
  async complete({ config, messages, reasoning, signal }) {
    const { apiKey, model } = config;
    const baseUrl = config.baseUrl?.trim() || DEFAULT_BASE_URL;
    const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
    const body = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
      temperature: 0.3,
      ...this.thinkingParam(model, reasoning)
    };
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`${this.id} API error ${response.status}: ${errText || response.statusText}`);
    }
    const data = await response.json();
    const message = data.choices?.[0]?.message;
    return {
      content: String(message?.content || ""),
      reasoning: message?.reasoning_content || null,
      provider: this.id
    };
  }
};

// providers/registry.ts
var _providers = /* @__PURE__ */ new Map();
function register(p) {
  _providers.set(p.id, p);
}
register(new OpenAICompatibleProvider());
register(new MiniMaxProvider());
register(new DeepSeekProvider());
register(new AnthropicProvider());
register(new OpenRouterProvider());
register(new OllamaProvider());
register(new LMStudioProvider());
register(new GroqProvider());
register(new FireworksProvider());
register(new OpenAINativeProvider());
register(new VertexProvider());
register(new BedrockProvider());
register(new GeminiProvider());
register(new MistralProvider());
register(new MoonshotProvider());
register(new XAIProvider());
register(new SambaNovaProvider());
register(new VercelAIGatewayProvider());
register(new TogetherProvider());
register(new HyperbolicProvider());
register(new ZaiProvider());
function listProviders() {
  return Array.from(_providers.values()).map((p) => ({
    id: p.id,
    label: p.label,
    supportsReasoning: p.supportsReasoning,
    docsUrl: p.docsUrl,
    apiStyle: p.apiStyle,
    defaultBaseUrl: p.defaultBaseUrl
  }));
}
function resolveProvider(config) {
  const p = _providers.get(config.provider);
  if (p) return p;
  const fallback = _providers.get("openai-compatible");
  if (!fallback) throw new Error("No provider found and no fallback available");
  return fallback;
}

// providers/callLlm.ts
async function callLlm(opts) {
  const { timeout = 6e4, ...rest } = opts;
  const config = opts.config;
  const messages = opts.messages;
  const reasoning = opts.reasoning ?? { mode: "auto" };
  const signal = opts.signal;
  const provider = resolveProvider(config);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  const effectiveSignal = signal ? (() => {
    const s = new AbortController();
    signal.addEventListener("abort", () => s.abort());
    return s.signal;
  })() : controller.signal;
  try {
    const stream = provider.stream({ config, messages, reasoning, signal: effectiveSignal });
    const result = await collectStream2(stream);
    return {
      content: result.content,
      reasoning: result.reasoning || null,
      provider: provider.id
    };
  } finally {
    clearTimeout(timeoutId);
    controller.abort();
  }
}
async function* streamLlm(opts) {
  const provider = resolveProvider(opts.config);
  yield* provider.stream(opts);
}
async function collectStream2(stream) {
  const contentParts = [];
  const reasoningParts = [];
  for await (const chunk of stream) {
    switch (chunk.type) {
      case "text":
        if (chunk.text) contentParts.push(chunk.text);
        break;
      case "reasoning":
        if (chunk.reasoning) reasoningParts.push(chunk.reasoning);
        break;
    }
  }
  return {
    content: contentParts.join(""),
    reasoning: reasoningParts.join("")
  };
}
export {
  callLlm,
  listProviders,
  resolveProvider,
  streamLlm
};
//# sourceMappingURL=providers.bundle.js.map
