#!/usr/bin/env bash
# burst-boot.sh <deck.vela> <outdir>
# Vela-specific: build the offline render and print its file:// URL on the LAST line.
# The generic burst-bug-hunter skill calls this to get a bootable app URL.
set -euo pipefail
DECK="${1:?usage: burst-boot.sh <deck.vela> <outdir>}"
OUT="${2:?usage: burst-boot.sh <deck.vela> <outdir>}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
python3 skills/vela-slides/scripts/concat.py >/dev/null 2>&1
# hyper-sprint.render-offline.js lives at repo root (see .hyper-sprint/config.md); it
# exposes window.__velaReset + window.__velaBooted.
node hyper-sprint.render-offline.js "$DECK" "$OUT" >/dev/null 2>&1
echo "file://$OUT/render.html"
