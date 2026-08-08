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
function buildModule(Neu, consoleMock) {
  let body = SRC
    .replace(/import\s*\{[^}]*\}\s*from\s*["']\.\/fs-guard\.js["'];?/, "")
    .replace("export const deckIO", "const deckIO");
  // Shrink the real backoff so the retry tests run fast (fidelity of the delay
  // values is pinned separately by the source assertion below).
  body = body.replace(/const SAVE_RETRY_DELAYS = \[[^\]]*\];/, "const SAVE_RETRY_DELAYS = [5, 5];");
  body += "\n;return { deckIO, state, flushSave, flushNow, onWatchEvent, saveCurrent, sigOf, byteLen, MAX_DECK_BYTES, WATCHER_IGNORE_MS };";
  const fsGuard = { allow() {}, install() {}, roots() { return []; } };
  // eslint-disable-next-line no-new-func
  const factory = new Function("Neutralino", "fsGuard", "console", body);
  return factory(Neu, fsGuard, consoleMock || console);
}

// Console that records warn/error instead of printing, so tests can assert that a
// skipped/unverifiable operation is reported rather than silently dropped.
function recordingConsole() {
  const warns = [], errors = [];
  return {
    warns, errors,
    warn: (...a) => warns.push(a.map(String).join(" ")),
    error: (...a) => errors.push(a.map(String).join(" ")),
    log: () => {},
  };
}

// ── Controllable Neutralino.filesystem mock ──
function makeNeu(cfg) {
  cfg = cfg || {};
  const files = cfg.files || {};
  let writeCount = 0, readCount = 0, statCount = 0;
  return {
    writeCount: () => writeCount,
    readCount: () => readCount,
    statCount: () => statCount,
    resetCounts: () => { readCount = 0; statCount = 0; },
    files,
    filesystem: {
      async writeFile(p, data) {
        const attempt = writeCount++;
        const beh = cfg.write ? cfg.write(attempt, p, data) : "ok";
        if (beh === "ok" || beh === undefined) { files[p] = data; return; }
        throw (beh instanceof Error ? beh : new Error(String(beh)));
      },
      async getStats(p) {
        statCount++;
        if (cfg.getStats) return cfg.getStats(p, files);
        const t = files[p];
        if (t == null) throw new Error("ENOENT " + p);
        return { size: Buffer.byteLength(t, "utf8") };
      },
      async readFile(p) {
        readCount++;
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
    // The detail (raw error + absolute path) stays shell-side; the renderer-facing
    // payload carries the state and a basename only.
    assert(last.error === undefined, "raw error crossed the shell→renderer boundary");
    assert(last.name === "a.vela", "failed status lost the file name: " + JSON.stringify(last));
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

  // ── Phase 3: read-back verification, exact echo compare, bounded reads ──

  // 10. Read-back verification: the file has the right SIZE but the wrong BYTES.
  //     Size alone can't catch that; the read-back compare must, and must drive
  //     the retry loop rather than reporting a confident "saved".
  await test("verify: read-back content mismatch (same size) retries and ends failed", async () => {
    const cfg = {
      write: () => "ok",
      // Same byte length, different content — only an exact compare catches it.
      readFile: (p, files) => String(files[p] || "").replace(/"A"/, '"B"'),
    };
    const N = makeNeu(cfg);
    const m = buildModule(N, recordingConsole());
    m.state.folder = "/decks"; m.state.currentPath = PATH;
    let last = null;
    m.deckIO.onSaveStatus((s) => { last = s; });
    m.saveCurrent(DECK());
    await m.flushNow();
    assert(N.writeCount() === 3, "read-back mismatch should force retries; attempts=" + N.writeCount());
    assert(last.state === "failed", "read-back mismatch not treated as failure: " + JSON.stringify(last));
    assert(m.state.pendingDeck !== null, "pending dropped despite failed read-back verify");
    // Fix the read-back → recovers to saved.
    cfg.readFile = null;
    await m.flushNow();
    assert(last.state === "saved", "did not recover once read-back matched: " + JSON.stringify(last));
  });

  // 11. Unknown (no getStats) → "unverified", NOT a silent "saved".
  await test("verify: getStats unavailable → 'unverified' status (never silently saved)", async () => {
    const cfg = { write: () => "ok", getStats: () => { throw new Error("ENOSYS getStats unsupported"); } };
    const N = makeNeu(cfg);
    const C = recordingConsole();
    const m = buildModule(N, C);
    m.state.folder = "/decks"; m.state.currentPath = PATH;
    const seen = [];
    m.deckIO.onSaveStatus((s) => seen.push(s.state));
    m.saveCurrent(DECK());
    await m.flushNow();
    assert(!seen.includes("saved"), "unverifiable write was reported as saved: " + seen);
    assert(seen.includes("unverified"), "no distinct unverified status: " + seen);
    assert(N.writeCount() === 1, "unverifiable write should not retry; attempts=" + N.writeCount());
    assert(N.files[PATH], "file was not written");
    assert(C.warns.some((w) => /could not be verified/i.test(w)), "unverifiable write not reported to console");
  });

  // 12. Unknown (read unavailable) → "unverified" too: a size that happens to match
  //     is not proof, so a missing read-back must not be upgraded to "saved".
  await test("verify: read-back unavailable → 'unverified' status", async () => {
    const cfg = { write: () => "ok", readFile: () => { throw new Error("EACCES read denied"); } };
    const N = makeNeu(cfg);
    const m = buildModule(N, recordingConsole());
    m.state.folder = "/decks"; m.state.currentPath = PATH;
    let last = null;
    m.deckIO.onSaveStatus((s) => { last = s; });
    m.saveCurrent(DECK());
    await m.flushNow();
    assert(last.state === "unverified", "read-back failure not surfaced as unverified: " + JSON.stringify(last));
  });

  // 13. Bounded read: an oversized file on the watched path is skipped BEFORE the
  //     read, with a warning — never read into memory, never silently ignored.
  await test("bounded: oversized file on a watcher event is skipped with a warning (not read)", async () => {
    const cfg = {};
    const N = makeNeu(cfg);
    const C = recordingConsole();
    const m = buildModule(N, C);
    m.state.folder = "/decks"; m.state.currentPath = PATH;
    let externalReloads = 0;
    m.deckIO.onDeckLoaded((deck, p, meta) => { if (meta && meta.external) externalReloads++; });
    m.saveCurrent(DECK());
    await m.flushNow();
    // The file is now reported as far larger than the deck cap.
    cfg.getStats = () => ({ size: 6 * 1024 * 1024 });
    N.resetCounts();
    m.state.lastWriteAt = 0; // window lapsed: the size cap is the only thing left
    m.onWatchEvent({ detail: { dir: "/decks", filename: "a.vela", action: "modified" } });
    await tick(30);
    assert(N.readCount() === 0, "oversized file was read anyway (" + N.readCount() + " reads)");
    assert(externalReloads === 0, "oversized file was loaded as an external edit");
    assert(C.warns.some((w) => /exceeds/i.test(w)), "oversized skip was silent: " + JSON.stringify(C.warns));
  });

  // 14. Echo guard is signature AND exact text: a signature hit whose bytes differ
  //     is NOT our echo. Dropping it would silently diverge app state from disk.
  await test("echo-guard: signature hit with different text is NOT treated as our echo", async () => {
    const N = makeNeu({});
    const m = buildModule(N, recordingConsole());
    m.state.folder = "/decks"; m.state.currentPath = PATH;
    let externalReloads = 0;
    m.deckIO.onDeckLoaded((deck, p, meta) => { if (meta && meta.external) externalReloads++; });
    m.saveCurrent(DECK());
    await m.flushNow();
    const onDisk = N.files[PATH];
    assert(m.state.lastWrittenText === onDisk, "lastWrittenText not recorded alongside the signature");
    // Simulate a digest collision: the signature still matches the on-disk bytes,
    // but the bytes we actually wrote were different.
    assert(m.state.lastWrittenSig === m.sigOf(onDisk), "signature baseline unexpectedly stale");
    m.state.lastWrittenText = onDisk.replace(/"A"/, '"COLLIDED"');
    m.state.lastWriteAt = 0;
    m.onWatchEvent({ detail: { dir: "/decks", filename: "a.vela", action: "modified" } });
    await tick(30);
    assert(externalReloads === 1, "signature-only match suppressed a real external edit (got " + externalReloads + " reloads)");
  });

  // 15. Ordering: inside the ignore window the watcher must not touch the FS at all.
  await test("bounded: watcher inside the ignore window does no filesystem read", async () => {
    const N = makeNeu({});
    const m = buildModule(N, recordingConsole());
    m.state.folder = "/decks"; m.state.currentPath = PATH;
    m.saveCurrent(DECK());
    await m.flushNow();
    N.resetCounts();
    m.state.lastWriteAt = Date.now(); // fresh write → within the window
    m.onWatchEvent({ detail: { dir: "/decks", filename: "a.vela", action: "modified" } });
    await tick(30);
    assert(N.readCount() === 0, "watcher read the file inside the ignore window (" + N.readCount() + ")");
    assert(N.statCount() === 0, "watcher stat'd the file inside the ignore window (" + N.statCount() + ")");
  });

  // 16. Boundary payload: nothing crossing to the renderer carries an absolute
  //     path or a raw platform error — only {state, at, name}.
  await test("boundary: status payload carries no absolute path and no raw error", async () => {
    const cfg = {};
    const N = makeNeu(cfg);
    const m = buildModule(N, recordingConsole());
    m.state.folder = "/decks"; m.state.currentPath = PATH;
    const seen = [];
    m.deckIO.onSaveStatus((s) => seen.push(s));
    m.saveCurrent(DECK());
    await m.flushNow();                       // saving + saved
    cfg.write = () => new Error("EACCES /decks/a.vela denied");
    m.saveCurrent(DECK());
    await m.flushNow();                       // saving + failed
    cfg.write = () => new Error("NL_TOKEN invalid: connection closed");
    m.saveCurrent(DECK());
    await m.flushNow();                       // reconnecting
    assert(seen.length >= 4, "expected several status emissions, got " + seen.length);
    for (const s of seen) {
      const keys = Object.keys(s).sort().join(",");
      assert(keys === "at,name,state", "unexpected status keys: " + keys);
      assert(s.name === "a.vela", "name is not a basename: " + s.name);
      for (const v of Object.values(s)) {
        assert(!/[\\/]/.test(String(v)), "status leaked a path-shaped value: " + JSON.stringify(s));
      }
    }
    assert(m.deckIO.saveStatus() && Object.keys(m.deckIO.saveStatus()).sort().join(",") === "at,name,state",
      "cached saveStatus() has a wider shape than the emitted payload");
  });

  // 17. flushNow is an operation, not a capability: arguments are ignored.
  await test("boundary: flushNow ignores any argument passed by the renderer", async () => {
    const N = makeNeu({});
    const m = buildModule(N, recordingConsole());
    m.state.folder = "/decks"; m.state.currentPath = PATH;
    m.saveCurrent(DECK());
    await m.deckIO.flushNow({ path: "/etc/passwd" }, "extra");
    assert(N.files[PATH], "pending deck was not written to the current path");
    assert(!N.files["/etc/passwd"], "flushNow honoured a caller-supplied path");
    assert(m.deckIO.flushNow.length === 0, "flushNow declares parameters (should take none)");
  });

  // 9. Source pins: the shipped code keeps the real backoff + no-swallow emits.
  await test("source: real backoff array + no-swallow status emits are present", async () => {
    assert(/SAVE_RETRY_DELAYS\s*=\s*\[\s*\d+\s*,\s*\d+\s*\]/.test(SRC), "SAVE_RETRY_DELAYS backoff array missing");
    assert(SRC.includes('emitStatus('), "emitStatus not used");
    assert(SRC.includes('reconnecting'), "reconnecting status missing");
    assert(SRC.includes('lastWrittenSig'), "echo-guard signature missing");
    assert(SRC.includes('verifyWrite'), "verify-after-write missing");
    assert(SRC.includes('lastWrittenText'), "exact-bytes echo baseline missing");
    assert(/const MAX_DECK_BYTES = 5 \* 1024 \* 1024;/.test(SRC), "deck read size cap missing");
    assert(/const WATCHER_IGNORE_MS = 400;/.test(SRC), "watcher ignore window not back to the small fast-path value");
    assert(SRC.includes('async function readDeckText('), "single audited read entry point missing");
    // Exactly one direct filesystem read call in the module — the chokepoint.
    assert((SRC.match(/Neutralino\.filesystem\.readFile\(/g) || []).length === 1,
      "deck reads bypass readDeckText (more than one direct readFile call)");
    // The status payload must never be handed the raw error again.
    assert(!/emitStatus\(\{[^}]*error:/.test(SRC), "status payload still carries a raw error across the boundary");
    // The old swallow — nulling pending BEFORE the await — must be gone.
    assert(!/if \(!deck \|\| !path\) return;\s*\n\s*state\.pendingDeck = null;\s*\n\s*state\.pendingPath = null;/.test(SRC),
      "flushSave still clears pending before the write (data-loss regression)");
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
