// meridian CR01 — opening an unchanged deck must keep lane/module ids and
// timestamps. Loads the REAL applyStartupPatch / validateAndSanitizeDeck from
// part-imports.jsx (same slice-and-eval approach as test_deck_key_allowlist.cjs)
// and drives the desktop/local boot path: STARTUP_PATCH = deck on disk ->
// applyStartupPatch -> LOAD payload -> save -> reopen.
const fs = require("fs");
const path = require("path");

const P = (f) => path.join(__dirname, "..", f);
const importsSrc = fs.readFileSync(P("src/parts/part-imports.jsx"), "utf8");
const sliceStart = importsSrc.indexOf("const uid = () => crypto.randomUUID");
const sliceEnd = importsSrc.indexOf("// ━━━ Vela Logo Icon");
if (sliceStart < 0 || sliceEnd <= sliceStart || !importsSrc.slice(sliceStart, sliceEnd).includes("function applyStartupPatch(")) {
  console.error("FATAL: could not locate helper slice (with applyStartupPatch) in part-imports.jsx");
  process.exit(1);
}
const body = `
  var VELA_PRESENTATION_MODE = false;
  var dbg = function () {};
  var crypto = (typeof globalThis !== "undefined" && globalThis.crypto) ? globalThis.crypto : {};

` + importsSrc.slice(sliceStart, sliceEnd).replace(/^(?:const|let) STARTUP_PATCH = null;$/m, "var STARTUP_PATCH = null;") + `
; return { validateAndSanitizeDeck, adoptPriorDeckIds, localDeckPayload, open: function (deck) {
    STARTUP_PATCH = deck; var out = null;
    applyStartupPatch({ lanes: [] }, function (a) { if (a.type === "LOAD") out = a.payload; });
    return out; } };`;
// eslint-disable-next-line no-new-func
const API = Function(body)();

let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; console.log("  ❌ " + n + (d ? " — " + d : "")); } };

// What the desktop shell writes back (part-app.jsx flushLocalStateRef).
const save = (st) => JSON.parse(JSON.stringify({ deckTitle: st.deckTitle, lanes: st.lanes, branding: st.branding, guidelines: st.guidelines }));
const idsAndTimes = (d) => JSON.stringify(d.lanes.map((l) => [l.id, l.items.map((i) => [i.id, i.createdAt, (i.comments || []).map((c) => [c.id, c.createdAt, c.resolvedAt])])]));

const demo = JSON.parse(fs.readFileSync(P("examples/vela-demo.vela"), "utf8"));
const first = API.open(JSON.parse(JSON.stringify(demo)));
check("meridian-CR01 demo deck loads through the startup patch", !!first && Array.isArray(first.lanes) && first.lanes.length === demo.lanes.length);
check("meridian-CR01 open keeps every lane/module id and createdAt of the file", idsAndTimes(first) === idsAndTimes(demo),
  idsAndTimes(first).slice(0, 200));
const saved1 = save(first);
const second = API.open(JSON.parse(JSON.stringify(saved1)));
const saved2 = save(second);
check("meridian-CR01 load -> save -> reopen -> save is byte-stable (lanes)", JSON.stringify(saved1.lanes) === JSON.stringify(saved2.lanes));
check("meridian-CR01 load -> save -> reopen -> save is byte-stable (whole saved deck)", JSON.stringify(saved1) === JSON.stringify(saved2));

// Defense kept: duplicate / invalid / forged ids are repaired, never trusted.
const hostile = {
  deckTitle: "H",
  lanes: [
    { id: "same", title: "L1", items: [{ id: "same", title: "M1", slides: [] }, { id: "dup", title: "M2", slides: [] }] },
    { id: "dup", title: "L2", items: [
      { id: "_private", title: "M3", slides: [] },
      { id: "a/../b", title: "M4", slides: [] },
      { id: { toString() { return "obj"; } }, title: "M5", slides: [] },
      { id: ["arr"], title: "M6", slides: [] },
      { id: "x".repeat(65), title: "M7", slides: [] },
      { title: "M8", slides: [] },
      { id: "ok-id", title: "M9", slides: [] },
    ] },
  ],
};
const h = API.open(hostile);
const all = h.lanes.flatMap((l) => [l.id, ...l.items.map((i) => i.id)]);
check("meridian-CR01 hostile deck: all lane+module ids unique", new Set(all).size === all.length, JSON.stringify(all));
check("meridian-CR01 hostile deck: every id is a string of the safe charset", all.every((x) => typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(x)), JSON.stringify(all));
check("meridian-CR01 hostile deck: first valid unique id kept, later duplicate repaired",
  h.lanes[0].id === "same" && h.lanes[0].items[0].id !== "same" && h.lanes[0].items[1].id === "dup" && h.lanes[1].id !== "dup");
check("meridian-CR01 hostile deck: invalid/forged ids replaced, valid id kept",
  !all.includes("_private") && !all.includes("a/../b") && !all.includes("obj") && h.lanes[1].items[6].id === "ok-id");

// Ids that name Object.prototype members would make id-keyed plain-object maps
// return inherited values, so they are re-minted like invalid ids (meridian F3).
const PROTO_NAMES = ["constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "__proto__", "__defineGetter__"];
const protoDeck = { deckTitle: "P", lanes: [{ id: "constructor", title: "L", items: PROTO_NAMES.map((n, i) => ({ id: n, title: "M" + i, slides: [] })).concat([{ id: "Constructor", title: "MC", slides: [] }]) }] };
const pd = API.open(protoDeck);
const pIds = pd.lanes.flatMap((l) => [l.id, ...l.items.map((i) => i.id)]);
check("meridian-F3 prototype-member ids are re-minted (not kept)", pIds.every((x) => !(x in Object.prototype)) && pIds.length === PROTO_NAMES.length + 2, JSON.stringify(pIds));
check("meridian-F3 re-minted ids are unique and safe; a valid near-name id is kept",
  new Set(pIds).size === pIds.length && pIds.every((x) => /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(x)) && pd.lanes[0].items[PROTO_NAMES.length].id === "Constructor", JSON.stringify(pIds));
const counts = {};
for (const id of pIds) counts[id] = (counts[id] || 0) + 1;
check("meridian-F3 id-keyed plain-object map stays numeric", Object.values(counts).every((c) => c === 1) && pIds.every((x) => counts[x] === 1));
const pcur = { lanes: [{ id: "toString", items: [{ id: "valueOf" }] }] };
const pr = API.validateAndSanitizeDeck({ lanes: [{ title: "L", items: [{ title: "A", slides: [] }] }] }, { keepIds: true });
API.adoptPriorDeckIds(pr, { lanes: [{ items: [{}] }] }, pcur);
check("meridian-F3 live update never adopts a prototype-member prior id",
  pr.lanes[0].id !== "toString" && pr.lanes[0].items[0].id !== "valueOf", JSON.stringify([pr.lanes[0].id, pr.lanes[0].items[0].id]));

// Fresh import (no option) still re-mints every id — the import collision defense.
const imp = API.validateAndSanitizeDeck(JSON.parse(JSON.stringify(demo)));
const impIds = imp.lanes.flatMap((l) => [l.id, ...l.items.map((i) => i.id)]);
const demoIds = demo.lanes.flatMap((l) => [l.id, ...l.items.map((i) => i.id)]);
check("meridian-CR01 plain import (no keepIds) still mints fresh ids", impIds.every((x) => !demoIds.includes(x)));

// Deck open/switch in the running app (Neutralino picker + external edit) goes
// through window.__velaReceiveDeckUpdate (part-app.jsx): keepIds sanitize, then
// adoptPriorDeckIds only when the lane count matches. Mirror that call here.
const appSrc = fs.readFileSync(P("src/parts/part-app.jsx"), "utf8");
check("meridian-CR01 __velaReceiveDeckUpdate uses keepIds + adoptPriorDeckIds",
  /validateAndSanitizeDeck\(deck, \{ keepIds: true \}\)/.test(appSrc) && /adoptPriorDeckIds\(sanitized, deck, cur\)/.test(appSrc));
const receive = (deck, cur) => {
  const s = API.validateAndSanitizeDeck(deck, { keepIds: true });
  if (cur.lanes && s.lanes && cur.lanes.length === s.lanes.length) API.adoptPriorDeckIds(s, deck, cur);
  return s;
};
// Switch to another deck of the SAME shape: its own ids must win (old code copied the previous deck's ids).
const other = JSON.parse(JSON.stringify(demo));
other.lanes.forEach((l, li) => { l.id = "other-lane-" + li; l.items.forEach((it, ii) => { it.id = "other-item-" + li + "-" + ii; }); });
const sw = receive(JSON.parse(JSON.stringify(other)), first);
check("meridian-CR01 deck switch keeps the opened deck's own ids", idsAndTimes(sw) === idsAndTimes(other), idsAndTimes(sw).slice(0, 200));
// Reopen the same file: byte-stable.
const same = receive(JSON.parse(JSON.stringify(saved1)), first);
check("meridian-CR01 re-receive of the saved deck keeps every id", JSON.stringify(save({ ...saved1, lanes: same.lanes }).lanes) === JSON.stringify(saved1.lanes));
// External editor dropped ids: minted ids fall back to the current ids (selection stays valid).
const stripped = JSON.parse(JSON.stringify(saved1));
stripped.lanes.forEach((l) => { delete l.id; l.items.forEach((it) => { delete it.id; }); });
const ext = receive(stripped, first);
check("meridian-CR01 missing ids fall back to the current positional ids",
  JSON.stringify(ext.lanes.map((l) => [l.id, l.items.map((i) => i.id)])) === JSON.stringify(first.lanes.map((l) => [l.id, l.items.map((i) => i.id)])));
// Hostile update: a duplicate is repaired and the fallback never creates a collision.
const hcur = { lanes: [{ id: "keep-a", items: [{ id: "cur-m1" }, { id: "cur-m2" }] }] };
const hdeck = { lanes: [{ id: "cur-m2", title: "L", items: [{ id: "cur-m2", title: "A", slides: [] }, { title: "B", slides: [] }] }] };
const hr = receive(hdeck, hcur);
const hids = hr.lanes.flatMap((l) => [l.id, ...l.items.map((i) => i.id)]);
check("meridian-CR01 live update: ids unique, kept id wins, repaired id adopts free prior id",
  new Set(hids).size === hids.length && hr.lanes[0].id === "cur-m2" && hr.lanes[0].items[0].id === "cur-m1" && hr.lanes[0].items[1].id !== "cur-m2", JSON.stringify(hids));

// ── meridian-F6: a valid deck WITHOUT createdAt / with legacy notes ──
// sanitize must not stamp new values on each open (was now()/uid()).
const legacy = { deckTitle: "T", lanes: [{ id: "L1", title: "a", items: [
  { id: "M1", title: "m", notes: "legacy note", slides: [{ blocks: [{ type: "text", text: "x" }] }] },
  { id: "M2", title: "n", notes: "legacy note", slides: [] },
  { title: "no id", notes: "other note", slides: [] },
] }] };
const la = API.open(JSON.parse(JSON.stringify(legacy)));
const lb = API.open(JSON.parse(JSON.stringify(legacy)));
check("meridian-F6 missing module createdAt stays absent (no now() stamp)",
  la.lanes[0].items.every((i) => !("createdAt" in i)), JSON.stringify(la.lanes[0].items.map((i) => i.createdAt)));
const cm = (d) => JSON.stringify(d.lanes[0].items.map((i) => i.comments));
check("meridian-F6 legacy-notes comment is identical on every open (id + createdAt)", cm(la) === cm(lb), cm(la) + " vs " + cm(lb));
const lids = la.lanes[0].items.map((i) => i.comments[0] && i.comments[0].id);
check("meridian-F6 legacy-notes comment ids are unique across modules and fixed-charset",
  new Set(lids).size === lids.length && lids.every((x) => /^c_n[0-9a-z]+$/.test(x)), JSON.stringify(lids));
check("meridian-F6 legacy-notes comment text still sanitized", (() => {
  const h = API.open({ lanes: [{ id: "L", items: [{ id: "M", title: "t", notes: "<img src=x onerror=alert(1)>hi", slides: [] }] }] });
  return !/[<>]/.test(h.lanes[0].items[0].comments[0].text);
})());
check("meridian-F6 a createdAt the file carries is kept", API.open({ lanes: [{ id: "L", items: [{ id: "M", title: "t", createdAt: "2026-01-01T00:00:00.000Z" }] }] }).lanes[0].items[0].createdAt === "2026-01-01T00:00:00.000Z");
check("meridian-F6 non-string createdAt is dropped, not coerced", !("createdAt" in API.open({ lanes: [{ id: "L", items: [{ id: "M", title: "t", createdAt: { toString() { return "x"; } } }] }] }).lanes[0].items[0]));

// No-edit guard signature (part-app.jsx flushLocalStateRef): the payload of an
// unchanged reopen equals the payload right after the first open, so the save
// path skips it. study-notes-demo.vela has a module with no id/createdAt.
const sig = (st) => JSON.stringify(API.localDeckPayload(st));
const sn = JSON.parse(fs.readFileSync(P("examples/study-notes-demo.vela"), "utf8"));
const snA = API.open(JSON.parse(JSON.stringify(sn)));
check("meridian-F6 study-notes-demo: open gives no createdAt stamp", snA.lanes.every((l) => l.items.every((i) => !("createdAt" in i))));
const snSaved = JSON.parse(sig(snA));
const snB = API.open(JSON.parse(JSON.stringify(snSaved)));
check("meridian-F6 study-notes-demo: open -> save -> reopen signature is stable", sig(snA) === sig(snB));
check("meridian-F6 legacy deck: reopen of saved payload gives the same signature",
  sig(la) === sig(API.open(JSON.parse(sig(la)))));
check("meridian-F6 a real edit changes the signature (edits still save)", (() => {
  const e = JSON.parse(JSON.stringify(la)); e.lanes[0].items[0].title = "edited"; return sig(e) !== sig(la);
})());
// Wiring: the save path compares the signature BEFORE the write hook, and the
// boot / incoming LOAD paths record the baseline.
{
  const app = fs.readFileSync(P("src/parts/part-app.jsx"), "utf8");
  const f = app.indexOf("flushLocalStateRef.current = (");
  const fb = app.slice(f, app.indexOf("flushStorageStateRef.current = (", f));
  const g = fb.indexOf("sig === _localDiskSig.current"), w = fb.indexOf("window.__velaSendDeckUpdate(payload)");
  check("meridian-F6 flush skips an unchanged payload before __velaSendDeckUpdate", g > 0 && w > g);
  check("meridian-F6 boot startup patch + incoming update record the on-disk baseline",
    (app.match(/_localBaselineLanes\.current = /g) || []).length >= 3 && /_localDiskSig\.current = JSON\.stringify\(localDeckPayload\(/.test(app));
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
