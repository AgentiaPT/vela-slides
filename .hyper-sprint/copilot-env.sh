#!/usr/bin/env sh

export VELA_DEV_WORK_ROOT="${VELA_DEV_WORK_ROOT:-/home/agent/.local/share/vela-slides}"
# Put the provisioned Vela package store first, so Node finds it before any package
# store from an existing NODE_PATH. Keep the existing NODE_PATH after it instead of
# overwriting it, so a new worktree does not lose a package path set by the caller.
export NODE_PATH="$VELA_DEV_WORK_ROOT/npm/node_modules${NODE_PATH:+:$NODE_PATH}"
# One provisioned Chromium path, exported under both names a tool may read:
# driver-server.mjs / play-deck.mjs / record-demo.mjs read CHROME_PATH; vela-drive.js
# reads PLAYWRIGHT_CHROMIUM_EXECUTABLE. Each keeps any value the caller already set.
VELA_CHROME_DEFAULT="$VELA_DEV_WORK_ROOT/browsers/chromium-1194/chrome-linux/chrome"
export CHROME_PATH="${CHROME_PATH:-$VELA_CHROME_DEFAULT}"
export PLAYWRIGHT_CHROMIUM_EXECUTABLE="${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-$VELA_CHROME_DEFAULT}"
# This repo's burst-hunter.json sets jobTimeoutMs=20000; driver-server.mjs's own
# recoverBudgetMs default is 5000 — a combined 25s server-side budget. The client
# wait must stay ABOVE that combined budget, with margin for vrun's own 0.2s poll
# step and normal process scheduling — never equal to it (an equal value has zero
# margin: a job queued right behind a timed-out one can return after the client
# already gave up). Keep this a few seconds above 25s; do not drop it back to 25.
# .hyper-sprint/test-vrun-wait-margin.mjs asserts this margin.
export VRUN_WAIT="${VRUN_WAIT:-30}"
export PATH="/home/agent/.local/bin:$PATH"
