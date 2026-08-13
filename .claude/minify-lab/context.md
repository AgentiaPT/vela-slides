# Minify Project — Orchestrator Context

> Resumable memory across compaction/container-reclaim. Update after every
> meaningful step, not just at phase ends. This file is the source of
> truth — treat agent context as disposable.

## Incident (2026-08-13) — why this file now gets committed

Prior session did all work under `.claude/minify-lab/` without ever
committing to git. The container was reclaimed → the directory, two
in-flight background agents (skill build + harness-script build), and all
produced docs were lost entirely. Recovery was only possible because the
orchestrator's own compacted-context summary got pasted back in by the
user. **New rule: commit + push this file and any new artifact under
`.claude/minify-lab/` to branch `claude/autocompact-auto-w0dcer` after
every phase lands — don't wait for "ready to ship".** Auto-compact is set
to 300k tokens for this session; context.md, not agent memory, is the
durable record. Given to any fresh session, this file must be enough to
resume without re-asking the user anything already answered below.

## Goal

Build a `/minify` skill that compresses instruction files (CLAUDE.md,
SKILL.md, references) with no loss of needed semantics — minified version
must produce the exact same quality of agent outputs as the original.
Validate rigorously using this repo's real tasks as evals: tokens, turns,
errors, and LLM-as-judge, with continuous bias/leak auditing.

## Locked decisions (2026-08-13, reconfirmed unchanged on this redo)

- **Eval targets**: plural — CLAUDE.md *and* several skills in this repo,
  not one pilot.
- **Eval harness**: a NEW general harness (not extending `evals/` in
  place — that one is deck-scenario-specific, assertions like
  `slide_count` don't fit CLAUDE.md/skill tasks). DO port the blind-A/B-
  judge, `report.py`, `gate.py`, `harvest.py` patterns from
  `evals/scripts/`.
- **Judge**: single blind judge, model=opus, randomized A/B presentation
  order, judge never told which is baseline vs minified.
- **Storage**: `.claude/minify-lab/` — **now git-tracked on this branch**
  (see Incident above; previously gitignored-by-convention, which is what
  caused the loss). Nothing ships into the real repo surface
  (`skills/vela-slides/`, `src/parts/`) until a specific artifact is ready.
- **Reduction gate**: this screens MINIFYING-APPROACH candidates (e.g.
  "telegraphic style" vs "pseudocode" vs "omit-the-inferable"), NOT
  specific target-file candidates. An approach must achieve **≥20%
  average token/size reduction**, averaged across the files it's applied
  to, before it's worth running through the full eval harness. Pre-filter
  only, not the success bar — passing quality (blind judge + tokens/
  turns/errors, no behavioral drift) is the actual bar.

## Operational decisions (this redo, 2026-08-13)

- **Reconstruction**: re-run all research fully (not reconstructed from
  the prior summaries) — user's explicit choice, rigor over speed.
- **Persistence**: commit WIP snapshots under `.claude/minify-lab/` to
  this branch and push periodically, not gated on "ready to ship".
- **Pilot budget** (for real `claude -p` runs, phase 6+): **3 reps per
  scenario**, **sonnet** plays the agent-under-test, opus stays judge.
- **`/minify` skill location**: `.claude/skills/minify/` — matches this
  repo's convention for generic meta-tooling skills (hyper-sprint,
  dependency-sweep, playwright-cli-setup all live there, are git-tracked,
  unrelated to Vela-the-product).
- **No `VELA_VERSION` bump** needed for this project — it touches neither
  `skills/vela-slides/` nor `src/parts/`. Recheck this if that ever
  changes (e.g. if we later ship something under `skills/vela-slides/`).

## Orchestrator role & model policy

Orchestrate only — sub-agents do the actual work.
- **opus**: hardest/highest-value tasks (research, skill/harness design,
  judging)
- **fable**: advisor for the orchestrator's own blocked decisions only,
  never delegated work
- **sonnet**: default for delegated implementation/research; also plays
  "agent under test" in pilot runs
- **haiku**: trivial mechanical tasks only

## Anti-bias watchlist (living list — add to it, don't just reread it)

- Judge must never see which version is baseline vs minified — scrub
  labels/paths, randomize presentation order every time.
- Judge must not be the same model/context that did the minifying
  (avoid self-preference bias).
- Verbosity bias: minified output is shorter by design — rubric must
  score concrete dimensions, not vibes, so "shorter" isn't conflated
  with "better".
- Task-selection bias: fix the scenario set before seeing results, don't
  cherry-pick scenarios the minified version happens to ace.
- Leakage: minified instructions must not accidentally encode eval-
  scenario specifics (inflates scores on the exact eval set without
  generalizing).
- Judge instability: if a single blind judge shows inconsistent verdicts
  across re-runs, escalate to multi-judge or self-consistency.

## Phase plan (reset — redoing from scratch)

1. **[dispatched]** Research candidate reduced-instruction encoding
   formats (telegraphic/caveman, pseudocode, controlled natural language
   / STE, structured key-value, symbolic notation, "omit-the-inferable"),
   grounded in real prompt-compression literature + hand-minification
   probes on this repo's actual CLAUDE.md/SKILL.md sections. Agent: opus,
   background. Output: `.claude/minify-lab/research-encoding-formats.md`
2. **[dispatched]** Design the eval harness: new "real change-request
   task, baseline vs minified instructions" harness, porting judge/
   report/gate/harvest patterns from `evals/scripts/`; 7+ fully-specified
   CLAUDE.md scenarios; keep 6a (reduction pre-filter) and 6b (quality
   gate) as separate verdicts, never merged. Agent: opus, background.
   Output: `.claude/minify-lab/harness-design.md`
3. **[ ]** Citation verification pass on phase 1's external citations
   (WebSearch snippet-level — arXiv itself is egress-blocked in-
   container). Agent: sonnet, background, dispatched after phase 1
   lands. Output: `.claude/minify-lab/citation-verification.md`
4. **[ ]** Build `.claude/skills/minify/` itself, applying phase 1's top-
   ranked approach. Agent: opus. Constraints: don't apply to real repo
   files yet, don't touch `VELA_VERSION`, don't `git commit` (orchestrator
   reviews + commits).
5. **[ ]** Build harness scripts under `.claude/minify-lab/harness/` per
   phase 2's design. Agent: sonnet. Constraints: no real `claude -p` runs
   yet (separate gated step, costs real budget), self-test with synthetic
   fixtures only.
6. **[ ]** First real pilot: CLAUDE.md baseline vs minified — 3 reps,
   sonnet as agent-under-test, opus blind judge (budget locked above).
7. **[ ]** Expand to additional skills (candidates: hyper-sprint,
   vela-secure-coding, vela-slides skill docs).
8. **[ ]** Continuous bias/leak audit per watchlist; fix and re-run as
   issues surface.

## Artifacts index

*(empty — prior run's docs were lost before landing; rebuilding now)*

## Current status (last updated: 2026-08-13, restore-session start)

Container reclaim wiped all prior artifacts (research doc, harness-design
doc, citation verification, in-progress skill + harness-script builds) —
none had been committed. Rebuilding from scratch per the user's explicit
choice (full re-run, not summary-reconstruction). Just dispatched phase 1
(research) and phase 2 (harness design) as parallel background agents.
Waiting on task-notifications, not polling. This file + directory get
committed and pushed right after this initial scaffold, then again after
each phase lands.

## Open questions / to revisit

- None currently blocking.
