// Native connection layer for the Neutralino client (sleep / hibernate recovery).
//
// Problem: the pinned Neutralino client (v6.9.0) opens ONE WebSocket to the
// runtime in init() and never opens another. After sleep, hibernate or a
// network change the socket closes (or stays OPEN but dead). From then on every
// native call is queued forever (socket not open) or sent into a dead socket
// and never settles. Saves and file sync stop with no error.
//
// Fix: during Neutralino.init() only, we replace window.WebSocket with a hook.
// The hook captures the ONE runtime socket and gives the client a facade
// object instead. The facade owns the real socket and opens a new one to the
// same runtime URL when the old one drops. The client code is not changed:
// it sees "open" again, drains its queue, and sends new calls on the new
// socket. A call that was in flight on the dropped socket stays unsettled, as
// in the plain client: we never make up a reply. A made-up rejection reached
// callers that treat any error as "empty" or "missing" and then wrote over
// real data. Callers that must not wait forever (deck-io) bound their own calls.
//
// Security posture (desktop shell, see vela-neutralino/SECURITY.md):
//   - No new native method and no new window property. The hook replaces the
//     existing window.WebSocket only while init() runs; nl-boot restores it in
//     a `finally` right after init().
//   - The runtime URL holds the connect token. It stays inside this closure:
//     it is never logged, never stored elsewhere, never put in an error or a
//     status. This module has no console call at all.
//   - Only a URL with the exact runtime shape is captured. Any other URL goes
//     to the original WebSocket unchanged, so the hook cannot become a way to
//     redirect or observe an unrelated connection.
//   - The hook is installed only when NL_MODE is exactly "window" (the shipped
//     mode). In that mode the runtime and the webview are one process, so no
//     other process can take the runtime port while this page lives and get a
//     reconnect (with the token) from us. Other modes keep the plain client.
//   - We never make up a frame: no invented reply, success or error.

// Backoff between reconnect attempts. It stays at the last value: the runtime
// is local, so a slow constant retry is cheap and recovers fast after wake.
const BACKOFF_MS = [250, 500, 1000, 2000, 4000, 5000];
// A reconnect attempt that is still CONNECTING after this time is dead (for
// example a socket that hangs after resume). Without it one stuck attempt
// would block every later attempt ("one at a time").
const CONNECT_TIMEOUT_MS = 5000;
// The backoff goes back to the first step only after a socket stayed open
// this long. A runtime that accepts and then closes each new socket must not
// get a new socket (and a full resync) every 250 ms forever.
const STABLE_OPEN_MS = 10000;
// The only runtime mode in which we capture the socket (see the header).
const CAPTURE_MODE = "window";

const ST_CONNECTING = 0;
const ST_OPEN = 1;

export function createNlSocket(opts = {}) {
  const win = opts.win || window;
  const setT = opts.setTimeout || win.setTimeout;
  const clearT = opts.clearTimeout || win.clearTimeout;

  let Orig = null;          // the original WebSocket constructor
  let Hook = null;          // our replacement while init() runs
  let hooked = false;       // Hook is (or was) on win.WebSocket and not yet restored
  let captured = false;     // the runtime socket was captured
  let runtimeUrl = null;    // connect URL with the token: closure-only, never exposed
  let first = null;         // the first real socket (made by the client's init)
  let cur = null;           // the current real socket (null while none is usable)
  let everOpen = false;     // the first socket opened at least one time
  let terminal = false;     // the client closed the facade (invalid token): no reconnect
  let st = "idle";
  let ep = 0;
  let backoffIdx = 0;
  let backoffTimer = null;
  let connectTimer = null;
  let stableTimer = null;   // runs while the current socket is open; resets the backoff
  const changeSubs = new Set();
  const listeners = { open: [], message: [], close: [], error: [] };

  // ── state ──
  function notify() {
    const snap = { state: st, epoch: ep };
    for (const cb of [...changeSubs]) {
      // A subscriber failure must not stop the socket layer or the other
      // subscribers. Never log: the event is not useful and logs are not ours.
      try { cb(snap); } catch { /* swallowed */ }
    }
  }
  function setState(s) {
    if (st === s) return;
    st = s;
    notify();
  }

  // ── facade listeners ──
  function dispatch(type, ev) {
    const list = listeners[type];
    if (!list) return;
    for (const fn of list.slice()) {
      // A client listener that throws must not break the socket layer.
      try { fn(ev); } catch { /* swallowed */ }
    }
  }

  // ── URL match: capture ONLY the runtime socket the client builds ──
  function expectedHost() {
    return win.NL_GINJECTED || win.NL_CINJECTED ? "127.0.0.1" : (win.location && win.location.hostname);
  }
  function isRuntimeUrl(url) {
    // Type-check first: a non-string (object with toString) is never captured.
    if (typeof url !== "string") return false;
    let u;
    try { u = new URL(url); } catch { return false; }
    if (u.protocol !== "ws:") return false;
    // Loopback only, and the same host the client computes. A remote host is
    // never captured, so the token in the URL is never sent off this machine
    // by a reconnect.
    if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return false;
    if (u.hostname !== expectedHost()) return false;
    const port = win.NL_PORT == null ? "" : String(win.NL_PORT);
    if (!port || u.port !== port) return false;
    // Extra check (not in the client URL shape): no credentials in the URL.
    if (u.username || u.password) return false;
    if (u.pathname !== "/" || u.hash) return false;
    const keys = [...u.searchParams.keys()];
    if (keys.length !== 1 || keys[0] !== "connectToken") return false;
    return true;
  }

  // ── timers ──
  function clearBackoff() { if (backoffTimer != null) { clearT(backoffTimer); backoffTimer = null; } }
  function clearConnect() { if (connectTimer != null) { clearT(connectTimer); connectTimer = null; } }
  function clearStable() { if (stableTimer != null) { clearT(stableTimer); stableTimer = null; } }
  function closeQuietly(s) {
    // Its events are ignored because it is no longer `cur`.
    try { s.close(); } catch { /* already closed */ }
  }

  // ── reconnect ──
  function scheduleAttempt(now) {
    if (terminal) return;
    clearBackoff();
    if (now) { attempt(); return; }
    const delay = BACKOFF_MS[Math.min(backoffIdx, BACKOFF_MS.length - 1)];
    backoffIdx++;
    backoffTimer = setT(() => { backoffTimer = null; attempt(); }, delay);
  }
  function attemptFailed(s) {
    if (s !== cur) return;
    clearConnect();
    clearStable();
    cur = null;
    closeQuietly(s);
    scheduleAttempt(false);
  }
  function attempt() {
    // One attempt at a time: a second socket while one is CONNECTING would
    // race and could leave two live sockets to the runtime.
    if (terminal || cur) return;
    let s;
    try { s = new Orig(runtimeUrl); } catch {
      // Do not keep or log the error: it can hold the URL.
      scheduleAttempt(false);
      return;
    }
    cur = s;
    wire(s);
    clearConnect();
    connectTimer = setT(() => {
      connectTimer = null;
      if (s === cur && s.readyState === ST_CONNECTING) attemptFailed(s);
    }, CONNECT_TIMEOUT_MS);
  }
  function drop(now) {
    const old = cur;
    cur = null;
    clearConnect();
    // A drop before STABLE_OPEN_MS keeps the backoff growing (open-then-close flap).
    clearStable();
    // cur is null first, so a subscriber that calls the client now sees
    // readyState CLOSED and the client queues the call for the next socket.
    setState("reconnecting");
    if (old) closeQuietly(old);
    scheduleAttempt(now);
  }

  // ── real socket events ──
  function wire(s) {
    s.addEventListener("open", (ev) => {
      if (s !== cur) { closeQuietly(s); return; } // a replaced socket: never use it
      everOpen = true;
      clearBackoff();
      clearConnect();
      // Reset the backoff only when this socket stays open STABLE_OPEN_MS.
      // drop() and attemptFailed() clear this timer.
      clearStable();
      stableTimer = setT(() => {
        stableTimer = null;
        if (s === cur && !terminal) backoffIdx = 0;
      }, STABLE_OPEN_MS);
      ep++;
      st = "connected";
      // The client sees "open" first, so it drains its queued calls (oldest
      // first) before a state subscriber can send new calls.
      dispatch("open", ev);
      notify();
    });
    s.addEventListener("message", (ev) => {
      // Only the current socket may deliver replies or events. A replaced
      // socket is closed and no longer ours: its late frames are dropped.
      if (s !== cur || terminal) return;
      dispatch("message", ev);
    });
    s.addEventListener("error", (ev) => {
      if (!everOpen && s === first) {
        // The first connection failed: keep the client's error page, as before.
        dispatch("error", ev);
        return;
      }
      if (s !== cur || terminal) return;
      // After a good connection an error means the socket is gone. Reconnect
      // instead of letting the client wipe the page. Never log the event.
      if (s.readyState === ST_CONNECTING) attemptFailed(s);
      else drop(false);
    });
    s.addEventListener("close", (ev) => {
      if (s !== cur) return;
      if (terminal) { cur = null; dispatch("close", ev); return; }
      if (!everOpen) {
        // The first connection never opened: same terminal result as today.
        terminal = true;
        cur = null;
        clearBackoff();
        clearConnect();
        clearStable();
        setState("closed");
        dispatch("close", ev);
        return;
      }
      if (st === "connected") drop(false);
      else attemptFailed(s);
    });
  }

  // ── facade given to the client instead of a WebSocket ──
  const facade = {
    CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3,
    get readyState() {
      if (terminal || !cur) return 3;
      return cur.readyState;
    },
    send(data) {
      // Fixed text only: the message must never hold the URL or the frame.
      if (!cur || cur.readyState !== ST_OPEN) throw new Error("Native connection is not open");
      cur.send(data);
    },
    close(code, reason) {
      // The client closes only for an invalid token. That is final: a
      // reconnect would only repeat the same refused token.
      terminal = true;
      clearBackoff();
      clearConnect();
      clearStable();
      const s = cur;
      setState("closed");
      if (s) {
        try {
          if (code === undefined) s.close();
          else s.close(code, reason);
        } catch { /* already closed */ }
      }
    },
    addEventListener(type, fn) {
      const list = listeners[type];
      if (!list || typeof fn !== "function" || list.includes(fn)) return;
      list.push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners[type];
      if (!list) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
  };

  // ── public controller ──
  function install() {
    if (hooked || captured) return; // idempotent
    // Fail closed: only the exact shipped mode (see the header). Any other
    // value, or no value, leaves window.WebSocket alone; state stays "idle"
    // and deck-io keeps its plain behaviour.
    if (win.NL_MODE !== CAPTURE_MODE) return;
    const O = win.WebSocket;
    if (typeof O !== "function") return;
    Orig = O;
    Hook = function WebSocket(url, protocols) {
      // Capture only while hooked, only once, and only the runtime URL.
      if (hooked && !captured && protocols === undefined && isRuntimeUrl(url)) {
        captured = true;
        runtimeUrl = url;
        restore();
        const s = new Orig(url);
        first = s;
        cur = s;
        st = "connecting";
        wire(s);
        notify();
        return facade;
      }
      return protocols === undefined ? new Orig(url) : new Orig(url, protocols);
    };
    for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) Hook[k] = Orig[k];
    Hook.prototype = Orig.prototype;
    hooked = true;
    win.WebSocket = Hook;
  }

  function restore() {
    if (!hooked) return;
    // After this the hook passes every call through (hooked = false), even if
    // another script still holds a reference to it.
    hooked = false;
    if (win.WebSocket === Hook) win.WebSocket = Orig;
  }

  function forceReconnect() {
    if (terminal || st === "idle" || st === "connecting" || st === "closed") return;
    if (st === "connected") { drop(true); return; }
    // "reconnecting": an attempt in flight is the right one; do not start a
    // second socket. Else skip the backoff wait and try now.
    if (cur && cur.readyState === ST_CONNECTING) return;
    clearBackoff();
    attempt();
  }

  return {
    install,
    restore,
    state: () => st,
    epoch: () => ep,
    onChange(cb) {
      if (typeof cb !== "function") return () => {};
      changeSubs.add(cb);
      return () => { changeSubs.delete(cb); };
    },
    forceReconnect,
  };
}

// ── Resume watch ──
// The OS gives no reliable "resumed" event to the webview. We use cheap
// signals (focus, online, long hidden time, timer drift) and confirm with ONE
// bounded native call (the heartbeat). A dead socket that stays OPEN is only
// found this way. Any reply to the heartbeat (success or error) proves the
// socket is alive; only the timeout means dead.

// The runtime answers native calls one at a time, so the heartbeat can wait
// behind a slow disk call. deck-io bounds each of its calls at 15 s
// (NATIVE_CALL_TIMEOUT_MS). This bound must be longer, or a heartbeat queued
// behind a slow save is taken as a dead socket (tests/test_desktop.py pins it).
const HEARTBEAT_TIMEOUT_MS = 20000;
const DRIFT_TICK_MS = 5000;
// A tick that comes this much later than planned means the machine slept.
const DRIFT_RESUME_MS = 20000;
// Hidden this long counts as a resume (the OS can suspend a hidden webview).
const HIDDEN_RESUME_MS = 30000;
const SIGNAL_KINDS = new Set(["focus", "online", "resume", "suspect"]);

export function createResumeWatch(opts = {}) {
  const { sock, heartbeat, onResume } = opts;
  const win = opts.win || window;
  const doc = opts.doc || win.document;
  const setT = opts.setTimeout || win.setTimeout;
  const clearT = opts.clearTimeout || win.clearTimeout;
  const setI = opts.setInterval || win.setInterval;
  const clearI = opts.clearInterval || win.clearInterval;
  const now = opts.now || Date.now;

  let started = false;
  let inFlight = false;
  let sawResume = false; // an "online"/"resume" signal came for this heartbeat
  let hiddenAt = 0;
  let lastTick = 0;
  let tickTimer = null;

  const onFocus = () => signal("focus");
  const onOnline = () => signal("online");
  const isHidden = () => !!doc && (doc.visibilityState === "hidden" || doc.hidden === true);
  const onVisibility = () => {
    // A new drift baseline: the hidden time is measured by hiddenAt, not by
    // the drift detector (no second "resume" for the same hidden period).
    lastTick = now();
    if (isHidden()) { hiddenAt = now(); return; }
    const hiddenFor = hiddenAt ? now() - hiddenAt : 0;
    hiddenAt = 0;
    signal(hiddenFor >= HIDDEN_RESUME_MS ? "resume" : "focus");
  };
  const onTick = () => {
    const t = now();
    const late = t - lastTick > DRIFT_RESUME_MS;
    lastTick = t;
    // A hidden (minimized) webview gets its timers throttled to about one
    // tick per minute, so every tick is "late". Ignore drift while hidden, or
    // a minimized window would resync each minute. The visible change after
    // HIDDEN_RESUME_MS or more is the resume signal for that case.
    if (isHidden()) return;
    if (late) signal("resume");
  };

  function runResume() {
    // onResume returns a promise (deck-io resync). A rejection here must not
    // reach the page-level unhandledrejection handler (it shows an error page).
    try {
      const r = onResume && onResume();
      if (r && typeof r.then === "function") r.then(() => {}, () => {});
    } catch { /* swallowed */ }
  }

  function finish(alive) {
    const resume = sawResume;
    inFlight = false;
    sawResume = false;
    if (!alive) { sock.forceReconnect(); return; }
    if (resume) runResume();
  }

  function signal(kind) {
    if (!SIGNAL_KINDS.has(kind)) return;
    const s = sock.state();
    if (s === "closed" || s === "idle" || s === "connecting") return;
    if (s === "reconnecting") { sock.forceReconnect(); return; }
    const isResume = kind === "online" || kind === "resume";
    // One heartbeat at a time: a burst of signals (focus storms) must not
    // flood the runtime. Remember only whether a resume kind came.
    if (inFlight) { sawResume = sawResume || isResume; return; }
    inFlight = true;
    sawResume = isResume;
    let p;
    try { p = heartbeat ? heartbeat() : null; } catch (e) { p = Promise.reject(e); }
    if (p == null) { finish(true); return; } // nothing to probe
    let done = false;
    // The connection that carries this heartbeat.
    const sentEpoch = sock.epoch();
    // Bound the heartbeat: on a dead-but-OPEN socket the call never settles.
    const timer = setT(() => {
      if (done) return;
      done = true;
      // WHY: the socket of this heartbeat closed and the socket layer already
      // replaced it (or is replacing it). No reply on the OLD socket says
      // nothing about the new one; a reconnect now would drop a healthy
      // socket and the native calls in flight on it.
      if (sock.epoch() !== sentEpoch || sock.state() !== "connected") {
        inFlight = false;
        sawResume = false;
        return;
      }
      finish(false);
    }, HEARTBEAT_TIMEOUT_MS);
    Promise.resolve(p).then(
      () => { if (done) return; done = true; clearT(timer); finish(true); },
      () => {
        if (done) return;
        done = true;
        clearT(timer);
        // An error reply came back over the socket, so the socket is alive.
        finish(true);
      },
    );
  }

  function start() {
    if (started) return;
    started = true;
    win.addEventListener("focus", onFocus);
    win.addEventListener("online", onOnline);
    if (doc) doc.addEventListener("visibilitychange", onVisibility);
    lastTick = now();
    tickTimer = setI(onTick, DRIFT_TICK_MS);
  }

  function stop() {
    if (!started) return;
    started = false;
    win.removeEventListener("focus", onFocus);
    win.removeEventListener("online", onOnline);
    if (doc) doc.removeEventListener("visibilitychange", onVisibility);
    if (tickTimer != null) { clearI(tickTimer); tickTimer = null; }
  }

  return { start, stop, signal };
}
