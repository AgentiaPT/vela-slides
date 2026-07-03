---
name: vela-bench
description: Ad-hoc slide-navigation / interaction PERFORMANCE benchmark for Vela, driven INTERACTIVELY with the Playwright CLI (@playwright/cli — the token-efficient CLI alternative to Playwright MCP). Use when you need real in-browser input→render LATENCY / FPS numbers for interactions (next/prev slide, enter/exit present, gallery open, thumbnail scroll) — not correctness, not a screenshot. You drive the real app one command at a time, inspecting state between steps, instead of writing a script that runs blind.
allowed-tools: Bash(npx playwright-cli*), Bash(npm install*), Bash(node skills/vela-slides/scripts/*), Bash(seq*), Read, Write, Edit, Glob, Grep
---

# Vela interaction benchmark (Playwright CLI, interactive)

Measure the **latency the user actually feels** for Vela interactions, by driving the
real app in the prebuilt Chromium **one CLI command at a time**. Each step prints
state you reason about before the next — no blind end-to-end script. This is the
whole reason to use `@playwright/cli` here instead of writing a `.js` test:

> `arm signal → press key → read latency` — you inspect the number, the heading,
> the fullscreen flag between every step and adapt in real time.

`@playwright/cli` is a **different package** from `playwright` and from Playwright
MCP. It keeps a persistent browser as a background session (`-s=<name>`); `window`
globals survive between invocations, so an in-page timing harness installed once
stays live for the whole run. Snapshots/console logs are written to `.playwright-cli/`
(gitignored) — read only what you need.

## One-time setup (this container)

```bash
npm install --no-audit --no-fund --ignore-scripts @playwright/cli   # node_modules is ephemeral
```

The CDN-download browser is blocked and the bundled core wants a newer Chromium
revision than the image ships, so point the CLI at the pinned build and allow
`file://` (offline renders reference local vendor scripts). This repo commits it at
`.playwright/cli.config.json` (the default config path) so every invocation from the
repo root just works:

```json
{
  "allowUnrestrictedFileAccess": true,
  "browser": {
    "browserName": "chromium",
    "launchOptions": {
      "executablePath": "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
      "headless": true,
      "args": ["--no-sandbox"]
    }
  }
}
```

If the container's Chromium revision changes, update `executablePath`
(`ls /opt/pw-browsers/`). Without `allowUnrestrictedFileAccess` the CLI blocks
`file://` with *"Access to file: protocol is blocked"*.

## Workflow

```bash
# 1. Build an offline render of the deck (STARTUP_PATCH-injected, transpiled).
#    Its <script src> tags are absolute file:// paths that resolve under file:// nav.
node skills/vela-slides/scripts/render-offline.js examples/vela-demo.vela /tmp/vout

# 2. Open a persistent session on the render (pinned Chromium, file access on).
npx playwright-cli -s=vela open "file:///tmp/vout/render.html"

# 3. Wait for hydration (offline app.js transpiles + mounts; ~2–4s).
npx playwright-cli -s=vela eval "({b: !!window.__velaBooted, len: document.getElementById('root').innerText.length})" --raw
```

### Install the timing harness (once per session)

Measures **pure in-browser input→render latency**: an in-page capture-phase
`keydown` listener stamps `performance.now()` when a real (trusted) key from the CLI
arrives; a `MutationObserver` + rAF loop stamps the first DOM change that flips the
action's signature. `latency = doneT − keyT` — CDP/Node round-trip is excluded.

```bash
npx playwright-cli -s=vela eval "() => {
  const SIG = {
    slide: () => [...document.querySelectorAll('[data-block-type]')].map(e=>e.textContent).join(''),
    fs:    () => document.querySelector('header') ? '1' : '0',
    gal:   () => document.querySelector('[data-testid=gallery-close]') ? '1' : '0',
  };
  const B = { keyT:null, doneT:null, base:null, sig:null,
    arm(s,k){ this.sig=SIG[s]; this.base=this.sig(); this.keyT=null; this.doneT=null; this.watch=k; },
    result(){ return (this.keyT!=null&&this.doneT!=null)?+(this.doneT-this.keyT).toFixed(2):null; } };
  addEventListener('keydown', e=>{ if(B.watch && e.key===B.watch && B.keyT==null) B.keyT=performance.now(); }, true);
  const chk=()=>{ if(B.keyT!=null && B.doneT==null && B.sig && B.sig()!==B.base) B.doneT=performance.now(); };
  new MutationObserver(chk).observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true});
  (function raf(){ chk(); requestAnimationFrame(raf); })();
  window.__vb = B; return 'harness installed';
}" --raw
```

### Enter the deck, then measure — one interaction at a time

```bash
# Select a module (mounts SlidePanel): click a unique slide heading from the outline.
npx playwright-cli -s=vela eval "() => { const el=[...document.querySelectorAll('*')].find(e=>e.children.length===0 && e.textContent.trim()==='You Think. Vela Shows.'); el && el.click(); return el?'ok':'not found'; }" --raw

# present-enter:  arm 'fs' for key 'f' → press f → read
npx playwright-cli -s=vela eval "() => window.__vb.arm('fs','f')" --raw
npx playwright-cli -s=vela press f
npx playwright-cli -s=vela eval "window.__vb.result()" --raw     # ms

# next-slide sweep (repeat; heading confirms the transition):
for i in $(seq 1 10); do
  npx playwright-cli -s=vela eval "() => window.__vb.arm('slide','ArrowRight')" --raw >/dev/null
  npx playwright-cli -s=vela press ArrowRight >/dev/null
  ms=$(npx playwright-cli -s=vela eval "window.__vb.result()" --raw)
  head=$(npx playwright-cli -s=vela eval "(document.querySelector('[data-block-type=heading]')||{}).textContent" --raw)
  echo "$i  ${ms}ms  $head"
done

# prev-slide: same loop with arm('slide','ArrowLeft') + press ArrowLeft
# gallery-open:  arm('gal','g') → press g → result
# thumbnail-scroll FPS (eval awaits async):
npx playwright-cli -s=vela eval "async () => {
  const el=document.querySelector('[data-scroll-container]')||document.scrollingElement; const fr=[]; let last=performance.now();
  for(let i=0;i<40;i++){ await new Promise(r=>requestAnimationFrame(r)); const n=performance.now(); fr.push(n-last); last=n; el.scrollBy(0,50); }
  const s=fr.slice(1).sort((a,b)=>a-b); return { fps:+(1000/s[s.length>>1]).toFixed(1), worstFrameMs:+Math.max(...s).toFixed(1) };
}" --raw
```

### Interaction → key → signal reference

| interaction      | key (CLI `press`) | signal fn | notes |
|------------------|-------------------|-----------|-------|
| present-enter    | `f`               | `fs`      | `<header>` removed while presenting |
| present-exit     | `Escape` (or `f`) | `fs`      | Escape once gallery is closed |
| next-slide       | `ArrowRight`      | `slide`   | block-text signature changes |
| prev-slide       | `ArrowLeft`       | `slide`   | stops changing at slide 0 |
| gallery-open     | `g`               | `gal`     | `[data-testid=gallery-close]` appears |
| gallery-close    | `Escape`          | `gal`     | |
| thumbnail-scroll | wheel (async eval)| —         | rAF frame intervals → median FPS + worst frame |

### Session housekeeping

```bash
npx playwright-cli list            # running sessions
npx playwright-cli -s=vela close   # close this session
npx playwright-cli kill-all        # nuke stale/zombie browsers
```

## Baseline (examples/vela-demo.vela, 1440×900, headless Chromium-1194)

Rough figures from a clean run — use as a regression tripwire, not hard SLAs
(headless timing is noisier than a real GPU display):

| interaction      | typical            |
|------------------|--------------------|
| present-enter    | ~25 ms             |
| next-slide       | ~8–15 ms (median ~12) |
| gallery-open     | ~100 ms (renders all thumbnails) |
| thumbnail-scroll | ~60 fps, worst frame ~40 ms (first-render hitch) |

A regression looks like: next-slide creeping over one frame budget (>16 ms
median), gallery-open climbing past a few hundred ms, or scroll FPS falling well
under 60. Re-run after any change to `part-slides.jsx` (SlidePanel / GalleryView),
block renderers, or the reducer's slide-index path.

## Why not just write a Playwright `.js`?

A written script runs the whole flow before you see anything; when step 4 misbehaves
you edit and re-run from scratch. The CLI keeps the browser warm between commands, so
you probe the live page (`eval`, `snapshot`, `console`), find the real selector/key,
and only then take the measurement — the same reason MCP works, minus the context
cost of streaming every snapshot into the conversation.
