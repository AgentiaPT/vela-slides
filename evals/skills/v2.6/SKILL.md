---
name: vela-slides
version: 2.6.0
updated: 2026-03-23
description: Create, edit, translate, rebrand, or present slide decks using the Vela presentation engine. Use when the user wants to build a presentation from a topic, outline, or document; restyle or rebrand an existing deck; edit individual slides; export to PDF; or modify the Vela app itself. Trigger even if the user says "slides", "deck", "presentation", or "keynote" without mentioning Vela by name.
license: ELv2
compatibility: Requires Python 3 and Bash. Designed for Claude Code. Assembled artifacts run in Claude.ai.
allowed-tools: Bash(python3:*) Bash(vela:*) Read Write
---

# Vela Slides Skill

> **v2.6.0** · 2026-03-23 · CLI optimizations (split, dump, stats, find, extract-text/patch-text), 82 tests, live serve with long-polling

Generate presentation-ready slide decks and assemble them into runnable Vela .jsx artifacts. Also supports modular editing of the Vela app itself.

## When to Use

- User wants to create a slide deck / presentation
- User provides a topic, agenda, outline, or document to turn into slides
- User wants to restyle or improve existing Vela slide JSON
- User wants to fix bugs or add features to the Vela app itself
- User asks for "Vela slides", "deck", or "presentation" content

## References (load on demand)

- `references/block-schema.md` — Read when **creating a new deck** or adding unfamiliar block types
- `references/design-patterns.md` — Read when **designing a deck from scratch** (archetypes, anti-patterns, density rules)
- `references/themes.md` — Read when user asks about **theming, restyling, or brand customization**
- `references/formats.md` — Read when you need **turbo format details, conversion commands, or benchmarks**
- `references/app-editing.md` — Read when **editing the Vela app itself** (part-files, concat, template)

## Vela CLI Setup

The `vela` CLI is a single entry point for all deck operations. Setup depends on environment:

**Claude.ai artifacts** (skill mounted at `/mnt/skills/`):
```bash
export PATH="/home/claude/.local/bin:$PATH"
ln -sf /mnt/skills/user/vela-slides/scripts/vela.py /home/claude/.local/bin/vela
```

**Claude Code** (local project): call the script directly — no symlink needed:
```bash
python3 skills/vela-slides/scripts/vela.py <resource> <action> [args...]
# Or create an alias for the session:
alias vela='python3 /path/to/skills/vela-slides/scripts/vela.py'
```

Discovery (zero turns wasted):
```bash
vela --capabilities   # JSON index of all commands, flags, exit codes
vela --help           # Human-readable overview
```

## Formats

Vela supports three JSON formats (full, compact, turbo). All CLI commands auto-detect and auto-expand. For conversion commands, turbo details, and benchmarks, read `references/formats.md`.

### Compact Format (use when generating decks)

**Always generate in compact format** — saves ~32% output tokens. Short keys, flat slides array, theme presets, spacer shorthand, color palette aliases. The CLI auto-expands on ship/validate.

#### Compact key reference

**Top-level**: `n`=deckTitle, `T`=themes, `C`=color palette, `S`=slides array

**Slide level**: `t`=theme ref, `n`=title, `d`=duration, `B`=blocks, `p`=padding (only if overriding theme)

**Block level**: `_`=type, `x`=text, `s`=size, `c`=color, `i`=icon, `b`=bg, `w`=weight, `ic`=iconColor, `ib`=iconBg, `I`=items, `B`=blocks (nested), `g`=gap, `lb`=label, `v`=variant, `H`=headers, `R`=rows, `sl`=sublabel, `slc`=sublabelColor, `ac`=arrowColor, `lc`=labelColor, `ts`=titleSize, `xs`=textSize, `hb`=headerBg, `hc`=headerColor, `cc`=cellColor, `bc`=borderColor, `str`=striped, `lo`=loop, `lnc`=lineColor, `nc`=numberColor, `tc`=titleColor, `xc`=textColor, `dc`=dotColor, `cir`=circle, `dir`=direction

**Color palette (`C`)**: define every color used ≥2× as `"$A":"#hex"`. Use `$A` everywhere instead of raw hex. Assign in frequency order ($A = most common).

**Theme palette (`T`)**: `"d"`:dark, `"l"`:light, `"a"`:alt. Keys: `b`=bg, `c`=color, `a`=accent, `p`=padding. Theme values can use `$` aliases too.

**Spacers**: bare int `8` instead of `{"_":"spacer","h":8}`

**Note:** `v` maps to `variant`, NOT `value`. For block-specific properties without a compact alias (e.g., `value`, `cols`, `bgGradient`, `align`, `verticalAlign`, `gateIcon`, `dateColor`), use the full property name — the CLI expands them correctly.

## Workflow A: Generate a Deck (most common)

### Step 1: Generate Compact JSON

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

**Output defaults to current working directory.** Override with `--output`:

```bash
vela deck ship deck.json --output /path/to/output.jsx
```

Or set `VELA_OUTPUT_DIR` environment variable to change the default.

### Step 3: Present

```python
present_files(["/mnt/user-data/outputs/<deck>.jsx", "/mnt/user-data/outputs/<deck>-slides.json"])
```

<!-- BEGIN AUTO-GENERATED CLI REFERENCE -->

### CLI Quick Reference (v2.6.0)

**`vela deck`** — Deck-level operations (auto-detects full/compact/turbo format)

```
vela deck list <deck.json> — TOC with slide#, title, blocks, duration
vela deck validate <deck.json> — check deck JSON integrity
vela deck split <deck.json> --sections "Title:N,..." | --flat | --size N — regroup slides into sections (--flat to merge all into one)
vela deck assemble <deck.json> [--output <path>] — inject deck into JSX artifact
vela deck ship <deck.json> [--output <path>] — validate + assemble in one call
vela deck replace-text <deck.json> "old" "new" — find/replace across all slides (hex colors auto-cascade to rgba)
vela deck stats <deck.json> — health audit: block distribution, missing durations, overflow, monotony issues
vela deck find <deck.json> --query "text" | --type flow | --missing duration — search slides by content, block type, or missing props
vela deck dump <deck.json> [--full] — compact text-only view of all slides (--full for all text fields)
vela deck extract-text <deck.json> [output.json] — extract all translatable text as key-value map
vela deck patch-text <deck.json> <texts.json> — apply translated text map back into deck
vela deck expand <compact.json> <full.json> — compact/turbo → full format
vela deck compact <full.json> <compact.json> — full → compact format
vela deck turbo <deck.json> <turbo.json> — any → turbo format
vela deck serve <deck.json> [--port N] — live preview with two-way sync
```

**`vela slide`** — Slide-level operations (1-indexed slide numbers)

```
vela slide view <deck.json> <N> — show slide content summary
vela slide edit <deck.json> <N> <key> <value> — edit slide/block property (block.I.key for blocks)
vela slide remove <deck.json> <N> — remove a slide
vela slide move <deck.json> <from> <to> — reorder a slide
vela slide duplicate <deck.json> <N> — copy a slide
vela slide insert <deck.json> <N> <slide.json> — insert slide from file
vela slide remove-block <deck.json> <N> <block#> — remove a block from a slide
```

**Global flags:** `--json (structured output)`, `--dry-run (preview without writing)`, `--help`

**Exit codes:** 0=success, 1=failure, 2=usage error, 3=not found, 4=validation error, 5=conflict

<!-- END AUTO-GENERATED CLI REFERENCE -->

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

### Validate After Edits

```bash
# Always validate after editing
vela deck validate deck.json --json   # check for errors
# Fix reported issues, then re-validate until exit code 0

# Use --dry-run before destructive operations (remove, move, replace-text)
vela slide remove deck.json 3 --dry-run
# Returns: {"would_execute": "remove_slide", "title": "...", "reversible": false}
```

To build the final runnable artifact (rare — only when user wants the .jsx):
```bash
vela deck ship deck.json    # validate + assemble + copy in one call
```

### When to use what

| Task | Command | Why |
|---|---|---|
| Translate / bulk text rewrite | `extract-text` + `patch-text` | 2 calls vs N×replace-text |
| Change a word/phrase everywhere | `vela deck replace-text` | 1 call vs N×str_replace |
| Change one slide property | `vela slide edit N key value` | No need to view JSON first |
| Change one block property | `vela slide edit N block.I.key value` | Precise, zero collateral |
| Remove/reorder slides | `vela slide remove/move` | Clean item-level removal |
| Split into sections | `vela deck split --sections "A:3,B:5"` | One call, agent decides grouping |
| Flatten to one module | `vela deck split --flat` | Merge all sections into one |
| Regroup sections | `vela deck split --sections "..."` | Works on multi-module decks (flattens first) |
| Check what slides exist | `vela deck list` | ~200 tokens vs ~800 for view |
| Check one slide | `vela slide view N` | ~150 tokens vs ~500 for view+range |
| Preview before destructing | Add `--dry-run` | Agent safety net |
| Full pipeline | `vela deck ship` | Replaces 3-4 tool calls with 1 |
| Rewrite a slide entirely | `vela slide view N --raw` → `str_replace` | Still best for full rewrites |
| Complex block structure changes | `str_replace` on JSON | CLI handles properties, not deep nesting |

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
- **Default slide count**: if user gives no outline, default to 6-8 slides. If they provide N topics, use N+2 (cover + closing).
- **Invent plausible content** when the user provides a topic but no specifics. Never use placeholder brackets like `[Your Name]`.

### Gotchas
- **`align: "center"` + SVG/divider/progress = invisible blocks.** These blocks have no intrinsic width and collapse to zero. Use `align: "left"` at slide level + per-block `"align": "center"`. For SVG blocks, add `"maxWidth": "60%"` + `"align": "center"` on the block itself.
- **Duration is required** on every slide — there is no default. Omitting it causes validation failure.
- **Color palette `$A` aliases must be defined in `C`** before use. Undefined aliases render as literal text.
- **Canvas is 960x540px** — block coordinates and sizes must stay within these limits.
- **Compact spacers are bare ints** — `8` not `{"_":"spacer","h":8}`. Generating the object form wastes tokens.
- **Removing multiple slides? Remove from highest index first** to avoid re-indexing shifting which slide gets removed.

## Theming

See `references/themes.md` for palettes. Available directions: dark, midnight, light, warm light, vibrant, editorial, minimal. Custom brand colors supported.

## Icons

PascalCase Lucide names. 1000+ available. Common: `Zap, Brain, Rocket, Shield, Target, Clock, Users, Heart, Globe, Code, Database, Lightbulb, TrendingUp, BarChart, Lock, Eye, Cpu, Layers, Bot, Sparkles, Award, CheckCircle, AlertTriangle, DollarSign, ArrowRight`
