---
name: vela-live-render
description: Offline in-container render harness for the FULL Vela app (no CDN) plus the committed `vela-drive.js` scripts — headless UI-test battery, scripted screenshot, recorded demo video. Use for REPEATABLE, COMMITTED automation where the harness itself is the deliverable — running the UI battery in CI, recording a demo video, a scripted screenshot in a benchmark. For AD-HOC / INTERACTIVE work — explore/test the app, poke a state, reproduce a bug, a one-off screenshot, verify a UX change, drive presenter/gallery — use the `playwright-cli-setup` skill instead (a persistent CLI browser driven step by step). This skill still documents the blocked-CDN offline render recipe that both skills share.
---

# Vela live render (offline, in-container)

> **Routing:** the `vela-drive.js` commands here are **code-based scripts for
> repeatable, committed automation only** (CI UI battery, recorded demo videos,
> benchmark screenshots). If you're doing a **one-off / interactive** task —
> exploring the app, reproducing a bug, a quick screenshot, verifying a UX change —
> stop and use the **`playwright-cli-setup`** skill instead: a persistent browser you
> drive one command at a time, inspecting state between steps. Same offline render,
> better fit for exploration.

The container **blocks the React/lucide CDNs (esm.sh) and the Playwright browser CDN**.
`serve.py`'s default HTML uses an esm.sh importmap and therefore **never boots here**.
Do NOT waste time trying to reach esm.sh, run `npx playwright install`, or debug
`serve.py`'s CDN path. Use the offline harness below — it reuses the Neutralino
desktop shell's proven recipe: **vendored UMD React/ReactDOM/lucide-react + Babel,
transpiled in Node, loaded as an EXTERNAL `<script>`.**

## One-time environment facts (already true in this container)
- Prebuilt Chromium: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
  (the npm `playwright` expects a newer build → `executablePath` must be pinned;
  `vela-drive.js` already does this).
- ffmpeg (for webm→mp4/gif if needed): `/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux`
- Vendored UMD libs: `vela-neutralino/resources/vendor/{react,react-dom,lucide-react,babel}.min.js`
- The two Node security suites need `jsdom`: `npm i jsdom` (once).
- `serve.py` needs `--no-auth` and, if binding a port in a Bash tool, the sandbox
  may SIGKILL listeners (exit 144) → prefer the file:// harness below, which needs
  no server at all.

## Quick start
```bash
# 1. Build the monolith (only after editing part-files)
python3 skills/vela-slides/scripts/concat.py

# 2. Build an offline render of a deck (STARTUP_PATCH-injected, transpiled)
node skills/vela-slides/scripts/render-offline.js examples/vela-demo.vela /tmp/vout

# 3a. Boot-check + screenshot (great for eyeballing a change)
node skills/vela-slides/scripts/vela-drive.js shot /tmp/vout/render.html /tmp/shot.png --w 1280 --h 800
#     add: --eval "window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}))" --wait 500

# 3b. Run the in-app UI-test battery headless (needs the window.__velaRunUITests hook,
#     see part-uitest.jsx). Exits non-zero on any failure; --json dumps results.
node skills/vela-slides/scripts/vela-drive.js uitests /tmp/vout/render.html --json /tmp/ui.json

# 3c. Record a demo video (webm). scenario.js: module.exports = async (page, h) => {...}
#     helpers h = { key, click, type, wait, shot, caption, clearCaption, page }
node skills/vela-slides/scripts/vela-drive.js video /tmp/vout/render.html /tmp/vid --script scenario.js
```

## Gotchas already solved (don't rediscover)
- **Never inline the 1.1MB monolith as `<script type="text/babel">`** — it contains
  literal `</script>` inside XSS-test string payloads, which truncates the block
  ("Unterminated string constant"). `render-offline.js` transpiles in Node and
  loads an **external** `app.js` instead.
- Strip the three ESM `import` lines (react/lucide) and `export default function` →
  UMD-global shim; inject the deck via the `const STARTUP_PATCH = null;` sentinel
  (identical to `assemble.py`).
- `ERR_INVALID_URL` / `ERR_CONNECTION_CLOSED` console errors are just Google-Fonts /
  external asset fetches — **harmless**, the app renders fully without them.

## Headless UI-test hook
`part-uitest.jsx` exposes `window.__velaRunUITests()` → resolves to the results
array and also sets `window.__velaUITestResults`. `vela-drive.js uitests` uses it.
Add new UI suites via `uiSuite("Name", [{ name, fn: async () => {...} }])`.
