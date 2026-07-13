# Sprint "porter" — Full PowerPoint (.pptx) → Vela import

Date: 2026-07-13 · Branch: `claude/powerpoint-import-feature-njfqlm` (base `main`, HEAD 5c066f5)

## Verbatim original prompt

> first ensure your main is up to date and not stale vs origin. we need to implement now the
> full import from powerpoint feature, make it as visually close as possible for any powerpoint
> deck, use hyper sprint skill to fully drive the sprint. conversion should reflow and loose any
> positional encoding. attaching all the previous spike sprint for this sprint, also attaching
> fresh decks that can serve as evals. mandatory any visible content must be also visible on vela,
> nothing is lost. as close as possible to the original aspect and layout. dont pull large docs or
> images, or content into your main context, leverage sub agents, except for any operation you are
> 1) certain it will succeed 2) token short 3) less tokens than sub agent hand off.
> Attachments: M365CopilotTechTalk.pptx, githubcopilottechtalk.pptx, mirrorsprintkit.zip (prior
> spike), VelaSlidesLiveDemo_10.pptx, Genetic_Engineering.pptx.

## Locked UX decisions (from batched Phase-0 questions)
1. **Dense slides:** strict 1 pptx-slide → 1 Vela-slide, rely on auto-fit shrink (preserve deck structure/aspect).
2. **Charts/SmartArt/unsupported graphics:** extract ALL text into bullets/table, NO visual placeholder.
3. **Speaker notes:** import into Vela `slide.notes` (field exists, rendered in presenter mode).

## Approach
Fresh `src/parts/part-pptximport.jsx` (browser-native: hand-rolled ZIP central-dir reader +
`DecompressionStream('deflate-raw')` + native `DOMParser`, NO new deps). Port the geometry-aware
mapper from `pptx_import_v2.py`. Semantic RE-FLOW: parse EMU geometry only to derive reading order
+ column/card clustering, then DISCARD positions (Vela is flow-stacked). Mandatory: every visible
source text char + image appears in the output deck.

**Entry-point contract (B & C code against this):**
`async function pptxToVelaDeck(arrayBuffer) -> Promise<{deckTitle, lanes:[{title,items:[{title,slides:[...]}]}]}>`
— FULL Vela deck format; throws on non-pptx; never returns undefined. All helpers prefixed `_ppx`
to keep concat's no-duplicate-declaration check happy.

**Output contract (from integration-map.md):** image block `{type:"image", src:"data:..."}` (raster
mimes only); table `{type:"table", headers:[...], rows:[[...]]}`; multi-column via slide-level
`layout:{type:"cols"/"split", L:[blocks], R:[blocks]}` (cols is NOT a block type); grid cell nests
`{blocks:[...]}`. Slide fields: bg/color/accent/duration/blocks/notes. Notes string sanitized by importer.

## Clusters (file-locality partition)
- **CR1 — Importer core** (worktree, strong model, high effort). File: `src/parts/part-pptximport.jsx` (new).
  Full parse→map pipeline + notes + chart/SmartArt text extraction. Self-validates standalone in
  node (jsdom DOMParser, node DecompressionStream/btoa) against a synthetic .pptx.
- **CR2 — UI + version wiring** (worktree, medium, parallel w/ CR1). Files: `src/parts/part-app.jsx`
  (pptx branch in loadDeckFile: readAsArrayBuffer → await pptxToVelaDeck → shared LOAD tail; accept
  `.pptx`), `src/parts/part-imports.jsx` (VELA_VERSION 13.8→13.9 + VELA_CHANGELOG entry).
- **concat.py insert** — one-line `PART_ORDER` insert of `"part-pptximport.jsx"` between part-pptx
  and part-app. Done by ORCHESTRATOR at merge (trivial, certain, token-cheap).
- **CR3 — Tests** (after CR1+CR2 merge, medium). Files: new `tests/test_pptx_import.cjs` (jsdom
  sandbox loads part-pptximport.jsx, builds synthetic .pptx in-memory, asserts blocks + zero text
  loss + notes + table + image + non-pptx throws), register in `tests/test_vela.py`.

## Batches
- Batch 1 (parallel worktrees): CR1 + CR2 → merge (A then B) → orchestrator concat insert → rebuild → full suite green.
- Batch 2: CR3 → merge → full suite green.
- Phase 4: fix-round hunt on 4 real fixtures (offline render + visual check via sub-agents).
- Phase 5: blind gate (per-CR verifier + broad hunter) + visual eval judge (source-vs-Vela montage per fixture) + Markdown proof report + archive.

## Stop rule
Blind best-model hunt (engine-enforced deadline) clean + visual eval judge confirms no content lost
& layout close on all 4 fixtures + full suite green + proof report exists.

## What happened vs plan

- 3 planned clusters landed as scoped (CR1‖CR2 parallel worktrees → merge → orchestrator concat
  insert → CR3). Suite 361→362.
- Blind gate round 1 found a real content-loss bug (reflowed grids > the sanitizer's 6-cell load
  cap were truncated; a card-cluster cap dropped cards) → +1 unplanned fix-round: grid-split pass +
  card-cap removal + a text safety-net + 7 regression guards. Version 13.9→13.10.
- Fix-round vision QA hit a harness artifact (staggered block fade-in captured mid-animation);
  disproved by DOM inspection, fixed in the capture harness (fade-settle), not the app.
- Blind gate round 2 (fresh agent): CLEAN — nothing-lost verified on all 4 fixtures.
- Final: 362 tests + 36 importer assertions green; feature complete; stop rule satisfied.
