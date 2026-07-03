/**
 * Standalone HTML export — machinery regression test (CI-gated).
 *
 * Covers buildStandaloneHtml() and its helpers (part-pdf.jsx), which power the
 * in-app "Export -> Standalone HTML" feature: splice the CURRENT deck into the
 * app's own JSX source, transpile with Babel, and inline the result (plus a
 * CDN+SRI React/ReactDOM/lucide-react loader and an optional "Made with Vela"
 * footer) into one shareable .html file.
 *
 * This loads the REAL functions from part-pdf.jsx (regex-extracted between the
 * STANDALONE_HTML_PURE_START/_END comment markers — see that file) and drives
 * them with the vendored babel.min.js, exactly like the real vela.jsx source
 * and the real demo deck, so it exercises the actual production code path
 * rather than a re-implementation.
 *
 * Asserts:
 *   1. Output contains the 3 CDN <script src=... integrity=... crossorigin>
 *      tags with the EXACT pinned SRI hashes.
 *   2. Output contains NO literal `</script` (case-insensitive) anywhere —
 *      the neutralize step must hide the app's own XSS-test string literals
 *      that contain that token, or the <script> block truncates the page.
 *   3. The deck's title/text is spliced into the output (STARTUP_PATCH).
 *   4. The "Made with Vela" footer div is present when requested, and absent
 *      when not.
 *   5. spliceStartupPatch() correctly re-splices over an ALREADY-patched
 *      STARTUP_PATCH value (simulates the artifact/serve.py source-acquisition
 *      path, which scrapes an already deck-patched <script type="text/babel">
 *      tag rather than the pristine `null` sentinel Neutralino gets).
 *
 * Usage: node tests/test_standalone_html.cjs  (exit 0 = pass, 1 = fail, 2 = env)
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..");
const PDF_SRC_PATH = path.join(REPO, "skills/vela-slides/app/parts/part-pdf.jsx");
const VELA_JSX_PATH = path.join(REPO, "skills/vela-slides/app/vela.jsx");
const DEMO_DECK_PATH = path.join(REPO, "examples/vela-demo.vela");
const BABEL_PATH = path.join(REPO, "vela-neutralino/resources/vendor/babel.min.js");

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

if (!fs.existsSync(PDF_SRC_PATH) || !fs.existsSync(VELA_JSX_PATH) || !fs.existsSync(DEMO_DECK_PATH) || !fs.existsSync(BABEL_PATH)) {
  console.error("Missing required source/vendor file(s) — run concat.py first / check vendor dir.");
  process.exit(2);
}

let Babel;
try { Babel = require(BABEL_PATH); }
catch (e) { console.error("Could not require vendored babel.min.js:", e.message); process.exit(2); }

const pdfSource = fs.readFileSync(PDF_SRC_PATH, "utf8");
const m = pdfSource.match(/STANDALONE_HTML_PURE_START([\s\S]*?)STANDALONE_HTML_PURE_END/);
if (!m) { console.error("Could not locate STANDALONE_HTML_PURE_START/_END markers in part-pdf.jsx"); process.exit(2); }

const sandbox = { window: { Babel }, console, module: { exports: {} } };
vm.createContext(sandbox);
try {
  vm.runInContext(`
${m[1]}
module.exports = { VELA_STANDALONE_LIBS, escapeForScriptContext, stripEsmImportsForStandalone, spliceStartupPatch, MADE_WITH_VELA_FOOTER_HTML, escapeHtmlText, buildStandaloneHtml };
`, sandbox);
} catch (e) {
  console.error("Failed to evaluate the extracted pure block:", e.message);
  process.exit(2);
}
const { VELA_STANDALONE_LIBS, spliceStartupPatch, buildStandaloneHtml } = sandbox.module.exports;
check("extracted VELA_STANDALONE_LIBS has 3 entries", Array.isArray(VELA_STANDALONE_LIBS) && VELA_STANDALONE_LIBS.length === 3);

const jsxSource = fs.readFileSync(VELA_JSX_PATH, "utf8");
const deck = JSON.parse(fs.readFileSync(DEMO_DECK_PATH, "utf8"));

// ── 1/2/3/4: build with footer on ───────────────────────────────────────
let html;
try {
  html = buildStandaloneHtml(jsxSource, deck, { footer: true, babel: Babel });
} catch (e) {
  console.error("buildStandaloneHtml threw:", e.stack || e.message);
  process.exit(1);
}
check("output is a non-trivial HTML document", typeof html === "string" && html.length > 10000);
check("output starts with <!DOCTYPE html>", html.startsWith("<!DOCTYPE html>"));

for (const lib of VELA_STANDALONE_LIBS) {
  const tag = `<script src="${lib.src}" integrity="${lib.integrity}" crossorigin="anonymous"></script>`;
  check(`CDN tag present verbatim: ${lib.src}`, html.includes(tag));
}

// The 3 CDN <script src=...></script> tags legitimately open-and-close a
// script element right there — that's correct HTML, not a leak. The actual
// danger is a literal `</script` inside the CONTENT of the big inlined app
// <script>...</script> block (from the app's own XSS-test string literals,
// see part-uitest.jsx), which would prematurely close THAT element and
// truncate the page. Isolate that one block's content and check it there.
function extractAppScriptContent(doc) {
  const openMarker = '<div id="root"></div>\n<script>';
  const openIdx = doc.indexOf(openMarker);
  if (openIdx === -1) throw new Error("could not locate the app <script> open marker");
  const contentStart = openIdx + openMarker.length;
  const closeIdx = doc.indexOf("</script>", contentStart); // first UNESCAPED closer = the true one
  if (closeIdx === -1) throw new Error("could not locate the app <script> close tag");
  return doc.slice(contentStart, closeIdx);
}
const appScriptContent = extractAppScriptContent(html);
check("no unescaped `</script` inside the inlined app code (neutralized)", !/<\/script/i.test(appScriptContent));
check("the RAW (pre-neutralize) vela.jsx source actually contains `</script` (proves this test isn't vacuous)", /<\/script/i.test(jsxSource));
check("neutralize left an escaped `<\\/script` trace in the compiled app code", /<\\\/script/i.test(appScriptContent));

check("deck title spliced into <title>", html.includes("<title>Vela Slides"));
// deckTitle contains an em-dash which escapeForScriptContext leaves untouched
// (only <, >, &, U+2028, U+2029 are escaped) so the raw title text must appear
// verbatim in the spliced STARTUP_PATCH JSON inside the inlined <script>.
check("deck JSON spliced into STARTUP_PATCH (deckTitle string present verbatim)", appScriptContent.includes(deck.deckTitle));
check("footer div present when footer:true", html.includes('id="vela-standalone-footer"') && html.includes("Made with Vela"));

const htmlNoFooter = buildStandaloneHtml(jsxSource, deck, { footer: false, babel: Babel });
check("footer div ABSENT when footer:false", !htmlNoFooter.includes('id="vela-standalone-footer"'));
check("still no unescaped </script leak in app code with footer:false", !/<\/script/i.test(extractAppScriptContent(htmlNoFooter)));

// ── 5: spliceStartupPatch over an ALREADY-patched value (artifact/serve.py path) ──
const prePatched = 'const x = 1;\nconst STARTUP_PATCH = {"deckTitle":"Old <script>",lanes:[]};\nconst y = 2;\n';
const reSpliced = spliceStartupPatch(prePatched, { deckTitle: "New Deck", lanes: [] });
check("spliceStartupPatch replaces an existing (non-null) STARTUP_PATCH value", reSpliced.includes('"New Deck"') && !reSpliced.includes("Old"));
check("spliceStartupPatch preserves surrounding source", reSpliced.includes("const x = 1;") && reSpliced.includes("const y = 2;"));

const prePristine = 'const STARTUP_PATCH = null;\n';
const spliced2 = spliceStartupPatch(prePristine, { deckTitle: "Fresh", lanes: [] });
check("spliceStartupPatch replaces the pristine null sentinel", spliced2.includes('"Fresh"') && !spliced2.includes("= null;"));

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
