// Native window glue for the Vela desktop shell:
//   - window title sync: "Vela Slides - <Deck Title>" (plain "Vela Slides"
//     when the deck has no title);
//   - keyboard-focus re-arm when the window regains focus (alt-tab).
//
// Only two native methods are used here, both enumerated in
// neutralino.config.json's nativeAllowList: window.setTitle and window.focus.
// Neither takes a path or runs a command.

const APP_NAME = "Vela Slides";

// The deck title is deck-supplied (untrusted) and this is the one place it
// reaches a native call, so this filter is the control, not a backstop: on
// the desktop deck-open path the app receives the file's own title text and
// calls setWindowTitle with it. Policy mirrors the identity-label encoder
// skills/vela-slides/scripts/_safe_term.py (term_label): NFKC first, then drop
// by Unicode property, blank glyphs to a space, whitespace collapsed, capped.
//   Cc            controls (C0, DEL, C1)
//   Cf            format: bidi overrides, zero-width, soft hyphen, tag chars
//   Co / Cn       private use (font-dependent glyphs) / unassigned
//   Zl / Zp       line / paragraph separators (break a one-line title)
//   Default_Ignorable_Code_Point  characters that render as nothing
// Without this, a title can hide or reorder text, or pad the bar with blank
// glyphs so that deck text reads as app-issued text.
const TITLE_DROP = /[\p{Cf}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;
const TITLE_CONTROL = /\p{Cc}/u;
// Glyphs that render blank but are not whitespace (mirrors _safe_term.py
// _BLANK_GLYPHS). They become a space, which the collapse below then folds.
const TITLE_BLANK = /[ᅟᅠ឴឵᠎⠀ㅤﾠ]/u;
const TITLE_SURROGATE = /\p{Cs}/u;
const TITLE_COMBINING = /[\p{Mn}\p{Me}]/u;
const ZWJ = "‍";
const MAX_COMBINING_RUN = 2;
const TITLE_MAX = 200; // code points, ellipsis included

// Pure: untrusted title text -> one plain line ("" when nothing is left).
// One pass over code points, as in _safe_term.py.
function titleLabel(raw) {
  let s;
  try { s = raw.normalize("NFKC"); } catch { return ""; }
  const cps = Array.from(s);
  let out = "", run = 0;
  for (let i = 0; i < cps.length; i++) {
    const ch = cps[i];
    if (TITLE_SURROGATE.test(ch)) return ""; // lone surrogate: fail closed
    if (TITLE_BLANK.test(ch)) { out += " "; run = 0; continue; }
    // Emoji joiner: kept only between two non-ASCII characters (pictographs).
    if (ch === ZWJ && i > 0 && i < cps.length - 1 &&
        cps[i - 1].codePointAt(0) > 0x7f && cps[i + 1].codePointAt(0) > 0x7f) { out += ch; continue; }
    if (TITLE_DROP.test(ch)) { run = 0; continue; }
    if (/\s/.test(ch)) { out += " "; run = 0; continue; } // tab, newline, NBSP... -> space
    if (TITLE_CONTROL.test(ch)) { run = 0; continue; }
    if (TITLE_COMBINING.test(ch)) { if (++run > MAX_COMBINING_RUN) continue; } else run = 0;
    out += ch;
  }
  out = out.replace(/\s+/g, " ").trim();
  const outCps = Array.from(out);
  if (outCps.length > TITLE_MAX) out = outCps.slice(0, TITLE_MAX - 1).join("").trimEnd() + "…";
  return out;
}

// The app's own "no title" sentinel (part-reducer.jsx / part-app.jsx). It must
// map to the plain app name, the same as an empty title, not show up as text.
const NO_TITLE_SENTINEL = "Untitled";

// Pure: deck title -> native window title. Type-check first: a non-string
// never reaches the native call. Every deck title gets the fixed
// "Vela Slides - " prefix, so deck text never stands as the whole title and
// cannot read as app-issued text. Only a title that IS exactly the app name
// maps to the plain app name (no "Vela Slides - Vela Slides"); a title that
// only starts with the app name still gets the prefix.
export function windowTitleFor(deckTitle) {
  if (typeof deckTitle !== "string") return APP_NAME;
  const t = titleLabel(deckTitle);
  if (!t || t === NO_TITLE_SENTINEL || t.toLowerCase() === APP_NAME.toLowerCase()) return APP_NAME;
  return `${APP_NAME} - ${t}`;
}

let lastTitle = null;

// Always computed from the fixed template above (never appended to the
// previous title), so repeated updates cannot stack prefixes.
export function setWindowTitle(deckTitle) {
  const title = windowTitleFor(deckTitle);
  if (title === lastTitle) return;
  lastTitle = title;
  try {
    const p = Neutralino.window.setTitle(title);
    if (p && typeof p.catch === "function") p.catch(() => { lastTitle = null; });
  } catch { lastTitle = null; /* window.* not ready — next update retries */ }
}

// Bring the native OS window to the foreground and give it keyboard focus.
// Neutralino opens the window but on Windows/WebView2 (and some Linux WMs) it
// does NOT grab focus on launch — so keydown events never reach the webview
// until the user clicks the window. That breaks every "press Enter to confirm"
// dialog on first run (deck warning, trust prompt, React confirm modals). We
// focus explicitly after init, and retry a couple of times because the native
// window is created asynchronously and an immediate focus() can no-op.
let pendingRetryTimers = [];

// Drop any focus() retries still waiting to fire. Called on blur/hidden so a
// delayed retry can never raise Vela back over an app the user switched to.
function cancelPendingRetries() {
  for (const id of pendingRetryTimers) clearTimeout(id);
  pendingRetryTimers = [];
}

// The moment the user leaves the window, cancel the retries below. The
// refocus-on-return behavior is untouched: installRefocus() calls
// focusWindow() again on the next focus/visible/windowFocus signal, which
// arms a fresh retry sequence.
window.addEventListener("blur", cancelPendingRetries);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") cancelPendingRetries();
});

// Give the document keyboard focus so Vela's window-level keydown handlers
// (presenter, editor, gallery) receive events. DOM-only: it moves focus
// inside our own page, never across processes or windows, so unlike
// Neutralino.window.focus() it cannot steal the OS foreground from another
// app (D2).
// document.body.focus() is a no-op (body is not focusable without tabindex),
// so focus the app root, made programmatically focusable with tabindex="-1"
// (not in the Tab order). Only when nothing in the page holds focus: an
// input, button or dialog control that has focus keeps it.
function domFocusRestore() {
  try {
    const active = document.activeElement;
    if (active && active !== document.body && active !== document.documentElement) return;
    const root = document.getElementById("root");
    if (!root || typeof root.focus !== "function") return;
    if (!root.hasAttribute("tabindex")) {
      root.setAttribute("tabindex", "-1");
      root.style.outline = "none"; // app chrome: no focus ring around the whole app
    }
    root.focus({ preventScroll: true });
  } catch { /* document not ready */ }
}

export function focusWindow() {
  cancelPendingRetries();
  const tryFocus = () => { try { Neutralino.window.focus(); } catch { /* window.* gated or not ready */ } };
  tryFocus();
  domFocusRestore();
  pendingRetryTimers.push(setTimeout(tryFocus, 120));
  pendingRetryTimers.push(setTimeout(tryFocus, 400));
}

// The same platform quirk repeats on every focus transition, not only at
// launch: after alt-tab the OS window is active again, but the embedded
// webview control does not get its inner input focus back, so Vela's
// window-level keydown handlers (presenter, editor, gallery) stay dead until a
// click. Re-run focusWindow() on each refocus signal. Three signals because no
// single one fires on every platform; a short latch collapses duplicates.
export function installRefocus() {
  let latched = false;
  const refocus = () => {
    if (latched) return;
    latched = true;
    setTimeout(() => { latched = false; }, 600);
    focusWindow();
  };
  window.addEventListener("focus", refocus);
  // "visibilitychange" -> "visible" fires not only when the user returns, but
  // also on window-occlusion changes (a covering window moves away, or an
  // un-minimize) under WebView2/Chromium occlusion tracking. That is not "the
  // user came back", so it must NOT call the native Neutralino.window.focus()
  // — doing so would pull Vela over the app the user is actually using (D2).
  // Restore only the in-page keyboard focus here; the native call stays
  // gated to the two signals below, which fire only on a real focus gain.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") domFocusRestore();
  });
  try { Neutralino.events.on("windowFocus", refocus); } catch { /* events not ready */ }
  return refocus;
}
