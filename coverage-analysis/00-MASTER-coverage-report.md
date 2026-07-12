# Vela — Automated Test Coverage Analysis (Master Report)

**Goal:** Map exactly what the Vela app (`src/parts/*.jsx`, 15k LOC) is and is **not** testing, across **the same test stacks CI runs**. Produced by four parallel sub-agents, each of which *ran the real CI command* for its slice and cross-referenced tests → app source. Per-slice detail lives in the sibling reports:

| Report | Slice | CI stacks executed |
|--------|-------|--------------------|
| `01-reducer-cli-deck.md` | Reducer, CLI (`vela.py`), deck format | `test_vela.py --unit` / `--integration` |
| `02-blocks-security-render.md` | 27 block renderers, sanitizers, render battery | `test_css_exfil` / `test_svg_mxss` / `test_data_image_uri` / `test_image_preserve` / `test_standalone_html` |
| `03-engine-server-desktop-go.md` | Vera AI engine, `serve.py`, gatekeeper | `test_serve.py` / `test_desktop.py` / `go test ./...` |
| `04-ui-e2e-export.md` | UI/UX, E2E browser, export (PDF/PPTX/MD/HTML) | `test_review_ui.cjs` / PPTX e2e / UX lifeboat `.cjs` |

---

## 1. The CI test stacks (ground truth from `.github/workflows/ci.yml`)

CI runs **8 gating steps**. All are green today. Measured totals this run:

| # | CI step | Command | Result | What it actually exercises |
|---|---------|---------|--------|----------------------------|
| 1 | Unit | `test_vela.py --unit` | 253 pass, 2 skip | Mostly **source-regex string checks** + Python codec + node sub-suites |
| 2 | Integration | `test_vela.py --integration` | 101 pass | CLI subprocess, codec round-trips, node security suites |
| 3 | Server | `test_serve.py` | 121 pass | `serve.py` routes, AI channel, token gate — **behavioral, strong** |
| 4 | Desktop | `test_desktop.py` | 28 pass | Neutralino gatekeeper invariants — **strong** |
| 5 | Go gatekeeper | `go test ./...` | 20 funcs pass | Go gatekeeper lockdown + Go↔Py parity — **strong** |
| 6 | Template sync | `concat.py` diff | pass | Build determinism |
| 7 | E2E UI | `test_review_ui.cjs` | 32 pass | **Only real-browser editor E2E** — Review/Comments **only** |
| 8 | PPTX e2e | `run_pptx_e2e_tests()` | 27 pass | Byte-level `.pptx` export in Chromium — **strong** |

**Combined ≈ 356 CI checks, all passing.** The headline is *not* red tests — it's **what those 356 checks never touch.**

---

## 2. Executive summary — the four structural blind spots

The test suite is **excellent on the Python/Go perimeter (server, gatekeeper, deck codec, security sanitizers) and thin-to-absent on the actual React application.** Four whole layers of `src/parts/*.jsx` have effectively **zero PR-gating behavioral coverage**:

| Blind spot | Surface | CI coverage today | Report |
|-----------|---------|-------------------|--------|
| **A. Reducer** | 62 actions + UNDO/REDO (`part-reducer.jsx`) | **0 behavioral** — never instantiated/dispatched; 3 actions grepped as strings | 01 |
| **B. Block renderers** | 27 block types (`part-blocks.jsx`) | **0 React-rendered in the CI gate** — all static string analysis | 02 |
| **C. Vera AI engine** | 22 tool handlers + ReAct loop + transport + cost caps (`part-engine.jsx`) | **0** — browser-only JSX, no CI harness runs it | 03 |
| **D. Editor UI/UX** | ~147 UI behaviors (nav, toolbar, DnD, presenter, gallery, export) | **0** — the 185-test in-app battery is **dev-only, not wired into CI** | 04 |

**Root cause (single, systemic):** `test_vela.py` is a **Python** harness that *cannot execute JSX*. Its thousands of "security"/behavior assertions are largely `if 'pattern' in all_jsx` **source-string matches** — they prove code *exists*, not that it *behaves*. Real behavioral JS coverage exists only in a handful of Node `.cjs` subprocess suites (sanitizers, image-preserve, export robustness) and one browser E2E suite (`test_review_ui.cjs`). Everything the React app *does* at runtime — reduce state, render blocks, run the AI loop, handle keys/drag/modals — is either grepped as a string or verified only by a **185-test battery that CI never runs**.

---

## 3. What is genuinely well-tested (leave alone)

- **`serve.py`** — 121 behavioral tests: routing, save/poll, DNS-rebinding/host check, origin/CSRF, path-traversal, symlink containment, Content-Length hardening, headers, AI channel + token gate.
- **Gatekeeper** — 28 desktop invariant tests + 20 Go tests + the **Go↔Python parity lock** (`TestBackendParity`) that prevents sandbox drift.
- **Security sanitizers** — CSS-exfil (68), SVG mutation-XSS (46), data: URI (18), image-preserve (11), standalone-HTML (17). Defense-in-depth, import-time + render-sink. **Injection surface is comprehensively covered.**
- **PPTX export** — 27 byte-level assertions in a real browser.
- **Review/Comments** — 32-test real-browser E2E.
- **Deck codec** — full/compact/turbo executed for real (though over narrow inputs).

---

## 4. What is NOT tested — consolidated gap register

### A. Reducer (`part-reducer.jsx`) — 0/62 actions behavioral
Never dispatched. Highest-risk untested logic: `UNDO`/`REDO` stack + `selectedId`/`slideIndex` clamp (`:242-293`); `UPDATE_SLIDE` merge/replace/timeLock/re-sanitize (`:114`); `SPLIT_ITEM_AT` & `MOVE_SLIDE_TO_MODULE` index math (`:42-60`, `:120`); `LOAD` slideIndex clamp; all comment actions (only run under `--all` e2e). `test_ux_logic.cjs` itself documents *"the reducer isn't safely extractable in isolation."*

### B. Blocks (`part-blocks.jsx`) — 0/27 rendered in CI gate
No `RenderBlock` invocation in `test_vela.py`. All 27 get "does it throw?" smoke coverage **only** via the offline harness/battery (dev-only). **Zero per-type/branch assertions.** Richest untested branch surface: **`flow`** gates & loops H/V (`:878-952`), `timeline`/`progress`/`matrix`/`table` dual-layout branches, `checklist` 4 statuses (`:1378`). Delegated sub-components (`CodeBlock`, `CalloutBlock`, `GridCellBlock`…) never asserted. `default→null` fail-closed untested.

### C. Vera AI engine (`part-engine.jsx`) — 0/22 tools in CI
`executeTool` switch (`:183-437`) and `callVera` ReAct loop (`:1093`) never execute in CI. **Security-relevant, untested:** the H5 cost-amplification caps `MAX_TOOLS_PER_TURN` (`:1101`), `MAX_TOTAL_TOOLS` (`:1109`), `MAX_MESSAGES_BYTES` (`:1146`) — no regression test. Also untested: `callClaudeAPI` 3 transport branches + `__velaTrustGate` **deny** path (`:29`), `parseJSONResponse` on untrusted model output (`:91`), `setupLateReplyRecovery` (runs tools *without* the caps, `:988`), history normalization (`:1053`), server `/events` SSE emit.

### D. Editor UI/UX & export (`part-slides/list/chat/app/pdf.jsx`)
The **185-test / 33-suite** in-app battery (`part-uitest.jsx`) is **not invoked by any workflow** — ~147 UI/UX assertions (the 38 sanitizer ones are separately covered in CI) don't gate PRs. Un-gated flows: arrow-key nav; per-slide toolbar; quick-edit `E`/new-slide `N`; add/remove/duplicate slide; add/remove block; **drag-reorder slides & lanes** (real handlers `part-list.jsx:209-419` never run E2E); move-slide-between-modules; fullscreen/presenter/gallery (`part-slides.jsx`); keyboard `?`/`d`/`[`/redo.

**Export:** **PDF barely tested** (`part-pdf.jsx` `buildVectorPdf:2213` — only gradient fuzzing, no byte-level test); **Markdown export completely untested** (`deckToMarkdown:3485`, pure function); standalone-HTML only string-asserted, never booted in a browser.

### Cross-cutting fragilities
- **jsdom is not committed** → the *only executed* `sanitizeSvgMarkup`/`sanitizeImageDataUri` tests **skip silently** (not fail) when absent. A runner missing `npm i jsdom` goes green with the functional mXSS/exfil layer dark. (`test_vela.py:388-425`.)
- **Exit codes never asserted by value** — CLI tests check `returncode != 0` only; `EXIT_CONFLICT(5)` is never even triggered. `_safe_resolve` traversal guard (`vela.py:49`) untested.
- **9 CLI subcommands untested:** `deck extract/ship/zip/init`, `slide insert/remove-block/append`, `deck assemble` (via wrapper).
- **Lifeboat `.cjs` suites CI runs are static source parses**, not rendering (e.g. icon-picker test counts `onKeyDown` in source).
- **`test_e2e_serve.js` is an orphan** — in no workflow, fails locally.
- **Doc drift:** CLAUDE.md says "159 tests / 25 suites"; battery is actually **185 / 33**. Says "349 tests"; suite is **356**.

---

## 5. Prioritized roadmap (highest leverage first)

**P0 — flip existing tests into the CI gate (huge coverage for little work)**
1. **Wire the in-app UI battery into CI** (`vela-drive.js uitests`, offline render). Converts ~147 dev-only UI assertions into PR gates. *Blocker:* the driver must select a slide before toolbar/nav/notes suites — 17 of the current failures are pure harness setup; reuse the "select first module" recipe from `test_review_ui.cjs:555`. (Report 04 G1+G2.)
2. **Commit `jsdom`** (or make the SVG/data-URI suites **fail, not skip**, when absent). Closes the silent-skip false-confidence hole. (Reports 01, 02.)

**P1 — new low-cost Node harnesses (pure functions, model on existing `test_image_preserve.cjs`)**
3. **Reducer dispatch suite** — extract the reducer and exercise all 62 actions + UNDO/REDO. (Report 01.)
4. **Engine tool + caps harness** — drive all 22 tool handlers and the H5 loop caps against fixture decks, no browser/AI. Highest-value security fill. (Report 03 G1.)
5. **All-27-block `renderToStaticMarkup` loop** with minimal props — turns every block ❌ into a real render ✅ (~30 lines). (Report 02.)
6. **Markdown-export unit tests** (`deckToMarkdown`) + **codec identity round-trip over all 27 block types**. (Reports 04 G7, 01.)
7. **CLI gap tests** — the 9 untested subcommands + assert exact exit codes + the traversal case. (Report 01.)

**P2 — new browser E2E harnesses (higher effort, real value)**
8. **PDF byte-level export E2E** mirroring the PPTX harness (`%PDF`/`%%EOF`/page count/links). (Report 04 G6.)
9. **Drag-and-drop E2E** for slide/lane reorder. (Report 04 G4.)
10. **Presenter / fullscreen / gallery E2E** (largely closed by P0-#1). Standalone-HTML boot-in-browser. (Report 04 G5, G8.)
11. Transport + trust-gate-deny tests for `callClaudeAPI` (needs fetch/`window` mocks). (Report 03 G2.)
12. Wire-in-or-delete `test_e2e_serve.js`. (Report 04 G11.)

**One-line takeaway:** CI rigorously guards the *perimeter* (server, gatekeeper, sanitizers, deck codec) but the *React application itself* — reducer, blocks, AI engine, and the whole editor UI — is almost entirely un-gated. The fastest win by far is **P0-#1: run the battery that already exists in CI**; the biggest genuinely-missing coverage is the **reducer, the 22 AI tools + cost caps, and PDF/Markdown export.**
