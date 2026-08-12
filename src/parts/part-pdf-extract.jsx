// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
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

