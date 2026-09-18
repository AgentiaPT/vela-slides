/**
 * Neutralino desktop defects — sprint "lantern" regression suite (CR12/16/18/19).
 *
 * Every case drives the REAL source: the shipped standalone-HTML transform from
 * src/parts/part-export-md.jsx, the real vela-neutralino/scripts/sync-vela.py
 * output, and the real resources/js/{nl-boot,agents-bridge}.js bodies. Nothing
 * here re-implements the logic it checks.
 *
 *   CR12  Standalone HTML export failed in the desktop build with
 *         "Identifier 'useState' has already been declared". The generated
 *         resources/vela.jsx carried a UMD shim, and the exporter fetches that
 *         same file and adds a shim of its own. The shim moved into nl-boot.js,
 *         which adds it in memory at transpile time. Proof: run sync-vela.py,
 *         build a real export from its output, and parse the produced script.
 *   CR16  The OS window title must name the open deck.
 *   CR18  Keyboard must work as soon as the window gets focus again.
 *   CR19  AI showed offline on the first launch after a new build, and a rescan
 *         did not help.
 *
 * Usage: node tests/test_desktop_neutralino.cjs  (0 = pass, 1 = fail, 2 = env)
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const NL = path.join(REPO, "vela-neutralino");
const EXPORT_SRC = path.join(REPO, "src/parts/part-export-md.jsx");
const SYNC_PY = path.join(NL, "scripts/sync-vela.py");
const NL_VELA_JSX = path.join(NL, "resources/vela.jsx");
const NL_BOOT = path.join(NL, "resources/js/nl-boot.js");
const BRIDGE = path.join(NL, "resources/js/agents-bridge.js");
const INDEX_HTML = path.join(NL, "resources/index.html");
const CONFIG = path.join(NL, "neutralino.config.json");
const BABEL_PATH = path.join(NL, "resources/vendor/babel.min.js");

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log("  ✅ " + name); }
  else { failed++; console.log("  ❌ " + name + (detail ? " — " + detail : "")); }
}
async function test(name, fn) {
  try { await fn(); check(name, true); }
  catch (e) { check(name, false, e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }

for (const f of [EXPORT_SRC, SYNC_PY, NL_BOOT, BRIDGE, INDEX_HTML, CONFIG, BABEL_PATH]) {
  if (!fs.existsSync(f)) { console.error("missing required file: " + f); process.exit(2); }
}

// ── Extract a top-level `function name(...) { ... }` body from a source file ──
function extractFunction(src, name) {
  const at = src.indexOf("function " + name + "(");
  if (at === -1) throw new Error("function not found: " + name);
  const open = src.indexOf("{", at);
  let depth = 0, i = open, inStr = null, inLine = false, inBlock = false;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inLine) { if (c === "\n") inLine = false; continue; }
    if (inBlock) { if (c === "*" && n === "/") { inBlock = false; i++; } continue; }
    if (inStr) {
      if (c === "\\") { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "/" && n === "/") { inLine = true; i++; continue; }
    if (c === "/" && n === "*") { inBlock = true; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error("unbalanced function body: " + name);
}

// ── Extract a top-level `const NAME = <expr>;` statement ──
function extractConst(src, name) {
  const re = new RegExp("^const " + name + " =[\\s\\S]*?;\\s*$", "m");
  const m = src.match(re);
  if (!m) throw new Error("const not found: " + name);
  return m[0];
}

const bootSrc = fs.readFileSync(NL_BOOT, "utf8");
const bridgeSrc = fs.readFileSync(BRIDGE, "utf8");
const indexHtml = fs.readFileSync(INDEX_HTML, "utf8");
const config = JSON.parse(fs.readFileSync(CONFIG, "utf8"));

// ═══════════════════════════════════════════════════════════════════════════
// CR12 — standalone HTML export from the real desktop source
// ═══════════════════════════════════════════════════════════════════════════

let Babel;
try { Babel = require(BABEL_PATH); }
catch (e) { console.error("could not require vendored babel.min.js: " + e.message); process.exit(2); }

const exportSrc = fs.readFileSync(EXPORT_SRC, "utf8");
const pure = exportSrc.match(/STANDALONE_HTML_PURE_START([\s\S]*?)STANDALONE_HTML_PURE_END/);
if (!pure) { console.error("STANDALONE_HTML_PURE markers missing in part-export-md.jsx"); process.exit(3); }
const sandbox = { window: { Babel }, console, module: { exports: {} } };
vm.createContext(sandbox);
vm.runInContext(pure[1] + "\nmodule.exports = { buildStandaloneHtml };", sandbox);
const { buildStandaloneHtml } = sandbox.module.exports;

const DECK = { deckTitle: "Como ligar", lanes: [{ id: "m1", title: "M", slides: [{ id: "s1", title: "S", blocks: [] }] }] };

// Produce the desktop copy of the monolith exactly as the shell does.
let syncOk = true;
try { execFileSync("python3", [SYNC_PY], { cwd: NL, stdio: "pipe" }); }
catch (e) { syncOk = false; }

// Line-anchored: the monolith also CONTAINS the exporter's own shim as a
// string literal, and that one is mid-line. Only a real top-level
// declaration starts a line.
const HOOK_DECL_RE = /^const\s*\{\s*useState\s*,/gm;

// ── Minimal DOM/window stub: enough for the monolith's TOP-LEVEL evaluation ──
// The export's tail calls window._createRoot(...).render(...), which we stub, so
// a successful run proves the whole exported script evaluates — the exact step
// that failed with "Identifier 'useState' has already been declared".
function makeBootContext(React, Lucide) {
  const el = () => ({
    tagName: "DIV", style: {}, dataset: {}, children: [], childNodes: [],
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    appendChild(c) { this.children.push(c); return c; }, removeChild() {}, remove() {},
    insertBefore(c) { this.children.push(c); return c; }, replaceChildren() { this.children = []; },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    querySelector: () => null, querySelectorAll: () => [], getElementsByTagName: () => [],
    focus() {}, blur() {}, click() {}, contains: () => false, closest: () => null,
    getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    getContext: () => null, scrollIntoView() {}, innerHTML: "", textContent: "", value: "",
  });
  const doc = {
    documentElement: el(), body: el(), head: el(),
    createElement: el, createElementNS: el, createTextNode: (t) => ({ textContent: t }),
    createDocumentFragment: el, getElementById: el,
    querySelector: () => null, querySelectorAll: () => [], getElementsByTagName: () => [],
    addEventListener() {}, removeEventListener() {}, activeElement: null, hidden: false,
    visibilityState: "visible", title: "", fullscreenElement: null, exitFullscreen() {},
    execCommand() {}, hasFocus: () => true,
  };
  const storage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
  const win = {
    React, lucideReact: Lucide, LucideReact: Lucide,
    _createRoot: () => ({ render() {}, unmount() {} }),
    document: doc, localStorage: storage, sessionStorage: storage,
    location: { href: "file:///x", search: "", hash: "", origin: "null", protocol: "file:" },
    navigator: { userAgent: "node", clipboard: {}, platform: "node", language: "en" },
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: clearTimeout,
    setTimeout, clearTimeout, setInterval, clearInterval,
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    innerWidth: 1400, innerHeight: 900, devicePixelRatio: 1, screen: { width: 1400, height: 900 },
    fetch: async () => { throw new Error("no network"); },
    alert() {}, confirm: () => false, prompt: () => null, open: () => null, print() {},
    crypto: { getRandomValues: (a) => a, randomUUID: () => "id" },
    performance: { now: () => Date.now() }, console: { log() {}, warn() {}, error() {}, info() {} },
  };
  win.window = win; win.self = win; win.top = win; win.parent = win;
  const ctx = vm.createContext(win);
  Object.assign(ctx, {
    document: doc, navigator: win.navigator, localStorage: storage, sessionStorage: storage,
    location: win.location, requestAnimationFrame: win.requestAnimationFrame,
    cancelAnimationFrame: win.cancelAnimationFrame, setTimeout, clearTimeout, setInterval, clearInterval,
    console: win.console, fetch: win.fetch, matchMedia: win.matchMedia,
    getComputedStyle: win.getComputedStyle, alert: win.alert, confirm: win.confirm,
    performance: win.performance,
    Event: class { constructor(t) { this.type = t; } },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} unobserve() {} },
    IntersectionObserver: class { observe() {} disconnect() {} unobserve() {} },
    Image: class { set src(_v) {} addEventListener() {} }, Blob: class {}, FileReader: class {},
    URL: globalThis.URL, URLSearchParams: globalThis.URLSearchParams, TextEncoder: globalThis.TextEncoder,
    btoa: globalThis.btoa, atob: globalThis.atob, structuredClone: globalThis.structuredClone,
  });
  return ctx;
}

(async () => {
console.log("CR12 — standalone HTML export (desktop source)");

await test("sync-vela.py runs and writes resources/vela.jsx", () => {
  assert(syncOk, "sync-vela.py failed");
  assert(fs.existsSync(NL_VELA_JSX), "resources/vela.jsx not written");
});

const desktopJsx = syncOk && fs.existsSync(NL_VELA_JSX) ? fs.readFileSync(NL_VELA_JSX, "utf8") : "";

await test("the generated desktop vela.jsx declares NO React-hook shim", () => {
  const hits = desktopJsx.match(HOOK_DECL_RE) || [];
  assert(hits.length === 0,
    `found ${hits.length} hook destructuring declaration(s) — a shim in this file makes the export declare useState twice`);
  assert(!/Neutralino UMD shim \(generated by sync-vela\.py\)/.test(desktopJsx),
    "the generated file still carries the sync-vela.py UMD shim banner");
});

let exported = null;
await test("buildStandaloneHtml() accepts the desktop source without a duplicate declaration", () => {
  assert(desktopJsx.length > 1000, "desktop source not available");
  exported = buildStandaloneHtml(desktopJsx, DECK, { footer: true, babel: Babel });
  assert(typeof exported === "string" && exported.length > 1000, "empty export");
});

await test("the exported HTML parses as JavaScript (no duplicate declaration)", () => {
  assert(exported, "no export produced");
  const body = exported.match(/<div id="root"><\/div>\s*<script>([\s\S]*?)<\/script>/);
  assert(body, "could not find the inlined app <script> block");
  // Real parse of the produced artifact. A duplicate top-level `const` is an
  // early SyntaxError, which is the exact defect CR12 reports.
  new vm.Script(body[1], { filename: "vela-standalone.js" });
  fs.writeFileSync(path.join(require("os").tmpdir(), "vela-cr12-export.html"), exported);
});

await test("the exported HTML BOOTS: top-level evaluation sets __velaBooted", () => {
  assert(exported, "no export produced");
  const code = exported.match(/<div id="root"><\/div>\s*<script>([\s\S]*?)<\/script>/)[1];
  const React = require(path.join(NL, "resources/vendor/react.min.js"));
  const Lucide = require(path.join(NL, "resources/vendor/lucide-react.min.js"));
  const ctx = makeBootContext(React, Lucide);
  vm.runInContext(code, ctx, { filename: "vela-standalone.js" });
  assert(ctx.__velaBootError === undefined, "boot error: " + String(ctx.__velaBootError).slice(0, 300));
  assert(ctx.__velaBooted === true, "the exported app did not boot");
  assert(typeof ctx.App === "function", "App was not declared");
});

await test("NEGATIVE CONTROL: a shim-carrying source still breaks the export", () => {
  // Pin the root cause. If the shim ever returns to the generated file, this
  // case shows the failure the user reported instead of letting it ship.
  const shimmed =
    "const { useState, useReducer, useEffect, useLayoutEffect, useRef, useCallback, useMemo } = React;\n" +
    desktopJsx;
  let threw = false;
  try {
    const html = buildStandaloneHtml(shimmed, DECK, { babel: Babel });
    const body = html.match(/<div id="root"><\/div>\s*<script>([\s\S]*?)<\/script>/);
    new vm.Script(body[1], { filename: "vela-standalone-bad.js" });
  } catch (e) {
    threw = /already been declared|Identifier 'useState'/.test(String(e.message));
  }
  assert(threw, "a doubled shim no longer fails — the regression pin is dead");
});

await test("the exported HTML boots: the mount tail and the deck title are present", () => {
  assert(exported, "no export produced");
  assert(exported.includes("__velaBooted"), "mount tail missing");
  assert(exported.includes("<title>Como ligar</title>"), "deck title missing from the document title");
  assert(!/<\/script/i.test(exported.replace(/<\/script>/g, "")), "an unneutralized </script token survived");
});

await test("the desktop boot path still transpiles: nl-boot shim + generated source", () => {
  const shimDecl = extractConst(bootSrc, "VELA_UMD_SHIM");
  const box = { out: null };
  vm.createContext(box);
  vm.runInContext(shimDecl + "\nout = VELA_UMD_SHIM;", box);
  const shim = box.out;
  assert(/const \{ useState,/.test(shim), "nl-boot shim does not declare the hooks");
  const src = shim + desktopJsx;
  const hits = src.match(HOOK_DECL_RE) || [];
  assert(hits.length === 1, `desktop boot source has ${hits.length} hook declarations, expected 1`);
  // The shim itself must stay valid input for Babel-standalone.
  const { code } = Babel.transform(shim + "function Probe(){ const [a] = useState(0); return <Plus n={a} />; }\n",
    { presets: [["react", { runtime: "classic" }]] });
  assert(typeof code === "string" && code.includes("useState"), "Babel rejected the nl-boot shim");
});

await test("sync-vela.py keeps the VELA_LOCAL_MODE flip", () => {
  assert(desktopJsx.includes("const VELA_LOCAL_MODE = true;"), "VELA_LOCAL_MODE flip lost");
});

// ═══════════════════════════════════════════════════════════════════════════
// CR16 — native window title
// ═══════════════════════════════════════════════════════════════════════════
console.log("CR16 — native window title");

const titleBox = {};
vm.createContext(titleBox);
vm.runInContext(
  extractConst(bootSrc, "VELA_APP_TITLE") + "\n" +
  extractConst(bootSrc, "VELA_TITLE_MAX") + "\n" +
  extractFunction(bootSrc, "velaWindowTitle") + "\n" +
  "this.velaWindowTitle = velaWindowTitle;", titleBox);
const velaWindowTitle = titleBox.velaWindowTitle;

await test('a deck title gives "Vela Slides - <deck title>"', () => {
  assert(velaWindowTitle("Como ligar") === "Vela Slides - Como ligar", velaWindowTitle("Como ligar"));
});

await test("no deck title falls back to plain Vela Slides", () => {
  for (const v of ["", "   ", null, undefined, 42, {}, []]) {
    assert(velaWindowTitle(v) === "Vela Slides", `got ${JSON.stringify(velaWindowTitle(v))} for ${JSON.stringify(v)}`);
  }
});

await test("the app name is never repeated", () => {
  assert(velaWindowTitle("Vela Slides - Como ligar") === "Vela Slides - Como ligar");
  assert(velaWindowTitle("Vela Slides - Vela Slides - Como ligar") === "Vela Slides - Como ligar");
  assert(velaWindowTitle("Vela Slides") === "Vela Slides");
  assert(velaWindowTitle("vela slides: Como ligar") === "Vela Slides - Como ligar");
});

await test("repeated updates are stable (idempotent on its own output)", () => {
  let t = velaWindowTitle("Como ligar");
  for (let i = 0; i < 5; i++) t = velaWindowTitle(t);
  assert(t === "Vela Slides - Como ligar", t);
});

await test("control characters and line separators never reach the native title", () => {
  const t = velaWindowTitle("Como\u0000 li\ngar\u2028x");
  assert(!/[\u0000-\u001f\u007f\u2028\u2029]/.test(t), JSON.stringify(t));
  assert(t.startsWith("Vela Slides - "), t);
});

await test("an over-long deck title is clipped", () => {
  const t = velaWindowTitle("x".repeat(500));
  assert(t.length < 200, "title not clipped: " + t.length);
});

await test("nl-boot applies the title on load, on every deck update and on an external reload", () => {
  assert(/applyWindowTitle\(initialDeck\)/.test(bootSrc), "initial deck title not applied");
  assert(/__velaSendDeckUpdate = \(deck\) => \{ applyWindowTitle\(deck\);/.test(bootSrc),
    "deck updates do not refresh the window title");
  assert(/onDeckLoaded\(\(deck, _path, meta = \{\}\) => \{\s*applyWindowTitle\(deck\);/.test(bootSrc),
    "an externally reloaded deck does not refresh the window title");
  assert(/Neutralino\.window\.setTitle\(title\)/.test(bootSrc), "setTitle is never called");
});

await test("window.setTitle is admitted by the nativeAllowList", () => {
  assert(config.nativeAllowList.includes("window.setTitle"), "window.setTitle missing from nativeAllowList");
  assert(!config.nativeAllowList.some((m) => m.endsWith(".*")), "a namespace wildcard appeared in nativeAllowList");
});

// ═══════════════════════════════════════════════════════════════════════════
// CR18 — keyboard focus after the window gets focus again
// ═══════════════════════════════════════════════════════════════════════════
console.log("CR18 — keyboard focus on window focus");

const focusBox = {};
vm.createContext(focusBox);
vm.runInContext(extractFunction(bootSrc, "velaNeedsFocusRestore") + "\nthis.f = velaNeedsFocusRestore;", focusBox);
const needsRestore = focusBox.f;

await test("focus is restored when nothing (or only body) holds it", () => {
  const body = { tag: "body" }, html = { tag: "html" };
  assert(needsRestore({ body, documentElement: html, activeElement: null }) === true, "null activeElement");
  assert(needsRestore({ body, documentElement: html, activeElement: body }) === true, "body activeElement");
  assert(needsRestore({ body, documentElement: html, activeElement: html }) === true, "documentElement activeElement");
});

await test("focus is NOT taken from a field the user is typing in", () => {
  const body = { tag: "body" }, html = { tag: "html" };
  const input = { tag: "input" };
  assert(needsRestore({ body, documentElement: html, activeElement: input }) === false);
});

await test("nl-boot listens for the native windowFocus event and installs the handler at boot", () => {
  assert(/Neutralino\.events\.on\("windowFocus"/.test(bootSrc), "windowFocus listener missing");
  assert(/window\.addEventListener\("focus", restoreKeyboardFocus\)/.test(bootSrc), "DOM focus listener missing");
  assert(/installFocusRestore\(\);/.test(bootSrc.split("async function boot()")[1] || ""),
    "installFocusRestore() not called during boot");
  assert(config.nativeAllowList.includes("events.on"), "events.on missing from nativeAllowList");
});

await test("#root can take the focus from code without becoming a tab stop", () => {
  assert(/<div id="root" tabindex="-1">/.test(indexHtml), '#root lacks tabindex="-1"');
  assert(/getElementById\("root"\)/.test(bootSrc), "the focus sink is not #root");
});

// ═══════════════════════════════════════════════════════════════════════════
// CR19 — AI offline on the first launch after a new build
// ═══════════════════════════════════════════════════════════════════════════
console.log("CR19 — gatekeeper handshake lifecycle");

// Load the real agents-bridge module body against mocks.
function buildBridge(cfg) {
  let body = bridgeSrc
    .replace(/import\s*\{[^}]*\}\s*from\s*["']\.\/fs-guard\.js["'];?/, "")
    .replace(/import\s*\{[^}]*\}\s*from\s*["']\.\/config-store\.js["'];?/, "")
    .replace("export const agents", "const agents");
  // Shrink the poll so the suite stays fast. The production values are pinned
  // by a separate source assertion below.
  body = body.replace(/const HEALTH_TIMEOUT_MS = \d+;/, "const HEALTH_TIMEOUT_MS = 40;")
             .replace(/const HANDSHAKE_POLL_MS = \d+;/, "const HANDSHAKE_POLL_MS = 300;");
  body += "\n;return { agents, readHandshake, ensureHandshake, extFetch };";
  const factory = new Function(
    "Neutralino", "fsGuard", "configStore", "window", "fetch", "console", body);
  return factory(cfg.Neutralino, cfg.fsGuard, cfg.configStore, cfg.window, cfg.fetch, cfg.console || { warn() {}, error() {}, log() {} });
}

function makeEnv(opts) {
  const files = opts.files;             // { "agent-ext-7000.port": "5001", ... }
  const live = opts.live;               // Set of live ports
  const calls = { health: [], post: [] };
  const Neutralino = {
    os: { getEnv: async (k) => (k === "HOME" ? "/home/u" : null) },
    filesystem: {
      readFile: async (p) => {
        const name = p.split("/").pop();
        if (!(name in files)) throw new Error("ENOENT " + name);
        return files[name];
      },
    },
  };
  const fetchMock = async (url, init) => {
    const port = String(url).match(/localhost:(\d+)/)[1];
    if (String(url).endsWith("/health")) {
      calls.health.push(port);
      if (!live.has(port)) throw new Error("ECONNREFUSED");
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    calls.post.push({ port, token: init.headers["x-vela-token"] });
    if (!live.has(port)) throw new Error("ECONNREFUSED");
    if (opts.deadAfterFirstPost && calls.post.length === 1) throw new Error("ECONNREFUSED");
    return {
      ok: true, status: 200,
      json: async () => ({ ok: true, providers: { "claude-code": { id: "claude-code", label: "Claude Code", available: true, version: "1.0" } } }),
    };
  };
  return {
    calls,
    mod: buildBridge({
      Neutralino,
      fsGuard: { allow() {}, install() {}, roots: () => [] },
      configStore: { getAgent: async () => null, setAgent: async () => {} },
      window: { NL_PORT: "7000" },
      fetch: fetchMock,
    }),
  };
}

await test("a stale unkeyed pair is NOT adopted while this window's own pair is still being written", async () => {
  const files = { "agent-ext.port": "5999", "agent-ext.token": "staletoken" }; // left by a killed run
  const live = new Set();
  const env = makeEnv({ files, live });
  // This window's gatekeeper finishes starting after 150 ms.
  setTimeout(() => {
    files["agent-ext-7000.port"] = "6001";
    files["agent-ext-7000.token"] = "freshtoken";
    live.add("6001");
  }, 150);
  const hs = await env.mod.readHandshake();
  assert(hs, "no handshake read");
  assert(hs.port === "6001", `adopted port ${hs.port} — expected this window's own 6001`);
  assert(hs.token === "freshtoken", "adopted the stale token");
});

await test("a handshake pair is accepted only after the gatekeeper answers /health", async () => {
  const files = { "agent-ext-7000.port": "6002", "agent-ext-7000.token": "t" };
  const live = new Set();                       // files on disk, nothing listening
  const env = makeEnv({ files, live });
  const hs = await env.mod.readHandshake();
  assert(hs === null, "a dead port was accepted as a live handshake");
  assert(env.calls.health.length > 0, "no /health probe was made");
});

await test("a dead channel is not cached for the session: the next attempt re-reads the files", async () => {
  const files = { "agent-ext-7000.port": "6003", "agent-ext-7000.token": "t1" };
  const live = new Set(["6003"]);
  const env = makeEnv({ files, live, deadAfterFirstPost: true });
  let firstFailed = false;
  try { await env.mod.agents.detect(); } catch { firstFailed = true; }
  // detect() swallows the failure, so check the observable state instead.
  assert(env.mod.agents.available() === false, "reported available after a failed probe");
  // The gatekeeper is restarted on a new port, as a new build does.
  delete files["agent-ext-7000.port"]; delete files["agent-ext-7000.token"];
  live.delete("6003");
  files["agent-ext-7000.port"] = "6004"; files["agent-ext-7000.token"] = "t2";
  live.add("6004");
  const up = await env.mod.agents.detect();     // this is what a manual rescan does
  assert(up === true, "the rescan did not reach the gatekeeper");
  assert(env.mod.agents.available() === true, "the rescan did not bring AI online");
  const lastPost = env.calls.post[env.calls.post.length - 1];
  assert(lastPost.port === "6004" && lastPost.token === "t2",
    `the rescan still used ${lastPost.port}/${lastPost.token} — the dead pair stayed cached`);
  void firstFailed;
});

await test("a live handshake is reused and not re-read on every call", async () => {
  const files = { "agent-ext-7000.port": "6005", "agent-ext-7000.token": "t" };
  const env = makeEnv({ files, live: new Set(["6005"]) });
  await env.mod.agents.detect();
  const afterFirst = env.calls.health.length;
  await env.mod.agents.detect();
  assert(env.calls.health.length === afterFirst, "the live handshake was re-probed");
});

await test("the production poll bounds stay sane", () => {
  const h = bridgeSrc.match(/const HEALTH_TIMEOUT_MS = (\d+);/);
  const p = bridgeSrc.match(/const HANDSHAKE_POLL_MS = (\d+);/);
  assert(h && p, "poll bounds not declared");
  assert(Number(h[1]) >= 500 && Number(h[1]) <= 3000, "health timeout out of range");
  assert(Number(p[1]) >= 2000 && Number(p[1]) <= 15000, "handshake poll out of range");
  assert(/handshake = null;\s*\n\s*throw e;/.test(bridgeSrc), "a transport failure no longer clears the cached pair");
});

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
})();
