// Filesystem path guard for the Neutralino shell.
//
// The webview is granted filesystem.* (to read/write decks and config). If a
// DOM-XSS ever slips past the engine's deck-JSON sanitizers, it runs in the
// same realm as this shell and could call `Neutralino.filesystem.*` directly
// to read or overwrite arbitrary files on the user's machine. This guard
// wraps those methods so every path argument must resolve inside an
// explicitly-allowed root — the user's decks folder and ~/.vela. It caps the
// *file* blast radius; it is not a full sandbox (same-realm JS can never be
// fully contained), but combined with the CSP and the minimal nativeAllowList
// (no os.spawnProcess) it removes the "arbitrary file read/write" capability.
//
// Roots are registered at-source by the modules that own them
// (config-store → ~/.vela, deck-io → the decks folder) so a root is always
// allowed before that module touches the filesystem. install() wraps the
// native methods and must be called once, early in boot.

const roots = [];          // normalized absolute roots, no trailing slash
let installed = false;

function norm(p) {
  return String(p == null ? "" : p).replace(/\\/g, "/").replace(/\/+$/, "");
}

// A normalized path with no segment beyond the volume root would grant an
// entire drive/volume if registered as a root. POSIX "/" already normalizes
// to "" (and is rejected by the empty check); this also catches a bare Windows
// drive spec ("C:", "z:") and a UNC host with no share ("//server"). Real
// decks and ~/.vela always live in a nested folder, so refusing these costs
// nothing and stops either entry point (folder dialog or direct file open)
// from ever widening the guard to a whole volume.
function isVolumeRoot(n) {
  return n === "" || /^[a-zA-Z]:$/.test(n) || /^\/\/[^/]+$/.test(n);
}

function underRoot(p) {
  const n = norm(p);
  if (!n) return false;
  // Reject any path containing a traversal segment outright — defense in
  // depth so a "<root>/../../etc/passwd" can never normalize back inside.
  if (n.split("/").includes("..")) return false;
  return roots.some((r) => n === r || n.startsWith(r + "/"));
}

function guard(method, p) {
  if (!underRoot(p)) {
    throw new Error(`[fs-guard] blocked ${method} outside allowed roots: ${norm(p)}`);
  }
}

// Methods whose FIRST argument is a path.
const ARG0 = [
  "readFile", "readBinaryFile", "writeFile", "writeBinaryFile",
  "appendFile", "appendBinaryFile", "readDirectory", "createDirectory",
  "remove", "getStats", "createWatcher",
];
// Methods whose first TWO arguments are paths (source, destination).
const ARG01 = ["move", "copy"];

export const fsGuard = {
  // Register an absolute directory as an allowed root. Idempotent. Refuses a
  // whole-volume root (see isVolumeRoot) so the guard can never be widened to a
  // full drive — the caller then fails closed (its later reads/writes are
  // blocked) rather than fanning out across the volume.
  allow(root) {
    const n = norm(root);
    if (isVolumeRoot(n)) {
      if (n) console.warn(`[fs-guard] refusing whole-volume root: ${n}`);
      return;
    }
    if (!roots.includes(n)) roots.push(n);
  },
  roots() { return [...roots]; },
  // Wrap Neutralino.filesystem.* in place. Idempotent and safe to call before
  // any root is registered (the wrappers read `roots` at call time).
  install() {
    if (installed) return;
    if (typeof Neutralino === "undefined" || !Neutralino.filesystem) return;
    installed = true;
    const fs = Neutralino.filesystem;
    for (const m of ARG0) {
      const orig = fs[m];
      if (typeof orig !== "function") continue;
      fs[m] = function (path, ...rest) { guard(m, path); return orig.call(fs, path, ...rest); };
    }
    for (const m of ARG01) {
      const orig = fs[m];
      if (typeof orig !== "function") continue;
      fs[m] = function (a, b, ...rest) { guard(m, a); guard(m, b); return orig.call(fs, a, b, ...rest); };
    }
  },
};
