---
name: vela-slides
version: 2.5.1
updated: 2026-03-20
description: Generate high-quality Vela-compatible slide deck JSON from topics, outlines, documents, or existing slide content. Produces structured slide objects with 22+ block types including SVG diagrams and loop flows, theming, and presentation-ready layouts. Assembles final .jsx artifact with embedded deck data, ready for immediate use. Also supports editing the Vela app itself via a modular part-file architecture. Use when users want to create, populate, or restyle slide decks for Vela — the React-based presentation engine.
---

# Vela Slides Skill

> **v2.5.1** · 2026-03-20 · Three formats (full/compact/turbo), `vela deck compact/expand/turbo`, 262 tests, auto-expand pipeline

Generate presentation-ready slide decks and assemble them into runnable Vela .jsx artifacts. Also supports modular editing of the Vela app itself.

## When to Use

- User wants to create a slide deck / presentation
- User provides a topic, agenda, outline, or document to turn into slides
- User wants to restyle or improve existing Vela slide JSON
- User wants to fix bugs or add features to the Vela app itself
- User asks for "Vela slides", "deck", or "presentation" content

## Before You Start

**Read the references** — they contain the complete block schema, design patterns, and theming system:

```
Read references/block-schema.md    # All 20+ block types with properties
Read references/design-patterns.md # Layout rules, slide archetypes, composition
Read references/themes.md          # Color palettes, theming system
```

## Architecture

> For app editing (part-files, concat, template), read `references/app-editing.md`.

## Vela CLI Setup

The `vela` CLI is a single entry point for all deck operations. Install once per session:

```bash
export PATH="/home/claude/.local/bin:$PATH"
ln -sf /mnt/skills/user/vela-slides/scripts/vela.py /home/claude/.local/bin/vela
```

Discovery (zero turns wasted):
```bash
vela --capabilities   # JSON index of all commands, flags, exit codes
vela --help           # Human-readable overview
```

## Three Formats

Vela supports three JSON formats. All commands auto-detect and auto-expand as needed.

| Format | Detection | Token savings | Use case |
|---|---|---|---|
| **Full** | has `"lanes"` key | baseline | editing, shipping, human-readable |
| **Compact** | has `"S"` key | ~32% fewer | LLM generation (named keys = reliable) |
| **Turbo** | top-level is array | ~47% fewer | storage, cache, inter-LLM context |

Pipeline: any format → `_load_full()` auto-expands → validate → assemble → ship.

### Compact Format (~32% fewer bytes)

When generating a new deck, the LLM outputs **compact JSON** — minified, with short keys, flat slides array, theme presets, spacer shorthand, and color palette aliases. The CLI auto-expands to full Vela JSON on `ship`.

Key differences from full format:

| Full JSON | Compact JSON | Savings |
|---|---|---|
| `"type": "heading"` | `"_": "heading"` | shorter keys |
| `"text": "..."` | `"x": "..."` | shorter keys |
| `{"type":"spacer","h":8}` | `8` | spacer → int |
| `"bg":"#0A0F1C","color":"#E6F1FF",...` per slide | `"t":"d"` (theme ref) | theme presets |
| `"lanes":[{"items":[{"slides":[...]}]}]` | `"S":[...]` | flat structure |
| `"#3B82F6"` repeated 28× | `"$A"` + `"C":{"$A":"#3B82F6"}` | color palette |

#### Compact key reference (use when generating)

**Top-level**: `n`=deckTitle, `T`=themes, `C`=color palette, `S`=slides array

**Slide level**: `t`=theme ref, `n`=title, `d`=duration, `B`=blocks, `p`=padding (only if overriding theme)

**Block level**: `_`=type, `x`=text, `s`=size, `c`=color, `i`=icon, `b`=bg, `w`=weight, `ic`=iconColor, `ib`=iconBg, `I`=items, `B`=blocks (nested), `g`=gap, `lb`=label, `v`=variant, `H`=headers, `R`=rows, `sl`=sublabel, `slc`=sublabelColor, `ac`=arrowColor, `lc`=labelColor, `ts`=titleSize, `xs`=textSize, `hb`=headerBg, `hc`=headerColor, `cc`=cellColor, `bc`=borderColor, `str`=striped, `lo`=loop, `lnc`=lineColor, `nc`=numberColor, `tc`=titleColor, `xc`=textColor, `dc`=dotColor, `cir`=circle, `dir`=direction

**Color palette (`C`)**: define every color used ≥2× as `"$A":"#hex"`. Use `$A` everywhere instead of raw hex. Assign in frequency order ($A = most common).

**Theme palette (`T`)**: `"d"`:dark, `"l"`:light, `"a"`:alt. Keys: `b`=bg, `c`=color, `a`=accent, `p`=padding. Theme values can use `$` aliases too.

**Spacers**: bare int `8` instead of `{"_":"spacer","h":8}`

#### Compact commands

```bash
# Convert full → compact (for analysis/storage)
vela deck compact full.json compact.json

# Convert compact → full
vela deck expand compact.json full.json

# Ship auto-expands compact format transparently
vela deck ship compact.json    # expand → validate → assemble → copy

# All read commands auto-expand compact format
vela deck list compact.json    # works
vela slide view compact.json 3 # works
```

### Turbo Format (~47% fewer tokens)

Positional arrays + color palette. NOT for LLM generation — for storage, cache, and passing deck context between LLM calls. The format eliminates all JSON key names by using positional arrays with implicit schemas.

Structure: `[deckTitle, [lanes], colorPalette]`
Blocks: `[type_id, ...positional values]` where type IDs: 0=badge, 1=spacer, 2=heading, 3=text, 4=grid, 5=icon, 6=callout, 7=icon-row, 8=code, 9=table, 10=flow, 11=steps, 12=tag-group, 13=divider, 99=passthrough

```bash
# Convert to turbo
vela deck turbo full.json turbo.json
vela deck turbo compact.json turbo.json  # compact→full→turbo automatically

# Read/ship turbo (auto-expands)
vela deck list turbo.json
vela slide view turbo.json 3
vela deck ship turbo.json

# Expand turbo back to full
vela deck expand turbo.json full.json
```

### Workflow with formats

```bash
# 1. LLM generates compact JSON (minified, named keys = reliable)
create_file /home/claude/deck.json   # compact format

# 2. Ship (auto-expands + validates + assembles)
vela deck ship /home/claude/deck.json

# 3. Edits work on any format (auto-expand on load)
vela slide edit /home/claude/deck.json 3 block.2.text "New heading"
vela deck ship /home/claude/deck.json

# 4. For passing deck context to another LLM call (minimal tokens)
vela deck turbo deck.json context.json   # 47% fewer tokens
```

### Benchmark (6-slide deck, 16 operations)

```
Baseline (full+minified):  4,955 bytes
Compact (short keys+palette): 3,363 bytes (32.1% smaller)
Turbo (positional arrays):    2,600 bytes (47.5% smaller)

All CLI operations work on any format: list, view, edit, replace-text,
insert, move, duplicate, remove, remove-block, validate, ship.
```

## Workflow A: Generate a Deck (most common)

### Step 1: Generate Compact JSON

**Always generate in compact format** — it saves ~32% output tokens vs full format, and the CLI auto-expands it.

Rules for generating compact:
1. **Top-level**: `{"n":"Title","T":{themes},"C":{color palette},"S":[slides]}`
2. **Color palette (`C`)**: define every color used 2+ times as `$A`, `$B`, etc. Use these aliases everywhere in the deck instead of raw hex/rgba values.
3. **Themes (`T`)**: group slides by bg/color/accent/padding. `"d"` = dark, `"l"` = light, `"a"` = alt.
4. **Slides (`S`)**: flat array. Each slide has `"t":"d"` (theme ref), `"n"` (title), `"d"` (duration), `"B"` (blocks).
5. **Blocks**: use short keys (`_`=type, `x`=text, `s`=size, `c`=color, `i`=icon, `b`=bg, etc.)
6. **Spacers**: just the int `8` instead of `{"_":"spacer","h":8}`
7. **Minified**: no whitespace, no indentation.

#### Complete example (3-slide compact deck)

```json
{"n":"AI Workshop","C":{"$A":"#3B82F6","$B":"#E6F1FF","$C":"#8892B0","$D":"#0A0F1C","$E":"#3B82F620","$F":"#1e293b"},"T":{"d":{"b":"$D","c":"$B","a":"$A","p":"60px 72px"},"l":{"b":"#ffffff","c":"$F","a":"$A","p":"36px 48px"}},"S":[{"t":"d","n":"Cover","d":15,"B":[{"_":"badge","x":"WORKSHOP","i":"GraduationCap","b":"$E","c":"$A"},8,{"_":"heading","x":"AI para Equipas","s":"3xl","w":700},{"_":"text","x":"Formação prática com LLMs e agentes.","s":"lg","c":"$C"}]},{"t":"l","n":"Agenda","d":60,"B":[{"_":"badge","x":"PROGRAMA","i":"Calendar","b":"$E","c":"$A"},8,{"_":"heading","x":"Agenda do Dia","s":"2xl"},{"_":"steps","I":[{"title":"09:00","x":"Fundamentos LLM"},{"title":"13:30","x":"Agentes e MCP"}],"lnc":"$A","nc":"$A","tc":"$F","xc":"#64748b"}]},{"t":"d","n":"CTA","d":20,"B":[{"_":"heading","x":"Vamos Construir?","s":"3xl","w":700},12,{"_":"text","x":"info@agentia.pt","s":"lg","c":"$C"}]}]}
```

Key patterns in the example:
- `$A` = `#3B82F6` used 5× (badges, steps, accent) — saves ~16 tokens
- Themes absorb bg/color/accent/padding — each slide just says `"t":"d"` or `"t":"l"`
- Spacers are bare ints: `8`, `12`
- Steps items use `"title"` and `"x"` (text)
- Everything minified on one line

### Step 2: Ship (validate + assemble + deliver)

```bash
vela deck ship /home/claude/<deck-name>-slides.json
```

This runs expand → validate → assemble → copy in one call.

### Step 3: Present

```python
present_files(["/mnt/user-data/outputs/<deck>.jsx", "/mnt/user-data/outputs/<deck>-slides.json"])
```

## Workflow A½: Edit an Existing Deck

Use the `vela` CLI instead of `view` + `str_replace` — saves 80-97% tokens on typical edits.

### Inspect

```bash
vela deck list deck.json                  # TOC: slide#, title, blocks, theme, duration
vela slide view deck.json 3               # Compact block summary
vela slide view deck.json 3 --raw         # Full JSON for one slide
vela slide view deck.json 3 --json        # Structured output for agent consumption
```

### Edit

```bash
# Text replacement across entire deck (idempotent)
vela deck replace-text deck.json "old text" "new text"

# Slide-level property
vela slide edit deck.json 3 duration 90
vela slide edit deck.json 3 bg "#ffffff"

# Block-level property (use block.INDEX.KEY syntax)
vela slide edit deck.json 3 block.2.text "New heading"
vela slide edit deck.json 3 block.0.color "#3B82F6"

# Structural operations
vela slide remove deck.json 4
vela slide remove-block deck.json 3 5
vela slide move deck.json 5 2
vela slide duplicate deck.json 2
vela slide insert deck.json 3 new-slide.json
```

### Safety

```bash
# Preview destructive operations before executing
vela slide remove deck.json 3 --dry-run
# Returns: {"would_execute": "remove_slide", "title": "...", "reversible": false}
```

### Then ship

```bash
vela deck ship deck.json    # validate + assemble + copy in one call
```

### When to use what

| Task | Command | Why |
|---|---|---|
| Change a word/phrase everywhere | `vela deck replace-text` | 1 call vs N×str_replace |
| Change one slide property | `vela slide edit N key value` | No need to view JSON first |
| Change one block property | `vela slide edit N block.I.key value` | Precise, zero collateral |
| Remove/reorder slides | `vela slide remove/move` | Clean item-level removal |
| Check what slides exist | `vela deck list` | ~200 tokens vs ~800 for view |
| Check one slide | `vela slide view N` | ~150 tokens vs ~500 for view+range |
| Preview before destructing | Add `--dry-run` | Agent safety net |
| Full pipeline | `vela deck ship` | Replaces 3-4 tool calls with 1 |
| Rewrite a slide entirely | `vela slide view N --raw` → `str_replace` | Still best for full rewrites |
| Complex block structure changes | `str_replace` on JSON | CLI handles properties, not deep nesting |

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | General failure |
| 2 | Usage error (bad arguments) |
| 3 | Resource not found |
| 4 | Validation failure |
| 5 | Conflict |

All commands support `--json` for structured output (errors include `suggestions` and `retryable` fields).

## Workflow B & C: Edit the Vela App

> For app editing and updating, read `references/app-editing.md`.

## Deck JSON Format

### Full Deck (for assembly)

```json
{
  "deckTitle": "My Presentation",
  "lanes": [
    {
      "title": "Main",
      "items": [
        {
          "title": "Section Name",
          "status": "todo",
          "importance": "must",
          "slides": [ ...slide objects... ]
        }
      ]
    }
  ]
}
```

### Single Slide

```json
{
  "bg": "#0f172a",
  "bgGradient": "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
  "color": "#e2e8f0",
  "accent": "#3b82f6",
  "padding": "36px 48px",
  "duration": 60,
  "blocks": [ ... ]
}
```

## Critical Rules

### Canvas
- Virtual canvas: **960x540px** (16:9)
- Base padding: `"36px 48px"` — never less
- Max **5-7 blocks** per slide
- Left-aligned = full width. Center-aligned = shrink-wrap.

### Duration
- Every slide MUST have `duration` (integer, seconds)
- Title: 15-30s | Content: 60-90s | Dense: 90-180s | Metric: 20-40s | Quote: 15-30s

### Visual Design
- Every slide MUST have `bg` or `bgGradient`
- Size hierarchy: `3xl-4xl` titles > `2xl` headings > `lg` body > `md` supporting > `sm` captions
- Use icons generously. Use `spacer` blocks for breathing room.
- First slide = title (centered, gradient, 4xl). Last slide = closing (gradient, strong visual).
- Vary bg across slides — alternate solid/gradient, shift hues for section breaks.

### Block Selection
- **Don't default to heading+bullets** — vary layouts across slides
- `icon-row` > plain bullets for feature lists
- `flow` for processes | `flow loop:true` for cycles | `flow gate:true` for approvals
- `svg` for custom diagrams (use `{{accent}}`, `{{color}}`, `{{muted}}`, `{{bg}}` tokens)
- `grid` 2-3 cols for comparisons | `grid` 1 col + `direction:"row"` for layer diagrams
- `metric` for stats | `table` for structured data | `progress` for bars/spectrums
- `steps` for numbered sequences | `timeline` for roadmaps | `tag-group` for labels
- `callout` with icon for key insights

### Content Quality
- One key idea per slide. Billboard test — readable from the back.
- Headlines = assertions ("AI Cuts Costs 30%"), not labels ("Cost Analysis")

## Theming

See `references/themes.md` for palettes. Available directions: dark, midnight, light, warm light, vibrant, editorial, minimal. Custom brand colors supported.

## Icons

PascalCase Lucide names. 1000+ available. Common: `Zap, Brain, Rocket, Shield, Target, Clock, Users, Heart, Globe, Code, Database, Lightbulb, TrendingUp, BarChart, Lock, Eye, Cpu, Layers, Bot, Sparkles, Award, CheckCircle, AlertTriangle, DollarSign, ArrowRight`
