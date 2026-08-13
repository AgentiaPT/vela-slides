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

## Rate-limit throttle (2026-08-13, ~04:40)

User shared usage: 5-hour limit **91%**, resets in ~2h33m (~07:15); weekly
(all models) 70%; weekly Fable 75%; context window fine (78k/300k, 26%).
**Decision: hold off spawning Phase 6's pilot-run agents (3 reps ×
sonnet-under-test + opus judge, multiplied across scenarios — the most
agent-heavy phase in the plan) until the 5-hour limit resets.** Letting
the already-running Phase 5 completion agent (`a2caefbe6e75c35bb`) finish
since it's sunk cost and nearly done. Between now and reset: only cheap
work — verifying Phase 5's output, fixing the citation misattributions
(A/B/C, doc edits, no agents needed), context.md upkeep, no new
background agents unless something breaks. Resume Phase 6 after ~07:15
UTC or when the user confirms the limit has recovered, whichever first.

**Investigated (2026-08-13, ~04:55): can the orchestrator check the
5-hour/weekly plan-usage % itself, instead of needing the user to paste a
screenshot?** Short answer: **no free/safe way found from inside this
session; do not re-attempt without a real new idea.**
- Found via `strings` on the installed CLI binary that Claude Code has a
  documented `statusLine` feature whose script receives a JSON payload on
  stdin containing exactly this data (`rate_limits.five_hour.used_percentage`,
  `rate_limits.seven_day.used_percentage`, etc.) — this is genuinely the
  same data the user's screenshot UI renders.
- But that JSON is only generated when the **interactive terminal UI**
  redraws the status line. This session's entrypoint is `remote`
  (headless) — there is no interactive TUI here to trigger it.
- Tested whether `claude -p --output-format json` (a plain CLI call, no
  TUI) surfaces `rate_limits` anywhere in its structured result: **it does
  not** — the result JSON has cost/token/model usage but no rate_limits
  key. Checked debug/diagnostic logs on disk for the same field from
  calls already made: also absent — the raw rate-limit response headers
  never touch disk outside the live TUI-rendering path.
- **Cost of finding this out: real, not free.** The `claude -p` test
  call was not sandboxed — `CLAUDE_CODE_SESSION_ID` is preset in this
  container's environment, so the bare `claude -p` subprocess silently
  attached to and billed against **this same session**: confirmed via
  matching `session_id` in its own JSON result and a new turn pair
  appearing in this session's transcript. It cost **~$0.29** (per its own
  `total_cost_usd`) and ~48.9k real tokens (mostly cache-creation) against
  the 5-hour window this exact section exists to protect. Flagged
  transparently to the user rather than glossed over.
- **Conclusion for future reference:** there is no in-session, no-cost way
  to read the live 5-hour/weekly percentage. What remains available for
  free: `check-context.py` (exact context-window %, from transcript
  `usage` fields — unaffected by this issue) and post-hoc token/cost
  accounting from transcripts (see Cost tracking section) — but not the
  account-level rate-limit meter itself. That still requires the user to
  share it (chat message or screenshot) when it matters.
- **User declined further investigation** (2026-08-13): asked about
  firing a research agent to dig deeper, then retracted it unprompted —
  "forget it, let's keep focus, I'll wait for window reset." Treat this
  as closed, not just paused — don't re-raise or re-attempt this without
  the user bringing it up again.

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

## Backlog / possible improvements (NOT authorized, NOT scheduled — ideas only)

Distinct from the Phase plan above, which is locked. Items here are
future-work candidates raised in conversation; do not act on them without
either an explicit user go-ahead or a deliberate orchestrator decision
logged the same way Phase 1b/Autonomous-decisions were.

**Research-agent content-proxy / gisting layer (raised by user 2026-08-13,
prompted by seeing phases 1/1b/2 — all opus, all research-heavy — account
for over half of the ~$112 spent so far).**

*The idea:* research agents currently receive raw WebFetch/WebSearch
output directly into their (expensive, opus) context. Route large
external content through a cheap intermediate step first — either (a) a
**deterministic script** (fast, free, no model call — boilerplate/nav
stripping, main-content extraction, truncation) or (b) a **cheap sub-agent
"gist" pass** (e.g. sonnet/haiku reads the raw page against the specific
research question and returns a condensed extraction) — before it reaches
the expensive research agent's context. This is the same
compress-without-losing-needed-semantics problem `/minify` already solves
for instruction files, aimed instead at ephemeral research material.

*Why it's plausible:* directly explains this session's own cost profile
(opus research phases dominate spend) and is a known, general pattern —
cheap-filter-in-front-of-expensive-model cascades, and structurally the
same role LLMLingua plays in a prompt pipeline (cited in Phase 1's
research) — just moved from "compress the instruction prompt" to
"compress the fetched material before it becomes part of the prompt."

*Why it needs real caution before building, not just building it:*
- **(a) deterministic-script variant** risks silently dropping the one
  fact/number the agent actually needed — generic boilerplate-stripping
  doesn't know what's query-relevant. Same semantic-loss risk class this
  whole project exists to guard against, just on a different content type.
- **(b) gisting sub-agent variant** adds a second lossy hop between
  primary source and the claim that ends up in a doc. Phase 3 already
  found real citation misattribution (Findings A/B/C) happening *without*
  this extra hop, at full-content granularity — a paraphrasing gist step
  is a plausible new source of exactly that failure mode, possibly a
  worse one. Any prototype would need the same calibration discipline
  Phase 3 used (a fabricated-citation control test) applied to the gist
  step itself, and should almost certainly forbid paraphrasing numbers/
  quotes/citation IDs — treat those as C1-style byte-frozen spans that
  pass through verbatim with a source pointer, gist only the surrounding
  prose.
- **Net cost is not guaranteed positive.** A gisting call is itself a
  model call; for small pages the extra hop can cost more than it saves.
  Would need a size threshold (only gist above N tokens) and an actual
  before/after cost measurement — the same reduction.py-style measurement
  discipline already built for the minify skill — not an assumed win.
- **Scope creep risk for this project specifically.** `/minify`'s locked
  scope is instruction files (CLAUDE.md/SKILL.md/references), not a
  general research-ingestion tool. This would be a related but separate
  utility — worth keeping decoupled rather than folding into `/minify`
  itself, even though it could reuse pieces of `minify_lib.py` (frozen-
  span detection generalizes; the constraint-inventory extractor does not
  — research gisting needs a "claim inventory" analog, not a rule
  inventory, since the content being preserved is factual claims/citations
  rather than imperative rules).

*Status:* idea only, not designed, not built, not costed. If picked up
later, it should get its own research-and-design pass (mirroring Phase
1/2's structure: measure the actual failure/cost tradeoff before
committing to an approach) rather than being built ad hoc.

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
  - **Action item — DONE (2026-08-13, orchestrator, no agent needed).** All
    three re-attributed directly in `research-encoding-formats.md` §1.3
    (negation, position-bias, and Agent-Skills-discovery entries): each
    now cites the correct source for its specific number/quote, flips
    from UNVERIFIED to VERIFIED, and links back to this doc's Finding
    A/B/C. None of this touches the file's actual recommendation (rests
    on §3's measured probes, not the literature) — this only clears the
    literature review itself for eventual public citation.
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
- `.claude/minify-lab/harness/` — **DONE, independently verified**
  (2026-08-13; built across two sonnet agents, one killed mid-flight by a
  container restart and picked up by a completion agent,
  `a2caefbe6e75c35bb`). Orchestrator ran every module's own `--selftest`
  directly (not trusting the agent's self-report): **all 10 modules pass**
  (`prepare transcript assertions judge redact gate report reduction
  constraint_inventory runner`), and `git worktree list` confirms no
  worktree was left registered afterward.
  - **`frozen_ext` fix — confirmed genuinely wired, not just claimed.**
    Read `reduction.py` directly: `frozen_ext_fraction()` blanks fenced
    code, then inline code, then matches `https?://...` spans (which,
    confirmed by reading the code and its comment, also catches inline-
    link destinations and reference-style `[label]: url` lines — a single
    regex covers all three since fences/inline-code are already blanked
    out first). `prose_reduction_rate`/`predicted_reduction`/
    `hit_prediction` are wired into `measure_pair()`. The claimed
    regression test is real: `--selftest` contains explicit checks
    (`OLD binary rule would NOT have exempted the link-heavy file`, `NEW
    continuous prediction correctly marks the link-heavy file...`)
    proving the old binary verbatim-only exemption misses exactly the
    class of file phase 1b's corroboration study found broken.
  - **`runner.py`** (harness-design.md §8.1, the piece missing when the
    restart hit): `prepare_arm` → capture pre-agent `base_texts` →
    compose prompt → pluggable `invoke` (defaults to a real `claude -p`
    call, gated behind explicit CLI args — never triggered by anything
    else) → `transcript.parse_jsonl` → `post_run_diff` → `run_assertions`
    → unconditional `cleanup`. One documented, reasoned deviation from
    the literal spec: `transcript.jsonl`/`runner.err` are written to
    `run_dir`, not inside the worktree, to avoid the same
    diff-pollution bug already fixed for `anchors.json` in `prepare.py`.
    `--selftest` uses a stub invoke (zero model spend, confirmed — no
    real `claude` process runs during self-test).
  - **Constraint-inventory duplication — investigated, left unresolved on
    purpose, not glossed over.** The agent inspected `minify_lib.py`'s
    actual `survival()` return shape and found it's structurally
    different from what `reduction.py` already calls
    (`constraint_inventory.py`'s flat `net_delta/lost_count/
    weakened_count/newly_explicit_count` vs. `minify_lib.py`'s
    `Finding`-based `status`/`defects` list) — collapsing them needs a
    real findings→counts adapter plus a calibration cross-check, not an
    import rename. Correctly judged not worth a risky rewrite of an
    already-working, spec-matching, self-tested gate under time
    pressure; left a detailed TODO in `constraint_inventory.py` itself
    for whoever picks it up. This is a legitimate engineering call, not
    a shortcut — verified by reading both modules' actual code, not just
    the agent's explanation of it.
  - **Phase 5 is now CLOSED.** Stopped the `send_later` keep-alive
    check-in chain per its own stated stop condition.

## Session-isolation bug found and fixed in runner.py (2026-08-13, ~07:20-07:35, before Phase 6 started)

Before kicking off Phase 6's real pilot run, re-checked `runner.py`'s
`default_invoke` against the exact bug class that had just cost ~$0.29
during the rate-limit-check investigation (see "Rate-limit throttle"
section above): this container preseeds `CLAUDE_CODE_SESSION_ID` and
related vars, so a bare `claude -p` subprocess spawned without isolation
silently attaches to and bills against the *caller's own* running
session rather than starting fresh. Confirmed `default_invoke` had the
identical unguarded `subprocess.run(cmd, ...)` (no `env=`, inheriting
everything) — had this shipped, Phase 6's entire pilot would have
silently run against the orchestrator's own session instead of an
isolated one, corrupting both the run and this session's own token
accounting.

Fixed with two independent layers (defense in depth, not relying on
either alone):
1. `isolated_agent_env()` — copies `os.environ` and strips a new
   `_SESSION_ATTACHMENT_ENV_VARS` list (`CLAUDE_CODE_SESSION_ID` +
   6 related vars); passed as `env=` to the `subprocess.run` call.
2. Command construction split into a pure `_build_invoke_command()`
   (no side effects) so `--selftest` can assert on it for free: it now
   injects a fresh `--session-id <uuid>` and `--no-session-persistence`
   on every invocation.

Added 9 new zero-spend `--selftest` regression checks (asserting the env
strip and both flags) — all pass. Re-ran all 10 harness module
selftests directly (not trusted from any agent report) — all green.
Committed and pushed to `claude/autocompact-auto-w0dcer`
(`7035587`). Full detail intentionally kept out of the commit message
where it'd be excessive, but this is infra hygiene, not a security
disclosure — no discipline conflict with the security-fix-disclosure
policy (that policy is about vulnerabilities in *shipped Vela code*,
not this lab's own dev tooling).

## `/minify` verify tool bug found and fixed: `_best_match` mislocation (2026-08-13, ~08:00-08:40, blocking Phase 6's first real minified CLAUDE.md)

**What happened.** Before starting the real Phase 6 pilot, went to produce the
actual minified CLAUDE.md variant for the "telegraphic" approach (the existing
`variants/telegraphic/CLAUDE.md` turned out to be an explicit, self-documented
PLACEHOLDER, not real output — caught before any pilot spend, see "gaps found"
below). Ran the `/minify` skill's real 6-step pipeline (predict → plan →
inventory → rewrite → verify) on the repo's real root `CLAUDE.md`, touching
only genuinely low-risk C7 orientation prose and leaving every routing table,
version-bump section, and security-disclosure section byte-for-byte untouched.
`verify` REJECTED it (exit 4) on a single `K027 REVIEW quantifier-erosion:all`
finding — even though the flagged constraint's real sentence ("All in
`src/parts/part-engine.jsx`.") was never edited.

**Isolation technique that proved it was a tool bug, not a content bug:** ran
`verify CLAUDE.md CLAUDE.md --inventory <inv>` — i.e. verified the *unmodified*
baseline against an exact copy of itself (0.0% byte change). It STILL
REJECTED with the same K027 finding. A tool that rejects a perfect identity
"minification" cannot be reporting a real content defect — this is a
pre-existing bug in `minify_lib.py`'s matcher, unrelated to any edit.

**Root cause.** `_best_match()` (locates which unit/window of the *minified*
doc "is" a given constraint, so `survival()` can read modality/quantifier
tokens from the right place) tracks its single best-matching unit via a
plain `_coverage()` call, which uses `_matches()`'s deliberately lenient
prefix-fuzzy rule (needed so `documents`→`doc` still counts as surviving).
That same leniency lets a short, generic key like `"part"` prefix-match an
unrelated hyphenated compound like `"part-import"` or `"part-engine"` anywhere
the bare stem is reused — and this repo's CLAUDE.md is full of `part-*.jsx`
filenames, so K027's 2-key set (`{"part", "part-engine"}`) scored a false
1.0 coverage at ~88 different locations throughout the file (confirmed by
direct measurement). The old tie-break was implicit "first unit in file
order wins", which is arbitrary and had no reason to prefer K027's real,
unedited location over an early, coincidental one (it picked line 15 —
the Architecture diagram — over K027's real line 194/194 or its minified
equivalent).

**Fix (`_best_match` in `minify_lib.py`, ~35 lines changed, `_matches()`
itself left untouched)**: added `_coverage_exact()` — exact key-membership
only, no prefix fuzz — and made `_best_match` rank candidates by
`(exact_coverage, fuzzy_coverage, -distance_to_constraint's_original_line)`
instead of first-fuzzy-max-wins. An exact hit on the full compound token
(`"part-engine"` literally present) now always beats a location that only
has the bare stem `"part"` via fuzzy prefix match. The original-line
distance is a last-resort tie-break only (minification never reorders
sections, but absolute line numbers drift as earlier text is trimmed, so
it's not reliable as a primary signal — an earlier attempt using distance
alone as the *primary* criterion caused a *different* false match by
coincidentally aligning with an unrelated line after trims shifted
everything up).

**Why `_matches()` itself was NOT changed**: first attempted a narrower fix
directly in `_matches()` (reject a prefix match that lands exactly on a
hyphen boundary) — this fixed K027 but broke 3 previously-passing fixtures
(`probe-a known-good`, `links known-good`, `reworded rule valid attestation`),
because legitimate cases like `"code"`→`"code-review"` and
`"security-related"`→`"security"` are lexically identical in shape to the bad
`"part"`→`"part-engine"` case — no string-only heuristic on `_matches()` can
tell them apart. The real fix had to live in *selection* (`_best_match`), not
*matching* (`_matches`/`_coverage`), which stayed untouched and keeps its
existing (intentionally lenient) behavior for the file-wide present/lost
decision.

**New permanent regression fixture**: `fixtures/stem-collision.before.md` /
`.after.md` — a minimal, isolated repro (decoy paragraphs plainly reuse the
word "part"/"parts", the real rule is `All in \`parts/part-audit-hook.jsx\`.`,
completely unedited between before/after) that reproduces the bug cleanly
pre-fix (REJECTED, wrong match line) and passes cleanly post-fix. Wired into
`minify.py`'s `CASES` selftest registry as `"generic-stem prefix does not
steal a compound's match location"`. Selftest is now **17/17** (was 16/16).
Full repo test suite re-run clean too: `tests/test_vela.py` **503/503**
(unrelated to this change, run per the repo's mandatory-CI-check rule since
this touched git-tracked files).

**Result**: the real minified CLAUDE.md now verifies cleanly —
`57/57 present, 0 review, 0 lost, structure PASS`; size `1.5% byte cut /
1.0% token cut`, `MET-PREDICTION` against the file's own predicted
`0.0-7.9%` band (this file is already dense/telegraphic — see the phase-1
finding above; a small percentage here is the correct, honest outcome, not
underperformance). Landed in `variants/telegraphic/CLAUDE.md`; the
manifest (`variants/telegraphic/manifest.yaml`) and the previously-missing
judge rubric (`harness/prompts/judge-ab-rubric.md`, referenced by
`judge.py`'s `RUBRIC_PATH` but never created in phase 5) were also filled
in this session — both real Phase-5 completeness gaps that had been
signed off as "independently verified" but were not.

**Also caught before any spend**: the pre-existing `variants/telegraphic/
CLAUDE.md` was an explicit, self-documented PLACEHOLDER (1171 bytes vs the
real file's 18,301; an HTML comment stated outright it was not real
minified output and that producing it was Phase 6's job) — almost got used
as a pilot input before noticing. This is exactly the kind of catch the
standing "independently verify, don't trust self-report" discipline exists
to produce.

**User question worth logging for Phase 7+**: mid-session, the user asked
whether the skill should use AI (not just deterministic string-matching) for
verification, since skills run with real agency/tool access. Answered: the
pipeline is already a hybrid — steps 1-5 (predict/plan/inventory/rewrite) are
agent-driven judgment; step 6's `review` + `--attest` mechanism is the
sanctioned "AI makes and records a judgment call" gate. `verify` itself is
deliberately kept deterministic/zero-cost/zero-API-call so it can run in CI
and `selftest` instantly and for free, and so it doesn't reintroduce the same
self-grading-bias risk the whole eval harness exists to guard against (opus
judging opus). The K027 bug was a plain mechanical mislocation bug (fixed
deterministically above), not a case needing semantic judgment — but an
**optional AI-assist tier for genuinely-ambiguous `review` items** (as a
secondary confirmation, never a silent default) is a reasonable Phase 7+
idea, not in scope for this fix.

## Current status (last updated: 2026-08-13 ~10:10, campaign.py built + stub-tested + real-run smoke-tested, real Phase 6 pilot launched a 3rd time after fixing 2 launch-blocking bugs)

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
17/17 pass as of this session's matcher fix, was 16/16 before; spot-checked
its code for the frozen_ext fix: present). The `/minify` skill is real,
live, and discoverable in the skill listing.

**Phase 5 (harness scripts) landed and is independently verified** —
see the Artifacts index entry above for the full check (all 10 modules'
own `--selftest` re-run directly by the orchestrator, `frozen_ext`
confirmed genuinely wired with a real regression test, `runner.py`
matches the §8.1 design, constraint-extractor duplication investigated
and consciously left as-is with a documented reason rather than either
silently ignored or riskily merged). The `send_later` keep-alive chain
that was covering this wait has been stopped. Two real Phase-5
completeness gaps were found and closed this session (see the section
above): the judge rubric prompt (`prompts/judge-ab-rubric.md`) had never
been created despite `judge.py` referencing it, and the "telegraphic"
approach's `variants/telegraphic/manifest.yaml` (required by
`reduction.py`) didn't exist either.

**Phase 6 (first real pilot run) is IN PROGRESS, not yet launched.**
Rate-limit throttle held it until ~07:15 UTC (wall-clock estimate, not a
confirmed reading — the user declined further in-session investigation
into checking this directly, see "Rate-limit throttle" section; treat
that as closed). A pre-flight isolation bug in `runner.py` was found and
fixed before starting (session-attachment env-var leak — see the section
above). Producing the real minified CLAUDE.md then surfaced a second,
independent pre-flight bug — a false-REJECT in the `/minify` skill's own
`verify` matcher (`_best_match` mislocation) — found, root-caused, fixed,
covered by a new permanent regression fixture, and verified against both
`selftest` (17/17) and the full repo test suite (`tests/test_vela.py`
503/503). See the section immediately above for the full writeup.

**What's ready now**: a real minified `variants/telegraphic/CLAUDE.md`
that verifies cleanly (57/57 present, 0 review, structure PASS, size
MET-PREDICTION at 1.0-1.5%), AND `campaign.py` (the driver script —
loops `(scenario, arm, rep)` through `runner.run_one()`, runs the
redacted blind A/B judge per `(scenario, rep)` pair across
`judge_rounds`, calls `prepare.parity_check()` once per scenario,
aggregates metrics, assembles the `campaign.json` contract
`gate.py`/`report.py` consume). Committed at `f6f8ed9`. Verified in two
independent ways before any real scenario spend:

1. `campaign.py --selftest` (both the agent-under-test call AND the judge
   model call stubbed, zero API spend) — 15/15 checks pass, including a
   forced-quarantine path (an agent diff that itself touches `CLAUDE.md`
   correctly quarantines the pair instead of reaching the judge) and a
   full `gate.gate()` + `report.two_panel_report()` round-trip on the
   assembled campaign dict.
2. A real, non-stub smoke test — `runner.run_one()` called directly
   (bypassing `campaign.py`) with a tiny scratch-file scenario
   (max_turns=5, timeout=60s) and the REAL `claude -p` subprocess
   (`invoke=None` → `default_invoke`). Cost $0.207, completed in 1.9s,
   critical assertion passed. **Confirmed the session-isolation fix holds
   in a real run** (the standing instruction from the prior check-in): the
   sub-agent's transcript recorded `session_id
   e7f77fbe-e3d5-4e65-bfb9-6d4c7b6ecc50`, completely distinct from this
   orchestrator's own `CLAUDE_CODE_SESSION_ID=ea05cf82-...` — no
   attachment leak. `runner.err` was empty, no stray git worktree left
   behind afterward.

Also added `.claude/minify-lab/harness/runs/` to `.gitignore` (commit
`2f38246`) before running anything real — the blanket `!.claude/minify-lab`
un-ignore would otherwise force-track every campaign's raw transcripts/
diffs/cost data into this public repo; same treatment `evals/output/` etc.
already get.

**The real Phase 6 pilot launch found two more real bugs before it ever
reached agent spend** — the smoke test above only exercised
`runner.run_one()` directly; the first two attempts through
`campaign.py`'s own CLI wrapper hit code paths the smoke test didn't
cover. Both were caught at prepare-time (zero agent API spend lost each
time), independently verified, and fixed:

1. **`.gitignore` self-leak allowlist gap.** Launch 1 failed instantly
   with `leak_check_failed: True` on all 6 (arm, rep) combos —
   `prepare.py`'s §6.1 lab self-leak scrub flagged the new
   `.claude/minify-lab/harness/runs/` line added to `.gitignore` earlier
   this session (see above), because that exact line wasn't yet in
   `prepare.py`'s own `KNOWN_SAFE_MENTIONS[".gitignore"]` allowlist. Fixed
   by adding the line to the allowlist.
2. **Stale placeholder-collision assertion in `prepare.py --selftest`.**
   Running the harness's own selftest suite to sanity-check fix #1
   surfaced a second, pre-existing failure (confirmed via `git stash` it
   predates this session's edits): a test still asserted
   `variants/telegraphic/CLAUDE.md` has *no* token collision with the
   frozen scenarios' `leak_tokens`, left over from when that file was a
   placeholder stub. Now that it's the real minified output (built
   earlier this session), it legitimately inherits the same
   routing-table-symbol collisions the baseline has — a faithful
   minification preserves the routing table. Fixed by updating the
   assertion to expect the same collision set as the baseline. Full
   harness selftest suite (7 modules): 32/32 ALL OK afterward.

Launch 2 (properly backgrounded this time) got further — past both
prepare-time checks above — but failed with a **third, real bug**: a
`variant_leak_check` rejection on `variants/baseline/CLAUDE.md` itself,
citing token collisions from `routing-lookup`, `exporter-encoder-reuse`,
and `docs-only-versionbump` — three *unrelated* scenarios not even part
of this campaign. Root cause: `run_campaign()` was passing the *entire*
9-scenario file to `run_one()`'s `scenarios_for_leak_check`, but
`variant_leak_check()` scans a variant against every scenario's
`leak_tokens` in whatever list it's handed, not just the scenario
actually running. Those three scenarios have pre-existing, *documented*
token collisions with CLAUDE.md's own routing table (see `prepare.py`'s
module docstring "KNOWN FINDING") — `reducer-nohistory` itself is
explicitly documented there as unaffected, but was blocked anyway by
unrelated scenarios' tokens. Verified the diagnosis with a one-off check
that scoping to just `reducer-nohistory` returns zero collisions against
both variant files. Fixed by passing `chosen` (this campaign's own
scenario list) instead of `all_scenarios`; re-ran `campaign.py
--selftest` (15/15, unaffected — it already used a single-scenario
override) before committing. Commit `93119fa`.

**Launch 3 is now running in the background** (`reducer-nohistory`,
reps=3, both arms, judge_rounds=2, real sonnet agent-under-test + real
opus judge calls) after cleaning up launch 2's stale run directory. Per
the standing instruction: will message the user with a brief status
update once this completes with real results — not yet done, this is
the first attempt to get past prepare-time checks into actual agent
spend. Rough cost estimate before launch: order of magnitude $15-50 total
(6 sonnet agent runs on a real, moderately-sized code task + 6 short
single-turn opus judge calls) — not a hard budget, just the expectation
set going in.

## Session hygiene: checking context usage

Auto-compact is set to **300k tokens** for this session. To check actual
usage at any time (real reading from the live transcript's API `usage`
field, not a byte-count guess):

```bash
python3 .claude/minify-lab/check-context.py
```

Prints context tokens used, the 300k threshold, % used, and headroom.
Override the threshold with `--threshold N` if it's ever changed.

## Cost tracking (checked 2026-08-13, ~04:45)

Real token counts pulled from session transcripts (main thread
`~/.claude/projects/.../<session>.jsonl` + each subagent's own file under
`.../subagents/agent-<id>.jsonl` — subagents do NOT appear in the main
transcript, they have separate files). Dollar figures are an
**approximation using standard published Sonnet/Opus-tier per-token
rates** (input/output/cache-read/cache-write-5m/cache-write-1h) — not
confirmed actual billing for this account, since no `costUSD` field is
present in the transcripts. Treat as directional, not exact.

**Grand total so far: ~$112** (opus ~$71, sonnet ~$41) across main thread
+ 7 subagents, ~100M raw tokens moved (dominated by cache reads, which are
~10x cheaper than fresh input — this is expected and healthy, not a red
flag).

| Agent | Model | ~Cost | Phase |
|---|---|---|---|
| main thread | sonnet | $24.91 | orchestration (this conversation) |
| a79015f96541a6542 | opus | $28.94 | 1b — normal-density corroboration |
| ae01cc72c7db18a25 | opus | $22.43 | 1 — research encoding formats |
| a1c1264e443c7f11e | opus | $13.07 | 2 — harness design |
| a2caefbe6e75c35bb | sonnet | $7.10 | 5 — harness completion (running) |
| af4bf3c6dac8b3eb1 | opus | $6.96 | 4 — skill build (post-restart) |
| afc37b746c6251643 | sonnet | $5.46 | 5 — harness original build (killed) |
| ac2959171dddc90d5 | sonnet | $3.23 | 3 — citation verification |

Research phases (1, 1b, 2) dominate cost — expected, they're opus and
read the most source material. Re-check with the same method
(read main + subagent transcripts, sum `usage` fields) rather than
re-deriving from memory; agent IDs are stable and reusable across checks.

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
