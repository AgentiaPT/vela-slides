#!/usr/bin/env node
/**
 * Vela real-sanitizer harness.
 *
 * Loads the ACTUAL deck sanitizers from skills/vela-slides/app/parts/part-imports.jsx
 * into a jsdom context (so DOMParser/document behave like the artifact runtime) and
 * exposes them for payload testing. This runs production code — NOT a reimplementation.
 *
 * Use this for the STATIC layer ("does the dangerous primitive survive the sanitizer
 * output?"). Pair it with browser-probe.cjs for the DYNAMIC layer ("does a surviving
 * primitive actually execute/fetch in a real browser?"). Note: findLeaks/svgNetworkRefs
 * are intentionally over-eager string matchers — they flag url()/scheme even in
 * attributes a browser never fetches from (e.g. filter in=/in2/values) and cannot see
 * inside base64 data: URIs. Treat their output as "needs a browser-probe confirmation",
 * not as a verdict.
 *
 * require() it:  const H = require(".../sanitizer-harness.cjs");
 *   H.validateAndSanitizeDeck(rawDeck) / H.sanitizeSvgMarkup(str) / H.sanitizeStyle /
 *   H.scrubColorFields / H.sanitizeUrl / H.isSvgStyleSafe
 *   H.findLeaks(sanitizedDeck) -> []   (empty = nothing dangerous survived as a string)
 *   H.svgNetworkRefs(svgOut)   -> []   (re-parses as dangerouslySetInnerHTML would)
 * Run directly for a self-test:  node sanitizer-harness.cjs
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function findRepoRoot(start) {
  let d = start;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(d, "skills/vela-slides/app/parts/part-imports.jsx"))) return d;
    const up = path.dirname(d); if (up === d) break; d = up;
  }
  return process.cwd();
}
const REPO = findRepoRoot(__dirname);

let jsdom;
for (const p of [path.join(REPO, "node_modules/jsdom"), "jsdom"]) {
  try { jsdom = require(p); break; } catch (_) {}
}
if (!jsdom) {
  console.error("jsdom not installed (node_modules is gitignored/ephemeral). Restore with:");
  console.error("  (cd " + REPO + " && npm install --no-audit --no-fund --ignore-scripts jsdom)");
  process.exit(2);
}
const { JSDOM } = jsdom;

const SRC = path.join(REPO, "skills/vela-slides/app/parts/part-imports.jsx");
const lines = fs.readFileSync(SRC, "utf8").split("\n");
const uidLine = lines.find((l) => l.startsWith("const uid ="));
const startIdx = lines.findIndex((l) => l.startsWith("const now ="));
let endIdx = -1;
for (let i = startIdx; i < lines.length; i++) {
  if (lines[i].includes("branding: importedBranding };")) {
    endIdx = i;
    for (let j = i + 1; j < lines.length && j < i + 4; j++) { endIdx = j; if (lines[j].trim() === "}") break; }
    break;
  }
}
if (!uidLine || startIdx === -1 || endIdx === -1) {
  console.error("Could not locate sanitizer slice in part-imports.jsx — file shape changed.");
  process.exit(2);
}
const slice = uidLine + "\n" + lines.slice(startIdx, endIdx + 1).join("\n");

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url: "https://artifact.local/" });
const w = dom.window;
const sandbox = {
  DOMParser: w.DOMParser, document: w.document, window: w, URL: w.URL,
  crypto: w.crypto || { randomUUID: () => "x".repeat(8) }, Image: w.Image, console,
  VELA_PRESENTATION_MODE: false,
  module: { exports: {} },
};
vm.createContext(sandbox);
vm.runInContext(slice + `
module.exports = { sanitizeString, sanitizeUrl, isSvgStyleSafe, sanitizeSvgMarkup,
  sanitizeStyle, scrubColorFields, sanitizeBlock, sanitizeSlide, sanitizeItem,
  validateAndSanitizeDeck, sanitizeStudyNotes, sanitizeComment,
  SAFE_BLOCK_TYPES, SAFE_STYLE_KEYS, SVG_ALLOWED_TAGS, SVG_URL_REF_ATTRS };`,
  sandbox, { filename: "part-imports-slice.js" });
const api = sandbox.module.exports;
const document = w.document;

function leaksInString(s, where, out) {
  if (typeof s !== "string" || !s) return;
  const low = s.toLowerCase();
  for (const m of low.match(/url\s*\([^)]*\)/g) || []) if (!/^url\s*\(\s*['"]?\s*#/.test(m)) out.push({ where, kind: "external-url()", value: m });
  if (/(?:-webkit-|-moz-)?(?:image-set|image|cross-fade|src)\s*\(\s*['"]/.test(low)) out.push({ where, kind: "css-image-fn", value: s.slice(0, 120) });
  const stripped = low.replace(/https?:\/\/www\.w3\.org\/[^\s"']*/g, "");
  if (/(vbscript:|javascript:)/.test(stripped) || (/(https?:)/.test(stripped) && !/^data:image\//.test(stripped) && /url\s*\(|href|src|background|image/.test(stripped)))
    out.push({ where, kind: "scheme", value: s.slice(0, 120) });
  if (/\bon[a-z]+\s*=/.test(low)) out.push({ where, kind: "event-handler", value: s.slice(0, 120) });
  if (/<\s*script/.test(low)) out.push({ where, kind: "script-tag", value: s.slice(0, 120) });
}
function findLeaks(obj, where = "$") {
  const out = [], seen = new Set();
  (function walk(o, p) {
    if (o == null) return;
    if (typeof o === "string") return leaksInString(o, p, out);
    if (typeof o !== "object" || seen.has(o)) return; seen.add(o);
    if (Array.isArray(o)) return o.forEach((v, i) => walk(v, p + "[" + i + "]"));
    for (const k of Object.keys(o)) walk(o[k], p + "." + k);
  })(obj, where);
  return out;
}
function svgNetworkRefs(html) {
  const out = []; leaksInString(html, "svg", out);
  const d = document.createElement("div"); d.innerHTML = html;
  for (const el of d.querySelectorAll("*")) {
    const tag = el.tagName.toLowerCase();
    for (const a of Array.from(el.attributes || [])) {
      const n = a.name.toLowerCase(), v = (a.value || "").trim().toLowerCase();
      if (/^on/.test(n)) out.push({ kind: "event-handler", value: tag + "." + n });
      if ((n === "href" || n === "xlink:href") && tag !== "a" && !v.startsWith("#")) out.push({ kind: "auto-fetch-href", value: tag + "." + n + "=" + a.value });
      if (n === "src" && !/^data:image\//.test(v)) out.push({ kind: "src", value: tag + ".src=" + a.value });
    }
  }
  return out;
}

module.exports = { ...api, findLeaks, svgNetworkRefs, document };

if (require.main === module) {
  const t = (label, leaks) => console.log((leaks.length ? "  LEAK!!  " : "  blocked ") + label + (leaks.length ? " -> " + JSON.stringify(leaks) : ""));
  const D = (b) => ({ lanes: [{ title: "l", items: [{ title: "m", slides: [{ blocks: [b] }] }] }] });
  t("image src https", findLeaks(api.validateAndSanitizeDeck(D({ type: "image", src: "https://attacker/x.png" }))));
  t("style url()", findLeaks(api.validateAndSanitizeDeck(D({ type: "text", text: "x", style: { backgroundColor: "url('https://a/?d=1')" } }))));
  t("svg external image href", svgNetworkRefs(api.sanitizeSvgMarkup('<image href="https://attacker/b.png"/>')));
  console.log("sanitizer-harness self-test done @", new Date().toISOString());
}
