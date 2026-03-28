---
name: vela-slides
version: 2.3.0
updated: 2026-03-20
description: Generate high-quality Vela-compatible slide deck JSON from topics, outlines, documents, or existing slide content. Produces structured slide objects with 22+ block types including SVG diagrams and loop flows, theming, and presentation-ready layouts. Assembles final .jsx artifact with embedded deck data, ready for immediate use. Use when users want to create, populate, or restyle slide decks for Vela — the React-based presentation engine.
---

# Vela Slides Skill

> **v2.3.0** · CLI with 12 subcommands, full JSON format only

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

Discovery (zero turns wasted):
```bash
vela --capabilities   # JSON index of all commands, flags, exit codes
vela --help           # Human-readable overview
```

## Workflow A: Generate a Deck (most common)

### Step 1: Generate Full Deck JSON

Create a deck JSON file in full format. Save to `/home/claude/<deck-name>-slides.json`.

```json
{
  "deckTitle": "My Presentation",
  "lanes": [
    {
      "title": "Main",
      "items": [
        {
          "title": "Section Name",
          "status": "done",
          "importance": "must",
          "slides": [
            {
              "title": "Slide Title",
              "bg": "#0A0F1C",
              "color": "#E6F1FF",
              "accent": "#3B82F6",
              "padding": "36px 48px",
              "duration": 60,
              "blocks": [
                {"type": "badge", "text": "LABEL", "icon": "Star", "bg": "#3B82F620", "color": "#3B82F6"},
                {"type": "spacer", "h": 8},
                {"type": "heading", "text": "Title", "size": "2xl"},
                {"type": "text", "text": "Body text here", "size": "lg", "color": "#8892B0"}
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

### Step 2: Ship (validate + assemble + deliver)

```bash
vela deck ship /home/claude/<deck-name>-slides.json
```

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
```

### Edit

```bash
vela deck replace-text deck.json "old text" "new text"
vela slide edit deck.json 3 duration 90
vela slide edit deck.json 3 block.2.text "New heading"
vela slide remove deck.json 4
vela slide move deck.json 5 2
vela slide duplicate deck.json 2
vela slide insert deck.json 3 new-slide.json
```

### Safety

```bash
vela slide remove deck.json 3 --dry-run
```

### Then ship

```bash
vela deck ship deck.json
```

## Critical Rules

### Canvas
- Virtual canvas: **960x540px** (16:9)
- Base padding: `"36px 48px"` — never less
- Max **5-7 blocks** per slide
- Left-aligned = full width. Center-aligned = shrink-wrap.

### Duration
- Every slide MUST have `duration` (integer, seconds)
- Title: 15-30s | Content: 60-90s | Dense: 90-180s

### Visual Design
- Every slide MUST have `bg` or `bgGradient`
- Size hierarchy: `3xl-4xl` titles > `2xl` headings > `lg` body > `md` supporting > `sm` captions
- Use icons generously. Use `spacer` blocks for breathing room.
- First slide = title (centered, gradient, 4xl). Last slide = closing (gradient, strong visual).

### Block Selection
- Don't default to heading+bullets — vary layouts
- `icon-row` > plain bullets for feature lists
- `flow` for processes | `grid` for comparisons | `table` for data
- `steps` for numbered sequences | `callout` for key insights

## Theming

See `references/themes.md` for palettes.

## Icons

PascalCase Lucide names. 1000+ available. Common: `Zap, Brain, Rocket, Shield, Target, Clock, Users, Heart, Globe, Code, Database, Lightbulb, TrendingUp, BarChart, Lock, Eye, Cpu, Layers, Bot, Sparkles`
