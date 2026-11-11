#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// capture-assets.js — capture real Vela footage for the promo composition.
//
// Builds an offline render of each example deck (render-offline.js), opens it
// in the pinned Chromium and saves stills: every slide at 2x, the editor,
// the gallery, the phone (portrait) layout. Also writes manifest.json with
// the pixel rectangle of every block (from the app's data-block-type nodes).
//
// USAGE: node capture-assets.js <outDir> [--fonts <dir>]
//   --fonts  folder with unpacked @fontsource/{sora,dm-sans,space-mono}
//            packages. The container blocks Google Fonts; without this flag
//            the slides use the fallback system font.
// ─────────────────────────────────────────────────────────────────────────
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const REPO = path.resolve(__dirname, '..', '..', '..');
const { chromium } = require(path.join(REPO, 'node_modules', 'playwright'));

const DECKS = ['vela-demo', 'startup-pitch', 'tech-talk', 'business-report', 'course-training'];
const outDir = path.resolve(process.argv[2] || '');
if (!process.argv[2]) { console.error('usage: node capture-assets.js <outDir> [--fonts <dir>]'); process.exit(2); }
const fi = process.argv.indexOf('--fonts');
const fontsDir = fi > 0 ? path.resolve(process.argv[fi + 1]) : null;

const FONT_FILES = [
  ['Sora', 'fontsource-sora', 'sora', [400, 600, 700, 800]],
  ['DM Sans', 'fontsource-dm-sans', 'dm-sans', [400, 500, 600, 700]],
  ['Space Mono', 'fontsource-space-mono', 'space-mono', [400, 700]],
];
function fontCss() {
  if (!fontsDir) return '';
  let css = '';
  for (const [family, pkg, slug, weights] of FONT_FILES) for (const w of weights) {
    const f = path.join(fontsDir, pkg, 'files', `${slug}-latin-${w}-normal.woff2`);
    if (fs.existsSync(f)) css += `@font-face{font-family:'${family}';font-weight:${w};font-style:normal;font-display:block;src:url('file://${f}') format('woff2');}\n`;
  }
  return css;
}
function chromePath() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  return fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
}
function slideCount(deck) {
  const d = JSON.parse(fs.readFileSync(path.join(REPO, 'examples', deck + '.vela'), 'utf8'));
  let n = 0; for (const l of d.lanes) for (const it of l.items || []) n += (it.slides || []).length;
  return n;
}

(async () => {
  for (const d of ['slides', 'ui', 'phone', 'render']) fs.mkdirSync(path.join(outDir, d), { recursive: true });
  for (const deck of DECKS) {
    execFileSync('node', [path.join(REPO, 'tools/vela-dev/scripts/render-offline.js'),
      path.join(REPO, 'examples', deck + '.vela'), path.join(outDir, 'render', deck)], { stdio: 'ignore' });
  }
  const css = fontCss();
  const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  const open = async (deck, viewport, dsf) => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: dsf });
    const page = await ctx.newPage();
    await page.goto('file://' + path.join(outDir, 'render', deck, 'render.html'));
    await page.waitForFunction(() => window.__velaBooted && document.getElementById('root').innerText.length > 100, { timeout: 30000 });
    if (css) {
      await page.addStyleTag({ content: css });
      await page.evaluate(() => Promise.all(['800 20px Sora', '700 20px Sora', '600 20px Sora', '400 20px Sora',
        '400 20px "DM Sans"', '500 20px "DM Sans"', '600 20px "DM Sans"', '700 20px "DM Sans"',
        '400 20px "Space Mono"', '700 20px "Space Mono"'].map(f => document.fonts.load(f))));
    }
    await page.waitForTimeout(1200);
    return { ctx, page };
  };
  const manifest = { decks: {}, phone: [], ui: [] };

  // 1. Every slide, fullscreen, 1920x1080 (960x540 canvas at 2x).
  for (const deck of DECKS) {
    const n = slideCount(deck);
    const { ctx, page } = await open(deck, { width: 960, height: 540 }, 2);
    await page.keyboard.press('f');
    await page.addStyleTag({ content: 'div:has(> [data-testid="fs-view-switch"]){display:none!important}' });
    manifest.decks[deck] = [];
    for (let i = 1; i <= n; i++) {
      await page.waitForTimeout(2600); // entrance animation settles
      const file = `slides/${deck}-${String(i).padStart(2, '0')}.jpg`;
      await page.screenshot({ path: path.join(outDir, file), type: 'jpeg', quality: 94 });
      const blocks = await page.evaluate(() => [...document.querySelectorAll('[data-block-type]')].map(el => {
        const r = el.getBoundingClientRect();
        return { type: el.getAttribute('data-block-type'), x: r.x, y: r.y, w: r.width, h: r.height };
      }).filter(b => b.w > 4 && b.h > 4));
      manifest.decks[deck].push({ file, blocks });
      await page.keyboard.press('ArrowRight');
    }
    await ctx.close();
    console.log('slides', deck, n);
  }

  // 2. App screens at 1920x1080.
  {
    const { ctx, page } = await open('vela-demo', { width: 1920, height: 1080 }, 1);
    const shot = async (name) => { await page.screenshot({ path: path.join(outDir, 'ui', name + '.png') }); manifest.ui.push(`ui/${name}.png`); };
    await shot('editor-light');
    await page.keyboard.press('d'); await page.waitForTimeout(900);
    await shot('editor-dark');
    await page.keyboard.press('ArrowDown'); await page.waitForTimeout(400);
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(2600);
    await shot('editor-dark-2');
    await page.keyboard.press('g'); await page.waitForTimeout(3000);
    await shot('gallery');
    await ctx.close();
    console.log('ui ok');
  }

  // 3. Phone (portrait) layout, 390x844 at 3x.
  {
    const { ctx, page } = await open('vela-demo', { width: 390, height: 844 }, 3);
    await page.keyboard.press('f'); await page.waitForTimeout(1200);
    for (let i = 1; i <= 9; i++) {
      await page.waitForTimeout(2400);
      const file = `phone/p-${String(i).padStart(2, '0')}.png`;
      await page.screenshot({ path: path.join(outDir, file) });
      manifest.phone.push(file);
      await page.keyboard.press('ArrowRight');
    }
    await ctx.close();
    console.log('phone ok');
  }
  await browser.close();
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest));
  console.log('manifest', path.join(outDir, 'manifest.json'));
})().catch(e => { console.error(e); process.exit(1); });
