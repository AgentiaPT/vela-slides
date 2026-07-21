// Machine-global Vela config at ~/.vela/config.json.
//
// Stores:
//   • agent                — selected CLI backend id (e.g. "claude-code").
//   • firstLaunchSeen      — true once the one-time AI intro has been shown.
//   • recentFolders        — MRU list of deck-folder paths.
//
// Per-deck trust lives in <deck-folder>/.vela/trust.json (see trust.js).
//
// The page has NO filesystem authority. This module keeps the forward-compatible
// merge / version / cache logic in JS but persists through the filesystem broker
// (fs-bridge.js → extensions/fs), which owns the ~/.vela path (derived by the
// broker from $HOME — never from the page) and writes it atomically in Go.
//
// Exposed as window.__velaConfig after boot (see nl-boot.js).

import { fsBridge } from "./fs-bridge.js";

const CONFIG_VERSION = 1;
const EMPTY = { _v: CONFIG_VERSION, agent: null, firstLaunchSeen: false, recentFolders: [] };

async function readConfig() {
  try {
    const txt = await fsBridge.readConfig();
    if (!txt) return { ...EMPTY };
    const parsed = JSON.parse(txt);
    // Forward-compatible merge — unknown keys pass through, missing keys get
    // defaults. Corrupt file → treat as empty (fail-open; the user can re-grant
    // trust, not silently lock them out).
    return Object.assign({}, EMPTY, parsed, { _v: CONFIG_VERSION });
  } catch {
    return { ...EMPTY };
  }
}

async function writeConfig(obj) {
  const json = JSON.stringify({ ...obj, _v: CONFIG_VERSION }, null, 2);
  await fsBridge.writeConfig(json);
}

let cache = null;
async function get() {
  if (cache == null) cache = await readConfig();
  return cache;
}

async function patch(delta) {
  const cur = await get();
  cache = { ...cur, ...delta };
  await writeConfig(cache);
  return cache;
}

export const configStore = {
  get,
  patch,
  async getAgent() { return (await get()).agent; },
  async setAgent(id) { await patch({ agent: id }); },
  async hasSeenIntro() { return !!(await get()).firstLaunchSeen; },
  async markIntroSeen() { await patch({ firstLaunchSeen: true }); },
  async recordRecentFolder(folder) {
    if (!folder) return;
    const cur = await get();
    const list = [folder, ...(cur.recentFolders || []).filter((f) => f !== folder)].slice(0, 10);
    await patch({ recentFolders: list });
  },
  path() { return "~/.vela/config.json"; },
};
