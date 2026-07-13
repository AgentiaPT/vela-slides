/**
 * tests/test_pptx_import.cjs
 *
 * Regression test for the browser-native PowerPoint (.pptx) importer
 * (src/parts/part-pptximport.jsx): `async function pptxToVelaDeck(arrayBuffer)
 * -> Promise<velaDeck>`, and its interaction with the REAL app sanitizer
 * (`validateAndSanitizeDeck` / `sanitizeSlide`, src/parts/part-imports.jsx) —
 * the real app path on import is `validateAndSanitizeDeck(await
 * pptxToVelaDeck(buf))` before the deck is ever rendered.
 *
 * Technique: mirrors tests/test_reducer.cjs's `new Function` sandbox-eval —
 * read the real source files, eval them once in one sandbox, and exercise the
 * live function handles. No bundler, no browser, no Playwright. The importer
 * is browser-native (hand-rolled ZIP reader + native DOMParser/Decompression-
 * Stream/btoa; see part-pptximport.jsx's header comment), so it needs a real
 * DOMParser — jsdom supplies one. DecompressionStream/Blob/Response/
 * TextDecoder/btoa/crypto.randomUUID are already global in this Node runtime.
 * The importer's helpers are all `_ppx`/`_PPX_`-prefixed and the sanitizer
 * slice uses plain names (verified disjoint — see the two are combined into
 * one Function body below), so both live safely in a single sandbox scope,
 * exactly like the real app.
 *
 * Fixture: a small SYNTHETIC .pptx built in-memory as a STORE-only (method 0)
 * ZIP — no deflate implementation needed, matching the note in the importer
 * that pptx entries may be STORE or raw-DEFLATE and the importer must handle
 * both. CRC-32 is never validated anywhere on the import path (confirmed by
 * reading _ppxUnzip), so the synthetic archive ships zeroed CRC fields, same
 * as tests/test_pptx_export.cjs's STORE-zip reader already tolerates on the
 * export side. No real deck content or media — every string in the fixture
 * is a synthetic MARKER token invented for this test.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const P = (f) => path.join(ROOT, "src/parts", f);

// The importer's real XML engine is native DOMParser; jsdom supplies the
// equivalent here. Referenced as a free global inside part-pptximport.jsx's
// functions, so it only needs to exist by the time pptxToVelaDeck() runs.
global.DOMParser = new JSDOM("").window.DOMParser;

// ---- tiny assertion harness (matches test_reducer.cjs's print/exit contract) ----
let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✅ " + n); };
const bad = (n, d) => { fail++; console.log("  ❌ " + n + (d ? " — " + d : "")); };
const assert = (n, cond, d) => (cond ? ok(n) : bad(n, d));

// ============================================================================
// 1. Sandbox-eval the REAL importer + the REAL sanitizer slice together.
// ============================================================================
const importerSrc = fs.readFileSync(P("part-pptximport.jsx"), "utf8");
const importsSrc = fs.readFileSync(P("part-imports.jsx"), "utf8");

// Same contiguous pure-helper slice test_reducer.cjs extracts: every sanitizer
// fn we need (sanitizeString/sanitizeBlock/sanitizeSlide/sanitizeItem/
// validateAndSanitizeDeck/scrubColorFields/...) lives inside it, no browser
// calls at *definition* time (only at call time, inside functions we do call:
// sanitizeSvgMarkup/sanitizeImageDataUri use DOMParser — already patched above).
const sliceStart = importsSrc.indexOf("const uid = () => crypto.randomUUID");
const sliceEnd = importsSrc.indexOf("// ━━━ Themes");
if (sliceStart < 0 || sliceEnd < 0 || sliceEnd <= sliceStart) {
  console.error("FATAL: could not locate sanitizer helper-slice markers in part-imports.jsx");
  process.exit(1);
}
const sanitizerSlice = importsSrc.slice(sliceStart, sliceEnd);

const prelude = `
  var VELA_PRESENTATION_MODE = false;
  var dbg = function () {};
  var crypto = (typeof globalThis !== "undefined" && globalThis.crypto) ? globalThis.crypto : {};
`;

const combined = prelude + "\n" + importerSrc + "\n" + sanitizerSlice + "\n" +
  "; return { pptxToVelaDeck, validateAndSanitizeDeck, sanitizeSlide, _ppxSplitOversizedGrids, _ppxSalvageDroppedText };";

let API;
try {
  // eslint-disable-next-line no-new-func
  API = Function(combined)();
} catch (e) {
  console.error("FATAL: sandbox eval failed:", (e && e.stack) || e);
  process.exit(1);
}
const { pptxToVelaDeck, validateAndSanitizeDeck, sanitizeSlide } = API;

// ============================================================================
// 2. Minimal STORE-only ZIP writer. pptxToVelaDeck's own unzip reader
//    (_ppxUnzip) handles method-0 (STORE) entries synchronously — no deflate
//    implementation is needed for this fixture. Field layout mirrors the ZIP
//    local-file-header / central-directory / EOCD structures _ppxUnzip parses
//    byte-for-byte (verified against its offsets: localOff+26/28 for name/
//    extra length, central-record p+10/20/28/30/32/42/46, EOCD+10/+16).
// ============================================================================
function u16le(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; }
function u32le(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }

function buildStoreZip(entries) {
  // entries: [[name, Buffer], ...]
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const localHeader = Buffer.concat([
      u32le(0x04034b50), u16le(20) /* version needed */, u16le(0) /* flag */,
      u16le(0) /* method: STORE */, u16le(0) /* mod time */, u16le(0) /* mod date */,
      u32le(0) /* crc-32: unchecked by _ppxUnzip */, u32le(data.length), u32le(data.length),
      u16le(nameBuf.length), u16le(0) /* extra len */,
    ]);
    localChunks.push(localHeader, nameBuf, data);
    const centralHeader = Buffer.concat([
      u32le(0x02014b50), u16le(20) /* version made by */, u16le(20) /* version needed */,
      u16le(0) /* flag */, u16le(0) /* method */, u16le(0) /* mod time */, u16le(0) /* mod date */,
      u32le(0) /* crc-32 */, u32le(data.length), u32le(data.length),
      u16le(nameBuf.length), u16le(0) /* extra len */, u16le(0) /* comment len */,
      u16le(0) /* disk num */, u16le(0) /* internal attrs */, u32le(0) /* external attrs */,
      u32le(offset) /* relative offset of local header */,
    ]);
    centralChunks.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + data.length;
  }
  const localBuf = Buffer.concat(localChunks);
  const centralBuf = Buffer.concat(centralChunks);
  const eocd = Buffer.concat([
    u32le(0x06054b50), u16le(0) /* disk num */, u16le(0) /* disk w/ CD start */,
    u16le(entries.length) /* entries this disk */, u16le(entries.length) /* entries total */,
    u32le(centralBuf.length) /* size of CD */, u32le(localBuf.length) /* offset of CD */,
    u16le(0) /* comment len */,
  ]);
  return Buffer.concat([localBuf, centralBuf, eocd]);
}

// ============================================================================
// 3. Synthetic .pptx fixture — minimal OPC package, 3 slides, a table, an
//    embedded tiny PNG, and speaker notes. Every distinctive string below is
//    a synthetic MARKER invented for this test (no real deck content).
// ============================================================================
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

const CONTENT_TYPES = XML_HEADER +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Default Extension="png" ContentType="image/png"/>' +
  '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
  '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
  '<Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
  '<Override PartName="/ppt/slides/slide3.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
  '<Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>' +
  '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
  '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
  '</Types>';

const ROOT_RELS = XML_HEADER +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
  '</Relationships>';

const PRESENTATION_XML = XML_HEADER +
  `<p:presentation ${NS}>` +
  '<p:sldIdLst>' +
  '<p:sldId id="256" r:id="rId1"/>' +
  '<p:sldId id="257" r:id="rId2"/>' +
  '<p:sldId id="258" r:id="rId3"/>' +
  '</p:sldIdLst>' +
  '<p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>' +
  '</p:presentation>';

const PRESENTATION_RELS = XML_HEADER +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>' +
  '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide3.xml"/>' +
  '</Relationships>';

const THEME1_XML = XML_HEADER +
  '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="SyntheticTestTheme">' +
  '<a:themeElements><a:clrScheme name="Synthetic">' +
  '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>' +
  '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="1F1F1F"/></a:dk2>' +
  '<a:lt2><a:srgbClr val="EEEEEE"/></a:lt2>' +
  '<a:accent1><a:srgbClr val="3B82F6"/></a:accent1>' +
  '<a:accent2><a:srgbClr val="10B981"/></a:accent2>' +
  '<a:accent3><a:srgbClr val="F59E0B"/></a:accent3>' +
  '<a:accent4><a:srgbClr val="EF4444"/></a:accent4>' +
  '<a:accent5><a:srgbClr val="8B5CF6"/></a:accent5>' +
  '<a:accent6><a:srgbClr val="EC4899"/></a:accent6>' +
  '<a:hlink><a:srgbClr val="0563C1"/></a:hlink>' +
  '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink>' +
  '</a:clrScheme></a:themeElements>' +
  '</a:theme>';

const DOCPROPS_CORE = XML_HEADER +
  '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
  '<dc:title>Synthetic Test Deck</dc:title>' +
  '</cp:coreProperties>';

// Slide 1 — title + bulleted body (text-loss coverage: ALPHA_MARKER_TEXT_ONE).
const SLIDE1_XML = XML_HEADER +
  `<p:sld ${NS}><p:cSld><p:spTree>` +
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
  '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' +
  '<p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="609600" y="365760"/><a:ext cx="10972800" cy="1143000"/></a:xfrm></p:spPr>' +
  '<p:txBody><a:bodyPr/><a:lstStyle/>' +
  '<a:p><a:r><a:rPr lang="en-US" sz="4000" b="1"/><a:t>Import Test Deck</a:t></a:r></a:p>' +
  '</p:txBody></p:sp>' +
  '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' +
  '<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="609600" y="1828800"/><a:ext cx="10972800" cy="2000000"/></a:xfrm></p:spPr>' +
  '<p:txBody><a:bodyPr/><a:lstStyle/>' +
  '<a:p><a:pPr><a:buChar char="&#8226;"/></a:pPr><a:r><a:rPr lang="en-US" sz="1800"/><a:t>ALPHA_MARKER_TEXT_ONE</a:t></a:r></a:p>' +
  '</p:txBody></p:sp>' +
  '</p:spTree></p:cSld></p:sld>';

const SLIDE1_RELS = XML_HEADER +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>' +
  '</Relationships>';

// Slide 2 — a table only (coverage: table headers/rows, no `cells` key).
const SLIDE2_XML = XML_HEADER +
  `<p:sld ${NS}><p:cSld><p:spTree>` +
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
  '<p:graphicFrame>' +
  '<p:nvGraphicFramePr><p:cNvPr id="2" name="Table 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>' +
  '<p:xfrm><a:off x="609600" y="1200000"/><a:ext cx="6000000" cy="2000000"/></p:xfrm>' +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">' +
  '<a:tbl><a:tblPr firstRow="1"/>' +
  '<a:tblGrid><a:gridCol w="3000000"/><a:gridCol w="3000000"/></a:tblGrid>' +
  '<a:tr h="370000">' +
  '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>TABLE_HEADER_METRIC</a:t></a:r></a:p></a:txBody></a:tc>' +
  '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>TABLE_HEADER_VALUE</a:t></a:r></a:p></a:txBody></a:tc>' +
  '</a:tr>' +
  '<a:tr h="370000">' +
  '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>TABLE_MARKER_LATENCY</a:t></a:r></a:p></a:txBody></a:tc>' +
  '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>TABLE_MARKER_42MS</a:t></a:r></a:p></a:txBody></a:tc>' +
  '</a:tr>' +
  '</a:tbl></a:graphicData></a:graphic>' +
  '</p:graphicFrame>' +
  '</p:spTree></p:cSld></p:sld>';

// Slide 3 — title + embedded raster image (coverage: image block src, alt text).
const SLIDE3_XML = XML_HEADER +
  `<p:sld ${NS}><p:cSld><p:spTree>` +
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
  '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' +
  '<p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="609600" y="365760"/><a:ext cx="10972800" cy="1143000"/></a:xfrm></p:spPr>' +
  '<p:txBody><a:bodyPr/><a:lstStyle/>' +
  '<a:p><a:r><a:rPr lang="en-US" sz="4000" b="1"/><a:t>IMAGE_SLIDE_MARKER</a:t></a:r></a:p>' +
  '</p:txBody></p:sp>' +
  '<p:pic>' +
  '<p:nvPicPr><p:cNvPr id="3" name="Picture 1" descr="Picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>' +
  '<p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
  '<p:spPr><a:xfrm><a:off x="3000000" y="2200000"/><a:ext cx="2000000" cy="2000000"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
  '</p:pic>' +
  '</p:spTree></p:cSld></p:sld>';

const SLIDE3_RELS = XML_HEADER +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>' +
  '</Relationships>';

// Speaker notes (coverage: slide.notes).
const NOTES_SLIDE1_XML = XML_HEADER +
  `<p:notes ${NS}><p:cSld><p:spTree>` +
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
  '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' +
  '<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>' +
  '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>SPEAKER_NOTE_MARKER_TEXT</a:t></a:r></a:p></p:txBody>' +
  '</p:sp>' +
  '</p:spTree></p:cSld></p:notes>';

// 1x1 transparent PNG (well-known minimal fixture, not real media).
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const PNG_BYTES = Buffer.from(PNG_BASE64, "base64");

function buildSyntheticPptx() {
  const entries = [
    ["[Content_Types].xml", Buffer.from(CONTENT_TYPES, "utf8")],
    ["_rels/.rels", Buffer.from(ROOT_RELS, "utf8")],
    ["ppt/presentation.xml", Buffer.from(PRESENTATION_XML, "utf8")],
    ["ppt/_rels/presentation.xml.rels", Buffer.from(PRESENTATION_RELS, "utf8")],
    ["ppt/theme/theme1.xml", Buffer.from(THEME1_XML, "utf8")],
    ["ppt/slides/slide1.xml", Buffer.from(SLIDE1_XML, "utf8")],
    ["ppt/slides/_rels/slide1.xml.rels", Buffer.from(SLIDE1_RELS, "utf8")],
    ["ppt/slides/slide2.xml", Buffer.from(SLIDE2_XML, "utf8")],
    ["ppt/slides/slide3.xml", Buffer.from(SLIDE3_XML, "utf8")],
    ["ppt/slides/_rels/slide3.xml.rels", Buffer.from(SLIDE3_RELS, "utf8")],
    ["ppt/notesSlides/notesSlide1.xml", Buffer.from(NOTES_SLIDE1_XML, "utf8")],
    ["ppt/media/image1.png", PNG_BYTES],
    ["docProps/core.xml", Buffer.from(DOCPROPS_CORE, "utf8")],
  ];
  return buildStoreZip(entries);
}

const MARKERS = [
  "ALPHA_MARKER_TEXT_ONE", "IMAGE_SLIDE_MARKER", "SPEAKER_NOTE_MARKER_TEXT",
  "TABLE_HEADER_METRIC", "TABLE_HEADER_VALUE", "TABLE_MARKER_LATENCY", "TABLE_MARKER_42MS",
];
const NOTES_MARKER = "SPEAKER_NOTE_MARKER_TEXT";

// Recursively find the first block matching `pred` across a slide's blocks/
// L/R/nested grid-item blocks arrays.
function findBlock(slides, pred) {
  let found = null;
  const walk = (node) => {
    if (found || !node) return;
    if (Array.isArray(node)) { for (const n of node) { walk(n); if (found) return; } return; }
    if (typeof node !== "object") return;
    if (pred(node)) { found = node; return; }
    for (const key of ["blocks", "items", "L", "R"]) if (node[key]) walk(node[key]);
  };
  for (const s of slides || []) {
    walk(s.blocks); if (found) break;
    walk(s.L); if (found) break;
    walk(s.R); if (found) break;
  }
  return found;
}

// ============================================================================
// 4. Run.
// ============================================================================
(async () => {
  const pptxBuf = buildSyntheticPptx();

  // 1. import resolves with the right slide count / shape.
  let deck = null;
  try {
    deck = await pptxToVelaDeck(pptxBuf);
    ok("pptxToVelaDeck resolves for a valid synthetic .pptx");
  } catch (e) {
    bad("pptxToVelaDeck resolves for a valid synthetic .pptx", false, (e && e.stack) || String(e));
  }

  let slides = null;
  if (deck) {
    const items = deck.lanes && deck.lanes[0] && deck.lanes[0].items;
    slides = items && items[0] && items[0].slides;
    assert("deck has lanes[0].items[0].slides with the right slide count (3)",
      Array.isArray(deck.lanes) && deck.lanes.length >= 1 &&
      Array.isArray(items) && items.length >= 1 &&
      Array.isArray(slides) && slides.length === 3,
      `lanes=${deck.lanes && deck.lanes.length} items=${items && items.length} slides=${slides && slides.length}`);
  }

  // 2. no text loss: every marker string appears somewhere in the serialized blocks.
  if (slides) {
    const serialized = JSON.stringify(slides);
    for (const marker of MARKERS) {
      assert(`no text loss: "${marker}" present in serialized deck blocks`, serialized.indexOf(marker) !== -1);
    }
  }

  // 3. table block shape: {type:"table", headers:[...], rows:[[...]]}, no `cells` key.
  let tableBlock = null;
  if (slides) {
    tableBlock = findBlock(slides, (b) => b.type === "table");
    assert("table block found", !!tableBlock);
    if (tableBlock) {
      assert("table block shape has headers[]/rows[][] and no `cells` key",
        Array.isArray(tableBlock.headers) && Array.isArray(tableBlock.rows) && !("cells" in tableBlock),
        JSON.stringify(Object.keys(tableBlock)));
      assert("table headers/rows carry the marker text",
        JSON.stringify(tableBlock.headers).indexOf("TABLE_HEADER_METRIC") !== -1 &&
        JSON.stringify(tableBlock.rows).indexOf("TABLE_MARKER_LATENCY") !== -1 &&
        JSON.stringify(tableBlock.rows).indexOf("TABLE_MARKER_42MS") !== -1,
        JSON.stringify(tableBlock));
    }
  }

  // 4. image block shape: {type:"image", src:"data:image/png;base64,..."}.
  let imageBlock = null;
  if (slides) {
    imageBlock = findBlock(slides, (b) => b.type === "image");
    assert("image block found", !!imageBlock);
    if (imageBlock) {
      assert("image block src is a data:image/png;base64 URI",
        typeof imageBlock.src === "string" && imageBlock.src.indexOf("data:image/png;base64,") === 0,
        imageBlock.src && imageBlock.src.slice(0, 48));
    }
  }

  // 5. speaker notes land in slide.notes (string).
  if (slides) {
    const notedSlide = slides.find((s) => typeof s.notes === "string" && s.notes.indexOf(NOTES_MARKER) !== -1);
    assert("speaker notes land in slide.notes (string)", !!notedSlide,
      JSON.stringify(slides.map((s) => s.notes)));
  }

  // 6. non-.pptx bytes throw.
  try {
    await pptxToVelaDeck(new TextEncoder().encode("not a pptx"));
    bad("pptxToVelaDeck throws on non-.pptx bytes", false, "resolved instead of throwing");
  } catch (e) {
    ok("pptxToVelaDeck throws on non-.pptx bytes");
  }

  // 7. CRITICAL — sanitizer round-trip: validateAndSanitizeDeck must not drop
  //    text, the image data-URI, the table shape, or speaker notes.
  if (deck) {
    let sanitized = null;
    try {
      sanitized = validateAndSanitizeDeck(deck);
      ok("validateAndSanitizeDeck accepts the imported deck without throwing");
    } catch (e) {
      bad("validateAndSanitizeDeck accepts the imported deck without throwing", false, (e && e.stack) || String(e));
    }
    if (sanitized) {
      const sSlides = sanitized.lanes[0] && sanitized.lanes[0].items[0] && sanitized.lanes[0].items[0].slides;
      const sSerialized = JSON.stringify(sSlides);
      for (const marker of MARKERS) {
        assert(`sanitizer round-trip: "${marker}" survives validateAndSanitizeDeck`, sSerialized.indexOf(marker) !== -1);
      }
      const sImg = findBlock(sSlides, (b) => b.type === "image");
      assert("sanitizer round-trip: image data-URI src preserved",
        !!sImg && typeof sImg.src === "string" && sImg.src.indexOf("data:image/png;base64,") === 0,
        sImg && sImg.src && sImg.src.slice(0, 48));
      const sTbl = findBlock(sSlides, (b) => b.type === "table");
      assert("sanitizer round-trip: table headers+rows preserved",
        !!sTbl && Array.isArray(sTbl.headers) && Array.isArray(sTbl.rows) &&
        JSON.stringify(sTbl.headers).indexOf("TABLE_HEADER_METRIC") !== -1 &&
        JSON.stringify(sTbl.rows).indexOf("TABLE_MARKER_LATENCY") !== -1,
        JSON.stringify(sTbl));
      const sNotes = (sSlides || []).find((s) => typeof s.notes === "string" && s.notes.indexOf(NOTES_MARKER) !== -1);
      assert("sanitizer round-trip: slide.notes preserved", !!sNotes,
        JSON.stringify((sSlides || []).map((s) => s.notes)));
    }
  }

  // 7b. cols layout (slide.layout==="cols", L/R arrays) survives sanitizeSlide.
  // Constructed directly rather than coerced out of the importer's spatial-
  // clustering heuristics (unreliable to trigger deterministically from a tiny
  // synthetic deck) — this isolates the actual integration risk under test:
  // does the sanitizer itself preserve a reflow layout's L/R column arrays?
  const colsSlide = {
    bg: "#0f172a", color: "#e2e8f0", accent: "#3b82f6", duration: 30,
    layout: "cols", contentFlex: 5, imageFlex: 5,
    blocks: [{ type: "heading", text: "Cols Slide" }],
    L: [{ type: "text", text: "LEFT_COLUMN_MARKER" }],
    R: [{ type: "text", text: "RIGHT_COLUMN_MARKER" }],
  };
  const sanitizedCols = sanitizeSlide(colsSlide);
  assert("sanitizeSlide preserves cols layout's L/R arrays",
    !!sanitizedCols && sanitizedCols.layout === "cols" &&
    Array.isArray(sanitizedCols.L) && sanitizedCols.L.length === 1 &&
    Array.isArray(sanitizedCols.R) && sanitizedCols.R.length === 1,
    JSON.stringify(sanitizedCols));
  assert("sanitizeSlide preserves L/R block text (LEFT/RIGHT markers)",
    !!sanitizedCols &&
    JSON.stringify(sanitizedCols.L).indexOf("LEFT_COLUMN_MARKER") !== -1 &&
    JSON.stringify(sanitizedCols.R).indexOf("RIGHT_COLUMN_MARKER") !== -1,
    JSON.stringify(sanitizedCols));

  // ==========================================================================
  // Content-loss guards: the load-path sanitizer caps grid cells at 6, so the
  // importer must never emit an oversized grid, and must salvage any text the
  // reflow drops. (Regression guards for the "nothing visible lost" invariant.)
  // ==========================================================================
  if (typeof API._ppxSplitOversizedGrids === "function") {
    const bigGrid = { blocks: [{ type: "grid", cols: 3, gap: 18,
      items: Array.from({ length: 10 }, (_, i) => ({ blocks: [{ type: "text", text: "CELL_" + i }] })) }] };
    API._ppxSplitOversizedGrids(bigGrid);
    const grids = bigGrid.blocks.filter((b) => b.type === "grid");
    assert("oversized 10-cell grid is split into multiple grids", grids.length === 2, JSON.stringify(grids.map((g) => g.items.length)));
    assert("no split grid exceeds the 6-cell sanitizer cap", grids.every((g) => g.items.length <= 6));
    const allCells = JSON.stringify(bigGrid.blocks);
    assert("every cell survives the split (CELL_0..CELL_9 all present)",
      Array.from({ length: 10 }, (_, i) => "CELL_" + i).every((c) => allCells.indexOf(c) !== -1));
    // and the split output survives the real load-path sanitizer with all 10 cells
    const sanBig = validateAndSanitizeDeck({ lanes: [{ title: "t", items: [{ title: "t", slides: [{ bg: "#fff", blocks: bigGrid.blocks }] }] }] });
    const sanStr = JSON.stringify(sanBig);
    assert("all 10 grid cells present after validateAndSanitizeDeck (no load-path truncation)",
      Array.from({ length: 10 }, (_, i) => "CELL_" + i).every((c) => sanStr.indexOf(c) !== -1));
  }
  if (typeof API._ppxSalvageDroppedText === "function") {
    const shapes = [
      { kind: "text", paras: [{ text: "EMITTED_ALREADY" }] },
      { kind: "text", paras: [{ text: "DROPPED_BY_REFLOW" }] },
      { kind: "decor", paras: [{ text: "DECOR_IGNORED" }] },
    ];
    const slide = { blocks: [{ type: "text", text: "EMITTED_ALREADY" }] };
    const n = API._ppxSalvageDroppedText(slide, shapes);
    const s = JSON.stringify(slide.blocks);
    assert("salvage recovers text the reflow dropped", n >= 1 && s.indexOf("DROPPED_BY_REFLOW") !== -1, s);
    assert("salvage does NOT duplicate already-emitted text",
      (s.match(/EMITTED_ALREADY/g) || []).length === 1, s);
    assert("salvage ignores non-text (decor) shapes", s.indexOf("DECOR_IGNORED") === -1, s);
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
