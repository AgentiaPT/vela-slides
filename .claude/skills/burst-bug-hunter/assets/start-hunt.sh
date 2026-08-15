#!/usr/bin/env bash
# start-hunt.sh <workdir> <app-url> [config.json]
# Boots ONE warm driver-server (app opened once) in the background, waits until ready.
# app-url + config are repo-specific (see the repo's .hyper-sprint/ config).
set -euo pipefail
SK="$(cd "$(dirname "$0")" && pwd)"
WD="$1"; URL="$2"; CONFIG="${3:-}"
rm -rf "$WD"; mkdir -p "$WD"
nohup node "$SK/driver-server.mjs" "$URL" "$WD" "$CONFIG" > "$WD/server.log" 2>&1 &
pid=$!
for _ in $(seq 1 450); do [ -f "$WD/ready" ] && break; sleep 0.1; done
if [ -f "$WD/ready" ]; then
  boot_ms="unknown"
  [ -f "$WD/boot-ms" ] && IFS= read -r boot_ms < "$WD/boot-ms"
  echo "READY pid=$pid workdir=$WD browserBootMs=$boot_ms"
else
  echo "FAILED"
  tail -6 "$WD/server.log"
  exit 1
fi
