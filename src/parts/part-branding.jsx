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
  // CR8: `0` is a legal, deliberate "no bar" value — `|| 4` treats 0 as falsy
  // and silently repaints the old 4px default, so the bar never truly goes
  // away. Use a type check so only a genuinely unset value (not a number)
  // gets the fallback, and skip the element outright at 0 so no residual
  // strip paints.
  const accentH = typeof b.accentHeight === "number" ? b.accentHeight : 4;
  return <>
    {b.accentBar && accentH > 0 && <div data-testid="branding-accent-bar" style={{ position: "absolute", top: 0, left: 0, right: 0, height: accentH, background: cssColor(b.accentColor) || T.accent, zIndex: 5 }} />}
    {b.logo && (() => {
      const pos = b.logoPosition || "top-left";
      const sz = b.logoSize || 56;
      const isTop = pos.startsWith("top");
      const isLeft = pos.endsWith("left");
      const vOffset = isTop ? (b.accentBar && accentH > 0 ? accentH + 8 : 10) : 36;
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

