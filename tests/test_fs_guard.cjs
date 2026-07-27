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
 *   * the physical-path layer: the resolver slot is one-shot (script arriving
 *     after boot cannot swap in one that answers "clean" to everything), a root
 *     whose physical location is unsafe is refused outright, an entry that
 *     redirects out of a root is refused while an ordinary file is not, and an
 *     unreachable resolver degrades instead of bricking the app.
 *
 * The Go side (vela-neutralino/extensions/agent/resolve_test.go) covers the
 * same property against real links on disk; this suite covers the guard's
 * decision-making with the resolver stubbed.
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
  const afterUnsafe = fsGuard.roots();
  check("volume/shallow/system roots refused (allowlist stays empty)", afterUnsafe.length === 0);

  fsGuard.allow("/home/user/.vela");   // legitimate nested root
  check("nested home root accepted", fsGuard.roots().includes("/home/user/.vela"));
  fsGuard.allow("/Users/alice/Documents/Decks"); // legitimate macOS decks folder
  check("nested macOS decks root accepted", fsGuard.roots().includes("/Users/alice/Documents/Decks"));

  // 3. install() wraps Neutralino.filesystem.* and enforces the allowlist.
  const calls = [];
  globalThis.Neutralino = {
    filesystem: {
      readFile: (p) => { calls.push(["readFile", p]); return `READ:${p}`; },
      writeFile: (p, d) => { calls.push(["writeFile", p]); return `WROTE:${p}`; },
      move: (a, b) => { calls.push(["move", a, b]); return `MOVE:${a}->${b}`; },
    },
  };
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

  // ── 4. Physical-path layer ───────────────────────────────────────────────
  //
  // Lexical containment believes the path string. These cover the layer that
  // asks what a path physically is, with the gatekeeper stubbed so the guard's
  // own decisions are what is under test.

  // 4a. No resolver installed yet → verdicts degrade, they do not fabricate.
  check("without a resolver, inspect() reports degraded (never 'clean')",
    (await fsGuard.inspectOne("/home/user/.vela/deck.json")) === "degraded");
  check("without a resolver, a path outside the roots is still unclean",
    (await fsGuard.inspectOne("/etc/passwd")) === "unclean");

  // 4b. The resolver slot is ONE-SHOT. This is what stops deck-borne script —
  // which by definition arrives after boot — from installing a resolver that
  // waves everything through.
  const resolverCalls = [];
  const stub = async ({ base, paths, reveal }) => {
    resolverCalls.push({ base, paths: [...paths], reveal });
    const entries = {};
    for (const p of paths) {
      if (reveal) {
        // "/home/user/Decks" is a link to "/home/user/Dropbox/Decks";
        // "/home/user/Trap" resolves into a system directory.
        if (p === "/home/user/Decks") entries[p] = { path: "/home/user/Dropbox/Decks", clean: true };
        else if (p === "/home/user/Trap") entries[p] = { path: "/etc/cron.d", clean: true };
        else entries[p] = { path: p, clean: true };
      } else {
        if (/escape/.test(p)) entries[p] = { clean: false };
        else if (/ghost/.test(p)) entries[p] = { clean: false, error: "missing" };
        else entries[p] = { clean: true };
      }
    }
    return { entries };
  };
  check("first setResolver() claims the slot", fsGuard.setResolver(stub) === true);
  check("resolver is installed", fsGuard.hasResolver() === true);
  const hostile = async () => ({ entries: {} });
  check("second setResolver() is refused (slot is sealed)", fsGuard.setResolver(hostile) === false);

  // 4c. A root the user pointed at a linked location keeps working, and BOTH
  // forms are registered — the app addresses decks by the name the user picked.
  const linked = await fsGuard.allowVerified("/home/user/Decks");
  check("symlinked decks root is accepted", linked.ok === true && linked.degraded === false);
  check("user-facing root registered", fsGuard.roots().includes("/home/user/Decks"));
  check("physical root registered too", fsGuard.roots().includes("/home/user/Dropbox/Decks"));

  // 4d. Resolution can never launder an unsafe location into the allowlist:
  // a root whose PHYSICAL home is a system directory is refused, and the
  // user-facing name is not left behind either.
  const trap = await fsGuard.allowVerified("/home/user/Trap");
  check("root resolving into a system dir is refused", trap.ok === false);
  check("refused root leaves no entry behind", !fsGuard.roots().includes("/home/user/Trap"));

  // 4e. The reported issue: an entry inside an allowed root that redirects out
  // of it. Lexically indistinguishable from a deck; refused on its physical form.
  check("entry redirecting out of a root is unclean",
    (await fsGuard.inspectOne("/home/user/Decks/escape.vela")) === "unclean");
  check("ordinary deck in the same root is clean",
    (await fsGuard.inspectOne("/home/user/Decks/real.vela")) === "clean");
  check("assertSafe throws on a redirecting entry",
    await rejects(() => fsGuard.assertSafe("/home/user/Decks/escape.vela")));
  check("assertSafe allows an ordinary deck",
    !(await rejects(() => fsGuard.assertSafe("/home/user/Decks/real.vela"))));

  // 4f. A deleted deck is not an attack — callers must be able to tell them
  // apart, and assertSafe must not throw on "gone".
  check("missing path reports 'missing', not 'unclean'",
    (await fsGuard.inspectOne("/home/user/Decks/ghost.vela")) === "missing");
  check("assertSafe does not throw for a missing path",
    !(await rejects(() => fsGuard.assertSafe("/home/user/Decks/ghost.vela"))));

  // 4g. Checks are batched per root and carry the root as `base`, so a linked
  // decks root is not re-walked (and does not condemn every file inside it).
  resolverCalls.length = 0;
  const batch = await fsGuard.inspect([
    "/home/user/Decks/a.vela",
    "/home/user/Decks/escape.vela",
    "/home/user/.vela/config.json",
  ]);
  check("batched inspect returns a verdict per path", batch.size === 3);
  check("batch is grouped by root (one call per root)", resolverCalls.length === 2);
  check("each batch carries its root as base",
    resolverCalls.every((c) => c.base === "/home/user/Decks" || c.base === "/home/user/.vela"));

  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
