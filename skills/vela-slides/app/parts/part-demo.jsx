// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
// ━━━ Vela Live Demo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Cinematic auto-demo with spotlight overlay and floating annotations.
// Triggered via 🎬 Demo header button or window.dispatchEvent("vela-run-demo").
// Uses the same DOM primitives as the UI test suite.

// ── Spotlight Overlay ────────────────────────────────────────────────
function DemoOverlay({ rect, title, subtitle, step, total, progress, onSkip, onStop, centered, children }) {
  const pad = 10;
  const r = rect ? {
    top: rect.top - pad,
    left: rect.left - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  } : null;

  // Centered mode: full-screen backdrop with centered card
  if (centered) return (
    <div style={{ position: "fixed", inset: 0, zIndex: 99990, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "auto" }}>
      {/* Progress bar */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 3, zIndex: 99993, background: "rgba(255,255,255,0.08)" }}>
        <div style={{ height: "100%", background: T.accent, width: `${progress * 100}%` }} />
      </div>
      <div style={{
        width: 540, maxWidth: "92vw", zIndex: 99992,
        background: "rgba(15,23,42,0.96)", backdropFilter: "blur(20px)",
        border: `1px solid ${T.accent}35`, borderRadius: 16,
        padding: "32px 36px", textAlign: "center",
        boxShadow: `0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px ${T.accent}15`,
      }}>
        {children || <>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", fontFamily: FONT.display, marginBottom: 8, lineHeight: 1.3 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 15, color: "#94a3b8", fontFamily: FONT.body, lineHeight: 1.6 }}>{subtitle}</div>}
        </>}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 20 }}>
          <button onClick={onStop} style={{ fontSize: 13, fontFamily: FONT.mono, color: T.accent, background: T.accent + "15", border: `1px solid ${T.accent}40`, borderRadius: 8, padding: "6px 20px", cursor: "pointer", fontWeight: 600 }}>Close</button>
        </div>
      </div>
    </div>
  );

  // Corner mode (default)
  const cardW = 400, cardH = 170, margin = 16;
  const corners = [
    { name: "top-left", top: margin, left: margin },
    { name: "top-right", top: margin, left: window.innerWidth - cardW - margin },
    { name: "bottom-left", top: window.innerHeight - cardH - margin, left: margin },
    { name: "bottom-right", top: window.innerHeight - cardH - margin, left: window.innerWidth - cardW - margin },
  ];

  let best = corners[3]; // default: bottom-right
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
    <div style={{ position: "fixed", inset: 0, zIndex: 99990, pointerEvents: "none" }}>
      {/* Spotlight ring — no mask, just a glowing border around target */}
      {r && (
        <div style={{
          position: "fixed",
          top: r.top, left: r.left, width: r.width, height: r.height,
          borderRadius: 12,
          border: `2px solid ${T.accent}60`,
          boxShadow: `0 0 24px 4px ${T.accent}25`,
          zIndex: 99991,
          transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
          pointerEvents: "none",
        }} />
      )}

      {/* Progress bar */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 3, zIndex: 99993, background: "rgba(255,255,255,0.08)" }}>
        <div style={{
          height: "100%", background: T.accent,
          width: `${progress * 100}%`,
          transition: "width 0.3s ease",
        }} />
      </div>

      {/* Annotation card — always in a corner */}
      <div style={{
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
        transition: "top 0.4s ease, left 0.4s ease",
      }}>
        {/* Accent bar */}
        <div style={{ width: 40, height: 3, background: T.accent, borderRadius: 2, marginBottom: 12 }} />

        <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", fontFamily: FONT.display, marginBottom: 6, lineHeight: 1.3 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 15, color: "#94a3b8", fontFamily: FONT.body, lineHeight: 1.6 }}>{subtitle}</div>}

        {/* Step counter + controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
          <span style={{ fontSize: 12, fontFamily: FONT.mono, color: "#475569" }}>{step}/{total}</span>
          <button onClick={onSkip} style={{ fontSize: 12, fontFamily: FONT.mono, color: T.accent, background: "transparent", border: `1px solid ${T.accent}30`, borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>Skip ⏭</button>
          <button onClick={onStop} style={{ fontSize: 12, fontFamily: FONT.mono, color: "#ef4444", background: "transparent", border: "1px solid #ef444430", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>Stop ⏹</button>
        </div>
      </div>
    </div>
  );
}

// ── Demo Scene Helpers ───────────────────────────────────────────────
const _demoWait = (ms) => new Promise((r) => setTimeout(r, ms));
const _demoKey = (key, opts = {}) => {
  const target = document.activeElement || document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts }));
  target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true, ...opts }));
};
const _demoClick = (elOrSel) => {
  const el = typeof elOrSel === "string" ? document.querySelector(elOrSel) : elOrSel;
  if (!el) return null;
  el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  el.click();
  return el;
};
const _demoFind = (sel) => document.querySelector(sel);
const _demoFindAll = (sel) => Array.from(document.querySelectorAll(sel));
const _demoFindBtn = (text) => _demoFindAll("button").find((b) => (b.textContent || "").includes(text));
const _demoRect = (el) => el ? el.getBoundingClientRect() : null;

const _demoSetValue = (el, text) => {
  const tracker = el._valueTracker;
  if (tracker) tracker.setValue("");
  try {
    const ns = Object.getOwnPropertyDescriptor(
      el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value"
    )?.set;
    if (ns) ns.call(el, text); else el.value = text;
  } catch { el.value = text; }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
};

const _demoType = async (el, text, charDelay = 40) => {
  if (!el) return;
  el.focus();
  for (let i = 0; i <= text.length; i++) {
    _demoSetValue(el, text.slice(0, i));
    if (i < text.length) await _demoWait(charDelay);
  }
};

// Typing with deliberate mistakes and backspace corrections — feels human
// mistakes: array of { at: charIndex, wrong: "xyz", pause: ms }
const _demoTypeWithMistakes = async (el, text, mistakes = [], charDelay = 45) => {
  if (!el) return;
  el.focus();
  let cursor = 0;
  const mistakeMap = {};
  for (const m of mistakes) mistakeMap[m.at] = m;

  while (cursor <= text.length) {
    const m = mistakeMap[cursor];
    if (m) {
      // Type the wrong chars
      for (let j = 0; j < m.wrong.length; j++) {
        _demoSetValue(el, text.slice(0, cursor) + m.wrong.slice(0, j + 1));
        await _demoWait(charDelay);
      }
      // Pause — "notice the mistake"
      await _demoWait(m.pause || 400);
      // Backspace the wrong chars
      for (let j = m.wrong.length; j > 0; j--) {
        _demoSetValue(el, text.slice(0, cursor) + m.wrong.slice(0, j - 1));
        await _demoWait(30);
      }
      await _demoWait(150);
    }
    _demoSetValue(el, text.slice(0, cursor));
    if (cursor < text.length) await _demoWait(charDelay);
    cursor++;
  }
};

// ── Send a prompt to Vera chat — used by demo end card prompt cards ──
const _demoSendToVera = (prompt) => {
  // Stop demo overlay
  window.dispatchEvent(new CustomEvent("vela-demo-stop"));

  setTimeout(async () => {
    // 1. Open Vera chat
    const veraBtn = _demoFindAll("button").find(b => b.textContent?.includes("Vera") || b.textContent?.includes("🤖"));
    if (veraBtn) { _demoClick(veraBtn); await _demoWait(500); }

    // 2. Find textarea
    const ta = _demoFindAll("textarea").find(t => (t.placeholder || "").toLowerCase().includes("tell vera") || (t.placeholder || "").toLowerCase().includes("paste images"));
    if (!ta) return;

    // 3. Fill with prompt
    _demoSetValue(ta, prompt);
    ta.focus();
    await _demoWait(100);

    // 4. Expand textarea to show full prompt
    ta.style.height = "auto";
    ta.style.minHeight = Math.max(80, Math.min(ta.scrollHeight + 4, 160)) + "px";
    ta.style.transition = "min-height 0.3s, box-shadow 0.3s";

    // 5. Highlight — pulse glow on textarea
    ta.style.boxShadow = `0 0 0 2px ${T.accent}, 0 0 24px ${T.accent}50`;
    await _demoWait(1500);

    // 6. Remove highlight
    ta.style.boxShadow = "";
    ta.style.minHeight = "";

    // 7. Auto-send
    const sendBtn = _demoFindAll("button").find(b => (b.textContent || "").trim() === "↑" && !b.disabled);
    if (sendBtn) _demoClick(sendBtn);
  }, 400);
};


// Ensure clean state before each scene
const _demoReset = async () => {
  document.activeElement?.blur(); await _demoWait(50);
  _demoKey("Escape"); await _demoWait(150);
  _demoKey("Escape"); await _demoWait(150);
  // Exit fullscreen if active — check for header hidden
  for (let i = 0; i < 3; i++) {
    if (document.querySelector("header")?.offsetHeight > 0) break;
    _demoKey("f"); await _demoWait(400);
  }
  // Close any fixed overlays (PDF modal, export menu etc) — skip demo overlay (z >= 99000)
  const overlays = _demoFindAll("div").filter((d) => {
    const z = parseInt(d.style.zIndex || 0);
    return d.style.position === "fixed" && d.style.inset === "0px" && z > 9000 && z < 99000;
  });
  for (const o of overlays) { _demoClick(o); await _demoWait(100); }
  document.activeElement?.blur(); await _demoWait(100);
};

function buildDemoScenes() {
  return [
    // 1. Title card
    {
      title: "⛵ Vela Slides",
      subtitle: "AI-native presentations inside Claude.ai",
      duration: 3500,
      target: null,
      centered: true,
      children: () => (
        <>
          <div style={{ fontSize: 36, marginBottom: 8 }}>⛵</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#fff", fontFamily: FONT.display, marginBottom: 6 }}>Vela Slides</div>
          <div style={{ fontSize: 16, color: "#94a3b8", fontFamily: FONT.body, lineHeight: 1.6 }}>AI-native presentations inside Claude.ai</div>
          <div style={{ fontSize: 13, color: "#475569", fontFamily: FONT.mono, marginTop: 12 }}>Live feature tour · 19 scenes</div>
        </>
      ),
      action: async () => { await _demoReset(); },
    },
    // 2. Navigate slides
    {
      title: "Navigate with Arrow Keys",
      subtitle: "← → between slides, ↑ ↓ between modules — automatically crossing boundaries.",
      duration: 5000,
      target: () => _demoFind("header"),
      action: async () => {
        await _demoReset();
        for (let i = 0; i < 5; i++) { _demoKey("ArrowLeft"); await _demoWait(50); }
        await _demoWait(300);
        for (let i = 0; i < 3; i++) { _demoKey("ArrowRight"); await _demoWait(600); }
        // Module crossing with ↓
        _demoKey("ArrowDown"); await _demoWait(700);
        _demoKey("ArrowDown"); await _demoWait(700);
        _demoKey("ArrowUp"); await _demoWait(500);
      },
    },
    // 3. Fullscreen presenter mode
    {
      title: "Presenter Mode",
      subtitle: "Press F for fullscreen. Font scaling with +/−, inline-edit while presenting.",
      duration: 6000,
      target: null,
      action: async () => {
        await _demoReset();
        _demoKey("f"); await _demoWait(1200);
        _demoKey("ArrowRight"); await _demoWait(600);
        // Quick font scale demo
        _demoKey("+"); await _demoWait(500);
        _demoKey("+"); await _demoWait(500);
        _demoKey("0"); await _demoWait(500);
        _demoKey("ArrowRight"); await _demoWait(600);
        _demoKey("f"); await _demoWait(400);
      },
    },
    // 4. Presenter TOC with search
    {
      title: "Searchable Table of Contents",
      subtitle: "Press T in presenter mode — filter across all modules and jump to any slide instantly.",
      duration: 9000,
      target: null,
      action: async () => {
        await _demoReset();
        _demoKey("f"); await _demoWait(800);
        _demoKey("t"); await _demoWait(800);
        const searchInput = _demoFindAll("input").find((i) => i.placeholder?.toLowerCase().includes("search") || i.placeholder?.toLowerCase().includes("filter"));
        if (searchInput) {
          await _demoTypeWithMistakes(searchInput, "flow", [{ at: 2, wrong: "w", pause: 250 }], 80);
          await _demoWait(1200);
          _demoSetValue(searchInput, "");
          await _demoWait(400);
          await _demoType(searchInput, "data", 80);
          await _demoWait(1200);
          _demoSetValue(searchInput, "");
          await _demoWait(400);
        }
        _demoKey("t"); await _demoWait(300);
        _demoKey("f"); await _demoWait(500);
      },
    },
    // 5. Theme toggle
    {
      title: "Dark / Light Theme",
      subtitle: "Press D to toggle. Every slide adapts instantly — no restyling needed.",
      duration: 3500,
      target: () => _demoFind("header"),
      action: async () => {
        await _demoReset();
        _demoKey("d"); await _demoWait(1500);
        _demoKey("d"); await _demoWait(500);
      },
    },
    // 6. Inline WYSIWYG edit
    {
      title: "Inline Editing",
      subtitle: "Click any text on a slide to edit it directly. No modal, no sidebar — just click and type.",
      duration: 7000,
      target: () => document.querySelector("[contenteditable='true']") || (() => {
        const h = _demoFindAll("[data-block-type='heading'] [style*='cursor: pointer']");
        return h.find((el) => el.offsetHeight > 0 && el.textContent?.length > 3) || null;
      })(),
      action: async () => {
        await _demoReset();
        // Find an EditableText wrapper — it has cursor:pointer and is inside a data-block-type
        const wrappers = _demoFindAll("[data-block-type] [style*='cursor: pointer']");
        const target = wrappers.find((el) => el.offsetHeight > 0 && el.textContent?.length > 3 && !el.querySelector("button"));
        if (!target) return;

        // Click to enter edit mode — may need retry
        for (let attempt = 0; attempt < 3; attempt++) {
          _demoClick(target); await _demoWait(500);
          if (document.querySelector("[contenteditable='true']")) break;
        }

        const editable = document.querySelector("[contenteditable='true']");
        if (editable) {
          const text = "Edited live in the demo";
          const mistake = { at: 7, wrong: "lve", pause: 300 };
          // Clear first
          editable.innerHTML = "";
          editable.dispatchEvent(new Event("input", { bubbles: true }));
          await _demoWait(100);
          // Type char by char with mistake
          for (let i = 0; i < text.length; i++) {
            if (i === mistake.at) {
              for (let j = 0; j < mistake.wrong.length; j++) {
                editable.textContent = text.slice(0, i) + mistake.wrong.slice(0, j + 1);
                editable.dispatchEvent(new Event("input", { bubbles: true }));
                await _demoWait(45);
              }
              await _demoWait(mistake.pause);
              for (let j = mistake.wrong.length; j > 0; j--) {
                editable.textContent = text.slice(0, i) + mistake.wrong.slice(0, j - 1);
                editable.dispatchEvent(new Event("input", { bubbles: true }));
                await _demoWait(30);
              }
              await _demoWait(120);
            }
            editable.textContent = text.slice(0, i + 1);
            editable.dispatchEvent(new Event("input", { bubbles: true }));
            await _demoWait(50);
          }
          await _demoWait(1000);
          editable.blur(); await _demoWait(300);
        }
        // Undo
        document.activeElement?.blur(); await _demoWait(100);
        _demoKey("z", { ctrlKey: true }); await _demoWait(300);
      },
    },
    // 7. Quick edit prompt
    {
      title: "Quick Edit (E Key)",
      subtitle: "Describe a change in natural language. Vera rewrites the slide.",
      duration: 6000,
      target: () => _demoFindAll("textarea").find((t) => t.placeholder?.includes("What to change")) || _demoFind("header"),
      action: async () => {
        await _demoReset();
        _demoKey("e"); await _demoWait(800);
        // Quick edit uses a textarea, not input
        const ta = _demoFindAll("textarea").find((t) => t.placeholder?.includes("What to change") || t.placeholder?.includes("change?"));
        if (ta) {
          await _demoTypeWithMistakes(ta, "Make the heading bolder with an icon", [{ at: 15, wrong: "biger", pause: 350 }], 40);
          await _demoWait(800);
        }
        _demoKey("Escape"); await _demoWait(300);
      },
    },
    // 8. Shift+I Auto-Improve — LIVE API call
    {
      title: "✨ Auto-Improve (Shift+I)",
      subtitle: "One keystroke. Vera analyzes the slide with visual context and makes it better.",
      duration: 15000,
      target: () => _demoFind("header"),
      action: async () => {
        await _demoReset();
        _demoKey("ArrowLeft"); await _demoWait(300);
        _demoKey("ArrowLeft"); await _demoWait(300);
        _demoKey("I", { shiftKey: true }); await _demoWait(500);
        await new Promise((resolve) => {
          const t0 = Date.now();
          let sawLoading = false;
          const poll = () => {
            const body = document.body.textContent || "";
            if (body.includes("improving") || body.includes("Improving")) sawLoading = true;
            const done = sawLoading && !body.includes("improving") && !body.includes("Improving");
            if ((done && Date.now() - t0 > 2000) || Date.now() - t0 > 12000) { setTimeout(resolve, 1000); return; }
            setTimeout(poll, 300);
          };
          setTimeout(poll, 500);
        });
        document.activeElement?.blur(); await _demoWait(100);
        _demoKey("z", { ctrlKey: true }); await _demoWait(300);
      },
    },
    // 9. Batch edit panel
    {
      title: "Batch Edit",
      subtitle: "Apply changes across slide, module, section, or entire deck in one command.",
      duration: 7000,
      target: () => _demoFindAll("input").find((i) => i.placeholder?.includes("change across")) || _demoFind("header"),
      action: async () => {
        await _demoReset();
        const btn = _demoFindBtn("Batch") || _demoFindBtn("Improve");
        if (btn) {
          _demoClick(btn); await _demoWait(600);
          // Click through scope options
          const scopeBtns = _demoFindAll("button").filter((b) => {
            const t = (b.textContent || "").toLowerCase().trim();
            return t === "slide" || t === "module" || t === "section" || t === "all";
          });
          for (const sb of scopeBtns) { _demoClick(sb); await _demoWait(400); }
          // Wait for input to be ready (autoFocus may take a tick)
          await _demoWait(300);
          const input = _demoFindAll("input").find((i) => (i.placeholder || "").includes("change across") || (i.placeholder || "").includes("auto-improve"));
          if (input) {
            input.blur(); await _demoWait(100); // release autoFocus
            await _demoTypeWithMistakes(input, "Light backgrounds, dark text, max 5 bullets", [{ at: 6, wrong: "bac", pause: 280 }], 42);
            await _demoWait(600);
          }
          _demoClick(btn); await _demoWait(300);
        }
      },
    },
    // 10. Branding panel
    {
      title: "Branding & Guidelines",
      subtitle: "Set logo position, accent bar, footer, and persistent AI rules for all edits.",
      duration: 5000,
      target: () => _demoFindBtn("Brand"),
      action: async () => {
        await _demoReset();
        const btn = _demoFindBtn("Brand");
        if (btn) {
          _demoClick(btn); await _demoWait(500);
          // Toggle branding enable switch if present
          const toggles = _demoFindAll("input[type='checkbox'], [role='switch']");
          if (toggles.length > 0) { _demoClick(toggles[0]); await _demoWait(600); _demoClick(toggles[0]); await _demoWait(400); }
          // Click logo position options if visible
          const posOpts = _demoFindAll("button").filter((b) => {
            const t = (b.textContent || "").toLowerCase();
            return t.includes("left") || t.includes("right") || t.includes("center") || t.includes("none");
          });
          for (const po of posOpts.slice(0, 3)) { _demoClick(po); await _demoWait(350); }
          await _demoWait(400);
          _demoClick(btn); await _demoWait(300);
        }
      },
    },
    // 11. Vera chat — LIVE API call
    {
      title: "🤖 Vera — Agentic AI Assistant",
      subtitle: "20 tools for building, editing, searching, and restyling — right inside the deck.",
      duration: 20000,
      target: () => _demoFindAll("textarea").find((t) => (t.placeholder || "").toLowerCase().includes("tell vera")),
      action: async () => {
        await _demoReset();
        const veraBtn = _demoFindBtn("Vera") || _demoFindBtn("🤖");
        if (veraBtn) { _demoClick(veraBtn); await _demoWait(500); }
        const ta = _demoFindAll("textarea").find((t) => (t.placeholder || "").toLowerCase().includes("tell vera") || (t.placeholder || "").toLowerCase().includes("paste images"));
        if (ta) {
          await _demoTypeWithMistakes(ta, "Run deck_stats and give me a quick health check", [{ at: 4, wrong: "dek", pause: 350 }, { at: 30, wrong: "quik", pause: 300 }], 35);
          await _demoWait(500);
          const sendBtn = _demoFindAll("button").find((b) => (b.textContent || "").trim() === "↑" && !b.disabled);
          if (sendBtn) _demoClick(sendBtn);
          // Wait for: working... appears → disappears → actual response content visible
          await new Promise((resolve) => {
            const t0 = Date.now();
            let sawWorking = false;
            const poll = () => {
              const body = document.body.textContent || "";
              if (body.includes("working...")) sawWorking = true;
              const workingGone = sawWorking && !body.includes("working...");
              // Look for actual response content (deck_stats mentions slides/blocks)
              const hasResponse = workingGone && (body.includes("slides") || body.includes("modules") || body.includes("blocks")) && Date.now() - t0 > 3000;
              if (hasResponse || Date.now() - t0 > 14000) { resolve(); return; }
              setTimeout(poll, 300);
            };
            setTimeout(poll, 500);
          });
          // Let the viewer read the response
          await _demoWait(3000);
        }
        // Close chat
        const closeBtn = _demoFindBtn("Vera") || _demoFindBtn("🤖");
        if (closeBtn) { _demoClick(closeBtn); await _demoWait(300); }
      },
    },
    // 12. JSON export
    {
      title: "JSON Import / Export",
      subtitle: "Copy deck JSON, paste between artifacts, version in Git. Full portability.",
      duration: 3500,
      target: () => _demoFindAll("textarea").find((t) => (t.value || "").includes("_vela")),
      action: async () => {
        await _demoReset();
        let btn = _demoFindAll("button").find((b) => (b.textContent || "").includes("Export") && (b.textContent || "").includes("📤"));
        if (btn) { _demoClick(btn); await _demoWait(400); }
        btn = _demoFindAll("button").find((b) => (b.textContent || "").includes("Copy") && (b.textContent || "").includes("JSON"));
        if (btn) { _demoClick(btn); await _demoWait(2000); }
        _demoKey("Escape"); await _demoWait(200);
        _demoKey("Escape"); await _demoWait(200);
      },
    },
    // 13. Ratio reflow
    {
      title: "Responsive Ratios",
      subtitle: "Switch between 16:9, 1:1, 4:5, and Fit — slides reflow instantly.",
      duration: 7000,
      target: () => _demoFindAll("button").find((b) => (b.textContent || "").includes("👁")),
      action: async () => {
        await _demoReset();
        const viewBtn = _demoFindAll("button").find((b) => (b.textContent || "").includes("👁"));
        if (!viewBtn) return;
        _demoClick(viewBtn); await _demoWait(400);
        let opt = _demoFindAll("button").find((b) => (b.textContent || "").trim() === "1:1");
        if (opt) { _demoClick(opt); await _demoWait(1200); }
        _demoClick(viewBtn); await _demoWait(400);
        opt = _demoFindAll("button").find((b) => (b.textContent || "").trim() === "4:5");
        if (opt) { _demoClick(opt); await _demoWait(1200); }
        _demoClick(viewBtn); await _demoWait(400);
        opt = _demoFindAll("button").find((b) => (b.textContent || "").trim() === "16:9");
        if (opt) { _demoClick(opt); await _demoWait(1200); }
        _demoClick(viewBtn); await _demoWait(400);
        opt = _demoFindAll("button").find((b) => (b.textContent || "").trim() === "Fit" || (b.textContent || "").trim().endsWith("Fit"));
        if (opt) { _demoClick(opt); await _demoWait(400); }
      },
    },
    // 14. PDF Export
    {
      title: "Vector PDF Export",
      subtitle: "Choose ratio, quality, then watch every slide render to canvas.",
      duration: 35000,
      target: null,
      action: async () => {
        await _demoReset();
        // Open Export dropdown → PDF
        const exportBtn = _demoFindAll("button").find((b) => (b.textContent || "").includes("Export") && (b.textContent || "").includes("📤"));
        if (exportBtn) { _demoClick(exportBtn); await _demoWait(400); }
        const pdfBtn = _demoFindAll("button").find((b) => (b.textContent || "").includes("Export PDF"));
        if (pdfBtn) { _demoClick(pdfBtn); await _demoWait(800); }

        // Cycle through ratios
        const clickOpt = (label) => { const b = _demoFindAll("button").find((b) => (b.textContent || "").includes(label)); if (b) _demoClick(b); };
        clickOpt("1:1"); await _demoWait(500);
        clickOpt("4:5"); await _demoWait(500);
        clickOpt("16:9"); await _demoWait(500);

        // Cycle through quality
        clickOpt("Vector"); await _demoWait(400);
        clickOpt("Standard"); await _demoWait(400);
        clickOpt("High"); await _demoWait(400);

        // Start export
        const startBtn = _demoFindAll("button").find((b) => (b.textContent || "").includes("EXPORT") && (b.textContent || "").includes("SLIDES"));
        if (startBtn) { _demoClick(startBtn); await _demoWait(500); }

        // Wait just until rendering finishes — don't wait for full PDF assembly
        await new Promise((resolve) => {
          const t0 = Date.now();
          let maxProgress = 0;
          const poll = () => {
            const body = document.body.textContent || "";
            // Track rendering progress via "X of Y" text
            const m = body.match(/Rendering\s+(\d+)\s+of\s+(\d+)/);
            if (m) maxProgress = Math.max(maxProgress, parseInt(m[1]));
            // Close early: rendered most slides (last 2 is close enough) or Download appeared
            const hasDownload = body.includes("Download") || body.includes("download");
            const nearDone = maxProgress >= 19; // 19 of 21 is enough to impress
            if (hasDownload || nearDone || Date.now() - t0 > 20000) { resolve(); return; }
            setTimeout(poll, 150);
          };
          setTimeout(poll, 300);
        });
        await _demoWait(800); // brief pause to see the thumbnails

        // Close PDF modal — find ✕ in the modal (high z-index overlay)
        // The PDF modal backdrop is onClick={onClose} at z-index 10001
        const pdfBackdrop = _demoFindAll("div").find((d) => {
          const z = parseInt(d.style.zIndex || 0);
          return d.style.position === "fixed" && z >= 10001 && z < 99000;
        });
        if (pdfBackdrop) { _demoClick(pdfBackdrop); await _demoWait(300); }
      },
    },
    // 15. Cost tracker
    {
      title: "Session Cost Tracker",
      subtitle: "Every API call tracked — tokens, cost, type. Full transparency, no surprises.",
      duration: 3500,
      target: () => _demoFindAll("button").find((b) => (b.textContent || "").includes("💲")),
      action: async () => {
        await _demoReset();
        const btn = _demoFindAll("button").find((b) => (b.textContent || "").includes("💲"));
        if (btn) { _demoClick(btn); await _demoWait(2500); _demoClick(btn); await _demoWait(300); }
      },
    },
    // 16. Student Mode (🎓)
    {
      title: "🎓 Student Mode",
      subtitle: "Vera becomes a teaching assistant — auto-notes, SVG diagrams, follow-up questions per slide.",
      duration: 14000,
      target: null,
      action: async () => {
        await _demoReset();
        _demoKey("f"); await _demoWait(800);
        // Activate student mode via testid
        const btn = _demoFind("[data-testid='student-toggle']");
        if (btn) _demoClick(btn);
        await _demoWait(1000);
        // Wait for streaming to start showing content
        await _demoWait(4000);
        // Navigate to next slide to show per-slide history
        _demoKey("ArrowRight"); await _demoWait(3000);
        // Navigate back to show cached notes
        _demoKey("ArrowLeft"); await _demoWait(1500);
        // Exit student mode
        const exitBtn = _demoFind("[data-testid='student-toggle']");
        if (exitBtn) _demoClick(exitBtn);
        await _demoWait(500);
        _demoKey("f"); await _demoWait(400);
      },
    },
    // 17. Gallery View (🗂)
    {
      title: "🗂 Gallery View",
      subtitle: "Press G in fullscreen — see all slides as thumbnails, jump to any slide instantly.",
      duration: 8000,
      target: null,
      action: async () => {
        await _demoReset();
        _demoKey("f"); await _demoWait(1200);
        // Focus the fullscreen container so G key reaches the handler
        const fsContainer = _demoFind("div[tabindex='0']");
        if (fsContainer) fsContainer.focus();
        await _demoWait(300);
        _demoKey("g"); await _demoWait(3500);
        _demoKey("g"); await _demoWait(500);
        _demoKey("f"); await _demoWait(400);
      },
    },
    // 18. Keyboard shortcuts
    {
      title: "Keyboard Shortcuts (?)",
      subtitle: "Full shortcut guide — navigation, editing, AI tools, presentation controls.",
      duration: 3500,
      target: null,
      action: async () => {
        await _demoReset();
        _demoKey("?"); await _demoWait(2500);
        _demoKey("?"); await _demoWait(300);
      },
    },
    // 19. End card — centered credits + prompt cards, stays until manually closed
    {
      title: "Built with ⛵ Vela Slides",
      subtitle: "",
      duration: 999999, // stays until manually closed
      minDuration: 0,
      target: null,
      centered: true,
      children: () => {
        const prompts = [
          { emoji: "🧠", label: "Educate", prompt: "Create a 6-slide deck explaining how neural networks learn — from perceptrons to backpropagation. Include a flow diagram and key metrics." },
          { emoji: "🚀", label: "Pitch", prompt: "Build a 10-slide startup pitch deck for a project management SaaS — problem, solution, market size, product demo, business model, traction, team, competitive landscape, financials, and ask." },
          { emoji: "👋", label: "Onboard", prompt: "Make a team onboarding deck with 8 slides — company values, org chart, first-week checklist, key tools and logins, communication norms, culture tips, and FAQ." },
          { emoji: "🪐", label: "Explore", prompt: "Present the solar system in 9 slides — one per planet with key facts, distance from the sun, notable moons, and a timeline of major space exploration missions." },
        ];
        return (
          <>
            <div style={{ fontSize: 32, marginBottom: 6 }}>⛵</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#fff", fontFamily: FONT.display, marginBottom: 4, lineHeight: 1.3 }}>Vela Slides</div>
            <div style={{ fontSize: 15, color: "#94a3b8", fontFamily: FONT.body, lineHeight: 1.6, marginBottom: 16 }}>AI-native presentation engine for Claude.ai</div>

            {/* Try it — prompt cards */}
            <div style={{ fontSize: 12, fontFamily: FONT.mono, color: T.accent, letterSpacing: "0.05em", fontWeight: 600, marginBottom: 8 }}>TRY IT — TELL VERA</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 18, textAlign: "left", width: "100%" }}>
              {prompts.map((p) => (
                <div key={p.label} onClick={() => _demoSendToVera(p.prompt)}
                  style={{
                    padding: "10px 12px", borderRadius: 8, cursor: "pointer",
                    background: T.accent + "08", border: `1px solid ${T.accent}25`,
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = T.accent + "18"; e.currentTarget.style.borderColor = T.accent + "50"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = T.accent + "08"; e.currentTarget.style.borderColor = T.accent + "25"; }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", fontFamily: FONT.body, marginBottom: 3 }}>{p.emoji} {p.label}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: FONT.body, lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.prompt}</div>
                </div>
              ))}
            </div>

            <div style={{ fontSize: 14, color: "#e2e8f0", fontFamily: FONT.body, marginBottom: 12 }}>Created by <strong style={{ color: "#fff", fontWeight: 700 }}>Rui Quintino</strong></div>
            <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
              {[
                { icon: "🔗", label: "LinkedIn", url: "https://www.linkedin.com/in/rquintino/" },
                { icon: "⚡", label: "GitHub", url: "https://github.com/agentiapt/vela-slides" },
                { icon: "🚀", label: "agentia.pt", url: "https://www.agentia.pt" },
              ].map((l) => (
                <span key={l.url} onClick={() => window.open(l.url, "_blank", "noopener,noreferrer")} style={{
                  fontSize: 12, fontFamily: FONT.mono, color: T.accent, cursor: "pointer",
                  padding: "4px 12px", borderRadius: 6, border: `1px solid ${T.accent}30`,
                  background: T.accent + "10", display: "flex", alignItems: "center", gap: 5,
                }}>{l.icon} {l.label}</span>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "#64748b", fontFamily: FONT.mono, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <span onClick={() => window.open("https://github.com/agentiapt/vela-slides/blob/main/LICENSE", "_blank", "noopener,noreferrer")} style={{ color: T.accent, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}>ELv2</span>
              <span>·</span>
              <span>© 2025-present Rui Quintino</span>
            </div>
          </>
        );
      },
      action: async () => { await _demoReset(); await new Promise(() => {}); /* never resolves — closed via Stop */ },
    },
  ];
}


// ── Demo Runner Component ────────────────────────────────────────────
function VelaDemoRunner() {
  const [running, setRunning] = useState(false);
  const [scene, setScene] = useState(null);   // { title, subtitle, step, total, rect, progress }
  const stopRef = useRef(false);
  const skipRef = useRef(false);

  const run = async () => {
    if (running) return;
    setRunning(true);
    stopRef.current = false;
    skipRef.current = false;

    const scenes = buildDemoScenes();
    const total = scenes.length;

    for (let i = 0; i < scenes.length; i++) {
      if (stopRef.current) break;
      skipRef.current = false;

      const s = scenes[i];

      // Show overlay immediately with target
      const targetEl = typeof s.target === "function" ? s.target() : s.target;
      const rect = targetEl ? targetEl.getBoundingClientRect() : null;
      setScene({
        title: s.title,
        subtitle: s.subtitle,
        step: i + 1,
        total,
        rect: rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null,
        progress: (i + 1) / total,
        centered: s.centered || false,
        children: typeof s.children === "function" ? s.children() : s.children || null,
      });

      // Run action — it can signal completion via actionDone
      let actionDone = false;
      const actionPromise = s.action().then(() => { actionDone = true; }).catch(() => { actionDone = true; });

      // Wait for: duration expires OR action finishes OR skip/stop
      // For scenes with long durations (API calls, PDF), action finishing = move on
      const t0 = Date.now();
      const minTime = s.minDuration || Math.min(s.duration, 3000); // show overlay at least this long
      while (Date.now() - t0 < s.duration && !skipRef.current && !stopRef.current) {
        // If action is done and we've shown the overlay for minimum time, advance
        if (actionDone && Date.now() - t0 >= minTime) break;
        await _demoWait(100);
        if (typeof s.target === "function") {
          const el = s.target();
          if (el) {
            const r = el.getBoundingClientRect();
            setScene((prev) => ({ ...prev, rect: { top: r.top, left: r.left, width: r.width, height: r.height } }));
          }
        }
      }

      try { await actionPromise; } catch {}
    }

    setScene(null);
    setRunning(false);
  };

  // Listen for custom event
  useEffect(() => {
    const handler = () => { if (!running) run(); };
    const stopHandler = () => { stopRef.current = true; setScene(null); setRunning(false); };
    window.addEventListener("vela-run-demo", handler);
    window.addEventListener("vela-demo-stop", stopHandler);
    return () => { window.removeEventListener("vela-run-demo", handler); window.removeEventListener("vela-demo-stop", stopHandler); };
  }, [running]);

  return (
    <>
      {scene && (
        <DemoOverlay
          rect={scene.rect}
          title={scene.title}
          subtitle={scene.subtitle}
          step={scene.step}
          total={scene.total}
          progress={scene.progress}
          centered={scene.centered}
          onSkip={() => { skipRef.current = true; }}
          onStop={() => { stopRef.current = true; setScene(null); setRunning(false); }}
        >{scene.children}</DemoOverlay>
      )}
    </>
  );
}
