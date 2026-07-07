# PPTX Export — "PowerPoint found a problem / repair?" Root-Cause Investigation

**Date:** 2026-07-07
**Branch/worktree:** `claude/pptx-repair-investigation` (worktree `/tmp/wt-repair-fix`, forked from `claude/powerpoint-export-feature-jhuc8c`)
**File under investigation:** `skills/vela-slides/app/parts/part-pptx.jsx`

## Summary

Real Microsoft PowerPoint showed *"We found a problem with some content… would you like us to
repair?"* on the **first** open of an exported deck, even though `python-pptx` read-back and
LibreOffice Impress both open it silently. Root cause found and fixed: **native tables were
emitted without a `<a:tableStyleId>`, and the package shipped no `tableStyles.xml` part.** This
is a documented PowerPoint repair trigger that lenient readers ignore.

## Method

1. Read `part-pptx.jsx` in full and mapped every OOXML part it emits.
2. Ran the emitter's `buildPptx()` in Node (via `vm`, stubbing the cross-part globals) with a
   synthetic IR exercising **every** path — solid/gradient/alpha fills, roundRect, ellipse,
   multi-paragraph text box, a **table (incl. a ragged row)**, an embedded PNG, an
   `asvg:svgBlip` SVG-with-PNG-fallback picture, and an external hyperlink. Produced a byte-for-byte
   real `.pptx`.
3. Built a **known-good reference** with `python-pptx` 1.0.2 containing structurally similar
   content (text box, rounded rect, oval, 3×3 table, picture, hyperlinked shape).
4. `python3 -m zipfile -e` both; `xmllint --format` every part; diffed structure (parts present,
   element ordering, attributes, ID/rel schemes).
5. Confirmed each candidate against the PresentationML/DrawingML schema rules and via targeted web
   research of the specific repair triggers.

## Root cause (confirmed)

**Missing table style reference.** `pptxTableFrame()` emitted:

```
<a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>…</a:tblGrid>…</a:tbl>
```

i.e. a table carrying banding attributes (`firstRow`/`bandRow`) but **no `<a:tableStyleId>`**, and
`buildPptx()` shipped **no `ppt/tableStyles.xml` part** at all.

The `python-pptx` reference instead emits inside `<a:tblPr>`:

```
<a:tableStyleId>{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}</a:tableStyleId>
```

and ships `ppt/tableStyles.xml` (`<a:tblStyleLst def="{…}"/>`) referenced from
`ppt/_rels/presentation.xml.rels` and declared in `[Content_Types].xml`.

Per Microsoft's OOXML spec and multiple hand-rolled-OOXML reports, a `<a:tbl>` whose `tblPr` has
no `tableStyleId` (or references a style that resolves to nothing) is exactly the kind of
schema-plausible-but-noncompliant construct that PowerPoint's stricter validator flags for repair,
while `python-pptx` and LibreOffice silently tolerate it. The repro deck **`examples/tech-talk.vela`
contains a `table` block**, so the shipped export hit this path.

Evidence:
- Structural diff: `tableStyleId` present in reference, absent in ours; `tableStyles.xml` part
  present in reference, absent in ours (the *only* repair-linked delta between the two files).
- Web-confirmed repair trigger (MS-OE376 §5.1.6.10 `tableStyleId`; Brandwares / officeopenxml.com;
  python-pptx table-style analysis).
- Repro deck has exactly one `table` block.

### Fix

`part-pptx.jsx`:
- `pptxTableFrame` (~line 300): `tblPr` now emits
  `<a:tableStyleId>{2D5ABB26-0587-4C30-8999-92F81FD0307C}</a:tableStyleId>`.
- New constants `PPTX_TABLE_STYLE_ID` / `PPTX_TABLE_STYLES` (~line 247).
- `pptxContentTypes` / `pptxPresentationRels` take a `hasTables` flag and add the
  `tableStyles.xml` Override + relationship when a table is present.
- `buildPptx` computes `hasTables` and pushes `ppt/tableStyles.xml` only when a deck has a table
  (table-free decks stay minimal — verified).

**Chosen style GUID `{2D5ABB26-0587-4C30-8999-92F81FD0307C}` = built-in "No Style, No Grid"**
(web-verified, not guessed). Deliberately chosen over python-pptx's medium/accent default because
our emitter already paints every cell's own borders/fills/text explicitly in `<a:tcPr>`; a
"no style / no grid" reference adds no borders or banding of its own, so PowerPoint gets a valid
style reference while our per-cell paint fully controls appearance (no visual change). A matching
`tableStyles.xml` with `def="{same GUID}"` is shipped for parity with the known-good package.

## Things checked and ruled OUT (not the cause)

- **`asvg:svgBlip` extension GUID** `{96DAC541-7B7A-43D3-8B79-37D633B846F1}` — **correct** (matches
  Apache POI + OpenXML SDK). The value floated in the task brief (`…8B71-5CB84100A65E`) is a
  *different* extension and would have been wrong; the code's GUID is right. `xmlns:asvg`,
  `r:embed`, and `<a:extLst>`-last-child ordering all correct.
- **Shape/graphicFrame `cNvPr id` uniqueness** — group is `id=1`, children `2..N` unique per slide.
- **Element ordering** — verified against schema for `<p:spPr>` (xfrm→geom→fill→ln),
  `<a:txBody>` (bodyPr→lstStyle→p), `<a:tcPr>` (lnL/R/T/B→fill), `<a:blip>` (extLst last),
  `<a:gradFill>` (gsLst→lin), `<p:sld>` (cSld→clrMapOvr), presentation
  (sldMasterIdLst→sldIdLst→sldSz→notesSz). All correct.
- **Relationship completeness** — every `r:embed`/`r:id` on a slide resolves in its `.rels`; layout↔
  master↔theme rels complete; media parts exist with matching `[Content_Types].xml` defaults
  (png/svg/jpeg present).
- **`sldSz type` vs dimensions** — ours says `screen16x9` with 12192000×6858000 EMU. NOT a trigger:
  python-pptx ships an even more mismatched `screen4x3` with the same widescreen dims and opens
  cleanly.
- **ZIP structure** — `[Content_Types].xml` first entry, STORE method (0) declared in both local +
  central records, correct 30/46-byte headers, EOCD present, deterministic mod date. Parsed by
  python-pptx, LibreOffice, and the test's own STORE reader.
- **ID numbering** — `sldMasterId=2147483648`, `sldLayoutId=2147483649`, `sldId=256`, all in the
  conventional PowerPoint ranges.

## Verification

- `concat.py` — in sync (18222 lines, 14 parts, no dup declarations).
- `python3 tests/test_vela.py --all` — **354 core + 17 pptx e2e assertions + python-pptx read-back,
  0 failed** (the pptx e2e runs the REAL browser export of `tech-talk.vela`, then structurally
  validates). 4 of those 17 are the new regression assertions.
- Regenerated synthetic export: `python-pptx` read-back confirms the table now carries
  `tableStyleId {2D5ABB26-…}`; `tableStyles.xml` present + referenced + typed; table-free deck
  correctly omits it.
- LibreOffice `--convert-to pdf` renders (visual path intact; a libpng CRC warning is only from the
  synthetic 1×1 PNG test fixture, unrelated).

## Regression test added

`tests/test_pptx_export.cjs` (4 new assertions, run against the real export):
- every `<a:tbl>` carries a `<a:tableStyleId>`,
- `ppt/tableStyles.xml` shipped when a table is present,
- `presentation.xml.rels` references it,
- `[Content_Types].xml` declares it.

## Open items / could-not-fully-confirm (for a follow-up pass)

1. **No real PowerPoint / Microsoft Open XML SDK validator in this container**, so I cannot *prove*
   zero remaining repair triggers by opening the file. Confidence is high (documented trigger +
   exact known-good delta + repro deck has a table), but the ultimate confirmation — opening the
   fixed file in real PowerPoint — still needs a human with Office. **Please do one manual open of a
   table-containing export in real PowerPoint to close the loop.**
2. **Full XSD schema validation not run.** The interlinked ECMA-376/ISO-29500 XSD set wasn't readily
   available offline, so validation was schema-rule reasoning + python-pptx structural diff +
   web-confirmed triggers rather than `xmllint --schema`. If a follow-up wants belt-and-suspenders,
   run the fixed export through the OOXML SDK Productivity Tool / `officeotron`.
3. **Optional parts we still omit vs python-pptx** (NOT repair triggers, left out to keep the change
   minimal): shapes lack `<p:style>`, slide master lacks `<p:txStyles>`, package lacks
   `docProps/{core,app}.xml`, `presProps.xml`, `viewProps.xml`. PowerPoint opens files without these
   (many generators omit them). If a *different* first-open warning ever surfaces on a table-free
   deck, these are the next place to look — start with `docProps/core.xml` + `presProps.xml`.
