#!/usr/bin/env node
/**
 * Vela browser render/exfil probe.
 *
 * Drives the Playwright Chromium that ships in this remote-execution image to
 * answer ONE question empirically: does a given piece of HTML — rendered exactly
 * as a browser would — execute script or fire an outbound (sub)resource request?
 * A live local collector logs every hit; a hit means that vector actually ran.
 *
 * Why this exists: jsdom cannot model the browser's "secure static mode" (SVG/HTML
 * loaded via <img>/CSS background-image runs with scripting + external loads
 * disabled), so static checks over-report. This settles it in a real browser.
 *
 * The container has NO general outbound network and the Playwright browser-download
 * CDN is blocked, but a prebuilt Chromium already lives under /opt/pw-browsers —
 * we launch it directly via executablePath (ignore Playwright's version pin).
 * The React/Babel CDNs are also blocked, so the full Vela app will not boot from
 * CDN; test the rendered SINKS directly (the markup Vela emits) unless you vendor
 * react/babel locally.
 *
 * Usage:
 *   node browser-probe.cjs --self-test          # re-verify the data:URI invariant + controls
 *   node browser-probe.cjs path/to/page.html    # render a custom page; "__COLLECTOR__" is
 *                                               # replaced with the live collector origin
 *
 * Exit 0 always (it reports; it does not assert). Read the verdict lines.
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const { execSync } = require("child_process");

// ── locate repo root (walk up to the part-imports.jsx marker) ──────────
function findRepoRoot(start) {
  let d = start;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(d, "tools/vela-dev/app/parts/part-imports.jsx"))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return process.cwd();
}
const REPO = findRepoRoot(__dirname);

// ── discover Chromium (version-agnostic) ───────────────────────────────
function findChromium() {
  const roots = ["/opt/pw-browsers", path.join(process.env.HOME || "/root", ".cache/ms-playwright")];
  const cands = [];
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    for (const name of fs.readdirSync(r)) {
      if (!/^chromium(-|_)/.test(name)) continue;
      for (const rel of ["chrome-linux/chrome", "chrome-linux/headless_shell"]) {
        const p = path.join(r, name, rel);
        if (fs.existsSync(p)) cands.push(p);
      }
    }
  }
  // prefer full "chrome" over headless_shell, and higher build numbers
  cands.sort((a, b) => {
    const fa = a.endsWith("/chrome") ? 1 : 0, fb = b.endsWith("/chrome") ? 1 : 0;
    if (fa !== fb) return fb - fa;
    return b.localeCompare(a);
  });
  return cands[0] || null;
}

function requirePlaywright() {
  for (const m of ["playwright", "playwright-core"]) {
    try { return require(path.join(REPO, "node_modules", m)); } catch (_) {}
    try { return require(m); } catch (_) {}
  }
  console.error("Playwright not installed. node_modules is gitignored/ephemeral — restore it with:");
  console.error("  (cd " + REPO + " && npm install --no-audit --no-fund --ignore-scripts playwright)");
  process.exit(2);
}

async function probe(pageHtml, { waitMs = 2500 } = {}) {
  const exe = findChromium();
  if (!exe) { console.error("No Chromium found under /opt/pw-browsers or ~/.cache/ms-playwright"); process.exit(2); }
  const { chromium } = requirePlaywright();

  const hits = [];
  const collector = http.createServer((req, res) => { hits.push(req.url); res.end("x"); });
  await new Promise((r) => collector.listen(0, "127.0.0.1", r));
  const C = "http://127.0.0.1:" + collector.address().port;

  const html = pageHtml.split("__COLLECTOR__").join(C);
  const pageServer = http.createServer((req, res) => {
    if (req.url === "/page") { res.setHeader("Content-Type", "text/html"); res.end(html); }
    else { hits.push("PAGEHOST" + req.url); res.end("x"); }
  });
  await new Promise((r) => pageServer.listen(0, "127.0.0.1", r));
  const PAGE = "http://127.0.0.1:" + pageServer.address().port + "/page";

  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  try {
    const p = await (await browser.newContext()).newPage();
    await p.goto(PAGE, { waitUntil: "networkidle" }).catch(() => {});
    await p.waitForTimeout(waitMs);
  } finally {
    await browser.close();
    collector.close(); pageServer.close();
  }
  return { exe, hits: [...new Set(hits)].filter((h) => h !== "PAGEHOST/favicon.ico").sort() };
}

// ── self-test: the canonical Vela render-context invariant ─────────────
function selfTestHtml() {
  const svgOnload = (t) => "data:image/svg+xml," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" onload="fetch('__COLLECTOR__/${t}_ONLOAD')"><image href="__COLLECTOR__/${t}_EXTREF.png"/></svg>`);
  const htmlScript = (t) => "data:text/html," + encodeURIComponent(`<script>fetch('__COLLECTOR__/${t}_HTMLJS')</script>`);
  return `<!DOCTYPE html><html><body>
    <img src="${svgOnload("IMG")}">                                          <!-- Vela image block -->
    <div style="width:40px;height:40px;background-image:url('${svgOnload("BG")}')">b</div> <!-- bgImage -->
    <img src="${svgOnload("LOGO")}"><img src="${htmlScript("LOGO")}">        <!-- branding.logo -->
    <!-- controls: these SHOULD fire, proving the probe detects execution -->
    <svg xmlns="http://www.w3.org/2000/svg" onload="fetch('__COLLECTOR__/CTRL_INLINE_ONLOAD')"></svg>
    <img src="__COLLECTOR__/CTRL_IMG_DIRECT.png">
    <object type="image/svg+xml" data="${svgOnload("CTRL_OBJECT")}"></object>
  </body></html>`;
}

(async () => {
  const arg = process.argv[2];
  const selfTest = !arg || arg === "--self-test";
  const html = selfTest ? selfTestHtml() : fs.readFileSync(arg, "utf8");
  const { exe, hits } = await probe(html);

  console.log("Chromium:", exe);
  console.log("\n=== collector hits (a hit = that vector executed/loaded in real Chromium) ===");
  if (!hits.length) console.log("  (none)");
  for (const h of hits) console.log("  HIT  " + h);

  if (selfTest) {
    console.log("\n=== Vela sinks (MUST stay inert — secure static mode) ===");
    for (const w of ["IMG_ONLOAD","IMG_EXTREF","BG_ONLOAD","BG_EXTREF","LOGO_ONLOAD","LOGO_EXTREF","LOGO_HTMLJS"]) {
      const got = hits.some((h) => h.includes(w));
      console.log(`  ${got ? "⚠️  FIRED — REGRESSION!" : "✅ inert"}  ${w}`);
    }
    console.log("\n=== controls (MUST fire — prove the probe isn't blind) ===");
    for (const c of ["CTRL_INLINE_ONLOAD","CTRL_IMG_DIRECT","CTRL_OBJECT_ONLOAD"]) {
      const got = hits.some((h) => h.includes(c));
      console.log(`  ${got ? "✅ fired" : "❌ DID NOT FIRE — probe blind spot"}  ${c}`);
    }
  }
})();
