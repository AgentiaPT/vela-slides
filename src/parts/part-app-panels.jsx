// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
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

  // No prompt is fine — that just creates a fresh, blank deck (in a new file).
  // A prompt (short ask or a long pasted README/outline) hands it to Vera to build.
  const submit = () => {
    onSubmit({ title: name.trim() || "Untitled", prompt: prompt.trim(), images: [] });
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

      {/* Prompt — optional; also the place to paste long source (README / notes / outline) */}
      <div style={{ marginBottom: 18 }}>
        <label style={{ fontFamily: FONT.mono, fontSize: 11, fontWeight: 600, color: T.textMuted, display: "block", marginBottom: 5 }}>Starting Prompt <span style={{ fontWeight: 400, color: T.textDim }}>— optional; leave empty for a blank deck</span></label>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={"e.g. Create a 10-slide pitch deck on AI agents with sections: Intro, Architecture, Demo, Roadmap.\n\nOr paste a whole README / article / outline here and Vera will build a deck from it.\n\nHave images or files? Drop them in this deck's folder and reference them by name in your prompt."}
          rows={10}
          style={{ width: "100%", padding: "10px 12px", fontSize: 14, fontFamily: FONT.body, color: T.text, background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 8, outline: "none", resize: "vertical", lineHeight: 1.5, boxSizing: "border-box" }} />
        <div style={{ marginTop: 6, fontFamily: FONT.mono, fontSize: 10, color: T.textDim }}>Tip: paste long source text directly. To use attachments, drop the files into this deck's folder and mention them by filename so Vera can reference them.</div>
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
      ["Ctrl+E", "Toggle slides TOC / search (fullscreen)"],
      ["D", "Toggle dark / light theme"],
      ["+ / −", "Scale font up / down"],
      ["0", "Reset font scale"],
    ]},
    { title: "Editing", items: [
      ["⌘Z / Ctrl+Z", "Undo"],
      ["⌘⇧Z / Ctrl+Y", "Redo"],
      ["Click text", "Edit inline on slide"],
      ["⇧/⌘-click", "Multi-select slides in the list"],
      ["Ctrl+C", "Copy selected slide(s) to clipboard"],
      ["Ctrl+V", "Paste slide(s) / image / JSON"],
      ["Right-click", "Slide menu (move / duplicate / delete / hide)"],
      ["Del", "Delete current slide"],
      ["R", "Toggle review / comments"],
    ]},
    { title: "AI Tools", items: [
      ["Shift+I", "Quick improve slide via Vera"],
      ["E", "Quick edit slide by prompt"],
      ["N", "New slide by prompt"],
      ["1 – 4", "Apply variant (preview stays open)"],
      ["0", "Back to original"],
      ["Enter", "Done — close variants, keep applied"],
      ["Esc", "Close variants"],
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

// ━━━ Agent status chip (Neutralino desktop only) ━━━━━━━━━━━━━━━━━━━
// Renders a small footer chip showing the active CLI agent, its detected
// version / model, and the current deck's trust state. Click opens the
// settings dialog below. Feature-gated on window.__velaAgentInfo — other
// runtimes (artifact, serve.py) render nothing.

function AgentStatusChip() {
  const [, rerender] = useReducer((x) => x + 1, 0);
  const [info, setInfo] = useState(() => (typeof window !== "undefined" ? window.__velaAgentInfo : null));
  const [trustState, setTrustState] = useState("unknown");
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    function onUpdate() {
      setInfo(window.__velaAgentInfo || null);
      rerender();
    }
    window.addEventListener("vela-agent-update", onUpdate);
    return () => window.removeEventListener("vela-agent-update", onUpdate);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (typeof window.__velaTrustStatus !== "function") return;
      try {
        const s = await window.__velaTrustStatus();
        if (!cancelled) setTrustState(s);
      } catch {}
    }
    check();
    const id = setInterval(check, 4000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!info) return null; // not in Neutralino runtime

  const { available, label, version, model } = info;
  let statusText, statusColor;
  if (!available) { statusText = "offline"; statusColor = T.textMuted; }
  else if (trustState === "trusted") { statusText = "trusted"; statusColor = T.accent; }
  else if (trustState === "session") { statusText = "session"; statusColor = T.accent; }
  else if (trustState === "denied-session") { statusText = "declined"; statusColor = "#f87171"; }
  else { statusText = "untrusted"; statusColor = "#fbbf24"; }

  const parts = [label];
  if (version) parts.push(`v${version}`);
  if (model) parts.push(model);
  const detail = parts.join(" · ");

  return (
    <>
      <span onClick={() => setShowSettings(true)} title="Agent settings" style={{
        cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
        fontFamily: FONT.mono, fontSize: 9, color: T.textMuted, letterSpacing: "0.03em",
      }}>
        <span style={{ color: T.text, fontWeight: 600 }}>Vera</span>
        <span>·</span>
        <span>{detail}</span>
        <span>·</span>
        <span style={{ color: statusColor, fontWeight: 600 }}>{statusText}</span>
      </span>
      {showSettings && <AgentSettingsDialog onClose={() => setShowSettings(false)} />}
    </>
  );
}

function AgentSettingsDialog({ onClose }) {
  const [info, setInfo] = useState(() => (typeof window !== "undefined" ? window.__velaAgentInfo : null));
  const [trusted, setTrusted] = useState([]);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  // Re-scan for an installed AI agent. The old handler fired a fire-and-forget
  // refresh with no feedback and a muted style, so it read as un-clickable /
  // doing nothing (CR). Now it awaits detection, shows progress, and refreshes.
  async function rescanAgents() {
    if (scanning) return;
    setScanning(true);
    try { await window.__velaAgents?.refresh?.(); }
    catch {}
    finally {
      setScanning(false);
      if (typeof window !== "undefined") setInfo(window.__velaAgentInfo || null);
    }
  }

  async function loadTrusted() {
    if (typeof window.__velaTrustAdmin?.listForCurrentFolder !== "function") return;
    try { setTrusted(await window.__velaTrustAdmin.listForCurrentFolder()); }
    catch { setTrusted([]); }
  }

  useEffect(() => { loadTrusted(); }, []);

  useEffect(() => {
    function onUpdate() { setInfo(window.__velaAgentInfo || null); }
    window.addEventListener("vela-agent-update", onUpdate);
    return () => window.removeEventListener("vela-agent-update", onUpdate);
  }, []);

  async function revoke(relativePath) {
    setBusy(true);
    try { await window.__velaTrustAdmin.revoke(relativePath); await loadTrusted(); }
    finally { setBusy(false); }
  }

  async function revokeAll() {
    if (!confirm("Revoke AI trust for every deck in this folder? Each deck will re-prompt on next AI action.")) return;
    setBusy(true);
    try { await window.__velaTrustAdmin.revokeAll(); await loadTrusted(); }
    finally { setBusy(false); }
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <div style={{ maxHeight: "70vh", overflow: "auto", color: T.text, fontFamily: FONT.body }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, marginBottom: 14 }}>AI agent settings</h2>

        <div style={{ fontSize: 12, color: T.textDim, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Active agent</span>
          <button onClick={rescanAgents} disabled={scanning} style={S.btn({ fontSize: 10, padding: "3px 10px", color: scanning ? T.textDim : T.accent, borderColor: T.accent + "80", cursor: scanning ? "wait" : "pointer", opacity: scanning ? 0.7 : 1 })}>{scanning ? "Scanning…" : "↻ Re-scan"}</button>
        </div>
        <div style={{ padding: "10px 14px", background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 8, marginBottom: 18 }}>
          <div style={{ fontWeight: 600 }}>{info?.label || "—"} <span style={{ fontWeight: 400, color: info?.available ? T.accent : "#f87171", fontSize: 11, marginLeft: 6 }}>{info?.available ? "available" : "not detected"}</span></div>
          <div style={{ fontSize: 11, color: T.textDim, fontFamily: FONT.mono, marginTop: 4 }}>
            {info?.version ? `version ${info.version}` : "version unknown"}
            {info?.model ? ` · last model ${info.model}` : ""}
          </div>
        </div>

        {Array.isArray(info?.providers) && info.providers.length > 1 && (
          <>
            <div style={{ fontSize: 12, color: T.textDim, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Switch agent</div>
            <div style={{ marginBottom: 18 }}>
              {info.providers.map((p) => (
                <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: p.id === info.id ? T.bgInput : "transparent", border: `1px solid ${T.border}`, borderRadius: 8, marginBottom: 6, cursor: "pointer" }}>
                  <input type="radio" name="vela-agent-switch" checked={p.id === info.id} onChange={() => { try { window.__velaConfig?.setAgent?.(p.id); } catch {} }} />
                  <span style={{ fontWeight: 600 }}>{p.label}</span>
                  {p.version && <span style={{ fontSize: 11, color: T.textDim, fontFamily: FONT.mono }}>v{p.version}</span>}
                </label>
              ))}
            </div>
          </>
        )}

        <div style={{ fontSize: 12, color: T.textDim, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Trusted decks in this folder</span>
          {trusted.length > 0 && <button onClick={revokeAll} disabled={busy} style={S.btn({ fontSize: 10, padding: "3px 8px", color: "#f87171" })}>Revoke all</button>}
        </div>
        {trusted.length === 0 ? (
          <div style={{ fontSize: 12, color: T.textDim, padding: "14px 0" }}>No decks trusted yet. The first AI action on a deck will prompt for consent.</div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 14px", maxHeight: 240, overflow: "auto", border: `1px solid ${T.border}`, borderRadius: 8 }}>
            {trusted.map((t) => (
              <li key={t.relativePath} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: `1px solid ${T.border}`, fontSize: 12 }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: FONT.mono, marginRight: 10 }}>{t.relativePath}</div>
                <button onClick={() => revoke(t.relativePath)} disabled={busy} style={S.btn({ fontSize: 10, padding: "3px 8px", color: T.textMuted })}>Revoke</button>
              </li>
            ))}
          </ul>
        )}

        <div style={{ fontSize: 11, color: T.textDim, borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
          Trust decisions are stored in <code style={{ fontFamily: FONT.mono }}>&lt;folder&gt;/.vela/trust.json</code> and only apply on this machine. Delete the folder to reset.
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button onClick={onClose} style={S.btn({ padding: "6px 14px" })}>Close</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

