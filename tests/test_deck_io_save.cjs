// CR3 — deck-io save state-machine tests (Neutralino desktop file writes).
//
// The reported Windows bug: after a long session Vela "stops saving to the file
// without any hint or error". Root cause has two confirmed code facts this suite
// pins:
//   1. flushSave() swallowed every write failure (console.error only) and never
//      surfaced a status — so a failed write was invisible AND lost.
//   2. onWatchEvent() only ignored our own save echo inside a 400ms time window;
//      a slow Windows write let the echo escape and be mistaken for an external
//      edit, which suppresses in-app autosave (starvation).
//
// We load the real deck-io.js source, strip its ESM import/export, and eval it
// against a mock Neutralino.filesystem so we can drive writeFile/getStats/readFile
// behaviour deterministically and assert the state machine. Mirrors the existing
// node cjs suites' style (read source → eval helper → assert).

const fs = require("fs");
const path = require("path");

const SRC_PATH = path.join(__dirname, "..", "vela-neutralino", "resources", "js", "deck-io.js");
const SRC = fs.readFileSync(SRC_PATH, "utf8");

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✅ " + n); };
const bad = (n, d) => { fail++; console.log("  ❌ " + n + (d ? " — " + d : "")); };
const assert = (cond, msg) => { if (!cond) throw new Error(msg || "assertion failed"); };
async function test(name, fn) { try { await fn(); ok(name); } catch (e) { bad(name, e.message); } }
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

// ── Load a fresh, isolated module instance bound to a given Neutralino mock ──
function buildModule(Neu) {
  let body = SRC
    .replace(/import\s*\{[^}]*\}\s*from\s*["']\.\/fs-guard\.js["'];?/, "")
    .replace("export const deckIO", "const deckIO");
  // Shrink the real backoff so the retry tests run fast (fidelity of the delay
  // values is pinned separately by the source assertion below).
  body = body.replace(/const SAVE_RETRY_DELAYS = \[[^\]]*\];/, "const SAVE_RETRY_DELAYS = [5, 5];");
  body += "\n;return { deckIO, state, flushSave, flushNow, onWatchEvent, saveCurrent, sigOf, byteLen };";
  const fsGuard = { allow() {}, install() {}, roots() { return []; } };
  // eslint-disable-next-line no-new-func
  const factory = new Function("Neutralino", "fsGuard", "console", body);
  return factory(Neu, fsGuard, console);
}

// ── Controllable Neutralino.filesystem mock ──
function makeNeu(cfg) {
  cfg = cfg || {};
  const files = cfg.files || {};
  let writeCount = 0;
  return {
    writeCount: () => writeCount,
    files,
    filesystem: {
      async writeFile(p, data) {
        const attempt = writeCount++;
        const beh = cfg.write ? cfg.write(attempt, p, data) : "ok";
        if (beh === "ok" || beh === undefined) { files[p] = data; return; }
        throw (beh instanceof Error ? beh : new Error(String(beh)));
      },
      async getStats(p) {
        if (cfg.getStats) return cfg.getStats(p, files);
        const t = files[p];
        if (t == null) throw new Error("ENOENT " + p);
        return { size: Buffer.byteLength(t, "utf8") };
      },
      async readFile(p) {
        if (cfg.readFile) return cfg.readFile(p, files);
        const t = files[p];
        if (t == null) throw new Error("ENOENT " + p);
        return t;
      },
      async readDirectory() { return []; },
      async createWatcher() { return 1; },
      async removeWatcher() {},
    },
    storage: { async getData() { return null; }, async setData() {}, async getKeys() { return []; } },
    events: { on() {}, off() {} },
    os: {},
  };
}

const DECK = () => ({ deckTitle: "A", lanes: [{ items: [{ slides: [{ blocks: [] }] }] }] });
const PATH = "/decks/a.vela";

(async () => {
  console.log("── deck-io save state machine (CR3) ──");

  // 1. Success path emits saving→saved, verifies, records signature, clears pending.
  await test("success: emits saving→saved, verifies, clears pending", async () => {
    const N = makeNeu({});
    const m = buildModule(N);
    m.state.folder = "/decks"; m.state.currentPath = PATH;
    const seen = [];
    m.deckIO.onSaveStatus((s) => seen.push(s.state));
    m.saveCurrent(DECK());
    await m.flushNow();
    assert(seen[0] === "saving", "first status not saving: " + seen);
    assert(seen.includes("saved"), "never reached saved: " + seen);
    assert(m.state.pendingDeck === null && m.state.pendingPath === null, "pending not cleared on success");
    assert(m.state.lastWrittenSig, "signature not recorded for echo guard");
    assert(N.files[PATH], "file not written");
  });

  // 2. No-swallow: a failed write is NOT silent — it emits a 'failed' status.
  await test("no-swallow: final failure emits 'failed' status (not just console)", async () => {
    const cfg = { write: () => new Error("EACCES write denied") };
    const N = makeNeu(cfg);
    const m = buildModule(N);
    m.state.folder = "/decks"; m.state.currentPath = PATH;
    let last = null;
    m.deckIO.onSaveStatus((s) => { last = s; });
    m.saveCurrent(DECK());
    await m.flushNow();
    assert(last && last.state === "failed", "did not surface failed status: " + JSON.stringify(last));
    assert(last.error, "failed status has no error detail");
  });

  // 3. Retry with backoff: a transient reject is retried and then succeeds.
  await test("retry: transient reject then success (retried, ends saved)", async () => {
    const cfg = { write: (attempt) => (attempt < 1 ? new Error("EBUSY temporary lock") : "ok") };
    const N = makeNeu(cfg);
    const m = buildModule(N);
    m.state.folder = "/decks"; m.state.currentPath = PATH;
    let last = null;
    m.deckIO.onSaveStatus((s) => { last = s; });
    m.saveCurrent(DECK());
    await m.flushNow();
    assert(N.writeCount() === 2, "expected 2 write attempts, got " + N.writeCount());
    assert(last.state === "saved", "did not recover to saved: " + JSON.stringify(last));
    assert(m.state.pendingDeck === null, "pending not cleared after recovery");
  });

  // 4. Keep-pending on failure: all attempts fail → pendingDeck RETAINED so a
  //    later flush re-attempts the newest content (no edits lost).
  await test("keep-pending: all attempts fail → pending retained → later flush saves", async () => {
    const cfg = { write: () => new Error("EACCES denied") };
    const N = makeNeu(cfg);
    const m = buildModule(N);
    m.state.folder = "/decks"; m.state.currentPath = PATH;
    let last = null;
    m.deckIO.onSaveStatus((s) => { last = s; });
    const deck = DECK();
    m.saveCurrent(deck);
    await m.flushNow();
    assert(N.writeCount() === 3, "expected 3 attempts, got " + N.writeCount());
    assert(last.state === "failed", "not failed: " + JSON.stringify(last));
    assert(m.state.pendingDeck === deck, "pendingDeck was dropped on failure (data loss)");
    assert(m.state.pendingPath === PATH, "pendingPath was dropped on failure");
    // Recovery: writes succeed now, manual retry (flushNow) flushes the retained deck.
    cfg.write = () => "ok";
    await m.flushNow();
    assert(last.state === "saved", "retry did not recover: " + JSON.stringify(last));
    assert(m.state.pendingDeck === null, "pending not cleared after successful retry");
    assert(N.files[PATH], "file still not written after recovery");
  });

  // 5. Verify-after-write: a size mismatch is treated as a failed write.
  await test("verify: getStats size mismatch is treated as failure", async () => {
    const cfg = {
      write: () => "ok",
      getStats: (p, files) => ({ size: (Buffer.byteLength(files[p] || "", "utf8")) + 1 }), // always wrong
    };
    const N = makeNeu(cfg);
    const m = buildModule(N);
    m.state.folder = "/decks"; m.state.currentPath = PATH;
    let last = null;
    m.deckIO.onSaveStatus((s) => { last = s; });
    m.saveCurrent(DECK());
    await m.flushNow();
    assert(N.writeCount() === 3, "mismatch should force retries; attempts=" + N.writeCount());
    assert(last.state === "failed", "size mismatch not treated as failure: " + JSON.stringify(last));
    assert(m.state.pendingDeck !== null, "pending dropped despite failed verify");
    // Fix verification, retry → saved.
    cfg.getStats = (p, files) => ({ size: Buffer.byteLength(files[p] || "", "utf8") });
    await m.flushNow();
    assert(last.state === "saved", "did not recover after verify fixed: " + JSON.stringify(last));
  });

  // 6. Echo guard (hash, timing-independent): a watcher event whose on-disk
  //    content matches what we last wrote is OUR OWN echo → no external reload,
  //    even when the time window has long lapsed.
  await test("echo-guard: own-write echo is suppressed by content hash (timing-independent)", async () => {
    const N = makeNeu({});
    const m = buildModule(N);
    m.state.folder = "/decks"; m.state.currentPath = PATH;
    let externalReloads = 0;
    m.deckIO.onDeckLoaded((deck, p, meta) => { if (meta && meta.external) externalReloads++; });
    m.saveCurrent(DECK());
    await m.flushNow(); // writes file, records lastWrittenSig, files[PATH] === written bytes
    // Force the time window to have lapsed so ONLY the hash guard can save us.
    m.state.lastWriteAt = 0;
    m.onWatchEvent({ detail: { dir: "/decks", filename: "a.vela", action: "modified" } });
    await tick(30);
    assert(externalReloads === 0, "own-write echo was mistaken for an external edit");
  });

  // 7. A genuine external edit (different bytes) IS surfaced as external.
  await test("echo-guard: a genuine external edit still triggers a reload", async () => {
    const N = makeNeu({});
    const m = buildModule(N);
    m.state.folder = "/decks"; m.state.currentPath = PATH;
    let externalReloads = 0;
    m.deckIO.onDeckLoaded((deck, p, meta) => { if (meta && meta.external) externalReloads++; });
    m.saveCurrent(DECK());
    await m.flushNow();
    // Someone else rewrites the file with different content.
    N.files[PATH] = JSON.stringify({ deckTitle: "EXTERNAL", lanes: [{ items: [] }] }, null, 2);
    m.state.lastWriteAt = 0;
    m.onWatchEvent({ detail: { dir: "/decks", filename: "a.vela", action: "modified" } });
    await tick(30);
    assert(externalReloads === 1, "external edit was not surfaced (expected 1 reload, got " + externalReloads + ")");
  });

  // 7b. D5: after an external edit is loaded, a later external REVERT to a
  //     byte-exact previously-Vela-written state must still reload (not be
  //     suppressed as "our own echo"). The load path must refresh the echo
  //     baseline; otherwise lastWrittenSig stays stuck on our old write.
  await test("echo-guard: external revert to a prior Vela-written state still reloads", async () => {
    const N = makeNeu({});
    const m = buildModule(N);
    m.state.folder = "/decks"; m.state.currentPath = PATH;
    const loaded = [];
    m.deckIO.onDeckLoaded((deck, p, meta) => { if (meta && meta.external) loaded.push(deck); });
    // Vela writes state X (records lastWrittenSig = sig(X)).
    m.saveCurrent(DECK());
    await m.flushNow();
    const X = N.files[PATH];
    // External write Y (different bytes) → surfaced + adopted as new baseline.
    const Y = JSON.stringify({ deckTitle: "EXTERNAL_Y", lanes: [{ items: [] }] }, null, 2);
    N.files[PATH] = Y;
    m.state.lastWriteAt = 0;
    m.onWatchEvent({ detail: { dir: "/decks", filename: "a.vela", action: "modified" } });
    await tick(30);
    assert(loaded.length === 1, "external Y not surfaced (got " + loaded.length + ")");
    // External revert back to the byte-exact X (a previously-Vela-written state).
    N.files[PATH] = X;
    m.state.lastWriteAt = 0;
    m.onWatchEvent({ detail: { dir: "/decks", filename: "a.vela", action: "modified" } });
    await tick(30);
    assert(loaded.length === 2, "external revert to prior Vela state was wrongly suppressed as own echo (got " + loaded.length + ")");
    assert(loaded[1] && loaded[1].deckTitle === "A", "reverted reload did not carry X's content: " + JSON.stringify(loaded[1]));
  });

  // 8. Reconnecting: a connection/token-shaped error with a dead liveness probe
  //    reports 'reconnecting' (targets the long-idle dropped-socket hypothesis).
  await test("reconnect: connection-shaped error + dead probe → 'reconnecting'", async () => {
    const cfg = { write: () => new Error("NL_TOKEN invalid: connection closed") };
    const N = makeNeu(cfg); // getStats("/decks") throws ENOENT → probe fails
    const m = buildModule(N);
    m.state.folder = "/decks"; m.state.currentPath = PATH;
    let last = null;
    m.deckIO.onSaveStatus((s) => { last = s; });
    m.saveCurrent(DECK());
    await m.flushNow();
    assert(last.state === "reconnecting", "connection error not reported as reconnecting: " + JSON.stringify(last));
    assert(m.state.pendingDeck !== null, "pending dropped during reconnect");
  });

  // 9. Source pins: the shipped code keeps the real backoff + no-swallow emits.
  await test("source: real backoff array + no-swallow status emits are present", async () => {
    assert(/SAVE_RETRY_DELAYS\s*=\s*\[\s*\d+\s*,\s*\d+\s*\]/.test(SRC), "SAVE_RETRY_DELAYS backoff array missing");
    assert(SRC.includes('emitStatus('), "emitStatus not used");
    assert(SRC.includes('reconnecting'), "reconnecting status missing");
    assert(SRC.includes('lastWrittenSig'), "echo-guard signature missing");
    assert(SRC.includes('verifyWrite'), "verify-after-write missing");
    // The old swallow — nulling pending BEFORE the await — must be gone.
    assert(!/if \(!deck \|\| !path\) return;\s*\n\s*state\.pendingDeck = null;\s*\n\s*state\.pendingPath = null;/.test(SRC),
      "flushSave still clears pending before the write (data-loss regression)");
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
