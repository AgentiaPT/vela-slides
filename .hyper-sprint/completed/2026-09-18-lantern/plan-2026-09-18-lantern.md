# Sprint "lantern" — plan (2026-09-18)

## Original prompt (verbatim)

> `@"/root/.claude/uploads/799c8e45-8daf-57de-b5dd-2491f1490be7/d24f24aa-vela_next_sprint.zip" hyper sprint this`

The attachment is a Word-exported HTML brief with 9 annotated screenshots. It was parsed
into 19 discrete change requests (`CRS.md`, archived beside this plan).

## Sprint facts

- Branch: `claude/hyper-sprint-wg4gfj` · Sprint HEAD pinned: `702256ff09e6cc04ed2c0dd98de757e85a5dddea`
- Base: identical to `origin/main` at sprint start (no stale-base risk).
- Readiness gate: PASS, inline (env pre-provisioned).
  - Build in sync (24408 lines, 23 parts) · Suite baseline **561 passed / 0 failed**
  - Burst harness smoke through the `burst-bug-hunter` engine: editor boot, heading edit,
    persistence to storage, presenter entry, presenter next — all green, 3.9 s total.
- Stop rule (from `.hyper-sprint/config.md`): a blind best-model hunt of >= 3 min finds no
  in-scope defects and all features present, plus a frame-checked Markdown sprint report.
  Recorded demo NOT requested, so not built.
- Gate style: hybrid — per-cluster blind verifiers plus broad cross-cutting hunters.

## Change requests

See `CRS.md`. 19 CRs. Screenshot-to-CR mapping verified against image content
(`spec-shots.md`): CR2, CR4, CR5, CR10, CR11, CR15, CR16, CR17 each have a reference shot.

Key detail recovered from the screenshots, which sharpened three CRs:
- CR5 is specifically non-ASCII glyph metrics — the Euro sign renders thinner than the
  adjacent digits in the vector PDF. It is not a general font-weight problem.
- CR10 / CR11 are contrast defects, not missing controls. The icons render, at near-zero
  contrast against their background.
- CR17 is a highlight/underline offset: the decoration covers only the trailing letters of
  each link label and is shifted right.

## Clustering (by file locality, not ticket number)

Batch A — three genuinely disjoint clusters, parallel git worktrees:

| Worker | CRs | Owned files | Model |
|---|---|---|---|
| W1 neutralino | 12, 16, 18, 19 | `vela-neutralino/**`, its sync script | opus |
| W2 export | 5 | `part-pdf-vector.jsx`, `part-pdf-extract.jsx`, `part-pptx.jsx` | opus |
| W3 ingress | 1, 2 | `part-imports.jsx` (ingress only), `skills/vela-slides/scripts/validate.py` | opus |

Batch B — UI clusters, parallel worktrees, sequential merge (they share tail regions of
`part-reducer.jsx`, `part-uitest2.jsx` and `tests/test_vela.py`; tail-append keeps the
conflicts trivial):

| Worker | CRs | Owned files | Model |
|---|---|---|---|
| W4 blocks | 3, 6, 15, 17 | `part-blocks.jsx`, `part-canvas.jsx` | opus |
| W5 branding | 8, 9 | `part-branding.jsx` + branding config panel | sonnet |
| W6 views | 4, 10, 11, 13 | `part-slides.jsx`, `part-slidepanel.jsx` | sonnet |
| W7 review | 7, 14 | `part-list.jsx`, `part-reducer.jsx` | opus |

## UX-research CRs — decided by the sprint, flagged for review

CR6, CR13 and CR15 are written as research requests, so the workers propose and implement a
design rather than block. Each decision is recorded in the final report so it can be reversed
cheaply.

## Known verification limit

CR12, CR16, CR18 and CR19 are Neutralino desktop behaviours. The container can build and unit
test the Neutralino sources but cannot run a real desktop window, so these four are proven by
unit/integration tests plus source-level root cause, not by a driven desktop window. This is
recorded as a limitation rather than a pass.

## What happened vs plan

_Appended at sprint close._

## What happened vs plan

The plan held in shape and was wrong about scale.

**Held.** The 7-cluster partition by file locality was correct — all 7 workers ran in parallel
worktrees and every cluster was independently testable. The three UX-research change requests (6, 13
and 15) were decided by the workers and implemented rather than blocked on, which the brief's own
wording invited. The Neutralino verification limit was called correctly in advance.

**Wrong.** The plan assumed one blind round would close the sprint. It took **four**. Rounds 1, 2 and
3 each found real in-scope defects, and the final round was clean only after 11 fixes. The gate found
almost as many defects as the brief contained change requests — and it found them in the sprint's own
new work, not in old code.

**Not anticipated at all.** Four QA reports were misdiagnoses, each convincing enough to have produced
a speculative fix: a phantom persistence bug (a debounced read), a phantom PDF truncation
(`pdftotext` reading order), a phantom layout defect (measured against the wrong element), and a
phantom drag data-loss (a driver artifact). Refusing to fix on report, and demanding an artifact
instead, was worth more than any single fix in the sprint.

**Process costs to carry forward.** Every worker overran the 50-tool-call restart budget by 2-3x with
no quality loss, so the budget is mis-set. The harness blocked workers from writing report files, so
detail landed in the orchestrator's context instead of on disk — peak standing context 336K tokens,
re-read every turn. Two harness defects (`vrun --reset` ignored; the `galleryState` verb reading
test-ids that exist nowhere) each cost real time and one of them nearly produced a false finding.
