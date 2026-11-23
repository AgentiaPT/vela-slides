// Sync-conflict dialog.
//
// deck-io shows this dialog when the deck file changed on disk while Vela had
// unsaved edits. deck-io pauses saves until the user makes a choice. Each choice
// keeps the other version as a copy next to the deck, so no version is lost.
//
// Same pattern as deck-warning.js: pure DOM, textContent only, fixed English
// text. The file name comes from the local filesystem, but we treat it as
// untrusted: we show the basename only, as text. No deck title and no deck text
// go into this dialog.
//
// The dialog is modal and has no dismiss without a choice: there is no close
// button, a backdrop click does nothing, and Escape does nothing. A dismiss would
// leave saves paused with no way to resume them. The one exception: after a
// choice failed, "Keep editing" closes the dialog with saves still paused, so a
// disk that stays unreadable cannot trap the user (deck-io shows the dialog
// again on the next resync).
//
// We use a native <dialog> with showModal() when the webview has it: the dialog
// goes into the top layer, above any z-index in the app (for example the image
// zoom overlay), and the rest of the page is inert. Without showModal we use a
// fixed element with the highest z-index.

let stylesInstalled = false;
let current = null; // { promise, dismiss } while a dialog is open
// The dialog element of this module, kept by reference. WHY no id: a deck SVG
// can carry any id, so an id lookup or an id selector can find a deck element
// (it gets the shell style, or it is removed as a stale dialog). The deck SVG
// sanitizer drops every data-* attribute, so the shell rules key on
// data-vela-shell, which deck content cannot carry.
let shellHost = null;
const SHELL = '[data-vela-shell="sync-conflict"]';

function installStyles() {
  if (stylesInstalled) return;
  stylesInstalled = true;
  const s = document.createElement("style");
  // Hidden unless open: the native dialog gets "open" from showModal, the
  // fallback element gets it when it is shown.
  s.textContent = `
    ${SHELL} { display: none; }
    ${SHELL}[open] { position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); margin: 0; padding: 0; border: 0; width: auto; height: auto; max-width: none; max-height: none; color: inherit; }
    ${SHELL}::backdrop { background: transparent; }
    ${SHELL} .box:focus { outline: none; }
    ${SHELL} .box { background: #0f172a; border: 1px solid #b45309; border-radius: 14px; width: min(540px, 92vw); padding: 22px 24px; box-shadow: 0 24px 60px rgba(0,0,0,0.55); color: #e2e8f0; }
    ${SHELL} h2 { font-size: 16px; font-weight: 700; margin: 0 0 6px; letter-spacing: 0.01em; color: #fbbf24; }
    ${SHELL} .sub { font-size: 12px; color: #94a3b8; margin-bottom: 14px; font-family: ui-monospace, monospace; word-break: break-all; }
    ${SHELL} p { font-size: 13px; line-height: 1.55; color: #cbd5e1; margin: 0 0 10px; }
    ${SHELL} .err { font-size: 13px; line-height: 1.55; color: #fca5a5; margin: 10px 0 0; }
    ${SHELL} .err[hidden] { display: none; }
    ${SHELL} .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; flex-wrap: wrap; }
    ${SHELL} button { font-size: 13px; padding: 8px 16px; border-radius: 7px; border: 1px solid #b45309; background: #f59e0b; color: #0f172a; cursor: pointer; font-family: inherit; font-weight: 600; }
    ${SHELL} button:hover { background: #fbbf24; border-color: #fbbf24; }
    ${SHELL} button:disabled { opacity: 0.55; cursor: default; }
    ${SHELL} button:focus-visible { outline: 2px solid #fbbf24; outline-offset: 2px; }
  `;
  document.head.appendChild(s);
}

// Basename only, from any input type. deck-io already passes a basename; we do
// it again so that a full path can never show here. Capped by code point so a
// long name cannot break the layout.
function basename(path) {
  if (typeof path !== "string" || !path) return "";
  return Array.from(path.split(/[\\/]/).pop()).slice(0, 255).join("");
}

export function showSyncConflict(fileName, { keepMine, loadFile } = {}) {
  // One dialog at a time. A second conflict while one is open uses the same
  // dialog: deck-io stays paused until this choice is made.
  if (current) return current.promise;

  installStyles();
  let resolveFn;
  const promise = new Promise((resolve) => { resolveFn = resolve; });
  current = { promise };

  if (shellHost) { try { shellHost.remove(); } catch {} shellHost = null; }

  // Native modal dialog when the webview supports it, else a fixed element.
  let host = document.createElement("dialog");
  const modal = typeof host.showModal === "function";
  if (!modal) host = document.createElement("div");
  host.setAttribute("data-vela-shell", "sync-conflict");
  shellHost = host;
  host.setAttribute("role", "dialog");
  host.setAttribute("aria-modal", "true");
  // Fixed text, not aria-labelledby: an IDREF can resolve to a deck element
  // with the same id, and then a deck text names this dialog.
  host.setAttribute("aria-label", "File changed on disk");

  // The box holds the focus at start and after a failed choice, not a button:
  // Enter or Space alone must not pick a version the user did not read.
  const box = document.createElement("div");
  box.className = "box";
  box.tabIndex = -1;

  const h2 = document.createElement("h2");
  h2.textContent = "File changed on disk";
  box.appendChild(h2);

  const sub = document.createElement("div");
  sub.className = "sub";
  sub.textContent = basename(fileName);
  box.appendChild(sub);

  const p1 = document.createElement("p");
  p1.textContent =
    "This file changed on disk while Vela had unsaved edits. " +
    "Choose the version to continue with. Vela keeps the other version as a copy next to the file, " +
    "so both versions are kept.";
  box.appendChild(p1);

  const err = document.createElement("div");
  err.className = "err";
  err.setAttribute("role", "alert");
  err.hidden = true;
  box.appendChild(err);

  const actions = document.createElement("div");
  actions.className = "actions";
  const mineBtn = document.createElement("button");
  mineBtn.type = "button";
  mineBtn.textContent = "Keep my Vela version";
  const fileBtn = document.createElement("button");
  fileBtn.type = "button";
  fileBtn.textContent = "Load the file version";
  // Shown only after a failed choice: closes the dialog, saves stay paused.
  const keepBtn = document.createElement("button");
  keepBtn.type = "button";
  keepBtn.textContent = "Keep editing (saves stay paused)";
  keepBtn.hidden = true;
  actions.appendChild(mineBtn);
  actions.appendChild(fileBtn);
  actions.appendChild(keepBtn);
  box.appendChild(actions);
  host.appendChild(box);

  let busy = false;
  let closed = false;

  // Run one choice. Both buttons stay disabled while it runs, so a double click
  // cannot start two choices. Only an explicit true closes the dialog: false, a
  // throw or any other value means nothing was replaced, so we show the error
  // and let the user try again.
  async function run(action) {
    if (busy || closed) return;
    busy = true;
    mineBtn.disabled = true;
    fileBtn.disabled = true;
    keepBtn.disabled = true;
    err.hidden = true;
    let ok = false;
    try {
      ok = typeof action === "function" && (await action()) === true;
    } catch {
      ok = false; // the raw error is not shown: it can contain a path
    }
    if (closed) return; // closeSyncConflict ran while the action was busy
    if (ok) {
      close();
      resolveFn(true);
      return;
    }
    err.textContent = "Could not keep a copy. Nothing was replaced. Try again.";
    err.hidden = false;
    keepBtn.hidden = false;
    busy = false;
    mineBtn.disabled = false;
    fileBtn.disabled = false;
    keepBtn.disabled = false;
    // Focus goes back to the box, not to a button (see the box above). A
    // disabled button that had the focus loses it, so keys go nowhere useful.
    try { box.focus(); } catch {}
  }
  // Close without a choice: deck-io stays paused, nothing is resolved.
  function dismiss() {
    if (closed) return;
    close();
    resolveFn(false);
  }
  current.dismiss = dismiss;
  mineBtn.addEventListener("click", () => { run(keepMine); });
  fileBtn.addEventListener("click", () => { run(loadFile); });
  keepBtn.addEventListener("click", () => { if (!busy) dismiss(); });

  // Capture phase on window: this runs before every document listener (capture
  // or bubble) and before every target and bubble listener, so it is the one
  // place that can keep a key away from all of them. Examples: the global
  // Ctrl/Cmd+O picker shortcut in nl-boot.js (document, bubble), the app's
  // Ctrl+Z undo (window, bubble), and the trust prompt (document, capture),
  // which takes Enter on a non-button element as "trust". Only window-capture
  // listeners added before this one still run first.
  function onKey(e) {
    const k = typeof e.key === "string" ? e.key.toLowerCase() : "";
    // Modal: while the dialog is open no key reaches the app behind it. An edit
    // made there would change the pending deck after the user saw the choice
    // (and makes "Load the file version" refuse, to keep that edit).
    // A key inside the dialog keeps its default action (Tab moves the focus,
    // Enter or Space clicks a focused button), but no listener sees it.
    // Escape must not dismiss the dialog, and the picker must not open a
    // different deck while this conflict is open, so both lose their default
    // action too. A key outside the dialog loses its default action, and Tab
    // from there sends the focus back to the box (simple focus trap).
    const inside = !!(e.target && typeof host.contains === "function" && host.contains(e.target));
    if (!inside || k === "escape" || ((e.ctrlKey || e.metaKey) && k === "o")) {
      e.preventDefault();
      if (!inside && k === "tab") { try { box.focus(); } catch {} }
    }
    e.stopPropagation();
    e.stopImmediatePropagation();
  }
  window.addEventListener("keydown", onKey, true);

  // Native dialog: Escape fires "cancel"; we cancel it. Chromium can skip
  // "cancel" and close the dialog after repeated close requests with no user
  // activation, so an unexpected "close" opens the dialog again.
  function onCancel(e) { e.preventDefault(); }
  function onClose() {
    if (closed) return;
    try { host.showModal(); } catch { try { host.setAttribute("open", ""); } catch {} }
    try { box.focus(); } catch {}
  }

  function close() {
    if (closed) return;
    closed = true;
    window.removeEventListener("keydown", onKey, true);
    if (modal) {
      host.removeEventListener("cancel", onCancel);
      host.removeEventListener("close", onClose);
      try { if (host.open) host.close(); } catch {}
    }
    current = null;
    if (shellHost === host) shellHost = null;
    try { host.remove(); } catch {}
  }

  if (!modal) host.setAttribute("open", "");
  document.body.appendChild(host);
  if (modal) {
    host.addEventListener("cancel", onCancel);
    host.addEventListener("close", onClose);
    // showModal throws when the element cannot be modal; then show it in
    // place: it is still a fixed element with the highest z-index.
    try { host.showModal(); } catch { try { host.setAttribute("open", ""); } catch {} }
  }
  try { box.focus(); } catch {}
  return promise;
}

// Close the open dialog without a choice (its promise resolves false). nl-boot
// calls this when deck-io clears the conflict another way, for example when
// the user opens a different deck.
export function closeSyncConflict() {
  if (current && typeof current.dismiss === "function") current.dismiss();
}
