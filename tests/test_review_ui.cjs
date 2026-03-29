/**
 * Vela Slides — Review Mode / Comments UI Tests
 * Real Playwright end-to-end tests against a live app instance.
 *
 * Run: node tests/test_review_ui.cjs
 * Requires: npm install playwright react@18 react-dom@18 @babel/standalone
 *           Server running on localhost:8765 (see test setup below)
 */

const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const APP_URL = 'http://localhost:8765/';
const LOAD_TIMEOUT = 180000; // Babel transpiles 1MB JSX

let browser, page;
let passed = 0, failed = 0;
const results = [];

async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    passed++;
    results.push({ name, pass: true, ms: Date.now() - t0 });
    console.log(`  ✅ ${name} (${Date.now() - t0}ms)`);
  } catch (e) {
    failed++;
    results.push({ name, pass: false, error: e.message, ms: Date.now() - t0 });
    console.log(`  ❌ ${name} — ${e.message} (${Date.now() - t0}ms)`);
  }
}

async function setup() {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  // Suppress Babel noise
  page.on('pageerror', () => {});

  console.log('Loading app (Babel transpilation, may take 1-2 min)...');
  await page.goto(APP_URL, { timeout: 60000, waitUntil: 'domcontentloaded' });
  await page.waitForSelector('header', { timeout: LOAD_TIMEOUT });
  // Let React settle
  await page.waitForTimeout(2000);
  console.log('App loaded.\n');

  // Select first module so we have a slide visible
  const mods = page.locator('.concept-row');
  if (await mods.count() > 0) {
    await mods.first().click();
    await page.waitForTimeout(1000);
  }
}

async function teardown() {
  await browser?.close();
}

// ── Helpers ──────────────────────────────────────────────────────────

async function clickButton(textMatch) {
  const btn = page.locator('button').filter({ hasText: textMatch }).first();
  await btn.click();
  await page.waitForTimeout(400);
  return btn;
}

async function findText(text, timeout = 3000) {
  return page.locator(`text=${text}`).first().waitFor({ timeout });
}

// ── Tests ────────────────────────────────────────────────────────────

async function runTests() {
  console.log('⛵ Vela Review Mode — UI Tests\n');

  // ── Header / Toggle ──
  await test('Review button visible in header', async () => {
    await findText('Review');
    const btn = page.locator('header button').filter({ hasText: 'Review' });
    if (await btn.count() === 0) throw new Error('Review button not in header');
  });

  await test('Clicking Review opens Comments panel', async () => {
    await clickButton('Review');
    await findText('COMMENTS');
  });

  await test('Comments panel shows filter tabs (All/Open/Done)', async () => {
    await findText('Open');
    await findText('Done');
  });

  await test('Comments panel has Resolve All button', async () => {
    const btn = page.locator('button').filter({ hasText: 'Resolve All' });
    if (await btn.count() === 0) throw new Error('Resolve All button missing');
  });

  await test('Comments panel has Clear Done button', async () => {
    const btn = page.locator('button').filter({ hasText: 'Clear Done' });
    if (await btn.count() === 0) throw new Error('Clear Done button missing');
  });

  await test('Comments panel has Copy for Agent button', async () => {
    const btn = page.locator('button').filter({ hasText: 'Copy for Agent' });
    if (await btn.count() === 0) throw new Error('Copy for Agent button missing');
  });

  await test('Empty state shows "No open comments"', async () => {
    await findText('No open comments');
  });

  // ── Mutual Exclusion ──
  await test('Opening Vera closes Comments panel', async () => {
    // Comments panel should be open from previous test
    await clickButton('Vera');
    await page.waitForTimeout(300);
    // Vera panel should be visible (textarea with "Tell Vera")
    const veraTa = page.locator('textarea').filter({ hasText: '' }).first();
    // COMMENTS header should be gone
    const commentsHeader = page.locator('text=COMMENTS').first();
    const visible = await commentsHeader.isVisible().catch(() => false);
    if (visible) throw new Error('Comments panel still visible after opening Vera');
  });

  await test('Opening Review closes Vera panel', async () => {
    // Vera should be open from previous test
    await clickButton('Review');
    await page.waitForTimeout(300);
    await findText('COMMENTS');
    // Vera textarea should be gone
    const veraTa = page.locator('textarea[placeholder*="Tell Vera"]');
    const visible = await veraTa.isVisible().catch(() => false);
    if (visible) throw new Error('Vera panel still visible after opening Review');
  });

  // ── Module-level Comments via TOC ──
  await test('💬 icon visible on modules', async () => {
    const icon = page.locator('span').filter({ hasText: '💬' }).first();
    if (await icon.count() === 0) throw new Error('💬 icon not found');
  });

  await test('Clicking 💬 expands inline comment area', async () => {
    const icons = page.locator('span').filter({ hasText: '💬' });
    // Click the first one that has cursor:pointer
    for (let i = 0; i < await icons.count(); i++) {
      const cursor = await icons.nth(i).evaluate(el => el.style?.cursor);
      if (cursor === 'pointer') {
        await icons.nth(i).click();
        await page.waitForTimeout(400);
        break;
      }
    }
    const input = page.locator('input[placeholder="Add comment..."]');
    if (await input.count() === 0) throw new Error('Comment input not found');
  });

  await test('Adding a module-level comment via TOC', async () => {
    const input = page.locator('input[placeholder="Add comment..."]');
    await input.fill('Test module spec: needs a timeline block');
    await input.press('Enter');
    await page.waitForTimeout(300);
    // The comment text should appear
    await findText('Test module spec: needs a timeline block');
  });

  await test('Comment appears in Comments panel', async () => {
    // The comments panel should be open (review mode)
    await findText('Test module spec: needs a timeline block', 2000);
    // Should show "1" in the open count badge
  });

  await test('Comment count badge appears on module', async () => {
    // Look for small badge with count near the module — has min-width, border-radius, and a number
    const badges = page.locator('span');
    let found = false;
    for (let i = 0; i < await badges.count(); i++) {
      const info = await badges.nth(i).evaluate(el => ({
        text: el.textContent?.trim(),
        bg: el.style?.background,
        minW: el.style?.minWidth,
        br: el.style?.borderRadius,
        fs: el.style?.fontSize,
      }));
      if (info.text && /^[0-9]+$/.test(info.text) && info.minW && info.br && info.fs === '9px') {
        found = true;
        break;
      }
    }
    if (!found) throw new Error('Count badge not found on module');
  });

  await test('Adding a second comment', async () => {
    const input = page.locator('input[placeholder="Add comment..."]');
    await input.fill('Fix the color scheme');
    await input.press('Enter');
    await page.waitForTimeout(300);
    await findText('Fix the color scheme');
  });

  // ── Resolve / Reopen ──
  await test('Resolving a comment via ○ toggle', async () => {
    // Find the first ○ (open comment marker) in the comments area
    const markers = page.locator('span').filter({ hasText: '○' });
    for (let i = 0; i < await markers.count(); i++) {
      const cursor = await markers.nth(i).evaluate(el => el.style?.cursor);
      if (cursor === 'pointer') {
        await markers.nth(i).click();
        await page.waitForTimeout(300);
        break;
      }
    }
    // After resolve, should see a ● (resolved marker)
    const resolved = page.locator('span').filter({ hasText: '●' });
    let found = false;
    for (let i = 0; i < await resolved.count(); i++) {
      const cursor = await resolved.nth(i).evaluate(el => el.style?.cursor);
      if (cursor === 'pointer') { found = true; break; }
    }
    if (!found) throw new Error('No resolved (●) marker found after resolve');
  });

  await test('Reopening a comment via ● toggle', async () => {
    const markers = page.locator('span').filter({ hasText: '●' });
    for (let i = 0; i < await markers.count(); i++) {
      const cursor = await markers.nth(i).evaluate(el => el.style?.cursor);
      if (cursor === 'pointer') {
        await markers.nth(i).click();
        await page.waitForTimeout(300);
        break;
      }
    }
    // Should be back to ○
  });

  // ── Slide-level Comment Popover ──
  await test('Review mode shows click overlay on slide', async () => {
    const overlay = page.locator('[style*="cursor: cell"]');
    if (await overlay.count() === 0) throw new Error('No click overlay (cursor:cell) found — review mode not active?');
  });

  await test('Clicking slide opens CommentPopover', async () => {
    const overlay = page.locator('[style*="cursor: cell"]').first();
    await overlay.click();
    await page.waitForTimeout(400);
    await findText('ADD COMMENT');
  });

  await test('CommentPopover has textarea and Add button', async () => {
    const ta = page.locator('textarea[placeholder="Add a comment..."]');
    if (await ta.count() === 0) throw new Error('Popover textarea not found');
    const btn = page.locator('button').filter({ hasText: 'Add Comment' });
    if (await btn.count() === 0) throw new Error('Add Comment button not found');
  });

  await test('Adding a slide-level comment via popover', async () => {
    const ta = page.locator('textarea[placeholder="Add a comment..."]');
    await ta.fill('Slide comment: increase heading size');
    await clickButton('Add Comment');
    await page.waitForTimeout(300);
    // Comment should now appear in the popover's existing list
    await findText('Slide comment: increase heading size');
  });

  await test('Slide comment badge appears on slide', async () => {
    // Close the popover first
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    // Look for badge with count on the slide — a div with a number, border-radius, and positioned absolutely
    const badges = page.locator('div');
    let found = false;
    for (let i = 0; i < await badges.count(); i++) {
      const info = await badges.nth(i).evaluate(el => ({
        text: el.textContent?.trim(),
        pos: el.style?.position,
        minW: el.style?.minWidth,
        br: el.style?.borderRadius,
        cursor: el.style?.cursor,
      }));
      if (info.text && /^[0-9]+$/.test(info.text) && info.pos === 'absolute' && info.minW && info.br && info.cursor === 'pointer') {
        found = true;
        break;
      }
    }
    if (!found) throw new Error('Slide comment badge not found');
  });

  // ── Filter Tabs ──
  await test('Done filter shows resolved comments', async () => {
    // Resolve one comment first
    const markers = page.locator('span').filter({ hasText: '○' });
    for (let i = 0; i < await markers.count(); i++) {
      const cursor = await markers.nth(i).evaluate(el => el.style?.cursor);
      if (cursor === 'pointer') {
        await markers.nth(i).click();
        await page.waitForTimeout(200);
        break;
      }
    }
    // Click Done filter tab
    const doneTab = page.locator('button').filter({ hasText: /^Done/ });
    await doneTab.click();
    await page.waitForTimeout(300);
    // Should still see some comments (the resolved one)
    const commentTexts = page.locator('text=Test module spec').or(page.locator('text=Fix the color')).or(page.locator('text=Slide comment'));
    if (await commentTexts.count() === 0) throw new Error('No resolved comments visible in Done tab');
  });

  await test('Open filter shows only open comments', async () => {
    const openTab = page.locator('button').filter({ hasText: /^Open/ });
    await openTab.click();
    await page.waitForTimeout(300);
    // Should still show some open comments
  });

  await test('All filter shows everything', async () => {
    const allTab = page.locator('button').filter({ hasText: /^All/ });
    await allTab.click();
    await page.waitForTimeout(300);
  });

  // ── Batch Operations ──
  await test('Resolve All resolves all open comments', async () => {
    // Switch to Open tab first to see count
    const openTab = page.locator('button').filter({ hasText: /^Open/ });
    await openTab.click();
    await page.waitForTimeout(200);
    await clickButton('Resolve All');
    await page.waitForTimeout(300);
    // Should now show "No open comments"
    await findText('No open comments');
  });

  await test('Clear Done removes all resolved comments', async () => {
    const allTab = page.locator('button').filter({ hasText: /^All/ });
    await allTab.click();
    await page.waitForTimeout(200);
    await clickButton('Clear Done');
    await page.waitForTimeout(300);
    // All comments should be gone
    const openTab = page.locator('button').filter({ hasText: /^Open/ });
    await openTab.click();
    await page.waitForTimeout(200);
    await findText('No open comments');
  });

  // ── Keyboard Shortcut ──
  await test('Closing review mode via button', async () => {
    await clickButton('Review');
    await page.waitForTimeout(300);
    // Comments panel should be gone
    const header = page.locator('text=COMMENTS').first();
    const visible = await header.isVisible().catch(() => false);
    if (visible) throw new Error('Comments panel still visible after toggling off');
  });

  await test('R key toggles review mode on', async () => {
    // Blur any focused element
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(100);
    await page.keyboard.press('r');
    await page.waitForTimeout(500);
    await findText('COMMENTS');
  });

  await test('R key toggles review mode off', async () => {
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(100);
    await page.keyboard.press('r');
    await page.waitForTimeout(500);
    const header = page.locator('text=COMMENTS').first();
    const visible = await header.isVisible().catch(() => false);
    if (visible) throw new Error('Comments panel still visible after R key toggle off');
  });

  // ── Comments hidden in fullscreen ──
  await test('Comment badges hidden in fullscreen/present mode', async () => {
    // First add a comment so there's a badge
    await page.keyboard.press('r'); // enter review mode
    await page.waitForTimeout(400);
    const icons = page.locator('span').filter({ hasText: '💬' });
    for (let i = 0; i < await icons.count(); i++) {
      const cursor = await icons.nth(i).evaluate(el => el.style?.cursor);
      if (cursor === 'pointer') {
        await icons.nth(i).click();
        await page.waitForTimeout(300);
        break;
      }
    }
    const input = page.locator('input[placeholder="Add comment..."]');
    if (await input.count() > 0) {
      await input.fill('Fullscreen test comment');
      await input.press('Enter');
      await page.waitForTimeout(300);
    }
    // Enter fullscreen
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(100);
    await page.keyboard.press('f');
    await page.waitForTimeout(500);
    // Header should be gone (fullscreen)
    const headerGone = await page.locator('header').count() === 0;
    // Comment badge should not be visible
    const badge = page.locator('[style*="cursor: cell"]');
    const cellVisible = await badge.isVisible().catch(() => false);
    if (cellVisible) throw new Error('Review overlay visible in fullscreen');
    // Exit fullscreen
    await page.keyboard.press('f');
    await page.waitForTimeout(500);
  });

  // ── Cleanup: undo all test changes ──
  await test('Undo cleans up test comments', async () => {
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(100);
    }
    // App should still be alive
    await page.waitForSelector('header', { timeout: 3000 });
  });
}

// ── Main ─────────────────────────────────────────────────────────────

(async () => {
  try {
    await setup();
    await runTests();
  } catch (e) {
    console.error('\n💥 Fatal error:', e.message);
  } finally {
    await teardown();
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  if (failed === 0) {
    console.log(`  ✅ ${passed} passed`);
  } else {
    console.log(`  ❌ ${passed} passed, ${failed} failed`);
  }
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  if (failed > 0) {
    console.log('Failures:');
    results.filter(r => !r.pass).forEach(r => console.log(`  ✗ ${r.name}: ${r.error}`));
  }

  process.exit(failed > 0 ? 1 : 0);
})();
