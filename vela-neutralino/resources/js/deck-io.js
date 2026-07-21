// Folder-based deck I/O for the Neutralino shell.
//
// Picks a folder on first launch, lists .vela/.json files, loads one into the
// running Vela instance, and mirrors in-app edits back to disk. External-editor
// sync (VS Code, Claude Code on the side) rides the broker's folder watcher.
//
// The page has NO filesystem authority: every operation below is a semantic
// request to the filesystem broker (fs-bridge.js → extensions/fs), which is the
// only process that touches disk. The broker validates the chosen folder, scopes
// every read/write to a safe basename inside it, and enforces the .vela/.json
// write allowlist. This module keeps the SAME UX (browse/switch/new/watch,
// debounced save, switch-guard, watcher-echo suppression) on top of that broker.
//
// Exposed surface (consumed by nl-boot.js):
//   deckIO.init()                     → resolves after folder is chosen
//   deckIO.listDecks()                → [{ name, path }]
//   deckIO.openDeck(path)             → loads into Vela, starts watcher
//   deckIO.saveCurrent(deckObject)    → debounced write to disk
//   deckIO.currentPath()              → string | null
//
// `path` here is a synthetic "<folder>/<name>" string kept for the picker/trust
// UX; only the basename is ever sent to the broker.

import { fsBridge } from "./fs-bridge.js";

const FOLDER_KEY = "nl-deck-folder";
const LAST_DECK_KEY = "nl-last-deck";
const SAVE_DEBOUNCE_MS = 200;

const state = {
  folder: null,
  currentPath: null,
  saveTimer: null,
  pendingDeck: null,
  pendingPath: null,  // path captured at saveCurrent time, not flush time
  switching: false,   // true while openDeck/reselectFolder is in flight
  onDeckLoaded: null, // set by nl-boot
  watchStarted: false,
};

function baseName(p) {
  return String(p == null ? "" : p).replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop();
}

async function getStoredFolder() {
  try {
    const keys = await Neutralino.storage.getKeys();
    if (!keys.includes(FOLDER_KEY)) return null;
    const val = await Neutralino.storage.getData(FOLDER_KEY);
    if (!val) return null;
    // The broker validates (existence + root safety); a moved/deleted folder or
    // an unsafe root throws and we fall back to the picker.
    try { await fsBridge.setFolder(val); return val; }
    catch { return null; }
  } catch { return null; }
}

async function pickFolder() {
  const path = await Neutralino.os.showFolderDialog("Choose your Vela decks folder");
  if (!path) throw new Error("no folder selected");
  // os.showFolderDialog only returns a string — no FS access. The broker decides
  // whether to trust it (existence + root-safety predicates) before adopting it.
  await fsBridge.setFolder(path);
  await Neutralino.storage.setData(FOLDER_KEY, path);
  return path;
}

async function listDecks() {
  if (!state.folder) return [];
  const decks = await fsBridge.listDecks();
  return decks
    .map((d) => ({ name: d.name, path: `${state.folder}/${d.name}` }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function readDeck(path) {
  const text = await fsBridge.readDeck(baseName(path));
  return JSON.parse(text);
}

function ensureWatch() {
  if (state.watchStarted) return;
  state.watchStarted = true;
  fsBridge.startWatch((name) => {
    // Broker reports an external change to the current deck (echo-suppressed on
    // its side). Reload and push into the running app.
    if (!state.currentPath || state.switching) return;
    if (baseName(state.currentPath) !== name) return;
    readDeck(state.currentPath)
      .then((deck) => { if (state.onDeckLoaded) state.onDeckLoaded(deck, state.currentPath, { external: true }); })
      .catch((e) => console.warn("[deck-io] external reload failed:", e));
  });
}

async function openDeck(path) {
  // Cancel any pending save from the previous deck BEFORE changing currentPath —
  // otherwise flushSave() writes old data to the new file.
  if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
  state.pendingDeck = null;
  state.pendingPath = null;
  // Reject saves for the duration of the switch (see prior data-loss note): the
  // React app still holds the PREVIOUS deck and its debounced autosave can fire
  // during the awaits below, after currentPath has advanced.
  state.switching = true;
  try {
    const deck = await readDeck(path);
    state.currentPath = path;
    await fsBridge.setWatchTarget(baseName(path));
    await Neutralino.storage.setData(LAST_DECK_KEY, path);
    if (state.onDeckLoaded) state.onDeckLoaded(deck, path);
    ensureWatch();
    return deck;
  } finally {
    state.switching = false;
  }
}

function saveCurrent(deckObject) {
  if (!state.currentPath || state.switching) return;
  state.pendingDeck = deckObject;
  // Capture path NOW — flushSave must write to the file active when the save was
  // requested, not whatever currentPath points to later (deck switch races).
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
    const json = JSON.stringify(deck, null, 2);
    await fsBridge.saveDeck(baseName(path), json);
  } catch (e) {
    console.error("[deck-io] save failed:", e);
  }
}

export const deckIO = {
  async init() {
    let folder = await getStoredFolder();
    if (!folder) folder = await pickFolder();
    state.folder = folder;
    ensureWatch();
    return folder;
  },
  async initWithFile(filePath) {
    // Derive the folder from the file the user explicitly opened (double-click /
    // file association / CLI arg) and adopt it as the trust root via the broker,
    // exactly as a folder-dialog pick would. The broker still rejects any unsafe
    // root and scopes every later op to a basename inside this folder.
    const folder = filePath.replace(/\\/g, "/").replace(/\/[^/]+$/, "");
    await fsBridge.setFolder(folder);
    state.folder = folder;
    await Neutralino.storage.setData(FOLDER_KEY, folder);
    ensureWatch();
  },
  async reselectFolder() {
    if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
    state.pendingDeck = null;
    state.pendingPath = null;
    state.folder = await pickFolder();
    state.currentPath = null;
  },
  listDecks,
  openDeck,
  saveCurrent,
  // Create a brand-new deck file in the current folder and switch to it, so a
  // "New deck" never overwrites the deck the user currently has open. The broker
  // does the slug/dedupe and creates the file; we adopt the returned name.
  async newDeck(title) {
    if (!state.folder) return null;
    if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
    state.pendingDeck = null;
    state.pendingPath = null;
    state.switching = true;
    try {
      const name = await fsBridge.newDeck(title);
      if (!name) return null;
      const path = `${state.folder}/${name}`;
      state.currentPath = path;
      await fsBridge.setWatchTarget(name);
      await Neutralino.storage.setData(LAST_DECK_KEY, path);
      ensureWatch();
      return path;
    } catch (e) {
      console.warn("[deck-io] newDeck failed:", e);
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
  folder() { return state.folder; },
};
