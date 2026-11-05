# Brief: Click-for-partial-alternatives popup

> Confirmed design brief (impeccable `shape`, 2026-11-02). Shape output — no code yet.
> Supersedes the corresponding ideas in NEXT_STEPS.md for this feature; output-pane restructure is explicitly out of scope.

## Job & audience

k_sze refining a fresh LLM translation segment-by-segment — fixing an idiom choice or a phrase without re-translating the whole sentence. Operate mode: precision and predictability over expression.

## Interaction thesis

One popup, two triggers, one deliberate gate:

- **Bare click** inside the output pane → popup anchored at the caret. The client cannot know the semantic unit (厚颜无耻 is an idiom, not a character run), so the **LLM resolves the unit**: the fetch sends the full sentence + caret offset and returns `{segment, alternatives[]}` as JSON (lenient parse, same pattern as the definitions parser).
- **Selection** spanning one or more units → popup anchored at the selection; the LLM returns alternatives for the entire span of units crossed (the 未见 → 从未见过 case).
- **The gate:** neither trigger fetches on its own. The popup first renders in a pre-fetch state ("Get alternatives" action); Escape / outside-click / scroll dismisses with zero API cost. Accidental clicks stay cheap.

## Popup states

Pre-fetch (context + action) → loading (skeleton) → results (resolved segment as header, 3–4 alternatives as rows) → error / "no alternatives" inline with retry. Each alternative row shows the replacement text; click swaps.

## Replacement semantics

Swap only the segment, in place, via text-node Range manipulation — the rest of the sentence stays byte-identical, caret lands after the replacement, native Ctrl+Z undo survives.

⚠️ Implementation consequence: the current `setOutputHtml()` re-renders via innerHTML and kills undo history — the popup swap must NOT go through that path.

## Definitions conflict (resolved)

The popup becomes the only selection-driven surface in the output pane: for a selection it offers **two** actions — "Get alternatives" and "Look up" — absorbing what `mouseup`-triggers the definitions pane today. A double-click word-select routes here too (both actions available). The old auto-open-on-mouseup definitions behavior retires.

## Scope & boundaries

- Output-pane restructure (big-default-translation JSON layout) is **out of scope**; whole-text alternatives bar stays as-is.
- Incumbent look: popup uses existing tokens/variables in `index.html`; no visual-world change rides on this feature.
- Anti-goals: no fetch without the confirm gate; no re-translation or re-flow of surrounding text; no new backend.

## Constraints

Single-file architecture, CDN-only; prompt goes through the same translation-LLM preset machinery (`callLlm`); working over `file://`.
