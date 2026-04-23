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
// The AI path (agents bridge) is intentionally absent from PR2. AI buttons
// inside Vela are disabled because VELA_LOCAL_MODE is true but
// VELA_CHANNEL_PORT is 0, so velaAIAvailable() cleanly returns false. PR3
// wires the Neutralino-mode branch into part-engine.jsx.

import { deckIO } from "./deck-io.js";
import { agents } from "./agents-bridge.js";

const $ = (id) => document.getElementById(id);
const loadingMsg = $("vela-loading-msg");
const loadingHint = $("vela-loading-hint");

function setMsg(text) { if (loadingMsg) loadingMsg.textContent = text; }
function setHint(text) { if (loadingHint) loadingHint.textContent = text; }
function showError(text) {
  const host = $("vela-loading");
  if (!host) { alert(text); return; }
  host.innerHTML = `<div class="title">VELA</div><div class="err">${text}</div>`;
}

async function boot() {
  setMsg("Starting Neutralino…");
  try {
    Neutralino.init();
  } catch (e) {
    return showError("Neutralino.init() failed: " + e.message);
  }
  window.dispatchEvent(new Event("nl-ready"));
  Neutralino.events.on("windowClose", () => Neutralino.app.exit());
  installFullscreenBridge();
  await installAgentsBridge();

  // Global Ctrl+O / Cmd+O opens the picker. Attached before Vela mounts so
  // the shortcut is available even if Vela never finishes loading.
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "o") {
      e.preventDefault();
      openPicker();
    }
  });

  setMsg("Choosing decks folder…");
  try {
    await deckIO.init();
  } catch (e) {
    return showError("No folder selected. Relaunch Vela and pick a folder containing .vela decks.");
  }

  setMsg("Locating a deck…");
  let deckPath = await deckIO.lastDeckPath();
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

  setMsg("Transpiling Vela…");
  await loadVela();

  // Fade out the loader; Vela's render has now mounted into #root.
  const loader = $("vela-loading");
  if (loader) {
    loader.classList.add("fade-out");
    setTimeout(() => loader.remove(), 500);
  }

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
  if (!picker.decks.length) {
    picker.list.innerHTML = '<div class="empty">No .vela or .json files in this folder. Pick a different folder or add a deck.</div>';
    return;
  }
  picker.list.innerHTML = "";
  picker.decks.forEach((d, i) => {
    const row = document.createElement("div");
    row.className = "item" + (d.path === cur ? " current" : "") + (i === picker.focusIdx ? " focus" : "");
    row.innerHTML = `<span class="bullet"></span><span>${escapeHtml(d.name)}</span>`;
    row.onclick = () => closePicker(d.path);
    picker.list.appendChild(row);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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

// ---------- Agents bridge -------------------------------------------------
//
// Probes the active backend (Claude Code by default) for availability and
// installs two globals the Vela monolith reads:
//
//   window.__velaAgentSend  — callable; returns the assistant text reply.
//                             Vela's callClaudeAPI uses this when defined.
//   window.__velaAgentReady — boolean; flips velaAIAvailable() on in the
//                             Neutralino build (part-engine.jsx v12.38+).
//
// If the CLI isn't on PATH the flag stays false and AI buttons render as
// "unavailable" — same UX as in local mode without a channel running.

async function installAgentsBridge() {
  try {
    const ok = await agents.available();
    window.__velaAgentReady = !!ok;
    window.__velaAgentActive = agents.active().id;
    if (!ok) {
      console.warn("[nl-boot] Claude Code CLI not on PATH — AI features disabled");
      return;
    }
    window.__velaAgentSend = async (payload) => {
      const r = await agents.send(payload);
      if (r.stats && window.velaSessionStats?.add) {
        window.velaSessionStats.add({
          type: payload._callType || "chat",
          tool_calls: 0,
          stop_reason: "cli",
          ...r.stats,
        });
      }
      return r.text;
    };
  } catch (e) {
    console.warn("[nl-boot] agents bridge init failed:", e);
    window.__velaAgentReady = false;
  }
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
  const safe = JSON.stringify(deck).replace(/<\//g, "<\\/");
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
