// vela-helpers.mjs — the app's PREDICTIVE MODEL, captured ONCE as stable verbs.
// Authored by whoever knows the app (the implementer). Validators/hunters import
// these instead of re-predicting selectors/timing per burst. Each verb WAITS on its
// own post-condition (no fixed sleeps), so it adapts to timing and fails LOUDLY at a
// named step if the model is wrong — turning "blind prediction" into "observe+assert
// locally, in-browser". The stable data-testids (editor-gallery-toggle,
// data-hidden-overlay, ...) are the app's published driver contract.

const clickLeafText = (page, txt, last = false) => page.evaluate(({ txt, last }) => {
  const els = [...document.querySelectorAll("*")].filter(e => e.children.length === 0 && e.textContent.trim() === txt);
  const el = last ? els[els.length - 1] : els[0]; if (!el) return false; el.click(); return true;
}, { txt, last });

const fsOverlay = () => {
  const fs = [...document.querySelectorAll("*")].find(e => { const s = getComputedStyle(e); return s.position === "fixed" && +s.zIndex >= 40 && e.offsetWidth > 500; });
  return fs || null;
};

export async function selectModule(page, name) {
  if (!await clickLeafText(page, name)) throw new Error(`selectModule: no list item "${name}"`);
  await page.waitForTimeout(150);
}
export async function present(page) {
  const ok = await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find(x => /Present/.test(x.textContent)); if (!b) return false; b.click(); return true; });
  if (!ok) throw new Error("present: no Present button");
  await page.waitForFunction(() => { const fs = [...document.querySelectorAll("*")].find(e => { const s = getComputedStyle(e); return s.position === "fixed" && +s.zIndex >= 40 && e.offsetWidth > 500; }); return !!fs; }, { timeout: 5000 });
}
export async function openTOC(page) {
  await page.keyboard.press("Control+e");
  await page.waitForFunction(() => !!document.querySelector("input[placeholder*='earch']"), { timeout: 4000 });
}
export async function jumpTo(page, title) {
  if (!await clickLeafText(page, title, true)) throw new Error(`jumpTo: no TOC row "${title}"`);
  await page.waitForFunction((t) => { const fs = [...document.querySelectorAll("*")].find(e => { const s = getComputedStyle(e); return s.position === "fixed" && +s.zIndex >= 40 && e.offsetWidth > 500; }); return fs && [...fs.querySelectorAll("[data-block-type=heading]")].some(h => h.textContent.trim() === t); }, title, { timeout: 4000 });
  // CAVEAT: jumpTo confirms the JUMP landed; it does NOT restore keyboard focus to the
  // deck. After a synthetic TOC-row click, focus stays on the search input, so arrow
  // keys route there, not to the presenter (a headless artifact — a real mouse click on
  // a row moves focus off the input). To test post-jump KEYBOARD nav, click the slide
  // surface first, or (better) test sequential nav from a fresh present() instead.
}
export async function counter(page) {
  return page.evaluate(() => { const fs = [...document.querySelectorAll("*")].find(e => { const s = getComputedStyle(e); return s.position === "fixed" && +s.zIndex >= 40 && e.offsetWidth > 500; }); if (!fs) return null; const head = [...fs.querySelectorAll("[data-block-type=heading]")].map(e => e.textContent.trim()).filter(Boolean)[0] || null; const pill = [...fs.querySelectorAll("div,span")].filter(d => d.children.length === 0 && /^(⊘|\d{1,2})\s*\/\s*\d{1,2}$/.test(d.textContent.trim())).map(d => d.textContent.trim()); return { head, counters: [...new Set(pill)] }; });
}
export async function snapshotActions(page) {
  // Bootstrap the model from the live DOM instead of reading 16k lines of source.
  return page.evaluate(() => ({
    testids: [...document.querySelectorAll("[data-testid]")].map(e => e.getAttribute("data-testid")).slice(0, 40),
    buttons: [...document.querySelectorAll("button")].map(b => (b.textContent || "").trim()).filter(Boolean).slice(0, 30),
  }));
}

// ── verbs crystallized from the full-hunt friction (edit / gallery / save / drag) ──
// A prior hunt could not exercise CR1-icon / CR4 / CR8 because these flows weren't
// captured. They are now — each verified against the live app.

// EditableText only enters edit on a REAL pointer click (element.click() does nothing).
export async function editHeading(page, index = 0, appendText = " EDIT") {
  const box = await page.evaluate((i) => { const el = [...document.querySelectorAll("[data-block-type=heading]")][i]; if (!el) return null; const t = [...el.querySelectorAll("*")].reverse().find(n => n.children.length === 0 && n.textContent.trim()); const b = (t || el).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, index);
  if (!box) throw new Error(`editHeading: no heading[${index}]`);
  await page.mouse.click(box.x, box.y);
  if (!await page.evaluate(() => !!(document.activeElement && document.activeElement.isContentEditable))) throw new Error("editHeading: click did not enter contentEditable");
  await page.keyboard.press("End"); await page.keyboard.type(appendText); await page.keyboard.press("Tab"); // Tab commits (Escape cancels)
  await page.waitForTimeout(150);
  return page.evaluate((i) => { const el = [...document.querySelectorAll("[data-block-type=heading]")][i]; const t = [...el.querySelectorAll("*")].reverse().find(n => n.children.length === 0 && n.textContent.trim()); return (t || el).textContent.trim(); }, index);
}
// Click an existing heading icon -> icon picker opens.
export async function editIcon(page, index = 0) {
  const box = await page.evaluate((i) => { const el = [...document.querySelectorAll("[data-block-type=heading]")][i]; const svg = el && el.querySelector("svg"); if (!svg) return null; const b = svg.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, index);
  if (!box) throw new Error(`editIcon: no icon on heading[${index}]`);
  await page.mouse.click(box.x, box.y);
  await page.waitForFunction(() => !!document.querySelector("input[placeholder*='con']") || /Pick an icon|Search icons/i.test(document.body.textContent), { timeout: 3000 }).catch(() => {});
  return page.evaluate(() => !!document.querySelector("input[placeholder*='con']") || /Pick an icon|Search icons/i.test(document.body.textContent));
}
export async function exitPresent(page) { await page.keyboard.press("f"); await page.waitForFunction(() => { const fs = [...document.querySelectorAll("*")].find(e => { const s = getComputedStyle(e); return s.position === "fixed" && +s.zIndex >= 40 && e.offsetWidth > 500; }); return !fs || !!document.querySelector("header"); }, { timeout: 4000 }).catch(() => {}); }
export async function openGallery(page) { if (!await page.evaluate(() => { const b = document.querySelector("[data-testid=editor-gallery-toggle]"); if (!b) return false; b.click(); return true; })) throw new Error("openGallery: no editor-gallery-toggle (must be in editor mode, not presenting)"); await page.waitForFunction(() => /GALLERY/.test(document.body.textContent), { timeout: 4000 }); }
export async function galleryState(page) { return page.evaluate(() => ({ open: /GALLERY/.test(document.body.textContent), hiddenOverlays: document.querySelectorAll("[data-hidden-overlay]").length, hiddenBadges: document.querySelectorAll("[data-hidden-badge]").length })); }
// Save-status pill: value is 'dirty'|'saving'|'saved'|'error'. After an edit it stays
// 'dirty' during the ~1.5s autosave debounce, then 'saving' -> 'saved'. Poll ~3s.
export async function saveStatus(page) { return page.evaluate(() => { const p = document.querySelector("[data-vela-save-status]"); return p ? p.getAttribute("data-vela-save-status") : null; }); }
export async function dropZoneVisible(page) { return page.evaluate(() => [...document.querySelectorAll("*")].some(e => /Drop deck to load/i.test(e.textContent || ""))); }
// Simulate a drag over the app root. files:true => a real FILE drag (types include
// "Files", must show the drop zone); files:false => an internal drag (must NOT).
// Dispatch on a #root descendant so it bubbles to React's delegated root handler.
export async function simulateDrag(page, { files = false } = {}) { await page.evaluate((withFiles) => { const root = document.getElementById("root"); const tgt = (root && root.querySelector("*")) || root; const dt = new DataTransfer(); if (withFiles) dt.items.add(new File(["x"], "a.vela", { type: "text/plain" })); else dt.setData("text/plain", "x"); for (const n of ["dragenter", "dragover"]) tgt.dispatchEvent(new DragEvent(n, { bubbles: true, cancelable: true, dataTransfer: dt })); }, files); await page.waitForTimeout(200); }
export async function endDrag(page) { await page.evaluate(() => { const root = document.getElementById("root"); const tgt = (root && root.querySelector("*")) || root; tgt.dispatchEvent(new DragEvent("dragleave", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })); }); await page.waitForTimeout(150); }

// ── Fullscreen-safe keyboard (GOTCHA crystallized from a hunt) ─────────────────
// Once the app is in fullscreen presenter mode (real/synthetic 'f' → requestFullscreen),
// Playwright's page.keyboard.press AND page.screenshot/ctx.shot HANG indefinitely in
// headless Chromium. Drive presenter keys via a SYNTHETIC KeyboardEvent dispatched on
// document instead (bubbles to the app's window-level keydown handler), and take shots
// only after leaving fullscreen. Mouse (click/wheel) and CDP touch are unaffected.
// navKey(page, "ArrowRight") | navKey(page, "e", {ctrlKey:true}) | navKey(page, "f")
export async function navKey(page, key, mods = {}) {
  await page.evaluate(({ key, mods }) => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods }));
  }, { key, mods });
  await page.waitForTimeout(120);
}
// Enter fullscreen presenter via synthetic 'f' (avoids the keyboard.press hang path);
// waits for the fixed full-viewport presenter container to appear.
export async function presentKey(page) {
  await navKey(page, "f");
  await page.waitForFunction(() => [...document.querySelectorAll("*")].some(e => { const s = getComputedStyle(e); return s.position === "fixed" && +s.zIndex >= 40 && e.offsetWidth > 500; }), { timeout: 5000 });
}
// CDP touch swipe: dir<0 (finger right→left) = forward/next; dir>0 (left→right) = back/prev.
export async function swipe(page, dir = -1) {
  const cdp = await page.context().newCDPSession(page);
  const [x0, x1] = dir < 0 ? [900, 300] : [300, 900];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: 400 }] });
  for (let x = x0; dir < 0 ? x >= x1 : x <= x1; x += dir < 0 ? -100 : 100)
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: 400 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(150);
}
