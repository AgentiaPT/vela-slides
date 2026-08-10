// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
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
  const isInline = (el) => {
    const d = window.getComputedStyle(el).display;
    return d === "inline" || d === "inline-block" || d === "inline-flex" || d === "contents";
  };

  while (walker.nextNode()) {
    const textNode = walker.currentNode;
    const raw = textNode.textContent;
    if (!raw || !raw.trim()) continue;
    const parent = textNode.parentElement;
    if (!parent) continue;

    // Resolve the BLOCK-level element that owns this text. part-blocks.jsx's
    // parseInline() renders inline **bold** / *italic* / links as <span
    // style="font-weight:700"> / <em> / <a> INSIDE the paragraph/heading element —
    // climb past any inline-display ancestors so ONE box owns the whole paragraph
    // and its formatting becomes RUNS within it. (Previously each inline span was
    // treated as its own element → a separate text box floating at the span's
    // mid-line rect, so bold/italic segments appeared misplaced/overlapping.)
    // Hygiene exclusions run on `parent` (a descendant of blockEl) so closest()
    // still walks the full ancestor chain — including any inline wrapper we climb
    // through — matching the prior per-element semantics (e.g. the slide-counter
    // pill's data-no-pdf guard, SVG text).
    if (parent.closest("svg")) continue;
    if (parent.closest("[data-zoom-badge]") || parent.closest("[data-no-pdf]")) continue;

    let blockEl = parent;
    while (blockEl && blockEl !== container && isInline(blockEl)) blockEl = blockEl.parentElement;
    if (!blockEl || blockEl === container) blockEl = parent;

    if (seen.has(blockEl)) continue; // one box per block element
    seen.add(blockEl);

    const style = window.getComputedStyle(blockEl);
    if (_isExportHidden(style)) continue;
    const color = parseColor(style.color);
    if (!color) continue; // skip genuinely invisible / unresolvable text

    const tt = style.textTransform;
    const applyTransform = (s) => tt === "uppercase" ? s.toUpperCase() : (tt === "lowercase" ? s.toLowerCase() : s);

    // Recursively collect the block's inline content into lines of STYLED RUNS.
    // Each run carries its own bold/italic (inherited through nested inline spans),
    // so a single reflowable PowerPoint text box reproduces mixed formatting. A
    // <br> starts a new line/paragraph (explicit "\n" in source); a block-level
    // child is left for the walker to emit as its own box (NOT marked seen here).
    const lines = [[]];
    const pushRun = (txt, bold, italic) => { if (txt) lines[lines.length - 1].push({ text: txt, bold, italic }); };
    const walkInline = (node, bold, italic) => {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) { pushRun(n.textContent, bold, italic); continue; }
        if (n.nodeType !== 1) continue;
        if (n.tagName === "BR") { lines.push([]); continue; }
        if (String(n.tagName).toLowerCase() === "svg") continue; // icons handled separately
        if (!isInline(n)) continue; // block child → its own box via the walker
        const cs = window.getComputedStyle(n);
        const b = bold || (parseInt(cs.fontWeight) || 400) >= 600;
        const it = italic || (String(cs.fontStyle).indexOf("italic") >= 0);
        seen.add(n); // absorb this inline element so its text nodes don't spawn a box
        walkInline(n, b, it);
      }
    };
    const baseBold = (parseInt(style.fontWeight) || 400) >= 600;
    const baseItalic = String(style.fontStyle).indexOf("italic") >= 0;
    walkInline(blockEl, baseBold, baseItalic);

    // Normalize whitespace per line: collapse runs of whitespace to single spaces,
    // trim the outer edges, drop emptied runs, then apply text-transform per run.
    const runs = lines.map((lineRuns) => {
      let rs = lineRuns.map((r) => ({ text: r.text.replace(/\s+/g, " "), bold: r.bold, italic: r.italic }));
      if (rs.length) {
        rs[0].text = rs[0].text.replace(/^\s+/, "");
        rs[rs.length - 1].text = rs[rs.length - 1].text.replace(/\s+$/, "");
      }
      rs = rs.filter((r) => r.text !== "");
      for (const r of rs) r.text = applyTransform(r.text);
      return rs;
    });
    const text = runs.map((rs) => rs.map((r) => r.text).join("")).join("\n");
    if (!text.trim()) continue;

    const rect = blockEl.getBoundingClientRect();
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

    const vs = getVisualScale(blockEl, container);
    const fontSize = (parseFloat(style.fontSize) || 14) * vs;
    const fontWeight = parseInt(style.fontWeight) || 400;
    const fontStyle = style.fontStyle || "normal";
    const fontFamily = style.fontFamily || "";
    // Horizontal alignment: textAlign covers normal text, but a flex/grid container
    // (e.g. a numbered step/badge circle) centers its glyph via justify-content —
    // which textAlign does NOT reflect. Map that so the number sits centered in its
    // box instead of hugging the left edge.
    let align = style.textAlign || "left";
    const disp = style.display;
    if (disp === "flex" || disp === "inline-flex" || disp === "grid" || disp === "inline-grid") {
      const jc = style.justifyContent;
      if (jc === "center" || jc === "space-around" || jc === "space-evenly") align = "center";
      else if (jc === "flex-end" || jc === "end" || jc === "right") align = "right";
    }

    boxes.push({ x, y, w, h, text, runs, fontSize, color, fontWeight, fontStyle, fontFamily, align });
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

// ── native-SVG capture (Lucide icons, flow/cycle/funnel connectors, svg block) ──
// The PDF path converts each inline <svg> to bezier PDF path-ops (extractSVGs,
// part-pdf.jsx). For PPTX we instead embed the live vector directly: serialize the
// DOM <svg> to a standalone file and rasterize a PNG fallback, then emit both as a
// native "SVG with PNG fallback" picture (pptxPicSvg). We only reuse extractSVGs'
// geometry approach (bounding box + container clip) — the PDF path-op strings are
// not PPTX-compatible, so the serialization below is written fresh.

// Serialize a live DOM <svg> to a standalone, self-contained SVG string. Computed
// paint/stroke/font values are inlined onto every element (as inline style, which
// wins over presentation attributes) so the icon renders identically out of its CSS
// / currentColor / CSS-variable context — getComputedStyle has already resolved
// currentColor and var() to concrete rgb()/px values.
const PPTX_SVG_STYLE_PROPS = [
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "stroke-dasharray", "stroke-opacity", "fill-opacity", "opacity",
  "color", "stop-color", "stop-opacity",
];
const PPTX_SVG_TEXT_PROPS = ["font-family", "font-size", "font-weight", "font-style", "text-anchor"];
function pptxSerializeSvg(svg) {
  const clone = svg.cloneNode(true);
  const srcEls = [svg, ...svg.querySelectorAll("*")];
  const dstEls = [clone, ...clone.querySelectorAll("*")];
  const n = Math.min(srcEls.length, dstEls.length);
  for (let i = 0; i < n; i++) {
    const cs = window.getComputedStyle(srcEls[i]);
    const dst = dstEls[i];
    if (!dst.style) continue;
    for (const p of PPTX_SVG_STYLE_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v && v.trim() && v !== "normal") dst.style.setProperty(p, v.trim());
    }
    const tag = (dst.tagName || "").toLowerCase();
    if (tag === "text" || tag === "tspan") {
      for (const p of PPTX_SVG_TEXT_PROPS) {
        const v = cs.getPropertyValue(p);
        if (v && v.trim()) dst.setAttribute(p, v.trim());
      }
    }
  }
  const rect = svg.getBoundingClientRect();
  const pw = Math.max(1, Math.round(rect.width));
  const ph = Math.max(1, Math.round(rect.height));
  if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${pw} ${ph}`);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (svg.querySelector("image, use") || svg.querySelector("[*|href]")) {
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  }
  clone.setAttribute("width", pw);
  clone.setAttribute("height", ph);
  const body = new XMLSerializer().serializeToString(clone);
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\r\n${body}`;
}

// Rasterize a serialized SVG string to PNG bytes via Image → canvas → toBlob (the
// pre-365 fallback blip). Async — the Image must load the SVG data URI first.
function pptxSvgToPng(svgStr, w, h, scale) {
  return new Promise((resolve, reject) => {
    const s = scale || 2; // 2× the on-slide box for crisp fallback
    const pw = Math.max(1, Math.round((w || 1) * s));
    const ph = Math.max(1, Math.round((h || 1) * s));
    const uri = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgStr)));
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = pw; canvas.height = ph;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, pw, ph);
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error("pptx svg→png: toBlob returned null")); return; }
          const fr = new FileReader();
          fr.onload = () => resolve(new Uint8Array(fr.result));
          fr.onerror = () => reject(fr.error || new Error("pptx svg→png: read failed"));
          fr.readAsArrayBuffer(blob);
        }, "image/png");
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error("pptx svg→png: SVG image failed to load"));
    img.src = uri;
  });
}

// Fill each svg entry's `pngFallback` (async). Call on page.svgs after
// pptxExtractSlidePage() and before buildPptx(). Failures are non-fatal — an entry
// with no pngFallback still emits a (degraded) plain-SVG picture in buildPptx.
async function pptxRasterizeSvgs(svgs, opts) {
  opts = opts || {};
  for (const s of svgs || []) {
    if (!s || !s.svg || s.pngFallback) continue;
    try {
      s.pngFallback = await pptxSvgToPng(s.svg, s.w, s.h, opts.scale);
    } catch (e) {
      if (typeof console !== "undefined") console.warn("[pptx] svg raster fallback skipped:", e && e.message);
    }
  }
  return svgs;
}

// Walk every inline <svg> in the container → [{x,y,w,h, svg, alt}] (geometry in
// 960×540 px space, mirroring extractSVGs' bounding-box + container clip). No
// pngFallback yet — that is filled asynchronously by pptxRasterizeSvgs(). Applies the
// same visibility / zoom-badge hygiene as the other extractors.
function pptxExtractSVGEntries(container, containerRect) {
  const out = [];
  const cw = containerRect.width, ch = containerRect.height;
  container.querySelectorAll("svg").forEach((svg) => {
    // Serialize only the outermost <svg> (skip an <svg> nested inside another).
    if (svg.parentElement && svg.parentElement.closest("svg")) return;
    if (svg.closest("[data-zoom-badge]") || svg.closest("[data-no-pdf]")) return;
    if (_isExportHidden(window.getComputedStyle(svg))) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    let x = rect.left - containerRect.left;
    let y = rect.top - containerRect.top;
    const w = rect.width, h = rect.height;
    if (x + w < 0 || x > cw || y + h < 0 || y > ch) return; // fully off-slide
    let svgStr;
    try { svgStr = pptxSerializeSvg(svg); } catch (e) { return; }
    if (!svgStr || svgStr.indexOf("<svg") < 0) return;
    out.push({ x, y, w, h, svg: svgStr, alt: svg.getAttribute("aria-label") || "diagram" });
  });
  return out;
}

// ── native table extraction ──────────────────────────────────────────────────
// Detect `table` blocks in the rendered DOM and lift them to native-table IR.
// part-blocks.jsx wraps EVERY rendered block in `<div data-block-type={b.type}>`
// (both its editable and non-editable render branches), so a `table` block's DOM
// root is reliably marked `data-block-type="table"` — independent of its internal
// border/grid styling. That wrapper carries no layout/border of its own; the
// actual bordered grid structure is its single rendered child (case "table" in
// part-blocks.jsx). Header row = the first row with no top border (the renderer
// gives body rows a `borderTop`, the header none).
function pptxExtractTables(container, containerRect) {
  const tables = [];
  const cw = containerRect.width, ch = containerRect.height;
  const colsOf = (el) => {
    const t = window.getComputedStyle(el).gridTemplateColumns;
    return t && t !== "none" ? t.trim().split(/\s+/).filter(Boolean).length : 0;
  };
  container.querySelectorAll('[data-block-type="table"]').forEach((wrapEl) => {
    if (_isExportHidden(window.getComputedStyle(wrapEl))) return;

    const rect = wrapEl.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const x = rect.left - containerRect.left, y = rect.top - containerRect.top;
    const w = rect.width, h = rect.height;
    if (x + w < 0 || x > cw || y + h < 0 || y > ch) return;

    // Border color/width come from the table's own rendered root (for the OOXML
    // outline) — not used as a detection signal now that discovery is exact.
    const tableRoot = wrapEl.firstElementChild || wrapEl;
    const ts = window.getComputedStyle(tableRoot);
    const brdW = parseFloat(ts.borderTopWidth) || 0;
    const brdColor = parseColor(ts.borderTopColor) || parseColor(ts.borderColor);

    const rows = Array.from(tableRoot.children).filter((el) => {
      const d = window.getComputedStyle(el).display;
      return d === "grid" || d === "inline-grid";
    });
    if (!rows.length) return;
    const cols = colsOf(rows[0]);

    const outRows = rows.map((rowEl, ri) => {
      const rs = window.getComputedStyle(rowEl);
      const rowRect = rowEl.getBoundingClientRect();
      const noTopBorder = (parseFloat(rs.borderTopWidth) || 0) < 0.5;
      const header = ri === 0 && noTopBorder;
      const rowBg = parseColor(rs.backgroundColor);
      const cells = [];
      for (const cellEl of rowEl.children) {
        const cs = window.getComputedStyle(cellEl);
        let text = (cellEl.textContent || "").replace(/\s+/g, " ").trim();
        const tt = cs.textTransform;
        if (tt === "uppercase") text = text.toUpperCase();
        else if (tt === "lowercase") text = text.toLowerCase();
        cells.push({
          text,
          color: parseColor(cs.color),
          fontWeight: parseInt(cs.fontWeight) || 400,
          // Apply the fitScale shrink-to-fit factor to the font, same as the text-box
          // extractor. Geometry (x/y/w/h, row heights) comes from getBoundingClientRect
          // and is already scaled, but getComputedStyle().fontSize is NOT — so without
          // this the cell text emits full-size on a shrunk slide, growing rows past
          // their region and overflowing the blocks below.
          fontSize: (parseFloat(cs.fontSize) || 14) * getVisualScale(cellEl, container),
          align: cs.textAlign || "left",
          fontFamily: cs.fontFamily || "",
        });
      }
      return { header, bg: rowBg, h: rowRect.height, cells };
    });
    tables.push({ x, y, w, h, cols, rows: outRows, borderColor: brdColor, borderWidth: brdW, _rect: { x, y, w, h } });
  });
  return tables;
}

// ── image-block extraction ───────────────────────────────────────────────────
// Walk every rendered <img> → embedded-picture IR (geometry in 960×540 px space).
// data: URIs decode to bytes inline (the common Vela case — pasted images); other
// srcs keep `.src` for the async pptxResolveImages() pass. Same visibility/zoom
// hygiene as the other extractors.
function pptxExtractImages(container, containerRect) {
  const out = [];
  const cw = containerRect.width, ch = containerRect.height;
  container.querySelectorAll("img").forEach((img) => {
    if (img.closest("[data-zoom-badge]") || img.closest("[data-no-pdf]")) return;
    if (_isExportHidden(window.getComputedStyle(img))) return;
    const src = img.currentSrc || img.src;
    if (!src) return;
    const rect = img.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    let x = rect.left - containerRect.left, y = rect.top - containerRect.top;
    const w = rect.width, h = rect.height;
    if (x + w < 0 || x > cw || y + h < 0 || y > ch) return;
    const entry = { x, y, w, h, src, alt: img.getAttribute("alt") || "image" };
    const d = pptxDataUriToBytes(src);
    if (d && d.ext !== "webp") { entry.data = d.data; entry.ext = d.ext; }
    out.push(entry);
  });
  return out;
}

// Whole-slide raster hybrid — mirrors the vector-PDF `slideHasImages` fallback
// (part-pdf.jsx): image-heavy slides can't be faithfully lifted to native shapes,
// so the ENTIRE slide is captured as one full-bleed JPEG picture (page.imageData,
// which buildPptx already emits full-bleed). Async (canvas capture); the caller
// invokes this INSTEAD of pptxExtractSlidePage for slides where slideHasImages()
// is true. Links stay native/clickable over the raster.
async function pptxCaptureSlideRaster(el, slide, opts) {
  opts = opts || {};
  const containerRect = el.getBoundingClientRect();
  const slideBg = (slide && (slide.bgGradient || slide.bg)) || null;
  const canvas = await domToCanvas(el, PPTX_SLIDE_W, PPTX_SLIDE_H, opts.scale || 3, slideBg);
  const imageData = await canvasToJpegBytes(canvas, opts.quality || 0.95);
  const links = (typeof extractLinks === "function") ? extractLinks(el, containerRect) : [];
  return { w: PPTX_SLIDE_W, h: PPTX_SLIDE_H, imageData, links };
}

// Extract one page IR from an already-rendered off-screen slide container (the
// element carrying <SlideContent>, sized 960×540, class "no-anim vela-pdf-capture").
// This is what a PptxExportModal (PPTX-5) calls per slide before buildPptx().
// Reuses the part-pdf.jsx extractors as-is (fitScale already baked into the DOM).
// NB: `svgs` entries carry serialized markup but NO pngFallback yet — the caller must
// `await pptxRasterizeSvgs(page.svgs)` before buildPptx() to embed the PNG fallback.
function pptxExtractSlidePage(el, containerRect, slide) {
  const rawBgStr = pptxSetCompositeBg(slide, el);
  const slideBg = parseColor((slide && slide.bg) || rawBgStr) || parseColor("#0a0f1c");
  const slideGrad = parseLinearGradient((slide && slide.bgGradient) || rawBgStr) || null;

  // Native tables first, so their cell backgrounds/borders/text (otherwise picked
  // up as generic boxes + text boxes) are excluded — the <a:tbl> owns that region.
  const tables = pptxExtractTables(el, containerRect);
  const tableRects = tables.map((t) => t._rect);
  const inTable = (cx, cy) => tableRects.some((r) => cx >= r.x - 1 && cx <= r.x + r.w + 1 && cy >= r.y - 1 && cy <= r.y + r.h + 1);

  let boxes = extractBoxes(el, containerRect);
  let circles = extractCircles(el, containerRect);
  let texts = pptxExtractTextBoxes(el, containerRect);
  if (tableRects.length) {
    boxes = boxes.filter((b) => !inTable(b.x + b.w / 2, b.y + b.h / 2));
    texts = texts.filter((t) => !inTable(t.x + t.w / 2, t.y + t.h / 2));
    circles = circles.filter((c) => !inTable(c.cx, c.cy));
  }

  return {
    w: PPTX_SLIDE_W,
    h: PPTX_SLIDE_H,
    bg: slideBg,
    bgGradient: slideGrad,
    boxes,
    circles,
    texts,
    tables,
    images: pptxExtractImages(el, containerRect),
    svgs: pptxExtractSVGEntries(el, containerRect),
    links: extractLinks(el, containerRect),
  };
}
