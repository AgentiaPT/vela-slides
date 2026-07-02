// Real mouse-based drag of a section using Playwright's manual mouse steps.
import { chromium } from 'playwright';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const url = 'file://' + process.argv[2] + '/index.html';
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('.concept-row', { timeout: 15000 });
await page.waitForTimeout(600);
const titles = () => page.$$eval('.concept-row', rows => rows.map(r => [...r.querySelectorAll('span')].map(s=>s.textContent.trim()).filter(t=>t && t!=='▼' && !/^\d/.test(t) && t.length>2).sort((a,b)=>b.length-a.length)[0] || '?'));
const before = await titles();
const rows = await page.$$('.concept-row');
const src = await rows[3].boundingBox();   // drag 4th section
const tgt = await rows[0].boundingBox();    // to the top
// Manual HTML5 DnD: move, down, small move (to trigger dragstart), steps over target, up.
await page.mouse.move(src.x + 20, src.y + src.height/2);
await page.mouse.down();
await page.mouse.move(src.x + 20, src.y + src.height/2 + 4, { steps: 3 });
await page.mouse.move(tgt.x + 20, tgt.y + 6, { steps: 12 });
await page.mouse.move(tgt.x + 20, tgt.y + 3, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(400);
const after = await titles();
await b.close();
console.log(JSON.stringify({ before, after, changed: JSON.stringify(before)!==JSON.stringify(after) }, null, 2));
