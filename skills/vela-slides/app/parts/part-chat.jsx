// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
// ━━━ Chat Markdown Renderer ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function ChatMarkdown({ text }) {
  if (!text) return null;
  if (typeof text !== "string") return <span>{String(text)}</span>;
  const paragraphs = text.split(/\n\n+/);
  return <>{paragraphs.map((para, pi) => {
    const lines = para.split("\n");
    // Check if this paragraph is a bullet list
    const isList = lines.every((l) => /^\s*[-•●✅⚠️❌▸]/.test(l) || l.trim() === "");
    if (isList) {
      const items = lines.filter((l) => l.trim());
      return <div key={pi} style={{ display: "flex", flexDirection: "column", gap: 2, margin: "3px 0" }}>
        {items.map((item, ii) => {
          const cleaned = item.replace(/^\s*[-•●]\s*/, "").replace(/^\s*/, "");
          return <div key={ii} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
            {!/^[✅⚠️❌▸]/.test(item.trim()) && <span style={{ color: T.accent, flexShrink: 0, fontSize: 9, marginTop: 4 }}>●</span>}
            <span>{parseInline(cleaned)}</span>
          </div>;
        })}
      </div>;
    }
    // Regular paragraph
    return <div key={pi} style={{ margin: pi > 0 ? "6px 0 0" : 0 }}>{parseInline(para)}</div>;
  })}</>;
}

// ━━━ Tool Trace Card (agentic UX) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const TOOL_META = {
  find_slides: { icon: "🔍", label: "Search" }, find_replace: { icon: "✏️", label: "Replace" },
  deck_stats: { icon: "📊", label: "Audit" }, batch_restyle: { icon: "🎨", label: "Restyle" },
  add_lane: { icon: "📁", label: "Lane" }, add_item: { icon: "➕", label: "Add" },
  batch_add_items: { icon: "📋", label: "Batch add" }, remove_item: { icon: "🗑", label: "Remove" },
  remove_lane: { icon: "🗑", label: "Remove lane" }, rename_item: { icon: "✏️", label: "Rename" },
  rename_lane: { icon: "✏️", label: "Rename lane" }, move_item: { icon: "↗️", label: "Move" },
  update_status: { icon: "●", label: "Status" }, set_importance: { icon: "⚡", label: "Priority" },
  set_slides: { icon: "🎬", label: "Set slides" }, add_slide: { icon: "🎬", label: "Add slide" }, edit_slide: { icon: "✏️", label: "Edit slide" },
  add_image_to_slide: { icon: "🖼", label: "Image" }, clear_all: { icon: "💥", label: "Clear" },
  set_branding: { icon: "🎨", label: "Brand" },
  list_comments: { icon: "💬", label: "Comments" },
  resolve_comment: { icon: "✅", label: "Resolve" },
};

function ToolTraceCard({ tool, dispatch }) {
  const [open, setOpen] = useState(false);
  const meta = TOOL_META[tool.name] || { icon: "🔧", label: tool.name };
  const running = tool.status === "running";
  const hasJumps = tool.jump?.length > 0;

  // Format input summary (compact)
  const inputSummary = (() => {
    if (!tool.input) return "";
    const keys = Object.keys(tool.input).filter((k) => k !== "slides" && k !== "slide");
    if (keys.length === 0) return "";
    const parts = keys.slice(0, 3).map((k) => { const v = tool.input[k]; return typeof v === "string" ? v.slice(0, 30) : typeof v === "object" ? "..." : String(v); });
    return parts.join(", ");
  })();

  return (
    <div style={{ borderRadius: 6, border: `1px solid ${running ? T.accent + "40" : T.border}`, overflow: "hidden", fontSize: 13, transition: "all 0.2s" }}>
      {/* Header — always visible */}
      <div onClick={() => !running && setOpen(!open)} style={{ padding: "5px 10px", display: "flex", alignItems: "center", gap: 6, cursor: running ? "default" : "pointer", background: running ? T.accent + "08" : open ? T.bgCard : "transparent", transition: "background 0.15s" }}
        onMouseEnter={(e) => { if (!running) e.currentTarget.style.background = T.bgCard; }}
        onMouseLeave={(e) => { if (!running && !open) e.currentTarget.style.background = "transparent"; }}>
        <span style={{ fontSize: 13, flexShrink: 0 }}>{running ? "⏳" : "✓"}</span>
        <span style={{ fontFamily: FONT.mono, fontSize: 10, fontWeight: 700, color: running ? T.accent : T.green, flexShrink: 0 }}>{meta.icon} {meta.label}</span>
        {inputSummary && !open && <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{inputSummary}</span>}
        {running && <span style={{ fontSize: 9, animation: "spin 1s linear infinite", display: "inline-block", marginLeft: "auto" }}>⚡</span>}
        {!running && <span style={{ fontSize: 9, color: T.textDim, marginLeft: "auto" }}>{open ? "▾" : "▸"}</span>}
      </div>
      {/* Expanded detail */}
      {open && !running && <div style={{ padding: "6px 10px", borderTop: `1px solid ${T.border}`, background: T.bg, display: "flex", flexDirection: "column", gap: 4 }}>
        {tool.input && <div style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim, lineHeight: 1.4, whiteSpace: "pre-wrap", maxHeight: 80, overflow: "auto" }}>
          {JSON.stringify(tool.input, (k, v) => (k === "slides" || k === "slide") ? "[slide data]" : v, 2)}
        </div>}
        {tool.result && <div style={{ fontFamily: FONT.body, fontSize: 10, color: T.textMuted, lineHeight: 1.4, borderTop: `1px solid ${T.border}`, paddingTop: 4 }}>{tool.result}</div>}
        {hasJumps && <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginTop: 2 }}>
          {tool.jump.slice(0, 10).map((j, k) => (
            <span key={k} onClick={(e) => { e.stopPropagation(); dispatch({ type: "SELECT", id: j.itemId }); dispatch({ type: "SET_SLIDE_INDEX", index: j.slideIdx }); }}
              style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "1px 6px", borderRadius: 8, background: T.accent + "15", border: `1px solid ${T.accent}30`, cursor: "pointer", fontSize: 9, fontFamily: FONT.mono, fontWeight: 600, color: T.accent }}>
              ▶ {j.title}{j.slideIdx > 0 ? ` #${j.slideIdx + 1}` : ""}
            </span>
          ))}
        </div>}
      </div>}
    </div>
  );
}

// ━━━ Chat Panel ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function ChatPanel({ state, dispatch, isMobile, getLayoutStats }) {
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState([]); // [{dataUrl, name}]
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [state.chatMessages]);

  const addImageFromDataTransfer = (dt) => {
    const items = dt?.items || dt?.files;
    if (!items) return false;
    let found = false;
    for (const item of items) {
      const file = item.getAsFile ? item.getAsFile() : item;
      if (file && file.type?.startsWith("image/")) {
        found = true;
        const reader = new FileReader();
        reader.onload = async () => {
          const compressed = await compressSlideImage(reader.result);
          setPendingImages((prev) => [...prev, { dataUrl: compressed, name: file.name || "image" }]);
        };
        reader.readAsDataURL(file);
      }
    }
    return found;
  };

  const handlePaste = (e) => { if (addImageFromDataTransfer(e.clipboardData)) e.preventDefault(); };
  const handleDrop = (e) => { e.preventDefault(); addImageFromDataTransfer(e.dataTransfer); };
  const removeImage = (idx) => setPendingImages((prev) => prev.filter((_, i) => i !== idx));

  const send = async (directMsg) => {
    const msg = directMsg || input.trim();
    if ((!msg && pendingImages.length === 0) || state.chatLoading) return;
    const images = directMsg ? [] : [...pendingImages];
    if (!directMsg) { setInput(""); setPendingImages([]); }
    dispatch({ type: "ADD_MSG", role: "user", content: msg || "🖼️", images: images.map((i) => i.dataUrl) });
    dispatch({ type: "SET_LOADING", value: true });
    // Add a placeholder assistant message that will accumulate tool traces
    dispatch({ type: "ADD_MSG", role: "assistant", content: "", tools: [], _streaming: true });
    const onUpdate = (lanes, debug) => {
      dispatch({ type: "LOAD_LANES", lanes });
      dispatch({ type: "SET_DEBUG", text: debug });
    };
    const onToolCall = (evt) => {
      dispatch({ type: "STREAM_TOOL", event: evt });
      // Auto-navigate when a tool completes with a jump
      if (evt.type === "done" && evt.jump?.length > 0) {
        const j = evt.jump[0];
        dispatch({ type: "SELECT", id: j.itemId });
        dispatch({ type: "SET_SLIDE_INDEX", index: j.slideIdx ?? 0 });
      }
    };
    const layoutStats = getLayoutStats?.() || null;
    const result = await callVera(msg || "Here are the images I'm attaching.", state.lanes, state.selectedId, state.slideIndex, onUpdate, images, state.branding, state.guidelines, onToolCall, state.chatMessages, layoutStats);
    // Finalize the streaming message: set content + jumps, remove _streaming flag
    dispatch({ type: "FINALIZE_STREAM", content: result.message, jumps: result.jumps });
    // Auto-navigate to the first changed/created slide
    if (result.jumps?.length > 0) {
      const j = result.jumps[0];
      dispatch({ type: "SELECT", id: j.itemId });
      dispatch({ type: "SET_SLIDE_INDEX", index: j.slideIdx ?? 0 });
    }
    if (result.lanes) dispatch({ type: "LOAD_LANES", lanes: result.lanes });
    if (result.branding) dispatch({ type: "SET_BRANDING", branding: result.branding });
    dispatch({ type: "SET_DEBUG", text: result.debug || "" });
    dispatch({ type: "SET_LOADING", value: false });
    // Register late-reply handler for SSE recovery (channel timeout fallback)
    if (result._lateReplyPending) {
      window.__velaLateReply = (msg, jumps) => {
        dispatch({ type: "FINALIZE_STREAM", content: msg, jumps: jumps || [] });
        if (jumps?.length > 0) {
          dispatch({ type: "SELECT", id: jumps[0].itemId });
          dispatch({ type: "SET_SLIDE_INDEX", index: jumps[0].slideIdx ?? 0 });
        }
        dispatch({ type: "SET_DEBUG", text: "🔧 Late reply applied" });
        window.__velaLateReply = null;
      };
    }
  };

  const slideImageCount = extractSlideImages(state.lanes, state.selectedId, state.slideIndex).length;

  // Auto-send bootstrap prompt from NewDeckDialog
  useEffect(() => {
    if (!state._bootstrap) return;
    const { prompt, images } = state._bootstrap;
    dispatch({ type: "CLEAR_BOOTSTRAP" });
    if (!prompt && images.length === 0) return;
    // Inject images into pendingImages so they're sent with the message
    if (images.length > 0) setPendingImages(images.map((dataUrl, i) => ({ dataUrl, name: `ref-${i + 1}` })));
    // Slight delay to let images state settle, then send
    setTimeout(() => {
      const msg = prompt || "Build slides from the attached images.";
      // Replicate the send flow inline (since send() reads pendingImages from state)
      const imgs = images.map((dataUrl, i) => ({ dataUrl, name: `ref-${i + 1}` }));
      setPendingImages([]);
      dispatch({ type: "ADD_MSG", role: "user", content: msg, images: imgs.map((i) => i.dataUrl) });
      dispatch({ type: "SET_LOADING", value: true });
      dispatch({ type: "ADD_MSG", role: "assistant", content: "", tools: [], _streaming: true });
      const onUpdate = (lanes, debug) => { dispatch({ type: "LOAD_LANES", lanes }); dispatch({ type: "SET_DEBUG", text: debug }); };
      const onToolCall = (evt) => { dispatch({ type: "STREAM_TOOL", event: evt }); if (evt.type === "done" && evt.jump?.length > 0) { dispatch({ type: "SELECT", id: evt.jump[0].itemId }); dispatch({ type: "SET_SLIDE_INDEX", index: evt.jump[0].slideIdx ?? 0 }); } };
      callVera(msg, state.lanes, state.selectedId, state.slideIndex, onUpdate, imgs, state.branding, state.guidelines, onToolCall, state.chatMessages).then((result) => {
        dispatch({ type: "FINALIZE_STREAM", content: result.message, jumps: result.jumps });
        if (result.jumps?.length > 0) { dispatch({ type: "SELECT", id: result.jumps[0].itemId }); dispatch({ type: "SET_SLIDE_INDEX", index: result.jumps[0].slideIdx ?? 0 }); }
        if (result.lanes) dispatch({ type: "LOAD_LANES", lanes: result.lanes });
        if (result.branding) dispatch({ type: "SET_BRANDING", branding: result.branding });
        dispatch({ type: "SET_DEBUG", text: result.debug || "" });
        dispatch({ type: "SET_LOADING", value: false });
      });
    }, 100);
  }, [state._bootstrap]);

  return (


    <div style={{ width: isMobile ? "100%" : 260, flex: isMobile ? 1 : undefined, borderLeft: isMobile ? "none" : `1px solid ${T.border}`, background: T.bgPanel, display: "flex", flexDirection: "column", flexShrink: 0 }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }} onDrop={handleDrop}>
      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontFamily: FONT.mono, fontSize: 13, fontWeight: 700, color: T.accent }}>VERA</span><span style={{ fontSize: 9, color: T.textDim, fontFamily: FONT.mono }}>agentic pilot 🔧</span></div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button onClick={() => dispatch({ type: "RESET_CHAT" })} title="Clear chat" style={{ background: "none", border: "none", cursor: "pointer", padding: 2, fontFamily: FONT.mono, fontSize: 10, color: T.textDim, opacity: 0.5 }} onMouseEnter={(e) => e.currentTarget.style.opacity = 1} onMouseLeave={(e) => e.currentTarget.style.opacity = 0.5}>⟳</button>
          <button onClick={() => dispatch({ type: "SET_CHAT", open: false })} style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: isMobile ? "none" : "block" }}><X size={14} color={T.textDim} /></button>
        </div>
      </div>
      {state.lastDebug && <div style={{ padding: "3px 10px", background: T.amber + "12", borderBottom: `1px solid ${T.amber}30`, fontFamily: FONT.mono, fontSize: 9, color: T.amber, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 0 }}>{state.lastDebug}</div>}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
        {state.chatMessages.length === 0 && <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: "20px 10px" }}>
          <span style={{ fontSize: 28, opacity: 0.3 }}>🤖</span>
          <span style={{ fontFamily: FONT.body, fontSize: 14, color: T.textDim, textAlign: "center", lineHeight: 1.5 }}>What would you like to create?</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
            {[
              "Create a 10-slide deck about the AI agentic loop",
              "Make a pitch deck for a SaaS startup",
              "Build a training session on prompt engineering",
              "Create slides explaining how LLMs work",
              "Design an executive summary on AI trends 2026",
            ].map((prompt, i) => (
              <button key={i} onClick={() => send(prompt)}
                style={{ padding: "8px 12px", fontSize: 13, fontFamily: FONT.body, color: T.text, background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 8, cursor: "pointer", textAlign: "left", lineHeight: 1.4, transition: "border-color .15s, background .15s" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.background = T.accent + "10"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.background = T.bgCard; }}>
                {prompt}
              </button>
            ))}
          </div>
        </div>}
        {state.chatMessages.map((m, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4, alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "90%" }}>
            {/* Images */}
            {m.images?.length > 0 && <div style={{ padding: "8px 10px", borderRadius: 6, background: T.accent + "18", display: "flex", gap: 4, flexWrap: "wrap" }}>
              {m.images.map((src, j) => src.startsWith("data:") ?
                <img key={j} src={src} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 4, border: `1px solid ${T.border}` }} /> :
                <div key={j} style={{ width: 48, height: 48, borderRadius: 4, border: `1px solid ${T.border}`, background: T.bgInput, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🖼</div>
              )}
            </div>}
            {/* User message */}
            {m.role === "user" && m.content && <div style={{ padding: "8px 10px", borderRadius: 6, fontSize: 14, lineHeight: 1.5, fontFamily: FONT.body, background: T.accent + "18", color: T.text, wordBreak: "break-word" }}>{m.content}</div>}
            {/* Tool traces (assistant streaming) */}
            {m.role === "assistant" && m.tools?.length > 0 && m.tools.map((tool, ti) => (
              <ToolTraceCard key={ti} tool={tool} dispatch={dispatch} />
            ))}
            {/* Thinking indicator */}
            {m.role === "assistant" && m._streaming && m._thinking && <div style={{ padding: "4px 10px", borderRadius: 6, fontSize: 13, fontFamily: FONT.mono, color: T.accent, display: "flex", alignItems: "center", gap: 6 }}><span style={{ animation: "spin 1s linear infinite", display: "inline-block", fontSize: 10 }}>⚡</span> thinking...</div>}
            {/* Assistant text */}
            {m.role === "assistant" && m.content && m._system && <div style={{ padding: "4px 10px", borderRadius: 6, fontSize: 10, fontFamily: FONT.mono, color: T.textDim, textAlign: "center", opacity: 0.7 }}>{m.content}</div>}
            {m.role === "assistant" && m.content && !m._system && <div style={{ padding: "8px 10px", borderRadius: 6, fontSize: 14, lineHeight: 1.5, fontFamily: FONT.body, background: T.bgCard, color: T.textMuted, wordBreak: "break-word" }}><ChatMarkdown text={m.content} /></div>}
            {/* Jump links */}
            {m.jumps?.length > 0 && <div style={{ display: "flex", gap: 4, flexWrap: "wrap", padding: "0 4px" }}>
              {m.jumps.map((j, k) => (
                <span key={k} onClick={() => { dispatch({ type: "SELECT", id: j.itemId }); dispatch({ type: "SET_SLIDE_INDEX", index: j.slideIdx }); }}
                  style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 8px", borderRadius: 10, background: T.accent + "20", border: `1px solid ${T.accent}40`, cursor: "pointer", fontSize: 9, fontFamily: FONT.mono, fontWeight: 600, color: T.accent, transition: "all .15s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = T.accent + "40"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = T.accent + "20"; }}>
                  <span style={{ fontSize: 9 }}>▶</span> {j.title}{j.slideIdx > 0 ? ` #${j.slideIdx + 1}` : ""}
                </span>
              ))}
            </div>}
          </div>
        ))}
        {state.chatLoading && !state.chatMessages.some((m) => m._streaming) && <div style={{ padding: "8px 10px", borderRadius: 6, fontSize: 13, background: T.bgCard, color: T.accent, fontFamily: FONT.mono, alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6 }}><span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>🔧</span> working...</div>}
      </div>
      {(slideImageCount > 0 || pendingImages.length > 0) && <div style={{ padding: "4px 10px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {slideImageCount > 0 && <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.accent, fontWeight: 600 }}>👁 {slideImageCount} from slide</span>}
        {pendingImages.length > 0 && <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.green, fontWeight: 600 }}>📎 {pendingImages.length} attached</span>}
      </div>}
      {pendingImages.length > 0 && <div style={{ padding: "4px 10px", display: "flex", gap: 4, flexWrap: "wrap", borderTop: `1px solid ${T.border}` }}>
        {pendingImages.map((img, i) => (
          <div key={i} style={{ position: "relative" }}>
            <img src={img.dataUrl} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 4, border: `1px solid ${T.border}` }} />
            <span onClick={() => removeImage(i)} style={{ position: "absolute", top: -4, right: -4, width: 14, height: 14, borderRadius: "50%", background: T.red, color: "#fff", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", lineHeight: 1 }}>×</span>
          </div>
        ))}
      </div>}
      <div style={{ padding: "8px 10px", borderTop: `1px solid ${T.border}`, display: "flex", gap: 6 }}>
        <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} onPaste={handlePaste}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={pendingImages.length > 0 ? "Describe what to do with images..." : "Tell Vera... (paste images here)"}
          rows={2} style={S.input({ padding: "6px 8px", borderRadius: 4, resize: "none", lineHeight: 1.4 })} />
        <button onClick={() => send()} disabled={state.chatLoading || (!input.trim() && pendingImages.length === 0)}
          style={{ padding: "0 12px", background: state.chatLoading || (!input.trim() && pendingImages.length === 0) ? T.border : T.accent, color: "#fff", border: "none", borderRadius: 4, cursor: state.chatLoading || (!input.trim() && pendingImages.length === 0) ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 700, alignSelf: "stretch" }}>↑</button>
      </div>
    </div>
  );
}

// ━━━ JSON Clipboard Modal ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function JsonClipboardModal({ mode, setMode, state, dispatch }) {
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState(mode);
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);

  // ESC to close
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") setMode(null); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Find selected concept
  let concept = null;
  for (const l of state.lanes) { const f = l.items.find((i) => i.id === state.selectedId); if (f) { concept = f; break; } }

  // Build copy JSON
  useEffect(() => {
    setError(null);
    if (tab === "copy") {
      if (concept) {
        const data = { concepts: [{ id: concept.id, title: concept.title, slides: concept.slides }] };
        setText(JSON.stringify(data, null, 2));
      } else {
        const save = extractSave(state);
        const cleaned = { ...save, chatMessages: save.chatMessages?.map((m) => m.images ? { ...m, images: [] } : m) || [] };
        setText(JSON.stringify({ _vela: 1, data: cleaned }, null, 2));
      }
      setCopied(false);
    } else {
      setText("");
      setCopied(false);
    }
  }, [tab]);

  const handleCopy = async () => {
    try { velaClipboard(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };

  const handlePaste = () => {
    setError(null);
    let raw;
    try { raw = JSON.parse(text); } catch { setError("Invalid JSON — check syntax"); return; }

    if (raw.concepts && Array.isArray(raw.concepts)) {
      dispatch({ type: "IMPORT_CONCEPTS", concepts: raw.concepts });
      setMode(null);
    } else if (raw._vela && raw.data) {
      const sanitized = validateAndSanitizeDeck(raw.data);
      dispatch({ type: "LOAD", payload: sanitized });
      setMode(null);
    } else if (raw.lanes) {
      const sanitized = validateAndSanitizeDeck(raw);
      dispatch({ type: "LOAD", payload: sanitized });
      setMode(null);
    } else if (Array.isArray(raw)) {
      dispatch({ type: "IMPORT_CONCEPTS", concepts: [{ title: "Imported Slides", slides: raw }] });
      setMode(null);
    } else {
      setError("Unrecognized format. Expected: {concepts:[...]}, {lanes:[...]}, or slides array.");
    }
  };

  return (
    <div onClick={() => setMode(null)} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 8, width: 560, maxWidth: "90vw", maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 16px 48px rgba(0,0,0,0.4)" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: "flex", gap: 0 }}>
            {["copy", "paste"].map((t) => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: "4px 14px", fontSize: 13, fontFamily: FONT.mono, fontWeight: 700, cursor: "pointer",
                background: tab === t ? T.accent + "20" : "transparent", color: tab === t ? T.accent : T.textMuted,
                border: `1px solid ${tab === t ? T.accent : T.border}`, borderRadius: t === "copy" ? "4px 0 0 4px" : "0 4px 4px 0",
                textTransform: "uppercase", letterSpacing: "0.05em"
              }}>{t}</button>
            ))}
          </div>
          <button onClick={() => setMode(null)} style={{ background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 16, padding: 4 }}>✕</button>
        </div>

        {/* Info */}
        <div style={{ padding: "8px 16px", fontFamily: FONT.mono, fontSize: 10, color: T.textDim }}>
          {tab === "copy"
            ? (concept ? `Concept: "${concept.title}" · ${concept.slides.length} slides` : "Full deck state (no concept selected)")
            : "Paste JSON: {concepts: [{title, slides}]}, full deck export, or raw slides array"
          }
        </div>

        {/* Textarea */}
        <div style={{ flex: 1, padding: "0 16px", minHeight: 0 }}>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => { if (tab === "paste") { setText(e.target.value); setError(null); } }}
            readOnly={tab === "copy"}
            placeholder={tab === "paste" ? '{\n  "concepts": [\n    { "title": "My Deck", "slides": [...] }\n  ]\n}' : ""}
            style={{
              width: "100%", height: 320, resize: "none", padding: 12, fontFamily: FONT.mono, fontSize: 13, lineHeight: 1.5,
              background: T.bg, color: T.text, border: `1px solid ${T.border}`, borderRadius: 6, outline: "none",
              tabSize: 2,
            }}
            onFocus={(e) => tab === "copy" && e.target.select()}
          />
        </div>

        {/* Error */}
        {error && <div style={{ padding: "4px 16px", fontFamily: FONT.mono, fontSize: 10, color: T.red, fontWeight: 600 }}>⚠ {error}</div>}

        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "10px 16px", borderTop: `1px solid ${T.border}` }}>
          {tab === "copy" ? (
            <button onClick={handleCopy} style={{
              padding: "6px 16px", fontSize: 13, fontFamily: FONT.mono, fontWeight: 700, cursor: "pointer",
              background: copied ? T.green : T.accent, color: "#fff", border: "none", borderRadius: 4,
            }}>{copied ? "✓ Copied!" : "Copy to clipboard"}</button>
          ) : (
            <button onClick={handlePaste} disabled={!text.trim()} style={{
              padding: "6px 16px", fontSize: 13, fontFamily: FONT.mono, fontWeight: 700, cursor: text.trim() ? "pointer" : "default",
              background: text.trim() ? T.green : T.border, color: text.trim() ? "#fff" : T.textDim, border: "none", borderRadius: 4,
            }}>Import JSON</button>
          )}
        </div>
      </div>
    </div>
  );
}


