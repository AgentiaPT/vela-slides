---
name: hyper-sprint
description: >-
  Run a full "implement + test + verify a batch of change requests to zero bugs"
  sprint in one session, using sub-agent orchestration for less time/tokens/errors
  at equal-or-better quality. Use when handed a list of changes/issues (a PDF,
  ticket list, or spec) to implement, test, and prove working end-to-end — with a
  stop rule like "no bugs found in an adversarial hunt + a demo/proof artifact".
  Repo-agnostic; front-loads app/browser readiness so verification never stalls.
---

# Hyper Sprint

Deliver a batch of changes to a **verified zero-bug** state in one session, cheaply.
This skill replaces an ad-hoc "implement everything and test it" prompt. The
learnings below come from a real sprint's failure modes — obey them to avoid
re-paying that cost.

## Operating principles (the economy rules)

1. **Readiness before features (hard gate).** Before writing any code, confirm the
   loop can *build, run, and drive the app* end-to-end on a throwaway smoke case.
   Most wasted time comes from discovering harness quirks (blocked CDNs, headless
   driver flags, how to enter/exit a mode, offscreen duplicate DOM, asset-size
   truncation) *during* verification. Find them once, up front, and write them to
   `NOTES.md`. If the environment can't run the app, say so now and agree on the
   fallback (unit-only + manual checklist) — don't discover it at the demo.
2. **Recon in parallel, once.** Fan out read-only sub-agents (one per subsystem) to
   return **line-anchored edit maps** (`file:line` + what changes). Persist them to
   `NOTES.md`. The main loop should edit from notes, not re-open the same files —
   repeated re-reads of the same large file are pure token waste.
3. **Cluster by file-locality, not by ticket number.** Group changes that touch the
   same files into one work item so edits don't collide and each item is
   independently testable. Track them with the task tool; keep the list live.
4. **Test-as-you-go, never batch-at-end.** Each change lands with its unit and/or
   e2e test in the *same* step, then the full suite runs before moving on. A fix
   with no test is not done. Re-run the whole suite after **every** fix — a fix can
   regress the thing it fixed (this happened: an image-safety fix itself dropped
   data). Keep total test wall-time roughly flat; prefer fast headless checks.
5. **Bug-hunt with diverse lenses, then converge — don't re-run "final" forever.**
   Two rounds of parallel adversarial hunters (each a *different* lens:
   correctness, edge/boundary, state/undo, data-loss, security) → dedupe → fix with
   regression tests → **one** confirming pass. Loop-until-dry means *until a full
   round finds nothing new*, not "run five more passes named final." Stop when a
   round ≥ the agreed duration surfaces zero new CR-linked bugs.
6. **Verify with eyes, sample before declaring done.** If a demo/video/screenshot is
   the proof artifact, **sample its frames** and confirm each claimed feature is
   actually visible *before* handing it over. A driver bug (wrong key, wrong DOM
   node) silently produces a demo that proves nothing — cheaper to catch by
   sampling than by a user rejecting it.
7. **Don't fight the environment.** Detect a capability once (signing keys, network
   policy, missing binaries). If an operation is impossible here, record it as a
   known limitation and move on — never burn turns retrying an op that returned
   "command not found" or an empty/missing credential.
8. **Right-size the fan-out.** Recon and hunting parallelize well; *sequential file
   edits* to the same file do not. Spawn agents for independent read/verify work;
   keep collision-prone writes in the main loop or isolate them (worktrees).
9. **Report on a fixed cadence, not per-action.** Give the user a short,
   mobile-readable status tied to the task checklist (done / in-progress / blocked +
   progress vs total), on an interval — not a paragraph after every edit.
10. **Respect repo conventions & disclosure hygiene.** Read the repo's
    contributing/CLAUDE guidance first (version bumps, changelog, test commands,
    public-repo secrecy). Match surrounding code style. Never leak secrets, session
    URLs, or exploit detail into anything committed/public.

## Phases

**Phase 0 — Intake & readiness.** Parse the change list into discrete, testable
items; note any that don't make sense or need a UX decision and ask *now*, batched.
Read repo conventions. Run the build + test suite clean. Prove the app runs and is
drivable on a smoke case; capture harness gotchas in `NOTES.md`. Agree the **stop
rule** explicitly (bug-hunt duration + proof artifact).

**Phase 1 — Recon (parallel, read-only).** One sub-agent per subsystem → anchored
edit maps into `NOTES.md`.

**Phase 2 — Plan.** Cluster by file-locality into task-tracked work items; sequence
so colliding edits don't overlap.

**Phase 3 — Implement (per cluster).** Edit from notes → add unit + e2e tests →
full suite green → commit with a clear message. Repeat.

**Phase 4 — Adversarial hunt.** Diverse-lens hunters ×2 rounds → dedupe → fix +
regression test (re-run suite each fix) → one confirming pass. Loop until a full
round is dry.

**Phase 5 — Proof & handoff.** Produce the demo/proof artifact; **sample it** to
confirm every feature shows; deliver it. Report final status vs the full list.

## Stop rule (both required)

1. A bug-finding pass of at least the agreed duration finds **no new bugs** tied to
   the change requests, **and**
2. the agreed **proof artifact** (demo video / annotated screenshots / passing e2e
   run) exists and has been sampled to show every change working.

Only then is the sprint done. Do not stop early; do not over-run past a dry round.

## Pre-requisites the caller should provide

- How to **build/run tests** and **launch + drive the app** (or that a ready browser/
  render harness exists), plus the **network policy** for this environment.
- The **change list** (with screenshots/acceptance criteria where possible).
- The **stop rule** specifics: hunt duration and what proof artifact is expected.
- Repo conventions to honor (versioning, changelog, secrecy) and the target branch.
