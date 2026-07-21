// Page-side client for the Vela filesystem broker (extensions/fs).
//
// The webview page holds NO ambient filesystem authority: `filesystem.*` is
// absent from neutralino.config.json's nativeAllowList. Every file operation is
// a narrow, semantic request to the broker over loopback HTTP, authenticated by
// a per-launch token. The page can only *request* pre-enumerated operations on a
// validated basename inside a validated folder; it can never hold or widen the
// trust policy, and it can never name an arbitrary path. This is the Electron
// contextIsolation/contextBridge model — the broker is the sole FS holder.
//
// BOOTSTRAP WITHOUT FILESYSTEM
// Because the page cannot read files, it cannot read the broker's handshake.
// Instead the broker pushes its {port, token} to the page via a Neutralino
// extension→app event (`velaFsReady`, app.broadcast), which the page receives
// through Neutralino.events.on — no filesystem, and no app→extension messaging
// capability (extensions.dispatch/broadcast stay out of the allowlist). The
// broker re-broadcasts on an interval, so the listener installed here catches
// the announcement whenever the page becomes ready.

let handshake = null;              // { port, token } once the broker announces
let resolveReady = null;
const readyPromise = new Promise((r) => { resolveReady = r; });
let listenerInstalled = false;

// Install the event listener that receives the broker's {port, token}. Called
// once, early in boot (after Neutralino.init()).
function install() {
  if (listenerInstalled) return;
  listenerInstalled = true;
  try {
    Neutralino.events.on("velaFsReady", (e) => {
      const d = (e && e.detail) || {};
      if (d.port && d.token) {
        handshake = { port: String(d.port), token: String(d.token) };
        if (resolveReady) { resolveReady(handshake); resolveReady = null; }
      }
    });
  } catch (err) {
    console.error("[fs-bridge] cannot subscribe to velaFsReady:", err);
  }
}

// Resolve once the broker has announced itself (or reject after a budget). The
// broker re-broadcasts every second, so a slow first launch self-heals.
function ready(timeoutMs = 45000) {
  if (handshake) return Promise.resolve(handshake);
  return Promise.race([
    readyPromise,
    new Promise((_, rej) => setTimeout(() => rej(new Error("filesystem broker unavailable")), timeoutMs)),
  ]);
}

async function call(pathname, body, timeoutMs = 20000) {
  const hs = await ready();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // host literal "localhost" — the desktop CSP allows http://localhost:* and
    // it resolves to the loopback the broker binds (127.0.0.1).
    const r = await fetch(`http://localhost:${hs.port}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-vela-token": hs.token },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });
    if (r.status === 401) { handshake = null; throw new Error("filesystem broker auth failed"); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) throw new Error(data.error || `broker error ${r.status}`);
    return data;
  } finally { clearTimeout(timer); }
}

// ── Watch loop (long-poll; echo suppression lives in the broker) ────────────

let watchRunning = false;
let watchStop = false;
let onExternal = null;

async function watchLoop() {
  if (watchRunning) return;
  watchRunning = true;
  watchStop = false;
  while (!watchStop) {
    try {
      const data = await call("/watch/poll", {}, 30000);
      if (watchStop) break;
      if (data.changed && onExternal) {
        try { onExternal(data.name); } catch (e) { console.warn("[fs-bridge] watch cb failed:", e); }
      }
    } catch (e) {
      if (watchStop) break;
      // Broker not up yet / transient — back off and retry.
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  watchRunning = false;
}

export const fsBridge = {
  install,
  ready,

  // Folder: the page passes the user-chosen path (from os.showFolderDialog); the
  // broker validates it and adopts it as the single decks trust root.
  async setFolder(path) {
    const data = await call("/folder", { path });
    return data.folder;
  },

  async listDecks() {
    const data = await call("/decks/list", {});
    return Array.isArray(data.decks) ? data.decks : [];
  },

  async readDeck(name) {
    const data = await call("/decks/read", { name });
    return data.content;
  },

  async deckExists(name) {
    const data = await call("/decks/exists", { name });
    return !!data.exists;
  },

  async saveDeck(name, content) {
    await call("/decks/save", { name, content });
  },

  async newDeck(title) {
    const data = await call("/decks/new", { title });
    return data.name;
  },

  // Config (~/.vela/config.json) — semantic get/put of a fixed file; the page
  // never names the path. Returns the raw JSON string (or "" when absent).
  async readConfig() {
    const data = await call("/config/get", {});
    return data.content || "";
  },
  async writeConfig(content) {
    await call("/config/put", { content });
  },

  // Per-folder trust (<folder>/.vela/trust.json) — same fixed-file model.
  async readTrust() {
    const data = await call("/trust/get", {});
    return data.content || "";
  },
  async writeTrust(content) {
    await call("/trust/put", { content });
  },

  // Watch wiring.
  async setWatchTarget(name) {
    try { await call("/watch/set", { name }); } catch (e) { console.warn("[fs-bridge] setWatchTarget:", e); }
  },
  startWatch(cb) {
    onExternal = cb;
    watchLoop();
  },
  stopWatch() {
    watchStop = true;
    onExternal = null;
  },

  // Relay for the AGENT gatekeeper handshake (agents-bridge.js can no longer read
  // the files itself). The broker reads the two fixed agent-ext files and returns
  // {port, token} or { available:false }.
  async agentHandshake() {
    const data = await call("/agent-handshake", {}, 8000);
    if (!data.available) return null;
    return { port: String(data.port), token: String(data.token) };
  },
};
