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
  if (slideBg) {
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

  // 6. Draw <img> elements on top at their exact DOM positions
  for (const pos of imagePositions) {
    if (pos.type !== "img") continue;
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

      // URI action
      startObj(uriObjId);
      write(`<< /Type /Action /S /URI /URI (${link.url}) >>\n`);
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
    const url = el.getAttribute("data-pdf-link");
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
function PdfExportModal({ slides, branding, deckTitle, onClose }) {
  const [ratio, setRatio] = useState("16:9");
  const [quality, setQuality] = useState("high");
  const [useVector, setUseVector] = useState(false);
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
        return (
          <div style={{ position: "fixed", left: -9999, top: -9999, width: rw, height: rh, overflow: "hidden", zIndex: -1 }}>
            <div ref={offscreenRef} className="no-anim vela-pdf-capture" style={{ width: rw, height: rh, overflow: "hidden", background: slideBg }}>
              <SlideContent slide={reflowed} index={renderIdx} total={slides.length} branding={branding} editable={false} />
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

function parseColor(str) {
  if (!str || str === "transparent" || str === "rgba(0, 0, 0, 0)") return null;
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
  if (!str || !str.includes("linear-gradient")) return null;
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
  const skipSelectors = "[data-zoom-badge], [data-no-pdf]";
  const elements = container.querySelectorAll("*");
  const scaleCache = new Map();
  for (const el of elements) {
    if (el.tagName === "SVG" || el.closest("svg")) continue;
    const style = window.getComputedStyle(el);
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
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    const r = a.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    links.push({ href, x: r.left - containerRect.left, y: r.top - containerRect.top, w: r.width, h: r.height });
  });
  container.querySelectorAll("[data-href]").forEach(el => {
    const href = el.getAttribute("data-href");
    if (!href) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    links.push({ href, x: r.left - containerRect.left, y: r.top - containerRect.top, w: r.width, h: r.height });
  });
  // Block-level links (heading, text, metric etc. with link property)
  container.querySelectorAll("[data-pdf-link]").forEach(el => {
    const href = el.getAttribute("data-pdf-link");
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


const COMPRESSED_FONTS = {
  "DMSans-Regular.ttf": "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",
  "Sora-SemiBold.ttf": "eNq0vQdgVEXXPj5zd7ObbBrpvZdNb5tOEtJDIIVeQg0hQCAFQkJvIk1QVOTFroiIWMDGCwgKvir2BgoWiqgoCoqFhJ7d/zPn3l02Mfr6fb/vz+WZmXvu3Clnzjlzzt27G8YZY32QqBkrKy4prX574Eic5DMmZZYNqh4a4RRxH2PhFYyl15QNHV4YMDZyFmN2v6FOVPXQxJTa9WXzGeNvopWJQ4cVDJu/cfr3OJ+I85i6ptqZb2zIc2HMyRv1+0+tnT1T9Ibr7shtpzbOn+K6N8OOsZrtjI0+Pa2+drLPPW/swPXbcT19Ggi2uWpnnOfgPHxaU9u8IwElbYy5on3Nz40tdbVbH9i3HuV5jKnmNdXOm8k/ZHtR3x/1g5trm+qj7xseirmEA74zW2a3XfZtQ10fzMeezWytnzlNc/tK1HdAfe1eblr5vPoOnDJuMjFn5IzvZ5OZlg0GBKdu/lMxSVBU7xlPMWYTaFpgHKm+1KOOuBttMVuiu1Pqz6S5U6e1UUVJrs9tpFFydaKxz8NrH5/gnNPJVKofBfm4eupcyrVex9DPUfUlNfjFNKIu/VNLtWjBBjevpZYGyjkfz1J4vvV4NjPWMgjXzeOsqq4qYa8xdl2S56F+k+rfQ4PzlL4SXMRMGXNgm5BzNdaKPcJ+UMqc+bIPlLLEnNgBpaxiSWy9UlZb1bFBuU0pa1CuUcpOLJ2FK+U+4Ja/UnbBmYNc5mIMTCnbEH0kq2cNbCqbhjaHotyEs0LWwhqxYkORt7JautbGZrLZLJsl4pjN6kBvAKUN5QSgAfUTqPZUXK9mpazCcnf8n9odgfNWuquFNYM3Kbg3iY6bpb6sCu1UsRKU/rqlITifytpRrkUNc73gP9UrQj6TzadRy3MVvSaxZJaF0jBQ6uku8/2DkLew6aDWUd0C9NGGWi007mAW9SeeTEXLokY7m4Q51KFmE3HKPPJ5VLKmTKHZt7FoklmJzUHuhOIF5go9mYi5FWNFU1gMC8VViX3LzqLGzzg0qK9mnA9W8uHIY1BDJ65IO0EZaTnbg7NhlrOXcDZauWsQqHnUsjh3ROqMmXH0Fo40Ei1yFsfykRbi4BhNf6QDMC4OjtUhrccMOJuFOXM2l92KdCVbBelajYOz29hapLezO5BuwMHZA+xBXH2EPYryZhwqtgWHij3OtoGynT2F8g62E+kL7CWke3Bwto8J/T/ADoJyiL2F9G32ESif4eDsc/YF0hM4OHFIIg5J7CK7DMo1dp2puMQh8VwNiVdxLXdB2Y37Ig3kgUhDeCjo0Rzz5XE8HmkKT0GayjORZvO+uJrD81Duz8uRTuSYO5/GG0CfzsEBvpzfivIKvgblu/kGlO/nm1Hewrci3cafRvosfw7pi3w32TJhc/LIInDmRVwTvNkMboj5v0SzFXPF+MW4xRhFj9S6WC3BqxfYi2ihH45xsBMPgIcv4r732DHw4QIzch0v58v47fw+vpU/z1/hP/FO3iUFSNFSmlQgVUqjpXpplrRYelJ6STogvSedUYWrklQ5qv6qYaoTqktqL3WYOkGdpS5WV6tr1PXqmeqF6lXqHeqX1cfU36o71CYbexsvmwyb4TYzcSyyWWOz0WazzQlNrCZDU6Sp1ozRTNXM1izVvKH5WHNFW6xt196ivUN7v/Zr7XntZVuVrbOtn22CbbntMNuJto22/7J92faQ7WHbk7Y/2XbacTtHOx+7CLtkuzK7Jrv5divt7rZ72O5Vu+N2Z+0u2pl09roYXbquUFelu1v3sG677iXdft07uqO60/ZV9jX2U+z32r9p/4n9GQdHh74Oux3+48gcnRz9HCscRzq2OC5w3Oj4guMhxyNOWic3pwinFKdip0FOY52mObU5LXLa4vSOs9a51LnKeaJzq/MS59udNznvc/66T16fu/p86xLi0tel1qXJZb7LEy47XF52OeRyyuWyq8Z1uOtW132un7jp3DzdQt0S3LLdSt2GuI132+P2mrvOvc59tvtS93Xu97q/537M/Sf3Gx6DPMZ6/MvjI4/THuc9tZ4pnvM83/ViXoVeC7x2ex306vRO8R7j3e69xPte7xe893m/6+PrE+mT4pPnM8DnAZ8tPs/5vOJz1KfTl/va+wb46n0H+I7wne67xHet77O+e3xf9/3Q9wvf73w7/ZifvZ+nX4hfld9ovzl+d/k95LfT72W/Q36f+H3ld83f3j/Gv96/yX++/0r/g/4f+H/pf9bfFOAVkB1QimNIwPiAaQGzAp4LeDngUMAPgYGBMYHpgYWBVYG7A78MNAbpgjyDQoNSgvoGDQyaFNQatDxoXdAHwSw4P7gieF3ws8HvBx8LSQ3pF9I/5MOQ0yEdoU6hVaHLQteGbgp9NPSp0H+HHgz9MfT3UGOYZ1hoWHxYZtiGsPPhJeGV4bPD7w//PPy78Avh1yJsIlwiAiLuiLg/4qWIVyI+i7gQmR7ZL3JJ5KHITyO/1qv10TjG6G/X369/Qn9I/4n+hP6s/mKUIaopak7UU1HfRV2MuhGtjo6NHhq9NPrf0Qeif42JiEmIGRIzPmZ6zJyY5THrYx6I2RbzYsyBmPdijsX8GusfGxWbGpsfWxE7Pfbu2Idjt8e+FHsqzi7OI84Q1y9uQNyIuFVxd8a9Evcb7fw6WPCPmFRcWjGMlTbWtjXDeucwqbK6IpiFDxsyMFj4aPCAtIp9V2Hn1oizbjQ10dTCVwBdY6ELqm1dXdNMNnFyc0sTq5nSWlvHBjU2TK1lA+CzNbJiSvOa25taWWYbMuwVTLEtHKNjin/CKefkgahgcRzFLoNze/KT1OjHRVWqCpd2SxP5dj4Chy07hWMvexr+yl60Gk47AlN8sAplnBJLRS+wrNivOMtR+utDfX/CfmIXeCLP5218Hl/H/8X3Us0Yqi3XdKaah9k59itP4gW8nc+HtdrEX6YR/2HVo8Y0V9D4Qiuau2VeVIN2MR37mP3IfuEJvB+fzefytXwj32OpJXE1Zr4KdnYLrOdOWMuDsLDXYV1DeV/Y1g3KrPyVWYk5f6GM1Y64x1Ffni2jXv++NUu/2Ev79FrTkbtb1e6DfeAB7AHbsQe8AEt+iF2D7ddyV1j/bFj/u2l8arYcHkYS+jZzPlUZo4b2cgl7NcNevRQ+i7mGmeM2NObeejH3IM+yCq24Y93lVmm/wXXa5eh6goULokUHpcUdtG+Z2xOtQRbF+Em65XXqT7mWZWIGUfA0/Jkn5o39mnvBH5ZQ96y4BzuYxL5h36O/b3DlDOWu7DvKtbTy31jxNxV76DNsN/sPe5MdYV9Bds+z33gEj+LJvJAP5VP4HL6AL+G38Dv4vfwFvo923afZv+G1vwGZ+ZKdJLkJ53qSnSG8nuRnMfZPIUPPW0sROKhm41kdbxH7Pcpj2STexFd3k0YbkletHIkQ19xpNUSuVosVGwXPyoYhooM+LuFhGGkGz4OHsYRfk/ykDOkt6SvphEqtslU5qFxVUap0r+OBKwMfCXw18GKwe7BvcGBwaHBkcFKwITg7uDi4LfjZkNBQ11CP0PrTiEOgoYxaDmabeSQ8mSzo1wC07G1pmak0Kh1ajlSloeVlaPmVwD+C3YK9g/2Dg6nllOCsbi1PRssioisydXSPz4yQL+PJrh+Mdxh3yZSux0T601rGvrlDpnxTLNLTO74JQfr26Z2nF59OPj3ra9dTiFNDFlts1TDeBxFTnJQi5UgDwLznzX1IO2Gf9iF/RUKkRXgHPssHyD+QPqEan3QflfSmDL6Ufc1HcQN7g1exdXwCr+CV7C4+hD3PNbyaL+R7sOIb+Vr2C/sRaz6bfcwT2HO8lftBLm7wEexuWnNn5oHVioAux0H+M+H150DDCiHRQ+END2ej2QT4wzPhDc+BL7yI3cc2svvZev4Yu8qWIRZ8BL7s25Dai5x0gntwLx4ErzMV6zIcPuV0+I/38yfgLT4DX/ElWN5/sXvZnTyWnWZP82Xs3/x59hCfxV5lu3gpvLsAvohP5sHsFT4MHt6dbAVkaCB8+id5CS9jJl7Mi/h6xAG2tMM4QufsIYGuLIj5QOsCoDOJiH5SWBgrg74PQLw2hFVyPWL06djXpiGamYe46Qq8+Fvg2W+AR38HW8O2Ysd7h73PPuBO3BYepj07Dm85h6dBesvhL78GCX6EP8Af4g/zHfw2+Lx2iAJsYLN0iAT6wPN3Y09AB7YhKn0cur8PergfUvoZ4th3WSD7EDbhC+YHLzaKdTI968COcRkR0iUWDx8+A757GndmSdyOpfM+zMAdWRZ3Y325J8vl3qwfvPo87sPy4dcXw58vhTdfwuNYCKKEQfDgB/J0Vs1zWTnPYiN4LRsFT34kn8Rq+Aw2jjezsbyJjeGN0OfVrJavYhP5StYCH74R3vxU/iBr5o+zGfxR1sS3sNl8O5vPd7IFbDHfxZbCr1/C/83GIx6og124Bpu4A956CCzjIXYA1lANC/kC2dFb+XLWjpiglT/J2vhT2GdOsIX8RfjtR3kNH4P4bC97mT0MvZ3J/VkXLOLPqolslHgWobJhrqpPmUT5PwD0p0YVxBJ7hQuuyXCRhrGa/wZVnZKb6yehnI92esAmkOlVIbgWwkIhqWOBkbzU9DNwGPge50ORHwfOoRyL/Iy0nIURvkC7AtGE4Uou4K3ap4xB8KFOLltQyxLVPui/9r9D2iDXh72o6YYtTN8rJjGvP2E52nBgFf8U0pfMQx3JvHtCepfZS3cy3Z+wliV0QwULtwZk+qadw7nqVavrHzJfS7mGZUjOzF3KYjHqKSgL2n7owHLmxOeyZdjREwE9MB5IMNthuvYiG4m5xgooXRVSfwrNDIxFXKc6Uh1oW6FnVuMjHUUAprQtP7L7gMVLT2C9t2Ju+3FPHoshiDLANzGvbnMcgrFvZcP5m6Yr0joWjXKx5Voj7vk73M3i4F8FC+C+NFUZKxR01R3QDztgDaumelVyH9L9yn1vMiec94HNKCcsxnqdwLo5AI4Adm/paQWLWTJfAXkHcE8J5MZb2sQi+UbmKyDmKXL2lWmB9Aza7okNqNd9vv0JU3DvFBbBx+H6OBZBY11D/pzM2+uwgSUsQIbpLPA5cNKKdh64qJS/4xXwriqge8ilBrQF8GTmag3qtwpohr1NZk6qI6hjPbatrMiyHjqs2RCWhvIIZWzVwmc2l6VtLIY/jL4B1Ekk2jvg0ZOYcw+ok0iGsoAka7qwkPCk/ATQxnTVJOanGiif82dZIP/Sqj3ItrSU2UGWMwGdqgl8k+UvS30RvFTGDbktJllLZEFAJNoo499irN+iL5HbILehPAZzLMMuXq0gGqjCvNIlN5aNtuZ3400ExtIL0H6MNBhzcWTOsJ2w7BjXTJKLErSVA/5ECuC8ELrpgb0+QVUAPm/F/i34OQ/3b2XliBFxZvpW7Ks9QXNvhawsBl8WE69yVM/LZesxqhbAfs8GfxZhjgDqVVK+FP39HdB7t/P+2GNuYe49IQ1E+ykYjzVuh1xtxfxQ5r+DD1aQOrBnv82iBMSYzc/jTQ9RPPunf3w/IGHXvIu9y8WzwEnYacWzvTquQXQlPLQuZmKT4WXZwrLZYf2iWD235w7wXN7DCrwP38UZ3sNP8Cai4V9cgTfmhkjMA+PxhHf3ASKOD+HnXIMn6M194FPEwxdMwF6cCK8rkAchOkmCvgfTU7kweEsp7Hn2CQ9HLDuVfYq4IxI+43PMAB8rDRFFFI+GtxKDKOY6F9Yyg8cjykjkSfA4M9ln0LGj8LeOwY8ywBtMg63JYtnwpzLhtWezvuDIed6X7ec58HFy2Q/wY4pZA+/HZrA7EF8XsEZ4FtN5IThbxJrhk9bC1oaxJlbC+sEnHc8msjx4RMWwAT/CixO+Yykvg5/G4NuU8wHsFPzGCviPlewLXsWr4Rs680F8MDzkdexVPhT+4XL2OrxMDj9wPXzVEWwvH8lHMS0fLfwVeMAz+VhYp1b4ROPh//rBx54I7+oZeFYvsRd5HZ8M61vPziEOm8qnwR99HNa0AR7vDN4Ij+s15s2bEU3NRPzmxWfB857N29gr8Emv8nZEbnPhgxbxeXw+/Lh/IYJ+mp6ODkREtxBy2weeaxtkHF43XwI/r50vRdR2C2RaxKtVsMjVfCVfBY8uCB75VsSQg9hXfA1807XsV76O345I8Q42GL7ynfwuxKz+fAO/B7Z6HrzmIdDuf7GF8OZf4Jv4vWwBPO37mTv82wf5Q/BNO6GzD8Ozf4wtRhSwBh62A/TVBTHlW9hfH4HXPwz+7Bb4v4fYLkSbuxEDvAlPeDh/lG+GHVnLt8CjPMm38ifgj25DvHuDP8m3w+Ktgi/sy58WsQDzgSe9Exruijj0BezKKraSv8R3wdscyXcjetnLX2YXmCffx/fzV9gl/ir7kh/gB+Fve/DX+H/46/wNRJtL+JuIQ26Bp3qIvwUr8zZ/h7+LqKWGv8ff5x/wD9kYRLI/84/gk2/iH/NP4BEfZmf5EebGP+Wf8aNS0RBNwaTW+jn12oKm2rrWlmZtQcvUlub6GbqC1obmqbV17W319kV1Da117U1TGuvn6Yomt7TV1tXVN7dpiutqcQOy1pbaNk0JNaMpIaKuxFJNWyI3rCppnqotkRvXtjc3JJcUFtmX3WxZ0JKSU1J0ZTdvpWpZJer+k2pbNeXyOMuVcZbLTWnK2xoaJ9fbD+jZkiFdU0HD11TQkBRqobpqeEWFpkq+VGV1KTVNU01dOFZPa8fUW9ubGmvb27TVcoeaIfItQ6xuSUvXDJVZNLRH9ynJmephYtTDrKqnpyjXCjTD5Z6Gd+tpuDK14fLUbIaLJdAMpwlqRsodjbzZkd3IyQ31rfWzG2ZrRk5trZ1Tbz/65kXNaCJpaug2Xc3NZaulru2IXtfSNMnJUkqoq51dr61VRlF7c62SDEnpDkouV5JPiuyVPKG2sc3BXBYV7OusZKau24omGVIyHJSc6tqJKwniYafSbIrSVIpVXynKAFKsB5Cc4ljX3tpa31w3n+7XTL7JbUNSptJMpjyiyQ1zGibXW/pJSUlOs5/c0thY22rdtzK0JHlomnpZqutlqa63TERX3zB1WluCeIqrFMUjW6VIzdUrYl8Psa9XdKp+Vntto6U3aECxuqS9tcVOJERWTZkwxQaY0EDpdEobQZ1uN6VhTj31J5dEd3JJ3Gc3paW9VbkqSvJVUbJMNykj1X7qn9TNoJtqmZMdSQyJhKVEXFBPgyQr/ClU+FMo86dBFqaGBPHcetiQgdoGRXoaFPVskNVzek/9MGQoCpmhaZQVq9FaTYuU7lKV7lJvrnpSYZquqaG5fba85KLYVu/Y1N7Y1jCzUZGDZmpSrl6QpGm2VvN0u+aGZoWVVCJmUYnubZHtjCxtigylyDLk2NJNX1vkudq2KM1RQbRGBYtQJRVm2c1sNI+3VZ5tq7UZIV4kZxQTc0VuLZEFCgsKZI7Plu3A7D8ZnCzNbCxZ82TdbAy/WRZNuUiiKRdFu7azG+bJ4xUFGq8o3BxvQbF6dktrrZ1IiOw4u62+tRHGyGpchnQlT1O3CUPXZm3oDMqYCnVt01rrZe4oRRqMXLTikMGO5ISEz1KiCdu2zW2RRysKNFpRsLo3RdMuW9P2bqvTrkhiu2JN28matsvWdK7MxblW1nSuxZrOla3p/JsXbecrvNPMl83qAtmsLripPAvqW+VxyiUSKirRpzjyZ0tR8FPkz5aclM+WzJ8RqcyfEc2ob21moU21rTOYf9OMphnMnZ43S0oNc7St7rMJ3sJ4egNA/nRGPJv25t702boD82Lb4aM8xDbBo15re9p+AVvBlsD/aYVnOQXeYw28GMSDiP5zWDo8X85eU72K9HmVF9KlqteRLlQli9aIvlnlj/S86jWkh4k+hMoVVB6sOoi0ksoHqbybytXU2udU8xWi7KXycyrR45tUfgh0L8aclwELgDagGZgGTAIGAQOATACxgzOiHudIIBjwBcAfZyfAFkCU4XQDOAecAY4AH/wvPo0381TwOp/elkgAT9XKJxuC14OM4j2FKkpHUDoPKVbTaSOwHlgEzOn2ub7lExOn+xyGMbXjRLT5nUMhYw45QLqSJ/XIY5Q8XMkDldx8n7eSu/a47uAgPllCF3Juf005d7DvsD63v6DkP9p/i/SE/TElN59/Yv+e/ZsoHVDyvX+Rv9gjf1bJtym5uR1zu2b6ZvsHqP+NPfLN9uspX6OcL7cHR+3nWPKZ9tPtJ6M0XslHKfkQJa/okZcqeb6Sz+xxnm2fSv0kKHmUfaiS+1Puad8Hqc5ereTmc0+d0fpcd0X3h6iv+1nJf1DyK7rTlH+lnH+m+0j3ju513Stybn+ge67brZzvVc6fV/Knlfyz3s/ts3Vbqf1H5Nw+QcmzdfcRfYPudspXKfkyJd+gW9DjvI3yZh00UTfJko+1nI9Q8kGUD9AV6/JQylTylB55nJJHKnmwkvsqufl+9x50J50tjUOSc7sbSn5JyX9T8nN2Z2R+y7ndKSX/QsmPKPkHdm8hfc1un5LvUvKdSr4d6RbgISXfpOR3KflaJV+h5EuUfHuP6/OUvNWukfqdouQTlbzVrobyYcp5lZL3p3EU/inPsUu3g02wi1HycCUPVHJvJXftkTsouUbJme016kdpz7bDQr8g6LY/Kvm3Sn5CyY8p+Sfiftv3zDnwJtEP2L7peAn5XiV/Ucmf7ZFvU/LNSv6AnFva2ajQ19uuofPlSv6JvH62n8hyabvIdg7SmbbTlXyRJZ9sfW6er+14JR+lzJ/ZDlHmJ9MrbEtt822zbVOVPEHJo5Q8VMn95dxuinLuqeTm+/souc6W9natUcmvyLmtTkv6r/1Z+wPlp5X8KyX/WfsZ5R9Zzt+h/HXtK0h395I/r+RPUw5t1z4C3KfkG+TcbqJyfruSr1LyZUq+QMm39qjXpuTN2mk0jklKPlbJRyj5aSUfJD/R0w5QcuWZvjZPyTOVPEWLnVwbafutnGuDldxXzrFTXiaP4Q9Kr3N7pEbaQS9LQeLdQUHnvpT6UzpLpoir/D9Ufl2kkjeVhXSBTlezhF+C1F+8f0Ltn6Q6WZRmC++E30X3xordnmdRj9don/+N0rd5KNIOGs9j0l7U8RN03odacKGyHZXrKfWg3p2onQephe+JXkC9/4vaOUdjG0ZjG0b+1hWqM4zS4UoqxvaMTBc84e8we3obVLQ/jFqopt7LqM7j1P4W6vGK7G/x0yKlHm+RvkJ6L41qM9W5j+rfQ37bPTSGDJlCde6h8kYlFT7cOSo/J79HIy0TcxFtcvILkYq5VFG5ikYeTmPLIXo5jbmCxpxDfZ2mmjmU5lGaoZTFvdQ7v8bEG5yFdG8O3XtJ9Cvpqd9+VCef0r7UVzaVN1Haj+7qR3cF0RiCqN836GoQpcFKKnqcQzKgIhkIorv6C+8WKTjJD1JaxOHd84HUcn/i5xGil1PNcipX09VyGuEjgiK5i6tIRXkdpb6ijuROdVYL/xspPG/+FbXQh9LV1OZqKhvpLlfEEKBQ+6vp3jSadQqlyVQzmUaYTHWSqc5wujqE0oFU53VKB1OdgVRnMV39mOjzif6CGI+kJsoLNP4oucynomwgLr0g16QWKKLgO6id12i0GVT/KarzGtXJoqveJJmP0TjTFJ0SV2+nq2uofitRRlELxUQZRdx+nOKTeGrhcYo9HqfyVqrpS+XvyGd/nFp+nNq5WxovUmrnbqI8RLzdRT0+RPc+T1cfoqvZ1MsbRM+mmtkKH8S8/Gjufal+NtVfSP1+TDNaRfSFRH+U7iV9RFnc60ntPEZ1HqU64jsMnFMMhlTw0JbqLKV7l1L5Et37JfW7FHdJLI6iRGb11rc9vfUdQG99B9Nb3xH01nc2vfXdl976zqe3vsvpre/R9Nb3ZHrru4He955D73vPpfe959P73gvpTe9F9Hb3EnqXezm9y30rvb+9kt7fvoPe315P72/fRe9s301va2+i97Tvo/e0H6f3tJ+hN7SfpTe0d9Ib2s/TG9ov0LvZu+nd7Jfp3ez99Fb2QXof+xC9if0evYl9hN7EPkpvYn9Fb2KfYkFgJSJF8fkYR6TIESmiR/HNGlhgwU36rImxG+CT+F7KbygjYmTCvzgFiPcDETmyDwD4XuJbIJgjY+I9qJ3g8XYAnh3ZUPHdj7sAeH2IsBl4gkia5PJ5spibaN/axKeJqJroC4n+I0nkWUr3EX0z0e+l8noqv0Pl7VQeTOVKKh+k8m4qD6K0giS7P6VH6OorRB9OlEWUfk502v/YXirvoHIllUuoHNQtThZxq4iVRezae7yczftSzLyc30pxsyTepXNZi1lJDuNFvOuc4zidxbOwm5/0mc5YlbtM8HFM500XTT+YTpp+Md0wXcT5DeXqT8B1XP2e/T/8E++1mVu00EQvVy1n1ym9xrSmS1Z1frOULovapss37+i1n+tKftb6vu79m86YOkxXrO4x9jZayr/pTjH9SiOUKUfBkx96zOYKtX6F2RNHL2K018C7yyaj6XXTKdNBqtcJylWaDcZjOmB6R9BNXb3M5YduZ5fMIzX9aOrsUfOaPFPrWf0Ffzr/5+tmKV+lp2dUsvD5uLlNUGwov0LvYv9dm1f/Qb9fAb/8bQ3zav78N3VOgSe/WZ2b/iwpytnvoiXTb6bvTZdwGLv1AMk3IVowXfjn4+9lLBfY/8E/Idd/tcrKuBzoHXTqj6TvGlbrKr0V310K7KHn1qv7jZA4SOdlkjS0ZTonuCKCBMs7pOKfn3gj6eYYZP0y8/AvRva9NdehDdesLZHpSrdz41/q9K9/7tNCOY15dvRyT1fP2mTPfoQFOIu5/sZs/yQF13H83F23TH+gbVu68yeShCsIXJnpJeju4z14IOYHmunRHuN7FSM8b/oMdsBoOgHbcQOz/gW27kNw1xH5i1ilN2GVtaYPYI8/A++vkEa/K76vYPpWWZ+zGLewKqdke2NedYzbUXzbwHQMrZzDymuJegUtCc7aoV0JrSh2FaP+GSt92vSa0F/Tr6IW5sZNb2Es4jsUz6GX46avcd8xXDmD2QuLdc30HsZiR9rwrWJRT5JF/FG2AxZL8CLue+4fyrOQtUu0StfMEoyeQME+dNn0XS97wPfgwB89WhEz/bm7XtI6XYc0SRYJuWK1oj9bcbDL2qqYTMosOq12jzfB1eOy7Jh7lC2hvOZmS01W/1ey/Ne72xdF0i+Aq+ad7k9abJ4VydAN6/2ZudC3TNnNndH0plULZt12YZ5WtkDTY2bGmzzv1voFy/eFu/Ha/NrVzR3v/5d/TZaS9n9kB7/rbS8Qu3JPSyvrsul3651PzNJ0BJJ/FVLWBb0UsvyN8Hsg+X+YzkN/rkMDrnarfcp08h+P7hxa/eMf1u2yWhkj1lAnZIR5dJvRVbLrKmWfv4GYIlj5FoKQCY15zor+XCE9EfajwyzjRD/fjVNnrP0bS192sHAX4JVcAz+Mlh3nhLDRZFNOW9X+4M/rQb1+DlvzE7R3L8pfwi7ZgrO/UY/20Boby84uvAQtrIqVHt/cn0wfKeVdZGG0NMs/FI/jBpNM65EfZPK3rruNpadkEDpu6gJmco4kosP0HXThN4zuUjef4Rx5AT92G5f8CeH7xGNH5sacxQrjTiNZ6buwo5jbUNEob9AO+45iwWTv8Tyk6jvsOl3g5hXhZysW4xJ9V19FK/eDxQoIjn2Hdn9R7MX1/1M/4qLVuC6Z5QI8uWztf5IluiJbUBrp7z1sg4h2hSSKCDcIEW4sSpmIZqMQBdWxZIpnKxHP3spGIY5dy2ZQDNuCCPYeUDfhmM3uw9FG8Ww7xbNz2XPseUS4IqpdTFHtEopql7FPEROuoXh2PfsGUdud9H3kTcyI4176UPY+inDv5xpEmg/yIB6ESFbEti9QbPsSxbb/Ft/ZQVQrYttXENsOQDxbwSvY67yaV7M3uPjmwpsU537CW3krO0bvwn2OmHcF+5Kv4rchwhWR7ylEvs+xHyja7QAfKinyt8E6qhDti/jfBvG/+G6SiPxV4E0s5D+TZTFvcGcIKMNwqBDvjwd9AvjlRPzSUPzvjKh/DgsENxayPogdlzJXcOBW6IHgo5b4qKVnAVp2Lw4Hdj8OB+Ub4PK3vp/D4QNePg+rYv19b/k73p/icFG+6X2UHYNMf45DAo/Ft76P07e+v6HYWHBZp3zr24TDneMfUg3XMDd6miBxV8T1XtwLfPegZwpBxH2JuC8R9yXivkTc592+9T0AaxDMK3klc6A1cOHDxffusRKjmC8fzUeDUsNrmB8fw8cwfz6Wj0V5HB+H8ng+Hlcn8AmoKZ5QSLRyjrRyPli5hSyEL8L6udEzCztaOTU9s1DzJ/jTzJY/w59hofTkwhZr+SLSl7CinuDERKsVlZQVdcIRRevqhHUMBj2UfkNAfI9TopV2tVrpYCbeMg1hOdAJN1aOQ2JDcUSz4dAIb6u1d7daew9a+xhae09aex9aezt6GmQHHViDEYlnQnYkB3YkB3bQqXswSqFVzqRVziQNfUga+pA0hJI0eJE0OEAa9kFr9+NwIJlQkUx4kUyoSCZ8SSZ0JBMq0jwVZOJbFsa+w8HZGRyO7HscDuwHHI6Ql7OgC4lxIL30I730I73UkcT4Kr8TICTGkXtwTxYOufHG2vtwH8iNL2TIgaRHR9KjI+nRkfTo6LmUmmdBhuRfDlCTBqtJg51JerxIbiJIbrxIbiJJbvQkN5EkN3qSGy+SmwiSG3+SGxeSm1CSm1iSG1/S+wDo/Rqkt0H71SRDWpIhrZUMxf1JhsQvINygneOq2wm3I8Cfj9fcdlsd2+k40ssBap9TfT6wHAf67MWxDcd95oPu3N7z6LMWmKccB6yOKebD2cFZ09vh4OAgmQ/73+y/tRwnlOOY5XjHqrzPfheObVbHZvsH7JehTvfjAWAOjkbkQ4A+ums4OnQXdD9ajm26zbrNqNFoP0e3XreeSnTo1uiWI99nOd6Rc90i3RyFssv+AbtddhvsGm2+svnM/gGb92zeFEDpM5vdyrH95mG/2WaLzUP2c2zWy4f9Pps1NsttFnU/VFVKnm91JFiVg5XDF5qeaNkdY6FnYl+MhuW/laWQDW8m3W2lvbCNtHYOae1c0tp5pLULaC9cwl7HsYx09BbaBW8j+3wnOw1dvJv9gmMj+4NdYf8inXuIdO5h0rlHSOc2k549Rlr1OGnVVmhVAtvGk3gSe4p062myzM9Aq/phvyzgBdgphW7tJt16Gbo1iO2DZa7Dril05X3xNjk7zNt5O/uUdOUz0pWjtEce47fz27FTbuQb2XFozHPsBO2UF/nL/GWMlLM/4E2o2EZTJx9kus5HwAtR4+xXnP2As5/4Y+JblTjrxNl1/pjpY7YOXtcbrA/gArgCboA7EAnogSggGogBYuEp9UdeDgwABgIVQCVQBVQDg4DBwBBgGDAa99QAY4CxwDhgPDDBtJ9NBGqBSUAdUA9veQowFZgGNADTgRlAI9AENAMtwEx4qrMQs7UCs4E2oB2Yg917rukZNg+YDywAFgL3iJ0cvvajwOPAVuAJYBuwB9gH7AfeBt4B3gXeA94HPgA+BD4CPgO+AI4DJ4CLQAfQCVwCLptOcwnWVgW4slLuBrgDHjj3BFJxPQ1IBzKATCALyAFygTygP1AODAemm37mM4BGoAloBlqAFaZX+EpgFbAaWAPchvbvN53kDwAPAg8BDwOPAI8Cm4EtwOPAVuAJ0/d8G/AksB14CngaeIbZ82exk+xAeSfwHPCi6XvY3hGQMA7NcSFp6yRp+kGWJvou+R+mw+K66VWSwwu4chZy9jvV6+Aj0O5jpkOoMROSKImUjzR9K34ByHQC+54En1lEZGrkNoAG0AKIdhBF3UAcd0M8Y2MOgCPghGjL2bQH8rsH8rsH8rsH8rsH8ruHeeCaJ+CFyMQbuQ/gC/gB/kAAEAgEAcFACBAKhKF+OPIIIBLt6IEoIBqIAWJNX7E4XIsHMhHJZQHZKPcFcoBcIA/oB+SjrQLkhUAxUAKUAmVAf7RVDgwABgIVQCVQBVQDg4DBwBBgKOoPQz4c+QhgJDAKGI2x1ABjgLHAOGA8MMH0JHTrSejWk9CtJ6FbT7LJqF8P/ZgCTAWmAQ3AdGAG0Ag0Ac1ACzDTtAP6tQP6tQP6tQP6tQP6tYPNQYQz1wRrCswHFgALgUWmn9hiYAmwFHgEeBR4HNgKPAFsA/YA+4D9wNvAO8C7wHvA+8AHwIfAR8BnwOeIn75Afhw4AXyD/r8FvgPOAN8DPwBngZ+Bi6jTAXQCl4DLsHta02VuC9gBOsAecAAcASfAGegDuACuzBU6KzwpV+6Fc2/AB/AFgoBoIAaIA+KBFCAVfaQB6UAGkAlkATlALpAH9AfKgeHARNxTC0wC6oC/1vFz0PFz0PFz0PFz0PFz0O8L0O8L0O8L0O8L0O8L0O8L0O8L0O8L0O8L0O8L0O8L0O/z0O/z0O/z0O/z0O/z0O/z/BmTkT+LfAewE3gOeBF4CXq8C/g3sBuRqh17Hpb6U+CoycSOmUxcA1SjZVh1DivOF4FuC02/Br45gW9O4JsTtP4yHwOMAx6Dr5sEzb4Mrb4Mrb4Mrb4Mrb4Mrb4Mrb4Mrb4Mrb4Mrb4Mrb4M6X0X0vsupPddSO+7kN53IY3fQhrPQxrPQxrPQxrPQxrPQxp/gTQehzQehzQehzQehzQehzT+Bmn8DdL4G6TxN6xkF1ayCyvZhZXsAmc6wZlOcKYTnOkEZzrBmU5wpgOc6QRnOsGZTnCmE5zppF940ZDlsyErd4Ws3BXaX3+GbftR2V/F27UzTX8gvxd27H7wpRIYYfoFdu8ier2CXq+g1yvo9Qp6vYJer6DHK+jxCnq8gh6voMcr4pNzUxdauyBbVMQ6NvBInNhp8JT6g2f9GPS0D/h1Avw6AX6dAL9OgF8nMIafwa8z4NcZ8OsM+HUG/DoDXp0Fr86CV2fBq7Pg1VnM63lY6E9Nv2Nlf8fK/o6V/R1t/woLvRG8G2H6Udhq7EUjTYILP0IyfjF9Dp/GCd5KFJ8LD2MjNE/M/F1KO8j6izsvkvUX9l5l2REugHbaUkP0dJl2lt/Er7zRlZmISgaZjuPKM+DwTNo9fkGNX8FhLeLRQZBVMfcDkKvD2DEOQ7YOQ7YOQ7YOQ7YOQ7YOQ7YOQ7YOQ7YOQ7YOQ7YOY7foxG7Rid2iE7tFJ3aLTuwWnbD0nbD0nbD0nbD0nbD0nbD0l2Dhf4GF/wXWuhPWuhPWuhPWuhPWuhPWuhPWuhPWuhPWuhPWuhPWuhOWuhOW+RIs8yVY5kuwzJdgmS/BMl9CXKpBDKxhtcAkoA6YgxnPhZbMA+YDC4CFwDLw/RZgOXArsBpYA9wGrAVuB+4ANgD3oo37xa/VmY7B6h6D1T0Gq3sMVvcYrO4x9hzW5Hmszh6U9wH7gbeBd4B3gfeA94EPgA+Bj4BPUf8z5EexJseAz7FCX+D8OHACuAh0AJ3AJeAyYDL9wTmggbRosb62gB2gA+wBB8ARcAKcgT6Ai9BPxH3egA/gCwSBFg3EAHFAPJACpJqOwdIeg6U9Bkt7DJb2GCztMVjaY7C0x2Bpj8HSHoOlPcYHQNIqITvVpnchMd/C8h4jT2U0zsegj3HAeJQnot1aYBJQB0xH3RlAI9AENAMtQCtswyLMawWz4SuBVcBqYA1wP+b8APAg8BDwMPAI8CiwGXjMdBCW+Q9Y5j9gmf+AJbgOS3AdluA6LMF1WILrsATXYX9+hTW4DmtwHdbgOqzBdViD67DMv8Iy/wrL/Css869kHY6yEZD/k5D9k5D9k5D9k5D9k5D9k5D9k5D9k5D9k5D9k5D9k7ATp2AnTsFOnIKdOAU7cQq6eh524gfYiR9gJ36AnfgBduIH2NUvYCtOwVacgq04BVtxCrbiFOzqGdjVM7CrZ2BXzyCu0iCy0iCy0rCtwBPANrIoR9ke5PuA/cDbwDvAu8B7wPvAB8CHwEfAp6j/GfKjkPtj9HREg3hMg4hMwy4CHUAnIJ7MYwdB/KXjqcjTgHQgA8gEsoAcIBfIA/oD5UC16SgfjnwE9q/RKI8HFqGNFaCtBFYBq4E1wGOQe2F1NJCad2FnVaDsFxRYs0FkwYS360VW6TKua3F9rrBapn2yv0vffplJUdhJUE7L+wJqvUW1RAtXcHaBanUgBtTQjvkY9rgXsaJHYNGOYFWPYFWPYFWPYFWPYFWPYFWPYFWPYFWPYFWPYFWPiKfmsGhdsGhdsGhdsGhdsGhdsGhdsGhdsGhdsGhdsGhd9BlzJuxxFtAf5+XAAGAgUAFUAlVANTAIGAwMAYYBo3FvDTAGGAuMA8YDE+AlTARqgUlAHTCTnrppEIlr2GygDWgH5mIPmwfMBxYAC4Fl2KluAZYDtwKrgTXAbcBa4HbgDmADID+TFXFcB6xcB6xcB6xcB6xcB6ycsHB7YeE6YOE6YOE6YOE6YOE6YOE6YOE6YOE6YOE6YOE6YOE6IHV7YeE6YOGuwcJdg4W7CgvXAQvXAQsnfMkOWLgOWLgOWLgOWLgOWLhOWLhOWLhrsHBXYeGuwsJdhYW7Cgt3FRbuKizcVVi4q7BwV2HhrsLCXYWF08DCaWDhxJN0DQ9kali5q7ByV2HlrsLKXYWVuwordxVWrgNWrgNWrgNWrgNWrgNWrgNWrgNWrgNWrgNWrgNWrkN+wmvaC1m7CgsnYiwbPoqs3F5I+V4+AeWJuFYLTALqgOkY+wygEWgCmoEWYCF240XI74d8PgA8CDwEPAw8AjwKbCbZ3QtrdgXW7Aqs2RVYrU5YqMuwUJdhoS7DQl0mSe9U5PoL8h+uoXSOZP53jPaGogVnaD/HuMF7cc9hWavo0281opxPVHYqJ+bHglgY0zMWkWZISU9LjQwL1XiEpaanG1I8PT083DUabYZWm2bwsHEJcYkIcQnhbRlRUVGh4dFjoyrTDQOioiszQ/iYicbbpBe61kuGrg877koIDYtLDEsYGBdVGmcbV6yXwqbfVVOzUZV34/Uc6S3xWYwrkovSV5BoR8YMbgYepvIKy1BlZIR4uV79kbMNXxoWpx4JjudRcdJXXZHSfE/PrtWvz5un/E6z6kHcC0sFe+DKPJkv2uAGD2rA4KF1MbiEpYV4cAUSD/nwfsO19IQbHms9+EDjv3mK8SNeJH01F20enT//qOhh3jyeAcTOmwe/m0anek2KpE+TtGyVeDewF/qDsL690XeyHVb0vRb6QfFeYC/1r8Oi36RvNNN5KDsk003ELQu9L//dqv5NegNnN+nq7QpdL9OVefxouW+X5b4N7CB9pl5jui4tlL5m7sybxTHmZZaIsDSLMISFgLuqbhdk+uE9KampKXt2lM8uyJo11HhinftDhqQkw0N3LrqloHWATWtGUlLayLAhJU4FY5KlM13+fPjI9Pj49NZptU7Fg8PEOzuJpl9UXPqVRTBmE5ogpaWl5kmiX6+wBCks1EnycA/EeXqGwUnij9etHx0TW7NuQt09o+zutM0YlpY+LDMgIHt45pBZDnfqRmxyK525ItezeEVjQdktI1JKwiKKx2amjy2JHFxetbxK8Ih6ozVwVngzhPVG34LdlejGTjE6C/0pXtFr/Z3YeW/S91rob/Eq+hSyxnRD+hk89mWBMofzpLRUTFCwMlACL50k4vFn92aNzgsJyRudde/6uo2TkpMnbawzXlmvXhGWPzItY2Re8Irs+ltKPAuXTcuTvusKQI/UMo3EQxn5VhqJi9yjpKF3KtWsBsPwh/6o6LfgMDpDD4WpWedOapJs/FioibVyiPbofurHW+Yc+4X1Rn+QLe+VvgU7WW/0nWyaFX2vhX4Qu1lv9LfYT722cx274036RjMd2rSM3g2rMXmq7DB/H8gZCXKaVxgPy3AJc4EREcZDiDPfMys+KfgO42eh7it+4okR7quSpw07tzApzeArDXftWgu2bHOVGrsiK6alE++ZFE8a6q1oqKEb7+U10fDlWTaWke2y1N7AFsj6B7rGsjK0Lqq0CHlN1rvzcOMJniLWgyfN4/N4MpZDIjmLgNboxa8m/a3eCCOu0ajEIu8cf2dtctK420ZP3Fhje6c2c7jBMDQ7KDRvVEZ5s4/PrYlblvH1bv1mrC73LFkxvV/Z0mGJReHhhWMzcycWheUmz35lS1k1958+3SznEcT9SGXVz7De6Dvhncp6dFSM10J/kU+2qr/XQn+Lvh8hwdO6oL4k/cKShdTYhEZGphncPT0xH2GA9HrM17xXhaVGis1L4+Hu6eUFVcIyhvwP6/OqcStK1wWVZBqKQvuV5BZNzcpvrxoyt2BdQGZMVLpvUlpuVVt+6XIpfvzyknWBRVkphSH5xf1QraC9WqkWne6XlNavsq2g5BbXnMYyv4ywwJTA8GSNjSZ1TEHp5IzMaf0DkoP9E/1DU9QabdrY/JKGbEu9iCRRb2x+z3qa9DEFqGeWkbdvyogwFbJJxkaXtb7rnvW+fCVtmUJOEhcvFhofSn9gwUrj3VBbZXVnqHTqbfO9IVOmdH3dvQXOxor33akFksqx68VFrNpIXGykVU6gd2RWjcRaireYeI0V9cGfBfUwqAusqDsPC6r4+xaTaN1l6sHvhTQMRbnDivrWUFFXeC7nrFq4flxQz6GFcaTnROWh50QLsSbGOkkjZWrf66LuGRrvLgt1wxkhY2GmX6RUzM5NfKucZAyq4i6EJk02B2QZ46rnFd5RnJFZtL5wjonxvW5580YGx2UXFWXzW423jZyXJ81cvBg9U2s0ykxF8lfJlh/JafQirxsP4wau52IFJIOxcyrPfdz4rZrXdi0Qv6200ril1JgnmEyWzHhU3IkWsxWdybG06Kysq8WKC0vRV9yJlcO9w0UdGk2OvELDzbbRWZWpULXsMe5qMio9OVNPMv1FYWMhQd5WPSkSlOFhA6iUXp88adw4K1F0zYNmL5v90eyC2cYLyiiEzYUETsT98m7jhgPm1ksVpspwqXl9j+vuQ3e4Hrr7LTfpK2MF3wXRa5GMUfwLqetu5V5hrx3pXtlEk8Gu+YkbQtxXnTN+GOqOrh5ylebg1smwzvIM4d+KeRcq+3ubeVfoRt8ivschz1z0YqG/yMdZ1d9lpvMNXP67IsJepcDueoi/22Bld5U9XG/e1xUDzF+ou3tCYlLtXbUT76pNSpxw96TM0f1CQvrVZGTWUO5WOuvWXM+ilY0FBY0rizxzb51VuiKqbIwhY2xxZGTx2AzDmLIo8TvLiabzqm/Qrzu9v5EgfhsNvavMVt8LvNFo9MLcu3iZ7VugZGO1vfNdg5eMywlImnjPpKgS35YWn+KY0FIfT0+fkrCBzX1D8mu4300v2SOhetK0ZDhSTQX2uq5IO4dbnR2DJMnfybFodrlhXFlUczfPmbhC3O2vcP2mdbemP8iu9krfyb62ou+10A+yP3qtf13xAXrQuY349o6FvtFCD2WXaadNNL0BuiNKPiwefhh0MeO/ruEoKaet683v/8tC5qoG3Ngd809W0zK+XZbxbWC/WzR7LrxEim0y0pTtq7snLvTgs/WxfYOC+sauXz72luLiW8beWH96YWiOXp8TsjCnpaJPRUvuaenrrhCacTTJqwN2g/RuVs7gof+vU5dy+41LXREW2Hrxv8z+86DBA6bNCgqZ9eY/kmd5PzuAmQrLEihbsRCVwS2i9znXrOdJpx89a2T79FnBwVn6fc+MuqW0bNkoMUmeZ3y9Y3ZwdkRkdvD81OmD+gyelmq2dQdINoYrMunAeqNvMfursIEHyGcbrliCePIb9bDrC8DBpN78EJz/nV8xtHZl6brgsuzU0tDCkvyGxYVzBw2dV7guICsuJtM/JT2/ak5B/5VueU0lARmhgclB+kSNjd2scaX1GdkNZYGGIP8k/1CDcAPGCjcAY6Sx0NhHKz64kcbek76FyVZPb+wUY7fQn2I3eq2/k81X6h/tVv9FbkNyif1RGmi94wiDcm698VHsn7O67pTGwdyrutWyl70NrtQdwXcbT1F9njhlivGw+S70SXfRWCbQTrVljBiJF0Y+kOzyBGXkJ5hMP9qN/iL73qI5U9H3f9WcleC8f2bMykWjFxcULB59af2CRUGZkfrMoIV9m8qdy5tyFtD2K/7OwS+S+H6eh7LuwiVQVl7xDlZPub18fVRlZkalfn3Z7W5Vd0zgLxlLUqtjY6vS+H5j5YQ7qjBiaofmV6/IYTbNpCf9QfZxr/Sd7N9W9L0W+kElQu1Z/7qI6v9Mx0r+ZkXfaKGHKpFrhUkt5muh9+UxTG2pf5PeIL4VaaHvstA3iKci4JuH+H12esbDDNBovUHrZlAZf7rnPzGNsS+u/wLcXePuLs3rEk8hxF80c6K6bta1b5aO7LvnXv3kuLkLNh57bOltsZMiV67bhhZWenlJE7oKpQNdj6G0kHxSaovmO0vhs8yfnvSd4hvhFvpeC/0gH9Fr/eu8wvz3MqRXFV+Ge6kMXoYMg0rPw+DN2HPOf37kEY+H7/tV4tqH93o8z1e68CmdncZ7XYxLuKvxAv0FJiatMD/7crPMUHhSP5zYsD14Quj9a99/bh334m8YH9XpeK0x1/gTjzd+ijHRvTSmuYrey3rck75T5Bb6Xgv9oPjWaS/1r7NblL/owKQ6ZW5p3EvvFSJ0V++lD/FI4PdIge7GW6RwY6MqxJvfs4D/6BHVp32B0ccr3rVdtEp3U6uLlNFdZ73RtwiOWuh7LfS3aHeWWLjpD8TBevg4qBGSFiY/lUS0JAe2Hi6kh8LeGjzE40py1dMzvJwkfp9XQpJPaZm/V3au37CWLON3fUcn953Rf8myJIMhKSA5RAq1ia9+7KXEBEklzZHUPG58hfE5p5iqjJyKyKGJEREJHoY4fVZVNEZHo1AlY3TLaHQr2Vc06u50DXugtTfqjjr6Bp80mf2kSsb5Svl7aco54iiXDIN29F2t0uQPP6QrKlcuvtetXFly3z0q1507b7bsamn5QIOoHw7P4T4piQ2WvU+9wQmbdW9c6cE8rzCFiR5YWu3NrcpTebQmbUwflqu319tkjeubU5Nyk3cpITwh0ae0P1ib4zdkShIfrcueUjGyPdc4mlfHBOXGJ+QHBxUaUvLtltmXTHMLTCmIyK6Oiq7O6FsZMTQhMiLe0xB/W0Ii8V0lxY8rz5mcU7m4LHloVGp5ZExVuqEqLiogY1hCL5y/pkizLBe/mek8hC0lb87X9LO0S/oOGpsifBsM1Bzle3kIH4a2Yi67PKmQE8uE07GJO0lif5I8jd8mpHmltowKqw50z+nr1i8+XM+nGVsHzS0a0i8nOC4sPy6vLmtB6vglydyDp6YMKI7KG41wvU1lo0qIjSyKNS5xz5te4NR/VlCVW3liVN/g4juapz3Wks03T51KY4cnJektY88Wf1XRMtcyC32aeGonfkODp0th0kmxz7ohXhLWJWPrti1tbd5zeDp/EkwvMr5Kf//ma36dPy6eZkWE0mS1WtmRMz8rbQzPTIzxdA/UDlPF5oeKEw+PQM0wKa7f135hfoHhvG9lpF8oCjmVEYKbMdxb6qNyQs/OYk/m+rQML62Hl0qr1Wd4ZehVGV5e+gy9ln95330Zixe/5zb+mcxGX9dnnxnv1uLi28hbmhuba1MDU3ne/vTKiUOcVxmfq0zfL610HgzNzjDZq2OlC2wAG6NETWavU+zLsk+qCLLZn/LCzm3ZcC0uqSyv4nmWIKdZybGU3rx/bUX5mgPtU166rSqtrjS5PCpYlToyPa8uO2tSXtaoNJXvFCdfl6AEv5wZ6yrHb2rInLKrPaQ4IKA4IzQrJDQzNDIzMDCjs3T5nlnNe1aWZ8/a1jRqTXX0wJSssonJOTNK+pROy0oZV3DQ+JlXYJ+kkTmjlw+Pzmq4e9Sc5ybYaho1Wj45KDfGMyrNPzQ3Oio/wrLGzmYN5ne3CCtXbbog3UXPIWNkz0IPvcUmoO3mhyvui5icmB1fXzQlW+XRvC5C3Xdyv8yxhWHhxRNq4osiI4vio0ti40pds5qrvkMcfU/WsJmZMQMn9/XoO6Uytj2+ypBaERNemhyVWBgu5MvJ9CZvU9E39bCHuZ0/ufZEjqr/DfHnPtkyUya7LB2nay4ZLsvmvqPawm+Mp2f0A/hYla14kowRC76HpYknqKlmo4N11HqQnyUCC148diZcr8iZY729w8NT8C883Hv3hElbg4IWBwU9Wje+NSryscxMjYNNRvYTkVGt5JEO4MPQQxnbxG8VP6SQL2RyPKjDQVU8Si966mDwUAHjVyZt2bJlt+rAjcLWVlVFK1njBNSPoFbus7TCGZfG89GwvmLfDQW7FaOn0ewcMko1WRUeGhYpTVQNl8bPmNY3M7PvtBlkl+14M+yyM91z8yYnaW9udbSqTtLHxcXy8VJ0tcoucWia3mDQpw1NFOsrc1Hxld3EkzZg2dy5c3k1X2ds7/qJrzbORw8j2f18DN8uuJ3hEuIykqvv585G8W5PLDyrQilF5na3J7vdzLas5vllU0tCw0qnFpfNLFKvtslNS8gNDMhNCk8NUq9Wl8xySxo0OdUto746MWNSQUxmXGVKUlWcb0JAYV0mPS1DT2RxH1H2umvm/Yp+I0nMQE+ejnb69PYS+76zJmLjWrfuQ/FXIaU8tkeVLcbvlmbQFrY7S3k3bpj3NPGbKlZ3r1ixrMqlfNFibG4zZuzspefNbAnZxVjjdTF3C307e0Om96i/g91qRXe10A8pTwzQDtch6tWw7TQj87m3LANpxEHlsywPvfg4y10zzzPayUnvFujv4ZM4LNU5f2CF8bpWPVKtdXFydFo2KTolObmY5mfsZOf+S1uDveKcnKM9goK8fZNrMpwKq6uNnVqbMTaiLcdbJ0UbUlLKGH3jikn50lFE5+K5Dtnyv1pvsdxaRfp5XvHUkrDwkqlFZU1FmhU2BamxeaHBefFpJTYrbIpn3dLW1lYbUz4+xT11Qv+Y5LGFUYbI0sSEksi06PwJhtoNG6SiDRvQ+0D0PvF/0fu44iklYWGlU4rKmtG7psAQ2y8kKC8hrRhDKZm17J/0LntJfD55STssUjdfljr4Ql5h+jDt9G0NbcX2xcJbWrfOLFtPybJlrnPLE7curXapFH7TjBli7cXfkDjKr0qR9GtKWpHSXz11NNWws+wJsm96N6/5jVPatkXz0FhxDzd+xR4Vb3+wl9ijUtRrZDeMR9kTpsNiN3RTPjGi3UqYPfnzzzAbj9AgL42vu094fEB0cmW+8WhxuL+fjb1rcEBYUFaaprCU5jWCPaKqonbIepqtppee9jo0NDIqsTzf1T0kgHtrfNx8QmKlEdlpmvyiohCfAO7gEhgQGiSkJZ61SI9KPyHGimBF3dart40DC5dhtaUqC2pZT0SwUwbPrYiIrJg7aHB7ZWTEwLlDqlpzc1urKB2SWxWhr84uHaMeqwoLjY3oExYQGqEapx7fkjm2KdU1vakmPb2mKd01tWlsZnr5vNLyuWVlc8tL55VXpg6Jc0wcYqjM9w3NSgpM8g3zL6wSHmwYGygtl+5mLhi/D4vGbJLFHKw2fYrTbeBvqAC3HnMx0/nQgTOysmYMpNR4dFDjIPxvbNOn+gekRkak+/ulcxsQ8H/Q2oL69D6Z9f361Wf2Sa8v6De4cTAPaBzcaDwclB4WkR4QkB4Rlh70DCg8E9cwxgSMcc7/foxe5jEOKZuSnj6lrH99enq98Ywyxmnhid4+iWGhST7eSZeVIa7Ln5yBIeblYYgZk/PzLUM8EpQeGi6GGB6aHvSsZYjYYWLhQTTe9CCsdVYv75CKIFiPjCdlTSyNjCiakJ1fm62KXtfsrcqrD4kujo4pjoov0UeVuMZU1Pf1gG8fm9E8NIm3dkWeHdqS0R5RlhSVVBAWW5WaWhlDfqIpk357zGpPFk94ImAXvl5mfJ+fM76/7B0puetjaf6MGeWnT4un193vcRbRPj0dwj0Ryr3CrsTQzUoby5bxF2bM6Fp9+vSBGTOef+stPgxtkcW/oPKjnWCP/BmGNNl0WaZLT9PzC6LzW/lE3i6eXfEF9LtXzuJXQdxCrZ7YudMTc+XdF3fP99MGJyQMTksfHB8/OD0iJiYC4AuSBiUnVSfhf/KgpAlJoSGJiSGhSXKMt5A3qlxFZMasztH/IWUnOiLTVSF8MUW7bynR7gmKXjJYieQnzbB+Wmaj8CGDnzG+v2rVKh48c+bx1av5o6tXizuG445Bvd8xnF83Hux5BzddMb3GP1IZhMXTcgO35WMXGLfmq2bfuEO0F21aKtWq+tKnCendn27+7cNNmXWWzaBs/NKCZcElWQOrikozpy7InV09ZHbusoCsuKjMQENW5ux1RUs2tc1rU2U19A/KDMuO1adqbHQNtUVjE9Pr+welBnvH+Iel29joGmuLJhiWbNigiqG9qRija/5/H92YsYv6LQssSu8/IL8ws749p6Vy0My+y/zSYyLT/JPSMmetKljwL/PoMsKzYyPTNDZ20ycWjUlMqy8LNAR7R/uHZqhtdE0TCydaRids+kL2AFbfXrbpqYodr4yKiIiKDg+XFsYFB8fGBgfH0Z4Vwh5T7e1Zd5A+Olofo9erQmJCQ2IEFN+vDL6fvodm/1XczgtLG7AVl0wpGjU3xxjE18YG5iYk5IcEFxoMCMkdihvckgbDA0yHB1i5uH/K8JjUAVEx1RmG6vjowMxhCWYfqow06m3FC7zMeqM/wO7slb5ZPMfphb5DxD0WuquFfkB8MtoL/RD7tdd2rtGvXqpYHOL9ekSRIbDJuYpEpIpHHVaf7oul95Djyp57oZuVrvP+w5b1D86MDEj0K5lbPmBuiV9CYGRWUNmyEQmF4WFFCfGF4eGF8dlFxVlZRcXu6ZNLEsoMjg6OMTn6wtHx8aML9TkxOE0tiy+ZnN7un46B+PunRUam+/PRyYnJCYlJicliJsGmDj6bPyJp2WHMTPwN3mB2kc+WHoYt0jMDPH+Sh4y0blaJIin3brYpw6r8buXYiCCfoOiy+Piy6CDf4MjxFSFRUSEh0dEh/kHBfv7BwRfzcyIM9rZ2MSERKd4+SZEhMXa2OkNkbr+hvn5+vgK7PNzd3XB4CL6mga8t/0d8HTIcfM2KDBR8HTBwTql/YkBEVjD4Gi9eJUlAGgG+FhdnZxWXCL7Gl6X+HV/1aX5+aXria1JSUmIiEsHXQvpbiJsZPDydeNOtmgfInp6UfFOC6InR28oTo4fJw3Rl36kW8kEUc8F6uqoavmtqkun8shWdfy/oIlZPRzSSRL+PaH5ryCD8vggXg/y2pFBllzAXef7YCLMjQ9fNmGX8qVkXN7JAUzt5XVaKod97cyOCo0OnjHtPCvppaEvm4kXGd3lRSl6/NON/5NHmCJ23jDabu8HqSdghdkhe/EclkiRrH4K94bQxmJ/m82bOfH/mTNQajlqDetYS+4ENv26upSKONKqcWThLFe8nKLbF/KgFAS6tpzbNysf50zoLv6aqf1N5RMGcqr5jsjT2XB/umR8flBcYlBvUur4gb2ltcnFYRHFSYnF4WHFN8g9JbrHl4w2u/VsLIksS6+f79uljYzPdxqbmpVW+kzcNnRtRnJBUEh5ekpRQHMEfT/s0zaL7zhZe3M1uJ913Mv0mbZXOMX9oULj5KUS6VZwiP/ckk0geBbyLDZseuf9fY+bmqhaqB5SPGTl27MD+6oWqnHnGEL7bOJbv7vPKPqf9+3NmlGQWLrzrroWFWaUzcriqouK+igr02Ac9bvwf9rhuw30b7h7dmo0ei0pHDho+uqwIPWbNNsbyZ4xT+TN9Xn3Z6eVXc6ejx0V3rl9clFkyI9fcoyT+vhv7xfzkIEM8EoKwDVt//9Zf+C9Gt182bgR/yk0lqBPEysQn5lJQvni1lD5H4e3St+b3+iwBBr3lM3ZqfXFVUMhbfJwUN270jJDArnf481OmCK6K9zs+k37EfV7CO7K+07os5jdmar0hNyjk9NT6woqgkK4vpVekFLm117s3qxGtqvZLl5VWxXvGiX/dtvnTxAwRO1vtjjf761ceFPL7uhvjpK2Jn4yO0uujovV6KUPu8lUpWS68IQV1fcN3T5nCp017KjYE+2lISKwYiyld9Zp0ncYSzqJYnJD+vxqL/Oar+VXAvx1UWr+gkBUxEVGrEiZWdaVKzyZ++NdDe29uVIQU0fXdwNFR0jIa4Q7LCOlvQKv+bVkDwa1/xKubQ0nKDgo5v+5GnfRE/Ps31yR83OjpKHxMr3NhXV6fNk144uCHNI744U2SHde9t3/CAWXq+lXxtZXGTXxA4gejzFM39/5fZyyNJvlwpnevwv4ss27y68Y9u84sDAo5xAvb1n1yUxLMfYrFNw4gMdhjLQOcJcOmjIRe6f/8CT4ZvTC3EI+QDK3eyvbxohELC24Ly4uOzQsJyY0Nz3e9NYI/abw3xTs0YFj+4Nac/IVuxbOKIrNDwvOi9P0i/L34xvn6G7qQuMKmfMeC1jJh10NNneJvu2P3P0e7P8cu0sEbEF2G085PI7G8fa8NywjxCOs+jDeTy6NqI/2Dw8OC3QNtJ3hw1ckoB0+X5Kj4grDI8o6IfnrfwAh/v4g+TmdH+izUeASE5URqIwujxF5XglnPwqyj/suszf6lmHXNiEVFa8ILouPyQ0PzYyOKXFZE8OeMGxK9g9ySi+IGteUWLO512l6h7uZ5K2+NDUHP5vX9y9UdIwvvIV7UuO699ywiy3dgJYfSu4itQmrFb9YwaSk8FIp7MtK4l8orhF74j+SBM2448NeO33rvA/zVcuMc95n3SvZdneC++B3fZXwbuP8rcV8CxcSXSU+Yo6cML62X/LUB30crV9leuX0cL5t6OfFTh0H9eZjxpOhXfFK5qrd+E7jfjKsO/OBXvfTLt/JlqgFyv+wJRGELTOew6tvNUdgqvrbeOMdTOtBVKEfzMdIk+Bh6eV82P0+Ep5EhPhKxju61aaSYf/rsg4fpB4eFDwkvGqoPVGVO7Jc5piA8onh8VlFdpsq7ufiO0qjCqOhCfZz4uOCYxqZNrQ0uSZtRPLAhI2bA5CyPrLoBUdnNg9TnjSF1C7J4eXhxUhhCiOgBhpQBUbQnY4Tkj19U4oBHFS+rO30Hu8uKXmWhv8S6rOiuFvohZqLPfX1NF6WZ2GlTu3PA8v6GlRsiXC1yusgjDctQCuJBAp/va3BzS3LLyg3KTYjxD9S7ecQEBif4rFs6S102NTNuVKFqWFvf/6+1a4GLqzrz95wBhleAmWEYmAfzfjDAMO8n84DhER7D8A4hgQQCBEIyEExCQrA1SR9miakkptZU29RYtWpWk7pW1/7S15pf2m6bdnddbVr9ac02rlHb1XRdo9zZc869M0Ag0X0Y5w7z3fO+53zne/y/c0OTdG/vmrTUqRRupU3tUY2KSwslZWK5S0engA/2HHRs9FgjpTp7f6h2sxWcHR1lvbnXiJ0yaR0nvzmMfXty8r51xJ3LWCezGW8uvvPVr56cIu5cDrWW6oOZ0J7Q3V0OrdChdaTiHX4t+CkdAD8dKu7bfc9k9T17jh1ob0eraC0lQzn6FrGXLiJlrMiHP+PFsh07vjc5MVQ5sXP/XpSdzH89rAJvIRmZRIEg9pNBnoIW0ZsRPZei4QjMJJZOlBa4EQ3LHXqHy8YVih46dPjEkSP6l0w//430N2w+EMb5UEl9bL4oGotqgrphcKgrJeLoXKGxI5TWt3nOZ7YF4WW6u32q8q4Z+hcgbK8MO+kLbFxKNbbcACYu5RBlJpYbbA+eIOOMJVvUKiX6PN0y1UtfQxc85NiHDsmoHyKjviTd2Z6ZbfRVdMEPAD0C1Fob9QdwEccfMmNpAyf+MDNDTkKjqOvwI5JfkMDfL997xuZeeaUH7TYlJTrdyi0G9QGVAZx4LYA1xFv/ZRxtgs8lxO8ZSFJP/glTX0HU1iXUM69gKmI4oAGvDpZ6/jW2XOr6EupLdbjHTIvli3gs3F7cxkTbUHnXSM7FWm5cw7V8iE88x5oRQwXKD0kt8RzqBvwIUbmE6gU47VsobRjL4mza+bcIoDxuo+JIgsim8pAEQS2TGAQ3DRtkJSTuy4nt+ldYMjAsvIElgy8tFQswzjtuw2+wQPXlM+Pye/I+M1KfnNS3srbFGm4qGWtvKPtoEnmtVwtsHJcAI6/BL59ruzr/ModeuDpHAyX91zr6URbZHqUv4zyoDUw0zVkyIiRyjXpzKQIOj3j33KVLiW2KmcegEeNdgIjBXNvZqCz8hhCWyqW+Q/2O2Cv59GXqA1ITk/psJ06d4BO51KdoD53/MXUrToC5AOYGqcs5AT1HWMH+4Yn6of2TX0GsACA9MgpdYBqfTon0Q57aIXJBansAcCfpVz8K4hpysL9/Kc7b5XAJXSzOG/c0Z8o98VvU21+OBEekI4ER+sHk9ky4AOcI2sGMZGSSenHBkr8WGcIiZ4hlGjsCacGOEnUp/u4snbObzV5yQXpy+4THM9HOXDG3sPmxupz4Jlz5KAjCv+A5zHJl5jdG0mBdLAiPDg4SnmwFd3DuS9Lv4FgJPRx3o71dgeUjEcH2JaF9BURWQSKTy4anGf5T78rHMlJ4zm1WWKRzAr7N665T8LNKWz2pquoyaMjJvQjfpl+w+qR2NaiiZ/mCaU2ju6o95lZUGtMV4TrdHoLuUEAJuJfxmWJd/go22OLWd6E7rYt3kP6euGME56g3mBgMAZrBRu+sF5wDBhrHgDqoYSiDzcys1LoAVwD0APxjGz3WFgHfjNDDw23g6230NnAyQo+g9N1odkVhF6thorSpKM9p8FSE7gSPt9E9bX3gyQjdFWkDj7Ut8nczy99Xs3hElxk6VrdvkFLICihh7It4Ta1CP0XNMXS0BlGtSfpZjL1HdGP8BtwG/4x2oGmI1uuPGc61AKaxhQ2YWSlPRn2K7j+EvtF8FLCirXqZXJXw4okSSjyWLy4EoprxMZFRICwrMFv5BaDBWx3pb9EY9Gp5BV8JH7L1OERDIxzQBTnFbm15SmWgMRBu7VBLpCq5nC/NI7juT+AW0sIZ+F22hUwvcxO9AfPkbRAkOgf3Ykk8HkY+oo+WtSbs3blz51fQh66G/QsXYX8iOOcn/f03+vuJ5PgenIVW4g1cNRZhuf0GdK6NNetLIrHa2ljEoG+O1dvqNNp6i6Vep60TmKJDTqF7OFpeHh12C51DUdN0ecRijZSXR6yWSHnCqjZLnpedfY651Gr0k9Rjq9LPUN9YQucn6eeJ7570JyUL9acSv6VieX/UtzWD4+eJUttyOCv63Fofa9QZmnbU1m8NK9dLKzeFe3b76H7QVCqvXGIn5x8crh+slKwH8qrROnZY6tCw8E0tw3hYWvCwuBxDrdiITrBremOLy9ZSrpd1DlnahqyOLa0VaMDMaMDKWqxmNGCA8qBd9WPUG7SbiRg7L1I50pgphzFMP/StrSiTO4sLRYUFkvxM9QdBt6lOL62UCdUCgTB9kJOK16AZsbobVAjjagU3l0KgUD/0R+0VcrdCJJUUrSnKyFTHqQaPpU1TGBLzjUKhNDVlGJW0yvO4QT212nMCKdhTlaATWcHOWlGfJZwWA4nqSCQ24goiNdpSXij7CVDBg6oZsofi0/cvYb0XVLF6rwRJ+peQ3puG7VoE2TVeNPZsHEQEPXQMPflt6PF3srHdlJIpk0BQNWWvAg/9AniHKRyJa7j8+DscP9KndLh8pDd9QOQTLjgBrlKJ+66V96n3ARNvLQGPUJc4TqZ9SEODVDHoBPvha+hJ4TfBrESeCrmq1YCnSPEozC+QZFvchTyTme+PGl71NpW3WOvrCiXiotyiXCBLDYL+id2FYgCRWAGhtsZ6JTPkMToKq4qEgqJsaaHUE8JzXwVawQ/gFYpHKVkv5TJ/883z+r1Qr8W6IeDfYDX3horUPL6qqEjN56NSHD32PFeP3d7jyrP3OMaKSqXSMnFRmUxaWkTwJvGX0DNtIxEwJbeOgFleWz14sY+ufeY27MMHjyzsMnxuHpKbnFPzBPeILe1ueC/aaYhPG+3HQv2S9pAdWMQT3IyKi8Z4Kf6RoLcvrFGH+73+4UBK2YkloLiL8Oo7oGPSZWwe9gp9w5FS23hXmD4JSsuiVntzaQIWx8FYdaiDrxNsNm8JSoNgt/C/X2zp798yottetw3c2R/Jaumjv00fgq8vqPAHrwl3vBHs46Tj3CLGbYINwwQS8HtLo8HYbP6ms9Okbw8+5z96ZvuOJw97qu99dHDg8a/XElw2yt2EcWugOYlbS0V68X9wOiG27AvRrLBRQXLeAeCsNjsWPTC3vfsxWHMH/eFj3matLuL2Nuu0TZUatUaN/oNpqxGx8bAZTSmxZ53Fss4jRlOqz+ELWa1Bn5Nee4sbeDwIBgft6DhyFMmPngdPnSLInIvUy2AUEkwO+puL+5jyu2V9bKP6/u/9TP3/HAXwPR8mejyY6NOoEEnzvxyavlsNGfb2DEAJjC5a/7EM8O4M/VtwZQC8T/N/xHp7orAVDrASH5sKCGfoC+CTKOQvvP9bLDVyqBrKAIsRx03aG5BMwXOR1DXgMn35Dvp34LJhfPxR8FNAB54cHyf7rxtuT6zBVN4K8xPm22CF7enNEo53MOTtD2t1tZt8NUMeTkGMfmsJsOQiGAu17HCXRjC8ZLip1DvR+vZCEShPIEuiNlsEw+Dw27hgBpKeZJgHuhwJExCuaLWTSf6+q9Ijtio1NumXvZNtjeNe7842Dzxx6t1zQZPSIi62KkPbgp7BQLZ/swvaZ98l/hNd3AzzkDaZC7phBZQTCa0eydPH0O6jAySmCF0vsfJmCJynjqPZuoGiFp7GiF4wD55HXDoXbAB/TNlNchsR7Tyi6XDkKDkF6zUG4Y142+9J2j6QitMSWX4eaZFXsG1SwBi2lkHK2DglY6FMlSfjinOUZUZ9UalY3+gA8y38UqRQpHJLNKoKkcfKq+/Usm2k3iRt7MNtRHWg3lA/Y/UFND/qZ1ltgUjz4DjUYW2PleYTRtlojDM0kK+ri0D5n3bv3ddUT/8bI7niNykiXr2ZxQV8l/QM7RvgZJKeRp0qwdQW+jIuPUk9G8E8zEmdI7Y9LKNiNFXw86DWMIrJpreJ9MsPHEFiPOioG1+r0TZsq63d1qDVrB2vq93q8WytJVdzY6ytpfvtbmlRkbS7LVhXFzxnaRu05NkGWisqWgdseZbBNos9OBaqHvP7x6pDY8F24KYv7t3bHywsEImCbofdg9eON/4xuIZ4Ej4PxbfoD7cJma0fh+0QM7Ye41CI69TFRh0wlvW0AlExxDgUIeBU9trsA9UVTou6XANjH4PxNzKy8628Eh6fH67Uter1zVZeTgqHk54u1+QWS7nqGos5rF4vUcgVBlBL3w02dXdXqrL53Gxppri11ChNSxtK43IzMnLTUnj5mXxLqQq1eF/8Yxj4jBaDz9fiSGiz3TlS7/baSys0cIL+L3Dg7aw1AhvfyBfwa/2GdqOxvUKQh5qcka7U5RbLbtHkLAE3S5p1U5NTefkZPJtRxeCleqm/cuqR/j7KvMOF/Z2VwEkmjEhLOfd+V02Ny1lT4yyQSApEYjHsDdvs4bDdFq6RFhRIpQVCGVPWp9QC5/Lty/qit7bW60GfIrG4EAls8NOg2RzEn2qxIF8szhdgFwKliv8ZAljBxHsngODLEUiLDuEE/AjkT36RcyfHXWn1lTvNGwbdW0JDs5w7od1SZtaXmTfv8G3jbeqUmjRyiSI1NbOzzt2s7+mSGlQSsRT97m5wRsuIBwnVTVbaNnYF/pyiVtDRCiRn26joT3BLk6kfpx5YNfWZdib15WWpz7JxgEbEL54m3JCcyIGul1jt7DTUc5RIno7eNBI6vYlDJB4RK/EUc9AYcPTOpTeXA1CZJGlAzgyTr9ymqVRrGgO68gbjFp1fVVKlVdd6Vbsk4aqAPqhFd7SOTf4te8B+YKooLdH6NZrmoN7Y3jfQI7do5KLigqwsicFntKyt4FpTikuLZJqi7Eyxzm3sGgapNTk+rURVlJUtNVSWWyOm3g65VispUhRkokx+k7nBjvqdG++l/h18TOmoZyCDGk4D61nfkzdhRbQBPdFLsE3sXsDLoI/CfPpa/A7Ys2b39oVj4C/vvEOxvqeNRAPavcT3tBHtx8xuLNDjwxM4iL8Je+/hXgDV9z/ZHgfOjA43/Wj8+HGUvpaNZ11WK3ZzPAcKM+i7oIq+Qt8g1Y4vzIO3P/gA5amMX0Oy/RsEx5NEeCyuciQzc1l9ZhWNAgy17axT/N3TumqlstbQublEAXyj4ZaYr+bO3opqlTJUXlpfogwLXZu/WF/2/RdSUqZTUryTHVWmyLAtEGto3l01rQ4YSgIqub9cH9BQZK+9Dg6AE2gU9rGjoKM+BAfgfVQxxr0nsMmL8Vq4hc5VVmrBK4EW7fZRQZmQK1PnmW28AtDoqW7pj6qNJSp5BV/1oX2dQzQ8DGEX0rPkLm15qj/YGAi3dSplElWxgi/NxTO4Go3PntuOj/p24xOdqJU/+4SmSqGo0XX064qBe6gqst1Tvb+nLKiSB0yGsL64SugauGtt+TPPo/HhpPom2ycahx3+WENkV9W0JqA3+hPDAyhh/B9AjI3EEdg4wl/P/ToZiWOi/gAOLnoqTKATeypSMOYbxpecgUbZ8HEiak4CRIu/L98PlPuB4hsX6NPwRXp4Pz0MXwQXaC9wH123rvzpp+9dtw6/7wiV9OBnlPTAPOB8DcBjz9M/gMfp3Yfo3fA4Kalr55KSkKwIe5BMw5zIVsx6e7G8mHioyVOmsMF+6tghUcAnEPiDQltYcQFcoVXgXHoMvD1zkJPCmUIfechKy7dvB96+PvrChQvYVtaA6hj/fHXwUB3z98wKA36BIBjIr/AXXwCv0ibwt6iKfYduUQWIvwrQIIOH8Yjjrd0AZoFp1y6Mof0jdQU0AoKh1aM7xWD0SjSKZhM+o/AwfJ7xS5AdFz1FJvwJN8XXNGBGz7DU0EXfBe7i6vui4F06y1A6DX48MoJXB5sf8d8vEe/KIYuIpZ7gbGCp2FvwOqXEdPqTpampx8mZXBlI5lqkYh7+1BJt+nJSm14WXHZLbXpOloIkeff6kEod7vMGVmjTnIfpQ4VNY05D44i/oHK40Whl1Omy8harvcmoqcXqNDnTTYu0/CDeQxaxB6wbF0sbehdhZ8sBF9bOfaHD9f4Sn6LOX1zOq/pLBlJpXvsoIigTd0yHQnsFofFqR5XcpXHW5q2ZfIS379gjOWlcz1DVmuBYkLH6/BVJ5ZjnHklana6DDYjnqhic5TKwBWqDerENuAkvNnYPqGQypVKWJ84w7U09BWTHK7Kl2Q3d3debPQVSuUhUnMltqs1Y17MOiT9hT5q7Cfe1EvV14/+sr81dM1WHGwIllaqGgKSCH76eSf8MvHmjQ+AQds1UV80IgtuTfc3Z8Tjq62M56enL+voO55vEwnWEtXBNMRYuKGUtXA+ADcTChe9/l0hbe8BmTi724rHeEuY3kY+Y+FHSRCZ+FCkln0j1cqWwSJcr5FlUMp1CUVCkzxHmWeGe3Pw8YV4/X5KXn4u+kZCEfSwScDfnWRI3umppQFRsVGsKi005BXkew5K/ORJUnIjfJ5Sh4kS8vnwZlsB5oJmzlmD2CX4E8EgUWfLsoMT5VeDu6ZG0rXt6hLHBWD79xMbfgDBoBkfjcXoKdAP6fcAH9BOgkX4OhFpaiJUG9TuINEwNtkpgicXlXO3sSy62rwr1SmGVLOyaNVmCXm/wsHequ3vKu3H9rFqqAieOmGochS6h3+wIhjw1O4KBrcE17TsMrlylNKTdR/Q/VGE38Ux8nZ2PaFNEWudDjHZrv6lydhayVduEJUZLlUhSLJXIBlqaGqNmf4jHK7wab9c58sWZkkIk6xZ6WxpdaeWBQklaTrYwrxO/oZkCcAPTP9fn6V+3vMbzBXNFtc9bfdi7a926Xb7NG76gkSjBg4B00FkQqLCzHRz1r+mY1DnzFJIq3T6i3z4CujnVTP8wzoUKIznTBBXYW4TRkgmnmoOJSSGIsvT+rXNus9k/F8sydgZ5szPAh51mAQeoWnjjanvMjUeOlEPk1QdYqfc6tRr9JMaGrkI/Q925hM5P0s+zMYM3p79Bza9GBynUk4t0Ygd/gLWDP8CsofggbCBvHKWEOJa84Vujo0z6HOiHimR6L34LfbL8+iR9lI0cYei5Sfo8dZhgXjEuwsR6+bOY8zFwhCH2Y//wia+d3nR845GvHMce/6kpfEXadj7KtgXl4C5ir5QkitzGUeMwY1SC0mHj4hJAxtZT07F93vGvgYlH7/vqPSB/AlTf+YVDcM3ChzBz4T+ZMpkraiMpmYzNo6zvh8H830w/g0+MSdL5Sfp5kLVq+hugiIwlj8RByhk/GJc9XcMlwPF9vLOcx+7fkbv16Lc4L95/IHcGqEQg/0c/ot/Lp9/41a/I+16NUInyriFRWwxGwOlCfUR7HcYv4m4HR2R6MffYl7+T590Qbt11+pkjj/3rdK5SBi0LZ/0Nij/GYlCw8B6zL6PSSAufYmffy9RKOtKi+hep/CT1/BCWV/CTm2HP+iBtWn7eR8LD9+7l+UeUPaoTh39x+iB9BqoWXocqUA7O0OfS00EL3UH/M472P8Hgg1NYFNxnlvpf/zT/ICr16OGfoVLPQvHCn6CYlPocKrVxeamr9PcGdQcTMYsu/8I+EQcQsmeCOPCZIGUgW8ijPwLfoq8X8AA/BqrzpOnjMfp8rjSDRGCSvKTM77NjeI5aSUd6q2uRyk+mfol6gkgxAbSzPoe4mQBbBpch1hNWo0Vr8P7uvc3qmiM7th8Jq5v2dq3v7EbbdLfAs+VAvXv44U2bHh521x/Y4jm4/+DfTE/ffWgW12tAEsO3CYd+gdVPDEhi+Dbi0DyMsHHd1oZ8pbpTV9IRCnUYdO3hstKyUvT/dWevXeFa73Csdynsvc4+b2XI4w76faxuNob6Qvw7qZ/p3wHtA/u9gdmNfbMB7/5Bq18q81vMfpnUL9x4etw0eXr9+tOTpvHTGw/Ydm7YvNNq2blp40479d/SxS7D",
  "SpaceMono-Regular.ttf": "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",
  "SpaceMono-Bold.ttf": "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",
  "Sora-Bold.ttf": "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",
  "DMSans-Bold.ttf": "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",
};

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
function buildVectorPdf(pages, pageW, pageH, fonts) {
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
    const p = { pageObj: nextObj, contentObj: nextObj + 1, emojiObjs: [] };
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

    // Watermark
    content += "BT\n";
    const wmSize = pageW / 1080 * 13;
    const wmX = pageW / 1080 * 28;
    const wmY = pageW / 1080 * 28;
    content += `/F2 ${wmSize.toFixed(1)} Tf\n`;
    content += `0.878 0.906 1.0 rg\n`; // #e0e7ff
    content += `${wmX.toFixed(1)} ${wmY.toFixed(1)} Td\n`;
    content += `${pdfStringEncode("agentIA \u00A9 2026 \u00B7 www.agentia.pt")} Tj\n`;
    content += "ET\n";

    // Draw emoji images
    const emojis = page.emojiImages || [];
    for (let j = 0; j < emojis.length; j++) {
      const e = emojis[j];
      const ex = e.x, ey = pageH - e.y - e.h;
      content += `q ${e.w.toFixed(1)} 0 0 ${e.h.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)} cm /Emoji${j} Do Q\n`;
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
    if (page.imageData || emojis.length > 0) {
      let xobjs = [];
      if (page.imageData) xobjs.push(`/Img0 ${po.imageObj} 0 R`);
      for (let j = 0; j < emojis.length; j++) {
        xobjs.push(`/Emoji${j} ${po.emojiObjs[j]} 0 R`);
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
      const uri = link.href.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
      startObj(start + j);
      write(`<< /Type /Annot /Subtype /Link /Rect [${x1} ${y1} ${x2} ${y2}] /Border [0 0 0] /A << /Type /Action /S /URI /URI (${uri}) >> >>\n`);
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
          drawVelaWatermark(ctx, pw, ph);
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
          pageData = { boxes, textRuns, circles, svgIcons, emojiImages: scaledEmojis, links };
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
          const pdfBytes = buildVectorPdf(pagesRef.current, fpw, fph, fonts);
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
        return (
          <div style={{ position: "fixed", left: -9999, top: -9999, width: rw, height: rh, overflow: "hidden", zIndex: -1 }}>
            <style>{`.no-anim, .no-anim * { animation: none !important; transition: none !important; }`}</style>
            <div ref={offscreenRef} className="no-anim vela-pdf-capture" style={{ width: rw, height: rh, overflow: "hidden" }}>
              <SlideContent slide={reflowed} index={renderIdx} total={slides.length} branding={branding} />
            </div>
          </div>
        );
      })()}
    </div>
  );
}



// Helper to collect all slides flat from editor lanes
function collectAllSlides(lanes) {
  const all = [];
  for (const lane of (lanes || [])) {
    for (const item of (lane.items || [])) {
      for (const slide of (item.slides || [])) {
        all.push(slide);
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

  // Inline formatting is already markdown — pass through
  const txt = (t) => (t || "").replace(/\n/g, "  \n");

  const blockToMd = (b, depth = 0) => {
    const indent = "  ".repeat(depth);
    switch (b.type) {
      case "heading": {
        const level = ({ "4xl": 1, "3xl": 1, "2xl": 2, xl: 2, lg: 3, md: 3, sm: 4 })[b.size || "2xl"] || 2;
        blank();
        ln(`${indent}${"#".repeat(level)} ${txt(b.text)}`);
        break;
      }
      case "text":
        blank();
        if (b.link) ln(`${indent}${txt(b.text)} — [source](${b.link})`);
        else ln(`${indent}${txt(b.text)}`);
        break;
      case "badge":
        ln(`${indent}**${txt(b.text)}**`);
        break;
      case "bullets":
        blank();
        for (const item of (b.items || [])) {
          const t = typeof item === "string" ? item : item.text;
          const link = typeof item === "object" ? item.link : null;
          if (link) ln(`${indent}- [${txt(t)}](${link})`);
          else ln(`${indent}- ${txt(t)}`);
        }
        break;
      case "icon-row":
        blank();
        for (const item of (b.items || [])) {
          const title = item.title || "";
          const sub = item.text ? ` — ${item.text}` : "";
          if (item.link) ln(`${indent}- [${txt(title)}](${item.link})${sub}`);
          else ln(`${indent}- ${txt(title)}${sub}`);
        }
        break;
      case "quote":
        blank();
        ln(`${indent}> ${txt(b.text)}`);
        if (b.author) ln(`${indent}> — ${txt(b.author)}`);
        if (b.link) ln(`${indent}> [Source](${b.link})`);
        break;
      case "callout":
        blank();
        if (b.title) ln(`${indent}> **${txt(b.title)}**`);
        ln(`${indent}> ${txt(b.text)}`);
        if (b.link) ln(`${indent}> [Source](${b.link})`);
        break;
      case "metric":
        ln(`${indent}**${txt(b.value)}** ${b.label ? `— ${txt(b.label)}` : ""}`);
        if (b.link) ln(`${indent}[Source](${b.link})`);
        break;
      case "code":
        blank();
        if (b.label) ln(`${indent}*${txt(b.label)}*`);
        ln(`${indent}\`\`\`${b.lang || ""}`);
        ln(b.text || "");
        ln(`${indent}\`\`\``);
        break;
      case "table": {
        blank();
        const cols = b.headers || [];
        const rows = b.rows || [];
        if (cols.length) {
          ln(`${indent}| ${cols.join(" | ")} |`);
          ln(`${indent}| ${cols.map(() => "---").join(" | ")} |`);
        }
        for (const row of rows) {
          const cells = Array.isArray(row) ? row : (row.cells || []);
          ln(`${indent}| ${cells.join(" | ")} |`);
        }
        if (b.link) ln(`${indent}[Source](${b.link})`);
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
          const date = item.date ? `**${item.date}** ` : "";
          ln(`${indent}- ${date}${txt(item.title || "")}${item.text ? ` — ${txt(item.text)}` : ""}`);
        }
        break;
      case "progress":
        blank();
        for (const item of (b.items || [])) {
          ln(`${indent}- ${txt(item.label || "")}: ${item.value ?? 0}%`);
        }
        break;
      case "tag-group":
        blank();
        ln(`${indent}${(b.items || []).map(item => `\`${typeof item === "string" ? item : item.text || item.label || ""}\``).join("  ")}`);
        break;
      case "image":
        if (b.src && !b.src.startsWith("data:")) {
          blank();
          ln(`${indent}![${b.alt || b.caption || ""}](${b.src})`);
        } else if (b.caption) {
          ln(`${indent}*${txt(b.caption)}*`);
        }
        break;
      case "divider":
        blank();
        ln(`${indent}---`);
        break;
      // spacer, icon — skip silently
    }
  };

  // Title
  ln(`# ${state.deckTitle || "Untitled Deck"}`);
  blank();

  let slideNum = 0;
  for (const lane of (state.lanes || [])) {
    // Lane as top section
    blank();
    ln(`---`);
    blank();
    ln(`# ${lane.title || "Untitled Section"}`);
    blank();

    for (const item of (lane.items || [])) {
      // Module as sub-section
      blank();
      ln(`## ${item.title || "Untitled Module"}`);

      for (const slide of (item.slides || [])) {
        slideNum++;
        blank();

        // Speaker notes as metadata
        const blocks = slide.blocks || [];
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


