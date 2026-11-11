#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// capture-assets.js — capture real Vela footage for the promo composition.
//
// Builds an offline render of each showcase deck (promo/decks), opens it
// in the pinned Chromium and saves stills: every slide at 2x, the editor,
// the gallery, the phone (portrait) layout. Also writes manifest.json with
// the pixel rectangle of every block (from the app's data-block-type nodes).
//
// USAGE: node capture-assets.js <outDir> [--fonts <dir>] [--only slides,phone,extras]
//   Decks, the tour deck, the phone slides and the search query: "footage" in
//   promo.config.json.
//   --fonts  folder with unpacked @fontsource/{sora,dm-sans,space-mono}
//            packages. The container blocks Google Fonts; without this flag
//            the slides use the fallback system font.
// ─────────────────────────────────────────────────────────────────────────
const path = require('path');
const fs = require('fs');
const { execFileSync, spawnSync } = require('child_process');
const REPO = path.resolve(__dirname, '..', '..', '..');
const { chromium } = require(path.join(REPO, 'node_modules', 'playwright'));

const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'promo.config.json'), 'utf8')).footage;
const DECKS = CFG.decks, TOUR = CFG.tour, DECK_DIR = path.join(__dirname, 'decks');
const outDir = path.resolve(process.argv[2] || '');
if (!process.argv[2]) { console.error('usage: node capture-assets.js <outDir> [--fonts <dir>]'); process.exit(2); }
const fi = process.argv.indexOf('--fonts');
const fontsDir = fi > 0 ? path.resolve(process.argv[fi + 1]) : null;
const oi = process.argv.indexOf('--only');
const ONLY = oi > 0 ? process.argv[oi + 1].split(',') : null;
const want = part => !ONLY || ONLY.includes(part);
const VELA = path.join(REPO, 'skills/vela-slides/scripts/vela.py');
const renderDeck = (file, name) => execFileSync('node', [path.join(REPO, 'tools/vela-dev/scripts/render-offline.js'), file, path.join(outDir, 'render', name)], { stdio: 'ignore' });

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
  const d = JSON.parse(fs.readFileSync(path.join(DECK_DIR, deck + '.vela'), 'utf8'));
  let n = 0; for (const l of d.lanes) for (const it of l.items || []) n += (it.slides || []).length;
  return n;
}

const HIDE_FS_CHROME = 'div:has(> [data-testid="fs-view-switch"]){display:none!important}';
const jpg = (page, file) => page.screenshot({ path: path.join(outDir, file), type: 'jpeg', quality: 92 });

// 4. Feature footage: search in Present, edit while presenting, story mode,
//    and a real agent-style edit made with the vela CLI.
async function extras(open, manifest) {
  // 4a. Search in Present (Ctrl+E).
  {
    const { ctx, page } = await open(TOUR, { width: 1280, height: 720 }, 1.5);
    await page.keyboard.press('f'); await page.waitForTimeout(2600);
    await page.keyboard.press('Control+e'); await page.waitForTimeout(700);
    manifest.search = [];
    const Q = CFG.search, cuts = [1, Math.ceil(Q.length / 2), Q.length];
    for (const [k, n] of cuts.entries()) {
      await page.keyboard.type(Q.slice(k ? cuts[k - 1] : 0, n), { delay: 40 });
      await page.waitForTimeout(600);
      const file = `ui/search-${manifest.search.length}.jpg`; await jpg(page, file); manifest.search.push(file);
    }
    await page.keyboard.press('Enter'); await page.waitForTimeout(2600);
    await jpg(page, 'ui/search-3.jpg'); manifest.search.push('ui/search-3.jpg');
    await ctx.close(); console.log('search ok');
  }
  // 4b. Edit while presenting (Shift+E, then click the text).
  {
    const { ctx, page } = await open(TOUR, { width: 960, height: 540 }, 2);
    await page.keyboard.press('f'); await page.addStyleTag({ content: HIDE_FS_CHROME });
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(2600);
    manifest.edit = [];
    const shot = async () => { const file = `edit/e-${String(manifest.edit.length).padStart(2, '0')}.jpg`; await jpg(page, file); manifest.edit.push(file); };
    await shot();
    await page.keyboard.press('Shift+E'); await page.waitForTimeout(500);
    const box = await page.evaluate(() => { const r = document.querySelector('[data-block-type="heading"]').getBoundingClientRect(); return { x: r.x + Math.min(r.width / 2, 260), y: r.y + r.height / 2 }; });
    await page.mouse.click(box.x, box.y); await page.waitForTimeout(400);
    await page.keyboard.press('Control+a'); await page.waitForTimeout(200); await shot();
    const text = 'You talk. Your agent builds.';
    for (let i = 2; i <= text.length; i += 2) { await page.keyboard.type(text.slice(i - 2, i)); await page.waitForTimeout(90); await shot(); }
    await page.mouse.click(480, 500); await page.waitForTimeout(600); await shot();
    await ctx.close(); console.log('edit ok', manifest.edit.length);
  }
  // 4c. Story mode: one slide, four images (stills of real slides), shown one by one.
  {
    const img = n => 'data:image/jpeg;base64,' + fs.readFileSync(path.join(outDir, 'story', `src-${n}.jpg`)).toString('base64');
    const src = [['startup-pitch', 1], ['tech-talk', 1], ['course', 1], ['business-report', 1]];
    src.forEach(([d, n], i) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', path.join(outDir, 'slides', `${d}-${String(n).padStart(2, '0')}.jpg`), '-vf', 'scale=1120:630', '-q:v', '4', path.join(outDir, 'story', `src-${i}.jpg`)]));
    const deck = { deckTitle: 'Story mode', lanes: [{ title: 'Story', items: [{ title: 'Story', status: 'done', slides: [{ title: 'Four decks, one story', bg: '#0f172a', color: '#f1f5f9', accent: '#818cf8', padding: '32px 44px', story: true,
      blocks: [{ type: 'heading', text: 'Four decks, one story', size: 'xl' }, ...['Pitch', 'Tech talk', 'Course', 'Report'].map((c, i) => ({ type: 'image', src: img(i), caption: c }))] }] }] }] };
    const file = path.join(outDir, 'story', 'story.vela'); fs.writeFileSync(file, JSON.stringify(deck)); renderDeck(file, 'story');
    const { ctx, page } = await open('story', { width: 960, height: 540 }, 2);
    await page.keyboard.press('f'); await page.addStyleTag({ content: HIDE_FS_CHROME }); await page.waitForTimeout(2600);
    manifest.story = [];
    for (let i = 0; i < 5; i++) { const f = `story/s-${i}.jpg`; await jpg(page, f); manifest.story.push(f); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(1500); }
    await ctx.close(); console.log('story ok');
  }
  // 4d. Agent edit: the real vela CLI changes a deck file; each state is rendered.
  {
    const work = path.join(outDir, 'agent', 'pitch.vela'); fs.copyFileSync(path.join(DECK_DIR, 'startup-pitch.vela'), work);
    const cmds = [['slide', 'view', 'pitch.vela', '4'], ['slide', 'edit', 'pitch.vela', '4', 'block.0.text', 'Traction: Q3 update'], ['deck', 'replace-text', 'pitch.vela', '$480K', '$612K']];
    manifest.agent = { steps: [] };
    const state = async (name) => {
      renderDeck(work, 'agent-' + name);
      const { ctx, page } = await open('agent-' + name, { width: 1600, height: 900 }, 1.2);
      await page.keyboard.press('d'); await page.waitForTimeout(600);
      for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(350); }
      await page.waitForTimeout(2400); await jpg(page, `agent/${name}.jpg`); await ctx.close();
      return `agent/${name}.jpg`;
    };
    let shot = await state('0');
    for (const [i, c] of cmds.entries()) {
      const r = spawnSync('python3', [VELA, ...c], { cwd: path.dirname(work), encoding: 'utf8' });
      if (r.status !== 0) throw new Error('vela CLI failed: ' + c.join(' '));
      const out = (r.stderr + r.stdout).split('\n').filter(l => l.trim());
      if (i > 0) shot = await state(String(i));
      manifest.agent.steps.push({ cmd: 'vela ' + c.map(a => (/[ $]/.test(a) ? JSON.stringify(a) : a)).join(' '), out: out.slice(0, i === 0 ? 5 : 1), shot });
    }
    manifest.agent.start = 'agent/0.jpg';
    console.log('agent ok');
  }
}

(async () => {
  for (const d of ['slides', 'ui', 'phone', 'render', 'edit', 'story', 'agent']) fs.mkdirSync(path.join(outDir, d), { recursive: true });
  for (const deck of DECKS) renderDeck(path.join(DECK_DIR, deck + '.vela'), deck);
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
  const mf = path.join(outDir, 'manifest.json');
  const manifest = ONLY && fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : { decks: {}, phone: [], ui: [] };

  // 1. Every slide, fullscreen, 1920x1080 (960x540 canvas at 2x).
  for (const deck of want('slides') ? DECKS : []) {
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

  // 3. Phone (portrait) layout, 390x844 at 3x.
  if (want('phone')) {
    manifest.phone = [];
    const { ctx, page } = await open(TOUR, { width: 390, height: 844 }, 3);
    await page.keyboard.press('f'); await page.waitForTimeout(1200);
    manifest.phonePick = CFG.phone;
    for (let i = 1; i <= slideCount(TOUR); i++) {
      await page.waitForTimeout(2400);
      const file = `phone/p-${String(i).padStart(2, '0')}.png`;
      await page.screenshot({ path: path.join(outDir, file) });
      manifest.phone.push(file);
      await page.keyboard.press('ArrowRight');
    }
    await ctx.close();
    console.log('phone ok');
  }
  if (want('extras')) await extras(open, manifest);
  await browser.close();
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest));
  console.log('manifest', path.join(outDir, 'manifest.json'));
})().catch(e => { console.error(e); process.exit(1); });
