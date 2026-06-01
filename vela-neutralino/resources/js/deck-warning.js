// Externally-authored-deck warning.
//
// Vela is intended for personal authoring with AI-agent assistance, not for
// rendering decks authored by third parties. A deck file is structured JSON
// that the engine renders through 21 block types — sanitizers harden each
// block, but the safest posture is to never open a deck whose origin you
// don't recognise.
//
// This warning is shown every time a deck is loaded into the shell (boot,
// picker selection). It is intentionally modal and blocking: the user has to
// acknowledge before the deck mounts. There is no "don't show again" — the
// reminder is the point.
//
// Pure DOM, textContent-only. The filename argument comes from the user's
// filesystem (deck-io), but we treat it as untrusted anyway to match the
// rest of the shell's posture (see nl-boot.js and trust.js).

let stylesInstalled = false;

function installStyles() {
  if (stylesInstalled) return;
  stylesInstalled = true;
  const s = document.createElement("style");
  s.textContent = `
    #vela-deck-warning { position: fixed; inset: 0; z-index: 100002; background: rgba(0,0,0,0.6); display: none; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
    #vela-deck-warning.open { display: flex; }
    #vela-deck-warning .box { background: #0f172a; border: 1px solid #b45309; border-radius: 14px; width: min(540px, 92vw); padding: 22px 24px; box-shadow: 0 24px 60px rgba(0,0,0,0.55); color: #e2e8f0; }
    #vela-deck-warning h2 { font-size: 16px; font-weight: 700; margin: 0 0 6px; letter-spacing: 0.01em; color: #fbbf24; }
    #vela-deck-warning .sub { font-size: 12px; color: #94a3b8; margin-bottom: 14px; font-family: ui-monospace, monospace; word-break: break-all; }
    #vela-deck-warning p { font-size: 13px; line-height: 1.55; color: #cbd5e1; margin: 0 0 10px; }
    #vela-deck-warning .callout { font-size: 13px; line-height: 1.55; color: #fde68a; border-left: 2px solid #f59e0b; padding: 8px 12px; margin: 10px 0 12px; background: rgba(245,158,11,0.08); border-radius: 0 6px 6px 0; }
    #vela-deck-warning .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; flex-wrap: wrap; }
    #vela-deck-warning button { font-size: 13px; padding: 8px 16px; border-radius: 7px; border: 1px solid #b45309; background: #f59e0b; color: #0f172a; cursor: pointer; font-family: inherit; font-weight: 600; }
    #vela-deck-warning button:hover { background: #fbbf24; border-color: #fbbf24; }
    #vela-deck-warning button:focus-visible { outline: 2px solid #fbbf24; outline-offset: 2px; }
  `;
  document.head.appendChild(s);
}

function basename(path) {
  if (!path) return "";
  return String(path).split(/[\\/]/).pop();
}

export function showDeckWarning(deckPath) {
  installStyles();
  return new Promise((resolve) => {
    let host = document.getElementById("vela-deck-warning");
    if (host) host.remove();
    host = document.createElement("div");
    host.id = "vela-deck-warning";
    host.setAttribute("role", "dialog");
    host.setAttribute("aria-modal", "true");

    const box = document.createElement("div");
    box.className = "box";

    const h2 = document.createElement("h2");
    h2.textContent = "Opening a deck";
    box.appendChild(h2);

    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = basename(deckPath);
    box.appendChild(sub);

    const p1 = document.createElement("p");
    p1.textContent =
      "Vela is intended for personal authoring with AI-agent assistance. " +
      "Decks you create yourself (or co-author with an AI agent on your machine) are the supported use case.";
    box.appendChild(p1);

    const callout = document.createElement("div");
    callout.className = "callout";
    callout.textContent =
      "Never trust externally authored decks. If you didn't write this deck — or you can't trace where it came from — close it. Treat shared, downloaded, or forwarded .vela files as untrusted content.";
    box.appendChild(callout);

    const actions = document.createElement("div");
    actions.className = "actions";
    const ok = document.createElement("button");
    ok.textContent = "I understand";
    ok.onclick = () => { cleanup(); resolve(); };
    actions.appendChild(ok);
    box.appendChild(actions);

    host.appendChild(box);
    document.body.appendChild(host);

    setTimeout(() => { try { ok.focus(); } catch {} }, 30);
    requestAnimationFrame(() => host.classList.add("open"));

    function onKey(e) {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        cleanup();
        resolve();
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
