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
const WATCHER_IGNORE_MS = 400;

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
};

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

async function readDeck(path) {
  const text = await Neutralino.filesystem.readFile(path);
  return JSON.parse(text);
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
  state.pendingDeck = null;
  state.pendingPath = null;
  try {
    state.lastWriteAt = Date.now();
    const json = JSON.stringify(deck, null, 2);
    await Neutralino.filesystem.writeFile(path, json);
  } catch (e) {
    console.error("[deck-io] save failed:", e);
  }
}

// Derive a filesystem-safe base name from a deck title. Falls back to
// "untitled" so we never produce an empty or dot-only filename.
function slugify(title) {
  const base = String(title == null ? "" : title)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "untitled";
}

// Minimal, schema-valid starter deck (deckTitle + one lane/item/slide with the
// required `blocks` and `duration` keys). Mirrors the structure documented in
// CLAUDE.md so the running app can load it without complaint.
function newDeckObject(title) {
  const t = (title && String(title).trim()) || "Untitled Deck";
  return {
    deckTitle: t,
    lanes: [
      {
        title: "Section 1",
        items: [
          {
            title: "Module 1",
            status: "todo",
            slides: [
              {
                bg: "#0f172a",
                color: "#e2e8f0",
                accent: "#3b82f6",
                duration: 60,
                blocks: [{ type: "heading", text: t }],
              },
            ],
          },
        ],
      },
    ],
  };
}

// Create a brand-new deck file WITHOUT touching the currently-open one.
//
// Today "new deck" only reset in-memory state, so the next debounced autosave
// (saveCurrent → flushSave) overwrote the file we had open. Here we allocate a
// fresh, non-colliding `.vela` file in `folder` (default: the folder of the
// current deck), write a starter deck to it, and retarget currentPath to it so
// every subsequent autosave lands on the NEW file. The previously-open file is
// left byte-for-byte untouched.
//
// Path safety: the target folder is derived from currentPath()/state.folder,
// both already-allowed fsGuard roots — we do NOT register any new root, so the
// guard is not weakened. The final write still passes through the fsGuard
// wrapper (which rejects "..") like every other write in this module.
async function createDeck(folder, title) {
  const dir = norm(
    folder ||
      (state.currentPath
        ? state.currentPath.replace(/\/[^/]+$/, "")
        : state.folder)
  );
  if (!dir) throw new Error("no target folder for the new deck");

  // Find a filename that does not collide with an existing entry (case-
  // insensitive — the decks folder may live on a case-insensitive volume).
  const entries = await Neutralino.filesystem.readDirectory(dir);
  const taken = new Set(
    entries.filter((e) => e.type === "FILE").map((e) => e.entry.toLowerCase())
  );
  const slug = slugify(title);
  let name = `${slug}.vela`;
  for (let i = 2; taken.has(name.toLowerCase()); i++) {
    name = `${slug}-${i}.vela`;
  }
  const path = `${dir}/${name}`;
  const deck = newDeckObject(title);

  // Cooperate with the deck-switch guard exactly like openDeck(): cancel any
  // pending stale-deck save BEFORE retargeting currentPath, and reject saves
  // for the duration of the switch so a debounced autosave holding the OLD
  // deck can't capture the NEW path mid-flight and clobber the fresh file.
  if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
  state.pendingDeck = null;
  state.pendingPath = null;
  state.switching = true;
  try {
    await stopWatcher();
    // Tag as our own write so the watcher's echo-suppression skips it.
    state.lastWriteAt = Date.now();
    await Neutralino.filesystem.writeFile(path, JSON.stringify(deck, null, 2));
    state.currentPath = path;
    await Neutralino.storage.setData(LAST_DECK_KEY, path);
    if (state.onDeckLoaded) state.onDeckLoaded(deck, path);
    startWatcher();
    return { path, deck };
  } finally {
    state.switching = false;
  }
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
  if (Date.now() - state.lastWriteAt < WATCHER_IGNORE_MS) return;
  if (payload.action !== "modified" && payload.action !== "add" && payload.action !== "moved") return;
  readDeck(state.currentPath)
    .then((deck) => { if (state.onDeckLoaded) state.onDeckLoaded(deck, state.currentPath, { external: true }); })
    .catch((e) => console.warn("[deck-io] external reload failed:", e));
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
  createDeck,
  saveCurrent,
  async lastDeckPath() {
    try {
      const keys = await Neutralino.storage.getKeys();
      if (!keys.includes(LAST_DECK_KEY)) return null;
      return await Neutralino.storage.getData(LAST_DECK_KEY);
    } catch { return null; }
  },
  currentPath() { return state.currentPath; },
  onDeckLoaded(cb) { state.onDeckLoaded = cb; },
  folder() { return state.folder; },
};
