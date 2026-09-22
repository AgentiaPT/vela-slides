# Sprint "meridian" — 19 change requests from a live-use review

**Date:** 2026-09-22 · **Branch:** `claude/nice-allen-4zrvzg` · **Sprint HEAD at start:** `a9408a8`
· **HEAD at close:** `aed1bb1` · **Mode:** silent (`--silent`) · **VELA_VERSION:** 13.74 → 13.75

Nineteen change requests came from one user's notes after live use of Vela in the browser
and in the desktop (Neutralino) app: id/timestamp stability, a background-gradient
validation gap, image alignment, gallery and presenter UX, vector-PDF glyph size, review
workflow, branding controls, TOC actions, link-badge placement, and five Neutralino desktop
issues. This report is the sprint's only user-visible output, per silent mode.

**18 / 19 CRs done · blind gate clean after 6 rounds · 1 parked.**

---

## 1. Scope

| CR | Request | Status | Key file |
|---|---|---|---|
| CR01 | Opening a deck must not change lane/module ids or timestamps | Done | `src/parts/part-imports.jsx` (`keepIds`, `adoptPriorDeckIds`) |
| CR02 | `validate.py` must flag a gradient value put in the solid-color `bg` field | Done | `skills/vela-slides/scripts/validate.py` |
| CR03 | Side image sometimes top-aligned with zero margin | Done — confirmed already fixed at HEAD; locked with a regression suite | `src/parts/part-canvas.jsx` |
| CR04 | Gallery view: add a hide-slide option beside delete | Done | `src/parts/part-list.jsx`, `part-slides.jsx` |
| CR05 | Vector PDF: € and similar chars render wrong size/stretched | Done | `src/parts/part-pdf-extract.jsx` |
| CR06 | Copy/paste of blocks — needs UX research | **Parked** — research note only, no code (§3) | — |
| CR07 | Review mode: cycle only unreviewed slides, toggle a checkmark | Done | `src/parts/part-reducer.jsx`, `part-canvas.jsx` |
| CR08 | Brand accent line must be removable (0px still showed a line) | Done | `src/parts/part-branding.jsx` |
| CR09 | Move branding config to a right-side pane | Done | `src/parts/part-app.jsx` |
| CR10 | Gallery view: top-right icons not visible | Done | `src/parts/part-imports.jsx` (icon-chip CSS) |
| CR11 | Presenter mode: top-right edit icon does not show reliably | Done — same root cause and fix as CR10 | `src/parts/part-imports.jsx` |
| CR12 | Desktop HTML export fails: `useState` already declared | Done | `vela-neutralino/scripts/sync-vela.py` |
| CR13 | Show an editor/presenter/gallery switch near Present, not hidden | Done | `src/parts/part-app.jsx` |
| CR14 | TOC: add a delete-slide icon on slide rows | Done | `src/parts/part-list.jsx` |
| CR15 | Full-bleed image: block toolbar cut off at top, hard to click | Done | `src/parts/part-canvas.jsx` |
| CR16 | Desktop window title should show the deck title, not repeat "Vela Slides" | Done | `vela-neutralino/resources/js/window-glue.js` |
| CR17 | Text-block link badges misplaced (overlap or far right) | Done | `src/parts/part-canvas.jsx` (shared `LinkBadge`) |
| CR18 | Desktop: keyboard unresponsive after alt-tab until a click | Done | `vela-neutralino/resources/js/window-glue.js` |
| CR19 | Desktop: AI shows "offline" after a fresh build until restart | Done | `src/parts/part-app.jsx` (`probeUntilReady`) |

---

## 2. Assumptions & unilateral decisions

Silent mode resolves every ambiguity itself and records the reading here.

- **CR06** — the spec says copy/paste "needs UX research" and does not ask for code. Read
  literally: shipped a research note (§3), no code change.
- **CR07** — a `reviewMode` name already exists for the unrelated comments-review feature, so
  the new field and toggle use `reviewed` / "Review cycle" to avoid a name collision.
  *If wrong:* a rename is a small find/replace across three files.
- **CR13** — the spec calls the "Overview" button the wrong place for a view switch but does
  not ask to remove it. Kept the Overview button and its shortcut; added a new
  editor/presenter/gallery switch next to Present. *If wrong:* removing Overview is a one-line
  deletion once its keyboard shortcut is reassigned.
- **Import / merge-patch "use new version"** mint fresh ids on purpose (collision defense
  against two different decks colliding on id) — this is not "opening a deck" so it is
  outside CR01's acceptance text. Recorded, not changed. *If wrong:* narrowing `keepIds` to
  cover this path is a small, well-scoped follow-up.
- **CR12/CR16/CR18/CR19 (desktop)** — this container cannot launch the Neutralino GUI. Proof
  is headless/unit tests plus code review, not a live desktop run (see §8 Known limitations).
- **Round-3 verifier coverage** — the canvas/branding surface was not re-driven by a
  dedicated verifier in blind round 3 because it was unchanged since round 2 (which came back
  clean); the round's broad hunter still covered it. Recorded so the coverage choice is
  explicit, not accidental.
- **The desktop deck-save race found in round 6** (§6) reproduces identically on the base
  commit `a9408a8`, so it is classified pre-existing / out of scope rather than a regression
  from this sprint's work, and was not fixed here (see §6 top recommendation).

## 3. Parked / blocked

- **CR06 — copy/paste of blocks.** Parked at the spec's own request ("needs UX research").
  Research findings, for the next sprint that wants to implement it:
  - Today there is no block-level clipboard. The only structural duplicate is whole-slide
    (`DUPLICATE_SLIDE`); the only clipboard write is "copy code text" on the code block, with
    no paste counterpart.
  - **Recommended path, in two steps:**
    1. **Duplicate-in-place** (low effort): add a duplicate button to the existing per-block
       hover toolbar, next to the delete button. One click deep-clones the block and inserts
       it right after itself, mirroring `DUPLICATE_SLIDE`'s existing pattern. No clipboard, no
       cross-slide state — likely covers most real "copy this" requests on its own.
    2. **Cross-slide copy/paste** (medium effort, later): an in-app "block clipboard" held in
       component state (not the OS clipboard, since deck content is untrusted-by-origin) with
       a "copy block" toolbar action and a "paste block" entry in the existing add-block menu.
       Paste always appends to the end of the target slide's blocks, sidestepping the
       column-target question on `cols`-layout slides for a first version. Any pasted or
       duplicated block must go through the existing `sanitizeBlock` ingress path.
  - *To unblock:* pick step 1, step 2, or both, and it becomes an ordinary implementation CR.

---

## 4. Agentic burndown

Work remaining = open CRs + agent-found defects. Each blind round can *add* scope when it
finds a defect, so the curve rises before it falls back to zero.

![Agentic burndown](img/burndown.svg)

| Point | Event | Work remaining |
|---|---|---|
| Sprint start | 19 open CRs | 19 |
| Intake | CR06 parked | 18 |
| Clusters C1–C5 merged | all 18 CRs implemented | 0 |
| Blind round 1 (`dd3422e`) | 9 in-scope defects found | 9 |
| Fix round F1–F3 | fixed | 0 |
| Blind round 2 (`716f2d4`) | 4 in-scope defects + 1 by-design decision | 4 |
| Fix round F4–F5 | fixed | 0 |
| Blind round 3 (`0955a8a`) | 1 in-scope defect | 1 |
| Fix round F6 | fixed | 0 |
| Blind round 4 (`02408e5`) | 2 in-scope defects | 2 |
| Fix round F7 | fixed | 0 |
| Blind round 5 (`782ebd1`) | 1 in-scope defect | 1 |
| Fix round F8 | fixed | 0 |
| Blind round 6 (`aed1bb1`, final) | 0 in-scope defects — **clean** | 0 |

---

## 5. Stats

| | |
|---|---|
| Change requests | 19 (18 done, 1 parked) |
| Clusters | 5 (`C1` views-a, `C2` views-b, `C3` canvas, `C4` export, `C5` neutralino) — 1 worker restart (`C5` first attempt hit its budget; `C5b` finished the cluster) |
| Commits (sprint scope, `a9408a8`..`aed1bb1`) | 28 |
| Tests | 561 → 579 passing (headless suite + `test_vela.py`) |
| UI battery | 311 / 0 at the final gate |
| Blind gate rounds | 6 (5 rounds found defects, round 6 clean) |
| Defects found and fixed | 17 in-scope (9 + 4 + 1 + 2 + 1 across rounds 1–5) |
| Cost | see §7 |

---

## 6. Before / after per change

Screenshots are frame-checked stills from the offline render harness. Paths are relative to
this report.

**CR01 — stable ids on open.** The proof that matters here is not visual (a stable id is
invisible): `node tests/test_deck_id_stable.cjs` passes 14/14 (open keeps ids and
`createdAt`, save/reopen is byte-stable, corrupt/duplicate ids get repaired, a plain import
still mints new ids as before). The screenshot pair below shows the same deck open producing
an identical render before and after the fix, confirming no visible regression.

| Before | After |
|---|---|
| ![](img/cr01-before-open-no-write.png) | ![](img/cr01-after-open-no-write.png) |

**CR03 — side-image alignment.** Confirmed already correct at sprint HEAD; a regression
suite now locks the behavior, so before and after render identically by design.

| Before | After |
|---|---|
| ![](img/cr03-before-split.png) | ![](img/cr03-after-split.png) |

**CR04 — gallery hide toggle.** Before: only a delete (×) control on each card. After: a
hide/unhide (eye) control sits beside delete.

| Before | After |
|---|---|
| ![](img/cr04-before-gallery.png) | ![](img/cr04-after-gallery.png) |

**CR05 — vector-PDF glyph size.** Before: € and related symbols render stretched and thin.
After: the same characters render as normal-weight text at the correct size (PPTX export was
already unaffected).

| Before | After |
|---|---|
| ![](img/cr05-before-vector-pdf.png) | ![](img/cr05-after-vector-pdf.png) |

**CR07 — review cycle.** No "before" exists (the field is new). After: the reviewed
checkmark shows on the slide and the "Review cycle" toolbar toggle is active (green).

![After](img/cr07-after-review-cycle.png)

**CR08 + CR09 — accent line and branding pane.** No clean "before" render exists for the old
centered branding modal (it did not capture in the offline harness); the code-level change is
recorded in §1. After: the branding panel is a docked right-side pane with its own scroll,
and the accent-line slider at 0px shows no line on the slide.

![After](img/cr08-cr09-after-branding-pane.png)

**CR10 / CR11 — fullscreen nav icon contrast.** Same root cause: an inline `transparent`
background overrode the icon's hover chip on dark slide backgrounds, on both the gallery and
presenter toolbars. Before: the icons are nearly invisible. After: a visible chip sits behind
every icon regardless of slide background.

| Before | After |
|---|---|
| ![](img/cr10-before-nav-icons.png) | ![](img/cr10-after-nav-icons.png) |
| ![](img/cr11-before-edit-icon.png) | ![](img/cr11-after-edit-icon.png) |

**CR13 — view switch next to Present.** Before: no view switch in the top bar (only the
"Overview" button below the slide, kept as-is per §2). After: an editor/presenter/gallery
segmented control sits next to Present.

| Before | After |
|---|---|
| ![](img/cr13-before-topbar.png) | ![](img/cr13-after-topbar.png) |

**CR14 — TOC slide delete.** Before: TOC rows only have a hide/unhide (eye) control. After:
a delete (×) icon sits beside it; the action is undoable.

| Before | After |
|---|---|
| ![](img/cr14-before-toc.png) | ![](img/cr14-after-toc.png) |

**CR15 — toolbar on full-bleed images.** Before: the block toolbar and its popups are cut off
above the visible slide area and cannot be reliably clicked. After: the toolbar and its
popups flip to stay inside the slide when there is no room above.

| Before | After |
|---|---|
| ![](img/cr15-before-toolbar.png) | ![](img/cr15-after-toolbar.png) |

**CR17 — link badge placement.** Before: link badges sit far to the right of the text,
disconnected from it. After: a shared badge component places every link badge immediately
after its text, consistent across headings, bullets, and wrapped lines.

| Before | After |
|---|---|
| ![](img/cr17-before-links.png) | ![](img/cr17-after-links.png) |

**CR02, CR12, CR16, CR18, CR19** have no visual UI surface to screenshot (a CLI validator
message, an export-time script fix, a window-title string, desktop focus handling, and a
desktop AI-probe retry loop) — each is proven by its own test file, listed in the plan's
"What happened vs plan" note.

---

## 7. Cost and savings

**Corrected figure. The first number this report gave, $260.59, was wrong.** The cost
script counted each API call more than once (it summed usage per transcript line, and one
call can write several lines). See the Retrospective section for the cause and the fix.

The corrected cost, across the orchestrator and 39 sub-agent sessions used for
implementation, review, and the blind gate:

| | |
|---|---|
| Total cost (true, all sessions to sprint end) | **≈ $162** |
| — true cost at sprint end (scanned sessions only) | ≈ $152 |
| — plus security-review hook sessions and correct 1‑hour cache-write pricing | ≈ $162 |
| By model tier (true) | Opus ≈ $137 · Sonnet ≈ $16 |
| Total tokens (true, deduplicated) | ≈ 242,059,426 (about 97.5% cache-read) |
| Sessions | 40 (1 orchestrator + 39 sub-agents), plus 13 hook sessions not in the original scan |

The high cache-read share reflects the file-locality clustering strategy (each cluster's
sub-agents keep re-reading the same few part-files as they iterate) and the 6-round blind
gate re-driving the same offline render repeatedly. Routing view-only clusters (C2) to
Sonnet and reserving Opus for the higher-risk canvas/export/desktop clusters kept the
Sonnet share of cost lower for roughly a quarter of the CR count.

---

## 8. Bugs found and fixed, by blind round

- **Round 1** (`dd3422e`, 9 in-scope): an "Untitled" fallback that should have used "Vela
  Slides"; the desktop cancel-focus retry not surviving a blur; stray bidirectional/line
  separator characters not stripped from titles; the new view-switch toolbar overlapping
  editor overlays; ids equal to `Object.prototype` member names (e.g. `constructor`) surviving
  the id-keeping path, a hardening gap introduced by CR01's own fix; contrast and emoji-glyph
  fixes folded into the same round (see F1–F3 commits).
- **Round 2** (`716f2d4`, 4 in-scope + 1 by-design): a CRLF line-ending mismatch in the
  desktop shim-strip regex; a `visibilitychange` handler that stole focus back from the user;
  top-bar overflow and wrap at specific narrow widths (1200px, 1440–1650px). The "Import /
  merge-patch mints fresh ids" finding was reviewed and classified as by-design (§2), not
  fixed.
- **Round 3** (`0955a8a`, 1 in-scope): opening a deck with slides that had no `createdAt`, or
  legacy comments with no id, minted new values and wrote them back to disk — narrowly missed
  by CR01's original fix.
- **Round 4** (`02408e5`, 2 in-scope): the top-bar's density calculation used width history
  instead of currently available space, so labels stayed hidden after widening the window; a
  save-signature update race where a failed write could be treated as saved.
- **Round 5** (`782ebd1`, 1 in-scope): a revert written during an in-flight save could be
  discarded once that save later completed, re-introducing stale content.
- **Round 6** (`aed1bb1`, final): **clean** — 0 in-scope defects, 311/311 UI battery, 0
  headless test failures. One finding (§6 above) was investigated and classified pre-existing.

---

## 9. Out of scope — found, not fixed

Recorded for the next sprint's intake, not fixed here (minimal-diff policy). Deduplicated
across all six blind rounds and all five clusters.

1. **[Top recommendation] Desktop deck-save write-ordering race.** In
   `vela-neutralino/resources/js/deck-io.js`, a slow, out-of-order pair of writes can leave an
   older payload on disk instead of the newest one. Confirmed to reproduce identically on the
   pre-sprint base commit, so it predates this sprint. Medium severity (data-loss risk under
   slow disk/backend conditions); the general shape of the fix is to serialize writes by a
   monotonic sequence number rather than completion order.
2. `bg` vs `bgGradient` precedence differs between two render paths
   (`part-slides.jsx` checks `bg` first; `part-canvas.jsx` lets a gradient win) — no visible
   bug today, but worth unifying.
3. Vector PDF export drops ↑/↓ arrow glyphs from extracted text.
4. Standalone HTML export from the desktop app keeps `VELA_LOCAL_MODE=true`.
5. `validate.py` does not type-check the new `reviewed` field — `"reviewed": "yes"` passes
   validation, then the app silently drops the value.
6. The branding sanitizer has no lower bound on `accentHeight`; the renderer treats a negative
   value as 0, and a separate spot in the AI system prompt (`part-engine.jsx`) still reads
   `accentHeight || 4`, inconsistent with "0 means no line."
7. Opening a deck rewrites and normalizes the file on disk (adds defaults, drops
   non-allowlisted keys, mints ids for id-less decks) — pre-existing, independent of CR01.
8. Several small viewport-specific UI issues: arrow keys still move the editor's current
   slide while the gallery overlay is open; the gallery header's slide count includes hidden
   slides; a link on a grid-cell or heading block draws no badge; the presenter view's "S"
   shortcut can visually cover the top-right icon cluster or the new view switch; a synthetic
   `Escape` key does not exit the Fullscreen API on its own.
9. Turbo-format round-trip drops the new `reviewed` and hidden-slide fields.
10. Vector-PDF emoji and CJK glyphs use inconsistent letter-spacing (pre-existing).
11. A legacy comment's id is re-minted on every sanitize pass rather than once; duplicate
    modules can collide on a re-minted legacy comment id.
12. The deck-switch title code path can leave the old, unsanitized title displayed
    (`part-app.jsx`).
13. Deleting every slide from a module via the TOC leaves the module empty instead of
    prompting or removing it.
14. The `Home` key has no "jump to first slide" behavior in the editor.
15. The desktop local-sync `LOAD` path reads `deckTitle`/`guidelines` without sanitizing them
    first (confirmed safe at the render sink, but inconsistent with the rest of the ingress
    path).
16. Repeated AI-agent rescans on desktop can stack multiple bounded 10-second probe loops
    instead of canceling the previous one.
17. An edit made less than 1 second after an incoming external deck update can be lost (same
    1-second debounce guard exists on the pre-sprint base).
18. A failed local (non-desktop) save is not retried until the next edit, rather than being
    retried automatically.
19. Deck ids containing an underscore are re-minted in memory on every open (the id-keeping
    character allowlist is `[A-Za-z0-9-]`); this does not write to disk on its own.
20. Small cosmetic nits: the top bar can wrap or drop to a denser layout at a few specific
    widths during an active title edit; TOC rows show no reviewed indicator; the "Untitled"
    fallback check is case-sensitive; branding save can drop an explicit `logo: null` key;
    deleting a slide while review-cycle is active can land the cycle on an already-reviewed
    slide.
21. One end-to-end test (comments-review "R" key) is flaky only under full parallel test-suite
    load; it passes reliably when run alone.

---

## Retrospective

A post-sprint review checked the cost numbers, the wall time, and the agent work. This
section gives the short result. It does not include raw logs.

### Cost-accounting bug

The cost script, `sprint-cost.py`, added up API usage more than once for the same call.

- **Cause:** function `scan()` reads every line of each agent transcript file. One API
  call can write more than one line (for example a thinking line and a text line). The
  script added the usage on each line, with no check for a line that repeats an earlier
  call.
- **Also affected:** function `audit_transcript()` has the same per-line count, so its
  turn and cache-read numbers are also too high.
- **Fix:** count each call once, using the message id and request id as a key. Keep the
  last record for a repeated key instead of adding all of them.
- **Status: not yet fixed.** The bug is still in `sprint-cost.py`. This report only
  corrects the numbers by hand for this sprint.

Top 5 sub-agents by true cost:

| # | Agent role | Model | True cost |
|---|---|---|---|
| 1 | Worker C3 — canvas/branding | Opus | $14.02 |
| 2 | Fix F2 — view switch + icons | Opus | $7.92 |
| 3 | Fix F7 — header hysteresis + save retry | Opus | $7.84 |
| 4 | Fix F6 — CR01 write-back on open | Opus | $7.45 |
| 5 | Worker C1 — views-a | Opus | $6.58 |

Orchestrator true cost: **$17.50** to the end of the sprint (about $4.40 of this was 46
no-op "still working" turns; see waste item W6 below).

### Wall time and critical path

Total wall time: **218 minutes (3 h 38 min)**. The orchestrator was busy about 79 minutes
and idle, waiting for agents, about **139 minutes (64%)**.

Critical path (the chain of work that set the sprint length), in minutes:

Recon 5.5 → Worker C3 25.7 → merge-conflict fix 5.4 → version bump + CI 3.3 → blind check
6.0 → Fix F2 19.0 → merge + CI 3.5 → blind check 9.2 → Fix F4 24.3 → merge + CI 3.5 →
blind check 8.5 → Fix F6 13.3 → merge + CI 3.7 → blind check 9.2 → Fix F7 23.3 →
merge + CI 4.0 → blind check 11.0 → Fix F8 16.3 → merge + CI 4.3 → blind check 7.2 →
report 7.9.

Phase share of the total time:

| Phase | Minutes | Share |
|---|---|---|
| Intake + recon | 7.2 | 3.3% |
| Implementation (workers) | 25.9 | 11.9% |
| Fix rounds + merge/CI | 115.9 | 53.1% |
| Blind check rounds | 51.6 | 23.7% |
| Report | 8.5 | 3.9% |

The first pass (start to the first blind check) took 48 minutes. The other **170 minutes
(78%)** was five repeats of the fix-then-check loop.

### Waste, ranked by cost and time lost

Estimated cost and the fix to use on the next sprint:

| # | Waste | Est. cost | Est. minutes | Fix for next run |
|---|---|---|---|---|
| W1 | Five repeat fix/merge/check cycles, each finding only 1–2 defects | ≈$65 | ≈120 | Start the next check on a fixed version while other fixes still run. Merge each fix as it lands. Skip a full round for a single small defect — use one scoped check instead |
| W2 | The save-path defect needed 4 rounds to close | ≈$26 | ≈75 | Write the save rules (open never writes, a save only advances on success, a newer edit is never lost) before coding, and test them as one state machine |
| W3 | The top-bar layout defect needed 3 rounds to close | ≈$14 | ≈50 | Add a required width-range check (narrow and wide) to the worker's own test step, not just the blind check |
| W4 | A lower-cost model shipped a risky UI change half-fixed, so a stronger model had to redo it | ≈$8 | 19 | Route cross-view UI chrome (switches, overlays, fullscreen) to the stronger model from the start |
| W5 | A full CI run, blocking, on every merge, plus a repeated file conflict | ≈$1 | ≈20 | Do not commit generated files from worker branches. Run only the affected tests on merge; run full CI once, in the background |
| W6 | Double wake-up per agent produced 46 no-op orchestrator turns | $4.40 | ≈0 | Send the orchestrator one wake-up per finished phase, not one per agent event |
| W7 | Full CI and the full UI-test battery ran many more times than needed inside workers/fixers | ≈$7 | ≈12 | Workers run only the changed-area tests while iterating, and one full CI check before their final commit |
| W8 | Every check agent used the strongest model, even for small, narrow checks | ≈$23 | ≈4/round | Use the strongest model for one broad check per round; use a lighter model for small, scoped checks |
| W9 | A security-review check ran on every commit, including generated files | ≈$11 | ≈2 | Skip the check for generated files; run it once per merged version, not per worker commit |
| W10 | The cost figure in this report was wrong (see above) | $0 direct | — | Fix `sprint-cost.py`, and run it only after the last agent finishes |
| W11 | Agents were not restarted at the same call limit | ≈$2 | 0 | State one call limit per agent role and apply it the same way to every agent |
| W12 | Repeated environment setup steps in most agents | ≈$2 | ≈1–2/agent | Give each agent one setup script that returns a ready environment in one step |
| W13 | "Before" screenshots taken more than once for the same state | ≈$1 | <1 | Take each "before" screenshot once, early, and reuse it |

### Expected saving for the next run

Fixing the top items (W1, W2, W3, W5) could cut the sprint to about 3 rounds instead of 6:
an estimated **90–120 minutes saved** (218 minutes down to about 100–130). Fixing the
model-routing and process items as well (W4, W6, W7, W8, W9) could save a further
**$50–70 of the ≈$162 all-in cost (about 30–40%)**.

---

## 10. Known limitations

- **No real Neutralino GUI run.** This container cannot launch the desktop app's window; all
  five desktop CRs (CR01's desktop path, CR12, CR16, CR18, CR19) are proven by headless
  unit/integration tests and source review, not a live click-through. A follow-up on real
  hardware/CI with a display is recommended before the next desktop-focused release.
- CR06 ships no code — see §3 for the research handed to whoever picks it up next.

---

*Plan: [`plan-2026-09-22-meridian.md`](./plan-2026-09-22-meridian.md) (includes "What happened
vs plan").*
