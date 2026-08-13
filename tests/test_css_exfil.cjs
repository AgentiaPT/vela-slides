#!/usr/bin/env node
/*
 * Functional round-trip for the slide/block CSS auto-load exfil fix (v12.61).
 *
 * Slide- and block-level color/background SCALAR fields (bg, bgGradient, color,
 * accent, the per-block *Color/*Bg fields, grid cell.bg, branding footerBg/
 * accentColor) are written straight into inline CSS at render. Unlike block.style
 * they bypassed sanitizeStyle, so a value like `url(https://x)` fired a zero-click
 * outbound GET on render (CSS exfil beacon — same class as the SVG/img holes
 * closed in v12.59, different surface).
 *
 * This extracts the REAL guard (STYLE_VALUE_REJECT + CSS_COLOR_KEY +
 * scrubColorFields) from part-imports.jsx and runs it — pure string logic, no
 * jsdom required — asserting every listed field is neutralized while legitimate
 * colors/gradients survive. The fontFamily case pins that the strengthened
 * STYLE_VALUE_REJECT did not break legitimate quoted block.style values.
 *
 * No source-only string match: this actually executes the shipped predicate.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const IMPORTS = path.join(__dirname, "..", "src", "parts", "part-imports.jsx");
const src = fs.readFileSync(IMPORTS, "utf8");

let pass = 0, failCount = 0;
function ok(name) { pass++; console.log("  ✅ " + name); }
function bad(name, detail) { failCount++; console.log("  ❌ " + name + (detail ? " — " + detail : "")); }

// ── Extract the real guard from source (fail loudly if the fix is absent) ──
function grab(re, label) {
  const m = src.match(re);
  if (!m) { bad("extract " + label, "not found in part-imports.jsx (fix missing?)"); throw new Error("missing " + label); }
  return m[0];
}
// Load the REAL shipped predicates into an isolated vm context (same approach as
// tests/test_data_image_uri.cjs — no eval/new Function; the slice is repo source,
// not external input). cssUrl/cssColor/CSS_COLOR_OK are loaded here too (v12.66).
let api;
try {
  const reject = grab(/const CSS_FETCH_SCHEME = .+;/, "CSS_FETCH_SCHEME") + "\n" +
          grab(/const STYLE_VALUE_REJECT = .+;/, "STYLE_VALUE_REJECT");
  const key = grab(/const CSS_COLOR_KEY = .+;/, "CSS_COLOR_KEY");
  // Shared value filter the three key-pattern scrubbers delegate to (v13.25).
  const shared = grab(/function scrubCssFields\(obj, keyMatches\)\s*\{[\s\S]*?\n\}/, "scrubCssFields");
  const fn = grab(/function scrubColorFields\(obj\)\s*\{[\s\S]*?\n\}/, "scrubColorFields");
  const lkey = grab(/const CSS_LAYOUT_KEY = .+;/, "CSS_LAYOUT_KEY");
  const lfn = grab(/function scrubLayoutFields\(obj\)\s*\{[\s\S]*?\n\}/, "scrubLayoutFields");
  const ckey = grab(/const CSS_COLOR_OK = .+;/, "CSS_COLOR_OK");
  const cu = grab(/function cssUrl\(u\)\s*\{[\s\S]*?\n\}/, "cssUrl");
  const cc = grab(/function cssColor\(c\)\s*\{[\s\S]*?\n\}/, "cssColor");
  // v13.26 (F-1/F-11/F-13 fix): the gradient encoder + the paint-key scrubber
  // (used for CSS_PAINT_KEY-matched sub-object keys via scrubSubObject).
  const gkey = grab(/const CSS_GRADIENT_OK = .+;/, "CSS_GRADIENT_OK");
  const cg = grab(/function cssGradient\(g\)\s*\{[\s\S]*?\n\}/, "cssGradient");
  const pkey = grab(/const CSS_PAINT_KEY = .+;/, "CSS_PAINT_KEY");
  const stem = grab(/const cssKeyStem = .+;/, "cssKeyStem");
  const pfn = grab(/function scrubPaintFields\(obj\)\s*\{[\s\S]*?\n\}/, "scrubPaintFields");
  const ctx = { module: { exports: {} } };
  vm.createContext(ctx);
  vm.runInContext(
    [reject, key, shared, fn, lkey, lfn, ckey, cu, cc, gkey, cg, pkey, stem, pfn,
      "module.exports = { scrubColorFields, scrubLayoutFields, scrubPaintFields, STYLE_VALUE_REJECT, CSS_COLOR_KEY, CSS_LAYOUT_KEY, CSS_PAINT_KEY, cssUrl, cssColor, cssGradient };"].join("\n"),
    ctx, { filename: "part-imports-slice.js" });
  api = ctx.module.exports;
} catch (e) {
  console.log("\n  " + pass + " passed, " + failCount + " failed");
  process.exit(1);
}
const { scrubColorFields, scrubLayoutFields, scrubPaintFields, STYLE_VALUE_REJECT, cssUrl, cssColor, cssGradient } = api;

// Every color/background scalar field reported across slide/block/item/cell/branding.
const COLOR_FIELDS = [
  // slide
  "bg", "bgGradient", "color", "accent", "mutedColor",
  // block
  "border", "iconBg", "headerBg", "trackColor", "dotColor", "lineColor",
  "numberColor", "labelColor", "titleColor", "textColor", "iconColor",
  "borderColor", "gateColor", "loopColor", "arrowColor", "annotationColor",
  // item / grid cell / branding
  "footerBg", "accentColor", "footerColor",
];

// Values that MUST be stripped (each would auto-load an external resource).
const MALICIOUS = [
  "url(https://a.invalid/x)",
  'url("//a.invalid/x")',
  "url(\t//a.invalid)",
  'image-set("https://a.invalid" 1x)',
  'image("https://a.invalid")',
  "cross-fade(url(https://a.invalid), red)",
  'src("https://a.invalid")',
  '-webkit-image-set("https://a.invalid" 1x)',
  "https://a.invalid/beacon",
  'expression(alert(1))',
  '@import "https://a.invalid"',
  // v12.66: CSS-comment token-splitting — a comment (not just whitespace) between
  // the function name and its '('/quoted arg slips a string-source URL past the
  // fnStr/`://` checks (protocol-relative `//host` carries no `://`).
  'image-set(/**/"//a.invalid" 1x)',
  'image(/**/"//a.invalid")',
  'src(/* */"//a.invalid")',
  'cross-fade(/**/"//a.invalid", red)',
  '-webkit-image-set(/**/"//a.invalid" 1x)',
  'url/**/("//a.invalid")',
  "url/**/(//a.invalid)",
];

// Values that MUST survive untouched (legitimate colors / gradients).
const LEGIT = [
  "#0f172a", "#fff", "red", "rgb(15,23,42)", "rgba(0,0,0,0.35)",
  "hsl(210, 50%, 20%)", "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
  "radial-gradient(circle, #ffffff, #000000)", "1px solid #334155",
];

// 1. Every color field strips every malicious value.
for (const f of COLOR_FIELDS) {
  let leaked = null;
  for (const v of MALICIOUS) {
    const o = { [f]: v };
    scrubColorFields(o);
    if (f in o) { leaked = v; break; }
  }
  if (leaked === null) ok("scrubColorFields strips auto-load values on `" + f + "`");
  else bad("`" + f + "` exfil not stripped", JSON.stringify(leaked));
}

// 2. Every color field preserves every legitimate color/gradient.
for (const f of COLOR_FIELDS) {
  let dropped = null;
  for (const v of LEGIT) {
    const o = { [f]: v };
    scrubColorFields(o);
    if (o[f] !== v) { dropped = v; break; }
  }
  if (dropped === null) ok("scrubColorFields preserves legit colors on `" + f + "`");
  else bad("`" + f + "` dropped a legit value", JSON.stringify(dropped));
}

// 3. Non-color keys are never touched (text/title sanitized elsewhere; a literal
//    "url(" inside body text must not be deleted by this pass).
{
  const o = { text: "see url(https://example.com)", title: "Q1", type: "callout", borderStyle: "solid" };
  const before = JSON.stringify(o);
  scrubColorFields(o);
  if (JSON.stringify(o) === before) ok("scrubColorFields leaves non-color keys untouched");
  else bad("non-color key mutated", before + " -> " + JSON.stringify(o));
}

// 4. Length cap: an over-long color value is dropped (no smuggling past 500 chars).
{
  const o = { bg: "#" + "a".repeat(600) };
  scrubColorFields(o);
  if (!("bg" in o)) ok("scrubColorFields drops over-long (>500) color values");
  else bad("over-long color value kept");
}

// 5. Canonical filter is function-name-agnostic (the v12.59 image-set bypass class)
//    AND does not regress legitimate quoted block.style values (fontFamily).
{
  const mustReject = ['image-set("x")', 'image("x")', 'cross-fade("x")', 'src("x")', "url(x)", "EXPRESSION(1)",
    // v12.66: comment token-splitting must be rejected on the style/color surface.
    'image-set(/**/"//x" 1x)', 'image(/**/"//x")', 'src(/* */"//x")', 'url/**/("//x")', "url/**/(//x)",
    // v13.46: var() indirection. A custom property is substituted at computed-value
    // time — after every lexical alternative above has been evaluated — so an
    // indirected value can re-assemble a primitive none of them matched. This
    // surface must reject the load half for the same reason isSvgStyleSafe does.
    "image-set(var(--p) 1x)", "var(--p)", "VAR( --p )", "linear-gradient(var(--p),#000)"];
  const mustAllow = ['"Times New Roman", serif', "0 2px 4px rgba(0,0,0,.3)", "rgba(0,0,0,.5)", "#abc",
    "calc(100% - 8px)", "1px solid #ccc", "linear-gradient(90deg,#fff 0%,#000 100%)"];
  const r1 = mustReject.filter((v) => !STYLE_VALUE_REJECT.test(v));
  const r2 = mustAllow.filter((v) => STYLE_VALUE_REJECT.test(v));
  if (r1.length === 0) ok("STYLE_VALUE_REJECT catches every string-source CSS function (name-agnostic)");
  else bad("STYLE_VALUE_REJECT missed a loader", JSON.stringify(r1));
  if (r2.length === 0) ok("STYLE_VALUE_REJECT preserves legit quoted values (fontFamily/shadow unbroken)");
  else bad("STYLE_VALUE_REJECT false-positive on legit value", JSON.stringify(r2));
}

// 6. The fix routes through one shared filter (no duplicate CSS reject regex).
if (!/CSS_LOAD_REJECT/.test(src)) ok("no duplicate CSS reject regex (single canonical STYLE_VALUE_REJECT)");
else bad("duplicate CSS reject regex present", "CSS_LOAD_REJECT should be folded into STYLE_VALUE_REJECT");

// ── v12.66: CSS-context output encoders + matrix-quadrant scrub ──────────────
// Defense-in-depth: deck values placed into an inline CSS url()/color position are
// output-encoded so they cannot break out of that position even if a value-level
// guard is missed; and the matrix block's separate `quadrants` color array (which
// the import scrub previously never visited) is now scrubbed like `items`.
// cssUrl: result is always a single quoted url(); embedded quotes/backslashes are
// escaped and newlines removed, so a value can't terminate the string early.
{
  // The breakout probe deliberately carries NO fetching scheme: cssUrl now also
  // fails closed on one (asserted separately below), which would short-circuit
  // this case and stop it from exercising the escaping it exists to test.
  const breakout = 'data:image/png;base64,AAAA) , url(#x)';
  const u = cssUrl(breakout);
  const innerQuotesEscaped = /^url\("(?:[^"\\]|\\.)*"\)$/.test(u);
  // Reconstruct cssUrl's escaping the same way it does (backslash first, then quote)
  // so the comparison is correct for any input — incl. backslashes.
  if (innerQuotesEscaped && u.includes(breakout.replace(/\\/g, "\\\\").replace(/"/g, '\\"'))) ok("cssUrl wraps value in one escaped quoted url()");
  else bad("cssUrl did not safely encode", JSON.stringify(u));
  if (cssUrl('a"b\\c') === 'url("a\\"b\\\\c")') ok("cssUrl escapes embedded quote and backslash");
  else bad("cssUrl escaping wrong", JSON.stringify(cssUrl('a"b\\c')));
  // v13.46: cssUrl is an encoder, not a validator — quoting preserves a well-formed
  // absolute URL intact. The helper table sends future authors here for any url()
  // position, so it fails closed on a fetching scheme (with and without the
  // authority slashes) rather than faithfully encoding a beacon. data: is the one
  // scheme legitimately used in a url() here and must survive.
  {
    // (`//host` carries no scheme token and is caught upstream by
    // STYLE_VALUE_REJECT; this encoder gates the scheme-bearing forms.)
    const fetching = ["https://a.invalid/b", "https:a.invalid/b", "HTTP://a.invalid", "file:/etc/x", "ftp://a.invalid", "wss://a.invalid"];
    const leaked = fetching.filter((v) => cssUrl(v) !== 'url("")');
    if (leaked.length === 0) ok("cssUrl fails closed on a network-fetching scheme (slashless form too)");
    else bad("cssUrl encoded a fetching URL", JSON.stringify(leaked));
    if (cssUrl("data:image/png;base64,AAAA") === 'url("data:image/png;base64,AAAA")') ok("cssUrl preserves inline data:image (the legitimate url() payload)");
    else bad("cssUrl broke data:image", JSON.stringify(cssUrl("data:image/png;base64,AAAA")));
  }
  if (cssUrl("a\nb\r\fc").indexOf("\n") === -1) ok("cssUrl strips newlines");
  else bad("cssUrl kept a newline");

  // cssColor: pass strict color tokens, reject anything that could load/break out.
  const colorsOk = ["#3b82f6", "#fff", "#11223344", "red", "transparent", "rgb(1,2,3)", "rgba(0,0,0,0.5)", "hsl(210,50%,20%)"];
  const colorsBad = ["url(https://evil.example) /*", "url(https://evil.example)", "red;background:url(x)", "#fff<svg>", "/* */", "rgb(1)\turl(x)", ""];
  const okMiss = colorsOk.filter((v) => cssColor(v) !== v);
  const badPass = colorsBad.filter((v) => cssColor(v) !== "");
  if (okMiss.length === 0) ok("cssColor preserves legit color tokens");
  else bad("cssColor dropped a legit color", JSON.stringify(okMiss));
  if (badPass.length === 0) ok("cssColor rejects url()/comment/breakout values");
  else bad("cssColor let a non-color through", JSON.stringify(badPass));
}

// Matrix quadrant color is scrubbed by the same predicate as items[].color.
{
  const q = { title: "Q1", color: "url(https://evil.example) /*", icon: "Star" };
  scrubColorFields(q);
  if (!("color" in q) && q.title === "Q1" && q.icon === "Star") ok("scrubColorFields strips a quadrant color, keeps siblings");
  else bad("quadrant color not scrubbed", JSON.stringify(q));
}

// v12.71: scrubLayoutFields strips CSS auto-load / context-break primitives from
// the non-color layout scalars (padding/borderRadius/maxWidth/gap/…) that some
// block renderers spread raw into inline style, while preserving legit values.
{
  const cell = {
    padding: "0;background:url('https://evil.example/p')",
    borderRadius: "8px;background:url(https://evil.example/b)",
    maxWidth: "url('https://evil.example/m')",
    gap: "12px",                 // legit — must survive
    borderRadius2: "ignored",    // non-layout key — untouched
  };
  scrubLayoutFields(cell);
  if (!("padding" in cell) && !("borderRadius" in cell) && !("maxWidth" in cell)
      && cell.gap === "12px" && cell.borderRadius2 === "ignored")
    ok("scrubLayoutFields strips url()/injection in layout scalars, keeps legit + non-layout keys");
  else bad("scrubLayoutFields wrong", JSON.stringify(cell));

  // feature transparency: common legitimate length values are never dropped
  const legit = { padding: "16px 20px", borderRadius: "12px", maxWidth: "calc(100% - 8px)", margin: "0 auto", height: "100%" };
  const before = JSON.stringify(legit);
  scrubLayoutFields(legit);
  if (JSON.stringify(legit) === before) ok("scrubLayoutFields preserves all legitimate layout values");
  else bad("scrubLayoutFields dropped a legit value", JSON.stringify(legit));
}

// Wiring guards: the sinks/import path actually route through the new guards.
// Sub-objects (items / grid cells / quadrants / nested points) are now hardened
// recursively via scrubSubObject, which drops `_` keys and runs
// scrubColorFields/scrubLayoutFields/sanitizeStyle at every level.
if (/scrubLayoutFields\(clean\)/.test(src) && /if \(Array\.isArray\(clean\.items\)\) scrubSubObject\(clean\.items\);/.test(src))
  ok("sanitizeBlock wires scrubLayoutFields on block + items (recursive scrubSubObject)");
else bad("sanitizeBlock does not wire scrubLayoutFields on block/items");
if (/if \(Array\.isArray\(clean\.quadrants\)\) scrubSubObject\(clean\.quadrants\);/.test(src))
  ok("sanitizeBlock scrubs block.quadrants (color + layout via scrubSubObject)");
else bad("sanitizeBlock does not scrub quadrants (wiring missing)");
// scrubSubObject itself must apply both scrubbers and drop the `_` namespace.
if (/function scrubSubObject\(/.test(src) &&
    /scrubColorFields\(obj\)/.test(src) && /scrubLayoutFields\(obj\)/.test(src) &&
    /charCodeAt\(0\) === 95/.test(src))
  ok("scrubSubObject applies color+layout scrubbers and drops the `_` namespace");
else bad("scrubSubObject missing scrubber/`_`-drop wiring");
{
  // SlideContent (bgImage) lives in part-canvas.jsx; the matrix block renderer
  // (qd.color) stays in part-blocks.jsx — read both (see part-blocks.jsx's
  // SlideContent/BrandingOverlay/renderBlockItem split, part-canvas.jsx).
  const BLOCKS = path.join(__dirname, "..", "src", "parts", "part-blocks.jsx");
  const CANVAS = path.join(__dirname, "..", "src", "parts", "part-canvas.jsx");
  const bsrc = fs.readFileSync(BLOCKS, "utf8") + fs.readFileSync(CANVAS, "utf8");
  if (/backgroundImage = cssUrl\(slide\.bgImage\)/.test(bsrc)) ok("bgImage render sink uses cssUrl()");
  else bad("bgImage sink not routed through cssUrl (wiring missing)");
  if (/cssColor\(qd\.color\)/.test(bsrc)) ok("matrix quadrant color sink uses cssColor()");
  else bad("matrix color sink not routed through cssColor (wiring missing)");
}
// 7. v12.66: the SVG <style>/presentation-attr filter (isSvgStyleSafe) shares the
//    comment-smuggle defense. Extract the REAL predicate and assert it rejects the
//    token-split image-set/url comment payloads while preserving legit url(#fragment)
//    paint-server refs and plain colors. (Same root-cause bug as the color surface;
//    both surfaces fixed together so they can't drift.)
{
  let isSvgStyleSafe, isSvgInlineStyleSafe;
  try {
    // Extract every helper the predicates close over. A missing one would throw at
    // CALL time, inside the .filter() below and outside this try — so extract-time
    // success is not by itself proof the predicate runs; the liveness assertion
    // right after this block is.
    const fn = [
      grab(/const CSS_FETCH_SCHEME = .+;/, "CSS_FETCH_SCHEME"),
      grab(/const SVG_STYLE_PROPS = new Set\(\[[\s\S]*?\]\);/, "SVG_STYLE_PROPS"),
      grab(/function isSvgStyleSafe\(css\)\s*\{[\s\S]*?\n\}/, "isSvgStyleSafe"),
      grab(/function isSvgInlineStyleSafe\(css\)\s*\{[\s\S]*?\n\}/, "isSvgInlineStyleSafe"),
    ].join("\n");
    // eslint-disable-next-line no-new-func
    const api = new Function(fn + "\nreturn { isSvgStyleSafe, isSvgInlineStyleSafe };")();
    isSvgStyleSafe = api.isSvgStyleSafe;
    isSvgInlineStyleSafe = api.isSvgInlineStyleSafe;
  } catch (e) { isSvgStyleSafe = null; }
  if (typeof isSvgStyleSafe !== "function") {
    bad("extract isSvgStyleSafe", "not found in part-imports.jsx");
  } else {
    const svgReject = [
      'background-image:image-set(/**/"//a.invalid" 1x)',
      'fill:image(/**/"//a.invalid")',
      'background:src(/* */"//a.invalid")',
      'background:url/**/("//a.invalid")',
      "background:url/**/(//a.invalid)",
      'background:cross-fade(/**/"//a.invalid", red)',
      // v13.46: custom-property indirection (substitution happens after every
      // lexical check) and an authority written without its slashes (the URL
      // parser canonicalizes `https:host/p` for the special schemes).
      '--p:"https:a.invalid/b"',
      "background-image:image-set(var(--p) 1x)",
      "fill:url(var(--p))",
      "background-image:url(https:a.invalid/b)",
      'background-image:image-set("https:a.invalid/b" 1x)',
    ];
    const svgAllow = [
      "fill:url(#grad)", "fill:#3b82f6", "stroke:rgb(1,2,3)",
      "fill:url( #grad )", "stop-color:red",
    ];
    const sr = svgReject.filter((v) => isSvgStyleSafe(v));      // should all be false
    const sa = svgAllow.filter((v) => !isSvgStyleSafe(v));      // should all be true
    if (sr.length === 0) ok("isSvgStyleSafe rejects CSS-comment token-split string-source URLs");
    else bad("isSvgStyleSafe accepted a comment-smuggle payload", JSON.stringify(sr));
    if (sa.length === 0) ok("isSvgStyleSafe preserves legit url(#fragment) paint servers + colors");
    else bad("isSvgStyleSafe dropped a legit value", JSON.stringify(sa));
    // Any CSS comment is rejected outright (the token-splitting primitive).
    if (!isSvgStyleSafe("fill:/**/red")) ok("isSvgStyleSafe rejects any CSS comment outright");
    else bad("isSvgStyleSafe allowed a CSS comment");

    // v13.46: style="" is a declaration LIST, so the PROPERTY half is allowlisted
    // too — an image-loading or overlay property is rejected on its name alone,
    // independently of any value cleverness (defense in depth against the next
    // value-filter bypass). Whole-attribute rejection: fail closed, never filter.
    if (typeof isSvgInlineStyleSafe !== "function") {
      bad("extract isSvgInlineStyleSafe", "not found in part-imports.jsx");
    } else {
      const propReject = [
        "background-image:url(#a)", "background:red", "mask-image:url(#a)",
        "border-image:url(#a)", "list-style-image:url(#a)",
        "offset-path:url(#a)", "shape-outside:url(#a)", "content:'x'",
        "transform:scale(500)", "position:fixed", "fill:red;background-image:url(#a)",
      ];
      const propAllow = [
        "fill:#3b82f6", "fill:url(#grad);stroke:#888;stroke-width:2",
        "font-family:Inter,sans-serif;font-size:14px;text-anchor:middle",
        "opacity:0.5;mix-blend-mode:multiply", "clip-path:url(#c);mask:url(#m);filter:url(#f)",
        "fill:red;", " stroke : blue ", "cursor:pointer", "fill:url(#grad--blue)",
        "text-transform:uppercase;text-shadow:0 1px 2px #000", "line-height:1.4",
      ];
      const pr = propReject.filter((v) => isSvgInlineStyleSafe(v));
      const pa = propAllow.filter((v) => !isSvgInlineStyleSafe(v));
      if (pr.length === 0) ok("isSvgInlineStyleSafe allowlists inline-style properties (image/overlay families rejected)");
      else bad("isSvgInlineStyleSafe accepted a non-paint property", JSON.stringify(pr));
      if (pa.length === 0) ok("isSvgInlineStyleSafe preserves legitimate SVG paint/text declarations");
      else bad("isSvgInlineStyleSafe dropped a legit declaration", JSON.stringify(pa));
    }
  }
}

// ── Phase 2: --vera-accent CSS custom property (accent → setProperty sink) ──
// The "Vera is working" sweep (part-slidepanel.jsx wrapper) sets --vera-accent from
// the slide's `accent` field; two rules (part-imports.jsx .vera-thinking::before/
// ::after) consume it via color-mix(in srgb, var(--vera-accent,#3b82f6) N%,
// transparent). This walks hostile accent values through the REAL sanitizeSlide
// (import-time scrub) THEN the REAL cssColor() encoder (the render-site gate now
// wired at the --vera-accent assignment) THEN a REAL DOM
// CSSStyleDeclaration.setProperty call (jsdom) — the actual sequence of calls the
// shipped code makes — asserting: no network-triggering global is ever invoked,
// and the value that lands on the custom property can never carry a url()/
// string-source/var()-laundering/comment token into the color-mix() consumer.
// sanitizeSlide's other branches (blocks/comments/studyNotes/bgImage/…) are never
// entered for an accent-only input, so this needs no further dependencies.
{
  let JSDOM;
  try { JSDOM = require("jsdom").JSDOM; }
  catch (e) { try { JSDOM = require("/tmp/node_modules/jsdom").JSDOM; } catch (_) { JSDOM = null; } }

  if (!JSDOM) {
    bad("--vera-accent DOM sink suite", "jsdom not installed (run: npm i jsdom)");
  } else {
    let sanitizeSlide, cssColorSlide;
    try {
      const ssFn = grab(/function sanitizeSlide\(slide\)\s*\{[\s\S]*?\n\}/, "sanitizeSlide");
      const ctx2 = { module: { exports: {} } };
      vm.createContext(ctx2);
      vm.runInContext(
        [grab(/const SAFE_SLIDE_KEYS = new Set\(\[[\s\S]*?\]\);/, "SAFE_SLIDE_KEYS (slide)"),
          grab(/const SLIDE_NUMERIC_BOUNDS = \{[\s\S]*?\n\};/, "SLIDE_NUMERIC_BOUNDS (slide)"),
          grab(/function clampDeckNumber\([\s\S]*?\n\}/, "clampDeckNumber (slide)"),
          grab(/const CSS_FETCH_SCHEME = .+;/, "CSS_FETCH_SCHEME") + "\n" +
          grab(/const STYLE_VALUE_REJECT = .+;/, "STYLE_VALUE_REJECT (slide)"),
          grab(/const CSS_COLOR_KEY = .+;/, "CSS_COLOR_KEY (slide)"),
          grab(/const CSS_LAYOUT_KEY = .+;/, "CSS_LAYOUT_KEY (slide)"),
          grab(/function scrubCssFields\(obj, keyMatches\)\s*\{[\s\S]*?\n\}/, "scrubCssFields (slide)"),
          grab(/function scrubColorFields\(obj\)\s*\{[\s\S]*?\n\}/, "scrubColorFields (slide)"),
          grab(/function scrubLayoutFields\(obj\)\s*\{[\s\S]*?\n\}/, "scrubLayoutFields (slide)"),
          grab(/const CSS_COLOR_OK = .+;/, "CSS_COLOR_OK (slide)"),
          grab(/function cssColor\(c\)\s*\{[\s\S]*?\n\}/, "cssColor (slide)"),
          ssFn,
          "module.exports = { sanitizeSlide, cssColor };"].join("\n"),
        ctx2, { filename: "part-imports-slice-slide.js" });
      sanitizeSlide = ctx2.module.exports.sanitizeSlide;
      cssColorSlide = ctx2.module.exports.cssColor;
      ok("extracted real sanitizeSlide + cssColor for --vera-accent suite");
    } catch (e) {
      bad("extract sanitizeSlide for --vera-accent suite", e.message);
    }

    if (sanitizeSlide && cssColorSlide) {
      const FALLBACK = "#3b82f6"; // mirrors the @property initial-value / var() fallback
      const FORBIDDEN = /url\(|@import|image-set|image\(|cross-fade|src\(|expression\(|var\(|\/\*|[<>;]/i;

      // Render-site sequence, reproduced exactly: sanitizeSlide (import-time) ->
      // cssColor() (render-site encoder) -> DOM setProperty (the real sink call).
      function renderAccent(dom, accent) {
        const clean = sanitizeSlide({ accent });
        const value = cssColorSlide(clean && clean.accent) || FALLBACK;
        const el = dom.window.document.getElementById("w");
        el.style.setProperty("--vera-accent", value);
        return el.style.getPropertyValue("--vera-accent");
      }

      // Hostile accent values, one per required category, plus a plain-valid color.
      const HOSTILE = {
        "url()-bearing": 'url(https://a.invalid/x)',
        "var()-laundering": 'var(--user-controlled, url(https://a.invalid/x))',
        "image-set": 'image-set("https://a.invalid" 1x)',
      };

      for (const [label, payload] of Object.entries(HOSTILE)) {
        const dom = new JSDOM("<!doctype html><div id='w'></div>");
        const netCalls = { fetch: 0, xhr: 0, image: 0 };
        dom.window.fetch = (...a) => { netCalls.fetch++; return Promise.reject(new Error("blocked")); };
        const RealXHR = dom.window.XMLHttpRequest;
        dom.window.XMLHttpRequest = function () {
          const x = new RealXHR();
          const realOpen = x.open.bind(x);
          x.open = (...a) => { netCalls.xhr++; return realOpen(...a); };
          return x;
        };
        dom.window.Image = function () {
          const img = {};
          Object.defineProperty(img, "src", { set() { netCalls.image++; }, get() { return ""; } });
          return img;
        };

        const stored = renderAccent(dom, payload);

        if (stored === FALLBACK) ok(`--vera-accent(${label}): hostile accent value falls back to the safe default`);
        else bad(`--vera-accent(${label}): did not fall back`, JSON.stringify(stored));

        if (!FORBIDDEN.test(stored)) ok(`--vera-accent(${label}): stored value carries no CSS auto-load/breakout token`);
        else bad(`--vera-accent(${label}): stored value contains a forbidden token`, JSON.stringify(stored));

        if (netCalls.fetch === 0 && netCalls.xhr === 0 && netCalls.image === 0)
          ok(`--vera-accent(${label}): no network-triggering global invoked`);
        else bad(`--vera-accent(${label}): a network global fired`, JSON.stringify(netCalls));
      }

      // Plain-valid color: survives sanitizeSlide, survives cssColor(), lands on the
      // custom property unchanged — the fix must not regress the legitimate path.
      {
        const dom = new JSDOM("<!doctype html><div id='w'></div>");
        const netCalls = { fetch: 0 };
        dom.window.fetch = (...a) => { netCalls.fetch++; return Promise.reject(new Error("blocked")); };
        const LEGIT = "#3b82f6";
        const stored = renderAccent(dom, LEGIT);
        if (stored === LEGIT) ok("--vera-accent(plain-valid-color): passes through unchanged");
        else bad("--vera-accent(plain-valid-color): value altered/dropped", JSON.stringify(stored));
        if (netCalls.fetch === 0) ok("--vera-accent(plain-valid-color): no network-triggering global invoked");
        else bad("--vera-accent(plain-valid-color): fetch fired for a legit color", JSON.stringify(netCalls));
      }

      // The color-mix() consumer strings themselves (part-imports.jsx getCss()) are
      // static template text with only var(--vera-accent, #hex) substitution points —
      // never string-concatenated with the deck value — so a safe stored token (as
      // asserted above) cannot alter the declaration's structure. Pin that the two
      // consumer sites keep their hard-coded var() fallback (belt, per 2.3) and that
      // the property is CSS type-registered (per 2.2) so a value reaching the DOM by
      // any other path than this render site is still constrained at the CSS layer.
      if (/@property --vera-accent\{syntax:"<color>";inherits:true;initial-value:#3b82f6\}/.test(src))
        ok("--vera-accent is CSS type-registered via @property (syntax:\"<color>\", inherits:true)");
      else bad("--vera-accent @property registration missing/changed shape");
      const consumerSites = src.match(/var\(--vera-accent,#3b82f6\)/g) || [];
      if (consumerSites.length >= 2) ok("both color-mix() consumer sites keep their var(--vera-accent, #hex) fallback");
      else bad("--vera-accent consumer var() fallback missing at one or both sites", String(consumerSites.length));
    }
  }
}

// ── v13.26: F-1 fail-closed TYPE fuzz ─────────────────────────────────────
// The root-cause bug: scrubCssFields SKIPPED (not deleted) a non-string value
// on a matched CSS key, so an array/boxed-String/{toString}/{valueOf}/boolean
// payload on an allowlisted key (bg, bgGradient, …) rode through verbatim into
// a raw CSS sink. The fix inverts that skip into a delete for every shape that
// can carry a CSS/URL grammar payload. Fuzz every scrubber (color/layout/paint)
// with every dangerous non-string SHAPE — not just dangerous string VALUES,
// which the pre-fix suite already covered — on a representative key from each
// pattern, and assert the key is gone.
{
  class UrlBox { constructor(v) { this._v = v; } toString() { return this._v; } valueOf() { return this._v; } }
  const TYPE_PAYLOADS = {
    "array-of-string": ["url(http://a.invalid/beacon)"],
    "boxed-String": new String("url(http://a.invalid/beacon)"),
    "toString-gadget": { toString: () => "url(http://a.invalid/beacon)" },
    "valueOf-gadget": { valueOf: () => "url(http://a.invalid/beacon)" },
    "toString+valueOf-gadget": new UrlBox("url(http://a.invalid/beacon)"),
    "nested-array": [["url(http://a.invalid/beacon)"]],
    "boolean": true,
    "plain-object": { a: 1 },
    "NaN": NaN,
    "Infinity": Infinity,
  };
  const SCRUBBERS = [
    ["scrubColorFields", scrubColorFields, ["bg", "bgGradient", "color", "accent"]],
    ["scrubLayoutFields", scrubLayoutFields, ["padding", "gap", "maxWidth"]],
    ["scrubPaintFields", scrubPaintFields, ["bg", "background", "mask", "filter"]],
  ];
  const FORBIDDEN_TOKEN = /url\(|image-set\(|@import|expression\(|var\(|attr\(/i;
  for (const [scrubberName, scrubber, keys] of SCRUBBERS) {
    for (const key of keys) {
      for (const [shapeName, payload] of Object.entries(TYPE_PAYLOADS)) {
        const o = { [key]: payload, sibling: "kept" };
        scrubber(o);
        if (!(key in o)) ok(`${scrubberName}: drops non-string/non-finite-number \`${key}\` (${shapeName})`);
        else bad(`${scrubberName}: \`${key}\` (${shapeName}) survived`, JSON.stringify(o[key]));
        if (o.sibling === "kept") ok(`${scrubberName}: leaves sibling key untouched (${key}/${shapeName})`);
        else bad(`${scrubberName}: clobbered sibling key (${key}/${shapeName})`);
        // Belt-and-suspenders: whatever remains on the object must not itself
        // stringify to a fetching primitive (covers a scrubber bug that stored
        // a coerced string instead of deleting the key).
        if (!FORBIDDEN_TOKEN.test(JSON.stringify(o)))
          ok(`${scrubberName}: object carries no fetching primitive after scrub (${key}/${shapeName})`);
        else bad(`${scrubberName}: residual fetching primitive in scrubbed object`, JSON.stringify(o));
      }
      // A finite number is the one non-string shape the app legitimately uses on
      // these SAME key names (block.gap/height/spacing/maxWidth are plain px
      // numbers) — it can never carry a `url(` token, so it must survive
      // unchanged rather than being deleted like every other non-string shape.
      const numObj = { [key]: 42 };
      scrubber(numObj);
      if (numObj[key] === 42) ok(`${scrubberName}: preserves a legitimate finite number on \`${key}\``);
      else bad(`${scrubberName}: dropped a legitimate finite number on \`${key}\``, JSON.stringify(numObj));
    }
  }
}

// ── v13.26: cssGradient encoder (bgGradient's sibling to cssColor) ────────
{
  const gradOk = [
    "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
    "radial-gradient(circle, #ffffff, #000000)",
    "conic-gradient(from 90deg, red, yellow, green)",
    "repeating-linear-gradient(45deg, #000, #000 10px, #fff 10px, #fff 20px)",
    "linear-gradient(to right, rgba(0,0,0,0.5), rgba(255,255,255,0.5))",
  ];
  const gradBad = [
    'linear-gradient(url(https://a.invalid/x))',
    'linear-gradient(45deg, red), url(https://a.invalid/x)',
    "linear-gradient(45deg, red)/* */",
    "url(https://a.invalid/x)",
    "javascript:alert(1)",
    "",
    ["linear-gradient(45deg, red)"],   // wrong type — String() coercion must not smuggle an array through
  ];
  const gOkMiss = gradOk.filter((v) => cssGradient(v) !== v);
  const gBadPass = gradBad.filter((v) => cssGradient(v) !== "");
  if (gOkMiss.length === 0) ok("cssGradient preserves legit linear/radial/conic gradients");
  else bad("cssGradient dropped a legit gradient", JSON.stringify(gOkMiss));
  if (gBadPass.length === 0) ok("cssGradient rejects url()/comment/non-gradient/array values");
  else bad("cssGradient let a dangerous value through", JSON.stringify(gBadPass));
}

// ── v13.26: bg/bgGradient array-payload end-to-end via the real sanitizeSlide ──
// The exact F-1 PoC shape, run through the shipped ingress function (not just
// the scrubber it calls internally) — confirms the whole slide-sanitization
// path drops the array payload, independent of the jsdom-gated suite below.
{
  let sanitizeSlideStandalone;
  try {
    const ctx4 = { module: { exports: {} } };
    vm.createContext(ctx4);
    vm.runInContext(
      [grab(/const SAFE_SLIDE_KEYS = new Set\(\[[\s\S]*?\]\);/, "SAFE_SLIDE_KEYS (bg-e2e)"),
        grab(/const SLIDE_NUMERIC_BOUNDS = \{[\s\S]*?\n\};/, "SLIDE_NUMERIC_BOUNDS (bg-e2e)"),
        grab(/function clampDeckNumber\([\s\S]*?\n\}/, "clampDeckNumber (bg-e2e)"),
        grab(/function sanitizeString\([\s\S]*?\n\}/, "sanitizeString (bg-e2e)"),
        grab(/const CSS_FETCH_SCHEME = .+;/, "CSS_FETCH_SCHEME") + "\n" +
          grab(/const STYLE_VALUE_REJECT = .+;/, "STYLE_VALUE_REJECT (bg-e2e)"),
        grab(/const CSS_COLOR_KEY = .+;/, "CSS_COLOR_KEY (bg-e2e)"),
        grab(/const CSS_LAYOUT_KEY = .+;/, "CSS_LAYOUT_KEY (bg-e2e)"),
        grab(/function scrubCssFields\(obj, keyMatches\)\s*\{[\s\S]*?\n\}/, "scrubCssFields (bg-e2e)"),
        grab(/function scrubColorFields\(obj\)\s*\{[\s\S]*?\n\}/, "scrubColorFields (bg-e2e)"),
        grab(/function scrubLayoutFields\(obj\)\s*\{[\s\S]*?\n\}/, "scrubLayoutFields (bg-e2e)"),
        grab(/function sanitizeSlide\(slide\)\s*\{[\s\S]*?\n\}/, "sanitizeSlide (bg-e2e)"),
        "module.exports = { sanitizeSlide };"].join("\n"),
      ctx4, { filename: "part-imports-slice-bg-e2e.js" });
    sanitizeSlideStandalone = ctx4.module.exports.sanitizeSlide;
    ok("extracted real sanitizeSlide for bg/bgGradient array-payload e2e check");
  } catch (e) {
    bad("extract sanitizeSlide for bg/bgGradient e2e check", e.message);
  }

  if (sanitizeSlideStandalone) {
    // The exact confirmed-finding PoC payload (F-1's `bg`/`bgGradient` array
    // shape). `blocks` is intentionally omitted — this slice deliberately pulls
    // in only the slide-level scrub path, not the full sanitizeBlock graph, the
    // same scoping the --vera-accent suite above uses; block-level coverage
    // lives in the TYPE-fuzz section and the full-browser proof covers the
    // real end-to-end render with blocks present.
    const poc = {
      bg: ["url(http://attacker/beacon)"],
      bgGradient: ["url(http://attacker/beacon)"],
      title: "Q1 Kickoff",
    };
    const clean = sanitizeSlideStandalone(poc);
    if (!("bg" in clean)) ok("sanitizeSlide drops an array payload on slide.bg (F-1 PoC)");
    else bad("sanitizeSlide left slide.bg as an array", JSON.stringify(clean.bg));
    if (!("bgGradient" in clean)) ok("sanitizeSlide drops an array payload on slide.bgGradient (F-1 PoC)");
    else bad("sanitizeSlide left slide.bgGradient as an array", JSON.stringify(clean.bgGradient));
    if (clean.title === "Q1 Kickoff")
      ok("sanitizeSlide preserves the rest of the slide (title) alongside the drop");
    else bad("sanitizeSlide over-dropped legitimate slide content", JSON.stringify(clean));

    // Legit bg/bgGradient must survive unchanged.
    const legitSlide = { bg: "#0f172a", bgGradient: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)" };
    const legitClean = sanitizeSlideStandalone(legitSlide);
    if (legitClean.bg === "#0f172a" && legitClean.bgGradient === legitSlide.bgGradient)
      ok("sanitizeSlide preserves legitimate hex bg + gradient bgGradient");
    else bad("sanitizeSlide altered a legitimate bg/bgGradient", JSON.stringify(legitClean));
  }
}

// ── v13.26: F-13 — sanitizeSlide now also scrubs layout scalars (padding/gap) ──
{
  try {
    const ctx5 = { module: { exports: {} } };
    vm.createContext(ctx5);
    vm.runInContext(
      [grab(/const SAFE_SLIDE_KEYS = new Set\(\[[\s\S]*?\]\);/, "SAFE_SLIDE_KEYS (F13)"),
        grab(/const SLIDE_NUMERIC_BOUNDS = \{[\s\S]*?\n\};/, "SLIDE_NUMERIC_BOUNDS (F13)"),
        grab(/function clampDeckNumber\([\s\S]*?\n\}/, "clampDeckNumber (F13)"),
        grab(/const CSS_FETCH_SCHEME = .+;/, "CSS_FETCH_SCHEME") + "\n" +
          grab(/const STYLE_VALUE_REJECT = .+;/, "STYLE_VALUE_REJECT (F13)"),
        grab(/const CSS_COLOR_KEY = .+;/, "CSS_COLOR_KEY (F13)"),
        grab(/const CSS_LAYOUT_KEY = .+;/, "CSS_LAYOUT_KEY (F13)"),
        grab(/function scrubCssFields\(obj, keyMatches\)\s*\{[\s\S]*?\n\}/, "scrubCssFields (F13)"),
        grab(/function scrubColorFields\(obj\)\s*\{[\s\S]*?\n\}/, "scrubColorFields (F13)"),
        grab(/function scrubLayoutFields\(obj\)\s*\{[\s\S]*?\n\}/, "scrubLayoutFields (F13)"),
        grab(/function sanitizeSlide\(slide\)\s*\{[\s\S]*?\n\}/, "sanitizeSlide (F13)"),
        "module.exports = { sanitizeSlide };"].join("\n"),
      ctx5, { filename: "part-imports-slice-f13.js" });
    const sanitizeSlideF13 = ctx5.module.exports.sanitizeSlide;
    const dirty = { padding: "0;background:url(http://a.invalid/x)", gap: 12 };
    const clean = sanitizeSlideF13(dirty);
    if (!("padding" in clean)) ok("sanitizeSlide (F-13) now scrubs slide.padding via scrubLayoutFields");
    else bad("sanitizeSlide (F-13) left a dangerous slide.padding", JSON.stringify(clean.padding));
  } catch (e) {
    bad("F-13 sanitizeSlide layout-scrub check", e.message);
  }
}

// ── Wiring guards: render sinks route bg/bgGradient/cell.bg/headerBg through
//    the encoders (part-blocks.jsx main render + part-slides.jsx thumbnail). ──
{
  // slide.bg/bgGradient and the grid/table/IconBubble sinks below span both
  // part-blocks.jsx (RenderBlock switch) and part-canvas.jsx (SlideContent).
  const BLOCKS = path.join(__dirname, "..", "src", "parts", "part-blocks.jsx");
  const CANVAS = path.join(__dirname, "..", "src", "parts", "part-canvas.jsx");
  const bsrc2 = fs.readFileSync(BLOCKS, "utf8") + fs.readFileSync(CANVAS, "utf8");
  if (/bgStyle\.background = c;/.test(bsrc2) && /cssColor\(slide\.bg\)/.test(bsrc2)) ok("slide.bg render sink uses cssColor()");
  else bad("slide.bg sink not routed through cssColor (wiring missing)");
  if (/cssGradient\(slide\.bgGradient\)/.test(bsrc2)) ok("slide.bgGradient render sink uses cssGradient()");
  else bad("slide.bgGradient sink not routed through cssGradient (wiring missing)");
  if (/cssColor\(cell\.bg\)/.test(bsrc2)) ok("grid cell.bg render sink uses cssColor()");
  else bad("grid cell.bg sink not routed through cssColor (wiring missing)");
  if (/cssColor\(block\.headerBg\)/.test(bsrc2)) ok("table headerBg render sink uses cssColor()");
  else bad("table headerBg sink not routed through cssColor (wiring missing)");
  if (/background: cssColor\(bg\)/.test(bsrc2)) ok("IconBubble background uses cssColor()");
  else bad("IconBubble background not routed through cssColor (wiring missing)");

  const SLIDES = path.join(__dirname, "..", "src", "parts", "part-slides.jsx");
  const ssrc2 = fs.readFileSync(SLIDES, "utf8");
  if (/cssColor\(slide\?\.bg\)\s*\|\|\s*cssGradient\(slide\?\.bgGradient\)/.test(ssrc2))
    ok("thumbnail/fullscreen bg sink uses cssColor()/cssGradient()");
  else bad("thumbnail/fullscreen bg sink not routed through the encoders (wiring missing)");
}

// ── F-11 wiring guard: the storage-load boot path re-sanitizes lanes before LOAD ──
{
  const APP = path.join(__dirname, "..", "src", "parts", "part-app.jsx");
  const appsrc = fs.readFileSync(APP, "utf8");
  const occurrences = (appsrc.match(/resanitizeLoadedLanes\(/g) || []).length;
  // 3 call sites (v3/v2/v1 branches) + the function definition itself lives in
  // part-imports.jsx, so part-app.jsx should reference it at least 3 times.
  if (occurrences >= 3) ok(`storage-load path calls resanitizeLoadedLanes on all branches (${occurrences} call sites)`);
  else bad("storage-load path missing resanitizeLoadedLanes wiring", `only ${occurrences} call site(s)`);
  const IMPORTS2 = path.join(__dirname, "..", "src", "parts", "part-imports.jsx");
  const impsrc2 = fs.readFileSync(IMPORTS2, "utf8");
  if (/function resanitizeLoadedLanes\(lanes\)/.test(impsrc2) && /item\.slides\.map\(sanitizeSlide\)/.test(impsrc2))
    ok("resanitizeLoadedLanes runs every persisted slide through sanitizeSlide");
  else bad("resanitizeLoadedLanes missing/not wired to sanitizeSlide");
}

// ── F-12 wiring guard: deckTitle re-assignment sites use the coerce+cap helper ──
{
  const IMPORTS3 = path.join(__dirname, "..", "src", "parts", "part-imports.jsx");
  const impsrc3 = fs.readFileSync(IMPORTS3, "utf8");
  if (/function sanitizeDeckTitle\(t\)/.test(impsrc3)) ok("sanitizeDeckTitle helper defined");
  else bad("sanitizeDeckTitle helper missing");
  const APP2 = path.join(__dirname, "..", "src", "parts", "part-app.jsx");
  const appsrc2 = fs.readFileSync(APP2, "utf8");
  const rawAssigns = (appsrc2.match(/\.deckTitle\s*=\s*(?!sanitizeDeckTitle)[A-Za-z]/g) || []);
  if (rawAssigns.length === 0) ok("no remaining raw (un-clamped) .deckTitle = assignment in part-app.jsx");
  else bad("raw .deckTitle assignment still present", JSON.stringify(rawAssigns));
}

// ── v13.27: branding accentColor/footerBg — the last raw-`background` sink ──
// A just-fixed adjacent bug (v13.26) made every OTHER color/background scalar
// fail-closed by type and encoder-gated at render; this residual left TWO
// branding fields (accentColor, footerBg) writing straight into a raw
// `background` shorthand with neither protection, reachable only via a
// legacy-persisted deck reloaded through the storage-load boot path (every
// live ingress — import/startup-patch/merge/SET_BRANDING — already scrubs
// branding). Two fixes, verified independently below: (1) the render sink
// itself is now encoder-gated (cssColor), so even an unscrubbed value can't
// reach `background`; (2) resanitizeLoadedBranding() re-runs the SAME
// scrubColorFields the SET_BRANDING reducer already uses, closing the
// storage-reload gap resanitizeLoadedLanes left open for `branding`.
{
  let JSDOM2;
  try { JSDOM2 = require("jsdom").JSDOM; }
  catch (e) { try { JSDOM2 = require("/tmp/node_modules/jsdom").JSDOM; } catch (_) { JSDOM2 = null; } }

  if (!JSDOM2) {
    bad("branding accentColor/footerBg suite", "jsdom not installed (run: npm i jsdom)");
  } else {
    let resanitizeLoadedBranding, cssColorB;
    try {
      const dom = new JSDOM2("<!doctype html><html><body></body></html>");
      const ctx6 = {
        DOMParser: dom.window.DOMParser, document: dom.window.document, window: dom.window,
        atob: (b) => Buffer.from(b, "base64").toString("binary"),
        module: { exports: {} },
      };
      vm.createContext(ctx6);
      vm.runInContext(
        [grab(/const SVG_ALLOWED_TAGS = new Set\(\[[\s\S]*?\]\);/, "SVG_ALLOWED_TAGS (branding)"),
          grab(/const SVG_URL_REF_ATTRS = new Set\(\[[\s\S]*?\]\);/, "SVG_URL_REF_ATTRS (branding)"),
          grab(/function isSvgStyleSafe\(css\)\s*\{[\s\S]*?\n\}/, "isSvgStyleSafe (branding)"),
          grab(/function sanitizeSvgMarkup\(raw\)\s*\{[\s\S]*?\n\}/, "sanitizeSvgMarkup (branding)"),
          grab(/const SAFE_RASTER_DATA_IMAGE = \/.*?\/i;/, "SAFE_RASTER_DATA_IMAGE (branding)"),
          grab(/function sanitizeImageDataUri\(s\)\s*\{[\s\S]*?\n\}/, "sanitizeImageDataUri (branding)"),
          grab(/const CSS_FETCH_SCHEME = .+;/, "CSS_FETCH_SCHEME") + "\n" +
          grab(/const STYLE_VALUE_REJECT = .+;/, "STYLE_VALUE_REJECT (branding)"),
          grab(/const CSS_COLOR_KEY = .+;/, "CSS_COLOR_KEY (branding)"),
          grab(/function scrubCssFields\(obj, keyMatches\)\s*\{[\s\S]*?\n\}/, "scrubCssFields (branding)"),
          grab(/function scrubColorFields\(obj\)\s*\{[\s\S]*?\n\}/, "scrubColorFields (branding)"),
          grab(/const CSS_COLOR_OK = .+;/, "CSS_COLOR_OK (branding)"),
          grab(/function cssColor\(c\)\s*\{[\s\S]*?\n\}/, "cssColor (branding)"),
          grab(/function resanitizeLoadedBranding\(branding\)\s*\{[\s\S]*?\n\}/, "resanitizeLoadedBranding"),
          "module.exports = { resanitizeLoadedBranding, cssColor };"].join("\n"),
        ctx6, { filename: "part-imports-slice-branding.js" });
      resanitizeLoadedBranding = ctx6.module.exports.resanitizeLoadedBranding;
      cssColorB = ctx6.module.exports.cssColor;
      ok("extracted real resanitizeLoadedBranding + cssColor for branding suite");
    } catch (e) {
      bad("extract resanitizeLoadedBranding for branding suite", e.message);
    }

    if (resanitizeLoadedBranding && cssColorB) {
      class UrlBox2 { constructor(v) { this._v = v; } toString() { return this._v; } }
      const HOSTILE_BRANDING = {
        "url()": "url(http://127.0.0.1:1/branding-beacon)",
        "array-of-string": ["url(http://127.0.0.1:1/branding-beacon)"],
        "toString-gadget": new UrlBox2("url(http://127.0.0.1:1/branding-beacon)"),
      };
      const FETCH_TOKEN = /url\(|image-set\(|@import|expression\(/i;

      // (a) storage-reload re-scrub neutralizes accentColor/footerBg on every hostile shape.
      for (const field of ["accentColor", "footerBg"]) {
        for (const [shape, payload] of Object.entries(HOSTILE_BRANDING)) {
          const persisted = { enabled: true, [field]: payload, footerLeft: "Acme Inc." };
          const clean = resanitizeLoadedBranding(persisted);
          if (!(field in clean) || !FETCH_TOKEN.test(String(clean[field])))
            ok(`resanitizeLoadedBranding neutralizes persisted \`${field}\` (${shape})`);
          else bad(`resanitizeLoadedBranding left a fetching \`${field}\` (${shape})`, JSON.stringify(clean[field]));
          if (clean.footerLeft === "Acme Inc.")
            ok(`resanitizeLoadedBranding preserves sibling non-style field alongside \`${field}\` (${shape})`);
          else bad(`resanitizeLoadedBranding dropped a sibling non-style field (${field}/${shape})`, JSON.stringify(clean));

          // (b) render sink is encoder-gated: even if a value slipped past the
          // scrub, the cssColor() encoder BrandingOverlay now routes through
          // independently produces no fetching output for the same payload.
          const encoded = cssColorB(payload);
          if (encoded === "") ok(`render-sink encoder cssColor() rejects the same hostile \`${field}\` payload (${shape})`);
          else bad(`render-sink encoder cssColor() let a hostile \`${field}\` payload through (${shape})`, JSON.stringify(encoded));
        }
      }

      // (c) legit branding survives untouched (hex + the default semi-transparent rgba).
      {
        const legit = { enabled: true, accentColor: "#3B82F6", footerBg: "rgba(0,0,0,0.35)", footerColor: "#94a3b8", footerLeft: "Acme Inc." };
        const clean = resanitizeLoadedBranding(legit);
        if (clean.accentColor === "#3B82F6" && clean.footerBg === "rgba(0,0,0,0.35)" && clean.footerColor === "#94a3b8" && clean.footerLeft === "Acme Inc.")
          ok("resanitizeLoadedBranding preserves legit hex accentColor + rgba footerBg unchanged");
        else bad("resanitizeLoadedBranding altered a legit branding object", JSON.stringify(clean));
        if (cssColorB(clean.accentColor) === clean.accentColor && cssColorB(clean.footerBg) === clean.footerBg)
          ok("render-sink encoder cssColor() passes the legit values through unchanged");
        else bad("render-sink encoder cssColor() altered a legit branding value");
      }

      // (d) logo (a separate <img src> fetch sink, not a CSS property) is re-clamped
      // to data:image/* on the same reload path, mirroring the import-time clamp.
      {
        const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
        const legitLogo = resanitizeLoadedBranding({ enabled: true, logo: PNG });
        if (legitLogo.logo === PNG) ok("resanitizeLoadedBranding preserves a legit data:image/* logo");
        else bad("resanitizeLoadedBranding altered a legit data:image logo", JSON.stringify(legitLogo.logo));
        const hostileLogo = resanitizeLoadedBranding({ enabled: true, logo: "http://127.0.0.1:1/logo-beacon.png" });
        if (!hostileLogo.logo) ok("resanitizeLoadedBranding strips a non-data: external logo URL");
        else bad("resanitizeLoadedBranding left an external logo URL", JSON.stringify(hostileLogo.logo));
      }
    }
  }
}

// Wiring guards: the render sink and the storage-load boot path actually call
// the new gates, not just the extracted-slice tests above.
{
  // BrandingOverlay (accentColor/footerBg) lives in part-branding.jsx.
  const BLOCKS2 = path.join(__dirname, "..", "src", "parts", "part-blocks.jsx");
  const CANVAS2 = path.join(__dirname, "..", "src", "parts", "part-canvas.jsx");
  const BRANDING2 = path.join(__dirname, "..", "src", "parts", "part-branding.jsx");
  const bsrc3 = fs.readFileSync(BLOCKS2, "utf8") + fs.readFileSync(CANVAS2, "utf8") + fs.readFileSync(BRANDING2, "utf8");
  if (/background: cssColor\(b\.accentColor\)/.test(bsrc3)) ok("branding accentColor render sink uses cssColor()");
  else bad("branding accentColor sink not routed through cssColor (wiring missing)");
  if (/cssColor\(b\.footerBg\)/.test(bsrc3)) ok("branding footerBg render sink uses cssColor()");
  else bad("branding footerBg sink not routed through cssColor (wiring missing)");

  const APP3 = path.join(__dirname, "..", "src", "parts", "part-app.jsx");
  const appsrc3 = fs.readFileSync(APP3, "utf8");
  const brandingOccurrences = (appsrc3.match(/resanitizeLoadedBranding\(/g) || []).length;
  if (brandingOccurrences >= 3) ok(`storage-load path calls resanitizeLoadedBranding on all branches (${brandingOccurrences} call sites)`);
  else bad("storage-load path missing resanitizeLoadedBranding wiring", `only ${brandingOccurrences} call site(s)`);
}

console.log("\n  " + pass + " passed, " + failCount + " failed");
process.exit(failCount ? 1 : 0);
