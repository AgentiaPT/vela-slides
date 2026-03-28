#!/usr/bin/env python3
"""Print a compact slide-by-slide summary of a Vela deck."""
import json, sys

def summarize(path):
    with open(path) as f:
        d = json.load(f)
    slides = []
    if "lanes" in d:
        for lane in d["lanes"]:
            for item in lane.get("items", []):
                for s in item.get("slides", []):
                    slides.append(s)
    elif "S" in d:
        for s in d["S"]:
            slides.append(s)

    for i, s in enumerate(slides, 1):
        title = s.get("title", s.get("n", "?"))
        dur = s.get("duration", s.get("d", "?"))
        has_grad = "grad" if s.get("bgGradient") else ""
        blocks = s.get("blocks", s.get("B", []))
        types = []
        headline = ""
        for b in blocks:
            if isinstance(b, int):
                continue
            if isinstance(b, dict):
                t = b.get("type", b.get("_", "?"))
                types.append(t)
                if t == "heading" and not headline:
                    headline = b.get("text", b.get("x", ""))
        print(f"  {i}. {title} ({dur}s) {has_grad}")
        print(f"     [{', '.join(types)}]")
        if headline:
            print(f"     \"{headline}\"")

if __name__ == "__main__":
    for path in sys.argv[1:]:
        ver = path.split("/")[-3] if "results" in path else path
        print(f"━━━ {ver} ━━━")
        summarize(path)
        print()
