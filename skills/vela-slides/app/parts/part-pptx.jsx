// ─────────────────────────────────────────────────────────────────────────
// part-pptx.jsx — native, editable PowerPoint (.pptx) exporter
//
// A second emitter over the SAME per-slide primitive IR the vector-PDF path
// already produces. Promotes the proven `spike/pptx/pptx-emitter.mjs` OOXML+ZIP
// writer into the monolith (no bundler → plain top-level declarations, no
// import/export). Extraction REUSES part-pdf.jsx's already-correct extractors
// (extractBoxes / extractCircles / extractLinks, parseColor / compositeColor /
// parseLinearGradient / getVisualScale, _compositeBg, slideHasImages,
// collectAllSlides, sanitizeUrl) — all globals after concat. Text uses a NEW
// element-grouped extractor (pptxExtractTextBoxes) so wrapped paragraphs become
// ONE editable, reflowable PowerPoint text box instead of one box per line.
//
// Public entry: buildPptx(pages, opts) → Blob (see JSDoc on buildPptx).
//
// Units: Vela canvas is 960×540 px; a 16:9 PPT slide is 12192000×6858000 EMU,
//        so 1 px = 12700 EMU exactly. Font px → centipoints: round(px*0.75*100).
//        Geometry fed to buildPptx is in 960×540 px space (the fitScale
//        shrink-to-fit is already baked into the DOM by getBoundingClientRect /
//        getVisualScale, so no extra scaling is applied here).
// ─────────────────────────────────────────────────────────────────────────

const PPTX_EMU_PER_PX = 12700;
const PPTX_SLIDE_W = VIRTUAL_W; // 960
const PPTX_SLIDE_H = VIRTUAL_H; // 540
const pptxEmu = (px) => Math.round((px || 0) * PPTX_EMU_PER_PX);
const pptxCpt = (px) => Math.round((px || 0) * 0.75 * 100); // px → centipoints
const pptxEsc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  // strip control chars XML 1.0 forbids (defensive — text comes from user decks)
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");

const PPTX_REL_IMAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const PPTX_REL_HLINK = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
const PPTX_REL_LAYOUT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout";

// ── color helpers ──────────────────────────────────────────────────────────
// Accepts a parseColor() object {r,g,b,a} in 0..1, OR a css/hex string. Returns
// a 6-digit upper-hex string, or null when unresolvable (caller should skip).
function pptxColorHex(c) {
  if (!c && c !== 0) return null;
  if (typeof c === "string") {
    const pc = parseColor(c);
    if (pc) return pptxColorHex(pc);
    const h = c.replace(/[^0-9a-fA-F]/g, "");
    return h.length >= 6 ? h.slice(0, 6).toUpperCase() : null;
  }
  if (typeof c !== "object") return null;
  const to = (v) => {
    const n = Math.round(Math.max(0, Math.min(1, v == null ? 0 : v)) * 255);
    return n.toString(16).padStart(2, "0");
  };
  return (to(c.r) + to(c.g) + to(c.b)).toUpperCase();
}

// Optional <a:alpha> child when the color carries sub-1 alpha (rare — parseColor
// pre-composites, but hand-authored IR / gradient stops may keep alpha).
function pptxAlphaTag(c) {
  if (c && typeof c === "object" && c.a != null && c.a < 0.999) {
    return `<a:alpha val="${Math.round(Math.max(0, c.a) * 100000)}"/>`;
  }
  return "";
}

function pptxSolidFill(color) {
  const hex = pptxColorHex(color);
  if (!hex) return "<a:noFill/>";
  return `<a:solidFill><a:srgbClr val="${hex}">${pptxAlphaTag(color)}</a:srgbClr></a:solidFill>`;
}

// gradient IR {angleDeg, stops:[{color,position}]} → <a:gradFill>. CSS angle
// (Vela convention: 180 = top→bottom) → OOXML <a:lin ang> (60000ths of a degree,
// clockwise from 3-o'clock/east): ooxml = (cssAngle - 90) mod 360.
function pptxGradFill(g) {
  if (!g || !g.stops || g.stops.length < 2) return null;
  const gs = g.stops.map((s) => {
    const pos = Math.round(Math.max(0, Math.min(1, s.position == null ? 0 : s.position)) * 100000);
    const hex = pptxColorHex(s.color) || "000000";
    return `<a:gs pos="${pos}"><a:srgbClr val="${hex}">${pptxAlphaTag(s.color)}</a:srgbClr></a:gs>`;
  }).join("");
  const ang = (((Math.round(g.angleDeg || 0) - 90) % 360) + 360) % 360;
  return `<a:gradFill><a:gsLst>${gs}</a:gsLst><a:lin ang="${ang * 60000}" scaled="1"/></a:gradFill>`;
}

function pptxLine(w, color) {
  const hex = pptxColorHex(color);
  if (!hex || !(w > 0)) return "<a:ln><a:noFill/></a:ln>";
  return `<a:ln w="${pptxEmu(w)}"><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill></a:ln>`;
}

function pptxFontName(ff) {
  if (!ff) return "Arial";
  const first = String(ff).split(",")[0].trim().replace(/^["']|["']$/g, "");
  return first || "Arial";
}

// ── DrawingML shape builders ────────────────────────────────────────────────
const pptxXfrm = (x, y, w, h) =>
  `<a:xfrm><a:off x="${pptxEmu(x)}" y="${pptxEmu(y)}"/><a:ext cx="${pptxEmu(Math.max(1, w))}" cy="${pptxEmu(Math.max(1, h))}"/></a:xfrm>`;

// b: { x,y,w,h, bg?|fill?:color, gradient?:IR, borderRadius?|radius?, borders?:{side:{w,color}}, line?:{w,color} }
function pptxBox(id, b) {
  const grad = b.gradient ? pptxGradFill(b.gradient) : null;
  const fill = grad || ((b.bg || b.fill) ? pptxSolidFill(b.bg || b.fill) : "<a:noFill/>");
  let line = "<a:ln><a:noFill/></a:ln>";
  if (b.line) {
    line = pptxLine(b.line.w, b.line.color);
  } else if (b.borders) {
    // OOXML autoshapes carry one outline — represent per-side borders by the widest side.
    const sides = ["top", "right", "bottom", "left"].map((k) => b.borders[k]).filter(Boolean);
    if (sides.length) {
      const rep = sides.reduce((a, c) => (c.w > a.w ? c : a));
      line = pptxLine(rep.w, rep.color);
    }
  }
  const radius = b.radius != null ? b.radius : (b.borderRadius || 0);
  const prst = radius > 0.5 ? "roundRect" : "rect";
  const adj = radius > 0.5
    ? `<a:avLst><a:gd name="adj" fmla="val ${Math.min(50000, Math.round((radius / Math.min(b.w, b.h)) * 100000))}"/></a:avLst>`
    : "<a:avLst/>";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Box ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr>${pptxXfrm(b.x, b.y, b.w, b.h)}<a:prstGeom prst="${prst}">${adj}</a:prstGeom>${fill}${line}</p:spPr>`
    + `<p:txBody><a:bodyPr/><a:p/></p:txBody></p:sp>`;
}

// e: { cx,cy,r, bg?|fill?:color, borderWidth?,borderColor? | line?:{w,color} }
function pptxEllipse(id, e) {
  const x = e.cx - e.r, y = e.cy - e.r, w = e.r * 2, h = e.r * 2;
  const fill = (e.bg || e.fill) ? pptxSolidFill(e.bg || e.fill) : "<a:noFill/>";
  let line = "<a:ln><a:noFill/></a:ln>";
  if (e.line) line = pptxLine(e.line.w, e.line.color);
  else if (e.borderWidth > 0 && e.borderColor) line = pptxLine(e.borderWidth, e.borderColor);
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Ellipse ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr>${pptxXfrm(x, y, w, h)}<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>${fill}${line}</p:spPr>`
    + `<p:txBody><a:bodyPr/><a:p/></p:txBody></p:sp>`;
}

// t: { x,y,w,h, text, fontSize?|size?, color, bold?|fontWeight?, italic?|fontStyle?, font?|fontFamily?, align? }
// One text box per source text element; PowerPoint reflows/wraps within the box.
function pptxTextSp(id, t) {
  const size = t.fontSize != null ? t.fontSize : (t.size != null ? t.size : 18);
  const bold = t.bold != null ? t.bold : (t.fontWeight >= 600);
  const italic = t.italic != null ? t.italic : (!!t.fontStyle && String(t.fontStyle).indexOf("italic") >= 0);
  const alignRaw = t.align || "left";
  const algn = ({ left: "l", center: "ctr", right: "r", justify: "just", start: "l", end: "r" })[alignRaw] || "l";
  const hex = pptxColorHex(t.color) || "000000";
  const font = pptxFontName(t.font || t.fontFamily);
  const rPr = `<a:rPr lang="en-US" sz="${pptxCpt(size)}"${bold ? ' b="1"' : ""}${italic ? ' i="1"' : ""} dirty="0">`
    + `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`
    + `<a:latin typeface="${pptxEsc(font)}"/><a:cs typeface="${pptxEsc(font)}"/></a:rPr>`;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr>${pptxXfrm(t.x, t.y, t.w, t.h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`
    + `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"><a:normAutofit/></a:bodyPr><a:lstStyle/>`
    + `<a:p><a:pPr algn="${algn}"/><a:r>${rPr}<a:t>${pptxEsc(t.text)}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

// m: { x,y,w,h }, rid → embedded picture (raster fallback for image-heavy slides)
function pptxPic(id, rid, m) {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${pptxEsc(m.alt || "Image " + id)}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>`
    + `<p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>`
    + `<p:spPr>${pptxXfrm(m.x, m.y, m.w, m.h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

// Transparent rect over a link rect carrying a hlinkClick (r: declared on slide root).
function pptxLinkSp(id, rid, l) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Link ${id}"><a:hlinkClick r:id="${rid}"/></p:cNvPr><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr>${pptxXfrm(l.x, l.y, l.w, l.h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>`
    + `<p:txBody><a:bodyPr/><a:p/></p:txBody></p:sp>`;
}

// ── per-slide assembly ──────────────────────────────────────────────────────
function pptxBuildSlide(page, idx) {
  const media = []; // {name, data}
  const rels = [];  // {id, type, target, mode?}
  let rc = 0;
  const nextRid = () => `rId${++rc}`;
  const shapes = [];
  let sid = 1; // shape id 1 is the group; children are 2+
  const W = page.w || PPTX_SLIDE_W;
  const H = page.h || PPTX_SLIDE_H;

  // full-bleed background (solid and/or gradient)
  if (page.bgGradient || page.bg) {
    shapes.push(pptxBox(++sid, { x: 0, y: 0, w: W, h: H, bg: page.bg, gradient: page.bgGradient, borderRadius: 0 }));
  }

  // raster-fallback whole-slide image (image-heavy slides — mirrors the PDF path)
  if (page.imageData) {
    const rid = nextRid();
    const name = `slide${idx}_bg.jpeg`;
    media.push({ name: `ppt/media/${name}`, data: page.imageData });
    rels.push({ id: rid, type: PPTX_REL_IMAGE, target: `../media/${name}` });
    shapes.push(pptxPic(++sid, rid, { x: 0, y: 0, w: W, h: H }));
  }

  for (const b of page.boxes || []) shapes.push(pptxBox(++sid, b));
  for (const c of page.circles || []) shapes.push(pptxEllipse(++sid, c));
  for (const t of page.texts || []) if (t && t.text) shapes.push(pptxTextSp(++sid, t));
  for (const l of page.links || []) {
    if (!l || !l.href) continue;
    const rid = nextRid();
    rels.push({ id: rid, type: PPTX_REL_HLINK, target: l.href, mode: "External" });
    shapes.push(pptxLinkSp(++sid, rid, l));
  }

  const slideXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`
    + ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`
    + ` xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">`
    + `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>`
    + `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`
    + shapes.join("")
    + `</p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr></p:sld>`;

  const layoutRid = nextRid();
  rels.push({ id: layoutRid, type: PPTX_REL_LAYOUT, target: "../slideLayouts/slideLayout1.xml" });
  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + rels.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${pptxEsc(r.target)}"${r.mode ? ` TargetMode="${r.mode}"` : ""}/>`).join("")
    + `</Relationships>`;

  return { slideXml, relsXml, media };
}

// ── package skeleton (shared master + layout + theme) ───────────────────────
const pptxContentTypes = (slideCount, mediaExts) => {
  const defaults = new Set(["rels", "xml", ...mediaExts]);
  const defTags = [...defaults].map((e) => {
    const ct = e === "rels" ? "application/vnd.openxmlformats-package.relationships+xml"
      : e === "xml" ? "application/xml"
      : e === "png" ? "image/png"
      : (e === "jpeg" || e === "jpg") ? "image/jpeg"
      : e === "svg" ? "image/svg+xml" : "application/octet-stream";
    return `<Default Extension="${e}" ContentType="${ct}"/>`;
  }).join("");
  let overrides = `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>`
    + `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>`
    + `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`
    + `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`;
  for (let i = 1; i <= slideCount; i++)
    overrides += `<Override PartName="/ppt/slides/slide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defTags}${overrides}</Types>`;
};

const PPTX_ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>`
  + `</Relationships>`;

function pptxPresentationXml(slideCount, w, h) {
  let sldIds = "";
  for (let i = 1; i <= slideCount; i++) sldIds += `<p:sldId id="${255 + i}" r:id="rId${i + 1}"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`
    + ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`
    + ` xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">`
    + `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId${slideCount + 2}"/></p:sldMasterIdLst>`
    + `<p:sldIdLst>${sldIds}</p:sldIdLst>`
    + `<p:sldSz cx="${pptxEmu(w)}" cy="${pptxEmu(h)}" type="screen16x9"/>`
    + `<p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
}

function pptxPresentationRels(slideCount) {
  let r = "";
  for (let i = 1; i <= slideCount; i++)
    r += `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i}.xml"/>`;
  r += `<Relationship Id="rId${slideCount + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`;
  r += `<Relationship Id="rId${slideCount + 3}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${r}</Relationships>`;
}

const PPTX_THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Vela"><a:themeElements>`
  + `<a:clrScheme name="Vela"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>`
  + `<a:dk2><a:srgbClr val="0F172A"/></a:dk2><a:lt2><a:srgbClr val="E2E8F0"/></a:lt2>`
  + `<a:accent1><a:srgbClr val="3B82F6"/></a:accent1><a:accent2><a:srgbClr val="8B5CF6"/></a:accent2><a:accent3><a:srgbClr val="22C55E"/></a:accent3>`
  + `<a:accent4><a:srgbClr val="F59E0B"/></a:accent4><a:accent5><a:srgbClr val="EF4444"/></a:accent5><a:accent6><a:srgbClr val="14B8A6"/></a:accent6>`
  + `<a:hlink><a:srgbClr val="60A5FA"/></a:hlink><a:folHlink><a:srgbClr val="A855F7"/></a:folHlink></a:clrScheme>`
  + `<a:fontScheme name="Vela"><a:majorFont><a:latin typeface="Sora"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>`
  + `<a:minorFont><a:latin typeface="DM Sans"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>`
  + `<a:fmtScheme name="Vela"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>`
  + `<a:lnStyleLst><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>`
  + `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>`
  + `<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>`
  + `</a:themeElements></a:theme>`;

const PPTX_SLIDE_MASTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">`
  + `<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`
  + `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>`
  + `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>`
  + `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>`
  + `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;

const PPTX_SLIDE_MASTER_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`
  + `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`;

const PPTX_SLIDE_LAYOUT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">`
  + `<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>`
  + `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>`
  + `<p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr></p:sldLayout>`;

const PPTX_SLIDE_LAYOUT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`;

// ── library-free STORE ZIP writer (browser: Uint8Array, no Node Buffer/zlib) ─
function pptxU8(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new TextEncoder().encode(String(data));
}

const PPTX_CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function pptxCrc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = PPTX_CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pptxZip(files) {
  const chunks = [];   // local headers + names + data (STORE)
  const central = [];  // central directory records
  let offset = 0;
  const mk = (size) => { const b = new Uint8Array(size); return { b, v: new DataView(b.buffer) }; };
  for (const f of files) {
    const nameBuf = pptxU8(f.name);
    const data = pptxU8(f.data);
    const crc = pptxCrc32(data);
    const { b: local, v: lv } = mk(30);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);   // version needed
    lv.setUint16(6, 0, true);    // flags
    lv.setUint16(8, 0, true);    // method 0 = STORE
    lv.setUint16(10, 0, true);   // mod time
    lv.setUint16(12, 0x21, true); // mod date (deterministic)
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBuf.length, true);
    lv.setUint16(28, 0, true);
    chunks.push(local, nameBuf, data);

    const { b: cen, v: cv } = mk(46);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);   // version made by
    cv.setUint16(6, 20, true);   // version needed
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);   // method STORE
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBuf.length, true);
    cv.setUint32(42, offset, true);
    central.push(cen, nameBuf);

    offset += 30 + nameBuf.length + data.length;
  }
  let cenSize = 0;
  for (const c of central) cenSize += c.length;
  const { b: end, v: ev } = mk(22);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cenSize, true);
  ev.setUint32(16, offset, true);

  const parts = [...chunks, ...central, end];
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ── public entry ────────────────────────────────────────────────────────────
// buildPptx(pages, opts)
//   pages: Array<page>, each page (all coords in 960×540 px space):
//     { w?, h?,                              // slide dims (default 960×540)
//       bg?:        color | null,            // solid slide background
//       bgGradient?:{angleDeg,stops} | null, // full-bleed gradient background
//       boxes?:     [{x,y,w,h, bg?|fill?, gradient?, borders?/line?, borderRadius?/radius?}],
//       circles?:   [{cx,cy,r, bg?|fill?, borderWidth?,borderColor? / line?}],
//       texts?:     [{x,y,w,h, text, fontSize?/size?, color, fontWeight?/bold?, fontStyle?/italic?, fontFamily?/font?, align?}],
//       links?:     [{href,x,y,w,h}],
//       imageData?: Uint8Array (JPEG) }      // whole-slide raster fallback
//     (`color` = a parseColor() {r,g,b,a} object OR a css/hex string.)
//   opts: reserved (unused today).
//   Returns: a Blob of MIME
//     application/vnd.openxmlformats-officedocument.presentationml.presentation.
//   NB: the artifact sandbox blocks blob: URLs, so a UI caller (PPTX-5) should
//   read the bytes via `await blob.arrayBuffer()` and build a base64 data: URI
//   for the <a download> href (same pattern as the PDF modal).
function buildPptx(pages, opts) {
  opts = opts || {};
  const list = Array.isArray(pages) ? pages : [];
  const files = [];
  const mediaExts = new Set(["png"]); // others (jpeg/svg) added on demand
  const allMedia = [];
  const W = (list[0] && list[0].w) || PPTX_SLIDE_W;
  const H = (list[0] && list[0].h) || PPTX_SLIDE_H;

  list.forEach((page, i) => {
    const { slideXml, relsXml, media } = pptxBuildSlide(page || {}, i + 1);
    files.push({ name: `ppt/slides/slide${i + 1}.xml`, data: slideXml });
    files.push({ name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: relsXml });
    for (const m of media) {
      mediaExts.add(m.name.split(".").pop().toLowerCase());
      allMedia.push(m);
    }
  });

  files.unshift({ name: "[Content_Types].xml", data: pptxContentTypes(list.length, [...mediaExts]) });
  files.push({ name: "_rels/.rels", data: PPTX_ROOT_RELS });
  files.push({ name: "ppt/presentation.xml", data: pptxPresentationXml(list.length, W, H) });
  files.push({ name: "ppt/_rels/presentation.xml.rels", data: pptxPresentationRels(list.length) });
  files.push({ name: "ppt/theme/theme1.xml", data: PPTX_THEME });
  files.push({ name: "ppt/slideMasters/slideMaster1.xml", data: PPTX_SLIDE_MASTER });
  files.push({ name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: PPTX_SLIDE_MASTER_RELS });
  files.push({ name: "ppt/slideLayouts/slideLayout1.xml", data: PPTX_SLIDE_LAYOUT });
  files.push({ name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: PPTX_SLIDE_LAYOUT_RELS });
  for (const m of allMedia) files.push(m);

  const bytes = pptxZip(files);
  return new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}

// ── DOM extraction ──────────────────────────────────────────────────────────
// NEW element-grouped text extractor (vs. part-pdf.jsx's per-visual-line
// extractTextRuns). Emits ONE box per text-bearing element so PowerPoint reflows
// wrapped paragraphs natively — fixes the spike's duplicated/overlapping text.
// Effective (composited) color comes from parseColor()/_compositeBg; unresolvable
// colors are skipped (never faked). Visually-hidden nodes are skipped.
function pptxExtractTextBoxes(container, containerRect) {
  const boxes = [];
  const seen = new Set();
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  const cw = containerRect.width, ch = containerRect.height;

  while (walker.nextNode()) {
    const textNode = walker.currentNode;
    const raw = textNode.textContent;
    if (!raw || !raw.trim()) continue;
    const parent = textNode.parentElement;
    if (!parent) continue;
    if (parent.closest("svg")) continue;
    if (parent.closest("[data-zoom-badge]") || parent.closest("[data-no-pdf]")) continue;
    if (seen.has(parent)) continue; // one box per element
    seen.add(parent);

    const style = window.getComputedStyle(parent);
    if (_isExportHidden(style)) continue;
    const color = parseColor(style.color);
    if (!color) continue; // skip genuinely invisible / unresolvable text

    // Full visible text of THIS element's own direct text nodes (children with
    // their own text become their own boxes).
    let text = "";
    for (const n of parent.childNodes) {
      if (n.nodeType === 3) text += n.textContent;
    }
    text = text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const tt = style.textTransform;
    if (tt === "uppercase") text = text.toUpperCase();
    else if (tt === "lowercase") text = text.toLowerCase();

    const rect = parent.getBoundingClientRect();
    let x = rect.left - containerRect.left;
    let y = rect.top - containerRect.top;
    let w = rect.width;
    let h = rect.height;
    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    if (x + w > cw) w = cw - x;
    if (y + h > ch) h = ch - y;
    if (w < 1 || h < 1) continue;
    if (y + h < 0 || y > ch || x + w < 0 || x > cw) continue;

    const vs = getVisualScale(parent, container);
    const fontSize = (parseFloat(style.fontSize) || 14) * vs;
    const fontWeight = parseInt(style.fontWeight) || 400;
    const fontStyle = style.fontStyle || "normal";
    const fontFamily = style.fontFamily || "";
    const align = style.textAlign || "left";

    boxes.push({ x, y, w, h, text, fontSize, color, fontWeight, fontStyle, fontFamily, align });
  }
  return boxes;
}

// Set part-pdf.jsx's shared _compositeBg global for this slide so parseColor()
// alpha-composites against the true slide background (mirrors the PDF path).
function pptxSetCompositeBg(slide, el) {
  const rawBgStr = (slide && slide.bg) || window.getComputedStyle(el).backgroundColor;
  const rgbM = rawBgStr && rawBgStr.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbM) {
    _compositeBg = { r: parseInt(rgbM[1]) / 255, g: parseInt(rgbM[2]) / 255, b: parseInt(rgbM[3]) / 255 };
    return rawBgStr;
  }
  const hexM = rawBgStr && rawBgStr.match(/#([0-9a-f]{3,8})/i);
  if (hexM) {
    let h = hexM[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    _compositeBg = { r: parseInt(h.substring(0, 2), 16) / 255, g: parseInt(h.substring(2, 4), 16) / 255, b: parseInt(h.substring(4, 6), 16) / 255 };
    return rawBgStr;
  }
  _compositeBg = { r: 10 / 255, g: 15 / 255, b: 28 / 255 }; // fallback #0a0f1c
  return rawBgStr;
}

// Extract one page IR from an already-rendered off-screen slide container (the
// element carrying <SlideContent>, sized 960×540, class "no-anim vela-pdf-capture").
// This is what a PptxExportModal (PPTX-5) calls per slide before buildPptx().
// Reuses the part-pdf.jsx extractors as-is (fitScale already baked into the DOM).
function pptxExtractSlidePage(el, containerRect, slide) {
  const rawBgStr = pptxSetCompositeBg(slide, el);
  const slideBg = parseColor((slide && slide.bg) || rawBgStr) || parseColor("#0a0f1c");
  const slideGrad = parseLinearGradient((slide && slide.bgGradient) || rawBgStr) || null;
  return {
    w: PPTX_SLIDE_W,
    h: PPTX_SLIDE_H,
    bg: slideBg,
    bgGradient: slideGrad,
    boxes: extractBoxes(el, containerRect),
    circles: extractCircles(el, containerRect),
    texts: pptxExtractTextBoxes(el, containerRect),
    links: extractLinks(el, containerRect),
  };
}
