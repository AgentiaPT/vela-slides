# Vela App Editing Reference

> Read this only when editing the Vela app itself (part-files, concat, template).
> For deck generation and editing, see SKILL.md.

## Architecture

The skill has two layers: a **modular app** (23 part-files) and a **deck injection pipeline**.

```
src/parts/                   # Modular source (edit these for app changes)
├── MANIFEST.txt        # build order + per-part purpose (source of truth)
├── part-imports.jsx    # ~2970L — constants, sanitizers, helpers, storage
├── part-icons.jsx      #  ~290L — icon resolution system
├── part-blocks.jsx     # ~2250L — all 27 block renderers, EditableText
├── part-branding.jsx   #   ~55L — BrandingOverlay slide chrome
├── part-canvas.jsx     # ~1210L — SlideContent, per-block toolbar
├── part-reducer.jsx    #  ~460L — state management, dispatch actions
├── part-engine.jsx     # ~1350L — AI tools, system prompts, slide ops
├── part-slides.jsx     # ~1790L — Fullscreen, Presenter, Gallery
├── part-slidepanel.jsx # ~2020L — SlidePanel, keyboard nav, slide AI actions
├── part-list.jsx       # ~1030L — Lane, ConceptRow, AI adder, editor search
├── part-chat.jsx       #  ~460L — ChatPanel, tool trace cards
├── part-test.jsx       #  ~510L — VelaBatteryTest
├── part-uitest.jsx     # ~2390L — UI test registry, runner, early suites
├── part-uitest2.jsx    # ~7500L — later UI suites (~510 tests in 102 suites total)
├── part-demo.jsx       # ~1290L — product tour demo mode (21 scenes)
├── part-pdf-fonts.jsx  #   ~15L — compressed offline font data
├── part-pdf.jsx        # ~1000L — canvas (raster) PDF export
├── part-pdf-extract.jsx #  ~820L — PDF/PPTX shared DOM extractors
├── part-pdf-vector.jsx # ~1760L — vector PDF export
├── part-export-md.jsx  #  ~610L — markdown + standalone HTML export
├── part-pptx.jsx       # ~1190L — native editable PowerPoint (.pptx) export
├── part-app-modals.jsx # ~1260L — app-level modals and dialogs
└── part-app.jsx        # ~1420L — root App component

skills/vela-slides/
├── app/vela.jsx             # Auto-generated monolith (concat of all parts)
└── scripts/                 # Author→ship only (shipped with the skill)
    ├── vela.py               # CLI entry point (vela deck ..., vela slide ...)
    ├── assemble.py            # vela.jsx + deck.vela → final.jsx
    └── validate.py            # Quality checks on deck JSON

tools/vela-dev/scripts/      # Dev/test/CI toolchain (never shipped)
├── concat.py                # parts/ → vela.jsx
├── serve.py                  # Local dev server with live reload
├── lint.py                   # Code linting checks
└── sync-skill-docs.py        # Sync CLI reference into SKILL.md
```

### Dependency Graph (strictly top-down, no circular deps)

Each part may reference only parts above it in the concatenation order.

### Concatenation Order (fixed)

```
imports → icons → blocks → branding → canvas → reducer → engine → slides → slidepanel → list → chat → test → uitest → uitest2 → demo → pdf-fonts → pdf → pdf-extract → pdf-vector → export-md → pptx → app-modals → app
```

### Why Modular Parts?

The Vela app is ~33,649 lines / ~2.4MB. Editing a monolith that large carries real risks:

| Concern | Monolith | Modular Parts |
|---|---|---|
| str_replace collision risk | High — many similar patterns across 33,649L | Low — most part files are ~290–2,970L |
| Context needed to edit | Must read entire 2.4MB file | Read only relevant part |
| Accidental side effects | Easy to break distant code | Edits are scoped to one module |
| Rewriting a subsystem | Dangerous at monolith scale | Replace a single part file safely |
| Finding what to edit | Grep through 33,649 lines | File name tells you where to look |

### Why Not Split + Bundler (Vite/Parcel)?

The artifact sandbox requires a **single .jsx file** — no module imports between files. So we need concatenation regardless. But unlike a bundler:

- `cat` in order is deterministic, instant, zero-dependency
- No npm, no node_modules, no version conflicts, no build failures
- The concat order never changes (dependency graph is fixed)

Bundlers solve a problem we don't have (module resolution). Concatenation solves the problem we do have (focused editing of a large codebase that must ship as one file).


## Workflow A: Edit the Vela App

When fixing a bug, adding a feature, or improving the Vela engine itself:

### Step 1: Identify which part to edit

| Change | Part file |
|---|---|
| Constants, sanitizers, storage, helpers | part-imports.jsx |
| Icon resolution, aliases, emoji fallback | part-icons.jsx |
| Block renderers (heading, flow, grid, etc.) | part-blocks.jsx |
| State management, reducer actions | part-reducer.jsx |
| AI tools, system prompts, Vera engine | part-engine.jsx |
| Slide chrome (accent bar, footer, slide number, logo) | part-branding.jsx |
| Slide canvas, per-block toolbar | part-canvas.jsx |
| Fullscreen, presenter, gallery, scaling | part-slides.jsx |
| Editor slide view, keyboard nav, slide AI actions | part-slidepanel.jsx |
| Lane/concept list, drag & drop, AI adder | part-list.jsx |
| Chat panel, tool trace cards | part-chat.jsx |
| Battery render tests | part-test.jsx |
| UI integration tests | part-uitest.jsx, part-uitest2.jsx |
| Product tour demo mode | part-demo.jsx |
| Canvas (raster) PDF export | part-pdf.jsx |
| PDF/PPTX shared DOM extractors | part-pdf-extract.jsx |
| Vector PDF export | part-pdf-vector.jsx |
| Markdown and standalone HTML export | part-export-md.jsx |
| PowerPoint (.pptx) export | part-pptx.jsx |
| App-level modals and dialogs | part-app-modals.jsx |
| Top-level app shell, storage, shortcuts | part-app.jsx |

### Step 2: Edit the part-file directly

```bash
# Edit the part in place — never edit vela.jsx by hand
src/parts/part-<name>.jsx
```

### Step 3: Rebuild monolith from parts

```bash
python3 tools/vela-dev/scripts/concat.py
```

This rebuilds `skills/vela-slides/app/vela.jsx` from all parts in `src/parts/MANIFEST.txt` order.

### Step 4: Test with a deck (optional)

```bash
python3 tools/vela-dev/scripts/concat.py
python3 skills/vela-slides/scripts/assemble.py examples/vela-demo.vela
```

Run `concat.py` first to rebuild the monolith from your edited parts, then
`assemble.py` injects the deck into it.

### Step 5: Run tests

```bash
python3 tests/test_vela.py          # 630+ checks
python3 -m unittest tests.test_serve # 175 server tests
```

### Step 6: Version bump

Increment `VELA_VERSION` in `part-imports.jsx` and add a `VELA_CHANGELOG` entry. Every change = version bump.


## Workflow B: Update Vela App (new version from user)

When the user provides a new Vela app version (zip or jsx):

### If monolith only:

```bash
cp /path/to/new-vela.jsx skills/vela-slides/app/vela.jsx
grep -c "const STARTUP_PATCH = null;" skills/vela-slides/app/vela.jsx
# Must output: 1
```

### If parts included (zip with part-*.jsx files):

```bash
cp /path/to/part-*.jsx src/parts/
python3 tools/vela-dev/scripts/concat.py
```

Verify:
```bash
grep -c "const STARTUP_PATCH = null;" skills/vela-slides/app/vela.jsx
# Must output: 1
```
