// CR16 + CR18 \u2014 desktop window helpers (vela-neutralino/resources/js/window-sync.js).
//
// CR16: the OS window title shows `Vela Slides - "Deck Title"`, never repeats
//       "Vela Slides", strips control/bidi characters and caps the length.
// CR18: after the window is activated again (Alt+Tab) keyboard focus returns
//       without a click: native focus when the document has none, DOM focus
//       back on the element that had it, and no focus loop.
//
// Loads the REAL module source, strips its ESM `export` keywords, and runs it
// against a mock Neutralino + minimal window/document mocks.

const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "vela-neutralino", "resources", "js", "window-sync.js"), "utf8");

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✅ " + n); };
const bad = (n, d) => { fail++; console.log("  ❌ " + n + (d ? " \u2014 " + d : "")); };
const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };
const eq = (a, b, m) => assert(a === b, `${m || ""} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
function test(name, fn) { try { fn(); ok(name); } catch (e) { bad(name, e.message); } }

function load(Neutralino) {
  const body = SRC.replace(/^export /gm, "") +
    "\n;return { windowTitleFor, installTitleSync, installFocusRestore, APP_NAME };";
  // eslint-disable-next-line no-new-func
  return new Function("Neutralino", body)(Neutralino);
}

function makeNeu() {
  const calls = { setTitle: [], focus: 0 };
  const handlers = {};
  return {
    calls, handlers,
    window: {
      setTitle: (t) => { calls.setTitle.push(t); return Promise.resolve(); },
      focus: () => { calls.focus++; return Promise.resolve(); },
    },
    events: { on: (ev, fn) => { handlers[ev] = fn; return Promise.resolve(); } },
  };
}

// \u2500\u2500 CR16: title formatting \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const { windowTitleFor } = load(makeNeu());
const D = " \u2014 Vela Slides"; // the suffix part-app.jsx appends to document.title

test("default document title -> plain app name", () => eq(windowTitleFor("Vela Slides"), "Vela Slides"));
test("empty / missing title -> plain app name", () => {
  eq(windowTitleFor(""), "Vela Slides");
  eq(windowTitleFor(undefined), "Vela Slides");
  eq(windowTitleFor(null), "Vela Slides");
});
test("Untitled deck -> plain app name", () => eq(windowTitleFor("Untitled" + D), "Vela Slides"));
test("deck title -> Vela Slides - \"Deck Title\"", () =>
  eq(windowTitleFor("Q3 Roadmap" + D), 'Vela Slides - "Q3 Roadmap"'));
test("deck title with quotes and unicode kept", () =>
  eq(windowTitleFor('Café "Ops" Review' + D), 'Vela Slides - "Café "Ops" Review"'));
test("deck titled exactly 'Vela Slides' is not repeated", () =>
  eq(windowTitleFor("Vela Slides" + D), "Vela Slides"));
test("deck title starting with 'Vela Slides' is not repeated", () => {
  eq(windowTitleFor("Vela Slides - Intro" + D), 'Vela Slides - "Intro"');
  eq(windowTitleFor("vela slides: Intro" + D), 'Vela Slides - "Intro"');
  eq(windowTitleFor('Vela Slides - "Vela Slides - Intro"' + D), 'Vela Slides - "Intro"');
});
test("word that only starts like the app name is kept", () =>
  eq(windowTitleFor("Vela Slideshow Tips" + D), 'Vela Slides - "Vela Slideshow Tips"'));
test("control, bidi and zero-width chars are stripped", () => {
  const t = windowTitleFor("A\u0000B\nC\tD\u202eE\u200bF\u2066G\u0085H" + D);
  eq(t, 'Vela Slides - "A B C D E F G H"');
  assert(!/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/.test(t), "control char survived");
});
test("title that only begins with the words 'Vela Slides' is kept intact (W4)", () => {
  eq(windowTitleFor("Vela Slides Roadmap" + D), 'Vela Slides - "Vela Slides Roadmap"');
  eq(windowTitleFor('Vela Slides - "Vela Slides Roadmap"' + D), 'Vela Slides - "Vela Slides Roadmap"');
  eq(windowTitleFor("vela slides 2026 plan" + D), 'Vela Slides - "vela slides 2026 plan"');
});
test("a real trailing quote (inch mark) is not eaten (W4)", () => {
  eq(windowTitleFor('Vela Slides: 12"' + D), 'Vela Slides - "12""');
  eq(windowTitleFor('Screen 27"' + D), 'Vela Slides - "Screen 27""');
});
test("exact product name with quotes/dash punctuation -> plain app name (W4)", () => {
  eq(windowTitleFor('"Vela Slides"' + D), "Vela Slides");
  eq(windowTitleFor("VELA SLIDES -" + D), "Vela Slides");
  eq(windowTitleFor("— vela  slides —" + D), "Vela Slides");
  eq(windowTitleFor('Vela Slides - "Vela Slides"' + D), "Vela Slides");
  eq(windowTitleFor("Vela Slides - Untitled" + D), "Vela Slides");
  eq(windowTitleFor("Vela Slides – Intro" + D), 'Vela Slides - "Intro"');
});
test("other bidi/format marks are stripped (U+061C, U+180E, U+2064, U+FFF9, tags) (W4)", () => {
  const t = windowTitleFor("A؜B᠎C⁤D￹E­F\u{E0041}G" + D);
  eq(t, 'Vela Slides - "A B C D E F G"');
});
test("only control chars -> plain app name", () => eq(windowTitleFor("\u0001\u202e\u200b" + D), "Vela Slides"));
test("long title is capped with an ellipsis", () => {
  const t = windowTitleFor("x".repeat(500) + D);
  const inner = t.slice('Vela Slides - "'.length, -1);
  eq(Array.from(inner).length, 100, "inner length");
  assert(inner.endsWith("\u2026"), "ellipsis");
});
test("cap never splits a surrogate pair", () => {
  const t = windowTitleFor("\u{1F680}".repeat(200) + D);
  assert(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(t), "lone high surrogate");
});

// \u2500\u2500 CR16: sync on change \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
test("installTitleSync sets the title now and on every change, no duplicates", () => {
  const Neu = makeNeu();
  const { installTitleSync } = load(Neu);
  let cb = null;
  class Obs { constructor(fn) { cb = fn; } observe() {} disconnect() {} }
  const doc = { title: "Vela Slides", head: {} };
  installTitleSync(doc, Obs);
  eq(Neu.calls.setTitle.join("|"), "Vela Slides");
  doc.title = "Deck A" + D; cb();
  doc.title = "Deck A" + D; cb(); // unchanged -> no extra call
  doc.title = "Deck B" + D; cb();
  doc.title = "Vela Slides"; cb();
  eq(Neu.calls.setTitle.join("|"), 'Vela Slides|Vela Slides - "Deck A"|Vela Slides - "Deck B"|Vela Slides');
});
test("installTitleSync survives a throwing setTitle", () => {
  const Neu = makeNeu();
  Neu.window.setTitle = () => { throw new Error("gated"); };
  const { installTitleSync } = load(Neu);
  installTitleSync({ title: "X" + D, head: {} }, null);
});

// \u2500\u2500 CR18: focus restore \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function makeDom() {
  const body = { isConnected: true, focus() {} };
  const docEl = {};
  const doc = { body, documentElement: docEl, activeElement: body, focused: false, hasFocus() { return this.focused; } };
  const listeners = {};
  const win = {
    focusCalls: 0,
    focus() { this.focusCalls++; },
    addEventListener(ev, fn) { listeners[ev] = fn; },
  };
  const el = (name) => ({ name, isConnected: true, focus() { doc.activeElement = this; } });
  return { doc, win, listeners, el };
}

test("subscribes to windowFocus/windowBlur and DOM focus/blur", () => {
  const Neu = makeNeu();
  const { installFocusRestore } = load(Neu);
  const { doc, win, listeners } = makeDom();
  installFocusRestore(win, doc);
  assert(typeof Neu.handlers.windowFocus === "function", "windowFocus");
  assert(typeof Neu.handlers.windowBlur === "function", "windowBlur");
  assert(typeof listeners.focus === "function" && typeof listeners.blur === "function", "DOM listeners");
});

test("Alt+Tab back with no document focus -> native focus + DOM focus restored", () => {
  const Neu = makeNeu();
  const { installFocusRestore } = load(Neu);
  const { doc, win, el } = makeDom();
  const t = { v: 0 };
  installFocusRestore(win, doc, { now: () => t.v });
  const stage = el("stage");
  doc.activeElement = stage;
  Neu.handlers.windowBlur();          // user Alt+Tabs away
  doc.activeElement = doc.body;       // webview lost DOM focus
  doc.focused = false;
  Neu.handlers.windowFocus();         // user Alt+Tabs back
  eq(Neu.calls.focus, 1, "native focus calls");
  assert(win.focusCalls >= 1, "window.focus() called");
  eq(doc.activeElement, stage, "focus back on the stage element");
});

test("no focus loop: repeated windowFocus within the gap -> one native focus", () => {
  const Neu = makeNeu();
  const { installFocusRestore } = load(Neu);
  const { doc, win } = makeDom();
  const t = { v: 5000 };
  installFocusRestore(win, doc, { now: () => t.v, minGapMs: 1000 });
  Neu.handlers.windowFocus();
  Neu.handlers.windowFocus();         // echo of our own focus call
  t.v += 200; Neu.handlers.windowFocus();
  eq(Neu.calls.focus, 1, "rate-limited");
  t.v += 1000; Neu.handlers.windowFocus();
  eq(Neu.calls.focus, 2, "allowed again after the gap");
});

test("document already focused -> no native focus call", () => {
  const Neu = makeNeu();
  const { installFocusRestore } = load(Neu);
  const { doc, win } = makeDom();
  doc.focused = true;
  installFocusRestore(win, doc);
  Neu.handlers.windowFocus();
  eq(Neu.calls.focus, 0);
});

test("does not steal focus from an element that has it now", () => {
  const Neu = makeNeu();
  const { installFocusRestore } = load(Neu);
  const { doc, win, el } = makeDom();
  installFocusRestore(win, doc);
  const a = el("old"), b = el("input");
  doc.activeElement = a; Neu.handlers.windowBlur();
  doc.activeElement = b; doc.focused = true;
  Neu.handlers.windowFocus();
  eq(doc.activeElement, b);
});

test("removed element is not refocused", () => {
  const Neu = makeNeu();
  const { installFocusRestore } = load(Neu);
  const { doc, win, el, listeners } = makeDom();
  installFocusRestore(win, doc);
  const gone = el("modal");
  doc.activeElement = gone; listeners.blur();
  gone.isConnected = false;
  doc.activeElement = doc.body;
  listeners.focus();
  eq(doc.activeElement, doc.body);
});

test("throwing Neutralino.window.focus does not break DOM restore", () => {
  const Neu = makeNeu();
  Neu.window.focus = () => { throw new Error("gated"); };
  const { installFocusRestore } = load(Neu);
  const { doc, win, el } = makeDom();
  installFocusRestore(win, doc);
  const s = el("s"); doc.activeElement = s; Neu.handlers.windowBlur();
  doc.activeElement = doc.body;
  Neu.handlers.windowFocus();
  eq(doc.activeElement, s);
});

test("body focused at the last blur -> stale input is NOT refocused (W4 repro)", () => {
  const Neu = makeNeu();
  const { installFocusRestore } = load(Neu);
  const { doc, win, el, listeners } = makeDom();
  const t = { v: 10000 };
  installFocusRestore(win, doc, { now: () => t.v });
  const input = el("input");
  // 1. focus the input, Alt+Tab out and back: the input gets focus back.
  doc.activeElement = input;
  listeners.blur(); Neu.handlers.windowBlur();
  doc.activeElement = doc.body; doc.focused = false;
  Neu.handlers.windowFocus(); listeners.focus(); doc.focused = true;
  eq(doc.activeElement, input, "first cycle restores the input");
  // 2. click the slide body (input loses focus), Alt+Tab out and back.
  t.v += 300;
  doc.activeElement = doc.body;
  listeners.blur(); Neu.handlers.windowBlur();
  doc.focused = false;
  Neu.handlers.windowFocus(); listeners.focus();
  eq(doc.activeElement, doc.body, "focus must stay on the app root, not the stale input");
});

test("second real Alt+Tab within the gap -> native focus + DOM restore again (W4)", () => {
  const Neu = makeNeu();
  const { installFocusRestore } = load(Neu);
  const { doc, win, el } = makeDom();
  const t = { v: 10000 };
  installFocusRestore(win, doc, { now: () => t.v, minGapMs: 1000 });
  const stage = el("stage");
  for (let i = 0; i < 2; i++) {
    doc.activeElement = stage; Neu.handlers.windowBlur();
    doc.activeElement = doc.body; doc.focused = false;
    Neu.handlers.windowFocus();
    eq(doc.activeElement, stage, `cycle ${i + 1} DOM restore`);
    t.v += 300;
  }
  eq(Neu.calls.focus, 2, "each real activation gets one native focus call");
  Neu.handlers.windowFocus();          // echo with no blur between
  eq(Neu.calls.focus, 2, "echo is still rate-limited");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
