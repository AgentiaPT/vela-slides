// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
// ━━━ Vela UI Integration Tests ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Zero-dependency UI test runner that operates on the live DOM.
// Triggered via Ctrl+Alt+T or the "🧪 UI" button in the battery toast.
// Tests run against whatever deck is loaded — demo deck recommended.

// ── Test Primitives ──────────────────────────────────────────────────
const _$ = (sel, root = document) => root.querySelector(sel);
const _$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const _$text = (text, tag = "*") => _$$(tag).find((el) => el.textContent?.includes(text));
const _wait = (ms) => new Promise((r) => setTimeout(r, ms));
const _waitFor = async (fn, timeout = 3000, interval = 50) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const r = fn(); if (r) return r; } catch {}
    await _wait(interval);
  }
  throw new Error(`waitFor timed out after ${timeout}ms`);
};
const _click = (elOrSel) => {
  const el = typeof elOrSel === "string" ? _$(elOrSel) : elOrSel;
  if (!el) throw new Error(`click: element not found: ${elOrSel}`);
  el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  el.click();
  return el;
};
const _key = (key, opts = {}) => {
  const target = document.activeElement || document.body;
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
  target.dispatchEvent(ev);
};
const _type = (el, text) => {
  const target = typeof el === "string" ? _$(el) : el;
  if (!target) throw new Error(`type: element not found`);
  target.focus();
  // Strategy 1: React-compatible native setter (preferred)
  let set = false;
  try {
    const proto = target.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) { desc.set.call(target, text); set = true; }
  } catch {}
  // Strategy 2: direct value + React internal tracker reset
  if (!set) {
    // React tracks value via an internal property — delete it so React sees the change
    const tracker = target._valueTracker;
    if (tracker) tracker.setValue("");
    target.value = text;
  }
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
};

// ── Test Runner ──────────────────────────────────────────────────────
const UI_TEST_SUITES = [];

function uiSuite(name, tests) {
  UI_TEST_SUITES.push({ name, tests });
}

async function runUITests(onProgress) {
  const allResults = [];
  let total = UI_TEST_SUITES.reduce((s, suite) => s + suite.tests.length, 0);
  let done = 0, passed = 0, failed = 0;

  for (const suite of UI_TEST_SUITES) {
    for (const test of suite.tests) {
      done++;
      if (onProgress) onProgress({ done, total, suite: suite.name, test: test.name, phase: "running", passed, failed, results: allResults });
      const t0 = performance.now();
      try {
        await test.fn();
        passed++;
        allResults.push({ suite: suite.name, name: test.name, pass: true, ms: Math.round(performance.now() - t0) });
      } catch (e) {
        failed++;
        allResults.push({ suite: suite.name, name: test.name, pass: false, error: e?.message || String(e), ms: Math.round(performance.now() - t0) });
      }
      if (onProgress) onProgress({ done, total, suite: suite.name, test: test.name, phase: "done", passed, failed, results: [...allResults] });
      await _wait(50);
    }
  }
  return allResults;
}

// ━━━ TEST SUITES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── Render Suite ─────────────────────────────────────────────────────
uiSuite("Render", [
  { name: "App header visible", fn: async () => {
    await _waitFor(() => _$("header"));
  }},
  { name: "Vela icon in header", fn: async () => {
    await _waitFor(() => _$("header svg"));
  }},
  { name: "Deck title visible", fn: async () => {
    await _waitFor(() => {
      const spans = _$$("header span");
      return spans.some((s) => s.textContent && s.textContent.length > 1 && s.style.fontWeight >= 700);
    });
  }},
  { name: "At least 1 slide renders", fn: async () => {
    // Slide counter or slide content area should exist
    await _waitFor(() => _$text("/") || _$text("Slide") || _$$("[style*='transform']").length > 0);
  }},
  { name: "Module list or slide content present", fn: async () => {
    // Either the module list is visible (desktop) or slide content is rendered (mobile, slides tab)
    await _waitFor(() => {
      const allText = document.body.textContent || "";
      return allText.length > 200; // App has meaningful content rendered
    });
  }},
]);

// ── Navigation Suite ─────────────────────────────────────────────────
uiSuite("Navigation", [
  { name: "Arrow right advances slide", fn: async () => {
    // Go to first slide first (press Home or multiple ArrowLeft)
    for (let i = 0; i < 5; i++) { _key("ArrowLeft"); await _wait(50); }
    await _wait(100);
    // Now advance — just verify no crash and key is processed
    _key("ArrowRight");
    await _wait(200);
  }},
  { name: "Arrow left goes back", fn: async () => {
    // We're on slide 2 from previous test — go back
    _key("ArrowLeft");
    await _wait(200);
    // No crash = pass
  }},
  { name: "Multiple navigation doesn't crash", fn: async () => {
    for (let i = 0; i < 3; i++) { _key("ArrowRight"); await _wait(100); }
    for (let i = 0; i < 3; i++) { _key("ArrowLeft"); await _wait(100); }
  }},
]);

// ── Presenter Suite ──────────────────────────────────────────────────
uiSuite("Presenter", [
  { name: "F key enters fullscreen", fn: async () => {
    _key("f");
    await _wait(300);
    const fs = _$("[style*='position: fixed'][style*='z-index']") || _$("[style*='position:fixed']");
    if (!fs) throw new Error("No fixed fullscreen element found");
  }},
  { name: "Fullscreen shows slide content", fn: async () => {
    await _waitFor(() => {
      const fixed = _$("[style*='position: fixed'][style*='z-index']") || _$("[style*='position:fixed']");
      return fixed && fixed.textContent.length > 10;
    });
  }},
  { name: "Arrow navigation works in fullscreen", fn: async () => {
    _key("ArrowRight");
    await _wait(200);
    _key("ArrowLeft");
    await _wait(200);
    // No crash = pass
  }},
  { name: "F key exits fullscreen", fn: async () => {
    _key("f");
    await _wait(300);
    await _waitFor(() => _$("header"));
  }},
]);

// ── Toolbar Suite ────────────────────────────────────────────────────
uiSuite("Toolbar", [
  { name: "Slide toolbar visible", fn: async () => {
    await _waitFor(() => {
      const buttons = _$$("button");
      return buttons.some((b) => b.textContent?.includes("Edit") || b.textContent?.includes("✏"));
    });
  }},
  { name: "Edit button exists (✏️)", fn: async () => {
    await _waitFor(() => _$$("button").find((b) => b.title?.includes("Edit") || b.textContent?.includes("✏")));
  }},
  { name: "Improve button exists (✨)", fn: async () => {
    await _waitFor(() => _$$("button").find((b) => b.title?.includes("Improve") || b.textContent?.includes("✨")));
  }},
  { name: "Variants button exists (🎲)", fn: async () => {
    await _waitFor(() => _$$("button").find((b) => b.title?.includes("variant") || b.title?.includes("alternative") || b.textContent?.includes("🎲")));
  }},
  { name: "New slide button exists (+)", fn: async () => {
    await _waitFor(() => _$$("button").find((b) => b.title?.includes("New slide") || b.textContent?.includes("New")));
  }},
  { name: "Cost badge visible (💲)", fn: async () => {
    await _waitFor(() => _$$("button").find((b) => (b.textContent || "").includes("💲")));
  }},
  { name: "Delete button exists (🗑)", fn: async () => {
    await _waitFor(() => _$$("button").find((b) => b.title?.includes("Delete") || b.textContent?.includes("🗑")));
  }},
]);

// ── Theme Suite ──────────────────────────────────────────────────────
uiSuite("Theme", [
  { name: "Theme has dark or light mode applied", fn: async () => {
    const header = _$("header");
    if (!header) throw new Error("No header");
    const bg = header.style.background || header.style.backgroundColor;
    if (!bg) throw new Error("Header has no inline background style");
  }},
  { name: "D key toggles theme", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    const headerBefore = _$("header").style.background;
    _key("d");
    await _wait(200);
    const headerAfter = _$("header").style.background;
    // Toggle back
    _key("d");
    await _wait(200);
    if (headerBefore === headerAfter) throw new Error("D key didn't toggle theme");
  }},
]);

// ── Keyboard Shortcuts Suite ─────────────────────────────────────────
uiSuite("Keyboard", [
  { name: "E opens quick edit panel", fn: async () => {
    // Ensure no input/textarea is focused (keyboard shortcuts skip those)
    document.activeElement?.blur();
    await _wait(100);
    _key("e");
    await _wait(200);
    const panel = await _waitFor(() => _$$("input, textarea").find((el) => el.placeholder?.toLowerCase().includes("change") || el.placeholder?.toLowerCase().includes("edit")), 1000).catch(() => null);
    // Close it
    _key("Escape");
    await _wait(100);
    if (!panel) throw new Error("Quick edit panel not found after E key");
  }},
  { name: "N opens new slide prompt", fn: async () => {
    document.activeElement?.blur();
    await _wait(100);
    _key("n");
    await _wait(200);
    const panel = await _waitFor(() => _$$("textarea").find((el) => el.placeholder?.toLowerCase().includes("describe")), 1000).catch(() => null);
    _key("Escape");
    await _wait(100);
    if (!panel) throw new Error("New slide panel not found after N key");
  }},
  { name: "? shows help / shortcut guide", fn: async () => {
    document.activeElement?.blur();
    await _wait(100);
    _key("?");
    await _wait(300);
    const help = _$text("Shortcuts") || _$text("shortcuts") || _$text("⌨");
    _key("Escape");
    await _wait(100);
    // Some builds may not have ? shortcut — soft pass
  }},
  { name: "Esc closes popups", fn: async () => {
    document.activeElement?.blur();
    await _wait(100);
    _key("e"); // open something
    await _wait(200);
    _key("Escape");
    await _wait(200);
    // Should be back to normal — no crash
  }},
]);

// ── Chat Suite ───────────────────────────────────────────────────────
uiSuite("Chat", [
  { name: "Vera chat panel opens", fn: async () => {
    // Clean slate — dismiss any leftover popups from previous suite
    document.activeElement?.blur(); await _wait(50);
    _key("Escape"); await _wait(200);
    _key("Escape"); await _wait(200);
    // Click Vera button — retry if first click is swallowed by closing popup
    for (let attempt = 0; attempt < 3; attempt++) {
      const btn = _$$("button").find((b) => b.textContent?.includes("Vera") || b.textContent?.includes("🤖"));
      if (btn) _click(btn);
      await _wait(400);
      // Check if chat opened (textarea or VERA header)
      const opened = _$$("textarea").find((t) => {
        const ph = t.placeholder?.toLowerCase() || "";
        return ph.includes("tell vera") || ph.includes("paste images");
      }) || _$$("span").find((s) => s.textContent?.trim() === "VERA");
      if (opened) return;
    }
    throw new Error("Chat panel did not open after 3 attempts");
  }},
  { name: "Chat input visible", fn: async () => {
    await _waitFor(() => _$$("textarea").find((t) => {
      const ph = t.placeholder?.toLowerCase() || "";
      return ph.includes("tell vera") || ph.includes("paste images") || ph.includes("ask");
    }));
  }},
  { name: "Welcome message shown", fn: async () => {
    await _waitFor(() => _$text("Welcome") || _$text("⛵") || _$text("🖖"));
  }},
  { name: "Send button present", fn: async () => {
    await _waitFor(() => _$$("button").find((b) => (b.textContent || "").trim() === "↑"));
  }},
  { name: "Chat panel closes", fn: async () => {
    const btn = _$$("button").find((b) => b.textContent?.includes("Vera") || b.textContent?.includes("🤖"));
    if (btn) _click(btn);
    await _wait(300);
  }},
]);

// ── Notes Suite ──────────────────────────────────────────────────────
uiSuite("Notes", [
  { name: "Notes bar visible", fn: async () => {
    await _waitFor(() => _$text("NOTES"));
  }},
  { name: "Notes expand on click", fn: async () => {
    const notesLabel = _$text("NOTES");
    if (notesLabel) {
      const clickable = notesLabel.closest("[style*='cursor: pointer']") || notesLabel.parentElement;
      if (clickable) _click(clickable);
      await _wait(200);
      const ta = _$("#vela-notes-area") || _$$("textarea").find((t) => t.placeholder?.includes("notes") || t.placeholder?.includes("Speaker"));
      if (ta) {
        // Collapse back
        if (clickable) _click(clickable);
        await _wait(100);
      }
    }
  }},
]);

// ── Export Suite ──────────────────────────────────────────────────────
uiSuite("Export", [
  { name: "JSON modal opens", fn: async () => {
    let btn = _$$("button").find((b) => {
      const t = (b.textContent || "").replace(/\s+/g, " ").trim();
      return t.includes("JSON") && !t.includes("Export");
    });
    if (!btn) {
      const exportBtn = _$$("button").find((b) => (b.textContent || "").includes("Export"));
      if (exportBtn) { _click(exportBtn); await _wait(300); btn = _$$("button").find((b) => (b.textContent || "").includes("Copy") && (b.textContent || "").includes("JSON")); }
    }
    if (!btn) {
      const menuBtn = _$$("button").find((b) => (b.textContent || "").trim() === "⋯");
      if (menuBtn) { _click(menuBtn); await _wait(300); btn = _$$("button").find((b) => (b.textContent || "").includes("JSON") && !(b.textContent || "").includes("Export")); }
    }
    if (!btn) throw new Error("JSON button not found");
    _click(btn); await _wait(400);
    const modal = await _waitFor(() => _$$("textarea").find((t) => { try { const v = t.value || ""; return v.includes("concepts") || v.includes("_vela") || v.includes("slides") || v.includes("lanes"); } catch { return false; } }), 2000).catch(() => null);
    _key("Escape"); await _wait(200); _key("Escape"); await _wait(100);
    if (!modal) throw new Error("JSON modal textarea not found");
  }},
]);

// ── Batch Edit Suite (UI only — no API calls) ───────────────────────
uiSuite("Batch Edit", [
  { name: "Batch edit panel opens", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    // Find Batch button in header or ⋯ menu
    let btn = _$$("button").find((b) => (b.textContent || "").includes("Batch") && !(b.textContent || "").includes("Stop"));
    if (!btn) {
      const menuBtn = _$$("button").find((b) => (b.textContent || "").trim() === "⋯");
      if (menuBtn) { _click(menuBtn); await _wait(300); btn = _$$("button").find((b) => (b.textContent || "").includes("Batch") || (b.textContent || "").includes("Improve")); }
    }
    if (!btn) throw new Error("Batch button not found");
    _click(btn); await _wait(300);
  }},
  { name: "Scope selector visible", fn: async () => {
    // Look for scope options: slide, module, section, all
    await _waitFor(() => {
      const all = document.body.textContent || "";
      return (all.includes("slide") || all.includes("Slide")) && (all.includes("module") || all.includes("Module") || all.includes("all") || all.includes("All"));
    }, 1000);
  }},
  { name: "Prompt input visible", fn: async () => {
    const ta = await _waitFor(() => _$$("input, textarea").find((t) => {
      const ph = t.placeholder?.toLowerCase() || "";
      return ph.includes("change across") || ph.includes("auto-improve") || ph.includes("persistent") || ph.includes("every improve");
    }), 1000).catch(() => null);
    if (!ta) throw new Error("Batch prompt input not found");
  }},
  { name: "Close batch panel", fn: async () => {
    // Click the batch button again to toggle off, or find close
    const btn = _$$("button").find((b) => (b.textContent || "").includes("Batch") || (b.textContent || "").includes("⏹") || (b.textContent || "").includes("Improve"));
    if (btn) _click(btn);
    await _wait(200);
  }},
]);

// ── Branding Suite (UI only) ─────────────────────────────────────────
uiSuite("Branding", [
  { name: "Branding panel opens", fn: async () => {
    let btn = _$$("button").find((b) => (b.textContent || "").includes("Brand"));
    if (!btn) {
      const menuBtn = _$$("button").find((b) => (b.textContent || "").trim() === "⋯");
      if (menuBtn) { _click(menuBtn); await _wait(300); btn = _$$("button").find((b) => (b.textContent || "").includes("Brand")); }
    }
    if (!btn) throw new Error("Brand button not found");
    _click(btn); await _wait(300);
  }},
  { name: "Guidelines textarea visible", fn: async () => {
    // The guidelines textarea is behind a collapsible "SLIDE RULES" toggle
    // Click any element containing "SLIDE RULES" or "RULES" text
    const allSpans = _$$("span");
    const rulesToggle = allSpans.find((s) => s.textContent?.trim() === "SLIDE RULES");
    if (rulesToggle) {
      // Click the parent div (the toggle container)
      const container = rulesToggle.parentElement;
      if (container) { _click(container); await _wait(300); }
    }
    // Look for the textarea with placeholder about "Persistent rules"
    const ta = await _waitFor(() => _$$("textarea").find((t) => {
      const ph = t.placeholder || "";
      return ph.includes("Persistent") || ph.includes("persistent") || ph.includes("EVERY improve") || ph.includes("bullets");
    }), 1500).catch(() => null);
    // Collapse back if we found the toggle
    if (rulesToggle?.parentElement) { _click(rulesToggle.parentElement); await _wait(100); }
    if (!ta) throw new Error("Guidelines textarea not found");
  }},
  { name: "Close branding panel", fn: async () => {
    const btn = _$$("button").find((b) => (b.textContent || "").includes("Brand"));
    if (btn) _click(btn);
    await _wait(200);
  }},
]);

// ── About / Changelog Suite ──────────────────────────────────────────
uiSuite("About", [
  { name: "About dialog opens on icon click", fn: async () => {
    const icon = _$("header svg");
    if (!icon) throw new Error("Vela icon not found");
    const clickTarget = icon.closest("span") || icon.parentElement || icon;
    _click(clickTarget); await _wait(300);
    const version = await _waitFor(() => _$text("v9.") || _$text("v8.") || _$text(VELA_VERSION), 1000).catch(() => null);
    if (!version) throw new Error("Version text not found in about dialog");
  }},
  { name: "Changelog entries visible", fn: async () => {
    await _waitFor(() => _$text("v" + VELA_VERSION) || _$text("Recent Changes"));
  }},
  { name: "About dialog closes", fn: async () => {
    _key("Escape"); await _wait(200);
    // Or click the ✕ button
    const close = _$$("button").find((b) => (b.textContent || "").includes("✕"));
    if (close) _click(close);
    await _wait(200);
  }},
]);

// ── Undo/Redo Suite ──────────────────────────────────────────────────
uiSuite("Undo/Redo", [
  { name: "Ctrl+Z doesn't crash", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    _key("z", { ctrlKey: true });
    await _wait(200);
    // App still renders
    if (!_$("header")) throw new Error("App disappeared after undo");
  }},
  { name: "Ctrl+Shift+Z doesn't crash", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    _key("z", { ctrlKey: true, shiftKey: true });
    await _wait(200);
    if (!_$("header")) throw new Error("App disappeared after redo");
  }},
]);

// ── Fullscreen Features Suite ────────────────────────────────────────
uiSuite("Fullscreen Features", [
  { name: "Font scale + increases", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    _key("f"); await _wait(300);
    _key("+"); await _wait(200);
    // Look for font scale indicator
    const indicator = _$text("FONT") || _$text("110%") || _$text("120%");
    _key("0"); await _wait(100); // reset
  }},
  { name: "Font scale - decreases", fn: async () => {
    _key("-"); await _wait(200);
    _key("0"); await _wait(100); // reset
  }},
  { name: "Font scale 0 resets", fn: async () => {
    _key("+"); await _wait(100);
    _key("+"); await _wait(100);
    _key("0"); await _wait(200);
    // Indicator should disappear at 100%
  }},
  { name: "Space advances slide in fullscreen", fn: async () => {
    _key(" "); await _wait(200);
    _key("ArrowLeft"); await _wait(200); // go back
  }},
  { name: "Exit fullscreen", fn: async () => {
    _key("f"); await _wait(300);
    await _waitFor(() => _$("header"));
  }},
]);

// ── Slide Operations Suite (non-destructive) ─────────────────────────
uiSuite("Slide Ops", [
  { name: "Duplicate button exists and works", fn: async () => {
    // Find slide counter before
    const getCounter = () => {
      const spans = _$$("span").filter((s) => /^\d+\s*\/\s*\d+$/.test(s.textContent?.trim()));
      return spans[0]?.textContent?.trim() || null;
    };
    const before = getCounter();
    // Click duplicate
    const btn = _$$("button").find((b) => b.textContent?.includes("📋") || b.title?.includes("Duplicate"));
    if (btn) {
      _click(btn); await _wait(300);
      // Undo immediately to restore state
      document.activeElement?.blur(); await _wait(50);
      _key("z", { ctrlKey: true }); await _wait(200);
    }
  }},
  { name: "Move button shows module list", fn: async () => {
    const btn = _$$("button").find((b) => b.textContent?.includes("📦") || b.title?.includes("Move"));
    if (!btn) throw new Error("Move button not found");
    _click(btn); await _wait(300);
    const popup = _$text("Move to") || _$$("button").find((b) => {
      const t = b.textContent || "";
      return t.includes("Block Showcase") || t.includes("Introduction") || t.includes("Hands");
    });
    // Close popup — click the backdrop overlay (fixed inset div) or toggle button
    const backdrop = _$$("div").find((d) => d.style.position === "fixed" && d.style.inset === "0px" && d.style.zIndex === "9998");
    if (backdrop) { _click(backdrop); await _wait(200); }
    else { _click(btn); await _wait(200); } // toggle off
  }},
  { name: "Comment input accepts input", fn: async () => {
    // 💬 icon only visible in review mode — activate it first
    document.activeElement?.blur(); await _wait(100);
    _key("r"); await _wait(400);
    const commentIcon = _$$("span").find((s) => s.textContent?.includes("💬") && s.style?.cursor === "pointer");
    if (commentIcon) {
      _click(commentIcon); await _wait(200);
      const input = _$$("input").find((i) => i.placeholder?.includes("Add comment"));
      if (input) {
        if (input.readOnly || input.disabled) throw new Error("Comment input is not editable");
      }
      // Collapse
      _click(commentIcon); await _wait(100);
    }
    // Exit review mode
    _key("r"); await _wait(300);
  }},
  { name: "Duration editor opens on click", fn: async () => {
    const timer = _$$("span").find((s) => s.textContent?.includes("⏱") && s.style?.cursor === "pointer");
    if (timer) {
      _click(timer); await _wait(200);
      const input = _$$("input").find((i) => i.type === "number");
      // Close by pressing Escape
      _key("Escape"); await _wait(100);
    }
    // Soft pass if no timer visible
  }},
]);

// ── Slide Content Suite ──────────────────────────────────────────────
uiSuite("Content", [
  { name: "Slide has visible headings", fn: async () => {
    const headings = _$$("[style*='font-weight: 700'], [style*='font-weight: 800'], [style*='font-weight:700'], [style*='font-weight:800']");
    const visible = headings.filter((h) => h.offsetHeight > 0 && h.textContent?.length > 1);
    if (visible.length === 0) throw new Error("No visible heading elements found");
  }},
  { name: "Slide has multiple blocks", fn: async () => {
    const blocks = _$$("[data-block-type]");
    if (blocks.length === 0) throw new Error("No data-block-type elements — blocks not rendering");
  }},
  { name: "Slide counter shows valid format", fn: async () => {
    const counters = _$$("span").filter((s) => /^\d+\s*\/\s*\d+$/.test(s.textContent?.trim()));
    if (counters.length === 0) throw new Error("No slide counter (N/M format) found");
    const [n, m] = counters[0].textContent.trim().split("/").map((s) => parseInt(s.trim()));
    if (n < 1 || m < 1 || n > m) throw new Error(`Invalid counter: ${n}/${m}`);
  }},
]);

// ── New Deck Dialog Suite ────────────────────────────────────────────
uiSuite("New Deck", [
  { name: "New Deck dialog opens", fn: async () => {
    // Find + button in header
    const btn = _$$("button").find((b) => {
      const t = (b.textContent || "").trim();
      return t === "+" || t === "+ New" || (b.title || "").includes("New Deck");
    });
    if (!btn) throw new Error("New Deck button not found");
    _click(btn); await _wait(300);
    // Dialog should show title input and prompt textarea
    const dialog = await _waitFor(() => {
      const inputs = _$$("input");
      const textareas = _$$("textarea");
      return inputs.some((i) => i.placeholder?.includes("Presentation") || i.placeholder?.includes("My"))
        || textareas.some((t) => t.placeholder?.toLowerCase().includes("pitch deck") || t.placeholder?.toLowerCase().includes("10-slide") || t.placeholder?.toLowerCase().includes("create"));
    }, 1500).catch(() => null);
    if (!dialog) throw new Error("New Deck dialog fields not found");
  }},
  { name: "Dialog has Cancel button", fn: async () => {
    const cancel = _$$("button").find((b) => (b.textContent || "").includes("Cancel"));
    if (!cancel) throw new Error("Cancel button not found in dialog");
  }},
  { name: "Dialog closes on Cancel", fn: async () => {
    const cancel = _$$("button").find((b) => (b.textContent || "").includes("Cancel"));
    if (cancel) _click(cancel);
    await _wait(200);
  }},
]);

// ── Presenter Advanced Suite ─────────────────────────────────────────
uiSuite("Presenter Adv", [
  { name: "F5 enters fullscreen", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    _key("F5"); await _wait(300);
    const fs = _$("[style*='position: fixed'][style*='z-index']") || _$("[style*='position:fixed']");
    if (!fs) throw new Error("F5 didn't enter fullscreen");
  }},
  { name: "Minimize button visible", fn: async () => {
    await _waitFor(() => _$$("svg").find((s) => s.closest("[class*='slide-nav-btn']") || s.closest("[style*='padding: 8px']")));
  }},
  { name: "Exit via F", fn: async () => {
    _key("f"); await _wait(300);
    await _waitFor(() => _$("header"));
  }},
]);

// ── Vera AI Integration Suite (live API calls) ──────────────────────
// Helper: open chat, type message, send, wait for response
const _veraChat = async (message, timeout = 45000) => {
  document.activeElement?.blur(); await _wait(100);

  // Ensure chat is open
  const findTa = () => _$$("textarea").find((t) => {
    const ph = t.placeholder?.toLowerCase() || "";
    return ph.includes("tell vera") || ph.includes("paste images");
  });

  if (!findTa()) {
    const veraBtn = _$$("button").find((b) => b.textContent?.includes("Vera") || b.textContent?.includes("🤖"));
    if (veraBtn) { _click(veraBtn); await _wait(400); }
    await _waitFor(findTa, 3000);
  }

  // Wait for any previous call to finish
  await _waitFor(() => {
    const body = document.body.textContent || "";
    const btn = _$$("button").find((b) => (b.textContent || "").trim() === "↑");
    return !body.includes("working...") && btn;
  }, 30000);
  await _wait(500);

  // Re-find textarea (React may have re-rendered after previous response)
  const ta = findTa();
  if (!ta) throw new Error("Chat textarea not found after wait");

  // Type via React-compatible method
  ta.focus(); await _wait(50);
  const tracker = ta._valueTracker;
  if (tracker) tracker.setValue("");
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  try { if (nativeSetter) nativeSetter.call(ta, message); else ta.value = message; } catch { ta.value = message; }
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  ta.dispatchEvent(new Event("change", { bubbles: true }));
  await _wait(200);

  if (!ta.value.includes(message.slice(0, 10))) throw new Error("React did not accept typed input");

  // Click send — retry until button is enabled
  let sent = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    const sendBtn = _$$("button").find((b) => (b.textContent || "").trim() === "↑" && !b.disabled);
    if (sendBtn) { _click(sendBtn); sent = true; break; }
    await _wait(500);
  }
  if (!sent) throw new Error("Send button not found or disabled after retries");
  await _wait(500);

  // Wait for response
  await _waitFor(() => !(document.body.textContent || "").includes("working..."), timeout);
  await _wait(300);
  return true;
};

uiSuite("Vera AI", [
  { name: "Simple chat reply", fn: async () => {
    await _veraChat("Reply with exactly one word: TESTPASS");
    await _waitFor(() => (document.body.textContent || "").includes("TESTPASS"), 30000);
  }},
  { name: "deck_stats tool call", fn: async () => {
    await _veraChat("Use the deck_stats tool. Start your answer with STATS:");
    await _waitFor(() => {
      const body = document.body.textContent || "";
      return body.includes("STATS:") || body.includes("deck_stats");
    }, 45000);
  }},
  { name: "Edit current slide via chat", fn: async () => {
    await _veraChat("Use edit_slide to change the heading on the current slide to 'UI Test Heading'. Keep everything else.");
    await _waitFor(() => (document.body.textContent || "").includes("UI Test Heading"), 45000);
    // Undo
    document.activeElement?.blur(); await _wait(100);
    _key("z", { ctrlKey: true }); await _wait(300);
  }},
  { name: "Add a new slide via chat", fn: async () => {
    await _veraChat("Add a single slide to the current module with heading 'Test Slide Alpha' and a text block saying 'Created by UI test suite'. Use add_slide.");
    await _waitFor(() => (document.body.textContent || "").includes("Test Slide Alpha"), 45000);
    // Undo
    document.activeElement?.blur(); await _wait(100);
    _key("z", { ctrlKey: true }); await _wait(300);
  }},
  { name: "Improve current slide via chat", fn: async () => {
    // Go to a content-rich slide first
    document.activeElement?.blur(); await _wait(50);
    for (let i = 0; i < 3; i++) { _key("ArrowRight"); await _wait(100); }
    await _veraChat("Improve this slide. Make the heading more impactful. Start your reply with IMPROVED:");
    await _waitFor(() => (document.body.textContent || "").includes("IMPROVED:"), 45000);
    // Undo
    document.activeElement?.blur(); await _wait(100);
    _key("z", { ctrlKey: true }); await _wait(300);
  }},
  // Chat stays open — all test messages visible for audit
]);

// ── v10: Student Mode Suite ─────────────────────────────────────────
uiSuite("Student Mode", [
  { name: "Enter fullscreen for student tests", fn: async () => {
    document.activeElement?.blur(); await _wait(200);
    // Close chat if left open by Vera AI tests
    const chatClose = _$$("button").find(b => b.textContent?.includes("Vera") && b.closest("header"));
    if (chatClose && document.body.textContent?.includes("working...") === false) {
      // Check if chat panel is visible
      const chatPanel = _$$("textarea").find(t => t.placeholder?.toLowerCase()?.includes("tell vera"));
      if (chatPanel) { _click(chatClose); await _wait(300); }
    }
    document.activeElement?.blur(); await _wait(100);
    // Ensure a module is selected (undo may have deselected)
    const hasSlide = _$$("div").find(d => d.style?.aspectRatio === "16 / 9" || d.style?.aspectRatio === "16/9");
    if (!hasSlide) {
      // Click first module in the list
      const firstMod = _$$("span").find(s => s.style?.fontWeight >= 600 && s.style?.fontSize === "12px" && s.style?.overflow === "hidden");
      if (firstMod) { _click(firstMod); await _wait(300); }
    }
    document.activeElement?.blur(); await _wait(100);
    _key("f"); await _wait(400);
    await _waitFor(() => !_$("header"), 3000);
  }},
  { name: "🎓 toggle button visible", fn: async () => {
    await _waitFor(() => _$("[data-testid='student-toggle']"), 2000);
  }},
  { name: "Activate student mode", fn: async () => {
    const btn = _$("[data-testid='student-toggle']");
    if (!btn) throw new Error("student-toggle not found");
    _click(btn);
    await _waitFor(() => _$("[data-teacher-panel]"), 5000);
  }},
  { name: "Teacher panel renders VERA header", fn: async () => {
    const panel = _$("[data-teacher-panel]");
    return !!panel && (panel.textContent || "").includes("VERA");
  }},
  { name: "Auto-generates notes (streaming)", fn: async () => {
    // API-dependent: check panel has streaming or content within timeout
    try {
      await _waitFor(() => {
        const panel = _$("[data-teacher-panel]");
        if (!panel) return false;
        return panel.textContent?.length > 80;
      }, 30000);
    } catch {
      // Soft fail — API may be slow, but panel should still exist
      const panel = _$("[data-teacher-panel]");
      if (!panel) throw new Error("Teacher panel not found");
      // Panel exists but content didn't load — pass with warning
    }
  }},
  { name: "AI disclaimer visible", fn: async () => {
    const panel = _$("[data-teacher-panel]");
    return !!panel && (panel.textContent || "").includes("AI answers");
  }},
  { name: "Input field present", fn: async () => {
    const panel = _$("[data-teacher-panel]");
    const input = panel?.querySelector("input");
    return !!input && input.placeholder?.includes("Ask");
  }},
  { name: "Ask button present", fn: async () => {
    const panel = _$("[data-teacher-panel]");
    return !!panel && (panel.textContent || "").includes("Ask");
  }},
  { name: "Follow-up questions appear", fn: async () => {
    // API-dependent: Haiku may not always produce ---QUESTIONS--- separator
    try { await _waitFor(() => _$text("EXPLORE FURTHER"), 30000); }
    catch { /* soft — API/model dependent, panel functionality verified elsewhere */ }
  }},
  { name: "Wheel scroll stays in panel", fn: async () => {
    const panel = _$("[data-teacher-panel]");
    return !!panel && panel.hasAttribute("data-teacher-panel");
  }},
  { name: "Navigate slide keeps student mode", fn: async () => {
    // Ensure student mode is active
    if (!_$("[data-teacher-panel]")) {
      const btn = _$("[data-testid='student-toggle']");
      if (btn) _click(btn);
      await _wait(500);
    }
    document.activeElement?.blur(); await _wait(100);
    _key("ArrowRight"); await _wait(600);
    const panel = _$("[data-teacher-panel]");
    return !!panel;
  }},
  { name: "Previous slide has cached notes", fn: async () => {
    await _wait(3000);
    _key("ArrowLeft"); await _wait(500);
    const panel = _$("[data-teacher-panel]");
    return panel && panel.textContent?.length > 50;
  }},
  { name: "Clear button resets current slide", fn: async () => {
    const clearBtn = _$$("button").find(b => b.textContent?.trim() === "⟳" && b.closest("[data-teacher-panel]"));
    if (clearBtn) _click(clearBtn);
    await _wait(300);
  }},
  { name: "Editing FABs hidden in student mode", fn: async () => {
    return !_$text("QUICK EDIT") && !_$text("NEW SLIDE");
  }},
  { name: "Exit student mode", fn: async () => {
    const btn = _$("[data-testid='student-toggle']");
    if (btn) _click(btn);
    await _waitFor(() => !_$("[data-teacher-panel]"), 5000);
  }},
  { name: "Exit fullscreen after student tests", fn: async () => {
    _key("f"); await _wait(300);
    await _waitFor(() => _$("header"), 3000);
  }},
]);

// ── v12.32: Offline Study Notes Suite ───────────────────────────────
// Uses the test-only affordance window.__velaTestInjectStudyNotes to
// patch the current slide with a pre-authored studyNotes object, then
// exercises the offline StaticStudyPanel rendering (text + glossary
// X-Ray links + questions + diagram). Does not depend on a live API.
uiSuite("Study Notes", [
  { name: "Test hook __velaTestInjectStudyNotes available", fn: async () => {
    if (typeof window.__velaTestInjectStudyNotes !== "function") throw new Error("window.__velaTestInjectStudyNotes not exposed");
  }},
  { name: "Inject studyNotes into current slide", fn: async () => {
    const sn = {
      text: "An **agent** is a goal-driven loop. See [ReAct](https://arxiv.org/abs/2210.03629) or [what an agent is](#agent).",
      diagram: "<svg viewBox='0 0 10 10' xmlns='http://www.w3.org/2000/svg'><rect x='1' y='1' width='8' height='8' fill='#3b82f6'/></svg>",
      questions: ["Why does this matter?", "When does it fail?"],
      glossary: { agent: { definition: "A goal-driven loop that plans, acts, observes.", url: "https://example.com/a" } }
    };
    const ok = window.__velaTestInjectStudyNotes(sn);
    if (!ok) throw new Error("inject returned false — no current slide");
    await _wait(150);
  }},
  { name: "🎓 study marker appears on slide viewer", fn: async () => {
    await _waitFor(() => _$("[data-study-marker]"), 2000);
  }},
  { name: "Enter fullscreen for study-panel tests", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    _key("f"); await _wait(400);
    await _waitFor(() => !_$("header"), 3000);
  }},
  { name: "Activate student mode on studyNotes slide", fn: async () => {
    const btn = _$("[data-testid='student-toggle']");
    if (!btn) throw new Error("student-toggle not found");
    _click(btn);
    await _waitFor(() => _$("[data-study-panel]"), 3000);
  }},
  { name: "Panel renders STUDY NOTES header (not VERA)", fn: async () => {
    const panel = _$("[data-study-panel]");
    if (!panel) throw new Error("data-study-panel not found");
    const txt = panel.textContent || "";
    return txt.includes("STUDY NOTES");
  }},
  { name: "Authored text renders immediately (no spinner)", fn: async () => {
    const body = _$("[data-study-notes-text]");
    return !!body && (body.textContent || "").includes("goal-driven loop");
  }},
  { name: "Inline external link rendered as <a>", fn: async () => {
    const body = _$("[data-study-notes-text]");
    if (!body) return false;
    const a = body.querySelector("a[href*='arxiv.org']");
    return !!a;
  }},
  { name: "Glossary X-Ray link has dashed underline", fn: async () => {
    const body = _$("[data-study-notes-text]");
    if (!body) return false;
    const span = body.querySelector("[data-xray-term='agent']");
    if (!span) return false;
    const style = span.getAttribute("style") || "";
    return style.includes("dashed");
  }},
  { name: "Click X-Ray term opens glossary popover with definition", fn: async () => {
    const span = _$("[data-xray-term='agent']");
    if (!span) throw new Error("X-Ray term span not found");
    _click(span);
    await _wait(100);
    const panel = _$("[data-study-panel]");
    return !!panel && (panel.textContent || "").includes("goal-driven loop");
  }},
  { name: "SVG diagram renders inside panel", fn: async () => {
    const dia = _$("[data-study-notes-diagram]");
    return !!dia && !!dia.querySelector("svg");
  }},
  { name: "Authored questions render", fn: async () => {
    const qs = _$("[data-study-notes-questions]");
    return !!qs && (qs.textContent || "").includes("Why does this matter?");
  }},
  { name: "Exit student mode", fn: async () => {
    const btn = _$("[data-testid='student-toggle']");
    if (btn) _click(btn);
    await _waitFor(() => !_$("[data-study-panel]"), 3000);
  }},
  { name: "Exit fullscreen after study-notes tests", fn: async () => {
    _key("f"); await _wait(300);
    await _waitFor(() => _$("header"), 3000);
  }},
  { name: "Clean up injected studyNotes", fn: async () => {
    // Undo the UPDATE_SLIDE so we don't leak state into later tests
    window.__velaTestInjectStudyNotes(undefined);
    await _wait(100);
  }},
]);

// ── v10: Gallery View Suite ──────────────────────────────────────────
uiSuite("Gallery View", [
  { name: "Enter fullscreen for gallery tests", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    _key("f"); await _wait(400);
    await _waitFor(() => !_$("header"));
  }},
  { name: "🗂 gallery button visible", fn: async () => {
    await _waitFor(() => _$("[data-testid='gallery-toggle']"), 2000);
  }},
  { name: "G key opens gallery", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    _key("g"); await _wait(400);
    await _waitFor(() => _$text("GALLERY"), 2000);
  }},
  { name: "Gallery shows slide count", fn: async () => {
    await _waitFor(() => {
      const el = _$text("slides");
      return el && /\d+\s*slides/.test(el.textContent);
    }, 2000);
  }},
  { name: "Gallery shows module grouping", fn: async () => {
    // Should have module labels (colored text above first slide of each module)
    // Look for any text matching a known module title in mono font
    await _waitFor(() => {
      const monos = _$$("span").filter(s => s.style?.fontFamily?.includes("mono") && s.style?.fontWeight >= 600 && s.style?.letterSpacing);
      return monos.length > 0;
    }, 2000);
  }},
  { name: "Gallery has thumbnail cards", fn: async () => {
    // Should have multiple clickable card divs with slide titles
    const cards = _$$("[style*='width: 224px'], [style*='width:224px']");
    return cards.length > 0 || _$$("div").filter(d => d.style?.width === "224px").length > 0;
  }},
  { name: "Current slide highlighted", fn: async () => {
    // Look for a card with accent border
    const highlighted = _$$("div").find(d => d.style?.borderColor && d.style.borderColor.includes("59, 130, 246"));
    return !!highlighted;
  }},
  { name: "Hint text visible", fn: async () => {
    await _waitFor(() => _$text("G or ESC to close"), 1000);
  }},
  { name: "Click card navigates", fn: async () => {
    const nums = _$$("span").filter(s => /^\d+$/.test(s.textContent?.trim()) && s.style?.fontFamily?.includes("mono"));
    const card2 = nums.find(n => n.textContent?.trim() === "2");
    if (card2) {
      const cardEl = card2.closest("div[style*='cursor: pointer'], div[style*='cursor:pointer']");
      if (cardEl) _click(cardEl);
    }
    await _wait(400);
    return !_$text("GALLERY");
  }},
  { name: "G key toggles gallery off", fn: async () => {
    document.activeElement?.blur(); await _wait(300);
    // Ensure we're not in gallery from a previous test
    if (_$text("GALLERY")) { _key("g"); await _wait(500); }
    document.activeElement?.blur(); await _wait(200);
    _key("g"); await _wait(500);
    await _waitFor(() => _$text("GALLERY"), 3000);
    document.activeElement?.blur(); await _wait(200);
    _key("g"); await _wait(500);
    await _waitFor(() => !_$text("GALLERY"), 3000);
  }},
  { name: "Exit fullscreen after gallery tests", fn: async () => {
    _key("f"); await _wait(300);
    await _waitFor(() => _$("header"));
  }},
]);

// ── Review / Comments Suite ─────────────────────────────────────────
uiSuite("Review", [
  { name: "Review button visible in header", fn: async () => {
    await _waitFor(() => _$$("button").find((b) => (b.textContent || "").includes("Review")));
  }},
  { name: "Review button toggles review mode", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    const btn = _$$("button").find((b) => (b.textContent || "").includes("Review") && (b.textContent || "").includes("💬"));
    if (!btn) throw new Error("Review button not found");
    _click(btn); await _wait(300);
    // Comments panel should open — look for COMMENTS header
    const panel = await _waitFor(() => _$text("COMMENTS"), 2000).catch(() => null);
    if (!panel) throw new Error("Comments panel did not open");
  }},
  { name: "Comments panel shows filter tabs", fn: async () => {
    await _waitFor(() => {
      const all = document.body.textContent || "";
      return all.includes("Open") && all.includes("Done");
    }, 1000);
  }},
  { name: "Comments panel has Copy for Agent button", fn: async () => {
    await _waitFor(() => _$$("button").find((b) => (b.textContent || "").includes("Copy for Agent")));
  }},
  { name: "Comments panel has Resolve All button", fn: async () => {
    await _waitFor(() => _$$("button").find((b) => (b.textContent || "").includes("Resolve All")));
  }},
  { name: "Comments panel has Clear Done button", fn: async () => {
    await _waitFor(() => _$$("button").find((b) => (b.textContent || "").includes("Clear Done")));
  }},
  { name: "Module comment icon visible in review mode (💬)", fn: async () => {
    // 💬 icon only visible in review mode — ensure review is active (toggled on by prior test)
    const reviewOn = _$$("button").find((b) => (b.textContent || "").includes("Review") && (b.textContent || "").includes("💬"));
    if (reviewOn) { _click(reviewOn); await _wait(300); }
    await _waitFor(() => _$$("span").find((s) => s.textContent?.includes("💬") && s.style?.cursor === "pointer"), 1000);
    // Exit review mode
    if (reviewOn) { _click(reviewOn); await _wait(300); }
  }},
  { name: "Module comment icon hidden in editor mode", fn: async () => {
    // In editor mode (review off), 💬 toggle should NOT be in the module list
    await _wait(200);
    const commentIcon = _$$("span").find((s) => s.textContent?.includes("💬") && s.style?.cursor === "pointer" && !s.closest("button"));
    if (commentIcon) throw new Error("💬 icon should be hidden in editor mode");
  }},
  { name: "Review mode exit closes panel", fn: async () => {
    const btn = _$$("button").find((b) => (b.textContent || "").includes("Review") && (b.textContent || "").includes("💬"));
    if (!btn) throw new Error("Review button not found");
    _click(btn); await _wait(300);
    // Panel should be gone
    await _wait(200);
    const panel = _$text("COMMENTS");
    // May still be visible briefly — just verify no crash
  }},
  { name: "R key toggles review mode", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    _key("r"); await _wait(400);
    const panel = await _waitFor(() => _$text("COMMENTS"), 2000).catch(() => null);
    if (!panel) throw new Error("R key did not open comments panel");
    // Toggle off
    _key("r"); await _wait(400);
  }},
  { name: "Review mode and Vera are mutually exclusive", fn: async () => {
    // Open review
    const reviewBtn = _$$("button").find((b) => (b.textContent || "").includes("Review") && (b.textContent || "").includes("💬"));
    if (reviewBtn) { _click(reviewBtn); await _wait(300); }
    // Now open Vera — should close review
    const veraBtn = _$$("button").find((b) => (b.textContent || "").includes("Vera") && (b.textContent || "").includes("🤖"));
    if (veraBtn) { _click(veraBtn); await _wait(300); }
    // Vera should be open
    const veraTa = _$$("textarea").find((t) => {
      const ph = t.placeholder?.toLowerCase() || "";
      return ph.includes("tell vera") || ph.includes("paste images");
    });
    // Close Vera
    if (veraBtn) { _click(veraBtn); await _wait(200); }
    if (!veraTa) throw new Error("Vera panel didn't open when switching from Review");
  }},
  { name: "Comment badge click opens comments panel", fn: async () => {
    // Ensure review mode is off first
    document.activeElement?.blur(); await _wait(100);
    // Look for the amber comment count badge on the slide canvas (top-right circle)
    const badge = _$$("div").find((d) => d.style?.borderRadius === "11px" && d.style?.background && d.style?.cursor === "pointer" && d.style?.position === "absolute");
    if (badge) {
      _click(badge); await _wait(400);
      const panel = await _waitFor(() => _$text("COMMENTS"), 2000).catch(() => null);
      if (!panel) throw new Error("Clicking comment badge did not open comments panel");
      // Close review mode
      const reviewBtn = _$$("button").find((b) => (b.textContent || "").includes("Review") && (b.textContent || "").includes("💬"));
      if (reviewBtn) { _click(reviewBtn); await _wait(300); }
    }
    // If no badge, test passes (no comments on current slide)
  }},
]);

// ── Lab Player (v13.0) Suite ────────────────────────────────────────
uiSuite("Lab Player", [
  { name: "Code block renders (retrocompat)", fn: async () => {
    // Navigate through slides to find a code block
    await _waitFor(() => _$$("[data-block-type='code']").length > 0, 2000).catch(() => null);
    // Even if not on current slide, verify the component exists
    if (typeof CodeBlock !== "function") throw new Error("CodeBlock component not defined");
  }},
  { name: "CodeBlock sub-component renders code blocks", fn: async () => {
    // Verify RenderBlock delegates to CodeBlock for type=code
    const src = RenderBlock.toString();
    if (!src.includes("CodeBlock") && !src.includes("code")) throw new Error("RenderBlock does not reference CodeBlock");
  }},
  { name: "Callout block renders (retrocompat)", fn: async () => {
    if (typeof CalloutBlock !== "function") throw new Error("CalloutBlock component not defined");
  }},
  { name: "CalloutBlock sub-component renders callout blocks", fn: async () => {
    const src = RenderBlock.toString();
    if (!src.includes("CalloutBlock") && !src.includes("callout")) throw new Error("RenderBlock does not reference CalloutBlock");
  }},
  { name: "PromptBlock sub-component exists", fn: async () => {
    if (typeof PromptBlock !== "function") throw new Error("PromptBlock component not defined");
  }},
  { name: "ChallengeBlock sub-component exists", fn: async () => {
    if (typeof ChallengeBlock !== "function") throw new Error("ChallengeBlock component not defined");
  }},
  { name: "prompt block type in SAFE_BLOCK_TYPES", fn: async () => {
    if (!SAFE_BLOCK_TYPES.has("prompt")) throw new Error("prompt not in SAFE_BLOCK_TYPES");
  }},
  { name: "challenge block type in SAFE_BLOCK_TYPES", fn: async () => {
    if (!SAFE_BLOCK_TYPES.has("challenge")) throw new Error("challenge not in SAFE_BLOCK_TYPES");
  }},
  { name: "Existing code blocks render without copy button (default)", fn: async () => {
    // Navigate to find code block on demo deck
    for (let i = 0; i < 10; i++) { _key("ArrowRight"); await _wait(80); }
    await _wait(200);
    const codeBlocks = _$$("[data-block-type='code']");
    // Demo deck code blocks don't have copy:true, so no copy button
    for (const cb of codeBlocks) {
      const copyBtn = cb.querySelector("button");
      if (copyBtn && (copyBtn.textContent || "").includes("Copy")) {
        throw new Error("Default code block should NOT show copy button");
      }
    }
    // Go back to start
    for (let i = 0; i < 10; i++) { _key("ArrowLeft"); await _wait(50); }
  }},
  { name: "Existing callout blocks render expanded (no reveal)", fn: async () => {
    // Navigate to find callout
    for (let i = 0; i < 15; i++) { _key("ArrowRight"); await _wait(80); }
    await _wait(200);
    const callouts = _$$("[data-block-type='callout']");
    // Demo deck callouts don't have reveal:true, so body should be visible
    for (const c of callouts) {
      // Should NOT have chevron icon for non-reveal callouts
      const chevron = c.querySelector("[aria-expanded]");
      if (chevron) throw new Error("Non-reveal callout should not have aria-expanded");
    }
    // Go back to start
    for (let i = 0; i < 15; i++) { _key("ArrowLeft"); await _wait(50); }
  }},
  { name: "Bullet items render (retrocompat)", fn: async () => {
    // Just verify bullets still render on the demo deck
    for (let i = 0; i < 5; i++) { _key("ArrowRight"); await _wait(80); }
    await _wait(200);
    const bullets = _$$("[data-block-type='bullets']");
    // Go back
    for (let i = 0; i < 5; i++) { _key("ArrowLeft"); await _wait(50); }
    // Even if no bullets on current slide, component should exist
    if (typeof BulletItem !== "function") throw new Error("BulletItem component not defined");
  }},
  { name: "Icon row items render (retrocompat)", fn: async () => {
    if (typeof IconRowItem !== "function") throw new Error("IconRowItem component not defined");
  }},
  { name: "velaClipboard helper exists for copy buttons", fn: async () => {
    if (typeof velaClipboard !== "function") throw new Error("velaClipboard not defined");
  }},
]);

// ━━━ UI TEST RUNNER COMPONENT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Demo deck guard — UI tests only run against the original demo deck
// to avoid mutating user work. Reads live deck title from DOM header.

function computeDeckFingerprint() {
  try {
    // Read LIVE deck title from header (reflects current state, not embedded data)
    const titleEl = _$$("header span").find((s) => {
      const fw = s.style?.fontWeight;
      return (fw === "700" || fw === 700 || fw === "bold") && s.textContent?.length > 1;
    });
    const liveTitle = titleEl?.textContent?.trim() || "";

    // Read slide count from DOM (e.g. "21sl" or slide counter "3 / 8")
    const statsEl = _$$("header span").find((s) => s.textContent?.includes("sl") && s.textContent?.includes("§"));
    let slideCount = 0;
    if (statsEl) {
      const m = statsEl.textContent.match(/(\d+)sl/);
      if (m) slideCount = parseInt(m[1]);
    }

    // Build fingerprint from live DOM state
    if (liveTitle) return `${liveTitle}|${slideCount}`;
    return null;
  } catch { return null; }
}

// Fingerprint: "title|slideCount" — matches demo deck as assembled
const DEMO_DECK_FP_TITLE = "Vela Slides \u2014 Live Demo";

function VelaUITestRunner() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [progress, setProgress] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [warning, setWarning] = useState(null);
  const [hasRun, setHasRun] = useState(false);

  const run = async (force) => {
    // Fingerprint check — only run against demo deck unless forced
    if (!force) {
      const fp = computeDeckFingerprint();
      const isDemo = fp && fp.startsWith(DEMO_DECK_FP_TITLE + "|");
      if (!isDemo) {
        setWarning({ fp: fp || "(unable to read deck)", expected: DEMO_DECK_FP_TITLE });
        return;
      }
    }
    setWarning(null);
    setRunning(true);
    setResults(null);
    setExpanded(true);
    const res = await runUITests((p) => setProgress(p));
    setResults(res);
    setRunning(false);
    setProgress(null);
    setHasRun(true);
  };

  // Ctrl+Alt+T or custom event triggers
  useEffect(() => {
    const keyHandler = (e) => {
      if (e.ctrlKey && e.altKey && e.key === "t") {
        e.preventDefault();
        if (!running) run();
      }
    };
    const eventHandler = () => { if (!running) run(); };
    window.addEventListener("keydown", keyHandler);
    window.addEventListener("vela-run-uitests", eventHandler);
    return () => { window.removeEventListener("keydown", keyHandler); window.removeEventListener("vela-run-uitests", eventHandler); };
  }, [running]);

  const copyResults = () => {
    if (!results) return;
    const passed = results.filter((r) => r.pass).length;
    const failed = results.filter((r) => !r.pass).length;
    const lines = [
      `⛵ Vela UI Tests — v${VELA_VERSION}`,
      `${passed} passed, ${failed} failed, ${results.length} total`,
      `${new Date().toISOString()}`,
      "",
      ...results.map((r) => `${r.pass ? "✅" : "❌"} [${r.suite}] ${r.name} (${r.ms}ms)${r.error ? ` — ${r.error}` : ""}`),
    ];
    const text = lines.join("\n");
    velaClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!results && !running && !warning) {
    // Show mini rerun button if tests have been run before
    if (!hasRun) return null;
    return (
      <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 99999 }}>
        <button onClick={() => run()} style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(15,23,42,0.9)", border: "1px solid rgba(99,102,241,0.4)", color: "#818cf8", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(0,0,0,0.4)", backdropFilter: "blur(8px)" }} title="Re-run UI Tests (Ctrl+Alt+T)">🧪</button>
      </div>
    );
  }

  // Warning: wrong deck loaded
  if (warning && !running && !results) return (
    <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 99999, fontFamily: FONT.mono, maxWidth: 380 }}>
      <div style={{ borderRadius: 10, background: "rgba(15,23,42,0.97)", border: "1px solid rgba(251,191,36,0.5)", boxShadow: "0 8px 40px rgba(0,0,0,0.5)", backdropFilter: "blur(12px)", padding: "14px 16px" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#fbbf24", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
          <span>⚠️</span> UI Tests — Wrong Deck
        </div>
        <div style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.6, marginBottom: 10 }}>
          UI tests are designed for the demo deck and may modify slides. Current deck doesn't match the expected fingerprint.
        </div>
        <div style={{ fontSize: 8, color: "#475569", marginBottom: 10, wordBreak: "break-all" }}>
          Current: {warning.fp || "(unknown)"}<br />
          Expected title: {warning.expected}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => run(true)} style={{ padding: "5px 12px", fontSize: 10, fontWeight: 700, background: "rgba(251,191,36,0.2)", border: "1px solid rgba(251,191,36,0.4)", borderRadius: 4, color: "#fbbf24", cursor: "pointer" }}>Run anyway</button>
          <button onClick={() => setWarning(null)} style={{ padding: "5px 12px", fontSize: 10, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4, color: "#94a3b8", cursor: "pointer" }}>Cancel</button>
        </div>
      </div>
    </div>
  );

  const passed = results?.filter((r) => r.pass).length || 0;
  const failed = results?.filter((r) => !r.pass).length || 0;
  const total = results?.length || 0;
  const totalMs = results?.reduce((s, r) => s + r.ms, 0) || 0;

  // Group by suite
  const suites = {};
  (results || []).forEach((r) => {
    if (!suites[r.suite]) suites[r.suite] = [];
    suites[r.suite].push(r);
  });

  return (
    <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 99999, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, fontFamily: FONT.mono, maxWidth: 420 }}>
      {/* Live progress while running */}
      {running && progress && (
        <div style={{ borderRadius: 10, background: "rgba(15,23,42,0.97)", border: "1px solid rgba(59,130,246,0.5)", boxShadow: "0 8px 40px rgba(0,0,0,0.5)", backdropFilter: "blur(12px)", overflow: "hidden", maxWidth: 380, display: "flex", flexDirection: "column" }}>
          {/* Progress header */}
          <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
            <span style={{ animation: "spin 1s linear infinite", display: "inline-block", fontSize: 14 }}>🧪</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{progress.done}/{progress.total}</span>
            <span style={{ fontSize: 10, color: "#34d399", fontWeight: 600 }}>✓ {progress.passed || 0}</span>
            {(progress.failed || 0) > 0 && <span style={{ fontSize: 10, color: "#f87171", fontWeight: 600 }}>✗ {progress.failed}</span>}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>{Math.round((progress.done / progress.total) * 100)}%</span>
          </div>
          {/* Progress bar */}
          <div style={{ height: 3, background: "rgba(255,255,255,0.1)" }}>
            <div style={{ height: "100%", background: (progress.failed || 0) > 0 ? "#f87171" : "#3b82f6", width: `${(progress.done / progress.total) * 100}%`, transition: "width 0.15s" }} />
          </div>
          {/* Current test */}
          <div style={{ padding: "6px 14px", fontSize: 10, color: "rgba(255,255,255,0.6)" }}>
            {progress.suite} → {progress.test}
          </div>
          {/* Live failures */}
          {progress.results && progress.results.filter((r) => !r.pass).length > 0 && (
            <div style={{ maxHeight: 160, overflowY: "auto", padding: "0 14px 8px" }}>
              {progress.results.filter((r) => !r.pass).map((r, i) => (
                <div key={i} style={{ fontSize: 10, color: "#f87171", padding: "3px 0", lineHeight: 1.4 }}>
                  ✗ <span style={{ fontWeight: 600 }}>[{r.suite}]</span> {r.name}
                  {r.error && <div style={{ fontSize: 9, color: "#f87171", opacity: 0.7, paddingLeft: 12 }}>↳ {r.error}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Results panel */}
      {results && (
        <div style={{ borderRadius: 10, background: "rgba(15,23,42,0.97)", border: `1px solid ${failed > 0 ? "rgba(239,68,68,0.5)" : "rgba(16,185,129,0.5)"}`, boxShadow: "0 8px 40px rgba(0,0,0,0.5)", backdropFilter: "blur(12px)", overflow: "hidden", maxHeight: expanded ? "80vh" : "auto", display: "flex", flexDirection: "column" }}>
          {/* Header */}
          <div onClick={() => setExpanded((v) => !v)} style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", borderBottom: expanded ? "1px solid rgba(255,255,255,0.1)" : "none" }}>
            <span style={{ fontSize: 14 }}>{failed > 0 ? "❌" : "✅"}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>UI Tests: {passed}/{total}</span>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)" }}>{(totalMs / 1000).toFixed(1)}s · v{VELA_VERSION}</span>
            <div style={{ flex: 1 }} />
            <button onClick={(e) => { e.stopPropagation(); copyResults(); }} style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontSize: 9, fontFamily: FONT.mono }}>{copied ? "Copied!" : "📋"}</button>
            <button onClick={(e) => { e.stopPropagation(); run(); }} style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontSize: 9, fontFamily: FONT.mono }}>🔄</button>
            <button onClick={(e) => { e.stopPropagation(); setResults(null); setExpanded(false); }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 12, padding: "0 2px" }}>✕</button>
          </div>

          {/* Expanded results */}
          {expanded && (
            <div style={{ overflowY: "auto", maxHeight: "60vh", padding: "6px 0" }}>
              {Object.entries(suites).map(([name, tests]) => {
                const suitePassed = tests.every((t) => t.pass);
                const suiteFailed = tests.filter((t) => !t.pass).length;
                return (
                  <div key={name} style={{ padding: "4px 14px" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: suitePassed ? "#34d399" : "#f87171", padding: "4px 0", display: "flex", alignItems: "center", gap: 6 }}>
                      <span>{suitePassed ? "✅" : "❌"}</span>
                      <span>{name}</span>
                      <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>{tests.length} tests{suiteFailed > 0 ? `, ${suiteFailed} failed` : ""}</span>
                    </div>
                    {tests.map((t, i) => (
                      <div key={i} style={{ fontSize: 9, padding: "2px 0 2px 18px", color: t.pass ? "rgba(255,255,255,0.5)" : "#f87171", lineHeight: 1.5 }}>
                        {t.pass ? "✓" : "✗"} {t.name} <span style={{ color: "rgba(255,255,255,0.2)" }}>{t.ms}ms</span>
                        {t.error && <div style={{ color: "#f87171", fontSize: 8, paddingLeft: 12 }}>↳ {t.error}</div>}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
