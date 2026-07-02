// Probe section drag-and-drop reorder in the real app.
import { chromium } from 'playwright';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const url = 'file://' + process.argv[2] + '/index.html';
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
const logs = [];
page.on('pageerror', e => logs.push('PAGEERR ' + e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('.concept-row', { timeout: 15000 });
await page.waitForTimeout(600);

const result = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.concept-row')];
  const titleOf = (r) => [...r.querySelectorAll('span')].map(s=>s.textContent.trim()).filter(t=>t && t!=='▼' && !/^\d/.test(t) && t.length>2).sort((a,b)=>b.length-a.length)[0] || '?';
  const before = rows.map(titleOf);
  if (rows.length < 3) return { error: 'need >=3 sections', before };
  // Drag row[2] to before row[0].
  const src = rows[2], tgt = rows[0];
  const dt = new DataTransfer();
  const fire = (el, type, extra = {}) => {
    const r = el.getBoundingClientRect();
    const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 10, clientY: (extra.top ? r.top + 3 : r.top + r.height / 2) });
    el.dispatchEvent(ev);
  };
  fire(src, 'dragstart');
  fire(tgt, 'dragenter', { top: true });
  fire(tgt, 'dragover', { top: true });
  fire(tgt, 'drop', { top: true });
  fire(src, 'dragend');
  return { before, dtTypes: [...dt.types] };
});
await page.waitForTimeout(400);
const after = await page.evaluate(() => [...document.querySelectorAll('.concept-row')].map(r => [...r.querySelectorAll('span')].map(s=>s.textContent.trim()).filter(t=>t && t!=='▼' && !/^\d/.test(t) && t.length>2).sort((a,b)=>b.length-a.length)[0] || '?'));
await b.close();
console.log(JSON.stringify({ before: result.before, after, changed: JSON.stringify(result.before) !== JSON.stringify(after), dtTypes: result.dtTypes, logs }, null, 2));
