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
 * (skills/vela-slides/scripts/render-offline.js), the same recipe the desktop
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
const RENDER_OFFLINE = path.join(ROOT, 'skills', 'vela-slides', 'scripts', 'render-offline.js');

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
