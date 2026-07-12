#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// vela-drive.js — Drive an offline Vela render (from render-offline.js) in the
// prebuilt Chromium. Boot-check, screenshot, run the in-app UI test battery,
// or record a demo video. No CDN needed.
//
// Prebuilt Chromium lives at /opt/pw-browsers/chromium-1194/... (the npm
// playwright version expects a newer build, so executablePath is pinned).
//
// USAGE:
//   node vela-drive.js boot       <render.html>
//   node vela-drive.js shot       <render.html> <out.png> [--w 1280 --h 800] [--eval "js"] [--wait 800]
//   node vela-drive.js uitests    <render.html> [--json out.json]
//   node vela-drive.js video      <render.html> <outDir> --script scenario.js
//
// scenario.js (for `video`) exports async (page, helpers) => { ... }
// helpers = { key, click, type, wait, shot, caption }.
// ─────────────────────────────────────────────────────────────────────────
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');
// Resolve Playwright portably — plain `playwright` resolves from the repo's
// node_modules in CI/local; the repo-root fallback covers odd cwd/link layouts.
function resolveChromium() {
  const candidates = ['playwright', path.join(__dirname, '..', '..', '..', 'node_modules', 'playwright')];
  for (const p of candidates) { try { return require(p).chromium; } catch {} }
  throw new Error('Playwright not found — run: npm ci && npx playwright install chromium');
}
const chromium = resolveChromium();

// Container-pinned Chromium fallback: only this remote container ships a
// prebuilt Chromium under /opt/pw-browsers (Playwright's bundled build isn't
// downloaded here). CI installs the bundled browser, so launch() prefers that
// and only pins when the default launch fails. Mirrors tests/test_pptx_export.cjs.
function findPinnedChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE && fs.existsSync(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE))
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const base = '/opt/pw-browsers';
  try {
    const dirs = fs.readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort();
    for (const d of dirs.reverse()) {
      // Support both Playwright chromium layouts (older chrome-linux, newer chrome-linux64).
      for (const layout of ['chrome-linux', 'chrome-linux64']) {
        const exe = path.join(base, d, layout, 'chrome');
        if (fs.existsSync(exe)) return exe;
      }
    }
  } catch {}
  return null;
}
const SCRIPTS = __dirname;
const args = process.argv.slice(2);
const mode = args[0];
const htmlPath = args[1] && path.resolve(args[1]);
function flag(name, def) { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; }

async function launch(recordDir, viewport) {
  const launchArgs = ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'];
  let browser;
  try {
    // Prefer Playwright's bundled browser (present in CI + normal dev installs).
    browser = await chromium.launch({ headless: true, args: launchArgs });
  } catch (e) {
    const pinned = findPinnedChromium();
    if (!pinned) throw e;
    browser = await chromium.launch({ headless: true, args: launchArgs, executablePath: pinned });
  }
  const ctx = await browser.newContext(Object.assign({ viewport: viewport || { width: 1280, height: 800 } },
    recordDir ? { recordVideo: { dir: recordDir, size: viewport || { width: 1280, height: 800 } } } : {}));
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  return { browser, ctx, page, logs };
}

async function waitBoot(page, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const st = await page.evaluate(() => ({ b: window.__velaBooted, e: window.__velaBootError,
      len: document.getElementById('root') ? document.getElementById('root').innerText.length : 0 }));
    if (st.e) throw new Error('BOOT ERROR: ' + st.e);
    if (st.b && st.len > 100) return true;
    await page.waitForTimeout(300);
  }
  throw new Error('boot timeout');
}

// ─── AI-integration harness (mode: ai) ──────────────────────────────────
// Orchestrates a full offline AI run against the local `claude` CLI:
//   1. start the Python channel backend (agent_backend.py) on a free loopback
//      port — the ONE place that spawns claude, tool-sandboxed;
//   2. build an agent-mode render pointed at that port (render-offline.build);
//   3. boot it in Chromium and exercise the real Vera engine functions the app
//      uses, asserting deck mutations — no mocks, the actual claude round-trips.
// Reuses launch()/waitBoot() and render-offline's build() so nothing is
// duplicated. This is a dev/QA tool (each probe is a real, paid claude call),
// not a CI gate.

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

async function startChannel(port, token) {
  // Token via env, never argv (ps is world-readable to other local users).
  const proc = spawn('python3', [path.join(SCRIPTS, 'agent_backend.py'), 'serve', '--port', String(port)],
    { stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { VELA_CHANNEL_TOKEN: token }) });
  let out = '';
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { out += d; });
  // Wait for /health to answer (agent detection runs a `claude --version`).
  const start = Date.now();
  while (Date.now() - start < 20000) {
    const ok = await new Promise(res => {
      const r = require('http').get({ host: '127.0.0.1', port, path: '/health', timeout: 1500 },
        resp => { resp.resume(); res(resp.statusCode === 200); });
      r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); });
    });
    if (ok) return { proc, banner: out.trim() };
    await new Promise(r => setTimeout(r, 300));
  }
  proc.kill('SIGTERM');
  throw new Error('channel did not become healthy:\n' + out);
}

// The probes: each returns { name, pass, detail }. They call the real engine
// helpers exposed as globals in the classic-script build (callClaudeAPI,
// callVera, generateSlide) — the exact functions the chat/TOC/quick-edit UIs use.
const AI_PROBES = {
  async ping(page) {
    const txt = await page.evaluate(() => callClaudeAPI(
      'You are terse. Reply with ONLY the uppercase word requested, no punctuation.',
      [{ role: 'user', content: 'Say the word WIRED' }], { _callType: 'chat', timeoutMs: 120000 }));
    return { pass: /WIRED/.test(txt), detail: JSON.stringify(txt).slice(0, 80) };
  },
  async veraAddSlide(page) {
    const r = await page.evaluate(async () => {
      const lanes = [{ title: 'Intro', items: [{ id: 'm1', title: 'Module 1',
        slides: [{ bg: '#0f172a', color: '#e2e8f0', accent: '#3b82f6', blocks: [{ type: 'heading', text: 'Hello' }] }] }] }];
      const before = lanes[0].items[0].slides.length;
      const tools = [];
      const res = await callVera("Add exactly one new slide whose only block is a heading with text 'ADDED BY AI'.",
        lanes, 'm1', 0, null, [], null, '', (tc) => { if (tc && tc.type === 'calling') tools.push(tc.name); }, [], null);
      const after = res.lanes ? res.lanes[0].items[0].slides.length : before;
      const texts = res.lanes ? res.lanes[0].items[0].slides.flatMap(s => (s.blocks || []).map(b => b.text)) : [];
      return { before, after, tools, texts };
    });
    return { pass: r.after === r.before + 1 && r.texts.some(t => /ADDED BY AI/i.test(t || '')),
      detail: `${r.before}→${r.after} tools=${JSON.stringify(r.tools)}` };
  },
  async generateSlide(page) {
    const r = await page.evaluate(async () => {
      try {
        const slide = await generateSlide('Team Values', 5, 'A slide titled Team Values with three bullets', null, '', null);
        const blocks = slide && slide.blocks ? slide.blocks.map(b => b.type) : null;
        return { ok: !!(slide && slide.blocks && slide.blocks.length), blocks };
      } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
    });
    return { pass: r.ok, detail: r.ok ? `blocks=${JSON.stringify(r.blocks)}` : (r.err || 'no slide') };
  },
  // The real user path: click the 🤖 Vera button, type a request, press Enter,
  // and assert the DECK changed via the header slide-count stat (driven by the
  // app's own state — not a mock, not localStorage). This exercises the UI the
  // artifact / desktop user sees; only the AI transport (local claude) differs.
  async veraChatUI(page) {
    // header pill renders "<n>sl · <m>§" from slideCountVisible — read it.
    const readSlides = () => page.evaluate(() => {
      for (const el of document.querySelectorAll('span')) {
        const m = (el.textContent || '').match(/(\d+)sl\s*·\s*\d+§/);
        if (m) return parseInt(m[1], 10);
      }
      return null;
    });
    await page.click('button:has-text("Vera")');
    await page.waitForTimeout(500);
    const ta = page.locator('textarea').first();
    const enabled = await ta.isEditable();          // aiOk / velaAIAvailable → user can type
    const before = await readSlides();
    await ta.click();
    await ta.fill("Add one new slide whose only block is a big heading that says HELLO FROM VERA");
    await ta.press('Enter');                         // the real send path
    let after = before, waited = 0;
    while (waited < 180000) {
      const c = await readSlides();
      if (c != null && before != null && c > before) { after = c; break; }
      await page.waitForTimeout(1500); waited += 1500;
    }
    return { pass: !!enabled && before != null && after === before + 1,
      detail: `input=${enabled} slides ${before}→${after}` };
  },
};

async function runAI() {
  const deck = args[1];
  if (!deck) { console.error('usage: node vela-drive.js ai <deck.vela> [--only ping,veraAddSlide,generateSlide]'); process.exit(2); }
  const { build } = require(path.join(SCRIPTS, 'render-offline.js'));
  const only = (flag('only', null) || '').split(',').map(s => s.trim()).filter(Boolean);
  const names = only.length ? only : Object.keys(AI_PROBES);

  const port = await freePort();
  const token = require('crypto').randomBytes(24).toString('hex');
  console.log(`[ai] starting channel on 127.0.0.1:${port} …`);
  const channel = await startChannel(port, token);
  console.log('[ai] ' + channel.banner);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-ai-'));
  build(path.resolve(deck), outDir, { channelPort: port, channelToken: token });
  const html = path.join(outDir, 'render.html');

  const { browser, page, logs } = await launch(null, { width: 1280, height: 800 });
  const results = [];
  try {
    await page.goto('file://' + html, { waitUntil: 'load', timeout: 30000 });
    await waitBoot(page);
    const avail = await page.evaluate(() => (typeof velaAIAvailable === 'function' ? velaAIAvailable() : false));
    if (!avail) throw new Error('velaAIAvailable() is false — channel not wired into the render');
    for (const name of names) {
      const probe = AI_PROBES[name];
      if (!probe) { results.push({ name, pass: false, detail: 'unknown probe' }); continue; }
      process.stdout.write(`[ai] ${name} … `);
      try { const r = await probe(page); results.push({ name, ...r }); console.log(r.pass ? `✅ ${r.detail}` : `❌ ${r.detail}`); }
      catch (e) { results.push({ name, pass: false, detail: String(e && e.message || e) }); console.log(`❌ ${e.message || e}`); }
    }
  } finally {
    await browser.close();
    channel.proc.kill('SIGTERM');
  }
  const passed = results.filter(r => r.pass).length, failed = results.length - passed;
  console.log(`\nAI ${passed} passed, ${failed} failed, ${results.length} total`);
  const jf = flag('json', null); if (jf) fs.writeFileSync(jf, JSON.stringify(results, null, 2));
  logs.filter(l => /pageerror/i.test(l)).slice(-4).forEach(l => console.log(' ', l));
  process.exit(failed ? 1 : 0);
}

async function main() {
  if (mode === 'ai') return runAI();
  if (!mode || !htmlPath) { console.error('usage: node vela-drive.js <boot|shot|uitests|video|ai> <render.html|deck.vela> ...'); process.exit(2); }
  const viewport = { width: parseInt(flag('w', '1280'), 10), height: parseInt(flag('h', '800'), 10) };

  if (mode === 'boot' || mode === 'shot') {
    const { browser, page, logs } = await launch(null, viewport);
    await page.goto('file://' + htmlPath, { waitUntil: 'load', timeout: 30000 });
    await waitBoot(page);
    const ev = flag('eval', null);
    if (ev) { await page.evaluate(ev); await page.waitForTimeout(parseInt(flag('wait', '600'), 10)); }
    const info = await page.evaluate(() => ({ title: document.title, buttons: document.querySelectorAll('button').length,
      sample: (document.getElementById('root').innerText || '').slice(0, 160) }));
    if (mode === 'shot') { await page.screenshot({ path: path.resolve(args[2]) }); console.log('shot:', args[2]); }
    console.log('BOOTED', JSON.stringify(info));
    logs.filter(l => /error|pageerror/i.test(l)).slice(-6).forEach(l => console.log(' ', l));
    await browser.close();
  } else if (mode === 'uitests') {
    const { browser, page, logs } = await launch(null, viewport);
    await page.goto('file://' + htmlPath, { waitUntil: 'load', timeout: 30000 });
    await waitBoot(page);
    // Prefer the headless hook if present; else dispatch the event and scrape.
    const res = await page.evaluate(async () => {
      if (typeof window.__velaRunUITests === 'function') return await window.__velaRunUITests();
      window.dispatchEvent(new Event('vela-run-uitests'));
      return null;
    });
    let results = res;
    if (!results) {
      // Poll window.__velaUITestResults (set by the hook on completion) up to 60s.
      const start = Date.now();
      while (Date.now() - start < 60000) {
        results = await page.evaluate(() => window.__velaUITestResults || null);
        if (results) break;
        await page.waitForTimeout(500);
      }
    }
    if (!results) { console.error('No UI test results (hook missing?)'); logs.slice(-8).forEach(l => console.log(l)); await browser.close(); process.exit(1); }
    const passed = results.filter(r => r.pass).length, failed = results.filter(r => !r.pass).length;
    console.log(`UITESTS ${passed} passed, ${failed} failed, ${results.length} total`);
    results.filter(r => !r.pass).forEach(r => console.log(`  ❌ [${r.suite}] ${r.name} — ${r.error || ''}`));
    const jf = flag('json', null); if (jf) fs.writeFileSync(jf, JSON.stringify(results, null, 2));
    await browser.close();
    process.exit(failed ? 1 : 0);
  } else if (mode === 'video') {
    const outDir = path.resolve(args[2]);
    const scenPath = flag('script', null);
    if (!scenPath) { console.error('video mode needs --script scenario.js'); process.exit(2); }
    const scenario = require(path.resolve(scenPath));
    fs.mkdirSync(outDir, { recursive: true });
    const { browser, ctx, page } = await launch(outDir, viewport);
    await page.goto('file://' + htmlPath, { waitUntil: 'load', timeout: 30000 });
    await waitBoot(page);
    const helpers = {
      key: async (k, opts) => { await page.keyboard.press(k, opts); await page.waitForTimeout(120); },
      click: async (sel) => { await page.click(sel); await page.waitForTimeout(200); },
      type: async (sel, t) => { await page.fill(sel, t); await page.waitForTimeout(150); },
      wait: async (ms) => page.waitForTimeout(ms),
      shot: async (p) => page.screenshot({ path: path.join(outDir, p) }),
      caption: async (text, ms = 1600) => {
        await page.evaluate((t) => {
          let el = document.getElementById('__vela_caption');
          if (!el) { el = document.createElement('div'); el.id = '__vela_caption';
            el.style.cssText = 'position:fixed;left:50%;bottom:36px;transform:translateX(-50%);z-index:2147483647;background:rgba(15,23,42,.94);color:#fff;font:600 20px system-ui;padding:12px 22px;border-radius:12px;border:1px solid #6366f1;box-shadow:0 8px 32px rgba(0,0,0,.5);max-width:80vw;text-align:center';
            document.body.appendChild(el); }
          el.textContent = t; el.style.opacity = '1';
        }, text);
        await page.waitForTimeout(ms);
      },
      clearCaption: async () => { await page.evaluate(() => { const el = document.getElementById('__vela_caption'); if (el) el.style.opacity = '0'; }); },
      page,
    };
    await scenario(page, helpers);
    await page.waitForTimeout(400);
    await ctx.close(); // flush video
    await browser.close();
    // Rename the produced webm.
    const webm = fs.readdirSync(outDir).find(f => f.endsWith('.webm'));
    console.log('video:', webm ? path.join(outDir, webm) : '(none)');
  } else { console.error('unknown mode', mode); process.exit(2); }
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
