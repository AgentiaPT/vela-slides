# Coverage Gap Report — Core Deck Logic (reducer, CLI, deck format, Python stack)

Slice owner scope: `src/parts/part-reducer.jsx`, `skills/vela-slides/scripts/vela.py`,
`src/parts/part-imports.jsx` (deck format / sanitizers / helpers), and the
Python unit+integration test stack in `tests/test_vela.py`.

---

## 1. Stack execution results

Commands run exactly as CI runs them (local Python **3.11.15**; CI uses 3.12):

| Command | Result | Notes |
|---|---|---|
| `python3 tests/test_vela.py --unit` | **253 passed, 2 skipped, 0 failed** | Both skips are dependency-gated, not version-gated |
| `python3 tests/test_vela.py --integration` | **101 passed, 0 failed** | All green |
| Combined slice total | **354 checks, 2 skipped, 0 red** | |

**The 2 skips (both under `--unit`):**
- `SVG mXSS jsdom round-trip suite` — `tests/test_svg_mxss.cjs` — skipped: *jsdom not installed* (`tests/test_vela.py:390`)
- `data: image sanitization suite` — `tests/test_data_image_uri.cjs` — skipped: *jsdom not installed* (`tests/test_vela.py:~415`)

**Version note:** No test skipped because of Python 3.11-vs-3.12. The only skips are `npm i jsdom` deps. In CI these two behavioral sanitizer suites would run (they are the *only executed* tests of `sanitizeSvgMarkup` and `sanitizeImageDataUri`), so **on this local box the real SVG-mXSS and data-URI sanitizer behavior is never exercised** — the local pass is source-regex smoke only.

**Critical structural finding:** `tests/test_vela.py` is a Python harness. It **cannot execute the JSX reducer or the JS sanitizers directly.** Almost all "security" assertions under `--unit` are *source-regex* checks (`if 'someCodePattern' in all_jsx`), i.e. they verify a string is present in the concatenated `.jsx`, not that the code behaves correctly. Behavioral JS coverage exists only in a handful of node `.cjs` suites invoked as subprocesses. The Python-side deck-format functions in `vela.py` (`expand_deck`/`compact_deck`/`turbo_deck`) *are* executed for real, but only over narrow inputs.

---

## 2. Coverage matrix

### 2a. Reducer actions — `src/parts/part-reducer.jsx`

**Headline: 0 of 62 reducer actions have behavioral test coverage.** The reducer is never instantiated or dispatched in any test. `tests/test_ux_logic.cjs:69` even documents this: *"the reducer isn't safely extractable in isolation"*, so it only greps for three `case` labels. Everything below marked "❌ none" or "🟡 source-regex" is **never executed**.

| # | Action | Line | Covered? | By which test | Notes |
|---|---|---|---|---|---|
| 1 | `LOAD` | 12 | ❌ none | — | slideIndex clamp on stale index (`:24-28`), presentation auto-select (`:21-23`), `_loadedMods` marking — all untested |
| 2 | `ADD_LANE` | 31 | ❌ none | — | case-insensitive dup-title guard untested |
| 3 | `REMOVE_LANE` | 32 | ❌ none | — | `_deletedMods` side-effect, selectedId reset untested |
| 4 | `RENAME_LANE` | 33 | ❌ none | — | |
| 5 | `SET_ITEM_NOTES` | 34 | ❌ none | — | |
| 6 | `TOGGLE_LANE` | 35 | ❌ none | — | in NO_HISTORY set |
| 7 | `ADD_ITEM` | 36 | ❌ none | — | sanitizeSlide mapping, order assignment, dirty-tracking untested |
| 8 | `INSERT_ITEM` | 37 | 🟡 source-regex | `test_ux_logic.cjs:71` | only asserts `case "INSERT_ITEM":` + `afterId` strings exist; before/after insert-index math never run |
| 9 | `SPLIT_ITEM_AT` | 42 | ❌ none | — | tail-split vs before/after empty-section branching (`:51-53`) untested — high-risk index math |
| 10 | `IMPORT_CONCEPTS` | 61 | ❌ none | — | 100-slide clamp, sanitize path untested |
| 11 | `BATCH_ADD` | 75 | ❌ none | — | string-vs-object item coercion untested |
| 12 | `REMOVE_ITEM` | 76 | ❌ none | — | |
| 13 | `RENAME_ITEM` | 77 | ❌ none | — | |
| 14 | `CYCLE_STATUS` | 78 | ❌ none | — | STATUS_META.next transitions + signedOffAt toggling untested |
| 15 | `SET_STATUS` / `SET_IMPORTANCE` | 79 | ❌ none | — | one case label, two action types |
| 16 | `TOGGLE_PRESENT_CARD` | 80 | ❌ none | — | |
| 17 | `MOVE_ITEM` | 81 | ❌ none | — | |
| 18 | `REORDER` | 82 | ❌ none | — | up/down swap + order renumber untested |
| 19 | `DRAG_REORDER` | 83 | 🟡 source-regex | `test_ux_logic.cjs:72` | only asserts `case "DRAG_REORDER":` present; insert-index math never run |
| 20 | `SET_SLIDES` | 104 | ❌ none | — | sanitizeSlide chokepoint (security-critical) never behaviorally verified |
| 21 | `ADD_SLIDE` | 105 | ❌ none | — | sanitize-null-drop path untested |
| 22 | `INSERT_SLIDE` | 106 | ❌ none | — | splice index untested |
| 23 | `UPDATE_SLIDE` | 114 | ❌ none | — | merge vs replace patch, timeLock preservation (`:114`), re-sanitize — all untested; security-critical |
| 24 | `REMOVE_SLIDE` | 115 | ❌ none | — | |
| 25 | `TOGGLE_SLIDE_HIDDEN` | 116 | 🟡 source-regex | `test_ux_logic.cjs:70` | asserts `case "TOGGLE_SLIDE_HIDDEN":` present; hidden add/delete-key toggle never run |
| 26 | `DUPLICATE_SLIDE` | 117 | ❌ none | — | deep-clone via JSON round-trip untested |
| 27 | `MOVE_SLIDE` | 118 | ❌ none | — | bounds guard untested |
| 28 | `REORDER_SLIDE` | 119 | ❌ none | — | from/to splice untested |
| 29 | `MOVE_SLIDE_TO_MODULE` | 120 | ❌ none | — | cross-module move + toIndex/selectedId derivation (`:120`) untested — complex |
| 30 | `SELECT` | 121 | ❌ none | — | NO_HISTORY |
| 31 | `SET_SLIDE_INDEX` | 122 | ❌ none | — | NO_HISTORY |
| 32 | `SET_FULLSCREEN` | 123 | ❌ none | — | fontScale reset side-effect untested |
| 33 | `SET_FONT_SCALE` | 124 | ❌ none | — | |
| 34 | `DESELECT` | 125 | ❌ none | — | |
| 35 | `ADD_COMMENT` | 127 | ❌ none¹ | — | slide vs item anchoring, MAX_COMMENTS clamp, text/anchor truncation untested |
| 36 | `UPDATE_COMMENT` | 135 | ❌ none¹ | — | |
| 37 | `RESOLVE_COMMENT` | 141 | ❌ none¹ | — | |
| 38 | `REOPEN_COMMENT` | 147 | ❌ none¹ | — | |
| 39 | `REMOVE_COMMENT` | 153 | ❌ none¹ | — | |
| 40 | `RESOLVE_ALL_COMMENTS` | 159 | ❌ none¹ | — | has-open short-circuit + dirty tracking untested |
| 41 | `CLEAR_RESOLVED_COMMENTS` | 169 | ❌ none¹ | — | |
| 42 | `SET_REVIEW_MODE` | 178 | ❌ none | — | |
| 43 | `SET_COMMENTS_PANEL` | 179 | ❌ none | — | |
| 44 | `SET_CHAT` | 180 | ❌ none | — | |
| 45 | `RESET_CHAT` | 181 | ❌ none | — | |
| 46 | `NEW_DECK` | 182 | ❌ none | — | `_bootstrap` payload + init-reset untested |
| 47 | `CLEAR_BOOTSTRAP` | 186 | ❌ none | — | |
| 48 | `SET_VERA_MODE` | 187 | ❌ none | — | teacherHistory reset untested |
| 49 | `TEACHER_MSG` | 188 | ❌ none | — | keyed history append untested |
| 50 | `TEACHER_LOADING` | 189 | ❌ none | — | |
| 51 | `TEACHER_CLEAR` | 190 | ❌ none | — | |
| 52 | `ADD_MSG` | 191 | ❌ none | — | |
| 53 | `STREAM_TOOL` | 192 | ❌ none | — | thinking/calling/done event branching (`:197-199`) untested |
| 54 | `FINALIZE_STREAM` | 203 | ❌ none | — | non-streaming guard untested |
| 55 | `SET_LOADING` | 210 | ❌ none | — | |
| 56 | `SET_DEBUG` | 211 | ❌ none | — | |
| 57 | `LOAD_LANES` | 212 | 🟡 source-regex | `test_vela.py:~795` (comment only) | Vera-write sanitize chokepoint; only referenced in prose/source checks, never dispatched |
| 58 | `SET_BRANDING` | 231 | ❌ none | — | scrubColorFields on merged branding untested |
| 59 | `SET_GUIDELINES` | 232 | ❌ none | — | (guidelines *strip* regex is behaviorally tested at import layer, not this action) |
| 60 | `RESET` | 233 | ❌ none | — | preserves chatOpen |
| 61 | `SET_TITLE` | 234 | ❌ none | — | |
| 62 | `UNDO` | 242 | ❌ none | — | past/future stack, selectedId/slideIndex clamp (`:248-257`), streaming finalize, undo-marker inject — all untested; complex + high-risk |
| 63 | `REDO` | 270 | ❌ none | — | mirror of UNDO; MAX_HISTORY slice untested |

¹ Comment actions *may* be exercised by `tests/test_review_ui.cjs`, but that suite runs **only under `--all`** (`run_e2e_tests`, `test_vela.py:2575`), **not** under `--unit`/`--integration`. It is out of the CI slice defined here and is jsdom/e2e, not a reducer unit test.

Also untested: the `NO_HISTORY` set membership logic (`:5`), `MAX_HISTORY` cap of 50 (`:6`, `:268`,`:292`), and the `newPresent === hist.present` no-op short-circuit (`:295`).

### 2b. CLI subcommands — `skills/vela-slides/scripts/vela.py`

Router `COMMANDS` at `vela.py:2600`. 17 `deck` + 8 `slide` = **25 subcommands.**

| Subcommand | Def line | Covered? | By which test | Notes |
|---|---|---|---|---|
| `deck list` | 1035 | ✅ full | `test_vela.py:1675` | slide-count assertion |
| `deck validate` | 1072 | 🟡 partial | `test_vela.py:1682` | only "runs and produces output"; exit-code semantics (EXIT_VALIDATION=4) not asserted |
| `deck extract` | 1138 | ❌ none | — | STARTUP_PATCH extraction from a `.jsx` never tested |
| `deck assemble` | 1105 | 🟡 partial | integration `test_vela.py:1119` tests `assemble.py` **script**, not the `deck assemble` CLI wrapper | wrapper arg-plumbing/exit codes untested |
| `deck ship` | 1182 | ❌ none | — | validate→assemble pipeline, `--demo`/`--sample`, EXIT_VALIDATION path all untested |
| `deck replace-text` | 1316 | ✅ full | `test_vela.py:1769,1784,1962` | text + hex→rgba cascade + persistence |
| `deck expand` | 1367 | 🟡 partial | `test_vela.py` (block-primitives `:3170`), study-notes | only via new-blocks/studyNotes round-trips; no full-key expansion assertion over all block types |
| `deck compact` | 1398 | 🟡 partial | block-primitives `:3170`, study-notes `:2831` | same narrow inputs |
| `deck turbo` | 1437 | 🟡 partial | block-primitives `:3196`, study-notes `:2860` | positional encode tested only for new blocks + studyNotes pos-10 |
| `deck stats` | 1746 | ✅ full | `test_vela.py:1703,1720` | count, missing-duration, monotony, overflow, `--json` |
| `deck find` | 1854 | ✅ full | `test_vela.py:1731-1766,1952` | `--query`/`--type`/`--missing`/`--json` + usage error |
| `deck dump` | 1977 | ✅ full | `test_vela.py:1690,1696` | default + `--full` |
| `deck extract-text` | 2295 | ✅ full | `test_vela.py:1800,1988` | keys, nested, table, lane/module titles |
| `deck patch-text` | 2322 | ✅ full | `test_vela.py:1836,1847` | round-trip identity + modify |
| `deck split` | 2344 | ✅ full | `test_vela.py:1868-1916` | `--sections`/`--flat`/`--size`/`--dry-run`/no-flags |
| `deck zip` | 2479 | ❌ none | — | ZIP build, exclude-dirs, `--output` untested |
| `deck init` | 2513 | ❌ none | — | skeleton (`n`/`C`/`T`/`G`), `--palette`/`--themes`/`--sections` JSON parsing untested |
| `slide view` | 1531 | ✅ full | `test_vela.py:2017,2024,1946` | default + `--raw` + out-of-range error |
| `slide edit` | 1571 | ✅ full | `test_vela.py:1923,1936` | block.N.prop + slide-level; true/false coercion (`:1598,1622`) not asserted |
| `slide remove` | 1636 | ✅ full | `test_vela.py:2038` | count 5→4 |
| `slide move` | 1660 | 🟡 partial | `test_vela.py:2071` | only "executes"; no positional-result assertion; target-not-found (EXIT_NOT_FOUND) untested |
| `slide duplicate` | 1686 | ✅ full | `test_vela.py:2055` | count 5→6 |
| `slide insert` | 1701 | ❌ none | — | after-num + `@file`/inline JSON insert untested |
| `slide remove-block` | 1719 | ❌ none | — | block-index removal + not-found untested |
| `slide append` | 2570 (approx) | ❌ none | — | G vs S format append, section-index bounds, `@file` untested |

**Untested CLI surface: 9 subcommands** — `deck extract`, `deck ship`, `deck zip`, `deck init`, `slide insert`, `slide remove-block`, `slide append` (fully none) + `deck assemble` (wrapper) and several partials.

**Exit codes** (`vela.py:34-39`): EXIT_OK=0, EXIT_FAIL=1, EXIT_USAGE=2, EXIT_NOT_FOUND=3, EXIT_VALIDATION=4, EXIT_CONFLICT=5.

| Exit path | Covered? | Notes |
|---|---|---|
| EXIT_OK (0) | ✅ | implicit in every green CLI test |
| EXIT_USAGE (2) | 🟡 partial | `deck find` w/o filters → nonzero (`:1952`); but tests only check `returncode != 0`, never assert the code is *2* |
| EXIT_NOT_FOUND (3) | 🟡 partial | `slide view 99` → nonzero (`:1946`); code value never asserted; most not-found branches (bad section, bad block, missing slide file) untested |
| EXIT_FAIL (1) | ❌ none | assembly-failed / no-G-or-S branches untested |
| EXIT_VALIDATION (4) | ❌ none | `deck validate`/`deck ship` failure code never asserted |
| EXIT_CONFLICT (5) | ❌ none | never triggered by any test |
| Path-traversal guard (`_safe_resolve`, `vela.py:49`) | ❌ none | `../` rejection (EXIT_USAGE) untested — security-relevant |

### 2c. Deck-format paths (Python `vela.py` codec + `_load_full`)

| Path | Def line | Covered? | By which test | Notes |
|---|---|---|---|---|
| `expand_deck` | 262 | 🟡 partial | study-notes `:2848`, block-primitives | studyNotes + 6 new blocks only |
| `compact_deck` | 386 | 🟡 partial | study-notes `:2831` | short-key emission for `sN` verified; no all-block-type identity |
| `turbo_deck` | 880 | 🟡 partial | study-notes `:2860`, block-primitives | positional array for pos-10 studyNotes; length-10 backward-compat |
| `unturbo_deck` | (imported `:2727`) | 🟡 partial | study-notes `:2864` | turbo→unturbo studyNotes.text only |
| `_load_full` (auto-detect) | 981 | 🟡 partial | via `deck expand` on compact+turbo inputs (block-primitives) | full/compact/turbo detection exercised for happy path; malformed/ambiguous input untested |
| `_expand_block`/`_compact_block` | 219/376 | 🟡 partial | new-block round-trips | spacer-key special case (`:380`), theme resolution (`t` key, `:241`) untested |
| `_turbo_encode_block`/`_turbo_decode_block` | 552/670 | 🟡 partial | new-block round-trips | per-block positional schema for the ~20 original block types largely unexercised |
| Palette (`C`) + Themes (`T`) resolution | — | ❌ none | — | no test builds a deck using `C`/`T` short keys and asserts colors resolve on expand |
| **Full→Compact→Full identity over all 27 block types** | — | ❌ none | — | **no comprehensive round-trip identity test exists**; only new-blocks (6) + studyNotes are round-tripped |

### 2d. Sanitizers & helpers — `src/parts/part-imports.jsx`

"Behavioral" = code is actually executed. "Source-regex" = `test_vela.py` only greps `all_jsx` for a code pattern (JS never run).

| Item | Def line | Covered? | By which test | Notes |
|---|---|---|---|---|
| `sanitizeSvgMarkup` | 519 | 🟡 behavioral (CI only) | `test_svg_mxss.cjs` | **SKIPPED locally** (jsdom); source-regex smoke in `test_vela.py:168-184` |
| `sanitizeImageDataUri` | 629 | 🟡 behavioral (CI only) | `test_data_image_uri.cjs` | **SKIPPED locally** (jsdom) |
| `isSvgStyleSafe` | 489 | ✅ behavioral | `test_css_exfil.cjs` (`test_vela.py:699-706`) | real predicate run against PoC values; extensive source-regex too |
| guidelines control/bidi strip | (import layer) | ✅ behavioral | `test_vela.py:534-548` | runs the exact extracted char-class |
| `fmtTimeMin` | 1228 | ✅ behavioral | `test_ux_logic.cjs:43` | |
| `visibleSlides` | 1232 | ✅ behavioral | `test_ux_logic.cjs:53` | |
| `sumVisibleDurations` | 1234 | ✅ behavioral | `test_ux_logic.cjs:55` | |
| `sanitizeString` | 398 | 🟡 source-regex | `test_vela.py:194-212` | HTML-strip / NULL-strip / fixpoint-loop asserted by *presence*, behavior never run in Python |
| `sanitizeUrl` | 412 | 🟡 source-regex | `test_vela.py:214-222` | allowlist presence only; no behavioral scheme-rejection test in Python slice |
| `sanitizeStyle` | 683 | 🟡 source-regex | `test_vela.py:594` etc. | |
| `scrubColorFields` | 712 | 🟡 source-regex | `test_vela.py:627-663` | |
| `scrubLayoutFields` | 730 | ❌ none | — | not referenced by any test |
| `sanitizeBlock` | 755 | 🟡 source-regex | `test_vela.py:806,585` | |
| `sanitizeSlide` | 953 | 🟡 source-regex | `test_vela.py:632,676` | the reducer chokepoint; never executed on a real slide |
| `sanitizeItem` | 983 | 🟡 source-regex | `test_vela.py:632` | |
| `sanitizeComment` | 894 | ❌ none | — | no reference |
| `sanitizeStudyNotes` | 912 | 🟡 source-regex + Python round-trip of *data* | `test_vela.py:225-236`, `:2920` | diagram/glossary routing asserted by presence; the Python round-trip tests the codec, not the JS sanitizer |
| `validateAndSanitizeDeck` | 1004 | 🟡 source-regex | `test_vela.py:554,560,569` | lane-clamp (`slice(0,50)`) presence only |
| `applyStartupPatch` | 304 | ❌ none | — | STARTUP_PATCH → dispatch flow untested |
| `levenshtein` | 259 | ❌ none | — | |
| `extractSlideText` | 277 | ❌ none | — | recursive block walk untested |
| `compressImage`/`compressSlideImage` | 1051/1068 | ❌ none | — | canvas-dependent |
| `pasteImageLayout` | 1086 | ❌ none | — | |
| `buildTitleCardSlide` | 1131 | 🟡 source-regex | `test_vela.py` PDF title-card block (`:2929`) | presence/marker checks only, not executed |
| `collectComments` | 1181 | ❌ none | — | |
| `formatCommentsForAgent` | 1199 | ❌ none | — | |
| `findItem`/`allItemIds` | 1223/1221 | ❌ none | — | |
| `fmtSize`/`fmtTime`/`sumDurations` | 1224/1225/1233 | ❌ none | — | `fmtTimeMin` covered, siblings not |
| `extractSave`/`extractMaster` | 1166/1169 | ❌ none | — | storage-shape strippers untested |

---

## 3. Detailed gaps (ranked by risk)

1. **Entire reducer is behaviorally untested** — `src/parts/part-reducer.jsx:8-298`. 62 action types + UNDO/REDO, zero execution. A test should build `historyInit`, dispatch each action, and assert the resulting state. Risk: any regression in state transitions ships undetected (CI is green). Highest-value single gap in this slice.

2. **UNDO/REDO stack + clamp logic** — `part-reducer.jsx:242-293`. Untested: past/future push/pop, `MAX_HISTORY=50` cap, `selectedId`/`slideIndex` re-clamp when the restored snapshot references deleted modules/slides (`:248-257`, `:275-283`), streaming-message finalize, and undo/redo marker injection. A test should undo past a deleted-slide boundary and assert no out-of-range index.

3. **`UPDATE_SLIDE` merge/replace + timeLock + re-sanitize** — `part-reducer.jsx:114`. The merge-vs-replace branch and `timeLock` duration preservation are subtle and security-relevant (re-runs `sanitizeSlide` on a merged patch — the STARTUP_PATCH zero-click sink noted in the code comment). Assert: replace mode preserves title+duration, timeLock keeps duration, and a malicious `style`/`bgImage` patch is scrubbed.

4. **`SPLIT_ITEM_AT` and `MOVE_SLIDE_TO_MODULE` index math** — `part-reducer.jsx:42-60`, `:120`. Both do non-trivial slice/splice + order renumber + selectedId/slideIndex derivation. Off-by-one here silently corrupts decks. Assert tail-split at idx 0 / mid / >=len, and cross-module move with/without `toIndex`.

5. **`slide append` / `deck init` (incremental build path)** — `vela.py:2513`, `:2570`. This is the LLM's primary programmatic deck-construction path (`init` then repeated `append`). Fully untested: G-vs-S format branching, section-index bounds (EXIT_NOT_FOUND), `@file` vs inline JSON, `--palette`/`--themes` JSON parse errors. Assert a full init→append→validate cycle.

6. **`deck ship` pipeline** — `vela.py:1182`. The actual author→ship command (validate→assemble, `--demo`/`--sample`, EXIT_VALIDATION on bad deck). Integration only tests `assemble.py` directly, bypassing the ship wrapper. Assert ship of a good deck (0) and a broken deck (4).

7. **`slide insert` / `slide remove-block`** — `vela.py:1701`, `:1719`. Structural mutations with not-found branches (bad after-num, bad block index) entirely untested. Assert insertion position and block-not-found EXIT_NOT_FOUND (3).

8. **Path-traversal guard `_safe_resolve`** — `vela.py:49`. Rejects `../` with EXIT_USAGE. Security control with no test. Assert a `@../../etc/passwd` slide-file arg is blocked.

9. **Exit-code *values* never asserted** — `vela.py:34-39`. Tests check `returncode != 0` but never that it equals 2/3/4/5. EXIT_CONFLICT (5) is never triggered at all. A regression that returns the wrong code (e.g., 1 instead of 4, which callers branch on) passes today.

10. **No full→compact→full identity round-trip over all 27 block types** — `vela.py:262/386/880`. Only 6 new blocks + studyNotes are round-tripped; the ~20 original block types' positional turbo schema (`_turbo_encode_block:552`) and palette(`C`)/theme(`T`) short-key resolution (`_expand_slide:229`, `:241`) are unverified. A single representative deck with every block type + palette + themes, run full→compact→expand and full→turbo→expand and asserted equal, would close a wide gap cheaply.

11. **`sanitizeSlide`/`validateAndSanitizeDeck`/`sanitizeString`/`sanitizeUrl` behavior unexecuted in the Python slice** — `part-imports.jsx:953/1004/398/412`. These are asserted only by grepping source. The SVG/data-URI behavioral suites are jsdom-gated and **skip locally**. A node harness that extracts and runs `sanitizeString`/`sanitizeUrl` against payloads (like `test_css_exfil.cjs` does for the CSS predicate) would give real coverage without jsdom.

12. **`applyStartupPatch` / `extractSlideText` / `levenshtein`** — `part-imports.jsx:304/277/259`. Pure-ish helpers with no coverage; `extractSlideText`'s recursive block walk and `levenshtein` (used for fuzzy matching) are easily unit-testable and currently unverified.

---

## 4. Quick wins vs deep gaps

### Quick wins (cheap, no new harness — extend existing patterns)
- **CLI subprocess tests** for the 9 untested subcommands (`deck extract/ship/zip/init`, `slide insert/remove-block/append`) — drop straight into `test_cli_commands()` using the existing `run_vela()` helper and tmp-deck fixture (`test_vela.py:1656`).
- **Assert exact exit codes** (not just `!= 0`) on existing error tests, and add the `_safe_resolve` path-traversal case — trivial additions to `test_cli_commands()`.
- **Node reducer-behavior suite** modeled on `test_ux_logic.cjs`: the file already `eval`s extracted arrows. Extend it to import the whole reducer via a tiny shim and dispatch actions — covers the highest-risk gap (#1-#4) with the existing node runner already wired into `test_security()`.
- **Comprehensive codec round-trip** (#10): one Python test importing `expand_deck`/`compact_deck`/`turbo_deck`/`unturbo_deck` (already imported at `test_vela.py:2727`) over an all-block-types deck + palette + themes.
- **Pure-helper unit tests** for `extractSlideText`, `levenshtein`, `fmtTime`, `fmtSize`, `sumDurations`, `collectComments`, `findItem` — extractable arrows/functions, node-evaluable like the existing ux-logic helpers.
- **Behavioral `sanitizeString`/`sanitizeUrl`** node suite (#11) — no jsdom needed (pure string logic), mirrors `test_css_exfil.cjs`.

### Deep gaps (need new harness / non-trivial setup)
- **Full reducer state-machine coverage** including `LOAD`/`UNDO`/`REDO` history clamping and the dirty/deleted/loaded module-tracking side-effects (`_dirtyMods`/`_deletedMods`/`_loadedMods` are module-scoped mutable sets — need a harness that can observe them or refactor for testability).
- **`applyStartupPatch` → dispatch integration** — requires a mock dispatch + storage, i.e. a React-less reducer+patch integration harness.
- **jsdom-gated sanitizer behavior** (`sanitizeSvgMarkup`, `sanitizeImageDataUri`) — already authored but **skip locally**; CI must `npm i jsdom` for them to run. Local dev gets false confidence today.
- **Comment-action behavior** currently only reachable via the `--all`-only jsdom e2e (`test_review_ui.cjs`); pulling it into a fast reducer-unit suite needs the reducer harness above.
- **Canvas-dependent helpers** (`compressImage`, `pasteImageLayout`, `buildTitleCardSlide` execution) need a browser/canvas mock — heavier lift, lower priority.
