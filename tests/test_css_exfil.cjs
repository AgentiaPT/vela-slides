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

const IMPORTS = path.join(__dirname, "..", "skills", "vela-slides", "app", "parts", "part-imports.jsx");
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
let scrub;
try {
  const reject = grab(/const STYLE_VALUE_REJECT = .+;/, "STYLE_VALUE_REJECT");
  const key = grab(/const CSS_COLOR_KEY = .+;/, "CSS_COLOR_KEY");
  const fn = grab(/function scrubColorFields\(obj\)\s*\{[\s\S]*?\n\}/, "scrubColorFields");
  // eslint-disable-next-line no-new-func
  scrub = new Function(reject + "\n" + key + "\n" + fn + "\nreturn { scrubColorFields, STYLE_VALUE_REJECT, CSS_COLOR_KEY };")();
} catch (e) {
  console.log("\n  " + pass + " passed, " + failCount + " failed");
  process.exit(1);
}
const { scrubColorFields, STYLE_VALUE_REJECT } = scrub;

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
  const mustReject = ['image-set("x")', 'image("x")', 'cross-fade("x")', 'src("x")', "url(x)", "EXPRESSION(1)"];
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

console.log("\n  " + pass + " passed, " + failCount + " failed");
process.exit(failCount ? 1 : 0);
