---
name: vela-slides
version: 2.4.0
updated: 2026-03-20
description: Generate high-quality Vela-compatible slide deck JSON from topics, outlines, documents, or existing slide content. Produces structured slide objects with 22+ block types including SVG diagrams and loop flows, theming, and presentation-ready layouts. Assembles final .jsx artifact with embedded deck data, ready for immediate use. Use when users want to create, populate, or restyle slide decks for Vela — the React-based presentation engine.
---

# Vela Slides Skill

> **v2.4.0** · Compact format (~30% fewer LLM tokens), `vela deck compact/expand`, auto-expand pipeline

Generate presentation-ready slide decks and assemble them into runnable Vela .jsx artifacts.

## When to Use

- User wants to create a slide deck / presentation
- User provides a topic, agenda, outline, or document to turn into slides
- User wants to restyle or improve existing Vela slide JSON

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

## Compact Format (~30% fewer LLM tokens)

When generating a new deck, the LLM outputs **compact JSON** — minified, with short keys, flat slides array, theme presets, and spacer shorthand. The CLI auto-expands to full Vela JSON on `ship`.

| Full JSON | Compact JSON |
|---|---|
| `"type": "heading"` | `"_": "heading"` |
| `"text": "..."` | `"x": "..."` |
| `{"type":"spacer","h":8}` | `8` |
| `"bg":"#0A0F1C",...` per slide | `"t":"d"` (theme ref) |
| `"lanes":[{"items":[{"slides":[...]}]}]` | `"S":[...]` |

### Compact key reference

Slide level: `n`=title, `d`=duration, `t`=theme, `B`=blocks, `p`=padding

Block level: `_`=type, `x`=text, `s`=size, `c`=color, `i`=icon, `b`=bg, `ic`=iconColor, `I`=items, `B`=blocks, `g`=gap, `lb`=label, `w`=weight, `H`=headers, `R`=rows

### Commands

```bash
vela deck compact full.json compact.json
vela deck expand compact.json full.json
vela deck ship compact.json    # auto-expands
```

## Workflow A: Generate a Deck (most common)

### Step 1: Generate Compact JSON

**Always generate in compact format** — saves ~30% output tokens.

Rules:
1. Top-level: `{"n":"Title","T":{themes},"S":[slides]}`
2. Themes (`T`): group slides by bg/color/accent/padding. `"d"` = dark, `"l"` = light.
3. Slides (`S`): flat array. Each slide has `"t":"d"`, `"n"`, `"d"`, `"B"`.
4. Blocks: short keys (`_`=type, `x`=text, `s`=size, etc.)
5. Spacers: just the int `8` instead of `{"_":"spacer","h":8}`
6. Minified: no whitespace.

#### Example (3-slide compact deck)

```json
{"n":"AI Workshop","T":{"d":{"b":"#0A0F1C","c":"#E6F1FF","a":"#3B82F6","p":"60px 72px"},"l":{"b":"#ffffff","c":"#1e293b","a":"#3B82F6","p":"36px 48px"}},"S":[{"t":"d","n":"Cover","d":15,"B":[{"_":"badge","x":"WORKSHOP","i":"GraduationCap","b":"#3B82F620","c":"#3B82F6"},8,{"_":"heading","x":"AI para Equipas","s":"3xl","w":700},{"_":"text","x":"Formação prática com LLMs.","s":"lg","c":"#8892B0"}]},{"t":"l","n":"Agenda","d":60,"B":[{"_":"badge","x":"PROGRAMA","i":"Calendar","b":"#3B82F615","c":"#3B82F6"},8,{"_":"heading","x":"Agenda do Dia","s":"2xl"},{"_":"steps","I":[{"title":"09:00","x":"Fundamentos"},{"title":"13:30","x":"Agentes"}],"lnc":"#3B82F6","nc":"#3B82F6","tc":"#1e293b","xc":"#64748b"}]},{"t":"d","n":"CTA","d":20,"B":[{"_":"heading","x":"Vamos Construir?","s":"3xl","w":700},12,{"_":"text","x":"info@agentia.pt","s":"lg","c":"#8892B0"}]}]}
```

### Step 2: Ship

```bash
vela deck ship /home/claude/<deck-name>-slides.json
```

### Step 3: Present

```python
present_files(["/mnt/user-data/outputs/<deck>.jsx", "/mnt/user-data/outputs/<deck>-slides.json"])
```

## Workflow A½: Edit an Existing Deck

```bash
vela deck list deck.json
vela slide view deck.json 3
vela slide edit deck.json 3 block.2.text "New heading"
vela deck replace-text deck.json "old text" "new text"
vela slide remove deck.json 4
vela slide move deck.json 5 2
vela slide duplicate deck.json 2
vela slide insert deck.json 3 new-slide.json
vela deck ship deck.json
```

## Critical Rules

### Canvas
- Virtual canvas: **960x540px** (16:9)
- Base padding: `"36px 48px"` — never less
- Max **5-7 blocks** per slide

### Duration
- Every slide MUST have `duration` (integer, seconds)
- Title: 15-30s | Content: 60-90s | Dense: 90-180s

### Visual Design
- Every slide MUST have `bg` or `bgGradient`
- Size hierarchy: `3xl-4xl` titles > `2xl` headings > `lg` body > `sm` captions
- Use icons generously. Use `spacer` blocks for breathing room.

### Block Selection
- Don't default to heading+bullets — vary layouts
- `icon-row` > plain bullets | `flow` for processes | `grid` for comparisons
- `steps` for sequences | `callout` for insights | `table` for data

## Theming

See `references/themes.md` for palettes.

## Icons

PascalCase Lucide names. Common: `Zap, Brain, Rocket, Shield, Target, Clock, Users, Heart, Globe, Code, Database, Lightbulb, TrendingUp, BarChart, Lock, Eye, Cpu, Layers, Bot, Sparkles`
