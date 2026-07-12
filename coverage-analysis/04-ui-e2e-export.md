# Coverage-Gap Report — UI/UX Interactions, E2E Browser Tests, Export

**Scope:** UI/UX interactions, real-browser E2E tests, and export paths (PDF / PPTX / Markdown / standalone HTML).
**Repo:** `/home/user/vela-slides`
**Date:** 2026-07-12
**Method:** Ran the actual CI commands + the offline UI battery locally against pinned Chromium (`/opt/pw-browsers/chromium-1194`), then cross-referenced tests → app source.

---

## 0. TL;DR — the headline findings

1. **The 185-test in-app UI battery (`part-uitest.jsx`, 33 suites) is NOT run by CI.** Nothing in `.github/workflows/` invokes `window.__velaRunUITests()` or `vela-drive.js uitests`. It is a manual/dev-only harness. This is the single biggest E2E gap: the entire editor surface — slide navigation, the per-slide toolbar, quick-edit (`E`)/new-slide (`N`), the notes bar, presenter view, gallery, slide transitions, theme toggle, batch edit, branding, About — has **zero** automated regression coverage in CI. (CLAUDE.md still says "~159 tests in ~25 suites"; the battery has actually grown to **185 tests / 33 suites**.)

2. **Only ONE real-browser E2E suite runs in CI: `test_review_ui.cjs`** (32 tests, Review/Comments mode). Plus the **PPTX export E2E** (`test_pptx_export.cjs`, 27 assertions). Everything else CI labels as a "test" for UI is either a **static source-string / jsdom assertion** (no rendering) or a **pure-logic** unit test.

3. **`test_e2e_serve.js` is an orphan** — referenced by neither `ci.yml` nor `test_vela.py`. It is never executed by CI and failed to run locally (server-readiness timeout; it drives the dev `serve.py` which depends on blocked CDNs here).

4. The in-app battery is **not reliably runnable headless** either: running it via `vela-drive.js uitests` against the offline render produced **17 failures purely from harness setup** (no slide/module selected before the toolbar/navigation/notes tests run). So even the "escape hatch" of running it manually is fragile.

---

## 1. Stack execution results

All commands run locally with pinned Chromium. Results:

| Suite | Command | Result | In CI? | Real browser? |
|---|---|---|---|---|
| **Review/Comments E2E** | `node tests/test_review_ui.cjs` | ✅ **32 passed** (9.3s) | ✅ yes (`ci.yml` "Run e2e UI tests") | ✅ yes (Playwright+Chromium) |
| **PPTX export E2E** | `run_pptx_e2e_tests()` | ✅ **27 passed** (19.2s); python-pptx read-back skipped locally (CI installs it) | ✅ yes (`ci.yml` "Run PPTX export e2e") | ✅ yes (offline render + Chromium) |
| **PPTX export (direct)** | `node tests/test_pptx_export.cjs` | ✅ **27 passed** (17.9s) | via wrapper above | ✅ yes |
| **Standalone HTML** | `node tests/test_standalone_html.cjs` | ✅ **17 passed** | ✅ yes (via `test_vela.py` integration) | ❌ no — jsdom + Babel transpile assertions |
| **Modal scroll** | `node tests/test_modal_scroll.cjs` | ✅ **2 passed** | ✅ yes (via `test_vela.py` lifeboat list) | ❌ no — **static source-string** assertions |
| **Block toolbar clip** | `node tests/test_block_toolbar_clip.cjs` | ✅ **4 passed** | ✅ yes (lifeboat) | ❌ no — static source parse |
| **Icon picker Escape** | `node tests/test_icon_picker_escape.cjs` | ✅ **3 passed** | ✅ yes (lifeboat) | ❌ no — static source parse (counts `onKeyDown` handlers) |
| **UX logic** | `node tests/test_ux_logic.cjs` | ✅ **11 passed** | ✅ yes (integration) | ❌ no — pure logic (fmtTime, visibleSlides, reducer presence) |
| **Export robustness** | `node tests/test_export_robustness.cjs` | ✅ **8 passed** | ✅ yes (integration) | ❌ no — pure logic (`parseLinearGradient` fuzz) |
| **Local-server E2E** | `node tests/test_e2e_serve.js` | ❌ **FAILED locally** — "Server not ready after 15000ms" | ❌ **NO — orphan, not in CI** | ✅ (would be, drives `serve.py`) |
| **In-app UI battery** | `vela-drive.js uitests /tmp/vout/render.html` | ⚠️ **168 passed, 17 failed, 7 AI-skipped** (failures = harness setup, no slide selected) | ❌ **NO — not in any workflow** | ✅ (offline render + Chromium) |

**Notes on skips/failures**
- `test_e2e_serve.js`: soft-fails here because `serve.py`'s default page needs the React/lucide CDN importmap (blocked in this container). It is **not wired into CI at all**, so its failure is invisible to the pipeline — it would only ever be run by a developer by hand. What it *would* cover: the dev local-preview server serving a deck and rendering it in a real browser (a dev-tooling smoke test, not app coverage).
- In-app battery failures (17) are environmental: the offline render (`render-offline.js`) mounts the app but the `uitests` driver does not click a module/slide first, so Navigation / Toolbar / Notes / Keyboard(`E`,`N`) / Presenter / Review tests fail with "No slide on screen" / "waitFor timed out". These almost certainly pass when the battery is run interactively in-app; the point is that **there is no CI harness that sets up state and runs them**, so they never gate a PR.

---

## 2. In-app UI battery inventory (`src/parts/part-uitest.jsx`, 1810 lines)

**33 suites, 185 tests.** Registered via `uiSuite(name, tests)` → `UI_TEST_SUITES` (line 74). Headless entry `window.__velaRunUITests` (line 118). **This entire battery is invisible to CI.**

| # | Suite (`part-uitest.jsx` line) | ~Tests | What it covers |
|---|---|---|---|
| 1 | Render (128) | 5 | App header, panels, root layout mounts |
| 2 | Navigation (155) | 3 | Arrow-key slide advance/back, slide counter |
| 3 | Presenter (190) | 5 | `F` fullscreen enter, fullscreen slide content, present-mode hides edit chrome (CR-03) |
| 4 | Toolbar (240) | 8 | Per-slide toolbar visible; Edit/AI-Edit, Improve(✨), Variants(🎲), Delete(🗑) buttons |
| 5 | Theme (278) | 2 | Dark/light toggle (`d` key) |
| 6 | Keyboard (299) | 4 | `E` quick-edit panel, `N` new-slide prompt, other shortcuts |
| 7 | Chat (344) | 5 | Vera chat panel open, textarea, tool traces |
| 8 | Notes (384) | 2 | Speaker-notes bar visible/editable |
| 9 | Export (405) | 1 | Export entry point |
| 10 | Batch Edit (428) | 4 | Multi-slide batch edit flow |
| 11 | Branding (463) | 3 | Branding/logo controls |
| 12 | About (500) | 3 | About dialog, changelog render |
| 13 | Undo/Redo (522) | 2 | Undo/redo state |
| 14 | Fullscreen Features (539) | 5 | Fullscreen chrome, cinema tip |
| 15 | Slide Ops (569) | 4 | Add/delete/duplicate slide |
| 16 | Content (629) | 3 | Block content rendering |
| 17 | New Deck (648) | 3 | New-deck creation flow |
| 18 | Presenter Adv (678) | 3 | Advanced presenter (timer, jump) |
| 19 | Vera AI (751) | 5 | AI edit path (**degrades to skip when AI unavailable** — 7 skips observed) |
| 20 | Student Mode (791) | 16 | Student/learn mode UI |
| 21 | Study Notes (905) | 15 | Study-notes generation/display |
| 22 | **SVG Sanitizer (XSS) (994)** | 35 | SVG sanitizer defenses (largest suite) |
| 23 | Deck Sanitization (XSS) (1194) | 3 | Deck-level sanitization |
| 24 | Gallery View (1215) | 11 | Gallery/slide-sorter overlay, module grouping, thumbnails |
| 25 | Gallery From Editor (1284) | 5 | Entering gallery from editor |
| 26 | Presenter View (1329) | 7 | Single-screen speaker dashboard (CR-08), timer mm:ss |
| 27 | Slide Transitions (1375) | 5 | Slide transition animations |
| 28 | Review (1403) | 12 | Comments/review mode (**overlaps `test_review_ui.cjs`**) |
| 29 | Header & Stats 7-1 (1505) | 2 | Header stats pill (no seconds), deck stats |
| 30 | Hide slides 7-1 (1519) | 1 | Hidden-slide toggle |
| 31 | Add menu 7-1 (1533) | 1 | Add-slide menu (Blank/Section/AI) |
| 32 | Section drag reorder 7-1 (1548) | 1 | Section drag-reorder |
| 33 | Presenter Ctrl+E 7-1 (1575) | 1 | Presenter Ctrl+E |

**Security note:** the sanitizer suites (22 + 23, 38 tests) *do* have parallel CI coverage — `test_svg_mxss.cjs` and `test_css_exfil.cjs` load the real sanitizer under jsdom and run in CI via `test_vela.py`. So the security portion is not a genuine gap. The **UI/UX portion (~147 tests, suites 1–21 and 24–33) has no CI equivalent.**

---

## 3. E2E coverage matrix — key user flows

Legend: **Browser-E2E in CI** = a real Chromium test that gates PRs · **In-app battery** = covered by `part-uitest.jsx` (manual only, NOT in CI) · **Static/logic** = source-string or reducer/logic assertion only.

| User flow | Real-browser E2E in CI? | In-app battery? | CI-run? | Gap severity |
|---|---|---|---|---|
| Open/load deck & mount | ✅ (indirect, in `test_review_ui.cjs` bootstrap) | ✅ Render | Partial | Low |
| Select module → slide renders | ✅ (setup step in review E2E) | ✅ Navigation | Partial | Low |
| **Arrow-key slide navigation** | ❌ | ✅ Navigation | ❌ | **High** |
| **Per-slide toolbar (Edit/Improve/Variants/Delete)** | ❌ | ✅ Toolbar | ❌ | **High** |
| **Quick-edit panel (`E`) / new-slide (`N`)** | ❌ | ✅ Keyboard | ❌ | **High** |
| Add / remove / duplicate slide | ❌ | ✅ Slide Ops | ❌ | **High** |
| Add / remove block | ❌ | ✅ Content (partial) | ❌ | **High** |
| **Drag-reorder slides** | ❌ | ✅ (Section drag 7-1, 1 test) | ❌ | **High** |
| **Drag-reorder lanes/modules** | ❌ | ✅ (Section drag 7-1, 1 test) | ❌ | **High** |
| Move slide between modules | ❌ | ❌ (reducer only, `test_ux_logic`) | ❌ | **High** |
| **Fullscreen / presenter mode (`F`)** | Partial (review E2E toggles `f` to check badge-hide only) | ✅ Presenter, Presenter View, Presenter Adv | ❌ | **High** |
| Presenter TOC / jump / timer | ❌ | ✅ Presenter View | ❌ | Medium |
| Gallery / slide-sorter view | ❌ | ✅ Gallery View, Gallery From Editor | ❌ | Medium |
| Thumbnails render | ❌ | ✅ Gallery View | ❌ | Medium |
| Slide transitions | ❌ | ✅ Slide Transitions | ❌ | Low |
| Speaker-notes bar | ❌ | ✅ Notes | ❌ | Medium |
| **Chat / Vera AI trace** | ❌ | ✅ Chat, Vera AI (skips if no AI) | ❌ | Medium (AI hard to E2E) |
| **Review comments (module + block + resolve/reopen/batch/filters)** | ✅ **`test_review_ui.cjs` (32)** | ✅ Review (12, redundant) | ✅ | **None** ✅ |
| Modals (About, shortcuts `?`, new-deck, export) | ❌ | ✅ About, New Deck | ❌ | Medium |
| Modal scroll/overflow | ❌ (static only) | ❌ | ✅ (static) | Medium |
| Icon-picker Escape | ❌ (static only) | ❌ | ✅ (static) | Medium |
| Keyboard: undo/redo, `?`, `r`, `d`, `[`, `f`, F5 | Partial (`r`,`f`,`Ctrl+z` in review E2E) | ✅ Keyboard/Theme | Partial | Medium |
| Theme toggle (`d`) | ❌ | ✅ Theme | ❌ | Low |
| **PDF export (raster + vector)** | ❌ | ✅ Export (1 test, shallow) | ❌ | **High** |
| **PPTX export** | ✅ **`test_pptx_export.cjs` (27)** | ❌ | ✅ | **None** ✅ |
| Markdown export | ❌ | ❌ (no test found) | ❌ | **High** |
| Standalone HTML export | ❌ (jsdom/transpile assertions, 17) | ❌ | ✅ (static-ish) | Medium |

---

## 4. Detailed gaps (ranked; emphasis on genuine E2E gaps)

### G1 — CI does not run the in-app UI battery at all *(critical, systemic)*
- **Where:** `part-uitest.jsx:118` (`window.__velaRunUITests`); driver `tools/vela-dev/scripts/vela-drive.js:222` (`uitests` mode). No reference in `.github/workflows/ci.yml` or any workflow.
- **Impact:** 185 tests / 33 suites — the entire editor UX — never gate a PR. A regression in the slide toolbar, navigation, quick-edit, gallery, presenter, notes, or transitions ships green.
- **What to do:** Add a CI step that runs the battery headless via `vela-drive.js uitests` against the offline render, **after** the driver selects a module/slide (see G2). Assert `failed === 0` (allowing AI-skips). This is the highest-leverage single change — it converts 147 already-written UI assertions from dev-only to CI-gating.

### G2 — In-app battery is not headless-safe (state setup missing) *(critical enabler for G1)*
- **Where:** `vela-drive.js:222` `uitests` mode calls `__velaRunUITests` without selecting a slide; suites Navigation (`part-uitest.jsx:155`), Toolbar (`:240`), Keyboard (`:299`), Notes (`:384`), Presenter (`:190`), Review (`:1403`) fail with "No slide on screen"/timeouts.
- **Observed:** 17/185 failed purely from this, run locally today.
- **What to do:** Have the driver (or a battery `beforeAll`) click `.concept-row`/first module and wait for `[data-block-type]` before running — exactly what `test_review_ui.cjs:555-560` already does. Without this, G1 cannot be landed cleanly.

### G3 — No real-browser E2E for the per-slide editing toolbar *(high)*
- **Surface:** `part-slides.jsx` toolbar; battery suite Toolbar (`part-uitest.jsx:240`, 8 tests) is the only coverage and it's not in CI.
- **Assert (new E2E):** hover/select a slide → Edit(AI Edit), Improve(✨), Variants(🎲), Delete(🗑) buttons visible and clickable; Delete removes the slide and updates the counter; block-level hover toolbar keeps its escape offset (currently only `test_block_toolbar_clip.cjs` *static* check at the source level).

### G4 — No real-browser E2E for add/remove/duplicate/reorder of slides & modules *(high)*
- **Surface:** drag handlers in `part-list.jsx:209-419` (`REORDER_SLIDE`, `MOVE_SLIDE_TO_MODULE`, `DRAG_REORDER`, section drag at `:353-367`); slide ops.
- **Current coverage:** reducer *presence* only (`test_ux_logic.cjs`: "reducer keeps DRAG_REORDER", "INSERT_ITEM with afterId"), plus 1 battery test each (Slide Ops `:569`, Section drag 7-1 `:1548`) — none in CI. Actual drag-and-drop DOM behavior is **never exercised end-to-end.**
- **Assert (new E2E):** perform a real HTML5 drag (dragstart→dragover→drop) on a slide thumbnail and on a section; verify order changes in the DOM and persists; verify cross-module move.

### G5 — No real-browser E2E for fullscreen / presenter / gallery *(high)*
- **Surface:** `part-slides.jsx` `FullscreenSlide` (`:201`), `PresenterTOC` (`:379`), `PresenterView` (`:662`), Gallery (`:626`), thumbnails (`:595`).
- **Current coverage:** battery suites Presenter/Presenter View/Presenter Adv/Gallery (not in CI); the review E2E only presses `f` to confirm the comment badge hides — it does **not** assert slide content, presenter timer, TOC jump, or gallery grid.
- **Assert (new E2E):** `F` enters a `position:fixed inset:0` fullscreen with slide content; presenter timer shows `mm:ss` and advances (`part-uitest.jsx:1344`); gallery shows module grouping and thumbnail count; clicking a gallery card jumps to that slide.

### G6 — PDF export has almost no coverage *(high)*
- **Surface:** `part-pdf.jsx` — `PdfExportModal` (`:576`), `VectorPdfExportModal` (`:2961`), `buildVectorPdf` (`:2213`), `domToCanvas` (`:150`), `buildPdfFromImages` (`:228`), `svgPathToPdf` (`:1906`).
- **Current coverage:** only `test_export_robustness.cjs` (8 tests) fuzzing `parseLinearGradient`, and 1 shallow battery "Export" test. **No test opens the PDF modal, generates a PDF, and validates bytes** — unlike PPTX, which has a full 27-assertion byte-level E2E.
- **Assert (new E2E, mirror the PPTX harness):** open PDF export → produce bytes → assert `%PDF` header, `%%EOF` trailer, page count == visible slides, both raster and vector modes produce valid output, links embedded (`drawPdfLinkIcon` `:439`), `_isExportHidden` respected.

### G7 — Markdown export is completely untested *(high)*
- **Surface:** `part-pdf.jsx` `deckToMarkdown` (`:3485`), `exportMarkdown` (`:3667`).
- **Current coverage:** **none found** in any suite (grep of tests shows no `deckToMarkdown`/`exportMarkdown` reference).
- **Assert (new unit/E2E):** `deckToMarkdown` over the demo deck emits headings/bullets/tables/code fences correctly; excludes hidden slides; round-trips block types; `exportMarkdown` triggers a download with correct filename.

### G8 — Standalone HTML export lacks a *rendered* E2E *(medium)*
- **Surface:** `part-pdf.jsx` `buildStandaloneHtml` (`:3786`), `stripEsmImportsForStandalone` (`:3723`), `getStandaloneJsxSource` (`:3842`), `velaStandaloneExportGateReason` (`:3856`), `StandaloneHtmlModal` (`:3864`).
- **Current coverage:** `test_standalone_html.cjs` (17) transpiles the output with Babel and asserts on the string, but **does not load the produced HTML in a browser** to confirm it actually boots and renders the deck offline.
- **Assert (new E2E):** write the standalone output to a file, `page.goto` it, confirm the deck renders (header + a `[data-block-type]`) with no CDN/network dependency and no console errors.

### G9 — Keyboard shortcuts partly uncovered in CI *(medium)*
- **Surface:** `part-app.jsx` handlers — undo/redo `Ctrl+Z`/`Ctrl+Y` (`:1580-1581`), `?` shortcuts overlay (`:1582`), `r` review (`:1583`), `d` dark (`:1295`), `[` TOC collapse (`:1288`), `f`/F5 fullscreen (`:1330-1331`).
- **Current coverage:** `test_review_ui.cjs` exercises `r`, `f`, `Ctrl+Z` in a real browser (good). `?`, `d`, `[`, `y`(redo), F5 only via the non-CI battery.
- **Assert:** extend the CI review E2E (or the new battery CI step) to press `?` (shortcuts modal appears), `d` (theme flips), `[` (TOC collapses).

### G10 — Chat / Vera AI trace has no deterministic CI coverage *(medium)*
- **Surface:** `part-chat.jsx` ChatPanel + tool traces; battery suites Chat (`:344`) and Vera AI (`:751`, auto-skips when AI unavailable).
- **Current coverage:** none in CI; `vela-drive.js ai` mode exists but is opt-in and spawns the user's `claude` CLI.
- **Assert:** at minimum, an E2E that opens the Vera panel, confirms the textarea + send button render, and that a mocked tool-trace entry renders (mutual-exclusion with Comments panel is already covered by `test_review_ui.cjs`).

### G11 — `test_e2e_serve.js` is dead in CI *(medium — process gap)*
- **Where:** `tests/test_e2e_serve.js`; no reference in `ci.yml` or `test_vela.py`.
- **Impact:** the only test that exercises the dev local-preview server (`serve.py`) in a browser never runs; it also failed locally today (readiness timeout). Either wire it in (guarded/soft-skip like the PPTX step) or delete it so it doesn't masquerade as coverage.

---

## 5. Quick wins vs deep gaps

**Quick wins (existing assertions, small wiring):**
- **G1 + G2** — add a single CI step running the 185-test battery headless after fixing the driver to select a slide. Converts ~147 UI assertions to CI-gating; the driver already exists (`vela-drive.js uitests`) and the "select first module" recipe already exists in `test_review_ui.cjs:555`.
- **G7** — `deckToMarkdown` is a pure function; a handful of unit assertions over the demo deck close a total blind spot cheaply.
- **G9** — extend the already-running review E2E with `?`/`d`/`[` key presses (a few lines).
- **G11** — decide: wire `test_e2e_serve.js` into CI (soft-skip) or delete it.

**Deep gaps (need new real-browser harnesses):**
- **G6 PDF export byte-level E2E** — mirror the excellent `test_pptx_export.cjs` pattern (offline render → generate → validate bytes) for both raster and vector PDF. Highest-value new E2E.
- **G4 drag-and-drop E2E** — real HTML5 DnD is finicky; needs a dedicated Playwright harness driving `dragstart`/`dragover`/`drop` and asserting DOM reorder + persistence.
- **G3/G5 toolbar + fullscreen/presenter/gallery E2E** — either promote the battery to CI (G1, cheapest) or author focused Playwright suites; promoting the battery covers most of this at once.
- **G8 standalone HTML boot E2E** — load the produced file in Chromium and confirm it renders offline.

**Bottom line:** the codebase already contains extensive UI assertions (185-test battery) and two exemplary real-browser E2E suites (Review 32, PPTX 27). The dominant gap is not missing *tests* but missing *CI execution*: the battery is dev-only, and the export/editor/navigation surfaces outside Review+PPTX have no PR-gating browser coverage. Landing G1+G2 first would move the needle furthest.

---

### Appendix — files referenced
- CI: `/home/user/vela-slides/.github/workflows/ci.yml` (E2E step `:277-299`, PPTX step `:301-307`)
- E2E suites: `/home/user/vela-slides/tests/test_review_ui.cjs`, `/home/user/vela-slides/tests/test_pptx_export.cjs`, `/home/user/vela-slides/tests/test_e2e_serve.js` (orphan)
- Static/logic suites: `test_standalone_html.cjs`, `test_ux_logic.cjs`, `test_export_robustness.cjs`, `test_modal_scroll.cjs`, `test_block_toolbar_clip.cjs`, `test_icon_picker_escape.cjs`
- In-app battery: `/home/user/vela-slides/src/parts/part-uitest.jsx` (33 suites / 185 tests)
- App surface: `part-slides.jsx` (2407 L), `part-list.jsx` (528 L), `part-chat.jsx` (437 L), `part-app.jsx` (1906 L), `part-pdf.jsx` (3952 L)
- Driver: `/home/user/vela-slides/tools/vela-dev/scripts/vela-drive.js` (`uitests` mode `:222`)
