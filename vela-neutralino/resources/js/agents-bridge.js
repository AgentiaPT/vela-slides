// Agents bridge: routes Vera's callClaudeAPI() calls to a local CLI coding
// agent instead of the Anthropic API. The webview never spawns anything — it
// talks over loopback HTTP to the hardened gatekeeper extension
// (vela-neutralino/extensions/agent), which is the ONLY process allowed to
// launch a child, and only the two whitelisted agent binaries at that.
//
// `os.spawnProcess` stays out of neutralino.config.json's nativeAllowList, so
// a deck-driven DOM-XSS cannot reach process execution: at most it can ask the
// gatekeeper to run a whitelisted agent, which the webview gates behind the
// session-confirm UI (trust.js).
//
// Handshake: the gatekeeper writes ~/.vela/agent-ext.{port,token} on launch.
// We read them (the webview already has filesystem read on ~/.vela via
// fsGuard) and authenticate every request with the token. Loopback HTTP +
// token mirrors the serve.py channel branch the monolith already speaks
// (part-engine.jsx), so the existing __velaAgentSend contract is reused:
//   send({ system, messages, temperature, max_tokens, _callType })
//     -> Promise<{ text, request_id, stats? }>

import { fsGuard } from "./fs-guard.js";
import { configStore } from "./config-store.js";

const DESCRIPTORS = {
  "claude-code": { id: "claude-code", label: "Claude Code" },
  "copilot-cli": { id: "copilot-cli", label: "GitHub Copilot CLI" },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let handshake = null;   // { port, token } once the gatekeeper is up
let detected = null;    // { id: { id, label, available, version } }
let activeId = null;    // selected provider id
let lastModel = null;   // populated after the first successful send()

async function velaDir() {
  const home = (await Neutralino.os.getEnv("HOME")) || (await Neutralino.os.getEnv("USERPROFILE"));
  if (!home) throw new Error("cannot locate user home directory");
  const dir = `${home.replace(/[\\/]+$/, "")}/.vela`;
  fsGuard.allow(dir); // the gatekeeper handshake files live here
  return dir;
}

// Read the gatekeeper's loopback port + auth token. The extension is launched
// by Neutralino in parallel with the webview, so the files may not exist for a
// beat — poll briefly before giving up (AI then renders as unavailable).
// `bound` ({ deadline, now }, optional): stop polling when the next poll would
// pass the deadline. Only the manual rescan sets it (see detect).
async function readHandshake(bound) {
  let dir;
  try { dir = await velaDir(); } catch { return null; }
  // Each Vela window's gatekeeper keys its handshake by Neutralino's NL_PORT, so
  // multiple windows never share one channel. Prefer the keyed file; fall back
  // to the unkeyed name (older gatekeeper / standalone run).
  const suffixes = [];
  if (typeof window !== "undefined" && window.NL_PORT != null) suffixes.push(`-${window.NL_PORT}`);
  suffixes.push("");
  for (let i = 0; i < 20; i++) {
    for (const sfx of suffixes) {
      try {
        const port = (await Neutralino.filesystem.readFile(`${dir}/agent-ext${sfx}.port`)).trim();
        const token = (await Neutralino.filesystem.readFile(`${dir}/agent-ext${sfx}.token`)).trim();
        if (port && token) return { port, token };
      } catch { /* not written yet */ }
    }
    if (bound && !(bound.now() + 150 < bound.deadline)) break;
    await sleep(150);
  }
  return null;
}

async function ensureHandshake(bound) {
  if (handshake) return handshake;
  handshake = await readHandshake(bound);
  return handshake;
}

async function extFetch(pathname, body, timeoutMs) {
  const hs = await ensureHandshake();
  if (!hs) throw new Error("AI agent is not available");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // host literal "localhost" — the desktop CSP allows http://localhost:* and
    // it resolves to the loopback the gatekeeper binds.
    let r;
    try {
      r = await fetch(`http://localhost:${hs.port}${pathname}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-vela-token": hs.token },
        body: JSON.stringify(body || {}),
        signal: controller.signal,
      });
    } catch (e) {
      // Network-level failure (connection refused / timeout): the cached
      // port+token can be STALE — left by a previous gatekeeper that did not
      // clean up, or read before a slow new gatekeeper rewrote the files. Keeping
      // it made every retry and every manual rescan hit the same dead port until
      // a restart (CR19). Drop it so the next call re-reads the handshake files.
      handshake = null;
      throw e;
    }
    if (r.status === 401) { handshake = null; throw new Error("AI agent auth failed"); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) throw new Error(data.error || `agent error ${r.status}`);
    return data;
  } finally { clearTimeout(timer); }
}

function availableList() {
  if (!detected) return [];
  return Object.values(detected)
    .filter((p) => p && p.available)
    .map((p) => ({ id: p.id, label: p.label || DESCRIPTORS[p.id]?.label, version: p.version || null }));
}

// Probe which agents are installed and choose the active one: the persisted
// pick if it is still available, otherwise the first available provider.
//
// Returns whether the gatekeeper actually ANSWERED (handshake read + /detect
// responded), NOT whether an agent was found. The boot retry loop (nl-boot.js)
// needs this distinction: a freshly built native gatekeeper binary can be slow
// to start on its first Windows launches (Defender scan / SmartScreen / MOTW on
// a new-hash exe), so an early attempt sees no handshake files yet — that is a
// transient "not up yet", retryable. A gatekeeper that answers with no agent
// installed is a real negative that should stop the retry.
async function detect(bound) {
  let gatekeeperUp = false;
  try {
    let timeoutMs = 15000;
    if (bound) {
      // Manual rescan: the handshake poll AND the /detect request together fit
      // the remaining budget. A slow gatekeeper (first agent --version run) is
      // aborted at the deadline instead of holding the click for up to 15 s.
      if (!(await ensureHandshake(bound))) throw new Error("AI agent is not available");
      timeoutMs = Math.max(1, Math.min(15000, bound.deadline - bound.now()));
    }
    const data = await extFetch("/detect", {}, timeoutMs);
    gatekeeperUp = true;
    detected = data.providers || {};
  } catch {
    detected = {};
  }
  let saved = null;
  try { saved = await configStore.getAgent(); } catch {}
  const avail = availableList().map((p) => p.id);
  if (saved && detected[saved]?.available) activeId = saved;
  else if (avail.length) activeId = avail[0];
  else activeId = null;
  return gatekeeperUp;
}

// Probe until an agent is available or the deadline passes. There is no early
// exit on "gatekeeper answered, no agent": on a fresh build the agent's own
// first `--version` run can be slow or blocked for a while and reads as a
// negative, and the old 3-empty-answers cutoff (~2.4s) gave up long before the
// startup budget. A real negative costs only a few cheap background probes.
// Every attempt is reported to onAttempt(gatekeeperUp, or null on error).
// `maxNegatives` (optional) stops after that many "gatekeeper answered, no
// agent" answers; only the manual rescan sets it (see rescan below).
// `boundAttempts` (optional) bounds each attempt itself by the deadline; only
// the manual rescan sets it. The launch-time probe keeps its per-call timeouts.
// `now` / `wait` are injectable for tests (fake clock).
async function probeUntilReady({ deadline, onAttempt, maxNegatives, boundAttempts, now = () => Date.now(), wait = sleep } = {}) {
  let delay = 500, negatives = 0;
  for (;;) {
    let up = null;
    try { up = await detect(boundAttempts ? { deadline, now } : undefined); } catch { up = null; }
    if (onAttempt) { try { onAttempt(up); } catch {} }
    if (activeId && detected?.[activeId]?.available) return true;
    if (up === true && maxNegatives > 0 && ++negatives >= maxNegatives) return false;
    if (!(now() < deadline)) return false;
    await wait(Math.min(delay, Math.max(0, deadline - now())));
    delay = Math.min(Math.round(delay * 1.5), 4000);
  }
}

// Manual rescan (Agent settings "Rescan"): a short, bounded probe. The user
// waits on it, so a machine with no agent installed must get its answer in
// about a second, not after the 45 s launch budget. The launch-time probe
// (nl-boot) keeps the long budget and runs in the background on its own.
// Gatekeeper not answering: give up after this. One attempt without handshake
// files already polls ~3 s (readHandshake), so this allows that one attempt;
// a stale cached port fails fast and is re-read on the next attempt (CR19).
const RESCAN_BUDGET_MS = 3000;
const RESCAN_MAX_NEGATIVES = 2; // gatekeeper answers "no agent": stop after this many
function rescan({ onAttempt, now = () => Date.now(), wait = sleep } = {}) {
  return probeUntilReady({ deadline: now() + RESCAN_BUDGET_MS, maxNegatives: RESCAN_MAX_NEGATIVES, boundAttempts: true, onAttempt, now, wait });
}

export const agents = {
  // Re-probe availability (after install, or on manual refresh).
  async detect() { return detect(); },

  probeUntilReady(opts) { return probeUntilReady(opts); },

  rescan(opts) { return rescan(opts); },

  // Available providers only (for the picker UI).
  list() { return availableList(); },

  activeId() { return activeId; },

  // Snapshot for window.__velaAgentInfo (consumed by AgentStatusChip).
  info() {
    const a = activeId ? detected?.[activeId] : null;
    return {
      id: activeId,
      label: a?.label || DESCRIPTORS[activeId]?.label || "—",
      available: !!(a && a.available),
      version: a?.version || null,
      model: lastModel,
      providers: availableList(),
    };
  },

  available() { return !!(activeId && detected?.[activeId]?.available); },

  // Switch provider + persist the choice in ~/.vela/config.json.
  async pick(id) {
    if (!DESCRIPTORS[id]) throw new Error(`unknown provider: ${id}`);
    activeId = id;
    lastModel = null;
    try { await configStore.setAgent(id); } catch {}
    return activeId;
  },

  async send(payload) {
    if (!activeId) throw new Error("No AI provider selected");
    const timeoutMs = Math.max(30000, payload?._callType === "create" ? 300000 : 200000);
    const data = await extFetch("/send", { provider: activeId, ...payload }, timeoutMs);
    if (data.stats?.model) lastModel = data.stats.model;
    return { text: data.text || "", request_id: data.request_id, stats: data.stats || {} };
  },
};
