# Vela Sprint 7-1 — Hyper Sprint NOTES

Branch: `claude/change-requests-hyper-sprint-yant6n` | Base: `origin/base/v12.75` | Start version: 12.75

## Baseline (Phase 0)
- `concat.py` builds clean; `python3 tests/test_vela.py` → **347 passed** / 2 failed.
- The 2 failures = `jsdom` not installed (SVG mXSS + data-image round-trips); CI installs jsdom. Env limitation, not a code fault. Not touched by these UI CRs.
- App boots from CDNs (esm.sh React/lucide, unpkg Babel) that are **network-blocked** here → must vendor via npm to run/record the real app (user approved).

## Agent profile facts (claude-code-cloud-default)
- Prebuilt Chromium at `/opt/pw-browsers/chromium-*/chrome-linux/chrome` (launch via executablePath, `--no-sandbox`).
- registry.npmjs.org reachable (200); general web + CDN 403.
- poppler-utils installed (pdftotext/pdftoppm) for the spec PDF.
- Playwright `.webm` is VP8, not seekable → verify demos via during-drive screenshots, not post-hoc playback.

## Change requests (16)
- CR1  Dialogs: always a default button, focused + visible, Enter confirms.
- CR2  Section reorder via mouse drag-drop (currently no-op; only arrows work). Edge cases.
- CR3  Bug: can't move slides INTO a section that has no slides.
- CR4  Add section anywhere (not only at end); account for add-slide UX.
- CR5  Hide/unhide slides (eye icon). Hidden slides excluded from total time + slide count; top-left stats dialog shows stats incl. hidden.
- CR6  Top stats: round duration to minutes (drop seconds) so slide count fits.
- CR7  "Check for updates" option on the version/release info dialog (reuse existing check).
- CR8  Bug: Re-scan button in AI agent settings not clickable / no-op.
- CR9  Window title + app name should be "Vela Slides" (not "Vela").
- CR10 Slide-list add menu: Add blank slide (no AI, reuse prev slide def, blank) / Add slide with AI (current) / Add section. Make options readable (current "+ ai" hard to read).
- CR11 Bug: AI edit/improve drops existing images. Must preserve image; AI may reposition/adjust around it.
- CR12 Item toolbar: hide any element (like delete). Hidden → not shown & doesn't affect layout in presenter mode (e.g. title used only as TOC guidance).
- CR13 Bug: "Create deck" must create a NEW deck, never overwrite current. Default same folder.
- CR14 Token/cost stats disabled except in Claude artifacts mode.
- CR15 "Export JSON" → "Export Vela" (proper .vela format).
- CR16 Presenter TOC shortcut → Ctrl-E; toggle open/close; typing searches; Enter jumps to first match + closes; click-to-jump closes.

## Readiness — PASSED
- Vendored UMD deps (react/react-dom/lucide-react/@babel-standalone) via npm. lucide UMD reads `global.react` (lowercase) + exports `global.LucideReact` — builder aliases these.
- Builder: `scripts_local/build_recording_html.py <deck> <outdir>` → self-contained CDN-free HTML (mirrors serve.py transforms). Smoke: `scripts_local/smoke.mjs <outdir> <png>`. Chrome at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
- App boots + renders full UI in real Chromium. Harmless console noise: file:///poll CORS (sync client), Babel 500KB deopt, pre-existing React style warnings.

## Clusters (Phase 2) — ideal effort in units
- C1 CR11 (engine image preserve) — part-engine.jsx — 1u
- C2 CR2/3/4/10 (section DnD, empty-drop, add-section-anywhere, add-slide menu) — part-list.jsx + part-reducer.jsx — 4u
- C3 CR5/6/12 (hide slides, stats round+count, hide block) — part-slides/blocks/app/list/imports — 4u
- C4 CR16 (presenter Ctrl-E TOC) — part-slides.jsx — 1.5u
- C5 CR1/7/14/15 (dialog default btn, check-updates, cost gate, export vela) — part-app/chat/imports — 3u
- C6 CR8/13/9 (rescan, create-deck no-overwrite, window title) — part-app + vela-neutralino — 2.5u

## Edit maps (anchors — act without re-reading)

### CR11 (part-engine.jsx) — DONE-target
- `stripImageSrcs` 116-125 (src>200→"[IMAGE]"), `restoreImageSrcs` 97-114 (positional re-attach). buildSystemPrompt injects stripped slide @391.
- BUG: `case "edit_slide"` 182-215 never calls restoreImageSrcs. Same-count branch @193 `{...existing,...v[bi]}` overwrites real src with "[IMAGE]"; diff-count branch @207 `slide.blocks=v` drops images.
- FIX: snapshot slide.blocks before merge; skip incoming src==="[IMAGE]"/placeholder; call restoreImageSrcs after. Keep grid/items/deep tokens (test_vela.py:832-845 greps them). test_vela H1 665-675 sanitize routing.

### CR2/3/4/10 (part-list.jsx + part-reducer.jsx)
- ConceptRow 253-391; SlideListWithAdder 74-250; EmptyAiSlideAdder 60-71 (gated @387 when slides.length===0); ModuleList 394-421; AiSlideAdder 3-56.
- CR2: section drag already wired — draggable row 330-335, handleSectionDragOver 265-272/Drop 274-284→DRAG_REORDER; reducer DRAG_REORDER 52-65, REORDER 51 (arrows @352-353). Verify actual failure (order collisions / inner-row slide handlers 287-305 stealing events). MOVE_ITEM 50 legacy.
- CR3: empty section renders EmptyAiSlideAdder (no drop handlers) → make it a drop zone (onDragOver/onDrop accept application/vela-slide → MOVE_SLIDE_TO_MODULE). Header row backstop 287-305 works but body doesn't. reducer MOVE_SLIDE_TO_MODULE 88 handles empty target.
- CR4: ADD_ITEM reducer 29 APPENDS. Add index/beforeId param (splice+renumber like DRAG_REORDER 62-63). ModuleList add UI 414-418 (addItem 401). Add between-rows "+section" affordance in allItems.map 406-413.
- CR10: only `+ai` adders @175-184 & 236-245 (opacity:0 hover, fontSize:9 — hard to read). Menu: Add blank (local, reuse prev slide def, INSERT_SLIDE 75), Add AI (current), Add section (CR4 path). adderAt state @75.
- ItemChrome (item toolbar) part-blocks.jsx 471-508 (link+delete 496-499); item helpers patchItemAt 300/removeItemAt 307/setItemLink 312.
- Reducer ref: ADD_ITEM 29, REORDER 51, DRAG_REORDER 52-65, ADD_SLIDE 74, INSERT_SLIDE 75, UPDATE_SLIDE 83, MOVE_SLIDE_TO_MODULE 88. Tests part-test.jsx 145-172; test_vela.py:553.

### CR5/6/12 (hide)
- NO hidden field today. Icons Eye/EyeOff exist part-icons.jsx:76. Use slide.hidden + block.hidden.
- fmtTime part-imports.jsx:1183 (shared — DON'T strip seconds globally). Add fmtTimeRounded OR round arg at call.
- SLIDE_KEYS part-slides.jsx:1451 lacks "hidden" — add it (copy/paste retention) + looksLikeSlide 1452.
- CR5: eye toggle → module row part-list.jsx 194-235 (dispatch UPDATE_SLIDE {patch:{hidden:!s.hidden}}) or slide-panel toolbar part-slides.jsx 2226-2229. Exclude hidden: deckTime part-app.jsx:1275 (.filter !hidden), top-stat count part-app.jsx:1317 (reduce filters !hidden, appears 2x title+text). Make stats span @1317 clickable → new stats dialog (state near 1270-1283) showing BOTH counts (excl-hidden + incl-hidden). presSlides part-slides.jsx:1207 — decide if present skips hidden (CR text only mandates stats exclusion — DEFAULT: presentation also skips hidden).
- CR6: part-app.jsx:1317 fmtTime(deckTime) in text+title → round to minutes.
- CR12: block.hidden. Choke point renderBlockWithComments part-blocks.jsx:1623-1628 → `if(b.hidden && presenting) return [];`. Block toolbar buttons 1565-1570 add Eye/EyeOff → handleBlockChange(i,{hidden:!b.hidden}) 1488-1492. Edit mode: keep+dim. sanitizeSlide must preserve hidden.
- Tests: uitest fingerprint 1330-1349 reads `(\d+)sl` — keep substring. part-test fmtTime 10-11.

### CR16 (part-slides.jsx PresenterTOC 379-552, rendered @1961)
- state open 380/search 381/pinned 382/searchRef 384/closeTimer 385-388. Current shortcut key "t" @396 (handler 393-403). grouped memo 405-421 (visible flag @414). handleJump 437-445. result onClick @516. input onKeyDown 479-482 (stopPropagation @480). footer hint @547, header hint @469.
- FIX: shortcut→ (ctrl||meta)&&e==="e" @396 (toggle logic @398 stays). Enter in input→ jump first visible + setOpen(false). click @516 → +setOpen(false)+setPinned(false). Ctrl-E while input focused: add branch in input onKeyDown to close. Conflict check bare "e" fullscreen @1573 (no ctrl — safe). Update hints to Ctrl-E.

### CR1/7/14/15 (part-app.jsx + part-chat + imports)
- ModalBackdrop part-app.jsx:3-19 (Escape+extraKeys; no focus/default). Dialogs: ChangelogDialog 22-76, NewDeckDialog 160-263 (submit @213, autoFocus input @212), ShortcutHelp 267-330, AgentSettingsDialog 505-604, MergePatchDialog 608-786. Ad-hoc JsonClipboardModal part-chat.jsx:307-435.
- CR1: extend ModalBackdrop w/ defaultAction+focus ref; Enter=confirm (suppress in textarea: NewDeck prompt @220, JsonClip @400). Per-dialog primary btn.
- CR7: ChangelogDialog header 26-33/footer 65-73 add "Check for updates". Reuse desktop update-check.js checkForUpdate 227-235 via new window bridge __velaCheckForUpdate(force) in nl-boot.js; gate button on hook presence (like __velaOpenDeckPicker part-app.jsx:1308).
- CR14: CostBadge 336-436 rendered @1369. Gate on artifact mode: add VELA_ARTIFACT_MODE helper near velaAIAvailable part-imports.jsx:29-34 (`!VELA_LOCAL_MODE && window.self!==window.top && window.__velaAgentReady==null`). Remove badge entirely in non-artifact.
- CR15: labels "Export JSON" @1359 + @1408 → "Export Vela". exportDeck 1197-1209: filename .json@1205 → .vela, MIME @1202. Keep _vela:1 envelope; import accepts .json,.vela @1295. UPDATE uitest Export matchers 360-381 (match "JSON").
- extractSave part-imports.jsx:1124 (only JS serializer).

### CR8/13/9 (part-app.jsx + vela-neutralino shell)
- CR8: AgentSettingsDialog part-app.jsx:544 Re-scan `onClick=()=>{try{window.__velaAgents?.refresh?.()}catch{}}` — silent no-op when global absent + not awaited + no busy. FIX: gate/disable on __velaAgents presence, await w/ busy spinner (like revokeAll @531/571). Desktop refresh: nl-boot.js:397-408.
- CR13: NEW_DECK reducer part-reducer.jsx:150-153 resets in place; autosave part-app.jsx:857-876 → __velaSendDeckUpdate writes currentPath (deck-io.js:104-128) → clobbers prior file. deckIO has NO create. FIX: add __velaCreateDeck bridge (nl-boot.js) + deckIO.createDeck() new file in deckIO.folder() 208, re-point currentPath before autosave. Empty-guard exists 868-870. Artifact=localStorage no file (safe). LOCAL_MODE serve via local.html:197.
- CR9: neutralino.config.json:48 "title":"Vela"→"Vela Slides" (applicationName @5 already correct); index.html:20 <title>; index.html:60 splash; local.html:28 splash VELA; nl-boot.js:48 error splash. React document.title already correct part-app.jsx:1191-1194. test_desktop.py loads config @31.
<!-- recon complete -->
