// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
// ━━━ PDF Export ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const PDF_RATIOS = [
  { id: "16:9", label: "16:9", desc: "Native · 1920×1080", w: 1920, h: 1080 },
  { id: "1:1", label: "1:1", desc: "Square · 1080×1080", w: 1080, h: 1080 },
  { id: "4:5", label: "4:5", desc: "Tall · 1080×1350", w: 1080, h: 1350 },
];

const PDF_QUALITY = [
  { id: "vector", label: "Vector", desc: "Crisp text · tiny file · no images", scale: 1, jpeg: 0, vector: true },
  { id: "standard", label: "Standard", desc: "Fast · ~2 MB", scale: 2, jpeg: 0.85 },
  { id: "high", label: "High", desc: "Sharp · ~5 MB", scale: 2.5, jpeg: 0.92 },
  { id: "max", label: "Maximum", desc: "Print · ~10 MB", scale: 3, jpeg: 0.96 },
];

// ━━━ Inline DOM → Canvas (SVG foreignObject, no libs) ━━━━━━━━━━━━━
function inlineAllStyles(src, clone) {
  const srcStyle = window.getComputedStyle(src);
  const props = ["color","background","background-color","background-image","font-family","font-size","font-weight",
    "font-style","letter-spacing","line-height","text-align","text-transform","text-decoration","display",
    "flex-direction","flex-wrap","align-items","justify-content","gap","padding","margin","border",
    "border-radius","border-left","border-top","border-right","border-bottom","border-color",
    "box-shadow","opacity","width","height","min-width","min-height","max-width","overflow",
    "position","top","left","right","bottom","white-space","word-break","box-sizing",
    "grid-template-columns","grid-template-rows","flex","flex-grow","flex-shrink","flex-basis",
    "transform","transform-origin"];
  let style = "";
  for (const p of props) {
    const v = srcStyle.getPropertyValue(p);
    if (v && v !== "normal" && v !== "none" && v !== "auto" && v !== "0px" && v !== "rgba(0, 0, 0, 0)") {
      style += `${p}:${v};`;
    }
  }
  // Always include these
  style += `display:${srcStyle.display};`;
  style += `box-sizing:${srcStyle.boxSizing};`;
  clone.setAttribute("style", style);
  // Remove class/animation attributes that won't work in SVG context
  clone.removeAttribute("class");
  const srcChildren = src.children;
  const cloneChildren = clone.children;
  for (let i = 0; i < srcChildren.length && i < cloneChildren.length; i++) {
    inlineAllStyles(srcChildren[i], cloneChildren[i]);
  }
}

// ━━━ Hybrid DOM → Canvas: SVG foreignObject for text + direct draw for images ━━━
// Browsers block ALL image loading inside foreignObject when SVG is loaded as data URL.
// Solution: strip images from the clone, render text via SVG, then paint images separately.

function collectImagePositions(element) {
  const cRect = element.getBoundingClientRect();
  const positions = [];
  // Collect <img> elements
  element.querySelectorAll("img").forEach(img => {
    if (!img.complete || !img.naturalWidth) return;
    const r = img.getBoundingClientRect();
    const cs = getComputedStyle(img);
    const isLogo = img.hasAttribute("data-branding-logo");
    positions.push({
      type: isLogo ? "logo" : "img", src: img.src,
      x: r.left - cRect.left, y: r.top - cRect.top, w: r.width, h: r.height,
      fit: cs.objectFit || "contain",
      radius: parseFloat(cs.borderRadius) || 0,
      naturalW: img.naturalWidth, naturalH: img.naturalHeight,
    });
  });
  // Collect CSS background-image
  const walk = (el) => {
    const bg = getComputedStyle(el).backgroundImage;
    if (bg && bg !== "none" && bg.startsWith("url(")) {
      const m = bg.match(/url\(["']?(.*?)["']?\)/);
      if (m) {
        const r = el.getBoundingClientRect();
        positions.push({
          type: "bg", src: m[1],
          x: r.left - cRect.left, y: r.top - cRect.top, w: r.width, h: r.height,
          fit: "cover", radius: parseFloat(getComputedStyle(el).borderRadius) || 0,
        });
      }
    }
    for (const child of el.children) walk(child);
  };
  walk(element);
  return positions;
}

function stripImagesFromClone(clone) {
  // Replace <img> with transparent placeholder of same size
  clone.querySelectorAll("img").forEach(img => {
    const isBrandingLogo = img.hasAttribute("data-branding-logo");
    if (isBrandingLogo && img.src?.startsWith("data:")) {
      // Convert logo <img> to <div> with background-image (data URLs work in SVG foreignObject)
      const div = document.createElement("div");
      const style = img.getAttribute("style") || "";
      div.setAttribute("style", style + `;background-image:url(${img.src});background-size:contain;background-repeat:no-repeat;background-position:center;`);
      div.setAttribute("data-branding-logo", "true");
      img.parentNode.replaceChild(div, img);
    } else {
      const style = img.getAttribute("style") || "";
      img.removeAttribute("src");
      img.setAttribute("style", style + ";visibility:hidden;");
    }
  });
  // Clear background-images (they won't render anyway) — but skip branding logo divs
  const walk = (el) => {
    if (el.hasAttribute && el.hasAttribute("data-branding-logo")) return;
    if (el.style && el.style.backgroundImage && el.style.backgroundImage !== "none") {
      el.style.backgroundImage = "none";
    }
    for (const child of el.children) walk(child);
  };
  walk(clone);
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => res(im);
    im.onerror = () => rej(new Error("Image load failed"));
    im.src = src;
  });
}

function drawImageWithFit(ctx, img, x, y, w, h, fit, radius) {
  ctx.save();
  if (radius > 0) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.clip();
  }
  if (fit === "cover") {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const scale = Math.max(w / iw, h / ih);
    const sw = iw * scale, sh = ih * scale;
    ctx.drawImage(img, x + (w - sw) / 2, y + (h - sh) / 2, sw, sh);
  } else if (fit === "fill") {
    ctx.drawImage(img, x, y, w, h);
  } else {
    // contain
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const scale = Math.min(w / iw, h / ih);
    const sw = iw * scale, sh = ih * scale;
    ctx.drawImage(img, x + (w - sw) / 2, y + (h - sh) / 2, sw, sh);
  }
  ctx.restore();
}

async function domToCanvas(element, w, h, scale = 2, slideBg = null) {
  await document.fonts?.ready;

  // 1. Collect image positions from live DOM
  const imagePositions = collectImagePositions(element);

  // 2. Clone and strip images (they won't render in SVG foreignObject)
  const clone = element.cloneNode(true);
  inlineAllStyles(element, clone);
  stripImagesFromClone(clone);

  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  clone.style.width = w + "px";
  clone.style.height = h + "px";
  clone.style.overflow = "hidden";
  clone.style.margin = "0";

  // 3. Render text/CSS layer via SVG foreignObject
  const xml = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <foreignObject width="100%" height="100%">${xml}</foreignObject>
  </svg>`;
  const dataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  const svgImg = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error("SVG image load failed"));
    im.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  // 3.5. Pre-fill canvas with slide background to prevent transparent→black on JPEG
  if (slideBg && typeof slideBg === "string") {
    if (slideBg.includes("gradient")) {
      // Gradient — will be rendered by foreignObject, but pre-fill with a solid base
      // Extract first color from gradient as fallback base
      const colorMatch = slideBg.match(/#[0-9a-fA-F]{3,8}|rgb[a]?\([^)]+\)/);
      if (colorMatch) { ctx.fillStyle = colorMatch[0]; ctx.fillRect(0, 0, w, h); }
    } else {
      ctx.fillStyle = slideBg;
      ctx.fillRect(0, 0, w, h);
    }
  } else {
    // No explicit bg — fill white as safe fallback (beats transparent→black)
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }

  // 4. Draw background images first (behind everything)
  for (const pos of imagePositions) {
    if (pos.type !== "bg") continue;
    try {
      const img = await loadImage(pos.src);
      drawImageWithFit(ctx, img, pos.x, pos.y, pos.w, pos.h, pos.fit, pos.radius);
    } catch (e) {}
  }

  // 5. Draw SVG text layer (includes branding logo as CSS background-image)
  ctx.drawImage(svgImg, 0, 0, w, h);

  // 6. Draw <img> and logo elements on top at their exact DOM positions
  for (const pos of imagePositions) {
    if (pos.type !== "img" && pos.type !== "logo") continue;
    try {
      const img = await loadImage(pos.src);
      drawImageWithFit(ctx, img, pos.x, pos.y, pos.w, pos.h, pos.fit, pos.radius);
    } catch (e) {}
  }

  return canvas;
}

// ━━━ Minimal PDF builder (pure JS, no libs) ━━━━━━━━━━━━━━━━━━━━━━━
function buildPdfFromImages(jpegDataArrays, pageW, pageH, perPageLinks) {
  const enc = new TextEncoder();
  const parts = [];
  let offset = 0;
  const write = (str) => { const b = enc.encode(str); parts.push(b); offset += b.length; };
  const writeBin = (arr) => { parts.push(arr); offset += arr.length; };
  const objOffsets = [];
  const startObj = (n) => { objOffsets[n] = offset; write(`${n} 0 obj\n`); };
  const endObj = () => write("endobj\n");

  write("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n");
  const nPages = jpegDataArrays.length;
  const pageObjStart = 3;

  // 1: Catalog
  startObj(1);
  write("<< /Type /Catalog /Pages 2 0 R >>\n");
  endObj();

  // 2: Pages
  startObj(2);
  // Two-pass: first compute object offsets, then write
  // Since each page may have different link counts, use cumulative offset
  const pageObjOffsets = [];
  let cumObj = pageObjStart;
  for (let i = 0; i < nPages; i++) {
    pageObjOffsets.push(cumObj);
    const nl = (perPageLinks && perPageLinks[i]) ? perPageLinks[i].length : 0;
    cumObj += 3 + nl * 2; // page + image + content + (URI + annot) per link
  }
  const pageRefs = [];
  for (let i = 0; i < nPages; i++) pageRefs.push(`${pageObjOffsets[i]} 0 R`);
  write(`<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${nPages} >>\n`);
  endObj();

  // Per page: page obj, image XObject, content stream [, (URI + annot) per link]
  for (let i = 0; i < nPages; i++) {
    const base = pageObjOffsets[i];
    const imgData = jpegDataArrays[i];
    const pageLinks = (perPageLinks && perPageLinks[i]) || [];

    // Image XObject
    startObj(base + 1);
    write(`<< /Type /XObject /Subtype /Image /Width ${pageW} /Height ${pageH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgData.length} >>\nstream\n`);
    writeBin(imgData);
    write("\nendstream\n");
    endObj();

    // Content stream: draw image filling page
    const contentStr = `q ${pageW} 0 0 ${pageH} 0 0 cm /Img${i} Do Q`;
    startObj(base + 2);
    write(`<< /Length ${contentStr.length} >>\nstream\n${contentStr}\nendstream\n`);
    endObj();

    // Link annotations (one pair of objects per link)
    const annotRefs = [];
    for (let li = 0; li < pageLinks.length; li++) {
      const link = pageLinks[li];
      const r = link.rect;
      // Canvas coords (top-left origin) → PDF coords (bottom-left origin)
      const lx1 = r.x;
      const ly1 = pageH - r.y;
      const lx2 = r.x + r.w;
      const ly2 = pageH - (r.y + r.h);
      const uriObjId = base + 3 + li * 2;
      const annotObjId = base + 4 + li * 2;

      // URI action. SECURITY: the URL is untrusted deck data written into a PDF
      // literal-string context, so it MUST go through pdfStringEncode (the single
      // audited encoder that escapes "(" ")" "\" and drops control chars) — never
      // interpolated raw, or a deck value could close the "(...)" string early and
      // inject arbitrary PDF action syntax (e.g. a /JavaScript action).
      startObj(uriObjId);
      write(`<< /Type /Action /S /URI /URI ${pdfStringEncode(link.url)} >>\n`);
      endObj();

      // Link annotation
      startObj(annotObjId);
      write(`<< /Type /Annot /Subtype /Link /Rect [${lx1} ${ly2} ${lx2} ${ly1}] /Border [0 0 0] /A ${uriObjId} 0 R >>\n`);
      endObj();

      annotRefs.push(`${annotObjId} 0 R`);
    }
    const annotsRef = annotRefs.length > 0 ? ` /Annots [${annotRefs.join(" ")}]` : "";

    // Page
    startObj(base);
    write(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents ${base + 2} 0 R /Resources << /XObject << /Img${i} ${base + 1} 0 R >> >>${annotsRef} >>\n`);
    endObj();
  }

  // xref
  const totalObjs = cumObj;
  const xrefOffset = offset;
  write("xref\n");
  write(`0 ${totalObjs}\n`);
  write("0000000000 65535 f \n");
  for (let i = 1; i < totalObjs; i++) {
    write(String(objOffsets[i] || 0).padStart(10, "0") + " 00000 n \n");
  }
  write("trailer\n");
  write(`<< /Size ${totalObjs} /Root 1 0 R >>\n`);
  write("startxref\n");
  write(`${xrefOffset}\n`);
  write("%%EOF\n");

  // Merge all parts
  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of parts) { result.set(p, pos); pos += p.length; }
  return result;
}

function canvasToJpegBytes(canvas, quality = 0.92) {
  return new Promise((res) => {
    canvas.toBlob((blob) => {
      blob.arrayBuffer().then(buf => res(new Uint8Array(buf)));
    }, "image/jpeg", quality);
  });
}

// ━━━ Slide Reflow for Aspect Ratios ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const _ss = s => (s && typeof s === "object" && !Array.isArray(s)) ? s : {};

function reflowSlideForRatio(slide, heightRatio) {
  if (heightRatio <= 1.05) return slide;

  const s = Math.sqrt(heightRatio);
  const isTall = heightRatio > 1.9;

  // Scale padding
  const rawPad = slide.padding || "36px 48px";
  const padParts = String(rawPad).split(/\s+/).map(v => parseInt(v) || 36);
  const vPad = Math.round(padParts[0] * s * 1.2);
  const hPad = padParts[1] || padParts[0];
  const newPadding = `${vPad}px ${hPad}px`;

  // Scale gap
  const baseGap = slide.gap || 12;
  const newGap = Math.round(baseGap * s);

  // Scale spacer heights in blocks
  const reflowBlocks = (blocks) => {
    if (!blocks) return blocks;
    return blocks.map(b => {
      if (b.type === "spacer") {
        return { ...b, h: Math.round((b.h || 24) * s) };
      }
      if (b.type === "grid") {
        const newGrid = { ...b, gap: Math.round((b.gap || 24) * s) };
        if (isTall && b.cols === 2 && (b.items?.length || 0) <= 3) {
          newGrid.cols = 1;
        }
        if (newGrid.items) {
          newGrid.items = newGrid.items.map(cell => ({
            ...cell,
            blocks: reflowBlocks(cell.blocks),
            style: cell.style ? {
              ..._ss(cell.style),
              padding: cell.style.padding ? 
                String(cell.style.padding).replace(/(\d+)px/g, (_, n) => Math.round(parseInt(n) * s) + "px") :
                cell.style.padding
            } : cell.style,
          }));
        }
        return newGrid;
      }
      if (b.type === "bullets") {
        return { ...b, gap: Math.round((b.gap || 8) * s) };
      }
      if (b.type === "icon-row") {
        return { ...b, gap: Math.round((b.gap || 16) * s) };
      }
      if (b.type === "callout") {
        return { ...b, style: { ..._ss(b.style), padding: `${Math.round(14 * s)}px ${Math.round(18 * s)}px` } };
      }
      if (b.type === "flow") {
        return { ...b, direction: isTall ? "vertical" : b.direction };
      }
      return b;
    });
  };

  return {
    ...slide,
    padding: newPadding,
    gap: newGap,
    verticalAlign: slide.verticalAlign || "center",
    blocks: reflowBlocks(slide.blocks),
  };
}

// ━━━ PDF Link Collection & Icon Drawing ━━━━━━━━━━━━━━━━━━━━━━━━━━━
function collectSlideLinks(container) {
  const links = [];
  const cRect = container.getBoundingClientRect();
  const els = container.querySelectorAll("[data-pdf-link]");
  els.forEach(el => {
    // Re-validate the scheme at the sink boundary (defense-in-depth): the raster
    // PDF writer is a structured-syntax sink, so only allowlisted URLs become
    // link actions. Output is additionally escaped via pdfStringEncode.
    const url = sanitizeUrl(el.getAttribute("data-pdf-link"));
    if (!url) return;
    const r = el.getBoundingClientRect();
    links.push({
      url,
      rect: {
        x: r.left - cRect.left,
        y: r.top - cRect.top,
        w: r.width,
        h: r.height,
      }
    });
  });
  return links;
}

function drawPdfLinkIcon(ctx, px, py, size) {
  ctx.save();
  // Subtle pill background
  const pad = size * 0.2;
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = "rgba(15, 23, 42, 0.75)";
  ctx.beginPath();
  ctx.roundRect(px - pad, py - pad, size + pad * 2, size + pad * 2, size * 0.25);
  ctx.fill();
  // Border
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = "rgba(96, 165, 250, 0.5)";
  ctx.lineWidth = Math.max(1, size * 0.08);
  ctx.beginPath();
  ctx.roundRect(px - pad, py - pad, size + pad * 2, size + pad * 2, size * 0.25);
  ctx.stroke();
  // External link arrow icon
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = "#60a5fa";
  ctx.lineWidth = Math.max(1.2, size * 0.11);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const m = size * 0.22;
  // Box (bottom-left open rect)
  ctx.beginPath();
  ctx.moveTo(px + m, py + size * 0.38);
  ctx.lineTo(px + m, py + size - m);
  ctx.lineTo(px + size - m * 1.4, py + size - m);
  ctx.stroke();
  // Diagonal arrow
  ctx.beginPath();
  ctx.moveTo(px + size * 0.42, py + size * 0.58);
  ctx.lineTo(px + size - m, py + m);
  ctx.stroke();
  // Arrow head
  ctx.beginPath();
  ctx.moveTo(px + size * 0.48, py + m);
  ctx.lineTo(px + size - m, py + m);
  ctx.lineTo(px + size - m, py + size * 0.52);
  ctx.stroke();
  ctx.restore();
}

// ━━━ Vela PDF Watermark ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Returns { links: [{rect:{x,y,w,h}, url}] } for PDF link annotations
function drawVelaWatermark(ctx, pw, ph) {
  const s = pw / 1080;
  const margin = Math.round(28 * s);
  const fontSize = Math.round(11 * s);
  const pillH = Math.round(30 * s);
  const pillPadH = Math.round(16 * s);
  const gap = Math.round(6 * s);

  ctx.save();

  // Measure text segments
  const font500 = `500 ${fontSize}px "Inter", "SF Pro Display", -apple-system, sans-serif`;
  const font700 = `700 ${fontSize}px "Inter", "SF Pro Display", -apple-system, sans-serif`;
  ctx.font = font500;
  const prefixText = "Created by";
  const prefixW = ctx.measureText(prefixText).width;
  ctx.font = font700;
  const velaText = "Vela Slides";
  const velaW = ctx.measureText(velaText).width;

  // Sail icon space
  const sailW = Math.round(14 * s);
  const totalW = pillPadH + sailW + gap + prefixW + gap + velaW + pillPadH;
  const x = margin;
  const y = ph - margin - pillH;

  // Pill background — dark glass
  const radius = Math.round(6 * s);
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
  ctx.beginPath();
  ctx.roundRect(x, y, totalW, pillH, radius);
  ctx.fill();

  // Subtle border
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = "rgba(148, 163, 184, 0.4)";
  ctx.lineWidth = Math.max(1, Math.round(0.8 * s));
  ctx.beginPath();
  ctx.roundRect(x, y, totalW, pillH, radius);
  ctx.stroke();

  const textY = y + pillH / 2;
  let cx = x + pillPadH;

  // Sail icon (⛵ simplified triangle)
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "#60a5fa";
  const sailX = cx;
  const sailY = textY - sailW * 0.45;
  ctx.beginPath();
  ctx.moveTo(sailX + sailW * 0.3, sailY);
  ctx.lineTo(sailX + sailW * 0.3, sailY + sailW * 0.85);
  ctx.lineTo(sailX + sailW, sailY + sailW * 0.85);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = "#94a3b8";
  ctx.beginPath();
  ctx.moveTo(sailX + sailW * 0.25, sailY + sailW * 0.1);
  ctx.lineTo(sailX + sailW * 0.25, sailY + sailW * 0.85);
  ctx.lineTo(sailX, sailY + sailW * 0.85);
  ctx.closePath();
  ctx.fill();
  cx += sailW + gap;

  // "Created by" — dim
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = "#94a3b8";
  ctx.font = font500;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(prefixText, cx, textY);
  cx += prefixW + gap;

  // "Vela Slides" — bright
  ctx.globalAlpha = 1.0;
  ctx.fillStyle = "#e2e8f0";
  ctx.font = font700;
  ctx.fillText(velaText, cx, textY);

  ctx.restore();

  // Entire pill is one clickable zone → GitHub
  return {
    links: [
      { rect: { x, y, w: totalW, h: pillH }, url: "https://github.com/agentiapt/vela-slides" },
    ]
  };
}

// ━━━ PDF Export Modal ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function PdfExportModal({ slides: allSlides, branding, deckTitle, onClose }) {
  const [ratio, setRatio] = useState("16:9");
  const [quality, setQuality] = useState("high");
  const [useVector, setUseVector] = useState(false);
  const [includeCards, setIncludeCards] = useState(true);
  const [phase, setPhase] = useState("choose"); // choose | exporting | done | error
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [pdfDataUri, setPdfDataUri] = useState(null);
  const [showBranding, setShowBranding] = useState(false);
  const showBrandingRef = useRef(showBranding);
  showBrandingRef.current = showBranding;
  const [thumbs, setThumbs] = useState([]);
  const offscreenRef = useRef(null);
  const [renderIdx, setRenderIdx] = useState(-1);
  const canvasesRef = useRef([]);
  const slideLinksRef = useRef([]);
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;
  const qualityRef = useRef(quality);
  qualityRef.current = quality;

  // Module title cards (the 🎬 "present card") are inserted by collectAllSlides as
  // _virtual slides. Let the user opt out, and surface how many enabled cards there are.
  const titleCardCount = useMemo(() => allSlides.filter((s) => s._virtual).length, [allSlides]);
  const slides = useMemo(() => includeCards ? allSlides : allSlides.filter((s) => !s._virtual), [allSlides, includeCards]);

  const startExport = useCallback(async () => {
    setPhase("exporting");
    setProgress(0);
    canvasesRef.current = [];
    slideLinksRef.current = [];
    setThumbs([]);
    setRenderIdx(0);
  }, []);

  // Compute render dimensions: shrunken render box + PDF output size
  const renderDims = useCallback(() => {
    const r = PDF_RATIOS.find(r => r.id === ratioRef.current) || PDF_RATIOS[0];
    const rh0 = Math.round(VIRTUAL_W * (r.h / r.w));
    const heightRatio = rh0 / VIRTUAL_H;
    const zoom = heightRatio <= 1.05 ? 1 : Math.pow(heightRatio, 0.45);
    const rw = Math.round(VIRTUAL_W / zoom);
    const rh = Math.round(rh0 / zoom);
    return { rw, rh, pw: r.w, ph: r.h };
  }, []);

  // Capture each slide when rendered
  useEffect(() => {
    if (renderIdx < 0 || renderIdx >= slides.length || phase !== "exporting") return;
    const el = offscreenRef.current;
    if (!el) return;
    const { rw, rh } = renderDims();
    const timer = setTimeout(async () => {
      try {
        // Wait for fonts to load (triggers SlideContent auto-fit re-measure)
        if (document.fonts?.ready) await document.fonts.ready;
        // Wait for all images in the slide to be fully loaded
        const imgs = el.querySelectorAll("img");
        if (imgs.length > 0) {
          await Promise.all(Array.from(imgs).map(img =>
            img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })
          ));
        }
        // Triple rAF to ensure auto-fit layout pass has fully settled
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
        // Collect block links from DOM before rasterizing
        const blockLinks = collectSlideLinks(el);
        slideLinksRef.current.push(blockLinks);
        const qp = PDF_QUALITY.find(q => q.id === qualityRef.current) || PDF_QUALITY[1];
        const curSlide = slides[renderIdx];
        const curSlideBg = curSlide?.bgGradient || curSlide?.bg || T.slideBg;
        const canvas = await domToCanvas(el, rw, rh, qp.scale, curSlideBg);
        canvasesRef.current.push(canvas);
        // Generate thumbnail for live preview
        const thumbCanvas = document.createElement("canvas");
        const tw = 120, th = Math.round(120 * (rh / rw));
        thumbCanvas.width = tw * 2; thumbCanvas.height = th * 2;
        const tctx = thumbCanvas.getContext("2d");
        tctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, tw * 2, th * 2);
        setThumbs(prev => [...prev, thumbCanvas.toDataURL("image/jpeg", 0.6)]);
        setProgress(((renderIdx + 1) / slides.length) * 100);
        if (renderIdx + 1 < slides.length) {
          setRenderIdx(renderIdx + 1);
        } else {
          await finalizePdf();
        }
      } catch (err) {
        setErrorMsg(`Capture failed on slide ${renderIdx + 1}: ${err.message}`);
        setPhase("error");
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [renderIdx, phase, slides.length]);

  const finalizePdf = useCallback(async () => {
    try {
      const { rw, rh, pw, ph } = renderDims();
      const jpegArrays = [];
      const perPageLinks = [];
      for (let si = 0; si < canvasesRef.current.length; si++) {
        const canvas = canvasesRef.current[si];
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = pw;
        pageCanvas.height = ph;
        const ctx = pageCanvas.getContext("2d");
        ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, pw, ph);
        // Draw Vela watermark and capture branding link zones
        const pageLinks = [];
        if (showBrandingRef.current) {
          const wmResult = drawVelaWatermark(ctx, pw, ph);
          pageLinks.push(...wmResult.links);
        }
        // Draw block link icons and collect annotations
        const blockLinks = slideLinksRef.current[si] || [];
        const iconSize = Math.round(18 * (pw / 1080));
        const iconMargin = Math.round(6 * (pw / 1080));
        for (const bl of blockLinks) {
          // Scale from render coords to page coords
          const sx = (bl.rect.x / rw) * pw;
          const sy = (bl.rect.y / rh) * ph;
          const sw = (bl.rect.w / rw) * pw;
          const sh = (bl.rect.h / rh) * ph;
          // Draw subtle link icon at top-right of block
          drawPdfLinkIcon(ctx, sx + sw - iconSize - iconMargin, sy + iconMargin, iconSize);
          // Add full block rect as clickable link zone
          pageLinks.push({ rect: { x: sx, y: sy, w: sw, h: sh }, url: bl.url });
        }
        perPageLinks.push(pageLinks);
        const qp = PDF_QUALITY.find(q => q.id === qualityRef.current) || PDF_QUALITY[1];
        jpegArrays.push(await canvasToJpegBytes(pageCanvas, qp.jpeg));
      }
      const pdfBytes = buildPdfFromImages(jpegArrays, pw, ph, perPageLinks);
      let binary = "";
      for (let i = 0; i < pdfBytes.length; i++) binary += String.fromCharCode(pdfBytes[i]);
      const b64 = btoa(binary);
      setPdfDataUri("data:application/pdf;base64," + b64);
      setPhase("done");
    } catch (err) {
      setErrorMsg(`PDF build failed: ${err.message}`);
      setPhase("error");
    }
  }, [slides]);

  const currentSlide = renderIdx >= 0 && renderIdx < slides.length ? slides[renderIdx] : null;
  const safeTitle = (deckTitle || "vela-deck").replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-{2,}/g, "-").slice(0, 60);

  // Delegate to vector export modal when Vector quality is selected
  if (useVector) return <VectorPdfExportModal slides={slides} branding={branding} deckTitle={deckTitle} onClose={onClose} initialRatio={ratio} />;

  return (
    <div onClick={onClose} data-testid="pdf-export-modal" style={{ position: "fixed", inset: 0, zIndex: 10001, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 12, width: "min(480px, 94vw)", boxShadow: "0 20px 60px rgba(0,0,0,0.6)", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {getIcon("FileDown", { size: 14, color: T.accent })}
            <span style={{ fontFamily: FONT.mono, fontSize: 11, fontWeight: 700, color: T.accent, letterSpacing: 1 }}>EXPORT PDF</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 16, padding: "0 4px", lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ padding: "20px 16px" }}>
          {phase === "choose" && <>
            <div style={{ fontFamily: FONT.body, fontSize: 13, color: T.textMuted, marginBottom: 16 }}>
              Choose aspect ratio for PDF
            </div>
            <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
              {PDF_RATIOS.map(r => (
                <button key={r.id} onClick={() => setRatio(r.id)} style={{
                  flex: 1, padding: "14px 8px", background: ratio === r.id ? `${T.accent}18` : "rgba(255,255,255,0.03)",
                  border: `2px solid ${ratio === r.id ? T.accent : T.border}`, borderRadius: 8, cursor: "pointer",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 6, transition: "all .15s",
                }}>
                  <div style={{
                    width: r.id === "16:9" ? 54 : r.id === "1:1" ? 40 : 36,
                    height: r.id === "16:9" ? 30 : r.id === "1:1" ? 40 : 45,
                    background: ratio === r.id ? `${T.accent}30` : "rgba(255,255,255,0.06)",
                    border: `1.5px solid ${ratio === r.id ? T.accent : T.textDim}`,
                    borderRadius: 3,
                  }} />
                  <span style={{ fontFamily: FONT.mono, fontSize: 12, fontWeight: 700, color: ratio === r.id ? T.accent : T.text }}>{r.label}</span>
                  <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim }}>{r.desc}</span>
                </button>
              ))}
            </div>
            <div style={{ fontFamily: FONT.body, fontSize: 13, color: T.textMuted, marginBottom: 10 }}>
              Quality
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              {PDF_QUALITY.map(q => (
                <button key={q.id} onClick={() => setQuality(q.id)} style={{
                  flex: 1, padding: "10px 6px", background: quality === q.id ? `${T.accent}18` : "rgba(255,255,255,0.03)",
                  border: `2px solid ${quality === q.id ? T.accent : T.border}`, borderRadius: 8, cursor: "pointer",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 4, transition: "all .15s",
                }}>
                  <span style={{ fontFamily: FONT.mono, fontSize: 11, fontWeight: 700, color: quality === q.id ? T.accent : T.text }}>{q.label}</span>
                  <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim }}>{q.desc}</span>
                </button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, padding: "10px 12px", background: "rgba(255,255,255,0.03)", border: `1px solid ${T.border}`, borderRadius: 8 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontFamily: FONT.body, fontSize: 13, color: T.text }}>Show branding</span>
                <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim }}>Created by Vela Slides · watermark</span>
              </div>
              <button onClick={() => setShowBranding(b => !b)} style={{
                width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer",
                background: showBranding ? T.accent : "rgba(255,255,255,0.12)",
                position: "relative", transition: "background .2s", flexShrink: 0,
              }}>
                <div style={{
                  width: 16, height: 16, borderRadius: 8, background: "#fff",
                  position: "absolute", top: 3,
                  left: showBranding ? 21 : 3,
                  transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                }} />
              </button>
            </div>
            {titleCardCount > 0 && <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, padding: "10px 12px", background: "rgba(255,255,255,0.03)", border: `1px solid ${T.border}`, borderRadius: 8 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontFamily: FONT.body, fontSize: 13, color: T.text }}>Module title cards</span>
                <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim }}>🎬 {titleCardCount} auto title slide{titleCardCount !== 1 ? "s" : ""} (enabled modules)</span>
              </div>
              <button onClick={() => setIncludeCards(b => !b)} style={{
                width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer",
                background: includeCards ? T.accent : "rgba(255,255,255,0.12)",
                position: "relative", transition: "background .2s", flexShrink: 0,
              }}>
                <div style={{
                  width: 16, height: 16, borderRadius: 8, background: "#fff",
                  position: "absolute", top: 3,
                  left: includeCards ? 21 : 3,
                  transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                }} />
              </button>
            </div>}
            <button data-testid="pdf-export-start" onClick={() => quality === "vector" ? setUseVector(true) : startExport()} style={{
              width: "100%", padding: "10px", fontFamily: FONT.mono, fontSize: 12, fontWeight: 700,
              background: T.accent, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer",
              letterSpacing: 1, transition: "opacity .15s",
            }}>
              EXPORT {slides.length} SLIDES
            </button>
          </>}

          {(phase === "exporting" || phase === "done") && (() => {
            const r = PDF_RATIOS.find(r => r.id === ratio) || PDF_RATIOS[0];
            const thumbW = 56, thumbH = Math.round(56 * (r.h / r.w));
            const bigW = 140, bigH = Math.round(140 * (r.h / r.w));
            const isExporting = phase === "exporting";
            const maxVisible = 14;
            const visibleThumbs = thumbs.slice(-maxVisible);
            const prevThumbs = visibleThumbs.slice(0, -1);
            const latestThumb = visibleThumbs.length > 0 ? visibleThumbs[visibleThumbs.length - 1] : null;
            return <>
              {/* Live page stack + hero preview */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 0 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "0 auto 12px", minHeight: bigH + 8 }}>
                  {/* Small stack of previous slides */}
                  <div style={{ position: "relative", width: thumbW + Math.max(prevThumbs.length - 1, 0) * 14, height: thumbH + 16, flexShrink: 0 }}>
                    {prevThumbs.map((src, i) => {
                      const total = prevThumbs.length;
                      const spread = Math.min(14, 160 / Math.max(total, 1));
                      const x = i * spread;
                      const tilt = ((i - (total - 1) / 2) / Math.max(total - 1, 1)) * 3;
                      return <img key={i} src={src} alt="" style={{
                        position: "absolute", left: x, top: 8,
                        width: thumbW, height: thumbH, objectFit: "cover",
                        borderRadius: 3, border: `1px solid ${T.border}`,
                        boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                        transform: `rotate(${tilt}deg)`,
                        opacity: 0.7 + 0.3 * (i / Math.max(total - 1, 1)),
                        zIndex: i,
                      }} />;
                    })}
                    {thumbs.length === 0 && <div style={{
                      width: thumbW, height: thumbH, borderRadius: 3, border: `2px dashed ${T.border}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      position: "absolute", left: 0, top: 8,
                    }}>
                      <div style={{ width: 12, height: 12, border: `2px solid ${T.accent}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                    </div>}
                  </div>
                  {/* Large current/latest slide */}
                  {latestThumb ? <div style={{ position: "relative", flexShrink: 0 }}>
                    <img data-testid="pdf-export-preview" src={latestThumb} alt="" style={{
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
                    Rendering {renderIdx + 1} of {slides.length}
                  </div>
                  <div style={{ width: "100%", height: 4, background: T.border, borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${progress}%`, height: "100%", background: `linear-gradient(90deg, ${T.accent}, ${T.green || "#34d399"})`, borderRadius: 2, transition: "width .3s ease" }} />
                  </div>
                </> : <>
                  <div style={{ fontFamily: FONT.mono, fontSize: 13, color: T.green || "#34d399", fontWeight: 700, marginBottom: 4 }}>
                    ✅ {slides.length} pages ready
                  </div>
                  <div style={{ fontFamily: FONT.mono, fontSize: 10, color: T.textDim }}>
                    {r.desc}
                  </div>
                </>}
              </div>

              {phase === "done" && <>
                <a href={pdfDataUri} download={`${safeTitle}.pdf`} style={{
                  display: "block", width: "100%", padding: "12px", fontFamily: FONT.mono, fontSize: 13, fontWeight: 700,
                  background: T.accent, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer",
                  letterSpacing: 1, textAlign: "center", textDecoration: "none", boxSizing: "border-box",
                }}>
                  ⬇ DOWNLOAD PDF
                </a>
                <button onClick={onClose} style={{
                  width: "100%", padding: "8px", fontFamily: FONT.mono, fontSize: 11, fontWeight: 600,
                  background: "transparent", color: T.textDim, border: `1px solid ${T.border}`, borderRadius: 6, cursor: "pointer",
                  marginTop: 8,
                }}>CLOSE</button>
              </>}
            </>;
          })()}

          {phase === "error" && <>
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>❌</div>
              <div style={{ fontFamily: FONT.mono, fontSize: 11, color: "#ef4444", marginBottom: 8 }}>{errorMsg}</div>
            </div>
            <button onClick={onClose} style={{
              width: "100%", padding: "10px", fontFamily: FONT.mono, fontSize: 12, fontWeight: 700,
              background: "rgba(239,68,68,0.2)", color: "#ef4444", border: "1px solid #ef4444", borderRadius: 6, cursor: "pointer",
            }}>CLOSE</button>
          </>}
        </div>
      </div>

      {/* Offscreen render target at target aspect ratio */}
      {phase === "exporting" && currentSlide && (() => {
        const r = PDF_RATIOS.find(r => r.id === ratio) || PDF_RATIOS[0];
        const rh0 = Math.round(VIRTUAL_W * (r.h / r.w));
        const heightRatio = rh0 / VIRTUAL_H;
        const reflowed = reflowSlideForRatio(currentSlide, heightRatio);
        // Shrink render box → content fills smaller space → PDF upscale magnifies everything
        const zoom = heightRatio <= 1.05 ? 1 : Math.pow(heightRatio, 0.45);
        const rw = Math.round(VIRTUAL_W / zoom);
        const rh = Math.round(rh0 / zoom);
        const slideBg = reflowed.bgGradient || reflowed.bg || T.slideBg;
        // Match presentation numbering: title cards aren't counted, real slides
        // keep continuous 1-based numbers (excluding any inserted title cards).
        const displayTotal = slides.reduce((n, s) => n + (s._virtual ? 0 : 1), 0);
        let nonVirtualBefore = 0;
        for (let i = 0; i < renderIdx; i++) if (!slides[i]._virtual) nonVirtualBefore++;
        const displayIndex = currentSlide._virtual ? nonVirtualBefore - 1 : nonVirtualBefore;
        return (
          <div style={{ position: "fixed", left: -9999, top: -9999, width: rw, height: rh, overflow: "hidden", zIndex: -1 }}>
            <div ref={offscreenRef} className="no-anim vela-pdf-capture" style={{ width: rw, height: rh, overflow: "hidden", background: slideBg }}>
              <SlideContent slide={reflowed} index={renderIdx} total={slides.length} branding={currentSlide._virtual ? null : branding} editable={false} displayIndex={displayIndex} displayTotal={displayTotal} />
            </div>
          </div>
        );
      })()}

      <style>{`
        @keyframes pageIn { from { opacity: 0; transform: scale(0.9) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .no-anim, .no-anim * { animation: none !important; transition: none !important; }
      `}</style>
    </div>
  );
}


