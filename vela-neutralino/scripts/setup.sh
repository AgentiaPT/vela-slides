#!/usr/bin/env bash
# One-time setup for vela-neutralino.
#
# The repo lives on a Windows-mounted drive (drvfs, D:\). Running pnpm install
# inside the project directory is catastrophically slow *and* conflicts with
# the parent pnpm-workspace. So we install the `neu` CLI in a dedicated
# native-FS tools dir and invoke it from there.
#
# Layout after setup:
#   ~/.local/vela-neutralino-tools/
#     package.json
#     node_modules/.bin/neu        ← invoked by scripts/run.sh / build.sh
#
# The project directory itself contains zero node_modules.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tools="${HOME}/.local/vela-neutralino-tools"

mkdir -p "$tools"

# Mirror the project's neu version + .npmrc into the tools dir so pnpm has
# something to install against. Regenerated on every setup run to stay in sync.
neu_version="$(node -e 'console.log(require("'"$here"'/package.json").devDependencies["@neutralinojs/neu"])')"
cat > "$tools/package.json" <<EOF
{
  "name": "vela-neutralino-tools",
  "version": "0.0.0",
  "private": true,
  "description": "Dev tooling for vela-neutralino (kept off drvfs).",
  "devDependencies": {
    "@neutralinojs/neu": "${neu_version}"
  }
}
EOF

cp "$here/.npmrc" "$tools/.npmrc"

(
  cd "$tools"
  CI=true pnpm install --ignore-scripts --ignore-workspace
)

echo
echo "neu installed at: $tools/node_modules/.bin/neu"

# Fetch Neutralino binaries + client lib into the project. Pinned via the
# binaryVersion/clientVersion fields in neutralino.config.json. Skipped if
# bin/ already exists — re-run manually if the pin changes.
if [ ! -d "$here/bin" ]; then
  (cd "$here" && "$tools/node_modules/.bin/neu" update)
fi

echo
echo "next: bash $here/scripts/run.sh   # dev"
echo "      bash $here/scripts/build.sh # release build"
