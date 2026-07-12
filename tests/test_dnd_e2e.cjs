/**
 * Vela Slides — Drag-and-Drop Reorder e2e Tests (Playwright, real browser)
 *
 * Closes gap G4: the ~19 drag/drop handlers in src/parts/part-list.jsx
 * (slide reorder, section/module reorder, cross-module moves, no-op guards)
 * were effectively untested. This drives the REAL handlers + reducer path
 * end-to-end in a real Chromium and asserts the observable order actually
 * changed (before -> after), reading the live DOM.
 *
 * Usage:
 *   node tests/test_dnd_e2e.cjs               # auto-setup + run
 *   node tests/test_dnd_e2e.cjs --skip-setup  # reuse running server on :8766
 *
 * ── Fidelity ────────────────────────────────────────────────────────
 * Vela's DnD does NOT round-trip through dataTransfer (its getData() is
 * unreadable in the drop handler under several browsers, and empty for
 * headless synthetic events). Instead the drag payload lives in a
 * module-scoped `_velaDrag` variable inside part-list.jsx, set by the real
 * onDragStart handler and read live inside every dragover/drop handler.
 * Because `_velaDrag` is a closure var (not on window), it CANNOT be set
 * from the outside — the ONLY way to populate it is to fire the app's real
 * onDragStart. So this test dispatches genuine DragEvent objects (a real,
 * shared DataTransfer attached) at the actual draggable DOM nodes:
 *     dragstart(src) -> dragover(tgt) -> [React flush] -> drop(tgt) -> dragend(src)
 * Every event runs the exact part-list.jsx handler chain (_setDrag / the
 * live _velaDrag reads / the React dropPos state / the dispatch to the real
 * reducer). Nothing about the reorder logic is stubbed.
 *
 * Fidelity level: HIGH — real DragEvents + real DataTransfer + real handlers
 * + real reducer + real DOM re-render. The only non-native aspect is that
 * the events are dispatched programmatically rather than synthesized by an
 * OS mouse gesture (Playwright's mouse-move DnD does NOT trigger React HTML5
 * drag handlers reliably, so mouse synthesis is not a viable driver here).
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

// ── Config ───────────────────────────────────────────────────────────
const PORT = 8766; // distinct from test_review_ui.cjs (8765) so both can run
const SERVE_DIR = path.join(require('os').tmpdir(), 'vela-dnd-e2e-serve');
const ROOT = path.resolve(__dirname, '..');
const ASSEMBLED = path.join(SERVE_DIR, 'assembled.jsx');

// ── Resolve Playwright (globals first, then local node_modules) ─────
function resolvePlaywright() {
  const globalPaths = [];
  try {
    const bin = execSync('which playwright 2>/dev/null', { encoding: 'utf8' }).trim();
    if (bin) {
      globalPaths.push(path.resolve(path.dirname(bin), '..', 'lib', 'node_modules', 'playwright'));
      try {
        const pnpmRoot = execSync('pnpm root -g 2>/dev/null', { encoding: 'utf8' }).trim();
        if (pnpmRoot) globalPaths.push(path.join(pnpmRoot, 'playwright'));
      } catch {}
    }
  } catch {}
  const candidates = [...globalPaths, path.join(ROOT, 'node_modules', 'playwright')];
  for (const p of candidates) { try { return require(p); } catch {} }
  throw new Error('Playwright not found. Install: npm install --save-dev playwright');
}

// ── Build self-contained HTML (same offline recipe as test_review_ui) ─
function buildTestHTML() {
  fs.mkdirSync(SERVE_DIR, { recursive: true });
  console.log('Assembling deck...');
  execSync('python3 tools/vela-dev/scripts/concat.py', { cwd: ROOT, stdio: 'pipe' });
  execSync(
    `python3 skills/vela-slides/scripts/assemble.py examples/vela-demo.vela --output "${ASSEMBLED}"`,
    { cwd: ROOT, stdio: 'pipe' }
  );

  const deps = {
    'react.js': 'react/umd/react.production.min.js',
    'react-dom.js': 'react-dom/umd/react-dom.production.min.js',
  };
  for (const [dest, src] of Object.entries(deps)) {
    const full = path.join(ROOT, 'node_modules', src);
    if (!fs.existsSync(full)) throw new Error(`Missing dep: npm install ${src.split('/')[0]}`);
    fs.copyFileSync(full, path.join(SERVE_DIR, dest));
  }

  const lucideCjs = path.join(ROOT, 'node_modules', 'lucide-react', 'dist', 'cjs', 'lucide-react.js');
  if (!fs.existsSync(lucideCjs)) throw new Error('Missing dep: npm install lucide-react');
  const lucideShim = [
    '(function (root) {',
    '  var module = { exports: {} }, exports = module.exports;',
    '  function require(name) {',
    '    if (name === "react") return root.React;',
    '    throw new Error("lucide-react shim: unexpected require(" + name + ")");',
    '  }',
    fs.readFileSync(lucideCjs, 'utf8'),
    '  root.LucideReact = module.exports;',
    '})(typeof window !== "undefined" ? window : this);',
  ].join('\n');
  fs.writeFileSync(path.join(SERVE_DIR, 'lucide.js'), lucideShim);

  const jsx = fs.readFileSync(ASSEMBLED, 'utf8')
    .replace(/^import {.*} from "react";/m,
      'const { useState, useReducer, useEffect, useLayoutEffect, useRef, useCallback, useMemo } = React;')
    .replace(/^import {.*} from "lucide-react";/m,
      'const { ChevronLeft, ChevronRight, Maximize2, Minimize2, Plus, X, Presentation, Download, Upload, Search, FileDown } = LucideReact;')
    .replace(/^import \* as _LucideAll from "lucide-react";/m,
      'const _LucideAll = LucideReact;')
    .replace(/^export default function App/m, 'function App');

  const Babel = require('@babel/standalone');
  const bootstrap = '\nconst root = ReactDOM.createRoot(document.getElementById("root"));\nroot.render(React.createElement(App));\n';
  let appScript;
  try {
    appScript = Babel.transform(jsx + bootstrap, { presets: ['react'], compact: false }).code;
  } catch (e) {
    throw new Error('JSX transpile failed (syntax error in monolith): ' + (e && e.message));
  }
  appScript = appScript.replace(/<(\/?script|!--)/gi, '<\\$1');

  const html = [
    '<!DOCTYPE html><html><head><meta charset="UTF-8">',
    '<style>*{margin:0;padding:0;box-sizing:border-box}html,body,#root{width:100%;height:100%;overflow:hidden}</style>',
    '<script src="react.js"></script>',
    '<script src="react-dom.js"></script>',
    '<script>window.react = React;</script>',
    '<script src="lucide.js"></script>',
    '</head><body><div id="root"></div>',
    '<script>',
    appScript,
    '</script></body></html>',
  ].join('\n');

  fs.writeFileSync(path.join(SERVE_DIR, 'index.html'), html);
  console.log(`Built test HTML (${Math.round(html.length / 1024)}KB, pre-transpiled)`);
}

// ── Static server ────────────────────────────────────────────────────
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let requestedPath;
      try {
        const urlObj = new URL(req.url, `http://localhost:${PORT}`);
        requestedPath = urlObj.pathname === '/' ? 'index.html' : urlObj.pathname.replace(/^\/+/, '');
      } catch { res.writeHead(400); res.end('Bad request'); return; }
      const resolvedPath = path.resolve(SERVE_DIR, requestedPath);
      if (!resolvedPath.startsWith(SERVE_DIR + path.sep) && resolvedPath !== path.join(SERVE_DIR, 'index.html')) {
        res.writeHead(404); res.end('Not found'); return;
      }
      try {
        const data = fs.readFileSync(resolvedPath);
        const ext = path.extname(resolvedPath);
        const ct = { '.html': 'text/html', '.js': 'application/javascript' }[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': ct });
        res.end(data);
      } catch { res.writeHead(404); res.end('Not found'); }
    });
    server.listen(PORT, 'localhost', () => { console.log(`Test server on http://localhost:${PORT}`); resolve(server); });
  });
}

// ── Test runner ──────────────────────────────────────────────────────
let passed = 0, failed = 0;
const results = [];
let page;

async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    passed++;
    const ms = Date.now() - t0;
    results.push({ name, pass: true, ms });
    console.log(`  ✅ ${name} (${ms}ms)`);
  } catch (e) {
    failed++;
    const ms = Date.now() - t0;
    results.push({ name, pass: false, error: e.message, ms });
    console.log(`  ❌ ${name} — ${e.message} (${ms}ms)`);
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(`${msg}\n      expected: ${jb}\n      actual:   ${ja}`);
}

/** Flush React: double rAF + microtask so batched state commits & re-renders. */
async function settle() {
  await page.evaluate(() => new Promise(r =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 40)))));
}

// ── DnD driver: install page-side helpers once, then two-phase drive ──
async function installHelpers() {
  await page.evaluate(() => {
    const H = {};
    // Title span of a section header (.concept-row) — inline fontWeight:600.
    H.sectionTitle = (row) => {
      const s = [...row.querySelectorAll('span')].find(x => x.style.fontWeight === '600');
      return (s ? s.textContent : row.textContent).trim();
    };
    // DOM-ordered list of section/module titles.
    H.sectionOrder = () =>
      [...document.querySelectorAll('.concept-row')].map(H.sectionTitle);
    // Section header element by exact title.
    H.sectionRow = (title) =>
      [...document.querySelectorAll('.concept-row')].find(r => H.sectionTitle(r) === title) || null;
    // The wrapper div that owns a section header (parent of .concept-row).
    H.moduleWrapper = (title) => { const r = H.sectionRow(title); return r ? r.parentElement : null; };
    // Slide rows inside a module wrapper = draggable divs that are NOT the header.
    H.slideRows = (title) => {
      const w = H.moduleWrapper(title);
      if (!w) return [];
      return [...w.querySelectorAll('[draggable="true"]')].filter(el => !el.classList.contains('concept-row'));
    };
    // Extract a slide row's title: the flex-child span (number/time/eye spans
    // use minWidth/fontSize, not flex). Falls back to full text.
    H.slideTitle = (row) => {
      const span = [...row.children].find(el =>
        el.tagName === 'SPAN' && el.style.flex && el.style.flex !== '' && el.style.flex !== 'none');
      return (span ? span.textContent : row.textContent).trim();
    };
    // DOM-ordered slide titles for a module.
    H.slideOrder = (title) => H.slideRows(title).map(H.slideTitle);
    // Fire one real DragEvent carrying a shared DataTransfer.
    H.fire = (el, type, cx, cy, dt) => {
      const ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy, dataTransfer: dt });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    window.__dnd = H;
  });
}

/**
 * Phase 1 of a drag: dragstart on source, dragover on target. Stores the
 * shared DataTransfer + geometry on window so phase 2 reuses them. A React
 * flush (settle) MUST happen between the two phases so the target's onDrop
 * closure captures the dropPos state that dragover just set (the section
 * drop handler reads dropPos from render scope).
 *
 *   locate: { kind:'slide'|'section', src:{module,rowIdx}|{title}, tgt:{...}, pos:'top'|'bottom' }
 * Returns { startPrevented, overPrevented } for diagnostics.
 */
async function dragBegin(locate) {
  return page.evaluate((loc) => {
    const H = window.__dnd;
    let src, tgt;
    if (loc.kind === 'slide') {
      src = H.slideRows(loc.src.module)[loc.src.rowIdx];
      tgt = H.slideRows(loc.tgt.module)[loc.tgt.rowIdx];
    } else {
      src = H.sectionRow(loc.src.title);
      tgt = H.sectionRow(loc.tgt.title);
    }
    if (!src || !tgt) throw new Error('drag begin: source or target element not found');
    const dt = new DataTransfer();
    const tr = tgt.getBoundingClientRect();
    const sr = src.getBoundingClientRect();
    const x = tr.left + tr.width / 2;
    const y = loc.pos === 'top' ? tr.top + tr.height * 0.25 : tr.top + tr.height * 0.75;
    window.__dndState = { dt, tgtX: x, tgtY: y };
    // Keep direct references so phase 2 hits the exact same nodes.
    window.__dndSrc = src; window.__dndTgt = tgt;
    const startPrevented = H.fire(src, 'dragstart', sr.left + 5, sr.top + 5, dt);
    const overPrevented = H.fire(tgt, 'dragover', x, y, dt);
    return { startPrevented, overPrevented };
  }, locate);
}

/** Phase 2: drop on target, dragend on source. */
async function dragEnd() {
  return page.evaluate(() => {
    const H = window.__dnd;
    const { dt, tgtX, tgtY } = window.__dndState;
    const dropPrevented = H.fire(window.__dndTgt, 'drop', tgtX, tgtY, dt);
    H.fire(window.__dndSrc, 'dragend', tgtX, tgtY, dt);
    window.__dndState = null; window.__dndSrc = null; window.__dndTgt = null;
    return { dropPrevented };
  });
}

/** Full two-phase drag with a React flush in the middle. */
async function drag(locate) {
  const p1 = await dragBegin(locate);
  await settle();          // commit dropPos so drop handler's closure is fresh
  const p2 = await dragEnd();
  await settle();          // commit the reorder
  return { ...p1, ...p2 };
}

const slideOrder = (m) => page.evaluate((t) => window.__dnd.slideOrder(t), m);
const sectionOrder = () => page.evaluate(() => window.__dnd.sectionOrder());

// ── Tests ────────────────────────────────────────────────────────────
async function runTests() {
  console.log('\n⛵ Vela Drag-and-Drop — e2e Reorder Tests\n');

  await installHelpers();

  // Sanity: helpers see the expected structure before we touch anything.
  await test('Harness sees module slide rows + section rows', async () => {
    const titleSlides = await slideOrder('Title');
    const sections = await sectionOrder();
    assert(titleSlides.length === 3, `expected 3 slides in "Title", got ${titleSlides.length}: ${JSON.stringify(titleSlides)}`);
    assert(sections.includes('Data & Metrics') && sections.includes('Code & Visual'),
      `expected named sections present, got ${JSON.stringify(sections)}`);
  });

  // ── 1. Reorder slides WITHIN a module ──
  // "Title" module: [v12.40 · APRIL 2026, You Think. Vela Shows., BY THE NUMBERS]
  // Drag slide 0 onto the BOTTOM half of the last slide (row 2) → moves it last.
  await test('Reorder slide within module (drag first slide to end)', async () => {
    const before = await slideOrder('Title');
    eq(before.length, 3, 'precondition: Title has 3 slides');
    const [a, b, c] = before;

    await drag({ kind: 'slide', src: { module: 'Title', rowIdx: 0 }, tgt: { module: 'Title', rowIdx: 2 }, pos: 'bottom' });

    const after = await slideOrder('Title');
    eq(after, [b, c, a], 'slide order after moving first slide to end');
  });

  // Move it back: drag the now-last slide (a) onto the TOP half of row 0 → first again.
  await test('Reorder slide within module (drag last slide to front)', async () => {
    const before = await slideOrder('Title'); // [b, c, a]
    const [b, c, a] = before;

    await drag({ kind: 'slide', src: { module: 'Title', rowIdx: 2 }, tgt: { module: 'Title', rowIdx: 0 }, pos: 'top' });

    const after = await slideOrder('Title');
    eq(after, [a, b, c], 'slide order restored: last slide moved to front');
  });

  // ── 2. No-op / invalid slide drop (guards over-eager reordering) ──
  // Drop a slide onto the TOP half of ITSELF → handler computes from===to and bails.
  await test('No-op slide drop (onto itself) leaves order unchanged', async () => {
    const before = await slideOrder('Title');

    await drag({ kind: 'slide', src: { module: 'Title', rowIdx: 1 }, tgt: { module: 'Title', rowIdx: 1 }, pos: 'top' });

    const after = await slideOrder('Title');
    eq(after, before, 'self-drop must not reorder');
  });

  // ── 3. Reorder sections / modules ──
  // Demo order has "Data & Metrics" immediately before "Code & Visual".
  // Drag "Code & Visual" onto the TOP half of "Data & Metrics" → they swap.
  await test('Reorder modules (drag a section before another)', async () => {
    const before = await sectionOrder();
    const di = before.indexOf('Data & Metrics');
    const ci = before.indexOf('Code & Visual');
    assert(di >= 0 && ci >= 0, `both sections present (got ${JSON.stringify(before)})`);
    assert(ci === di + 1, `precondition: "Code & Visual" directly follows "Data & Metrics" (di=${di}, ci=${ci})`);

    await drag({ kind: 'section', src: { title: 'Code & Visual' }, tgt: { title: 'Data & Metrics' }, pos: 'top' });

    const after = await sectionOrder();
    const di2 = after.indexOf('Data & Metrics');
    const ci2 = after.indexOf('Code & Visual');
    assert(ci2 === di2 - 1, `after: "Code & Visual" now directly precedes "Data & Metrics" (di2=${di2}, ci2=${ci2}) — order ${JSON.stringify(after)}`);
    // Every other section keeps its identity/count (pure reorder, no loss).
    eq([...after].sort(), [...before].sort(), 'section set unchanged (pure reorder)');
  });

  // Move it back so the run is idempotent: drag "Code & Visual" onto BOTTOM half of "Data & Metrics".
  await test('Reorder modules back (restore original section order)', async () => {
    const before = await sectionOrder(); // Code & Visual, Data & Metrics
    await drag({ kind: 'section', src: { title: 'Code & Visual' }, tgt: { title: 'Data & Metrics' }, pos: 'bottom' });
    const after = await sectionOrder();
    const di = after.indexOf('Data & Metrics');
    const ci = after.indexOf('Code & Visual');
    assert(ci === di + 1, `restored: "Code & Visual" follows "Data & Metrics" again (order ${JSON.stringify(after)})`);
    eq([...after].sort(), [...before].sort(), 'section set unchanged');
  });

  // ── 4. No-op / invalid section drop ──
  // Drop a section onto its OWN header → handler sees d.itemId === item.id and bails.
  await test('No-op section drop (onto itself) leaves order unchanged', async () => {
    const before = await sectionOrder();
    await drag({ kind: 'section', src: { title: 'Code & Visual' }, tgt: { title: 'Code & Visual' }, pos: 'top' });
    const after = await sectionOrder();
    eq(after, before, 'section self-drop must not reorder');
  });
}

// ── Main ─────────────────────────────────────────────────────────────
(async () => {
  const skipSetup = process.argv.includes('--skip-setup');
  let server = null;
  const t0 = Date.now();
  let fatalError = null;

  try {
    const { chromium } = resolvePlaywright();
    if (!skipSetup) { buildTestHTML(); server = await startServer(); }

    console.log('Launching browser...');
    const browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(5000);
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));

    console.log('Loading app (pre-transpiled)...');
    await page.goto(`http://localhost:${PORT}/`, { timeout: 60000, waitUntil: 'domcontentloaded' });
    await page.waitForSelector('header', { timeout: 10000 });
    await page.waitForFunction(() => document.querySelectorAll('.concept-row').length > 0, { timeout: 10000 });
    // Ensure slide rows have mounted (modules render expanded by default).
    await page.waitForFunction(
      () => document.querySelectorAll('[draggable="true"]').length > 3, { timeout: 10000 });

    await runTests();
    await browser.close();
  } catch (e) {
    fatalError = e;
    console.error('\n💥 Fatal error:', e.message);
    if (e.stack) console.error(e.stack);
  } finally {
    server?.close();
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  if (fatalError) {
    console.log(`  💥 Fatal error — ${passed} passed, ${failed} failed (${elapsed}s)`);
    console.log(`  ${fatalError.message}`);
  } else if (failed === 0) {
    console.log(`  ✅ ${passed} passed (${elapsed}s)`);
  } else {
    console.log(`  ❌ ${passed} passed, ${failed} failed (${elapsed}s)`);
  }
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  if (failed > 0) {
    console.log('Failures:');
    results.filter(r => !r.pass).forEach(r => console.log(`  ✗ ${r.name}: ${r.error}`));
    console.log('');
  }

  console.log(`${passed} passed, ${failed} failed`);
  process.exit((failed > 0 || fatalError) ? 1 : 0);
})();
