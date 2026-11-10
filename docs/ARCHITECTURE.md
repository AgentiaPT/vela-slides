# Architecture

## Overview

Vela Slides is a **single-file React application** (~29,700 lines, ~2.1 MB) designed to run inside Claude.ai's artifact sandbox. The sandbox requires all code to be in one `.jsx` file with no external module imports between files — so Vela uses a **modular source / concatenated output** architecture.

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
part-imports      → Constants, sanitizers, helpers, storage, themes
part-icons        → Icon resolution system (270+ icons)
part-blocks       → 27 block-type renderers (RenderBlock switch), inline editing
part-branding     → BrandingOverlay slide chrome (accent bar, footer, slide number, logo)
part-canvas       → SlideContent slide canvas, per-block editing chrome
part-reducer      → State management, dispatch actions, undo/redo
part-engine       → Vera AI engine, system prompts, API calls
part-slides       → Fullscreen slide, presenter view, gallery, study/teacher panels
part-slidepanel   → SlidePanel editor view, keyboard/wheel nav, per-slide AI actions
part-list         → Lane/module list (TOC), drag & drop
part-chat         → Chat panel, tool trace cards
part-test         → Battery render tests (dev-only)
part-uitest       → UI test battery registry/runner + early suites (dev-only)
part-uitest2      → UI test battery, later suites + runner component (dev-only)
part-demo         → Product-tour demo mode
part-pdf-fonts    → Offline font fallback data (compressed TTF blobs)
part-pdf          → Canvas (raster) PDF export
part-pdf-extract  → PDF/PPTX shared plumbing: DOM extractors, string encoding, fonts
part-pdf-vector   → Vector PDF export
part-export-md    → Markdown and standalone HTML export
part-pptx         → Native editable PowerPoint (.pptx) export
part-app-modals   → App-level modals and dialogs
part-app          → Top-level shell, storage effects, shortcuts
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
| `part-imports.jsx` | ~2,740 | `VELA_VERSION`/`VELA_CHANGELOG`, constants (FONT, SIZES, COLORS), deck ingress and every sanitizer, storage API, startup patch system, themes, cost tracker |
| `part-icons.jsx` | ~290 | `getIcon()` resolver with 270+ Lucide icon mappings, aliases, emoji fallback |
| `part-blocks.jsx` | ~2,070 | Every block renderer: heading, text, bullets, flow, grid, metric, timeline, steps, table, callout, quote, SVG, badge, icon, icon-row, tag-group, progress, code, image, comparison, funnel, cycle, number-row, matrix, checklist, divider, spacer. Plus `EditableText`/`ItemChrome` for WYSIWYG. |
| `part-branding.jsx` | ~50 | `BrandingOverlay` (accent bar, footer, slide number, logo) — split out of part-canvas.jsx |
| `part-canvas.jsx` | ~1,060 | `SlideContent` (slide canvas + block layout), `renderBlockItem` (per-block hover toolbar/AI-prompt popup), `InlineCommentCard` (review mode) — split out of part-blocks.jsx |
| `part-reducer.jsx` | ~450 | `innerReducer` action switch, undo/redo history wrapper (`reducer`, `NO_HISTORY`, `MAX_HISTORY`), initial state shape |
| `part-engine.jsx` | ~1,350 | `callClaudeAPI()`, Vera system prompts, `executeTool` tool switch, teacher mode, slide improve/edit/create/alternatives, agentic ReAct loop |
| `part-slides.jsx` | ~1,400 | `VirtualSlide`/`FullscreenSlide`, `PresenterView`, `PresenterTOC`, `GalleryView`, `BrandingPanel`, comment popover, study/teacher panels |
| `part-slidepanel.jsx` | ~1,800 | `SlidePanel` — editor slide view, keyboard/wheel nav, fullscreen/presenter orchestration, per-slide AI actions (`runBlockEdit`, quick edit, alternatives) — split out of part-slides.jsx |
| `part-list.jsx` | ~890 | `ModuleList`, `ConceptRow`, `SlideListWithAdder`, context/add menus, drag-and-drop reordering, AI slide adder |
| `part-chat.jsx` | ~460 | `ChatPanel`, `ChatMarkdown`, tool trace cards, JSON clipboard modal |
| `part-test.jsx` | ~510 | Dev-only battery render tests for block types (excluded from release builds) |
| `part-uitest.jsx` | ~2,390 | Dev-only in-app UI test battery: `uiSuite` registry, `runUITests`, headless entry, suites through v13.19 |
| `part-uitest2.jsx` | ~5,070 | Dev-only UI test battery, later suites (security, gallery/presenter/review, story mode, image drop) and the `VelaUITestRunner`/`VelaBatteryTest` component |
| `part-demo.jsx` | ~1,290 | Product-tour demo mode (editor, blocks, gallery, presenter, Vera, PowerPoint) |
| `part-pdf-fonts.jsx` | ~15 | `COMPRESSED_FONTS` — offline font fallback data (compressed TTF blobs), rarely changes; split out so its ~242KB of base64 doesn't sit inside the frequently-edited export logic |
| `part-pdf.jsx` | ~1,000 | Canvas (raster) PDF export: `PdfExportModal`, `buildPdfFromImages`, slide reflow, watermark |
| `part-pdf-extract.jsx` | ~820 | PDF/PPTX shared plumbing: color/gradient parsing, `pdfStringEncode`, emoji rendering, font metrics, DOM extractors (`extractBoxes`/`extractCircles`/`extractLinks`) |
| `part-pdf-vector.jsx` | ~1,760 | Vector PDF builder: `buildVectorPdf`, SVG icon extraction, TrueType font loading, vector export modal |
| `part-export-md.jsx` | ~610 | Markdown export (`deckToMarkdown`, `mdInline`/`mdCell`) and standalone HTML export |
| `part-pptx.jsx` | ~1,190 | Native, editable PowerPoint (.pptx) exporter — a second emitter over the same primitive IR the vector-PDF path produces |
| `part-app-modals.jsx` | ~1,120 | App-level modals and dialogs (`PptxExportModal`, `StatsDialog`, `ChangelogDialog`, `CommentsPanel`, `NewDeckDialog`, `ShortcutHelp`, `MergePatchDialog`, …) rendered by `App` |
| `part-app.jsx` | ~1,350 | Root `App` component: top-level layout, storage load/save effects, deck import/export, file drop, global keyboard handlers, local/desktop sync |

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

PDF export has two paths, chosen by export quality: raster in `part-pdf.jsx`,
vector in `part-pdf-vector.jsx`, with shared extractors in `part-pdf-extract.jsx`.

**Raster** (Standard/High quality): each slide is rendered to a temporary DOM node,
captured as a bitmap via `html2canvas`, then drawn onto the PDF canvas at the
requested DPI.

**Vector** (`buildVectorPdf`): slide primitives (boxes, text, circles, links,
images) are extracted directly from the DOM (`extractBoxes` et al.) into a
per-slide primitive IR and emitted as native, crisp, small-file PDF vector
objects instead of a bitmap — no `html2canvas` in this path.

Both paths share: link annotations extracted from `data-pdf-link` attributes,
a vector watermark overlay, and final assembly into a downloadable PDF blob.
An export option expands a story slide (`story: true`, 2+ images) to one page per image, in both PDF and PPTX.

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
