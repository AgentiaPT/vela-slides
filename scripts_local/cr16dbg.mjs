import { chromium } from 'playwright';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const dir = process.argv[2];
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
await page.goto('file://'+dir+'/index.html', { waitUntil: 'load' });
await page.waitForSelector('.concept-row', { timeout: 15000 });
await page.waitForTimeout(500);
await page.click('.concept-row'); await page.waitForTimeout(200);
await (await page.$('text=/Present/')).click(); await page.waitForTimeout(700);
await page.keyboard.press('Control+e'); await page.waitForTimeout(500);
const input = await page.$('input[placeholder*="Search slides"]');
await input.click(); await input.type('gener',{delay:20}); await page.waitForTimeout(300);
const diag = await page.evaluate(() => {
  const inp = [...document.querySelectorAll('input')].find(i=>/Search slides/.test(i.placeholder||''));
  const footer = [...document.querySelectorAll('span')].map(s=>s.textContent).filter(t=>/\/\s*\d+$/.test(t||''));
  return { searchVal: inp?.value, footer };
});
await input.press('Enter'); await page.waitForTimeout(500);
const after = await page.evaluate(() => {
  const inp = [...document.querySelectorAll('input')].find(i=>/Search slides/.test(i.placeholder||''));
  return { searchVal: inp?.value, present: !!inp };
});
await b.close();
console.log(JSON.stringify({ diag, after, errs }, null, 2));
