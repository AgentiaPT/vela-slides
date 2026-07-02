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
   metrics, bugs, retro, bullets, video`. Point `video` slides at `clips/<name>.webm`.
3. **`assets/sprint-stats.py`** — profile-aware stats for the burndown + retro:
   `python3 sprint-stats.py --transcript <path>` (git-only if no transcript). Feed the
   numbers into the `chart` (ideal-vs-actual burndown) and `retro` slides.
4. **`assets/play-deck.mjs`** — records the finished deck as **one integrated video**
   (`node play-deck.mjs <deck-dir> [out.webm]`), dwelling per slide, letting each
   embedded clip play once, and screenshotting mid-slide. This run-through is the
   **final deliverable**.

## Frame-check gate (hard requirement)

Both recorders screenshot **while driving**. *Inspect* those PNGs before shipping:
feature visible, right screen, interaction landed? A green test suite is **not** proof
the demo shows the feature — the recording is a separate artifact and can silently be
wrong (wrong key, mode never entered, clip never autoplayed). Ship only once frames
confirm **every** change is on screen.

Gotchas (see `agent-profiles.md`): a Playwright-recorded VP8 `.webm` has no duration
header, so you **cannot** verify it by re-opening/seeking afterwards — the during-drive
screenshots are the check (not `ffmpeg`, whose bundled build is a stripped recorder).
Embedded clips need `--autoplay-policy=no-user-gesture-required` or they record black.

## Deck arc

Open (theme/codename) → Scope (issue list) → Burndown (real: ideal vs actual over time,
with the bug-hunt scope bump) → Session stats & retro → Quality (bugs found & fixed) →
Live walkthrough (one embedded clip per change) → Close.
