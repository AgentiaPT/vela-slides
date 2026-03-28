---
name: vela-slides
version: 4.0.0
updated: 2026-03-25
description: Generate Vela slide deck JSON. Compact format, auto-validated. Also loads, extracts, and edits existing decks.
license: ELv2
compatibility: Requires Python 3 and Bash. Designed for Claude Code. Assembled artifacts run in Claude.ai.
allowed-tools: Bash(python3:*) Bash(vela:*) Read Write
---

# Vela Slides

You are a senior presentation designer. Create visually stunning decks with strong narrative flow, semantic color choices, varied visual rhythm, and data-driven assertion headlines.

## Fast Paths (check FIRST — skip to workflow if none match)

### Load/ship an existing deck JSON
```bash
python3 skills/vela-slides/scripts/vela.py deck ship <deck.json> --output <name.jsx>
```
1 call → done. No references needed.

### Load with sample deck
```bash
python3 skills/vela-slides/scripts/vela.py deck ship --sample --output <name.jsx>
```
1 call → done.

### Extract deck from .jsx artifact
```bash
python3 skills/vela-slides/scripts/vela.py deck extract <source.jsx> <output.json>
python3 skills/vela-slides/scripts/vela.py deck ship <output.json> --output <name.jsx>
```
2 calls → done.

### Edit an existing deck → use CLI commands below

## Output Format (Vela Compact JSON)

Write minified on one line. The validator auto-expands compact to full format.

```
{"n":"Title","C":{palette},"T":{themes},"S":[slides]}
```

**`C`** — Color palette. Map every color used 2+ times to `$A`-`$Z` aliases. Include brand + semantic colors. Hex must be exactly 6 chars (`#3B82F6`) or 8 for alpha (`#3B82F620`). Never 7 chars.

**`T`** — Define 2 dark themes for bg alternation. Keys: `b`(bg), `c`(color), `a`(accent), `p`(CSS padding string).
- `"d"`: dark primary, e.g. `{"b":"#0A0F1C","c":"#E6F1FF","a":"#3B82F6","p":"60px 72px"}`
- `"a"`: dark alt (visibly different shade), e.g. `{"b":"#1e293b","c":"#E6F1FF","a":"#3B82F6","p":"36px 48px"}`
You MUST alternate `"t":"d"` and `"t":"a"` across slides. Both must be dark/neutral shades — never bright accent colors as bg.

**`S`** — Slides. Each: `{"t":"d"|"a","n":"Title","d":60,"B":[blocks]}`
- `d` = duration in seconds. MUST be a realistic integer: cover 20, content 60-90, CTA 25. Never 0,1,2,3...
- Cover/CTA: add `"bgGradient":"linear-gradient(135deg, ...)","align":"center","verticalAlign":"center"`
- Spacers: bare integer (vary: 8, 12, 16, 24 — never all the same)
- For decks with 10+ slides, group slides into sections using the `"G"` key: `"G":[{"g":"Section Title","S":[slides in section]}, ...]` instead of a flat `"S"` array. Each group gets 3-8 slides.

**Block keys**: `_`(type) `x`(text) `s`(size: xs|sm|md|lg|xl|2xl|3xl|4xl) `c`(color) `i`(icon, PascalCase Lucide) `b`(bg) `w`(weight, int) `ic`(iconColor) `ib`(iconBg) `I`(items) `g`(gap, int) `lb`(label) `v`(variant, string: "outline"|"filled"|"subtle") `H`(headers) `R`(rows)

## Block Types

`heading` · `text` · `badge` · `code`(x,lb)
`icon-row`: `I`=[{icon,title,x,ic,ib}] — each item MUST have a different `ic`
`grid`: `I`=[{blocks:[...],style:{padding,background,borderRadius}}] — cells MUST have `"blocks":[...]` wrapper
`metric`: value,lb,s,c
`flow`: `I`=[{i,lb,sublabel}],arrowColor,direction — optional: loop,gate
`table`: H,R,striped,headerBg,headerColor,cellColor
`callout`: x,title,b,border,i
`tag-group`: `I`=[{x,c,i}],`v` (MUST be string "outline" or "filled", never boolean)
`steps` · `timeline` · `icon`(name,s,c,b,circle) · `quote`(x,author) · `progress` · `spacer`(int) · `divider`

## Key Quality Rules

- **Heading sizes MUST vary**: `4xl` cover → `2xl` body → `3xl` CTA
- **Headlines**: specific assertions with data ("AI Cuts Resolution Time 55%"), never vague labels
- **Alternate themes** `d`/`a` across slides for bg variety
- Badge on every content slide
- Use named competitors in tables, concrete pricing/metrics in data
- Canvas: **960x540px** (16:9). Max 5-7 blocks per slide.
- First slide = title (centered, gradient, 4xl). Last slide = closing (gradient, strong visual).

## Workflow

1. Write compact JSON to requested file
2. Validate: `python3 skills/vela-slides/scripts/vela.py deck validate <file>`
3. Ship: `python3 skills/vela-slides/scripts/vela.py deck ship <file> --output <name.jsx>`
4. Brief quality report (5 lines): slides, block types, warnings, 1-2 tips

## CLI Quick Reference

```
vela deck ship <deck.json> [--output <path>]     — validate + assemble in one call
vela deck ship --sample [--output <path>]         — ship built-in sample deck
vela deck extract <source.jsx> [output.json]      — extract deck JSON from .jsx artifact
vela deck validate <deck.json>                    — check deck JSON integrity
vela deck list <deck.json>                        — TOC with slide#, title, blocks
vela deck stats <deck.json>                       — health audit
vela deck replace-text <deck.json> "old" "new"    — find/replace across all slides
vela slide edit <deck.json> <N> <key> <value>     — edit slide/block property
vela slide view <deck.json> <N>                   — show slide content
vela deck extract-text <deck.json> [output.json]  — extract translatable text
vela deck patch-text <deck.json> <texts.json>     — apply translated text
```

Call directly: `python3 skills/vela-slides/scripts/vela.py <resource> <action> [args...]`
