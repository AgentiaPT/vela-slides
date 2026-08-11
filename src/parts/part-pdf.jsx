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
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 10001, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
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
            <button onClick={() => quality === "vector" ? setUseVector(true) : startExport()} style={{
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


// ━━━ Vector PDF Export (additional) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ━━━ Constants ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const VECTOR_RATIOS = [
  { id: "16:9", label: "16:9", desc: "Native \u00B7 1920\u00D71080", w: 1920, h: 1080 },
  { id: "1:1", label: "1:1", desc: "Square \u00B7 1080\u00D71080", w: 1080, h: 1080 },
  { id: "4:5", label: "4:5", desc: "Tall \u00B7 1080\u00D71350", w: 1080, h: 1350 },
];

// ━━━ Check if slide has image blocks ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function slideHasImages(slide) {
  const check = (blocks) => (blocks || []).some(b =>
    b.type === "image" ||
    (b.type === "grid" && (b.items || []).some(cell => check(cell.blocks)))
  );
  return check(slide.blocks) || !!slide.bgImage;
}

// ━━━ Color parsing ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Slide background for alpha compositing — updated per slide
// PDF doesn't support alpha in rg/RG operators, so we pre-composite
let _compositeBg = { r: 10/255, g: 15/255, b: 28/255 }; // default #0a0f1c

function compositeColor(fg) {
  if (!fg || fg.a >= 0.99) return fg;
  const bg = _compositeBg;
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

// Skip nodes that are visually hidden so they never leak into exports (PDF/PPTX).
// display:none already yields a 0-size rect (caught by the size checks); this adds
// visibility:hidden and opacity:0 (e.g. the hover-only zoom-badge overlay, which
// stays in the DOM at opacity:0 until hovered).
function _isExportHidden(style) {
  return style.visibility === "hidden" || style.opacity === "0" || style.display === "none";
}

function parseColor(str) {
  if (typeof str !== "string" || str === "transparent" || str === "rgba(0, 0, 0, 0)") return null;
  // rgb(r, g, b) or rgba(r, g, b, a)
  const rgbM = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (rgbM) {
    const a = rgbM[4] !== undefined ? parseFloat(rgbM[4]) : 1;
    if (a < 0.02) return null;
    const color = { r: parseInt(rgbM[1]) / 255, g: parseInt(rgbM[2]) / 255, b: parseInt(rgbM[3]) / 255, a };
    return compositeColor(color);
  }
  // #hex
  const hexM = str.match(/^#([0-9a-f]{3,8})$/i);
  if (hexM) {
    let hex = hexM[1];
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    if (hex.length === 4) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3];
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    const a = hex.length === 8 ? parseInt(hex.substring(6, 8), 16) / 255 : 1;
    if (a < 0.02) return null;
    const color = { r, g, b, a };
    return compositeColor(color);
  }
  return null;
}

// ━━━ CSS linear-gradient parsing ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function parseLinearGradient(str) {
  if (typeof str !== "string" || !str.includes("linear-gradient")) return null;
  const match = str.match(/linear-gradient\((.+)\)/s);
  if (!match) return null;
  const inner = match[1].trim();

  // Parse angle
  let angleDeg = 180; // default: top to bottom
  let colorPart = inner;
  const angleMatch = inner.match(/^(\d+(?:\.\d+)?)\s*(deg|rad|turn)/);
  if (angleMatch) {
    const val = parseFloat(angleMatch[1]);
    if (angleMatch[2] === "deg") angleDeg = val;
    else if (angleMatch[2] === "rad") angleDeg = val * 180 / Math.PI;
    else if (angleMatch[2] === "turn") angleDeg = val * 360;
    colorPart = inner.substring(inner.indexOf(",") + 1).trim();
  } else if (inner.startsWith("to ")) {
    const dirMatch = inner.match(/^to\s+(top|bottom|left|right)(?:\s*-?\s*(top|bottom|left|right))?/i);
    if (dirMatch) {
      const dirs = [dirMatch[1].toLowerCase(), (dirMatch[2] || "").toLowerCase()].filter(Boolean);
      const has = (d) => dirs.includes(d);
      if (has("top") && has("right")) angleDeg = 45;
      else if (has("bottom") && has("right")) angleDeg = 135;
      else if (has("bottom") && has("left")) angleDeg = 225;
      else if (has("top") && has("left")) angleDeg = 315;
      else if (has("top")) angleDeg = 0;
      else if (has("right")) angleDeg = 90;
      else if (has("bottom")) angleDeg = 180;
      else if (has("left")) angleDeg = 270;
      colorPart = inner.substring(inner.indexOf(",") + 1).trim();
    }
  }

  // Parse color stops: match hex colors and rgba() with optional position
  const stops = [];
  const stopRe = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))\s*(\d+(?:\.\d+)?%)?/g;
  let m;
  while ((m = stopRe.exec(colorPart)) !== null) {
    const color = parseColor(m[1]);
    const pos = m[2] ? parseFloat(m[2]) / 100 : null;
    if (color) stops.push({ color, position: pos });
  }

  // Fill in missing positions
  if (stops.length < 2) return null;
  if (stops[0].position === null) stops[0].position = 0;
  if (stops[stops.length - 1].position === null) stops[stops.length - 1].position = 1;
  for (let i = 1; i < stops.length - 1; i++) {
    if (stops[i].position === null) {
      let next = i + 1;
      while (next < stops.length && stops[next].position === null) next++;
      const prev = stops[i - 1].position;
      const nxt = stops[next].position;
      for (let j = i; j < next; j++) {
        stops[j].position = prev + (nxt - prev) * (j - i + 1) / (next - i + 1);
      }
    }
  }

  return { angleDeg, stops };
}

// Compute PDF gradient line coords for a box
function gradientLineCoords(angleDeg, bx, by, bw, bh, pageH) {
  const rad = angleDeg * Math.PI / 180;
  const dx = Math.sin(rad);
  const dy = Math.cos(rad); // PDF y-up matches gradient direction
  const halfLen = Math.abs(bw / 2 * Math.sin(rad)) + Math.abs(bh / 2 * Math.cos(rad));
  const cx = bx + bw / 2;
  const cy = pageH - by - bh / 2;
  return [cx - halfLen * dx, cy - halfLen * dy, cx + halfLen * dx, cy + halfLen * dy];
}

// Build inline PDF Shading dictionary string for a gradient
function buildShadingDict(gradient, coords) {
  const [x0, y0, x1, y1] = coords;
  const stops = gradient.stops;
  let fnDict;
  if (stops.length === 2) {
    const c0 = stops[0].color, c1 = stops[1].color;
    fnDict = `<< /FunctionType 2 /Domain [0 1] /C0 [${c0.r.toFixed(3)} ${c0.g.toFixed(3)} ${c0.b.toFixed(3)}] /C1 [${c1.r.toFixed(3)} ${c1.g.toFixed(3)} ${c1.b.toFixed(3)}] /N 1 >>`;
  } else {
    const fns = [], bounds = [], encode = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const c0 = stops[i].color, c1 = stops[i + 1].color;
      fns.push(`<< /FunctionType 2 /Domain [0 1] /C0 [${c0.r.toFixed(3)} ${c0.g.toFixed(3)} ${c0.b.toFixed(3)}] /C1 [${c1.r.toFixed(3)} ${c1.g.toFixed(3)} ${c1.b.toFixed(3)}] /N 1 >>`);
      if (i < stops.length - 2) bounds.push(stops[i + 1].position.toFixed(4));
      encode.push("0 1");
    }
    fnDict = `<< /FunctionType 3 /Domain [0 1] /Functions [${fns.join(" ")}] /Bounds [${bounds.join(" ")}] /Encode [${encode.join(" ")}] >>`;
  }
  return `<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [${x0.toFixed(2)} ${y0.toFixed(2)} ${x1.toFixed(2)} ${y1.toFixed(2)}] /Function ${fnDict} /Extend [true true] >>`;
}

// ━━━ PDF Text encoding ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// For standard fonts, PDF uses WinAnsiEncoding (Latin-1 subset)
// Characters outside this range get replaced with ?
function pdfStringEncode(str) {
  let out = "(";
  for (let i = 0; i < str.length; i++) {
    const c = str.codePointAt(i);
    const ch = str[i];
    // Skip low surrogates (already handled by codePointAt on the high surrogate)
    if (c >= 0xDC00 && c <= 0xDFFF) continue;
    // Skip high surrogates after processing (advance past the pair)
    if (c > 0xFFFF) { i++; } // skip the low surrogate on next iteration
    if (ch === "(" || ch === ")" || ch === "\\") {
      out += "\\" + ch;
    } else if (c >= 32 && c <= 126) {
      // Printable ASCII — safe to include directly
      out += ch;
    } else if (c >= 128 && c <= 255) {
      // Latin-1 chars (©, ·, ×, etc.) — must use octal escape to avoid
      // UTF-8 double-encoding when TextEncoder converts to bytes
      out += "\\" + c.toString(8).padStart(3, "0");
    } else {
      // Typographic Unicode → WinAnsiEncoding substitutions
      // Values use PDF octal escapes to avoid UTF-8 double-encoding via TextEncoder
      const typoMap = {
        0x2014: "\\227", // em dash (WinAnsi 0x97)
        0x2013: "\\226", // en dash (WinAnsi 0x96)
        0x201C: "\\223", // left double quote (WinAnsi 0x93)
        0x201D: "\\224", // right double quote (WinAnsi 0x94)
        0x2018: "\\221", // left single quote (WinAnsi 0x91)
        0x2019: "\\222", // right single quote (WinAnsi 0x92)
        0x2022: "\\267", // bullet → middle dot (WinAnsi 0xB7)
        0x2026: "...",   // ellipsis
        0x2122: "TM",    // trademark
        0x2192: "->",    // right arrow
        0x2190: "<-",    // left arrow
        0x21D2: "=>",    // double right arrow
      };
      if (typoMap[c]) {
        out += typoMap[c];
      } else {
        // Emoji and other non-Latin chars: skip (rendered as images)
        // This avoids misaligned text substitutions
      }
    }
  }
  return out + ")";
}

// ━━━ Emoji detection and rendering ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Detects codepoints that are emoji / outside WinAnsiEncoding
function isEmojiCodepoint(cp) {
  if (cp <= 0xFF) return false; // Latin-1, handled by WinAnsi
  // Variation selectors, ZWJ — not visual
  if (cp === 0xFE0F || cp === 0xFE0E || cp === 0x200D) return false;
  // Skin tone modifiers — not standalone visual
  if (cp >= 0x1F3FB && cp <= 0x1F3FF) return false;
  // Common typographic characters we handle as text substitutions
  const textSubs = [0x2014,0x2013,0x201C,0x201D,0x2018,0x2019,0x2022,0x2026,0x2122,0x2192,0x2190,0x2191,0x2193,0x21D2];
  if (textSubs.includes(cp)) return false;
  return cp > 0xFF;
}

// Render a single emoji string to a PNG image via canvas
// Returns raw RGB bytes (no alpha) for PDF embedding
const emojiCanvasCache = new Map();

async function renderEmojiToImage(emojiStr, size) {
  const key = emojiStr + "|" + size;
  if (emojiCanvasCache.has(key)) return emojiCanvasCache.get(key);

  const scale = 2; // render at 2x for quality
  const px = Math.ceil(size * scale);
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");

  // Draw emoji using system font
  ctx.font = `${px * 0.85}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Android Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emojiStr, px / 2, px / 2);

  // Extract raw RGB bytes (no alpha) for PDF /DeviceRGB image
  // PDF images don't support transparency, so composite over slide background
  const imgData = ctx.getImageData(0, 0, px, px);
  const rgba = imgData.data;
  const rgb = new Uint8Array(px * px * 3);
  const bgR = Math.round(_compositeBg.r * 255);
  const bgG = Math.round(_compositeBg.g * 255);
  const bgB = Math.round(_compositeBg.b * 255);
  for (let j = 0; j < px * px; j++) {
    const a = rgba[j * 4 + 3] / 255;
    rgb[j * 3]     = Math.round(rgba[j * 4]     * a + bgR * (1 - a));
    rgb[j * 3 + 1] = Math.round(rgba[j * 4 + 1] * a + bgG * (1 - a));
    rgb[j * 3 + 2] = Math.round(rgba[j * 4 + 2] * a + bgB * (1 - a));
  }

  const result = { bytes: rgb, w: px, h: px, isRaw: true };
  emojiCanvasCache.set(key, result);
  return result;
}

// Extract emoji images from text runs — finds emoji sequences in text,
// determines their position using Range API, renders them as images
async function extractEmojiImages(container, containerRect, textRuns) {
  const emojiImages = [];

  // Walk text nodes and find emoji characters with their positions
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  while (walker.nextNode()) {
    const textNode = walker.currentNode;
    const parent = textNode.parentElement;
    if (!parent || parent.closest("svg")) continue;

    const text = textNode.textContent;
    if (!text) continue;

    const style = window.getComputedStyle(parent);
    const fontSize = parseFloat(style.fontSize) || 14;

    // Find emoji sequences in this text node
    let i = 0;
    while (i < text.length) {
      const cp = text.codePointAt(i);
      const charLen = cp > 0xFFFF ? 2 : 1;

      if (isEmojiCodepoint(cp)) {
        // Collect full emoji sequence (emoji + modifiers + ZWJ sequences)
        let emojiStart = i;
        let emojiEnd = i + charLen;
        while (emojiEnd < text.length) {
          const nextCp = text.codePointAt(emojiEnd);
          const nextLen = nextCp > 0xFFFF ? 2 : 1;
          // Continue if ZWJ, variation selector, or skin tone modifier
          if (nextCp === 0x200D || nextCp === 0xFE0F || nextCp === 0xFE0E ||
              (nextCp >= 0x1F3FB && nextCp <= 0x1F3FF)) {
            emojiEnd += nextLen;
            // After ZWJ, include the next character too
            if (nextCp === 0x200D && emojiEnd < text.length) {
              const afterZwj = text.codePointAt(emojiEnd);
              emojiEnd += afterZwj > 0xFFFF ? 2 : 1;
            }
          } else {
            break;
          }
        }

        const emojiStr = text.substring(emojiStart, emojiEnd);

        // Get position using Range API
        const range = document.createRange();
        range.setStart(textNode, emojiStart);
        range.setEnd(textNode, emojiEnd);
        const rects = range.getClientRects();
        if (rects.length > 0) {
          const rect = rects[0];
          const img = await renderEmojiToImage(emojiStr, fontSize);
          // Place emoji at the same position the browser renders it
          // Use rect position but cap size to fontSize for consistent alignment
          const ew = Math.min(rect.width, fontSize * 1.2);
          const eh = Math.min(rect.height, fontSize * 1.2);
          emojiImages.push({
            x: rect.left - containerRect.left,
            y: rect.top - containerRect.top + (rect.height - eh) / 2,
            w: ew,
            h: eh,
            imageData: img.bytes,
            imgW: img.w,
            imgH: img.h,
          });
        }

        i = emojiEnd;
      } else {
        i += charLen;
      }
    }
  }

  return emojiImages;
}

// Extract branding logo images for vector PDF embedding
async function extractLogoImages(element, containerRect) {
  const logos = [];
  const imgs = element.querySelectorAll('img[data-branding-logo="true"]');
  for (const img of imgs) {
    if (!img.complete || !img.naturalWidth || !img.src) continue;
    const r = img.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    try {
      const loaded = await loadImage(img.src);
      // Render to canvas to get raw RGB bytes
      const cw = Math.round(r.width * 2), ch = Math.round(r.height * 2);
      const c = document.createElement("canvas");
      c.width = cw; c.height = ch;
      const ctx = c.getContext("2d");
      ctx.drawImage(loaded, 0, 0, cw, ch);
      const data = ctx.getImageData(0, 0, cw, ch).data;
      // Convert RGBA to RGB
      const rgb = new Uint8Array(cw * ch * 3);
      for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
        rgb[j] = data[i]; rgb[j+1] = data[i+1]; rgb[j+2] = data[i+2];
      }
      logos.push({
        x: r.left - containerRect.left,
        y: r.top - containerRect.top,
        w: r.width, h: r.height,
        imageData: rgb, imgW: cw, imgH: ch,
      });
    } catch (e) {}
  }
  return logos;
}

// ━━━ Font metrics for standard PDF fonts ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Approximate character widths as fraction of font size
// These are close enough for Helvetica / standard sans-serif
const CHAR_WIDTHS = {
  // Common characters at 1000 units per em (Helvetica-like)
  "default": 0.55,
  " ": 0.28, "!": 0.28, "\"": 0.36, "#": 0.56, "$": 0.56, "%": 0.89,
  "&": 0.67, "'": 0.19, "(": 0.33, ")": 0.33, "*": 0.39, "+": 0.58,
  ",": 0.28, "-": 0.33, ".": 0.28, "/": 0.28, ":": 0.28, ";": 0.28,
  "0": 0.56, "1": 0.56, "2": 0.56, "3": 0.56, "4": 0.56, "5": 0.56,
  "6": 0.56, "7": 0.56, "8": 0.56, "9": 0.56,
  "A": 0.67, "B": 0.67, "C": 0.72, "D": 0.72, "E": 0.67, "F": 0.61,
  "G": 0.78, "H": 0.72, "I": 0.28, "J": 0.50, "K": 0.67, "L": 0.56,
  "M": 0.83, "N": 0.72, "O": 0.78, "P": 0.67, "Q": 0.78, "R": 0.72,
  "S": 0.67, "T": 0.61, "U": 0.72, "V": 0.67, "W": 0.94, "X": 0.67,
  "Y": 0.67, "Z": 0.61,
  "a": 0.56, "b": 0.56, "c": 0.50, "d": 0.56, "e": 0.56, "f": 0.28,
  "g": 0.56, "h": 0.56, "i": 0.22, "j": 0.22, "k": 0.50, "l": 0.22,
  "m": 0.83, "n": 0.56, "o": 0.56, "p": 0.56, "q": 0.56, "r": 0.33,
  "s": 0.50, "t": 0.28, "u": 0.56, "v": 0.50, "w": 0.72, "x": 0.50,
  "y": 0.50, "z": 0.50,
};

function measureText(text, fontSize) {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    w += (CHAR_WIDTHS[text[i]] || CHAR_WIDTHS["default"]) * fontSize;
  }
  return w;
}

// ━━━ DOM Element Extraction ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Walk the rendered slide DOM and extract boxes + text runs

function extractBoxes(container, containerRect) {
  const boxes = [];
  const elements = container.querySelectorAll("*");
  const scaleCache = new Map();
  for (const el of elements) {
    if (el.tagName === "SVG" || el.closest("svg")) continue;
    if (el.closest("[data-zoom-badge], [data-no-pdf]")) continue;
    const style = window.getComputedStyle(el);
    if (_isExportHidden(style)) continue;
    // Skip elements that will be drawn as circles (borderRadius >= 50% of size AND roughly square)
    const brCheck = parseFloat(style.borderRadius) || 0;
    const elRect = el.getBoundingClientRect();
    const isRound = brCheck >= Math.min(elRect.width, elRect.height) / 2 - 1 && elRect.width > 2 && elRect.height > 2 && brCheck > 0;
    const isSquarish = elRect.width > 0 && elRect.height > 0 && elRect.width / elRect.height < 1.5 && elRect.height / elRect.width < 1.5;
    if (isRound && isSquarish) continue; // True circles — handled by extractCircles
    const bg = parseColor(style.backgroundColor);
    const gradient = parseLinearGradient(style.backgroundImage);
    // Compute visual scale for border/radius metrics (pre-transform → post-transform)
    if (!scaleCache.has(el)) {
      scaleCache.set(el, getVisualScale(el, container));
    }
    const vs = scaleCache.get(el);
    const borderLW = (parseFloat(style.borderLeftWidth) || 0) * vs;
    const borderTW = (parseFloat(style.borderTopWidth) || 0) * vs;
    const borderRW = (parseFloat(style.borderRightWidth) || 0) * vs;
    const borderBW = (parseFloat(style.borderBottomWidth) || 0) * vs;
    const borderLC = parseColor(style.borderLeftColor);
    const borderTC = parseColor(style.borderTopColor);
    const borderRC = parseColor(style.borderRightColor);
    const borderBC = parseColor(style.borderBottomColor);
    const hasBorder = (borderLW > 0.5 && borderLC) || (borderTW > 0.5 && borderTC) ||
                      (borderRW > 0.5 && borderRC) || (borderBW > 0.5 && borderBC);

    if (!bg && !gradient && !hasBorder) continue;

    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;

    // Clip box to container bounds (elements may overflow the slide)
    let bx = rect.left - containerRect.left;
    let by = rect.top - containerRect.top;
    let bw = rect.width;
    let bh = rect.height;
    const cw = containerRect.width, ch = containerRect.height;
    if (bx < 0) { bw += bx; bx = 0; }
    if (by < 0) { bh += by; by = 0; }
    if (bx + bw > cw) bw = cw - bx;
    if (by + bh > ch) bh = ch - by;
    if (bw < 1 || bh < 1) continue;

    const box = {
      x: bx, y: by, w: bw, h: bh,
      borderRadius: (parseFloat(style.borderRadius) || 0) * vs,
    };
    if (bg) box.bg = bg;
    if (gradient) box.gradient = gradient;
    if (hasBorder) {
      box.borders = {};
      if (borderLW > 0.5 && borderLC) box.borders.left = { w: borderLW, color: borderLC };
      if (borderTW > 0.5 && borderTC) box.borders.top = { w: borderTW, color: borderTC };
      if (borderRW > 0.5 && borderRC) box.borders.right = { w: borderRW, color: borderRC };
      if (borderBW > 0.5 && borderBC) box.borders.bottom = { w: borderBW, color: borderBC };
    }
    boxes.push(box);
  }
  return boxes;
}

function getTextLines(textNode, containerRect) {
  const text = textNode.textContent;
  if (!text || !text.trim()) return [];

  const range = document.createRange();
  const lines = [];

  // Split text into words for line detection
  const re = /(\S+|\s+)/g;
  let match;
  const parts = [];
  while ((match = re.exec(text)) !== null) {
    parts.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  if (parts.length === 0) return [];

  let lineStart = 0;
  let lineTop = null;

  for (let pi = 0; pi < parts.length; pi++) {
    const p = parts[pi];
    range.setStart(textNode, p.start);
    range.setEnd(textNode, p.end);
    const rects = range.getClientRects();
    if (rects.length === 0) continue;
    const rect = rects[0];

    if (lineTop === null) {
      lineTop = rect.top;
    } else if (Math.abs(rect.top - lineTop) > 3) {
      // New line — flush previous
      const prevEnd = parts[pi - 1] ? parts[pi - 1].end : p.start;
      range.setStart(textNode, lineStart);
      range.setEnd(textNode, prevEnd);
      const lr = range.getBoundingClientRect();
      const lt = text.substring(lineStart, prevEnd).replace(/^\s+/, "");
      if (lt) {
        lines.push({
          text: lt,
          x: lr.left - containerRect.left,
          y: lr.top - containerRect.top,
          w: lr.width,
          h: lr.height,
        });
      }
      lineStart = p.start;
      // Skip leading whitespace
      if (p.text.trim() === "") {
        lineStart = p.end;
      }
      lineTop = rect.top;
    }
  }

  // Last line
  const lastEnd = parts[parts.length - 1].end;
  range.setStart(textNode, lineStart);
  range.setEnd(textNode, lastEnd);
  const lr = range.getBoundingClientRect();
  const lt = text.substring(lineStart, lastEnd).replace(/^\s+/, "");
  if (lt) {
    lines.push({
      text: lt,
      x: lr.left - containerRect.left,
      y: lr.top - containerRect.top,
      w: lr.width,
      h: lr.height,
    });
  }

  // Post-process: split lines at emoji boundaries
  // Emojis are rendered as images separately; text runs need correct x-positions
  const splitLines = [];
  for (const line of lines) {
    const lt = line.text;
    let hasEmoji = false;
    for (let i = 0; i < lt.length; ) {
      const cp = lt.codePointAt(i);
      if (isEmojiCodepoint(cp)) { hasEmoji = true; break; }
      i += cp > 0xFFFF ? 2 : 1;
    }
    if (!hasEmoji) { splitLines.push(line); continue; }
    // Find non-emoji segments and measure their positions via Range API
    // We need the original textNode offset for this line
    // Find where this line's text starts in the textNode
    const lineIdx = text.indexOf(lt);
    if (lineIdx < 0) { splitLines.push(line); continue; }
    let si = 0;
    while (si < lt.length) {
      const cp = lt.codePointAt(si);
      const cl = cp > 0xFFFF ? 2 : 1;
      if (isEmojiCodepoint(cp)) {
        // Skip emoji sequence
        let ei = si + cl;
        while (ei < lt.length) {
          const nc = lt.codePointAt(ei);
          if (nc === 0x200D || nc === 0xFE0F || nc === 0xFE0E || (nc >= 0x1F3FB && nc <= 0x1F3FF)) {
            ei += nc > 0xFFFF ? 2 : 1;
            if (nc === 0x200D && ei < lt.length) { ei += lt.codePointAt(ei) > 0xFFFF ? 2 : 1; }
          } else break;
        }
        si = ei;
      } else {
        // Collect non-emoji text segment
        let segEnd = si;
        while (segEnd < lt.length) {
          const nc = lt.codePointAt(segEnd);
          if (isEmojiCodepoint(nc)) break;
          segEnd += nc > 0xFFFF ? 2 : 1;
        }
        const segText = lt.substring(si, segEnd).trim();
        if (segText) {
          // Measure position via Range API
          try {
            const sr = document.createRange();
            sr.setStart(textNode, lineIdx + si);
            sr.setEnd(textNode, lineIdx + segEnd);
            const srr = sr.getBoundingClientRect();
            splitLines.push({
              text: segText,
              x: srr.left - containerRect.left,
              y: srr.top - containerRect.top,
              w: srr.width,
              h: srr.height,
            });
          } catch (_) {
            // Fallback: just use line position
            splitLines.push({ text: segText, x: line.x, y: line.y, w: line.w, h: line.h });
          }
        }
        si = segEnd;
      }
    }
  }
  return splitLines;
}

// Compute cumulative CSS transform scale from element up to container
function getVisualScale(element, container) {
  let scale = 1;
  let el = element;
  while (el && el !== container) {
    const t = window.getComputedStyle(el).transform;
    if (t && t !== "none") {
      const m = new DOMMatrix(t);
      scale *= Math.min(Math.abs(m.a), Math.abs(m.d));
    }
    el = el.parentElement;
  }
  return scale;
}

function extractTextRuns(container, containerRect) {
  const runs = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  // Cache visual scale per parent element (transform scale from fitScale etc.)
  const scaleCache = new Map();

  while (walker.nextNode()) {
    const textNode = walker.currentNode;
    const parent = textNode.parentElement;
    if (!parent) continue;
    // Skip SVG text
    if (parent.closest("svg")) continue;
    // Skip UI overlays (zoom badge, presenter controls)
    if (parent.closest("[data-zoom-badge]") || parent.closest("[data-no-pdf]")) continue;

    const style = window.getComputedStyle(parent);
    const rawFontSize = parseFloat(style.fontSize) || 14;
    const color = parseColor(style.color);
    if (!color) continue;

    // getComputedStyle returns pre-transform fontSize, but getBoundingClientRect
    // returns post-transform positions. Adjust fontSize to match visual coords.
    if (!scaleCache.has(parent)) {
      scaleCache.set(parent, getVisualScale(parent, container));
    }
    const visualScale = scaleCache.get(parent);
    const fontSize = rawFontSize * visualScale;

    const fontFamily = style.fontFamily || "";
    const fontWeight = parseInt(style.fontWeight) || 400;
    const fontStyle = style.fontStyle || "normal";
    const rawLetterSpacing = parseFloat(style.letterSpacing) || 0;
    const letterSpacing = rawLetterSpacing * visualScale;
    const textTransform = style.textTransform || "none";
    // Get CSS line-height for consistent baseline positioning
    // (Range.getBoundingClientRect height varies per line based on glyph content)
    const rawLH = style.lineHeight;
    let cssLineHeight;
    if (rawLH === "normal") {
      cssLineHeight = rawFontSize * 1.2;
    } else if (rawLH.endsWith("px")) {
      cssLineHeight = parseFloat(rawLH);
    } else {
      cssLineHeight = parseFloat(rawLH) * rawFontSize || rawFontSize * 1.2;
    }
    cssLineHeight *= visualScale;

    const lines = getTextLines(textNode, containerRect);
    for (const line of lines) {
      let text = line.text;
      if (textTransform === "uppercase") text = text.toUpperCase();
      else if (textTransform === "lowercase") text = text.toLowerCase();
      if (!text.trim()) continue;

      // Clip: skip text runs that are outside the container bounds
      const cw = containerRect.width, ch = containerRect.height;
      if (line.y + line.h < 0 || line.y > ch || line.x + line.w < 0 || line.x > cw) continue;

      // Use range rect Y and h directly. Range rect already reflects the browser's
      // visual positioning (including line-height centering). This keeps lineGap ≈ 0
      // in the PDF baseline formula, placing text where the browser rendered it.
      runs.push({
        text,
        x: line.x,
        y: line.y,
        w: line.w,
        h: line.h,
        fontSize,
        cssLineHeight,
        color,
        fontWeight,
        fontStyle,
        fontFamily,
        letterSpacing,
      });
    }
  }
  return runs;
}

function extractLinks(container, containerRect) {
  const links = [];
  container.querySelectorAll("a[href]").forEach(a => {
    const raw = a.getAttribute("href");
    if (!raw || raw.startsWith("#")) return;
    // Allowlist scheme (http/https/mailto) so a javascript:/data:/vbscript: href
    // can never become a live annotation in the exported PDF.
    const href = sanitizeUrl(raw);
    if (!href) return;
    const r = a.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    links.push({ href, x: r.left - containerRect.left, y: r.top - containerRect.top, w: r.width, h: r.height });
  });
  container.querySelectorAll("[data-href]").forEach(el => {
    const href = sanitizeUrl(el.getAttribute("data-href"));
    if (!href) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    links.push({ href, x: r.left - containerRect.left, y: r.top - containerRect.top, w: r.width, h: r.height });
  });
  // Block-level links (heading, text, metric etc. with link property)
  container.querySelectorAll("[data-pdf-link]").forEach(el => {
    const href = sanitizeUrl(el.getAttribute("data-pdf-link"));
    if (!href) return;
    // Skip if already captured via a[href] or data-href
    if (el.tagName === "A" || el.hasAttribute("data-href")) return;
    // Skip nested data-pdf-link elements (prefer outermost — the styled container)
    if (el.parentElement?.closest("[data-pdf-link]")) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    links.push({ href, x: r.left - containerRect.left, y: r.top - containerRect.top, w: r.width, h: r.height });
  });
  return links;
}

// ━━━ Circles/dots extraction (bullets, timeline dots) ━━━━━━━━━━━━━━━
function extractCircles(container, containerRect) {
  const circles = [];
  const elements = container.querySelectorAll("*");
  for (const el of elements) {
    if (el.closest("svg")) continue;
    const style = window.getComputedStyle(el);
    if (_isExportHidden(style)) continue;
    const br = style.borderRadius;
    if (!br || br === "0px") continue;
    const rect = el.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    if (w < 2 || h < 2) continue;
    // Check if it's a circle (border-radius >= 50% of size)
    const brVal = parseFloat(br);
    if (brVal < Math.min(w, h) / 2 - 1) continue;
    // Only capture actual circles (aspect ratio near 1:1), not pills
    if (w / h > 1.5 || h / w > 1.5) continue;
    const bg = parseColor(style.backgroundColor);
    const vs = getVisualScale(el, container);
    const borderW = (parseFloat(style.borderWidth) || 0) * vs;
    const borderC = parseColor(style.borderColor);
    if (!bg && !(borderW > 0 && borderC)) continue;
    const cx = rect.left - containerRect.left + w / 2;
    const cy = rect.top - containerRect.top + h / 2;
    const r = Math.min(w, h) / 2;
    // Clip: skip circles fully outside container bounds
    if (cx + r < 0 || cx - r > containerRect.width || cy + r < 0 || cy - r > containerRect.height) continue;
    circles.push({ cx, cy, r, bg, borderWidth: borderW, borderColor: borderC });
  }
  return circles;
}

// ━━━ SVG icon extraction ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Walks all <svg> elements and converts their children to PDF path ops
function extractSVGs(container, containerRect) {
  const svgs = [];
  container.querySelectorAll("svg").forEach(svg => {
    const rect = svg.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    // Clip: skip SVGs fully outside container bounds
    const svgOx = rect.left - containerRect.left;
    const svgOy = rect.top - containerRect.top;
    if (svgOx + rect.width < 0 || svgOx > containerRect.width || svgOy + rect.height < 0 || svgOy > containerRect.height) return;

    const vb = svg.getAttribute("viewBox");
    const vbParts = vb ? vb.split(/[\s,]+/).map(Number) : [0, 0, rect.width, rect.height];
    const vbX = vbParts[0], vbY = vbParts[1], vbW = vbParts[2], vbH = vbParts[3];

    // Position relative to container
    const ox = rect.left - containerRect.left;
    const oy = rect.top - containerRect.top;

    // Scale from viewBox coordinates to DOM pixel coordinates
    const sx = rect.width / vbW;
    const sy = rect.height / vbH;

    // Get stroke color from SVG attributes or computed style
    const svgStyle = window.getComputedStyle(svg);
    const strokeAttr = svg.getAttribute("stroke");
    // Try attribute first, then computed style color inheritance
    let strokeColor = null;
    if (strokeAttr && strokeAttr !== "none" && strokeAttr !== "currentColor") {
      strokeColor = parseColor(strokeAttr);
    }
    if (!strokeColor) {
      // Try computed color (CSS inheritance from parent)
      strokeColor = parseColor(svgStyle.color);
    }
    if (!strokeColor) {
      // Last resort: default to white (visible on dark slide backgrounds)
      strokeColor = { r: 0.886, g: 0.910, b: 0.941, a: 1 }; // #e2e8f0
    }
    const fillAttr = svg.getAttribute("fill");
    const strokeWidthAttr = parseFloat(svg.getAttribute("stroke-width")) || parseFloat(svgStyle.strokeWidth) || 2;
    const linecap = svg.getAttribute("stroke-linecap") || "round";
    const linejoin = svg.getAttribute("stroke-linejoin") || "round";

    const paths = [];

    for (const child of svg.querySelectorAll("path, line, polyline, polygon, circle, rect")) {
      const tag = child.tagName.toLowerCase();
      // Skip elements inside <defs> (markers, patterns — not rendered directly)
      if (child.closest("defs")) continue;
      // Per-element overrides
      const elStroke = child.getAttribute("stroke");
      const elFill = child.getAttribute("fill");
      const elStrokeWidth = child.getAttribute("stroke-width");
      const elOpacity = parseFloat(child.getAttribute("opacity") ?? "1");
      const elFillOpacity = parseFloat(child.getAttribute("fill-opacity") ?? "1");
      const color = parseColor(elStroke) || strokeColor;
      let fill = elFill && elFill !== "none" ? parseColor(elFill) : (fillAttr && fillAttr !== "none" ? parseColor(fillAttr) : null);
      // Apply fill-opacity and element opacity to fill color
      if (fill && (elFillOpacity < 0.99 || elOpacity < 0.99)) {
        const a = fill.a * elFillOpacity * elOpacity;
        fill = compositeColor({ ...fill, a });
        if (!fill) fill = null; // fully transparent after compositing
      }
      const sw = elStrokeWidth ? parseFloat(elStrokeWidth) : strokeWidthAttr;
      // Stroke dash array (e.g. "6,4" or "2 4")
      const elDashArray = child.getAttribute("stroke-dasharray");
      const dashArray = elDashArray && elDashArray !== "none" ? elDashArray.split(/[\s,]+/).map(Number).filter(n => !isNaN(n) && n > 0) : null;
      // Per-element linecap/linejoin
      const elLinecap = child.getAttribute("stroke-linecap");
      const elLinejoin = child.getAttribute("stroke-linejoin");

      let pdfOps = "";

      if (tag === "path") {
        const d = child.getAttribute("d");
        if (d) pdfOps = svgPathToPdf(d, vbX, vbY, vbW, vbH);
      } else if (tag === "line") {
        const x1 = parseFloat(child.getAttribute("x1")) - vbX;
        const y1 = parseFloat(child.getAttribute("y1")) - vbY;
        const x2 = parseFloat(child.getAttribute("x2")) - vbX;
        const y2 = parseFloat(child.getAttribute("y2")) - vbY;
        pdfOps = `${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l`;
      } else if (tag === "polyline" || tag === "polygon") {
        const pts = (child.getAttribute("points") || "").trim().split(/[\s,]+/).map(Number);
        if (pts.length >= 4) {
          pdfOps = `${(pts[0] - vbX).toFixed(2)} ${(pts[1] - vbY).toFixed(2)} m`;
          for (let i = 2; i < pts.length; i += 2) {
            pdfOps += ` ${(pts[i] - vbX).toFixed(2)} ${(pts[i+1] - vbY).toFixed(2)} l`;
          }
          if (tag === "polygon") pdfOps += " h";
        }
      } else if (tag === "circle") {
        const cx = parseFloat(child.getAttribute("cx")) - vbX;
        const cy = parseFloat(child.getAttribute("cy")) - vbY;
        const r = parseFloat(child.getAttribute("r"));
        const k = 0.5523 * r;
        pdfOps = [
          `${(cx + r).toFixed(2)} ${cy.toFixed(2)} m`,
          `${(cx + r).toFixed(2)} ${(cy + k).toFixed(2)} ${(cx + k).toFixed(2)} ${(cy + r).toFixed(2)} ${cx.toFixed(2)} ${(cy + r).toFixed(2)} c`,
          `${(cx - k).toFixed(2)} ${(cy + r).toFixed(2)} ${(cx - r).toFixed(2)} ${(cy + k).toFixed(2)} ${(cx - r).toFixed(2)} ${cy.toFixed(2)} c`,
          `${(cx - r).toFixed(2)} ${(cy - k).toFixed(2)} ${(cx - k).toFixed(2)} ${(cy - r).toFixed(2)} ${cx.toFixed(2)} ${(cy - r).toFixed(2)} c`,
          `${(cx + k).toFixed(2)} ${(cy - r).toFixed(2)} ${(cx + r).toFixed(2)} ${(cy - k).toFixed(2)} ${(cx + r).toFixed(2)} ${cy.toFixed(2)} c`,
        ].join("\n");
      } else if (tag === "rect") {
        const rx = parseFloat(child.getAttribute("x") || 0) - vbX;
        const ry = parseFloat(child.getAttribute("y") || 0) - vbY;
        const rw = parseFloat(child.getAttribute("width"));
        const rh = parseFloat(child.getAttribute("height"));
        const rr = parseFloat(child.getAttribute("rx") || 0);
        if (rr > 0) {
          pdfOps = roundedRect(rx, ry, rw, rh, rr);
        } else {
          pdfOps = `${rx.toFixed(2)} ${ry.toFixed(2)} ${rw.toFixed(2)} ${rh.toFixed(2)} re`;
        }
      }

      if (pdfOps) {
        // Determine paint operator
        const hasStroke = elStroke !== "none" && color;
        const noStroke = elStroke === "none";
        let paintOp;
        if (fill && hasStroke && !noStroke) paintOp = "B"; // fill + stroke
        else if (fill) paintOp = "f";
        else paintOp = "S"; // stroke only (default for Lucide icons)

        paths.push({ ops: pdfOps, color, fill, strokeWidth: sw, paintOp, dashArray, linecap: elLinecap, linejoin: elLinejoin });
      }
    }

    // Extract <text> elements from SVG
    const svgTexts = [];
    svg.querySelectorAll("text").forEach(textEl => {
      const content = textEl.textContent?.trim();
      if (!content) return;
      const xAttr = textEl.getAttribute("x") || "0";
      const yAttr = textEl.getAttribute("y") || "0";
      const tx = xAttr.includes("%") ? parseFloat(xAttr) / 100 * vbW : parseFloat(xAttr) || 0;
      const ty = yAttr.includes("%") ? parseFloat(yAttr) / 100 * vbH : parseFloat(yAttr) || 0;
      const anchor = textEl.getAttribute("text-anchor") || "start";
      const fs = parseFloat(textEl.getAttribute("font-size")) || parseFloat(window.getComputedStyle(textEl).fontSize) || 12;
      const fillAttr = textEl.getAttribute("fill");
      const tColor = fillAttr && fillAttr !== "none" ? parseColor(fillAttr) : null;
      if (tColor) svgTexts.push({ text: content, x: tx, y: ty, fontSize: fs, color: tColor, anchor });
    });

    if (paths.length > 0 || svgTexts.length > 0) {
      svgs.push({ ox, oy, sx, sy, vbW, vbH, paths, linecap, linejoin, svgTexts });
    } else {
      console.log(`[VectorPDF] SVG at (${ox.toFixed(0)},${oy.toFixed(0)}) ${rect.width.toFixed(0)}x${rect.height.toFixed(0)} — 0 paths found. Children:`, svg.innerHTML.substring(0, 200));
    }
  });
  return svgs;
}

// Convert SVG path d attribute to PDF path operators
// Handles: M, L, H, V, C, S, Q, T, A, Z (absolute and relative)
function svgPathToPdf(d, vbX, vbY, vbW, vbH) {
  const ops = [];
  let cx = 0, cy = 0; // current point
  let sx = 0, sy = 0; // start of subpath
  let prevCx2 = 0, prevCy2 = 0; // last control point for S/T
  let prevCmd = "";

  // Resolve percentage values (e.g. "87.5%") to absolute coords before tokenizing
  // SVG path d doesn't officially support %, but browsers handle it; resolve against viewBox
  if (vbW && vbH && d.includes("%")) {
    d = d.replace(/([+-]?(?:\d+\.?\d*|\.\d+))%/g, (_, n, offset) => {
      // Determine axis: count preceding numeric values after the last command letter
      // Even-numbered params (0,2,4..) are x-axis, odd are y-axis
      const before = d.substring(0, offset);
      const lastCmd = before.match(/[MmLlHhVvCcSsQqTtAaZz][^MmLlHhVvCcSsQqTtAaZz]*$/);
      const cmdChar = lastCmd ? lastCmd[0][0] : "M";
      const paramsBefore = lastCmd ? (lastCmd[0].substring(1).match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?%?/g) || []).length : 0;
      const isHorz = "HhMmLl".includes(cmdChar) ? (cmdChar === "H" || cmdChar === "h" || paramsBefore % 2 === 0) : paramsBefore % 2 === 0;
      const dim = isHorz ? vbW : vbH;
      return String(parseFloat(n) / 100 * dim);
    });
  }

  // Tokenize: split into commands and numbers
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g);
  if (!tokens) return "";

  let i = 0;
  const num = () => parseFloat(tokens[i++]);

  while (i < tokens.length) {
    const cmd = tokens[i];
    if (/[A-Za-z]/.test(cmd)) { i++; } else {
      // Implicit repeat of previous command (L after M, etc.)
      // This is handled by the while loops below
      // If we hit a number without a command, skip it
      if (!prevCmd) { i++; continue; }
    }

    const c = /[A-Za-z]/.test(cmd) ? cmd : prevCmd;
    prevCmd = c;

    switch (c) {
      case "M": cx = num() - vbX; cy = num() - vbY; sx = cx; sy = cy;
        ops.push(`${cx.toFixed(2)} ${cy.toFixed(2)} m`);
        prevCmd = "L"; break;
      case "m": cx += num(); cy += num(); sx = cx; sy = cy;
        ops.push(`${cx.toFixed(2)} ${cy.toFixed(2)} m`);
        prevCmd = "l"; break;
      case "L": cx = num() - vbX; cy = num() - vbY;
        ops.push(`${cx.toFixed(2)} ${cy.toFixed(2)} l`); break;
      case "l": cx += num(); cy += num();
        ops.push(`${cx.toFixed(2)} ${cy.toFixed(2)} l`); break;
      case "H": cx = num() - vbX;
        ops.push(`${cx.toFixed(2)} ${cy.toFixed(2)} l`); break;
      case "h": cx += num();
        ops.push(`${cx.toFixed(2)} ${cy.toFixed(2)} l`); break;
      case "V": cy = num() - vbY;
        ops.push(`${cx.toFixed(2)} ${cy.toFixed(2)} l`); break;
      case "v": cy += num();
        ops.push(`${cx.toFixed(2)} ${cy.toFixed(2)} l`); break;
      case "C": {
        const x1 = num() - vbX, y1 = num() - vbY;
        const x2 = num() - vbX, y2 = num() - vbY;
        cx = num() - vbX; cy = num() - vbY;
        prevCx2 = x2; prevCy2 = y2;
        ops.push(`${x1.toFixed(2)} ${y1.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)} ${cx.toFixed(2)} ${cy.toFixed(2)} c`);
        break;
      }
      case "c": {
        const x1 = cx + num(), y1 = cy + num();
        const x2 = cx + num(), y2 = cy + num();
        cx += num(); cy += num();
        prevCx2 = x2; prevCy2 = y2;
        ops.push(`${x1.toFixed(2)} ${y1.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)} ${cx.toFixed(2)} ${cy.toFixed(2)} c`);
        break;
      }
      case "S": {
        const x1 = 2 * cx - prevCx2, y1 = 2 * cy - prevCy2;
        const x2 = num() - vbX, y2 = num() - vbY;
        cx = num() - vbX; cy = num() - vbY;
        prevCx2 = x2; prevCy2 = y2;
        ops.push(`${x1.toFixed(2)} ${y1.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)} ${cx.toFixed(2)} ${cy.toFixed(2)} c`);
        break;
      }
      case "s": {
        const x1 = 2 * cx - prevCx2, y1 = 2 * cy - prevCy2;
        const x2 = cx + num(), y2 = cy + num();
        cx += num(); cy += num();
        prevCx2 = x2; prevCy2 = y2;
        ops.push(`${x1.toFixed(2)} ${y1.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)} ${cx.toFixed(2)} ${cy.toFixed(2)} c`);
        break;
      }
      case "Q": {
        // Quadratic → cubic: CP1 = P0 + 2/3*(QP - P0), CP2 = P + 2/3*(QP - P)
        const qx = num() - vbX, qy = num() - vbY;
        const ex = num() - vbX, ey = num() - vbY;
        const cp1x = cx + 2/3 * (qx - cx), cp1y = cy + 2/3 * (qy - cy);
        const cp2x = ex + 2/3 * (qx - ex), cp2y = ey + 2/3 * (qy - ey);
        prevCx2 = qx; prevCy2 = qy;
        cx = ex; cy = ey;
        ops.push(`${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${cx.toFixed(2)} ${cy.toFixed(2)} c`);
        break;
      }
      case "q": {
        const qx = cx + num(), qy = cy + num();
        const ex = cx + num(), ey = cy + num();
        const cp1x = cx + 2/3 * (qx - cx), cp1y = cy + 2/3 * (qy - cy);
        const cp2x = ex + 2/3 * (qx - ex), cp2y = ey + 2/3 * (qy - ey);
        prevCx2 = qx; prevCy2 = qy;
        cx = ex; cy = ey;
        ops.push(`${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${cx.toFixed(2)} ${cy.toFixed(2)} c`);
        break;
      }
      case "T": {
        const qx = 2 * cx - prevCx2, qy = 2 * cy - prevCy2;
        const ex = num() - vbX, ey = num() - vbY;
        const cp1x = cx + 2/3 * (qx - cx), cp1y = cy + 2/3 * (qy - cy);
        const cp2x = ex + 2/3 * (qx - ex), cp2y = ey + 2/3 * (qy - ey);
        prevCx2 = qx; prevCy2 = qy;
        cx = ex; cy = ey;
        ops.push(`${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${cx.toFixed(2)} ${cy.toFixed(2)} c`);
        break;
      }
      case "t": {
        const qx = 2 * cx - prevCx2, qy = 2 * cy - prevCy2;
        const ex = cx + num(), ey = cy + num();
        const cp1x = cx + 2/3 * (qx - cx), cp1y = cy + 2/3 * (qy - cy);
        const cp2x = ex + 2/3 * (qx - ex), cp2y = ey + 2/3 * (qy - ey);
        prevCx2 = qx; prevCy2 = qy;
        cx = ex; cy = ey;
        ops.push(`${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${cx.toFixed(2)} ${cy.toFixed(2)} c`);
        break;
      }
      case "A": case "a": {
        // Arc: approximate with line to endpoint (rare in Lucide, mostly small arcs)
        const isRel = c === "a";
        const rx = num(), ry = num();
        const angle = num(), largeArc = num(), sweep = num();
        let ex = num(), ey = num();
        if (isRel) { ex += cx; ey += cy; } else { ex -= vbX; ey -= vbY; }
        // For small arcs, approximate with arc-to-bezier
        const arcCurves = arcToBezier(cx, cy, rx, ry, angle, largeArc, sweep, ex, ey);
        for (const ac of arcCurves) {
          ops.push(`${ac.x1.toFixed(2)} ${ac.y1.toFixed(2)} ${ac.x2.toFixed(2)} ${ac.y2.toFixed(2)} ${ac.x.toFixed(2)} ${ac.y.toFixed(2)} c`);
        }
        cx = ex; cy = ey;
        break;
      }
      case "Z": case "z":
        ops.push("h"); cx = sx; cy = sy; break;
      default: i++; break;
    }
  }
  return ops.join("\n");
}

// Convert SVG arc to cubic bezier curves
function arcToBezier(x1, y1, rx, ry, angle, largeArc, sweep, x2, y2) {
  if (rx === 0 || ry === 0) return [{ x1, y1, x2: x2, y2: y2, x: x2, y: y2 }];

  const phi = angle * Math.PI / 180;
  const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);

  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  let rxSq = rx * rx, rySq = ry * ry;
  const x1pSq = x1p * x1p, y1pSq = y1p * y1p;

  // Correct radii
  const lambda = x1pSq / rxSq + y1pSq / rySq;
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s; ry *= s;
    rxSq = rx * rx; rySq = ry * ry;
  }

  let sq = Math.max(0, (rxSq * rySq - rxSq * y1pSq - rySq * x1pSq) / (rxSq * y1pSq + rySq * x1pSq));
  sq = Math.sqrt(sq) * (largeArc === sweep ? -1 : 1);

  const cxp = sq * rx * y1p / ry;
  const cyp = -sq * ry * x1p / rx;

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const vecAngle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };

  let theta1 = vecAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = vecAngle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);

  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  // Split into segments of max PI/2
  const segments = Math.ceil(Math.abs(dTheta) / (Math.PI / 2));
  const delta = dTheta / segments;
  const alpha = 4 / 3 * Math.tan(delta / 4);

  const curves = [];
  let t = theta1;
  for (let s = 0; s < segments; s++) {
    const cosT1 = Math.cos(t), sinT1 = Math.sin(t);
    const cosT2 = Math.cos(t + delta), sinT2 = Math.sin(t + delta);

    const ep1x = rx * cosT1, ep1y = ry * sinT1;
    const ep2x = rx * cosT2, ep2y = ry * sinT2;

    const cp1x = ep1x - alpha * rx * sinT1;
    const cp1y = ep1y + alpha * ry * cosT1;
    const cp2x = ep2x + alpha * rx * sinT2;
    const cp2y = ep2y - alpha * ry * cosT2;

    curves.push({
      x1: cosPhi * cp1x - sinPhi * cp1y + cx,
      y1: sinPhi * cp1x + cosPhi * cp1y + cy,
      x2: cosPhi * cp2x - sinPhi * cp2y + cx,
      y2: sinPhi * cp2x + cosPhi * cp2y + cy,
      x: cosPhi * ep2x - sinPhi * ep2y + cx,
      y: sinPhi * ep2x + cosPhi * ep2y + cy,
    });
    t += delta;
  }
  return curves;
}



// Inflate zlib-compressed base64 font data → ArrayBuffer
async function inflateFont(compressedB64) {
  const binary = atob(compressedB64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  // DecompressionStream "deflate" handles the zlib header natively
  const stream = new Response(new Blob([bytes])).body.pipeThrough(new DecompressionStream("deflate"));
  return await new Response(stream).arrayBuffer();
}

// Font CDN URLs — multiple sources tried in order (first success wins)
const FONT_CDN_URLS = {
  "DMSans-Regular.ttf": [
    "https://cdn.jsdelivr.net/gh/googlefonts/dm-fonts@main/Sans/Exports/DMSans-Regular.ttf",
    "https://raw.githubusercontent.com/googlefonts/dm-fonts/main/Sans/Exports/DMSans-Regular.ttf",
  ],
  "DMSans-Bold.ttf": [
    "https://cdn.jsdelivr.net/gh/googlefonts/dm-fonts@main/Sans/Exports/DMSans-Bold.ttf",
    "https://raw.githubusercontent.com/googlefonts/dm-fonts/main/Sans/Exports/DMSans-Bold.ttf",
  ],
  "DMSans-Italic.ttf": [
    "https://cdn.jsdelivr.net/gh/googlefonts/dm-fonts@main/Sans/Exports/DMSans-Italic.ttf",
    "https://raw.githubusercontent.com/googlefonts/dm-fonts/main/Sans/Exports/DMSans-Italic.ttf",
  ],
  "Sora-Regular.ttf": [
    "https://cdn.jsdelivr.net/gh/sora-xor/sora-font@master/fonts/ttf/v2.1beta/Sora-Regular.ttf",
    "https://raw.githubusercontent.com/sora-xor/sora-font/master/fonts/ttf/v2.1beta/Sora-Regular.ttf",
  ],
  "Sora-SemiBold.ttf": [
    "https://cdn.jsdelivr.net/gh/sora-xor/sora-font@master/fonts/ttf/v2.1beta/Sora-SemiBold.ttf",
    "https://raw.githubusercontent.com/sora-xor/sora-font/master/fonts/ttf/v2.1beta/Sora-SemiBold.ttf",
  ],
  "Sora-Bold.ttf": [
    "https://cdn.jsdelivr.net/gh/sora-xor/sora-font@master/fonts/ttf/v2.1beta/Sora-Bold.ttf",
    "https://raw.githubusercontent.com/sora-xor/sora-font/master/fonts/ttf/v2.1beta/Sora-Bold.ttf",
  ],
  "SpaceMono-Regular.ttf": [
    "https://cdn.jsdelivr.net/gh/googlefonts/spacemono@main/fonts/SpaceMono-Regular.ttf",
    "https://raw.githubusercontent.com/googlefonts/spacemono/main/fonts/SpaceMono-Regular.ttf",
  ],
  "SpaceMono-Bold.ttf": [
    "https://cdn.jsdelivr.net/gh/googlefonts/spacemono@main/fonts/SpaceMono-Bold.ttf",
    "https://raw.githubusercontent.com/googlefonts/spacemono/main/fonts/SpaceMono-Bold.ttf",
  ],
};

// ━━━ Font file mapping (F1-F8) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  F1 = DM Sans Regular (body), F2 = Sora SemiBold (display 600),
//  F3 = Space Mono Regular, F4 = Space Mono Bold,
//  F5 = DM Sans Italic, F6 = Sora Bold (display 700+),
//  F7 = DM Sans Bold (body 700+), F8 = Sora Regular (display 400)
const FONT_FILES = [
  { tag: "F1", file: "DMSans-Regular.ttf", name: "DMSans-Regular" },
  { tag: "F2", file: "Sora-SemiBold.ttf", name: "Sora-SemiBold" },
  { tag: "F3", file: "SpaceMono-Regular.ttf", name: "SpaceMono-Regular" },
  { tag: "F4", file: "SpaceMono-Bold.ttf", name: "SpaceMono-Bold" },
  { tag: "F5", file: "DMSans-Italic.ttf", name: "DMSans-Italic" },
  { tag: "F6", file: "Sora-Bold.ttf", name: "Sora-Bold" },
  { tag: "F7", file: "DMSans-Bold.ttf", name: "DMSans-Bold" },
  { tag: "F8", file: "Sora-Regular.ttf", name: "Sora-Regular" },
];

// ━━━ Build vector PDF ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function buildVectorPdf(pages, pageW, pageH, fonts, showBranding) {
  const enc = new TextEncoder();
  const parts = [];
  let offset = 0;
  const write = (str) => { const b = enc.encode(str); parts.push(b); offset += b.length; };
  const writeBin = (arr) => { parts.push(arr); offset += arr.length; };
  const objOffsets = [];
  const startObj = (n) => { objOffsets[n] = offset; write(`${n} 0 obj\n`); };
  const endObj = () => write("endobj\n");

  write("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n");

  // Object layout:
  // 1: Catalog
  // 2: Pages
  // 3-26: Font objects (8 fonts × 3 objs each: font dict, descriptor, file stream)
  //   Fallback: if a font failed to load, its 3 objs are standard Type1
  // Then per page: page obj, content stream, (optional image XObject)
  // Then annotation objects

  const fontObjStart = 3;
  const numFonts = 8;
  const objsPerFont = 3; // font dict, descriptor, file stream
  const pageObjStart = fontObjStart + numFonts * objsPerFont; // 27

  // Pre-calculate page objects
  // Each page: pageObj, contentStream, optional imageObj, optional emoji XObjects
  const pageObjs = [];
  let nextObj = pageObjStart;
  for (let i = 0; i < pages.length; i++) {
    const p = { pageObj: nextObj, contentObj: nextObj + 1, emojiObjs: [], logoObjs: [] };
    nextObj += 2;
    if (pages[i].imageData) {
      p.imageObj = nextObj;
      nextObj += 1;
    }
    const emojis = pages[i].emojiImages || [];
    for (let j = 0; j < emojis.length; j++) {
      p.emojiObjs.push(nextObj);
      nextObj += 1;
    }
    const logos = pages[i].logoImages || [];
    for (let j = 0; j < logos.length; j++) {
      p.logoObjs.push(nextObj);
      nextObj += 1;
    }
    pageObjs.push(p);
  }

  // Annotation objects come after page objects
  const annotObjStart = nextObj;
  const pageAnnotInfo = [];
  let annotCount = 0;
  for (let i = 0; i < pages.length; i++) {
    const links = pages[i].links || [];
    pageAnnotInfo.push({ start: annotObjStart + annotCount, count: links.length });
    annotCount += links.length;
  }

  // 1: Catalog
  startObj(1);
  write("<< /Type /Catalog /Pages 2 0 R >>\n");
  endObj();

  // 2: Pages
  startObj(2);
  const pageRefs = pageObjs.map(p => `${p.pageObj} 0 R`).join(" ");
  write(`<< /Type /Pages /Kids [${pageRefs}] /Count ${pages.length} >>\n`);
  endObj();

  // Font objects — embed TrueType fonts, fall back to standard Type1
  const FALLBACK_FONTS = [
    "Helvetica", "Helvetica-Bold", "Courier", "Courier-Bold",
    "Helvetica-Oblique", "Helvetica-Bold", "Helvetica-Bold", "Helvetica"
  ];
  for (let fi = 0; fi < numFonts; fi++) {
    const fontObj = fontObjStart + fi * objsPerFont;     // font dict
    const descObj = fontObj + 1;                          // descriptor
    const fileObj = fontObj + 2;                          // file stream
    const fontInfo = fonts && fonts[fi] && fonts[fi].parsed;

    if (fontInfo) {
      // TrueType font with embedded file
      const p = fontInfo;
      const widthStr = p.widths.join(" ");

      // Font file stream (raw TTF data)
      startObj(fileObj);
      write(`<< /Length ${p.data.length} /Length1 ${p.data.length} >>\nstream\n`);
      writeBin(p.data);
      write("\nendstream\n");
      endObj();

      // Font descriptor
      startObj(descObj);
      write(`<< /Type /FontDescriptor /FontName /${fonts[fi].name} /Flags ${p.flags} /FontBBox [${p.bbox.join(" ")}] /ItalicAngle ${p.italicAngle} /Ascent ${p.ascent} /Descent ${p.descent} /CapHeight ${p.capHeight} /StemV ${p.stemV} /FontFile2 ${fileObj} 0 R >>\n`);
      endObj();

      // Font dictionary
      startObj(fontObj);
      write(`<< /Type /Font /Subtype /TrueType /BaseFont /${fonts[fi].name} /FirstChar 32 /LastChar 255 /Widths [${widthStr}] /FontDescriptor ${descObj} 0 R /Encoding /WinAnsiEncoding >>\n`);
      endObj();
    } else {
      // Fallback: standard Type1 font (no embedding)
      startObj(fontObj);
      write(`<< /Type /Font /Subtype /Type1 /BaseFont /${FALLBACK_FONTS[fi]} /Encoding /WinAnsiEncoding >>\n`);
      endObj();
      // Write empty descriptor and file objs to keep numbering consistent
      startObj(descObj);
      write("<< >>\n");
      endObj();
      startObj(fileObj);
      write("<< >>\n");
      endObj();
    }
  }

  // Page objects
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const po = pageObjs[i];

    // Build content stream
    let content = "";
    // Clip to page bounds (DOM overflow:hidden is not reflected in PDF)
    content += `0 0 ${pageW} ${pageH} re W n\n`;

    if (page.imageData) {
      // Image-based page (fallback for slides with images)
      content += `q ${pageW} 0 0 ${pageH} 0 0 cm /Img0 Do Q\n`;
    }

    // Draw boxes (backgrounds, borders, gradients)
    const pageShadings = []; // collect shading dicts for this page
    if (page.boxes) {
      for (const box of page.boxes) {
        const bx = box.x, by = pageH - box.y - box.h;
        if (box.gradient) {
          // Gradient fill: clip to box shape, then shade
          const coords = gradientLineCoords(box.gradient.angleDeg, box.x, box.y, box.w, box.h, pageH);
          const shIdx = pageShadings.length;
          pageShadings.push(buildShadingDict(box.gradient, coords));
          content += "q\n";
          if (box.borderRadius > 2) {
            content += roundedRect(bx, by, box.w, box.h, Math.min(box.borderRadius, box.w / 2, box.h / 2));
            content += " W n\n";
          } else {
            content += `${bx.toFixed(1)} ${by.toFixed(1)} ${box.w.toFixed(1)} ${box.h.toFixed(1)} re W n\n`;
          }
          content += `/Sh${shIdx} sh\n`;
          content += "Q\n";
        } else if (box.bg) {
          content += `${box.bg.r.toFixed(3)} ${box.bg.g.toFixed(3)} ${box.bg.b.toFixed(3)} rg\n`;
          if (box.borderRadius > 2) {
            content += roundedRect(bx, by, box.w, box.h, Math.min(box.borderRadius, box.w / 2, box.h / 2));
            content += " f\n";
          } else {
            content += `${bx.toFixed(1)} ${by.toFixed(1)} ${box.w.toFixed(1)} ${box.h.toFixed(1)} re f\n`;
          }
        }
        if (box.borders) {
          const bx = box.x, by = pageH - box.y - box.h;
          // Draw each border as a line
          if (box.borders.left) {
            const b = box.borders.left;
            content += `${b.color.r.toFixed(3)} ${b.color.g.toFixed(3)} ${b.color.b.toFixed(3)} RG\n`;
            content += `${b.w.toFixed(1)} w\n`;
            content += `${bx.toFixed(1)} ${by.toFixed(1)} m ${bx.toFixed(1)} ${(by + box.h).toFixed(1)} l S\n`;
          }
          if (box.borders.top) {
            const b = box.borders.top;
            content += `${b.color.r.toFixed(3)} ${b.color.g.toFixed(3)} ${b.color.b.toFixed(3)} RG\n`;
            content += `${b.w.toFixed(1)} w\n`;
            content += `${bx.toFixed(1)} ${(by + box.h).toFixed(1)} m ${(bx + box.w).toFixed(1)} ${(by + box.h).toFixed(1)} l S\n`;
          }
          if (box.borders.right) {
            const b = box.borders.right;
            content += `${b.color.r.toFixed(3)} ${b.color.g.toFixed(3)} ${b.color.b.toFixed(3)} RG\n`;
            content += `${b.w.toFixed(1)} w\n`;
            content += `${(bx + box.w).toFixed(1)} ${by.toFixed(1)} m ${(bx + box.w).toFixed(1)} ${(by + box.h).toFixed(1)} l S\n`;
          }
          if (box.borders.bottom) {
            const b = box.borders.bottom;
            content += `${b.color.r.toFixed(3)} ${b.color.g.toFixed(3)} ${b.color.b.toFixed(3)} RG\n`;
            content += `${b.w.toFixed(1)} w\n`;
            content += `${bx.toFixed(1)} ${by.toFixed(1)} m ${(bx + box.w).toFixed(1)} ${by.toFixed(1)} l S\n`;
          }
        }
      }
    }

    // Draw circles
    if (page.circles) {
      for (const c of page.circles) {
        const cx = c.cx, cy = pageH - c.cy;
        if (c.bg) {
          content += `${c.bg.r.toFixed(3)} ${c.bg.g.toFixed(3)} ${c.bg.b.toFixed(3)} rg\n`;
          content += circle(cx, cy, c.r) + " f\n";
        }
        if (c.borderWidth > 0 && c.borderColor) {
          content += `${c.borderColor.r.toFixed(3)} ${c.borderColor.g.toFixed(3)} ${c.borderColor.b.toFixed(3)} RG\n`;
          content += `${c.borderWidth.toFixed(1)} w\n`;
          content += circle(cx, cy, c.r) + " S\n";
        }
      }
    }

    // Draw SVG icons (clipped to page bounds)
    if (page.svgIcons) {
      // Clip all SVG rendering to the page area (matches browser overflow: hidden on slides)
      content += "q\n";
      content += `0 0 ${pageW.toFixed(1)} ${pageH.toFixed(1)} re W n\n`;
      for (const svg of page.svgIcons) {
        // Save graphics state, transform to SVG position and scale
        // SVG coord system: y-down. PDF coord system: y-up.
        // We apply a transform: translate to position, scale, flip y
        const tx = svg.ox;
        const ty = pageH - svg.oy;
        const scX = svg.sx;
        const scY = svg.sy;
        // Combined matrix: translate(tx, ty) · scale(scX, -scY)
        // PDF CTM: [a b c d e f] → x' = a*x + c*y + e, y' = b*x + d*y + f
        content += "q\n";
        content += `${scX.toFixed(4)} 0 0 ${(-scY).toFixed(4)} ${tx.toFixed(1)} ${ty.toFixed(1)} cm\n`;
        // Set line cap and join
        const capMap = { butt: 0, round: 1, square: 2 };
        const joinMap = { miter: 0, round: 1, bevel: 2 };
        content += `${capMap[svg.linecap] || 1} J ${joinMap[svg.linejoin] || 1} j\n`;

        for (const p of svg.paths) {
          content += "q\n";
          if (p.color) {
            content += `${p.color.r.toFixed(3)} ${p.color.g.toFixed(3)} ${p.color.b.toFixed(3)} RG\n`;
          }
          if (p.fill) {
            content += `${p.fill.r.toFixed(3)} ${p.fill.g.toFixed(3)} ${p.fill.b.toFixed(3)} rg\n`;
          }
          content += `${p.strokeWidth.toFixed(2)} w\n`;
          // Per-element dash array
          if (p.dashArray && p.dashArray.length > 0) {
            content += `[${p.dashArray.join(" ")}] 0 d\n`;
          }
          // Per-element linecap/linejoin overrides
          if (p.linecap) {
            const capMap = { butt: 0, round: 1, square: 2 };
            if (capMap[p.linecap] !== undefined) content += `${capMap[p.linecap]} J\n`;
          }
          if (p.linejoin) {
            const joinMap = { miter: 0, round: 1, bevel: 2 };
            if (joinMap[p.linejoin] !== undefined) content += `${joinMap[p.linejoin]} j\n`;
          }
          content += p.ops + "\n";
          content += p.paintOp + "\n";
          content += "Q\n";
        }
        // Render SVG <text> elements
        if (svg.svgTexts) {
          for (const st of svg.svgTexts) {
            if (!st.color || !st.text) continue;
            const c = compositeColor(st.color);
            if (!c) continue;
            // In SVG transform context: coords are in viewBox space, y is flipped
            const stFs = st.fontSize;
            // text y in SVG is baseline; with y-flip transform, use raw y
            content += "q\n";
            // Undo y-flip for text (PDF text needs y-up)
            content += `1 0 0 -1 0 0 cm\n`;
            content += `${c.r.toFixed(3)} ${c.g.toFixed(3)} ${c.b.toFixed(3)} rg\n`;
            content += `BT /F3 ${stFs.toFixed(1)} Tf\n`;
            let adjX = st.x;
            if (st.anchor === "middle") adjX -= st.text.length * stFs * 0.28;
            else if (st.anchor === "end") adjX -= st.text.length * stFs * 0.56;
            content += `${adjX.toFixed(1)} ${(-st.y + stFs * 0.3).toFixed(1)} Td ${pdfStringEncode(st.text)} Tj ET\n`;
            content += "Q\n";
          }
        }
        content += "Q\n";
      }
      content += "Q\n"; // end SVG page-bounds clip
    }

    // Draw text
    if (page.textRuns) {
      // Build font lookup from embedded font data
      const fontData = {};
      if (fonts) {
        FONT_FILES.forEach((f, fi) => {
          if (fonts[fi] && fonts[fi].parsed) {
            fontData["/" + f.tag] = fonts[fi].parsed;
          }
        });
      }

      content += "BT\n";
      for (const run of page.textRuns) {
        const fontTag = pickFont(run.fontFamily, run.fontWeight, run.fontStyle);
        content += `${fontTag} ${run.fontSize.toFixed(1)} Tf\n`;
        content += `${run.color.r.toFixed(3)} ${run.color.g.toFixed(3)} ${run.color.b.toFixed(3)} rg\n`;
        // PDF text baseline: y is at baseline, DOM y is at top of ink (Range rect)
        // Place baseline directly at inkTop + ascent (skip lineGap centering)
        const fd = fontData[fontTag];
        const ascentRatio = fd ? fd.ascent / 1000 : 0.76;
        const baseline = run.y + run.fontSize * ascentRatio;
        const pdfY = pageH - baseline;
        content += `${run.x.toFixed(1)} ${pdfY.toFixed(1)} Td\n`;

        // Adjust character spacing so PDF text width matches DOM width
        // DOM width (run.w) already includes CSS letter-spacing + browser kerning
        // PDF doesn't apply kerning, so compute Tc to compensate
        let tc = run.letterSpacing;
        const n = run.text.length;
        if (n > 1 && run.w > 0 && fd && fd.widths) {
          let rawW = 0;
          for (let ci = 0; ci < n; ci++) {
            const code = run.text.charCodeAt(ci);
            rawW += (code >= 32 && code <= 255) ? (fd.widths[code - 32] || 0) : 500;
          }
          const rawPdfW = rawW * run.fontSize / 1000;
          // tc such that: rawPdfW + tc * (n-1) ≈ domW
          tc = (run.w - rawPdfW) / (n - 1);
          // Cap: don't compress more than 15% of average char width
          const maxShrink = -(rawPdfW / n) * 0.15;
          if (tc < maxShrink) tc = maxShrink;
        }
        if (Math.abs(tc) > 0.01) {
          content += `${tc.toFixed(2)} Tc\n`;
        }
        content += `${pdfStringEncode(run.text)} Tj\n`;
        if (Math.abs(tc) > 0.01) {
          content += "0 Tc\n";
        }
        // Reset position for next run
        content += `${(-run.x).toFixed(1)} ${(-pdfY).toFixed(1)} Td\n`;
      }
      content += "ET\n";
    }

    // Watermark (only when branding toggle is on)
    if (showBranding) {
      content += "BT\n";
      const wmSize = pageW / 1080 * 13;
      const wmX = pageW / 1080 * 28;
      const wmY = pageW / 1080 * 28;
      content += `/F2 ${wmSize.toFixed(1)} Tf\n`;
      content += `0.878 0.906 1.0 rg\n`; // #e0e7ff
      content += `${wmX.toFixed(1)} ${wmY.toFixed(1)} Td\n`;
      content += `${pdfStringEncode("agentIA \u00A9 2026 \u00B7 www.agentia.pt")} Tj\n`;
      content += "ET\n";
    }

    // Draw emoji images
    const emojis = page.emojiImages || [];
    for (let j = 0; j < emojis.length; j++) {
      const e = emojis[j];
      const ex = e.x, ey = pageH - e.y - e.h;
      content += `q ${e.w.toFixed(1)} 0 0 ${e.h.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)} cm /Emoji${j} Do Q\n`;
    }

    // Draw logo images
    const logos = page.logoImages || [];
    for (let j = 0; j < logos.length; j++) {
      const l = logos[j];
      const lx = l.x, ly = pageH - l.y - l.h;
      content += `q ${l.w.toFixed(1)} 0 0 ${l.h.toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)} cm /Logo${j} Do Q\n`;
    }

    const contentBytes = enc.encode(content);
    // Store shadings for this page's Resources dict
    const pageShadingDicts = pageShadings; // from box rendering above

    // Write image XObject if needed
    if (page.imageData) {
      startObj(po.imageObj);
      write(`<< /Type /XObject /Subtype /Image /Width ${pageW} /Height ${pageH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.imageData.length} >>\nstream\n`);
      writeBin(page.imageData);
      write("\nendstream\n");
      endObj();
    }

    // Write emoji XObjects (raw RGB, no compression filter)
    for (let j = 0; j < emojis.length; j++) {
      const e = emojis[j];
      startObj(po.emojiObjs[j]);
      write(`<< /Type /XObject /Subtype /Image /Width ${e.imgW} /Height ${e.imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${e.imageData.length} >>\nstream\n`);
      writeBin(e.imageData);
      write("\nendstream\n");
      endObj();
    }

    // Write logo XObjects (raw RGB, no compression filter)
    for (let j = 0; j < logos.length; j++) {
      const l = logos[j];
      startObj(po.logoObjs[j]);
      write(`<< /Type /XObject /Subtype /Image /Width ${l.imgW} /Height ${l.imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${l.imageData.length} >>\nstream\n`);
      writeBin(l.imageData);
      write("\nendstream\n");
      endObj();
    }

    // Content stream
    startObj(po.contentObj);
    write(`<< /Length ${contentBytes.length} >>\nstream\n`);
    writeBin(contentBytes);
    write("\nendstream\n");
    endObj();

    // Annotation refs
    const { start: annotStart, count: annotCnt } = pageAnnotInfo[i];
    const annotRefs = annotCnt > 0 ? ` /Annots [${Array.from({length: annotCnt}, (_, j) => `${annotStart + j} 0 R`).join(" ")}]` : "";

    // Resources
    const fontResources = FONT_FILES.map((f, fi) => `/${f.tag} ${fontObjStart + fi * objsPerFont} 0 R`).join(" ");
    let xobjResources = "";
    if (page.imageData || emojis.length > 0 || logos.length > 0) {
      let xobjs = [];
      if (page.imageData) xobjs.push(`/Img0 ${po.imageObj} 0 R`);
      for (let j = 0; j < emojis.length; j++) {
        xobjs.push(`/Emoji${j} ${po.emojiObjs[j]} 0 R`);
      }
      for (let j = 0; j < logos.length; j++) {
        xobjs.push(`/Logo${j} ${po.logoObjs[j]} 0 R`);
      }
      xobjResources = ` /XObject << ${xobjs.join(" ")} >>`;
    }

    // Shading resources (inline dictionaries for gradients)
    let shadingResources = "";
    if (pageShadingDicts.length > 0) {
      const shEntries = pageShadingDicts.map((d, j) => `/Sh${j} ${d}`).join(" ");
      shadingResources = ` /Shading << ${shEntries} >>`;
    }

    // Page object
    startObj(po.pageObj);
    write(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents ${po.contentObj} 0 R /Resources << /Font << ${fontResources} >>${xobjResources}${shadingResources} >>${annotRefs} >>\n`);
    endObj();
  }

  // Annotation objects
  for (let i = 0; i < pages.length; i++) {
    const links = pages[i].links || [];
    const { start } = pageAnnotInfo[i];
    links.forEach((link, j) => {
      const x1 = Math.round(link.x);
      const y1 = Math.round(pageH - link.y - link.h);
      const x2 = Math.round(link.x + link.w);
      const y2 = Math.round(pageH - link.y);
      // SECURITY: encode the untrusted URL through the single audited PDF-string
      // encoder (same as the raster path and text runs) rather than an ad-hoc
      // inline escape — one implementation, so no sink can drift out of sync.
      startObj(start + j);
      write(`<< /Type /Annot /Subtype /Link /Rect [${x1} ${y1} ${x2} ${y2}] /Border [0 0 0] /A << /Type /Action /S /URI /URI ${pdfStringEncode(link.href)} >> >>\n`);
      endObj();
    });
  }

  // Cross-reference table
  const totalObjs = annotObjStart + annotCount;
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

  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of parts) { result.set(p, pos); pos += p.length; }
  return result;
}

// ━━━ PDF path helpers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function roundedRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  const k = 0.5523; // Bezier approximation for quarter circle
  const kr = k * r;
  return [
    `${(x + r).toFixed(1)} ${y.toFixed(1)} m`,
    `${(x + w - r).toFixed(1)} ${y.toFixed(1)} l`,
    `${(x + w - r + kr).toFixed(1)} ${y.toFixed(1)} ${(x + w).toFixed(1)} ${(y + r - kr).toFixed(1)} ${(x + w).toFixed(1)} ${(y + r).toFixed(1)} c`,
    `${(x + w).toFixed(1)} ${(y + h - r).toFixed(1)} l`,
    `${(x + w).toFixed(1)} ${(y + h - r + kr).toFixed(1)} ${(x + w - r + kr).toFixed(1)} ${(y + h).toFixed(1)} ${(x + w - r).toFixed(1)} ${(y + h).toFixed(1)} c`,
    `${(x + r).toFixed(1)} ${(y + h).toFixed(1)} l`,
    `${(x + r - kr).toFixed(1)} ${(y + h).toFixed(1)} ${x.toFixed(1)} ${(y + h - r + kr).toFixed(1)} ${x.toFixed(1)} ${(y + h - r).toFixed(1)} c`,
    `${x.toFixed(1)} ${(y + r).toFixed(1)} l`,
    `${x.toFixed(1)} ${(y + r - kr).toFixed(1)} ${(x + r - kr).toFixed(1)} ${y.toFixed(1)} ${(x + r).toFixed(1)} ${y.toFixed(1)} c`,
  ].join("\n");
}

function circle(cx, cy, r) {
  const k = 0.5523 * r;
  return [
    `${(cx + r).toFixed(1)} ${cy.toFixed(1)} m`,
    `${(cx + r).toFixed(1)} ${(cy + k).toFixed(1)} ${(cx + k).toFixed(1)} ${(cy + r).toFixed(1)} ${cx.toFixed(1)} ${(cy + r).toFixed(1)} c`,
    `${(cx - k).toFixed(1)} ${(cy + r).toFixed(1)} ${(cx - r).toFixed(1)} ${(cy + k).toFixed(1)} ${(cx - r).toFixed(1)} ${cy.toFixed(1)} c`,
    `${(cx - r).toFixed(1)} ${(cy - k).toFixed(1)} ${(cx - k).toFixed(1)} ${(cy - r).toFixed(1)} ${cx.toFixed(1)} ${(cy - r).toFixed(1)} c`,
    `${(cx + k).toFixed(1)} ${(cy - r).toFixed(1)} ${(cx + r).toFixed(1)} ${(cy - k).toFixed(1)} ${(cx + r).toFixed(1)} ${cy.toFixed(1)} c`,
  ].join("\n");
}

// ━━━ TrueType font parsing ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Minimal TTF parser: reads tables needed for PDF embedding
// (head, hhea, hmtx, cmap, maxp, OS/2, post)

function parseTTF(buf) {
  const dv = new DataView(buf);
  const numTables = dv.getUint16(4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const off = 12 + i * 16;
    const tag = String.fromCharCode(dv.getUint8(off), dv.getUint8(off+1), dv.getUint8(off+2), dv.getUint8(off+3));
    tables[tag] = { offset: dv.getUint32(off + 8), length: dv.getUint32(off + 12) };
  }

  // head table
  const head = tables["head"];
  const unitsPerEm = dv.getUint16(head.offset + 18);
  const xMin = dv.getInt16(head.offset + 36);
  const yMin = dv.getInt16(head.offset + 38);
  const xMax = dv.getInt16(head.offset + 40);
  const yMax = dv.getInt16(head.offset + 42);

  // hhea table
  const hhea = tables["hhea"];
  const ascent = dv.getInt16(hhea.offset + 4);
  const descent = dv.getInt16(hhea.offset + 6);
  const numHMetrics = dv.getUint16(hhea.offset + 34);

  // maxp table
  const maxp = tables["maxp"];
  const numGlyphs = dv.getUint16(maxp.offset + 4);

  // hmtx table — glyph widths
  const hmtx = tables["hmtx"];
  const glyphWidths = new Uint16Array(numGlyphs);
  let lastWidth = 0;
  for (let i = 0; i < numGlyphs; i++) {
    if (i < numHMetrics) {
      lastWidth = dv.getUint16(hmtx.offset + i * 4);
    }
    glyphWidths[i] = lastWidth;
  }

  // cmap table — find format 4 subtable (platform 3, encoding 1 = Windows Unicode BMP)
  const cmap = tables["cmap"];
  const cmapNumTables = dv.getUint16(cmap.offset + 2);
  let cmapOff = 0;
  for (let i = 0; i < cmapNumTables; i++) {
    const plat = dv.getUint16(cmap.offset + 4 + i * 8);
    const enc = dv.getUint16(cmap.offset + 4 + i * 8 + 2);
    if (plat === 3 && enc === 1) {
      cmapOff = cmap.offset + dv.getUint32(cmap.offset + 4 + i * 8 + 4);
      break;
    }
    if (plat === 0) {
      cmapOff = cmap.offset + dv.getUint32(cmap.offset + 4 + i * 8 + 4);
    }
  }

  // Parse format 4 cmap
  const charToGlyph = {};
  if (cmapOff && dv.getUint16(cmapOff) === 4) {
    const segCount = dv.getUint16(cmapOff + 6) / 2;
    const endCodes = cmapOff + 14;
    const startCodes = endCodes + segCount * 2 + 2;
    const idDeltas = startCodes + segCount * 2;
    const idRangeOffsets = idDeltas + segCount * 2;
    for (let i = 0; i < segCount; i++) {
      const end = dv.getUint16(endCodes + i * 2);
      const start = dv.getUint16(startCodes + i * 2);
      const delta = dv.getInt16(idDeltas + i * 2);
      const rangeOff = dv.getUint16(idRangeOffsets + i * 2);
      if (end === 0xFFFF) break;
      for (let c = start; c <= end; c++) {
        let gid;
        if (rangeOff === 0) {
          gid = (c + delta) & 0xFFFF;
        } else {
          const glyphIdx = idRangeOffsets + i * 2 + rangeOff + (c - start) * 2;
          gid = dv.getUint16(glyphIdx);
          if (gid !== 0) gid = (gid + delta) & 0xFFFF;
        }
        charToGlyph[c] = gid;
      }
    }
  }

  // OS/2 table (optional, for better metrics)
  let capHeight = Math.round(ascent * 0.7);
  let flags = 32; // Nonsymbolic
  let italicAngle = 0;
  let stemV = 80;
  if (tables["OS/2"]) {
    const os2 = tables["OS/2"];
    const os2Version = dv.getUint16(os2.offset);
    if (os2Version >= 2 && os2.length >= 88) {
      capHeight = dv.getInt16(os2.offset + 88);
    }
    const fsSelection = dv.getUint16(os2.offset + 62);
    if (fsSelection & 1) { italicAngle = -12; flags |= 64; } // Italic → PDF Italic flag (bit 7)
    // Note: Bold is handled by the glyph outlines, no PDF flag needed for TrueType
    const usWeightClass = dv.getUint16(os2.offset + 4);
    stemV = Math.round(usWeightClass / 5);
  }
  if (tables["post"]) {
    const post = tables["post"];
    const fixed = dv.getInt32(post.offset + 4);
    italicAngle = fixed / 65536;
  }

  // Build WinAnsi char widths (chars 32-255)
  // WinAnsi maps chars 128-159 to special Unicode code points
  const winAnsiMap = {
    128: 0x20AC, 130: 0x201A, 131: 0x0192, 132: 0x201E, 133: 0x2026,
    134: 0x2020, 135: 0x2021, 136: 0x02C6, 137: 0x2030, 138: 0x0160,
    139: 0x2039, 140: 0x0152, 142: 0x017D, 145: 0x2018, 146: 0x2019,
    147: 0x201C, 148: 0x201D, 149: 0x2022, 150: 0x2013, 151: 0x2014,
    152: 0x02DC, 153: 0x2122, 154: 0x0161, 155: 0x203A, 156: 0x0153,
    158: 0x017E, 159: 0x0178
  };

  const widths = new Array(224); // chars 32-255
  for (let i = 0; i < 224; i++) {
    const charCode = i + 32;
    let unicode = charCode;
    if (charCode >= 128 && charCode <= 159 && winAnsiMap[charCode] !== undefined) {
      unicode = winAnsiMap[charCode];
    }
    const gid = charToGlyph[unicode] || 0;
    // Scale width to 1000 units per em (PDF convention)
    widths[i] = Math.round(glyphWidths[gid] * 1000 / unitsPerEm);
  }

  return {
    data: new Uint8Array(buf),
    unitsPerEm,
    ascent: Math.round(ascent * 1000 / unitsPerEm),
    descent: Math.round(descent * 1000 / unitsPerEm),
    capHeight: Math.round(capHeight * 1000 / unitsPerEm),
    bbox: [
      Math.round(xMin * 1000 / unitsPerEm),
      Math.round(yMin * 1000 / unitsPerEm),
      Math.round(xMax * 1000 / unitsPerEm),
      Math.round(yMax * 1000 / unitsPerEm)
    ],
    italicAngle,
    stemV,
    flags,
    widths, // 224 entries for chars 32-255
  };
}

// ━━━ Font loading ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let _fontCache = null;
async function loadFonts() {
  if (_fontCache) return _fontCache;
  // Load fonts: compressed embedded (inflate) → uncompressed embedded → CDN fallback → Type1 fallback
  const fonts = await Promise.all(FONT_FILES.map(async (f) => {
    try {
      // 1. Inflate from compressed base64 (zlib-deflated TTF, ~50% smaller)
      if (typeof COMPRESSED_FONTS !== "undefined" && COMPRESSED_FONTS[f.file]) {
        const buf = await inflateFont(COMPRESSED_FONTS[f.file]);
        return { ...f, parsed: parseTTF(buf) };
      }
      // 2. Decode from uncompressed embedded base64 (legacy fallback)
      if (typeof EMBEDDED_FONTS !== "undefined" && EMBEDDED_FONTS[f.file]) {
        const binary = atob(EMBEDDED_FONTS[f.file]);
        const buf = new ArrayBuffer(binary.length);
        const view = new Uint8Array(buf);
        for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
        return { ...f, parsed: parseTTF(buf) };
      }
      // 3. Try CDN fetch (for builds without embedded fonts)
      const urls = FONT_CDN_URLS[f.file];
      if (urls?.length) {
        for (const url of urls) {
          try {
            const resp = await fetch(url);
            if (resp.ok) { const buf = await resp.arrayBuffer(); return { ...f, parsed: parseTTF(buf) }; }
          } catch (_) {}
        }
      }
      console.warn("[VelaPDF] Font unavailable:", f.file);
      return null;
    } catch (e) {
      console.warn("[VelaPDF] Font load error:", f.file, e.message || e);
      return null;
    }
  }));
  _fontCache = fonts;
  return fonts;
}

// ━━━ Font selection ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function pickFont(fontFamily, weight, style) {
  const ff = (fontFamily || "").toLowerCase();
  const isBold = weight >= 700;
  const isSemiBold = weight >= 600 && weight < 700;
  const isItalic = style === "italic";
  const isMono = ff.includes("mono") || ff.includes("courier") || ff.includes("space mono");
  const isSora = ff.includes("sora");

  // Mono: F3 regular, F4 bold
  if (isMono) return isBold || isSemiBold ? "/F4" : "/F3";
  // Sora (display/headings): F6 bold, F2 semibold, F8 regular
  if (isSora) return isBold ? "/F6" : isSemiBold ? "/F2" : "/F8";
  // DM Sans (body): F7 bold, F5 italic, F1 regular
  if (isBold) return "/F7";
  if (isItalic) return "/F5";
  return "/F1";
}

// ━━━ Image capture fallback (from existing pdf-export) ━━━━━━━━━━━━━━
async function vectorDomToCanvas(element, w, h, scale) {
  await document.fonts?.ready;
  const clone = element.cloneNode(true);
  inlineAllStyles(element, clone);
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  clone.style.width = w + "px";
  clone.style.height = h + "px";
  clone.style.overflow = "hidden";
  clone.style.margin = "0";
  const xml = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <foreignObject width="100%" height="100%">${xml}</foreignObject>
  </svg>`;
  const dataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  const img = await new Promise((res, rej) => {
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
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

// ━━━ Vector PDF Export Modal ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function VectorPdfExportModal({ slides, branding, deckTitle, onClose, initialRatio }) {
  const [ratio, setRatio] = useState(initialRatio || "16:9");
  const [phase, setPhase] = useState(initialRatio ? "exporting" : "choose"); // auto-start if ratio pre-selected
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [pdfBlob, setPdfBlob] = useState(null); // { size } for stats
  const [pdfDataUri, setPdfDataUri] = useState(null);
  const [thumbs, setThumbs] = useState([]);
  const offscreenRef = useRef(null);
  const [renderIdx, setRenderIdx] = useState(initialRatio ? 0 : -1);
  const pagesRef = useRef([]);
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;
  const [showBranding, setShowBranding] = useState(false);
  const showBrandingRef = useRef(showBranding);
  showBrandingRef.current = showBranding;

  const renderDims = useCallback(() => {
    const r = VECTOR_RATIOS.find(r => r.id === ratioRef.current) || VECTOR_RATIOS[0];
    const rh0 = Math.round(VIRTUAL_W * (r.h / r.w));
    const heightRatio = rh0 / VIRTUAL_H;
    const zoom = heightRatio <= 1.05 ? 1 : Math.pow(heightRatio, 0.45);
    const rw = Math.round(VIRTUAL_W / zoom);
    const rh = Math.round(rh0 / zoom);
    return { rw, rh, pw: r.w, ph: r.h, heightRatio };
  }, []);

  const startExport = useCallback(() => {
    setPhase("exporting");
    setProgress(0);
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
        const { rw, rh, pw, ph } = renderDims();
        const scaleX = pw / rw;
        const scaleY = ph / rh;
        const slide = slides[renderIdx];
        const isImageSlide = slideHasImages(slide);
        const containerRect = el.getBoundingClientRect();

        let pageData;

        if (isImageSlide) {
          // Fallback: capture as image using domToCanvas (handles data: URI images properly)
          const slideBg = slide.bgGradient || slide.bg || null;
          const canvas = await domToCanvas(el, rw, rh, 3, slideBg);
          const pageCanvas = document.createElement("canvas");
          pageCanvas.width = pw;
          pageCanvas.height = ph;
          const ctx = pageCanvas.getContext("2d");
          ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, pw, ph);
          if (showBrandingRef.current) drawVelaWatermark(ctx, pw, ph);
          const jpegData = await canvasToJpegBytes(pageCanvas, 0.95);
          const links = extractLinks(el, containerRect);
          pageData = {
            imageData: jpegData,
            links: links.map(l => ({ href: l.href, x: l.x * scaleX, y: l.y * scaleY, w: l.w * scaleX, h: l.h * scaleY })),
          };
        } else {
          // Vector extraction — start with explicit slide background
          // Set composite background for this slide so parseColor can alpha-blend correctly
          const rawBgStr = slide.bg || window.getComputedStyle(el).backgroundColor;
          const rawBgMatch = rawBgStr && rawBgStr.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
          if (rawBgMatch) {
            _compositeBg = { r: parseInt(rawBgMatch[1])/255, g: parseInt(rawBgMatch[2])/255, b: parseInt(rawBgMatch[3])/255 };
          } else if (rawBgStr && rawBgStr.match(/^#([0-9a-f]{3,8})$/i)) {
            let h = rawBgStr.match(/^#([0-9a-f]{3,8})$/i)[1];
            if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
            _compositeBg = { r: parseInt(h.substring(0,2),16)/255, g: parseInt(h.substring(2,4),16)/255, b: parseInt(h.substring(4,6),16)/255 };
          } else if (rawBgStr && rawBgStr.match(/#([0-9a-f]{3,8})/i)) {
            // Gradient (e.g. title-card "linear-gradient(... #f8fafc ...)") — use the
            // first hex stop as the alpha-blend base so translucent badges/icons over
            // a light card don't composite onto the dark #0a0f1c fallback (navy boxes).
            let h = rawBgStr.match(/#([0-9a-f]{3,8})/i)[1];
            if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
            _compositeBg = { r: parseInt(h.substring(0,2),16)/255, g: parseInt(h.substring(2,4),16)/255, b: parseInt(h.substring(4,6),16)/255 };
          } else {
            _compositeBg = { r: 10/255, g: 15/255, b: 28/255 }; // fallback #0a0f1c
          }
          const slideBgStr = rawBgStr;
          const slideBg = parseColor(slideBgStr) || parseColor("#0a0f1c");
          const slideGrad = parseLinearGradient(slide.bgGradient || slideBgStr);
          const bgBox = [{ x: 0, y: 0, w: pw, h: ph, bg: slideBg, gradient: slideGrad || undefined, borderRadius: 0 }];

          const boxes = bgBox.concat(extractBoxes(el, containerRect).map(b => ({
            ...b,
            x: b.x * scaleX, y: b.y * scaleY,
            w: b.w * scaleX, h: b.h * scaleY,
            borderRadius: b.borderRadius * Math.min(scaleX, scaleY),
            borders: b.borders ? Object.fromEntries(
              Object.entries(b.borders).map(([k, v]) => [k, { w: v.w * Math.min(scaleX, scaleY), color: v.color }])
            ) : undefined,
          })));
          const textRuns = extractTextRuns(el, containerRect).map(r => ({
            ...r,
            x: r.x * scaleX, y: r.y * scaleY,
            w: r.w * scaleX, h: r.h * scaleY,
            fontSize: r.fontSize * Math.min(scaleX, scaleY),
            letterSpacing: r.letterSpacing * Math.min(scaleX, scaleY),
          }));
          const circles = extractCircles(el, containerRect).map(c => ({
            ...c,
            cx: c.cx * scaleX, cy: c.cy * scaleY,
            r: c.r * Math.min(scaleX, scaleY),
            borderWidth: c.borderWidth * Math.min(scaleX, scaleY),
          }));
          const svgIcons = extractSVGs(el, containerRect).map(s => ({
            ...s,
            ox: s.ox * scaleX, oy: s.oy * scaleY,
            sx: s.sx * scaleX, sy: s.sy * scaleY,
          }));
          let emojiImages = [];
          try {
            emojiImages = await extractEmojiImages(el, containerRect, textRuns);
          } catch (emojiErr) {
            console.warn("[VectorPDF] Emoji extraction failed:", emojiErr);
          }
          let logoImages = [];
          try {
            logoImages = await extractLogoImages(el, containerRect);
          } catch (logoErr) {
            console.warn("[VectorPDF] Logo extraction failed:", logoErr);
          }
          const scaledLogos = logoImages.map(l => ({
            ...l,
            x: l.x * scaleX, y: l.y * scaleY,
            w: l.w * scaleX, h: l.h * scaleY,
          }));
          const scaledEmojis = emojiImages.map(e => ({
            ...e,
            x: e.x * scaleX, y: e.y * scaleY,
            w: e.w * scaleX, h: e.h * scaleY,
          }));
          const links = extractLinks(el, containerRect).map(l => ({
            href: l.href, x: l.x * scaleX, y: l.y * scaleY, w: l.w * scaleX, h: l.h * scaleY,
          }));
          console.log(`[VectorPDF] Slide ${renderIdx+1}: ${boxes.length} boxes, ${textRuns.length} texts, ${circles.length} circles, ${svgIcons.length} svgs, ${scaledEmojis.length} emojis, ${links.length} links`);
          // Post-extraction: align flow arrow SVGs to nearest circle center
          if (circles.length > 0) {
            for (const svg of svgIcons) {
              if (svg.vbH > 15 || svg.vbW > 30) continue;
              const svgCy = svg.oy + svg.vbH * svg.sy / 2;
              let best = null, bestDist = Infinity;
              for (const ci of circles) {
                const dx = Math.abs(ci.cx - (svg.ox + svg.vbW * svg.sx / 2));
                const dy = Math.abs(ci.cy - svgCy);
                if (dx < 500 * scaleX && dy < 30 * scaleY && dy < bestDist) {
                  best = ci; bestDist = dy;
                }
              }
              if (best && bestDist > 1) {
                svg.oy = best.cy - svg.vbH * svg.sy / 2;
              }
            }
          }
          // Post-extraction: snap timeline dots to their horizontal line
          // Timeline dots are small circles (r<8) that appear in a row (3+) at similar Y
          if (circles.length >= 3 && boxes.length > 0) {
            // Find groups of small circles at similar Y (within 5px) — these are timeline dots
            const smallCircles = circles.filter(c => c.r <= 10 * Math.min(scaleX, scaleY));
            const timelineGroups = [];
            for (const ci of smallCircles) {
              const siblings = smallCircles.filter(c2 => c2 !== ci && Math.abs(c2.cy - ci.cy) < 8 * scaleY);
              if (siblings.length >= 2) { // at least 3 dots in a row
                if (!timelineGroups.some(g => Math.abs(g[0].cy - ci.cy) < 8 * scaleY)) {
                  timelineGroups.push([ci, ...siblings]);
                }
              }
            }
            for (const group of timelineGroups) {
              // Find the thin horizontal line box for this group
              const groupCy = group.reduce((s, c) => s + c.cy, 0) / group.length;
              let bestLine = null, bestDy = Infinity;
              for (const box of boxes) {
                if (box.h > 6 * scaleY || box.w < 50 * scaleX) continue;
                const lineCy = box.y + box.h / 2;
                const dy = Math.abs(groupCy - lineCy);
                if (dy < 15 * scaleY && dy < bestDy) {
                  bestLine = box; bestDy = dy;
                }
              }
              if (bestLine && bestDy > 1) {
                const targetCy = bestLine.y + bestLine.h / 2;
                for (const ci of group) ci.cy = targetCy;
              }
            }
          }
          // Post-extraction: snap bullet/icon-row SVG icons to adjacent text center
          // BUT if the icon is inside a circle (IconBubble), snap to circle center instead
          if (textRuns.length > 0) {
            for (const svg of svgIcons) {
              const svgH = svg.vbH * svg.sy;
              const svgW = svg.vbW * svg.sx;
              if (svgH > 40 * scaleY || svgW > 40 * scaleX) continue; // only small icons
              if (svg.vbW !== 24 || svg.vbH !== 24) continue; // only Lucide icons (24x24 viewBox)
              const svgCx = svg.ox + svgW / 2;
              const svgCy = svg.oy + svgH / 2;

              // Check if this icon is inside a circle (IconBubble)
              let parentCircle = null;
              for (const ci of circles) {
                const dx = Math.abs(ci.cx - svgCx);
                const dy = Math.abs(ci.cy - svgCy);
                if (dx < ci.r && dy < ci.r) {
                  parentCircle = ci;
                  break;
                }
              }

              if (parentCircle) {
                // Snap icon to circle center
                const delta = parentCircle.cy - svgCy;
                if (Math.abs(delta) > 1) svg.oy += delta;
              } else {
                // No parent circle — snap to adjacent text center (bullets, etc.)
                const svgRight = svg.ox + svgW;
                let bestRun = null, bestDx = Infinity;
                for (const run of textRuns) {
                  const dx = run.x - svgRight;
                  const dy = Math.abs((run.y + run.h / 2) - svgCy);
                  if (dx > 0 && dx < 40 * scaleX && dy < 20 * scaleY && dx < bestDx) {
                    bestRun = run; bestDx = dx;
                  }
                }
                if (bestRun) {
                  const textCy = bestRun.y + bestRun.h / 2;
                  const delta = textCy - svgCy;
                  if (Math.abs(delta) > 1) svg.oy += delta;
                }
              }
            }
          }
          pageData = { boxes, textRuns, circles, svgIcons, emojiImages: scaledEmojis, logoImages: scaledLogos, links };
        }

        pagesRef.current.push(pageData);

        // Generate thumbnail via quick canvas capture
        const thumbCanvas = document.createElement("canvas");
        const tw = 120, th = Math.round(120 * (rh / rw));
        thumbCanvas.width = tw * 2; thumbCanvas.height = th * 2;
        const tctx = thumbCanvas.getContext("2d");
        // Quick render for thumb
        const quickCanvas = await vectorDomToCanvas(el, rw, rh, 1);
        tctx.drawImage(quickCanvas, 0, 0, quickCanvas.width, quickCanvas.height, 0, 0, tw * 2, th * 2);
        setThumbs(prev => [...prev, thumbCanvas.toDataURL("image/jpeg", 0.5)]);

        setProgress(((renderIdx + 1) / slides.length) * 100);

        if (renderIdx + 1 < slides.length) {
          setRenderIdx(renderIdx + 1);
        } else {
          // Finalize PDF — load embedded fonts, then build
          const { pw: fpw, ph: fph } = renderDims();
          const fonts = await loadFonts();
          const pdfBytes = buildVectorPdf(pagesRef.current, fpw, fph, fonts, showBrandingRef.current);
          // Convert to base64 data URI (blob: URLs blocked in sandbox)
          let binary = "";
          for (let i = 0; i < pdfBytes.length; i++) binary += String.fromCharCode(pdfBytes[i]);
          const b64 = btoa(binary);
          setPdfDataUri("data:application/pdf;base64," + b64);
          setPdfBlob({ size: pdfBytes.length }); // keep size for stats
          setPhase("done");
        }
      } catch (err) {
        console.error("Vector PDF export error:", err);
        setErrorMsg(`Export failed on slide ${renderIdx + 1}: ${err.message}`);
        setPhase("error");
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [renderIdx, phase, slides.length]);

  const safeTitle = ((deckTitle || "vela-deck").replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-{2,}/g, "-").slice(0, 60));

  const currentSlide = renderIdx >= 0 && renderIdx < slides.length ? slides[renderIdx] : null;
  const imageSlideCount = slides.filter(s => slideHasImages(s)).length;
  const vectorSlideCount = slides.length - imageSlideCount;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 10001, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 12, width: "min(480px, 94vw)", maxHeight: "94vh", boxShadow: "0 20px 60px rgba(0,0,0,0.6)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {getIcon("FileDown", { size: 14, color: T.accent })}
            <span style={{ fontFamily: FONT.mono, fontSize: 11, fontWeight: 700, color: T.accent, letterSpacing: 1 }}>VECTOR PDF</span>
            <span style={{ fontFamily: FONT.mono, fontSize: 8, color: T.green || "#34d399", background: `${T.green || "#34d399"}18`, padding: "1px 5px", borderRadius: 3, fontWeight: 600, letterSpacing: 0.5 }}>HD</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 16, padding: "0 4px", lineHeight: 1 }}>{"\u2715"}</button>
        </div>

        <div style={{ display: "block", flex: 1, minHeight: 0, overflow: "hidden" }}>
        <div style={{ padding: "20px 16px", overflowY: "auto" }}>
          {phase === "choose" && <>
            <div style={{ fontFamily: FONT.body, fontSize: 13, color: T.textMuted, marginBottom: 6 }}>
              Scalable vector text — perfect for LinkedIn
            </div>
            {imageSlideCount > 0 && (
              <div style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim, marginBottom: 14, padding: "6px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 6, border: `1px solid ${T.border}` }}>
                {vectorSlideCount} slides as vector text {"\u00B7"} {imageSlideCount} slides with images as high-res capture
              </div>
            )}
            <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
              {VECTOR_RATIOS.map(r => (
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
            <button onClick={startExport} style={{
              width: "100%", padding: "10px", fontFamily: FONT.mono, fontSize: 12, fontWeight: 700,
              background: T.accent, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer",
              letterSpacing: 1, transition: "opacity .15s",
            }}>
              EXPORT {slides.length} SLIDES
            </button>
          </>}

          {(phase === "exporting" || phase === "done") && (() => {
            const r = VECTOR_RATIOS.find(r => r.id === ratio) || VECTOR_RATIOS[0];
            const thumbW = 56, thumbH = Math.round(56 * (r.h / r.w));
            const bigW = 140, bigH = Math.round(140 * (r.h / r.w));
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
                    {slideHasImages(slides[renderIdx]) ? "Capturing" : "Extracting"} {renderIdx + 1} of {slides.length}
                  </div>
                  <div style={{ width: "100%", height: 4, background: T.border, borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${progress}%`, height: "100%", background: `linear-gradient(90deg, ${T.accent}, ${T.green || "#34d399"})`, borderRadius: 2, transition: "width .3s ease" }} />
                  </div>
                </> : <>
                  <div style={{ fontFamily: FONT.mono, fontSize: 13, color: T.green || "#34d399", fontWeight: 700, marginBottom: 4 }}>
                    {"\u2705"} {slides.length} pages ready
                  </div>
                  <div style={{ fontFamily: FONT.mono, fontSize: 10, color: T.textDim }}>
                    {vectorSlideCount} vector {"\u00B7"} {imageSlideCount} image {"\u00B7"} {(pdfBlob?.size / 1024).toFixed(0)} KB
                  </div>
                </>}
              </div>

              {phase === "done" && <>
                <div style={{ display: "flex", gap: 8 }}>
                  <a href={pdfDataUri} download={`${safeTitle}.pdf`} style={{
                    flex: 1, padding: "10px", fontFamily: FONT.mono, fontSize: 12, fontWeight: 700,
                    background: T.accent, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer",
                    letterSpacing: 1, textAlign: "center", textDecoration: "none",
                  }}>
                    {"\u2B07"} DOWNLOAD PDF
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
              <div style={{ fontSize: 32, marginBottom: 8 }}>{"\u274C"}</div>
              <div style={{ fontFamily: FONT.mono, fontSize: 11, color: "#ef4444", marginBottom: 8 }}>{errorMsg}</div>
            </div>
            <button onClick={onClose} style={{
              width: "100%", padding: "10px", fontFamily: FONT.mono, fontSize: 12, fontWeight: 700,
              background: "rgba(239,68,68,0.2)", color: "#ef4444", border: "1px solid #ef4444", borderRadius: 6, cursor: "pointer",
            }}>CLOSE</button>
          </>}
        </div>

        </div>
      </div>

      {/* Offscreen slide renderer */}
      {phase === "exporting" && currentSlide && (() => {
        const r = VECTOR_RATIOS.find(r => r.id === ratio) || VECTOR_RATIOS[0];
        const rh0 = Math.round(VIRTUAL_W * (r.h / r.w));
        const heightRatio = rh0 / VIRTUAL_H;
        const reflowed = reflowSlideForRatio(currentSlide, heightRatio);
        const zoom = heightRatio <= 1.05 ? 1 : Math.pow(heightRatio, 0.45);
        const rw = Math.round(VIRTUAL_W / zoom);
        const rh = Math.round(rh0 / zoom);
        // Match presentation numbering: title cards aren't counted toward slide numbers.
        const displayTotal = slides.reduce((n, s) => n + (s._virtual ? 0 : 1), 0);
        let nonVirtualBefore = 0;
        for (let i = 0; i < renderIdx; i++) if (!slides[i]._virtual) nonVirtualBefore++;
        const displayIndex = currentSlide._virtual ? nonVirtualBefore - 1 : nonVirtualBefore;
        return (
          <div style={{ position: "fixed", left: -9999, top: -9999, width: rw, height: rh, overflow: "hidden", zIndex: -1 }}>
            <style>{`.no-anim, .no-anim * { animation: none !important; transition: none !important; }`}</style>
            <div ref={offscreenRef} className="no-anim vela-pdf-capture" style={{ width: rw, height: rh, overflow: "hidden" }}>
              <SlideContent slide={reflowed} index={renderIdx} total={slides.length} branding={currentSlide._virtual ? null : branding} displayIndex={displayIndex} displayTotal={displayTotal} />
            </div>
          </div>
        );
      })()}
    </div>
  );
}



// Helper to collect all slides flat from editor lanes
// Strip hidden blocks from a slide so exports match the presented output.
function stripHiddenBlocks(slide) {
  if (!slide || typeof slide !== "object") return slide;
  const hasHidden = ["blocks", "L", "R"].some((k) => Array.isArray(slide[k]) && slide[k].some((b) => b && b.hidden));
  if (!hasHidden) return slide;
  const out = { ...slide };
  for (const k of ["blocks", "L", "R"]) if (Array.isArray(out[k])) out[k] = out[k].filter((b) => !(b && b.hidden));
  return out;
}

function collectAllSlides(lanes, branding) {
  const all = [];
  for (const lane of (lanes || [])) {
    for (const item of (lane.items || [])) {
      // Mirror presentation mode: a module with "present card" enabled shows an
      // auto-generated title slide before its content slides.
      if (item.presentCard) all.push(buildTitleCardSlide(item, lane, branding));
      for (const slide of (item.slides || [])) {
        // Hidden slides/elements are not part of the presentation, so keep them
        // out of exports too (CR: hide/unhide).
        if (slide && slide.hidden) continue;
        all.push(stripHiddenBlocks(slide));
      }
    }
  }
  return all;
}

// ━━━ Markdown Export ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function deckToMarkdown(state, opts = {}) {
  const { includeNotes = true } = opts;
  const lines = [];
  const ln = (...a) => lines.push(...a);
  const blank = () => { if (lines.length && lines[lines.length - 1] !== "") lines.push(""); };

  // SECURITY (CWE-116, output encoding at the sink): deck text is emitted into a
  // MARKDOWN grammar, so it needs Markdown-context encoding — the HTML-tag strip
  // in sanitizeString does not cover it. Without this, a deck string could embed
  // `[x](javascript:…)` or a zero-click image beacon `![](https://attacker/…)`
  // that survives verbatim into the exported .md (the live renderer already
  // re-validates such inline links via sanitizeUrl in parseInline; this reaches
  // parity). Defense-in-depth: (1) allowlist link/image DESTINATION schemes via
  // the same sanitizeUrl gate used everywhere else, and (2) backslash-escape
  // Markdown metacharacters in any text placed inside a link label.
  const mdUrl = (u) => { try { return (typeof sanitizeUrl === "function" ? (sanitizeUrl(u) || "") : ""); } catch { return ""; } };
  // Encode a scheme-validated URL for the Markdown link-DESTINATION context
  // `(...)`. sanitizeUrl fixes the SCHEME, but that is an HTML-href validator, not
  // a Markdown-destination encoder: the WHATWG URL parser leaves `)` (and `(`)
  // unescaped in a path, and the authority-less (mailto:) branch returns the raw
  // target — so a `)` closes the destination early (letting the trailing bytes
  // render as a fresh image/link) and a mailto: newline injects block structure.
  // Percent-encode exactly the bytes that break out of `(...)` — parens,
  // whitespace/controls, angle brackets, backslash, backtick — leaving a still-
  // functional URL. Every URL that lands inside `(...)` MUST go through this.
  const mdDest = (u) => { const s = mdUrl(u); return s ? s.replace(/[\s()<>\\`]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")) : ""; };
  // Free BODY text: keep emphasis (**bold**, *italic*, ~~strike~~) but sanitize
  // inline [label](target) link targets and NEUTRALIZE image auto-load (the live
  // renderer never auto-loads text images) — a blocked/opaque scheme collapses
  // the span to its plain label, an allowed one stays a link (never an image).
  const mdInline = (t, cell) => {
    if (t == null) return "";
    const src = String(t);
    // Walk the string as alternating INLINE-link spans and the gaps between them.
    // In each gap, escape every `[`/`]` so Markdown reference-style links/images
    // ([a][ref], ![a][ref], collapsed/shortcut [ref]) AND their definition lines
    // ([ref]: url) cannot form: those forms contain no literal `(`, so the inline
    // rewriter and mdDest never see them and their URL would otherwise reach a .md
    // viewer unchecked. The live renderer (parseInline) supports only inline links,
    // so escaping is both safe (same literal text) and parity-correct (CWE-116:
    // cover the whole grammar, not just the `(...)` form). The escaper ALSO covers
    // `<`/`>`: Markdown permits RAW HTML and autolinks (`<img src=beacon>`,
    // `<a href=javascript:…>`, `<scheme:…>`), which need neither `(` nor `[` and
    // would otherwise reach a .md viewer live — the "parity" argument does not hold
    // here because the live app renders these fields as escaped React text, not as
    // markup. Each inline span is scheme-checked + destination-encoded (mdDest), the
    // leading `!` dropped so an image can only downgrade to a link, and a blocked
    // scheme collapses to the plain label. The label group is `*?` (empty allowed)
    // so an empty-alt beacon `![](url)` (which the live renderer ignores) is caught
    // too, and the surviving label is escaped so it cannot carry raw HTML either.
    // Backslash is escaped FIRST-CLASS (in the same class), not just the target
    // metachars: a lone `\` before an escaped char would otherwise revive it —
    // attacker `\<` -> `\\<` renders as a literal `\` + a LIVE `<`. Escaping `\`
    // too makes every `\[`/`\]`/`\<`/`\>` unrevivable.
    // In cell mode `|` joins the class so it is escaped in the SAME pass as
    // backslash (escaped first-class), not by a separate order-dependent replace.
    const gapRe = cell ? /[\\\[\]<>|]/g : /[\\\[\]<>]/g;
    const escGap = (g) => g.replace(gapRe, "\\$&");
    const re = /!?\[([^\[\]\n]*?)\]\(([^\s)\n]+?)\)/g;
    let out = "", last = 0, m;
    while ((m = re.exec(src)) !== null) {
      out += escGap(src.slice(last, m.index));
      const safe = mdDest(m[2]);
      out += safe ? `[${escGap(m[1])}](${safe})` : escGap(m[1]);
      last = m.index + m[0].length;
    }
    out += escGap(src.slice(last));
    return out.replace(/\n/g, "  \n");
  };
  // Text used INSIDE a [ … ] link label: strict metachar escape so a crafted
  // label cannot break out of, or nest inside, the surrounding link syntax.
  const mdLabel = (t) => String(t == null ? "" : t).replace(/\n/g, " ").replace(/([\\`*_\[\]()~!<>])/g, "\\$1");
  // Build a link only when the destination passes the scheme allowlist; a blocked
  // target degrades to the plain (escaped) label rather than emitting a bad URL.
  const mdLink = (label, target) => { const s = mdDest(target); return s ? `[${mdLabel(label)}](${s})` : mdLabel(label); };
  // Table cell: inline-sanitize in CELL mode (escGap escapes `|` alongside
  // backslash/brackets/angles in one complete pass — no separate, order-dependent
  // pipe replace), then collapse newlines. A cell cannot inject columns or break
  // the row grammar, and backslash is not double-escaped.
  const mdCell = (t) => mdInline(t, true).replace(/\n/g, " ");
  // Code fence long enough that backtick runs in the content cannot close it.
  const mdFence = (code) => { const runs = String(code == null ? "" : code).match(/`+/g) || []; const max = runs.reduce((m, r) => Math.max(m, r.length), 0); return "`".repeat(Math.max(3, max + 1)); };
  // Heading text: inline-sanitize then collapse newlines so a title cannot spill
  // past its single `#`-prefixed line into injected markdown.
  const mdHead = (t) => mdInline(t).replace(/\n/g, " ");
  const txt = mdInline;

  const blockToMd = (b, depth = 0) => {
    const indent = "  ".repeat(depth);
    switch (b.type) {
      case "heading": {
        const level = ({ "4xl": 1, "3xl": 1, "2xl": 2, xl: 2, lg: 3, md: 3, sm: 4 })[b.size || "2xl"] || 2;
        blank();
        ln(`${indent}${"#".repeat(level)} ${txt(b.text)}`);
        break;
      }
      case "text": {
        blank();
        const src = mdDest(b.link);
        ln(`${indent}${txt(b.text)}${src ? ` — [source](${src})` : ""}`);
        break;
      }
      case "badge":
        ln(`${indent}**${txt(b.text)}**`);
        break;
      case "bullets":
        blank();
        for (const item of (b.items || [])) {
          const t = typeof item === "string" ? item : item.text;
          const link = typeof item === "object" ? item.link : null;
          if (link) ln(`${indent}- ${mdLink(t, link)}`);
          else ln(`${indent}- ${txt(t)}`);
        }
        break;
      case "icon-row":
        blank();
        for (const item of (b.items || [])) {
          const title = item.title || "";
          const sub = item.text ? ` — ${txt(item.text)}` : "";
          if (item.link) ln(`${indent}- ${mdLink(title, item.link)}${sub}`);
          else ln(`${indent}- ${txt(title)}${sub}`);
        }
        break;
      case "quote":
        blank();
        ln(`${indent}> ${txt(b.text)}`);
        if (b.author) ln(`${indent}> — ${txt(b.author)}`);
        { const s = mdDest(b.link); if (s) ln(`${indent}> [Source](${s})`); }
        break;
      case "callout":
        blank();
        if (b.title) ln(`${indent}> **${txt(b.title)}**`);
        ln(`${indent}> ${txt(b.text)}`);
        { const s = mdDest(b.link); if (s) ln(`${indent}> [Source](${s})`); }
        break;
      case "metric":
        ln(`${indent}**${txt(b.value)}** ${b.label ? `— ${txt(b.label)}` : ""}`);
        { const s = mdDest(b.link); if (s) ln(`${indent}[Source](${s})`); }
        break;
      case "code": {
        blank();
        if (b.label) ln(`${indent}*${txt(b.label)}*`);
        // Fence longer than any backtick run in the body so `b.text` cannot close
        // the fence early and inject markdown after it; lang is word-chars only.
        const fence = mdFence(b.text);
        const lang = String(b.lang || "").replace(/[^A-Za-z0-9_+.-]/g, "");
        ln(`${indent}${fence}${lang}`);
        ln(b.text || "");
        ln(`${indent}${fence}`);
        break;
      }
      case "table": {
        blank();
        const cols = b.headers || [];
        const rows = b.rows || [];
        if (cols.length) {
          ln(`${indent}| ${cols.map(mdCell).join(" | ")} |`);
          ln(`${indent}| ${cols.map(() => "---").join(" | ")} |`);
        }
        for (const row of rows) {
          const cells = Array.isArray(row) ? row : (row.cells || []);
          ln(`${indent}| ${cells.map(mdCell).join(" | ")} |`);
        }
        { const s = mdDest(b.link); if (s) ln(`${indent}[Source](${s})`); }
        break;
      }
      case "grid":
        for (const cell of (b.items || [])) {
          for (const cb of (cell.blocks || [])) {
            blockToMd(cb, depth);
          }
          blank();
        }
        break;
      case "flow":
      case "steps":
        blank();
        for (let i = 0; i < (b.items || []).length; i++) {
          const item = b.items[i];
          const label = item.label || item.title || "";
          const sub = item.sublabel || item.text || "";
          ln(`${indent}${i + 1}. **${txt(label)}**${sub ? ` — ${txt(sub)}` : ""}`);
        }
        if (b.loop && b.loopLabel) ln(`${indent}*↺ ${txt(b.loopLabel)}*`);
        else if (b.loop) ln(`${indent}*↺ (loops back to step 1)*`);
        break;
      case "svg":
        if (b.caption) { blank(); ln(`${indent}*${txt(b.caption)}*`); }
        break;
      case "timeline":
        blank();
        for (const item of (b.items || [])) {
          const date = item.date ? `**${txt(item.date)}** ` : "";
          ln(`${indent}- ${date}${txt(item.title || "")}${item.text ? ` — ${txt(item.text)}` : ""}`);
        }
        break;
      case "progress":
        blank();
        for (const item of (b.items || [])) {
          ln(`${indent}- ${txt(item.label || "")}: ${txt(item.value ?? 0)}%`);
        }
        break;
      case "tag-group":
        blank();
        ln(`${indent}${(b.items || []).map(item => { const s = String(typeof item === "string" ? item : (item.text || item.label || "")).replace(/[`\n]/g, " "); return `\`${s}\``; }).join("  ")}`);
        break;
      case "image": {
        // Only emit a markdown image for a scheme-allowlisted external src; alt
        // text is metachar-escaped. A blocked/opaque src degrades to the caption.
        const isrc = (b.src && !b.src.startsWith("data:")) ? mdDest(b.src) : "";
        if (isrc) {
          blank();
          ln(`${indent}![${mdLabel(b.alt || b.caption || "")}](${isrc})`);
        } else if (b.caption) {
          ln(`${indent}*${txt(b.caption)}*`);
        }
        break;
      }
      case "divider":
        blank();
        ln(`${indent}---`);
        break;
      // spacer, icon — skip silently
    }
  };

  // Title
  ln(`# ${mdHead(state.deckTitle || "Untitled Deck")}`);
  blank();

  let slideNum = 0;
  for (const lane of (state.lanes || [])) {
    // Lane as top section
    blank();
    ln(`---`);
    blank();
    ln(`# ${mdHead(lane.title || "Untitled Section")}`);
    blank();

    for (const item of (lane.items || [])) {
      // Module as sub-section
      blank();
      ln(`## ${mdHead(item.title || "Untitled Module")}`);

      for (const slide of (item.slides || [])) {
        if (slide && slide.hidden) continue; // hidden slides are not exported
        slideNum++;
        blank();

        // Speaker notes as metadata
        const blocks = (slide.blocks || []).filter((b) => !(b && b.hidden));
        if (!blocks.length) continue;

        for (const b of blocks) blockToMd(b);

        if (includeNotes && slide.speakerNotes) {
          blank();
          ln(`> 🎤 *${txt(slide.speakerNotes)}*`);
        }
      }
    }
  }

  blank();
  ln(`---`);
  ln(`*Exported from Vela · ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}*`);

  return lines.join("\n");
}

function exportMarkdown(state, opts = {}) {
  const md = deckToMarkdown(state, opts);
  const title = state.deckTitle || "Untitled";
  const safeTitle = title.replace(/[^a-zA-Z0-9_\s-]/g, "").replace(/\s+/g, "-").slice(0, 60) || "vela-deck";
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url;
  a.download = `${safeTitle}.md`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ━━━ Standalone HTML Export ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// One shareable .html: the transpiled app + the current deck, inlined; React/
// ReactDOM/lucide-react load from a CDN with SHA-pinned SRI (small output,
// supply-chain-safe, needs network at open time — acceptable tradeoff vs.
// embedding ~800KB of UMD bundles in every export). The pure string-transform
// below is delimited by comment markers and regex-extracted verbatim by
// tests/test_standalone_html.cjs so it can be unit-tested with the vendored
// Babel outside the browser — do not reshape it without checking that test.
// STANDALONE_HTML_PURE_START
// SRI = sha384 base64 of vela-neutralino/resources/vendor/{react,react-dom,
// lucide-react}.min.js (byte-identical to these npm-canonical jsdelivr URLs).
const VELA_STANDALONE_LIBS = [
  { src: "https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js", integrity: "sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z" },
  { src: "https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js", integrity: "sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1" },
  { src: "https://cdn.jsdelivr.net/npm/lucide-react@0.344.0/dist/umd/lucide-react.min.js", integrity: "sha384-EQEJvIFEf8npkbAdLZg6nG0ZK4cOAdEhtoe9EDUq7a0abTM5sG7ufDwzmJBsHVVf" },
];

// Escape a JSON string for safe inline embedding inside a <script> block — the
// same 5-char rule as assemble.py/serve.py/nl-boot.js's escape_for_script_context()
// (independently duplicated per-language by existing convention in this repo;
// kept in sync by review, not shared code).
function escapeForScriptContext(jsonStr) {
  return jsonStr
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

// Strip the ESM imports the app source needs when running under a bundler /
// text-babel host; the standalone output supplies React/lucide as UMD globals
// instead via a shim (mirrors render-offline.js's proven transform).
//
// The exported deck is meant to be SHARED (GitHub Pages / email), so it must open
// as a read-only PRESENTATION, not the editor. We flip VELA_PRESENTATION_MODE to
// true in the source (see flipPresentationMode below): that boots fullscreen present
// (init.fullscreen = VELA_PRESENTATION_MODE) with the editor chrome + test runners
// suppressed. The read-only-viewer blank-gate (part-app.jsx: `if
// (VELA_PRESENTATION_MODE && (!state.selectedId || !state.lanes.length)) return
// <blank/>`) needs a selected module, which a fresh STARTUP_PATCH load doesn't set —
// so the LOAD reducer (part-reducer.jsx) now auto-selects the first module when
// VELA_PRESENTATION_MODE is on. Together these make the export open on its first
// slide with zero edit chrome.
function stripEsmImportsForStandalone(jsx) {
  return jsx
    .replace(/^import\s+\{[^}]+\}\s+from\s+"react";\s*$/m, "")
    .replace(/^import\s+\{[^}]+\}\s+from\s+"lucide-react";\s*$/m, "")
    .replace(/^import\s+\*\s+as\s+\w+\s+from\s+"lucide-react";\s*$/m, "")
    .replace(/^export\s+default\s+function\s+/m, "function ");
}

// Replace the value bound to `const STARTUP_PATCH = ...;` with the current
// deck, whether the source holds the pristine `null` sentinel (Neutralino:
// freshly fetched vela.jsx) or an already-embedded deck object (artifact/
// serve.py: scraped from the live text/babel tag, patched at load time with
// whatever deck was open then — export always wants the deck open NOW). A
// plain regex can't safely find the end of an embedded JSON object (its
// string values may themselves contain `;`/`{`/`}`), so this walks the
// source respecting string/escape boundaries to find the top-level
// statement-terminating `;`.
function spliceStartupPatch(jsx, deckObj) {
  const marker = "const STARTUP_PATCH = ";
  const idx = jsx.indexOf(marker);
  if (idx === -1) throw new Error("STARTUP_PATCH marker not found in source");
  const valueStart = idx + marker.length;
  let i = valueStart, depth = 0, inStr = null;
  for (; i < jsx.length; i++) {
    const c = jsx[i];
    if (inStr) {
      if (c === "\\") { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "{" || c === "[" || c === "(") { depth++; continue; }
    if (c === "}" || c === "]" || c === ")") { depth--; continue; }
    if (c === ";" && depth === 0) break;
  }
  if (i >= jsx.length) throw new Error("STARTUP_PATCH statement terminator not found");
  const deckJson = escapeForScriptContext(JSON.stringify(deckObj));
  return jsx.slice(0, valueStart) + deckJson + jsx.slice(i);
}

// Flip the read-only-viewer flag so the exported HTML boots as a presentation
// (fullscreen, no editor chrome / test runners) rather than the editor. The source
// declares `const VELA_PRESENTATION_MODE = false;` exactly once (part-imports.jsx).
function flipPresentationMode(jsx) {
  const decl = "const VELA_PRESENTATION_MODE = false;";
  if (jsx.indexOf(decl) === -1) throw new Error("VELA_PRESENTATION_MODE declaration not found in source");
  return jsx.replace(decl, "const VELA_PRESENTATION_MODE = true;");
}

const MADE_WITH_VELA_FOOTER_HTML =
  "<div id=\"vela-standalone-footer\" style=\"position:fixed;right:10px;bottom:8px;z-index:99999;" +
  "font:600 11px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e2e8f0;" +
  "background:rgba(15,23,42,0.72);padding:4px 10px;border-radius:999px;" +
  "pointer-events:none;letter-spacing:.02em;user-select:none\">Made with Vela ⛵</div>";

function escapeHtmlText(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

// The pure, testable transform. `babel` is a Babel-standalone-shaped object
// (window.Babel in-browser, or the vendored babel.min.js required in a Node
// test) — passed in rather than read off a global so this can be unit-tested
// outside the browser. Returns the full standalone HTML document string.
function buildStandaloneHtml(jsxSource, deckObj, opts = {}) {
  const { footer = false, babel } = opts;
  if (!babel || typeof babel.transform !== "function") throw new Error("buildStandaloneHtml requires a Babel-standalone instance");
  let jsx = stripEsmImportsForStandalone(jsxSource);
  jsx = spliceStartupPatch(jsx, deckObj);
  jsx = flipPresentationMode(jsx);
  const shim =
    "const { useState, useReducer, useEffect, useLayoutEffect, useRef, useCallback, useMemo } = React;\n" +
    "const _LucideAll = window.lucideReact;\n" +
    "const { ChevronLeft, ChevronRight, Maximize2, Minimize2, Plus, X, Presentation, Download, Upload, Search, FileDown } = window.lucideReact;\n";
  const tail =
    "\ntry { window.App = App; window._createRoot(document.getElementById(\"root\")).render(React.createElement(App)); window.__velaBooted = true; }" +
    " catch (e) { window.__velaBootError = String(e && e.stack || e); }\n";
  const src = shim + jsx + tail;
  const { code } = babel.transform(src, { presets: [["react", { runtime: "classic" }]], comments: false });
  // Neutralize </script and <!-- in the COMPILED output before inlining — the
  // proven serve.py transform (a backslash inside a JS string/regex literal is
  // inert at runtime but hides the token from the HTML tokenizer). Several of
  // the app's own XSS-regression-test strings contain literal `</script` and
  // would otherwise truncate this very <script> block. NEVER inline
  // un-neutralized compiled output.
  const safeCode = code.replace(/<\/(?=script)/gi, "<\\/").replace(/<!--/g, "<\\!--");
  const title = escapeHtmlText((deckObj && deckObj.deckTitle) || "Vela Deck");
  const libTag = (l) => `<script src="${l.src}" integrity="${l.integrity}" crossorigin="anonymous"></script>`;
  const [reactLib, reactDomLib, lucideLib] = VELA_STANDALONE_LIBS;
  // `window.react = window.React` MUST run between the react.min.js and
  // lucide-react.min.js tags: lucide's UMD wrapper reads the browser-global
  // fallback `a.react` (lowercase) synchronously at its OWN top-level
  // evaluation time (classic <script src> executes in document order), not
  // lazily — putting the shim after all 3 tags (as a naive reading of the
  // CDN+SRI shape might suggest) leaves `window.react` undefined when
  // lucide-react.min.js runs, and it silently destructures `undefined`
  // (`TypeError: reading 'forwardRef'`). Same ordering render-offline.js /
  // serve.py / index.html already use for the non-standalone runtimes.
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>html,body{margin:0;height:100%;background:#0f172a}#root{height:100vh}</style>
${libTag(reactLib)}
<script>window.react=window.React;</script>
${libTag(reactDomLib)}
${libTag(lucideLib)}
<script>window.lucideReact=window.LucideReact;window._createRoot=window.ReactDOM.createRoot;</script>
</head><body><div id="root"></div>
<script>${safeCode}</script>
${footer ? MADE_WITH_VELA_FOOTER_HTML : ""}
</body></html>`;
}
// STANDALONE_HTML_PURE_END

// Per-runtime acquisition of the app's own JSX source. Neutralino serves its
// own pristine vela.jsx same-origin (STARTUP_PATCH still `null`); artifact/
// serve.py wrap the (already deck-patched) source in a `text/babel` script
// tag — assemble.py/serve.py state that both the local preview AND the
// Claude.ai artifact viewer use this wrapping (see assemble.py's own
// docstring), so scraping its textContent is the only same-origin route in
// those runtimes. spliceStartupPatch() above re-splices the CURRENT deck over
// whichever value is already there.
async function getStandaloneJsxSource() {
  if (typeof Neutralino !== "undefined") {
    const res = await fetch("vela.jsx");
    if (!res.ok) throw new Error(`fetch vela.jsx failed: ${res.status}`);
    return await res.text();
  }
  const tag = document.querySelector('script[type="text/babel"]');
  if (tag && tag.textContent && tag.textContent.includes("STARTUP_PATCH")) return tag.textContent;
  throw new Error("App source not found (no vela.jsx and no script[type=text/babel] tag)");
}

// Gate reason for the export menu entry — null means available. Checked at
// render time (cheap: two typeof checks + a DOM query) so the button can be
// visible-but-disabled with an explanatory title instead of silently no-oping.
function velaStandaloneExportGateReason() {
  if (typeof window === "undefined" || typeof window.Babel === "undefined") return "Babel not available in this runtime";
  if (typeof Neutralino !== "undefined") return null; // Neutralino: vela.jsx always fetchable same-origin
  if (typeof document !== "undefined" && document.querySelector('script[type="text/babel"]')) return null;
  return "App source not available in this runtime";
}

// ━━━ Standalone HTML Export Modal ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function StandaloneHtmlModal({ state, onClose }) {
  const [footer, setFooter] = useState(true);
  const [phase, setPhase] = useState("choose"); // choose | exporting | done | error
  const [errorMsg, setErrorMsg] = useState("");
  const gateReason = useMemo(() => velaStandaloneExportGateReason(), []);

  const doExport = useCallback(async () => {
    setPhase("exporting");
    setErrorMsg("");
    try {
      const jsxSource = await getStandaloneJsxSource();
      const save = extractSave(state);
      const deckTitle = state.deckTitle || "Untitled";
      const deck = { deckTitle, lanes: save.lanes || [] };
      if (save.branding) deck.branding = save.branding;
      if (save.guidelines) deck.guidelines = save.guidelines;
      const html = buildStandaloneHtml(jsxSource, deck, { footer, babel: window.Babel });
      const safeTitle = deckTitle.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-{2,}/g, "-").slice(0, 60) || "vela-deck";
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url;
      a.download = `${safeTitle}-standalone.html`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setPhase("done");
    } catch (err) {
      setErrorMsg((err && err.message) || String(err));
      setPhase("error");
    }
  }, [footer, state]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 10001, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 12, width: "min(440px, 94vw)", boxShadow: "0 20px 60px rgba(0,0,0,0.6)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14 }}>🌐</span>
            <span style={{ fontFamily: FONT.mono, fontSize: 11, fontWeight: 700, color: T.accent, letterSpacing: 1 }}>EXPORT STANDALONE HTML</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 16, padding: "0 4px", lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: "20px 16px" }}>
          {phase === "choose" && <>
            <div style={{ fontFamily: FONT.body, fontSize: 13, color: T.textMuted, marginBottom: 16, lineHeight: 1.5 }}>
              One self-contained .html file with this deck baked in — drop it on GitHub Pages, attach it to an email, or open it locally. React/lucide load from a SHA-pinned CDN, so it needs network the first time it's opened.
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, padding: "10px 12px", background: "rgba(255,255,255,0.03)", border: `1px solid ${T.border}`, borderRadius: 8 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontFamily: FONT.body, fontSize: 13, color: T.text }}>Made with Vela footer</span>
                <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim }}>Small badge · bottom-right corner</span>
              </div>
              <button onClick={() => setFooter((v) => !v)} style={{
                width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer",
                background: footer ? T.accent : "rgba(255,255,255,0.12)",
                position: "relative", transition: "background .2s", flexShrink: 0,
              }}>
                <div style={{
                  width: 16, height: 16, borderRadius: 8, background: "#fff",
                  position: "absolute", top: 3,
                  left: footer ? 21 : 3,
                  transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                }} />
              </button>
            </div>
            {gateReason && <div style={{ marginBottom: 16, padding: "8px 12px", background: `${T.red}15`, border: `1px solid ${T.red}40`, borderRadius: 8, fontFamily: FONT.mono, fontSize: 11, color: T.red }}>{gateReason}</div>}
            <button onClick={doExport} disabled={!!gateReason} title={gateReason || "Export standalone HTML"} style={{
              width: "100%", padding: "10px", fontFamily: FONT.mono, fontSize: 12, fontWeight: 700,
              background: gateReason ? T.border : T.accent, color: gateReason ? T.textDim : "#fff", border: "none", borderRadius: 6,
              cursor: gateReason ? "not-allowed" : "pointer", letterSpacing: 1, opacity: gateReason ? 0.6 : 1,
            }}>
              EXPORT HTML
            </button>
          </>}
          {phase === "exporting" && <div style={{ textAlign: "center", padding: "20px 0", fontFamily: FONT.mono, fontSize: 12, color: T.textMuted }}>Building…</div>}
          {phase === "done" && <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontFamily: FONT.mono, fontSize: 12, color: T.green, marginBottom: 12 }}>✅ Downloaded</div>
            <button onClick={onClose} style={{ padding: "8px 16px", fontFamily: FONT.mono, fontSize: 12, fontWeight: 700, background: T.accent, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>Close</button>
          </div>}
          {phase === "error" && <div style={{ textAlign: "center", padding: "10px 0" }}>
            <div style={{ fontFamily: FONT.mono, fontSize: 11, color: T.red, marginBottom: 12 }}>{errorMsg}</div>
            <button onClick={() => setPhase("choose")} style={{ padding: "8px 16px", fontFamily: FONT.mono, fontSize: 12, fontWeight: 700, background: T.border, color: T.text, border: "none", borderRadius: 6, cursor: "pointer" }}>Back</button>
          </div>}
        </div>
      </div>
    </div>
  );
}


