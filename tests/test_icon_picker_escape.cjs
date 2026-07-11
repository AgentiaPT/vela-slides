// Regression test for CR5: Escape must close the "Pick an icon" dialog.
// IconPicker already renders inside ModalBackdrop (which has a window-level
// Escape handler), but its two <input> onKeyDown handlers used to call
// e.stopPropagation() unconditionally, swallowing Escape before it could
// bubble to the window listener. This is a source-pattern test: it extracts
// the IconPicker function body from part-icons.jsx and inspects the two
// onKeyDown handlers directly (brace-matched, not eval'd — IconPicker is a
// React component with JSX that isn't standalone-evaluable in plain Node).
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "tools/vela-dev/app/parts/part-icons.jsx"), "utf8");

function extractFn(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  // Find the function's own opening brace, which is the `{` that begins the
  // body — i.e. the first `{` AFTER the parameter list's closing `)`, not any
  // `{` inside destructured params (e.g. `function Foo({ a, b }) {`).
  const parenStart = src.indexOf("(", start);
  let pi = parenStart, pdepth = 0;
  for (; pi < src.length; pi++) { if (src[pi] === "(") pdepth++; else if (src[pi] === ")") { pdepth--; if (pdepth === 0) { pi++; break; } } }
  let i = src.indexOf("{", pi), depth = 0;
  for (; i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(start, i);
}

const iconPickerSrc = extractFn("IconPicker");

// Pull out each onKeyDown={(e) => { ... }} block (brace-matched) inside IconPicker.
function extractKeyDownHandlers(fnSrc) {
  const handlers = [];
  const marker = "onKeyDown={(e) =>";
  let idx = 0;
  while (true) {
    const at = fnSrc.indexOf(marker, idx);
    if (at < 0) break;
    const braceStart = fnSrc.indexOf("{", at + marker.length);
    let i = braceStart, depth = 0;
    for (; i < fnSrc.length; i++) { if (fnSrc[i] === "{") depth++; else if (fnSrc[i] === "}") { depth--; if (depth === 0) { i++; break; } } }
    handlers.push(fnSrc.slice(at, i));
    idx = i;
  }
  return handlers;
}

const handlers = extractKeyDownHandlers(iconPickerSrc);

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✅ " + n); };
const bad = (n, d) => { fail++; console.log("  ❌ " + n + (d ? " — " + d : "")); };

if (handlers.length < 2) {
  bad("found both IconPicker input onKeyDown handlers", `found ${handlers.length}`);
} else {
  ok(`found ${handlers.length} onKeyDown handler(s) in IconPicker`);
}

// For each handler: it must NOT unconditionally call e.stopPropagation() before
// any Escape-specific check. Either:
//   (a) it explicitly branches on e.key === "Escape" (and does not merely fall
//       through to an unconditional stopPropagation), or
//   (b) stopPropagation itself is now conditioned on the key not being Escape.
handlers.forEach((h, n) => {
  const label = `input #${n + 1} onKeyDown does not swallow Escape`;
  const hasEscapeBranch = /e\.key\s*===\s*["']Escape["']/.test(h);
  // Find the raw call to stopPropagation and check nothing unconditional precedes any Escape guard.
  const stopIdx = h.indexOf("e.stopPropagation()");
  const escIdx = h.search(/e\.key\s*===\s*["']Escape["']/);
  const stopIsUnconditionalBeforeEscapeCheck =
    stopIdx >= 0 && (escIdx < 0 || stopIdx < escIdx) &&
    // crude "unconditional" check: stopPropagation call is not itself inside an
    // `if (e.key !== "Escape")`-style guard immediately preceding it.
    !/e\.key\s*!==\s*["']Escape["']\s*\)\s*e\.stopPropagation/.test(h) &&
    !/if\s*\(\s*e\.key\s*!==\s*["']Escape["']\s*\)\s*\{[^}]*e\.stopPropagation/.test(h);

  if (hasEscapeBranch && stopIsUnconditionalBeforeEscapeCheck === false) {
    ok(label);
  } else if (!hasEscapeBranch && stopIsUnconditionalBeforeEscapeCheck === false) {
    ok(label);
  } else {
    bad(label, h.replace(/\s+/g, " ").slice(0, 140));
  }
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 2 : 0);
