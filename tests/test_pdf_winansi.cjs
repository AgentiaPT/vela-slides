/**
 * Vela Slides — vector PDF WinAnsi glyph-metric regression test (CR5).
 *
 * Defect: characters whose Unicode code point is above U+00FF but that DO have a
 * real WinAnsi byte (€, the curly quotes, the dashes, …, ™, Š, Œ) were treated as
 * "emoji". They were cut out of the PDF text layer and painted as a square canvas
 * bitmap squeezed into the glyph's narrow advance box, so they looked thin and
 * vertically stretched next to ordinary digits. The run-width correction also
 * measured them with a 500/1000 default instead of the font's own metric.
 *
 * This test builds a REAL PDF with the real exporter (buildVectorPdf) and the
 * real embedded TrueType font, then reads the produced bytes back:
 *   1. the € is in the text layer, written as its WinAnsi byte (0x80);
 *   2. the advance width the exporter accounts for that byte equals the font's
 *      own hmtx metric for U+20AC — not the 500 default, not a neighbour's width;
 *   3. accented Latin-1 letters (Portuguese decks) keep their own metrics;
 *   4. a character with no WinAnsi byte and no ASCII substitute still takes the
 *      image path, so real emoji are unaffected.
 *
 * Runs in plain Node: buildVectorPdf and parseTTF need no DOM.
 *
 * Usage: node tests/test_pdf_winansi.cjs
 * Prints "N passed, M failed" and exits non-zero on any failure.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const PARTS = path.join(__dirname, "..", "src", "parts");
const extractSrc = fs.readFileSync(path.join(PARTS, "part-pdf-extract.jsx"), "utf8");
const vectorSrc = fs.readFileSync(path.join(PARTS, "part-pdf-vector.jsx"), "utf8");
const fontsSrc = fs.readFileSync(path.join(PARTS, "part-pdf-fonts.jsx"), "utf8");

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✅ " + n); };
const bad = (n, d) => { fail++; console.log("  ❌ " + n + (d ? " — " + d : "")); };

// ── Pull the real declarations out of the part files (same recipe as
//    tests/test_export_robustness.cjs) — no copies of the code under test. ──
function braceSlice(src, startIdx) {
  let i = src.indexOf("{", startIdx), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(startIdx, i);
}
function fn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  return braceSlice(src, start);
}
// A `const` declared inside eval() stays in the eval's own scope, so the object
// and array literals are evaluated as EXPRESSIONS and bound here instead.
function constLiteral(src, name, open, close) {
  const start = src.indexOf(`const ${name} = ${open}`);
  if (start < 0) throw new Error(`const ${name} not found`);
  let i = src.indexOf(open, start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close) { depth--; if (depth === 0) { i++; break; } }
  }
  return "(" + src.slice(src.indexOf(open, start), i) + ")";
}

/* eslint-disable no-eval */
const WINANSI_FROM_UNICODE = eval(constLiteral(extractSrc, "WINANSI_FROM_UNICODE", "{", "}"));
const PDF_ASCII_SUBSTITUTIONS = eval(constLiteral(extractSrc, "PDF_ASCII_SUBSTITUTIONS", "{", "}"));
const FONT_FILES = eval(constLiteral(vectorSrc, "FONT_FILES", "[", "]"));
const COMPRESSED_FONTS = eval(constLiteral(fontsSrc, "COMPRESSED_FONTS", "{", "}"));
eval(fn(extractSrc, "winAnsiByte"));
eval(fn(extractSrc, "pdfStringEncode"));
eval(fn(extractSrc, "isEmojiCodepoint"));
eval(fn(vectorSrc, "parseTTF"));
eval(fn(vectorSrc, "pickFont"));
eval(fn(vectorSrc, "buildVectorPdf"));
/* eslint-enable no-eval */

// ── Load the real DM Sans Regular (F1, the body font) from the embedded blob ──
function loadParsedFont(file) {
  const b64 = COMPRESSED_FONTS[file];
  if (!b64) return null;
  const buf = zlib.inflateSync(Buffer.from(b64, "base64"));
  return parseTTF(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const parsedF1 = loadParsedFont("DMSans-Regular.ttf");
if (!parsedF1) {
  console.log("  ❌ embedded DMSans-Regular.ttf missing from COMPRESSED_FONTS");
  process.exit(2);
}
const fonts = FONT_FILES.map((f, i) => (i === 0 ? { ...f, parsed: parsedF1 } : null));

// Width (per 1000 units of em) the PDF /Widths array gives a WinAnsi byte.
const widthOfByte = (byte) => parsedF1.widths[byte - 32];

// ── 1. Encoding: € must become the WinAnsi byte, not vanish, not become UTF-8 ──
{
  const enc = pdfStringEncode("€2,170");
  if (enc === "(\\2002,170)") ok("pdfStringEncode writes € as WinAnsi byte 0x80 (octal \\200)");
  else bad("pdfStringEncode € encoding", JSON.stringify(enc));
}
{
  // Portuguese accented letters are Latin-1 — they must stay octal-escaped.
  const enc = pdfStringEncode("Preço à vista");
  if (enc === "(Pre\\347o \\340 vista)") ok("Latin-1 accents (ç, à) keep their own WinAnsi bytes");
  else bad("pdfStringEncode accent encoding", JSON.stringify(enc));
}
{
  // One code point above U+00FF for each WinAnsi slot we claim to support.
  const cases = [[0x20AC, "\\200"], [0x2026, "\\205"], [0x2019, "\\222"],
                 [0x2014, "\\227"], [0x2122, "\\231"], [0x0153, "\\234"]];
  let good = true;
  for (const [cp, want] of cases) {
    if (pdfStringEncode(String.fromCodePoint(cp)) !== "(" + want + ")") {
      good = false;
      bad("WinAnsi encoding of U+" + cp.toString(16).toUpperCase(), "expected " + want);
    }
  }
  if (good) ok("every above-U+00FF WinAnsi character encodes to its own byte");
}

// ── 2. Text-or-image routing must agree with the encoder ──
{
  const textCps = [0x20AC, 0x2026, 0x2019, 0x2014, 0x2122, 0x0160, 0x2192];
  const imageCps = [0x2705, 0x1F600, 0x4E2D];
  const wrongText = textCps.filter((cp) => isEmojiCodepoint(cp));
  const wrongImage = imageCps.filter((cp) => !isEmojiCodepoint(cp));
  if (!wrongText.length) ok("WinAnsi/ASCII-substitutable characters take the text path");
  else bad("characters still routed to the emoji image path", wrongText.map((c) => c.toString(16)).join(","));
  if (!wrongImage.length) ok("true emoji and non-WinAnsi scripts still take the image path");
  else bad("characters wrongly routed to the text path", wrongImage.map((c) => c.toString(16)).join(","));
}
{
  // The two maps are the contract between encoder and router: every code point
  // the router calls "text" must actually encode to something.
  const bad1 = Object.keys(WINANSI_FROM_UNICODE).map(Number)
    .concat(Object.keys(PDF_ASCII_SUBSTITUTIONS).map(Number))
    .filter((cp) => pdfStringEncode(String.fromCodePoint(cp)) === "()");
  if (!bad1.length) ok("no code point is called text by the router and dropped by the encoder");
  else bad("code points dropped by pdfStringEncode", bad1.map((c) => c.toString(16)).join(","));
}

// ── 3. Build a REAL PDF and read the advance widths back out of it ──
const FONT_SIZE = 32;
const TEXT = "€2,170";
// run.w is the DOM width the browser measured. Feed the exporter the width the
// font itself implies, so a correct exporter needs no Tc correction at all; a
// wrong per-glyph metric shows up as a non-zero Tc.
const trueWidth = [...TEXT].reduce((w, ch) => w + widthOfByte(winAnsiByte(ch.codePointAt(0))) * FONT_SIZE / 1000, 0);
const page = {
  boxes: [], circles: [], svgIcons: [], links: [], emojiImages: [], logoImages: [],
  textRuns: [{
    text: TEXT, x: 40, y: 60, w: trueWidth, fontSize: FONT_SIZE,
    fontFamily: "DM Sans", fontWeight: 400, fontStyle: "normal", letterSpacing: 0,
    color: { r: 0, g: 0, b: 0 },
  }],
};
const pdfBytes = buildVectorPdf([page], 960, 540, fonts, false);
const pdfBuf = Buffer.from(pdfBytes);
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-winansi-"));
const outPdf = path.join(outDir, "euro.pdf");
fs.writeFileSync(outPdf, pdfBuf);

const latin = pdfBuf.toString("latin1");
if (latin.startsWith("%PDF-") && latin.includes("%%EOF")) ok("exporter produced a well-formed PDF file");
else bad("produced file is not a PDF", outPdf);

// The content stream is uncompressed in this builder, so the text operators are
// readable directly. Find the "(...) Tj" that carries our run.
const tj = latin.match(/\(((?:\\.|[^()\\])*)\)\s*Tj/);
if (!tj) {
  bad("no text-showing operator in the produced PDF", "content stream has no (...) Tj");
} else {
  const shown = tj[1];
  if (shown === "\\2002,170") ok("PDF text layer carries € as WinAnsi byte 0x80 beside the digits");
  else bad("PDF text layer string", JSON.stringify(shown));

  // Decode the shown string back to WinAnsi bytes and sum the /Widths entries
  // the font object declares for exactly those bytes.
  const bytes = [];
  for (let i = 0; i < shown.length; i++) {
    if (shown[i] === "\\") {
      const oct = shown.slice(i + 1, i + 4);
      if (/^[0-7]{3}$/.test(oct)) { bytes.push(parseInt(oct, 8)); i += 3; continue; }
      bytes.push(shown.charCodeAt(++i)); continue;
    }
    bytes.push(shown.charCodeAt(i));
  }
  // /Widths of the F1 font object, as actually written into the file.
  const wm = latin.match(/\/BaseFont \/DMSans-Regular \/FirstChar 32 \/LastChar 255 \/Widths \[([^\]]*)\]/);
  if (!wm) {
    bad("F1 font object /Widths not found in the produced PDF");
  } else {
    const declared = wm[1].trim().split(/\s+/).map(Number);
    const euroWidth = declared[0x80 - 32];
    const realEuro = widthOfByte(0x80);
    if (euroWidth === realEuro && euroWidth !== 500 && euroWidth > 0) {
      ok(`PDF /Widths gives € the font's own metric (${euroWidth}/1000, not the 500 default)`);
    } else {
      bad("PDF /Widths entry for €", `declared ${euroWidth}, font metric ${realEuro}`);
    }
    // The advance the PDF actually lays out = declared widths + the Tc the
    // exporter wrote. It must match the DOM width the run asked for.
    const tcm = latin.match(/(-?[\d.]+) Tc/);
    const tc = tcm ? parseFloat(tcm[1]) : 0;
    const advance = bytes.reduce((w, b) => w + (declared[b - 32] || 0) * FONT_SIZE / 1000, 0)
      + tc * (TEXT.length - 1);
    const drift = Math.abs(advance - trueWidth);
    if (drift <= 0.05) {
      ok(`laid-out advance matches the font metrics (drift ${drift.toFixed(3)}pt over ${trueWidth.toFixed(2)}pt)`);
    } else {
      bad("laid-out advance width drifts from the font metrics",
          `advance ${advance.toFixed(2)}pt vs expected ${trueWidth.toFixed(2)}pt (Tc ${tc})`);
    }
    if (Math.abs(tc) <= 0.01) {
      ok("no spacing correction is applied when the run already matches the real metrics");
    } else {
      bad("exporter still corrects spacing for a correctly measured run", `Tc ${tc}`);
    }
  }
}

// ── 4. Accented Latin + a WinAnsi typographic char in one run ──
{
  const t2 = "Preço — 1.000";
  const w2 = [...t2].reduce((w, ch) => w + widthOfByte(winAnsiByte(ch.codePointAt(0))) * 24 / 1000, 0);
  const p2 = {
    boxes: [], circles: [], svgIcons: [], links: [], emojiImages: [], logoImages: [],
    textRuns: [{
      text: t2, x: 10, y: 20, w: w2, fontSize: 24, fontFamily: "DM Sans",
      fontWeight: 400, fontStyle: "normal", letterSpacing: 0, color: { r: 0, g: 0, b: 0 },
    }],
  };
  const l2 = Buffer.from(buildVectorPdf([p2], 960, 540, fonts, false)).toString("latin1");
  const m2 = l2.match(/\(((?:\\.|[^()\\])*)\)\s*Tj/);
  if (m2 && m2[1] === "Pre\\347o \\227 1.000") ok("accented Latin and an em dash share one correctly encoded run");
  else bad("mixed accent + em dash run", m2 ? JSON.stringify(m2[1]) : "no Tj");
  const tc2 = l2.match(/(-?[\d.]+) Tc/);
  if (!tc2 || Math.abs(parseFloat(tc2[1])) <= 0.01) ok("mixed run needs no spacing correction");
  else bad("mixed run spacing correction", tc2[1]);
}

// ── 5. A character the text layer cannot carry must not take the rest of the
//      line with it. The exporter cuts such a character out of the WinAnsi run
//      and draws it as a bitmap; everything after it must still be drawn. A
//      Portuguese, Polish or mixed-script deck otherwise loses a whole line.
{
  // Same segmentation rule extractTextRuns applies: a maximal run of code
  // points the text layer can carry becomes one run, and each code point it
  // cannot carry goes to the bitmap path.
  const segmentLine = (line) => {
    const segs = [];
    let i = 0;
    while (i < line.length) {
      const cp = line.codePointAt(i);
      const cl = cp > 0xFFFF ? 2 : 1;
      if (isEmojiCodepoint(cp)) { i += cl; continue; }
      let end = i;
      while (end < line.length) {
        const nc = line.codePointAt(end);
        if (isEmojiCodepoint(nc)) break;
        end += nc > 0xFFFF ? 2 : 1;
      }
      const seg = line.substring(i, end).trim();
      if (seg) segs.push(seg);
      i = end;
    }
    return segs;
  };

  // Greek, CJK and a Latin letter above U+00FF, each followed by more text.
  const LINE = "EUR €1,234.56 café naïve … ™ Ω 中文 Łódź TAIL-ASCII-AFTER";
  const segs = segmentLine(LINE);
  const FS5 = 24;
  const runs = [];
  let rx = 20;
  for (const seg of segs) {
    const w = [...seg].reduce((a, ch) => a + (widthOfByte(winAnsiByte(ch.codePointAt(0))) || 500) * FS5 / 1000, 0);
    runs.push({
      text: seg, x: rx, y: 60, w, fontSize: FS5, fontFamily: "DM Sans",
      fontWeight: 400, fontStyle: "normal", letterSpacing: 0, color: { r: 0, g: 0, b: 0 },
    });
    rx += w + FS5;
  }
  const p5 = { boxes: [], circles: [], svgIcons: [], links: [], emojiImages: [], logoImages: [], textRuns: runs };
  const l5 = Buffer.from(buildVectorPdf([p5], 960, 540, fonts, false)).toString("latin1");
  const shown5 = [...l5.matchAll(/\(((?:\\.|[^()\\])*)\)\s*Tj/g)].map((m) => m[1]);

  // The regression: ordinary text placed AFTER the last unrenderable character.
  if (shown5.includes("TAIL-ASCII-AFTER")) {
    ok("text after an unrenderable character still reaches the PDF text layer");
  } else {
    bad("text after an unrenderable character was lost", JSON.stringify(shown5));
  }
  // A Latin-1 letter that merely FOLLOWS an unrenderable one is well inside the
  // range the text layer handles — it must not be lost by association.
  if (shown5.includes("\\363d")) {
    ok("a Latin-1 letter following an unrenderable character keeps its own byte");
  } else {
    bad("Latin-1 letter after an unrenderable character", JSON.stringify(shown5));
  }
  // …and the WinAnsi head of the same line is unchanged.
  if (shown5.some((s) => s.startsWith("EUR \\2001,234.56 caf\\351 na\\357ve \\205 \\231"))) {
    ok("the WinAnsi part of the same line keeps its own bytes");
  } else {
    bad("WinAnsi head of the mixed line", JSON.stringify(shown5));
  }
  // The encoder itself must never stop early at an unencodable code point.
  const encTail = pdfStringEncode("AΩB中C");
  if (encTail === "(ABC)") ok("the encoder skips only the unencodable code point, never the tail");
  else bad("encoder truncates at an unencodable code point", JSON.stringify(encTail));
}

// ── 6. The bitmap path must draw VISIBLE ink ────────────────────────────────
// A character with no WinAnsi byte is cut out of the text layer, so the bitmap
// is the only thing left. Two ways it used to come out empty:
//   * the canvas ink colour was never set, so the glyph was painted in the
//     canvas default (opaque black) and composited onto a dark slide;
//   * a host with no font for the script drew nothing at all.
// Both produced a bitmap identical to the slide background: the character was
// in the file and invisible. renderEmojiToImage needs a canvas, so drive it
// through a recording stub and assert on the RGB bytes it returns.
const rasterSrc = fn(extractSrc, "emojiInkColor") + "\n" +
  (() => {
    const start = extractSrc.indexOf("async function renderEmojiToImage(");
    if (start < 0) throw new Error("async function renderEmojiToImage not found");
    return braceSlice(extractSrc, start);
  })();

function stubDocument(hasGlyph, rec) {
  const parseRgb = (s) => {
    const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(String(s));
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  return {
    createElement() {
      const canvas = { width: 0, height: 0 };
      let buf = null;
      const paint = (style, n) => {
        const rgb = parseRgb(style);
        if (!rgb) { rec.badStyle = style; return; }
        for (let j = 0; j < n; j++) {
          buf[j * 4] = rgb[0]; buf[j * 4 + 1] = rgb[1]; buf[j * 4 + 2] = rgb[2]; buf[j * 4 + 3] = 255;
        }
      };
      const ctx = {
        fillStyle: "#000", strokeStyle: "#000", lineWidth: 1,
        font: "", textAlign: "", textBaseline: "",
        fillText() { rec.fillStyle = ctx.fillStyle; if (hasGlyph) paint(ctx.fillStyle, 40); },
        strokeRect() { rec.strokeCalls++; rec.strokeStyle = ctx.strokeStyle; paint(ctx.strokeStyle, 25); },
        getImageData() { return { data: buf }; },
      };
      canvas.getContext = () => {
        buf = new Uint8ClampedArray(canvas.width * canvas.height * 4);
        return ctx;
      };
      return canvas;
    },
  };
}

function makeRenderer(hasGlyph, bg, rec) {
  // eslint-disable-next-line no-new-func
  const mk = new Function("document", "_compositeBg",
    "const emojiCanvasCache = new Map();\n" + rasterSrc + "\nreturn renderEmojiToImage;");
  return mk(stubDocument(hasGlyph, rec), bg);
}

(async () => {
  // A dark slide — the case where an unset ink colour is invisible.
  const BG = { r: 10 / 255, g: 15 / 255, b: 28 / 255 };
  const BGB = [10, 15, 28];
  const INK = { r: 230 / 255, g: 236 / 255, b: 255 / 255 };
  const INKB = [230, 236, 255];
  const hasTriple = (bytes, t) => {
    for (let i = 0; i + 2 < bytes.length; i += 3) {
      if (bytes[i] === t[0] && bytes[i + 1] === t[1] && bytes[i + 2] === t[2]) return true;
    }
    return false;
  };

  // (a) Host HAS the glyph: it must be painted in the text colour, not black.
  {
    const rec = { strokeCalls: 0 };
    const img = await makeRenderer(true, BG, rec)("中", 24, INK);
    if (hasTriple(img.bytes, INKB)) ok("the bitmap is painted in the colour of the text it replaces");
    else bad("bitmap ink colour", `expected rgb(${INKB}) in the produced bytes, fillStyle was ${rec.fillStyle}`);
    if (!hasTriple(img.bytes, [0, 0, 0])) ok("the bitmap no longer falls back to opaque black");
    else bad("bitmap still contains the canvas default black");
    if (rec.strokeCalls === 0) ok("no placeholder is drawn when the host can draw the character");
    else bad("placeholder drawn over a real glyph", `strokeRect called ${rec.strokeCalls}x`);
  }

  // (b) Host has NO font for the script: a visible placeholder must take over,
  //     otherwise the character is gone from both layers.
  {
    const rec = { strokeCalls: 0 };
    const img = await makeRenderer(false, BG, rec)("中", 24, INK);
    const uniform = !img.bytes.some((_, i) =>
      i % 3 === 0 && !(img.bytes[i] === BGB[0] && img.bytes[i + 1] === BGB[1] && img.bytes[i + 2] === BGB[2]));
    if (!uniform) ok("a character the host cannot draw still leaves visible ink in the bitmap");
    else bad("character the host cannot draw produced an empty bitmap");
    if (rec.strokeCalls === 1) ok("the placeholder box is drawn exactly once");
    else bad("placeholder box", `strokeRect called ${rec.strokeCalls}x`);
    if (hasTriple(img.bytes, INKB)) ok("the placeholder uses the text colour too");
    else bad("placeholder colour", `strokeStyle was ${rec.strokeStyle}`);
  }

  // (c) The bitmap cache must key on the colour: the same character in two
  //     colours is two different images.
  {
    const rec = { strokeCalls: 0 };
    const render = makeRenderer(true, BG, rec);
    const a = await render("中", 24, INK);
    const b = await render("中", 24, { r: 1, g: 0, b: 0 });
    if (!hasTriple(b.bytes, INKB) && hasTriple(b.bytes, [255, 0, 0])) {
      ok("the bitmap cache keys on the colour, so a recoloured character is redrawn");
    } else {
      bad("bitmap cache ignores the colour", "second render reused the first colour");
    }
    void a;
  }

  // (d) A non-numeric or out-of-range channel must clamp, never reach the
  //     canvas as a deck-chosen value.
  {
    const rec = { strokeCalls: 0 };
    await makeRenderer(true, BG, rec)("中", 24, { r: "rgb(1,2,3)", g: 9, b: -1 });
    if (!rec.badStyle && /^rgb\(0, 0, 0\)$/.test(String(rec.fillStyle))) {
      ok("a bad colour channel clamps to 0 instead of reaching the canvas");
    } else {
      bad("bad colour channel reached the canvas", String(rec.fillStyle));
    }
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 2 : 0);
})();
