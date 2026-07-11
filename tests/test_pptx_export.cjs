/**
 * Vela Slides — Native PowerPoint (.pptx) Export E2E Test (Playwright)
 *
 * Drives the REAL export UI path a user would use — open the Export menu, pick
 * "PowerPoint (.pptx)", start the off-screen render loop, and read the produced
 * .pptx bytes back — then validates the archive structurally (STORE zip parse,
 * XML well-formedness) and asserts native-object presence (text boxes, autoshapes,
 * embedded SVG, tables). No synthetic direct call to buildPptx: the modal drives it.
 *
 * Boots the app via the canonical offline render builder
 * (tools/vela-dev/scripts/render-offline.js), the same recipe the desktop
 * shell + vela-drive.js use, so it stays in sync with the one true offline boot.
 *
 * Usage:
 *   node tests/test_pptx_export.cjs                 # build + run, write .pptx to tmp
 *   node tests/test_pptx_export.cjs --out /path.pptx  # also copy .pptx to a known path
 *
 * Prints "✅ N passed  ❌ M failed" and exits non-zero on any failure, matching
 * the grep contract of run_pptx_e2e_tests() in tests/test_vela.py. When Playwright
 * or a Chromium binary is unavailable it prints "PPTX-SKIP: <reason>" and exits 0
 * so CI soft-skips rather than hard-failing on an optional browser dep.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const DECK = path.join(ROOT, 'examples', 'tech-talk.vela');
const RENDER_OFFLINE = path.join(ROOT, 'tools', 'vela-dev', 'scripts', 'render-offline.js');

// Where to leave the produced .pptx so the Python runner can read it back.
function resolveOutPath() {
  const i = process.argv.indexOf('--out');
  if (i >= 0 && process.argv[i + 1]) return path.resolve(process.argv[i + 1]);
  return path.join(os.tmpdir(), 'vela-pptx-export', 'tech-talk.pptx');
}

// ── Resolve Playwright (global installs first, then local node_modules) ──────
function resolvePlaywright() {
  const globalPaths = [];
  try {
    const bin = execSync('which playwright 2>/dev/null', { encoding: 'utf8' }).trim();
    if (bin) {
      globalPaths.push(path.resolve(path.dirname(bin), '..', 'lib', 'node_modules', 'playwright'));
      try {
        const pnpmRoot = execSync('pnpm root -g 2>/dev/null', { encoding: 'utf8' }).trim();
        if (pnpmRoot) globalPaths.push(path.join(pnpmRoot, 'playwright'));
      } catch {}
    }
  } catch {}
  const candidates = [...globalPaths, path.join(ROOT, 'node_modules', 'playwright')];
  for (const p of candidates) {
    try { return require(p); } catch {}
  }
  return null; // caller soft-skips
}

// Launch headless Chromium; fall back to a container-pinned binary if Playwright's
// bundled browser isn't where it expects (the remote container pins a newer build).
async function launchBrowser(chromium) {
  const args = ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'];
  try {
    return await chromium.launch({ headless: true, args });
  } catch (e) {
    const pinned = findPinnedChromium();
    if (pinned) return await chromium.launch({ headless: true, args, executablePath: pinned });
    throw e;
  }
}

function findPinnedChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE && fs.existsSync(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE))
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const base = '/opt/pw-browsers';
  try {
    const dirs = fs.readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort();
    for (const d of dirs.reverse()) {
      const exe = path.join(base, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(exe)) return exe;
    }
  } catch {}
  return null;
}

// ── STORE-ZIP reader (buildPptx writes uncompressed method-0 entries) ────────
// Returns { names, part(name) } — no inflate needed since every entry is stored.
function readStoreZip(buf) {
  const parts = {};
  const names = [];
  let o = 0;
  const u32 = (p) => buf.readUInt32LE(p);
  const u16 = (p) => buf.readUInt16LE(p);
  while (o + 4 <= buf.length && u32(o) === 0x04034b50) {
    const method = u16(o + 8);
    const compSize = u32(o + 18);
    const nameLen = u16(o + 26);
    const extraLen = u16(o + 28);
    const nameStart = o + 30;
    const name = buf.slice(nameStart, nameStart + nameLen).toString('utf8');
    const dataStart = nameStart + nameLen + extraLen;
    const data = buf.slice(dataStart, dataStart + compSize);
    if (method !== 0) throw new Error(`entry ${name} not STORE (method ${method})`);
    names.push(name);
    parts[name] = data;
    o = dataStart + compSize;
  }
  // End-of-central-directory sanity.
  const hasEOCD = buf.indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) >= 0;
  return { names, parts, hasEOCD, part: (n) => (parts[n] ? parts[n].toString('utf8') : null) };
}

// ── Test bookkeeping ────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ── Drive the real export UI (mirrors .hyper-sprint/vela-verbs.mjs exportPptx) ─
async function driveExport(page) {
  // Open the Export dropdown; wait for the PowerPoint entry.
  const opened = await page.evaluate(() => {
    const b = document.querySelector('[data-testid=export-menu-toggle]');
    if (!b) return false; b.click(); return true;
  });
  if (!opened) throw new Error('no export-menu-toggle (desktop header not mounted?)');
  await page.waitForFunction(() => !!document.querySelector('[data-testid=export-pptx-menu-item]'), { timeout: 5000 });

  await page.evaluate(() => document.querySelector('[data-testid=export-pptx-menu-item]').click());
  await page.waitForFunction(() => !!document.querySelector('[data-testid=pptx-export-modal]'), { timeout: 5000 });

  await page.evaluate(() => document.querySelector('[data-testid=pptx-export-start]').click());
  // Off-screen render loop (~350ms/slide). Fail early on the error phase.
  await page.waitForFunction(() => {
    if (document.querySelector('[data-testid=pptx-export-error]')) return true;
    return !!document.querySelector('[data-testid=pptx-export-download]');
  }, { timeout: 120000 });

  const err = await page.evaluate(() => {
    const e = document.querySelector('[data-testid=pptx-export-error]');
    return e ? e.textContent : null;
  });
  if (err) throw new Error(`modal reported error phase: ${err}`);

  const info = await page.evaluate(() => {
    const a = document.querySelector('[data-testid=pptx-export-download]');
    if (!a) return null;
    const uri = a.getAttribute('href') || '';
    const comma = uri.indexOf(',');
    const b64 = comma >= 0 ? uri.slice(comma + 1) : '';
    return { uri, b64, download: a.getAttribute('download') };
  });
  if (!info || !info.uri.startsWith('data:application/vnd.openxmlformats-officedocument.presentationml.presentation'))
    throw new Error('download href is not a .pptx data URI');
  return info;
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const t0 = Date.now();
  const outPath = resolveOutPath();

  const pw = resolvePlaywright();
  if (!pw) {
    console.log('PPTX-SKIP: Playwright not found (npm install --save-dev playwright)');
    process.exit(0);
  }

  // Build the offline render.
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-pptx-render-'));
  let renderHtml;
  try {
    const { build } = require(RENDER_OFFLINE);
    const r = build(DECK, outDir, { repoRoot: ROOT });
    renderHtml = r.html;
    console.log(`Built offline render: ${renderHtml}`);
  } catch (e) {
    // A missing vela.jsx (concat not run) is a real failure, not a skip.
    console.log(`  ❌ offline render build failed — ${e.message}`);
    console.log('\n  ❌ 1 failed');
    process.exit(1);
  }

  let browser;
  try {
    browser = await launchBrowser(pw.chromium);
  } catch (e) {
    console.log(`PPTX-SKIP: could not launch Chromium — ${e.message}`);
    process.exit(0);
  }

  let fatal = null;
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));

    await page.goto('file://' + renderHtml, { timeout: 60000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__velaBooted || window.__velaBootError, { timeout: 30000 });
    const bootErr = await page.evaluate(() => window.__velaBootError || null);
    if (bootErr) throw new Error('app boot error: ' + bootErr);
    await page.waitForSelector('header', { timeout: 10000 });

    // Drive the real export and pull the bytes back.
    const info = await driveExport(page);
    const buf = Buffer.from(info.b64, 'base64');

    // Persist for the Python read-back companion.
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, buf);
    console.log(`PPTX_FILE: ${outPath}`);
    console.log(`\nExported .pptx: ${buf.length} bytes, download="${info.download}"\n`);

    // ── Structural assertions (stdlib-only, no python-pptx) ──
    check('produced .pptx is non-empty', buf.length > 0, `size=${buf.length}`);
    check('ZIP local-file-header signature at offset 0',
      buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50);

    let zip;
    try { zip = readStoreZip(buf); } catch (e) { zip = null; check('ZIP parses (STORE entries)', false, e.message); }

    if (zip) {
      check('ZIP has an end-of-central-directory record', zip.hasEOCD);
      check('ZIP has entries', zip.names.length > 0, `entries=${zip.names.length}`);
      check('contains [Content_Types].xml', zip.names.includes('[Content_Types].xml'));
      check('contains presentation.xml', zip.names.includes('ppt/presentation.xml'));

      // Every XML/rels part is well-formed (parse each; DOMParser-free — use a
      // strict tag-balance-ish check via the browser's DOMParser in-page).
      const xmlNames = zip.names.filter(n => n.endsWith('.xml') || n.endsWith('.rels'));
      let wellFormed = true, badPart = null;
      for (const n of xmlNames) {
        const ok = await page.evaluate((text) => {
          try {
            const doc = new DOMParser().parseFromString(text, 'application/xml');
            return !doc.querySelector('parsererror');
          } catch { return false; }
        }, zip.part(n));
        if (!ok) { wellFormed = false; badPart = n; break; }
      }
      check('all XML/rels parts are well-formed', wellFormed, badPart ? `malformed: ${badPart}` : '');

      // Slide count matches the deck (>= 5 real slides in tech-talk.vela).
      const slideNames = zip.names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
      check('slide count matches deck (>= 5)', slideNames.length >= 5, `slides=${slideNames.length}`);

      // Aggregate all slide XML for feature-presence checks.
      const allSlideXml = slideNames.map(n => zip.part(n)).join('\n');
      check('at least one native text box (<a:t> run)', /<a:t[ >]/.test(allSlideXml));
      check('at least one native autoshape (<a:prstGeom>)', /<a:prstGeom/.test(allSlideXml));
      check('at least one embedded SVG (asvg:svgBlip)', /svgBlip/.test(allSlideXml));
      check('at least one native table (<a:tbl>)', /<a:tbl[ >]/.test(allSlideXml));

      // Regression: a <a:tbl> with banding attrs but NO <a:tableStyleId> is a
      // PowerPoint "repair" trigger (LibreOffice / python-pptx tolerate it, real
      // PowerPoint does not). Every table must carry a tableStyleId, and the
      // package must ship a matching tableStyles.xml part referenced from the
      // presentation rels + declared in [Content_Types].xml.
      const tblCount = (allSlideXml.match(/<a:tbl[ >]/g) || []).length;
      const styleIdCount = (allSlideXml.match(/<a:tableStyleId>/g) || []).length;
      check('every native table carries a <a:tableStyleId>',
        tblCount > 0 && styleIdCount >= tblCount, `tables=${tblCount} styleIds=${styleIdCount}`);
      check('package ships ppt/tableStyles.xml when a table is present',
        zip.names.includes('ppt/tableStyles.xml'));
      const presRels = zip.part('ppt/_rels/presentation.xml.rels') || '';
      check('presentation rels reference tableStyles.xml',
        /Target="tableStyles\.xml"/.test(presRels) && /relationships\/tableStyles/.test(presRels));
      const ctypes = zip.part('[Content_Types].xml') || '';
      check('[Content_Types].xml declares the tableStyles part',
        /PartName="\/ppt\/tableStyles\.xml"/.test(ctypes) && /presentationml\.tableStyles\+xml/.test(ctypes));

      // Regression: the editor's always-on bottom-right slide-position pill
      // ("01 / 05") is UI chrome, not slide content — it must never leak into
      // exported text runs (it lacked a data-no-pdf marker; extractBoxes also
      // had a dead skipSelectors check that let its pill background through).
      const counterLeak = allSlideXml.match(/<a:t[ >][^<]*\d{2}\s*\/\s*\d{2}[^<]*<\/a:t>/);
      check('no slide-position counter ("NN / NN") leaked into text runs', !counterLeak,
        counterLeak ? counterLeak[0] : '');

      // Regression: font sizes must use the fixed slide's 1:1 canvas-px->point
      // mapping (sz cpt = round(px*100)), NOT an extra CSS-px->pt 0.75 shrink on
      // top of it — the double conversion rendered text ~25% smaller than the
      // shapes/boxes around it (image-measured; see
      // .hyper-sprint/completed/2026-07-06-envoy/font-scale-calibration.md).
      // tech-talk's largest heading exports at ~4160 cpt (41.6pt); the 0.75 bug
      // would drop the largest run to ~3120 cpt, so a 3600-cpt floor catches it.
      const szVals = (allSlideXml.match(/sz="(\d+)"/g) || []).map(s => parseInt(s.replace(/\D/g, ''), 10));
      const maxSz = szVals.length ? Math.max(...szVals) : 0;
      check('font sizes use 1:1 px->pt scale (largest run >= 3600 cpt, not 0.75-shrunk)',
        maxSz >= 3600, `maxSz=${maxSz}`);

      // Regression: every emitted font-size sz must sit in OOXML's valid
      // ST_TextFontSize range [100, 400000] (1pt–4000pt). A run with sz="0" — which
      // happens when an ancestor's collapsed/scale(0) transform zeroes the measured
      // font size — is a schema violation real PowerPoint rejects on open ("found a
      // problem with content … removed it" repair). pptxCpt clamps to that range.
      const badSz = szVals.filter(v => v < 100 || v > 400000);
      check('every font-size sz is in OOXML range [100,400000] (no sz="0")',
        badSz.length === 0, `out-of-range=${JSON.stringify(badSz.slice(0, 8))}`);

      // Directly exercise the clamp: a text run whose measured size collapsed to 0
      // (getVisualScale → 0) must still emit a valid sz, not sz="0". Drives the
      // in-page emitter so it's independent of whether the deck happens to contain
      // a scale-0 element.
      const clampSz = await page.evaluate(() => {
        if (typeof pptxTextSp !== 'function' || typeof pptxCpt !== 'function') return null;
        const xml = pptxTextSp(2, { x: 0, y: 0, w: 100, h: 20, text: 'x', fontSize: 0 });
        const m = xml.match(/sz="(\d+)"/);
        return { run: m ? parseInt(m[1], 10) : null, zero: pptxCpt(0), neg: pptxCpt(-5), huge: pptxCpt(1e9) };
      });
      if (clampSz === null) {
        check('clamp unit: emitter fns reachable in page scope', false, 'pptxTextSp/pptxCpt not global');
      } else {
        check('clamp unit: fontSize:0 text emits valid sz (>=100, not 0)',
          clampSz.run !== null && clampSz.run >= 100, `sz=${clampSz.run}`);
        check('clamp unit: pptxCpt clamps 0/-5 up to 100 and 1e9 down to 400000',
          clampSz.zero === 100 && clampSz.neg === 100 && clampSz.huge === 400000,
          `zero=${clampSz.zero} neg=${clampSz.neg} huge=${clampSz.huge}`);
      }

      // Regression: inline **bold** / *italic* segments (parseInline renders them as
      // <span style="font-weight:700"> / <em> INSIDE the paragraph) must stay as RUNS
      // in the SAME text box — not spawn a separate box floating at the span's mid-line
      // rect (the misplaced-bold bug). Also: a flex/grid-centered glyph (numbered step
      // circle) must export centered, not left-hugging. Drives both the emitter (runs →
      // multiple <a:r>) and the DOM extractor directly.
      const inlineFmt = await page.evaluate(() => {
        if (typeof pptxTextSp !== 'function' || typeof pptxExtractTextBoxes !== 'function') return null;
        // (a) emitter: a runs[] text box emits one <a:r> per run with b="1" ONLY on bold.
        const xml = pptxTextSp(3, { x: 0, y: 0, w: 300, h: 40, fontSize: 18, color: { r: 0, g: 0, b: 0, a: 1 },
          runs: [[{ text: 'plain ' }, { text: 'bold', bold: true }, { text: ' end' }]] });
        const runCount = (xml.match(/<a:r>/g) || []).length;
        const boldAttrCount = (xml.match(/ b="1"/g) || []).length;
        const boldOnRightRun = /<a:rPr[^>]* b="1"[^>]*>[\s\S]*?<a:t>bold<\/a:t>/.test(xml);
        // (b) extractor: a paragraph with an inline bold span → ONE box, a bold run, full text.
        const host = document.createElement('div');
        host.style.cssText = 'position:absolute;left:0;top:0;width:400px';
        host.innerHTML = '<div style="color:#fff;font-size:16px">Slide sorter. '
          + '<span style="font-weight:700">Drag-and-drop</span> reorder.</div>';
        document.body.appendChild(host);
        // (c) extractor: a flex justify-content:center glyph → align "center".
        const circ = document.createElement('div');
        circ.style.cssText = 'position:absolute;left:0;top:0;width:400px';
        circ.innerHTML = '<div style="width:28px;height:28px;display:flex;align-items:center;'
          + 'justify-content:center;color:#fff;font-size:11px">1</div>';
        document.body.appendChild(circ);
        let boxes = [], circBoxes = [];
        try { boxes = pptxExtractTextBoxes(host, host.getBoundingClientRect()) || []; } catch (e) {}
        try { circBoxes = pptxExtractTextBoxes(circ, circ.getBoundingClientRect()) || []; } catch (e) {}
        const withText = boxes.filter((b) => b.text && b.text.indexOf('Drag-and-drop') >= 0);
        const box = withText[0];
        const oneBox = withText.length === 1;
        const hasBoldRun = !!(box && box.runs && box.runs.some((ln) => ln.some((r) => r.bold && /Drag-and-drop/.test(r.text))));
        const fullText = !!(box && /Slide sorter\.\s*Drag-and-drop\s*reorder\./.test(String(box.text).replace(/\n/g, ' ')));
        const circBox = circBoxes.find((b) => String(b.text).trim() === '1');
        const centered = !!(circBox && circBox.align === 'center');
        document.body.removeChild(host);
        document.body.removeChild(circ);
        return { runCount, boldAttrCount, boldOnRightRun, oneBox, hasBoldRun, fullText, centered };
      });
      if (inlineFmt === null) {
        check('inline-fmt unit: emitter/extractor reachable in page scope', false, 'pptxTextSp/pptxExtractTextBoxes not global');
      } else {
        check('inline bold: runs[] text box emits one <a:r> per run with b="1" only on the bold run',
          inlineFmt.runCount >= 3 && inlineFmt.boldAttrCount === 1 && inlineFmt.boldOnRightRun, JSON.stringify(inlineFmt));
        check('inline bold: a paragraph with a bold span extracts as ONE box (no floating bold), bold run + full text kept',
          inlineFmt.oneBox && inlineFmt.hasBoldRun && inlineFmt.fullText, JSON.stringify(inlineFmt));
        check('flex-center: a justify-content:center glyph (step-number circle) exports align="center"',
          inlineFmt.centered, JSON.stringify(inlineFmt));
      }

      // Regression: table cell fonts must carry the fitScale shrink-to-fit factor
      // (same as text boxes). Geometry from getBoundingClientRect is already scaled,
      // but getComputedStyle().fontSize is NOT — so an unscaled cell font oversizes
      // rows on a shrunk slide, growing the table past its region and overflowing the
      // blocks below (deck slide "Tables, Tags & Progress").
      const tblScale = await page.evaluate(() => {
        if (typeof pptxExtractTables !== 'function' || typeof getVisualScale !== 'function') return null;
        const host = document.createElement('div');
        host.style.cssText = 'position:absolute;left:0;top:0;width:800px;height:400px';
        host.innerHTML =
          '<div style="transform:scale(0.5);transform-origin:top left;width:800px">'
            + '<div data-block-type="table">'
              + '<div>'
                + '<div style="display:grid;grid-template-columns:1fr 1fr;width:800px">'
                  + '<div style="font-size:20px;padding:8px">Cell A</div>'
                  + '<div style="font-size:20px;padding:8px">Cell B</div>'
                + '</div>'
              + '</div>'
            + '</div>'
          + '</div>';
        document.body.appendChild(host);
        let tables = [];
        try { tables = pptxExtractTables(host, host.getBoundingClientRect()) || []; } catch (e) {}
        document.body.removeChild(host);
        const cell = tables[0] && tables[0].rows[0] && tables[0].rows[0].cells[0];
        return { found: !!cell, fontSize: cell ? cell.fontSize : null };
      });
      if (tblScale === null) {
        check('table-scale unit: pptxExtractTables/getVisualScale reachable in page scope', false, 'fns not global');
      } else {
        // 20px * 0.5 fitScale ≈ 10 (tolerance for sub-px rounding); the bug left it 20.
        check('table cell font carries the fitScale factor (20px @ scale .5 → ~10, not 20)',
          tblScale.found && tblScale.fontSize > 8 && tblScale.fontSize < 12, JSON.stringify(tblScale));
      }
    }

    await page.close();
  } catch (e) {
    fatal = e;
    console.log(`\n💥 ${e.message}`);
    if (e.stack) console.log(e.stack);
  } finally {
    await browser.close().catch(() => {});
  }

  if (fatal) { failed++; failures.push(`fatal: ${fatal.message}`); }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  ✅ ${passed} passed  ❌ ${failed} failed (${elapsed}s)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  if (failures.length) { console.log('\nFailures:'); failures.forEach(f => console.log(`  ✗ ${f}`)); }

  process.exit(failed > 0 ? 1 : 0);
})();
