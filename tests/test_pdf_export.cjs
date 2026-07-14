/**
 * Vela Slides — PDF Export E2E Test (Playwright)
 *
 * Closes gap G6: the PDF export had no byte-level end-to-end coverage (only
 * gradient-parse fuzzing). This drives the REAL export UI a user would use —
 * open the Export menu, pick "Export PDF", start the off-screen render loop —
 * and reads the produced application/pdf bytes back to assert the document
 * structure at the byte level (%PDF- header, %%EOF trailer, /Type /Page count,
 * non-trivial size, and — for the vector path — extractable slide text).
 *
 * Two reachable paths are exercised:
 *   • RASTER (default quality "high") — each slide is rasterized to a JPEG
 *     image XObject (/DCTDecode). Text is baked into pixels and is NOT
 *     extractable; the test asserts image XObjects instead (and documents this).
 *   • VECTOR (quality "Vector") — non-image slides are drawn with real PDF text
 *     operators; the test asserts a slide word appears inside a "(…) Tj" run.
 *
 * Boots the app via the canonical offline render builder
 * (tools/vela-dev/scripts/render-offline.js), the same recipe the desktop shell
 * + vela-drive.js use, so it stays in sync with the one true offline boot.
 *
 * Usage:
 *   node tests/test_pdf_export.cjs                 # build + run both paths
 *
 * Prints "✅ N passed  ❌ M failed" and exits non-zero on any failure, matching
 * the wording of tests/test_pptx_export.cjs. When Playwright or a Chromium
 * binary is unavailable it prints "PDF-SKIP: <reason>" and exits 0 so CI
 * soft-skips rather than hard-failing on an optional browser dep.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
// SECURITY fixture: a deck link whose value carries PDF literal-string
// metacharacters. It passes the URL allowlist (starts https://, no backslash),
// so it reaches the export sinks unchanged — where it MUST be escaped by
// pdfStringEncode. If any sink interpolated it raw, the leading ")" would close
// the (...) URI string and "/S /JavaScript /JS (...)" would inject a PDF action.
const PDF_INJECTION_LINK = "https://a.example/)/S/JavaScript/JS(app.alert)/Dummy(";
// Small dedicated fixture (3 slides) instead of the 28-slide demo deck: the PDF
// export machinery is proven identically with 3 pages, while the per-slide
// render/finalize loop (~350-450ms/slide × 2 paths) shrinks ~9×. Keeps a heading
// ("Vela") and body ("slide") so the vector text-layer assertion still finds
// extractable words. Full format (lanes/items/slides) so expectedPageCount reads it.
const DECK = (() => {
  const deck = {
    deckTitle: "PDF Export Smoke",
    lanes: [{ title: "Deck", items: [{ title: "Module", slides: [
      { bg: "#0f172a", color: "#e2e8f0", accent: "#3b82f6", blocks: [{ type: "heading", text: "Vela Slides", link: PDF_INJECTION_LINK }] },
      { bg: "#0f172a", color: "#e2e8f0", accent: "#3b82f6", blocks: [{ type: "text", text: "A slide with body text for the vector text layer." }] },
      { bg: "#0f172a", color: "#e2e8f0", accent: "#10b981", blocks: [{ type: "metric", value: "42", label: "Answer" }] },
    ] }] }],
  };
  // Unique per-process path so concurrent runs (parallel CI stacks / devs) can't
  // clobber each other's fixture.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-pdf-fixture-'));
  const p = path.join(dir, 'fixture.vela');
  fs.writeFileSync(p, JSON.stringify(deck));
  return p;
})();
const RENDER_OFFLINE = path.join(ROOT, 'tools', 'vela-dev', 'scripts', 'render-offline.js');

// ── Expected page count — replicate collectAllSlides() counting from the deck ──
// A module with presentCard shows an auto title slide before its content; hidden
// slides are excluded from the presentation (and therefore exports). This mirrors
// collectAllSlides() in src/parts/part-pdf.jsx so the count is derived from the
// deck, independent of the PDF the app produces.
function expectedPageCount(deckPath) {
  const deck = JSON.parse(fs.readFileSync(deckPath, 'utf8'));
  let n = 0;
  for (const lane of (deck.lanes || [])) {
    for (const item of (lane.items || [])) {
      if (item.presentCard) n += 1;
      for (const slide of (item.slides || [])) {
        if (slide && slide.hidden) continue;
        n += 1;
      }
    }
  }
  return n;
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

// ── Test bookkeeping ────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ── Boot the offline render in a fresh page ──────────────────────────────────
async function bootPage(browser, renderHtml) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  // Abort web-font requests so `document.fonts.ready` (awaited per vector slide in
  // vectorDomToCanvas) resolves immediately instead of waiting out the blocked-CDN
  // timeout. The PDF's vector text uses the fonts embedded in vela.jsx, and raster
  // capture just falls back to system fonts — so neither assertion is affected.
  await page.route('**/*', (route) =>
    route.request().resourceType() === 'font' ? route.abort() : route.continue());
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('file://' + renderHtml, { timeout: 60000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__velaBooted || window.__velaBootError, { timeout: 30000 });
  const bootErr = await page.evaluate(() => window.__velaBootError || null);
  if (bootErr) throw new Error('app boot error: ' + bootErr);
  await page.waitForSelector('header', { timeout: 10000 });
  return page;
}

// ── Drive the real PDF export UI (no data-testids on the PDF modal → text) ────
// The PDF export modal is opened from the header Export menu. There are no
// data-testids on it, so we locate its controls by their visible text — the
// export button ("EXPORT N SLIDES") and, for the vector path, the "Vector"
// quality tile. The finished modal exposes an <a download="*.pdf"> anchor whose
// href is a data:application/pdf;base64 URI (blob: URLs are blocked in the
// artifact sandbox), which is exactly what a click would download.
async function drivePdfExport(page, { vector }) {
  // Open the Export dropdown, then the "Export PDF" item.
  const openedMenu = await page.evaluate(() => {
    const b = document.querySelector('[data-testid=export-menu-toggle]');
    if (!b) return false; b.click(); return true;
  });
  if (!openedMenu) throw new Error('no export-menu-toggle (desktop header not mounted?)');

  await page.waitForFunction(() =>
    !![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Export PDF'),
    { timeout: 5000 });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Export PDF');
    b.click();
  });

  // Choose phase: the export button reads "EXPORT N SLIDES".
  await page.waitForFunction(() =>
    !![...document.querySelectorAll('button')].find(b => /^EXPORT\s+\d+\s+SLIDES$/.test(b.textContent.trim())),
    { timeout: 5000 });

  if (vector) {
    // Select the "Vector" quality tile before starting.
    const pickedVector = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => /^Vector(?![a-z])/.test(x.textContent.trim()));
      if (!b) return false; b.click(); return true;
    });
    if (!pickedVector) throw new Error('no "Vector" quality tile in PDF modal');
  }

  // Start the export (raster: startExport; vector: delegates to the vector modal
  // which auto-starts because a ratio is pre-selected).
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /^EXPORT\s+\d+\s+SLIDES$/.test(x.textContent.trim()));
    b.click();
  });

  // Off-screen render loop (~350–450ms/slide over ~28 slides + finalize; the
  // vector path's loadFonts() also eats a few seconds of failed font fetches over
  // the blocked network before falling back to standard fonts). Resolve when the
  // download anchor appears, or fail fast on the modal's error phase.
  // NB: waitForFunction's signature is (fn, arg, options) — the timeout must go in
  // the THIRD positional arg, else Playwright's 30s default silently applies.
  await page.waitForFunction(() => {
    const bodyTxt = document.body.textContent || '';
    if (/Export failed|PDF build failed|Capture failed/.test(bodyTxt)) return true;
    return !!document.querySelector('a[download$=".pdf"]');
  }, undefined, { timeout: 240000 });

  const info = await page.evaluate(() => {
    const a = document.querySelector('a[download$=".pdf"]');
    if (!a) {
      const err = (document.body.textContent || '').match(/(Export failed[^\n]*|PDF build failed[^\n]*|Capture failed[^\n]*)/);
      return { error: err ? err[1] : 'no download anchor and no error text' };
    }
    const uri = a.getAttribute('href') || '';
    const comma = uri.indexOf(',');
    return { uri, b64: comma >= 0 ? uri.slice(comma + 1) : '', download: a.getAttribute('download') };
  });
  if (info.error) throw new Error(`modal reported error: ${info.error}`);
  if (!info.uri.startsWith('data:application/pdf'))
    throw new Error('download href is not a application/pdf data URI');
  return info;
}

// ── Structural assertions on the raw PDF bytes ───────────────────────────────
function assertPdf(label, buf, expectedPages, { vector }) {
  // latin1 preserves every byte 1:1 so structural tokens (dict text) survive.
  const text = buf.toString('latin1');

  check(`[${label}] produced PDF is non-trivial in size (> 2 KB)`, buf.length > 2048, `size=${buf.length}`);
  check(`[${label}] starts with %PDF- header`, text.startsWith('%PDF-'), `head=${JSON.stringify(text.slice(0, 8))}`);
  check(`[${label}] contains %%EOF trailer`, text.includes('%%EOF'));
  check(`[${label}] has a /Type /Catalog`, /\/Type\s*\/Catalog/.test(text));

  // Page count — two independent readings must both equal the deck-derived count:
  //  (a) the /Count on the /Pages tree node, and
  //  (b) the number of individual "/Type /Page /Parent" page objects.
  const countMatch = text.match(/\/Type\s*\/Pages\s*\/Kids\s*\[[^\]]*\]\s*\/Count\s+(\d+)/);
  const treeCount = countMatch ? parseInt(countMatch[1], 10) : -1;
  const pageObjCount = (text.match(/\/Type \/Page \/Parent/g) || []).length;
  check(`[${label}] /Pages tree /Count == deck slide count (${expectedPages})`,
    treeCount === expectedPages, `treeCount=${treeCount}`);
  check(`[${label}] page-object count == deck slide count (${expectedPages})`,
    pageObjCount === expectedPages, `pageObjs=${pageObjCount}`);

  // xref/trailer wiring present.
  check(`[${label}] has an xref table and /Root reference`,
    /\bxref\b/.test(text) && /\/Root\s+\d+\s+0\s+R/.test(text));

  // SECURITY: the deck link with PDF metacharacters must be escaped, not break out.
  // Breakout = a ")" NOT preceded by a backslash, immediately followed by the
  // injected "/S/JavaScript". Escaped output has "\)" instead, which this rejects.
  const brokeOut = /[^\\]\)\/S\/JavaScript/.test(text);
  check(`[${label}] malicious deck link did not break out of the PDF URI string`,
    !brokeOut, 'unescaped ")/S/JavaScript" action-injection breakout present');
  // Positive proof the link actually rendered AND was routed through the encoder:
  // its ")" survives as the escaped "\)" sequence.
  check(`[${label}] malicious link present in pdfStringEncode-escaped form`,
    text.includes('\\)/S/JavaScript'), 'escaped "\\)/S/JavaScript" not found — link may not have rendered');

  if (vector) {
    // Vector path draws real text: a slide word must appear inside a "(…) Tj"
    // string-showing operator (content streams are uncompressed here). Restricting
    // to the (…)Tj form makes an accidental hit inside embedded font binary
    // essentially impossible. Try several distinctive demo-deck words.
    const words = ['Vela', 'Vera', 'deck', 'slide', 'Slides', 'block'];
    let hit = null;
    for (const w of words) {
      const re = new RegExp('\\((?:[^()\\\\]|\\\\.)*' + w + '(?:[^()\\\\]|\\\\.)*\\)\\s*Tj');
      if (re.test(text)) { hit = w; break; }
    }
    check(`[${label}] extractable slide text present in a "(…) Tj" run`, !!hit,
      hit ? `matched "${hit}"` : `none of ${JSON.stringify(words)}`);
    // Sanity: an embedded TrueType or fallback font must back that text.
    check(`[${label}] declares at least one /Font resource`, /\/Type\s*\/Font\b/.test(text));
  } else {
    // Raster path: every page is a JPEG image XObject; text is baked into pixels
    // and is NOT extractable. Assert the image XObjects instead (one per page),
    // documenting that no text layer exists on this path.
    const dctCount = (text.match(/\/DCTDecode/g) || []).length;
    check(`[${label}] every page is a JPEG image XObject (/DCTDecode >= pages)`,
      dctCount >= expectedPages, `dctDecode=${dctCount}`);
    check(`[${label}] image XObjects declared (/Subtype /Image)`, /\/Subtype\s*\/Image/.test(text));
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const t0 = Date.now();

  const expectedPages = expectedPageCount(DECK);
  console.log(`Deck-derived expected page count: ${expectedPages}\n`);

  const pw = resolvePlaywright();
  if (!pw) {
    console.log('PDF-SKIP: Playwright not found (npm install --save-dev playwright)');
    process.exit(0);
  }

  // Build the offline render once; reuse for both export paths.
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-pdf-render-'));
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
    console.log(`PDF-SKIP: could not launch Chromium — ${e.message}`);
    process.exit(0);
  }

  let fatal = null;
  try {
    // Both export paths are independent (each in its own page: full app boot +
    // render + finalize). Run them concurrently so wall time is the slower path,
    // not the sum — each is dominated by fixed per-export cost, not slide count.
    const variants = [{ label: 'raster', vector: false }, { label: 'vector', vector: true }];
    const results = await Promise.all(variants.map(async (variant) => {
      const page = await bootPage(browser, renderHtml);
      try {
        const info = await drivePdfExport(page, variant);
        return { variant, buf: Buffer.from(info.b64, 'base64'), download: info.download };
      } finally {
        await page.close().catch(() => {});
      }
    }));
    for (const { variant, buf, download } of results) {
      console.log(`\n── ${variant.label.toUpperCase()} PDF export ──`);
      console.log(`Exported ${variant.label} PDF: ${buf.length} bytes, download="${download}"`);
      assertPdf(variant.label, buf, expectedPages, variant);
    }
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
