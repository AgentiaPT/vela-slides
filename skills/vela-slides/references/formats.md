# Vela JSON Formats — Detailed Reference

## Format Detection

| Format | Detection | Token savings | Use case |
|---|---|---|---|
| **Full** | has `"lanes"` key | baseline | editing, shipping, human-readable |
| **Compact** | has `"S"` key | ~32% fewer | LLM generation (named keys = reliable) |
| **Turbo** | top-level is array | ~47% fewer | storage, cache, inter-LLM context |

Pipeline: any format → `_load_full()` auto-expands → validate → assemble → ship.

## Compact Format — Full Key Reference

### Key Differences from Full Format

| Full JSON | Compact JSON | Savings |
|---|---|---|
| `"type": "heading"` | `"_": "heading"` | shorter keys |
| `"text": "..."` | `"x": "..."` | shorter keys |
| `{"type":"spacer","h":8}` | `8` | spacer → int |
| `"bg":"#0A0F1C","color":"#E6F1FF",...` per slide | `"t":"d"` (theme ref) | theme presets |
| `"lanes":[{"items":[{"slides":[...]}]}]` | `"S":[...]` | flat structure |
| `"#3B82F6"` repeated 28× | `"$A"` + `"C":{"$A":"#3B82F6"}` | color palette |

### Compact Key Mapping

**Top-level**: `n`=deckTitle, `T`=themes, `C`=color palette, `S`=slides array

**Slide level**: `t`=theme ref, `n`=title, `d`=duration, `B`=blocks, `p`=padding (only if overriding theme)

**Block level**: `_`=type, `x`=text, `s`=size, `c`=color, `i`=icon, `b`=bg, `w`=weight, `ic`=iconColor, `ib`=iconBg, `I`=items, `B`=blocks (nested), `g`=gap, `lb`=label, `v`=variant, `H`=headers, `R`=rows, `sl`=sublabel, `slc`=sublabelColor, `ac`=arrowColor, `lc`=labelColor, `ts`=titleSize, `xs`=textSize, `hb`=headerBg, `hc`=headerColor, `cc`=cellColor, `bc`=borderColor, `str`=striped, `lo`=loop, `lnc`=lineColor, `nc`=numberColor, `tc`=titleColor, `xc`=textColor, `dc`=dotColor, `cir`=circle, `dir`=direction

**Color palette (`C`)**: define every color used ≥2× as `"$A":"#hex"`. Use `$A` everywhere instead of raw hex. Assign in frequency order ($A = most common).

**Theme palette (`T`)**: `"d"`:dark, `"l"`:light, `"a"`:alt. Keys: `b`=bg, `c`=color, `a`=accent, `p`=padding. Theme values can use `$` aliases too.

**Spacers**: bare int `8` instead of `{"_":"spacer","h":8}`

### Compact Conversion Commands

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

## Turbo Format (~47% fewer tokens)

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

## Workflow with Formats

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

## Benchmark (6-slide deck, 16 operations)

```
Baseline (full+minified):  4,955 bytes
Compact (short keys+palette): 3,363 bytes (32.1% smaller)
Turbo (positional arrays):    2,600 bytes (47.5% smaller)

All CLI operations work on any format: list, view, edit, replace-text,
insert, move, duplicate, remove, remove-block, validate, ship.
```
