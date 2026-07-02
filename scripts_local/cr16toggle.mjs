import { chromium } from 'playwright';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const dir = process.argv[2];
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto('file://'+dir+'/index.html', { waitUntil: 'load' });
await page.waitForSelector('.concept-row', { timeout: 15000 }); await page.waitForTimeout(500);
await page.click('.concept-row'); await page.waitForTimeout(200);
await (await page.$('text=/Present/')).click(); await page.waitForTimeout(700);
const openState = async () => page.evaluate(() => {
  const inp=[...document.querySelectorAll('input')].find(i=>/Search slides/.test(i.placeholder||''));
  let el=inp; for(let k=0;k<8&&el;k++){const t=getComputedStyle(el).transform; if(t&&t!=='none')return t.includes('-280')?false:true; el=el.parentElement;} return null; });
const states=[];
states.push(await openState());                       // closed
await page.keyboard.press('Control+e'); await page.waitForTimeout(400); states.push(await openState());  // open
await page.keyboard.press('Control+e'); await page.waitForTimeout(400); states.push(await openState());  // closed
await page.keyboard.press('Control+e'); await page.waitForTimeout(400); states.push(await openState());  // open
await b.close();
console.log('toggle states (closed,open,closed,open):', JSON.stringify(states));
