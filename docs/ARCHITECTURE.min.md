# Architecture

## Overview

Vela Slides is a **single-file React application** (18,421 lines, ~1.3 MB) that runs inside Claude.ai's artifact sandbox. The sandbox requires all code in one `.jsx` file with no external module imports between files — so Vela uses a **modular source / concatenated output** architecture.

```
Source (16 part-files)  →  concat.py  →  vela.jsx  →  assemble.py  →  final.jsx
     ↑ edit these                         ↑ monolith                  ↑ with deck data
```

## Why Not a Bundler?

Claude.ai artifacts require a **single .jsx file** — no module imports, no file system. A bundler (Vite, Webpack, Parcel) would work, but adds complexity we don't need:

| Concern | Bundler | Concatenation |
|---|---|---|
| Module resolution | Complex (node_modules, aliases) | Not needed (fixed order) |
| Build deps | Node.js + npm packages | Python 3 (stdlib only) |
| Build speed | ~1-5s | ~10ms |
| Determinism | Depends on config | `cat` in fixed order — always identical |
| Failure modes | Config errors, version conflicts | Missing file (instant error) |

The dependency graph is fixed and acyclic, so concatenation is the simplest correct solution.

## Part-File Architecture

### Dependency Graph

```
part-imports    → Constants, sanitizers, helpers, storage
part-icons      → Icon resolution system (270+ icons)
part-blocks     → 27 block-type renderers (RenderBlock switch)
part-branding   → BrandingOverlay slide chrome (accent bar, footer, slide number, logo)
part-canvas     → SlideContent slide canvas, per-block editing chrome
part-reducer    → State management, dispatch actions
part-engine     → Vera AI engine, system prompts, API calls
part-slides     → Slide panel, fullscreen, branding overlay
part-list       → Lane/module list, drag & drop
part-chat       → Chat panel, tool trace cards
part-test       → Battery tests
part-uitest     → UI integration tests (185 tests in 33 suites)
part-demo       → Cinematic demo mode (18 scenes)
part-pdf-fonts  → Offline font fallback data (compressed TTF blobs)
part-pdf        → PDF export (raster + vector), markdown export
part-pptx       → Native editable PowerPoint (.pptx) export
part-app        → Top-level shell, modals, shortcuts
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

| Part | Lines | Owns |
|---|---|---|
| `part-imports.jsx` | ~1,940 | Constants (FONT, SIZES, COLORS), deck sanitization, import/export helpers, storage API, Levenshtein matching, startup patch |
| `part-icons.jsx` | ~290 | `getIcon()` resolver, 270+ Lucide mappings, aliases, emoji fallback |
| `part-blocks.jsx` | ~1,520 | All block renderers (heading, text, bullets, flow, grid, metric, timeline, steps, table, callout, quote, SVG, badge, icon, icon-row, tag-group, progress, code, image, comparison, funnel, cycle, number-row, matrix, checklist, divider, spacer); `EditableText`/`ItemChrome` for WYSIWYG |
| `part-branding.jsx` | ~50 | `BrandingOverlay` (accent bar, footer, slide number, logo); split from part-canvas.jsx |
| `part-canvas.jsx` | ~370 | `SlideContent` (canvas+layout), `renderBlockItem` (hover toolbar/AI-prompt popup), `InlineCommentCard`; split from part-blocks.jsx |
| `part-reducer.jsx` | ~390 | `useReducer` state shape, dispatch actions (SELECT, LOAD, ADD_LANE, SET_SLIDES, etc.) |
| `part-engine.jsx` | ~1,240 | `callClaudeAPI()`, Vera prompts, tool defs, slide improve/edit/create/alternatives, batch ops, ReAct loop |
| `part-slides.jsx` | ~2,580 | `SlidePanel`, render pipeline, fullscreen presenter, branding overlay, thumbnails, image compression |
| `part-list.jsx` | ~780 | `ModuleList`, `LaneSection`, `ConceptRow`, drag-and-drop reorder, AI slide adder |
| `part-chat.jsx` | ~450 | `ChatPanel`, message rendering, tool trace cards, image paste/drop, starter prompts |
| `part-test.jsx` | ~410 | `VelaBatteryTest` — automated render tests for block types |
| `part-uitest.jsx` | ~2,800 | 185 UI integration tests, 33 suites — block rendering, themes, edge cases |
| `part-demo.jsx` | ~860 | Cinematic demo mode, 18 scenes showcasing Vela features |
| `part-pdf-fonts.jsx` | ~15 | `COMPRESSED_FONTS` offline TTF fallback data; split from part-pdf.jsx so its ~242KB base64 doesn't sit in the frequently-edited export logic |
| `part-pdf.jsx` | ~4,040 | Canvas PDF renderer (raster+vector), watermark, link annotations, markdown export |
| `part-pptx.jsx` | ~1,190 | Native editable PowerPoint exporter — second emitter over the same primitive IR the vector-PDF path produces |
| `part-app.jsx` | ~2,070 | `VelaApp` root, modals (JSON clipboard, shortcuts, changelog), keyboard handlers, mobile nav, file browser |

## Assembly Pipeline

1. **Generate Deck JSON** — Claude (via skill prompt) generates JSON matching the deck schema.
2. **Validate** — `python3 scripts/validate.py deck.vela`

   Checks: required fields, valid block types, size token usage, duration presence, icon names, theme consistency.
3. **Assemble** — `python3 scripts/assemble.py deck.vela`; replaces `STARTUP_PATCH = null` in `vela.jsx` with deck data, producing a self-contained `.jsx` artifact.

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

`part-pptx.jsx` is a second emitter over the **same** per-slide primitive IR the vector-PDF path produces (reusing its extractors), writing native OOXML+ZIP `.pptx` via `buildPptx(pages, opts)`. Text is grouped per element (`pptxExtractTextBoxes`) so wrapped paragraphs become one editable, reflowable PowerPoint text box rather than one box per line. The 960×540px virtual canvas maps 1:1 to a 16:9 PPT slide (1 canvas px = 12700 EMU = 1 point).

## Storage

Vela uses Claude.ai's artifact `window.storage` API for persistence:

- **Master key** (`vela-deck`): core deck metadata (title, lanes, settings)
- **Module keys** (`vela-m-{id}`): per-module slide data, chunked to stay under the 5MB limit

Chunking lets large decks with embedded images persist reliably.
