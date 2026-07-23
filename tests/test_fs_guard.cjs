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
 *     ("…/../etc") can never normalize back inside.
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

  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
