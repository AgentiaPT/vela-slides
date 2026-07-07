/* Screenshot the editor slide canvas (innerRef, true 960x540 canvas-space at a
 * known transform scale) and print that scale. Usage:
 *   node scratch-src-canvas.cjs <render.html> <outPng> */
const { execSync } = require('child_process');
const path = require('path'); const fs = require('fs');
const [renderHtml, outPng] = process.argv.slice(2);
const ROOT = require('path').resolve(__dirname, '../../../..'); // repo root
function rpw(){const c=[];try{const b=execSync('which playwright',{encoding:'utf8'}).trim();if(b)c.push(path.resolve(path.dirname(b),'..','lib','node_modules','playwright'));}catch{}c.push(path.join(ROOT,'node_modules','playwright'));for(const p of c){try{return require(p);}catch{}}return null;}
function pin(){try{const ds=fs.readdirSync('/opt/pw-browsers').filter(d=>/^chromium-\d+$/.test(d)).sort();for(const d of ds.reverse()){const e=path.join('/opt/pw-browsers',d,'chrome-linux','chrome');if(fs.existsSync(e))return e;}}catch{}return null;}
(async()=>{
  const pw=rpw(); let b; const args=['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'];
  try{b=await pw.chromium.launch({headless:true,args});}catch(e){b=await pw.chromium.launch({headless:true,args,executablePath:pin()});}
  const page=await b.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});
  await page.goto('file://'+renderHtml,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__velaBooted||window.__velaBootError,{timeout:30000});
  await page.waitForSelector('header',{timeout:10000});
  await page.waitForTimeout(1200);
  await page.evaluate(()=>{const rows=Array.from(document.querySelectorAll('*')).filter(e=>e.childElementCount<3&&/HHHHHHHH/.test(e.textContent||''));rows.sort((a,b)=>a.textContent.length-b.textContent.length);if(rows[0])rows[0].click();});
  await page.waitForTimeout(1200);
  const info=await page.evaluate(()=>{
    let best=null,area=-1;
    for(const el of document.querySelectorAll('div')){
      const m=getComputedStyle(el).transform;
      if(!m||!m.startsWith('matrix')) continue;
      const sc=parseFloat(m.slice(7).split(',')[0]);
      if(!(sc>1.2&&sc<2.5)) continue;                 // editor "fit" upscale, not thumbnails
      const r=el.getBoundingClientRect();
      if(r.left<-100) continue;
      const a=r.width*r.height; if(a>area){area=a;best=el;}
    }
    if(!best) return null;
    const m=getComputedStyle(best).transform; // matrix(a,b,c,d,e,f) -> a is scaleX
    const sc=parseFloat(m.slice(7).split(',')[0]);
    best.setAttribute('data-calib-canvas','1');
    const r=best.getBoundingClientRect();
    return {scale:sc, left:r.left, top:r.top, width:r.width, height:r.height};
  });
  if(!info) throw new Error('no editor canvas');
  await page.locator('[data-calib-canvas="1"]').screenshot({path:outPng});
  console.log('CANVAS '+JSON.stringify(info));
  await b.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
