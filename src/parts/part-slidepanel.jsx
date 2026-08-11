// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
// ━━━ Slide Panel — editor slide view, fullscreen/presenter nav, per-slide AI actions ━━━
function SlidePanel({ state, concept, slideIndex, fullscreen, dispatch, lanes, branding, guidelines, isMobile, fontScale, actionsRef, onRibbonUpdate }) {
  const slides = concept.slides || [];
  const slidesRef = useRef(slides);
  slidesRef.current = slides;
  const aiOk = useAIAvailable();

  // Virtual title card for presentation mode
  const presOffset = fullscreen && concept.presentCard ? 1 : 0;
  const titleCard = useMemo(() => {
    if (!concept.presentCard) return null;
    const lane = (lanes || []).find((l) => l.items.some((i) => i.id === concept.id));
    return buildTitleCardSlide(concept, lane, branding);
  }, [concept.presentCard, concept.id, concept.title, concept.slides, lanes, branding]);
  const presSlides = useMemo(() => fullscreen && titleCard ? [titleCard, ...slides] : slides, [fullscreen, titleCard, slides]);

  // Global slide index/total across all modules (for the on-slide page-number
  // badge). Counts only VISIBLE slides so it agrees with the header pill and the
  // presenter TOC (hidden slides are excluded from presentation counts). The
  // `+ presOffset` keeps the downstream `displayIndex = globalSlideIndex - presOffset`
  // correct when a virtual title card is prepended in fullscreen.
  const { globalSlideIndex, globalSlideTotal } = useMemo(() => {
    let offset = 0, total = 0;
    let found = false;
    for (const l of (lanes || [])) {
      for (const item of l.items) {
        const sl = item.slides || [];
        const vis = sl.filter((s) => !s.hidden).length;
        if (item.id === concept.id) {
          offset += sl.slice(0, Math.max(0, slideIndex - presOffset)).filter((s) => !s.hidden).length + presOffset;
          found = true;
        } else if (!found) { offset += vis; }
        total += vis;
      }
    }
    return { globalSlideIndex: offset, globalSlideTotal: total };
  }, [lanes, concept.id, slideIndex, presOffset]);

  const handleSlideEdit = useCallback((patch) => {
    if (fullscreen && presOffset && slideIndex === 0) return; // Don't edit virtual slide
    const editIdx = fullscreen && presOffset ? slideIndex - presOffset : slideIndex;
    dispatch({ type: "UPDATE_SLIDE", id: concept.id, index: editIdx, patch, merge: true });
  }, [dispatch, concept.id, slideIndex, presOffset, fullscreen]);
  const containerRef = useRef(null);
  const slideRef = useRef(null);
  const [improving, setImproving] = useState(null); // { current, total, status }
  const [capturedThumb, setCapturedThumb] = useState(null); // data URL of sent screenshot
  const [beforeSlides, setBeforeSlides] = useState(null); // { [slideIdx]: slideData } — snapshots before improve
  const [showBefore, setShowBefore] = useState(false);
  const [revealKey, setRevealKey] = useState(null); // triggers magic reveal animation
  const improveCancelRef = useRef(false);
  const runImproveRef = useRef(null);
  const measureRef = useRef(null);
  const [measureSlide, setMeasureSlide] = useState(null);
  // Latest props read inside the long-running improve loop (closures go stale),
  // so the background task survives the user navigating to other slides/modules.
  const lanesRef = useRef(lanes); lanesRef.current = lanes;
  const conceptIdRef = useRef(concept.id); conceptIdRef.current = concept.id;
  const slideIndexRef = useRef(slideIndex); slideIndexRef.current = slideIndex;
  // CR5: the single "Vera is working on THIS on-screen slide" signal, read from
  // the reducer's aiWork flag (fed by BOTH the chat/Vera engine tool path and the
  // toolbar AI ops). "*" is the deck-wide/batch sentinel — a batch op only ever
  // animates whichever of its targets is currently on screen, never off-screen.
  const aiWorkingHere = !!(state.aiWork &&
    (state.aiWork.itemId === concept.id || state.aiWork.itemId === "*") &&
    (state.aiWork.slideIdx === slideIndex || state.aiWork.slideIdx === "*"));
  // When the working flag clears off this slide (op completed / cancelled / error),
  // play the existing magic-reveal settle once — the unified completion for every
  // AI op (chat + toolbar). This is what makes chat/Vera edits settle like the
  // toolbar ops instead of silently popping to new content.
  // The `!revealKey` guard keeps toolbar ops (which set their own revealKey at the
  // exact update point) from double-revealing; the chat/Vera path sets no revealKey,
  // so it relies on this effect for the settle.
  // CR5/D7: only settle when the AI op actually CLEARS on THIS slide — not when
  // aiWorkingHere goes false merely because the view navigated to another slide.
  // Guard on BOTH the itemId (module) AND the slide index being unchanged across
  // the transition — the panel is not keyed by concept.id, so its refs persist
  // across module switches; without the itemId dimension, switching to a DIFFERENT
  // module whose slide sits at the same index (0===0) would wrongly settle the
  // untouched destination slide. Same actual slide = same module + same index.
  const prevAiWorkingHere = useRef(false);
  const prevRevealSlideIndex = useRef(slideIndex);
  const prevRevealItemId = useRef(concept.id);
  useEffect(() => {
    const sameSlide = prevRevealSlideIndex.current === slideIndex && prevRevealItemId.current === concept.id;
    if (prevAiWorkingHere.current && !aiWorkingHere && !revealKey && sameSlide) {
      setRevealKey(`aiw-${Date.now()}`);
      setTimeout(() => setRevealKey(null), 1200);
    }
    prevAiWorkingHere.current = aiWorkingHere;
    prevRevealSlideIndex.current = slideIndex;
    prevRevealItemId.current = concept.id;
  }, [aiWorkingHere, slideIndex, concept.id]); // eslint-disable-line -- revealKey read as a same-commit guard, not a trigger
  // Measure a slide's layout in a hidden offscreen 960×540 host instead of the
  // visible panel, so Improve no longer has to move the view to measure — it can
  // keep running in the background while the user browses elsewhere.
  const measureSlideLayout = async (slideData) => {
    setMeasureSlide(slideData);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300))));
    return computeSlideLayoutStats(measureRef.current);
  };

  const stopImprove = useCallback(() => {
    if (improving) {
      improveCancelRef.current = true;
      setImproving(null);
      setCapturedThumb(null);
      setRevealKey(null);
      dispatch({ type: "SET_AI_WORK", value: null }); // CR5: cancel clears the scan
    }
  }, [improving, dispatch]);
  useEffect(() => { setBeforeSlides(null); setShowBefore(false); setShowMoveToModule(false); setEditingDuration(false); }, [concept.id]);

  // Shift slideIndex when entering/exiting fullscreen with presentCard
  const prevFullscreen = useRef(fullscreen);
  useEffect(() => {
    if (prevFullscreen.current === fullscreen) return;
    const entering = fullscreen && !prevFullscreen.current;
    const exiting = !fullscreen && prevFullscreen.current;
    prevFullscreen.current = fullscreen;
    if (!concept.presentCard) return;
    if (entering) dispatch({ type: "SET_SLIDE_INDEX", index: slideIndex + 1 });
    else if (exiting && slideIndex > 0) dispatch({ type: "SET_SLIDE_INDEX", index: slideIndex - 1 });
    else if (exiting) dispatch({ type: "SET_SLIDE_INDEX", index: 0 });
  }, [fullscreen]); // eslint-disable-line -- intentionally minimal deps to fire once on transition

  // Presenter-view elapsed timer (CR-08): starts fresh each time Present mode
  // is entered, stops (and hides the presenter view) on exit.
  useEffect(() => {
    if (!fullscreen) { presentStartRef.current = null; setPresentElapsed(0); setPresenterView(false); return; }
    presentStartRef.current = Date.now();
    setPresentElapsed(0);
    const id = setInterval(() => { setPresentElapsed(Math.round((Date.now() - presentStartRef.current) / 1000)); }, 1000);
    return () => clearInterval(id);
  }, [fullscreen]); // eslint-disable-line -- intentionally minimal deps, mirrors prevFullscreen effect above
  useEffect(() => { setEditingDuration(false); setShowCommentPopover(false); }, [slideIndex]);
  // Skip hidden slides during fullscreen presentation (CR: hidden slides are not
  // presented). Self-contained: only acts when fullscreen AND the current slide
  // is hidden, so decks with no hidden slides are completely unaffected. Skips in
  // the direction of travel, falling back to the other direction at the ends.
  // Backstop for LANDING on a hidden slide during fullscreen (module-boundary
  // crossing, entering fullscreen on a hidden slide, or a stale jump): nudge to
  // the nearest visible slide, forward first then backward. Arrow navigation
  // already steps over hidden slides WITHIN a module (nextVisible/prevVisible),
  // so this only fires on a land and can never oscillate (it always resolves to a
  // visible slide, and nav never re-lands on a hidden one).
  useEffect(() => {
    if (!fullscreen) return;
    const cur = presSlides[slideIndex];
    if (!cur || !cur.hidden) return;
    let n = -1;
    for (let i = slideIndex + 1; i < presSlides.length; i++) if (!presSlides[i].hidden) { n = i; break; }
    if (n < 0) for (let i = slideIndex - 1; i >= 0; i--) if (!presSlides[i].hidden) { n = i; break; }
    if (n >= 0 && n !== slideIndex) dispatch({ type: "SET_SLIDE_INDEX", index: n });
  }, [fullscreen, slideIndex, presSlides]);
  const [showImproveInput, setShowImproveInput] = useState(false);
  const [improvePrompt, setImprovePrompt] = useState("");
  const [improveScope, setImproveScope] = useState("all"); // "slide" | "module" | "section" | "all"
  const [showNotes, setShowNotes] = useState(false);
  const [showCommentPopover, setShowCommentPopover] = useState(false);
  const [showQuickEdit, setShowQuickEdit] = useState(false);
  const [quickEditPrompt, setQuickEditPrompt] = useState("");
  const [quickEditing, setQuickEditing] = useState(false);
  const [quickEditImage, setQuickEditImage] = useState(null); // { base64, preview }
  const [showGallery, setShowGallery] = useState(false);
  const showGalleryRef = useRef(false);
  const setGallery = (v) => { const val = typeof v === "function" ? v(showGalleryRef.current) : v; showGalleryRef.current = val; setShowGallery(val); };
  // ── Presenter view (CR-08) — single-screen speaker dashboard: current +
  // next-slide preview, speaker notes, elapsed timer. Toggled from Present
  // mode only (button + 'S' key), independent of the audience-facing slide.
  const [showPresenterView, setShowPresenterView] = useState(false);
  const showPresenterViewRef = useRef(false);
  const setPresenterView = (v) => { const val = typeof v === "function" ? v(showPresenterViewRef.current) : v; showPresenterViewRef.current = val; setShowPresenterView(val); };
  // ── Present Edit — restore inline click-to-edit while presenting. OFF by
  // default so an audience never sees edit chrome (CR-03); the presenter flips
  // it on via the ✎ toggle or Shift+E to edit text/icons live. Always resets
  // to off when leaving Present so the next presentation opens clean.
  const [presentEdit, setPresentEdit] = useState(false);
  useEffect(() => { if (!fullscreen) setPresentEdit(false); }, [fullscreen]);
  const [presentElapsed, setPresentElapsed] = useState(0); // seconds since Present mode was entered
  const presentStartRef = useRef(null);
  const [showNewSlide, setShowNewSlide] = useState(false);
  const [newSlidePrompt, setNewSlidePrompt] = useState("");
  const [newSlideImage, setNewSlideImage] = useState(null);
  const [newSlideGenerating, setNewSlideGenerating] = useState(false);
  const [showBranding, setShowBranding] = useState(false);
  const [showCinemaTip, setShowCinemaTip] = useState(false);
  const [previewRatio, setPreviewRatio] = useState("auto");
  const [alternatives, setAlternatives] = useState(null); // [{slide, label, emoji}] or null
  const [altLoading, setAltLoading] = useState(false);
  const [altPreview, setAltPreview] = useState(null); // currently-applied variant: null = original, 0-3 = alternative index
  const [altOriginal, setAltOriginal] = useState(null); // snapshot of the slide before the first variant was applied
  const altCancelRef = useRef(false);
  // Close the grid keeping whatever variant is currently applied (clicking a tile already applied it live).
  const stopAlternatives = () => { altCancelRef.current = true; setAltLoading(false); setAlternatives(null); setAltPreview(null); setAltOriginal(null); };
  const stopAll = () => { stopImprove(); stopAlternatives(); };
  const currentLane = lanes?.find((l) => l.items.some((i) => i.id === concept.id));
  const [showTimingScope, setShowTimingScope] = useState(false);
  const [estimating, setEstimating] = useState(null); // { current, total, status }
  const [timingScope, setTimingScope] = useState("module");
  const estimateCancelRef = useRef(false);

  // Block-targeted editing
  const [blockEditing, setBlockEditing] = useState(false);

  // Timing computations
  const moduleTime = sumDurations(slides);
  const moduleRemaining = slides.slice(slideIndex).reduce((s, sl) => s + (sl.duration || 0), 0);
  const sectionRemaining = (() => {
    if (!currentLane) return 0;
    let total = 0, past = false;
    for (const item of currentLane.items) {
      if (item.id === concept.id) { total += (item.slides || []).slice(slideIndex).reduce((s, sl) => s + (sl.duration || 0), 0); past = true; }
      else if (past) total += sumDurations(item.slides);
    }
    return total;
  })();

  const runEstimate = async () => {
    if (!aiOk) return;
    estimateCancelRef.current = false;
    setShowTimingScope(false);
    let jobs = [];
    if (timingScope === "slide" && slides[slideIndex]) {
      jobs = [{ itemId: concept.id, title: concept.title, slideIdx: slideIndex, slideData: slides[slideIndex] }];
    } else if (timingScope === "module") {
      slides.forEach((s, i) => jobs.push({ itemId: concept.id, title: concept.title, slideIdx: i, slideData: s }));
    } else if (timingScope === "section" && currentLane) {
      for (const item of currentLane.items) (item.slides || []).forEach((s, i) => jobs.push({ itemId: item.id, title: item.title, slideIdx: i, slideData: s }));
    } else {
      for (const lane of lanes) for (const item of lane.items) (item.slides || []).forEach((s, i) => jobs.push({ itemId: item.id, title: item.title, slideIdx: i, slideData: s }));
    }
    if (jobs.length === 0) return;
    // Skip slides with manually locked durations
    jobs = jobs.filter((j) => !j.slideData.timeLock);
    if (jobs.length === 0) { setEstimating(null); return; }

    setEstimating({ current: 0, total: jobs.length, status: "Estimating..." });
    try {
      // Batch in chunks of 30 for API sanity
      for (let start = 0; start < jobs.length; start += 30) {
        if (estimateCancelRef.current) break;
        const chunk = jobs.slice(start, start + 30);
        setEstimating({ current: start, total: jobs.length, status: `Estimating ${start + 1}–${start + chunk.length} of ${jobs.length}...` });
        const durations = await estimateTimings(chunk);
        if (estimateCancelRef.current) break;
        for (let i = 0; i < chunk.length; i++) {
          dispatch({ type: "UPDATE_SLIDE", id: chunk[i].itemId, index: chunk[i].slideIdx, patch: { duration: durations[i] }, merge: true });
        }
      }
    } catch (e) {
      dbg("Estimate error:", e);
      // Surface the failure instead of silently leaving partial/unchanged
      // timings — any chunks that succeeded before the error keep their values.
      setEstimating({ current: 1, total: 1, status: "Timing estimation failed — try again", error: true });
      setTimeout(() => setEstimating(null), 2800);
      return;
    }
    setEstimating(null);
  };
  const [navToast, setNavToast] = useState(null); // { module, section, phase }
  const [showMoveToModule, setShowMoveToModule] = useState(false);
  const moveRef = useRef(null);
  const [editingDuration, setEditingDuration] = useState(false);
  const navToastTimer = useRef(null);

  // Expose slide panel state + actions to app ribbon via ref
  useEffect(() => {
    if (!actionsRef) return;
    actionsRef.current = {
      slidesCount: slides.length, moduleTime, previewRatio,
      showBranding, showTimingScope: !!showTimingScope, estimating: !!estimating,
      showBatchEdit: showImproveInput, improving: !!improving,
      hasBranding: !!(branding?.enabled || guidelines?.trim()),
      toggleBranding: () => setShowBranding((v) => !v),
      toggleBatchEdit: () => improving ? stopAll() : setShowImproveInput((v) => !v),
      toggleTiming: () => estimating ? (() => { estimateCancelRef.current = true; setEstimating(null); })() : setShowTimingScope((v) => !v),
      setPreviewRatio,
      present: () => { stopAll(); dispatch({ type: "SET_FULLSCREEN", value: true }); },
      getLayoutStats: () => computeSlideLayoutStats(slideRef.current),
    };
    onRibbonUpdate?.();
  }, [slides.length, moduleTime, previewRatio, showBranding, showTimingScope, estimating, showImproveInput, improving]);

  // Build flat ordered list of modules across all lanes
  const flatModules = useCallback(() => {
    const list = [];
    for (const lane of (lanes || [])) {
      if (lane.collapsed) continue;
      for (const item of lane.items) {
        const sl = item.slides || [];
        let firstVisible = -1, lastVisible = -1;
        for (let i = 0; i < sl.length; i++) if (!sl[i].hidden) { if (firstVisible < 0) firstVisible = i; lastVisible = i; }
        list.push({ id: item.id, title: item.title, slideCount: sl.length, laneTitle: lane.title, laneId: lane.id, presentCard: !!item.presentCard, firstVisible, lastVisible });
      }
    }
    return list;
  }, [lanes]);

  const showNavToast = useCallback((module, section) => {
    clearTimeout(navToastTimer.current);
    setNavToast({ module, section, phase: "in" });
    navToastTimer.current = setTimeout(() => {
      setNavToast((t) => t ? { ...t, phase: "out" } : null);
      navToastTimer.current = setTimeout(() => setNavToast(null), 300);
    }, 1200);
  }, []);

  useEffect(() => () => clearTimeout(navToastTimer.current), []);

  // Touch swipe for mobile slide navigation (crosses module boundaries like keyboard)
  useSwipe(containerRef, {
    onLeft: useCallback(() => {
      const navSlides = fullscreen ? presSlides : slides;
      if (navSlides.length > 0 && slideIndex < navSlides.length - 1) {
        dispatch({ type: "SET_SLIDE_INDEX", index: slideIndex + 1 });
      } else {
        const mods = flatModules();
        const curIdx = mods.findIndex((m) => m.id === concept.id);
        if (curIdx >= 0 && curIdx + 1 < mods.length) {
          const next = mods[curIdx + 1];
          dispatch({ type: "SELECT", id: next.id });
          dispatch({ type: "SET_SLIDE_INDEX", index: 0 });
          const changedLane = next.laneId !== mods[curIdx].laneId;
          showNavToast(next.title, changedLane ? next.laneTitle : null);
        }
      }
    }, [slideIndex, slides.length, presSlides.length, fullscreen, dispatch, concept.id, flatModules, showNavToast]),
    onRight: useCallback(() => {
      if (slideIndex > 0) {
        dispatch({ type: "SET_SLIDE_INDEX", index: slideIndex - 1 });
      } else {
        const mods = flatModules();
        const curIdx = mods.findIndex((m) => m.id === concept.id);
        if (curIdx >= 0 && curIdx - 1 >= 0) {
          const prev = mods[curIdx - 1];
          dispatch({ type: "SELECT", id: prev.id });
          const prevPresOffset = prev.presentCard && fullscreen ? 1 : 0;
          dispatch({ type: "SET_SLIDE_INDEX", index: Math.max(0, (prev.slideCount || 1) - 1 + prevPresOffset) });
          const changedLane = prev.laneId !== mods[curIdx].laneId;
          showNavToast(prev.title, changedLane ? prev.laneTitle : null);
        }
      }
    }, [slideIndex, dispatch, fullscreen, concept.id, flatModules, showNavToast]),
  });

  // Paste-detection heuristic: a DISTINCTIVE subset of SAFE_SLIDE_KEYS
  // (part-imports.jsx) — not the whole allowlist, because keys shared with
  // blocks (color, gap, padding, align…) would make a copied BLOCK look like a
  // slide. Filtered through SAFE_SLIDE_KEYS so it can never name a key that deck
  // ingress strips: the two lists cannot drift apart.
  const SLIDE_KEYS = new Set(
    ["title","subtitle","blocks","bullets","bg","layout","duration","quote","author","timeLock","speakerNotes"]
      .filter((k) => SAFE_SLIDE_KEYS.has(k))
  );
  const looksLikeSlide = (obj) => obj && typeof obj === "object" && !Array.isArray(obj) && Object.keys(obj).some((k) => SLIDE_KEYS.has(k));
  const handlePaste = useCallback((e) => {
    const tag = e.target?.tagName?.toLowerCase(); if (tag === "textarea" || tag === "input") return;
    const items = e.clipboardData?.items; if (!items) return;
    // Check for text/plain first — try to detect slide JSON
    const textItem = Array.from(items).find((i) => i.type === "text/plain");
    if (textItem) {
      textItem.getAsString((text) => {
        const trimmed = text.trim();
        if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return;
        try {
          const parsed = JSON.parse(trimmed);
          const incoming = Array.isArray(parsed) ? parsed : [parsed];
          const validSlides = incoming.filter(looksLikeSlide).map((s) => sanitizeSlide(s)).filter(Boolean);
          if (validSlides.length === 0) return;
          // Insert after current slide
          const newSlides = [...slides];
          const insertAt = slides.length === 0 ? 0 : slideIndex + 1;
          newSlides.splice(insertAt, 0, ...validSlides);
          dispatch({ type: "SET_SLIDES", id: concept.id, slides: newSlides });
          dispatch({ type: "SET_SLIDE_INDEX", index: insertAt });
        } catch { /* not valid JSON, ignore */ }
      });
      // Don't return here — if it's not JSON, let image paste proceed
    }
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault(); const blob = item.getAsFile(); const reader = new FileReader();
        reader.onload = async () => {
          const compressed = await compressSlideImage(reader.result);
          // Empty module → brand-new full-bleed solo-image slide.
          if (slides.length === 0) { dispatch({ type: "ADD_SLIDE", id: concept.id, slide: { blocks: [{ type: "image", src: compressed }] } }); return; }
          const cur = slides[slideIndex] || {};
          const curImgs = (cur.blocks || []).filter((b) => b.type === "image").length;
          // Overflow cap: at most 5 images per slide. A 6th image spills onto a new
          // image-only slide inserted after this one rather than over-packing the grid.
          if (curImgs >= 5) {
            const newSlides = [...slides];
            const insertAt = slideIndex + 1;
            newSlides.splice(insertAt, 0, { blocks: [{ type: "image", src: compressed }] });
            dispatch({ type: "SET_SLIDES", id: concept.id, slides: newSlides });
            dispatch({ type: "SET_SLIDE_INDEX", index: insertAt });
            return;
          }
          const patch = { blocks: [...(cur.blocks || []), { type: "image", src: compressed }] };
          const n = curImgs + 1; // image count after this paste
          // Layout-aware paste: place the image beside existing body content rather
          // than always stacking it below. pasteImageLayout() respects an explicit
          // author layout, keeps mostly-title/image-only slides and wide images stacked
          // (the renderer auto-grids a run of >=2 images), promotes heavy text + >=3
          // images to a full-width header + full-width image grid, and otherwise returns
          // "image-right" so the image column grids beside the content.
          const aspect = await imageAspect(compressed);
          const layout = pasteImageLayout(cur, aspect, n);
          if (layout !== "stack" && layout !== cur.layout) {
            patch.layout = layout;
            // Balance the split. A single square/portrait side image is tall; at the
            // default 1:1 split it squeezes the body text into a half-width column
            // where it wraps past the slide height and gets auto-scaled smaller — give
            // the content column the larger share. Two or more images grid inside their
            // half, so an even 1:1 split gives that grid the room it needs. Only when
            // the author hasn't pinned a ratio.
            if (cur.contentFlex == null && cur.imageFlex == null) {
              if (n === 1 && aspect <= 1.2) { patch.contentFlex = 1.4; patch.imageFlex = 1; }
              else if (n >= 2) { patch.contentFlex = 1; patch.imageFlex = 1; }
            }
          }
          dispatch({ type: "UPDATE_SLIDE", id: concept.id, index: slideIndex, patch, merge: true });
        };
        reader.readAsDataURL(blob); break;
      }
    }
  }, [concept.id, slideIndex, slides, dispatch]);

  useEffect(() => { const el = containerRef.current; if (el) { el.addEventListener("paste", handlePaste); return () => el.removeEventListener("paste", handlePaste); } }, [handlePaste]);
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;
      // CR2: the TOC left rail is a roving-tabindex ARIA tree. While one of its
      // treeitems holds DOM focus, arrow/space keys are its own disclosure/navigation
      // keys (expand/collapse/move-focus/select) — never global slide-advance. The
      // treeitem's onKeyDown already stopPropagation's real bubbling events; this guard
      // is belt-and-suspenders and also covers synthetic document-level keydowns.
      if ((e.key === " " || (typeof e.key === "string" && e.key.startsWith("Arrow"))) && typeof document !== "undefined" && document.activeElement && document.activeElement.closest && document.activeElement.closest("[role=tree]")) return;

      // Alternatives grid: 1-4 apply variant live, 0 back to original, Enter done, ESC close.
      // Applying keeps the grid open so each variant can be viewed full-size before settling.
      if (altLoading || alternatives) {
        if (e.key === "Escape") { e.preventDefault(); stopAlternatives(); }
        if (alternatives && e.key >= "1" && e.key <= "4") {
          const idx = parseInt(e.key) - 1;
          if (alternatives[idx]?.slide) { e.preventDefault(); applyAlternative(idx); }
        }
        if (e.key === "0") { e.preventDefault(); revertToOriginal(); }
        if (e.key === "Enter") { e.preventDefault(); stopAlternatives(); }
        return;
      }

      const mods = flatModules();
      const curIdx = mods.findIndex((m) => m.id === concept.id);

      // Arrow keys + Space: move through slides, crossing to next/prev module at boundaries
      // Up/Down behave the same as Left/Right (like PowerPoint)
      const navSlides = fullscreen ? presSlides : slides;
      // In fullscreen, step over hidden slides so a draft never appears on screen
      // (editor nav keeps reaching them so they can be edited/unhidden).
      const nextVisible = (from) => { for (let i = from + 1; i < navSlides.length; i++) if (!fullscreen || !navSlides[i].hidden) return i; return -1; };
      const prevVisible = (from) => { for (let i = from - 1; i >= 0; i--) if (!fullscreen || !navSlides[i].hidden) return i; return -1; };
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        stopAlternatives(); // keep a running Improve alive across navigation
        const ni = navSlides.length > 0 ? nextVisible(slideIndex) : -1;
        if (ni >= 0) {
          dispatch({ type: "SET_SLIDE_INDEX", index: ni });
        } else {
          // Cross to the next module. In fullscreen, skip modules that have
          // nothing to present (all slides hidden, no title card) so a draft
          // module never flashes on screen, and land on the first VISIBLE slide.
          let ti = curIdx + 1;
          if (fullscreen) while (ti < mods.length && !mods[ti].presentCard && mods[ti].firstVisible < 0) ti++;
          if (ti >= 0 && ti < mods.length) {
            const next = mods[ti];
            dispatch({ type: "SELECT", id: next.id });
            const target = fullscreen ? (next.presentCard ? 0 : Math.max(0, next.firstVisible)) : 0;
            dispatch({ type: "SET_SLIDE_INDEX", index: target });
            const changedLane = next.laneId !== mods[curIdx].laneId;
            showNavToast(next.title, changedLane ? next.laneTitle : null);
          }
        }
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        stopAlternatives(); // keep a running Improve alive across navigation
        const pi = navSlides.length > 0 ? prevVisible(slideIndex) : -1;
        if (pi >= 0) {
          dispatch({ type: "SET_SLIDE_INDEX", index: pi });
        } else {
          let ti = curIdx - 1;
          if (fullscreen) while (ti >= 0 && !mods[ti].presentCard && mods[ti].lastVisible < 0) ti--;
          if (ti >= 0) {
            const prev = mods[ti];
            dispatch({ type: "SELECT", id: prev.id });
            const prevPresOffset = prev.presentCard ? 1 : 0;
            // Fullscreen: last VISIBLE content slide (+ title-card offset), or the
            // title card if the module has only a card. Editor: the real last slide.
            const target = fullscreen
              ? (prev.lastVisible >= 0 ? prev.lastVisible + prevPresOffset : 0)
              : Math.max(0, (prev.slideCount || 1) - 1);
            dispatch({ type: "SET_SLIDE_INDEX", index: Math.max(0, target) });
            const changedLane = prev.laneId !== mods[curIdx].laneId;
            showNavToast(prev.title, changedLane ? prev.laneTitle : null);
          }
        }
      }

      // Esc closes popovers in fullscreen, but doesn't exit fullscreen (use F)
      // Font scale: +/- in fullscreen (0 resets)
      if (fullscreen && !showGalleryRef.current && (e.key === "+" || e.key === "=")) { e.preventDefault(); { const v = Math.min(fontScale + 0.1, 2.0); dispatch({ type: "SET_FONT_SCALE", value: Math.round(v*10)/10 }); showNavToast("FONT " + Math.round(v * 100) + "%"); }; }
      if (fullscreen && !showGalleryRef.current && e.key === "-") { e.preventDefault(); { const v = Math.max(fontScale - 0.1, 0.5); dispatch({ type: "SET_FONT_SCALE", value: Math.round(v*10)/10 }); showNavToast("FONT " + Math.round(v * 100) + "%"); }; }
      if (fullscreen && !showGalleryRef.current && e.key === "0" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); dispatch({ type: "SET_FONT_SCALE", value: 1 }); showNavToast("FONT 100%"); }
      if (e.key === "f" && !e.metaKey && !e.ctrlKey && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) { stopAlternatives(); dispatch({ type: "SET_FULLSCREEN", value: !fullscreen }); }
      // F5 → fullscreen (prevent page reload)
      if (e.key === "F5") { e.preventDefault(); e.stopPropagation(); if (!fullscreen) { stopAlternatives(); dispatch({ type: "SET_FULLSCREEN", value: true }); } }
      // E → quick edit current slide (not in input/textarea)
      if (e.key === "e" && !e.metaKey && !e.ctrlKey && !e.shiftKey && slides.length > 0 && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
        e.preventDefault(); setShowNewSlide(false); setShowQuickEdit((v) => !v); setQuickEditPrompt(""); setQuickEditImage(null);
      }
      // N → new slide by prompt
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && !e.shiftKey && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
        e.preventDefault(); setShowQuickEdit(false); setShowNewSlide((v) => !v); setNewSlidePrompt(""); setNewSlideImage(null);
      }
      // G → gallery view toggle
      if (e.key === "g" && !e.metaKey && !e.ctrlKey && !e.shiftKey && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
        e.preventDefault(); setGallery((v) => !v);
      }
      // S → presenter view toggle (Present mode only)
      if (fullscreen && e.key === "s" && !e.metaKey && !e.ctrlKey && !e.shiftKey && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
        e.preventDefault(); setPresenterView((v) => !v);
      }
      // Shift+E → toggle inline edit while presenting (Present mode only). Kept
      // distinct from plain 'e' (AI quick-edit dialog). Toasts the new state
      // since the key, unlike the ✎ button, has no persistent visual cue.
      if (fullscreen && e.key === "E" && e.shiftKey && !e.metaKey && !e.ctrlKey && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
        e.preventDefault(); setPresentEdit((v) => { showNavToast(v ? "Edit mode OFF" : "Edit mode ON"); return !v; });
      }
      if (e.key === "Escape" && showGalleryRef.current) { e.preventDefault(); setGallery(false); return; }
      if (e.key === "Escape" && showPresenterViewRef.current) { e.preventDefault(); setPresenterView(false); return; }
      // Ctrl+C → copy ALL selected slides (multi-select) to system clipboard,
      // in slide order. Falls back to the active slide when nothing is multi-selected.
      if ((e.ctrlKey || e.metaKey) && e.key === "c" && slidesRef.current.length > 0 && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName) && !window.getSelection()?.toString()) {
        const curSlides = slidesRef.current;
        const realIdx = fullscreen && presOffset ? slideIndex - presOffset : slideIndex;
        const multi = (state.selectedSlideIndices && state.selectedSlideIndices.length) ? [...state.selectedSlideIndices].sort((a, b) => a - b) : [realIdx];
        const toCopy = multi.filter((i) => i >= 0 && i < curSlides.length).map((i) => curSlides[i]);
        if (toCopy.length > 0) {
          e.preventDefault();
          velaClipboardWriteSlides(toCopy).then((ok) => { if (ok) showNavToast(toCopy.length > 1 ? `${toCopy.length} slides copied` : "Slide copied"); });
        }
      }
      // Ctrl+V → paste slide(s) from system clipboard, inserted sequentially after
      // the active slide (order preserved). Accepts old single-slide clipboards too.
      if ((e.ctrlKey || e.metaKey) && e.key === "v" && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
        velaClipboardReadSlides().then((arr) => {
          if (!arr || arr.length === 0) return;
          const realIdx = fullscreen && presOffset ? slideIndex - presOffset : slideIndex;
          const insertAt = slides.length === 0 ? 0 : realIdx + 1;
          dispatch({ type: "INSERT_SLIDES", id: concept.id, index: insertAt, slides: arr });
          dispatch({ type: "SET_SLIDE_INDEX", index: insertAt + arr.length - 1 });
          showNavToast(arr.length > 1 ? `${arr.length} slides pasted` : "Slide pasted");
        });
      }
      // Delete key → remove current slide (not in input/textarea)
      if (e.key === "Delete" && slides.length > 0 && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        dispatch({ type: "REMOVE_SLIDE", id: concept.id, index: slideIndex });
        dispatch({ type: "SET_SLIDE_INDEX", index: Math.max(0, slideIndex - 1) });
      }
      // Shift+I: quick improve current slide (same as ✨ on single slide)
      if (e.key === "I" && e.shiftKey && !e.metaKey && !e.ctrlKey && slides.length > 0 && !improving && !altLoading && aiOk) { e.preventDefault(); runImproveRef.current?.(null, "slide"); }
    };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, [slideIndex, slides, presSlides, fullscreen, dispatch, concept.id, flatModules, showNavToast, stopAll, altLoading, alternatives, altOriginal, fontScale, state.selectedSlideIndices]);

  // ── Browser back button → exit fullscreen instead of leaving the page ──
  useEffect(() => {
    if (fullscreen) {
      history.pushState({ velaFullscreen: true }, "");
      const onPop = () => { dispatch({ type: "SET_FULLSCREEN", value: false }); };
      window.addEventListener("popstate", onPop);
      return () => window.removeEventListener("popstate", onPop);
    }
  }, [fullscreen, dispatch]);

  // ── Browser Fullscreen API sync ──
  useEffect(() => {
    if (!fullscreen) {
      // Exiting Vela fullscreen → exit browser fullscreen if active
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      return;
    }
    // Entering Vela fullscreen → request browser fullscreen
    const el = containerRef.current || document.documentElement;
    if (!document.fullscreenElement) {
      // Try requestFullscreen — may fail in sandboxed iframes (artifacts), that's OK
      el.requestFullscreen?.().catch(() => {});
    }
    // Listen for browser-level fullscreen exit (e.g. user presses Esc at browser level)
    const onFsChange = () => {
      if (!document.fullscreenElement && fullscreen) {
        dispatch({ type: "SET_FULLSCREEN", value: false });
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, [fullscreen, dispatch]);

  // ── Scroll wheel navigation (medium sensitivity, crosses modules like arrows) ──
  const scrollAccum = useRef(0);
  const scrollTimer = useRef(null);
  const SCROLL_THRESHOLD = 120; // ~1 notch on most mice
  useEffect(() => {
    const el = containerRef.current;
    if (!el || slides.length === 0) return;
    const handler = (e) => {
      if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
      if (!fullscreen && e.target.closest?.("[data-scroll-container]")) return;
      if (e.target.closest?.("[data-teacher-panel]")) return;
      e.preventDefault();
      scrollAccum.current += e.deltaY;
      clearTimeout(scrollTimer.current);
      scrollTimer.current = setTimeout(() => { scrollAccum.current = 0; }, 200);
      if (Math.abs(scrollAccum.current) >= SCROLL_THRESHOLD) {
        const dir = scrollAccum.current > 0 ? 1 : -1;
        scrollAccum.current = 0;
        const navSlides = fullscreen ? presSlides : slides;
        if (dir > 0) {
          // Scroll down → next slide or cross to next module
          if (navSlides.length > 0 && slideIndex < navSlides.length - 1) {
            dispatch({ type: "SET_SLIDE_INDEX", index: slideIndex + 1 });
          } else {
            const mods = flatModules();
            const curIdx = mods.findIndex((m) => m.id === concept.id);
            if (curIdx >= 0 && curIdx + 1 < mods.length) {
              const next = mods[curIdx + 1];
              dispatch({ type: "SELECT", id: next.id });
              dispatch({ type: "SET_SLIDE_INDEX", index: 0 });
              const changedLane = next.laneId !== mods[curIdx].laneId;
              showNavToast(next.title, changedLane ? next.laneTitle : null);
            }
          }
        } else {
          // Scroll up → prev slide or cross to prev module
          if (navSlides.length > 0 && slideIndex > 0) {
            dispatch({ type: "SET_SLIDE_INDEX", index: slideIndex - 1 });
          } else {
            const mods = flatModules();
            const curIdx = mods.findIndex((m) => m.id === concept.id);
            if (curIdx >= 0 && curIdx - 1 >= 0) {
              const prev = mods[curIdx - 1];
              dispatch({ type: "SELECT", id: prev.id });
              const prevPresOffset = prev.presentCard && fullscreen ? 1 : 0;
              dispatch({ type: "SET_SLIDE_INDEX", index: Math.max(0, (prev.slideCount || 1) - 1 + prevPresOffset) });
              const changedLane = prev.laneId !== mods[curIdx].laneId;
              showNavToast(prev.title, changedLane ? prev.laneTitle : null);
            }
          }
        }
      }
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [slideIndex, slides.length, presSlides, fullscreen, dispatch, concept.id, flatModules, showNavToast]);

  const addSlide = () => { dispatch({ type: "ADD_SLIDE", id: concept.id, slide: { blocks: [{ type: "heading", text: "New Slide", size: "2xl" }] } }); dispatch({ type: "SET_SLIDE_INDEX", index: slides.length }); };

  // ── Quick Edit (single slide, prompt-based) ──
  const runQuickEdit = async () => {
    if (!aiOk || !quickEditPrompt.trim() || quickEditing || !slides[slideIndex]) return;
    setQuickEditing(true);
    dispatch({ type: "SET_AI_WORK", value: { itemId: concept.id, slideIdx: slideIndex } }); // CR5
    try {
      const layoutStats = computeSlideLayoutStats(slideRef.current);
      const result = await quickEditSlide(slides[slideIndex], concept.title, slideIndex + 1, slides.length, quickEditPrompt.trim(), branding, guidelines, quickEditImage?.base64 || null, layoutStats);
      if (result) {
        if (quickEditImage) replacePastedImage(result, quickEditImage.preview);
        const ts = new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
        const logEntry = `[✏️ ${ts}] prompt: "${quickEditPrompt.trim()}"${quickEditImage ? " 📎" : ""}`;
        const existing = slides[slideIndex]?.notes?.trim() || "";
        result.notes = existing ? `${existing}\n${logEntry}` : logEntry;
        setRevealKey(`qe-${Date.now()}`);
        dispatch({ type: "UPDATE_SLIDE", id: concept.id, index: slideIndex, patch: result });
        setShowQuickEdit(false);
        setQuickEditPrompt("");
        setQuickEditImage(null);
      }
    } catch (e) {
      console.error("Quick edit failed:", e);
    } finally {
      setQuickEditing(false);
      dispatch({ type: "SET_AI_WORK", value: null }); // CR5
      setTimeout(() => setRevealKey(null), 1200);
    }
  };

  // ── Block-Targeted Edit (single block, prompt-based) ──
  const runBlockEdit = async (blockIndex, prompt) => {
    if (!prompt || blockEditing || !slides[slideIndex]?.blocks?.[blockIndex]) return;
    setBlockEditing(true);
    dispatch({ type: "SET_AI_WORK", value: { itemId: concept.id, slideIdx: slideIndex } }); // CR5
    try {
      const newBlocks = await blockEditSlide(
        slides[slideIndex], blockIndex, prompt,
        concept.title, slideIndex + 1, slides.length, branding, guidelines
      );
      if (newBlocks && newBlocks.length > 0) {
        const curBlocks = [...(slides[slideIndex].blocks || [])];
        curBlocks.splice(blockIndex, 1, ...newBlocks);
        const ts = new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
        const logEntry = `[🎯 ${ts}] block[${blockIndex}] "${prompt}"`;
        const existing = slides[slideIndex]?.notes?.trim() || "";
        setRevealKey(`be-${Date.now()}`);
        dispatch({ type: "UPDATE_SLIDE", id: concept.id, index: slideIndex, patch: { blocks: curBlocks, notes: existing ? `${existing}\n${logEntry}` : logEntry }, merge: true });
      }
    } catch (e) {
      console.error("Block edit failed:", e);
    } finally {
      setBlockEditing(false);
      dispatch({ type: "SET_AI_WORK", value: null }); // CR5
      setTimeout(() => setRevealKey(null), 1200);
    }
  };

  // ── Generate New Slide (prompt-based) ──
  const runNewSlide = async () => {
    if (!aiOk || !newSlidePrompt.trim() || newSlideGenerating) return;
    setNewSlideGenerating(true);
    dispatch({ type: "SET_AI_WORK", value: { itemId: concept.id, slideIdx: slides.length } }); // CR5 (future new-slide index)
    try {
      const result = await generateSlide(concept.title, slides.length, newSlidePrompt.trim(), branding, guidelines, newSlideImage?.base64 || null);
      if (result) {
        if (newSlideImage) replacePastedImage(result, newSlideImage.preview);
        const ts = new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
        const logEntry = `[➕ ${ts}] prompt: "${newSlidePrompt.trim()}"${newSlideImage ? " 📎" : ""}`;
        result.notes = result.notes?.trim() ? `${result.notes.trim()}\n${logEntry}` : logEntry;
        dispatch({ type: "ADD_SLIDE", id: concept.id, slide: result });
        dispatch({ type: "SET_SLIDE_INDEX", index: slides.length });
        setRevealKey(`ns-${Date.now()}`);
        setShowNewSlide(false);
        setNewSlidePrompt("");
        setNewSlideImage(null);
      }
    } catch (e) {
      console.error("Generate slide failed:", e);
    } finally {
      setNewSlideGenerating(false);
      dispatch({ type: "SET_AI_WORK", value: null }); // CR5
      setTimeout(() => setRevealKey(null), 1200);
    }
  };

  const runImprove = async (prompt, scopeOverride) => {
    if (improving) { stopImprove(); return; }
    if (!aiOk) return;
    improveCancelRef.current = false;
    setShowImproveInput(false);
    const scope = scopeOverride || improveScope;

    // Build job list based on scope: [{itemId, itemTitle, slideIdx, slideData}]
    let jobs = [];
    if (scope === "slide" && slides.length > 0) {
      jobs = [{ itemId: concept.id, itemTitle: concept.title, slideIdx: slideIndex, slideData: slides[slideIndex] }];
    } else if (scope === "all") {
      for (const lane of lanes) {
        for (const item of lane.items) {
          (item.slides || []).forEach((s, i) => jobs.push({ itemId: item.id, itemTitle: item.title, slideIdx: i, slideData: s }));
        }
      }
    } else if (scope === "section" && currentLane) {
      for (const item of currentLane.items) {
        (item.slides || []).forEach((s, i) => jobs.push({ itemId: item.id, itemTitle: item.title, slideIdx: i, slideData: s }));
      }
    } else {
      // "module" — all slides of current concept
      slides.forEach((s, i) => jobs.push({ itemId: concept.id, itemTitle: concept.title, slideIdx: i, slideData: s }));
    }
    if (jobs.length === 0) return;

    try {
      // Improve uses computeSlideLayoutStats (not a screenshot), so html2canvas
      // is not needed here — loading it would hang the desktop (CDN blocked).
      // Snapshot all slides being improved for before/after comparison
      const snapshots = {};
      jobs.forEach((j) => { snapshots[`${j.itemId}-${j.slideIdx}`] = JSON.parse(JSON.stringify(j.slideData)); });
      setBeforeSlides(snapshots);
      setShowBefore(false);
      setCapturedThumb(null);
      setImproving({ current: 0, total: jobs.length, status: "Starting..." });
      let successes = 0, failures = 0;

      for (let j = 0; j < jobs.length; j++) {
        if (improveCancelRef.current) break;
        const job = jobs[j];
        // CR5: mark the active job's slide as the one Vera is working on — the scan
        // shows only when THIS job's slide is the one currently on screen (batch
        // never mass-animates off-screen slides).
        dispatch({ type: "SET_AI_WORK", value: { itemId: job.itemId, slideIdx: job.slideIdx } });
        setImproving({ current: j + 1, total: jobs.length, status: `Reviewing ${job.itemTitle} #${job.slideIdx + 1}...` });

        // Measure layout in a hidden offscreen host — Improve no longer navigates
        // the visible view, so it keeps running while the user browses elsewhere.
        const layoutStats = await measureSlideLayout(job.slideData);
        if (improveCancelRef.current) break;

        try {
          const improved = await improveSlide(null, job.slideData, job.itemTitle, job.slideIdx + 1, (scope === "section" ? jobs.length : slides.length), prompt, branding, guidelines, layoutStats);
          if (improveCancelRef.current) break;
          // Don't clobber a slide the user (or another action) changed while we worked,
          // and skip ones whose module/slide was removed meanwhile.
          const cur = findItem(lanesRef.current, job.itemId)?.slides?.[job.slideIdx];
          if (!cur) {
            failures++;
            setImproving({ current: j + 1, total: jobs.length, status: `⚠ ${job.itemTitle} #${job.slideIdx + 1} gone — skipping` });
            await new Promise((r) => setTimeout(r, 1200));
            continue;
          }
          if (JSON.stringify(cur) !== JSON.stringify(snapshots[`${job.itemId}-${job.slideIdx}`])) {
            setImproving({ current: j + 1, total: jobs.length, status: `↪ ${job.itemTitle} #${job.slideIdx + 1} edited — skipping` });
            await new Promise((r) => setTimeout(r, 1200));
            continue;
          }
          console.log(`[IMPROVE] ${job.itemTitle} #${job.slideIdx + 1} → bg=${improved.bg || "(none)"} bgGradient=${improved.bgGradient || "(none)"} color=${improved.color || "(none)"}`);
          // Animate the reveal only when the improved slide is the one on screen.
          if (job.itemId === conceptIdRef.current && job.slideIdx === slideIndexRef.current) setRevealKey(`${job.itemId}-${job.slideIdx}-${Date.now()}`);
          dispatch({ type: "UPDATE_SLIDE", id: job.itemId, index: job.slideIdx, patch: improved });
          successes++;

          setImproving({ current: j + 1, total: jobs.length, status: `${job.itemTitle} #${job.slideIdx + 1} ✓ improved` });
          await new Promise((r) => setTimeout(r, 800));
        } catch (slideErr) {
          failures++;
          console.warn(`Improve failed for ${job.itemTitle} #${job.slideIdx + 1}:`, slideErr?.message || slideErr);
          setImproving({ current: j + 1, total: jobs.length, status: `⚠ ${job.itemTitle} #${job.slideIdx + 1} failed — skipping` });
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      setMeasureSlide(null);
      dispatch({ type: "SET_AI_WORK", value: null }); // CR5: batch done — clear the scan

      // Background-friendly: leave the user wherever they navigated — don't snap the view back.
      setImproving(failures > 0 ? { current: jobs.length, total: jobs.length, status: `Done — ${successes}✓ ${failures}⚠` } : null);
      if (failures > 0) setTimeout(() => setImproving(null), 3000);
      setCapturedThumb(null);
      setTimeout(() => setRevealKey(null), 1200);
    } catch (e) {
      console.error("Improve setup error:", e);
      setImproving(null);
      setCapturedThumb(null);
      setRevealKey(null);
      dispatch({ type: "SET_AI_WORK", value: null }); // CR5
    }
  };
  runImproveRef.current = runImprove;

  // ── Alternatives ──
  const runAlternatives = async () => {
    if (!aiOk || altLoading || !slides[slideIndex]) return;
    altCancelRef.current = false;
    setAltLoading(true);
    setAlternatives(null);
    setAltPreview(null);
    try {
      const el = slideRef.current;
      if (!el) { setAltLoading(false); return; }
      // Use the fail-safe loader so the desktop (CDN-blocked) doesn't hang;
      // without html2canvas we send no screenshot and rely on layout stats.
      const h2c = await loadHtml2Canvas();
      const base64 = h2c ? await captureSlide(el, h2c) : null;
      if (altCancelRef.current) { setAltLoading(false); return; }

      const slideJson = slides[slideIndex];
      const layoutStats = computeSlideLayoutStats(el);
      const alts = ALT_DIRECTIONS.map((d) => ({ slide: null, label: d.label, emoji: d.emoji, error: null }));
      setAlternatives([...alts]);

      // Sequential to avoid rate limits — progressive display as each lands
      for (let i = 0; i < ALT_DIRECTIONS.length; i++) {
        if (altCancelRef.current) break;
        try {
          const result = await generateAlternative(base64, slideJson, concept.title, slideIndex + 1, slides.length, ALT_DIRECTIONS[i].prompt, branding, guidelines, layoutStats);
          alts[i] = { slide: result, label: ALT_DIRECTIONS[i].label, emoji: ALT_DIRECTIONS[i].emoji, error: null };
        } catch (e) {
          alts[i] = { slide: null, label: ALT_DIRECTIONS[i].label, emoji: ALT_DIRECTIONS[i].emoji, error: e?.message || "failed" };
        }
        if (!altCancelRef.current) setAlternatives([...alts]);
      }
    } catch (e) {
      dbg("Alternatives error:", e);
    }
    setAltLoading(false);
  };

  // Apply a variant live to the slide but keep the grid open, so the user can click
  // through each variant and see it full-size before settling. Snapshot the original
  // once (on first apply) so the Original tile can revert.
  const applyAlternative = (i) => {
    const alt = alternatives?.[i];
    if (!alt?.slide) return;
    setAltOriginal((prev) => prev ?? slides[slideIndex]);
    setRevealKey(`alt-${Date.now()}`);
    dispatch({ type: "UPDATE_SLIDE", id: concept.id, index: slideIndex, patch: alt.slide });
    setAltPreview(i);
    setTimeout(() => setRevealKey(null), 1200);
  };
  // Revert to the pre-variant snapshot, keeping the grid open.
  const revertToOriginal = () => {
    if (altOriginal == null) { setAltPreview(null); return; }
    setRevealKey(`alt-orig-${Date.now()}`);
    dispatch({ type: "UPDATE_SLIDE", id: concept.id, index: slideIndex, patch: altOriginal });
    setAltPreview(null);
    setTimeout(() => setRevealKey(null), 1200);
  };
  // Clear alternatives when slide changes
  useEffect(() => { setAlternatives(null); setAltLoading(false); setAltPreview(null); setAltOriginal(null); }, [concept.id, slideIndex]);

  const isStudent = state?.veraMode === "student";

  // Hidden offscreen host used to measure a slide's layout without disturbing the
  // visible view, so Improve can run in the background across navigation.
  const measureHarness = measureSlide ? (
    <div aria-hidden style={{ position: "fixed", left: -99999, top: 0, width: VIRTUAL_W, pointerEvents: "none", opacity: 0, zIndex: -1 }}>
      <VirtualSlide slide={measureSlide} index={0} total={1} innerRef={measureRef} branding={branding} />
    </div>
  ) : null;

  if (fullscreen) return (
    <div ref={containerRef} tabIndex={0} style={{ position: "fixed", inset: 0, zIndex: 9999, background: T.bg, display: "flex", flexDirection: "row", outline: "none" }}>
      {measureHarness}
      <div style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        {/* Deck-level transition (CR-09): key on slideIndex remounts this wrapper
            on every slide advance, replaying the subtle fade/scale-in defined by
            .slide-transition-fade (part-imports.jsx). Independent of the per-block
            .stg-N stagger reveal inside SlideContent, which keeps working as-is. */}
        <div key={slideIndex} className="slide-transition-fade" style={{ position: "relative", width: "100%", height: "100%" }}>
          <FullscreenSlide slide={presSlides[slideIndex]} index={slideIndex} total={presSlides.length} innerRef={slideRef} branding={presSlides[slideIndex]?._virtual ? null : branding} editable={!isStudent && !presSlides[slideIndex]?._virtual} onEdit={isStudent || presSlides[slideIndex]?._virtual ? undefined : handleSlideEdit} onBlockEdit={isStudent || presSlides[slideIndex]?._virtual ? undefined : runBlockEdit} blockEditing={isStudent ? null : blockEditing} fontScale={fontScale} mode="fill" forceEdit={presentEdit && !isStudent} displayIndex={globalSlideIndex - presOffset} displayTotal={globalSlideTotal} />
        </div>
        {!isMobile && <PresenterTOC slides={presSlides} slideIndex={slideIndex} onJump={(i) => dispatch({ type: "SET_SLIDE_INDEX", index: i })} lanes={lanes} currentConceptId={concept.id} dispatch={dispatch} />}
                {fontScale !== 1 && <div style={{ position: "absolute", top: 12, right: 16, fontFamily: FONT.mono, fontSize: 13, fontWeight: 700, color: T.accent, background: T.bgPanel + "e0", padding: "3px 10px", borderRadius: 4, border: `1px solid ${T.accent}40`, zIndex: 20, letterSpacing: "0.05em", pointerEvents: "none" }}>FONT {Math.round(fontScale * 100)}%</div>}
        {improving && <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "10px 20px", background: "rgba(0,0,0,0.82)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", gap: 12, zIndex: 20 }}>
          <div style={{ fontSize: 18, animation: "spin 1.5s linear infinite", display: "inline-block" }}>✨</div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontFamily: FONT.mono, fontSize: 13, color: "#fff", fontWeight: 700 }}>{improving.status}</div>
            <div style={{ width: "100%", height: 3, background: "rgba(255,255,255,0.2)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", background: T.accent, borderRadius: 2, width: `${(improving.current / improving.total) * 100}%`, transition: "width 0.3s" }} />
            </div>
          </div>
          <div style={{ fontFamily: FONT.mono, fontSize: 10, color: "rgba(255,255,255,0.5)" }}>{improving.current}/{improving.total}</div>
        </div>}
        <div className="slide-nav-btn" onClick={() => dispatch({ type: "SET_FULLSCREEN", value: false })} style={{ position: "absolute", top: isMobile ? 8 : 16, right: isMobile ? 8 : 16, padding: isMobile ? 12 : 8 }}><Minimize2 size={isMobile ? 22 : 18} color="#fff" /></div>
        {!isMobile && <div data-testid="student-toggle" className="slide-nav-btn" onClick={() => dispatch({ type: "SET_VERA_MODE", mode: isStudent ? "editor" : "student" })} title={isStudent ? "Exit student mode" : "Student mode — Vera teaches"} style={{ position: "absolute", top: 16, right: 52, padding: 8, background: isStudent ? T.accent + "30" : "transparent", borderRadius: 6 }}><span style={{ fontSize: 16 }}>🎓</span></div>}
        {!isMobile && <div data-testid="gallery-toggle" className="slide-nav-btn" onClick={() => setGallery((v) => !v)} title="Gallery view (G)" style={{ position: "absolute", top: 16, right: 88, padding: 8, background: showGallery ? T.accent + "30" : "transparent", borderRadius: 6 }}><span style={{ fontSize: 16 }}>🗂</span></div>}
        {!isMobile && <div data-testid="presenter-toggle" className="slide-nav-btn" onClick={() => setPresenterView((v) => !v)} title={showPresenterView ? "Exit presenter view (S)" : "Presenter view — notes, next slide, timer (S)"} style={{ position: "absolute", top: 16, right: 124, padding: 8, background: showPresenterView ? T.accent + "30" : "transparent", borderRadius: 6 }}><span style={{ fontSize: 16 }}>🖥️</span></div>}
        {/* Present Edit toggle (Shift+E): restore inline click-to-edit while
            presenting. Uses the Lucide pencil (SVG), NOT the ✏ emoji, so the
            CR-03 "no edit chrome" test still passes when edit mode is off.
            Hidden in student mode, where editing is disabled by design. */}
        {!isMobile && !isStudent && <div data-testid="present-edit-toggle" className="slide-nav-btn" onClick={() => setPresentEdit((v) => !v)} title={presentEdit ? "Editing on — click text/icons to edit (Shift+E)" : "Edit mode — click text/icons to edit while presenting (Shift+E)"} style={{ position: "absolute", top: 16, right: 160, padding: 8, background: presentEdit ? T.accent + "30" : "transparent", borderRadius: 6 }}>{getIcon("edit", { size: 18, color: "#fff" })}</div>}
        {/* Browser fullscreen toggle removed — Vela fullscreen (F key / minimize button) is sufficient */}
        {!isMobile && !VELA_LOCAL_MODE && <>
          <div className="slide-nav-btn" onClick={() => setShowCinemaTip((v) => !v)} title="Cinema mode — fullscreen in browser" style={{ position: "absolute", top: 16, right: 196, padding: 8 }}><VelaIcon size={18} /></div>
          {showCinemaTip && <CinemaTip onClose={() => setShowCinemaTip(false)} />}
        </>}
        {navToast && <div className={navToast.phase === "in" ? "nav-toast-in" : "nav-toast-out"} style={{ position: "absolute", bottom: 20, left: 0, right: 0, display: "flex", justifyContent: "center", zIndex: 20, pointerEvents: "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 20px", borderRadius: 8, background: "rgba(0,0,0,0.78)", backdropFilter: "blur(8px)", border: `1px solid ${T.accent}30` }}>
            {navToast.section && <span style={{ fontFamily: FONT.mono, fontSize: 10, color: T.accent, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>{navToast.section}</span>}
            {navToast.section && <span style={{ color: T.textDim, fontSize: 13 }}>›</span>}
            <span style={{ fontFamily: FONT.display, fontSize: 14, color: "#fff", fontWeight: 600 }}>{navToast.module}</span>
          </div>
        </div>}
        {/* Floating Edit + New Slide cluster — REMOVED from the fullscreen/Present
            view (CR-03): this branch is the audience-facing Present surface, and a
            pencil/+ edit cluster here is edit chrome that must never be visible to
            an audience. Equivalent Quick Edit / New Slide / Improve / Variants
            controls already exist in the non-fullscreen editor's dialog zone and
            SLIDE TOOLBAR strip below — exit Present (F) to reach them. */}
      </div>
      </div>
      {isStudent && <StudentPanel state={state} dispatch={dispatch} lanes={lanes} selectedId={concept.id} slideIndex={slideIndex} />}
      {showGallery && <GalleryView lanes={lanes} currentConceptId={concept.id} slideIndex={slideIndex} dispatch={dispatch} onClose={() => setGallery(false)} branding={branding} />}
      {showPresenterView && (() => {
        let nextIdx = -1;
        for (let i = slideIndex + 1; i < presSlides.length; i++) if (!presSlides[i].hidden) { nextIdx = i; break; }
        return <PresenterView current={presSlides[slideIndex]} next={nextIdx >= 0 ? presSlides[nextIdx] : null} index={globalSlideIndex - presOffset} total={globalSlideTotal} duration={presSlides[slideIndex]?.duration || 0} elapsed={presentElapsed} branding={branding} onClose={() => setPresenterView(false)} />;
      })()}
    </div>
  );

  return (
    <div ref={containerRef} tabIndex={0} className="fade-in" style={{ flex: 1, display: "flex", flexDirection: "column", background: T.bg, borderLeft: isMobile ? "none" : `1px solid ${T.border}`, outline: "none", minWidth: 0 }}>
      {measureHarness}


      {/* ── TOP PANELS — deck-level dialogs from top bar ──── */}
      {showBranding && <div style={{ flexShrink: 0 }}><BrandingPanel branding={branding} guidelines={guidelines} dispatch={dispatch} isMobile={isMobile} /></div>}
      {showImproveInput && <div style={{ flexShrink: 0, borderBottom: `1px solid ${T.border}`, background: T.accent + "08", padding: "8px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <span style={{ fontFamily: FONT.mono, fontSize: 10, fontWeight: 700, color: T.accent, letterSpacing: "0.05em" }}>🔄 BATCH EDIT</span>
          <button onClick={() => setShowImproveInput(false)} style={{ marginLeft: "auto", background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 13, padding: 0 }}>✕</button>
        </div>
        <ScopeSelector icon="🔄" scope={improveScope} setScope={setImproveScope} concept={concept} slideIndex={slideIndex} slides={slides} currentLane={currentLane} lanes={lanes} isMobile={isMobile} />
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
          <input autoFocus value={improvePrompt} onChange={(e) => setImprovePrompt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") runImprove(improvePrompt.trim() || null); if (e.key === "Escape") setShowImproveInput(false); }} placeholder="What to change across slides? (leave empty for auto-improve)..." style={S.input({ fontSize: 13 })} />
          <button onClick={() => runImprove(improvePrompt.trim() || null)} style={S.primaryBtn({ padding: "5px 14px" })}>Go</button>
        </div>
        {improving && <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
          <span style={{ fontSize: 14, animation: "spin 1.5s linear infinite", display: "inline-block" }}>🔄</span>
          <span style={{ fontFamily: FONT.mono, fontSize: 13, color: T.accent, fontWeight: 600, flex: 1 }}>{improving.status}</span>
          <div style={{ width: 80, height: 3, background: T.border, borderRadius: 2, overflow: "hidden" }}><div style={{ height: "100%", background: T.accent, borderRadius: 2, width: `${(improving.current / improving.total) * 100}%`, transition: "width 0.3s" }} /></div>
          <button onClick={stopAll} style={S.btn({ padding: "2px 8px", fontSize: 10, color: T.red })}>stop</button>
        </div>}
      </div>}

      {/* ── MAIN PREVIEW ───────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {slides.length === 0 ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
            <div style={{ fontSize: 32, opacity: 0.15 }}>🎬</div>
            <div style={{ fontFamily: FONT.mono, fontSize: 13, color: T.textDim, textAlign: "center", lineHeight: 1.7 }}>No slides yet. Add one or paste an image.</div>
          </div>
        ) : (
          <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? 6 : 12, overflow: "hidden" }}>
            <div style={{ width: "100%", height: "100%", position: "relative" }}>
              {(() => {
                const { vw, vh, isAuto } = computeVirtualDims(previewRatio);
                const beforeKey = `${concept.id}-${slideIndex}`;
                const displaySlide = showBefore && beforeSlides?.[beforeKey] ? beforeSlides[beforeKey] : slides[slideIndex];
                // CR5: one working scan for EVERY AI op on this on-screen slide.
                // aiWorkingHere is the unified reducer signal (chat/Vera engine +
                // toolbar); the local flags keep the scan up for toolbar ops even
                // before their dispatch lands. --vera-accent tints the sweep to the
                // slide's accent (see part-imports.jsx). data-testid drives verify.
                // Routed through cssColor() (part-imports.jsx) — the same CSS-context
                // output encoder used at every other color-scalar render sink — so this
                // custom property can only ever carry a strict color token, never a
                // deck-supplied string; see part-imports.jsx getCss() for the paired
                // @property type registration (belt + suspenders on the same value).
                return <div key={revealKey || "static"} data-testid="slide-fx-wrapper" data-ai-working={aiWorkingHere ? "1" : undefined} className={revealKey ? "magic-reveal" : (improving || aiWorkingHere || quickEditing || blockEditing || newSlideGenerating || altLoading) ? "vera-thinking" : ""} style={{ borderRadius: 6, width: "100%", height: "100%", "--vera-accent": cssColor(displaySlide?.accent) || T.accent }}>
                  {/* CR3: always letterbox-fit to a fixed aspect box (960×540 for the
                      default "auto"/Fit ratio) so the editor viewport height is
                      content-independent and the toolbar below stays put. Elastic
                      container-shaped "fill" is reserved for fullscreen/present. */}
                  <VirtualSlide slide={displaySlide} index={slideIndex} total={slides.length} innerRef={slideRef} branding={branding} editable onEdit={handleSlideEdit} mode="fit-viewport" onBlockEdit={runBlockEdit} blockEditing={blockEditing} virtualW={isAuto ? VIRTUAL_W : vw} virtualH={isAuto ? VIRTUAL_H : vh} bordered reviewMode={state.reviewMode} itemId={concept.id} dispatch={dispatch} displayIndex={globalSlideIndex} displayTotal={globalSlideTotal} />
                  {/* Comment badge overlay (top-right) — hidden when comments panel or popover is open */}
                  {!fullscreen && !state.commentsPanelOpen && !showCommentPopover && (() => {
                    const sc = (slides[slideIndex]?.comments || []).filter((c) => c.status === "open");
                    if (sc.length === 0) return null;
                    return <div onClick={(e) => { e.stopPropagation(); dispatch({ type: "SET_COMMENTS_PANEL", open: true }); dispatch({ type: "SET_REVIEW_MODE", value: true }); }} style={{ position: "absolute", top: 8, right: 8, zIndex: 10, minWidth: 22, height: 22, borderRadius: 11, background: T.amber, color: "#fff", fontFamily: FONT.mono, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 6px", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }} title={`${sc.length} open comment${sc.length > 1 ? "s" : ""}`}>{sc.length}</div>;
                  })()}
                  {/* Study notes badge (top-left) — pure indicator in editor mode */}
                  {!fullscreen && slides[slideIndex]?.studyNotes?.text && (
                    <div data-study-marker title="This slide has offline study notes — open student mode (🎓) to view" style={{ position: "absolute", top: 8, left: 8, zIndex: 10, width: 22, height: 22, borderRadius: 11, background: T.accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.3)", pointerEvents: "none" }}>🎓</div>
                  )}
                  {/* Review mode visual border indicator */}
                  {state.reviewMode && !fullscreen && <div style={{ position: "absolute", inset: 0, zIndex: 8, border: `2px solid ${T.amber}40`, borderRadius: 6, pointerEvents: "none" }} />}
                  {/* Comment popover */}
                  {showCommentPopover && !fullscreen && <CommentPopover itemId={concept.id} slideIndex={slideIndex} slide={slides[slideIndex]} dispatch={dispatch} onClose={() => setShowCommentPopover(false)} anchor="right" />}
                </div>;
              })()}
              {improving && <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "8px 12px", background: "rgba(0,0,0,0.82)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", gap: 10, zIndex: 10, borderRadius: "0 0 6px 6px" }}>
                {capturedThumb && <img src={capturedThumb} alt="sent" style={{ width: 48, height: 27, borderRadius: 3, border: "1px solid rgba(255,255,255,0.15)", objectFit: "cover", flexShrink: 0 }} />}
                <div style={{ fontSize: 16, animation: "spin 1.5s linear infinite", display: "inline-block" }}>✨</div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ fontFamily: FONT.mono, fontSize: 10, color: "#fff", fontWeight: 700 }}>{improving.status}</div>
                  <div style={{ width: "100%", height: 3, background: "rgba(255,255,255,0.2)", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", background: T.accent, borderRadius: 2, width: `${(improving.current / improving.total) * 100}%`, transition: "width 0.3s" }} />
                  </div>
                </div>
                <div style={{ fontFamily: FONT.mono, fontSize: 9, color: "rgba(255,255,255,0.5)" }}>{improving.current}/{improving.total}</div>
              </div>}
              {!improving && beforeSlides && <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 4, zIndex: 10 }}>
                <button onClick={() => setShowBefore((v) => !v)} style={S.btn({ background: showBefore ? T.amber + "30" : "rgba(0,0,0,0.5)", color: showBefore ? T.amber : "#fff", border: `1px solid ${showBefore ? T.amber : "rgba(255,255,255,0.2)"}`, fontSize: 9, padding: "2px 8px" })}>{showBefore ? "◀ Before" : "After ▶"}</button>
                <button onClick={() => setBeforeSlides(null)} style={S.btn({ background: "rgba(0,0,0,0.5)", color: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.15)", fontSize: 9, padding: "2px 6px" })}>✕</button>
              </div>}
            </div>
            {/* Alternatives grid — click a tile to apply it live; grid stays open so each variant can be viewed full-size */}
            {(alternatives || altLoading) && <div style={{ position: "absolute", bottom: isMobile ? 6 : 10, left: isMobile ? 6 : 10, right: isMobile ? 50 : 70, zIndex: 15 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim, background: "rgba(0,0,0,0.5)", padding: "2px 8px", borderRadius: 10 }}>Click to apply · Esc to close</span>
                <button onClick={stopAlternatives} title="Close variants (Esc)" style={S.btn({ background: "rgba(0,0,0,0.5)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.15)", fontSize: 10, padding: "2px 7px", borderRadius: 10 })}>✕</button>
              </div>
              <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "nowrap", overflowX: "auto" }}>
                {/* Original — revert to the pre-variant slide */}
                {(() => {
                  const origSlide = altOriginal ?? slides[slideIndex];
                  const isOrig = altPreview === null;
                  if (!origSlide) return null;
                  return (
                    <div key="orig" onClick={revertToOriginal}
                      style={{ flex: "0 0 auto", width: isMobile ? 80 : 110, cursor: "pointer", borderRadius: 8, overflow: "hidden", border: `2px solid ${isOrig ? T.accent : "transparent"}`, background: T.bgPanel, transition: "border-color 0.2s, transform 0.2s", transform: isOrig ? "scale(1.05)" : "scale(1)" }}>
                      <div style={{ aspectRatio: "16/9", overflow: "hidden", position: "relative" }}>
                        <div style={{ transform: `scale(${(isMobile ? 80 : 110) / VIRTUAL_W})`, transformOrigin: "top left", width: VIRTUAL_W, height: VIRTUAL_H, pointerEvents: "none" }}>
                          <SlideContent slide={origSlide} index={slideIndex} total={slides.length} branding={branding} />
                        </div>
                      </div>
                      <div style={{ padding: "2px 4px", textAlign: "center" }}>
                        <span style={{ fontSize: 9 }}>↩</span>
                        <span style={{ fontFamily: FONT.mono, fontSize: 9, color: isOrig ? T.accent : T.textMuted, marginLeft: 2, fontWeight: isOrig ? 700 : 400 }}>Original</span>
                      </div>
                    </div>
                  );
                })()}
                {ALT_DIRECTIONS.map((d, i) => {
                  const alt = alternatives?.[i];
                  const ready = alt?.slide;
                  const failed = alt?.error;
                  const isApplied = altPreview === i;
                  return (
                    <div key={i} onClick={() => { if (ready) applyAlternative(i); }}
                      style={{ flex: "0 0 auto", width: isMobile ? 80 : 110, cursor: ready ? "pointer" : "default", opacity: failed ? 0.4 : 1, borderRadius: 8, overflow: "hidden", border: `2px solid ${isApplied ? T.accent : "transparent"}`, background: T.bgPanel, transition: "border-color 0.2s, transform 0.2s", transform: isApplied ? "scale(1.05)" : "scale(1)" }}>
                      {ready ? (
                        <>
                          <div style={{ aspectRatio: "16/9", overflow: "hidden", position: "relative" }}>
                            <div style={{ transform: `scale(${(isMobile ? 80 : 110) / VIRTUAL_W})`, transformOrigin: "top left", width: VIRTUAL_W, height: VIRTUAL_H, pointerEvents: "none" }}>
                              <SlideContent slide={alt.slide} index={slideIndex} total={slides.length} branding={branding} />
                            </div>
                          </div>
                          <div style={{ padding: "2px 4px", textAlign: "center" }}>
                            <span style={{ fontSize: 9 }}>{d.emoji}</span>
                            <span style={{ fontFamily: FONT.mono, fontSize: 9, color: isApplied ? T.accent : T.textMuted, marginLeft: 2, fontWeight: isApplied ? 700 : 400 }}>{isApplied ? "applied ✓" : d.label}</span>
                          </div>
                        </>
                      ) : failed ? (
                        <div style={{ aspectRatio: "16/9", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.red }}>✕</span>
                        </div>
                      ) : (
                        <div style={{ aspectRatio: "16/9", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <span style={{ fontSize: 13, animation: "pulse 1.5s ease-in-out infinite", display: "inline-block" }}>{d.emoji}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>}
          </div>
        )}

        {/* ── DIALOG ZONE — all slide dialogs render here ──── */}
        {slides.length > 0 && (showQuickEdit || showNewSlide || showTimingScope || estimating || quickEditing || newSlideGenerating) && <div style={{ flexShrink: 0, borderTop: `1px solid ${T.border}`, background: T.bgPanel, padding: "8px 12px", maxHeight: 220, overflowY: "auto" }}>
          {/* Quick Edit */}
          {showQuickEdit && !quickEditing && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontFamily: FONT.mono, fontSize: 10, fontWeight: 700, color: T.accent, letterSpacing: "0.05em" }}>✏️ QUICK EDIT</span>
              {quickEditImage && <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.green }}>📎 img</span>}
              <button onClick={() => { setShowQuickEdit(false); setQuickEditImage(null); }} style={{ marginLeft: "auto", background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 13, padding: 0 }}>✕</button>
            </div>
            <textarea autoFocus value={quickEditPrompt} onChange={(e) => setQuickEditPrompt(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && !e.shiftKey && quickEditPrompt.trim()) { e.preventDefault(); runQuickEdit(); } if (e.key === "Escape") { setShowQuickEdit(false); setQuickEditImage(null); } }} onPaste={(e) => { const items = e.clipboardData?.items; if (!items) return; for (const item of items) { if (item.type.startsWith("image/")) { e.preventDefault(); e.stopPropagation(); const file = item.getAsFile(); const reader = new FileReader(); reader.onload = () => { setQuickEditImage({ base64: reader.result.split(",")[1], preview: reader.result }); }; reader.readAsDataURL(file); break; } } }} placeholder={"What to change? (paste image)\nE.g.: Add bullet, change colors"} style={{ ...S.input({ fontSize: 13 }), minHeight: 44, maxHeight: 80, resize: "vertical", lineHeight: 1.4, background: T.bg }} />
            {quickEditImage && <div style={{ display: "flex", alignItems: "center", gap: 6 }}><img src={quickEditImage.preview} alt="ref" style={{ height: 28, borderRadius: 4, border: `1px solid ${T.border}`, objectFit: "cover" }} /><button onClick={() => setQuickEditImage(null)} style={S.btn({ fontSize: 9, color: T.red, padding: "1px 5px" })}>✕</button></div>}
            <button onClick={runQuickEdit} disabled={!aiOk || !quickEditPrompt.trim()} title={!aiOk ? VELA_AI_UNAVAILABLE_MSG : undefined} style={S.primaryBtn({ padding: "5px 14px", fontSize: 13, width: "100%", opacity: aiOk && quickEditPrompt.trim() ? 1 : 0.4 })}>{aiOk ? "Apply edit" : "AI not enabled"}</button>
          </div>}
          {/* New Slide */}
          {showNewSlide && !newSlideGenerating && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontFamily: FONT.mono, fontSize: 10, fontWeight: 700, color: T.green, letterSpacing: "0.05em" }}>+ NEW SLIDE</span>
              {newSlideImage && <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.green }}>📎 img</span>}
              <button onClick={() => { setShowNewSlide(false); setNewSlideImage(null); }} style={{ marginLeft: "auto", background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 13, padding: 0 }}>✕</button>
            </div>
            <textarea autoFocus value={newSlidePrompt} onChange={(e) => setNewSlidePrompt(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && !e.shiftKey && newSlidePrompt.trim()) { e.preventDefault(); runNewSlide(); } if (e.key === "Escape") { setShowNewSlide(false); setNewSlideImage(null); } }} onPaste={(e) => { const items = e.clipboardData?.items; if (!items) return; for (const item of items) { if (item.type.startsWith("image/")) { e.preventDefault(); e.stopPropagation(); const file = item.getAsFile(); const reader = new FileReader(); reader.onload = () => { setNewSlideImage({ base64: reader.result.split(",")[1], preview: reader.result }); }; reader.readAsDataURL(file); break; } } }} placeholder={"Describe the slide... (paste image)"} style={{ ...S.input({ fontSize: 13 }), minHeight: 44, maxHeight: 80, resize: "vertical", lineHeight: 1.4, background: T.bg }} />
            {newSlideImage && <div style={{ display: "flex", alignItems: "center", gap: 6 }}><img src={newSlideImage.preview} alt="ref" style={{ height: 28, borderRadius: 4, border: `1px solid ${T.border}`, objectFit: "cover" }} /><button onClick={() => setNewSlideImage(null)} style={S.btn({ fontSize: 9, color: T.red, padding: "1px 5px" })}>✕</button></div>}
            <button onClick={runNewSlide} disabled={!aiOk || !newSlidePrompt.trim()} title={!aiOk ? VELA_AI_UNAVAILABLE_MSG : undefined} style={S.primaryBtn({ padding: "5px 14px", fontSize: 13, width: "100%", opacity: aiOk && newSlidePrompt.trim() ? 1 : 0.4 })}>{aiOk ? "Generate slide" : "AI not enabled"}</button>
          </div>}
          {/* Timing */}
          {showTimingScope && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontFamily: FONT.mono, fontSize: 10, fontWeight: 700, color: T.amber, letterSpacing: "0.05em" }}>⏱ TIMING</span>
              <button onClick={() => setShowTimingScope(false)} style={{ marginLeft: "auto", background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 13, padding: 0 }}>✕</button>
            </div>
            <ScopeSelector icon="⏱" scope={timingScope} setScope={setTimingScope} concept={concept} slideIndex={slideIndex} slides={slides} currentLane={currentLane} lanes={lanes} isMobile={isMobile}>
              <button onClick={runEstimate} disabled={!aiOk} title={!aiOk ? VELA_AI_UNAVAILABLE_MSG : undefined} style={S.primaryBtn({ padding: "5px 14px", marginLeft: 4, flexShrink: 0, opacity: aiOk ? 1 : 0.4 })}>Estimate</button>
            </ScopeSelector>
          </div>}
          {/* Estimating progress */}
          {estimating && <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, animation: estimating.error ? "none" : "spin 1.5s linear infinite", display: "inline-block" }}>{estimating.error ? "⚠️" : "⏱"}</span>
            <span style={{ fontFamily: FONT.mono, fontSize: 13, color: estimating.error ? T.red : T.amber, fontWeight: 600, flex: 1 }}>{estimating.status}</span>
            {!estimating.error && <div style={{ width: 80, height: 3, background: T.border, borderRadius: 2, overflow: "hidden" }}><div style={{ height: "100%", background: T.amber, borderRadius: 2, width: `${(estimating.current / estimating.total) * 100}%`, transition: "width 0.3s" }} /></div>}
            {!estimating.error && <button onClick={() => { estimateCancelRef.current = true; setEstimating(null); }} style={S.btn({ padding: "2px 8px", fontSize: 10, color: T.amber })}>stop</button>}
          </div>}
          {/* Generating spinner */}
          {(quickEditing || newSlideGenerating) && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
            <span style={{ fontSize: 14, animation: "spin 1.5s linear infinite", display: "inline-block" }}>✨</span>
            <span style={{ fontFamily: FONT.mono, fontSize: 13, color: T.accent }}>{quickEditing ? "Editing slide..." : "Generating slide..."}</span>
          </div>}
        </div>}

        {/* ── SLIDE TOOLBAR — centered strip between preview & notes ── */}
        {slides.length > 0 && <div data-testid="slide-toolbar" style={{ flexShrink: 0, borderTop: `1px solid ${T.border}`, background: T.bgPanel, padding: "4px 12px", display: "flex", justifyContent: "center", alignItems: "center", gap: 3 }}>
          <button onClick={() => { if (aiOk) setShowQuickEdit((v) => !v); }} disabled={!aiOk} title={aiOk ? "AI Edit slide (E)" : VELA_AI_UNAVAILABLE_MSG} style={S.btn({ padding: "5px 12px", fontSize: 14, color: !aiOk ? T.textDim + "60" : showQuickEdit ? T.accent : T.textDim, background: showQuickEdit ? T.accent + "20" : "transparent", borderRadius: 4, display: "flex", alignItems: "center", gap: 5, cursor: aiOk ? "pointer" : "not-allowed" })}>⚡{!isMobile && <span style={{ fontSize: 13, fontFamily: FONT.mono }}>AI Edit</span>}</button>
          <button onClick={() => improving ? stopAll() : runImproveRef.current?.(null, "slide")} disabled={!aiOk || slides.length === 0 || altLoading} title={aiOk ? "Auto-improve this slide (⇧I)" : VELA_AI_UNAVAILABLE_MSG} style={S.btn({ padding: "5px 12px", fontSize: 14, color: !aiOk ? T.textDim + "60" : improving ? T.red : T.textDim, background: improving ? T.accent + "20" : "transparent", borderRadius: 4, display: "flex", alignItems: "center", gap: 5, opacity: !aiOk || slides.length === 0 ? 0.35 : 1, cursor: aiOk ? "pointer" : "not-allowed" })}>{improving ? "⏹" : "✨"}{!isMobile && <span style={{ fontSize: 13, fontFamily: FONT.mono }}>{improving ? "Stop" : "Improve"}</span>}</button>
          <button onClick={() => altLoading ? stopAlternatives() : runAlternatives()} disabled={!aiOk || slides.length === 0 || improving} title={aiOk ? "Generate design variants — click a tile to apply, ↩ Original to revert, Esc to close" : VELA_AI_UNAVAILABLE_MSG} style={S.btn({ padding: "5px 12px", fontSize: 14, color: !aiOk ? T.textDim + "60" : altLoading ? T.red : (alternatives ? T.accent : T.textDim), background: altLoading || alternatives ? T.accent + "20" : "transparent", borderRadius: 4, display: "flex", alignItems: "center", gap: 5, opacity: !aiOk || slides.length === 0 ? 0.35 : 1, cursor: aiOk ? "pointer" : "not-allowed" })}>{altLoading ? "⏹" : "🎲"}{!isMobile && <span style={{ fontSize: 13, fontFamily: FONT.mono }}>{altLoading ? "Stop" : "Variants"}</span>}</button>
          <div style={{ width: 1, height: 22, background: T.border + "60" }} />
          <button onClick={() => { setShowNewSlide((v) => !v); setShowQuickEdit(false); }} title="New slide (N)" style={S.btn({ padding: "5px 12px", fontSize: 14, color: showNewSlide ? T.green : T.textDim, background: showNewSlide ? T.green + "20" : "transparent", borderRadius: 4, display: "flex", alignItems: "center", gap: 5 })}>+{!isMobile && <span style={{ fontSize: 13, fontFamily: FONT.mono }}>New</span>}</button>
          <button onClick={() => { dispatch({ type: "DUPLICATE_SLIDE", id: concept.id, index: slideIndex }); dispatch({ type: "SET_SLIDE_INDEX", index: slideIndex + 1 }); }} title="Duplicate slide" style={S.btn({ padding: "5px 12px", fontSize: 14, color: T.textDim, borderRadius: 4, display: "flex", alignItems: "center", gap: 5 })}>📋{!isMobile && <span style={{ fontSize: 13, fontFamily: FONT.mono }}>Duplicate</span>}</button>
          <button ref={moveRef} onClick={() => setShowMoveToModule((v) => !v)} title="Move to module" style={S.btn({ padding: "5px 12px", fontSize: 14, color: showMoveToModule ? T.accent : T.textDim, background: showMoveToModule ? T.accent + "20" : "transparent", borderRadius: 4, display: "flex", alignItems: "center", gap: 5 })}>📦{!isMobile && <span style={{ fontSize: 13, fontFamily: FONT.mono }}>Move</span>}</button>
          <button onClick={() => { dispatch({ type: "REMOVE_SLIDE", id: concept.id, index: slideIndex }); dispatch({ type: "SET_SLIDE_INDEX", index: Math.max(0, slideIndex - 1) }); }} title="Delete slide (Del)" style={S.btn({ padding: "5px 12px", fontSize: 14, color: T.red + "90", borderRadius: 4, display: "flex", alignItems: "center", gap: 5 })}>🗑{!isMobile && <span style={{ fontSize: 13, fontFamily: FONT.mono }}>Delete</span>}</button>
          <div style={{ width: 1, height: 22, background: T.border + "60" }} />
          <button data-testid="editor-gallery-toggle" onClick={() => setGallery((v) => !v)} title="Overview — all slides (G)" style={S.btn({ padding: "5px 12px", fontSize: 14, color: showGallery ? T.accent : T.textDim, background: showGallery ? T.accent + "20" : "transparent", borderRadius: 4, display: "flex", alignItems: "center", gap: 5 })}>🗂{!isMobile && <span style={{ fontSize: 13, fontFamily: FONT.mono }}>Overview</span>}</button>
        </div>}

        {/* ── NOTES BAR ──────────────────────────────────────── */}
        {slides.length > 0 && (() => {
          const curSlide = slides[slideIndex];
          const hasNotes = curSlide?.notes?.trim();
          // CR3: do NOT auto-expand the notes textarea just because a slide has
          // notes — that made the notes bar a per-slide height changer, shrinking
          // the elastic preview and pushing the slide toolbar (AI Edit / Improve)
          // out of view when switching slides. The NOTES header stays a constant
          // height for every slide (accent-coloured when notes exist); the user
          // clicks it to reveal/edit. Keeps the toolbar position stable.
          const notesOpen = showNotes;
          return <div style={{ flexShrink: 0, borderTop: `1px solid ${T.border}`, background: T.bgPanel }}>
            <div onClick={() => setShowNotes((v) => !v)} style={{ padding: "3px 12px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <span style={{ fontSize: 10 }}>📝</span>
              <span style={{ fontFamily: FONT.mono, fontSize: 9, fontWeight: 600, color: hasNotes ? T.accent : T.textDim, letterSpacing: "0.05em" }}>NOTES</span>
              {curSlide && (curSlide.duration > 0 || editingDuration) && <span style={{ display: "inline-flex", alignItems: "center", gap: 0, fontFamily: FONT.mono, fontSize: 9 }}>{editingDuration ? <input autoFocus type="number" min="5" max="3600" defaultValue={curSlide.duration || 60} onBlur={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) handleSlideEdit({ duration: Math.max(5, Math.min(3600, v)) }); setEditingDuration(false); }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") setEditingDuration(false); }} onClick={(e) => e.stopPropagation()} style={{ width: 48, padding: "1px 4px", fontSize: 9, fontFamily: FONT.mono, background: T.bg, color: T.text, border: `1px solid ${T.accent}`, borderRadius: 3, outline: "none", textAlign: "center" }} /> : <span onClick={(e) => { e.stopPropagation(); setEditingDuration(true); }} style={{ color: curSlide.timeLock ? T.amber : T.accent, background: (curSlide.timeLock ? T.amber : T.accent) + "15", padding: "1px 5px", borderRadius: curSlide.duration > 0 ? "3px 0 0 3px" : 3, cursor: "pointer" }} title="Click to edit duration">⏱ {curSlide.duration > 0 ? fmtTime(curSlide.duration) : "set"}</span>}{!editingDuration && curSlide.duration > 0 && <span onClick={(e) => { e.stopPropagation(); handleSlideEdit({ timeLock: !curSlide.timeLock }); }} style={{ color: curSlide.timeLock ? T.amber : T.textDim, background: (curSlide.timeLock ? T.amber : T.accent) + "10", padding: "1px 4px", borderRadius: "0 3px 3px 0", cursor: "pointer", borderLeft: `1px solid ${T.border}` }} title={curSlide.timeLock ? "Locked" : "Lock from AI"}>{curSlide.timeLock ? "🔒" : "🔓"}</span>}</span>}
              {curSlide && !curSlide.duration && !editingDuration && <span onClick={(e) => { e.stopPropagation(); setEditingDuration(true); }} style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim, padding: "1px 5px", cursor: "pointer", opacity: 0.6 }}>⏱ set</span>}
              <span style={{ marginLeft: "auto", fontSize: 9, color: T.textDim }}>{notesOpen ? "▾" : "▸"}</span>
            </div>
            {notesOpen && <textarea id="vela-notes-area" autoFocus={!hasNotes && showNotes} value={curSlide.notes || ""} onChange={(e) => handleSlideEdit({ notes: e.target.value })} onKeyDown={(e) => e.stopPropagation()} placeholder="Speaker notes, timing cues, demo instructions..." style={{ width: "100%", minHeight: 60, maxHeight: 200, padding: "6px 12px", fontSize: 13, fontFamily: FONT.body, background: T.bg, border: "none", borderTop: `1px solid ${T.border}`, color: T.textMuted, outline: "none", resize: "vertical", boxSizing: "border-box", lineHeight: 1.5 }} />}
          </div>;
        })()}
        {/* Move-to-module popover */}
        {showMoveToModule && (() => { const allMods = []; for (const l of lanes) for (const it of l.items) if (it.id !== concept.id) allMods.push({ id: it.id, title: it.title, lane: l.title }); const rect = moveRef.current?.getBoundingClientRect(); const popH = Math.min(300, allMods.length * 32 + 72); const flipUp = rect && (rect.bottom + popH + 8 > window.innerHeight); const top = rect ? (flipUp ? Math.max(8, rect.top - popH - 4) : rect.bottom + 4) : 40; const left = rect ? Math.max(8, Math.min(rect.left, window.innerWidth - 220)) : 8; return <><div onClick={() => setShowMoveToModule(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} /><div data-testid="move-picker" style={{ position: "fixed", top, left, background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 8, padding: 4, zIndex: 9999, boxShadow: "0 4px 20px rgba(0,0,0,0.5)" }}><SectionPicker mods={allMods} emptyLabel="No other modules" onPick={(toId, e) => { dispatch({ type: "MOVE_SLIDE_TO_MODULE", fromId: concept.id, toId, index: slideIndex }); if (e && (e.ctrlKey || e.metaKey)) { const remaining = slides.length - 1; if (slideIndex < remaining) { dispatch({ type: "SELECT", id: concept.id, slideIndex }); } else { const flat = []; for (const l of lanes) for (const it of l.items) flat.push(it); const pos = flat.findIndex((it) => it.id === concept.id); const nextMod = pos >= 0 ? flat[pos + 1] : null; if (nextMod) dispatch({ type: "SELECT", id: nextMod.id, slideIndex: 0 }); else if (remaining > 0) dispatch({ type: "SELECT", id: concept.id, slideIndex: remaining - 1 }); } } setShowMoveToModule(false); }} /></div></>; })()}
      </div>
      {showGallery && <GalleryView lanes={lanes} currentConceptId={concept.id} slideIndex={slideIndex} dispatch={dispatch} onClose={() => setGallery(false)} branding={branding} />}
    </div>
  );
}


