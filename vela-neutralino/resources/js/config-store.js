// Machine-global Vela config at ~/.vela/config.json.
//
// Stores:
//   • agent                — selected CLI backend id (e.g. "claude-code").
//   • firstLaunchSeen      — true once the one-time AI intro has been shown.
//   • recentFolders        — MRU list of deck-folder paths.
//
// Per-deck trust lives in <deck-folder>/.vela/trust.json (see trust.js).
// Keeping that split means switching folders doesn't forget your agent pick,
// and folder-local trust doesn't grow a global index.
//
// Exposed as window.__velaConfig after boot (see nl-boot.js).

const CONFIG_VERSION = 1;
const EMPTY = { _v: CONFIG_VERSION, agent: null, firstLaunchSeen: false, recentFolders: [] };

async function homeDir() {
  // HOME on linux/mac, USERPROFILE on windows. Neutralino passes through
  // whatever the OS exposes; we accept either.
  const home =
    (await Neutralino.os.getEnv("HOME")) ||
    (await Neutralino.os.getEnv("USERPROFILE"));
  if (!home) throw new Error("cannot locate user home directory");
  return home.replace(/[\\/]+$/, "");
}

async function configPath() {
  return `${await homeDir()}/.vela/config.json`;
}

async function ensureDir(path) {
  try {
    await Neutralino.filesystem.getStats(path);
  } catch {
    try { await Neutralino.filesystem.createDirectory(path); } catch {}
  }
}

async function readConfig() {
  try {
    const p = await configPath();
    const txt = await Neutralino.filesystem.readFile(p);
    const parsed = JSON.parse(txt);
    // Forward-compatible merge — unknown keys pass through, missing keys
    // get defaults. Corrupt file → treat as empty (fail-open; the user can
    // re-grant trust, not silently lock them out).
    return Object.assign({}, EMPTY, parsed, { _v: CONFIG_VERSION });
  } catch {
    return { ...EMPTY };
  }
}

async function writeConfig(obj) {
  const home = await homeDir();
  await ensureDir(`${home}/.vela`);
  const p = `${home}/.vela/config.json`;
  const tmp = `${p}.tmp`;
  const json = JSON.stringify({ ...obj, _v: CONFIG_VERSION }, null, 2);
  // Atomic swap: write tmp, rename over target. A crash mid-write leaves
  // either the old config intact or the new one fully committed — never
  // truncated JSON.
  await Neutralino.filesystem.writeFile(tmp, json);
  try {
    await Neutralino.filesystem.move(tmp, p);
  } catch {
    // Fallback: some filesystems reject rename-over-existing. Retry as a
    // two-step remove-then-write. Small window of truncation on crash, but
    // better than losing the new value.
    try { await Neutralino.filesystem.remove(p); } catch {}
    await Neutralino.filesystem.writeFile(p, json);
    try { await Neutralino.filesystem.remove(tmp); } catch {}
  }
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
  async path() { return configPath(); },
};
