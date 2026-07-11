// Regression test for CR4: block-level hover toolbar (the 🎯🔗💬👁✕ cluster
// rendered by renderBlockItem in part-blocks.jsx, positioned at top:-8/right:-8
// just outside a block's own box) getting its circular buttons clipped.
//
// Root cause (confirmed by an in-browser repro — see CR4 notes): the toolbar is
// a DOM *sibling* of the block's own rendered root, so a block's own overflow
// never clips it directly. The genuine clipping ancestor is the isCols
// layout's L/R column wrappers (`overflow:"hidden"`, tightly hugging their
// blocks with zero margin) — ANY block sitting at a column's top/right edge,
// code and table included, had its toolbar cut there. code/table's own
// overflow:auto/hidden containers are fixed too (defense in depth / matches
// the block-root pattern) even though they were never literally an ancestor
// of this particular toolbar in the paths exercised.
//
// This is a source-pattern test (CSS-in-JS strings, not a runnable function):
// it extracts the three fixed regions from part-blocks.jsx and asserts the
// clipping container is now overflow:"visible" on the outside with the
// original crop preserved on an inner element.
const fs = require("fs");
const path = require("path");

const SRC_PATH = path.join(__dirname, "..", "skills/vela-slides/app/parts/part-blocks.jsx");
const src = fs.readFileSync(SRC_PATH, "utf8");

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✅ " + n); };
const bad = (n, d) => { fail++; console.log("  ❌ " + n + (d ? " — " + d : "")); };

// ── Extract a function's body (brace-matched). Finds the body's opening "{"
// as the FIRST "{" after the parameter list's closing ")" — not just the
// first "{" after the name, which would land inside a destructured param
// like `function CodeBlock({ block, cls, ... }) {`. ────────────────────────
function extractFunction(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  const parenClose = src.indexOf(") {", start);
  if (parenClose < 0) throw new Error(`function ${name} body not found`);
  let i = parenClose + 2, depth = 0;
  for (; i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(start, i);
}

// ── Extract a `case "x": { ... }` block (brace-matched from the case's own
// opening brace) ─────────────────────────────────────────────────────────
function extractCase(name) {
  const marker = `case "${name}": {`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`case "${name}" not found`);
  const braceStart = start + marker.length - 1;
  let i = braceStart, depth = 0;
  for (; i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(start, i);
}

// ── Extract the `{ ... }` object body of the first `style={{...}}` found at
// or after `fromIndex` (brace-matched — safe against `${...}` template
// interpolations inside the style values, which a naive [^}]* regex is not).
function extractStyleObj(text, fromIndex = 0) {
  const marker = "style={{";
  const mi = text.indexOf(marker, fromIndex);
  if (mi < 0) return null;
  let i = mi + marker.length - 1, depth = 0; // start at the object's opening "{"
  const objStart = i;
  for (; i < text.length; i++) { if (text[i] === "{") depth++; else if (text[i] === "}") { depth--; if (depth === 0) { i++; break; } } }
  return { text: text.slice(objStart, i), start: mi, end: i };
}

// ── 1. CodeBlock: outer box must not clip; scroll moves to an inner wrapper ─
{
  const fn = extractFunction("CodeBlock");
  const outer = extractStyleObj(fn, fn.indexOf("return <div className={cls}"));
  if (!outer) bad("CodeBlock outer div found", "pattern not found");
  else {
    const outerVisible = /overflow:\s*"visible"/.test(outer.text);
    const outerNotAuto = !/overflow:\s*"auto"/.test(outer.text);
    const inner = extractStyleObj(fn, outer.end);
    const hasInnerScroll = !!inner && /overflow:\s*"auto"/.test(inner.text);
    if (outerVisible && outerNotAuto && hasInnerScroll) ok("CodeBlock: outer overflow:visible, scroll moved to inner wrapper");
    else bad("CodeBlock: outer overflow:visible, scroll moved to inner wrapper",
      `outerVisible=${outerVisible} outerNotAuto=${outerNotAuto} hasInnerScroll=${hasInnerScroll}`);
  }
}

// ── 2. table block: outer box must not clip; corner-mask moves to an inner
//      wrapper ─────────────────────────────────────────────────────────────
{
  const caseSrc = extractCase("table");
  const outer = extractStyleObj(caseSrc, caseSrc.indexOf("return <div className={cls}"));
  if (!outer) bad("table outer div found", "pattern not found");
  else {
    const outerVisible = /overflow:\s*"visible"/.test(outer.text);
    const outerNotHidden = !/overflow:\s*"hidden"/.test(outer.text);
    const inner = extractStyleObj(caseSrc, outer.end);
    const hasInnerCrop = !!inner && /overflow:\s*"hidden"/.test(inner.text);
    if (outerVisible && outerNotHidden && hasInnerCrop) ok("table: outer overflow:visible, corner-mask moved to inner wrapper");
    else bad("table: outer overflow:visible, corner-mask moved to inner wrapper",
      `outerVisible=${outerVisible} outerNotHidden=${outerNotHidden} hasInnerCrop=${hasInnerCrop}`);
  }
}

// ── 3. isCols layout L/R columns: outer must not clip; inner keeps the crop
//      with a buffer so the block-level toolbar has escape room ───────────
{
  const start = src.indexOf('key="__cols-row"');
  if (start < 0) bad("__cols-row block found", "marker not found");
  else {
    const chunk = src.slice(start, start + 2500);
    const colBlocks = ["__cols-L", "__cols-R"].map((key) => {
      const kStart = chunk.indexOf(`key="${key}"`);
      return chunk.slice(kStart, kStart + 700);
    });
    let allOk = true, detail = [];
    for (let ci = 0; ci < colBlocks.length; ci++) {
      const block = colBlocks[ci];
      const outerMatch = block.match(/style=\{\{([^}]*)\}\}>/);
      const outerStyle = outerMatch ? outerMatch[1] : "";
      const outerVisible = /overflow:\s*"visible"/.test(outerStyle);
      const outerNotHidden = !/overflow:\s*"hidden"/.test(outerStyle);
      const hasInnerHidden = /overflow:\s*"hidden"/.test(block) && block.indexOf('overflow: "hidden"') > (outerMatch ? outerMatch.index + outerMatch[0].length - block.length : 0);
      // Simplest robust check: exactly one "hidden" overflow occurrence in the
      // block (the inner crop wrapper), and it comes after the outer's style block.
      const hiddenCount = (block.match(/overflow:\s*"hidden"/g) || []).length;
      const pad = /COL_TOOLBAR_PAD/.test(block);
      const good = outerVisible && outerNotHidden && hiddenCount === 1 && pad;
      if (!good) allOk = false;
      detail.push(`${ci === 0 ? "L" : "R"}: outerVisible=${outerVisible} outerNotHidden=${outerNotHidden} hiddenCount=${hiddenCount} pad=${pad}`);
    }
    if (allOk) ok("isCols L/R columns: outer overflow:visible, inner crop keeps a toolbar-escape buffer");
    else bad("isCols L/R columns: outer overflow:visible, inner crop keeps a toolbar-escape buffer", detail.join(" | "));
  }
}

// ── 4. Sanity: the block-level hover toolbar itself is untouched (still pokes
//      outside the block at top:-8/right:-8) — we fixed the clippers, not the
//      toolbar's intentional escape design. ────────────────────────────────
{
  const hasToolbarOffset = /top:\s*-8,\s*right:\s*-8/.test(src);
  if (hasToolbarOffset) ok("block-level hover toolbar keeps its top:-8/right:-8 escape offset");
  else bad("block-level hover toolbar keeps its top:-8/right:-8 escape offset");
}

console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
