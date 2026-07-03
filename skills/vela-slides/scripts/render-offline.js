#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// render-offline.js — Build a fully OFFLINE, runnable render of the Vela app.
//
// WHY: In the remote-execution container the React/lucide CDNs (esm.sh) and
// the Playwright browser CDN are BLOCKED. serve.py's default HTML relies on an
// esm.sh importmap and therefore never boots here. This script sidesteps all
// of that by reusing the Neutralino desktop shell's proven offline recipe:
// vendored UMD React/ReactDOM/lucide-react + Babel, transpiled in Node, loaded
// as an EXTERNAL <script> (never inline — the monolith contains `</script>`
// inside XSS-test string literals which truncate an inline text/babel block).
//
// OUTPUT: <outDir>/app.js (transpiled) + <outDir>/render.html (loadable via
// file:// in Chromium). Pair with vela-drive.js to screenshot / run UI tests /
// record a demo video.
//
// USAGE: node render-offline.js <deck.vela> <outDir>
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..'); // skills/vela-slides/scripts -> repo root
const VELA_JSX = path.join(REPO, 'skills/vela-slides/app/vela.jsx');
const VENDOR = path.join(REPO, 'vela-neutralino/resources/vendor');

function build(deckPath, outDir, opts = {}) {
  if (!fs.existsSync(VELA_JSX)) throw new Error('vela.jsx not found — run concat.py first');
  const Babel = require(path.join(VENDOR, 'babel.min.js'));
  const deck = JSON.parse(fs.readFileSync(deckPath, 'utf8'));
  let jsx = fs.readFileSync(VELA_JSX, 'utf8');
  // Strip ESM imports (react/lucide) — provided as UMD globals instead.
  jsx = jsx.replace(/^import\s+\{[^}]+\}\s+from\s+"react";\s*$/m, '');
  jsx = jsx.replace(/^import\s+\{[^}]+\}\s+from\s+"lucide-react";\s*$/m, '');
  jsx = jsx.replace(/^import\s+\*\s+as\s+\w+\s+from\s+"lucide-react";\s*$/m, '');
  jsx = jsx.replace(/^export\s+default\s+function\s+/m, 'function ');
  // AI channel wiring (optional): flip the app into local mode and point it at a
  // running agent_backend channel server (python3 agent_backend.py serve). Vera's
  // AI calls then route to the local `claude` CLI instead of the Anthropic API —
  // the same VELA_CHANNEL_PORT branch serve.py uses (part-engine.jsx).
  const channelPort = parseInt(opts.channelPort || 0, 10);
  if (channelPort > 0) {
    jsx = jsx.replace('const VELA_LOCAL_MODE = false;', 'const VELA_LOCAL_MODE = true;');
    jsx = jsx.replace('const VELA_CHANNEL_PORT = 0;', `const VELA_CHANNEL_PORT = ${channelPort};`);
    // token_urlsafe/hex chars only — no quote/backslash — safe in a JS string.
    const tok = String(opts.channelToken || '').replace(/[^A-Za-z0-9_-]/g, '');
    if (tok) jsx = jsx.replace('const VELA_CHANNEL_TOKEN = "";', `const VELA_CHANNEL_TOKEN = "${tok}";`);
  }
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
  const argv = process.argv.slice(2);
  const ti = argv.indexOf('--channel-token');
  const channelToken = ti >= 0 ? argv.splice(ti, 2)[1] : (process.env.VELA_CHANNEL_TOKEN || '');
  const ci = argv.indexOf('--channel-port');
  const channelPort = ci >= 0 ? argv.splice(ci, 2)[1] : 0;
  const [deckPath, outDir] = argv;
  if (!deckPath || !outDir) { console.error('usage: node render-offline.js <deck.vela> <outDir> [--channel-port N] [--channel-token T]'); process.exit(2); }
  const r = build(deckPath, outDir, { channelPort, channelToken });
  console.log(`built ${r.html} (app.js ${r.bytes} bytes)${channelPort ? ` [AI channel :${channelPort}]` : ''}`);
}
module.exports = { build };
