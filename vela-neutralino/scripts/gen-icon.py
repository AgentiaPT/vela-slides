#!/usr/bin/env python3
"""
Render the Vela sail logo (from part-imports.jsx:638) as a 256x256 PNG icon
for the Neutralino window / taskbar. Pure stdlib: no Pillow / cairosvg.

The logo is a small SVG in viewBox 0 0 24 24 composed of:
  * mast   — vertical stroke at x=12 from y=2..22
  * sail1  — filled quadratic path M12 3 Q20 8 14 18 L12 18 Z   (opacity 0.85)
  * sail2  — filled quadratic path M12 6 Q6 10 10 18 L12 18 Z   (opacity 0.40)
  * hull   — horizontal stroke from (8,22) to (16,22)

We rasterise at 2× (512×512 RGBA) with analytic coverage, then box-downsample
to 256×256 for free anti-aliasing. Output ≈ 8 KB.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "resources" / "icons" / "vela.png"

SIZE = 256
OVER = 2                      # oversample factor for AA
W = H = SIZE * OVER
SCALE = W / 24                # svg units → raster pixels

BG       = (15, 23, 42, 255)  # #0f172a  slate-900 — matches Vela bg
ACCENT   = (59, 130, 246)     # #3b82f6  blue-500 — Vela accent
STROKE_W = 1.5 * SCALE        # width of mast / hull strokes

# ---------------------------------------------------------------------------
# Simple RGBA buffer helpers
# ---------------------------------------------------------------------------

def new_buf(color):
    r, g, b, a = color
    row = bytes([r, g, b, a]) * W
    return bytearray(row * H)


def put_pixel(buf, x, y, color):
    """Alpha-composite `color` over the pixel at (x, y)."""
    if x < 0 or y < 0 or x >= W or y >= H:
        return
    i = (y * W + x) * 4
    sr, sg, sb, sa = color
    sa_f = sa / 255.0
    dr, dg, db = buf[i], buf[i + 1], buf[i + 2]
    buf[i]     = int(sr * sa_f + dr * (1 - sa_f))
    buf[i + 1] = int(sg * sa_f + dg * (1 - sa_f))
    buf[i + 2] = int(sb * sa_f + db * (1 - sa_f))
    buf[i + 3] = 255


# ---------------------------------------------------------------------------
# Drawing primitives
# ---------------------------------------------------------------------------

def fill_polygon(buf, points, color):
    """Scanline fill for a list of (x, y) floats. Even-odd rule."""
    ys = [p[1] for p in points]
    y_min = max(0, int(min(ys)))
    y_max = min(H - 1, int(max(ys)) + 1)
    for y in range(y_min, y_max + 1):
        crossings = []
        for i in range(len(points)):
            x0, y0 = points[i]
            x1, y1 = points[(i + 1) % len(points)]
            if (y0 <= y < y1) or (y1 <= y < y0):
                t = (y - y0) / (y1 - y0)
                crossings.append(x0 + t * (x1 - x0))
        crossings.sort()
        for j in range(0, len(crossings) - 1, 2):
            xa = max(0, int(crossings[j]))
            xb = min(W - 1, int(crossings[j + 1]))
            for x in range(xa, xb + 1):
                put_pixel(buf, x, y, color)


def stroke_line(buf, x0, y0, x1, y1, width, color):
    """Thick line via parallel offset segments + round-ish ends."""
    steps = int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 1
    half = width / 2
    for s in range(steps + 1):
        t = s / steps
        cx = x0 + t * (x1 - x0)
        cy = y0 + t * (y1 - y0)
        r = int(half)
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if dx * dx + dy * dy <= half * half:
                    put_pixel(buf, int(cx) + dx, int(cy) + dy, color)


def bezier_q(p0, p1, p2, segments=64):
    """Sample a quadratic Bézier as a list of (x, y) points."""
    out = []
    for i in range(segments + 1):
        t = i / segments
        u = 1 - t
        x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0]
        y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]
        out.append((x, y))
    return out


def svg_to_px(x, y):
    return (x * SCALE, y * SCALE)


# ---------------------------------------------------------------------------
# Downsample + PNG emit
# ---------------------------------------------------------------------------

def downsample(buf):
    dst = bytearray(SIZE * SIZE * 4)
    s = OVER
    for y in range(SIZE):
        for x in range(SIZE):
            r = g = b = a = 0
            for dy in range(s):
                for dx in range(s):
                    i = ((y * s + dy) * W + (x * s + dx)) * 4
                    r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; a += buf[i + 3]
            n = s * s
            j = (y * SIZE + x) * 4
            dst[j] = r // n; dst[j + 1] = g // n; dst[j + 2] = b // n; dst[j + 3] = a // n
    return dst


def emit_png(rgba, size, path):
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type 0 (None)
        raw.extend(rgba[y * size * 4:(y + 1) * size * 4])
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def main():
    buf = new_buf(BG)

    # Big sail — opacity 0.85
    sail1 = bezier_q(svg_to_px(12, 3), svg_to_px(20, 8), svg_to_px(14, 18))
    sail1 += [svg_to_px(12, 18)]
    fill_polygon(buf, sail1, ACCENT + (int(255 * 0.85),))

    # Small sail — opacity 0.40
    sail2 = bezier_q(svg_to_px(12, 6), svg_to_px(6, 10), svg_to_px(10, 18))
    sail2 += [svg_to_px(12, 18)]
    fill_polygon(buf, sail2, ACCENT + (int(255 * 0.40),))

    # Mast (drawn over sails so the centre line is always visible)
    x, y0 = svg_to_px(12, 2)
    _, y1 = svg_to_px(12, 22)
    stroke_line(buf, x, y0, x, y1, STROKE_W, ACCENT + (255,))

    # Hull
    x0, yy = svg_to_px(8, 22)
    x1, _ = svg_to_px(16, 22)
    stroke_line(buf, x0, yy, x1, yy, STROKE_W, ACCENT + (255,))

    emit_png(downsample(buf), SIZE, OUT)
    print(f"wrote {OUT} ({OUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
