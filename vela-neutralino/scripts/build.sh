#!/usr/bin/env bash
# Release build: produces dist/vela/ per-OS binaries.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tools="${HOME}/.local/vela-neutralino-tools"
neu="$tools/node_modules/.bin/neu"
[ -x "$neu" ] || { echo "neu not found. Run scripts/setup.sh first." >&2; exit 1; }
cd "$here"
[ -d bin ] || "$neu" update
python3 "$here/scripts/verify-runtime.py"
# Strip the in-app test surface before syncing (mirrors _build-desktop.yml /
# Dockerfile): regenerate the monolith with --release so sync-vela.py then
# preprocesses a release-stripped bundle, not the dev build.
python3 "$here/../tools/vela-dev/scripts/concat.py" --release --out "$here/../skills/vela-slides/app/vela.jsx" "$here/../src/parts"
python3 "$here/scripts/sync-vela.py"
# --embed-resources matches CI: resources.neu is injected into each per-OS
# binary so dist/vela/* is a single self-contained executable per platform.
exec "$neu" build --release --embed-resources
