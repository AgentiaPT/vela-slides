// Neutralino bootstrap for the Vela window.
//
// Responsibilities:
//   1. Init Neutralino, expose a `nl-ready` event for other scripts.
//   2. Pick / remember a decks folder (via deckIO) and show an in-window
//      picker so the user can browse and switch decks at any time.
//   3. Mirror every in-app edit back to the selected file.
//   4. Fetch and transpile vela.jsx via Babel standalone. The current
//      local.html inlines the JSX into the HTML template at serve time; we
//      load it as a separate static file instead so the build pipeline is
//      plain `cp` and the dev loop is a file-watcher refresh away.
//
// The AI path runs through a hardened gatekeeper extension — see SECURITY.md.
// `os.spawnProcess` is still NOT in the nativeAllowList; the webview only talks
// to the gatekeeper over loopback HTTP (agents-bridge.js), and the gatekeeper
// is the sole process allowed to launch a child, limited to the two
// whitelisted agent binaries. We detect installed agents at boot and publish
// __velaAgentReady / __velaAgentInfo accordingly.

import { deckIO } from "./deck-io.js";
import { agents } from "./agents-bridge.js";
import { configStore } from "./config-store.js";
import { trust } from "./trust.js";
import { checkForUpdate } from "./update-check.js";
import { fsGuard } from "./fs-guard.js";
import { showDeckWarning } from "./deck-warning.js";

const $ = (id) => document.getElementById(id);
const loadingMsg = $("vela-loading-msg");
const loadingHint = $("vela-loading-hint");

function setMsg(text) { if (loadingMsg) loadingMsg.textContent = text; }
function setHint(text) { if (loadingHint) loadingHint.textContent = text; }

// Never template user-reachable strings into innerHTML — runtime errors
// surfaced here can originate from the Vela monolith's validators, which
// may include attacker-controlled deck content. The Neutralino webview
// grants filesystem.* on a sandboxed root, so DOM XSS could still lead to
// arbitrary read/write inside the user's decks folder. We build the panel
// out of textContent-only nodes to keep it purely inert.
function showError(text) {
  const host = $("vela-loading");
  const str = String(text == null ? "" : text);
  if (!host) { alert(str); return; }
  host.replaceChildren();
  const h = document.createElement("div");
  h.className = "title";
  h.textContent = "VELA";
  const body = document.createElement("div");
  body.className = "err";
  body.textContent = str;
  host.appendChild(h);
  host.appendChild(body);
}

async function boot() {
  setMsg("Starting Neutralino…");
  try {
    Neutralino.init();
  } catch (e) {
    return showError("Neutralino.init() failed: " + e.message);
  }
  // Wrap Neutralino.filesystem.* so every path must resolve inside an allowed
  // root (the decks folder + ~/.vela, registered by deck-io/config-store).
  // Installed before any module touches the filesystem.
  fsGuard.install();
  window.dispatchEvent(new Event("nl-ready"));
  Neutralino.events.on("windowClose", () => Neutralino.app.exit());
  installFullscreenBridge();
  installTrustBridge();
  // Wire the AI bridge. Synchronous hooks (sender + default info) are set
  // immediately so velaAIAvailable() resolves before Vela mounts; provider
  // detection runs in the background and updates the UI via vela-agent-update.
  installAgentsBridge();

  // Global Ctrl+O / Cmd+O opens the picker. Attached before Vela mounts so
  // the shortcut is available even if Vela never finishes loading.
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "o") {
      e.preventDefault();
      openPicker();
    }
  });

  // Check CLI args for a file path (double-click / file association).
  // NL_ARGS: [binary, "--url=...", ...userArgs]. User args come after the
  // Neutralino flags. We look for a .vela or .json path.
  let cliFile = null;
  try {
    const args = typeof NL_ARGS !== "undefined" ? NL_ARGS : [];
    for (const arg of args) {
      if (/\.(vela|json)$/i.test(arg) && !arg.startsWith("--")) {
        // Normalise to forward slashes for consistency with deck-io.
        cliFile = arg.replace(/\\/g, "/");
        break;
      }
    }
    if (cliFile) {
      // Register the file's containing folder as an allowed FS root BEFORE the
      // guarded getStats below. fsGuard.install() ran with an empty root list,
      // so without this the existence check throws and the file is silently
      // dropped (the whole feature is dead). The user explicitly opened this
      // file, so its folder is the trust root — same model as a folder-dialog
      // pick; underRoot() still blocks "..". We only allow + probe here;
      // initWithFile() commits state/persistence once existence is confirmed,
      // so a missing file leaves the remembered folder untouched.
      fsGuard.allow(cliFile.replace(/\/[^/]+$/, ""));
      try { await Neutralino.filesystem.getStats(cliFile); }
      catch { cliFile = null; } // missing / unreadable — fall through to picker
    }
  } catch { /* NL_ARGS unavailable — ignore */ }

  if (cliFile) {
    setMsg("Opening file…");
    await deckIO.initWithFile(cliFile);
  } else {
    setMsg("Choosing decks folder…");
    try {
      await deckIO.init();
    } catch (e) {
      return showError("No folder selected. Relaunch Vela and pick a folder containing .vela decks.");
    }
  }

  setMsg("Locating a deck…");
  let deckPath = cliFile || await deckIO.lastDeckPath();
  if (deckPath) {
    try { await Neutralino.filesystem.getStats(deckPath); }
    catch { deckPath = null; }
  }

  // On first run with no remembered deck, show the picker instead of
  // silently grabbing the alphabetically-first file. Users consistently
  // expected "pick one" here.
  if (!deckPath) {
    setMsg("Waiting for deck selection…");
    deckPath = await promptForDeck();
    if (!deckPath) return showError("No deck chosen. Relaunch Vela and pick one.");
  }

  setMsg("Loading deck…");
  let initialDeck;
  try {
    initialDeck = await deckIO.openDeck(deckPath);
  } catch (e) {
    return showError("Failed to load deck: " + e.message);
  }

  // Display the externally-authored-deck warning before the monolith mounts.
  // Vela is intended for personal authoring — opening a deck someone else
  // wrote (or that came from a download / shared folder) is the primary
  // social-engineering path into the app.
  await showDeckWarning(deckPath);

  // Expose the startup patch BEFORE vela.jsx is transpiled so STARTUP_PATCH
  // inside the monolith picks it up on first render.
  window.__velaStartupPatch = initialDeck;

  // External-edit listener: when deck-io sees a file change from outside,
  // push into the running app via the existing __velaReceiveDeckUpdate hook.
  deckIO.onDeckLoaded((deck, _path, meta = {}) => {
    if (meta.external && window.__velaReceiveDeckUpdate) {
      window.__velaReceiveDeckUpdate(deck);
    }
  });

  // Save hook: Vela calls this on every state change. deck-io debounces.
  window.__velaSendDeckUpdate = (deck) => deckIO.saveCurrent(deck);

  // New-deck hook: the app calls this when the user creates a deck so a fresh
  // file is allocated and made current BEFORE autosave runs — otherwise the new
  // deck's content would overwrite the previously-open file.
  window.__velaCreateDeck = (title) => deckIO.createDeck(title);

  // Manual "Check for updates" from the About dialog — force past the once-a-day
  // throttle and return the result so the dialog can report it.
  window.__velaCheckForUpdate = () => checkForUpdate(configStore, { force: true });

  setMsg("Transpiling Vela…");
  await loadVela();

  // Fade out the loader; Vela's render has now mounted into #root.
  const loader = $("vela-loading");
  if (loader) {
    loader.classList.add("fade-out");
    setTimeout(() => loader.remove(), 500);
  }

  setTimeout(() => checkForUpdate(configStore).catch(() => {}), 5000);
}

// ---------- Deck picker ----------------------------------------------------
//
// A single-element overlay driven entirely by DOM. Kept deliberately simple
// (no framework needed — this code runs before React is available). Three
// ways in: first-run auto-open, Ctrl+O, or the floating pill. One way out:
// selection commits a path via the `resolve` handle.

const picker = {
  el: null, list: null, folderEl: null, countEl: null, changeBtn: null,
  decks: [], focusIdx: 0,
  resolve: null,
  onSelect: null,
};

function ensurePickerBound() {
  if (picker.el) return;
  picker.el = $("deck-picker");
  picker.list = $("deck-picker-list");
  picker.folderEl = $("deck-picker-folder");
  picker.countEl = $("deck-picker-count");
  picker.changeBtn = $("deck-picker-change");

  picker.changeBtn.onclick = async () => {
    try {
      await deckIO.reselectFolder();
      await refreshPicker();
    } catch {
      // Cancelled — leave picker as-is.
    }
  };

  picker.el.addEventListener("click", (e) => {
    if (e.target === picker.el) closePicker(null);
  });

  document.addEventListener("keydown", (e) => {
    if (!picker.el.classList.contains("open")) return;
    if (e.key === "Escape") { e.preventDefault(); closePicker(null); }
    else if (e.key === "ArrowDown") { e.preventDefault(); moveFocus(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveFocus(-1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const d = picker.decks[picker.focusIdx];
      if (d) closePicker(d.path);
    }
  });
}

function moveFocus(delta) {
  if (!picker.decks.length) return;
  picker.focusIdx = (picker.focusIdx + delta + picker.decks.length) % picker.decks.length;
  renderPickerList();
  const row = picker.list.querySelector(".item.focus");
  if (row) row.scrollIntoView({ block: "nearest" });
}

async function refreshPicker() {
  picker.folderEl.textContent = deckIO.folder() || "—";
  picker.decks = await deckIO.listDecks();
  const cur = deckIO.currentPath();
  picker.focusIdx = Math.max(0, picker.decks.findIndex((d) => d.path === cur));
  picker.countEl.textContent = `${picker.decks.length} deck${picker.decks.length === 1 ? "" : "s"}`;
  renderPickerList();
}

function renderPickerList() {
  const cur = deckIO.currentPath();
  picker.list.replaceChildren();
  if (!picker.decks.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No .vela or .json files in this folder. Pick a different folder or add a deck.";
    picker.list.appendChild(empty);
    return;
  }
  picker.decks.forEach((d, i) => {
    // Filenames come from disk — use DOM primitives with textContent so a
    // deck named "<img src=x onerror=…>.vela" cannot execute. Even without
    // os.spawnProcess, the webview grants filesystem.* on the user's deck
    // folder, so HTML injection here would still be a path to data
    // exfil/tamper.
    const row = document.createElement("div");
    row.className = "item" + (d.path === cur ? " current" : "") + (i === picker.focusIdx ? " focus" : "");
    const bullet = document.createElement("span");
    bullet.className = "bullet";
    const name = document.createElement("span");
    name.textContent = d.name;
    row.appendChild(bullet);
    row.appendChild(name);
    row.onclick = () => closePicker(d.path);
    picker.list.appendChild(row);
  });
}

async function openPicker() {
  ensurePickerBound();
  await refreshPicker();
  picker.el.classList.add("open");
}

// Exposed on window so Vela's part-app.jsx (v12.37+) can route the header
// sail-icon click to the deck picker when running under Neutralino. If the
// global is undefined (artifact / serve.py), Vela falls back to the About
// dialog — same UX as before.
window.__velaOpenDeckPicker = openPicker;

async function closePicker(selectedPath) {
  picker.el.classList.remove("open");
  if (picker.resolve) {
    const r = picker.resolve;
    picker.resolve = null;
    r(selectedPath);
    return;
  }
  // Post-boot navigation — load the chosen deck into the running app.
  if (selectedPath && selectedPath !== deckIO.currentPath()) {
    try {
      await showDeckWarning(selectedPath);
      const deck = await deckIO.openDeck(selectedPath);
      if (window.__velaReceiveDeckUpdate) {
        window.__velaReceiveDeckUpdate(deck);
      } else {
        // App not mounted yet (shouldn't happen, but be safe)
        window.__velaStartupPatch = deck;
      }
    } catch (e) {
      console.error("[nl-boot] openDeck failed:", e);
    }
  }
}

function promptForDeck() {
  return new Promise((resolve) => {
    picker.resolve = resolve;
    openPicker();
  });
}

// ---------- Trust bridge --------------------------------------------------
//
// Installs window.__velaTrustGate (consumed by part-engine.jsx's
// callClaudeAPI) and window.__velaTrustAdmin (for the Settings panel).
// The gate auto-derives the current deck's folder from deckIO so callers
// only need to pass their deck path — or nothing, if they trust the
// currently-open deck.

function installTrustBridge() {
  window.__velaTrustGate = async (deckPath) => {
    const folder = deckIO.folder();
    const path = deckPath || deckIO.currentPath();
    if (!folder || !path) return "allow";
    return trust.gate(folder, path);
  };
  window.__velaTrustStatus = async (deckPath) => {
    const folder = deckIO.folder();
    const path = deckPath || deckIO.currentPath();
    return trust.statusOf(folder, path);
  };
  window.__velaTrustAdmin = {
    listForCurrentFolder: async () => {
      const folder = deckIO.folder();
      if (!folder) return [];
      return trust.listTrustedIn(folder);
    },
    revoke: async (relativePath) => {
      const folder = deckIO.folder();
      if (folder) await trust.revoke(folder, relativePath);
    },
    revokeAll: async () => {
      const folder = deckIO.folder();
      if (folder) await trust.revokeAllIn(folder);
    },
  };
  window.__velaConfig = {
    get: () => configStore.get(),
    setAgent: (id) => selectProvider(id),
  };
}

// ---------- Agents bridge -------------------------------------------------
//
// Installs window.__velaAgentSend (consumed by part-engine.jsx's
// callClaudeAPI) plus the provider-selection surface used by the trust modal
// and the Agent settings dialog. The webview spawns nothing — every call is a
// loopback request to the gatekeeper extension (see agents-bridge.js).

// Switch the active provider, persist it, and refresh the UI snapshot.
async function selectProvider(id) {
  await agents.pick(id);
  window.__velaAgentInfo = agents.info();
  window.__velaAgentReady = agents.available();
  window.__velaAgentActive = window.__velaAgentInfo.model || window.__velaAgentInfo.id;
  window.dispatchEvent(new Event("vela-agent-update"));
}

function installAgentsBridge() {
  // Default to unavailable until detection completes.
  window.__velaAgentReady = false;
  window.__velaAgentInfo = { id: null, label: "—", available: false, version: null, model: null, providers: [] };

  // Session-confirm-gated sender. part-engine.jsx calls window.__velaTrustGate()
  // (trust.js) before this — that prompts once per session and lets the user
  // pick a provider when more than one agent is installed.
  window.__velaAgentSend = async (payload) => {
    const res = await agents.send(payload);
    if (res?.stats?.model) {
      window.__velaAgentInfo = agents.info();
      window.__velaAgentActive = window.__velaAgentInfo.model || window.__velaAgentInfo.id;
      window.dispatchEvent(new Event("vela-agent-update"));
    }
    return res.text;
  };

  // Provider surface for the Settings dialog picker.
  window.__velaAgents = {
    list: () => agents.list(),
    activeId: () => agents.activeId(),
    pick: (id) => selectProvider(id),
    refresh: async () => {
      await agents.detect();
      window.__velaAgentInfo = agents.info();
      window.__velaAgentReady = agents.available();
      window.__velaAgentActive = window.__velaAgentInfo.model || window.__velaAgentInfo.id;
      window.dispatchEvent(new Event("vela-agent-update"));
    },
  };
  // Consumed by trust.js to render the provider choice in the confirm modal.
  window.__velaSelectProvider = selectProvider;

  // Detect installed agents in the background — the gatekeeper may still be
  // starting, so this polls briefly (agents-bridge.js) and updates when ready.
  (async () => {
    try {
      await agents.detect();
      window.__velaAgentInfo = agents.info();
      window.__velaAgentReady = agents.available();
      window.__velaAgentActive = window.__velaAgentInfo.model || window.__velaAgentInfo.id;
    } catch {
      window.__velaAgentReady = false;
    }
    window.dispatchEvent(new Event("vela-agent-update"));
  })();
}

// ---------- Fullscreen bridge ---------------------------------------------
//
// Vela's presenter mode (F key, fullscreen toolbar button) calls
// `element.requestFullscreen()` — the W3C API. Inside the Neutralino
// webview that call is unreliable: on WebView2 it sometimes works, on
// gtk-webkit it's usually stubbed, and in any case it only hides the page
// chrome, not the OS window chrome. Neutralino has a first-class
// `window.setFullScreen()` that switches the real OS window to borderless
// fullscreen. We bridge the two APIs so Vela's existing code path gets
// real fullscreen with zero changes to the monolith:
//
//   1. Override Element.prototype.requestFullscreen + the vendor-prefixed
//      variants to call Neutralino.window.setFullScreen() and emit the
//      standard `fullscreenchange` event.
//   2. Override document.exitFullscreen likewise.
//   3. Expose a read-only document.fullscreenElement getter so code that
//      checks "am I in fullscreen?" still works.
//   4. Listen for Escape and the F11 shortcut so users have an out even
//      when Vela's handlers don't fire.

function installFullscreenBridge() {
  let fsElement = null;

  const fire = () => {
    document.dispatchEvent(new Event("fullscreenchange"));
    document.dispatchEvent(new Event("webkitfullscreenchange"));
  };

  async function enter(el) {
    try {
      await Neutralino.window.setFullScreen();
      fsElement = el || document.documentElement;
      fire();
    } catch (e) {
      console.warn("[nl-boot] setFullScreen failed:", e);
    }
  }

  async function exit() {
    try {
      await Neutralino.window.exitFullScreen();
    } catch (e) {
      console.warn("[nl-boot] exitFullScreen failed:", e);
    } finally {
      fsElement = null;
      fire();
    }
  }

  const req = function () { return enter(this); };
  Element.prototype.requestFullscreen = req;
  Element.prototype.webkitRequestFullscreen = req;
  Element.prototype.mozRequestFullScreen = req;
  Element.prototype.msRequestFullscreen = req;

  document.exitFullscreen = exit;
  document.webkitExitFullscreen = exit;
  document.mozCancelFullScreen = exit;
  document.msExitFullscreen = exit;

  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fsElement,
  });
  Object.defineProperty(document, "webkitFullscreenElement", {
    configurable: true,
    get: () => fsElement,
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "F11") { e.preventDefault(); fsElement ? exit() : enter(document.documentElement); }
    else if (e.key === "Escape" && fsElement) { exit(); }
  }, true);
}

// ---------- Vela transpile + mount -----------------------------------------

async function loadVela() {
  // Fetch the preprocessed monolith. Served by Neutralino's static server
  // at the document root (`/resources/`), so a plain relative path works.
  const res = await fetch("vela.jsx");
  if (!res.ok) throw new Error(`vela.jsx HTTP ${res.status}`);
  const jsx = await res.text();

  if (!window.Babel) throw new Error("Babel standalone not loaded");

  // Inject the startup patch by replacing the sentinel in the source. This
  // keeps the marker machinery compatible with assemble.py and serve.py —
  // the monolith itself is untouched between the three runtimes.
  const patched = injectStartupPatch(jsx, window.__velaStartupPatch);

  const { code } = Babel.transform(patched, {
    presets: [["react", { runtime: "classic" }]],
    sourceMaps: "inline",
    sourceFileName: "vela.jsx",
  });

  // Execute. Classic <script> so top-level `function App()` is hoisted to
  // window.App. Capture evaluation errors rather than letting appendChild
  // swallow them — an async boot flow leaves no breadcrumbs otherwise.
  let scriptError = null;
  const prevOnError = window.onerror;
  window.onerror = (msg, src, line, col, err) => { scriptError = err || new Error(String(msg)); };
  const s = document.createElement("script");
  s.text = code;
  document.body.appendChild(s);
  window.onerror = prevOnError;
  if (scriptError) throw scriptError;

  const rootEl = document.getElementById("root");
  if (!window._createRoot) throw new Error("ReactDOM.createRoot not available");
  if (typeof window.App !== "function") {
    throw new Error(
      "window.App not defined after transpile. Check DevTools console — a " +
      "syntax or runtime error during vela.jsx top-level evaluation " +
      "prevented the function declaration from hoisting."
    );
  }
  const root = window._createRoot(rootEl);
  root.render(window.React.createElement(window.App));
}

function injectStartupPatch(jsx, deck) {
  const marker = "const STARTUP_PATCH = null;";
  if (!jsx.includes(marker)) {
    console.warn("[nl-boot] STARTUP_PATCH marker not found — app will boot empty");
    return jsx;
  }
  // Escape the full set of chars that can break out of a <script> block or
  // terminate a JS string literal — aligned with assemble.py/serve.py's
  // escape_for_script_context() for defense-in-depth consistency.
  const safe = JSON.stringify(deck)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return jsx.replace(marker, `const STARTUP_PATCH = ${safe};`);
}

// ---------- Global error surfacing -----------------------------------------

window.addEventListener("error", (ev) => {
  if (ev.error) showError((ev.error.stack || ev.error.message || String(ev.error)));
});
window.addEventListener("unhandledrejection", (ev) => {
  const r = ev.reason;
  showError(r && (r.stack || r.message) ? (r.stack || r.message) : String(r));
});

boot().catch((e) => showError(e.stack || e.message || String(e)));
