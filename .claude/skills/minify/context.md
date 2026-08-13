# /minify project — orchestrator context

Resume point for the main orchestrator session. Keep this updated after every
major step; treat it as the only durable memory across compactions.

## Goal

Build a portable `/minify` skill that compresses instruction files (CLAUDE.md,
SKILL.md, references/*.md) into fewer tokens with a **hard constraint**:
minified version must NEVER cause worse agent behavior than baseline —
not higher cost, not more turns, not more errors, not lower quality. Subject
to that constraint, minimize tokens as much as possible.

## Decisions locked in (from user, 2026-08-13)

- **Scope**: standalone/portable skill (usable in any repo), not vela-specific.
  Building it under `.claude/skills/minify/` in vela-slides repo for now since
  that's where we develop + eval it; keep it repo-agnostic internally (no
  hardcoded vela paths in the skill logic itself — only in eval configs).
- **Optimization target**: token count, subject to the no-regression
  constraint above (quality/cost/turns/errors must not get worse).
- **Eval model for task execution**: Sonnet only (claude-sonnet-5).
- **Judge rigor**: blind pairwise LLM-judge, randomized order (baseline vs
  minified), judge model DIFFERENT from the task-execution model (use Opus
  or Fable as judge, never Sonnet-judging-Sonnet).
- Orchestrator (this session) does not do implementation work directly —
  delegates everything to sub-agents, picks model per task:
  - Opus: hardest reasoning (encoding-format research, judge synthesis, bias audits)
  - Fable: advisor role for blocking decisions only
  - Sonnet: default implementation/eval-running work
  - Haiku: trivial mechanical tasks only

## Eval design (must stay bias-resistant — keep auditing this)

- Use vela-slides repo as the eval corpus: CLAUDE.md, hyper-sprint skill,
  vela-slides base skill files (SKILL.md + references/*.md) as three targets.
- Per target: baseline file vs minified file. Run same change-request task
  against each (same repo state otherwise, fresh session/context each time).
- Metrics: tokens consumed, turns taken, tool-call errors, task success,
  LLM-judge quality score (blind, randomized order, separate judge model).
- Known bias risks to keep checking:
  - Judge order bias → always randomize which is "A"/"B", judge blind to which is baseline.
  - Judge model correlation with task model → never let same model judge its own output.
  - Task selection bias → pick multiple varied change requests per target, not one.
  - Prompt/leakage bias → make sure minified file doesn't leak eval awareness
    to the agent under test (agent shouldn't know it's being evaluated).
  - Length/verbosity bias in judge (LLMs often prefer longer/more verbose
    answers) → judge rubric must explicitly control for this.
  - Non-determinism → ideally multiple trials per condition, not n=1.

## Status log

- [2026-08-13] Kickoff. Asked user clarifying questions (scope, target,
  eval model, judge rigor) — answers locked in above. Created this
  context.md. Next: spawn research agent for encoding-format hypotheses
  (caveman/pseudo-code/ste/technical-shorthand/etc), running in background.

## Open questions / not yet decided

- Exact eval task set (specific change requests) per target — TBD after
  research phase, need real representative tasks.
- Where the final portable skill package lives long-term (still inside this
  repo's .claude/skills/minify, or exported elsewhere) — revisit once it's
  proven out.
- Number of trials per condition for statistical confidence — TBD.

## Next action

Research agent dispatched (see below) to survey candidate compression
encodings for instruction files. Awaiting result.
