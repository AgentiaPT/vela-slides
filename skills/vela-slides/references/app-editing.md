# Vela App Editing Reference

> Read this only when editing the Vela app itself (part-files, concat, template).
> For deck generation and editing, see SKILL.md.

## Architecture

The skill has two layers: a **modular app** (13 part-files) and a **deck injection pipeline**.

```
app/
├── parts/                  # Modular source (edit these for app changes)
│   ├── part-imports.jsx    #  ~665L — constants, sanitizers, helpers, storage
│   ├── part-icons.jsx      #  ~189L — icon resolution system
│   ├── part-blocks.jsx     #  ~906L — all 21 block renderers, EditableText
│   ├── part-reducer.jsx    #  ~180L — state management, dispatch actions
│   ├── part-engine.jsx     # ~1043L — AI tools, system prompts, slide ops
│   ├── part-slides.jsx     # ~1926L — SlidePanel, Fullscreen, Branding
│   ├── part-list.jsx       #  ~384L — Lane, ConceptRow, AI adder
│   ├── part-chat.jsx       #  ~425L — ChatPanel, tool trace cards
│   ├── part-test.jsx       #  ~244L — VelaBatteryTest
│   ├── part-uitest.jsx     # ~1100L — 95 UI tests in 22 suites
│   ├── part-demo.jsx       #  ~861L — Cinematic demo mode (18 scenes)
│   ├── part-pdf.jsx        # ~3513L — PDF/MD export
│   └── part-app.jsx        # ~1216L — main VelaApp component
└── vela.jsx                # Auto-generated monolith (concat of all parts)

scripts/
├── vela.py                 # CLI entry point (vela deck ..., vela slide ...)
├── concat.py               # parts/ → vela.jsx
├── assemble.py             # vela.jsx + deck.vela → final.jsx
├── validate.py             # Quality checks on deck JSON
├── serve.py                # Local dev server with live reload
├── lint.py                 # Code linting checks
└── sync-skill-docs.py      # Sync CLI reference into SKILL.md
```

### Dependency Graph (strictly top-down, no circular deps)

```
imports → icons → blocks → reducer → engine → slides
                                        ↓        ↓
                                       list     chat
                                        ↓        ↓
                                       test    uitest
                                        ↓        ↓
                                       demo     pdf
                                         ↘     ↙
                                          app
```

### Concatenation Order (fixed)

```
imports → icons → blocks → reducer → engine → slides → list → chat → test → uitest → demo → pdf → app
```

### Why Modular Parts?

The Vela app is ~12,650 lines / ~964KB. Editing a monolith that large carries real risks:

| Concern | Monolith | Modular Parts |
|---|---|---|
| str_replace collision risk | High — many similar patterns across 12,650L | Low — part files are 180–3513L |
| Context needed to edit | Must read entire 964KB file | Read only relevant part |
| Accidental side effects | Easy to break distant code | Edits are scoped to one module |
| Rewriting a subsystem | Dangerous at monolith scale | Replace a single part file safely |
| Finding what to edit | Grep through 12,650 lines | File name tells you where to look |

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
| Slide panel, fullscreen, branding, scaling | part-slides.jsx |
| Lane/concept list, drag & drop, AI adder | part-list.jsx |
| Chat panel, tool trace cards | part-chat.jsx |
| Battery render tests | part-test.jsx |
| UI integration tests | part-uitest.jsx |
| Cinematic demo mode | part-demo.jsx |
| PDF export, markdown export | part-pdf.jsx |
| Top-level app shell, modals, shortcuts | part-app.jsx |

### Step 2: Edit the part-file directly

```bash
# Edit the part in place — never edit vela.jsx by hand
skills/vela-slides/app/parts/part-<name>.jsx
```

### Step 3: Rebuild monolith from parts

```bash
python3 skills/vela-slides/scripts/concat.py
```

This rebuilds `app/vela.jsx` from all 13 parts in fixed order.

### Step 4: Test with a deck (optional)

```bash
python3 skills/vela-slides/scripts/assemble.py examples/starter-deck.vela --from-parts
```

The `--from-parts` flag runs concat + assemble in one step.

### Step 5: Run tests

```bash
python3 tests/test_vela.py          # 161 core tests
python3 -m unittest tests.test_serve # 91 server tests
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
cp /path/to/part-*.jsx skills/vela-slides/app/parts/
python3 skills/vela-slides/scripts/concat.py
```

Verify:
```bash
grep -c "const STARTUP_PATCH = null;" skills/vela-slides/app/vela.jsx
# Must output: 1
```
