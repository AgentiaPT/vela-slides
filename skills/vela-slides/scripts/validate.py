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

# Numeric slide-level layout fields: key -> (min, max, must_be_int).
# Mirrors SLIDE_NUMERIC_BOUNDS in src/parts/part-imports.jsx — the app coerces
# and clamps these at load, so flag bad values here rather than let a deck render
# with a value the author never wrote.
#   imageCols             - column count for a run of adjacent image blocks
#   gap / splitGap        - px gap between blocks / between columns
#   contentFlex/imageFlex - flex-grow ratio of the two columns
SLIDE_NUMERIC_BOUNDS = {
    "imageCols": (1, 6, True),
    "gap": (0, 200, False),
    "splitGap": (0, 200, False),
    "contentFlex": (0.1, 20, False),
    "imageFlex": (0.1, 20, False),
}


def check_slide_numerics(slide, loc, errors):
    """Type/range-check the numeric slide layout fields (see SLIDE_NUMERIC_BOUNDS)."""
    for key, (lo, hi, must_int) in SLIDE_NUMERIC_BOUNDS.items():
        if key not in slide:
            continue
        v = slide[key]
        # bool is an int subclass in Python — reject it explicitly.
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            errors.append(f"{loc}: '{key}' must be a number (got {type(v).__name__})")
            continue
        if must_int and isinstance(v, float) and not v.is_integer():
            errors.append(f"{loc}: '{key}' must be a whole number (got {v})")
            continue
        if not (lo <= v <= hi):
            errors.append(f"{loc}: '{key}' out of range — must be {lo}..{hi} (got {v})")


def validate(path, allow_unresolved=False):
    with open(path, 'r', encoding="utf-8") as f:
        deck = json.load(f)

    # Auto-expand compact/turbo format to full format before validating.
    # Compact detection is shared with vela.py (is_compact) so the two tools
    # can never disagree — a divergent copy here once missed "G"-sectioned
    # compact decks entirely and validated them as empty.
    script_dir = os.path.dirname(os.path.abspath(__file__))
    if script_dir not in sys.path:
        sys.path.insert(0, script_dir)
    expand_errors = []
    have_vela = False
    try:
        import vela as _vela
        from vela import (is_compact, find_unresolved_aliases, DeckExpandError,
                          _load_full, _needs_expansion)
        have_vela = True
    except ImportError as e:
        # vela.py drives the unresolved-colour-alias security gate below
        # (find_unresolved_aliases / expand_deck's _palette_gate). Without it
        # a deck with a live "$X" alias could sail through every other check
        # and get reported "valid" — fail closed instead of validating an
        # un-gated deck. Uses the same "expand_failed" short-circuit as a
        # DeckExpandError so the CLI exits 1 with just this message.
        expand_errors.append(
            f"cannot import vela.py helpers ({e}) — refusing to validate "
            f"without the unresolved-colour-alias gate")
    if have_vela and (_needs_expansion(deck) or isinstance(deck, list)):
        # Propagate --allow-unresolved into the expansion path — expand_deck
        # reads vela's module flag, so without this the standalone validator
        # would hard-fail where `vela deck validate --allow-unresolved` passes.
        prev_mode = _vela._allow_unresolved_mode
        _vela._allow_unresolved_mode = allow_unresolved
        try:
            deck = _load_full(path)
            # Save expanded version back so assembly works
            real_path = os.path.realpath(path)
            if real_path != os.path.abspath(path):
                print(f"WARNING: refusing to write through symlink: {path}", file=sys.stderr)
            else:
                with open(real_path, 'w', encoding="utf-8") as f:
                    json.dump(deck, f, ensure_ascii=False)
        except DeckExpandError as e:
            # Unusable palette / unresolved aliases — report as validation
            # errors instead of a traceback; the deck stays un-expanded.
            expand_errors.append(str(e))
        finally:
            _vela._allow_unresolved_mode = prev_mode

    errors = []
    warnings = []
    stats = {"slides": 0, "blocks": 0, "duration": 0, "block_types": {}}

    if expand_errors:
        # Expansion failed: report only the expand error. Running the rest of
        # the checks against the un-expanded compact form would double-report
        # the same aliases and add bogus cascade noise (missing deckTitle,
        # no lanes, 0-slide stats) about a shape the author never wrote.
        stats["expand_failed"] = True
        return expand_errors, warnings, stats

    # Post-expansion invariant: no colour alias may survive into a deck this
    # validator blesses — a leftover "$X" ships as a literal string. Full-format
    # decks are checked too (they never go through expand_deck's own gate, so
    # expand_deck's RecursionError→DeckExpandError boundary doesn't cover this
    # direct call — guard it here too, same fail-closed outcome).
    if have_vela and isinstance(deck, dict):
        sink = warnings if allow_unresolved else errors
        try:
            unresolved = find_unresolved_aliases(deck)
        except RecursionError:
            # Always a hard error, never downgraded by --allow-unresolved —
            # this is an abuse/DoS guard, not an alias report.
            errors.append("deck is too deeply nested to validate safely")
            unresolved = []
        for apath, _akey, avalue in unresolved:
            sink.append(f"Unresolved colour alias: {apath} = {avalue!r} — "
                        f"define it in palette 'C' (keys carry the $ sigil)")

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

                # Numeric layout fields (imageCols, gap, splitGap, flex ratios)
                check_slide_numerics(slide, loc, errors)

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
                has_cols_content = slide.get("layout") == "cols" and (bool(slide.get("L")) or bool(slide.get("R")))
                if not blocks and not has_cols_content:
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

                # L/R blocks (cols layout)
                for col_key in ("L", "R"):
                    for bi, block in enumerate(slide.get(col_key, [])):
                        stats["blocks"] += 1
                        bt = block.get("type", "unknown")
                        stats["block_types"][bt] = stats["block_types"].get(bt, 0) + 1
                        if bt not in VALID_BLOCK_TYPES:
                            errors.append(f"{loc}/{col_key}{bi+1}: Unknown block type '{bt}'. Valid: {', '.join(sorted(VALID_BLOCK_TYPES))}")

    # Quality audit
    type_count = len(stats["block_types"])
    if type_count < 4 and stats["slides"] > 5:
        warnings.append(f"Low visual variety: only {type_count} block types used across {stats['slides']} slides")

    bullet_heavy = stats["block_types"].get("bullets", 0)
    if bullet_heavy > stats["slides"] * 0.5:
        warnings.append(f"Bullet-heavy deck: {bullet_heavy} bullet blocks across {stats['slides']} slides")

    return errors, warnings, stats


if __name__ == "__main__":
    argv = [a for a in sys.argv[1:] if a != "--allow-unresolved"]
    if not argv:
        print("Usage: python3 validate.py <deck.vela> [--allow-unresolved]", file=sys.stderr)
        sys.exit(1)

    errors, warnings, stats = validate(argv[0], allow_unresolved="--allow-unresolved" in sys.argv)

    # When expansion failed the stats describe a deck that never existed —
    # print only the expand error, not 0-slide noise.
    if not stats.pop("expand_failed", False):
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
