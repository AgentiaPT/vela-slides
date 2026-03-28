#!/usr/bin/env bash
set -euo pipefail

# ── Smoke Test — Quick version comparison with any prompt ──────────
#
# Usage:
#   bash evals/scripts/smoke-test.sh "your prompt here" v4.0 v5.0 v6.0
#   bash evals/scripts/smoke-test.sh prompt.txt v5.0 v6.0
#   TIMEOUT=180 MODEL=sonnet bash evals/scripts/smoke-test.sh prompt.txt all
#
# Runs each version in parallel, compares cost/time/quality/format.

EVAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$EVAL_DIR/.." && pwd)"
TIMEOUT="${TIMEOUT:-300}"
MODEL="${MODEL:-sonnet}"
MAX_TURNS="${MAX_TURNS:-12}"
OUTDIR="/tmp/vela-smoke-$(date +%s)"

PROMPT_ARG="${1:-}"
shift || true
VERSIONS=("$@")

if [ -z "$PROMPT_ARG" ] || [ ${#VERSIONS[@]} -eq 0 ]; then
    echo "Usage: bash evals/scripts/smoke-test.sh <prompt|file> <version...>"
    echo "  bash evals/scripts/smoke-test.sh 'Make a deck about AI' v5.0 v6.0"
    echo "  bash evals/scripts/smoke-test.sh prompt.txt all"
    echo "Env: TIMEOUT=$TIMEOUT MODEL=$MODEL MAX_TURNS=$MAX_TURNS"
    exit 1
fi

# Resolve prompt
if [ -f "$PROMPT_ARG" ]; then
    PROMPT_TEXT=$(cat "$PROMPT_ARG")
else
    PROMPT_TEXT="$PROMPT_ARG"
fi

# Resolve "all" to available versions
if [ "${VERSIONS[0]}" = "all" ]; then
    VERSIONS=($(ls -d "$EVAL_DIR/skills"/*/  2>/dev/null | xargs -n1 basename | sort -V))
fi

mkdir -p "$OUTDIR"
echo "Smoke Test: ${#VERSIONS[@]} versions, timeout=${TIMEOUT}s, model=$MODEL"
echo "Output: $OUTDIR"
echo ""

# Set up and run each version
for VER in "${VERSIONS[@]}"; do
    SKILL_FILE="$EVAL_DIR/skills/$VER/SKILL.md"
    if [ ! -f "$SKILL_FILE" ]; then
        echo "  ⚠ No SKILL.md for $VER — skipping"
        continue
    fi

    WORKDIR="$OUTDIR/$VER"
    mkdir -p "$WORKDIR/.claude/skills/vela-slides" "$WORKDIR/skills/vela-slides"
    cp "$SKILL_FILE" "$WORKDIR/.claude/skills/vela-slides/SKILL.md"
    ln -sf "$REPO_ROOT/skills/vela-slides/references" "$WORKDIR/.claude/skills/vela-slides/references"
    ln -sf "$REPO_ROOT/skills/vela-slides/scripts" "$WORKDIR/.claude/skills/vela-slides/scripts"
    ln -sf "$REPO_ROOT/skills/vela-slides/references" "$WORKDIR/skills/vela-slides/references"
    ln -sf "$REPO_ROOT/skills/vela-slides/scripts" "$WORKDIR/skills/vela-slides/scripts"

    # Rewrite output path in prompt
    REWRITTEN=$(echo "$PROMPT_TEXT" | sed "s|evals/output/eval-deck.json|$WORKDIR/eval-deck.json|g")
    # If no path in prompt, append one
    if ! echo "$REWRITTEN" | grep -q "eval-deck.json"; then
        REWRITTEN="$REWRITTEN

Save as $WORKDIR/eval-deck.json and validate."
    fi
    echo "$REWRITTEN" > "$WORKDIR/prompt.txt"

    echo "  ▶ $VER starting..."
    (cd "$WORKDIR" && timeout "${TIMEOUT}s" claude -p "$(cat prompt.txt)" \
        --output-format json --model "$MODEL" --max-turns "$MAX_TURNS" \
        --allowedTools 'Bash(*)' 'Read(*)' 'Write(*)' 'Edit(*)' 'Glob(*)' 'Grep(*)' \
        > "$OUTDIR/$VER-result.json" 2>/dev/null) &
done
wait
echo ""

# Analyze results
echo "═══════════════════════════════════════════════════════════════"
echo "RESULTS"
echo "═══════════════════════════════════════════════════════════════"

python3 -c "
import json, os, subprocess

INPUT_P = 3.0 / 1e6; OUTPUT_P = 15.0 / 1e6; CR_P = 0.30 / 1e6; CW_P = 3.75 / 1e6
outdir = '$OUTDIR'

print(f'{\"Ver\":>8} {\"Cost\":>8} {\"Time\":>6} {\"Turns\":>6} {\"Format\":>8} {\"Slides\":>7} {\"Types\":>6} {\"DeckKB\":>7} {\"Valid\":>6}')
print('-' * 75)

for ver in sorted(os.listdir(outdir)):
    rf = os.path.join(outdir, f'{ver}-result.json')
    df = os.path.join(outdir, ver, 'eval-deck.json')
    if not os.path.isfile(rf): continue

    size = os.path.getsize(rf)
    if size == 0:
        print(f'{ver:>8} TIMEOUT')
        continue

    with open(rf) as f: r = json.load(f)
    u = r.get('usage', {})
    cost = u.get('input_tokens',0)*INPUT_P + u.get('output_tokens',0)*OUTPUT_P + u.get('cache_read_input_tokens',0)*CR_P + u.get('cache_creation_input_tokens',0)*CW_P
    dur = r.get('duration_ms', 0) / 1000
    turns = r.get('num_turns', 0)

    fmt = slides = types = deck_kb = '—'
    valid = '—'
    if os.path.isfile(df):
        with open(df) as f: raw = f.read()
        fmt = 'COMPACT' if raw.count('\"_\":') > raw.count('\"type\":') else 'verbose'
        deck_kb = f'{len(raw)/1024:.1f}'
        qr = subprocess.run(['python3', '$EVAL_DIR/scripts/quality.py', df, '--json'], capture_output=True, text=True)
        if qr.returncode == 0:
            q = json.loads(qr.stdout)
            slides = q.get('slide_count', 0)
            types = len(q.get('block_types_used', []))
        vr = subprocess.run(['python3', '$REPO_ROOT/skills/vela-slides/scripts/vela.py', 'deck', 'validate', df], capture_output=True, text=True)
        valid = '✅' if vr.returncode == 0 else '❌'

    print(f'{ver:>8} \${cost:.3f} {dur:>5.0f}s {turns:>6} {fmt:>8} {slides:>7} {types:>6} {deck_kb:>6}KB {valid:>6}')
"
echo ""
echo "Decks saved in: $OUTDIR/*/eval-deck.json"
