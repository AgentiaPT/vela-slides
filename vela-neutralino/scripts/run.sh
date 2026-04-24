#!/usr/bin/env bash
# Dev run: invokes the out-of-tree `neu` CLI with the project as cwd.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tools="${HOME}/.local/vela-neutralino-tools"
neu="$tools/node_modules/.bin/neu"
[ -x "$neu" ] || { echo "neu not found. Run scripts/setup.sh first." >&2; exit 1; }
cd "$here"
[ -d bin ] || "$neu" update
python3 "$here/scripts/sync-vela.py"
# To debug with DevTools, flip "enableInspector" to true in
# neutralino.config.json (window.enableInspector). Release builds ship false.
exec "$neu" run
