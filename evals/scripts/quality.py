#!/usr/bin/env python3
"""
quality.py — Deterministic quality scorers for Vela decks.

Free to compute (no LLM needed). Measures structural quality metrics.

Usage:
  python3 quality.py <deck.json>          # Pretty-print
  python3 quality.py <deck.json> --json   # JSON output
"""

import json
import math
import sys
import os

ALL_BLOCK_TYPES = {
    "heading", "text", "quote", "badge", "callout",
    "bullets", "icon-row", "tag-group",
    "grid", "table", "metric", "progress", "timeline",
    "flow", "steps",
    "image", "code", "svg",
    "spacer", "divider",
}


def load_slides(path):
    """Load deck and extract flat slide list."""
    with open(path) as f:
        data = json.load(f)

    slides = []
    if isinstance(data, list):
        if len(data) > 1 and isinstance(data[1], list):
            for lane in data[1]:
                if isinstance(lane, list) and len(lane) > 1:
                    for item in lane[1]:
                        if isinstance(item, list) and len(item) > 3:
                            slides.extend(item[3])
    elif "G" in data:
        # Compact grouped format: {"G": [{"g": "Section", "S": [slides]}]}
        for group in data.get("G", []):
            slides.extend(group.get("S", []))
    elif "S" in data:
        slides = data.get("S", [])
    elif "lanes" in data:
        for lane in data.get("lanes", []):
            for item in lane.get("items", []):
                slides.extend(item.get("slides", []))

    return data, slides


def get_blocks(slide):
    """Get block dicts from a slide."""
    blocks = slide.get("blocks", slide.get("B", []))
    return [b for b in blocks if isinstance(b, dict)]


def get_type(block):
    return block.get("type", block.get("_", ""))


def score(path):
    """Compute all deterministic quality metrics."""
    data, slides = load_slides(path)
    n = max(len(slides), 1)

    type_counts = {}
    total_blocks = 0
    total_words = 0
    heading_slides = 0
    badge_slides = 0
    themes = set()
    accents = set()
    has_gradient = 0

    for slide in slides:
        blocks = get_blocks(slide)
        has_h = False
        has_b = False

        for b in blocks:
            bt = get_type(b)
            if bt:
                type_counts[bt] = type_counts.get(bt, 0) + 1
                total_blocks += 1
            if bt == "heading":
                has_h = True
            if bt == "badge":
                has_b = True
            text = b.get("text", b.get("x", ""))
            if isinstance(text, str):
                total_words += len(text.split())

        if has_h:
            heading_slides += 1
        if has_b:
            badge_slides += 1

        if isinstance(slide, dict):
            bg = str(slide.get("bg", slide.get("b", "")))
            color = str(slide.get("color", slide.get("c", "")))
            accent = str(slide.get("accent", slide.get("a", "")))
            if bg or color:
                themes.add((bg, color))
            if accent:
                accents.add(accent)
            if slide.get("bgGradient", slide.get("g", "")):
                has_gradient += 1

    types_found = set(type_counts.keys())
    diversity = len(types_found) / len(ALL_BLOCK_TYPES)

    # Shannon entropy
    entropy = 0
    if total_blocks > 0:
        for c in type_counts.values():
            p = c / total_blocks
            if p > 0:
                entropy -= p * math.log2(p)

    # Monotony check: >50% of blocks are heading or bullets
    monotony_types = type_counts.get("heading", 0) + type_counts.get("bullets", 0)
    monotony = monotony_types / total_blocks if total_blocks else 0

    return {
        "slide_count": len(slides),
        "block_types_used": sorted(types_found),
        "block_diversity": round(diversity, 3),
        "block_type_entropy": round(entropy, 3),
        "monotony_ratio": round(monotony, 3),
        "theme_variety": len(themes),
        "accent_colors": len(accents),
        "gradient_slides": has_gradient,
        "heading_rate": round(heading_slides / n, 3),
        "badge_rate": round(badge_slides / n, 3),
        "words_per_slide": round(total_words / n, 1),
        "blocks_per_slide": round(total_blocks / n, 1),
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 quality.py <deck.json> [--json]", file=sys.stderr)
        sys.exit(1)

    path = sys.argv[1]
    if not os.path.isfile(path):
        print(f"Not found: {path}", file=sys.stderr)
        sys.exit(1)

    result = score(path)

    if "--json" in sys.argv:
        print(json.dumps(result, indent=2))
    else:
        print(f"\nDeck Quality — {path}")
        print(f"{'─' * 50}")
        for k, v in result.items():
            if k == "block_types_used":
                print(f"  {k}: {', '.join(v)}")
            else:
                print(f"  {k}: {v}")
        print()


if __name__ == "__main__":
    main()
