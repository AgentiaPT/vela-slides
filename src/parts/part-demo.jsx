// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
// ━━━ Vela Product Tour ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// A short, safe tour of the live app. Its Vera turn uses a local deterministic
// response. It does not call live AI, write files, start an export, or open a link.

const DEMO_MIN_DURATION_MS = 60000;
const DEMO_MAX_DURATION_MS = 120000;
const DEMO_AI_READY_TIMEOUT_MS = 6000;
// Baseline for the "NEW" badges below — every badged feature must post-date this version.
const DEMO_BASELINE_VERSION = "13.0";
const DEMO_DISCLOSURE = "Vela Slides is a Dark Software Factory experiment. Code is written and reviewed by AI models.";
const DEMO_SCENE_ORDER = Object.freeze([
  "Vela Slides",
  "Shape the Story",
  "Edit Text, Live",
  "Show a Process",
  "Explain the Data",
  "Compare, Funnel & Cycle",
  "Numbers, Matrix & Checklist",
  "Rich Column Layouts",
  "See the Whole Deck",
  "Brand & Guidelines",
  "Comment & Review",
  "Present with Confidence",
  "Student & Audience Tools",
  "Use the Presenter Dashboard",
  "Improve, Edit with AI & Variants",
  "Work with Vera",
  "Vela CLI & Skill",
  "Bring Your Own Agent",
  "Export a Print-Ready PDF",
  "Export Editable PowerPoint",
  "Ready to Build",
]);
const DEMO_AI_PROMPT = "Review this demo deck and summarize its product story.";
const DEMO_AI_RESPONSE = "I checked the live deck structure. The story moves from the Vela overview through semantic blocks, editing, presentation tools, AI features, and export.";
const DEMO_EDIT_TEXT = "Text, Bullets & Quotes — edited live";
// Tested feature metadata for the compact "NEW" badges — every entry names a scene
// in DEMO_SCENE_ORDER and a version confirmed present, word-for-word verifiable,
// in VELA_CHANGELOG (see tests/test_vela.py::test_product_tour for the check).
const DEMO_FEATURE_BADGES = Object.freeze([
  { scene: "Shape the Story", version: "13.12", label: "Multi-select & cross-deck copy/paste" },
  { scene: "Numbers, Matrix & Checklist", version: "13.19", label: "Reorder items in a block" },
  { scene: "Rich Column Layouts", version: "13.20", label: "Balanced multi-image layouts" },
  { scene: "See the Whole Deck", version: "13.20", label: "Gallery section title cards" },
  { scene: "Present with Confidence", version: "13.18", label: "Edit while presenting" },
  { scene: "Bring Your Own Agent", version: "13.20", label: "Desktop save reliability" },
]);
const _demoBadgeFor = (title) => DEMO_FEATURE_BADGES.find((b) => b.scene === title) || null;

// The single source of truth for "what does the tour showcase". One entry per
// distinct verified cue (see _demoCue calls below and the matching checks in
// part-uitest2.jsx). tools/vela-dev/scripts/demo-map.py reads this array to
// generate src/parts/DEMO_MAP.md and to run `--check` (wired into
// tests/test_vela.py). Keep field order fixed — the generator parses it with
// a plain regex, not a JS engine. `deckSlide: null` means the cue does not
// select a specific slide (it acts on whatever the prior scene left selected,
// or on a whole-deck surface like the gallery or an export modal).
const DEMO_FEATURES = Object.freeze([
  { id: "outline", title: "Shape the Story", introduced: "13.12", isNew: true, deckSlide: "What is Vela?", testId: "[data-testid='toc-tree']", cue: "outline", action: "Expand the outline and open a slide.", assertion: "Outline tree is visible.", cleanup: "Next scene's _demoReset.", safety: "safe" },
  { id: "inline-edit", title: "Edit Text, Live", introduced: "13.0", isNew: false, deckSlide: "Text Blocks", testId: "[contenteditable='true']", cue: "inline-edit", action: "Type corrected text into the slide heading, then cancel.", assertion: "The editable heading shows the typed text before Escape reverts it.", cleanup: "_demoKey('Escape') cancels the edit.", safety: "safe" },
  { id: "flow", title: "Show a Process", introduced: "13.0", isNew: false, deckSlide: "Flows & Loops", testId: "[data-block-type='flow']", cue: "flow", action: "Open the Flows & Loops slide.", assertion: "A flow block is visible.", cleanup: "Next scene's _demoReset.", safety: "safe" },
  { id: "data", title: "Explain the Data", introduced: "13.0", isNew: false, deckSlide: "Data Blocks", testId: "[data-block-type='table']", cue: "data", action: "Open the Data Blocks slide.", assertion: "A table block is visible.", cleanup: "Next scene's _demoReset.", safety: "safe" },
  { id: "layouts-1", title: "Compare, Funnel & Cycle", introduced: "13.0", isNew: false, deckSlide: "Comparison, Funnel & Cycle", testId: "text:Visitors,Describe", cue: "layouts-1", action: "Open the Comparison, Funnel & Cycle slide.", assertion: "Page text shows the comparison and funnel content.", cleanup: "Next scene's _demoReset.", safety: "safe" },
  { id: "layouts-2", title: "Numbers, Matrix & Checklist", introduced: "13.19", isNew: true, deckSlide: "Number Row, Matrix & Checklist", testId: "text:Quick Wins,Comparison block", cue: "layouts-2", action: "Open the Number Row, Matrix & Checklist slide.", assertion: "Page text shows the matrix and checklist content.", cleanup: "Next scene's _demoReset.", safety: "safe" },
  { id: "columns", title: "Rich Column Layouts", introduced: "13.20", isNew: true, deckSlide: "Columns Layout", testId: "[data-block-type='badge']", cue: "columns", action: "Open the Columns Layout slide.", assertion: "A badge block is visible.", cleanup: "Next scene's _demoReset.", safety: "safe" },
  { id: "gallery", title: "See the Whole Deck", introduced: "13.20", isNew: true, deckSlide: null, testId: "[data-testid='gallery-close']", cue: "gallery", action: "Open the slide gallery.", assertion: "The gallery panel is open.", cleanup: "Closed by the smart-merge jump in the same scene.", safety: "safe" },
  { id: "smart-merge", title: "See the Whole Deck", introduced: "13.0", isNew: false, deckSlide: "Gallery View & Smart Merge", testId: "text:Smart Merge", cue: "smart-merge", action: "Click the Smart Merge card in the gallery to jump to it.", assertion: "The gallery closes and the Smart Merge slide is visible.", cleanup: "Gallery already closed by the jump; next scene's _demoReset restores selection.", safety: "safe" },
  { id: "branding", title: "Brand & Guidelines", introduced: "13.0", isNew: false, deckSlide: "Branding & Theming", testId: "[data-testid='brand-toggle']", cue: "branding", action: "Open the branding panel.", assertion: "The branding toggle shows its active state.", cleanup: "try/finally re-clicks brand-toggle.", safety: "safe" },
  { id: "comments", title: "Comment & Review", introduced: "13.0", isNew: false, deckSlide: null, testId: "[data-testid='comments-toggle']", cue: "comments", action: "Turn on review mode.", assertion: "Review mode is active.", cleanup: "try/finally exits review mode and closes the comments panel.", safety: "safe" },
  { id: "present", title: "Present with Confidence", introduced: "13.18", isNew: true, deckSlide: "Navigate & Present", testId: "[data-testid='present-edit-toggle']", cue: "present", action: "Enter fullscreen present mode and toggle live edit.", assertion: "The present-mode edit toggle is visible.", cleanup: "The presenter scene exits fullscreen at its end.", safety: "safe" },
  { id: "student", title: "Student & Audience Tools", introduced: "13.0", isNew: false, deckSlide: "Student Mode & Study Notes", testId: "[data-testid='student-toggle']", cue: "student", action: "Turn on student mode on a slide with study notes.", assertion: "Vera mode is 'student'.", cleanup: "try/finally re-clicks student-toggle.", safety: "safe" },
  { id: "presenter", title: "Use the Presenter Dashboard", introduced: "13.0", isNew: false, deckSlide: null, testId: "[data-testid='presenter-view']", cue: "presenter", action: "Open the presenter dashboard.", assertion: "The presenter view is visible.", cleanup: "_demoKey('Escape') and SET_FULLSCREEN false at scene end.", safety: "safe" },
  { id: "ai-editing", title: "Improve, Edit with AI & Variants", introduced: "13.0", isNew: false, deckSlide: "AI Editing Modes", testId: "text:Improve,Variants", cue: "ai-editing", action: "Show the Improve, Edit with AI, and Variants controls.", assertion: "Page text shows Improve or Variants.", cleanup: "Next scene's _demoReset.", safety: "safe" },
  { id: "batch-edit", title: "Improve, Edit with AI & Variants", introduced: "8.0", isNew: false, deckSlide: "AI Editing Modes", testId: "[data-testid='batch-edit-panel']", cue: "batch-edit", action: "Open the batch-edit panel.", assertion: "The batch-edit panel is visible.", cleanup: "try/finally closes the panel.", safety: "safe" },
  { id: "vera", title: "Work with Vera", introduced: "13.0", isNew: false, deckSlide: null, testId: "[data-testid='vera-tool-trace']", cue: "vera", action: "Type a prompt to Vera and send it to the deterministic mock.", assertion: "A deck_stats tool trace and the mock response are visible.", cleanup: "SET_CHAT open:false at scene end.", safety: "safe" },
  { id: "cli", title: "Vela CLI & Skill", introduced: "13.0", isNew: false, deckSlide: "Vela CLI & Skill", testId: "[data-block-type='code']", cue: "cli", action: "Open the Vela CLI & Skill slide.", assertion: "A code block is visible.", cleanup: "Next scene's _demoReset.", safety: "safe" },
  { id: "desktop", title: "Bring Your Own Agent", introduced: "13.20", isNew: true, deckSlide: "Vela Desktop — Bring Your Own Agent", testId: "[data-block-type='callout']", cue: "desktop", action: "Open the Vela Desktop slide.", assertion: "A callout block is visible.", cleanup: "Next scene's _demoReset.", safety: "safe" },
  { id: "pdf-export", title: "Export a Print-Ready PDF", introduced: "13.0", isNew: false, deckSlide: null, testId: "[data-testid='pdf-export-preview']", cue: "pdf-export", action: "Start a PDF export and wait for the preview.", assertion: "A PDF preview thumbnail is visible; no download starts.", cleanup: "ctx.ui.setPdfExport(false) at scene end, before any download.", safety: "safe" },
  { id: "pptx-export", title: "Export Editable PowerPoint", introduced: "13.0", isNew: false, deckSlide: null, testId: "[data-testid='pptx-export-preview']", cue: "pptx-export", action: "Start a PPTX export and wait for the preview.", assertion: "A PPTX preview thumbnail is visible while the download control is not available.", cleanup: "ctx.ui.setPptxExport(false) before the download phase.", safety: "safe" },
]);

const DEMO_DECK_SIGNATURE = "Audience Tools:Student Mode & Study Notes|Navigate & Present;" +
  "Live Editor:Gallery View & Smart Merge|Branding & Theming;" +
  "Product Story:Vela Slides|What is Vela?|By the Numbers;" +
  "Run and Share Anywhere:Three Runtimes, One Engine|Export & Share|Get Vela — It's Free;" +
  "Semantic Building Blocks:Text Blocks|Flows & Loops|Data Blocks|Comparison, Funnel & Cycle|Number Row, Matrix & Checklist|SVG Diagrams|Columns Layout;" +
  "Vera and Agent Workflows:Meet Vera|AI Editing Modes|Vela CLI & Skill|Vela Desktop — Bring Your Own Agent";

const _demoDeckSignature = (state) => {
  const lanes = Array.isArray(state?.lanes) ? state.lanes : [];
  const modules = [];
  for (const lane of lanes) {
    if (!lane || typeof lane !== "object" || !Array.isArray(lane.items)) continue;
    for (const item of lane.items) {
      if (!item || typeof item !== "object") continue;
      const slides = Array.isArray(item.slides) ? item.slides : [];
      const titles = slides.map((slide) => slide && typeof slide === "object" && typeof slide.title === "string" ? slide.title : "");
      modules.push(`${typeof item.title === "string" ? item.title : ""}:${titles.join("|")}`);
    }
  }
  return modules.sort().join(";");
};

const DEMO_DECK_FINGERPRINT = "98d20d88";
const _demoFingerprintValue = (value) => {
  if (Array.isArray(value)) return value.map(_demoFingerprintValue);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (key.startsWith("_") || ["id", "createdAt", "updatedAt", "comments"].includes(key)) continue;
    out[key] = _demoFingerprintValue(value[key]);
  }
  return out;
};
const _demoHashText = (text) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
};
const _demoFingerprintModules = (state) => {
  const lanes = Array.isArray(state?.lanes) ? state.lanes : [];
  const modules = [];
  for (const lane of lanes) {
    if (!lane || typeof lane !== "object" || !Array.isArray(lane.items)) continue;
    for (const item of lane.items) {
      if (!item || typeof item !== "object") continue;
      modules.push(_demoFingerprintValue({
        title: typeof item.title === "string" ? item.title : "",
        notes: typeof item.notes === "string" ? item.notes : "",
        slides: Array.isArray(item.slides) ? item.slides : [],
      }));
    }
  }
  return modules.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
};
const _demoDeckFingerprint = (state) => {
  try {
    const deckTitle = typeof state?.deckTitle === "string" ? state.deckTitle : "";
    return _demoHashText(JSON.stringify({ deckTitle, modules: _demoFingerprintModules(state) }));
  } catch {
    return "";
  }
};

const _demoHasUnsavedUiDraft = () => {
  if (typeof document === "undefined") return false;
  if (document.querySelector("[contenteditable='true'], [data-demo-unsaved='true']")) return true;
  return Array.from(document.querySelectorAll("textarea, input:not([type]), input[type='text'], input[type='search']"))
    .some((field) => typeof field.value === "string" && field.value.trim().length > 0);
};

const getDemoUnavailableReason = (state) => {
  if (state?.chatLoading || state?.teacherLoading || state?.aiWork || state?._bootstrap || velaHasActiveAIRequests()) {
    return "Wait for Vera to finish before starting the product tour.";
  }
  if (_demoHasUnsavedUiDraft()) return "Save or clear open editor drafts before starting the product tour.";
  return _demoDeckSignature(state) === DEMO_DECK_SIGNATURE && _demoDeckFingerprint(state) === DEMO_DECK_FINGERPRINT
    ? ""
    : "Open the bundled Vela demo deck to run the product tour.";
};

const _demoCreateMockAI = () => {
  let stepCalls = 0;
  return {
    nextStep: async () => {
      stepCalls++;
      if (stepCalls === 1) {
        return { message: "", tool_calls: [{ tool: "deck_stats", input: {} }] };
      }
      return { message: DEMO_AI_RESPONSE, tool_calls: [] };
    },
    getStats: () => ({ stepCalls, liveCalls: 0 }),
  };
};

const _demoInstallMockAI = () => {
  window.__velaDemoAI = _demoCreateMockAI();
  window.dispatchEvent(new Event("vela-agent-update"));
  return window.__velaDemoAI;
};

const _demoRemoveMockAI = () => {
  delete window.__velaDemoAI;
  window.dispatchEvent(new Event("vela-agent-update"));
};

// ── Spotlight Overlay ────────────────────────────────────────────────
function DemoNewBadge({ badge }) {
  if (!badge) return null;
  return (
    <span data-testid="demo-new-badge" data-feature-version={badge.version} title={`${badge.label} — v${badge.version}`} style={{
      display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 8,
      fontSize: 10, fontWeight: 800, letterSpacing: 0.5, fontFamily: FONT.mono,
      color: "#0f172a", background: T.green || "#34d399",
      padding: "2px 7px", borderRadius: 999, verticalAlign: "middle",
    }}>NEW</span>
  );
}

// A target-scene's rect is null until the target mounts (many scenes'
// actions create their own target — polling before action() would delay
// every scene, so the runner still paints at once). Painting the card at
// the hard-coded fallback corner during that null window, then snapping
// to the real corner once the target resolves, produced a visible jump.
// `pending` suppresses the corner-dependent parts (spotlight ring, card)
// for that first null window only; `DEMO_TARGET_FALLBACK_TICKS` bounds
// how long a scene can stay pending so a target that never resolves still
// gets a visible callout instead of staying silently hidden.
const DEMO_TARGET_FALLBACK_TICKS = 3;

function DemoOverlay({ rect, title, subtitle, step, total, progress, badge, onSkip, onStop, centered, pending, reducedMotion, children }) {
  const pad = 10;
  const r = rect ? {
    top: rect.top - pad,
    left: rect.left - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  } : null;
  const transition = reducedMotion ? "none" : "all 0.3s ease";

  if (centered) return (
    <div data-testid="demo-overlay" data-demo-scene={title} style={{ position: "fixed", inset: 0, zIndex: 99990, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "auto" }}>
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 3, zIndex: 99993, background: "rgba(255,255,255,0.08)" }}>
        <div style={{ height: "100%", background: T.accent, width: `${progress * 100}%`, transition }} />
      </div>
      <div style={{
        width: 540, maxWidth: "92vw", zIndex: 99992,
        background: "rgba(15,23,42,0.96)", backdropFilter: "blur(20px)",
        border: `1px solid ${T.accent}35`, borderRadius: 16,
        padding: "32px 36px", textAlign: "center",
        boxShadow: `0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px ${T.accent}15`,
      }}>
        {children || <>
          <div data-testid="demo-title" style={{ fontSize: 22, fontWeight: 700, color: "#fff", fontFamily: FONT.display, marginBottom: 8, lineHeight: 1.3 }}>{title}<DemoNewBadge badge={badge} /></div>
          {subtitle && <div style={{ fontSize: 15, color: "#94a3b8", fontFamily: FONT.body, lineHeight: 1.6 }}>{subtitle}</div>}
        </>}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 20 }}>
          <button data-testid="demo-stop" onClick={onStop} style={{ fontSize: 13, fontFamily: FONT.mono, color: T.accent, background: T.accent + "15", border: `1px solid ${T.accent}40`, borderRadius: 8, padding: "6px 20px", cursor: "pointer", fontWeight: 600 }}>Close</button>
        </div>
      </div>
    </div>
  );

  if (pending) return (
    <div data-testid="demo-overlay" data-demo-scene={title} data-demo-pending="true" style={{ position: "fixed", inset: 0, zIndex: 99990, pointerEvents: "none" }}>
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 3, zIndex: 99993, background: "rgba(255,255,255,0.08)" }}>
        <div style={{ height: "100%", background: T.accent, width: `${progress * 100}%`, transition: reducedMotion ? "none" : "width 0.3s ease" }} />
      </div>
    </div>
  );

  const cardW = 400, cardH = 170, margin = 16;
  const corners = [
    { top: margin, left: margin },
    { top: margin, left: window.innerWidth - cardW - margin },
    { top: window.innerHeight - cardH - margin, left: margin },
    { top: window.innerHeight - cardH - margin, left: window.innerWidth - cardW - margin },
  ];
  let best = corners[3];
  if (r) {
    const targetCx = r.left + r.width / 2;
    const targetCy = r.top + r.height / 2;
    let maxDist = 0;
    for (const c of corners) {
      const cx = c.left + cardW / 2;
      const cy = c.top + cardH / 2;
      const dist = Math.sqrt((cx - targetCx) ** 2 + (cy - targetCy) ** 2);
      if (dist > maxDist) { maxDist = dist; best = c; }
    }
  }

  return (
    <div data-testid="demo-overlay" data-demo-scene={title} style={{ position: "fixed", inset: 0, zIndex: 99990, pointerEvents: "none" }}>
      {r && (
        <div style={{
          position: "fixed",
          top: r.top, left: r.left, width: r.width, height: r.height,
          borderRadius: 12,
          border: `2px solid ${T.accent}60`,
          boxShadow: `0 0 24px 4px ${T.accent}25`,
          zIndex: 99991,
          transition,
          pointerEvents: "none",
        }} />
      )}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 3, zIndex: 99993, background: "rgba(255,255,255,0.08)" }}>
        <div style={{ height: "100%", background: T.accent, width: `${progress * 100}%`, transition: reducedMotion ? "none" : "width 0.3s ease" }} />
      </div>
      <div data-testid="demo-card" style={{
        position: "fixed",
        top: best.top, left: best.left,
        width: cardW, zIndex: 99992,
        background: "rgba(15,23,42,0.92)",
        backdropFilter: "blur(20px)",
        border: `1px solid ${T.accent}35`,
        borderRadius: 14,
        padding: "20px 24px",
        boxShadow: `0 12px 40px rgba(0,0,0,0.4), 0 0 0 1px ${T.accent}15`,
        pointerEvents: "auto",
        transition: reducedMotion ? "none" : "top 0.3s ease, left 0.3s ease",
      }}>
        <div style={{ width: 40, height: 3, background: T.accent, borderRadius: 2, marginBottom: 12 }} />
        <div data-testid="demo-title" style={{ fontSize: 20, fontWeight: 700, color: "#fff", fontFamily: FONT.display, marginBottom: 6, lineHeight: 1.3 }}>{title}<DemoNewBadge badge={badge} /></div>
        {subtitle && <div style={{ fontSize: 15, color: "#94a3b8", fontFamily: FONT.body, lineHeight: 1.6 }}>{subtitle}</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
          <span data-testid="demo-step" style={{ fontSize: 12, fontFamily: FONT.mono, color: "#64748b" }}>{step}/{total}</span>
          <button data-testid="demo-skip" onClick={onSkip} style={{ fontSize: 12, fontFamily: FONT.mono, color: T.accent, background: "transparent", border: `1px solid ${T.accent}30`, borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>Skip</button>
          <button data-testid="demo-stop" onClick={onStop} style={{ fontSize: 12, fontFamily: FONT.mono, color: "#ef4444", background: "transparent", border: "1px solid #ef444430", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>Stop</button>
        </div>
      </div>
    </div>
  );
}

// ── Demo Helpers ─────────────────────────────────────────────────────
const _demoAbortError = () => {
  const e = new Error("Vela demo action stopped");
  e.name = "AbortError";
  return e;
};

const _demoWait = (ms, signal, scale = 1) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(_demoAbortError()); return; }
  const delay = ms <= 0 ? 0 : Math.max(16, Math.round(ms * scale));
  let timer = null;
  const onAbort = () => {
    if (timer != null) clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    reject(_demoAbortError());
  };
  timer = setTimeout(() => {
    signal?.removeEventListener("abort", onAbort);
    resolve();
  }, delay);
  signal?.addEventListener("abort", onAbort, { once: true });
});

const _demoFind = (sel) => document.querySelector(sel);
const _demoFindAll = (sel) => Array.from(document.querySelectorAll(sel));
const _demoKey = (key, opts = {}) => {
  const target = document.activeElement || document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts }));
  target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true, ...opts }));
};
const _demoClick = (elOrSel) => {
  const el = typeof elOrSel === "string" ? _demoFind(elOrSel) : elOrSel;
  if (!el) return null;
  el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  el.click();
  return el;
};
const _demoSetInput = (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

// Types text one character at a time with human-like variable pauses, one
// deliberate slip (an extra wrong key), a beat to notice it, then a visible
// backspace correction — shared by the inline-edit and Vera-prompt scenes so
// neither typing scene looks like an instant paste.
const _demoTypeWithMistakes = async (ctx, apply, text) => {
  const mistakeAt = Math.max(3, Math.floor(text.length * 0.45));
  let shown = "";
  for (let i = 0; i < text.length; i++) {
    shown += text[i];
    apply(shown);
    await ctx.wait(26 + Math.random() * 55);
    if (i === mistakeAt) {
      shown += "x"; // the slip
      apply(shown);
      await ctx.wait(260); // a beat to "notice" it
      shown = shown.slice(0, -1);
      apply(shown); // visible backspace correction
      await ctx.wait(140);
    }
    if (text[i] === " ") await ctx.wait(70 + Math.random() * 90); // thinking pause at word breaks
  }
};

const _demoVisible = (el) => !!(el && el.isConnected && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0);

const _demoUntil = async (ctx, fn, timeout = 2500) => {
  const deadline = Date.now() + Math.max(350, Math.round(timeout * ctx.scale));
  while (Date.now() < deadline) {
    if (ctx.signal.aborted) throw _demoAbortError();
    const result = fn();
    if (result) return result;
    await _demoWait(50, ctx.signal, ctx.scale);
  }
  throw new Error("Demo state did not become ready");
};

// Like _demoUntil, but for state driven by real wall-clock timers the app
// itself owns (e.g. the export modals' per-slide render loop) — the
// deadline is NOT scaled by the demo's time-scale, only the poll interval
// is, so a fast/scripted run still waits long enough for real rendering.
const _demoUntilReal = async (ctx, fn, timeoutMs = 9000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (ctx.signal.aborted) throw _demoAbortError();
    const result = fn();
    if (result) return result;
    await _demoWait(60, ctx.signal, ctx.scale);
  }
  throw new Error("Demo state did not become ready");
};

const _demoSelectSlide = async (ctx, title) => {
  const state = ctx.getState();
  for (const lane of (state.lanes || [])) {
    for (const item of (lane.items || [])) {
      const index = (item.slides || []).findIndex((slide) => slide.title === title);
      if (index >= 0) {
        ctx.dispatch({ type: "SELECT", id: item.id, slideIndex: index });
        await _demoUntil(ctx, () => {
          const next = ctx.getState();
          return next.selectedId === item.id && next.slideIndex === index;
        });
        return;
      }
    }
  }
  throw new Error(`Demo slide not found: ${title}`);
};

const _demoEditableHeading = () => {
  const block = _demoFind("[data-block-type='heading']");
  if (!block) return null;
  const candidates = [block, ..._demoFindAll("[data-block-type='heading'] *")]
    .filter((el) => _demoVisible(el) && getComputedStyle(el).cursor === "pointer" && (el.textContent || "").trim().length > 2);
  return candidates[candidates.length - 1] || null;
};

// Two toolbar toggles hold their own local component state (not reducer
// state), so a demo-wide dispatch can't close them — close by re-clicking
// the same control only if it still reads as "on". Inline hex+alpha style
// strings (e.g. "#2563eb20") are normalized by the browser to rgba() on
// read, so compare the resolved background color, not the source string.
// Defensive: covers an abort mid-scene, in addition to each scene closing
// itself.
const _demoToggleIsOn = (btn) => !!btn && getComputedStyle(btn).backgroundColor !== "rgba(0, 0, 0, 0)";
const _demoCloseBrandingPanel = async () => {
  // A scene abort can schedule its own close one React commit before restore.
  // Give that close a short chance to land so restore does not click again and
  // reopen the panel.
  for (let i = 0; i < 6; i++) {
    const btn = _demoFind("button[title='Branding & guidelines']");
    if (!_demoFind("[data-testid='branding-panel']") && !_demoToggleIsOn(btn)) return;
    await _demoWait(20, null, 1);
  }
  const btn = _demoFind("button[title='Branding & guidelines']");
  if (_demoFind("[data-testid='branding-panel']") || _demoToggleIsOn(btn)) {
    _demoClick(btn);
    for (let i = 0; i < 10; i++) {
      await _demoWait(20, null, 1);
      const nextBtn = _demoFind("button[title='Branding & guidelines']");
      if (!_demoFind("[data-testid='branding-panel']") && !_demoToggleIsOn(nextBtn)) return;
    }
  }
};
const _demoCloseEditToggle = () => {
  const btn = _demoFind("[data-testid='present-edit-toggle']");
  if (_demoToggleIsOn(btn)) _demoClick(btn);
};
const _demoCloseBatchPanel = () => {
  const panel = _demoFind("[data-testid='batch-edit-panel']");
  if (!panel) return;
  const closeBtn = _demoFind("[data-testid='batch-edit-close']");
  if (closeBtn) _demoClick(closeBtn);
  else _demoClick(_demoFind("[data-testid='batch-edit-toggle']"));
};

const _demoReset = async (ctx) => {
  const editable = _demoFind("[contenteditable='true']");
  if (editable) { editable.focus(); _demoKey("Escape"); }
  document.activeElement?.blur();
  const galleryClose = _demoFind("[data-testid='gallery-close']");
  if (galleryClose) _demoClick(galleryClose);
  if (_demoFind("[data-testid='presenter-view']")) _demoKey("Escape");
  await _demoCloseBrandingPanel();
  _demoCloseEditToggle();
  _demoCloseBatchPanel();
  if (ctx.getState().veraMode !== "editor") ctx.dispatch({ type: "SET_VERA_MODE", mode: "editor" });
  ctx.ui.setPptxExport(false);
  ctx.ui.setPdfExport(false);
  ctx.ui.setExportMenu(false);
  ctx.ui.setViewMenu(false);
  ctx.dispatch({ type: "SET_CHAT", open: false });
  ctx.dispatch({ type: "SET_COMMENTS_PANEL", open: false });
  ctx.dispatch({ type: "SET_REVIEW_MODE", value: false });
  if (ctx.getState().fullscreen) ctx.dispatch({ type: "SET_FULLSCREEN", value: false });
  await _demoWait(180, ctx.signal, ctx.scale);
};

const _demoEnterPresent = async (ctx) => {
  document.activeElement?.blur();
  if (!ctx.getState().fullscreen) ctx.dispatch({ type: "SET_FULLSCREEN", value: true });
  await _demoUntil(ctx, () => _demoFind("[data-testid='presenter-toggle']"));
};

const _demoCue = (name) => {
  window.dispatchEvent(new CustomEvent("vela-demo-cue", { detail: { name } }));
};


// ── Product Story ────────────────────────────────────────────────────
function buildDemoScenes(ctx) {
  return [
    {
      title: DEMO_SCENE_ORDER[0],
      subtitle: "Create, edit, present, and export one structured deck.",
      duration: 5500,
      target: null,
      centered: true,
      children: () => (
        <>
          <div style={{ fontSize: 36, marginBottom: 8 }}>⛵</div>
          <div data-testid="demo-title" style={{ fontSize: 26, fontWeight: 700, color: "#fff", fontFamily: FONT.display, marginBottom: 4 }}>Vela Slides</div>
          <div style={{ fontSize: 13, color: T.accent, fontFamily: FONT.mono, fontWeight: 700, marginBottom: 6 }}>v{VELA_VERSION}</div>
          <div style={{ fontSize: 16, color: "#94a3b8", fontFamily: FONT.body, lineHeight: 1.6 }}>A fast tour of the current product</div>
          <div data-testid="demo-disclosure" style={{ fontSize: 12, color: "#64748b", fontFamily: FONT.body, lineHeight: 1.5, marginTop: 10, maxWidth: 420 }}>{DEMO_DISCLOSURE}</div>
          <div style={{ fontSize: 13, color: "#64748b", fontFamily: FONT.mono, marginTop: 12 }}>21 scenes · about 115 seconds</div>
        </>
      ),
      action: async () => {
        await _demoReset(ctx);
        await _demoSelectSlide(ctx, "Vela Slides");
        await ctx.wait(4700);
      },
    },
    {
      title: DEMO_SCENE_ORDER[1],
      subtitle: "Use the outline to keep sections and slides in a clear order.",
      duration: 4500,
      target: () => _demoFind("[data-testid='toc-tree']"),
      action: async () => {
        await _demoReset(ctx);
        ctx.ui.setTocCollapsed(false);
        ctx.dispatch({ type: "SET_SECTION_COLLAPSED", all: true, collapsed: false, ids: [] });
        await _demoSelectSlide(ctx, "What is Vela?");
        _demoCue("outline");
        await ctx.wait(3800);
      },
    },
    {
      title: DEMO_SCENE_ORDER[2],
      subtitle: "Edit text directly on the slide. The tour restores the original title.",
      duration: 7500,
      target: () => _demoFind("[contenteditable='true']") || _demoEditableHeading(),
      action: async () => {
        await _demoReset(ctx);
        await _demoSelectSlide(ctx, "Text Blocks");
        const heading = await _demoUntil(ctx, _demoEditableHeading);
        _demoClick(heading);
        const editable = await _demoUntil(ctx, () => _demoFind("[contenteditable='true']"));
        try {
          const selection = window.getSelection();
          selection.removeAllRanges();
          const range = document.createRange();
          range.selectNodeContents(editable);
          selection.addRange(range);
        } catch {}
        await ctx.wait(500);
        await _demoTypeWithMistakes(ctx, (text) => { editable.textContent = text; }, DEMO_EDIT_TEXT);
        _demoCue("inline-edit");
        await ctx.wait(2200);
        editable.focus();
        _demoKey("Escape"); // cancels the edit — the original title is never saved
      },
    },
    {
      title: DEMO_SCENE_ORDER[3],
      subtitle: "Use flow and step blocks to make a process easy to follow.",
      duration: 4000,
      target: () => _demoFind("[data-block-type='flow']"),
      action: async () => {
        await _demoReset(ctx);
        await _demoSelectSlide(ctx, "Flows & Loops");
        await _demoUntil(ctx, () => _demoFind("[data-block-type='flow']"));
        _demoCue("flow");
        await ctx.wait(3200);
      },
    },
    {
      title: DEMO_SCENE_ORDER[4],
      subtitle: "Use tables, metrics, and grids to explain results.",
      duration: 4000,
      target: () => _demoFind("[data-block-type='table']"),
      action: async () => {
        await _demoReset(ctx);
        await _demoSelectSlide(ctx, "Data Blocks");
        await _demoUntil(ctx, () => _demoFind("[data-block-type='table']"));
        _demoCue("data");
        await ctx.wait(3200);
      },
    },
    {
      title: DEMO_SCENE_ORDER[5],
      subtitle: "Compare options, visualize a pipeline, and map a circular process.",
      duration: 4000,
      target: () => _demoFind("[data-block-type='grid']"),
      action: async () => {
        await _demoReset(ctx);
        await _demoSelectSlide(ctx, "Comparison, Funnel & Cycle");
        await _demoUntil(ctx, () => {
          const body = document.body.textContent || "";
          return body.includes("Visitors") && body.includes("Describe");
        });
        _demoCue("layouts-1");
        await ctx.wait(3200);
      },
    },
    {
      title: DEMO_SCENE_ORDER[6],
      subtitle: "Quadrant analysis and status-aware checklists — hover an item for its ▲▼ reorder arrows.",
      duration: 4200,
      target: () => _demoFind("[data-block-type='number-row']"),
      action: async () => {
        await _demoReset(ctx);
        await _demoSelectSlide(ctx, "Number Row, Matrix & Checklist");
        await _demoUntil(ctx, () => {
          const body = document.body.textContent || "";
          return body.includes("Quick Wins") && body.includes("Comparison block");
        });
        _demoCue("layouts-2");
        await ctx.wait(3400);
      },
    },
    {
      title: DEMO_SCENE_ORDER[7],
      subtitle: "Two-column slides, and up to five pasted images in a balanced layout.",
      duration: 4000,
      target: () => _demoFind("[data-block-type='badge']"),
      action: async () => {
        await _demoReset(ctx);
        await _demoSelectSlide(ctx, "Columns Layout");
        await _demoUntil(ctx, () => _demoFind("[data-block-type='badge']"));
        _demoCue("columns");
        await ctx.wait(3200);
      },
    },
    {
      title: DEMO_SCENE_ORDER[8],
      subtitle: "See the full deck, including each section's title card, then jump straight to a slide — like Smart Merge, the built-in update conflict resolver.",
      duration: 7200,
      target: () => _demoFind("[data-testid='gallery-close']")?.parentElement,
      action: async () => {
        await _demoReset(ctx);
        const button = await _demoUntil(ctx, () => _demoFind("[data-testid='editor-gallery-toggle']"));
        _demoClick(button);
        await _demoUntil(ctx, () => _demoFind("[data-testid='gallery-close']"));
        _demoCue("gallery");
        await ctx.wait(2400);
        // Jump straight to the "Smart Merge" slide from its gallery card — the
        // click both selects the slide and closes the gallery (see `jump` in
        // GalleryView), so this also demos "jump to any slide" for real.
        const mergeCard = await _demoUntil(ctx, () => _demoFindAll("[data-testid='gallery-slide']").find((el) => (el.textContent || "").includes("Smart Merge")));
        _demoClick(mergeCard);
        await _demoUntil(ctx, () => !_demoFind("[data-testid='gallery-close']") && (document.body.textContent || "").includes("Smart Merge"));
        _demoCue("smart-merge");
        await ctx.wait(2600);
      },
    },
    {
      title: DEMO_SCENE_ORDER[9],
      subtitle: "Set a logo, colors, and brand guidelines once — every slide picks them up.",
      duration: 4000,
      target: () => _demoFind("[data-testid='brand-toggle']"),
      action: async () => {
        await _demoReset(ctx);
        await _demoSelectSlide(ctx, "Branding & Theming");
        const btn = await _demoUntil(ctx, () => _demoFind("[data-testid='brand-toggle']"));
        _demoClick(btn);
        try {
          await _demoUntil(ctx, () => _demoToggleIsOn(btn));
          _demoCue("branding");
          await ctx.wait(2800);
        } finally {
          _demoClick(btn);
        }
      },
    },
    {
      title: DEMO_SCENE_ORDER[10],
      subtitle: "Switch to review mode and leave threaded comments on any slide.",
      duration: 4000,
      target: () => _demoFind("[data-testid='comments-toggle']"),
      action: async () => {
        await _demoReset(ctx);
        const btn = await _demoUntil(ctx, () => _demoFind("[data-testid='comments-toggle']"));
        _demoClick(btn);
        try {
          await _demoUntil(ctx, () => ctx.getState().reviewMode);
          _demoCue("comments");
          await ctx.wait(2800);
        } finally {
          if (ctx.getState().reviewMode) ctx.dispatch({ type: "SET_REVIEW_MODE", value: false });
          ctx.dispatch({ type: "SET_COMMENTS_PANEL", open: false });
        }
      },
    },
    {
      title: DEMO_SCENE_ORDER[11],
      subtitle: "A clean stage, arrow-key navigation, and an Edit toggle for last-minute fixes.",
      duration: 8500,
      target: () => _demoFind("[data-testid='present-edit-toggle']"),
      action: async () => {
        await _demoReset(ctx);
        await _demoSelectSlide(ctx, "Navigate & Present");
        await _demoEnterPresent(ctx);
        _demoCue("present");
        const editToggle = await _demoUntil(ctx, () => _demoFind("[data-testid='present-edit-toggle']"));
        _demoClick(editToggle);
        await ctx.wait(1800);
        _demoClick(editToggle);
        await ctx.wait(700);
        _demoKey("ArrowRight");
        await ctx.wait(2200);
        _demoKey("ArrowRight");
        await ctx.wait(2400);
      },
    },
    {
      title: DEMO_SCENE_ORDER[12],
      subtitle: "Pre-authored study notes render offline for the audience — zero live API calls.",
      duration: 6000,
      target: () => _demoFind("[data-testid='student-toggle']"),
      action: async () => {
        // Select the one slide with pre-authored studyNotes before entering
        // student mode — a slide without them would make StudentPanel call
        // the live Vera Teacher, which this safe tour must never do.
        await _demoSelectSlide(ctx, "Student Mode & Study Notes");
        if (!ctx.getState().fullscreen) await _demoEnterPresent(ctx);
        const toggle = await _demoUntil(ctx, () => _demoFind("[data-testid='student-toggle']"));
        _demoClick(toggle);
        try {
          await _demoUntil(ctx, () => ctx.getState().veraMode === "student");
          _demoCue("student");
          await ctx.wait(4300);
        } finally {
          if (ctx.getState().veraMode === "student") _demoClick(toggle);
        }
      },
    },
    {
      title: DEMO_SCENE_ORDER[13],
      subtitle: "See the current slide, next slide, notes, timer, and time budget.",
      duration: 6500,
      target: () => _demoFind("[data-testid='presenter-view']"),
      action: async () => {
        await _demoEnterPresent(ctx);
        const toggle = await _demoUntil(ctx, () => _demoFind("[data-testid='presenter-toggle']"));
        _demoClick(toggle);
        await _demoUntil(ctx, () => _demoFind("[data-testid='presenter-view']"));
        _demoCue("presenter");
        await ctx.wait(5000);
        _demoKey("Escape");
        ctx.dispatch({ type: "SET_FULLSCREEN", value: false });
        await ctx.wait(300);
      },
    },
    {
      title: DEMO_SCENE_ORDER[14],
      subtitle: "Point-and-prompt editing: Improve auto-polishes a slide, the 🎯 block icon opens Edit with AI on one block, Variants offers alternate designs, and Batch scopes a prompt across slides.",
      duration: 8500,
      target: () => _demoFindAll("button").find((b) => b.title && b.title.startsWith("Auto-improve this slide")),
      action: async () => {
        await _demoReset(ctx);
        await _demoSelectSlide(ctx, "AI Editing Modes");
        const improve = await _demoUntil(ctx, () => _demoFindAll("button").find((b) => b.title && b.title.startsWith("Auto-improve this slide")));
        improve.scrollIntoView?.({ block: "center" });
        _demoCue("ai-editing");
        await ctx.wait(3000);
        const variants = _demoFindAll("button").find((b) => b.title && b.title.startsWith("Generate design variants"));
        variants?.scrollIntoView?.({ block: "center" });
        await ctx.wait(2400);
        // Batch Edit: a real, safe, AI-free scoped-prompt panel (slide/module/
        // section/all) — opened and closed without ever pressing "Go".
        const batchToggle = await _demoUntil(ctx, () => _demoFind("[data-testid='batch-edit-toggle']"));
        _demoClick(batchToggle);
        try {
          await _demoUntil(ctx, () => _demoFind("[data-testid='batch-edit-panel']"));
          _demoCue("batch-edit");
          await ctx.wait(2200);
        } finally {
          const closeBtn = _demoFind("[data-testid='batch-edit-close']");
          if (closeBtn) _demoClick(closeBtn); else if (_demoFind("[data-testid='batch-edit-panel']")) _demoClick(batchToggle);
        }
      },
    },
    {
      title: DEMO_SCENE_ORDER[15],
      subtitle: "Vera checks the live deck with a built-in response. No network call or token is used.",
      duration: 8500,
      target: () => _demoFindAll("*").find((el) => el.children.length === 0 && (el.textContent || "").trim() === "VERA")?.parentElement,
      action: async () => {
        await _demoReset(ctx);
        ctx.dispatch({ type: "SET_CHAT", open: true });
        const input = await _demoUntil(ctx, () => _demoFind("[data-testid='vera-chat-input']"));
        input.focus();
        await _demoTypeWithMistakes(ctx, (text) => _demoSetInput(input, text), DEMO_AI_PROMPT);
        await ctx.wait(220);
        const send = await _demoUntil(ctx, () => {
          const button = _demoFind("[data-testid='vera-chat-send']");
          return button && !button.disabled ? button : null;
        });
        _demoClick(send);
        await _demoUntilReal(ctx, () => {
          const responseReady = _demoFindAll("[data-testid='vera-chat-response']")
            .some((response) => response.textContent?.includes("I checked the live deck structure"));
          const trace = _demoFind("[data-testid='vera-tool-trace'][data-tool-name='deck_stats']");
          return responseReady && trace;
        }, DEMO_AI_READY_TIMEOUT_MS);
        _demoCue("vera");
        await ctx.wait(3600);
        ctx.dispatch({ type: "SET_CHAT", open: false });
      },
    },
    {
      title: DEMO_SCENE_ORDER[16],
      subtitle: "One CLI pipeline authors, validates, and ships a deck as an installable skill.",
      duration: 3800,
      target: () => _demoFind("[data-block-type='code']"),
      action: async () => {
        await _demoReset(ctx);
        await _demoSelectSlide(ctx, "Vela CLI & Skill");
        await _demoUntil(ctx, () => _demoFind("[data-block-type='code']"));
        _demoCue("cli");
        await ctx.wait(3000);
      },
    },
    {
      title: DEMO_SCENE_ORDER[17],
      subtitle: "A native desktop window that runs on your own AI agent — with reliable local saves.",
      duration: 4000,
      target: () => _demoFind("[data-block-type='callout']"),
      action: async () => {
        await _demoReset(ctx);
        await _demoSelectSlide(ctx, "Vela Desktop — Bring Your Own Agent");
        await _demoUntil(ctx, () => _demoFind("[data-block-type='callout']"));
        _demoCue("desktop");
        await ctx.wait(3200);
      },
    },
    {
      title: DEMO_SCENE_ORDER[18],
      subtitle: "Print-ready, vector-quality PDF. This tour previews it and cancels before download.",
      duration: 7000,
      target: () => _demoFind("[data-testid='pdf-export-modal']"),
      action: async () => {
        await _demoReset(ctx);
        ctx.ui.setExportMenu(true);
        const item = await _demoUntil(ctx, () => _demoFind("[data-testid='export-pdf-menu-item']"));
        _demoClick(item);
        await _demoUntil(ctx, () => _demoFind("[data-testid='pdf-export-modal']"));
        const start = await _demoUntil(ctx, () => _demoFind("[data-testid='pdf-export-start']"));
        _demoClick(start);
        await _demoUntilReal(ctx, () => _demoFindAll("[data-testid='pdf-export-preview']").length > 0);
        _demoCue("pdf-export");
        await ctx.wait(2400);
        ctx.ui.setPdfExport(false);
      },
    },
    {
      title: DEMO_SCENE_ORDER[19],
      subtitle: "Native, editable PowerPoint. This tour previews it and cancels before download.",
      duration: 7000,
      target: () => _demoFind("[data-testid='pptx-export-modal']"),
      action: async () => {
        await _demoReset(ctx);
        ctx.ui.setExportMenu(true);
        const item = await _demoUntil(ctx, () => _demoFind("[data-testid='export-pptx-menu-item']"));
        _demoClick(item);
        await _demoUntil(ctx, () => _demoFind("[data-testid='pptx-export-modal']"));
        const start = await _demoUntil(ctx, () => _demoFind("[data-testid='pptx-export-start']"));
        _demoClick(start);
        await _demoUntilReal(ctx, () => _demoFindAll("[data-testid='pptx-export-preview']").length > 0);
        _demoCue("pptx-export");
        await ctx.wait(2400);
        ctx.ui.setPptxExport(false);
      },
    },
    {
      title: DEMO_SCENE_ORDER[20],
      subtitle: "You saw the editor, semantic blocks, gallery, review, presenting, Vera, and export.",
      duration: 4000,
      target: null,
      centered: true,
      children: () => (
        <>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⛵</div>
          <div data-testid="demo-title" style={{ fontSize: 24, fontWeight: 700, color: "#fff", fontFamily: FONT.display, marginBottom: 6 }}>Your story. Built at AI speed.</div>
          <div style={{ fontSize: 15, color: "#94a3b8", fontFamily: FONT.body, lineHeight: 1.6 }}>Create, refine, present, and export with Vela Slides.</div>
        </>
      ),
      action: async () => {
        await _demoReset(ctx);
        await ctx.wait(3500);
      },
    },
  ];
}

const getDemoPlan = () => {
  const scenes = buildDemoScenes(null);
  return {
    titles: scenes.map((scene) => scene.title),
    durations: scenes.map((scene) => scene.duration),
    totalDuration: scenes.reduce((sum, scene) => sum + scene.duration, 0),
  };
};

// ── Demo Runner ──────────────────────────────────────────────────────
const _demoClone = (value, fallback) => {
  try { return JSON.parse(JSON.stringify(value)); } catch { return fallback; }
};
const _demoPlainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const _demoIntegerArray = (value) => Array.isArray(value) ? value.filter(Number.isInteger) : [];
const _demoStringArray = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
const _demoCaptureSnapshot = (state, ui) => ({
  deckEpoch: Number.isInteger(state?._deckEpoch) ? state._deckEpoch : 0,
  selectedId: typeof state?.selectedId === "string" ? state.selectedId : null,
  slideIndex: Number.isInteger(state?.slideIndex) ? state.slideIndex : 0,
  selectedSlideIndices: _demoIntegerArray(state?.selectedSlideIndices),
  collapsedSections: _demoStringArray(state?.collapsedSections),
  fullscreen: !!state?.fullscreen,
  fontScale: Number.isFinite(state?.fontScale) ? state.fontScale : 1,
  chatOpen: !!state?.chatOpen,
  chatMessages: _demoClone(Array.isArray(state?.chatMessages) ? state.chatMessages : [], []),
  chatLoading: !!state?.chatLoading,
  lastDebug: typeof state?.lastDebug === "string" ? state.lastDebug : "",
  aiWork: _demoClone(_demoPlainObject(state?.aiWork) ? state.aiWork : null, null),
  teacherHistory: _demoClone(_demoPlainObject(state?.teacherHistory) ? state.teacherHistory : {}, {}),
  teacherLoading: !!state?.teacherLoading,
  reviewMode: !!state?.reviewMode,
  commentsPanelOpen: !!state?.commentsPanelOpen,
  veraMode: state?.veraMode === "student" ? "student" : "editor",
  tocCollapsed: !!ui?.tocCollapsed,
  viewMenu: !!ui?.viewMenu,
  exportMenu: !!ui?.exportMenu,
  pptxExport: !!ui?.pptxExport,
  pdfExport: !!ui?.pdfExport,
});
const _demoSelectionExists = (state, selectedId, slideIndex) => {
  const lanes = Array.isArray(state?.lanes) ? state.lanes : [];
  for (const lane of lanes) {
    if (!lane || typeof lane !== "object" || !Array.isArray(lane.items)) continue;
    const item = lane.items.find((candidate) => candidate && typeof candidate === "object" && candidate.id === selectedId);
    if (item) return Array.isArray(item.slides) && slideIndex >= 0 && slideIndex < item.slides.length;
  }
  return false;
};
const _demoFlushRequest = (state, preferCurrent) => {
  if (!state || typeof state !== "object") return null;
  const safeState = {
    ...state,
    chatMessages: Array.isArray(state.chatMessages) ? state.chatMessages : [],
    selectedSlideIndices: _demoIntegerArray(state.selectedSlideIndices),
    collapsedSections: _demoStringArray(state.collapsedSections),
    aiWork: _demoPlainObject(state.aiWork) ? state.aiWork : null,
  };
  return {
    state: _demoClone(extractSave(safeState), null),
    epoch: Number.isSafeInteger(state._deckEpoch) ? state._deckEpoch : 0,
    useCurrent: !!preferCurrent,
  };
};

function VelaDemoRunner({ appState, dispatch, demoUi, requestPostDemoFlush }) {
  const [running, setRunning] = useState(false);
  const [scene, setScene] = useState(null);
  const stateRef = useRef(appState);
  const uiRef = useRef(demoUi);
  const runningRef = useRef(false);
  const stopRef = useRef(false);
  const skipRef = useRef(false);
  const controllerRef = useRef(null);
  const runRef = useRef(null);
  const activeFlushRequestRef = useRef(null);
  stateRef.current = appState;
  uiRef.current = demoUi;

  const requestStop = () => {
    stopRef.current = true;
    controllerRef.current?.abort();
    setScene(null);
  };

  const restoreSnapshot = async (snapshot) => {
    const sameDeck = () => stateRef.current?._deckEpoch === snapshot.deckEpoch;
    const editable = _demoFind("[contenteditable='true']");
    if (editable) { editable.focus(); _demoKey("Escape"); }
    const galleryClose = _demoFind("[data-testid='gallery-close']");
    if (galleryClose) _demoClick(galleryClose);
    if (_demoFind("[data-testid='presenter-view']")) _demoKey("Escape");
    await _demoCloseBrandingPanel();
    _demoCloseEditToggle();

    const ui = uiRef.current;
    ui.setPptxExport(false);
    ui.setPdfExport(false);
    ui.setExportMenu(false);
    ui.setViewMenu(false);
    if (!sameDeck()) return false;

    dispatch({ type: "SET_CHAT", open: false });
    dispatch({ type: "SET_COMMENTS_PANEL", open: false });
    dispatch({ type: "SET_REVIEW_MODE", value: false });
    dispatch({ type: "SET_FULLSCREEN", value: false });
    await _demoWait(100, null, 1);

    // Cleanup is safe on every deck. Snapshot restoration is not. Recheck after
    // the async panel cleanup so a deck switch during restore cannot receive
    // selection, chat, Teacher, or UI state from the prior deck.
    if (!sameDeck()) return false;

    if (snapshot.selectedId && _demoSelectionExists(stateRef.current, snapshot.selectedId, snapshot.slideIndex)) {
      dispatch({ type: "SELECT", id: snapshot.selectedId, slideIndex: snapshot.slideIndex });
      dispatch({ type: "SET_SLIDE_SELECTION", index: snapshot.slideIndex, indices: snapshot.selectedSlideIndices });
    } else {
      dispatch({ type: "DESELECT" });
    }
    dispatch({ type: "SET_SECTION_COLLAPSED", all: true, collapsed: true, ids: snapshot.collapsedSections });
    dispatch({ type: "SET_VERA_MODE", mode: snapshot.veraMode });
    dispatch({
      type: "RESTORE_DEMO_STATE",
      messages: snapshot.chatMessages,
      loading: snapshot.chatLoading,
      debug: snapshot.lastDebug,
      aiWork: snapshot.aiWork,
      teacherHistory: snapshot.teacherHistory,
      teacherLoading: snapshot.teacherLoading,
    });
    dispatch({ type: "SET_REVIEW_MODE", value: snapshot.reviewMode });
    dispatch({ type: "SET_COMMENTS_PANEL", open: snapshot.commentsPanelOpen });
    dispatch({ type: "SET_CHAT", open: snapshot.chatOpen });
    if (snapshot.fullscreen) dispatch({ type: "SET_FULLSCREEN", value: true });
    dispatch({ type: "SET_FONT_SCALE", value: snapshot.fontScale });
    ui.setTocCollapsed(snapshot.tocCollapsed);
    ui.setViewMenu(snapshot.viewMenu);
    ui.setExportMenu(snapshot.exportMenu);
    ui.setPptxExport(snapshot.pptxExport);
    ui.setPdfExport(snapshot.pdfExport);
    await _demoWait(120, null, 1);
    return true;
  };

  const run = async (event) => {
    if (runningRef.current || document.documentElement.dataset.velaDemoRunning === "true") return;
    const unavailableReason = getDemoUnavailableReason(stateRef.current);
    if (unavailableReason) {
      window.dispatchEvent(new CustomEvent("vela-demo-blocked", { detail: { reason: unavailableReason } }));
      return;
    }
    const started = Date.now();
    const failures = [];
    const rawScale = Number(event?.detail?.timeScale || 1);
    const scale = Number.isFinite(rawScale) ? Math.max(0.01, Math.min(1, rawScale)) : 1;
    const reducedMotion = !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    let initialState = stateRef.current;
    let initialUi = uiRef.current;
    // VELA:DEV-ONLY:BEGIN
    if (velaTestSurfaceEnabled() && event?.detail?.snapshotStateForTest) {
      initialState = event.detail.snapshotStateForTest;
      initialUi = event.detail.snapshotUiForTest;
    }
    // VELA:DEV-ONLY:END
    const snapshot = _demoCaptureSnapshot(initialState, initialUi);

    const scenes = buildDemoScenes(null);
    const total = scenes.length;
    const plannedMs = scenes.reduce((sum, item) => sum + item.duration, 0);
    let mockStats = { stepCalls: 0, liveCalls: 0 };
    let lockAcquired = false;
    let flushRequest = _demoFlushRequest(initialState, false);
    activeFlushRequestRef.current = flushRequest;

    try {
      document.documentElement.dataset.velaDemoRunning = "true";
      lockAcquired = true;
      runningRef.current = true;
      setRunning(true);
      stopRef.current = false;
      skipRef.current = false;
      _demoInstallMockAI();
      for (let i = 0; i < scenes.length; i++) {
        if (stopRef.current) break;
        if (stateRef.current?._deckEpoch !== snapshot.deckEpoch) {
          stopRef.current = true;
          break;
        }
        skipRef.current = false;
        const s = scenes[i];
        const controller = new AbortController();
        controllerRef.current = controller;
        const ctx = {
          dispatch,
          getState: () => stateRef.current,
          ui: {
            setTocCollapsed: (value) => uiRef.current.setTocCollapsed(value),
            setViewMenu: (value) => uiRef.current.setViewMenu(value),
            setExportMenu: (value) => uiRef.current.setExportMenu(value),
            setPptxExport: (value) => uiRef.current.setPptxExport(value),
            setPdfExport: (value) => uiRef.current.setPdfExport(value),
          },
          signal: controller.signal,
          scale,
          wait: (ms) => _demoWait(ms, controller.signal, scale),
        };
        const sceneWithContext = buildDemoScenes(ctx)[i];
        const hasFnTarget = typeof s.target === "function";
        const targetEl = hasFnTarget ? s.target() : s.target;
        const rect = targetEl ? targetEl.getBoundingClientRect() : null;
        setScene({
          title: s.title,
          subtitle: s.subtitle,
          step: i + 1,
          total,
          rect: rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null,
          // No rect yet on a target scene means the target hasn't mounted —
          // action() often creates it. Stay pending (card hidden) instead of
          // painting the fallback corner, so the card never has to jump once
          // the real target resolves.
          pending: hasFnTarget && !rect,
          progress: (i + 1) / total,
          centered: s.centered || false,
          badge: _demoBadgeFor(s.title),
          reducedMotion,
          children: typeof s.children === "function" ? s.children() : s.children || null,
        });
        window.dispatchEvent(new CustomEvent("vela-demo-scene", { detail: { title: s.title, step: i + 1, total } }));

        let actionDone = false;
        let actionError = null;
        const actionPromise = Promise.resolve()
          .then(() => sceneWithContext.action())
          .catch((error) => { actionError = error; })
          .finally(() => { actionDone = true; });
        const duration = Math.max(40, Math.round(s.duration * scale));
        const t0 = Date.now();
        let pollTicks = 0;
        while (Date.now() - t0 < duration && !skipRef.current && !stopRef.current) {
          await _demoWait(Math.min(100, Math.max(20, duration / 10)), null, 1);
          if (stateRef.current?._deckEpoch !== snapshot.deckEpoch) {
            stopRef.current = true;
            controller.abort();
            break;
          }
          pollTicks++;
          if (hasFnTarget) {
            const el = s.target();
            if (el) {
              const r = el.getBoundingClientRect();
              setScene((prev) => prev ? ({ ...prev, rect: { top: r.top, left: r.left, width: r.width, height: r.height }, pending: false }) : prev);
            } else if (pollTicks >= DEMO_TARGET_FALLBACK_TICKS) {
              // Target still hasn't mounted after a short bound — reveal
              // anyway (today's fallback corner) so the scene is never
              // silently hidden for its whole duration.
              setScene((prev) => (prev && prev.pending) ? ({ ...prev, pending: false }) : prev);
            }
          }
          if (actionDone && Date.now() - t0 >= duration) break;
        }
        if ((skipRef.current || stopRef.current) && !controller.signal.aborted) controller.abort();
        await actionPromise;
        if (stateRef.current?._deckEpoch !== snapshot.deckEpoch) stopRef.current = true;

        const aborted = actionError?.name === "AbortError";
        const ok = !actionError || aborted;
        if (!ok) failures.push({ title: s.title, error: actionError?.message || String(actionError) });
        window.dispatchEvent(new CustomEvent("vela-demo-scene-end", {
          detail: { title: s.title, step: i + 1, ok, skipped: skipRef.current, stopped: stopRef.current },
        }));
      }
    } finally {
      controllerRef.current?.abort();
      controllerRef.current = null;
      setScene(null);
      mockStats = window.__velaDemoAI?.getStats?.() || mockStats;
      _demoRemoveMockAI();
      let restored = false;
      try {
        restored = await restoreSnapshot(snapshot);
      } catch (error) {
        failures.push({ title: "Restore state", error: error?.message || String(error) });
      } finally {
        if (stateRef.current?._deckEpoch !== snapshot.deckEpoch) {
          flushRequest = _demoFlushRequest(stateRef.current, true) || flushRequest;
        } else if (restored) {
          flushRequest.useCurrent = true;
        }
        activeFlushRequestRef.current = flushRequest;
        if (lockAcquired) delete document.documentElement.dataset.velaDemoRunning;
        if (flushRequest?.state) requestPostDemoFlush?.(flushRequest);
        activeFlushRequestRef.current = null;
        runningRef.current = false;
        setRunning(false);
        const reason = stopRef.current ? "stopped" : failures.length ? "failed" : "complete";
        window.dispatchEvent(new CustomEvent("vela-demo-complete", {
          detail: { reason, failures, elapsedMs: Date.now() - started, plannedMs, mockAI: mockStats },
        }));
      }
    }
  };
  runRef.current = run;

  useEffect(() => {
    const runHandler = (event) => runRef.current?.(event);
    const stopHandler = () => requestStop();
    window.addEventListener("vela-run-demo", runHandler);
    window.addEventListener("vela-demo-stop", stopHandler);
    return () => {
      window.removeEventListener("vela-run-demo", runHandler);
      window.removeEventListener("vela-demo-stop", stopHandler);
      controllerRef.current?.abort();
      _demoRemoveMockAI();
      if (document.documentElement.dataset.velaDemoRunning === "true") {
        let request = activeFlushRequestRef.current;
        if (request && stateRef.current?._deckEpoch !== request.epoch) {
          request = _demoFlushRequest(stateRef.current, true);
        }
        delete document.documentElement.dataset.velaDemoRunning;
        if (request?.state) requestPostDemoFlush?.(request);
        activeFlushRequestRef.current = null;
      }
    };
  }, []);

  // VELA:DEV-ONLY:BEGIN
  useEffect(() => {
    if (!velaTestSurfaceEnabled()) return;
    window.__velaDemoTest = {
      plan: () => getDemoPlan(),
      badges: () => DEMO_FEATURE_BADGES.map((b) => ({ ...b })),
      deckSignature: () => _demoDeckSignature(stateRef.current),
      deckFingerprint: () => _demoDeckFingerprint(stateRef.current),
      holdAIActivity: () => velaBeginAIActivity(),
      unavailableReason: (state) => getDemoUnavailableReason(state || stateRef.current),
      runWithMalformedSnapshot: (timeScale = 0.02) => {
        const current = stateRef.current;
        const malformed = {
          ...current,
          chatMessages: { malformed: true },
          teacherHistory: [],
          aiWork: 0,
          selectedSlideIndices: [1, "bad", {}],
          collapsedSections: ["valid", null, {}],
        };
        window.dispatchEvent(new CustomEvent("vela-run-demo", { detail: {
          timeScale,
          snapshotStateForTest: malformed,
          snapshotUiForTest: { tocCollapsed: null, viewMenu: 0, exportMenu: "", pptxExport: null, pdfExport: 0 },
        } }));
      },
      run: (timeScale = 0.03) => window.dispatchEvent(new CustomEvent("vela-run-demo", { detail: { timeScale } })),
      stop: () => window.dispatchEvent(new CustomEvent("vela-demo-stop")),
    };
    return () => { delete window.__velaDemoTest; };
  }, []);
  // VELA:DEV-ONLY:END

  return (
    <>
      {running && scene && (
        <DemoOverlay
          rect={scene.rect}
          title={scene.title}
          subtitle={scene.subtitle}
          step={scene.step}
          total={scene.total}
          progress={scene.progress}
          centered={scene.centered}
          pending={scene.pending}
          badge={scene.badge}
          reducedMotion={scene.reducedMotion}
          onSkip={() => {
            skipRef.current = true;
            controllerRef.current?.abort();
          }}
          onStop={requestStop}
        >{scene.children}</DemoOverlay>
      )}
    </>
  );
}
