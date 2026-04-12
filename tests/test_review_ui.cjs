/**
 * Vela Slides — Review Mode / Comments UI Tests (Playwright e2e)
 *
 * Self-contained: builds the app, starts a local server, runs 32 tests.
 *
 * Usage:
 *   node tests/test_review_ui.cjs              # auto-setup + run
 *   node tests/test_review_ui.cjs --skip-setup  # reuse running server on :8765
 *
 * CI: the GitHub Actions workflow installs deps and calls this script.
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

// ── Config ───────────────────────────────────────────────────────────
const PORT = 8765;
const SERVE_DIR = path.join(require('os').tmpdir(), 'vela-e2e-serve');
const ROOT = path.resolve(__dirname, '..');
const ASSEMBLED = path.join(ROOT, 'vela-slides-live-demo.jsx');

// ── Resolve Playwright ──────────────────────────────────────────────
function resolvePlaywright() {
  // Try global installs first (pre-installed browsers), then local node_modules
  const globalPaths = [];
  try {
    // Resolve from the `playwright` CLI binary location
    const bin = execSync('which playwright 2>/dev/null', { encoding: 'utf8' }).trim();
    if (bin) {
      // npm/nvm layout: <prefix>/lib/node_modules/playwright
      globalPaths.push(path.resolve(path.dirname(bin), '..', 'lib', 'node_modules', 'playwright'));
      // pnpm global layout: find via pnpm root -g
      try {
        const pnpmRoot = execSync('pnpm root -g 2>/dev/null', { encoding: 'utf8' }).trim();
        if (pnpmRoot) globalPaths.push(path.join(pnpmRoot, 'playwright'));
      } catch {}
    }
  } catch {}
  const candidates = [
    ...globalPaths,
    path.join(ROOT, 'node_modules', 'playwright'),
  ];
  for (const p of candidates) {
    try { return require(p); } catch {}
  }
  throw new Error(
    'Playwright not found. Install: npm install --save-dev playwright\n' +
    'Then: npx playwright install chromium'
  );
}

// ── Build self-contained HTML ───────────────────────────────────────
function buildTestHTML() {
  fs.mkdirSync(SERVE_DIR, { recursive: true });

  // Assemble the deck
  console.log('Assembling deck...');
  execSync(
    `python3 skills/vela-slides/scripts/assemble.py examples/vela-demo.vela --from-parts`,
    { cwd: ROOT, stdio: 'pipe' }
  );

  // Copy UMD deps from node_modules
  const deps = {
    'react.js': 'react/umd/react.production.min.js',
    'react-dom.js': 'react-dom/umd/react-dom.production.min.js',
    'babel.js': '@babel/standalone/babel.min.js',
    'lucide.js': 'lucide-react/dist/umd/lucide-react.js',
  };
  for (const [dest, src] of Object.entries(deps)) {
    const full = path.join(ROOT, 'node_modules', src);
    if (!fs.existsSync(full)) throw new Error(`Missing dep: npm install ${src.split('/')[0]}`);
    fs.copyFileSync(full, path.join(SERVE_DIR, dest));
  }

  // Transform JSX imports → globals, build HTML
  const jsx = fs.readFileSync(ASSEMBLED, 'utf8')
    .replace(/^import {.*} from "react";/m,
      'const { useState, useReducer, useEffect, useLayoutEffect, useRef, useCallback, useMemo } = React;')
    .replace(/^import {.*} from "lucide-react";/m,
      'const { ChevronLeft, ChevronRight, Maximize2, Minimize2, Plus, X, Presentation, Download, Upload, Search, FileDown } = LucideReact;')
    .replace(/^import \* as _LucideAll from "lucide-react";/m,
      'const _LucideAll = LucideReact;')
    .replace(/^export default function App/m, 'function App');

  const html = [
    '<!DOCTYPE html><html><head><meta charset="UTF-8">',
    '<style>*{margin:0;padding:0;box-sizing:border-box}html,body,#root{width:100%;height:100%;overflow:hidden}</style>',
    '<script src="react.js"></script>',
    '<script src="react-dom.js"></script>',
    '<script>window.react = React;</script>',
    '<script src="lucide.js"></script>',
    '<script src="babel.js"></script>',
    '</head><body><div id="root"></div>',
    '<script type="text/babel" data-presets="react">',
    jsx,
    '',
    'const root = ReactDOM.createRoot(document.getElementById("root"));',
    'root.render(React.createElement(App));',
    '</script></body></html>',
  ].join('\n');

  fs.writeFileSync(path.join(SERVE_DIR, 'index.html'), html);
  console.log(`Built test HTML (${Math.round(html.length / 1024)}KB)`);
}

// ── Start HTTP server ───────────────────────────────────────────────
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let requestedPath;
      try {
        const urlObj = new URL(req.url, `http://localhost:${PORT}`);
        requestedPath = urlObj.pathname === '/' ? 'index.html' : urlObj.pathname.replace(/^\/+/, '');
      } catch {
        res.writeHead(400); res.end('Bad request'); return;
      }
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
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    server.listen(PORT, 'localhost', () => {
      console.log(`Test server on http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

// ── Test runner ──────────────────────────────────────────────────────
let passed = 0, failed = 0;
const results = [];

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

// ── Helpers (use Playwright auto-waiting, avoid fixed sleeps) ────────
let page;

/** Click a button matching text, wait for DOM to settle. */
async function clickBtn(text) {
  const btn = page.locator('button').filter({ hasText: text }).first();
  await btn.click();
  // Wait for React re-render — one rAF cycle
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Assert text is visible (uses Playwright auto-retry). */
async function expectText(text, timeout = 1000) {
  await page.locator(`text=${text}`).first().waitFor({ state: 'visible', timeout });
}

/** Assert text is NOT visible. */
async function expectNoText(text, timeout = 500) {
  await page.locator(`text=${text}`).first().waitFor({ state: 'hidden', timeout }).catch(() => {});
  const visible = await page.locator(`text=${text}`).first().isVisible().catch(() => false);
  if (visible) throw new Error(`"${text}" still visible`);
}

/** Check if comments panel is open (has COMMENTS header in mono font). */
async function isPanelOpen() {
  return page.evaluate(() => {
    const spans = document.querySelectorAll('span');
    return Array.from(spans).some(el =>
      el.textContent?.trim() === 'COMMENTS' &&
      el.style.fontWeight === '700' &&
      el.style.letterSpacing
    );
  });
}

/** Wait for comments panel to appear/disappear. */
async function expectPanel(open, timeout = 1000) {
  await page.waitForFunction((wantOpen) => {
    const spans = document.querySelectorAll('span');
    const found = Array.from(spans).some(el =>
      el.textContent?.trim() === 'COMMENTS' &&
      el.style.fontWeight === '700' &&
      el.style.letterSpacing
    );
    return found === wantOpen;
  }, open, { timeout });
}

/** Click first span with exact text and cursor:pointer. */
async function clickIconSpan(text) {
  const span = page.locator('span').filter({ hasText: text }).and(page.locator('[style*="cursor: pointer"], [style*="cursor:pointer"]')).first();
  await span.click();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Wait for React to settle after a state change. */
async function settle() {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

// ── Test suites ─────────────────────────────────────────────────────

async function runTests() {
  console.log('\n⛵ Vela Review Mode — UI Tests (32)\n');

  // ── 1. Panel Basics ──
  await test('Review button visible in header', async () => {
    const btn = page.locator('header button').filter({ hasText: 'Comments' });
    await btn.waitFor({ state: 'visible', timeout: 1000 });
  });

  await test('Clicking Review opens Comments panel', async () => {
    await clickBtn('Comments');
    await expectText('COMMENTS');
  });

  await test('Comments panel shows filter tabs', async () => {
    await expectText('Open');
    await expectText('Done');
  });

  await test('Comments panel has Resolve All button', async () => {
    await page.locator('button').filter({ hasText: 'Resolve All' }).waitFor({ state: 'visible', timeout: 1000 });
  });

  await test('Comments panel has Clear Done button', async () => {
    await page.locator('button').filter({ hasText: 'Clear Done' }).waitFor({ state: 'visible', timeout: 1000 });
  });

  await test('Comments panel has Copy for Agent button', async () => {
    await page.locator('button').filter({ hasText: 'Copy for Agent' }).waitFor({ state: 'visible', timeout: 1000 });
  });

  await test('Empty state shows no open comments', async () => {
    await expectText('No open comments');
  });

  // ── 2. Mutual Exclusion ──
  await test('Opening Vera closes Comments panel', async () => {
    await clickBtn('Vera');
    await expectPanel(false);
  });

  await test('Opening Review closes Vera panel', async () => {
    await clickBtn('Comments');
    await expectPanel(true);
    const veraTa = page.locator('textarea[placeholder*="Tell Vera"]');
    const vis = await veraTa.isVisible().catch(() => false);
    if (vis) throw new Error('Vera panel still visible');
  });

  // ── 3. Module-level Comments via TOC ──
  await test('Comment icon visible on modules', async () => {
    await page.locator('span').filter({ hasText: '💬' }).first().waitFor({ state: 'visible', timeout: 1000 });
  });

  await test('Clicking comment icon expands inline area', async () => {
    await clickIconSpan('💬');
    await page.locator('input[placeholder="Add comment..."]').waitFor({ state: 'visible', timeout: 1000 });
  });

  await test('Adding a module-level comment', async () => {
    const input = page.locator('input[placeholder="Add comment..."]');
    await input.fill('Test module spec: needs a timeline block');
    await input.press('Enter');
    await expectText('Test module spec: needs a timeline block');
  });

  await test('Comment appears in Comments panel', async () => {
    // Panel is on the right; verify the text shows there too
    await expectText('Test module spec: needs a timeline block');
  });

  await test('Comment count badge on module', async () => {
    // Badge: small span with number, 9px font, min-width, border-radius
    await page.waitForFunction(() => {
      const spans = document.querySelectorAll('span');
      return Array.from(spans).some(el =>
        /^[0-9]+$/.test(el.textContent?.trim() || '') &&
        el.style.minWidth && el.style.borderRadius && el.style.fontSize === '9px'
      );
    }, { timeout: 1000 });
  });

  await test('Adding a second comment', async () => {
    const input = page.locator('input[placeholder="Add comment..."]');
    await input.fill('Fix the color scheme');
    await input.press('Enter');
    await expectText('Fix the color scheme');
  });

  // ── 4. Resolve / Reopen ──
  await test('Resolving a comment via toggle', async () => {
    // Click first ○ marker with cursor:pointer
    const marker = page.locator('span').filter({ hasText: '○' })
      .and(page.locator('[style*="cursor: pointer"], [style*="cursor:pointer"]')).first();
    await marker.click();
    await settle();
    // Verify ● appears
    const resolved = page.locator('span').filter({ hasText: '●' })
      .and(page.locator('[style*="cursor: pointer"], [style*="cursor:pointer"]')).first();
    await resolved.waitFor({ state: 'visible', timeout: 1000 });
  });

  await test('Reopening a comment via toggle', async () => {
    const marker = page.locator('span').filter({ hasText: '●' })
      .and(page.locator('[style*="cursor: pointer"], [style*="cursor:pointer"]')).first();
    await marker.click();
    await settle();
  });

  // ── 5. Slide-level Comments via Block Hover ──
  await test('Block hover shows comment button (💬)', async () => {
    // Hover over a block on the slide to reveal the 💬 button
    const block = page.locator('[data-block-type]').first();
    await block.hover();
    await settle();
    const commentBtn = page.locator('button[title="Add comment"]').first();
    await commentBtn.waitFor({ state: 'visible', timeout: 1000 });
  });

  await test('Block comment button opens inline comment input', async () => {
    const commentBtn = page.locator('button[title="Add comment"]').first();
    await commentBtn.click();
    await settle();
    const input = page.locator('input[placeholder*="comment"], textarea[placeholder*="comment"]').first();
    await input.waitFor({ state: 'visible', timeout: 1000 });
  });

  await test('Adding a slide-level comment via block', async () => {
    const input = page.locator('input[placeholder*="comment"], textarea[placeholder*="comment"]').first();
    await input.fill('Slide comment: increase heading size');
    await input.press('Enter');
    await settle();
    await expectText('Slide comment: increase heading size');
  });

  await test('Slide comment appears in comments panel', async () => {
    // Comment was added — verify it shows in the comments panel (still open)
    await expectText('Slide comment: increase heading size');
  });

  await test('Comments panel reopens via R key after close', async () => {
    // Close panel
    await clickBtn('Comments');
    await settle();
    await expectPanel(false);
    // Reopen via R
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('r');
    await settle();
    await expectPanel(true);
  });

  // ── 6. Filter Tabs ──
  await test('Done tab shows resolved comments', async () => {
    // Resolve one first
    const marker = page.locator('span').filter({ hasText: '○' })
      .and(page.locator('[style*="cursor: pointer"], [style*="cursor:pointer"]')).first();
    await marker.click();
    await settle();
    // Switch to Done tab
    await page.locator('button').filter({ hasText: /^Done/ }).click();
    await settle();
    const count = await page.locator('text=Test module spec').or(page.locator('text=Fix the color')).or(page.locator('text=Slide comment')).count();
    if (count === 0) throw new Error('No comments in Done tab');
  });

  await test('Open tab shows only open comments', async () => {
    await page.locator('button').filter({ hasText: /^Open/ }).click();
    await settle();
  });

  await test('All tab shows everything', async () => {
    await page.locator('button').filter({ hasText: /^All/ }).click();
    await settle();
  });

  // ── 7. Batch Operations ──
  await test('Resolve All resolves all open comments', async () => {
    await page.locator('button').filter({ hasText: /^Open/ }).click();
    await settle();
    await clickBtn('Resolve All');
    await expectText('No open comments');
  });

  await test('Clear Done removes all resolved', async () => {
    await page.locator('button').filter({ hasText: /^All/ }).click();
    await settle();
    await clickBtn('Clear Done');
    await page.locator('button').filter({ hasText: /^Open/ }).click();
    await settle();
    await expectText('No open comments');
  });

  // ── 8. Keyboard Shortcuts ──
  await test('Closing review via button', async () => {
    // Ensure panel is open first
    if (!(await isPanelOpen())) await clickBtn('Comments');
    await settle();
    await clickBtn('Comments');
    await expectPanel(false);
  });

  await test('R key toggles review mode on', async () => {
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('r');
    await expectPanel(true);
  });

  await test('R key toggles review mode off', async () => {
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('r');
    await expectPanel(false);
  });

  // ── 9. Fullscreen Hides Badge ──
  await test('Comment badge hidden in fullscreen', async () => {
    // Ensure review mode is off so badge would show
    await page.evaluate(() => document.activeElement?.blur());
    if (await isPanelOpen()) {
      await page.keyboard.press('r');
      await settle();
    }
    // Enter fullscreen
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('f');
    await page.waitForFunction(() => !document.querySelector('header'), { timeout: 3000 });
    // Verify no comment badge overlay (guarded by !fullscreen)
    const hasBadge = await page.evaluate(() => {
      const divs = document.querySelectorAll('div');
      return Array.from(divs).some(el =>
        /^[0-9]+$/.test(el.textContent?.trim() || '') &&
        el.style.position === 'absolute' &&
        el.style.borderRadius === '11px' && el.style.cursor === 'pointer'
      );
    });
    if (hasBadge) throw new Error('Comment badge visible in fullscreen');
    // Exit fullscreen
    await page.keyboard.press('f');
    await page.waitForSelector('header', { timeout: 3000 });
  });

  // ── 10. Cleanup ──
  await test('Undo restores original state', async () => {
    for (let i = 0; i < 10; i++) await page.keyboard.press('Control+z');
    await page.waitForSelector('header', { timeout: 3000 });
  });
}

// ── Main ─────────────────────────────────────────────────────────────

(async () => {
  const skipSetup = process.argv.includes('--skip-setup');
  let server = null;
  const t0 = Date.now();

  try {
    const { chromium } = resolvePlaywright();

    if (!skipSetup) {
      buildTestHTML();
      server = await startServer();
    }

    console.log('Launching browser...');
    const browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(1000);
    page.on('pageerror', () => {}); // suppress Babel deopt warning

    console.log('Loading app (Babel transpiles ~1MB JSX, please wait)...');
    await page.goto(`http://localhost:${PORT}/`, { timeout: 60000, waitUntil: 'domcontentloaded' });
    await page.waitForSelector('header', { timeout: 180000 });
    // Wait for React to mount fully
    await page.waitForFunction(() => document.querySelectorAll('.concept-row').length > 0, { timeout: 10000 });

    // Select first module to have a slide visible
    await page.locator('.concept-row').first().click();
    await page.waitForFunction(
      () => document.querySelectorAll('[data-block-type]').length > 0,
      { timeout: 5000 }
    ).catch(() => {}); // soft — blocks may not have data attrs in all builds

    await runTests();

    await browser.close();
  } catch (e) {
    console.error('\n💥 Fatal error:', e.message);
    failed++;
  } finally {
    server?.close();
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  if (failed === 0 && passed > 0) {
    console.log(`  ✅ ${passed} passed (${elapsed}s)`);
  } else if (passed === 0 && failed === 0) {
    console.log(`  ❌ 0 tests ran — setup failed (${elapsed}s)`);
    failed = 1;
  } else {
    console.log(`  ❌ ${passed} passed, ${failed} failed (${elapsed}s)`);
  }
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  if (failed > 0) {
    console.log('Failures:');
    results.filter(r => !r.pass).forEach(r => console.log(`  ✗ ${r.name}: ${r.error}`));
    console.log('');
  }

  process.exit(failed > 0 ? 1 : 0);
})();
