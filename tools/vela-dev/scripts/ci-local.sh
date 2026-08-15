#!/usr/bin/env bash
# ci-local.sh — run the same test stacks CI runs and report TOTAL WALL TIME.
#
# Dev-only (never shipped). Defines every gate in the CI test job. GitHub CI
# calls the same --gate entries, so local and remote commands cannot drift.
#
#   tools/vela-dev/scripts/ci-local.sh            # serial (matches CI ordering)
#   tools/vela-dev/scripts/ci-local.sh --parallel # concurrent groups (see eval)
#   tools/vela-dev/scripts/ci-local.sh --gate dnd # run one CI gate
#
# Browser stacks use the offline render + pinned Chromium (CDNs are blocked in
# the container); the CI-only `npx playwright install` step is skipped here.
set -uo pipefail
cd "$(dirname "$0")/../../.."   # repo root
ROOT="$(pwd)"
PAR=0; [ "${1:-}" = "--parallel" ] && PAR=1
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# Each stack writes its own result file ("<dur> <exit> <label>") so parallel
# stacks (run in backgrounded subshells) still report back to the parent — a
# shell array would be lost across the subshell boundary and hide failures.
run() { # run <key> <label> <command...>
  local key="$1" label="$2"; shift 2
  local s e ec; s=$(date +%s.%N)
  "$@" >"$TMP/$key.log" 2>&1; ec=$?
  e=$(date +%s.%N)
  local d; d=$(echo "$e - $s" | bc)
  printf '%s %s %s\n' "$d" "$ec" "$label" >"$TMP/$key.meta"
  printf '  %-26s %6.1fs  %s\n' "$label" "$d" \
    "$([ "$ec" -eq 0 ] && echo ✅ || echo "❌ (exit $ec)")"
}

concat_check() { # build to a temp file and fail on drift
  python3 tools/vela-dev/scripts/concat.py src/parts "$TMP/concat.jsx" >/dev/null 2>&1 &&
  diff -q skills/vela-slides/app/vela.jsx "$TMP/concat.jsx" >/dev/null
}
uibattery() { # committed template -> offline render -> headless battery
  node tools/vela-dev/scripts/render-offline.js examples/vela-demo.vela "$TMP/vr" >/dev/null 2>&1 || return 1
  node tools/vela-dev/scripts/vela-drive.js uitests "$TMP/vr/render.html" --json "$TMP/vr/ui.json"
  local ec=$?
  local skipped
  skipped=$(node -e "try{const r=require(process.argv[1]);process.stdout.write(String(r.filter(x=>x.pass==='skip').length))}catch(e){process.stdout.write('0')}" "$TMP/vr/ui.json")
  echo "UI_SKIPPED=$skipped"
  return "$ec"
}
pptx() { python3 -c "import sys; sys.path.insert(0,'tests'); from test_vela import run_pptx_e2e_tests; sys.exit(run_pptx_e2e_tests())"; }
gotest() { ( cd vela-neutralino/extensions/agent && go test -v ./... ); }

run_gate() {
  case "$1" in
    audit)    npm audit --audit-level=high ;;
    lint)     python3 tools/vela-dev/scripts/lint.py --parts src/parts ;;
    routing)  python3 tools/vela-dev/scripts/check-routing.py ;;
    codemap)  python3 tools/vela-dev/scripts/gen-codemap.py --check ;;
    release)  node tests/test_release_build.cjs ;;
    unit)     python3 tests/test_vela.py --unit ;;
    integ)    python3 tests/test_vela.py --integration ;;
    server)   python3 -m unittest tests.test_serve -v ;;
    desktop)  python3 -m unittest tests.test_desktop -v ;;
    go)       gotest ;;
    concat)   concat_check ;;
    e2e)      node tests/test_review_ui.cjs ;;
    pptx)     pptx ;;
    uib)      uibattery ;;
    journey)  node tests/test_journey_e2e.cjs ;;
    dnd)      node tests/test_dnd_e2e.cjs ;;
    pdf)      node tests/test_pdf_export.cjs ;;
    *) echo "Unknown CI gate: $1" >&2; return 2 ;;
  esac
}

if [ "${1:-}" = "--gate" ]; then
  [ -n "${2:-}" ] || { echo "Usage: $0 --gate <name>" >&2; exit 2; }
  run_gate "$2"
  exit $?
fi

WALL_S=$(date +%s.%N)
if [ "$PAR" -eq 0 ]; then
  echo "▶ Serial run (CI ordering)"
  run audit   "npm audit"           run_gate audit
  run lint    "Key-drift lint"      run_gate lint
  run routing "Routing freshness"   run_gate routing
  run codemap "Code-map freshness"  run_gate codemap
  run release "Release hardening"   run_gate release
  run unit    "Unit"                run_gate unit
  run integ   "Integration"         run_gate integ
  run server  "Server"              run_gate server
  run desktop "Desktop gatekeeper"  run_gate desktop
  run go      "Go gatekeeper"       run_gate go
  run concat  "Template sync"       run_gate concat
  run e2e     "E2E review UI"       run_gate e2e
  run pptx    "PPTX export e2e"     run_gate pptx
  run uib     "In-app UI battery"   run_gate uib
  run journey "Journey E2E"         run_gate journey
  run dnd     "Drag & drop E2E"     run_gate dnd
  run pdf     "PDF export E2E"      run_gate pdf
else
  echo "▶ Parallel run (static gates, then non-browser ∥, then browser ∥)"
  run audit   "npm audit"           run_gate audit
  run lint    "Key-drift lint"      run_gate lint
  run routing "Routing freshness"   run_gate routing
  run codemap "Code-map freshness"  run_gate codemap
  run release "Release hardening"   run_gate release
  # Group A: independent non-browser stacks, concurrently.
  run unit    "Unit"                run_gate unit &
  run integ   "Integration"         run_gate integ &
  run server  "Server"              run_gate server &
  run desktop "Desktop gatekeeper"  run_gate desktop &
  run go      "Go gatekeeper"       run_gate go &
  run concat  "Template sync"       run_gate concat &
  wait
  # Group B: browser stacks, concurrently (each launches its own Chromium).
  run e2e     "E2E review UI"       run_gate e2e &
  run pptx    "PPTX export e2e"     run_gate pptx &
  run uib     "In-app UI battery"   run_gate uib &
  run journey "Journey E2E"         run_gate journey &
  run dnd     "Drag & drop E2E"     run_gate dnd &
  run pdf     "PDF export E2E"      run_gate pdf &
  wait
fi
WALL=$(echo "$(date +%s.%N) - $WALL_S" | bc)

sum=0; fails=0
for f in "$TMP"/*.meta; do
  read -r d ec _ <"$f"
  sum=$(echo "$sum + $d" | bc)
  [ "$ec" -ne 0 ] && fails=$((fails+1))
done
echo "────────────────────────────────────────────"
printf "  Sum of stack times : %6.1fs%s\n" "$sum" \
  "$([ "$PAR" -eq 1 ] && echo '  (work done concurrently)' || echo '')"
printf "  TOTAL WALL TIME    : %6.1fs   (~%d billed min if this were a CI job)\n" \
  "$WALL" "$(echo "($WALL + 59) / 60" | bc)"
echo "  Failed stacks      : $fails"
if [ "$fails" -eq 0 ]; then
  echo "  ✅ all stacks green"
else
  echo "  ❌ failing stacks (logs kept in $TMP):"
  for f in "$TMP"/*.meta; do read -r _ ec label <"$f"; [ "$ec" -ne 0 ] && echo "     • $label"; done
  trap - EXIT
fi
exit "$fails"
