// Deck-ingress key allowlist (src/parts/part-imports.jsx).
//
// What this suite locks down: sanitizeSlide/sanitizeBlock build their result by
// iterating SAFE_SLIDE_KEYS / SAFE_BLOCK_KEYS instead of copying the caller's
// object, so an untrusted deck (file, clipboard, startup patch, Vera tool
// result) can only contribute fields the app actually reads. Three properties
// have to hold at once and are easy to break in opposite directions:
//
//   1. unknown + `_`-prefixed keys are DROPPED (the security property),
//   2. every key a renderer/exporter reads SURVIVES (the regression property —
//      sanitizeSlide also re-runs on every UPDATE_SLIDE, so a missing key is
//      lost continuously while editing and undo cannot recover it),
//   3. numeric layout fields are coerced + clamped, and grid nesting is bounded.
//
// Harness: same technique as test_reducer.cjs — eval one contiguous slice of
// part-imports.jsx (pure helpers through buildTitleCardSlide, no JSX, no DOM at
// definition time) inside a `new Function` sandbox. No build step, no browser.
const fs = require("fs");
const path = require("path");

const P = (f) => path.join(__dirname, "..", "src/parts", f);
// part-file families are split (MANIFEST.txt order) — concat for extraction.
const readPartFamily = (prefix) => {
  const partsDir = path.join(__dirname, "..", "src", "parts");
  const manifest = fs.readFileSync(path.join(partsDir, "MANIFEST.txt"), "utf8");
  return manifest.split("\n")
    .map((l) => l.split("#")[0].trim())
    .filter((n) => n === prefix + ".jsx" || n.startsWith(prefix + "-"))
    .map((n) => fs.readFileSync(path.join(partsDir, n), "utf8"))
    .join("\n");
};
const importsSrc = readPartFamily("part-imports");

const sliceStart = importsSrc.indexOf("const uid = () => crypto.randomUUID");
const sliceEnd = importsSrc.indexOf("// ━━━ Vela Logo Icon");
if (sliceStart < 0 || sliceEnd < 0 || sliceEnd <= sliceStart) {
  console.error("FATAL: could not locate helper slice markers in part-imports.jsx");
  process.exit(1);
}
const prelude = `
  var VELA_PRESENTATION_MODE = false;
  var dbg = function () {};
  var crypto = (typeof globalThis !== "undefined" && globalThis.crypto) ? globalThis.crypto : {};
`;
const combined = prelude + "\n" + importsSrc.slice(sliceStart, sliceEnd) + "\n" +
  "; return { sanitizeSlide, sanitizeBlock, sanitizeItem, validateAndSanitizeDeck," +
  " buildTitleCardSlide, SAFE_SLIDE_KEYS, SAFE_BLOCK_KEYS, SLIDE_NUMERIC_BOUNDS," +
  " MAX_BLOCK_DEPTH, MAX_SUBOBJECT_DEPTH };";

let API;
try {
  // eslint-disable-next-line no-new-func
  API = Function(combined)();
} catch (e) {
  console.error("FATAL: sandbox eval of part-imports slice failed:", (e && e.stack) || e);
  process.exit(1);
}
const {
  sanitizeSlide, sanitizeBlock, sanitizeItem, validateAndSanitizeDeck,
  buildTitleCardSlide, SAFE_SLIDE_KEYS, SAFE_BLOCK_KEYS, MAX_BLOCK_DEPTH,
} = API;

// ---- assertion harness (matches test_reducer.cjs print/exit contract) ----
let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✅ " + n); };
const bad = (n, d) => { fail++; console.log("  ❌ " + n + (d ? " — " + d : "")); };
const assert = (n, cond, d) => cond ? ok(n) : bad(n, d);

const baseSlide = (extra) => ({ duration: 60, blocks: [{ type: "heading", text: "H" }], ...(extra || {}) });

// ═══════════════════════════════════════════════════════════════════
// 1. Unknown keys are dropped
// ═══════════════════════════════════════════════════════════════════
{
  const s = sanitizeSlide(baseSlide({ bg: "#000", onmouseover: "x", constructor: "x", weird: 1 }));
  assert("slide: unknown key dropped", !("weird" in s) && !("onmouseover" in s));
  // ("constructor" in obj) is always true via the prototype — assert on OWN keys.
  assert("slide: prototype-shaped key never becomes an own property",
    !Object.prototype.hasOwnProperty.call(s, "constructor"));
  assert("slide: known keys survive alongside", s.bg === "#000" && s.duration === 60);

  const b = sanitizeBlock({ type: "heading", text: "H", evil: "x", onclick: "y" });
  assert("block: unknown key dropped", !("evil" in b) && !("onclick" in b));
  assert("block: known keys survive alongside", b.type === "heading" && b.text === "H");
}
{
  // The allowlist must not resurrect inherited properties.
  const proto = { weird: "inherited", title: "inherited" };
  const s = sanitizeSlide(Object.assign(Object.create(proto), { duration: 30, blocks: [] }));
  assert("slide: inherited property not copied", !("weird" in s) && s.title === undefined);
}

// ═══════════════════════════════════════════════════════════════════
// 2. `_`-prefixed keys are a reserved renderer-private namespace
// ═══════════════════════════════════════════════════════════════════
{
  const b = sanitizeBlock({ type: "image", src: "data:image/png;base64,AAA", _gridCell: true, _solo: true });
  assert("block: _gridCell from deck JSON dropped", b._gridCell === undefined);
  assert("block: _solo from deck JSON dropped", b._solo === undefined);

  const s = sanitizeSlide(baseSlide({ _virtual: true, _anything: 1 }));
  assert("slide: _virtual from deck JSON dropped (not forgeable)", s._virtual === undefined);
  assert("slide: arbitrary _ key dropped", s._anything === undefined);

  assert("no _ key is allowlisted (slide)", ![...SAFE_SLIDE_KEYS].some((k) => k.startsWith("_")));
  assert("no _ key is allowlisted (block)", ![...SAFE_BLOCK_KEYS].some((k) => k.startsWith("_")));
}
{
  // Internal code sets _ flags AFTER sanitization — that path must still work.
  const b = sanitizeBlock({ type: "image", src: "data:image/png;base64,AAA" });
  const marked = { ...b, _gridCell: true };
  assert("renderer may still set _gridCell post-sanitize", marked._gridCell === true && marked.type === "image");
}

// ═══════════════════════════════════════════════════════════════════
// 3. Virtual title cards survive a save → load round-trip
//    _virtual is DERIVED at render/export time from the item-level
//    `presentCard` flag; it is never persisted, so stripping it at ingress
//    cannot break title cards. This proves the whole round-trip.
// ═══════════════════════════════════════════════════════════════════
{
  const deck = {
    deckTitle: "D",
    lanes: [{ title: "L", items: [{ title: "Module A", presentCard: true, slides: [baseSlide({ duration: 40 })] }] }],
  };
  const loaded = validateAndSanitizeDeck(deck);
  const item = loaded.lanes[0].items[0];
  assert("round-trip: item.presentCard survives sanitizeItem", item.presentCard === true);

  const card = buildTitleCardSlide(item, loaded.lanes[0], null);
  assert("round-trip: title card is re-derived after load", !!card && card._virtual === true);
  assert("round-trip: title card carries the module title", JSON.stringify(card.blocks).includes("Module A"));
  assert("round-trip: title card reports the slide count", JSON.stringify(card.blocks).includes("1 slide"));

  // Second round-trip (save → load → save → load) must be stable.
  const again = validateAndSanitizeDeck(loaded);
  assert("round-trip: presentCard stable across a second load", again.lanes[0].items[0].presentCard === true);
  assert("round-trip: title card still builds after second load",
    buildTitleCardSlide(again.lanes[0].items[0], again.lanes[0], null)._virtual === true);
}
{
  // A module without presentCard must not gain a card.
  const loaded = validateAndSanitizeDeck({ deckTitle: "D", lanes: [{ title: "L", items: [{ title: "M", slides: [] }] }] });
  assert("round-trip: presentCard absent stays absent", !loaded.lanes[0].items[0].presentCard);
}

// ═══════════════════════════════════════════════════════════════════
// 4. Numeric layout fields: type + range at ingress
// ═══════════════════════════════════════════════════════════════════
{
  const ic = (v) => sanitizeSlide(baseSlide({ imageCols: v })).imageCols;
  assert("imageCols: 2147483647 clamps to 6", ic(2147483647) === 6);
  assert("imageCols: 3 preserved", ic(3) === 3);
  assert("imageCols: 0 clamps to 1", ic(0) === 1);
  assert("imageCols: -5 clamps to 1", ic(-5) === 1);
  assert("imageCols: 2.7 becomes an integer", Number.isInteger(ic(2.7)));
  assert("imageCols: numeric string coerced", ic("3") === 3);
  assert('imageCols: "3; x" dropped', ic("3; x") === undefined);
  assert("imageCols: NaN dropped", ic(NaN) === undefined);
  assert("imageCols: Infinity dropped", ic(Infinity) === undefined);
  assert("imageCols: object dropped", ic({}) === undefined);
  assert("imageCols: array dropped", ic([3]) === undefined);
  assert("imageCols: null dropped", ic(null) === undefined);
  assert("imageCols: empty string dropped", ic("") === undefined);
  assert("imageCols: absent stays absent", !("imageCols" in sanitizeSlide(baseSlide())));
}
{
  const g = (v) => sanitizeSlide(baseSlide({ gap: v })).gap;
  assert("gap: 16 preserved", g(16) === 16);
  assert("gap: 1e9 clamps to 200", g(1e9) === 200);
  assert("gap: negative clamps to 0", g(-40) === 0);
  assert('gap: "16px" dropped (not numeric)', g("16px") === undefined);

  const sg = (v) => sanitizeSlide(baseSlide({ splitGap: v })).splitGap;
  assert("splitGap: 32 preserved", sg(32) === 32);
  assert("splitGap: 99999 clamps to 200", sg(99999) === 200);

  const cf = (v) => sanitizeSlide(baseSlide({ contentFlex: v })).contentFlex;
  const iff = (v) => sanitizeSlide(baseSlide({ imageFlex: v })).imageFlex;
  assert("contentFlex: 3 preserved", cf(3) === 3);
  assert("contentFlex: 1e308 clamps to 20", cf(1e308) === 20);
  assert("contentFlex: 0 clamps to the 0.1 floor", cf(0) === 0.1);
  assert("imageFlex: 2 preserved", iff(2) === 2);
  assert("imageFlex: garbage dropped", iff("wide") === undefined);
}

// ═══════════════════════════════════════════════════════════════════
// 5. Grid recursion is depth-bounded (JSON-bomb / stack exhaustion)
// ═══════════════════════════════════════════════════════════════════
{
  // Build a grid nested `depth` levels deep with a marker heading at the bottom.
  const nest = (depth) => {
    let node = { type: "heading", text: "BOTTOM" };
    for (let i = 0; i < depth; i++) node = { type: "grid", cols: 1, items: [{ blocks: [node] }] };
    return node;
  };
  const levels = (b) => {
    let n = 0, cur = b;
    while (cur && cur.type === "grid") { n++; cur = cur.items && cur.items[0] && cur.items[0].blocks && cur.items[0].blocks[0]; }
    return { grids: n, bottom: cur };
  };

  const shallow = sanitizeBlock(nest(3));
  assert("depth 3 grid nesting is preserved end-to-end",
    levels(shallow).grids === 3 && levels(shallow).bottom && levels(shallow).bottom.text === "BOTTOM");

  const deep = sanitizeBlock(nest(6));
  const d = levels(deep);
  assert("depth-6 nested grid is truncated", d.grids <= MAX_BLOCK_DEPTH + 1, "grids=" + d.grids);
  assert("depth-6 nested grid drops the over-deep tail", !d.bottom || d.bottom.text !== "BOTTOM");
  assert("truncation prunes rather than throwing", deep !== null && deep.type === "grid");

  // `.map(sanitizeBlock)` would pass the array INDEX as the depth argument —
  // that regression silently drops the 5th+ block of any slide.
  const many = sanitizeSlide(baseSlide({
    blocks: Array.from({ length: 12 }, (_, i) => ({ type: "heading", text: "B" + i })),
  }));
  assert("array index never leaks into the depth parameter (slide.blocks)", many.blocks.length === 12);
  const cell = sanitizeBlock({
    type: "grid", cols: 1,
    items: [{ blocks: Array.from({ length: 8 }, (_, i) => ({ type: "text", text: "C" + i })) }],
  });
  assert("array index never leaks into the depth parameter (grid cell blocks)", cell.items[0].blocks.length === 8);
}

// ═══════════════════════════════════════════════════════════════════
// 6. Live keys survive — the regression half of the allowlist
//    sanitizeSlide re-runs on every UPDATE_SLIDE, so a key missing from the
//    allowlist is lost on the next edit and undo cannot bring it back.
// ═══════════════════════════════════════════════════════════════════
{
  const rich = {
    // renderer-critical layout keys that no example deck carries
    layout: "cols", L: [{ type: "text", text: "left" }], R: [{ type: "text", text: "right" }],
    contentFlex: 3, imageFlex: 2, splitGap: 28, imageCols: 3, gap: 16,
    bg: "#0f172a", bgGradient: "linear-gradient(135deg,#000,#111)", color: "#e2e8f0",
    mutedColor: "#94a3b8", accent: "#3b82f6", align: "center", verticalAlign: "center",
    padding: "36px 48px", duration: 45, title: "T", timeLock: true, hidden: true,
    notes: "presenter notes bar", speakerNotes: "markdown export notes",
    studyNotes: { text: "study" }, blocks: [{ type: "heading", text: "H" }],
  };
  const s = sanitizeSlide(rich);
  const lost = Object.keys(rich).filter((k) => s[k] === undefined);
  assert("every live slide key survives sanitizeSlide", lost.length === 0, "lost: " + lost.join(", "));
  assert("slide.notes and slide.speakerNotes stay distinct",
    s.notes === "presenter notes bar" && s.speakerNotes === "markdown export notes");
  assert("slide.layout + L/R survive together (cols layout renders)",
    s.layout === "cols" && s.L.length === 1 && s.R.length === 1);
  assert("slide.timeLock survives", s.timeLock === true);
  assert("slide.mutedColor survives", s.mutedColor === "#94a3b8");
}
{
  // One block per type carrying its full documented key set.
  const cases = [
    { type: "heading", text: "H", size: "2xl", weight: 700, color: "#fff", align: "left", icon: "Zap", iconColor: "#f00", maxWidth: "80%" },
    { type: "text", text: "T", size: "md", color: "#fff", align: "left", maxWidth: "80%", bold: true, italic: true },
    { type: "bullets", items: ["a"], gap: 8, size: "md", color: "#fff", dotColor: "#f00" },
    { type: "image", src: "data:image/png;base64,AAA", alt: "a", caption: "c", align: "center", fit: "cover", rounded: 8, shadow: true, maxWidth: "50%", maxHeight: "50%" },
    { type: "code", text: "x=1", label: "JS", size: "sm", bg: "#000", color: "#fff", copy: true, lang: "js" },
    { type: "grid", cols: 2, gap: 24, items: [{ blocks: [{ type: "text", text: "c" }] }] },
    { type: "callout", text: "C", title: "Ti", bg: "#111", border: "#f00", color: "#fff", icon: "Info", size: "md", reveal: true },
    { type: "metric", value: "42", label: "L", size: "4xl", color: "#fff", labelColor: "#aaa", icon: "TrendingUp", iconColor: "#f00", align: "center" },
    { type: "quote", text: "Q", author: "A", size: "xl", color: "#fff" },
    { type: "badge", text: "B", size: "xs", color: "#fff", bg: "#111", border: "#f00", icon: "Star" },
    { type: "icon", name: "Zap", size: "md", color: "#fff", bg: "#111", circle: true, strokeWidth: 2, label: "L", labelColor: "#aaa", align: "center" },
    { type: "icon-row", items: [{ icon: "Zap", title: "T" }], cols: 2, gap: 14, iconBg: "#111", iconColor: "#f00", iconShape: "square", titleSize: "sm", textSize: "sm", textColor: "#aaa", color: "#fff" },
    { type: "flow", items: [{ label: "S" }], direction: "vertical", connectorStyle: "dashed", arrowColor: "#f00", labelSize: "sm", labelColor: "#fff", sublabelSize: "xs", sublabelColor: "#aaa", iconBg: "#111", gateColor: "#0f0", gateIcon: "UserCheck", gateLabel: "G", loop: true, loopLabel: "again", loopColor: "#f00", loopStyle: "dotted", link: "https://example.com" },
    { type: "svg", markup: "<svg viewBox='0 0 10 10'></svg>", maxWidth: "80%", align: "center", bg: "#111", padding: "4px", rounded: true, caption: "c", captionColor: "#aaa", captionSize: "sm" },
    { type: "table", headers: ["A"], rows: [["1"]], striped: true, headerBg: "#111", headerColor: "#fff", cellColor: "#aaa", borderColor: "#333", size: "sm" },
    { type: "progress", items: [{ label: "L", value: 50 }], showValue: true, trackColor: "#111", height: 8, labelColor: "#aaa", size: "sm", gap: 14, leftLabel: "lo", rightLabel: "hi", leftIcon: "ArrowLeft", rightIcon: "ArrowRight", annotation: "note", annotationColor: "#aaa" },
    { type: "steps", items: [{ title: "S" }], lineColor: "#333", activeStep: 2, numberColor: "#f00", titleSize: "md", titleColor: "#fff", textSize: "sm", textColor: "#aaa" },
    { type: "tag-group", items: [{ text: "T" }], variant: "outline", gap: 8, size: "xs" },
    { type: "timeline", items: [{ title: "M" }], direction: "vertical", lineColor: "#333", dotColor: "#f00", dateColor: "#aaa", titleSize: "md", titleColor: "#fff", textSize: "sm", textColor: "#aaa" },
    { type: "comparison", items: [{ title: "A" }, { title: "B" }], dividerLabel: "VS", hideDivider: true, titleSize: "md", size: "sm" },
    { type: "funnel", items: [{ label: "S" }], link: "https://example.com" },
    { type: "cycle", items: [{ label: "S" }], centerLabel: "C", centerSub: "S", link: "https://example.com" },
    { type: "number-row", items: [{ value: "1" }], bordered: true, compact: true, size: "2xl", showIcons: true },
    { type: "matrix", quadrants: [{ title: "Q" }], xLeft: "l", xRight: "r", yTop: "t", yBottom: "b" },
    { type: "checklist", items: [{ text: "T" }], size: "sm", showLabels: true },
    { type: "spacer", h: 16 },
    { type: "divider", color: "#333", spacing: 12 },
  ];
  let lostAll = [];
  for (const c of cases) {
    const out = sanitizeBlock(c);
    if (!out) { lostAll.push(c.type + ":DROPPED"); continue; }
    for (const k of Object.keys(c)) if (out[k] === undefined) lostAll.push(c.type + "." + k);
  }
  assert("every documented block key survives sanitizeBlock", lostAll.length === 0, "lost: " + lostAll.join(", "));
  assert("all 27 block types covered by the survival check", cases.length === 27, "cases=" + cases.length);
}
{
  // `style` and per-item scrubbing still run on top of the allowlist copy.
  const b = sanitizeBlock({ type: "text", text: "T", style: { color: "#fff", position: "fixed" } });
  assert("block.style still filtered by SAFE_STYLE_KEYS", b.style.color === "#fff" && b.style.position === undefined);
  const ex = sanitizeBlock({ type: "text", text: "T", color: "url(https://x/?d=1)" });
  assert("color scalars still scrubbed after the allowlist copy", ex.color === undefined);
}

// ═══════════════════════════════════════════════════════════════════
// 7. Reconciliation — the other slide-key lists derive from the allowlist
// ═══════════════════════════════════════════════════════════════════
{
  const engineSrc = readPartFamily("part-engine");
  const slidesSrc = fs.readFileSync(P("part-slides.jsx"), "utf8");
  assert("part-engine SLIDE_ONLY_KEYS is derived from the allowlists",
    /SLIDE_ONLY_KEYS[\s\S]{0,400}SAFE_SLIDE_KEYS[\s\S]{0,120}SAFE_BLOCK_KEYS/.test(engineSrc));
  assert("part-slides SLIDE_KEYS is filtered through SAFE_SLIDE_KEYS",
    /SLIDE_KEYS\s*=\s*new Set\([\s\S]{0,400}SAFE_SLIDE_KEYS\.has/.test(slidesSrc));

  // The derivation must actually classify correctly.
  const slideOnly = new Set([...SAFE_SLIDE_KEYS].filter((k) => !SAFE_BLOCK_KEYS.has(k)).concat(["presentCard"]));
  for (const k of ["blocks", "bgGradient", "bgImage", "duration", "verticalAlign", "mutedColor",
                   "notes", "presentCard", "layout", "contentFlex", "imageFlex", "splitGap",
                   "speakerNotes", "timeLock", "L", "R"]) {
    if (!slideOnly.has(k)) bad("derived SLIDE_ONLY_KEYS keeps legacy member '" + k + "'");
  }
  ok("derived SLIDE_ONLY_KEYS covers every legacy member");
  const shared = ["bg", "color", "padding", "gap", "align", "title", "author", "hidden", "size"];
  assert("derived SLIDE_ONLY_KEYS never strips a shared slide/block key",
    shared.every((k) => !slideOnly.has(k)),
    shared.filter((k) => slideOnly.has(k)).join(", "));
  assert("'blocks' is slide-only (a blocks array belongs to a grid CELL, not a block)",
    !SAFE_BLOCK_KEYS.has("blocks") && SAFE_SLIDE_KEYS.has("blocks"));
}

// ═══════════════════════════════════════════════════════════════════
// 8. Existing sanitizer guarantees are unchanged by the allowlist rewrite
// ═══════════════════════════════════════════════════════════════════
{
  assert("unknown block type still dropped", sanitizeBlock({ type: "NOT_A_BLOCK", evil: true }) === null);
  assert("non-object block still dropped", sanitizeBlock("x") === null && sanitizeBlock(null) === null);
  assert("array block still dropped", sanitizeBlock([{ type: "heading" }]) === null);
  assert("non-object slide still dropped", sanitizeSlide(null) === null && sanitizeSlide(3) === null);
  assert("javascript: link still stripped", sanitizeBlock({ type: "text", text: "t", link: "javascript:alert(1)" }).link === "");
  assert("hidden coerced to a strict boolean (slide)", sanitizeSlide(baseSlide({ hidden: "yes" })).hidden === undefined);
  assert("hidden coerced to a strict boolean (block)", sanitizeBlock({ type: "text", text: "t", hidden: 1 }).hidden === undefined);
  const it = sanitizeItem({ title: "M", slides: [baseSlide()] });
  assert("sanitizeItem still yields usable slides", it.slides.length === 1 && it.slides[0].blocks.length === 1);
}

// ═══════════════════════════════════════════════════════════════════
// 9. Sub-object hardening — nested breadth cap (P1) + recursive scrub
//    and `_`-namespace drop on raw-spread sub-objects (P2)
// ═══════════════════════════════════════════════════════════════════
{
  // P1: a grid cell's blocks array is capped to 30 (matching the slide-level
  //     cap), so nested grids cannot bypass the 30-blocks/slide breadth limit.
  const cell40 = sanitizeBlock({
    type: "grid", cols: 1,
    items: [{ blocks: Array.from({ length: 40 }, (_, i) => ({ type: "text", text: "B" + i })) }],
  });
  assert("P1: grid cell with 40 blocks capped to 30", cell40.items[0].blocks.length === 30);
}
{
  // P2: `_`-prefixed / arbitrary keys on a grid cell; legit keys + blocks survive.
  const g = sanitizeBlock({
    type: "grid", cols: 2,
    items: [{ bg: "#111", align: "center", _gridCell: true, _evil: 1, blocks: [{ type: "text", text: "c" }] }],
  });
  const cell = g.items[0];
  assert("P2: _-prefixed key dropped from grid cell", cell._gridCell === undefined && cell._evil === undefined);
  assert("P2: legit grid-cell keys survive (bg/align/blocks)",
    cell.bg === "#111" && cell.align === "center" && cell.blocks.length === 1);
  // CSS auto-load value on a cell scalar is scrubbed through the recursive path.
  const g2 = sanitizeBlock({ type: "grid", cols: 1, items: [{ bg: "url(https://x/?d=1)", blocks: [] }] });
  assert("P2: CSS auto-load value scrubbed on a grid cell bg", g2.items[0].bg === undefined);
}
{
  // P2: list item `_` keys dropped; legit item keys survive + scalar scrub fires.
  const fl = sanitizeBlock({ type: "flow", items: [{ label: "S", color: "#f00", icon: "Zap", _solo: true }] });
  const it = fl.items[0];
  assert("P2: _-prefixed key dropped from list item", it._solo === undefined);
  assert("P2: legit list-item keys survive (label/color/icon)",
    it.label === "S" && it.color === "#f00" && it.icon === "Zap");
  const ir = sanitizeBlock({ type: "icon-row", items: [{ text: "t", iconColor: "url(https://x/?d=1)" }] });
  assert("P2: CSS auto-load value scrubbed on a list-item iconColor", ir.items[0].iconColor === undefined);
}
{
  // P2: matrix quadrant `_` keys dropped; legit quadrant keys survive.
  const mx = sanitizeBlock({
    type: "matrix",
    quadrants: [{ title: "Q", color: "#0f0", label: "L", _virtual: true }],
    xLeft: "l", xRight: "r", yTop: "t", yBottom: "b",
  });
  const q = mx.quadrants[0];
  assert("P2: _-prefixed key dropped from matrix quadrant", q._virtual === undefined);
  assert("P2: legit quadrant keys survive (title/color/label)",
    q.title === "Q" && q.color === "#0f0" && q.label === "L");
}
{
  // P2: recursion reaches NESTED comparison points (side.items[]).
  const cmp = sanitizeBlock({
    type: "comparison",
    items: [
      { title: "A", items: [{ text: "p1", _hidden: true, color: "#fff" }] },
      { title: "B", items: [{ text: "p2" }] },
    ],
  });
  const pt = cmp.items[0].items[0];
  assert("P2: _-prefixed key dropped from nested comparison point", pt._hidden === undefined);
  assert("P2: nested comparison point text/color survive", pt.text === "p1" && pt.color === "#fff");
  const cmp2 = sanitizeBlock({
    type: "comparison",
    items: [{ title: "A", items: [{ text: "p", color: "url(https://x/?d=1)" }] }],
  });
  assert("P2: CSS auto-load value scrubbed on a nested comparison point",
    cmp2.items[0].items[0].color === undefined);
}

// ── v13.25: sub-object scrubber must FAIL CLOSED and cover the paint families ──
// These are behavioral, driven through the real ingress entry point. The prior
// coverage for this area asserted on part-imports.jsx SOURCE text, which passes
// regardless of what the code does — both gaps below shipped green under it.
{
  const BEACON = "url(https://blocked.invalid/x)";

  // (1) Fail closed at the recursion cap. Nest a hostile object well past
  // MAX_SUBOBJECT_DEPTH: the over-deep subtree must be GONE, not merely
  // unvisited. Previously the guard returned early and left it intact, so the
  // deck chose whether the scrubbers ran at all.
  let deep = { bg: BEACON, marker: "DEEP" };
  for (let i = 0; i < API.MAX_SUBOBJECT_DEPTH + 4; i++) deep = { nest: deep };
  const g = sanitizeBlock({ type: "grid", items: [deep] });
  const flat = JSON.stringify(g.items);
  assert("v13.25: over-deep sub-object subtree is dropped, not passed through",
    !flat.includes("DEEP") && !flat.includes("blocked.invalid"));

  // (2) A legitimately shallow structure is untouched by that change.
  const shallow = sanitizeBlock({
    type: "comparison",
    items: [{ title: "A", items: [{ text: "p", label: "keep" }] }],
  });
  assert("v13.25: shallow nesting still survives the depth guard",
    shallow.items[0].items[0].label === "keep");

  // (3) Paint-family keys on raw-spread sub-objects. CSS_COLOR_KEY keys off
  // Vela's own field names, which cannot cover a key an untrusted deck invents.
  for (const k of ["background", "backgroundImage", "bgImage", "maskImage",
                   "WebkitMaskImage", "filter", "boxShadow", "clipPath"]) {
    const b = sanitizeBlock({ type: "flow", items: [{ text: "n", [k]: BEACON }] });
    assert(`v13.25: CSS auto-load scrubbed on sub-object '${k}'`,
      b.items[0][k] === undefined);
  }
  const q = sanitizeBlock({ type: "matrix", quadrants: [{ label: "q", bgImage: BEACON }] });
  assert("v13.25: CSS auto-load scrubbed on a matrix quadrant bgImage",
    q.quadrants[0].bgImage === undefined && q.quadrants[0].label === "q");

  // (4) Feature transparency — the widened pattern must not eat real content.
  // `link` carries a real URL (and so contains "://"), and `content` is a
  // documented TEXT field whose prose may legitimately mention one.
  const keep = sanitizeBlock({
    type: "flow",
    items: [{ text: "n", link: "https://example.com/docs", content: "see https://example.com",
              background: "#0f172a", cursor: "pointer", filter: "status:open" }],
  });
  const it = keep.items[0];
  assert("v13.25: legitimate sub-object link/content/paint values are preserved",
    it.link === "https://example.com/docs" && it.content === "see https://example.com" &&
    it.background === "#0f172a" && it.cursor === "pointer" && it.filter === "status:open");

  // (5) The top level must NOT get the paint-key treatment: slide.bgImage is a
  // real field holding a long data: URI that sanitizeSlide validates itself.
  const dataUri = "data:image/png;base64," + "A".repeat(900);
  const s = sanitizeSlide({ blocks: [], bgImage: dataUri });
  assert("v13.25: a legitimate slide bgImage data: URI still survives ingress",
    s.bgImage === dataUri);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
