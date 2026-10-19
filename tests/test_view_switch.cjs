// Regression test for the editor/presenter chrome changes:
//   CR9  — branding config opens as a right-docked side pane (not a strip above
//          the slide) and is mutually exclusive with the chat/comments panes.
//   CR10 — fullscreen gallery toggle uses an SVG icon (the old emoji glyph has
//          no font in the desktop webview) on a visible backing.
//   CR11 — fullscreen edit toggle sits on the same dark backing strip, so the
//          white icon reads on light AND dark slides.
//   CR13 — top bar has an Editor | Gallery | Present segmented view switch.
//
// Source-pattern test (JSX in a shared-scope monolith, not importable). The
// browser behaviour was verified separately in offline Chromium.
const fs = require("fs");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", "src/parts", f), "utf8");
const panel = read("part-slidepanel.jsx");
const app = read("part-app.jsx");

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✅ " + n); };
const bad = (n, d) => { fail++; console.log("  ❌ " + n + (d ? " — " + d : "")); };
const check = (cond, n, d) => (cond ? ok(n) : bad(n, d));

// Return the JSX element source that starts at the first `<tag ... data-testid="id"`.
function elementWithTestId(src, id) {
  const at = src.indexOf(`data-testid="${id}"`);
  if (at < 0) return "";
  const start = src.lastIndexOf("<", at);
  const end = src.indexOf("\n", at);
  return src.slice(start, end < 0 ? undefined : end);
}

// Return the source between `<div data-testid="id"` and its matching `</div>`.
function blockWithTestId(src, id) {
  const at = src.indexOf(`data-testid="${id}"`);
  if (at < 0) return "";
  const start = src.lastIndexOf("<div", at);
  let depth = 0, m;
  // Count <div ...> openers and </div> closers; skip self-closing <div ... />.
  const tagRe = /<div\b[^>]*?(\/?)>|<\/div>/g;
  tagRe.lastIndex = start;
  while ((m = tagRe.exec(src))) {
    if (m[0].startsWith("</")) depth--;
    else if (m[1] !== "/") depth++;
    if (depth === 0) return src.slice(start, tagRe.lastIndex);
  }
  return src.slice(start);
}

console.log("CR13 — top-bar view switch");
{
  const sw = blockWithTestId(app, "view-switch");
  check(sw.length > 0, "view-switch container exists in the top bar");
  for (const id of ["view-switch-editor", "view-switch-gallery", "view-switch-present"]) {
    check(sw.includes(`data-testid="${id}"`), `${id} segment is inside the switch`);
  }
  const iE = sw.indexOf("view-switch-editor"), iG = sw.indexOf("view-switch-gallery"), iP = sw.indexOf("view-switch-present");
  check(iE >= 0 && iE < iG && iG < iP, "segment order is Editor | Gallery | Present");
  check(/view-switch-editor[^\n]*setView\?\.\("editor"\)/.test(sw), "Editor segment sets view editor");
  check(/view-switch-gallery[^\n]*setView\?\.\("gallery"\)/.test(sw), "Gallery segment sets view gallery");
  check(/view-switch-present[^\n]*setView\?\.\("present"\)/.test(sw), "Present segment sets view present");
  // D1: one view state — Present closes the gallery overlay first.
  check(/setView: \(v\) => \{ if \(v === "present"\) actionsRef\.current\.present\(\); else setGallery\(v === "gallery"\); \}/.test(panel), "setView maps editor|gallery|present onto one state");
  check(/present: \(\) => \{ stopAll\(\); setGallery\(false\); dispatch\(\{ type: "SET_FULLSCREEN", value: true \}\); \}/.test(panel), "present() closes the gallery before fullscreen (D1)");
  check(/view-switch-gallery[^\n]*aria-pressed=\{has && galleryOn\}/.test(sw), "Gallery segment shows active state");
  check(/showGallery,\s*setGallery:/.test(panel), "SlidePanel exposes showGallery + setGallery to the top bar");
  check(/\[slides\.length,[^\]]*showGallery\]\);/.test(panel), "ribbon effect re-runs when showGallery changes");
  const old = elementWithTestId(panel, "editor-gallery-toggle");
  check(old && !/Overview<\/span>/.test(old) && !old.includes("🗂"), "old Overview button is demoted to an icon-only, emoji-free shortcut");
}

console.log("D1/D2/D3 — view switch reachable over the gallery, F path, compact header");
{
  const slidesSrc = read("part-slides.jsx");
  check(/function GalleryView\(\{[^}]*top = 0 \}\)/.test(slidesSrc) && /data-testid="gallery-overlay" style=\{\{ position: "fixed", top, left: 0, right: 0, bottom: 0, zIndex: 10000/.test(slidesSrc), "D1: GalleryView overlay takes a top offset (no inset: 0)");
  check(/<GalleryView [^\n]*top=\{Math\.max\(0, Math\.round\(containerRef\.current\?\.getBoundingClientRect\(\)\.top/.test(panel), "D1: editor gallery starts below the top bar");
  check(/e\.key === "f"[^\n]*if \(fullscreen && !showGalleryRef\.current\) \{[^\n]*SET_FULLSCREEN", value: false[^\n]*else actionsRef\?\.current\?\.setView\?\.\("present"\)/.test(panel), "D2: F enters Present through setView (closes the gallery)");
  check(/e\.key === "F5"[^\n]*if \(!fullscreen \|\| showGalleryRef\.current\) actionsRef\?\.current\?\.setView\?\.\("present"\)/.test(panel), "D2: F5 enters Present through setView");
  check(!/e\.key === "f"[^\n]*value: !fullscreen/.test(panel), "D2: F no longer toggles fullscreen blind to the gallery");
  const sw = blockWithTestId(app, "view-switch");
  check(/HDR_COMPACT_W = 1280/.test(app) && /data-compact=\{hdrCompact/.test(sw), "D3: view switch has a compact tier below 1280");
  for (const [id, lbl] of [["view-switch-editor", "Editor"], ["view-switch-gallery", "Gallery"], ["view-switch-present", "Present"]]) {
    const el = elementWithTestId(sw, id);
    check(el.includes(`{!hdrCompact && " ${lbl}"}`) && /aria-label="/.test(el) && /aria-pressed=/.test(el), `D3: ${id} hides its label when compact, keeps aria-label + aria-pressed`);
  }
  check(/view-switch-present[^\n]*background: has \? T\.green/.test(sw), "D3: Present keeps the green emphasis");
}

console.log("CR10/CR11 — fullscreen top-right controls");
{
  const strip = blockWithTestId(panel, "present-chrome-strip");
  check(strip.length > 0, "present-chrome-strip container exists");
  check(/background: "rgba\(15,17,23,0\.\d+\)"/.test(strip), "strip has a dark translucent backing");
  for (const id of ["gallery-toggle", "present-edit-toggle", "presenter-toggle", "student-toggle", "present-exit"]) {
    check(strip.includes(`data-testid="${id}"`), `${id} sits on the backed strip`);
  }
  const gal = elementWithTestId(panel, "gallery-toggle");
  check(gal.includes('getIcon("grid"') && !gal.includes("🗂"), "gallery toggle uses the SVG grid icon, not the emoji");
  const edit = elementWithTestId(panel, "present-edit-toggle");
  check(edit.includes('getIcon("edit"') && !edit.includes("✏"), "edit toggle uses the SVG pencil icon");
  for (const [id, el] of [["gallery-toggle", gal], ["present-edit-toggle", edit]]) {
    const m = el.match(/opacity: ([\d.]+)/);
    check(m && parseFloat(m[1]) >= 0.85, `${id} overrides the dim .slide-nav-btn opacity (inline >= 0.85)`);
    check(!/position: "absolute"/.test(el), `${id} is laid out by the strip, not absolutely`);
  }
}

console.log("CR9 — branding side pane");
{
  const pane = blockWithTestId(panel, "branding-side-pane");
  check(pane.length > 0, "branding-side-pane exists");
  check(/position: "fixed"/.test(pane) && /right: 0/.test(pane) && /bottom: 0/.test(pane), "pane is docked to the right edge, full height");
  check(pane.includes("<BrandingPanel"), "pane hosts the unchanged BrandingPanel");
  check(pane.includes('data-testid="branding-side-pane-close"'), "pane has its own close button");
  check(/overflowY: "auto"/.test(pane), "pane body scrolls");
  check(!/showBranding && <div style=\{\{ flexShrink: 0 \}\}><BrandingPanel/.test(panel), "old above-the-slide branding strip is gone");
  const tb = panel.slice(panel.indexOf("toggleBranding:"), panel.indexOf("closeBranding:"));
  check(/SET_CHAT", open: false/.test(tb) && /SET_COMMENTS_PANEL", open: false/.test(tb), "opening branding closes chat + comments panes");
  check((app.match(/slideActionsRef\.current\?\.closeBranding\?\.\(\)/g) || []).length >= 2, "opening chat or comments closes the branding pane");
}

console.log("W3 — branding pane reserves space");
{
  check(/data-testid="slide-panel-root"[^\n]*paddingRight: showBranding && !isMobile && !brandNarrow \? 360 : 0/.test(panel), "slide area reserves the 360px pane width when branding is open (>= 1100 wide)");
  check(/BRAND_RESERVE_MIN_W = 1100/.test(panel) && /window\.innerWidth < BRAND_RESERVE_MIN_W/.test(panel), "widths < 1100 fall back to overlay (D2)");
  check(/data-testid="slide-toolbar"[^\n]*flexWrap: "wrap"/.test(panel), "slide toolbar wraps so no button is clipped (D2b)");
  check(/branding-side-pane-close/.test(panel), "overlay mode keeps the close button");
}

console.log("D5 — hidden slide in gallery is dimmed");
{
  const slidesSrc = read("part-slides.jsx");
  check(/data-testid=\{s\.isTitleCard \? "gallery-title-card" : "gallery-slide"\} data-hidden=\{!s\.isTitleCard && s\.slide\.hidden \? "true" : "false"\}/.test(slidesSrc), "gallery card carries data-hidden");
  check(/data-testid="gallery-thumb-wrap" style=\{\{ opacity: !s\.isTitleCard && s\.slide\.hidden \? 0\.5 : 1 \}\}/.test(slidesSrc), "hidden card thumbnail is dimmed to 0.5");
  check(/gallery-hide-slide[^\n]*opacity: s\.slide\.hidden \? 1 : 0\.4/.test(slidesSrc), "hide button stays at full opacity when hidden");
}

// Browser geometry check (optional: runs when a headless render dir is given).
const renderDir = process.env.VELA_RENDER_DIR;
if (renderDir) {
  let pw; try { pw = require("playwright"); } catch (e) { pw = require("/home/user/vela-slides/node_modules/playwright"); }
  const { chromium } = pw;
  (async () => {
    const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
    const boot = async (w, h) => {
      const pg = await b.newPage({ viewport: { width: w, height: h || 800 } });
      await pg.goto("file://" + renderDir + "/render.html");
      await pg.waitForFunction(() => window.__velaBooted, null, { timeout: 30000 });
      return pg;
    };
    // W3 + D2 + D2b: reserve only at >= 1100; overlay below; toolbar reachable.
    for (const w of [800, 900, 1100, 1280, 1440]) {
      const pg = await boot(w);
      await pg.click('[data-testid="brand-toggle"]');
      await pg.waitForSelector('[data-testid="branding-side-pane"]');
      await pg.waitForTimeout(300);
      const r = await pg.evaluate(() => {
        const q = (s) => document.querySelector(s).getBoundingClientRect();
        const p = q('[data-testid="branding-side-pane"]'), v = q('[data-testid="slide-fx-wrapper"]');
        const tb = [...document.querySelectorAll('[data-testid="slide-toolbar"] button')].map((e) => e.getBoundingClientRect());
        return { pl: p.left, vr: v.right, vw: Math.round(v.width), pr: getComputedStyle(document.querySelector('[data-testid="slide-panel-root"]')).paddingRight,
          tbMin: Math.min(...tb.map((x) => x.left)), tbMax: Math.max(...tb.map((x) => x.right)), close: !!document.querySelector('[data-testid="branding-side-pane-close"]') };
      });
      const d = JSON.stringify(r);
      if (w >= 1100) {
        check(r.pr === "360px" && r.vr <= r.pl + 0.5, `${w}px: slide area reserves the pane width (no overlap)`, d);
        check(r.tbMin >= 0 && r.tbMax <= r.pl + 0.5, `${w}px: every slide-toolbar button is visible left of the pane`, d);
        check(r.vw >= 320, `${w}px: reserved slide stays usable (>= 320 px wide)`, d);
      } else {
        check(r.pr === "0px" && r.close, `${w}px: pane overlays the slide (no reserve) and has a close button`, d);
        check(r.vw >= 400, `${w}px: slide is not squeezed (>= 400 px wide)`, d);
      }
      await pg.close();
    }
    // D1: all six Editor/Gallery/Present transitions with real mouse clicks.
    {
      const pg = await boot(1280);
      const st = () => pg.evaluate(() => ({ gal: !!document.querySelector('[data-testid="gallery-close"]'), present: !!document.querySelector('[data-testid="present-exit"]') }));
      const settle = () => pg.waitForTimeout(350);
      const want = async (exp, name) => { const s = await st(); check(s.gal === exp.gal && s.present === exp.present, name, JSON.stringify(s)); };
      await pg.click('[data-testid="view-switch-gallery"]'); await settle();
      await want({ gal: true, present: false }, "D1: Editor -> Gallery (mouse)");
      const hit = await pg.evaluate(() => { const b = document.querySelector('[data-testid="view-switch-present"]').getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!e && !!e.closest('[data-testid="view-switch"]'); });
      check(hit, "D1: with the gallery open, elementFromPoint at the switch hits the switch");
      await pg.click('[data-testid="view-switch-editor"]'); await settle();
      await want({ gal: false, present: false }, "D1: Gallery -> Editor (mouse)");
      await pg.click('[data-testid="view-switch-gallery"]'); await settle();
      await pg.click('[data-testid="view-switch-present"]'); await settle();
      await want({ gal: false, present: true }, "D1: Gallery -> Present (mouse)");
      await pg.click('[data-testid="present-exit"]'); await settle();
      await want({ gal: false, present: false }, "D1: Present -> Editor (exit)");
      const ed = await pg.evaluate(() => document.querySelector('[data-testid="view-switch-editor"]')?.getAttribute("aria-pressed"));
      check(ed === "true", "D1: after exit the Editor segment is active", String(ed));
      await pg.click('[data-testid="view-switch-present"]'); await settle();
      await want({ gal: false, present: true }, "D1: Editor -> Present (mouse)");
      await pg.click('[data-testid="gallery-toggle"]'); await settle();
      await want({ gal: true, present: true }, "D1: Present -> Gallery (strip toggle)");
      await pg.click('[data-testid="gallery-close"]'); await settle();
      await want({ gal: false, present: true }, "D1: gallery close button returns to Present");
      await pg.click('[data-testid="present-exit"]'); await settle();
      // Export menu opens above the gallery overlay.
      await pg.click('[data-testid="view-switch-gallery"]'); await settle();
      await pg.click('[data-testid="export-menu-toggle"]'); await settle();
      const menuOk = await pg.evaluate(() => { const b = document.querySelector('[data-testid="export-pdf-menu-item"]'); if (!b) return false; const r = b.getBoundingClientRect(); return document.elementFromPoint(r.left + 10, r.top + r.height / 2)?.closest('[data-testid="export-pdf-menu-item"]') === b; });
      check(menuOk, "D1: Export menu shows above the gallery overlay");
      await pg.keyboard.press("Escape"); await settle();
      await pg.close();
    }
    // D2: keys F / F5 / G / Escape go through one view path.
    {
      const pg = await boot(1280);
      const st = () => pg.evaluate(() => ({ gal: !!document.querySelector('[data-testid="gallery-close"]'), present: !!document.querySelector('[data-testid="present-exit"]') }));
      const settle = () => pg.waitForTimeout(350);
      const want = async (exp, name) => { const s = await st(); check(s.gal === exp.gal && s.present === exp.present, name, JSON.stringify(s)); };
      await pg.evaluate(() => document.activeElement?.blur?.());
      await pg.keyboard.press("g"); await settle();
      await want({ gal: true, present: false }, "D2: G opens the gallery");
      await pg.keyboard.press("f"); await settle();
      await want({ gal: false, present: true }, "D2: F with the gallery open closes it and presents");
      await pg.keyboard.press("f"); await settle();
      await want({ gal: false, present: false }, "D2: F in Present returns to the editor");
      await pg.keyboard.press("g"); await settle();
      await pg.keyboard.press("g"); await settle();
      await want({ gal: false, present: false }, "D2: G toggles the gallery closed");
      await pg.keyboard.press("g"); await settle();
      await pg.keyboard.press("F5"); await settle();
      await want({ gal: false, present: true }, "D2: F5 with the gallery open closes it and presents");
      await pg.keyboard.press("g"); await settle();
      await want({ gal: true, present: true }, "D2: G in Present opens the gallery");
      await pg.keyboard.press("Escape"); await settle();
      await want({ gal: false, present: true }, "D2: Escape closes the gallery, stays in Present");
      await pg.keyboard.press("g"); await settle();
      await pg.keyboard.press("f"); await settle();
      await want({ gal: false, present: true }, "D2: F in Present with the gallery closes it, stays in Present");
      await pg.close();
    }
    // D3: every header button is on screen at 900..1440.
    for (const w of [900, 1000, 1100, 1180, 1280, 1440]) {
      const pg = await boot(w);
      await pg.waitForTimeout(200);
      const r = await pg.evaluate(() => {
        const h = document.querySelector("header");
        const btns = [...h.querySelectorAll("button")].map((b) => b.getBoundingClientRect()).filter((x) => x.width > 0);
        return { over: h.scrollWidth - h.clientWidth, maxR: Math.max(...btns.map((x) => x.right)), minL: Math.min(...btns.map((x) => x.left)), vw: window.innerWidth, compact: document.querySelector('[data-testid="view-switch"]')?.getAttribute("data-compact"), present: document.querySelector('[data-testid="view-switch-present"]')?.textContent };
      });
      check(r.over <= 0 && r.maxR <= r.vw && r.minL >= 0, `D3: ${w}px: header does not overflow, all buttons on screen`, JSON.stringify(r));
      check((w < 1280) === (r.compact === "true") && (w < 1280 ? !/Present/.test(r.present) : /Present/.test(r.present)), `D3: ${w}px: switch is ${w < 1280 ? "compact" : "labelled"}`, JSON.stringify(r));
      await pg.close();
    }
    {
      const pg = await boot(1280);
      // D5: hide a slide from the gallery -> card dimmed, hide button full opacity.
      await pg.click('[data-testid="view-switch-gallery"]');
      await pg.waitForSelector('[data-testid="gallery-hide-slide"]');
      await pg.evaluate(() => document.querySelector('[data-testid="gallery-slide"] [data-testid="gallery-hide-slide"]').click());
      await pg.waitForTimeout(700);
      const hc = await pg.evaluate(() => {
        const c = document.querySelector('[data-testid="gallery-slide"][data-hidden="true"]');
        if (!c) return null;
        return { thumb: getComputedStyle(c.querySelector('[data-testid="gallery-thumb-wrap"]')).opacity, btn: getComputedStyle(c.querySelector('[data-testid="gallery-hide-slide"]')).opacity, btnHidden: c.querySelector('[data-testid="gallery-hide-slide"]').getAttribute("data-hidden") };
      });
      check(hc && hc.thumb === "0.5" && hc.btn === "1" && hc.btnHidden === "true", "D5: hidden card is dimmed, hide button stays at full opacity", JSON.stringify(hc));
      await pg.close();
    }
    // D4: Comments pane open at 800 px -> chip strip is one row.
    {
      const pg = await boot(800);
      await pg.click('[data-testid="comments-toggle"]');
      await pg.waitForTimeout(500);
      const st = await pg.evaluate(() => { const e = document.querySelector('[data-testid="slide-review-strip"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { h: Math.round(r.height), compact: e.getAttribute("data-compact") }; });
      check(st && st.h <= 26, "D4: chip strip is a single row at 800 px with Comments open", JSON.stringify(st));
      await pg.close();
    }
    await b.close();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  })().catch((e) => { bad("browser run aborted", String(e.message).split("\n")[0]); console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); });
} else {
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
}
