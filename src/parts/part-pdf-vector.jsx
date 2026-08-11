// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
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

