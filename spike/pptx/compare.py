#!/usr/bin/env python3
"""Stitch a source Vela render and the LibreOffice render of the generated
.pptx side by side, with labels, for visual parity inspection.

USAGE: python3 compare.py <source.png> <pptx-render.png> <out.png> [title]
"""
import sys
from PIL import Image, ImageDraw, ImageFont

src, gen, out = sys.argv[1], sys.argv[2], sys.argv[3]
title = sys.argv[4] if len(sys.argv) > 4 else ""

W = 960  # normalize each panel to 960 wide
BAR = 34
GAP = 16


def load(p):
    im = Image.open(p).convert("RGB")
    h = round(im.height * W / im.width)
    return im.resize((W, h))


a, b = load(src), load(gen)
panel_h = max(a.height, b.height)
canvas = Image.new("RGB", (W, panel_h * 2 + BAR * 2 + GAP + (24 if title else 0)), (12, 16, 26))
d = ImageDraw.Draw(canvas)
try:
    f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)
except Exception:
    f = ImageFont.load_default()

y = 0
if title:
    d.text((12, 4), title, fill=(226, 232, 240), font=f)
    y += 24
for label, img in [("SOURCE — Vela render", a), ("GENERATED .pptx — LibreOffice render", b)]:
    d.rectangle([0, y, W, y + BAR], fill=(30, 41, 59))
    d.text((12, y + 7), label, fill=(148, 197, 255), font=f)
    y += BAR
    canvas.paste(img, (0, y))
    y += panel_h + GAP

canvas.save(out)
print("wrote", out, canvas.size)
