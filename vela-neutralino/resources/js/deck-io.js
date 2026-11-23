// Folder-based deck I/O for the Neutralino shell.
//
// Replaces what serve.py does today for the web preview: pick a folder on
// first launch, list .vela/.json files, load one into the running Vela
// instance, and mirror in-app edits back to disk. Adds `createWatcher` for
// two-way sync with external editors (VS Code, Claude Code on the side).
//
// Exposed surface (consumed by nl-boot.js):
//   deckIO.init()                     → resolves after folder is chosen
//   deckIO.listDecks()                → [{ name, path }]
//   deckIO.openDeck(path)             → loads into Vela, starts watcher
//   deckIO.saveCurrent(deckObject)    → debounced write to disk
//   deckIO.currentPath()              → string | null
//
// All disk writes are debounced and tagged so the watcher callback can skip
// our own echoes (otherwise a save → watcher-event → reload cycle loops).

import { fsGuard } from "./fs-guard.js";

const FOLDER_KEY = "nl-deck-folder";
const LAST_DECK_KEY = "nl-last-deck";
const SAVE_DEBOUNCE_MS = 200;
// Cheap fast-path only. The DEFINITIVE echo guard in onWatchEvent compares the
// on-disk bytes against the exact bytes we last wrote (signature AND full text),
// so a slow write whose echo lands after this window is still recognised as ours.
// Because the window now short-circuits before we touch the filesystem at all, it
// is kept deliberately small: a wide window would also swallow a genuine external
// edit that happens to land right after one of our saves.
const WATCHER_IGNORE_MS = 400;
// Upper bound on a deck file we are willing to read into memory and JSON.parse
// in response to a watcher event. The watcher fires for whatever lands in the
// folder, so the read must be bounded BEFORE it happens. 50 MB: decks with
// embedded images pass 5 MB, and a larger deck must still reload live.
const MAX_DECK_BYTES = 50 * 1024 * 1024;
// Backoff between write attempts. A Windows write can transiently reject under
// AV real-time scanning, a synced folder (OneDrive/Dropbox), or a briefly-held
// file handle. 3 attempts total: the initial write + these two delays.
const SAVE_RETRY_DELAYS = [400, 1500];
// Upper bound on ONE native filesystem call made by a save (write, verify, probe).
// A native promise can stay unsettled forever (for example, the socket drops after
// the call is sent). Without a bound, one such call stops the serialized flush
// chain: every later save and the Retry button wait behind it forever. A call that
// times out counts as a failed attempt (pending is kept; the status says "failed").
const NATIVE_CALL_TIMEOUT_MS = 15000;
// A write that timed out can still land later ("stray"). We keep its bytes so we
// can detect and repair a late landing (see trackStray). At most this many strays
// may be unsettled at a time: past the cap the native side is plainly stuck, so we
// do not queue more writes (and more deck copies in memory) behind it.
const MAX_STRAY_WRITES = 3;
// How long a retired stray (sent on a closed socket) stays known for text matching.
// Closing the socket does not cancel a write the runtime already received: on a slow
// disk it can still land after the reconnect, and it must then be repaired, not
// loaded as an outside edit (that would undo a newer confirmed save). A write that
// lands later than this is not realistic. The limit keeps the other risk small: an
// outside write of the same old bytes (for example a restored conflict copy) is
// taken for our own stray only inside this window.
const RETIRED_STRAY_TTL_MS = 10 * 60 * 1000;
// Quiet time before a resync (after a reconnect or a wake) reads the disk. It must
// stay longer than the app's own save debounce (600 ms, localSyncTimer in
// part-app.jsx): the last edit made before the drop then arrives as pendingDeck
// BEFORE resync decides "ours", "external" or "conflict". A shorter wait can see
// no pending edit and load the disk version over an edit that is still on its way.
const RESYNC_QUIET_MS = 800;
// Most attempts to find a free name for a conflict copy (base name, then -2 … -20).
const CONFLICT_COPY_MAX = 20;
// Cap of the deck-name part of a conflict copy name, in UTF-8 bytes. Most file
// systems limit ONE name to 255 bytes; a cap by characters lets a long CJK or
// emoji name pass 255 bytes, and then every copy fails. 150 + the suffix
// ".conflict-YYYYMMDD-HHMMSS-20.vela" stays well under 255.
const CONFLICT_STEM_MAX_BYTES = 150;
// A resync that finds an external change but no pending edit always waits this
// long once, then looks again. The app debounces its own saves (600 ms), so an
// edit can still be on its way even when the app did not call saveCurrent
// recently; loading the file over it would lose it.
const APP_EDIT_GRACE_MS = 1500;
// Delays between resync retries while saves are held because the deck file
// could not be read or is not a deck (see blockSync). The last value repeats.
const SYNC_RETRY_DELAYS = [2000, 5000, 15000, 30000];
// Fixed text for a deck switch refused while unsaved edits are held.
const SAVE_HELD_MSG = "Unsaved changes are waiting to save";

const state = {
  folder: null,
  currentPath: null,
  watcherId: null,
  saveTimer: null,
  lastWriteAt: 0,
  pendingDeck: null,
  pendingPath: null,  // path captured at saveCurrent time, not flush time
  switching: false,   // true while openDeck/reselectFolder is in flight
  onDeckLoaded: null, // set by nl-boot
  onStatus: null,     // set by nl-boot — receives {state,path,at,error}
  saveStatus: null,   // latest emitted status (mirrored to window.__velaSaveState)
  lastWrittenSig: null, // signature of the exact bytes last written (echo guard)
  lastWrittenText: null, // those exact bytes — the signature alone can collide
  saveWaiter: null,   // { deck, resolve } — the promise saveCurrent returned for pendingDeck
  flushChain: Promise.resolve(), // tail of the serialized flush runs (see flushSave)
  writeSeq: 0,        // order of every write attempt issued by a save
  strays: [],         // [{ seq, path, text, landed, epoch, retired }] timed-out writes that may still land
  confirmed: new Map(), // path → { seq, text, deck } newest confirmed write while an older stray exists
  conn: null,         // native connection view from nl-boot ({state, epoch, onChange, suspect}); null = old behaviour
  lastEpoch: 0,       // connection epoch deck-io has seen (a larger epoch = a reconnect)
  paused: false,      // true while a sync conflict waits for the user's choice: no save, no reload
  conflict: null,     // { path } of the open conflict
  onConflict: null,   // set by nl-boot — receives the deck basename only
  onConflictCleared: null, // set by nl-boot — the conflict was cleared by a deck switch (close the dialog)
  conflictReason: null, // fixed code of the last failed conflict choice (see resolveConflict)
  syncBlocked: false, // true while saves are held because a resync could not read or parse the file
  syncRetryTimer: null, // timer of the next resync retry while syncBlocked
  syncRetryIdx: 0,    // index into SYNC_RETRY_DELAYS
  appReady: false,    // set by nl-boot after the app mounted (see setAppReady)
  resyncWanted: false, // a resync was asked for before the app was ready
  lastCopyPath: null,  // path of the newest verified conflict copy (shell side only, never emitted)
  inflight: null,     // { path, text } of the save write in flight (watcher: our bytes, not a conflict)
  resyncQueued: false, // a resync is queued and has not started yet (de-duplicates bursts)
  resyncRun: null,    // the promise of that queued resync
};

// True when a connection is attached and it is not open. Without a connection
// (old boot, old tests) this is always false, so the old behaviour is unchanged.
function connDown() {
  return !!state.conn && state.conn.state() !== "connected";
}

// Connection epoch NOW. A write records it when it is ISSUED: a write sent before
// a drop that times out after the reconnect is still an old-connection write.
function connEpoch() {
  return state.conn ? state.conn.epoch() : 0;
}

// A deck switch drops the pending save. While that save is HELD (the socket
// is down, or a conflict waits for the user) the user saw no "failed" for it, so
// dropping it would lose edits without a word. Refuse the switch instead; the
// caller shows the fixed message. Must run before the switch changes any state.
function saveHeld() {
  return !!state.pendingDeck && (connDown() || state.paused);
}
function refuseIfHeld() {
  if (!saveHeld()) return;
  console.warn("[deck-io] deck switch refused: unsaved changes are held");
  const e = new Error(SAVE_HELD_MSG);
  e.code = "VELA_SAVE_HELD";
  throw e;
}

// A deck switch ends the conflict and the held sync of the old deck. When a
// conflict was open, tell nl-boot so it closes the dialog (else the dialog stays
// on a deck that is gone, and its choices can only fail).
function clearConflictForSwitch() {
  const was = state.paused || !!state.conflict;
  state.paused = false;
  state.conflict = null;
  clearSyncBlock();
  if (was && typeof state.onConflictCleared === "function") { try { state.onConflictCleared(); } catch {} }
}

// Race a native call against NATIVE_CALL_TIMEOUT_MS. The rejection carries
// `timedOut: true` so the caller can tell "no answer" from a real error.
function withTimeout(p) {
  let t;
  const timer = new Promise((_, reject) => {
    t = setTimeout(() => { const e = new Error("native call timed out"); e.timedOut = true; reject(e); }, NATIVE_CALL_TIMEOUT_MS);
  });
  return Promise.race([Promise.resolve(p), timer]).finally(() => clearTimeout(t));
}

// Retired strays (sent on an older connection, see retireOldStrays) do not count:
// that socket is gone, so they cannot block the MAX_STRAY_WRITES fail-fast check
// for good. They stay in the list so a late landing is still recognised.
function unsettledStrays() { return state.strays.filter((s) => !s.landed && !s.retired).length; }

function forgetStrays(list) {
  state.strays = state.strays.filter((s) => !list.includes(s));
  for (const path of [...state.confirmed.keys()]) {
    if (!state.strays.some((s) => s.path === path)) state.confirmed.delete(path);
  }
}

// A write timed out but its native call may still land. Guarantee kept here: a
// late stray can NEVER leave older bytes on disk after a newer save resolved true.
// When the stray settles as written (or the watcher sees its exact bytes on disk),
// repairAfterStray re-writes the newest confirmed bytes for that path. A stray that
// settles as failed wrote nothing and is forgotten.
function trackStray(writePromise, seq, path, text, epoch) {
  const s = { seq, path, text, landed: false, epoch, retired: false, at: Date.now() };
  state.strays.push(s);
  Promise.resolve(writePromise).then(
    () => { s.landed = true; scheduleRepair(path); },
    () => { if (!s.landed) forgetStrays([s]); },
  );
}

// After a reconnect, a stray sent on an older connection gets no answer any more.
// Retire it so it stops counting toward MAX_STRAY_WRITES (else three drops block
// every later save for good). Keep at most MAX_STRAY_WRITES retired entries in
// memory; each one holds a full deck text. Retired strays stay known for text
// matching for RETIRED_STRAY_TTL_MS (see there), then they are forgotten.
function retireOldStrays() {
  if (!state.conn) return;
  const ep = state.conn.epoch();
  for (const s of state.strays) if (!s.landed && !s.retired && s.epoch < ep) s.retired = true;
  pruneRetiredStrays();
  const retired = state.strays.filter((s) => s.retired && !s.landed);
  if (retired.length > MAX_STRAY_WRITES) forgetStrays(retired.slice(0, retired.length - MAX_STRAY_WRITES));
}

function pruneRetiredStrays() {
  const now = Date.now();
  const old = state.strays.filter((s) => s.retired && !s.landed && now - (s.at || 0) > RETIRED_STRAY_TTL_MS);
  if (old.length) forgetStrays(old);
}

// Repairs run on the same serialized chain as saves, so a repair never races a
// save run, and it decides only after any run that was in flight has finished.
function scheduleRepair(path) {
  const run = state.flushChain.then(() => repairAfterStray(path));
  state.flushChain = run.catch(() => {});
  return run;
}

async function repairAfterStray(path) {
  // WHY: a repair writes without asking the user. No write while a conflict waits
  // for the user (paused), while a resync could not read the file (syncBlocked),
  // or while the socket is down (the call would queue and go out later, over
  // what is on disk then). The landed strays stay; a later resync repairs them.
  if (repairHeld()) return;
  const landed = state.strays.filter((s) => s.path === path && s.landed);
  if (!landed.length) return;
  const good = state.confirmed.get(path);
  // Only a stray issued BEFORE the newest confirmed write can have overwritten it.
  const older = good ? landed.filter((s) => s.seq < good.seq) : [];
  forgetStrays(landed.filter((s) => !older.includes(s)));
  if (!older.length) return;
  let text = null;
  try { text = await withTimeout(readDeckText(path)); } catch { text = null; }
  // The state can change during the read: check the gate again.
  if (repairHeld()) return;
  if (text === null) {
    // WHY: we could not see the disk, so we cannot know if it holds the stray or
    // an outside edit. Never write blind. Re-arm the newest bytes as pending (the
    // next save or Retry writes them through the normal gated path) and say so.
    forgetStrays(older);
    console.error("[deck-io] repair after a late write: the file could not be read:", path);
    rearmGood(path, good);
    return;
  }
  // Disk still holds the confirmed bytes, or a later external edit: do not touch it.
  if (text === good.text || !older.some((s) => s.text === text)) { forgetStrays(older); return; }
  const seq = ++state.writeSeq;
  const ep = connEpoch();
  let w = null;
  try {
    state.lastWriteAt = Date.now();
    w = Neutralino.filesystem.writeFile(path, good.text);
    await withTimeout(w);
    state.lastWriteAt = Date.now();
    if (path === state.currentPath) { state.lastWrittenSig = sigOf(good.text); state.lastWrittenText = good.text; }
    if ((await verifyWrite(path, byteLen(good.text), good.text)) === "mismatch") throw new Error("verify-after-write mismatch");
    forgetStrays(older);
  } catch (e) {
    forgetStrays(older);
    if (e && e.timedOut && w) trackStray(w, seq, path, good.text, ep);
    console.error("[deck-io] repair after a late write failed:", path, e);
    rearmGood(path, good);
  }
}

// True when a repair must not touch the disk now (see repairAfterStray).
function repairHeld() {
  return state.paused || state.syncBlocked || connDown();
}

// Could not put the newest bytes back. Re-arm them as pending (when nothing
// newer is pending) so the next autosave or Retry writes them, and say so.
function rearmGood(path, good) {
  if (!state.pendingDeck && !state.switching && path === state.currentPath) {
    state.pendingDeck = good.deck; state.pendingPath = path;
  }
  emitStatus({ state: "failed", path, at: Date.now() });
}

// Settle the promise saveCurrent returned (true = write confirmed on disk).
// The app advances its "file already holds this" signature only on true, so a
// failed or superseded save is never mistaken for a written one.
function settleWaiter(deck, written) {
  const w = state.saveWaiter;
  if (!w || (deck !== undefined && w.deck !== deck)) return;
  state.saveWaiter = null;
  w.resolve(written);
}

// Cheap deterministic signature of a string, used for timing-independent
// self-echo suppression in onWatchEvent: if the file on disk matches the exact
// bytes we last wrote, the watcher event is our own save echoing back — never
// treat it as an external edit (that path suppresses autosave and can starve it).
function sigOf(str) {
  const s = String(str == null ? "" : str);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${byteLen(s)}:${(h >>> 0).toString(36)}`;
}

// UTF-8 byte length — must match what Neutralino.filesystem.getStats reports as
// the file size so verify-after-write can compare them.
function byteLen(str) {
  const s = String(str == null ? "" : str);
  try { if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s).length; } catch {}
  try { if (typeof Buffer !== "undefined") return Buffer.byteLength(s, "utf8"); } catch {}
  return s.length;
}

// A connection/token-shaped error means the native WebSocket dropped (most
// often after the machine slept / idled for a long time) — recover via a
// liveness probe + retry and report "reconnecting", rather than a generic fail.
function isConnError(e) {
  const m = String((e && (e.message || e.code)) || e || "").toLowerCase();
  return /token|nl_token|connection|socket|websocket|econn|not connected|disconnect|closed/.test(m);
}

// Last path segment. Used to keep absolute paths on this side of the boundary.
function baseName(p) {
  return String(p == null ? "" : p).replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() || "";
}

// Shell → renderer status boundary. The renderer is the less-trusted side and
// only needs enough to render a pill, so it gets {state, at, name} — a basename,
// never the absolute path, and never the raw platform error. Path and error stay
// here and go to the console for the person debugging the machine. Trimming at
// this single chokepoint means no call site can widen the payload by accident.
function emitStatus(s) {
  const out = { state: s.state, at: s.at || Date.now(), name: baseName(s.path) };
  state.saveStatus = out;
  if (typeof state.onStatus === "function") { try { state.onStatus(out); } catch {} }
}

// Post-write verification. Size alone is a weak check (a truncated-then-padded or
// concurrently-rewritten file has the right length), so read the file back and
// require it to be byte-identical to what we meant to write. Tri-state:
//   "verified" — on-disk content is exactly our bytes
//   "mismatch" — it is not: treat as a failed write so the retry loop re-attempts
//   "unknown"  — the platform gave us no way to check (no size, read unavailable).
//                We do NOT claim success in that case: the caller emits a distinct
//                "unverified" status so an unverifiable write is never silent.
async function verifyWrite(path, expectedBytes, expectedText) {
  let st;
  try { st = await withTimeout(Neutralino.filesystem.getStats(path)); } catch { return "unknown"; }
  if (!st || typeof st.size !== "number") return "unknown";
  if (st.size !== expectedBytes) return "mismatch";
  let text;
  try { text = await withTimeout(readDeckText(path)); } catch { return "unknown"; }
  if (typeof text !== "string") return "unknown";
  if (sigOf(text) !== sigOf(expectedText)) return "mismatch";
  return text === expectedText ? "verified" : "mismatch";
}

async function getStoredFolder() {
  try {
    const keys = await Neutralino.storage.getKeys();
    if (!keys.includes(FOLDER_KEY)) return null;
    const val = await Neutralino.storage.getData(FOLDER_KEY);
    if (!val) return null;
    // Allow the candidate root before the guarded getStats below.
    fsGuard.allow(val);
    // Verify it still exists — user might have moved or deleted it.
    try { await Neutralino.filesystem.getStats(val); return val; }
    catch { return null; }
  } catch { return null; }
}

async function pickFolder() {
  const path = await Neutralino.os.showFolderDialog("Choose your Vela decks folder");
  if (!path) throw new Error("no folder selected");
  // The user just chose this folder — register it as an allowed FS root.
  fsGuard.allow(path);
  await Neutralino.storage.setData(FOLDER_KEY, path);
  return path;
}

async function listDecks() {
  if (!state.folder) return [];
  const entries = await Neutralino.filesystem.readDirectory(state.folder);
  return entries
    .filter((e) => e.type === "FILE" && /\.(vela|json)$/i.test(e.entry))
    .map((e) => ({
      name: e.entry,
      path: `${state.folder}/${e.entry}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// THE single filesystem read entry point for deck content. Every read — open,
// watcher reload, post-write verification — goes through here so there is exactly
// one place to audit (and, later, to extend with further checks). Do not call
// Neutralino.filesystem.readFile directly elsewhere in this module.
async function readDeckText(path) {
  return await Neutralino.filesystem.readFile(path);
}

async function openDeck(path) {
  refuseIfHeld();
  // Read and parse the new deck FIRST. If that fails (missing file, malformed
  // .vela), the current deck must stay exactly as it was: its pending save still
  // flushes and its watcher keeps running. The error goes to the caller.
  // The text is kept: it becomes the sync baseline below.
  // Bounded: a read sent on a socket that then drops never settles. Unbounded, the
  // switch would wait for good (the failure is thrown before anything changes).
  const text = await withTimeout(readDeckText(path));
  const deck = JSON.parse(text);
  refuseIfHeld(); // the state can change during the read
  // Cancel any pending save from the previous deck BEFORE changing
  // currentPath — otherwise flushSave() writes old data to the new file.
  if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
  state.pendingDeck = null;
  state.pendingPath = null;
  settleWaiter(undefined, false); // the dropped save was not written
  // A conflict belongs to the deck it was found on. The user chose another deck.
  clearConflictForSwitch();
  // Reject saves for the duration of the switch. The React app still holds the
  // PREVIOUS deck and its debounced autosave (__velaSendDeckUpdate) can fire
  // during the awaits below — after currentPath has advanced to `path`. Without
  // this guard that stale save captures the NEW path and writes the OLD deck's
  // content into the file we just opened (data loss). saveCurrent() drops while
  // switching is true; the app's own _localSyncIncoming guard covers the
  // post-load settle once the new deck is pushed in.
  state.switching = true;
  try {
    await stopWatcher();
    state.currentPath = path;
    // Sync baseline = the bytes the app now shows. resync compares the disk with
    // it: equal → nothing changed outside Vela. Without it, the first resync after
    // a reconnect sees "external change" and can raise a false conflict.
    state.lastWrittenSig = sigOf(text);
    state.lastWrittenText = text;
    rememberLastDeck(path);
    if (state.onDeckLoaded) state.onDeckLoaded(deck, path);
    startWatcher();
    return deck;
  } finally {
    state.switching = false;
  }
}

function saveCurrent(deckObject) {
  if (!state.currentPath || state.switching) return Promise.resolve(false);
  settleWaiter(undefined, false); // superseded by this newer deck
  state.pendingDeck = deckObject;
  // Capture path NOW — flushSave must write to the file that was active
  // when the save was requested, not whatever currentPath points to later
  // (it may have changed due to a deck switch during the debounce window).
  state.pendingPath = state.currentPath;
  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  return new Promise((resolve) => { state.saveWaiter = { deck: deckObject, resolve }; });
}

// Flush runs are SERIALIZED: each run starts only after the previous one ends,
// and reads the newest pendingDeck when it starts. Without this, an older run
// (a slow write, or a retry after a failed write) can land its bytes AFTER a
// newer run wrote and resolved true — the file then holds the older deck while
// the app believes it holds the newer one, and the app's no-edit guard skips
// every later identical flush (silent app/disk divergence).
function flushSave() {
  const run = state.flushChain.then(flushSaveOnce);
  state.flushChain = run.catch(() => {});
  return run;
}

// Save gate. Returns true when this run must NOT write now; pending stays and the
// waiter stays open (the save is held, not failed).
// - paused: a sync conflict waits for the user. A write now would replace the
//   file version the user has not seen yet (data loss).
// - connection down: the client queues the call on a closed socket and it never
//   settles, or it goes out on a socket the runtime no longer reads. Hold the
//   save; the "connected" handler (attachConnection) flushes it or resyncs.
// - syncBlocked: a resync could not read the file or it is not a deck. A write
//   now would replace content we could not see (see blockSync).
function saveGated(path) {
  if (state.paused) return true;
  if (state.syncBlocked) {
    emitStatus({ state: "failed", path, at: Date.now() });
    return true;
  }
  if (connDown()) {
    // "closed" is terminal (for example an invalid token): no reconnect comes.
    emitStatus({ state: state.conn.state() === "closed" ? "failed" : "reconnecting", path, at: Date.now() });
    return true;
  }
  return false;
}

async function flushSaveOnce() {
  const deck = state.pendingDeck;
  const path = state.pendingPath;
  if (!deck || !path) return;
  // Do NOT clear pendingDeck/pendingPath up front — keep the payload so a failed
  // write is never lost. It is cleared only after a CONFIRMED successful write,
  // and only if a newer edit hasn't superseded it in the meantime. This is the
  // core "keep-pending-on-failure" guarantee behind the Retry affordance.
  // Gate before any status or write: see saveGated.
  if (saveGated(path)) return;
  const json = JSON.stringify(deck, null, 2);
  const bytes = byteLen(json);
  const sig = sigOf(json);
  emitStatus({ state: "saving", path, at: Date.now() });

  const attempts = SAVE_RETRY_DELAYS.length + 1;
  let lastErr = null, conn = false;
  // Stale run: a deck switch (openDeck/newDeck) moved the target, or a newer
  // deck is pending. The next serialized run writes that newer deck, so this
  // run must not write (or retry) the older bytes after it.
  const stale = () => (state.pendingPath && state.pendingPath !== path) ||
    (state.pendingDeck && state.pendingDeck !== deck);
  for (let i = 0; i < attempts; i++) {
    if (stale()) { settleWaiter(deck, false); return; }
    // The socket can drop between two attempts: do not burn the retries on it.
    if (i > 0 && saveGated(path)) return;
    const seq = ++state.writeSeq;
    const ep = connEpoch();
    let w = null;
    try {
      // Native side plainly stuck: fail fast instead of queuing one more write.
      if (unsettledStrays() >= MAX_STRAY_WRITES) throw new Error("earlier writes still unanswered");
      state.lastWriteAt = Date.now();
      // The watcher can see these bytes before the write answers (slow disk). They
      // are ours: see onWatchEvent (else a pending edit makes them a false conflict).
      state.inflight = { path, text: json };
      w = Neutralino.filesystem.writeFile(path, json);
      await withTimeout(w);
      // Stamp again AFTER the write resolves so the watcher-echo window is
      // measured from completion, not from when we started.
      state.lastWriteAt = Date.now();
      const verdict = await verifyWrite(path, bytes, json);
      if (verdict === "mismatch") throw new Error("verify-after-write mismatch");
      // Write landed. Record the exact bytes so our own watcher echo is suppressed
      // (timing-independent), then clear pending only if unchanged.
      state.lastWrittenSig = sig;
      state.lastWrittenText = json;
      state.lastWriteAt = Date.now();
      // An older stray to this path may still land: remember these bytes so the
      // repair can put them back (see trackStray).
      if (state.strays.some((s) => s.path === path && s.seq < seq)) state.confirmed.set(path, { seq, text: json, deck });
      else state.confirmed.delete(path);
      if (state.pendingDeck === deck) { state.pendingDeck = null; state.pendingPath = null; }
      settleWaiter(deck, true);
      if (verdict === "unknown") {
        // The bytes went out and the platform reported no error, but we could not
        // read them back to prove it. Report that honestly rather than showing a
        // confident "Saved" the user cannot rely on.
        console.warn("[deck-io] write could not be verified (read-back unavailable):", path);
        emitStatus({ state: "unverified", path, at: Date.now() });
      } else {
        emitStatus({ state: "saved", path, at: Date.now() });
      }
      return;
    } catch (e) {
      lastErr = e;
      if (e && e.timedOut) {
        // No answer from the native side. Do not retry inside this run (that only
        // stacks more unanswered writes): end it as failed so later saves and Retry
        // go ahead. The write may still land; trackStray repairs that case.
        if (w) trackStray(w, seq, path, json, ep);
        // A silent socket is the usual cause: ask the connection to check itself
        // now instead of waiting for the next focus or wake event.
        if (state.conn) { try { state.conn.suspect(); } catch {} }
        if (stale()) { settleWaiter(deck, false); return; }
        break;
      }
      if (isConnError(e)) {
        conn = true;
        // Liveness probe: if the folder still stats OK the socket is alive and
        // this was a one-off; otherwise stay in a "reconnecting" posture.
        console.warn("[deck-io] save connection error:", path, e);
        emitStatus({ state: "reconnecting", path, at: Date.now() });
        try { await withTimeout(Neutralino.filesystem.getStats(state.folder)); conn = false; } catch {}
      }
      if (i < attempts - 1 && !stale()) await new Promise((r) => setTimeout(r, SAVE_RETRY_DELAYS[i]));
    } finally {
      if (state.inflight && state.inflight.text === json) state.inflight = null;
    }
  }
  // Final failure — KEEP pendingDeck/pendingPath so the next autosave or a
  // manual __velaForceSave re-attempts the newest content. Never swallow: the
  // status is emitted so the UI can show it, in addition to the console log.
  // The raw error and the absolute path stay here (console); the renderer gets
  // only the state + basename.
  console.error("[deck-io] save failed:", path, lastErr);
  settleWaiter(deck, false);
  // A call on a dropped socket never answers; it ends here by the timeout. While
  // the connection is coming back, say "reconnecting" (the reconnect resyncs and
  // writes pending). "closed" is terminal: "failed".
  const down = connDown() && state.conn.state() !== "closed";
  emitStatus({ state: conn || down ? "reconnecting" : "failed", path, at: Date.now() });
}

// Bypass the debounce and immediately re-attempt the pending write. Wired to
// window.__velaForceSave for the save-status pill's "Retry" affordance. If the
// last save failed, pendingDeck still holds the newest deck, so this flushes it.
// Takes NO arguments, deliberately: it is an operation ("re-save what is pending"),
// not a capability the renderer can aim at a path or payload of its choosing. Any
// argument passed by a caller is ignored.
async function flushNow() {
  if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
  // Saves are held by an open conflict or by a failed resync read: a write is not
  // what is needed. Re-check the disk instead; with an open conflict this asks
  // the user again (see resyncOnce).
  if (state.paused || state.syncBlocked) return resync();
  return flushSave();
}

async function startWatcher() {
  if (!state.folder || state.watcherId != null) return;
  try {
    state.watcherId = await Neutralino.filesystem.createWatcher(state.folder);
    Neutralino.events.on("watchFile", onWatchEvent);
  } catch (e) {
    console.warn("[deck-io] watcher unavailable:", e);
  }
}

// Remember the open deck for the next launch. Best effort and NOT awaited: it is
// not needed for the switch, and awaiting it inside a switch (after currentPath
// moved) let a call that never settles (socket dropped) keep `switching` true for
// good, so every later save was dropped with no status.
function rememberLastDeck(path) {
  try { Promise.resolve(Neutralino.storage.setData(LAST_DECK_KEY, path)).catch(() => {}); } catch {}
}

async function stopWatcher() {
  if (state.watcherId == null) return;
  try {
    // Bounded for the same reason as rememberLastDeck: a deck switch awaits it.
    await withTimeout(Neutralino.filesystem.removeWatcher(state.watcherId));
  } catch {}
  Neutralino.events.off("watchFile", onWatchEvent);
  state.watcherId = null;
}

function onWatchEvent(evt) {
  // Neutralino watcher event: { id, action, dir, filename }.
  // Action values in Neutralino 6.x: "add", "modified", "delete", "moved".
  // Editors that save via atomic-rename (VS Code, many Claude Code tools)
  // surface as "moved" or "add" rather than "modified", so we accept all
  // three write-shaped actions.
  // During a sync conflict the user decides which version wins. A reload here
  // would replace the app's unsaved version before that choice (data loss).
  if (state.paused) return;
  const payload = evt && evt.detail;
  if (!payload || !state.currentPath) return;
  const changed = `${payload.dir}/${payload.filename}`.replace(/\\/g, "/");
  const cur = state.currentPath.replace(/\\/g, "/");
  if (changed !== cur) return;
  if (payload.action !== "modified" && payload.action !== "add" && payload.action !== "moved") return;
  // 1) Cheap fast-path FIRST — inside the ignore window this is almost certainly
  //    our own write echoing back, so do not touch the filesystem at all. Reading
  //    first meant every one of our own saves paid a full file read.
  if (Date.now() - state.lastWriteAt < WATCHER_IGNORE_MS) return;
  const path = state.currentPath;
  // Each await below can let a conflict open, the user switch decks, or a
  // switch start. Re-check after every await; a stale event does nothing.
  const live = () => !state.paused && path === state.currentPath && !state.switching;
  (async () => {
    // 2) Bound the read BEFORE it happens. The watcher fires for whatever landed
    //    in the folder; an arbitrarily large file must not be pulled into memory
    //    and JSON.parsed. Oversized → warn and skip, never silently.
    let size = null;
    try {
      const st = await Neutralino.filesystem.getStats(path);
      if (st && typeof st.size === "number") size = st.size;
    } catch { /* no size available — fall through to the read */ }
    if (!live()) return;
    if (size != null && size > MAX_DECK_BYTES) {
      console.warn(`[deck-io] ignoring external change: ${size} bytes exceeds the ${MAX_DECK_BYTES}-byte deck limit`, path);
      return;
    }
    // 3) Now read, through the single audited entry point.
    const text = await readDeckText(path);
    if (!live()) return;
    // 3b) Close the stat→read TOCTOU: a local writer can grow the file past the
    //     cap AFTER the getStats above but BEFORE this read, so the size we just
    //     read is the only trustworthy measure. Re-check the actual bytes and
    //     skip (warn, non-silent) rather than let an oversized document reach
    //     JSON.parse.
    const readBytes = byteLen(text);
    if (readBytes > MAX_DECK_BYTES) {
      console.warn(`[deck-io] ignoring external change: read ${readBytes} bytes exceeds the ${MAX_DECK_BYTES}-byte deck limit (grown after stat)`, path);
      return;
    }
    // Echo suppression, definitive and timing-independent: the signature narrows
    // the compare cheaply, the exact-text compare confirms it. The signature is a
    // short digest, so two different documents can share one — on its own it could
    // drop a genuine external edit as "our own echo" (silent app/disk divergence).
    if (state.lastWrittenSig && sigOf(text) === state.lastWrittenSig && text === state.lastWrittenText) return;
    // A stray (timed-out) write of ours landed late. It is our own older bytes, not
    // an external edit: do not reload it into the app; put the newest bytes back.
    pruneRetiredStrays();
    const stray = state.strays.find((s) => s.path === path && s.text === text);
    if (stray) { stray.landed = true; scheduleRepair(path); return; }
    // Our save write in flight (slow disk): its bytes, not an outside edit.
    if (state.inflight && state.inflight.path === path && state.inflight.text === text) return;
    // Only a Full-format deck (a "lanes" array) is given to the app; the app
    // ignores anything else, so loading it would only move the baseline.
    const deck = parseDeckObject(text);
    if (!deck) { console.warn("[deck-io] external change is not a valid deck; nothing loaded"); return; }
    // An unsaved edit exists for this file. Loading the file would replace
    // it, and its later write would replace the file: the same conflict as in
    // resync. Let the user choose.
    if (pendingFor(path)) { raiseConflict(path); return; }
    // D5/CR3: adopt the just-loaded external content as the new echo baseline
    // (adoptExternal). Without this the baseline only ever tracks OUR writes, so a
    // later external revert to a byte-exact previously-Vela-written state would
    // match the stale baseline and be wrongly dropped as "our own echo".
    if (!adoptExternal(path, text, deck)) {
      console.warn("[deck-io] external change not applied: the app is not ready");
      // WHY: the change is not in the app and the watcher sends no second
      // event for it. Ask for a resync: setAppReady runs it when the app is
      // mounted (as resync does, retry later if the app is ready already).
      if (state.appReady) scheduleSyncRetry(); else state.resyncWanted = true;
    }
  })().catch((e) => console.warn("[deck-io] external reload failed:", e));
}

function pendingFor(path) {
  return !!state.pendingDeck && state.pendingPath === path;
}

// Both sides changed: the file on disk and the app's unsaved edit. Writing the
// edit would destroy the file version; loading the file would destroy the edit.
// Pause both and let the user choose (nl-boot shows the dialog). Without a
// handler (no dialog): keep pending, say "failed", do not pause.
function raiseConflict(path) {
  clearSyncBlock();
  emitStatus({ state: "failed", path, at: Date.now() });
  console.warn("[deck-io] deck changed on disk while Vela had unsaved edits");
  if (typeof state.onConflict === "function") {
    state.paused = true;
    state.conflict = { path };
    // Basename only: the absolute path stays on this side of the boundary.
    try { state.onConflict(baseName(path)); } catch {}
  }
}

// Apply an external version of the deck: give it to the app, then make it the
// baseline. Returns false when the app reports that it did not apply it (not
// mounted yet): then NOTHING changes (no baseline move, pending kept), so the
// app's next save cannot be mistaken for "based on the file version".
// When it is applied, the app shows the file version, so an older pending
// deck for this path is dropped (else a later flush writes it over the file),
// and the confirmed bytes and strays of this path are forgotten (else a stray
// landing later makes repairAfterStray write our older bytes over the file).
function adoptExternal(path, text, deck) {
  let applied;
  try { applied = state.onDeckLoaded ? state.onDeckLoaded(deck, path, { external: true }) : undefined; }
  catch { applied = false; }
  if (applied === false) return false;
  if (state.pendingPath === path) {
    if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
    state.pendingDeck = null;
    state.pendingPath = null;
    settleWaiter(undefined, false); // the dropped save was not written
  }
  forgetStrays(state.strays.filter((s) => s.path === path));
  state.confirmed.delete(path);
  state.lastWrittenSig = sigOf(text);
  state.lastWrittenText = text;
  return true;
}

// A resync could not read the deck file, or it is not a deck, while an edit
// is pending. A write now would replace content we could not see. Hold saves
// ("failed" on the pill) and retry the resync with a backoff. Cleared by a resync
// that completes, by a deck switch, or by a conflict choice.
function blockSync(path) {
  state.syncBlocked = true;
  emitStatus({ state: "failed", path, at: Date.now() });
  scheduleSyncRetry();
}

function scheduleSyncRetry() {
  if (state.syncRetryTimer) return;
  const d = SYNC_RETRY_DELAYS[Math.min(state.syncRetryIdx, SYNC_RETRY_DELAYS.length - 1)];
  state.syncRetryIdx++;
  state.syncRetryTimer = setTimeout(() => { state.syncRetryTimer = null; resync(); }, d);
}

function clearSyncBlock() {
  state.syncBlocked = false;
  if (state.syncRetryTimer) { clearTimeout(state.syncRetryTimer); state.syncRetryTimer = null; }
  state.syncRetryIdx = 0;
}

// ── Resync after a reconnect or a wake ──
// While the socket is down, watcher events go nowhere and the runtime can lose
// its watcher. So after a reconnect we cannot trust that "no event" means "no
// change": re-arm the watcher and compare the disk with the baseline directly.

// Re-create the folder watcher on the live connection. Every native call is
// bounded: a call that never answers must not stop the serialized chain.
async function rearmWatcher() {
  if (!state.folder) return;
  try {
    Neutralino.events.off("watchFile", onWatchEvent);
    const old = state.watcherId;
    state.watcherId = null;
    if (old != null) { try { await withTimeout(Neutralino.filesystem.removeWatcher(old)); } catch {} }
    state.watcherId = await withTimeout(Neutralino.filesystem.createWatcher(state.folder));
    Neutralino.events.on("watchFile", onWatchEvent);
  } catch {
    // Fixed text only. Resync continues: the direct disk compare below still runs.
    console.warn("[deck-io] watcher could not be re-armed after reconnect");
  }
}

// Read the deck file for a resync or a conflict choice. The disk content is
// UNTRUSTED (any local process can write the folder): bound the size BEFORE the
// read and again AFTER it (the file can grow between stat and read), so an
// oversized file never reaches JSON.parse. Returns { ok: true, text } or
// { ok: false, reason: "missing" | "oversize" | "unreadable" }. The raw error is
// not returned: it must not reach a status or the renderer.
async function readForSync(path) {
  let size = null;
  try {
    const st = await withTimeout(Neutralino.filesystem.getStats(path));
    // Only a regular file is a deck. A directory or another kind of entry
    // at the deck path (the runtime stats the symlink target) is never read.
    if (!st || st.isFile !== true) return { ok: false, reason: "unreadable" };
    if (typeof st.size === "number") size = st.size;
  } catch (e) {
    // Only the runtime's "no such path" code means missing. Anything else (a
    // timeout, a guard refusal) is "unreadable": fail closed.
    return { ok: false, reason: e && e.code === "NE_FS_NOPATHE" ? "missing" : "unreadable" };
  }
  if (size != null && size > MAX_DECK_BYTES) return { ok: false, reason: "oversize" };
  let text;
  try { text = await withTimeout(readDeckText(path)); } catch { return { ok: false, reason: "unreadable" }; }
  if (typeof text !== "string") return { ok: false, reason: "unreadable" };
  if (byteLen(text) > MAX_DECK_BYTES) return { ok: false, reason: "oversize" };
  return { ok: true, text };
}

// A parsed deck must be a plain JSON object with a "lanes" array (Full format,
// what the app's receive hook accepts; it ignores any other shape). Anything else
// is malformed and is never given to the app, never adopted as the baseline, and
// never copied as a conflict copy.
function parseDeckObject(text) {
  let deck;
  try { deck = JSON.parse(text); } catch { return null; }
  return deck && typeof deck === "object" && !Array.isArray(deck) && Array.isArray(deck.lanes) ? deck : null;
}

// Public, no arguments: an operation, not a capability. A burst of calls while
// one resync waits in the queue shares that one run.
function resync() {
  if (state.resyncQueued && state.resyncRun) return state.resyncRun;
  state.resyncQueued = true;
  // On the same serialized chain as saves and repairs: a resync never races a
  // write, and it decides only after the run in flight has ended.
  const run = state.flushChain.then(resyncOnce);
  state.flushChain = run.catch(() => {});
  state.resyncRun = run.catch(() => { console.warn("[deck-io] resync failed"); });
  return state.resyncRun;
}

async function resyncOnce() {
  state.resyncQueued = false;
  // Before the app is mounted it cannot take an external load (the update
  // is lost but the baseline moves). Remember the request; setAppReady runs it.
  if (!state.appReady) { state.resyncWanted = true; return; }
  const path = state.currentPath;
  // A conflict is still open (the user closed the dialog with "keep
  // editing"). Ask again, so the user can still choose.
  if (state.paused) {
    if (state.conflict && state.conflict.path === path && typeof state.onConflict === "function") {
      try { state.onConflict(baseName(path)); } catch {}
    }
    return;
  }
  // Each await below can let the user switch decks, a conflict open, or the
  // socket drop. Re-check after every await; a stale resync does nothing (the
  // next reconnect starts a new one).
  const live = () => path === state.currentPath && !state.switching && !state.paused && !connDown();
  if (!path || !live()) return;
  await new Promise((r) => setTimeout(r, RESYNC_QUIET_MS));
  if (!live()) return;
  await rearmWatcher();
  if (!live()) return;
  const disk = await readForSync(path);
  if (!live()) return;

  // A timed-out write of ours can be what is on disk now.
  pruneRetiredStrays();
  let strayMatched = false;
  if (disk.ok) {
    for (const s of state.strays) {
      if (s.path === path && s.text === disk.text) { s.landed = true; strayMatched = true; }
    }
  }
  retireOldStrays();
  const pendingHere = () => pendingFor(path);

  if (!disk.ok) {
    // Never load and never write on a failed read: a write could replace a file
    // we could not see, a load could replace the app's deck with nothing.
    // A missing file with a pending edit: do not recreate it blindly, let the
    // user choose. WHY a conflict and not blockSync: a retry finds the file
    // missing again, so saves stay held with no exit; "mine" writes the edit
    // (no copy: nothing to keep). Any other failed read with a pending edit:
    // hold saves and retry (see blockSync).
    if (pendingHere() && disk.reason === "missing") { raiseConflict(path); return; }
    if (pendingHere()) blockSync(path); else clearSyncBlock();
    console.warn("[deck-io] resync: deck file not usable (" + disk.reason + "); nothing loaded or written");
    return;
  }
  const text = disk.text;

  if (text === state.lastWrittenText || strayMatched) {
    // The disk holds our own bytes: nothing changed outside Vela.
    clearSyncBlock();
    if (pendingHere()) {
      await flushSaveOnce(); // already on the chain: call the run body directly
      // The landed stray is now older than the confirmed write: let the repair
      // check the disk and forget it.
      if (strayMatched) await repairAfterStray(path);
    } else if (strayMatched) {
      // No newer confirmed write exists: the stray bytes are the newest we sent.
      // Adopt them as baseline, else the next resync reloads our own bytes.
      if (!state.confirmed.has(path)) { state.lastWrittenSig = sigOf(text); state.lastWrittenText = text; }
      await repairAfterStray(path);
    } else if (!state.saveStatus || state.saveStatus.state !== "saved") {
      emitStatus({ state: "saved", path, at: Date.now() });
    }
    return;
  }

  // External change. Malformed content (not a Full-format deck) is handled like
  // a failed read.
  const deck = parseDeckObject(text);
  if (!deck) {
    if (pendingHere()) blockSync(path); else clearSyncBlock();
    console.warn("[deck-io] resync: deck file is not a valid deck; nothing loaded or written");
    return;
  }
  if (pendingHere()) { raiseConflict(path); return; }
  // No pending edit now, but the app debounces its saves: an edit can still
  // be on its way. Wait once and look again; an edit that arrives is a
  // conflict, not something to load over. WHY always: the first edit after a
  // quiet time has no earlier saveCurrent call to show that it is coming.
  await new Promise((r) => setTimeout(r, APP_EDIT_GRACE_MS));
  if (!live()) return;
  if (pendingHere()) { raiseConflict(path); return; }
  // No unsaved edit: the file version wins, as for a live watcher event.
  if (!adoptExternal(path, text, deck)) {
    // The app did not take it (not mounted yet). Nothing changed: try again.
    console.warn("[deck-io] resync: external change not applied: the app is not ready");
    scheduleSyncRetry();
    return;
  }
  clearSyncBlock();
  emitStatus({ state: "saved", path, at: Date.now() });
}

// Local time stamp YYYYMMDD-HHMMSS for a conflict copy name.
function conflictStamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Keep the version that is about to be replaced as a new file next to the deck.
// Returns true only when the copy is on disk and read back byte-identical.
// Guards (each one protects the "keep both versions" promise):
// - The name comes only from the deck basename, a time stamp and a counter. No
//   deck content goes into a path. Separators and control characters are removed
//   so the name cannot leave the deck folder or confuse the platform.
// - An existing file is never overwritten: a name that stats OK is skipped.
// - Only a "no such path" probe error means "free". Any other probe error
//   gives no answer about the name: stop (fail closed) instead of guessing.
// - The runtime stats and writes THROUGH a symlink, so a dangling symlink
//   at a candidate name stats as "no such path" and the write would create its
//   target, possibly outside the folder. A name is free only if the folder
//   listing ALSO has no entry with that name (any type; a dangling symlink is
//   listed as OTHER). Compared case- and Unicode-normalization-insensitively,
//   as Windows and macOS resolve names. A failed listing: fail closed.
// - "unknown" from verifyWrite is a failure: an unproven copy must not let the
//   caller replace the other version.
// Residual (no exclusive create, no no-follow open in the runtime API): a
// symlink planted between the check and the write is still followed.
async function writeConflictCopy(path, text) {
  if (typeof text !== "string" || byteLen(text) > MAX_DECK_BYTES) return false;
  const p = String(path == null ? "" : path);
  const cut = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (cut <= 0) return false;
  const dir = p.slice(0, cut);
  let stem = baseName(p).replace(/\.(vela|json)$/i, "").replace(/[\/\\\u0000-\u001f\u007f]/g, "");
  stem = capUtf8(stem, CONFLICT_STEM_MAX_BYTES);
  if (!stem) stem = "deck";
  const ts = conflictStamp(new Date());
  const r = await writeConflictCopyAs(dir, stem, ts, text);
  if (r === "ok") return true;
  // The platform can still refuse a long name (a short path limit, a long
  // folder path). Try once more with the short stem "deck". Not after a timeout:
  // the native side does not answer, a second try only queues more calls.
  if (r === "retry" && stem !== "deck") return (await writeConflictCopyAs(dir, "deck", ts, text)) === "ok";
  return false;
}

// Cut a string to at most maxBytes UTF-8 bytes, at a code point boundary.
function capUtf8(str, maxBytes) {
  let out = "", n = 0;
  for (const ch of str) {
    const b = byteLen(ch);
    if (n + b > maxBytes) break;
    out += ch; n += b;
  }
  return out;
}

function nameKey(n) {
  let s = String(n == null ? "" : n);
  try { s = s.normalize("NFC"); } catch {}
  return s.toLowerCase();
}

// One copy attempt with a given stem. Returns "ok", "retry" (a write or verify
// failed, or no free name), or "stop" (no answer from the native side, or a
// probe or listing gave no answer: fail closed).
async function writeConflictCopyAs(dir, stem, ts, text) {
  let names;
  try {
    const list = await withTimeout(Neutralino.filesystem.readDirectory(dir));
    if (!Array.isArray(list)) return "stop";
    names = new Set(list.map((e) => nameKey(e && e.entry)));
  } catch { return "stop"; }
  for (let n = 1; n <= CONFLICT_COPY_MAX; n++) {
    const name = `${stem}.conflict-${ts}${n === 1 ? "" : "-" + n}.vela`;
    if (names.has(nameKey(name))) continue; // an entry (of any type) has this name
    const target = `${dir}/${name}`;
    try {
      await withTimeout(Neutralino.filesystem.getStats(target));
      continue; // the name is taken
    } catch (e) {
      // WHY: only the runtime's "no such path" code proves the name is free
      // (the same rule readForSync uses for "missing"). Any other rejection (a
      // timeout, a guard refusal, an unknown error) gives no answer, and the
      // file may exist. Fail closed: never overwrite a file that may exist.
      if (!e || e.code !== "NE_FS_NOPATHE") return "stop";
    }
    // A call made while the socket is down is queued and sent later, after the
    // name was checked: do not write then.
    if (connDown()) return "stop";
    try {
      await withTimeout(Neutralino.filesystem.writeFile(target, text));
      if ((await verifyWrite(target, byteLen(text), text)) !== "verified") return "retry";
      state.lastCopyPath = target; // read by the "file" retry (see resolveConflictOnce)
      return "ok";
    } catch (e) {
      return e && e.timedOut ? "stop" : "retry";
    }
  }
  return "retry";
}

// Public: the user's answer to a sync conflict. Only "mine" or "file". Returns
// Promise<boolean>: true = the conflict is closed. On false nothing was replaced,
// and deckIO.conflictReason() gives a fixed code for why:
// "stale" (no open conflict on this deck), "offline" (socket down),
// "unreadable" (the file could not be read, or it is not a deck),
// "copy" (the copy could not be written and proven), "app" (the app did not
// take the file version).
function resolveConflict(choice) {
  if (choice !== "mine" && choice !== "file") return Promise.resolve(false);
  const run = state.flushChain.then(() => resolveConflictOnce(choice));
  state.flushChain = run.catch(() => {});
  return run.catch(() => false);
}

async function resolveConflictOnce(choice) {
  const path = state.currentPath;
  const fail = (reason) => { state.conflictReason = reason; return false; };
  // The same conflict must still be open, on the open deck, with a live socket.
  const open = () => state.paused && !!state.conflict && state.conflict.path === path &&
    path === state.currentPath && !state.switching;
  const live = () => open() && !connDown();
  if (!path || !open()) return fail("stale");
  if (!live()) return fail("offline");
  // Re-read now: the file can have changed again since the conflict opened.
  const disk = await readForSync(path);
  if (!open()) return fail("stale");
  if (!live()) return fail("offline");

  if (choice === "mine") {
    // A missing file has nothing to keep. Any other failed read: we cannot copy
    // what we cannot read, so we must not replace it.
    if (!disk.ok && disk.reason !== "missing") return fail("unreadable");
    if (disk.ok) {
      // Copy only a real deck. The deck path can be a symlink to a file
      // that is not a deck; its bytes must never be copied into the folder.
      if (!parseDeckObject(disk.text)) return fail("unreadable");
      if (!(await writeConflictCopy(path, disk.text))) return fail("copy");
      // The file version is safe in the copy. From here the conflict IS
      // resolved: never return false (the dialog would show "nothing was
      // replaced", which is not true any more, and could not close).
      // The copied version is now the accepted baseline: a later resync that
      // finds it still on disk (our write failed or waits for the socket) must
      // write pending, not raise this conflict again.
      state.lastWrittenSig = sigOf(disk.text);
      state.lastWrittenText = disk.text;
    }
    state.paused = false;
    state.conflict = null;
    state.conflictReason = null;
    clearSyncBlock();
    // Write the app's version. A failed write keeps pending and the status says
    // "failed" (the pill offers Retry); a socket that dropped holds it.
    if (pendingFor(path)) await flushSaveOnce(); // already on the chain: call the run body directly
    if (!repairHeld() && state.strays.some((s) => s.path === path && s.landed)) await repairAfterStray(path);
    return true;
  }

  // "file": load the disk version. It must be a readable, valid deck.
  if (!disk.ok) return fail("unreadable");
  const deck = parseDeckObject(disk.text);
  if (!deck) return fail("unreadable");
  const pend = pendingFor(path) ? state.pendingDeck : null;
  if (pend) {
    let copyText;
    try { copyText = JSON.stringify(pend, null, 2); } catch { return fail("copy"); }
    // WHY: a retry after a later step failed (for example the app did not
    // take the file version) must not write a second copy of the same edit.
    // Reuse the copy that this open conflict already wrote and verified for
    // this exact text; a different (newer) edit gets its own copy.
    // Reuse only after reading the copy back: the user (or a sync client) can
    // delete or change it between two retries, and then the edit would be
    // dropped with no copy on disk.
    const conflict = state.conflict;
    const reuse = conflict.copiedText === copyText && conflict.copiedPath &&
      (await verifyWrite(conflict.copiedPath, byteLen(copyText), copyText)) === "verified";
    if (!reuse) {
      state.lastCopyPath = null;
      if (!(await writeConflictCopy(path, copyText))) return fail("copy");
      conflict.copiedText = copyText;
      conflict.copiedPath = state.lastCopyPath;
    }
    // A newer edit arrived during the copy: it is not in the copy, so dropping
    // it now would lose it. Stop; the user can choose again.
    if (!live() || (pendingFor(path) ? state.pendingDeck : null) !== pend) return fail("stale");
  }
  // The app's version is safe in the copy. Load the file version (adoptExternal drops the
  // pending deck, the confirmed bytes and the strays of this path).
  if (!adoptExternal(path, disk.text, deck)) return fail("app");
  state.paused = false;
  state.conflict = null;
  state.conflictReason = null;
  clearSyncBlock();
  emitStatus({ state: "saved", path, at: Date.now() });
  return true;
}

// Connect deck-io to the native connection state (nl-boot, before the deck opens).
// Without this call deck-io behaves exactly as before (no gate, no resync).
function attachConnection(c) {
  if (!c || typeof c.state !== "function" || typeof c.epoch !== "function") return;
  state.conn = c;
  state.lastEpoch = c.epoch();
  if (typeof c.onChange === "function") c.onChange((ev) => onConnChange(ev));
}

function onConnChange(ev) {
  const st = ev && ev.state;
  const ep = ev && typeof ev.epoch === "number" ? ev.epoch : 0;
  if (st === "connected") {
    // A larger epoch after a first open = a reconnect: events were lost while the
    // socket was down, so compare with the disk (resync also writes pending).
    // The first open only releases a save held by the gate.
    if (ep > state.lastEpoch && state.lastEpoch > 0) resync();
    else if (state.pendingDeck) flushSave().catch(() => {});
    state.lastEpoch = Math.max(state.lastEpoch, ep);
  } else if (state.pendingDeck && !state.paused) {
    // Show the held save honestly. A conflict keeps its own "failed" status.
    emitStatus({ state: st === "closed" ? "failed" : "reconnecting", path: state.pendingPath, at: Date.now() });
  }
}

export const deckIO = {
  async init() {
    let folder = await getStoredFolder();
    if (!folder) folder = await pickFolder();
    state.folder = folder;
    return folder;
  },
  async initWithFile(filePath) {
    // Derive folder from file path and store it so the picker works. The user
    // explicitly opened this file (double-click / file association / CLI arg),
    // so its containing folder is the trust root — register it with fsGuard
    // exactly as pickFolder() does for a dialog choice. Without this every
    // subsequent guarded op (getStats, openDeck/readFile, listDecks, the
    // watcher) is blocked because fsGuard.install() ran with an empty root
    // list. underRoot() still rejects any ".." traversal, so the blast radius
    // stays this one folder.
    const folder = filePath.replace(/\\/g, "/").replace(/\/[^/]+$/, "");
    fsGuard.allow(folder);
    state.folder = folder;
    await Neutralino.storage.setData(FOLDER_KEY, folder);
  },
  async reselectFolder() {
    refuseIfHeld(); // before any state changes
    if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
    state.pendingDeck = null;
    state.pendingPath = null;
    settleWaiter(undefined, false); // the dropped save was not written
    // The conflict belonged to a deck in the old folder.
    clearConflictForSwitch();
    await stopWatcher();
    state.folder = await pickFolder();
    state.currentPath = null;
  },
  listDecks,
  openDeck,
  saveCurrent,
  // Create a brand-new deck file in the current folder and switch to it, so a
  // "New deck" never overwrites the deck the user currently has open (CR). The
  // caller (React app) then pushes the blank deck, whose autosave lands on this
  // fresh path. Returns the new path, or null if no folder / write failed.
  async newDeck(title) {
    if (!state.folder) return null;
    // A held save is not dropped. null is this function's failure result:
    // the app then keeps the current deck and tells the user.
    try { refuseIfHeld(); } catch { return null; }
    // Cancel any pending save for the OLD deck before switching currentPath.
    if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
    state.pendingDeck = null;
    state.pendingPath = null;
    settleWaiter(undefined, false); // the dropped save was not written
    // The conflict belonged to the old deck; its pending edit is dropped above.
    clearConflictForSwitch();
    // Build a unique "<slug>.vela" (then -2, -3, …) that doesn't collide. Slice
    // BEFORE the final trailing-separator strip so a truncated name can't end in
    // a stray "-"/"." right before the extension.
    const slug = String(title || "Untitled").normalize("NFKD").replace(/[^\w\s.-]/g, "").replace(/\s+/g, "-").replace(/-{2,}/g, "-").slice(0, 60).replace(/^[-.]+|[-.]+$/g, "") || "Untitled";
    // The name check needs a real listing. A failed or unanswered listing must not
    // read as "empty folder": the write below would then replace an existing deck.
    let existing;
    try { existing = (await withTimeout(listDecks())).map((d) => d.name.toLowerCase()); }
    catch (e) { console.warn("[deck-io] newDeck: folder list failed"); return null; }
    let name = `${slug}.vela`, n = 1;
    while (existing.includes(name.toLowerCase())) { n++; name = `${slug}-${n}.vela`; }
    const path = `${state.folder}/${name}`;
    state.switching = true;
    try {
      await stopWatcher();
      // Write a minimal valid deck so the file exists on disk immediately.
      const text = JSON.stringify({ deckTitle: title || "Untitled", lanes: [] }, null, 2);
      await withTimeout(Neutralino.filesystem.writeFile(path, text));
      state.lastWriteAt = Date.now();
      state.currentPath = path;
      // Sync baseline = the bytes just written (same reason as in openDeck).
      state.lastWrittenSig = sigOf(text);
      state.lastWrittenText = text;
      rememberLastDeck(path);
      startWatcher();
      return path;
    } catch (e) {
      console.warn("[deck-io] newDeck failed:", e);
      // Write failed: currentPath still points at the OLD deck. Restart its
      // watcher (we stopped it above) so external sync keeps working, and return
      // null so the caller aborts instead of letting a blank deck later autosave
      // over the OLD file. (BUG fix: data-loss on failed new-deck allocation.)
      if (state.currentPath) { try { startWatcher(); } catch {} }
      return null;
    } finally {
      state.switching = false;
    }
  },
  async lastDeckPath() {
    try {
      const keys = await Neutralino.storage.getKeys();
      if (!keys.includes(LAST_DECK_KEY)) return null;
      return await Neutralino.storage.getData(LAST_DECK_KEY);
    } catch { return null; }
  },
  currentPath() { return state.currentPath; },
  onDeckLoaded(cb) { state.onDeckLoaded = cb; },
  // Subscribe to save-status transitions {state:"saving"|"saved"|"unverified"|
  // "failed"|"reconnecting", at, name}. Consumed by nl-boot → the app's pill.
  // Deliberately no absolute path and no raw error — see emitStatus.
  onSaveStatus(cb) { state.onStatus = cb; },
  saveStatus() { return state.saveStatus; },
  // Bypass the debounce and immediately re-attempt the pending write (Retry).
  // Wrapped, not aliased, so no argument can ever reach flushSave through it.
  flushNow() { return flushNow(); },
  folder() { return state.folder; },
  // Native connection view from nl-boot: {state, epoch, onChange, suspect}.
  attachConnection(c) { attachConnection(c); },
  // Re-check the disk after a reconnect or a wake. Wrapped: no argument reaches it.
  resync() { return resync(); },
  // The app is mounted and can take external loads (nl-boot, after loadVela).
  // No arguments: an operation. Runs a resync that was asked for before.
  setAppReady() {
    state.appReady = true;
    if (state.resyncWanted) { state.resyncWanted = false; resync(); }
  },
  // Sync conflict: cb(basename) opens the dialog; resolveConflict("mine"|"file").
  onConflict(cb) { state.onConflict = cb; },
  // cb() closes the dialog: a deck switch cleared the conflict.
  onConflictCleared(cb) { state.onConflictCleared = cb; },
  resolveConflict(choice) { return resolveConflict(choice); },
  // Fixed code of the last failed conflict choice, or null (see resolveConflict).
  conflictReason() { return state.conflictReason; },
};
