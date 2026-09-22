// meridian CR16 / CR18 / CR19 — Neutralino desktop glue, headless.
//
// The Neutralino GUI cannot run in CI, so this loads the REAL webview modules
// (window-glue.js, agents-bridge.js), strips their ESM import/export, and
// evaluates them against a mocked Neutralino API, a fake DOM event target and
// (for CR19) a fake clock + fake gatekeeper. Same style as test_deck_io_save.cjs.
//
//   CR16  window title = "Vela Slides - <Deck Title>", plain "Vela Slides"
//         with no title, never a doubled "Vela Slides", updates on change.
//   CR18  a refocus signal (DOM focus / visibilitychange / native windowFocus)
//         re-calls Neutralino.window.focus() — keyboard works without a click.
//   CR19  the probe loop does not give up before the startup budget, and a
//         stale cached handshake is dropped so a rescan can reconnect.

const fs = require("fs");
const path = require("path");

const JS = path.join(__dirname, "..", "vela-neutralino", "resources", "js");
let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✅ " + n); };
const bad = (n, d) => { fail++; console.log("  ❌ " + n + (d ? " — " + d : "")); };
const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };
async function test(name, fn) { try { await fn(); ok(name); } catch (e) { bad(name, e.message); } }
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

function stripEsm(src) {
  return src.replace(/^import\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?\s*$/gm, "").replace(/^export\s+(?=(async\s+)?function|const)/gm, "");
}

// ── fake DOM ──
function makeTarget() {
  const l = {};
  return {
    l,
    addEventListener(t, f) { (l[t] = l[t] || []).push(f); },
    fire(t) { (l[t] || []).forEach((f) => f({ type: t })); },
  };
}

function loadGlue(Neu) {
  const win = makeTarget(), doc = makeTarget();
  doc.visibilityState = "visible";
  const body = stripEsm(fs.readFileSync(path.join(JS, "window-glue.js"), "utf8")) +
    "\n;return { windowTitleFor, setWindowTitle, focusWindow, installRefocus };";
  // eslint-disable-next-line no-new-func
  const mod = new Function("Neutralino", "window", "document", body)(Neu, win, doc);
  return { mod, win, doc };
}

function makeNeu() {
  const calls = { setTitle: [], focus: 0, events: {} };
  return {
    calls,
    window: {
      setTitle: (t) => { calls.setTitle.push(t); return Promise.resolve(); },
      focus: () => { calls.focus++; return Promise.resolve(); },
    },
    events: { on: (name, f) => { calls.events[name] = f; } },
  };
}

(async () => {
  // ─────────── CR16 ───────────
  await test("meridian-CR16 title template: 'Vela Slides - <Deck Title>'", () => {
    const { mod } = loadGlue(makeNeu());
    assert(mod.windowTitleFor("Q3 Planning") === "Vela Slides - Q3 Planning", mod.windowTitleFor("Q3 Planning"));
  });
  await test("meridian-CR16 no title -> plain 'Vela Slides' (no trailing ' - ')", () => {
    const { mod } = loadGlue(makeNeu());
    for (const v of ["", "   ", null, undefined, 42, { toString: () => "x" }, ["a"]]) {
      assert(mod.windowTitleFor(v) === "Vela Slides", `for ${String(v)} got ${mod.windowTitleFor(v)}`);
    }
  });
  await test("meridian-CR16 never doubles 'Vela Slides'", () => {
    const { mod } = loadGlue(makeNeu());
    for (const v of ["Vela Slides", "vela slides", "Vela Slides — Demo", "Vela Slides - X"]) {
      const t = mod.windowTitleFor(v);
      assert((t.match(/vela slides/gi) || []).length === 1, `${v} -> ${t}`);
    }
  });
  await test("meridian-CR16 control/bidi chars stripped, length capped", () => {
    const { mod } = loadGlue(makeNeu());
    const t = mod.windowTitleFor("A‮B\u0000C" + "x".repeat(500));
    assert(!/[\u0000-\u001f‮]/.test(t), "control chars left");
    assert(t.length <= "Vela Slides - ".length + 200, "not capped: " + t.length);
  });
  await test("meridian-CR16 setWindowTitle calls Neutralino.window.setTitle, updates on change, no repeat", () => {
    const Neu = makeNeu();
    const { mod } = loadGlue(Neu);
    mod.setWindowTitle("Deck A");
    mod.setWindowTitle("Deck A");     // unchanged -> no extra native call
    mod.setWindowTitle("Deck B");     // title edit / deck switch
    mod.setWindowTitle("");           // title cleared
    const want = ["Vela Slides - Deck A", "Vela Slides - Deck B", "Vela Slides"];
    assert(JSON.stringify(Neu.calls.setTitle) === JSON.stringify(want), JSON.stringify(Neu.calls.setTitle));
  });
  await test("meridian-D1 'Untitled' sentinel maps to plain 'Vela Slides'", () => {
    const { mod } = loadGlue(makeNeu());
    assert(mod.windowTitleFor("Untitled") === "Vela Slides", mod.windowTitleFor("Untitled"));
  });
  await test("meridian-D3 bidi/line-separator controls stripped from title", () => {
    const { mod } = loadGlue(makeNeu());
    const t = mod.windowTitleFor("\u061cRTL\u2028B\u2029C");
    assert(!/[\u061c\u2028\u2029]/.test(t), "bidi/line-separator chars left: " + JSON.stringify(t));
    assert(t === "Vela Slides - RTLBC", t);
  });
  await test("meridian-CR16 nl-boot wires the app hook; part-app calls it", () => {
    const boot = fs.readFileSync(path.join(JS, "nl-boot.js"), "utf8");
    const app = fs.readFileSync(path.join(__dirname, "..", "src", "parts", "part-app.jsx"), "utf8");
    assert(/window\.__velaOnDeckTitle\s*=\s*setWindowTitle/.test(boot), "nl-boot does not install __velaOnDeckTitle");
    assert(/window\.__velaOnDeckTitle\(state\.deckTitle/.test(app), "part-app does not call __velaOnDeckTitle");
  });

  // ─────────── CR18 ───────────
  await test("meridian-CR18 DOM window focus re-calls Neutralino.window.focus()", async () => {
    const Neu = makeNeu();
    const { mod, win } = loadGlue(Neu);
    mod.installRefocus();
    assert(Neu.calls.focus === 0, "focus called before any event");
    win.fire("focus");
    assert(Neu.calls.focus >= 1, "no native focus on window focus event");
  });
  await test("meridian-CR18 native windowFocus and visibilitychange also re-arm focus", async () => {
    const Neu = makeNeu();
    const { mod, doc } = loadGlue(Neu);
    mod.installRefocus();
    assert(typeof Neu.calls.events.windowFocus === "function", "windowFocus listener not registered");
    Neu.calls.events.windowFocus();
    const afterNative = Neu.calls.focus;
    assert(afterNative >= 1, "no focus on native windowFocus");
    await tick(700);                  // latch expires
    doc.fire("visibilitychange");
    assert(Neu.calls.focus > afterNative, "no focus on visibilitychange");
  });
  await test("meridian-CR18 every alt-tab cycle re-arms focus (not only the first)", async () => {
    const Neu = makeNeu();
    const { mod, win } = loadGlue(Neu);
    mod.installRefocus();
    win.fire("focus"); const a = Neu.calls.focus;
    await tick(700);
    win.fire("focus");
    assert(Neu.calls.focus > a, "second refocus ignored");
  });

  await test("meridian-D2 blur cancels pending focus retries", async () => {
    const Neu = makeNeu();
    const { mod, win } = loadGlue(Neu);
    mod.focusWindow();
    const afterImmediate = Neu.calls.focus;
    win.fire("blur");
    await tick(500);                  // past both the 120ms and 400ms retries
    assert(Neu.calls.focus === afterImmediate, "a retry fired after blur: " + Neu.calls.focus);
  });
  await test("meridian-D2 hidden (visibilitychange) also cancels pending retries", async () => {
    const Neu = makeNeu();
    const { mod, doc } = loadGlue(Neu);
    mod.focusWindow();
    const afterImmediate = Neu.calls.focus;
    doc.visibilityState = "hidden";
    doc.fire("visibilitychange");
    await tick(500);
    assert(Neu.calls.focus === afterImmediate, "a retry fired after hidden: " + Neu.calls.focus);
  });
  await test("meridian-D2 refocus-on-return still works after a blur", async () => {
    const Neu = makeNeu();
    const { mod, win } = loadGlue(Neu);
    mod.installRefocus();
    mod.focusWindow();
    win.fire("blur");                 // cancels the pending retries above
    await tick(10);
    win.fire("focus");                // user comes back
    assert(Neu.calls.focus > 1, "no re-arm on return: " + Neu.calls.focus);
  });

  // ─────────── CR19 ───────────
  function loadAgents(gk) {
    // gk: { up(): bool (handshake files present), port, agentFrom (fake ms) }
    const files = {};
    const Neu = {
      os: { getEnv: async (k) => (k === "HOME" ? "/home/u" : "") },
      filesystem: {
        readFile: async (p) => { if (!(p in files)) throw new Error("ENOENT"); return files[p]; },
      },
    };
    let t = 0;                                       // fake clock (ms)
    const clock = { now: () => t, wait: async (ms) => { t += Math.max(ms, 1); } };
    const fetchCalls = [];
    const fetchMock = async (url, opts) => {
      fetchCalls.push(url);
      t += 50;
      const port = String(new URL(url).port);
      if (port !== String(gk.port)) throw new TypeError("Failed to fetch"); // dead (stale) port
      if (opts.headers["x-vela-token"] !== gk.token) return { status: 401, ok: false, json: async () => ({}) };
      const avail = t >= gk.agentFrom;
      return { status: 200, ok: true, json: async () => ({ ok: true, providers: { "claude-code": { id: "claude-code", label: "Claude Code", available: avail, version: avail ? "1.0" : null } } }) };
    };
    const src = stripEsm(fs.readFileSync(path.join(JS, "agents-bridge.js"), "utf8"))
      .replace("const sleep = (ms) => new Promise((r) => setTimeout(r, ms));", "const sleep = async (ms) => { __clock.wait(ms); };") +
      "\n;return { agents };";
    const fsGuard = { allow() {} };
    const configStore = { getAgent: async () => null, setAgent: async () => {} };
    const win = { NL_PORT: "7000" };
    // eslint-disable-next-line no-new-func
    const { agents } = new Function("Neutralino", "fsGuard", "configStore", "window", "fetch", "__clock", "AbortController", src)(
      Neu, fsGuard, configStore, win, fetchMock, clock, AbortController);
    const setFiles = (port, token) => { files["/home/u/.vela/agent-ext-7000.port"] = String(port); files["/home/u/.vela/agent-ext-7000.token"] = token; };
    return { agents, clock, setFiles, fetchCalls, getT: () => t, setT: (v) => { t = v; } };
  }

  await test("meridian-CR19 agent that appears late (20s) is found inside the 45s budget", async () => {
    const gk = { port: 5001, token: "tok", agentFrom: 20000 };
    const h = loadAgents(gk);
    h.setFiles(5001, "tok");
    let attempts = 0;
    const found = await h.agents.probeUntilReady({ deadline: 45000, onAttempt: () => attempts++, now: h.clock.now, wait: h.clock.wait });
    assert(found === true, "gave up before the agent appeared (t=" + h.getT() + ", attempts=" + attempts + ")");
    assert(h.getT() >= 20000 && h.getT() < 45000, "t=" + h.getT());
    assert(attempts > 3, "the old 3-empty-answer cutoff is back (attempts=" + attempts + ")");
  });
  await test("meridian-CR19 genuine negative stops at the deadline (no endless loop)", async () => {
    const gk = { port: 5001, token: "tok", agentFrom: Infinity };
    const h = loadAgents(gk);
    h.setFiles(5001, "tok");
    const found = await h.agents.probeUntilReady({ deadline: 45000, now: h.clock.now, wait: h.clock.wait });
    assert(found === false, "reported found");
    assert(h.getT() >= 45000 && h.getT() < 50000, "stopped at t=" + h.getT());
  });
  await test("meridian-CR19 stale handshake (old port) is dropped; retry reaches the new gatekeeper", async () => {
    const gk = { port: 5002, token: "new", agentFrom: 0 };
    const h = loadAgents(gk);
    h.setFiles(4999, "old");                 // left over by a previous run
    const first = await h.agents.detect();   // hits the dead port
    assert(first === false, "stale port answered?");
    h.setFiles(5002, "new");                 // the slow new gatekeeper writes its files
    const found = await h.agents.probeUntilReady({ deadline: h.getT() + 10000, now: h.clock.now, wait: h.clock.wait });
    assert(found === true, "rescan kept using the stale cached port");
    assert(h.agents.available() === true, "not available after reconnect");
  });
  await test("meridian-CR19 gatekeeper slow to write handshake files is still found", async () => {
    const gk = { port: 5003, token: "t3", agentFrom: 0 };
    const h = loadAgents(gk);
    let n = 0;
    const found = await h.agents.probeUntilReady({
      deadline: 45000, now: h.clock.now, wait: h.clock.wait,
      onAttempt: () => { if (++n === 4) h.setFiles(5003, "t3"); },
    });
    assert(found === true, "not found after files appeared");
  });
  await test("meridian-CR19 nl-boot boot loop and rescan both use probeUntilReady; no new native call", () => {
    const boot = fs.readFileSync(path.join(JS, "nl-boot.js"), "utf8");
    assert((boot.match(/agents\.probeUntilReady\(/g) || []).length === 2, "boot + refresh must share the probe loop");
    assert(!/emptyTries/.test(boot), "old early-exit counter still present");
    const bridge = fs.readFileSync(path.join(JS, "agents-bridge.js"), "utf8");
    assert(!/Neutralino\.os\.spawnProcess\(|extensions\.dispatch\(/.test(bridge), "bridge must never spawn");
  });

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
