// Smoke test: boot the vendored CDN-free Vela app in real Chromium.
import { chromium } from 'playwright';
import fs from 'fs';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const url = 'file://' + process.argv[2] + '/index.html';
const shot = process.argv[3] || '/tmp/smoke.png';

const errors = [];
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.goto(url, { waitUntil: 'load' });

// Wait for app to mount: loading overlay gone OR a known app element present.
let booted = false;
for (let i = 0; i < 40; i++) {
  const loadingGone = await page.evaluate(() => {
    const l = document.getElementById('vela-loading');
    const rootChildren = document.getElementById('root')?.children?.length || 0;
    // App mounted if loading removed OR root has non-loading content
    const hasApp = !!document.querySelector('[class*="vela"], button, [data-testid]') && (!l || l.classList.contains('fade-out') || getComputedStyle(l).opacity === '0');
    return { gone: !l, faded: l ? (l.classList.contains('fade-out') || getComputedStyle(l).opacity === '0') : true, rootChildren, hasApp };
  });
  if (loadingGone.gone || loadingGone.faded) { booted = true; break; }
  await page.waitForTimeout(300);
}
await page.waitForTimeout(500);
const title = await page.title();
const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 300));
await page.screenshot({ path: shot, fullPage: false });
await b.close();

console.log(JSON.stringify({ booted, title, errors: errors.slice(0, 20), bodyPreview: bodyText.replace(/\n+/g, ' | ') }, null, 2));
if (errors.length) process.exitCode = 0; // report, don't fail hard
