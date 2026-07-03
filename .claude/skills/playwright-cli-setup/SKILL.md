---
name: playwright-cli-setup
description: Get the Playwright CLI (@playwright/cli — the token-efficient CLI alternative to Playwright MCP) driving a LIVE Vela app in a real browser inside this remote-execution container, cleanly and offline. Use whenever you want to interactively poke the rendered app one command at a time — screenshot a state, reproduce a bug, drive presenter/gallery flows, run the interaction benchmark (bench/vela-interaction-bench.sh), or verify a UX change actually works. Captures the exact setup so you skip the dead-ends (blocked CDNs, file:// block, Chromium revision mismatch).
allowed-tools: Bash(npx playwright-cli*), Bash(npm install*), Bash(node skills/vela-slides/scripts/*), Bash(node_modules/.bin/playwright-cli*), Read, Write, Edit, Glob, Grep
---

# Playwright CLI ↔ Vela setup (this container)

`@playwright/cli` keeps a **persistent browser as a background session** (`-s=<name>`)
and you drive it one command at a time — `open`, `goto`, `snapshot`, `click e15`,
`press ArrowRight`, `eval "…"` — reading state between steps instead of running a
blind script. `window` globals survive across invocations, so a helper installed
once (e.g. a timing harness) stays live. Output (snapshots, console logs) is written
to `.playwright-cli/` (gitignored); read only what you need.

It is a **different package** from `playwright` and from Playwright MCP. Prefer it
here for interactive/exploratory driving; it's cheaper on context than MCP (nothing
streams into the conversation unless you read a file).

## Setup — do this once per fresh container

**1. Install** (`node_modules` is ephemeral/gitignored, like jsdom/playwright):
```bash
npm install --no-audit --no-fund --ignore-scripts @playwright/cli
```

**2. Config is already committed** at `.playwright/cli.config.json` (the default
config path, read from the repo root). It solves the two things that otherwise fail:
```json
{
  "allowUnrestrictedFileAccess": true,
  "browser": {
    "browserName": "chromium",
    "launchOptions": {
      "executablePath": "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
      "headless": true,
      "args": ["--no-sandbox"]
    }
  }
}
```
Recreate it if missing. Update `executablePath` if the image's Chromium moves
(`ls /opt/pw-browsers/`).

## Drive a Vela deck

```bash
# 1. Build an OFFLINE render (transpiled, deck injected via STARTUP_PATCH).
#    Do NOT serve.py / esm.sh here — the React/lucide CDNs are blocked.
node skills/vela-slides/scripts/render-offline.js examples/vela-demo.vela /tmp/vout

# 2. Open a persistent session on the render (file:// works via the config).
npx playwright-cli -s=vela open "file:///tmp/vout/render.html"

# 3. Wait for hydration (~2–4s; offline app.js transpiles then mounts).
npx playwright-cli -s=vela eval "({b:!!window.__velaBooted, blocks:document.querySelectorAll('[data-block-type]').length})" --raw

# 4. Drive it. Examples:
npx playwright-cli -s=vela press f            # enter presentation (auto-selects 1st module)
npx playwright-cli -s=vela press ArrowRight   # next slide
npx playwright-cli -s=vela screenshot --filename=/tmp/slide.png
npx playwright-cli -s=vela eval "(document.querySelector('[data-block-type=heading]')||{}).textContent" --raw

# 5. Housekeeping.
npx playwright-cli list
npx playwright-cli -s=vela close
npx playwright-cli kill-all        # nuke stale/zombie browsers
```

Tip: `node_modules/.bin/playwright-cli` skips `npx` resolution overhead in loops.

## Vela-specific hooks & selectors (for `eval` / interaction)

| what | how |
|------|-----|
| boot done | `window.__velaBooted === true` and `#root` innerText non-empty |
| headless UI battery | `await window.__velaRunUITests()` (see part-uitest.jsx) |
| current slide blocks | `[data-block-type]` elements (text signature changes on nav) |
| current heading | `[data-block-type=heading]` |
| in presentation? | `<header>` is **removed** while presenting |
| gallery open? | `[data-testid=gallery-close]` present |
| gallery scroll rail | `[data-scroll-container]` |
| enter/exit present | key `f` (or `F5`); `Escape` exits |
| next / prev slide | `ArrowRight` / `ArrowLeft` |
| open gallery | key `g` |

Note: `window.__velaGetCurrentSlide` is gated behind local mode (off in offline
renders) — use the DOM signals above instead.

## Gotchas already solved (don't rediscover)

- **`file://` is blocked by default** → *"Access to file: protocol is blocked"*.
  Fixed by `allowUnrestrictedFileAccess: true` in the config (or env
  `PLAYWRIGHT_MCP_ALLOW_UNRESTRICTED_FILE_ACCESS=1`). Config is read at `open`
  time — if you change it, `close` and re-`open` the session.
- **Bundled playwright-core wants a newer Chromium** than the image ships
  (expects ~1229, image has 1194) → the CDN download is blocked, so the config's
  `executablePath` points at the pinned build. Don't run `playwright install`.
- **CDNs (esm.sh / React / lucide / Babel) are blocked** → never use `serve.py`'s
  default importmap HTML; always `render-offline.js` (vendored UMD + Node transpile).
- **One harmless console error** on every load (`ERR_INVALID_URL` / font fetch) —
  ignore it; the app renders fully.
- **Don't `pkill` background jobs** from a Bash tool here — the sandbox may SIGKILL
  the shell (exit 144). Use `playwright-cli close` / `kill-all` for browsers.

## Ready-made benchmark

`bench/vela-interaction-bench.sh` uses exactly this setup to measure slide-nav /
interaction latency and thumbnail-scroll FPS. See `bench/README.md`.
