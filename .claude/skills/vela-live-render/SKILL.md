---
name: vela-live-render
description: Run the FULL Vela app live in a real browser inside the remote-execution container (offline, no CDN) — to visually verify UX changes, run the in-app UI-test battery headless, reproduce a reported bug, screenshot a feature, or record a demo video. Use whenever a change needs to be seen actually working in the rendered app (not just source/unit tests), e.g. list/section drag-drop, presenter mode, dialogs, hide/unhide, header stats. A full AI mode is also available (opt-in) — drive the real Vera/AI features against the local `claude` CLI via `vela-drive.js ai`.
---

# Vela live render (offline, in-container)

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

# 3d. Test AI integration against the local `claude` CLI (real round-trips).
#     One command: starts the tool-sandboxed channel backend (agent_backend.py)
#     on a free loopback port, builds an agent-mode render, boots it, and runs
#     the real Vera engine helpers (callClaudeAPI, callVera, generateSlide),
#     asserting deck mutations. Each probe is a paid claude call — dev/QA only.
node skills/vela-slides/scripts/vela-drive.js ai examples/vela-demo.vela --json /tmp/ai.json
#     limit which probes run: --only ping,veraAddSlide
```

## AI integration testing (mode: `ai`)
The `ai` mode is how you verify Vera/AI features actually work in this
container. It wires the app's local-mode channel (`VELA_CHANNEL_PORT`) to
`agent_backend.py`, which spawns `claude -p` locked down to a pure text
completion (`--tools "" --strict-mcp-config --setting-sources ""` — no tools,
no MCP, no hooks; same contract as the Neutralino gatekeeper, enforced by a
parity test). To add a feature check, add a probe to `AI_PROBES` in
`vela-drive.js` (call the real engine global and assert the result). To wire
AI into any other harness mode, build with `render-offline.js … --channel-port
<port>` while a channel is running.

**AI is opt-in / OFF by default.** The channel spawns the user's `claude` (their
credentials/spend), so it never starts implicitly. Enable it deliberately:
`vela-drive.js ai` (dev/testing), `render-offline.js … --channel-port N`, or, for
a real served session, `vela server start <folder> --ai`. The channel is
loopback-only, Host/Origin-checked, token-gated, and caps concurrent spawns.

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
