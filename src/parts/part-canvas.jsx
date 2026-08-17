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
  const layout = slide.layout || "stack";
  const isCols = layout === "cols" && (Array.isArray(slide.L) || Array.isArray(slide.R));
  const isSplit = layout === "image-right" || layout === "image-left";
  const colsL = isCols ? _vis(slide.L) : [];
  const colsR = isCols ? _vis(slide.R) : [];
  const isMediaOnlyColumn = (column) =>
    column.some((b) => b && b.type === "image") &&
    column.every((b) => b && (b.type === "image" || b.type === "spacer" || b.type === "divider"));
  const colsLMediaOnly = isMediaOnlyColumn(colsL);
  const colsRMediaOnly = isMediaOnlyColumn(colsR);
  const hasMediaOnlyColumn = colsLMediaOnly || colsRMediaOnly;
  const hasDirectColumnImage = colsL.some((b) => b?.type === "image") || colsR.some((b) => b?.type === "image");
  // Deck values must not reach CSS directly. Unknown values use the normal
  // layout default instead of becoming an invalid justifyContent value.
  const verticalAlignToJustify = (value) => {
    if (value === "top") return "flex-start";
    // Safe alignment keeps the requested position while content fits. If it
    // overflows, the browser starts at the top instead of clipping the top.
    if (value === "center") return "safe center";
    if (value === "bottom") return "safe flex-end";
    return null;
  };
  const explicitJustify = verticalAlignToJustify(slide.verticalAlign);
  const requestedJustify = explicitJustify || (align === "center" ? "center" : "flex-start");
  // bg/bgGradient are encoder-gated (cssColor/cssGradient) the same way accent
  // and bgImage already are — defense-in-depth so this fetching sink can't be
  // reached even by a future sanitizer gap, not just today's scrubber. (v13.26)
  const bgStyle = {};
  if (slide.bg) { const c = cssColor(slide.bg); if (c) bgStyle.background = c; }
  if (slide.bgImage) { bgStyle.backgroundImage = cssUrl(slide.bgImage); bgStyle.backgroundSize = "cover"; bgStyle.backgroundPosition = "center"; }
  if (slide.bgGradient) { const g = cssGradient(slide.bgGradient); if (g) bgStyle.background = g; }

  const outerRef = useRef(null);
  const innerRef = useRef(null);
  const layoutContentKey = JSON.stringify({
    index, presenting, reviewMode, fontScale, layout, align,
    verticalAlign: slide.verticalAlign ?? null,
    padding: slide.padding ?? null,
    gap: slide.gap ?? null,
    splitGap: slide.splitGap ?? null,
    contentFlex: slide.contentFlex ?? null,
    imageFlex: slide.imageFlex ?? null,
    imageCols: slide.imageCols ?? null,
    blocks,
    L: colsL,
    R: colsR,
    comments: reviewMode ? (slide.comments || null) : null,
  });
  const layoutGenerationState = useRef({ key: null, value: 0 });
  if (layoutGenerationState.current.key !== layoutContentKey) {
    layoutGenerationState.current = {
      key: layoutContentKey,
      value: layoutGenerationState.current.value + 1,
    };
  }
  const layoutGeneration = layoutGenerationState.current.value;
  const currentLayoutGeneration = useRef(layoutGeneration);
  currentLayoutGeneration.current = layoutGeneration;
  const [fitScale, setFitScale] = useState(1);
  const [fitJustify, setFitJustify] = useState(requestedJustify);
  const [splitImgMaxH, setSplitImgMaxH] = useState(null); // px cap so a side image conforms to the content column's height
  const [colsImageFit, setColsImageFit] = useState(null);
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
    const SCALE_FLOOR = 0.35;
    const MIN_IMAGE_VISUAL_H = 24;
    const MIN_CONTAINED_VISUAL_H = 1;
    const EDGE_ALLOWANCE_VISUAL = 4;
    const generation = layoutGeneration;
    let cancelled = false, scheduledFrame = 0;
    const pendingReasons = new Set();
    const isCurrent = () => !cancelled && currentLayoutGeneration.current === generation;

    const applyGeometry = (inner, scale) => {
      const scaled = scale < 0.9995;
      inner.style.transform = scaled ? `scale(${scale})` : "none";
      inner.style.width = scaled ? `${100 / scale}%` : "100%";
      inner.style.maxWidth = scaled ? `${100 / scale}%` : "100%";
      inner.style.height = scaled && (isSplit || isCols)
        ? `${100 / scale}%`
        : (isSplit || (isCols && hasDirectColumnImage) ? "100%" : "auto");
      inner.style.flexShrink = scaled && (isSplit || isCols) ? "0" : "";
      void inner.offsetHeight;
    };

    const measure = () => {
      if (!isCurrent()) return;
      const inner = innerRef.current, outer = outerRef.current;
      if (!inner || !outer) return;
      const outerStyle = getComputedStyle(outer);
      const availH = outer.clientHeight
        - parseFloat(outerStyle.paddingTop)
        - parseFloat(outerStyle.paddingBottom);

      const columnPairs = [["left", colsL], ["right", colsR]];
      const resetColumnImages = () => {
        for (const [side, column] of columnPairs) {
          const columnEl = inner.querySelector(`[data-cols-side="${side}"]`);
          if (!columnEl) continue;
          for (let blockIndex = 0; blockIndex < column.length; blockIndex++) {
            const block = column[blockIndex];
            if (block?.type !== "image") continue;
            const child = columnEl.querySelector(`:scope > [data-column-block-index="${blockIndex}"]`);
            const img = child?.querySelector("img");
            if (img) img.style.maxHeight = block.maxHeight != null ? block.maxHeight : "100%";
          }
        }
      };

      const measureColumn = (side, column, scale) => {
        const columnEl = inner.querySelector(`[data-cols-side="${side}"]`);
        if (!columnEl) return null;
        const style = getComputedStyle(columnEl);
        const children = Array.from(columnEl.children);
        const gap = parseFloat(style.rowGap) || 0;
        const allowance = EDGE_ALLOWANCE_VISUAL / scale;
        const availableHeight = Math.max(0, columnEl.clientHeight
          - parseFloat(style.paddingTop)
          - parseFloat(style.paddingBottom)
          - allowance);
        const childByIndex = new Map(children
          .filter((child) => child.dataset.columnBlockIndex != null)
          .map((child) => [Number(child.dataset.columnBlockIndex), child]));
        const entries = [];
        const imageByChild = new Map();
        for (let blockIndex = 0; blockIndex < column.length; blockIndex++) {
          const block = column[blockIndex];
          if (block?.type !== "image") continue;
          const child = childByIndex.get(blockIndex);
          const img = child?.querySelector("img") || null;
          const measuredHeight = img ? img.getBoundingClientRect().height / scale : 0;
          const loaded = !!(img?.complete && img.naturalWidth > 0 && img.naturalHeight > 0);
          const pending = !!(img && !img.complete);
          const explicitZero = block.maxHeight === 0
            || (typeof block.maxHeight === "string" && /^0(?:\.0+)?(?:px|%)?$/.test(block.maxHeight.trim()));
          const needsCap = (loaded || pending) && !explicitZero;
          // An image that is still loading reserves one useful slot. A completed
          // 0x0 or failed image reserves none, but its block index stays present.
          const demand = measuredHeight > 0.01
            ? measuredHeight
            : (needsCap ? MIN_IMAGE_VISUAL_H / scale : 0);
          const entry = { blockIndex, child, img, demand, needsCap };
          entries.push(entry);
          if (child && img) imageByChild.set(child, entry);
        }
        const fixedHeight = children.reduce((sum, child) => {
          const entry = imageByChild.get(child);
          const childHeight = child.getBoundingClientRect().height / scale;
          const imageHeight = entry?.img ? entry.img.getBoundingClientRect().height / scale : 0;
          return sum + Math.max(0, childHeight - imageHeight);
        }, 0) + gap * Math.max(0, children.length - 1);
        const renderedEntries = entries.filter((entry) => entry.needsCap);
        const imageDemand = renderedEntries.reduce((sum, entry) => sum + entry.demand, 0);
        const minimumDemand = renderedEntries.reduce(
          (sum, entry) => sum + Math.min(entry.demand, MIN_IMAGE_VISUAL_H / scale), 0
        );
        const imageBudget = availableHeight - fixedHeight;
        return {
          side, column, columnEl, style, children, entries, fixedHeight, availableHeight, scale,
          imageBudget, fullDemand: fixedHeight + imageDemand,
          minimumDemand: fixedHeight + minimumDemand,
          canFitUseful: renderedEntries.length === 0 || imageBudget >= minimumDemand - fixedHeight - 0.5,
        };
      };

      const evaluateColumns = (scale) => {
        applyGeometry(inner, scale);
        resetColumnImages();
        void inner.offsetHeight;
        const models = columnPairs.map(([side, column]) => measureColumn(side, column, scale)).filter(Boolean);
        const innerOverflow = Math.max(0, inner.scrollHeight - inner.clientHeight);
        const feasible = innerOverflow <= EDGE_ALLOWANCE_VISUAL / scale
          && models.every((model) => model.minimumDemand <= model.availableHeight + 0.5);
        return { scale, models, innerOverflow, feasible };
      };

      const allocateCaps = (model, budget = model.imageBudget) => {
        const caps = new Array(model.column.length).fill(null);
        let remaining = Math.max(0, budget);
        let open = model.entries
          .filter((entry) => entry.needsCap)
          .map((entry) => ({
            ...entry,
            floor: Math.min(entry.demand, MIN_CONTAINED_VISUAL_H / model.scale),
          }));
        while (open.length) {
          const share = remaining / open.length;
          const satisfied = open.filter((entry) => entry.demand <= share);
          if (!satisfied.length) {
            // At the scale floor, fixed content can leave no image budget. Keep
            // every loaded image finite instead of restoring its uncapped 100%.
            open.forEach((entry) => {
              caps[entry.blockIndex] = Math.max(entry.floor, Math.min(entry.demand, share));
            });
            break;
          }
          satisfied.forEach((entry) => {
            caps[entry.blockIndex] = entry.demand;
            remaining -= entry.demand;
          });
          open = open.filter((entry) => entry.demand > share);
        }
        return caps;
      };

      const applyCaps = (model, caps) => {
        for (const entry of model.entries) {
          const cap = caps[entry.blockIndex];
          if (entry.img && Number.isFinite(cap)) entry.img.style.maxHeight = `${cap}px`;
        }
      };

      if (isCols && hasDirectColumnImage) {
        const natural = evaluateColumns(1);
        const fullOverflow = Math.max(
          natural.innerOverflow,
          ...natural.models.map((model) => Math.max(0, model.fullDemand - (model.imageBudget + model.fixedHeight))),
          0,
        );
        const naturalScale = Math.max(SCALE_FLOOR, Math.min(1, availH / (availH + fullOverflow)));
        let finalScale = 1;
        if (!natural.feasible) {
          const floor = evaluateColumns(SCALE_FLOOR);
          if (!floor.feasible) {
            finalScale = SCALE_FLOOR;
          } else {
            let low = SCALE_FLOOR, high = 1;
            if (naturalScale > SCALE_FLOOR + 0.001) {
              const seeded = evaluateColumns(naturalScale);
              if (seeded.feasible) low = naturalScale; else high = naturalScale;
            }
            for (let pass = 0; pass < 6; pass++) {
              const probe = (low + high) / 2;
              if (evaluateColumns(probe).feasible) low = probe; else high = probe;
            }
            finalScale = low;
          }
        }

        let final = evaluateColumns(finalScale);
        const capsBySide = { left: new Array(colsL.length).fill(null), right: new Array(colsR.length).fill(null) };
        const budgetsBySide = {};
        for (const model of final.models) {
          budgetsBySide[model.side] = model.imageBudget;
          capsBySide[model.side] = allocateCaps(model, budgetsBySide[model.side]);
          applyCaps(model, capsBySide[model.side]);
        }
        void inner.offsetHeight;

        // The reserved allowance covers normal rounding. This one bounded
        // correction also checks centered and bottom-aligned content at both edges.
        for (let pass = 0; pass < 2; pass++) {
          let corrected = false;
          for (const model of final.models) {
            const caps = capsBySide[model.side];
            if (!caps.some((cap) => Number.isFinite(cap))) continue;
            const columnRect = model.columnEl.getBoundingClientRect();
            const visible = model.children
              .map((child) => child.getBoundingClientRect())
              .filter((rect) => rect.height > 0.25);
            if (!visible.length) continue;
            const topEdge = columnRect.top + parseFloat(model.style.paddingTop) * finalScale;
            const bottomEdge = columnRect.bottom - parseFloat(model.style.paddingBottom) * finalScale;
            const topOverflow = Math.max(0, topEdge - Math.min(...visible.map((rect) => rect.top)));
            const bottomOverflow = Math.max(0, Math.max(...visible.map((rect) => rect.bottom)) - bottomEdge);
            const overflow = topOverflow + bottomOverflow;
            if (overflow > 0.5) {
              corrected = true;
              budgetsBySide[model.side] = Math.max(
                0,
                budgetsBySide[model.side] - overflow / finalScale - 1 / finalScale
              );
              capsBySide[model.side] = allocateCaps(model, budgetsBySide[model.side]);
              applyCaps(model, capsBySide[model.side]);
            }
          }
          if (!corrected) break;
          void inner.offsetHeight;
        }
        void inner.offsetHeight;
        setColsImageFit({ generation, left: capsBySide.left, right: capsBySide.right });
        setSplitImgMaxH(null);
        setFitScale(finalScale);
        setFitJustify(finalScale < 0.9995 ? (explicitJustify || "flex-start") : requestedJustify);
        return;
      }

      setColsImageFit(null);
      applyGeometry(inner, 1);
      // In a side-by-side layout the content column drives the scale. The image
      // cap is computed only after the reciprocal final height is active.
      const contentEl = isSplit ? inner.querySelector("[data-split-content]") : null;
      const contentH = contentEl ? contentEl.scrollHeight : 0;
      const ih = isSplit ? contentH : inner.scrollHeight;
      const finalScale = ih > availH && ih > 0 ? Math.max(availH / ih, SCALE_FLOOR) : 1;
      applyGeometry(inner, finalScale);
      let splitCap = null;
      if (isSplit && contentEl) {
        const imageCol = inner.querySelector("[data-split-image]");
        const finalContentH = contentEl.scrollHeight;
        const finalImageH = Math.max(0, (imageCol?.clientHeight || 0) - (EDGE_ALLOWANCE_VISUAL * 2) / finalScale);
        if (finalContentH > 0 && finalImageH > 0) {
          splitCap = Math.min(finalImageH, Math.max(finalContentH, 140 / finalScale));
        }
      }
      setSplitImgMaxH(splitCap);
      setFitScale(finalScale);
      setFitJustify(finalScale < 0.9995 ? (explicitJustify || "flex-start") : requestedJustify);
    };

    const scheduleMeasure = (reason) => {
      if (!isCurrent()) return;
      pendingReasons.add(reason);
      if (scheduledFrame) return;
      scheduledFrame = requestAnimationFrame(() => {
        scheduledFrame = 0;
        if (!isCurrent()) return;
        pendingReasons.clear();
        measure();
      });
    };

    measure();
    scheduleMeasure("mount");
    const imageNodes = Array.from(innerRef.current?.querySelectorAll("img") || []);
    const settledImages = new WeakSet();
    const handleImageSettled = (event) => {
      const img = event.currentTarget;
      if (settledImages.has(img)) return;
      settledImages.add(img);
      scheduleMeasure("image");
    };
    imageNodes.forEach((img) => {
      img.addEventListener("load", handleImageSettled);
      img.addEventListener("error", handleImageSettled);
    });
    if (document.fonts?.ready) {
      Promise.resolve(document.fonts.ready).then(
        () => scheduleMeasure("fonts"),
        () => scheduleMeasure("fonts")
      );
    }
    let lastOuterSize = `${outerRef.current?.clientWidth || 0}x${outerRef.current?.clientHeight || 0}`;
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
      const nextSize = `${outerRef.current?.clientWidth || 0}x${outerRef.current?.clientHeight || 0}`;
      if (nextSize === lastOuterSize) return;
      lastOuterSize = nextSize;
      scheduleMeasure("resize");
    }) : null;
    if (resizeObserver && outerRef.current) resizeObserver.observe(outerRef.current);
    return () => {
      cancelled = true;
      if (scheduledFrame) cancelAnimationFrame(scheduledFrame);
      resizeObserver?.disconnect();
      imageNodes.forEach((img) => {
        img.removeEventListener("load", handleImageSettled);
        img.removeEventListener("error", handleImageSettled);
      });
    };
  }, [layoutGeneration, requestedJustify]);

  if (!blocks.length && !(slide.layout === "cols" && (Array.isArray(slide.L) || Array.isArray(slide.R)))) return null;

  // ━━━ Layout: split image blocks for side-by-side layouts ━━━━━━━━━━
  const activeColsImageFit = colsImageFit?.generation === layoutGeneration ? colsImageFit : null;

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
  const renderColumnBlocks = (column, offset, caps) => {
    return column.flatMap((b, i) => {
      const cap = b?.type === "image" ? caps?.[i] : null;
      const fitted = Number.isFinite(cap) ? { ...b, maxHeight: cap, fit: "contain" } : b;
      const [block, ...comments] = renderBlockWithComments(fitted, i + offset);
      return [React.cloneElement(block, { "data-column-block-index": i }), ...comments];
    });
  };

  // Grid a run of >=2 adjacent image blocks (given by their block indices) into a
  // balanced CSS grid. Columns are count-driven via gridColsFor(n, region) unless
  // the author pins slide.imageCols. Each cell fills its track (objectFit:contain via
  // the image block's _gridCell flag). An incomplete last row is centered by giving
  // its first cell a leading column offset (grid is 2x-subdivided so cells span 2).
  const renderImageGrid = (idxs, region, alignWithinColumn = false) => {
    const runLen = idxs.length;
    // Belt-and-braces: ingress already clamps imageCols to an integer 1..6
    // (SLIDE_NUMERIC_BOUNDS), but this value drives a CSS grid track count, so
    // re-clamp at the sink for any slide object that reached here unsanitized.
    const cols = slide.imageCols ? Math.min(6, Math.max(1, slide.imageCols | 0)) : gridColsFor(runLen, region);
    const rows = Math.ceil(runLen / cols);
    const lastRowCount = runLen - (rows - 1) * cols;
    const incomplete = lastRowCount < cols;
    const gap = slide.gap || 12;
    // Grid images are absolute-fill cells, so they have no intrinsic grid
    // height. Use one balanced 140px row per grid row only when the author
    // requests alignment. The default path still fills all available height.
    const gridHeight = alignWithinColumn ? Math.min(splitImgMaxH || rows * 140, rows * 140) : null;
    return (
      <div key={`__imgrid-${idxs[0]}`} data-testid="image-grid" data-image-grid={region} data-image-count={runLen}
        style={{ display: "grid", gridTemplateColumns: `repeat(${cols * 2}, minmax(0, 1fr))`, gridAutoRows: "minmax(0, 1fr)", gap, flex: gridHeight == null ? 1 : "0 0 auto", height: gridHeight == null ? undefined : gridHeight, maxHeight: "100%", minHeight: 0, minWidth: 0, width: "100%", alignItems: "stretch" }}>
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
      // Balance fitting sides around media. If the generic side drives an
      // auto-fit, keep that side top-safe while the fitted media stays centered.
      const colsLJustify = explicitJustify || (hasMediaOnlyColumn && (fitScale >= 1 || colsLMediaOnly) ? "safe center" : "flex-start");
      const colsRJustify = explicitJustify || (hasMediaOnlyColumn && (fitScale >= 1 || colsRMediaOnly) ? "safe center" : "flex-start");
      const colsRow = (
        <div key="__cols-row" style={{ display: "flex", flexDirection: "row", gap: slide.splitGap || 32, flex: 1, minHeight: 0 }}>
          {/* Outer stays overflow:"visible" so a column-edge block's hover toolbar
              (which pokes -8/-10px above/right of the block) isn't clipped. The
              inner wrapper keeps the original vertical crop for tall content, but
              its clip box is nudged up+right by COL_TOOLBAR_PAD so that escape
              room lands inside it while its content area still lines up exactly
              where it used to (padding cancels the top/right position shift). */}
          <div key="__cols-L" style={{ flex: slide.contentFlex || 1, minWidth: 0, overflow: "visible" }}>
            <div data-cols-side="left" style={{ display: "flex", flexDirection: "column", justifyContent: colsLJustify, gap: slide.gap || 12, minWidth: 0, overflow: "hidden", position: "relative", top: -COL_TOOLBAR_PAD, width: `calc(100% + ${COL_TOOLBAR_PAD}px)`, height: `calc(100% + ${COL_TOOLBAR_PAD}px)`, padding: `${COL_TOOLBAR_PAD}px ${COL_TOOLBAR_PAD}px 0 0`, boxSizing: "border-box" }}>
              {renderColumnBlocks(colsL, blocks.length, activeColsImageFit?.left)}
            </div>
          </div>
          <div key="__cols-R" style={{ flex: slide.imageFlex || 1, minWidth: 0, overflow: "visible" }}>
            <div data-cols-side="right" style={{ display: "flex", flexDirection: "column", justifyContent: colsRJustify, gap: slide.gap || 12, minWidth: 0, overflow: "hidden", position: "relative", top: -COL_TOOLBAR_PAD, width: `calc(100% + ${COL_TOOLBAR_PAD}px)`, height: `calc(100% + ${COL_TOOLBAR_PAD}px)`, padding: `${COL_TOOLBAR_PAD}px ${COL_TOOLBAR_PAD}px 0 0`, boxSizing: "border-box" }}>
              {renderColumnBlocks(colsR, blocks.length + colsL.length, activeColsImageFit?.right)}
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
      // Safe alignment balances fitting content but falls back to the top when
      // it overflows. The media side stays centered unless the author sets an
      // explicit vertical alignment.
      const splitContentJustify = explicitJustify || "safe center";
      const splitImageJustify = explicitJustify || "center";
      // A full-height grid leaves no free space for justifyContent. Keep the
      // default fill behavior, but give an explicitly aligned grid a measured
      // height so top, center, and bottom produce distinct positions.
      const contentCol = <div key="__content" data-split-content style={{ flex: slide.contentFlex || 1, display: "flex", flexDirection: "column", justifyContent: splitContentJustify, gap: slide.gap || 12, minWidth: 0 }}>{contentIdxs.flatMap((i) => renderBlockWithComments(blocks[i], i))}</div>;
      // Apply the measured height cap to each image (unless the author pinned its
      // own maxHeight). A bare number becomes px on the <img>, so it caps the
      // image directly — independent of the wrapper/zoom chrome between here and it.
      // >=2 images beside content → grid them (half region) so they fill the column
      // balanced instead of stacking vertically. Single image keeps the height-capped
      // column so a lone side image conforms to the content column's height.
      const imageCol = imageIdxs.length >= 2
        ? <div key="__images" data-split-image style={{ flex: slide.imageFlex || 1, display: "flex", flexDirection: "column", justifyContent: splitImageJustify, minWidth: 0, height: "100%" }}>{renderImageGrid(imageIdxs, "half", !!explicitJustify)}</div>
        : <div key="__images" data-split-image style={{ flex: slide.imageFlex || 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: splitImageJustify, gap: slide.gap || 12, minWidth: 0, height: "100%" }}>{imageIdxs.flatMap((i) => renderBlockWithComments(splitImgMaxH != null && blocks[i].maxHeight == null ? { ...blocks[i], maxHeight: splitImgMaxH } : blocks[i], i))}</div>;
      return imageOnRight ? [contentCol, imageCol] : [imageCol, contentCol];
    }
    if (isSoloImage) return renderBlockWithComments({ ...blocks[0], _solo: true }, 0);
    return renderStackWithImageGrids();
  };

  return (
    <SlideErrorBoundary>
      <div ref={outerRef} style={{ height: "100%", padding: pad, position: "relative", overflow: "visible", boxSizing: "border-box", display: "flex", flexDirection: "column", ...bgStyle }}>
        <div ref={innerRef} style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: isSplit ? "row" : "column", justifyContent: isSplit ? "stretch" : fitJustify, alignItems: isSplit ? "stretch" : (align === "center" ? "center" : "stretch"), textAlign: align, gap: isSplit ? (slide.splitGap || 32) : (slide.gap || 12), transform: fitScale < 1 ? `scale(${fitScale})` : "none", transformOrigin: "top left", width: fitScale < 1 ? `${100 / fitScale}%` : "100%", height: fitScale < 1 ? `${100 / fitScale}%` : "100%", maxWidth: fitScale < 1 ? `${100 / fitScale}%` : "100%", flex: fitScale < 1 ? undefined : 1, flexShrink: fitScale < 1 && (isSplit || isCols) ? 0 : undefined, boxSizing: "border-box" }}>
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
