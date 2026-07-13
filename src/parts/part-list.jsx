// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.

// Drag payload lives in a module-level variable, NOT only in dataTransfer.
// `dataTransfer.getData()` is unreadable in the drop handler in several browsers
// (and returns "" for synthetic/headless events), which is why section + slide
// drag-drop silently did nothing. Reading the payload from here is reliable and
// unit-testable. We still call setData() so the OS shows the native move cursor.
let _velaDrag = null; // { kind: "slide", fromItemId, slideIndex } | { kind: "section", itemId, laneId }
const _setDrag = (p) => { _velaDrag = p; };
const _clearDrag = () => { _velaDrag = null; };

// ━━━ Reusable right-click context menu ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Positioned at the cursor, clamped to the viewport, and closes on outside-click
// or Escape. `children` is [menuFn, submenuFn]; each is called with a `move`
// controller ({ open(), isOpen }) so a menu item can swap the panel to a submenu
// (used for "Move to section" → SectionPicker).
function ContextMenu({ x, y, onClose, testid, children }) {
  const ref = useRef(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("mousedown", onDown, true); document.removeEventListener("keydown", onKey, true); };
  }, [onClose]);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    let left = x, top = y;
    if (left + r.width + 8 > window.innerWidth) left = Math.max(8, window.innerWidth - r.width - 8);
    if (top + r.height + 8 > window.innerHeight) top = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ left, top });
  }, [x, y, moveOpen]);
  const move = { open: () => setMoveOpen(true), isOpen: moveOpen };
  const kids = Array.isArray(children) ? children : [children];
  return <div ref={ref} data-testid={testid} style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 10000, background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 8, padding: 4, minWidth: 180, boxShadow: "0 6px 24px rgba(0,0,0,0.5)" }}>
    {moveOpen ? (kids[1] ? kids[1](move) : null) : (kids[0] ? kids[0](move) : null)}
  </div>;
}

function CtxItem({ label, icon, onClick, danger, arrow, testid }) {
  return <button data-testid={testid} onClick={(e) => { e.stopPropagation(); onClick(); }}
    style={{ ...S.btn({ fontSize: 13, textAlign: "left" }), display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 10px", borderRadius: 4, background: "transparent", border: "none", cursor: "pointer", color: danger ? T.red : T.text }}
    onMouseEnter={(e) => e.currentTarget.style.background = (danger ? T.red : T.accent) + "20"}
    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
    <span style={{ fontSize: 13, width: 16, textAlign: "center" }}>{icon}</span>
    <span style={{ flex: 1 }}>{label}</span>
    {arrow && <span style={{ color: T.textDim, fontSize: 11 }}>▸</span>}
  </button>;
}

// Visual/theme keys that define a slide's "look" — copied when adding a blank
// slide so it inherits the previous slide's styling but starts with no content.
const SLIDE_STYLE_KEYS = ["bg", "bgGradient", "bgImage", "color", "accent", "mutedColor", "padding", "p", "align", "gap", "contentFlex", "imageFlex", "theme", "t", "layout"];
function blankSlideFrom(prev) {
  const base = {};
  if (prev && typeof prev === "object") for (const k of SLIDE_STYLE_KEYS) if (k in prev) base[k] = prev[k];
  return { ...base, blocks: [], duration: (prev && prev.duration) || 20 };
}

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



// ━━━ Add Menu (blank / AI / section) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Replaces the old faint "+ ai" affordance. Offers three clearly-labelled
// options (CR: add blank slide reusing the previous slide's def, add AI slide,
// add section). `variant` controls prominence: "empty" (empty section, always
// visible) vs "row" (between slides, reveal on hover).
function AddMenu({ item, insertIndex, dispatch, guidelines, variant, laneId }) {
  const [mode, setMode] = useState(null); // null | "menu" | "ai"
  const [pinned, setPinned] = useState(false); // set by click — keeps menu open on mouseout
  if (mode === "ai") return <AiSlideAdder item={item} insertIndex={insertIndex} onClose={() => { setMode(null); setPinned(false); }} dispatch={dispatch} guidelines={guidelines} />;

  const close = () => { setMode(null); setPinned(false); };
  const openPinned = (e) => { e.stopPropagation(); setMode("menu"); setPinned(true); }; // click → open + pin
  const hoverOpen = () => setMode((m) => m || "menu"); // reveal on mouseover
  const hoverClose = () => { if (!pinned) setMode(null); }; // hide on mouseout unless pinned

  const addBlank = (e) => {
    e.stopPropagation();
    const prev = insertIndex > 0 ? item.slides[insertIndex - 1] : (item.slides[insertIndex] || item.slides[item.slides.length - 1] || null);
    dispatch({ type: "INSERT_SLIDE", id: item.id, index: insertIndex, slide: blankSlideFrom(prev) });
    dispatch({ type: "SELECT", id: item.id });
    setTimeout(() => dispatch({ type: "SET_SLIDE_INDEX", index: insertIndex }), 0);
    close();
  };
  // Insert a section at THIS exact add-point: between slides it splits the tail
  // off into the new section; at the top/bottom it adds an adjacent empty one.
  const addSection = (e) => { e.stopPropagation(); dispatch({ type: "SPLIT_ITEM_AT", id: item.id, index: insertIndex, laneId }); close(); };

  if (mode === "menu") {
    const btn = (label, icon, onClick, color) => (
      <button onClick={onClick} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "3px 8px", background: "transparent", border: `1px solid ${T.border}`, borderRadius: 4, color: color || T.text, fontFamily: FONT.mono, fontSize: 10, fontWeight: 700, lineHeight: 1, cursor: "pointer", whiteSpace: "nowrap" }}
        onMouseEnter={(e) => e.currentTarget.style.background = T.accent + "12"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 12, fontSize: 11, lineHeight: 1 }}>{icon}</span>
        <span style={{ lineHeight: 1 }}>{label}</span>
      </button>
    );
    return (
      // ADD_AFFORDANCE_HEIGHT (24) matches the collapsed "＋ add" row below so hovering
      // swaps content without shifting layout (the between-slide rows were jumping).
      <div style={{ display: "flex", gap: 4, height: 24, boxSizing: "border-box", padding: "0 12px", flexWrap: "nowrap", alignItems: "center", justifyContent: "center" }} onClick={(e) => e.stopPropagation()} onMouseLeave={hoverClose}>
        {btn("Blank", "▭", addBlank)}
        {btn("AI", "⚡", (e) => { e.stopPropagation(); setMode("ai"); }, T.accent)}
        {btn("Section", "▤", addSection)}
        <button onClick={(e) => { e.stopPropagation(); close(); }} style={{ background: "transparent", border: "none", color: T.textDim, cursor: "pointer", fontSize: 12, padding: "0 4px", lineHeight: 1 }}>✕</button>
      </div>
    );
  }

  // Single faint "＋ add" affordance — identical look/label whether it sits in an
  // empty section or between slides (consistency). Fixed 24px height matches the
  // hover menu above so revealing it doesn't shift surrounding rows. Hover reveals
  // the Blank / AI / Section menu; click pins it open.
  return (
    <div onClick={openPinned} onMouseEnter={hoverOpen}
      style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 24, boxSizing: "border-box", padding: "0 12px", fontSize: 10, fontFamily: FONT.mono, fontWeight: 700, color: T.accent, cursor: "pointer", opacity: 0.28, transition: "opacity .15s" }}
      title="Add slide or section here"
    >＋ add</div>
  );
}

// ━━━ Slide List with AI Adder ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function SlideListWithAdder({ item, selected, slideIndex, selectedSlideIndices, lanes, dispatch, guidelines, globalMaxSlideDur, slideOffset, slideTimeOffset, laneId }) {
  const [dropTarget, setDropTarget] = useState(null);
  const [containerOver, setContainerOver] = useState(false); // empty-section drop highlight
  const [editingSi, setEditingSi] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, si } — right-click slide context menu
  // Multi-selection applies only to the currently-selected module. An empty set
  // means "just the active slide". `multiSel` is the effective explicit set.
  const multiSel = (selected && Array.isArray(selectedSlideIndices)) ? selectedSlideIndices : [];
  const maxSlideDur = globalMaxSlideDur || 1;
  const activeSlideRef = useRef(null);
  useEffect(() => {
    if (selected && activeSlideRef.current) {
      requestAnimationFrame(() => activeSlideRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    }
  }, [slideIndex, selected]);

  // Plain click = single-select (clears multi). Shift+click = range from the
  // active slide (anchor) to the clicked row. Cmd/Ctrl+click = toggle a row in
  // the multi-selection. `slideIndex` stays the "active" slide.
  const handleSlideRowClick = (e, si) => {
    e.stopPropagation();
    if (editingSi === si) return;
    if (!selected) dispatch({ type: "SELECT", id: item.id });
    if (e.shiftKey) {
      const anchor = selected ? slideIndex : si;
      const lo = Math.min(anchor, si), hi = Math.max(anchor, si);
      const range = []; for (let k = lo; k <= hi; k++) range.push(k);
      dispatch({ type: "SET_SLIDE_SELECTION", indices: range, index: si });
    } else if (e.metaKey || e.ctrlKey) {
      const cur = new Set(multiSel);
      if (selected && multiSel.length === 0) cur.add(slideIndex); // seed from active slide
      if (cur.has(si)) cur.delete(si); else cur.add(si);
      const arr = Array.from(cur).sort((a, b) => a - b);
      dispatch({ type: "SET_SLIDE_SELECTION", indices: arr.length > 1 ? arr : [], index: si });
    } else {
      setTimeout(() => dispatch({ type: "SET_SLIDE_INDEX", index: si }), 0);
    }
  };

  // Apply a slide-toolbox action to the right-clicked slide, or to the whole
  // multi-selection when the right-clicked row is part of it.
  const ctxTargets = (si) => (multiSel.length > 1 && multiSel.includes(si)) ? [...multiSel].sort((a, b) => a - b) : [si];
  const ctxDelete = (si) => { const idxs = ctxTargets(si).sort((a, b) => b - a); dispatch({ type: "REMOVE_SLIDES", id: item.id, indices: idxs }); dispatch({ type: "SET_SLIDE_SELECTION", indices: [], index: Math.max(0, Math.min(...idxs) - 1) }); };
  const ctxDuplicate = (si) => dispatch({ type: "DUPLICATE_SLIDE", id: item.id, index: si });
  const ctxHide = (si) => ctxTargets(si).forEach((i) => dispatch({ type: "TOGGLE_SLIDE_HIDDEN", id: item.id, index: i }));
  // Multi-move ascending with index-shift compensation keeps target order intact.
  const ctxMove = (si, toId) => { const asc = ctxTargets(si).sort((a, b) => a - b); dispatch({ type: "MOVE_SLIDES_TO_MODULE", fromId: item.id, toId, indices: asc }); dispatch({ type: "SET_SLIDE_SELECTION", indices: [] }); };

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
    _setDrag({ kind: "slide", fromItemId: item.id, slideIndex: si });
    try { e.dataTransfer.setData("application/vela-slide", JSON.stringify({ fromItemId: item.id, slideIndex: si })); e.dataTransfer.effectAllowed = "move"; } catch {}
    e.currentTarget.style.opacity = "0.35";
  };

  const handleSlideDragEnd = (e) => {
    e.currentTarget.style.opacity = "1";
    setDropTarget(null);
    _clearDrag();
  };

  const handleSlideDragOver = (e, si) => {
    if (!_velaDrag || _velaDrag.kind !== "slide") return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    setDropTarget({ index: si, pos: e.clientY < mid ? "top" : "bottom" });
  };

  const handleSlideDrop = (e, si) => {
    if (!_velaDrag || _velaDrag.kind !== "slide") return;
    e.preventDefault();
    e.stopPropagation();
    const data = _velaDrag;
    setDropTarget(null);
    if (data.slideIndex == null) return;
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
  };

  const handleContainerDrop = (e) => {
    if (!_velaDrag || _velaDrag.kind !== "slide") return;
    e.preventDefault();
    e.stopPropagation();
    const data = _velaDrag;
    setDropTarget(null);
    if (data.slideIndex == null) return;
    if (data.fromItemId === item.id) {
      const from = data.slideIndex, to = item.slides.length - 1;
      if (from !== to) dispatch({ type: "REORDER_SLIDE", id: item.id, from, to });
    } else {
      dispatch({ type: "MOVE_SLIDE_TO_MODULE", fromId: data.fromItemId, toId: item.id, index: data.slideIndex });
    }
  };

  const isEmpty = item.slides.length === 0;
  // NOTE: read the _velaDrag global LIVE inside every drag handler (like the slide-row
  // handlers do) — never gate on a render-time snapshot. An empty section renders
  // before any drag starts, so a captured "is a slide being dragged?" flag stays false
  // and preventDefault() never runs → the browser shows the blocked cursor and refuses
  // the drop. Reading the global in-handler always reflects the current drag.
  // An empty section also needs a real, easily-hit drop target — a one-line add-row is
  // far too thin to aim a slide at. Render a tall dashed box that doubles as the
  // add affordance and lights up when a slide is dragged over it.
  if (isEmpty) {
    return (
      <div style={{ paddingLeft: 28, paddingRight: 8, paddingBottom: 6, paddingTop: 2 }}
        onDragOver={(e) => { if (_velaDrag && _velaDrag.kind === "slide") { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; if (_velaDrag.fromItemId !== item.id && !containerOver) setContainerOver(true); } }}
        onDrop={(e) => { setContainerOver(false); handleContainerDrop(e); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setContainerOver(false); }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          minHeight: 30, borderRadius: 6,
          border: `1.5px dashed ${containerOver ? T.accent : T.border}`,
          background: containerOver ? T.accent + "18" : "transparent",
          transition: "background .12s, border-color .12s",
        }}>
          {containerOver
            ? <span style={{ fontFamily: FONT.mono, fontSize: 11, fontWeight: 700, color: T.accent, pointerEvents: "none" }}>Drop slide here</span>
            : <AddMenu item={item} insertIndex={0} dispatch={dispatch} guidelines={guidelines} variant="row" laneId={laneId} />}
        </div>
      </div>
    );
  }
  return (
    <div style={{ paddingLeft: 28, paddingRight: 8, paddingBottom: 4, minHeight: 8 }}
      onDragOver={(e) => { if (_velaDrag && _velaDrag.kind === "slide") { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; } }}
      onDrop={handleContainerDrop}
      onDragLeave={() => setDropTarget(null)}
    >
      <AddMenu item={item} insertIndex={0} dispatch={dispatch} guidelines={guidelines} variant="row" laneId={laneId} />
      {(() => { let cumTime = slideTimeOffset || 0; return item.slides.map((s, si) => {
        const title = typeof getSlideTitle === "function" ? getSlideTitle(s, si) : `Slide ${si + 1}`;
        const isActive = selected && slideIndex === si;
        const isMultiSel = isActive || multiSel.includes(si);
        const isDragTop = dropTarget && dropTarget.index === si && dropTarget.pos === "top";
        const isDragBot = dropTarget && dropTarget.index === si && dropTarget.pos === "bottom";
        const sDur = s.duration || 0;
        const sPct = sDur > 0 ? Math.max(3, Math.round((sDur / maxSlideDur) * 100)) : 0;
        const slideCumTime = cumTime;
        cumTime += sDur;
        return <React.Fragment key={si}>
          <div
            ref={isActive ? activeSlideRef : null}
            data-testid="toc-slide-row"
            data-selected={isMultiSel ? "true" : undefined}
            draggable={editingSi !== si}
            onDragStart={(e) => handleSlideDragStart(e, si)}
            onDragEnd={handleSlideDragEnd}
            onDragOver={(e) => handleSlideDragOver(e, si)}
            onDragLeave={() => setDropTarget((p) => p && p.index === si ? null : p)}
            onDrop={(e) => handleSlideDrop(e, si)}
            onClick={(e) => handleSlideRowClick(e, si)}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (editingSi === si) return; if (!selected) dispatch({ type: "SELECT", id: item.id }); if (!multiSel.includes(si)) setTimeout(() => dispatch({ type: "SET_SLIDE_INDEX", index: si }), 0); setCtxMenu({ x: e.clientX, y: e.clientY, si }); }}
            style={{
              padding: "3px 8px 3px 12px", fontSize: 14, fontFamily: FONT.body, cursor: editingSi === si ? "text" : "grab",
              color: isActive ? T.accent : T.textMuted, fontWeight: isActive ? 600 : 400,
              borderLeft: `2px solid ${isMultiSel ? T.accent : "transparent"}`,
              background: isActive ? T.accent + "0a" : (isMultiSel ? T.accent + "22" : "transparent"),
              borderTop: isDragTop ? `2px solid ${T.accent}` : "2px solid transparent",
              borderBottom: isDragBot ? `2px solid ${T.accent}` : "2px solid transparent",
              borderRadius: "0 3px 3px 0", marginBottom: 1,
              display: "flex", alignItems: "center",
              overflow: "hidden", whiteSpace: "nowrap",
              transition: "background .12s, color .12s",
              position: "relative",
              opacity: s.hidden ? 0.5 : 1,
            }}
            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = T.text; if (!isMultiSel) e.currentTarget.style.background = T.accent + "10"; }}
            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = T.textMuted; e.currentTarget.style.background = isActive ? T.accent + "0a" : (isMultiSel ? T.accent + "22" : "transparent"); }}
          >
            {sPct > 0 && <div title={`${fmtTime(sDur)}${s.timeLock ? " 🔒" : ""}`} style={{ position: "absolute", left: 0, bottom: 0, height: 2, width: `${sPct}%`, background: "#8B5CF630", borderRadius: "0 1px 1px 0", cursor: "default" }} />}
            <span style={{ fontFamily: FONT.mono, fontSize: 9, color: isActive ? T.accent : T.textDim, marginRight: 4, fontWeight: 700, minWidth: 14 }}>{(slideOffset || 0) + si + 1}</span>
            {s.studyNotes?.text ? <span data-study-marker title="Has offline study notes" style={{ fontSize: 10, lineHeight: 1, marginRight: 3, flexShrink: 0 }}>🎓</span> : null}
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
              <span onDoubleClick={(e) => startEditSlideTitle(e, si, title)} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textDecoration: s.hidden ? "line-through" : "none" }}>{title}</span>
            )}
            <span onClick={(e) => { e.stopPropagation(); dispatch({ type: "TOGGLE_SLIDE_HIDDEN", id: item.id, index: si }); }}
              title={s.hidden ? "Hidden — click to show (excluded from presentation & counts)" : "Hide slide (keeps it in the list, excludes it from presentation & counts)"}
              style={{ flexShrink: 0, marginLeft: 4, fontSize: 11, lineHeight: 1, cursor: "pointer", opacity: s.hidden ? 0.9 : 0.28, transition: "opacity .15s" }}
              onMouseEnter={(e) => e.currentTarget.style.opacity = 1} onMouseLeave={(e) => e.currentTarget.style.opacity = s.hidden ? 0.9 : 0.28}
            >{s.hidden ? "🙈" : "👁"}</span>
          </div>
          <AddMenu item={item} insertIndex={si + 1} dispatch={dispatch} guidelines={guidelines} variant="row" laneId={laneId} />
        </React.Fragment>;
      }); })()}
      {ctxMenu && (() => {
        const si = ctxMenu.si;
        const hidden = item.slides[si]?.hidden;
        const count = (multiSel.length > 1 && multiSel.includes(si)) ? multiSel.length : 1;
        const suffix = count > 1 ? ` (${count})` : "";
        const destMods = []; for (const l of (lanes || [])) for (const it of l.items) if (it.id !== item.id) destMods.push({ id: it.id, title: it.title, lane: l.title });
        return <ContextMenu x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)} testid="toc-context-menu">
          {(move) => <>
            <CtxItem testid="ctx-move" label={`Move to section${suffix}…`} icon="📦" arrow onClick={() => move.open()} />
            <CtxItem testid="ctx-duplicate" label="Duplicate" icon="📋" onClick={() => { ctxDuplicate(si); setCtxMenu(null); }} />
            <CtxItem testid="ctx-hide" label={hidden ? `Show${suffix}` : `Hide${suffix}`} icon={hidden ? "👁" : "🙈"} onClick={() => { ctxHide(si); setCtxMenu(null); }} />
            <div style={{ height: 1, background: T.border + "80", margin: "3px 4px" }} />
            <CtxItem testid="ctx-delete" label={`Delete${suffix}`} icon="🗑" danger onClick={() => { ctxDelete(si); setCtxMenu(null); }} />
          </>}
          {(move) => move.isOpen && <SectionPicker mods={destMods} emptyLabel="No other sections" onPick={(toId) => { ctxMove(si, toId); setCtxMenu(null); }} />}
        </ContextMenu>;
      })()}
    </div>
  );
}

// ━━━ Concept Row ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function ConceptRow({ item, selected, laneId, dispatch, maxTime, globalMaxSlideDur, slideIndex, selectedSlideIndices, lanes, guidelines, slideOffset, slideTimeOffset, reviewMode, isFirst, isLast }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [dropPos, setDropPos] = useState(null); // "top" | "bottom" | null
  const [notesOpen, setNotesOpen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const startRename = (e) => { e.stopPropagation(); setEditing(true); setTitle(item.title); };
  const commitRename = () => { if (title.trim() && title.trim() !== item.title) dispatch({ type: "RENAME_ITEM", id: item.id, title: title.trim() }); setEditing(false); };
  // A just-inserted section opens directly in title-edit mode with an empty field,
  // so the user can type the name immediately (INSERT_ITEM tags its id).
  useEffect(() => {
    if (_autoEditItemId === item.id) { _autoEditItemId = null; setEditing(true); setTitle(""); }
  }, []);

  const headerRef = useRef(null);
  // Section-level drag/drop on the outer wrapper (works even when the section is
  // expanded). Position (top/bottom) is measured against the HEADER row, not the
  // tall wrapper, so dropping anywhere in the section still reorders correctly.
  const handleSectionDragOver = (e) => {
    if (!_velaDrag || _velaDrag.kind !== "section" || _velaDrag.itemId === item.id) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "move";
    const rect = (headerRef.current || e.currentTarget).getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    setDropPos(e.clientY < mid ? "top" : "bottom");
  };

  const handleSectionDrop = (e) => {
    if (!_velaDrag || _velaDrag.kind !== "section") return;
    e.preventDefault(); e.stopPropagation();
    const d = _velaDrag; const pos = dropPos;
    setDropPos(null);
    if (d.itemId === item.id) return;
    dispatch({ type: "DRAG_REORDER", id: d.itemId, targetLaneId: laneId, beforeId: pos === "top" ? item.id : null, afterId: pos !== "top" ? item.id : null });
  };

  // Slide cross-module drops (dropping a slide onto a section header — the key
  // path for moving a slide INTO an empty section).
  const handleRowDragOver = (e) => {
    if (!_velaDrag || _velaDrag.kind !== "slide") return;
    // stopPropagation is REQUIRED: the app-root global dragover forces
    // dropEffect="copy", which conflicts with the slide's effectAllowed="move" and
    // makes the browser show the blocked cursor. Stopping here keeps it "move".
    e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move";
    setDropPos("slide");
  };

  const handleRowDrop = (e) => {
    if (!_velaDrag || _velaDrag.kind !== "slide") return;
    e.preventDefault(); e.stopPropagation();
    const slideData = _velaDrag; setDropPos(null);
    if (slideData.slideIndex != null && slideData.fromItemId !== item.id) {
      dispatch({ type: "MOVE_SLIDE_TO_MODULE", fromId: slideData.fromItemId, toId: item.id, index: slideData.slideIndex });
    }
  };

  // Wrapper-level handlers accept BOTH drag kinds. A slide dropped anywhere in
  // the section — not just on the thin header — moves into this module; this is
  // the only slide-drop target an EMPTY section has (its body renders just the
  // add affordance, with no slide rows to catch the drop). The header/slide-row
  // handlers stopPropagation, so they still win for finer-grained positioning.
  const handleWrapperDragOver = (e) => {
    if (!_velaDrag) return;
    if (_velaDrag.kind === "section") return handleSectionDragOver(e);
    if (_velaDrag.kind === "slide") return handleRowDragOver(e);
  };
  const handleWrapperDrop = (e) => {
    if (!_velaDrag) return;
    if (_velaDrag.kind === "section") return handleSectionDrop(e);
    if (_velaDrag.kind === "slide") return handleRowDrop(e);
  };

  const hasNotes = !!(item.notes && item.notes.trim());
  const itemComments = item.comments || [];
  const slideComments = (item.slides || []).flatMap((s, si) => (s.comments || []).map((c) => ({ ...c, slideIndex: si })));
  const allItemComments = [...itemComments.map((c) => ({ ...c, slideIndex: null })), ...slideComments];
  const openCommentCount = allItemComments.filter((c) => c.status === "open").length;
  const hasSlides = item.slides.length > 0;
  const itemTime = sumVisibleDurations(item.slides);
  const visibleCount = visibleSlides(item.slides).length;
  const hiddenCount = item.slides.length - visibleCount;
  const timePct = maxTime > 0 && itemTime > 0 ? Math.max(3, Math.round((itemTime / maxTime) * 100)) : 0;

  return (
    <div
      onDragOver={handleWrapperDragOver}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropPos(null); }}
      onDrop={handleWrapperDrop}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderTop: dropPos === "top" ? `2px solid ${T.accent}` : "2px solid transparent",
        borderBottom: dropPos === "bottom" ? `2px solid ${T.accent}` : "2px solid transparent",
      }}
    >
      <div className={`concept-row ${selected ? "selected" : ""}`}
        ref={headerRef}
        onClick={() => dispatch({ type: "SELECT", id: item.id })}
        draggable
        onDragStart={(e) => {
          _setDrag({ kind: "section", itemId: item.id, laneId });
          try { e.dataTransfer.setData("application/vela-section", JSON.stringify({ itemId: item.id, laneId })); e.dataTransfer.setData("text/plain", JSON.stringify({ itemId: item.id, laneId })); e.dataTransfer.effectAllowed = "move"; } catch {}
        }}
        onDragEnd={_clearDrag}
        onDragOver={handleRowDragOver}
        onDragLeave={() => { if (dropPos === "slide") setDropPos(null); }}
        onDrop={handleRowDrop}
        style={{ padding: "7px 12px 7px 10px", borderLeft: "2px solid transparent", display: "flex", alignItems: "center", gap: 8, minHeight: 34, position: "relative",
          background: dropPos === "slide" ? T.accent + "15" : undefined,
          outline: dropPos === "slide" ? `1px dashed ${T.accent}60` : "none",
        }}>
        {timePct > 0 && <div title={`${visibleCount} slides${hiddenCount > 0 ? ` (+${hiddenCount} hidden)` : ""} · ${fmtTime(itemTime)}`} style={{ position: "absolute", left: 0, bottom: 0, height: 3, width: `${timePct}%`, background: T.accent + "30", borderRadius: "0 2px 2px 0", cursor: "default" }} />}
        <span onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed); }} style={{ fontSize: 10, color: T.textDim, transition: "transform .15s", transform: collapsed ? "rotate(-90deg)" : "rotate(0)", cursor: "pointer", flexShrink: 0, width: 12, textAlign: "center" }}>▼</span>
        <div className="imp-dot" onClick={(e) => { e.stopPropagation(); const cycle = { must: "should", should: "nice", nice: "must" }; dispatch({ type: "SET_IMPORTANCE", id: item.id, importance: cycle[item.importance || "should"] }); }} style={{ background: IMP[item.importance || "should"].dot, cursor: "pointer" }} title={`Priority: ${IMP[item.importance || "should"].label} (click to cycle)`} />
        {editing ? <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onFocus={(e) => e.target.select()} placeholder="Section name" onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditing(false); }} onBlur={commitRename} onClick={(e) => e.stopPropagation()} style={S.input({ padding: "2px 6px", border: `1px solid ${T.borderLight}` })} />
          : <span onDoubleClick={startRename} style={{ flex: 1, fontSize: 14, fontFamily: FONT.body, color: T.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</span>}
        {reviewMode && openCommentCount > 0 && <span style={{ fontSize: 9, fontFamily: FONT.mono, fontWeight: 700, color: "#fff", background: T.amber, borderRadius: 8, padding: "0 4px", minWidth: 14, textAlign: "center", flexShrink: 0, lineHeight: "16px" }}>{openCommentCount}</span>}
        {reviewMode && <span onClick={(e) => { e.stopPropagation(); setNotesOpen(!notesOpen); }} title={notesOpen ? "Hide comments" : "Show comments"} style={{ fontSize: 10, cursor: "pointer", flexShrink: 0, opacity: (openCommentCount > 0 || hasNotes) ? 1 : 0.3, color: (openCommentCount > 0 || hasNotes) ? T.accent : T.textDim, lineHeight: 1 }}>💬</span>}
        <span onClick={(e) => { e.stopPropagation(); dispatch({ type: "TOGGLE_PRESENT_CARD", id: item.id }); }} title={item.presentCard ? "Title card ON (click to disable)" : "Title card OFF (click to enable)"} style={{ fontSize: 10, cursor: "pointer", flexShrink: 0, opacity: item.presentCard ? 1 : 0.25, color: item.presentCard ? T.accent : T.textDim, lineHeight: 1 }}>🎬</span>
        {hovered && <span style={{ display: "flex", flexDirection: "column", gap: 0, flexShrink: 0 }}>
          <span onClick={(e) => { e.stopPropagation(); dispatch({ type: "REORDER", id: item.id, dir: "up" }); }} title="Move up" style={{ fontSize: 8, color: isFirst ? T.border : T.textDim, cursor: isFirst ? "default" : "pointer", lineHeight: 1, padding: "0 1px", opacity: isFirst ? 0.3 : 0.7 }}>▲</span>
          <span onClick={(e) => { e.stopPropagation(); dispatch({ type: "REORDER", id: item.id, dir: "down" }); }} title="Move down" style={{ fontSize: 8, color: isLast ? T.border : T.textDim, cursor: isLast ? "default" : "pointer", lineHeight: 1, padding: "0 1px", opacity: isLast ? 0.3 : 0.7 }}>▼</span>
        </span>}
        <span onClick={(e) => { e.stopPropagation(); dispatch({ type: "REMOVE_ITEM", id: item.id }); }} style={{ fontSize: 12, color: T.textDim, cursor: "pointer", padding: "0 2px", opacity: 0.3 }}>×</span>
      </div>
      {!collapsed && notesOpen && <div style={{ padding: "2px 12px 6px 38px" }} onClick={(e) => e.stopPropagation()}>
        {/* Existing comments */}
        {allItemComments.length > 0 && <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 4 }}>
          {allItemComments.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "flex-start", gap: 4, padding: "3px 0", opacity: c.status === "resolved" ? 0.45 : 1 }}>
              <span onClick={() => {
                const payload = { itemId: item.id, commentId: c.id, slideIndex: c.slideIndex };
                dispatch({ type: c.status === "open" ? "RESOLVE_COMMENT" : "REOPEN_COMMENT", ...payload });
              }} style={{ cursor: "pointer", fontSize: 11, flexShrink: 0, lineHeight: 1, marginTop: 1 }} title={c.status === "open" ? "Resolve" : "Reopen"}>{c.status === "open" ? "○" : "●"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 11, fontFamily: FONT.body, color: T.text, textDecoration: c.status === "resolved" ? "line-through" : "none", wordBreak: "break-word" }}>{c.text}</span>
                {c.slideIndex != null && <span style={{ fontSize: 9, fontFamily: FONT.mono, color: T.textDim, marginLeft: 4 }}>s{c.slideIndex + 1}</span>}
                {c.anchor && <span style={{ fontSize: 9, fontFamily: FONT.mono, color: T.accent, marginLeft: 4 }}>"{c.anchor}"</span>}
              </div>
              <span onClick={() => dispatch({ type: "REMOVE_COMMENT", itemId: item.id, commentId: c.id, slideIndex: c.slideIndex })} style={{ fontSize: 10, color: T.textDim, cursor: "pointer", opacity: 0.4, flexShrink: 0 }}>×</span>
            </div>
          ))}
        </div>}
        {/* Add comment input */}
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && commentText.trim()) { dispatch({ type: "ADD_COMMENT", itemId: item.id, text: commentText.trim() }); setCommentText(""); } if (e.key === "Escape") { setCommentText(""); setNotesOpen(false); } }}
            placeholder="Add comment..."
            style={S.input({ padding: "3px 6px", fontSize: 11 })}
          />
          <button onClick={() => { if (commentText.trim()) { dispatch({ type: "ADD_COMMENT", itemId: item.id, text: commentText.trim() }); setCommentText(""); } }} disabled={!commentText.trim()} style={S.primaryBtn({ padding: "3px 6px", fontSize: 9, opacity: commentText.trim() ? 1 : 0.4 })}>+</button>
        </div>
      </div>}
      {/* Always render SlideListWithAdder — even when empty — so an empty section
          has the SAME "＋ add" affordance AND the same proven slide-drop container
          as a populated one (fixes both the inconsistency and the can't-drop-into-
          empty-section bug). It renders just the add row when there are no slides. */}
      {!collapsed && <SlideListWithAdder item={item} selected={selected} slideIndex={slideIndex} selectedSlideIndices={selectedSlideIndices} lanes={lanes} dispatch={dispatch} guidelines={guidelines} globalMaxSlideDur={globalMaxSlideDur} slideOffset={slideOffset || 0} slideTimeOffset={slideTimeOffset || 0} laneId={laneId} />}
    </div>
  );
}

// ━━━ Module List (flat — no lane headers) ━━━━━━━━━━━━━━━━━━━━━━━━━
function ModuleList({ lanes, selectedId, slideIndex, selectedSlideIndices, dispatch, maxModuleTime, guidelines, reviewMode }) {
  const [adding, setAdding] = useState(false);
  const [val, setVal] = useState("");
  const laneId = lanes[0]?.id;
  const allItems = lanes.flatMap((l) => [...l.items].sort((a, b) => (a.order ?? 999) - (b.order ?? 999)));
  const totalDeckTime = React.useMemo(() => allItems.reduce((s, i) => s + sumVisibleDurations(i.slides), 0), [allItems]);
  const globalMaxSlideDur = React.useMemo(() => { let m = 0; for (const i of allItems) for (const s of (i.slides || [])) { if ((s.duration || 0) > m) m = s.duration; } return m || 1; }, [allItems]);
  const addItem = () => { if (!val.trim() || !laneId) return; dispatch({ type: "ADD_ITEM", laneId, title: val.trim() }); setVal(""); };
  // Drop on empty container area → append the dragged section to the end.
  const handleDrop = (e) => { if (!_velaDrag || _velaDrag.kind !== "section" || !laneId) return; e.preventDefault(); dispatch({ type: "DRAG_REORDER", id: _velaDrag.itemId, targetLaneId: laneId, beforeId: null, afterId: null }); };

  return (
    <div onDragOver={(e) => { if (_velaDrag && _velaDrag.kind === "section") { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }} onDrop={handleDrop}>
      {(() => { let offset = 0; let timeOffset = 0; return allItems.map((item, idx) => {
        const itemLaneId = lanes.find((l) => l.items.some((i) => i.id === item.id))?.id || laneId;
        const slideOffset = offset;
        const slideTimeOffset = timeOffset;
        offset += (item.slides?.length || 0);
        timeOffset += (item.slides || []).reduce((a, sl) => a + (sl.duration || 0), 0);
        return <ConceptRow key={item.id} item={item} selected={selectedId === item.id} slideIndex={slideIndex} selectedSlideIndices={selectedSlideIndices} lanes={lanes} laneId={itemLaneId} dispatch={dispatch} maxTime={totalDeckTime} globalMaxSlideDur={globalMaxSlideDur} guidelines={guidelines} slideOffset={slideOffset} slideTimeOffset={slideTimeOffset} reviewMode={reviewMode} isFirst={idx === 0} isLast={idx === allItems.length - 1} />;
      }); })()}
      {adding ? <div style={{ padding: "4px 12px", display: "flex", gap: 4 }}>
        <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addItem(); if (e.key === "Escape") setAdding(false); }} placeholder="Section name" style={S.input()} />
        <button onClick={addItem} style={S.primaryBtn()}>Add</button>
        <button onClick={() => setAdding(false)} style={S.cancelBtn()}>✕</button>
      </div> : <div onClick={() => setAdding(true)} style={{ padding: "5px 12px", fontSize: 12, color: T.textDim, cursor: "pointer", fontFamily: FONT.mono, opacity: 0.5 }}>+ section</div>}
    </div>
  );
}

