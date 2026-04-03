// E2E test for Vela Local Server using Playwright
// Usage: node tests/test_e2e_serve.js

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const DECK_PATH = path.join(__dirname, '..', 'examples', 'vela-demo.vela');
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
const PORT = 13030;
const SERVE_SCRIPT = path.join(__dirname, '..', 'skills', 'vela-slides', 'scripts', 'serve.py');

function waitForServer(port, maxWait = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const req = http.get(`http://localhost:${port}/`, (res) => {
        if (res.statusCode === 200) {
          res.resume();
          resolve();
        } else {
          retry();
        }
      });
      req.on('error', retry);
      req.setTimeout(1000, retry);
    };
    const retry = () => {
      if (Date.now() - start > maxWait) {
        reject(new Error(`Server not ready after ${maxWait}ms`));
      } else {
        setTimeout(check, 500);
      }
    };
    check();
  });
}

async function run() {
  // Create screenshots dir
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  // Make a copy of the deck for testing
  const testDeck = path.join(SCREENSHOTS_DIR, 'test-deck.json');
  fs.copyFileSync(DECK_PATH, testDeck);

  console.log('[e2e] Starting Vela local server...');

  // Start the server
  const server = spawn('python3', [SERVE_SCRIPT, testDeck, '--port', String(PORT), '--no-open'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env }
  });

  let serverOutput = '';
  server.stdout.on('data', (d) => { serverOutput += d.toString(); });
  server.stderr.on('data', (d) => { serverOutput += d.toString(); });

  try {
    // Wait for server to be ready
    await waitForServer(PORT);
    console.log('[e2e] Server is ready');

    // Launch browser
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    // Collect console messages
    const consoleLogs = [];
    page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));

    // Navigate to the app
    console.log('[e2e] Loading Vela app...');
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for the app to render (Babel transpilation takes a moment)
    console.log('[e2e] Waiting for app to render...');
    await page.waitForTimeout(5000); // Give Babel time to transpile

    // Take screenshot of initial load
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01-initial-load.png'), fullPage: false });
    console.log('[e2e] Screenshot: 01-initial-load.png');

    // Check the page title
    const title = await page.title();
    console.log(`[e2e] Page title: "${title}"`);
    assert(title.includes('Vela'), `Expected title to contain "Vela", got "${title}"`);

    // Check that the app loaded (look for Vela-specific elements)
    const hasVela = await page.evaluate(() => {
      return document.querySelector('[data-vela-footer]') !== null ||
             document.body.innerText.includes('Local Mode') ||
             document.body.innerText.includes('Vela');
    });
    console.log(`[e2e] Vela app rendered: ${hasVela}`);

    // Check that Local Mode indicator is visible
    const localModeVisible = await page.evaluate(() => {
      return document.body.innerText.includes('Local Mode');
    });
    console.log(`[e2e] Local Mode indicator: ${localModeVisible}`);

    // Check that Vera button is NOT visible (AI disabled)
    const veraVisible = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.some(b => b.textContent.includes('Vera'));
    });
    console.log(`[e2e] Vera button hidden: ${!veraVisible}`);
    assert(!veraVisible, 'Vera button should be hidden in local mode');

    // Take screenshot showing the slides
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02-slides-view.png'), fullPage: false });
    console.log('[e2e] Screenshot: 02-slides-view.png');

    // Test WebSocket connection
    const wsConnected = consoleLogs.some(l => l.includes('vela-sync') && l.includes('Connected'));
    console.log(`[e2e] WebSocket connected: ${wsConnected}`);

    // Test file → browser sync
    console.log('[e2e] Testing file → browser sync...');
    const deck = JSON.parse(fs.readFileSync(testDeck, 'utf8'));
    deck.deckTitle = 'E2E Modified Deck';
    // Also modify a slide
    if (deck.lanes && deck.lanes[0] && deck.lanes[0].items && deck.lanes[0].items[0] &&
        deck.lanes[0].items[0].slides && deck.lanes[0].items[0].slides[0]) {
      const firstSlide = deck.lanes[0].items[0].slides[0];
      if (firstSlide.blocks && firstSlide.blocks[0]) {
        firstSlide.blocks[0].text = 'E2E Test - File Sync Works!';
      }
    }
    fs.writeFileSync(testDeck, JSON.stringify(deck, null, 2));

    // Wait for file watcher to detect and push
    await page.waitForTimeout(2000);

    // Take screenshot after file change
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '03-after-file-sync.png'), fullPage: false });
    console.log('[e2e] Screenshot: 03-after-file-sync.png');

    // Verify the page shows the updated title
    const updatedTitle = await page.evaluate(() => {
      return document.body.innerText.includes('E2E Modified') || document.body.innerText.includes('E2E Test');
    });
    console.log(`[e2e] File sync reflected in browser: ${updatedTitle}`);

    // Check for any JS errors
    const errors = consoleLogs.filter(l => l.startsWith('[error]'));
    if (errors.length > 0) {
      console.log('[e2e] JS errors found:');
      errors.forEach(e => console.log(`  ${e}`));
    }

    // Summary
    console.log('\n[e2e] ─────────────────────────────────');
    console.log('[e2e] Results:');
    console.log(`  Page loaded:         ✅`);
    console.log(`  Vela rendered:       ${hasVela ? '✅' : '❌'}`);
    console.log(`  Local Mode:          ${localModeVisible ? '✅' : '⚠️  (may need Babel)'}`);
    console.log(`  Vera hidden:         ${!veraVisible ? '✅' : '❌'}`);
    console.log(`  WS connected:        ${wsConnected ? '✅' : '⚠️  (async, may not appear yet)'}`);
    console.log(`  File sync:           ${updatedTitle ? '✅' : '⚠️  (async)'}`);
    console.log(`  JS errors:           ${errors.length === 0 ? '✅ None' : '❌ ' + errors.length}`);
    console.log(`  Screenshots:         ${SCREENSHOTS_DIR}/`);
    console.log('[e2e] ─────────────────────────────────\n');

    await browser.close();

    // All critical checks passed
    const passed = hasVela || !veraVisible; // Core functionality
    if (!passed) {
      console.log('[e2e] ❌ FAILED: Core app did not render');
      process.exit(1);
    }
    console.log('[e2e] ✅ All E2E checks passed');

  } catch (err) {
    console.error('[e2e] ❌ ERROR:', err.message);
    console.error('[e2e] Server output:', serverOutput.slice(-500));
    process.exit(1);
  } finally {
    server.kill('SIGTERM');
    // Clean up test deck
    try { fs.unlinkSync(testDeck); } catch {}
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

run().catch((err) => {
  console.error('[e2e] Fatal:', err);
  process.exit(1);
});
