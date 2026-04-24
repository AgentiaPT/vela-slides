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
  onDeckLoaded: null, // set by nl-boot
};

async function getStoredFolder() {
  try {
    const keys = await Neutralino.storage.getKeys();
    if (!keys.includes(FOLDER_KEY)) return null;
    const val = await Neutralino.storage.getData(FOLDER_KEY);
    if (!val) return null;
    // Verify it still exists — user might have moved or deleted it.
    try { await Neutralino.filesystem.getStats(val); return val; }
    catch { return null; }
  } catch { return null; }
}

async function pickFolder() {
  const path = await Neutralino.os.showFolderDialog("Choose your Vela decks folder");
  if (!path) throw new Error("no folder selected");
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
  await stopWatcher();
  const deck = await readDeck(path);
  state.currentPath = path;
  await Neutralino.storage.setData(LAST_DECK_KEY, path);
  if (state.onDeckLoaded) state.onDeckLoaded(deck, path);
  startWatcher();
  return deck;
}

function saveCurrent(deckObject) {
  if (!state.currentPath) return;
  state.pendingDeck = deckObject;
  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
}

async function flushSave() {
  const deck = state.pendingDeck;
  const path = state.currentPath;
  if (!deck || !path) return;
  state.pendingDeck = null;
  try {
    state.lastWriteAt = Date.now();
    const json = JSON.stringify(deck, null, 2);
    await Neutralino.filesystem.writeFile(path, json);
  } catch (e) {
    console.error("[deck-io] save failed:", e);
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
  async reselectFolder() {
    await stopWatcher();
    state.folder = await pickFolder();
    state.currentPath = null;
  },
  listDecks,
  openDeck,
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
