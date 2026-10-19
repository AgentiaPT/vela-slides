// Deck-ingress id / timestamp stability (src/parts/part-imports.jsx).
//
// Opening a deck that the user did not change must not change the deck.
// validateAndSanitizeDeck runs on every open (startup patch, file import,
// desktop/serve.py push). It used to mint a new random id for every lane and
// module and stamp now() into a missing module createdAt, so two loads of the
// same file gave different decks, and the local-sync autosave wrote that
// changed deck back to disk with no user edit.
//
// This suite locks down:
//   1. valid existing lane/module ids survive ingress unchanged,
//   2. a missing module createdAt is not minted at ingress,
//   3. two loads of the same deck give byte-identical sync payloads,
//   4. hostile / malformed / duplicate ids are NOT kept: they are replaced
//      with a fresh safe id (ids are used in storage keys and DOM keys),
//   5. ids stay unique across the whole deck.
//
// Harness: same slice technique as test_deck_key_allowlist.cjs.
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
  "; return { validateAndSanitizeDeck, sanitizeItem," +
  " localSyncPayload: (typeof localSyncPayload === 'function') ? localSyncPayload : null };";

let API;
try {
  // eslint-disable-next-line no-new-func
  API = Function(combined)();
} catch (e) {
  console.error("FATAL: sandbox eval of part-imports slice failed:", (e && e.stack) || e);
  process.exit(1);
}
const { validateAndSanitizeDeck, localSyncPayload } = API;

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✅ " + n); };
const bad = (n, d) => { fail++; console.log("  ❌ " + n + (d ? " — " + d : "")); };
const assert = (n, cond, d) => cond ? ok(n) : bad(n, d);

const SAFE_ID = /^[A-Za-z0-9_-]{1,40}$/;
const slide = () => ({ duration: 60, blocks: [{ type: "heading", text: "H" }] });
const deck = () => ({
  deckTitle: "D",
  lanes: [
    { id: "lane-1", title: "L1", items: [
      { id: "m_intro", title: "Intro", status: "todo", importance: "must", order: 1, slides: [slide()], createdAt: "2025-01-02T03:04:05.000Z" },
      { id: "m2", title: "No timestamp", slides: [slide()] },
    ] },
    { id: "lane2", title: "L2", items: [{ id: "abc12345", title: "M3", slides: [slide()] }] },
  ],
});
const allIds = (d) => d.lanes.flatMap((l) => [l.id, ...l.items.map((i) => i.id)]);

console.log("\n🧭 Ingress id / timestamp stability");

// 1. valid ids survive
{
  const out = validateAndSanitizeDeck(deck());
  assert("lane ids kept", out.lanes[0].id === "lane-1" && out.lanes[1].id === "lane2", JSON.stringify(out.lanes.map((l) => l.id)));
  assert("module ids kept", out.lanes[0].items[0].id === "m_intro" && out.lanes[0].items[1].id === "m2" && out.lanes[1].items[0].id === "abc12345",
    JSON.stringify(allIds(out)));
  assert("existing createdAt kept", out.lanes[0].items[0].createdAt === "2025-01-02T03:04:05.000Z");
  // 2. missing createdAt not minted
  assert("missing createdAt not minted", !("createdAt" in out.lanes[0].items[1]), String(out.lanes[0].items[1].createdAt));
}

// 3. two loads -> identical deck content
{
  const a = validateAndSanitizeDeck(deck());
  const b = validateAndSanitizeDeck(deck());
  assert("two loads give identical lanes", JSON.stringify(a.lanes) === JSON.stringify(b.lanes));
  // Load of the sanitized output (what the file holds after a save) is a fixed point.
  const c = validateAndSanitizeDeck(JSON.parse(JSON.stringify({ deckTitle: "D", lanes: a.lanes })));
  assert("re-load of saved deck is a fixed point", JSON.stringify(c.lanes) === JSON.stringify(a.lanes));
  // Legacy notes -> comment migration is deterministic too.
  const n1 = validateAndSanitizeDeck({ lanes: [{ id: "l", items: [{ id: "m", title: "M", notes: "hello", slides: [slide()] }] }] });
  const n2 = validateAndSanitizeDeck({ lanes: [{ id: "l", items: [{ id: "m", title: "M", notes: "hello", slides: [slide()] }] }] });
  assert("legacy-notes comment id deterministic", n1.lanes[0].items[0].comments[0].id === n2.lanes[0].items[0].comments[0].id
    && SAFE_ID.test(n1.lanes[0].items[0].comments[0].id), n1.lanes[0].items[0].comments[0].id);
  if (localSyncPayload) {
    const pa = JSON.stringify(localSyncPayload({ ...a, deckTitle: "D" }));
    const pb = JSON.stringify(localSyncPayload({ ...b, deckTitle: "D" }));
    assert("two loads give identical local-sync payload", pa === pb);
    const empty = localSyncPayload({ deckTitle: "x", lanes: [{ id: "l", items: [{ id: "m", slides: [] }] }] });
    assert("payload is null for a deck with no slides (never overwrite with empty)", empty === null);
  } else {
    bad("localSyncPayload helper exists");
  }
}

// 4. hostile / malformed ids are replaced, never kept raw
{
  const hostile = [
    "<img src=x onerror=alert(1)>", "../../etc/passwd", "a\"]) , [data-x=\"", "x y", "", "a".repeat(41),
    "‮abc", "id\u0000nul", "ünïcode",
  ];
  const nonStrings = [42, { toString: () => "ok" }, ["m1"], null, true];
  const items = [...hostile, ...nonStrings].map((id, i) => ({ id, title: "M" + i, slides: [slide()] }));
  const out = validateAndSanitizeDeck({ lanes: [{ id: "<script>", title: "L", items }] });
  const ids = allIds(out);
  assert("every id matches safe charset", ids.every((x) => typeof x === "string" && SAFE_ID.test(x)), JSON.stringify(ids));
  assert("hostile lane id replaced", out.lanes[0].id !== "<script>");
  assert("no hostile id kept", out.lanes[0].items.every((it, i) => i >= hostile.length || it.id !== hostile[i]));
  assert("coercible non-string id not kept", out.lanes[0].items[hostile.length + 1].id !== "ok" && out.lanes[0].items[hostile.length + 2].id !== "m1");
  {
    const o = validateAndSanitizeDeck({ lanes: [{ id: "__proto__", items: [{ id: "constructor", title: "x", slides: [slide()] }, { id: "toString", title: "y", slides: [slide()] }] }] });
    const ids = allIds(o);
    assert("Object.prototype names not kept as ids", !ids.includes("__proto__") && !ids.includes("constructor") && !ids.includes("toString")
      && ids.every((x) => SAFE_ID.test(x)), JSON.stringify(ids));
  }
}

// 5. duplicates -> unique
{
  const out = validateAndSanitizeDeck({ lanes: [
    { id: "dup", title: "A", items: [{ id: "dup", title: "x", slides: [slide()] }, { id: "m", title: "y", slides: [slide()] }] },
    { id: "m", title: "B", items: [{ id: "m", title: "z", slides: [slide()] }] },
  ] });
  const ids = allIds(out);
  assert("ids unique across the deck", new Set(ids).size === ids.length, JSON.stringify(ids));
  assert("first occurrence keeps its id", out.lanes[0].id === "dup" && out.lanes[0].items[1].id === "m");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
