# Demo deck scaffold

The end-of-sprint demo is a self-contained, **app-independent** HTML slide deck: the
slide chrome owes nothing to the app under test, so it drops onto any browser-based app.
You supply only recordings and text. All pieces live in `assets/`.

## Pipeline

1. **`assets/record-demo.mjs`** — generic per-change recorder:
   `node record-demo.mjs <app-url> <out-dir> <scenario.mjs>`. Records one `.webm` per
   change **and** a screenshot at every beat, then scaffolds the deck (`index.html` +
   `deck.js` + `clips/`). The only app-specific file is `scenario.mjs`, which exports
   `boot(page)` (wait until the app is ready) + `clips[]` (each `{name, run(page,shot)}`).
2. **Edit `deck.js`** — the only content file. Slide types: `cover, scope, chart,
   metrics, bugs, retro, bullets, video, cost, savings`. Point `video` slides at
   `clips/<name>.webm`. `cost` and `savings` are described below — they are **required**
   in the arc, not optional extras.
3. **`assets/sprint-stats.py`** — profile-aware stats for the burndown + retro:
   `python3 sprint-stats.py --transcript <path>` (git-only if no transcript). Feed the
   numbers into the `chart` (ideal-vs-actual burndown) and `retro` slides.
4. **`assets/sprint-cost.py`** — per-agent + per-model cost breakdown to the cent:
   `python3 sprint-cost.py [--json out.json]` (see the script's own docstring for
   transcript-discovery options). Feed its rows into the `cost` slide's table and its
   grand total + savings estimate into the `savings` slide. Run it **twice**: once at
   the mid-sprint checkpoint (SKILL.md principle 9) to catch bloat early, and once more
   at the end for the deck's real numbers.
5. **`assets/play-deck.mjs`** — records the finished deck as **one integrated video**
   (`node play-deck.mjs <deck-dir> [out.webm]`), dwelling per slide, letting each
   embedded clip play once, and screenshotting mid-slide. This run-through is the
   **final deliverable**.

## Required slides: Cost and Savings

Cost is a first-class deliverable (SKILL.md principle 9), not a nice-to-have retro
footnote — the deck arc below **requires** both:

- **Cost** (`type:"cost"`): the per-agent (or per-role, if a role map was supplied) cost
  table from `sprint-cost.py`, plus its per-model-tier rollup and grand total to the
  cent. This is what actually happened, not an estimate.
- **Savings** (`type:"savings"`): a numbered list of concrete changes for next time (each
  grounded in something the cost breakdown actually shows — e.g. "the orchestrator's
  cache-read share was N% of spend; hub-hygiene principle 3 targets that directly") plus
  an errors/waste panel for anything scrapped, killed, or restarted (each dead sub-agent
  is money spent on nothing — name it, don't bury it in the total).

Keep the **specific dollar figures out of this reference file** — they belong in the
sprint's own generated deck, not the skill. (One measured run is cited in SKILL.md
principle 3 purely as an illustration of the *mechanism*, never as a target number.)

## Responsiveness & multi-resolution frame-check

The deck template (`assets/demo/index.html` + `deck.js`) must render **full-width and
fluid** at whatever resolution it's opened at — no fixed pixel widths that leave dead
margins on a wide display, no dependence on a specific viewport to lay out correctly,
and no body-level horizontal scrollbar at any width the frame-check covers. Content that
is inherently wide (a table, a wide chart) scrolls inside its own container, not the
page.

**Frame-check at more than one resolution** before shipping — e.g. a common desktop size
(1920×1080) and a common laptop size (1280×720) — not just whatever the recorder's
default viewport happens to be. A layout that only got checked at one width can silently
ship with dead margins or an overflow scrollbar at another; this is the same
"green-suite-isn't-proof" gap the single-resolution frame-check gate already guards
against, just along a second axis (resolution, not just content-correctness).

## Incremental builder, optional attribution footer

The deck builder should **edit the existing deck in place** across checkpoints (mid-
sprint cost run, each new clip as it lands, the final assembly) rather than regenerating
`deck.js`/`index.html` from scratch each time. In particular: **never re-encode or
re-embed a clip or image that's already in the deck** — if a slide's video/screenshot
hasn't changed, leave its existing embed untouched and only append/edit the slides that
did change. Re-encoding unchanged media wastes both compute and (if a sub-agent does the
re-embedding) more hub-hygiene-relevant tokens than the edit that actually needed making.

An optional **"Powered by Hyper Sprint" attribution footer** may be added to the cover/
close slides — **flagged, off by default**. Only add it if the caller opts in; it is
cosmetic and has no bearing on the stop rule or proof artifact requirements.

## Frame-check gate (hard requirement)

Both recorders screenshot **while driving**. *Inspect* those PNGs before shipping:
feature visible, right screen, interaction landed? A green test suite is **not** proof
the demo shows the feature — the recording is a separate artifact and can silently be
wrong (wrong key, mode never entered, clip never autoplayed). Ship only once frames
confirm **every** change is on screen — at every resolution checked (see above).

Gotchas (see `agent-profiles.md`): a Playwright-recorded VP8 `.webm` has no duration
header, so you **cannot** verify it by re-opening/seeking afterwards — the during-drive
screenshots are the check (not `ffmpeg`, whose bundled build is a stripped recorder).
Embedded clips need `--autoplay-policy=no-user-gesture-required` or they record black.

## Deck arc

Open (theme/codename) → Scope (issue list) → Burndown (real: ideal vs actual over time,
with the bug-hunt scope bump) → Session stats & retro → **Cost breakdown** → **Savings**
→ Quality (bugs found & fixed) → Live walkthrough (one embedded clip per change) → Close.
