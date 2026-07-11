#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# vela-interaction-bench.sh — slide-navigation / interaction latency benchmark
# for Vela, driven with @playwright/cli (the Playwright CLI, not raw Playwright).
#
# Measures PURE IN-BROWSER input→render latency: an in-page keydown listener
# stamps performance.now() when a real (trusted) key from the CLI arrives, and a
# MutationObserver + rAF loop stamps the first DOM change. latency = doneT − keyT,
# so CDP / Node round-trip is excluded — you get the frame budget the user feels.
#
# Setup knowledge (pinned Chromium, file:// access, offline render) lives in the
# playwright-cli-setup skill; this script assumes .playwright/cli.config.json exists.
#
# Usage:
#   bench/vela-interaction-bench.sh [deck.vela] [--runs N] [--maxslides N] [--json out.json]
#   RUNS=2 bench/vela-interaction-bench.sh examples/tech-talk.vela
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; [ -z "$ROOT" ] && ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DECK="examples/vela-demo.vela"
RUNS="${RUNS:-1}"
MAXSLIDES="${MAXSLIDES:-1000}"
JSON_OUT=""
SESSION="velabench"
RENDER="/tmp/vela-bench-render"

# arg parsing
while [ $# -gt 0 ]; do
  case "$1" in
    --runs) RUNS="$2"; shift 2 ;;
    --maxslides) MAXSLIDES="$2"; shift 2 ;;
    --json) JSON_OUT="$2"; shift 2 ;;
    *.vela) DECK="$1"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [ -x node_modules/.bin/playwright-cli ]; then PW="node_modules/.bin/playwright-cli"; else PW="npx playwright-cli"; fi
pw() { $PW -s="$SESSION" "$@"; }
ev() { pw eval "$1" --raw 2>/dev/null | tr -d '\n' | sed 's/^"//; s/"$//'; }

if [ ! -f .playwright/cli.config.json ]; then
  echo "✗ .playwright/cli.config.json missing — run the playwright-cli-setup skill first." >&2; exit 1
fi
command -v $PW >/dev/null 2>&1 || npx --version >/dev/null 2>&1 || { echo "✗ need @playwright/cli (npm i @playwright/cli)" >&2; exit 1; }

echo "▶ building offline render of $DECK"
node tools/vela-dev/scripts/render-offline.js "$DECK" "$RENDER" >/dev/null

echo "▶ opening session '$SESSION' (pinned Chromium, file:// access)"
pw close >/dev/null 2>&1 || true
pw open "file://$RENDER/render.html" >/dev/null

# wait for hydration
booted=""
for _ in $(seq 1 20); do
  booted="$(ev "!!window.__velaBooted")"
  [ "$booted" = "true" ] && break
  sleep 0.5
done
[ "$booted" = "true" ] || { echo "✗ app did not boot"; pw console error 2>/dev/null | head; exit 1; }
echo "▶ booted"

# install timing harness
ev "() => { const SIG={slide:()=>[...document.querySelectorAll('[data-block-type]')].map(e=>e.textContent).join(''),fs:()=>document.querySelector('header')?'1':'0',gal:()=>document.querySelector('[data-testid=gallery-close]')?'1':'0'}; const B={keyT:null,doneT:null,base:null,sig:null,arm(s,k){this.sig=SIG[s];this.base=this.sig();this.keyT=null;this.doneT=null;this.watch=k;},result(){return(this.keyT!=null&&this.doneT!=null)?+(this.doneT-this.keyT).toFixed(2):null;},peek(s){return SIG[s]();}}; addEventListener('keydown',e=>{if(B.watch&&e.key===B.watch&&B.keyT==null)B.keyT=performance.now();},true); const chk=()=>{if(B.keyT!=null&&B.doneT==null&&B.sig&&B.sig()!==B.base)B.doneT=performance.now();}; new MutationObserver(chk).observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true}); (function raf(){chk();requestAnimationFrame(raf);})(); window.__vb=B; return 'ok'; }" >/dev/null

# No explicit module selection needed: pressing 'f' with nothing selected makes
# Vela's global fullscreen handler auto-select the first module with slides and
# enter presentation — which is exactly the present-enter interaction we measure.
echo "▶ entering presentation (present-enter auto-selects the first module)"

SAMPLES_DIR="$(mktemp -d)"
trap 'rm -rf "$SAMPLES_DIR"' EXIT
record() { echo "$2" >> "$SAMPLES_DIR/$1"; }

# one measured interaction: arm(sig,key) → press key → read result
measure() { # $1=action file  $2=sig  $3=key
  ev "() => window.__vb.arm('$2','$3')" >/dev/null
  pw press "$3" >/dev/null 2>&1
  local ms=""; for _ in 1 2 3 4 5; do ms="$(ev "window.__vb.result()")"; [ -n "$ms" ] && [ "$ms" != "null" ] && break; sleep 0.1; done
  [ -n "$ms" ] && [ "$ms" != "null" ] && record "$1" "$ms"
  echo "$ms"
}

for run in $(seq 1 "$RUNS"); do
  echo "▶ run $run/$RUNS"
  # ensure editor view (not fullscreen) at run start
  [ "$(ev "window.__vb.peek('fs')")" = "0" ] && { pw press f >/dev/null 2>&1; sleep 0.3; }

  measure present-enter fs f >/dev/null

  # next-slide sweep until the slide signature stops changing (reached last slide)
  n=0
  while [ "$n" -lt "$MAXSLIDES" ]; do
    before="$(ev "window.__vb.peek('slide')")"
    measure next-slide slide ArrowRight >/dev/null
    after="$(ev "window.__vb.peek('slide')")"
    [ "$before" = "$after" ] && break
    n=$((n+1))
  done
  echo "  next-slide: $n transitions"

  # prev-slide back
  for _ in $(seq 1 "$n"); do
    before="$(ev "window.__vb.peek('slide')")"
    measure prev-slide slide ArrowLeft >/dev/null
    after="$(ev "window.__vb.peek('slide')")"
    [ "$before" = "$after" ] && break
  done

  # gallery open → thumbnail-scroll fps → close
  measure gallery-open gal g >/dev/null
  if [ "$(ev "window.__vb.peek('gal')")" = "1" ]; then
    fps="$(ev "async () => { const el=document.querySelector('[data-scroll-container]')||document.scrollingElement; const fr=[]; let last=performance.now(); for(let i=0;i<40;i++){ await new Promise(r=>requestAnimationFrame(r)); const n=performance.now(); fr.push(n-last); last=n; el.scrollBy(0,50);} const s=fr.slice(1).sort((a,b)=>a-b); return (1000/s[s.length>>1]).toFixed(1)+' '+Math.max(...s).toFixed(1); }")"
    echo "  gallery-scroll: ${fps%% *} fps (worst frame ${fps##* }ms)"
    echo "$fps" >> "$SAMPLES_DIR/_scrollfps"
    measure gallery-close gal Escape >/dev/null
  fi

  # exit present
  [ "$(ev "window.__vb.peek('fs')")" = "0" ] && { m="$(measure present-exit fs Escape)"; [ -z "$m" ] || [ "$m" = "null" ] && measure present-exit fs f >/dev/null; }
done

pw close >/dev/null 2>&1 || true

# ── report (stats via python) ────────────────────────────────────────────────
python3 - "$SAMPLES_DIR" "$DECK" "$RUNS" "${JSON_OUT}" <<'PY'
import sys, os, json, statistics
sdir, deck, runs, jout = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
order = ["present-enter","next-slide","prev-slide","gallery-open","gallery-close","present-exit"]
def pct(v,p):
    v=sorted(v); import math; i=min(len(v)-1,max(0,math.ceil(p/100*len(v))-1)); return v[i]
report={"deck":os.path.basename(deck),"runs":int(runs),"actions":{}}
rows=[]
for a in order:
    f=os.path.join(sdir,a)
    if not os.path.exists(f): continue
    vals=[float(x) for x in open(f).read().split() if x]
    if not vals: continue
    s={"n":len(vals),"mean":round(statistics.mean(vals),1),"p50":round(pct(vals,50),1),"p95":round(pct(vals,95),1),"max":round(max(vals),1)}
    report["actions"][a]=s; rows.append((a,s))
fps=None
ff=os.path.join(sdir,"_scrollfps")
if os.path.exists(ff):
    pairs=[l.split() for l in open(ff).read().strip().splitlines() if l]
    fpsv=sorted(float(p[0]) for p in pairs); worst=max(float(p[1]) for p in pairs)
    fps={"medianFps":round(pct(fpsv,50),1),"minFps":round(fpsv[0],1),"worstFrameMs":round(worst,1)}
    report["galleryScroll"]=fps
print(f"\nVela interaction benchmark — {report['deck']}  ({runs} run(s), headless Chromium)")
print("─"*64)
print(f"{'action':16}{'n':>5}{'mean':>9}{'p50':>8}{'p95':>8}{'max':>8}")
for a,s in rows:
    print(f"{a:16}{s['n']:>5}{str(s['mean'])+'ms':>9}{str(s['p50'])+'ms':>8}{str(s['p95'])+'ms':>8}{str(s['max'])+'ms':>8}")
print("─"*64)
if fps: print(f"gallery-scroll   median {fps['medianFps']} fps · min {fps['minFps']} fps · worst frame {fps['worstFrameMs']}ms")
if jout:
    json.dump(report, open(jout,"w"), indent=2); print(f"\njson → {jout}")
PY
