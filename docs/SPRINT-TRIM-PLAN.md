# Sprint "Trim" — Part-File Right-Sizing for Coding Agents (rev. 2)

**Codename:** trim · **Base branch:** `main`

> **Revision note.** Rev. 1 of this plan set out to make every file fit in one
> `Read` call. Rev. 2 keeps that work but changes what the sprint is *for*, after
> Giles Edwards-Alexander's [The Economic Benefit of
> Refactoring](https://martinfowler.com/articles/exploring-gen-ai/refactoring-economic-benefit.html)
> (Thoughtworks / martinfowler.com, 30 July 2026) supplied the first published
> measurement of this exact effect. The short version: **file size was never the
> goal, and it is not what produced the saving in that experiment.** What
> produced the saving was the agent becoming able to identify a small subset of
> files to read. Rev. 1 optimised the proxy. Rev. 2 optimises the thing, and
> measures it.

---

## 1. What the reference experiment actually found

A 17,155-line Rust data-access layer, agent-written, refactored in 15 disciplined
steps. After each step a **fresh sub-agent** was given an **identical**
feature-request prompt, its token consumption recorded, and the change thrown
away. Because agents never learn between sessions, the measurement is clean in a
way it could never be with a human engineer.

| | Baseline | Final |
|---|---:|---:|
| Input tokens per identical change | 159,564 | 27,360 |
| Output tokens per identical change | 1,705 | 2,113 |
| Largest file (LoC) | 17,155 | 3,695 |
| Data-access-layer total (LoC) | 17,155 | 16,608 |

**An 83% input-token reduction, banked permanently, for every future change that
touches that layer.**

Five findings matter to us, in descending order of how much they change this plan:

**(a) Total code barely moved — 17,155 → 16,608 LoC.** The saving is not because
there is less code. It is because *the agent read less of it*. The author is
explicit about the corollary: *"randomly cutting the file into smaller files is
unlikely to help as much: even if each file were smaller, the agent would be
forced to read through many files looking for the relevant code."*

**(b) The curve is flat, then it falls off a cliff.** Input tokens sat at
~155K for eleven steps. They moved only when the largest file dropped below
~9K LoC (104K tokens), and collapsed at the final step (27K). A sprint that
stops at "everything is under the cap now" can land in the flat region and bank
nothing.

**(c) The single most valuable refactoring was the one the agent skipped.**
Claude omitted the store-splitting step on the first pass and it had to be
re-applied afterwards. It was worth more than the other fourteen combined.

**(d) Output tokens did not improve** (1,705 → 2,113, inside the noise). All the
value is input-side. Note output tokens are ~5× the price, so the *cash* saving
is smaller than the token saving: the final step's 132K saved input tokens are
worth ~40¢ at Sonnet 5 rates.

**(e) The agent chose refactorings badly and applied them worse.** *"Claude is
unable to look at code, look at refactorings in general and work out which are
suitable to apply: a human needs to actively guide it."* Mechanical application
via grep/sed scripts kept breaking on indentation. The author's dedicated
automated refactoring step never once flagged the 17K-line file.

---

## 2. What this changes for Vela

### 2.1 The success metric changes

Rev. 1's target was **≤20K tokens per file**, verified by measuring files. That is
a proxy metric, and (a) says it is the wrong one. Rev. 2 keeps the ceiling as a
*constraint* but adds the real metric:

> **Primary metric: median input tokens consumed by a fresh sub-agent making a
> fixed, representative change — measured at baseline and after every phase.**

Everything else is secondary. §6 defines the harness.

### 2.2 The dedup-first phase does *not* transfer — measured, not assumed

The reference experiment spent its first six steps on Fowler §6.1 / §7.5 / §8.5
extractions (`extract_doc_id` × 20 sites, `new_link` × 62 sites, value
constructors × 128 sites, `FieldsBuilder` × 20 encoders) before splitting any
files. The obvious move is to copy that ordering. **Do not.** Vela does not have
that duplication. Measured against `src/parts/*.jsx` at the current HEAD:

```
style objects:  1,241 occurrences  →  946 distinct
most-repeated single style object:  15 occurrences
extractable presets (≥3 occurrences, >40 chars):  54
recoverable bytes if all 54 became named presets:  ~14.8 KB  =  1.06% of part-file mass
```

Vela's inline styles are *near*-duplicates, not duplicates. Firestore had 128
byte-identical `json!({"stringValue": …})` calls; Vela's champion repeats 15
times. A full style-preset extraction pass would recover about 1% of the corpus
and cost a large, review-heavy, behaviour-risking diff. **Cut it.**

This is not a minor scoping note. In the reference experiment the dedup phase is
what *created the seams* the later splits cut along — "local file changes to
extract duplication, before breaking down into smaller files once a repeating
core emerges." Vela has no repeating core to emerge. Therefore Vela cannot buy
its saving the way the reference case did, and **100% of our saving has to come
from routing** — from the agent picking the right file without reading the wrong
ones. Which makes (a) the binding constraint on this whole sprint rather than a
caveat at the end of it.

### 2.3 Splitting is necessary but not sufficient — add a routing layer

A split only pays if the agent can name the file it needs *before* opening
anything. Rev. 1 produced chunk names as a by-product of where the banners fell.
Rev. 2 makes routing a first-class deliverable with three hard rules:

1. **Every new file's name must be a routing key.** `part-sanitize.jsx`,
   `part-blocks-data.jsx`, `part-pdf-fonts.jsx` are routable.
   `part-imports-2.jsx`, `part-slides-b.jsx` are not — they force the read they
   were created to avoid. If a chunk cannot be given a name that says what is in
   it, that is evidence the cut point is wrong; move the cut, don't accept the
   name.
2. **`src/parts/MANIFEST.txt` carries a one-line purpose per file**, not just an
   ordered list. It is the build order *and* the routing table.
3. **`CLAUDE.md` gets a "where does X live" table** covering the ~15 change types
   that actually recur (add a block type, change a sanitizer, touch the PPTX
   exporter, add a UI test, …), each naming the 1–2 files to open. This is the
   cheapest lever in the entire sprint and it is worth doing *before* any split,
   so we can measure what it buys on its own (§6.4).

**Reject any cut that does not reduce the expected read-set for at least one
named change type in that table.** That is the operative test now — not "is this
chunk under 20K".

### 2.4 Sequencing changes: the hard parts move to the front

Rev. 1 put the two monolithic components (`SlidePanel`, `App`) in §4, framed as
the risky bit to be handled carefully after the mechanical work. Finding (c) says
that framing is backwards — in the reference case the deferred structural step
was the one carrying the value, and deferring it nearly lost it.

`SlidePanel` (~40K tokens) and `App` (~30K tokens) are Vela's equivalent: single
components too large to read, that no banner-cut can address, and that sit
directly on the highest-churn path. **They are the payload of this sprint, not
its tail.** They move to Phase 2, immediately after the tooling foundation, and
are measured on their own.

Finding (b) supplies the stop rule: if the phase-2 measurement has not moved the
primary metric, do not proceed to phase 3 on the assumption it will come good
later. Stop and investigate routing.

### 2.5 We have a correctness gate the reference experiment did not

Their steps were verified by test runs, with the mechanical edits done by
grep/sed scripts that "frequently got confused by indentation" (finding (e)).

Vela's concat build gives us something much stronger: for any pure file-split,
`concat.py` must produce a **byte-identical** `skills/vela-slides/app/vela.jsx`.
That is a total proof of behaviour preservation, it runs in ~10 ms, and it makes
per-step verification nearly free. Exploit it:

- **Commit one refactoring step per commit, each gated on the byte-identical
  check.** The reference experiment called its own discipline "stricter than most
  human engineers would follow"; ours is cheaper *and* stricter.
- **Know exactly where the gate stops applying.** Hoisting functions out of
  `SlidePanel` / `App` (§5, Phase 2) legitimately changes the emitted source, so
  those steps forfeit the byte-identical check and must be gated on the full test
  suite **plus** the headless UI battery (`window.__velaRunUITests()` via
  `vela-drive.js uitests`). This is the one place in the sprint where behaviour
  can genuinely regress. Budget review time accordingly.

### 2.6 Measure what the refactoring costs, not just what it saves

The reference article's main stated regret: *"it didn't occur to me to perform a
count of the tokens required to create and execute the refactoring plan until it
was already complete… The upper bound is five million."* An 83% saving whose
payback period is unknown is an incomplete result.

Record, per phase: wall-clock, token spend, and commits. Report the sprint as a
payback period — *N* changes to the affected area before it breaks even — not as
a percentage.

### 2.7 Two method improvements over the reference

- **Token counting.** The reference sub-agents reported characters and divided by
  4. Vela's own measurements put this JSX at **~2.35 chars/token** and the Python
  at ~2.5 — dividing by 4 would understate our token counts by ~1.7×. Report
  **characters read** as the primary figure (exact, agent-reported, no estimator
  in the loop) and convert with the measured per-language ratio, stated
  explicitly in the results table.
- **Repetitions.** The reference ran n=1 per step and concluded *"the noise of
  the non-deterministic code generation process is hiding any variance."* Note
  steps 5/6 and 8/9 and 12/13 report byte-identical numbers, which suggests some
  rows are carried rather than re-measured. Run **n=3 minimum, report the
  median**, and record the spread. Without it we cannot distinguish a 15%
  improvement from noise — and most of our steps will be in that range.

---

## 3. What rev. 1 got right and keeps

Unchanged, and all still in scope:

- **The read limits are real and measured**: `Read` caps at 25,000 tokens and
  refuses files over 256 KB outright. `part-pdf.jsx` (413 KB) cannot be opened at
  all today, which is why it has 1 commit in the last 120 — it is effectively
  frozen, reachable only via `grep`/`sed`.
- **The security surface is the highest-value target for review quality.** The
  deck sanitizers sit mid-file in `part-imports.jsx`, their JS regression suite
  mid-file in `part-uitest.jsx`, their Python assertions mid-file in
  `test_vela.py`. `/security-review` and reviewer subagents can hold none of the
  three whole, and mid-file is exactly where positional bias degrades attention
  most. Isolating them into `part-sanitize.jsx` / `part-sanitize-deck.jsx` is
  worth doing on review-quality grounds *even if the token metric does not move*.
  It is the one item in this plan justified by something other than the primary
  metric — flag it as such rather than letting it compete on tokens.
- **The three-hardcoded-part-lists bug is confirmed at HEAD.**
  `concat.py:21` lists 14 parts; `lint.py:15` and `tests/test_vela.py:53` list 13
  — both missing `part-pptx.jsx` (1,187 lines), so it is never linted for
  copyright header, conflict markers, brace balance, or cross-part duplicate
  declarations, and the "all part-files present" test silently ignores it. The
  test's own comment still reads `# 1. All 11 part-files exist` while the list
  holds 13. And `lint.py` is wired into no workflow and not into
  `ci-local.sh` — dead tooling, which is why the drift went unnoticed. Fixing
  this is a prerequisite: splitting files while two of three lists are stale and
  the linter is unwired is how a chunk silently vanishes from the build.
- **The TDZ ordering constraint.** Top-level `const`/`let` are TDZ-bound, so
  cross-part relative order must be preserved exactly. Keeping manifest order
  identical to current concatenation order satisfies this automatically.
- **The version gate.** CI blocks any `src/parts/` change without a
  `VELA_VERSION` bump. One bump, one terse `VELA_CHANGELOG` bullet —
  `"internal: source part-file split, no functional change"` — per the changelog
  discipline in `CLAUDE.md`.

**Stale detail:** rev. 1's line counts were captured before recent merges to
`main` and have drifted (`part-slides.jsx` 2563→2460, `part-uitest.jsx`
2662→2131, `part-app.jsx` 2013→1932, `part-blocks.jsx` 1894→1728,
`part-imports.jsx` 1550→1521). **Every cut line number in rev. 1 must be
re-derived at execution time.** See §4.1 — this should stop being a manual
transcription exercise.

---

## 4. Revised phase plan

Ordering is now: make measurement possible → do the high-value structural work →
measure → mechanical splits → measure.

### Phase 0 — Foundation and instrumentation

1. **Single-source the part list.** `src/parts/MANIFEST.txt`: one filename per
   line in dependency order, `#` comments allowed, **plus a one-line purpose per
   entry** (§2.3). `concat.py`, `lint.py`, and `tests/test_vela.py` all read it;
   delete all three hardcoded lists. Drop the stale `# 1. All 11 part-files`
   comment.
2. **`lint.py` rejects unknown parts.** Any `src/parts/part-*.jsx` absent from the
   manifest is an error, not a silent skip.
3. **Wire `lint.py --parts src/parts`** into `.github/workflows/ci.yml` and
   `tools/vela-dev/scripts/ci-local.sh`, beside the Template Sync step.
4. **Size guard in `lint.py`:** warn >700 lines, fail >900.
5. **`tools/vela-dev/scripts/partsize.py`** — prints per-banner-section line,
   byte, and token-estimate figures for any part-file. Cut points get *derived*
   from now on instead of transcribed, so line drift stops invalidating the plan
   (§3).
6. **Build the measurement harness** (§6) and **record the baseline**.

Phase 0 ships no behaviour change and no split. Gate: byte-identical `vela.jsx`.

### Phase 1 — Routing layer, measured on its own

`MANIFEST.txt` purpose lines + the `CLAUDE.md` routing table (§2.3). No code
moves at all.

**Measure here.** If a routing table alone moves the primary metric materially,
that is the cheapest win available and it reprices every later phase. If it moves
nothing, we have learned the agent is not read-limited by *discovery* — which
also reprices every later phase. Either result is worth the half-day.

### Phase 2 — The payload: `part-pdf.jsx` fonts, `SlidePanel`, `App`

The three things no banner-cut can fix, done first (§2.4).

1. **Extract the PDF font blobs.** `COMPRESSED_FONTS` — six base64 TTF blobs on
   single lines of 35–51 KB, **242 KB of the file's 413 KB** — moves verbatim to
   `src/parts/part-pdf-fonts.jsx`, registered immediately before `part-pdf.jsx`.
   They are the runtime offline fallback (`FONT_CDN_URLS` is the network path) so
   they must still ship. Only two reference sites, both in `loadFonts()`, both
   already guarded by `typeof COMPRESSED_FONTS !== "undefined"`. This single move
   is what makes the file openable at all. Byte-identical gate applies.
2. **`SlidePanel`** (`part-slides.jsx`, ~1,220 lines / ~40K tokens; one component
   with no extractable top-level children). Hoist the prompt-driven AI action
   handlers to module scope as plain functions taking `(state, dispatch, …)`:
   Quick Edit, Block-Targeted Edit, Generate New Slide, Alternatives. Then the
   browser-integration effects: back-button, Fullscreen API sync, scroll-wheel
   nav.
3. **`App`** (`part-app.jsx`, `export default function App()`, ~920 lines / ~30K
   tokens). Same treatment: keyboard handlers, storage effects, modal routing to
   module scope.

Items 2 and 3 forfeit the byte-identical gate (§2.5) — full suite **and** the
headless UI battery, and they are the only steps in this sprint where behaviour
can regress. Push early and let CI carry the node tiers.

**Measure. Apply the stop rule** (§2.4).

### Phase 3 — Mechanical splits

Cut at the existing `// ━━━` / `// ──` banners, which already mark clean seams;
derive line numbers with `partsize.py`; move blocks verbatim — no reformatting,
renaming, or reordering within a chunk; add names to `MANIFEST.txt` in original
relative order; rebuild; diff. **Every chunk must clear the §2.3 naming rule.**

Priority order is by churn against the last 120 commits, not by file size:

| Priority | File | Churn | Note |
|---|---|---:|---|
| 1 | `part-imports.jsx` | 25 commits | Isolate the security surface into `part-sanitize.jsx` + `part-sanitize-deck.jsx` (§3) |
| 2 | `part-uitest.jsx` | 17 commits | Only 3 banners at HEAD — seams must be re-derived, not assumed |
| 3 | `part-slides.jsx` | 11 commits | Remainder after the Phase 2 hoists |
| 4 | `part-blocks.jsx` | — | See note below |
| 5 | `part-pdf.jsx` | 1 commit | Remainder after the font extraction |
| 6 | `part-engine.jsx`, `part-pptx.jsx` | — | Straightforward two-way cuts |

**`part-blocks.jsx` is the one non-mechanical cut.** `RenderBlock`'s 27-case
switch is 25,597 tokens — over the hard read cap on its own, so leaving it whole
is not an option. Split it: simple/text cases stay in `RenderBlock`; the
data/diagram cases (flow, table, progress, steps, tag-group, timeline,
comparison, funnel, cycle, number-row, matrix, checklist) move to a
`RenderDataBlock` component reached from the switch's `default:`. **Verified safe:
that range contains no hook calls**, so extracting it as a plain component cannot
change hook order. Shared context the preamble computes (`block`, `st`, `SIZES`,
`cls`, `canEdit`, `textEditable`, `_pin`) passes as props — `_pin` alone has 10
call sites in the range. This follows the existing `CodeBlock` / `CalloutBlock`
extraction precedent in the same file. It also lands the best routing win in the
sprint: "change how tables render" becomes a one-file read.

**Measure.**

### Phase 4 — Tooling and tests

`tests/test_vela.py` (3,665 lines), `skills/vela-slides/scripts/vela.py` (2,643),
`tests/test_serve.py` (1,513), `tools/vela-dev/scripts/serve.py` (1,482).

- **`test_vela.py`** shares mutable module-level counters via `ok()`/`fail()`/
  `skip()`. Extract those into `tests/_harness.py` first; every split module
  imports from it. `test_vela.py` stays the thin runner and **must keep its
  `--unit` / `--integration` / `--all` flags** — `ci.yml` invokes all three, and
  `--all` also drives `run_server_tests` / `run_concat_sync` / `run_e2e_tests` /
  `run_pptx_e2e_tests`. It is the mandatory after-every-change file, so its
  ~70K tokens are billed every sprint regardless of what changed.
- **`vela.py`** splits into siblings in the same directory (`_formats.py`,
  `_deck_cmds.py`, `_slide_cmds.py`, `_analysis.py`, `_split.py`), keeping the
  helpers, `CAPABILITIES`, routing table, and entrypoint in `vela.py`. Python puts
  the script's own directory on `sys.path[0]`, so plain sibling imports work with
  no packaging change. `package-skill.py` walks the tree so new files are picked
  up automatically, and `SKILL.md` references only `vela.py` as entry point —
  unchanged.
- **`serve.py`** — extract `build_browser_html()` (pure string generation) and the
  `VelaHTTPHandler` class.

### Phase 5 — Documentation and results

Update the part-file table and Part-File Order line in `CLAUDE.md` and
`docs/ARCHITECTURE.md` to point at `MANIFEST.txt` as the single source of truth.
Record the ≤20K-token / ≤800-line rule as a standing convention. **Publish the
results table (§6.5), including the sprint's own cost and the payback period.**

---

## 5. Constraints (unchanged from rev. 1)

- **Hard ceiling: ≤20K tokens per file** — 20% margin under the 25K cap. Now a
  constraint, not the objective.
- **Floor: ~250 lines.** Do not shard below this; extra files cost grep hops —
  and per finding (a), a file the agent has to open to find out it is the wrong
  file is worse than no split.
- **No bundler.** The ~10 ms Python-stdlib concat stays as it is.
- **Token density: ~2.35 chars/token for this JSX, ~2.5 for the Python.** Byte
  size understates token cost by ~1.7×. Never use the generic ~4.

---

## 6. The measurement harness

The core transferable artifact from the reference experiment, adapted to Vela.

### 6.1 Protocol

Per measurement point (baseline, then after each phase):

1. Working tree clean at the phase commit.
2. For each representative change RC-1..RC-3, **3 times**:
   a. Spawn a **fresh sub-agent** with *only* the RC prompt — no other context,
      no conversation history, no hints about the refactoring.
   b. It makes the change and emits the reporting JSON block (§6.3).
   c. **`git checkout . && git clean -fd`** — throw the change away.
3. Record median and spread of characters read per RC. Convert to tokens at 2.35
   (JSX) / 2.5 (Python).
4. Also record: files opened, wall-clock, output characters.

The sub-agent must be genuinely fresh. Agents never learn between sessions, which
is what makes this measurable at all — and it is also what makes leakage
invisible if you get it wrong. Do not reuse a sub-agent across reps.

### 6.2 Representative changes

Three, chosen to span the change types that actually recur in Vela's history, so
we do not overfit to one path:

- **RC-1 — Add a block type** (highest-frequency real change). Touches
  `part-blocks.jsx` renderer, `part-imports.jsx` validation, `part-uitest.jsx`
  coverage, `references/block-schema.md`. This is the one Phase 3's
  `RenderDataBlock` split targets.
- **RC-2 — Add a deck-sanitization rule** (the security-review path, §3). Touches
  the sanitizer surface plus its JS and Python regression suites — the three
  files no reviewer can currently hold whole.
- **RC-3 — Add an engine tool** (`part-engine.jsx` + trace rendering in
  `part-chat.jsx`). A cross-part change, to check whether splitting helps or
  hurts when the work genuinely spans files.

RC-1 and RC-2 should improve. RC-3 is the control that catches us making things
worse: a change that legitimately spans four files can be made *more* expensive
by splitting, and we want to know if that happens rather than discover it later.

### 6.3 Reporting block

Appended verbatim to every RC prompt, adapted from the reference experiment:

```
At the very end of your response, output exactly this JSON block (fill in real values):
{
  "files_read": [
    {"path": "src/parts/part-blocks.jsx", "chars": 123456},
    ...
  ],
  "response_chars": 7890
}
Do NOT commit the change. Stop after writing the code.
```

`files_read` must list every file opened, including partial/paginated reads, with
characters actually returned. Per §2.7, chars is the reported figure; the token
conversion happens in analysis, where the ratio is visible and auditable.

### 6.4 Phase 1 measures routing in isolation

Phase 1 moves no code, so any change in the primary metric is attributable
entirely to the routing table. This is the cleanest single experiment in the
sprint and it is nearly free — run it properly.

### 6.5 Results table

Published in Phase 5, one row per phase:

| Phase | Largest part-file (lines) | RC-1 median input chars | RC-2 | RC-3 | Refactoring cost (tokens) | Cumulative |
|---|---|---|---|---|---|---|

Report the outcome as a **payback period** — *N* changes to the affected area
before break-even — not as a bare percentage (§2.6).

---

## 7. Verification

### ⚠️ `node` is not installed on the dev machine

`node`, `npm`, `npx`, and `pnpm` are all absent locally; Python is `python`
(3.12.10), **not** `python3`. Checks split into two tiers — a green local run is
not full verification.

**Runs locally (Python only):**

```bash
# 1. Monolith unchanged — the correctness proof for every phase except Phase 2 items 2-3
python tools/vela-dev/scripts/concat.py
git diff --exit-code skills/vela-slides/app/vela.jsx

# 2. Lint now covers every part; fails on a manifest/disk mismatch
python tools/vela-dev/scripts/lint.py --parts src/parts

# 3. Python suites
python tests/test_vela.py --unit
python tests/test_vela.py --integration
python tests/test_serve.py
python tests/test_cli.py
```

**CI-only (needs node + the pinned Chromium):**

```bash
node tests/test_block_render.cjs && node tests/test_engine_tools.cjs && \
node tests/test_reducer.cjs && node tests/test_ux_logic.cjs
node tools/vela-dev/scripts/render-offline.js examples/vela-demo.vela /tmp/vout
node tools/vela-dev/scripts/vela-drive.js uitests /tmp/vout/render.html --json /tmp/ui.json
```

**Capture a baseline first.** Run the local tier on the untouched branch and save
the output — several node-backed assertions inside `test_vela.py` will already be
red on this machine, and you need to know which so you don't chase pre-existing
failures.

**Tests that read part-files by absolute path and must be updated as their target
splits** — `tests/test_block_render.cjs:41-42`, `tests/test_engine_tools.cjs:15-16`,
`tests/test_data_image_uri.cjs:27`, `tests/test_modal_scroll.cjs:7`,
`tests/test_storage_warning.cjs:7`, `tests/test_export_robustness.cjs:8`,
`tests/test_markdown_export.cjs:10`, `tests/test_icon_picker_escape.cjs:12`,
`tests/test_standalone_html.cjs:37`, `tests/test_block_toolbar_clip.cjs:25`.
`tests/test_reducer.cjs:18` and `tests/test_ux_logic.cjs:6` use a
`P = (f) => path.join(__dirname, "..", "src/parts", f)` helper — those adapt by
adding filenames to the existing list. Several Python assertions in
`test_vela.py` also open parts by name directly and will need repointing as those
files split. *(Line numbers per rev. 1; re-verify at execution time — see §3.)*

---

## 8. Open questions the reference experiment leaves us

Worth stating so the sprint does not silently assume answers:

1. **Does the effect survive without a repeating core?** The reference case's
   splits cut along seams that dedup had already exposed. Vela has no such core
   (§2.2). Phase 1 + Phase 2 measurements are the first real evidence either way
   — this sprint is a genuine test of the finding, not an application of it.
2. **Does the cliff exist for JSX?** The reference cliff came at ~3,695 LoC
   largest file. Vela's floor of ~250 lines and ceiling of ~800 straddle a very
   different range, and JSX at 2.35 chars/token behaves unlike Rust.
3. **Does RC-3 get worse?** Explicitly instrumented in §6.2. If cross-part
   changes regress, the ≤20K ceiling is too aggressive and should be relaxed
   toward fewer, better-named files.
4. **What does a routing table buy without any split?** Phase 1 answers this, and
   the answer determines whether Phases 3–4 are worth their diff.
