#!/usr/bin/env python3
"""Measure calibration glyph heights vs the green ruler box.
Usage: scratch-measure.py <png> <label>
Prints heading/text cap-heights and green-box width in raw px, plus
values normalized to canvas-px using the green box (known 480 canvas-px wide).
"""
import sys
from PIL import Image

path, label = sys.argv[1], sys.argv[2]
im = Image.open(path).convert("RGB")
W, H = im.size
px = im.load()

def is_white(r, g, b): return r > 200 and g > 200 and b > 200
def is_green(r, g, b): return g > 170 and r < 120 and b < 120

# per-row white count and green presence
white_rows = [0] * H
green_rows = [0] * H
green_xmin = [W] * H
green_xmax = [-1] * H
for y in range(H):
    for x in range(W):
        r, g, b = px[x, y]
        if is_white(r, g, b):
            white_rows[y] += 1
        elif is_green(r, g, b):
            green_rows[y] += 1
            if x < green_xmin[y]: green_xmin[y] = x
            if x > green_xmax[y]: green_xmax[y] = x

# --- green box: contiguous rows with substantial green -> box width ---
gthresh = max(20, W // 40)
grow = [y for y in range(H) if green_rows[y] > gthresh]
if not grow:
    print(f"{label}: NO GREEN BOX FOUND"); sys.exit(1)
box_top, box_bot = min(grow), max(grow)
box_w = max(green_xmax[y] - green_xmin[y] + 1 for y in grow)
box_h = box_bot - box_top + 1

# --- white text bands: group contiguous rows with white pixels ---
wthresh = 5
bands = []
y = 0
while y < H:
    if white_rows[y] > wthresh:
        s = y
        while y < H and white_rows[y] > wthresh:
            y += 1
        bands.append((s, y - 1))
    else:
        y += 1
# exclude any band overlapping the green box vertical span (RULER label / counter)
bands = [(s, e) for (s, e) in bands if e < box_top or s > box_bot]
# the "01 / 01" counter is tiny/bottom-right; keep only tall bands (the two H rows)
bands = [(s, e) for (s, e) in bands if (e - s + 1) > 20]
bands.sort()
if len(bands) < 2:
    print(f"{label}: expected >=2 white bands, got {len(bands)}: {bands}"); sys.exit(1)
heading = bands[0]
text = bands[1]
head_h = heading[1] - heading[0] + 1
text_h = text[1] - text[0] + 1

scale = box_w / 480.0  # canvas-px -> image-px, from the known 480-canvas-px box
print(f"{label}: img={W}x{H}")
print(f"  green_box: width_px={box_w} height_px={box_h}  => scale(img/canvas)={scale:.4f}  box_w_canvas={box_w/scale:.1f}")
print(f"  heading  : cap_px={head_h}  cap_canvas={head_h/scale:.2f}  ratio(cap/box)={head_h/box_w:.5f}")
print(f"  text     : cap_px={text_h}  cap_canvas={text_h/scale:.2f}  ratio(cap/box)={text_h/box_w:.5f}")
