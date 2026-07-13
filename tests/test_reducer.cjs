// Behavioral coverage for the Vela app reducer (src/parts/part-reducer.jsx).
//
// Problem this suite solves: prior notes (test_ux_logic.cjs) said "the reducer
// isn't safely extractable in isolation". It IS — the reducer only needs a fixed
// set of pure helpers + a few module-scoped mutable Sets from part-imports.jsx.
// We extract ONE contiguous slice of part-imports.jsx (from `const uid` through
// the STATUS_META block — all pure sanitizers + trackers, no browser calls at
// definition time), concatenate the whole part-reducer.jsx after it, and eval the
// combined source once inside a `new Function` sandbox that returns live handles
// to `reducer`, `innerReducer`, `init`, and the dirty-tracking Sets. Browser-only
// APIs (DOMParser, document, Image, atob) are referenced ONLY inside functions we
// never call from here, so no DOM/jsdom is required. No network, no build step.
//
// Every assertion dispatches a real action and checks the resulting state.
const fs = require("fs");
const path = require("path");

const P = (f) => path.join(__dirname, "..", "src/parts", f);
const importsSrc = fs.readFileSync(P("part-imports.jsx"), "utf8");
const reducerSrc = fs.readFileSync(P("part-reducer.jsx"), "utf8");

// --- extract the contiguous pure-helper slice from part-imports.jsx ---
const sliceStart = importsSrc.indexOf("const uid = () => crypto.randomUUID");
const sliceEnd = importsSrc.indexOf("// ━━━ Themes");
if (sliceStart < 0 || sliceEnd < 0 || sliceEnd <= sliceStart) {
  console.error("FATAL: could not locate helper slice markers in part-imports.jsx");
  process.exit(1);
}
const helperSlice = importsSrc.slice(sliceStart, sliceEnd);

// Prelude: only symbols the slice/reducer reference at top-level eval time that
// live OUTSIDE the slice. Browser globals used at call time (never triggered) are
// left undefined on purpose. `crypto` falls back so uid() uses its Math.random path.
const prelude = `
  var VELA_PRESENTATION_MODE = false;
  var dbg = function () {};
  var crypto = (typeof globalThis !== "undefined" && globalThis.crypto) ? globalThis.crypto : {};
`;

const combined = prelude + "\n" + helperSlice + "\n" + reducerSrc + "\n" +
  "; return { reducer, innerReducer, init, historyInit, NO_HISTORY, MAX_HISTORY," +
  " sanitizeSlide, STATUS_META, defaultBranding," +
  " _dirtyMods, _deletedMods, _loadedMods," +
  " getAutoEditItemId: function(){ return _autoEditItemId; }," +
  " getFullRewrite: function(){ return _fullRewrite; } };";

let API;
try {
  // eslint-disable-next-line no-new-func
  API = Function(combined)();
} catch (e) {
  console.error("FATAL: sandbox eval of reducer failed:", e && e.stack || e);
  process.exit(1);
}
const { reducer, innerReducer, init, NO_HISTORY, sanitizeSlide,
        _dirtyMods, _deletedMods, _loadedMods, getAutoEditItemId, getFullRewrite } = API;

// ---- tiny assertion harness (matches test_ux_logic.cjs print/exit contract) ----
let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✅ " + n); };
const bad = (n, d) => { fail++; console.log("  ❌ " + n + (d ? " — " + d : "")); };
const assert = (n, cond, d) => cond ? ok(n) : bad(n, d);
const eq = (n, a, b) => JSON.stringify(a) === JSON.stringify(b)
  ? ok(n) : bad(n, `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

// ---- state builders ----
let _c = 0;
const nid = (p) => (p || "id") + "_" + (++_c);
const slide = (mark, extra) => ({ title: "S" + (mark || ""), duration: 60, blocks: [{ type: "heading", text: "H" + (mark || "") }], _mark: mark, ...(extra || {}) });
const item = (id, slides, extra) => ({ id, title: "M-" + id, status: "todo", importance: "should", order: 1, comments: [], slides: slides || [], createdAt: "t0", ...(extra || {}) });
const lane = (id, items, extra) => ({ id, title: "L-" + id, collapsed: false, items: items || [], ...(extra || {}) });
const present = (lanes, sel, idx) => ({ ...init, lanes: lanes || [], selectedId: sel ?? null, slideIndex: idx ?? 0 });
const H = (p) => ({ past: [], present: p, future: [] });
// find an item across lanes by id
const findItem = (st, id) => { for (const l of st.lanes) { const it = l.items.find((i) => i.id === id); if (it) return it; } return null; };
const marks = (arr) => (arr || []).map((s) => s._mark);
const clearTrackers = () => { _dirtyMods.clear(); _deletedMods.clear(); _loadedMods.clear(); };

// ═══════════════════════════════════════════════════════════════════
// 1. LOAD — slideIndex clamp, veraMode reset, _loadedMods, _fullRewrite
// ═══════════════════════════════════════════════════════════════════
{
  clearTrackers();
  const it = item("m1", [slide(1), slide(2)]);
  const st = { ...present([lane("l1", [it])], "m1", 5), veraMode: "teacher", teacherLoading: true };
  const out = innerReducer(st, { type: "LOAD", payload: { lanes: [lane("l1", [it])], deckTitle: "Loaded" } });
  assert("LOAD clamps stale slideIndex to last slide", out.slideIndex === 1, "idx=" + out.slideIndex);
  assert("LOAD resets veraMode to editor", out.veraMode === "editor");
  assert("LOAD clears teacherLoading", out.teacherLoading === false);
  assert("LOAD marks modules loaded", _loadedMods.has("m1"));
  assert("LOAD sets _fullRewrite", getFullRewrite() === true);
  assert("LOAD carries payload deckTitle", out.deckTitle === "Loaded");
}
{
  // slideIndex within range is preserved
  const it = item("m1", [slide(1), slide(2), slide(3)]);
  const out = innerReducer(present([lane("l1", [it])], "m1", 1), { type: "LOAD", payload: { lanes: [lane("l1", [it])] } });
  assert("LOAD keeps in-range slideIndex", out.slideIndex === 1);
}

// ═══════════════════════════════════════════════════════════════════
// 2. Lane actions
// ═══════════════════════════════════════════════════════════════════
{
  const st = present([lane("l1", [])]);
  const out = innerReducer(st, { type: "ADD_LANE", title: "New Lane" });
  assert("ADD_LANE appends a lane", out.lanes.length === 2 && out.lanes[1].title === "New Lane");
  const dup = innerReducer(out, { type: "ADD_LANE", title: "new lane" });
  assert("ADD_LANE dedupes case-insensitively (identity return)", dup === out);
}
{
  clearTrackers();
  const st = present([lane("l1", [item("m1", [])]), lane("l2", [])], "m1");
  const out = innerReducer(st, { type: "REMOVE_LANE", id: "l1" });
  assert("REMOVE_LANE drops the lane", out.lanes.length === 1 && out.lanes[0].id === "l2");
  assert("REMOVE_LANE clears selectedId", out.selectedId === null);
  assert("REMOVE_LANE marks contained modules deleted", _deletedMods.has("m1"));
}
{
  const out = innerReducer(present([lane("l1", [])]), { type: "RENAME_LANE", id: "l1", title: "Renamed" });
  assert("RENAME_LANE updates title", out.lanes[0].title === "Renamed");
}
{
  const out = innerReducer(present([lane("l1", [], { collapsed: false })]), { type: "TOGGLE_LANE", id: "l1" });
  assert("TOGGLE_LANE flips collapsed", out.lanes[0].collapsed === true);
}

// ═══════════════════════════════════════════════════════════════════
// 3. Item lifecycle
// ═══════════════════════════════════════════════════════════════════
{
  const out = innerReducer(present([lane("l1", [item("m1", [])])], "m1"), { type: "SET_ITEM_NOTES", id: "m1", notes: "hello" });
  assert("SET_ITEM_NOTES sets notes", findItem(out, "m1").notes === "hello");
}
{
  clearTrackers();
  const st = present([lane("l1", [])]);
  const out = innerReducer(st, { type: "ADD_ITEM", laneId: "l1", title: "Sec", slides: [slide(1)] });
  const created = out.lanes[0].items[0];
  assert("ADD_ITEM appends an item", out.lanes[0].items.length === 1 && created.title === "Sec");
  assert("ADD_ITEM sanitizes + keeps slides", created.slides.length === 1 && created.slides[0]._mark === 1);
  assert("ADD_ITEM marks module dirty (had slides)", _dirtyMods.has(created.id));
  assert("ADD_ITEM marks module loaded", _loadedMods.has(created.id));
  const noLane = innerReducer(st, { type: "ADD_ITEM", laneId: "nope", title: "x" });
  assert("ADD_ITEM no-op when lane missing", noLane === st);
}
{
  // INSERT_ITEM afterId / order renumber / autoEdit / select
  const its = [item("a", []), item("b", []), item("c", [])].map((x, i) => ({ ...x, order: i + 1 }));
  const out = innerReducer(present([lane("l1", its)]), { type: "INSERT_ITEM", laneId: "l1", title: "Ins", afterId: "a" });
  const ids = out.lanes[0].items.map((i) => i.id);
  assert("INSERT_ITEM inserts after afterId", ids[0] === "a" && ids[2] === "b", ids.join(","));
  assert("INSERT_ITEM renumbers order 1..n", out.lanes[0].items.every((i, k) => i.order === k + 1));
  assert("INSERT_ITEM selects the new item", out.selectedId === ids[1] && out.slideIndex === 0);
  assert("INSERT_ITEM sets autoEdit id", getAutoEditItemId() === ids[1]);
}
{
  // INSERT_ITEM beforeId
  const its = [item("a", []), item("b", [])].map((x, i) => ({ ...x, order: i + 1 }));
  const out = innerReducer(present([lane("l1", its)]), { type: "INSERT_ITEM", laneId: "l1", title: "Ins", beforeId: "b" });
  const ids = out.lanes[0].items.map((i) => i.id);
  assert("INSERT_ITEM inserts before beforeId", ids[0] === "a" && ids[2] === "b" && ids[1] !== "a" && ids[1] !== "b", ids.join(","));
}
{
  // INSERT_ITEM with no lanes creates a lane
  const out = innerReducer(present([]), { type: "INSERT_ITEM", title: "First", laneTitle: "Slides" });
  assert("INSERT_ITEM creates a lane when none exist", out.lanes.length === 1 && out.lanes[0].items.length === 1);
}

// ═══════════════════════════════════════════════════════════════════
// 4. SPLIT_ITEM_AT — index math (mid split / top / bottom)
// ═══════════════════════════════════════════════════════════════════
{
  clearTrackers();
  const src = item("src", [slide(1), slide(2), slide(3), slide(4)]);
  const out = innerReducer(present([lane("l1", [src])]), { type: "SPLIT_ITEM_AT", laneId: "l1", id: "src", index: 2 });
  const its = out.lanes[0].items;
  assert("SPLIT mid: source keeps head slices", marks(its[0].slides).join() === "1,2", marks(its[0].slides).join());
  assert("SPLIT mid: new section gets tail slices", marks(its[1].slides).join() === "3,4", marks(its[1].slides).join());
  assert("SPLIT mid: new section inserted AFTER source", its[0].id === "src" && its[1].id !== "src");
  assert("SPLIT mid: selects new section", out.selectedId === its[1].id && out.slideIndex === 0);
  assert("SPLIT marks both modules dirty", _dirtyMods.has("src") && _dirtyMods.has(its[1].id));
}
{
  const src = item("src", [slide(1), slide(2)]);
  const out = innerReducer(present([lane("l1", [src])]), { type: "SPLIT_ITEM_AT", laneId: "l1", id: "src", index: 0 });
  const its = out.lanes[0].items;
  assert("SPLIT idx0: new empty section inserted BEFORE, source keeps all", its[0].id !== "src" && its[0].slides.length === 0 && its[1].id === "src" && its[1].slides.length === 2);
}
{
  const src = item("src", [slide(1), slide(2)]);
  const out = innerReducer(present([lane("l1", [src])]), { type: "SPLIT_ITEM_AT", laneId: "l1", id: "src", index: 99 });
  const its = out.lanes[0].items;
  assert("SPLIT idx>=len: new empty section AFTER, source keeps all", its[0].id === "src" && its[0].slides.length === 2 && its[1].slides.length === 0);
}

// ═══════════════════════════════════════════════════════════════════
// 5. IMPORT_CONCEPTS / BATCH_ADD
// ═══════════════════════════════════════════════════════════════════
{
  clearTrackers();
  const out = innerReducer(present([]), { type: "IMPORT_CONCEPTS", concepts: [{ title: "C1", slides: [slide(1)] }, { title: "C2", slides: [] }] });
  assert("IMPORT_CONCEPTS builds a default lane + items", out.lanes.length === 1 && out.lanes[0].items.length === 2);
  assert("IMPORT_CONCEPTS selects first imported", out.selectedId === out.lanes[0].items[0].id);
  assert("IMPORT_CONCEPTS marks slide-bearing module dirty", _dirtyMods.has(out.lanes[0].items[0].id));
}
{
  const out = innerReducer(present([lane("l1", [])]), { type: "BATCH_ADD", laneId: "l1", items: ["Title only", { title: "Obj", slides: [slide(9)] }] });
  const its = out.lanes[0].items;
  assert("BATCH_ADD adds string + object items", its.length === 2 && its[0].title === "Title only" && its[1].title === "Obj");
  assert("BATCH_ADD assigns sequential order", its[0].order === 1 && its[1].order === 2);
}

// ═══════════════════════════════════════════════════════════════════
// 6. Item status / importance / move / reorder / remove
// ═══════════════════════════════════════════════════════════════════
{
  clearTrackers();
  const out = innerReducer(present([lane("l1", [item("m1", [])])], "m1"), { type: "REMOVE_ITEM", id: "m1" });
  assert("REMOVE_ITEM removes item + clears selection", out.lanes[0].items.length === 0 && out.selectedId === null);
  assert("REMOVE_ITEM marks module deleted", _deletedMods.has("m1"));
}
{
  const out = innerReducer(present([lane("l1", [item("m1", [])])]), { type: "RENAME_ITEM", id: "m1", title: "R" });
  assert("RENAME_ITEM renames", findItem(out, "m1").title === "R");
}
{
  // CYCLE_STATUS: todo -> done -> signed-off (signedOffAt set) -> todo (cleared)
  let st = present([lane("l1", [item("m1", [], { status: "todo" })])]);
  st = innerReducer(st, { type: "CYCLE_STATUS", id: "m1" });
  assert("CYCLE_STATUS todo->done", findItem(st, "m1").status === "done");
  st = innerReducer(st, { type: "CYCLE_STATUS", id: "m1" });
  assert("CYCLE_STATUS done->signed-off + signedOffAt", findItem(st, "m1").status === "signed-off" && !!findItem(st, "m1").signedOffAt);
  st = innerReducer(st, { type: "CYCLE_STATUS", id: "m1" });
  assert("CYCLE_STATUS signed-off->todo clears signedOffAt", findItem(st, "m1").status === "todo" && findItem(st, "m1").signedOffAt === undefined);
}
{
  const out = innerReducer(present([lane("l1", [item("m1", [])])]), { type: "SET_STATUS", id: "m1", status: "done" });
  assert("SET_STATUS sets status directly", findItem(out, "m1").status === "done");
  const out2 = innerReducer(present([lane("l1", [item("m1", [])])]), { type: "SET_IMPORTANCE", id: "m1", importance: "must" });
  assert("SET_IMPORTANCE sets importance", findItem(out2, "m1").importance === "must");
}
{
  const out = innerReducer(present([lane("l1", [item("m1", [], { presentCard: false })])]), { type: "TOGGLE_PRESENT_CARD", id: "m1" });
  assert("TOGGLE_PRESENT_CARD flips presentCard", findItem(out, "m1").presentCard === true);
}
{
  // MOVE_ITEM across lanes
  const out = innerReducer(present([lane("l1", [item("m1", [])]), lane("l2", [])], "m1"), { type: "MOVE_ITEM", id: "m1", targetLaneId: "l2" });
  assert("MOVE_ITEM relocates item to target lane", out.lanes[0].items.length === 0 && out.lanes[1].items.length === 1 && out.lanes[1].items[0].id === "m1");
}
{
  // REORDER up/down within lane + boundary no-op
  const its = [item("a", []), item("b", []), item("c", [])].map((x, i) => ({ ...x, order: i + 1 }));
  const up = innerReducer(present([lane("l1", its)]), { type: "REORDER", id: "b", dir: "up" });
  assert("REORDER up swaps with predecessor", up.lanes[0].items.map((i) => i.id).join() === "b,a,c");
  const top = innerReducer(present([lane("l1", its)]), { type: "REORDER", id: "a", dir: "up" });
  assert("REORDER up at top is a no-op", top.lanes[0].items.map((i) => i.id).join() === "a,b,c");
}
{
  // DRAG_REORDER: move c before a in same lane
  const its = [item("a", []), item("b", []), item("c", [])].map((x, i) => ({ ...x, order: i + 1 }));
  const st = present([lane("l1", its)]);
  const out = innerReducer(st, { type: "DRAG_REORDER", id: "c", targetLaneId: "l1", beforeId: "a" });
  assert("DRAG_REORDER places item before beforeId", out.lanes[0].items.map((i) => i.id).join() === "c,a,b", out.lanes[0].items.map((i) => i.id).join());
  const miss = innerReducer(st, { type: "DRAG_REORDER", id: "zzz", targetLaneId: "l1" });
  assert("DRAG_REORDER unknown id returns same state (identity)", miss === st);
}

// ═══════════════════════════════════════════════════════════════════
// 7. Slide mutations (sanitize chokepoint)
// ═══════════════════════════════════════════════════════════════════
{
  clearTrackers();
  const out = innerReducer(present([lane("l1", [item("m1", [slide(1)])])], "m1"), { type: "SET_SLIDES", id: "m1", slides: [slide(2), slide(3)] });
  assert("SET_SLIDES replaces slide list", marks(findItem(out, "m1").slides).join() === "2,3");
  assert("SET_SLIDES marks dirty", _dirtyMods.has("m1"));
}
{
  // SET_SLIDES sanitizes: an unsafe block type is dropped
  const out = innerReducer(present([lane("l1", [item("m1", [])])], "m1"), { type: "SET_SLIDES", id: "m1", slides: [{ title: "x", blocks: [{ type: "heading", text: "ok" }, { type: "totally-bogus" }] }] });
  assert("SET_SLIDES drops unknown block types (re-sanitize)", findItem(out, "m1").slides[0].blocks.length === 1);
}
{
  const out = innerReducer(present([lane("l1", [item("m1", [slide(1)])])], "m1"), { type: "ADD_SLIDE", id: "m1", slide: slide(2) });
  assert("ADD_SLIDE appends", marks(findItem(out, "m1").slides).join() === "1,2");
}
{
  const out = innerReducer(present([lane("l1", [item("m1", [slide(1), slide(3)])])], "m1"), { type: "INSERT_SLIDE", id: "m1", index: 1, slide: slide(2) });
  assert("INSERT_SLIDE splices at index", marks(findItem(out, "m1").slides).join() === "1,2,3");
}
{
  // UPDATE_SLIDE merge:true keeps other fields
  const s = slide(1, { subtitle: "orig" });
  const out = innerReducer(present([lane("l1", [item("m1", [s])])], "m1"), { type: "UPDATE_SLIDE", id: "m1", index: 0, merge: true, patch: { title: "New" } });
  const r = findItem(out, "m1").slides[0];
  assert("UPDATE_SLIDE merge keeps unrelated fields", r.title === "New" && r.subtitle === "orig");
}
{
  // UPDATE_SLIDE replace (merge:false) preserves only title+duration
  const s = slide(1, { subtitle: "orig", duration: 30 });
  const out = innerReducer(present([lane("l1", [item("m1", [s])])], "m1"), { type: "UPDATE_SLIDE", id: "m1", index: 0, merge: false, patch: { blocks: [{ type: "heading", text: "z" }] } });
  const r = findItem(out, "m1").slides[0];
  assert("UPDATE_SLIDE replace drops unrelated fields, keeps title+duration", r.subtitle === undefined && r.duration === 30 && r.blocks[0].text === "z");
}
{
  // UPDATE_SLIDE timeLock: replace with no duration/timeLock in patch keeps both
  const s = slide(1, { duration: 45, timeLock: true });
  const out = innerReducer(present([lane("l1", [item("m1", [s])])], "m1"), { type: "UPDATE_SLIDE", id: "m1", index: 0, merge: false, patch: { blocks: [{ type: "heading", text: "z" }] } });
  const r = findItem(out, "m1").slides[0];
  assert("UPDATE_SLIDE honors timeLock (duration + flag preserved)", r.timeLock === true && r.duration === 45);
}
{
  // UPDATE_SLIDE re-sanitize scrubs a CSS auto-load color scalar
  const out = innerReducer(present([lane("l1", [item("m1", [slide(1)])])], "m1"), { type: "UPDATE_SLIDE", id: "m1", index: 0, merge: true, patch: { bg: "url(http://x/a.png)" } });
  const r = findItem(out, "m1").slides[0];
  assert("UPDATE_SLIDE scrubs unsafe bg (sanitize chokepoint)", !("bg" in r), JSON.stringify(r.bg));
}
{
  const out = innerReducer(present([lane("l1", [item("m1", [slide(1), slide(2), slide(3)])])], "m1"), { type: "REMOVE_SLIDE", id: "m1", index: 1 });
  assert("REMOVE_SLIDE removes at index", marks(findItem(out, "m1").slides).join() === "1,3");
}
{
  // TOGGLE_SLIDE_HIDDEN sets then clears hidden
  let st = present([lane("l1", [item("m1", [slide(1)])])], "m1");
  st = innerReducer(st, { type: "TOGGLE_SLIDE_HIDDEN", id: "m1", index: 0 });
  assert("TOGGLE_SLIDE_HIDDEN sets hidden=true", findItem(st, "m1").slides[0].hidden === true);
  st = innerReducer(st, { type: "TOGGLE_SLIDE_HIDDEN", id: "m1", index: 0 });
  assert("TOGGLE_SLIDE_HIDDEN removes hidden key on re-toggle", !("hidden" in findItem(st, "m1").slides[0]));
}
{
  const out = innerReducer(present([lane("l1", [item("m1", [slide(1), slide(2)])])], "m1"), { type: "DUPLICATE_SLIDE", id: "m1", index: 0 });
  const sl = findItem(out, "m1").slides;
  assert("DUPLICATE_SLIDE inserts a copy after index", marks(sl).join() === "1,1,2" && sl[0] !== sl[1]);
}
{
  // MOVE_SLIDE swap + boundary no-op
  const up = innerReducer(present([lane("l1", [item("m1", [slide(1), slide(2), slide(3)])])], "m1"), { type: "MOVE_SLIDE", id: "m1", from: 1, dir: -1 });
  assert("MOVE_SLIDE dir=-1 swaps with predecessor", marks(findItem(up, "m1").slides).join() === "2,1,3");
  const boundary = innerReducer(present([lane("l1", [item("m1", [slide(1), slide(2)])])], "m1"), { type: "MOVE_SLIDE", id: "m1", from: 0, dir: -1 });
  assert("MOVE_SLIDE past boundary is a no-op", marks(findItem(boundary, "m1").slides).join() === "1,2");
}
{
  const out = innerReducer(present([lane("l1", [item("m1", [slide(1), slide(2), slide(3)])])], "m1"), { type: "REORDER_SLIDE", id: "m1", from: 0, to: 2 });
  assert("REORDER_SLIDE moves from->to", marks(findItem(out, "m1").slides).join() === "2,3,1");
}
{
  // MOVE_SLIDE_TO_MODULE without toIndex (append), slideIndex -> tail
  clearTrackers();
  const st = present([lane("l1", [item("A", [slide(1), slide(2)]), item("B", [slide(9)])])], "A", 0);
  const out = innerReducer(st, { type: "MOVE_SLIDE_TO_MODULE", fromId: "A", toId: "B", index: 0 });
  assert("MOVE_SLIDE_TO_MODULE removes slide from source", marks(findItem(out, "A").slides).join() === "2");
  assert("MOVE_SLIDE_TO_MODULE appends slide to target", marks(findItem(out, "B").slides).join() === "9,1");
  assert("MOVE_SLIDE_TO_MODULE selects target + tail index", out.selectedId === "B" && out.slideIndex === 1);
  assert("MOVE_SLIDE_TO_MODULE marks both dirty", _dirtyMods.has("A") && _dirtyMods.has("B"));
}
{
  // MOVE_SLIDE_TO_MODULE with explicit toIndex
  const st = present([lane("l1", [item("A", [slide(1), slide(2)]), item("B", [slide(8), slide(9)])])], "A", 0);
  const out = innerReducer(st, { type: "MOVE_SLIDE_TO_MODULE", fromId: "A", toId: "B", index: 1, toIndex: 1 });
  assert("MOVE_SLIDE_TO_MODULE inserts at toIndex", marks(findItem(out, "B").slides).join() === "8,2,9");
  assert("MOVE_SLIDE_TO_MODULE uses toIndex as slideIndex", out.slideIndex === 1);
}

// ═══════════════════════════════════════════════════════════════════
// 8. Selection / view flags
// ═══════════════════════════════════════════════════════════════════
{
  const out = innerReducer(present([]), { type: "SELECT", id: "m1", slideIndex: 3 });
  assert("SELECT sets selectedId + slideIndex", out.selectedId === "m1" && out.slideIndex === 3);
  const out2 = innerReducer(present([]), { type: "SELECT", id: "m2" });
  assert("SELECT defaults slideIndex to 0", out2.slideIndex === 0);
}
{
  assert("SET_SLIDE_INDEX sets index", innerReducer(present([]), { type: "SET_SLIDE_INDEX", index: 7 }).slideIndex === 7);
  const fs = innerReducer({ ...present([]), fontScale: 2 }, { type: "SET_FULLSCREEN", value: false });
  assert("SET_FULLSCREEN off resets fontScale to 1", fs.fullscreen === false && fs.fontScale === 1);
  const fsOn = innerReducer({ ...present([]), fontScale: 2 }, { type: "SET_FULLSCREEN", value: true });
  assert("SET_FULLSCREEN on keeps fontScale", fsOn.fullscreen === true && fsOn.fontScale === 2);
  assert("SET_FONT_SCALE sets scale", innerReducer(present([]), { type: "SET_FONT_SCALE", value: 1.5 }).fontScale === 1.5);
  const de = innerReducer({ ...present([], "m1", 4), fullscreen: true, fontScale: 2 }, { type: "DESELECT" });
  assert("DESELECT clears selection + view state", de.selectedId === null && de.slideIndex === 0 && de.fullscreen === false && de.fontScale === 1);
}

// ═══════════════════════════════════════════════════════════════════
// 9. Comments (module-level and slide-level)
// ═══════════════════════════════════════════════════════════════════
{
  clearTrackers();
  // ADD_COMMENT module-level
  const outM = innerReducer(present([lane("l1", [item("m1", [slide(1)])])], "m1"), { type: "ADD_COMMENT", itemId: "m1", text: "note" });
  const cM = findItem(outM, "m1").comments;
  assert("ADD_COMMENT (module) appends open comment", cM.length === 1 && cM[0].text === "note" && cM[0].status === "open");
  assert("ADD_COMMENT marks module dirty", _dirtyMods.has("m1"));
  // ADD_COMMENT slide-level
  const outS = innerReducer(present([lane("l1", [item("m1", [slide(1)])])], "m1"), { type: "ADD_COMMENT", itemId: "m1", slideIndex: 0, text: "s-note" });
  assert("ADD_COMMENT (slide) appends to slide.comments", findItem(outS, "m1").slides[0].comments.length === 1);
}
{
  // seed a module comment then run UPDATE/RESOLVE/REOPEN/REMOVE
  const seed = (extra) => present([lane("l1", [item("m1", [], { comments: [{ id: "c1", text: "t", status: "open", createdAt: "t0", resolvedAt: null, ...extra }] })])], "m1");
  const upd = innerReducer(seed(), { type: "UPDATE_COMMENT", itemId: "m1", commentId: "c1", text: "edited" });
  assert("UPDATE_COMMENT edits text", findItem(upd, "m1").comments[0].text === "edited");
  const res = innerReducer(seed(), { type: "RESOLVE_COMMENT", itemId: "m1", commentId: "c1" });
  assert("RESOLVE_COMMENT sets status resolved + resolvedAt", findItem(res, "m1").comments[0].status === "resolved" && !!findItem(res, "m1").comments[0].resolvedAt);
  const reo = innerReducer(seed({ status: "resolved", resolvedAt: "t9" }), { type: "REOPEN_COMMENT", itemId: "m1", commentId: "c1" });
  assert("REOPEN_COMMENT sets open + clears resolvedAt", findItem(reo, "m1").comments[0].status === "open" && findItem(reo, "m1").comments[0].resolvedAt === null);
  const rem = innerReducer(seed(), { type: "REMOVE_COMMENT", itemId: "m1", commentId: "c1" });
  assert("REMOVE_COMMENT deletes the comment", findItem(rem, "m1").comments.length === 0);
}
{
  // RESOLVE_ALL_COMMENTS across module + slide comments
  const st = present([lane("l1", [item("m1",
    [slide(1, { comments: [{ id: "s1", status: "open", createdAt: "t", resolvedAt: null }] })],
    { comments: [{ id: "c1", status: "open", createdAt: "t", resolvedAt: null }] })])], "m1");
  const out = innerReducer(st, { type: "RESOLVE_ALL_COMMENTS" });
  const it = findItem(out, "m1");
  assert("RESOLVE_ALL_COMMENTS resolves module + slide comments", it.comments[0].status === "resolved" && it.slides[0].comments[0].status === "resolved");
}
{
  // CLEAR_RESOLVED_COMMENTS drops resolved, keeps open
  const st = present([lane("l1", [item("m1",
    [slide(1, { comments: [{ id: "s1", status: "resolved", createdAt: "t", resolvedAt: "t9" }] })],
    { comments: [{ id: "c1", status: "open", createdAt: "t", resolvedAt: null }, { id: "c2", status: "resolved", createdAt: "t", resolvedAt: "t9" }] })])], "m1");
  const out = innerReducer(st, { type: "CLEAR_RESOLVED_COMMENTS" });
  const it = findItem(out, "m1");
  assert("CLEAR_RESOLVED_COMMENTS keeps open, drops resolved (module)", it.comments.length === 1 && it.comments[0].id === "c1");
  assert("CLEAR_RESOLVED_COMMENTS drops resolved slide comment", it.slides[0].comments.length === 0);
}

// ═══════════════════════════════════════════════════════════════════
// 10. Review / chat / vera / teacher / misc setters
// ═══════════════════════════════════════════════════════════════════
{
  assert("SET_REVIEW_MODE sets reviewMode", innerReducer(present([]), { type: "SET_REVIEW_MODE", value: true }).reviewMode === true);
  assert("SET_COMMENTS_PANEL sets open flag", innerReducer(present([]), { type: "SET_COMMENTS_PANEL", open: true }).commentsPanelOpen === true);
  assert("SET_CHAT sets chatOpen", innerReducer(present([]), { type: "SET_CHAT", open: true }).chatOpen === true);
  const rc = innerReducer({ ...present([]), chatMessages: [{ role: "user", content: "x" }], chatLoading: true }, { type: "RESET_CHAT" });
  assert("RESET_CHAT resets to single assistant msg + not loading", rc.chatMessages.length === 1 && rc.chatMessages[0].role === "assistant" && rc.chatLoading === false);
}
{
  clearTrackers();
  const nd = innerReducer(present([lane("l1", [item("m1", [])])], "m1"), { type: "NEW_DECK", title: "Fresh", prompt: "make x", images: [] });
  assert("NEW_DECK resets to fresh deck", nd.deckTitle === "Fresh" && nd.lanes.length === 0 && nd.selectedId === null);
  assert("NEW_DECK opens chat + stores bootstrap", nd.chatOpen === true && nd._bootstrap && nd._bootstrap.prompt === "make x");
  assert("NEW_DECK sets _fullRewrite", getFullRewrite() === true);
  const cb = innerReducer({ ...present([]), _bootstrap: { prompt: "x" } }, { type: "CLEAR_BOOTSTRAP" });
  assert("CLEAR_BOOTSTRAP nulls bootstrap", cb._bootstrap === null);
}
{
  const vm = innerReducer({ ...present([]), teacherHistory: { a: [1] }, teacherLoading: true }, { type: "SET_VERA_MODE", mode: "teacher" });
  assert("SET_VERA_MODE sets mode + clears teacher state", vm.veraMode === "teacher" && JSON.stringify(vm.teacherHistory) === "{}" && vm.teacherLoading === false);
  const tm = innerReducer({ ...present([]), teacherHistory: {} }, { type: "TEACHER_MSG", key: "k", role: "user", content: "hi" });
  assert("TEACHER_MSG appends to keyed history", tm.teacherHistory.k.length === 1 && tm.teacherHistory.k[0].content === "hi");
  assert("TEACHER_LOADING sets flag", innerReducer(present([]), { type: "TEACHER_LOADING", value: true }).teacherLoading === true);
  const tc = innerReducer({ ...present([]), teacherHistory: { k: [1, 2] }, teacherLoading: true }, { type: "TEACHER_CLEAR", key: "k" });
  assert("TEACHER_CLEAR empties keyed history", tc.teacherHistory.k.length === 0 && tc.teacherLoading === false);
}
{
  const am = innerReducer({ ...present([]), chatMessages: [] }, { type: "ADD_MSG", role: "user", content: "hello" });
  assert("ADD_MSG appends a message", am.chatMessages.length === 1 && am.chatMessages[0].content === "hello");
}
{
  // STREAM_TOOL requires a trailing _streaming assistant message
  let st = { ...present([]), chatMessages: [{ role: "assistant", content: "", _streaming: true, tools: [] }] };
  st = innerReducer(st, { type: "STREAM_TOOL", event: { type: "calling", name: "set_slides", input: {}, index: 0 } });
  assert("STREAM_TOOL 'calling' adds a running tool", st.chatMessages[0].tools.length === 1 && st.chatMessages[0].tools[0].status === "running");
  st = innerReducer(st, { type: "STREAM_TOOL", event: { type: "done", index: 0, result: "ok", jump: null } });
  assert("STREAM_TOOL 'done' marks tool done", st.chatMessages[0].tools[0].status === "done" && st.chatMessages[0].tools[0].result === "ok");
  const noStream = innerReducer({ ...present([]), chatMessages: [{ role: "assistant", content: "x" }] }, { type: "STREAM_TOOL", event: { type: "calling", index: 0 } });
  assert("STREAM_TOOL is a no-op without a streaming message", noStream.chatMessages[0].content === "x" && !noStream.chatMessages[0].tools);
}
{
  const fin = innerReducer({ ...present([]), chatMessages: [{ role: "assistant", content: "partial", _streaming: true }] }, { type: "FINALIZE_STREAM", content: "final", jumps: null });
  assert("FINALIZE_STREAM sets content + clears streaming", fin.chatMessages[0].content === "final" && fin.chatMessages[0]._streaming === false);
}
{
  assert("SET_LOADING sets chatLoading", innerReducer(present([]), { type: "SET_LOADING", value: true }).chatLoading === true);
  assert("SET_DEBUG sets lastDebug", innerReducer(present([]), { type: "SET_DEBUG", text: "dbg" }).lastDebug === "dbg");
}
{
  // LOAD_LANES re-sanitizes each slide (drops unknown block type)
  const out = innerReducer(present([]), { type: "LOAD_LANES", lanes: [lane("l1", [item("m1", [{ title: "x", blocks: [{ type: "heading", text: "ok" }, { type: "nope" }] }])])] });
  assert("LOAD_LANES sanitizes slides (drops unknown block)", out.lanes[0].items[0].slides[0].blocks.length === 1);
}
{
  // SET_BRANDING merges + scrubs unsafe color scalar
  const out = innerReducer(present([]), { type: "SET_BRANDING", branding: { footerColor: "#fff", accentColor: "url(http://x)" } });
  assert("SET_BRANDING merges safe branding fields", out.branding.footerColor === "#fff");
  assert("SET_BRANDING scrubs unsafe color scalar", !("accentColor" in out.branding) || out.branding.accentColor !== "url(http://x)");
}
{
  assert("SET_GUIDELINES sets guidelines", innerReducer(present([]), { type: "SET_GUIDELINES", guidelines: "be terse" }).guidelines === "be terse");
  const rs = innerReducer({ ...present([lane("l1", [item("m1", [])])], "m1"), chatOpen: true }, { type: "RESET" });
  assert("RESET returns init (preserving chatOpen)", rs.lanes.length === 0 && rs.selectedId === null && rs.chatOpen === true);
  assert("SET_TITLE sets deckTitle", innerReducer(present([]), { type: "SET_TITLE", title: "New Title" }).deckTitle === "New Title");
}
{
  // default: unknown action returns identity
  const st = present([lane("l1", [])]);
  assert("innerReducer returns same state for unknown action", innerReducer(st, { type: "__NOPE__" }) === st);
}

// ═══════════════════════════════════════════════════════════════════
// 11. History wrapper: push / no-push / future-clear + UNDO / REDO
// ═══════════════════════════════════════════════════════════════════
{
  // mutating action pushes present to past and clears future
  const hist = { past: [], present: present([lane("l1", [])]), future: [present([lane("lF", [])])] };
  const out = reducer(hist, { type: "ADD_LANE", title: "X" });
  assert("history: mutating action pushes to past", out.past.length === 1 && out.past[0] === hist.present);
  assert("history: mutating action clears future", out.future.length === 0);
}
{
  // NO_HISTORY action does not grow past
  assert("NO_HISTORY set contains SELECT", NO_HISTORY.has("SELECT"));
  const hist = { past: [], present: present([]), future: [] };
  const out = reducer(hist, { type: "SELECT", id: "m1", slideIndex: 2 });
  assert("history: NO_HISTORY action does not push past", out.past.length === 0 && out.present.selectedId === "m1");
}
{
  // identity (innerReducer returns same present) => hist returned unchanged
  const hist = { past: [{}], present: present([lane("l1", [])]), future: [] };
  const out = reducer(hist, { type: "__UNKNOWN__" });
  assert("history: no-op action returns hist unchanged", out === hist);
}
{
  // UNDO with empty past is a no-op
  const hist = { past: [], present: present([]), future: [] };
  assert("UNDO with empty past is a no-op", reducer(hist, { type: "UNDO" }) === hist);
}
{
  // UNDO restores prior present, clamps slideIndex, clears loading, appends marker
  const prior = { ...present([lane("l1", [item("m1", [slide(1), slide(2)])])], "m1", 5), chatLoading: true };
  const hist = { past: [prior], present: present([lane("l1", [item("m1", [slide(1)])])], "m1", 0), future: [] };
  const out = reducer(hist, { type: "UNDO" });
  assert("UNDO moves prior present into present", out.present.selectedId === "m1");
  assert("UNDO clamps restored slideIndex to slide count", out.present.slideIndex === 1, "idx=" + out.present.slideIndex);
  assert("UNDO force-clears chatLoading", out.present.chatLoading === false);
  assert("UNDO pushes old present onto future", out.future[0] === hist.present && out.past.length === 0);
  const last = out.present.chatMessages[out.present.chatMessages.length - 1];
  assert("UNDO appends a revert marker message", /revert/i.test(last.content) && last._system === true);
}
{
  // UNDO when selectedId no longer exists -> selects first item, index 0
  const prior = present([lane("l1", [item("keep", [slide(1)])])], "gone", 3);
  const hist = { past: [prior], present: present([]), future: [] };
  const out = reducer(hist, { type: "UNDO" });
  assert("UNDO falls back to first item when selectedId is stale", out.present.selectedId === "keep" && out.present.slideIndex === 0);
}
{
  // REDO with empty future is a no-op
  const hist = { past: [], present: present([]), future: [] };
  assert("REDO with empty future is a no-op", reducer(hist, { type: "REDO" }) === hist);
}
{
  // REDO pulls from future, clamps, appends restore marker
  const next = present([lane("l1", [item("m1", [slide(1), slide(2), slide(3)])])], "m1", 10);
  const hist = { past: [], present: present([]), future: [next] };
  const out = reducer(hist, { type: "REDO" });
  assert("REDO moves future[0] into present", out.present.selectedId === "m1");
  assert("REDO clamps restored slideIndex", out.present.slideIndex === 2, "idx=" + out.present.slideIndex);
  assert("REDO pushes old present onto past + shifts future", out.past.length === 1 && out.future.length === 0);
  const last = out.present.chatMessages[out.present.chatMessages.length - 1];
  assert("REDO appends a restore marker message", /restore/i.test(last.content) && last._system === true);
}

// ═══════════════════════════════════════════════════════════════════
// 12. Batch multi-slide ops undo as a SINGLE step (PowerPoint parity)
//     A single user gesture (multi-delete / multi-paste / multi-move)
//     must push exactly ONE history entry and be reversed by ONE UNDO.
// ═══════════════════════════════════════════════════════════════════
{
  // ---- multi-delete: REMOVE_SLIDES ----
  clearTrackers();
  const it = item("m1", [slide(1), slide(2), slide(3), slide(4)]);
  const before = present([lane("l1", [it])], "m1", 0);
  const hist = H(before);
  const out = reducer(hist, { type: "REMOVE_SLIDES", id: "m1", indices: [3, 1] });
  assert("REMOVE_SLIDES removes exactly the given indices", marks(findItem(out.present, "m1").slides).join() === "1,3", marks(findItem(out.present, "m1").slides).join());
  assert("REMOVE_SLIDES pushes exactly ONE history entry", out.past.length === 1, "past=" + out.past.length);
  const undo = reducer(out, { type: "UNDO" });
  assert("REMOVE_SLIDES reversed by ONE undo", marks(findItem(undo.present, "m1").slides).join() === "1,2,3,4", marks(findItem(undo.present, "m1").slides).join());

  // ---- multi-paste: INSERT_SLIDES ----
  clearTrackers();
  const it2 = item("m2", [slide(1), slide(2)]);
  const before2 = present([lane("l1", [it2])], "m2", 0);
  const out2 = reducer(H(before2), { type: "INSERT_SLIDES", id: "m2", index: 1, slides: [slide(8), slide(9)] });
  assert("INSERT_SLIDES inserts all slides at index, order preserved", marks(findItem(out2.present, "m2").slides).join() === "1,8,9,2", marks(findItem(out2.present, "m2").slides).join());
  assert("INSERT_SLIDES pushes exactly ONE history entry", out2.past.length === 1, "past=" + out2.past.length);
  const undo2 = reducer(out2, { type: "UNDO" });
  assert("INSERT_SLIDES reversed by ONE undo", marks(findItem(undo2.present, "m2").slides).join() === "1,2", marks(findItem(undo2.present, "m2").slides).join());

  // ---- multi-move: MOVE_SLIDES_TO_MODULE ----
  clearTrackers();
  const src = item("src", [slide(1), slide(2), slide(3), slide(4)]);
  const dst = item("dst", [slide(9)]);
  const before3 = present([lane("l1", [src, dst])], "src", 0);
  const out3 = reducer(H(before3), { type: "MOVE_SLIDES_TO_MODULE", fromId: "src", toId: "dst", indices: [1, 3] });
  assert("MOVE_SLIDES removes moved slides from source", marks(findItem(out3.present, "src").slides).join() === "1,3", marks(findItem(out3.present, "src").slides).join());
  assert("MOVE_SLIDES appends moved slides to target in order", marks(findItem(out3.present, "dst").slides).join() === "9,2,4", marks(findItem(out3.present, "dst").slides).join());
  assert("MOVE_SLIDES pushes exactly ONE history entry", out3.past.length === 1, "past=" + out3.past.length);
  const undo3 = reducer(out3, { type: "UNDO" });
  assert("MOVE_SLIDES reversed by ONE undo (source restored)", marks(findItem(undo3.present, "src").slides).join() === "1,2,3,4", marks(findItem(undo3.present, "src").slides).join());
  assert("MOVE_SLIDES reversed by ONE undo (target restored)", marks(findItem(undo3.present, "dst").slides).join() === "9", marks(findItem(undo3.present, "dst").slides).join());
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
