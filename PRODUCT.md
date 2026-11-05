# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user: k_sze, daily-driver translation workbench for his own multilingual reading/writing (EN ↔ zh/ja/ko focus among 15 supported languages). Personal tool first; the codebase is nonetheless kept polished for public release as OSS, where the secondary audience is self-hosters who want a translator without surrendering text to a hosted service.

## Product Purpose

ZhangJing (张京) is a bring-your-own-LLM translation workbench that runs entirely in the browser with no server. It replicates the most-loved affordances of proprietary desktop translators — selectable alternative translations, politeness/formality control (Casual/Polite/Formal/Humble for Japanese and Korean), and a definitions pane for highlighted words — while routing every LLM call through the user's own API keys. Success means a professional desktop-tool feel that happens to run in a browser, with credentials that never leave localStorage.

## Positioning

A proprietary translator cannot truthfully claim "your source text and API keys never leave your browser"; a plain LLM chat wrapper lacks the translation-workbench affordances (alternatives chips, politeness forms, word-lookup pane, TTS with download). ZhangJing's claim is owning both halves at once: desktop-translator feature set + fully client-side BYO-key architecture.

## Operating Context

- Runs by opening `index.html` directly; no build step for the main app (CDN deps: Vue 3, Bootstrap 5.3, Phosphor Icons, Google Fonts).
- Provider adapters in `providers/*.ts` are compiled by esbuild (`build-providers.mjs`) to `dist/providers.bundle.js`.
- User must supply their own OpenAI-compatible (or native) API credentials; first run auto-opens the config modal.
- Config lives in `localStorage` under `zj_config`; presets under `zj_presets` (up to 5 per LLM type).
- Keyboard: `Ctrl/Cmd+Enter` translate, `Escape` close config.

## Capabilities and Constraints

- 15 languages + auto-detect (en, zh, ja, ko, fr, de, es, it, pt, ru, ar, hi, th, vi, id).
- 4 alternative translations per request, click-to-apply chips.
- Politeness control for Japanese/Korean output.
- Definitions pane: highlight a word in the output to look it up via the configured LLM.
- TTS via a dedicated LLM preset or browser TTS fallback; MP3 download with timestamped filename.
- 24 provider adapters (OpenAI-compatible, native OpenAI, Anthropic, Gemini, Vertex, Bedrock, Ollama, DeepSeek, Groq, Mistral, Moonshot, MiniMax, xAI, OpenRouter, Together, Fireworks, SambaNova, Hyperbolic, LM Studio, Vercel AI Gateway, and more).
- Constraints: CDN-only dependencies for the main app; single-file architecture (`index.html`); no backend of any kind; user edits to output are preserved (warned on overwrite).
- Deliberately undecided / next planned feature (NEXT_STEPS.md): click-inside-translation to get LLM alternatives for a contiguous token unit around the caret, or for the span of units a selection crosses; structured-JSON response shape (default translation + alternatives) under consideration. Not yet designed or committed.

## Brand Commitments

- Name: ZhangJing (张京) — corrected Chinese spelling per commit history; do not reintroduce variants.
- Logo motif: small camphor tree SVG icon beside the wordmark (SPEC §5).
- License: MIT.
- Design direction explicitly NOT binding: SPEC.md §2's aesthetic (warm-gray light theme, `#2B5797` blue, Source Sans 3 / Noto Sans SC / JetBrains Mono) is a first draft the user is open to replacing — treat as incumbent evidence, not a commitment.

## Evidence on Hand

- Working implementation: `index.html` (~70KB single-file SPA), provider bundle in `dist/`.
- `SPEC.md` — original concept, layout, component inventory, design-language draft.
- `README.md` — feature list, run instructions.
- `NEXT_STEPS.md` — the user's own written brief for the next feature.
- No testimonials, user counts, benchmarks, or press exist — future work must not fabricate any.

## Product Principles

1. Privacy is architecture, not a policy: every feature must work with credentials that never leave the browser and no server in the path.
2. Desktop-translator depth over chat-wrapper simplicity: alternatives, politeness, and word lookup are the product, not conveniences.
3. Zero-setup operation: opening a file must remain a complete install; no accounts, no sync, no backend.
4. The user's text is theirs: output stays editable, edits are preserved, and re-translation warns before overwriting.
5. Polished enough to publish: personal tool first, but nothing shipped should embarrass a public OSS release.
