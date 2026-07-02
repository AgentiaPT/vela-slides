---
name: hyper-sprint
description: >-
  Run a full "implement + test + verify a batch of change requests to zero bugs"
  sprint in one session as a thin orchestrator that delegates implementation to
  sub-agents (routed by task difficulty, isolated in worktrees for parallel work)
  and gates completion on an independent BLIND validation by the best model. Use
  when handed a list of changes/issues (a PDF, ticket list, or spec) to implement,
  test, and prove working end-to-end — stop rule "a blind best-model hunt finds no
  bugs + a demo/proof artifact". Repo-agnostic; reads a root `hyper-sprint.md` for
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
  + code at HEAD, never the sprint history (*Stop rule*).

## Operating principles (the economy rules)

1. **Readiness before features (hard gate).** Before writing code, confirm the loop can
   *build, run, and drive the app* end-to-end on a throwaway smoke case. Most wasted time
   comes from discovering harness quirks (blocked CDNs, driver flags, how to enter/exit a
   mode, offscreen duplicate DOM, asset truncation) *during* verification — find them
   once, up front, into `NOTES.md`. If the app can't run here, say so now and agree the
   fallback (unit-only + manual checklist), don't discover it at the demo.
2. **Recon in parallel, once.** Fan out read-only sub-agents (one per subsystem) to
   return **line-anchored edit maps** (`file:line` + what changes). Persist them to
   `NOTES.md`. The main loop should edit from notes, not re-open the same files —
   repeated re-reads of the same large file are pure token waste.
3. **Cluster by file-locality, not by ticket number.** Group changes that touch the
   same files into one work item so edits don't collide and each item is independently
   testable — and so clusters with **disjoint file sets** can run as parallel workers in
   separate worktrees. Track them with the task tool; keep the list live.
4. **Test-as-you-go, never batch-at-end.** Each change lands with its unit and/or e2e
   test in the *same* step; the full suite runs before moving on. A fix with no test is
   not done. Re-run the whole suite after **every** fix — a fix can regress the thing it
   fixed (it happened here). Keep test wall-time roughly flat; prefer fast headless checks.
5. **Converge on a BLIND gate, not "one more final pass."** Fix-round hunting during the
   sprint uses diverse-lens hunters (correctness, edge/boundary, state/undo, data-loss,
   security). But *completion* is decided by **blind validators** who never saw the work
   (see *Stop rule*) — the biased main context declaring "done" is exactly the trap that
   spawned five redundant "final" passes last time.
6. **Verify with eyes, sample before declaring done.** The proof artifact is a full
   end-of-sprint **HTML demo deck** with embedded recordings of the real app (see
   *Proof artifact*). Never trust a recording blindly — *look* at frames captured while
   driving; a driver bug (wrong key, clip never played) silently proves nothing.
7. **Don't fight the environment.** Detect a capability once (signing keys, network,
   missing binaries); if an op is impossible here, record it as a known limitation and
   move on — don't burn turns retrying "command not found" or an empty credential.
8. **Right-size the fan-out & route the model.** Parallelize independent reads/hunts and
   disjoint-file workers (worktrees); serialize colliding writes. Match model+effort to
   task difficulty — flagship for orchestration, hard logic, and validation; cheap/fast for
   mechanical work (routing table in `references/orchestration.md`).
9. **Report for steering, not just logging.** On a fixed cadence (not per-action) give a
   short, mobile-readable status: **done / total**, what's in flight, blockers. When the
   profile supports sending files/images, **attach screenshots of new or changed features**
   as they land so the user can course-correct early — cheap steering beats a wrong demo at
   the end. Adapt to the profile's comms channel; degrade to text where richer media isn't
   supported, skip silently where there's no user channel at all.
10. **Respect repo conventions & disclosure hygiene.** Read the repo's
    contributing/CLAUDE guidance first (version bumps, changelog, test commands,
    public-repo secrecy). Match surrounding code style. Never leak secrets, session
    URLs, or exploit detail into anything committed/public.
11. **Stay on the given branches.** Start from whatever **base branch** you were handed —
    never assume `main`/`master`. The only branches in scope are the **sprint branch** and
    its **base**; don't read, diff against, fetch, or checkout any other branch (or peek at
    other refs) unless strictly required and the user approves. Diff against the base you
    were given, not a guessed default.

## Phases

**Phase 0 — Intake & readiness.** Read the repo's **`hyper-sprint.md`** at the repo root if
present (stack-agnostic repo config: base branch, build/test + app-boot commands, vendored
deps to never install, conventions, stop rule) — honor it over guesses. Identify the **agent
profile** (see `references/agent-profiles.md` — e.g. `claude-code-cloud-default`) and reuse its
known browser/ffmpeg/network/git facts instead of rediscovering them. Parse the change list
into discrete, testable items; note any that don't make sense or need a UX decision and
ask *now*, batched. If the spec is an image-heavy PDF, rasterize its pages and read the
screenshots — don't rely on text alone (recipe in `references/agent-profiles.md`). Read repo
conventions. **Verify the config's commands/paths actually exist on the base branch before
trusting them** — a referenced script that isn't there is *config drift* (often it lives only
on a feature branch): surface it and fall back to an existing repo harness/skill rather than
silently rebuilding one. **Capture a baseline in `NOTES.md`:** current version, passing-test
count, and the exact set of *known pre-existing failures* (so regressions are unambiguous
later). If the spec's screenshots are from a **different app version** than the base, flag it
— some CRs may already be (partly) done; validate against the spec, don't blind-reimplement.
Run the build + test suite; prove the app runs and is drivable on a smoke case; record any
*new* gotchas. Agree the **stop rule** explicitly (blind-hunt duration + proof artifact).

**Phase 1 — Recon.** Parallel read-only sub-agents (one per subsystem) → anchored edit maps in `NOTES.md`.

**Phase 2 — Plan.** Cluster by file-locality into task-tracked items with **disjoint file
sets** where possible; assign each a model/effort tier and a rough effort estimate (the
burndown's ideal line); note the start time.

**Phase 3 — Delegate & integrate.** Dispatch each cluster to a **worker sub-agent** (routed
model/effort) with its objective, edit map, and exclusive file set; disjoint clusters run in
parallel **worktrees**. Worker does edits + unit/e2e tests and returns a compact result. The
orchestrator merges sequentially, **full suite green between merges**, and posts a steering
update (done/total + feature screenshots where supported). Re-run the suite after every fix.

**Phase 4 — Fix-round hunt.** Diverse-lens hunters find bugs → fix workers + regression tests
→ re-run suite. This *reduces* defects but does **not** decide done — the blind gate does.

**Phase 5 — Blind gate + proof + handoff.** Run the **blind validation** stop gate (below).
Only once it's clean, build the demo deck (real burndown + retro from session stats),
frame-check, deliver, and report final status vs the full list.

## Proof artifact — the end-of-sprint demo

Deliver **one app-independent HTML deck** (any browser, no toolchain, offline) — a full
end-of-sprint review, not a reel of clips. Arc: Open (theme) → Scope → **real Burndown**
(work-remaining = open CRs + open defects over time; the bug-hunt *adds* scope, so it bumps
up before zero) → **Session stats & cost + retro** (from `assets/sprint-stats.py`, profile-
dependent) → Quality (bugs fixed) → **Live walkthrough** (one embedded real-app clip per
change — the heart) → Close. Full pipeline, slide types, and gotchas: **`references/demo-deck.md`**.

**Frame-check before shipping (hard gate).** The recorders screenshot **while driving** —
*inspect* those PNGs (feature visible, right screen, interaction landed). A green suite is
**not** proof the demo shows it; a recording can silently be wrong. Playwright's VP8 isn't
seekable — verify via during-drive screenshots, not post-hoc playback/`ffmpeg`.

## Stop rule (both required)

1. **A blind, best-model validation round comes back clean.** Spawn fresh validator
   sub-agents (best model, max effort, diverse lenses) whose prompt contains **only** the
   acceptance spec + the code at HEAD + "confirm every feature is present & correct, then
   hunt for ANY bug for **X minutes non-stop**; assume nothing is done until verified."
   **Withhold the sprint history** — bug counts, turns, elapsed time, "nearly done", the
   diff — so the verdict can't be anchored. Any real finding → fix → **new** blind round
   (fresh agents). Done when a full ≥ X-min round surfaces zero confirmed issues and all
   features confirmed present. (Protocol: `references/orchestration.md`.) **And**
2. the **HTML demo deck** with embedded recorded demos exists and its frames have been
   sampled to confirm every change is actually shown working.

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

Prefer a root **`hyper-sprint.md`** (stack-agnostic — any agent framework reads it) carrying
the repo facts: base branch, build/test + app-boot commands, vendored deps to never install,
conventions, and the default stop rule. If it's absent, the caller should provide:

- The **agent profile** (or confirmation of `claude-code-cloud-default`), plus how to
  **build/run tests** and **launch + drive the app** for this repo.
- The **change list** (with screenshots/acceptance criteria where possible).
- The **stop rule**: blind-hunt duration and expected proof artifact.
- Repo conventions (versioning, changelog, secrecy) and the base branch.
