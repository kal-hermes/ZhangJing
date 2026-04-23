# ZhangJing — Bring-Your-Own-LLM Translator

## 1. Concept & Vision

ZhangJing (樟京, "Camphor Tree of the Capital") is a self-hosted, privacy-first translation workbench that lets you plug in your own LLM API keys. It replicates DeepL Desktop's most-loved features — selectable alternatives, polite form options, and a definitions pane — while giving users full control over which AI providers power translation and TTS. It feels like a professional desktop tool that happens to run in a browser.

## 2. Design Language

**Aesthetic direction:** Refined utility — clean, structured, with subtle depth. Inspired by professional translation tools (MemoQ, Trados) but modernized. Light theme with warm gray surfaces.

**Color palette:**
- Background: `#F7F6F3` (warm off-white)
- Surface/Cards: `#FFFFFF`
- Primary: `#2B5797` (deep professional blue)
- Primary hover: `#1E3F6F`
- Accent: `#E8913A` (warm amber for active states, highlights)
- Text primary: `#1A1A1A`
- Text secondary: `#6B6B6B`
- Border: `#DEDDD8`
- Success: `#2D7D46`
- Error: `#C0392B`
- Code/mono: `#2D3748`

**Typography:**
- UI: `"Source Sans 3"` (Google Fonts) — clean, professional, excellent i18n coverage
- Headings: `"Noto Sans SC"` for CJK-aware headings
- Monospace: `"JetBrains Mono"` for code snippets / JSON

**Spatial system:** 8px base grid. Cards with `border-radius: 8px`, `box-shadow: 0 1px 4px rgba(0,0,0,0.08)`. Generous padding (24px panels).

**Motion philosophy:**
- Transitions: `200ms ease-out` for interactive states
- Panel expand/collapse: `300ms ease-in-out`
- Button press: `transform: scale(0.97)` on active
- No gratuitous animation — motion communicates state changes only

**Visual assets:**
- Icons: Phosphor Icons via CDN (consistent, clean)
- No external images needed

## 3. Layout & Structure

**Single-page app, desktop-first (min-width: 1024px, responsive down to 768px)**

```
┌─────────────────────────────────────────────────────────────┐
│  Header: Logo | Lang selectors + swap | Quick LLM selectors  │
├────────────────────────┬────────────────────────────────────┤
│                        │                                     │
│   INPUT PANE           │   OUTPUT PANE                        │
│   (textarea)          │   (editable div)                    │
│                        │   [Copy] [TTS] [Download] [Suggest]  │
│                        │                                     │
├────────────────────────┴────────────────────────────────────┤
│  ALTERNATIVES BAR: clickable chips for alternative translations│
├─────────────────────────────────────────────────────────────┤
│  DEFINITIONS PANE: word lookup results appear here           │
└─────────────────────────────────────────────────────────────┘
│  Footer: Config button → modal                                │
```

- Header: fixed height 64px, contains branding + all controls
- Main area: flex row, input/output side by side, resizable feel via CSS
- Alternatives bar: collapsible, appears when suggestions are available
- Definitions pane: collapsible, fixed 220px height when open
- Config modal: centered overlay, 560px wide

**Responsive (768-1024px):** Stacked layout — input above output

## 4. Features & Interactions

### 4.1 Language Selection
- Two dropdowns: source language, target language
- Swap button between them (animated 180° rotation on click)
- 15 languages supported initially (see §7)
- Changing language pair clears both panes and hides alternatives/definitions

### 4.2 Translation Input
- Large textarea, auto-resizes with content (min 200px, max 60vh)
- Character count shown bottom-right
- `Ctrl+Enter` or `Cmd+Enter` triggers translation
- Placeholder text: "Enter text to translate..."
- Debounce auto-translate: 1200ms after typing stops (optional, can be disabled in config)

### 4.3 Translation Output
- Editable `contenteditable` div (not a textarea — allows mixed selection)
- Preserves line breaks from input
- User edits are preserved even after re-translation (warned on overwrite)
- "Copy" button: copies plain text to clipboard, shows brief "Copied!" toast
- "TTS" button: plays TTS via configured TTS LLM, button shows spinner while processing
- "Download" button: downloads TTS audio as MP3 file
- "Suggest Alternatives" button: requests alternative translations from the same LLM

### 4.4 Alternative Translations
- Appear as a horizontal scrollable row of chips below the output pane
- Each chip is clickable — clicking it replaces the output with that alternative
- Tooltip on hover shows which portion of text the alternative applies to
- "Apply" / "Cancel" implicit — clicking an alternative immediately applies it
- Loading state: animated shimmer placeholders

### 4.5 Definitions Pane
- Triggered by selecting/highlighting text in the output pane
- On `mouseup`/`touchend` in output, if a word is selected:
  - Def pane slides open (if collapsed)
  - Shows: word, reading (if applicable), part of speech, definitions list
  - For Japanese/Korean: also shows polite/casual form info
  - If no dictionary entry found: "No definition found for '[word]'"
- Close button (×) collapses pane

### 4.6 Config Modal
- Opens via "Config" gear button in footer
- Sections:
  1. **Translation LLM**: provider (OpenAI-compatible dropdown), base URL, API key, model name
  2. **TTS LLM**: provider dropdown, base URL, API key, model name
  3. **Formality/Politeness**: toggle for Japanese/Korean — Casual / Polite / Formal (Respectful) / Humble
  4. **Auto-translate**: enable/disable debounced auto-translate
  5. **Definitions**: free-form dictionary API URL (optional, for future)
- "Save" persists to `localStorage`
- "Cancel" discards changes
- On first load, if no config in localStorage, modal auto-opens

### 4.7 LLM Quick Switchers
- Two dropdowns in the header: one for translation LLM preset, one for TTS LLM preset
- Presets are named configurations (e.g., "OpenAI GPT-4o", "DeepSeek Chat", "Local Ollama")
- User can save up to 5 presets per LLM type in config
- Switching preset instantly updates the active config (no save needed)

### 4.8 TTS Audio
- TTS request sent to configured TTS LLM with output text
- Audio returned as MP3/OGG (format depends on provider, prefer MP3)
- Download button saves to file with timestamp name: `zhangjing_tts_20260423_143022.mp3`
- If TTS LLM is not configured, button is disabled with tooltip explaining why

### 4.9 Error Handling
- API errors shown as dismissable banner above output pane (red background)
- Network timeout after 60s — shows timeout message
- Empty input → subtle shake animation on input pane, no API call
- LLM response too long → truncate and show "... (truncated)" indicator

## 5. Component Inventory

### Header
- Logo: "ZhangJing" in Noto Sans SC + small camphor tree SVG icon
- Source/target language dropdowns: `<select>` styled with Bootstrap
- Swap button: Phosphor `ArrowsLeftRight` icon, 180° rotation animation on click
- Translation LLM dropdown: compact `<select>` showing preset names
- TTS LLM dropdown: same
- States: default, loading (spinner on LLM dropdowns when API call in progress)

### Input Pane Card
- Bootstrap card with textarea inside
- Character count badge bottom-right
- States: empty (placeholder), filled, error (red border)

### Output Pane Card
- Bootstrap card with contenteditable div
- Action toolbar: Copy | TTS | Download | Suggest Alternatives
- Each button: icon + label, states: default, hover, active (spinner), disabled
- States: empty (placeholder), filled, user-edited (italic indicator), loading

### Alternatives Bar
- Horizontal scroll container
- Each alternative chip: rounded pill, Bootstrap `btn-outline-primary` style
- States: default, hover (filled), active (applied — checkmark icon)

### Definitions Pane
- Collapsible panel, Bootstrap `accordion` style
- Word header: large bold
- Reading: italic, secondary color
- POS badge: small label
- Definition list: numbered
- Empty state: muted text
- States: collapsed (0 height), expanded, loading (skeleton)

### Config Modal
- Bootstrap modal
- Tabbed sections (Translation LLM | TTS LLM | Politeness | General)
- Form fields: provider dropdown, base URL input, API key input (password type), model name input
- Politeness: radio group or segmented button for form levels
- States: clean, dirty (unsaved changes indicator)

### Toast Notifications
- Fixed bottom-right stack
- Bootstrap toast component
- Types: success (green), error (red), info (blue)
- Auto-dismiss after 3s

## 6. Technical Approach

**Single HTML file with embedded TypeScript (compiled in-browser via esbuild CDN for development, or pre-built for production)**

Wait — user said CDN-based, so we'll use:

**Architecture: Single HTML file with `<script type="module">` using CDN-loaded ES modules**

Since TypeScript can't run directly from CDN without a build step, we'll use:
- **Main app**: Plain JavaScript with JSDoc type annotations (close enough to TypeScript safety)
- **Or**: Use [Babel standalone](https://babeljs.io/docs/babel-standalone) to transpile TypeScript in-browser — adds load cost but preserves type safety in source

**Decision:** Use **plain JavaScript with JSDoc** to keep it simple and CDN-only. TypeScript syntax in comments for documentation. No build step required.

**Key libraries (all CDN):**
- Bootstrap 5.3: UI components, grid, cards, modal, forms
- Vue.js 3: reactive state management
- Phosphor Icons: icon set
- [browser-image-compression](https://www.npmjs.com/package/browser-image-compression): not needed here
- [SortableJS](https://sortablejs.github.io/Sortable/): not needed
- For TTS audio playback: native `HTMLAudioElement`
- For TTS download: native `URL.createObjectURL(blob)`

**LLM API calls:**
- All LLM calls via `fetch()` to OpenAI-compatible `/v1/chat/completions` endpoint
- Config stored as JSON in `localStorage` under key `zj_config`
- Presets stored under key `zj_presets`
- State managed via Vue 3 `reactive()` / `ref()`

**No backend required** — all computation happens client-side, API calls go directly from browser to LLM providers.

## 7. Supported Languages

| Code | Name |
|------|------|
| en | English |
| zh | Chinese (Simplified) |
| ja | Japanese |
| ko | Korean |
| fr | French |
| de | German |
| es | Spanish |
| it | Italian |
| pt | Portuguese |
| ru | Russian |
| ar | Arabic |
| hi | Hindi |
| th | Thai |
| vi | Vietnamese |
| id | Indonesian |

## 8. File Structure

```
ZhangJing/
├── index.html          # Complete SPA
├── SPEC.md             # This file
└── README.md           # Basic run instructions
```
