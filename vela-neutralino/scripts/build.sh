#!/usr/bin/env bash
# Release build: produces dist/vela/ per-OS binaries.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tools="${HOME}/.local/vela-neutralino-tools"
neu="$tools/node_modules/.bin/neu"
[ -x "$neu" ] || { echo "neu not found. Run scripts/setup.sh first." >&2; exit 1; }
cd "$here"
[ -d bin ] || "$neu" update
python3 "$here/scripts/sync-vela.py"
exec "$neu" build --release
