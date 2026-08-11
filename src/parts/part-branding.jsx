// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
// ━━━ Branding Overlay ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function BrandingOverlay({ branding, index, total, displayIndex, displayTotal, slideBg }) {
  if (!branding?.enabled) return null;
  const b = branding;
  const di = displayIndex != null ? displayIndex : index;
  const dt = displayTotal != null ? displayTotal : total;
  const slideNum = `${String(di + 1).padStart(2, "0")} / ${String(dt).padStart(2, "0")}`;
  const rightText = b.footerRight === "auto" ? slideNum : (b.footerRight || "");
  // Detect light slides for contrast-appropriate footer defaults
  const isLight = (() => {
    if (!slideBg || slideBg.startsWith("linear") || slideBg.startsWith("radial")) return false;
    const c = slideBg.replace("#", "");
    if (c.length < 6) return false;
    const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), bl = parseInt(c.slice(4, 6), 16);
    return (r * 299 + g * 587 + bl * 114) / 1000 > 140;
  })();
  const isDefaultFooter = !b.footerBg || b.footerBg === "rgba(0,0,0,0.35)";
  const isDefaultColor = !b.footerColor || b.footerColor === "#94a3b8";
  // accentColor/footerBg are encoder-gated (cssColor) the same way slide bg/
  // bgGradient/accent already are (v13.26): both feed a raw `background`
  // shorthand, a fetching CSS sink, so a deck-supplied value must pass the
  // strict color/gradient-token allowlist or fall back to the safe default —
  // defense-in-depth so this sink can't be reached even by a future sanitizer
  // gap. footerColor only ever reaches the non-fetching `color` property, so
  // it stays scrubber-only like every other text-color field. (v13.27)
  const footerBg = isDefaultFooter && isLight ? "rgba(0,0,0,0.06)" : (cssColor(b.footerBg) || "rgba(0,0,0,0.35)");
  const footerColor = isDefaultColor && isLight ? "#475569" : (b.footerColor || "#94a3b8");
  return <>
    {b.accentBar && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: b.accentHeight || 4, background: cssColor(b.accentColor) || T.accent, zIndex: 5 }} />}
    {b.logo && (() => {
      const pos = b.logoPosition || "top-left";
      const sz = b.logoSize || 56;
      const isTop = pos.startsWith("top");
      const isLeft = pos.endsWith("left");
      const vOffset = isTop ? (b.accentBar ? (b.accentHeight || 4) + 8 : 10) : 36;
      const style = { position: "absolute", height: sz, objectFit: "contain", zIndex: 1, opacity: 0.9 };
      if (isTop) style.top = vOffset; else style.bottom = vOffset;
      if (isLeft) style.left = 16; else style.right = 16;
      return <img src={b.logo} alt="" data-branding-logo="true" style={style} />;
    })()}
    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 28, background: footerBg, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 18px", zIndex: 5 }}>
      <span style={{ fontFamily: FONT.mono, fontSize: b.footerSize || 9, color: footerColor, fontWeight: 500 }}>{b.footerLeft || ""}</span>
      <span style={{ fontFamily: FONT.mono, fontSize: b.footerSize || 9, color: footerColor, fontWeight: 400, opacity: 0.7 }}>{b.footerCenter || ""}</span>
      <span style={{ fontFamily: FONT.mono, fontSize: b.footerSize || 9, color: footerColor, fontWeight: 500 }}>{rightText}</span>
    </div>
  </>;
}

