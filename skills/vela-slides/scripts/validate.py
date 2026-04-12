#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""
Vela Deck Validator
Checks deck JSON for common quality issues before assembly.

Usage:
  python3 validate.py <deck.vela>
"""

import sys, json, os

REQUIRED_SLIDE_KEYS = {"blocks", "duration"}
VALID_BLOCK_TYPES = {
    "heading", "text", "bullets", "image", "code", "grid", "callout",
    "metric", "quote", "badge", "icon", "icon-row", "flow", "table",
    "progress", "steps", "tag-group", "timeline", "svg", "spacer", "divider",
    "comparison", "funnel", "cycle", "number-row", "matrix", "checklist"
}
SIZE_TOKENS = {"xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"}

def validate(path):
    with open(path, 'r', encoding="utf-8") as f:
        deck = json.load(f)

    # Auto-expand compact/turbo format to full format before validating
    if "S" in deck or isinstance(deck, list):
        try:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            sys.path.insert(0, script_dir)
            from vela import _load_full
            deck = _load_full(path)
            # Save expanded version back so assembly works
            real_path = os.path.realpath(path)
            if real_path != os.path.abspath(path):
                print(f"WARNING: refusing to write through symlink: {path}", file=sys.stderr)
            else:
                with open(real_path, 'w', encoding="utf-8") as f:
                    json.dump(deck, f, ensure_ascii=False)
        except ImportError:
            pass

    errors = []
    warnings = []
    stats = {"slides": 0, "blocks": 0, "duration": 0, "block_types": {}}

    if not deck.get("deckTitle"):
        errors.append("Missing 'deckTitle' — every deck needs a title")

    lanes = deck.get("lanes", [])
    if not lanes:
        errors.append("No lanes found in deck")
        return errors, warnings, stats

    for li, lane in enumerate(lanes):
        for ii, item in enumerate(lane.get("items", [])):
            slides = item.get("slides", [])
            if not slides:
                warnings.append(f"Lane '{lane.get('title','?')}' → Item '{item.get('title','?')}' has no slides")

            for si, slide in enumerate(slides):
                loc = f"L{li+1}/I{ii+1}/S{si+1}"
                stats["slides"] += 1

                # Duration check
                dur = slide.get("duration")
                if dur is None:
                    errors.append(f"{loc}: Missing 'duration'")
                else:
                    stats["duration"] += dur
                    if dur < 10:
                        warnings.append(f"{loc}: Duration {dur}s seems too short")
                    if dur > 300:
                        warnings.append(f"{loc}: Duration {dur}s seems too long")

                # Background check
                if not slide.get("bg") and not slide.get("bgGradient"):
                    errors.append(f"{loc}: Missing 'bg' or 'bgGradient'")

                # Color check + contrast auto-fix
                if not slide.get("color"):
                    warnings.append(f"{loc}: No 'color' set — will use default")
                else:
                    # Auto-fix low contrast: light text on light bg or dark text on dark bg
                    bg_hex = slide.get("bg", "#0A0F1C")
                    color_hex = slide.get("color", "#E6F1FF")
                    if bg_hex and color_hex and bg_hex.startswith("#") and color_hex.startswith("#"):
                        try:
                            bg_r, bg_g, bg_b = [int(bg_hex.lstrip("#")[i:i+2], 16) for i in (0,2,4)]
                            fg_r, fg_g, fg_b = [int(color_hex.lstrip("#")[i:i+2], 16) for i in (0,2,4)]
                            bg_lum = 0.2126*(bg_r/255) + 0.7152*(bg_g/255) + 0.0722*(bg_b/255)
                            fg_lum = 0.2126*(fg_r/255) + 0.7152*(fg_g/255) + 0.0722*(fg_b/255)
                            # Both light or both dark = low contrast
                            if bg_lum > 0.5 and fg_lum > 0.5:
                                slide["color"] = "#1E293B"
                                warnings.append(f"{loc}: Auto-fixed light-on-light contrast (was {color_hex} on {bg_hex})")
                            elif bg_lum < 0.15 and fg_lum < 0.15:
                                slide["color"] = "#E6F1FF"
                                warnings.append(f"{loc}: Auto-fixed dark-on-dark contrast (was {color_hex} on {bg_hex})")
                        except (ValueError, IndexError):
                            pass

                # studyNotes (offline student content) check
                sn = slide.get("studyNotes")
                if sn is not None:
                    if not isinstance(sn, dict):
                        errors.append(f"{loc}: studyNotes must be an object")
                    else:
                        text = sn.get("text")
                        if not text or not isinstance(text, str):
                            errors.append(f"{loc}: studyNotes.text is required (non-empty string)")
                        elif len(text) > 4000:
                            errors.append(f"{loc}: studyNotes.text exceeds 4000 chars ({len(text)})")
                        elif len(text) > 2000:
                            warnings.append(f"{loc}: studyNotes.text > 2000 chars (consider trimming)")
                        if "diagram" in sn:
                            if not isinstance(sn["diagram"], str):
                                errors.append(f"{loc}: studyNotes.diagram must be a string")
                            elif len(sn["diagram"]) > 8000:
                                warnings.append(f"{loc}: studyNotes.diagram exceeds 8000 chars — will be truncated at sanitize")
                        if "questions" in sn:
                            if not isinstance(sn["questions"], list):
                                errors.append(f"{loc}: studyNotes.questions must be an array")
                            elif len(sn["questions"]) > 6:
                                warnings.append(f"{loc}: studyNotes.questions > 6 (will be truncated at render)")
                        if "glossary" in sn and not isinstance(sn["glossary"], dict):
                            errors.append(f"{loc}: studyNotes.glossary must be an object")

                # Block checks
                blocks = slide.get("blocks", [])
                if not blocks:
                    warnings.append(f"{loc}: Empty blocks array")
                if len(blocks) > 7:
                    warnings.append(f"{loc}: {len(blocks)} blocks — may overflow (max 7 recommended)")

                for bi, block in enumerate(blocks):
                    stats["blocks"] += 1
                    bt = block.get("type", "unknown")
                    stats["block_types"][bt] = stats["block_types"].get(bt, 0) + 1

                    if bt not in VALID_BLOCK_TYPES:
                        errors.append(f"{loc}/B{bi+1}: Unknown block type '{bt}'. Valid: {', '.join(sorted(VALID_BLOCK_TYPES))}")

                    # Check grid items have blocks
                    if bt == "grid":
                        for gi, gitem in enumerate(block.get("items", [])):
                            if not gitem.get("blocks"):
                                errors.append(f"{loc}/B{bi+1}/Grid{gi+1}: Grid cell missing 'blocks'")

                    # Check flow items
                    if bt == "flow":
                        items = block.get("items", [])
                        if len(items) > 6:
                            warnings.append(f"{loc}/B{bi+1}: Flow has {len(items)} items — max 5-6 recommended")

    # Quality audit
    type_count = len(stats["block_types"])
    if type_count < 4 and stats["slides"] > 5:
        warnings.append(f"Low visual variety: only {type_count} block types used across {stats['slides']} slides")

    bullet_heavy = stats["block_types"].get("bullets", 0)
    if bullet_heavy > stats["slides"] * 0.5:
        warnings.append(f"Bullet-heavy deck: {bullet_heavy} bullet blocks across {stats['slides']} slides")

    return errors, warnings, stats


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 validate.py <deck.vela>", file=sys.stderr)
        sys.exit(1)

    errors, warnings, stats = validate(sys.argv[1])

    print(f"📊 Deck Stats: {stats['slides']} slides | {stats['blocks']} blocks | {stats['duration']//60}m {stats['duration']%60}s")
    print(f"   Block types: {', '.join(f'{k}({v})' for k,v in sorted(stats['block_types'].items(), key=lambda x: -x[1]))}")

    if warnings:
        print(f"\n⚠️  {len(warnings)} warnings:")
        for w in warnings:
            print(f"   • {w}")

    if errors:
        print(f"\n❌ {len(errors)} errors:")
        for e in errors:
            print(f"   • {e}")
        sys.exit(1)
    else:
        print(f"\n✅ Deck is valid")
