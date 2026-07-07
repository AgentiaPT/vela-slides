/**
 * Calibration driver.
 *   1. Boot offline render at a 960x540 viewport, select the calibration slide.
 *   2. Present -> close the SLIDES TOC (Ctrl+E) so the slide fills the viewport
 *      at scale 1 (1 screenshot px == 1 canvas px). Screenshot -> source.png.
 *   3. Exit present, drive the real PPTX export, save .pptx bytes.
 * Usage: node scratch-calib-drive.cjs <render.html> <sourcePngOut> <pptxOut>
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const [renderHtml, sourcePng, pptxOut] = process.argv.slice(2);
const ROOT = require('path').resolve(__dirname, '../../../..'); // repo root

function resolvePlaywright() {
  const cands = [];
  try { const bin = execSync('which playwright 2>/dev/null', { encoding: 'utf8' }).trim(); if (bin) cands.push(path.resolve(path.dirname(bin), '..', 'lib', 'node_modules', 'playwright')); } catch {}
  cands.push(path.join(ROOT, 'node_modules', 'playwright'));
  for (const p of cands) { try { return require(p); } catch {} }
  return null;
}
function findPinnedChromium() {
  try { const dirs = fs.readdirSync('/opt/pw-browsers').filter(d => /^chromium-\d+$/.test(d)).sort(); for (const d of dirs.reverse()) { const e = path.join('/opt/pw-browsers', d, 'chrome-linux', 'chrome'); if (fs.existsSync(e)) return e; } } catch {}
  return null;
}
async function driveExport(page) {
  const opened = await page.evaluate(() => { const b = document.querySelector('[data-testid=export-menu-toggle]'); if (!b) return false; b.click(); return true; });
  if (!opened) throw new Error('no export-menu-toggle');
  await page.waitForFunction(() => !!document.querySelector('[data-testid=export-pptx-menu-item]'), { timeout: 5000 });
  await page.evaluate(() => document.querySelector('[data-testid=export-pptx-menu-item]').click());
  await page.waitForFunction(() => !!document.querySelector('[data-testid=pptx-export-modal]'), { timeout: 5000 });
  await page.evaluate(() => document.querySelector('[data-testid=pptx-export-start]').click());
  await page.waitForFunction(() => document.querySelector('[data-testid=pptx-export-error]') || document.querySelector('[data-testid=pptx-export-download]'), { timeout: 120000 });
  const err = await page.evaluate(() => { const e = document.querySelector('[data-testid=pptx-export-error]'); return e ? e.textContent : null; });
  if (err) throw new Error('export error: ' + err);
  return await page.evaluate(() => { const a = document.querySelector('[data-testid=pptx-export-download]'); const uri = a.getAttribute('href') || ''; const c = uri.indexOf(','); return { b64: c >= 0 ? uri.slice(c + 1) : '' }; });
}

(async () => {
  const pw = resolvePlaywright();
  if (!pw) { console.log('SKIP: no playwright'); process.exit(2); }
  let browser; const args = ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'];
  try { browser = await pw.chromium.launch({ headless: true, args }); }
  catch (e) { browser = await pw.chromium.launch({ headless: true, args, executablePath: findPinnedChromium() }); }

  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto('file://' + renderHtml, { timeout: 60000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__velaBooted || window.__velaBootError, { timeout: 30000 });
  await page.waitForSelector('header', { timeout: 10000 });
  await page.waitForTimeout(1200);

  // Select the calibration slide's module row.
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('*')).filter(e => e.childElementCount < 3 && /HHHHHHHH/.test(e.textContent || ''));
    rows.sort((a, b) => a.textContent.length - b.textContent.length);
    if (rows[0]) rows[0].click();
  });
  await page.waitForTimeout(700);

  // Export first (header visible), save bytes immediately.
  const info = await driveExport(page);
  fs.writeFileSync(pptxOut, Buffer.from(info.b64, 'base64'));
  console.log('PPTX_BYTES ' + fs.statSync(pptxOut).size);

  // Dismiss the export modal, then present + close TOC for a full-bleed 960x540 screenshot.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(b => /Present/i.test(b.textContent || '')); if (b) b.click(); });
  await page.waitForFunction(() => !document.querySelector('header'), { timeout: 5000 });
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+e'); // toggle SLIDES TOC off
  await page.waitForTimeout(800);
  await page.screenshot({ path: sourcePng, clip: { x: 0, y: 0, width: 960, height: 540 } });
  console.log('SOURCE screenshot written (960x540, scale 1.0)');
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
