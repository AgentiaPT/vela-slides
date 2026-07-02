import { chromium } from 'playwright';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const url = 'file://' + process.argv[2] + '/index.html';
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('.concept-row', { timeout: 15000 });
await page.waitForTimeout(600);
await page.evaluate(() => {
  window.__ev = { dragover:0, prevented:0, notPrevented:0, typesSeen:{} };
  // Bubble phase (runs AFTER React root handlers) → observe defaultPrevented.
  window.addEventListener('dragover', (e) => {
    window.__ev.dragover++;
    const ts = [...(e.dataTransfer?.types||[])].join(',');
    window.__ev.typesSeen[ts] = (window.__ev.typesSeen[ts]||0)+1;
    if (e.defaultPrevented) window.__ev.prevented++; else window.__ev.notPrevented++;
  }, false);
});
const rows = await page.$$('.concept-row');
const src = await rows[3].boundingBox();
const tgt = await rows[0].boundingBox();
await page.mouse.move(src.x + 20, src.y + src.height/2);
await page.mouse.down();
await page.mouse.move(src.x + 25, src.y + src.height/2 + 6, { steps: 5 });
await page.mouse.move(tgt.x + 20, tgt.y + 10, { steps: 20 });
await page.mouse.move(tgt.x + 20, tgt.y + 4, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(300);
const ev = await page.evaluate(() => window.__ev);
await b.close();
console.log(JSON.stringify(ev, null, 2));
