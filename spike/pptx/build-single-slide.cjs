// Spike helper — build an offline page that mounts ONE real Vela slide in
// isolation (no editor chrome), so the DOM we measure is exactly SlideContent.
// Mirrors render-offline.js's import-stripping + STARTUP_PATCH injection, but
// swaps the App boot tail for a single VirtualSlide render at 960x540.
//
// USAGE: node build-single-slide.cjs <deck.vela> <outDir> [laneIdx] [itemIdx] [slideIdx]
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const VELA_JSX = path.join(REPO, 'skills/vela-slides/app/vela.jsx');
const VENDOR = path.join(REPO, 'vela-neutralino/resources/vendor');

const [deckPath, outDir, L = '0', I = '0', S = '0'] = process.argv.slice(2);
if (!deckPath || !outDir) { console.error('usage: build-single-slide.cjs <deck.vela> <outDir> [L] [I] [S]'); process.exit(2); }

const Babel = require(path.join(VENDOR, 'babel.min.js'));
const deck = JSON.parse(fs.readFileSync(deckPath, 'utf8'));
let jsx = fs.readFileSync(VELA_JSX, 'utf8');
jsx = jsx.replace(/^import\s+\{[^}]+\}\s+from\s+"react";\s*$/m, '');
jsx = jsx.replace(/^import\s+\{[^}]+\}\s+from\s+"lucide-react";\s*$/m, '');
jsx = jsx.replace(/^import\s+\*\s+as\s+\w+\s+from\s+"lucide-react";\s*$/m, '');
jsx = jsx.replace(/^export\s+default\s+function\s+/m, 'function ');

const marker = 'const STARTUP_PATCH = null;';
if (!jsx.includes(marker)) throw new Error('STARTUP_PATCH marker missing');
const deckJson = JSON.stringify(deck).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
jsx = jsx.replace(marker, `const STARTUP_PATCH = ${deckJson};`);

const shim =
  'const { useState, useReducer, useEffect, useLayoutEffect, useRef, useCallback, useMemo } = React;\n' +
  'const _LucideAll = window.lucideReact;\n' +
  'const { ChevronLeft, ChevronRight, Maximize2, Minimize2, Plus, X, Presentation, Download, Upload, Search, FileDown } = window.lucideReact;\n';

// Mount ONE slide via VirtualSlide inside an exact 960x540 box (scale = 1, no chrome).
const tail = `
try {
  const _d = STARTUP_PATCH;
  const _slide = _d.lanes[${+L}].items[${+I}].slides[${+S}];
  const _box = React.createElement('div', { id: 'slidebox', style: { width: 960, height: 540, position: 'relative', overflow: 'hidden' } },
    React.createElement(VirtualSlide, { slide: _slide, index: 0, total: 1, branding: _d.branding || {}, editable: false, mode: 'fit', virtualW: 960, virtualH: 540, fontScale: 1 }));
  window._createRoot(document.getElementById('root')).render(_box);
  window.__velaBooted = true;
} catch (e) { window.__velaBootError = String(e && e.stack || e); }
`;
const src = shim + jsx + tail;
const { code } = Babel.transform(src, { presets: [['react', { runtime: 'classic' }]] });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'app.js'), code);
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Vela slide</title>
<style>html,body{margin:0;background:#0f172a}#root{width:960px;height:540px}</style>
<script src="file://${VENDOR}/react.min.js"></script><script>window.react=window.React;</script>
<script src="file://${VENDOR}/react-dom.min.js"></script>
<script src="file://${VENDOR}/lucide-react.min.js"></script>
<script>window.lucideReact=window.LucideReact;window._createRoot=window.ReactDOM&&window.ReactDOM.createRoot;</script>
</head><body><div id="root"></div>
<script src="file://${path.join(outDir, 'app.js')}"></script></body></html>`;
fs.writeFileSync(path.join(outDir, 'slide.html'), html);
console.log(`built ${path.join(outDir, 'slide.html')} (slide ${L}.${I}.${S})`);
