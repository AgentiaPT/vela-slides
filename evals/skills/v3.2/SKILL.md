---
name: vela-slides
version: 3.2.0
updated: 2026-03-21
description: Generate Vela slide deck JSON. Self-contained, optimized for speed + quality.
---

# Vela Slides — Compact Format

Write the deck as compact JSON. The validator auto-expands compact to full format.

## Format

```
{"n":"Deck Title","C":{color palette},"T":{themes},"S":[slides]}
```

### Color Palette `C`
```json
"C":{"$A":"#3B82F6","$B":"#E6F1FF","$C":"#8892B0","$D":"#0A0F1C","$E":"#1e293b","$F":"#3B82F620","$G":"#10B981"}
```
Map hex colors to `$A`-`$Z` aliases. Use aliases everywhere in the deck.

### Themes `T`
```json
"T":{"d":{"b":"$D","c":"$B","a":"$A","p":"36px 48px"},"a":{"b":"$E","c":"$B","a":"$A","p":"36px 48px"}}
```
`d`=dark, `a`=alt dark. Keys: `b`=bg, `c`=text color, `a`=accent, `p`=padding (CSS string).

### Slides `S`
```json
{"t":"d","n":"Slide Title","d":60,"B":[...blocks...]}
```
`t`=theme ref, `n`=title, `d`=duration in seconds (integer), `B`=blocks array.
Cover/CTA slides add: `"bgGradient":"linear-gradient(135deg, $D 0%, $E 100%)","align":"center","verticalAlign":"center"`
Spacers: bare integer (e.g. `8` not `{"_":"spacer","h":8}`).

### Blocks
Keys: `_`=type, `x`=text, `s`=size(xs|sm|md|lg|xl|2xl|3xl|4xl), `c`=color, `i`=icon, `b`=bg, `w`=weight(int), `ic`=iconColor, `ib`=iconBg, `I`=items, `g`=gap(int), `lb`=label, `v`=variant, `H`=headers, `R`=rows

**heading**: `{"_":"heading","x":"Text","s":"3xl","w":700}`
**text**: `{"_":"text","x":"Body","s":"lg","c":"$C"}`
**badge**: `{"_":"badge","x":"LABEL","c":"$A","b":"$F","i":"Star"}`
**icon-row**: `{"_":"icon-row","I":[{"icon":"Zap","title":"Feature","x":"Description","ic":"$A","ib":"$F"},...]}`
  Each item MUST have a different `ic` color.
**table**: `{"_":"table","H":["Col1","Col2","Col3"],"R":[["a","b","c"],["d","e","f"]],"striped":true,"headerBg":"$E","headerColor":"$B"}`
**grid**: `{"_":"grid","cols":3,"g":16,"I":[{"blocks":[...block objects...],"style":{"padding":"16px","background":"rgba(255,255,255,0.05)","borderRadius":"8px"}},...]}`
  Grid items MUST have `"blocks":[...]` array (not bare blocks). Style uses full CSS key names.
**metric**: `{"_":"metric","value":"42%","lb":"Label","s":"3xl","c":"$A"}`
**flow**: `{"_":"flow","I":[{"i":"FileText","lb":"Step 1","sublabel":"Details"},...],"arrowColor":"$A","direction":"horizontal"}`
  Optional: `"loop":true,"loopLabel":"Repeat"`, item-level `"gate":true`
**steps**: `{"_":"steps","I":[{"title":"Step 1","x":"Description"},...],"lineColor":"$A","numberColor":"$A"}`
**timeline**: `{"_":"timeline","I":[{"date":"Q1 2026","title":"Milestone","x":"Details"},...],"lineColor":"$A"}`
**callout**: `{"_":"callout","x":"Key insight text","title":"Note","b":"rgba(59,130,246,0.1)","border":"$A","i":"Lightbulb"}`
**tag-group**: `{"_":"tag-group","I":[{"x":"Tag 1","c":"$A","i":"Mail"},...],"v":"outline"}`
**icon**: `{"_":"icon","name":"Rocket","s":"xl","c":"$A","b":"$F","circle":true}`
**code**: `{"_":"code","x":"const x = 1;","lb":"JavaScript","b":"$E"}`
**quote**: `{"_":"quote","x":"Quote text","author":"Person","s":"xl","c":"$B"}`
**progress**: `{"_":"progress","I":[{"lb":"Skill","value":85,"c":"$A"},...],"showValue":true}`

## Design Rules
- Canvas 960×540. Max 5-7 blocks per slide (spacers don't count).
- Headlines: assertions with data ("AI Cuts Time 60%"), never labels ("Overview").
- Background: alternate `"t":"d"` and `"t":"a"` across slides. Cover + CTA use `bgGradient`.
- Every content slide starts with a `badge` block.
- `icon-row` items: each must have a distinct `ic` color.
- Problem slides: use `grid` + `metric` blocks with warning colors.
- Solution slides: use `flow` + `callout`.
- CTA slides: use `tag-group` with actionable links.
- Group slides into items (sections) when using full format. Compact `S` array is fine.
- Duration: title slides 15-30s, content 60-90s, dense 90-180s.
- Icons: PascalCase Lucide names (Zap, Brain, Rocket, Shield, Target, Clock, Users, Globe, Code, Database, Lightbulb, TrendingUp, BarChart, Bot, Sparkles, Mail, Play, ArrowRight).

## Workflow
1. Write compact JSON to the requested file path
2. Validate: `python3 /path/to/vela.py deck validate <file>`
   The validator auto-expands compact format. You do NOT need to write lanes/items/slides structure.
3. Report: After validation, output a brief quality report for the user:
   - Slide count and total duration
   - Block types used
   - Any validation warnings (block count, missing fields)
   - Suggestions: "To improve this deck, consider: ..." (1-2 specific actionable tips)
   Keep the report concise (5-8 lines max).
