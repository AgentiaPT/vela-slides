# Architecture

## Overview

Vela Slides is a **single-file React application** (24,408 lines, ~1.7 MB) designed to run inside Claude.ai's artifact sandbox. The sandbox requires all code to be in one `.jsx` file with no external module imports between files — so Vela uses a **modular source / concatenated output** architecture.

```
Source (23 part-files)  →  concat.py  →  vela.jsx  →  assemble.py  →  final.jsx
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
part-blocks     → 27 block-type renderers (RenderBlock switch)
part-branding   → BrandingOverlay slide chrome (accent bar, footer, slide number, logo)
part-canvas     → SlideContent slide canvas, per-block editing chrome
part-reducer    → State management, dispatch actions
part-engine     → Vera AI engine, system prompts, API calls
part-slides     → Virtual/fullscreen slide, presenter view, gallery
part-slidepanel → SlidePanel (editor slide view, keyboard/wheel nav)
part-list       → Lane/module list, drag & drop
part-chat       → Chat panel, tool trace cards
part-test       → Battery tests (dev-only)
part-uitest     → UI integration tests (dev-only)
part-uitest2    → UI integration tests, continued (dev-only)
part-demo       → Cinematic demo mode
part-pdf-fonts  → Offline font fallback data (compressed TTF blobs)
part-pdf        → Canvas (raster) PDF export
part-pdf-extract→ PDF/PPTX shared DOM extraction plumbing
part-pdf-vector → Vector PDF builder
part-export-md  → Markdown and standalone-HTML export
part-pptx       → Native editable PowerPoint (.pptx) export
part-app-modals → App-level modals and dialogs
part-app        → Top-level shell, shortcuts
```

Dependencies flow strictly **top-down**. No circular dependencies. Each part can reference anything defined in parts above it in the concat order.

### Concatenation Order (fixed, never changes)

`src/parts/MANIFEST.txt` is the single source of truth for the part list, the
build order, and each part's purpose line — read it directly rather than a
copy here, which can drift:

```
imports → icons → blocks → branding → canvas → reducer → engine → slides → slidepanel → list → chat → test → uitest → uitest2 → demo → pdf-fonts → pdf → pdf-extract → pdf-vector → export-md → pptx → app-modals → app
```

### Part Responsibilities

| Part | Lines | What it owns |
|---|---|---|
| `part-imports.jsx` | ~2,240 | Constants (FONT, SIZES, COLORS), `VELA_VERSION`/`VELA_CHANGELOG`, deck sanitization, import/export helpers, storage API, startup patch system |
| `part-icons.jsx` | ~290 | `getIcon()` resolver with 270+ Lucide icon mappings, aliases, emoji fallback |
| `part-blocks.jsx` | ~1,530 | Every block renderer (27 types) via the `RenderBlock` switch. Plus `EditableText`/`ItemChrome` for WYSIWYG. |
| `part-branding.jsx` | ~50 | `BrandingOverlay` (accent bar, footer, slide number, logo) |
| `part-canvas.jsx` | ~680 | `SlideContent` (slide canvas + block layout), `renderBlockItem` (per-block hover toolbar/AI-prompt popup), `InlineCommentCard` |
| `part-reducer.jsx` | ~440 | `useReducer` state shape, all dispatch actions, undo/redo history |
| `part-engine.jsx` | ~1,350 | `callClaudeAPI()`, Vera system prompts, `executeTool` (22 tools), slide improve/edit/create/alternatives, agentic ReAct loop |
| `part-slides.jsx` | ~1,370 | Virtual/fullscreen slide, `PresenterView`, gallery view, `StudentPanel` |
| `part-slidepanel.jsx` | ~1,360 | `SlidePanel` (editor slide view, keyboard/wheel nav, fullscreen sync), `runBlockEdit` |
| `part-list.jsx` | ~810 | `ModuleList`, `ConceptRow`, `SlideListWithAdder`, drag-and-drop reordering, AI slide adder |
| `part-chat.jsx` | ~460 | `ChatPanel`, message rendering, tool trace cards, image paste/drop, starter prompts |
| `part-test.jsx` | ~410 | `VelaBatteryTest` — automated render tests for block types (dev-only) |
| `part-uitest.jsx` | ~2,390 | In-app UI test registry/runner and first suites (dev-only) |
| `part-uitest2.jsx` | ~2,210 | Later UI suites, security suites, `VelaUITestRunner` (dev-only) |
| `part-demo.jsx` | ~1,290 | Cinematic demo mode showcasing Vela features |
| `part-pdf-fonts.jsx` | ~15 | `COMPRESSED_FONTS` — offline font fallback data (compressed TTF blobs), rarely changes |
| `part-pdf.jsx` | ~970 | Canvas-based (raster) PDF export, `PdfExportModal`, `buildPdfFromImages` |
| `part-pdf-extract.jsx` | ~780 | Shared PDF/PPTX plumbing: `extractBoxes`, `extractCircles`, `extractLinks`, `pdfStringEncode` |
| `part-pdf-vector.jsx` | ~1,730 | Vector PDF builder `buildVectorPdf` and its export modal |
| `part-export-md.jsx` | ~560 | `deckToMarkdown` and standalone-HTML export |
| `part-pptx.jsx` | ~1,190 | Native, editable PowerPoint (.pptx) exporter — a second emitter over the same primitive IR as vector PDF |
| `part-app-modals.jsx` | ~1,100 | App-level modals: PPTX export, stats, changelog, comments, new deck, shortcut help, agent settings |
| `part-app.jsx` | ~1,200 | `App` root component, keyboard handlers, mobile navigation, file browser |

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

The PDF parts offer two export paths (raster in `part-pdf.jsx`, vector in `part-pdf-vector.jsx`), chosen by export quality:

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
