// Desktop reconnect tests (Neutralino shell): save and file sync after the
// native WebSocket drops (sleep, hibernate, network change).
//
// The R1-R5 cases reproduce the failures seen before nl-socket.js, the deck-io
// connection gate and the resync path existed. They must stay green.

// HARNESS
//   makeClock()       fake clock: setTimeout/setInterval/Date. Time moves only
//                     through env.advance / env.until / env.suspend.
//   FakeRuntime       fake Neutralino runtime + WebSocket class. Modes:
//                       up      accepts connections and answers calls
//                       down    closes open sockets; new connections fail
//                       frozen  open sockets turn dead (stay OPEN, answer
//                               nothing, deliver nothing) and stay dead for
//                               good; new connections hang in CONNECTING
//                     Helpers: drop(), externalWrite(), lateMessage(),
//                     injectError(), setMode(), counters (opened, attempts,
//                     calls, frames).
//   makeEnv(opts)     one vm context per test. The global object is a fake
//                     window (event target, document stub, sessionStorage,
//                     NL_* globals, recording console, fake clock).
//   boot(kind, opts)  mirrors the boot in nl-boot.js. kind = "model" (Tier 1) or
//                     "real" (Tier 2). opts.sock=false boots the old way.
//   scenario(name, fn, opts)  register a test. fn(kind) runs once per tier.
//
// Tier 1 "model": a small client that copies the v6.9.0 behaviour exactly as
// verified against the pinned client.
// Tier 2 "real": the pinned client vela-neutralino/resources/js/neutralino.js.
// It runs only when that file exists and its SHA256 equals the pin in
// vela-neutralino/checksums/clientlib-v6.9.0.sha256 (the file is gitignored).
//
// Set NL_BASELINE=1 to run the R cases against the old boot (no
// nl-socket.js, no connection gate). This shows the old failures.
// Pass a substring as argv[2] to run only the matching tests.
//
// Tags in test names: [rev Xn] = review finding, [fix Xn] = fix item,
// [sec ...] = security review finding. The "[unit]" cases call deck-io.js
// directly with a fake Neutralino object; they run once, not once per tier.

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const nodeCrypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const JS_DIR = path.join(ROOT, "vela-neutralino", "resources", "js");
const PIN_FILE = path.join(ROOT, "vela-neutralino", "checksums", "clientlib-v6.9.0.sha256");
const BASELINE = process.env.NL_BASELINE === "1";
const FILTER = process.argv[2] || "";

let pass = 0, fail = 0, skipped = 0;
const ok = (n) => { pass++; console.log("  ✅ " + n); };
const bad = (n, d) => { fail++; console.log("  ❌ " + n + (d ? " — " + d : "")); };
const assert = (cond, msg) => { if (!cond) throw new Error(msg || "assertion failed"); };
const realTick = () => new Promise((r) => setImmediate(r));

const PORT = "41234";
const MARKER = "MARK" + nodeCrypto.randomBytes(8).toString("hex"); // connect token
const ACCESS = "ACC" + nodeCrypto.randomBytes(8).toString("hex");  // access token
const TOKEN = `${ACCESS}.${MARKER}`;
const DECK_DIR = "/decks";
const DECK_PATH = "/decks/a.vela";
const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}";

// ── Process-level guards ──
const globalErrors = [];
const unhandled = [];
process.on("uncaughtException", (e) => { globalErrors.push(String(e && e.stack || e)); });
process.on("unhandledRejection", (e) => { unhandled.push(String(e && e.message || e)); });

// ── Fake clock ──
const CLOCK_START = Date.UTC(2026, 0, 15, 10, 0, 0);
function makeClock() {
  let now = CLOCK_START, seq = 0;
  const timers = new Map();
  const add = (fn, ms, args, repeat) => {
    const id = ++seq;
    timers.set(id, { id, at: now + Math.max(0, Number(ms) || 0), fn, args, repeat, order: id });
    return id;
  };
  const clock = {
    now: () => now,
    setTimeout: (fn, ms, ...args) => add(fn, ms, args, 0),
    setInterval: (fn, ms, ...args) => add(fn, ms, args, Math.max(1, Number(ms) || 1)),
    clearTimeout: (id) => { timers.delete(id); },
    clearInterval: (id) => { timers.delete(id); },
    pending: () => timers.size,
    // Jump the clock without running any timer (machine asleep).
    jump(ms) { now += ms; },
    nextDue(limit) {
      let best = null;
      for (const t of timers.values()) {
        if (t.at > limit) continue;
        if (!best || t.at < best.at || (t.at === best.at && t.order < best.order)) best = t;
      }
      return best;
    },
    fire(t) {
      now = Math.max(now, t.at);
      if (t.repeat) { t.at = now + t.repeat; t.order = ++seq; } else timers.delete(t.id);
      t.fn(...(t.args || []));
    },
    setNow(v) { now = v; },
  };
  return clock;
}
async function flush() { for (let i = 0; i < 5; i++) await realTick(); }

// ── Fake runtime and WebSocket ──
class FakeRuntime {
  constructor(clock, opts = {}) {
    this.clock = clock;
    this.mode = "up";
    this.files = new Map();
    this.storage = new Map();
    this.watchers = new Map();
    this.nextWatcher = 1;
    this.sockets = [];      // every socket ever created (index = creation order)
    this.conns = new Set(); // sockets the runtime currently holds open
    this.opened = 0;        // connections opened
    this.attempts = 0;      // connections tried
    this.calls = {};        // method → count received (dead sockets included)
    this.answered = {};     // method → count answered
    this.frames = [];       // raw frames received
    this.token = TOKEN;
    this.access = opts.expectAccess !== undefined ? opts.expectAccess : ACCESS;
    this.echoWrites = !!opts.echoWrites; // send watchFile for our own writeFile too
    this.dedupeWatchers = !!opts.dedupeWatchers;
    // Fault hooks for the regression cases (all off by default):
    this.holdWrites = false;     // writes are received but not applied and not answered
    this.held = [];              // those writes, in order: { path, data }
    this.writeLog = [];          // every write that was APPLIED: { path, data }
    this.writeFault = null;      // (path, data) → null | "fail" | "corrupt"
    this.sizeOverride = new Map(); // path → size reported by getStats
    this.deadOn = null;          // method name: the socket turns dead when this call arrives (once)
    const rt = this;
    this.WebSocket = class FakeWebSocket {
      constructor(url, protocols) {
        this.url = String(url);
        this.protocols = protocols;
        this.readyState = 0;
        this.dead = false;
        this._l = {};
        this.index = rt.sockets.length;
        rt.sockets.push(this);
        rt._connect(this);
      }
      addEventListener(type, fn) { (this._l[type] = this._l[type] || []).push(fn); }
      removeEventListener(type, fn) { this._l[type] = (this._l[type] || []).filter((f) => f !== fn); }
      _emit(type, ev) {
        for (const fn of (this._l[type] || []).slice()) {
          try { fn(ev || { type }); } catch (e) { rt.listenerErrors.push(String(e && e.message || e)); }
        }
      }
      send(data) {
        if (this.readyState !== 1) throw new Error("InvalidStateError: socket is not open");
        rt._receive(this, String(data));
      }
      close() {
        if (this.readyState >= 2) return;
        const wasConnecting = this.readyState === 0;
        this.readyState = 2;
        rt.clock.setTimeout(() => {
          this.readyState = 3;
          rt.conns.delete(this);
          if (wasConnecting) this._emit("error");
          this._emit("close");
        }, 1);
      }
    };
    this.WebSocket.CONNECTING = 0; this.WebSocket.OPEN = 1; this.WebSocket.CLOSING = 2; this.WebSocket.CLOSED = 3;
    Object.assign(this.WebSocket.prototype, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    this.listenerErrors = [];
  }
  expectedUrl() { return `ws://127.0.0.1:${PORT}?connectToken=${MARKER}`; }
  _connect(sock) {
    this.attempts++;
    const valid = sock.url === this.expectedUrl();
    if (this.mode === "frozen" && valid) return; // blackholed: stays CONNECTING
    this.clock.setTimeout(() => {
      if (sock.readyState !== 0) return;
      if (this.mode !== "up" || !valid) {
        sock.readyState = 3;
        sock._emit("error");
        sock._emit("close");
        return;
      }
      sock.readyState = 1;
      this.conns.add(sock);
      this.opened++;
      sock._emit("open");
    }, 1);
  }
  _live(sock) { return sock.readyState === 1 && !sock.dead; }
  _deliver(sock, obj) {
    this.clock.setTimeout(() => {
      if (!this._live(sock)) return;
      sock._emit("message", { data: typeof obj === "string" ? obj : JSON.stringify(obj) });
    }, 1);
  }
  _receive(sock, data) {
    this.frames.push(data);
    let m;
    try { m = JSON.parse(data); } catch { return; }
    const name = String(m.method);
    this.calls[name] = (this.calls[name] || 0) + 1;
    if (this.deadOn && name === this.deadOn) { this.deadOn = null; sock.dead = true; }
    if (sock.dead) return;
    if (name === "filesystem.writeFile" && this.holdWrites && (m.accessToken === this.token || m.accessToken === this.access)) {
      // The runtime got the call and will write later, but it sends no reply.
      this.held.push({ path: (m.data || {}).path, data: String((m.data || {}).data) });
      return;
    }
    let reply;
    if (m.accessToken !== this.token && m.accessToken !== this.access) {
      reply = { id: m.id, data: { error: { code: "NE_RT_INVTOKN", message: "Invalid token" } } };
    } else {
      try {
        const v = this._handle(name, m.data || {});
        const d = { success: true };
        if (v !== undefined) d.returnValue = v;
        reply = { id: m.id, data: d };
        this.answered[name] = (this.answered[name] || 0) + 1;
      } catch (e) {
        reply = { id: m.id, data: { error: { code: e.code || "NE_RT_NATRTER", message: String(e.message) } } };
      }
    }
    this._deliver(sock, reply);
  }
  _err(code, message) { const e = new Error(message || code); e.code = code; return e; }
  _handle(name, d) {
    switch (name) {
      case "filesystem.readFile":
        if (!this.files.has(d.path)) throw this._err("NE_FS_FILRDER", "no file");
        return this.files.get(d.path);
      case "filesystem.writeFile": {
        let data = String(d.data);
        const fault = this.writeFault ? this.writeFault(d.path, data) : null;
        if (fault === "fail") throw this._err("NE_FS_FILWRER", "write failed");
        if (fault === "corrupt") data = data.slice(0, Math.max(0, data.length - 5)) + "#####"; // same size, other bytes
        this.files.set(d.path, data);
        this.writeLog.push({ path: d.path, data });
        if (this.echoWrites) this._announce(d.path);
        return undefined;
      }
      case "filesystem.getStats":
        if (this.files.has(d.path)) {
          const size = this.sizeOverride.has(d.path) ? this.sizeOverride.get(d.path) : Buffer.byteLength(this.files.get(d.path), "utf8");
          return { size, isFile: true, isDirectory: false };
        }
        if ([...this.files.keys()].some((k) => k.startsWith(d.path + "/")) || d.path === DECK_DIR) {
          return { size: 0, isFile: false, isDirectory: true };
        }
        throw this._err("NE_FS_NOPATHE", "no path");
      case "filesystem.readDirectory":
        return [...this.files.keys()]
          .filter((k) => k.startsWith(d.path + "/") && !k.slice(d.path.length + 1).includes("/"))
          .map((k) => ({ entry: k.slice(d.path.length + 1), path: d.path, type: "FILE" }));
      case "filesystem.createWatcher": {
        if (this.dedupeWatchers) {
          for (const [id, w] of this.watchers) if (w.path === d.path) return id;
        }
        const id = this.nextWatcher++;
        this.watchers.set(id, { path: d.path });
        return id;
      }
      case "filesystem.removeWatcher":
        if (!this.watchers.has(d.id)) throw this._err("NE_FS_UNLWATC", "no watcher");
        this.watchers.delete(d.id);
        return d.id;
      case "storage.getData":
        if (!this.storage.has(d.key)) throw this._err("NE_ST_NOSTKEX", "no key");
        return this.storage.get(d.key);
      case "storage.setData":
        this.storage.set(d.key, d.data);
        return undefined;
      case "storage.getKeys":
        return [...this.storage.keys()];
      case "extensions.getStats":
        return { connected: [], loaded: [] };
      default:
        throw this._err("NE_RT_NATMTER", "unknown method " + name);
    }
  }
  _announce(p) {
    const i = p.lastIndexOf("/");
    const dir = p.slice(0, i), filename = p.slice(i + 1);
    for (const [id, w] of this.watchers) {
      if (w.path !== dir) continue;
      for (const sock of this.conns) {
        this._deliver(sock, { event: "watchFile", data: { id, action: "modified", dir, filename } });
      }
    }
  }
  // ── test helpers ──
  setMode(m) {
    this.mode = m;
    if (m === "frozen") for (const s of this.conns) s.dead = true;
    if (m === "down") this.drop();
  }
  drop() {
    for (const s of [...this.conns]) {
      this.clock.setTimeout(() => {
        if (s.readyState === 3) return;
        s.readyState = 3;
        this.conns.delete(s);
        s._emit("close");
      }, 1);
    }
  }
  injectError() {
    for (const s of [...this.conns]) this.clock.setTimeout(() => { if (s.readyState === 1) s._emit("error"); }, 1);
  }
  externalWrite(p, text) { this.files.set(p, text); this._announce(p); }
  // A held write lands now (the runtime wrote it late). announce=false: no watcher event.
  releaseHeld(announce = true) {
    const list = this.held.splice(0);
    for (const w of list) {
      this.files.set(w.path, w.data);
      this.writeLog.push({ path: w.path, data: w.data, late: true });
      if (announce) this._announce(w.path);
    }
    return list.length;
  }
  lateMessage(sock, data) { sock._emit("message", { data: typeof data === "string" ? data : JSON.stringify(data) }); }
  disk(p) { return this.files.get(p || DECK_PATH); }
}

// ── Fake window, document, console ──
function makeDoc() {
  const et = new EventTarget();
  const doc = {
    visibilityState: "visible",
    wipes: 0,
    addEventListener: (...a) => et.addEventListener(...a),
    removeEventListener: (...a) => et.removeEventListener(...a),
    dispatchEvent: (e) => et.dispatchEvent(e),
    fire(type) { et.dispatchEvent(new Event(type)); },
    getElementById: () => null,
    createElement: () => ({ innerHTML: "", textContent: "", className: "", appendChild() {}, replaceChildren() {} }),
  };
  doc.body = { replaceChildren() { doc.wipes++; }, appendChild() {} };
  Object.defineProperty(doc, "hidden", { get: () => doc.visibilityState === "hidden" });
  return doc;
}

function fmtArg(a) {
  if (typeof a === "string") return a;
  if (a instanceof Error) return a.name + ": " + a.message + "\n" + (a.stack || "");
  try { return JSON.stringify(a); } catch { return String(a); }
}
function makeConsole(log) {
  const mk = (level) => (...a) => { log.push(level + " " + a.map(fmtArg).join(" ")); };
  return { log: mk("log"), info: mk("info"), warn: mk("warn"), error: mk("error"), debug: mk("debug") };
}

// ── Module loading: strip ESM and run in the context ──
function stripEsm(src) {
  return src
    .replace(/^\s*import\s+(?:[^;'"]*?\sfrom\s+)?["'][^"']+["'];?[ \t]*$/gm, "")
    .replace(/^export\s*\{[^}]*\};?[ \t]*$/gm, "")
    .replace(/^export\s+/gm, "");
}

// ── Model client (Tier 1): the v6.9.0 behaviour, verified against the pinned client ──
// This function is serialised and run INSIDE the context. It uses only free
// globals (window, WebSocket, crypto, document, sessionStorage, CustomEvent).
function modelClientFactory() {
  let K = false, a, c = [], s = {};
  const tok = () => window.NL_TOKEN || sessionStorage.getItem("NL_TOKEN") || "";
  const dispatch = (n, d) => { window.dispatchEvent(new CustomEvent(n, { detail: d })); return Promise.resolve({ success: true }); };
  const on = (n, f) => { window.addEventListener(n, f); return Promise.resolve({ success: true }); };
  const off = (n, f) => { window.removeEventListener(n, f); return Promise.resolve({ success: true }); };
  function wipe(code, msg) {
    document.body.replaceChildren();
    const d = document.createElement("div");
    d.innerHTML = `<code>${code}</code>: ${msg}`;
    document.body.appendChild(d);
  }
  function call(method, data) {
    return new Promise((resolve, reject) => {
      if (a?.readyState != WebSocket.OPEN) { c.push({ method, data, resolve, reject }); return; }
      const id = "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (e) => (e ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> e / 4).toString(16));
      const u = tok();
      s[id] = { resolve, reject };
      a.send(JSON.stringify({ id, method, data, accessToken: u }));
    });
  }
  async function drain(q) {
    while (q.length > 0) {
      const t = q.shift();
      try { t.resolve(await call(t.method, t.data)); } catch (e) { t.reject(e); }
    }
  }
  function connect() {
    if (window.NL_TOKEN) sessionStorage.setItem("NL_TOKEN", window.NL_TOKEN);
    const ct = tok().split(".")[1];
    const host = window.NL_GINJECTED || window.NL_CINJECTED ? "127.0.0.1" : window.location.hostname;
    a = new WebSocket(`ws://${host}:${window.NL_PORT}?connectToken=${ct}`);
    on("ready", async () => { await drain(c); });
    a.addEventListener("message", (e) => {
      const t = JSON.parse(e.data);
      if (t.id && t.id in s) {
        if (t.data?.error) {
          s[t.id].reject(t.data.error);
          if (t.data.error.code == "NE_RT_INVTOKN") { a.close(); wipe("NE_RT_INVTOKN", "NL_TOKEN is invalid."); }
        } else if (t.data?.success) {
          s[t.id].resolve(t.data.hasOwnProperty("returnValue") ? t.data.returnValue : t.data);
        }
        delete s[t.id];
      } else if (t.event) {
        dispatch(t.event, t.data);
      }
    });
    a.addEventListener("open", async () => { dispatch("ready"); });
    a.addEventListener("close", async () => { dispatch("serverOffline", { code: "NE_CL_NSEROFF", message: "offline" }); });
    a.addEventListener("error", async () => { wipe("NE_CL_IVCTOKN", "cannot connect with NL_TOKEN."); });
  }
  const fsx = {
    readFile: (p, o) => call("filesystem.readFile", { path: p, ...o }),
    writeFile: (p, d) => call("filesystem.writeFile", { path: p, data: d }),
    getStats: (p) => call("filesystem.getStats", { path: p }),
    createWatcher: (p) => call("filesystem.createWatcher", { path: p }),
    removeWatcher: (id) => call("filesystem.removeWatcher", { id }),
    readDirectory: (p, o) => call("filesystem.readDirectory", { path: p, ...o }),
  };
  const storage = {
    getData: (k) => call("storage.getData", { key: k }),
    setData: (k, d) => call("storage.setData", { key: k, data: d }),
    getKeys: () => call("storage.getKeys"),
  };
  return {
    init() { if (!K) { connect(); K = true; } },
    filesystem: fsx,
    storage,
    events: { on, off, dispatch },
    extensions: { getStats: () => call("extensions.getStats") },
    os: { showFolderDialog: () => Promise.reject(new Error("no dialog in tests")) },
    app: { exit() { return Promise.resolve(); } },
  };
}

// ── Tier 2 availability ──
function realClientInfo() {
  const file = path.join(JS_DIR, "neutralino.js");
  if (!fs.existsSync(file)) return { ok: false, why: "vela-neutralino/resources/js/neutralino.js is not present (gitignored; CI has no copy)" };
  let pin = null;
  try {
    for (const line of fs.readFileSync(PIN_FILE, "utf8").split("\n")) {
      const m = /^([0-9a-f]{64})\s+resources\/js\/neutralino\.js\s*$/.exec(line.trim());
      if (m) pin = m[1];
    }
  } catch { /* handled below */ }
  if (!pin) return { ok: false, why: "no pin found in vela-neutralino/checksums/clientlib-v6.9.0.sha256" };
  const src = fs.readFileSync(file);
  const sha = nodeCrypto.createHash("sha256").update(src).digest("hex");
  if (sha !== pin) return { ok: false, why: "SHA256 of neutralino.js does not match the pin" };
  return { ok: true, src: src.toString("utf8") };
}

// ── Environment: one vm context per test ──
const FakeCrypto = {
  getRandomValues(arr) { for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256); return arr; },
  randomUUID: () => nodeCrypto.randomUUID(),
};

function makeEnv(opts = {}) {
  const clock = makeClock();
  const rt = new FakeRuntime(clock, opts.rt);
  const doc = makeDoc();
  const consoleLog = [];
  const et = new EventTarget();
  const listenerSets = new Map(); // type → Set of functions (same de-duplication as the DOM)
  const store = new Map();
  class FakeDate extends Date {
    constructor(...a) { if (a.length === 0) super(clock.now()); else super(...a); }
    static now() { return clock.now(); }
  }
  const sandbox = {
    addEventListener: (t, f, ...r) => {
      if (typeof f === "function") { if (!listenerSets.has(t)) listenerSets.set(t, new Set()); listenerSets.get(t).add(f); }
      return et.addEventListener(t, f, ...r);
    },
    removeEventListener: (t, f, ...r) => { if (listenerSets.has(t)) listenerSets.get(t).delete(f); return et.removeEventListener(t, f, ...r); },
    dispatchEvent: (e) => et.dispatchEvent(e),
    CustomEvent, Event, EventTarget,
    crypto: FakeCrypto,
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    },
    location: { hostname: "127.0.0.1" },
    NL_PORT: PORT,
    NL_TOKEN: TOKEN,
    NL_ARGS: [],
    NL_EXTENABLED: false,
    // The runtime sets NL_MODE; the shipped config uses "window". nl-socket.js
    // installs its hook only in that mode.
    NL_MODE: opts.nlMode !== undefined ? opts.nlMode : "window",
    document: doc,
    console: makeConsole(consoleLog),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    Date: FakeDate,
    TextEncoder, TextDecoder, Buffer, URL, URLSearchParams,
    WebSocket: rt.WebSocket,
    // fs-guard is a pass-through stub: deck-io's import is stripped.
    fsGuard: { allow() {}, install() {}, roots() { return []; } },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);

  const env = {
    clock, rt, doc, win: sandbox, consoleLog,
    statuses: [],   // every status given to onSaveStatus
    loaded: [],     // every deck given to onDeckLoaded: { deck, path, meta }
    conflicts: [],  // names given to the conflict handler (when it exists)
    mods: {},
    now: () => clock.now(),
    listeners: (type) => (listenerSets.has(type) ? listenerSets.get(type).size : 0),
    run(code, filename) { return vm.runInContext(code, sandbox, { filename }); },
    loadClient(kind) {
      if (kind === "model") {
        env.run(`var Neutralino = (${modelClientFactory.toString()})();`, "model-client.js");
      } else {
        const info = realClientInfo();
        if (!info.ok) throw new Error("real client unavailable: " + info.why);
        env.run(info.src, "neutralino.js");
      }
    },
    // Load a real source module. Throws a clear text when the file is missing.
    loadModule(file, names) {
      const p = path.join(JS_DIR, file);
      if (!fs.existsSync(p)) throw new Error(`MISSING MODULE vela-neutralino/resources/js/${file} (not implemented yet)`);
      const body = stripEsm(fs.readFileSync(p, "utf8"));
      const pick = names.map((n) => `try{__o[${JSON.stringify(n)}]=${n}}catch(e){}`).join(";");
      return env.run(`(function(){"use strict";var __o={};\n${body}\n;${pick};return __o;})()`, file);
    },
    async advance(ms) {
      const target = clock.now() + ms;
      await flush();
      for (;;) {
        const t = clock.nextDue(target);
        if (!t) break;
        clock.fire(t);
        await flush();
      }
      clock.setNow(Math.max(clock.now(), target));
      await flush();
    },
    // Run timers until pred() is true, or throw after maxMs of fake time.
    async until(pred, maxMs, label) {
      const limit = clock.now() + maxMs;
      await flush();
      while (!pred()) {
        const t = clock.nextDue(limit);
        if (!t) {
          clock.setNow(Math.max(clock.now(), limit));
          await flush();
          if (pred()) return;
          throw new Error(`timeout after ${maxMs} ms waiting for: ${label || "condition"} | ${env.describe()}`);
        }
        clock.fire(t);
        await flush();
      }
    },
    // Machine sleeps: the clock jumps and no timer runs. Then due timers run.
    async suspend(ms) { clock.jump(ms); await env.advance(0); },
    // Drive timers until a promise settles; return its value or throw.
    async drive(p, maxMs = 60000, label = "promise") {
      let done = false, val, err, failed = false;
      Promise.resolve(p).then((v) => { done = true; val = v; }, (e) => { done = true; failed = true; err = e; });
      await env.until(() => done, maxMs, label);
      if (failed) throw err;
      return val;
    },
    fireWin(type) { sandbox.dispatchEvent(new Event(type)); },
    setVisibility(v) { doc.visibilityState = v; doc.fire("visibilitychange"); },
    wipes: () => doc.wipes,
    lastStatus: () => (env.statuses.length ? env.statuses[env.statuses.length - 1].state : null),
    statusNames: () => env.statuses.map((s) => s.state),
    disk: (p) => rt.disk(p),
    describe() {
      return `statuses=[${env.statusNames().slice(-8).join(",")}] opened=${rt.opened} attempts=${rt.attempts} wipes=${doc.wipes} sock=${env.sock ? env.sock.state() : "none"} fakeNow=+${clock.now() - CLOCK_START}ms`;
    },
  };
  return env;
}

// ── Deck helpers ──
function mkDeck(title) {
  return { deckTitle: title, lanes: [{ items: [{ slides: [{ blocks: [{ type: "text", text: "body of " + title }] }] }] }] };
}
const textOf = (deck) => JSON.stringify(deck, null, 2);

// Boot without deck-io: only the client and the fake runtime (control tests).
async function bootBare(kind, opts = {}) {
  const env = makeEnv(opts);
  env.loadClient(kind);
  env.win.Neutralino.init();
  await env.advance(10);
  return env;
}

// Boot as nl-boot.js does. opts.sock=false → the old boot (no nl-socket.js).
// opts.deck → initial deck on disk (default "Initial").
async function boot(kind, opts = {}) {
  const useSock = opts.sock !== undefined ? opts.sock : !BASELINE;
  const env = makeEnv(opts);
  const initial = opts.deck || mkDeck("Initial");
  env.initialDeck = initial;
  env.deckPath = opts.deckPath || DECK_PATH;
  env.rt.files.set(env.deckPath, textOf(initial));
  env.loadClient(kind);
  const OrigWS = env.win.WebSocket;
  let sockMod = null;
  if (useSock) {
    sockMod = env.loadModule("nl-socket.js", ["createNlSocket", "createResumeWatch"]);
    assert(typeof sockMod.createNlSocket === "function", "nl-socket.js does not export createNlSocket");
    env.sock = sockMod.createNlSocket({ win: env.win, setTimeout: env.win.setTimeout, clearTimeout: env.win.clearTimeout });
    env.sock.install();
  }
  try { env.win.Neutralino.init(); } finally { if (env.sock) env.sock.restore(); }
  if (env.sock && opts.checkRestore !== false) {
    assert(env.win.WebSocket === OrigWS, "WebSocket hook is still installed after init (restore missing)");
  }
  await env.advance(10); // the first connection opens, the client sends "ready"

  const dm = env.loadModule("deck-io.js", ["deckIO", "state", "flushSave", "flushNow", "onWatchEvent", "saveCurrent", "sigOf", "byteLen", "MAX_DECK_BYTES", "RESYNC_QUIET_MS"]);
  env.deckIO = dm.deckIO;
  env.deckState = dm.state;
  env.deckMod = dm;
  const N = () => env.win.Neutralino;
  let watch = null;
  if (env.sock) {
    assert(typeof sockMod.createResumeWatch === "function", "nl-socket.js does not export createResumeWatch");
    watch = sockMod.createResumeWatch({
      sock: env.sock,
      // Same heartbeat as nl-boot.js: an in-memory native call, no disk access.
      heartbeat: () => N().extensions.getStats(),
      onResume: () => env.deckIO.resync(),
      win: env.win,
      setTimeout: env.win.setTimeout, clearTimeout: env.win.clearTimeout,
      setInterval: env.win.setInterval, clearInterval: env.win.clearInterval,
    });
    env.watch = watch;
    watch.start();
    assert(typeof env.deckIO.attachConnection === "function", "deckIO.attachConnection is missing");
    env.deckIO.attachConnection({
      state: env.sock.state, epoch: env.sock.epoch, onChange: env.sock.onChange,
      suspect: () => watch.signal("suspect"),
    });
  }
  // Same wiring as nl-boot.js: the conflict dialog opens on onConflict and
  // closes on onConflictCleared (deck switch, new deck, new folder).
  env.conflictsCleared = 0;
  if (typeof env.deckIO.onConflict === "function") {
    env.deckIO.onConflict((name) => { env.conflicts.push(name); });
  }
  if (typeof env.deckIO.onConflictCleared === "function") {
    env.deckIO.onConflictCleared(() => { env.conflictsCleared++; });
  }
  // nl-boot.js returns false for an external load while the app is not mounted
  // (window.__velaReceiveDeckUpdate is missing). env.appMounted = false models that.
  env.appMounted = true;
  env.refused = [];
  env.deckIO.onDeckLoaded((deck, p, meta) => {
    meta = meta || {};
    if (meta.external && !env.appMounted) { env.refused.push({ deck, path: p, meta }); return false; }
    env.loaded.push({ deck, path: p, meta });
    return true;
  });
  env.deckIO.onSaveStatus((s) => { env.statuses.push(s); });
  await env.drive(env.deckIO.initWithFile(env.deckPath), 5000, "initWithFile");
  await env.drive(env.deckIO.openDeck(env.deckPath), 5000, "openDeck");
  // nl-boot.js calls setAppReady() after loadVela(). opts.appReady=false stops
  // before that point (the Babel transpile is still running).
  if (opts.appReady !== false && typeof env.deckIO.setAppReady === "function") env.deckIO.setAppReady();
  env.statuses.length = 0;
  // The app edits the deck: returns a promise that settles when saveCurrent settles.
  env.edit = (deck) => {
    const rec = { deck, result: undefined, settled: false };
    env.deckIO.saveCurrent(deck).then((v) => { rec.result = v; rec.settled = true; });
    return rec;
  };
  env.diskIs = (deck) => env.rt.disk(env.deckPath) === textOf(deck);
  env.externalLoads = () => env.loaded.filter((l) => l.meta && l.meta.external);
  return env;
}

// Never log or show a token (no URL or token in the console).
function assertNoSecrets(env) {
  const hit = env.consoleLog.find((l) => l.includes(MARKER) || l.includes(ACCESS) || l.includes("connectToken"));
  assert(!hit, "console output holds a token or connect URL: " + String(hit).slice(0, 80));
}
function assertClean(env) {
  assertNoSecrets(env);
  assert(env.rt.listenerErrors.length === 0, "a client listener threw: " + env.rt.listenerErrors[0]);
}

// ── Registry ──
const REAL = realClientInfo();
const TIERS = [{ id: "T1 model", kind: "model" }];
if (REAL.ok) TIERS.push({ id: "T2 real", kind: "real" });
const SCENARIOS = [];
function scenario(name, fn, o = {}) { SCENARIOS.push({ name, fn, ...o }); }

// ═══════════ Control tests: these pass with the CURRENT code ═══════════

scenario("C1 control: client and fake runtime round trip (write, read, stats, storage)", async (kind) => {
  const env = await bootBare(kind);
  const N = env.win.Neutralino;
  await env.drive(N.filesystem.writeFile("/decks/c1.vela", "héllo"));
  assert(env.rt.files.get("/decks/c1.vela") === "héllo", "file not written");
  assert((await env.drive(N.filesystem.readFile("/decks/c1.vela"))) === "héllo", "readFile mismatch");
  const st = await env.drive(N.filesystem.getStats("/decks/c1.vela"));
  assert(st.size === Buffer.byteLength("héllo"), "getStats size mismatch: " + JSON.stringify(st));
  await env.drive(N.storage.setData("k", "v"));
  assert((await env.drive(N.storage.getData("k"))) === "v", "storage mismatch");
  // Frame format nl-socket.js relies on: id is the FIRST key, a lowercase uuid v4.
  const f = env.rt.frames.find((x) => x.includes("filesystem.writeFile"));
  assert(new RegExp(`^\\{"id":"${UUID_RE}","method":"filesystem\\.writeFile"`).test(f), "unexpected frame shape: " + String(f).slice(0, 90));
  assert(env.rt.opened === 1, "expected one connection, got " + env.rt.opened);
  assertClean(env);
});

scenario("C2 control: an error on the FIRST connection wipes the page (client error page)", async (kind) => {
  const env = makeEnv();
  env.rt.setMode("down");
  env.loadClient(kind);
  env.win.Neutralino.init();
  await env.advance(50);
  assert(env.wipes() >= 1, "page was not wiped on first-connection error");
});

scenario("C3 control: invalid access token closes the socket and wipes the page", async (kind) => {
  const env = makeEnv({ rt: { expectAccess: "OTHER-ACCESS" } });
  env.rt.token = "OTHER-FULL-TOKEN";
  env.loadClient(kind);
  env.win.Neutralino.init();
  await env.advance(10);
  let code = null;
  await env.drive(env.win.Neutralino.storage.getKeys().catch((e) => { code = e && e.code; }));
  await env.advance(20);
  assert(code === "NE_RT_INVTOKN", "expected NE_RT_INVTOKN, got " + code);
  assert(env.wipes() >= 1, "page not wiped on invalid token");
  assert(env.rt.sockets[0].readyState === 3, "socket not closed after invalid token");
});

scenario("C4 control: calls made before the socket opens are queued and run in order", async (kind) => {
  const env = makeEnv();
  env.loadClient(kind);
  env.win.Neutralino.init();
  const N = env.win.Neutralino, order = [];
  const ps = [
    N.storage.setData("a", "1").then(() => order.push("a")),
    N.storage.setData("b", "2").then(() => order.push("b")),
    N.storage.setData("c", "3").then(() => order.push("c")),
  ];
  assert(env.rt.frames.length === 0, "a call was sent before the socket opened");
  await env.drive(Promise.all(ps));
  assert(order.join("") === "abc", "queue order wrong: " + order.join(""));
  assert(env.rt.frames.length === 3, "frame count " + env.rt.frames.length);
});

scenario("C5 control: a call sent on a socket that later closes never settles", async (kind) => {
  const env = await bootBare(kind);
  env.rt.setMode("frozen");
  let settled = false;
  env.win.Neutralino.filesystem.writeFile("/decks/c5.vela", "x").then(() => { settled = true; }, () => { settled = true; });
  env.rt.drop();
  await env.advance(60000);
  assert(!settled, "the in-flight call settled (the client does not reject on close)");
  assert(!env.rt.files.has("/decks/c5.vela"), "a dead socket wrote a file");
});

scenario("C6 control: events.on listeners get watcher events; one function is added once", async (kind) => {
  const env = await bootBare(kind);
  const N = env.win.Neutralino;
  const got = [];
  const fn = (e) => got.push(e.detail);
  await env.drive(N.filesystem.createWatcher(DECK_DIR));
  await N.events.on("watchFile", fn);
  await N.events.on("watchFile", fn); // same reference: the DOM adds it once
  env.rt.externalWrite(DECK_PATH, "{}");
  await env.advance(20);
  assert(got.length === 1, "expected 1 event, got " + got.length);
  assert(got[0].filename === "a.vela" && got[0].dir === DECK_DIR, "event detail wrong: " + JSON.stringify(got[0]));
  await N.events.off("watchFile", fn);
  env.rt.externalWrite(DECK_PATH, "{ }");
  await env.advance(20);
  assert(got.length === 1, "listener still called after off");
});

scenario("C7 control: deck-io saves on a healthy runtime (no nl-socket)", async (kind) => {
  const env = await boot(kind, { sock: false });
  const d = mkDeck("C7 edit");
  const rec = env.edit(d);
  await env.until(() => env.diskIs(d) && env.lastStatus() === "saved", 5000, "edit on disk and status saved");
  assert(rec.settled && rec.result === true, "saveCurrent promise did not settle true");
  assert(env.loaded.length === 1 && env.loaded[0].meta.external !== true, "unexpected external load");
  assert(env.wipes() === 0, "page wiped");
  assertClean(env);
});

// ═══════════ Reproduction cases (the failures before the reconnect layer) ═══════════

scenario("R1 socket closes, user edits, runtime reachable: edit on disk and status saved in 10 s", async (kind) => {
  const env = await boot(kind);
  env.rt.drop();
  await env.advance(5);
  const d = mkDeck("R1 edit after drop");
  const t0 = env.now();
  const rec = env.edit(d);
  await env.until(() => env.diskIs(d) && env.lastStatus() === "saved", 10000, "edit on disk and status saved");
  assert(env.now() - t0 <= 10000, "took " + (env.now() - t0) + " ms");
  assert(rec.settled && rec.result === true, "saveCurrent promise did not settle true");
  assert(env.rt.disk() === textOf(d), "disk bytes differ from the edit");
  assert(env.loaded.length === 1, "the app received a deck it must not receive: " + env.loaded.length);
  assert(env.wipes() === 0, "page wiped " + env.wipes() + " time(s)");
  assertClean(env);
});

scenario("R1b socket closes, runtime down 3 s, then back: the edit is saved within 10 s of the return", async (kind) => {
  const env = await boot(kind);
  env.rt.setMode("down");
  await env.advance(5);
  const d = mkDeck("R1b edit during outage");
  env.edit(d);
  await env.advance(3000);
  assert(env.rt.disk() === textOf(env.initialDeck), "disk changed while the runtime was down");
  assert(!env.statusNames().includes("failed"), "status failed during a short outage: " + env.statusNames());
  env.rt.setMode("up");
  const t0 = env.now();
  await env.until(() => env.diskIs(d) && env.lastStatus() === "saved", 10000, "edit on disk and status saved");
  assert(env.now() - t0 <= 10000, "took " + (env.now() - t0) + " ms after the runtime returned");
  assert(env.wipes() === 0, "page wiped");
  assertClean(env);
});

scenario("R2 three writes time out on a stuck socket; the runtime answers on a new socket; next save succeeds", async (kind) => {
  const env = await boot(kind);
  env.rt.setMode("frozen");
  for (let i = 1; i <= 3; i++) {
    env.edit(mkDeck("R2 stuck write " + i));
    await env.advance(17000); // longer than the 15 s native call timeout
  }
  assert(env.rt.disk() === textOf(env.initialDeck), "a dead socket wrote to disk");
  env.rt.setMode("up");
  const good = mkDeck("R2 write after recovery");
  const rec = env.edit(good);
  await env.until(() => env.diskIs(good) && env.lastStatus() === "saved", 30000, "recovery save on disk and status saved");
  await env.advance(20000); // a late stray must not put older bytes back
  assert(env.rt.disk() === textOf(good), "disk does not hold the newest deck at the end");
  assert(rec.settled && rec.result === true, "saveCurrent promise did not settle true");
  assert(env.lastStatus() === "saved", "final status is " + env.lastStatus());
  assert(env.wipes() === 0, "page wiped");
  assertClean(env);
});

scenario("R3 file changes on disk while the socket is down: the app gets it after reconnect", async (kind) => {
  const env = await boot(kind);
  await env.advance(1000);
  env.rt.setMode("down");
  await env.advance(50);
  const ext = mkDeck("R3 external edit");
  env.rt.externalWrite(DECK_PATH, textOf(ext)); // the watch event goes nowhere: no socket
  await env.advance(1000);
  assert(env.externalLoads().length === 0, "the app got the file while the socket was down");
  env.rt.setMode("up");
  await env.until(() => env.externalLoads().length >= 1, 15000, "app receives the external deck");
  await env.advance(3000);
  const loads = env.externalLoads();
  assert(loads.length === 1, "app got " + loads.length + " external loads, expected 1");
  assert(JSON.stringify(loads[0].deck) === JSON.stringify(ext), "deck given to the app differs from the file");
  assert(loads[0].path === DECK_PATH, "wrong path");
  assert(env.rt.disk() === textOf(ext), "disk bytes changed (the shell must not write)");
  assert(!env.statusNames().includes("failed"), "status failed: " + env.statusNames());
  assert(env.wipes() === 0, "page wiped");
  assertClean(env);
});

scenario("R4a socket open but dead; the machine wakes (clock drift > 20 s): heartbeat times out, reconnect, recovery", async (kind) => {
  const env = await boot(kind);
  env.rt.setMode("frozen"); // the old socket is dead for good
  await env.suspend(30000); // no timer ticked for 30 s: a resume
  env.rt.setMode("up");     // the runtime answers on a new socket
  await env.until(() => env.rt.opened >= 2, 30000, "a second connection opens"); // heartbeat bound 20 s
  assert(env.rt.opened === 2, "expected exactly one reconnect, got " + (env.rt.opened - 1));
  const d = mkDeck("R4a edit after wake");
  const rec = env.edit(d);
  await env.until(() => env.diskIs(d) && env.lastStatus() === "saved", 10000, "edit on disk and status saved");
  assert(rec.settled && rec.result === true, "saveCurrent promise did not settle true");
  assert(env.wipes() === 0, "page wiped");
  assertClean(env);
});

scenario("R4b socket open but dead; window focus: heartbeat times out, reconnect, recovery", async (kind) => {
  const env = await boot(kind);
  env.rt.setMode("frozen");
  env.rt.setMode("up");
  env.fireWin("focus");
  await env.until(() => env.rt.opened >= 2, 30000, "a second connection opens"); // heartbeat bound 20 s
  assert(env.rt.opened === 2, "expected exactly one reconnect, got " + (env.rt.opened - 1));
  const d = mkDeck("R4b edit after focus");
  const rec = env.edit(d);
  await env.until(() => env.diskIs(d) && env.lastStatus() === "saved", 10000, "edit on disk and status saved");
  assert(rec.settled && rec.result === true, "saveCurrent promise did not settle true");
  assert(env.wipes() === 0, "page wiped");
  assertClean(env);
});

scenario("R5 a socket error after a good connection does not wipe the page", async (kind) => {
  const env = await boot(kind);
  assert(env.wipes() === 0, "page wiped before the error");
  env.rt.injectError();
  await env.advance(100);
  assert(env.wipes() === 0, "page wiped " + env.wipes() + " time(s) after a socket error");
  const d = mkDeck("R5 edit after error");
  env.edit(d);
  await env.until(() => env.diskIs(d) && env.lastStatus() === "saved", 10000, "edit on disk and status saved");
  assert(env.wipes() === 0, "page wiped");
  assertClean(env);
});

// ═══════════ Regression cases: behaviour through the real modules ═══════════

const SYNC_MODULES = ["createNlSocket", "createResumeWatch"];
const clone = (o) => JSON.parse(JSON.stringify(o));
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isCopyPath = (p) => /\.conflict-/.test(p);
const copiesOf = (env) => [...env.rt.files.entries()].filter(([p]) => isCopyPath(p)).map(([p, data]) => ({ path: p, data }));
const writesTo = (env, p) => env.rt.writeLog.filter((w) => w.path === p);

// Both sides changed: the app has an unsaved edit, the file changed on disk, and the
// socket was down while it happened. Resolves when the conflict handler has run.
async function makeConflict(env, mine, extText) {
  env.rt.setMode("down");
  await env.advance(50);
  const rec = env.edit(mine);
  await env.advance(1000);
  env.rt.externalWrite(env.deckPath, extText);
  env.rt.setMode("up");
  await env.until(() => env.conflicts.length >= 1, 30000, "conflict handler call");
  await env.advance(100);
  assert(env.deckState.paused === true, "deck-io is not paused at a conflict");
  assert(env.lastStatus() === "failed", "status at a conflict is " + env.lastStatus());
  return rec;
}
const resolveC = (env, choice) => env.drive(env.deckIO.resolveConflict(choice), 30000, "resolveConflict " + choice);

scenario("G1 three drops in a row: every edit lands, one reconnect per drop", async (kind) => {
  const env = await boot(kind);
  for (let i = 1; i <= 3; i++) {
    env.rt.drop();
    await env.advance(5);
    const d = mkDeck("G1 edit " + i);
    const rec = env.edit(d);
    await env.until(() => env.diskIs(d) && env.lastStatus() === "saved" && rec.settled, 15000, "edit " + i + " on disk and saved");
    assert(rec.result === true, "saveCurrent did not settle true in cycle " + i);
    await env.advance(2000);
  }
  assert(env.rt.opened === 4, "expected 4 connections, got " + env.rt.opened);
  assert(env.externalLoads().length === 0, "the app got a deck it must not get");
  assert(env.wipes() === 0, "page wiped");
  assertClean(env);
});

scenario("G1b three times: edit, then the socket drops at once (inside the save debounce)", async (kind) => {
  const env = await boot(kind);
  for (let i = 1; i <= 3; i++) {
    const d = mkDeck("G1b edit " + i);
    const rec = env.edit(d);
    env.rt.drop();
    await env.until(() => env.diskIs(d) && env.lastStatus() === "saved" && rec.settled, 20000, "edit " + i + " on disk and saved");
    assert(rec.result === true, "saveCurrent did not settle true in cycle " + i);
    await env.advance(2000);
  }
  assert(env.externalLoads().length === 0, "the app got a deck it must not get");
  assert(env.wipes() === 0, "page wiped");
  assertClean(env);
});

scenario("G2 a write that the runtime applies late never leaves older bytes after a newer save (watcher event)", async (kind) => {
  const env = await boot(kind);
  await env.advance(1000);
  const A = mkDeck("G2 older"), B = mkDeck("G2 newer");
  env.rt.holdWrites = true;
  env.edit(A);
  await env.advance(400);
  assert(env.rt.held.length === 1, "the write of A was not sent before the drop");
  env.rt.drop();
  await env.advance(5);
  env.rt.holdWrites = false;
  await env.until(() => env.sock.state() === "connected", 15000, "reconnect");
  const recB = env.edit(B);
  await env.until(() => env.diskIs(B) && env.lastStatus() === "saved" && recB.settled, 20000, "B on disk");
  assert(recB.result === true, "the newer save did not resolve true");
  await env.advance(1500);
  assert(env.rt.releaseHeld(true) === 1, "no held write to release");
  assert(env.rt.disk() === textOf(A), "test set-up: the late write did not land");
  await env.advance(5000);
  assert(env.diskIs(B), "older bytes stayed on disk after the newer save resolved true");
  assert(env.externalLoads().length === 0, "the app got our own old bytes as an external change");
  assert(env.lastStatus() !== "failed", "status " + env.lastStatus());
  assertClean(env);
});

scenario("G2b same case, but the late write gives no watcher event: the next resync repairs it", async (kind) => {
  const env = await boot(kind);
  await env.advance(1000);
  const A = mkDeck("G2b older"), B = mkDeck("G2b newer");
  env.rt.holdWrites = true;
  env.edit(A);
  await env.advance(400);
  env.rt.drop();
  await env.advance(5);
  env.rt.holdWrites = false;
  await env.until(() => env.sock.state() === "connected", 15000, "reconnect");
  const recB = env.edit(B);
  await env.until(() => env.diskIs(B) && env.lastStatus() === "saved" && recB.settled, 20000, "B on disk");
  await env.advance(1500);
  env.rt.releaseHeld(false);
  assert(env.rt.disk() === textOf(A), "test set-up: the late write did not land");
  env.fireWin("online"); // a resume signal: heartbeat, then resync
  await env.until(() => env.diskIs(B), 20000, "resync puts the newer bytes back");
  await env.advance(3000);
  assert(env.diskIs(B), "older bytes stayed on disk");
  assert(env.externalLoads().length === 0, "the app got our own old bytes");
  assertClean(env);
});

scenario("G2d a retired stray is forgotten after its time limit: a later outside write of the same bytes is loaded", async (kind) => {
  const env = await boot(kind);
  await env.advance(1000);
  const A = mkDeck("V4 older"), B = mkDeck("V4 newer");
  env.rt.holdWrites = true;
  env.edit(A);
  // The write of A times out on a live socket (a stray), then the socket drops.
  await env.advance(16000);
  assert(env.rt.held.length >= 1 && env.deckState.strays.length >= 1, "test set-up: no stray write of A");
  env.rt.drop();
  await env.advance(5);
  env.rt.holdWrites = false;
  await env.until(() => env.sock.state() === "connected", 15000, "reconnect");
  const recB = env.edit(B);
  await env.until(() => env.diskIs(B) && env.lastStatus() === "saved" && recB.settled, 40000, "B on disk");
  await env.advance(30000);
  env.rt.held.length = 0; // the old write never lands
  // Later than the time limit, the user restores the older bytes (for example
  // from a conflict copy). This is an outside change: the app must get it.
  await env.advance(11 * 60 * 1000);
  env.rt.externalWrite(env.deckPath, textOf(A));
  await env.advance(5000);
  const loads = env.externalLoads();
  assert(loads.length === 1 && JSON.stringify(loads[0].deck) === JSON.stringify(A), "the outside write of the old bytes was not loaded (" + loads.length + ")");
  assert(env.diskIs(A), "the outside write was replaced on disk");
  assert(env.deckState.strays.length === 0, "a retired stray is still kept after the time limit");
  assertClean(env);
});

scenario("G2c two edits queued during an outage: the older one is never written after the newer", async (kind) => {
  const env = await boot(kind);
  const A = mkDeck("G2c older"), B = mkDeck("G2c newer");
  env.rt.setMode("down");
  await env.advance(50);
  const recA = env.edit(A);
  await env.advance(1500);
  const recB = env.edit(B);
  await env.advance(1500);
  env.rt.setMode("up");
  await env.until(() => env.diskIs(B) && env.lastStatus() === "saved" && recB.settled, 30000, "B on disk");
  await env.advance(5000);
  assert(recB.result === true, "newer save did not resolve true");
  assert(recA.settled && recA.result === false, "the superseded save must settle false");
  assert(!writesTo(env, DECK_PATH).some((w) => w.data === textOf(A)), "the older deck was written");
  assert(env.diskIs(B), "disk does not hold the newer deck");
  assertClean(env);
});

scenario("G3 edit, then undo, across a drop: the disk ends with the undone deck", async (kind) => {
  const env = await boot(kind);
  const base = clone(env.initialDeck);
  const d1 = mkDeck("G3 edit");
  const rec1 = env.edit(d1);
  await env.until(() => env.diskIs(d1) && rec1.settled, 5000, "edit on disk");
  // Undo after the drop.
  env.rt.drop();
  await env.advance(5);
  const undone = clone(base);
  const rec2 = env.edit(undone);
  await env.until(() => env.diskIs(undone) && env.lastStatus() === "saved" && rec2.settled, 20000, "undone deck on disk");
  assert(rec2.result === true, "the undo save did not resolve true");
  await env.advance(3000);
  assert(env.diskIs(undone), "disk is not the undone deck");
  // Edit and undo both made during the outage: only the last one counts.
  env.rt.setMode("down");
  await env.advance(50);
  env.edit(mkDeck("G3 second edit"));
  await env.advance(1000);
  const undone2 = clone(base);
  const rec3 = env.edit(undone2);
  await env.advance(1000);
  env.rt.setMode("up");
  await env.until(() => env.diskIs(undone2) && env.lastStatus() === "saved" && rec3.settled, 30000, "second undo on disk");
  await env.advance(3000);
  assert(env.diskIs(undone2), "disk is not the second undone deck");
  assert(!writesTo(env, DECK_PATH).some((w) => w.data.includes("G3 second edit")), "the discarded edit was written");
  assert(env.externalLoads().length === 0, "the app got a deck it must not get");
  assertClean(env);
});

scenario("[rev V9][fix B13] G4 openDeck during a drop: refused while the edit is held, then the old deck is never written into the new file", async (kind) => {
  const env = await boot(kind);
  const other = mkDeck("G4 other deck"), OTHER = "/decks/b.vela";
  env.rt.files.set(OTHER, textOf(other));
  env.rt.setMode("down");
  await env.advance(50);
  const edit = mkDeck("G4 edit of the old deck");
  const rec = env.edit(edit);
  await env.advance(1000); // the save is held by the gate
  // V9: a switch now would drop an edit the user never saw fail. It is refused.
  let refused = null;
  try { await env.drive(env.deckIO.openDeck(OTHER), 5000, "openDeck while held"); } catch (e) { refused = e; }
  assert(refused && refused.code === "VELA_SAVE_HELD", "openDeck while the edit is held was not refused: " + (refused && refused.code));
  assert(refused.message === "Unsaved changes are waiting to save", "refusal text " + JSON.stringify(refused.message));
  assert(env.deckIO.currentPath() === DECK_PATH, "current path moved: " + env.deckIO.currentPath());
  assert(env.deckState.pendingDeck === edit, "the held edit was dropped");
  // The socket comes back: the held edit lands in the OLD file.
  env.rt.setMode("up");
  await env.until(() => env.diskIs(edit) && rec.settled, 30000, "held edit lands in the old file");
  assert(rec.result === true, "the held save did not settle true");
  // Now the switch runs. The app still holds the old deck: its debounced
  // autosave fires while the switch runs and must be dropped.
  let stale = null;
  env.deckIO.onDeckLoaded((deck, path, meta) => {
    env.loaded.push({ deck, path, meta: meta || {} });
    stale = env.edit(mkDeck("G4 stale autosave of the old deck"));
    return true;
  });
  await env.drive(env.deckIO.openDeck(OTHER), 10000, "openDeck");
  await env.advance(3000);
  assert(stale && stale.settled && stale.result === false, "the stale autosave during the switch was not dropped");
  assert(!env.rt.writeLog.some((w) => w.data.includes("G4 stale autosave")), "the stale autosave was written");
  assert(env.deckIO.currentPath() === OTHER, "current path is " + env.deckIO.currentPath());
  assert(env.rt.disk(OTHER) === textOf(other), "the new file changed");
  assert(writesTo(env, OTHER).length === 0, "something was written into the new file");
  // A new edit goes to the new file.
  const d = mkDeck("G4 edit after the switch");
  const rec2 = env.edit(d);
  await env.until(() => env.rt.disk(OTHER) === textOf(d) && rec2.settled, 15000, "edit lands in the new file");
  assert(env.diskIs(edit), "the first file changed after the switch");
  assertClean(env);
});

scenario("[rev V9][fix B13] G4b newDeck during a drop: refused while the edit is held, then the old deck is never written into the new file", async (kind) => {
  const env = await boot(kind);
  env.rt.setMode("down");
  await env.advance(50);
  const edit = mkDeck("G4b edit of the old deck");
  const rec = env.edit(edit);
  await env.advance(1000);
  // V9: newDeck keeps its failure contract (null) and creates no file.
  const refused = await env.drive(env.deckIO.newDeck("G4b New"), 5000, "newDeck while held");
  assert(refused === null, "newDeck while the edit is held returned " + refused);
  assert(env.deckIO.currentPath() === DECK_PATH, "current path moved: " + env.deckIO.currentPath());
  assert(env.deckState.pendingDeck === edit, "the held edit was dropped");
  env.rt.setMode("up");
  await env.until(() => env.diskIs(edit) && rec.settled, 30000, "held edit lands in the old file");
  assert(rec.result === true, "the held save did not settle true");
  assert(![...env.rt.files.keys()].some((k) => /G4b New/i.test(k)), "the refused newDeck created a file");
  const newPath = await env.drive(env.deckIO.newDeck("G4b New"), 10000, "newDeck");
  await env.advance(3000);
  assert(newPath && newPath !== DECK_PATH, "newDeck returned " + newPath);
  assert(env.deckIO.currentPath() === newPath, "current path is " + env.deckIO.currentPath());
  assert(env.rt.disk(newPath) === JSON.stringify({ deckTitle: "G4b New", lanes: [] }, null, 2), "the new file does not hold the blank deck");
  assert(!writesTo(env, newPath).some((w) => w.data.includes("G4b edit of the old deck")), "the old edit was written into the new file");
  const d = mkDeck("G4b edit after the switch");
  const rec2 = env.edit(d);
  await env.until(() => env.rt.disk(newPath) === textOf(d) && rec2.settled, 15000, "edit lands in the new file");
  assert(env.diskIs(edit), "the first file changed after the switch");
  assertClean(env);
});

scenario("G5 conflict, choice \"mine\": the file version is kept as a copy, the deck file gets the Vela version", async (kind) => {
  const env = await boot(kind);
  const mine = mkDeck("G5 mine"), ext = mkDeck("G5 theirs");
  const extText = JSON.stringify(ext); // other bytes than our pretty text: the copy must be exact
  const rec = await makeConflict(env, mine, extText);
  assert(env.conflicts.length === 1 && env.conflicts[0] === "a.vela", "conflict handler got " + JSON.stringify(env.conflicts));
  assert(env.rt.disk() === extText, "the deck file changed before the choice");
  assert(env.externalLoads().length === 0, "the app got the file version before the choice");
  assert(!rec.settled, "the save settled before the choice");
  assert((await resolveC(env, "mine")) === true, "resolveConflict(mine) did not return true");
  await env.advance(2000);
  const copies = copiesOf(env);
  assert(copies.length === 1, "expected 1 copy, got " + copies.length);
  assert(new RegExp("^/decks/a\\.conflict-\\d{8}-\\d{6}(-\\d+)?\\.vela$").test(copies[0].path), "copy name " + copies[0].path);
  assert(copies[0].data === extText, "the copy does not hold the exact file bytes");
  assert(env.diskIs(mine), "the deck file does not hold the Vela version");
  assert(env.externalLoads().length === 0, "the app got a deck it must not get");
  assert(rec.settled && rec.result === true, "the save did not settle true");
  assert(env.deckState.paused === false && env.lastStatus() === "saved", "paused/status " + env.deckState.paused + "/" + env.lastStatus());
  const d = mkDeck("G5 edit after");
  const rec2 = env.edit(d);
  await env.until(() => env.diskIs(d) && rec2.settled, 10000, "later edit saves");
  assertClean(env);
});

scenario("G5b conflict, choice \"file\": the Vela version is kept as a copy, the app gets the file version", async (kind) => {
  const env = await boot(kind);
  const mine = mkDeck("G5b mine"), ext = mkDeck("G5b theirs");
  const extText = JSON.stringify(ext);
  const rec = await makeConflict(env, mine, extText);
  assert((await resolveC(env, "file")) === true, "resolveConflict(file) did not return true");
  await env.advance(2000);
  const copies = copiesOf(env);
  assert(copies.length === 1, "expected 1 copy, got " + copies.length);
  assert(copies[0].data === textOf(mine), "the copy does not hold the exact Vela bytes");
  assert(env.rt.disk() === extText, "the deck file changed (it must keep the file version)");
  const loads = env.externalLoads();
  assert(loads.length === 1 && JSON.stringify(loads[0].deck) === JSON.stringify(ext) && loads[0].path === DECK_PATH, "the app did not get the file deck: " + loads.length);
  assert(rec.settled && rec.result === false, "the dropped save must settle false");
  assert(writesTo(env, DECK_PATH).every((w) => w.data !== textOf(mine)), "the Vela version was written over the file");
  assert(env.deckState.paused === false && env.lastStatus() === "saved", "paused/status " + env.deckState.paused + "/" + env.lastStatus());
  // Later edits save normally, and a resync does not raise a second conflict.
  const d = mkDeck("G5b edit after");
  const rec2 = env.edit(d);
  await env.until(() => env.diskIs(d) && rec2.settled, 10000, "later edit saves");
  env.rt.drop();
  await env.advance(8000);
  assert(env.conflicts.length === 1, "a second conflict was raised: " + env.conflicts.length);
  assertClean(env);
});

scenario("G5d while a conflict is open: no save writes, no watcher event reloads; the choice then uses the newest versions", async (kind) => {
  const env = await boot(kind);
  const mine = mkDeck("G5d mine"), ext = mkDeck("G5d theirs");
  const extText = JSON.stringify(ext);
  await makeConflict(env, mine, extText);
  const writes0 = writesTo(env, DECK_PATH).length;
  // Retry, a newer edit and a newer external change while the dialog is open.
  await env.drive(env.deckIO.flushNow(), 10000, "Retry during a conflict");
  const mine2 = mkDeck("G5d mine newer");
  env.edit(mine2);
  await env.advance(3000);
  const ext2Text = JSON.stringify(mkDeck("G5d theirs newer"));
  env.rt.externalWrite(DECK_PATH, ext2Text);
  await env.advance(3000);
  assert(writesTo(env, DECK_PATH).length === writes0, "a save wrote to the deck file during the conflict");
  assert(env.rt.disk() === ext2Text, "the deck file changed during the conflict");
  assert(env.externalLoads().length === 0, "the app got the file deck during the conflict");
  assert(env.deckState.paused === true, "the pause ended by itself");
  assert((await resolveC(env, "mine")) === true, "resolve mine");
  const copies = copiesOf(env);
  assert(copies.length === 1 && copies[0].data === ext2Text, "the copy does not hold the newest file bytes");
  assert(env.diskIs(mine2), "the deck file does not hold the newest Vela version");
  assertClean(env);
});

scenario("G5c resolveConflict: bad choice, no open conflict, and a second call all return false", async (kind) => {
  const env = await boot(kind);
  assert((await resolveC(env, "mine")) === false, "no conflict open: must be false");
  for (const bad of ["", "MINE", "both", undefined, null, 1, {}, ["mine"]]) {
    assert((await resolveC(env, bad)) === false, "choice " + JSON.stringify(bad) + " must be false");
  }
  const mine = mkDeck("G5c mine");
  await makeConflict(env, mine, JSON.stringify(mkDeck("G5c theirs")));
  assert((await resolveC(env, "both")) === false, "bad choice at an open conflict must be false");
  assert(env.deckState.paused === true, "a bad choice ended the pause");
  assert((await resolveC(env, "mine")) === true, "mine");
  assert((await resolveC(env, "mine")) === false, "a second resolve must be false (conflict closed)");
  assert(copiesOf(env).length === 1, "second resolve made another copy");
  assertClean(env);
});

for (const choice of ["mine", "file"]) {
  scenario(`[rev V6][fix B10] G6 conflict \"${choice}\": copy write fails, then copy bytes differ: nothing replaced, still paused, both versions intact`, async (kind) => {
    const env = await boot(kind);
    const mine = mkDeck("G6 mine " + choice), ext = mkDeck("G6 theirs " + choice);
    const extText = JSON.stringify(ext);
    await makeConflict(env, mine, extText);
    const pendingObj = env.deckState.pendingDeck;
    const intact = (why) => {
      assert(env.deckState.paused === true, why + ": no longer paused");
      assert(env.rt.disk() === extText, why + ": the deck file changed");
      assert(env.deckState.pendingDeck === pendingObj && pendingObj === mine, why + ": the unsaved deck was lost");
      assert(env.externalLoads().length === 0, why + ": the app got the file deck");
      assert(writesTo(env, DECK_PATH).every((w) => w.data !== textOf(mine)), why + ": the Vela version was written over the file");
    };
    // 1) the copy cannot be written
    env.rt.writeFault = (p) => (isCopyPath(p) ? "fail" : null);
    assert((await resolveC(env, choice)) === false, "copy write failure must return false");
    assert(copiesOf(env).length === 0, "a copy exists although the write failed");
    intact("after write failure");
    // 2) the copy is written with other bytes (verify fails)
    env.rt.writeFault = (p) => (isCopyPath(p) ? "corrupt" : null);
    assert((await resolveC(env, choice)) === false, "copy mismatch must return false");
    // B10: after the failed attempt with the deck stem, one more attempt with the
    // short stem "deck". Both bad copies stay; neither replaced anything.
    const leftover = copiesOf(env);
    assert(leftover.length === 2, "expected the two bad copies to exist, got " + leftover.length);
    intact("after copy mismatch");
    // 3) the fault ends: the choice works, and the bad copy is not overwritten
    env.rt.writeFault = null;
    assert((await resolveC(env, choice)) === true, "resolve after the faults must return true");
    await env.advance(2000);
    const all = copiesOf(env);
    assert(all.length === 3, "expected 3 copies (bad ones kept), got " + all.length);
    for (const old of leftover) {
      const bad = all.find((c) => c.path === old.path);
      assert(bad && bad.data === old.data, "a bad copy was overwritten");
    }
    const good = all.find((c) => !leftover.some((o) => o.path === c.path));
    assert(good.data === (choice === "mine" ? extText : textOf(mine)), "the good copy does not hold the exact bytes");
    assertClean(env);
  });
}

scenario("G7 an existing copy name is never overwritten: a counter is used", async (kind) => {
  const env = await boot(kind);
  const mine = mkDeck("G7 mine"), ext = mkDeck("G7 theirs");
  const extText = JSON.stringify(ext);
  await makeConflict(env, mine, extText);
  // Take every name the next seconds can give.
  const D = env.win.Date, p2 = (n) => String(n).padStart(2, "0");
  const sentinels = new Map();
  for (let k = 0; k <= 3; k++) {
    const d = new D(env.now() + k * 1000);
    const ts = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    const name = `/decks/a.conflict-${ts}.vela`;
    sentinels.set(name, "SENTINEL " + k);
    env.rt.files.set(name, "SENTINEL " + k);
  }
  assert((await resolveC(env, "mine")) === true, "resolve must return true");
  for (const [n, v] of sentinels) assert(env.rt.files.get(n) === v, "an existing copy was overwritten: " + n);
  const fresh = copiesOf(env).filter((c) => !sentinels.has(c.path));
  assert(fresh.length === 1, "expected 1 new copy, got " + fresh.length);
  assert(/^\/decks\/a\.conflict-\d{8}-\d{6}-([2-9]|1\d|20)\.vela$/.test(fresh[0].path), "no counter in " + fresh[0].path);
  assert(fresh[0].data === extText, "new copy bytes");
  assertClean(env);
});

for (const withPending of [true, false]) {
  for (const bad of ["missing", "{not json", "[1,2,3]", "null", "42", ""]) {
    scenario(`G8 resync with the deck file ${bad === "missing" ? "missing" : "malformed " + JSON.stringify(bad)}${withPending ? " and an unsaved edit" : ""}: no load, no write${withPending ? ", edit kept, status failed" : ""}`, async (kind) => {
      const env = await boot(kind);
      env.rt.setMode("down");
      await env.advance(50);
      const mine = mkDeck("G8 mine");
      if (withPending) { env.edit(mine); await env.advance(1500); }
      if (bad === "missing") env.rt.files.delete(DECK_PATH); else env.rt.files.set(DECK_PATH, bad);
      const writes0 = env.rt.writeLog.length;
      env.rt.setMode("up");
      if (withPending) await env.until(() => env.lastStatus() === "failed", 30000, "status failed");
      else await env.until(() => env.sock.state() === "connected", 30000, "reconnect");
      await env.advance(8000);
      assert(env.externalLoads().length === 0 && env.loaded.length === 1, "the app got a deck: " + env.loaded.length);
      assert(env.rt.writeLog.length === writes0, "something was written");
      if (bad === "missing") assert(!env.rt.files.has(DECK_PATH), "the missing file was created again");
      else assert(env.rt.disk() === bad, "the file changed");
      // [rr2 NF3] a missing file with an unsaved edit asks the user (the
      // dialog's "mine" writes the edit); any other unusable file raises none.
      const ask = withPending && bad === "missing";
      if (ask) assert(env.deckState.paused === true && env.conflicts.length === 1, "no conflict for a missing file with an unsaved edit");
      else assert(env.deckState.paused === false && env.conflicts.length === 0, "a conflict was raised for an unusable file");
      if (withPending) {
        assert(env.deckState.pendingDeck === mine, "the unsaved edit was lost");
        assert(env.lastStatus() === "failed", "status " + env.lastStatus());
      }
      assertClean(env);
    });
  }
}

scenario("G9 a deck file above the size limit is never read or loaded (stat limit and read limit)", async (kind) => {
  const MAX = 50 * 1024 * 1024;
  // (a) the stat already reports a size above the limit: no read call at all
  {
    const env = await boot(kind);
    env.rt.setMode("down");
    await env.advance(50);
    const mine = mkDeck("G9 mine");
    env.edit(mine);
    await env.advance(1500);
    env.rt.files.set(DECK_PATH, JSON.stringify(mkDeck("G9 big")));
    env.rt.sizeOverride.set(DECK_PATH, MAX + 1);
    const reads0 = env.rt.calls["filesystem.readFile"] || 0, writes0 = env.rt.writeLog.length;
    env.rt.setMode("up");
    await env.until(() => env.lastStatus() === "failed", 30000, "status failed");
    await env.advance(8000);
    assert((env.rt.calls["filesystem.readFile"] || 0) === reads0, "the oversized file was read");
    assert(env.externalLoads().length === 0, "the app got the oversized file");
    assert(env.rt.writeLog.length === writes0, "something was written");
    assert(env.deckState.pendingDeck === mine, "the unsaved edit was lost");
  }
  // (b) the stat lies (small size) but the bytes read are above the limit and valid JSON
  {
    const env = await boot(kind);
    env.rt.setMode("down");
    await env.advance(50);
    env.rt.files.set(DECK_PATH, JSON.stringify({ deckTitle: "G9 grown", pad: "x".repeat(MAX + 10) }));
    env.rt.sizeOverride.set(DECK_PATH, 100);
    const writes0 = env.rt.writeLog.length;
    env.rt.setMode("up");
    await env.until(() => env.sock.state() === "connected", 30000, "reconnect");
    await env.advance(8000);
    assert(env.externalLoads().length === 0, "the app got a file above the limit (read check missing)");
    assert(env.rt.writeLog.length === writes0, "something was written");
  }
});

scenario("G10 several resyncs add no second watchFile listener and no second watcher", async (kind) => {
  const env = await boot(kind);
  await env.advance(200); // openDeck starts the watcher without waiting for it
  assert(env.listeners("watchFile") === 1, "listeners at start: " + env.listeners("watchFile"));
  for (let i = 0; i < 4; i++) {
    env.rt.drop();
    await env.advance(8000);
  }
  env.fireWin("online");
  await env.advance(8000);
  assert(env.listeners("watchFile") === 1, "watchFile listeners: " + env.listeners("watchFile"));
  assert(env.rt.watchers.size === 1, "runtime watchers: " + env.rt.watchers.size);
  const ext = mkDeck("G10 external");
  env.rt.externalWrite(DECK_PATH, textOf(ext));
  await env.advance(3000);
  const loads = env.externalLoads();
  assert(loads.length === 1, "the external change reached the app " + loads.length + " times");
  assertClean(env);
});

scenario("G11 the client closes the socket (invalid token): no reconnect, no loop", async (kind) => {
  const env = makeEnv({ rt: { expectAccess: "OTHER-ACCESS" } });
  env.rt.token = "OTHER-FULL-TOKEN";
  env.loadClient(kind);
  const m = env.loadModule("nl-socket.js", SYNC_MODULES);
  const sock = m.createNlSocket({ win: env.win, setTimeout: env.win.setTimeout, clearTimeout: env.win.clearTimeout });
  sock.install();
  try { env.win.Neutralino.init(); } finally { sock.restore(); }
  await env.advance(10);
  let code = null;
  await env.drive(env.win.Neutralino.storage.getKeys().catch((e) => { code = e && e.code; }));
  await env.advance(120000);
  assert(code === "NE_RT_INVTOKN", "code " + code);
  assert(sock.state() === "closed", "state " + sock.state());
  assert(env.rt.attempts === 1 && env.rt.opened === 1, "connections: attempts=" + env.rt.attempts + " opened=" + env.rt.opened);
  // A forced reconnect and resume signals change nothing.
  sock.forceReconnect();
  await env.advance(10000);
  assert(env.rt.attempts === 1, "a reconnect was made after close");
  assert(env.wipes() >= 1, "no error page");
  assertNoSecrets(env);
});

scenario("G12 other WebSocket URLs pass through the hook untouched", async (kind) => {
  const env = makeEnv();
  env.loadClient(kind);
  const Orig = env.win.WebSocket;
  const m = env.loadModule("nl-socket.js", SYNC_MODULES);
  const sock = m.createNlSocket({ win: env.win, setTimeout: env.win.setTimeout, clearTimeout: env.win.clearTimeout });
  sock.install();
  sock.install(); // idempotent
  const H = env.win.WebSocket;
  assert(H !== Orig, "the hook is not installed");
  const others = [
    "ws://127.0.0.1:9999?connectToken=x", "ws://evil.example:" + PORT + "?connectToken=x",
    "wss://127.0.0.1:" + PORT + "?connectToken=x", "ws://127.0.0.1:" + PORT + "/x?connectToken=x",
    "ws://127.0.0.1:" + PORT + "?connectToken=x&a=1", "ws://127.0.0.1:" + PORT + "?other=x",
    "ws://u:p@127.0.0.1:" + PORT + "?connectToken=x", "ws://127.0.0.1:" + PORT + "?connectToken=x#h",
    "ws://127.0.0.1:" + PORT, "ws://example.com/socket",
  ];
  for (const u of others) {
    const o = new H(u);
    assert(o instanceof Orig && o.url === u && o.protocols === undefined, "not passed through: " + u);
  }
  const withProto = new H("ws://example.com/p", ["a", "b"]);
  assert(withProto instanceof Orig && JSON.stringify(withProto.protocols) === '["a","b"]', "protocols not passed through");
  const rtUrlWithProto = new H(env.rt.expectedUrl(), "x");
  assert(rtUrlWithProto instanceof Orig, "a runtime URL with protocols must pass through");
  const asObject = new H({ toString: () => env.rt.expectedUrl() });
  assert(asObject instanceof Orig, "a non-string URL was captured");
  assert(sock.state() === "idle", "state after pass-through: " + sock.state());
  assert(H.OPEN === 1 && H.CLOSED === 3 && H.prototype === Orig.prototype, "static members/prototype not copied");
  sock.restore();
  assert(env.win.WebSocket === Orig, "the global was not restored");
  assertNoSecrets(env);
});

scenario("[fix A1] G13 no token in console, status payloads, events or thrown errors", async (kind) => {
  const env = await boot(kind);
  const seen = [];
  for (const t of ["ready", "serverOffline", "watchFile"]) env.win.addEventListener(t, (e) => seen.push(t + ":" + JSON.stringify(e.detail === undefined ? null : e.detail)));
  const errs = [];
  const N = env.win.Neutralino;
  const changes = [];
  env.sock.onChange((c) => changes.push(c));
  // a call in flight on a socket that is replaced stays unsettled (as in the
  // client without nl-socket.js); errors from the paths below are checked
  env.rt.setMode("frozen");
  N.filesystem.getStats(DECK_DIR).catch((e) => { errs.push(e); });
  await env.advance(20);
  env.rt.setMode("up");
  env.sock.forceReconnect();
  await env.advance(10000);
  assert(errs.length === 0, "the in-flight call was rejected: " + JSON.stringify(errs[0] && errs[0].code));
  N.filesystem.readFile("/decks/missing.vela").catch((e) => { errs.push(e); });
  await env.advance(50);
  assert(errs.length === 1, "set-up: a failing call gave no error");
  // a write timeout on a dead socket, a conflict with failing copies
  await env.advance(8000);
  const mine = mkDeck("G13 mine");
  await makeConflict(env, mine, JSON.stringify(mkDeck("G13 theirs")));
  env.rt.writeFault = (p) => (isCopyPath(p) ? "fail" : null);
  await resolveC(env, "mine");
  env.rt.writeFault = null;
  await resolveC(env, "mine");
  // a repeated drop
  env.rt.drop();
  await env.advance(8000);
  const blob = JSON.stringify([env.consoleLog, env.statuses, env.conflicts, errs.map((e) => [e.code, e.message, String(e)]), seen, changes]);
  for (const secret of [MARKER, ACCESS, "connectToken", "ws://127.0.0.1"]) assert(!blob.includes(secret), "output holds " + (secret === MARKER ? "the connect token" : secret === ACCESS ? "the access token" : secret));
  for (const s of env.statuses) {
    assert(Object.keys(s).sort().join() === "at,name,state", "status keys " + Object.keys(s));
    assert(!/[\\/]/.test(s.name), "status holds a path: " + s.name);
  }
  assert(env.conflicts.every((n) => !/[\\/]/.test(n)), "the conflict handler got a path");
  assertClean(env);
});

scenario("G14 R2 path: after a reconnect old-epoch strays are retired and saves work again", async (kind) => {
  const env = await boot(kind);
  env.rt.setMode("frozen");
  for (let i = 1; i <= 3; i++) {
    env.edit(mkDeck("G14 stuck write " + i));
    await env.advance(17000);
  }
  const before = env.deckState.strays.filter((s) => !s.landed).length;
  assert(before >= 1, "test set-up: no stray write exists (" + before + ")");
  env.rt.setMode("up");
  const good = mkDeck("G14 after recovery");
  const rec = env.edit(good);
  await env.until(() => env.diskIs(good) && env.lastStatus() === "saved" && rec.settled, 40000, "recovery save");
  await env.advance(10000);
  assert(rec.result === true, "recovery save did not settle true");
  assert(env.deckState.strays.every((s) => s.landed || s.retired), "an old-epoch stray still counts as unsettled");
  assert(env.diskIs(good), "disk does not hold the newest deck");
  // saves keep working with no manual action
  const next = mkDeck("G14 next");
  const rec2 = env.edit(next);
  await env.until(() => env.diskIs(next) && rec2.settled && rec2.result === true, 10000, "next save");
  assertClean(env);
});

// ═══════════ Security table: socket layer ═══════════

async function bootSock(kind, opts = {}) {
  const env = makeEnv(opts);
  env.loadClient(kind);
  const OrigWS = env.win.WebSocket;
  const m = env.loadModule("nl-socket.js", SYNC_MODULES);
  env.sockMod = m;
  env.sock = m.createNlSocket({ win: env.win, setTimeout: env.win.setTimeout, clearTimeout: env.win.clearTimeout });
  env.sock.install();
  assert(env.win.WebSocket !== OrigWS, "hook not installed");
  try { env.win.Neutralino.init(); } finally { env.sock.restore(); }
  env.OrigWS = OrigWS;
  env.hbCalls = 0;
  env.resumes = 0;
  env.watch = m.createResumeWatch({
    sock: env.sock,
    heartbeat: () => { env.hbCalls++; return opts.heartbeat ? opts.heartbeat() : env.win.Neutralino.extensions.getStats(); },
    onResume: () => { env.resumes++; },
    win: env.win,
    setTimeout: env.win.setTimeout, clearTimeout: env.win.clearTimeout,
    setInterval: env.win.setInterval, clearInterval: env.win.clearInterval,
  });
  env.watch.start();
  await env.advance(10);
  return env;
}

scenario("X1 the global WebSocket is restored after capture and stays restored", async (kind) => {
  const env = await bootSock(kind);
  assert(env.win.WebSocket === env.OrigWS, "the global is not the original");
  env.sock.install(); // late install must not hook again
  assert(env.win.WebSocket === env.OrigWS, "a late install hooked the global again");
  // restore() after a throwing init: the hook never outlives init
  const env2 = makeEnv();
  env2.loadClient(kind);
  const O2 = env2.win.WebSocket;
  const m2 = env2.loadModule("nl-socket.js", SYNC_MODULES);
  const s2 = m2.createNlSocket({ win: env2.win, setTimeout: env2.win.setTimeout, clearTimeout: env2.win.clearTimeout });
  s2.install();
  try { try { throw new Error("init failed"); } finally { s2.restore(); } } catch { /* expected */ }
  assert(env2.win.WebSocket === O2, "the global was not restored after a throwing init");
  assert(s2.state() === "idle", "state " + s2.state());
});

scenario("X2 a second runtime-like URL is not captured, even through a kept reference to the hook", async (kind) => {
  const env = makeEnv();
  env.loadClient(kind);
  const Orig = env.win.WebSocket;
  const m = env.loadModule("nl-socket.js", SYNC_MODULES);
  const sock = m.createNlSocket({ win: env.win, setTimeout: env.win.setTimeout, clearTimeout: env.win.clearTimeout });
  sock.install();
  const H = env.win.WebSocket;
  const first = new H(env.rt.expectedUrl());
  assert(!(first instanceof Orig), "the first runtime URL was not captured");
  assert(env.win.WebSocket === Orig, "the hook stayed after the capture");
  const second = new H(env.rt.expectedUrl()); // an old reference to the hook
  assert(second instanceof Orig, "a second runtime-like URL was captured");
  const third = new env.win.WebSocket(env.rt.expectedUrl());
  assert(third instanceof Orig, "a third runtime-like URL was captured");
  assert(env.rt.sockets.length === 3, "sockets " + env.rt.sockets.length);
});

scenario("[fix A1] X3 a late message on a replaced socket settles no call and fires no event", async (kind) => {
  const env = await bootSock(kind);
  const N = env.win.Neutralino;
  env.rt.setMode("frozen");
  let first = "pending";
  N.filesystem.writeFile("/decks/x3.vela", "x").then(() => { first = "ok"; }, (e) => { first = "err:" + e.code; });
  await env.advance(5);
  const old = env.rt.sockets[0];
  const oldId = JSON.parse(env.rt.frames[env.rt.frames.length - 1]).id;
  env.rt.setMode("up");
  env.sock.forceReconnect();
  await env.advance(50);
  // A1: nl-socket.js does not invent a reply. A call in flight on the replaced
  // socket stays unsettled, as in the client without the hook.
  assert(first === "pending", "the in-flight call settled on reconnect: " + first);
  // A call on the NEW socket stays unanswered; the old socket answers its id.
  env.rt.holdWrites = true;
  let second = "pending";
  N.filesystem.writeFile("/decks/x3b.vela", "y").then(() => { second = "ok"; }, () => { second = "err"; });
  await env.advance(20);
  assert(env.rt.held.length === 1, "set-up: the second write was not sent");
  const newId = JSON.parse(env.rt.frames[env.rt.frames.length - 1]).id;
  const got = [];
  env.win.addEventListener("watchFile", () => got.push(1));
  env.rt.lateMessage(old, { id: newId, data: { success: true } });
  env.rt.lateMessage(old, { id: oldId, data: { success: true } });
  env.rt.lateMessage(old, { event: "watchFile", data: { id: 1, action: "modified", dir: DECK_DIR, filename: "a.vela" } });
  await env.advance(20);
  assert(second === "pending", "a late message from the old socket settled a call: " + second);
  assert(first === "pending", "a late reply on the old socket settled the old call: " + first);
  assert(got.length === 0, "a late message from the old socket fired an event");
  assertClean(env);
});

scenario("X4 1000 resume signals: exactly one heartbeat, at most one new socket", async (kind) => {
  const env = await bootSock(kind);
  for (let i = 0; i < 1000; i++) env.watch.signal("resume");
  await env.advance(200);
  assert(env.hbCalls === 1, "heartbeats " + env.hbCalls);
  assert(env.resumes === 1, "resumes " + env.resumes);
  assert(env.rt.opened === 1, "a socket was opened for a live connection");
  // Dead socket: the one heartbeat times out and makes at most one new socket.
  env.rt.setMode("frozen");
  const a0 = env.rt.attempts;
  for (let i = 0; i < 1000; i++) env.watch.signal(i % 2 ? "resume" : "online");
  await env.advance(20100); // the heartbeat bound is 20 s
  for (let i = 0; i < 1000; i++) env.watch.signal("resume"); // while reconnecting
  await env.advance(3000);
  assert(env.hbCalls === 2, "heartbeats after the dead socket: " + env.hbCalls);
  assert(env.rt.attempts - a0 === 1, "new sockets: " + (env.rt.attempts - a0));
  assertClean(env);
});

scenario("X5 the window object gets no new property from nl-socket, sync-conflict and deck-io", async (kind) => {
  const bare = await bootBare(kind);
  const keysBare = Object.getOwnPropertyNames(bare.win).sort();
  const env = await boot(kind);
  env.loadModule("sync-conflict.js", ["showSyncConflict"]);
  env.rt.drop();
  await env.advance(8000);
  env.edit(mkDeck("X5 edit"));
  await env.advance(3000);
  const keys = Object.getOwnPropertyNames(env.win).sort();
  const added = keys.filter((k) => !keysBare.includes(k));
  const removed = keysBare.filter((k) => !keys.includes(k));
  assert(added.length === 0 && removed.length === 0, "window keys changed: +" + added.join(",") + " -" + removed.join(","));
  assert(Object.keys(env.win).join() === Object.keys(bare.win).join(), "Object.keys(window) differs");
});

scenario("X6 conflict copy path stays in the deck folder for hostile file names", async (kind) => {
  const names = [
    "<img src=x onerror=alert(1)>&\"'`.vela",
    "..vela",
    "...json",
    ".hidden.vela",
    "....vela",
    "a".repeat(300) + ".vela",
    "tab\tnew\nline\u0007bell.vela",
    "  spaced  .VELA",
    "‮evil‬.vela",
    "ünïcödé-日本語.json",
  ];
  for (const name of names) {
    const deckPath = "/decks/" + name;
    const env = await boot(kind, { deckPath });
    const mine = mkDeck("X6 mine"), extText = JSON.stringify(mkDeck("X6 theirs"));
    await makeConflict(env, mine, extText);
    assert((await resolveC(env, "mine")) === true, "resolve failed for " + JSON.stringify(name.slice(0, 20)));
    const copies = copiesOf(env);
    assert(copies.length === 1, "copies " + copies.length + " for " + JSON.stringify(name.slice(0, 20)));
    const p = copies[0].path;
    assert(p.startsWith("/decks/") && p.indexOf("/", 7) === -1, "the copy is not in the deck folder: " + JSON.stringify(p.slice(0, 40)));
    assert(!p.split("/").includes(".."), "the copy path has a .. segment");
    assert(!/[\\\u0000-\u001f\u007f]/.test(p), "the copy path has a separator or control character");
    const base = p.slice(7);
    const m = /^(.+)\.conflict-\d{8}-\d{6}(-\d+)?\.vela$/su.exec(base);
    assert(m, "copy name pattern: " + JSON.stringify(base.slice(0, 60)));
    assert(Buffer.byteLength(m[1], "utf8") <= 150, "copy stem is over 150 UTF-8 bytes: " + Buffer.byteLength(m[1], "utf8"));
    assert(Buffer.byteLength(base, "utf8") <= 255, "copy name is over 255 UTF-8 bytes");
    assert(copies[0].data === extText, "copy bytes");
    assert(env.rt.disk(deckPath) === textOf(mine), "deck file");
    assert(env.conflicts[0] === name, "the handler got a different name");
    assertClean(env);
  }
  // A plain name follows the exact pattern from the design.
  const env = await boot(kind, { deckPath: "/decks/My Talk.vela" });
  await makeConflict(env, mkDeck("X6 plain mine"), JSON.stringify(mkDeck("X6 plain theirs")));
  await resolveC(env, "file");
  const c = copiesOf(env);
  assert(c.length === 1 && new RegExp("^/decks/" + esc("My Talk") + "\\.conflict-\\d{8}-\\d{6}(-\\d+)?\\.vela$").test(c[0].path), "plain pattern " + (c[0] && c[0].path));
});

// ═══════════ Socket layer: findings fixed in nl-socket.js ═══════════
// [fix A1]: nl-socket makes up no "connection lost" error. A call in flight on a
// dropped socket stays unsettled, as with the pinned client alone. The callers
// keep that behaviour; deck-io bounds its own calls.

scenario("[rev C2][fix A1] openDeck: the socket drops during the last-deck store call; the switch still completes and later saves go to the new file", async (kind) => {
  const env = await boot(kind);
  const A0 = env.rt.disk(env.deckPath || "/decks/a.vela");
  const B = mkDeck("C2 other deck");
  env.rt.files.set("/decks/b.vela", textOf(B));
  // The runtime gets the last-deck store call of the switch, then the socket dies.
  // That call is best effort and not awaited: the switch must not wait on it.
  env.rt.deadOn = "storage.setData";
  let opened = false;
  env.deckIO.openDeck("/decks/b.vela").then(() => { opened = true; }, () => {});
  await env.until(() => env.rt.deadOn === null, 5000, "switch reached the store call");
  env.rt.drop();
  await env.until(() => opened, 5000, "switch completed");
  assert(env.loaded.some((l) => l.path === "/decks/b.vela"), "the app did not get the new deck");
  await env.until(() => env.sock.state() === "connected", 15000, "reconnect");
  await env.advance(2000);
  // The app now shows B and edits it: the edit lands in b.vela, never in a.vela.
  const B2 = mkDeck("C2 edit of the new deck");
  env.edit(B2);
  await env.until(() => env.rt.disk("/decks/b.vela") === textOf(B2), 30000, "edit saved to the new file");
  await env.until(() => env.lastStatus() === "saved", 30000, "status saved");
  assert(env.rt.disk(env.deckPath || "/decks/a.vela") === A0, "the old file was changed");
});

scenario("[rev C2][fix A1] openDeck: a watcher-remove call that never answers does not block the switch for good", async (kind) => {
  const env = await boot(kind);
  const B = mkDeck("C2b other deck");
  env.rt.files.set("/decks/b.vela", textOf(B));
  env.rt.deadOn = "filesystem.removeWatcher";
  let opened = false;
  env.deckIO.openDeck("/decks/b.vela").then(() => { opened = true; }, () => {});
  await env.until(() => env.rt.deadOn === null, 5000, "switch reached removeWatcher");
  env.rt.drop();
  await env.until(() => opened, 30000, "switch completed after the bound");
  assert(env.deckState.switching === false, "switching stayed true");
  await env.until(() => env.sock.state() === "connected", 15000, "reconnect");
  const B2 = mkDeck("C2b edit");
  env.edit(B2);
  await env.until(() => env.rt.disk("/decks/b.vela") === textOf(B2), 30000, "edit saved after the switch");
});

scenario("[rev C3][fix A1] newDeck: the socket drops while the folder list is read; an existing file is never replaced by a blank deck", async (kind) => {
  const env = await boot(kind);
  const keep = textOf(mkDeck("C3 existing Untitled"));
  env.rt.files.set("/decks/Untitled.vela", keep);
  env.rt.deadOn = "filesystem.readDirectory";
  env.deckIO.newDeck("Untitled").catch(() => {});
  await env.until(() => env.rt.deadOn === null, 5000, "newDeck reached the folder list");
  env.rt.drop();
  await env.until(() => env.sock.state() === "connected", 15000, "reconnect");
  await env.advance(30000);
  assert(env.rt.disk("/decks/Untitled.vela") === keep, "the existing file was replaced");
  assert(writesTo(env, "/decks/Untitled.vela").length === 0, "a write went to the existing file");
});

scenario("[rev C8][fix A1] calls queued during an outage keep their order when the socket drops during the drain", async (kind) => {
  const env = await bootSock(kind);
  const N = env.win.Neutralino;
  const Q = "/decks/order.txt";
  env.rt.setMode("down");
  await env.until(() => env.sock.state() !== "connected", 5000, "drop");
  for (const v of ["1", "2", "3"]) N.filesystem.writeFile(Q, v).catch(() => {});
  // The first queued write reaches the runtime and gets no answer; then the socket drops.
  env.rt.holdWrites = true;
  env.rt.mode = "up";
  await env.until(() => env.rt.held.length === 1, 30000, "first queued write sent");
  env.rt.holdWrites = false;
  env.rt.drop();
  await env.advance(30000);
  const order = writesTo(env, Q).map((w) => w.data).join(",");
  assert(env.rt.disk(Q) === "3", "queued calls ran out of order: the file holds " + JSON.stringify(env.rt.disk(Q)) + " (writes " + order + ")");
  assert(order === "2,3", "write order " + order);
});

scenario("[rev V1][fix A1] a read in flight when the socket drops is never failed by the socket layer (no empty default to cache)", async (kind) => {
  const env = await bootSock(kind);
  const N = env.win.Neutralino;
  const trusted = JSON.stringify(["/decks/a.vela"]);
  await env.drive(N.storage.setData("trust", trusted), 5000, "setData");
  let got = "unsettled";
  env.rt.deadOn = "storage.getData";
  N.storage.getData("trust").then(() => { got = "resolved"; }, (e) => { got = "rejected " + (e && e.code); });
  await env.until(() => env.rt.deadOn === null, 5000, "read sent");
  env.rt.drop();
  await env.until(() => env.sock.state() === "connected", 15000, "reconnect");
  await env.advance(20000);
  assert(got === "unsettled", "the in-flight read settled: " + got);
  assert(await env.drive(N.storage.getData("trust"), 5000, "getData") === trusted, "a new read after the reconnect did not get the stored value");
});

scenario("[rev C5][fix A2] the heartbeat touches no file; an error reply counts as alive; only no reply within 20 s is dead", async (kind) => {
  const bootSrc = fs.readFileSync(path.join(JS_DIR, "nl-boot.js"), "utf8");
  assert(/heartbeat:\s*\(\)\s*=>\s*Neutralino\.extensions\.getStats\(\)/.test(bootSrc), "nl-boot.js heartbeat is not Neutralino.extensions.getStats()");
  const errEnv = await bootSock(kind, { heartbeat: () => Promise.reject(Object.assign(new Error("busy"), { code: "NE_EX_EXTNOTL" })) });
  const a0 = errEnv.rt.attempts;
  errEnv.fireWin("online");
  await errEnv.advance(6000);
  assert(errEnv.hbCalls === 1, "heartbeats " + errEnv.hbCalls);
  assert(errEnv.rt.attempts === a0 && errEnv.sock.state() === "connected", "an error reply was taken as a dead socket");
  assert(errEnv.resumes === 1, "no resume after an error reply: " + errEnv.resumes);
  const deadEnv = await bootSock(kind, { heartbeat: () => new Promise(() => {}) });
  const b0 = deadEnv.rt.attempts;
  deadEnv.fireWin("online");
  await deadEnv.advance(21000); // longer than HEARTBEAT_TIMEOUT_MS (20 s)
  assert(deadEnv.rt.attempts > b0 && deadEnv.resumes === 0, "no reply was not taken as a dead socket");
});

scenario("[rev V3][fix A3] a runtime that accepts each socket and closes it after 1 s: the reconnect delay keeps growing", async (kind) => {
  const env = await bootSock(kind);
  const openedAt = new Map();
  const a0 = env.rt.attempts;
  env.rt.drop();
  for (let t = 0; t < 30000; t += 50) {
    await env.advance(50);
    for (const s of env.rt.conns) {
      if (!openedAt.has(s)) openedAt.set(s, t);
      else if (t - openedAt.get(s) >= 1000) env.rt.drop();
    }
  }
  const n = env.rt.attempts - a0;
  assert(n >= 4, "test set-up: only " + n + " reconnect(s)");
  assert(n <= 10, n + " connections in 30 s of open-then-close flaps: the backoff was reset on each open");
});

scenario("[rev V2][fix A4] a hidden window with throttled timers sends no heartbeat and runs no resync; shown again after 30 s it runs one", async (kind) => {
  const env = await bootSock(kind);
  await env.advance(10000);
  const h0 = env.hbCalls, r0 = env.resumes;
  env.setVisibility("hidden");
  for (let i = 0; i < 20; i++) await env.suspend(60000); // one late timer tick per minute
  assert(env.hbCalls === h0 && env.resumes === r0, `hidden: ${env.hbCalls - h0} heartbeat(s), ${env.resumes - r0} resume(s)`);
  env.setVisibility("visible");
  await env.advance(1000);
  assert(env.resumes === r0 + 1, "resumes after the window was shown: " + (env.resumes - r0));
});

scenario("[sec bridge F1][fix A5] the socket hook is installed only when NL_MODE is exactly \"window\"", async (kind) => {
  for (const mode of [null, "", "browser", "chrome", "cloud", "Window", " window", "window "]) {
    const env = makeEnv({ nlMode: mode });
    env.loadClient(kind);
    const OrigWS = env.win.WebSocket;
    const m = env.loadModule("nl-socket.js", SYNC_MODULES);
    const sock = m.createNlSocket({ win: env.win, setTimeout: env.win.setTimeout, clearTimeout: env.win.clearTimeout });
    sock.install();
    const hooked = env.win.WebSocket !== OrigWS;
    try { env.win.Neutralino.init(); } finally { sock.restore(); }
    await env.advance(10);
    const tag = "NL_MODE=" + JSON.stringify(mode);
    assert(!hooked, tag + ": hook installed");
    assert(sock.state() === "idle", tag + ": state " + sock.state());
    env.rt.drop();
    await env.advance(10000);
    assert(env.rt.attempts === 1, tag + ": nl-socket reconnected (" + env.rt.attempts + " attempts)");
  }
  const env = await bootSock(kind); // "window": bootSock asserts that the hook is installed
  assert(env.sock.state() === "connected", "window mode: state " + env.sock.state());
});

// ═══════════ Unit section: deck-io.js with a fake Neutralino object ═══════════
// These cases call deck-io.js directly, with a fake Neutralino object, a fake
// connection view, real timers and short time limits. They do not use the
// client, so they run once ("[unit]"), not once per tier.

const sleep = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const U_PATH = "/decks/a.vela";
const utxt = (d) => JSON.stringify(d, null, 2);
const udeck = (t) => ({ deckTitle: t, lanes: [{ title: "L", items: [] }] });
const utitle = (N, p = U_PATH) => { try { return JSON.parse(N.files[p]).deckTitle; } catch { return N.files[p]; } };
const ucopies = (N) => Object.keys(N.files).filter((p) => /\.conflict-\d{8}-\d{6}(-\d+)?\.vela$/.test(p));
const ufire = (N) => { for (const h of N.handlers) h({ detail: { dir: "/decks", filename: "a.vela", action: "modified" } }); };
const uNoPath = () => { const e = new Error("no path"); e.code = "NE_FS_NOPATHE"; return e; };

function unitBuild(Neu, opts = {}) {
  let body = fs.readFileSync(path.join(JS_DIR, "deck-io.js"), "utf8")
    .replace(/import\s*\{[^}]*\}\s*from\s*["']\.\/fs-guard\.js["'];?/, "")
    .replace(/^export\s+/gm, "")
    .replace(/const SAVE_RETRY_DELAYS = \[[^\]]*\];/, "const SAVE_RETRY_DELAYS = [5, 5];")
    .replace(/const RESYNC_QUIET_MS = \d+;/, "const RESYNC_QUIET_MS = 20;")
    .replace(/const APP_EDIT_GRACE_MS = \d+;/, `const APP_EDIT_GRACE_MS = ${opts.grace || 60};`)
    .replace(/const SYNC_RETRY_DELAYS = \[[^\]]*\];/, "const SYNC_RETRY_DELAYS = [40, 40, 40, 40];")
    .replace(/const NATIVE_CALL_TIMEOUT_MS = \d+;/, `const NATIVE_CALL_TIMEOUT_MS = ${opts.timeoutMs || 80};`);
  if (opts.ignoreMs !== undefined) body = body.replace(/const WATCHER_IGNORE_MS = \d+;/, `const WATCHER_IGNORE_MS = ${opts.ignoreMs};`);
  if (opts.strayTtl !== undefined) body = body.replace(/const RETIRED_STRAY_TTL_MS = [^;]+;/, `const RETIRED_STRAY_TTL_MS = ${opts.strayTtl};`);
  const optional = ["writeConflictCopy", "repairAfterStray"].map((n) => `${n}: typeof ${n} === "function" ? ${n} : undefined`).join(", ");
  body += `\n;return { deckIO, state, flushNow, onWatchEvent, saveCurrent, ${optional} };`;
  return new Function("Neutralino", "fsGuard", "console", body)(Neu, { allow() {} }, { warn() {}, error() {}, log() {} });
}

function unitNeu(cfg = {}) {
  const files = cfg.files || {};
  const N = {
    files, writes: [], reads: 0, extraEntries: [], handlers: [],
    filesystem: {
      writeFile(p, d) {
        N.writes.push({ p, d });
        const b = cfg.write ? cfg.write(p, d, files) : "ok";
        if (b === "ok" || b === undefined) { files[p] = d; return Promise.resolve(); }
        if (b === "hang") return new Promise(() => {});
        if (b && typeof b.then === "function") return b;
        return Promise.reject(b);
      },
      async getStats(p) {
        if (cfg.getStats) { const r = cfg.getStats(p, files); if (r !== undefined) { if (r instanceof Error) throw r; return r; } }
        if (files[p] == null) throw uNoPath();
        return { size: Buffer.byteLength(files[p], "utf8"), isFile: true, isDirectory: false };
      },
      async readFile(p) {
        N.reads++;
        if (cfg.readFile) { const r = cfg.readFile(p, files); if (r !== undefined) { if (r instanceof Error) throw r; return r; } }
        if (files[p] == null) throw uNoPath();
        return files[p];
      },
      async readDirectory(dir) {
        if (cfg.readDirectory) { const r = cfg.readDirectory(dir); if (r !== undefined) { if (r instanceof Error) throw r; return r; } }
        return Object.keys(files).filter((k) => k.startsWith(dir + "/") && !k.slice(dir.length + 1).includes("/"))
          .map((k) => ({ entry: k.slice(dir.length + 1), type: "FILE" })).concat(N.extraEntries);
      },
      async createWatcher() { return 1; },
      async removeWatcher() {},
    },
    storage: { async getData() { return null; }, async setData() {}, async getKeys() { return []; } },
    events: { on(n, f) { if (!N.handlers.includes(f)) N.handlers.push(f); }, off(n, f) { const i = N.handlers.indexOf(f); if (i >= 0) N.handlers.splice(i, 1); } },
    os: { async showFolderDialog() { return "/other"; } },
  };
  return N;
}

// The connection view nl-boot gives to deck-io: {state, epoch, onChange, suspect}.
function unitConn() {
  let st = "connected", ep = 1;
  const cbs = [];
  const k = {
    c: { state: () => st, epoch: () => ep, onChange: (cb) => { cbs.push(cb); return () => {}; }, suspect: () => {} },
    set(s) { st = s; if (s === "connected") ep++; for (const cb of cbs) cb({ state: st, epoch: ep }); },
  };
  return k;
}

async function unitSetup(cfg = {}, opts = {}) {
  cfg.files = { [U_PATH]: utxt(udeck("Init")), ...(cfg.files || {}) };
  const N = unitNeu(cfg);
  const m = unitBuild(N, opts);
  const k = unitConn();
  const e = { N, m, k, statuses: [], loaded: [], conflicts: [], cleared: 0, applyResult: undefined };
  m.state.folder = "/decks";
  m.deckIO.onSaveStatus((s) => e.statuses.push(s.state));
  // nl-boot returns false for an external load that the app did not apply.
  m.deckIO.onDeckLoaded((d, p, meta) => { if (meta && meta.external) { if (e.applyResult === false) return false; e.loaded.push(d.deckTitle); } });
  if (opts.attach !== false) m.deckIO.attachConnection(k.c);
  if (opts.handler !== false) m.deckIO.onConflict((n) => e.conflicts.push(n));
  if (m.deckIO.onConflictCleared) m.deckIO.onConflictCleared(() => { e.cleared++; });
  await m.deckIO.openDeck(U_PATH);
  if (opts.ready !== false && m.deckIO.setAppReady) m.deckIO.setAppReady();
  e.last = () => e.statuses[e.statuses.length - 1];
  N.writes.length = 0; e.statuses.length = 0;
  return e;
}

// The socket drops while an edit is held, the file changes outside, the socket
// comes back: resync raises the conflict.
async function unitConflict(e, mine = "MINE", outside = "OUTSIDE") {
  e.k.set("reconnecting");
  e.m.saveCurrent(udeck(mine));
  await sleep(260);
  e.N.files[U_PATH] = utxt(udeck(outside));
  e.k.set("connected");
  for (let i = 0; i < 50 && !e.m.state.paused; i++) await sleep(10);
  assert(e.m.state.paused && e.conflicts.length === 1, "test set-up: conflict not raised");
}

// A write that hangs once and lands (or not) when the test says so.
function hangOnce(apply = true) {
  const h = { hang: true, land: null };
  h.write = (p, d, f) => {
    if (!h.hang) return "ok";
    h.hang = false;
    return new Promise((r) => { h.land = () => { if (apply) f[p] = d; r(); }; });
  };
  return h;
}

const unit = (name, fn) => scenario(name, fn, { once: true });

unit("[fix B1] a stray write records the connection epoch when it is ISSUED (old epoch after a reconnect)", async () => {
  const e = await unitSetup({ write: () => "hang" }, { timeoutMs: 120 });
  const seen = [];
  const arr = e.m.state.strays;
  arr.push = function (x) { seen.push({ ...x }); return Array.prototype.push.call(this, x); };
  e.m.saveCurrent(udeck("S1"));
  await sleep(230);                                  // write issued on epoch 1
  e.k.set("reconnecting"); e.k.set("connected");     // epoch 2 before the time-out
  await sleep(200);                                  // time-out, then the resync retires it
  assert(seen.length === 1, "no stray");
  assert(seen[0].epoch === 1, "stray epoch " + seen[0].epoch);
  assert(e.m.state.strays.length === 1 && e.m.state.strays[0].retired, "the old-epoch stray was not retired");
});

unit("[rev C1][fix B2] conflict \"mine\": copy written, deck write fails -> true, unpaused, edit kept, status failed; Retry writes it", async () => {
  let lock = false;
  const e = await unitSetup({ write: (p) => (lock && p === U_PATH ? new Error("EBUSY locked") : "ok") });
  await unitConflict(e);
  lock = true;
  const r = await e.m.deckIO.resolveConflict("mine");
  assert(r === true, "resolveConflict returned " + r);
  assert(!e.m.state.paused && !e.m.state.conflict, "still paused");
  assert(ucopies(e.N).length === 1 && utitle(e.N, ucopies(e.N)[0]) === "OUTSIDE", "copy missing");
  assert(e.m.state.pendingDeck && e.m.state.pendingDeck.deckTitle === "MINE", "pending edit lost");
  assert(e.last() === "failed", "status " + e.last());
  lock = false;
  await e.m.deckIO.flushNow();
  assert(utitle(e.N) === "MINE", "Retry did not write: " + utitle(e.N));
  e.k.set("reconnecting"); e.k.set("connected"); await sleep(150);
  assert(e.conflicts.length === 1, "the same conflict was raised again");
});

unit("[fix B2] conflict \"mine\": the deck write is held by a drop after the copy -> true; the reconnect writes it, no second conflict", async () => {
  let drop = null;
  const e = await unitSetup({ write: (p) => { if (drop && /conflict/.test(p)) { const f = drop; drop = null; f(); } return "ok"; } });
  await unitConflict(e);
  drop = () => e.k.set("reconnecting");
  const r = await e.m.deckIO.resolveConflict("mine");
  assert(r === true, "resolveConflict returned " + r);
  assert(utitle(e.N) === "OUTSIDE", "wrote while the socket was down");
  e.k.set("connected"); await sleep(150);
  assert(utitle(e.N) === "MINE" && e.conflicts.length === 1, "after reconnect disk=" + utitle(e.N) + " conflicts=" + e.conflicts.length);
});

unit("[fix B3] a deck switch that ends a conflict calls onConflictCleared (openDeck, newDeck, reselectFolder)", async () => {
  const e = await unitSetup({ files: { "/decks/b.vela": utxt(udeck("B")) } });
  e.m.state.paused = true; e.m.state.conflict = { path: U_PATH };
  await e.m.deckIO.openDeck("/decks/b.vela");
  assert(e.cleared === 1 && !e.m.state.paused, "openDeck cleared=" + e.cleared);
  e.m.state.paused = true; e.m.state.conflict = { path: "/decks/b.vela" };
  assert(await e.m.deckIO.newDeck("N") === "/decks/N.vela", "newDeck failed");
  assert(e.cleared === 2, "newDeck cleared=" + e.cleared);
  e.m.state.paused = true; e.m.state.conflict = { path: "/decks/N.vela" };
  await e.m.deckIO.reselectFolder();
  assert(e.cleared === 3, "reselectFolder cleared=" + e.cleared);
  await e.m.deckIO.openDeck("/decks/b.vela").catch(() => {});
  assert(e.cleared === 3, "called without a conflict");
});

unit("[rev C4][fix B4] a watcher event in the resync quiet time with an unsaved edit -> conflict, no load, no write", async () => {
  const e = await unitSetup({}, { ignoreMs: 0 });
  e.k.set("reconnecting");
  e.m.saveCurrent(udeck("MINE")); await sleep(230);
  e.k.set("connected");                 // resync starts its quiet wait
  e.N.files[U_PATH] = utxt(udeck("OUTSIDE"));
  ufire(e.N);
  await sleep(200);
  assert(e.loaded.length === 0, "loaded " + e.loaded);
  assert(utitle(e.N) === "OUTSIDE", "the edit was written over the outside change");
  assert(e.m.state.paused && e.conflicts.length === 1, "conflicts " + e.conflicts.length);
});

unit("[fix B4] a watcher read in flight when a conflict opens loads nothing", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const g = { slow: false };
  const e = await unitSetup({ readFile: (p, f) => (g.slow ? gate.then(() => f[p]) : undefined) }, { ignoreMs: 0 });
  g.slow = true;
  e.N.files[U_PATH] = utxt(udeck("OUTSIDE"));
  ufire(e.N); await sleep(20);
  e.m.state.paused = true; e.m.state.conflict = { path: U_PATH };
  release(); await sleep(30);
  assert(e.loaded.length === 0, "loaded while paused");
});

unit("[fix B4] a watcher event with an unsaved edit and no conflict handler: no load, status failed", async () => {
  const e = await unitSetup({}, { ignoreMs: 0, handler: false });
  e.m.saveCurrent(udeck("MINE"));
  e.N.files[U_PATH] = utxt(udeck("OUTSIDE"));
  ufire(e.N); await sleep(30);
  assert(e.loaded.length === 0 && !e.m.state.paused && e.statuses.includes("failed"), "loaded=" + e.loaded + " statuses=" + e.statuses);
});

unit("[fix B4] our own slow write seen by the watcher while a newer edit waits is no conflict", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let slow = true;
  const e = await unitSetup({ write: (p, d, f) => (slow ? gate.then(() => { f[p] = d; }) : "ok") }, { ignoreMs: 0 });
  e.m.saveCurrent(udeck("W1")); await sleep(220);   // write in flight; its bytes are visible
  e.N.files[U_PATH] = utxt(udeck("W1"));
  e.m.saveCurrent(udeck("W2"));                     // newer edit waits
  ufire(e.N); await sleep(30);
  assert(e.conflicts.length === 0 && e.loaded.length === 0, "false conflict " + e.conflicts.length);
  slow = false; release(); await sleep(300);
  assert(utitle(e.N) === "W2", "disk " + utitle(e.N));
});

unit("[rev C6][fix B5] resync read fails with an unsaved edit -> saves held, retry; an outside change then gives a conflict, not an overwrite", async () => {
  let locked = false;
  const e = await unitSetup({ readFile: () => (locked ? new Error("EBUSY") : undefined) });
  locked = true;
  e.k.set("reconnecting");
  e.m.saveCurrent(udeck("MINE")); await sleep(230);
  e.k.set("connected"); await sleep(120);
  assert(e.m.state.syncBlocked, "saves not held");
  e.m.saveCurrent(udeck("MINE2")); await sleep(260);
  await e.m.deckIO.flushNow(); await sleep(60);
  assert(e.N.writes.length === 0, "wrote while held: " + e.N.writes.length);
  assert(e.last() === "failed", "status " + e.last());
  e.N.files[U_PATH] = utxt(udeck("OUTSIDE"));
  locked = false; await sleep(200);                 // the retry resync runs
  assert(!e.m.state.syncBlocked && e.m.state.paused && e.conflicts.length === 1, "no conflict after the retry");
  assert(utitle(e.N) === "OUTSIDE", "the outside change was overwritten");
});

unit("[fix B5] retry with an unchanged file -> saves released and the edit written", async () => {
  let locked = false;
  const e = await unitSetup({ readFile: () => (locked ? new Error("EBUSY") : undefined) });
  locked = true;
  e.k.set("reconnecting");
  e.m.saveCurrent(udeck("MINE")); await sleep(230);
  e.k.set("connected"); await sleep(120);
  assert(e.m.state.syncBlocked, "saves not held");
  locked = false; await sleep(200);
  assert(!e.m.state.syncBlocked && utitle(e.N) === "MINE", "disk " + utitle(e.N));
});

unit("[fix B5][rr2 NF3] a missing deck file with an unsaved edit is not made again without a choice", async () => {
  const e = await unitSetup();
  e.k.set("reconnecting");
  e.m.saveCurrent(udeck("MINE")); await sleep(230);
  delete e.N.files[U_PATH];
  e.k.set("connected"); await sleep(150);
  assert(e.N.files[U_PATH] === undefined, "the file was made again");
  assert(e.m.state.paused && e.conflicts.length === 1, "the user was not asked");
});

unit("[fix B5] a deck switch ends the held sync", async () => {
  let locked = false;
  const e = await unitSetup({ files: { "/decks/b.vela": utxt(udeck("B")) }, readFile: (p) => (locked && p === U_PATH ? new Error("EBUSY") : undefined) });
  locked = true;
  e.k.set("reconnecting");
  e.m.saveCurrent(udeck("MINE")); await sleep(230);
  e.k.set("connected"); await sleep(120);
  assert(e.m.state.syncBlocked, "saves not held");
  await e.m.deckIO.openDeck("/decks/b.vela");
  assert(!e.m.state.syncBlocked && !e.m.state.syncRetryTimer, "held sync not ended");
});

unit("[rev V5][fix B6] a stray repair while the socket is down: no read, no write", async () => {
  const h = hangOnce();
  const e = await unitSetup({ write: h.write });
  e.m.saveCurrent(udeck("S1")); await sleep(330);
  e.m.saveCurrent(udeck("S2")); await sleep(300);
  assert(e.m.state.confirmed.has(U_PATH), "test set-up: no confirmed bytes");
  e.k.set("reconnecting");
  e.N.files[U_PATH] = utxt(udeck("OUTSIDE"));
  const r0 = e.N.reads; e.N.writes.length = 0;
  h.land(); await sleep(100);
  assert(e.N.reads === r0 && e.N.writes.length === 0, "the repair used the disk while the socket was down");
});

unit("[rev V5][fix B6] a stray repair while a conflict is open: no write", async () => {
  const h = hangOnce();
  const e = await unitSetup({ write: h.write });
  e.m.saveCurrent(udeck("S1")); await sleep(330);
  e.m.saveCurrent(udeck("S2")); await sleep(300);
  e.m.state.paused = true; e.m.state.conflict = { path: U_PATH };
  e.N.writes.length = 0;
  h.land(); await sleep(100);
  assert(e.N.writes.length === 0, "the repair wrote during an open conflict");
});

unit("[rev V5][fix B6] the stray repair read fails -> no write; the newest bytes wait as the edit, status failed", async () => {
  const h = hangOnce();
  let lockReads = false;
  const e = await unitSetup({ write: h.write, readFile: () => (lockReads ? new Error("EBUSY") : undefined) });
  e.m.saveCurrent(udeck("S1")); await sleep(330);
  e.m.saveCurrent(udeck("S2")); await sleep(300);
  lockReads = true; e.N.writes.length = 0;
  h.land(); await sleep(100);
  assert(e.N.writes.length === 0, "wrote without a read");
  assert(e.m.state.pendingDeck && e.m.state.pendingDeck.deckTitle === "S2" && e.last() === "failed", "newest bytes not kept as the edit");
});

unit("[rev V7][fix B7] a failed save keeps the edit; an outside change via the watcher -> conflict; the reconnect does not write the old edit", async () => {
  let failW = true;
  const e = await unitSetup({ write: () => (failW ? new Error("EBUSY") : "ok") }, { ignoreMs: 0 });
  e.m.saveCurrent(udeck("OLDPENDING")); await sleep(300);
  assert(e.m.state.pendingDeck, "test set-up: edit not kept");
  failW = false;
  e.N.files[U_PATH] = utxt(udeck("EXTERNAL"));
  ufire(e.N); await sleep(60);
  e.k.set("reconnecting"); e.k.set("connected"); await sleep(150);
  assert(e.loaded.length === 0 && utitle(e.N) === "EXTERNAL" && e.m.state.paused, "disk=" + utitle(e.N) + " loaded=" + e.loaded);
});

unit("[fix B7] conflict \"file\" drops the edit, the strays and the confirmed bytes of the path", async () => {
  const e = await unitSetup();
  await unitConflict(e);
  e.m.state.strays.push({ seq: 0, path: U_PATH, text: "x", landed: false, epoch: 2, retired: false, at: Date.now() });
  e.m.state.confirmed.set(U_PATH, { seq: 1, text: "y", deck: {} });
  assert(await e.m.deckIO.resolveConflict("file") === true, "choice \"file\" failed");
  assert(!e.m.state.pendingDeck && e.m.state.strays.length === 0 && !e.m.state.confirmed.has(U_PATH), "not cleared");
  assert(e.loaded[0] === "OUTSIDE", "loaded " + e.loaded);
});

unit("[rev G3][fix B7] a stray that lands after an outside change was loaded: no repair puts our older bytes back", async () => {
  const h = hangOnce(true);
  const e = await unitSetup({ write: h.write }, { ignoreMs: 0 });
  e.m.saveCurrent(udeck("S1")); await sleep(330);
  e.m.saveCurrent(udeck("S2")); await sleep(300);
  e.N.files[U_PATH] = utxt(udeck("EXTERNAL")); ufire(e.N); await sleep(60);
  assert(e.loaded[0] === "EXTERNAL", "test set-up: not loaded");
  e.N.writes.length = 0;
  // The runtime applies the late S1 write now. S2 is older than the outside
  // change the app shows, so deck-io must not write it back.
  h.land(); await sleep(100);
  assert(e.N.writes.length === 0 && utitle(e.N) !== "S2", "the repair wrote " + e.N.writes.length + " time(s); disk " + utitle(e.N));
});

unit("[rev G2][fix B8] resync finds an outside change just after an app save; an edit comes in the grace wait -> conflict, no load", async () => {
  const e = await unitSetup({}, { grace: 600 });
  e.m.saveCurrent(udeck("E0")); await sleep(260);   // written; the app saved a short time ago
  e.N.files[U_PATH] = utxt(udeck("OUTSIDE"));
  e.m.deckIO.resync();
  await sleep(100);
  assert(e.loaded.length === 0, "loaded before the grace wait ended");
  e.m.saveCurrent(udeck("TYPING"));
  await sleep(700);
  assert(e.loaded.length === 0 && e.m.state.paused, "loaded " + e.loaded + " paused " + e.m.state.paused);
});

unit("[fix B8] no recent app save -> the outside change loads without the grace wait", async () => {
  const e = await unitSetup({}, { grace: 5000 });
  e.N.files[U_PATH] = utxt(udeck("OUTSIDE"));
  await e.m.deckIO.resync();
  assert(e.loaded[0] === "OUTSIDE", "not loaded");
});

unit("[rev C7][fix B9] resync: an outside file without lanes is not loaded and the baseline stays", async () => {
  const e = await unitSetup();
  const base = e.m.state.lastWrittenText;
  e.N.files[U_PATH] = JSON.stringify({ t: "compact", L: [] });
  await e.m.deckIO.resync();
  assert(e.loaded.length === 0 && e.m.state.lastWrittenText === base, "loaded");
});

unit("[rev C7][fix B9] conflict \"file\" with a file without lanes -> false (unreadable), edit kept", async () => {
  const e = await unitSetup();
  await unitConflict(e);
  e.N.files[U_PATH] = JSON.stringify({ deckTitle: "x" });
  assert(await e.m.deckIO.resolveConflict("file") === false && e.m.deckIO.conflictReason() === "unreadable", "accepted");
  assert(e.m.state.pendingDeck && e.m.state.paused, "edit dropped");
});

unit("[rev V10][fix B9] resync before setAppReady does nothing; setAppReady runs it", async () => {
  const e = await unitSetup({}, { ready: false });
  e.N.files[U_PATH] = utxt(udeck("OUTSIDE"));
  await e.m.deckIO.resync();
  assert(e.loaded.length === 0 && e.N.reads === 1, "ran before the app was ready (reads " + e.N.reads + ")");
  e.m.deckIO.setAppReady(); await sleep(100);
  assert(e.loaded[0] === "OUTSIDE", "not run when the app became ready");
});

unit("[rev V10] an outside load the app did not apply: no baseline move, no \"saved\", a later retry applies it", async () => {
  const e = await unitSetup();
  const base = e.m.state.lastWrittenText;
  e.applyResult = false;
  e.N.files[U_PATH] = utxt(udeck("OUTSIDE"));
  await e.m.deckIO.resync();
  assert(e.m.state.lastWrittenText === base && !e.statuses.includes("saved") && e.m.state.syncRetryTimer, "state moved");
  e.applyResult = undefined; await sleep(150);
  assert(e.loaded[0] === "OUTSIDE" && e.m.state.lastWrittenText !== base, "the retry did not apply it");
});

unit("[rev V10] a watcher load the app did not apply keeps the baseline", async () => {
  const e = await unitSetup({}, { ignoreMs: 0 });
  const base = e.m.state.lastWrittenText;
  e.applyResult = false;
  e.N.files[U_PATH] = utxt(udeck("OUTSIDE")); ufire(e.N); await sleep(30);
  assert(e.m.state.lastWrittenText === base, "baseline moved");
});

unit("[rev V10] conflict \"file\" the app did not apply -> false (app), still paused, edit kept", async () => {
  const e = await unitSetup();
  await unitConflict(e);
  e.applyResult = false;
  assert(await e.m.deckIO.resolveConflict("file") === false && e.m.deckIO.conflictReason() === "app", "reason " + e.m.deckIO.conflictReason());
  assert(e.m.state.paused && e.m.state.pendingDeck.deckTitle === "MINE", "state changed");
});

unit("[rev V6][fix B10] a long CJK deck name: the copy name is at most 255 UTF-8 bytes and the copy is written", async () => {
  const long = "/decks/" + "演示文稿".repeat(20) + ".vela";
  const e = await unitSetup({ files: { [long]: utxt(udeck("L")) }, write: (p) => (Buffer.byteLength(p.split("/").pop()) > 255 ? new Error("ENAMETOOLONG") : "ok") });
  assert(await e.m.writeConflictCopy(long, utxt(udeck("C"))) === true, "copy failed");
  const c = ucopies(e.N)[0];
  assert(c && Buffer.byteLength(c.split("/").pop()) <= 255, "name too long");
});

unit("[fix B10] a long stem refused by the platform -> one retry with the stem \"deck\"", async () => {
  const e = await unitSetup({ write: (p) => (/conflict/.test(p) && !/\/deck\.conflict/.test(p) ? new Error("ENAMETOOLONG") : "ok") });
  assert(await e.m.writeConflictCopy(U_PATH, utxt(udeck("C"))) === true, "no retry");
  assert(/\/deck\.conflict-/.test(ucopies(e.N)[0]), "copies " + ucopies(e.N));
});

unit("[fix B10] no retry after a time-out", async () => {
  const e = await unitSetup({ write: (p) => (/conflict/.test(p) ? "hang" : "ok") });
  const w0 = e.N.writes.length;
  assert(await e.m.writeConflictCopy(U_PATH, utxt(udeck("C"))) === false, "returned true");
  assert(e.N.writes.length - w0 === 1, "writes " + (e.N.writes.length - w0));
});

unit("[sec disk F1][fix B11] conflict \"mine\": disk text that is not a deck is never copied; false (unreadable)", async () => {
  const e = await unitSetup();
  await unitConflict(e);
  e.N.files[U_PATH] = "not a deck\n";
  assert(await e.m.deckIO.resolveConflict("mine") === false && e.m.deckIO.conflictReason() === "unreadable", "accepted");
  assert(ucopies(e.N).length === 0, "copied");
  assert(e.m.state.paused && !e.N.writes.some((w) => w.p === U_PATH), "wrote the deck file");
});

unit("[sec disk F1][fix B11] a listed entry of any type (OTHER) at a copy name is never used", async () => {
  const e = await unitSetup();
  const RealDate = Date;
  const fixed = new Date(2026, 0, 2, 3, 4, 5);
  global.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(fixed.getTime()); } static now() { return RealDate.now(); } };
  try {
    e.N.extraEntries.push({ entry: "A.CONFLICT-20260102-030405.VELA", type: "OTHER" });
    assert(await e.m.writeConflictCopy(U_PATH, utxt(udeck("C"))) === true, "copy failed");
    const c = ucopies(e.N);
    assert(c.length === 1 && /-030405-2\.vela$/.test(c[0]), "used the listed name: " + c);
  } finally { global.Date = RealDate; }
});

unit("[sec disk F1][fix B11] a failed folder list -> no copy write", async () => {
  const e = await unitSetup({ readDirectory: () => new Error("EACCES") });
  const w0 = e.N.writes.length;
  assert(await e.m.writeConflictCopy(U_PATH, utxt(udeck("C"))) === false && e.N.writes.length === w0, "wrote");
});

unit("[sec disk F1][fix B11] a deck path that is not a regular file is not read (choice \"mine\" fails)", async () => {
  let dir = false;
  const e = await unitSetup({ getStats: (p) => (dir && p === U_PATH ? { size: 4096, isFile: false, isDirectory: true } : undefined) });
  await unitConflict(e);
  dir = true;
  const r0 = e.N.reads;
  assert(await e.m.deckIO.resolveConflict("mine") === false && e.m.deckIO.conflictReason() === "unreadable", "accepted");
  assert(e.N.reads === r0, "read a path that is not a file");
});

unit("[sec disk F2][fix B12] a failed choice gives a reason and stays paused; resync and Retry open the choice again", async () => {
  const e = await unitSetup();
  await unitConflict(e);
  e.k.set("reconnecting");
  assert(await e.m.deckIO.resolveConflict("mine") === false && e.m.deckIO.conflictReason() === "offline", "reason " + e.m.deckIO.conflictReason());
  assert(e.m.state.paused, "not paused after a failed choice");
  e.k.set("connected"); await sleep(80);      // resync while paused calls onConflict again
  assert(e.conflicts.length === 2, "resync did not open the choice again: " + e.conflicts.length);
  await e.m.deckIO.flushNow(); await sleep(40);
  assert(e.conflicts.length === 3, "Retry did not open the choice again: " + e.conflicts.length);
});

unit("[rev V9][fix B13] newDeck, openDeck and reselectFolder are refused while an edit is held; the edit is written later", async () => {
  const e = await unitSetup({ files: { "/decks/b.vela": utxt(udeck("B")) } });
  e.k.set("reconnecting");
  const w = e.m.saveCurrent(udeck("HELD")); await sleep(230);
  assert(await e.m.deckIO.newDeck("Other") === null, "newDeck not refused");
  let err = null; try { await e.m.deckIO.openDeck("/decks/b.vela"); } catch (x) { err = x; }
  assert(err && err.code === "VELA_SAVE_HELD" && err.message === "Unsaved changes are waiting to save", "openDeck " + (err && err.message));
  err = null; try { await e.m.deckIO.reselectFolder(); } catch (x) { err = x; }
  assert(err && err.code === "VELA_SAVE_HELD", "reselectFolder not refused");
  assert(e.m.deckIO.currentPath() === U_PATH && e.m.state.pendingDeck.deckTitle === "HELD", "state changed");
  e.k.set("connected"); await sleep(150);
  assert(utitle(e.N) === "HELD" && (await w) === true, "the held edit was not written");
});

unit("[rev V9][fix B13] a switch is refused while paused with an edit", async () => {
  const e = await unitSetup({ files: { "/decks/b.vela": utxt(udeck("B")) } });
  await unitConflict(e);
  let err = null; try { await e.m.deckIO.openDeck("/decks/b.vela"); } catch (x) { err = x; }
  assert(err && err.code === "VELA_SAVE_HELD" && e.m.state.paused && e.cleared === 0, "not refused");
});

unit("[fix B13] no connection view: a switch drops the edit as before", async () => {
  const e = await unitSetup({ files: { "/decks/b.vela": utxt(udeck("B")) } }, { attach: false });
  e.m.saveCurrent(udeck("X"));
  await e.m.deckIO.openDeck("/decks/b.vela");
  assert(!e.m.state.pendingDeck, "edit kept");
});

unit("[rev V4][fix B14] a retired stray is matched only for its time limit: a later outside write of the same bytes is loaded", async () => {
  const h = hangOnce(false);
  const e = await unitSetup({ write: h.write }, { ignoreMs: 0, strayTtl: 1000 });
  e.m.saveCurrent(udeck("S1")); await sleep(330);   // S1 times out: a stray
  e.m.saveCurrent(udeck("S2")); await sleep(300);   // S2 written
  e.k.set("reconnecting"); e.k.set("connected"); await sleep(150);
  assert(e.m.state.strays.length === 1 && e.m.state.strays[0].retired, "test set-up: no retired stray (" + e.m.state.strays.length + ")");
  await sleep(800);                                 // past the time limit
  e.N.files[U_PATH] = utxt(udeck("S1")); ufire(e.N); await sleep(60);
  assert(e.loaded[0] === "S1" && utitle(e.N) === "S1", "loaded=" + e.loaded + " disk=" + utitle(e.N));
  assert(e.m.state.strays.length === 0, "the stray is still kept");
});

unit("[fix B14] a failed resync read keeps the retired stray (not counted) for the next read", async () => {
  let lock = false;
  const e = await unitSetup({ write: hangOnce(false).write, readFile: () => (lock ? new Error("EBUSY") : undefined) });
  e.m.saveCurrent(udeck("S1")); await sleep(330);
  lock = true;
  e.k.set("reconnecting"); e.k.set("connected"); await sleep(150);
  assert(e.m.state.strays.length === 1 && e.m.state.strays[0].retired, "strays " + JSON.stringify(e.m.state.strays.map((s) => s.retired)));
});

// ── Round-3 regressions (re-review round 2: NF1, NF2, NF3, NF5, NF6, NF8) ──

scenario("[rr2 NF1] a heartbeat timer from an older connection does not drop the new healthy socket", async (kind) => {
  const env = await boot(kind);
  env.rt.deadOn = "extensions.getStats";      // the heartbeat gets no reply
  env.fireWin("focus");                        // heartbeat sent on connection 1
  await env.advance(5);
  const opened0 = env.rt.opened;
  env.rt.drop();                               // connection 1 closes
  await env.until(() => env.rt.opened > opened0 && env.sock.state() === "connected", 15000, "reconnect");
  const opened = env.rt.opened, ep = env.sock.epoch();
  await env.advance(21000);                    // longer than the heartbeat time limit
  assert(env.rt.opened === opened && env.sock.epoch() === ep && env.sock.state() === "connected",
    "the stale heartbeat timer dropped the new socket (opened " + opened + " -> " + env.rt.opened + ")");
  assertClean(env);
});

scenario("[rr2 NF2] a heartbeat that waits 16 s behind a slow native call (one call at a time) is not taken as dead", async (kind) => {
  let release = null;
  const env = await bootSock(kind, { heartbeat: () => new Promise((r) => { release = r; }) });
  const a0 = env.rt.attempts;
  env.fireWin("online");
  await env.advance(16000);                    // longer than the 15 s native call bound
  assert(typeof release === "function", "test set-up: no heartbeat");
  release({});
  await env.advance(1000);
  assert(env.rt.attempts === a0 && env.sock.state() === "connected", "a late heartbeat reply was taken as a dead socket");
  assert(env.resumes === 1, "resumes " + env.resumes);
});

unit("[rr2 NF3] deck file missing + pending edit: resync raises the conflict; \"mine\" writes the edit and makes no copy", async () => {
  const e = await unitSetup();
  e.k.set("reconnecting");
  e.m.saveCurrent(udeck("MINE")); await sleep(260);
  delete e.N.files[U_PATH];                    // the file was renamed or deleted outside
  e.k.set("connected");
  for (let i = 0; i < 50 && !e.m.state.paused; i++) await sleep(10);
  assert(e.m.state.paused && e.conflicts.length === 1, "no conflict dialog (syncBlocked=" + e.m.state.syncBlocked + ")");
  assert(!e.m.state.syncBlocked, "saves are still held by the sync block");
  const r = await e.m.deckIO.resolveConflict("mine");
  assert(r === true, "\"mine\" returned " + r + " (" + e.m.deckIO.conflictReason() + ")");
  assert(utitle(e.N) === "MINE", "the edit was not written: " + utitle(e.N));
  assert(ucopies(e.N).length === 0, "a copy was made of a missing file");
});

unit("[rr2 NF5] an outside change refused by the app before it is mounted is loaded when the app is ready", async () => {
  const e = await unitSetup({}, { ready: false, ignoreMs: 0 });
  e.applyResult = false;                       // the app is not mounted yet
  e.N.files[U_PATH] = utxt(udeck("OUTSIDE"));
  ufire(e.N); await sleep(60);
  assert(e.loaded.length === 0, "test set-up: the change was applied");
  e.applyResult = undefined;
  e.m.deckIO.setAppReady();
  for (let i = 0; i < 50 && !e.loaded.length; i++) await sleep(10);
  assert(e.loaded.includes("OUTSIDE"), "the refused outside change was never loaded");
});

unit("[rr2 NF6] resync with an outside change and no pending edit: an app edit that arrives in the grace time is a conflict", async () => {
  const e = await unitSetup({}, { grace: 150 });
  e.N.files[U_PATH] = utxt(udeck("OUTSIDE"));
  e.k.set("reconnecting"); e.k.set("connected"); // resync: quiet time, then the read
  await sleep(80);                             // the resync has read the file
  e.m.saveCurrent(udeck("MINE"));              // the app's debounced edit arrives now
  for (let i = 0; i < 40 && !e.m.state.paused; i++) await sleep(10);
  assert(!e.loaded.includes("OUTSIDE"), "the file version was loaded over the app edit");
  assert(e.m.state.paused && e.conflicts.length === 1, "no conflict");
});

unit("[rr2 NF8] \"Load the file version\" retry after a failure writes no second copy of the same edit", async () => {
  const e = await unitSetup();
  await unitConflict(e);
  e.applyResult = false;                       // the app refuses the load once
  const r1 = await e.m.deckIO.resolveConflict("file");
  assert(r1 === false && e.m.deckIO.conflictReason() === "app", "test set-up: first choice " + r1);
  assert(ucopies(e.N).length === 1, "test set-up: copies " + ucopies(e.N).length);
  e.applyResult = undefined;
  const r2 = await e.m.deckIO.resolveConflict("file");
  assert(r2 === true, "retry returned " + r2);
  assert(ucopies(e.N).length === 1, "a second copy of the same edit was written: " + ucopies(e.N).length);
  assert(utitle(e.N, ucopies(e.N)[0]) === "MINE", "the copy does not hold the edit");
  assert(e.loaded.includes("OUTSIDE"), "the file version was not loaded");
});

unit("[rr2 NF8] a copy deleted between two retries is written again before the edit is dropped", async () => {
  const e = await unitSetup();
  await unitConflict(e);
  e.applyResult = false;
  await e.m.deckIO.resolveConflict("file");
  assert(ucopies(e.N).length === 1, "test set-up: copies " + ucopies(e.N).length);
  delete e.N.files[ucopies(e.N)[0]];          // the user removes the copy
  e.applyResult = undefined;
  const r2 = await e.m.deckIO.resolveConflict("file");
  assert(r2 === true, "retry returned " + r2);
  assert(ucopies(e.N).length === 1, "no copy of the edit on disk: " + ucopies(e.N).length);
  assert(utitle(e.N, ucopies(e.N)[0]) === "MINE", "the copy does not hold the edit");
});

unit("[rr2 NF8] control: a newer edit after a failed choice gets its own copy", async () => {
  const e = await unitSetup();
  await unitConflict(e);
  e.applyResult = false;
  await e.m.deckIO.resolveConflict("file");
  e.m.saveCurrent(udeck("MINE2")); await sleep(10);
  e.applyResult = undefined;
  const r2 = await e.m.deckIO.resolveConflict("file");
  assert(r2 === true, "retry returned " + r2);
  const titles = ucopies(e.N).map((p) => utitle(e.N, p)).sort();
  assert(titles.join(",") === "MINE,MINE2", "copies " + titles.join(","));
});

// ═══════════ Runner ═══════════

(async () => {
  console.log("── desktop reconnect (Neutralino native socket) ──" + (BASELINE ? " [NL_BASELINE=1: old boot, no nl-socket]" : ""));
  if (!REAL.ok) {
    console.log("  ⚠️ SKIP Tier 2 (real neutralino.js client): " + REAL.why);
  }
  for (const sc of SCENARIOS) {
    for (const tier of (sc.once ? [{ id: "unit", kind: "unit" }] : TIERS)) {
      const name = `${sc.name} [${tier.id}]`;
      if (FILTER && !name.includes(FILTER)) { continue; }
      const before = globalErrors.length;
      try {
        await sc.fn(tier.kind);
        if (globalErrors.length > before) throw new Error("uncaught exception: " + globalErrors[before].split("\n")[0]);
        ok(name);
      } catch (e) {
        bad(name, e && e.message ? e.message.split("\n")[0] : String(e));
      }
    }
  }
  if (!REAL.ok) { skipped = SCENARIOS.filter((s) => !s.once).length; console.log(`  ⚠️ SKIP Tier 2: ${skipped} scenario(s) not run against the real client.`); }
  if (unhandled.length) console.log(`  note: ${unhandled.length} unhandled promise rejection(s) seen (not counted as failures)`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
