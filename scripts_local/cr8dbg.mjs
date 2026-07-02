import { chromium } from 'playwright';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const dir = process.argv[2];
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript(() => { window.__velaAgentInfo = { label: 'Claude Code', available: true, version: '1.2.3' }; });
await page.goto('file://'+dir+'/index.html', { waitUntil: 'load' });
await page.waitForSelector('.concept-row', { timeout: 15000 }); await page.waitForTimeout(500);
await page.evaluate(() => { const el=document.querySelector('[title="Agent settings"]'); if(el) el.click(); });
await page.waitForTimeout(300);
const d = await page.evaluate(() => {
  const b=[...document.querySelectorAll('button')].find(b=>/Re-scan|Scanning/.test(b.textContent||''));
  return { hasVelaAgents: typeof window.__velaAgents, refreshType: typeof window.__velaAgents?.refresh, btnDisabledAttr: b?.disabled, btnHasDisabledAttr: b?.hasAttribute('disabled') };
});
await b.close();
console.log(JSON.stringify(d, null, 2));
