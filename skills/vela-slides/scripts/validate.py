#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""
Vela Deck Validator
Checks deck JSON for common quality issues before assembly.

Usage:
  python3 validate.py <deck.vela>
"""

import sys, json, os, re

# ── Terminal-output funnel ──────────────────────────────────────────────
# COMPLETE MEDIATION: every human-readable byte this script writes leaves
# through emit(), which applies the canonical encoder in _safe_term.py (read
# that module's header for the threat and the policy). Encoding at the SINK
# rather than at each call site is what makes the mediation total: a new print
# site cannot be added without either routing through emit() or failing the
# lint gate (tools/vela-dev/scripts/lint.py, check_terminal_sink_gate).
#
# NOT applied to file writes, and never to deck data on its way back into a
# deck — `deck extract-text` → `patch-text` is a round-trip edit that must stay
# lossless, so the encoder belongs on the display path only.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _safe_term import term_text  # noqa: E402

_write = print  # the only builtin-print reference; everything else uses emit()


def emit(*parts, **kwargs):
    """Write to the terminal with deck-supplied control sequences neutralized."""
    _write(*(term_text(p) if isinstance(p, str) else p for p in parts), **kwargs)

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


# ── Colour / gradient placement ─────────────────────────────────────────
# A solid-colour field and a gradient field are DIFFERENT fields with different
# grammars. The app encodes each with its own helper (cssColor / cssGradient in
# src/parts/part-imports.jsx). A gradient put in a solid-colour field — the
# commonest authoring mistake, `"bg": "linear-gradient(...)"` — satisfies neither
# helper, so the value is dropped at render and the slide falls back to the theme
# default. Nothing warned the author, so the deck degraded silently and the whole
# visual design of the slide changed. The same silent drop hits every other field
# the app routes through cssColor, and the mirror-image mistake (a solid colour
# in `bgGradient`) drops the same way.
#
# These patterns MIRROR the app encoders; part-imports.jsx stays the single source
# of truth and the only security gate. This is an author-facing lint whose job is
# agreement: a value this validator accepts must not be dropped at render, and a
# value it rejects must be one the app really does drop. Keep the three patterns
# below in step with cssColor / cssGradient when either changes.
_COLOR_OK = re.compile(r"^#[0-9a-f]{3,8}$|^(?:rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\)$|^[a-z]+$", re.I)
_GRADIENT_PREFIX = re.compile(r"^(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(", re.I)
_GRADIENT_OK = re.compile(r"^(?:repeating-)?(?:linear|radial|conic)-gradient\([a-zA-Z0-9#.,%\s()-]*\)$")

# Fields the app renders through cssColor (or writes straight into a CSS `color`
# / `background` scalar): a solid colour token only. `border` is deliberately
# absent — it is a CSS shorthand ("1px solid rgba(...)"), not a colour scalar.
SOLID_COLOR_KEYS = {
    "bg", "color", "accent", "mutedColor",
    "dotColor", "headerBg", "lineColor", "numberColor", "trackColor",
}
# The one field that takes a gradient function.
GRADIENT_KEYS = {"bgGradient"}
# The app drops any colour/gradient scalar longer than this at ingress.
MAX_CSS_SCALAR_LEN = 500
_COLOR_WALK_MAX_DEPTH = 12


def check_color_fields(node, loc, errors, depth=0):
    """Flag colour values the app would silently drop at render.

    Walks a slide (its blocks, columns, grid cells and any nested item objects)
    and reports every colour scalar that sits in the wrong field or uses a
    grammar the renderer cannot encode. `loc` grows with the path so the message
    names the exact block.
    """
    if depth > _COLOR_WALK_MAX_DEPTH:
        return
    if isinstance(node, list):
        for i, child in enumerate(node):
            check_color_fields(child, f"{loc}[{i + 1}]", errors, depth + 1)
        return
    if not isinstance(node, dict):
        return

    for key, value in node.items():
        is_solid = key in SOLID_COLOR_KEYS
        is_gradient = key in GRADIENT_KEYS
        if is_solid or is_gradient:
            # The app deletes any non-string shape on a CSS key at ingress.
            if not isinstance(value, str):
                errors.append(
                    f"{loc}: '{key}' must be a string — a {type(value).__name__} is dropped at load")
            elif len(value) > MAX_CSS_SCALAR_LEN:
                errors.append(
                    f"{loc}: '{key}' is {len(value)} chars — over the {MAX_CSS_SCALAR_LEN}-char "
                    f"limit, so it is dropped at load")
            elif is_solid and _GRADIENT_PREFIX.match(value.strip()):
                if key == "bg" and depth == 0:  # the slide's own background
                    errors.append(
                        f"{loc}: 'bg' holds a gradient. 'bg' takes a SOLID colour only, so the "
                        f"gradient is dropped at render and the slide falls back to the theme "
                        f"default. Move the gradient to 'bgGradient' and set 'bg' to a solid "
                        f"fallback colour (for example \"#0f172a\").")
                else:
                    errors.append(
                        f"{loc}: '{key}' holds a gradient. This field takes a SOLID colour only, "
                        f"so the value is dropped at render. Use a solid colour here; only "
                        f"'bgGradient' accepts a gradient.")
            elif is_solid and not _COLOR_OK.match(value.strip()):
                errors.append(
                    f"{loc}: '{key}' is not a colour Vela accepts, so it is dropped at render and "
                    f"the theme default is used. Use #hex, rgb()/rgba(), hsl()/hsla(), or a CSS "
                    f"colour name.")
            elif is_gradient and not _GRADIENT_PREFIX.match(value.strip()):
                errors.append(
                    f"{loc}: 'bgGradient' must be a gradient function "
                    f"(linear-gradient / radial-gradient / conic-gradient). A solid colour here is "
                    f"dropped at render — put a solid colour in 'bg' instead.")
            elif is_gradient and not _GRADIENT_OK.match(value.strip()):
                errors.append(
                    f"{loc}: 'bgGradient' contains characters the gradient encoder rejects, so it "
                    f"is dropped at render. Use plain colour stops (hex / rgb / hsl, numbers, "
                    f"%, deg) and no quotes, semicolons or external references.")
        # Recurse into nested block structures (blocks, L/R columns, grid items,
        # table cells, flow steps …) so a nested colour gets the same check.
        if isinstance(value, (dict, list)):
            check_color_fields(value, f"{loc}/{key}", errors, depth + 1)


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
                emit(f"WARNING: refusing to write through symlink: {path}", file=sys.stderr)
            else:
                with open(real_path, 'w', encoding="utf-8") as f:
                    json.dump(deck, f, ensure_ascii=False)
        except ImportError as e:
            emit(f"WARNING: could not expand compact/turbo deck ({e}); "
                  f"validating the un-expanded form", file=sys.stderr)

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
                    # Type-check first: a deck can put any JSON shape on these
                    # keys, and .startswith() on a list/number raises. The shape
                    # itself is reported by check_color_fields below.
                    if (isinstance(bg_hex, str) and isinstance(color_hex, str)
                            and bg_hex.startswith("#") and color_hex.startswith("#")):
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

                # Colour / gradient placement, slide and every nested block.
                # Runs before the block checks so a silently-dropped background
                # is reported next to the slide it wrecks.
                check_color_fields(slide, loc, errors)

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
    if len(sys.argv) < 2:
        emit("Usage: python3 validate.py <deck.vela>", file=sys.stderr)
        sys.exit(1)

    errors, warnings, stats = validate(sys.argv[1])

    emit(f"📊 Deck Stats: {stats['slides']} slides | {stats['blocks']} blocks | {stats['duration']//60}m {stats['duration']%60}s")
    emit(f"   Block types: {', '.join(f'{k}({v})' for k,v in sorted(stats['block_types'].items(), key=lambda x: -x[1]))}")

    if warnings:
        emit(f"\n⚠️  {len(warnings)} warnings:")
        for w in warnings:
            emit(f"   • {w}")

    if errors:
        emit(f"\n❌ {len(errors)} errors:")
        for e in errors:
            emit(f"   • {e}")
        sys.exit(1)
    else:
        emit(f"\n✅ Deck is valid")
