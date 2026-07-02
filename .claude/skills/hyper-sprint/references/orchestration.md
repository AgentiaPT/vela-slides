# Orchestration model

Three roles, kept strictly separate. Confusing them is the main failure mode.

| Role | Who | Model / effort | Context |
|------|-----|----------------|---------|
| **Orchestrator** | the main loop | best model, high/xhigh | stays **lean** — plans, delegates, integrates, judges. Never does bulk implementation itself. |
| **Workers** | sub-agents | routed to task difficulty (below) | isolated; each gets one objective + its file set, returns a compact result. |
| **Validators** | sub-agents | **best model, max effort, always** | **blind** — see only the spec + code at HEAD, never the sprint history. |

## Orchestrator = thin

The main context is the most expensive and the most *biased* context in the run — it
accumulates every decision and every fixed bug. Protect it:

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

## Model & effort routing

Match the model to the task; don't run everything on the flagship, don't run hard things
on a cheap one.

| Task | Model | Effort |
|------|-------|--------|
| Orchestration | best | high / xhigh |
| Recon (read-only mapping) | mid | low–medium |
| Mechanical worker (rename, scaffold, docs, config) | cheap/fast | low |
| Complex-logic worker (state, algorithms, concurrency) | best | high |
| Bug-hunt | best | high — cheap models miss subtle bugs |
| **Final validation** | **best** | **max** — this is the gate; never economize here |

## Blind validation — the stop gate

The whole point: **an unbiased judge that cannot have its verdict skewed by knowing the
work is "probably done."**

Spawn fresh validator sub-agents whose prompt contains **only**:
1. the full acceptance spec — every change request + its acceptance criteria,
2. the repository at **HEAD** (they inspect and run it themselves),
3. the task: *"Independently confirm each feature is present and correct, then hunt for
   ANY bug for **X minutes, non-stop**. Report every missing/incorrect feature and every
   bug with a concrete repro. Assume nothing is done until you've verified it."*

**Withhold, deliberately:** how many bugs were already found/fixed, how many turns/how
long the sprint ran, that it's "nearly finished," and the diff. A validator that knows "9
bugs were already fixed" anchors to "surely it's clean now" and stops looking; one that
knows the effort spent feels pressure to pass it. Give them the spec and the code, nothing
about the journey.

- **Best model, max effort, diverse lenses** across the N validators (correctness,
  edge/boundary, data-loss, state/undo, security, does-each-feature-actually-exist).
- If **any** validator reports a real issue → orchestrator dispatches a fix worker → then
  spawn a **brand-new blind round** (fresh agents, no memory of the prior round). Never
  reuse a validator that already saw the code — it's no longer blind.
- **Done only when** a full blind round of ≥ X minutes surfaces **zero** confirmed
  issues **and** every feature is confirmed present. That, plus the proof artifact, is the
  stop rule.

This replaces "run a few more 'final' hunts" (which the *same* biased context kept
declaring done). The gate is owned by agents who never saw the work happen.
