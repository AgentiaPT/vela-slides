// Spike step 2 — END TO END on a REAL Vela slide:
//   1. build-single-slide.cjs mounts ONE real VirtualSlide/SlideContent offline
//      (no editor chrome) at 960x540 — the same render path production reuses;
//   2. measure the rendered DOM into a primitive IR (boxes / ellipses / text
//      runs), exactly how part-pdf.jsx's vector exporter reads getBoundingClientRect
//      / Range client rects;
//   3. emit NATIVE, EDITABLE PowerPoint objects via the hand-rolled emitter.
//
// USAGE: node slide-to-pptx.mjs <deck.vela> [L] [I] [S]
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import pkg from '/home/user/vela-slides/node_modules/playwright/index.js';
import { buildPptx } from './pptx-emitter.mjs';
const { chromium } = pkg;

const DECK = process.argv[2] || '/home/user/vela-slides/examples/tech-talk.vela';
const [L, I, S] = [process.argv[3] || '0', process.argv[4] || '0', process.argv[5] || '0'];
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = new URL('./out', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// 1. Build the isolated single-slide page.
execFileSync('node', ['build-single-slide.cjs', DECK, OUT, L, I, S], { cwd: new URL('.', import.meta.url).pathname, stdio: 'inherit' });

const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 }).then(c => c.newPage());
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('file://' + OUT + '/slide.html', { waitUntil: 'load', timeout: 30000 });
for (let i = 0; i < 80; i++) {
  const st = await page.evaluate(() => ({ b: window.__velaBooted, e: window.__velaBootError }));
  if (st.e) throw new Error('boot error: ' + st.e);
  if (st.b) break;
  await page.waitForTimeout(200);
}
await page.evaluate(() => document.fonts && document.fonts.ready);
await page.waitForTimeout(500);

// 2. Measure the isolated slide into an IR (slide-local px == screen px here).
const ir = await page.evaluate(() => {
  const box = document.getElementById('slidebox');
  const fr = box.getBoundingClientRect();
  const inFrame = (r) => r.width > 0 && r.height > 0 && r.left >= fr.left - 1 && r.top >= fr.top - 1 && r.right <= fr.right + 1 && r.bottom <= fr.bottom + 1;
  const L2 = (r) => ({ x: r.left - fr.left, y: r.top - fr.top, w: r.width, h: r.height });
  const hex = (c) => {
    const m = (c || '').match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
    if (!m) return null;
    if ((m[4] === undefined ? 1 : +m[4]) < 0.06) return null;
    return '#' + [1, 2, 3].map(i => (+m[i]).toString(16).padStart(2, '0')).join('');
  };
  const pickFont = (f) => /mono/i.test(f) ? 'Space Mono' : /sora/i.test(f) ? 'Sora' : /dm sans/i.test(f) ? 'DM Sans' : 'Arial';

  const boxes = [], ellipses = [], texts = [];
  document.querySelectorAll('#slidebox *').forEach(el => {
    const cs = getComputedStyle(el);
    const bg = hex(cs.backgroundColor);
    if (!bg) return;
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3 || !inFrame(r)) return;
    if (r.width >= 958 && r.height >= 538) return; // full-bleed bg -> handled by ir.bg
    const l = L2(r), br = parseFloat(cs.borderRadius) || 0;
    const circle = br > 0 && Math.abs(r.width - r.height) < 2 && br >= r.width / 2 - 1;
    if (circle) ellipses.push({ cx: l.x + l.w / 2, cy: l.y + l.h / 2, r: l.w / 2, fill: bg });
    else boxes.push({ x: l.x, y: l.y, w: l.w, h: l.h, fill: bg, radius: Math.min(br, 24) });
  });

  const walk = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  let n;
  while ((n = walk.nextNode())) {
    const t = n.nodeValue.replace(/\s+/g, ' ').trim();
    if (!t || !n.parentElement) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter(inFrame);
    if (!rects.length) continue;
    const cs = getComputedStyle(n.parentElement);
    const color = hex(cs.color) || '#e2e8f0';
    const bold = (parseInt(cs.fontWeight) || 400) >= 600;
    const italic = cs.fontStyle === 'italic';
    const font = pickFont(cs.fontFamily);
    const size = parseFloat(cs.fontSize);
    for (const r of rects) {
      const l = L2(r);
      const key = t + '@' + Math.round(l.x) + ',' + Math.round(l.y);
      if (seen.has(key)) continue; seen.add(key);
      texts.push({ x: l.x, y: l.y - l.h * 0.1, w: Math.max(l.w + 4, 20), h: l.h * 1.3, text: t, size, color, bold, italic, font });
    }
  }
  const bg = hex(getComputedStyle(box).backgroundColor)
    || hex(getComputedStyle(box.firstElementChild || box).backgroundColor) || '#0f172a';
  return { bg, boxes, ellipses, texts, counts: { boxes: boxes.length, ellipses: ellipses.length, texts: texts.length } };
});

await browser.close();
console.log('extracted IR:', JSON.stringify(ir.counts), 'bg', ir.bg);
writeFileSync(OUT + '/real-slide-ir.json', JSON.stringify(ir, null, 1));
const buf = buildPptx([ir]);
writeFileSync(OUT + '/real-slide.pptx', buf);
console.log(`wrote out/real-slide.pptx (${buf.length} bytes) from ${DECK} slide ${L}.${I}.${S}`);
