import { chromium } from 'playwright';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const dir = process.argv[2];
const withAgents = process.argv[3] !== 'noagents';
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript((withAgents) => {
  window.__velaAgentInfo = { label: 'Claude Code', available: true, version: '1.2.3' };
  if (withAgents) {
    window.__velaAgents = { refresh: async () => { window.__rescanCalls = (window.__rescanCalls||0)+1; await new Promise(r=>setTimeout(r,250)); } };
  }
}, withAgents);
await page.goto('file://'+dir+'/index.html', { waitUntil: 'load' });
await page.waitForSelector('.concept-row', { timeout: 15000 }); await page.waitForTimeout(500);
// Open agent settings via the chip.
await page.evaluate(() => { const el=document.querySelector('[title="Agent settings"]'); if(el) el.click(); });
await page.waitForTimeout(300);
const dialogOpen = await page.evaluate(() => /AI agent settings/.test(document.body.innerText));
const rescanBtn = await page.evaluate(() => { const b=[...document.querySelectorAll('button')].find(b=>/Re-scan|Scanning/.test(b.textContent||'')); return b ? { text:b.textContent, disabled:b.disabled } : null; });
let afterClick = null, calls = 0, busyShown = false;
if (rescanBtn && !rescanBtn.disabled) {
  await page.evaluate(() => { const b=[...document.querySelectorAll('button')].find(b=>/Re-scan/.test(b.textContent||'')); b.click(); });
  await page.waitForTimeout(80);
  busyShown = await page.evaluate(() => [...document.querySelectorAll('button')].some(b=>/Scanning/.test(b.textContent||'')));
  await page.waitForTimeout(400);
  calls = await page.evaluate(() => window.__rescanCalls || 0);
  afterClick = await page.evaluate(() => { const b=[...document.querySelectorAll('button')].find(b=>/Re-scan|Scanning/.test(b.textContent||'')); return b?b.textContent:null; });
}
await b.close();
console.log(JSON.stringify({ withAgents, dialogOpen, rescanBtn, busyShown, calls, afterClick }, null, 2));
