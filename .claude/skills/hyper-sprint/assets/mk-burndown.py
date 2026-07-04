#!/usr/bin/env python3
# mk-burndown.py — render the AGENTIC burndown (work remaining = open CRs + agent-found
# defects). Implementation drives it toward 0; each blind-hunt round ADDS scope (a "bump"),
# so the curve rises before finally reaching 0.
#
#   python3 mk-burndown.py <events.json> <out.svg>
#
# events.json = [{"label": "...", "work": <int>, "kind": "start|impl|bump|fix|done"}, ...]
#   in chronological order.  kind "bump" = a blind-hunt round that found N defects (annotated
#   "+work").  Writes <out.svg> (renders on GitHub / most viewers) and, alongside it,
#   <out>.html (open in a browser or screenshot to PNG with the repo's chromium if you want a
#   raster copy).  No third-party deps.
import json, sys, html, pathlib

if len(sys.argv) != 3:
    sys.exit("usage: mk-burndown.py <events.json> <out.svg>")
PTS = json.loads(pathlib.Path(sys.argv[1]).read_text())
out = pathlib.Path(sys.argv[2])

W, H, mL, mR, mT, mB = 960, 520, 70, 30, 40, 96
cw, ch = W - mL - mR, H - mT - mB
n = max(1, len(PTS) - 1)
ymax = max(1, max(p["work"] for p in PTS))
X = lambda i: mL + cw * i / n
Y = lambda v: mT + ch * (1 - v / ymax)
COL = {"start": "#7c9cff", "impl": "#38bdf8", "bump": "#f59e0b", "fix": "#34d399", "done": "#34d399"}

actual = " ".join(f"{X(i):.1f},{Y(p['work']):.1f}" for i, p in enumerate(PTS))
ideal = f"{X(0):.1f},{Y(PTS[0]['work']):.1f} {X(n):.1f},{Y(0):.1f}"
grid = "".join(
    f'<line x1="{mL}" y1="{Y(g):.1f}" x2="{W-mR}" y2="{Y(g):.1f}" stroke="#1e293b"/>'
    f'<text x="{mL-10}" y="{Y(g)+4:.1f}" fill="#64748b" font-size="12" text-anchor="end">{g}</text>'
    for g in range(0, ymax + 1, max(1, ymax // 4)))
dots = ""
for i, p in enumerate(PTS):
    c = COL.get(p["kind"], "#38bdf8"); r = 7 if p["kind"] in ("bump", "done", "start") else 5
    dots += f'<circle cx="{X(i):.1f}" cy="{Y(p["work"]):.1f}" r="{r}" fill="{c}" stroke="#0b1220" stroke-width="2"/>'
    dots += (f'<text x="{X(i):.1f}" y="{H-mB+22:.0f}" fill="#94a3b8" font-size="12" '
             f'text-anchor="middle" transform="rotate(20 {X(i):.1f} {H-mB+22:.0f})">{html.escape(p["label"])}</text>')
    if p["kind"] == "bump":
        dots += f'<text x="{X(i):.1f}" y="{Y(p["work"])-14:.1f}" fill="#f59e0b" font-size="12" font-weight="700" text-anchor="middle">+{p["work"]}</text>'

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
<rect width="{W}" height="{H}" fill="#0b1220"/>
<text x="{mL}" y="24" fill="#e2e8f0" font-size="17" font-weight="700">Agentic burndown — work remaining (open CRs + agent-found defects)</text>
{grid}
<polyline points="{ideal}" fill="none" stroke="#475569" stroke-width="2" stroke-dasharray="6 5"/>
<polyline points="{actual}" fill="none" stroke="#7c9cff" stroke-width="3"/>
{dots}
<text x="{mL}" y="{H-14}" fill="#f59e0b" font-size="12">▲ blind-hunt rounds ADD scope (defects the agents found) — the curve bumps before 0</text>
</svg>'''
out.write_text(svg)
out.with_suffix(".html").write_text(
    f'<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0b1220">{svg}</body>')
print(f"wrote {out} + {out.with_suffix('.html')}")
