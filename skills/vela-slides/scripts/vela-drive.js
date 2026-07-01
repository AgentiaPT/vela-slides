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
const { chromium } = require('/home/user/vela-slides/node_modules/playwright');

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const args = process.argv.slice(2);
const mode = args[0];
const htmlPath = args[1] && path.resolve(args[1]);
function flag(name, def) { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; }

async function launch(recordDir, viewport) {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox'] });
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

async function main() {
  if (!mode || !htmlPath) { console.error('usage: node vela-drive.js <boot|shot|uitests|video> <render.html> ...'); process.exit(2); }
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
