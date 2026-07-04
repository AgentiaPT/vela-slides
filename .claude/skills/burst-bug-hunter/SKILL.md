---
name: burst-bug-hunter
version: 1.2
description: >
  Time-boxed adversarial bug-hunting of a LIVE app driven by MULTI-STEP PLAYWRIGHT
  BURSTS against a persistent warm browser — not one LLM turn per CLI step. The app is
  opened ONCE; the agent submits full scripts that run to completion unattended (one
  structured result per burst); reset to a known initial state between scenarios;
  inherit the implementer's driver verbs instead of re-predicting selectors. Generic /
  repo-agnostic: all app specifics come from the repo's own config. Use when hunting
  bugs in a browser-drivable app under a hard wall-clock budget.
---

# Burst Bug-Hunter (generic engine)

## Why
Interactive step-by-step CLI driving costs **one LLM turn per action** — a long hunt is
mostly model round-trips, not browser work. This flips the default: **the unit of work is
a whole multi-step script (a "burst")** that runs unattended and returns one structured
result. You observe at burst *boundaries*, not per action. Typical effect: ~8× fewer
model turns per feature vs step-by-step.

## Two modes
- **Verify with bursts** (default) — you HAVE the app model; confirm expected behavior fast.
- **Explore step-by-step** (rare) — you DON'T have the model yet; build it. **Crystallize
  whatever flows you discover into the repo's verb library** so the next agent inherits
  them (see *Answering "doesn't the agent need app knowledge?"* below).

## The engine (this skill, `assets/`, app-agnostic)
- `driver-server.mjs <app-url> <workdir> [config.json]` — opens the app ONCE, keeps it
  warm, runs submitted job scripts, enforces a hard deadline (`<workdir>/deadline` epoch
  secs → all non-shutdown jobs rejected after). Every result carries `remainingMs`.
- `start-hunt.sh <workdir> <app-url> [config.json]` — boots one warm server, waits ready.
- `vrun` — submit a job and block for the full result (`VDRIVE=<workdir>` selects the
  server). Also: `vrun --reset`, `vrun --inline 'CODE'`, `vrun --finding '{json}'`
  (append a finding line without a browser round-trip).
- `example-burst.mjs` — copy/adapt template: a **defensive** burst that records a per-step
  trace so a wrong prediction fails at a NAMED step (cheap to fix) instead of derailing.

## The contract — what the REPO provides (nothing app-specific lives in this skill)
Put these in the repo (convention: `.hyper-sprint/`), and pass the config to the engine:
- **A bootable app URL** — build/serve the app and yield a `file://`/`http://` URL. A repo
  boot script (e.g. `.hyper-sprint/burst-boot.sh <args> <outdir>` printing the URL) is handy.
- **`config.json`** with:
  - `readyExpr` — JS predicate, true when the app is booted (default `document.readyState==='complete'`).
  - `resetExpr` — JS run IN THE PAGE to reset to initial state **without reload** (optional;
    falls back to `page.reload()`). Prefer an in-memory reset hook the app/harness exposes.
  - `initScript` — path (relative to the config file) to JS injected BEFORE load (optional;
    e.g. a storage polyfill). 
  - `viewport` — optional.
  - `verbs` — path to the repo's **verb library** (page objects) that bursts import.
- **A verb library** — stable, self-observing verbs (each `waitForFunction`s its own
  post-condition, throws a NAMED error if the model is wrong). Authored by whoever knows
  the app — ideally reused straight from the **implementer's own drive/test scripts**.

## Hunter protocol (what a hunt sub-agent does)
1. `export VDRIVE=<your workdir>`; confirm warm: `[ -f $VDRIVE/ready ]`.
2. Work in **bursts**: write `job.mjs` (`export async function run(page, ctx){…}`, importing
   the repo's verbs by absolute `file://` path), then `assets/vrun job.mjs`. `ctx.reset()` /
   `vrun --reset` = instant known-initial state. `ctx.shot(name)` screenshots.
3. Make bursts **defensive** (per-step trace); on a wrong prediction read `failedAt`, fix, re-run.
4. **Append every finding immediately**: `vrun --finding '{"sev","title","repro","observed","expected"}'`.
   Don't hold findings to the end — the window can close mid-hunt.
5. Hunt **non-stop until the deadline**; use each result's `remainingMs` to pace. When a job
   returns `{"ok":false,"error":"DEADLINE…"}` the window is closed — stop, write nothing more.
6. Classify in-scope defect vs out-of-scope/pre-existing. Report literal observed output.

## Orchestrator: launch + time-box + eval
```
URL=$(bash <repo-boot-script> <args> <outdir>)                 # repo-specific boot → URL
bash assets/start-hunt.sh /tmp/hunt-A "$URL" <repo>/config.json  # one warm server per hunter
python3 -c 'import time;print(time.time()+180)' > /tmp/hunt-A/deadline   # hard cap
# spawn hunter sub-agents (VDRIVE + feature + the repo's verbs path), then DON'T wait:
# each server writes <workdir>/stats.json (jobs, totalMs, remainingMs) and logs every job.
# At the deadline, read stats.json + findings.jsonl and eval — kill, don't wait.
```

## Screenshots for free → the sprint report
Verification and documentation share one pass. Have each verifier `ctx.shot("<cr>-after-<label>")`
at its proof state — those PNGs are exactly the "after" images the hyper-sprint **Markdown
report** needs (`hyper-sprint/references/sprint-archive.md`). "Before" images = the same tagged
bursts run against a warm render built from the **base commit**. No separate capture step.

## Answering "doesn't the agent need app knowledge to write bursts?"
Yes — but as a **one-time inherited asset, not a per-burst prediction**: (1) the implementer
authors the **verb library** (it already wrote drive scripts); (2) verbs **self-observe**
(`waitForFunction`), so the agent predicts the *sequence*, not exact DOM/timing; (3) stable
**test-ids** are the app's published driver contract — snapshot them instead of reading source;
(4) wrong predictions fail **named + cheap**, so the model improves by one correction. Explorer
output must compound back into the verb library, or every agent re-pays the "predict from
scratch" tax.
