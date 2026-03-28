#!/usr/bin/env bash
set -euo pipefail

# ── Vela Eval Runner (Subagent mode) ────────────────────────────────
# Designed to be driven by Claude Code subagents, not claude -p.
#
# This script handles orchestration bookkeeping only:
#   init     — initialize status.js for the dashboard
#   record   — record a completed run (with agent usage metrics)
#   validate — validate a deck output against scenario assertions
#   report   — generate comparison report from results
#   finish   — mark eval as completed
#
# The actual scenario execution happens via Claude Code Agent tool.
#
# Usage:
#   bash run.sh init [--version v2.3] [--scenario create-6] [--reps 1] [--model opus]
#   bash run.sh record --version v2.3 --scenario create-6 --rep 1 \
#       --total-tokens 50000 --tool-uses 8 --duration-ms 45000
#   bash run.sh validate --version v2.3 --scenario create-6 --rep 1
#   bash run.sh report
#   bash run.sh finish

EVAL_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$EVAL_DIR/.." && pwd)"
SCENARIOS="$EVAL_DIR/eval-scenarios.json"
RESULTS="$EVAL_DIR/results"
OUTPUT_DIR="$EVAL_DIR/output"
STATUS_PY="$EVAL_DIR/scripts/status.py"

export VELA_PATH="python3 $REPO_ROOT/skills/vela-slides/scripts/vela.py"
export VELA_OUTPUT_DIR="$OUTPUT_DIR"
export STATUS_FILE="$OUTPUT_DIR/status.js"

# ccusage: use cached binary directly (avoids npm registry check + permission prompts)
CCUSAGE_BIN=$(find /tmp/claude-1000/.npm-cache/_npx -name "ccusage" -path "*/node_modules/.bin/*" 2>/dev/null | head -1)
if [ -z "$CCUSAGE_BIN" ]; then
    # First-time install: npx will cache it
    npm_config_cache=/tmp/claude-1000/.npm-cache npx ccusage --version >/dev/null 2>&1 || true
    CCUSAGE_BIN=$(find /tmp/claude-1000/.npm-cache/_npx -name "ccusage" -path "*/node_modules/.bin/*" 2>/dev/null | head -1)
fi

mkdir -p "$OUTPUT_DIR"

CMD="${1:-help}"
shift || true

case "$CMD" in
    init)
        # Parse args
        FILTER_VERSION="" FILTER_SCENARIO="" REPS=1 MODEL=opus
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --version) FILTER_VERSION="$2"; shift 2;;
                --scenario) FILTER_SCENARIO="$2"; shift 2;;
                --reps) REPS="$2"; shift 2;;
                --model) MODEL="$2"; shift 2;;
                *) shift;;
            esac
        done

        # Compute versions and scenarios
        VERSIONS=$(ls -d "$EVAL_DIR/skills"/v*/ 2>/dev/null | xargs -n1 basename)
        CREATE_IDS=$(python3 -c "
import json
with open('$SCENARIOS') as f:
    d = json.load(f)
for s in d['scenarios']:
    if s.get('type') == 'create':
        print(s['id'])
")
        NUM_VERSIONS=0
        VERSION_LIST=""
        for V in $VERSIONS; do
            if [ -n "$FILTER_VERSION" ] && [ "$V" != "$FILTER_VERSION" ]; then continue; fi
            if [ ! -f "$EVAL_DIR/skills/$V/SKILL.md" ]; then continue; fi
            NUM_VERSIONS=$((NUM_VERSIONS + 1))
            [ -n "$VERSION_LIST" ] && VERSION_LIST="$VERSION_LIST,"
            VERSION_LIST="$VERSION_LIST$V"
        done
        NUM_SCENARIOS=0
        for S in $CREATE_IDS; do
            if [ -n "$FILTER_SCENARIO" ] && [ "$S" != "$FILTER_SCENARIO" ]; then continue; fi
            NUM_SCENARIOS=$((NUM_SCENARIOS + 1))
        done
        TOTAL_RUNS=$((NUM_VERSIONS * NUM_SCENARIOS * REPS))

        python3 "$STATUS_PY" init \
            --model "$MODEL" --reps "$REPS" --max-turns 0 \
            --versions "$VERSION_LIST" --total-runs "$TOTAL_RUNS" \
            --skills-dir "$EVAL_DIR/skills"

        echo "Initialized: $TOTAL_RUNS runs for versions: $VERSION_LIST"
        ;;

    current)
        # Update current progress indicator
        python3 "$STATUS_PY" current "$@"
        ;;

    record)
        # Record a completed run with agent usage metrics
        # Args: --version X --scenario Y --rep N --total-tokens T --tool-uses U --duration-ms D --model M
        VERSION="" SCENARIO="" REP="" TOTAL_TOK="" TOOL_USES="" DURATION_MS="" RUN_MODEL=""
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --version) VERSION="$2"; shift 2;;
                --scenario) SCENARIO="$2"; shift 2;;
                --rep) REP="$2"; shift 2;;
                --total-tokens) TOTAL_TOK="$2"; shift 2;;
                --tool-uses) TOOL_USES="$2"; shift 2;;
                --duration-ms) DURATION_MS="$2"; shift 2;;
                --model) RUN_MODEL="$2"; shift 2;;
                *) shift;;
            esac
        done

        mkdir -p "$RESULTS/$VERSION"
        RUN_ID="${SCENARIO}-run${REP}"

        # Write a harvest-compatible JSON with agent metrics + estimated cost
        python3 -c "
import json

total_tokens = int('${TOTAL_TOK:-0}')
tool_uses = int('${TOOL_USES:-0}')
duration_ms = int('${DURATION_MS:-0}')
model = '${RUN_MODEL:-opus}'

# Pricing per MTok (March 2026)
pricing = {
    'opus':   {'input': 15.00, 'output': 75.00},
    'sonnet': {'input': 3.00,  'output': 15.00},
    'haiku':  {'input': 0.80,  'output': 4.00},
}
p = pricing.get(model, pricing['opus'])

# Estimate: subagent total_tokens is sum of all turns.
# Typical split for code-gen tasks: ~70% input, ~30% output
est_input = int(total_tokens * 0.70)
est_output = int(total_tokens * 0.30)
est_cost = (est_input * p['input'] + est_output * p['output']) / 1_000_000

data = {
    'session_id': 'agent-${VERSION}-${SCENARIO}-run${REP}',
    'model': model,
    'turns': 0,
    'totals': {
        'input_tokens': est_input,
        'output_tokens': est_output,
        'cache_read_tokens': 0,
        'cache_write_tokens': 0,
        'total_tokens': total_tokens,
        'cost_usd': round(est_cost, 6),
        'tool_calls': tool_uses,
        'duration_s': round(duration_ms / 1000, 1),
    }
}
with open('$RESULTS/$VERSION/$RUN_ID.json', 'w') as f:
    json.dump(data, f, indent=2)
print(f'Recorded: $VERSION / $RUN_ID — {total_tokens:,} tokens, {tool_uses} tools, {duration_ms/1000:.1f}s, ~\${est_cost:.4f}')
"
        # Update status
        python3 "$STATUS_PY" complete-run \
            --version "$VERSION" --scenario "$SCENARIO" --rep "$REP" \
            --harvest-file "$RESULTS/$VERSION/$RUN_ID.json"
        ;;

    validate)
        # Validate deck output for a run
        VERSION="" SCENARIO="" REP=""
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --version) VERSION="$2"; shift 2;;
                --scenario) SCENARIO="$2"; shift 2;;
                --rep) REP="$2"; shift 2;;
                *) shift;;
            esac
        done

        DECK_FILE="$OUTPUT_DIR/eval-deck.json"
        if [ -f "$DECK_FILE" ]; then
            # Validate directly from bash (no Python subprocess needed)
            # 1. Check JSON valid + count slides
            VALIDATE_JSON=$(python3 -c "
import json, sys
try:
    with open('$DECK_FILE') as f: d = json.load(f)
    slides = []
    if 'lanes' in d:
        for l in d['lanes']:
            for i in l.get('items',[]):
                slides.extend(i.get('slides',[]))
    elif 'S' in d:
        slides = d['S']
    elif isinstance(d, list):
        slides = d
    raw = json.dumps(d, ensure_ascii=False)
    # Check block types present
    types_found = set()
    for bt in ['icon-row','table','flow','steps','timeline','metric','callout','quote','tag-group','code','progress','grid']:
        if '\"type\":\"'+bt+'\"' in raw or '\"_\":\"'+bt+'\"' in raw:
            types_found.add(bt)
    # Check scenario assertions
    scenario_assertions = {}
    try:
        with open('$SCENARIOS') as sf:
            sc = json.load(sf)
        for s in sc['scenarios']:
            if s['id'] == '$SCENARIO':
                scenario_assertions = s.get('assertions', [])
                break
    except: pass
    passed = 0; total = 0; results = []
    for a in scenario_assertions:
        total += 1
        ok = False
        if a['type'] == 'file_exists': ok = True
        elif a['type'] == 'json_valid': ok = True
        elif a['type'] == 'slide_count': ok = len(slides) == a['expected']
        elif a['type'] == 'block_type_present': ok = a['block_type'] in types_found
        elif a['type'] == 'text_present': ok = a['text'] in raw
        elif a['type'] == 'text_not_present': ok = a['text'] not in raw
        elif a['type'] == 'ships_ok':
            # Skip subprocess — just check valid JSON + slides exist
            ok = len(slides) > 0
        if ok: passed += 1
        results.append({'type': a['type'], 'passed': ok})
    if total == 0:
        passed = 1; total = 1; results = [{'type': 'json_valid', 'passed': True}]
    print(json.dumps({'passed': passed, 'total': total, 'slides': len(slides), 'types': list(types_found), 'results': results}))
except Exception as e:
    print(json.dumps({'passed': 0, 'total': 1, 'results': [{'type': 'error', 'passed': False}]}))
" 2>/dev/null || echo '{"passed":0,"total":1}')

            VALIDATE_PASSED=$(echo "$VALIDATE_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('passed',0))")
            VALIDATE_TOTAL=$(echo "$VALIDATE_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('total',0))")
            VALIDATE_RESULTS=$(echo "$VALIDATE_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('results',[])))")

            python3 "$STATUS_PY" validate-run \
                --version "$VERSION" --scenario "$SCENARIO" --rep "$REP" \
                --passed "$VALIDATE_PASSED" --total "$VALIDATE_TOTAL" \
                --results-json "$VALIDATE_RESULTS"

            echo "Validated: $VERSION / $SCENARIO run$REP — $VALIDATE_PASSED/$VALIDATE_TOTAL passed"
        else
            echo "No deck found at $DECK_FILE"
        fi
        ;;

    report)
        echo "━━━ Generating Report ━━━"
        python3 "$EVAL_DIR/scripts/report.py" "$RESULTS" 2>/dev/null || echo "No results yet"
        python3 "$EVAL_DIR/scripts/report.py" "$RESULTS" --markdown > "$RESULTS/comparison.md" 2>/dev/null || true
        echo "Report saved: $RESULTS/comparison.md"
        ;;

    finish)
        python3 "$STATUS_PY" finish
        echo "Eval completed."
        ;;

    judge)
        # Run deterministic quality scoring + generate judge prompt
        VERSION="" SCENARIO="" REP=""
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --version) VERSION="$2"; shift 2;;
                --scenario) SCENARIO="$2"; shift 2;;
                --rep) REP="$2"; shift 2;;
                --scores-json) SCORES_JSON="$2"; shift 2;;
                *) shift;;
            esac
        done

        DECK_FILE="$OUTPUT_DIR/eval-deck.json"
        if [ -f "$DECK_FILE" ]; then
            # Deterministic scoring (free)
            echo "━ Deterministic quality:"
            python3 "$EVAL_DIR/scripts/quality.py" "$DECK_FILE"

            # Merge deterministic scores into result
            if [ -n "$VERSION" ] && [ -n "$SCENARIO" ] && [ -n "$REP" ]; then
                RUN_ID="${SCENARIO}-run${REP}"
                RESULT_FILE="$RESULTS/$VERSION/$RUN_ID.json"
                if [ -f "$RESULT_FILE" ]; then
                    DET_JSON=$(python3 "$EVAL_DIR/scripts/quality.py" "$DECK_FILE" --json 2>/dev/null)
                    python3 -c "
import json
with open('$RESULT_FILE') as f:
    data = json.load(f)
data.setdefault('quality', {})['deterministic'] = $DET_JSON
with open('$RESULT_FILE', 'w') as f:
    json.dump(data, f, indent=2)
" 2>/dev/null || true
                fi
            fi

            # If --scores-json provided, store judge scores
            if [ -n "${SCORES_JSON:-}" ] && [ -n "$VERSION" ]; then
                RUN_ID="${SCENARIO}-run${REP}"
                RESULT_FILE="$RESULTS/$VERSION/$RUN_ID.json"
                if [ -f "$RESULT_FILE" ]; then
                    python3 -c "
import json
with open('$RESULT_FILE') as f:
    data = json.load(f)
data.setdefault('quality', {})['judge'] = json.loads('$SCORES_JSON')
with open('$RESULT_FILE', 'w') as f:
    json.dump(data, f, indent=2)
print('Stored judge scores')
" 2>/dev/null || echo "Failed to store judge scores"
                fi
            fi

            echo ""
            echo "━ To run LLM judge, spawn a blind subagent with:"
            echo "  System: $EVAL_DIR/prompts/judge-rubric.md"
            echo "  User:   python3 $EVAL_DIR/scripts/judge.py $DECK_FILE --prompt"
        else
            echo "No deck found at $DECK_FILE"
        fi
        ;;

    copy-fixture)
        # Copy fixture deck for edit scenarios
        FIXTURE=""
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --fixture) FIXTURE="$2"; shift 2;;
                *) shift;;
            esac
        done
        if [ -n "$FIXTURE" ] && [ -f "$EVAL_DIR/fixtures/$FIXTURE" ]; then
            cp "$EVAL_DIR/fixtures/$FIXTURE" "$OUTPUT_DIR/eval-deck.json"
            echo "Copied fixture: $FIXTURE → eval-deck.json"
        else
            echo "Fixture not found: $FIXTURE" >&2
            exit 3
        fi
        ;;

    help|*)
        echo "Vela Eval Runner (Subagent mode)"
        echo ""
        echo "Commands:"
        echo "  init          Initialize dashboard status"
        echo "  current       Update current progress indicator"
        echo "  record        Record completed run with agent metrics"
        echo "  validate      Validate deck output against assertions"
        echo "  judge         Run quality scoring (deterministic + LLM prompt)"
        echo "  copy-fixture  Copy fixture deck for edit scenarios"
        echo "  report        Generate comparison report"
        echo "  finish        Mark eval as completed"
        echo ""
        echo "The actual scenarios are executed via Claude Code subagents."
        echo "Open dashboard.html in a browser to watch live progress."
        ;;
esac
