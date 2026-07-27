// Filesystem path guard for the Neutralino shell.
//
// The webview is granted filesystem.* (to read/write decks and config). If a
// DOM-XSS ever slips past the engine's deck-JSON sanitizers, it runs in the
// same realm as this shell and could call `Neutralino.filesystem.*` directly
// to read or overwrite arbitrary files on the user's machine. This guard
// wraps those methods so every path argument must be inside an
// explicitly-allowed root — the user's decks folder and ~/.vela. It caps the
// *file* blast radius; it is not a full sandbox (same-realm JS can never be
// fully contained), but combined with the CSP and the minimal nativeAllowList
// (no os.spawnProcess) it removes the "arbitrary file read/write" capability.
//
// Containment has TWO layers, and the distinction matters:
//
//   1. Lexical (sync, always on). Path strings are normalized and prefix-
//      matched against the roots; traversal segments are refused. This is what
//      guard() enforces on every wrapped call.
//   2. Physical (async, opt-in per call site). Lexical containment alone
//      believes the path string. An entry inside a root that redirects
//      elsewhere satisfies every string test while the OS reads or writes
//      somewhere else entirely — and nothing in the Neutralino client API can
//      tell the difference from in here (no realpath; getStats reports neither
//      links nor reparse points). allowVerified()/inspect()/assertSafe() ask
//      the gatekeeper extension what a path physically is, and callers fail
//      closed on the answer.
//
// Layer 2 narrows a check-then-use gap rather than closing it: the check
// happens in the gatekeeper and the read or write happens afterwards in this
// process, so a local attacker who can swap a path between the two still wins
// the race. See vela-neutralino/SECURITY.md for the standing limits.
//
// Roots are registered at-source by the modules that own them
// (config-store → ~/.vela, deck-io → the decks folder) so a root is always
// allowed before that module touches the filesystem. install() wraps the
// native methods and must be called once, early in boot.

const roots = [];          // normalized absolute roots, no trailing slash
let installed = false;

// Physical-path resolver, injected once at boot (see resolve-bridge.js).
// Containment above is LEXICAL: it compares strings. A path every component of
// which reads as inside a root can still land elsewhere once the OS resolves
// it, and the Neutralino client API offers no way to tell from in here. The
// resolver closes that gap by asking the gatekeeper what a path physically is.
//
// SECURITY: one-shot. Once set (or once a boot has declined to set one) the
// slot is sealed, so script arriving later — by definition after boot, i.e.
// through deck content — cannot swap in a resolver that answers "clean" to
// everything. Sealing on the FIRST call, not on success, is deliberate: a
// failed boot must not leave the slot open for a second caller to claim.
let resolver = null;
let resolverSealed = false;

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

// Beyond a bare volume root, refuse a *shallow* absolute POSIX root — a single
// top-level segment such as /etc, /usr, /home, /var, /tmp, /root. Every real
// trust root (~/.vela, a user-chosen decks folder) is nested at least two
// segments deep, so refusing single-segment roots costs nothing and shrinks the
// blast radius of the allow() widening primitive: even code that reaches allow()
// cannot register a whole system directory as a trust root. Defense in depth —
// NOT a complete boundary (same-realm JS is never fully contained; see header).
function isShallowRoot(n) {
  if (n.startsWith("/") && !n.startsWith("//")) {
    return n.split("/").filter(Boolean).length < 2;
  }
  return false;
}

// OS-critical directory subtrees that a user's decks folder or ~/.vela can never
// legitimately live in, but that an attacker reaching allow() would target for
// credential theft / persistence (ssh keys, cron, shell profiles, service units).
// Refusing these — and anything nested under them — costs the app nothing and
// caps the blast radius at depth ≥ 2 that isShallowRoot leaves open (e.g.
// /etc/cron.d). Deliberately EXCLUDES home roots (/home, /Users, /root) so a
// legitimate ~/.vela is never refused. On a non-root user the OS already denies
// these paths; this layer additionally protects a run-as-root install. Defense
// in depth — NOT a complete boundary (same-realm JS is never fully contained).
const SYSTEM_ROOTS = [
  "/etc", "/usr", "/bin", "/sbin", "/lib", "/lib32", "/lib64", "/boot",
  "/dev", "/proc", "/sys", "/run", "/var", "/srv", "/opt",
  "c:/windows", "c:/program files", "c:/program files (x86)", "c:/programdata",
];
function isSystemRoot(n) {
  const l = n.toLowerCase();
  return SYSTEM_ROOTS.some((r) => l === r || l.startsWith(r + "/"));
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

// Longest registered root containing `n`. Used as the resolver's `base`: the
// root was vetted when it was registered, so re-walking it on every file check
// would be wasted work — and would wrongly condemn every file inside a root the
// user deliberately pointed at a linked location (the common
// "~/Decks → ~/Dropbox/Decks" setup).
function rootFor(n) {
  let best = "";
  for (const r of roots) {
    if ((n === r || n.startsWith(r + "/")) && r.length > best.length) best = r;
  }
  return best;
}

function isUnsafeRoot(n) {
  return isVolumeRoot(n) || isShallowRoot(n) || isSystemRoot(n);
}

function addRoot(n) {
  if (!n || isUnsafeRoot(n)) return false;
  if (!roots.includes(n)) roots.push(n);
  return true;
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
    if (isUnsafeRoot(n)) {
      if (n) console.warn(`[fs-guard] refusing unsafe root: ${n}`);
      return;
    }
    addRoot(n);
  },
  roots() { return [...roots]; },

  // Install the physical-path resolver. One-shot (see the `resolver` comment).
  // Returns true if this call claimed the slot.
  setResolver(fn) {
    if (resolverSealed) return false;
    resolverSealed = true;
    resolver = typeof fn === "function" ? fn : null;
    return true;
  },
  hasResolver() { return !!resolver; },

  // Register a root after asking the OS where it physically is.
  //
  // Both the path the user named and its physical location are registered: the
  // app addresses decks through the name the user picked, while the physical
  // form is what any later whole-path check will see. Each form still faces the
  // volume/shallow/system-root refusals, so resolution can never launder an
  // unsafe root into the allowlist.
  //
  // Returns { ok, degraded }. `degraded` means the root is registered but its
  // physical location could not be established — the per-file checks below
  // still apply, so this is a weaker guarantee, not an absent one.
  async allowVerified(root) {
    const n = norm(root);
    if (isUnsafeRoot(n)) {
      if (n) console.warn(`[fs-guard] refusing unsafe root: ${n}`);
      return { ok: false, degraded: false };
    }
    if (!resolver) {
      addRoot(n);
      return { ok: true, degraded: true };
    }
    let res = null;
    try { res = await resolver({ paths: [n], reveal: true }); } catch { res = null; }
    const entry = res && res.entries ? res.entries[n] : null;
    if (!entry || entry.error) {
      // Unreachable gatekeeper, or a root that no longer exists. Registering
      // lexically keeps the app usable; the caller's own existence check
      // reports a genuinely missing folder.
      addRoot(n);
      return { ok: true, degraded: true };
    }
    addRoot(n);
    const phys = norm(entry.path);
    if (phys && phys !== n && !addRoot(phys)) {
      // The physical location is somewhere we would never accept as a root.
      // Refuse the pair outright rather than trusting the name that pointed
      // there.
      const i = roots.indexOf(n);
      if (i >= 0) roots.splice(i, 1);
      console.warn(`[fs-guard] refusing root whose physical location is unsafe: ${n}`);
      return { ok: false, degraded: false };
    }
    return { ok: true, degraded: !!entry.degraded };
  },

  // Check that paths are what they appear to be before reading or writing them.
  //
  // Returns a Map of path → "clean" | "unclean" | "missing" | "degraded".
  //
  //   clean     no component below the root is a link or other indirection
  //   unclean   something along the path redirects elsewhere — refuse
  //   missing   the path is gone (a deleted deck, not an attack)
  //   degraded  the gatekeeper could not be reached; no verdict available
  //
  // Callers must fail CLOSED on "unclean" — that is the security property.
  // "degraded" is an availability state, not a verdict: the gatekeeper is
  // launched at startup but can be slow, and refusing to open decks because a
  // helper process is still warming up would break the app for a condition
  // that is not an attack signal.
  inspect,
  inspectOne,
  assertSafe,

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

// The inspect helpers live outside the exported object so they call each other
// directly rather than through `this` — a destructured
// `const { assertSafe } = fsGuard` must behave identically to a method call.

async function inspect(paths) {
  const list = (Array.isArray(paths) ? paths : [paths]).map(norm).filter(Boolean);
    const out = new Map();
    if (!list.length) return out;
    // Lexical containment first — it needs no round trip and is the check that
    // has always been here.
    const toAsk = [];
    for (const n of list) {
      if (!underRoot(n)) out.set(n, "unclean");
      else toAsk.push(n);
    }
    if (!toAsk.length) return out;
    if (!resolver) {
      for (const n of toAsk) out.set(n, "degraded");
      return out;
    }
    // Group by root so each batch carries the right base.
    const byRoot = new Map();
    for (const n of toAsk) {
      const base = rootFor(n);
      if (!byRoot.has(base)) byRoot.set(base, []);
      byRoot.get(base).push(n);
    }
    for (const [base, group] of byRoot) {
      let res = null;
      try { res = await resolver({ base, paths: group }); } catch { res = null; }
      for (const n of group) {
        const entry = res && res.entries ? res.entries[n] : null;
        if (!entry) out.set(n, "degraded");
        else if (entry.error === "missing") out.set(n, "missing");
        else if (entry.error) out.set(n, "unclean");
        else out.set(n, entry.clean ? "clean" : "unclean");
      }
    }
  return out;
}

// Single-path convenience over inspect().
async function inspectOne(path) {
  const n = norm(path);
  return (await inspect([n])).get(n) || "degraded";
}

// Throw unless `path` is safe to read or write. The thrown message is what the
// shell surfaces, so it names the file and nothing else about the host.
async function assertSafe(path) {
  const verdict = await inspectOne(path);
  if (verdict === "unclean") {
    throw new Error(`[fs-guard] refusing ${norm(path)}: it does not point where it appears to`);
  }
  return verdict;
}

// SECURITY (v13.19): freeze the exported capability so same-realm script cannot
// neutralize the guard by reassigning its methods (e.g. `fsGuard.allow = …` or
// swapping `install`). The allowlist, the `installed` flag, the resolver slot
// and the guard helpers live in module-private closure state that the frozen
// surface never exposes.
Object.freeze(fsGuard);
