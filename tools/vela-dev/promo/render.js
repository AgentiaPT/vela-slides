#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// render.js — build the Vela promo video.
//
//   1. capture   real footage of the app          (capture-assets.js)
//   2. data      facts read from the repository   (<work>/assets/data.js)
//   3. audio     soundtrack, played `passes` times on the beat grid
//   4. frames    the composition, seeked frame by frame in Chromium
//   5. encode    H.264 + AAC .mp4 (ffmpeg)
//
// USAGE
//   node render.js --work <dir> --audio <track.mp3> [--fonts <dir>] [--out <file.mp4>]
//                  [--skip-capture] [--jobs 4] [--from <s>] [--to <s>] [--blur 4]
//                  [--stills 1.5,14.4,...]   (write PNG stills only, no video)
// The work folder holds footage, frames and the result. Keep it outside git.
// ─────────────────────────────────────────────────────────────────────────
const path = require('path');
const fs = require('fs');
const { execFileSync, spawn } = require('child_process');
const REPO = path.resolve(__dirname, '..', '..', '..');
const { chromium } = require(path.join(REPO, 'node_modules', 'playwright'));
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'promo.config.json'), 'utf8'));

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : def; };
const has = name => argv.includes('--' + name);
if (!opt('work')) { console.error('usage: node render.js --work <dir> --audio <track.mp3> [--fonts <dir>] [--out file.mp4] [--skip-capture] [--jobs 4] [--from s] [--to s] [--stills t,t,...]'); process.exit(2); }
const WORK = path.resolve(opt('work'));
const ASSETS = path.join(WORK, 'assets');
const FONTS = opt('fonts') ? path.resolve(opt('fonts')) : null;
const read = p => fs.readFileSync(path.join(REPO, p), 'utf8');
const ff = args => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });

// ── 2. facts: every number on screen comes from the code ─────────────────
function buildData() {
  const app = read('skills/vela-slides/app/vela.jsx');
  const imports = read('src/parts/part-imports.jsx');
  const engine = read('src/parts/part-engine.jsx');
  const need = (v, what) => { if (v == null || v === false) throw new Error('facts: cannot read ' + what); return v; };
  const version = need(/const VELA_VERSION = "([\d.]+)"/.exec(imports), 'VELA_VERSION')[1];
  const types = need(/const SAFE_BLOCK_TYPES = new Set\(\[([^\]]+)\]/.exec(imports), 'SAFE_BLOCK_TYPES')[1];
  const blockTypes = [...types.matchAll(/"([a-z-]+)"/g)].map(m => m[1]);
  const sw = engine.indexOf('switch (name)');
  const tools = (engine.slice(sw, engine.indexOf('default:', sw)).match(/case "/g) || []).length;
  const cl = imports.slice(imports.indexOf('const VELA_CHANGELOG = ['));
  const versions = [...cl.slice(0, cl.indexOf('\n];')).matchAll(/^\s*\{ ?v: ?"([\d.]+)"/gm)].map(m => m[1]).reverse();
  need(blockTypes.length > 0 && tools > 0 && versions.length > 0, 'block types / tools / changelog');
  // Background texture: plain renderer code from one part-file. Short lines only.
  const blocks = read('src/parts/part-blocks.jsx').split('\n');
  const start = Math.max(0, blocks.findIndex(l => l.includes('function RenderBlock')));
  const code = blocks.slice(start).filter(l => l.trim().length > 24 && l.length < 92 && !/https?:|<script|javascript:/i.test(l)).slice(0, 260).map(l => l.replace(/\t/g, '  '));
  const deck = JSON.parse(read('examples/vela-demo.vela'));
  const logo = need(deck.lanes[0].items[0].slides[0].blocks.find(b => b.type === 'svg'), 'logo svg').markup;
  let fontCss = '';
  if (FONTS) for (const [family, pkg, slug, weights] of [['Sora', 'fontsource-sora', 'sora', [400, 600, 700, 800]], ['DM Sans', 'fontsource-dm-sans', 'dm-sans', [400, 500, 700]], ['Space Mono', 'fontsource-space-mono', 'space-mono', [400, 700]]]) {
    for (const w of weights) { const f = path.join(FONTS, pkg, 'files', `${slug}-latin-${w}-normal.woff2`);
      if (fs.existsSync(f)) fontCss += `@font-face{font-family:'${family}';font-weight:${w};font-style:normal;font-display:block;src:url('file://${f}') format('woff2');}`; }
  }
  const data = { fps: CFG.fps, music: CFG.music, fontCss, logo, code,
    manifest: JSON.parse(fs.readFileSync(path.join(ASSETS, 'manifest.json'), 'utf8')),
    facts: { lines: app.split('\n').length - 1, bytes: Buffer.byteLength(app), version, blockTypes, tools, changelog: versions.length, versions } };
  // JSON inside a <script>: escape "<" so no value can close the tag.
  fs.writeFileSync(path.join(ASSETS, 'data.js'), 'window.PROMO_DATA = ' + JSON.stringify(data).replace(/</g, '\\u003c') + ';\n');
  const f = data.facts;
  console.log(`facts: v${f.version} · ${f.lines} lines · ${f.bytes} bytes · ${f.blockTypes.length} block types · ${f.tools} tools · ${f.changelog} changelog versions`);
}
function buildThumbs() {
  const src = path.join(ASSETS, 'slides'), dst = path.join(ASSETS, 'thumbs'); fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) ff(['-i', path.join(src, f), '-vf', 'scale=480:270:flags=lanczos', '-q:v', '3', path.join(dst, f)]);
}

// ── 3. audio: N passes of the track, each one starts on the beat grid ─────
function buildAudio(duration) {
  const track = opt('audio');
  if (!track) return null;
  const m = CFG.music, beat = 60 / m.bpm, out = path.join(WORK, 'mix.wav');
  const ins = [], parts = [];
  for (let p = 0; p < m.passes; p++) { ins.push('-i', path.resolve(track)); const ms = Math.round(p * m.passBeats * beat * 1000);
    parts.push(`[${p}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms}|${ms}[p${p}]`); }
  // Echo of the last hit, so the end does not stop dead.
  const lastStart = (m.passes - 1) * m.passBeats * beat, hit = m.phase + m.passBeats * beat;
  ins.push('-i', path.resolve(track));
  const ems = Math.round((lastStart + hit - 0.02) * 1000);
  parts.push(`[${m.passes}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=start=${(hit - 0.02).toFixed(3)}:end=${(hit + 0.42).toFixed(3)},asetpts=PTS-STARTPTS,apad=pad_dur=3,aecho=0.6:0.7:170|340|510|680:0.42|0.27|0.16|0.09,volume=0.9,adelay=${ems}|${ems}[tail]`);
  const mix = parts.join(';') + ';' + [...Array(m.passes).keys()].map(p => `[p${p}]`).join('') + `[tail]amix=inputs=${m.passes + 1}:normalize=0:duration=longest,alimiter=limit=0.9:level=disabled,atrim=end=${duration.toFixed(3)},afade=t=out:st=${(duration - 0.9).toFixed(3)}:d=0.9[a]`;
  ff([...ins, '-filter_complex', mix, '-map', '[a]', '-ar', '48000', out]);
  return out;
}

// ── 4. frames ────────────────────────────────────────────────────────────
function chromePath() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  return fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
}
async function openComp(browser) {
  const ctx = await browser.newContext({ viewport: { width: CFG.width, height: CFG.height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.error('PAGE ERROR:', e.message); process.exitCode = 1; });
  await page.goto('file://' + path.join(__dirname, 'comp', 'index.html') + '?capture=1&assets=' + encodeURIComponent('file://' + ASSETS));
  await page.waitForFunction(() => window.__promoReady || window.__promoError, { timeout: 30000 });
  const err = await page.evaluate(async () => { if (window.__promoError) return window.__promoError; await window.__promoReady; return (window.__promoMissing || []).join(', '); });
  if (err) throw new Error('composition: ' + err);
  return page;
}

(async () => {
  fs.mkdirSync(ASSETS, { recursive: true });
  if (!has('skip-capture')) execFileSync('node', [path.join(__dirname, 'capture-assets.js'), ASSETS, ...(FONTS ? ['--fonts', FONTS] : [])], { stdio: 'inherit' });
  buildThumbs(); buildData();
  const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--font-render-hinting=none'] });
  const first = await openComp(browser);
  const duration = await first.evaluate(() => window.__promo.duration);
  console.log('duration', duration.toFixed(2), 's');

  if (opt('stills')) {
    const dir = path.join(WORK, 'stills'); fs.mkdirSync(dir, { recursive: true });
    for (const t of opt('stills').split(',').map(Number)) {
      await first.evaluate(x => window.__promo.seek(x), t);
      await first.screenshot({ path: path.join(dir, `t${t.toFixed(2).padStart(6, '0')}.png`) });
    }
    console.log('stills', dir); await browser.close(); return;
  }

  const fps = CFG.fps, f0 = Math.floor(parseFloat(opt('from', '0')) * fps), f1 = Math.min(Math.ceil(duration * fps), Math.ceil(parseFloat(opt('to', String(duration))) * fps));
  const frames = path.join(WORK, 'frames'); fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames, { recursive: true });
  // Motion blur: S samples inside a 180-degree shutter, blended by ffmpeg.
  const S = Math.max(1, parseInt(opt('blur', '1'), 10)), total = (f1 - f0) * S;
  const jobs = Math.max(1, parseInt(opt('jobs', '4'), 10)), t0 = Date.now(); let next = 0, done = 0;
  await Promise.all([...Array(jobs).keys()].map(async j => {
    const page = j === 0 ? first : await openComp(browser);
    for (;;) {
      const i = next++; if (i >= total) break;
      const t = (f0 + Math.floor(i / S)) / fps + (i % S) * 0.5 / (fps * S);
      await page.evaluate(x => window.__promo.seek(x), t);
      await page.screenshot({ path: path.join(frames, String(i).padStart(6, '0') + '.jpg'), type: 'jpeg', quality: 95 });
      if (++done % 300 === 0) console.log(`frames ${done}/${total} · ${((Date.now() - t0) / done).toFixed(0)} ms/frame`);
    }
  }));
  await browser.close();

  // ── 5. encode ──────────────────────────────────────────────────────────
  const out = path.resolve(opt('out', path.join(WORK, 'vela-promo.mp4')));
  const partial = f0 > 0 || f1 < Math.ceil(duration * fps);
  const audio = buildAudio(duration);
  const a = audio ? ['-ss', (f0 / fps).toFixed(3), '-i', audio] : [];
  const blend = S > 1 ? `tmix=frames=${S},select='not(mod(n+1\\,${S}))',setpts=N/(${fps}*TB),` : '';
  ff(['-framerate', String(fps * S), '-i', path.join(frames, '%06d.jpg'), ...a,
    '-vf', blend + 'scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p', '-r', String(fps), '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', partial ? '21' : '19', '-profile:v', 'high', '-movflags', '+faststart',
    ...(audio ? ['-c:a', 'aac', '-b:a', '256k', '-shortest'] : [])
    , out]);
  console.log('video', out, (fs.statSync(out).size / 1e6).toFixed(1) + ' MB');
})().catch(e => { console.error(e); process.exit(1); });
