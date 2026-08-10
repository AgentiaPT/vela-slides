// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
// ━━━ Image Compression ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function compressImage(dataUrl, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

let IMG_SETTINGS = { maxWidth: defaultBranding.imgMaxWidth, quality: defaultBranding.imgQuality };
const compressSlideImage = (dataUrl) => compressImage(dataUrl, IMG_SETTINGS.maxWidth, IMG_SETTINGS.quality);

// Natural aspect ratio (width / height) of a data URL image. Resolves 1 on error
// so callers can treat undecodable images as square. Used by paste heuristics to
// decide stacked-vs-side-by-side layout (wide images read better stacked below).
const imageAspect = (dataUrl) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => resolve(img.height ? img.width / img.height : 1);
  img.onerror = () => resolve(1);
  img.src = dataUrl;
});

// Decide the layout for a slide an image is being pasted onto. Returns the layout
// the slide should carry: an explicit author layout is preserved; an empty/mostly-
// title slide or a wide landscape image (aspect >= 1.6, e.g. screenshots) stacks
// the image below ("stack"); otherwise the slide is promoted to "image-right" so
// the image sits beside the existing body content. aspect = image width / height.
const PASTE_TITLE_BLOCKS = new Set(["heading", "text", "subtitle", "badge", "quote"]);
function pasteImageLayout(slide, aspect, n) {
  const layout = slide && slide.layout;
  if (layout && layout !== "stack") return layout; // respect explicit author layout
  const body = ((slide && slide.blocks) || []).filter((b) => b.type !== "image" && b.type !== "spacer" && b.type !== "divider");
  const mostlyTitle = body.length <= 2 && body.every((b) => PASTE_TITLE_BLOCKS.has(b.type));
  const hasContent = body.length > 0 && !mostlyTitle;
  // Heavy body text + a grid of images (>=3): don't cram the grid into a half.
  // Keep the slide stacked so the text reads as a full-width header and the
  // image run grids full-width below it (the renderer auto-grids the run).
  if (hasContent && n >= 3) return "stack";
  const wide = aspect >= 1.6;
  return (!mostlyTitle && !wide) ? "image-right" : "stack";
}

// Columns for a run of `n` images, by region. "full" = image-only slide or a
// full-width run below text; "half" = the image column beside body content.
// Count-driven so the arrangement is a pure function of the run length (paste,
// AI, or import all self-heal, and removal re-grids for free — no stored geometry).
//   full:  1→1 solo · 2→1x2 · 3→1x3 · 4→2x2 · 5→3+2 (last row centered)
//   half:  1→1 · >=2→2 (2-up, incomplete last row centered)
function gridColsFor(n, region) {
  n = Math.max(1, n | 0);
  if (region === "half") return n <= 1 ? 1 : 2;
  return ({ 1: 1, 2: 2, 3: 3, 4: 2, 5: 3 })[n] || 3;
}

// ━━━ Status & Importance Meta ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const STATUSES = ["todo", "done", "signed-off"];
const STATUS_META = {
  todo: { label: "To Do", icon: "○", next: "done" },
  done: { label: "Done", icon: "●", next: "signed-off" },
  "signed-off": { label: "Signed Off", icon: "✦", next: "todo" },
};
const IMP = {
  must: { label: "Must", dot: "#ef4444" },
  should: { label: "Should", dot: "#f59e0b" },
  nice: { label: "Nice", dot: "#64748b" },
};

// ━━━ Themes ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const themes = {
  dark: {
    bg: "#060a14", bgPanel: "#0c1221", bgCard: "#111827", bgInput: "#0a0f1c",
    border: "#1a2540", borderLight: "#243050", accent: "#3B82F6", accentGlow: "rgba(59,130,246,0.12)",
    text: "#e2e8f0", textMuted: "#7a8ba4", textDim: "#4a5a72",
    green: "#10b981", purple: "#a78bfa", red: "#ef4444", amber: "#f59e0b",
    slideBg: "#0a0f1c", codeBg: "#0d1117", isDark: true,
  },
  light: {
    bg: "#f8fafc", bgPanel: "#ffffff", bgCard: "#ffffff", bgInput: "#f1f5f9",
    border: "#e2e8f0", borderLight: "#cbd5e1", accent: "#2563EB", accentGlow: "rgba(37,99,235,0.08)",
    text: "#0f172a", textMuted: "#64748b", textDim: "#94a3b8",
    green: "#059669", purple: "#7c3aed", red: "#ef4444", amber: "#d97706",
    slideBg: "#f1f5f9", codeBg: "#f1f5f9", isDark: false,
  },
};
let T = themes.dark;
const statusColor = (s) => ({ todo: T.textDim, done: T.green, "signed-off": T.purple }[s]);
const FONT = { display: "'Sora', sans-serif", body: "'DM Sans', sans-serif", mono: "'Space Mono', monospace" };

// Auto-generated module title card ("present card"). Shown as a virtual slide in
// presentation mode and exported to PDF so the deck exports exactly as presented.
function buildTitleCardSlide(item, lane, branding) {
  const accent = branding?.accentColor || T.accent;
  const slideCount = (item.slides || []).length;
  const totalTime = (item.slides || []).reduce((a, s) => a + (s.duration || 0), 0);
  const timeStr = totalTime > 0 ? `${Math.floor(totalTime / 60)}m ${totalTime % 60}s` : "";
  return {
    _virtual: true,
    bg: "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)",
    color: "#0f172a", accent,
    align: "center", verticalAlign: "center", padding: "60px 80px", gap: 20,
    blocks: [
      ...(lane ? [{ type: "badge", text: (lane.title || "").toUpperCase(), bg: accent + "18", color: accent, icon: "Layers" }] : []),
      { type: "heading", text: item.title, size: "4xl", color: "#0f172a" },
      ...(timeStr ? [{ type: "text", text: `${slideCount} slide${slideCount !== 1 ? "s" : ""} · ${timeStr}`, size: "lg", color: "#64748b" }] : [{ type: "text", text: `${slideCount} slide${slideCount !== 1 ? "s" : ""}`, size: "lg", color: "#64748b" }]),
      { type: "spacer", h: 8 },
    ],
    duration: 3,
  };
}

// ━━━ Vela Logo Icon ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function VelaIcon({ size = 18, color }) {
  const c = color || T.accent;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
    <path d="M12 2 L12 22" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
    <path d="M12 3 Q20 8 14 18 L12 18 Z" fill={c} opacity="0.85" />
    <path d="M12 6 Q6 10 10 18 L12 18 Z" fill={c} opacity="0.4" />
    <path d="M8 22 L16 22" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
  </svg>;
}
const BASE_SIZES = { xs: "0.85rem", sm: "0.95rem", md: "1.05rem", lg: "1.2rem", xl: "1.5rem", "2xl": "2rem", "3xl": "2.6rem", "4xl": "3.2rem" };

// ━━━ Style Factories & Helpers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const saveKV = (k, v) => window.storage.set(k, JSON.stringify(v)).catch((e) => { dbg("Storage error:", e); });
const delKV = (k) => window.storage.delete(k).catch((e) => { dbg("Storage delete error:", e); });
const extractSave = (s) => { const { chatLoading, fullscreen, lastDebug, _bootstrap, veraMode, teacherHistory, teacherLoading, reviewMode, commentsPanelOpen, ...rest } = s; if (rest.chatMessages) rest.chatMessages = rest.chatMessages.filter((m) => !m._system); return rest; };

// Distributed storage: master has items with metadata only (no slides)
const extractMaster = (s) => {
  const { chatLoading, fullscreen, lastDebug, ...rest } = s;
  return {
    ...rest,
    _version: 2,
    lanes: rest.lanes.map((l) => ({
      ...l,
      items: l.items.map(({ slides, ...meta }) => meta),
    })),
  };
};
// Collect all comments across items and slides, enriched with context
function collectComments(lanes, filter) {
  const results = [];
  for (const lane of lanes) {
    for (const item of lane.items) {
      for (const c of (item.comments || [])) {
        if (!filter || filter(c)) results.push({ ...c, itemId: item.id, itemTitle: item.title, laneTitle: lane.title, slideIndex: null });
      }
      for (let si = 0; si < (item.slides || []).length; si++) {
        for (const c of (item.slides[si].comments || [])) {
          if (!filter || filter(c)) results.push({ ...c, itemId: item.id, itemTitle: item.title, laneTitle: lane.title, slideIndex: si });
        }
      }
    }
  }
  return results;
}

// Format comments as structured markdown for agent consumption
function formatCommentsForAgent(lanes) {
  const open = collectComments(lanes, (c) => c.status === "open");
  if (open.length === 0) return "No open comments.";
  const grouped = {};
  for (const c of open) {
    const key = c.itemTitle;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(c);
  }
  let md = `## Comments (${open.length} open)\n`;
  for (const [mod, comments] of Object.entries(grouped)) {
    md += `\n### Module: "${mod}"\n`;
    for (const c of comments) {
      const loc = c.slideIndex != null ? `Slide ${c.slideIndex + 1}` : "(module)";
      const anchor = c.anchor ? ` ["${c.anchor}"]` : "";
      md += `- ${loc}${anchor}: ${c.text}\n`;
    }
  }
  return md;
}

// All item IDs across all lanes
const allItemIds = (lanes) => { const ids = []; for (const l of lanes) for (const i of l.items) ids.push(i.id); return ids; };
// Find an item by id across lanes
const findItem = (lanes, id) => { for (const l of lanes) { const it = l.items.find((i) => i.id === id); if (it) return it; } return null; };
const fmtSize = (b) => b < 1024 ? `${b}B` : b < 1048576 ? `${(b / 1024).toFixed(1)}KB` : `${(b / 1048576).toFixed(2)}MB`;
const fmtTime = (s) => { if (!s || s <= 0) return ""; const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60; if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`; if (m > 0) return sec > 0 ? `${m}m ${sec}s` : `${m}m`; return `${sec}s`; };
// Compact, minutes-only duration for the top header (leaves room for the slide
// count). Rounds to the nearest minute; anything >0 but under a minute shows "<1m".
const fmtTimeMin = (s) => { if (!s || s <= 0) return ""; const totalMin = Math.round(s / 60); if (totalMin <= 0) return "<1m"; const h = Math.floor(totalMin / 60); const m = totalMin % 60; if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`; return `${m}m`; };
// Slide visibility helpers (CR: hide/unhide slides). Hidden slides are excluded
// from presentation counts, totals, and presenter navigation, but remain in the
// editor list so they can be unhidden.
const visibleSlides = (slides) => (slides || []).filter((s) => !(s && s.hidden));
const sumDurations = (slides) => (slides || []).reduce((s, sl) => s + (sl.duration || 0), 0);
const sumVisibleDurations = (slides) => visibleSlides(slides).reduce((s, sl) => s + (sl.duration || 0), 0);
const S = {
  btn: (o = {}) => ({ padding: "3px 8px", fontSize: 10, fontFamily: FONT.mono, fontWeight: 700, background: "transparent", border: `1px solid ${T.border}`, borderRadius: 3, color: T.textDim, cursor: "pointer", ...o }),
  primaryBtn: (o = {}) => ({ padding: "4px 10px", fontSize: 10, fontFamily: FONT.mono, fontWeight: 700, background: T.accent, color: "#fff", border: "none", borderRadius: 3, cursor: "pointer", ...o }),
  cancelBtn: (o = {}) => ({ padding: "4px 8px", fontSize: 10, background: "transparent", color: T.textDim, border: `1px solid ${T.border}`, borderRadius: 3, cursor: "pointer", ...o }),
  input: (o = {}) => ({ flex: 1, padding: "4px 8px", fontSize: 12, fontFamily: FONT.body, background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 3, color: T.text, outline: "none", ...o }),
  panel: (o = {}) => ({ borderBottom: `1px solid ${T.border}`, background: T.bgPanel, ...o }),
};

// ━━━ CSS Generator ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const getCss = () => `
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{opacity:0.4;transform:scale(1)}50%{opacity:1;transform:scale(1.15)}}
@keyframes loading-bar{0%{transform:translateX(-100%)}50%{transform:translateX(60%)}100%{transform:translateX(-100%)}}
::-webkit-scrollbar{width:5px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:${T.border};border-radius:3px}
.vela-wide-scroll::-webkit-scrollbar{width:10px} .vela-wide-scroll::-webkit-scrollbar-thumb{background:${T.textDim};border-radius:5px}
.concept-row{transition:all .15s;cursor:pointer} .concept-row:hover{background:${T.accentGlow}!important} .concept-row.selected{background:${T.accent}18!important;border-left-color:${T.accent}!important}
.status-btn{cursor:pointer;transition:transform .15s} .status-btn:hover{transform:scale(1.3)}
.slide-nav-btn{opacity:.4;transition:opacity .2s;cursor:pointer} .slide-nav-btn:hover{opacity:1}
.imp-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.add-btn{transition:all .15s} .add-btn:hover{background:${T.accent}!important;color:#fff!important}
.lane-header{transition:background .15s} .lane-header:hover{background:${T.bgCard}!important}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}} .fade-in{animation:fadeIn .3s ease-out}
@keyframes slideTransitionFade{from{opacity:0;transform:scale(0.985)}to{opacity:1;transform:scale(1)}} .slide-transition-fade{animation:slideTransitionFade .25s ease-out both}
@keyframes navToastIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes navToastOut{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-6px)}}
.nav-toast-in{animation:navToastIn .25s ease-out forwards}
.nav-toast-out{animation:navToastOut .3s ease-in forwards}
@keyframes magicReveal{
  0%{opacity:0;transform:scale(0.96);filter:blur(6px) brightness(1.3)}
  40%{opacity:1;transform:scale(1.01);filter:blur(0px) brightness(1.15)}
  70%{transform:scale(1.0);filter:blur(0px) brightness(1.05)}
  100%{transform:scale(1);filter:blur(0px) brightness(1)}
}
@keyframes shimmerSweep{
  0%{left:-100%}
  60%{left:100%}
  100%{left:100%}
}
@keyframes glowPulse{
  0%{box-shadow:0 0 0px rgba(59,130,246,0),0 0 0px rgba(167,139,250,0)}
  30%{box-shadow:0 0 24px rgba(59,130,246,0.4),0 0 48px rgba(167,139,250,0.2)}
  100%{box-shadow:0 0 0px rgba(59,130,246,0),0 0 0px rgba(167,139,250,0)}
}
.magic-reveal{animation:magicReveal .6s cubic-bezier(0.16,1,0.3,1) forwards, glowPulse 1.2s ease-out forwards;position:relative;overflow:hidden}
.magic-reveal::after{content:'';position:absolute;top:0;left:-100%;width:60%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.12),rgba(167,139,250,0.08),transparent);animation:shimmerSweep 1s ease-out .15s forwards;z-index:15;pointer-events:none}
@keyframes stg{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes veraScan{0%{left:-60%}100%{left:160%}}
@keyframes veraPulse{0%,100%{filter:brightness(1) saturate(1)}50%{filter:brightness(1.08) saturate(1.2)}}
/* Type-register --vera-accent as a real <color>: an @property-registered custom
   property is subject to CSS's own syntax check at the CSS layer, so even a value
   that reached this point outside the normal cssColor()-encoded render path (the
   set-property call itself, part-slides.jsx) falls back to initial-value instead
   of being usable in var()/color-mix() below — a CSS-native backstop alongside the
   JS-side encoder. inherits:true is required: the ::before/::after sweeps below
   consume the value on descendant pseudo-elements, not the declaring node itself. */
@property --vera-accent{syntax:"<color>";inherits:true;initial-value:#3b82f6}
/* CR5: unified "Vera is working on this slide" scan. The sweep tint follows the
   slide accent via --vera-accent (set on the wrapper), falling back to the
   original Vera blue/violet when unset or where color-mix is unsupported. */
.vera-thinking{position:relative;overflow:hidden;animation:veraPulse 2s ease-in-out infinite}
.vera-thinking::before{content:'';position:absolute;top:0;left:-60%;width:40%;height:100%;background:linear-gradient(90deg,transparent,rgba(59,130,246,0.06),rgba(167,139,250,0.12),rgba(59,130,246,0.06),transparent);background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--vera-accent,#3b82f6) 8%,transparent),color-mix(in srgb,var(--vera-accent,#a78bfa) 16%,transparent),color-mix(in srgb,var(--vera-accent,#3b82f6) 8%,transparent),transparent);animation:veraScan 2s ease-in-out infinite;z-index:15;pointer-events:none}
.vera-thinking::after{content:'';position:absolute;top:0;left:-60%;width:30%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.04),transparent);animation:veraScan 2s ease-in-out .6s infinite;z-index:15;pointer-events:none}
/* CR5: reduced-motion — drop the sweep/breathing but keep a calm static accent
   glow so the "AI is on this slide" signal survives; completion swaps instantly. */
@media (prefers-reduced-motion: reduce){
  .vera-thinking{animation:none;box-shadow:inset 0 0 0 2px rgba(59,130,246,0.4);box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--vera-accent,#3b82f6) 40%,transparent)}
  .vera-thinking::before,.vera-thinking::after{animation:none;opacity:.4}
  .magic-reveal,.magic-reveal::after{animation:none}
}
[class^="stg-"]{max-width:100%;box-sizing:border-box}
.stg-1{animation:stg .4s ease-out .05s both}.stg-2{animation:stg .4s ease-out .12s both}.stg-3{animation:stg .4s ease-out .19s both}
.stg-4{animation:stg .4s ease-out .26s both}.stg-5{animation:stg .4s ease-out .33s both}.stg-6{animation:stg .4s ease-out .4s both}.stg-7{animation:stg .4s ease-out .47s both}
.mob-tab{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 0;flex:1;cursor:pointer;border:none;background:transparent;font-family:${FONT.mono};font-size:8px;font-weight:600;letter-spacing:0.03em;transition:color .15s}
.mob-tab-active{color:${T.accent}!important}
.vela-pdf-capture [data-zoom-badge]{display:none!important}
`;

// ━━━ Mobile Detection ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const MOBILE_BP = 500;
function useIsMobile() {
  const [m, setM] = useState(() => {
    if (typeof window === "undefined") return false;
    const isTouch = window.matchMedia?.("(pointer: coarse)")?.matches;
    const isNarrow = window.innerWidth < MOBILE_BP;
    return isNarrow || (isTouch && window.innerWidth < 600);
  });
  useEffect(() => {
    const check = () => {
      const isTouch = window.matchMedia?.("(pointer: coarse)")?.matches;
      const isNarrow = window.innerWidth < MOBILE_BP;
      setM(isNarrow || (isTouch && window.innerWidth < 600));
    };
    window.addEventListener("resize", check);
    // Also re-check on orientation change (mobile rotation)
    window.addEventListener("orientationchange", () => setTimeout(check, 150));
    return () => { window.removeEventListener("resize", check); };
  }, []);
  return m;
}

function useSwipe(ref, { onLeft, onRight, threshold = 50 } = {}) {
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let startX = 0, startY = 0;
    const onStart = (e) => { const t = e.touches[0]; startX = t.clientX; startY = t.clientY; };
    const onEnd = (e) => {
      const t = e.changedTouches[0]; const dx = t.clientX - startX; const dy = t.clientY - startY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > threshold) {
        if (dx < 0 && onLeft) onLeft();
        if (dx > 0 && onRight) onRight();
      }
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    return () => { el.removeEventListener("touchstart", onStart); el.removeEventListener("touchend", onEnd); };
  }, [ref, onLeft, onRight, threshold]);
}

// ━━━ Shared Prompt Constants (deduped from 3 system prompts) ━━━━━━━
const BLOCK_REFERENCE = `Slide: { blocks: [...], bg?, bgGradient?: "linear-gradient(...)", color?, accent?, align?, verticalAlign?, padding?, gap?, duration?: seconds_integer, layout?: "stack"|"image-right"|"image-left"|"cols", contentFlex?, imageFlex?, splitGap?, imageCols?: 1-6, L?: [...], R?: [...] }
Numeric slide fields are range-checked on load: imageCols is an integer 1-6, gap/splitGap 0-200, contentFlex/imageFlex 0.1-20. imageCols pins the column count for a run of adjacent image blocks (omit for automatic).
Layout: "stack" (default) = vertical column. "image-right"/"image-left" = splits content blocks and image blocks side-by-side. "cols" = explicit two-column layout using L (left blocks) and R (right blocks) arrays. blocks renders full-width above columns (optional header). contentFlex/imageFlex control column ratio (default 1:1). splitGap controls gap between columns (default 32).
Inline formatting: All text supports **bold**, *italic*, ***bold+italic*** using markdown syntax (also __bold__ and _italic_). Use in headings, text, bullets, callouts, etc.
Links: ANY block can have an optional "link" property: {type:"text", text:"Read the paper", link:"https://..."} — renders clickable. For sources/citations, ALWAYS use a descriptive text block or badge with link property instead of putting raw URLs in text. E.g. {type:"badge", text:"📎 Yao et al., ReAct (2022)", icon:"ExternalLink", link:"https://arxiv.org/abs/2210.03629"} or {type:"text", text:"Source: Snorkel AI Blog", size:"sm", link:"https://snorkel.ai/blog/..."}
Block types:
- heading: {type:"heading", text, size:"xs|sm|md|lg|xl|2xl|3xl|4xl", color?, weight?, align?, icon?:"Zap", iconColor?}
- text: {type:"text", text, size?, color?, bold?, italic?, align?, maxWidth?}
- bullets: {type:"bullets", items:["string" or {text, icon?:"CheckCircle", link?:"https://..."},...], size?, dotColor?, gap?, color?}
- image: {type:"image", src, caption?, maxWidth?, shadow?, rounded?}
- code: {type:"code", text:"code here", label?"JAVASCRIPT", size?, bg?, color?}
- grid: {type:"grid", cols:1|2|3, gap?, items:[{blocks:[...], bg?, padding?, borderRadius?, border?, style?, align?, direction?:"row"|"column"}]}
- callout: {type:"callout", text, title?, bg?, border?, color?, icon?:"AlertTriangle"}
- metric: {type:"metric", value:"42", label?"METRIC NAME", size?"3xl", color?, labelColor?, icon?:"TrendingUp", iconColor?}
- quote: {type:"quote", text, author?, size?, color?}
- badge: {type:"badge", text:"LABEL", color?, bg?, icon?:"Star"}
- icon: {type:"icon", name:"Zap", size?"sm|md|lg|xl", color?, bg?, circle?:true, label?, border?}
- icon-row: {type:"icon-row", items:[{icon:"Zap", title:"Title", text?"Description", link?:"https://...", iconColor?, iconBg?}], cols?:1|2|3, iconBg?, iconColor?, iconShape?"circle|square", gap?, titleSize?, textSize?}  — USE cols:2 for 4+ items with short text to fill horizontal space
- flow: {type:"flow", items:[{icon?:"FileText", label:"Step Name", sublabel?:"optional detail"},...], arrowColor?, direction?"horizontal|vertical", connectorStyle?"arrow|dashed|line", iconBg?, labelColor?, sublabelColor?, loop?:true, loopLabel?:"repeat until done", loopColor?, loopStyle?:"dashed|dotted|solid"}
- svg: {type:"svg", markup:"<svg viewBox='0 0 400 160' xmlns='http://www.w3.org/2000/svg'>...</svg>", maxWidth?:"80%", align?:"center", caption?, captionColor?, captionSize?:"sm", bg?, padding?, rounded?:true} — Use {{color}}, {{accent}}, {{bg}}, {{muted}} tokens for theme colors. For diagrams that structured blocks can't express (loops, fan-outs, meshes, variable-width layers).
- table: {type:"table", headers:["Col1","Col2",...], rows:[["cell","cell",...]], striped?:true, headerBg?, headerColor?, cellColor?, borderColor?, size?}
- progress: {type:"progress", items:[{label:"Python", value:90, color?"#3b82f6"},...], showValue?:true, trackColor?, height?, labelColor?, size?}
- steps: {type:"steps", items:[{title:"Step 1", text?"Description"},...], lineColor?, activeStep?:2, numberColor?, titleColor?, textColor?}
- tag-group: {type:"tag-group", items:[{text:"React", color?"#61dafb", icon?:"Code"},...], variant?"filled|outline|subtle", gap?, size?}
- timeline: {type:"timeline", items:[{date:"Q1 2025", title:"Alpha", text?"Internal testing"},...], lineColor?, dotColor?, dateColor?, titleColor?, textColor?, direction?"horizontal|vertical"}
- spacer: {type:"spacer", h:16}
- divider: {type:"divider", color?, spacing?}`;

const ICON_LIST = `Icons: any PascalCase Lucide name (1000+ available). Common: Zap, Star, CheckCircle, ArrowRight, Brain, Rocket, Shield, Target, Clock, Users, Heart, Globe, Code, Database, Settings, Lightbulb, AlertTriangle, TrendingUp, BarChart, Lock, Eye, Cpu, Layers, GitBranch, Terminal, Puzzle, Sparkles, Award, Book, MessageSquare, Send, Play, Pause, RefreshCw, Search, Filter, Download, Upload, Share2, Link, Bookmark, Flag, Bell, Calendar, Map, Compass, Coffee, Pen, Palette, Camera, Mic, Music, Film, Monitor, Smartphone, Tablet, Wifi, Cloud, Server, HardDrive, Box, Package, Truck, ShoppingCart, DollarSign, CreditCard, PieChart, Activity, Thermometer, Umbrella, Sun, Moon, Droplets, Wind, Flame, Leaf, TreePine, Mountain, Waves, Check, XCircle, Info, HelpCircle, ExternalLink, Copy, Trash2, Edit, Save, Home, Briefcase, GraduationCap, Trophy, MapPin, Phone, Mail, Tag, File, Clipboard, LineChart, TrendingDown, Anchor, Scissors, Image, ArrowUp, ArrowDown, ArrowLeft, ChevronUp, ChevronDown`;

const DESIGN_RULES = `### DESIGN RULES — follow these for every slide (user instructions override these if conflicting)
- Every slide MUST have a bg or bgGradient. Choose colors that match the overall theme (dark or light as instructed).
- Set color (text) and accent per-slide to ensure good contrast against the bg.
- USE THE FULL CANVAS WIDTH. Content should span at least 80% of the 960px width. Avoid narrow left-hugging layouts.
  - For 4+ icon-row items with short text: set cols:2 on the icon-row block to spread across the slide
  - For short text items: prefer grid (2-3 cols) with icon blocks, or icon-row with cols:2
  - Set padding to "36px 48px" or wider — never let content cluster in one corner
  - Headings and text blocks: use align:"left" with full width, not constrained maxWidth
- Use badge blocks for section labels/tags above headings — add icon prop for polish
- Use spacer blocks (h: 8-24) between sections for breathing room
- Size hierarchy: 3xl-4xl for title slides, 2xl for section headings, lg-md for body, sm-xs for labels
- Use callout blocks with custom bg/border colors and icons for key insights
- Use metric blocks for stats/numbers with large size, accent color, and icon
- Use grid blocks (cols: 2 or 3) for side-by-side comparisons with icon blocks inside
- Use icon-row blocks instead of bullets for feature lists — much more visual
- When icon-row has 4+ items with short text, PREFER grid with 2 cols of icon-row or icon blocks to fill horizontal space
- Use flow blocks for pipelines, architectures, processes, funnels — shows relationships with arrows
- Use flow with loop:true for iterative processes, agent loops, feedback cycles, ReAct patterns, OODA loops
- Use svg blocks for diagrams that no structured block can express — fan-outs, mesh connectors, probability distributions, variable-width layer stacks. Always use {{accent}}, {{color}}, {{muted}}, {{bg}} theme tokens in SVG markup. Keep viewBox height ≤200px. Use stroke-based outlines over filled shapes.
- Use table blocks for comparisons, pricing, feature matrices, schedules — avoid grid hacks for tabular data
- Use progress blocks for skills, benchmarks, completion bars, poll results — anything quantitative
- Use steps blocks for sequential processes, onboarding, methodology — implies numbered order with connecting line
- Use tag-group blocks for tech stacks, categories, labels — wrapping inline chips
- Use timeline blocks for roadmaps, milestones, company history — temporal progression
- Use icons in headings for visual anchors. Vary layouts: don't repeat heading+bullets.
- EVERY content slide should have at least one icon somewhere
- First slide = title slide: centered, gradient bg, large heading (3xl+), subtitle, badge with icon
- Last slide = summary/takeaway: gradient bg, quote or key bullets with icons, strong close
- ALWAYS set duration (integer seconds) estimating speaking time: title slides 15-30s, simple content 60-90s, dense/code 90-180s, metrics 20-40s, quotes 15-30s`;// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
