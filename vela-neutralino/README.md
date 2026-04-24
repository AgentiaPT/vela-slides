# vela-neutralino

Vela slides desktop app shell, built on [Neutralino.js](https://github.com/neutralinojs/neutralinojs).

This wraps the existing Vela monolith (`skills/vela-slides/app/vela.jsx`) in a native window and will route Vera's LLM calls to local CLI coding agents (Claude Code, GitHub Copilot CLI, Codex CLI). See `/home/rquintino/.claude/plans/i-would-like-to-curried-simon.md` for the full design.

**Status:** PR1 scaffold — placeholder page only, no Vela yet.

## Prerequisites

- `pnpm` 9+
- A working Neutralino runtime will be downloaded by `neu update` on first run.

## WSL2 / mounted-drive note

This project lives on a Windows-mounted drive (`D:\`). Running `pnpm install` inside the project conflicts with the parent `pnpm-workspace.yaml` **and** is catastrophically slow on drvfs. So we install the `neu` CLI in a dedicated off-tree tools directory at `~/.local/vela-neutralino-tools/` and invoke it from there via wrapper scripts. The project directory itself has **zero** `node_modules`.

## Setup

```bash
bash scripts/setup.sh          # pnpm install into ~/.local/vela-neutralino-tools/
```

## Develop

```bash
bash scripts/run.sh            # neu run — opens a window with the placeholder page
```

## Build

```bash
bash scripts/build.sh          # neu build --release — produces dist/vela/ per OS
```

## Debugging

DevTools is **off by default** so release builds ship clean. To re-enable while debugging, flip `modes.window.enableInspector` to `true` in `neutralino.config.json` and re-run.

## Layout

```
vela-neutralino/
  neutralino.config.json       # app id, window, nativeAllowList
  package.json                 # dev-only: @neutralinojs/neu
  resources/
    index.html                 # placeholder page (PR1) → Vela shell (PR2)
    js/neutralino.js           # client lib (downloaded by `neu update`)
    vendor/                    # will hold pinned React, ReactDOM, lucide, Babel (PR2)
    vela.jsx                   # copied from skills/vela-slides/app/ at build time (PR2)
  scripts/
    setup.sh                   # pnpm install into ~/.local/vela-neutralino-tools/
    run.sh                     # dev run (wraps off-tree `neu run`)
    build.sh                   # release build (wraps off-tree `neu build --release`)
    sync-vela.sh               # copy vela.jsx into resources (PR2)
```

## Security & supply chain

- `.npmrc` enforces `minimum-release-age=10080` (7-day cooldown) and `ignore-scripts=true`.
- Only `@neutralinojs/neu` is installed (dev-only). Audited 2026-04-23: publisher `shalithasuranga` (Neutralino.js creator), MIT, 2.8k weekly downloads, 6-year history, clean transitive deps.
- `nativeAllowList` in `neutralino.config.json` restricts which native APIs the webview can call.
