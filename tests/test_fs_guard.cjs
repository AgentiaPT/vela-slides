/**
 * Neutralino filesystem-guard behavioral regression (CI-gated).
 *
 * Loads the REAL fs-guard.js ESM (the singleton the shell imports) and exercises
 * the guard end-to-end against a fake Neutralino.filesystem, so the desktop
 * file-access hardening cannot silently regress:
 *
 *   * the exported capability is frozen — same-realm script cannot neutralize
 *     the guard by reassigning its methods;
 *   * allow() refuses a whole-volume root AND a shallow single-segment POSIX
 *     root (/etc, /home, …), shrinking the blast radius of the widening
 *     primitive; a legitimately nested root (~/.vela) is accepted;
 *   * reads/writes outside the allowed roots throw, and a traversal segment
 *     ("…/../etc") can never normalize back inside;
 *   * the confinement layer: a root whose physical location is unsafe is
 *     refused outright, an entry that leads out of a root is refused while an
 *     ordinary deck is not, a deleted deck stays distinguishable from an
 *     escape, and an unreachable gatekeeper degrades instead of fabricating a
 *     verdict or bricking the app.
 *
 * The gatekeeper is stubbed at the TRANSPORT (globalThis.fetch, installed
 * before the module is imported), not by injecting a resolver — the guard has
 * no injection point, and the transport capture is itself part of what is under
 * test. Confinement itself is covered against real links on disk by the Go
 * suite, vela-neutralino/extensions/agent/resolve_test.go.
 *
 * Usage:  node tests/test_fs_guard.cjs   (exit 0 = all pass)
 */
const path = require("path");
const { pathToFileURL } = require("url");

const GUARD = path.resolve(__dirname, "..", "vela-neutralino", "resources", "js", "fs-guard.js");

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
}
function throws(fn) { try { fn(); return false; } catch (_) { return true; } }
async function rejects(fn) { try { await fn(); return false; } catch (_) { return true; } }

// ── Fake host ─────────────────────────────────────────────────────────────
// Installed BEFORE the guard is imported, because the bridge captures fetch at
// module-init time. Anything installed afterwards would (correctly) be ignored.

const fsCalls = [];
globalThis.Neutralino = {
  os: { getEnv: async (k) => (k === "HOME" ? "/home/user" : "") },
  filesystem: {
    readFile: (p) => {
      fsCalls.push(["readFile", p]);
      if (p.endsWith("agent-ext.port")) return "40000";
      if (p.endsWith("agent-ext.token")) return "tok";
      return `READ:${p}`;
    },
    writeFile: (p) => { fsCalls.push(["writeFile", p]); return `WROTE:${p}`; },
    move: (a, b) => { fsCalls.push(["move", a, b]); return `MOVE:${a}->${b}`; },
  },
};

// Stub gatekeeper. `gatekeeperUp` toggles reachability so the degraded path is
// exercised against the real retry logic.
let gatekeeperUp = false;
const wire = [];
globalThis.fetch = async (url, init) => {
  if (!gatekeeperUp) throw new Error("connection refused");
  const req = JSON.parse(init.body);
  wire.push({ url, token: init.headers["x-vela-token"], ...req });
  if (req.reveal) {
    // "/home/user/Decks" leads to "/home/user/Dropbox/Decks";
    // "/home/user/Trap" leads into a system directory.
    const map = {
      "/home/user/Decks": "/home/user/Dropbox/Decks",
      "/home/user/Trap": "/etc/cron.d",
    };
    return jsonRes({ ok: true, path: map[req.root] || req.root });
  }
  const entries = {};
  for (const n of req.names) {
    if (/escape/.test(n)) entries[n] = { ok: false, error: "escapes" };
    else if (/ghost/.test(n)) entries[n] = { ok: false, error: "missing" };
    else entries[n] = { ok: true };
  }
  return jsonRes({ ok: true, entries });
};
function jsonRes(obj) {
  return { ok: true, status: 200, json: async () => obj };
}

(async () => {
  const { fsGuard } = await import(pathToFileURL(GUARD).href);

  console.log("── fs-guard behavioral suite ──");

  // 1. The exported capability is frozen (methods cannot be swapped out).
  check("fsGuard is frozen", Object.isFrozen(fsGuard));
  check("reassigning fsGuard.allow is rejected", throws(() => {
    "use strict";
    fsGuard.allow = () => {};
  }));

  // 2. allow() refuses volume + shallow roots; accepts a nested root.
  fsGuard.allow("/");            // volume root
  fsGuard.allow("");             // empty
  fsGuard.allow("/etc");         // shallow single-segment
  fsGuard.allow("/home");        // shallow single-segment
  fsGuard.allow("C:");           // bare Windows drive
  fsGuard.allow("//server");     // UNC host, no share
  fsGuard.allow("/etc/cron.d");  // nested system dir (depth 2)
  fsGuard.allow("/var/www");     // nested system dir
  fsGuard.allow("/usr/local/bin"); // deeper system dir
  fsGuard.allow("C:/Windows/System32"); // nested Windows system dir
  check("volume/shallow/system roots refused (allowlist stays empty)", fsGuard.roots().length === 0);

  fsGuard.allow("/home/user/.vela");   // legitimate nested root
  check("nested home root accepted", fsGuard.roots().includes("/home/user/.vela"));
  fsGuard.allow("/Users/alice/Documents/Decks"); // legitimate macOS decks folder
  check("nested macOS decks root accepted", fsGuard.roots().includes("/Users/alice/Documents/Decks"));

  // 3. install() wraps Neutralino.filesystem.* and enforces the allowlist.
  fsGuard.install();

  check("read inside allowed root succeeds",
    Neutralino.filesystem.readFile("/home/user/.vela/deck.json") === "READ:/home/user/.vela/deck.json");
  check("write outside allowed root is blocked",
    throws(() => Neutralino.filesystem.writeFile("/etc/passwd", "x")));
  check("shallow root that was refused stays unreadable",
    throws(() => Neutralino.filesystem.readFile("/etc/passwd")));
  check("move blocked when destination is outside roots",
    throws(() => Neutralino.filesystem.move("/home/user/.vela/a", "/etc/b")));
  check("traversal segment cannot escape an allowed root",
    throws(() => Neutralino.filesystem.readFile("/home/user/.vela/../../../etc/passwd")));

  // ── 4. Confinement layer ─────────────────────────────────────────────────
  //
  // Lexical containment believes the path string. This layer asks the
  // gatekeeper whether a name actually stays inside its folder.

  // 4a. Unreachable gatekeeper → degrade, never fabricate. This is an
  // availability state, not a verdict: refusing to open decks because a helper
  // process is still warming up would break the app over a non-attack.
  check("unreachable gatekeeper reports degraded (never 'clean')",
    (await fsGuard.inspectOne("/home/user/.vela/deck.json")) === "degraded");
  // Lexical containment still stands on its own with no gatekeeper at all.
  check("path outside the roots is unclean even while degraded",
    (await fsGuard.inspectOne("/etc/passwd")) === "unclean");

  gatekeeperUp = true;

  // 4b. A root the user pointed elsewhere keeps working, and BOTH forms are
  // registered — the app addresses decks by the name the user picked.
  const linked = await fsGuard.allowVerified("/home/user/Decks");
  check("root that leads elsewhere is accepted", linked.ok === true && linked.degraded === false);
  check("user-facing root registered", fsGuard.roots().includes("/home/user/Decks"));
  check("physical root registered too", fsGuard.roots().includes("/home/user/Dropbox/Decks"));
  check("gatekeeper requests are token-authenticated", wire.every((w) => w.token === "tok"));

  // 4c. Resolution can never launder an unsafe location into the allowlist: a
  // root whose PHYSICAL home is a system directory is refused, and the
  // user-facing name is not left behind either.
  const trap = await fsGuard.allowVerified("/home/user/Trap");
  check("root leading into a system dir is refused", trap.ok === false);
  check("refused root leaves no entry behind", !fsGuard.roots().includes("/home/user/Trap"));

  // 4d. The reported issue: an entry inside an allowed root that leads out of
  // it. Lexically indistinguishable from a deck; refused on where it leads.
  check("entry leading out of a root is unclean",
    (await fsGuard.inspectOne("/home/user/Decks/escape.vela")) === "unclean");
  check("ordinary deck in the same root is clean",
    (await fsGuard.inspectOne("/home/user/Decks/real.vela")) === "clean");
  check("assertSafe throws on an escaping entry",
    await rejects(() => fsGuard.assertSafe("/home/user/Decks/escape.vela")));
  check("assertSafe allows an ordinary deck",
    !(await rejects(() => fsGuard.assertSafe("/home/user/Decks/real.vela"))));

  // 4e. A deleted deck is not an attack — callers must be able to tell them
  // apart, and assertSafe must not throw on "gone".
  check("missing path reports 'missing', not 'unclean'",
    (await fsGuard.inspectOne("/home/user/Decks/ghost.vela")) === "missing");
  check("assertSafe does not throw for a missing path",
    !(await rejects(() => fsGuard.assertSafe("/home/user/Decks/ghost.vela"))));

  // 4f. Names cross the wire ROOT-RELATIVE (os.Root takes relative names), and
  // one call per root is what makes vetting a folder listing cheap.
  wire.length = 0;
  const batch = await fsGuard.inspect([
    "/home/user/Decks/a.vela",
    "/home/user/Decks/sub/b.vela",
    "/home/user/.vela/config.json",
  ]);
  check("batched inspect returns a verdict per path", batch.size === 3);
  check("one gatekeeper call per root", wire.length === 2);
  check("names are sent root-relative, never absolute",
    wire.every((w) => w.names.every((n) => !n.startsWith("/"))));
  check("nested name keeps its subpath", wire.some((w) => w.names.includes("sub/b.vela")));

  // 4g. A path outside every root never reaches the gatekeeper at all — the
  // lexical check short-circuits it.
  wire.length = 0;
  check("out-of-root path is refused without a round trip",
    (await fsGuard.inspectOne("/etc/shadow")) === "unclean" && wire.length === 0);

  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
