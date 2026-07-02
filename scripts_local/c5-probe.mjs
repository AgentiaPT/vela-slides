import { chromium } from 'playwright';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const dir = process.argv[2];
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto('file://'+dir+'/index.html', { waitUntil: 'load' });
await page.waitForSelector('.concept-row', { timeout: 15000 });
await page.waitForTimeout(600);

// CR14: cost badge ($ / 💲) should be hidden in local (non-artifact) mode.
const costBadgePresent = await page.evaluate(() => document.body.innerText.includes('💲') || /\$\s*—/.test(document.body.innerText));

// CR15: open Export dropdown, look for "Export Vela".
let exportVela = false, exportJson = false;
const clickedExport = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => /Export/.test(b.textContent||'') && /▾/.test(b.textContent||''));
  if (btn) { btn.click(); return true; } return false;
});
await page.waitForTimeout(300);
const menuText = await page.evaluate(() => document.body.innerText);
exportVela = /Export Vela/.test(menuText);
exportJson = /Export JSON/.test(menuText);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);

// CR1: open About via footer "VELA vX" then press Enter → should close.
let aboutOpen = false, closedByEnter = null;
try {
  await page.evaluate(() => { const el = document.querySelector('[title="About Vela"]'); if (el) el.click(); });
  await page.waitForTimeout(300);
  aboutOpen = await page.evaluate(() => /Recent Changes/i.test(document.body.innerText));
  if (aboutOpen) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    closedByEnter = !(await page.evaluate(() => /Recent Changes/i.test(document.body.innerText)));
  }
} catch (e) { aboutOpen = 'err:' + e.message.slice(0,40); }
await b.close();
console.log(JSON.stringify({ CR14_costBadgeHidden: !costBadgePresent, CR15_exportVela: exportVela, CR15_noExportJson: !exportJson, CR1_aboutOpened: aboutOpen, CR1_closedByEnter: closedByEnter }, null, 2));
