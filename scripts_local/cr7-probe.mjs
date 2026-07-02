import { chromium } from 'playwright';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const dir = process.argv[2];
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
// Stub the desktop update bridge BEFORE the app loads.
await page.addInitScript(() => { window.__velaCheckForUpdate = () => Promise.resolve({ latest: '99.9', updateAvailable: true }); });
await page.goto('file://'+dir+'/index.html', { waitUntil: 'load' });
await page.waitForSelector('.concept-row', { timeout: 15000 }); await page.waitForTimeout(500);
await page.evaluate(() => { const el = document.querySelector('[title="About Vela"]'); if (el) el.click(); });
await page.waitForTimeout(300);
const hasBtn = await page.evaluate(() => [...document.querySelectorAll('button')].some(b => /Check for updates/.test(b.textContent||'')));
let msgShown = null;
if (hasBtn) {
  await page.evaluate(() => { const b=[...document.querySelectorAll('button')].find(b=>/Check for updates/.test(b.textContent||'')); b.click(); });
  await page.waitForTimeout(400);
  msgShown = await page.evaluate(() => /Update available: v99\.9/.test(document.body.innerText));
}
await b.close();
console.log(JSON.stringify({ CR7_buttonShownWhenBridgePresent: hasBtn, CR7_clickShowsResult: msgShown }, null, 2));
