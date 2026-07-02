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
6. **Verify with eyes, sample before declaring done.** The proof artifact is a full
   end-of-sprint **HTML demo deck** with embedded recordings of the real app (see
   *Proof artifact*). Never trust a recording blindly — *look* at frames captured while
   driving; a driver bug (wrong key, clip never played) silently proves nothing.
7. **Don't fight the environment.** Detect a capability once (signing keys, network,
   missing binaries); if an op is impossible here, record it as a known limitation and
   move on — don't burn turns retrying "command not found" or an empty credential.
8. **Right-size the fan-out.** Parallelize independent reads/hunts; keep collision-prone
   writes to the same file serial (main loop) or isolate them (worktrees).
9. **Report on a fixed cadence, not per-action.** Give the user a short,
   mobile-readable status tied to the task checklist (done / in-progress / blocked +
   progress vs total), on an interval — not a paragraph after every edit.
10. **Respect repo conventions & disclosure hygiene.** Read the repo's
    contributing/CLAUDE guidance first (version bumps, changelog, test commands,
    public-repo secrecy). Match surrounding code style. Never leak secrets, session
    URLs, or exploit detail into anything committed/public.

## Phases

**Phase 0 — Intake & readiness.** Identify the **agent profile** (see
`references/agent-profiles.md` — e.g. `claude-code-cloud-default`) and reuse its known
browser/ffmpeg/network/git facts instead of rediscovering them. Parse the change list
into discrete, testable items; note any that don't make sense or need a UX decision and
ask *now*, batched. If the spec is an image-heavy PDF, rasterize its pages and read the
screenshots — don't rely on text alone (recipe in `references/agent-profiles.md`). Read repo conventions. Run the build + test suite clean. Prove the
app runs and is drivable on a smoke case; record any *new* gotchas in `NOTES.md`. Agree
the **stop rule** explicitly (bug-hunt duration + proof artifact).

**Phase 1 — Recon.** Parallel read-only sub-agents (one per subsystem) → anchored edit maps in `NOTES.md`.

**Phase 2 — Plan.** Cluster by file-locality into task-tracked work items; sequence so colliding edits don't overlap; give each cluster a rough effort estimate (the burndown's ideal line) and note the start time.

**Phase 3 — Implement (per cluster).** Edit from notes → unit + e2e tests → full suite green → commit. Repeat.

**Phase 4 — Adversarial hunt.** Diverse-lens hunters ×2 rounds → dedupe → fix + regression test (re-run suite each fix) → one confirming pass. Loop until a round is dry.

**Phase 5 — Proof, retro & handoff.** Build the demo deck (below) incl. a real burndown and a retro from session stats; frame-check; deliver. Report final status vs the full list.

## Proof artifact — the end-of-sprint demo

Deliver **one HTML slide deck** that is a complete end-of-sprint review — stunning, no
fluff — not just a reel of clips. HTML is the universal medium: any browser, no
toolchain, plays offline. Arc: Open (theme/codename) → Scope (issue list) → **Burndown**
(real, below) → **Session stats & retro** (below) → Quality (bugs found & fixed) → **Live
walkthrough** (one embedded real-app clip per change — the heart) → Close.

**Real burndown (coding-agent flavour).** A "16/16 = 100%" bar is a scoreboard, not a
burndown. The per-cluster effort estimates (Phase 2) are the *ideal* line; commit
timestamps give the *actual*. Plot work-remaining = *open CRs + open defects* over
elapsed time, and show the honest shape — features burn down, then the **bug-hunt adds
scope** (defects found after "done") so the line bumps *up* before zero. Where rework,
not features, dominated is the insight.

**Session stats & retro.** Mine what the session produced — availability is
**profile-dependent** (`assets/sprint-stats.py` degrades gracefully): git gives the
commit timeline / fix-vs-test ratio; the transcript gives tool calls, sub-agents,
errors, timestamps (`claude-code-cloud-*`); token/cost + task list are often absent
headless. Turn it into a stats slide + a **retro**: what worked and concrete
**self-recommendations for next sprint**.

The slide chrome is **app-independent** and pre-built — you supply only recordings and
text, so it drops onto any browser-based app. The bundled pipeline
(`assets/record-demo.mjs` per-change clips → edit `deck.js` → `assets/sprint-stats.py` →
`assets/play-deck.mjs` for the integrated video) and full slide-type/gotcha reference
live in **`references/demo-deck.md`**.

**Frame-check before shipping (hard gate).** Both recorders screenshot **while
driving** — *inspect* those PNGs: feature visible, right screen, interaction landed? A
green suite is **not** proof the demo shows the feature; a recording can silently be
wrong (wrong key, clip never autoplayed). Ship only once frames confirm **every** change
is on screen. (Playwright's VP8 `.webm` isn't seekable — verify via the during-drive
screenshots, not post-hoc playback or `ffmpeg`; see `references/agent-profiles.md`.)

## Stop rule (both required)

1. A bug-finding pass of at least the agreed duration finds **no new bugs** tied to
   the change requests, **and**
2. the **HTML demo deck** with embedded recorded demos exists and its frames have
   been sampled to confirm every change is actually shown working.

Only then is the sprint done. Do not stop early; do not over-run past a dry round.

## Pre-requisites the caller should provide

- The **agent profile** (or confirmation of `claude-code-cloud-default`), plus how to
  **build/run tests** and **launch + drive the app** for this repo.
- The **change list** (with screenshots/acceptance criteria where possible).
- The **stop rule**: hunt duration and expected proof artifact.
- Repo conventions to honor (versioning, changelog, secrecy) and the target branch.
