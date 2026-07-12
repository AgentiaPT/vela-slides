#!/usr/bin/env bash
# ci-local.sh — run the same test stacks CI runs and report TOTAL WALL TIME.
#
# Dev-only (never shipped). Mirrors the 8 gating stacks in .github/workflows/ci.yml
# so you can see, locally, what each costs and what the whole run costs — the
# figure CI bills against (per minute).
#
#   tools/vela-dev/scripts/ci-local.sh            # serial (matches CI ordering)
#   tools/vela-dev/scripts/ci-local.sh --parallel # concurrent groups (see eval)
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

concat_check() { # rebuild monolith and fail on drift
  cp skills/vela-slides/app/vela.jsx "$TMP/orig.jsx" 2>/dev/null
  python3 tools/vela-dev/scripts/concat.py >/dev/null 2>&1 || return 1
  diff -q "$TMP/orig.jsx" skills/vela-slides/app/vela.jsx >/dev/null
}
uibattery() { # concat -> offline render -> headless battery
  python3 tools/vela-dev/scripts/concat.py >/dev/null 2>&1 &&
  node tools/vela-dev/scripts/render-offline.js examples/vela-demo.vela "$TMP/vr" >/dev/null 2>&1 &&
  node tools/vela-dev/scripts/vela-drive.js uitests "$TMP/vr/render.html" --json "$TMP/vr/ui.json"
}
pptx() { python3 -c "import sys; sys.path.insert(0,'tests'); from test_vela import run_pptx_e2e_tests; sys.exit(run_pptx_e2e_tests())"; }
gotest() { ( cd vela-neutralino/extensions/agent && go test ./... ); }

WALL_S=$(date +%s.%N)
if [ "$PAR" -eq 0 ]; then
  echo "▶ Serial run (CI ordering)"
  run unit    "Unit"                python3 tests/test_vela.py --unit
  run integ   "Integration"        python3 tests/test_vela.py --integration
  run server  "Server"             python3 -m unittest tests.test_serve
  run desktop "Desktop gatekeeper" python3 -m unittest tests.test_desktop
  run go      "Go gatekeeper"      gotest
  run concat  "Template sync"      concat_check
  run e2e     "E2E review UI"      node tests/test_review_ui.cjs
  run pptx    "PPTX export e2e"    pptx
  run uib     "In-app UI battery"  uibattery
else
  echo "▶ Parallel run (non-browser group ∥, then browser group ∥)"
  # Group A: independent non-browser stacks, concurrently.
  run unit    "Unit"                python3 tests/test_vela.py --unit &
  run integ   "Integration"        python3 tests/test_vela.py --integration &
  run server  "Server"             python3 -m unittest tests.test_serve &
  run desktop "Desktop gatekeeper" python3 -m unittest tests.test_desktop &
  run go      "Go gatekeeper"      gotest &
  run concat  "Template sync"      concat_check &
  wait
  # Group B: browser stacks, concurrently (each launches its own Chromium).
  run e2e     "E2E review UI"      node tests/test_review_ui.cjs &
  run pptx    "PPTX export e2e"    pptx &
  run uib     "In-app UI battery"  uibattery &
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
