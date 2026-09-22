# Sprint "meridian" — plan (written at Phase 2, before implementation)

## Original prompt (verbatim)
> @"<uploaded zip: vela_next_sprint.zip>" hyper sprint this, use silent mode

The zip holds a Word-exported HTML spec with 19 change requests + screenshots.

## Parsed change requests
See the report README for the full list. CR01–CR19 (CR06 = copy/paste, spec says "needs ux research").

## Base
Branch `claude/nice-allen-4zrvzg`, sprint HEAD `a9408a8`. Readiness: 561/561 tests, 18/18 CI gates, burst smoke on 6 surfaces — ready.

## Clusters (file-locality, parallel worktrees)
| Cluster | CRs | Main files | Tier |
|---|---|---|---|
| C1 views-a | CR04, CR07, CR14 | part-list, part-slides (gallery), part-slidepanel (nav), part-reducer, part-imports (allowlist) | opus |
| C2 views-b | CR10, CR11, CR13 | part-imports (CSS), part-slidepanel (toolbar), part-app | sonnet |
| C3 canvas | CR03, CR08, CR09, CR15, CR17 | part-branding, part-slides (BrandingPanel), part-slidepanel (mount), part-canvas, part-blocks | opus |
| C4 export | CR02, CR05 | validate.py, part-pdf-extract | opus |
| C5 neutralino | CR01, CR12, CR16, CR18, CR19 | part-imports (load path), part-app, part-export-md, vela-neutralino/* | opus |
| — | CR06 | parked: UX research proposal only | — |

Integration: sequential merge, suite green between merges; one VELA_VERSION bump + changelog at the end.
Gate: hybrid blind — one verifier per cluster surface + one broad hunter, burst engine, engine `deadline`.

## Silent-mode decisions (made at plan time)
- CR06 parked: spec asks for UX research; a research proposal ships in the report, no code.
- CR07 uses new names (`reviewed` slide field, review-cycle toggle) because `reviewMode` already names the comments review feature.
- Neutralino CRs (CR12, CR16, CR18, CR19): the GUI cannot run in this container; proof is headless unit/node tests + code review.

## What happened vs plan

Clusters C1–C5 landed as planned; C5's first worker hit its budget mid-task and was
replaced by C5b, which finished the cluster on its own branch. The blind gate ran 6 rounds
instead of 1: round 1 found 9 in-scope defects, round 2 found 4 (plus one finding resolved
as by-design, not a bug), round 3 found 1, round 4 found 2, round 5 found 1, and round 6 came
back clean — fix rounds F1 through F8 closed each round's findings before the next round ran.
In round 3 the canvas/branding surface was not re-driven by its own dedicated verifier
because it was unchanged since round 2's clean verdict; the round's broad hunter still
covered it, and that coverage choice is recorded in the report's Assumptions section. Full
detail: [`README.md`](./README.md).
