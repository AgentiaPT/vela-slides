# Vela interaction benchmark

Measures the **latency the user actually feels** for Vela's core interactions,
driven with the Playwright CLI (`@playwright/cli`) against a live offline render in
the container's pinned Chromium.

## Run it

```bash
# one-time (ephemeral node_modules) + committed .playwright/cli.config.json.
# @playwright/cli is installed isolated & script-blocked — NOT committed to the
# locked tree (it drags a fresh alpha playwright). See the playwright-cli-setup skill.
npm ci --ignore-scripts
npm install --no-save --no-audit --no-fund --ignore-scripts @playwright/cli@0.1.15

bench/vela-interaction-bench.sh                              # default: examples/vela-demo.vela, 1 run
bench/vela-interaction-bench.sh examples/tech-talk.vela --json bench/out.json
RUNS=3 MAXSLIDES=10 bench/vela-interaction-bench.sh          # 3 runs, cap the slide sweep
```

Setup details (pinned Chromium, `file://` access, offline render, blocked CDNs) are
in the **`playwright-cli-setup`** skill. A full-deck run over the 28-slide demo takes
a few minutes (each interaction is a separate CLI invocation, by design).

## What it measures & how

For each interaction it arms an in-page signal, sends a **real (trusted) key via the
CLI**, and reads the latency measured *inside the page*:

- an in-page capture-phase `keydown` listener stamps `performance.now()` when the key
  lands;
- a `MutationObserver` + `requestAnimationFrame` loop stamps the first DOM change that
  flips the interaction's signature;
- `latency = doneT − keyT` — so CDP/Node round-trip is **excluded**; you get the
  in-browser input→render time, not the harness's plumbing.

| interaction      | key           | signal (DOM) |
|------------------|---------------|--------------|
| present-enter    | `f`           | `<header>` removed (also auto-selects the first module) |
| next / prev slide| `ArrowRight` / `ArrowLeft` | `[data-block-type]` text signature changes |
| gallery-open     | `g`           | `[data-testid=gallery-close]` appears |
| gallery-close    | `Escape`      | overlay gone |
| present-exit     | `Escape`/`f`  | `<header>` back |
| thumbnail-scroll | wheel (async `eval`) | rAF frame intervals → median FPS + worst frame |

Output is a per-action table (n, mean, p50, p95, max) plus gallery-scroll FPS, and
optional `--json`.

## Baseline (examples/vela-demo.vela, headless Chromium-1194, 1 run)

Committed machine-readable baseline: [`baseline.json`](./baseline.json). Indicative
figures — headless timing is noisier than a real GPU display, so treat as a
regression tripwire, not a hard SLA:

| action        | n  | p50   | p95   |
|---------------|----|-------|-------|
| present-enter | 1  | ~24ms | —     |
| next-slide    | 27 | ~10ms | ~15ms |
| prev-slide    | 27 | ~9ms  | ~14ms |
| gallery-open  | 1  | ~100ms| —     |
| gallery-close | 1  | ~8ms  | —     |
| present-exit  | 1  | ~16ms | —     |

gallery-scroll: **~60 fps**, worst frame ~50ms (first-render hitch while thumbnails paint).

**A regression looks like:** next-slide p50 creeping over one frame budget (>16ms),
gallery-open climbing past a few hundred ms, or scroll FPS falling well under 60.
Re-run after changes to `part-slides.jsx` (SlidePanel / GalleryView), block
renderers, or the reducer's slide-index path.
