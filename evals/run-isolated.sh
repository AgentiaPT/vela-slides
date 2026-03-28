#!/usr/bin/env bash
set -euo pipefail

# ── Vela Eval — Isolated Runner (claude -p) ─────────────────────────
# Each (version, scenario, rep) gets its own isolated working directory.
# No shared state between runs — safe for parallel execution.
#
# Usage:
#   bash evals/run-isolated.sh v3.5 create-5 1         # Single run
#   bash evals/run-isolated.sh v3.5                     # Default scenario, REPS reps
#   bash evals/run-isolated.sh all                      # All versions
#   REPS=3 MODEL=sonnet TIMEOUT=180 bash evals/run-isolated.sh v3.5
#
# Environment:
#   REPS       — repetitions per scenario (default: 2)
#   MODEL      — claude model (default: sonnet)
#   MAX_TURNS  — max agent turns (default: 12)
#   TIMEOUT    — per-run timeout in seconds (default: 180)
#   SCENARIOS_FILTER — comma-separated scenario IDs (default: all non-holdout)

EVAL_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$EVAL_DIR/.." && pwd)"
SCENARIOS="$EVAL_DIR/eval-scenarios.json"
RESULTS="$EVAL_DIR/results"
STATUS_PY="$EVAL_DIR/scripts/status.py"

REPS="${REPS:-2}"
MODEL="${MODEL:-sonnet}"
MAX_TURNS="${MAX_TURNS:-12}"
TIMEOUT="${TIMEOUT:-180}"
VERSION="${1:-}"
FILTER_SCENARIO="${2:-}"
FILTER_REP="${3:-}"

if [ -z "$VERSION" ]; then
    echo "Usage: bash run-isolated.sh <version|all> [scenario] [rep]"
    echo ""
    echo "  Quick:  REPS=1 TIMEOUT=120 bash evals/run-isolated.sh v3.5 create-5"
    echo "  Full:   REPS=3 TIMEOUT=300 bash evals/run-isolated.sh v3.5"
    echo "  Compare: bash evals/run-isolated.sh all create-5"
    echo ""
    echo "Env: REPS=$REPS MODEL=$MODEL MAX_TURNS=$MAX_TURNS TIMEOUT=${TIMEOUT}s"
    exit 1
fi

# Get scenario IDs to run
get_scenario_ids() {
    if [ -n "$FILTER_SCENARIO" ]; then
        echo "$FILTER_SCENARIO"
        return
    fi
    if [ -n "${SCENARIOS_FILTER:-}" ]; then
        echo "$SCENARIOS_FILTER" | tr ',' '\n'
        return
    fi
    python3 -c "
import json
with open('$SCENARIOS') as f:
    d = json.load(f)
for s in d['scenarios']:
    if not s.get('holdout', False):
        print(s['id'])
"
}

# Get scenario prompt, rewriting paths to use the isolated workdir
get_prompt() {
    local sid="$1"
    local workdir="$2"
    python3 -c "
import json
with open('$SCENARIOS') as f:
    d = json.load(f)
for s in d['scenarios']:
    if s['id'] == '${sid}':
        prompt = s['prompt']
        # Rewrite hardcoded paths to isolated workdir
        prompt = prompt.replace('evals/output/', '${workdir}/')
        print(prompt)
        break
"
}

# Get scenario fixture (if any)
get_fixture() {
    local sid="$1"
    python3 -c "
import json
with open('$SCENARIOS') as f:
    d = json.load(f)
for s in d['scenarios']:
    if s['id'] == '${sid}':
        print(s.get('fixture', ''))
        break
" 2>/dev/null || echo ""
}

# Get expected slide count from assertions (0 = no assertion)
get_expected_slides() {
    local sid="$1"
    python3 -c "
import json
with open('$SCENARIOS') as f:
    d = json.load(f)
for s in d['scenarios']:
    if s['id'] == '${sid}':
        for a in s.get('assertions', []):
            if a.get('type') == 'slide_count':
                print(a['expected'])
                break
        else:
            print(0)
        break
" 2>/dev/null || echo "0"
}

# Validate assertions against a deck file
validate_assertions() {
    local sid="$1"
    local workdir="$2"
    python3 -c "
import json, sys, os

with open('$SCENARIOS') as f:
    sc = json.load(f)

scenario = None
for s in sc['scenarios']:
    if s['id'] == '${sid}':
        scenario = s
        break

if not scenario:
    print(json.dumps({'passed': 0, 'total': 0, 'error': 'scenario not found'}))
    sys.exit(0)

assertions = scenario.get('assertions', [])
if not assertions:
    print(json.dumps({'passed': 1, 'total': 1, 'results': [{'type': 'no_assertions', 'passed': True}]}))
    sys.exit(0)

passed = 0
total = len(assertions)
results = []

# Try to load the deck
deck = None
deck_path = os.path.join('${workdir}', 'eval-deck.json')
raw = ''
slides = []
try:
    with open(deck_path) as f:
        deck = json.load(f)
    # Read raw file content for string matching (before json.dumps re-serialization)
    with open(deck_path) as f2:
        raw = f2.read()
    if 'lanes' in deck:
        for l in deck['lanes']:
            for it in l.get('items', []):
                slides.extend(it.get('slides', []))
    elif 'S' in deck:
        slides = deck['S']
    elif 'G' in deck:
        for g in deck['G']:
            slides.extend(g.get('S', []))
    elif isinstance(deck, list):
        slides = deck
except:
    pass

# Find block types by walking the JSON tree (not string matching — avoids
# false positives from text content and false negatives from whitespace)
types_found = set()
if deck is not None:
    def find_types(obj):
        if isinstance(obj, (int, float)):
            types_found.add('spacer')
        elif isinstance(obj, dict):
            t = obj.get('type') or obj.get('_')
            if t: types_found.add(t)
            for v in obj.values():
                find_types(v)
        elif isinstance(obj, list):
            for item in obj:
                find_types(item)
    find_types(deck)

for a in assertions:
    ok = False
    atype = a['type']
    if atype == 'file_exists':
        path = a['path'].replace('evals/output/', '${workdir}/')
        ok = os.path.isfile(path)
    elif atype == 'json_valid':
        ok = deck is not None
    elif atype == 'slide_count':
        ok = len(slides) == a['expected']
    elif atype == 'block_type_present':
        ok = a['block_type'] in types_found
    elif atype == 'text_present':
        ok = a['text'].lower() in raw.lower()
    elif atype == 'text_not_present':
        ok = a['text'].lower() not in raw.lower()
    elif atype == 'ships_ok':
        ok = len(slides) > 0
    elif atype == 'format_compact':
        # Check compact at ALL levels: top-level keys + block keys
        if deck is not None:
            has_compact_top = 'S' in deck or 'G' in deck  # flat slides or groups
            has_verbose_top = 'lanes' in deck or 'deckTitle' in deck
            has_compact_blocks = '\"_\":' in raw or '\"_\": ' in raw
            has_verbose_blocks = '\"type\":' in raw or '\"type\": ' in raw
            ok = has_compact_top and not has_verbose_top and has_compact_blocks and not has_verbose_blocks
    if ok:
        passed += 1
    results.append({'type': atype, 'passed': ok, 'detail': a.get('expected', a.get('block_type', a.get('text', '')))})

print(json.dumps({'passed': passed, 'total': total, 'slides': len(slides), 'types_found': sorted(types_found), 'results': results}))
" 2>/dev/null || echo '{"passed":0,"total":0,"error":"validation crashed"}'
}

# Run a single (version, scenario, rep)
run_one() {
    local VER="$1" SCENARIO="$2" REP="$3"
    local SKILL_FILE="$EVAL_DIR/skills/$VER/SKILL.md"
    local RUN_ID="${SCENARIO}-run${REP}"
    local START_TIME
    START_TIME=$(date +%s)

    if [ ! -f "$SKILL_FILE" ]; then
        echo "  ⚠  No SKILL.md for $VER — skipping"
        return 1
    fi

    mkdir -p "$RESULTS/$VER"

    # ── ISOLATION: each run gets its own /tmp working directory ──
    # MUST be outside the repo tree so claude -p doesn't auto-discover CLAUDE.md
    # (which contains verbose-format examples that override SKILL.md compact instructions)
    local RUN_WORKDIR="/tmp/vela-eval/${VER}/${SCENARIO}-run${REP}"
    rm -rf "$RUN_WORKDIR"
    mkdir -p "$RUN_WORKDIR"

    # Copy fixture for edit scenarios
    local FIXTURE
    FIXTURE=$(get_fixture "$SCENARIO")
    if [ -n "$FIXTURE" ] && [ -f "$EVAL_DIR/fixtures/$FIXTURE" ]; then
        cp "$EVAL_DIR/fixtures/$FIXTURE" "$RUN_WORKDIR/eval-deck.json"
        echo "    fixture: $FIXTURE → $RUN_WORKDIR/"
    fi

    echo "  ▶ $VER / $RUN_ID (model=$MODEL, timeout=${TIMEOUT}s, workdir=$RUN_WORKDIR)"

    # Get prompt with paths rewritten to isolated workdir
    local PROMPT
    PROMPT=$(get_prompt "$SCENARIO" "$RUN_WORKDIR")

    # Set up a proper skill directory structure in the workdir so claude
    # discovers vela-slides as a real skill (just like a user would have it).
    # Structure: .claude/skills/vela-slides/SKILL.md + references/ + scripts/
    local SKILL_DIR="$RUN_WORKDIR/.claude/skills/vela-slides"
    mkdir -p "$SKILL_DIR"
    cp "$SKILL_FILE" "$SKILL_DIR/SKILL.md"

    # Link references and scripts — use version-local copies if available (full-pack),
    # otherwise fall back to symlinks from the live skill.
    local VER_DIR="$EVAL_DIR/skills/$VER"
    if [ -d "$VER_DIR/scripts" ]; then
        # Full-pack version: copy scripts so fixes are tested in isolation
        cp -r "$VER_DIR/scripts" "$SKILL_DIR/scripts"
        echo "    scripts: version-local (full-pack)"
    else
        ln -sf "$REPO_ROOT/skills/vela-slides/scripts" "$SKILL_DIR/scripts"
    fi
    if [ -d "$VER_DIR/references" ]; then
        cp -r "$VER_DIR/references" "$SKILL_DIR/references"
    else
        ln -sf "$REPO_ROOT/skills/vela-slides/references" "$SKILL_DIR/references"
    fi

    # Also create the path that SKILL.md references (skills/vela-slides/scripts/vela.py)
    # so the model can find vela.py using the path written in the skill instructions
    mkdir -p "$RUN_WORKDIR/skills/vela-slides"
    if [ -d "$VER_DIR/scripts" ]; then
        cp -r "$VER_DIR/scripts" "$RUN_WORKDIR/skills/vela-slides/scripts"
    else
        ln -sf "$REPO_ROOT/skills/vela-slides/scripts" "$RUN_WORKDIR/skills/vela-slides/scripts"
    fi
    if [ -d "$VER_DIR/references" ]; then
        cp -r "$VER_DIR/references" "$RUN_WORKDIR/skills/vela-slides/references"
    else
        ln -sf "$REPO_ROOT/skills/vela-slides/references" "$RUN_WORKDIR/skills/vela-slides/references"
    fi
    # Link app/ and examples/ for template assembly and --sample/--demo flags.
    # Must be in BOTH paths: the skill discovery path (.claude/skills/) where copied
    # scripts resolve via realpath, AND the SKILL.md-referenced path (skills/).
    for target_dir in "$SKILL_DIR" "$RUN_WORKDIR/skills/vela-slides"; do
        ln -sf "$REPO_ROOT/skills/vela-slides/app" "$target_dir/app"
        ln -sf "$REPO_ROOT/skills/vela-slides/examples" "$target_dir/examples"
    done
    ln -sf "$REPO_ROOT/examples" "$RUN_WORKDIR/examples"

    # Extract effort level from SKILL.md frontmatter (if present)
    local EFFORT_FLAG=""
    local EFFORT_LEVEL
    EFFORT_LEVEL=$(python3 -c "
import re
with open('$SKILL_FILE') as f:
    content = f.read()
m = re.search(r'^effort:\s*(\w+)', content, re.MULTILINE)
if m: print(m.group(1))
" 2>/dev/null)
    if [ -n "$EFFORT_LEVEL" ]; then
        EFFORT_FLAG="--effort $EFFORT_LEVEL"
        echo "    effort: $EFFORT_LEVEL"
    fi

    # Run in isolated claude -p session with timeout.
    # Run from the workdir so claude discovers .claude/skills/vela-slides/ naturally.
    # No --system-prompt or --append — the skill is discovered via the directory.
    local RESULT TIMED_OUT=false
    RESULT=$(cd "$RUN_WORKDIR" && timeout "${TIMEOUT}s" claude -p "$PROMPT" \
        --output-format json \
        --model "$MODEL" \
        --max-turns "$MAX_TURNS" \
        $EFFORT_FLAG \
        --allowedTools 'Bash(*)' 'Read(*)' 'Write(*)' 'Edit(*)' 'Glob(*)' 'Grep(*)' \
        2>/dev/null) || {
        local EXIT_CODE=$?
        if [ $EXIT_CODE -eq 124 ]; then
            TIMED_OUT=true
            echo "    ⏰ Timed out after ${TIMEOUT}s"
            RESULT='{"is_error":true,"timed_out":true}'
        else
            RESULT='{"is_error":true}'
        fi
    }

    local END_TIME
    END_TIME=$(date +%s)
    local WALL_S=$((END_TIME - START_TIME))

    # Extract metrics from JSON output (single python call for efficiency)
    local METRICS
    METRICS=$(echo "$RESULT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
u = d.get('usage', {})
iters = u.get('iterations', [])
tools = sum(i.get('tool_uses', 0) for i in iters) if iters else d.get('num_turns', 0)
print(json.dumps({
    'session_id': d.get('session_id', 'unknown'),
    'cost': d.get('total_cost_usd', 0),
    'duration_ms': d.get('duration_ms', 0),
    'num_turns': d.get('num_turns', 0),
    'input_tokens': u.get('input_tokens', 0),
    'output_tokens': u.get('output_tokens', 0),
    'cache_read': u.get('cache_read_input_tokens', 0),
    'cache_write': u.get('cache_creation_input_tokens', 0),
    'tool_uses': tools,
    'is_error': d.get('is_error', False),
}))
" 2>/dev/null || echo '{"session_id":"unknown","cost":0,"duration_ms":0,"num_turns":0,"input_tokens":0,"output_tokens":0,"cache_read":0,"cache_write":0,"tool_uses":0,"is_error":true}')

    local SESSION_ID COST DURATION_MS NUM_TURNS INPUT_TOK OUTPUT_TOK CACHE_READ CACHE_WRITE TOOL_USES IS_ERROR
    SESSION_ID=$(echo "$METRICS" | python3 -c "import sys,json; print(json.load(sys.stdin)['session_id'])")
    COST=$(echo "$METRICS" | python3 -c "import sys,json; print(json.load(sys.stdin)['cost'])")
    DURATION_MS=$(echo "$METRICS" | python3 -c "import sys,json; print(json.load(sys.stdin)['duration_ms'])")
    NUM_TURNS=$(echo "$METRICS" | python3 -c "import sys,json; print(json.load(sys.stdin)['num_turns'])")
    INPUT_TOK=$(echo "$METRICS" | python3 -c "import sys,json; print(json.load(sys.stdin)['input_tokens'])")
    OUTPUT_TOK=$(echo "$METRICS" | python3 -c "import sys,json; print(json.load(sys.stdin)['output_tokens'])")
    CACHE_READ=$(echo "$METRICS" | python3 -c "import sys,json; print(json.load(sys.stdin)['cache_read'])")
    CACHE_WRITE=$(echo "$METRICS" | python3 -c "import sys,json; print(json.load(sys.stdin)['cache_write'])")
    TOOL_USES=$(echo "$METRICS" | python3 -c "import sys,json; print(json.load(sys.stdin)['tool_uses'])")
    IS_ERROR=$(echo "$METRICS" | python3 -c "import sys,json; print(json.load(sys.stdin)['is_error'])")

    local DUR_S
    if [ "$TIMED_OUT" = "true" ]; then
        DUR_S="$WALL_S"
    else
        DUR_S=$(python3 -c "print(round($DURATION_MS / 1000, 1))" 2>/dev/null || echo "$WALL_S")
    fi

    if [ "$IS_ERROR" = "True" ] && [ "$TIMED_OUT" = "false" ]; then
        echo "    ❌ Run failed (session=$SESSION_ID)"
        python3 -c "
import json
data = {
    'session_id': '$SESSION_ID', 'model': '$MODEL', 'version': '$VER',
    'scenario': '$SCENARIO', 'rep': int('$REP'), 'turns': 0, 'error': 'failed',
    'totals': {'input_tokens': 0, 'output_tokens': 0, 'cache_read_tokens': 0,
               'cache_write_tokens': 0, 'total_tokens': 0, 'cost_usd': 0,
               'tool_calls': 0, 'duration_s': float('$WALL_S')},
    'assertions': {'passed': 0, 'total': 0, 'results': []}
}
with open('$RESULTS/$VER/$RUN_ID.json', 'w') as f:
    json.dump(data, f, indent=2)
"
        rm -rf "$RUN_WORKDIR"
        return 1
    fi

    echo "    \$$COST | ${DUR_S}s | ${NUM_TURNS} turns | ${TOOL_USES} tools"

    # ── VALIDATE ASSERTIONS against the isolated workdir ──
    local ASSERT_JSON
    ASSERT_JSON=$(validate_assertions "$SCENARIO" "$RUN_WORKDIR")
    local ASSERT_PASSED ASSERT_TOTAL
    ASSERT_PASSED=$(echo "$ASSERT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('passed',0))" 2>/dev/null || echo "0")
    ASSERT_TOTAL=$(echo "$ASSERT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total',0))" 2>/dev/null || echo "0")

    if [ "$ASSERT_TOTAL" -gt 0 ]; then
        local ASSERT_STATUS="✅"
        [ "$ASSERT_PASSED" -lt "$ASSERT_TOTAL" ] && ASSERT_STATUS="❌"
        echo "    assertions: $ASSERT_STATUS $ASSERT_PASSED/$ASSERT_TOTAL"
    fi

    # ── QUALITY SCORING on the isolated deck ──
    local DECK_FILE="$RUN_WORKDIR/eval-deck.json"
    local QUALITY_JSON=""
    if [ -f "$DECK_FILE" ]; then
        QUALITY_JSON=$(python3 "$EVAL_DIR/scripts/quality.py" "$DECK_FILE" --json 2>/dev/null) || true
        if [ -n "$QUALITY_JSON" ]; then
            echo "    quality: $(echo "$QUALITY_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"diversity={d['block_diversity']:.0%} types={len(d['block_types_used'])} heading={d['heading_rate']:.0%}\")" 2>/dev/null || echo "parse error")"
        fi
        # Copy deck to results for reference
        cp "$DECK_FILE" "$RESULTS/$VER/$RUN_ID-deck.json" 2>/dev/null || true
    else
        echo "    ⚠  No deck output at $DECK_FILE"
    fi

    # ── SAVE RESULT with assertions + quality ──
    python3 -c "
import json

data = {
    'session_id': '$SESSION_ID',
    'model': '$MODEL',
    'version': '$VER',
    'scenario': '$SCENARIO',
    'rep': int('$REP'),
    'turns': int('$NUM_TURNS'),
    'totals': {
        'input_tokens': int('$INPUT_TOK'),
        'output_tokens': int('$OUTPUT_TOK'),
        'cache_read_tokens': int('$CACHE_READ'),
        'cache_write_tokens': int('$CACHE_WRITE'),
        'total_tokens': int('$INPUT_TOK') + int('$OUTPUT_TOK') + int('$CACHE_READ') + int('$CACHE_WRITE'),
        'cost_usd': float('$COST'),
        'tool_calls': int('$TOOL_USES'),
        'duration_s': float('$DUR_S'),
    },
}

# Add timeout flag
if '$TIMED_OUT' == 'true':
    data['error'] = 'timeout'

# Add assertions
try:
    data['assertions'] = json.loads('''$ASSERT_JSON''')
except:
    data['assertions'] = {'passed': 0, 'total': 0, 'error': 'parse_failed'}

# Add quality
quality_str = '''$QUALITY_JSON'''
if quality_str.strip():
    try:
        data['quality'] = {'deterministic': json.loads(quality_str)}
    except:
        pass

with open('$RESULTS/$VER/$RUN_ID.json', 'w') as f:
    json.dump(data, f, indent=2)
"

    # Clean up workdir (results already copied)
    rm -rf "$RUN_WORKDIR"
}

# Determine versions to run
if [ "$VERSION" = "all" ]; then
    VERSIONS=$(ls -d "$EVAL_DIR/skills"/v*/ 2>/dev/null | xargs -n1 basename | sort -V)
else
    VERSIONS="$VERSION"
fi

# Determine scenarios to run
if [ -n "$FILTER_SCENARIO" ]; then
    SCENARIO_IDS="$FILTER_SCENARIO"
else
    SCENARIO_IDS=$(get_scenario_ids)
fi

SCENARIO_COUNT=$(echo "$SCENARIO_IDS" | wc -l)
VERSION_COUNT=$(echo "$VERSIONS" | wc -w)

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Vela Eval — Isolated Runner                                ║"
echo "║  Model: $MODEL | Reps: $REPS | Timeout: ${TIMEOUT}s           "
echo "║  Versions: $(echo $VERSIONS | tr '\n' ' ')    "
echo "║  Scenarios: $SCENARIO_COUNT | Est: ~$((SCENARIO_COUNT * VERSION_COUNT * REPS * TIMEOUT / 60))min max  "
echo "╚══════════════════════════════════════════════════════════════╝"

EVAL_START=$(date +%s)

# Run
COMPLETED=0
FAILED=0
for VER in $VERSIONS; do
    echo ""
    echo "━━━ Version: $VER ($(wc -c < "$EVAL_DIR/skills/$VER/SKILL.md") bytes) ━━━"

    for SCENARIO in $SCENARIO_IDS; do
        if [ -n "$FILTER_REP" ]; then
            run_one "$VER" "$SCENARIO" "$FILTER_REP" && COMPLETED=$((COMPLETED + 1)) || FAILED=$((FAILED + 1))
        else
            for REP in $(seq 1 "$REPS"); do
                run_one "$VER" "$SCENARIO" "$REP" && COMPLETED=$((COMPLETED + 1)) || FAILED=$((FAILED + 1))
            done
        fi
    done
done

EVAL_END=$(date +%s)
EVAL_DUR=$((EVAL_END - EVAL_START))

echo ""
echo "━━━ Done in ${EVAL_DUR}s ━━━"
echo "  Completed: $COMPLETED | Failed: $FAILED"
echo "  Results: $RESULTS/"

# Auto-generate report if we have results
if [ $COMPLETED -gt 0 ]; then
    echo ""
    python3 "$EVAL_DIR/scripts/report.py" "$RESULTS/"
fi
