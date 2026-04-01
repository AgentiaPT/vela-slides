---
name: vela-slides
version: 12.24
updated: 2026-04-01

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
vela server start <folder-or-file> [--port 3030]        # Jupyter-style deck browser with live sync
vela deck ship <deck.vela> --output <name.jsx>         # cloud/artifact only — self-contained .jsx
vela deck extract <source.jsx> <output.vela>           # extract deck from .jsx artifact
```

When user asks to "load the demo deck", "show the demo", or "show me what Vela can do": use `--demo`. **Do NOT generate a new deck.**
`python3 skills/vela-slides/scripts/vela.py <resource> <action> [args...]`

### Runtime modes
- **Local (default)**: `vela server start` — Jupyter-style HTTP server with folder browser, live two-way sync, hot reload, and per-deck file watching. Pass a folder or a file (auto-resolves to parent folder). Token printed at startup; use `--no-auth` for auth-free local access. Works on Linux, macOS, and Windows.
- **Cloud artifact**: `vela deck ship` — produces a self-contained `.jsx` artifact. Use ONLY inside Claude.ai artifacts or other sandboxed cloud runtimes where a local server cannot be started.

## Deck DSL (compact — the ONLY format you write)

Minified, one line. NEVER use `"type"`, `"text"`, `"deckTitle"`, `"lanes"`, `"slides"`, `"blocks"`.

`{"n":"Title","C":{palette},"T":{themes},"G":[sections]}`

**`C`** — Colors used 2+ times as `$A`-`$Z`. Frequency order. Hex 6 or 8 chars.
**`T`** — `"d"`:dark `{"b":"#0A0F1C","c":"#E6F1FF","a":"$A","p":"60px 72px"}`, `"a"`:alt different shade. Alternate d/a.
**`G`** — Sections (USE FOR ALL DECKS): `[{"g":"Name","S":[slides]}]`. 3-5 narrative sections.
**Slide** — `{"t":"d","n":"Assertion Headline","d":60,"B":[blocks]}`. Cover/CTA: `bgGradient`,`align:"center"`,`verticalAlign:"center"`. Duration: cover 20, content 60-90, CTA 25. Spacers: bare int.

**Keys**: `_`(type) `x`(text) `s`(size) `c`(color) `i`(icon) `b`(bg) `w`(weight) `ic`(iconColor) `ib`(iconBg) `I`(items) `g`(gap) `lb`(label) `v`(variant) `H`(headers) `R`(rows)

## Blocks (use 10+ per deck)

`{"_":"heading","x":"Title","s":"2xl","w":700}` `{"_":"text","x":"Body","s":"lg","c":"$C"}` `{"_":"badge","x":"LABEL","i":"Zap","b":"$E","c":"$A"}` `{"_":"code","x":"const x=1","lb":"JS"}` `{"_":"quote","x":"Text","author":"Name"}` `{"_":"callout","x":"Note","title":"Warn","b":"$F","i":"AlertTriangle"}` `{"_":"metric","value":"98%","lb":"Acc","s":"3xl","c":"$A"}` `{"_":"progress","value":75,"lb":"Done","c":"$A"}` `{"_":"icon-row","I":[{"i":"Brain","title":"AI","x":"Desc","ic":"$A","ib":"$E"}]}` `{"_":"tag-group","I":[{"x":"Tag","c":"$A"}],"v":"outline"}` `{"_":"bullets","I":["A","B"]}` `{"_":"table","H":["X","Y"],"R":[["1","2"]],"hb":"$A"}` `{"_":"grid","I":[{"blocks":[{"_":"metric","value":"5","lb":"X"}],"style":{"padding":"20px","background":"$F"}}]}` `{"_":"flow","I":[{"i":"Upload","lb":"In"},{"i":"Cpu","lb":"Process"}],"ac":"$A"}` `{"_":"steps","I":[{"title":"1","x":"Do"}],"lnc":"$A"}` `{"_":"timeline","I":[{"title":"Q1","x":"Launch"}],"dc":"$A"}` `12`=spacer `{"_":"divider","c":"$C"}`

## Quality

- Sections via `G` (3-5 groups). Assertion headlines ("Churn Drops to 2.1%", not "Churn")
- 10+ block types, semantically matched. `4xl` cover → `2xl` body → `3xl` CTA
- Badge every content slide. Closing: recap callout/tag-group + gradient. 960×540 canvas.

## Workflow (STRICT — minimal tool calls)

Complete the deck efficiently. No unnecessary Read, validate, or commentary between calls.

**Call 1** — Write the complete deck JSON to a `.vela` file:
```
Use the Write tool to write the entire compact deck JSON to <name>.vela
```

**Call 2** — Present the deck:

**Local environment (default)** — start the Jupyter-style server:
```bash
vela server start <folder-or-file> --port 3030
```
The browser auto-opens with the auth token. Server sets a session cookie and 302-redirects to strip the token from the URL.

**Token hygiene**: NEVER read or print the contents of `.vela.env`. The token is for the browser only — the LLM must not see it. If the user needs to authenticate manually, point them to `.vela.env` — do not extract or display the token yourself.

If a server is already running on the same port, use `--replace` to kill it, or pick a different `--port`.

The server shows a folder browser listing all decks. Each deck opens with live two-way sync.

**Cloud artifact runtime only** — assemble a self-contained .jsx:
```bash
vela deck ship <file> --output <name.jsx>
```
Use `ship` ONLY when a local server cannot be started (e.g., Claude.ai artifacts, sandboxed cloud environments).

Done. Do not speak before, between, or after tool calls.

## CLI

```
vela deck ship|validate|list|stats|replace-text|extract|extract-text|patch-text
vela server start
vela slide edit|view|remove|move|duplicate|insert|remove-block
```