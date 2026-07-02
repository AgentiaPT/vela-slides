// Read the in-app battery-test toast result.
import { chromium } from 'playwright';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const url = 'file://' + process.argv[2] + '/index.html';
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
const fails = [];
await page.goto(url, { waitUntil: 'load' });
// Poll for the battery toast text; capture failing test names if any.
let text = '';
for (let i = 0; i < 30; i++) {
  const r = await page.evaluate(() => {
    const el = [...document.querySelectorAll('span')].find(s => /Battery:\s*\d+\/\d+/.test(s.textContent||''));
    return el ? el.textContent : null;
  });
  if (r) { text = r; break; }
  await page.waitForTimeout(200);
}
// Copy details to grab failing names (click the copy button writes to clipboard; instead re-run in page)
const detail = await page.evaluate(() => {
  // VELA_TESTS is module-scoped; re-derive by reading the toast only.
  return null;
});
await b.close();
console.log('BATTERY:', text || 'NOT FOUND');
