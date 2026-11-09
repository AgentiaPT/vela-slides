/**
 * ++underline++ inline format (v13.78 WP7) — behavioral test, CI-gated, no browser.
 *
 * Runs the REAL part-blocks.jsx (same Babel eval-slice harness as
 * test_block_render.cjs) and checks:
 *   - strict (flanking) delimiters: C++, i++, "a ++ b", x+++y, "++" stay literal,
 *     and text without a strict pair renders byte-identical to before (R0);
 *   - underline renders as a React span (textDecoration only + data-vela-u),
 *     nested with bold/italic/strike in both orders;
 *   - edit-mode HTML (inlineMdToHtml) escapes deck text first: only
 *     code-generated <u> tags exist; inlineHtmlToMd maps only U elements and
 *     round-trips; an underline that cannot round-trip is dropped, text kept;
 *   - linear time on hostile input.
 * Exit 0 = pass, 1 = assertion failed, 2 = missing devDependency, 3 = source error.
 */
const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const BLOCKS_SRC = path.join(REPO, "src/parts/part-blocks.jsx");
const IMPORTS_SRC = path.join(REPO, "src/parts/part-imports.jsx");

let React, renderToStaticMarkup, Babel, DOMParser;
try {
  React = require("react");
  renderToStaticMarkup = require("react-dom/server").renderToStaticMarkup;
  Babel = require("@babel/standalone");
  const { JSDOM } = require("jsdom");
  DOMParser = new JSDOM("<!doctype html>").window.DOMParser;
} catch (e) {
  console.error("Setup error — missing devDependency (run `npm ci`):", e.message);
  process.exit(2);
}
if (!fs.existsSync(BLOCKS_SRC) || !fs.existsSync(IMPORTS_SRC)) {
  console.error("Missing source part-file(s). Expected src/parts/part-blocks.jsx and part-imports.jsx");
  process.exit(2);
}

const blocksSrc = fs.readFileSync(BLOCKS_SRC, "utf8");
const importsSrc = fs.readFileSync(IMPORTS_SRC, "utf8");

// ── Source extraction helpers ────────────────────────────────────────────────
// Pull the REAL functions/constants out of part-imports.jsx by name so we run
// production code, not a re-implementation (same technique as test_image_preserve.cjs).
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found in part-imports.jsx`);
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}
// Extract a `const NAME = <expr>;` — scans to the terminating `;` at bracket depth 0
// so multi-line `new Set([ … ])` / object literals are captured whole.
function extractConst(src, name) {
  const re = new RegExp(`const ${name}\\s*=`);
  const m = re.exec(src);
  if (!m) throw new Error(`const ${name} not found in part-imports.jsx`);
  let i = m.index + m[0].length, depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === ";" && depth === 0) { i++; break; }
  }
  return src.slice(m.index, i);
}

// ── Assemble a self-contained source: deps preamble + the real block source ──
const preamble = `
const { useState, useReducer, useEffect, useLayoutEffect, useRef, useCallback, useMemo } = React;
const dbg = function () {};
${extractConst(importsSrc, "themes")}
const T = themes.dark;
${extractConst(importsSrc, "FONT")}
${extractConst(importsSrc, "BASE_SIZES")}
${extractConst(importsSrc, "CSS_COLOR_OK")}
${extractFn(importsSrc, "linkPreview")}
${extractFn(importsSrc, "sanitizeUrl")}
${extractFn(importsSrc, "cssColor")}
${extractConst(importsSrc, "CSS_FETCH_SCHEME")}
${extractConst(importsSrc, "CSS_PAINT_KEY")}
${extractConst(importsSrc, "cssKeyStem")}
${extractConst(importsSrc, "SVG_ALLOWED_TAGS")}
${extractConst(importsSrc, "SVG_URL_REF_ATTRS")}
${extractConst(importsSrc, "SVG_STYLE_PROPS")}
${extractConst(importsSrc, "SVG_VALUE_FNS")}
${extractFn(importsSrc, "isSvgStyleSafe")}
${extractConst(importsSrc, "SVG_ROOT_BLOCKED")}
${extractFn(importsSrc, "isSvgInlineStyleSafe")}
${extractFn(importsSrc, "sanitizeSvgMarkup")}
// STUBS — browser-bound, off the static render path:
function openExternalLink() {}
function getIcon(name) { return name ? React.createElement("span", { className: "icon-stub", "data-icon": String(name) }) : null; }
function EditableIcon(props) { return props.children || null; }
`;

const wrapped =
  "(function (React, DOMParser) {\n" +
  preamble + "\n" +
  blocksSrc + "\n" +
  "return { parseInline, findUnderlineSpans, inlineMdToHtml, inlineHtmlToMd };\n" +
  "})";

let factory;
try {
  const { code } = Babel.transform(wrapped, { presets: [["react", { runtime: "classic" }]] });
  // eslint-disable-next-line no-eval
  factory = (0, eval)(code);
} catch (e) {
  // Exit 3, not the missing-devDependency code 2: the source is present but does
  // not compile, which must fail rather than be reported as a skipped suite.
  console.error("Failed to transpile/evaluate part-blocks.jsx:", e.stack || e.message);
  process.exit(3);
}
let mod;
try {
  mod = factory(React, DOMParser);
  for (const k of ["parseInline", "findUnderlineSpans", "inlineMdToHtml", "inlineHtmlToMd"])
    if (typeof mod[k] !== "function") throw new Error(k + " is not a function");
} catch (e) {
  console.error("Block module did not initialize:", e.stack || e.message);
  process.exit(3);
}


const { parseInline, findUnderlineSpans, inlineMdToHtml, inlineHtmlToMd } = mod;
const { JSDOM } = require("jsdom");
const doc = new JSDOM("<!doctype html><body></body>").window.document;
let pass = 0, fail = 0;
const ok = () => { pass++; };
const bad = (n, d) => { fail++; console.error("  ✗ " + n + (d ? " — " + d : "")); };
const eq = (n, got, want) => (got === want ? ok() : bad(n, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
const html = (s) => renderToStaticMarkup(React.createElement("div", null, parseInline(s)));
// Reference render with every "+" swapped for a neutral symbol: proves "+" text
// takes no part in tokenizing (identical markup = no rendering change).
const PLUS = "➕";
const neutral = (s) => html(s.replace(/\+/g, PLUS)).split(PLUS).join("+");
const toEl = (h) => { const d = doc.createElement("div"); d.innerHTML = h; return d; };

// 1. R0 — must stay literal and render exactly as before.
const LITERAL = ["C++", "C++ and C++", "i++ and j++", "a ++ b ++ c", "x+++y", "++", "+++", "++++", "a++b",
  "++x++y", "x++y++", "é++x++", "++ x++", "++x ++", "++a\nb++", "**C++** rocks", "use C++ or *C#*",
  "~~i++~~", "1++2++3", "++é++é", "[C++](https://isocpp.org)"];
for (const s of LITERAL) {
  const h = html(s);
  if (h.indexOf("data-vela-u") >= 0 || (s.indexOf("[") < 0 && h.indexOf("underline") >= 0)) bad("literal: " + JSON.stringify(s), h);
  else eq("R0 identical: " + JSON.stringify(s), h, neutral(s));
}

// 2. Must underline.
const U = '<span data-vela-u="1" style="text-decoration:underline">';
eq("++word++", html("++word++"), `<div>${U}word</span></div>`);
eq("say ++two words++.", html("say ++two words++."), `<div>say ${U}two words</span>.</div>`);
eq("(++x++)", html("(++x++)"), `<div>(${U}x</span>)</div>`);
eq("C++ is ++great++", html("C++ is ++great++"), `<div>C++ is ${U}great</span></div>`);
const BU = '<span data-vela-u="1" style="font-weight:700;text-decoration:underline">x</span>';
eq("**++x++** (underline inside bold)", html("**++x++**"), `<div>${BU}</div>`);
eq("++**x**++ (bold inside underline)", html("++**x**++"), `<div>${BU}</div>`);
eq("++~~x~~++ strike+underline", html("++~~x~~++"), '<div><span data-vela-u="1" style="text-decoration:line-through underline">x</span></div>');
eq("*a ++b++ c* split", html("*a ++b++ c*"), '<div><span style="font-style:italic">a </span><span data-vela-u="1" style="font-style:italic;text-decoration:underline">b</span><span style="font-style:italic"> c</span></div>');
{
  const h = html("++a++ and ++b++");
  eq("two spans", (h.match(/data-vela-u/g) || []).length, 2);
  const l = html("++[site](https://example.com)++");
  if (l.indexOf(U + "<a href=\"https://example.com/\"") >= 0 || l.indexOf(U + "<a href=\"https://example.com\"") >= 0) ok(); else bad("link inside underline", l);
  const b = html("++a++\n++b++");
  eq("per line", (b.match(/data-vela-u/g) || []).length, 2);
}
eq("spans helper", JSON.stringify(findUnderlineSpans("x ++a b++ C++ ++c++")), "[[2,9],[14,19]]");

// 3. Security — deck text never becomes markup.
{
  const evil = '<u onclick="alert(1)">a</u> ++b++ <img src=x onerror=alert(1)>';
  const h = html(evil);
  if (h.indexOf("<u") === -1 && h.indexOf("&lt;u onclick") >= 0 && h.indexOf("<img") === -1) ok(); else bad("renderer escapes deck <u>", h);
  const el = toEl(inlineMdToHtml(evil));
  const us = el.querySelectorAll("u");
  if (us.length === 1 && us[0].attributes.length === 0 && us[0].textContent === "b"
      && !el.querySelector("img,[onclick],[onerror]") && el.textContent.indexOf('<u onclick="alert(1)">') === 0) ok();
  else bad("edit-mode HTML escapes deck text; only code <u>", el.innerHTML);
  eq("styled span is not underline", inlineHtmlToMd(toEl('<span style="text-decoration:underline">x</span>')), "x");
  eq("u attributes ignored", inlineHtmlToMd(toEl('<u class="k" style="color:red">x</u>')), "++x++");
}

// 4. htmlToMd mapping + round trip.
const H2M = [
  ["<u>x</u>", "++x++"], ["<b><u>x</u></b>", "**++x++**"], ["<u><b>x</b></u>", "++**x**++"],
  ["<u><s>x</s></u>", "++~~x~~++"], ["say <u>two words</u>.", "say ++two words++."],
  ["under<u>line</u>", "underline"], ["<u>under</u>line", "underline"], ["<u> x </u>", " ++x++ "],
  ["<u>a</u><u>b</u>", "++ab++"], ["<u>a<br>b</u>", "++a++\n++b++"], ["<u></u>x", "x"], ["<u>  </u>", "  "],
  ["C<u>++</u>", "C++"], ["<u><u>x</u></u>", "++x++"], ["++a <u>b</u>", "++a b"],
  ["<b>a</b><div>b</div>", "**a**\nb"], ["a<div>b</div><p>c</p>", "a\nb\nc"], ["x<u>y</u> z", "xy z"],
];
for (const [h, want] of H2M) eq("htmlToMd " + h, inlineHtmlToMd(toEl(h)), want);
for (const s of ["++word++", "say ++two words++.", "(++x++)", "**++x++**", "++**x**++", "++~~x~~++", "a & ++<b>++ c", "C++ and ++x++", "++a++\n++b++", "**bold** *it* ~~s~~"])
  eq("round trip " + JSON.stringify(s), inlineHtmlToMd(toEl(inlineMdToHtml(s))), s);
for (const s of LITERAL) if (s.indexOf("[") < 0 && s.indexOf("*") < 0) eq("edit literal " + JSON.stringify(s), inlineHtmlToMd(toEl(inlineMdToHtml(s))), s);

// 4b. Editor HTML = slide marks, well nested, no change on click-in/click-out.
// A ++…++ pair that crosses a bold/italic/strike token stays literal in both
// views (the old editor made crossing tags; the browser re-nested them and a
// blur commit changed the deck text).
const MARK_BITS = { STRONG: 1, B: 1, EM: 2, I: 2, S: 4, DEL: 4, STRIKE: 4, U: 8 };
// Per-character marks of an editor DOM: each character followed by its bits.
const domRuns = (root) => {
  let r = "";
  const walk = (el, bits) => {
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { for (const c of n.textContent) r += c + bits; }
      else if (n.nodeName === "BR") r += "\n0";
      else walk(n, bits | (MARK_BITS[n.nodeName] || 0));
    }
  };
  walk(root, 0);
  return r.replace(/\n\d+/g, "\n0");
};
// Per-character marks of the slide render (parseInline spans carry inline styles).
const slideRuns = (s) => {
  let r = "";
  const walk = (node, bits) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { for (const c of n.textContent) r += c + bits; continue; }
      if (n.nodeName === "BR") { r += "\n0"; continue; }
      const st = (n.getAttribute && n.getAttribute("style")) || "";
      walk(n, bits | (/font-weight:700/.test(st) ? 1 : 0) | (/font-style:italic/.test(st) ? 2 : 0)
        | (/line-through/.test(st) ? 4 : 0) | (/(^|[\s:])underline/.test(st) ? 8 : 0));
    }
  };
  walk(toEl(html(s)).firstChild, 0);
  return r.replace(/\n\d+/g, "\n0");
};
// Tag-stack check: every close tag matches the last open tag.
const nested = (h) => {
  const st = [];
  for (const m of h.matchAll(/<(\/?)([a-z]+)[^>]*>/g)) {
    if (m[2] === "br") continue;
    if (!m[1]) st.push(m[2]); else if (st.pop() !== m[2]) return false;
  }
  return st.length === 0;
};
// exact: md must equal s. "_" marks are saved as "*" (by design), so for a
// text with "_" only the editor view (nesting, marks) is checked: the "*" can
// pair with a literal "*" next to it. That is not a nesting problem.
const editorCheck = (s, exact) => {
  const h = inlineMdToHtml(s);
  if (!nested(h)) return "badly nested: " + h;
  const el = toEl(h); // DOM normalization (jsdom parses like a browser)
  if (el.innerHTML !== h) return "browser re-nests: " + h + " => " + el.innerHTML;
  const sr = slideRuns(s);
  if (domRuns(el) !== sr) return "editor marks differ from slide: " + h;
  const md = inlineHtmlToMd(el);
  if (exact && md !== s) return "text changed: " + JSON.stringify(md);
  if (s.indexOf("_") < 0 && slideRuns(md) !== sr) return "slide marks changed after commit: " + JSON.stringify(md);
  return null;
};
const CROSS = [
  ["*a ++b* c++", "<em>a ++b</em> c++"], ["**a ++b** c++", "<strong>a ++b</strong> c++"],
  ["~~a ++b~~ c++", "<s>a ++b</s> c++"], ["_a ++b_ c++ d", "<em>a ++b</em> c++ d"],
  ["++a **b++ c**", "<u>a **b</u> c**"], ["**++a**b++", "<strong>++a</strong>b++"],
  ["*a **b* c**", "<em>a </em><em>b</em> c**"], ["**a *b** c*", "<strong>a *b</strong> c*"],
  ["_a_", "_a_"], ["*a ++b++ c*", "<em>a <u>b</u> c</em>"], ["++*a* b++", "<u><em>a</em> b</u>"],
];
for (const [s, want] of CROSS) {
  eq("editor html " + JSON.stringify(s), inlineMdToHtml(s), want);
  const e = editorCheck(s, s.indexOf("_") < 0);
  if (e) bad("editor round trip " + JSON.stringify(s), e); else ok();
}
{
  // Randomized property test, fixed seed (mulberry32), 3000 strings.
  let seed = 0x5eed1234;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const ALPHA = ["a", "b", " ", "*", "_", "~", "+", "`", "<", "&", "\n"];
  let n = 0, firstBad = null, exactN = 0;
  for (let i = 0; i < 3000; i++) {
    const len = 1 + Math.floor(rnd() * 16);
    let s = "";
    for (let j = 0; j < len; j++) s += ALPHA[Math.floor(rnd() * ALPHA.length)];
    // Exact text identity where the serializer writes the same markers back
    // (no "_"; the commit trims edge whitespace). Text with edge whitespace
    // must keep the same slide marks.
    const exact = s.indexOf("_") < 0 && s === s.trim();
    if (exact) exactN++;
    const e = editorCheck(s, exact);
    if (e) { n++; if (!firstBad) firstBad = JSON.stringify(s) + " — " + e; }
  }
  if (n === 0) ok(); else bad(`property: ${n} of 3000 strings fail`, firstBad);
  if (exactN >= 800) ok(); else bad("property: too few exact cases", String(exactN));
}

// 4c. Frozen render corpus: parseInline output (with and without a glossary
// ctx) must stay identical to the renderer before the tokenizer was shared
// with the editor (R0). The fixture holds output hashes only.
{
  const crypto = require("crypto");
  const FX = path.join(REPO, "tests/fixtures/parse-inline-corpus.json");
  const fx = JSON.parse(fs.readFileSync(FX, "utf8"));
  const mk = (s, c) => renderToStaticMarkup(React.createElement("div", null, parseInline(s, c)));
  const hash = (s) => crypto.createHash("sha256").update(mk(s) + "\u0001" + mk(s, fx.ctx)).digest("hex").slice(0, 16);
  if (process.env.VELA_REGEN_PARSE_CORPUS === "1") {
    fx.cases = fx.cases.map(([s]) => [s, hash(s)]);
    fs.writeFileSync(FX, JSON.stringify(fx).replace(/\],\[/g, "],\n[") + "\n");
    console.log("  regenerated " + FX);
  }
  let n = 0, firstBad = null;
  for (const [s, want] of fx.cases) if (hash(s) !== want) { n++; if (!firstBad) firstBad = JSON.stringify(s); }
  if (fx.cases.length >= 1000 && n === 0) ok(); else bad(`frozen corpus: ${n} of ${fx.cases.length} renders changed`, firstBad);
}

// 5. Linear time on hostile input (no quadratic rescans).
{
  const big = "++a ".repeat(20000) + "**x** ".repeat(5000);
  const t0 = Date.now(); html(big); findUnderlineSpans(big); inlineMdToHtml(big);
  const ms = Date.now() - t0;
  if (ms < 1500) ok(); else bad("hostile input too slow", ms + "ms");
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
