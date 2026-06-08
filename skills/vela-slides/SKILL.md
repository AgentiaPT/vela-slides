---
name: vela-slides
version: 12.69
updated: 2026-06-08
description: Create presentation decks using the Vela engine. Compact DSL format — never verbose JSON. Also loads, extracts, and edits existing decks.
license: ELv2
compatibility: Requires Python 3 and Bash. Designed for Claude Code.
allowed-tools: Bash(python3 skills/vela-slides/scripts/*), Bash(python3 tests/test_vela.py*), Read, Write, Edit, Glob, Grep
effort: low
---

# Vela Slides

Senior presentation designer. Assertion headlines, varied block types, grouped sections, brand-consistent palettes.

## Fast Paths

```bash
vela server start <folder-or-file> [--port 3030]      # local preview
vela deck ship <deck.json> --output <name.jsx>       # ship existing
vela deck ship --sample --output <name.jsx>           # ship starter deck
vela deck ship --demo --output <name.jsx>             # ship demo deck (all block types)
vela deck extract <source.jsx> <output.json>          # extract from .jsx
```

When user asks to "load the demo deck", "show the demo", or "show me what Vela can do": use `--demo`. **Do NOT generate a new deck.**
`python3 skills/vela-slides/scripts/vela.py <resource> <action> [args...]`

## Deck DSL (compact — the ONLY format you write)

Minified, one line. NEVER use `"type"`, `"text"`, `"deckTitle"`, `"lanes"`, `"slides"`, `"blocks"`.

`{"n":"Title","C":{palette},"T":{themes},"G":[sections]}`

**`C`** — Colors used 2+ times as `$A`-`$Z`. Frequency order. Hex 6 or 8 chars.
**`T`** — `"d"`:dark `{"b":"#0A0F1C","c":"#E6F1FF","a":"$A","p":"60px 72px"}`, `"a"`:alt different shade. Alternate d/a.
**`G`** — Sections (USE FOR ALL DECKS): `[{"g":"Name","S":[slides]}]`. 3-5 narrative sections.
**Slide** — `{"t":"d","n":"Assertion Headline","d":60,"B":[blocks]}`. Cover/CTA: `bgGradient`,`align:"center"`,`verticalAlign:"center"`. Duration: cover 20, content 60-90, CTA 25. Spacers: bare int.
  Cols layout: `{"t":"d","n":"Headline","layout":"cols","contentFlex":3,"imageFlex":2,"B":[header blocks],"L":[left blocks],"R":[right blocks]}`. B = full-width above columns (optional). L/R = column content. splitGap controls gap between columns (default 32).

**Keys**: `_`(type) `x`(text) `s`(size) `c`(color) `i`(icon) `b`(bg) `w`(weight) `ic`(iconColor) `ib`(iconBg) `I`(items) `g`(gap) `lb`(label) `v`(variant) `H`(headers) `R`(rows) `Q`(quadrants) `val`(value) `dl`(dividerLabel) `cl`(centerLabel) `dr`(drop)

## Blocks (use 10+ per deck)

`{"_":"heading","x":"Title","s":"2xl","w":700}` `{"_":"text","x":"Body","s":"lg","c":"$C"}` `{"_":"badge","x":"LABEL","i":"Zap","b":"$E","c":"$A"}` `{"_":"code","x":"const x=1","lb":"JS"}` `{"_":"quote","x":"Text","author":"Name"}` `{"_":"callout","x":"Note","title":"Warn","b":"$F","i":"AlertTriangle"}` `{"_":"metric","value":"98%","lb":"Acc","s":"3xl","c":"$A"}` `{"_":"progress","value":75,"lb":"Done","c":"$A"}` `{"_":"icon-row","I":[{"i":"Brain","title":"AI","x":"Desc","ic":"$A","ib":"$E"}]}` `{"_":"tag-group","I":[{"x":"Tag","c":"$A"}],"v":"outline"}` `{"_":"bullets","I":["A","B"]}` `{"_":"table","H":["X","Y"],"R":[["1","2"]],"hb":"$A"}` `{"_":"grid","I":[{"blocks":[{"_":"metric","value":"5","lb":"X"}],"style":{"padding":"20px","background":"$F"}}]}` `{"_":"flow","I":[{"i":"Upload","lb":"In"},{"i":"Cpu","lb":"Process"}],"ac":"$A"}` `{"_":"steps","I":[{"title":"1","x":"Do"}],"lnc":"$A"}` `{"_":"timeline","I":[{"title":"Q1","x":"Launch"}],"dc":"$A"}` `{"_":"comparison","I":[{"title":"Before","i":"X","c":"$D","I":["Old way"]},{"title":"After","i":"Check","c":"$B","I":["New way"]}],"dl":"VS"}` `{"_":"funnel","I":[{"lb":"Visitors","val":"10K","c":"$A"},{"lb":"Signups","val":"2K","c":"$B","dr":"−80%"}]}` `{"_":"cycle","cl":"Loop","I":[{"lb":"Plan","c":"$A"},{"lb":"Do","c":"$B"},{"lb":"Check","c":"$C"}]}` `{"_":"number-row","I":[{"val":"99%","lb":"Uptime","i":"Activity","c":"$A"},{"val":"38ms","lb":"Latency","c":"$B"}]}` `{"_":"matrix","Q":[{"title":"Strengths","c":"$B","I":["Team"]},{"title":"Opportunities","c":"$A","I":["Market"]},{"title":"Weaknesses","c":"$D","I":["Scale"]},{"title":"Threats","c":"$D","I":["Competition"]}]}` `{"_":"checklist","I":[{"x":"Done","status":"done"},{"x":"Pending","status":"pending"}]}` `12`=spacer `{"_":"divider","c":"$C"}`

## Study Notes (offline)

Any slide can carry a `studyNotes` object that renders in the 🎓 student panel **with zero API calls**. Mirrors the live Vera Teacher output shape so existing renderers are reused. Compact key: `sN`.

```
"sN": {
  "text": "Markdown with **bold**, *italic*, [external](https://…), and [X-Ray term](#agent).",
  "diagram": "<svg viewBox='0 0 320 140'>…</svg>",
  "questions": ["What is X?", "How does Y relate to Z?"],
  "glossary": { "agent": { "definition": "A goal-driven loop that plans, acts, observes.", "url": "https://…" } }
}
```

- `text` required; everything else optional.
- Inline `[label](https://…)` renders as a sanitized external link (http/https/mailto only).
- Inline `[label](#term)` looks up `glossary[term]` (lowercased) and shows a Kindle-style X-Ray popover with the definition + optional "Learn more" link.
- When an API is reachable, authored questions become clickable Vera prompts + an Ask input appears. Offline, they render as static "QUESTIONS TO PONDER" bullets.
- Slides carrying `studyNotes` show a 🎓 marker in the TOC, gallery thumbnails, and slide viewer.
- Size limits: text ≤ 4000 chars (warn at 2000), diagram ≤ 8000 chars, ≤ 6 questions, ≤ 24 glossary terms. `sanitizeStudyNotes` strips unsafe SVG/URL payloads and NULL bytes.
- X-Ray syntax (`[term](#key)`) only activates inside `studyNotes.text` — regular text blocks render it as plain label text.
- Authoring is JSON-only in v12.32. A `set_study_notes` Vera tool is planned for a future release.

## Quality

- Sections via `G` (3-5 groups). Assertion headlines ("Churn Drops to 2.1%", not "Churn")
- 10+ block types, semantically matched. `4xl` cover → `2xl` body → `3xl` CTA
- Badge every content slide. Closing: recap callout/tag-group + gradient. 960×540 canvas.
- Use `layout:"cols"` for side-by-side content: agenda+visual, before/after, text+diagram, metrics+steps. Put shared context (badge, heading) in B.

## Workflow (STRICT — exactly 2 tool calls)

You MUST complete the deck in exactly 2 tool calls. No exceptions. No Read. No validate. No commentary between calls.

**Call 1** — Write the complete deck JSON to file:
```
Use the Write tool to write the entire compact deck JSON to the output file.
```

**Call 2** — Ship or serve:
```bash
vela deck ship <file> --output <name.jsx>
```
Or for local preview: `vela server start <file> --port 3030`

Done. Do not speak before, between, or after tool calls. NEVER read or print `.vela.env`.

## CLI

<!-- BEGIN AUTO-GENERATED CLI REFERENCE -->

### CLI Quick Reference (v2.6.0)

**`vela deck`** — Deck-level operations (auto-detects full/compact/turbo format)

```
vela deck list <deck.vela> — TOC with slide#, title, blocks, duration
vela deck validate <deck.vela> — check deck JSON integrity
vela deck split <deck.vela> --sections "Title:N,..." | --flat | --size N — regroup slides into sections (--flat to merge all into one)
vela deck assemble <deck.vela> [--output <path>] — inject deck into JSX artifact
vela deck ship <deck.vela> [--output <path>] — validate + assemble in one call
vela deck replace-text <deck.vela> "old" "new" — find/replace across all slides (hex colors auto-cascade to rgba)
vela deck stats <deck.vela> — health audit: block distribution, missing durations, overflow, monotony issues
vela deck find <deck.vela> --query "text" | --type flow | --missing duration — search slides by content, block type, or missing props
vela deck dump <deck.vela> [--full] — compact text-only view of all slides (--full for all text fields)
vela deck extract-text <deck.vela> [output.json] — extract all translatable text as key-value map
vela deck patch-text <deck.vela> <texts.json> — apply translated text map back into deck
vela deck expand <compact.vela> <full.vela> — compact/turbo → full format
vela deck compact <full.vela> <compact.vela> — full → compact format
vela deck turbo <deck.vela> <turbo.vela> — any → turbo format
vela deck zip [--output <path>] — build clean skill ZIP for Claude.ai upload
```

**`vela server`** — Local server operations

```
vela server start <folder-or-file> [--port N] [--replace] — Jupyter-style deck browser with live sync
vela server stop [--port N] — stop a running Vela server
```

**`vela slide`** — Slide-level operations (1-indexed slide numbers)

```
vela slide view <deck.vela> <N> — show slide content summary
vela slide edit <deck.vela> <N> <key> <value> — edit slide/block property (block.I.key for blocks)
vela slide remove <deck.vela> <N> — remove a slide
vela slide move <deck.vela> <from> <to> — reorder a slide
vela slide duplicate <deck.vela> <N> — copy a slide
vela slide insert <deck.vela> <N> <slide.json> — insert slide from file
vela slide remove-block <deck.vela> <N> <block#> — remove a block from a slide
```

**Global flags:** `--json (structured output)`, `--dry-run (preview without writing)`, `--help`

**Exit codes:** 0=success, 1=failure, 2=usage error, 3=not found, 4=validation error, 5=conflict

<!-- END AUTO-GENERATED CLI REFERENCE -->
