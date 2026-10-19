// CR19 - desktop AI "offline" after a new build until restart; Rescan did not help.
//
// Root cause (reproduced here against the REAL agents-bridge.js):
//   1. readHandshake() read the keyed file (agent-ext-<NL_PORT>.*) AND the
//      unkeyed legacy file (agent-ext.*) in the same poll pass. On a slow first
//      launch (new build: AV scan of the new gatekeeper exe) the keyed file is
//      not written yet, so a stale unkeyed file from an earlier run won.
//   2. extFetch() dropped the cached handshake only on HTTP 401. A dead port
//      makes fetch() THROW (connection refused), so the stale handshake stayed
//      cached for the whole session: every boot retry and every manual Rescan
//      hit the same dead port. A restart worked because the fast exe wrote the
//      keyed file first.
// Fix pinned here: keyed file is waited for before the unkeyed one; any
// transport failure drops the cache; Rescan (detect({fresh:true})) re-reads.
//
// The source is loaded with its ESM imports stripped and run with a mock
// Neutralino.filesystem / os.getEnv and a mock fetch.

const fs = require("fs");
const path = require("path");

const SRC_PATH = process.env.AGENTS_BRIDGE_SRC ||
  path.join(__dirname, "..", "vela-neutralino", "resources", "js", "agents-bridge.js");
const SRC = fs.readFileSync(SRC_PATH, "utf8");

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✅ " + n); };
const bad = (n, d) => { fail++; console.log("  ❌ " + n + (d ? " — " + d : "")); };
const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };
async function test(name, fn) { try { await fn(); ok(name); } catch (e) { bad(name, e.message); } }

const HOME = "/home/u";
const DIR = HOME + "/.vela";

// Build an isolated module instance. `files` is a live map path->content the
// test can change between calls; `servers` maps port -> {token, providers}.
function build({ files, servers, nlPort, logs }) {
  let body = SRC
    .replace(/import\s*\{[^}]*\}\s*from\s*["']\.\/fs-guard\.js["'];?/, "")
    .replace(/import\s*\{[^}]*\}\s*from\s*["']\.\/config-store\.js["'];?/, "")
    .replace("export const agents", "const agents")
    // Fast poll: the real 150 ms x 20 window is a timing detail, not behaviour.
    .replace(/const sleep = \(ms\) => new Promise\(\(r\) => setTimeout\(r, ms\)\);/,
      "const sleep = () => new Promise((r) => setImmediate(r));");
  body += "\n;return { agents };";
  const reads = [];
  const Neutralino = {
    os: { getEnv: async (k) => (k === "HOME" ? HOME : "") },
    filesystem: {
      readFile: async (p) => {
        reads.push(p);
        if (!(p in files)) throw new Error("NE_FS_NOPATHE");
        return files[p];
      },
    },
  };
  const fetchCalls = [];
  const tokensSent = []; // [port, token] for every request that carried a token
  const fetchMock = async (url, init) => {
    const u = new URL(url);
    const port = String(u.port);
    fetchCalls.push(port);
    const tok = init && init.headers && init.headers["x-vela-token"];
    if (tok != null) tokensSent.push([port, tok]);
    const srv = servers[port];
    if (!srv) throw new TypeError("Failed to fetch"); // connection refused
    // Another local HTTP server now owns the port: same reply for every path.
    if (srv.foreign) {
      const f = srv.foreign;
      return { status: f.status, ok: f.status >= 200 && f.status < 300,
        json: async () => { if (f.body === undefined) throw new SyntaxError("not json"); return f.body; } };
    }
    if (u.pathname === "/health") {
      return { status: 200, ok: true, json: async () => ({ ok: true }) };
    }
    if (init.headers["x-vela-token"] !== srv.token) {
      return { status: 401, ok: false, json: async () => ({ ok: false, error: "unauthorized" }) };
    }
    if (srv.status && srv.status !== 200) {
      return { status: srv.status, ok: false, json: async () => ({ ok: false, error: "agent failed" }) };
    }
    return { status: 200, ok: true, json: async () => ({ ok: true, providers: srv.providers, text: "hi" }) };
  };
  const windowMock = nlPort == null ? {} : { NL_PORT: nlPort };
  const fsGuard = { allow() {} };
  const configStore = { getAgent: async () => null, setAgent: async () => {} };
  const rec = (...a) => logs.push(a.map(String).join(" "));
  const consoleMock = { log: rec, warn: rec, error: rec, info: rec, debug: rec };
  // eslint-disable-next-line no-new-func
  const mod = new Function("Neutralino", "fetch", "window", "fsGuard", "configStore", "console", body)(
    Neutralino, fetchMock, windowMock, fsGuard, configStore, consoleMock);
  return { ...mod, reads, fetchCalls, tokensSent };
}

const PROVIDERS = { "claude-code": { id: "claude-code", label: "Claude Code", available: true, version: "1" } };
const STALE = { [`${DIR}/agent-ext.port`]: "1111", [`${DIR}/agent-ext.token`]: "stale-token" };
const keyed = (nl, port, token) => ({
  [`${DIR}/agent-ext-${nl}.port`]: port, [`${DIR}/agent-ext-${nl}.token`]: token,
});

(async () => {
  await test("first launch: stale unkeyed file + late keyed file -> Rescan recovers (CR19 repro)", async () => {
    const files = { ...STALE };             // leftover from an earlier run; port 1111 is dead
    const servers = {};                     // new gatekeeper not up yet (AV scan)
    const logs = [];
    const m = build({ files, servers, nlPort: 4242, logs });
    const up1 = await m.agents.detect();
    assert(up1 === false, "gatekeeper cannot be up yet");
    assert(!m.agents.available(), "AI offline while gatekeeper starts");
    // The slow gatekeeper now writes its keyed handshake and listens.
    Object.assign(files, keyed(4242, "2222", "fresh-token"));
    servers["2222"] = { token: "fresh-token", providers: PROVIDERS };
    const up2 = await m.agents.detect({ fresh: true }); // Rescan
    assert(up2 === true, "Rescan must reach the new gatekeeper");
    assert(m.agents.available(), "AI must be available after Rescan");
  });

  await test("boot retry (no fresh flag) also recovers after a dead cached port", async () => {
    const files = { ...STALE };
    const servers = {};
    const m = build({ files, servers, nlPort: 4242, logs: [] });
    await m.agents.detect();
    Object.assign(files, keyed(4242, "2222", "fresh-token"));
    servers["2222"] = { token: "fresh-token", providers: PROVIDERS };
    assert(await m.agents.detect() === true, "plain retry must re-read after a transport failure");
  });

  await test("keyed file that appears during the poll window wins over a stale unkeyed file", async () => {
    const files = { ...STALE };
    const servers = { "2222": { token: "fresh-token", providers: PROVIDERS } };
    const m = build({ files, servers, nlPort: 4242, logs: [] });
    let n = 0;
    const orig = m.reads.push.bind(m.reads);
    m.reads.push = (p) => { if (++n === 5) Object.assign(files, keyed(4242, "2222", "fresh-token")); return orig(p); };
    assert(await m.agents.detect() === true, "must use the keyed handshake");
    assert(!m.fetchCalls.includes("1111"), "must never contact the stale port: " + m.fetchCalls.join(","));
  });

  await test("unkeyed file is still used when NL_PORT is unknown", async () => {
    const files = { [`${DIR}/agent-ext.port`]: "3333", [`${DIR}/agent-ext.token`]: "t3" };
    const servers = { "3333": { token: "t3", providers: PROVIDERS } };
    const m = build({ files, servers, nlPort: null, logs: [] });
    assert(await m.agents.detect() === true);
  });

  await test("unkeyed fallback still works when the gatekeeper missed the stdin handshake", async () => {
    const files = { [`${DIR}/agent-ext.port`]: "3333", [`${DIR}/agent-ext.token`]: "t3" };
    const servers = { "3333": { token: "t3", providers: PROVIDERS } };
    const m = build({ files, servers, nlPort: 4242, logs: [] });
    assert(await m.agents.detect() === true);
  });

  await test("401 drops the cached handshake (token rotated)", async () => {
    const files = { ...keyed(4242, "2222", "old") };
    const servers = { "2222": { token: "new", providers: PROVIDERS } };
    const m = build({ files, servers, nlPort: 4242, logs: [] });
    assert(await m.agents.detect() === false);
    files[`${DIR}/agent-ext-4242.token`] = "new";
    assert(await m.agents.detect() === true);
  });

  await test("agent error (non-OK) drops the handshake; next call re-reads and still works (W4)", async () => {
    const files = { ...keyed(4242, "2222", "tk") };
    const servers = { "2222": { token: "tk", providers: PROVIDERS } };
    const m = build({ files, servers, nlPort: 4242, logs: [] });
    assert(await m.agents.detect() === true);
    servers["2222"].status = 500;
    const before = m.reads.length;
    let err = "";
    try { await m.agents.send({ messages: [] }); } catch (e) { err = String(e && e.message); }
    assert(err === "agent failed", "send must surface the gatekeeper's error text, got: " + err);
    servers["2222"].status = 200;
    const r = await m.agents.send({ messages: [] });
    assert(r.text === "hi", "send must work after the re-read");
    assert(m.reads.length > before, "handshake files must be re-read after a non-OK reply");
  });

  // W4 (CR19 follow-up): the stale cached port now serves ANOTHER local HTTP
  // server. Any non-OK / non-JSON / wrong-shape reply must drop the cache so a
  // plain boot retry recovers, and the token must never reach that server.
  const FOREIGN = [
    ["404 JSON", { status: 404, body: { error: "not found" } }],
    ["500 JSON", { status: 500, body: { ok: false } }],
    ["200 non-JSON", { status: 200, body: undefined }],
    ["200 wrong shape", { status: 200, body: { hello: "world" } }],
    ["200 array", { status: 200, body: [1, 2] }],
  ];
  for (const [label, reply] of FOREIGN) {
    await test(`foreign server on the stale port (${label}) -> cache dropped, token never sent, retry recovers`, async () => {
      const files = { ...keyed(4242, "2222", "tk") };
      const servers = { "2222": { token: "tk", providers: PROVIDERS } };
      const m = build({ files, servers, nlPort: 4242, logs: [] });
      assert(await m.agents.detect() === true, "first detect reaches the gatekeeper");
      // The gatekeeper exits; an unrelated server takes port 2222.
      servers["2222"] = { foreign: reply };
      const sentBefore = m.tokensSent.length;
      assert(await m.agents.detect() === false, "foreign server is not the gatekeeper");
      assert(!m.agents.available(), "AI must be offline while the gatekeeper is gone");
      // A new gatekeeper writes a new keyed handshake; a plain retry recovers.
      Object.assign(files, keyed(4242, "3333", "tk2"));
      servers["3333"] = { token: "tk2", providers: PROVIDERS };
      assert(await m.agents.detect() === true, "plain retry must re-read the handshake files");
      const leaked = m.tokensSent.slice(sentBefore).filter(([p]) => p === "2222");
      assert(leaked.length === 0, "token sent to the foreign server: " + leaked.length);
    });
  }

  await test("authed reply with the wrong shape drops the cache (W4)", async () => {
    // Identity probe passes ({ok:true} for every path) but /detect has no providers.
    const files = { ...keyed(4242, "2222", "tk") };
    const servers = { "2222": { foreign: { status: 200, body: { ok: true } } } };
    const m = build({ files, servers, nlPort: 4242, logs: [] });
    assert(await m.agents.detect() === false, "wrong shape is not a gatekeeper answer");
    Object.assign(files, keyed(4242, "3333", "tk2"));
    servers["3333"] = { token: "tk2", providers: PROVIDERS };
    assert(await m.agents.detect() === true, "retry must re-read after a wrong-shape reply");
  });

  await test("identity probe runs before every token-bearing call and carries no token (W4)", async () => {
    const files = { ...keyed(4242, "2222", "tk") };
    const servers = { "2222": { token: "tk", providers: PROVIDERS } };
    const m = build({ files, servers, nlPort: 4242, logs: [] });
    assert(await m.agents.detect() === true);
    await m.agents.send({ messages: [] });
    await m.agents.send({ messages: [] });
    assert(m.fetchCalls.length === 6, "3 probes + 3 authed calls, got " + m.fetchCalls.length);
    assert(m.tokensSent.length === 3, "probe must not carry the token");
  });

  await test("port taken over after a good detect: token not sent on the next send (W4)", async () => {
    const files = { ...keyed(4242, "2222", "tk") };
    const servers = { "2222": { token: "tk", providers: PROVIDERS } };
    const m = build({ files, servers, nlPort: 4242, logs: [] });
    assert(await m.agents.detect() === true);
    servers["2222"] = { foreign: { status: 404, body: { error: "nope" } } };
    const before = m.tokensSent.length;
    let threw = false;
    try { await m.agents.send({ messages: [] }); } catch { threw = true; }
    assert(threw, "send must fail");
    assert(m.tokensSent.length === before, "token must not reach the foreign server");
  });

  await test("tokens and handshake are never written to the console", async () => {
    const logs = [];
    const files = { ...STALE };
    const m = build({ files, servers: {}, nlPort: 4242, logs });
    await m.agents.detect();
    let err = "";
    try { await m.agents.send({ messages: [] }); } catch (e) { err = String(e && e.message); }
    const all = logs.join("\n") + "\n" + err;
    assert(!all.includes("stale-token") && !all.includes("1111"), "secret leaked: " + all);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
