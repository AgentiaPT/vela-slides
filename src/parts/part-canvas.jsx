// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
//
// ── Design note: slide canvas & editor-chrome positioning model ──
// This part renders the slide canvas (SlideContent), the per-slide chrome
// (BrandingOverlay: accent bar, footer, slide number, logo) and the per-block
// EDITOR chrome (renderBlockItem: hover toolbar, AI-edit/link/comment popups,
// badges, selection outlines). Two positioning regimes coexist:
//   1. Normal blocks sit inset from the slide edge by the slide's padding, so
//      block chrome deliberately "escapes" OUTWARD with small negative
//      top/right/left/inset offsets, landing in that padding gutter.
//   2. Any block rendered flush with the slide edge has no gutter to escape
//      into: the slide wrapper (VirtualSlide, part-slides.jsx) is
//      overflow:hidden at the 960×540 boundary, so outward-escaping chrome on
//      a flush block gets clipped and becomes unreachable. A full-bleed solo
//      image (isSoloImage → block._solo, pad "0px") is the canonical flush
//      case. Chrome for flush blocks must clamp INWARD (positive offsets)
//      instead — see COL_TOOLBAR_PAD for the sibling technique used to keep
//      column-layout toolbars inside their clip box.
// If you add or move any absolutely-positioned chrome element here, decide
// which regime it is in; an outward offset is only safe when a padding gutter
// is guaranteed to exist.
//
// ━━━ Slide Content ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ━━━ Inline Comment Card (review mode) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function InlineCommentCard({ comment, itemId, slideIndex, dispatch }) {
  const [hover, setHover] = useState(false);
  const resolved = comment.status === "resolved";
  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 6px 2px 5px", margin: "2px 0", background: resolved ? T.amber + "08" : T.amber + "12", border: `1px solid ${resolved ? T.amber + "20" : T.amber + "35"}`, borderRadius: 4, opacity: resolved ? 0.5 : 1, transition: "opacity 0.15s", width: "fit-content" }}>
      <span style={{ fontSize: 10, flexShrink: 0, lineHeight: 1 }}>💬</span>
      <span style={{ fontSize: 10, fontFamily: FONT.body, color: T.text, textDecoration: resolved ? "line-through" : "none", whiteSpace: "nowrap", lineHeight: 1.4 }}>{comment.text}</span>
      {comment.anchor && <span style={{ fontSize: 8, fontFamily: FONT.mono, color: T.textDim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 80, flexShrink: 0 }}>"{comment.anchor}"</span>}
      <span onClick={(e) => { e.stopPropagation(); dispatch({ type: resolved ? "REOPEN_COMMENT" : "RESOLVE_COMMENT", itemId, slideIndex, commentId: comment.id }); }} style={{ cursor: "pointer", fontSize: 10, flexShrink: 0, opacity: hover ? 0.9 : 0.4, transition: "opacity 0.15s" }} title={resolved ? "Reopen" : "Resolve"}>{resolved ? "↩" : "✓"}</span>
      <span onClick={(e) => { e.stopPropagation(); dispatch({ type: "REMOVE_COMMENT", itemId, slideIndex, commentId: comment.id }); }} style={{ cursor: "pointer", fontSize: 10, color: T.red, flexShrink: 0, opacity: hover ? 0.9 : 0.3, transition: "opacity 0.15s" }} title="Delete">✕</span>
    </div>
  );
}

function SlideContent({ slide, index, total, branding, editable, onEdit, presenting, onBlockEdit, blockEditing, fontScale = 1, reviewMode, itemId, dispatch: externalDispatch, displayIndex, displayTotal }) {
  const st = { text: slide.color || T.text, muted: slide.mutedColor || T.textMuted, textDim: T.textDim, accent: slide.accent || T.accent, border: T.border, codeBg: T.codeBg };
  // Hidden elements (CR: hide any element). In presentation they are removed
  // entirely — no render, no layout — so a slide can carry a title that only
  // serves the left TOC. In the editor they stay visible (dimmed) so they can be
  // toggled back on.
  const _vis = (arr) => presenting ? (arr || []).filter((b) => !(b && b.hidden)) : (arr || []);
  const blocks = _vis(slide.blocks);
  const align = slide.align || "left";
  const requestedJustify = slide.verticalAlign || (align === "center" ? "center" : "flex-start");
  // bg/bgGradient are encoder-gated (cssColor/cssGradient) the same way accent
  // and bgImage already are — defense-in-depth so this fetching sink can't be
  // reached even by a future sanitizer gap, not just today's scrubber. (v13.26)
  const bgStyle = {};
  if (slide.bg) { const c = cssColor(slide.bg); if (c) bgStyle.background = c; }
  if (slide.bgImage) { bgStyle.backgroundImage = cssUrl(slide.bgImage); bgStyle.backgroundSize = "cover"; bgStyle.backgroundPosition = "center"; }
  if (slide.bgGradient) { const g = cssGradient(slide.bgGradient); if (g) bgStyle.background = g; }

  const outerRef = useRef(null);
  const innerRef = useRef(null);
  const [fitScale, setFitScale] = useState(1);
  const [fitJustify, setFitJustify] = useState(requestedJustify);
  const [splitImgMaxH, setSplitImgMaxH] = useState(null); // px cap so a side image conforms to the content column's height
  const [hoveredBlock, setHoveredBlock] = useState(null);
  const [itemHovered, setItemHovered] = useState(false); // an inner item's chrome is hovered → hide block toolbar
  const [editingLink, setEditingLink] = useState(null);
  const [editingBlockIdx, setEditingBlockIdx] = useState(null);
  const [blockPrompt, setBlockPrompt] = useState("");
  const [commentingBlockIdx, setCommentingBlockIdx] = useState(null);
  const [commentText, setCommentText] = useState("");

  // Close popup when blockEditing finishes
  const prevEditing = useRef(blockEditing);
  useEffect(() => {
    if (prevEditing.current && !blockEditing) { setEditingBlockIdx(null); setBlockPrompt(""); }
    prevEditing.current = blockEditing;
  }, [blockEditing]);

  const handleBlockChange = useCallback((blockIdx, blockPatch) => {
    if (!onEdit) return;
    const newBlocks = blocks.map((b, i) => i === blockIdx ? { ...b, ...blockPatch } : b);
    onEdit({ blocks: newBlocks });
  }, [onEdit, blocks]);

  const handleBlockRemove = useCallback((blockIdx) => {
    if (!onEdit) return;
    onEdit({ blocks: blocks.filter((_, i) => i !== blockIdx) });
  }, [onEdit, blocks]);

  useLayoutEffect(() => {
    const measure = () => {
      const inner = innerRef.current, outer = outerRef.current;
      if (!inner || !outer) return;
      inner.style.transform = "none";
      inner.style.width = "100%";
      inner.style.height = "auto";
      void inner.scrollHeight;
      const cs = getComputedStyle(outer);
      const availH = outer.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      // In a side-by-side layout the CONTENT column drives the height: the image
      // conforms to it (see splitImgMaxH below) and must never push the whole
      // slide to scale down. So for split we measure the content column alone,
      // not inner.scrollHeight — which would include a tall square/portrait image
      // and shrink the text beside it (the bug this fixes).
      let contentH = 0;
      if (isSplit) {
        const contentEl = inner.querySelector("[data-split-content]");
        contentH = contentEl ? contentEl.scrollHeight : 0;
      }
      const ih = isSplit ? contentH : inner.scrollHeight;
      if (ih > availH && ih > 0) {
        const s = Math.max(availH / ih, 0.35);
        inner.style.transform = `scale(${s})`;
        inner.style.width = `${100 / s}%`;
        inner.style.height = isSplit ? "100%" : "";
        setFitScale(s);
        setFitJustify("flex-start");
      } else {
        inner.style.transform = "none";
        inner.style.width = "100%";
        inner.style.height = isSplit ? "100%" : "";
        setFitScale(1);
        setFitJustify(requestedJustify);
      }
      // Cap a side image to the content's height (never beyond the slide): a
      // taller image shrinks to match the text, a shorter one keeps its size and
      // centers — so the image conforms to the content instead of out-sizing it.
      setSplitImgMaxH(isSplit && contentH > 0 ? Math.min(availH, Math.max(contentH, 140)) : null);
    };
    measure();
    if (document.fonts?.ready) document.fonts.ready.then(() => requestAnimationFrame(measure));
  }, [slide, index, requestedJustify]);

  if (!blocks.length && !(slide.layout === "cols" && (Array.isArray(slide.L) || Array.isArray(slide.R)))) return null;

  // ━━━ Layout: split image blocks for side-by-side layouts ━━━━━━━━━━
  const layout = slide.layout || "stack";
  const isCols = layout === "cols" && (Array.isArray(slide.L) || Array.isArray(slide.R));
  const isSplit = layout === "image-right" || layout === "image-left";
  const colsL = isCols ? _vis(slide.L) : [];
  const colsR = isCols ? _vis(slide.R) : [];

  const rawPad = typeof slide.padding === "number" ? `${slide.padding}px` : slide.padding || "36px 48px";
  const isSoloImage = blocks.length === 1 && blocks[0].type === "image";
  const pad = isSoloImage ? "0px" : String(rawPad).split(/\s+/).map((v) => Math.max(parseInt(v) || 24, 24) + "px").join(" ");

  // Render a single block with all editable chrome (hover, edit popup, link, etc.)
  // ── Per-block editor chrome: hover toolbar, AI/link/comment popups, badges ──
  const renderBlockItem = (b, i) => editable && onEdit ? (
    <div key={i} data-block-type={b.type} style={{ position: "relative", ...(b.link ? { cursor: "pointer" } : {}), ...(b.hidden && !presenting ? { opacity: 0.4 } : {}) }}
      title={b.link ? linkPreview(b.link, b.text || b.value || b.title) : undefined}
      data-pdf-link={b.link || undefined}
      onClick={b.link ? (e) => { e.stopPropagation(); openExternalLink(b.link); } : undefined}
      onMouseEnter={() => setHoveredBlock(i)} onMouseLeave={() => { setHoveredBlock(null); setItemHovered(false); }}>
      {b.hidden && !presenting && <div style={{ position: "absolute", top: -6, left: -6, zIndex: 11, fontSize: 9, fontFamily: FONT.mono, fontWeight: 700, background: st.accent, color: "#fff", borderRadius: 4, padding: "0 4px", lineHeight: "14px", pointerEvents: "none" }} title="Hidden in presentation">🙈 hidden</div>}
      {editingBlockIdx === i && !presenting && <div style={{ position: "absolute", inset: -3, border: `2px solid ${st.accent}`, borderRadius: 6, pointerEvents: "none", zIndex: 10, boxShadow: `0 0 12px ${st.accent}40` }} />}
      {hoveredBlock === i && editingBlockIdx !== i && !presenting && <div style={{ position: "absolute", inset: -2, border: `1.5px dashed ${T.red}60`, borderRadius: 4, pointerEvents: "none", zIndex: 10 }} />}
      {hoveredBlock === i && !itemHovered && !presenting && <div style={{ position: "absolute", top: -8, right: -8, display: "flex", gap: 3, zIndex: 11 }}>
        {onBlockEdit && <button onClick={(e) => { e.stopPropagation(); setEditingBlockIdx(editingBlockIdx === i ? null : i); setBlockPrompt(""); setEditingLink(null); }} style={{ width: 18, height: 18, borderRadius: "50%", background: editingBlockIdx === i ? st.accent : T.bgPanel, border: `1px solid ${editingBlockIdx === i ? st.accent : T.border}`, color: editingBlockIdx === i ? "#fff" : T.textDim, fontSize: 9, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0, boxShadow: "0 2px 6px rgba(0,0,0,0.4)" }} title="Edit this block with AI">🎯</button>}
        <button onClick={(e) => { e.stopPropagation(); setEditingLink(editingLink === i ? null : i); setEditingBlockIdx(null); setCommentingBlockIdx(null); }} style={{ width: 18, height: 18, borderRadius: "50%", background: b.link ? T.accent : T.bgPanel, border: `1px solid ${b.link ? T.accent : T.border}`, color: b.link ? "#fff" : T.textDim, fontSize: 9, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0, boxShadow: "0 2px 6px rgba(0,0,0,0.4)" }} title={b.link ? `Link: ${b.link}` : "Add link"}>🔗</button>
        {externalDispatch && <button onClick={(e) => { e.stopPropagation(); setCommentingBlockIdx(commentingBlockIdx === i ? null : i); setCommentText(""); setEditingBlockIdx(null); setEditingLink(null); }} style={{ width: 18, height: 18, borderRadius: "50%", background: commentingBlockIdx === i ? T.amber : T.bgPanel, border: `1px solid ${commentingBlockIdx === i ? T.amber : T.border}`, color: commentingBlockIdx === i ? "#fff" : T.textDim, fontSize: 9, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0, boxShadow: "0 2px 6px rgba(0,0,0,0.4)" }} title="Add comment">💬</button>}
        <button onClick={(e) => { e.stopPropagation(); handleBlockChange(i, { hidden: b.hidden ? undefined : true }); }} style={{ width: 18, height: 18, borderRadius: "50%", background: b.hidden ? st.accent : T.bgPanel, border: `1px solid ${b.hidden ? st.accent : T.border}`, color: b.hidden ? "#fff" : T.textDim, fontSize: 9, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0, boxShadow: "0 2px 6px rgba(0,0,0,0.4)" }} title={b.hidden ? "Hidden in presentation — click to show" : "Hide this element in presentation (stays in editor)"}>{b.hidden ? "🙈" : "👁"}</button>
        <button onClick={(e) => { e.stopPropagation(); handleBlockRemove(i); }} style={{ width: 18, height: 18, borderRadius: "50%", background: T.red, border: "none", color: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0, boxShadow: "0 2px 6px rgba(0,0,0,0.4)" }}>✕</button>
      </div>}
      {/* Block edit popup */}
      {editingBlockIdx === i && !presenting && <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: -36, right: 0, zIndex: 12, display: "flex", gap: 4, alignItems: "center", background: "rgba(10,15,28,0.95)", border: `1px solid ${st.accent}50`, borderRadius: 8, padding: "4px 8px", boxShadow: `0 4px 16px rgba(0,0,0,0.6), 0 0 0 1px ${st.accent}20`, backdropFilter: "blur(12px)" }}>
        <span style={{ fontSize: 9, color: st.accent, flexShrink: 0 }}>🎯</span>
        <input autoFocus value={blockPrompt} onChange={(e) => setBlockPrompt(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && blockPrompt.trim() && !blockEditing) { e.preventDefault(); onBlockEdit(i, blockPrompt.trim()); } if (e.key === "Escape") { setEditingBlockIdx(null); setBlockPrompt(""); } }}
          disabled={blockEditing}
          placeholder="What to change..."
          style={{ width: 220, padding: "3px 6px", fontSize: 10, fontFamily: FONT.body, background: "rgba(255,255,255,0.06)", color: "#fff", border: `1px solid rgba(255,255,255,0.1)`, borderRadius: 4, outline: "none" }} />
        {blockEditing
          ? <span style={{ fontSize: 11, animation: "spin 1.5s linear infinite", display: "inline-block", flexShrink: 0 }}>✨</span>
          : <button onClick={() => { if (blockPrompt.trim()) onBlockEdit(i, blockPrompt.trim()); }} disabled={!blockPrompt.trim()} style={{ padding: "2px 8px", fontSize: 9, fontFamily: FONT.mono, fontWeight: 700, background: blockPrompt.trim() ? st.accent : "rgba(255,255,255,0.1)", color: "#fff", border: "none", borderRadius: 4, cursor: blockPrompt.trim() ? "pointer" : "default", opacity: blockPrompt.trim() ? 1 : 0.4, flexShrink: 0 }}>Go</button>}
        <button onClick={() => { setEditingBlockIdx(null); setBlockPrompt(""); }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 10, padding: 0, flexShrink: 0 }}>✕</button>
      </div>}
      {editingLink === i && !presenting && <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: -32, right: 0, zIndex: 12, display: "flex", gap: 4, alignItems: "center", background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 6, padding: "3px 6px", boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}>
        <span style={{ fontSize: 9, color: T.textDim }}>🔗</span>
        <input autoFocus defaultValue={b.link || ""} placeholder="https://..." onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { const url = e.target.value.trim(); handleBlockChange(i, { link: url || undefined }); setEditingLink(null); } if (e.key === "Escape") setEditingLink(null); }} onBlur={(e) => { const url = e.target.value.trim(); handleBlockChange(i, { link: url || undefined }); setEditingLink(null); }} style={{ width: 200, padding: "2px 6px", fontSize: 10, fontFamily: FONT.mono, background: T.bg, color: T.text, border: `1px solid ${T.border}`, borderRadius: 4, outline: "none" }} />
        {b.link && <button onClick={() => { handleBlockChange(i, { link: undefined }); setEditingLink(null); }} style={{ background: "none", border: "none", color: T.red, fontSize: 10, cursor: "pointer", padding: 0 }}>✕</button>}
      </div>}
      {/* Block comment popup */}
      {commentingBlockIdx === i && !presenting && externalDispatch && <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: -36, right: 0, zIndex: 12, display: "flex", gap: 4, alignItems: "center", background: "rgba(10,15,28,0.95)", border: `1px solid ${T.amber}50`, borderRadius: 8, padding: "4px 8px", boxShadow: `0 4px 16px rgba(0,0,0,0.6), 0 0 0 1px ${T.amber}20`, backdropFilter: "blur(12px)" }}>
        <span style={{ fontSize: 9, flexShrink: 0 }}>💬</span>
        <input autoFocus value={commentText} onChange={(e) => setCommentText(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && commentText.trim()) { e.preventDefault(); externalDispatch({ type: "ADD_COMMENT", itemId, slideIndex: index, text: commentText.trim(), blockIndex: i }); setCommentText(""); setCommentingBlockIdx(null); } if (e.key === "Escape") { setCommentingBlockIdx(null); setCommentText(""); } }}
          placeholder="Add a comment..."
          style={{ width: 220, padding: "3px 6px", fontSize: 10, fontFamily: FONT.body, background: "rgba(255,255,255,0.06)", color: "#fff", border: `1px solid rgba(255,255,255,0.1)`, borderRadius: 4, outline: "none" }} />
        <button onClick={() => { if (commentText.trim()) { externalDispatch({ type: "ADD_COMMENT", itemId, slideIndex: index, text: commentText.trim(), blockIndex: i }); setCommentText(""); setCommentingBlockIdx(null); } }} disabled={!commentText.trim()} style={{ padding: "2px 8px", fontSize: 9, fontFamily: FONT.mono, fontWeight: 700, background: commentText.trim() ? T.amber : "rgba(255,255,255,0.1)", color: "#fff", border: "none", borderRadius: 4, cursor: commentText.trim() ? "pointer" : "default", opacity: commentText.trim() ? 1 : 0.4, flexShrink: 0 }}>Add</button>
        <button onClick={() => { setCommentingBlockIdx(null); setCommentText(""); }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 10, padding: 0, flexShrink: 0 }}>✕</button>
      </div>}
      {/* Comment count badge (edit mode, not review) */}
      {!reviewMode && !presenting && hoveredBlock !== i && externalDispatch && (() => { const cc = slideComments.filter((c) => c.blockIndex === i && c.status === "open"); return cc.length > 0 ? <div style={{ position: "absolute", top: -2, left: -2, minWidth: 14, height: 14, borderRadius: 7, background: T.amber, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, fontFamily: FONT.mono, fontWeight: 700, color: "#fff", padding: "0 3px", zIndex: 5, boxShadow: "0 2px 4px rgba(0,0,0,0.3)" }} title={`${cc.length} comment${cc.length > 1 ? "s" : ""}`}>💬{cc.length > 1 ? cc.length : ""}</div> : null; })()}
      {b.link && hoveredBlock !== i && !presenting && <div onClick={(e) => { e.stopPropagation(); openExternalLink(b.link); }} style={{ position: "absolute", top: -2, right: -2, width: 14, height: 14, borderRadius: "50%", background: T.accent + "80", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, zIndex: 5, cursor: "pointer" }} title={b.link}>🔗</div>}
      {b.link && presenting && <div style={{ position: "absolute", top: -2, right: -2, padding: "2px 5px", borderRadius: 4, background: T.accent, fontSize: 9, color: "#fff", zIndex: 12, pointerEvents: "none", opacity: hoveredBlock === i ? 1 : 0.3, transition: "opacity 0.2s", boxShadow: "0 2px 6px rgba(0,0,0,0.4)" }}>🔗</div>}
      <RenderBlock block={b} staggerIdx={i + 1} slideTheme={st} editable={b.link ? false : editable} slideAlign={align} fontScale={fontScale} presenting={presenting}
        onChange={onEdit ? (patch) => handleBlockChange(i, patch) : undefined} />
    </div>
  ) : (
    <div key={i} data-block-type={b.type} title={b.link ? linkPreview(b.link, b.text || b.value || b.title) : undefined} data-pdf-link={b.link || undefined} onClick={b.link ? (e) => { e.stopPropagation(); openExternalLink(b.link); } : undefined} style={b.link ? { cursor: "pointer" } : undefined}>
      <RenderBlock block={b} staggerIdx={i + 1} slideTheme={st} editable={b.link ? false : editable} slideAlign={align} fontScale={fontScale} presenting={presenting}
        onChange={onEdit ? (patch) => handleBlockChange(i, patch) : undefined} />
    </div>
  );

  // Slide comments — always computed for badges, inline cards only in review mode
  const slideComments = slide?.comments ? slide.comments.filter(Boolean) : [];
  const renderInlineComments = (blockIdx) => {
    if (!reviewMode || !externalDispatch || slideComments.length === 0) return null;
    const matching = slideComments.filter((c) => c.blockIndex === blockIdx);
    if (matching.length === 0) return null;
    return matching.map((c) => <InlineCommentCard key={c.id} comment={c} itemId={itemId} slideIndex={index} dispatch={externalDispatch} />);
  };

  // Render a block followed by its inline comments
  const renderBlockWithComments = (b, i) => {
    const block = renderBlockItem(b, i);
    const comments = renderInlineComments(i);
    if (!comments) return [block];
    return [block, ...comments];
  };

  // Grid a run of >=2 adjacent image blocks (given by their block indices) into a
  // balanced CSS grid. Columns are count-driven via gridColsFor(n, region) unless
  // the author pins slide.imageCols. Each cell fills its track (objectFit:contain via
  // the image block's _gridCell flag). An incomplete last row is centered by giving
  // its first cell a leading column offset (grid is 2x-subdivided so cells span 2).
  const renderImageGrid = (idxs, region) => {
    const runLen = idxs.length;
    // Belt-and-braces: ingress already clamps imageCols to an integer 1..6
    // (SLIDE_NUMERIC_BOUNDS), but this value drives a CSS grid track count, so
    // re-clamp at the sink for any slide object that reached here unsanitized.
    const cols = slide.imageCols ? Math.min(6, Math.max(1, slide.imageCols | 0)) : gridColsFor(runLen, region);
    const rows = Math.ceil(runLen / cols);
    const lastRowCount = runLen - (rows - 1) * cols;
    const incomplete = lastRowCount < cols;
    const gap = slide.gap || 12;
    return (
      <div key={`__imgrid-${idxs[0]}`} data-testid="image-grid" data-image-grid={region} data-image-count={runLen}
        style={{ display: "grid", gridTemplateColumns: `repeat(${cols * 2}, minmax(0, 1fr))`, gridAutoRows: "minmax(0, 1fr)", gap, flex: 1, minHeight: 0, minWidth: 0, width: "100%", alignItems: "stretch" }}>
        {idxs.map((bi, k) => {
          const firstOfLastRow = k === (rows - 1) * cols;
          const gridColumn = (incomplete && firstOfLastRow)
            ? `${cols - lastRowCount + 1} / span 2`
            : "span 2";
          const rendered = renderBlockWithComments({ ...blocks[bi], _gridCell: true }, bi);
          const [blockEl, ...rest] = rendered;
          // Make the block wrapper fill its cell height so the image (height:100%)
          // and objectFit:contain letterbox uniformly across mixed aspect ratios.
          const filled = React.cloneElement(blockEl, {
            style: { ...(blockEl.props.style || {}), display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0, width: "100%" },
          });
          return (
            <div key={`__imgcell-${bi}`} data-testid="image-grid-cell" style={{ gridColumn, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
              {filled}{rest}
            </div>
          );
        })}
      </div>
    );
  };

  // Walk the stacked blocks and replace each maximal run of >=2 adjacent image
  // blocks with a balanced image grid (full region). Single images render as before.
  const renderStackWithImageGrids = () => {
    const out = [];
    let i = 0;
    while (i < blocks.length) {
      if (blocks[i].type === "image") {
        let j = i;
        while (j < blocks.length && blocks[j].type === "image") j++;
        if (j - i >= 2) {
          const idxs = [];
          for (let k = i; k < j; k++) idxs.push(k);
          out.push(renderImageGrid(idxs, "full"));
          i = j;
          continue;
        }
      }
      out.push(...renderBlockWithComments(blocks[i], i));
      i++;
    }
    return out;
  };

  // Build content: split layout or standard stacked layout
  const renderBlocks = () => {
    if (isCols) {
      const headerBlocks = blocks.flatMap((b, i) => renderBlockWithComments(b, i));
      const colsRow = (
        <div key="__cols-row" style={{ display: "flex", flexDirection: "row", gap: slide.splitGap || 32, flex: 1, minHeight: 0 }}>
          {/* Outer stays overflow:"visible" so a column-edge block's hover toolbar
              (which pokes -8/-10px above/right of the block) isn't clipped. The
              inner wrapper keeps the original vertical crop for tall content, but
              its clip box is nudged up+right by COL_TOOLBAR_PAD so that escape
              room lands inside it while its content area still lines up exactly
              where it used to (padding cancels the top/right position shift). */}
          <div key="__cols-L" style={{ flex: slide.contentFlex || 1, minWidth: 0, overflow: "visible" }}>
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-start", gap: slide.gap || 12, minWidth: 0, overflow: "hidden", position: "relative", top: -COL_TOOLBAR_PAD, width: `calc(100% + ${COL_TOOLBAR_PAD}px)`, height: `calc(100% + ${COL_TOOLBAR_PAD}px)`, padding: `${COL_TOOLBAR_PAD}px ${COL_TOOLBAR_PAD}px 0 0`, boxSizing: "border-box" }}>
              {colsL.flatMap((b, i) => renderBlockWithComments(b, i + blocks.length))}
            </div>
          </div>
          <div key="__cols-R" style={{ flex: slide.imageFlex || 1, minWidth: 0, overflow: "visible" }}>
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-start", gap: slide.gap || 12, minWidth: 0, overflow: "hidden", position: "relative", top: -COL_TOOLBAR_PAD, width: `calc(100% + ${COL_TOOLBAR_PAD}px)`, height: `calc(100% + ${COL_TOOLBAR_PAD}px)`, padding: `${COL_TOOLBAR_PAD}px ${COL_TOOLBAR_PAD}px 0 0`, boxSizing: "border-box" }}>
              {colsR.flatMap((b, i) => renderBlockWithComments(b, i + blocks.length + colsL.length))}
            </div>
          </div>
        </div>
      );
      return [...headerBlocks, colsRow];
    }
    if (isSplit) {
      const contentIdxs = [], imageIdxs = [];
      blocks.forEach((b, i) => { (b.type === "image" ? imageIdxs : contentIdxs).push(i); });
      // Fallback: if no images found, render as stack
      if (imageIdxs.length === 0) return blocks.flatMap((b, i) => renderBlockWithComments(b, i));
      const imageOnRight = layout === "image-right";
      // Both columns share one vertical alignment so their content lines up.
      // Default (no explicit verticalAlign): center each column when everything
      // fits (fitScale === 1), so a short content block sits at the side image's
      // vertical middle instead of crowding the top and leaving a gap below — a
      // square/tall image otherwise dominates while top-aligned content looks
      // shrunken. When content overflows (fitScale < 1) we keep flex-start so the
      // scaled column reads top-down; an explicit verticalAlign is always honored.
      const splitJustify = slide.verticalAlign ? fitJustify : (fitScale < 1 ? "flex-start" : "center");
      const contentCol = <div key="__content" data-split-content style={{ flex: slide.contentFlex || 1, display: "flex", flexDirection: "column", justifyContent: splitJustify, gap: slide.gap || 12, minWidth: 0 }}>{contentIdxs.flatMap((i) => renderBlockWithComments(blocks[i], i))}</div>;
      // Apply the measured height cap to each image (unless the author pinned its
      // own maxHeight). A bare number becomes px on the <img>, so it caps the
      // image directly — independent of the wrapper/zoom chrome between here and it.
      // >=2 images beside content → grid them (half region) so they fill the column
      // balanced instead of stacking vertically. Single image keeps the height-capped
      // column so a lone side image conforms to the content column's height.
      const imageCol = imageIdxs.length >= 2
        ? <div key="__images" style={{ flex: slide.imageFlex || 1, display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0, height: "100%" }}>{renderImageGrid(imageIdxs, "half")}</div>
        : <div key="__images" style={{ flex: slide.imageFlex || 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: splitJustify, gap: slide.gap || 12, minWidth: 0, height: "100%" }}>{imageIdxs.flatMap((i) => renderBlockWithComments(splitImgMaxH != null && blocks[i].maxHeight == null ? { ...blocks[i], maxHeight: splitImgMaxH } : blocks[i], i))}</div>;
      return imageOnRight ? [contentCol, imageCol] : [imageCol, contentCol];
    }
    if (isSoloImage) return renderBlockWithComments({ ...blocks[0], _solo: true }, 0);
    return renderStackWithImageGrids();
  };

  return (
    <SlideErrorBoundary>
      <div ref={outerRef} style={{ height: "100%", padding: pad, position: "relative", overflow: "visible", boxSizing: "border-box", display: "flex", flexDirection: "column", ...bgStyle }}>
        <div ref={innerRef} style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: isSplit ? "row" : "column", justifyContent: isSplit ? "stretch" : fitJustify, alignItems: isSplit ? "stretch" : (align === "center" ? "center" : "stretch"), textAlign: align, gap: isSplit ? (slide.splitGap || 32) : (slide.gap || 12), transform: fitScale < 1 ? `scale(${fitScale})` : "none", transformOrigin: "top left", width: fitScale < 1 ? `${100 / fitScale}%` : "100%", height: fitScale < 1 ? `${100 / fitScale}%` : "100%", maxWidth: fitScale < 1 ? `${100 / fitScale}%` : "100%", flex: fitScale < 1 ? undefined : 1, boxSizing: "border-box" }}>
          <ItemHoverContext.Provider value={setItemHovered}>
            {renderBlocks()}
          </ItemHoverContext.Provider>
        </div>
        {/* Slide-level comments (no blockIndex) — top-right */}
        {reviewMode && externalDispatch && (() => {
          const unanchored = slideComments.filter((c) => c.blockIndex == null);
          if (unanchored.length === 0) return null;
          return <div style={{ position: "absolute", top: 8, right: 8, zIndex: 5, display: "flex", flexDirection: "column", gap: 2, maxWidth: "45%" }}>
            {unanchored.map((c) => <InlineCommentCard key={c.id} comment={c} itemId={itemId} slideIndex={index} dispatch={externalDispatch} />)}
          </div>;
        })()}
        {branding?.enabled
          ? <BrandingOverlay branding={branding} index={index} total={total} displayIndex={displayIndex} displayTotal={displayTotal} slideBg={slide.bg} />
          : (() => { const di = displayIndex != null ? displayIndex : index; const dt = displayTotal != null ? displayTotal : total; return <div data-no-pdf="" style={{ position: "absolute", bottom: 16, right: 16, fontFamily: FONT.mono, fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", color: "#e2e8f0", background: "rgba(0,0,0,0.4)", padding: "3px 9px", borderRadius: 20, opacity: 0.85 }}>{String(di + 1).padStart(2, "0")} / {String(dt).padStart(2, "0")}</div>; })()
        }
      </div>
    </SlideErrorBoundary>
  );
}


