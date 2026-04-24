// Per-deck trust gate for the Neutralino shell.
//
// Stores decisions in <deck-folder>/.vela/trust.json keyed by relative path
// so the folder can be moved/renamed and the trust list travels with it.
// Only persistent "trust" decisions are serialised; denies are session-only
// (users asked to re-ask on next launch rather than silently lock the deck
// out). The session-level allow/deny maps live in memory and are cleared on
// app restart.
//
// Gate contract (consumed by part-engine.jsx via window.__velaTrustGate):
//   await gate(folder, absolutePath) → "allow" | "deny"
//
// "deny" is surfaced as a thrown error by the engine so AI UI can render a
// clear inline message rather than a silent no-op. A missing gate (artifact
// / serve.py runtimes) falls through as "allow" — those runtimes have their
// own trust model (artifact sandbox, local-host serve auth).

import { configStore } from "./config-store.js";

const TRUST_VERSION = 1;

const session = {
  allow: new Set(), // absolute paths granted "just this session"
  deny:  new Set(), // absolute paths explicitly rejected this session
};

// Cache per folder to avoid re-reading the JSON on every gate call.
const folderCache = new Map(); // folder → { decks: { [rel]: { at } } }

function relPath(folder, abs) {
  const f = folder.replace(/[\\/]+$/, "");
  const a = abs.replace(/\\/g, "/");
  const fn = f.replace(/\\/g, "/");
  if (!a.startsWith(fn + "/")) return null; // deck is outside the folder — shouldn't happen in our flow
  return a.slice(fn.length + 1);
}

function isoNow() { return new Date().toISOString(); }

async function ensureDir(path) {
  try { await Neutralino.filesystem.getStats(path); }
  catch { try { await Neutralino.filesystem.createDirectory(path); } catch {} }
}

async function loadTrust(folder) {
  if (folderCache.has(folder)) return folderCache.get(folder);
  const p = `${folder.replace(/[\\/]+$/, "")}/.vela/trust.json`;
  let data;
  try {
    const txt = await Neutralino.filesystem.readFile(p);
    const parsed = JSON.parse(txt);
    data = { decks: parsed?.decks || {} };
  } catch {
    data = { decks: {} };
  }
  folderCache.set(folder, data);
  return data;
}

async function writeTrust(folder, data) {
  const base = folder.replace(/[\\/]+$/, "");
  await ensureDir(`${base}/.vela`);
  const p = `${base}/.vela/trust.json`;
  const tmp = `${p}.tmp`;
  const json = JSON.stringify({ _v: TRUST_VERSION, decks: data.decks || {} }, null, 2);
  await Neutralino.filesystem.writeFile(tmp, json);
  try {
    await Neutralino.filesystem.move(tmp, p);
  } catch {
    try { await Neutralino.filesystem.remove(p); } catch {}
    await Neutralino.filesystem.writeFile(p, json);
    try { await Neutralino.filesystem.remove(tmp); } catch {}
  }
  folderCache.set(folder, data);
}

// ─── Modal UI ─────────────────────────────────────────────────────────
//
// Pure DOM, textContent-only. Filename, folder, and agent id come from
// trusted in-shell sources — but we keep the strict-createElement pattern
// anyway to match the existing security posture (see commit 721c07c:
// webview has os.spawnProcess, DOM-XSS == RCE).

let stylesInstalled = false;
function installStyles() {
  if (stylesInstalled) return;
  stylesInstalled = true;
  const s = document.createElement("style");
  s.textContent = `
    #vela-trust { position: fixed; inset: 0; z-index: 100001; background: rgba(0,0,0,0.6); display: none; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
    #vela-trust.open { display: flex; }
    #vela-trust .box { background: #0f172a; border: 1px solid #334155; border-radius: 14px; width: min(560px, 92vw); padding: 22px 24px; box-shadow: 0 24px 60px rgba(0,0,0,0.55); color: #e2e8f0; }
    #vela-trust h2 { font-size: 16px; font-weight: 700; margin: 0 0 6px; letter-spacing: 0.01em; }
    #vela-trust .sub { font-size: 12px; color: #94a3b8; margin-bottom: 14px; font-family: ui-monospace, monospace; word-break: break-all; }
    #vela-trust p { font-size: 13px; line-height: 1.55; color: #cbd5e1; margin: 0 0 10px; }
    #vela-trust ul { font-size: 13px; line-height: 1.55; color: #cbd5e1; margin: 0 0 10px 18px; padding: 0; }
    #vela-trust li { margin: 2px 0; }
    #vela-trust .note { font-size: 12px; color: #94a3b8; border-left: 2px solid #3b82f6; padding: 6px 12px; margin: 10px 0 12px; background: rgba(59,130,246,0.06); border-radius: 0 6px 6px 0; }
    #vela-trust .agent { font-size: 12px; color: #94a3b8; margin: 10px 0 14px; padding: 8px 12px; background: #1e293b; border-radius: 6px; }
    #vela-trust .agent .id { color: #e2e8f0; font-weight: 600; }
    #vela-trust .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; flex-wrap: wrap; }
    #vela-trust button { font-size: 13px; padding: 8px 14px; border-radius: 7px; border: 1px solid #334155; background: transparent; color: #cbd5e1; cursor: pointer; font-family: inherit; }
    #vela-trust button:hover { border-color: #64748b; color: #e2e8f0; }
    #vela-trust button.primary { background: #3b82f6; border-color: #3b82f6; color: #fff; }
    #vela-trust button.primary:hover { background: #2563eb; border-color: #2563eb; }
    #vela-trust button.ghost { color: #94a3b8; }
    #vela-trust button:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; }
  `;
  document.head.appendChild(s);
}

function agentLabel() {
  const info = window.__velaAgentInfo;
  if (!info) return "Claude Code (detected)";
  const parts = [info.label || "Claude Code"];
  if (info.version) parts.push(`v${info.version}`);
  if (info.model) parts.push(info.model);
  return parts.join(" · ");
}

function showModal({ filename, folder, includeIntro }) {
  installStyles();
  return new Promise((resolve) => {
    // Backdrop
    let host = document.getElementById("vela-trust");
    if (host) host.remove();
    host = document.createElement("div");
    host.id = "vela-trust";
    host.setAttribute("role", "dialog");
    host.setAttribute("aria-modal", "true");

    const box = document.createElement("div");
    box.className = "box";

    const h2 = document.createElement("h2");
    h2.textContent = includeIntro
      ? "Enable AI for this deck?"
      : `Enable AI for "${filename}"?`;
    box.appendChild(h2);

    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = `${folder}/${filename}`;
    box.appendChild(sub);

    if (includeIntro) {
      const intro = document.createElement("p");
      intro.textContent =
        "First time using AI in Vela Desktop. Here's what happens when you enable it:";
      box.appendChild(intro);
    }

    const ul = document.createElement("ul");
    [
      "Vera runs via your local Claude Code installation — your account, your plan.",
      "Slide content from this deck is sent to Anthropic through Claude Code.",
      "Vera suggests edits; you review each change before it applies.",
      "The agent cannot read other files, run shell commands, or browse the web — Vela restricts it to chat-only.",
    ].forEach((t) => {
      const li = document.createElement("li");
      li.textContent = t;
      ul.appendChild(li);
    });
    box.appendChild(ul);

    const note = document.createElement("div");
    note.className = "note";
    note.textContent =
      "If you didn't create this deck or don't recognise where it came from, decline for now — you can always trust it later from Settings.";
    box.appendChild(note);

    const ag = document.createElement("div");
    ag.className = "agent";
    const agLabel = document.createElement("span");
    agLabel.textContent = "Active agent: ";
    const agId = document.createElement("span");
    agId.className = "id";
    agId.textContent = agentLabel();
    ag.appendChild(agLabel);
    ag.appendChild(agId);
    box.appendChild(ag);

    // Buttons
    const actions = document.createElement("div");
    actions.className = "actions";

    const btn = (label, cls, decision) => {
      const b = document.createElement("button");
      b.textContent = label;
      if (cls) b.className = cls;
      b.onclick = () => {
        cleanup();
        resolve(decision);
      };
      return b;
    };

    actions.appendChild(btn("Don't trust", "ghost", "deny"));
    actions.appendChild(btn("Just this session", "", "session"));
    const primary = btn("Trust this deck", "primary", "trust");
    actions.appendChild(primary);

    box.appendChild(actions);
    host.appendChild(box);
    document.body.appendChild(host);

    // Focus the primary button after a tick so screen readers catch it.
    setTimeout(() => { try { primary.focus(); } catch {} }, 30);

    requestAnimationFrame(() => host.classList.add("open"));

    // Keyboard: Esc = deny, Enter = primary, Tab = cycle.
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); cleanup(); resolve("deny"); }
      else if (e.key === "Enter" && document.activeElement && document.activeElement.tagName !== "BUTTON") {
        e.preventDefault(); cleanup(); resolve("trust");
      }
    }
    document.addEventListener("keydown", onKey, true);

    function cleanup() {
      document.removeEventListener("keydown", onKey, true);
      host.classList.remove("open");
      setTimeout(() => { try { host.remove(); } catch {} }, 150);
    }
  });
}

// ─── Gate ─────────────────────────────────────────────────────────────

let pending = null; // serialise concurrent gate calls so we only show one modal
async function gate(folder, absolutePath) {
  if (!folder || !absolutePath) return "allow"; // no deck context, nothing to gate
  // Session-level short-circuits.
  if (session.allow.has(absolutePath)) return "allow";
  if (session.deny.has(absolutePath))  return "deny";
  // Persistent trust?
  const data = await loadTrust(folder);
  const rel = relPath(folder, absolutePath);
  if (rel && data.decks[rel]) return "allow";

  // Serialise: if another AI action is already prompting, wait for it.
  if (pending) return pending;

  pending = (async () => {
    const includeIntro = !(await configStore.hasSeenIntro());
    const decision = await showModal({
      filename: rel || absolutePath.split(/[\\/]/).pop(),
      folder: folder,
      includeIntro,
    });
    if (includeIntro) await configStore.markIntroSeen();

    if (decision === "trust") {
      data.decks[rel] = { at: isoNow() };
      try { await writeTrust(folder, data); }
      catch (e) { console.warn("[trust] persist failed, allowing session only:", e); session.allow.add(absolutePath); }
      return "allow";
    }
    if (decision === "session") {
      session.allow.add(absolutePath);
      return "allow";
    }
    // "deny" is session-scoped (re-ask next launch).
    session.deny.add(absolutePath);
    return "deny";
  })();

  try { return await pending; }
  finally { pending = null; }
}

// ─── Admin API (consumed by Settings panel) ────────────────────────────

async function listTrustedIn(folder) {
  const data = await loadTrust(folder);
  return Object.entries(data.decks).map(([rel, meta]) => ({
    folder,
    relativePath: rel,
    at: meta.at,
  }));
}

async function revoke(folder, relativePath) {
  const data = await loadTrust(folder);
  if (data.decks[relativePath]) {
    delete data.decks[relativePath];
    await writeTrust(folder, data);
  }
  // Drop any in-memory session allow referring to this path, too.
  const abs = `${folder.replace(/[\\/]+$/, "")}/${relativePath}`;
  session.allow.delete(abs);
}

async function revokeAllIn(folder) {
  await writeTrust(folder, { decks: {} });
  // Drop session allows under this folder.
  const base = folder.replace(/[\\/]+$/, "");
  for (const p of Array.from(session.allow)) {
    if (p.startsWith(base + "/")) session.allow.delete(p);
  }
}

async function statusOf(folder, absolutePath) {
  if (!folder || !absolutePath) return "unknown";
  if (session.deny.has(absolutePath)) return "denied-session";
  if (session.allow.has(absolutePath)) return "session";
  const data = await loadTrust(folder);
  const rel = relPath(folder, absolutePath);
  if (rel && data.decks[rel]) return "trusted";
  return "untrusted";
}

export const trust = {
  gate,
  statusOf,
  listTrustedIn,
  revoke,
  revokeAllIn,
};
