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

