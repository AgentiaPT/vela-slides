import { chromium } from 'playwright';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const dir = process.argv[2];
const url = 'file://' + dir + '/index.html';
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('.concept-row', { timeout: 15000 });
await page.waitForTimeout(500);
await page.click('.concept-row');
await page.waitForTimeout(200);
// Enter presentation.
const present = await page.$('text=/Present/');
if (present) { await present.click(); await page.waitForTimeout(700); }

const tocOpen = () => page.evaluate(() => {
  const input = [...document.querySelectorAll('input')].find(i => /Search slides/.test(i.placeholder||''));
  if (!input) return { present: false };
  // Find the sliding panel ancestor and read its transform.
  let el = input;
  for (let k=0;k<8 && el; k++){ const t = getComputedStyle(el).transform; if (t && t!=='none') return { present:true, transform:t, opened: !/matrix.*-2[0-9][0-9]|translateX\(-/.test(t) }; el = el.parentElement; }
  return { present:true, transform:'none', opened:true };
});

const before = await tocOpen();
// Ctrl-E to open
await page.keyboard.press('Control+e');
await page.waitForTimeout(500);
const afterOpen = await tocOpen();
await page.screenshot({ path: dir + '/toc-open.png' });
// Type a search (focus the input explicitly).
const input = await page.$('input[placeholder*="Search slides"]');
await input.click();
await input.type('gallery', { delay: 20 });
await page.waitForTimeout(300);
const filtered = await page.evaluate(() => (document.body.innerText.match(/(\d+)\s*\/\s*(\d+)/)||[])[0]);
const slideBefore = await page.evaluate(() => (document.body.innerText.match(/(\d+)\s*\/\s*(\d+)/)||[])[0]);
// Enter → jump to first match + close
await input.press('Enter');
await page.waitForTimeout(500);
const afterEnter = await tocOpen();
const slideAfter = await page.evaluate(() => (document.body.innerText.match(/(\d+)\s*\/\s*(\d+)/)||[])[0]);
// Ctrl-E toggles open again
await page.keyboard.press('Control+e');
await page.waitForTimeout(400);
const afterToggle = await tocOpen();
await b.close();
console.log(JSON.stringify({
  before, afterOpen, afterEnter, afterToggle, slideBefore, slideAfter,
  openedByCtrlE: !before.opened || afterOpen.opened,
  closedOnEnter: afterOpen.opened && !afterEnter.opened,
  reopenedByCtrlE: !afterEnter.opened && afterToggle.opened,
}, null, 2));
