// Narrow (portrait) layout: pure rules (src/parts/part-blocks.jsx).
//
// Covers narrowBlockView / narrowGridCols / narrowMaxWidth — the render-only
// block view that RenderBlock uses on a portrait canvas (a phone):
//   - column choice for grids (short cards 2-up, paragraphs and mixed media 1-up),
//   - flow / timeline direction, heading and number-row size steps,
//   - the view never changes `items` (an edit on a narrow canvas must write the
//     same patch as on a wide canvas) and never mutates the deck block,
//   - width values that reach CSS are built from parsed numbers only.
// The real geometry (nothing leaves the canvas) is covered in a browser by the
// "narrow-layout" UI suite (part-uitest2.jsx).
//
// Harness: same technique as test_story_logic.cjs — eval one contiguous slice
// of the part file in a `new Function` sandbox. No build, no browser.
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "src/parts/part-blocks.jsx"), "utf8");
const a = src.indexOf("// ── Narrow (portrait) layout ──");
const b = src.indexOf("const ItemHoverContext = React.createContext(null);");
if (a < 0 || b < 0 || b <= a) { console.error("FATAL: slice markers not found"); process.exit(1); }
const body = "var React = { createContext: function (v) { return { _default: v }; } };\n" + src.slice(a, b) +
  "\n;return { SlideNarrowContext, narrowBlockView, narrowGridCols, narrowMaxWidth, narrowTableCols, NARROW_WIDE_TYPES };";
let API;
// eslint-disable-next-line no-new-func
try { API = Function(body)(); } catch (e) { console.error("FATAL: sandbox eval failed:", (e && e.stack) || e); process.exit(1); }
const { SlideNarrowContext, narrowBlockView, narrowGridCols, narrowMaxWidth, narrowTableCols, NARROW_WIDE_TYPES } = API;

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✅ " + n); };
const bad = (n, d) => { fail++; console.log("  ❌ " + n + (d ? " — " + d : "")); };
const assert = (n, cond, d) => (cond ? ok(n) : bad(n, d));
const eq = (n, got, want) => assert(n, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const W = 404; // column width of a 412 px phone
const card = (title, text, extra) => ({ blocks: [{ type: "heading", text: title, size: "lg" }, { type: "text", text, size: "sm" }], ...(extra || {}) });
const PARA = "Only happy paths and trusted users were tested, so the signal never reached the cases that fail in production.";

console.log("\n── context ──");
eq("context default is 0 (a wide canvas)", SlideNarrowContext._default, 0);

console.log("\n── grid columns ──");
eq("4 short cards → 2-up", narrowGridCols({ type: "grid", cols: 4, items: [card("Scope", "only the project"), card("Deps", "audit first"), card("Secrets", "out of reach"), card("Costly", "a human step")] }, W), 2);
eq("3 cards that fit 2-up but not 3-up → 1-up (2 + 1 gives unequal cards)", narrowGridCols({ type: "grid", cols: 3, items: [card("Low risk", "Prototypes and internal tools: outcomes only"), card("Medium", "Product features: checks first, spot reads"), card("High", "Auth, schemas, payments: I read it")] }, W), 1);
eq("repeat(3, 1fr) template counts as 3 columns", narrowGridCols({ type: "grid", style: { gridTemplateColumns: "repeat(3,1fr)" }, items: [1, 2, 3].map((i) => ({ blocks: [{ type: "metric", value: `${i}0%`, label: "up", size: "2xl" }] })) }, W), 3);
eq("a template that is not a track list falls back to cols", narrowGridCols({ type: "grid", cols: 1, style: { gridTemplateColumns: "minmax(0, 1fr) fit-content(40%)" }, items: [card("A", "b"), card("C", "d")] }, W), 1);
// Type-check first: sanitizeStyle keeps finite numbers, so a style value can be a number.
eq("a number in a nested grid template does not throw", narrowGridCols({ type: "grid", cols: 2, items: [{ blocks: [{ type: "grid", cols: 1, style: { gridTemplateColumns: 2 }, items: [card("A", "b")] }] }, card("C", "d")] }, W), 2);
eq("a number template on the grid itself does not throw", narrowGridCols({ type: "grid", cols: 2, style: { gridTemplateColumns: 7 }, items: [card("A", "b"), card("C", "d")] }, W), 2);
eq("non-array blocks / items do not throw", narrowGridCols({ type: "grid", cols: 2, items: [{ blocks: "x" }, { blocks: [{ type: "grid", cols: 1, items: "y" }] }] }, W), 2);
eq("a string gap does not break the rule or the view", [narrowGridCols({ type: "grid", cols: 2, gap: "16px", items: [card("A", "b"), card("C", "d")] }, W), narrowBlockView({ type: "grid", cols: 2, gap: "16px", items: [card("A", "b"), card("C", "d")] }, W).gap], [2, 12]);
eq("3 paragraph cards → 1-up", narrowGridCols({ type: "grid", cols: 3, items: [card("One", PARA), card("Two", PARA), card("Three", PARA)] }, W), 1);
eq("text cell beside an image cell → 1-up", narrowGridCols({ type: "grid", cols: 2, items: [card("Title", "short"), { blocks: [{ type: "image", src: "data:image/png;base64,AA==" }] }] }, W), 1);
eq("image-only cells → 2-up", narrowGridCols({ type: "grid", cols: 4, items: [1, 2, 3, 4].map(() => ({ blocks: [{ type: "image", src: "data:image/png;base64,AA==" }] })) }, W), 2);
eq("a code cell → 1-up", narrowGridCols({ type: "grid", cols: 2, items: [card("A", "b"), { blocks: [{ type: "code", text: "x = 1" }] }] }, W), 1);
eq("a row-direction cell → 1-up", narrowGridCols({ type: "grid", cols: 2, items: [card("A", "b", { direction: "row" }), card("C", "d")] }, W), 1);
eq("3 one-line metrics → 3-up", narrowGridCols({ type: "grid", cols: 3, items: [1, 2, 3].map((i) => ({ blocks: [{ type: "metric", value: `${i}0%`, label: "up", size: "2xl" }] })) }, W), 3);
eq("columns come from style.gridTemplateColumns when set", narrowGridCols({ type: "grid", style: { gridTemplateColumns: "1fr 2.2fr" }, items: [card("A", "b"), card("C", "d")] }, W), 2);
eq("one cell → 1", narrowGridCols({ type: "grid", cols: 3, items: [card("A", "b")] }, W), 1);
eq("no items → 1", narrowGridCols({ type: "grid", cols: 3 }, W), 1);
eq("a wider column keeps longer cards 2-up", narrowGridCols({ type: "grid", cols: 2, items: [card("Better instruction", "Massive leverage and hands-on work again"), card("Better check", "Helps every run, without you")] }, 576), 2);

console.log("\n── view: grid ──");
{
  const items = [card("One", PARA), card("Two", PARA)];
  const deck = { type: "grid", cols: 2, gap: 48, items, style: { gridTemplateColumns: "1.3fr 1fr", alignItems: "center", width: "120%", minWidth: "700px" } };
  const frozen = JSON.stringify(deck);
  const v = narrowBlockView(deck, W);
  eq("cols follows the rule", v.cols, 1);
  assert("items is the same array (edits write the deck items)", v.items === items);
  eq("template is rebuilt from the column count", v.style.gridTemplateColumns, "repeat(1, minmax(0, 1fr))");
  assert("authored width / minWidth do not reach the narrow grid", !("width" in v.style) && !("minWidth" in v.style));
  eq("other style keys stay", v.style.alignItems, "center");
  assert("gap is capped", v.gap <= 18);
  eq("the deck block is not mutated", JSON.stringify(deck), frozen);
}

console.log("\n── view: flow / timeline ──");
const steps = (n, label) => Array.from({ length: n }, (_, i) => ({ label: `${label || "Step"} ${i}`, icon: "Circle" }));
eq("5-step flow → vertical", narrowBlockView({ type: "flow", items: steps(5) }, W).direction, "vertical");
eq("2-step flow stays horizontal", narrowBlockView({ type: "flow", items: steps(2) }, W).direction, undefined);
eq("3 steps with long labels → vertical", narrowBlockView({ type: "flow", items: steps(3, "Human designs, sets goals and constraints") }, W).direction, "vertical");
eq("4-point timeline → vertical", narrowBlockView({ type: "timeline", items: [1, 2, 3, 4].map((i) => ({ date: `Q${i}`, title: `Milestone ${i}` })) }, W).direction, "vertical");
{
  const f = { type: "flow", direction: "vertical", items: steps(3) };
  assert("an authored vertical flow is returned as is", narrowBlockView(f, W) === f);
  const g = { type: "flow", items: steps(5) };
  assert("flow items is the same array", narrowBlockView(g, W).items === g.items);
}

console.log("\n── view: text sizes and widths ──");
eq("a heading with a very long word steps down", narrowBlockView({ type: "heading", text: "Internationalization", size: "4xl" }, W).size !== "4xl", true);
eq("a short heading keeps its size", narrowBlockView({ type: "heading", text: "Thank you", size: "4xl" }, W).size, "4xl");
eq("heading maxWidth is dropped", narrowBlockView({ type: "heading", text: "Title", maxWidth: "60%" }, W).maxWidth, undefined);
eq("text maxWidth is dropped", narrowBlockView({ type: "text", text: "Body", maxWidth: 520 }, W).maxWidth, undefined);
eq("svg takes the column width", narrowBlockView({ type: "svg", markup: "<svg/>", maxWidth: "72%" }, W).maxWidth, "100%");
eq("spacer shrinks and is capped", [narrowBlockView({ type: "spacer", h: 16 }, W).h, narrowBlockView({ type: "spacer", h: 120 }, W).h], [12, 28]);
eq("number-row: long values step down", narrowBlockView({ type: "number-row", items: [{ value: "$480K" }, { value: "185K" }, { value: "22%" }] }, W).size, "2xl");
eq("icon-row with text → 1 column", narrowBlockView({ type: "icon-row", cols: 3, items: [{ title: "A", text: "long" }] }, W).cols, 1);
{
  const t = { type: "text", text: "plain" };
  assert("a block that needs no change is returned as is", narrowBlockView(t, W) === t);
  assert("a non-object is returned as is", narrowBlockView(null, W) === null && narrowBlockView("x", W) === "x");
  const q = { type: "quote", text: "q" };
  assert("an unlisted type is returned as is", narrowBlockView(q, W) === q);
}

console.log("\n── narrowMaxWidth (the only width strings that reach CSS) ──");
eq("null stays null", narrowMaxWidth(null), null);
eq("a small px logo keeps its size", narrowMaxWidth(120), "min(100%, 120px)");
eq("a small px string keeps its size", narrowMaxWidth("96px"), "min(100%, 96px)");
eq("20% of the wide canvas → px", narrowMaxWidth("20%"), "min(100%, 172px)");
eq("a wide px value → the column", narrowMaxWidth(520), "100%");
eq("a wide % value → the column", narrowMaxWidth("86%"), "100%");
// Fail closed: anything that is not a plain number / px / % becomes "100%".
for (const hostile of ["calc(100% - 1px)", "url(x)", "100px; position: fixed", "var(--x)", "min(1px, 2px)", {}, [], ["96px"], true, NaN, -5, "12em"]) {
  eq(`unknown value ${JSON.stringify(hostile)} → 100%`, narrowMaxWidth(hostile), "100%");
}
{
  const out = ["20%", 120, "96px", "86%", "x", 5000].map(narrowMaxWidth);
  assert("every result is 100% or min(100%, Npx)", out.every((v) => v === "100%" || /^min\(100%, \d+px\)$/.test(v)), JSON.stringify(out));
  const img = narrowBlockView({ type: "image", src: "data:image/png;base64,AA==", maxWidth: "url(https://x)" }, W);
  eq("image maxWidth goes through narrowMaxWidth", img.maxWidth, "100%");
  const free = { type: "image", src: "data:image/png;base64,AA==" };
  assert("an image with no maxWidth is returned as is", narrowBlockView(free, W) === free);
}

console.log("\n── table columns ──");
{
  const tpl = narrowTableCols(["Metric", "Before", "After", "Improvement"], [["Latency", "120 ms", "40 ms", "3x"], ["Errors", "2.1%", "0.3%", "7x"]], 4);
  const ws = tpl.split(" minmax").map((t) => parseFloat(t.replace(/^.*\(0, /, "")));
  assert("one weight per column, numbers only", /^(minmax\(0, \d+(\.\d+)?fr\) ?){4}$/.test(tpl), tpl);
  assert("the long header gets the widest column", ws[3] === Math.max(...ws), tpl);
  const odd = narrowTableCols(["a;b{}", { x: 1 }, null], [[["url(x)"], undefined, 12345678901234567890123456789012345]], 3);
  assert("unusual cell values still give numeric weights only", /^(minmax\(0, \d+(\.\d+)?fr\) ?){3}$/.test(odd), odd);
  assert("weights are clamped to 4..26", odd.match(/[\d.]+(?=fr)/g).every((v) => +v >= 4 && +v <= 26), odd);
  eq("no rows and no headers → the minimum weight", narrowTableCols([], [], 2), "minmax(0, 4fr) minmax(0, 4fr)");
}
console.log("\n── wide blocks in a cell ──");
assert("a table / funnel / checklist takes the full cell", ["table", "funnel", "checklist", "progress", "code"].every((t) => NARROW_WIDE_TYPES.has(t)));
assert("headings, texts, bullets and images keep their own width", ["heading", "text", "bullets", "image", "badge"].every((t) => !NARROW_WIDE_TYPES.has(t)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
