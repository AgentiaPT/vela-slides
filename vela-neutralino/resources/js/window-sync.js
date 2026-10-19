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
// Every control (Cc) and format (Cf) code point, line/paragraph separators
// and lone surrogates. Cf covers zero-width marks, bidi marks/overrides/
// isolates (incl. U+061C ALM), U+180E, soft hyphen, BOM, interlinear and tag
// characters. The deck title is untrusted deck data; these characters could
// break the OS title bar or spoof its text direction.
const CONTROL_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/gu;
// Punctuation that may wrap or follow the product name: quotes and dashes.
const P = "[\\s\"'\\-\\u2013\\u2014:]*";
// The whole title is only the product name, e.g. `"Vela Slides"`, `Vela Slides -`.
const ONLY_APP_RE = new RegExp(`^${P}vela\\s+slides${P}$`, "i");
// The product name, then a dash/colon separator, then the real name, e.g.
// `Vela Slides - "X"`. A title that only begins with the words, such as
// `Vela Slides Roadmap`, has no separator and is kept intact.
const APP_PREFIX_RE = /^vela\s+slides\s*[-\u2013\u2014:]\s*(.+)$/i;
const unquote = (s) =>
  s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).trim() : s;

// Compute the native window title from the current document.title.
// Returns `Vela Slides` when there is no usable deck title, otherwise
// `Vela Slides - "<deck title>"`.
export function windowTitleFor(docTitle) {
  let name = typeof docTitle === "string" ? docTitle : "";
  if (name.endsWith(DOC_SUFFIX)) name = name.slice(0, -DOC_SUFFIX.length);
  name = name.replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim();
  // Never repeat the product name: drop a title that is only the name, and a
  // `Vela Slides - <name>` / `Vela Slides: <name>` prefix (up to 3 levels).
  for (let i = 0; i < 3; i++) {
    if (ONLY_APP_RE.test(name)) { name = ""; break; }
    const m = APP_PREFIX_RE.exec(name);
    if (!m) break;
    // A copied `Vela Slides - "X"` title: drop the wrapping quote pair only.
    name = unquote(m[1].trim());
  }
  // We add our own quotes; drop one wrapping pair so they are not doubled.
  name = unquote(name);
  if (!name || name.toLowerCase() === "untitled" || ONLY_APP_RE.test(name)) return APP_NAME;
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
// element that had it at the LAST blur, unless something else has it now.
// If the app root (body) had focus at that blur, nothing is refocused: focus
// stays on the root, so the window-level keydown handlers (slide navigation)
// get Arrow/Space instead of a stale input.
export function installFocusRestore(win, doc, opts = {}) {
  const now = opts.now || (() => Date.now());
  const minGapMs = opts.minGapMs != null ? opts.minGapMs : 1000;
  let lastActive = null;
  let lastNativeFocus = -Infinity;

  const isIdle = (el) => !el || el === doc.body || el === doc.documentElement;

  // Always overwrite: an older element must not survive a blur at the root.
  const remember = () => {
    const a = doc.activeElement;
    lastActive = isIdle(a) ? null : a;
  };

  // A real deactivation ends the echo window: the rate limit only stops our
  // own native focus call from looping through its windowFocus echo (no blur
  // between), never a second real Alt+Tab back within minGapMs.
  const onNativeBlur = () => {
    lastNativeFocus = -Infinity;
    remember();
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

  try { Neutralino.events.on("windowBlur", onNativeBlur); } catch {}
  try { Neutralino.events.on("windowFocus", onNativeFocus); } catch {}
  win.addEventListener("blur", remember);
  win.addEventListener("focus", restoreDom);
  return { remember, restoreDom, onNativeFocus };
}
