// Regression test for CR3: ModalBackdrop's inner card must be able to scroll
// within a short/narrow artifact pane, else dialogs (About/changelog etc.)
// overflow the viewport with no way to reveal the rest of the content.
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "src/parts/part-app.jsx"), "utf8");

function extractFn(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  // Skip past the parameter list (which may itself contain braces, e.g.
  // destructured params like `{ onClose, onEnter }`) by brace/paren-matching
  // the parens first, then finding the function body's opening brace after.
  const parenStart = src.indexOf("(", start);
  let pdepth = 0, parenEnd = -1;
  for (let k = parenStart; k < src.length; k++) {
    if (src[k] === "(") pdepth++;
    else if (src[k] === ")") { pdepth--; if (pdepth === 0) { parenEnd = k + 1; break; } }
  }
  let i = src.indexOf("{", parenEnd), depth = 0;
  for (; i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(start, i);
}

const fnSrc = extractFn("ModalBackdrop");

// Pull out the inner card's style={{ ... }} object literal (second style= in the fn,
// the outer backdrop div is the first). We just grab everything between the first
// occurrence of `style={{ background: T.bgPanel` and its matching `}}`.
const markerIdx = fnSrc.indexOf("style={{ background: T.bgPanel");
if (markerIdx < 0) throw new Error("could not locate ModalBackdrop inner card style");
let j = fnSrc.indexOf("{{", markerIdx) + 1; // start at inner-most '{'
let depth = 0, end = -1;
for (let k = j; k < fnSrc.length; k++) {
  if (fnSrc[k] === "{") depth++;
  else if (fnSrc[k] === "}") { depth--; if (depth === 0) { end = k + 1; break; } }
}
const cardStyle = fnSrc.slice(j, end);

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✅ " + n); };
const bad = (n, d) => { fail++; console.log("  ❌ " + n + (d ? " — " + d : "")); };

if (/maxHeight/.test(cardStyle)) ok("ModalBackdrop inner card style has maxHeight");
else bad("ModalBackdrop inner card style has maxHeight", cardStyle);

if (/overflowY/.test(cardStyle)) ok("ModalBackdrop inner card style has overflowY");
else bad("ModalBackdrop inner card style has overflowY", cardStyle);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 2 : 0);
