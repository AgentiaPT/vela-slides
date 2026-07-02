import { chromium } from 'playwright';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const dir = process.argv[2];
const url = 'file://' + dir + '/index.html';
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('.concept-row', { timeout: 15000 });
await page.waitForTimeout(500);
// Select the module/slide first.
await page.click('.concept-row');
await page.waitForTimeout(300);
const editorHas = await page.evaluate(() => ({
  visible: document.body.innerText.includes('VISIBLEHEAD'),
  hidden: document.body.innerText.includes('SECRETHIDDENTEXT'),
}));
// Enter presentation via the Present button.
const present = await page.$('text=/Present/');
if (present) { await present.click(); await page.waitForTimeout(700); }
const presentHas = await page.evaluate(() => ({
  visible: document.body.innerText.includes('VISIBLEHEAD'),
  hidden: document.body.innerText.includes('SECRETHIDDENTEXT'),
  fullscreenActive: !!document.querySelector('[style*="100vw"]'),
}));
await page.screenshot({ path: dir + '/present.png' });
await b.close();
console.log(JSON.stringify({ editorHas, presentHas,
  PASS: editorHas.visible && editorHas.hidden && presentHas.visible && !presentHas.hidden }, null, 2));
