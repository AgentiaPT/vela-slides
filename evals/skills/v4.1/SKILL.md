---
name: vela-slides
version: 4.1.0
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

## Output Format — COMPACT KEYS ONLY

**CRITICAL: NEVER use full key names.** Always use compact short keys. The validator auto-expands.

| WRONG (verbose) | RIGHT (compact) |
|---|---|
| `"type":"heading"` | `"_":"heading"` |
| `"text":"Hello"` | `"x":"Hello"` |
| `"size":"2xl"` | `"s":"2xl"` |
| `"color":"#fff"` | `"c":"#fff"` |
| `"icon":"Zap"` | `"i":"Zap"` |
| `"items":[...]` | `"I":[...]` |
| `"blocks":[...]` | `"B":[...]` |
| `"deckTitle":"X"` | `"n":"X"` |
| `"slides":[...]` | `"S":[...]` |
| `"themes":{...}` | `"T":{...}` |
| `"lanes":[...]` | use flat `"S"` or `"G"` |

Write minified on one line. Structure:

```
{"n":"Title","C":{palette},"T":{themes},"S":[slides]}
```

**`C`** — Color palette. Map every color used 2+ times to `$A`-`$Z` aliases. Hex must be exactly 6 chars (`#3B82F6`) or 8 for alpha (`#3B82F620`). Never 7 chars.

**`T`** — Define 2 dark themes for bg alternation. Keys: `b`(bg), `c`(color), `a`(accent), `p`(CSS padding string).
- `"d"`: dark primary, e.g. `{"b":"#0A0F1C","c":"#E6F1FF","a":"$A","p":"60px 72px"}`
- `"a"`: dark alt (visibly different shade), e.g. `{"b":"#1e293b","c":"#E6F1FF","a":"$A","p":"36px 48px"}`
You MUST alternate `"t":"d"` and `"t":"a"` across slides. Both must be dark/neutral shades — never bright accent colors as bg.

**`S`** — Slides. Each: `{"t":"d"|"a","n":"Title","d":60,"B":[blocks]}`
- `d` = duration in seconds. MUST be a realistic integer: cover 20, content 60-90, CTA 25. Never 0,1,2,3...
- Cover/CTA: add `"bgGradient":"linear-gradient(135deg, ...)","align":"center","verticalAlign":"center"`
- Spacers: bare integer (vary: 8, 12, 16, 24 — never all the same)
- For decks with 10+ slides, group slides into sections using `"G":[{"g":"Section Title","S":[slides]}, ...]` instead of flat `"S"`.

**Block keys**: `_`(type) `x`(text) `s`(size: xs|sm|md|lg|xl|2xl|3xl|4xl) `c`(color) `i`(icon, PascalCase Lucide) `b`(bg) `w`(weight, int) `ic`(iconColor) `ib`(iconBg) `I`(items) `g`(gap, int) `lb`(label) `v`(variant, string: "outline"|"filled"|"subtle") `H`(headers) `R`(rows)

## Block Types — Compact Examples

`heading`: `{"_":"heading","x":"Title","s":"2xl","w":700}`
`text`: `{"_":"text","x":"Body text.","s":"lg","c":"$C"}`
`badge`: `{"_":"badge","x":"LABEL","i":"Zap","b":"$E","c":"$A"}`
`code`: `{"_":"code","x":"console.log('hi')","lb":"JavaScript"}`
`quote`: `{"_":"quote","x":"Quote text.","author":"Name"}`
`callout`: `{"_":"callout","x":"Note text","title":"Warning","b":"#1e293b","i":"AlertTriangle"}`
`icon-row`: `{"_":"icon-row","I":[{"i":"Brain","title":"AI","x":"Description","ic":"$A","ib":"$E"}]}` — each item MUST have different `ic`
`tag-group`: `{"_":"tag-group","I":[{"x":"Tag","c":"$A","i":"Check"}],"v":"outline"}` — `v` MUST be string
`grid`: `{"_":"grid","I":[{"blocks":[{"_":"heading","x":"Cell","s":"lg"}],"style":{"padding":"20px","background":"$F"}}]}` — cells MUST have `"blocks":[...]`
`metric`: `{"_":"metric","value":"98%","lb":"Accuracy","s":"3xl","c":"$A"}`
`progress`: `{"_":"progress","value":75,"lb":"Complete","c":"$A"}`
`table`: `{"_":"table","H":["Name","Score"],"R":[["Alice","95"],["Bob","87"]],"hb":"$A","hc":"#fff"}`
`flow`: `{"_":"flow","I":[{"i":"Upload","lb":"Input"},{"i":"Cpu","lb":"Process"},{"i":"Download","lb":"Output"}],"ac":"$A"}`
`steps`: `{"_":"steps","I":[{"title":"Step 1","x":"Do this"}],"lnc":"$A"}`
`timeline`: `{"_":"timeline","I":[{"title":"Q1","x":"Launch"}],"dc":"$A"}`
`bullets`: `{"_":"bullets","I":["Point one","Point two"]}`
`image`: `{"_":"image","url":"https://...","alt":"desc"}`
`svg`: `{"_":"svg","code":"<svg>...</svg>"}`
`spacer`: `12` (bare integer, NOT `{"_":"spacer","h":12}`)
`divider`: `{"_":"divider","c":"$C"}`

## Key Quality Rules

- **Heading sizes MUST vary**: `4xl` cover → `2xl` body → `3xl` CTA
- **Headlines**: specific assertions with data ("AI Cuts Resolution Time 55%"), never vague labels
- **Alternate themes** `d`/`a` across slides for bg variety
- Badge on every content slide
- Use named competitors in tables, concrete pricing/metrics in data
- Canvas: **960x540px** (16:9). Max 5-7 blocks per slide.
- First slide = title (centered, gradient, 4xl). Last slide = closing (gradient, strong visual).

## Complete Example (3-slide deck)

```
{"n":"AI Workshop","C":{"$A":"#3B82F6","$B":"#E6F1FF","$C":"#8892B0","$D":"#0A0F1C","$E":"#3B82F620","$F":"#1e293b"},"T":{"d":{"b":"$D","c":"$B","a":"$A","p":"60px 72px"},"a":{"b":"$F","c":"$B","a":"$A","p":"36px 48px"}},"S":[{"t":"d","n":"Cover","d":20,"bgGradient":"linear-gradient(135deg,$D,$F)","align":"center","verticalAlign":"center","B":[{"_":"badge","x":"WORKSHOP","i":"GraduationCap","b":"$E","c":"$A"},8,{"_":"heading","x":"AI for Teams","s":"4xl","w":700},{"_":"text","x":"Hands-on training with LLMs and agents.","s":"lg","c":"$C"}]},{"t":"a","n":"Agenda","d":60,"B":[{"_":"badge","x":"PROGRAM","i":"Calendar","b":"$E","c":"$A"},8,{"_":"heading","x":"Today's Agenda","s":"2xl"},{"_":"steps","I":[{"title":"09:00","x":"LLM Fundamentals"},{"title":"11:00","x":"Prompt Engineering"},{"title":"13:30","x":"Agents & MCP"}],"lnc":"$A","nc":"$A"}]},{"t":"d","n":"CTA","d":20,"bgGradient":"linear-gradient(135deg,$F,$D)","align":"center","verticalAlign":"center","B":[{"_":"heading","x":"Ready to Build?","s":"3xl","w":700},12,{"_":"text","x":"team@company.com","s":"lg","c":"$C"}]}]}
```

## Workflow

1. Write compact JSON to requested file (minified, one line, short keys ONLY)
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
