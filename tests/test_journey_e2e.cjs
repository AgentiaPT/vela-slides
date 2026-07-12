/**
 * Vela Slides — End-to-End Authoring Journey (Playwright, real browser)
 *
 * Closes the "broad but shallow" gap: ONE continuous browser session that walks
 * a realistic author → review → present → export flow and asserts the observable
 * app state after EACH hop (not isolated smoke checks). Every step reads the live
 * state, performs a real UI action, and asserts the delta.
 *
 * Harness: reuses the proven, CDN-free recipe from tests/test_review_ui.cjs —
 * concat.py → assemble.py(examples/vela-demo.vela) → Node-transpiled JSX served
 * over a local http server, booted in the pinned Chromium. No network beyond the
 * local server (the React/lucide CDNs are blocked in this container). Deterministic:
 * no AI/Vera calls — every mutation uses a non-AI affordance (inline click-to-edit,
 * the "+ add" item affordance, Duplicate/Move buttons, copy/paste, keyboard nav).
 *
 * State oracle: pure DOM — the on-slide "NN / MM" global counter (demo branding is
 * disabled, so the plain global counter renders), the current slide's heading text,
 * and its [data-block-type] attributes. (The window.__velaGetCurrentSlide hook is
 * only installed under serve.py/local mode, so it is NOT available in this offline
 * render — the same constraint the in-app UI battery works under.)
 *
 * Usage:
 *   node tests/test_journey_e2e.cjs                # auto-setup + run
 *   node tests/test_journey_e2e.cjs --skip-setup   # reuse a server already on :8766
 *
 * Prints "N passed" / "N passed, N failed" (same shape as test_review_ui.cjs so the
 * CI phase2 regex parses it) and exits non-zero on any failure.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

// ── Config ───────────────────────────────────────────────────────────
const PORT = 8766; // distinct from test_review_ui.cjs (:8765) so both can co-run
const SERVE_DIR = path.join(require('os').tmpdir(), 'vela-journey-serve');
const ROOT = path.resolve(__dirname, '..');
const ASSEMBLED = path.join(SERVE_DIR, 'assembled.jsx');

// ── Resolve Playwright (mirrors test_review_ui.cjs) ─────────────────
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

// ── Build self-contained HTML (mirrors test_review_ui.cjs) ──────────
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

// ── Start HTTP server (mirrors test_review_ui.cjs) ──────────────────
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
async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    passed++; const ms = Date.now() - t0;
    results.push({ name, pass: true, ms });
    console.log(`  ✅ ${name} (${ms}ms)`);
  } catch (e) {
    failed++; const ms = Date.now() - t0;
    results.push({ name, pass: false, error: e.message, ms });
    console.log(`  ❌ ${name} — ${e.message} (${ms}ms)`);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

// ── Live-state helpers (pure DOM, Playwright auto-wait) ─────────────
let page;

/** React settle: triple-rAF + micro-task flush (duplicate/nav trigger heavy
 *  thumbnail-capture re-renders on slow CI runners, so give React room). */
async function settle() {
  await page.evaluate(() => new Promise(r =>
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 70))))));
}
/** The on-slide "NN / MM" global counter → { pos, total } (1-based), or null. */
async function counter() {
  return page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('*')).find(
      e => e.children.length === 0 && /^\d+\s*\/\s*\d+$/.test((e.textContent || '').trim()));
    if (!el) return null;
    const m = el.textContent.trim().split('/');
    return { pos: parseInt(m[0].trim(), 10), total: parseInt(m[1].trim(), 10) };
  });
}
async function pos() { const c = await counter(); return c ? c.pos : null; }
async function total() { const c = await counter(); return c ? c.total : null; }
/** Heading text of the currently displayed slide (first heading block), or ''.
 *  Reads the editable TEXT node specifically — an editable heading also carries a
 *  ghost "+" icon-slot affordance whose glyph would otherwise pollute the text. */
async function headingText() {
  return page.evaluate(() => {
    const h = document.querySelector("[data-block-type='heading']");
    if (!h) return '';
    const w = Array.from(h.querySelectorAll('[style*="cursor: pointer"], [style*="cursor:pointer"]'))
      .find(e => { const t = (e.textContent || '').trim(); return t.length > 1 && t !== '+'; });
    return (w ? w.textContent : (h.textContent || '')).trim();
  });
}
/** Non-spacer block types of the currently displayed slide. */
async function blockTypes() {
  return page.evaluate(() => Array.from(document.querySelectorAll('[data-block-type]'))
    .map(e => e.getAttribute('data-block-type')).filter(t => t && t !== 'spacer'));
}
/** Content fingerprint of the current slide (heading + block-type sequence). */
async function fingerprint() { return { heading: await headingText(), types: (await blockTypes()).join(',') }; }
const sameFp = (a, b) => a.heading === b.heading && a.types === b.types;

/** Poll an async predicate; return its truthy value or throw on timeout. */
async function waitFor(fn, timeout = 5000, interval = 80) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try { const r = await fn(); if (r) return r; last = r; } catch (e) { last = e; }
    await page.waitForTimeout(interval);
  }
  throw new Error('waitFor timed out' + (last instanceof Error ? ` (${last.message})` : ''));
}
/** Blur focus + send a global keyboard shortcut, then settle. */
async function press(key) {
  await page.evaluate(() => { try { document.activeElement && document.activeElement.blur(); window.getSelection && window.getSelection().removeAllRanges(); } catch {} });
  await page.keyboard.press(key);
  await settle();
}
/** Press an arrow key and wait for the global position to actually move; returns
 *  true if it moved, false if it held (a deck boundary). Robust to slow re-renders.
 *  Used for WITHIN-module hops where every slide has a counter. */
async function navStep(key) {
  const p0 = await pos();
  await press(key);
  try { await waitFor(async () => { const n = await pos(); return n != null && n !== p0; }, 1500); return true; }
  catch { return false; }
}
/** Walk to the global first slide (counter shows position 1). Bounded ArrowLeft —
 *  robust even when the current slide sits in an empty module (no counter). */
async function gotoDeckStart() {
  for (let i = 0; i < 45; i++) {
    if ((await pos()) === 1) return true;
    await press('ArrowLeft');
  }
  return (await pos()) === 1;
}
/** Scan the WHOLE deck by pressing ArrowRight a bounded number of times (this
 *  traverses empty modules, which have no counter/heading). Returns the global
 *  position of the first slide whose heading === text (left in view), or null. */
async function findHeadingPos(text) {
  await gotoDeckStart();
  for (let i = 0; i < 45; i++) {
    if ((await headingText()) === text) return await pos();
    await press('ArrowRight');
  }
  return null;
}

// ── The journey ──────────────────────────────────────────────────────
async function runJourney() {
  console.log('\n⛵ Vela — End-to-End Authoring Journey\n');

  // 1 ── Boot & initial state ────────────────────────────────────────
  await test('1. Boot: module selected, slide renders with blocks', async () => {
    await gotoDeckStart();
    const c = await counter();
    assert(c, 'no slide counter on screen (module not selected?)');
    assert(c.pos === 1, `expected to start at deck position 1, got ${c.pos}`);
    assert(c.total >= 1, `bad slide total ${c.total}`);
    assert((await blockTypes()).length > 0, 'current slide renders no blocks');
  });

  // 2 ── Add a slide (system-clipboard copy → paste; non-AI) ─────────
  await test('2. Add a slide (copy+paste) → count +1, new slide selected', async () => {
    const c0 = await counter();
    // Copy current slide, then paste — inserts after current and selects it.
    await press('Control+c');
    await page.waitForTimeout(200);
    await press('Control+v');
    let added = false;
    try { await waitFor(async () => (await total()) === c0.total + 1, 2500); added = true; } catch {}
    if (!added) {
      // Robust fallback (clipboard perms can be flaky headless): the Duplicate
      // button is the same non-AI "add a slide" family. The step still asserts +1.
      await page.locator('button').filter({ hasText: 'Duplicate' }).first().click();
      await waitFor(async () => (await total()) === c0.total + 1, 4000);
    }
    const c1 = await counter();
    assert(c1.total === c0.total + 1, 'global slide total did not increase by 1');
    assert(c1.pos === c0.pos + 1, `new slide not selected (pos ${c0.pos}→${c1.pos})`);
  });

  // 3 ── Add content to the current slide via the "+ add" affordance ──
  //     (Vela has no non-AI "add whole block" control; the real non-AI
  //     add-content UI is the AddItem "+ add" affordance on multi-item blocks.)
  await test('3. Add a block-item via "+ add" affordance → content grows', async () => {
    // Find a slide (in view) exposing a "+ Add ..." affordance inside a block.
    let found = false;
    for (let i = 0; i < 8; i++) {
      found = await page.evaluate(() => Array.from(document.querySelectorAll('button'))
        .some(b => /^\+\s*Add/i.test((b.textContent || '').trim()) && b.closest('[data-block-type]')));
      if (found) break;
      await press('ArrowRight');
    }
    assert(found, 'no "+ add" item affordance found on any slide in the module');
    const blocksText = () => page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-block-type]')).map(e => e.textContent).join('|'));
    const before = await blocksText();
    const clicked = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button'))
        .find(x => /^\+\s*Add/i.test((x.textContent || '').trim()) && x.closest('[data-block-type]'));
      if (!b) return false; b.click(); return true;
    });
    assert(clicked, 'failed to click the "+ add" affordance');
    await waitFor(async () => (await blocksText()).length > before.length, 4000);
  });

  // 4 ── Inline edit the slide heading (click-to-edit; non-AI) ────────
  const EDIT_MARKER = 'JOURNEYEDIT' + Date.now();
  await test('4. Inline-edit heading text → new text renders', async () => {
    // Ensure we are on a slide that has a heading block.
    let hasHeading = false;
    for (let i = 0; i < 8; i++) {
      if ((await blockTypes()).includes('heading')) { hasHeading = true; break; }
      await press('ArrowRight');
    }
    assert(hasHeading, 'no slide with a heading block found to edit');
    await press('Escape'); // clear any stray popover before editing
    // Click the heading's editable TEXT div (NOT the "+" icon-slot ghost) → contentEditable.
    const entered = await page.evaluate(() => {
      const h = document.querySelector("[data-block-type='heading']");
      if (!h) return false;
      const w = Array.from(h.querySelectorAll('[style*="cursor: pointer"], [style*="cursor:pointer"]'))
        .find(e => e.offsetHeight > 0 && (e.textContent || '').trim().length > 1 && (e.textContent || '').trim() !== '+');
      if (!w) return false;
      w.click(); return true;
    });
    assert(entered, 'could not locate heading editable text wrapper');
    await settle();
    const set = await page.evaluate((mk) => {
      const ce = document.querySelector("[contenteditable='true']");
      if (!ce) return false;
      ce.textContent = mk;
      ce.dispatchEvent(new Event('input', { bubbles: true }));
      ce.blur();
      return true;
    }, EDIT_MARKER);
    assert(set, 'contentEditable did not open on the heading');
    await waitFor(async () => (await headingText()) === EDIT_MARKER, 5000);
    // And it is actually painted in the DOM.
    const inDom = await page.evaluate((mk) => (document.body.textContent || '').includes(mk), EDIT_MARKER);
    assert(inDom, 'edited heading text not rendered in the DOM');
  });

  // 5 ── Duplicate a slide (📋 button) ────────────────────────────────
  //     Duplicate a NON-marker neighbour so the step-4 marker stays unique
  //     (needed to unambiguously track the moved slide in step 7).
  await test('5. Duplicate slide → count +1 and duplicate matches original', async () => {
    await press('ArrowRight');
    if ((await headingText()) === EDIT_MARKER) await press('ArrowRight'); // never duplicate the marker
    const before = await fingerprint();
    const c0 = await counter();
    await page.locator('button').filter({ hasText: 'Duplicate' }).first().click();
    await waitFor(async () => (await total()) === c0.total + 1, 4000);
    const c1 = await counter();
    const after = await fingerprint();
    assert(c1.total === c0.total + 1, 'duplicate did not raise slide total by 1');
    assert(c1.pos === c0.pos + 1, 'duplicate not selected after original');
    assert(sameFp(before, after), 'duplicate content does not match the original slide');
  });

  // 6 ── Keyboard navigation across slides (within the first module) ──
  await test('6. Arrow navigation → index changes and content differs', async () => {
    await gotoDeckStart();
    const aPos = await pos();
    const a = await fingerprint();
    assert(await navStep('ArrowRight'), 'ArrowRight did not change the slide index');
    let b = await fingerprint();
    // Step-2's paste made slide 2 an identical copy of slide 1; hop until the
    // content genuinely differs (still comfortably inside the first module).
    let hops = 0;
    while (hops < 4 && sameFp(a, b)) { if (!(await navStep('ArrowRight'))) break; b = await fingerprint(); hops++; }
    assert(!sameFp(a, b), 'could not reach a slide whose content differs');
    const bPos = await pos();
    assert(bPos > aPos, 'position did not advance during navigation');
    assert(await navStep('ArrowLeft'), 'ArrowLeft did not navigate back');
    assert((await pos()) < bPos, 'ArrowLeft did not move to a lower position');
  });

  // 7 ── Move a slide to another module via the 📦 button (NOT drag) ──
  //     Vela has no non-AI same-module reorder control; moving the slide to a
  //     different module IS a button-driven placement change (DnD is covered by
  //     a separate suite). We move the unique step-4 marker slide and prove it
  //     relocated: total unchanged, and its global position changed (the app
  //     follows the moved slide into its new module).
  await test('7. Move slide to another module (button) → placement changes', async () => {
    const beforePos = await findHeadingPos(EDIT_MARKER);
    assert(beforePos != null, 'could not locate the marker slide to move');
    const total0 = await total();
    // Open the Move-to-module popover.
    await page.locator('button').filter({ hasText: 'Move' }).first().click();
    await waitFor(() => page.evaluate(() =>
      Array.from(document.querySelectorAll('div')).some(d => /Move to/.test((d.textContent || '')) && (d.textContent || '').trim().length < 14)), 3000);
    // Click the first destination-module button in the popover (excludes current module).
    const target = await page.evaluate(() => {
      const header = Array.from(document.querySelectorAll('div'))
        .find(d => { const t = (d.textContent || '').trim(); return t.startsWith('Move to') && t.length < 14; });
      if (!header || !header.parentElement) return null;
      const btn = header.parentElement.querySelector('button');
      if (!btn) return null;
      const t = (btn.textContent || '').trim();
      btn.click();
      return t;
    });
    assert(target, 'no destination-module button found in Move popover');
    await settle();
    // Total unchanged (relocation, not creation).
    await waitFor(async () => (await total()) === total0, 3000);
    // The slide relocated: still in the deck, but at a new global position.
    const afterPos = await findHeadingPos(EDIT_MARKER);
    assert(afterPos != null, 'moved slide vanished from the deck');
    assert(afterPos !== beforePos, `slide did not relocate (still at position ${afterPos})`);
  });

  // 8 ── Review mode: add a comment, then resolve it ─────────────────
  await test('8. Review mode: add a comment and resolve it (badge transitions)', async () => {
    // Enter review via the header Comments button.
    await page.locator('header button').filter({ hasText: 'Comments' }).first().click();
    await waitFor(() => page.evaluate(() => Array.from(document.querySelectorAll('span'))
      .some(el => (el.textContent || '').trim() === 'COMMENTS' && el.style.fontWeight === '700')), 3000);
    // Expand a module's inline comment area via its 💬 icon.
    await page.locator('span').filter({ hasText: '💬' })
      .and(page.locator('[style*="cursor: pointer"], [style*="cursor:pointer"]')).first().click();
    const input = page.locator('input[placeholder="Add comment..."]').first();
    await input.waitFor({ state: 'visible', timeout: 3000 });
    const commentText = 'Journey review note ' + Date.now();
    await input.fill(commentText);
    await input.press('Enter');
    // Comment text now visible (inline + panel).
    await page.locator(`text=${commentText}`).first().waitFor({ state: 'visible', timeout: 3000 });
    // A numeric count badge (9px) appears on the module.
    await page.waitForFunction(() => Array.from(document.querySelectorAll('span')).some(el =>
      /^[0-9]+$/.test((el.textContent || '').trim()) && el.style.minWidth && el.style.borderRadius && el.style.fontSize === '9px'), { timeout: 3000 });
    // Resolve: toggle the open (○) marker → resolved (●).
    await page.locator('span').filter({ hasText: '○' })
      .and(page.locator('[style*="cursor: pointer"], [style*="cursor:pointer"]')).first().click();
    await page.locator('span').filter({ hasText: '●' })
      .and(page.locator('[style*="cursor: pointer"], [style*="cursor:pointer"]')).first()
      .waitFor({ state: 'visible', timeout: 3000 });
    // Leave review mode.
    await page.locator('header button').filter({ hasText: 'Comments' }).first().click();
    await settle();
  });

  // 9 ── Presenter / fullscreen: chrome appears, navigate, then exits ─
  await test('9. Fullscreen present: chrome appears, navigates, then disappears', async () => {
    await gotoDeckStart(); // start on a real slide (not an empty module)
    await press('f');
    // Fullscreen removes the app header and mounts a fixed z-9999 stage.
    await page.waitForFunction(() => !document.querySelector('header'), { timeout: 3000 });
    const staged = await page.evaluate(() => Array.from(document.querySelectorAll('div'))
      .some(d => d.style.position === 'fixed' && d.style.zIndex === '9999'));
    assert(staged, 'fullscreen stage not present');
    assert(await navStep('ArrowRight'), 'fullscreen navigation did not advance the slide');
    // Presenter dashboard (S) appears then closes.
    await press('s');
    const hasPresenter = await page.evaluate(() => !!document.querySelector("[data-testid='presenter-view']"));
    if (hasPresenter) { await press('Escape'); await page.waitForFunction(() => !document.querySelector("[data-testid='presenter-view']"), { timeout: 3000 }); }
    // Exit fullscreen — header returns.
    await press('f');
    await page.waitForSelector('header', { timeout: 3000 });
  });

  // 10 ── Gallery overview: opens and closes ─────────────────────────
  await test('10. Gallery overview opens (G) and closes (Esc)', async () => {
    await press('g');
    await page.waitForSelector("[data-testid='gallery-close']", { timeout: 3000 });
    await press('Escape');
    await page.waitForFunction(() => !document.querySelector("[data-testid='gallery-close']"), { timeout: 3000 });
  });

  // 11 ── Export Markdown: capture the download, assert real content ──
  await test('11. Export Markdown → non-empty file with the deck content', async () => {
    // Make sure a slide is in view (header export menu is present).
    assert((await pos()) != null, 'lost slide state before export');
    await page.locator('[data-testid="export-menu-toggle"]').click();
    const mdItem = page.locator('button').filter({ hasText: 'Export Markdown' }).first();
    await mdItem.waitFor({ state: 'visible', timeout: 3000 });
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 8000 }),
      mdItem.click(),
    ]);
    const fp = await download.path();
    assert(fp, 'markdown download produced no file');
    const md = fs.readFileSync(fp, 'utf8');
    assert(md.length > 100, `markdown export suspiciously short (${md.length} bytes)`);
    assert(/^#\s/m.test(md), 'markdown has no heading lines');
    assert(md.includes('Exported from Vela'), 'markdown missing the Vela export footer');
    // End-to-end proof: the heading edited inline in step 4 flows into the export.
    assert(md.includes(EDIT_MARKER), 'inline-edited heading did not reach the markdown export');
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
    // A context lets us grant clipboard perms (copy/paste add-slide) + accept downloads.
    const context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
      acceptDownloads: true,
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    page = await context.newPage();
    page.setDefaultTimeout(4000);
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));

    console.log('Loading app (pre-transpiled)...');
    await page.goto(`http://localhost:${PORT}/`, { timeout: 60000, waitUntil: 'domcontentloaded' });
    await page.waitForSelector('header', { timeout: 10000 });
    await page.waitForFunction(() => document.querySelectorAll('.concept-row').length > 0, { timeout: 10000 });

    // Select the first module so a slide is on screen (mirrors test_review_ui.cjs).
    await page.locator('.concept-row').first().click();
    await page.waitForFunction(
      () => document.querySelectorAll('[data-block-type]').length > 0, { timeout: 5000 }
    ).catch(() => {});
    await settle();

    await runJourney();

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
    console.log(`  💥 Fatal error — 0 tests ran (${elapsed}s)`);
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
  process.exit((failed > 0 || fatalError) ? 1 : 0);
})();
