#!/usr/bin/env bash
# snapshot.sh — wrapper for ccusage snapshots (no elevated permissions needed)
# Usage:
#   bash evals/scripts/snapshot.sh before
#   bash evals/scripts/snapshot.sh after [--json]

EVAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CCUSAGE=$(find /tmp/claude-1000/.npm-cache/_npx -name "ccusage" -path "*/node_modules/.bin/*" 2>/dev/null | head -1)
DT=$(date +%Y%m%d)
RAW="/tmp/claude-1000/ccusage_raw.json"

if [ -z "$CCUSAGE" ]; then
    echo "ccusage not found" >&2; exit 1
fi

# Fetch once to temp file
$CCUSAGE session --json --since "$DT" 2>/dev/null > "$RAW"

# Pipe to Python
cat "$RAW" | python3 "$EVAL_DIR/scripts/snapshot.py" "$@"
