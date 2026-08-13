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

## Decision (user, cont.)

User: "we should aim at least 20% reduction candidate on average before
eval." Locked in — average reduction across the eval-set files must be
>=20% before we proceed to build/run the harness. The 4 existing pairs
average ~1.7%, nowhere close. Response: don't force deeper cuts into the
same 4 dense files (would violate Tier N gate); instead find/add MORE
COMPRESSIBLE candidate files (prose-heavy references/docs, likely lower
Tier N density) to bring the eval-set average up, keeping the dense files
too (they're still valid "near-zero-upside" data points, just not the
whole set).

Dispatched a survey agent (aeb90f1cc8efe313b) which ranked candidate FILES
by compressibility (block-schema.md, SCREENSHOTS.md, design-patterns.md,
ARCHITECTURE.md — all prose-heavy, low Tier N density). Dispatched 4
parallel single-pass tiered-hybrid minify runs on those files
(ab8fc717867f2f692, ac2cd8fc8ad75462d, aa0da1d3ec21f5a6d, a11237671ace54f51)
— NOT yet returned, let these finish, their data is still useful.

**Correction from user** (2x): "by candidates I mean minifying
candidates" then "no, minifying approaches candidates, not specific
files." Misread this as "find more files" — actually means: compare
different COMPRESSION-STRATEGY/APPROACH candidates (the fallback ladder
from research-encoding-formats.md §3) against each other, on the same
file(s), and pick whichever approach clears >=20% honestly while still
passing the gate. Approaches to compare (escalating aggressiveness, each
still gate-checked, Tier N still untouchable at every rung):
  1. Current baseline: tiered-hybrid, conservative (what we've been doing)
  2. + aggressive Tier-E deletion (no rationale, 1 example max)
  3. + cross-file dedup via pointers for non-obligation content only
  4. + prose->DSL conversion for Tier M content still in full sentences
     (only where content is genuinely a lookup, per the skill's own
     DSL caveat)

## Status log (cont. 4) — conservative-pass results on 4 new files

Word-count-based reduction (all gate PASS, all committed):
| File | Reduction |
|---|---|
| `docs/ARCHITECTURE.md` | 7.6% |
| `docs/SCREENSHOTS.md` | 10.1% |
| `skills/vela-slides/references/block-schema.md` | 5.5% |
| `skills/vela-slides/references/design-patterns.md` | **24.4%** (clears target) |

design-patterns.md proves 20%+ IS achievable honestly on the right kind
of file (archetype-catalog prose, low Tier N). The other 3 need a more
aggressive approach-candidate to close the gap.

Dispatched 2 approach-variant agents (v2 candidates, NOT overwriting the
v1 conservative pass, so both remain comparable):
- `block-schema.min.v2.md` (a132ae9a6fae0e01c): aggressive Tier-E
  deletion + tighter Tier-M field-table compression.
- `ARCHITECTURE.min.v2.md` (ac7c31af32151dc7a): aggressive Tier-E
  deletion + cross-file dedup via pointer (non-obligation content only)
  + tighter comparison-table compression.
Not yet returned. (Did not re-run SCREENSHOTS.md yet — only 3 files
under 20%, prioritized the 2 largest/worst first; SCREENSHOTS.md v2 is
next if still needed after these land.)

## Bias finding: fix eval measurement, not just the files (important)

Caught and fixing a real measurement bias per the user's standing
"gradually fix bias" instruction:
- My earlier "24.4% for design-patterns.md" was computed by ME from raw
  `wc -w` word counts, NOT from the gate script's own token counter. It
  was wrong/misleading — the gate's own (consistent) counter puts that
  same file at **0.9%** reduction. Word/byte counts are NOT a valid proxy
  for token reduction on JSON-heavy files (JSON pretty-print whitespace
  removal shows up in word/byte counts but barely moves token counts).
  **Rule going forward: only trust `check_preservation.py`'s own reported
  token count, never a quick wc-based shortcut.**
- Attempted to install tiktoken for real BPE counts — package installs,
  but `tiktoken.get_encoding()` requires a network fetch of the BPE file
  from `openaipublic.blob.core.windows.net`, which this sandbox's proxy
  blocks (403). Real tiktoken counts are NOT available in this
  environment. Not chasing further — the approx (whitespace/punctuation
  regex) tokenizer is what every run so far has actually used (all
  "tiktoken" mentions in prior agent reports were aspirational labels in
  their prose, not what the script actually ran), so **all numbers below
  are on a consistent, comparable yardstick** even though not real BPE.

## Consolidated true numbers (gate's own approx tokenizer, re-verified 2026-08-13)

| File | Best candidate | Reduction | Gate |
|---|---|---|---|
| CLAUDE.md | v1 | 4.7% | PASS |
| skills/vela-slides/SKILL.md | v1 | 1.5% | PASS |
| vela-secure-coding/SKILL.md | v1 | 0.5% | PASS |
| hyper-sprint/SKILL.md | v1 | 0.2% | PASS |
| docs/ARCHITECTURE.md | **v2** | **22.8%** | PASS |
| docs/SCREENSHOTS.md | v1 | 8.2% | PASS |
| block-schema.md | **v2** | **31.5%** | PASS |
| design-patterns.md | v1 | 0.9% | PASS |

**Updated average across all 8 (best candidate each): ~8.8%.** Better but
still short of 20%. Two files now clear 20%+ (ARCHITECTURE v2 22.8%,
block-schema v2 31.5%), both via an aggressive v2 pass — ARCHITECTURE's
win came mostly from cross-file dedup via pointer, block-schema's from
combined aggressive Tier-E example-trimming + Tier-M table tightening
(cutting multi-item examples to 1, condensing prose to clauses). The 4
policy/rule files (CLAUDE.md, hyper-sprint, vela-secure-coding,
vela-slides SKILL.md) remain stuck near 0-5% — their own agent reports
consistently say they're 70-90%+ Tier N by content, i.e. genuinely little
non-obligation material exists to cut. design-patterns.md (0.9%) is
JSON-example-dominated similarly to block-schema before its v2 pass —
a good candidate for the same v2 treatment.

design-patterns.md v2 landed: **22.3%** (5248/6751 tokens), gate PASS,
18/18 Tier N preserved. Same aggressive-example-trimming approach as
block-schema, worked equally well — confirms the approach is repeatable
across JSON-example-heavy reference docs.

## FINAL consolidated numbers (all committed, all gate PASS)

| File | Best candidate | Reduction |
|---|---|---|
| CLAUDE.md | v1 | 4.7% |
| skills/vela-slides/SKILL.md | v1 | 1.5% |
| vela-secure-coding/SKILL.md | v1 | 0.5% |
| hyper-sprint/SKILL.md | v1 | 0.2% |
| docs/ARCHITECTURE.md | v2 | 22.8% |
| docs/SCREENSHOTS.md | v1 | 8.2% |
| block-schema.md | v2 | 31.5% |
| design-patterns.md | v2 | 22.3% |

**Average across all 8: ~11.5%. Still below the 20% target.** Clear
2-cluster pattern: 4 "reference/doc" files (ARCHITECTURE, SCREENSHOTS,
block-schema, design-patterns) average ~21.2% — the aggressive approach
gets 3 of 4 comfortably past 20%, SCREENSHOTS' 8.2% ceiling is honest
(half the file is functionally-distinct code samples, not padding). The
4 "policy/rule" files (CLAUDE.md, hyper-sprint, secure-coding, vela-
slides SKILL.md) average ~1.7% — genuinely near their compressibility
floor, confirmed independently by 2 separate agents per file across
conservative and (for some) aggressive attempts.

**User decision (2026-08-13): "Relax the 20% target to match the honest
average."** ~11.5% average across the 8-file eval set is accepted as the
final, honest number for this repo's already-dense instruction files.
No further minify-tuning effort on these 8 files. Eval set is LOCKED:

| File | Baseline | Minified (best candidate) | Reduction |
|---|---|---|---|
| CLAUDE.md | CLAUDE.md | CLAUDE.min.md | 4.7% |
| skills/vela-slides/SKILL.md | orig | SKILL.min.md | 1.5% |
| .claude/skills/vela-secure-coding/SKILL.md | orig | SKILL.min.md | 0.5% |
| .claude/skills/hyper-sprint/SKILL.md | orig | SKILL.min.md | 0.2% |
| docs/ARCHITECTURE.md | orig | ARCHITECTURE.min.v2.md | 22.8% |
| docs/SCREENSHOTS.md | orig | SCREENSHOTS.min.md | 8.2% |
| skills/vela-slides/references/block-schema.md | orig | block-schema.min.v2.md | 31.5% |
| skills/vela-slides/references/design-patterns.md | orig | design-patterns.min.v2.md | 22.3% |

Note: for the 4 files with both a v1 and v2 candidate, the harness
should use the v2 (best) file as "the minified variant" — v1s stay in
repo as intermediate data/history, not part of the eval pairs.

## Status log (cont. 5) — eval harness built (task #5 complete)

Built under `.claude/skills/minify/eval-harness/`: `file_pairs.json` (the
8 locked pairs above), `tasks.json` (all 17 tasks from eval-task-set.md
with mechanical regex `checks`), `prepare_trial.py` (isolates a git
worktree per trial, swaps in baseline/minified file keeping the same
filename so the agent-under-test can't infer condition from filename —
important anti-leakage property), `score_trial.py` (applies mechanical
checks to a captured result -> pass/violation/unclear verdict, appends to
`results.jsonl`), `cleanup_trial.py`, `README.md`. Smoke-tested on task
A1 both conditions — worktree isolation confirmed clean (real repo
untouched), byte-exact file swap confirmed, scorer verdicts confirmed
against synthetic pass/violation inputs. The actual "run an agent against
the prepared prompt" step is NOT automated inside the harness — it's the
outer orchestration layer's job (this session, using the Agent tool) per
design, since spawning agents needs this session's own tooling.
Committed.

## Next action

1. Re-apply the cross-file-dedup-via-pointer approach specifically
   (not generic "aggressive") to the two weakest large files —
   `block-schema.md` (6.7%) and `CLAUDE.md` (4.7%) — since both plausibly
   restate content available elsewhere (schema fields documented in
   `part-blocks.jsx` comments / `SAFE_BLOCK_KEYS`; CLAUDE.md dupes some
   secure-coding-skill content). Only dedup non-obligation restated
   content; never pointer-hide an obligation.
2. Recompute average after those 2 land. If still short of 20%, report
   the honest ceiling to the user rather than force it — this repo's
   files may simply not have another 20% of safely-removable content
   beyond cross-file dedup, and that itself is a valid, reportable
   finding (not a failure of the skill).
3. Once either >=20% average achieved honestly, or the honest ceiling is
   confirmed and reported to the user for a go/no-go: build the eval
   harness (task #5), then the blind randomized judge (task #6), then run
   first directional pass and audit for bias.
