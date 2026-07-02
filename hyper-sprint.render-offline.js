#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// hyper-sprint.render-offline.js — repo asset shipped WITH hyper-sprint.md.
//
// Builds a fully OFFLINE, runnable render of the Vela app so the hyper-sprint
// readiness gate / demo recorder can boot & drive it in real Chromium without
// the blocked React/lucide CDNs. Lives at the repo ROOT (self-locating) so it
// travels with hyper-sprint.md and is present on every branch — unlike
// skills/vela-slides/scripts/render-offline.js, which only exists where the
// offline-harness commit has landed.
//
// Recipe (the non-obvious parts a fresh agent would otherwise re-derive):
//   • vendored UMD React/ReactDOM/lucide-react + Babel (no CDN)
//   • transpile in Node, load as an EXTERNAL <script> — NEVER inline: the
//     monolith contains `</script>` inside XSS-test strings which truncate an
//     inline text/babel block
//   • strip `import` AND `export` tokens; provide React hooks + `lucideReact`
//     as globals the stripped imports used to supply
//
// OUTPUT: <outDir>/app.js + <outDir>/render.html (file:// loadable in Chromium;
//         window.__velaBooted / __velaBootError signal readiness).
// USAGE:  node hyper-sprint.render-offline.js <deck.vela> <outDir>
//         (run `python3 skills/vela-slides/scripts/concat.py` first to build vela.jsx)
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const REPO = __dirname; // this file sits at the repo root
const VELA_JSX = path.join(REPO, 'skills/vela-slides/app/vela.jsx');
const VENDOR = path.join(REPO, 'vela-neutralino/resources/vendor');

function build(deckPath, outDir) {
  if (!fs.existsSync(VELA_JSX)) throw new Error('vela.jsx not found — run skills/vela-slides/scripts/concat.py first');
  const Babel = require(path.join(VENDOR, 'babel.min.js'));
  const deck = JSON.parse(fs.readFileSync(deckPath, 'utf8'));
  let jsx = fs.readFileSync(VELA_JSX, 'utf8');
  // Strip ESM imports (react/lucide) — provided as UMD globals instead.
  jsx = jsx.replace(/^import\s+\{[^}]+\}\s+from\s+"react";\s*$/m, '');
  jsx = jsx.replace(/^import\s+\{[^}]+\}\s+from\s+"lucide-react";\s*$/m, '');
  jsx = jsx.replace(/^import\s+\*\s+as\s+\w+\s+from\s+"lucide-react";\s*$/m, '');
  jsx = jsx.replace(/^export\s+default\s+function\s+/m, 'function ');
  // Inject the deck via the STARTUP_PATCH sentinel (same mechanism as assemble.py).
  const marker = 'const STARTUP_PATCH = null;';
  if (!jsx.includes(marker)) throw new Error('STARTUP_PATCH marker missing in vela.jsx');
  const deckJson = JSON.stringify(deck).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  jsx = jsx.replace(marker, `const STARTUP_PATCH = ${deckJson};`);
  const shim =
    'const { useState, useReducer, useEffect, useLayoutEffect, useRef, useCallback, useMemo } = React;\n' +
    'const _LucideAll = window.lucideReact;\n' +
    'const { ChevronLeft, ChevronRight, Maximize2, Minimize2, Plus, X, Presentation, Download, Upload, Search, FileDown } = window.lucideReact;\n';
  const tail =
    '\ntry { window.App = App; window._createRoot(document.getElementById("root")).render(React.createElement(App)); window.__velaBooted = true; }' +
    ' catch (e) { window.__velaBootError = String(e && e.stack || e); }\n';
  const src = shim + jsx + tail;
  const { code } = Babel.transform(src, { presets: [['react', { runtime: 'classic' }]] });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'app.js'), code);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Vela</title>
<style>html,body{margin:0;height:100%;background:#0f172a}#root{height:100vh}</style>
<script src="file://${VENDOR}/react.min.js"></script>
<script>window.react=window.React;</script>
<script src="file://${VENDOR}/react-dom.min.js"></script>
<script src="file://${VENDOR}/lucide-react.min.js"></script>
<script>window.lucideReact=window.LucideReact;window._createRoot=window.ReactDOM&&window.ReactDOM.createRoot;</script>
</head><body><div id="root"></div>
<script src="file://${path.join(outDir, 'app.js')}"></script>
</body></html>`;
  fs.writeFileSync(path.join(outDir, 'render.html'), html);
  return { html: path.join(outDir, 'render.html'), bytes: code.length };
}

if (require.main === module) {
  const [deckPath, outDir] = process.argv.slice(2);
  if (!deckPath || !outDir) { console.error('usage: node hyper-sprint.render-offline.js <deck.vela> <outDir>'); process.exit(2); }
  const r = build(deckPath, outDir);
  console.log(`built ${r.html} (app.js ${r.bytes} bytes)`);
}
module.exports = { build };
