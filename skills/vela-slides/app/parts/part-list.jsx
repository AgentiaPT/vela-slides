// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
// ━━━ AI Slide Adder (inline prompt) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function AiSlideAdder({ item, insertIndex, onClose, dispatch, guidelines }) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const generate = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const prevSlide = insertIndex > 0 ? item.slides[insertIndex - 1] : null;
      const nextSlide = insertIndex < item.slides.length ? item.slides[insertIndex] : null;
      const slide = await generateAiSlide(prompt.trim(), prevSlide, nextSlide, item.title, item.notes, guidelines);
      if (slide) {
        dispatch({ type: "INSERT_SLIDE", id: item.id, index: insertIndex, slide });
        dispatch({ type: "SELECT", id: item.id });
        setTimeout(() => dispatch({ type: "SET_SLIDE_INDEX", index: insertIndex }), 0);
        onClose();
      }
    } catch (e) {
      setError(e.message || "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "4px 8px 6px 38px", display: "flex", flexDirection: "column", gap: 4 }} onClick={(e) => e.stopPropagation()}>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: T.accent, fontFamily: FONT.mono, fontWeight: 700, flexShrink: 0 }}>AI+</span>
        <input
          ref={inputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generate(); } if (e.key === "Escape") onClose(); }}
          placeholder="Describe the slide you want..."
          disabled={loading}
          style={{ ...S.input({ padding: "3px 8px", fontSize: 12, borderRadius: 4 }), opacity: loading ? 0.5 : 1 }}
        />
        <button onClick={generate} disabled={loading || !prompt.trim()}
          style={{ ...S.primaryBtn({ padding: "3px 8px", fontSize: 10, borderRadius: 4 }), opacity: (loading || !prompt.trim()) ? 0.4 : 1, cursor: (loading || !prompt.trim()) ? "not-allowed" : "pointer", minWidth: 28 }}>
          {loading ? <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⚡</span> : "⚡"}
        </button>
        <button onClick={onClose} style={S.cancelBtn({ padding: "3px 6px", fontSize: 10, borderRadius: 4 })}>✕</button>
      </div>
      {loading && <div style={{ fontSize: 9, fontFamily: FONT.mono, color: T.accent, paddingLeft: 28, display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>🔧</span> generating slide...
      </div>}
      {error && <div style={{ fontSize: 9, fontFamily: FONT.mono, color: T.red, paddingLeft: 28 }}>⚠ {error}</div>}
    </div>
  );
}



// --- Empty Module AI Slide Adder ---
function EmptyAiSlideAdder({ item, dispatch, guidelines }) {
  const [open, setOpen] = useState(false);
  if (!open) return (
    <div onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      style={{ padding: "3px 8px 3px 38px", fontSize: 10, fontFamily: FONT.mono, color: T.accent, cursor: "pointer", opacity: 0.5, transition: "opacity .15s" }}
      onMouseEnter={(e) => e.currentTarget.style.opacity = 1}
      onMouseLeave={(e) => e.currentTarget.style.opacity = 0.5}
    >+ ai slide</div>
  );
  return <AiSlideAdder item={item} insertIndex={0} onClose={() => setOpen(false)} dispatch={dispatch} guidelines={guidelines} />;
}

// ━━━ Slide List with AI Adder ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function SlideListWithAdder({ item, selected, slideIndex, dispatch, guidelines, globalMaxSlideDur, slideOffset, slideTimeOffset }) {
  const [adderAt, setAdderAt] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [editingSi, setEditingSi] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const maxSlideDur = globalMaxSlideDur || 1;
  const activeSlideRef = useRef(null);
  useEffect(() => {
    if (selected && activeSlideRef.current) {
      requestAnimationFrame(() => activeSlideRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    }
  }, [slideIndex, selected]);

  const startEditSlideTitle = (e, si, currentTitle) => { e.stopPropagation(); setEditingSi(si); setEditTitle(currentTitle); };
  const commitSlideTitle = (si) => {
    const trimmed = editTitle.trim();
    if (!trimmed) { setEditingSi(null); return; }
    const slide = item.slides[si];
    const { source, blockIndex } = getSlideSource(slide, si);
    if (source === "heading" || source === "badge") {
      // Update the actual block text
      const blocks = [...(slide.blocks || [])];
      blocks[blockIndex] = { ...blocks[blockIndex], text: trimmed };
      dispatch({ type: "UPDATE_SLIDE", id: item.id, index: si, patch: { blocks }, merge: true });
    } else {
      // No heading/badge exists — prepend a heading block
      const blocks = [{ type: "heading", text: trimmed, size: "2xl" }, ...(slide.blocks || [])];
      dispatch({ type: "UPDATE_SLIDE", id: item.id, index: si, patch: { blocks }, merge: true });
    }
    // Clean up orphaned slide.title if it exists
    if (slide.title) dispatch({ type: "UPDATE_SLIDE", id: item.id, index: si, patch: { title: undefined }, merge: true });
    setEditingSi(null);
  };

  const handleSlideDragStart = (e, si) => {
    e.stopPropagation();
    e.dataTransfer.setData("application/vela-slide", JSON.stringify({ fromItemId: item.id, slideIndex: si }));
    e.dataTransfer.effectAllowed = "move";
    e.currentTarget.style.opacity = "0.35";
  };

  const handleSlideDragEnd = (e) => {
    e.currentTarget.style.opacity = "1";
    setDropTarget(null);
  };

  const handleSlideDragOver = (e, si) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.dataTransfer.types.includes("application/vela-slide")) return;
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    setDropTarget({ index: si, pos: e.clientY < mid ? "top" : "bottom" });
  };

  const handleSlideDrop = (e, si) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    try {
      const data = JSON.parse(e.dataTransfer.getData("application/vela-slide"));
      if (!data || data.slideIndex == null) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const toIndex = e.clientY < rect.top + rect.height / 2 ? si : si + 1;
      if (data.fromItemId === item.id) {
        let from = data.slideIndex, to = toIndex;
        if (from === to || from === to - 1) return;
        if (from < to) to--;
        dispatch({ type: "REORDER_SLIDE", id: item.id, from, to });
        dispatch({ type: "SET_SLIDE_INDEX", index: to });
      } else {
        dispatch({ type: "MOVE_SLIDE_TO_MODULE", fromId: data.fromItemId, toId: item.id, index: data.slideIndex, toIndex });
      }
    } catch {}
  };

  const handleContainerDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    try {
      const data = JSON.parse(e.dataTransfer.getData("application/vela-slide"));
      if (!data || data.slideIndex == null) return;
      if (data.fromItemId === item.id) {
        const from = data.slideIndex, to = item.slides.length - 1;
        if (from !== to) dispatch({ type: "REORDER_SLIDE", id: item.id, from, to });
      } else {
        dispatch({ type: "MOVE_SLIDE_TO_MODULE", fromId: data.fromItemId, toId: item.id, index: data.slideIndex });
      }
    } catch {}
  };

  return (
    <div style={{ paddingLeft: 28, paddingRight: 8, paddingBottom: 4, minHeight: 8 }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("application/vela-slide")) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
      onDrop={handleContainerDrop}
      onDragLeave={() => setDropTarget(null)}
    >
      {adderAt === 0 ? (
        <AiSlideAdder item={item} insertIndex={0} onClose={() => setAdderAt(null)} dispatch={dispatch} guidelines={guidelines} />
      ) : (
        <div onClick={(e) => { e.stopPropagation(); setAdderAt(0); }}
          style={{ padding: "1px 12px", fontSize: 9, fontFamily: FONT.mono, color: T.textDim, cursor: "pointer", opacity: 0, transition: "opacity .15s", textAlign: "center", lineHeight: "14px" }}
          onMouseEnter={(e) => e.currentTarget.style.opacity = 0.6}
          onMouseLeave={(e) => e.currentTarget.style.opacity = 0}
          title="AI: insert slide here"
        >+ ai</div>
      )}
      {(() => { let cumTime = slideTimeOffset || 0; return item.slides.map((s, si) => {
        const title = typeof getSlideTitle === "function" ? getSlideTitle(s, si) : `Slide ${si + 1}`;
        const isActive = selected && slideIndex === si;
        const isDragTop = dropTarget && dropTarget.index === si && dropTarget.pos === "top";
        const isDragBot = dropTarget && dropTarget.index === si && dropTarget.pos === "bottom";
        const sDur = s.duration || 0;
        const sPct = sDur > 0 ? Math.max(3, Math.round((sDur / maxSlideDur) * 100)) : 0;
        const slideCumTime = cumTime;
        cumTime += sDur;
        return <React.Fragment key={si}>
          <div
            ref={isActive ? activeSlideRef : null}
            draggable={editingSi !== si}
            onDragStart={(e) => handleSlideDragStart(e, si)}
            onDragEnd={handleSlideDragEnd}
            onDragOver={(e) => handleSlideDragOver(e, si)}
            onDragLeave={() => setDropTarget((p) => p && p.index === si ? null : p)}
            onDrop={(e) => handleSlideDrop(e, si)}
            onClick={(e) => { e.stopPropagation(); if (editingSi === si) return; if (!selected) dispatch({ type: "SELECT", id: item.id }); setTimeout(() => dispatch({ type: "SET_SLIDE_INDEX", index: si }), 0); }}
            style={{
              padding: "3px 8px 3px 12px", fontSize: 14, fontFamily: FONT.body, cursor: editingSi === si ? "text" : "grab",
              color: isActive ? T.accent : T.textMuted, fontWeight: isActive ? 600 : 400,
              borderLeft: `2px solid ${isActive ? T.accent : "transparent"}`,
              background: isActive ? T.accent + "0a" : "transparent",
              borderTop: isDragTop ? `2px solid ${T.accent}` : "2px solid transparent",
              borderBottom: isDragBot ? `2px solid ${T.accent}` : "2px solid transparent",
              borderRadius: "0 3px 3px 0", marginBottom: 1,
              display: "flex", alignItems: "center",
              overflow: "hidden", whiteSpace: "nowrap",
              transition: "background .12s, color .12s",
              position: "relative",
            }}
            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = T.text; e.currentTarget.style.background = T.accent + "10"; }}
            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = T.textMuted; e.currentTarget.style.background = isActive ? T.accent + "0a" : "transparent"; }}
          >
            {sPct > 0 && <div title={`${fmtTime(sDur)}${s.timeLock ? " 🔒" : ""}`} style={{ position: "absolute", left: 0, bottom: 0, height: 2, width: `${sPct}%`, background: "#8B5CF630", borderRadius: "0 1px 1px 0", cursor: "default" }} />}
            <span style={{ fontFamily: FONT.mono, fontSize: 9, color: isActive ? T.accent : T.textDim, marginRight: 4, fontWeight: 700, minWidth: 14 }}>{(slideOffset || 0) + si + 1}</span>
            <span style={{ fontFamily: FONT.mono, fontSize: 9, color: isActive ? T.accent : T.text, marginRight: 4, minWidth: 30, textAlign: "right", display: "inline-block" }}>{((t) => { const m = Math.floor(t / 60); const s = t % 60; return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s; })(slideCumTime)}</span>
            {editingSi === si ? (
              <input autoFocus value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commitSlideTitle(si); if (e.key === "Escape") setEditingSi(null); }}
                onBlur={() => commitSlideTitle(si)}
                onClick={(e) => e.stopPropagation()}
                style={{ ...S.input({ padding: "1px 4px", fontSize: 12, border: `1px solid ${T.accent}` }), flex: 1, minWidth: 0 }}
              />
            ) : (
              <span onDoubleClick={(e) => startEditSlideTitle(e, si, title)} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
            )}
          </div>
          {adderAt === si + 1 ? (
            <AiSlideAdder item={item} insertIndex={si + 1} onClose={() => setAdderAt(null)} dispatch={dispatch} guidelines={guidelines} />
          ) : (
            <div onClick={(e) => { e.stopPropagation(); setAdderAt(si + 1); }}
              style={{ padding: "1px 12px", fontSize: 9, fontFamily: FONT.mono, color: T.textDim, cursor: "pointer", opacity: 0, transition: "opacity .15s", textAlign: "center", lineHeight: "14px" }}
              onMouseEnter={(e) => e.currentTarget.style.opacity = 0.6}
              onMouseLeave={(e) => e.currentTarget.style.opacity = 0}
              title="AI: insert slide here"
            >+ ai</div>
          )}
        </React.Fragment>;
      }); })()}
    </div>
  );
}

// ━━━ Concept Row ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function ConceptRow({ item, selected, laneId, dispatch, maxTime, globalMaxSlideDur, slideIndex, guidelines, slideOffset, slideTimeOffset }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [dropPos, setDropPos] = useState(null); // "top" | "bottom" | null
  const [notesOpen, setNotesOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const startRename = (e) => { e.stopPropagation(); setEditing(true); setTitle(item.title); };
  const commitRename = () => { if (title.trim() && title.trim() !== item.title) dispatch({ type: "RENAME_ITEM", id: item.id, title: title.trim() }); setEditing(false); };

  // Section-level drag/drop on outer wrapper (works even when expanded)
  const handleSectionDragOver = (e) => {
    // Only handle section drags, let slide drags pass through
    if (!e.dataTransfer.types.includes("application/vela-section")) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    setDropPos(e.clientY < mid ? "top" : "bottom");
  };

  const handleSectionDrop = (e) => {
    if (!e.dataTransfer.types.includes("application/vela-section")) return;
    e.preventDefault(); e.stopPropagation(); 
    const pos = dropPos;
    setDropPos(null);
    try {
      const d = JSON.parse(e.dataTransfer.getData("application/vela-section"));
      if (d.itemId === item.id) return;
      dispatch({ type: "DRAG_REORDER", id: d.itemId, targetLaneId: laneId, beforeId: pos === "top" ? item.id : null, afterId: pos === "bottom" ? item.id : null });
    } catch {}
  };

  // Slide cross-module drops (on the header row only)
  const handleRowDragOver = (e) => {
    if (!e.dataTransfer.types.includes("application/vela-slide")) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "move";
    setDropPos("slide");
  };

  const handleRowDrop = (e) => {
    if (!e.dataTransfer.types.includes("application/vela-slide")) return;
    e.preventDefault(); e.stopPropagation(); setDropPos(null);
    try {
      const sd = e.dataTransfer.getData("application/vela-slide");
      if (sd) {
        const slideData = JSON.parse(sd);
        if (slideData && slideData.slideIndex != null && slideData.fromItemId !== item.id) {
          dispatch({ type: "MOVE_SLIDE_TO_MODULE", fromId: slideData.fromItemId, toId: item.id, index: slideData.slideIndex });
        }
      }
    } catch {}
  };

  const hasNotes = !!(item.notes && item.notes.trim());
  const hasSlides = item.slides.length > 0;
  const itemTime = item.slides.reduce((a, s) => a + (s.duration || 0), 0);
  const timePct = maxTime > 0 && itemTime > 0 ? Math.max(3, Math.round((itemTime / maxTime) * 100)) : 0;

  return (
    <div
      onDragOver={handleSectionDragOver}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropPos(null); }}
      onDrop={handleSectionDrop}
      style={{
        borderTop: dropPos === "top" ? `2px solid ${T.accent}` : "2px solid transparent",
        borderBottom: dropPos === "bottom" ? `2px solid ${T.accent}` : "2px solid transparent",
      }}
    >
      <div className={`concept-row ${selected ? "selected" : ""}`}
        onClick={() => dispatch({ type: "SELECT", id: item.id })}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("application/vela-section", JSON.stringify({ itemId: item.id, laneId }));
          e.dataTransfer.setData("text/plain", JSON.stringify({ itemId: item.id, laneId }));
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={handleRowDragOver}
        onDragLeave={() => { if (dropPos === "slide") setDropPos(null); }}
        onDrop={handleRowDrop}
        style={{ padding: "7px 12px 7px 10px", borderLeft: "2px solid transparent", display: "flex", alignItems: "center", gap: 8, minHeight: 34, position: "relative",
          background: dropPos === "slide" ? T.accent + "15" : undefined,
          outline: dropPos === "slide" ? `1px dashed ${T.accent}60` : "none",
        }}>
        {timePct > 0 && <div title={`${item.slides.length} slides · ${fmtTime(itemTime)}`} style={{ position: "absolute", left: 0, bottom: 0, height: 3, width: `${timePct}%`, background: T.accent + "30", borderRadius: "0 2px 2px 0", cursor: "default" }} />}
        <span onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed); }} style={{ fontSize: 10, color: T.textDim, transition: "transform .15s", transform: collapsed ? "rotate(-90deg)" : "rotate(0)", cursor: "pointer", flexShrink: 0, width: 12, textAlign: "center" }}>▼</span>
        <div className="imp-dot" onClick={(e) => { e.stopPropagation(); const cycle = { must: "should", should: "nice", nice: "must" }; dispatch({ type: "SET_IMPORTANCE", id: item.id, importance: cycle[item.importance || "should"] }); }} style={{ background: IMP[item.importance || "should"].dot, cursor: "pointer" }} title={`Priority: ${IMP[item.importance || "should"].label} (click to cycle)`} />
        {editing ? <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditing(false); }} onBlur={commitRename} onClick={(e) => e.stopPropagation()} style={S.input({ padding: "2px 6px", border: `1px solid ${T.borderLight}` })} />
          : <span onDoubleClick={startRename} style={{ flex: 1, fontSize: 14, fontFamily: FONT.body, color: T.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</span>}
        <span onClick={(e) => { e.stopPropagation(); setNotesOpen(!notesOpen); }} title={notesOpen ? "Hide notes" : "Edit notes"} style={{ fontSize: 10, cursor: "pointer", flexShrink: 0, opacity: hasNotes ? 1 : 0.3, color: hasNotes ? T.accent : T.textDim, lineHeight: 1 }}>📝</span>
        <span onClick={(e) => { e.stopPropagation(); dispatch({ type: "TOGGLE_PRESENT_CARD", id: item.id }); }} title={item.presentCard ? "Title card ON (click to disable)" : "Title card OFF (click to enable)"} style={{ fontSize: 10, cursor: "pointer", flexShrink: 0, opacity: item.presentCard ? 1 : 0.25, color: item.presentCard ? T.accent : T.textDim, lineHeight: 1 }}>🎬</span>
        <span onClick={(e) => { e.stopPropagation(); dispatch({ type: "REMOVE_ITEM", id: item.id }); }} style={{ fontSize: 12, color: T.textDim, cursor: "pointer", padding: "0 2px", opacity: 0.3 }}>×</span>
      </div>
      {!collapsed && notesOpen && <div style={{ padding: "2px 12px 6px 38px" }} onClick={(e) => e.stopPropagation()}>
        <textarea
          value={item.notes || ""}
          onChange={(e) => dispatch({ type: "SET_ITEM_NOTES", id: item.id, notes: e.target.value })}
          placeholder="Spec notes — talking points, key messages, constraints…"
          style={{ width: "100%", minHeight: 48, maxHeight: 140, padding: "6px 8px", fontSize: 12, fontFamily: FONT.body, background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 4, color: T.text, outline: "none", resize: "vertical", boxSizing: "border-box", lineHeight: 1.5 }}
        />
      </div>}
      {!collapsed && item.slides.length === 0 && <EmptyAiSlideAdder item={item} dispatch={dispatch} guidelines={guidelines} />}
      {!collapsed && hasSlides && <SlideListWithAdder item={item} selected={selected} slideIndex={slideIndex} dispatch={dispatch} guidelines={guidelines} globalMaxSlideDur={globalMaxSlideDur} slideOffset={slideOffset || 0} slideTimeOffset={slideTimeOffset || 0} />}
    </div>
  );
}

// ━━━ Module List (flat — no lane headers) ━━━━━━━━━━━━━━━━━━━━━━━━━
function ModuleList({ lanes, selectedId, slideIndex, dispatch, maxModuleTime, guidelines }) {
  const [adding, setAdding] = useState(false);
  const [val, setVal] = useState("");
  const laneId = lanes[0]?.id;
  const allItems = lanes.flatMap((l) => [...l.items].sort((a, b) => (a.order ?? 999) - (b.order ?? 999)));
  const totalDeckTime = React.useMemo(() => allItems.reduce((s, i) => s + (i.slides || []).reduce((a, sl) => a + (sl.duration || 0), 0), 0), [allItems]);
  const globalMaxSlideDur = React.useMemo(() => { let m = 0; for (const i of allItems) for (const s of (i.slides || [])) { if ((s.duration || 0) > m) m = s.duration; } return m || 1; }, [allItems]);
  const addItem = () => { if (!val.trim() || !laneId) return; dispatch({ type: "ADD_ITEM", laneId, title: val.trim() }); setVal(""); };
  const handleDrop = (e) => { e.preventDefault(); if (!laneId) return; try { const d = JSON.parse(e.dataTransfer.getData("application/vela-section") || e.dataTransfer.getData("text/plain")); dispatch({ type: "DRAG_REORDER", id: d.itemId, targetLaneId: laneId, beforeId: null, afterId: null }); } catch {} };

  return (
    <div onDragOver={(e) => { if (e.dataTransfer.types.includes("application/vela-section")) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }} onDrop={handleDrop}>
      {(() => { let offset = 0; let timeOffset = 0; return allItems.map((item) => {
        const itemLaneId = lanes.find((l) => l.items.some((i) => i.id === item.id))?.id || laneId;
        const slideOffset = offset;
        const slideTimeOffset = timeOffset;
        offset += (item.slides?.length || 0);
        timeOffset += (item.slides || []).reduce((a, sl) => a + (sl.duration || 0), 0);
        return <ConceptRow key={item.id} item={item} selected={selectedId === item.id} slideIndex={slideIndex} laneId={itemLaneId} dispatch={dispatch} maxTime={totalDeckTime} globalMaxSlideDur={globalMaxSlideDur} guidelines={guidelines} slideOffset={slideOffset} slideTimeOffset={slideTimeOffset} />;
      }); })()}
      {adding ? <div style={{ padding: "4px 12px", display: "flex", gap: 4 }}>
        <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addItem(); if (e.key === "Escape") setAdding(false); }} placeholder="Section name" style={S.input()} />
        <button onClick={addItem} style={S.primaryBtn()}>Add</button>
        <button onClick={() => setAdding(false)} style={S.cancelBtn()}>✕</button>
      </div> : <div onClick={() => setAdding(true)} style={{ padding: "5px 12px", fontSize: 12, color: T.textDim, cursor: "pointer", fontFamily: FONT.mono, opacity: 0.5 }}>+ section</div>}
    </div>
  );
}

