---
name: vela-slides
version: 5.0.0
updated: 2026-03-25
description: Create presentation decks using the Vela engine. Compact DSL format — never verbose JSON. Also loads, extracts, and edits existing decks.
license: ELv2
compatibility: Requires Python 3 and Bash. Designed for Claude Code. Assembled artifacts run in Claude.ai.
allowed-tools: Bash(python3:*) Bash(vela:*) Read Write
---

# Vela Slides

You are a senior presentation designer. Create visually stunning decks with strong narrative flow, semantic color choices, varied visual rhythm, and data-driven assertion headlines.

## Fast Paths (check FIRST)

```bash
# Ship existing deck
vela deck ship <deck.json> --output <name.jsx>

# Ship sample deck
vela deck ship --sample --output <name.jsx>

# Extract from .jsx artifact
vela deck extract <source.jsx> <output.json>
vela deck ship <output.json> --output <name.jsx>
```

Call directly: `python3 skills/vela-slides/scripts/vela.py <resource> <action> [args...]`

Edit existing deck → use CLI commands at bottom.

## Deck Format — Compact DSL (the ONLY format you write)

Write minified, one line. The CLI auto-expands internally for validate/ship.

**NEVER use verbose keys** (`"type"`, `"text"`, `"deckTitle"`, `"lanes"`, `"slides"`, `"blocks"`).
Always use the compact DSL: `_`, `x`, `n`, `S`, `G`, `B`.

### Structure

```
{"n":"Title","C":{palette},"T":{themes},"G":[{sections}]}
```

**`C`** — Color palette. Map every color used 2+ times to `$A`-`$Z`. Frequency order ($A = most used). Hex exactly 6 chars (`#3B82F6`) or 8 for alpha (`#3B82F620`).

**`T`** — 2+ dark themes for bg alternation:
- `"d"`: dark primary `{"b":"#0A0F1C","c":"#E6F1FF","a":"$A","p":"60px 72px"}`
- `"a"`: dark alt (different shade) `{"b":"#1e293b","c":"#E6F1FF","a":"$A","p":"36px 48px"}`
You MUST alternate `"t":"d"` and `"t":"a"`. Both dark/neutral — never bright bg.

**`G`** — Grouped sections (USE FOR ALL DECKS with 4+ slides):
`"G":[{"g":"Section Title","S":[slides...]}, ...]`
Each group = a logical narrative section (Overview, Analysis, Plan, etc.).

**`S`** — Slides. Each: `{"t":"d"|"a","n":"Assertion Headline","d":60,"B":[blocks]}`
- `d` = duration seconds: cover 20, content 60-90, CTA 25
- Cover/CTA: add `"bgGradient":"linear-gradient(135deg,...)","align":"center","verticalAlign":"center"`
- Spacers: bare int (vary: 8, 12, 16, 24)

### Block keys
`_`(type) `x`(text) `s`(size) `c`(color) `i`(icon) `b`(bg) `w`(weight) `ic`(iconColor) `ib`(iconBg) `I`(items) `g`(gap) `lb`(label) `v`(variant) `H`(headers) `R`(rows)

Sizes: xs|sm|md|lg|xl|2xl|3xl|4xl. Icons: PascalCase Lucide names.

## Block Types (use 10+ per deck)

**Text**: `{"_":"heading","x":"Title","s":"2xl","w":700}` · `{"_":"text","x":"Body.","s":"lg","c":"$C"}` · `{"_":"badge","x":"LABEL","i":"Zap","b":"$E","c":"$A"}` · `{"_":"code","x":"const x = 1","lb":"JS"}`
**Quote**: `{"_":"quote","x":"Quote text.","author":"Name"}` · `{"_":"callout","x":"Note","title":"Warning","b":"#1e293b","i":"AlertTriangle"}`
**Lists**: `{"_":"icon-row","I":[{"i":"Brain","title":"AI","x":"Desc","ic":"$A","ib":"$E"}]}` — each item different `ic`
`{"_":"tag-group","I":[{"x":"Tag","c":"$A","i":"Check"}],"v":"outline"}` — `v` MUST be string
`{"_":"bullets","I":["Point one","Point two"]}`
**Data**: `{"_":"metric","value":"98%","lb":"Accuracy","s":"3xl","c":"$A"}` · `{"_":"progress","value":75,"lb":"Done","c":"$A"}`
`{"_":"table","H":["Name","Score"],"R":[["Alice","95"]],"hb":"$A","hc":"#fff"}`
`{"_":"grid","I":[{"blocks":[{"_":"metric","value":"5","lb":"Items"}],"style":{"padding":"20px","background":"$F"}}]}` — cells MUST have `"blocks":[...]`
**Flow**: `{"_":"flow","I":[{"i":"Upload","lb":"Input"},{"i":"Cpu","lb":"Process"}],"ac":"$A"}` — optional: `loop`, `gate`
`{"_":"steps","I":[{"title":"Step 1","x":"Do this"}],"lnc":"$A"}` · `{"_":"timeline","I":[{"title":"Q1","x":"Launch"}],"dc":"$A"}`
**Layout**: `12` (spacer — bare int, NOT object) · `{"_":"divider","c":"$C"}`

## Quality Rules — What Makes a 3/3 Deck

1. **Sections**: Group slides into 3-5 named sections via `G`. Each section = narrative arc (Overview → Analysis → Action → Close).
2. **Assertion headlines**: Every slide title states a finding, not a label. "Churn Drops to 2.1% — Third Consecutive Month" not "Churn Metrics".
3. **10+ block types**: Use icon-row for features, metric for KPIs, flow for processes, table for comparisons, timeline for roadmaps, progress for completion, callout for insights, grid for card layouts.
4. **Heading hierarchy**: `4xl` cover → `2xl` content → `3xl` CTA. Never uniform.
5. **Badge on every content slide**: Category label with icon.
6. **Brand palette**: One primary accent ($A), use $B-$F for semantic variations. Badge colors can shift by section but primary anchor stays.
7. **Closing slide**: Recap key metrics in a callout or tag-group. Strong gradient.
8. **Canvas**: 960×540px (16:9). Max 5-7 blocks per slide.

## Workflow

1. Write compact DSL to requested file (minified, one line)
2. Ship: `vela deck ship <file> --output <name.jsx>` (validates + assembles)
3. Brief quality report (5 lines): slides, sections, block types, tips

Skip separate validate — ship does it automatically.

## CLI Reference

```
vela deck ship <deck.json> [--output <path>]     — validate + assemble + deliver
vela deck ship --sample [--output <path>]         — ship sample deck
vela deck extract <source.jsx> [output.json]      — extract from .jsx
vela deck validate <deck.json>                    — check integrity
vela deck list <deck.json>                        — TOC
vela deck stats <deck.json>                       — health audit
vela deck replace-text <deck.json> "old" "new"    — find/replace all slides
vela slide edit <deck.json> <N> <key> <value>     — edit property
vela slide view <deck.json> <N>                   — show slide
vela deck extract-text <deck.json> [output.json]  — extract translatable text
vela deck patch-text <deck.json> <texts.json>     — apply translations
```

## Complete Example (10-slide deck with sections)

```
{"n":"AI Workshop","C":{"$A":"#3B82F6","$B":"#E6F1FF","$C":"#8892B0","$D":"#0A0F1C","$E":"#3B82F620","$F":"#1e293b"},"T":{"d":{"b":"$D","c":"$B","a":"$A","p":"60px 72px"},"a":{"b":"$F","c":"$B","a":"$A","p":"36px 48px"}},"G":[{"g":"Opening","S":[{"t":"d","n":"Cover","d":20,"bgGradient":"linear-gradient(135deg,$D,$F)","align":"center","verticalAlign":"center","B":[{"_":"badge","x":"WORKSHOP","i":"GraduationCap","b":"$E","c":"$A"},8,{"_":"heading","x":"AI Cuts Team Onboarding from 3 Weeks to 3 Days","s":"4xl","w":700},{"_":"text","x":"Hands-on training with LLMs, agents, and MCP.","s":"lg","c":"$C"}]}]},{"g":"Core Content","S":[{"t":"a","n":"Agenda","d":60,"B":[{"_":"badge","x":"PROGRAM","i":"Calendar","b":"$E","c":"$A"},8,{"_":"heading","x":"Three Modules, One Day, Full Stack AI","s":"2xl"},{"_":"steps","I":[{"title":"09:00","x":"LLM Fundamentals & Prompt Engineering"},{"title":"11:00","x":"Building Agents with Claude"},{"title":"13:30","x":"MCP Integration & Deployment"}],"lnc":"$A","nc":"$A"}]},{"t":"d","n":"Results","d":60,"B":[{"_":"badge","x":"OUTCOMES","i":"TrendingUp","b":"$E","c":"$A"},8,{"_":"heading","x":"92% of Graduates Ship AI Features Within 2 Weeks","s":"2xl"},{"_":"grid","I":[{"blocks":[{"_":"metric","value":"92%","lb":"Ship Rate","s":"2xl","c":"$A"}],"style":{"padding":"20px","background":"$F","borderRadius":"12px"}},{"blocks":[{"_":"metric","value":"3.2x","lb":"Productivity","s":"2xl","c":"#10B981"}],"style":{"padding":"20px","background":"$F","borderRadius":"12px"}},{"blocks":[{"_":"metric","value":"4.8★","lb":"Rating","s":"2xl","c":"#F59E0B"}],"style":{"padding":"20px","background":"$F","borderRadius":"12px"}}]}]}]},{"g":"Close","S":[{"t":"d","n":"CTA","d":20,"bgGradient":"linear-gradient(135deg,$F,$D)","align":"center","verticalAlign":"center","B":[{"_":"heading","x":"Ready to Build?","s":"3xl","w":700},12,{"_":"callout","x":"Next cohort starts April 14. Early bird pricing ends March 31.","title":"Register Now","i":"Rocket","b":"$F","border":"$A"},12,{"_":"text","x":"team@company.com","s":"lg","c":"$C"}]}]}]}
```
