// Loopback bridge to the gatekeeper's /resolve endpoint.
//
// fs-guard.js can only compare path strings — the Neutralino client API has no
// realpath and getStats reports neither links nor reparse points. This module
// is the guard's one window onto what a path physically is. It is deliberately
// tiny and holds no policy: it moves a question to the gatekeeper and returns
// the answer. fs-guard.js decides what to do with it.
//
// SECURITY: `fetch` is captured at MODULE-INIT time, before boot() runs and
// long before any deck JSON enters the realm. A resolved path arriving over a
// reassignable transport would be worth nothing — script that reached the realm
// could simply patch the transport and answer its own question. Capturing the
// reference is the same trick fs-guard.install() uses to hold the unwrapped
// filesystem methods, and it is what makes the answer worth acting on.
//
// This raises the bar; it is not an unforgeable channel. See SECURITY.md for
// what this layer does and does not claim.

const nativeFetch =
  typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null;
const NativeAbort = globalThis.AbortController;

const HANDSHAKE_TRIES = 20;   // boot: the gatekeeper is starting alongside us
const HANDSHAKE_RETRY_TRIES = 2; // later: a quick look, not another long poll
const HANDSHAKE_DELAY_MS = 150;
const HANDSHAKE_RETRY_AFTER_MS = 5000;
const REQUEST_TIMEOUT_MS = 5000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Read the gatekeeper's loopback port + token. Mirrors agents-bridge.js: the
// extension is launched by Neutralino in parallel with the webview, so the
// handshake files may not exist for a beat. On Windows a freshly built binary
// can be slow on its first launches (Defender / SmartScreen / MOTW on a new
// hash), so the poll is generous.
async function readHandshake(velaDir, tries) {
  const suffixes = [];
  if (typeof window !== "undefined" && window.NL_PORT != null) suffixes.push(`-${window.NL_PORT}`);
  suffixes.push("");
  for (let i = 0; i < tries; i++) {
    for (const sfx of suffixes) {
      try {
        const port = (await Neutralino.filesystem.readFile(`${velaDir}/agent-ext${sfx}.port`)).trim();
        const token = (await Neutralino.filesystem.readFile(`${velaDir}/agent-ext${sfx}.token`)).trim();
        if (port && token) return { port, token };
      } catch { /* not written yet */ }
    }
    await sleep(HANDSHAKE_DELAY_MS);
  }
  return null;
}

// Build the resolver fs-guard consumes. Returns a function of
//   { base?, paths[], reveal? } → { entries: { <path>: {clean, path?, degraded?, error?} } }
// or null when the gatekeeper could not be reached, which the guard reports as
// "degraded" rather than treating as a verdict.
export function createResolver(velaDir) {
  if (!nativeFetch) return null;
  let handshake = null;
  let everTried = false;
  let retryAfter = 0;
  let inFlight = null;

  // A gatekeeper that was slow to start must not leave the guard permanently
  // blind: giving up for good on the first miss would silently downgrade every
  // later check to "degraded" for the rest of the session. Equally, retrying a
  // full poll on every call would stall the app when there is genuinely no
  // gatekeeper. So: one generous poll at boot, then brief re-checks on a
  // cooldown. Concurrent callers share the in-flight attempt.
  async function ensureHandshake() {
    if (handshake) return handshake;
    if (inFlight) return inFlight;
    const now = Date.now();
    if (everTried && now < retryAfter) return null;
    const tries = everTried ? HANDSHAKE_RETRY_TRIES : HANDSHAKE_TRIES;
    everTried = true;
    inFlight = (async () => {
      try {
        handshake = await readHandshake(velaDir, tries);
        if (!handshake) retryAfter = Date.now() + HANDSHAKE_RETRY_AFTER_MS;
        return handshake;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return async function resolve(request) {
    const hs = await ensureHandshake();
    if (!hs) return null;
    const ctl = NativeAbort ? new NativeAbort() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS) : null;
    try {
      const r = await nativeFetch(`http://localhost:${hs.port}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-vela-token": hs.token },
        body: JSON.stringify(request || {}),
        signal: ctl ? ctl.signal : undefined,
      });
      // A stale token means the gatekeeper restarted — drop the handshake and
      // let the next call pick up the new one rather than failing for good.
      if (r.status === 401) { handshake = null; retryAfter = 0; return null; }
      const data = await r.json().catch(() => null);
      if (!r.ok || !data || !data.ok || !data.entries) return null;
      return { entries: data.entries };
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
