/**
 * Vela Slides — slide-canvas editor chrome placement (Playwright, real browser)
 *
 * Guards three layout contracts in part-canvas.jsx / part-blocks.jsx:
 *   1. Flush-edge block toolbar: a block flush with the slide edge (full-bleed
 *      solo image) renders its hover toolbar INSIDE the block, every button is
 *      the top hit target (not covered by the accent bar, not clipped), and the
 *      link popup opens DOWNWARD inside the block.
 *   2. Item link badge: the idle link badge of text items (icon-row, bullets,
 *      steps, checklist, tag-group, timeline) sits inline right after the last
 *      glyph of its text: no overlap with text, gap <= 8 px, same line.
 *   3. Side image (image-left / image-right): the image is vertically centered
 *      against the content column (no top-aligned, zero-margin image).
 *   4. Block link badge: a text-like block (text, heading, quote, callout,
 *      badge, metric) with a block-level link shows its badge inline after the
 *      last glyph (short, wrapped, centered, right-aligned, narrow columns).
 *
 * Usage: node tests/test_canvas_chrome_e2e.cjs
 * Builds a fresh offline render (.hyper-sprint/render-offline.js) into a temp
 * dir. Prints SKIP and exits 0 when Playwright/Chromium is not available.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.join(__dirname, "..");
let chromium;
for (const p of [path.join(REPO, "node_modules", "playwright"), path.join(REPO, "..", "..", "..", "node_modules", "playwright"), "playwright"]) {
  try { ({ chromium } = require(p)); break; } catch (_) {}
}
if (!chromium) { console.log("SKIP: playwright not installed"); process.exit(0); }
const { launchChromium } = require("./playwright_browser.cjs");

let pass = 0, fail = 0;
const check = (name, cond, detail) => { if (cond) { pass++; console.log("  ✅ " + name); } else { fail++; console.log("  ❌ " + name + (detail ? " — " + JSON.stringify(detail) : "")); } };

// Solid-colour PNG as a data URI (raster data URIs pass ingress sanitization).
const zlib = require("zlib");
function png(w, h, rgb) {
  const crcTable = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(w).fill(rgb).flat())]);
  const raw = Buffer.concat(Array(h).fill(row));
  const data = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return "data:image/png;base64," + data.toString("base64");
}
const IMG = png(160, 90, [200, 120, 60]);
const TALL = png(90, 160, [60, 140, 200]);
const L = "https://example.com/x";
const slides = [
  { bg: "#0f172a", blocks: [{ type: "image", src: IMG }] },
  { bg: "#0f172a", blocks: [{ type: "heading", text: "Links" }, { type: "icon-row", cols: 2, items: [
    { icon: "MessageSquare", title: "ChatGPT", text: "chatgpt.com", link: L },
    { icon: "Palette", title: "Google Stitch (Beta)", text: "stitch.withgoogle.com", link: L },
    { icon: "Box", title: "Docker Sandboxes", text: "docker.com/products/docker-sandboxes", link: L },
    { icon: "Heart", title: "A very long linked title that will wrap onto a second line for sure here", text: "short", link: L },
  ] }] },
  { bg: "#0f172a", blocks: [
    { type: "bullets", items: [{ text: "Short", link: L }, { text: "A much longer bullet that runs all the way across the column and wraps to a second line to test placement", link: L }, "Plain"] },
    { type: "steps", items: [{ title: "Step one", text: "desc", link: L }] },
    { type: "checklist", items: [{ text: "Task linked", status: "done", link: L }] },
    { type: "tag-group", items: [{ text: "Tag", link: L }] },
    { type: "timeline", items: [{ date: "2025", title: "Milestone", link: L }, { date: "2026", title: "Next" }] },
  ] },
  { bg: "#0f172a", layout: "image-right", blocks: [{ type: "heading", text: "Image right" }, { type: "text", text: "Body text." }, { type: "image", src: IMG }] },
  { bg: "#0f172a", layout: "image-left", blocks: [{ type: "heading", text: "Image left tall" }, { type: "text", text: "Body text." }, { type: "image", src: TALL }] },
  // 4. block-level links on text-like blocks (slides 6-8)
  { bg: "#0f172a", blocks: [
    { type: "text", text: "Short linked text", link: L },
    { type: "text", text: "A long linked paragraph that runs across the full slide width and must wrap onto a second line so the badge follows the very last word", link: L },
    { type: "text", text: "Centered linked text", align: "center", link: L },
    { type: "text", text: "Right aligned linked text", align: "right", link: L },
    { type: "heading", text: "Linked heading", link: L },
    { type: "heading", text: "Heading with icon", icon: "Star", link: L },
    { type: "badge", text: "Linked badge", link: L },
  ] },
  { bg: "#0f172a", blocks: [
    { type: "quote", text: "A linked quote without an author", link: L },
    { type: "quote", text: "A linked quote", author: "Someone", link: L },
    { type: "callout", title: "Callout title", text: "Linked callout body text.", link: L },
    { type: "metric", value: "42%", label: "Linked metric", link: L },
    { type: "heading", text: "Centered heading", align: "center", size: "xl", link: L },
  ] },
  { bg: "#0f172a", layout: "cols", blocks: [{ type: "heading", text: "Narrow columns", link: L }],
    L: [{ type: "text", text: "Left column linked text that wraps inside a narrow column width", link: L }, { type: "text", text: "Right edge", align: "right", link: L }],
    R: [{ type: "callout", title: "Narrow", text: "Callout in a narrow column that wraps", link: L }, { type: "metric", value: "7", link: L }] },
];
const deck = { deckTitle: "Canvas chrome", branding: { enabled: true, accentBar: true, accentHeight: 6 },
  lanes: [{ id: "l1", title: "L", items: [{ id: "i1", title: "Chrome", status: "todo", slides }] }] };

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vela-canvas-chrome-"));
  const deckPath = path.join(tmp, "deck.vela");
  fs.writeFileSync(deckPath, JSON.stringify(deck));
  const outDir = path.join(tmp, "out");
  execFileSync("node", [path.join(REPO, ".hyper-sprint", "render-offline.js"), deckPath, outDir, "--repo-root", REPO], { stdio: "pipe" });
  let browser;
  try { browser = await launchChromium(chromium); } catch (e) { console.log("SKIP: chromium not available — " + e.message); process.exit(0); }
  for (const vw of [1600, 1440, 1100, 1024]) {
    console.log(`viewport ${vw}px`);
    const page = await browser.newPage({ viewport: { width: vw, height: 1000 } });
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("file://" + path.join(outDir, "render.html"));
    await page.waitForFunction(() => window.__velaBooted, null, { timeout: 60000 });
    await page.waitForTimeout(1000);
    const go = async (n) => {
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      for (let k = 0; k < 8; k++) await page.keyboard.press("ArrowLeft");
      for (let k = 0; k < n; k++) await page.keyboard.press("ArrowRight");
      await page.mouse.move(2, 2);
      await page.waitForTimeout(600);
    };

    // 1. flush toolbar
    await go(0);
    await page.locator('[data-block-type="image"]').first().hover();
    await page.waitForTimeout(250);
    const tb = await page.evaluate(() => {
      const t = document.querySelector('[data-testid="block-toolbar"]');
      if (!t) return null;
      const wrap = t.closest("[data-block-type]");
      const w = wrap.getBoundingClientRect(), r = t.getBoundingClientRect();
      const hits = [...t.querySelectorAll("button")].map((b) => { const q = b.getBoundingClientRect(); const h = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return !!h && (b === h || b.contains(h)); });
      return { inset: t.dataset.toolbarInset, inside: r.top >= w.top && r.right <= w.right + 0.5, hits };
    });
    check("flush image: toolbar renders inset", tb && tb.inset === "true", tb);
    check("flush image: toolbar inside the block box", tb && tb.inside, tb);
    check("flush image: every toolbar button is the top hit target", tb && tb.hits.length >= 3 && tb.hits.every(Boolean), tb);
    await page.locator('[data-testid="block-toolbar"] button[title="Add link"]').click();
    await page.waitForTimeout(250);
    const pop = await page.evaluate(() => {
      const p = document.querySelector('[data-testid="block-link-popup"]');
      if (!p) return null;
      const w = p.closest("[data-block-type]").getBoundingClientRect(), r = p.getBoundingClientRect();
      const i = p.querySelector("input").getBoundingClientRect(); const h = document.elementFromPoint(i.left + 6, i.top + i.height / 2);
      return { below: r.top > w.top, inputHit: !!h && h.tagName === "INPUT" };
    });
    check("flush image: link popup opens downward inside the block and is clickable", pop && pop.below && pop.inputHit, pop);
    await page.keyboard.press("Escape");

    // 2. inline link badges
    for (const n of [1, 2]) {
      await go(n);
      const badges = await page.evaluate(() => [...document.querySelectorAll('[data-testid="item-link-badge"]')].map((b) => {
        const br = b.getBoundingClientRect(); const host = b.parentElement;
        const range = document.createRange(); let overlap = false, last = null;
        const tw = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
        while (tw.nextNode()) { const tn = tw.currentNode; if (b.contains(tn)) continue; range.selectNodeContents(tn);
          for (const r of range.getClientRects()) { if (!r.width) continue; if (!(r.right <= br.left || r.left >= br.right || r.bottom <= br.top || r.top >= br.bottom)) overlap = true; last = r; } }
        return { text: host.textContent.slice(0, 24), overlap, gap: last ? (br.left - last.right) / (br.width / 14) : null, /* slide px: editor badge is 14px wide */ sameLine: last ? Math.abs((last.top + last.bottom) / 2 - (br.top + br.bottom) / 2) < 12 : false };
      }));
      check(`slide ${n + 1}: link badges present`, badges.length >= (n === 1 ? 4 : 6), badges.length);
      for (const b of badges) check(`slide ${n + 1}: badge after "${b.text}" — no overlap, gap 0..8px, same line`, !b.overlap && b.gap != null && b.gap >= 0 && b.gap <= 8 && b.sameLine, b);
    }

    // 3. side image centered against content
    for (const n of [3, 4]) {
      await go(n);
      const m = await page.evaluate(() => {
        const c = document.querySelector("[data-split-content]"), im = document.querySelector("[data-split-image] img");
        if (!c || !im) return null;
        const col = c.getBoundingClientRect(), ks = [...c.children].map((k) => k.getBoundingClientRect()), ir = im.getBoundingClientRect();
        const ct = Math.min(...ks.map((r) => r.top)), cb = Math.max(...ks.map((r) => r.bottom));
        return { contentMid: (ct + cb) / 2 - col.top, imgMid: (ir.top + ir.bottom) / 2 - col.top, imgTop: ir.top - col.top };
      });
      check(`slide ${n + 1}: side image vertically centered with content (not top-aligned)`, m && Math.abs(m.contentMid - m.imgMid) <= 4 && m.imgTop > 4, m);
    }
    // 4. block-level text link badges: inline after the last glyph, never at the box edge
    for (const [n, want] of [[5, 7], [6, 5], [7, 5]]) {
      await go(n);
      const res = await page.evaluate(() => [...document.querySelectorAll("[data-block-index][data-pdf-link]")].map((host) => {
        const bs = host.querySelectorAll('[data-testid="block-link-badge"]');
        if (bs.length !== 1) return { type: host.dataset.blockType, count: bs.length };
        const b = bs[0], br = b.getBoundingClientRect(), hr = host.getBoundingClientRect(), k = br.width / 14;
        const range = document.createRange(); let overlap = false, last = null;
        const tw = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
        while (tw.nextNode()) { const tn = tw.currentNode; if (b.contains(tn)) continue; range.selectNodeContents(tn);
          for (const r of range.getClientRects()) { if (!r.width) continue; if (!(r.right <= br.left || r.left >= br.right || r.bottom <= br.top || r.top >= br.bottom)) overlap = true; last = r; } }
        return { type: host.dataset.blockType, text: host.textContent.slice(0, 24), count: 1, overlap,
          gap: last ? (br.left - last.right) / k : null,
          sameLine: last ? Math.abs((last.top + last.bottom) / 2 - (br.top + br.bottom) / 2) < 14 * k : false,
          inside: br.right <= hr.right + 2 * k };
      }));
      check(`slide ${n + 1}: every linked text block has one inline badge`, res.length === want && res.every((r) => r.count === 1), res);
      for (const r of res) check(`slide ${n + 1}: ${r.type} "${r.text}" — badge after last glyph, no overlap, gap 0..8px, same line`, r.count === 1 && !r.overlap && r.gap != null && r.gap >= 0 && r.gap <= 8 && r.sameLine && r.inside, r);
    }
    check("no page errors", errors.length === 0, errors);
    await page.close();
  }
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
