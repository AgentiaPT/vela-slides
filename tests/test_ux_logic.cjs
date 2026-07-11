// Unit tests for Sprint 7-1 pure helpers: minutes formatting, slide-visibility
// helpers, blank-slide derivation, and the new reducer actions
// (TOGGLE_SLIDE_HIDDEN, INSERT_ITEM). Pure functions extracted from source.
const fs = require("fs");
const path = require("path");
const P = (f) => path.join(__dirname, "..", "tools/vela-dev/app/parts", f);
const imports = fs.readFileSync(P("part-imports.jsx"), "utf8");
const list = fs.readFileSync(P("part-list.jsx"), "utf8");
const reducer = fs.readFileSync(P("part-reducer.jsx"), "utf8");

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✅ " + n); };
const bad = (n, d) => { fail++; console.log("  ❌ " + n + (d ? " — " + d : "")); };
const eq = (n, a, b) => { JSON.stringify(a) === JSON.stringify(b) ? ok(n) : bad(n, `${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

// ---- extract a `const NAME = (...) => ...;` arrow (single statement) ----
function arrow(src, name) {
  const re = new RegExp("const " + name + "\\s*=\\s*\\([^)]*\\)\\s*=>");
  const m = src.match(re);
  if (!m) throw new Error("not found: " + name);
  // take until the end of the line (these helpers are one-liners)
  const start = m.index;
  const nl = src.indexOf("\n", start);
  let line = src.slice(start, nl).trim();
  if (line.endsWith(";")) line = line.slice(0, -1);
  return line.replace(/^const\s+\w+\s*=\s*/, "");
}
function fn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error("not found: " + name);
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(start, i);
}

// eslint-disable-next-line no-eval
const fmtTimeMin = eval(arrow(imports, "fmtTimeMin"));
// eslint-disable-next-line no-eval
const visibleSlides = eval(arrow(imports, "visibleSlides"));
// eslint-disable-next-line no-eval
const sumVisibleDurations = eval(arrow(imports, "sumVisibleDurations"));

// fmtTimeMin — rounds to whole minutes, no seconds
eq("fmtTimeMin(0) == ''", fmtTimeMin(0), "");
eq("fmtTimeMin(718) == '12m' (11m58s rounds up)", fmtTimeMin(718), "12m");
eq("fmtTimeMin(20) == '<1m'", fmtTimeMin(20), "<1m");
eq("fmtTimeMin(3720) == '1h 2m'", fmtTimeMin(3720), "1h 2m");
if (!/\ds\b/.test(fmtTimeMin(718) + fmtTimeMin(125))) ok("fmtTimeMin never shows seconds"); else bad("fmtTimeMin shows seconds");

// visibility helpers
const slides = [{ duration: 10 }, { duration: 20, hidden: true }, { duration: 30 }];
eq("visibleSlides excludes hidden", visibleSlides(slides).length, 2);
eq("sumVisibleDurations excludes hidden", sumVisibleDurations(slides), 40);

// blankSlideFrom — inherits styling, empty blocks (needs SLIDE_STYLE_KEYS in scope)
const styleKeysLine = list.match(/const SLIDE_STYLE_KEYS = \[[^\]]*\];/)[0];
// eslint-disable-next-line no-eval
const blankSlideFrom = eval("(function(){ " + styleKeysLine + " return (" + fn(list, "blankSlideFrom") + "); })()");
{
  const prev = { bg: "#000", color: "#fff", accent: "#f00", duration: 45, blocks: [{ type: "heading", text: "x" }], title: "T" };
  const b = blankSlideFrom(prev);
  if (b.bg === "#000" && b.color === "#fff" && b.accent === "#f00" && Array.isArray(b.blocks) && b.blocks.length === 0 && b.duration === 45 && !("title" in b)) ok("blankSlideFrom copies style, empties blocks, drops content");
  else bad("blankSlideFrom", JSON.stringify(b));
}

// reducer source assertions (the reducer isn't safely extractable in isolation)
if (/case "TOGGLE_SLIDE_HIDDEN":/.test(reducer)) ok("reducer has TOGGLE_SLIDE_HIDDEN"); else bad("reducer TOGGLE_SLIDE_HIDDEN missing");
if (/case "INSERT_ITEM":/.test(reducer) && /afterId/.test(reducer)) ok("reducer has INSERT_ITEM with afterId"); else bad("reducer INSERT_ITEM missing");
if (/case "DRAG_REORDER":/.test(reducer)) ok("reducer keeps DRAG_REORDER"); else bad("DRAG_REORDER missing");

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 2 : 0);
