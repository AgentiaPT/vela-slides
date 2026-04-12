// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
// ━━━ Slide Panel ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const VIRTUAL_W = 960, VIRTUAL_H = 540;

const PREVIEW_RATIOS = [
  { id: "16:9", label: "16:9", w: 1920, h: 1080 },
  { id: "1:1", label: "1:1", w: 1080, h: 1080 },
  { id: "4:5", label: "4:5", w: 1080, h: 1350 },
  { id: "auto", label: "Fit", w: null, h: null },
];

// Same zoom calculation as PDF export — keeps text optically consistent across ratios
function computeVirtualDims(ratioId) {
  if (ratioId === "auto") return { vw: VIRTUAL_W, vh: VIRTUAL_H, isAuto: true };
  const r = PREVIEW_RATIOS.find((p) => p.id === ratioId) || PREVIEW_RATIOS[0];
  const rh0 = Math.round(VIRTUAL_W * (r.h / r.w));
  const heightRatio = rh0 / VIRTUAL_H;
  const zoom = heightRatio <= 1.05 ? 1 : Math.pow(heightRatio, 0.45);
  return { vw: Math.round(VIRTUAL_W / zoom), vh: Math.round(rh0 / zoom), isAuto: false };
}

function loadHtml2Canvas() {
  return new Promise((resolve) => {
    if (window.html2canvas) { resolve(window.html2canvas); return; }
    if (!window._h2cLoading) {
      window._h2cLoading = true;
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
      s.onload = () => { window._h2cLoaded = true; resolve(window.html2canvas); };
      document.head.appendChild(s);
    } else {
      const check = setInterval(() => { if (window.html2canvas) { clearInterval(check); resolve(window.html2canvas); } }, 50);
    }
  });
}

// Optimized slide capture: tiny thumbnail (192×108) at aggressive JPEG compression
// All sizes ≤768px = 1 API tile = 170 tokens regardless, so we minimize payload (~1KB vs ~25KB)
async function captureSlide(el, h2c) {
  const raw = await h2c(el, { useCORS: true, scale: 0.25, backgroundColor: null, logging: false });
  // Downscale to 192×108 for minimum payload
  const MAX_W = 192;
  const ratio = Math.min(1, MAX_W / raw.width);
  const w = Math.round(raw.width * ratio), h = Math.round(raw.height * ratio);
  const small = document.createElement("canvas");
  small.width = w; small.height = h;
  const ctx = small.getContext("2d");
  ctx.drawImage(raw, 0, 0, w, h);
  const dataUrl = small.toDataURL("image/jpeg", 0.15);
  return dataUrl.replace(/^data:image\/\w+;base64,/, "");
}

// ━━━ Slide Layout Stats (DOM-measured) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Measures the rendered slide DOM to give AI structured visual context
// without screenshots. Returns a compact text report.
function computeSlideLayoutStats(slideEl) {
  if (!slideEl) return null;
  try {
    const canvasW = slideEl.offsetWidth || VIRTUAL_W;
    const canvasH = slideEl.offsetHeight || VIRTUAL_H;
    // Get all direct children (blocks)
    const children = Array.from(slideEl.children);
    if (children.length === 0) return null;
    // Find the content container (usually first child with blocks)
    let contentEl = slideEl;
    // If there's a single wrapper div, look inside it
    if (children.length === 1 && children[0].children.length > 0) contentEl = children[0];
    const blocks = Array.from(contentEl.children);
    if (blocks.length === 0) return null;

    // Measure each block
    const blockStats = [];
    let totalContentH = 0;
    let lastBlockBottom = 0;
    for (const block of blocks) {
      const rect = block.getBoundingClientRect();
      const parentRect = contentEl.getBoundingClientRect();
      const relTop = rect.top - parentRect.top;
      const relBottom = relTop + rect.height;
      const h = Math.round(rect.height);
      if (h <= 0) continue;
      // Try to identify block type from data attributes or class
      const type = block.dataset?.blockType || block.className?.split(" ")[0] || "unknown";
      const text = (block.textContent || "").slice(0, 30).trim();
      blockStats.push({ type, h, top: Math.round(relTop), text });
      totalContentH += h;
      if (relBottom > lastBlockBottom) lastBlockBottom = relBottom;
    }

    const fillPct = Math.round((lastBlockBottom / canvasH) * 100);
    const blankPct = 100 - fillPct;
    const overflow = lastBlockBottom > canvasH;

    // Vertical distribution: where is the content mass?
    const midpoint = canvasH / 2;
    let topWeight = 0, bottomWeight = 0;
    for (const b of blockStats) {
      const center = b.top + b.h / 2;
      if (center < midpoint) topWeight += b.h; else bottomWeight += b.h;
    }
    const distribution = topWeight > bottomWeight * 2 ? "top-heavy" : bottomWeight > topWeight * 2 ? "bottom-heavy" : "balanced";

    // Build compact report
    const lines = [
      `Canvas: ${canvasW}×${canvasH}px | Content: ${Math.round(lastBlockBottom)}px (${fillPct}% fill) | Blank: ${blankPct}% | ${overflow ? "⚠ OVERFLOW" : "OK"}`,
      `Distribution: ${distribution} | Blocks: ${blockStats.length}`,
      `Heights: ${blockStats.map((b) => `${b.type}:${b.h}px`).join(", ")}`,
    ];
    return lines.join("\n");
  } catch (e) {
    dbg("Layout stats error:", e);
    return null;
  }
}

// ━━━ Virtual Slide ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function VirtualSlide({ slide, index, total, innerRef, branding, editable, onEdit, mode = "fit-width", onBlockEdit, blockEditing, fontScale, virtualW, virtualH, bordered, reviewMode, itemId, dispatch: externalDispatch, displayIndex, displayTotal }) {
  const outerRef = useRef(null);
  const isFill = mode === "fill";

  // Compute fill dims eagerly from window size to avoid first-frame 16:9 flash
  // (fullscreen container is position:fixed inset:0, so window size = container size)
  const computeFillDims = (cw, ch) => {
    if (!cw || !ch) return null;
    const containerRatio = ch / cw;
    const rh0 = Math.round(VIRTUAL_W * containerRatio);
    const heightRatio = rh0 / VIRTUAL_H;
    const zoom = heightRatio <= 1.05 ? 1 : Math.pow(heightRatio, 0.45);
    return { vw: Math.round(VIRTUAL_W / zoom), vh: Math.round(rh0 / zoom) };
  };

  const initialFill = isFill ? computeFillDims(window.innerWidth, window.innerHeight) : null;
  const initialScale = initialFill ? Math.min(window.innerWidth / initialFill.vw, window.innerHeight / initialFill.vh) : 1;
  const initialOffset = initialFill ? { x: (window.innerWidth - initialFill.vw * initialScale) / 2, y: (window.innerHeight - initialFill.vh * initialScale) / 2 } : { x: 0, y: 0 };
  const [scale, setScale] = useState(initialScale);
  const [offset, setOffset] = useState(initialOffset);
  const [fillDims, setFillDims] = useState(initialFill);

  const vw = isFill ? (fillDims?.vw || VIRTUAL_W) : (virtualW || VIRTUAL_W);
  const vh = isFill ? (fillDims?.vh || VIRTUAL_H) : (virtualH || VIRTUAL_H);

  // useLayoutEffect ensures fill dims are calculated BEFORE first paint
  // (useEffect would cause a 16:9 flash on the first slide in fill mode)
  useLayoutEffect(() => {
    const el = outerRef.current; if (!el) return;
    const calc = () => {
      const cw = el.clientWidth, ch = el.clientHeight;
      if (isFill && cw > 0 && ch > 0) {
        const fd = computeFillDims(cw, ch);
        if (fd) {
          setFillDims(fd);
          const sw = cw / fd.vw, sh = ch / fd.vh;
          const s = Math.min(sw, sh);
          setScale(s);
          setOffset({ x: (cw - fd.vw * s) / 2, y: (ch - fd.vh * s) / 2 });
        }
      } else if (mode === "fit-viewport") {
        const sw = cw / vw, sh = ch / vh;
        const s = Math.min(sw, sh);
        setScale(s);
        setOffset({ x: (cw - vw * s) / 2, y: (ch - vh * s) / 2 });
      } else {
        setScale(cw / vw);
        setOffset({ x: 0, y: 0 });
      }
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el); return () => ro.disconnect();
  }, [mode, vw, vh, isFill]);

  const bg = slide?.bg || slide?.bgGradient || T.slideBg;
  const isFullscreen = mode === "fit-viewport" || isFill;
  const aspectRatio = `${vw}/${vh}`;

  return (
    <div ref={outerRef} style={isFullscreen
      ? bordered || isFill
        ? { position: "absolute", inset: 0, background: bg, overflow: "hidden", borderRadius: 6, border: `1px solid ${T.border}` }
        : { position: "absolute", inset: 0, background: bg, overflow: "hidden" }
      : { width: "100%", aspectRatio, position: "relative", overflow: "hidden", borderRadius: 6, border: `1px solid ${T.border}` }}>
      <div ref={innerRef} style={{
        width: vw, height: vh,
        transform: isFullscreen ? `translate(${offset.x}px, ${offset.y}px) scale(${scale})` : `scale(${scale})`,
        transformOrigin: "top left", background: bg, position: "absolute", top: 0, left: 0,
      }}>
        {slide && <SlideContent key={`${index}-${vw}-${vh}`} slide={slide} index={index} total={total} branding={branding} editable={editable} onEdit={onEdit} presenting={(mode === "fit-viewport" || isFill) && !bordered} onBlockEdit={onBlockEdit} blockEditing={blockEditing} fontScale={fontScale} reviewMode={reviewMode} itemId={itemId} dispatch={externalDispatch} displayIndex={displayIndex} displayTotal={displayTotal} />}
      </div>
    </div>
  );
}

// Convenience aliases for readability
function FullscreenSlide({ mode, ...props }) { return <VirtualSlide {...props} mode={mode || "fit-viewport"} />; }

// ━━━ Scope Selector (shared by improve + timing) ━━━━━━━━━━━━━━━━━━
function ScopeSelector({ icon, scope, setScope, concept, slideIndex, slides, currentLane, lanes, isMobile, children }) {
  const scopeOptions = [
    { key: "slide", label: `Slide ${slideIndex + 1}`, count: 1 },
    { key: "module", label: isMobile ? concept.title.slice(0, 12) + (concept.title.length > 12 ? "…" : "") : concept.title, count: slides.length },
    { key: "section", label: isMobile ? "Section" : (currentLane?.title || "Section"), count: currentLane?.items.reduce((s, i) => s + (i.slides?.length || 0), 0) || 0 },
    { key: "all", label: "All", count: lanes.reduce((s, l) => s + l.items.reduce((s2, i) => s2 + (i.slides?.length || 0), 0), 0) },
  ];
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: isMobile ? "nowrap" : "wrap", overflowX: isMobile ? "auto" : "visible", WebkitOverflowScrolling: "touch" }}>
      <span style={{ fontSize: 14, flexShrink: 0 }}>{icon}</span>
      {scopeOptions.map((s) => <button key={s.key} onClick={() => setScope(s.key)} style={S.btn({ padding: "2px 8px", fontSize: 9, background: scope === s.key ? T.accent : "transparent", color: scope === s.key ? "#fff" : T.textDim, border: `1px solid ${scope === s.key ? T.accent : T.border}`, flexShrink: 0, whiteSpace: "nowrap" })}>{s.label} <span style={{ opacity: 0.6 }}>({s.count})</span></button>)}
      {children}
    </div>
  );
}
function BrandingPanel({ branding, guidelines, dispatch, isMobile }) {
  const b = branding || defaultBranding;
  const [guidelinesOpen, setGuidelinesOpen] = useState(!!guidelines?.trim());
  const set = (patch) => {
    dispatch({ type: "SET_BRANDING", branding: patch });
    // Auto-enable when any branding value is set
    if (!b.enabled && Object.keys(patch).some(k => k !== "enabled" && patch[k])) {
      dispatch({ type: "SET_BRANDING", branding: { enabled: true } });
    }
  };
  const logoInputRef = useRef(null);

  const handleLogo = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      set({ logo: reader.result });
    };
    reader.readAsDataURL(file);
  };

  const row = { display: "flex", alignItems: "center", gap: isMobile ? 4 : 8, marginBottom: 6, flexWrap: isMobile ? "wrap" : "nowrap" };
  const lbl = { fontFamily: FONT.mono, fontSize: 9, color: T.textDim, width: isMobile ? 40 : 52, flexShrink: 0, textTransform: "uppercase", letterSpacing: "0.03em" };
  const inp = (extra = {}) => ({ flex: 1, padding: "3px 6px", fontSize: 10, fontFamily: FONT.body, background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 3, color: T.text, outline: "none", minWidth: 0, ...extra });

  return (
    <div style={{ padding: "8px 12px", borderBottom: `1px solid ${T.border}`, background: T.accent + "08" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13 }}>🎨</span>
          <span style={{ fontFamily: FONT.mono, fontSize: 10, fontWeight: 700, color: T.accent }}>BRANDING</span>
        </div>
        <span style={{ fontFamily: FONT.mono, fontSize: 9, color: b.enabled ? T.accent : T.textDim }}>{b.enabled ? "● Active" : "○ Set values to activate"}</span>
      </div>
        <div style={row}>
          <span style={lbl}>Header</span>
          <input type="color" value={b.accentColor || "#3B82F6"} onChange={(e) => set({ accentColor: e.target.value })} style={{ width: 22, height: 18, border: "none", padding: 0, cursor: "pointer", background: "transparent" }} />
          <input type="range" min="0" max="8" value={b.accentHeight || 4} onChange={(e) => set({ accentHeight: parseInt(e.target.value) })} style={{ width: 50 }} />
          <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim }}>{b.accentHeight}px</span>
        </div>
        <div style={row}>
          <span style={lbl}>Logo</span>
          <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogo} style={{ display: "none" }} />
          {b.logo ? <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <img src={b.logo} style={{ height: 18, objectFit: "contain", borderRadius: 2 }} />
            <button onClick={() => set({ logo: null })} style={{ background: "none", border: "none", color: T.red, cursor: "pointer", fontSize: 10, padding: 0 }}>×</button>
          </div> : <button onClick={() => logoInputRef.current?.click()} style={S.btn({ padding: "2px 8px", fontSize: 9 })}>Upload</button>}
        </div>
        {b.logo && <>
          <div style={row}>
            <span style={lbl}>Corner</span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, width: 52, flexShrink: 0 }}>
              {["top-left", "top-right", "bottom-left", "bottom-right"].map(pos => {
                const active = (b.logoPosition || "top-left") === pos;
                return <button key={pos} onClick={() => set({ logoPosition: pos })} title={pos} style={{
                  width: 24, height: 18, borderRadius: 3, border: `1.5px solid ${active ? T.accent : T.border}`,
                  background: active ? T.accent + "30" : "transparent", cursor: "pointer", position: "relative", padding: 0,
                }}><div style={{
                  width: 6, height: 6, borderRadius: 1, background: active ? T.accent : T.textDim,
                  position: "absolute",
                  top: pos.startsWith("top") ? 3 : undefined,
                  bottom: pos.startsWith("bottom") ? 3 : undefined,
                  left: pos.endsWith("left") ? 4 : undefined,
                  right: pos.endsWith("right") ? 4 : undefined,
                }} /></button>;
              })}
            </div>
            <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim }}>{b.logoPosition || "top-left"}</span>
          </div>
          <div style={row}>
            <span style={lbl}>Size</span>
            <input type="range" min="20" max="120" step="2" value={b.logoSize || 56} onChange={(e) => set({ logoSize: parseInt(e.target.value) })} style={{ flex: 1 }} />
            <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim, width: 30, textAlign: "right" }}>{b.logoSize || 56}px</span>
          </div>
        </>}
        <div style={row}>
          <span style={lbl}>Left</span>
          <input value={b.footerLeft || ""} onChange={(e) => set({ footerLeft: e.target.value })} placeholder="Name / Company" style={inp()} />
        </div>
        <div style={row}>
          <span style={lbl}>Center</span>
          <input value={b.footerCenter || ""} onChange={(e) => set({ footerCenter: e.target.value })} placeholder="Tagline" style={inp()} />
        </div>
        <div style={row}>
          <span style={lbl}>Right</span>
          <input value={b.footerRight === "auto" ? "" : (b.footerRight || "")} onChange={(e) => set({ footerRight: e.target.value || "auto" })} placeholder="auto (slide #)" style={inp()} />
        </div>
        <div style={row}>
          <span style={lbl}>Colors</span>
          <input type="color" value={b.footerBg?.startsWith("rgba") ? "#000000" : (b.footerBg || "#000000")} onChange={(e) => set({ footerBg: e.target.value + "cc" })} title="Footer bg" style={{ width: 22, height: 18, border: "none", padding: 0, cursor: "pointer", background: "transparent" }} />
          <input type="color" value={b.footerColor || "#94a3b8"} onChange={(e) => set({ footerColor: e.target.value })} title="Footer text" style={{ width: 22, height: 18, border: "none", padding: 0, cursor: "pointer", background: "transparent" }} />
          <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim }}>bg / text</span>
        </div>
      <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 6, paddingTop: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <span style={{ fontSize: 10 }}>📦</span>
          <span style={{ fontFamily: FONT.mono, fontSize: 9, fontWeight: 600, color: T.textMuted }}>IMAGE COMPRESSION</span>
        </div>
        <div style={row}>
          <span style={lbl}>Max W</span>
          <input type="range" min="300" max="960" step="20" value={b.imgMaxWidth || 600} onChange={(e) => set({ imgMaxWidth: parseInt(e.target.value) })} style={{ flex: 1 }} />
          <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim, width: 30, textAlign: "right" }}>{b.imgMaxWidth || 600}px</span>
        </div>
        <div style={row}>
          <span style={lbl}>Quality</span>
          <input type="range" min="15" max="85" step="5" value={Math.round((b.imgQuality || 0.45) * 100)} onChange={(e) => set({ imgQuality: parseInt(e.target.value) / 100 })} style={{ flex: 1 }} />
          <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim, width: 30, textAlign: "right" }}>{Math.round((b.imgQuality || 0.45) * 100)}%</span>
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 6, paddingTop: 6 }}>
        <div onClick={() => setGuidelinesOpen(!guidelinesOpen)} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: guidelinesOpen ? 6 : 0, cursor: "pointer" }}>
          <span style={{ fontSize: 10 }}>📋</span>
          <span style={{ fontFamily: FONT.mono, fontSize: 9, fontWeight: 600, color: guidelines?.trim() ? T.accent : T.textMuted }}>SLIDE RULES</span>
          <span style={{ fontSize: 9, color: guidelines?.trim() ? T.accent : T.textDim, marginLeft: "auto" }}>{guidelinesOpen ? "▾" : "▸"}{guidelines?.trim() ? ` · active` : ""}</span>
        </div>
        {guidelinesOpen && <>
          <textarea
            value={guidelines || ""}
            onChange={(e) => dispatch({ type: "SET_GUIDELINES", guidelines: e.target.value.slice(0, 2000) })}
            placeholder={"Persistent rules applied to EVERY improve/alternatives call.\nE.g.:\n- Light/white slide backgrounds, dark text, good contrast\n- Max 4 bullets per slide\n- Always include icons\n- Audience is senior engineers"}
            style={{ width: "100%", minHeight: 72, maxHeight: 160, padding: "6px 8px", fontSize: 10, fontFamily: FONT.mono, background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 3, color: T.text, outline: "none", resize: "vertical", boxSizing: "border-box", lineHeight: 1.5 }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 3 }}>
            <span style={{ fontFamily: FONT.mono, fontSize: 9, color: (guidelines?.length || 0) > 1800 ? T.amber : T.textDim }}>{guidelines?.length || 0} / 2000</span>
            {guidelines?.trim() && <button onClick={() => dispatch({ type: "SET_GUIDELINES", guidelines: "" })} style={S.btn({ padding: "1px 6px", fontSize: 9 })}>Clear</button>}
          </div>
        </>}
      </div>
    </div>
  );
}

// ━━━ Cinema Tip — bookmarklet helper for browser fullscreen in artifacts ━━━
const CINEMA_BOOKMARKLET = 'javascript:void(document.querySelector(\'iframe[class="h-full w-full"]\').requestFullscreen())';
function CinemaTip({ onClose }) {
  const copyCode = () => { try { velaClipboard(CINEMA_BOOKMARKLET); } catch(_) {} onClose(); };
  return (
    <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: 50, right: 16, zIndex: 30, width: 280, background: "rgba(15,23,42,0.96)", border: `1px solid ${T.accent}40`, borderRadius: 10, padding: "14px 16px", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", backdropFilter: "blur(12px)" }}>
      <div style={{ fontFamily: FONT.mono, fontSize: 13, fontWeight: 700, color: T.accent, marginBottom: 8 }}>{"⛵"} Cinema Mode</div>
      <div style={{ fontFamily: FONT.body, fontSize: 13, color: T.textMuted, lineHeight: 1.5, marginBottom: 10 }}>Go fullscreen in your browser. One-time setup — create a bookmark with this code as the URL:</div>
      <button onClick={copyCode} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: T.accent + "20", border: `1px solid ${T.accent}50`, borderRadius: 6, fontFamily: FONT.mono, fontSize: 13, fontWeight: 700, color: T.accent, cursor: "pointer", width: "100%" }}>{"📋"} Copy Bookmarklet Code</button>
      <div style={{ fontFamily: FONT.body, fontSize: 10, color: T.textDim, marginTop: 8, lineHeight: 1.5 }}>Then: right-click bookmarks bar → Add bookmark → paste as URL → name it "Vela Cinema". Click it while presenting.</div>
      <button onClick={onClose} style={{ position: "absolute", top: 8, right: 10, background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 14 }}>{"✕"}</button>
    </div>
  );
}

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
  useEffect(() => { if (!open) setSearch(""); }, [open]);

  useEffect(() => {
    const handler = (e) => {
      if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
      if (e.key === "t" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen((v) => { if (v) { setPinned(false); } else { setPinned(true); } return !v; });
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
        const itemSlides = (item.slides || []).map((s, i) => {
          const title = getSlideTitle(s, i);
          return { title, slideIdx: i, visible: !q || title.toLowerCase().includes(q) };
        });
        if (q && !itemSlides.some((s) => s.visible) && !item.title.toLowerCase().includes(q)) continue;
        groups.push({ id: item.id, title: item.title, laneTitle: lane.title, slides: itemSlides, isCurrent: item.id === currentConceptId });
      }
    }
    return groups;
  }, [lanes, search, currentConceptId]);

  // Count total visible slides for footer
  const totalSlides = useMemo(() => grouped.reduce((sum, g) => sum + g.slides.length, 0), [grouped]);
  const globalIndex = useMemo(() => {
    let idx = 0;
    for (const g of grouped) {
      if (g.isCurrent) return idx + slideIndex;
      idx += g.slides.length;
    }
    return idx;
  }, [grouped, slideIndex]);

  const activeRef = useRef(null);
  useEffect(() => { if (open) requestAnimationFrame(() => { activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }); }, [slideIndex, open, currentConceptId]);

  const handleJump = (moduleId, slideIdx) => {
    if (moduleId === currentConceptId) {
      onJump(slideIdx);
    } else {
      // Navigate to different module
      dispatch({ type: "SELECT", id: moduleId });
      dispatch({ type: "SET_SLIDE_INDEX", index: slideIdx });
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
          <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim }}>T</span>
        </div>

        {/* Search */}
        <div style={{ padding: "8px 12px", position: "relative" }}>
          <Search size={13} color={T.textDim} style={{ position: "absolute", left: 20, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") { if (search) setSearch(""); else { setOpen(false); setPinned(false); } }
            }}
            placeholder="Search slides..."
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
                const active = group.isCurrent && slideIdx === slideIndex;
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
          <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim }}>hover or T</span>
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
        <div style={{ position: "absolute", inset: 0, zIndex: 2, background: slide?.bg || T.slideBg, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, transition: "opacity 0.3s ease" }}>
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
        for (let si = 0; si < (item.slides || []).length; si++) {
          result.push({ slide: item.slides[si], itemId: item.id, slideIdx: si, moduleTitle: item.title, laneTitle: lane.title, isCurrent: item.id === currentConceptId && si === slideIndex });
        }
      }
    }
    return result;
  }, [lanes, currentConceptId, slideIndex]);

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
    for (const s of allSlides) counts[s.itemId] = (counts[s.itemId] || 0) + 1;
    let lastItemId = null;
    return allSlides.map((s) => {
      const isFirst = s.itemId !== lastItemId;
      lastItemId = s.itemId;
      return { ...s, isFirst, moduleCount: counts[s.itemId] };
    });
  }, [allSlides]);

  return (
    <div onClick={onClose} data-teacher-panel style={{ position: "fixed", inset: 0, zIndex: 10000, background: T.isDark ? "rgba(0,0,0,0.92)" : "rgba(241,245,249,0.96)", backdropFilter: "blur(8px)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ padding: "16px 24px", display: "flex", alignItems: "center", gap: 12, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <span style={{ fontSize: 18 }}>🗂</span>
        <span style={{ fontFamily: FONT.mono, fontSize: 14, fontWeight: 700, color: T.accent, letterSpacing: "0.05em" }}>GALLERY</span>
        <span style={{ fontFamily: FONT.mono, fontSize: 13, color: T.textMuted }}>{allSlides.length} slides</span>
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
            const cardKey = s.itemId + "|" + s.slideIdx;
            return (
              <div key={"s-" + cardKey} ref={(el) => { cardRefs.current[cardKey] = el; if (isCurrent && el) activeRef.current = el; }}
                onMouseDown={(e) => handleMouseDown(e, s)}
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
                  <GalleryThumb slide={s.slide} slideIdx={s.slideIdx} total={allSlides.length} branding={branding} />
                  <div style={{ padding: "6px 10px", background: isCurrent ? T.accent + "15" : T.isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontFamily: FONT.mono, fontSize: 10, color: isCurrent ? T.accent : T.textDim, fontWeight: 700 }}>{s.slideIdx + 1}</span>
                    {(() => { const oc = (s.slide.comments || []).filter((c) => c.status === "open").length; return oc > 0 ? <span style={{ width: 8, height: 8, borderRadius: 4, background: T.amber, flexShrink: 0 }} title={`${oc} comment${oc > 1 ? "s" : ""}`} /> : null; })()}
                    {s.slide?.studyNotes?.text ? <span title="Has offline study notes" data-study-marker style={{ fontSize: 11, lineHeight: 1, flexShrink: 0, filter: `drop-shadow(0 0 2px ${T.accent}80)` }}>🎓</span> : null}
                    <span style={{ fontSize: 13, color: isCurrent ? T.text : T.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, fontFamily: FONT.body }}>{getSlideTitle(s.slide, s.slideIdx)}</span>
                    <button onClick={(e) => { e.stopPropagation(); dispatch({ type: "REMOVE_SLIDE", id: s.itemId, index: s.slideIdx }); }} title="Delete slide" style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 4px", fontSize: 13, color: T.textDim, borderRadius: 3, opacity: 0.4, transition: "opacity 0.15s, color 0.15s" }} onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.color = "#ef4444"; }} onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.4"; e.currentTarget.style.color = T.textDim; }}>✕</button>
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

  // Embedded-first: live API is optional. Artifact mode assumes proxy reachable
  // (same signal callVeraTeacher uses — v12.16 routing).
  const apiAvailable = VELA_LOCAL_MODE ? !!VELA_CHANNEL_PORT : true;

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

function SlidePanel({ state, concept, slideIndex, fullscreen, dispatch, lanes, branding, guidelines, isMobile, fontScale, actionsRef, onRibbonUpdate }) {
  const slides = concept.slides || [];
  const slidesRef = useRef(slides);
  slidesRef.current = slides;

  // Virtual title card for presentation mode
  const presOffset = fullscreen && concept.presentCard ? 1 : 0;
  const titleCard = useMemo(() => {
    if (!concept.presentCard) return null;
    const lane = (lanes || []).find((l) => l.items.some((i) => i.id === concept.id));
    const slideCount = (concept.slides || []).length;
    const totalTime = (concept.slides || []).reduce((a, s) => a + (s.duration || 0), 0);
    const timeStr = totalTime > 0 ? `${Math.floor(totalTime / 60)}m ${totalTime % 60}s` : "";
    return {
      _virtual: true,
      bg: "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)",
      color: "#0f172a", accent: branding?.accentColor || T.accent,
      align: "center", verticalAlign: "center", padding: "60px 80px", gap: 20,
      blocks: [
        ...(lane ? [{ type: "badge", text: lane.title.toUpperCase(), bg: (branding?.accentColor || T.accent) + "18", color: branding?.accentColor || T.accent, icon: "Layers" }] : []),
        { type: "heading", text: concept.title, size: "4xl", color: "#0f172a" },
        ...(timeStr ? [{ type: "text", text: `${slideCount} slide${slideCount !== 1 ? "s" : ""} · ${timeStr}`, size: "lg", color: "#64748b" }] : [{ type: "text", text: `${slideCount} slide${slideCount !== 1 ? "s" : ""}`, size: "lg", color: "#64748b" }]),
        { type: "spacer", h: 8 },
      ],
      duration: 3,
    };
  }, [concept.presentCard, concept.id, concept.title, concept.slides, lanes, branding]);
  const presSlides = useMemo(() => fullscreen && titleCard ? [titleCard, ...slides] : slides, [fullscreen, titleCard, slides]);

  // Global slide index/total across all modules (for slide counter display)
  const { globalSlideIndex, globalSlideTotal } = useMemo(() => {
    let offset = 0, total = 0;
    let found = false;
    for (const l of (lanes || [])) {
      for (const item of l.items) {
        const count = (item.slides || []).length;
        if (item.id === concept.id) { offset += slideIndex; found = true; }
        else if (!found) { offset += count; }
        total += count;
      }
    }
    return { globalSlideIndex: offset, globalSlideTotal: total };
  }, [lanes, concept.id, slideIndex]);

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

  const stopImprove = useCallback(() => {
    if (improving) {
      improveCancelRef.current = true;
      setImproving(null);
      setCapturedThumb(null);
      setRevealKey(null);
    }
  }, [improving]);
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
  useEffect(() => { setEditingDuration(false); setShowCommentPopover(false); }, [slideIndex]);
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
  const [showNewSlide, setShowNewSlide] = useState(false);
  const [newSlidePrompt, setNewSlidePrompt] = useState("");
  const [newSlideImage, setNewSlideImage] = useState(null);
  const [newSlideGenerating, setNewSlideGenerating] = useState(false);
  const [showBranding, setShowBranding] = useState(false);
  const [showCinemaTip, setShowCinemaTip] = useState(false);
  const [previewRatio, setPreviewRatio] = useState("auto");
  const [alternatives, setAlternatives] = useState(null); // [{slide, label, emoji}] or null
  const [altLoading, setAltLoading] = useState(false);
  const [altPreview, setAltPreview] = useState(null); // null = original, 0-3 = alternative index
  const altCancelRef = useRef(false);
  const stopAlternatives = () => { altCancelRef.current = true; setAltLoading(false); setAlternatives(null); setAltPreview(null); };
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
    } catch (e) { dbg("Estimate error:", e); }
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
        list.push({ id: item.id, title: item.title, slideCount: (item.slides || []).length, laneTitle: lane.title, laneId: lane.id, presentCard: !!item.presentCard });
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

  const SLIDE_KEYS = new Set(["title","subtitle","blocks","bullets","bg","layout","duration","quote","author","timeLock","speakerNotes"]);
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
          if (slides.length === 0) dispatch({ type: "ADD_SLIDE", id: concept.id, slide: { blocks: [{ type: "image", src: compressed }] } });
          else { const cur = slides[slideIndex] || {}; dispatch({ type: "UPDATE_SLIDE", id: concept.id, index: slideIndex, patch: { blocks: [...(cur.blocks || []), { type: "image", src: compressed }] }, merge: true }); }
        };
        reader.readAsDataURL(blob); break;
      }
    }
  }, [concept.id, slideIndex, slides, dispatch]);

  useEffect(() => { const el = containerRef.current; if (el) { el.addEventListener("paste", handlePaste); return () => el.removeEventListener("paste", handlePaste); } }, [handlePaste]);
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;

      // Alternatives modal: 1-4 preview, Enter accept, ESC dismiss
      if (altLoading || alternatives) {
        if (e.key === "Escape") { e.preventDefault(); stopAlternatives(); }
        if (alternatives && e.key >= "1" && e.key <= "4") {
          const idx = parseInt(e.key) - 1;
          const alt = alternatives[idx];
          if (alt?.slide) { e.preventDefault(); setAltPreview(idx); }
        }
        if (e.key === "0") { e.preventDefault(); setAltPreview(null); }
        if (e.key === "Enter" && alternatives && altPreview !== null) {
          const alt = alternatives[altPreview];
          if (alt?.slide) { e.preventDefault(); applyAlternative(alt); }
        }
        return;
      }

      const mods = flatModules();
      const curIdx = mods.findIndex((m) => m.id === concept.id);

      // Arrow keys + Space: move through slides, crossing to next/prev module at boundaries
      // Up/Down behave the same as Left/Right (like PowerPoint)
      const navSlides = fullscreen ? presSlides : slides;
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        stopAll();
        if (navSlides.length > 0 && slideIndex < navSlides.length - 1) {
          dispatch({ type: "SET_SLIDE_INDEX", index: slideIndex + 1 });
        } else if (curIdx >= 0 && curIdx + 1 < mods.length) {
          const next = mods[curIdx + 1];
          dispatch({ type: "SELECT", id: next.id });
          dispatch({ type: "SET_SLIDE_INDEX", index: 0 });
          const changedLane = next.laneId !== mods[curIdx].laneId;
          showNavToast(next.title, changedLane ? next.laneTitle : null);
        }
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        stopAll();
        if (navSlides.length > 0 && slideIndex > 0) {
          dispatch({ type: "SET_SLIDE_INDEX", index: slideIndex - 1 });
        } else if (curIdx >= 0 && curIdx - 1 >= 0) {
          const prev = mods[curIdx - 1];
          dispatch({ type: "SELECT", id: prev.id });
          const prevPresOffset = prev.presentCard ? 1 : 0;
          dispatch({ type: "SET_SLIDE_INDEX", index: Math.max(0, (prev.slideCount || 1) - 1 + (fullscreen ? prevPresOffset : 0)) });
          const changedLane = prev.laneId !== mods[curIdx].laneId;
          showNavToast(prev.title, changedLane ? prev.laneTitle : null);
        }
      }

      // Esc closes popovers in fullscreen, but doesn't exit fullscreen (use F)
      // Font scale: +/- in fullscreen (0 resets)
      if (fullscreen && !showGalleryRef.current && (e.key === "+" || e.key === "=")) { e.preventDefault(); { const v = Math.min(fontScale + 0.1, 2.0); dispatch({ type: "SET_FONT_SCALE", value: Math.round(v*10)/10 }); showNavToast("FONT " + Math.round(v * 100) + "%"); }; }
      if (fullscreen && !showGalleryRef.current && e.key === "-") { e.preventDefault(); { const v = Math.max(fontScale - 0.1, 0.5); dispatch({ type: "SET_FONT_SCALE", value: Math.round(v*10)/10 }); showNavToast("FONT " + Math.round(v * 100) + "%"); }; }
      if (fullscreen && !showGalleryRef.current && e.key === "0" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); dispatch({ type: "SET_FONT_SCALE", value: 1 }); showNavToast("FONT 100%"); }
      if (e.key === "f" && !e.metaKey && !e.ctrlKey && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) { stopAll(); dispatch({ type: "SET_FULLSCREEN", value: !fullscreen }); }
      // F5 → fullscreen (prevent page reload)
      if (e.key === "F5") { e.preventDefault(); e.stopPropagation(); if (!fullscreen) { stopAll(); dispatch({ type: "SET_FULLSCREEN", value: true }); } }
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
      if (e.key === "Escape" && showGalleryRef.current) { e.preventDefault(); setGallery(false); return; }
      // Ctrl+C → copy current slide to system clipboard
      if ((e.ctrlKey || e.metaKey) && e.key === "c" && slidesRef.current.length > 0 && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName) && !window.getSelection()?.toString()) {
        const curSlides = slidesRef.current;
        const realIdx = fullscreen && presOffset ? slideIndex - presOffset : slideIndex;
        if (realIdx >= 0 && realIdx < curSlides.length) {
          e.preventDefault();
          velaClipboardWriteSlide(curSlides[realIdx]).then((ok) => { if (ok) showNavToast("Slide copied"); });
        }
      }
      // Ctrl+V → paste slide from system clipboard
      if ((e.ctrlKey || e.metaKey) && e.key === "v" && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
        velaClipboardReadSlide().then((slide) => {
          if (!slide) return;
          const insertAt = slides.length === 0 ? 0 : slideIndex + 1;
          dispatch({ type: "INSERT_SLIDE", id: concept.id, index: insertAt, slide });
          dispatch({ type: "SET_SLIDE_INDEX", index: insertAt });
          showNavToast("Slide pasted");
        });
      }
      // Delete key → remove current slide (not in input/textarea)
      if (e.key === "Delete" && slides.length > 0 && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        dispatch({ type: "REMOVE_SLIDE", id: concept.id, index: slideIndex });
        dispatch({ type: "SET_SLIDE_INDEX", index: Math.max(0, slideIndex - 1) });
      }
      // Shift+I: quick improve current slide (same as ✨ on single slide)
      if (e.key === "I" && e.shiftKey && !e.metaKey && !e.ctrlKey && slides.length > 0 && !improving && !altLoading) { e.preventDefault(); runImproveRef.current?.(null, "slide"); }
    };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, [slideIndex, slides.length, presSlides, fullscreen, dispatch, concept.id, flatModules, showNavToast, stopAll, altLoading, alternatives, altPreview, fontScale]);

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
    if (!quickEditPrompt.trim() || quickEditing || !slides[slideIndex]) return;
    setQuickEditing(true);
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
      setTimeout(() => setRevealKey(null), 1200);
    }
  };

  // ── Block-Targeted Edit (single block, prompt-based) ──
  const runBlockEdit = async (blockIndex, prompt) => {
    if (!prompt || blockEditing || !slides[slideIndex]?.blocks?.[blockIndex]) return;
    setBlockEditing(true);
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
      setTimeout(() => setRevealKey(null), 1200);
    }
  };

  // ── Generate New Slide (prompt-based) ──
  const runNewSlide = async () => {
    if (!newSlidePrompt.trim() || newSlideGenerating) return;
    setNewSlideGenerating(true);
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
      setTimeout(() => setRevealKey(null), 1200);
    }
  };

  const runImprove = async (prompt, scopeOverride) => {
    if (improving) { stopImprove(); return; }
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
      const h2c = await loadHtml2Canvas();
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
        const isSameItem = job.itemId === concept.id;

        // If improving across items (section scope), select the item first
        if (!isSameItem) dispatch({ type: "SELECT", id: job.itemId });
        dispatch({ type: "SET_SLIDE_INDEX", index: job.slideIdx });

        setImproving({ current: j + 1, total: jobs.length, status: `Capturing ${job.itemTitle} #${job.slideIdx + 1}...` });
        setRevealKey(null);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300))));

        const el = slideRef.current;
        if (!el || improveCancelRef.current) break;

        try {
          // Measure DOM layout stats (replaces screenshot — gives AI structured visual context)
          const layoutStats = computeSlideLayoutStats(el);

          setImproving({ current: j + 1, total: jobs.length, status: `Reviewing ${job.itemTitle} #${job.slideIdx + 1}...` });

          if (improveCancelRef.current) break;
          const improved = await improveSlide(null, job.slideData, job.itemTitle, job.slideIdx + 1, (scope === "section" ? jobs.length : slides.length), prompt, branding, guidelines, layoutStats);
          if (improveCancelRef.current) break;
          console.log(`[IMPROVE] ${job.itemTitle} #${job.slideIdx + 1} → bg=${improved.bg || "(none)"} bgGradient=${improved.bgGradient || "(none)"} color=${improved.color || "(none)"}`);
          setRevealKey(`${job.itemId}-${job.slideIdx}-${Date.now()}`);
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

      if (!improveCancelRef.current) {
        if (jobs.length > 1) {
          dispatch({ type: "SELECT", id: concept.id });
          dispatch({ type: "SET_SLIDE_INDEX", index: 0 });
        }
      }
      setImproving(failures > 0 ? { current: jobs.length, total: jobs.length, status: `Done — ${successes}✓ ${failures}⚠` } : null);
      if (failures > 0) setTimeout(() => setImproving(null), 3000);
      setCapturedThumb(null);
      setTimeout(() => setRevealKey(null), 1200);
    } catch (e) {
      console.error("Improve setup error:", e);
      setImproving(null);
      setCapturedThumb(null);
      setRevealKey(null);
    }
  };
  runImproveRef.current = runImprove;

  // ── Alternatives ──
  const runAlternatives = async () => {
    if (altLoading || !slides[slideIndex]) return;
    altCancelRef.current = false;
    setAltLoading(true);
    setAlternatives(null);
    setAltPreview(null);
    try {
      const el = slideRef.current;
      if (!el) { setAltLoading(false); return; }
      if (!window._h2cLoaded) { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"; document.head.appendChild(s); await new Promise((r) => { s.onload = r; }); window._h2cLoaded = true; }
      const h2c = window.html2canvas;
      const base64 = await captureSlide(el, h2c);
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

  const applyAlternative = (alt) => {
    if (!alt?.slide) return;
    setRevealKey(`alt-${Date.now()}`);
    dispatch({ type: "UPDATE_SLIDE", id: concept.id, index: slideIndex, patch: alt.slide });
    setAlternatives(null);
    setTimeout(() => setRevealKey(null), 1200);
  };
  // Clear alternatives when slide changes
  useEffect(() => { setAlternatives(null); setAltLoading(false); setAltPreview(null); }, [concept.id, slideIndex]);

  const isStudent = state?.veraMode === "student";

  if (fullscreen) return (
    <div ref={containerRef} tabIndex={0} style={{ position: "fixed", inset: 0, zIndex: 9999, background: T.bg, display: "flex", flexDirection: "row", outline: "none" }}>
      <div style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        <FullscreenSlide slide={presSlides[slideIndex]} index={slideIndex} total={presSlides.length} innerRef={slideRef} branding={presSlides[slideIndex]?._virtual ? null : branding} editable={!isStudent && !presSlides[slideIndex]?._virtual} onEdit={isStudent || presSlides[slideIndex]?._virtual ? undefined : handleSlideEdit} onBlockEdit={isStudent || presSlides[slideIndex]?._virtual ? undefined : runBlockEdit} blockEditing={isStudent ? null : blockEditing} fontScale={fontScale} mode="fill" displayIndex={globalSlideIndex - presOffset} displayTotal={globalSlideTotal} />
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
        {/* Browser fullscreen toggle removed — Vela fullscreen (F key / minimize button) is sufficient */}
        {!isMobile && !VELA_LOCAL_MODE && <>
          <div className="slide-nav-btn" onClick={() => setShowCinemaTip((v) => !v)} title="Cinema mode — fullscreen in browser" style={{ position: "absolute", top: 16, right: 124, padding: 8 }}><VelaIcon size={18} /></div>
          {showCinemaTip && <CinemaTip onClose={() => setShowCinemaTip(false)} />}
        </>}
        {navToast && <div className={navToast.phase === "in" ? "nav-toast-in" : "nav-toast-out"} style={{ position: "absolute", bottom: 20, left: 0, right: 0, display: "flex", justifyContent: "center", zIndex: 20, pointerEvents: "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 20px", borderRadius: 8, background: "rgba(0,0,0,0.78)", backdropFilter: "blur(8px)", border: `1px solid ${T.accent}30` }}>
            {navToast.section && <span style={{ fontFamily: FONT.mono, fontSize: 10, color: T.accent, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>{navToast.section}</span>}
            {navToast.section && <span style={{ color: T.textDim, fontSize: 13 }}>›</span>}
            <span style={{ fontFamily: FONT.display, fontSize: 14, color: "#fff", fontWeight: 600 }}>{navToast.module}</span>
          </div>
        </div>}
        {/* Floating Edit + New Slide in fullscreen */}
        {!isStudent && !improving && <div style={{ position: "absolute", bottom: 20, right: 20, zIndex: 25, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          {showQuickEdit && !quickEditing && <div onClick={(e) => e.stopPropagation()} style={{ width: isMobile ? "calc(100vw - 40px)" : 320, maxWidth: 320, background: "rgba(20,20,30,0.95)", border: `1px solid ${T.accent}40`, borderRadius: 12, padding: "12px 14px", boxShadow: "0 12px 48px rgba(0,0,0,0.6)", backdropFilter: "blur(16px)", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontFamily: FONT.mono, fontSize: 10, fontWeight: 700, color: T.accent, letterSpacing: "0.05em" }}>QUICK EDIT</span>
              {quickEditImage && <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.green }}>📎 img</span>}
              <span style={{ marginLeft: "auto", fontFamily: FONT.mono, fontSize: 9, color: "rgba(255,255,255,0.3)" }}>E to toggle</span>
              <button onClick={() => { setShowQuickEdit(false); setQuickEditImage(null); }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 14, padding: 0 }}>✕</button>
            </div>
            <textarea autoFocus value={quickEditPrompt} onChange={(e) => setQuickEditPrompt(e.target.value)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && !e.shiftKey && quickEditPrompt.trim()) { e.preventDefault(); runQuickEdit(); } if (e.key === "Escape") { setShowQuickEdit(false); setQuickEditImage(null); } }}
              onPaste={(e) => { const items = e.clipboardData?.items; if (!items) return; for (const item of items) { if (item.type.startsWith("image/")) { e.preventDefault(); e.stopPropagation(); const file = item.getAsFile(); const reader = new FileReader(); reader.onload = () => { setQuickEditImage({ base64: reader.result.split(",")[1], preview: reader.result }); }; reader.readAsDataURL(file); break; } } }}
              placeholder={"What to change? (paste image)\nE.g.: Add bullet, change colors..."}
              style={{ width: "100%", minHeight: 52, maxHeight: 80, padding: "6px 10px", fontSize: 13, fontFamily: FONT.body, background: "rgba(255,255,255,0.07)", border: `1px solid rgba(255,255,255,0.12)`, borderRadius: 6, color: "#fff", outline: "none", resize: "vertical", lineHeight: 1.4, boxSizing: "border-box" }} />
            {quickEditImage && <div style={{ display: "flex", alignItems: "center", gap: 6 }}><img src={quickEditImage.preview} alt="ref" style={{ height: 28, borderRadius: 4, border: "1px solid rgba(255,255,255,0.15)", objectFit: "cover" }} /><button onClick={() => setQuickEditImage(null)} style={S.btn({ fontSize: 9, color: T.red, padding: "1px 5px" })}>✕</button></div>}
            <button onClick={runQuickEdit} disabled={!quickEditPrompt.trim()} style={{ padding: "6px 14px", fontSize: 13, fontFamily: FONT.mono, fontWeight: 700, background: quickEditPrompt.trim() ? T.accent : "rgba(255,255,255,0.1)", color: "#fff", border: "none", borderRadius: 6, cursor: quickEditPrompt.trim() ? "pointer" : "default", opacity: quickEditPrompt.trim() ? 1 : 0.4, width: "100%" }}>Apply edit</button>
          </div>}
          {showNewSlide && !newSlideGenerating && <div onClick={(e) => e.stopPropagation()} style={{ width: isMobile ? "calc(100vw - 40px)" : 320, maxWidth: 320, background: "rgba(20,20,30,0.95)", border: `1px solid ${T.green}40`, borderRadius: 12, padding: "12px 14px", boxShadow: "0 12px 48px rgba(0,0,0,0.6)", backdropFilter: "blur(16px)", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontFamily: FONT.mono, fontSize: 10, fontWeight: 700, color: T.green, letterSpacing: "0.05em" }}>NEW SLIDE</span>
              {newSlideImage && <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.green }}>📎 img</span>}
              <span style={{ marginLeft: "auto", fontFamily: FONT.mono, fontSize: 9, color: "rgba(255,255,255,0.3)" }}>N to toggle</span>
              <button onClick={() => { setShowNewSlide(false); setNewSlideImage(null); }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 14, padding: 0 }}>✕</button>
            </div>
            <textarea autoFocus value={newSlidePrompt} onChange={(e) => setNewSlidePrompt(e.target.value)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && !e.shiftKey && newSlidePrompt.trim()) { e.preventDefault(); runNewSlide(); } if (e.key === "Escape") { setShowNewSlide(false); setNewSlideImage(null); } }}
              onPaste={(e) => { const items = e.clipboardData?.items; if (!items) return; for (const item of items) { if (item.type.startsWith("image/")) { e.preventDefault(); e.stopPropagation(); const file = item.getAsFile(); const reader = new FileReader(); reader.onload = () => { setNewSlideImage({ base64: reader.result.split(",")[1], preview: reader.result }); }; reader.readAsDataURL(file); break; } } }}
              placeholder={"Describe the slide... (paste image)\nE.g.: Title slide, comparison table..."}
              style={{ width: "100%", minHeight: 52, maxHeight: 80, padding: "6px 10px", fontSize: 13, fontFamily: FONT.body, background: "rgba(255,255,255,0.07)", border: `1px solid rgba(255,255,255,0.12)`, borderRadius: 6, color: "#fff", outline: "none", resize: "vertical", lineHeight: 1.4, boxSizing: "border-box" }} />
            {newSlideImage && <div style={{ display: "flex", alignItems: "center", gap: 6 }}><img src={newSlideImage.preview} alt="ref" style={{ height: 28, borderRadius: 4, border: "1px solid rgba(255,255,255,0.15)", objectFit: "cover" }} /><button onClick={() => setNewSlideImage(null)} style={S.btn({ fontSize: 9, color: T.red, padding: "1px 5px" })}>✕</button></div>}
            <button onClick={runNewSlide} disabled={!newSlidePrompt.trim()} style={{ padding: "6px 14px", fontSize: 13, fontFamily: FONT.mono, fontWeight: 700, background: newSlidePrompt.trim() ? T.green : "rgba(255,255,255,0.1)", color: "#fff", border: "none", borderRadius: 6, cursor: newSlidePrompt.trim() ? "pointer" : "default", opacity: newSlidePrompt.trim() ? 1 : 0.4, width: "100%" }}>Generate slide</button>
          </div>}
          {!showQuickEdit && !showNewSlide && !quickEditing && !newSlideGenerating && <div style={{ display: "flex", gap: 3, padding: "3px 4px", opacity: 0.6, transition: "opacity 0.3s" }} onMouseEnter={(e) => e.currentTarget.style.opacity = 1} onMouseLeave={(e) => e.currentTarget.style.opacity = 0.6}>
            <button onClick={() => { setShowNewSlide(true); setShowQuickEdit(false); }} title="New slide (N)" style={{ width: 26, height: 26, borderRadius: 6, background: "transparent", border: "none", color: T.green + "cc", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600 }}>+</button>
            <button onClick={() => { setShowQuickEdit(true); setShowNewSlide(false); }} title="Edit slide (E)" style={{ width: 26, height: 26, borderRadius: 6, background: "transparent", border: "none", color: T.accent + "cc", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✏️</button>
            <button onClick={() => { if (!improving && !altLoading && slides.length > 0) runImproveRef.current?.(null, "slide"); }} title="Improve (⇧I)" style={{ width: 26, height: 26, borderRadius: 6, background: improving ? T.accent + "30" : "transparent", border: "none", color: slides.length > 0 && !altLoading ? T.accent + "cc" : T.accent + "40", fontSize: 13, cursor: slides.length > 0 && !altLoading && !improving ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center" }}>✨</button>
            <button onClick={() => { if (!altLoading && !improving && slides.length > 0) runAlternatives(); }} title="Design variants (1-4 preview, Enter accept)" style={{ width: 26, height: 26, borderRadius: 6, background: altLoading ? T.accent + "30" : "transparent", border: "none", color: slides.length > 0 && !improving ? T.accent + "cc" : T.accent + "40", fontSize: 13, cursor: slides.length > 0 && !improving && !altLoading ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center" }}>🎲</button>
          </div>}
          {(quickEditing || newSlideGenerating) && <div style={{ padding: "3px 4px" }}><div style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ fontSize: 13, animation: "spin 1.5s linear infinite", display: "inline-block" }}>✨</span></div></div>}
        </div>}
      </div>
      </div>
      {isStudent && <StudentPanel state={state} dispatch={dispatch} lanes={lanes} selectedId={concept.id} slideIndex={slideIndex} />}
      {showGallery && <GalleryView lanes={lanes} currentConceptId={concept.id} slideIndex={slideIndex} dispatch={dispatch} onClose={() => setGallery(false)} branding={branding} />}
    </div>
  );

  return (
    <div ref={containerRef} tabIndex={0} className="fade-in" style={{ flex: 1, display: "flex", flexDirection: "column", background: T.bg, borderLeft: isMobile ? "none" : `1px solid ${T.border}`, outline: "none", minWidth: 0 }}>


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
                return <div key={revealKey || "static"} className={revealKey ? "magic-reveal" : improving ? "vera-thinking" : ""} style={{ borderRadius: 6, width: "100%", height: "100%" }}>
                  <VirtualSlide slide={displaySlide} index={slideIndex} total={slides.length} innerRef={slideRef} branding={branding} editable onEdit={handleSlideEdit} mode={isAuto ? "fill" : "fit-viewport"} onBlockEdit={runBlockEdit} blockEditing={blockEditing} virtualW={isAuto ? undefined : vw} virtualH={isAuto ? undefined : vh} bordered reviewMode={state.reviewMode} itemId={concept.id} dispatch={dispatch} displayIndex={globalSlideIndex} displayTotal={globalSlideTotal} />
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
            {/* Alternatives grid */}
            {(alternatives || altLoading) && <div style={{ position: "absolute", bottom: isMobile ? 6 : 10, left: isMobile ? 6 : 10, right: isMobile ? 50 : 70, zIndex: 15 }}>
              <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "nowrap", overflowX: "auto" }}>
                {ALT_DIRECTIONS.map((d, i) => {
                  const alt = alternatives?.[i];
                  const ready = alt?.slide;
                  const failed = alt?.error;
                  const isPreview = altPreview === i;
                  return (
                    <div key={i} onClick={() => { if (ready) { if (isPreview) applyAlternative(alt); else setAltPreview(i); } }}
                      style={{ flex: "0 0 auto", width: isMobile ? 80 : 110, cursor: ready ? "pointer" : "default", opacity: failed ? 0.4 : 1, borderRadius: 8, overflow: "hidden", border: `2px solid ${isPreview ? T.accent : "transparent"}`, background: T.bgPanel, transition: "border-color 0.2s, transform 0.2s", transform: isPreview ? "scale(1.05)" : "scale(1)" }}>
                      {ready ? (
                        <>
                          <div style={{ aspectRatio: "16/9", overflow: "hidden", position: "relative" }}>
                            <div style={{ transform: `scale(${(isMobile ? 80 : 110) / VIRTUAL_W})`, transformOrigin: "top left", width: VIRTUAL_W, height: VIRTUAL_H, pointerEvents: "none" }}>
                              <SlideContent slide={alt.slide} index={slideIndex} total={slides.length} branding={branding} />
                            </div>
                          </div>
                          <div style={{ padding: "2px 4px", textAlign: "center" }}>
                            <span style={{ fontSize: 9 }}>{d.emoji}</span>
                            <span style={{ fontFamily: FONT.mono, fontSize: 9, color: isPreview ? T.accent : T.textMuted, marginLeft: 2, fontWeight: isPreview ? 700 : 400 }}>{isPreview ? "apply" : d.label}</span>
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
            <button onClick={runQuickEdit} disabled={!quickEditPrompt.trim()} style={S.primaryBtn({ padding: "5px 14px", fontSize: 13, width: "100%", opacity: quickEditPrompt.trim() ? 1 : 0.4 })}>Apply edit</button>
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
            <button onClick={runNewSlide} disabled={!newSlidePrompt.trim()} style={S.primaryBtn({ padding: "5px 14px", fontSize: 13, width: "100%", opacity: newSlidePrompt.trim() ? 1 : 0.4 })}>Generate slide</button>
          </div>}
          {/* Timing */}
          {showTimingScope && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontFamily: FONT.mono, fontSize: 10, fontWeight: 700, color: T.amber, letterSpacing: "0.05em" }}>⏱ TIMING</span>
              <button onClick={() => setShowTimingScope(false)} style={{ marginLeft: "auto", background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 13, padding: 0 }}>✕</button>
            </div>
            <ScopeSelector icon="⏱" scope={timingScope} setScope={setTimingScope} concept={concept} slideIndex={slideIndex} slides={slides} currentLane={currentLane} lanes={lanes} isMobile={isMobile}>
              <button onClick={runEstimate} style={S.primaryBtn({ padding: "5px 14px", marginLeft: 4, flexShrink: 0 })}>Estimate</button>
            </ScopeSelector>
          </div>}
          {/* Estimating progress */}
          {estimating && <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, animation: "spin 1.5s linear infinite", display: "inline-block" }}>⏱</span>
            <span style={{ fontFamily: FONT.mono, fontSize: 13, color: T.amber, fontWeight: 600, flex: 1 }}>{estimating.status}</span>
            <div style={{ width: 80, height: 3, background: T.border, borderRadius: 2, overflow: "hidden" }}><div style={{ height: "100%", background: T.amber, borderRadius: 2, width: `${(estimating.current / estimating.total) * 100}%`, transition: "width 0.3s" }} /></div>
            <button onClick={() => { estimateCancelRef.current = true; setEstimating(null); }} style={S.btn({ padding: "2px 8px", fontSize: 10, color: T.amber })}>stop</button>
          </div>}
          {/* Generating spinner */}
          {(quickEditing || newSlideGenerating) && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
            <span style={{ fontSize: 14, animation: "spin 1.5s linear infinite", display: "inline-block" }}>✨</span>
            <span style={{ fontFamily: FONT.mono, fontSize: 13, color: T.accent }}>{quickEditing ? "Editing slide..." : "Generating slide..."}</span>
          </div>}
        </div>}

        {/* ── SLIDE TOOLBAR — centered strip between preview & notes ── */}
        {slides.length > 0 && <div style={{ flexShrink: 0, borderTop: `1px solid ${T.border}`, background: T.bgPanel, padding: "4px 12px", display: "flex", justifyContent: "center", alignItems: "center", gap: 3 }}>
          <button onClick={() => setShowQuickEdit((v) => !v)} title="Edit slide (E)" style={S.btn({ padding: "5px 12px", fontSize: 14, color: showQuickEdit ? T.accent : T.textDim, background: showQuickEdit ? T.accent + "20" : "transparent", borderRadius: 4, display: "flex", alignItems: "center", gap: 5 })}>✏️{!isMobile && <span style={{ fontSize: 13, fontFamily: FONT.mono }}>Edit</span>}</button>
          <button onClick={() => improving ? stopAll() : runImproveRef.current?.(null, "slide")} disabled={slides.length === 0 || altLoading} title="Auto-improve this slide (⇧I)" style={S.btn({ padding: "5px 12px", fontSize: 14, color: improving ? T.red : T.textDim, background: improving ? T.accent + "20" : "transparent", borderRadius: 4, display: "flex", alignItems: "center", gap: 5, opacity: slides.length === 0 ? 0.35 : 1 })}>{improving ? "⏹" : "✨"}{!isMobile && <span style={{ fontSize: 13, fontFamily: FONT.mono }}>{improving ? "Stop" : "Improve"}</span>}</button>
          <button onClick={() => altLoading ? stopAlternatives() : runAlternatives()} disabled={slides.length === 0 || improving} title="Generate design alternatives (1-4 to preview, Enter to accept)" style={S.btn({ padding: "5px 12px", fontSize: 14, color: altLoading ? T.red : (alternatives ? T.accent : T.textDim), background: altLoading || alternatives ? T.accent + "20" : "transparent", borderRadius: 4, display: "flex", alignItems: "center", gap: 5, opacity: slides.length === 0 ? 0.35 : 1 })}>{altLoading ? "⏹" : "🎲"}{!isMobile && <span style={{ fontSize: 13, fontFamily: FONT.mono }}>{altLoading ? "Stop" : "Variants"}</span>}</button>
          <div style={{ width: 1, height: 22, background: T.border + "60" }} />
          <button onClick={() => { setShowNewSlide((v) => !v); setShowQuickEdit(false); }} title="New slide (N)" style={S.btn({ padding: "5px 12px", fontSize: 14, color: showNewSlide ? T.green : T.textDim, background: showNewSlide ? T.green + "20" : "transparent", borderRadius: 4, display: "flex", alignItems: "center", gap: 5 })}>+{!isMobile && <span style={{ fontSize: 13, fontFamily: FONT.mono }}>New</span>}</button>
          <button onClick={() => { dispatch({ type: "DUPLICATE_SLIDE", id: concept.id, index: slideIndex }); dispatch({ type: "SET_SLIDE_INDEX", index: slideIndex + 1 }); }} title="Duplicate slide" style={S.btn({ padding: "5px 12px", fontSize: 14, color: T.textDim, borderRadius: 4, display: "flex", alignItems: "center", gap: 5 })}>📋{!isMobile && <span style={{ fontSize: 13, fontFamily: FONT.mono }}>Duplicate</span>}</button>
          <button ref={moveRef} onClick={() => setShowMoveToModule((v) => !v)} title="Move to module" style={S.btn({ padding: "5px 12px", fontSize: 14, color: showMoveToModule ? T.accent : T.textDim, background: showMoveToModule ? T.accent + "20" : "transparent", borderRadius: 4, display: "flex", alignItems: "center", gap: 5 })}>📦{!isMobile && <span style={{ fontSize: 13, fontFamily: FONT.mono }}>Move</span>}</button>
          <button onClick={() => { dispatch({ type: "REMOVE_SLIDE", id: concept.id, index: slideIndex }); dispatch({ type: "SET_SLIDE_INDEX", index: Math.max(0, slideIndex - 1) }); }} title="Delete slide (Del)" style={S.btn({ padding: "5px 12px", fontSize: 14, color: T.red + "90", borderRadius: 4, display: "flex", alignItems: "center", gap: 5 })}>🗑{!isMobile && <span style={{ fontSize: 13, fontFamily: FONT.mono }}>Delete</span>}</button>
        </div>}

        {/* ── NOTES BAR ──────────────────────────────────────── */}
        {slides.length > 0 && (() => {
          const curSlide = slides[slideIndex];
          const hasNotes = curSlide?.notes?.trim();
          const notesOpen = showNotes || hasNotes;
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
        {showMoveToModule && (() => { const allMods = []; for (const l of lanes) for (const it of l.items) if (it.id !== concept.id) allMods.push({ id: it.id, title: it.title, lane: l.title }); const rect = moveRef.current?.getBoundingClientRect(); const popH = Math.min(260, allMods.length * 32 + 40); const flipUp = rect && (rect.bottom + popH + 8 > window.innerHeight); const top = rect ? (flipUp ? Math.max(8, rect.top - popH - 4) : rect.bottom + 4) : 40; const left = rect ? Math.max(8, Math.min(rect.left, window.innerWidth - 220)) : 8; return <><div onClick={() => setShowMoveToModule(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} /><div style={{ position: "fixed", top, left, background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 8, padding: 4, minWidth: 200, maxWidth: "calc(100vw - 16px)", maxHeight: 260, overflowY: "auto", zIndex: 9999, boxShadow: "0 4px 20px rgba(0,0,0,0.5)" }}><div style={{ padding: "4px 8px", fontSize: 9, color: T.textDim, fontFamily: FONT.mono, textTransform: "uppercase" }}>Move to…</div>{allMods.length === 0 ? <div style={{ padding: 8, fontSize: 13, color: T.textDim }}>No other modules</div> : allMods.map((m) => <button key={m.id} onClick={() => { dispatch({ type: "MOVE_SLIDE_TO_MODULE", fromId: concept.id, toId: m.id, index: slideIndex }); setShowMoveToModule(false); }} style={{ ...S.btn({ fontSize: 13, color: T.text, textAlign: "left" }), display: "block", width: "100%", padding: "6px 8px", borderRadius: 4, background: "transparent", border: "none", cursor: "pointer" }} onMouseEnter={(e) => e.currentTarget.style.background = T.accent + "20"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>{m.title}</button>)}</div></>; })()}
      </div>
    </div>
  );
}


