---
name: vela-slides
version: 8.0.0
updated: 2026-03-25
description: Create presentation decks using the Vela engine. Incremental compact DSL — streams slides one at a time.
license: ELv2
compatibility: Requires Python 3 and Bash. Designed for Claude Code.
allowed-tools: Bash(python3:*) Bash(vela:*) Read Write
effort: low
---

# Vela Slides

Senior presentation designer. Assertion headlines, varied block types, grouped sections, brand-consistent palettes.

## Fast Paths

```bash
vela deck ship <deck.json> --output <name.jsx>       # ship existing
vela deck ship --sample --output <name.jsx>           # ship sample
vela deck extract <source.jsx> <output.json>          # extract from .jsx
```
`python3 skills/vela-slides/scripts/vela.py <resource> <action> [args...]`

## Deck DSL (compact — the ONLY format you write)

NEVER use `"type"`, `"text"`, `"deckTitle"`, `"lanes"`, `"slides"`, `"blocks"`.

**`C`** — Colors used 2+ times as `$A`-`$Z`. Frequency order. Hex 6 or 8 chars.
**`T`** — `"d"`:dark `{"b":"#0A0F1C","c":"#E6F1FF","a":"$A","p":"60px 72px"}`, `"a"`:alt different shade. Alternate d/a.
**Slide** — `{"t":"d","n":"Assertion Headline","d":60,"B":[blocks]}`. Cover/CTA: `bgGradient`,`align:"center"`,`verticalAlign:"center"`. Duration: cover 20, content 60-90, CTA 25. Spacers: bare int.

**Keys**: `_`(type) `x`(text) `s`(size) `c`(color) `i`(icon) `b`(bg) `w`(weight) `ic`(iconColor) `ib`(iconBg) `I`(items) `g`(gap) `lb`(label) `v`(variant) `H`(headers) `R`(rows)

## Blocks (use 10+ per deck)

`{"_":"heading","x":"Title","s":"2xl","w":700}` `{"_":"text","x":"Body","s":"lg","c":"$C"}` `{"_":"badge","x":"LABEL","i":"Zap","b":"$E","c":"$A"}` `{"_":"code","x":"const x=1","lb":"JS"}` `{"_":"quote","x":"Text","author":"Name"}` `{"_":"callout","x":"Note","title":"Warn","b":"$F","i":"AlertTriangle"}` `{"_":"metric","value":"98%","lb":"Acc","s":"3xl","c":"$A"}` `{"_":"progress","value":75,"lb":"Done","c":"$A"}` `{"_":"icon-row","I":[{"i":"Brain","title":"AI","x":"Desc","ic":"$A","ib":"$E"}]}` `{"_":"tag-group","I":[{"x":"Tag","c":"$A"}],"v":"outline"}` `{"_":"bullets","I":["A","B"]}` `{"_":"table","H":["X","Y"],"R":[["1","2"]],"hb":"$A"}` `{"_":"grid","I":[{"blocks":[{"_":"metric","value":"5","lb":"X"}],"style":{"padding":"20px","background":"$F"}}]}` `{"_":"flow","I":[{"i":"Upload","lb":"In"},{"i":"Cpu","lb":"Process"}],"ac":"$A"}` `{"_":"steps","I":[{"title":"1","x":"Do"}],"lnc":"$A"}` `{"_":"timeline","I":[{"title":"Q1","x":"Launch"}],"dc":"$A"}` `12`=spacer `{"_":"divider","c":"$C"}`

## Quality

- 3-5 narrative sections. Assertion headlines ("Churn Drops to 2.1%", not "Churn")
- 10+ block types, semantically matched. `4xl` cover → `2xl` body → `3xl` CTA
- Badge every content slide. Closing: recap callout/tag-group + gradient. 960×540 canvas.

## Workflow — INCREMENTAL (follow exactly)

NO explanatory text. NO summaries. Emit ONLY tool calls.

**Step 1 — Init deck skeleton:**
```bash
vela deck init <file> --title "T" --palette '{"$A":"#hex",...}' --themes '{"d":{...},"a":{...}}' --sections "S1,S2,S3"
```

**Step 2 — Append slides one section at a time (one tool call per section):**
For each section, append all its slides in a single bash call:
```bash
vela slide append <file> <section_idx> '<slide_json>' && \
vela slide append <file> <section_idx> '<slide_json>' && \
vela slide append <file> <section_idx> '<slide_json>'
```

**Step 3 — Ship:**
```bash
vela deck ship <file> --output <name.jsx>
```

Total: 2-5 tool calls. No Read, no validate (ship validates). No commentary between steps.

## CLI

```
vela deck init|ship|validate|list|stats|replace-text|extract|extract-text|patch-text
vela slide append|edit|view|remove|move|duplicate|insert
```
