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
  check(/view-switch-editor[^\n]*setGallery\?\.\(false\)/.test(sw), "Editor segment closes the gallery");
  check(/view-switch-gallery[^\n]*setGallery\?\.\(true\)/.test(sw), "Gallery segment opens the gallery");
  check(/view-switch-present[^\n]*present\?\.\(\)/.test(sw), "Present segment enters fullscreen");
  check(/view-switch-gallery[^\n]*aria-pressed=\{has && galleryOn\}/.test(sw), "Gallery segment shows active state");
  check(/showGallery,\s*setGallery:/.test(panel), "SlidePanel exposes showGallery + setGallery to the top bar");
  check(/\[slides\.length,[^\]]*showGallery\]\);/.test(panel), "ribbon effect re-runs when showGallery changes");
  const old = elementWithTestId(panel, "editor-gallery-toggle");
  check(old && !/Overview<\/span>/.test(old) && !old.includes("🗂"), "old Overview button is demoted to an icon-only, emoji-free shortcut");
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
