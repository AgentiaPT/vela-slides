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
  context.md.
- [2026-08-13] Opus research agent (accce87f7b9176660) completed encoding-
  format survey. Full report kept in `research-encoding-formats.md` (write
  it if not yet present). Key conclusions:
  - **Reject**: caveman/telegraphic English, shorthand+glossary, emoji/glyph
    substitution. Risk >> reward; these strip exactly the function words
    ("unless", "except", "never", "must not") that encode conditional/
    exception logic — the repo's highest-cost failure mode.
  - **Adopt: "Tiered hybrid" strategy.** Classify every block into:
    - **Tier N (normative/judgment)** — security discipline, minimal-diff
      policy, version-bump gate, disambiguation logic, anything with
      unless/except/only/never/must not/before/after/when-in-doubt/
      otherwise/instead-of. Compress NOTHING beyond literal duplicate
      removal. Must survive byte-identical or near-identical.
    - **Tier M (mechanical/enumerable)** — routing tables, command lists,
      dir trees, constants, exit codes. Compress hard (~30-40%): symbol-only
      cells, drop connective prose, DSL-ish where it's genuinely a lookup.
    - **Tier E (explanatory)** — rationale/background/examples/restated
      context. Trim or move out-of-line via pointer (~30-50%).
  - Reference-by-pointer (lazy load) is the single biggest remaining lever
    by raw tokens, but ONLY for depth-on-demand content, never for
    unconditional obligations (a rule the agent might not load is a rule
    that gets violated sometimes).
  - Biggest unexploited levers in already-dense files like this repo's
    CLAUDE.md: cross-file dedup (same rule restated in CLAUDE.md/SKILL.md/
    secure-coding skill), rationale pruning (keep directive, cut the "why"
    clause), table-cell compression (prose fragments → symbols/paths),
    example collapsing, CRITICAL/MANDATORY section consolidation (merge
    headers, never downgrade modal verbs: MUST→should is a semantic edit,
    not compression).
  - **First-pass target: 20-30% reduction, not 50-60%.** <10% ⇒ file was
    already optimal, stop. >35% starts cutting into Tier N / salience
    markers — silent failure mode, only shows up probabilistically across
    many live sessions.
  - **Eval must score compliance, not comprehension.** A quiz over the
    compressed file proves nothing. Need real tasks (N≥20/variant) measuring
    version-bump compliance, secure-coding-read compliance, minimal-diff
    adherence, routing accuracy, turns, tokens, test pass rate — including
    ≥3 tasks that specifically trip a conditional/exception rule.
  - **Mechanical safety gate for the minify skill itself**: regex-extract all
    sentences containing the trigger words above, pre- and post-minify; set
    must match 1:1 or the minify run fails. This becomes a hard check inside
    the /minify skill, not just an eval nicety.
  - Prompt caching: shorter file = smaller marginal saving on cache reads
    (~10% of base rate already); real win is context budget/attention, not
    $. Don't iteratively re-minify in prod — churn invalidates cache prefix.

## Open questions / not yet decided

- Exact eval task set (specific change requests) per target — TBD, need
  ≥3 tasks per target tripping conditional/exception rules specifically,
  plus general tasks. N≥20 trials/variant is the research-recommended
  floor for statistical confidence — likely too expensive for first pass;
  need to decide a realistic first-pass N (probably 3-5) and flag results
  as directional only until scaled up.
- Where the final portable skill package lives long-term — revisit once
  proven out.
- Judge model: Opus vs Fable for blind pairwise judging — leaning Opus
  since Fable is reserved for "blocking decision advisor" per user's
  original framing, not bulk judging work.

## Status log (cont.)

- [2026-08-13] Skill built: `SKILL.md` + `scripts/check_preservation.py`
  (stdlib-only, generic two-file gate: extracts trigger-word sentences from
  both files, exact+fuzzy diffs them, exit 1 on any Tier N loss, reports
  token counts/% reduction, tiktoken with regex fallback). Verified against
  a deliberately-broken pair (correctly FAILs) and a correct pair (PASSes,
  ~18.6% reduction). Skill registered and discoverable via Skill tool.
- [2026-08-13] Eval task set written: `eval-task-set.md`. 3 targets, ~15-17
  tasks total (5-6 each): CLAUDE.md (A1-3 traps: minimal-diff, version-bump
  gate, secure-coding-read+disclosure-discipline; A4-6 baseline routing/
  reducer/CI tasks), hyper-sprint (B1-3 traps built from its own actual
  rules: orchestrator-never-implements, blind-validator gate can't be
  skipped, replace-not-absorb dead worker; B4-5 baseline), vela-slides base
  skill (C1-3 traps: exact-tool-call-count workflow, compact-DSL-only,
  --demo disambiguation; C4-6 baseline). Each task has a mechanically
  checkable pass/violation signal, not a vibe judgment. Recommends N=3 per
  (target x condition) per task as a tractable first pass, full N>=20 only
  for confirmatory follow-up; any trap violation at N=3 escalates to a full
  run rather than being averaged away; label first-pass results
  "directional, not confirmatory."

## Status log (cont. 2)

- [2026-08-13] First real minify run: `CLAUDE.md` -> `CLAUDE.min.md`.
  4644 -> 4425 tokens (4.7% reduction), gate PASS (56/56 trigger sentences
  preserved). Low reduction is plausible/expected — file is already dense
  and mostly Tier N (routing/version/security rules). Committed
  (CLAUDE.min.md is now in repo).
- [2026-08-13] User steer: use MULTIPLE minify scenarios as evals — not just
  CLAUDE.md. Dispatching parallel Sonnet agents to minify more real
  skill files in this repo so we have several concrete baseline/minified
  pairs to eval against, spanning different file types/sizes:
  - `.claude/skills/hyper-sprint/SKILL.md` (already has eval-task-set.md
    tasks B1-5 written against it)
  - `skills/vela-slides/SKILL.md` (already has eval-task-set.md tasks
    C1-6 written against it)
  - `.claude/skills/vela-secure-coding/SKILL.md` (referenced by CLAUDE.md's
    mandatory-read rule; high Tier-N density, good stress test)
  Each agent: invoke /minify on its target, run the gate, iterate until
  pass, report tier breakdown + token counts, do NOT commit (left for
  orchestrator).

## Status log (cont. 3) — all 4 minify pairs done

All four real-repo minify runs complete, gate PASS on every one, all
committed:

| Target | Tokens before -> after | Reduction | Gate |
|---|---|---|---|
| `CLAUDE.md` | 4644 -> 4425 | 4.7% | PASS (56/56 Tier N) |
| `skills/vela-slides/SKILL.md` | 2814 -> 2772 | 1.5% | PASS (12/12) |
| `.claude/skills/vela-secure-coding/SKILL.md` | 4542 -> 4519 | 0.5% | PASS (54/54) |
| `.claude/skills/hyper-sprint/SKILL.md` | 8310 -> 8291 | 0.2% | PASS (108/108) |

**Important finding, flag to user**: every real file in this repo came in
FAR below the research doc's 20-30% first-pass target (0.2-4.7% actual).
Cause: this repo's instruction files are unusually dense/rule-heavy
already (high Tier N ratio, 70-90%+ in the security/sprint skills) —
little Tier M/E filler exists to cut. This is itself a valid, useful eval
signal (the skill correctly refuses to force cuts into Tier N — see each
agent's "already optimal" self-report) but means the token-reduction
upside on well-maintained repos may be small. Two implications to raise
with the user before investing more in the harness:
  1. The no-regression eval is still worth running (does even a small
     ~1-5% cut cause ANY compliance regression on the trap tasks?), but
     expected effect sizes on "cost/speed win" are now small for these
     specific files.
  2. Might be worth a 5th, deliberately looser/more verbose instruction
     file (something NOT already hand-tuned) to demonstrate the skill's
     upside ceiling — open question, not yet actioned.

## Next action

1. Surface the above finding to the user briefly (small-effect-size
   result on this repo's files) — do NOT silently proceed as if 20-30%
   was achieved.
2. Build the eval harness (task #5): run a task against baseline file vs
   `/minify`-produced file, fresh session each time, capture tokens/turns/
   tool-errors/success signal per eval-task-set.md's mechanical checks —
   runnable across all 4 committed target pairs now.
3. Build the blind randomized-order judge (task #6, separate model —
   leaning Opus — from the Sonnet task-executor).
4. Run first directional pass, audit results for bias per the checklist
   above.
