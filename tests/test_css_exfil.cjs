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

const IMPORTS = path.join(__dirname, "..", "tools", "vela-dev", "app", "parts", "part-imports.jsx");
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
  const reject = grab(/const STYLE_VALUE_REJECT = .+;/, "STYLE_VALUE_REJECT");
  const key = grab(/const CSS_COLOR_KEY = .+;/, "CSS_COLOR_KEY");
  const fn = grab(/function scrubColorFields\(obj\)\s*\{[\s\S]*?\n\}/, "scrubColorFields");
  const lkey = grab(/const CSS_LAYOUT_KEY = .+;/, "CSS_LAYOUT_KEY");
  const lfn = grab(/function scrubLayoutFields\(obj\)\s*\{[\s\S]*?\n\}/, "scrubLayoutFields");
  const ckey = grab(/const CSS_COLOR_OK = .+;/, "CSS_COLOR_OK");
  const cu = grab(/function cssUrl\(u\)\s*\{[\s\S]*?\n\}/, "cssUrl");
  const cc = grab(/function cssColor\(c\)\s*\{[\s\S]*?\n\}/, "cssColor");
  const ctx = { module: { exports: {} } };
  vm.createContext(ctx);
  vm.runInContext(
    [reject, key, fn, lkey, lfn, ckey, cu, cc,
      "module.exports = { scrubColorFields, scrubLayoutFields, STYLE_VALUE_REJECT, CSS_COLOR_KEY, CSS_LAYOUT_KEY, cssUrl, cssColor };"].join("\n"),
    ctx, { filename: "part-imports-slice.js" });
  api = ctx.module.exports;
} catch (e) {
  console.log("\n  " + pass + " passed, " + failCount + " failed");
  process.exit(1);
}
const { scrubColorFields, scrubLayoutFields, STYLE_VALUE_REJECT, cssUrl, cssColor } = api;

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
    'image-set(/**/"//x" 1x)', 'image(/**/"//x")', 'src(/* */"//x")', 'url/**/("//x")', "url/**/(//x)"];
  const mustAllow = ['"Times New Roman", serif', "0 2px 4px rgba(0,0,0,.3)", "rgba(0,0,0,.5)", "#abc"];
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
  const breakout = 'data:image/png;base64,AAAA) , url(https://evil.example)';
  const u = cssUrl(breakout);
  const innerQuotesEscaped = /^url\("(?:[^"\\]|\\.)*"\)$/.test(u);
  // Reconstruct cssUrl's escaping the same way it does (backslash first, then quote)
  // so the comparison is correct for any input — incl. backslashes.
  if (innerQuotesEscaped && u.includes(breakout.replace(/\\/g, "\\\\").replace(/"/g, '\\"'))) ok("cssUrl wraps value in one escaped quoted url()");
  else bad("cssUrl did not safely encode", JSON.stringify(u));
  if (cssUrl('a"b\\c') === 'url("a\\"b\\\\c")') ok("cssUrl escapes embedded quote and backslash");
  else bad("cssUrl escaping wrong", JSON.stringify(cssUrl('a"b\\c')));
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
if (/scrubLayoutFields\(clean\)/.test(src) && /for \(const it of clean\.items\) \{ scrubColorFields\(it\); scrubLayoutFields\(it\); \}/.test(src))
  ok("sanitizeBlock wires scrubLayoutFields on block + items");
else bad("sanitizeBlock does not wire scrubLayoutFields on block/items");
if (/Array\.isArray\(clean\.quadrants\)/.test(src) && /for \(const q of clean\.quadrants\) \{ scrubColorFields\(q\); scrubLayoutFields\(q\); \}/.test(src))
  ok("sanitizeBlock scrubs block.quadrants (color + layout)");
else bad("sanitizeBlock does not scrub quadrants (wiring missing)");
{
  const BLOCKS = path.join(__dirname, "..", "tools", "vela-dev", "app", "parts", "part-blocks.jsx");
  const bsrc = fs.readFileSync(BLOCKS, "utf8");
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
  let isSvgStyleSafe;
  try {
    const fn = grab(/function isSvgStyleSafe\(css\)\s*\{[\s\S]*?\n\}/, "isSvgStyleSafe");
    // eslint-disable-next-line no-new-func
    isSvgStyleSafe = new Function(fn + "\nreturn isSvgStyleSafe;")();
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
  }
}

console.log("\n  " + pass + " passed, " + failCount + " failed");
process.exit(failCount ? 1 : 0);
