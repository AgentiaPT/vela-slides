---
name: hyper-sprint
version: 2.1
created: 2026-07-03
description: >-
  Run a full "implement + test + verify a batch of change requests to zero bugs"
  sprint in one session as a thin orchestrator that delegates implementation to
  sub-agents (routed by task difficulty, isolated in worktrees for parallel work)
  and gates completion on an independent BLIND validation by the best model. Use
  when handed a list of changes/issues (a PDF, ticket list, or spec) to implement,
  test, and prove working end-to-end — stop rule "a blind best-model hunt finds no
  bugs + a proof artifact (a Markdown sprint report by default; recorded demo optional)".
  Repo-agnostic; reads a root `.hyper-sprint/config.md` for
  repo facts; front-loads app/browser readiness so verification never stalls.
---

# Hyper Sprint

Deliver a batch of changes to a **verified zero-bug** state in one session, cheaply.
This skill replaces an ad-hoc "implement everything and test it" prompt.

## Orchestration model (full detail: `references/orchestration.md`)

Run as a **thin orchestrator** on the best model — plan, delegate, integrate, judge;
**never do bulk implementation in the main context** (it burns the premium context and
biases the final gate). Three separate roles:

- **Orchestrator** (main loop, best model): reads *recon summaries + worker results*, not
  raw source; partitions work; routes each worker's model/effort/isolation; drives the gate.
- **Workers** (sub-agents, model routed to difficulty): one objective + exclusive file set
  each; disjoint clusters run in parallel **git worktrees** (partition-by-module → clean
  merges); orchestrator merges sequentially, suite green between merges.
- **Validators** (**best model, max effort, BLIND**): own the stop gate — see only the spec
  + code at HEAD, never the sprint history (*Stop rule*). Default shape is **hybrid**: a
  small-context verifier per change-request/cluster, plus one or two broad cross-cutting
  hunters (*verify-each + hunt-across* — see *Stop rule*).

## Operating principles (the economy rules)

1. **Readiness before features (hard gate) — inline it when the env is pre-provisioned,
   sub-agent it when bring-up is uncertain.** When a setup script / container image /
   prebuilt artifact already provisions the environment, the fast boot+smoke gate is cheap
   and deterministic — the **orchestrator runs it itself**, inline, and moves on; spawning a
   sub-agent for a 20-line, already-solved probe just adds a round-trip. Spawn a **dedicated
   readiness sub-agent** only when bring-up is genuinely uncertain (undeclared deps, a first
   boot on this box, an unfamiliar stack) — its build + dep-provision + boot + smoke-test
   trial-and-error is then pure noise to the hub, so it must return only a compact verdict
   (`ready | blocked` + reason) and the **path to a persisted entrypoint file** — the ONE
   boot+drive command plus the baseline (passing count, known-failing tests) and any
   gotchas, which workers/validators reuse verbatim. Either way, it must **smoke-test every
   surface the sprint will verify** (e.g. the primary view, a secondary mode, a dialog), not
   just that it boots once — latent harness bugs surface at minute 5, not hour 2, if you
   only check the happy path. The blocked-CDN SPA-boot recipe is one example (`references/
   agent-profiles.md`). Orchestrator **hard-gates on `blocked`**; if the app can't run here,
   agree the fallback (unit-only + manual checklist) with the user.
2. **Recon in parallel, once — deposit detail to files, return only a pointer.** A
   sub-agent's return value is pinned in the orchestrator's context and cache-read *every
   later turn*, so a recon agent must **write its full line-anchored map (`file:line` + what
   changes) to a file** and **return only a compact index** (subsystem → files → one-line
   summary → map path). The orchestrator partitions from the index (pointers, not payloads);
   each **worker reads its own map file directly** into its isolated context. Put the shared
   notes at an **absolute path outside any worktree** (a session scratch dir) so worktree
   workers can read them, and pass that path in.
3. **Hub hygiene: payloads to disk, pointers + verdicts in the hub (HARD RULE).** The
   orchestrator must **never** read a worker's diff, a screenshot, or any large doc into the
   main loop — it trusts the worker's pasted test-summary + one-line verdict, and re-drives
   only **by exception**, via a cheap sub-agent that returns a bare pass/fail (not the raw
   artifact). Frame-checks and one-off lookups (a pricing page, a doc for one config flag, a
   single number buried in a giant reference) are **delegated**, never fetched/read directly
   in the hub. *(Example run: in one measured sprint the orchestrator alone was ~62% of total
   spend and ~96% of its tokens were cache-reads — almost all of it the hub re-absorbing
   worker payloads on every later turn. This is generally the single biggest cost lever
   available; it is not specific to that run.)* Enforceable checklist and re-drive-by-
   exception recipe: `references/hub-hygiene.md`.
4. **Cluster by file-locality, not by ticket number.** Group changes that touch the
   same files into one work item so edits don't collide and each item is independently
   testable — and so clusters with **disjoint file sets** can run as parallel workers in
   separate worktrees. Track them with the task tool; keep the list live.
5. **Test-as-you-go, never batch-at-end.** Each change lands with its unit and/or e2e
   test in the *same* step; a fix with no test is not done. Re-run the suite after **every**
   fix (a fix can regress the thing it fixed). **Workers receive the acceptance Verify
   verbatim** (the exact acceptance text for their change requests, not a paraphrase) and the
   **cluster-boundary check asserts against that same text** before merge — a paraphrase
   drifting from the spec is exactly what surfaces as an integration-time surprise later.
6. **One canonical verify command; trust green, re-drive by exception.** The biggest
   main-loop turn-inflator is the orchestrator re-verifying every worker by hand. Define a
   *single* repo verify entrypoint; **workers paste its real output** and the orchestrator
   **trusts a green standardized run**, re-driving only on a worker's explicitly-flagged
   uncertainty. And **never hand-write bespoke drivers in the main context** — each ad-hoc
   script sits in the premium context and is re-read (cache-read tax) every later turn; call
   the repo-provided driver or delegate the drive to a cheap sub-agent that returns a verdict.
7. **Converge on a BLIND gate, not "one more final pass" — verify-each + hunt-across.**
   Fix-round hunting during the sprint uses diverse-lens hunters (correctness, edge/boundary,
   state/undo, data-loss, security). But *completion* is decided by **blind validators** who
   never saw the work (see *Stop rule*), and the default validator shape is **hybrid**: one
   small-context **verifier per change-request/cluster** (parallel, blind, each drives only
   its own surface and checks its acceptance Verify verbatim) **plus** one or two **broad
   adversarial hunters** for emergent/cross-cutting/integration bugs no single cluster would
   surface. Scale verifier count to CR count, capped by the parallelism limit; every
   validator stays blind to sprint history regardless of scope. The biased main context
   declaring "done" is exactly the trap that spawns redundant "final" passes — see *Stop
   rule* and `references/orchestration.md` for the full protocol and the tradeoff (pure
   per-CR risks missing feature interactions; the broad hunters are what catch those).
8. **Verify with eyes, sample before declaring done.** The proof artifact is, **by default,
   a single self-contained Markdown sprint report** — agentic burndown + before/after
   screenshots per change — archived under `.hyper-sprint/completed/<sprint>/` (see *Proof
   artifact*). Screenshots come **free from the blind verifiers** (each `ctx.shot()`s its
   proof state via the `burst-bug-hunter` warm-app harness; "before" shots come from the
   base-commit render driven the same way). A recorded HTML/video demo deck is **optional** —
   build it only if the user asks. Never trust a shot blindly — *look* at it (feature visible,
   right screen, interaction landed); a driver bug silently proves nothing.
9. **Cost is a first-class deliverable, not an afterthought.** Track and report real spend,
   not a guess. Run a **mid-sprint cost checkpoint** — `assets/sprint-cost.py` at roughly the
   halfway point — so runaway hub bloat or an over-provisioned validator fleet is caught
   *before* it compounds, not discovered in a post-mortem. The report's cost + savings
   section (see *Proof artifact*) comes from the same script re-run at the end.
10. **Don't fight the environment.** Detect a capability once (signing keys, network,
   missing binaries); if an op is impossible here, record it as a known limitation and
   move on — don't burn turns retrying "command not found" or an empty credential.
11. **Right-size the fan-out & route the model.** Recon inline for a file a single worker
   owns; spawn a dedicated recon agent only for a subsystem no worker owns (don't pre-spawn
   agents that go unused). Parallelize independent reads/hunts and
   disjoint-file workers (worktrees); serialize colliding writes. Match model+effort to
   task difficulty — flagship for orchestration, hard logic, and the final adversarial hunt;
   cheap/fast for mechanical work **and for verification-drivers** (the per-CR verifiers in
   principle 7 need enough model to follow a spec, not the flagship) — full routing table in
   `references/orchestration.md`.
12. **Long-run resilience: heavy sub-agents can die mid-task.** Session limits, rate limits,
   and container resets don't wait for a convenient boundary. Stagger heavy/long-running
   sub-agents rather than firing them all at once (so one reset doesn't stall the whole fan-
   out), and design the orchestrator to **adopt a dead worker's partial edits and re-verify
   them** rather than discard and restart from scratch — the partial work is usually salvageable
   and a clean restart throws away real progress for no reason.
13. **Report for steering, not just logging.** On a fixed cadence (not per-action) give a
   short, mobile-readable status: **done / total**, what's in flight, blockers. When the
   profile supports sending files/images, **attach screenshots of new or changed features**
   as they land so the user can course-correct early — cheap steering beats a wrong demo at
   the end. Adapt to the profile's comms channel; degrade to text where richer media isn't
   supported, skip silently where there's no user channel at all.
14. **Respect repo conventions & disclosure hygiene.** Read the repo's
    contributing/CLAUDE guidance first (version bumps, changelog, test commands,
    public-repo secrecy). Match surrounding code style. Never leak secrets, session
    URLs, or exploit detail into anything committed/public.
15. **Stay on the given branches.** Start from whatever **base branch** you were handed —
    never assume `main`/`master`. The only branches in scope are the **sprint branch** and
    its **base**; don't read, diff against, fetch, or checkout any other branch (or peek at
    other refs) unless strictly required and the user approves. Diff against the base you
    were given, not a guessed default.

## Phases

**Phase 0a — Intake (orchestrator; stays in the hub, it drives planning).** Read the repo's
**`.hyper-sprint/config.md`** at the repo root if present (base branch, build/test + app-boot commands,
vendored/declared deps, conventions, stop rule) — honor it over guesses. Identify the **agent
profile** (`references/agent-profiles.md`) and reuse its known facts. Parse the change list into
discrete, testable items; ask *now* (batched) about any that don't make sense or need a UX
decision. Image-heavy PDF → rasterize + read the screenshots (recipe in the profile). If the
spec's screenshots are from a **different app version** than the base, flag it — some CRs may
already be (partly) done; validate against the spec, don't blind-reimplement. Agree the **stop
rule** explicitly (blind-hunt duration + proof artifact), and — in the same batched round of
questions — decide the **gate style** (validator granularity: hybrid per-CR + cross-cutting is
the default, see principle 7; adjust only for a good reason), the **driver style** (scripted vs
interactive), and the **proof artifact** shape. Deciding these up front avoids building a
validation round in one style and scrapping it for another once the CRs are already partitioned.

**Phase 0b — Readiness probe (hard gate; inline or sub-agent per principle 1).** If the
environment is already pre-provisioned (a setup script ran, a prebuilt image/artifact is
present), the orchestrator runs the fast boot+smoke gate itself, inline, and moves straight to
Phase 1. Otherwise, delegate to a readiness sub-agent: verify the config's commands/paths exist
on the base branch (a missing one is *config drift* — **repair it here, don't route around it**:
fix the broken path / stale test-id / missing reset hook so the shipped harness works, rather
than quietly building your own). Provision declared deps; run build + tests; then boot and
**smoke-test every surface the sprint will verify** (e.g. the primary view, a secondary mode, a
dialog). It **writes an entrypoint file** (the one boot+drive command, baseline passing-count +
known pre-existing failures, new gotchas) and **returns only `ready|blocked` + reason + that
path**. Orchestrator **hard-gates on `blocked`** either way. Delegating (when genuinely needed)
keeps the bring-up trial-and-error out of the premium context entirely; running it inline (when
pre-provisioned) avoids paying a sub-agent round-trip for a gate that's already solved.

**Readiness MUST boot *through the same harness the blind gate will use* — the `burst-bug-hunter`
engine (§Phase 5), not a parallel driver.** Concretely: `start-hunt.sh <wd> <url> <config>`, then
prove every sprint-verified surface with a real `vrun` burst (present view, gallery, a modal, the
edit path…). This is where latent harness bugs surface at minute 5 instead of hour 2 — e.g. a
headless `requestFullscreen` that hangs `keyboard.press` — and the workaround gets **crystallized
into the repo verb library now**, so no later hunt re-pays it. **Anti-pattern (the #1 way the
engine gets bypassed): writing a throwaway per-step Playwright helper for the readiness smoke and
then reusing it for the blind gate.** If you catch yourself hand-rolling a `launch()`/driver in the
hub, stop — fix the engine's config instead. A second driving harness that gets reused for
verification means the enforced time-box and burst efficiency never apply.

**Phase 1 — Recon.** Parallel read-only sub-agents (one per subsystem) → anchored edit maps in `NOTES.md`.

**Phase 2 — Plan.** Cluster by file-locality into task-tracked items with **disjoint file
sets** where possible; assign each a model/effort tier and a rough effort estimate (the
burndown's ideal line); note the start time. **Pick a short memorable codename** for the
sprint (e.g. `limelight`) — folder and plan filenames carry **date + codename**. **Write the
plan NOW, not at the end:** create
`.hyper-sprint/completed/<YYYY-MM-DD>-<codename>/plan-<YYYY-MM-DD>-<codename>.md` with the
*verbatim original prompt* + this plan (parsed CRs, clusters, batches). Capturing it live makes
it a real artifact — at close you append a short "what happened vs plan" (e.g. blind-round
count), which is only honest if the plan wasn't reconstructed afterward.

**Phase 3 — Delegate & integrate.** Dispatch each cluster to a **worker sub-agent** (routed
model/effort) with its objective, edit map, its **acceptance Verify verbatim**, and exclusive
file set; disjoint clusters run in parallel **worktrees**. Worker does edits + unit/e2e tests and
returns a compact result — never its raw diff (*hub hygiene*, principle 3). **New UI a worker
adds must be drivable by the repo's burst verb library**: emit the stable test-ids those verbs
expect (or update the verbs in the same change) — otherwise the blind gate can't drive the feature
and you pay a mid-sprint reconciliation. The orchestrator
merges sequentially, **full suite green between merges**, and posts a steering update (done/
total + feature screenshots where supported, sent as a file/link — not pasted inline). Re-run
the suite after every fix. **At roughly the halfway point, run the mid-sprint cost checkpoint**
(`assets/sprint-cost.py` gives a per-agent + per-model cost breakdown from the transcripts so
far — a mid-sprint run catches hub bloat or an over-provisioned fan-out while there's still
time to correct it, instead of discovering it at the retro).

**Phase 4 — Fix-round hunt.** Diverse-lens hunters find bugs → fix workers + regression tests
→ re-run suite. This *reduces* defects but does **not** decide done — the blind gate does.

**Phase 5 — Blind gate + proof + archive.** Run the **blind validation** stop gate (below) —
default hybrid shape (per-CR verifiers + broad hunters, principle 7). Browser verification runs
**through the `burst-bug-hunter` engine — this is mandatory, not advice**; a round driven by an
ad-hoc per-step Playwright harness **does not count** (it loses the enforced time-box and warm-app
efficiency). Concrete required sequence: for each hunter, `start-hunt.sh <wd> <url> <config>`
(one warm server, app opened once), **write the hard time-box to `<wd>/deadline`**
(`python3 -c 'import time;print(time.time()+<N>*60)' > <wd>/deadline` — the *engine* enforces it;
a prompt that merely says "hunt for X minutes" with no `deadline` file is non-compliant), then
spawn each blind hunter given only **`VDRIVE=<wd>` + the verbs path + the `vrun`/burst protocol**
(never a bespoke driver). Each verifier works in **bursts** (multi-step `job.mjs` run to
completion, observe at burst boundaries) and `ctx.shot()`s its proof state so the same pass that
verifies also captures the report screenshots. Hunt **non-stop until the engine `deadline`**;
`stats.json` + `findings.jsonl` are the audit trail. Only once it's
clean, assemble the **default proof: a single Markdown report** — agentic burndown (from
`assets/sprint-stats.py` + the blind-round timeline) + before/after screenshots + cost/savings
(`assets/sprint-cost.py`) — and **archive the whole sprint** to
`.hyper-sprint/completed/<sprint>/` (`README.md` = report, `plan-*.md`, `sprint.json`, `img/`);
append a row to `.hyper-sprint/completed/README.md`. A recorded HTML/video demo deck is
**optional** (build only on request — see *Proof artifact*). **Deliver the report as a
clickable Markdown link** — `[Sprint "<codename>" report](https://github.com/<owner>/<repo>/tree/<branch>/.hyper-sprint/completed/<YYYY-MM-DD>-<codename>)` (the `tree` folder URL renders the
README on open). NEVER wrap the URL in backticks (that renders as non-clickable code) or hand
over a bare repo path. Also offer the shorter **repo/branch-root** link — deep paths with a
dot-folder (`.hyper-sprint`) often fall back to the browser, while short `github.com/<owner>/<repo>` links hand off to the GitHub mobile app more reliably. Then the final status vs the full list.

## Proof artifact — default: a Markdown sprint report (video optional)

**Default = one self-contained Markdown report** archived at
`.hyper-sprint/completed/<sprint>/README.md` (renders when the folder is opened). Full
convention + generation flow: **`references/sprint-archive.md`**. Arc: Scope → **agentic
burndown** (work-remaining = open CRs + agent-found defects; the blind-hunt rounds *add*
scope, so the curve bumps up before zero — render with `assets/mk-burndown.py`) → **stats**
(`assets/sprint-stats.py`) → **before/after per change** (screenshots the verifiers already
captured: HEAD for "after", the base-commit render for "before") → **cost/savings**
(`assets/sprint-cost.py`, grounded in real numbers) → **bugs found & fixed**. Use **relative**
`img/…` paths (GitHub renders those; it does *not* render base64 data-URIs) — optionally also
emit a base64-inlined single-file copy for portable one-click viewing.

**Screenshots are a by-product of verification, not a separate step.** The blind verifiers
drive each feature through the `burst-bug-hunter` warm app; add one `ctx.shot("<cr>-after-…")`
per proof state. "Before" shots = the same tagged bursts run against a render of the base
commit. **Frame-check (hard gate):** *look* at every shot (feature visible, right screen,
interaction landed) — a green suite is not proof the report shows it.

**Optional: recorded HTML/video demo deck.** Build the embedded-clip HTML deck **only if the
user asks** (a guided walkthrough on top of the report). Pipeline, slide types, VP8/frame-check
gotchas: **`references/demo-deck.md`**.

## Stop rule (both required)

1. **A blind validation round comes back clean — hybrid: verify-each + hunt-across.** Spawn
   fresh validator sub-agents, **best model, max effort, always** (never economize on the
   gate). Default shape: a **small-context verifier per change-request/cluster** (parallel,
   blind, drives only its own surface and checks its acceptance Verify verbatim), **plus one
   or two broad adversarial hunters** for emergent/cross-cutting/integration/data-loss bugs
   that no single cluster's verifier would see. Scale verifier count to CR count, capped by
   the parallelism limit. Every validator's prompt contains **only** its slice of the
   acceptance spec (or the full spec, for the broad hunters) + code at HEAD + the **drive
   recipe** + the **known-intentional behaviors / acceptance nuances**, and instructs:
   "confirm every feature in scope, then hunt ANY bug for **X min non-stop**; **report the
   literal observed output, not interpretations**; report pre-existing/out-of-scope issues
   *separately* (they don't fail the gate)." **Withhold the sprint history** — bug counts,
   turns, elapsed time, "nearly done", the diff — so the verdict can't be anchored. Classify
   findings **in-scope defect vs cosmetic/out-of-scope from the start** — the bar never moves
   by round. Any in-scope finding → fix → **new** blind round (fresh agents; may share the
   harness bring-up, never the findings). Done when a full round **run through the
   `burst-bug-hunter` engine with an engine-enforced `deadline`** (§Phase 5) surfaces **zero
   in-scope defects** and all features confirmed present. The `X min` budget is the `deadline`
   file, not a sentence in a prompt — a round whose time-box wasn't mechanically enforced, or
   that was driven by a bespoke per-step harness instead of the engine, **does not satisfy the
   gate**. Keep the engine's `stats.json`/`findings.jsonl` as evidence the enforced burst hunt
   actually ran. (Protocol, and the tradeoff of per-CR-only vs hybrid: `references/orchestration.md`.) **And**
2. the **Markdown sprint report** exists at `.hyper-sprint/completed/<sprint>/README.md`
   (agentic burndown + before/after screenshots + cost) and its shots have been *looked at*
   to confirm every change is actually shown working. (A recorded video demo is optional —
   only when the user asks; it is **not** required for the gate.)

Do not let the (biased) main context declare done; the gate is owned by agents who never
saw the work happen.

## Package policy (installs)

**Provisioning a dep the repo already declares is fine — adding a NEW one needs approval.**
Installing what's already in the repo manifest (`package.json`, `requirements.txt`, lockfile
— e.g. `npm ci`, `pip install -r`, or a single declared devDependency like `jsdom`) is
readiness, not a new dependency; do it. **Adding an undeclared language package** (npm / pip
/ gem / cargo …) requires explicit user approval — prefer stdlib. OS packages via the system
manager (`apt-get`) are fine. Allow-list (undeclared but safe, no approval — else ask):
**`playwright`** (Node browser driver; browsers pre-provided) and **`poppler-utils`** (OS/apt:
`pdftotext`+`pdftoppm` for spec PDFs). Never install a dep the repo config marks **vendored**.
Anything else: stop and ask; the user amends this list to extend it.

## Repo config & pre-requisites

Prefer a root **`.hyper-sprint/config.md`** (stack-agnostic — any agent framework reads it) carrying
the repo facts: base branch, build/test + app-boot commands, vendored deps to never install,
conventions, and the default stop rule. If it's absent, the caller should provide:

- The **agent profile** (or confirmation of `claude-code-cloud-default`), plus how to
  **build/run tests** and **launch + drive the app** for this repo.
- The **change list** (with screenshots/acceptance criteria where possible).
- The **stop rule**: blind-hunt duration and expected proof artifact.
- Repo conventions (versioning, changelog, secrecy) and the base branch.
