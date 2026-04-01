# Vela Backlog

Known issues, improvements, and feature ideas. Public file — no sensitive information.

## Rendering

### Icon-row `color` vs `textColor` confusion — LLM picks wrong property
Icon-row has two separate color properties: `color` for titles and `textColor` for description text. The LLM (and humans) naturally set `color` expecting it to affect all text, but descriptions stay gray (`st.muted` fallback). This caused multiple failed attempts to fix contrast on dark backgrounds.

**Options:**
- **Normalize the API:** Make `color` apply to both title and text, with `textColor` as an optional override. This matches how every other block works.
- **Better skill/prompt docs:** Explicitly document `textColor` as required for icon-row descriptions on dark slides.
- **Auto-contrast:** If slide bg is dark and no explicit `textColor` is set, auto-derive a readable text color instead of falling back to `st.muted`.

### Skill/LLM guidance: avoid tables for single-column lists
When a table has only one column, it should be a bullet list or icon-row instead. Tables add visual overhead (headers, borders, striping) that hurts readability for simple lists. The skill prompt and LLM should prefer `bullets` or `icon-row` blocks when there's only one data dimension.

### Unified block sizing — multiple blocks ignore `size` property
Several block types had hardcoded sizes that ignored the `size` property entirely:
- **Badge**: font was always `SIZES.xs`, icon always `12px`, padding always `3px 10px` — fixed in v12.22
- **Flow**: icon always `20px`, arrows always `24x12px`, sublabel always `xs` — fixed in v12.22
- **Table**: cell padding always `9px 14px` — **still unfixed**

The root cause is the same: each block renderer hardcodes its sub-element sizes instead of deriving them from the block's `size` property. A unified approach (e.g. a scale factor per size tier applied to all sub-elements) would prevent this class of bug across all 21 block types.

### Flow block scaling (partially fixed in v12.22)
Flow block icons, arrows, and sublabels were hardcoded at fixed sizes (icon 20px, arrow 24x12px, sublabel always `xs`). Fixed in v12.22 to scale with `labelSize` using a multiplier. However, the approach uses a manual scale map — ideally the block system should have a unified sizing strategy where all sub-elements scale proportionally from the block's `size` property, not just specific blocks.

### Table block sizing — cells don't scale with font size
Table blocks render too small relative to the slide canvas. Cell padding is hardcoded at `9px 14px` (part-blocks.jsx ~line 597) and doesn't scale with the `size` property. A table at `lg` leaves 40-50% blank space; needs `2xl` to fill properly.

**Fix options:**
- Scale cell padding proportionally with `SIZES[block.size]`
- Allow `columnWidths` or `gridTemplateColumns` override (first column often wastes space with short labels like "Block 1")
- Add `rowHeight` / `cellPadding` property to the table block schema
- Goal: `lg` table should fill the canvas naturally without needing `2xl` overrides

## Channel

### Agent-initiated push to browser — WORKS (discovered)
The `mcp reply` tool broadcasts via SSE regardless of whether there's a pending browser request. Using a synthetic `request_id` (e.g. `agent-push-1`), the browser receives the message as a notification.

**Confirmed working:** message push with no matching request. Browser shows notification.

**Next steps to explore:**
- Test if `tool_calls` in the reply payload are executed by the browser (edit_slide, set_slides, etc.)
- Build a "reload deck from disk" command the agent can push
- Explore two-way: can the browser respond to agent-initiated pings with current state (slide index, deck snapshot)?

## Features

### Live template variables (e.g. `{{CLIENT}}`) — browser-only substitution
Deck JSON often contains template placeholders like `{{CLIENT}}` that should never be saved with real values (the deck is a reusable template). But when presenting or exporting to PDF, the user needs them replaced with real values.

**Requirements:**
- Substitution happens only in the browser at render time — never persisted to the JSON file
- Out of scope for the LLM — this is a UI/engine concern, not an AI edit
- Should work for fullscreen presentation and PDF export (printing)

**Needs thinking — pros/cons of approaches:**
- **URL params** (`?client=Acme`) — simple, shareable, but exposes values in URL
- **Local modal/form** — user fills in variables before presenting, stored in sessionStorage/localStorage only
- **`.env`-style local file** — e.g. `.vela-vars.json` (gitignored), loaded at render time
- **Inline toolbar** — small bar showing active variables with editable fields, collapses during presentation

**Key constraint:** The template values must never leak into the deck JSON, git history, or any LLM context. The deck file stays generic.

## Channel

### Browser cache vs disk — edits via CLI not reflected in browser
When editing deck JSON directly on disk (outside the channel), the browser keeps showing the cached version. There's no way to signal "reload from disk" without the user manually re-importing. Related to the agent-initiated push item above, but specifically about cache invalidation when the source of truth (JSON file) changes outside the browser's awareness.

## Rendering / Layout

### Deck-level padding default — LLM creates inconsistent per-slide padding
The LLM frequently sets different padding values across slides in the same deck (e.g., `36px 48px` on some, `60px 72px` on others) with no design reason. This creates visual inconsistency — some slides fill the canvas well, others feel cramped with oversized margins. On a 960×540 canvas, `60px 72px` wastes ~12% more space than the intended `36px 48px` default.

**Root cause:** Padding is a per-slide property with no deck-level default. The LLM prompt says "use baseline" but doesn't enforce it, so the model drifts.

**Research context:** No major platform stores padding per-slide. Reveal.js uses a single global `margin` (percentage). Marp defines padding at the theme level. PowerPoint/Keynote use master layouts with positioned placeholders. The industry-standard "5% rule" (48px horizontal, 27px vertical on 960×540) aligns closely with Vela's `36px 48px` default.

**Proposed approach — two-tier padding model:**
1. **Deck-level `padding`** — sets the default for all slides (falls back to `36px 48px` if omitted)
2. **Per-slide `padding`** — only used as an intentional override (full-bleed image, extra-dense data, title cards)

**Implementation:**
- `part-blocks.jsx` — read `deck.padding` as fallback before the hardcoded default
- `part-engine.jsx` — update LLM prompt: "Do NOT set per-slide padding unless the slide has a specific layout reason to differ from the deck default"
- `validate.py` — warn when >20% of slides deviate from the deck default padding
- `block-schema.md` — document the deck-level `padding` property

**Note:** Per-slide padding should NOT be removed entirely — legitimate overrides exist (solo images already auto-zero, but dense data slides or spacious title cards benefit from custom values).

## LLM / Skill

### Grid block: two silent failure modes when LLM generates grids
Grid blocks fail silently (render nothing, no error) in two common ways:

**1. Wrong key name — `cells` instead of `items`:**
LLMs frequently use `"cells"` as the key for grid children instead of the correct `"items"`. The renderer sees no items and renders an empty grid.

**2. Shorthand cell format instead of `blocks` array:**
LLMs generate a flat card format (`{"icon": "X", "title": "Y", "text": "Z", "accent": "#color"}`) instead of the required `blocks` array format (`{"blocks": [{"type": "heading", ...}, {"type": "text", ...}]}`). The renderer ignores cells without a `blocks` key.

Both issues caused invisible content in the S4 deck (2026-03-31) — slides appeared to have grids but showed nothing.

**Fix options (address both):**
- **Renderer normalization:** On load, rename `cells` → `items`. For items missing `blocks`, auto-convert shorthand (`icon`/`title`/`text`) into the proper blocks array.
- **Skill prompt:** Add explicit grid format example showing the `blocks` array structure. Call out that shorthand card format is NOT supported.
- **Validation:** `deck validate` should flag: (a) grid blocks with `cells` key, (b) grid items without a `blocks` array.

## Tooling

### JSON patch verification
When patching deck JSON programmatically, string matching is fragile and fails silently:
- Case mismatch: `"Demo"` doesn't match `"LIVE DEMOS"`
- Nesting: top-level block search misses content inside grid cells

**Improvement ideas:**
- Build a `deck patch` CLI command that validates the patch applied
- Add a `--verify` flag to existing edit commands
- Or add a `deck grep` command that searches all block text recursively (including grid/icon-row children)
