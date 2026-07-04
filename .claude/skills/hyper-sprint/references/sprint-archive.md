# Sprint archive & Markdown report (default proof artifact)

Every finished sprint is archived under `.hyper-sprint/completed/`. The Markdown report is
the **default** proof artifact (a recorded video demo is optional, on request).

## Layout
```
.hyper-sprint/completed/
  README.md                              # index of all sprints — a table, one row per sprint
  <YYYY-MM-DD>-<codename>/               # date + a short memorable codename (e.g. limelight)
    README.md                            # the sprint report — renders when the folder is opened
    plan-<YYYY-MM-DD>-<codename>.md        # verbatim original prompt + initial plan (written in Phase 2)
    sprint.json                          # machine-readable metadata (see schema below)
    img/                                 # burndown.png + <cr>-before/after-*.png (relative paths)
```
Pick the codename in Phase 2 (memorable, lowercase-hyphen); reuse it in the folder, the plan
filename, the report title, and `sprint.json.codename`.
Rules: **relative** `img/…` paths (GitHub renders these; it does NOT render base64 data-URIs).
Commit screenshots (small PNGs) but **not** heavy media — a recorded `.webm`/video or the
transcripts zip must be attached/linked, never committed (archive bloat). Optionally also emit
a base64-inlined single-file copy (`<Title>.md`) for portable one-click viewing outside git.

## `sprint.json` schema (keys)
`slug, codename, title, started, completed, branch, base, base_commit, skill, version{from,to},
tests{from,to}, change_requests[{id,area,summary}], blind_rounds, defects_found_and_fixed,
cr_bugs_remaining, cost_usd_approx, artifacts{report,plan,images}`.

## Report arc (README.md)
Scope table → **agentic burndown** → stats → **before/after per change** → cost/savings →
bugs found & fixed → a short "how it was made" note. Cross-link `plan-*.md`.

## Screenshots come FREE from verification (the synthesis)
Do not run a separate capture step. In Phase 5 the blind verifiers already drive each feature
through the **`burst-bug-hunter`** warm-app harness; have each `ctx.shot("<cr>-after-<label>")`
at its proof state. "Before" shots = the **same tagged bursts** run against a render built from
the **base commit** (`git worktree add <base>`, concat, render-offline). Only produce a
before/after pair where the UI actually differs; otherwise after-only + a one-line "before"
description. Frame-check (look at each PNG) before shipping.

## Agentic burndown
`assets/mk-burndown.py <events.json> <out.png>` renders the curve. `events.json` is a list of
`{label, work, kind}` where `kind ∈ start|impl|bump|fix|done`; `bump` = a blind-hunt round that
ADDED scope (agent-found defects) — annotated `+N`, so the curve rises before reaching 0. Build
the event list from the real merge/fix commits + blind-round outcomes (`sprint-stats.py` gives
the commit timeline; the round results give the bumps).

## Flow at close (Phase 5)
1. Blind gate clean (verifiers `ctx.shot()`'d their after-states along the way).
2. Build base render → capture before-states with the same bursts.
3. `mk-burndown.py` from the event list; `sprint-cost.py` / `sprint-stats.py` for numbers.
4. Assemble `README.md` (relative img paths); write `sprint.json`; append a row to
   `completed/README.md`; append "what happened vs plan" to `plan-*.md`.
5. Deliver the report link (format below). Recorded video demo only if the user asks.

## Delivering the link (so it's clickable and can open the GitHub app)
Hand over the report as a **clickable Markdown link**, never bare text or backticked code:
```
[Sprint "<codename>" report](https://github.com/<owner>/<repo>/tree/<branch>/.hyper-sprint/completed/<YYYY-MM-DD>-<codename>)
```
- The `tree/<branch>/…/<sprint-folder>` URL renders the folder's `README.md` on open.
- **Do NOT wrap the URL in backticks** — that renders as monospace code, not a link.
- **Only `http(s)` links linkify** — `github://…` custom schemes won't render as links; don't offer them.
- Deep paths containing a **dot-folder** (`.hyper-sprint`) often open in the browser instead of
  the app; also offer the shorter **repo root** `https://github.com/<owner>/<repo>` and
  **branch root** `…/tree/<branch>` links, which hand off to the GitHub mobile app more reliably.

