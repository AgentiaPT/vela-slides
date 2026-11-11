#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// render.js — build the Vela promo (video, README loop, interactive HTML).
//
//   1. capture   real footage of the app          (capture-assets.js)
//   2. data      facts read from the repository   (<work>/assets/data.js)
//   3. audio     soundtrack, played `passes` times on the beat grid
//   4. frames    the composition, seeked frame by frame in Chromium
//   5. encode    H.264 + AAC .mp4, a GIF loop, or one standalone .html
//
// USAGE
//   node render.js --work <dir> [--audio <track.mp3>] [--fonts <dir>] [mode] [options]
// MODES (one per run; default = final video)
//   --preview            full video at 960x540, 15 fps, no blur. Fast. Review this first.
//   --stills 1.5,14.4    PNG stills at these times (seconds)
//   --gif                silent loop for the README (ranges in promo.config.json)
//   --html               one standalone interactive .html (player + chapters)
// OPTIONS
//   --skip-capture   use the footage that is already in the work folder
//   --blur 4         motion blur samples for the final video (default 1 = off)
//   --from s --to s  render a part only     --jobs 4     --out <file>
// The work folder holds footage, frames and results. Keep it outside git.
// ─────────────────────────────────────────────────────────────────────────
const path = require('path');
const fs = require('fs');
const { execFileSync, spawnSync } = require('child_process');
const REPO = path.resolve(__dirname, '..', '..', '..');
const { chromium } = require(path.join(REPO, 'node_modules', 'playwright'));
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'promo.config.json'), 'utf8'));

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : def; };
const has = name => argv.includes('--' + name);
if (!opt('work')) { console.error('usage: node render.js --work <dir> [--audio track.mp3] [--fonts dir] [--preview | --stills t,t | --gif | --html] [--skip-capture] [--blur 4] [--from s] [--to s] [--jobs 4] [--out file]'); process.exit(2); }
const WORK = path.resolve(opt('work'));
const ASSETS = path.join(WORK, 'assets');
const FONTS = opt('fonts') ? path.resolve(opt('fonts')) : null;
const COMP = path.join(__dirname, 'comp');
const read = p => fs.readFileSync(path.join(REPO, p), 'utf8');
const ff = args => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
const vela = args => { const r = spawnSync('python3', [path.join(REPO, 'skills/vela-slides/scripts/vela.py'), ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new Error('vela CLI failed: ' + args.join(' ') + '\n' + r.stderr); };
// JSON inside a <script>: escape "<" so no value can close the tag.
const safeJson = v => JSON.stringify(v).replace(/</g, '\\u003c');

// ── 2. facts: numbers on screen come from the code ───────────────────────
function buildData() {
  const app = read('skills/vela-slides/app/vela.jsx');
  const imports = read('src/parts/part-imports.jsx');
  const need = (v, what) => { if (v == null || v === false) throw new Error('facts: cannot read ' + what); return v; };
  const version = need(/const VELA_VERSION = "([\d.]+)"/.exec(imports), 'VELA_VERSION')[1];
  const types = need(/const SAFE_BLOCK_TYPES = new Set\(\[([^\]]+)\]/.exec(imports), 'SAFE_BLOCK_TYPES')[1];
  const blockTypes = [...types.matchAll(/"([a-z-]+)"/g)].map(m => m[1]);
  const cl = imports.slice(imports.indexOf('const VELA_CHANGELOG = ['));
  const versions = [...cl.slice(0, cl.indexOf('\n];')).matchAll(/^\s*\{ ?v: ?"([\d.]+)"/gm)].map(m => m[1]).reverse();
  need(blockTypes.length > 0 && versions.length > 0, 'block types / changelog');
  // Background texture: plain renderer code from one part-file. Short lines only.
  const blocks = read('src/parts/part-blocks.jsx').split('\n');
  const start = Math.max(0, blocks.findIndex(l => l.includes('function RenderBlock')));
  const code = blocks.slice(start).filter(l => l.trim().length > 24 && l.length < 92 && !/https?:|<script|javascript:/i.test(l)).slice(0, 260).map(l => l.replace(/\t/g, '  '));
  const demo = JSON.parse(read('examples/vela-demo.vela'));
  const logo = need(demo.lanes[0].items[0].slides[0].blocks.find(b => b.type === 'svg'), 'logo svg').markup;
  // Deck formats: sizes measured now with the real CLI, on one example deck.
  const deckName = 'startup-pitch.vela', deckPath = path.join(REPO, 'examples', deckName), tmp = path.join(WORK, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  vela(['deck', 'compact', deckPath, path.join(tmp, 'c.vela')]); vela(['deck', 'turbo', deckPath, path.join(tmp, 't.vela')]);
  const pitch = JSON.parse(fs.readFileSync(deckPath, 'utf8'));
  const formats = { deck: deckName, full: Buffer.byteLength(JSON.stringify(pitch)), compact: fs.statSync(path.join(tmp, 'c.vela')).size, turbo: fs.statSync(path.join(tmp, 't.vela')).size };
  const slides = []; for (const l of pitch.lanes) for (const it of l.items || []) slides.push(...(it.slides || []));
  const json = JSON.stringify({ title: slides[3].title, accent: slides[3].accent, blocks: slides[3].blocks }, null, 1).split('\n').map(l => (l.length > 58 ? l.slice(0, 57) + '…' : l)).slice(0, 24);
  // The shipped skill: name from SKILL.md, tree from the folder.
  const skillDir = path.join(REPO, 'skills', 'vela-slides');
  const skillName = need(/^name:\s*(\S+)/m.exec(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8')), 'skill name')[1];
  const ls = d => fs.readdirSync(path.join(skillDir, d)).filter(f => !f.startsWith('_') && !f.startsWith('.')).sort();
  const tree = [skillName + '/', '├─ SKILL.md', '├─ app/vela.jsx', `├─ scripts/  ${ls('scripts').filter(f => f.endsWith('.py')).length} Python tools`, `├─ references/  ${ls('references').length} guides`, '└─ examples/'];
  let fontCss = '';
  if (FONTS) for (const [family, pkg, slug, weights] of [['Sora', 'fontsource-sora', 'sora', [400, 600, 700, 800]], ['DM Sans', 'fontsource-dm-sans', 'dm-sans', [400, 500, 700]], ['Space Mono', 'fontsource-space-mono', 'space-mono', [400, 700]]]) {
    for (const w of weights) { const f = path.join(FONTS, pkg, 'files', `${slug}-latin-${w}-normal.woff2`);
      if (fs.existsSync(f)) fontCss += `@font-face{font-family:'${family}';font-weight:${w};font-style:normal;font-display:block;src:url('file://${f}') format('woff2');}`; }
  }
  const claims = Object.fromEntries(Object.entries(CFG.claims || {}).filter(([k]) => !k.startsWith('_')));
  // The arguments that the local AI backend uses to start the agent CLI (read from its source).
  const be = read('tools/vela-dev/scripts/agent_backend.py');
  const lock = need(/CLAUDE_LOCKDOWN = (\[[^\]]+\])/.exec(be), 'CLAUDE_LOCKDOWN')[1], base = need(/args = (\[[^\]]+\]) \+ list\(CLAUDE_LOCKDOWN\)/.exec(be), 'agent args')[1];
  need(/--system-prompt-file/.test(be), 'system prompt flag');
  const agentArgv = ['claude', ...JSON.parse(base), ...JSON.parse(lock)].map(a => (a === '' ? '""' : a)).join(' ') + ' --system-prompt-file <tmp>';
  const data = { fps: CFG.fps, music: CFG.music, claims, agentArgv, fontCss, logo, code,
    manifest: JSON.parse(fs.readFileSync(path.join(ASSETS, 'manifest.json'), 'utf8')),
    facts: { lines: app.split('\n').length - 1, bytes: Buffer.byteLength(app), version, blockTypes, changelog: versions.length, versions, formats, json, skill: { name: skillName, tree } } };
  fs.writeFileSync(path.join(ASSETS, 'data.js'), 'window.PROMO_DATA = ' + safeJson(data) + ';\n');
  const f = data.facts;
  console.log(`facts: v${f.version} · ${f.lines} lines · ${f.blockTypes.length} block types · formats ${formats.full}/${formats.compact}/${formats.turbo} B · skill ${skillName} · agent: ${agentArgv}`);
  return data;
}
function buildThumbs() {
  const src = path.join(ASSETS, 'slides'), dst = path.join(ASSETS, 'thumbs'); fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) if (!fs.existsSync(path.join(dst, f)) || fs.statSync(path.join(dst, f)).mtimeMs < fs.statSync(path.join(src, f)).mtimeMs)
    ff(['-i', path.join(src, f), '-vf', 'scale=480:270:flags=lanczos', '-q:v', '3', path.join(dst, f)]);
}

// ── 3. audio: the track plays in segments; each one starts on the beat grid ─
function buildAudio(duration) {
  const track = opt('audio');
  if (!track) return null;
  const m = CFG.music, beat = 60 / m.bpm, out = path.join(WORK, 'mix.wav'), pre = 0.03;
  const ins = [], parts = []; let g0 = 0, lastHit = null;
  m.segments.forEach(([from, to], i) => {
    ins.push('-i', path.resolve(track));
    // Segment i: track beat `from` lands on global beat g0. A whole pass (from 0) starts at its file start.
    const cut = from ? m.phase + from * beat - pre : 0, at = Math.round((from ? m.phase + g0 * beat - pre : g0 * beat) * 1000);
    parts.push(`[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=start=${cut.toFixed(3)},asetpts=PTS-STARTPTS${from ? ',afade=t=in:d=0.02' : ''},adelay=${at}|${at}[p${i}]`);
    g0 += to - from; lastHit = { time: m.phase + g0 * beat, src: m.phase + to * beat };
  });
  // Echo of the last hit, so the end does not stop dead.
  const n = m.segments.length; ins.push('-i', path.resolve(track));
  const ems = Math.round((lastHit.time - 0.04) * 1000);
  parts.push(`[${n}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=start=${(lastHit.src - 0.04).toFixed(3)}:end=${(lastHit.src + 0.4).toFixed(3)},asetpts=PTS-STARTPTS,apad=pad_dur=3,aecho=0.6:0.7:170|340|510|680:0.42|0.27|0.16|0.09,volume=0.9,adelay=${ems}|${ems}[tail]`);
  const mix = parts.join(';') + ';' + [...Array(n).keys()].map(i => `[p${i}]`).join('') + `[tail]amix=inputs=${n + 1}:normalize=0:duration=longest,alimiter=limit=0.9:level=disabled,atrim=end=${duration.toFixed(3)},afade=t=out:st=${(duration - 0.9).toFixed(3)}:d=0.9[a]`;
  ff([...ins, '-filter_complex', mix, '-map', '[a]', '-ar', '48000', out]);
  return out;
}

// ── 4. frames ────────────────────────────────────────────────────────────
function chromePath() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  return fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
}
async function openComp(browser, scale = 1, extra = '') {
  const ctx = await browser.newContext({ viewport: { width: CFG.width, height: CFG.height }, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.error('PAGE ERROR:', e.message); process.exitCode = 1; });
  await page.goto('file://' + path.join(COMP, 'index.html') + '?capture=1' + extra + '&assets=' + encodeURIComponent('file://' + ASSETS));
  await page.waitForFunction(() => window.__promoReady || window.__promoError, { timeout: 30000 });
  const err = await page.evaluate(async () => { if (window.__promoError) return window.__promoError; await window.__promoReady; return (window.__promoMissing || []).join(', '); });
  if (err) throw new Error('composition: ' + err);
  return page;
}
// Render the given times (seconds) to numbered JPEG files. Returns the folder.
async function renderTimes(browser, times, { scale = 1, quality = 95, extra = '', jobs = 4, name = 'frames' } = {}) {
  const dir = path.join(WORK, name); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now(); let next = 0, done = 0;
  await Promise.all([...Array(jobs).keys()].map(async () => {
    const page = await openComp(browser, scale, extra);
    for (;;) {
      const i = next++; if (i >= times.length) break;
      await page.evaluate(x => window.__promo.seek(x), times[i]);
      await page.screenshot({ path: path.join(dir, String(i).padStart(6, '0') + '.jpg'), type: 'jpeg', quality });
      if (++done % 300 === 0) console.log(`frames ${done}/${times.length} · ${((Date.now() - t0) / done).toFixed(0)} ms/frame`);
    }
    await page.context().close();
  }));
  return dir;
}

// ── 5c. standalone interactive HTML ──────────────────────────────────────
function buildHtml(urls, duration, out) {
  const emb = {}, tmp = path.join(WORK, 'tmp'); fs.mkdirSync(tmp, { recursive: true });
  for (const p of urls) { // smaller copies, as data URIs
    const w = p.startsWith('thumbs/') ? 480 : p.startsWith('phone/') ? 520 : p.startsWith('slides/') ? 1280 : 1600, t = path.join(tmp, 'e.jpg');
    ff(['-i', path.join(ASSETS, p), '-vf', `scale='min(${w},iw)':-2:flags=lanczos`, '-q:v', p.startsWith('thumbs/') ? '6' : '5', t]);
    emb[p] = 'data:image/jpeg;base64,' + fs.readFileSync(t).toString('base64');
  }
  let audio = '';
  const mix = buildAudio(duration);
  if (mix) { const a = path.join(tmp, 'mix.m4a'); ff(['-i', mix, '-c:a', 'aac', '-b:a', '112k', a]); audio = 'data:audio/mp4;base64,' + fs.readFileSync(a).toString('base64'); }
  const data = fs.readFileSync(path.join(ASSETS, 'data.js'), 'utf8').replace(/"fontCss":"(?:[^"\\]|\\.)*"/, '"fontCss":""');
  const js = f => fs.readFileSync(path.join(COMP, f), 'utf8').replace(/<\/script/gi, '<\\/script');
  const scripts = `<script>${js('engine.js')}</script>
<script>const Q = new URLSearchParams(location.search); window.ASSETS = ''; window.PROMO_EMBED = ${safeJson(emb)}; window.PROMO_AUDIO = ${safeJson(audio || null)};</script>
<script>${data.replace(/<\/script/gi, '<\\/script')}</script>
<script>${js('storyboard.js')}</script>
<script>window.__promoReady.then(() => { ${js('player.js')} });</script>`;
  let html = fs.readFileSync(path.join(COMP, 'index.html'), 'utf8');
  const a = html.indexOf('<!--PROMO:SCRIPTS-->'), b = html.indexOf('<!--/PROMO:SCRIPTS-->');
  if (a < 0 || b < 0) throw new Error('index.html: PROMO:SCRIPTS markers not found');
  html = html.slice(0, a) + scripts + html.slice(b + '<!--/PROMO:SCRIPTS-->'.length);
  html = html.replace('<meta name="viewport" content="width=1920">', '<meta name="viewport" content="width=device-width, initial-scale=1">\n<link rel="preconnect" href="https://fonts.googleapis.com">\n<link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=DM+Sans:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">')
    .replace('<title>Vela Slides — promo composition</title>', '<title>Vela Slides Tour</title>');
  fs.writeFileSync(out, html);
  console.log('html', out, (fs.statSync(out).size / 1e6).toFixed(1) + ' MB', `· ${urls.length} images embedded${audio ? ' · soundtrack embedded' : ''}`);
}

(async () => {
  fs.mkdirSync(ASSETS, { recursive: true });
  if (!has('skip-capture')) execFileSync('node', [path.join(__dirname, 'capture-assets.js'), ASSETS, ...(FONTS ? ['--fonts', FONTS] : [])], { stdio: 'inherit' });
  buildThumbs(); buildData();
  const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--font-render-hinting=none'] });
  const first = await openComp(browser);
  const { duration, urls } = await first.evaluate(() => ({ duration: window.__promo.duration, urls: window.__promo.urls }));
  console.log('duration', duration.toFixed(2), 's');
  const fps = has('preview') ? 15 : CFG.fps, jobs = Math.max(1, parseInt(opt('jobs', '4'), 10));
  const beat = 60 / CFG.music.bpm, B = g => CFG.music.phase + g * beat;

  if (opt('stills')) {
    const dir = path.join(WORK, 'stills'); fs.mkdirSync(dir, { recursive: true });
    for (const t of opt('stills').split(',').map(Number)) {
      await first.evaluate(x => window.__promo.seek(x), t);
      await first.screenshot({ path: path.join(dir, `t${t.toFixed(2).padStart(6, '0')}.png`) });
    }
    console.log('stills', dir); await browser.close(); return;
  }
  await first.context().close();

  if (has('html')) { await browser.close(); buildHtml(urls, duration, path.resolve(opt('out', path.join(WORK, 'vela-promo.html')))); return; }

  if (has('gif')) {
    const R = CFG.readme, times = [];
    for (const [a, b] of R.beats) for (let t = B(a); t < Math.min(duration - 0.8, B(b)); t += 1 / R.fps) times.push(t);
    const dir = await renderTimes(browser, times, { scale: R.width / CFG.width, quality: 92, extra: '&lite=1', jobs, name: 'frames-gif' });
    await browser.close();
    const out = path.resolve(opt('out', path.join(WORK, 'vela-promo-readme.gif'))), pal = path.join(WORK, 'tmp', 'pal.png'); fs.mkdirSync(path.dirname(pal), { recursive: true });
    ff(['-framerate', String(R.fps), '-i', path.join(dir, '%06d.jpg'), '-vf', `palettegen=max_colors=${R.colors || 96}:stats_mode=diff`, pal]);
    ff(['-framerate', String(R.fps), '-i', path.join(dir, '%06d.jpg'), '-i', pal, '-lavfi', 'paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', out]);
    ff(['-framerate', String(R.fps), '-i', path.join(dir, '%06d.jpg'), '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-crf', '24', '-movflags', '+faststart', out.replace(/\.gif$/, '.mp4')]);
    console.log('gif', out, (fs.statSync(out).size / 1e6).toFixed(1) + ' MB', `· ${(times.length / R.fps).toFixed(1)} s · ${R.width}px · ${R.fps} fps`);
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  }

  // Video: preview (half size, no blur) or final.
  const preview = has('preview');
  const f0 = Math.floor(parseFloat(opt('from', '0')) * fps), f1 = Math.min(Math.ceil(duration * fps), Math.ceil(parseFloat(opt('to', String(duration))) * fps));
  // Motion blur: S samples inside a 180-degree shutter, blended by ffmpeg.
  const S = preview ? 1 : Math.max(1, parseInt(opt('blur', '1'), 10)), times = [];
  for (let i = 0; i < (f1 - f0) * S; i++) times.push((f0 + Math.floor(i / S)) / fps + (i % S) * 0.5 / (fps * S));
  const dir = await renderTimes(browser, times, { scale: preview ? 0.5 : 1, quality: preview ? 82 : 95, jobs });
  await browser.close();
  const out = path.resolve(opt('out', path.join(WORK, preview ? 'vela-promo-preview.mp4' : 'vela-promo.mp4')));
  const partial = f0 > 0 || f1 < Math.ceil(duration * fps);
  const audio = buildAudio(duration);
  const a = audio ? ['-ss', (f0 / fps).toFixed(3), '-i', audio] : [];
  const blend = S > 1 ? `tmix=frames=${S},select='not(mod(n+1\\,${S}))',setpts=N/(${fps}*TB),` : '';
  ff(['-framerate', String(fps * S), '-i', path.join(dir, '%06d.jpg'), ...a,
    '-vf', blend + 'scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p', '-r', String(fps), '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:v', 'libx264', '-preset', preview ? 'veryfast' : 'slow', '-crf', preview ? '25' : partial ? '21' : '19', '-profile:v', 'high', '-movflags', '+faststart',
    ...(audio ? ['-c:a', 'aac', '-b:a', preview ? '128k' : '256k', '-shortest'] : []), out]);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(preview ? 'preview' : 'video', out, (fs.statSync(out).size / 1e6).toFixed(1) + ' MB');
})().catch(e => { console.error(e); process.exit(1); });
