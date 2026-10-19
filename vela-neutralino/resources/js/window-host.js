// Native window helpers for the desktop shell (CR16 title, CR18 focus).
//
// Kept free of Neutralino globals so tests/test_window_host.cjs can drive the
// logic under Node. nl-boot.js wires these to the real window.

const APP_NAME = "Vela Slides";
// Native title bars are short. Cap the length so a long deck title cannot
// push the window chrome out of shape.
const MAX_TITLE_CHARS = 200;

// Native title for the window: "Vela Slides - <deck title>".
// The app sets document.title to "<deck> — Vela Slides", or to "Vela Slides"
// for an untitled deck. Neutralino does not follow document.title, so the host
// builds the native title from it. If the deck title already names the app, do
// not add the app name a second time.
export function nativeWindowTitle(docTitle) {
  let name = String(docTitle == null ? "" : docTitle);
  // Control characters have no place in a native title bar.
  name = name.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  const suffix = ` — ${APP_NAME}`;
  if (name.endsWith(suffix)) name = name.slice(0, -suffix.length).trim();
  let title;
  if (!name || name === "Untitled" || name === APP_NAME) title = APP_NAME;
  else if (/vela slides/i.test(name)) title = name;
  else title = `${APP_NAME} - ${name}`;
  return Array.from(title).slice(0, MAX_TITLE_CHARS).join("");
}

// Run fn whenever the window regains focus or becomes visible again (alt-tab,
// workspace switch). Returns an unbind function.
export function bindRegainFocus(win, doc, fn) {
  const onFocus = () => fn();
  const onVisible = () => { if (!doc.hidden) fn(); };
  win.addEventListener("focus", onFocus);
  doc.addEventListener("visibilitychange", onVisible);
  return () => {
    win.removeEventListener("focus", onFocus);
    doc.removeEventListener("visibilitychange", onVisible);
  };
}
