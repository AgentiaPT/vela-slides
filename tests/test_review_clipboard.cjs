// Behavioral tests for:
//   CR7 — slide `reviewed` flag (ingress allowlist + strict boolean), the
//         TOGGLE_SLIDE_REVIEWED / SET_REVIEW_PENDING reducer actions, and the
//         editor "Review pending only" navigation helper (findPendingSlide).
//   CR6 — block copy/paste: the {_velaBlock} envelope parser (shape + size
//         checks, sanitizeBlock on every pasted block) and the paste-location
//         planner (after the selected block, else end of slide).
// Same sandbox approach as test_reducer.cjs: eval the pure helper slice of
// part-imports.jsx + part-reducer.jsx + the top-level helper section of
// part-slidepanel.jsx in one Function scope. No DOM, no network.
const fs = require("fs");
const path = require("path");

const P = (f) => path.join(__dirname, "..", "src/parts", f);
const importsSrc = fs.readFileSync(P("part-imports.jsx"), "utf8");
const reducerSrc = fs.readFileSync(P("part-reducer.jsx"), "utf8");
const panelSrc = fs.readFileSync(P("part-slidepanel.jsx"), "utf8");

const sliceStart = importsSrc.indexOf("const uid = () => crypto.randomUUID");
const sliceEnd = importsSrc.indexOf("// ━━━ Themes");
const hStart = panelSrc.indexOf("// ── CR6: block clipboard");
const hEnd = panelSrc.indexOf("function SlidePanel(");
if (sliceStart < 0 || sliceEnd <= sliceStart || hStart < 0 || hEnd <= hStart) {
  console.error("FATAL: could not locate source slices");
  process.exit(1);
}

const prelude = `
  var VELA_PRESENTATION_MODE = false;
  var dbg = function () {};
  var crypto = (typeof globalThis !== "undefined" && globalThis.crypto) ? globalThis.crypto : {};
  var __clip = { text: "", deny: false, hang: false };
  var navigator = { clipboard: {
    writeText: async function (t) { if (__clip.deny) throw new Error("denied"); __clip.text = t; },
    readText: function () { if (__clip.hang) return new Promise(function () {}); if (__clip.deny) return Promise.reject(new Error("denied")); return Promise.resolve(__clip.text); } } };
  var velaClipboard = function () {};
`;
const combined = prelude + importsSrc.slice(sliceStart, sliceEnd) + "\n" + reducerSrc + "\n" +
  panelSrc.slice(hStart, hEnd) +
  "\n; return { reducer, init, NO_HISTORY, sanitizeSlide, sanitizeBlock, parseVelaBlockEnvelope," +
  " velaClipboardWriteBlock, velaClipboardReadBlocks, planBlockPaste, findPendingSlide, __clip," +
  " VELA_BLOCK_CLIP_MAX_CHARS, VELA_CLIP_READ_TIMEOUT_MS, isVelaBlockEnvelopeText, isEditableTarget, findPendingAfterDelete };";
let API;
try { API = Function(combined)(); } catch (e) { console.error("FATAL: sandbox eval failed:", e && e.stack || e); process.exit(1); }
const { reducer, init, NO_HISTORY, sanitizeSlide, parseVelaBlockEnvelope, velaClipboardWriteBlock,
  velaClipboardReadBlocks, planBlockPaste, findPendingSlide, __clip, VELA_BLOCK_CLIP_MAX_CHARS,
  VELA_CLIP_READ_TIMEOUT_MS, isVelaBlockEnvelopeText, isEditableTarget, findPendingAfterDelete } = API;

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✅ " + n); };
const bad = (n, d) => { fail++; console.log("  ❌ " + n + (d ? " — " + d : "")); };
const check = (cond, n, d) => (cond ? ok(n) : bad(n, d));
const eq = (n, a, b) => check(JSON.stringify(a) === JSON.stringify(b), n, `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

const S = (t, extra) => ({ title: t, duration: 60, blocks: [{ type: "heading", text: t }], ...(extra || {}) });
const deck = (slidesA, slidesB) => [{ id: "L1", title: "Lane", collapsed: false, items: [
  { id: "A", title: "A", status: "todo", importance: "should", order: 1, comments: [], slides: slidesA, createdAt: "t" },
  { id: "B", title: "B", status: "todo", importance: "should", order: 2, comments: [], slides: slidesB, createdAt: "t" },
] }];

(async () => {
  console.log("CR7 — ingress: `reviewed` is allowlisted, strict boolean");
  check(sanitizeSlide(S("x", { reviewed: true })).reviewed === true, "reviewed:true survives sanitizeSlide");
  for (const v of [false, "true", 1, {}, [true], null]) {
    check(!("reviewed" in sanitizeSlide(S("x", { reviewed: v }))), `reviewed:${JSON.stringify(v)} is dropped`);
  }

  console.log("CR7 — reducer");
  const st0 = { ...init, lanes: deck([S("a1"), S("a2")], [S("b1")]), selectedId: "A", slideIndex: 0 };
  const h0 = { past: [], present: st0, future: [] };
  const h1 = reducer(h0, { type: "TOGGLE_SLIDE_REVIEWED", id: "A", index: 1 });
  const a2 = h1.present.lanes[0].items[0].slides[1];
  check(a2.reviewed === true, "TOGGLE_SLIDE_REVIEWED sets reviewed:true");
  check(h1.past.length === 1, "TOGGLE_SLIDE_REVIEWED creates an undo step");
  const h2 = reducer(h1, { type: "TOGGLE_SLIDE_REVIEWED", id: "A", index: 1 });
  check(!("reviewed" in h2.present.lanes[0].items[0].slides[1]), "second toggle deletes the key (no reviewed:false)");
  check(h1.present.lanes[0].items[0].slides[0].reviewed === undefined, "other slides are untouched");
  check(init.reviewPending === false, "reviewPending defaults to false");
  check(NO_HISTORY.has("SET_REVIEW_PENDING"), "SET_REVIEW_PENDING is view-only (NO_HISTORY)");
  const h3 = reducer(h1, { type: "SET_REVIEW_PENDING", value: true });
  check(h3.present.reviewPending === true && h3.past.length === h1.past.length, "SET_REVIEW_PENDING toggles without an undo step");
  check(h3.present.reviewMode === false, "comments reviewMode is not reused");
  const h4 = reducer(h3, { type: "UNDO" });
  check(h4.present.reviewPending === true, "UNDO keeps the current pending-filter view state");
  check(!("reviewed" in h4.present.lanes[0].items[0].slides[1]), "UNDO reverts the reviewed toggle");

  console.log("CR7 — pending navigation");
  const L = deck([S("a1"), S("a2", { reviewed: true }), S("a3")], [S("b1", { reviewed: true }), S("b2")]);
  eq("next from A0 skips reviewed A1 -> A2", findPendingSlide(L, "A", 0, 1).target, { id: "A", index: 2 });
  eq("next from A2 crosses module, skips B0 -> B1", findPendingSlide(L, "A", 2, 1).target, { id: "B", index: 1 });
  const w = findPendingSlide(L, "B", 1, 1);
  eq("next from last pending wraps to A0", w.target, { id: "A", index: 0 });
  check(w.wrapped === true, "wrap is reported");
  eq("prev from A2 skips A1 -> A0", findPendingSlide(L, "A", 2, -1).target, { id: "A", index: 0 });
  eq("pending total counts unreviewed slides", findPendingSlide(L, "A", 0, 1).total, 3);
  eq("markCurrent excludes the current slide", findPendingSlide(L, "A", 0, 1, true).total, 2);
  const all = deck([S("a1", { reviewed: true })], [S("b1", { reviewed: true })]);
  const r0 = findPendingSlide(all, "A", 0, 1);
  check(r0.target === null && r0.total === 0, "all reviewed -> no target (stay on current slide)");
  const one = deck([S("a1"), S("a2", { reviewed: true })], []);
  const r1 = findPendingSlide(one, "A", 0, 1);
  check(r1.target === null && r1.total === 1, "only the current slide pending -> stay");
  const r2 = findPendingSlide(one, "A", 0, 1, true);
  check(r2.target === null && r2.total === 0, "marking the last pending slide -> all reviewed");
  const col = [{ ...deck([S("a1")], [S("b1")])[0], collapsed: true }];
  check(findPendingSlide(col, "A", 0, 1).total === 0, "collapsed lanes are skipped like editor nav");

  console.log("CR6 — envelope parse: shape, size, sanitizeBlock");
  const env = (data, extra) => JSON.stringify({ _velaBlock: true, v: 1, data, ...(extra || {}) });
  eq("valid envelope -> one block", parseVelaBlockEnvelope(env({ type: "text", text: "hi" })).map((b) => b.type), ["text"]);
  eq("array envelope -> blocks in order", parseVelaBlockEnvelope(env([{ type: "text", text: "1" }, { type: "heading", text: "2" }])).map((b) => b.text), ["1", "2"]);
  check(parseVelaBlockEnvelope(env({ type: "nope-type", text: "x" })).length === 0, "unknown block type is dropped");
  const san = parseVelaBlockEnvelope(env({ type: "text", text: "<b>x</b>", _private: 1, onClick: "x", id: "old" }))[0];
  check(san && !("_private" in san) && !("onClick" in san) && !("id" in san), "non-allowlisted / `_` keys / old ids are dropped");
  check(san && !/</.test(san.text), "text goes through sanitizeString");
  check(parseVelaBlockEnvelope(JSON.stringify({ _velaSlide: true, data: { type: "text", text: "x" } })).length === 0, "slide envelope is not a block envelope");
  check(parseVelaBlockEnvelope(JSON.stringify({ _velaBlock: "true", data: { type: "text" } })).length === 0, "_velaBlock must be strictly true");
  check(parseVelaBlockEnvelope(JSON.stringify([{ _velaBlock: true }])).length === 0, "top-level array is rejected");
  check(parseVelaBlockEnvelope("not json").length === 0, "non-JSON text is ignored");
  check(parseVelaBlockEnvelope(12).length === 0, "non-string input is ignored");
  check(parseVelaBlockEnvelope(env({ type: "text", text: "x".repeat(VELA_BLOCK_CLIP_MAX_CHARS) })).length === 0, "oversize envelope is rejected");
  check(parseVelaBlockEnvelope(env(Array.from({ length: 50 }, () => ({ type: "text", text: "t" })))).length === 30, "block count is capped at 30");
  check(parseVelaBlockEnvelope(env([null, 3, "s", [], { type: "text", text: "ok" }])).length === 1, "non-object entries are dropped");

  console.log("CR6 — clipboard round trip");
  __clip.text = ""; __clip.deny = false;
  await velaClipboardWriteBlock({ type: "callout", text: "copy me", _x: 1 });
  check(JSON.parse(__clip.text)._velaBlock === true, "copy writes a {_velaBlock} envelope");
  check(!("_x" in JSON.parse(__clip.text).data), "copy writes the sanitized block");
  eq("read returns the block", (await velaClipboardReadBlocks()).map((b) => b.text), ["copy me"]);
  __clip.text = JSON.stringify({ _velaSlide: true, v: 1, data: S("s") });
  check((await velaClipboardReadBlocks()).length === 0, "a slide on the system clipboard wins over the same-tab memo");
  __clip.deny = true;
  eq("read falls back to the same-tab memo when the clipboard is unreadable", (await velaClipboardReadBlocks()).map((b) => b.text), ["copy me"]);
  __clip.deny = false;
  // W2-3: readText() that never settles (no clipboard-read permission) must
  // not hang paste: the 800 ms race falls back to the same-tab memo.
  __clip.hang = true;
  const t0 = Date.now();
  const hung = await velaClipboardReadBlocks();
  const dt = Date.now() - t0;
  eq("hanging readText falls back to the same-tab memo", hung.map((b) => b.text), ["copy me"]);
  check(VELA_CLIP_READ_TIMEOUT_MS <= 1000 && dt < VELA_CLIP_READ_TIMEOUT_MS + 700, `hanging readText resolves near the timeout (${dt} ms)`);
  __clip.hang = false;

  console.log("CR6 — envelope never lands in a text field (W2-2)");
  check(isVelaBlockEnvelopeText(JSON.stringify({ _velaBlock: true, v: 1, data: { type: "text", text: "x" } })), "copied envelope is detected");
  check(isVelaBlockEnvelopeText("  " + JSON.stringify({ _velaBlock: true, data: {} }) + "\n"), "detected with surrounding whitespace");
  check(!isVelaBlockEnvelopeText("plain text"), "plain text is not an envelope");
  check(!isVelaBlockEnvelopeText(JSON.stringify({ _velaBlock: "true" })), "_velaBlock must be strictly true");
  check(!isVelaBlockEnvelopeText(JSON.stringify({ note: "_velaBlock" })), "a mention of the marker is not an envelope");
  check(!isVelaBlockEnvelopeText(JSON.stringify({ _velaSlide: true, data: {} })), "slide envelope is not a block envelope");
  check(!isVelaBlockEnvelopeText("{\"_velaBlock\": true, broken"), "broken JSON is not an envelope");
  check(isEditableTarget({ tagName: "DIV", isContentEditable: true }), "contentEditable counts as a text field");
  check(isEditableTarget({ tagName: "INPUT" }) && isEditableTarget({ tagName: "TEXTAREA" }), "input/textarea count as text fields");
  check(!isEditableTarget({ tagName: "DIV", isContentEditable: false }) && !isEditableTarget(null), "plain elements do not");
  check(/addEventListener\("paste", onPasteCapture, true\)/.test(panelSrc), "paste guard is a capture-phase window listener");
  check(/e\.key === "v" && !isEditableTarget\(document\.activeElement\)/.test(panelSrc), "Ctrl+V block/slide paste is skipped while a text field has focus");

  console.log("CR6 — paste location");
  const sl = { blocks: [{ type: "text" }, { type: "text" }], layout: "cols", L: [{ type: "text" }], R: [{ type: "text" }, { type: "text" }] };
  eq("cols slide, no selection -> end of the last (R) column", planBlockPaste(sl, null, 1), { key: "R", at: 2, newSelIdx: 5, selected: false });
  eq("selected block 0 -> after it", planBlockPaste(sl, 0, 1), { key: "blocks", at: 1, newSelIdx: 1, selected: true });
  eq("selected L block -> into L after it", planBlockPaste(sl, 2, 1), { key: "L", at: 1, newSelIdx: 3, selected: true });
  eq("selected R block -> into R after it", planBlockPaste(sl, 3, 2), { key: "R", at: 1, newSelIdx: 5, selected: true });
  eq("cols slide, stale selection -> end of the last (R) column", planBlockPaste(sl, 99, 1), { key: "R", at: 2, newSelIdx: 5, selected: false });
  // W2-1: the validator's slide — heading on top, L [text, bullets], R [text, callout].
  const gate = { blocks: [{ type: "heading" }], layout: "cols", L: [{ type: "text" }, { type: "bullets" }], R: [{ type: "text" }, { type: "callout" }] };
  eq("selected R callout (idx 4) -> into R after it, never the top blocks", planBlockPaste(gate, 4, 1), { key: "R", at: 2, newSelIdx: 5, selected: true });
  eq("selected R text (idx 3) -> into R between text and callout", planBlockPaste(gate, 3, 1), { key: "R", at: 1, newSelIdx: 4, selected: true });
  eq("cols slide with only L, no selection -> end of L", planBlockPaste({ blocks: [{ type: "heading" }], layout: "cols", L: [{ type: "text" }] }, null, 1), { key: "L", at: 1, newSelIdx: 2, selected: false });
  eq("non-cols slide, no selection -> end of slide.blocks", planBlockPaste({ blocks: [{ type: "text" }, { type: "text" }] }, null, 1), { key: "blocks", at: 2, newSelIdx: 2, selected: false });
  eq("L/R without layout cols are not rendered -> end of slide.blocks", planBlockPaste({ blocks: [{ type: "text" }], R: [{ type: "text" }] }, null, 1), { key: "blocks", at: 1, newSelIdx: 1, selected: false });
  check(/No block selected: pasted at end of \$\{where\}/.test(panelSrc), "no-selection rule is named in the status message");
  check(/pasteBlocks\(arr, n\)/.test(panelSrc), "paste inside a block's inline text editor goes after that block");
  check(planBlockPaste({ blocks: Array.from({ length: 30 }, () => ({ type: "text" })) }, null, 1) === null, "full slide (30 blocks) refuses paste");

  console.log("CR7 — delete the current slide in pending mode (W2-4)");
  const D = deck([S("a1"), S("a2", { reviewed: true }), S("a3")], [S("b1", { reviewed: true }), S("b2")]);
  const delA = deck([S("a1"), S("a2", { reviewed: true }), S("a3", { reviewed: true })], [S("b1", { reviewed: true }), S("b2")]);
  eq("anchor past module end -> next module's first pending (skips reviewed B0)", findPendingAfterDelete(delA, "A", 3).target, { id: "B", index: 1 });
  eq("anchor on a reviewed slide -> skips it to the next pending", findPendingAfterDelete(D, "A", 1).target, { id: "A", index: 2 });
  eq("anchor on a pending slide -> that slide", findPendingAfterDelete(D, "A", 0).target, { id: "A", index: 0 });
  eq("no pending after the anchor -> wraps to the first pending", findPendingAfterDelete(D, "B", 2).target, { id: "A", index: 0 });
  const none = findPendingAfterDelete(deck([S("a1", { reviewed: true })], [S("b1", { reviewed: true })]), "A", 0);
  check(none.target === null && none.total === 0, "no pending slides left -> no target (caller shows a message)");
  eq("module emptied by the delete -> next module", findPendingAfterDelete(deck([], [S("b1", { reviewed: true }), S("b2")]), "A", 0).target, { id: "B", index: 1 });
  check(/findPendingAfterDelete\(lanes, concept\.id/.test(panelSrc) && /Slide deleted · all slides reviewed/.test(panelSrc), "SlidePanel wires the delete hook and the none-left message");

  console.log("Reducer — REMOVE_SLIDE clamps slideIndex (gallery delete of a module's last slide)");
  const g0 = { past: [], present: { ...init, lanes: deck([S("a1"), S("a2")], [S("b1")]), selectedId: "A", slideIndex: 1 }, future: [] };
  check(reducer(g0, { type: "REMOVE_SLIDE", id: "A", index: 1 }).present.slideIndex === 0, "deleting the selected last slide clamps to the new last");
  check(reducer(g0, { type: "REMOVE_SLIDE", id: "A", index: 0 }).present.slideIndex === 0, "index past the end after an earlier delete clamps");
  const g1 = { ...g0, present: { ...g0.present, slideIndex: 1 } };
  check(reducer(g1, { type: "REMOVE_SLIDE", id: "B", index: 0 }).present.slideIndex === 1, "delete in another module leaves slideIndex alone");
  const g2 = { ...g0, present: { ...g0.present, lanes: deck([S("a1")], []), slideIndex: 0 } };
  check(reducer(g2, { type: "REMOVE_SLIDE", id: "A", index: 0 }).present.slideIndex === 0, "emptied module -> slideIndex 0");

  console.log("UI wiring (source)");
  for (const id of ["slide-reviewed-toggle", "review-pending-toggle", "block-copy-btn", "block-paste-btn", "review-status-msg"]) {
    check(panelSrc.includes(`data-testid="${id}"`), `data-testid ${id} exists`);
  }
  check(/state\.reviewPending && !fullscreen && !showGalleryRef\.current/.test(panelSrc), "pending nav is editor-only (not fullscreen/gallery)");
  check(fs.readFileSync(P("part-canvas.jsx"), "utf8").includes("data-block-index={i}"), "renderBlockItem exposes data-block-index for selection");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
