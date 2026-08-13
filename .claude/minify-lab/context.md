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

## Standing rule: keep the main session alive during long background runs (added 2026-08-13, after a container restart killed phase 5 mid-flight)

A container restart killed the phase-5 background agent about 19 minutes
into a wait with zero foreground activity from the orchestrator (no tool
calls, nothing but waiting on one notification). Root cause is **not
confirmed** — no infra logs are visible from inside the session — but the
best-supported explanation given this environment's documented behavior
("container reclaimed after a period of inactivity") is that a long,
silent wait looks idle to the platform even though real work is
happening inside a background agent.

**Mitigation — best available tool, not proven sufficient, treat as
defense-in-depth alongside the git-commit persistence policy above, never
as a replacement for it:**
- Whenever a background agent is expected to run longer than ~10-15
  minutes, use `send_later` (`mcp__Claude_Code_Remote__send_later`) to
  schedule a self check-in message back into this same session, roughly
  12-15 minutes out. Its delivery is explicitly documented to survive
  container restarts, unlike a silent wait.
- When a check-in fires: check agent status (`ListAgents`, and read any
  notifications that already arrived), update this file if anything
  landed and commit/push per the rule below, and — if background agents
  are still running — schedule the *next* check-in before going idle
  again. This is a self-renewing chain, not a one-shot.
- Stop the chain once nothing is left running in the background.
- This does not replace committing WIP to git — if the mitigation fails
  and the container is reclaimed anyway, committed disk state is still
  the real safety net (as it was this time: everything phase 5 had
  written survived on disk and was recovered).

**User instruction (2026-08-13): "we want to avoid container restarts."**
Noted, but this session has no visibility into or control over the
platform's reclaim/restart policy — there is no infra API or setting
reachable from inside the session to change it. The `send_later`
check-in chain above plus the commit-before-waiting policy are the only
levers available from in here; both are already active. If restarts are
happening on a predictable cadence rather than pure idle-timeout, that
would need to be diagnosed/changed outside this session (host/platform
level) — flagging for the user rather than guessing further.

## Standing rule: never go idle without updating this file (reinforced 2026-08-13)

Every time the orchestrator is about to wait — for a background agent's
task-notification, for user input, for anything — **this file must
already reflect current reality first**: which phases are dispatched vs.
landed, what each landed agent actually produced (verified, not just its
self-reported summary), any decision made, any file committed. Waiting
with a stale context.md is exactly the failure mode that caused the
Incident above: the wait itself is when a container reclaim can hit.
Concretely, before ending a turn or going idle:
1. Update the relevant sections here (Phase plan, Artifacts index,
   Current status, Open questions/Autonomous decisions as applicable).
2. `git add`/`commit`/`push` this file, plus any new artifact — even
   partial/in-flight output from agents still running (see the WIP-
   snapshot commits in git log for the pattern: label them clearly as
   unreviewed/in-progress, review and re-commit properly once the
   producing agent's notification lands).
3. Only then wait/end the turn.
This is not optional busywork — it is the reason this project survived
being wiped once and must not need a third rebuild.

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

1. **[DONE — ⚠️ gate FAILED, see below]** Research candidate reduced-
   instruction encoding formats. Agent: opus, background. Output:
   `.claude/minify-lab/research-encoding-formats.md` — see Artifacts
   index. **Requires a user decision before phase 4/5 proceed** — see
   Open questions.
2. **[DONE]** Design the eval harness: new "real change-request
   task, baseline vs minified instructions" harness, porting judge/
   report/gate/harvest patterns from `evals/scripts/`; 7+ fully-specified
   CLAUDE.md scenarios; keep 6a (reduction pre-filter) and 6b (quality
   gate) as separate verdicts, never merged. Agent: opus, background.
   Output: `.claude/minify-lab/harness-design.md` — see Artifacts index.
1b. **[DONE]** Normal-density corroboration study. Agent: opus,
    background. Output:
    `.claude/minify-lab/research-normal-density-corroboration.md` — see
    Artifacts index. **Found a measurement bug affecting phases 4 and
    5** — correction messages sent to both live agents before they
    finished (see Artifacts index entry for detail).
3. **[DONE]** Citation verification pass on phase 1's external
   citations. Agent: sonnet, background. Output:
   `.claude/minify-lab/citation-verification.md` — see Artifacts index.
4. **[DONE, independently verified]** Build `.claude/skills/minify/`.
   Agent: opus. Output: `.claude/skills/minify/` — see Artifacts index.
5. **[dispatched]** Build harness scripts under `.claude/minify-lab/
   harness/` per phase 2's design, amended with the split size/structure
   6a verdict (see Autonomous decisions). Agent: sonnet. Constraints: no
   real `claude -p` runs yet (separate gated step, costs real budget),
   self-test with synthetic fixtures only.
6. **[ ]** First real pilot: CLAUDE.md baseline vs minified — 3 reps,
   sonnet as agent-under-test, opus blind judge (budget locked above).
7. **[ ]** Expand to additional skills (candidates: hyper-sprint,
   vela-secure-coding, vela-slides skill docs).
8. **[ ]** Continuous bias/leak audit per watchlist; fix and re-run as
   issues surface.

## Artifacts index

- `.claude/minify-lab/research-encoding-formats.md` — **DONE**
  (2026-08-13, opus, ~1090 lines). **Contradicts the lost prior
  session's over-optimistic ~30%-average projection** — this rigorous
  redo measured, not estimated, and found:
  - **This corpus is already pre-compressed.** Function-word ratio
    21.5/24.5/27.5% (CLAUDE.md / secure-coding / hyper-sprint) vs ~44%
    for ordinary prose — the author already writes telegraphically.
  - **16.5% of the corpus is legally frozen** (fenced/inline-code
    verbatim spans: commands, paths, symbols, DSL) — 0% budget.
  - **5 hand-minification probes, 100% constraint survival, pooled 10.3%
    byte reduction** (8,566→7,687 B); max-aggression single probe hit
    18.3%.
  - **Projected whole-corpus reduction: ~7.6% from rewriting alone,
    ~13–15% with aggressive (risky) restatement pruning.**
  - **❌ The ≥20% reduction gate does NOT clear on this corpus.**
    Explicitly does NOT recommend closing the gap by loosening the
    100%-constraint-survival standard.
  - **#1 approach unchanged: Typed Rule Blocks** (`WHEN/SCOPE/MUST/
    NEVER/DO/EXC/WHY/TEST/REF` key-value blocks, telegraphic values,
    byte-frozen verbatim zones, explicit quantifier/modality tokens) —
    but its value here is **correctness/enforceability, not bytes**:
    probe B cut only 4.6% while turning 3 implicit quantifiers explicit,
    a real defect-prevention win the eval harness should be built to
    detect. Ruled out: symbolic/predicate notation, learned/soft
    (LLMLingua-style) compression.
  - **3 options given, in the researcher's recommended order**: (1)
    re-measure the same probe protocol against a pre-registered
    normal-density corpus (~6 files, function-word ratio ≥35%) to learn
    whether the gate is wrong about the approach or right about these
    specific already-dense files; (2) split 6a into separate `size`
    (≥20%, with a documented exemption for pre-densified files) and
    `structure` (constraint-explicitness score) verdicts — probe B fails
    (a) at 4.6% but passes (b) decisively, and merging them hides that
    signal; (3) only if 1 and 2 both fail, reconsider the project's
    premise for this repo (CLAUDE.md is always-resident every session,
    unlike SKILL.md bodies that load on trigger — honest available
    prize there alone is ~1.1 KB).
  - **22 risks flagged (R1–R22)**, each with a detection method,
    covering the full brief. Top build priority: an enumerated
    constraint-inventory extractor with 1:1 survival mapping (needed
    regardless of which gate option is chosen).
  - All external literature citations tagged ⚠️ UNVERIFIED (snippet-only,
    arXiv egress-blocked) and explicitly **not load-bearing** — the
    recommendation rests entirely on the 5 measured probes.
- `.claude/minify-lab/research-normal-density-corroboration.md` —
  **DONE** (2026-08-13, opus, 894 lines). Pre-registered 6 real external
  files (atom/atom, nodejs/node, kubernetes/community, google/styleguide,
  github/awesome-copilot, openai/codex AGENTS.md) and **committed that
  list to git before fetching any of them** — strong anti-cherry-picking
  proof. **Two-part verdict, both halves load-bearing**:
  - ✅ **YES**, TRB clears ≥20% comfortably on normal-density *normative
    prose* — 27.4% pooled on 2 independent probes (node.js 27.2%, k8s
    27.5%), 100% constraint survival. Phase 1's ~7.6% was a ceiling on
    *that input* (this repo's already-dense files), not on the approach
    — same technique gets ~2.7× the yield on ordinary-density text.
  - ⚠️ **NO**, not reliably, on whole real-world *files* — projected
    16.4% across all six pre-registered files, 19.6% across the three
    that were actually normal-density (as predicted). Real files are
    only partly normative prose; the rest is frozen machinery the
    minifier legally cannot touch.
  - **Root cause, ranked**: (1) frozen-content fraction dominates and
    caps the achievable ceiling regardless of rewriting quality — one
    file at 72.5% frozen has a 6.9% ceiling no matter how good the
    minifier is; (2) function-word ratio predicts the rest at r≈0.98 —
    compressibility is measurable *before* minifying; (3) genre, not
    this repo's authorship, drives pre-densification — 2 of 6 unrelated
    real-world files measured *denser* than this repo's own docs.
  - **Live bug found and escalated, corrections sent to phases 4 and 5
    mid-flight (see below) rather than waiting to fix after the fact**:
    `verbatim_fraction` (phase 1's Appendix definition, inherited by
    both the skill's frozen-zone rule and `reduction.py`) counts only
    fenced/inline code. **URLs and markdown link-reference definitions
    are equally byte-frozen and were being counted as compressible
    prose** — on one test file this flips the frozen fraction from 5.0%
    to 37.5% and flips the file's projection across the gate entirely.
    Both must extend frozen-span detection (and the byte-exact survival
    check) to URLs/link-destinations/link-reference definitions —
    proposed the renamed metric `frozen_ext` to mark the fix.
  - **Gate recalibration recommendation, adopted** (refines this
    session's earlier Autonomous decision — see below): replace the
    binary pre-densification exemption with a continuous per-file
    prediction, `expected_reduction ≈ (1 − frozen_ext) × prose_rate(fw)`,
    and judge the size sub-verdict as "did the file hit its own
    predicted reduction" rather than a flat 20%. Report the file-level
    and section-level (rules-only) numbers side by side — merging them
    hides the same signal the earlier size/structure split was created
    to preserve.
  - **Skill-framing implication**: `/minify` must predict and state a
    per-file adaptive range before minifying (from `frozen_ext` +
    function-word ratio), then be judged against hitting that
    prediction — never a flat percentage claim, which this study shows
    is wrong on 4 of 6 real files measured. This is also the answer to
    "world-record" framing: predicted-and-delivered, per file, beats an
    unachievable flat number.
- `.claude/minify-lab/citation-verification.md` — **DONE** (2026-08-13,
  sonnet). Calibrated method first against a fabricated control citation
  (correctly reported not-found) before trusting it on real ones. **10
  clusters / 15 sources checked: 0 fabricated, 0 contradicted, 7 fully
  verified, 3 carry a misattribution** (real papers exist, but a specific
  number/quote is attached to the wrong one of them):
  - **A**: the "50% of context window" position-bias figure is cited to
    arXiv 2510.10276 but actually belongs to arXiv 2508.07479 (Veseli et
    al., COLM 2025), uncited.
  - **B**: the Agent Skills "median ~80 tokens" figure is labeled
    "(Anthropic platform docs)" but that page states a flat ~100
    tokens/skill with no median/range — the 80-token figure traces to a
    third-party analysis (SwirlAI 2026), not Anthropic's own docs.
  - **C**: the negation "mechanisms overshadowed at later layers" quote
    is attached to two sources that don't contain it; appears to
    originate in an uncited third paper (arXiv 2605.03052).
  - **Action item, not yet done**: re-attribute or drop these three
    numbers/quotes before they appear in the `/minify` skill's own docs,
    a PR body, or any other public-facing text. None of this touches
    research-encoding-formats.md's actual recommendation (rests on §3's
    measured probes, not the literature) — this only clears the
    literature review itself for eventual citation.
- `.claude/skills/minify/` — **DONE, independently verified** (2026-08-13,
  opus). This is the actual `/minify` skill, live and discoverable (it
  now appears in the session's skill listing). Orchestrator ran its
  selftest directly rather than trusting the self-report: **16/16
  fixture cases pass**, confirmed firsthand. Spot-checked
  `minify_lib.py` directly for the frozen_ext correction — confirmed
  present: `frozen_fraction()` explicitly covers 5 span kinds ("fence,
  inline (code), url (bare or `[text](url)`)..."), docstring cites the
  exact "5.0% -> 37.5% frozen" example from the phase 1b study. No real
  repo file touched, no `VELA_VERSION` bump, no `git commit` by the
  agent — all constraints honored.
  - **Structure**: `SKILL.md` (frontmatter matches this repo's
    `hyper-sprint`/`dependency-sweep` convention) + `scripts/
    minify_lib.py` (1245 lines, stdlib only) + `scripts/minify.py` (CLI:
    `plan · inventory · predict · measure · verify · selftest`, exit
    codes 0-5 matching this repo's own `vela.py` convention) +
    `references/{trb-format,content-classes,failure-modes}.md` +
    `fixtures/` (22 files: 3 hand-verified probes from research §3, a
    link-heavy pair testing the frozen_ext fix, one deliberately-damaged
    variant per failure class, 2 attestation JSONs).
  - **The tool never edits or decides — it measures, enumerates, and
    verifies.** The rewriting is left to whoever (agent or human) runs
    it; the tool's job is to make dropping a constraint impossible to
    ship unnoticed.
  - **Constraint-inventory extractor** (the top build priority flagged
    by research): splits source into units, freezes verbatim spans
    (fence/inline-code/URL/link-destination/link-reference-definition —
    the frozen_ext fix), emits one record per normative statement
    (stable id, modality with strength, quantifier set, content class,
    distinctive-token keys, atoms: verbatim spans/numeric literals/
    reference edges/parentheticals/exceptions), sha256-bound to its
    source. After minifying, `verify` locates each constraint's best
    window in the output and reports per-constraint defects
    (`verbatim-missing`, `numeric-drift`, `reference-dropped`,
    `enum-item-missing`, `modality-weakened:X->Y`, `polarity-flipped`,
    `hedge-hardened`, `quantifier-erosion`) plus global atom failures.
    Any `lost`/`review` status or atom failure rejects the run.
  - **Two verdicts, never merged** (exactly the shape locked in
    Autonomous decisions): SIZE reports bytes, both token proxies,
    achieved cut, **the predicted range with its formula** `(1 −
    frozen) × prose-rate(function-word)` (not a flat percentage claim —
    matches the correction sent), density, the flat 20% bar as
    reported-not-gated, and a result of FAIL-GREW / IMPLAUSIBLE /
    BELOW-, MET-, or ABOVE-PREDICTION. STRUCTURE reports constraint
    tally, atom failures, reference edges, frontmatter PASS/REJECTED,
    and `structure_score = explicit_gain − constraints_lost` (must be
    ≥0) with a PASS/REJECTED result.
  - Frontmatter `description` is in a hard-frozen key set, confirmed in
    code (`FROZEN_FRONTMATTER_KEYS`).
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

## Current status (last updated: 2026-08-13, phases 1+2 landed, user went AFK, 4 more dispatched)

Container reclaim wiped all prior artifacts; rebuilt from scratch per the
user's choice (full re-run, not summary-reconstruction). Phases 1 and 2
are both **DONE** — full summaries in Artifacts index. Phase 1's rigorous
redo overturned the lost prior session's conclusion: the locked ≥20%
reduction gate does NOT clear on this repo's actual files (already
dense/telegraphic; measured ~7.6–15%, not ~30%). Started to surface this
as a blocking question, but the **user went AFK mid-turn and explicitly
authorized proceeding on best judgment without asking further questions**
("don't block, continue with best judgment, make this a world-record
minifying skill") — see "Autonomous decisions" above for exactly what was
decided and why.

Phases 1, 1b, 2, 3, and now **4 are all DONE**, each independently
verified (not just self-report — ran phase 4's own selftest firsthand:
16/16 pass; spot-checked its code for the frozen_ext fix: present). The
`/minify` skill is real, live, and discoverable in the skill listing.

**Phase 5 (harness scripts) is still running** — not yet landed. It has
already picked up further progress on `constraint_inventory.py` and
`reduction.py` since the frozen_ext correction was sent; not yet verified
whether the correction was actually incorporated there too (only
confirmed for phase 4 so far) — check explicitly when phase 5's
completion notification lands, don't assume symmetry. In-flight output
continues to be snapshotted to git as unreviewed WIP commits per the
Standing rule.

Remaining after phase 5 lands: resolve the flagged constraint-extractor
duplication between the skill's own (`.claude/skills/minify/`, now the
canonical, verified implementation) and the harness's
`constraint_inventory.py` — the harness should very likely import/reuse
the skill's version rather than keep a second one; check what phase 5
actually did. Then phase 6 (first real pilot — budget already locked: 3
reps, sonnet agent-under-test, opus judge) becomes unblocked.

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

- None currently blocking. (Prior gate question below was resolved
  autonomously per the user going AFK — see "Autonomous decisions".)

## Autonomous decisions (user went AFK, told orchestrator: "don't block,
use best judgment, make this a world-record minifying skill")

- **Gate resolution (2026-08-13)**: adopted the research doc's own
  recommended options **1 + 2 together** (not asked to the user — they
  were AFK; this is the lowest-risk reading of "best judgment" because
  neither option touches the 100%-constraint-survival bar):
  1. **6a splits into two sub-verdicts**: `size` and `structure`
     (constraint-explicitness score: quantifier/modality tokens made
     explicit, minus constraints lost). Merging them into one number was
     hiding the real signal (probe B: 4.6% size, decisive structure
     win). **[REFINED 2026-08-13 by the phase 1b corroboration study —
     see its Artifacts entry]**: the original binary exemption (verbatim
     fraction >25% OR function-word ratio <30%) is superseded by a
     continuous per-file prediction, `expected_reduction ≈ (1 −
     frozen_ext) × prose_rate(fw)`, with `size` verdict = "did the file
     hit its own predicted reduction" rather than a flat 20% check.
     `frozen_ext` extends the old `verbatim_fraction` to also count URLs
     and link-reference definitions (a measurement bug phase 1b found —
     both were still counted as compressible prose). Correction messages
     were sent to the live phase 4 and phase 5 agents mid-flight so the
     fix lands in the first build rather than a costly rework pass.
  2. **Commissioned a normal-density corroboration study** (new agent,
     not yet in original phase list) — pre-register ~6 typical
     instruction files (function-word ratio ≥35%, i.e. NOT already
     telegraphic like this repo's) and re-run the same probe protocol,
     to learn whether ≥20% is achievable in general. This is what makes
     the "world-record" framing honest: if the approach clears 20%+
     cleanly on normal-density text while still hitting 100% survival on
     this repo's already-dense text, that adaptive range (aggressive
     where there's fat, surgical where there isn't, always
     survival-safe) is the actual competitive claim — not a flat
     percentage. **No superlative/"world record" claim goes in any
     artifact, doc, or the skill's own text without a number to back
     it** — same discipline already locked for citations. "World-record"
     is direction/ambition, not a claim to assert unverified.
  3. Did NOT adopt option 3 (reconsider the project's premise) — the
     first two options are cheap, non-destructive, and the user's AFK
     instruction reads as "keep going," not "reconsider scope."
- Dispatched phases 3, 4, 5 and the new normal-density study in parallel
  rather than sequencing on the gate answer, since none of their designs
  actually depend on *which* gate option was chosen — TRB's mechanics
  and the constraint-inventory extractor are unaffected either way.
- **Known follow-up, not yet reconciled**: the constraint-inventory
  extractor (flagged in research §6 as the top build priority) was
  requested from BOTH phase 4 (skill's own self-check) and phase 5
  (harness `assertions.py`) in parallel to avoid blocking either on the
  other. Expect two implementations to reconcile into one shared module
  once both land — orchestrator must do this explicitly, don't let it
  silently stay duplicated.
