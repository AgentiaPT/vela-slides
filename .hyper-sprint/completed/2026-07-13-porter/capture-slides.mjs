import { chromium } from 'playwright';
const [,, url, outdir] = process.argv;
import { mkdirSync } from 'fs';
mkdirSync(outdir, { recursive: true });
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const p = await b.newPage();
await p.setViewportSize({ width: 1400, height: 800 });
await p.goto(url, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__velaBooted === true', { timeout: 30000 }).catch(()=>{});
// select the module (concept-row) so slides become active
await p.evaluate(() => {
  const row = [...document.querySelectorAll('.concept-row')][0];
  if (row) row.click();
});
await p.waitForTimeout(300);
// collect slide-thumbnail elements: divs whose text starts with <num><time>
const thumbCount = await p.evaluate(() => {
  const all = [...document.querySelectorAll('div')];
  window.__thumbs = all.filter(el => /^\d+\d\d:\d\d/.test((el.textContent||'').trim()) && el.querySelector('span'));
  // fallback: elements containing the eye 👁 that look like a thumb
  if (!window.__thumbs.length) window.__thumbs = all.filter(el => (el.textContent||'').includes('👁') && /^\d/.test((el.textContent||'').trim()) && el.getBoundingClientRect().height < 120);
  return window.__thumbs.length;
});
console.log('module selected; thumbnails found:', thumbCount);
const n = Math.min(thumbCount, 40);
let rendered = 0;
for (let i = 0; i < n; i++) {
  const ok = await p.evaluate((idx) => {
    const t = window.__thumbs[idx];
    if (!t) return false;
    t.scrollIntoView({ block: 'center' });
    t.click();
    return true;
  }, i);
  if (!ok) continue;
  // wait for the staggered block fade-in to settle AND any data: images to finish decoding
  await p.waitForTimeout(2000);
  await p.evaluate(async () => {
    const imgs=[...document.querySelectorAll('img')].filter(im=>(im.src||'').startsWith('data:'));
    await Promise.all(imgs.map(im=>im.complete?null:im.decode().catch(()=>{})));
  });
  await p.waitForTimeout(200);
  // find the main slide canvas: the 960x540-ish element (largest aspect-16:9 box)
  const box = await p.evaluate(() => {
    const cands = [...document.querySelectorAll('div')].map(el => { const r = el.getBoundingClientRect(); return { el, r }; })
      .filter(x => x.r.width > 500 && x.r.height > 280 && Math.abs(x.r.width / x.r.height - 16/9) < 0.25);
    cands.sort((a,b) => b.r.width - a.r.width);
    const c = cands[0];
    if (!c) return null;
    return { x: c.r.x, y: c.r.y, width: c.r.width, height: c.r.height };
  });
  const num = String(i+1).padStart(2,'0');
  try {
    if (box) await p.screenshot({ path: `${outdir}/slide-${num}.png`, clip: box });
    else await p.screenshot({ path: `${outdir}/slide-${num}.png` });
    rendered++;
  } catch(e) { await p.screenshot({ path: `${outdir}/slide-${num}.png` }); rendered++; }
}
const cur = await p.evaluate(() => { try { const s = window.__velaGetCurrentSlide?.(); return s ? (s.blocks?.length ?? 'noblocks') : 'null'; } catch(e){ return 'err'; } });
console.log('captured', rendered, 'slides to', outdir, '| lastCurrentSlide blocks:', cur);
await b.close();
