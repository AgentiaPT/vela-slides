#!/usr/bin/env python3
"""
mirror — PoC PowerPoint (.pptx) -> Vela deck importer.

SPIKE ARTIFACT (not production). Python stdlib ONLY: zipfile + xml.etree.ElementTree.
No pip deps. Mirrors the parse stack an in-artifact JS importer would use
(fflate-unzip + DOMParser + bespoke spTree walker); here zipfile stands in for
fflate and ElementTree for DOMParser.

Pipeline per .pptx:
  1. unzip; read slide size from ppt/presentation.xml <p:sldSz cx cy>; compute
     EMU -> 960x540 scale (uniform min-scale + centering for non-16:9).
  2. resolve slide order via presentation rels + <p:sldIdLst>.
  3. per slide walk p:cSld/p:spTree (p:sp / p:pic / p:graphicFrame / p:grpSp recurse),
     inheriting placeholder geometry + default text style from layout then master.
  4. extract text runs (sz centipoints->pt, b/i, srgbClr / schemeClr-through-theme),
     bullet levels, slide bg + theme accents.
  5. discard absolute coords -> infer top->bottom, left->right reading order ->
     map to Vela's semantic block types via a documented heuristic.
  6. emit a valid .vela per input + a per-deck FIDELITY REPORT to stdout.

The central mismatch: pptx shapes are absolutely positioned; Vela is flow/stacked
(no x/y/w/h). So this is semantic RE-FLOW, not pixel mapping. See README.md.
"""

import base64
import json
import os
import sys
import zipfile
import xml.etree.ElementTree as ET
# SECURITY NOTE (spike): stdlib ElementTree is used per the "no new pip deps"
# mandate. For untrusted real-world .pptx in production, harden XML parsing
# against XXE / billion-laughs (e.g. defusedxml, or an expat parser with entity
# limits). ET.fromstring does not fetch external entities by default, but nested
# internal-entity expansion is still a DoS vector on hostile input.

# ----------------------------------------------------------------------------
# Constants (see recon-A/C: EMU math, recon-B: Vela canvas + size tokens)
# ----------------------------------------------------------------------------
VIRTUAL_W = 960          # Vela virtual canvas px
VIRTUAL_H = 540
EMU_PER_PX = 12700       # canonical: 1 canvas px = 12700 EMU (== 1pt)

# heading/text size tokens -> px (block-schema.md:102)
SIZE_TOKENS = [("xs", 12), ("sm", 14), ("md", 17), ("lg", 20),
               ("xl", 26), ("2xl", 35), ("3xl", 46), ("4xl", 56)]

# OOXML namespaces we care about
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
P = "http://schemas.openxmlformats.org/presentationml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"

RASTER_MIME = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
               "gif": "image/gif", "svg": "image/svg+xml", "webp": "image/webp"}
# Vector metafiles we cannot render in an artifact -> dropped (recon-C fidelity ceiling)
UNRENDERABLE = {"emf", "wmf", "x-emf", "x-wmf"}


# ----------------------------------------------------------------------------
# tiny XML helpers — strip namespaces by local name (like DOMParser localName)
# ----------------------------------------------------------------------------
def local(tag):
    return tag.rsplit("}", 1)[-1]


def kids(el, name):
    """direct children with the given local name"""
    return [c for c in el if local(c.tag) == name]


def kid(el, name):
    for c in el:
        if local(c.tag) == name:
            return c
    return None


def descend(el, name):
    """first descendant (any depth) with local name"""
    for c in el.iter():
        if local(c.tag) == name:
            return c
    return None


def descend_all(el, name):
    return [c for c in el.iter() if local(c.tag) == name]


def attr(el, name):
    """attribute lookup ignoring namespace prefix on the attribute key"""
    if el is None:
        return None
    for k, v in el.attrib.items():
        if local(k) == name:
            return v
    return None


# ----------------------------------------------------------------------------
# Color model (recon-A section 5 / recon-C: theme clrScheme + clrMap)
# ----------------------------------------------------------------------------
def parse_clr_scheme(theme_xml):
    """theme1.xml <a:clrScheme> -> {name: 'RRGGBB'}"""
    out = {}
    root = ET.fromstring(theme_xml)
    sch = descend(root, "clrScheme")
    if sch is None:
        return out
    for c in sch:
        name = local(c.tag)                    # dk1, lt1, accent1 ...
        srgb = kid(c, "srgbClr")
        sysc = kid(c, "sysClr")
        if srgb is not None:
            out[name] = attr(srgb, "val")
        elif sysc is not None:
            out[name] = attr(sysc, "lastClr") or "000000"
    return out


def resolve_color(clr_parent, scheme, clrmap):
    """Given an element that may contain <a:srgbClr>/<a:schemeClr>/<a:sysClr>,
    return '#RRGGBB' or None. clrmap maps slide color slots (bg1/tx1..) to
    scheme names (lt1/dk1/accent1..)."""
    if clr_parent is None:
        return None
    srgb = descend(clr_parent, "srgbClr")
    if srgb is not None:
        return "#" + attr(srgb, "val")
    sysc = descend(clr_parent, "sysClr")
    if sysc is not None:
        return "#" + (attr(sysc, "lastClr") or "000000")
    sc = descend(clr_parent, "schemeClr")
    if sc is not None:
        val = attr(sc, "val")                  # e.g. tx1, accent2, bg1
        mapped = clrmap.get(val, val)          # tx1 -> dk1
        hexv = scheme.get(mapped) or scheme.get(val)
        if hexv:
            return "#" + hexv
    return None


# ----------------------------------------------------------------------------
# OPC relationship + package plumbing
# ----------------------------------------------------------------------------
def load_rels(zf, part_path):
    """Load the .rels file that belongs to a part -> {rId: (type, target_abs)}"""
    d, base = os.path.split(part_path)
    rels_path = f"{d}/_rels/{base}.rels" if d else f"_rels/{base}.rels"
    out = {}
    if rels_path not in zf.namelist():
        return out
    root = ET.fromstring(zf.read(rels_path))
    for rel in root:
        rid = attr(rel, "Id")
        typ = attr(rel, "Type")
        tgt = attr(rel, "Target")
        mode = attr(rel, "TargetMode")
        if mode == "External":
            out[rid] = (typ, tgt, True)
        else:
            # resolve relative to the part's directory
            abs_t = os.path.normpath(os.path.join(d, tgt)).replace("\\", "/")
            out[rid] = (typ, abs_t, False)
    return out


# ----------------------------------------------------------------------------
# Geometry (recon-A section 2 / recon-C section 5): EMU -> Vela px, min-scale + center
# ----------------------------------------------------------------------------
def make_scaler(slide_cx, slide_cy):
    sx = VIRTUAL_W / slide_cx
    sy = VIRTUAL_H / slide_cy
    s = min(sx, sy)                            # uniform letterbox scale
    # centering offset so a non-16:9 source is centered on the 960x540 canvas
    off_x = (VIRTUAL_W - slide_cx * s) / 2
    off_y = (VIRTUAL_H - slide_cy * s) / 2

    def px(x, y, w, h):
        return (round(x * s + off_x), round(y * s + off_y),
                round(w * s), round(h * s))
    return px, s


def get_xfrm(spPr):
    """(x,y,cx,cy) in EMU from a:xfrm, or None if absent (inherit from ph)."""
    if spPr is None:
        return None
    xf = kid(spPr, "xfrm")
    if xf is None:
        return None
    off = kid(xf, "off")
    ext = kid(xf, "ext")
    if off is None or ext is None:
        return None
    return (int(attr(off, "x") or 0), int(attr(off, "y") or 0),
            int(attr(ext, "cx") or 1), int(attr(ext, "cy") or 1))


# ----------------------------------------------------------------------------
# Placeholder inheritance: build (type, idx) -> geometry map from layout+master
# (recon-C: slide -> slideLayout -> slideMaster inheritance chain; the key
#  real-deck construct Vela's own export never produces)
# ----------------------------------------------------------------------------
def ph_key(sp):
    """placeholder identity (type, idx) for a shape, or None if not a placeholder"""
    nv = descend(sp, "nvSpPr")
    if nv is None:
        return None
    ph = descend(nv, "ph")
    if ph is None:
        return None
    return (attr(ph, "type") or "body", attr(ph, "idx") or "")


def build_ph_geometry(xml_bytes):
    """Parse a layout or master, return {(type,idx): (x,y,cx,cy)} for placeholders."""
    out = {}
    root = ET.fromstring(xml_bytes)
    tree = descend(root, "spTree")
    if tree is None:
        return out
    for sp in kids(tree, "sp"):
        k = ph_key(sp)
        if k is None:
            continue
        g = get_xfrm(kid(sp, "spPr"))
        if g:
            out[k] = g
    return out


# ----------------------------------------------------------------------------
# Text extraction (recon-C DrawingML text model)
# ----------------------------------------------------------------------------
def pt_from_sz(sz):
    """centipoints -> pt (sz is a string like '1800' == 18pt)"""
    try:
        return int(sz) / 100.0
    except (TypeError, ValueError):
        return None


def md_escape(t):
    # keep it simple; we only inject ** and * ourselves
    return t


def extract_paragraphs(txBody, scheme, clrmap):
    """Return list of paragraph dicts: {runs:[{text,bold,italic,color,pt}],
    bullet:bool, level:int, text:str, inline:str}. inline = markdown-ish with
    **bold**/*italic*."""
    paras = []
    if txBody is None:
        return paras
    for p in kids(txBody, "p"):
        pPr = kid(p, "pPr")
        level = int(attr(pPr, "lvl") or 0) if pPr is not None else 0
        # bullet detection: explicit buChar/buAutoNum => bullet; buNone => not
        bullet = False
        if pPr is not None:
            if kid(pPr, "buChar") is not None or kid(pPr, "buAutoNum") is not None:
                bullet = True
            elif kid(pPr, "buNone") is not None:
                bullet = False
        runs = []
        # walk children in document order: a:r (run), a:br (line break), a:fld (field)
        for c in p:
            ln = local(c.tag)
            if ln == "r":
                t_el = kid(c, "t")
                if t_el is None or t_el.text is None:
                    continue
                rPr = kid(c, "rPr")
                bold = attr(rPr, "b") == "1"
                ital = attr(rPr, "i") == "1"
                pt = pt_from_sz(attr(rPr, "sz")) if rPr is not None else None
                color = resolve_color(kid(rPr, "solidFill"), scheme, clrmap) if rPr is not None else None
                runs.append({"text": t_el.text, "bold": bold, "italic": ital,
                             "color": color, "pt": pt})
            elif ln == "fld":
                t_el = kid(c, "t")
                if t_el is not None and t_el.text:
                    runs.append({"text": t_el.text, "bold": False, "italic": False,
                                 "color": None, "pt": None})
        plain = "".join(r["text"] for r in runs)
        # inline markdown for text blocks (heading stays plain)
        inline_parts = []
        for r in runs:
            t = r["text"]
            if not t.strip():
                inline_parts.append(t)
                continue
            if r["bold"] and r["italic"]:
                t = f"***{t}***"
            elif r["bold"]:
                t = f"**{t}**"
            elif r["italic"]:
                t = f"*{t}*"
            inline_parts.append(t)
        paras.append({"runs": runs, "bullet": bullet, "level": level,
                      "text": plain, "inline": "".join(inline_parts)})
    return paras


# ----------------------------------------------------------------------------
# size-token bucketing
# ----------------------------------------------------------------------------
def token_for_pt(pt):
    if pt is None:
        return "md"
    best = SIZE_TOKENS[0][0]
    for name, px in SIZE_TOKENS:
        if pt >= px - 2:
            best = name
    return best


def max_pt(paras):
    vals = [r["pt"] for para in paras for r in para["runs"] if r["pt"]]
    return max(vals) if vals else None


# ----------------------------------------------------------------------------
# core: walk a slide's shape tree into a flat list of "elements"
# ----------------------------------------------------------------------------
def walk_tree(tree, scheme, clrmap, ph_geo, slide_rels, out, stats):
    """Recursively walk spTree; append element dicts to `out`.
    Each element: {kind, y, x, ...payload}."""
    for node in tree:
        ln = local(node.tag)

        if ln == "sp":
            stats["shapes"] += 1
            spPr = kid(node, "spPr")
            geo = get_xfrm(spPr)
            k = ph_key(node)
            if geo is None and k is not None:
                geo = ph_geo.get(k)            # inherit placeholder geometry
            txBody = descend(node, "txBody")
            paras = extract_paragraphs(txBody, scheme, clrmap)
            has_text = any(p["text"].strip() for p in paras)
            # autoshape geometry: prstGeom prst=... ; non-rect w/ fill = a "shape"
            prst = None
            pg = descend(spPr, "prstGeom") if spPr is not None else None
            if pg is not None:
                prst = attr(pg, "prst")
            fill = resolve_color(kid(spPr, "solidFill"), scheme, clrmap) if spPr is not None else None
            x, y = (geo[0], geo[1]) if geo else (0, 0)
            if has_text:
                is_title = bool(k and "itle" in (k[0] or ""))   # title / ctrTitle
                out.append({"kind": "text", "x": x, "y": y, "paras": paras,
                            "is_title": is_title, "prst": prst, "fill": fill,
                            "is_ph": k is not None})
            else:
                # no text: decorative autoshape (ellipse/rect background art) -> dropped
                out.append({"kind": "decor", "x": x, "y": y, "prst": prst, "fill": fill})

        elif ln == "pic":
            stats["shapes"] += 1
            spPr = kid(node, "spPr")
            geo = get_xfrm(spPr)
            x, y = (geo[0], geo[1]) if geo else (0, 0)
            blip = descend(node, "blip")
            rid = attr(blip, "embed") if blip is not None else None
            alt = None
            cNvPr = descend(node, "cNvPr")
            if cNvPr is not None:
                alt = attr(cNvPr, "descr") or attr(cNvPr, "name")
            out.append({"kind": "pic", "x": x, "y": y, "rid": rid, "alt": alt})

        elif ln == "graphicFrame":
            stats["shapes"] += 1
            xf = descend(node, "xfrm")
            x = int(attr(kid(xf, "off"), "x")) if xf is not None and kid(xf, "off") is not None else 0
            y = int(attr(kid(xf, "off"), "y")) if xf is not None and kid(xf, "off") is not None else 0
            tbl = descend(node, "tbl")
            if tbl is not None:
                out.append({"kind": "table", "x": x, "y": y,
                            "table": parse_table(tbl, scheme, clrmap)})
            else:
                # chart / SmartArt / OLE -> unsupported (recon-C ceiling)
                out.append({"kind": "unsupported", "x": x, "y": y, "what": "graphicFrame"})

        elif ln == "grpSp":
            stats["shapes"] += 1
            # recurse into group; children carry their own coord space but for
            # reflow we only need reading order, so we flatten (recon-B: grouping lost)
            walk_tree(node, scheme, clrmap, ph_geo, slide_rels, out, stats)


def parse_table(tbl, scheme, clrmap):
    """<a:tbl> -> {headers:[...], rows:[[...]]}. String cells only (Vela table limit)."""
    rows = []
    tr_list = kids(tbl, "tr")
    for tr in tr_list:
        cells = []
        for tc in kids(tr, "tc"):
            txBody = descend(tc, "txBody")
            paras = extract_paragraphs(txBody, scheme, clrmap)
            cells.append(" ".join(p["text"] for p in paras).strip())
        rows.append(cells)
    if not rows:
        return {"headers": [], "rows": []}
    return {"headers": rows[0], "rows": rows[1:]}


# ----------------------------------------------------------------------------
# reading-order -> Vela blocks (the documented mapping heuristic)
# ----------------------------------------------------------------------------
def elements_to_blocks(elements, deck_media, accent, default_color, stats, notes):
    """Discard absolute coords; sort top->bottom then left->right; map to blocks.
    Mutates stats counters and notes set."""
    # reading order: primary Y band (tolerance) then X
    BAND = 300000   # ~0.33in EMU tolerance for "same row"
    ordered = sorted(elements, key=lambda e: (round(e["y"] / BAND), e["x"]))
    blocks = []
    for e in ordered:
        kind = e["kind"]

        if kind == "decor":
            # decorative autoshape (no text) -> dropped, appearance lost
            stats["dropped"] += 1
            notes.add("decorative autoshapes (ellipse/rect background art)")
            continue

        if kind == "unsupported":
            stats["dropped"] += 1
            notes.add("charts / SmartArt / OLE (graphicFrame, no native Vela block)")
            continue

        if kind == "pic":
            rid = e["rid"]
            info = deck_media.get(rid)
            if not info:
                stats["dropped"] += 1
                continue
            ext = info["ext"].lower()
            if ext in UNRENDERABLE:
                stats["dropped"] += 1
                notes.add("EMF/WMF vector images (not renderable in artifact)")
                continue
            mime = RASTER_MIME.get(ext)
            if not mime:
                stats["dropped"] += 1
                continue
            b64 = base64.b64encode(info["bytes"]).decode("ascii")
            blk = {"type": "image", "src": f"data:{mime};base64,{b64}"}
            if e.get("alt") and "preencoded" not in (e["alt"] or ""):
                blk["caption"] = e["alt"]
            blocks.append(blk)
            if ext == "svg":
                stats["lossy"] += 1        # svg->raster-ish path, semantics unknowable
                notes.add("SVG/icon block identity (imported as flat image)")
            else:
                stats["clean"] += 1
            continue

        if kind == "table":
            t = e["table"]
            blocks.append({"type": "table", "headers": t["headers"] or [],
                           "rows": t["rows"], "striped": True})
            stats["lossy"] += 1            # merged cells / col widths / per-cell fmt lost
            notes.add("table merged-cells / per-column widths / cell formatting")
            continue

        # --- text ---
        paras = e["paras"]
        mpt = max_pt(paras)
        n_para = len([p for p in paras if p["text"].strip()])
        bulleted = [p for p in paras if p["bullet"]]
        total_chars = sum(len(p["text"]) for p in paras)

        # TITLE placeholder or a big short line -> heading
        if e.get("is_title") or (mpt and mpt >= 28 and n_para <= 2 and total_chars <= 80):
            text = " ".join(p["text"] for p in paras if p["text"].strip()).strip()
            if not text:
                continue
            size = token_for_pt(mpt if mpt else 35)
            blk = {"type": "heading", "text": text, "size": size}
            # carry the first run color if it diverges from default
            fc = next((r["color"] for p in paras for r in p["runs"] if r["color"]), None)
            if fc:
                blk["color"] = fc
            blocks.append(blk)
            stats["clean"] += 1
            continue

        # bulleted list -> bullets block
        if bulleted and len(bulleted) >= max(1, n_para // 2):
            items = [p["inline"].strip() for p in paras if p["text"].strip()]
            blocks.append({"type": "bullets", "items": items,
                           "dotColor": accent, "size": "sm"})
            stats["lossy"] += 1           # multi-level indentation flattened
            if any(p["level"] > 0 for p in paras):
                notes.add("multi-level bullet indentation (flattened to single level)")
            else:
                notes.add("bullet list line-spacing / autofit")
            continue

        # autoshape-with-text (rounded box etc.) -> callout
        if e.get("prst") and e["prst"] not in ("rect", None) and e.get("fill"):
            text = "\n".join(p["inline"] for p in paras if p["text"].strip()).strip()
            if not text:
                continue
            blocks.append({"type": "callout", "text": text,
                           "bg": e["fill"], "color": default_color})
            stats["lossy"] += 1
            notes.add("autoshape geometry (approximated as callout box)")
            continue

        # plain paragraph(s) -> text block (join with newlines, inline bold/italic)
        text = "\n".join(p["inline"] for p in paras if p["text"].strip()).strip()
        if not text:
            continue
        size = token_for_pt(mpt) if mpt else "md"
        blk = {"type": "text", "text": text, "size": size}
        fc = next((r["color"] for p in paras for r in p["runs"] if r["color"]), None)
        if fc:
            blk["color"] = fc
        blocks.append(blk)
        stats["clean"] += 1
    return blocks


# ----------------------------------------------------------------------------
# color helpers
# ----------------------------------------------------------------------------
def luminance(hexc):
    try:
        h = hexc.lstrip("#")
        r, g, b = (int(h[i:i+2], 16) for i in (0, 2, 4))
        return 0.2126*(r/255) + 0.7152*(g/255) + 0.0722*(b/255)
    except Exception:
        return 0.5


def slide_bg(sld, scheme, clrmap):
    """slide <p:bg> solid fill -> #hex, or None."""
    cSld = descend(sld, "cSld")
    bg = kid(cSld, "bg") if cSld is not None else None
    if bg is None:
        return None
    return resolve_color(descend(bg, "solidFill") or bg, scheme, clrmap)


# ----------------------------------------------------------------------------
# per-deck driver
# ----------------------------------------------------------------------------
def import_pptx(path, out_dir):
    name = os.path.splitext(os.path.basename(path))[0]
    zf = zipfile.ZipFile(path)
    names = set(zf.namelist())

    # theme (first theme) -> color scheme
    theme_name = next((n for n in names if n.startswith("ppt/theme/theme")), None)
    scheme = parse_clr_scheme(zf.read(theme_name)) if theme_name else {}
    accent = "#" + scheme.get("accent1", "3B82F6")

    # clrMap from master (bg1->lt1 etc.)
    clrmap = {"bg1": "lt1", "tx1": "dk1", "bg2": "lt2", "tx2": "dk2"}
    master_name = next((n for n in names if n.startswith("ppt/slideMasters/slideMaster")), None)
    if master_name:
        mroot = ET.fromstring(zf.read(master_name))
        cm = descend(mroot, "clrMap")
        if cm is not None:
            for slot in ("bg1", "tx1", "bg2", "tx2"):
                v = attr(cm, slot)
                if v:
                    clrmap[slot] = v

    # slide size
    pres = ET.fromstring(zf.read("ppt/presentation.xml"))
    sldSz = descend(pres, "sldSz")
    cx = int(attr(sldSz, "cx"))
    cy = int(attr(sldSz, "cy"))
    to_px, uni_scale = make_scaler(cx, cy)
    aspect = f"{cx}x{cy}" + (" (16:9)" if abs(cx/cy - 16/9) < 0.01 else " (non-16:9!)")

    # ordered slides via presentation rels + sldIdLst
    pres_rels = load_rels(zf, "ppt/presentation.xml")
    sldIdLst = descend(pres, "sldIdLst")
    slide_parts = []
    for sid in kids(sldIdLst, "sldId"):
        rid = attr(sid, "id")   # this is the p:sldId id, not the rId
        rrid = attr(sid, "id")
        # the r:id attribute:
        rel_id = None
        for k, v in sid.attrib.items():
            if local(k) == "id" and "relationships" in k:
                rel_id = v
            if local(k) == "id" and "relationships" not in k:
                pass
        # r:id is a namespaced attr; grab it robustly
        for k, v in sid.attrib.items():
            if local(k) == "id" and k != "id":
                rel_id = v
        if rel_id and rel_id in pres_rels:
            slide_parts.append(pres_rels[rel_id][1])

    # per-master/layout placeholder geometry (built lazily per slide via its layout rel)
    layout_geo_cache = {}
    master_geo = build_ph_geometry(zf.read(master_name)) if master_name else {}

    stats = {"shapes": 0, "clean": 0, "lossy": 0, "dropped": 0, "rasterized": 0}
    notes = set()
    src_chars = 0     # total chars in all a:t
    mapped_chars = 0  # chars we placed into blocks

    slides_json = []
    media_out = os.path.join(out_dir, "media", name)

    for sp_path in slide_parts:
        sld = ET.fromstring(zf.read(sp_path))
        # count all source text chars for coverage
        for t in descend_all(sld, "t"):
            if t.text:
                src_chars += len(t.text)

        # placeholder geometry: slide's layout, then master
        srels = load_rels(zf, sp_path)
        ph_geo = dict(master_geo)
        for rid, (typ, tgt, ext) in srels.items():
            if typ.endswith("/slideLayout"):
                if tgt not in layout_geo_cache:
                    layout_geo_cache[tgt] = build_ph_geometry(zf.read(tgt))
                ph_geo.update(layout_geo_cache[tgt])

        # media map for this slide: rId -> {bytes, ext}
        deck_media = {}
        for rid, (typ, tgt, ext) in srels.items():
            if typ.endswith("/image") and not ext and tgt in names:
                e = tgt.rsplit(".", 1)[-1]
                deck_media[rid] = {"bytes": zf.read(tgt), "ext": e, "target": tgt}

        # background + default text color
        bg = slide_bg(sld, scheme, clrmap) or "#0f172a"
        default_color = "#e2e8f0" if luminance(bg) < 0.5 else "#1e293b"

        tree = descend(sld, "spTree")
        elements = []
        walk_tree(tree, scheme, clrmap, ph_geo, srels, elements, stats)
        blocks = elements_to_blocks(elements, deck_media, accent, default_color, stats, notes)

        # extract media to files + count mapped chars
        for b in blocks:
            if b["type"] == "text":
                mapped_chars += len(_strip_md(b["text"]))
            elif b["type"] == "heading":
                mapped_chars += len(b["text"])
            elif b["type"] == "bullets":
                mapped_chars += sum(len(_strip_md(i)) for i in b["items"])
            elif b["type"] == "callout":
                mapped_chars += len(_strip_md(b["text"]))
            elif b["type"] == "table":
                mapped_chars += sum(len(c) for c in b.get("headers", []))
                mapped_chars += sum(len(c) for row in b.get("rows", []) for c in row)

        # slide title = first heading text if any
        title = next((b["text"] for b in blocks if b["type"] == "heading"), None)

        slide = {
            "bg": bg,
            "color": default_color,
            "accent": accent,
            "duration": _synth_duration(blocks),
            "align": "left",
            "verticalAlign": "top",
            "padding": "48px 56px",
            "gap": 14,
            "blocks": blocks or [{"type": "text", "text": "(empty slide)", "size": "sm"}],
        }
        if title:
            slide["title"] = title[:60]
        slides_json.append(slide)

    zf.close()

    # write extracted media to files (referenced copy; deck embeds data URIs)
    os.makedirs(media_out, exist_ok=True)
    _extract_all_media(path, media_out)

    deck = {
        "deckTitle": name.replace("-", " ").title(),
        "lanes": [{
            "title": "Imported",
            "items": [{
                "title": name,
                "status": "todo",
                "slides": slides_json,
            }],
        }],
    }
    out_path = os.path.join(out_dir, name + ".vela")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(deck, f, ensure_ascii=False)

    # cap at 100 (join-separator chars in headings/tables can nudge it slightly over)
    coverage = min(100.0, mapped_chars / src_chars * 100) if src_chars else 100.0

    # source thumbnail
    thumb = _extract_thumb(path, out_dir)

    report = {
        "name": name, "slides": len(slides_json), "aspect": aspect,
        "scale": round(uni_scale, 9), "shapes": stats["shapes"],
        "clean": stats["clean"], "lossy": stats["lossy"],
        "rasterized": stats["rasterized"], "dropped": stats["dropped"],
        "src_chars": src_chars, "mapped_chars": mapped_chars,
        "coverage": round(coverage, 1), "notes": sorted(notes),
        "out": out_path, "thumb": thumb,
    }
    return report


def _strip_md(s):
    return s.replace("*", "").replace("~", "")


def _synth_duration(blocks):
    """pptx has no timing; synthesize from content volume (30-90s)."""
    words = 0
    for b in blocks:
        for k in ("text",):
            if k in b:
                words += len(str(b[k]).split())
        if b.get("type") == "bullets":
            words += sum(len(str(i).split()) for i in b.get("items", []))
    est = 20 + words * 0.4
    return int(max(30, min(90, est)))


def _extract_all_media(pptx_path, dest):
    zf = zipfile.ZipFile(pptx_path)
    for n in zf.namelist():
        if n.startswith("ppt/media/"):
            data = zf.read(n)
            with open(os.path.join(dest, os.path.basename(n)), "wb") as f:
                f.write(data)
    zf.close()


def _extract_thumb(pptx_path, out_dir):
    zf = zipfile.ZipFile(pptx_path)
    for n in zf.namelist():
        if n.startswith("docProps/thumbnail"):
            data = zf.read(n)
            ext = n.rsplit(".", 1)[-1]
            p = os.path.join(out_dir, os.path.splitext(os.path.basename(pptx_path))[0] + "-source-thumb." + ext)
            with open(p, "wb") as f:
                f.write(data)
            zf.close()
            return p
    zf.close()
    return None


def print_report(r):
    print("=" * 64)
    print(f"FIDELITY REPORT — {r['name']}.pptx")
    print("=" * 64)
    print(f"  slide size      : {r['aspect']}   uniform scale {r['scale']}")
    print(f"  slides          : {r['slides']}")
    print(f"  shapes seen     : {r['shapes']}")
    print(f"  mapped clean    : {r['clean']}")
    print(f"  mapped lossy    : {r['lossy']}")
    print(f"  rasterized      : {r['rasterized']}")
    print(f"  dropped         : {r['dropped']}")
    print(f"  text-run cover  : {r['coverage']}%  ({r['mapped_chars']}/{r['src_chars']} chars)")
    print(f"  lost feature classes:")
    for n in r["notes"]:
        print(f"      - {n}")
    print(f"  -> {r['out']}")
    if r["thumb"]:
        print(f"  -> source thumbnail: {r['thumb']}")
    print()


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print("usage: pptx_import_poc.py <a.pptx> [b.pptx ...] [--out DIR]")
        sys.exit(2)
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
    if "--out" in args:
        i = args.index("--out")
        out_dir = args[i+1]
        args = args[:i] + args[i+2:]
    os.makedirs(out_dir, exist_ok=True)
    reports = []
    for p in args:
        try:
            reports.append(import_pptx(p, out_dir))
        except Exception as ex:
            import traceback
            print(f"ERROR importing {p}: {ex}")
            traceback.print_exc()
    print()
    for r in reports:
        print_report(r)
