// ============================================================================
// part-pptximport.jsx — browser-native PowerPoint (.pptx) -> Vela deck importer.
//
// Public entry: pptxToVelaDeck(arrayBuffer) -> Promise<{ deckTitle, lanes:[...] }>
// Produces a FULL-format Vela deck (the app's LOAD path consumes full format).
//
// Semantic RE-FLOW, not pixel mapping: pptx shapes are absolutely positioned;
// Vela is flow-stacked (no x/y/w/h). EMU geometry is parsed and used ONLY for
// reading-order + spatial clustering (columns / cards / grids / icon binding),
// then DISCARDED. Ported from the geometry-aware Python reference (v2).
//
// Zero-loss invariant: every visible text character and every raster image in
// the source appears in the output. Charts / SmartArt are text-extracted (never
// emitted as an opaque placeholder). Speaker notes -> slide.notes.
//
// Browser-native only: hand-rolled ZIP reader + DecompressionStream('deflate-raw'),
// native DOMParser, btoa. No imports/exports (concat-stripped); ALL helpers are
// prefixed `_ppx`/`_PPX_` to avoid duplicate top-level declarations.
//
// SECURITY NOTE: native DOMParser does not fetch external entities. Nested
// internal-entity expansion (billion-laughs) remains a DoS vector on hostile
// input; emitted text/media still pass through Vela's deck sanitizers on LOAD.
// ============================================================================

const _PPX_VIRTUAL_W = 960;
const _PPX_VIRTUAL_H = 540;
const _PPX_EMU_PER_PX = 12700; // 1 canvas px = 12700 EMU (== 1pt)

const _PPX_SIZE_TOKENS = [["xs", 12], ["sm", 14], ["md", 17], ["lg", 20],
  ["xl", 26], ["2xl", 35], ["3xl", 46], ["4xl", 56]];

// raster mimes we can inline (task contract: png/jpeg/gif/webp only). EMF/WMF/SVG
// are dropped — the deck sanitizer's raster allowlist is the same subset.
const _PPX_RASTER_MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp" };
const _PPX_UNRENDERABLE = new Set(["emf", "wmf", "x-emf", "x-wmf", "svg", "svgz"]);

// ---- LAYOUT_CONST: every value is a FRACTION of the slide's own W/H, a RATIO
//      between shapes, or a dimensionless count. No absolute px/EMU tied to a deck.
const _PPX_TITLE_BAND = 0.24;
const _PPX_FOOTER_BAND = 0.88;
const _PPX_BAND_TOL = 0.03;
const _PPX_CARD_MIN_W = 0.06;
const _PPX_CARD_MIN_H = 0.075;
const _PPX_COL_GAP_MIN = 0.03;
const _PPX_FULLW_COL_FRAC = 0.60;
const _PPX_COL_BAND_SEP = 0.25;
const _PPX_COL_MIN_SHARE = 0.12;
const _PPX_COL_CENTER_MAX = 0.20;
const _PPX_HEADING_RATIO = 1.22;
const _PPX_SUBTITLE_RATIO = 1.15;
const _PPX_SUBTITLE_MIN_W = 0.12;
const _PPX_SQUARE_TOL = 0.28;
const _PPX_CYCLE_RADIAL_CV = 0.30;
const _PPX_CYCLE_MAX_ANG_GAP = 160;
const _PPX_MIN_CONTRAST = 2.0;
const _PPX_SOFT_CONTRAST = 4.0;
const _PPX_GREY_SAT = 0.35;
const _PPX_CARD_ACCENT_W = "4px";
const _PPX_CHROME_ICON_W = 0.06;
const _PPX_CHROME_ICON_H = 0.09;
const _PPX_ICON_OVERLAP = 0.60;
const _PPX_ICON_BIND_W = 0.055;
const _PPX_ICON_BIND_H = 0.095;
const _PPX_ICON_ABOVE_V = 0.055;
const _PPX_PILL_MAX_H = 0.05;
const _PPX_TAG_MIN = 3;
const _PPX_CYCLE_MIN = 3;
const _PPX_CYCLE_MAX = 7;
const _PPX_GRID_MAX_COLS = 3;
const _PPX_SHORT_LABEL_CHARS = 24;
const _PPX_ROWS_MIN = 3;
const _PPX_CELL_MERGE_X = 0.055;
const _PPX_CELL_MERGE_Y = 0.070;
const _PPX_HBIND_Y = 0.030;
const _PPX_HBIND_GAP = 0.035;
const _PPX_CONNECTOR_MAX = 0.055;
const _PPX_CELL_FULLW = 0.55;
const _PPX_ROW_SPREAD_MIN = 0.30;
const _PPX_DOMINANT_SPREAD = 0.50;
const _PPX_ROW_BAND_TOL = 0.055;
const _PPX_COL_ALIGN_TOL = 0.055;
const _PPX_MIN_ROW_CELLS = 3;
const _PPX_BAND_XGAP_RATIO = 2.5;
const _PPX_BAND_XGAP_MIN = 0.10;
const _PPX_BG_COVER = 0.95;
const _PPX_BG_ORIGIN = 0.03;

// ============================================================================
// 1. Unzip — hand-rolled ZIP central-directory reader + DecompressionStream.
//    pptx entries are STORE (method 0) or raw-DEFLATE (method 8). Everything is
//    pre-decompressed up front into a { name: Uint8Array } map so the rest of the
//    pipeline stays synchronous.
// ============================================================================
async function _ppxInflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

async function _ppxUnzip(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8.length < 22) throw new Error("pptx import: file too small to be a zip");
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const out = {};

  // Locate End Of Central Directory (PK\x05\x06), scanning from the tail.
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("pptx import: not a zip (no EOCD record)");

  const cdCount = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const jobs = [];

  for (let n = 0; n < cdCount; n++) {
    if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) break; // PK\x01\x02
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));

    // The local header carries its own name/extra lengths (may differ from the CD).
    const lhNameLen = dv.getUint16(localOff + 26, true);
    const lhExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
    const comp = u8.subarray(dataStart, dataStart + compSize);

    if (method === 0) {
      out[name] = comp.slice(); // STORE
    } else if (method === 8) {
      jobs.push(_ppxInflateRaw(comp).then((b) => { out[name] = b; }));
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  await Promise.all(jobs);
  return out;
}

function _ppxMakeZip(entries) {
  return {
    names: () => Object.keys(entries),
    has: (name) => Object.prototype.hasOwnProperty.call(entries, name),
    bytes: (name) => entries[name],
    text: (name) => new TextDecoder("utf-8").decode(entries[name]),
  };
}

// ============================================================================
// 2. XML — native DOMParser + namespace-agnostic (match by localName) helpers.
// ============================================================================
function _ppxParseXml(str) {
  return new DOMParser().parseFromString(str, "application/xml");
}

function _ppxKids(el, name) {
  const out = [];
  if (!el) return out;
  for (const c of el.children) if (c.localName === name) out.push(c);
  return out;
}

function _ppxKid(el, name) {
  if (!el) return null;
  for (const c of el.children) if (c.localName === name) return c;
  return null;
}

function _ppxDescend(el, name) {
  if (!el) return null;
  const walk = (node) => {
    if (node.localName === name) return node;
    for (const c of node.children) { const r = walk(c); if (r) return r; }
    return null;
  };
  for (const c of el.children) { const r = walk(c); if (r) return r; }
  return null;
}

function _ppxDescendAll(el, name) {
  const out = [];
  if (!el) return out;
  const walk = (node) => {
    if (node.localName === name) out.push(node);
    for (const c of node.children) walk(c);
  };
  for (const c of el.children) walk(c);
  return out;
}

function _ppxAttr(el, name) {
  if (!el) return null;
  for (const a of el.attributes) if (a.localName === name) return a.value;
  return null;
}

// r:id / r:embed etc. — a namespaced "id" (localName id, but prefixed so name!=="id").
function _ppxRelId(el) {
  if (!el) return null;
  for (const a of el.attributes) if (a.localName === "id" && a.name !== "id") return a.value;
  return null;
}

// ============================================================================
// 3. Color model — clrScheme + clrMap indirection, luminance fallback.
// ============================================================================
function _ppxParseClrScheme(themeXml) {
  const out = {};
  const root = _ppxParseXml(themeXml).documentElement;
  const sch = _ppxDescend(root, "clrScheme");
  if (!sch) return out;
  for (const c of sch.children) {
    const srgb = _ppxKid(c, "srgbClr");
    const sysc = _ppxKid(c, "sysClr");
    if (srgb) out[c.localName] = _ppxAttr(srgb, "val");
    else if (sysc) out[c.localName] = _ppxAttr(sysc, "lastClr") || "000000";
  }
  return out;
}

function _ppxResolveColor(clrParent, scheme, clrmap) {
  if (!clrParent) return null;
  const srgb = _ppxDescend(clrParent, "srgbClr");
  if (srgb) return "#" + _ppxAttr(srgb, "val");
  const sysc = _ppxDescend(clrParent, "sysClr");
  if (sysc) return "#" + (_ppxAttr(sysc, "lastClr") || "000000");
  const sc = _ppxDescend(clrParent, "schemeClr");
  if (sc) {
    const val = _ppxAttr(sc, "val");
    const mapped = clrmap[val] || val;
    const hexv = scheme[mapped] || scheme[val];
    if (hexv) return "#" + hexv;
  }
  return null;
}

function _ppxLuminance(hexc) {
  try {
    const h = String(hexc).replace(/^#/, "");
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255);
  } catch (e) { return 0.5; }
}

// ============================================================================
// 4. OPC relationship plumbing (posix path resolution, no filesystem).
// ============================================================================
function _ppxNormalizeJoin(dir, tgt) {
  const parts = (dir ? dir + "/" + tgt : tgt).split("/");
  const stack = [];
  for (const seg of parts) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") stack.pop();
    else stack.push(seg);
  }
  return stack.join("/");
}

function _ppxLoadRels(zip, partPath) {
  const slash = partPath.lastIndexOf("/");
  const d = slash >= 0 ? partPath.slice(0, slash) : "";
  const base = slash >= 0 ? partPath.slice(slash + 1) : partPath;
  const relsPath = d ? `${d}/_rels/${base}.rels` : `_rels/${base}.rels`;
  const out = {};
  if (!zip.has(relsPath)) return out;
  const root = _ppxParseXml(zip.text(relsPath)).documentElement;
  if (!root) return out;
  for (const rel of root.children) {
    const rid = _ppxAttr(rel, "Id");
    const typ = _ppxAttr(rel, "Type") || "";
    const tgt = _ppxAttr(rel, "Target") || "";
    if (_ppxAttr(rel, "TargetMode") === "External") out[rid] = { type: typ, target: tgt, external: true };
    else out[rid] = { type: typ, target: _ppxNormalizeJoin(d, tgt), external: false };
  }
  return out;
}

// ============================================================================
// 5. Geometry + placeholder inheritance.
// ============================================================================
function _ppxUniScale(cx, cy) {
  return Math.min(_PPX_VIRTUAL_W / cx, _PPX_VIRTUAL_H / cy);
}

function _ppxGetXfrm(spPr) {
  if (!spPr) return null;
  const xf = _ppxKid(spPr, "xfrm");
  if (!xf) return null;
  const off = _ppxKid(xf, "off"), ext = _ppxKid(xf, "ext");
  if (!off || !ext) return null;
  return [parseInt(_ppxAttr(off, "x") || 0, 10), parseInt(_ppxAttr(off, "y") || 0, 10),
    parseInt(_ppxAttr(ext, "cx") || 1, 10), parseInt(_ppxAttr(ext, "cy") || 1, 10)];
}

function _ppxPhKey(sp) {
  const nv = _ppxDescend(sp, "nvSpPr");
  if (!nv) return null;
  const ph = _ppxDescend(nv, "ph");
  if (!ph) return null;
  return [_ppxAttr(ph, "type") || "body", _ppxAttr(ph, "idx") || ""];
}

function _ppxBuildPhGeometry(xmlText) {
  const out = {};
  const root = _ppxParseXml(xmlText).documentElement;
  const tree = _ppxDescend(root, "spTree");
  if (!tree) return out;
  for (const sp of _ppxKids(tree, "sp")) {
    const k = _ppxPhKey(sp);
    if (!k) continue;
    const g = _ppxGetXfrm(_ppxKid(sp, "spPr"));
    if (g) out[k[0] + " " + k[1]] = g;
  }
  return out;
}

// ============================================================================
// 6. Text run extraction.
// ============================================================================
function _ppxPtFromSz(sz) {
  const v = parseInt(sz, 10);
  return isNaN(v) ? null : v / 100.0;
}

function _ppxExtractParagraphs(txBody) {
  const paras = [];
  if (!txBody) return paras;
  for (const p of _ppxKids(txBody, "p")) {
    const pPr = _ppxKid(p, "pPr");
    const level = pPr ? (parseInt(_ppxAttr(pPr, "lvl") || 0, 10) || 0) : 0;
    let bullet = false;
    if (pPr) {
      if (_ppxKid(pPr, "buChar") || _ppxKid(pPr, "buAutoNum")) bullet = true;
      else if (_ppxKid(pPr, "buNone")) bullet = false;
    }
    const runs = [];
    for (const c of p.children) {
      if (c.localName === "r") {
        const tEl = _ppxKid(c, "t");
        if (!tEl || tEl.textContent == null) continue;
        const rPr = _ppxKid(c, "rPr");
        runs.push({
          text: tEl.textContent,
          bold: _ppxAttr(rPr, "b") === "1",
          italic: _ppxAttr(rPr, "i") === "1",
          color: rPr ? _ppxResolveColor(_ppxKid(rPr, "solidFill"), _ppxCtx.scheme, _ppxCtx.clrmap) : null,
          pt: rPr ? _ppxPtFromSz(_ppxAttr(rPr, "sz")) : null,
        });
      } else if (c.localName === "fld") {
        const tEl = _ppxKid(c, "t");
        if (tEl && tEl.textContent) runs.push({ text: tEl.textContent, bold: false, italic: false, color: null, pt: null });
      }
    }
    const plain = runs.map((r) => r.text).join("");
    let inline = "";
    for (const r of runs) {
      let t = r.text;
      if (!t.trim()) { inline += t; continue; }
      if (r.bold && r.italic) t = "***" + t + "***";
      else if (r.bold) t = "**" + t + "**";
      else if (r.italic) t = "*" + t + "*";
      inline += t;
    }
    paras.push({ runs, bullet, level, text: plain, inline });
  }
  return paras;
}

function _ppxTokenForPt(pt) {
  if (pt == null) return "md";
  let best = _PPX_SIZE_TOKENS[0][0];
  for (const [name, px] of _PPX_SIZE_TOKENS) if (pt >= px - 2) best = name;
  return best;
}

function _ppxMaxPt(paras) {
  let m = null;
  for (const p of paras) for (const r of p.runs) if (r.pt && (m == null || r.pt > m)) m = r.pt;
  return m;
}

function _ppxParaAlgn(txBody) {
  const out = [];
  if (!txBody) return out;
  const map = { ctr: "center", r: "right", just: "left" };
  for (const p of _ppxKids(txBody, "p")) {
    const pPr = _ppxKid(p, "pPr");
    const a = pPr ? _ppxAttr(pPr, "algn") : null;
    out.push(map[a] || "left");
  }
  return out;
}

// ============================================================================
// 7. Table parse (string cells only — Vela table limit).
// ============================================================================
function _ppxParseTable(tbl) {
  const rows = [];
  for (const tr of _ppxKids(tbl, "tr")) {
    const cells = [];
    for (const tc of _ppxKids(tr, "tc")) {
      const paras = _ppxExtractParagraphs(_ppxDescend(tc, "txBody"));
      cells.push(paras.map((p) => p.text).join(" ").trim());
    }
    rows.push(cells);
  }
  if (!rows.length) return { headers: [], rows: [] };
  return { headers: rows[0], rows: rows.slice(1) };
}

function _ppxSlideBg(sld) {
  const cSld = _ppxDescend(sld, "cSld");
  const bg = cSld ? _ppxKid(cSld, "bg") : null;
  if (!bg) return null;
  return _ppxResolveColor(_ppxDescend(bg, "solidFill") || bg, _ppxCtx.scheme, _ppxCtx.clrmap);
}

// ============================================================================
// 8. Chart / SmartArt TEXT extraction (net-new — no visual placeholder).
//    Goal: zero visible text lost. Build a table/bullets, then sweep every
//    remaining <a:t>/<c:v> token so nothing is dropped.
// ============================================================================
function _ppxUniq(arr) {
  const seen = new Set(), out = [];
  for (const x of arr) if (!seen.has(x)) { seen.add(x); out.push(x); }
  return out;
}

function _ppxAllTokens(root) {
  const out = [];
  for (const tag of ["t", "v"]) for (const el of _ppxDescendAll(root, tag)) {
    const x = (el.textContent || "").trim();
    if (x) out.push(x);
  }
  return out;
}

function _ppxLosslessAppend(blocks, root) {
  const emitted = JSON.stringify(blocks);
  const missing = _ppxUniq(_ppxAllTokens(root)).filter((x) => emitted.indexOf(x) === -1);
  if (missing.length) blocks.push({ type: "bullets", items: missing.slice(0, 60), size: "sm" });
}

function _ppxChartBlocks(root) {
  const blocks = [];
  const titleEl = _ppxDescend(root, "title");
  const title = titleEl ? _ppxUniq(_ppxDescendAll(titleEl, "t").map((t) => t.textContent || "")).join(" ").trim() : "";
  const sers = _ppxDescendAll(root, "ser");

  let cats = [];
  for (const ser of sers) {
    const cat = _ppxDescend(ser, "cat");
    if (cat) {
      const pts = _ppxDescendAll(cat, "pt");
      cats = (pts.length ? pts.map((pt) => { const v = _ppxDescend(pt, "v"); return v ? v.textContent : ""; })
        : _ppxDescendAll(cat, "v").map((v) => v.textContent || ""));
      if (cats.length) break;
    }
  }
  const series = sers.map((ser) => {
    const txEl = _ppxDescend(ser, "tx");
    let name = txEl ? _ppxDescendAll(txEl, "v").map((v) => v.textContent || "").join(" ").trim() : "";
    if (!name && txEl) name = _ppxDescendAll(txEl, "t").map((t) => t.textContent || "").join(" ").trim();
    const valEl = _ppxDescend(ser, "val");
    let vals = [];
    if (valEl) {
      const pts = _ppxDescendAll(valEl, "pt");
      vals = pts.length ? pts.map((pt) => { const v = _ppxDescend(pt, "v"); return v ? v.textContent : ""; })
        : _ppxDescendAll(valEl, "v").map((v) => v.textContent || "");
    }
    return { name, vals };
  });

  if (title) blocks.push({ type: "heading", text: title, size: "md" });
  if (cats.length && series.length) {
    const headers = ["", ...series.map((s) => s.name || "Series")];
    const rows = cats.map((c, i) => [c, ...series.map((s) => (s.vals[i] != null ? String(s.vals[i]) : ""))]);
    blocks.push({ type: "table", headers, rows, striped: true });
  } else if (series.length && series.some((s) => s.vals.length)) {
    const rows = series.map((s) => [s.name || "Series", ...s.vals.map((v) => String(v))]);
    blocks.push({ type: "table", headers: [], rows, striped: true });
  }
  _ppxLosslessAppend(blocks, root);
  return blocks;
}

function _ppxSmartArtBlocks(root) {
  const toks = _ppxUniq(_ppxDescendAll(root, "t").map((t) => (t.textContent || "").trim()).filter(Boolean));
  if (!toks.length) return [];
  return [{ type: "bullets", items: toks.slice(0, 60), size: "sm" }];
}

function _ppxGraphicBlocks(shape, zip, srels) {
  try {
    if (shape.chartRid && srels[shape.chartRid]) {
      const tgt = srels[shape.chartRid].target;
      if (zip.has(tgt)) return _ppxChartBlocks(_ppxParseXml(zip.text(tgt)).documentElement);
    }
    if (shape.dmRid && srels[shape.dmRid]) {
      const tgt = srels[shape.dmRid].target;
      if (zip.has(tgt)) return _ppxSmartArtBlocks(_ppxParseXml(zip.text(tgt)).documentElement);
    }
  } catch (e) { /* fall through to placeholder */ }
  return [];
}

// ============================================================================
// 9. Speaker notes (net-new): rels type .../notesSlide -> body placeholder text.
// ============================================================================
function _ppxExtractNotes(zip, srels) {
  for (const rid in srels) {
    const rel = srels[rid];
    if (!rel || rel.external || !/\/notesSlide$/.test(rel.type)) continue;
    if (!zip.has(rel.target)) continue;
    const root = _ppxParseXml(zip.text(rel.target)).documentElement;
    const tree = _ppxDescend(root, "spTree");
    if (!tree) return "";
    // prefer the body placeholder; fall back to any text-bearing sp that isn't
    // date/slide-number chrome.
    let bodyText = "", anyText = "";
    for (const sp of _ppxKids(tree, "sp")) {
      const k = _ppxPhKey(sp);
      const paras = _ppxExtractParagraphs(_ppxDescend(sp, "txBody"));
      const txt = paras.map((p) => p.text).filter((t) => t.trim()).join("\n").trim();
      if (!txt) continue;
      const type = k ? k[0] : "";
      if (type === "body") bodyText += (bodyText ? "\n" : "") + txt;
      else if (type !== "dt" && type !== "sldNum" && type !== "ftr") anyText += (anyText ? "\n" : "") + txt;
    }
    const raw = bodyText || anyText;
    if (!raw) return "";
    // basic sanitization: strip control chars, cap length (deck sanitizer re-checks).
    return raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").slice(0, 4000);
  }
  return "";
}

// ============================================================================
// 10. Geometry-retaining shape collection (recurses groups w/ coord transform).
// ============================================================================
function _ppxLineColor(spPr) {
  if (!spPr) return null;
  const ln = _ppxKid(spPr, "ln");
  if (!ln) return null;
  const sf = _ppxKid(ln, "solidFill");
  return sf ? _ppxResolveColor(sf, _ppxCtx.scheme, _ppxCtx.clrmap) : null;
}

function _ppxXfrmOf(node, spPr) {
  const g = _ppxGetXfrm(spPr);
  if (g) return g;
  const xf = _ppxDescend(node, "xfrm");
  if (xf) {
    const off = _ppxKid(xf, "off"), ext = _ppxKid(xf, "ext");
    if (off && ext) return [parseInt(_ppxAttr(off, "x") || 0, 10), parseInt(_ppxAttr(off, "y") || 0, 10),
      parseInt(_ppxAttr(ext, "cx") || 1, 10), parseInt(_ppxAttr(ext, "cy") || 1, 10)];
  }
  return null;
}

function _ppxApply(geo, xform) {
  if (!xform) return geo;
  return xform(geo);
}

function _ppxCollectShapes(tree, phGeo, out, xform) {
  if (!tree) return;
  const scheme = _ppxCtx.scheme, clrmap = _ppxCtx.clrmap;
  for (const node of tree.children) {
    const ln = node.localName;
    if (ln === "sp") {
      const spPr = _ppxKid(node, "spPr");
      const k = _ppxPhKey(node);
      let geo = _ppxXfrmOf(node, spPr);
      if (!geo && k) geo = phGeo[k[0] + " " + k[1]];
      if (!geo) geo = [0, 0, 1, 1];
      const [x, y, w, h] = _ppxApply(geo, xform);
      const txBody = _ppxDescend(node, "txBody");
      const paras = _ppxExtractParagraphs(txBody);
      const fill = spPr ? _ppxResolveColor(_ppxKid(spPr, "solidFill"), scheme, clrmap) : null;
      let gradfill = null;
      if (spPr) {
        const gf = _ppxDescend(spPr, "gradFill");
        if (gf) { const stops = _ppxDescendAll(gf, "gs"); if (stops.length) gradfill = _ppxResolveColor(stops[0], scheme, clrmap); }
      }
      const prstEl = spPr ? _ppxDescend(spPr, "prstGeom") : null;
      const prst = prstEl ? _ppxAttr(prstEl, "prst") : null;
      const hasText = paras.some((p) => p.text.trim());
      out.push({
        kind: hasText ? "text" : "decor", x, y, w, h, paras, aligns: _ppxParaAlgn(txBody),
        fill, gradfill, line: _ppxLineColor(spPr), prst,
        is_title: !!(k && String(k[0] || "").indexOf("itle") !== -1), is_ph: k != null,
        cx_c: x + w / 2, cy_c: y + h / 2,
      });
    } else if (ln === "pic") {
      const spPr = _ppxKid(node, "spPr");
      const geo = _ppxXfrmOf(node, spPr) || [0, 0, 1, 1];
      const [x, y, w, h] = _ppxApply(geo, xform);
      const blip = _ppxDescend(node, "blip");
      const rid = blip ? _ppxAttr(blip, "embed") : null; // r:embed (localName "embed")
      const cNvPr = _ppxDescend(node, "cNvPr");
      const alt = cNvPr ? (_ppxAttr(cNvPr, "descr") || _ppxAttr(cNvPr, "name")) : null;
      out.push({ kind: "pic", x, y, w, h, rid, alt, cx_c: x + w / 2, cy_c: y + h / 2 });
    } else if (ln === "graphicFrame") {
      const geo = _ppxXfrmOf(node, null) || [0, 0, 1, 1];
      const [x, y, w, h] = _ppxApply(geo, xform);
      const tbl = _ppxDescend(node, "tbl");
      if (tbl) {
        out.push({ kind: "table", x, y, w, h, table: _ppxParseTable(tbl), cx_c: x + w / 2, cy_c: y + h / 2 });
      } else {
        const chartEl = _ppxDescend(node, "chart");
        const relIds = _ppxDescend(node, "relIds"); // dgm:relIds (SmartArt data model)
        out.push({
          kind: "chart", x, y, w, h,
          chartRid: chartEl ? _ppxRelId(chartEl) : null,
          dmRid: relIds ? _ppxAttr(relIds, "dm") : null,
          cx_c: x + w / 2, cy_c: y + h / 2,
        });
      }
    } else if (ln === "grpSp") {
      const grpSpPr = _ppxKid(node, "grpSpPr");
      const xf = grpSpPr ? _ppxKid(grpSpPr, "xfrm") : null;
      let childXform = xform;
      if (xf) {
        const off = _ppxKid(xf, "off"), ext = _ppxKid(xf, "ext"),
          choff = _ppxKid(xf, "chOff"), chext = _ppxKid(xf, "chExt");
        if (off && ext && choff && chext) {
          const gx = parseInt(_ppxAttr(off, "x") || 0, 10), gy = parseInt(_ppxAttr(off, "y") || 0, 10);
          const gw = parseInt(_ppxAttr(ext, "cx") || 1, 10), gh = parseInt(_ppxAttr(ext, "cy") || 1, 10);
          const cox = parseInt(_ppxAttr(choff, "x") || 0, 10), coy = parseInt(_ppxAttr(choff, "y") || 0, 10);
          const cw = parseInt(_ppxAttr(chext, "cx") || 1, 10), ch = parseInt(_ppxAttr(chext, "cy") || 1, 10);
          const sx = gw / (cw || 1), sy = gh / (ch || 1);
          const base = xform;
          childXform = (g) => _ppxApply([gx + (g[0] - cox) * sx, gy + (g[1] - coy) * sy, g[2] * sx, g[3] * sy], base);
        }
      }
      _ppxCollectShapes(node, phGeo, out, childXform);
    }
  }
}

// ============================================================================
// 11. Geometry predicates.
// ============================================================================
function _ppxContains(outer, inner, W, H) {
  return (outer.x - 0.005 * W <= inner.cx_c && inner.cx_c <= outer.x + outer.w + 0.005 * W &&
    outer.y - 0.005 * H <= inner.cy_c && inner.cy_c <= outer.y + outer.h + 0.005 * H);
}

function _ppxOverlapFrac(outer, inner) {
  const ia = Math.max(inner.w || 0, 0) * Math.max(inner.h || 0, 0);
  if (ia <= 0) return 0;
  const iw = Math.max(0, Math.min(outer.x + outer.w, inner.x + inner.w) - Math.max(outer.x, inner.x));
  const ih = Math.max(0, Math.min(outer.y + outer.h, inner.y + inner.h) - Math.max(outer.y, inner.y));
  return (iw * ih) / ia;
}

function _ppxPicInCard(card, pic, W, H) {
  return _ppxContains(card, pic, W, H) || _ppxOverlapFrac(card, pic) >= _PPX_ICON_OVERLAP;
}

function _ppxSameBand(a, b, H) { return Math.abs(a.cy_c - b.cy_c) <= _PPX_BAND_TOL * H; }

function _ppxDetectBg(shapes, W, H) {
  const bgShapes = []; let color = null;
  for (const s of shapes) {
    if (s.kind !== "decor" && s.kind !== "text") continue;
    const full = (s.w >= _PPX_BG_COVER * W && s.h >= _PPX_BG_COVER * H && s.x <= _PPX_BG_ORIGIN * W && s.y <= _PPX_BG_ORIGIN * H);
    if (!full) continue;
    const col = s.fill || s.gradfill;
    if (!col) continue;
    if (color == null) color = col;
    bgShapes.push(s);
  }
  return { color, bgShapes };
}

// ============================================================================
// 12. Shape text helpers.
// ============================================================================
function _ppxShapeText(s, joiner) {
  joiner = joiner == null ? "\n" : joiner;
  return s.paras.map((p) => p.text).filter((t) => t.trim()).join(joiner).trim();
}

function _ppxShapeInline(s, joiner) {
  joiner = joiner == null ? "\n" : joiner;
  return s.paras.filter((p) => p.text.trim()).map((p) => p.inline).join(joiner).trim();
}

function _ppxShapeMaxpt(s) { return _ppxMaxPt(s.paras); }

function _ppxIsBulleted(s) {
  const real = s.paras.filter((p) => p.text.trim());
  const bl = real.filter((p) => p.bullet);
  return real.length > 0 && bl.length >= Math.max(1, Math.floor(real.length / 2));
}

const _PPX_UI_CTRL_LABELS = new Set(["copy", "copiar", "copiado", "copied", "copy code",
  "copiar codigo", "copiar código", "copiar code"]);

function _ppxIsUiChrome(txt) {
  const t = (txt || "").trim();
  if (!t) return false;
  if (t.length <= 2 && !/[a-z0-9]/i.test(t)) return true;
  const low = t.toLowerCase().replace(/^[ .:;·»«|-]+|[ .:;·»«|-]+$/g, "");
  return _PPX_UI_CTRL_LABELS.has(low) && t.split(/\s+/).length <= 2;
}

function _ppxPxFont(pt, fontScale, lo, hi) {
  lo = lo == null ? 9 : lo; hi = hi == null ? 64 : hi;
  if (!pt) return null;
  return Math.max(lo, Math.min(hi, Math.round(pt * fontScale)));
}

function _ppxDim(color) {
  const l = _ppxLuminance(color);
  return l > 0.5 ? "#94a3b8" : l < 0.5 ? "#64748b" : color;
}

// ============================================================================
// 13. Pill / chip annotation.
// ============================================================================
function _ppxAnnotatePills(shapes, W, H) {
  const decors = shapes.filter((d) => d.kind === "decor" && (d.fill || d.line) && d.h < _PPX_PILL_MAX_H * H);
  for (const s of shapes) {
    if (s.kind !== "text") continue;
    if ((s.fill || s.line) && s.h < _PPX_PILL_MAX_H * H) { s.pill = { fill: s.fill, line: s.line }; continue; }
    let best = null;
    for (const d of decors) {
      if (d === s || !_ppxContains(d, s, W, H)) continue;
      if (best == null || (d.w * d.h) < (best.w * best.h)) best = d;
    }
    if (best) s.pill = { fill: best.fill, line: best.line };
  }
}

function _ppxIsChipLabel(s) {
  if (!s || s.kind !== "text") return false;
  const t = _ppxShapeText(s, " ");
  return !!s.pill && t.length > 0 && t.length <= _PPX_SHORT_LABEL_CHARS &&
    t.split(/\s+/).length <= 3 && _ppxOrdinalOf(s) == null && !_ppxIsBulleted(s);
}

function _ppxBadgeBlock(s) {
  const pill = s.pill || {};
  const blk = { type: "badge", text: _ppxShapeText(s, " ") };
  if (pill.fill) { blk.bg = pill.fill; blk.color = _ppxLegibleOn(pill.fill); }
  else if (pill.line) { blk.border = pill.line; blk.color = pill.line; }
  return blk;
}

function _ppxDetectTagGroups(remaining, W, H, accent, notes) {
  const chips = remaining.filter(_ppxIsChipLabel);
  if (chips.length < _PPX_TAG_MIN) return { units: [], consumed: new Set() };
  const bands = [];
  for (const s of chips.slice().sort((a, b) => a.cy_c - b.cy_c)) {
    if (bands.length && Math.abs(s.cy_c - bands[bands.length - 1][bands[bands.length - 1].length - 1].cy_c) <= _PPX_ROW_BAND_TOL * H)
      bands[bands.length - 1].push(s);
    else bands.push([s]);
  }
  const groups = [];
  for (const b of bands) {
    b.sort((x, y) => x.cx_c - y.cx_c);
    const spread = b[b.length - 1].cx_c - b[0].cx_c;
    if (b.length >= _PPX_TAG_MIN && spread >= _PPX_ROW_SPREAD_MIN * W) {
      const last = groups.length ? groups[groups.length - 1] : null;
      if (last && (b[0].cy_c - last[last.length - 1][last[last.length - 1].length - 1].cy_c) <= 2.2 * _PPX_ROW_BAND_TOL * H)
        last.push(b);
      else groups.push([b]);
    }
  }
  const units = [], consumed = new Set();
  for (const g of groups) {
    const allchips = g.flat();
    const filled = allchips.filter((s) => (s.pill || {}).fill).length;
    const variant = filled >= allchips.length / 2 ? "filled" : "outline";
    const items = [];
    for (const s of allchips.slice().sort((a, b) => (a.cy_c - b.cy_c) || (a.cx_c - b.cx_c))) {
      const pill = s.pill || {};
      items.push({ text: _ppxShapeText(s, " "), color: pill.fill || pill.line || accent });
      consumed.add(s);
    }
    units.push([Math.min(...allchips.map((s) => s.y)), Math.min(...allchips.map((s) => s.x)),
      { type: "tag-group", items, variant, gap: 8, size: "sm" }]);
    notes.add("pill-backed peer labels -> tag-group");
  }
  return { units, consumed };
}

// ============================================================================
// 14. Image block.
// ============================================================================
function _ppxB64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

function _ppxImageBlock(s, deckMedia, stats, W) {
  const info = deckMedia[s.rid];
  if (!info) return null;
  const ext = (info.ext || "").toLowerCase();
  if (_PPX_UNRENDERABLE.has(ext)) { stats.dropped++; return null; }
  const mime = _PPX_RASTER_MIME[ext];
  if (!mime) { stats.dropped++; return null; }
  const blk = { type: "image", src: "data:" + mime + ";base64," + _ppxB64(info.bytes) };
  blk.maxWidth = Math.min(100, Math.floor(s.w / W * 100) + 2) + "%";
  const alt = (s.alt || "").trim(), low = alt.toLowerCase();
  const generic = new Set(["diagram", "image", "picture", "graphic", "icon", "logo", "shape", "photo", "img", "content placeholder"]);
  const firstWord = low.split(/\s+/)[0] || "";
  const isGeneric = (!alt || alt.indexOf("preencoded") !== -1 || generic.has(low) ||
    ["picture", "image", "graphic", "diagram", "icon"].indexOf(firstWord) !== -1 ||
    /^[0-9]+$/.test(low.replace(/\s+/g, "")));
  if (!isGeneric) blk.caption = alt;
  stats.clean++;
  return blk;
}

// ============================================================================
// 15. Cycle (radial ring) detection.
// ============================================================================
function _ppxDetectCycle(group, accent) {
  const labels = group.filter((s) => s.kind === "text" && _ppxShapeText(s, " ").length <= _PPX_SHORT_LABEL_CHARS);
  if (!(labels.length >= _PPX_CYCLE_MIN && labels.length <= _PPX_CYCLE_MAX)) return null;
  const W = _ppxCtx.W, H = _ppxCtx.H;
  const xs = labels.map((s) => s.cx_c), ys = labels.map((s) => s.cy_c);
  const spanx = Math.max(...xs) - Math.min(...xs), spany = Math.max(...ys) - Math.min(...ys);
  if (spanx <= 0 || spany <= 0) return null;
  if (Math.abs(spanx - spany) / Math.max(spanx, spany) > _PPX_SQUARE_TOL) return null;
  const cx0 = xs.reduce((a, b) => a + b, 0) / xs.length, cy0 = ys.reduce((a, b) => a + b, 0) / ys.length;
  const polar = labels.map((s) => {
    const dx = (s.cx_c - cx0) / W, dy = (s.cy_c - cy0) / H;
    return { ang: ((Math.atan2(dy, dx) * 180 / Math.PI) % 360 + 360) % 360, r: Math.hypot(dx, dy) };
  });
  const radii = polar.map((p) => p.r), meanR = radii.reduce((a, b) => a + b, 0) / radii.length;
  if (meanR <= 0) return null;
  const cv = Math.sqrt(radii.reduce((a, r) => a + (r - meanR) * (r - meanR), 0) / radii.length) / meanR;
  if (cv > _PPX_CYCLE_RADIAL_CV) return null;
  const angs = polar.map((p) => p.ang).sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 0; i < angs.length; i++) { const g = ((angs[(i + 1) % angs.length] - angs[i]) % 360 + 360) % 360; if (g > maxGap) maxGap = g; }
  if (maxGap > _PPX_CYCLE_MAX_ANG_GAP) return null;
  labels.sort((a, b) => Math.atan2(a.cy_c - cy0, a.cx_c - cx0) - Math.atan2(b.cy_c - cy0, b.cx_c - cx0));
  return { type: "cycle", items: labels.map((s) => ({ label: _ppxShapeText(s, " "), color: accent })), centerLabel: "" };
}

// ============================================================================
// 16. Container-less spatial clustering (bare rows / grids).
// ============================================================================
function _ppxCellIsConnector(cell, W, H) {
  if (cell.shapes.length !== 1) return false;
  const s = cell.shapes[0];
  return s.kind === "pic" && cell.w <= _PPX_CONNECTOR_MAX * W && cell.h <= _PPX_CONNECTOR_MAX * H;
}

function _ppxFormCells(shapes, W, H) {
  const eligible = (s) => {
    if (s.kind !== "text" && s.kind !== "pic") return false;
    if (s.kind === "pic") return true;
    if (s.w > _PPX_CELL_FULLW * W) return false;
    if (s.h > 2.5 * s.w && s.h > 0.08 * H) return false;
    return true;
  };
  const nodes = shapes.filter(eligible);
  const n = nodes.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < n; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j];
      const ap0 = a.kind === "pic", bp0 = b.kind === "pic";
      if (ap0 !== bp0) {
        const pic = ap0 ? a : b, txt = ap0 ? b : a;
        const gap = txt.x - (pic.x + pic.w);
        if (Math.abs(a.cy_c - b.cy_c) <= _PPX_HBIND_Y * H && -_PPX_HBIND_GAP * W <= gap && gap <= _PPX_HBIND_GAP * W && pic.cx_c < txt.cx_c) {
          parent[find(i)] = find(j); continue;
        }
      }
      if (Math.abs(a.cx_c - b.cx_c) >= _PPX_CELL_MERGE_X * W) continue;
      const vgap = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
      if (vgap >= _PPX_CELL_MERGE_Y * H) continue;
      const ap = a.kind === "pic", bp = b.kind === "pic";
      let bind;
      if (ap && bp) bind = false;
      else if (ap || bp) bind = true;
      else {
        const pa = _ppxShapeMaxpt(a), pb = _ppxShapeMaxpt(b);
        bind = !!(pa && pb && Math.max(pa, pb) >= _PPX_HEADING_RATIO * Math.min(pa, pb));
      }
      if (bind) parent[find(i)] = find(j);
    }
  }
  const groups = {};
  for (let i = 0; i < n; i++) { const r = find(i); (groups[r] = groups[r] || []).push(nodes[i]); }
  const cells = [];
  for (const key in groups) {
    const g = groups[key];
    const x0 = Math.min(...g.map((s) => s.x)), y0 = Math.min(...g.map((s) => s.y));
    const x1 = Math.max(...g.map((s) => s.x + s.w)), y1 = Math.max(...g.map((s) => s.y + s.h));
    cells.push({ shapes: g, x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 });
  }
  return cells;
}

function _ppxSplitBandX(band, W) {
  if (band.length < 3) return [band];
  band = band.slice().sort((a, b) => a.cx - b.cx);
  const gaps = [];
  for (let k = 0; k < band.length - 1; k++) gaps.push(band[k + 1].x - (band[k].x + band[k].w));
  const pos = gaps.filter((g) => g > 0).sort((a, b) => a - b);
  const med = pos.length ? pos[Math.floor(pos.length / 2)] : 0;
  const out = []; let cur = [band[0]];
  for (let k = 0; k < gaps.length; k++) {
    if (gaps[k] > _PPX_BAND_XGAP_MIN * W && (med <= 0 || gaps[k] > _PPX_BAND_XGAP_RATIO * med)) { out.push(cur); cur = []; }
    cur.push(band[k + 1]);
  }
  out.push(cur);
  return out;
}

function _ppxBandize(cells, W, H) {
  if (!cells.length) return [];
  cells = cells.slice().sort((a, b) => a.cy - b.cy);
  const bands = [[cells[0]]];
  for (const c of cells.slice(1)) {
    if (Math.abs(c.cy - bands[bands.length - 1][bands[bands.length - 1].length - 1].cy) <= _PPX_ROW_BAND_TOL * H)
      bands[bands.length - 1].push(c);
    else bands.push([c]);
  }
  const out = [];
  for (const b of bands) { b.sort((x, y) => x.cx - y.cx); for (const sb of _ppxSplitBandX(b, W)) out.push(sb); }
  return out;
}

function _ppxBandsAlign(b1, b2, W) {
  if (b1.length !== b2.length) return false;
  for (let i = 0; i < b1.length; i++) if (Math.abs(b1[i].cx - b2[i].cx) >= _PPX_COL_ALIGN_TOL * W) return false;
  return true;
}

function _ppxCellToGridItem(cell, W, accent, defaultColor, fontScale, stats, deckMedia) {
  const shp = cell.shapes.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const texts = shp.filter((s) => s.kind === "text");
  const ipts = texts.map(_ppxShapeMaxpt).filter(Boolean).sort((a, b) => a - b);
  const ibody = ipts.length ? ipts[Math.floor(ipts.length / 2)] : 16.0;
  const blocks = []; let centered = false;
  for (const s of shp) {
    if (s.kind === "pic") {
      const b = _ppxImageBlock(s, deckMedia, stats, W);
      if (b) { b.maxWidth = "56px"; delete b.caption; b.align = "center"; blocks.push(b); centered = true; }
      continue;
    }
    const mp = _ppxShapeMaxpt(s) || ibody;
    const algn = (s.aligns && s.aligns[0]) || "left";
    if (algn === "center") centered = true;
    if (mp >= _PPX_HEADING_RATIO * ibody && !_ppxIsBulleted(s)) {
      const b = { type: "heading", text: _ppxShapeText(s, " "), size: _ppxTokenForPt(mp) };
      const fc = _ppxFirstRunColor(s);
      b.color = fc || accent;
      const sp = _ppxPxFont(mp, fontScale, 14, 40);
      if (sp) b.style = { fontSize: sp };
      blocks.push(b);
    } else if (_ppxIsBulleted(s)) {
      const items = s.paras.filter((p) => p.text.trim()).map((p) => p.inline.trim());
      blocks.push({ type: "bullets", items, dotColor: accent, size: _ppxTokenForPt(mp), color: defaultColor });
    } else {
      const b = { type: "text", text: _ppxShapeInline(s), size: _ppxTokenForPt(mp), color: defaultColor };
      const fc = _ppxFirstRunColor(s);
      if (fc) b.color = fc;
      const sp = _ppxPxFont(mp, fontScale, 10, 28);
      if (sp) b.style = { fontSize: sp };
      blocks.push(b);
    }
  }
  return { align: centered ? "center" : "left", direction: "column", blocks: blocks.length ? blocks : [{ type: "text", text: "" }] };
}

function _ppxFirstRunColor(s) {
  for (const p of s.paras) for (const r of p.runs) if (r.color) return r.color;
  return null;
}

function _ppxSpatialClusters(body, W, H, accent, defaultColor, fontScale, stats, notes, deckMedia) {
  const cells = _ppxFormCells(body, W, H);
  const content = cells.filter((c) => !_ppxCellIsConnector(c, W, H));
  const connectors = cells.filter((c) => _ppxCellIsConnector(c, W, H));
  if (content.length < _PPX_MIN_ROW_CELLS) return { clusters: [], consumed: new Set() };

  const bands = _ppxBandize(content, W, H);
  const wide = bands.filter((b) => b.length >= 2);
  const clusters = [], consumed = new Set(), used = new Set();

  for (let i = 0; i < wide.length; i++) {
    const b = wide[i];
    if (used.has(b)) continue;
    const run = [b]; used.add(b);
    for (const nb of wide.slice(i + 1)) {
      if (used.has(nb)) break;
      if (_ppxBandsAlign(run[run.length - 1], nb, W)) { run.push(nb); used.add(nb); } else break;
    }
    const cellsIn = run.flat();
    const ncols = Math.max(...run.map((bb) => bb.length));
    const x0 = Math.min(...cellsIn.map((c) => c.x)), x1 = Math.max(...cellsIn.map((c) => c.x + c.w));
    const spread = x1 - x0;
    const singleRow = run.length === 1;
    if (ncols < 2) continue;
    if (singleRow) { if (run[0].length < _PPX_MIN_ROW_CELLS || spread < _PPX_ROW_SPREAD_MIN * W) continue; }
    else if (run.length < 2) continue;
    const ws = cellsIn.map((c) => c.w).sort((a, b2) => a - b2);
    if (ws[ws.length - 1] > 6 * Math.max(1, ws[Math.floor(ws.length / 2)])) continue;

    const y0 = Math.min(...cellsIn.map((c) => c.y));
    const band = run[0];
    let isFlow = false;
    if (singleRow) {
      const labelish = band.every((c) => {
        const t = c.shapes.filter((s) => s.kind === "text");
        return t.length >= 1 && _ppxShapeText(t[0], " ").length <= _PPX_SHORT_LABEL_CHARS * 2;
      });
      const midY = (y0 + Math.min(...band.map((c) => c.y + c.h))) / 2;
      const between = connectors.filter((k) => x0 < k.cx && k.cx < x1 && Math.abs(k.cy - midY) < 2 * _PPX_ROW_BAND_TOL * H);
      if (labelish && between.length >= band.length - 1 && band.length >= _PPX_MIN_ROW_CELLS) isFlow = true;
    }
    if (isFlow) {
      const items = [];
      for (const c of band) {
        const cts = c.shapes.filter((s) => s.kind === "text").sort((a, b2) => -((_ppxShapeMaxpt(a) || 0) - (_ppxShapeMaxpt(b2) || 0)));
        const it = { label: _ppxShapeText(cts[0], " ") };
        const sub = cts.slice(1).map((s) => _ppxShapeText(s, " ")).filter(Boolean).join(" ");
        if (sub) it.sublabel = sub;
        items.push(it);
      }
      clusters.push({ y: y0, x0, x1, single_row: singleRow, block: { type: "flow", items, connectorStyle: "arrow", labelSize: "sm" } });
      notes.add("bare shapes -> horizontal flow (arrows)");
      for (const k of connectors) if (x0 <= k.cx && k.cx <= x1) for (const s of k.shapes) consumed.add(s);
    } else {
      const items = run.flatMap((bb) => bb.map((c) => _ppxCellToGridItem(c, W, accent, defaultColor, fontScale, stats, deckMedia)));
      clusters.push({ y: y0, x0, x1, single_row: singleRow, block: { type: "grid", cols: ncols, gap: 18, items } });
      notes.add(run.length > 1 ? "bare shapes -> grid (spatial lattice)" : "bare shapes -> row grid");
    }
    for (const c of cellsIn) for (const s of c.shapes) consumed.add(s);
  }
  return { clusters, consumed };
}

function _ppxHasDominantRow(body, W, H, accent, defaultColor, fontScale, stats, deckMedia) {
  const { clusters } = _ppxSpatialClusters(body, W, H, accent, defaultColor, fontScale, stats, new Set(), deckMedia);
  return clusters.some((cl) => cl.single_row && (cl.x1 - cl.x0) >= _PPX_DOMINANT_SPREAD * W);
}

// ============================================================================
// 17. Structural detectors (steps, timeline) + icon binding.
// ============================================================================
function _ppxOrdinalOf(s) {
  const t = _ppxShapeText(s, " ").trim();
  return (t.length >= 1 && t.length <= 2 && /^[0-9]+$/.test(t)) ? parseInt(t, 10) : null;
}

function _ppxDetectSteps(shapes, W, H, accent, defaultColor, notes) {
  const texts = shapes.filter((s) => s.kind === "text");
  const marks = [];
  for (const s of texts) { const n = _ppxOrdinalOf(s); if (n != null) marks.push([n, s]); }
  if (marks.length < _PPX_ROWS_MIN) return null;
  const ys = marks.map((m) => m[1].cy_c), xs = marks.map((m) => m[1].cx_c);
  const vertical = (Math.max(...ys) - Math.min(...ys)) >= (Math.max(...xs) - Math.min(...xs));
  marks.sort((a, b) => (vertical ? a[1].cy_c - b[1].cy_c : a[1].cx_c - b[1].cx_c));
  for (let i = 0; i < marks.length; i++) if (marks[i][0] !== i + 1) return null;
  if (vertical && (Math.max(...xs) - Math.min(...xs)) > _PPX_COL_ALIGN_TOL * W) return null;
  if (!vertical && (Math.max(...ys) - Math.min(...ys)) > _PPX_ROW_BAND_TOL * H) return null;

  const markerIds = new Set(marks.map((m) => m[1]));
  const others = texts.filter((s) => !markerIds.has(s));
  const items = [], consumed = new Set();
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i][1];
    let band;
    if (vertical) band = others.filter((s) => !consumed.has(s) && Math.abs(s.cy_c - m.cy_c) <= _PPX_BAND_TOL * H && s.cx_c > m.cx_c).sort((a, b) => a.x - b.x);
    else band = others.filter((s) => !consumed.has(s) && Math.abs(s.cx_c - m.cx_c) <= _PPX_BAND_TOL * W && s.cy_c > m.cy_c).sort((a, b) => a.y - b.y);
    if (!band.length) return null;
    const titleS = band[0];
    const nb = i + 1 < marks.length ? marks[i + 1][1] : null;
    const yHi = (vertical && nb) ? (nb.y - _PPX_BAND_TOL * H) : H;
    const bodyShapes = others.filter((s) => !consumed.has(s) && s !== titleS &&
      Math.abs(s.cx_c - titleS.cx_c) < _PPX_COL_ALIGN_TOL * W && titleS.y < s.cy_c && s.cy_c < yHi).sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const it = { title: _ppxShapeText(titleS, " ") };
    const btxt = bodyShapes.map((s) => _ppxShapeText(s, " ")).filter(Boolean).join(" ");
    if (btxt) it.text = btxt;
    items.push(it);
    consumed.add(m); consumed.add(titleS);
    for (const s of bodyShapes) consumed.add(s);
  }
  if (items.length < _PPX_ROWS_MIN) return null;
  notes.add("numbered markers -> steps (sequence preserved)");
  return {
    block: { type: "steps", items, numberColor: accent, titleColor: defaultColor, textColor: _ppxDim(defaultColor), titleSize: "md", textSize: "sm" },
    consumed, y: Math.min(...marks.map((m) => m[1].y)), x0: Math.min(...marks.map((m) => m[1].x)),
  };
}

function _ppxDetectTimeline(shapes, W, H, accent, defaultColor, notes) {
  const texts = shapes.filter((s) => s.kind === "text");
  const isDatelabel = (s) => {
    const t = _ppxShapeText(s, " ").trim();
    return t.length > 0 && t.length <= _PPX_SHORT_LABEL_CHARS && /[0-9]/.test(t) && _ppxOrdinalOf(s) == null && s.w <= _PPX_CELL_FULLW * W;
  };
  const dates = texts.filter(isDatelabel);
  if (dates.length < _PPX_MIN_ROW_CELLS) return null;
  let best = [];
  for (const d of dates) { const band = dates.filter((e) => Math.abs(e.cy_c - d.cy_c) <= _PPX_ROW_BAND_TOL * H); if (band.length > best.length) best = band; }
  if (best.length < _PPX_MIN_ROW_CELLS) return null;
  const band = best.slice().sort((a, b) => a.cx_c - b.cx_c);
  if (band[band.length - 1].cx_c - band[0].cx_c < _PPX_ROW_SPREAD_MIN * W) return null;
  const bandIds = new Set(band);
  const others = texts.filter((s) => !bandIds.has(s));
  const items = [], consumed = new Set();
  for (const d of band) {
    const col = others.filter((s) => !consumed.has(s) && Math.abs(s.cx_c - d.cx_c) < _PPX_COL_ALIGN_TOL * W && s.y >= d.y).sort((a, b) => a.y - b.y);
    const run = []; let prevBottom = d.y + d.h;
    for (const s of col) { if (s.y - prevBottom > _PPX_CELL_MERGE_Y * H) break; run.push(s); prevBottom = Math.max(prevBottom, s.y + s.h); }
    if (!run.length) return null;
    const dp = _ppxShapeMaxpt(d), tp = _ppxShapeMaxpt(run[0]);
    if (dp && tp && dp > 1.1 * tp) return null;
    const it = { date: _ppxShapeText(d, " "), title: _ppxShapeText(run[0], " ") };
    const btxt = run.slice(1).map((s) => _ppxShapeText(s, " ")).filter(Boolean).join(" ");
    if (btxt) it.text = btxt;
    items.push(it);
    consumed.add(d);
    for (const s of run) consumed.add(s);
  }
  if (items.length < _PPX_MIN_ROW_CELLS) return null;
  notes.add("dated horizontal markers -> timeline (order preserved)");
  return {
    block: { type: "timeline", direction: "horizontal", items, dotColor: accent, dateColor: accent, titleColor: defaultColor, textColor: _ppxDim(defaultColor) },
    consumed, y: Math.min(...band.map((s) => s.y)), x0: Math.min(...band.map((s) => s.x)),
  };
}

function _ppxIsIconPic(s, W, H) {
  return s.kind === "pic" && s.w <= _PPX_ICON_BIND_W * W && s.h <= _PPX_ICON_BIND_H * H;
}

function _ppxBindOrDropIcons(remaining, W, H) {
  const icons = remaining.filter((s) => _ppxIsIconPic(s, W, H));
  if (!icons.length) return { kept: remaining, bound: new Map(), dropped: 0 };
  const labels = remaining.filter((s) => s.kind === "text" && _ppxShapeText(s, " "));
  const bound = new Map(); let dropped = 0; const consumed = new Set();
  for (const ic of icons) {
    let best = null, bestD = null;
    for (const lab of labels) {
      const above = Math.abs(ic.cx_c - lab.cx_c) <= _PPX_COL_ALIGN_TOL * W && (lab.y - (ic.y + ic.h)) >= 0 && (lab.y - (ic.y + ic.h)) <= _PPX_ICON_ABOVE_V * H;
      const gapL = lab.x - (ic.x + ic.w);
      const left = Math.abs(ic.cy_c - lab.cy_c) <= _PPX_HBIND_Y * H && -_PPX_HBIND_GAP * W <= gapL && gapL <= _PPX_HBIND_GAP * W && ic.cx_c < lab.cx_c;
      const gapR = ic.x - (lab.x + lab.w);
      const right = Math.abs(ic.cy_c - lab.cy_c) <= _PPX_HBIND_Y * H && gapR >= 0 && gapR <= _PPX_HBIND_GAP * W && ic.cx_c > lab.cx_c;
      if (!(above || left || right)) continue;
      const d = Math.abs(ic.cx_c - lab.cx_c) + Math.abs(ic.cy_c - lab.cy_c);
      if (best == null || d < bestD) { best = lab; bestD = d; }
    }
    if (best) { if (!bound.has(best)) bound.set(best, []); bound.get(best).push(ic); consumed.add(ic); }
    else { consumed.add(ic); dropped++; }
  }
  for (const arr of bound.values()) arr.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return { kept: remaining.filter((s) => !consumed.has(s)), bound, dropped };
}

function _ppxLooksCode(s) {
  const txt = _ppxShapeText(s);
  if (!txt) return false;
  let signals = 0;
  for (const ch of "{}()=;") signals += txt.split(ch).length - 1;
  const monoish = ["def ", "function", "=>", "return", "const ", "await ", "while", "for ", "import ", "():", "){"].some((k) => txt.indexOf(k) !== -1);
  return (signals >= 4 && txt.indexOf("\n") !== -1) || (monoish && signals >= 2);
}

function _ppxTextBlock(s, defaultColor, accent, fontScale) {
  if (_ppxIsBulleted(s)) {
    const items = s.paras.filter((p) => p.text.trim()).map((p) => p.inline.trim());
    const blk = { type: "bullets", items, dotColor: accent, size: "sm" };
    const mp = _ppxShapeMaxpt(s);
    if (mp) blk.size = _ppxTokenForPt(mp);
    return blk;
  }
  const text = _ppxShapeInline(s);
  if (!text) return null;
  const mp = _ppxShapeMaxpt(s);
  const blk = { type: "text", text, size: mp ? _ppxTokenForPt(mp) : "md" };
  const fc = _ppxFirstRunColor(s);
  if (fc) blk.color = fc;
  if (s.aligns && (s.aligns[0] === "center" || s.aligns[0] === "right")) blk.align = s.aligns[0];
  const sp = _ppxPxFont(mp, fontScale, 10, 32);
  if (sp) blk.style = { fontSize: sp };
  return blk;
}

function _ppxFlowBody(body, W, H, accent, defaultColor, fontScale, bg, stats, notes, deckMedia, lead) {
  const blocks = (lead || []).slice();
  let remaining = body.filter((s) => s.kind === "text" || s.kind === "pic" || s.kind === "table" || s.kind === "chart");
  const specialUnits = [];

  const tg = _ppxDetectTagGroups(remaining, W, H, accent, notes);
  for (const [y, x0, blk] of tg.units) specialUnits.push([y, x0, "block", blk]);
  remaining = remaining.filter((s) => !tg.consumed.has(s));

  for (const det of [_ppxDetectSteps, _ppxDetectTimeline]) {
    const res = det(remaining, W, H, accent, defaultColor, notes);
    if (res) { specialUnits.push([res.y, res.x0, "block", res.block]); remaining = remaining.filter((s) => !res.consumed.has(s)); }
  }

  const sc = _ppxSpatialClusters(remaining, W, H, accent, defaultColor, fontScale, stats, notes, deckMedia);
  remaining = remaining.filter((s) => !sc.consumed.has(s));

  for (const s of remaining.slice()) {
    if (_ppxIsChipLabel(s)) {
      specialUnits.push([s.y, s.x, "block", _ppxBadgeBlock(s)]);
      remaining = remaining.filter((r) => r !== s);
      notes.add("short pill-backed label -> badge");
    }
  }

  const cyc = _ppxDetectCycle(remaining, accent);
  let cycIds = new Set();
  if (cyc) {
    cycIds = new Set(remaining.filter((s) => s.kind === "text" && _ppxShapeText(s, " ").length <= _PPX_SHORT_LABEL_CHARS));
    notes.add("near-square label cluster -> cycle (radial diagram)");
  }

  const bd = _ppxBindOrDropIcons(remaining, W, H);
  remaining = bd.kept;
  if (bd.dropped) { stats.dropped += bd.dropped; notes.add("loose decorative icon glyph -> dropped (unbound)"); }
  if (bd.bound.size) notes.add("loose icon bound to its adjacent label");

  const units = sc.clusters.map((cl) => [cl.y, cl.x0, "block", cl.block]);
  for (const u of specialUnits) units.push(u);
  for (const s of remaining) if (!cycIds.has(s)) units.push([s.y, s.x, "shape", s]);
  units.sort((a, b) => (Math.round(a[0] / (_PPX_BAND_TOL * H + 1)) - Math.round(b[0] / (_PPX_BAND_TOL * H + 1))) || (a[1] - b[1]));

  for (const [, , kind, s] of units) {
    if (kind === "block") { blocks.push(s); continue; }
    if (s.kind === "pic") { const b = _ppxImageBlock(s, deckMedia, stats, W); if (b) blocks.push(b); continue; }
    if (s.kind === "table") {
      blocks.push({ type: "table", headers: s.table.headers || [], rows: s.table.rows, striped: true });
      stats.lossy++; notes.add("table -> string cells (merges/widths/fills lost)"); continue;
    }
    if (s.kind === "chart") {
      if (s.graphicBlocks && s.graphicBlocks.length) {
        for (const b of s.graphicBlocks) blocks.push(b);
        stats.lossy++; notes.add("chart / SmartArt -> text extracted (no visual placeholder)");
      } else {
        // chart/diagram part unresolvable (no text recoverable): keep a plain text
        // marker so its presence isn't silently lost — no image/icon placeholder.
        blocks.push({ type: "text", text: "[chart / diagram]", size: "sm", color: _ppxDim(defaultColor) });
        stats.dropped++;
      }
      continue;
    }
    const lblAlign = (s.aligns && s.aligns[0]) || "left";
    for (const ic of (bd.bound.get(s) || [])) { const ib = _ppxImageBlock(ic, deckMedia, stats, W); if (ib) { ib.align = lblAlign; blocks.push(ib); } }
    if (_ppxLooksCode(s)) { blocks.push({ type: "code", text: _ppxShapeText(s), copy: false, size: "sm" }); stats.clean++; continue; }
    const b = _ppxTextBlock(s, defaultColor, accent, fontScale);
    if (b) { blocks.push(b); stats[b.type !== "bullets" ? "clean" : "lossy"]++; }
  }
  if (cyc) blocks.push(cyc);
  return blocks;
}

// ============================================================================
// 18. Cards / rows / columns detectors.
// ============================================================================
function _ppxMkHeading(s, fontScale) {
  const text = _ppxShapeText(s, " ");
  const mp = _ppxShapeMaxpt(s);
  const blk = { type: "heading", text, size: _ppxTokenForPt(mp || 40) };
  const fc = _ppxFirstRunColor(s);
  if (fc) blk.color = fc;
  const sp = _ppxPxFont(mp, fontScale, 20, 64);
  if (sp) blk.style = { fontSize: sp };
  return blk;
}

function _ppxCardFromContainer(cont, inner, W, H, defaultColor, accent, fontScale, bg, deckMedia, stats) {
  inner.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const fill = cont.fill;
  const accentBar = cont.line || accent;
  const cellBlocks = [];
  if (!inner.length && cont.kind === "text") inner = [cont];
  const ipts = inner.filter((s) => s.kind === "text").map(_ppxShapeMaxpt).filter(Boolean).sort((a, b) => a - b);
  const ibody = ipts.length ? ipts[Math.floor(ipts.length / 2)] : 16.0;
  let cellColor = defaultColor;
  if (fill) cellColor = _ppxLuminance(fill) < 0.5 ? "#e8edf4" : "#1e293b";
  for (const s of inner) {
    if (s.kind === "pic") {
      const b = _ppxImageBlock(s, deckMedia, stats, W);
      if (b) { b.maxWidth = "56px"; delete b.caption; cellBlocks.push(b); }
      continue;
    }
    const mp = _ppxShapeMaxpt(s) || ibody;
    if (mp >= _PPX_HEADING_RATIO * ibody && !_ppxIsBulleted(s)) {
      const b = { type: "heading", text: _ppxShapeText(s, " "), size: _ppxTokenForPt(mp), color: accent };
      const sp = _ppxPxFont(mp, fontScale, 14, 34);
      if (sp) b.style = { fontSize: sp };
      cellBlocks.push(b);
    } else if (_ppxIsBulleted(s)) {
      const items = s.paras.filter((p) => p.text.trim()).map((p) => p.inline.trim());
      cellBlocks.push({ type: "bullets", items, dotColor: accent, size: _ppxTokenForPt(mp), color: cellColor });
    } else {
      const b = { type: "text", text: _ppxShapeInline(s), size: _ppxTokenForPt(mp), color: cellColor };
      const sp = _ppxPxFont(mp, fontScale, 10, 26);
      if (sp) b.style = { fontSize: sp };
      cellBlocks.push(b);
    }
  }
  const style = { padding: "18px 20px", borderRadius: 8 };
  if (fill) style.backgroundColor = fill; // NOT `background` — sanitizeStyle strips the shorthand
  if (accentBar) style.borderLeft = _PPX_CARD_ACCENT_W + " solid " + accentBar;
  style.minHeight = Math.max(8, Math.floor(cont.h / H * 100)) + "%";
  return { align: "left", direction: "column", blocks: cellBlocks.length ? cellBlocks : [{ type: "text", text: "" }], style };
}

function _ppxDetectCards(containers, body, W, H, defaultColor, accent, fontScale, bg, notes, deckMedia, stats) {
  if (!containers.length) return { block: null, consumed: new Set() };
  const textBody = body.filter((s) => s.kind === "text");
  const picBody = body.filter((s) => s.kind === "pic");
  const cards = [];
  for (const c of containers) {
    const innerText = textBody.filter((s) => s !== c && _ppxContains(c, s, W, H));
    if (innerText.length) cards.push([c, innerText.slice()]);
  }
  const realCards = [];
  for (const [c, inner] of cards) {
    if (cards.some(([cc]) => cc !== c && _ppxContains(cc, c, W, H))) continue;
    realCards.push([c, inner]);
  }
  if (realCards.length < 2) return { block: null, consumed: new Set() };
  for (const p of picBody) {
    let best = null, bestOv = 0;
    for (const [c, inner] of realCards) {
      if (!_ppxPicInCard(c, p, W, H)) continue;
      const ov = _ppxOverlapFrac(c, p);
      if (ov >= bestOv) { best = inner; bestOv = ov; }
    }
    if (best) best.push(p);
  }
  realCards.sort((a, b) => (a[0].y - b[0].y) || (a[0].x - b[0].x));
  const consumed = new Set(), items = [];
  // Emit every card — do NOT cap here (that silently dropped cards 7+ and their
  // text). Oversized grids are split into <=6-cell grids by _ppxSplitOversizedGrids
  // so nothing is lost on load.
  for (const [c, inner] of realCards) {
    consumed.add(c);
    for (const s of inner) consumed.add(s);
    items.push(_ppxCardFromContainer(c, inner, W, H, defaultColor, accent, fontScale, bg, deckMedia, stats));
  }
  const ncards = items.length;
  const cols = ncards <= _PPX_GRID_MAX_COLS ? Math.min(_PPX_GRID_MAX_COLS, ncards) : (ncards % 2 === 0 ? 2 : Math.min(_PPX_GRID_MAX_COLS, ncards));
  notes.add("card containers -> grid (absolute size/position approximated)");
  return { block: { type: "grid", cols, gap: 18, items }, consumed };
}

function _ppxDetectRows(containers, textShapes, W, H, accent, notes) {
  const labelOf = (c) => {
    let inner = textShapes.filter((s) => _ppxContains(c, s, W, H));
    if (c.kind === "text" && _ppxShapeText(c, " ")) inner = inner.length ? inner : [c];
    const texts = inner.filter((s) => _ppxShapeText(s, " "));
    if (texts.length !== 1) return null;
    if (_ppxShapeText(texts[0], " ").length > _PPX_SHORT_LABEL_CHARS) return null;
    return texts[0];
  };
  const units = [];
  for (const c of containers) { const lab = labelOf(c); if (lab) units.push([c, lab]); }
  if (units.length < _PPX_ROWS_MIN) return null;
  units.sort((a, b) => a[0].y - b[0].y);
  const xs = units.map((u) => u[0].x), hs = units.map((u) => u[0].h);
  if (Math.max(...xs) - Math.min(...xs) > 0.08 * W) return null;
  if (Math.max(...hs) - Math.min(...hs) > 0.5 * Math.max(...hs)) return null;
  const consumed = new Set(), items = []; let paired = 0;
  for (const [c, lab] of units) {
    let desc = null;
    for (const s of textShapes) {
      if (s === lab || s === c || consumed.has(s)) continue;
      if (_ppxSameBand(s, c, H) && s.cx_c > (c.x + c.w) && !units.some(([cc]) => _ppxContains(cc, s, W, H))) { desc = s; break; }
    }
    const item = { title: _ppxShapeText(lab, " "), iconBg: c.fill || lab.fill || accent, iconColor: "#ffffff", icon: "square" };
    if (desc) { item.text = _ppxShapeText(desc, " "); consumed.add(desc); paired++; }
    items.push(item);
    consumed.add(c); consumed.add(lab);
  }
  if (paired < _PPX_ROWS_MIN - 1) return null;
  notes.add("repeating label+text rows -> icon-row");
  return { block: { type: "icon-row", items, iconShape: "square", gap: 14, titleSize: "md", textSize: "sm" }, consumed };
}

function _ppxDetectCols(body, W, H, accent, defaultColor, fontScale, bg, stats, notes, deckMedia) {
  const real = body.filter((s) => ["text", "pic", "table", "chart"].indexOf(s.kind) !== -1);
  if (real.length < 2) return null;
  const fullw = real.filter((s) => s.w >= _PPX_FULLW_COL_FRAC * W);
  const colsShapes = real.filter((s) => fullw.indexOf(s) === -1);
  if (colsShapes.length < 2) return null;

  const ivs = colsShapes.map((s) => [s.x, s.x + s.w]).sort((a, b) => a[0] - b[0]);
  const corridors = []; let curEnd = ivs[0][1];
  for (const [a, b] of ivs.slice(1)) { if (a > curEnd) corridors.push([curEnd, a]); curEnd = Math.max(curEnd, b); }

  const cells = _ppxFormCells(colsShapes, W, H).filter((c) => !_ppxCellIsConnector(c, W, H));
  const cbands = [];
  for (const c of cells.slice().sort((a, b) => a.cy - b.cy)) {
    if (cbands.length && c.cy - cbands[cbands.length - 1][cbands[cbands.length - 1].length - 1].cy <= _PPX_BAND_TOL * H)
      cbands[cbands.length - 1].push(c);
    else cbands.push([c]);
  }
  const bisectsRow = (sx) => {
    for (const band of cbands) {
      const centers = band.map((c) => c.cx).sort((a, b) => a - b);
      let ncells = 1;
      for (let i = 0; i < centers.length - 1; i++) if (centers[i + 1] - centers[i] > _PPX_COL_ALIGN_TOL * W) ncells++;
      if (ncells >= 3 && band.some((c) => c.x + c.w <= sx) && band.some((c) => c.x >= sx)) return true;
    }
    return false;
  };

  let best = null;
  for (const [g0, g1] of corridors) {
    if ((g1 - g0) < _PPX_COL_GAP_MIN * W) continue;
    const sx = (g0 + g1) / 2;
    if (Math.abs(sx - 0.5 * W) > _PPX_COL_CENTER_MAX * W) continue;
    if (bisectsRow(sx)) continue;
    const left = colsShapes.filter((s) => s.x + s.w <= sx);
    const right = colsShapes.filter((s) => s.x >= sx);
    if (!left.length || !right.length || left.length + right.length !== colsShapes.length) continue;
    const lcx = left.reduce((a, s) => a + s.cx_c, 0) / left.length;
    const rcx = right.reduce((a, s) => a + s.cx_c, 0) / right.length;
    if ((rcx - lcx) < _PPX_COL_BAND_SEP * W) continue;
    const lwt = left.reduce((a, s) => a + s.w, 0), rwt = right.reduce((a, s) => a + s.w, 0);
    const singleImg = (left.length === 1 && left[0].kind === "pic") || (right.length === 1 && right[0].kind === "pic");
    if (!singleImg && Math.min(lwt, rwt) < _PPX_COL_MIN_SHARE * (lwt + rwt)) continue;
    const centrality = Math.abs(sx - 0.5 * W);
    if (best == null || centrality < best.centrality) best = { centrality, left, right };
  }
  if (!best) return null;
  const { left, right } = best;

  const sideBlocks = (group) => {
    group.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    return _ppxFlowBody(group, W, H, accent, defaultColor, fontScale, bg, stats, notes, deckMedia);
  };

  let topFw = [], botFw = [];
  if (fullw.length) {
    const colTop = Math.min(...colsShapes.map((s) => s.y));
    const colBot = Math.max(...colsShapes.map((s) => s.y + s.h));
    const mid = (colTop + colBot) / 2;
    const above = fullw.filter((s) => s.cy_c <= mid).sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const below = fullw.filter((s) => s.cy_c > mid).sort((a, b) => (a.y - b.y) || (a.x - b.x));
    topFw = above.length ? _ppxFlowBody(above, W, H, accent, defaultColor, fontScale, bg, stats, notes, deckMedia) : [];
    botFw = below.length ? _ppxFlowBody(below, W, H, accent, defaultColor, fontScale, bg, stats, notes, deckMedia) : [];
  }

  const onlyImage = (group) => group.length === 1 && group[0].kind === "pic";
  if (!fullw.length && onlyImage(right)) {
    notes.add("image-beside-text -> image-right");
    const img = _ppxImageBlock(right[0], deckMedia, stats, W);
    if (img) return { kind: "image-right", L: sideBlocks(left), img };
  }
  if (!fullw.length && onlyImage(left)) {
    notes.add("image-beside-text -> image-left");
    const img = _ppxImageBlock(left[0], deckMedia, stats, W);
    if (img) return { kind: "image-left", R: sideBlocks(right), img };
  }

  const L = sideBlocks(left).concat(botFw);
  const R = sideBlocks(right);
  if (!L.length || !R.length) return null;
  const lw = Math.max(...left.map((s) => s.x + s.w)) - Math.min(...left.map((s) => s.x));
  const rw = Math.max(...right.map((s) => s.x + s.w)) - Math.min(...right.map((s) => s.x));
  const total = (lw + rw) || 1;
  notes.add("gap-clustered columns -> cols layout");
  return { kind: "cols", L, R, top: topFw, contentFlex: Math.max(1, Math.round(lw / total * 10)), imageFlex: Math.max(1, Math.round(rw / total * 10)) };
}

// ============================================================================
// 19. build_slide orchestration.
// ============================================================================
function _ppxBuildSlide(shapes, W, H, bg, defaultColor, accent, fontScale, stats, notes, deckMedia) {
  _ppxAnnotatePills(shapes, W, H);
  const textShapes = shapes.filter((s) => s.kind === "text");
  const bodyPts = textShapes.map(_ppxShapeMaxpt).filter(Boolean).sort((a, b) => a - b);
  const bodyFont = bodyPts.length ? bodyPts[Math.floor(bodyPts.length / 2)] : 18.0;

  const isHeadingShape = (s) => {
    if (s.is_title) return true;
    const mp = _ppxShapeMaxpt(s);
    return !!(mp && mp >= _PPX_HEADING_RATIO * bodyFont && !_ppxIsBulleted(s));
  };

  const consumed = new Set();

  for (const s of textShapes) {
    if (s.y >= _PPX_FOOTER_BAND * H && _ppxShapeText(s).length <= 40 && !isHeadingShape(s)) {
      consumed.add(s); stats.dropped++; notes.add("footer / page-number chrome");
    }
  }
  for (const s of textShapes) {
    if (!consumed.has(s) && _ppxIsUiChrome(_ppxShapeText(s, " "))) { consumed.add(s); stats.dropped++; notes.add("UI chrome text (copy button / control glyph)"); }
  }

  const bodyAll = shapes.filter((s) => !consumed.has(s));
  const allContainers = shapes.filter((s) => (s.kind === "text" || s.kind === "decor") && !consumed.has(s) && (s.fill || s.line) && s.w >= _PPX_CARD_MIN_W * W && s.h >= _PPX_CARD_MIN_H * H);

  const iconrow = _ppxDetectRows(allContainers, bodyAll.filter((s) => s.kind === "text"), W, H, accent, notes);
  let rowBlock = null;
  if (iconrow) { rowBlock = iconrow.block; for (const c of iconrow.consumed) consumed.add(c); }

  const containers = allContainers.filter((s) => !consumed.has(s));
  const bodyForCards = bodyAll.filter((s) => !consumed.has(s));
  const cardRes = _ppxDetectCards(containers, bodyForCards, W, H, defaultColor, accent, fontScale, bg, notes, deckMedia, stats);
  const gridBlock = cardRes.block;
  for (const c of cardRes.consumed) consumed.add(c);

  let remainingText = textShapes.filter((s) => !consumed.has(s));
  const titleShapes = remainingText.filter((s) => isHeadingShape(s) && s.y <= _PPX_TITLE_BAND * H).sort((a, b) => (a.y - b.y) || (a.x - b.x));
  let titleBlock = null, subtitleBlock = null, titleGeo = null;
  if (titleShapes.length) {
    const t = titleShapes[0];
    titleGeo = t; consumed.add(t);
    titleBlock = _ppxMkHeading(t, fontScale);
    for (const s of remainingText) {
      if (consumed.has(s) || isHeadingShape(s)) continue;
      const mp = _ppxShapeMaxpt(s) || bodyFont;
      if (t.y < s.y && s.y <= _PPX_TITLE_BAND * H + 0.12 * H && mp <= _PPX_SUBTITLE_RATIO * bodyFont && s.cy_c < 0.42 * H && s.w >= _PPX_SUBTITLE_MIN_W * W) {
        subtitleBlock = { type: "text", text: _ppxShapeInline(s), size: "lg", color: _ppxDim(defaultColor) };
        const sp = _ppxPxFont(mp, fontScale);
        if (sp) subtitleBlock.style = { fontSize: sp };
        consumed.add(s); break;
      }
    }
  }

  if (titleGeo) {
    for (const s of bodyAll) {
      if (!consumed.has(s) && s.kind === "pic" && s.w <= _PPX_CHROME_ICON_W * W && s.h <= _PPX_CHROME_ICON_H * H &&
        Math.abs(s.cy_c - titleGeo.cy_c) <= _PPX_BAND_TOL * H && s.cx_c <= titleGeo.x + 0.02 * W) {
        consumed.add(s); stats.dropped++; notes.add("title icon chrome");
      }
    }
  }

  const body = bodyAll.filter((s) => !consumed.has(s) && s.kind !== "decor");
  const blocksTop = [];
  if (titleBlock) blocksTop.push(titleBlock);
  if (subtitleBlock) blocksTop.push(subtitleBlock);

  if (rowBlock) {
    const stack = _ppxFlowBody(body, W, H, accent, defaultColor, fontScale, bg, stats, notes, deckMedia, [rowBlock]);
    return _ppxFinish(blocksTop.concat(stack), gridBlock, bg, defaultColor, accent);
  }

  const split = _ppxDetectCols(body, W, H, accent, defaultColor, fontScale, bg, stats, notes, deckMedia);
  if (split && !_ppxHasDominantRow(body, W, H, accent, defaultColor, fontScale, stats, deckMedia)) {
    return _ppxFinishCols(blocksTop.concat(gridBlock ? [gridBlock] : []), split, bg, defaultColor, accent);
  }

  const stack = _ppxFlowBody(body, W, H, accent, defaultColor, fontScale, bg, stats, notes, deckMedia);
  const allBlocks = blocksTop.concat(gridBlock ? [gridBlock] : []).concat(stack);
  return _ppxFinish(allBlocks, null, bg, defaultColor, accent);
}

// ============================================================================
// 20. Legibility post-pass (keyed only on measured contrast).
// ============================================================================
function _ppxContrast(fg, bg) {
  const l1 = _ppxLuminance(fg), l2 = _ppxLuminance(bg);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}
function _ppxLegibleOn(bg) { return _ppxLuminance(bg) < 0.5 ? "#e8edf4" : "#1e293b"; }
function _ppxMutedOn(bg) { return _ppxLuminance(bg) < 0.5 ? "#94a3b8" : "#64748b"; }
function _ppxSaturation(hexc) {
  try {
    const h = String(hexc).replace(/^#/, "");
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const mx = Math.max(r, g, b);
    return mx === 0 ? 0 : (mx - Math.min(r, g, b)) / mx;
  } catch (e) { return 1.0; }
}

// The load-path sanitizer caps grid cells at 6 (part-imports.jsx sanitizeBlock:
// `clean.items.slice(0, 6)`). A reflowed lattice can exceed that (e.g. a 2-row
// 6-col grid = 12 cells), which would silently drop the overflow rows on load =
// visible content lost. Split any oversized grid into consecutive <=6-cell grids
// so every cell survives; cell order is preserved (a 2-row lattice becomes two
// stacked rows). Keyed off the sanitizer's cap so the two stay in lockstep.
const _PPX_GRID_CELL_CAP = 6;
function _ppxSplitGridsInList(list) {
  if (!Array.isArray(list)) return list;
  const out = [];
  for (const b of list) {
    if (b && typeof b === "object" && Array.isArray(b.items)) {
      for (const cell of b.items) {
        if (cell && Array.isArray(cell.blocks)) cell.blocks = _ppxSplitGridsInList(cell.blocks);
      }
      if (b.type === "grid" && b.items.length > _PPX_GRID_CELL_CAP) {
        for (let i = 0; i < b.items.length; i += _PPX_GRID_CELL_CAP) out.push({ ...b, items: b.items.slice(i, i + _PPX_GRID_CELL_CAP) });
        continue;
      }
    }
    out.push(b);
  }
  return out;
}
function _ppxSplitOversizedGrids(slide) {
  if (Array.isArray(slide.blocks)) slide.blocks = _ppxSplitGridsInList(slide.blocks);
  for (const side of ["L", "R"]) if (Array.isArray(slide[side])) slide[side] = _ppxSplitGridsInList(slide[side]);
}

// Safety net for the hard invariant "nothing visible is lost": the reflow
// clustering is heuristic and can occasionally drop a text shape (containment /
// overlap edge cases). After a slide is assembled, diff every source text shape
// against the text actually emitted; any run that appears nowhere is appended as
// a plain fallback block so its content survives even when clustering mislays it.
const _PPX_SALVAGE_SKIP_KEYS = new Set(["src", "bg", "color", "accent", "type", "size", "layout", "align", "direction", "icon", "gap", "cols", "duration", "status", "id", "style", "connectorStyle", "labelSize"]);
function _ppxNormText(t) { return String(t).toLowerCase().replace(/[\s*_`]/g, ""); }
function _ppxSalvageDroppedText(slide, shapes) {
  let emitted = "";
  const collect = (v, key) => {
    if (typeof v === "string") { if (!(key && _PPX_SALVAGE_SKIP_KEYS.has(key)) && !/^data:/.test(v)) emitted += " " + v; }
    else if (Array.isArray(v)) { for (const x of v) collect(x, key); }
    else if (v && typeof v === "object") { for (const k in v) collect(v[k], k); }
  };
  collect(slide.blocks, null); collect(slide.L, null); collect(slide.R, null);
  const emittedN = _ppxNormText(emitted);
  const missing = [], seen = new Set();
  for (const s of shapes) {
    if (!s || s.kind !== "text") continue;
    const t = _ppxShapeText(s, " ");
    const n = _ppxNormText(t);
    if (n.length < 2 || seen.has(n) || emittedN.includes(n)) continue;
    seen.add(n);
    missing.push(t);
  }
  if (!missing.length) return 0;
  if (!Array.isArray(slide.blocks)) slide.blocks = [];
  if (missing.length === 1) slide.blocks.push({ type: "text", text: missing[0], size: "sm" });
  else slide.blocks.push({ type: "bullets", items: missing });
  return missing.length;
}

function _ppxFixLegibility(slide, fixes) {
  const slideBg = slide.bg || "#0f172a";
  const fixBlock = (b, bgc) => {
    const col = b.color;
    if (!col) return;
    const c = _ppxContrast(col, bgc);
    if (c < _PPX_MIN_CONTRAST) { b.color = _ppxLegibleOn(bgc); fixes[0]++; }
    else if (c < _PPX_SOFT_CONTRAST && _ppxSaturation(col) <= _PPX_GREY_SAT) {
      const muted = _ppxMutedOn(bgc);
      if (_ppxContrast(muted, bgc) > c) { b.color = muted; fixes[0]++; }
    }
  };
  const walk = (node, bgc) => {
    if (Array.isArray(node)) { for (const n of node) walk(n, bgc); return; }
    if (!node || typeof node !== "object") return;
    const cellBg = (node.style && node.style.backgroundColor) || bgc;
    fixBlock(node, cellBg);
    for (const key of ["blocks", "items", "L", "R"]) walk(node[key], cellBg);
  };
  walk(slide.blocks || [], slideBg);
  for (const side of ["L", "R"]) walk(slide[side] || [], slideBg);
}

// ============================================================================
// 21. Slide assembly.
// ============================================================================
function _ppxSynthDuration(blocks) {
  let words = 0;
  const walk = (arr) => {
    for (const b of arr || []) {
      if (!b || typeof b !== "object") continue;
      if (typeof b.text === "string") words += b.text.split(/\s+/).filter(Boolean).length;
      if (b.type === "bullets" && Array.isArray(b.items)) for (const i of b.items) words += String(typeof i === "object" && i ? i.text || "" : i).split(/\s+/).filter(Boolean).length;
      if (Array.isArray(b.items)) for (const it of b.items) { if (it && typeof it === "object") { if (it.title) words += String(it.title).split(/\s+/).filter(Boolean).length; if (it.label) words += String(it.label).split(/\s+/).filter(Boolean).length; } }
      if (Array.isArray(b.blocks)) walk(b.blocks);
    }
  };
  walk(blocks);
  return Math.floor(Math.max(30, Math.min(90, 20 + words * 0.4)));
}

function _ppxFinish(blocks, gridBlock, bg, defaultColor, accent) {
  if (gridBlock && blocks.indexOf(gridBlock) === -1) blocks = blocks.concat([gridBlock]);
  const slide = {
    bg, color: defaultColor, accent, align: "left", verticalAlign: "top", padding: "44px 52px", gap: 14,
    duration: _ppxSynthDuration(blocks),
    blocks: blocks.length ? blocks : [{ type: "text", text: "(empty slide)", size: "sm" }],
  };
  const title = blocks.find((b) => b && b.type === "heading");
  if (title) slide.title = String(title.text).slice(0, 60);
  return slide;
}

function _ppxFinishCols(topBlocks, split, bg, defaultColor, accent) {
  const slide = { bg, color: defaultColor, accent, align: "left", verticalAlign: "top", padding: "44px 52px", gap: 16 };
  if (split.kind === "image-left" || split.kind === "image-right") {
    slide.layout = split.kind;
    const content = split.L || split.R || [];
    slide.blocks = topBlocks.concat(content).concat([split.img]);
  } else {
    slide.layout = "cols";
    slide.blocks = topBlocks.concat(split.top || []);
    slide.L = split.L;
    slide.R = split.R;
    slide.contentFlex = split.contentFlex != null ? split.contentFlex : 5;
    slide.imageFlex = split.imageFlex != null ? split.imageFlex : 5;
  }
  const allb = (slide.blocks || []).concat(slide.L || []).concat(slide.R || []);
  slide.duration = _ppxSynthDuration(allb);
  const title = allb.find((b) => b && b.type === "heading");
  if (title) slide.title = String(title.text).slice(0, 60);
  return slide;
}

// ============================================================================
// 22. PUBLIC ENTRY — pptxToVelaDeck(arrayBuffer) -> Promise<deck>
// ============================================================================
// Per-import parse context (scheme/clrmap/canvas) so the leaf helpers stay
// signature-light. Reset at the start of each import.
let _ppxCtx = { scheme: {}, clrmap: {}, W: 9144000, H: 6858000 };

async function pptxToVelaDeck(arrayBuffer) {
  if (!arrayBuffer || (arrayBuffer.byteLength != null && arrayBuffer.byteLength === 0)) {
    throw new Error("pptx import: empty input");
  }
  const entries = await _ppxUnzip(arrayBuffer);
  const zip = _ppxMakeZip(entries);
  if (!zip.has("ppt/presentation.xml")) throw new Error("pptx import: not a .pptx (missing ppt/presentation.xml)");

  const names = zip.names();

  // theme -> color scheme + accent
  const themeName = names.find((n) => n.indexOf("ppt/theme/theme") === 0);
  const scheme = themeName ? _ppxParseClrScheme(zip.text(themeName)) : {};
  const accent = "#" + (scheme.accent1 || "3B82F6");

  // clrMap from master
  const clrmap = { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" };
  const masterName = names.find((n) => n.indexOf("ppt/slideMasters/slideMaster") === 0);
  if (masterName) {
    const mroot = _ppxParseXml(zip.text(masterName)).documentElement;
    const cm = _ppxDescend(mroot, "clrMap");
    if (cm) for (const slot of ["bg1", "tx1", "bg2", "tx2"]) { const v = _ppxAttr(cm, slot); if (v) clrmap[slot] = v; }
  }

  const pres = _ppxParseXml(zip.text("ppt/presentation.xml")).documentElement;
  const sldSz = _ppxDescend(pres, "sldSz");
  const W = sldSz ? parseInt(_ppxAttr(sldSz, "cx"), 10) : 9144000;
  const H = sldSz ? parseInt(_ppxAttr(sldSz, "cy"), 10) : 6858000;
  const fontScale = _ppxUniScale(W, H) * _PPX_EMU_PER_PX;

  _ppxCtx = { scheme, clrmap, W, H };

  // ordered slide parts via presentation rels + sldIdLst
  const presRels = _ppxLoadRels(zip, "ppt/presentation.xml");
  const slideParts = [];
  for (const sid of _ppxKids(_ppxDescend(pres, "sldIdLst"), "sldId")) {
    const relId = _ppxRelId(sid);
    if (relId && presRels[relId]) slideParts.push(presRels[relId].target);
  }

  const masterGeo = masterName ? _ppxBuildPhGeometry(zip.text(masterName)) : {};
  const layoutCache = {};

  const stats = { shapes: 0, clean: 0, lossy: 0, dropped: 0, srcChars: 0, notesSlides: 0 };
  const notes = new Set();
  const fixes = [0];
  const slidesJson = [];

  for (const spPath of slideParts) {
    if (!zip.has(spPath)) continue;
    const sld = _ppxParseXml(zip.text(spPath)).documentElement;
    for (const t of _ppxDescendAll(sld, "t")) if (t.textContent) stats.srcChars += t.textContent.length;

    const srels = _ppxLoadRels(zip, spPath);
    const phGeo = Object.assign({}, masterGeo);
    for (const rid in srels) {
      const rel = srels[rid];
      if (/\/slideLayout$/.test(rel.type)) {
        if (!(rel.target in layoutCache)) { try { layoutCache[rel.target] = zip.has(rel.target) ? _ppxBuildPhGeometry(zip.text(rel.target)) : {}; } catch (e) { layoutCache[rel.target] = {}; } }
        Object.assign(phGeo, layoutCache[rel.target]);
      }
    }

    const deckMedia = {};
    for (const rid in srels) {
      const rel = srels[rid];
      if (/\/image$/.test(rel.type) && !rel.external && zip.has(rel.target)) {
        deckMedia[rid] = { bytes: zip.bytes(rel.target), ext: rel.target.split(".").pop().toLowerCase(), target: rel.target };
      }
    }

    let shapes = [];
    _ppxCollectShapes(_ppxDescend(sld, "spTree"), phGeo, shapes, null);

    // resolve chart / SmartArt text (net-new; attach ready blocks to the shape)
    for (const s of shapes) if (s.kind === "chart" && (s.chartRid || s.dmRid)) s.graphicBlocks = _ppxGraphicBlocks(s, zip, srels);

    // background: explicit <p:bg>, else a full-bleed backdrop rect, else fallback.
    const det = _ppxDetectBg(shapes, W, H);
    const bg = _ppxSlideBg(sld) || det.color || "#f8fafc";
    if (det.bgShapes.length) { const bgSet = new Set(det.bgShapes); shapes = shapes.filter((s) => !bgSet.has(s)); }
    const defaultColor = _ppxLuminance(bg) < 0.5 ? "#e8edf4" : "#1e293b";

    stats.shapes += shapes.filter((s) => s.kind !== "decor").length;

    const slide = _ppxBuildSlide(shapes, W, H, bg, defaultColor, accent, fontScale, stats, notes, deckMedia);

    const notesText = _ppxExtractNotes(zip, srels);
    if (notesText) { slide.notes = notesText; stats.notesSlides++; }

    const salv = _ppxSalvageDroppedText(slide, shapes);
    if (salv) { stats.salvaged = (stats.salvaged || 0) + salv; notes.add("salvaged " + salv + " dropped text run(s)"); }
    _ppxSplitOversizedGrids(slide);
    _ppxFixLegibility(slide, fixes);
    slidesJson.push(slide);
  }

  // deck title: docProps/core.xml <dc:title>, else generic (caller overrides w/ filename).
  let deckTitle = "Imported Presentation";
  if (zip.has("docProps/core.xml")) {
    try {
      const core = _ppxParseXml(zip.text("docProps/core.xml")).documentElement;
      const t = _ppxDescend(core, "title");
      if (t && t.textContent && t.textContent.trim()) deckTitle = t.textContent.trim().slice(0, 120);
    } catch (e) { /* ignore */ }
  }

  const deck = {
    deckTitle,
    lanes: [{ title: "Imported", items: [{ title: deckTitle, status: "todo", slides: slidesJson.length ? slidesJson : [{ bg: "#0f172a", color: "#e2e8f0", accent, duration: 30, blocks: [{ type: "text", text: "(empty presentation)", size: "sm" }] }] }] }],
  };
  // non-enumerable stats for dev harnesses; never serialized / seen by the sanitizer.
  try { Object.defineProperty(deck, "_ppxStats", { value: { stats, notes: Array.from(notes), legibilityFixes: fixes[0] }, enumerable: false }); } catch (e) { /* ignore */ }
  return deck;
}
