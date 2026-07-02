import { chromium } from 'playwright';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const dir = process.argv[2];
const url = 'file://' + dir + '/index.html';
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('.concept-row', { timeout: 15000 });
await page.waitForTimeout(600);

// Count slides in the header stat before.
const countSlides = () => page.evaluate(() => {
  const el = [...document.querySelectorAll('span')].find(s => /\d+sl/.test(s.textContent||''));
  const m = el && (el.textContent.match(/(\d+)sl/)); return m ? +m[1] : null;
});
const before = await countSlides();

// Find a visible "＋ Add" affordance (non-compact, at a section end).
const addEls = await page.$$('text=/＋ Add/');
let clicked = false, menuShot = null;
if (addEls.length) {
  await addEls[0].scrollIntoViewIfNeeded();
  await addEls[0].click();
  await page.waitForTimeout(250);
  // Menu should now show Blank / AI slide / Section chips.
  const chips = await page.$$eval('button', bs => bs.map(b => b.textContent.trim()).filter(t => /Blank|AI slide|Section/.test(t)));
  menuShot = chips;
  await page.screenshot({ path: dir + '/addmenu.png' });
  // Click Blank
  const blank = await page.$('text=/＋ Blank/');
  if (blank) { await blank.click(); clicked = true; await page.waitForTimeout(300); }
}
const after = await countSlides();
await b.close();
console.log(JSON.stringify({ before, after, addAffordances: addEls.length, menuChips: menuShot, blankClicked: clicked, slideAdded: after != null && before != null && after === before + 1 }, null, 2));
