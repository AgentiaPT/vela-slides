// Sync-conflict dialog tests (Neutralino desktop shell).
//
// vela-neutralino/resources/js/sync-conflict.js shows the dialog when the deck
// file changed on disk while Vela had unsaved edits. These tests run the REAL
// module in jsdom and drive it with real DOM events. Each test runs twice:
//   [native]   the webview has <dialog>.showModal() (jsdom has none, so the
//              test adds a small model of it: open attribute, close event);
//   [fallback] no showModal: a fixed element with the highest z-index.
// They check:
//   - a file name with markup shows as text (no element is made from it);
//   - the dialog is in the top layer (native) or above every z-index (fallback);
//   - the focus starts on the dialog box, not on a choice button, so Enter or
//     Space alone picks nothing;
//   - the dialog cannot be dismissed: Escape, the cancel event, Ctrl/Cmd+O and a
//     backdrop click do nothing; no key reaches a listener of the app behind it,
//     also when the key target is inside the dialog;
//   - a false result or a throw shows the fixed error, keeps the dialog open and
//     shows "Keep editing", which closes it without a choice;
//   - closeSyncConflict() closes the open dialog without a choice;
//   - the module adds no property to the window.
// Tags in [] name the review finding or fix item that a test guards.
//
// jsdom is a dev dependency (package.json). When it is missing the suite exits
// with code 2: a missing test tool must not look like a pass.

"use strict";

const fs = require("fs");
const path = require("path");

let JSDOM;
try {
  ({ JSDOM } = require("jsdom"));
} catch (e) {
  console.log("  ❌ jsdom is not installed (" + String(e.message).split("\n")[0] + "). Run npm ci.");
  console.log("\n0 passed, 1 failed");
  process.exit(2);
}

const SRC_FILE = path.join(__dirname, "..", "vela-neutralino", "resources", "js", "sync-conflict.js");
// ES module → classic script: only the export keywords are removed.
const SRC = fs.readFileSync(SRC_FILE, "utf8").replace(/^export\s+function/gm, "function");
const FIXED_ERROR = "Could not keep a copy. Nothing was replaced. Try again.";
const KEEP = "Keep editing (saves stay paused)";

let pass = 0, fail = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };

function load(native) {
  const dom = new JSDOM("<!doctype html><html><head></head><body><div id=app><input id=appInput><button id=appBtn>x</button></div></body></html>", { runScripts: "outside-only" });
  const w = dom.window;
  const calls = { show: 0 };
  if (native) {
    // A model of the native API: showModal sets "open"; close removes it and
    // fires "close" in a later task, as browsers do.
    const P = w.HTMLDialogElement.prototype;
    P.showModal = function () { if (!this.isConnected) throw new w.DOMException("x", "InvalidStateError"); calls.show++; this.setAttribute("open", ""); };
    P.close = function () { if (!this.hasAttribute("open")) return; this.removeAttribute("open"); const d = this; w.setTimeout(() => d.dispatchEvent(new w.Event("close")), 0); };
    Object.defineProperty(P, "open", { configurable: true, get() { return this.hasAttribute("open"); } });
  }
  w.eval(SRC + "\nwindow.__show = showSyncConflict; window.__close = closeSyncConflict;");
  return { w, calls };
}
// The shell dialog is found by its data attribute, never by an id (a deck SVG
// can carry any id; see the [rr3 sec N1] test).
const SHELL = '[data-vela-shell="sync-conflict"]';
const hostOf = (w) => w.document.querySelector(SHELL);
const btns = (w) => [...hostOf(w).querySelectorAll("button")];
const boxOf = (w) => hostOf(w).querySelector(".box");
const ok = () => Promise.resolve(true);
function key(w, init, target) {
  const ev = new w.KeyboardEvent("keydown", Object.assign({ bubbles: true, cancelable: true }, init));
  (target || w.document.body).dispatchEvent(ev);
  return ev;
}
// Listeners like the app and the shell have: window and document, capture and
// bubble (trust.js uses document capture and takes Enter as "trust").
function listen(w) {
  const log = [];
  w.addEventListener("keydown", (e) => log.push("win-bubble:" + e.key));
  w.document.addEventListener("keydown", (e) => log.push("doc-bubble:" + e.key));
  w.document.addEventListener("keydown", (e) => log.push("doc-capture:" + e.key), true);
  w.document.getElementById("app").addEventListener("keydown", (e) => log.push("app:" + e.key));
  w.document.body.addEventListener("keydown", (e) => log.push("body:" + e.key));
  return log;
}

for (const native of [true, false]) {
  const T = native ? "[native] " : "[fallback] ";

  test(T + "a file name with markup renders as text; no element is made from it", () => {
    const { w } = load(native);
    const name = "<img src=x onerror=alert(1)><b>x<i>\"'&.vela";
    w.__show("/some/dir/" + name, { keepMine: ok, loadFile: ok });
    const host = hostOf(w);
    assert(host, "dialog missing");
    assert(host.querySelectorAll("img,b,i,script,iframe").length === 0, "an element was made from the name");
    assert(w.document.querySelectorAll("img,b,i").length === 0, "an element was made in the document");
    assert(host.querySelector(".sub").textContent === name, "the basename is not shown as text");
    assert(!host.textContent.includes("/some/dir"), "a directory is shown");
    assert(host.getAttribute("role") === "dialog" && host.getAttribute("aria-modal") === "true", "role or aria-modal missing");
  });

  test(T + "name edge cases: Windows separators, non-string input, very long name", () => {
    let { w } = load(native);
    w.__show("C:\\a\\b\\deck.vela", {});
    assert(w.document.querySelector(SHELL + " .sub").textContent === "deck.vela", "backslash basename");
    ({ w } = load(native));
    w.__show({ toString() { return "/x/evil"; } }, {});
    assert(w.document.querySelector(SHELL + " .sub").textContent === "", "a non-string name must show nothing");
    ({ w } = load(native));
    w.__show("/d/" + "é".repeat(400) + ".vela", {});
    assert(Array.from(w.document.querySelector(SHELL + " .sub").textContent).length === 255, "long name is not capped");
  });

  test(T + "[rr3 sec N1] a deck element with the old shell ids gets no shell style, is not removed, and labels nothing", () => {
    const { w } = load(native);
    // A deck SVG can carry any id (the SVG sanitizer keeps ids, drops data-*).
    const app = w.document.getElementById("app");
    const NS = "http://www.w3.org/2000/svg";
    const svg = w.document.createElementNS(NS, "svg");
    svg.setAttribute("id", "vela-sync-conflict");
    const t = w.document.createElementNS(NS, "text");
    t.setAttribute("id", "vela-sync-conflict-title");
    t.textContent = "Deck text";
    svg.appendChild(t);
    app.appendChild(svg);
    w.__show("deck.vela", { keepMine: ok, loadFile: ok });
    assert(svg.isConnected, "the deck element was removed as a stale dialog");
    const rules = [];
    for (const sh of w.document.styleSheets) for (const r of sh.cssRules) if (r.selectorText) rules.push(r.selectorText);
    assert(rules.length > 0, "test set-up: no shell rules");
    for (const sel of rules) {
      let hit = false;
      try { hit = svg.matches(sel) || t.matches(sel); } catch { hit = false; }
      assert(!hit, "a shell rule matches the deck element: " + sel);
    }
    const h = hostOf(w);
    assert(h && h !== svg, "test set-up: no shell dialog");
    assert(!h.hasAttribute("aria-labelledby"), "the dialog name uses an IDREF a deck element can take");
    assert(h.getAttribute("aria-label") === "File changed on disk", "aria-label " + h.getAttribute("aria-label"));
    // Hidden unless open: a shell element without "open" shows nothing.
    assert(w.getComputedStyle(h).display === "flex", "the open dialog is not shown: " + w.getComputedStyle(h).display);
    const closedEl = w.document.createElement("div");
    closedEl.setAttribute("data-vela-shell", "sync-conflict");
    w.document.body.appendChild(closedEl);
    assert(w.getComputedStyle(closedEl).display === "none", "a shell element that is not open is shown");
    closedEl.remove();
  });

  test(T + "[fix C1, sec UI F1] top layer (native showModal) or the highest z-index (fallback)", () => {
    const { w, calls } = load(native);
    w.__show("/a/deck.vela", { keepMine: ok, loadFile: ok });
    const h = hostOf(w);
    assert(h.tagName === (native ? "DIALOG" : "DIV"), "element " + h.tagName);
    if (native) assert(calls.show === 1 && h.open, "showModal was not called");
    const css = [...w.document.querySelectorAll("style")].map((s) => s.textContent).join("");
    assert(css.includes(SHELL + "[open] {") && /\[data-vela-shell="sync-conflict"\]\[open\] \{[^}]*z-index: 2147483647/.test(css), "z-index is not the highest value");
  });

  test(T + "[fix C3, sec UI F1] the focus starts on the box; Enter or Space alone picks nothing and reaches no listener", async () => {
    const { w } = load(native);
    const log = listen(w);
    let n = 0;
    w.__show("deck.vela", { keepMine: async () => { n++; return true; }, loadFile: async () => { n++; return true; } });
    const b = btns(w);
    assert(boxOf(w).tabIndex === -1, "box tabIndex " + boxOf(w).tabIndex);
    assert(w.document.activeElement === boxOf(w), "focus is on " + w.document.activeElement.tagName);
    assert(b.length === 3 && b[2].hidden === true && b[2].textContent === KEEP, "Keep editing is visible at start");
    for (const k of ["Enter", " "]) key(w, { key: k }, w.document.activeElement);
    await settle();
    assert(n === 0 && hostOf(w), "a choice ran");
    assert(log.length === 0, "a listener got the key: " + log.join(","));
  });

  test(T + "[fix C2, rev C9, sec UI F2] keys with a target inside the dialog reach no app listener; Tab/Enter/Space keep their default", () => {
    const { w } = load(native);
    const log = listen(w);
    w.__show("deck.vela", { keepMine: ok, loadFile: ok });
    for (const t of [...btns(w).slice(0, 2), boxOf(w)]) {
      for (const init of [{ key: "z", ctrlKey: true }, { key: "z", metaKey: true }, { key: "a" }, { key: "f" }, { key: "ArrowLeft" }, { key: "Enter" }, { key: " " }, { key: "Delete" }, { key: "Backspace" }, { key: "Tab" }]) {
        const e = key(w, init, t);
        if (["Enter", " ", "Tab"].includes(init.key)) assert(!e.defaultPrevented, JSON.stringify(init.key) + " lost its default on " + t.tagName);
      }
    }
    assert(log.length === 0, "a listener got a key from inside the dialog: " + log.join(","));
  });

  test(T + "Escape, Ctrl+O and Cmd+Shift+O are blocked inside and outside; cancel is blocked; a backdrop click does nothing", async () => {
    const { w, calls } = load(native);
    const log = listen(w);
    w.__show("deck.vela", { keepMine: ok, loadFile: ok });
    for (const t of [w.document.body, btns(w)[0], boxOf(w), w.document.getElementById("appInput")]) {
      assert(key(w, { key: "Escape" }, t).defaultPrevented, "Escape is not prevented");
      assert(hostOf(w), "Escape closed the dialog");
      assert(key(w, { key: "o", ctrlKey: true }, t).defaultPrevented, "Ctrl+O is not prevented");
      assert(key(w, { key: "O", metaKey: true, shiftKey: true }, t).defaultPrevented, "Cmd+Shift+O is not prevented");
    }
    assert(log.length === 0, "a blocked key reached a listener: " + log.join(","));
    if (native) {
      const c = new w.Event("cancel", { cancelable: true });
      hostOf(w).dispatchEvent(c);
      assert(c.defaultPrevented, "the cancel event is not prevented");
      // A close the module did not ask for (Chromium can skip cancel): it opens again.
      hostOf(w).close();
      await settle();
      assert(hostOf(w) && hostOf(w).open && calls.show === 2, "the dialog did not open again after an unexpected close");
      assert(w.document.activeElement === boxOf(w), "focus is not on the box after the re-open");
    }
    hostOf(w).click();
    assert(hostOf(w), "a backdrop click closed the dialog");
  });

  test(T + "modal: keys whose target is outside the dialog are blocked; Tab sends the focus back to the box", () => {
    const { w } = load(native);
    const log = listen(w);
    w.__show("deck.vela", { keepMine: ok, loadFile: ok });
    const input = w.document.getElementById("appInput");
    input.focus();
    for (const k of ["a", "Enter", " ", "Delete", "Backspace", "z", "ArrowLeft"]) {
      assert(key(w, { key: k }, input).defaultPrevented, "key " + JSON.stringify(k) + " outside the dialog was not blocked");
    }
    assert(key(w, { key: "z", ctrlKey: true }, input).defaultPrevented, "Ctrl+Z outside the dialog was not blocked");
    assert(key(w, { key: "Tab" }, input).defaultPrevented, "Tab outside the dialog was not blocked");
    assert(w.document.activeElement === boxOf(w), "Tab did not send the focus back to the box");
    assert(log.length === 0, "a key reached the app behind the dialog: " + log.join(","));
  });

  test(T + "[fix C5, sec disk F2] false and throw: fixed error, Keep editing shown, all enabled, focus on the box; busy disables all", async () => {
    const { w } = load(native);
    let release, calls = 0, fileCalls = 0;
    w.__show("deck.vela", {
      keepMine: () => { calls++; return new Promise((r) => { release = r; }); },
      loadFile: async () => { fileCalls++; throw new Error("/secret/path boom"); },
    });
    const [mine, file, keep] = btns(w);
    const err = hostOf(w).querySelector(".err");
    assert(err.hidden === true && err.textContent === "", "the error is visible at start");
    mine.focus(); mine.click();
    await tick();
    assert(mine.disabled && file.disabled && keep.disabled, "the buttons are not disabled while the action runs");
    mine.click(); file.click();
    await tick();
    assert(calls === 1 && fileCalls === 0, "a second action started while busy");
    release(false);
    await settle();
    assert(hostOf(w), "false closed the dialog");
    assert(err.hidden === false && err.textContent === FIXED_ERROR, "the fixed error is not shown: " + err.textContent);
    assert(keep.hidden === false && keep.textContent === KEEP, "Keep editing is not shown after a failed choice");
    assert(!mine.disabled && !file.disabled && !keep.disabled, "the buttons are still disabled after false");
    assert(w.document.activeElement === boxOf(w), "focus is not on the box after a failed choice");
    file.click();
    await settle();
    assert(hostOf(w) && fileCalls === 1, "a throw closed the dialog");
    assert(err.textContent === FIXED_ERROR && !hostOf(w).textContent.includes("secret") && !hostOf(w).textContent.includes("boom"), "the raw error text is shown");
    assert(w.document.activeElement === boxOf(w), "focus is not on the box after a throw");
  });

  test(T + "[fix C5, sec disk F2] Keep editing closes without a choice (false); the key block ends; a new dialog can open", async () => {
    const { w } = load(native);
    const p = w.__show("deck.vela", { keepMine: async () => false, loadFile: ok });
    let val = "unset"; p.then((v) => { val = v; });
    btns(w)[0].click(); await settle();
    btns(w)[2].click(); await settle();
    assert(!hostOf(w), "the dialog is still there");
    assert(val === false, "the promise value is " + val);
    assert(!key(w, { key: "Escape" }).defaultPrevented, "the key handler is still active");
    const log = listen(w);
    key(w, { key: "z", ctrlKey: true }, w.document.getElementById("appInput"));
    assert(log.length > 0, "keys are still stopped after the close");
    const p2 = w.__show("deck.vela", {});
    assert(p2 !== p && hostOf(w), "no new dialog after Keep editing");
  });

  test(T + "only the value true closes: truthy values and a missing action do not", async () => {
    const { w } = load(native);
    const done = w.__show("deck.vela", { keepMine: async () => "yes", loadFile: async () => 1 });
    let settled = false;
    done.then(() => { settled = true; });
    const [mine, file] = btns(w);
    mine.click(); await settle();
    assert(hostOf(w) && !settled, "a truthy string closed the dialog");
    file.click(); await settle();
    assert(hostOf(w) && !settled, "the number 1 closed the dialog");
    const w2 = load(native).w;
    w2.__show("deck.vela", {});
    btns(w2)[0].click();
    await settle();
    assert(hostOf(w2), "a missing action closed the dialog");
    assert(hostOf(w2).querySelector(".err").textContent === FIXED_ERROR, "no error for a missing action");
    // true closes, resolves true, and removes the key handler.
    const w3 = load(native).w;
    let v = "unset";
    w3.__show("deck.vela", { keepMine: ok }).then((x) => { v = x; });
    btns(w3)[0].click(); await settle();
    assert(!hostOf(w3) && v === true, "true did not close: " + v);
    assert(!key(w3, { key: "a" }, w3.document.getElementById("appInput")).defaultPrevented, "keys are still blocked after close");
  });

  test(T + "[fix C4, rev G1] closeSyncConflict closes and resolves false; idempotent; safe with no dialog; a late true is ignored", async () => {
    const { w } = load(native);
    w.__close(); // no dialog: no throw
    const p = w.__show("deck.vela", { keepMine: ok, loadFile: ok });
    let val = "unset"; p.then((v) => { val = v; });
    w.__close(); w.__close(); await settle();
    assert(!hostOf(w) && val === false, "close: " + val);
    let release;
    const p2 = w.__show("deck.vela", { keepMine: () => new Promise((r) => { release = r; }), loadFile: ok });
    let v2 = "unset"; p2.then((v) => { v2 = v; });
    btns(w)[0].click(); await tick();
    w.__close(); await settle();
    assert(!hostOf(w) && v2 === false, "close while busy: " + v2);
    release(true); await settle();
    assert(v2 === false && !hostOf(w), "a late true changed the state");
    const p3 = w.__show("x.vela", {});
    assert(p3 !== p2 && hostOf(w) && w.document.querySelectorAll(SHELL).length === 1, "no new dialog after a close while busy");
  });

  test(T + "a second call while open returns the same promise and one dialog; after close a new one opens", async () => {
    const { w } = load(native);
    const p1 = w.__show("a.vela", { keepMine: ok, loadFile: ok });
    const p2 = w.__show("b.vela", { keepMine: ok, loadFile: ok });
    assert(p1 === p2, "not the same promise");
    assert(w.document.querySelectorAll(SHELL).length === 1, "more than one dialog");
    assert(w.document.querySelector(SHELL + " .sub").textContent === "a.vela", "the first dialog was replaced");
    btns(w)[1].click();
    await settle();
    assert(!hostOf(w), "true did not close");
    const p3 = w.__show("c.vela", {});
    assert(p3 !== p1 && hostOf(w), "no new dialog after close");
  });

  test(T + "the module adds no property to the window and no element outside its own dialog and style", async () => {
    const { w } = load(native);
    const before = new Set(Object.getOwnPropertyNames(w));
    const bodyKids = w.document.body.children.length;
    w.__show("x.vela", { keepMine: ok, loadFile: ok });
    const added = Object.getOwnPropertyNames(w).filter((k) => !before.has(k));
    assert(added.length === 0, "new window properties: " + added.join(","));
    assert(w.document.body.children.length === bodyKids + 1, "the dialog added more than one body element");
    btns(w)[0].click();
    await settle();
    assert(w.document.body.children.length === bodyKids, "the dialog left an element behind");
    assert(Object.getOwnPropertyNames(w).filter((k) => !before.has(k)).length === 0, "new window properties after close");
  });
}

test("[native] showModal throws: the dialog shows in place with the open attribute and the focus on the box", () => {
  const { w } = load(true);
  w.HTMLDialogElement.prototype.showModal = function () { throw new Error("nope"); };
  w.__show("x.vela", {});
  assert(hostOf(w).tagName === "DIALOG" && hostOf(w).hasAttribute("open"), "not shown");
  assert(w.document.activeElement === boxOf(w), "focus is not on the box");
});

(async () => {
  console.log("── sync-conflict dialog (jsdom) ──");
  for (const t of tests) {
    try { await t.fn(); pass++; console.log("  ✅ " + t.name); }
    catch (e) { fail++; console.log("  ❌ " + t.name + " — " + String(e && e.message).split("\n")[0]); }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
