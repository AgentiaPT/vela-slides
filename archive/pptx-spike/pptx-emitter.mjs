// ─────────────────────────────────────────────────────────────────────────
// pptx-emitter.mjs — THROWAWAY SPIKE (VELA-CR-07 de-risk, not production code)
//
// Library-free OOXML (.pptx) emitter, mirroring the hand-rolled vector-PDF
// engine in part-pdf.jsx. Proves the recommended path: a per-slide primitive
// IR (boxes / text runs / ellipses / images / SVG) -> NATIVE, EDITABLE
// PowerPoint objects (autoshapes + text boxes + pictures), packaged in a
// hand-written STORE (uncompressed) ZIP. No pptxgenjs, no python-pptx, no zip lib.
//
// IR shape (one slide):
//   { boxes:   [{x,y,w,h, fill?, radius?, line?:{w,color}}],           px coords on 960x540
//     ellipses:[{cx,cy,r, fill?, line?:{w,color}}],
//     texts:   [{x,y,w,h, text, size(px), color, bold?, italic?, font?, align?}],
//     images:  [{x,y,w,h, png:Buffer, alt?}],
//     svgs:    [{x,y,w,h, svg:string, pngFallback:Buffer}] }
//
// Units: Vela canvas is 960x540 px; a 16:9 PPT slide is 12192000x6858000 EMU,
//        so 1px = 12700 EMU exactly. Font px -> centipoints: round(px*0.75*100).
// ─────────────────────────────────────────────────────────────────────────
import { deflateRawSync, crc32 } from 'node:zlib';

const EMU_PER_PX = 12700;
const SLIDE_W_PX = 960, SLIDE_H_PX = 540;
const emu = (px) => Math.round(px * EMU_PER_PX);
const cpt = (px) => Math.round(px * 0.75 * 100); // px -> centipoints
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hex = (c) => String(c || '#000000').replace('#', '').slice(0, 6).padStart(6, '0').toUpperCase();

// ── minimal STORE/deflate ZIP writer (no external dep) ─────────────────────
// Node's zlib gives us crc32 + raw deflate; we assemble the ZIP container by hand.
function zip(files) {
  // files: [{name, data:Buffer}]
  const enc = (s) => Buffer.from(s, 'utf8');
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = enc(f.name);
    const raw = Buffer.isBuffer(f.data) ? f.data : enc(f.data);
    const comp = deflateRawSync(raw);
    const useDeflate = comp.length < raw.length;
    const body = useDeflate ? comp : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0, 6);            // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);           // mod time
    local.writeUInt16LE(0x21, 12);        // mod date (arbitrary, deterministic)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);             // version made by
    cen.writeUInt16LE(20, 6);             // version needed
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0x21, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cen, nameBuf]));

    offset += local.length + nameBuf.length + body.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, end]);
}

// ── DrawingML fragment builders ────────────────────────────────────────────
const xfrm = (x, y, w, h) =>
  `<a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>`;

function spBox(id, b) {
  const fill = b.fill ? `<a:solidFill><a:srgbClr val="${hex(b.fill)}"/></a:solidFill>` : '<a:noFill/>';
  const line = b.line
    ? `<a:ln w="${emu(b.line.w || 1)}"><a:solidFill><a:srgbClr val="${hex(b.line.color)}"/></a:solidFill></a:ln>`
    : '<a:ln><a:noFill/></a:ln>';
  // roundRect adjust value = corner radius as fraction of min(w,h)/2, capped
  const prst = b.radius ? 'roundRect' : 'rect';
  const adj = b.radius
    ? `<a:avLst><a:gd name="adj" fmla="val ${Math.min(50000, Math.round((b.radius / Math.min(b.w, b.h)) * 100000))}"/></a:avLst>`
    : '<a:avLst/>';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Box ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr>${xfrm(b.x, b.y, b.w, b.h)}<a:prstGeom prst="${prst}">${adj}</a:prstGeom>${fill}${line}</p:spPr>`
    + `<p:txBody><a:bodyPr/><a:p/></p:txBody></p:sp>`;
}

function spEllipse(id, e) {
  const b = { x: e.cx - e.r, y: e.cy - e.r, w: e.r * 2, h: e.r * 2 };
  const fill = e.fill ? `<a:solidFill><a:srgbClr val="${hex(e.fill)}"/></a:solidFill>` : '<a:noFill/>';
  const line = e.line
    ? `<a:ln w="${emu(e.line.w || 1)}"><a:solidFill><a:srgbClr val="${hex(e.line.color)}"/></a:solidFill></a:ln>`
    : '<a:ln><a:noFill/></a:ln>';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Ellipse ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr>${xfrm(b.x, b.y, b.w, b.h)}<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>${fill}${line}</p:spPr>`
    + `<p:txBody><a:bodyPr/><a:p/></p:txBody></p:sp>`;
}

function spText(id, t) {
  const algn = ({ left: 'l', center: 'ctr', right: 'r' })[t.align] || 'l';
  const runPr = `<a:rPr lang="en-US" sz="${cpt(t.size || 18)}"`
    + (t.bold ? ' b="1"' : '') + (t.italic ? ' i="1"' : '') + '>'
    + `<a:solidFill><a:srgbClr val="${hex(t.color || '#000000')}"/></a:solidFill>`
    + `<a:latin typeface="${esc(t.font || 'Arial')}"/></a:rPr>`;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr>${xfrm(t.x, t.y, t.w, t.h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`
    + `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"><a:spAutoFit/></a:bodyPr><a:lstStyle/>`
    + `<a:p><a:pPr algn="${algn}"/><a:r>${runPr}<a:t>${esc(t.text)}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

function picPng(id, rid, m) {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${esc(m.alt || 'Image ' + id)}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>`
    + `<p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>`
    + `<p:spPr>${xfrm(m.x, m.y, m.w, m.h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

// SVG picture: primary blip = PNG fallback (r:embed), plus the svgBlip extension
// (a14) pointing at the real SVG part. Modern PowerPoint renders vector + offers
// "Convert to Shape"; older clients fall back to the PNG.
function picSvg(id, ridPng, ridSvg, m) {
  const svgExt = `<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}">`
    + `<asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="${ridSvg}"/>`
    + `</a:ext></a:extLst>`;
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${esc(m.alt || 'SVG ' + id)}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>`
    + `<p:blipFill><a:blip r:embed="${ridPng}">${svgExt}</a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill>`
    + `<p:spPr>${xfrm(m.x, m.y, m.w, m.h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

// ── slide XML + its rels + media collection ────────────────────────────────
function buildSlide(ir, idx) {
  const media = []; // {name, data}
  const rels = [];  // {id, type, target}
  let rc = 0;
  const nextRid = () => `rId${++rc}`;
  const shapes = [];
  let sid = 1; // shape ids within the slide tree (2+ used; 1 is the group)

  // background fill first (as a full-bleed rect) if provided
  if (ir.bg) shapes.push(spBox(++sid, { x: 0, y: 0, w: SLIDE_W_PX, h: ir.h || SLIDE_H_PX, fill: ir.bg }));

  for (const b of ir.boxes || []) shapes.push(spBox(++sid, b));
  for (const e of ir.ellipses || []) shapes.push(spEllipse(++sid, e));

  for (const m of ir.images || []) {
    const rid = nextRid();
    const name = `image_s${idx}_${rid}.png`;
    media.push({ name: `ppt/media/${name}`, data: m.png });
    rels.push({ id: rid, type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', target: `../media/${name}` });
    shapes.push(picPng(++sid, rid, m));
  }

  for (const s of ir.svgs || []) {
    const ridPng = nextRid();
    const pngName = `svgfallback_s${idx}_${ridPng}.png`;
    media.push({ name: `ppt/media/${pngName}`, data: s.pngFallback });
    rels.push({ id: ridPng, type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', target: `../media/${pngName}` });
    const ridSvg = nextRid();
    const svgName = `image_s${idx}_${ridSvg}.svg`;
    media.push({ name: `ppt/media/${svgName}`, data: Buffer.from(s.svg, 'utf8') });
    rels.push({ id: ridSvg, type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', target: `../media/${svgName}` });
    shapes.push(picSvg(++sid, ridPng, ridSvg, s));
  }

  for (const t of ir.texts || []) shapes.push(spText(++sid, t));

  const slideXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`
    + ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`
    + ` xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">`
    + `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>`
    + `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`
    + shapes.join('')
    + `</p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr></p:sld>`;

  // slide rels: layout is always rId (highest), image rels are separate
  const layoutRid = nextRid();
  rels.push({ id: layoutRid, type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout', target: '../slideLayouts/slideLayout1.xml' });
  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + rels.map(r => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"/>`).join('')
    + `</Relationships>`;

  return { slideXml, relsXml, media };
}

// ── package skeleton (master + layout + theme) ─────────────────────────────
const CT = (slideCount, mediaExts) => {
  const defaults = new Set(['rels', 'xml', ...mediaExts]);
  const defTags = [...defaults].map(e => {
    const ct = e === 'rels' ? 'application/vnd.openxmlformats-package.relationships+xml'
      : e === 'xml' ? 'application/xml'
      : e === 'png' ? 'image/png'
      : e === 'jpeg' || e === 'jpg' ? 'image/jpeg'
      : e === 'svg' ? 'image/svg+xml' : 'application/octet-stream';
    return `<Default Extension="${e}" ContentType="${ct}"/>`;
  }).join('');
  let overrides = `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>`
    + `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>`
    + `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`
    + `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`;
  for (let i = 1; i <= slideCount; i++)
    overrides += `<Override PartName="/ppt/slides/slide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defTags}${overrides}</Types>`;
};

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>`
  + `</Relationships>`;

function presentationXml(slideCount) {
  let sldIds = '';
  for (let i = 1; i <= slideCount; i++) sldIds += `<p:sldId id="${255 + i}" r:id="rId${i + 1}"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`
    + ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`
    + ` xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">`
    + `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId${slideCount + 2}"/></p:sldMasterIdLst>`
    + `<p:sldIdLst>${sldIds}</p:sldIdLst>`
    + `<p:sldSz cx="${emu(SLIDE_W_PX)}" cy="${emu(SLIDE_H_PX)}" type="screen16x9"/>`
    + `<p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
}

function presentationRels(slideCount) {
  let r = '';
  for (let i = 1; i <= slideCount; i++)
    r += `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i}.xml"/>`;
  r += `<Relationship Id="rId${slideCount + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`;
  r += `<Relationship Id="rId${slideCount + 3}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${r}</Relationships>`;
}

const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
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

const SLIDE_MASTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">`
  + `<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`
  + `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>`
  + `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>`
  + `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>`
  + `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;

const SLIDE_MASTER_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`
  + `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`;

const SLIDE_LAYOUT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">`
  + `<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>`
  + `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>`
  + `<p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr></p:sldLayout>`;

const SLIDE_LAYOUT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`;

// ── public: build a .pptx Buffer from an array of slide IRs ────────────────
export function buildPptx(slides) {
  const files = [];
  const mediaExts = new Set(['png']); // svg added on demand
  const allMedia = [];

  slides.forEach((ir, i) => {
    const { slideXml, relsXml, media } = buildSlide(ir, i + 1);
    files.push({ name: `ppt/slides/slide${i + 1}.xml`, data: slideXml });
    files.push({ name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: relsXml });
    for (const m of media) {
      const ext = m.name.split('.').pop().toLowerCase();
      mediaExts.add(ext);
      allMedia.push(m);
    }
  });

  files.unshift({ name: '[Content_Types].xml', data: CT(slides.length, [...mediaExts]) });
  files.push({ name: '_rels/.rels', data: ROOT_RELS });
  files.push({ name: 'ppt/presentation.xml', data: presentationXml(slides.length) });
  files.push({ name: 'ppt/_rels/presentation.xml.rels', data: presentationRels(slides.length) });
  files.push({ name: 'ppt/theme/theme1.xml', data: THEME });
  files.push({ name: 'ppt/slideMasters/slideMaster1.xml', data: SLIDE_MASTER });
  files.push({ name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: SLIDE_MASTER_RELS });
  files.push({ name: 'ppt/slideLayouts/slideLayout1.xml', data: SLIDE_LAYOUT });
  files.push({ name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: SLIDE_LAYOUT_RELS });
  for (const m of allMedia) files.push(m);

  return zip(files);
}

export { SLIDE_W_PX, SLIDE_H_PX };
