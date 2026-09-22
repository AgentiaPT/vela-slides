// vela-verbs.mjs — the app's PREDICTIVE MODEL, captured ONCE as stable verbs.
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
  await page.waitForFunction(() => { const fs = [...document.querySelectorAll("*")].find(e => { const s = getComputedStyle(e); return s.position === "fixed" && +s.zIndex >= 40 && e.offsetWidth > 500; }); return !!fs; }, undefined, { timeout: 5000 });
}
export async function openTOC(page) {
  await page.keyboard.press("Control+e");
  await page.waitForFunction(() => !!document.querySelector("input[placeholder*='earch']"), undefined, { timeout: 4000 });
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
  await page.waitForFunction(() => !!document.querySelector("input[placeholder*='con']") || /Pick an icon|Search icons/i.test(document.body.textContent), undefined, { timeout: 3000 }).catch(() => {});
  return page.evaluate(() => !!document.querySelector("input[placeholder*='con']") || /Pick an icon|Search icons/i.test(document.body.textContent));
}
export async function exitPresent(page) { await navKey(page, "f"); await page.waitForFunction(() => { const fs = [...document.querySelectorAll("*")].find(e => { const s = getComputedStyle(e); return s.position === "fixed" && +s.zIndex >= 40 && e.offsetWidth > 500; }); return !fs && !!document.querySelector("header"); }, undefined, { timeout: 4000 }); }
export async function openGallery(page) { if (!await page.evaluate(() => { const b = document.querySelector("[data-testid=editor-gallery-toggle]"); if (!b) return false; b.click(); return true; })) throw new Error("openGallery: no editor-gallery-toggle (must be in editor mode, not presenting)"); await page.waitForFunction(() => /GALLERY/.test(document.body.textContent), undefined, { timeout: 4000 }); }
export async function galleryState(page) { return page.evaluate(() => ({ open: /GALLERY/.test(document.body.textContent), hiddenOverlays: document.querySelectorAll("[data-hidden-overlay]").length, hiddenBadges: document.querySelectorAll("[data-hidden-badge]").length })); }
// Desktop save-status pill when the native shell supplies one; otherwise the offline
// harness proves persistence from its in-memory window.storage payload.
export async function saveStatus(page) { return page.evaluate(async () => {
  const p = document.querySelector("[data-testid=save-status-pill]");
  if (p) return p.getAttribute("data-save-state");
  try { return (await window.storage?.get("vela-deck"))?.value ? "saved" : null; } catch { return null; }
}); }
export async function waitForSavedHeading(page, expectedText) {
  await page.waitForFunction((expected) => {
    try {
      const raw = window.__vmem?.["vela-deck"];
      if (!raw) return false;
      const deck = JSON.parse(raw);
      return (deck.lanes || []).some(lane => (lane.items || []).some(item =>
        (item.slides || []).some(slide => (slide.blocks || []).some(block =>
          block.type === "heading" && block.text === expected))));
    } catch { return false; }
  }, expectedText, { timeout: 6000 });
  return { status: await saveStatus(page), heading: expectedText };
}
export async function dropZoneVisible(page) { return page.evaluate(() => [...document.querySelectorAll("*")].some(e => /Drop deck to load/i.test(e.textContent || ""))); }
// Simulate a drag over the app root. files:true => a real FILE drag (types include
// "Files", must show the drop zone); files:false => an internal drag (must NOT).
// Dispatch on a #root descendant so it bubbles to React's delegated root handler.
export async function simulateDrag(page, { files = false } = {}) { await page.evaluate((withFiles) => { const root = document.getElementById("root"); const tgt = (root && root.querySelector("*")) || root; const dt = new DataTransfer(); if (withFiles) dt.items.add(new File(["x"], "a.vela", { type: "text/plain" })); else dt.setData("text/plain", "x"); for (const n of ["dragenter", "dragover"]) tgt.dispatchEvent(new DragEvent(n, { bubbles: true, cancelable: true, dataTransfer: dt })); }, files); await page.waitForTimeout(200); }
export async function endDrag(page) { await page.evaluate(() => { const root = document.getElementById("root"); const tgt = (root && root.querySelector("*")) || root; tgt.dispatchEvent(new DragEvent("dragleave", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })); }); await page.waitForTimeout(150); }

// ── Export menu + PowerPoint (.pptx) export ───────────────────────────────────
// Published driver contract (data-testids): export-menu-toggle,
// export-pptx-menu-item, pptx-export-modal, pptx-export-branding-toggle,
// pptx-export-start, pptx-export-done, pptx-export-download, pptx-export-error.

// Open the desktop Export dropdown; waits until the PowerPoint entry is present.
// Idempotent: if the entry is already visible (menu open) it is a no-op, so it is
// safe to call before exportPptx() without accidentally toggling the menu shut.
export async function openExportMenu(page) {
  if (await page.evaluate(() => !!document.querySelector("[data-testid=export-pptx-menu-item]"))) return;
  if (!await page.evaluate(() => { const b = document.querySelector("[data-testid=export-menu-toggle]"); if (!b) return false; b.click(); return true; }))
    throw new Error("openExportMenu: no export-menu-toggle (desktop header not mounted?)");
  await page.waitForFunction(() => !!document.querySelector("[data-testid=export-pptx-menu-item]"), undefined, { timeout: 4000 });
}

// Drive the whole PowerPoint export: open menu → click entry → start → wait for
// the done phase → read the download data: URI back. Returns { size, dataUri,
// download } where size is the decoded byte length of the produced .pptx. Throws
// LOUDLY at whichever step's post-condition fails. Set opts.branding=true to flip
// the "Made with Vela" toggle before exporting.
export async function exportPptx(page, opts = {}) {
  await openExportMenu(page);
  if (!await page.evaluate(() => { const b = document.querySelector("[data-testid=export-pptx-menu-item]"); if (!b) return false; b.click(); return true; }))
    throw new Error("exportPptx: export-pptx-menu-item vanished before click");
  await page.waitForFunction(() => !!document.querySelector("[data-testid=pptx-export-modal]"), undefined, { timeout: 4000 });
  if (opts.branding) {
    await page.evaluate(() => { const t = document.querySelector("[data-testid=pptx-export-branding-toggle]"); if (t) t.click(); });
  }
  if (!await page.evaluate(() => { const b = document.querySelector("[data-testid=pptx-export-start]"); if (!b) return false; b.click(); return true; }))
    throw new Error("exportPptx: no pptx-export-start button (modal stuck on choose?)");
  // Off-screen render loop (~350ms/slide) → done phase. Fail early on the error phase.
  await page.waitForFunction(() => {
    if (document.querySelector("[data-testid=pptx-export-error]")) return true;
    return !!document.querySelector("[data-testid=pptx-export-download]");
  }, { timeout: 60000 });
  const err = await page.evaluate(() => { const e = document.querySelector("[data-testid=pptx-export-error]"); return e ? e.textContent : null; });
  if (err) throw new Error(`exportPptx: modal reported error phase: ${err}`);
  const info = await page.evaluate(() => {
    const a = document.querySelector("[data-testid=pptx-export-download]");
    if (!a) return null;
    const uri = a.getAttribute("href") || "";
    const comma = uri.indexOf(",");
    const b64 = comma >= 0 ? uri.slice(comma + 1) : "";
    let size = 0;
    try { const bin = atob(b64); size = bin.length; } catch (e) { size = -1; }
    return { size, dataUri: uri, download: a.getAttribute("download") };
  });
  if (!info || !info.dataUri.startsWith("data:application/vnd.openxmlformats-officedocument.presentationml.presentation"))
    throw new Error("exportPptx: download href is not a .pptx data URI");
  if (!(info.size > 0)) throw new Error(`exportPptx: produced .pptx is empty (size=${info.size})`);
  return info;
}

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
  await page.waitForFunction(() => [...document.querySelectorAll("*")].some(e => { const s = getComputedStyle(e); return s.position === "fixed" && +s.zIndex >= 40 && e.offsetWidth > 500; }), undefined, { timeout: 5000 });
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

// ── meridian CR04 / CR14 / CR07 verbs ──────────────────────────────────────────
// Contract testids: gallery-hide-toggle (data-hidden 0|1), toc-slide-delete,
// reviewed-toggle (data-reviewed 0|1), review-cycle-toggle (aria-pressed).
// Gallery must be open (openGallery). Clicks the i-th card's hide toggle; returns the new data-hidden.
export async function galleryToggleHide(page, i = 0) {
  const before = await page.evaluate((i) => { const t = document.querySelectorAll("[data-testid=gallery-slide]")[i]?.querySelector("[data-testid=gallery-hide-toggle]"); if (!t) return null; const v = t.getAttribute("data-hidden"); t.click(); return v; }, i);
  if (before == null) throw new Error(`galleryToggleHide: no gallery-hide-toggle on card ${i}`);
  await page.waitForFunction(({ i, before }) => document.querySelectorAll("[data-testid=gallery-slide]")[i]?.querySelector("[data-testid=gallery-hide-toggle]")?.getAttribute("data-hidden") !== before, { i, before }, { timeout: 3000 });
  return page.evaluate((i) => document.querySelectorAll("[data-testid=gallery-slide]")[i].querySelector("[data-testid=gallery-hide-toggle]").getAttribute("data-hidden"), i);
}
// Clicks the delete icon on the i-th TOC slide row; waits for the row count to drop by one.
export async function tocDeleteSlide(page, i = 0) {
  const n = await page.evaluate((i) => { const rows = document.querySelectorAll("[data-testid=toc-slide-row]"); const d = rows[i]?.querySelector("[data-testid=toc-slide-delete]"); if (!d) return -1; d.click(); return rows.length; }, i);
  if (n < 0) throw new Error(`tocDeleteSlide: no toc-slide-delete on row ${i}`);
  await page.waitForFunction((n) => document.querySelectorAll("[data-testid=toc-slide-row]").length === n - 1, n, { timeout: 3000 });
  return n - 1;
}
// Editor only. Toggles the current slide's reviewed checkmark; returns the new data-reviewed.
export async function toggleReviewed(page) {
  const before = await page.evaluate(() => { const b = document.querySelector("[data-testid=reviewed-toggle]"); if (!b) return null; const v = b.getAttribute("data-reviewed"); b.click(); return v; });
  if (before == null) throw new Error("toggleReviewed: no reviewed-toggle (editor mode only)");
  await page.waitForFunction((before) => document.querySelector("[data-testid=reviewed-toggle]")?.getAttribute("data-reviewed") !== before, before, { timeout: 3000 });
  return page.evaluate(() => document.querySelector("[data-testid=reviewed-toggle]").getAttribute("data-reviewed"));
}
// Editor only. Sets the review cycle on/off (idempotent).
export async function setReviewCycle(page, on = true) {
  const ok = await page.evaluate((on) => { const b = document.querySelector("[data-testid=review-cycle-toggle]"); if (!b) return false; if ((b.getAttribute("aria-pressed") === "true") !== on) b.click(); return true; }, on);
  if (!ok) throw new Error("setReviewCycle: no review-cycle-toggle (editor mode only)");
  await page.waitForFunction((on) => document.querySelector("[data-testid=review-cycle-toggle]")?.getAttribute("aria-pressed") === String(on), on, { timeout: 3000 });
}
// Index of the active TOC slide row (aria-selected) among all rendered rows, or -1.
export async function tocActiveRow(page) { return page.evaluate(() => [...document.querySelectorAll("[data-testid=toc-slide-row]")].findIndex((r) => r.getAttribute("aria-selected") === "true")); }
// ── Branding pane + block chrome (sprint meridian C3) ─────────────────────────
// Published driver contract (data-testids): brand-toggle, branding-panel
// (data-docked="right" on desktop), branding-panel-close, branding-accent-height,
// block-hover-toolbar (data-chrome-inside="true" when drawn inside the block),
// block-ai-popup, block-link-popup, block-comment-popup; link badges carry
// data-link-badge + data-link-badge-placed="text-end"|"corner".
export async function openBrandingPane(page) {
  if (!await page.$("[data-testid=branding-panel]")) await page.click("[data-testid=brand-toggle]");
  await page.waitForSelector("[data-testid=branding-panel]", { timeout: 4000 });
  return page.evaluate(() => { const p = document.querySelector("[data-testid=branding-panel]"); const r = p.getBoundingClientRect(); return { docked: p.dataset.docked || null, left: r.left, width: r.width }; });
}
export async function closeBrandingPane(page) {
  const close = await page.$("[data-testid=branding-panel-close]");
  if (close) await close.click();
  await page.waitForFunction(() => !document.querySelector("[data-testid=branding-panel]"), undefined, { timeout: 4000 });
}
// Drive the accent-height slider through React's value setter (range inputs ignore fill()).
// Returns the number of accent bars drawn on the editor slide afterwards.
export async function setBrandingAccentHeight(page, px) {
  await openBrandingPane(page);
  await page.evaluate((px) => {
    const el = document.querySelector("[data-testid=branding-accent-height]");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(px));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, px);
  await page.waitForTimeout(120);
  return page.evaluate(() => document.querySelectorAll("[data-testid=slide-viewport] [data-branding-accent]").length);
}
// Hover the Nth block on the editor slide with the real mouse; returns the toolbar placement.
export async function hoverBlock(page, index = 0) {
  const pt = await page.evaluate((i) => { const b = document.querySelectorAll("[data-testid=slide-viewport] [data-block-type]")[i]; if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(40, r.height / 2) }; }, index);
  if (!pt) throw new Error(`hoverBlock: no block #${index} on the editor slide`);
  await page.mouse.move(1, 1);
  await page.mouse.move(pt.x, pt.y, { steps: 4 });
  await page.waitForSelector("[data-testid=block-hover-toolbar]", { timeout: 2000 });
  return page.evaluate(() => { const t = document.querySelector("[data-testid=block-hover-toolbar]"); const r = t.getBoundingClientRect(); return { inside: t.dataset.chromeInside === "true", top: r.top, right: r.right }; });
}
// CR13 view switch. where: "top" (top bar, test-id view-switch), "gallery"
// (gallery header, gallery-view-switch) or "fs" (fullscreen controls,
// fs-view-switch). Clicks the segment with the REAL mouse only after
// elementFromPoint at its centre hits that segment (not an overlay).
// Returns { hit, active } — active is viewSwitchActive() after the click.
export async function viewSwitch(page, where, mode) {
  const tid = { top: "view-switch", gallery: "gallery-view-switch", fs: "fs-view-switch" }[where];
  if (!tid) throw new Error(`viewSwitch: unknown place "${where}"`);
  const pt = await page.evaluate((sel) => { const b = document.querySelector(`[data-testid=${sel}]`); if (!b) return null; const r = b.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const top = document.elementFromPoint(x, y); return { x, y, hit: !!top && (top === b || b.contains(top)) }; }, `${tid}-${mode}`);
  if (!pt) throw new Error(`viewSwitch: no ${tid}-${mode}`);
  if (!pt.hit) throw new Error(`viewSwitch: ${tid}-${mode} is covered (elementFromPoint misses it)`);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(250);
  return { hit: pt.hit, active: await viewSwitchActive(page) };
}
// Active view per mounted switch: { top, gallery, fs } — the aria-label of the
// aria-pressed segment, or null when that switch is not mounted.
export async function viewSwitchActive(page) {
  return page.evaluate(() => { const a = (t) => { const g = document.querySelector(`[data-testid=${t}]`); if (!g) return null; const b = g.querySelector("button[aria-pressed=true]"); return b ? b.getAttribute("aria-label") : "none"; }; return { top: a("view-switch"), gallery: a("gallery-view-switch"), fs: a("fs-view-switch") }; });
}
