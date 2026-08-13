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
    // Fail-safe: the desktop (Neutralino) webview blocks this CDN via CSP and
    // has no network, so onload may never fire. Resolve null on error/timeout
    // instead of hanging — callers fall back to layout-stats-only (no thumbnail).
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    setTimeout(() => done(window.html2canvas || null), 4000);
    if (!window._h2cLoading) {
      window._h2cLoading = true;
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
      s.onload = () => { window._h2cLoaded = true; done(window.html2canvas || null); };
      s.onerror = () => { window._h2cLoading = false; done(null); };
      document.head.appendChild(s);
    } else {
      const check = setInterval(() => { if (window.html2canvas) { clearInterval(check); done(window.html2canvas); } }, 50);
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
function VirtualSlide({ slide, index, total, innerRef, branding, editable, onEdit, mode = "fit-width", onBlockEdit, blockEditing, fontScale, virtualW, virtualH, bordered, reviewMode, itemId, dispatch: externalDispatch, displayIndex, displayTotal, forceEdit }) {
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

  // Encoder-gated the same way the main SlideContent render does (part-blocks.jsx)
  // — this thumbnail/fullscreen wrapper is a separate render sink for the same
  // deck-supplied bg/bgGradient scalars. (v13.26)
  const bg = cssColor(slide?.bg) || cssGradient(slide?.bgGradient) || T.slideBg;
  const isFullscreen = mode === "fit-viewport" || isFill;
  const aspectRatio = `${vw}/${vh}`;

  return (
    <div ref={outerRef} style={isFullscreen
      ? bordered || isFill
        ? { position: "absolute", inset: 0, background: bg, overflow: "hidden", borderRadius: 6, border: `1px solid ${T.border}` }
        : { position: "absolute", inset: 0, background: bg, overflow: "hidden" }
      : { width: "100%", aspectRatio, position: "relative", overflow: "hidden", borderRadius: 6, border: `1px solid ${T.border}` }}>
      <div ref={innerRef} data-testid={bordered ? "slide-viewport" : undefined} style={{
        width: vw, height: vh,
        transform: isFullscreen ? `translate(${offset.x}px, ${offset.y}px) scale(${scale})` : `scale(${scale})`,
        transformOrigin: "top left", background: bg, position: "absolute", top: 0, left: 0,
      }}>
        {slide && <SlideContent key={`${index}-${vw}-${vh}`} slide={slide} index={index} total={total} branding={branding} editable={editable} onEdit={onEdit} presenting={((mode === "fit-viewport" || isFill) && !bordered) && !forceEdit} onBlockEdit={onBlockEdit} blockEditing={blockEditing} fontScale={fontScale} reviewMode={reviewMode} itemId={itemId} dispatch={externalDispatch} displayIndex={displayIndex} displayTotal={displayTotal} />}
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

  // Centralized AI availability check (v12.36) — reactive so the panel re-renders
  // when the desktop shell finishes agent detection (v12.74).
  const apiAvailable = useAIAvailable();

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

// Reusable searchable section/module picker — renders a filter input + a
// scrollable list of destination modules. Shared by the slide toolbar's
// "Move to module" popover (Feature 6) and the section-list right-click context
// menu (Feature 5). `mods` = [{ id, title, lane }]; onPick(id) fires on choice.
// The scroll list is tagged data-scroll-container (+ stops wheel propagation) so
// the SlidePanel wheel-nav listener does not change slides while scrolling it,
// and carries .vela-wide-scroll for the wider scrollbar.
function SectionPicker({ mods, onPick, autoFocus = true, emptyLabel = "No other sections" }) {
  const [q, setQ] = useState("");
  const inputRef = useRef(null);
  useEffect(() => { if (autoFocus) { const t = setTimeout(() => inputRef.current?.focus(), 0); return () => clearTimeout(t); } }, []);
  const ql = q.trim().toLowerCase();
  const filtered = ql ? mods.filter((m) => (m.title || "").toLowerCase().includes(ql) || (m.lane || "").toLowerCase().includes(ql)) : mods;
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 200, maxWidth: "calc(100vw - 16px)" }}>
      <div style={{ padding: "4px 8px 2px", fontSize: 9, color: T.textDim, fontFamily: FONT.mono, textTransform: "uppercase" }}>Move to…</div>
      <input ref={inputRef} data-testid="section-search" value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
        placeholder="Search sections…"
        style={{ ...S.input({ padding: "4px 8px", fontSize: 12 }), margin: "0 4px 4px", width: "calc(100% - 8px)" }} />
      <div data-scroll-container data-testid="section-picker-list" className="vela-wide-scroll"
        onWheel={(e) => e.stopPropagation()}
        style={{ maxHeight: 220, overflowY: "auto" }}>
        {mods.length === 0
          ? <div style={{ padding: 8, fontSize: 13, color: T.textDim }}>{emptyLabel}</div>
          : filtered.length === 0
            ? <div style={{ padding: 8, fontSize: 13, color: T.textDim }}>No matches</div>
            : filtered.map((m) => <button key={m.id} data-testid="section-picker-item" onClick={(e) => { e.stopPropagation(); onPick(m.id, e); }}
                style={{ ...S.btn({ fontSize: 13, color: T.text, textAlign: "left" }), display: "block", width: "100%", padding: "6px 8px", borderRadius: 4, background: "transparent", border: "none", cursor: "pointer" }}
                onMouseEnter={(e) => e.currentTarget.style.background = T.accent + "20"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                {m.title}{m.lane ? <span style={{ color: T.textDim, fontSize: 10, marginLeft: 6 }}>{m.lane}</span> : null}
              </button>)}
      </div>
    </div>
  );
}

