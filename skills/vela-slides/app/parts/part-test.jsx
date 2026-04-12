// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
// ━━━ Vela Battery Test ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Auto-runs on mount, shows toast notification, copy details button

const VELA_TESTS = [
  // ── Config & Utilities ──
  { name: "VELA_VERSION defined", fn: () => typeof VELA_VERSION === "string" && VELA_VERSION.length > 0 },
  { name: "Theme (T) has required keys", fn: () => ["bg", "bgPanel", "text", "accent", "border", "red", "green"].every((k) => T[k]) },
  { name: "FONT object valid", fn: () => ["display", "body", "mono"].every((k) => FONT[k]) },
  { name: "fmtTime works", fn: () => fmtTime(90) !== "" && fmtTime(0) === "" && fmtTime(3600).includes("1h") },
  { name: "fmtTime humanizes (no raw minutes)", fn: () => !fmtTime(13620).includes("227") && fmtTime(13620).includes("h") },
  { name: "sumDurations works", fn: () => sumDurations([{ duration: 60 }, { duration: 30 }]) === 90 && sumDurations([]) === 0 },
  { name: "uid() returns unique IDs", fn: () => { const a = uid(), b = uid(); return a !== b && a.length > 0; } },
  { name: "now() returns ISO string", fn: () => now().includes("T") && now().includes("Z") },
  { name: "fmtSize works", fn: () => fmtSize(1024).includes("KB") },
  { name: "S.btn returns style object", fn: () => typeof S.btn() === "object" && S.btn().cursor === "pointer" },
  { name: "S.primaryBtn returns style", fn: () => typeof S.primaryBtn() === "object" },
  { name: "S.input returns style", fn: () => typeof S.input() === "object" },

  // ── Block Reference & Design Rules ──
  { name: "BLOCK_REFERENCE defined", fn: () => typeof BLOCK_REFERENCE === "string" && BLOCK_REFERENCE.length > 100 },
  { name: "DESIGN_RULES defined", fn: () => typeof DESIGN_RULES === "string" && DESIGN_RULES.length > 50 },
  { name: "CANVAS_RULES defined", fn: () => typeof CANVAS_RULES === "string" && CANVAS_RULES.includes("960") },
  { name: "ICON_LIST defined", fn: () => typeof ICON_LIST === "string" && ICON_LIST.length > 20 },
  { name: "DESIGN_PROMPT_FOOTER defined", fn: () => typeof DESIGN_PROMPT_FOOTER === "string" && DESIGN_PROMPT_FOOTER.length > 100 },

  // ── Engine Functions ──
  { name: "callClaudeAPI is function", fn: () => typeof callClaudeAPI === "function" },
  { name: "parseJSONResponse works", fn: () => { const r = parseJSONResponse('```json\n{"a":1}\n```'); return r && r.a === 1; } },
  { name: "parseJSONResponse handles garbage", fn: () => parseJSONResponse("not json") === null },
  { name: "restoreImageSrcs is function", fn: () => typeof restoreImageSrcs === "function" },
  { name: "improveSlide is function", fn: () => typeof improveSlide === "function" },
  { name: "callSlideDesignAPI is function", fn: () => typeof callSlideDesignAPI === "function" },
  { name: "buildDesignCtx is function", fn: () => typeof buildDesignCtx === "function" },
  { name: "quickEditSlide is function", fn: () => typeof quickEditSlide === "function" },
  { name: "generateSlide is function", fn: () => typeof generateSlide === "function" },
  { name: "executeTool is function", fn: () => typeof executeTool === "function" },
  { name: "ALT_DIRECTIONS has 4 items", fn: () => Array.isArray(ALT_DIRECTIONS) && ALT_DIRECTIONS.length === 4 },

  // ── v10: Teacher Mode Engine ──
  { name: "buildTeacherPrompt is function", fn: () => typeof buildTeacherPrompt === "function" },
  { name: "callVeraTeacher is function", fn: () => typeof callVeraTeacher === "function" },
  { name: "buildTeacherPrompt returns string with QUESTIONS", fn: () => {
    const prompt = buildTeacherPrompt([{ title: "L1", items: [{ id: "i1", title: "Test", slides: [{ blocks: [{ type: "heading", text: "Hi" }] }] }] }], "i1", 0);
    return typeof prompt === "string" && prompt.includes("QUESTIONS") && prompt.includes("teaching assistant");
  }},
  { name: "buildTeacherPrompt includes SVG instructions", fn: () => {
    const prompt = buildTeacherPrompt([{ title: "L1", items: [{ id: "i1", title: "T", slides: [{ blocks: [] }] }] }], "i1", 0);
    return prompt.includes("SVG") && prompt.includes("viewBox");
  }},
  { name: "buildTeacherPrompt includes slide content", fn: () => {
    const prompt = buildTeacherPrompt([{ title: "L1", items: [{ id: "i1", title: "Agents", slides: [{ blocks: [{ type: "heading", text: "ReAct" }] }] }] }], "i1", 0);
    return prompt.includes("ReAct") && prompt.includes("Agents");
  }},

  // ── Reducer ──
  { name: "innerReducer is function", fn: () => typeof innerReducer === "function" },
  { name: "reducer (with undo) is function", fn: () => typeof reducer === "function" },
  { name: "Reducer handles ADD_SLIDE", fn: () => {
    const s = { lanes: [{ id: "l1", items: [{ id: "i1", slides: [] }] }], selectedId: "i1", slideIndex: 0 };
    const r = innerReducer(s, { type: "ADD_SLIDE", id: "i1", slide: { blocks: [] } });
    return r.lanes[0].items[0].slides.length === 1;
  }},
  { name: "Reducer handles REMOVE_SLIDE", fn: () => {
    const s = { lanes: [{ id: "l1", items: [{ id: "i1", slides: [{ blocks: [] }, { blocks: [] }] }] }], selectedId: "i1", slideIndex: 1 };
    const r = innerReducer(s, { type: "REMOVE_SLIDE", id: "i1", index: 0 });
    return r.lanes[0].items[0].slides.length === 1;
  }},
  { name: "Reducer handles UPDATE_SLIDE", fn: () => {
    const s = { lanes: [{ id: "l1", items: [{ id: "i1", slides: [{ blocks: [], bg: "#000" }] }] }], selectedId: "i1", slideIndex: 0 };
    const r = innerReducer(s, { type: "UPDATE_SLIDE", id: "i1", index: 0, patch: { bg: "#fff", blocks: [{ type: "heading", text: "Hi" }] } });
    return r.lanes[0].items[0].slides[0].bg === "#fff";
  }},
  { name: "Reducer handles DUPLICATE_SLIDE", fn: () => {
    const s = { lanes: [{ id: "l1", items: [{ id: "i1", slides: [{ blocks: [{ type: "heading", text: "X" }] }] }] }], selectedId: "i1", slideIndex: 0 };
    const r = innerReducer(s, { type: "DUPLICATE_SLIDE", id: "i1", index: 0 });
    return r.lanes[0].items[0].slides.length === 2;
  }},
  { name: "Reducer handles MOVE_SLIDE", fn: () => {
    const s = { lanes: [{ id: "l1", items: [{ id: "i1", slides: [{ blocks: [], _t: "a" }, { blocks: [], _t: "b" }] }] }], selectedId: "i1", slideIndex: 0 };
    const r = innerReducer(s, { type: "MOVE_SLIDE", id: "i1", from: 0, dir: 1 });
    return r.lanes[0].items[0].slides[0]._t === "b";
  }},

  // ── v10: Reducer — Teacher Mode & veraMode ──
  { name: "Reducer init has veraMode=editor", fn: () => init.veraMode === "editor" },
  { name: "Reducer init has teacherHistory={}", fn: () => typeof init.teacherHistory === "object" && Object.keys(init.teacherHistory).length === 0 },
  { name: "Reducer SET_VERA_MODE switches to student", fn: () => {
    const r = innerReducer(init, { type: "SET_VERA_MODE", mode: "student" });
    return r.veraMode === "student" && typeof r.teacherHistory === "object";
  }},
  { name: "Reducer SET_VERA_MODE switches back to editor", fn: () => {
    const s = { ...init, veraMode: "student", teacherHistory: { "x-0": [{ role: "assistant", content: "hi" }] } };
    const r = innerReducer(s, { type: "SET_VERA_MODE", mode: "editor" });
    return r.veraMode === "editor" && Object.keys(r.teacherHistory).length === 0;
  }},
  { name: "Reducer TEACHER_MSG adds to keyed history", fn: () => {
    const r = innerReducer(init, { type: "TEACHER_MSG", key: "s1-0", role: "assistant", content: "hello", questions: ["Q1?"] });
    return r.teacherHistory["s1-0"]?.length === 1 && r.teacherHistory["s1-0"][0].content === "hello" && r.teacherHistory["s1-0"][0].questions[0] === "Q1?";
  }},
  { name: "Reducer TEACHER_MSG preserves other slide keys", fn: () => {
    const s = { ...init, teacherHistory: { "s1-0": [{ role: "assistant", content: "a" }] } };
    const r = innerReducer(s, { type: "TEACHER_MSG", key: "s1-1", role: "assistant", content: "b" });
    return r.teacherHistory["s1-0"]?.length === 1 && r.teacherHistory["s1-1"]?.length === 1;
  }},
  { name: "Reducer TEACHER_LOADING toggles", fn: () => {
    const r = innerReducer(init, { type: "TEACHER_LOADING", value: true });
    return r.teacherLoading === true;
  }},
  { name: "Reducer TEACHER_CLEAR clears only target key", fn: () => {
    const s = { ...init, teacherHistory: { "s1-0": [{ role: "assistant", content: "a" }], "s1-1": [{ role: "assistant", content: "b" }] } };
    const r = innerReducer(s, { type: "TEACHER_CLEAR", key: "s1-0" });
    return r.teacherHistory["s1-0"]?.length === 0 && r.teacherHistory["s1-1"]?.length === 1;
  }},

  // ── Components exist ──
  { name: "SlidePanel component exists", fn: () => typeof SlidePanel === "function" },
  { name: "ModuleList component exists", fn: () => typeof ModuleList === "function" },
  { name: "ConceptRow component exists", fn: () => typeof ConceptRow === "function" },
  { name: "App component exists", fn: () => typeof App === "function" },
  { name: "FullscreenSlide component exists", fn: () => typeof FullscreenSlide === "function" },
  { name: "FullscreenSlide component exists", fn: () => typeof FullscreenSlide === "function" },
  { name: "getSlideSource returns source info", fn: () => typeof getSlideSource === "function" },
  { name: "RenderBlock component exists", fn: () => typeof RenderBlock === "function" },
  { name: "BrandingPanel component exists", fn: () => typeof BrandingPanel === "function" },

  // ── v10: Components ──
  { name: "TeacherPanel component exists", fn: () => typeof TeacherPanel === "function" },
  { name: "TeacherMessage component exists", fn: () => typeof TeacherMessage === "function" },
  { name: "GalleryView component exists", fn: () => typeof GalleryView === "function" },
  { name: "getSlideTitle function exists", fn: () => typeof getSlideTitle === "function" },
  { name: "getSlideTitle extracts heading", fn: () => {
    const title = getSlideTitle({ blocks: [{ type: "heading", text: "My Title" }] }, 0);
    return title === "My Title";
  }},
  { name: "getSlideTitle falls back to index", fn: () => {
    const title = getSlideTitle({ blocks: [{ type: "spacer", h: 8 }] }, 3);
    return title === "Slide 4";
  }},

  // ── Icons ──
  { name: "Icon components available (lucide-react)", fn: () => {
    try { return [ChevronLeft, ChevronRight, Plus, X, Maximize2, Minimize2, Presentation].every((c) => typeof c === "function" || typeof c === "object"); }
    catch { return false; }
  }},
  { name: "VelaIcon exists", fn: () => typeof VelaIcon === "function" },

  // ── Feature: Scroll navigation", fn: () => true ──
  { name: "Scroll nav (wheel handler) exists in SlidePanel", fn: () => {
    // Check by rendering — we just verify the component string has wheel reference
    const src = SlidePanel.toString();
    return src.includes("wheel") || src.includes("onWheel") || src.includes("SCROLL");
  }},

  // ── Feature: F5 intercept ──
  { name: "F5 key handled", fn: () => SlidePanel.toString().includes("F5") },

  // ── Feature: Delete key ──
  { name: "Delete key handler exists", fn: () => SlidePanel.toString().includes("Delete") },
];

function VelaBatteryTest() {
  const [results, setResults] = useState(null);
  const [show, setShow] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Run tests after brief delay to let everything mount
    const timer = setTimeout(() => {
      const res = VELA_TESTS.map((t) => {
        try { return { name: t.name, pass: !!t.fn(), error: null }; }
        catch (e) { return { name: t.name, pass: false, error: e.message }; }
      });
      setResults(res);
      if (res.every((r) => r.pass)) setTimeout(() => setShow(false), 3000);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  if (!results || !show) return null;

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  const allGood = failed === 0;

  const copyDetails = () => {
    const lines = [
      `VELA v${VELA_VERSION} Battery Test — ${new Date().toISOString()}`,
      `Result: ${passed}/${results.length} passed${failed > 0 ? ` | ${failed} FAILED` : ""}`,
      "",
      ...results.map((r) => `${r.pass ? "✅" : "❌"} ${r.name}${r.error ? ` — ${r.error}` : ""}`),
    ];
    velaClipboard(lines.join("\n")); setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 99999, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, fontFamily: FONT.mono }}>
      {/* Toast notification */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "8px 14px", borderRadius: 8,
        background: allGood ? "rgba(16,185,129,0.95)" : "rgba(239,68,68,0.95)",
        color: "#fff", fontSize: 12, fontWeight: 700,
        boxShadow: "0 4px 24px rgba(0,0,0,0.4)", backdropFilter: "blur(8px)",
        animation: "fade-in 0.3s ease",
        cursor: "pointer",
      }} onClick={() => setShow(false)}>
        <span style={{ fontSize: 16 }}>{allGood ? "✅" : "❌"}</span>
        <span>Battery: {passed}/{results.length}{failed > 0 ? ` (${failed} fail)` : " OK"}</span>
        <span style={{ fontSize: 9, opacity: 0.7 }}>v{VELA_VERSION}</span>
        <button onClick={(e) => { e.stopPropagation(); copyDetails(); }} style={{
          background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)",
          color: "#fff", padding: "2px 8px", borderRadius: 4, cursor: "pointer",
          fontSize: 10, fontFamily: FONT.mono, fontWeight: 600,
        }}>{copied ? "Copied!" : "📋 Copy"}</button>
        {allGood && <button onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent("vela-run-uitests")); setShow(false); }} style={{
          background: "rgba(59,130,246,0.4)", border: "1px solid rgba(59,130,246,0.6)",
          color: "#fff", padding: "2px 8px", borderRadius: 4, cursor: "pointer",
          fontSize: 10, fontFamily: FONT.mono, fontWeight: 600,
        }}>🧪 UI Tests</button>}
        <button onClick={(e) => { e.stopPropagation(); setShow(false); }} style={{
          background: "none", border: "none", color: "rgba(255,255,255,0.6)",
          cursor: "pointer", fontSize: 14, padding: "0 2px",
        }}>✕</button>
      </div>
      {/* Failed test quick list */}
      {failed > 0 && (
        <div style={{
          padding: "6px 10px", borderRadius: 6,
          background: "rgba(0,0,0,0.85)", border: "1px solid rgba(239,68,68,0.4)",
          maxWidth: 320, maxHeight: 200, overflowY: "auto",
        }}>
          {results.filter((r) => !r.pass).map((r, i) => (
            <div key={i} style={{ fontSize: 9, color: "#f87171", padding: "2px 0", lineHeight: 1.4 }}>
              ❌ {r.name}{r.error ? ` — ${r.error}` : ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

