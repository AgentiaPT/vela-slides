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

// ━━━ Comments Panel (review sidebar) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function CommentsPanel({ state, dispatch, isMobile }) {
  const [filter, setFilter] = useState("open"); // "all" | "open" | "resolved"
  const [selected, setSelected] = useState(new Set()); // for multi-select
  const [newComment, setNewComment] = useState("");
  const allComments = collectComments(state.lanes, filter === "all" ? null : (c) => c.status === filter);
  const openCount = collectComments(state.lanes, (c) => c.status === "open").length;
  const resolvedCount = collectComments(state.lanes, (c) => c.status === "resolved").length;

  const toggleSelect = (id) => setSelected((prev) => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });

  const grouped = {};
  for (const c of allComments) { if (!grouped[c.itemTitle]) grouped[c.itemTitle] = []; grouped[c.itemTitle].push(c); }

  const copyForAgent = () => { velaClipboard(formatCommentsForAgent(state.lanes)); };

  return (
    <div style={{ width: isMobile ? "100%" : 260, display: "flex", flexDirection: "column", borderLeft: isMobile ? "none" : `1px solid ${T.border}`, background: T.bgPanel, flexShrink: 0, height: "100%" }}>
      {/* Header */}
      <div style={{ padding: "8px 12px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontFamily: FONT.mono, fontSize: 11, fontWeight: 700, color: T.accent, letterSpacing: "0.08em" }}>COMMENTS</span>
        {openCount > 0 && <span style={{ fontSize: 9, fontFamily: FONT.mono, fontWeight: 700, color: "#fff", background: T.amber, borderRadius: 8, padding: "0 5px", minWidth: 16, textAlign: "center", lineHeight: "16px" }}>{openCount}</span>}
        <div style={{ flex: 1 }} />
        {!isMobile && <button onClick={() => { dispatch({ type: "SET_COMMENTS_PANEL", open: false }); dispatch({ type: "SET_REVIEW_MODE", value: false }); }} style={{ background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 14, padding: "0 2px" }}>✕</button>}
      </div>
      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${T.border}` }}>
        {[["all", `All (${openCount + resolvedCount})`], ["open", `Open (${openCount})`], ["resolved", `Done (${resolvedCount})`]].map(([key, label]) => (
          <button key={key} onClick={() => setFilter(key)} style={{ flex: 1, padding: "6px 4px", fontSize: 9, fontFamily: FONT.mono, fontWeight: 700, background: filter === key ? T.accent + "15" : "transparent", color: filter === key ? T.accent : T.textDim, border: "none", borderBottom: filter === key ? `2px solid ${T.accent}` : "2px solid transparent", cursor: "pointer" }}>{label}</button>
        ))}
      </div>
      {/* Quick add comment */}
      {state.selectedId && <div style={{ padding: "6px 8px", borderBottom: `1px solid ${T.border}`, display: "flex", gap: 4 }}>
        <input value={newComment} onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && newComment.trim()) { dispatch({ type: "ADD_COMMENT", itemId: state.selectedId, slideIndex: state.slideIndex, text: newComment.trim() }); setNewComment(""); } if (e.key === "Escape") setNewComment(""); }}
          placeholder={`Comment on slide ${state.slideIndex + 1}...`}
          style={{ flex: 1, padding: "4px 8px", fontSize: 10, fontFamily: FONT.body, background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 4, color: T.text, outline: "none", minWidth: 0 }} />
        <button onClick={() => { if (newComment.trim()) { dispatch({ type: "ADD_COMMENT", itemId: state.selectedId, slideIndex: state.slideIndex, text: newComment.trim() }); setNewComment(""); } }} disabled={!newComment.trim()} style={S.primaryBtn({ padding: "4px 8px", fontSize: 9, opacity: newComment.trim() ? 1 : 0.4 })}>Add</button>
      </div>}
      {/* Comments list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
        {allComments.length === 0 && <div style={{ padding: "20px 12px", textAlign: "center", fontFamily: FONT.body, fontSize: 11, color: T.textDim, lineHeight: 1.6 }}>
          {filter === "open" ? "No open comments.\nAdd one above or use 💬 on blocks." : filter === "resolved" ? "No resolved comments." : "No comments yet."}
        </div>}
        {Object.entries(grouped).map(([modTitle, comments]) => (
          <div key={modTitle}>
            <div style={{ padding: "6px 12px 2px", fontFamily: FONT.mono, fontSize: 9, fontWeight: 700, color: T.textMuted, letterSpacing: "0.05em", textTransform: "uppercase" }}>{modTitle}</div>
            {comments.map((c) => (
              <div key={c.id} style={{ padding: "4px 12px", display: "flex", alignItems: "flex-start", gap: 5, opacity: c.status === "resolved" ? 0.5 : 1, background: selected.has(c.id) ? T.accent + "10" : "transparent" }}>
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} style={{ marginTop: 2, accentColor: T.accent, flexShrink: 0 }} />
                <span onClick={() => dispatch({ type: c.status === "open" ? "RESOLVE_COMMENT" : "REOPEN_COMMENT", itemId: c.itemId, slideIndex: c.slideIndex, commentId: c.id })} style={{ cursor: "pointer", fontSize: 11, flexShrink: 0, marginTop: 1 }}>{c.status === "open" ? "○" : "●"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontFamily: FONT.body, color: T.text, textDecoration: c.status === "resolved" ? "line-through" : "none", wordBreak: "break-word", lineHeight: 1.4 }}>{c.text}</div>
                  <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 1 }}>
                    <span onClick={() => { dispatch({ type: "SELECT", id: c.itemId, slideIndex: c.slideIndex ?? 0 }); }} style={{ fontSize: 9, fontFamily: FONT.mono, color: T.accent, cursor: "pointer" }}>{c.slideIndex != null ? `s${c.slideIndex + 1}` : "mod"}</span>
                    {c.anchor && <span style={{ fontSize: 9, fontFamily: FONT.mono, color: T.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>"{c.anchor}"</span>}
                  </div>
                </div>
                <span onClick={() => dispatch({ type: c.status === "open" ? "RESOLVE_COMMENT" : "REOPEN_COMMENT", itemId: c.itemId, slideIndex: c.slideIndex, commentId: c.id })} style={{ fontSize: 9, fontFamily: FONT.mono, color: c.status === "open" ? T.green : T.textDim, cursor: "pointer", opacity: 0.6, flexShrink: 0, padding: "1px 3px", borderRadius: 3 }} title={c.status === "open" ? "Resolve" : "Reopen"}>{c.status === "open" ? "✓" : "↩"}</span>
                <span onClick={() => dispatch({ type: "REMOVE_COMMENT", itemId: c.itemId, slideIndex: c.slideIndex, commentId: c.id })} style={{ fontSize: 10, color: T.red, cursor: "pointer", opacity: 0.5, flexShrink: 0, padding: "1px 3px", borderRadius: 3 }} title="Delete">✕</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {/* Footer with batch actions */}
      <div style={{ borderTop: `1px solid ${T.border}`, padding: "6px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
        {selected.size > 0 && <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => { for (const id of selected) { const c = allComments.find((x) => x.id === id); if (c && c.status === "open") dispatch({ type: "RESOLVE_COMMENT", itemId: c.itemId, slideIndex: c.slideIndex, commentId: c.id }); } setSelected(new Set()); }} style={S.btn({ flex: 1, fontSize: 9, padding: "3px 4px" })}>Resolve ({selected.size})</button>
          <button onClick={() => { for (const id of selected) { const c = allComments.find((x) => x.id === id); if (c) dispatch({ type: "REMOVE_COMMENT", itemId: c.itemId, slideIndex: c.slideIndex, commentId: c.id }); } setSelected(new Set()); }} style={S.btn({ flex: 1, fontSize: 9, padding: "3px 4px", color: T.red })}>Delete ({selected.size})</button>
        </div>}
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => { dispatch({ type: "RESOLVE_ALL_COMMENTS" }); }} disabled={openCount === 0} style={S.btn({ flex: 1, fontSize: 9, padding: "3px 4px", opacity: openCount > 0 ? 1 : 0.4 })}>Resolve All</button>
          <button onClick={() => { dispatch({ type: "CLEAR_RESOLVED_COMMENTS" }); }} disabled={resolvedCount === 0} style={S.btn({ flex: 1, fontSize: 9, padding: "3px 4px", opacity: resolvedCount > 0 ? 1 : 0.4 })}>Clear Done</button>
        </div>
        <button onClick={copyForAgent} disabled={openCount === 0} style={S.primaryBtn({ fontSize: 9, padding: "4px 8px", opacity: openCount > 0 ? 1 : 0.4, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 })}>📋 Copy for Agent</button>
      </div>
    </div>
  );
}

// ━━━ New Deck Dialog ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function NewDeckDialog({ onClose, onSubmit }) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");

  // No prompt is fine — that just creates a fresh, blank deck (in a new file).
  // A prompt (short ask or a long pasted README/outline) hands it to Vera to build.
  const submit = () => {
    onSubmit({ title: name.trim() || "Untitled", prompt: prompt.trim(), images: [] });
    onClose();
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 22 }}>⛵</span>
          <span style={{ fontFamily: FONT.display, fontSize: 18, fontWeight: 700, color: T.text }}>New Deck</span>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 18, padding: 4 }}>✕</button>
      </div>

      {/* Deck name */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontFamily: FONT.mono, fontSize: 11, fontWeight: 600, color: T.textMuted, display: "block", marginBottom: 5 }}>Deck Name</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="My Presentation"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          style={{ width: "100%", padding: "10px 12px", fontSize: 15, fontFamily: FONT.body, fontWeight: 600, color: T.text, background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 8, outline: "none", boxSizing: "border-box" }} />
      </div>

      {/* Prompt — optional; also the place to paste long source (README / notes / outline) */}
      <div style={{ marginBottom: 18 }}>
        <label style={{ fontFamily: FONT.mono, fontSize: 11, fontWeight: 600, color: T.textMuted, display: "block", marginBottom: 5 }}>Starting Prompt <span style={{ fontWeight: 400, color: T.textDim }}>— optional; leave empty for a blank deck</span></label>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={"e.g. Create a 10-slide pitch deck on AI agents with sections: Intro, Architecture, Demo, Roadmap.\n\nOr paste a whole README / article / outline here and Vera will build a deck from it.\n\nHave images or files? Drop them in this deck's folder and reference them by name in your prompt."}
          rows={10}
          style={{ width: "100%", padding: "10px 12px", fontSize: 14, fontFamily: FONT.body, color: T.text, background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 8, outline: "none", resize: "vertical", lineHeight: 1.5, boxSizing: "border-box" }} />
        <div style={{ marginTop: 6, fontFamily: FONT.mono, fontSize: 10, color: T.textDim }}>Tip: paste long source text directly. To use attachments, drop the files into this deck's folder and mention them by filename so Vera can reference them.</div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={onClose} style={S.btn({ padding: "8px 16px", fontSize: 14, color: T.textMuted, borderRadius: 6 })}>Cancel</button>
        <button onClick={submit}
          style={{ padding: "8px 20px", fontSize: 14, fontFamily: FONT.body, fontWeight: 600, color: "#fff", background: T.accent, border: "none", borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          {"🚀"} Create & Build
        </button>
      </div>
    </ModalBackdrop>
  );
}

// ━━━ Keyboard Shortcuts Overlay ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const _questionKey = (e) => e.key === "?";
function ShortcutHelp({ onClose }) {
  const groups = [
    { title: "Navigation", items: [
      ["← →", "Previous / next slide"],
      ["Space", "Next slide (same as →)"],
      ["↑ ↓", "Previous / next module"],
      ["", "Auto-crosses lane boundaries"],
      ["[", "Toggle navigator panel"],
      ["G", "Toggle gallery view"],
    ]},
    { title: "Presentation", items: [
      ["F", "Toggle fullscreen"],
      ["F5", "Enter fullscreen (blocks reload)"],
      ["Ctrl+E", "Toggle slides TOC / search (fullscreen)"],
      ["D", "Toggle dark / light theme"],
      ["+ / −", "Scale font up / down"],
      ["0", "Reset font scale"],
    ]},
    { title: "Editing", items: [
      ["⌘Z / Ctrl+Z", "Undo"],
      ["⌘⇧Z / Ctrl+Y", "Redo"],
      ["Click text", "Edit inline on slide"],
      ["⇧/⌘-click", "Multi-select slides in the list"],
      ["Ctrl+C", "Copy selected slide(s) to clipboard"],
      ["Ctrl+V", "Paste slide(s) / image / JSON"],
      ["Right-click", "Slide menu (move / duplicate / delete / hide)"],
      ["Del", "Delete current slide"],
      ["R", "Toggle review / comments"],
    ]},
    { title: "AI Tools", items: [
      ["Shift+I", "Quick improve slide via Vera"],
      ["E", "Quick edit slide by prompt"],
      ["N", "New slide by prompt"],
      ["1 – 4", "Apply variant (preview stays open)"],
      ["0", "Back to original"],
      ["Enter", "Done — close variants, keep applied"],
      ["Esc", "Close variants"],
    ]},
  ];
  return (
    <ModalBackdrop onClose={onClose} extraKeys={_questionKey}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>⌨️</span>
          <span style={{ fontFamily: FONT.display, fontSize: 16, fontWeight: 700, color: T.text }}>Keyboard Shortcuts</span>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 18, padding: 4 }}>✕</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {groups.map((g) => (
          <div key={g.title}>
            <div style={{ fontFamily: FONT.mono, fontSize: 10, fontWeight: 700, color: T.accent, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>{g.title}</div>
            {g.items.map(([key, desc], i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                {key ? <kbd style={{ fontFamily: FONT.mono, fontSize: 10, fontWeight: 600, color: T.text, background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 4, padding: "2px 7px", minWidth: 28, textAlign: "center", whiteSpace: "nowrap" }}>{key}</kbd>
                  : <span style={{ minWidth: 28 }} />}
                <span style={{ fontFamily: FONT.body, fontSize: 11, color: key ? T.textMuted : T.textDim, fontStyle: key ? "normal" : "italic" }}>{desc}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${T.border}`, fontFamily: FONT.mono, fontSize: 9, color: T.textDim, textAlign: "center" }}>Press <kbd style={{ fontFamily: FONT.mono, fontSize: 9, background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 3, padding: "1px 5px" }}>?</kbd> to toggle · <span style={{ color: T.accent }}>VELA v{VELA_VERSION}</span></div>
    </ModalBackdrop>
  );
}

// ━━━ Session Cost Badge ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const fmtCost = (v) => v < 0.01 ? (v * 100).toFixed(1) + "¢" : "$" + v.toFixed(2);
const fmtTokens = (n) => n >= 1000 ? (n / 1000).toFixed(1) + "K" : String(n);

function CostBadge() {
  const [open, setOpen] = useState(false);
  const [, rerender] = useReducer((x) => x + 1, 0);

  useEffect(() => {
    const unsub = velaSessionStats.onChange(rerender);
    return unsub;
  }, []);

  const stats = velaSessionStats;
  const cost = stats.totalCost;
  const calls = stats.totalCalls;

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((v) => !v)} style={{
        ...S.btn({ padding: "4px 10px", fontSize: 11, borderRadius: 4, display: "flex", alignItems: "center", gap: 4 }),
        color: calls > 0 ? T.accent : T.textMuted, fontFamily: FONT.mono, fontWeight: 600,
        background: open ? T.accent + "18" : "transparent",
      }}>{calls > 0 ? `💲${cost < 0.01 ? (cost * 100).toFixed(1) + "¢" : cost.toFixed(2)}` : "💲—"}</button>

      {open && calls > 0 && <>
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 9999,
          background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 10,
          boxShadow: "0 8px 40px rgba(0,0,0,0.5)", backdropFilter: "blur(12px)",
          minWidth: 320, maxWidth: 400, fontFamily: FONT.mono, overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Session Cost</span>
            <span style={{ fontSize: 11, color: T.textDim }}>{calls} call{calls !== 1 ? "s" : ""}</span>
          </div>

          {/* Summary */}
          <div style={{ padding: "10px 16px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, borderBottom: `1px solid ${T.border}` }}>
            <div>
              <div style={{ fontSize: 9, color: T.textDim, textTransform: "uppercase" }}>Total Cost</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.accent }}>{fmtCost(cost)}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: T.textDim, textTransform: "uppercase" }}>Input</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{fmtTokens(stats.totalInputTokens)}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: T.textDim, textTransform: "uppercase" }}>Output</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{fmtTokens(stats.totalOutputTokens)}</div>
            </div>
          </div>

          {/* Cache stats (if any) */}
          {(stats.totalCacheReadTokens > 0 || stats.totalCacheCreateTokens > 0) && (
            <div style={{ padding: "6px 16px", display: "flex", gap: 16, borderBottom: `1px solid ${T.border}`, fontSize: 10, color: T.textDim }}>
              <span>Cache read: {fmtTokens(stats.totalCacheReadTokens)}</span>
              <span>Cache create: {fmtTokens(stats.totalCacheCreateTokens)}</span>
            </div>
          )}

          {/* By type */}
          <div style={{ padding: "8px 16px", borderBottom: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 9, color: T.textDim, textTransform: "uppercase", marginBottom: 6 }}>By Type</div>
            {Object.entries(stats.byType).sort((a, b) => b[1].cost - a[1].cost).map(([type, data]) => (
              <div key={type} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 11 }}>
                <span style={{ color: T.text, minWidth: 80 }}>{type}</span>
                <span style={{ color: T.textDim, minWidth: 40, textAlign: "right" }}>{data.calls}×</span>
                <div style={{ flex: 1, height: 4, background: T.border, borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(100, (data.cost / cost) * 100)}%`, background: T.accent, borderRadius: 2 }} />
                </div>
                <span style={{ color: T.accent, minWidth: 48, textAlign: "right", fontWeight: 600 }}>{fmtCost(data.cost)}</span>
              </div>
            ))}
          </div>

          {/* Call log (last 10) */}
          <div style={{ maxHeight: 180, overflowY: "auto", padding: "6px 0" }}>
            <div style={{ padding: "2px 16px", fontSize: 9, color: T.textDim, textTransform: "uppercase", marginBottom: 4 }}>Recent Calls</div>
            {[...stats.calls].reverse().slice(0, 15).map((c, i) => (
              <div key={i} style={{ padding: "3px 16px", fontSize: 10, display: "flex", gap: 6, alignItems: "center", color: T.textDim }}>
                <span style={{ color: T.text, minWidth: 70 }}>{c.type}</span>
                <span>{fmtTokens(c.input_tokens)}→{fmtTokens(c.output_tokens)}</span>
                {c.tool_calls > 0 && <span style={{ color: T.accent }}>🔧{c.tool_calls}</span>}
                <span style={{ marginLeft: "auto", fontSize: 9 }}>{(c.duration_ms / 1000).toFixed(1)}s</span>
                <span style={{ color: T.accent, fontWeight: 600 }}>{fmtCost(
                  (c.input_tokens * VELA_PRICING.input + c.output_tokens * VELA_PRICING.output
                    + (c.cache_read_tokens || 0) * VELA_PRICING.cacheRead + (c.cache_create_tokens || 0) * VELA_PRICING.cacheCreate) / 1_000_000
                )}</span>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{ padding: "8px 16px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 9, color: T.textDim }}>Sonnet 4 · ${VELA_PRICING.input}/$15 per M tokens</span>
            <button onClick={() => { velaSessionStats.reset(); setOpen(false); }} style={S.btn({ fontSize: 9, padding: "2px 8px", color: T.textDim })}>Reset</button>
          </div>
        </div>
      </>}
    </div>
  );
}

// ━━━ Agent status chip (Neutralino desktop only) ━━━━━━━━━━━━━━━━━━━
// Renders a small footer chip showing the active CLI agent, its detected
// version / model, and the current deck's trust state. Click opens the
// settings dialog below. Feature-gated on window.__velaAgentInfo — other
// runtimes (artifact, serve.py) render nothing.

function AgentStatusChip() {
  const [, rerender] = useReducer((x) => x + 1, 0);
  const [info, setInfo] = useState(() => (typeof window !== "undefined" ? window.__velaAgentInfo : null));
  const [trustState, setTrustState] = useState("unknown");
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    function onUpdate() {
      setInfo(window.__velaAgentInfo || null);
      rerender();
    }
    window.addEventListener("vela-agent-update", onUpdate);
    return () => window.removeEventListener("vela-agent-update", onUpdate);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (typeof window.__velaTrustStatus !== "function") return;
      try {
        const s = await window.__velaTrustStatus();
        if (!cancelled) setTrustState(s);
      } catch {}
    }
    check();
    const id = setInterval(check, 4000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!info) return null; // not in Neutralino runtime

  const { available, label, version, model } = info;
  let statusText, statusColor;
  if (!available) { statusText = "offline"; statusColor = T.textMuted; }
  else if (trustState === "trusted") { statusText = "trusted"; statusColor = T.accent; }
  else if (trustState === "session") { statusText = "session"; statusColor = T.accent; }
  else if (trustState === "denied-session") { statusText = "declined"; statusColor = "#f87171"; }
  else { statusText = "untrusted"; statusColor = "#fbbf24"; }

  const parts = [label];
  if (version) parts.push(`v${version}`);
  if (model) parts.push(model);
  const detail = parts.join(" · ");

  return (
    <>
      <span onClick={() => setShowSettings(true)} title="Agent settings" style={{
        cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
        fontFamily: FONT.mono, fontSize: 9, color: T.textMuted, letterSpacing: "0.03em",
      }}>
        <span style={{ color: T.text, fontWeight: 600 }}>Vera</span>
        <span>·</span>
        <span>{detail}</span>
        <span>·</span>
        <span style={{ color: statusColor, fontWeight: 600 }}>{statusText}</span>
      </span>
      {showSettings && <AgentSettingsDialog onClose={() => setShowSettings(false)} />}
    </>
  );
}

function AgentSettingsDialog({ onClose }) {
  const [info, setInfo] = useState(() => (typeof window !== "undefined" ? window.__velaAgentInfo : null));
  const [trusted, setTrusted] = useState([]);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  // Re-scan for an installed AI agent. The old handler fired a fire-and-forget
  // refresh with no feedback and a muted style, so it read as un-clickable /
  // doing nothing (CR). Now it awaits detection, shows progress, and refreshes.
  async function rescanAgents() {
    if (scanning) return;
    setScanning(true);
    try { await window.__velaAgents?.refresh?.(); }
    catch {}
    finally {
      setScanning(false);
      if (typeof window !== "undefined") setInfo(window.__velaAgentInfo || null);
    }
  }

  async function loadTrusted() {
    if (typeof window.__velaTrustAdmin?.listForCurrentFolder !== "function") return;
    try { setTrusted(await window.__velaTrustAdmin.listForCurrentFolder()); }
    catch { setTrusted([]); }
  }

  useEffect(() => { loadTrusted(); }, []);

  useEffect(() => {
    function onUpdate() { setInfo(window.__velaAgentInfo || null); }
    window.addEventListener("vela-agent-update", onUpdate);
    return () => window.removeEventListener("vela-agent-update", onUpdate);
  }, []);

  async function revoke(relativePath) {
    setBusy(true);
    try { await window.__velaTrustAdmin.revoke(relativePath); await loadTrusted(); }
    finally { setBusy(false); }
  }

  async function revokeAll() {
    if (!confirm("Revoke AI trust for every deck in this folder? Each deck will re-prompt on next AI action.")) return;
    setBusy(true);
    try { await window.__velaTrustAdmin.revokeAll(); await loadTrusted(); }
    finally { setBusy(false); }
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <div style={{ maxHeight: "70vh", overflow: "auto", color: T.text, fontFamily: FONT.body }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, marginBottom: 14 }}>AI agent settings</h2>

        <div style={{ fontSize: 12, color: T.textDim, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Active agent</span>
          <button onClick={rescanAgents} disabled={scanning} style={S.btn({ fontSize: 10, padding: "3px 10px", color: scanning ? T.textDim : T.accent, borderColor: T.accent + "80", cursor: scanning ? "wait" : "pointer", opacity: scanning ? 0.7 : 1 })}>{scanning ? "Scanning…" : "↻ Re-scan"}</button>
        </div>
        <div style={{ padding: "10px 14px", background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 8, marginBottom: 18 }}>
          <div style={{ fontWeight: 600 }}>{info?.label || "—"} <span style={{ fontWeight: 400, color: info?.available ? T.accent : "#f87171", fontSize: 11, marginLeft: 6 }}>{info?.available ? "available" : "not detected"}</span></div>
          <div style={{ fontSize: 11, color: T.textDim, fontFamily: FONT.mono, marginTop: 4 }}>
            {info?.version ? `version ${info.version}` : "version unknown"}
            {info?.model ? ` · last model ${info.model}` : ""}
          </div>
        </div>

        {Array.isArray(info?.providers) && info.providers.length > 1 && (
          <>
            <div style={{ fontSize: 12, color: T.textDim, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Switch agent</div>
            <div style={{ marginBottom: 18 }}>
              {info.providers.map((p) => (
                <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: p.id === info.id ? T.bgInput : "transparent", border: `1px solid ${T.border}`, borderRadius: 8, marginBottom: 6, cursor: "pointer" }}>
                  <input type="radio" name="vela-agent-switch" checked={p.id === info.id} onChange={() => { try { window.__velaConfig?.setAgent?.(p.id); } catch {} }} />
                  <span style={{ fontWeight: 600 }}>{p.label}</span>
                  {p.version && <span style={{ fontSize: 11, color: T.textDim, fontFamily: FONT.mono }}>v{p.version}</span>}
                </label>
              ))}
            </div>
          </>
        )}

        <div style={{ fontSize: 12, color: T.textDim, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Trusted decks in this folder</span>
          {trusted.length > 0 && <button onClick={revokeAll} disabled={busy} style={S.btn({ fontSize: 10, padding: "3px 8px", color: "#f87171" })}>Revoke all</button>}
        </div>
        {trusted.length === 0 ? (
          <div style={{ fontSize: 12, color: T.textDim, padding: "14px 0" }}>No decks trusted yet. The first AI action on a deck will prompt for consent.</div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 14px", maxHeight: 240, overflow: "auto", border: `1px solid ${T.border}`, borderRadius: 8 }}>
            {trusted.map((t) => (
              <li key={t.relativePath} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: `1px solid ${T.border}`, fontSize: 12 }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: FONT.mono, marginRight: 10 }}>{t.relativePath}</div>
                <button onClick={() => revoke(t.relativePath)} disabled={busy} style={S.btn({ fontSize: 10, padding: "3px 8px", color: T.textMuted })}>Revoke</button>
              </li>
            ))}
          </ul>
        )}

        <div style={{ fontSize: 11, color: T.textDim, borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
          Trust decisions are stored in <code style={{ fontFamily: FONT.mono }}>&lt;folder&gt;/.vela/trust.json</code> and only apply on this machine. Delete the folder to reset.
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button onClick={onClose} style={S.btn({ padding: "6px 14px" })}>Close</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

// ━━━ Main ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ━━━ Item Fingerprint (for merge detection) ━━━━━━━━━━━━━━━━━━━━━━━
function itemFingerprint(item) {
  const str = JSON.stringify(item.slides || []);
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
  return h.toString(36);
}

// ━━━ Merge Patch Dialog ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function MergePatchDialog({ localDeck, patchDeck, onComplete }) {
  // Compute diffs
  const localItems = new Map();
  for (const lane of localDeck.lanes || []) for (const item of lane.items || []) {
    localItems.set(item.id, { item, laneId: lane.id, laneTitle: lane.title, fp: itemFingerprint(item) });
  }
  const patchItems = new Map();
  for (const lane of patchDeck.lanes || []) for (const item of lane.items || []) {
    patchItems.set(item.id, { item, laneId: lane.id, laneTitle: lane.title, fp: itemFingerprint(item) });
  }

  // Categorize
  const autoKeep = []; // only in local
  const autoAdd = [];  // only in patch
  const unchanged = []; // same hash
  const conflicts = []; // both exist, different hash

  for (const [id, local] of localItems) {
    const patch = patchItems.get(id);
    if (!patch) { autoKeep.push(local); }
    else if (local.fp === patch.fp) { unchanged.push({ local, patch }); }
    else { conflicts.push({ id, local, patch }); }
  }
  for (const [id, patch] of patchItems) {
    if (!localItems.has(id)) { autoAdd.push(patch); }
  }

  // New lanes only in patch
  const localLaneIds = new Set((localDeck.lanes || []).map(l => l.id));
  const newLanes = (patchDeck.lanes || []).filter(l => !localLaneIds.has(l.id));

  // Track conflict resolutions: "mine" | "theirs" | "both"
  const [resolutions, setResolutions] = React.useState(() => {
    const m = {};
    for (const c of conflicts) m[c.id] = "theirs"; // default to new version
    return m;
  });

  const setRes = (id, val) => setResolutions(prev => ({ ...prev, [id]: val }));

  const handleApply = () => {
    // Start from local deck as base
    const merged = JSON.parse(JSON.stringify(localDeck));

    // Apply conflict resolutions
    for (const c of conflicts) {
      const res = resolutions[c.id];
      if (res === "mine") continue; // keep as-is
      // Find item in merged deck and replace or add
      for (const lane of merged.lanes) {
        const idx = lane.items.findIndex(i => i.id === c.id);
        if (idx >= 0) {
          if (res === "theirs") {
            lane.items[idx] = { ...c.patch.item };
          } else if (res === "both") {
            // Insert new version right after the existing one with a new id
            const copy = { ...c.patch.item, id: uid(), title: c.patch.item.title + " (new)" };
            lane.items.splice(idx + 1, 0, copy);
          }
          break;
        }
      }
    }

    // Add new items from patch into matching or new lanes
    for (const entry of autoAdd) {
      let targetLane = merged.lanes.find(l => l.id === entry.laneId);
      if (!targetLane) {
        const patchLane = (patchDeck.lanes || []).find(l => l.id === entry.laneId);
        targetLane = { id: entry.laneId, title: patchLane?.title || "Imported", collapsed: false, items: [] };
        merged.lanes.push(targetLane);
      }
      targetLane.items.push({ ...entry.item });
    }

    // Add entirely new lanes (with items already included)
    for (const nl of newLanes) {
      if (!merged.lanes.find(l => l.id === nl.id)) {
        merged.lanes.push(JSON.parse(JSON.stringify(nl)));
      }
    }

    // Update deck title if user hasn't changed it
    if (patchDeck.deckTitle && localDeck.deckTitle === "Untitled") {
      merged.deckTitle = sanitizeDeckTitle(patchDeck.deckTitle);
    }

    // Store patchId so we don't ask again
    merged._lastPatchId = patchDeck._patchId || "";

    onComplete(merged);
  };

  const totalAuto = autoKeep.length + autoAdd.length + unchanged.length;

  return (
    <ModalBackdrop onClose={() => onComplete(null)}>
      <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 20 }}>⛵</span>
          <span style={{ fontFamily: FONT.display, fontSize: 18, fontWeight: 700 }}>New Deck Version Available</span>
        </div>

        {/* Auto-resolved summary */}
        <div style={{ fontFamily: FONT.mono, fontSize: 11, color: T.textDim, marginBottom: 12, lineHeight: 1.6 }}>
          {autoAdd.length > 0 && <div style={{ color: "#34d399" }}>+ {autoAdd.length} new module{autoAdd.length > 1 ? "s" : ""} will be added</div>}
          {autoKeep.length > 0 && <div style={{ color: "#60a5fa" }}>● {autoKeep.length} module{autoKeep.length > 1 ? "s" : ""} you added — keeping</div>}
          {unchanged.length > 0 && <div style={{ color: T.textDim }}>= {unchanged.length} unchanged</div>}
          {newLanes.length > 0 && <div style={{ color: "#34d399" }}>+ {newLanes.length} new section{newLanes.length > 1 ? "s" : ""} will be added</div>}
        </div>

        {/* Conflicts — interactive */}
        {conflicts.length > 0 && <>
          <div style={{ fontFamily: FONT.mono, fontSize: 10, fontWeight: 700, color: "#f59e0b", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
            {conflicts.length} module{conflicts.length > 1 ? "s" : ""} changed in both — choose:
          </div>
          {conflicts.map(c => {
            const res = resolutions[c.id];
            const localSlides = c.local.item.slides?.length || 0;
            const patchSlides = c.patch.item.slides?.length || 0;
            const localTime = (c.local.item.slides || []).reduce((a, s) => a + (s.duration || 0), 0);
            const patchTime = (c.patch.item.slides || []).reduce((a, s) => a + (s.duration || 0), 0);
            return (
              <div key={c.id} style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px", marginBottom: 8, background: T.bg }}>
                <div style={{ fontFamily: FONT.display, fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                  📦 {c.local.item.title || c.id}
                  <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim, marginLeft: 8 }}>in {c.local.laneTitle}</span>
                </div>
                <div style={{ display: "flex", gap: 12, fontFamily: FONT.mono, fontSize: 10, color: T.textDim, marginBottom: 8 }}>
                  <span>Yours: {localSlides} slide{localSlides !== 1 ? "s" : ""}, {localTime}s</span>
                  <span>New: {patchSlides} slide{patchSlides !== 1 ? "s" : ""}, {patchTime}s</span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {["mine", "theirs", "both"].map(opt => (
                    <button key={opt} onClick={() => setRes(c.id, opt)} style={{
                      padding: "4px 10px", fontSize: 11, fontFamily: FONT.body, fontWeight: res === opt ? 700 : 400,
                      background: res === opt ? (opt === "mine" ? "#3b82f620" : opt === "theirs" ? "#34d39920" : "#f59e0b20") : "transparent",
                      color: res === opt ? (opt === "mine" ? "#60a5fa" : opt === "theirs" ? "#34d399" : "#f59e0b") : T.textDim,
                      border: `1px solid ${res === opt ? (opt === "mine" ? "#3b82f650" : opt === "theirs" ? "#34d39950" : "#f59e0b50") : T.border}`,
                      borderRadius: 4, cursor: "pointer"
                    }}>
                      {opt === "mine" ? "Keep Mine" : opt === "theirs" ? "Use New" : "Keep Both"}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </>}

        {/* No conflicts */}
        {conflicts.length === 0 && (autoAdd.length > 0 || newLanes.length > 0) && (
          <div style={{ fontFamily: FONT.body, fontSize: 14, color: T.textMuted, marginBottom: 8 }}>
            No conflicts — new content will be merged alongside your existing deck.
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16, paddingTop: 12, borderTop: `1px solid ${T.border}` }}>
          <button onClick={() => onComplete(null)} style={{ padding: "6px 16px", fontSize: 14, fontFamily: FONT.body, background: "transparent", color: T.textDim, border: `1px solid ${T.border}`, borderRadius: 6, cursor: "pointer" }}>
            Skip
          </button>
          <button onClick={() => { const p = JSON.parse(JSON.stringify(patchDeck)); p._lastPatchId = patchDeck._patchId || ""; onComplete(p); }} style={{ padding: "6px 16px", fontSize: 14, fontFamily: FONT.body, background: "transparent", color: "#f59e0b", border: `1px solid #f59e0b50`, borderRadius: 6, cursor: "pointer" }}>
            Load New (replace all)
          </button>
          <button onClick={handleApply} style={{ padding: "6px 16px", fontSize: 14, fontFamily: FONT.body, fontWeight: 600, background: T.accent, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
            Merge
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

