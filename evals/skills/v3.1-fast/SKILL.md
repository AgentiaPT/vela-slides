---
name: vela-slides
version: 3.1.1
updated: 2026-03-21
description: Generate Vela slide deck JSON. Self-contained, speed-optimized.
---

# Vela Slides — Speed Mode

Generate the deck JSON and write it to the requested file path in ONE tool call. Do NOT validate, do NOT read files, do NOT run CLI commands. Just write the JSON.

## Compact JSON Format

`{"n":"Title","C":{palette},"T":{themes},"S":[slides]}`

**Palette `C`**: `"$A":"#hex"` for colors used 2+. Use 2+ accents.
**Themes `T`**: `"d"`:dark(`b`,`c`,`a`,`p`), `"a"`:alt(different `b`), `"l"`:light. `p`=CSS padding.
**Slides `S`**: `t`=theme, `n`=title, `d`=duration(int), `B`=blocks. Spacers: bare int.
**Blocks**: `_`=type, `x`=text, `s`=size, `c`=color, `i`=icon, `b`=bg, `w`=weight(int), `ic`=iconColor, `ib`=iconBg, `I`=items, `g`=gap(int), `lb`=label, `v`=variant, `H`=headers, `R`=rows

## Block Types
heading(`x`,`s`:xs-4xl,`w`,`i`) · text(`x`,`s`,`c`) · badge(`x`,`c`,`b`,`i`) · code(`x`,`lb`)
icon-row(`I`=[{icon,title,x,ic,ib}], distinct `ic`) · tag-group(`I`=[{x,c,i}],`v`) · bullets(`I`)
table(`H`,`R`,striped,headerBg,headerColor) · grid(cols,`g`,`I`=[{blocks,style}]) · metric(value,`lb`,`s`,`c`,`i`)
flow(`I`=[{i,lb,sublabel,gate}],arrowColor,direction,loop,loopLabel) · steps(`I`=[{title,x}],lineColor) · timeline(`I`=[{date,title,x}])
icon(name,`s`,`c`,`b`,circle) · callout(`x`,title,`b`,border,`i`) · quote(`x`,author) · progress(`I`=[{lb,value,c}]) · spacer(int) · divider

## Rules
- 960×540 canvas. Padding CSS string "36px 48px".
- Group slides into items (sections). 3-6 slides per item.
- Assertion headlines ("AI Cuts Time 60%"), never labels.
- Alternate `"d"`/`"a"` themes. `bgGradient` on cover+CTA+section breaks. 1+ `"l"` slide in 10+ slide decks.
- Badge on every content slide. icon-row: distinct `ic` per item.
- Problem slides: grid with metric cards (styled cell bg, warning colors).
- Solution slides: flow + callout with key stat.
- CTA: tag-group with links.
- Duration: title 15-30s, content 60-90s.
- Max 5-7 blocks/slide.
- Icons: PascalCase Lucide.

## SPEED INSTRUCTION
Write the complete deck JSON to the requested file in a SINGLE Write tool call. No validation, no CLI, no reads. One call, done.
