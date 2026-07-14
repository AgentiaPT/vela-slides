#!/usr/bin/env python3
"""
render_source_html.py — sibling of pptx_import_poc.py.

Emits a standalone ABSOLUTE-POSITIONED HTML (960x540) reconstruction of a source
.pptx slide, drawn from *the importer's own geometry parse* (it reuses the PoC's
EMU parsing, placeholder inheritance, color model, and text-run extraction). Each
shape is placed at its EMU->px box; each image as <img>; each text box as an
absolutely-positioned <div> with the parsed font-size(px)/color/weight/alignment.

This is NOT a claim of pixel-perfect PowerPoint rendering. There is no in-sandbox
pptx rasterizer (LibreOffice is non-functional here). This view demonstrates the
fidelity of the importer's geometry/text PARSE — the "BEFORE" the semantic reflow
throws the coordinates away. Compare against the imported .vela ("AFTER").

usage: render_source_html.py <file.pptx> --slide N --out out.html
"""
import base64
import html
import os
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pptx_import_poc as poc  # reuse the importer's parse layer

L = poc.local


def para_align(p):
    pPr = poc.kid(p, "pPr")
    a = poc.attr(pPr, "algn") if pPr is not None else None
    return {"ctr": "center", "r": "right", "just": "justify"}.get(a, "left")


def collect_boxes(tree, scheme, clrmap, ph_geo, deck_media, to_px, font_scale,
                  default_color, boxes):
    """Recursively walk spTree, keeping FULL EMU geometry (x,y,cx,cy) so we can
    draw an absolute-positioned reconstruction."""
    for node in tree:
        ln = L(node.tag)
        if ln == "sp":
            spPr = poc.kid(node, "spPr")
            geo = poc.get_xfrm(spPr)
            k = poc.ph_key(node)
            if geo is None and k is not None:
                geo = ph_geo.get(k)
            if geo is None:
                geo = (0, 0, 1, 1)
            px, py, pw, ph = to_px(*geo)
            txBody = poc.descend(node, "txBody")
            paras = poc.extract_paragraphs(txBody, scheme, clrmap)
            fill = poc.resolve_color(poc.kid(spPr, "solidFill"), scheme, clrmap) if spPr is not None else None
            has_text = any(p["text"].strip() for p in paras)
            # per-paragraph alignment (extract_paragraphs drops algn, read raw)
            aligns = [para_align(p) for p in poc.kids(txBody, "p")] if txBody is not None else []
            boxes.append({"kind": "text" if has_text else "decor",
                          "box": (px, py, pw, ph), "paras": paras,
                          "aligns": aligns, "fill": fill})
        elif ln == "pic":
            spPr = poc.kid(node, "spPr")
            geo = poc.get_xfrm(spPr) or (0, 0, 1, 1)
            px, py, pw, ph = to_px(*geo)
            blip = poc.descend(node, "blip")
            rid = poc.attr(blip, "embed") if blip is not None else None
            info = deck_media.get(rid)
            boxes.append({"kind": "pic", "box": (px, py, pw, ph), "info": info})
        elif ln == "graphicFrame":
            xf = poc.descend(node, "xfrm")
            geo = poc.get_xfrm_like(xf) if hasattr(poc, "get_xfrm_like") else None
            if xf is not None:
                off = poc.kid(xf, "off"); ext = poc.kid(xf, "ext")
                if off is not None and ext is not None:
                    geo = (int(poc.attr(off, "x") or 0), int(poc.attr(off, "y") or 0),
                           int(poc.attr(ext, "cx") or 1), int(poc.attr(ext, "cy") or 1))
            geo = geo or (0, 0, 1, 1)
            px, py, pw, ph = to_px(*geo)
            tbl = poc.descend(node, "tbl")
            if tbl is not None:
                boxes.append({"kind": "table", "box": (px, py, pw, ph),
                              "table": poc.parse_table(tbl, scheme, clrmap)})
            else:
                boxes.append({"kind": "decor", "box": (px, py, pw, ph),
                              "paras": [], "aligns": [], "fill": None})
        elif ln == "grpSp":
            collect_boxes(node, scheme, clrmap, ph_geo, deck_media, to_px,
                          font_scale, default_color, boxes)


def render_slide(pptx_path, slide_index, out_path):
    zf = zipfile.ZipFile(pptx_path)
    names = set(zf.namelist())

    theme_name = next((n for n in names if n.startswith("ppt/theme/theme")), None)
    scheme = poc.parse_clr_scheme(zf.read(theme_name)) if theme_name else {}
    accent = "#" + scheme.get("accent1", "3B82F6")

    clrmap = {"bg1": "lt1", "tx1": "dk1", "bg2": "lt2", "tx2": "dk2"}
    master_name = next((n for n in names if n.startswith("ppt/slideMasters/slideMaster")), None)
    if master_name:
        mroot = ET.fromstring(zf.read(master_name))
        cm = poc.descend(mroot, "clrMap")
        if cm is not None:
            for slot in ("bg1", "tx1", "bg2", "tx2"):
                v = poc.attr(cm, slot)
                if v:
                    clrmap[slot] = v

    pres = ET.fromstring(zf.read("ppt/presentation.xml"))
    sldSz = poc.descend(pres, "sldSz")
    cx = int(poc.attr(sldSz, "cx")); cy = int(poc.attr(sldSz, "cy"))
    to_px, uni_scale = poc.make_scaler(cx, cy)
    font_scale = uni_scale * poc.EMU_PER_PX  # pt -> px on the 960x540 canvas

    pres_rels = poc.load_rels(zf, "ppt/presentation.xml")
    sldIdLst = poc.descend(pres, "sldIdLst")
    slide_parts = []
    for sid in poc.kids(sldIdLst, "sldId"):
        rel_id = None
        for k, v in sid.attrib.items():
            if L(k) == "id" and k != "id":
                rel_id = v
        if rel_id and rel_id in pres_rels:
            slide_parts.append(pres_rels[rel_id][1])

    master_geo = poc.build_ph_geometry(zf.read(master_name)) if master_name else {}

    sp_path = slide_parts[slide_index - 1]
    sld = ET.fromstring(zf.read(sp_path))
    srels = poc.load_rels(zf, sp_path)
    ph_geo = dict(master_geo)
    for rid, (typ, tgt, ext) in srels.items():
        if typ.endswith("/slideLayout"):
            ph_geo.update(poc.build_ph_geometry(zf.read(tgt)))

    deck_media = {}
    for rid, (typ, tgt, ext) in srels.items():
        if typ.endswith("/image") and not ext and tgt in names:
            e = tgt.rsplit(".", 1)[-1]
            deck_media[rid] = {"bytes": zf.read(tgt), "ext": e, "target": tgt}

    bg = poc.slide_bg(sld, scheme, clrmap) or "#0f172a"
    default_color = "#e2e8f0" if poc.luminance(bg) < 0.5 else "#1e293b"

    tree = poc.descend(sld, "spTree")
    boxes = []
    collect_boxes(tree, scheme, clrmap, ph_geo, deck_media, to_px, font_scale,
                  default_color, boxes)
    zf.close()

    # ---- emit absolute-positioned HTML ----
    parts = []
    for b in boxes:
        x, y, w, h = b["box"]
        style_box = f"position:absolute;left:{x}px;top:{y}px;width:{w}px;height:{h}px;overflow:hidden;"
        if b["kind"] == "pic":
            info = b.get("info")
            if not info or info["ext"].lower() in poc.UNRENDERABLE:
                # unrenderable metafile — show a faint placeholder box (parse still saw it)
                parts.append(f'<div style="{style_box}outline:1px dashed rgba(148,163,184,.4);"></div>')
                continue
            mime = poc.RASTER_MIME.get(info["ext"].lower())
            if not mime:
                continue
            b64 = base64.b64encode(info["bytes"]).decode("ascii")
            parts.append(f'<img src="data:{mime};base64,{b64}" style="{style_box}object-fit:contain;" />')
        elif b["kind"] == "table":
            t = b["table"]
            rows_html = ""
            allrows = ([t["headers"]] if t["headers"] else []) + t["rows"]
            for r in allrows:
                cells = "".join(f'<td style="border:1px solid rgba(148,163,184,.5);padding:2px 4px;">{html.escape(str(c))}</td>' for c in r)
                rows_html += f"<tr>{cells}</tr>"
            parts.append(f'<div style="{style_box}"><table style="border-collapse:collapse;font-size:12px;color:{default_color};width:100%;">{rows_html}</table></div>')
        elif b["kind"] == "text":
            fill_css = f"background:{b['fill']};" if b.get("fill") else ""
            lines = []
            paras = b["paras"]
            aligns = b["aligns"]
            for i, p in enumerate(paras):
                if not p["text"].strip():
                    lines.append('<div style="height:0.5em;"></div>')
                    continue
                al = aligns[i] if i < len(aligns) else "left"
                runs_html = ""
                for r in p["runs"]:
                    if r["text"] == "":
                        continue
                    fpx = (r["pt"] * font_scale) if r["pt"] else 18
                    col = r["color"] or default_color
                    weight = "700" if r["bold"] else "400"
                    fstyle = "italic" if r["italic"] else "normal"
                    runs_html += (f'<span style="font-size:{fpx:.1f}px;color:{col};'
                                  f'font-weight:{weight};font-style:{fstyle};">'
                                  f'{html.escape(r["text"])}</span>')
                bullet = "• " if p["bullet"] else ""
                pad = p["level"] * 16
                lines.append(f'<div style="text-align:{al};padding-left:{pad}px;line-height:1.15;">{bullet}{runs_html}</div>')
            parts.append(f'<div style="{style_box}{fill_css}font-family:Arial,Helvetica,sans-serif;">{"".join(lines)}</div>')
        # decor (no text) -> not drawn (matches importer dropping it), keeps view honest

    canvas = (f'<div style="position:relative;width:960px;height:540px;background:{bg};'
              f'overflow:hidden;">{"".join(parts)}</div>')
    doc = (f'<!doctype html><html><head><meta charset="utf-8">'
           f'<style>html,body{{margin:0;padding:0;}}</style></head>'
           f'<body>{canvas}</body></html>')
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(doc)
    print(f"wrote {out_path}  (bg={bg}, {len(boxes)} boxes, aspect {cx}x{cy}, font_scale={font_scale:.4f})")


if __name__ == "__main__":
    args = sys.argv[1:]
    if "--slide" not in args or "--out" not in args:
        print(__doc__)
        sys.exit(2)
    pptx = args[0]
    n = int(args[args.index("--slide") + 1])
    out = args[args.index("--out") + 1]
    render_slide(pptx, n, out)
