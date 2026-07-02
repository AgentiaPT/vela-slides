import { chromium } from 'playwright';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const dir = process.argv[2];
const url = 'file://' + dir + '/index.html';
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('.concept-row', { timeout: 15000 });
await page.waitForTimeout(600);

const statText = () => page.evaluate(() => {
  const el = [...document.querySelectorAll('span')].find(s => /\d+sl/.test(s.textContent||'') && /§/.test(s.textContent||''));
  return el ? el.textContent : null;
});
const before = await statText();
const hasSeconds = /\d+m\s*\d+s/.test(before || '');

// Open stats dialog
let dialog = null;
const statEl = await page.$('text=/\\d+sl/');
if (statEl) { await statEl.click(); await page.waitForTimeout(300);
  dialog = await page.evaluate(() => {
    const d = [...document.querySelectorAll('div')].find(x => /Deck stats/.test(x.textContent||''));
    return d ? d.innerText.replace(/\n+/g,' | ').slice(0,200) : null;
  });
  await page.screenshot({ path: dir + '/stats.png' });
  // close dialog
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
}

// Hide the first slide via its eye toggle.
const eye = await page.$('.slide-eye-toggle');
let afterHide = null, hiddenApplied = false;
if (eye) {
  await eye.click({ force: true });
  await page.waitForTimeout(300);
  afterHide = await statText();
  hiddenApplied = afterHide !== before;
}
await b.close();
console.log(JSON.stringify({ before, hasSeconds, dialog, afterHide, hiddenApplied }, null, 2));
