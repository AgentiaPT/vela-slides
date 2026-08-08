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
// folder, so the read must be bounded BEFORE it happens. Same 5 MB order as the
// deck-save payload cap in the dev preview server (serve.py).
const MAX_DECK_BYTES = 5 * 1024 * 1024;
// Backoff between write attempts. A Windows write can transiently reject under
// AV real-time scanning, a synced folder (OneDrive/Dropbox), or a briefly-held
// file handle. 3 attempts total: the initial write + these two delays.
const SAVE_RETRY_DELAYS = [400, 1500];

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
};

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
  try { st = await Neutralino.filesystem.getStats(path); } catch { return "unknown"; }
  if (!st || typeof st.size !== "number") return "unknown";
  if (st.size !== expectedBytes) return "mismatch";
  let text;
  try { text = await readDeckText(path); } catch { return "unknown"; }
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

async function readDeck(path) {
  return JSON.parse(await readDeckText(path));
}

async function openDeck(path) {
  // Cancel any pending save from the previous deck BEFORE changing
  // currentPath — otherwise flushSave() writes old data to the new file.
  if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
  state.pendingDeck = null;
  state.pendingPath = null;
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
    const deck = await readDeck(path);
    state.currentPath = path;
    await Neutralino.storage.setData(LAST_DECK_KEY, path);
    if (state.onDeckLoaded) state.onDeckLoaded(deck, path);
    startWatcher();
    return deck;
  } finally {
    state.switching = false;
  }
}

function saveCurrent(deckObject) {
  if (!state.currentPath || state.switching) return;
  state.pendingDeck = deckObject;
  // Capture path NOW — flushSave must write to the file that was active
  // when the save was requested, not whatever currentPath points to later
  // (it may have changed due to a deck switch during the debounce window).
  state.pendingPath = state.currentPath;
  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
}

async function flushSave() {
  const deck = state.pendingDeck;
  const path = state.pendingPath;
  if (!deck || !path) return;
  // Do NOT clear pendingDeck/pendingPath up front — keep the payload so a failed
  // write is never lost. It is cleared only after a CONFIRMED successful write,
  // and only if a newer edit hasn't superseded it in the meantime. This is the
  // core "keep-pending-on-failure" guarantee behind the Retry affordance.
  const json = JSON.stringify(deck, null, 2);
  const bytes = byteLen(json);
  const sig = sigOf(json);
  emitStatus({ state: "saving", path, at: Date.now() });

  const attempts = SAVE_RETRY_DELAYS.length + 1;
  let lastErr = null, conn = false;
  for (let i = 0; i < attempts; i++) {
    // A deck switch (openDeck/newDeck) moved the target — a fresher flush owns
    // the new path; abandon this stale write rather than clobbering it.
    if (state.pendingPath && state.pendingPath !== path) return;
    try {
      state.lastWriteAt = Date.now();
      await Neutralino.filesystem.writeFile(path, json);
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
      if (state.pendingDeck === deck) { state.pendingDeck = null; state.pendingPath = null; }
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
      if (isConnError(e)) {
        conn = true;
        // Liveness probe: if the folder still stats OK the socket is alive and
        // this was a one-off; otherwise stay in a "reconnecting" posture.
        console.warn("[deck-io] save connection error:", path, e);
        emitStatus({ state: "reconnecting", path, at: Date.now() });
        try { await Neutralino.filesystem.getStats(state.folder); conn = false; } catch {}
      }
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, SAVE_RETRY_DELAYS[i]));
    }
  }
  // Final failure — KEEP pendingDeck/pendingPath so the next autosave or a
  // manual __velaForceSave re-attempts the newest content. Never swallow: the
  // status is emitted so the UI can show it, in addition to the console log.
  // The raw error and the absolute path stay here (console); the renderer gets
  // only the state + basename.
  console.error("[deck-io] save failed:", path, lastErr);
  emitStatus({ state: conn ? "reconnecting" : "failed", path, at: Date.now() });
}

// Bypass the debounce and immediately re-attempt the pending write. Wired to
// window.__velaForceSave for the save-status pill's "Retry" affordance. If the
// last save failed, pendingDeck still holds the newest deck, so this flushes it.
// Takes NO arguments, deliberately: it is an operation ("re-save what is pending"),
// not a capability the renderer can aim at a path or payload of its choosing. Any
// argument passed by a caller is ignored.
async function flushNow() {
  if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
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

async function stopWatcher() {
  if (state.watcherId == null) return;
  try {
    await Neutralino.filesystem.removeWatcher(state.watcherId);
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
  (async () => {
    // 2) Bound the read BEFORE it happens. The watcher fires for whatever landed
    //    in the folder; an arbitrarily large file must not be pulled into memory
    //    and JSON.parsed. Oversized → warn and skip, never silently.
    let size = null;
    try {
      const st = await Neutralino.filesystem.getStats(path);
      if (st && typeof st.size === "number") size = st.size;
    } catch { /* no size available — fall through to the read */ }
    if (size != null && size > MAX_DECK_BYTES) {
      console.warn(`[deck-io] ignoring external change: ${size} bytes exceeds the ${MAX_DECK_BYTES}-byte deck limit`, path);
      return;
    }
    // 3) Now read, through the single audited entry point.
    const text = await readDeckText(path);
    // Echo suppression, definitive and timing-independent: the signature narrows
    // the compare cheaply, the exact-text compare confirms it. The signature is a
    // short digest, so two different documents can share one — on its own it could
    // drop a genuine external edit as "our own echo" (silent app/disk divergence).
    if (state.lastWrittenSig && sigOf(text) === state.lastWrittenSig && text === state.lastWrittenText) return;
    const deck = JSON.parse(text);
    // D5/CR3: adopt the just-loaded external content as the new echo baseline.
    // Without this the baseline only ever tracks OUR writes, so a later external
    // revert to a byte-exact previously-Vela-written state would match the stale
    // baseline and be wrongly dropped as "our own echo" (app/disk divergence).
    state.lastWrittenSig = sigOf(text);
    state.lastWrittenText = text;
    if (state.onDeckLoaded) state.onDeckLoaded(deck, path, { external: true });
  })().catch((e) => console.warn("[deck-io] external reload failed:", e));
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
    if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
    state.pendingDeck = null;
    state.pendingPath = null;
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
    // Cancel any pending save for the OLD deck before switching currentPath.
    if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
    state.pendingDeck = null;
    state.pendingPath = null;
    // Build a unique "<slug>.vela" (then -2, -3, …) that doesn't collide. Slice
    // BEFORE the final trailing-separator strip so a truncated name can't end in
    // a stray "-"/"." right before the extension.
    const slug = String(title || "Untitled").normalize("NFKD").replace(/[^\w\s.-]/g, "").replace(/\s+/g, "-").replace(/-{2,}/g, "-").slice(0, 60).replace(/^[-.]+|[-.]+$/g, "") || "Untitled";
    let existing = [];
    try { existing = (await listDecks()).map((d) => d.name.toLowerCase()); } catch {}
    let name = `${slug}.vela`, n = 1;
    while (existing.includes(name.toLowerCase())) { n++; name = `${slug}-${n}.vela`; }
    const path = `${state.folder}/${name}`;
    state.switching = true;
    try {
      await stopWatcher();
      // Write a minimal valid deck so the file exists on disk immediately.
      await Neutralino.filesystem.writeFile(path, JSON.stringify({ deckTitle: title || "Untitled", lanes: [] }, null, 2));
      state.lastWriteAt = Date.now();
      state.currentPath = path;
      await Neutralino.storage.setData(LAST_DECK_KEY, path);
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
};
