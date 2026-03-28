---
name: vela-slides
version: 3.3.0
updated: 2026-03-21
description: Generate Vela slide deck JSON. Self-contained, speed + quality optimized.
---

# Vela Slides — Compact Format

Write the deck as compact JSON. The validator auto-expands compact to full format.

## Format

```
{"n":"Deck Title","C":{color palette},"T":{themes},"S":[slides]}
```

### Color Palette `C`
Define ALL colors used 2+ times. Include warning/semantic colors alongside brand:
```json
"C":{"$A":"#3B82F6","$B":"#E6F1FF","$C":"#8892B0","$D":"#0A0F1C","$E":"#1e293b","$F":"#3B82F620","$G":"#10B981","$H":"#F59E0B","$I":"#EF4444","$J":"#8B5CF6"}
```
`$A`=accent, `$G`=green, `$H`=amber, `$I`=red, `$J`=purple — use these for per-item color differentiation.

### Themes `T`
```json
"T":{"d":{"b":"$D","c":"$B","a":"$A","p":"60px 72px"},"a":{"b":"$E","c":"$B","a":"$A","p":"36px 48px"}}
```

### Slides `S`
```json
{"t":"d","n":"Slide Title","d":60,"B":[...blocks...]}
```
Cover/CTA: add `"bgGradient":"linear-gradient(135deg, $D 0%, $E 100%)","align":"center","verticalAlign":"center"`
Spacers: bare integer. **Vary spacer heights**: `8` between tight elements, `12` standard, `16` before main block, `24` for major section gaps.

### Block Reference
**heading** — vary `s` by slide role:
- Cover: `{"_":"heading","x":"Assertion Title Here","s":"4xl","w":700}`
- Body: `{"_":"heading","x":"Specific Claim With Data","s":"2xl"}`
- CTA: `{"_":"heading","x":"Action-Oriented Closing","s":"3xl","w":700}`

**text**: `{"_":"text","x":"Supporting detail.","s":"lg","c":"$C"}`

**badge** — vary `c` by section context:
- `{"_":"badge","x":"THE PROBLEM","c":"$I","b":"#EF444420","i":"AlertTriangle"}` (problem=red)
- `{"_":"badge","x":"SOLUTION","c":"$G","b":"#10B98120","i":"CheckCircle"}` (solution=green)
- `{"_":"badge","x":"FEATURES","c":"$A","b":"$F","i":"Layers"}` (neutral=blue)

**icon-row** — each item MUST have a different `ic` (use `$A`,`$G`,`$H`,`$J` etc):
`{"_":"icon-row","I":[{"icon":"...","title":"...","x":"...","ic":"$H","ib":"#F59E0B20"}, ...]}`

**grid** + **metric** — each metric card gets a distinct color + tinted bg. For problems use warning colors (`$I`=red, `$H`=amber):
`{"_":"grid","cols":3,"g":16,"I":[{"blocks":[{"_":"metric","value":"N%","lb":"Label","s":"3xl","c":"$I"}],"style":{"padding":"20px","background":"rgba(239,68,68,0.08)","borderRadius":"12px"}}, ...]}`

**flow** — 3-5 items with icon + label + sublabel:
`{"_":"flow","I":[{"i":"Icon","lb":"Step","sublabel":"Detail"}, ...],"arrowColor":"$A","direction":"horizontal"}`

**callout** — use green border for positive insights, amber for warnings:
`{"_":"callout","x":"Key stat or insight here.","i":"TrendingUp","b":"rgba(16,185,129,0.1)","border":"$G"}`

**table** — include concrete data, not just labels. Use striped + styled header:
`{"_":"table","H":["Capability","Col2","Col3"],"R":[["row","data","here"]],"striped":true,"headerBg":"$E","headerColor":"$B","cellColor":"$C"}`

**tag-group** — use distinct `c` per tag, include icons:
`{"_":"tag-group","I":[{"x":"Action 1","c":"$G","i":"Play"},{"x":"Action 2","c":"$A","i":"Calendar"}],"v":"outline"}`

**icon**: `{"_":"icon","name":"Rocket","s":"xl","c":"$A","b":"$F","circle":true}`
**steps**: `{"_":"steps","I":[{"title":"Step 1","x":"Description"}],"lineColor":"$A","numberColor":"$A"}`
**timeline**: `{"_":"timeline","I":[{"date":"Q1","title":"Milestone","x":"Detail"}],"lineColor":"$A"}`
**code**: `{"_":"code","x":"code here","lb":"Language","b":"$E"}`
**quote**: `{"_":"quote","x":"Quote text.","author":"Name, Title","s":"xl","c":"$B"}`
**progress**: `{"_":"progress","I":[{"lb":"Metric","value":85,"c":"$A"}],"showValue":true}`

## Design Rules
- Canvas 960×540. Max 5-7 blocks per slide (spacers don't count).
- **Heading sizes MUST vary**: `4xl` cover, `2xl` body slides, `3xl` CTA. Never uniform.
- **Spacer heights MUST vary**: 8, 12, 16, 24. Never all the same value.
- **Headlines**: specific assertions with data ("AI Resolves 73% of Tickets Automatically"), never labels.
- **Semantic colors**: red/amber for problems, green for solutions, blue for neutral, purple for features.
- Background: alternate `"t":"d"` and `"t":"a"`. Cover + CTA use `bgGradient`.
- Every content slide starts with `badge` (vary badge color by context).
- Duration: cover/CTA 20-30s, content 60-90s.
- Icons: PascalCase Lucide.

## Workflow
1. Write compact JSON to the requested file path
2. Validate: `python3 /path/to/vela.py deck validate <file>`
3. Brief quality report (5-8 lines): slide count, block types, warnings, 1-2 improvement tips.
