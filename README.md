# ZhangJing (张京)

> A bring-your-own-LLM translation workbench — privacy-first, runs entirely in your browser.

ZhangJing replicates the most-loved features of proprietary translator applications (selectable alternatives, polite form options, definitions pane) while letting you plug in your own LLM API keys. All LLM credentials stay in your browser local storage.

## Features

- **Custom LLM Backend** — Use any OpenAI-compatible API provider (OpenAI, DeepSeek, Ollama, Groq, Together AI, LM Studio, etc.)
- **Separate TTS LLM** — Configure a dedicated text-to-speech model, or fall back to Browser TTS
- **Politeness Control** — Select Casual, Polite, Formal (Respectful), or Humble form for Japanese and Korean
- **Alternative Translations** — Get 4 distinct alternative translations, click to apply any one
- **Definitions Pane** — Highlight any word in the output to look it up via the configured LLM
- **Quick LLM Switching** — Save up to 5 presets per LLM type, switch instantly via dropdown
- **Config stored in localStorage** — No server, no accounts, fully self-contained

## How to Run

Open `index.html` in any modern browser (Chrome, Firefox, Safari, Edge). No build step, no server required.

### First Run

1. Click the **Config** button (bottom-right)
2. Under **Translation LLM**, enter your API credentials (provider, base URL, API key, model)
3. Optionally configure a **TTS LLM** for audio generation
4. Set **Politeness** preference for Japanese/Korean
5. Click **Save**

## Supported Languages

English, Chinese (Simplified), Japanese, Korean, French, German, Spanish, Italian, Portuguese, Russian, Arabic, Hindi, Thai, Vietnamese, Indonesian — plus Auto-detect.

## Tech Stack

- Vanilla JavaScript (ES modules via CDN)
- Bootstrap 5.3 (UI components)
- Vue.js 3 (reactive state)
- Phosphor Icons

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Enter` / `Cmd+Enter` | Translate |
| `Escape` | Close config modal |

## License

MIT
