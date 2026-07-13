# Orchestration model

Three roles, kept strictly separate. Confusing them is the main failure mode.

| Role | Who | Model / effort | Context |
|------|-----|----------------|---------|
| **Orchestrator** | the main loop | best model, high/xhigh | stays **lean** — plans, delegates, integrates, judges. Never does bulk implementation itself. |
| **Workers** | sub-agents | routed to task difficulty (below) | isolated; each gets one objective + its file set, returns a compact result. |
| **Validators** | sub-agents | routed by tier — cheap/mid for per-CR verifiers, **best model, max effort** for the broad cross-cutting hunters | **blind** — see only the spec + code at HEAD, never the sprint history. Default shape is hybrid (below). |

## Payloads to disk, pointers in the hub

A sub-agent's return value is **injected into the orchestrator's context and cache-read
every later turn** — so anything large a sub-agent produces (a recon map, a verification
log, a validator's raw output) must be **written to a file**; the agent returns only a
**compact index/verdict + the file path**. The orchestrator holds pointers; whoever needs
the detail (a worker, a later orchestrator step) reads that one file on demand, into a
context that's discarded when it's done. This is the single biggest lever on the cache-read
bill — it keeps the premium, always-re-read context tiny. Full enforceable checklist:
`references/hub-hygiene.md`.

- **Recon** writes its full `file:line` map to a file, returns `subsystem → files →
  one-line summary → map-path`. The orchestrator partitions from the index; each worker
  reads *its* map file directly (never via the orchestrator).
- **Never dispatch recon as an agent type without a `Write` tool** (e.g. `Explore`) when
  its deliverable is "write your findings to a file." An agent that can't write has no
  choice but to return its full findings inline — which lands directly in the
  orchestrator's own context, the exact thing this section exists to prevent, and then has
  to be manually re-written to disk by the orchestrator anyway (paying the write twice).
  Confirmed failure mode in one sprint: 2 of 3 recon agents were dispatched as `Explore`,
  both said so explicitly in their return ("no file-write tool available, reporting
  findings inline instead"), and the orchestrator had to re-transcribe them to files by
  hand. Use `general-purpose` (or any type with `Write` access) for any recon task whose
  prompt says "write to file X" — check the type has the tool *before* dispatch, not after
  the findings land in the hub.
- **Shared files must live at an absolute path outside any worktree** (a session scratch
  dir) — an uncommitted `NOTES/` file in the main tree is invisible to a worktree worker.
  Pass the path in.

## Orchestrator, not worker — orchestrator = thin

The main context is the most expensive and the most *biased* context in the run — it
accumulates every decision and every fixed bug. Protect it. **Hard budget: ≤50 main-loop
turns** (SKILL.md banner) — one sprint blew past that to **375 turns** because, after a
worker died on a session limit, the orchestrator absorbed its hands-on work instead of
spawning a replacement (~12 inline diagnostic/browser-driver scripts written and run in the
hub). Every hands-on task belongs to a sub-agent, always:

- **Delegate implementation.** Don't read whole files or write bulk edits in the main
  loop — spawn a worker. The orchestrator reads *recon summaries and worker results*, not
  raw source. This keeps its context small (cheaper, sharper) and, critically, keeps it
  from becoming the thing that later "verifies" its own work.
- **The orchestrator's job:** read repo config → synthesize recon → partition work →
  choose each worker's model/effort/isolation → dispatch → integrate results → run the
  suite → drive the blind stop-gate. That's it.

## Workers — contract & isolation

Each implementation worker gets: a crisp **objective**, its **anchored edit map**
(`file:line` + change), its **exclusive file set**, and "return a compact result: files
changed, tests added, `suite: pass|fail`, notes." It does the edits *and* its tests.

**Parallelize via worktrees, partition to avoid merge pain.** Cluster by file-locality so
concurrent workers touch **disjoint files**, each in its own git worktree. The
orchestrator merges sequentially, running the full suite between merges. Two workers that
must touch the same file is a signal to **serialize** them (one cluster), not to race
them. Prefer partition-by-module — then merges are trivial and conflicts near-zero.

**Fix workers verify via one `burst-bug-hunter` burst, not step-by-step interactive CLI.**
A fix worker's prompt must say so explicitly: reuse the implementer's driver verbs and
submit one multi-step burst script (open → act → assert → done) through the engine, the
same discipline as a validator round. Forbid falling back to the interactive
`playwright-cli-setup` skill for anything beyond 2-3 quick one-off checks — that skill is
documented as the ad-hoc/exploratory tool, and driving a fix's full verification through it
one LLM turn per CLI step (open, snapshot, click, snapshot, click, snapshot, eval, eval…) is
exactly the anti-pattern the burst engine exists to eliminate. Confirmed in one sprint: a
fix worker re-navigated a modal by hand through ~25 one-shot CLI round-trips (114 total tool
calls for a task that should have been one burst) — the two other fix workers in the same
sprint used one-off Node scripts instead, a defensible shortcut for a handful of checks, but
the interactive-CLI path is never defensible once the check count passes a handful.

## Model & effort routing

Match the model to the task; don't run everything on the flagship, don't run hard things
on a cheap one.

| Task | Model | Effort |
|------|-------|--------|
| Orchestration | best | high / xhigh |
| Recon (read-only mapping) | mid | low–medium |
| Mechanical worker (rename, scaffold, docs, config) | cheap/fast | low |
| Complex-logic worker (state, algorithms, concurrency) | best | high |
| Bug-hunt (broad, cross-cutting hunters) | best | high — cheap models miss subtle bugs |
| **Per-CR/cluster verifier** (checks one acceptance Verify) | **cheap/mid** | **low–medium** — a narrow, well-specified check; the flagship's edge is wasted on it, and running many of these in parallel on a cheap tier is what keeps the hybrid gate affordable |
| **Broad cross-cutting hunter (final validation)** | **best** | **max** — this is the emergent-bug catch-all; never economize here |
| **Pattern-mirroring / bounded mechanical fix** (clone an existing, fully-specified component; apply a named root cause + a specified guard/regex) | **cheap/mid** | **medium** — evidence, not a guess: in one sprint an Opus worker did a bounded guard-and-escape fix for $3.82, and a structurally identical follow-up fix ran on **Sonnet for $1.61** — the blind gate verified both correct. Reserve the flagship for the novel design/algorithmic work a pattern-mirror or bounded fix is not. |

The split matters: a per-CR verifier's whole job is "confirm this one acceptance Verify
and hunt only its own surface" — a narrowly scoped, mechanical-ish check that a cheaper
model does reliably. The one or two broad hunters are where subtlety and cross-cutting
judgment actually pay off, so that's where the flagship effort goes. The same logic
extends to implementation workers: if a worker's prompt can name the exact template to
clone or the exact root cause + fix to apply, it's mechanical-ish regardless of how the
code itself reads — route it cheap/mid and let the blind gate be the actual check on
whether it worked, not the model tier that wrote it.

## Isolated phase orchestration (nesting) — Build only, for now

Sub-agents can themselves dispatch sub-agents — `Agent` tool access is inherited by any
worker/validator type with `Tools: *`, confirmed working including correct result
propagation back up through multiple levels. This means **Phase 3 (Build)** can run as a
single nested dispatch instead of one dispatch per cluster: the sequential
dispatch→verify→next-cluster churn stays inside a disposable child context, and the
orchestrator pays only for one dispatch and one small structured result instead of
experiencing every cluster's cycle directly.

**Empirically validated, not theoretical, for Build specifically:** a simulated 2-cluster
sequential build (dispatch → verify → dispatch on the first cluster's output → verify)
cost the top-level orchestrator exactly **2 turns** end to end. The equivalent real work —
four sequential clusters, each with its own `TaskUpdate`/confirm-`Bash`/`ScheduleWakeup`
cycle — took **~45 orchestrator turns** in one sprint's Phase 3. Nesting the same work
would have cut that to ~2.

**Scope: adopt this for Phase 3 (Build) only.** Other phases (recon digest, readiness,
fix-round hunt, blind gate, report assembly) have been *discussed* as plausible nesting
candidates by the same reasoning, but none of them has been tested — don't nest them on
the strength of this result. If one gets validated the same way (a real or simulated dry
run measuring actual orchestrator turns saved), add it here as its own entry rather than
generalizing from Build's numbers.

### The contract the nested Build dispatch must honor

1. **No `SendUserFile` / `AskUserQuestion` inside any nested agent, at any depth.**
   Confirmed empirically: `AskUserQuestion` is not exposed to sub-agents at all — the call
   cannot be made. `SendUserFile` called from a sub-agent returns success but the file does
   not reach the user (2/2 test failures despite a success response) — treat it as a
   channel that does not work below the top level, not merely an unreliable one.
2. **Structured return only** — never a raw log, transcript excerpt, or diff:
   ```json
   { "phase": "...", "status": "done|blocked", "key_decisions": ["..."],
     "defects_found_and_fixed": ["sev: one-line"], "commits": ["hash: one-line msg"],
     "tests": "before -> after passed", "blocked_reason": null, "artifacts": ["path", "..."] }
   ```
3. **Escalate, don't loop.** If a cluster comes back blocked on something only a human can
   decide (an ambiguous spec point, a merge conflict the worker can't resolve safely), stop
   and return `{"status": "blocked", "blocked_reason": "..."}` to the parent rather than
   guessing. Only the top-level orchestrator can call `AskUserQuestion` — a stuck nested
   dispatch must bubble the decision all the way up, never attempt to route around it.
4. **Progress artifacts mid-build are rare and exceptional, never routine.** If the nested
   dispatch produces something genuinely worth surfacing before it finishes (a hard-won proof
   screenshot, a significant milestone), write ONE small file to a shared, session-scoped
   progress folder — never call `SendUserFile` itself (see #1). The top-level orchestrator
   watches that folder with a **bounded, single-fire `Monitor` tied to one expected file**
   (never a long-running watch spanning a whole phase) and delivers it itself via its own
   `SendUserFile`, the one confirmed-reliable path. Use sparingly: every event the
   orchestrator acts on still costs it a turn, and routine per-cluster chatter through this
   channel quietly reintroduces the exact turn-count bloat nesting exists to remove. The
   default remains the cheap compact-summary relay in #2 — this is the exception, not the
   norm.

## Blind validation — the stop gate

The whole point: **an unbiased judge that cannot have its verdict skewed by knowing the
work is "probably done."**

### Hybrid shape: verify-each + hunt-across

Two validator failure modes push in opposite directions, so the default gate runs both
shapes at once:

- **Pure broad validation** (a handful of validators each re-driving the *whole* app/
  surface) re-reads a context that grows with every feature it checks — expensive, and
  a tiring pass is more likely to skim the tenth feature than the first.
- **Pure per-change-request validation** (one narrow verifier per CR, nothing else) keeps
  each context small and focused, but by construction can't catch a bug that only shows
  up from two features *interacting* — no single verifier owns that surface.

The default, therefore, is **hybrid**:

1. **One small-context verifier per change-request/cluster.** Each gets only its own
   acceptance Verify (verbatim — see SKILL.md principle 5) + the code at HEAD + the drive
   recipe. It drives *only its own surface*, confirms the Verify, then hunts that surface
   for **X minutes**. Run these **in parallel**; scale the count to the number of CRs/
   clusters, capped by whatever parallelism limit the profile supports. Because each
   verifier's context stays small and never grows to cover the whole app, this tier can
   run on a **cheaper/mid model** (see the routing table) without losing rigor on the one
   thing it's checking.
2. **One or two broad adversarial hunters** with the **full** spec, whose job is
   specifically emergent/cross-cutting/integration/data-loss bugs — the class of defect no
   single per-CR verifier is positioned to see. These stay on the **best model, max
   effort** — this is where judgment under ambiguity earns its cost.

Both tiers are **blind** to sprint history regardless of scope narrowness.

**The tradeoff, stated plainly:** per-CR-only is cheaper and more focused per check, but
risks missing feature interactions; broad-only catches interactions but is the most
expensive tier to run at the rigor a stop-gate needs, and its cost grows with app surface
area, not with CR count. Hybrid pays for both, but at the per-CR tier's much lower cost
per check — it's cheaper *and* not less thorough than broad-only, provided the broad
hunters are still present for the emergent-bug class the per-CR tier structurally can't
cover.

### Running a round

**Precondition, every round, no exceptions: rebuild the offline render from current HEAD
immediately before dispatch.** Never reuse a render/workdir built for an earlier phase or an
earlier commit — this includes the fix-round hunt, blind-gate round 1, round 2, and any
targeted re-check after a fix lands. A validator driven against a stale pre-fix render
produces a false-positive re-report of an already-fixed bug, which is worse than a slow
build: it looks like a genuine "in-scope defect found" and can trigger a redundant blind
round on top of whatever round the real findings already required. Confirmed cause of the
one real orchestration mistake in one sprint: the render dir was reused across a bugfix
commit boundary, and two validators re-found the already-fixed bug. The fix costs one
rebuild command; skipping it costs an adjudication detour and erodes trust in the round's
verdict. Rebuild first, every time — don't reason about whether "this one" needs it.

Spawn fresh validator sub-agents whose prompt contains **only**:
1. the acceptance spec relevant to their scope — the full spec for broad hunters, one
   CR/cluster's Verify (verbatim) for a per-CR verifier,
2. the repository at **HEAD** (they inspect and run it themselves),
3. the **drive recipe** (the one committed boot+drive command) and the **known-intentional
   behaviors / acceptance nuances** — so a validator doesn't flag an intended design (e.g.
   "a hidden heading still labels the TOC") as a bug,
4. the task: *"Independently confirm each feature in scope is present and correct, then
   hunt for ANY bug for **X minutes, non-stop**. **Report the literal observed output, not
   an interpretation** (so two validators' contradictions are adjudicable without a
   re-run). Report pre-existing/out-of-scope issues **separately** — they don't fail the
   gate. Assume nothing is done until you've verified it."*

Two round-1 validators contradicting each other (one read `body.innerText` and saw the
occluded sidebar, the other read the overlay) forced a hand re-run to break the tie — items
3–4 above (shared recipe + literal observations) remove that. Validators in one round may
**share the harness bring-up** (the harness isn't the sprint history) but never share findings.

**Withhold, deliberately:** how many bugs were already found/fixed, how many turns/how
long the sprint ran, that it's "nearly finished," and the diff. A validator that knows "9
bugs were already fixed" anchors to "surely it's clean now" and stops looking; one that
knows the effort spent feels pressure to pass it. Give them the spec and the code, nothing
about the journey.

- **Diverse lenses** across the N validators (correctness, edge/boundary, data-loss,
  state/undo, security, does-each-feature-actually-exist) — spread across both the per-CR
  tier and the broad hunters.
- **Validators deposit, too:** each writes its full observations/repros to a file and
  returns a compact verdict (`pass|fail` + in-scope-defect list + path). The orchestrator
  reads a file only to **adjudicate a contradiction** — raw findings don't flood the hub
  (see `references/hub-hygiene.md`).
- If **any** validator reports a real issue → orchestrator dispatches a fix worker → then
  spawn a **brand-new blind round** (fresh agents, no memory of the prior round). Never
  reuse a validator that already saw the code — it's no longer blind. Keep the same
  hybrid shape on the new round unless the CR set itself changed.
- **Done only when** a full blind round of ≥ X minutes surfaces **zero** confirmed
  issues **and** every feature is confirmed present. That, plus the proof artifact, is the
  stop rule.

This replaces "run a few more 'final' hunts" (which the *same* biased context kept
declaring done). The gate is owned by agents who never saw the work happen.
