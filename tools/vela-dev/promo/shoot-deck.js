#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// shoot-deck.js — render one deck in the real app and save a still of each
// slide, plus one contact sheet. Use it to check slide design by eye.
//
// USAGE: node shoot-deck.js <deck.vela> <outDir> [--fonts <dir>] [--portrait]
//   <outDir>/s-01.jpg ...   each slide, fullscreen, 1920x1080
//   <outDir>/sheet.jpg      all slides on one sheet (read this first)
//   --portrait also writes p-01.jpg ... (phone, 390x844 at 2x) and sheet-p.jpg
// ─────────────────────────────────────────────────────────────────────────
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const REPO = path.resolve(__dirname, '..', '..', '..');
const { chromium } = require(path.join(REPO, 'node_modules', 'playwright'));

const [deckArg, outArg] = process.argv.slice(2);
if (!deckArg || !outArg) { console.error('usage: node shoot-deck.js <deck.vela> <outDir> [--fonts <dir>] [--portrait]'); process.exit(2); }
const deckPath = path.resolve(deckArg), outDir = path.resolve(outArg);
const fi = process.argv.indexOf('--fonts'), fontsDir = fi > 0 ? path.resolve(process.argv[fi + 1]) : null;
const portrait = process.argv.includes('--portrait');

function fontCss() {
  if (!fontsDir) return '';
  let css = '';
  for (const [family, pkg, slug, weights] of [['Sora', 'fontsource-sora', 'sora', [400, 600, 700, 800]], ['DM Sans', 'fontsource-dm-sans', 'dm-sans', [400, 500, 600, 700]], ['Space Mono', 'fontsource-space-mono', 'space-mono', [400, 700]]]) for (const w of weights) {
    const f = path.join(fontsDir, pkg, 'files', `${slug}-latin-${w}-normal.woff2`);
    if (fs.existsSync(f)) css += `@font-face{font-family:'${family}';font-weight:${w};font-style:normal;font-display:block;src:url('file://${f}') format('woff2');}\n`;
  }
  return css;
}
const sheet = (glob, cols, w, h, out) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-pattern_type', 'glob', '-i', glob, '-vf', `scale=${w}:${h},tile=${cols}x${Math.ceil(n / cols)}:padding=8:color=0x808080`, '-frames:v', '1', '-q:v', '3', out]);
let n = 0;

(async () => {
  const deck = JSON.parse(fs.readFileSync(deckPath, 'utf8'));
  for (const l of deck.lanes) for (const it of l.items || []) n += (it.slides || []).length;
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) if (/^(s|p)-\d+\.jpg$|^sheet/.test(f)) fs.rmSync(path.join(outDir, f));
  const render = path.join(outDir, 'render');
  execFileSync('node', [path.join(REPO, 'tools/vela-dev/scripts/render-offline.js'), deckPath, render], { stdio: 'ignore' });
  const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  const css = fontCss();
  const shoot = async (viewport, dsf, prefix) => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: dsf });
    const page = await ctx.newPage();
    await page.goto('file://' + path.join(render, 'render.html'));
    await page.waitForFunction(() => window.__velaBooted && document.getElementById('root').innerText.length > 100, { timeout: 30000 });
    if (css) { await page.addStyleTag({ content: css }); await page.evaluate(() => Promise.all(['800 20px Sora', '700 20px Sora', '600 20px Sora', '400 20px "DM Sans"', '700 20px "DM Sans"', '400 20px "Space Mono"', '700 20px "Space Mono"'].map(f => document.fonts.load(f)))); }
    await page.waitForTimeout(1000);
    await page.keyboard.press('f');
    await page.addStyleTag({ content: 'div:has(> [data-testid="fs-view-switch"]){display:none!important}' });
    for (let i = 1; i <= n; i++) {
      await page.waitForTimeout(2600); // entrance animation settles
      await page.screenshot({ path: path.join(outDir, `${prefix}-${String(i).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 90 });
      await page.keyboard.press('ArrowRight');
    }
    await ctx.close();
  };
  await shoot({ width: 960, height: 540 }, 2, 's');
  sheet(path.join(outDir, 's-*.jpg'), n > 4 ? 3 : 2, 960, 540, path.join(outDir, 'sheet.jpg'));
  if (portrait) { await shoot({ width: 390, height: 844 }, 2, 'p'); sheet(path.join(outDir, 'p-*.jpg'), Math.min(n, 5), 390, 844, path.join(outDir, 'sheet-p.jpg')); }
  await browser.close();
  console.log(`${n} slides → ${outDir}/sheet.jpg${portrait ? ' and sheet-p.jpg' : ''}`);
})().catch(e => { console.error(e); process.exit(1); });
