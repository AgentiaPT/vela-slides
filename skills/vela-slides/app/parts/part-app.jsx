// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
// ━━━ Modal Backdrop (shared) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function ModalBackdrop({ onClose, extraKeys, children }) {
  useEffect(() => {
    const h = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (extraKeys?.(e)) { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, extraKeys]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 10001, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 12, padding: "24px 28px", maxWidth: 520, width: "90vw", boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
        {children}
      </div>
    </div>
  );
}

// ━━━ Changelog Dialog ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function ChangelogDialog({ onClose }) {
  const [showDeps, setShowDeps] = React.useState(false);
  return (
    <ModalBackdrop onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <VelaIcon size={22} />
          <span style={{ fontFamily: FONT.mono, fontSize: 16, fontWeight: 700, color: T.accent, letterSpacing: 2 }}>VELA</span>
          <span style={{ fontFamily: FONT.mono, fontSize: 11, color: T.textDim }}>v{VELA_VERSION}</span>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 18, padding: 4 }}>✕</button>
      </div>
      <div style={{ fontFamily: FONT.mono, fontSize: 9, fontWeight: 700, color: T.textDim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>Recent Changes</div>
      {VELA_CHANGELOG.slice(0, 3).map((c, i) => (
        <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0", borderTop: i > 0 ? `1px solid ${T.border}` : "none" }}>
          <span style={{ fontFamily: FONT.mono, fontSize: 10, fontWeight: 700, color: i === 0 ? T.accent : T.textDim, flexShrink: 0, minWidth: 32 }}>v{c.v}</span>
          <span style={{ fontFamily: FONT.body, fontSize: 11, color: T.text, lineHeight: 1.4 }}>{c.d}</span>
        </div>
      ))}
      {/* \u2500\u2500 Dependencies (collapsible) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */}
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
        <div onClick={() => setShowDeps(!showDeps)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 6, userSelect: "none" }}>
          <span style={{ fontFamily: FONT.mono, fontSize: 9, fontWeight: 700, color: T.textDim, letterSpacing: "0.1em", textTransform: "uppercase" }}>Dependencies & Credits</span>
          <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim, transition: "transform .15s", transform: showDeps ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
        </div>
        {showDeps && <div style={{ marginTop: 6 }}>
          {[
            { name: "React 18+", license: "MIT", url: "https://react.dev", src: "https://github.com/facebook/react", note: "UI framework" },
            { name: "Lucide React", license: "ISC", url: "https://lucide.dev", src: "https://github.com/lucide-icons/lucide", note: "280+ icons" },
            { name: "html2canvas", license: "MIT", url: "https://html2canvas.hertzen.com", src: "https://github.com/niklasvh/html2canvas", note: "v1.4.1 \u00b7 PDF export" },
            { name: "Google Fonts", license: "OFL 1.1", url: "https://fonts.google.com", src: null, note: "Sora, DM Sans, Space Mono" },
            { name: "Anthropic API", license: "\u2014", url: "https://docs.anthropic.com", src: null, note: "Vera AI engine" },
          ].map((dep, i) => (
            <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 5, padding: "2px 0", fontSize: 10 }}>
              <a href={dep.url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: FONT.mono, fontSize: 9, fontWeight: 600, color: T.accent, textDecoration: "none", flexShrink: 0 }}>{dep.name}</a>
              {dep.src && <a href={dep.src} target="_blank" rel="noopener noreferrer" style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim, textDecoration: "none", opacity: 0.7 }}>\u2197</a>}
              <span style={{ fontFamily: FONT.body, fontSize: 9, color: T.textDim }}>{dep.note}</span>
              <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim, background: `${T.textDim}15`, padding: "0px 3px", borderRadius: 2 }}>{dep.license}</span>
            </div>
          ))}
          <div style={{ fontFamily: FONT.body, fontSize: 9, color: T.textDim, marginTop: 4 }}>PDF writer, SVG pipeline, state & storage \u2014 zero extra deps. <a href="https://github.com/agentiapt/vela-slides/blob/main/NOTICE" target="_blank" rel="noopener noreferrer" style={{ color: T.accent, textDecoration: "none" }}>Full SBOM</a></div>
        </div>}
      </div>
      {/* \u2500\u2500 Footer \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */}
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${T.border}`, textAlign: "center", display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontFamily: FONT.body, fontSize: 10, color: T.textMuted }}>© 2025-present <a href="https://www.linkedin.com/in/rquintino/" target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, color: T.text, textDecoration: "none" }}>Rui Quintino</a> · <a href="https://github.com/agentiapt/vela-slides/blob/main/LICENSE" target="_blank" rel="noopener noreferrer" style={{ color: T.accent, textDecoration: "none" }}>ELv2</a></span>
        <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
          <a href="https://github.com/agentiapt/vela-slides" target="_blank" rel="noopener noreferrer" style={{ fontFamily: FONT.mono, fontSize: 9, color: T.accent, textDecoration: "none" }}>⛵ GitHub</a>
          <a href="https://agentia.pt" target="_blank" rel="noopener noreferrer" style={{ fontFamily: FONT.mono, fontSize: 9, color: T.accent, textDecoration: "none" }}>🚀 agentIA</a>
          <a href="mailto:info@agentia.pt" style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim, textDecoration: "none" }}>✉ Commercial</a>
        </div>
      </div>
    </ModalBackdrop>
  );
}

// ━━━ Comments Panel (review sidebar) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function CommentsPanel({ state, dispatch, isMobile }) {
  const [filter, setFilter] = useState("open"); // "all" | "open" | "resolved"
  const [selected, setSelected] = useState(new Set()); // for multi-select
  const [newComment, setNewComment] = useState("");
  const allComments = collectComments(state.lanes, filter === "all" ? null : (c) => c.status === filter);
  const openCount = collectComments(state.lanes, (c) => c.status === "open").length;
  const resolvedCount = collectComments(state.lanes, (c) => c.status === "resolved").length;

  const toggleSelect = (id) => setSelected((prev) => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });

  const grouped = {};
  for (const c of allComments) { if (!grouped[c.itemTitle]) grouped[c.itemTitle] = []; grouped[c.itemTitle].push(c); }

  const copyForAgent = () => { velaClipboard(formatCommentsForAgent(state.lanes)); };

  return (
    <div style={{ width: isMobile ? "100%" : 260, display: "flex", flexDirection: "column", borderLeft: isMobile ? "none" : `1px solid ${T.border}`, background: T.bgPanel, flexShrink: 0, height: "100%" }}>
      {/* Header */}
      <div style={{ padding: "8px 12px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontFamily: FONT.mono, fontSize: 11, fontWeight: 700, color: T.accent, letterSpacing: "0.08em" }}>COMMENTS</span>
        {openCount > 0 && <span style={{ fontSize: 9, fontFamily: FONT.mono, fontWeight: 700, color: "#fff", background: T.amber, borderRadius: 8, padding: "0 5px", minWidth: 16, textAlign: "center", lineHeight: "16px" }}>{openCount}</span>}
        <div style={{ flex: 1 }} />
        {!isMobile && <button onClick={() => { dispatch({ type: "SET_COMMENTS_PANEL", open: false }); dispatch({ type: "SET_REVIEW_MODE", value: false }); }} style={{ background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 14, padding: "0 2px" }}>✕</button>}
      </div>
      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${T.border}` }}>
        {[["all", `All (${openCount + resolvedCount})`], ["open", `Open (${openCount})`], ["resolved", `Done (${resolvedCount})`]].map(([key, label]) => (
          <button key={key} onClick={() => setFilter(key)} style={{ flex: 1, padding: "6px 4px", fontSize: 9, fontFamily: FONT.mono, fontWeight: 700, background: filter === key ? T.accent + "15" : "transparent", color: filter === key ? T.accent : T.textDim, border: "none", borderBottom: filter === key ? `2px solid ${T.accent}` : "2px solid transparent", cursor: "pointer" }}>{label}</button>
        ))}
      </div>
      {/* Quick add comment */}
      {state.selectedId && <div style={{ padding: "6px 8px", borderBottom: `1px solid ${T.border}`, display: "flex", gap: 4 }}>
        <input value={newComment} onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && newComment.trim()) { dispatch({ type: "ADD_COMMENT", itemId: state.selectedId, slideIndex: state.slideIndex, text: newComment.trim() }); setNewComment(""); } if (e.key === "Escape") setNewComment(""); }}
          placeholder={`Comment on slide ${state.slideIndex + 1}...`}
          style={{ flex: 1, padding: "4px 8px", fontSize: 10, fontFamily: FONT.body, background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 4, color: T.text, outline: "none", minWidth: 0 }} />
        <button onClick={() => { if (newComment.trim()) { dispatch({ type: "ADD_COMMENT", itemId: state.selectedId, slideIndex: state.slideIndex, text: newComment.trim() }); setNewComment(""); } }} disabled={!newComment.trim()} style={S.primaryBtn({ padding: "4px 8px", fontSize: 9, opacity: newComment.trim() ? 1 : 0.4 })}>Add</button>
      </div>}
      {/* Comments list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
        {allComments.length === 0 && <div style={{ padding: "20px 12px", textAlign: "center", fontFamily: FONT.body, fontSize: 11, color: T.textDim, lineHeight: 1.6 }}>
          {filter === "open" ? "No open comments.\nAdd one above or use 💬 on blocks." : filter === "resolved" ? "No resolved comments." : "No comments yet."}
        </div>}
        {Object.entries(grouped).map(([modTitle, comments]) => (
          <div key={modTitle}>
            <div style={{ padding: "6px 12px 2px", fontFamily: FONT.mono, fontSize: 9, fontWeight: 700, color: T.textMuted, letterSpacing: "0.05em", textTransform: "uppercase" }}>{modTitle}</div>
            {comments.map((c) => (
              <div key={c.id} style={{ padding: "4px 12px", display: "flex", alignItems: "flex-start", gap: 5, opacity: c.status === "resolved" ? 0.5 : 1, background: selected.has(c.id) ? T.accent + "10" : "transparent" }}>
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} style={{ marginTop: 2, accentColor: T.accent, flexShrink: 0 }} />
                <span onClick={() => dispatch({ type: c.status === "open" ? "RESOLVE_COMMENT" : "REOPEN_COMMENT", itemId: c.itemId, slideIndex: c.slideIndex, commentId: c.id })} style={{ cursor: "pointer", fontSize: 11, flexShrink: 0, marginTop: 1 }}>{c.status === "open" ? "○" : "●"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontFamily: FONT.body, color: T.text, textDecoration: c.status === "resolved" ? "line-through" : "none", wordBreak: "break-word", lineHeight: 1.4 }}>{c.text}</div>
                  <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 1 }}>
                    <span onClick={() => { dispatch({ type: "SELECT", id: c.itemId, slideIndex: c.slideIndex ?? 0 }); }} style={{ fontSize: 9, fontFamily: FONT.mono, color: T.accent, cursor: "pointer" }}>{c.slideIndex != null ? `s${c.slideIndex + 1}` : "mod"}</span>
                    {c.anchor && <span style={{ fontSize: 9, fontFamily: FONT.mono, color: T.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>"{c.anchor}"</span>}
                  </div>
                </div>
                <span onClick={() => dispatch({ type: c.status === "open" ? "RESOLVE_COMMENT" : "REOPEN_COMMENT", itemId: c.itemId, slideIndex: c.slideIndex, commentId: c.id })} style={{ fontSize: 9, fontFamily: FONT.mono, color: c.status === "open" ? T.green : T.textDim, cursor: "pointer", opacity: 0.6, flexShrink: 0, padding: "1px 3px", borderRadius: 3 }} title={c.status === "open" ? "Resolve" : "Reopen"}>{c.status === "open" ? "✓" : "↩"}</span>
                <span onClick={() => dispatch({ type: "REMOVE_COMMENT", itemId: c.itemId, slideIndex: c.slideIndex, commentId: c.id })} style={{ fontSize: 10, color: T.red, cursor: "pointer", opacity: 0.5, flexShrink: 0, padding: "1px 3px", borderRadius: 3 }} title="Delete">✕</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {/* Footer with batch actions */}
      <div style={{ borderTop: `1px solid ${T.border}`, padding: "6px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
        {selected.size > 0 && <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => { for (const id of selected) { const c = allComments.find((x) => x.id === id); if (c && c.status === "open") dispatch({ type: "RESOLVE_COMMENT", itemId: c.itemId, slideIndex: c.slideIndex, commentId: c.id }); } setSelected(new Set()); }} style={S.btn({ flex: 1, fontSize: 9, padding: "3px 4px" })}>Resolve ({selected.size})</button>
          <button onClick={() => { for (const id of selected) { const c = allComments.find((x) => x.id === id); if (c) dispatch({ type: "REMOVE_COMMENT", itemId: c.itemId, slideIndex: c.slideIndex, commentId: c.id }); } setSelected(new Set()); }} style={S.btn({ flex: 1, fontSize: 9, padding: "3px 4px", color: T.red })}>Delete ({selected.size})</button>
        </div>}
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => { dispatch({ type: "RESOLVE_ALL_COMMENTS" }); }} disabled={openCount === 0} style={S.btn({ flex: 1, fontSize: 9, padding: "3px 4px", opacity: openCount > 0 ? 1 : 0.4 })}>Resolve All</button>
          <button onClick={() => { dispatch({ type: "CLEAR_RESOLVED_COMMENTS" }); }} disabled={resolvedCount === 0} style={S.btn({ flex: 1, fontSize: 9, padding: "3px 4px", opacity: resolvedCount > 0 ? 1 : 0.4 })}>Clear Done</button>
        </div>
        <button onClick={copyForAgent} disabled={openCount === 0} style={S.primaryBtn({ fontSize: 9, padding: "4px 8px", opacity: openCount > 0 ? 1 : 0.4, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 })}>📋 Copy for Agent</button>
      </div>
    </div>
  );
}

// ━━━ New Deck Dialog ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function NewDeckDialog({ onClose, onSubmit }) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState([]); // [{dataUrl, fileName}]
  const fileRef = useRef(null);

  const addImages = (files) => {
    for (const file of files) {
      if (!file.type?.startsWith("image/")) continue;
      const reader = new FileReader();
      reader.onload = async () => {
        const compressed = await compressSlideImage(reader.result);
        setImages((prev) => [...prev, { dataUrl: compressed, fileName: file.name }]);
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const item of items) { const f = item.getAsFile?.(); if (f?.type?.startsWith("image/")) files.push(f); }
    if (files.length > 0) { e.preventDefault(); addImages(files); }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const files = [];
    for (const item of (e.dataTransfer?.files || [])) { if (item.type?.startsWith("image/")) files.push(item); }
    if (files.length) addImages(files);
  };

  const submit = () => {
    if (!name.trim() && !prompt.trim() && images.length === 0) return;
    onSubmit({ title: name.trim() || "Untitled", prompt: prompt.trim(), images: images.map((i) => i.dataUrl) });
    onClose();
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 22 }}>⛵</span>
          <span style={{ fontFamily: FONT.display, fontSize: 18, fontWeight: 700, color: T.text }}>New Deck</span>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 18, padding: 4 }}>✕</button>
      </div>

      {/* Deck name */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontFamily: FONT.mono, fontSize: 11, fontWeight: 600, color: T.textMuted, display: "block", marginBottom: 5 }}>Deck Name</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="My Presentation"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          style={{ width: "100%", padding: "10px 12px", fontSize: 15, fontFamily: FONT.body, fontWeight: 600, color: T.text, background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 8, outline: "none", boxSizing: "border-box" }} />
      </div>

      {/* Prompt */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontFamily: FONT.mono, fontSize: 11, fontWeight: 600, color: T.textMuted, display: "block", marginBottom: 5 }}>Starting Prompt <span style={{ fontWeight: 400, color: T.textDim }}>— what should Vera build?</span></label>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={"e.g. Create a 10-slide pitch deck on AI agents\nwith sections: Intro, Architecture, Demo, Roadmap"}
          onPaste={handlePaste}
          rows={4}
          style={{ width: "100%", padding: "10px 12px", fontSize: 14, fontFamily: FONT.body, color: T.text, background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 8, outline: "none", resize: "vertical", lineHeight: 1.5, boxSizing: "border-box" }} />
      </div>

      {/* Image upload */}
      <div style={{ marginBottom: 18 }}>
        <label style={{ fontFamily: FONT.mono, fontSize: 11, fontWeight: 600, color: T.textMuted, display: "block", marginBottom: 5 }}>Reference Images <span style={{ fontWeight: 400, color: T.textDim }}>— optional, paste or drop</span></label>
        <div onDrop={handleDrop} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
          style={{ border: `1px dashed ${T.border}`, borderRadius: 8, padding: images.length > 0 ? "8px" : "16px 12px", background: T.bgInput, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", minHeight: 50, cursor: "pointer" }}
          onClick={() => { if (images.length === 0) fileRef.current?.click(); }}>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }}
            onChange={(e) => { addImages(Array.from(e.target.files || [])); e.target.value = ""; }} />
          {images.length === 0 && (
            <div style={{ flex: 1, textAlign: "center" }}>
              <span style={{ fontFamily: FONT.mono, fontSize: 11, color: T.textDim }}>📷 Click, paste, or drop images here</span>
            </div>
          )}
          {images.map((img, i) => (
            <div key={i} style={{ position: "relative", width: 56, height: 56, borderRadius: 6, overflow: "hidden", border: `1px solid ${T.border}`, flexShrink: 0 }}>
              <img src={img.dataUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <button onClick={(e) => { e.stopPropagation(); setImages((prev) => prev.filter((_, j) => j !== i)); }}
                style={{ position: "absolute", top: 1, right: 1, width: 16, height: 16, borderRadius: "50%", background: "rgba(0,0,0,0.7)", color: "#fff", border: "none", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>✕</button>
            </div>
          ))}
          {images.length > 0 && (
            <button onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
              style={{ width: 56, height: 56, borderRadius: 6, border: `1px dashed ${T.border}`, background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: T.textDim, flexShrink: 0 }}>+</button>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={onClose} style={S.btn({ padding: "8px 16px", fontSize: 14, color: T.textMuted, borderRadius: 6 })}>Cancel</button>
        <button onClick={submit}
          style={{ padding: "8px 20px", fontSize: 14, fontFamily: FONT.body, fontWeight: 600, color: "#fff", background: T.accent, border: "none", borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          {"🚀"} Create & Build
        </button>
      </div>
    </ModalBackdrop>
  );
}

// ━━━ Keyboard Shortcuts Overlay ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const _questionKey = (e) => e.key === "?";
function ShortcutHelp({ onClose }) {
  const groups = [
    { title: "Navigation", items: [
      ["← →", "Previous / next slide"],
      ["Space", "Next slide (same as →)"],
      ["↑ ↓", "Previous / next module"],
      ["", "Auto-crosses lane boundaries"],
      ["[", "Toggle navigator panel"],
      ["G", "Toggle gallery view"],
    ]},
    { title: "Presentation", items: [
      ["F", "Toggle fullscreen"],
      ["F5", "Enter fullscreen (blocks reload)"],
      ["T", "Toggle TOC panel (fullscreen)"],
      ["D", "Toggle dark / light theme"],
      ["+ / −", "Scale font up / down"],
      ["0", "Reset font scale"],
    ]},
    { title: "Editing", items: [
      ["⌘Z / Ctrl+Z", "Undo"],
      ["⌘⇧Z / Ctrl+Y", "Redo"],
      ["Click text", "Edit inline on slide"],
      ["Ctrl+C", "Copy slide to clipboard"],
      ["Ctrl+V", "Paste slide / image / JSON"],
      ["Del", "Delete current slide"],
      ["R", "Toggle review / comments"],
    ]},
    { title: "AI Tools", items: [
      ["Shift+I", "Quick improve slide via Vera"],
      ["E", "Quick edit slide by prompt"],
      ["N", "New slide by prompt"],
      ["1 – 4", "Preview variant"],
      ["0", "Back to original"],
      ["Enter", "Accept previewed variant"],
      ["Esc", "Dismiss alternatives"],
    ]},
  ];
  return (
    <ModalBackdrop onClose={onClose} extraKeys={_questionKey}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>⌨️</span>
          <span style={{ fontFamily: FONT.display, fontSize: 16, fontWeight: 700, color: T.text }}>Keyboard Shortcuts</span>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 18, padding: 4 }}>✕</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {groups.map((g) => (
          <div key={g.title}>
            <div style={{ fontFamily: FONT.mono, fontSize: 10, fontWeight: 700, color: T.accent, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>{g.title}</div>
            {g.items.map(([key, desc], i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                {key ? <kbd style={{ fontFamily: FONT.mono, fontSize: 10, fontWeight: 600, color: T.text, background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 4, padding: "2px 7px", minWidth: 28, textAlign: "center", whiteSpace: "nowrap" }}>{key}</kbd>
                  : <span style={{ minWidth: 28 }} />}
                <span style={{ fontFamily: FONT.body, fontSize: 11, color: key ? T.textMuted : T.textDim, fontStyle: key ? "normal" : "italic" }}>{desc}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${T.border}`, fontFamily: FONT.mono, fontSize: 9, color: T.textDim, textAlign: "center" }}>Press <kbd style={{ fontFamily: FONT.mono, fontSize: 9, background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 3, padding: "1px 5px" }}>?</kbd> to toggle · <span style={{ color: T.accent }}>VELA v{VELA_VERSION}</span></div>
    </ModalBackdrop>
  );
}

// ━━━ Session Cost Badge ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const fmtCost = (v) => v < 0.01 ? (v * 100).toFixed(1) + "¢" : "$" + v.toFixed(2);
const fmtTokens = (n) => n >= 1000 ? (n / 1000).toFixed(1) + "K" : String(n);

function CostBadge() {
  const [open, setOpen] = useState(false);
  const [, rerender] = useReducer((x) => x + 1, 0);

  useEffect(() => {
    const unsub = velaSessionStats.onChange(rerender);
    return unsub;
  }, []);

  const stats = velaSessionStats;
  const cost = stats.totalCost;
  const calls = stats.totalCalls;

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((v) => !v)} style={{
        ...S.btn({ padding: "4px 10px", fontSize: 11, borderRadius: 4, display: "flex", alignItems: "center", gap: 4 }),
        color: calls > 0 ? T.accent : T.textMuted, fontFamily: FONT.mono, fontWeight: 600,
        background: open ? T.accent + "18" : "transparent",
      }}>{calls > 0 ? `💲${cost < 0.01 ? (cost * 100).toFixed(1) + "¢" : cost.toFixed(2)}` : "💲—"}</button>

      {open && calls > 0 && <>
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 9999,
          background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 10,
          boxShadow: "0 8px 40px rgba(0,0,0,0.5)", backdropFilter: "blur(12px)",
          minWidth: 320, maxWidth: 400, fontFamily: FONT.mono, overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Session Cost</span>
            <span style={{ fontSize: 11, color: T.textDim }}>{calls} call{calls !== 1 ? "s" : ""}</span>
          </div>

          {/* Summary */}
          <div style={{ padding: "10px 16px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, borderBottom: `1px solid ${T.border}` }}>
            <div>
              <div style={{ fontSize: 9, color: T.textDim, textTransform: "uppercase" }}>Total Cost</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.accent }}>{fmtCost(cost)}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: T.textDim, textTransform: "uppercase" }}>Input</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{fmtTokens(stats.totalInputTokens)}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: T.textDim, textTransform: "uppercase" }}>Output</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{fmtTokens(stats.totalOutputTokens)}</div>
            </div>
          </div>

          {/* Cache stats (if any) */}
          {(stats.totalCacheReadTokens > 0 || stats.totalCacheCreateTokens > 0) && (
            <div style={{ padding: "6px 16px", display: "flex", gap: 16, borderBottom: `1px solid ${T.border}`, fontSize: 10, color: T.textDim }}>
              <span>Cache read: {fmtTokens(stats.totalCacheReadTokens)}</span>
              <span>Cache create: {fmtTokens(stats.totalCacheCreateTokens)}</span>
            </div>
          )}

          {/* By type */}
          <div style={{ padding: "8px 16px", borderBottom: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 9, color: T.textDim, textTransform: "uppercase", marginBottom: 6 }}>By Type</div>
            {Object.entries(stats.byType).sort((a, b) => b[1].cost - a[1].cost).map(([type, data]) => (
              <div key={type} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 11 }}>
                <span style={{ color: T.text, minWidth: 80 }}>{type}</span>
                <span style={{ color: T.textDim, minWidth: 40, textAlign: "right" }}>{data.calls}×</span>
                <div style={{ flex: 1, height: 4, background: T.border, borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(100, (data.cost / cost) * 100)}%`, background: T.accent, borderRadius: 2 }} />
                </div>
                <span style={{ color: T.accent, minWidth: 48, textAlign: "right", fontWeight: 600 }}>{fmtCost(data.cost)}</span>
              </div>
            ))}
          </div>

          {/* Call log (last 10) */}
          <div style={{ maxHeight: 180, overflowY: "auto", padding: "6px 0" }}>
            <div style={{ padding: "2px 16px", fontSize: 9, color: T.textDim, textTransform: "uppercase", marginBottom: 4 }}>Recent Calls</div>
            {[...stats.calls].reverse().slice(0, 15).map((c, i) => (
              <div key={i} style={{ padding: "3px 16px", fontSize: 10, display: "flex", gap: 6, alignItems: "center", color: T.textDim }}>
                <span style={{ color: T.text, minWidth: 70 }}>{c.type}</span>
                <span>{fmtTokens(c.input_tokens)}→{fmtTokens(c.output_tokens)}</span>
                {c.tool_calls > 0 && <span style={{ color: T.accent }}>🔧{c.tool_calls}</span>}
                <span style={{ marginLeft: "auto", fontSize: 9 }}>{(c.duration_ms / 1000).toFixed(1)}s</span>
                <span style={{ color: T.accent, fontWeight: 600 }}>{fmtCost(
                  (c.input_tokens * VELA_PRICING.input + c.output_tokens * VELA_PRICING.output
                    + (c.cache_read_tokens || 0) * VELA_PRICING.cacheRead + (c.cache_create_tokens || 0) * VELA_PRICING.cacheCreate) / 1_000_000
                )}</span>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{ padding: "8px 16px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 9, color: T.textDim }}>Sonnet 4 · ${VELA_PRICING.input}/$15 per M tokens</span>
            <button onClick={() => { velaSessionStats.reset(); setOpen(false); }} style={S.btn({ fontSize: 9, padding: "2px 8px", color: T.textDim })}>Reset</button>
          </div>
        </div>
      </>}
    </div>
  );
}

// ━━━ Main ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ━━━ Item Fingerprint (for merge detection) ━━━━━━━━━━━━━━━━━━━━━━━
function itemFingerprint(item) {
  const str = JSON.stringify(item.slides || []);
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
  return h.toString(36);
}

// ━━━ Merge Patch Dialog ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function MergePatchDialog({ localDeck, patchDeck, onComplete }) {
  // Compute diffs
  const localItems = new Map();
  for (const lane of localDeck.lanes || []) for (const item of lane.items || []) {
    localItems.set(item.id, { item, laneId: lane.id, laneTitle: lane.title, fp: itemFingerprint(item) });
  }
  const patchItems = new Map();
  for (const lane of patchDeck.lanes || []) for (const item of lane.items || []) {
    patchItems.set(item.id, { item, laneId: lane.id, laneTitle: lane.title, fp: itemFingerprint(item) });
  }

  // Categorize
  const autoKeep = []; // only in local
  const autoAdd = [];  // only in patch
  const unchanged = []; // same hash
  const conflicts = []; // both exist, different hash

  for (const [id, local] of localItems) {
    const patch = patchItems.get(id);
    if (!patch) { autoKeep.push(local); }
    else if (local.fp === patch.fp) { unchanged.push({ local, patch }); }
    else { conflicts.push({ id, local, patch }); }
  }
  for (const [id, patch] of patchItems) {
    if (!localItems.has(id)) { autoAdd.push(patch); }
  }

  // New lanes only in patch
  const localLaneIds = new Set((localDeck.lanes || []).map(l => l.id));
  const newLanes = (patchDeck.lanes || []).filter(l => !localLaneIds.has(l.id));

  // Track conflict resolutions: "mine" | "theirs" | "both"
  const [resolutions, setResolutions] = React.useState(() => {
    const m = {};
    for (const c of conflicts) m[c.id] = "theirs"; // default to new version
    return m;
  });

  const setRes = (id, val) => setResolutions(prev => ({ ...prev, [id]: val }));

  const handleApply = () => {
    // Start from local deck as base
    const merged = JSON.parse(JSON.stringify(localDeck));

    // Apply conflict resolutions
    for (const c of conflicts) {
      const res = resolutions[c.id];
      if (res === "mine") continue; // keep as-is
      // Find item in merged deck and replace or add
      for (const lane of merged.lanes) {
        const idx = lane.items.findIndex(i => i.id === c.id);
        if (idx >= 0) {
          if (res === "theirs") {
            lane.items[idx] = { ...c.patch.item };
          } else if (res === "both") {
            // Insert new version right after the existing one with a new id
            const copy = { ...c.patch.item, id: uid(), title: c.patch.item.title + " (new)" };
            lane.items.splice(idx + 1, 0, copy);
          }
          break;
        }
      }
    }

    // Add new items from patch into matching or new lanes
    for (const entry of autoAdd) {
      let targetLane = merged.lanes.find(l => l.id === entry.laneId);
      if (!targetLane) {
        const patchLane = (patchDeck.lanes || []).find(l => l.id === entry.laneId);
        targetLane = { id: entry.laneId, title: patchLane?.title || "Imported", collapsed: false, items: [] };
        merged.lanes.push(targetLane);
      }
      targetLane.items.push({ ...entry.item });
    }

    // Add entirely new lanes (with items already included)
    for (const nl of newLanes) {
      if (!merged.lanes.find(l => l.id === nl.id)) {
        merged.lanes.push(JSON.parse(JSON.stringify(nl)));
      }
    }

    // Update deck title if user hasn't changed it
    if (patchDeck.deckTitle && localDeck.deckTitle === "Untitled") {
      merged.deckTitle = patchDeck.deckTitle;
    }

    // Store patchId so we don't ask again
    merged._lastPatchId = patchDeck._patchId || "";

    onComplete(merged);
  };

  const totalAuto = autoKeep.length + autoAdd.length + unchanged.length;

  return (
    <ModalBackdrop onClose={() => onComplete(null)}>
      <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 20 }}>⛵</span>
          <span style={{ fontFamily: FONT.display, fontSize: 18, fontWeight: 700 }}>New Deck Version Available</span>
        </div>

        {/* Auto-resolved summary */}
        <div style={{ fontFamily: FONT.mono, fontSize: 11, color: T.textDim, marginBottom: 12, lineHeight: 1.6 }}>
          {autoAdd.length > 0 && <div style={{ color: "#34d399" }}>+ {autoAdd.length} new module{autoAdd.length > 1 ? "s" : ""} will be added</div>}
          {autoKeep.length > 0 && <div style={{ color: "#60a5fa" }}>● {autoKeep.length} module{autoKeep.length > 1 ? "s" : ""} you added — keeping</div>}
          {unchanged.length > 0 && <div style={{ color: T.textDim }}>= {unchanged.length} unchanged</div>}
          {newLanes.length > 0 && <div style={{ color: "#34d399" }}>+ {newLanes.length} new section{newLanes.length > 1 ? "s" : ""} will be added</div>}
        </div>

        {/* Conflicts — interactive */}
        {conflicts.length > 0 && <>
          <div style={{ fontFamily: FONT.mono, fontSize: 10, fontWeight: 700, color: "#f59e0b", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
            {conflicts.length} module{conflicts.length > 1 ? "s" : ""} changed in both — choose:
          </div>
          {conflicts.map(c => {
            const res = resolutions[c.id];
            const localSlides = c.local.item.slides?.length || 0;
            const patchSlides = c.patch.item.slides?.length || 0;
            const localTime = (c.local.item.slides || []).reduce((a, s) => a + (s.duration || 0), 0);
            const patchTime = (c.patch.item.slides || []).reduce((a, s) => a + (s.duration || 0), 0);
            return (
              <div key={c.id} style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px", marginBottom: 8, background: T.bg }}>
                <div style={{ fontFamily: FONT.display, fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                  📦 {c.local.item.title || c.id}
                  <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim, marginLeft: 8 }}>in {c.local.laneTitle}</span>
                </div>
                <div style={{ display: "flex", gap: 12, fontFamily: FONT.mono, fontSize: 10, color: T.textDim, marginBottom: 8 }}>
                  <span>Yours: {localSlides} slide{localSlides !== 1 ? "s" : ""}, {localTime}s</span>
                  <span>New: {patchSlides} slide{patchSlides !== 1 ? "s" : ""}, {patchTime}s</span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {["mine", "theirs", "both"].map(opt => (
                    <button key={opt} onClick={() => setRes(c.id, opt)} style={{
                      padding: "4px 10px", fontSize: 11, fontFamily: FONT.body, fontWeight: res === opt ? 700 : 400,
                      background: res === opt ? (opt === "mine" ? "#3b82f620" : opt === "theirs" ? "#34d39920" : "#f59e0b20") : "transparent",
                      color: res === opt ? (opt === "mine" ? "#60a5fa" : opt === "theirs" ? "#34d399" : "#f59e0b") : T.textDim,
                      border: `1px solid ${res === opt ? (opt === "mine" ? "#3b82f650" : opt === "theirs" ? "#34d39950" : "#f59e0b50") : T.border}`,
                      borderRadius: 4, cursor: "pointer"
                    }}>
                      {opt === "mine" ? "Keep Mine" : opt === "theirs" ? "Use New" : "Keep Both"}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </>}

        {/* No conflicts */}
        {conflicts.length === 0 && (autoAdd.length > 0 || newLanes.length > 0) && (
          <div style={{ fontFamily: FONT.body, fontSize: 14, color: T.textMuted, marginBottom: 8 }}>
            No conflicts — new content will be merged alongside your existing deck.
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16, paddingTop: 12, borderTop: `1px solid ${T.border}` }}>
          <button onClick={() => onComplete(null)} style={{ padding: "6px 16px", fontSize: 14, fontFamily: FONT.body, background: "transparent", color: T.textDim, border: `1px solid ${T.border}`, borderRadius: 6, cursor: "pointer" }}>
            Skip
          </button>
          <button onClick={() => { const p = JSON.parse(JSON.stringify(patchDeck)); p._lastPatchId = patchDeck._patchId || ""; onComplete(p); }} style={{ padding: "6px 16px", fontSize: 14, fontFamily: FONT.body, background: "transparent", color: "#f59e0b", border: `1px solid #f59e0b50`, borderRadius: 6, cursor: "pointer" }}>
            Load New (replace all)
          </button>
          <button onClick={handleApply} style={{ padding: "6px 16px", fontSize: 14, fontFamily: FONT.body, fontWeight: 600, background: T.accent, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
            Merge
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

export default function App() {
  const [dark, setDark] = useState(() => typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)").matches : true);
  T = dark ? themes.dark : themes.light;
  const [hist, dispatch] = useReducer(reducer, historyInit);
  const state = hist.present;
  IMG_SETTINGS = { maxWidth: state.branding?.imgMaxWidth ?? defaultBranding.imgMaxWidth, quality: state.branding?.imgQuality ?? defaultBranding.imgQuality };
  const [confirmReset, setConfirmReset] = useState(false);
  const loaded = useRef(false);
  const slideActionsRef = useRef(null);
  const [, forceRibbon] = useReducer((x) => x + 1, 0);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [jsonModal, setJsonModal] = useState(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [newDeckDialog, setNewDeckDialog] = useState(false);
  const [pdfExport, setPdfExport] = useState(false);
  const [mergeDialog, setMergeDialog] = useState(null); // { localDeck, patchDeck }
  const [mdIncludeNotes, setMdIncludeNotes] = useState(true);
  const fileInputRef = useRef(null);

  // ━━━ Local mode: two-way sync with serve.py ━━━━━━━━━━━━━━━━━━━━
  const localSyncTimer = useRef(null);
  const _localSyncIncoming = useRef(false);
  const _localSyncState = useRef(null);
  _localSyncState.current = state; // always up-to-date

  // Expose UI context for channel bridge (browser → Claude Code)
  useEffect(() => {
    if (!VELA_LOCAL_MODE) return;
    window.__velaGetCurrentSlide = () => {
      const s = _localSyncState.current;
      if (!s || !s.selectedId) return null;
      let slideNum = 0;
      for (const lane of (s.lanes || [])) {
        for (const item of (lane.items || [])) {
          for (let si = 0; si < (item.slides || []).length; si++) {
            slideNum++;
            if (item.id === s.selectedId && si === s.slideIndex) {
              const slide = item.slides[si];
              const heading = (slide.blocks || []).find(b => b.type === "heading");
              return {
                slide_number: slideNum,
                slide_index: s.slideIndex,
                module_title: item.title,
                slide_title: heading ? heading.text : (slide.title || `Slide ${slideNum}`),
                block_count: (slide.blocks || []).length,
                block_types: (slide.blocks || []).filter(b => b.type !== "spacer").map(b => b.type),
              };
            }
          }
        }
      }
      return null;
    };
    return () => { window.__velaGetCurrentSlide = null; };
  }, []);

  // Test-only affordance: patch the current slide with a studyNotes object.
  // Used by the Study Notes UI test suite (part-uitest.jsx) to exercise the
  // offline student-mode renderer without depending on a live API. Always
  // enabled — state.selectedId / slideIndex are readable in all modes.
  useEffect(() => {
    window.__velaTestInjectStudyNotes = (studyNotes) => {
      const s = _localSyncState.current;
      if (!s || !s.selectedId) return false;
      dispatch({ type: "UPDATE_SLIDE", id: s.selectedId, index: s.slideIndex, patch: { studyNotes }, merge: true });
      return true;
    };
    return () => { window.__velaTestInjectStudyNotes = null; };
  }, [dispatch]);

  // Send deck changes to local server (browser → file)
  useEffect(() => {
    if (!VELA_LOCAL_MODE || !loaded.current || _localSyncIncoming.current) return;
    clearTimeout(localSyncTimer.current);
    localSyncTimer.current = setTimeout(() => {
      if (window.__velaSendDeckUpdate) {
        const save = extractSave(state);
        delete save.chatMessages; delete save.chatLoading; delete save.fullscreen;
        delete save.lastDebug; delete save._bootstrap; delete save._version;
        window.__velaSendDeckUpdate({ deckTitle: state.deckTitle, lanes: save.lanes, branding: save.branding, guidelines: save.guidelines });
      }
    }, 600);
  }, [state.lanes, state.branding, state.deckTitle, state.guidelines]);

  // Receive deck updates from local server (file → browser)
  useEffect(() => {
    if (!VELA_LOCAL_MODE) return;
    window.__velaReceiveDeckUpdate = (deck) => {
      if (!deck || !deck.lanes) return;
      _localSyncIncoming.current = true;
      try {
        const cur = _localSyncState.current;
        const sanitized = validateAndSanitizeDeck(deck);
        // Preserve lane/item IDs so selection stays valid
        if (cur.lanes && sanitized.lanes && cur.lanes.length === sanitized.lanes.length) {
          for (let li = 0; li < sanitized.lanes.length; li++) {
            sanitized.lanes[li].id = cur.lanes[li].id;
            if (sanitized.lanes[li].items && cur.lanes[li].items) {
              const minItems = Math.min(sanitized.lanes[li].items.length, cur.lanes[li].items.length);
              for (let ii = 0; ii < minItems; ii++) {
                sanitized.lanes[li].items[ii].id = cur.lanes[li].items[ii].id;
              }
            }
          }
        }
        // Only update CONTENT fields — preserve ALL UI state
        const payload = {
          ...cur,                                                    // keep everything
          lanes: sanitized.lanes,                                    // update content
          deckTitle: deck.deckTitle || cur.deckTitle,                 // update title
          branding: deck.branding ? { ...defaultBranding, ...deck.branding } : cur.branding,
          guidelines: deck.guidelines !== undefined ? deck.guidelines : cur.guidelines,
        };
        dispatch({ type: "LOAD", payload });
      } catch (e) {
        dbg("[local-sync] Sanitize failed, loading raw:", e);
        dispatch({ type: "LOAD", payload: deck });
      }
      setTimeout(() => { _localSyncIncoming.current = false; }, 1000);
    };
    return () => { window.__velaReceiveDeckUpdate = null; };
  }, []);

  // ━━━ Change tracking (since last load/export) ━━━━━━━━━━━━━━━━━━━
  const snapshotRef = useRef(new Map()); // moduleId → JSON string of slides
  const takeSnapshot = useCallback((st) => {
    const snap = new Map();
    for (const lane of st.lanes || []) for (const item of lane.items || []) {
      snap.set(item.id, JSON.stringify(item.slides || []));
    }
    snapshotRef.current = snap;
  }, []);
  const getChanges = useCallback(() => {
    const snap = snapshotRef.current;
    let added = 0, changed = 0, totalSlides = 0;
    for (const lane of state.lanes || []) for (const item of lane.items || []) {
      const cur = JSON.stringify(item.slides || []);
      totalSlides += (item.slides || []).length;
      if (!snap.has(item.id)) { added += (item.slides || []).length; }
      else if (snap.get(item.id) !== cur) { changed++; }
    }
    return { added, changed, totalSlides, dirty: added > 0 || changed > 0 };
  }, [state.lanes]);

  // ━━━ Mobile ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState("list"); // "list" | "slides" | "chat"
  const [mobileMenu, setMobileMenu] = useState(false);
  const [viewMenu, setViewMenu] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const [tocCollapsed, setTocCollapsed] = useState(false);
  const [tocWidth, setTocWidth] = useState(() => { try { const v = parseInt(localStorage.getItem("vela-toc-width")); return v >= 160 && v <= 600 ? v : 270; } catch { return 270; } });
  const tocDragRef = useRef(null);
  const prevSelectedRef = useRef(null);

  // Auto-switch tabs on select/deselect
  useEffect(() => {
    if (!isMobile) return;
    if (state.selectedId && !prevSelectedRef.current) setMobileTab("slides");
    if (!state.selectedId && prevSelectedRef.current) setMobileTab("list");
    prevSelectedRef.current = state.selectedId;
  }, [state.selectedId, isMobile]);

  // TOC toggle shortcut: [
  useEffect(() => {
    if (isMobile) return;
    const h = (e) => { if (e.key === "[" && !e.ctrlKey && !e.metaKey && !["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName) && !e.target.isContentEditable) { e.preventDefault(); setTocCollapsed((c) => !c); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [isMobile]);

  // Theme toggle shortcut: D
  useEffect(() => {
    const h = (e) => { if (e.key === "d" && !e.ctrlKey && !e.metaKey && !e.shiftKey && !["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName) && !e.target.isContentEditable) { e.preventDefault(); setDark((d) => !d); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // ── URL hash ↔ slide position sync (local mode only) ──
  const hashRestored = useRef(false);

  // (hash restore is done inline in the initial LOAD sequence above)

  // Write hash on navigation (only after restore is done) — flat global slide index
  useEffect(() => {
    if (!VELA_LOCAL_MODE || !hashRestored.current) return;
    if (state.selectedId && state.lanes) {
      let globalIdx = 0;
      for (const lane of state.lanes) {
        for (const item of lane.items) {
          if (item.id === state.selectedId) {
            globalIdx += state.slideIndex;
            const h = `#s=${globalIdx}`;
            if (location.hash !== h) history.replaceState(null, "", h);
            return;
          }
          globalIdx += (item.slides?.length || 0);
        }
      }
    } else if (location.hash) {
      history.replaceState(null, "", location.pathname + location.search);
    }
  }, [state.selectedId, state.slideIndex]);

  // Global fullscreen: F5 or 'f' when no module selected → auto-select first with slides
  useEffect(() => {
    const h = (e) => {
      if (["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName) || e.target.isContentEditable) return;
      const isF5 = e.key === "F5";
      const isF = e.key === "f" && !e.metaKey && !e.ctrlKey;
      if (!isF5 && !isF) return;
      if (isF5) { e.preventDefault(); e.stopPropagation(); }
      if (state.fullscreen || state.selectedId) return; // SlidePanel handles it when selected
      // Find first module with slides
      for (const lane of state.lanes) {
        for (const item of lane.items) {
          if (item.slides?.length > 0) {
            dispatch({ type: "SELECT", id: item.id });
            dispatch({ type: "SET_SLIDE_INDEX", index: 0 });
            dispatch({ type: "SET_FULLSCREEN", value: true });
            return;
          }
        }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [state.fullscreen, state.selectedId, state.lanes, dispatch]);

  // ━━━ Storage: Load (single key — v3) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  useEffect(() => {
    (async () => {
      let loadedDeck = null;
      try {
        let data = null;
        // Try v3 monolithic format (single key, includes slides)
        try {
          const raw = await window.storage.get(MASTER_KEY);
          if (raw?.value) data = JSON.parse(raw.value);
        } catch(_) {}

        if (data && data._version === 3) {
          // v3: full deck in one key
          delete data._version;
          dispatch({ type: "LOAD", payload: data });
          loadedDeck = data;
        } else if (data && data._version === 2) {
          // v2 distributed: migrate — read module keys sequentially
          const ids = allItemIds(data.lanes);
          const slidesMap = {};
          for (const id of ids) {
            try {
              const r = await window.storage.get(MOD_PREFIX + id);
              if (r?.value) slidesMap[id] = JSON.parse(r.value);
            } catch(_) {}
            // Small delay between reads to avoid rate limit
            await new Promise(r => setTimeout(r, 50));
          }
          const payload = {
            ...data,
            lanes: data.lanes.map((l) => ({
              ...l,
              items: l.items.map((item) => ({ ...item, slides: slidesMap[item.id] || item.slides || [] })),
            })),
          };
          delete payload._version;
          dispatch({ type: "LOAD", payload });
          loadedDeck = payload;
          // Clean up old distributed keys in background
          setTimeout(async () => {
            for (const id of ids) { try { await window.storage.delete(MOD_PREFIX + id); } catch(_) {} }
            dbg("Storage: migrated v2→v3, cleaned", ids.length, "module keys");
          }, 3000);
        } else if (data) {
          // v1 legacy monolithic
          dispatch({ type: "LOAD", payload: data });
          loadedDeck = data;
        }
      } catch (err) { dbg("Load error:", err); }
      // ━━━ Startup Patch: first run OR new version merge ━━━━━━━━━
      if (STARTUP_PATCH) {
        if (VELA_LOCAL_MODE) {
          // Local/folder mode: file on disk is always authoritative — apply directly
          // (localStorage may contain a different deck from the same origin)
          try { applyStartupPatch(loadedDeck || { lanes: [] }, dispatch); } catch (err) { dbg("[PATCH] Error:", err); }
        } else if (!loadedDeck) {
          // First run — no saved data, apply patch directly
          try { applyStartupPatch({ lanes: [] }, dispatch); } catch (err) { dbg("[PATCH] Error:", err); }
        } else if (STARTUP_PATCH._patchId && loadedDeck._lastPatchId !== STARTUP_PATCH._patchId) {
          // New patch version detected — show merge dialog
          dbg("[PATCH] New version detected:", STARTUP_PATCH._patchId, "vs stored:", loadedDeck._lastPatchId);
          try {
            const sanitized = validateAndSanitizeDeck(STARTUP_PATCH);
            sanitized.deckTitle = STARTUP_PATCH.deckTitle || "Untitled";
            sanitized._patchId = STARTUP_PATCH._patchId;
            setMergeDialog({ localDeck: loadedDeck, patchDeck: sanitized });
          } catch (e) { dbg("[PATCH] Sanitize failed:", e); }
        }
      }
      loaded.current = true;
      // Restore slide position from URL hash (flat global slide index)
      if (VELA_LOCAL_MODE && location.hash) {
        const params = new URLSearchParams(location.hash.slice(1));
        const globalIdx = parseInt(params.get("s"), 10);
        if (!isNaN(globalIdx) && globalIdx >= 0) {
          setTimeout(() => {
            const lanes = _localSyncState.current?.lanes;
            if (!lanes) { hashRestored.current = true; return; }
            let remaining = globalIdx;
            for (const lane of lanes) {
              for (const item of lane.items) {
                const count = item.slides?.length || 0;
                if (remaining < count) {
                  dispatch({ type: "SELECT", id: item.id, slideIndex: remaining });
                  hashRestored.current = true;
                  return;
                }
                remaining -= count;
              }
            }
            hashRestored.current = true;
          }, 50);
          return;
        }
      }
      hashRestored.current = true;
    })();
  }, []);

  // Snapshot after first load
  const snapshotted = useRef(false);
  useEffect(() => {
    if (loaded.current && !snapshotted.current && state.lanes?.length) {
      takeSnapshot(state);
      snapshotted.current = true;
    }
  }, [state.lanes, takeSnapshot]);

  // Auto-select first module with slides — re-triggers on full deck loads
  // Skip auto-select if URL hash has a slide to restore
  const _hasHashRestore = VELA_LOCAL_MODE && location.hash && !isNaN(parseInt(new URLSearchParams(location.hash.slice(1)).get("s"), 10));
  const pendingAutoSelect = useRef(!_hasHashRestore); // false if hash will restore
  const selectFirstModule = useCallback(() => { pendingAutoSelect.current = true; }, []);
  useEffect(() => {
    if (!loaded.current || !pendingAutoSelect.current || state.selectedId) return;
    for (const lane of state.lanes) {
      for (const item of lane.items) {
        if (item.slides?.length > 0) {
          dispatch({ type: "SELECT", id: item.id });
          dispatch({ type: "SET_SLIDE_INDEX", index: 0 });
          pendingAutoSelect.current = false;
          return;
        }
      }
    }
  }, [state.lanes, state.selectedId]);

  // Auto-create default lane if none exist
  useEffect(() => {
    if (loaded.current && state.lanes.length === 0) {
      dispatch({ type: "ADD_LANE", title: "Main" });
    }
  }, [state.lanes.length]);

  // ━━━ Storage: Save (single key — v3, debounced) ━━━━━━━━━━━━━━━━━━━
  const saveTimer = useRef(null);
  useEffect(() => {
    if (!loaded.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const save = extractSave(state);
        // Strip large binary data from chat messages
        save.chatMessages = (save.chatMessages || []).map((m) => m.images ? { ...m, images: m.images.map(() => "[img]") } : m);
        save._version = 3;
        await saveKV(MASTER_KEY, save);
        dbg("Storage: saved v3, lanes:", save.lanes?.length, "items:", allItemIds(save.lanes).length);
      } catch (err) { dbg("Save error:", err); }
    }, 1500);
  }, [state.lanes, state.chatMessages, state.branding, state.deckTitle, state.guidelines]);

  // Sync browser tab title with deck title
  React.useEffect(() => {
    const name = state.deckTitle || "Untitled";
    document.title = name === "Untitled" ? "Vela Slides" : `${name} — Vela Slides`;
  }, [state.deckTitle]);

  // Export
  const exportDeck = () => {
    const save = extractSave(state);
    const cleaned = { ...save, chatMessages: save.chatMessages.map((m) => m.images ? { ...m, images: [] } : m) };
    const title = state.deckTitle || "Untitled";
    const payload = { _vela: 1, name: title, exportedAt: now(), data: cleaned };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `${(title.replace(/[\u2014\u2013]/g, "-").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/[^\w\s.-]/g, "").replace(/\s+/g, "-").replace(/-{2,}/g, "-").replace(/_{2,}/g, "_").replace(/^[-_.]+|[-_.]+$/g, "").slice(0, 80)) || "vela-deck"}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    takeSnapshot(state);
  };

  // Import
  const loadDeckFile = useCallback((file) => {
    if (!file || file.size > MAX_IMPORT_SIZE) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext !== "json" && ext !== "vela") return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const raw = JSON.parse(reader.result);
        let deckData, deckName;
        if (raw._vela && raw.data) { deckData = raw.data; deckName = sanitizeString(raw.name || "Imported", 60); }
        else if (raw.lanes) { deckData = raw; deckName = raw.deckTitle || "Imported"; }
        else throw new Error("Unrecognized format");
        const sanitized = validateAndSanitizeDeck(deckData);
        sanitized.deckTitle = deckName;
        dispatch({ type: "LOAD", payload: sanitized });
        dispatch({ type: "DESELECT" });
        selectFirstModule();
        takeSnapshot(sanitized);
      } catch (err) { dbg("Import error:", err); }
    };
    reader.readAsText(file);
  }, [takeSnapshot]);

  const importDeck = (e) => { const file = e.target.files?.[0]; if (!file) return; e.target.value = ""; loadDeckFile(file); };

  const [fileDragOver, setFileDragOver] = useState(false);
  const dragCountRef = useRef(0);
  const handleGlobalDragEnter = useCallback((e) => { e.preventDefault(); if (e.dataTransfer?.types?.includes("Files")) { dragCountRef.current++; setFileDragOver(true); } }, []);
  const handleGlobalDragLeave = useCallback((e) => { e.preventDefault(); dragCountRef.current--; if (dragCountRef.current <= 0) { dragCountRef.current = 0; setFileDragOver(false); } }, []);
  const handleGlobalDragOver = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }, []);
  const handleGlobalDrop = useCallback((e) => { e.preventDefault(); e.stopPropagation(); dragCountRef.current = 0; setFileDragOver(false); const file = e.dataTransfer?.files?.[0]; if (file) loadDeckFile(file); }, [loadDeckFile]);

  // Title editing
  const startEditTitle = () => { setTitleDraft(state.deckTitle || "Untitled"); setEditingTitle(true); };
  const commitTitle = () => { dispatch({ type: "SET_TITLE", title: titleDraft.trim() || "Untitled" }); setEditingTitle(false); };

  // Keyboard: undo/redo
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") { e.preventDefault(); e.stopPropagation(); dispatch({ type: e.shiftKey ? "REDO" : "UNDO" }); }
      if ((e.metaKey || e.ctrlKey) && e.key === "y") { e.preventDefault(); e.stopPropagation(); dispatch({ type: "REDO" }); }
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !(e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable)) { e.preventDefault(); setShowShortcuts((v) => !v); }
      if (e.key === "r" && !e.metaKey && !e.ctrlKey && !(e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable)) { e.preventDefault(); window.dispatchEvent(new CustomEvent("vela-toggle-review")); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Review mode toggle via custom event (keyboard shortcut R)
  useEffect(() => {
    const h = () => {
      const entering = !state.reviewMode;
      dispatch({ type: "SET_REVIEW_MODE", value: entering });
      if (entering) { dispatch({ type: "SET_COMMENTS_PANEL", open: true }); dispatch({ type: "SET_CHAT", open: false }); }
      else { dispatch({ type: "SET_COMMENTS_PANEL", open: false }); }
    };
    window.addEventListener("vela-toggle-review", h);
    return () => window.removeEventListener("vela-toggle-review", h);
  }, [state.reviewMode]);

  let selectedConcept = null;
  for (const l of state.lanes) { const f = l.items.find((i) => i.id === state.selectedId); if (f) { selectedConcept = f; break; } }
  const total = state.lanes.reduce((s, l) => s + l.items.length, 0);
  const deckTime = state.lanes.reduce((s, l) => s + l.items.reduce((a, i) => a + i.slides.reduce((b, sl) => b + (sl.duration || 0), 0), 0), 0);
  const maxModuleTime = React.useMemo(() => { let m = 0; for (const l of state.lanes) for (const i of l.items) { const t = i.slides.reduce((a, s) => a + (s.duration || 0), 0); if (t > m) m = t; } return m || 1; }, [state.lanes]);

  // ━━━ Mobile helpers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const showList = isMobile ? mobileTab === "list" : !(tocCollapsed && selectedConcept);
  const showSlides = !isMobile || mobileTab === "slides";
  const showChat = !isMobile ? state.chatOpen : mobileTab === "chat";
  const showCommentsPanel = !isMobile ? state.commentsPanelOpen : mobileTab === "comments";
  const slideCount = selectedConcept?.slides?.length || 0;

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column", background: T.bg, color: T.text, fontFamily: FONT.body, overflow: "hidden", position: "relative" }}
      onDragEnter={handleGlobalDragEnter} onDragLeave={handleGlobalDragLeave} onDragOver={handleGlobalDragOver} onDrop={handleGlobalDrop}>
      <style>{getCss()}</style>
      <input ref={fileInputRef} type="file" accept=".json,.vela" onChange={importDeck} style={{ display: "none" }} />
      {fileDragOver && <div style={{ position: "absolute", inset: 0, zIndex: 99999, background: "rgba(59,130,246,0.12)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ background: T.bgPanel, border: `2px dashed ${T.accent}`, borderRadius: 16, padding: "40px 60px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}>
          <span style={{ fontSize: 40 }}>📂</span>
          <span style={{ fontFamily: FONT.display, fontSize: 18, fontWeight: 700, color: T.text }}>Drop deck to load</span>
          <span style={{ fontFamily: FONT.mono, fontSize: 11, color: T.textDim }}>.json or .vela</span>
        </div>
      </div>}

      {/* ── TOP BAR — title left, actions right, dropdown buttons ── */}
      {!state.fullscreen && <header style={{ padding: isMobile ? "6px 10px" : "0 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: isMobile ? 8 : 10, background: T.bgPanel, flexShrink: 0, height: isMobile ? 40 : 44 }}>
        {/* Left: icon + title + time */}
        {isMobile && mobileTab !== "list" && <button onClick={() => { setMobileTab("list"); if (mobileTab === "slides") dispatch({ type: "DESELECT" }); }} style={S.btn({ padding: "2px 4px", color: T.accent, fontSize: 16 })}>{"←"}</button>}
        <span onClick={() => setShowChangelog(true)} style={{ cursor: "pointer", display: "flex", alignItems: "center" }} title="About"><VelaIcon size={20} /></span>
        {editingTitle ? (
          <input autoFocus value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commitTitle(); if (e.key === "Escape") setEditingTitle(false); }}
            onBlur={commitTitle}
            style={S.input({ padding: "3px 8px", fontSize: 14, fontWeight: 700, width: 200, minWidth: 60, flexShrink: 1, border: `1px solid ${T.accent}`, fontFamily: FONT.display })} />
        ) : (
          <span onClick={startEditTitle} style={{ fontSize: 14, fontWeight: 700, color: T.text, fontFamily: FONT.display, cursor: "pointer", padding: "2px 4px", borderRadius: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 1, minWidth: 0, maxWidth: isMobile ? "40vw" : undefined }} title={state.deckTitle || "Untitled"}>{state.deckTitle || "Untitled"}</span>
        )}
        {!isMobile && (deckTime > 0 || total > 0) && <span title={`${deckTime > 0 ? fmtTime(deckTime) + " total · " : ""}${state.lanes.reduce((s, l) => s + l.items.reduce((a, i) => a + (i.slides?.length || 0), 0), 0)} slides · ${total} sections`} style={{ fontFamily: FONT.mono, fontSize: 13, fontWeight: 700, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 2, minWidth: 0, background: T.accent + "12", padding: "2px 8px", borderRadius: 4 }}>{deckTime > 0 ? `⏱${fmtTime(deckTime)} · ` : ""}{state.lanes.reduce((s, l) => s + l.items.reduce((a, i) => a + (i.slides?.length || 0), 0), 0)}sl · {total}§</span>}
        {/* Spacer — pushes actions right */}
        <div style={{ flex: 1, minWidth: isMobile ? 4 : 0 }} />
        {/* Right: deck-level actions with dropdowns */}
        {!isMobile && <>
          {/* View dropdown — shows current ratio */}
          {(() => {
            const sa = slideActionsRef.current;
            const pr = sa?.previewRatio || "16:9";
            const has = !!selectedConcept;
            const label = PREVIEW_RATIOS.find((r) => r.id === pr)?.label || "16:9";
            return <div style={{ position: "relative" }}>
              <button onClick={() => { setViewMenu((v) => !v); setExportMenu(false); }} disabled={!has} style={S.btn({ padding: "4px 10px", fontSize: 14, color: has ? T.text : T.textDim, opacity: has ? 1 : 0.4, display: "flex", alignItems: "center", gap: 4, background: viewMenu ? T.accent + "15" : "transparent", borderRadius: 4 })}>{"👁"} {label} <span style={{ fontSize: 9, opacity: 0.5 }}>▾</span></button>
              {viewMenu && <>
                <div onClick={() => setViewMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
                <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 9999, marginTop: 4, background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", padding: "4px 0", minWidth: 120 }}>
                  {PREVIEW_RATIOS.map((r) => <button key={r.id} onClick={() => { sa?.setPreviewRatio?.(r.id); setViewMenu(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 14px", background: pr === r.id ? T.accent + "20" : "transparent", border: "none", color: pr === r.id ? T.accent : T.text, fontFamily: FONT.mono, fontSize: 14, fontWeight: pr === r.id ? 700 : 400, cursor: "pointer", textAlign: "left" }}>{pr === r.id && <span style={{ color: T.accent }}>✓</span>}{r.label}</button>)}
                </div>
              </>}
            </div>;
          })()}
          {/* Batch / Brand / Present */}
          {(() => {
            const sa = slideActionsRef.current;
            const has = !!selectedConcept;
            return <>
              <button onClick={() => sa?.toggleBatchEdit?.()} disabled={!has || !sa?.slidesCount} title="Batch edit across slides" style={S.btn({ padding: "4px 10px", fontSize: 14, color: sa?.showBatchEdit ? T.accent : (sa?.improving ? T.red : T.textDim), background: sa?.showBatchEdit || sa?.improving ? T.accent + "20" : "transparent", borderRadius: 4, opacity: has && sa?.slidesCount ? 1 : 0.4, display: "flex", alignItems: "center", gap: 4 })}>{sa?.improving ? "⏹" : "🔄"} Batch</button>
              <button onClick={() => sa?.toggleBranding?.()} disabled={!has} title="Branding & guidelines" style={S.btn({ padding: "4px 10px", fontSize: 14, color: sa?.showBranding ? T.accent : (sa?.hasBranding ? T.accent : T.textDim), background: sa?.showBranding ? T.accent + "20" : "transparent", borderRadius: 4, opacity: has ? 1 : 0.4, display: "flex", alignItems: "center", gap: 4 })}>{"🎨"} Brand</button>
              <button onClick={() => sa?.present?.()} disabled={!has} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 14px", background: has ? T.green : T.border, color: has ? "#fff" : T.textDim, border: "none", borderRadius: 6, cursor: has ? "pointer" : "default", opacity: has ? 1 : 0.5, fontFamily: FONT.mono, fontSize: 14, fontWeight: 700 }}>{"▶"} Present</button>
            </>;
          })()}
          <div style={{ width: 1, height: 22, background: T.border, flexShrink: 0 }} />
          {/* New Deck */}
          <button onClick={() => setNewDeckDialog(true)} style={S.btn({ padding: "4px 10px", fontSize: 14, color: T.accent, display: "flex", alignItems: "center", gap: 4, borderRadius: 4 })}>{"+"} New</button>
          {/* Import */}
          <button onClick={() => fileInputRef.current?.click()} style={S.btn({ padding: "4px 10px", fontSize: 14, color: T.textMuted, display: "flex", alignItems: "center", gap: 4, borderRadius: 4 })}>{"📥"} Import</button>
          {/* Export dropdown */}
          <div style={{ position: "relative" }}>
            <button onClick={() => { setExportMenu((v) => !v); setViewMenu(false); }} style={S.btn({ padding: "4px 10px", fontSize: 14, color: exportMenu ? T.accent : T.textMuted, display: "flex", alignItems: "center", gap: 4, background: exportMenu ? T.accent + "15" : "transparent", borderRadius: 4 })}>{"📤"} Export <span style={{ fontSize: 9, opacity: 0.5 }}>▾</span></button>
            {exportMenu && <>
              <div onClick={() => setExportMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
              <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 9999, marginTop: 4, background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", padding: "4px 0", minWidth: 180 }}>
                {(() => { const ch = getChanges(); return <button onClick={() => { exportDeck(); setExportMenu(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 14px", background: "transparent", border: "none", color: ch.dirty ? T.red : T.text, fontFamily: FONT.body, fontSize: 14, cursor: "pointer", textAlign: "left" }}><Download size={14} /> Export JSON {ch.dirty && <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.red }}>●</span>}</button>; })()}
                <div style={{ height: 1, background: T.border, margin: "2px 8px" }} />
                {total > 0 && <button onClick={() => { setPdfExport(true); setExportMenu(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 14px", background: "transparent", border: "none", color: T.text, fontFamily: FONT.body, fontSize: 14, cursor: "pointer", textAlign: "left" }}><FileDown size={14} /> Export PDF</button>}
                {total > 0 && <button onClick={() => { exportMarkdown(state, { includeNotes: mdIncludeNotes }); setExportMenu(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 14px", background: "transparent", border: "none", color: T.text, fontFamily: FONT.body, fontSize: 14, cursor: "pointer", textAlign: "left" }}><FileDown size={14} /> Export Markdown</button>}
                <div style={{ height: 1, background: T.border, margin: "2px 8px" }} />
                <button onClick={() => { setJsonModal(jsonModal ? null : 'copy'); setExportMenu(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 14px", background: "transparent", border: "none", color: T.text, fontFamily: FONT.body, fontSize: 14, cursor: "pointer", textAlign: "left" }}>{"{ }"} Copy / Paste JSON</button>
              </div>
            </>}
          </div>
          <div style={{ width: 1, height: 22, background: T.border, flexShrink: 0 }} />
          <CostBadge />
          <button onClick={() => window.dispatchEvent(new CustomEvent("vela-run-demo"))} style={S.btn({ padding: "4px 10px", fontSize: 14, color: T.textMuted, borderRadius: 4, display: "flex", alignItems: "center", gap: 4 })} title="Run live demo">{"🎬"}</button>
          <div style={{ width: 1, height: 22, background: T.border, flexShrink: 0 }} />
          <button onClick={() => { const entering = !state.reviewMode; dispatch({ type: "SET_REVIEW_MODE", value: entering }); if (entering) { dispatch({ type: "SET_COMMENTS_PANEL", open: true }); dispatch({ type: "SET_CHAT", open: false }); } else { dispatch({ type: "SET_COMMENTS_PANEL", open: false }); } }} style={S.btn({ padding: "4px 10px", fontSize: 14, background: state.reviewMode ? T.amber : "transparent", color: state.reviewMode ? "#fff" : T.amber, borderRadius: 4, display: "flex", alignItems: "center", gap: 4 })}>{"💬"} Comments</button>
          <button onClick={() => { dispatch({ type: "SET_CHAT", open: !state.chatOpen }); if (!state.chatOpen) { dispatch({ type: "SET_COMMENTS_PANEL", open: false }); dispatch({ type: "SET_REVIEW_MODE", value: false }); } }} style={S.btn({ padding: "4px 10px", fontSize: 14, background: state.chatOpen ? T.accent : "transparent", color: state.chatOpen ? "#fff" : T.accent, borderRadius: 4, display: "flex", alignItems: "center", gap: 4 })}>{"🤖"} Vera</button>
        </>}
        {isMobile && <>
          <button onClick={() => setNewDeckDialog(true)} style={{ padding: "4px 10px", fontSize: 14, color: T.accent, background: "transparent", border: `1px solid ${T.accent}40`, borderRadius: 4, cursor: "pointer", flexShrink: 0, fontWeight: 700 }} title="New Deck">{"+"}</button>
          {total > 0 && <button onClick={() => { const sa = slideActionsRef.current; if (sa?.present) sa.present(); }} style={{ padding: "4px 10px", background: T.green, color: "#fff", border: "none", borderRadius: 4, fontFamily: FONT.mono, fontSize: 11, fontWeight: 700, cursor: "pointer", flexShrink: 0 }} title="Present">{"▶"}</button>}
          <button onClick={() => setMobileMenu((v) => !v)} style={{ padding: "2px 6px", fontSize: 18, color: mobileMenu ? T.accent : T.textMuted, background: "transparent", border: "none", cursor: "pointer", fontWeight: 700, flexShrink: 0 }}>{"⋯"}</button>
        </>}
        {isMobile && mobileMenu && <div style={{ position: "relative" }}>
          <div onClick={() => setMobileMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
          <div style={{ position: "absolute", top: 4, right: 0, zIndex: 9999, background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", padding: "6px 0", minWidth: 200 }}>
            {total > 0 && deckTime > 0 && <div style={{ padding: "6px 14px", fontFamily: FONT.mono, fontSize: 10, fontWeight: 600, borderBottom: `1px solid ${T.border}` }}><span style={{ color: T.accent }}>{"⏱"} {fmtTime(deckTime)}</span></div>}
            <button onClick={() => { setNewDeckDialog(true); setMobileMenu(false); }} style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", color: T.accent, fontFamily: FONT.body, fontSize: 14, textAlign: "left", cursor: "pointer", fontWeight: 600 }}>{"⛵"} New Deck</button>
            <button onClick={() => { fileInputRef.current?.click(); setMobileMenu(false); }} style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", color: T.text, fontFamily: FONT.body, fontSize: 14, textAlign: "left", cursor: "pointer" }}>{"📥"} Import</button>
            <div style={{ height: 1, background: T.border, margin: "2px 8px" }} />
            {total > 0 && <button onClick={() => { const sa = slideActionsRef.current; if (sa?.present) sa.present(); setMobileMenu(false); }} style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", color: T.green, fontFamily: FONT.body, fontSize: 14, textAlign: "left", cursor: "pointer", fontWeight: 600 }}>{"▶"} Present</button>}
            {total > 0 && (() => {
              const sa = slideActionsRef.current;
              const pr = sa?.previewRatio || "auto";
              return <div style={{ display: "flex", gap: 4, padding: "6px 14px", borderTop: `1px solid ${T.border}` }}>
                {PREVIEW_RATIOS.map((r) => <button key={r.id} onClick={() => { sa?.setPreviewRatio?.(r.id); setMobileMenu(false); }}
                  style={{ flex: 1, padding: "5px 0", background: pr === r.id ? T.accent + "25" : "transparent", border: `1px solid ${pr === r.id ? T.accent + "50" : T.border}`, borderRadius: 4, color: pr === r.id ? T.accent : T.textDim, fontFamily: FONT.mono, fontSize: 10, fontWeight: pr === r.id ? 700 : 400, cursor: "pointer" }}>{r.label}</button>)}
              </div>;
            })()}
            {total > 0 && (() => {
              const sa = slideActionsRef.current;
              return <>
                <div style={{ height: 1, background: T.border, margin: "2px 8px" }} />
                {selectedConcept && <button onClick={() => { sa?.toggleBatchEdit?.(); setMobileMenu(false); if (isMobile && mobileTab !== "slides") setMobileTab("slides"); }} style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", color: sa?.improving ? T.red : T.text, fontFamily: FONT.body, fontSize: 14, textAlign: "left", cursor: "pointer" }}>{sa?.improving ? "⏹ Stop Improve" : "✨ Improve / Batch"}</button>}
                <button onClick={() => { sa?.toggleBranding?.(); setMobileMenu(false); if (isMobile && mobileTab !== "slides") setMobileTab("slides"); }} style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", color: sa?.hasBranding ? T.accent : T.text, fontFamily: FONT.body, fontSize: 14, textAlign: "left", cursor: "pointer" }}>{"🎨"} Brand & Guidelines</button>
              </>;
            })()}
            <div style={{ height: 1, background: T.border, margin: "2px 8px" }} />
            <button onClick={() => { setJsonModal(jsonModal ? null : "copy"); setMobileMenu(false); }} style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", color: T.text, fontFamily: FONT.body, fontSize: 14, textAlign: "left", cursor: "pointer" }}>{"{ }"} JSON</button>
            {total > 0 && <button onClick={() => { setPdfExport(true); setMobileMenu(false); }} style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", color: T.text, fontFamily: FONT.body, fontSize: 14, textAlign: "left", cursor: "pointer" }}>{"📄"} PDF</button>}
            {total > 0 && <button onClick={() => { exportMarkdown(state, { includeNotes: mdIncludeNotes }); setMobileMenu(false); }} style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", color: T.text, fontFamily: FONT.body, fontSize: 14, textAlign: "left", cursor: "pointer" }}>{"📝"} Markdown</button>}
            {total > 0 && <button onClick={() => { exportDeck(); setMobileMenu(false); }} style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", color: T.text, fontFamily: FONT.body, fontSize: 14, textAlign: "left", cursor: "pointer" }}>{"📤"} Export JSON</button>}
            <div style={{ height: 1, background: T.border, margin: "2px 8px" }} />
            <button onClick={() => { dispatch({ type: "SET_COMMENTS_PANEL", open: true }); dispatch({ type: "SET_CHAT", open: false }); dispatch({ type: "SET_REVIEW_MODE", value: true }); setMobileTab("comments"); setMobileMenu(false); }} style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", color: T.amber, fontFamily: FONT.body, fontSize: 14, textAlign: "left", cursor: "pointer" }}>{"💬"} Comments</button>
            <button onClick={() => { dispatch({ type: "SET_CHAT", open: !state.chatOpen }); dispatch({ type: "SET_COMMENTS_PANEL", open: false }); setMobileTab("chat"); setMobileMenu(false); }} style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", color: T.accent, fontFamily: FONT.body, fontSize: 14, textAlign: "left", cursor: "pointer" }}>{"🤖"} Vera</button>
          </div>
        </div>}
      </header>}

      {/* ── BODY ────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* List panel */}
        {showList && <div style={{ width: !isMobile ? (selectedConcept ? tocWidth : undefined) : "100%", minWidth: isMobile ? 0 : (selectedConcept ? 160 : 0), maxWidth: !isMobile && selectedConcept ? 600 : undefined, flex: !isMobile && !selectedConcept ? 1 : (isMobile ? 1 : undefined), overflowY: "auto", padding: "8px 0", borderRight: !isMobile && selectedConcept ? `1px solid ${T.border}` : "none", flexShrink: 0 }}>
          {total === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12, padding: 20 }}>
              <div style={{ fontSize: 36, opacity: 0.15 }}>⛵</div>
              <div style={{ fontFamily: FONT.mono, fontSize: 11, color: T.textDim, textAlign: "center", lineHeight: 1.7, maxWidth: 280 }}>Start a new deck, ask <span style={{ color: T.accent, cursor: "pointer" }} onClick={() => { dispatch({ type: "SET_CHAT", open: true }); if (isMobile) setMobileTab("chat"); }}>Vera</span>, or drop a <span style={{ color: T.accent }}>.json</span> / <span style={{ color: T.accent }}>.vela</span> file.</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setNewDeckDialog(true)} style={{ padding: "8px 18px", fontSize: 14, fontFamily: FONT.body, fontWeight: 600, color: "#fff", background: T.accent, border: "none", borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>{"⛵"} New Deck</button>
                <button onClick={() => { dispatch({ type: "SET_CHAT", open: true }); if (isMobile) setMobileTab("chat"); }} style={S.btn({ padding: "8px 14px", color: T.accent, border: `1px solid ${T.accent}40`, borderRadius: 6, fontSize: 14, display: "flex", alignItems: "center", gap: 4 })}>🤖 Vera</button>
              </div>
            </div>
          )}
          {total > 0 && <ModuleList lanes={state.lanes} selectedId={state.selectedId} slideIndex={state.slideIndex} dispatch={dispatch} maxModuleTime={maxModuleTime} guidelines={state.guidelines} reviewMode={state.reviewMode} />}
        </div>}

        {/* TOC toggle */}
        {!isMobile && selectedConcept && <div
          title="Drag to resize · Double-click to collapse"
          onDoubleClick={() => setTocCollapsed(!tocCollapsed)}
          onMouseDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startW = tocCollapsed ? 270 : tocWidth;
            if (tocCollapsed) { setTocCollapsed(false); }
            let lastW = startW;
            const onMove = (ev) => {
              lastW = Math.max(160, Math.min(600, startW + (ev.clientX - startX)));
              setTocWidth(lastW);
            };
            const onUp = () => {
              document.removeEventListener("mousemove", onMove);
              document.removeEventListener("mouseup", onUp);
              document.body.style.cursor = "";
              document.body.style.userSelect = "";
              try { localStorage.setItem("vela-toc-width", String(lastW)); } catch {}
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
          style={{ width: 6, flexShrink: 0, cursor: "col-resize", background: "transparent", borderRight: `1px solid ${T.border}`, transition: "background .15s", userSelect: "none" }}
          onMouseEnter={(e) => e.currentTarget.style.background = T.accent + "30"}
          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
        />}

        {/* Slides panel */}
        {showSlides && selectedConcept && <SlidePanel state={state} concept={selectedConcept} slideIndex={state.slideIndex} fullscreen={state.fullscreen} dispatch={dispatch} lanes={state.lanes} branding={state.branding} guidelines={state.guidelines} isMobile={isMobile} fontScale={state.fontScale} actionsRef={slideActionsRef} onRibbonUpdate={forceRibbon} />}
        {showSlides && !selectedConcept && isMobile && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 20 }}>
            <span style={{ fontSize: 32, opacity: 0.15 }}>🎬</span>
            <span style={{ fontFamily: FONT.mono, fontSize: 11, color: T.textDim }}>Select a module from the list</span>
            <button onClick={() => setMobileTab("list")} style={S.btn({ padding: "6px 14px", color: T.accent, border: `1px solid ${T.accent}40`, borderRadius: 4 })}>← Back to list</button>
          </div>
        )}

        {/* Chat panel */}
        {showChat && !showCommentsPanel && <ChatPanel state={state} dispatch={dispatch} isMobile={isMobile} getLayoutStats={() => slideActionsRef.current?.getLayoutStats?.()} />}
        {/* Comments panel */}
        {showCommentsPanel && !showChat && <CommentsPanel state={state} dispatch={dispatch} isMobile={isMobile} />}
      </div>

      {/* ── MOBILE BOTTOM NAV ──────────────────────────────── */}
      {isMobile && <nav style={{ flexShrink: 0, borderTop: `1px solid ${T.border}`, background: T.bgPanel, display: "flex", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <button className={`mob-tab ${mobileTab === "list" ? "mob-tab-active" : ""}`} onClick={() => setMobileTab("list")} style={{ color: mobileTab === "list" ? T.accent : T.textDim }}>
          <Presentation size={16} /><span>Index</span>
        </button>
        <button className={`mob-tab ${mobileTab === "slides" ? "mob-tab-active" : ""}`} onClick={() => setMobileTab("slides")} style={{ color: mobileTab === "slides" ? T.accent : T.textDim }}>
          <Maximize2 size={16} /><span>Slides</span>
          {slideCount > 0 && <span style={{ fontSize: 9, color: T.textDim }}>{slideCount}</span>}
        </button>
        <button className={`mob-tab ${mobileTab === "comments" ? "mob-tab-active" : ""}`} onClick={() => { setMobileTab("comments"); dispatch({ type: "SET_COMMENTS_PANEL", open: true }); dispatch({ type: "SET_CHAT", open: false }); }} style={{ color: mobileTab === "comments" ? T.amber : T.textDim }}>
          <span style={{ fontSize: 16 }}>💬</span><span>Comments</span>
        </button>
        <button className={`mob-tab ${mobileTab === "chat" ? "mob-tab-active" : ""}`} onClick={() => { setMobileTab("chat"); dispatch({ type: "SET_CHAT", open: true }); dispatch({ type: "SET_COMMENTS_PANEL", open: false }); }} style={{ color: mobileTab === "chat" ? T.accent : T.textDim }}>
          <span style={{ fontSize: 16 }}>🤖</span><span>Vera</span>
        </button>
      </nav>}

      {/* ── APP FOOTER BAR ───────────────────────────────── */}
      {!state.fullscreen && !isMobile && <div data-vela-footer style={{ flexShrink: 0, borderTop: `1px solid ${T.border}`, background: T.bgPanel, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px", height: 24 }}>
        <span onClick={() => setShowChangelog(true)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }} title="About Vela">
          <VelaIcon size={12} />
          <span style={{ fontFamily: FONT.mono, fontSize: 9, fontWeight: 600, color: T.textDim, letterSpacing: "0.05em" }}>VELA v{VELA_VERSION}</span>
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 12, height: 12, borderRadius: "50%", border: `1px solid ${T.textDim}50`, fontSize: 9, fontFamily: FONT.mono, fontWeight: 700, color: T.textDim, lineHeight: 1, opacity: 0.6 }}>i</span>
        </span>
        <span onClick={() => setShowShortcuts(true)} style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textMuted, cursor: "pointer" }} title="Keyboard shortcuts">Press <kbd style={{ fontSize: 8, background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 2, padding: "0 3px", color: T.text }}>?</kbd> for shortcuts</span>
        <span style={{ fontFamily: FONT.body, fontSize: 9, color: T.textDim }}>© 2025-present <a href="https://www.linkedin.com/in/rquintino/" target="_blank" rel="noopener noreferrer" style={{ color: T.textMuted, textDecoration: "none" }}>Rui Quintino</a> · <a href="https://github.com/agentiapt/vela-slides/blob/main/LICENSE" target="_blank" rel="noopener noreferrer" style={{ color: T.textDim, textDecoration: "none" }}>ELv2</a></span>
      </div>}

      {jsonModal && <JsonClipboardModal mode={jsonModal} setMode={setJsonModal} state={state} dispatch={dispatch} />}
      {!isMobile && showShortcuts && <ShortcutHelp onClose={() => setShowShortcuts(false)} />}
      {showChangelog && <ChangelogDialog onClose={() => setShowChangelog(false)} />}
      {newDeckDialog && <NewDeckDialog onClose={() => setNewDeckDialog(false)} onSubmit={({ title, prompt, images }) => { dispatch({ type: "NEW_DECK", title, prompt, images }); if (isMobile) setMobileTab("chat"); }} />}
      {pdfExport && <PdfExportModal slides={collectAllSlides(state.lanes)} branding={state.branding} deckTitle={state.deckTitle} onClose={() => setPdfExport(false)} />}
      {mergeDialog && <MergePatchDialog localDeck={mergeDialog.localDeck} patchDeck={mergeDialog.patchDeck} onComplete={(result) => {
        setMergeDialog(null);
        if (result) {
          const patchId = result._lastPatchId || "";
          delete result._lastPatchId;
          try { const s = validateAndSanitizeDeck(result); s.deckTitle = result.deckTitle; s._lastPatchId = patchId; dispatch({ type: "LOAD", payload: s }); dispatch({ type: "DESELECT" }); selectFirstModule(); } catch(e) { result._lastPatchId = patchId; dispatch({ type: "LOAD", payload: result }); dispatch({ type: "DESELECT" }); selectFirstModule(); }
        } else {
          // User skipped — store current patchId so we don't ask again
          if (STARTUP_PATCH?._patchId) {
            const save = extractSave(state);
            save._lastPatchId = STARTUP_PATCH._patchId;
            save._version = 3;
            saveKV(MASTER_KEY, save).catch(() => {});
          }
        }
      }} />}
      <VelaBatteryTest />
      <VelaUITestRunner />
      <VelaDemoRunner />
    </div>
  );
}


