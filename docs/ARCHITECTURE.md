# Architecture

## Overview

Vela Slides is a **single-file React application** (20,995 lines, ~1.5 MB) designed to run inside Claude.ai's artifact sandbox. The sandbox requires all code to be in one `.jsx` file with no external module imports between files — so Vela uses a **modular source / concatenated output** architecture.

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
part-imports     → Constants, sanitizers, helpers, storage
part-icons       → Icon resolution system (270+ icons)
part-blocks      → 27 block-type renderers (RenderBlock switch)
part-branding    → BrandingOverlay slide chrome (accent bar, footer, slide number, logo)
part-canvas      → SlideContent slide canvas, per-block editing chrome
part-reducer     → State management, dispatch actions
part-engine      → Vera AI engine, system prompts, API calls
part-slides      → Slide/gallery/presenter view components
part-slidepanel  → SlidePanel editor orchestration, fullscreen/presenter nav
part-list        → Lane/module list, drag & drop
part-chat        → Chat panel, tool trace cards
part-test        → Battery tests
part-uitest      → UI integration tests, suites through v13.19 (116 tests / 25 suites)
part-uitest2     → UI integration tests continued: security + later suites (117 tests / 18 suites)
part-demo        → Cinematic demo mode (18 scenes)
part-pdf-fonts   → Offline font fallback data (compressed TTF blobs)
part-pdf         → Canvas/raster PDF export
part-pdf-extract → Shared PDF/PPTX DOM-extraction plumbing
part-pdf-vector  → Vector PDF export
part-export-md   → Markdown + standalone HTML export
part-pptx        → Native editable PowerPoint (.pptx) export
part-app-modals  → Standalone app-level modal/dialog components
part-app         → Top-level shell, keyboard shortcuts, storage
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
| `part-imports.jsx` | 1,949 | Constants (FONT, SIZES, COLORS), deck sanitization, import/export helpers, storage API, Levenshtein matching, startup patch system |
| `part-icons.jsx` | 291 | `getIcon()` resolver with 270+ Lucide icon mappings, aliases, emoji fallback |
| `part-blocks.jsx` | 1,516 | Every block renderer: heading, text, bullets, flow, grid, metric, timeline, steps, table, callout, quote, SVG, badge, icon, icon-row, tag-group, progress, code, image, comparison, funnel, cycle, number-row, matrix, checklist, divider, spacer. Plus `EditableText`/`ItemChrome` for WYSIWYG. |
| `part-branding.jsx` | 49 | `BrandingOverlay` (accent bar, footer, slide number, logo) |
| `part-canvas.jsx` | 368 | `SlideContent` (slide canvas + block layout), `renderBlockItem` (per-block hover toolbar/AI-prompt popup), `InlineCommentCard` (review mode) |
| `part-reducer.jsx` | 385 | `innerReducer` action switch, undo/redo history wrapper (`reducer`, `NO_HISTORY`, `MAX_HISTORY`), initial state shape |
| `part-engine.jsx` | 1,244 | `callClaudeAPI()`, Vera system prompts, tool definitions, slide improve/edit/create/alternatives, batch operations, agentic ReAct loop |
| `part-slides.jsx` | 1,344 | `VirtualSlide`/`FullscreenSlide` rendering, `PresenterView`, `GalleryView`, `TeacherPanel`/`StudentPanel` (classroom mode), thumbnail generation |
| `part-slidepanel.jsx` | 1,237 | `SlidePanel` component: editor slide view, keyboard/wheel nav, fullscreen/presenter orchestration, per-slide AI actions (`runBlockEdit`, quick edit, alternatives) |
| `part-list.jsx` | 784 | `ModuleList`, `LaneSection`, `ConceptRow`, drag-and-drop reordering, AI slide adder |
| `part-chat.jsx` | 449 | `ChatPanel`, message rendering, tool trace cards, image paste/drop, starter prompts |
| `part-test.jsx` | 405 | `VelaBatteryTest` — automated render tests for block types (dev-only, excluded from release builds) |
| `part-uitest.jsx` | 1,425 | UI test registry/runner (`uiSuite`, `runUITests`, `window.__velaRunUITests`) plus suites through v13.19 block-reorder — 116 tests in 25 suites |
| `part-uitest2.jsx` | 1,373 | UI test suites continued: SVG-sanitizer/deck-sanitization security suites, Gallery/Presenter/Review, Multi-select, `VelaUITestRunner`/`VelaBatteryTest` component — 117 tests in 18 suites |
| `part-demo.jsx` | 861 | Cinematic demo mode with 18 scenes showcasing all Vela features |
| `part-pdf-fonts.jsx` | 15 | `COMPRESSED_FONTS` — offline font fallback data (compressed TTF blobs), rarely changes; kept separate so its base64 payload doesn't sit inside the frequently-edited export logic |
| `part-pdf.jsx` | 971 | Canvas/raster PDF export: `PdfExportModal`, `domToCanvas`/`buildPdfFromImages` pipeline, slide reflow, link-icon drawing, watermark |
| `part-pdf-extract.jsx` | 783 | Shared PDF/PPTX plumbing: color/gradient parsing, `pdfStringEncode`, emoji rendering, font metrics, DOM extractors (`extractBoxes`/`extractCircles`/`extractLinks`) |
| `part-pdf-vector.jsx` | 1,732 | Vector PDF builder: SVG icon extraction, `buildVectorPdf`, TrueType font parsing/loading, `VectorPdfExportModal` — no `html2canvas` in this path |
| `part-export-md.jsx` | 558 | Markdown export (`deckToMarkdown`, `mdInline`/`mdCell`) and standalone HTML export |
| `part-pptx.jsx` | 1,187 | Native, editable PowerPoint (.pptx) exporter — a second emitter over the same primitive IR the vector-PDF path produces |
| `part-app-modals.jsx` | 1,095 | Standalone modal/dialog components: `ModalBackdrop`, `PptxExportModal`, `StatsDialog`, `ChangelogDialog`, `CommentsPanel`, `NewDeckDialog`, `ShortcutHelp`, `CostBadge`, `AgentStatusChip`, `AgentSettingsDialog`, `MergePatchDialog` |
| `part-app.jsx` | 974 | `VelaApp` root component: top-level layout, storage load/save effects, deck import/export, global keyboard handlers, mobile navigation, file browser; renders the modals declared in `part-app-modals.jsx` |

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

Vela offers two PDF export paths, chosen by export quality: raster (`part-pdf.jsx`)
and vector (`part-pdf-vector.jsx`), sharing DOM-extraction plumbing from
`part-pdf-extract.jsx`.

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
