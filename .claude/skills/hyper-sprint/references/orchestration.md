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
- **Shared files must live at an absolute path outside any worktree** (a session scratch
  dir) — an uncommitted `NOTES/` file in the main tree is invisible to a worktree worker.
  Pass the path in.

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
| Bug-hunt (broad, cross-cutting hunters) | best | high — cheap models miss subtle bugs |
| **Per-CR/cluster verifier** (checks one acceptance Verify) | **cheap/mid** | **low–medium** — a narrow, well-specified check; the flagship's edge is wasted on it, and running many of these in parallel on a cheap tier is what keeps the hybrid gate affordable |
| **Broad cross-cutting hunter (final validation)** | **best** | **max** — this is the emergent-bug catch-all; never economize here |

The split matters: a per-CR verifier's whole job is "confirm this one acceptance Verify
and hunt only its own surface" — a narrowly scoped, mechanical-ish check that a cheaper
model does reliably. The one or two broad hunters are where subtlety and cross-cutting
judgment actually pay off, so that's where the flagship effort goes.

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
