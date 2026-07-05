#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// .hyper-sprint/render-offline.js — repo asset shipped WITH .hyper-sprint/config.md.
//
// Builds a fully OFFLINE, runnable render of the Vela app so the hyper-sprint
// readiness gate / demo recorder can boot & drive it in real Chromium without
// the blocked React/lucide CDNs. Lives at the repo ROOT (self-locating) so it
// travels with .hyper-sprint/config.md and is present on every branch — unlike
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
// USAGE:  node .hyper-sprint/render-offline.js <deck.vela> <outDir> [--repo-root <path>]
//         (run `python3 skills/vela-slides/scripts/concat.py` first to build vela.jsx)
//
// --repo-root / HYPER_SPRINT_REPO_ROOT: this file's OWN location (__dirname) is the
// default repo root — correct when you invoke a tree's own copy of this script. If you
// instead invoke this exact file (e.g. via an absolute path habit) while meaning to build
// a DIFFERENT tree — a git worktree checked out at an older commit — __dirname still
// points at THIS tree, so it silently builds the wrong commit's app. Pass --repo-root (or
// set the env var) to the worktree path to make the target tree explicit and unambiguous.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

function resolveRepoRoot(argv) {
  const i = argv.indexOf('--repo-root');
  if (i >= 0 && argv[i + 1]) return path.resolve(argv[i + 1]);
  if (process.env.HYPER_SPRINT_REPO_ROOT) return path.resolve(process.env.HYPER_SPRINT_REPO_ROOT);
  return path.resolve(__dirname, '..'); // this file sits in <repo>/.hyper-sprint/
}

function build(deckPath, outDir, opts = {}) {
  const REPO = opts.repoRoot || path.resolve(__dirname, '..');
  const VELA_JSX = path.join(REPO, 'skills/vela-slides/app/vela.jsx');
  const VENDOR = path.join(REPO, 'vela-neutralino/resources/vendor');
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
    '\ntry {' +
    ' window.App = App; var _el = document.getElementById("root");' +
    // mount / remount a FRESH React root — a new component tree = all state reset.
    ' window.__velaMount = function(){ window.__velaBooted = false; if (window.__velaRoot) { try { window.__velaRoot.unmount(); } catch (e) {} } window.__velaRoot = window._createRoot(_el); window.__velaRoot.render(React.createElement(App)); window.__velaBooted = true; };' +
    // reset to known initial state WITHOUT reload (app.js stays in memory): clear the
    // in-mem storage so the app falls back to the baked STARTUP_PATCH deck, then remount.
    ' window.__velaReset = function(){ try { if (window.__vmem) { for (var k in window.__vmem) delete window.__vmem[k]; } } catch (e) {} window.__velaMount(); };' +
    ' window.__velaMount();' +
    ' }' +
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
  const repoRoot = resolveRepoRoot(argv);
  const ri = argv.indexOf('--repo-root');
  if (ri >= 0) argv.splice(ri, 2);
  const [deckPath, outDir] = argv;
  if (!deckPath || !outDir) { console.error('usage: node .hyper-sprint/render-offline.js <deck.vela> <outDir> [--repo-root <path>]'); process.exit(2); }
  const r = build(deckPath, outDir, { repoRoot });
  console.log(`built ${r.html} (app.js ${r.bytes} bytes) [repo: ${repoRoot}]`);
}
module.exports = { build };
