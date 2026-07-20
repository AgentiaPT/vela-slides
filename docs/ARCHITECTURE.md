# Architecture

## Overview

Vela Slides is a **single-file React application** (19,029 lines, ~1.4 MB) designed to run inside Claude.ai's artifact sandbox. The sandbox requires all code to be in one `.jsx` file with no external module imports between files — so Vela uses a **modular source / concatenated output** architecture.

```
Source (14 part-files)  →  concat.py  →  vela.jsx  →  assemble.py  →  final.jsx
     ↑ edit these                         ↑ monolith                  ↑ with deck data
```

## Why Not a Bundler?

Claude.ai artifacts require a **single .jsx file** — no module imports, no file system. A bundler (Vite, Webpack, Parcel) would work, but adds complexity we don't need:

| Concern | Bundler | Concatenation |
|---|---|---|
| Module resolution | Complex (node_modules, aliases) | Not needed (fixed order) |
| Build dependencies | Node.js + npm packages | Python 3 (stdlib only) |
| Build speed | ~1-5 seconds | ~10 milliseconds |
| Determinism | Depends on config | `cat` in fixed order — always identical |
| Failure modes | Config errors, version conflicts | Missing file (instant error) |

The dependency graph is fixed and acyclic. Concatenation is the simplest correct solution.

## Part-File Architecture

### Dependency Graph

```
part-imports    → Constants, sanitizers, helpers, storage
part-icons      → Icon resolution system (270+ icons)
part-blocks     → All 27 block renderers
part-reducer    → State management, dispatch actions
part-engine     → Vera AI engine, system prompts, API calls
part-slides     → Slide panel, fullscreen, branding overlay
part-list       → Lane/module list, drag & drop
part-chat       → Chat panel, tool trace cards
part-test       → Battery tests
part-uitest     → UI integration tests (203 tests in 38 suites)
part-demo       → Cinematic demo mode (18 scenes)
part-pdf        → PDF export (raster + vector), markdown export
part-pptx       → Native editable PowerPoint (.pptx) export
part-app        → Top-level shell, modals, shortcuts
```

Dependencies flow strictly **top-down**. No circular dependencies. Each part can reference anything defined in parts above it in the concat order.

### Concatenation Order (fixed, never changes)

```
imports → icons → blocks → reducer → engine → slides → list → chat → test → uitest → demo → pdf → pptx → app
```

### Part Responsibilities

| Part | Lines | What it owns |
|---|---|---|
| `part-imports.jsx` | ~1,490 | Constants (FONT, SIZES, COLORS), deck sanitization, import/export helpers, storage API, Levenshtein matching, startup patch system |
| `part-icons.jsx` | ~290 | `getIcon()` resolver with 270+ Lucide icon mappings, aliases, emoji fallback |
| `part-blocks.jsx` | ~1,730 | Every block renderer: heading, text, bullets, flow, grid, metric, timeline, steps, table, callout, quote, SVG, badge, icon, icon-row, tag-group, progress, code, image, comparison, funnel, cycle, number-row, matrix, checklist, divider, spacer. Plus `EditableText` for WYSIWYG. |
| `part-reducer.jsx` | ~350 | `useReducer` state shape, all dispatch actions (SELECT, LOAD, ADD_LANE, SET_SLIDES, etc.) |
| `part-engine.jsx` | ~1,240 | `callClaudeAPI()`, Vera system prompts, tool definitions, slide improve/edit/create/alternatives, batch operations, agentic ReAct loop |
| `part-slides.jsx` | ~2,460 | `SlidePanel` component, slide rendering pipeline, fullscreen presenter, branding overlay, thumbnail generation, image compression |
| `part-list.jsx` | ~660 | `ModuleList`, `LaneSection`, `ConceptRow`, drag-and-drop reordering, collapse-all, AI slide adder |
| `part-chat.jsx` | ~440 | `ChatPanel`, message rendering, tool trace cards, image paste/drop, starter prompts |
| `part-test.jsx` | ~330 | `VelaBatteryTest` — automated render tests for block types |
| `part-uitest.jsx` | ~2,110 | 203 UI integration tests in 38 suites — comprehensive coverage of block rendering, themes, edge cases |
| `part-demo.jsx` | ~860 | Cinematic demo mode with 18 scenes showcasing all Vela features |
| `part-pdf.jsx` | ~3,960 | Canvas-based PDF renderer (raster + vector export path), watermark system, link annotations, markdown export |
| `part-pptx.jsx` | ~1,190 | Native, editable PowerPoint (.pptx) exporter — a second emitter over the same primitive IR the vector-PDF path produces |
| `part-app.jsx` | ~1,930 | `VelaApp` root component, modals (JSON clipboard, shortcuts, changelog), keyboard handlers, mobile navigation, file browser |

## Assembly Pipeline

### Step 1: Generate Deck JSON

Claude (via the skill prompt) generates structured JSON matching the deck schema.

### Step 2: Validate

```bash
python3 scripts/validate.py deck.vela
```

Checks: required fields, valid block types, size token usage, duration presence, icon names, theme consistency.

### Step 3: Assemble

```bash
python3 scripts/assemble.py deck.vela
```

Replaces the `STARTUP_PATCH = null` marker in `vela.jsx` with the deck data, producing a self-contained `.jsx` file that Claude outputs as an artifact.

## AI Engine (Vera)

The Vera engine (`part-engine.jsx`) implements an **agentic ReAct loop** inside the artifact:

```
User message → System prompt + deck state + tool definitions
    → Claude API call (via artifact proxy, no key needed)
    → Parse response: { tool_calls: [...], message: "..." }
    → Execute tool calls (modify deck state via dispatch)
    → If more tool calls needed → loop
    → Final message displayed in chat
```

### Available Tools

Vera has 22 tools for deck manipulation: `add_lane`, `add_item`, `batch_add_items`, `remove_item`, `remove_lane`, `rename_item`, `rename_lane`, `move_item`, `update_status`, `set_importance`, `set_slides`, `add_slide`, `edit_slide`, `add_image_to_slide`, `clear_all`, `set_branding`, `find_slides`, `find_replace`, `deck_stats`, `batch_restyle`, `list_comments`, and `resolve_comment`. Each tool modifies the React state directly, with results visible immediately in the slide panel.

## Rendering Pipeline

Slides render at a **virtual canvas of 960×540px** (16:9), scaled to fit the available panel width. The rendering pipeline:

1. Slide JSON → block array
2. Each block → typed renderer from `part-blocks.jsx`
3. Theme tokens (`{{accent}}`, `{{color}}`, etc.) injected into SVG markup
4. SVG sanitized before `dangerouslySetInnerHTML`
5. `EditableText` wraps all text nodes for inline editing
6. Branding overlay (accent bar + footer) composited on top

### PDF Export

`part-pdf.jsx` offers two export paths, chosen by export quality:

**Raster** (Standard/High quality): each slide is rendered to a temporary DOM node,
captured as a bitmap via `html2canvas`, then drawn onto the PDF canvas at the
requested DPI.

**Vector** (`buildVectorPdf`): slide primitives (boxes, text, circles, links,
images) are extracted directly from the DOM (`extractBoxes` et al.) into a
per-slide primitive IR and emitted as native, crisp, small-file PDF vector
objects instead of a bitmap — no `html2canvas` in this path.

Both paths share: link annotations extracted from `data-pdf-link` attributes,
a vector watermark overlay, and final assembly into a downloadable PDF blob.

### PowerPoint Export

`part-pptx.jsx` is a second emitter over the **same** per-slide primitive IR the
vector-PDF path produces (reusing its extractors), writing native OOXML+ZIP
`.pptx` output via `buildPptx(pages, opts)`. Text is grouped per element
(`pptxExtractTextBoxes`) so wrapped paragraphs become one editable, reflowable
PowerPoint text box rather than one box per line. The 960×540px virtual canvas
maps 1:1 to a 16:9 PPT slide (1 canvas px = 12700 EMU = 1 point).

## Storage

Vela uses Claude.ai's artifact `window.storage` API for persistence:

- **Master key** (`vela-deck`): Core deck metadata (title, lanes, settings)
- **Module keys** (`vela-m-{id}`): Individual module slide data (chunked to stay under 5MB limit)

This chunked approach allows large decks with embedded images to persist reliably.
