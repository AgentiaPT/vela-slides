import { chromium } from 'playwright';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await b.newPage();
await page.goto('file://'+process.argv[2]+'/index.html', { waitUntil: 'load' });
await page.waitForSelector('.concept-row', { timeout: 15000 }); await page.waitForTimeout(600);
const r = await page.evaluate(() => {
  const asd = typeof AgentSettingsDialog === 'function' ? AgentSettingsDialog.toString() : 'NOFN';
  const app = typeof App === 'function' ? App.toString() : 'NOFN';
  return {
    asd_canScan: asd.includes('canScan'),
    asd_await: asd.includes('await window.__velaAgents'),
    asd_scanning: asd.includes('scanning'),
    app_createDeck: app.includes('__velaCreateDeck'),
  };
});
await b.close();
console.log(JSON.stringify(r,null,2));
