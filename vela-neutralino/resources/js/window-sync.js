// Native window helpers for the Vela desktop shell:
//   - title sync: the OS window title shows the open deck (CR16);
//   - focus restore: keyboard works at once after Alt+Tab back (CR18).
//
// Native calls use the literal `Neutralino.<ns>.<method>(` form so the
// SECURITY.md allowlist re-audit grep (and tests/test_desktop.py) sees them.
// window/document are passed in so tests/test_window_sync.cjs can use mocks.

export const APP_NAME = "Vela Slides";
// The suffix that part-app.jsx appends to document.title ("<deck> \u2014 Vela Slides").
const DOC_SUFFIX = " \u2014 " + APP_NAME;
const MAX_TITLE_CHARS = 100;
// C0/C1 controls, zero-width marks, line/paragraph separators, bidi
// overrides/isolates and BOM. The deck title is untrusted deck data; these
// characters could break the OS title bar or spoof its text direction.
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;
// "Vela Slides" at the start, with any separator after it. Removed so the
// window never says "Vela Slides - "Vela Slides - \u2026"".
const LEADING_APP_RE = /^vela\s+slides(?:[\s\-\u2013\u2014:|"]+|$)/i;

// Compute the native window title from the current document.title.
// Returns `Vela Slides` when there is no usable deck title, otherwise
// `Vela Slides - "<deck title>"`.
export function windowTitleFor(docTitle) {
  let name = typeof docTitle === "string" ? docTitle : "";
  if (name.endsWith(DOC_SUFFIX)) name = name.slice(0, -DOC_SUFFIX.length);
  name = name.replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim();
  // Strip repeated leading "Vela Slides" prefixes (also a bare "Vela Slides").
  for (let i = 0; i < 3 && LEADING_APP_RE.test(name); i++) {
    name = name.replace(LEADING_APP_RE, "").trim();
    // A leftover closing quote from a copied `Vela Slides - "X"` title.
    if (/^[^"]*"$/.test(name)) name = name.slice(0, -1).trim();
  }
  // We add our own quotes; drop one wrapping pair so they are not doubled.
  if (name.length >= 2 && name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1).trim();
  if (!name || name.toLowerCase() === "untitled") return APP_NAME;
  const chars = Array.from(name); // count code points, never split a surrogate pair
  if (chars.length > MAX_TITLE_CHARS) name = chars.slice(0, MAX_TITLE_CHARS - 1).join("").trimEnd() + "\u2026";
  return `${APP_NAME} - "${name}"`;
}

// Keep the native window title in sync with document.title. The app sets
// document.title from the deck title on every change; Neutralino does not
// mirror it to the OS window, so we observe <head> and call setTitle.
export function installTitleSync(doc, Observer) {
  let last = null;
  const apply = () => {
    const next = windowTitleFor(doc.title);
    if (next === last) return;
    last = next;
    try {
      const p = Neutralino.window.setTitle(next);
      if (p && typeof p.catch === "function") p.catch(() => { last = null; });
    } catch { last = null; /* window.* gated or not ready */ }
  };
  apply();
  if (typeof Observer === "function" && doc.head) {
    const obs = new Observer(apply);
    obs.observe(doc.head, { childList: true, subtree: true, characterData: true });
    return { apply, disconnect: () => obs.disconnect() };
  }
  return { apply, disconnect: () => {} };
}

// Restore keyboard focus when the native window is activated again.
// On WebView2 (and some Linux WMs) the OS window gets focus back on Alt+Tab
// but the web content does not, so keydown handlers stay silent until a
// click. On activation we (1) ask the native window to focus the webview if
// the document has no focus, rate-limited so that our own focus call cannot
// loop through another windowFocus event, and (2) put DOM focus back on the
// element that had it before the blur, unless something else has it now.
export function installFocusRestore(win, doc, opts = {}) {
  const now = opts.now || (() => Date.now());
  const minGapMs = opts.minGapMs != null ? opts.minGapMs : 1000;
  let lastActive = null;
  let lastNativeFocus = -Infinity;

  const isIdle = (el) => !el || el === doc.body || el === doc.documentElement;

  const remember = () => {
    const a = doc.activeElement;
    if (!isIdle(a)) lastActive = a;
  };

  const restoreDom = () => {
    try { win.focus(); } catch {}
    if (!isIdle(doc.activeElement)) return;
    const t = lastActive;
    if (t && t.isConnected && typeof t.focus === "function") {
      try { t.focus({ preventScroll: true }); } catch {}
    }
  };

  const onNativeFocus = () => {
    const hasFocus = typeof doc.hasFocus === "function" ? doc.hasFocus() : true;
    if (!hasFocus && now() - lastNativeFocus >= minGapMs) {
      lastNativeFocus = now();
      try {
        const p = Neutralino.window.focus();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch { /* window.* gated or not ready */ }
    }
    restoreDom();
  };

  try { Neutralino.events.on("windowBlur", remember); } catch {}
  try { Neutralino.events.on("windowFocus", onNativeFocus); } catch {}
  win.addEventListener("blur", remember);
  win.addEventListener("focus", restoreDom);
  return { remember, restoreDom, onNativeFocus };
}
