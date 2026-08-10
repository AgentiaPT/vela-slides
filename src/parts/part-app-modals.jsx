// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
// ━━━ Modal Backdrop (shared) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function ModalBackdrop({ onClose, onEnter, extraKeys, children }) {
  useEffect(() => {
    const h = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      // Enter activates the dialog's default action (CR: every confirm dialog
      // should be confirmable with Enter). Don't hijack Enter inside multi-line
      // text entry (textarea / contentEditable) where it means "newline".
      if (e.key === "Enter" && onEnter && !e.shiftKey) {
        const tag = (e.target && e.target.tagName) || "";
        if (tag !== "TEXTAREA" && !(e.target && e.target.isContentEditable)) { e.preventDefault(); onEnter(); return; }
      }
      if (extraKeys?.(e)) { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, onEnter, extraKeys]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 10001, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 12, padding: "24px 28px", maxWidth: 520, width: "90vw", maxHeight: "85vh", overflowY: "auto", boxSizing: "border-box", boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
        {children}
      </div>
    </div>
  );
}

// ━━━ PowerPoint (.pptx) Export Modal ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Native, editable .pptx export. Mirrors VectorPdfExportModal's phase machine
// (choose → exporting → done/error) and off-screen per-slide render loop, but a
// PPTX slide is fixed 16:9 (the 960×540 virtual canvas maps exactly onto a
// 12192000×6858000 EMU slide), so there is NO ratio picker. Each slide renders
// off-screen at 960×540, buildPptx()'s companion pptxExtractSlidePage() pulls the
// per-slide IR straight out of the DOM (no scaling — fitScale is already baked in),
// then buildPptx() emits the OOXML+ZIP Blob. The artifact sandbox blocks blob:
// URLs, so the bytes are base64-encoded into a data: URI for the <a download>
// (same pattern the PDF modal uses for its own bytes).
function PptxExportModal({ slides, branding, deckTitle, onClose }) {
  const [phase, setPhase] = useState("choose"); // choose | exporting | done | error
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [pptxInfo, setPptxInfo] = useState(null); // { size } for stats
  const [pptxDataUri, setPptxDataUri] = useState(null);
  const [thumbs, setThumbs] = useState([]);
  const offscreenRef = useRef(null);
  const [renderIdx, setRenderIdx] = useState(-1);
  const pagesRef = useRef([]);
  const [showBranding, setShowBranding] = useState(false);
  const showBrandingRef = useRef(showBranding);
  showBrandingRef.current = showBranding;

  const startExport = useCallback(() => {
    setPhase("exporting");
    setProgress(0);
    setErrorMsg("");
    pagesRef.current = [];
    setThumbs([]);
    setRenderIdx(0);
  }, []);

  useEffect(() => {
    if (renderIdx < 0 || renderIdx >= slides.length || phase !== "exporting") return;
    const el = offscreenRef.current;
    if (!el) return;

    const timer = setTimeout(async () => {
      try {
        const slide = slides[renderIdx];
        const containerRect = el.getBoundingClientRect();
        let page;
        if (typeof pptxCaptureSlideRaster === "function" && typeof slideHasImages === "function" && slideHasImages(slide)) {
          // Image-heavy slide: whole-slide raster hybrid (mirrors the vector-PDF
          // slideHasImages fallback) — one full-bleed picture instead of native
          // per-block extraction, so photo slides still round-trip faithfully.
          page = await pptxCaptureSlideRaster(el, slide);
        } else {
          // One native page IR straight from the off-screen DOM (fixed 960×540 space).
          page = pptxExtractSlidePage(el, containerRect, slide);
          // SVG icons/blocks embed as native <p:pic> synchronously, but their PNG
          // fallback (for pre-365 PowerPoint) is rasterized in a separate async pass.
          if (typeof pptxRasterizeSvgs === "function" && page.svgs && page.svgs.length) {
            await pptxRasterizeSvgs(page.svgs);
          }
          // Resolve any image blocks whose bytes aren't inline (external URLs / webp).
          if (typeof pptxResolveImages === "function" && page.images && page.images.length) {
            await pptxResolveImages(page.images);
          }
        }

        // Optional "Made with Vela" branding — a native, editable text box, kept
        // off virtual title cards so it only marks real content slides.
        if (showBrandingRef.current && !slide._virtual) {
          page.texts = (page.texts || []).concat([{
            x: VIRTUAL_W - 196, y: VIRTUAL_H - 26, w: 184, h: 16,
            text: "Made with Vela", fontSize: 11, color: "#94a3b8",
            fontWeight: 600, align: "right",
          }]);
        }
        pagesRef.current.push(page);

        // Thumbnail via the shared quick canvas capture (best-effort).
        try {
          const thumbCanvas = document.createElement("canvas");
          const tw = 120, th = Math.round(120 * (VIRTUAL_H / VIRTUAL_W));
          thumbCanvas.width = tw * 2; thumbCanvas.height = th * 2;
          const tctx = thumbCanvas.getContext("2d");
          const quickCanvas = await vectorDomToCanvas(el, VIRTUAL_W, VIRTUAL_H, 1);
          tctx.drawImage(quickCanvas, 0, 0, quickCanvas.width, quickCanvas.height, 0, 0, tw * 2, th * 2);
          setThumbs(prev => [...prev, thumbCanvas.toDataURL("image/jpeg", 0.5)]);
        } catch (thumbErr) {
          setThumbs(prev => [...prev, null]);
        }

        setProgress(((renderIdx + 1) / slides.length) * 100);

        if (renderIdx + 1 < slides.length) {
          setRenderIdx(renderIdx + 1);
        } else {
          // Finalize: emit the OOXML+ZIP Blob, then base64 → data: URI (blob: blocked).
          const blob = buildPptx(pagesRef.current, {});
          const buf = await blob.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = "";
          const CHUNK = 0x8000; // chunked so String.fromCharCode.apply never overflows
          for (let i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
          }
          const b64 = btoa(binary);
          setPptxDataUri("data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64," + b64);
          setPptxInfo({ size: bytes.length });
          setPhase("done");
        }
      } catch (err) {
        console.error("PPTX export error:", err);
        setErrorMsg(`Export failed on slide ${renderIdx + 1}: ${err && err.message ? err.message : err}`);
        setPhase("error");
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [renderIdx, phase, slides.length]);

  const safeTitle = ((deckTitle || "vela-deck").replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-{2,}/g, "-").slice(0, 60));
  const currentSlide = renderIdx >= 0 && renderIdx < slides.length ? slides[renderIdx] : null;

  return (
    <div onClick={onClose} data-testid="pptx-export-modal" style={{ position: "fixed", inset: 0, zIndex: 10001, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 12, width: "min(480px, 94vw)", maxHeight: "94vh", boxShadow: "0 20px 60px rgba(0,0,0,0.6)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {getIcon("FileDown", { size: 14, color: T.accent })}
            <span style={{ fontFamily: FONT.mono, fontSize: 11, fontWeight: 700, color: T.accent, letterSpacing: 1 }}>POWERPOINT</span>
            <span style={{ fontFamily: FONT.mono, fontSize: 8, color: T.green || "#34d399", background: `${T.green || "#34d399"}18`, padding: "1px 5px", borderRadius: 3, fontWeight: 600, letterSpacing: 0.5 }}>.PPTX</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 16, padding: "0 4px", lineHeight: 1 }}>{"✕"}</button>
        </div>

        <div style={{ display: "block", flex: 1, minHeight: 0, overflow: "hidden" }}>
        <div style={{ padding: "20px 16px", overflowY: "auto" }}>
          {phase === "choose" && <>
            <div style={{ fontFamily: FONT.body, fontSize: 13, color: T.textMuted, marginBottom: 6 }}>
              Native, editable PowerPoint — real text boxes & shapes, 16:9
            </div>
            <div style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim, marginBottom: 16, padding: "6px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 6, border: `1px solid ${T.border}` }}>
              {slides.length} slides {"·"} 12192000{"×"}6858000 EMU (16:9)
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, padding: "10px 12px", background: "rgba(255,255,255,0.03)", border: `1px solid ${T.border}`, borderRadius: 8 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontFamily: FONT.body, fontSize: 13, color: T.text }}>Show branding</span>
                <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim }}>Made with Vela {"·"} corner caption</span>
              </div>
              <button data-testid="pptx-export-branding-toggle" onClick={() => setShowBranding(b => !b)} style={{
                width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer",
                background: showBranding ? T.accent : "rgba(255,255,255,0.12)",
                position: "relative", transition: "background .2s", flexShrink: 0,
              }}>
                <div style={{
                  width: 16, height: 16, borderRadius: 8, background: "#fff",
                  position: "absolute", top: 3, left: showBranding ? 21 : 3,
                  transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                }} />
              </button>
            </div>
            <button data-testid="pptx-export-start" onClick={startExport} style={{
              width: "100%", padding: "10px", fontFamily: FONT.mono, fontSize: 12, fontWeight: 700,
              background: T.accent, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer",
              letterSpacing: 1, transition: "opacity .15s",
            }}>
              EXPORT {slides.length} SLIDES
            </button>
          </>}

          {(phase === "exporting" || phase === "done") && (() => {
            const thumbW = 56, thumbH = Math.round(56 * (VIRTUAL_H / VIRTUAL_W));
            const bigW = 140, bigH = Math.round(140 * (VIRTUAL_H / VIRTUAL_W));
            const isExporting = phase === "exporting";
            const maxVisible = 14;
            const visibleThumbs = thumbs.slice(-maxVisible);
            const prevThumbs = visibleThumbs.slice(0, -1);
            const latestThumb = visibleThumbs.length > 0 ? visibleThumbs[visibleThumbs.length - 1] : null;
            return <>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 0 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "0 auto 12px", minHeight: bigH + 8 }}>
                  <div style={{ position: "relative", width: thumbW + Math.max(prevThumbs.length - 1, 0) * 14, height: thumbH + 16, flexShrink: 0 }}>
                    {prevThumbs.map((src, i) => {
                      const total = prevThumbs.length;
                      const spread = Math.min(14, 160 / Math.max(total, 1));
                      const x = i * spread;
                      const tilt = ((i - (total - 1) / 2) / Math.max(total - 1, 1)) * 3;
                      return src ? <img key={i} src={src} alt="" style={{
                        position: "absolute", left: x, top: 8,
                        width: thumbW, height: thumbH, objectFit: "cover",
                        borderRadius: 3, border: `1px solid ${T.border}`,
                        boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                        transform: `rotate(${tilt}deg)`,
                        opacity: 0.7 + 0.3 * (i / Math.max(total - 1, 1)),
                        zIndex: i,
                      }} /> : null;
                    })}
                    {thumbs.length === 0 && <div style={{
                      width: thumbW, height: thumbH, borderRadius: 3, border: `2px dashed ${T.border}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      position: "absolute", left: 0, top: 8,
                    }}>
                      <div style={{ width: 12, height: 12, border: `2px solid ${T.accent}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                    </div>}
                  </div>
                  {latestThumb ? <div style={{ position: "relative", flexShrink: 0 }}>
                    <img src={latestThumb} alt="" style={{
                      width: bigW, height: bigH, objectFit: "cover",
                      borderRadius: 6, border: `2px solid ${T.accent}`,
                      boxShadow: `0 8px 32px ${T.accent}30, 0 4px 16px rgba(0,0,0,0.4)`,
                      animation: "pageIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
                    }} />
                    <div style={{
                      position: "absolute", bottom: -8, left: "50%", transform: "translateX(-50%)",
                      fontFamily: FONT.mono, fontSize: 9, fontWeight: 700, color: "#fff",
                      background: T.accent, padding: "2px 8px", borderRadius: 10,
                      whiteSpace: "nowrap",
                    }}>{thumbs.length} / {slides.length}</div>
                  </div> : <div style={{
                    width: bigW, height: bigH, borderRadius: 6, border: `2px dashed ${T.border}`,
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  }}>
                    <div style={{ width: 20, height: 20, border: `2px solid ${T.accent}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                  </div>}
                </div>

                {isExporting ? <>
                  <div style={{ fontFamily: FONT.mono, fontSize: 11, color: T.text, marginBottom: 8 }}>
                    Building slide {Math.min(renderIdx + 1, slides.length)} of {slides.length}
                  </div>
                  <div style={{ width: "100%", height: 4, background: T.border, borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${progress}%`, height: "100%", background: `linear-gradient(90deg, ${T.accent}, ${T.green || "#34d399"})`, borderRadius: 2, transition: "width .3s ease" }} />
                  </div>
                </> : <>
                  <div data-testid="pptx-export-done" style={{ fontFamily: FONT.mono, fontSize: 13, color: T.green || "#34d399", fontWeight: 700, marginBottom: 4 }}>
                    {"✅"} {slides.length} slides ready
                  </div>
                  <div style={{ fontFamily: FONT.mono, fontSize: 10, color: T.textDim }}>
                    native .pptx {"·"} {((pptxInfo?.size || 0) / 1024).toFixed(0)} KB
                  </div>
                </>}
              </div>

              {phase === "done" && <>
                <div style={{ display: "flex", gap: 8 }}>
                  <a data-testid="pptx-export-download" href={pptxDataUri} download={`${safeTitle}.pptx`} style={{
                    flex: 1, padding: "10px", fontFamily: FONT.mono, fontSize: 12, fontWeight: 700,
                    background: T.accent, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer",
                    letterSpacing: 1, textAlign: "center", textDecoration: "none",
                  }}>
                    {"⬇"} DOWNLOAD PPTX
                  </a>
                  <button onClick={onClose} style={{
                    padding: "10px 16px", fontFamily: FONT.mono, fontSize: 11, fontWeight: 600,
                    background: "transparent", color: T.textDim, border: `1px solid ${T.border}`, borderRadius: 6, cursor: "pointer",
                  }}>CLOSE</button>
                </div>
              </>}
            </>;
          })()}

          {phase === "error" && <>
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>{"❌"}</div>
              <div data-testid="pptx-export-error" style={{ fontFamily: FONT.mono, fontSize: 11, color: "#ef4444", marginBottom: 8 }}>{errorMsg}</div>
            </div>
            <button onClick={onClose} style={{
              width: "100%", padding: "10px", fontFamily: FONT.mono, fontSize: 12, fontWeight: 700,
              background: "rgba(239,68,68,0.2)", color: "#ef4444", border: "1px solid #ef4444", borderRadius: 6, cursor: "pointer",
            }}>CLOSE</button>
          </>}
        </div>
        </div>
      </div>

      {/* Off-screen slide renderer — one slide at a time, fixed 960×540 (16:9). */}
      {phase === "exporting" && currentSlide && (() => {
        const displayTotal = slides.reduce((n, s) => n + (s._virtual ? 0 : 1), 0);
        let nonVirtualBefore = 0;
        for (let i = 0; i < renderIdx; i++) if (!slides[i]._virtual) nonVirtualBefore++;
        const displayIndex = currentSlide._virtual ? nonVirtualBefore - 1 : nonVirtualBefore;
        return (
          <div style={{ position: "fixed", left: -9999, top: -9999, width: VIRTUAL_W, height: VIRTUAL_H, overflow: "hidden", zIndex: -1 }}>
            <style>{`.no-anim, .no-anim * { animation: none !important; transition: none !important; }`}</style>
            <div ref={offscreenRef} className="no-anim vela-pdf-capture" style={{ width: VIRTUAL_W, height: VIRTUAL_H, overflow: "hidden" }}>
              <SlideContent slide={currentSlide} index={renderIdx} total={slides.length} branding={currentSlide._virtual ? null : branding} displayIndex={displayIndex} displayTotal={displayTotal} />
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ━━━ Deck Stats Dialog ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Opened from the header stat pill. The header shows presentation totals (hidden
// slides excluded); this dialog breaks down visible vs hidden (CR: hide/unhide).
function StatsDialog({ state, onClose }) {
  const items = state.lanes.flatMap((l) => l.items);
  const allSlides = items.flatMap((i) => i.slides || []);
  const visible = allSlides.filter((s) => !s.hidden);
  const hidden = allSlides.filter((s) => s.hidden);
  const dur = (arr) => arr.reduce((a, s) => a + (s.duration || 0), 0);
  const Row = ({ label, a, b, accent }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "7px 0", borderTop: `1px solid ${T.border}` }}>
      <span style={{ fontFamily: FONT.body, fontSize: 13, color: accent ? T.accent : T.text, fontWeight: accent ? 700 : 400 }}>{label}</span>
      <span style={{ fontFamily: FONT.mono, fontSize: 12, color: accent ? T.accent : T.textDim }}>{a}{b != null ? <span style={{ color: T.textDim }}> · {b}</span> : null}</span>
    </div>
  );
  return (
    <ModalBackdrop onClose={onClose} onEnter={onClose}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontFamily: FONT.display, fontSize: 16, fontWeight: 700, color: T.text }}>📊 Deck stats</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 18, padding: 4 }}>✕</button>
      </div>
      <Row label="Presenting" a={`${visible.length} slides`} b={fmtTime(dur(visible)) || "0s"} accent />
      {hidden.length > 0 && <Row label="Hidden" a={`${hidden.length} slides`} b={fmtTime(dur(hidden)) || "0s"} />}
      <Row label="Total (incl. hidden)" a={`${allSlides.length} slides`} b={fmtTime(dur(allSlides)) || "0s"} />
      <Row label="Sections" a={`${items.length}`} b={`${state.lanes.length} lane${state.lanes.length === 1 ? "" : "s"}`} />
      <div style={{ marginTop: 12, fontFamily: FONT.mono, fontSize: 9, fontWeight: 700, color: T.textDim, letterSpacing: "0.1em", textTransform: "uppercase" }}>Per section</div>
      <div style={{ maxHeight: 220, overflowY: "auto", marginTop: 4 }}>
        {items.map((i, idx) => {
          const vis = (i.slides || []).filter((s) => !s.hidden);
          const hid = (i.slides || []).length - vis.length;
          return (
            <div key={i.id || idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "4px 0", fontSize: 12 }}>
              <span style={{ fontFamily: FONT.body, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>{i.title}</span>
              <span style={{ fontFamily: FONT.mono, color: T.textDim, flexShrink: 0 }}>{vis.length}sl{hid > 0 ? ` (+${hid}⊘)` : ""} · {fmtTime(sumVisibleDurations(i.slides)) || "0s"}</span>
            </div>
          );
        })}
      </div>
    </ModalBackdrop>
  );
}

// ━━━ Changelog Dialog ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function ChangelogDialog({ onClose }) {
  const [showDeps, setShowDeps] = React.useState(false);
  const hasUpdater = typeof window !== "undefined" && typeof window.__velaCheckForUpdate === "function";
  const [updateState, setUpdateState] = React.useState(null); // null | "checking" | "update" | "uptodate" | "error"
  const checkUpdates = async () => {
    if (updateState === "checking") return;
    setUpdateState("checking");
    try { setUpdateState(await window.__velaCheckForUpdate()); }
    catch { setUpdateState("error"); }
  };
  const updateLabel = { checking: "Checking…", update: "Update available →", uptodate: "✓ Up to date", error: "Check failed — retry" };
  return (
    <ModalBackdrop onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <VelaIcon size={22} />
          <span style={{ fontFamily: FONT.mono, fontSize: 16, fontWeight: 700, color: T.accent, letterSpacing: 2 }}>VELA</span>
          <span style={{ fontFamily: FONT.mono, fontSize: 11, color: T.textDim }}>v{VELA_VERSION}</span>
          {hasUpdater && <button onClick={checkUpdates} disabled={updateState === "checking"} style={S.btn({ fontSize: 9, padding: "2px 8px", color: updateState === "uptodate" ? T.green : updateState === "update" ? T.accent : T.textMuted, borderColor: (updateState === "update" ? T.accent : T.border) + "80", cursor: updateState === "checking" ? "wait" : "pointer" })}>{updateLabel[updateState] || "Check for updates"}</button>}
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 18, padding: 4 }}>✕</button>
      </div>
      <div style={{ fontFamily: FONT.mono, fontSize: 9, fontWeight: 700, color: T.textDim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>Recent Changes</div>
      {VELA_CHANGELOG.slice(0, 3).map((c, i) => (
        <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0", borderTop: i > 0 ? `1px solid ${T.border}` : "none" }}>
          <span style={{ fontFamily: FONT.mono, fontSize: 10, fontWeight: 700, color: i === 0 ? T.accent : T.textDim, flexShrink: 0, minWidth: 32 }}>v{c.v}</span>
          <div style={{ flex: 1, minWidth: 0, fontFamily: FONT.body, fontSize: 11, color: T.text, lineHeight: 1.4 }}>
            {Array.isArray(c.d)
              ? <ul style={{ margin: 0, paddingLeft: 16 }}>{c.d.map((b, j) => <li key={j} style={{ marginBottom: 2 }}>{b}</li>)}</ul>
              : c.d}
          </div>
        </div>
      ))}
      {/* \u2500\u2500 Dependencies (collapsible) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */}
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
        <div onClick={() => setShowDeps(!showDeps)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 6, userSelect: "none" }}>
          <span style={{ fontFamily: FONT.mono, fontSize: 9, fontWeight: 700, color: T.textDim, letterSpacing: "0.1em", textTransform: "uppercase" }}>Dependencies & Credits</span>
          <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim, transition: "transform .15s", transform: showDeps ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
        </div>
        {showDeps && <div style={{ marginTop: 6 }}>
          {[
            { name: "React 18+", license: "MIT", url: "https://react.dev", src: "https://github.com/facebook/react", note: "UI framework" },
            { name: "Lucide React", license: "ISC", url: "https://lucide.dev", src: "https://github.com/lucide-icons/lucide", note: "280+ icons" },
            { name: "html2canvas", license: "MIT", url: "https://html2canvas.hertzen.com", src: "https://github.com/niklasvh/html2canvas", note: "v1.4.1 \u00b7 PDF export" },
            { name: "Google Fonts", license: "OFL 1.1", url: "https://fonts.google.com", src: null, note: "Sora, DM Sans, Space Mono" },
            { name: "Anthropic API", license: "\u2014", url: "https://docs.anthropic.com", src: null, note: "Vera AI engine" },
          ].map((dep, i) => (
            <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 5, padding: "2px 0", fontSize: 10 }}>
              <a href={dep.url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: FONT.mono, fontSize: 9, fontWeight: 600, color: T.accent, textDecoration: "none", flexShrink: 0 }}>{dep.name}</a>
              {dep.src && <a href={dep.src} target="_blank" rel="noopener noreferrer" style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim, textDecoration: "none", opacity: 0.7 }}>\u2197</a>}
              <span style={{ fontFamily: FONT.body, fontSize: 9, color: T.textDim }}>{dep.note}</span>
              <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim, background: `${T.textDim}15`, padding: "0px 3px", borderRadius: 2 }}>{dep.license}</span>
            </div>
          ))}
          <div style={{ fontFamily: FONT.body, fontSize: 9, color: T.textDim, marginTop: 4 }}>PDF writer, SVG pipeline, state & storage \u2014 zero extra deps. <a href="https://github.com/agentiapt/vela-slides/blob/main/NOTICE" target="_blank" rel="noopener noreferrer" style={{ color: T.accent, textDecoration: "none" }}>Full SBOM</a></div>
        </div>}
      </div>
      {/* \u2500\u2500 Footer \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */}
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${T.border}`, textAlign: "center", display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontFamily: FONT.body, fontSize: 10, color: T.textMuted }}>© 2025-present <a href="https://www.linkedin.com/in/rquintino/" target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, color: T.text, textDecoration: "none" }}>Rui Quintino</a> · <a href="https://github.com/agentiapt/vela-slides/blob/main/LICENSE" target="_blank" rel="noopener noreferrer" style={{ color: T.accent, textDecoration: "none" }}>ELv2</a></span>
        <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
          <a href="https://github.com/agentiapt/vela-slides" target="_blank" rel="noopener noreferrer" style={{ fontFamily: FONT.mono, fontSize: 9, color: T.accent, textDecoration: "none" }}>⛵ GitHub</a>
          <a href="https://agentia.pt" target="_blank" rel="noopener noreferrer" style={{ fontFamily: FONT.mono, fontSize: 9, color: T.accent, textDecoration: "none" }}>🚀 agentIA</a>
          <a href="mailto:info@agentia.pt" style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim, textDecoration: "none" }}>✉ Commercial</a>
        </div>
      </div>
    </ModalBackdrop>
  );
}

