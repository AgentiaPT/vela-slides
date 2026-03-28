---
name: vela-slides
version: 3.1.0
updated: 2026-03-21
description: Generate Vela slide deck JSON. 22+ block types, compact format with color palette. Self-contained — no external references needed.
---

# Vela Slides Skill

> **v3.1.0** · Self-contained, compact format + color palette

## Vela CLI

```
python3 /path/to/vela.py deck validate <deck.json>
python3 /path/to/vela.py deck list <deck.json>
python3 /path/to/vela.py slide view <deck.json> N
python3 /path/to/vela.py slide edit <deck.json> N block.I.key "value"
python3 /path/to/vela.py deck replace-text <deck.json> "old" "new"
```

## Compact JSON Format

Output minified JSON on one line.

### Structure

```
{"n":"Deck Title","C":{color palette},"T":{themes},"S":[slides]}
```

**Full format** (for validation/assembly) wraps slides in lanes→items→slides:
```
{"deckTitle":"...","lanes":[{"title":"Main","items":[
  {"title":"Section 1","status":"done","importance":"must","slides":[...slides...]},
  {"title":"Section 2","status":"done","importance":"must","slides":[...slides...]}
]}]}
```

**IMPORTANT**: Group related slides into **items** (sections). A 30-slide deck should have 5-8 items with 3-6 slides each. NEVER put each slide in its own item.

### Color Palette `C`

Define every color used 2+ times as an alias. Assign `$A` to the most frequent, `$B` next, etc.

```json
"C":{"$A":"#3B82F6","$B":"#E6F1FF","$C":"#8892B0","$D":"#0A0F1C","$E":"#1e293b","$F":"#3B82F620","$G":"#10B981","$H":"#F59E0B"}
```

Rules:
- `$A`-`$F` for primary brand colors. `$G`+`$H` for secondary accents (green, amber, etc.)
- Use **2+ accent colors** in the palette — not just one blue. Add green/amber/purple for variety.
- NEVER map a hex to itself (`"#3B82F6":"#3B82F6"` is wrong). Always use `"$A":"#3B82F6"`.

### Themes `T`

```json
"T":{"d":{"b":"$D","c":"$B","a":"$A","p":"60px 72px"},"a":{"b":"$E","c":"$B","a":"$A","p":"36px 48px"},"l":{"b":"#ffffff","c":"#1e293b","a":"$A","p":"36px 48px"}}
```

- `"d"` = dark primary, `"a"` = dark alt (different bg), `"l"` = light
- `p` is CSS padding string (e.g. `"36px 48px"`). NEVER a color hex.
- Define 3 themes for variety.

### Slides `S`

Each slide: `t`=theme ref, `n`=title, `d`=duration (int seconds), `B`=blocks array.

- Spacers: bare int `8` instead of `{"_":"spacer","h":8}`
- Cover/CTA/section-break slides: add `bgGradient:"linear-gradient(135deg, $D 0%, $E 100%)"`, `align:"center"`, `verticalAlign:"center"`
- Use `"t":"l"` (light theme) when a slide contrasts with surrounding dark slides

### Block Keys

`_`=type, `x`=text, `s`=size, `c`=color, `i`=icon, `b`=bg, `w`=weight(int), `ic`=iconColor, `ib`=iconBg, `I`=items, `g`=gap(int px, NOT string), `lb`=label, `v`=variant, `H`=headers, `R`=rows

### Example (3-slide deck with sections)

```json
{"n":"AI Workshop","C":{"$A":"#3B82F6","$B":"#E6F1FF","$C":"#8892B0","$D":"#0A0F1C","$E":"#1e293b","$F":"#3B82F620","$G":"#10B981"},"T":{"d":{"b":"$D","c":"$B","a":"$A","p":"60px 72px"},"a":{"b":"$E","c":"$B","a":"$A","p":"36px 48px"}},"S":[{"t":"d","bgGradient":"linear-gradient(135deg, $D 0%, $E 100%)","n":"Cover","d":20,"align":"center","verticalAlign":"center","B":[{"_":"badge","x":"WORKSHOP","i":"GraduationCap","b":"$F","c":"$A"},8,{"_":"heading","x":"AI Transforma Equipas em 2026","s":"3xl","w":700},{"_":"text","x":"Formação prática com LLMs.","s":"lg","c":"$C"}]},{"t":"a","n":"Agenda","d":60,"B":[{"_":"badge","x":"PROGRAMA","i":"Calendar","b":"$F","c":"$A"},8,{"_":"heading","x":"4 Módulos, 1 Dia, Resultados Imediatos","s":"2xl"},{"_":"steps","I":[{"title":"09:00","x":"Fundamentos LLM"},{"title":"11:00","x":"Prompt Engineering"},{"title":"14:00","x":"Agentes e MCP"},{"title":"16:00","x":"Projeto Prático"}],"lnc":"$A","nc":"$A","tc":"$B","xc":"$C"}]},{"t":"d","bgGradient":"linear-gradient(135deg, $D 0%, #0f172a 100%)","n":"CTA","d":20,"align":"center","B":[{"_":"icon","name":"Rocket","s":"xl","c":"$A","b":"$F","circle":true},8,{"_":"heading","x":"Inscreva-se Hoje — Vagas Limitadas","s":"3xl","w":700},{"_":"text","x":"Próxima turma: Abril 2026","s":"lg","c":"$C"},12,{"_":"tag-group","I":[{"x":"Inscrever","c":"$A","i":"ArrowRight"},{"x":"Demo","c":"$G","i":"Play"},{"x":"info@co.pt","c":"$C","i":"Mail"}],"v":"outline"}]}]}
```

## Block Types

**Text**: heading(`x`,`s`:xs→4xl,`w`,`i`,`ic`), text(`x`,`s`,`c`,maxWidth), badge(`x`,`c`,`b`,`i`), code(`x`,`lb`,`s`,`b`,`c`)
**Lists**: icon-row(`I`=[{icon,title,x,ic,ib}] — **distinct `ic` per item**), tag-group(`I`=[{x,c,i}],`v`:filled|outline|subtle), bullets(`I`,dotColor)
**Data**: table(`H`,`R`,striped,headerBg,headerColor,cellColor,borderColor), grid(cols 2-3,`g`,`I`=[{blocks,style}]), metric(value,`lb`,`s`,`c`,`i`,`ic`)
**Process**: flow(`I`=[{i,lb,sublabel,gate:bool}],arrowColor,direction:horizontal|vertical,loop:bool,loopLabel), steps(`I`=[{title,x}],lineColor,numberColor,activeStep), timeline(`I`=[{date,title,x}],lineColor,dotColor,direction)
**Visual**: icon(name,`s`:sm|md|lg|xl,`c`,`b`,circle:bool,`lb`), callout(`x`,title,`b`,border,`c`,`i`), quote(`x`,author,`s`,`c`), progress(`I`=[{lb,value 0-100,c}],showValue,height), spacer(bare int), divider(`c`,spacing)

## Slide Archetypes

### Cover / Section Break / CTA
`align:"center"`, `verticalAlign:"center"`, `bgGradient`. Badge + 3xl-4xl heading + subtitle. Tag-group on CTA.

### Problem / Metrics
Badge + assertion heading + **grid** (2-3 cols) with metric cards. Each cell: icon (circle, **warning color** like `#EF4444`/`#F59E0B`/`#F97316`) + heading (stat value, `2xl`, colored) + text (label). Cell style: `{"padding":"16px","background":"rgba(255,255,255,0.05)","borderRadius":"8px"}`. Do NOT use icon-row for numeric stats.

### Solution / Process
Badge + assertion heading + **flow** (horizontal, with sublabels) + **callout** with key stat. Example callout: `{"_":"callout","x":"73% resolved without human intervention","i":"Lightbulb","b":"rgba(59,130,246,0.1)","border":"$A"}`

### Features
Badge + heading + **icon-row** with **distinct `ic` per item** (e.g. `$A`, `$G`, `#F59E0B`, `#8B5CF6`).

### Comparison
Badge + heading + **table** (striped, 5-6 rows, styled header with headerBg/headerColor).

### Light Theme Contrast
When showing "theming" or contrast, use `"t":"l"` to render a slide with light bg. Shows adaptability.

## Design Rules

- **Canvas**: 960×540 (16:9). Padding via theme `p` (CSS string like `"36px 48px"`).
- **Duration**: int seconds. Title 15-30s | Content 60-90s | Dense 90-180s.
- **Section grouping**: Group slides into items by topic. 3-6 slides per item.
- **Headlines**: MUST be assertions with specifics ("AI Cuts Time 60%"), never labels.
- **Background variety**: Alternate `"d"` and `"a"` themes. Use `bgGradient` on cover, CTA, and section-break slides (every 5-8 slides). Include at least one `"l"` (light) slide for contrast in longer decks.
- **Badges**: Every content slide starts with badge. Vary badge bg color by section.
- **Colors**: icon-row items MUST have distinct `ic`. Metrics MUST have distinct colors. Use 2+ accent colors from palette.
- **Max 5-7 blocks** per slide. Spacers don't count.
- **Icons**: PascalCase Lucide. Common: Zap, Brain, Rocket, Shield, Target, Clock, Users, Globe, Code, Database, Lightbulb, TrendingUp, BarChart, Lock, Cpu, Layers, Bot, Sparkles, Award, CheckCircle, Mail, Play, ArrowRight, GraduationCap, Settings, Eye
