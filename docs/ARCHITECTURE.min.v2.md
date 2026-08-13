# Architecture

## Overview

Vela Slides is a **single-file React application** (18,421 lines, ~1.3 MB) that runs inside Claude.ai's artifact sandbox — all code in one `.jsx` file, no external module imports. Vela uses a **modular source / concatenated output** architecture to satisfy this.

```
Source (16 part-files)  →  concat.py  →  vela.jsx  →  assemble.py  →  final.jsx
     ↑ edit these                         ↑ monolith                  ↑ with deck data
```

## Why Not a Bundler?

Claude.ai artifacts require a **single .jsx file** — no module imports, no file system. A bundler (Vite, Webpack, Parcel) would work, but adds complexity we don't need:

| Concern | Bundler | Concatenation |
|---|---|---|
| Module resolution | Complex (node_modules, aliases) | Not needed (fixed order) |
| Build dependencies | Node.js + npm packages | Python 3 (stdlib only) |
| Build speed | ~1-5s | ~10ms |
| Determinism | Depends on config | `cat` in fixed order — always identical |
| Failure modes | Config errors, version conflicts | Missing file (instant error) |

The dependency graph is fixed and acyclic — concatenation is the simplest correct solution.

## Part-File Architecture

### Dependency Graph

```
part-imports    → constants, sanitizers, helpers, storage
part-icons      → icon resolution (270+ icons)
part-blocks     → 27 block-type renderers (RenderBlock switch)
part-branding   → BrandingOverlay chrome (accent bar, footer, slide #, logo)
part-canvas     → SlideContent canvas, per-block editing chrome
part-reducer    → state management, dispatch actions
part-engine     → Vera AI engine, system prompts, API calls
part-slides     → slide panel, fullscreen, branding overlay
part-list       → lane/module list, drag & drop
part-chat       → chat panel, tool trace cards
part-test       → battery tests
part-uitest     → UI integration tests (185 tests, 33 suites)
part-demo       → cinematic demo mode (18 scenes)
part-pdf-fonts  → offline font fallback data (compressed TTF blobs)
part-pdf        → PDF export (raster + vector), markdown export
part-pptx       → native editable PowerPoint (.pptx) export
part-app        → top-level shell, modals, shortcuts
```

Dependencies flow strictly **top-down**. No circular dependencies. Each part can reference anything defined in parts above it in the concat order.

### Concatenation Order (fixed, never changes)

`src/parts/MANIFEST.txt` is the single source of truth for the part list, the
build order, and each part's purpose line — read it directly rather than a
copy here, which can drift:

```
imports → icons → blocks → canvas → reducer → engine → slides → list → chat → test → uitest → demo → pdf-fonts → pdf → pptx → app
```

### Part Responsibilities

Per-part purpose lines live in `src/parts/MANIFEST.txt` (single source of truth, kept in sync by CI) — read it instead of a copy here. Approximate size only:

| Part | Lines | Part | Lines | Part | Lines |
|---|---|---|---|---|---|
| part-imports.jsx | ~1,940 | part-list.jsx | ~780 | part-pdf-fonts.jsx | ~15 |
| part-icons.jsx | ~290 | part-chat.jsx | ~450 | part-pdf.jsx | ~4,040 |
| part-blocks.jsx | ~1,520 | part-test.jsx | ~410 | part-pptx.jsx | ~1,190 |
| part-branding.jsx | ~50 | part-uitest.jsx | ~2,800 | part-app.jsx | ~2,070 |
| part-canvas.jsx | ~370 | part-demo.jsx | ~860 | | |
| part-reducer.jsx | ~390 | | | | |
| part-engine.jsx | ~1,240 | | | | |
| part-slides.jsx | ~2,580 | | | | |

## Assembly Pipeline

1. **Generate Deck JSON** — Claude generates JSON matching the deck schema.
2. **Validate** — `python3 scripts/validate.py deck.vela`

   Checks: required fields, valid block types, size token usage, duration presence, icon names, theme consistency.
3. **Assemble** — `python3 scripts/assemble.py deck.vela`; replaces `STARTUP_PATCH = null` in `vela.jsx` with deck data → self-contained `.jsx` artifact.

## AI Engine (Vera)

`part-engine.jsx` implements an **agentic ReAct loop** inside the artifact:

```
User message → System prompt + deck state + tool definitions
    → Claude API call (via artifact proxy, no key needed)
    → Parse response: { tool_calls: [...], message: "..." }
    → Execute tool calls (modify deck state via dispatch)
    → If more tool calls needed → loop
    → Final message displayed in chat
```

### Available Tools

22 tools: `add_lane`, `add_item`, `batch_add_items`, `remove_item`, `remove_lane`, `rename_item`, `rename_lane`, `move_item`, `update_status`, `set_importance`, `set_slides`, `add_slide`, `edit_slide`, `add_image_to_slide`, `clear_all`, `set_branding`, `find_slides`, `find_replace`, `deck_stats`, `batch_restyle`, `list_comments`, `resolve_comment` — each modifies React state directly, visible immediately in the slide panel.

## Rendering Pipeline

Slides render at a **virtual canvas of 960×540px** (16:9), scaled to fit the panel:

1. Slide JSON → block array
2. Each block → typed renderer from `part-blocks.jsx`
3. Theme tokens (`{{accent}}`, `{{color}}`, etc.) injected into SVG markup
4. SVG sanitized before `dangerouslySetInnerHTML`
5. `EditableText` wraps all text nodes for inline editing
6. Branding overlay (accent bar + footer) composited on top

### PDF Export

`part-pdf.jsx` offers two paths, chosen by export quality:

- **Raster** (Standard/High): each slide renders to a temporary DOM node, captured as a bitmap via `html2canvas`, drawn onto the PDF canvas at the requested DPI.
- **Vector** (`buildVectorPdf`): slide primitives (boxes, text, circles, links,
  images) are extracted directly from the DOM (`extractBoxes` et al.) into a
  per-slide primitive IR and emitted as native, crisp, small-file PDF vector
  objects instead of a bitmap — no `html2canvas` in this path.

Both paths share: link annotations from `data-pdf-link` attributes, a vector watermark overlay, and final assembly into a downloadable PDF blob.

### PowerPoint Export

`part-pptx.jsx` is a second emitter over the **same** per-slide primitive IR the vector-PDF path produces (reusing its extractors), writing native OOXML+ZIP `.pptx` via `buildPptx(pages, opts)`. Text is grouped per element (`pptxExtractTextBoxes`) so wrapped paragraphs become one editable, reflowable text box rather than one per line. Canvas maps 1:1 to a 16:9 PPT slide (1 px = 12700 EMU = 1 point).

## Storage

Vela uses Claude.ai's artifact `window.storage` API for persistence:

- **Master key** (`vela-deck`): core deck metadata (title, lanes, settings)
- **Module keys** (`vela-m-{id}`): per-module slide data, chunked to stay under the 5MB limit

Chunking lets large decks with embedded images persist reliably.
