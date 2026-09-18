// Deck-ingress identity (src/parts/part-imports.jsx).
//
// What this suite locks down: opening a deck must not REWRITE it. Ingress used
// to mint a fresh uid() for every lane and every module, so loading a deck and
// changing nothing still produced a different file on the next save — ids that
// are also storage keys (`vela-m-<moduleId>`), dirty-tracking keys and selection
// keys all moved under the author's feet.
//
// Three properties have to hold at once and pull in opposite directions:
//   1. a well-formed incoming id SURVIVES (the round-trip property),
//   2. an id that is unusable as a storage key is REPLACED, not passed through
//      (the security property — an id is untrusted deck data),
//   3. ids stay UNIQUE inside one deck (the persistence property — two modules
//      on one id share one storage slot and one dirty flag).
//
// Harness: same technique as test_deck_key_allowlist.cjs — eval one contiguous
// slice of part-imports.jsx inside a `new Function` sandbox. No build step, no
// browser, real sanitizer code.
const fs = require("fs");
const path = require("path");

const P = (f) => path.join(__dirname, "..", "src/parts", f);
const importsSrc = fs.readFileSync(P("part-imports.jsx"), "utf8");

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
  "; return { validateAndSanitizeDeck, sanitizeItem, adoptDeckId, DECK_ID_RE, uid };";

let API;
try {
  // eslint-disable-next-line no-new-func
  API = Function(combined)();
} catch (e) {
  console.error("FATAL: sandbox eval of part-imports slice failed:", (e && e.stack) || e);
  process.exit(1);
}
const { validateAndSanitizeDeck, sanitizeItem, adoptDeckId, uid } = API;

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✅ " + n); };
const bad = (n, d) => { fail++; console.log("  ❌ " + n + (d ? " — " + d : "")); };
const assert = (n, cond, d) => cond ? ok(n) : bad(n, d);

const slide = () => ({ duration: 60, bg: "#0f172a", blocks: [{ type: "heading", text: "H" }] });
const deckWith = (laneId, itemIds) => ({
  deckTitle: "D",
  lanes: [{
    id: laneId,
    title: "Lane",
    items: itemIds.map((id, i) => ({
      id, title: "M" + i, status: "todo", importance: "should", order: i + 1,
      slides: [slide()], createdAt: "2026-01-02T03:04:05.006Z",
    })),
  }],
});

console.log("\n━━ Deck-ingress identity ━━");

// ---- 1. round trip: ids and createdAt survive an untouched open ----
{
  const raw = deckWith("lane_A1", ["mod-1", "mod-2", "mod-3"]);
  const out = validateAndSanitizeDeck(JSON.parse(JSON.stringify(raw)));
  assert("lane id survives ingress", out.lanes[0].id === "lane_A1", "got " + out.lanes[0].id);
  assert("module ids survive ingress",
    out.lanes[0].items.map((i) => i.id).join(",") === "mod-1,mod-2,mod-3",
    "got " + out.lanes[0].items.map((i) => i.id).join(","));
  assert("createdAt survives ingress",
    out.lanes[0].items[0].createdAt === "2026-01-02T03:04:05.006Z");
  // The save path writes back lanes verbatim, so a second open must be a no-op.
  const twice = validateAndSanitizeDeck(JSON.parse(JSON.stringify({ deckTitle: "D", lanes: out.lanes })));
  assert("ingress is idempotent on its own output",
    JSON.stringify(twice.lanes) === JSON.stringify(out.lanes));
}

// ---- 2. a real deck file round-trips with every id and timestamp intact ----
{
  const deckPath = path.join(__dirname, "..", "examples", "business-report.vela");
  const raw = JSON.parse(fs.readFileSync(deckPath, "utf8"));
  const out = validateAndSanitizeDeck(JSON.parse(JSON.stringify(raw)));
  let idsSame = true, stampsSame = true, n = 0;
  raw.lanes.forEach((lane, li) => {
    if (out.lanes[li].id !== lane.id) idsSame = false;
    (lane.items || []).forEach((item, ii) => {
      n++;
      const got = out.lanes[li].items[ii];
      if (!got || got.id !== item.id) idsSame = false;
      if (!got || got.createdAt !== item.createdAt) stampsSame = false;
    });
  });
  assert("example deck: every lane/module id is unchanged", idsSame && n > 0, n + " modules");
  assert("example deck: every createdAt is unchanged", stampsSame);
  // Field-stable on the four keys the local-sync save path writes back. Key
  // ORDER is not part of the deck contract, so compare canonically.
  const canon = (v) => {
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (v && typeof v === "object") {
      return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
    }
    return JSON.stringify(v);
  };
  const saved = { deckTitle: raw.deckTitle, lanes: out.lanes, branding: out.branding, guidelines: out.guidelines };
  assert("example deck: open with no edit changes no field",
    canon(saved) === canon(raw));
}

// ---- 3. an unusable id is replaced, never passed through (storage-key safety) ----
{
  const rejected = [
    ["separator", "a/b"],
    ["traversal", ".."],
    ["whitespace", "a b"],
    ["control char", "a\u0000b"],
    ["unicode", "módulo"],
    ["empty", ""],
    ["over length", "x".repeat(41)],
    ["dot", "a.b"],
    ["percent", "a%2fb"],
  ];
  let allReplaced = true, detail = "";
  for (const [label, id] of rejected) {
    const got = adoptDeckId(id, new Set());
    if (got === id || !/^[A-Za-z0-9_-]{1,40}$/.test(got)) { allReplaced = false; detail += label + " "; }
  }
  assert("ids that are unsafe as a storage key are replaced", allReplaced, detail);

  // Type confusion: a coercible shape must not satisfy the pattern.
  const shapes = [["array", ["ok"]], ["boxed", new String("ok")],
    ["toString gadget", { toString: () => "ok" }], ["number", 7], ["null", null], ["bool", true]];
  let typeSafe = true, tdetail = "";
  for (const [label, v] of shapes) {
    const got = adoptDeckId(v, new Set());
    if (got === v || got === "ok" || typeof got !== "string") { typeSafe = false; tdetail += label + " "; }
  }
  assert("a non-string id is refused without coercion", typeSafe, tdetail);

  // End to end through the real ingress function.
  const raw = deckWith("bad/lane", ["ok_id", "bad id"]);
  const out = validateAndSanitizeDeck(raw);
  assert("ingress replaces an unsafe lane id", out.lanes[0].id !== "bad/lane"
    && /^[A-Za-z0-9_-]{1,40}$/.test(out.lanes[0].id));
  assert("ingress keeps the safe module id and replaces the unsafe one",
    out.lanes[0].items[0].id === "ok_id" && out.lanes[0].items[1].id !== "bad id"
    && /^[A-Za-z0-9_-]{1,40}$/.test(out.lanes[0].items[1].id));
}

// ---- 4. ids stay unique inside one deck ----
{
  const raw = deckWith("dup", ["dup", "dup", "dup"]);
  const out = validateAndSanitizeDeck(raw);
  const ids = [out.lanes[0].id, ...out.lanes[0].items.map((i) => i.id)];
  assert("a repeated id is not duplicated across the deck",
    new Set(ids).size === ids.length, ids.join(","));
  assert("the lane claims the shared id first", out.lanes[0].id === "dup");
  assert("every replacement id is still key-safe",
    ids.every((i) => /^[A-Za-z0-9_-]{1,40}$/.test(i)), ids.join(","));
}

// ---- 5. sanitizeItem without a reservation set still mints an id ----
{
  const it = sanitizeItem({ title: "M", slides: [slide()] });
  assert("a module with no id still gets one", typeof it.id === "string"
    && /^[A-Za-z0-9_-]{1,40}$/.test(it.id));
  // .map(sanitizeItem) would pass the array INDEX as `seen`; make sure a number
  // in that slot cannot break uniqueness handling.
  const viaIndex = [{ id: "k1", title: "A" }, { id: "k1", title: "B" }].map(sanitizeItem);
  assert("a number in the `seen` slot does not throw",
    viaIndex.length === 2 && viaIndex.every((v) => typeof v.id === "string"));
  assert("uid() itself stays key-safe", /^[A-Za-z0-9_-]{1,40}$/.test(uid()));
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
