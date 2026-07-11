// Regression test for CR4: block-level hover toolbar (the 🎯🔗💬👁✕ cluster
// rendered by renderBlockItem in part-blocks.jsx at top:-8/right:-8, just
// outside a block's own box) getting its circular buttons clipped.
//
// Root cause (confirmed by an in-browser repro): the toolbar is a DOM *sibling*
// of the block's own rendered root (both are children of the `data-block-type`
// wrapper), so a block's OWN overflow can never clip it. The genuine clipping
// ancestor is the isCols layout's L/R column wrappers (`overflow:"hidden"`,
// hugging their blocks with zero margin) — ANY block at a column's top/right
// edge had its toolbar cut there. The fix keeps the columns' OUTER wrapper
// overflow:"visible" and moves the vertical crop onto an inner wrapper nudged
// by COL_TOOLBAR_PAD so the toolbar has escape room.
//
// IMPORTANT — do NOT "fix" the code/table blocks by wrapping their content in an
// extra <div>: those own-overflow containers were never the toolbar's clip
// ancestor, AND the .pptx/PDF table extractors read the table root's DIRECT
// children as the grid rows (pptxExtractTables: `tableRoot.children` filtered to
// display:grid). An intermediate wrapper makes the rows grandchildren → the
// exporter finds tables=0. Checks 1–2 below guard that contract.
//
// Source-pattern test (CSS-in-JS strings, not a runnable function).
const fs = require("fs");
const path = require("path");

const SRC_PATH = path.join(__dirname, "..", "tools/vela-dev/app/parts/part-blocks.jsx");
const src = fs.readFileSync(SRC_PATH, "utf8");

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✅ " + n); };
const bad = (n, d) => { fail++; console.log("  ❌ " + n + (d ? " — " + d : "")); };

function extractCase(name) {
  const marker = `case "${name}": {`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`case "${name}" not found`);
  const braceStart = start + marker.length - 1;
  let i = braceStart, depth = 0;
  for (; i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(start, i);
}

// ── 1. table extractor contract: the FIRST element inside the table root must be
//      a grid row (headers / rows), NOT an intermediate wrapper div. This is
//      exactly what pptxExtractTables walks (tableRoot.children → display:grid). ─
{
  const caseSrc = extractCase("table");
  const rootIdx = caseSrc.indexOf("return <div className={cls}");
  const after = rootIdx >= 0 ? caseSrc.slice(rootIdx) : "";
  // The first child expression after the root's own style={{...}}> should be the
  // header/rows grid — recognizable by gridTemplateColumns. A plain wrapper
  // <div style={{ borderRadius: 8, overflow: "hidden" }}> with no grid is the
  // regression we are guarding against.
  const rootClose = after.indexOf("}}>");
  const body = rootClose >= 0 ? after.slice(rootClose + 3) : "";
  const firstDiv = body.indexOf("<div");
  const firstDivChunk = firstDiv >= 0 ? body.slice(firstDiv, firstDiv + 220) : "";
  const firstChildIsGrid = /gridTemplateColumns/.test(firstDivChunk);
  if (firstChildIsGrid) ok("table: grid rows are direct children of the table root (pptx extractor contract)");
  else bad("table: grid rows are direct children of the table root (pptx extractor contract)",
    `first child chunk: ${JSON.stringify(firstDivChunk.slice(0, 80))}`);
}

// ── 2. code block: single-container root (no extra content wrapper) — keeps the
//      block-root shape the extractors expect. ────────────────────────────────
{
  const start = src.indexOf("function CodeBlock(");
  const fnChunk = start >= 0 ? src.slice(start, start + 2000) : "";
  const rootIdx = fnChunk.indexOf("return <div className={cls}");
  const after = rootIdx >= 0 ? fnChunk.slice(rootIdx) : "";
  const rootClose = after.indexOf("}}>");
  const body = rootClose >= 0 ? after.slice(rootClose + 3) : "";
  // First child after the root should be the label/text (EditableText), not a
  // nested styled wrapper <div style={{...}}>.
  const firstDiv = body.indexOf("<div style={{");
  const firstEditable = body.indexOf("<EditableText");
  const noLeadingWrapper = firstEditable >= 0 && (firstDiv < 0 || firstEditable < firstDiv);
  if (noLeadingWrapper) ok("code block: content is a direct child of the block root (no extra wrapper)");
  else bad("code block: content is a direct child of the block root (no extra wrapper)",
    `firstEditable=${firstEditable} firstDiv=${firstDiv}`);
}

// ── 3. isCols layout L/R columns (the ACTUAL toolbar clip fix): outer wrapper
//      overflow:"visible", inner keeps the crop with a COL_TOOLBAR_PAD buffer. ──
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

// ── 4. Sanity: the block-level hover toolbar keeps its intentional escape offset ─
{
  const hasToolbarOffset = /top:\s*-8,\s*right:\s*-8/.test(src);
  if (hasToolbarOffset) ok("block-level hover toolbar keeps its top:-8/right:-8 escape offset");
  else bad("block-level hover toolbar keeps its top:-8/right:-8 escape offset");
}

console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
