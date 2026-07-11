// Regression test for CR1: export crash "str.includes is not a function".
// Extracts parseLinearGradient from part-pdf.jsx and exercises it with
// truthy non-string inputs that previously slipped past the `!str` guard
// and threw when `.includes` was called on a number/object/bool/array.
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "src/parts/part-pdf.jsx"), "utf8");

function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  // brace-match to end of function
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(start, i);
}

// eslint-disable-next-line no-eval
eval(extract("compositeColor"));
// eslint-disable-next-line no-eval
eval(extract("parseColor"));
// eslint-disable-next-line no-eval
eval(extract("parseLinearGradient"));

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✅ " + n); };
const bad = (n, d) => { fail++; console.log("  ❌ " + n + (d ? " — " + d : "")); };

// 1. Truthy non-string inputs must return null WITHOUT throwing.
const nonStringInputs = [5, {}, true, ["a"], null, undefined, ""];
for (const input of nonStringInputs) {
  const label = JSON.stringify(input);
  try {
    const result = parseLinearGradient(input);
    if (result === null) ok(`parseLinearGradient(${label}) returns null (no throw)`);
    else bad(`parseLinearGradient(${label}) should return null`, JSON.stringify(result));
  } catch (e) {
    bad(`parseLinearGradient(${label}) threw`, e.message);
  }
}

// 2. Real gradient strings must still parse correctly.
{
  const result = parseLinearGradient("linear-gradient(90deg, #f00, #00f)");
  if (result && Array.isArray(result.stops) && result.stops.length === 2) {
    ok("parseLinearGradient still parses a real linear-gradient string");
  } else {
    bad("parseLinearGradient real-string parse regressed", JSON.stringify(result));
  }
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 2 : 0);
