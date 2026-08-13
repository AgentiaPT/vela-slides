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
- **Lab-leak confounder (found by phase 2 agent, 2026-08-13)**: because
  `.claude/minify-lab/` is now git-tracked (our own persistence fix), a
  `git worktree`-isolated eval run would otherwise let the agent-under-
  test literally read the harness's own scenario answer keys. Harness
  design's `prepare.py` scrubs the lab dir out of every worktree and
  asserts (`grep -rl "minify-lab"`) it's gone before any run starts.
- **PreToolUse hook confounder (found by phase 2 agent)**: this repo's
  own `.claude/hooks/post-edit-lint.py` forces the secure-coding-skill
  read on the first in-scope edit per checkout, in worktrees too. An
  agent running on minified CLAUDE.md that dropped the secure-coding
  mandate would still comply — because the *hook*, not the instructions,
  forces it — masking real drift as "no drift". Harness design handles
  this with two modes: `hooks_mode: parity` (default, hooks left on,
  ecologically valid, gate decision made here) vs `hooks_mode:
  neutralized` (hooks stripped from both arms identically, diagnostic-
  only, isolates the instruction file's own contribution). Never mix
  modes within one baseline/minified pair.

## Phase plan (reset — redoing from scratch)

1. **[dispatched]** Research candidate reduced-instruction encoding
   formats (telegraphic/caveman, pseudocode, controlled natural language
   / STE, structured key-value, symbolic notation, "omit-the-inferable"),
   grounded in real prompt-compression literature + hand-minification
   probes on this repo's actual CLAUDE.md/SKILL.md sections. Agent: opus,
   background. Output: `.claude/minify-lab/research-encoding-formats.md`
2. **[DONE]** Design the eval harness: new "real change-request
   task, baseline vs minified instructions" harness, porting judge/
   report/gate/harvest patterns from `evals/scripts/`; 7+ fully-specified
   CLAUDE.md scenarios; keep 6a (reduction pre-filter) and 6b (quality
   gate) as separate verdicts, never merged. Agent: opus, background.
   Output: `.claude/minify-lab/harness-design.md` — see Artifacts index.
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

- `.claude/minify-lab/harness-design.md` — **DONE** (2026-08-13, opus,
  ~1600 lines). Implementation-ready spec for `.claude/minify-lab/
  harness/`. Key points:
  - **6a `reduction.py`**: judge-free, zero model calls, bytes/lines +
    two independent stdlib token proxies across an approach's file
    manifest, gates on ≥20% mean reduction, with implausible-reduction /
    proxy-disagreement / structure-loss integrity guards.
  - **6b quality gate**: per (approach, target file); **9 scenarios × 2
    arms × 3 reps** (matches the locked pilot budget); each arm frozen in
    its own `git worktree add --detach`; blind A/B judged by opus; plus
    critical assertions and tokens/turns/errors. 6a/6b verdicts kept
    structurally separate (`verdict_kind` fields; `report.py --selftest`
    rejects any combined score; two-panel report).
  - **Judge**: tool-less, repo-less, sees only a redacted diff/answer —
    never transcript/turns/tokens/cost; randomized order + recorded seed;
    fail-closed redaction + post-scan quarantine; ties are a legitimate
    verdict; 2 judgings per pair, >20% disagreement ⇒ `inconclusive`.
  - **`read_before_edit`** (new mechanism): proves consultation purely
    from tool-call history (Read window/anchor intersection, Grep, shell
    readers, Skill loads) ordered before the first mutation — assistant
    text is never inspected; a fixture where the agent merely *claims* a
    read must fail the check.
  - **3 confounder controls found during design** (see Anti-bias
    watchlist for full detail): lab-dir self-leak (worktrees scrub
    `.claude/minify-lab`), the repo's `PreToolUse` secure-coding hook
    masking instruction drift (parity vs neutralized run modes), and
    harness-preamble/scenario-prompt leak checks so the prompt itself
    never re-teaches a rule minification might have deleted.
  - **9 frozen CLAUDE.md scenarios**: S1 `reducer-nohistory`, S2
    `blockfield-safekeys`, S3 `routing-lookup`, S4
    `exporter-encoder-reuse`, S5 `docs-only-versionbump`, S6
    `minimal-diff-temptation`, S7 `security-changelog-discipline`, S8
    `newpart-manifest`, S9 `public-repo-hygiene`. Frozen before any
    results exist — adding/editing one later requires a new campaign id,
    old results stay published.
  - Not yet reviewed line-by-line by the orchestrator beyond structure +
    the confounder-control sections (§6, spot-checked — sound). Full
    review still pending before phase 5 (implementation) starts.

## Current status (last updated: 2026-08-13, phase 2 landed)

Container reclaim wiped all prior artifacts; rebuilt from scratch per the
user's choice (full re-run, not summary-reconstruction). Phase 1
(research) and phase 2 (harness design) were dispatched in parallel as
background agents. **Phase 2 is DONE** — `harness-design.md` written, see
Artifacts index; 3 new confounder controls folded into the watchlist.
Phase 1 (research-encoding-formats.md) still running. Not polling —
waiting on its task-notification. Phase 3 (citation verification) is
blocked on phase 1 landing, not yet dispatched. Phases 4-5 (build skill,
build harness scripts) are blocked on phases 1 and 2 respectively — phase
5 can be dispatched now that phase 2 is done, but holding it until phase 1
lands too so both builder agents can start together as in the original
plan. This file gets committed and pushed after every phase lands.

## Session hygiene: checking context usage

Auto-compact is set to **300k tokens** for this session. To check actual
usage at any time (real reading from the live transcript's API `usage`
field, not a byte-count guess):

```bash
python3 .claude/minify-lab/check-context.py
```

Prints context tokens used, the 300k threshold, % used, and headroom.
Override the threshold with `--threshold N` if it's ever changed.

## Open questions / to revisit

- None currently blocking.
