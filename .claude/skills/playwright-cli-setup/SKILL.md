---
name: playwright-cli-setup
description: For ad-hoc testing and exploration of Vela, drive the app with the Playwright CLI (@playwright/cli — the token-efficient CLI alternative to Playwright MCP) INSTEAD OF writing throwaway Playwright code files: you keep the browser warm and inspect page state and command output between every step, so you reason and adapt in real time instead of running a script blind and re-editing it when a step fails. Gets a LIVE Vela app running in a real browser inside this remote-execution container, cleanly and offline. Use whenever you want to interactively poke the rendered app one command at a time — screenshot a state, reproduce a bug, drive presenter/gallery flows, run the interaction benchmark (bench/vela-interaction-bench.sh), or verify a UX change actually works. Captures the exact setup so you skip the dead-ends (blocked CDNs, file:// block, Chromium revision mismatch).
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

**1. Restore the locked deps, then install the CLI isolated** (see *Supply-chain
safety* below for why it's not committed):
```bash
npm ci --ignore-scripts                                                   # locked tree first
npm install --no-save --no-audit --no-fund --ignore-scripts @playwright/cli@0.1.15
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

## Supply-chain safety (why `@playwright/cli` is NOT committed)

This repo pins its supply chain via a committed `package-lock.json` (exact
versions + sha512), `npm ci --ignore-scripts` in CI, `npm audit` gating, and a
7-day release-cooldown (`.npmrc: ignore-scripts=true`, see docs/SECURITY.md).

`@playwright/cli@0.1.15` transitively depends on a **days-old alpha** of
`playwright` (nested in its own `node_modules`, so it does **not** override the
repo's locked top-level `playwright`). Committing it would pull that fresh alpha
into the audited, shipped dependency tree — against the cooldown policy. So it is
deliberately kept **out** of `package.json` / `package-lock.json` and installed as
an isolated, dev/test-only tool. The install is hardened accordingly:

- **`@playwright/cli@0.1.15`** — exact version pin, no range (no surprise upgrades).
- **`--ignore-scripts`** — blocks pre/post-install hooks (belt-and-suspenders with
  `.npmrc: ignore-scripts=true`); the #1 npm supply-chain vector.
- **`--no-save`** — never writes to `package.json`/`package-lock.json`; the audited,
  shipped tree stays exactly as locked. `npm` still verifies the registry sha512 on
  download.
- **Ephemeral & unshipped** — `node_modules/` is gitignored; the CLI never enters
  the Vela artifact, a release, or CI's locked install.
- Always run `npm ci --ignore-scripts` **first** so the top-level `playwright`/etc.
  match the lockfile (an ad-hoc `npm install` earlier can drift them).

Before bumping the pin, check the new version's transitive `playwright` dep
(`npm view @playwright/cli@<v> dependencies`) and prefer a version that resolves a
**stable** playwright once one ships.

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

## Parallel agents — isolating concurrent browser tests

Multiple agents can drive Vela at once, but they share one machine-wide session
registry (`~/.cache/...`) and one per-cwd output dir. Verified isolation ladder,
weakest → strongest:

| axis | how | what it isolates | gotcha |
|------|-----|------------------|--------|
| **session name** | `-s=agentA` vs `-s=agentB` | the browser + page state (independent — one advancing slides doesn't move the other) | same registry & same `.playwright-cli/` output dir |
| **registry** | `PWTEST_DAEMON_SESSION_DIR=/tmp/agentA-daemon` (per agent) | the whole session daemon — an agent's sessions are invisible to another's `list`/`close-all`/`kill-all` | must set it on **every** command for that agent |
| **workspace/cwd** | run each agent from its own dir / git worktree | session namespace **and** the `.playwright-cli/` output dir (both keyed off `findWorkspaceDir(cwd)`) | needs a separate checkout |

**Recommended patterns**

- **Best:** give each parallel agent its own **git worktree** (the Agent tool's
  `isolation: "worktree"`). Different cwd ⇒ different workspace ⇒ separate session
  namespace *and* separate `.playwright-cli/` output, for free. Add a unique
  `-s=<name>` per agent too.
- **Same cwd:** give each agent a unique `-s=<name>` **and** a unique
  `PWTEST_DAEMON_SESSION_DIR` — otherwise one agent's `close-all`/`kill-all` kills
  **every** agent's browsers (the single biggest footgun). Output files still land in
  the shared `.playwright-cli/` (timestamped names rarely collide, but they intermix).

**Two things that make this easy here:** the offline `file://` render needs **no
port**, so parallel sessions never collide on a port (unlike serving over HTTP); and
each deck can render to its own `/tmp/<agent>-render` dir. **Cost:** each session is a
full Chromium (~200-300 MB RAM) — cap concurrency to the box, and never use the global
`close-all`/`kill-all` from a parallel agent unless its registry is isolated.

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
