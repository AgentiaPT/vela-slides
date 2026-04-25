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
# Inspector is disabled in neutralino.config.json (release-safe default).
# Re-enable it for dev only via Neutralino's runtime CLI override —
# `--` separates neu's own args from args forwarded to the binary.
exec "$neu" run -- --window-enable-inspector=true
