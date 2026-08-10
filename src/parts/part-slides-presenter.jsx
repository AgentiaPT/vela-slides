// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
// ━━━ Presenter TOC — slide-out panel on left edge in fullscreen ━━━
// Returns { text, source, blockIndex } — source: "heading"|"badge"|"fallback"
function getSlideSource(slide, idx) {
  if (slide?._virtual) return { text: slide.blocks?.find((b) => b.type === "heading")?.text || "Title Card", source: "heading", blockIndex: 0 };
  const blocks = slide?.blocks || [];
  const hi = blocks.findIndex((b) => b.type === "heading");
  if (hi >= 0 && blocks[hi].text) return { text: blocks[hi].text, source: "heading", blockIndex: hi };
  const bi = blocks.findIndex((b) => b.type === "badge");
  if (bi >= 0 && blocks[bi].text) return { text: blocks[bi].text, source: "badge", blockIndex: bi };
  return { text: `Slide ${idx + 1}`, source: "fallback", blockIndex: -1 };
}
function getSlideTitle(slide, idx) { return getSlideSource(slide, idx).text; }

function PresenterTOC({ slides, slideIndex, onJump, lanes, currentConceptId, dispatch }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pinned, setPinned] = useState(false);
  const panelRef = useRef(null);
  const searchRef = useRef(null);
  const closeTimer = useRef(null);

  const clearClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const scheduleClose = () => { clearClose(); if (!pinned) closeTimer.current = setTimeout(() => setOpen(false), 400); };

  useEffect(() => { if (open && searchRef.current) setTimeout(() => searchRef.current?.focus(), 100); }, [open]);
  useEffect(() => {
    if (!open) {
      setSearch("");
      // Return keyboard focus to the presenter surface. The search box lives in a
      // panel that only slides off-screen (still in the DOM), so if it keeps focus
      // the window-level presenter nav handlers — which bail when activeElement is
      // an INPUT — swallow every arrow key. Blurring drops focus back to the body.
      if (searchRef.current && document.activeElement === searchRef.current) {
        searchRef.current.blur();
      }
    }
  }, [open]);

  useEffect(() => {
    const handler = (e) => {
      // Ctrl/Cmd+E toggles the TOC/search pane (CR: quick-jump). Works even while
      // the search box is focused so the same chord closes it again.
      if ((e.ctrlKey || e.metaKey) && (e.key === "e" || e.key === "E")) {
        e.preventDefault();
        setOpen((v) => { setPinned(!v); return !v; });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Build grouped structure: all modules with their slides
  const grouped = useMemo(() => {
    const q = search.toLowerCase().trim();
    const groups = [];
    for (const lane of (lanes || [])) {
      if (lane.collapsed) continue;
      for (const item of lane.items) {
        // Hidden slides are not part of the presentation, so keep them out of the
        // presenter TOC/search entirely (but preserve their real slide index).
        const itemSlides = (item.slides || []).map((s, i) => {
          const title = getSlideTitle(s, i);
          return { title, slideIdx: i, hidden: !!s.hidden, visible: !s.hidden && (!q || title.toLowerCase().includes(q)) };
        }).filter((s) => !s.hidden);
        if (q && !itemSlides.some((s) => s.visible) && !item.title.toLowerCase().includes(q)) continue;
        groups.push({ id: item.id, title: item.title, laneTitle: lane.title, slides: itemSlides, isCurrent: item.id === currentConceptId });
      }
    }
    return groups;
  }, [lanes, search, currentConceptId]);

  // A module with a title card shows a virtual card at presSlides[0] in
  // fullscreen, so raw slide index i maps to presSlides[i+1]. The TOC is
  // fullscreen-only, so this offset always applies to presentCard modules.
  const presentCardOf = (id) => { for (const l of (lanes || [])) { const it = (l.items || []).find((i) => i.id === id); if (it) return !!it.presentCard; } return false; };
  const currentOffset = presentCardOf(currentConceptId) ? 1 : 0;

  // Count total visible slides for footer
  const totalSlides = useMemo(() => grouped.reduce((sum, g) => sum + g.slides.length, 0), [grouped]);
  const globalIndex = useMemo(() => {
    let idx = 0;
    for (const g of grouped) {
      if (g.isCurrent) {
        // `grouped` excludes hidden slides, so map the raw slideIndex (minus any
        // title-card offset) to its position among VISIBLE slides.
        return idx + g.slides.filter((s) => s.slideIdx < slideIndex - currentOffset).length;
      }
      idx += g.slides.length;
    }
    return idx;
  }, [grouped, slideIndex, currentOffset]);

  const activeRef = useRef(null);
  useEffect(() => { if (open) requestAnimationFrame(() => { activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }); }, [slideIndex, open, currentConceptId]);

  const handleJump = (moduleId, slideIdx) => {
    // Add the target module's title-card offset so the jump lands on the intended
    // slide (not one early) in presentCard modules.
    const idx = slideIdx + (presentCardOf(moduleId) ? 1 : 0);
    if (moduleId === currentConceptId) {
      onJump(idx);
    } else {
      // Navigate to different module
      dispatch({ type: "SELECT", id: moduleId });
      dispatch({ type: "SET_SLIDE_INDEX", index: idx });
    }
    // Jumping always closes the TOC/search pane (CR: quick-jump then dismiss).
    setPinned(false);
    setOpen(false);
  };

  // Enter in the search box jumps to the first slide that matches (CR: theme jump).
  const jumpFirstMatch = () => {
    for (const g of grouped) {
      const first = g.slides.find((s) => s.visible);
      if (first) { handleJump(g.id, first.slideIdx); return; }
    }
  };

  return (
    <>
      {!open && <div onMouseEnter={() => { setPinned(false); setOpen(true); }} style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 12, zIndex: 50, cursor: "default" }} />}

      <div
        ref={panelRef}
        onMouseEnter={clearClose}
        onMouseLeave={scheduleClose}
        style={{
          position: "absolute", left: 0, top: 0, bottom: 0, width: 280, zIndex: 45,
          background: T.isDark ? "rgba(10, 15, 28, 0.92)" : "rgba(255,255,255,0.96)", backdropFilter: "blur(20px)",
          borderRight: `1px solid ${T.border}`,
          transform: open ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
          display: "flex", flexDirection: "column",
          boxShadow: open ? (T.isDark ? "4px 0 32px rgba(0,0,0,0.5)" : "4px 0 24px rgba(0,0,0,0.1)") : "none",
        }}
      >
        {/* Header */}
        <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${T.border}` }}>
          <Presentation size={14} color={T.accent} />
          <span style={{ fontFamily: FONT.mono, fontSize: 10, fontWeight: 700, color: T.accent, letterSpacing: "0.06em", textTransform: "uppercase", flex: 1 }}>Slides</span>
          <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim }}>⌃E</span>
        </div>

        {/* Search */}
        <div style={{ padding: "8px 12px", position: "relative" }}>
          <Search size={13} color={T.textDim} style={{ position: "absolute", left: 20, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              // Ctrl/Cmd+E must still bubble to the global toggle so it closes the pane.
              if ((e.ctrlKey || e.metaKey) && (e.key === "e" || e.key === "E")) return;
              e.stopPropagation();
              if (e.key === "Enter") { e.preventDefault(); jumpFirstMatch(); }
              if (e.key === "Escape") { if (search) setSearch(""); else { setOpen(false); setPinned(false); } }
            }}
            placeholder="Search slides… (Enter jumps)"
            style={{
              width: "100%", padding: "6px 10px 6px 30px", fontSize: 13, fontFamily: FONT.body,
              background: T.bgInput, border: `1px solid ${T.border}`,
              borderRadius: 6, color: T.text, outline: "none", boxSizing: "border-box",
            }}
          />
        </div>

        {/* Grouped slide list */}
        <div data-scroll-container style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
          {grouped.map((group) => (
            <div key={group.id}>
              {/* Module header */}
              <div style={{
                padding: "8px 16px 4px", display: "flex", alignItems: "center", gap: 6,
                position: "sticky", top: 0, background: T.isDark ? "rgba(10, 15, 28, 0.95)" : "rgba(255,255,255,0.95)", zIndex: 2,
              }}>
                <span style={{
                  fontFamily: FONT.mono, fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                  color: group.isCurrent ? T.accent : T.textDim,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
                }}>{group.title}</span>
                <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim }}>{group.slides.length}</span>
              </div>
              {/* Slides */}
              {group.slides.map(({ title, slideIdx, visible }) => {
                if (!visible) return null;
                const active = group.isCurrent && slideIdx === slideIndex - currentOffset;
                return (
                  <div
                    key={slideIdx}
                    ref={active ? activeRef : null}
                    onClick={() => handleJump(group.id, slideIdx)}
                    style={{
                      padding: "6px 16px 6px 24px", cursor: "pointer",
                      display: "flex", alignItems: "baseline", gap: 10,
                      background: active ? `${T.accent}18` : "transparent",
                      borderLeft: active ? `3px solid ${T.accent}` : "3px solid transparent",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = T.isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ fontFamily: FONT.mono, fontSize: 9, color: active ? T.accent : T.textDim, minWidth: 14, textAlign: "right", flexShrink: 0 }}>{slideIdx + 1}</span>
                    <span style={{
                      fontFamily: FONT.display, fontSize: 13, fontWeight: active ? 600 : 400,
                      color: active ? T.text : group.isCurrent ? T.textMuted : T.textDim,
                      lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis",
                      display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                    }}>{title}</span>
                  </div>
                );
              })}
            </div>
          ))}
          {grouped.length === 0 && search && (
            <div style={{ padding: "20px 16px", fontFamily: FONT.body, fontSize: 13, color: T.textDim, textAlign: "center" }}>No matches</div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "8px 16px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim }}>{globalIndex + 1}/{totalSlides}</span>
          <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim }}>hover or ⌃E</span>
        </div>
      </div>
    </>
  );
}

// ━━━ Gallery Thumbnail — shimmer loading overlay until slide renders ━━━
const GALLERY_SHIMMER_ID = "vela-gallery-shimmer";
function _ensureGalleryShimmer() {
  if (document.getElementById(GALLERY_SHIMMER_ID)) return;
  const style = document.createElement("style");
  style.id = GALLERY_SHIMMER_ID;
  style.textContent = `@keyframes velaGalleryShimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}`;
  document.head.appendChild(style);
}
function GalleryThumb({ slide, slideIdx, total, branding }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    _ensureGalleryShimmer();
    const raf = requestAnimationFrame(() => { requestAnimationFrame(() => { setLoaded(true); }); });
    return () => cancelAnimationFrame(raf);
  }, []);
  const shimmerBg = T.isDark
    ? "linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 75%)"
    : "linear-gradient(90deg, rgba(0,0,0,0.03) 25%, rgba(0,0,0,0.07) 50%, rgba(0,0,0,0.03) 75%)";
  return (
    <div style={{ width: "100%", aspectRatio: "16/9", position: "relative", overflow: "hidden" }}>
      <VirtualSlide slide={slide} index={slideIdx} total={total} branding={branding} editable={false} mode="fit-width" bordered />
      {!loaded && (
        <div style={{ position: "absolute", inset: 0, zIndex: 2, background: cssColor(slide?.bg) || T.slideBg, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, transition: "opacity 0.3s ease" }}>
          <div style={{ width: "60%", height: 6, borderRadius: 3, backgroundImage: shimmerBg, backgroundSize: "200% 100%", animation: "velaGalleryShimmer 1.4s ease-in-out infinite" }} />
        </div>
      )}
    </div>
  );
}

// ━━━ Gallery View — slide sorter overlay in fullscreen ━━━━━━━━━━━━
// ━━━ Comment Popover (review mode) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function CommentPopover({ itemId, slideIndex, slide, dispatch, onClose, anchor }) {
  const [text, setText] = useState("");
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const existingComments = (slide?.comments || []).filter(Boolean);
  const submit = () => {
    if (!text.trim()) return;
    dispatch({ type: "ADD_COMMENT", itemId, slideIndex, text: text.trim() });
    setText("");
    onClose();
  };
  return (
    <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: 36, ...(anchor === "right" ? { right: 8 } : { left: 8 }), zIndex: 20, background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px", width: 280, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", maxHeight: 320, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
        <span style={{ fontFamily: FONT.mono, fontSize: 9, fontWeight: 700, color: T.accent, letterSpacing: "0.1em", textTransform: "uppercase" }}>ADD COMMENT</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 12, padding: "0 2px" }}>✕</button>
      </div>
      {existingComments.length > 0 && <div style={{ maxHeight: 140, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2, borderBottom: `1px solid ${T.border}`, paddingBottom: 4, marginBottom: 2 }}>
        {existingComments.map((c) => (
          <div key={c.id} style={{ display: "flex", alignItems: "flex-start", gap: 4, opacity: c.status === "resolved" ? 0.4 : 1 }}>
            <span onClick={() => dispatch({ type: c.status === "open" ? "RESOLVE_COMMENT" : "REOPEN_COMMENT", itemId, slideIndex, commentId: c.id })} style={{ cursor: "pointer", fontSize: 10, flexShrink: 0, marginTop: 1 }}>{c.status === "open" ? "○" : "●"}</span>
            <span style={{ fontSize: 10, fontFamily: FONT.body, color: T.text, textDecoration: c.status === "resolved" ? "line-through" : "none", wordBreak: "break-word", flex: 1 }}>{c.text}</span>
            <span onClick={() => dispatch({ type: "REMOVE_COMMENT", itemId, slideIndex, commentId: c.id })} style={{ fontSize: 9, color: T.textDim, cursor: "pointer", opacity: 0.4, flexShrink: 0 }}>×</span>
          </div>
        ))}
      </div>}
      <div style={{ display: "flex", gap: 4 }}>
        <textarea ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } if (e.key === "Escape") onClose(); }} placeholder="Add a comment..." rows={2} style={{ flex: 1, padding: "4px 8px", fontSize: 11, fontFamily: FONT.body, background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 4, color: T.text, outline: "none", resize: "none", lineHeight: 1.4 }} />
      </div>
      <button onClick={submit} disabled={!text.trim()} style={{ ...S.primaryBtn({ padding: "4px 10px", fontSize: 10 }), opacity: text.trim() ? 1 : 0.4, alignSelf: "flex-end" }}>Add Comment</button>
    </div>
  );
}

// ━━━ PresenterView — CR-08: single-screen speaker dashboard shown from
// Present mode (button + 'S' key). Offline can't drive a real second
// monitor, so this is a full-page dashboard overlay (same slot/precedent as
// GalleryView below): current slide, a "Next ▸" preview, speaker notes
// (slide.notes — the real per-slide field authored via the NOTES bar, not
// the separate offline studyNotes/student-mode feature), an elapsed timer
// running since Present mode was entered, and the slide position. Slide
// navigation itself is handled by the existing global arrow-key handler
// (unaffected by this overlay), so advancing the deck behind it just works.
function fmtElapsed(totalSeconds) {
  const s = Math.max(0, totalSeconds | 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
function PresenterView({ current, next, index, total, duration, elapsed, branding, onClose }) {
  const notes = (current?.notes || "").trim();
  const studyNotes = (current?.studyNotes?.text || "").trim();
  return (
    <div data-testid="presenter-view" onClick={(e) => e.stopPropagation()} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "#0a0d14", color: "#e2e8f0", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "10px 20px", display: "flex", alignItems: "center", gap: 14, borderBottom: "1px solid rgba(255,255,255,0.1)", flexShrink: 0 }}>
        <span style={{ fontSize: 16 }}>🖥️</span>
        <span style={{ fontFamily: FONT.mono, fontSize: 13, fontWeight: 700, color: "#60a5fa", letterSpacing: "0.05em" }}>PRESENTER VIEW</span>
        <span data-testid="presenter-timer" style={{ fontFamily: FONT.mono, fontSize: 15, fontWeight: 700, color: "#fff", background: "rgba(255,255,255,0.08)", padding: "3px 12px", borderRadius: 6 }}>⏱ {fmtElapsed(elapsed)}</span>
        <span style={{ fontFamily: FONT.mono, fontSize: 12, color: "#94a3b8" }}>Slide {index + 1} / {total}</span>
        {duration > 0 && <span style={{ fontFamily: FONT.mono, fontSize: 12, color: "#facc15" }}>budget {fmtElapsed(duration)}</span>}
        <span style={{ marginLeft: "auto", fontFamily: FONT.mono, fontSize: 11, color: "#64748b" }}>← → to advance · S or Esc to close</span>
        <button onClick={onClose} title="Close presenter view" style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 18, padding: 4 }}>✕</button>
      </div>
      <div style={{ flex: 1, display: "flex", gap: 18, padding: 20, minHeight: 0 }}>
        <div style={{ flex: 2, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          <div style={{ fontFamily: FONT.mono, fontSize: 10, color: "#64748b", letterSpacing: "0.05em" }}>NOW</div>
          <div style={{ flex: 1, minHeight: 0, borderRadius: 10, overflow: "hidden", border: "2px solid #3b82f6", boxShadow: "0 0 24px rgba(59,130,246,0.25)", display: "flex", alignItems: "center" }}>
            {current ? <GalleryThumb slide={current} slideIdx={index} total={total} branding={branding} /> : <div style={{ width: "100%", padding: 40, textAlign: "center", color: "#64748b" }}>No slide</div>}
          </div>
          <div data-testid="presenter-notes" style={{ flexShrink: 0, maxHeight: "38%", overflowY: "auto", background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: 14 }}>
            <div style={{ fontFamily: FONT.mono, fontSize: 10, color: "#64748b", letterSpacing: "0.05em", marginBottom: 6 }}>📝 SPEAKER NOTES</div>
            {notes ? <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{notes}</div> : <div style={{ fontSize: 13, color: "#64748b", fontStyle: "italic" }}>No notes</div>}
            {studyNotes && <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ fontFamily: FONT.mono, fontSize: 10, color: "#64748b", letterSpacing: "0.05em", marginBottom: 6 }}>🎓 STUDY NOTES</div>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: "#94a3b8", whiteSpace: "pre-wrap" }}>{studyNotes}</div>
            </div>}
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minWidth: 180, maxWidth: 320 }}>
          <div style={{ fontFamily: FONT.mono, fontSize: 10, color: "#64748b", letterSpacing: "0.05em" }}>NEXT ▸</div>
          <div data-testid="presenter-next" style={{ borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,255,255,0.15)", opacity: 0.85 }}>
            {next ? <GalleryThumb slide={next} slideIdx={index + 1} total={total} branding={branding} /> : <div style={{ aspectRatio: "16/9", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontFamily: FONT.mono, fontSize: 13, background: "rgba(255,255,255,0.03)", borderRadius: 8 }}>End</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

const GALLERY_MODULE_COLORS = ["#60a5fa","#a78bfa","#f472b6","#34d399","#f59e0b","#38bdf8","#fb7185","#818cf8","#2dd4bf","#e879f9","#fbbf24","#67e8f9"];
function GalleryView({ lanes, currentConceptId, slideIndex, dispatch, onClose, branding }) {
  const gridRef = useRef(null);
  const activeRef = useRef(null);
  const ZOOM_SIZES = [140, 180, 224, 300, 400, 560, 800];
  const savedZoom = useRef(() => { try { const v = parseInt(localStorage.getItem("vela-gallery-zoom")); return v >= 0 && v < 7 ? v : 2; } catch { return 2; } });
  const [zoomIdx, setZoomIdx] = useState(() => savedZoom.current());
  const setZoom = (fn) => { setZoomIdx((prev) => { const next = typeof fn === "function" ? fn(prev) : fn; try { localStorage.setItem("vela-gallery-zoom", String(next)); } catch {} return next; }); };
  const thumbWidth = ZOOM_SIZES[zoomIdx];

  // Mouse-based drag state (HTML5 drag blocked in iframe sandbox)
  const dragRef = useRef(null); // { itemId, slideIdx, startX, startY, active }
  const [dragActive, setDragActive] = useState(false);
  const [dragSrc, setDragSrc] = useState(null); // { itemId, slideIdx }
  const [dropTarget, setDropTarget] = useState(null); // { itemId, slideIdx, side }
  const cardRefs = useRef({}); // key → DOM element for hit testing

  const allSlides = useMemo(() => {
    const result = [];
    for (const lane of lanes) {
      for (const item of lane.items) {
        // CR1: section title cards (🎬 presentCard) render in the gallery/overview
        // exactly as they lead the module in presentation. Virtual, non-draggable,
        // excluded from the module's real-slide count; clicking selects the module.
        if (item.presentCard) {
          result.push({ slide: buildTitleCardSlide(item, lane, branding), itemId: item.id, slideIdx: 0, moduleTitle: item.title, laneTitle: lane.title, isCurrent: false, isTitleCard: true });
        }
        for (let si = 0; si < (item.slides || []).length; si++) {
          result.push({ slide: item.slides[si], itemId: item.id, slideIdx: si, moduleTitle: item.title, laneTitle: lane.title, isCurrent: item.id === currentConceptId && si === slideIndex });
        }
      }
    }
    return result;
  }, [lanes, currentConceptId, slideIndex, branding]);

  useEffect(() => { setTimeout(() => { activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, 100); }, []);

  useEffect(() => {
    const h = (e) => {
      if (e.key === "+" || e.key === "=") { e.preventDefault(); setZoom((z) => Math.min(z + 1, ZOOM_SIZES.length - 1)); }
      if (e.key === "-" || e.key === "_") { e.preventDefault(); setZoom((z) => Math.max(z - 1, 0)); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const jump = (itemId, slideIdx) => {
    dispatch({ type: "SELECT", id: itemId });
    dispatch({ type: "SET_SLIDE_INDEX", index: slideIdx });
    onClose();
  };

  // Mouse-based drag handlers
  const DRAG_THRESHOLD = 6; // pixels before drag activates

  const handleMouseDown = (e, s) => {
    if (e.button !== 0) return; // left click only
    dragRef.current = { itemId: s.itemId, slideIdx: s.slideIdx, startX: e.clientX, startY: e.clientY, active: false };
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.active) {
        const dx = Math.abs(e.clientX - d.startX);
        const dy = Math.abs(e.clientY - d.startY);
        if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
        d.active = true;
        setDragActive(true);
        setDragSrc({ itemId: d.itemId, slideIdx: d.slideIdx });
      }
      // Hit test: find which card the cursor is over
      let found = null;
      for (const [key, el] of Object.entries(cardRefs.current)) {
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
          const side = (e.clientX - rect.left) < rect.width / 2 ? "before" : "after";
          const [itemId, slideIdx] = key.split("|");
          found = { itemId, slideIdx: parseInt(slideIdx), side };
          break;
        }
      }
      setDropTarget(found);
    };

    const handleMouseUp = () => {
      const d = dragRef.current;
      if (d && d.active && dropTarget && dragSrc) {
        const toIdx = dropTarget.side === "before" ? dropTarget.slideIdx : dropTarget.slideIdx + 1;
        if (dragSrc.itemId === dropTarget.itemId) {
          // Same module reorder
          if (dragSrc.slideIdx !== toIdx && dragSrc.slideIdx + 1 !== toIdx) {
            const adjustedTo = dragSrc.slideIdx < toIdx ? toIdx - 1 : toIdx;
            dispatch({ type: "REORDER_SLIDE", id: dragSrc.itemId, from: dragSrc.slideIdx, to: adjustedTo });
          }
        } else {
          // Cross module
          dispatch({ type: "MOVE_SLIDE_TO_MODULE", fromId: dragSrc.itemId, toId: dropTarget.itemId, index: dragSrc.slideIdx, toIndex: toIdx });
        }
      }
      dragRef.current = null;
      setDragActive(false);
      setDragSrc(null);
      setDropTarget(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => { window.removeEventListener("mousemove", handleMouseMove); window.removeEventListener("mouseup", handleMouseUp); };
  }, [dropTarget, dragSrc, dispatch]);

  // Build module color map (stable order)
  const moduleColorMap = useMemo(() => {
    const map = {};
    let idx = 0;
    for (const lane of lanes) {
      for (const item of lane.items) {
        if (!map[item.id]) { map[item.id] = GALLERY_MODULE_COLORS[idx % GALLERY_MODULE_COLORS.length]; idx++; }
      }
    }
    return map;
  }, [lanes]);

  // Tag first slide of each module + compute slide counts
  const taggedSlides = useMemo(() => {
    const counts = {};
    // Count only real slides — virtual title cards don't inflate the module count.
    for (const s of allSlides) if (!s.isTitleCard) counts[s.itemId] = (counts[s.itemId] || 0) + 1;
    let lastItemId = null;
    return allSlides.map((s) => {
      const isFirst = s.itemId !== lastItemId;
      lastItemId = s.itemId;
      return { ...s, isFirst, moduleCount: counts[s.itemId] || 0 };
    });
  }, [allSlides]);

  // CR1/D8: the per-thumbnail page badge denominator must exclude virtual title cards
  // so the gallery reads "/ 28" (real slides) — matching presentation's globalSlideTotal —
  // not "/ 29" (which would count the virtual card).
  const realSlideTotal = useMemo(() => allSlides.filter((s) => !s.isTitleCard).length, [allSlides]);

  return (
    <div onClick={onClose} data-teacher-panel style={{ position: "fixed", inset: 0, zIndex: 10000, background: T.isDark ? "rgba(0,0,0,0.92)" : "rgba(241,245,249,0.96)", backdropFilter: "blur(8px)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ padding: "16px 24px", display: "flex", alignItems: "center", gap: 12, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <span style={{ fontSize: 18 }}>🗂</span>
        <span style={{ fontFamily: FONT.mono, fontSize: 14, fontWeight: 700, color: T.accent, letterSpacing: "0.05em" }}>GALLERY</span>
        <span style={{ fontFamily: FONT.mono, fontSize: 13, color: T.textMuted }}>{allSlides.filter((s) => !s.isTitleCard).length} slides</span>
        <span style={{ marginLeft: "auto", fontFamily: FONT.mono, fontSize: 13, color: T.textDim }}>+/− zoom · drag to reorder · G or ESC to close</span>
        <button data-testid="gallery-close" onClick={onClose} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: 18, padding: 4 }}>✕</button>
      </div>
      <div ref={gridRef} onClick={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()} style={{ flex: 1, overflowY: "auto", padding: "20px 32px", userSelect: dragActive ? "none" : "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, ${thumbWidth}px)`, gap: 16, justifyContent: "center" }}>
          {taggedSlides.map((s) => {
            const isCurrent = s.isCurrent;
            const modColor = moduleColorMap[s.itemId] || T.accent;
            const cardBorder = isCurrent ? `2px solid ${T.accent}` : `2px solid ${T.border}`;
            const cardShadow = isCurrent ? `0 0 20px ${T.accent}30` : T.isDark ? "0 2px 8px rgba(0,0,0,0.4)" : "0 2px 8px rgba(0,0,0,0.08)";
            const isDragSrc = dragSrc && dragSrc.itemId === s.itemId && dragSrc.slideIdx === s.slideIdx;
            const isDropHere = dropTarget && dropTarget.itemId === s.itemId && dropTarget.slideIdx === s.slideIdx;
            const dropSide = isDropHere ? dropTarget.side : null;
            // Title cards get a distinct key so they never collide with real slide 0,
            // and they are excluded from drag hit-testing / reorder (virtual, not real).
            const cardKey = s.isTitleCard ? s.itemId + "|tc" : s.itemId + "|" + s.slideIdx;
            return (
              <div key={"s-" + cardKey} data-testid={s.isTitleCard ? "gallery-title-card" : "gallery-slide"} ref={s.isTitleCard ? null : (el) => { cardRefs.current[cardKey] = el; if (isCurrent && el) activeRef.current = el; }}
                onMouseDown={s.isTitleCard ? undefined : (e) => handleMouseDown(e, s)}
                onClick={() => { if (!dragActive) jump(s.itemId, s.slideIdx); }}
                style={{ width: thumbWidth, cursor: dragActive ? "grabbing" : "pointer", transition: dragActive ? "none" : "all 0.15s", opacity: isDragSrc ? 0.3 : 1, position: "relative" }}>
                {/* Drop indicator — left */}
                {dropSide === "before" && <div style={{ position: "absolute", left: -5, top: 22, bottom: 0, width: 3, borderRadius: 2, background: T.accent, zIndex: 5, boxShadow: `0 0 8px ${T.accent}60`, pointerEvents: "none" }} />}
                {/* Drop indicator — right */}
                {dropSide === "after" && <div style={{ position: "absolute", right: -5, top: 22, bottom: 0, width: 3, borderRadius: 2, background: T.accent, zIndex: 5, boxShadow: `0 0 8px ${T.accent}60`, pointerEvents: "none" }} />}
                {/* Module label on first slide only */}
                <div style={{ height: 22, display: "flex", alignItems: "flex-end", paddingBottom: 2, paddingLeft: 1, overflow: "hidden" }}>
                  {s.isFirst && (
                    <span style={{ fontFamily: FONT.mono, fontSize: 13, fontWeight: 600, letterSpacing: "0.03em", color: modColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: thumbWidth - 4 }}>
                      {s.moduleTitle} <span style={{ fontWeight: 400, opacity: 0.6 }}>{s.moduleCount}</span>
                    </span>
                  )}
                </div>
                {/* Color bar — all slides in same module */}
                <div style={{ height: 3, background: modColor, borderRadius: "3px 3px 0 0" }} />
                {/* Slide card */}
                <div style={{ borderRadius: "0 0 8px 8px", border: cardBorder, borderTop: "none", boxShadow: cardShadow, background: T.bgCard, overflow: "hidden" }}
                  onMouseEnter={(e) => { if (!isCurrent && !dragSrc) { e.currentTarget.style.borderColor = T.borderLight; } }}
                  onMouseLeave={(e) => { if (!isCurrent) { e.currentTarget.style.borderColor = T.border; } }}>
                  <GalleryThumb slide={s.slide} slideIdx={s.slideIdx} total={realSlideTotal} branding={branding} />
                  <div style={{ padding: "6px 10px", background: isCurrent ? T.accent + "15" : T.isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", display: "flex", alignItems: "center", gap: 6 }}>
                    <span title={s.isTitleCard ? "Section title card" : undefined} style={{ fontFamily: FONT.mono, fontSize: 10, color: isCurrent ? T.accent : T.textDim, fontWeight: 700 }}>{s.isTitleCard ? "🎬" : s.slideIdx + 1}</span>
                    {(() => { const oc = (s.slide.comments || []).filter((c) => c.status === "open").length; return oc > 0 ? <span style={{ width: 8, height: 8, borderRadius: 4, background: T.amber, flexShrink: 0 }} title={`${oc} comment${oc > 1 ? "s" : ""}`} /> : null; })()}
                    {s.slide?.studyNotes?.text ? <span title="Has offline study notes" data-study-marker style={{ fontSize: 11, lineHeight: 1, flexShrink: 0, filter: `drop-shadow(0 0 2px ${T.accent}80)` }}>🎓</span> : null}
                    <span style={{ fontSize: 13, color: isCurrent ? T.text : T.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, fontFamily: FONT.body }}>{getSlideTitle(s.slide, s.slideIdx)}</span>
                    {!s.isTitleCard && <button onClick={(e) => { e.stopPropagation(); dispatch({ type: "REMOVE_SLIDE", id: s.itemId, index: s.slideIdx }); }} title="Delete slide" style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 4px", fontSize: 13, color: T.textDim, borderRadius: 3, opacity: 0.4, transition: "opacity 0.15s, color 0.15s" }} onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.color = "#ef4444"; }} onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.4"; e.currentTarget.style.color = T.textDim; }}>✕</button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ━━━ Vera Teacher Panel — student mode companion in fullscreen ━━━━━
function TeacherMessage({ text }) {
  if (!text) return null;
  let remaining = text;
  // Detect incomplete SVG (streaming) — more opens than closes
  const openCount = (remaining.match(/<svg[\s\b]/gi) || []).length;
  const closeCount = (remaining.match(/<\/svg>/gi) || []).length;
  const hasOpenSvg = openCount > closeCount;
  if (hasOpenSvg) {
    // Find the last unclosed <svg and strip from there
    const lastOpen = remaining.lastIndexOf("<svg");
    if (lastOpen >= 0) remaining = remaining.slice(0, lastOpen).trim();
  }
  const parts = [];
  const svgRe = /<svg[\s\S]*?<\/svg>/gi;
  let match, lastIdx = 0;
  const allMatches = [];
  while ((match = svgRe.exec(remaining)) !== null) allMatches.push({ start: match.index, end: match.index + match[0].length, svg: match[0] });
  if (allMatches.length === 0 && !hasOpenSvg) return <ChatMarkdown text={remaining} />;
  for (const m of allMatches) {
    if (m.start > lastIdx) parts.push({ type: "text", content: remaining.slice(lastIdx, m.start).trim() });
    parts.push({ type: "svg", content: sanitizeSvgMarkup(m.svg) });
    lastIdx = m.end;
  }
  if (lastIdx < remaining.length) parts.push({ type: "text", content: remaining.slice(lastIdx).trim() });
  if (hasOpenSvg) parts.push({ type: "svg-loading" });
  return <>{parts.map((p, i) => p.type === "svg"
    ? <div key={i} style={{ margin: "8px 0", borderRadius: 8, overflow: "hidden", background: "#1a1f2e", border: "1px solid rgba(59,130,246,0.2)" }} dangerouslySetInnerHTML={{ __html: p.content }} />
    : p.type === "svg-loading"
    ? <div key={i} style={{ margin: "8px 0", padding: "16px 20px", borderRadius: 8, background: "#1a1f2e", border: "1px solid rgba(59,130,246,0.2)", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 14, animation: "spin 1.5s linear infinite", display: "inline-block" }}>✏️</span>
        <span style={{ fontFamily: FONT.mono, fontSize: 13, color: "#93c5fd", fontWeight: 600 }}>Rendering diagram...</span>
      </div>
    : p.content ? <div key={i}><ChatMarkdown text={p.content} /></div> : null
  )}</>;
}
