// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
// ━━━ Offline Study Notes — static panel that renders slide.studyNotes ━━
// Shown by StudentPanel when the current slide has pre-authored studyNotes.
// Renders markdown text + optional inline SVG diagram + pre-authored
// follow-up questions, all with zero API calls. If a live channel is
// reachable, questions become clickable Vera prompts and an Ask input
// appears; layered live chat history is preserved per-slide just like the
// regular TeacherPanel.
function StaticStudyPanel({ state, dispatch, lanes, selectedId, slideIndex, slide }) {
  const { teacherHistory, teacherLoading } = state;
  const [input, setInput] = useState("");
  const [streamingText, setStreamingText] = useState(null);
  const scrollRef = useRef(null);
  const activeKeyRef = useRef(null);
  const slideKey = `${selectedId}-${slideIndex}`;
  const messages = teacherHistory[slideKey] || [];
  const sn = slide && slide.studyNotes ? slide.studyNotes : null;

  // Centralized AI availability check (v12.36) — reactive so the panel re-renders
  // when the desktop shell finishes agent detection (v12.74).
  const apiAvailable = useAIAvailable();

  useEffect(() => {
    activeKeyRef.current = slideKey;
    setStreamingText(null);
  }, [slideKey]);

  // Strip incomplete markdown during streaming (mirrors TeacherPanel)
  const cleanStream = (text) => {
    let clean = text.split(/---\s*QUESTIONS/i)[0];
    const stars = (clean.match(/\*\*/g) || []).length;
    if (stars % 2 !== 0) clean = clean.replace(/\*\*[^*]*$/, "");
    return clean;
  };

  const sendQuestion = async (q) => {
    if (!apiAvailable) return;
    const msg = q || input.trim();
    if (!msg || teacherLoading) return;
    if (!q) setInput("");
    const myKey = slideKey;
    dispatch({ type: "TEACHER_MSG", key: myKey, role: "user", content: msg });
    dispatch({ type: "TEACHER_LOADING", value: true });
    if (activeKeyRef.current === myKey) setStreamingText("");
    const result = await callVeraTeacher(lanes, selectedId, slideIndex, msg, [...messages, { role: "user", content: msg }], (text) => {
      if (activeKeyRef.current !== myKey) return;
      setStreamingText(cleanStream(text));
    });
    if (activeKeyRef.current === myKey) setStreamingText(null);
    const reply = result.message || "I'm not sure about that one. Could you rephrase? 🖖";
    dispatch({ type: "TEACHER_MSG", key: myKey, role: "assistant", content: reply, questions: result.questions });
    if (activeKeyRef.current === myKey) dispatch({ type: "TEACHER_LOADING", value: false });
  };

  const questions = (sn && Array.isArray(sn.questions)) ? sn.questions : [];
  const studyCtx = (sn && sn.glossary) ? { glossary: sn.glossary, keyPrefix: `sn-${slideKey}` } : undefined;

  return (
    <div data-teacher-panel data-study-panel onWheel={(e) => e.stopPropagation()} style={{ width: "35%", minWidth: 280, maxWidth: 400, background: "#0f1219", borderLeft: `1px solid ${T.accent}40`, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "12px 16px", borderBottom: `1px solid rgba(255,255,255,0.12)`, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>🎓</span>
        <span style={{ fontFamily: FONT.mono, fontSize: 13, fontWeight: 700, color: T.accent, letterSpacing: "0.05em" }}>STUDY NOTES</span>
        <span style={{ fontFamily: FONT.mono, fontSize: 10, color: "#8892B0" }}>{apiAvailable ? "ask vera for more" : "offline"}</span>
        <button onClick={() => dispatch({ type: "SET_VERA_MODE", mode: "editor" })} title="Close study notes" style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#8892B0", padding: 4, lineHeight: 1, opacity: 0.7 }} onMouseEnter={(e) => e.currentTarget.style.opacity = 1} onMouseLeave={(e) => e.currentTarget.style.opacity = 0.7}>✕</button>
      </div>

      {/* Body */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Static authored notes */}
        {sn && sn.text && (
          <div data-study-notes-text style={{ fontSize: 14, lineHeight: 1.65, color: "#E6F1FF", fontFamily: FONT.body }}>
            <ChatMarkdown text={sn.text} ctx={studyCtx} />
          </div>
        )}

        {/* Optional pre-authored SVG diagram */}
        {sn && sn.diagram && (
          <div data-study-notes-diagram style={{ margin: "2px 0", borderRadius: 8, overflow: "hidden", background: "#1a1f2e", border: "1px solid rgba(59,130,246,0.2)" }} dangerouslySetInnerHTML={{ __html: sanitizeSvgMarkup(sn.diagram) }} />
        )}

        {/* Pre-authored follow-up questions */}
        {questions.length > 0 && (
          <div data-study-notes-questions style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 2 }}>
            <span style={{ fontFamily: FONT.mono, fontSize: 10, color: "#8892B0", letterSpacing: "0.05em", fontWeight: 600 }}>
              {apiAvailable ? "EXPLORE FURTHER" : "QUESTIONS TO PONDER"}
            </span>
            {questions.map((q, qi) => apiAvailable ? (
              <button key={qi} onClick={() => sendQuestion(q)} disabled={teacherLoading} style={{
                textAlign: "left", padding: "9px 14px", fontSize: 13, fontFamily: FONT.body, color: "#93c5fd",
                background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.30)", borderRadius: 8, cursor: teacherLoading ? "default" : "pointer",
                lineHeight: 1.45, transition: "all 0.15s", opacity: teacherLoading ? 0.5 : 1
              }} onMouseEnter={(e) => { if (!teacherLoading) { e.currentTarget.style.background = "rgba(59,130,246,0.25)"; e.currentTarget.style.borderColor = "rgba(59,130,246,0.50)"; } }}
                 onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(59,130,246,0.15)"; e.currentTarget.style.borderColor = "rgba(59,130,246,0.30)"; }}>
                {q}
              </button>
            ) : (
              <div key={qi} style={{ padding: "9px 14px", fontSize: 13, fontFamily: FONT.body, color: "#93c5fd", background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.18)", borderRadius: 8, lineHeight: 1.45 }}>
                • {q}
              </div>
            ))}
          </div>
        )}

        {/* Layered live Vera chat turns (user clicks on a question, or types in the input) */}
        {messages.length > 0 && (
          <>
            <div style={{ marginTop: 4, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.08)", fontFamily: FONT.mono, fontSize: 10, color: "#8892B0", letterSpacing: "0.05em", fontWeight: 600 }}>
              VERA CHAT
            </div>
            {messages.map((m, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{
                  padding: "12px 16px", borderRadius: 10, fontSize: 14, lineHeight: 1.6, fontFamily: FONT.body,
                  ...(m.role === "user"
                    ? { background: T.accent + "30", color: "#fff", alignSelf: "flex-end", maxWidth: "88%", borderBottomRightRadius: 4 }
                    : { background: "rgba(255,255,255,0.10)", color: "#E6F1FF", maxWidth: "100%", borderBottomLeftRadius: 4, border: "1px solid rgba(255,255,255,0.06)" })
                }}>
                  {m.role === "assistant" ? <TeacherMessage text={m.content} /> : <ChatMarkdown text={m.content} />}
                </div>
              </div>
            ))}
          </>
        )}
        {/* Streaming bubble */}
        {streamingText !== null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ padding: "12px 16px", borderRadius: 10, borderBottomLeftRadius: 4, fontSize: 14, lineHeight: 1.6, fontFamily: FONT.body, background: "rgba(255,255,255,0.10)", color: "#E6F1FF", border: "1px solid rgba(255,255,255,0.06)" }}>
              {streamingText.length > 0 ? <TeacherMessage text={streamingText} /> : <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 14, animation: "spin 1.5s linear infinite", display: "inline-block" }}>🎓</span><span style={{ fontFamily: FONT.mono, fontSize: 13, color: "#93c5fd" }}>thinking...</span></span>}
            </div>
          </div>
        )}
      </div>

      {/* Footer — live input only when API is reachable */}
      {apiAvailable ? (
        <>
          <div style={{ padding: "0 14px 2px", display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 13 }}>✨</span>
            <span style={{ fontSize: 13, color: "#4a5a72", fontFamily: FONT.body }}>AI answers may contain errors — always verify key facts</span>
          </div>
          <div style={{ padding: "6px 12px 10px", display: "flex", gap: 6 }}>
            <input value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && input.trim()) sendQuestion(); }}
              placeholder="Ask Vera about this slide..."
              style={{ flex: 1, padding: "9px 14px", fontSize: 14, fontFamily: FONT.body, background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 8, color: "#fff", outline: "none" }} />
            <button onClick={() => sendQuestion()} disabled={!input.trim() || teacherLoading}
              style={{ padding: "9px 16px", fontSize: 13, fontFamily: FONT.mono, fontWeight: 700, background: input.trim() ? T.accent : "rgba(255,255,255,0.1)", color: "#fff", border: "none", borderRadius: 8, cursor: input.trim() ? "pointer" : "default", opacity: input.trim() ? 1 : 0.4 }}>Ask</button>
          </div>
        </>
      ) : (
        <div style={{ padding: "10px 14px", fontSize: 11, color: "#4a5a72", fontFamily: FONT.body, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          Offline mode — authored content only
        </div>
      )}
    </div>
  );
}

// ━━━ StudentPanel — dispatcher: static studyNotes first, else live Vera ━
// If the current slide has pre-authored studyNotes, render the offline
// StaticStudyPanel. Otherwise fall back to the existing live TeacherPanel.
function StudentPanel({ state, dispatch, lanes, selectedId, slideIndex }) {
  // Reuse the same inline slide derivation pattern TeacherPanel uses
  let slide = null;
  for (const l of (lanes || [])) {
    const it = l.items.find((i) => i.id === selectedId);
    if (it) { slide = (it.slides || [])[slideIndex] || null; break; }
  }
  const hasStudyNotes = !!(slide && slide.studyNotes && slide.studyNotes.text);
  if (hasStudyNotes) {
    return <StaticStudyPanel state={state} dispatch={dispatch} lanes={lanes} selectedId={selectedId} slideIndex={slideIndex} slide={slide} />;
  }
  return <TeacherPanel state={state} dispatch={dispatch} lanes={lanes} selectedId={selectedId} slideIndex={slideIndex} />;
}

function TeacherPanel({ state, dispatch, lanes, selectedId, slideIndex }) {
  const { teacherHistory, teacherLoading } = state;
  const [input, setInput] = useState("");
  const [streamingText, setStreamingText] = useState(null);
  const scrollRef = useRef(null);
  const lastMsgRef = useRef(null);
  const generatingRef = useRef(null);
  const prefetchedRef = useRef(new Set());
  const activeKeyRef = useRef(null); // tracks which slide is currently active — stale callbacks check this

  const slideKey = `${selectedId}-${slideIndex}`;
  const messages = teacherHistory[slideKey] || [];

  // Reset streaming text when slide changes
  useEffect(() => {
    activeKeyRef.current = slideKey;
    setStreamingText(null);
    prevMsgCount.current = (teacherHistory[slideKey] || []).length;
    prevStreamState.current = null;
  }, [slideKey]);

  // Scroll to start of newest message — only on user message or stream start, not on finalize
  const prevMsgCount = useRef(messages.length);
  const prevStreamState = useRef(null);
  useEffect(() => {
    const msgCountChanged = messages.length !== prevMsgCount.current;
    const streamJustStarted = prevStreamState.current === null && streamingText !== null;
    const streamJustEnded = prevStreamState.current !== null && streamingText === null;
    prevMsgCount.current = messages.length;
    prevStreamState.current = streamingText;
    // Scroll on: stream start, or user message added (not when assistant stream finalizes)
    if (streamJustStarted) {
      setTimeout(() => { lastMsgRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, 50);
    } else if (msgCountChanged && !streamJustEnded) {
      // New message but NOT because stream just ended — must be a user message
      const last = messages[messages.length - 1];
      if (last?.role === "user") {
        setTimeout(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, 50);
      }
    }
  }, [messages, streamingText]);

  // Strip incomplete markdown during streaming (partial **bold shows raw **)
  const cleanStream = (text) => {
    let clean = text.split(/---\s*QUESTIONS/i)[0];
    const stars = (clean.match(/\*\*/g) || []).length;
    if (stars % 2 !== 0) clean = clean.replace(/\*\*[^*]*$/, "");
    return clean;
  };

  // Auto-generate notes on slide change + prefetch N+1
  useEffect(() => {
    if (!selectedId) return;
    const existing = teacherHistory[slideKey];
    if (existing && existing.length > 0) return;
    if (generatingRef.current === slideKey) return;
    generatingRef.current = slideKey;
    const myKey = slideKey; // capture for closure
    const timer = setTimeout(async () => {
      dispatch({ type: "TEACHER_LOADING", value: true });
      if (activeKeyRef.current === myKey) setStreamingText("");
      const result = await callVeraTeacher(lanes, selectedId, slideIndex, null, [], (text) => {
        if (activeKeyRef.current !== myKey) return;
        setStreamingText(cleanStream(text));
      });
      if (activeKeyRef.current === myKey) setStreamingText(null);
      const content = result.message || "";
      if (content.trim()) dispatch({ type: "TEACHER_MSG", key: myKey, role: "assistant", content, questions: result.questions });
      if (activeKeyRef.current === myKey) dispatch({ type: "TEACHER_LOADING", value: false });
      generatingRef.current = null;
      // Prefetch N+1
      const nextKey = `${selectedId}-${slideIndex + 1}`;
      if (!prefetchedRef.current.has(nextKey) && !teacherHistory[nextKey]) {
        let totalSlides = 0;
        for (const l of lanes) { const it = l.items.find(i => i.id === selectedId); if (it) { totalSlides = it.slides?.length || 0; break; } }
        if (slideIndex + 1 < totalSlides) {
          prefetchedRef.current.add(nextKey);
          const prefResult = await callVeraTeacher(lanes, selectedId, slideIndex + 1, null, []);
          const prefContent = prefResult.message || "";
          if (prefContent.trim()) dispatch({ type: "TEACHER_MSG", key: nextKey, role: "assistant", content: prefContent, questions: prefResult.questions });
        }
      }
    }, 400);
    return () => { clearTimeout(timer); generatingRef.current = null; };
  }, [slideKey]);

  const sendQuestion = async (q) => {
    const msg = q || input.trim();
    if (!msg || teacherLoading) return;
    if (!q) setInput("");
    const myKey = slideKey;
    dispatch({ type: "TEACHER_MSG", key: myKey, role: "user", content: msg });
    dispatch({ type: "TEACHER_LOADING", value: true });
    if (activeKeyRef.current === myKey) setStreamingText("");
    const result = await callVeraTeacher(lanes, selectedId, slideIndex, msg, [...messages, { role: "user", content: msg }], (text) => {
      if (activeKeyRef.current !== myKey) return;
      setStreamingText(cleanStream(text));
    });
    if (activeKeyRef.current === myKey) setStreamingText(null);
    const reply = result.message || "I'm not sure about that one. Could you rephrase? 🖖";
    dispatch({ type: "TEACHER_MSG", key: myKey, role: "assistant", content: reply, questions: result.questions });
    if (activeKeyRef.current === myKey) dispatch({ type: "TEACHER_LOADING", value: false });
  };

  return (
    <div data-teacher-panel onWheel={(e) => e.stopPropagation()} style={{ width: "35%", minWidth: 280, maxWidth: 400, background: "#0f1219", borderLeft: `1px solid ${T.accent}40`, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "12px 16px", borderBottom: `1px solid rgba(255,255,255,0.12)`, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>🎓</span>
        <span style={{ fontFamily: FONT.mono, fontSize: 13, fontWeight: 700, color: T.accent, letterSpacing: "0.05em" }}>VERA</span>
        <span style={{ fontFamily: FONT.mono, fontSize: 10, color: "#8892B0" }}>student mode</span>
        <button onClick={() => dispatch({ type: "TEACHER_CLEAR", key: slideKey })} title="Clear this slide's chat" style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontFamily: FONT.mono, fontSize: 10, color: "#8892B0", opacity: 0.7 }} onMouseEnter={(e) => e.currentTarget.style.opacity = 1} onMouseLeave={(e) => e.currentTarget.style.opacity = 0.7}>⟳</button>
        <button onClick={() => dispatch({ type: "SET_VERA_MODE", mode: "editor" })} title="Close student mode" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#8892B0", padding: 4, lineHeight: 1, opacity: 0.7 }} onMouseEnter={(e) => e.currentTarget.style.opacity = 1} onMouseLeave={(e) => e.currentTarget.style.opacity = 0.7}>✕</button>
      </div>
      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
        {messages.map((m, i) => (
          <div key={i} ref={i === messages.length - 1 && m.role === "assistant" && streamingText === null ? lastMsgRef : null} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{
              padding: "12px 16px", borderRadius: 10, fontSize: 14, lineHeight: 1.6, fontFamily: FONT.body,
              ...(m.role === "user"
                ? { background: T.accent + "30", color: "#fff", alignSelf: "flex-end", maxWidth: "88%", borderBottomRightRadius: 4 }
                : { background: "rgba(255,255,255,0.10)", color: "#E6F1FF", maxWidth: "100%", borderBottomLeftRadius: 4, border: "1px solid rgba(255,255,255,0.06)" })
            }}>
              {m.role === "assistant" ? <TeacherMessage text={m.content} /> : <ChatMarkdown text={m.content} />}
            </div>
            {/* Suggested questions as chips — only show when not streaming */}
            {m.questions?.length > 0 && m.role === "assistant" && i === messages.length - 1 && streamingText === null && (
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 6 }}>
                <span style={{ fontFamily: FONT.mono, fontSize: 10, color: "#8892B0", letterSpacing: "0.05em", fontWeight: 600 }}>EXPLORE FURTHER</span>
                {m.questions.map((q, qi) => (
                  <button key={qi} onClick={() => sendQuestion(q)} style={{
                    textAlign: "left", padding: "9px 14px", fontSize: 13, fontFamily: FONT.body, color: "#93c5fd",
                    background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.30)", borderRadius: 8, cursor: "pointer",
                    lineHeight: 1.45, transition: "all 0.15s"
                  }} onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(59,130,246,0.25)"; e.currentTarget.style.borderColor = "rgba(59,130,246,0.50)"; }}
                     onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(59,130,246,0.15)"; e.currentTarget.style.borderColor = "rgba(59,130,246,0.30)"; }}>
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {/* Streaming bubble — shows progressive text as it arrives */}
        {streamingText !== null && (
          <div ref={lastMsgRef} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ padding: "12px 16px", borderRadius: 10, borderBottomLeftRadius: 4, fontSize: 14, lineHeight: 1.6, fontFamily: FONT.body, background: "rgba(255,255,255,0.10)", color: "#E6F1FF", border: "1px solid rgba(255,255,255,0.06)" }}>
              {streamingText.length > 0 ? <TeacherMessage text={streamingText} /> : <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 14, animation: "spin 1.5s linear infinite", display: "inline-block" }}>🎓</span><span style={{ fontFamily: FONT.mono, fontSize: 13, color: "#93c5fd" }}>thinking...</span></span>}
            </div>
          </div>
        )}
      </div>
      {/* Disclaimer + Input */}
      <div style={{ padding: "0 14px 2px", display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 13 }}>✨</span>
        <span style={{ fontSize: 13, color: "#4a5a72", fontFamily: FONT.body }}>AI answers may contain errors — always verify key facts</span>
      </div>
      <div style={{ padding: "6px 12px 10px", display: "flex", gap: 6 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && input.trim()) sendQuestion(); }}
          placeholder="Ask about this slide..."
          style={{ flex: 1, padding: "9px 14px", fontSize: 14, fontFamily: FONT.body, background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 8, color: "#fff", outline: "none" }} />
        <button onClick={() => sendQuestion()} disabled={!input.trim() || teacherLoading}
          style={{ padding: "9px 16px", fontSize: 13, fontFamily: FONT.mono, fontWeight: 700, background: input.trim() ? T.accent : "rgba(255,255,255,0.1)", color: "#fff", border: "none", borderRadius: 8, cursor: input.trim() ? "pointer" : "default", opacity: input.trim() ? 1 : 0.4 }}>Ask</button>
      </div>
    </div>
  );
}

// Reusable searchable section/module picker — renders a filter input + a
// scrollable list of destination modules. Shared by the slide toolbar's
// "Move to module" popover (Feature 6) and the section-list right-click context
// menu (Feature 5). `mods` = [{ id, title, lane }]; onPick(id) fires on choice.
// The scroll list is tagged data-scroll-container (+ stops wheel propagation) so
// the SlidePanel wheel-nav listener does not change slides while scrolling it,
// and carries .vela-wide-scroll for the wider scrollbar.
function SectionPicker({ mods, onPick, autoFocus = true, emptyLabel = "No other sections" }) {
  const [q, setQ] = useState("");
  const inputRef = useRef(null);
  useEffect(() => { if (autoFocus) { const t = setTimeout(() => inputRef.current?.focus(), 0); return () => clearTimeout(t); } }, []);
  const ql = q.trim().toLowerCase();
  const filtered = ql ? mods.filter((m) => (m.title || "").toLowerCase().includes(ql) || (m.lane || "").toLowerCase().includes(ql)) : mods;
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 200, maxWidth: "calc(100vw - 16px)" }}>
      <div style={{ padding: "4px 8px 2px", fontSize: 9, color: T.textDim, fontFamily: FONT.mono, textTransform: "uppercase" }}>Move to…</div>
      <input ref={inputRef} data-testid="section-search" value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
        placeholder="Search sections…"
        style={{ ...S.input({ padding: "4px 8px", fontSize: 12 }), margin: "0 4px 4px", width: "calc(100% - 8px)" }} />
      <div data-scroll-container data-testid="section-picker-list" className="vela-wide-scroll"
        onWheel={(e) => e.stopPropagation()}
        style={{ maxHeight: 220, overflowY: "auto" }}>
        {mods.length === 0
          ? <div style={{ padding: 8, fontSize: 13, color: T.textDim }}>{emptyLabel}</div>
          : filtered.length === 0
            ? <div style={{ padding: 8, fontSize: 13, color: T.textDim }}>No matches</div>
            : filtered.map((m) => <button key={m.id} data-testid="section-picker-item" onClick={(e) => { e.stopPropagation(); onPick(m.id, e); }}
                style={{ ...S.btn({ fontSize: 13, color: T.text, textAlign: "left" }), display: "block", width: "100%", padding: "6px 8px", borderRadius: 4, background: "transparent", border: "none", cursor: "pointer" }}
                onMouseEnter={(e) => e.currentTarget.style.background = T.accent + "20"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                {m.title}{m.lane ? <span style={{ color: T.textDim, fontSize: 10, marginLeft: 6 }}>{m.lane}</span> : null}
              </button>)}
      </div>
    </div>
  );
}

