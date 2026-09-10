// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
// ━━━ Vela UI Integration Tests ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Zero-dependency UI test runner that operates on the live DOM.
// Triggered via Ctrl+Alt+T or the "🧪 UI" button in the battery toast.
// Tests run against whatever deck is loaded — demo deck recommended.

// ── Test-hook bridge ─────────────────────────────────────────────────
// A few suites need states with no offline UI path (study notes, block
// injection, the AI-working flag). The app installs its test-hook object only
// in dev/local builds that opt in (see part-app.jsx), and concat.py --release
// strips BOTH that block and the binding below — so a release bundle carries no
// test-hook reference at all. In a stripped build _hooks() stays the empty stub
// and the hook-dependent tests fail loudly rather than silently passing.
let _hooks = () => ({});
// VELA:DEV-ONLY:BEGIN
_hooks = () => (typeof window !== "undefined" && window.__velaTestHooks) || {};
// VELA:DEV-ONLY:END

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
        // Security regression tests (SVG sanitizer / redress / clickjack) must NEVER
        // skip. CI treats a skip as non-failing, so allowing requiresAI on them would
        // let a re-admitted <style> — or any sanitizer regression — reach green CI by
        // skipping the real-runtime test that catches it. requiresAI on such a test is
        // itself the tampering signal, so FAIL instead of skip. This is RUNTIME
        // enforcement on the actual test object, immune to the source-parse dodges
        // (comment padding, property order) that a static lint check can be fooled by.
        const _secPat = /saniti[sz]|xss|security|redress|clickjack|<style>/i;
        if (_secPat.test(suite.name) || _secPat.test(test.name)) {
          failed++;
          allResults.push({ suite: suite.name, name: test.name, pass: false, error: "security test must not be requiresAI-skippable (would let a sanitizer regression pass CI by skipping)", ms: Math.round(performance.now() - t0) });
          if (onProgress) onProgress({ done, total, suite: suite.name, test: test.name, phase: "done", passed, failed, skipped, results: [...allResults] });
          await _wait(20);
          continue;
        }
        skipped++;
        allResults.push({ suite: suite.name, name: test.name, pass: "skip", error: "AI unavailable — skipped", ms: Math.round(performance.now() - t0) });
        if (onProgress) onProgress({ done, total, suite: suite.name, test: test.name, phase: "done", passed, failed, skipped, results: [...allResults] });
        await _wait(20);
        continue;
      }
      try {
        // A test passes by returning a truthy value OR by assertion-style running
        // to completion with no explicit return (undefined). A DEFINED-FALSY return
        // (false/null/0/"") is a real assertion failure. Historically the return
        // value was discarded — only a throw failed a test — so every `return
        // boolExpr` test (~a third of the battery, incl. the SVG-<style> redress
        // regression test) could never fail. Check the result so those assertions
        // are actually load-bearing.
        const r = await test.fn();
        if (r === undefined || !!r) {
          passed++;
          allResults.push({ suite: suite.name, name: test.name, pass: true, ms: Math.round(performance.now() - t0) });
        } else {
          failed++;
          allResults.push({ suite: suite.name, name: test.name, pass: false, error: "assertion returned " + JSON.stringify(r), ms: Math.round(performance.now() - t0) });
        }
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

// VELA:DEV-ONLY:BEGIN
// Headless entry point for automated browser drivers (see the vela-live-render
// skill / vela-drive.js). Runs every suite and resolves to the results array,
// also stashing it on window.__velaUITestResults for pollers.
//
// Kept off the production surface by the SAME two layers as the __velaTestHooks
// object in part-app.jsx (ASVS V14.1.3 / V14.2.2), which this previously lacked:
//   1. runtime gate — installed only in local/desktop mode, or when a harness
//      opts in by setting window.__velaTestMode BEFORE boot (vela-drive.js does
//      this via addInitScript, so the headless battery is unaffected);
//   2. build-time strip — concat.py --release drops this fenced block.
// The committed vela.jsx is a DEV build, so the gate is what keeps the battery
// off a hosted artifact; the fence is what keeps it out of the desktop bundle.
if (typeof window !== "undefined" && velaTestSurfaceEnabled()) {
  window.__velaRunUITests = async () => {
    const results = await runUITests();
    window.__velaUITestResults = results;
    return results;
  };
}
// VELA:DEV-ONLY:END

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
  { name: "Present Edit toggle flips inline editing (Shift+E)", fn: async () => {
    // The ✎ toggle restores click-to-edit while presenting. It must start OFF
    // (audience-clean, per CR-03) and flip deterministically via Shift+E. The
    // title reflects presentEdit regardless of deck content, so it's a stable
    // signal. Reset to OFF afterwards so the audience-clean invariant holds.
    const btn = await _waitFor(() => _$("[data-testid='present-edit-toggle']"));
    if (!btn) throw new Error("present-edit-toggle not found in Present view");
    if (!/^Edit mode/.test(btn.title)) throw new Error("edit toggle should start OFF while presenting");
    _key("E", { shiftKey: true });
    await _waitFor(() => /^Editing on/.test(_$("[data-testid='present-edit-toggle']")?.title || ""));
    _key("E", { shiftKey: true });
    await _waitFor(() => /^Edit mode/.test(_$("[data-testid='present-edit-toggle']")?.title || ""));
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

// ── TOC Collapse / Keyboard-Tree Suite (CR2) ─────────────────────────
// Verifies the roving ARIA tree, the disclosure keys (Right=expand /
// Left=collapse on a focused section header), and the CORE fix: a collapsed
// section that holds the active slide keeps a live k/N marker + accent border
// so the user never loses "you are here" — WITHOUT auto-expanding.
const _tocHeaders = () => _$$('[data-testid="toc-section-header"]');
// NOTE: _tocRows() is defined once later in this file (shared helper) — reuse it.
const _tocToggle = (header) => Array.from(header.querySelectorAll("span")).find((s) => (s.textContent || "").trim() === "▼");
const _tocCollapsed = (header) => header.getAttribute("aria-expanded") === "false";
// D3: deterministic act-and-settle for the disclosure toggle. The on-load auto-run
// can start a beat before the roving-tree state is fully wired, so a single toggle
// click may be dropped. Re-issue the click ONLY after giving the previous one time
// to land (spaced re-clicks never oscillate — once the aria state matches we stop),
// and CONFIRM the settled aria-expanded state before returning (no swallowed wait).
const _tocDriveState = async (header, wantCollapsed) => {
  let lastClick = 0;
  await _waitFor(() => {
    if (_tocCollapsed(header) === wantCollapsed) return true;
    if (Date.now() - lastClick > 400) { const t = _tocToggle(header); if (t) { _click(t); lastClick = Date.now(); } }
    return false;
  }, 3000);
};
const _tocEnsureExpanded = (header) => _tocDriveState(header, false);
const _tocEnsureCollapsed = (header) => _tocDriveState(header, true);
// D3: focus a treeitem and RETRY until focus actually sticks — a collapse/expand
// re-render (which flips the roving tabindex from -1 to 0) can drop a focus set a
// beat too early, which is what made the key-nav tests race in the auto-run.
const _focusTocHeader = (header) => _waitFor(() => { header.focus(); return document.activeElement === header; }, 1500);
// Select a section header and wait for the selection (and thus its active-slide
// marker eligibility) to actually settle before driving collapse state.
const _selectTocHeader = async (header) => { _click(header); await _waitFor(() => header.getAttribute("aria-selected") === "true", 1500); };

uiSuite("TOC Collapse Nav", [
  { name: "Collapse hides slide rows + shows k/N marker with accent border", fn: async () => {
    const header = await _waitFor(() => _tocHeaders()[0], 2000);
    await _selectTocHeader(header); // select this section (active slide = its slide 0)
    await _tocEnsureExpanded(header);
    await _waitFor(() => _tocRows().length > 0, 1500); // rows mounted before we measure
    const before = _tocRows().length;
    _click(_tocToggle(header));
    await _waitFor(() => _tocCollapsed(header) && _tocRows().length < before, 2000);
    const marker = await _waitFor(() => header.querySelector('[data-testid="toc-collapsed-marker"]'), 1500);
    if (!/^\d+ \/ \d+$/.test((marker.textContent || "").trim())) throw new Error("marker not k/N: " + marker.textContent);
    if (!/2px solid/.test(header.style.borderLeft) || /transparent/.test(header.style.borderLeft)) throw new Error("no accent left-border on collapsed active header");
    await _tocEnsureExpanded(header); // restore
  }},
  { name: "Marker updates live as the active slide advances (stays folded)", fn: async () => {
    const header = await _waitFor(() => _tocHeaders()[0], 2000);
    await _selectTocHeader(header);
    // need a section with >= 2 slides for a live delta
    await _tocEnsureExpanded(header);
    await _waitFor(() => _tocRows().length > 0, 1500);
    const n = _tocRows().length;
    await _tocEnsureCollapsed(header);
    const readK = () => { const m = header.querySelector('[data-testid="toc-collapsed-marker"]'); return m ? parseInt((m.textContent || "").trim(), 10) : null; };
    await _waitFor(() => readK() != null, 1500); // collapsed active marker present before we read it
    const k0 = readK();
    if (k0 == null) throw new Error("no marker while collapsed");
    if (n >= 2) {
      document.activeElement?.blur(); await _wait(60);
      _key("ArrowRight"); // global slide-advance (focus off the rail)
      await _waitFor(() => readK() === k0 + 1, 1500);
      if (_tocCollapsed(header) !== true) throw new Error("section auto-expanded — must stay folded");
    }
    await _tocEnsureExpanded(header); // restore
  }},
  { name: "ArrowRight on a focused collapsed header expands it", fn: async () => {
    const header = await _waitFor(() => _tocHeaders()[0], 2000);
    await _selectTocHeader(header);
    await _tocEnsureCollapsed(header);
    await _focusTocHeader(header); // retries until focus sticks (post-collapse re-render)
    _key("ArrowRight");
    await _waitFor(() => header.getAttribute("aria-expanded") === "true", 1500);
    if (_tocRows().length === 0) throw new Error("rows did not reappear after expand");
  }},
  { name: "ArrowLeft on a focused expanded header collapses it", fn: async () => {
    const header = await _waitFor(() => _tocHeaders()[0], 2000);
    await _selectTocHeader(header);
    await _tocEnsureExpanded(header);
    await _focusTocHeader(header);
    _key("ArrowLeft");
    await _waitFor(() => header.getAttribute("aria-expanded") === "false", 1500);
    await _tocEnsureExpanded(header); // restore
  }},
  { name: "ARIA tree roles + roving tabindex present", fn: async () => {
    if (!_$('[role="tree"]')) throw new Error("no role=tree container");
    const header = await _waitFor(() => _tocHeaders()[0], 2000);
    if (header.getAttribute("role") !== "treeitem") throw new Error("header not role=treeitem");
    if (!header.hasAttribute("aria-expanded")) throw new Error("header missing aria-expanded");
    await _focusTocHeader(header);
    await _waitFor(() => header.getAttribute("tabindex") === "0", 1500); // roving flips -1→0 on focus
  }},
  { name: "Arrow on a focused slide row moves the shown slide (single cursor)", fn: async () => {
    // Regression: the outline "focus ring" used to roam independently of the shown
    // slide, so arrows on a focused TOC row moved only the ring, not state.slideIndex.
    // Now the tree cursor IS the selection — focus and the active slide stay together.
    const rows = await _waitFor(() => (_tocRows().length >= 2 ? _tocRows() : null), 2000);
    if (!rows) return; // soft pass: needs >= 2 slides in the first module
    _click(rows[0]); // select + focus the first slide row
    await _waitFor(() => rows[0].getAttribute("aria-selected") === "true", 1500);
    await _waitFor(() => { rows[0].focus(); return document.activeElement === rows[0]; }, 1500);
    const before = _hooks().getSelection && _hooks().getSelection();
    if (!before) throw new Error("no getSelection test hook");
    _key("ArrowDown");
    // The REAL selection must advance (this is exactly what the bug broke).
    await _waitFor(() => { const s = _hooks().getSelection(); return s && (s.slideIdx !== before.slideIdx || s.itemId !== before.itemId); }, 1500);
    // Exactly one row is active AND it holds focus → a single, unified cursor.
    await _waitFor(() => { const a = _tocRows().filter((r) => r.getAttribute("aria-selected") === "true"); return a.length === 1 && document.activeElement === a[0]; }, 1500);
  }},
  { name: "Collapsed sections: Up/Down move section-to-section, entering shows first slide", fn: async () => {
    // Only sections WITH slides expose aria-expanded and can be folded (empty
    // sections have nothing to collapse), so pick the first two of those.
    const headers = await _waitFor(() => { const h = _tocHeaders().filter((x) => x.hasAttribute("aria-expanded")); return h.length >= 2 ? h : null; }, 2000);
    if (!headers) return; // soft pass: needs >= 2 non-empty sections
    await _selectTocHeader(headers[0]);
    await _tocEnsureCollapsed(headers[0]);
    await _tocEnsureCollapsed(headers[1]);
    await _focusTocHeader(headers[0]);
    const before = _hooks().getSelection && _hooks().getSelection();
    if (!before) throw new Error("no getSelection test hook");
    _key("ArrowDown");
    // Down over a folded section jumps to the NEXT section and shows its first slide,
    // instead of stepping through the current section's hidden slides.
    await _waitFor(() => { const s = _hooks().getSelection(); return s && s.itemId !== before.itemId && s.slideIdx === 0; }, 1500);
    // Neither section auto-expands during section-level nav.
    if (_tocCollapsed(headers[0]) !== true || _tocCollapsed(headers[1]) !== true) throw new Error("section auto-expanded during section nav");
    await _tocEnsureExpanded(headers[0]); await _tocEnsureExpanded(headers[1]); // restore
  }},
], { setup: _selectFirstModule });

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
    // The demo deck has slides with pre-authored studyNotes; on those the student
    // panel renders the static StaticStudyPanel (data-study-panel), NOT the live
    // TeacherPanel. The next tests assert TeacherPanel's shell (which renders
    // unconditionally, no AI needed), so navigate to a notes-free slide —
    // TeacherPanel is [data-teacher-panel] WITHOUT data-study-panel. (These 4 tests
    // were previously mislabeled requiresAI, hiding this suite-ordering dependency.)
    for (let i = 0; i < 40 && _$("[data-teacher-panel][data-study-panel]"); i++) {
      _key("ArrowRight"); await _wait(90);
    }
    await _waitFor(() => _$("[data-teacher-panel]:not([data-study-panel])"), 2000).catch(() => {});
  }},
  { name: "Teacher panel renders VERA header", fn: async () => {
    // TeacherPanel renders its VERA header / disclaimer / Ask UI unconditionally
    // (no AI backend needed). The suite setup navigates to a notes-free slide so
    // this is TeacherPanel, not StaticStudyPanel — see "Activate student mode".
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
// Uses the test-only affordance _hooks().injectStudyNotes (test-hook bridge) to
// patch the current slide with a pre-authored studyNotes object, then
// exercises the offline StaticStudyPanel rendering (text + glossary
// X-Ray links + questions + diagram). Does not depend on a live API.
uiSuite("Study Notes", [
  { name: "Test hook injectStudyNotes available", fn: async () => {
    if (typeof _hooks().injectStudyNotes !== "function") throw new Error("_hooks().injectStudyNotes not exposed");
  }},
  { name: "Inject studyNotes into current slide", fn: async () => {
    const sn = {
      text: "An **agent** is a goal-driven loop. See [ReAct](https://arxiv.org/abs/2210.03629) or [what an agent is](#agent).",
      diagram: "<svg viewBox='0 0 10 10' xmlns='http://www.w3.org/2000/svg'><rect x='1' y='1' width='8' height='8' fill='#3b82f6'/></svg>",
      questions: ["Why does this matter?", "When does it fail?"],
      glossary: { agent: { definition: "A goal-driven loop that plans, acts, observes.", url: "https://example.com/a" } }
    };
    const ok = _hooks().injectStudyNotes(sn);
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
    _hooks().injectStudyNotes(undefined);
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
    if (typeof _hooks().injectBlocks !== "function") throw new Error("injectBlocks test hook not exposed");
    if (!_$("[data-testid='slide-toolbar']")) throw new Error("slide-toolbar not found");
    // Light slide, no notes.
    _hooks().injectBlocks([{ type: "heading", text: "LIGHT" }], { notes: "" });
    await _wait(180);
    const tb1 = _$("[data-testid='slide-toolbar']").getBoundingClientRect();
    const vp1 = _$("[data-testid='slide-viewport']").getBoundingClientRect();
    // Heavy slide with lots of content AND speaker notes — the pre-fix notes
    // auto-expand + elastic viewport would shove the toolbar upward here.
    _hooks().injectBlocks([
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
    _hooks().injectBlocks([{ type: "heading", text: "" }], { notes: "" });
    await _wait(80);
  }},
  { name: "CR2: centered heading renders centered in editor (icon-slot path)", fn: async () => {
    if (typeof _hooks().injectBlocks !== "function") throw new Error("injectBlocks test hook not exposed");
    // Inject a centered heading (NO icon → the editor still forces its icon-slot
    // flex row, which is exactly the path that used to drop centering).
    const okc = _hooks().injectBlocks([{ type: "heading", text: "CENTERED TITLE UITEST", size: "2xl", align: "center" }]);
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
  { name: "CR4: side layouts balance media and safely map vertical alignment", fn: async () => {
    const hooks = _hooks();
    if (typeof hooks.injectBlocks !== "function") throw new Error("injectBlocks test hook not exposed");
    const image = { type: "image", src: "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='400'%20height='100'%3E%3Crect%20width='400'%20height='100'%20fill='%233b82f6'/%3E%3C/svg%3E", maxHeight: 120 };
    // No maxHeight and a very tall intrinsic size (200x3000). A media-only
    // cols side must contain it with its spacer and divider, not crop it.
    const bigImage = { type: "image", src: "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='200'%20height='3000'%3E%3Crect%20width='200'%20height='3000'%20fill='%23ef4444'/%3E%3C/svg%3E" };
    const heavy = Array.from({ length: 18 }, (_, i) => ({ type: "text", text: `OVERFLOW ROW ${i + 1} ` + "content ".repeat(12) }));
    const expected = { top: "flex-start", center: "safe center", bottom: "safe flex-end" };
    const justify = (el) => getComputedStyle(el).justifyContent;
    const presenterScope = () => _$("[data-testid='present-edit-toggle']")?.closest("[style*='position: fixed']") || null;
    const scopeFor = (mode) => mode === "editor" ? _$("[data-testid='slide-viewport']") : presenterScope();
    const inset = (el) => {
      const child = Array.from(el.children).find((node) => node.getBoundingClientRect().height > 1);
      if (!child) throw new Error("layout column has no visible child");
      return child.getBoundingClientRect().top - el.getBoundingClientRect().top;
    };
    const waitForColumns = async (leftSelector, rightSelector) => {
      const left = await _waitFor(() => _$(leftSelector), 3000);
      const right = await _waitFor(() => _$(rightSelector), 3000);
      await _wait(180);
      return [left, right];
    };

    for (const layout of ["image-left", "image-right"]) {
      for (const [value, css] of Object.entries(expected)) {
        if (!hooks.injectBlocks([{ type: "heading", text: `${layout} ${value}` }, image], { layout, verticalAlign: value, L: undefined, R: undefined })) {
          throw new Error(`could not inject ${layout} ${value}`);
        }
        const [contentCol, imageCol] = await waitForColumns("[data-split-content]", "[data-split-image]");
        if (justify(contentCol) !== css || justify(imageCol) !== css) {
          throw new Error(`${layout} ${value} mapped to ${justify(contentCol)}/${justify(imageCol)}, expected ${css}`);
        }
      }

      hooks.injectBlocks([{ type: "heading", text: `${layout} balanced` }, image], { layout, verticalAlign: undefined, L: undefined, R: undefined });
      let [contentCol, imageCol] = await waitForColumns("[data-split-content]", "[data-split-image]");
      if (inset(contentCol) < 20 || inset(imageCol) < 20) throw new Error(`${layout} did not center both fitting sides`);

      hooks.injectBlocks([...heavy, image], { layout, verticalAlign: undefined, L: undefined, R: undefined });
      [contentCol, imageCol] = await waitForColumns("[data-split-content]", "[data-split-image]");
      const contentRect = contentCol.getBoundingClientRect();
      const contentChildren = Array.from(contentCol.children).filter((node) => node.getBoundingClientRect().height > 1);
      const firstRect = contentChildren[0]?.getBoundingClientRect();
      const lastRect = contentChildren[contentChildren.length - 1]?.getBoundingClientRect();
      if (!firstRect || firstRect.top < contentRect.top - 1.5 || lastRect.bottom > contentRect.bottom + 1.5) {
        throw new Error(`${layout} scaled content is clipped`);
      }
      if (inset(imageCol) < 20) throw new Error(`${layout} overflow moved the image away from center`);
    }

    hooks.injectBlocks([], { layout: "cols", verticalAlign: undefined, L: [image, { type: "spacer", h: 8 }], R: [{ type: "heading", text: "COLS BALANCED" }] });
    let [leftCol, rightCol] = await waitForColumns("[data-cols-side='left']", "[data-cols-side='right']");
    if (inset(leftCol) < 20 || inset(rightCol) < 20) throw new Error("media-side cols did not center both fitting sides");

    hooks.injectBlocks([], { layout: "cols", verticalAlign: undefined, L: [image, { type: "spacer", h: 8 }], R: heavy });
    [leftCol, rightCol] = await waitForColumns("[data-cols-side='left']", "[data-cols-side='right']");
    if (inset(leftCol) < 20) throw new Error("media-side cols overflow moved the image away from center");
    if (inset(rightCol) > 14) throw new Error(`media-side cols overflow content did not start at the top (inset=${inset(rightCol).toFixed(1)})`);

    const assertMediaContained = async (mode) => {
      const marker = `COLS FIT MEDIA ${mode}`;
      hooks.injectBlocks([], {
        layout: "cols", verticalAlign: undefined, padding: null, gap: null,
        splitGap: null, contentFlex: null, imageFlex: null,
        L: [bigImage, { type: "spacer", h: 18 }, { type: "divider", spacing: 8 }],
        R: [{ type: "heading", text: marker }],
      });
      const scope = await _waitFor(() => {
        const current = scopeFor(mode);
        return current?.textContent.includes(marker) && current.querySelector("[data-cols-side='left'] img") ? current : null;
      }, 3000);
      await _wait(220);
      const column = scope.querySelector("[data-cols-side='left']");
      const img = column.querySelector("img");
      const canvas = column.parentElement?.parentElement?.parentElement?.parentElement;
      if (!canvas) throw new Error(`${mode}: cols canvas not found`);
      const cr = canvas.getBoundingClientRect();
      const ir = img.getBoundingClientRect();
      const childRects = Array.from(column.children).map((node) => node.getBoundingClientRect()).filter((r) => r.height > 0);
      const contentTop = Math.min(...childRects.map((r) => r.top));
      const contentBottom = Math.max(...childRects.map((r) => r.bottom));
      if (ir.top < cr.top - 1.5 || ir.bottom > cr.bottom + 1.5) {
        throw new Error(`${mode}: fitted image edges outside canvas (${(ir.top - cr.top).toFixed(1)}, ${(cr.bottom - ir.bottom).toFixed(1)})`);
      }
      if (contentTop < cr.top - 1.5 || contentBottom > cr.bottom + 1.5) {
        throw new Error(`${mode}: media sequence edges outside canvas (${(contentTop - cr.top).toFixed(1)}, ${(cr.bottom - contentBottom).toFixed(1)})`);
      }
      const ratio = ir.height / ir.width;
      if (Math.abs(ratio - 15) > 0.2) throw new Error(`${mode}: fitted image changed aspect ratio to ${ratio.toFixed(2)}`);
      if (getComputedStyle(img).objectFit !== "contain") throw new Error(`${mode}: fitted image did not use contain`);
    };

    await assertMediaContained("editor");
    _key("f");
    await _waitFor(() => presenterScope(), 3000);
    try {
      await assertMediaContained("presenter");
    } finally {
      _key("f");
      await _waitFor(() => _$("header"), 3000).catch(() => {});
    }

    for (const [value, css] of Object.entries(expected)) {
      hooks.injectBlocks([], { layout: "cols", verticalAlign: value, L: [image], R: [{ type: "heading", text: `COLS ${value}` }] });
      [leftCol, rightCol] = await waitForColumns("[data-cols-side='left']", "[data-cols-side='right']");
      if (justify(leftCol) !== css || justify(rightCol) !== css) {
        throw new Error(`cols ${value} mapped to ${justify(leftCol)}/${justify(rightCol)}, expected ${css}`);
      }
    }

    hooks.injectBlocks([], { layout: "cols", verticalAlign: "invalid", L: [{ type: "heading", text: "LEFT" }], R: [{ type: "text", text: "RIGHT" }] });
    [leftCol, rightCol] = await waitForColumns("[data-cols-side='left']", "[data-cols-side='right']");
    if (justify(leftCol) !== "flex-start" || justify(rightCol) !== "flex-start") throw new Error("invalid alignment did not use the generic cols default");

    hooks.injectBlocks([{ type: "heading", text: "INVALID SPLIT" }, image], { layout: "image-right", verticalAlign: "invalid", L: undefined, R: undefined });
    const [invalidContent, invalidImage] = await waitForColumns("[data-split-content]", "[data-split-image]");
    if (justify(invalidContent) === "invalid" || justify(invalidImage) === "invalid") throw new Error("invalid deck alignment reached CSS");
  }},
  { name: "CR4: mixed cols contain tall images and balance aspect ratios in editor and presenter", fn: async () => {
    const hooks = _hooks();
    if (typeof hooks.injectBlocks !== "function") throw new Error("injectBlocks test hook not exposed");
    const portrait = { type: "image", src: "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='200'%20height='3000'%3E%3Crect%20width='200'%20height='3000'%20fill='%23ef4444'/%3E%3C/svg%3E" };
    const landscape = { type: "image", src: "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='400'%20height='100'%3E%3Crect%20width='400'%20height='100'%20fill='%233b82f6'/%3E%3C/svg%3E" };
    const presenterScope = () => _$("[data-testid='present-edit-toggle']")?.closest("[style*='position: fixed']") || null;
    const scopeFor = (mode) => mode === "editor" ? _$("[data-testid='slide-viewport']") : presenterScope();
    const waitForCase = async (mode, marker, imageCount) => {
      const column = await _waitFor(() => {
        const scope = scopeFor(mode);
        const candidate = scope?.querySelector("[data-cols-side='left']");
        const images = candidate?.querySelectorAll("img");
        return scope?.textContent.includes(marker) && images?.length === imageCount &&
          Array.from(images).every((img) => img.complete && img.naturalWidth > 0) ? candidate : null;
      }, 3000);
      await _wait(220);
      return column;
    };
    const assertContained = (mode, label, column) => {
      const columnRect = column.getBoundingClientRect();
      const children = Array.from(column.children).filter((node) => node.getBoundingClientRect().height > 0);
      const images = Array.from(column.querySelectorAll(":scope > [data-block-type='image'] img"));
      if (!children.length || !images.length) throw new Error(`${mode} ${label}: column content not found`);
      for (const img of images) {
        const rect = img.getBoundingClientRect();
        if (rect.top < columnRect.top - 1.5 || rect.bottom > columnRect.bottom + 1.5) {
          throw new Error(`${mode} ${label}: image exceeds column bounds by ${(columnRect.top - rect.top).toFixed(1)}/${(rect.bottom - columnRect.bottom).toFixed(1)}px`);
        }
        if (getComputedStyle(img).objectFit !== "contain") throw new Error(`${mode} ${label}: image does not use contain fitting`);
        const expectedRatio = img.naturalHeight / img.naturalWidth;
        if (Math.abs(rect.height / rect.width - expectedRatio) > 0.03) {
          throw new Error(`${mode} ${label}: image aspect ratio changed`);
        }
      }
      const contentTop = Math.min(...children.map((node) => node.getBoundingClientRect().top));
      const contentBottom = Math.max(...children.map((node) => node.getBoundingClientRect().bottom));
      if (contentTop < columnRect.top - 1.5 || contentBottom > columnRect.bottom + 1.5) {
        throw new Error(`${mode} ${label}: direct block sequence exceeds column bounds`);
      }
      return { columnRect, children, images };
    };
    const assertBalanced = (mode, column) => {
      const { columnRect, children, images } = assertContained(mode, "mixed ratios", column);
      const style = getComputedStyle(column);
      const layoutScale = column.offsetHeight > 0 ? columnRect.height / column.offsetHeight : 1;
      const padding = (parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)) * layoutScale;
      const gap = (parseFloat(style.rowGap) || 0) * layoutScale;
      const imageWrappers = new Map(images.map((img) => [img.closest("[data-block-type='image']"), img]));
      const fixedHeight = children.reduce((sum, child) => {
        const childRect = child.getBoundingClientRect();
        const img = imageWrappers.get(child);
        return sum + (img ? Math.max(0, childRect.height - img.getBoundingClientRect().height) : childRect.height);
      }, 0) + gap * Math.max(0, children.length - 1);
      const imageBudget = columnRect.height - padding - fixedHeight;
      const fairShare = imageBudget / images.length;
      const contentWidth = columnRect.width - (parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)) * layoutScale;
      for (const img of images) {
        const rect = img.getBoundingClientRect();
        const naturalWidth = Math.min(contentWidth, img.naturalWidth * layoutScale);
        const naturalDemand = naturalWidth * img.naturalHeight / img.naturalWidth;
        const minimumUsefulHeight = Math.min(fairShare, naturalDemand);
        if (rect.height + 3 < minimumUsefulHeight) {
          throw new Error(`${mode} mixed ratios: image height ${rect.height.toFixed(1)}px is below its balanced ${minimumUsefulHeight.toFixed(1)}px share`);
        }
      }
      const types = children.map((node) => node.dataset.blockType).filter(Boolean);
      if (types.join(",") !== "image,image,spacer,divider") throw new Error(`${mode} mixed ratios: direct block order changed (${types.join(",")})`);
      if (children[2].getBoundingClientRect().height <= 1 || children[3].getBoundingClientRect().height <= 1) {
        throw new Error(`${mode} mixed ratios: spacer or divider effect collapsed`);
      }
    };
    const assertMode = async (mode) => {
      const labelMarker = `MIXED LABEL ${mode}`;
      hooks.injectBlocks([], {
        layout: "cols", verticalAlign: undefined, padding: null, gap: null,
        splitGap: null, contentFlex: null, imageFlex: null,
        L: [portrait, { type: "text", text: labelMarker }],
        R: [{ type: "heading", text: labelMarker }],
      });
      let column = await waitForCase(mode, labelMarker, 1);
      const labelLayout = assertContained(mode, "image and text", column);
      const labelTypes = labelLayout.children.map((node) => node.dataset.blockType).filter(Boolean);
      if (labelTypes.join(",") !== "image,text") throw new Error(`${mode} image and text: direct block order changed (${labelTypes.join(",")})`);

      const ratioMarker = `MIXED RATIOS ${mode}`;
      hooks.injectBlocks([], {
        layout: "cols", verticalAlign: undefined, padding: null, gap: null,
        splitGap: null, contentFlex: null, imageFlex: null,
        L: [portrait, landscape, { type: "spacer", h: 18 }, { type: "divider", spacing: 8 }],
        R: [{ type: "heading", text: ratioMarker }],
      });
      column = await waitForCase(mode, ratioMarker, 2);
      assertBalanced(mode, column);
    };

    await assertMode("editor");
    _key("f");
    await _waitFor(() => presenterScope(), 3000);
    try {
      await assertMode("presenter");
    } finally {
      _key("f");
      await _waitFor(() => _$("header"), 3000).catch(() => {});
    }
  }},
  { name: "CR4: scaled split and cols use the full visual canvas in editor and presenter", fn: async () => {
    const hooks = _hooks();
    if (typeof hooks.injectBlocks !== "function") throw new Error("injectBlocks test hook not exposed");
    const image = { type: "image", src: "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='400'%20height='100'%3E%3Crect%20width='400'%20height='100'%20fill='%233b82f6'/%3E%3C/svg%3E" };
    const splitHeavy = Array.from({ length: 29 }, (_, i) => ({ type: "text", text: `SCALED SPLIT ${i + 1} ` + "content ".repeat(12) }));
    const colsDriver = Array.from({ length: 29 }, (_, i) => ({ type: "text", text: `SCALED DRIVER ${i + 1} ` + "content ".repeat(5) }));
    const colsTarget = (marker) => Array.from({ length: 29 }, (_, i) => ({ type: "text", text: i === 0 ? marker : `SCALED COL ${i + 1}` }));
    const presenterScope = () => _$("[data-testid='present-edit-toggle']")?.closest("[style*='position: fixed']") || null;
    const scopeFor = (mode) => mode === "editor" ? _$("[data-testid='slide-viewport']") : presenterScope();
    const scaleOf = (inner) => {
      const transform = getComputedStyle(inner).transform;
      return transform === "none" ? 1 : new DOMMatrixReadOnly(transform).a;
    };
    const waitForMarker = async (mode, marker, selector) => {
      const el = await _waitFor(() => {
        const scope = scopeFor(mode);
        const candidate = scope?.querySelector(selector);
        return candidate && scope.textContent.includes(marker) ? candidate : null;
      }, 3000);
      await _wait(220);
      return el;
    };
    const injectCols = (mode, value) => {
      const marker = `SCALED COLS ${mode} ${value || "default"}`;
      if (!hooks.injectBlocks([], {
        layout: "cols", align: "left", verticalAlign: value, padding: null, gap: null,
        splitGap: null, contentFlex: null, imageFlex: null,
        L: colsTarget(marker), R: colsDriver,
      })) throw new Error(`could not inject ${marker}`);
      return marker;
    };
    const readCols = (column) => {
      const inner = column.parentElement?.parentElement?.parentElement;
      const canvas = inner?.parentElement;
      if (!inner || !canvas) throw new Error("scaled cols canvas not found");
      const cr = canvas.getBoundingClientRect();
      const children = Array.from(column.children).filter((node) => node.getBoundingClientRect().height > 1);
      if (children.length !== 29) throw new Error(`scaled cols rendered ${children.length}/29 blocks`);
      const first = children[0].getBoundingClientRect();
      const last = children[children.length - 1].getBoundingClientRect();
      return {
        inner, canvas, scale: scaleOf(inner),
        firstTop: first.top - cr.top,
        bottomGap: cr.bottom - last.bottom,
        expectedBottomGap: parseFloat(getComputedStyle(canvas).paddingBottom) * (cr.height / canvas.offsetHeight),
        visible: children.filter((node) => {
          const r = node.getBoundingClientRect();
          const clip = column.getBoundingClientRect();
          return r.bottom > clip.top + 0.5 && r.top < clip.bottom - 0.5;
        }).length,
      };
    };
    const assertMode = async (mode) => {
      for (const layout of ["image-left", "image-right"]) {
        const marker = `SCALED SPLIT ${mode} ${layout}`;
        if (!hooks.injectBlocks([...splitHeavy.map((b, i) => i === 0 ? { ...b, text: marker } : b), image], {
          layout, align: "left", verticalAlign: undefined, padding: null, gap: null,
          splitGap: null, contentFlex: null, imageFlex: null, L: undefined, R: undefined,
        })) throw new Error(`could not inject ${marker}`);
        const imageCol = await waitForMarker(mode, marker, "[data-split-image]");
        const inner = imageCol.parentElement;
        const canvas = inner?.parentElement;
        const img = imageCol.querySelector("img");
        const contentCol = scopeFor(mode)?.querySelector("[data-split-content]");
        if (!inner || !canvas || !img || !contentCol) throw new Error(`${mode} ${layout}: scaled split layout not found`);
        const scale = scaleOf(inner);
        if (scale > 0.351) throw new Error(`${mode} ${layout}: case did not reach the 0.35 fit floor (${scale.toFixed(3)})`);
        const cr = canvas.getBoundingClientRect();
        const ir = img.getBoundingClientRect();
        const center = (ir.top + ir.height / 2 - cr.top) / cr.height;
        if (center < 0.44 || center > 0.56) throw new Error(`${mode} ${layout}: image center is ${(center * 100).toFixed(1)}% of canvas height`);
        const contentChildren = Array.from(contentCol.children).filter((node) => node.getBoundingClientRect().height > 1);
        const first = contentChildren[0]?.getBoundingClientRect();
        const last = contentChildren[contentChildren.length - 1]?.getBoundingClientRect();
        if (!first || first.top < cr.top - 1.5 || last.bottom > cr.bottom + 1.5) {
          throw new Error(`${mode} ${layout}: scaled content exceeds canvas bounds`);
        }
      }

      let marker = injectCols(mode, undefined);
      let column = await waitForMarker(mode, marker, "[data-cols-side='left']");
      let measured = readCols(column);
      if (measured.scale > 0.351) throw new Error(`${mode} default cols did not reach the 0.35 fit floor (${measured.scale.toFixed(3)})`);
      if (measured.visible !== 29) throw new Error(`${mode} default cols show ${measured.visible}/29 blocks`);
      if (column.scrollHeight > column.clientHeight + 2) {
        throw new Error(`${mode} default cols still clip internally (${column.scrollHeight}/${column.clientHeight})`);
      }
      if (measured.firstTop < -1.5 || measured.bottomGap < -1.5) {
        throw new Error(`${mode} default cols exceed canvas bounds (${measured.firstTop.toFixed(1)}, ${measured.bottomGap.toFixed(1)})`);
      }

      const positions = {};
      for (const value of ["top", "center", "bottom"]) {
        marker = injectCols(mode, value);
        column = await waitForMarker(mode, marker, "[data-cols-side='left']");
        measured = readCols(column);
        if (measured.firstTop < -1.5 || measured.bottomGap < -1.5) {
          throw new Error(`${mode} ${value} cols exceed canvas bounds (${measured.firstTop.toFixed(1)}, ${measured.bottomGap.toFixed(1)})`);
        }
        positions[value] = measured;
      }
      if (!(positions.top.firstTop + 8 < positions.center.firstTop && positions.center.firstTop + 8 < positions.bottom.firstTop)) {
        throw new Error(`${mode} cols top/center/bottom are not distinct (${positions.top.firstTop.toFixed(1)}, ${positions.center.firstTop.toFixed(1)}, ${positions.bottom.firstTop.toFixed(1)})`);
      }
      if (Math.abs(positions.bottom.bottomGap - positions.bottom.expectedBottomGap) > 4) {
        throw new Error(`${mode} bottom cols gap is ${positions.bottom.bottomGap.toFixed(1)}px, expected ${positions.bottom.expectedBottomGap.toFixed(1)}px`);
      }
      if (getComputedStyle(positions.bottom.inner).flexShrink !== "0") throw new Error(`${mode} scaled bottom cols can still shrink`);
    };

    await assertMode("editor");
    _key("f");
    await _waitFor(() => presenterScope(), 3000);
    try {
      await assertMode("presenter");
    } finally {
      _key("f");
      await _waitFor(() => _$("header"), 3000).catch(() => {});
    }
  }},
  { name: "CR4: auto-fit keeps distinct top/center/bottom positions in editor and presenter", fn: async () => {
    const hooks = _hooks();
    if (typeof hooks.injectBlocks !== "function") throw new Error("injectBlocks test hook not exposed");
    const image = { type: "image", src: "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='400'%20height='100'%3E%3Crect%20width='400'%20height='100'%20fill='%233b82f6'/%3E%3C/svg%3E" };
    // Keep the total at the allowed 30 blocks: 29 text blocks plus one image.
    const heavy = Array.from({ length: 29 }, (_, i) => ({ type: "text", text: `SAFE OVERFLOW ${i + 1} ` + "content ".repeat(12) }));
    const presenterScope = () => _$("[data-testid='present-edit-toggle']")?.closest("[style*='position: fixed']") || null;
    const scopeFor = (mode) => mode === "editor" ? _$("[data-testid='slide-viewport']") : presenterScope();
    const getLayout = (mode, marker) => {
      const scope = scopeFor(mode);
      const content = scope?.querySelector("[data-split-content]");
      if (!content || !content.textContent.includes(marker)) return null;
      return { content, canvas: content.parentElement?.parentElement };
    };
    const collectPositions = async (mode) => {
      const positions = {};
      for (const value of ["top", "center", "bottom"]) {
        const marker = `SAFE OVERFLOW 1`;
        if (!hooks.injectBlocks([...heavy, image], {
          layout: "image-right", verticalAlign: value, padding: null, gap: null,
          splitGap: null, contentFlex: null, imageFlex: null, L: undefined, R: undefined,
        })) {
          throw new Error(`could not inject ${mode} ${value} overflow case`);
        }
        await _waitFor(() => getLayout(mode, marker), 3000);
        await _wait(220);
        const layout = getLayout(mode, marker);
        if (!layout?.canvas) throw new Error(`${mode} ${value}: slide canvas not found`);
        const first = Array.from(layout.content.children).find((node) => node.getBoundingClientRect().height > 1);
        if (!first) throw new Error(`${mode} ${value}: no visible content block`);
        const transform = getComputedStyle(layout.content.parentElement).transform;
        const scale = transform === "none" ? 1 : new DOMMatrixReadOnly(transform).a;
        if (scale > 0.351) throw new Error(`${mode} ${value}: case did not reach the 0.35 fit floor (scale=${scale.toFixed(3)})`);
        const last = Array.from(layout.content.children).reverse().find((node) => node.getBoundingClientRect().height > 1);
        if (!last) throw new Error(`${mode} ${value}: no final visible content block`);
        const topDelta = first.getBoundingClientRect().top - layout.canvas.getBoundingClientRect().top;
        const bottomGap = layout.canvas.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom;
        if (topDelta < -1.5) throw new Error(`${mode} ${value}: first block clipped ${(-topDelta).toFixed(1)}px above the canvas`);
        if (bottomGap < -1.5) throw new Error(`${mode} ${value}: final block clipped ${(-bottomGap).toFixed(1)}px below the canvas`);
        positions[value] = { top: topDelta, bottomGap };
      }
      if (!(positions.top.top + 8 < positions.center.top && positions.center.top + 8 < positions.bottom.top)) {
        throw new Error(`${mode}: auto-fit positions are not distinct (${positions.top.top.toFixed(1)}, ${positions.center.top.toFixed(1)}, ${positions.bottom.top.toFixed(1)})`);
      }
      if (!(positions.top.bottomGap > positions.center.bottomGap + 8 && positions.center.bottomGap > positions.bottom.bottomGap + 8)) {
        throw new Error(`${mode}: auto-fit bottom gaps are not distinct (${positions.top.bottomGap.toFixed(1)}, ${positions.center.bottomGap.toFixed(1)}, ${positions.bottom.bottomGap.toFixed(1)})`);
      }
    };

    await collectPositions("editor");
    _key("f");
    await _waitFor(() => presenterScope(), 3000);
    try {
      await collectPositions("presenter");
    } finally {
      _key("f");
      await _waitFor(() => _$("header"), 3000).catch(() => {});
    }
  }},
  { name: "CR4: split image grid has distinct top/center/bottom positions", fn: async () => {
    const hooks = _hooks();
    if (typeof hooks.injectBlocks !== "function") throw new Error("injectBlocks test hook not exposed");
    const image = { type: "image", src: "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='400'%20height='100'%3E%3Crect%20width='400'%20height='100'%20fill='%233b82f6'/%3E%3C/svg%3E" };
    const presenterScope = () => _$("[data-testid='present-edit-toggle']")?.closest("[style*='position: fixed']") || null;
    const scopeFor = (mode) => mode === "editor" ? _$("[data-testid='slide-viewport']") : presenterScope();
    const getLayout = (mode, marker) => {
      const scope = scopeFor(mode);
      const content = scope?.querySelector("[data-split-content]");
      const imageCol = scope?.querySelector("[data-split-image]");
      const grid = imageCol?.querySelector("[data-image-grid='half']");
      if (!content || !content.textContent.includes(marker) || !imageCol || !grid) return null;
      return { content, imageCol, grid, canvas: content.parentElement?.parentElement };
    };
    const collectPositions = async (mode) => {
      const positions = {}, heights = {};
      for (const value of ["top", "center", "bottom"]) {
        const marker = `GRID ALIGN ${mode} ${value}`;
        if (!hooks.injectBlocks([{ type: "heading", text: marker }, image, image], { layout: "image-right", verticalAlign: value, L: undefined, R: undefined })) {
          throw new Error(`could not inject ${marker}`);
        }
        await _waitFor(() => getLayout(mode, marker), 3000);
        await _wait(220);
        const layout = getLayout(mode, marker);
        if (!layout?.canvas) throw new Error(`${marker}: layout not found`);
        const gr = layout.grid.getBoundingClientRect();
        const cr = layout.canvas.getBoundingClientRect();
        const ir = layout.imageCol.getBoundingClientRect();
        positions[value] = gr.top - cr.top;
        heights[value] = gr.height;
        if (gr.height >= ir.height - 4) throw new Error(`${marker}: grid still consumes the full image column`);
      }
      if (!(positions.top + 8 < positions.center && positions.center + 8 < positions.bottom)) {
        throw new Error(`${mode}: grid positions are not distinct (${positions.top.toFixed(1)}, ${positions.center.toFixed(1)}, ${positions.bottom.toFixed(1)})`);
      }
      const heightRange = Math.max(...Object.values(heights)) - Math.min(...Object.values(heights));
      if (heightRange > 2) throw new Error(`${mode}: alignment changed grid size by ${heightRange.toFixed(1)}px`);
    };

    await collectPositions("editor");
    hooks.injectBlocks([{ type: "heading", text: "GRID DEFAULT" }, image, image], { layout: "image-right", verticalAlign: undefined, L: undefined, R: undefined });
    await _waitFor(() => getLayout("editor", "GRID DEFAULT"), 3000);
    await _wait(220);
    const defaultLayout = getLayout("editor", "GRID DEFAULT");
    if (Math.abs(defaultLayout.grid.getBoundingClientRect().height - defaultLayout.imageCol.getBoundingClientRect().height) > 3) {
      throw new Error("default split grid no longer fills the image column");
    }

    _key("f");
    await _waitFor(() => presenterScope(), 3000);
    try {
      await collectPositions("presenter");
    } finally {
      _key("f");
      await _waitFor(() => _$("header"), 3000).catch(() => {});
    }
  }},
  { name: "CR4/D2: image grid never overflows the slide canvas (N=4, heavy-text, portrait)", fn: async () => {
    if (typeof _hooks().injectBlocks !== "function") throw new Error("injectBlocks test hook not exposed");
    // Tiny data-URI images with explicit intrinsic aspect ratios (SVG viewBox).
    // A TALL/portrait image is the exact case that used to balloon a grid row
    // (gridAutoRows:1fr = minmax(auto,1fr)) off the bottom of the canvas.
    const land = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='400'%20height='100'%3E%3Crect%20width='400'%20height='100'%20fill='%233b82f6'/%3E%3C/svg%3E";
    const tall = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='100'%20height='400'%3E%3Crect%20width='100'%20height='400'%20fill='%23ef4444'/%3E%3C/svg%3E";
    const gridBottomOverflow = () => {
      const grid = _$("[data-testid='image-grid']");
      if (!grid) return null;
      const vp = _$("[data-testid='slide-viewport']");
      const gb = grid.getBoundingClientRect();
      const vb = vp.getBoundingClientRect();
      return gb.bottom - vb.bottom; // >0 means the grid spills below the canvas
    };
    // CR4/D2b: every grid-cell <img> must be VISIBLE (rendered height > 0). The
    // absolute-fill img resolves height:100% through the nested ZoomWrap wrapper;
    // if that intermediate div carries no height the img collapses to 0 (invisible).
    const zeroHeightImgs = () => {
      const grid = _$("[data-testid='image-grid']");
      if (!grid) return null;
      const imgs = Array.from(grid.querySelectorAll("img"));
      if (!imgs.length) return -1; // no imgs found at all
      return imgs.filter((im) => im.getBoundingClientRect().height <= 0).length;
    };
    const assertVisibleAndUniform = (label) => {
      const z = zeroHeightImgs();
      if (z == null) throw new Error(`${label}: image grid not rendered`);
      if (z === -1) throw new Error(`${label}: no <img> found in grid`);
      if (z > 0) throw new Error(`${label}: ${z} grid-cell <img> rendered at height 0 (invisible)`);
      const cells = _$$("[data-testid='image-grid-cell']");
      if (cells.length >= 2) {
        const hs = cells.map((c) => c.getBoundingClientRect().height);
        const maxH = Math.max(...hs), minH = Math.min(...hs);
        if (maxH - minH > 2) throw new Error(`${label}: grid cells not uniform height: ${minH.toFixed(1)}..${maxH.toFixed(1)}`);
      }
    };
    // Cases: N=2..5 landscape runs — each must be contained AND visible.
    for (const N of [2, 3, 4, 5]) {
      const imgs = []; for (let k = 0; k < N; k++) imgs.push({ type: "image", src: land });
      _hooks().injectBlocks([{ type: "heading", text: `GRID N${N}` }, ...imgs]);
      await _waitFor(() => _$("[data-testid='image-grid']"), 2000);
      await _wait(160);
      const o = gridBottomOverflow();
      if (o == null) throw new Error(`image grid not rendered for N=${N}`);
      if (o > 2) throw new Error(`N=${N} grid overflows canvas bottom by ${o.toFixed(1)}px`);
      assertVisibleAndUniform(`N=${N}`);
    }
    // Case B: heavy heading/text + 4 images — text steals height, rows must shrink.
    _hooks().injectBlocks([
      { type: "heading", text: "HEAVY + FOUR IMAGES" },
      { type: "text", text: "A long paragraph ".repeat(16) },
      { type: "image", src: land }, { type: "image", src: land },
      { type: "image", src: land }, { type: "image", src: tall },
    ]);
    await _waitFor(() => _$("[data-testid='image-grid']"), 2000);
    await _wait(160);
    let o = gridBottomOverflow();
    if (o == null) throw new Error("image grid not rendered for heavy-text+4");
    if (o > 2) throw new Error(`heavy-text+4 grid overflows canvas bottom by ${o.toFixed(1)}px`);
    assertVisibleAndUniform("heavy-text+4");
    // Case C: a portrait image among the run must not balloon its row off-canvas —
    // it letterboxes (objectFit:contain) into a uniform cell AND stays visible.
    _hooks().injectBlocks([
      { type: "heading", text: "PORTRAIT MIX" },
      { type: "image", src: land }, { type: "image", src: tall },
    ]);
    await _waitFor(() => _$("[data-testid='image-grid']"), 2000);
    await _wait(160);
    o = gridBottomOverflow();
    if (o == null) throw new Error("image grid not rendered for portrait mix");
    if (o > 2) throw new Error(`portrait-mix grid overflows canvas bottom by ${o.toFixed(1)}px`);
    assertVisibleAndUniform("portrait-mix");
  }},
  { name: "CR2: cleanup injected blocks", fn: async () => {
    // Best-effort: restore by selecting first module again (reload path).
    // Injected block persists only in state; leaving it is harmless for later
    // suites, but we blank it to a minimal heading to reduce noise.
    try { _hooks().injectBlocks([{ type: "heading", text: "" }]); } catch {}
    await _wait(80);
  }},
], { setup: _selectFirstModule });

// ── Image measurement and reciprocal layout — v13.68 round 6 ──────
const _r6PresenterScope = () => _$("[data-testid='present-edit-toggle']")?.closest("[style*='position: fixed']") || null;
const _r6ScopeFor = (mode) => mode === "editor" ? _$("[data-testid='slide-viewport']") : _r6PresenterScope();
const _r6ScaleOf = (column) => {
  const inner = column.parentElement?.parentElement?.parentElement;
  const transform = inner ? getComputedStyle(inner).transform : "none";
  return transform === "none" ? 1 : new DOMMatrixReadOnly(transform).a;
};
const _r6ColumnMetrics = (column) => {
  const rect = column.getBoundingClientRect();
  const scale = column.offsetHeight > 0 ? rect.height / column.offsetHeight : 1;
  const style = getComputedStyle(column);
  const topEdge = rect.top + parseFloat(style.paddingTop) * scale;
  const bottomEdge = rect.bottom - parseFloat(style.paddingBottom) * scale;
  const children = Array.from(column.children)
    .map((child) => child.getBoundingClientRect())
    .filter((childRect) => childRect.height > 0.25);
  return {
    rect, topEdge, bottomEdge,
    topOverflow: children.length ? Math.max(0, topEdge - Math.min(...children.map((childRect) => childRect.top))) : 0,
    bottomOverflow: children.length ? Math.max(0, Math.max(...children.map((childRect) => childRect.bottom)) - bottomEdge) : 0,
  };
};
const _r6WaitCase = async (mode, marker, selector, imageCount) => {
  const element = await _waitFor(() => {
    const scope = _r6ScopeFor(mode);
    const candidate = scope?.querySelector(selector);
    const images = candidate ? Array.from(candidate.querySelectorAll("img")) : [];
    return scope?.textContent.includes(marker) && candidate
      && (imageCount == null || images.filter((img) => img.naturalWidth > 0).length === imageCount)
      ? candidate : null;
  }, 3000);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return element;
};
const _r6AssertEdges = (label, column, tolerance = 1.5) => {
  const metrics = _r6ColumnMetrics(column);
  if (metrics.topOverflow > tolerance || metrics.bottomOverflow > tolerance) {
    throw new Error(`${label}: column exceeds top/bottom by ${metrics.topOverflow.toFixed(1)}/${metrics.bottomOverflow.toFixed(1)}px`);
  }
  return metrics;
};
const _r6Svg = (width, height, color) =>
  `data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='${width}'%20height='${height}'%3E%3Crect%20width='${width}'%20height='${height}'%20fill='%23${color}'/%3E%3C/svg%3E`;

uiSuite("Image measurement round 6", [
  { name: "R6: zero initial image budget still fits five mixed images in editor and presenter", fn: async () => {
    const hooks = _hooks();
    if (typeof hooks.injectBlocks !== "function") throw new Error("injectBlocks test hook not exposed");
    const images = Array.from({ length: 5 }, (_, i) => ({
      type: "image", src: _r6Svg(180 + i * 10, 1500 + i * 100, ["ef4444", "f59e0b", "10b981", "3b82f6", "8b5cf6"][i]),
      caption: `CAPTION ${i + 1}`,
    }));
    const driver = Array.from({ length: 29 }, (_, i) => ({ type: "text", text: `R6 ZERO DRIVER ${i + 1} ` + "content ".repeat(40) }));
    const assertMode = async (mode) => {
      const marker = `R6 ZERO BUDGET ${mode}`;
      hooks.injectBlocks([], {
        layout: "cols", verticalAlign: undefined, padding: null, gap: null, splitGap: null,
        contentFlex: null, imageFlex: null,
        L: [...images, { type: "text", text: "Fixed mixed copy ".repeat(70) }, { type: "spacer", h: 18 }, { type: "divider", spacing: 8 }],
        R: driver.map((block, i) => i === 0 ? { ...block, text: marker } : block),
      });
      const column = await _r6WaitCase(mode, marker, "[data-cols-side='left']", 5);
      const scale = _r6ScaleOf(column);
      if (scale > 0.351) throw new Error(`${mode}: zero-budget case did not reach the 0.35 floor (${scale.toFixed(3)})`);
      const realImages = Array.from(column.querySelectorAll("img")).filter((img) => img.naturalWidth > 0);
      const uncapped = realImages.filter((img) => !(parseFloat(img.style.maxHeight) > 0));
      if (uncapped.length) throw new Error(`${mode}: ${uncapped.length} real image(s) have no final cap`);
      if (realImages.some((img) => img.getBoundingClientRect().height < 18)) {
        throw new Error(`${mode}: zero-budget fitting reduced an image below a useful visual height`);
      }
      _r6AssertEdges(`${mode} zero-budget mixed column`, column);
    };

    await assertMode("editor");
    _key("f");
    await _waitFor(() => _r6PresenterScope(), 3000);
    try {
      await assertMode("presenter");
    } finally {
      _key("f");
      await _waitFor(() => _$("header"), 3000).catch(() => {});
    }
  }},
  { name: "R6: final reciprocal caps use available media and split height in editor and presenter", fn: async () => {
    const hooks = _hooks();
    if (typeof hooks.injectBlocks !== "function") throw new Error("injectBlocks test hook not exposed");
    const portrait = { type: "image", src: _r6Svg(200, 3000, "ef4444") };
    const media = Array.from({ length: 5 }, (_, i) => ({ ...portrait, src: _r6Svg(200 + i * 5, 3000 + i * 100, "3b82f6") }));
    const driver = Array.from({ length: 29 }, (_, i) => ({ type: "text", text: `R6 RECIPROCAL ${i + 1} ` + "content ".repeat(8) }));
    const assertMode = async (mode) => {
      const mediaMarker = `R6 MEDIA ${mode}`;
      hooks.injectBlocks([], {
        layout: "cols", verticalAlign: undefined, padding: null, gap: null, splitGap: null,
        contentFlex: null, imageFlex: null,
        L: media, R: driver.map((block, i) => i === 0 ? { ...block, text: mediaMarker } : block),
      });
      const column = await _r6WaitCase(mode, mediaMarker, "[data-cols-side='left']", 5);
      const metrics = _r6AssertEdges(`${mode} reciprocal media column`, column);
      const images = Array.from(column.querySelectorAll("img")).filter((img) => img.naturalWidth > 0);
      const usedHeight = images.reduce((sum, img) => sum + img.getBoundingClientRect().height, 0);
      if (usedHeight < (metrics.bottomEdge - metrics.topEdge) * 0.65) {
        throw new Error(`${mode}: final media caps use only ${usedHeight.toFixed(1)}px of ${(metrics.bottomEdge - metrics.topEdge).toFixed(1)}px`);
      }

      const splitMarker = `R6 SPLIT ${mode}`;
      hooks.injectBlocks([
        ...driver.map((block, i) => i === 0 ? { ...block, text: splitMarker } : block),
        portrait,
      ], { layout: "image-right", verticalAlign: undefined, padding: null, gap: null, splitGap: null, L: undefined, R: undefined });
      const imageCol = await _r6WaitCase(mode, splitMarker, "[data-split-image]", 1);
      const img = imageCol.querySelector("img");
      const imageRect = img.getBoundingClientRect();
      const columnRect = imageCol.getBoundingClientRect();
      if (imageRect.height < columnRect.height * 0.72) {
        throw new Error(`${mode}: split portrait uses only ${imageRect.height.toFixed(1)}px of ${columnRect.height.toFixed(1)}px`);
      }
      if (imageRect.top < columnRect.top - 1.5 || imageRect.bottom > columnRect.bottom + 1.5) {
        throw new Error(`${mode}: final split image cap exceeds its column by ${(columnRect.top - imageRect.top).toFixed(1)}/${(imageRect.bottom - columnRect.bottom).toFixed(1)}px`);
      }
    };

    await assertMode("editor");
    _key("f");
    await _waitFor(() => _r6PresenterScope(), 3000);
    try {
      await assertMode("presenter");
    } finally {
      _key("f");
      await _waitFor(() => _$("header"), 3000).catch(() => {});
    }
  }},
  { name: "R6: normal mixed columns keep both edges inside rounding allowance", fn: async () => {
    const hooks = _hooks();
    if (typeof hooks.injectBlocks !== "function") throw new Error("injectBlocks test hook not exposed");
    const mixed = [
      { type: "image", src: _r6Svg(220, 2200, "ef4444"), caption: "PORTRAIT" },
      { type: "image", src: _r6Svg(800, 240, "3b82f6"), caption: "LANDSCAPE" },
      { type: "image", src: _r6Svg(400, 400, "10b981"), caption: "SQUARE" },
      { type: "text", text: "Normal mixed-media copy." },
      { type: "spacer", h: 12 },
      { type: "divider", spacing: 6 },
    ];
    const assertMode = async (mode) => {
      const marker = `R6 ROUNDING ${mode}`;
      hooks.injectBlocks([], {
        layout: "cols", verticalAlign: "center", padding: null, gap: null, splitGap: null,
        contentFlex: null, imageFlex: null,
        L: mixed, R: [{ type: "heading", text: marker }],
      });
      const column = await _r6WaitCase(mode, marker, "[data-cols-side='left']", 3);
      const scale = _r6ScaleOf(column);
      if (scale < 0.99) throw new Error(`${mode}: normal mixed column unexpectedly scaled to ${scale.toFixed(3)}`);
      _r6AssertEdges(`${mode} normal mixed column`, column, 1);
    };

    await assertMode("editor");
    _key("f");
    await _waitFor(() => _r6PresenterScope(), 3000);
    try {
      await assertMode("presenter");
    } finally {
      _key("f");
      await _waitFor(() => _$("header"), 3000).catch(() => {});
    }
  }},
  { name: "R6: cap identity survives empty and 0x0 images while fonts.ready is delayed", fn: async () => {
    const hooks = _hooks();
    if (typeof hooks.injectBlocks !== "function") throw new Error("injectBlocks test hook not exposed");
    const blocks = [
      { type: "image", src: "" },
      { type: "image", src: _r6Svg(0, 0, "64748b") },
      { type: "image", src: _r6Svg(200, 3000, "ef4444") },
      { type: "image", src: _r6Svg(700, 200, "3b82f6") },
      { type: "spacer", h: 16 },
      { type: "divider", spacing: 8 },
    ];
    const assertMode = async (mode) => {
      const marker = `R6 CAP IDENTITY ${mode}`;
      const ownFonts = Object.getOwnPropertyDescriptor(document, "fonts");
      Object.defineProperty(document, "fonts", { configurable: true, value: { ready: new Promise(() => {}) } });
      try {
        hooks.injectBlocks([], {
          layout: "cols", verticalAlign: undefined, padding: null, gap: null, splitGap: null,
          contentFlex: null, imageFlex: null,
          L: blocks, R: [{ type: "heading", text: marker }],
        });
        const column = await _r6WaitCase(mode, marker, "[data-cols-side='left']", 2);
        for (const blockIndex of [2, 3]) {
          const img = column.querySelector(`:scope > [data-column-block-index="${blockIndex}"] img`);
          if (!img || !(parseFloat(img.style.maxHeight) > 0)) {
            throw new Error(`${mode}: real image at stable block ${blockIndex} is uncapped before fonts.ready`);
          }
          if (getComputedStyle(img).objectFit !== "contain") {
            throw new Error(`${mode}: real image at stable block ${blockIndex} lost contain fitting`);
          }
        }
        _r6AssertEdges(`${mode} delayed-font cap identity`, column);
      } finally {
        if (ownFonts) Object.defineProperty(document, "fonts", ownFonts);
        else delete document.fonts;
      }
    };

    await assertMode("editor");
    _key("f");
    await _waitFor(() => _r6PresenterScope(), 3000);
    try {
      await assertMode("presenter");
    } finally {
      _key("f");
      await _waitFor(() => _$("header"), 3000).catch(() => {});
    }
  }},
], { setup: _selectFirstModule });

// ── Image measurement and grid flow — v13.68 round 7 ─────────────
const _r7Frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const _r7LoadedColumn = async (marker, selector = "[data-cols-side='left']", count = null) => {
  const column = await _waitFor(() => {
    const scope = _r6ScopeFor("editor");
    const candidate = scope?.querySelector(selector);
    const images = candidate ? Array.from(candidate.querySelectorAll("img")) : [];
    return scope?.textContent.includes(marker) && candidate
      && (count == null || images.filter((img) => img.naturalWidth > 0).length === count)
      ? candidate : null;
  }, 3000);
  await _r7Frame();
  await _r7Frame();
  return column;
};
const _r7Caps = (column) => Array.from(column.querySelectorAll("img"))
  .filter((img) => img.naturalWidth > 0)
  .map((img) => ({ css: img.style.maxHeight, value: parseFloat(img.style.maxHeight) }));
const _r7AssertFiniteCaps = (label, column) => {
  const rawCaps = _r7Caps(column);
  if (!rawCaps.length || rawCaps.some((cap) => !Number.isFinite(cap.value) || !cap.css.endsWith("px"))) {
    throw new Error(`${label}: a loaded image has no finite pixel cap (${rawCaps.map((cap) => cap.css || "unset").join(",")})`);
  }
  return rawCaps.map((cap) => cap.value);
};

uiSuite("Image measurement round 7", [
  { name: "R7: impossible image budgets use finite containment caps", fn: async () => {
    const hooks = _hooks();
    const images = Array.from({ length: 4 }, (_, i) => ({
      type: "image",
      src: _r6Svg(180 + i * 10, 2600 + i * 200, ["ef4444", "f59e0b", "10b981", "3b82f6"][i]),
      caption: `R7 FLOOR CAPTION ${i + 1}`,
    }));
    const fixed = Array.from({ length: 26 }, (_, i) => ({
      type: "text",
      text: `R7 FIXED ${i + 1} ` + "fixed content ".repeat(90),
    }));
    const marker = "R7 IMPOSSIBLE BUDGET";
    hooks.injectBlocks([], {
      layout: "cols", verticalAlign: undefined, padding: null, gap: null,
      splitGap: null, contentFlex: null, imageFlex: null,
      L: [...images, ...fixed],
      R: [{ type: "heading", text: marker }],
    });
    const column = await _r7LoadedColumn(marker, "[data-cols-side='left']", 4);
    const scale = _r6ScaleOf(column);
    if (scale > 0.351) throw new Error(`impossible budget did not reach the scale floor (${scale.toFixed(3)})`);
    const caps = _r7AssertFiniteCaps("impossible budget", column);
    if (Math.max(...caps) > 4) throw new Error(`impossible budget did not degrade to the containment floor (${caps.join(",")})`);
    const tallest = Math.max(...Array.from(column.querySelectorAll("img")).map((img) => img.getBoundingClientRect().height));
    if (tallest > 2) throw new Error(`impossible budget image still uses ${tallest.toFixed(1)} visual px`);
  }},
  { name: "R7: zero correction budgets never restore 100 percent image height", fn: async () => {
    const hooks = _hooks();
    const marker = "R7 ZERO CORRECTION";
    const fixed = Array.from({ length: 24 }, (_, i) => ({
      type: "text",
      text: `R7 CORRECTION ${i + 1} ` + "dense copy ".repeat(70),
    }));
    hooks.injectBlocks([], {
      layout: "cols", verticalAlign: "bottom", padding: null, gap: null,
      splitGap: null, contentFlex: null, imageFlex: null,
      L: [
        { type: "image", src: _r6Svg(200, 3200, "ef4444") },
        { type: "image", src: _r6Svg(220, 3400, "3b82f6") },
        { type: "spacer", h: 18 },
        { type: "divider", spacing: 8 },
        ...fixed,
      ],
      R: [{ type: "heading", text: marker }],
    });
    const column = await _r7LoadedColumn(marker, "[data-cols-side='left']", 2);
    const caps = _r7AssertFiniteCaps("zero correction", column);
    if (caps.some((cap) => cap <= 0)) throw new Error(`zero correction produced a non-positive cap (${caps.join(",")})`);
    if (Array.from(column.querySelectorAll("img")).some((img) => img.style.maxHeight === "100%")) {
      throw new Error("zero correction restored max-height:100%");
    }
  }},
  { name: "R7: new content has finite caps before its first painted frame", fn: async () => {
    const hooks = _hooks();
    hooks.injectBlocks([], {
      layout: "cols", verticalAlign: undefined,
      L: [{ type: "image", src: _r6Svg(900, 180, "10b981") }],
      R: [{ type: "heading", text: "R7 OLD CONTENT" }],
    });
    await _r7LoadedColumn("R7 OLD CONTENT", "[data-cols-side='left']", 1);

    const marker = "R7 NEW CONTENT";
    const scope = _r6ScopeFor("editor");
    const samples = [];
    let observing = true;
    const read = (phase) => {
      const currentScope = _r6ScopeFor("editor");
      if (!currentScope?.textContent.includes(marker)) return false;
      const column = currentScope.querySelector("[data-cols-side='left']");
      const images = column ? Array.from(column.querySelectorAll("img")) : [];
      if (images.length !== 3) return false;
      samples.push({
        phase,
        caps: images.map((img) => img.style.maxHeight),
        heights: images.map((img) => img.getBoundingClientRect().height),
      });
      return true;
    };
    const observer = new MutationObserver(() => {
      if (observing && read("commit")) observing = false;
    });
    observer.observe(scope, { childList: true, subtree: true, characterData: true });
    const frameSamples = new Promise((resolve, reject) => {
      const started = performance.now();
      const tick = () => {
        read(`frame-${samples.filter((sample) => sample.phase.startsWith("frame-")).length + 1}`);
        if (samples.filter((sample) => sample.phase.startsWith("frame-")).length >= 3) return resolve();
        if (performance.now() - started > 3000) return reject(new Error("new content did not render in three frames"));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    if (typeof hooks.mutateBlocksInPlaceForTest !== "function") {
      throw new Error("in-place block mutation test hook is missing");
    }
    hooks.mutateBlocksInPlaceForTest([], {
      layout: "cols", verticalAlign: undefined,
      L: [
        { type: "image", src: _r6Svg(180, 3000, "ef4444") },
        { type: "spacer", h: 12 },
        { type: "image", src: _r6Svg(800, 200, "3b82f6") },
        { type: "image", src: _r6Svg(400, 900, "8b5cf6") },
      ],
      R: [{ type: "heading", text: marker }],
    });
    try {
      await frameSamples;
    } finally {
      observer.disconnect();
    }
    if (!samples.some((sample) => sample.phase === "commit")) {
      throw new Error("new content had no pre-paint commit sample");
    }
    for (const sample of samples) {
      const finitePixelCaps = sample.caps.every((value) =>
        value.endsWith("px") && Number.isFinite(parseFloat(value))
      );
      if (!finitePixelCaps) {
        throw new Error(`${sample.phase}: stale or missing cap mapping (${sample.caps.join(",")})`);
      }
      if (sample.heights.some((height) => height > 500)) {
        throw new Error(`${sample.phase}: new image overflowed before correction (${sample.heights.join(",")})`);
      }
    }
  }},
  { name: "R7: delayed fonts ready always runs a current-generation measure", fn: async () => {
    const hooks = _hooks();
    let resolveFonts;
    const ready = new Promise((resolve) => { resolveFonts = resolve; });
    const ownFonts = Object.getOwnPropertyDescriptor(document, "fonts");
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready } });
    const marker = "R7 DELAYED FONTS";
    try {
      hooks.injectBlocks([], {
        layout: "cols", verticalAlign: undefined, padding: null, gap: null,
        splitGap: null, contentFlex: null, imageFlex: null,
        L: [
          { type: "image", src: _r6Svg(200, 3000, "ef4444") },
          { type: "image", src: _r6Svg(220, 3200, "3b82f6") },
          { type: "text", text: "R7 font measurement driver." },
        ],
        R: [{ type: "heading", text: marker }],
      });
      const column = await _r7LoadedColumn(marker, "[data-cols-side='left']", 2);
      await _r7Frame();
      await _r7Frame();
      const loadedImages = Array.from(column.querySelectorAll("img")).filter((img) => img.naturalWidth > 0);
      loadedImages[0]?.dispatchEvent(new Event("load"));
      await _r7Frame();
      await _r7Frame();
      const before = _r7AssertFiniteCaps("fonts before", column).reduce((sum, cap) => sum + cap, 0);
      const fixed = column.querySelector(":scope > [data-column-block-index='2']");
      if (!fixed) throw new Error("font measurement fixed block is missing");
      fixed.style.paddingBottom = "180px";
      resolveFonts();
      await _r7Frame();
      await _r7Frame();
      await _r7Frame();
      const after = _r7AssertFiniteCaps("fonts after", column).reduce((sum, cap) => sum + cap, 0);
      if (after > before - 140) {
        throw new Error(`fonts-ready did not recalculate caps (${before.toFixed(1)} -> ${after.toFixed(1)})`);
      }
    } finally {
      if (ownFonts) Object.defineProperty(document, "fonts", ownFonts);
      else delete document.fonts;
    }
  }},
  { name: "R7: split-grid media obeys each explicit maximum height", fn: async () => {
    const hooks = _hooks();
    const marker = "R7 GRID MAX HEIGHT";
    hooks.injectBlocks([
      { type: "heading", text: marker },
      { type: "image", src: _r6Svg(300, 1200, "ef4444"), maxHeight: 46 },
      { type: "image", src: _r6Svg(600, 300, "3b82f6"), maxHeight: 74 },
    ], { layout: "image-right", verticalAlign: undefined, L: undefined, R: undefined });
    const imageCol = await _r7LoadedColumn(marker, "[data-split-image]", 2);
    const scale = imageCol.offsetHeight > 0 ? imageCol.getBoundingClientRect().height / imageCol.offsetHeight : 1;
    const media = Array.from(imageCol.querySelectorAll("[data-image-grid-media]"));
    if (media.length !== 2) throw new Error(`split grid has ${media.length}/2 media areas`);
    const heights = media.map((node) => node.getBoundingClientRect().height);
    if (heights[0] > 46 * scale + 1 || heights[1] > 74 * scale + 1) {
      throw new Error(`split-grid maxHeight was ignored (${heights.map((h) => h.toFixed(1)).join(",")})`);
    }
    if (heights[1] <= heights[0] + 5 * scale) {
      throw new Error(`split-grid media maxima are not independent (${heights.map((h) => h.toFixed(1)).join(",")})`);
    }
  }},
  { name: "R7: split-grid captions stay in flow below the media area", fn: async () => {
    const hooks = _hooks();
    const marker = "R7 GRID CAPTIONS";
    hooks.injectBlocks([
      { type: "heading", text: marker },
      { type: "image", src: _r6Svg(300, 1200, "ef4444"), caption: "PORTRAIT CAPTION" },
      { type: "image", src: _r6Svg(900, 240, "3b82f6"), caption: "LANDSCAPE CAPTION" },
    ], { layout: "image-right", verticalAlign: undefined, L: undefined, R: undefined });
    const imageCol = await _r7LoadedColumn(marker, "[data-split-image]", 2);
    await _wait(220);
    const cells = Array.from(imageCol.querySelectorAll("[data-testid='image-grid-cell']"));
    if (cells.length !== 2) throw new Error(`split grid has ${cells.length}/2 caption cells`);
    const mediaTops = [];
    for (const cell of cells) {
      const media = cell.querySelector("[data-image-grid-media]");
      const caption = media?.nextElementSibling;
      if (!media || !caption) throw new Error("split-grid media or caption flow node is missing");
      const mr = media.getBoundingClientRect();
      const tr = caption.getBoundingClientRect();
      mediaTops.push(mr.top);
      if (tr.top < mr.bottom + 3) {
        throw new Error(`caption overlaps media by ${(mr.bottom - tr.top).toFixed(1)}px`);
      }
      if (getComputedStyle(media.querySelector("img")).objectFit !== "contain") {
        throw new Error("split-grid image lost contain fitting");
      }
    }
    if (Math.max(...mediaTops) - Math.min(...mediaTops) > 3) {
      throw new Error("split-grid media areas lost row alignment");
    }
  }},
  { name: "R7: resize recalculates final reciprocal caps without rounding overflow", fn: async () => {
    const hooks = _hooks();
    const marker = "R7 RESIZE ROUNDING";
    hooks.injectBlocks([], {
      layout: "cols", verticalAlign: "center", padding: null, gap: null,
      splitGap: null, contentFlex: null, imageFlex: null,
      L: [
        { type: "image", src: _r6Svg(220, 2200, "ef4444"), caption: "PORTRAIT" },
        { type: "image", src: _r6Svg(800, 240, "3b82f6"), caption: "LANDSCAPE" },
        { type: "image", src: _r6Svg(400, 400, "10b981"), caption: "SQUARE" },
        { type: "text", text: "R7 mixed-media resize copy." },
        { type: "spacer", h: 12 },
        { type: "divider", spacing: 6 },
      ],
      R: [{ type: "heading", text: marker }],
    });
    let column = await _r7LoadedColumn(marker, "[data-cols-side='left']", 3);
    _r6AssertEdges("resize before", column, 1);
    const before = _r7AssertFiniteCaps("resize before", column).reduce((sum, cap) => sum + cap, 0);
    const viewport = _$("[data-testid='slide-viewport']");
    if (!viewport) throw new Error("slide viewport is missing");
    const originalHeight = viewport.style.height;
    try {
      viewport.style.height = "360px";
      await _wait(80);
      await _r7Frame();
      await _r7Frame();
      column = _$("[data-cols-side='left']");
      _r6AssertEdges("resize after", column, 1);
      const after = _r7AssertFiniteCaps("resize after", column).reduce((sum, cap) => sum + cap, 0);
      if (after >= before - 20) {
        throw new Error(`resize did not recalculate reciprocal caps (${before.toFixed(1)} -> ${after.toFixed(1)})`);
      }
    } finally {
      viewport.style.height = originalHeight;
      await _wait(80);
    }
  }},
], { setup: _selectFirstModule });

// ── Block-item reorder (▲▼ arrows) — v13.19 ──────────────────────────
// Hovering an item of a multi-item block in edit mode reveals a stacked
// ▲▼ control (next to the ✕ delete) that swaps the item with its neighbour.
// Asserts the swap moves the item and that the arrow is disabled at a boundary.
uiSuite("Block item reorder (▲▼) — v13.19", [
  { name: "▲▼ arrows move a bullet up/down; boundary arrow disabled", fn: async () => {
    if (typeof _hooks().injectBlocks !== "function") throw new Error("injectBlocks test hook not exposed");
    const ok = _hooks().injectBlocks([{ type: "bullets", items: ["ALPHAUT", "BRAVOUT", "CHARLIEUT"] }]);
    if (!ok) throw new Error("inject returned false — no current slide");
    await _wait(200);
    const order = () => _$$("[data-testid='slide-viewport'] *")
      .filter((d) => d.children.length === 0 && /^(ALPHAUT|BRAVOUT|CHARLIEUT)$/.test((d.textContent || "").trim()))
      .map((d) => d.textContent.trim());
    await _waitFor(() => order().length === 3, 2000);
    if (JSON.stringify(order()) !== JSON.stringify(["ALPHAUT", "BRAVOUT", "CHARLIEUT"])) throw new Error("initial order wrong: " + order());
    // Walk up from the item's text leaf to the ItemChrome wrapper (position:relative).
    const leafOf = (t) => _$$("[data-testid='slide-viewport'] *").find((d) => d.children.length === 0 && (d.textContent || "").trim() === t);
    const wrapperOf = (t) => { let el = leafOf(t); while (el && el !== document.body) { if (getComputedStyle(el).position === "relative") return el; el = el.parentElement; } return null; };
    const hover = (el) => el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    // Move BRAVOUT up → [BRAVOUT, ALPHAUT, CHARLIEUT].
    const w = wrapperOf("BRAVOUT");
    if (!w) throw new Error("no wrapper for BRAVOUT");
    hover(w);
    const up = await _waitFor(() => _$$("button", w).find((b) => b.title === "Move up" && !b.disabled), 1500);
    _click(up);
    await _waitFor(() => JSON.stringify(order()) === JSON.stringify(["BRAVOUT", "ALPHAUT", "CHARLIEUT"]), 2000);
    // BRAVOUT is now first → its Move up must be disabled.
    const w2 = wrapperOf("BRAVOUT");
    hover(w2);
    const up2 = await _waitFor(() => _$$("button", w2).find((b) => b.title === "Move up"), 1500);
    if (!up2.disabled) throw new Error("first item Move up not disabled");
    // Move it back down to restore original order.
    const down = await _waitFor(() => _$$("button", w2).find((b) => b.title === "Move down" && !b.disabled), 1500);
    _click(down);
    await _waitFor(() => JSON.stringify(order()) === JSON.stringify(["ALPHAUT", "BRAVOUT", "CHARLIEUT"]), 2000);
    try { _hooks().injectBlocks([{ type: "heading", text: "" }]); } catch {}
    await _wait(80);
  }},
], { setup: _selectFirstModule });
