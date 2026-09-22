// Native window glue for the Vela desktop shell:
//   - window title sync: "Vela Slides - <Deck Title>" (plain "Vela Slides"
//     when the deck has no title);
//   - keyboard-focus re-arm when the window regains focus (alt-tab).
//
// Only two native methods are used here, both enumerated in
// neutralino.config.json's nativeAllowList: window.setTitle and window.focus.
// Neither takes a path or runs a command.

const APP_NAME = "Vela Slides";

// Control, bidi and zero-width characters have no place in a native title bar
// (they can visually reorder or hide text). The value comes from the app's own
// sanitized state; this is only a last cheap filter + length cap.
const TITLE_STRIP = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff]/g;

// The app's own "no title" sentinel (part-reducer.jsx / part-app.jsx). It must
// map to the plain app name, the same as an empty title, not show up as text.
const NO_TITLE_SENTINEL = "Untitled";

// Pure: deck title -> native window title. Type-check first: a non-string
// never reaches the native call. A title that already starts with the app
// name is used as-is so the bar never reads "Vela Slides - Vela Slides ...".
export function windowTitleFor(deckTitle) {
  if (typeof deckTitle !== "string") return APP_NAME;
  const t = deckTitle.replace(TITLE_STRIP, "").trim().slice(0, 200);
  if (!t || t === NO_TITLE_SENTINEL) return APP_NAME;
  if (t.toLowerCase().startsWith(APP_NAME.toLowerCase())) return t;
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

export function focusWindow() {
  cancelPendingRetries();
  const tryFocus = () => { try { Neutralino.window.focus(); } catch { /* window.* gated or not ready */ } };
  tryFocus();
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
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refocus();
  });
  try { Neutralino.events.on("windowFocus", refocus); } catch { /* events not ready */ }
  return refocus;
}
