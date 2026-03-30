#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""vela — CLI for Vela slide decks. Agent-friendly by design.

Usage:
  vela <resource> <action> [args...]
  vela --capabilities          Machine-readable command index
  vela --help                  Human-readable help

Resources:
  deck     Deck-level operations (list, validate, extract, split, dump, stats, find, extract-text, patch-text, replace-text, assemble, ship, compact, expand, turbo, serve)
  slide    Slide-level operations (view, edit, remove, move, duplicate, insert, remove-block)

Exit codes:
  0  Success
  1  General failure
  2  Usage error (bad arguments)
  3  Resource not found (slide/block/file)
  4  Validation failure
  5  Conflict (already exists)
"""

import json, sys, os, subprocess, copy, shutil
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────────
SKILL_DIR = os.path.dirname(os.path.realpath(__file__))
SCRIPTS_DIR = SKILL_DIR
SKILL_ROOT = os.path.dirname(SKILL_DIR)
VALIDATE_PY = os.path.join(SCRIPTS_DIR, "validate.py")
ASSEMBLE_PY = os.path.join(SCRIPTS_DIR, "assemble.py")
OUTPUT_DIR = os.environ.get("VELA_OUTPUT_DIR", os.getcwd())

# ── Exit codes ─────────────────────────────────────────────────────────
EXIT_OK = 0
EXIT_FAIL = 1
EXIT_USAGE = 2
EXIT_NOT_FOUND = 3
EXIT_VALIDATION = 4
EXIT_CONFLICT = 5

# ── Helpers ────────────────────────────────────────────────────────────
_json_mode = False

def _safe_resolve(file_path, label="file"):
    """Resolve a file path and reject directory traversal / symlink escapes."""
    resolved = Path(file_path).resolve()
    cwd = Path.cwd().resolve()
    if not resolved.is_relative_to(cwd):
        _err(EXIT_USAGE, f"Path traversal blocked for {label}: {file_path}")
    return str(resolved)

def _extract_output_flag(args):
    """Extract --output <path> from args. Returns (output_path, remaining_args)."""
    output_path = None
    remaining = []
    i = 0
    while i < len(args):
        if args[i] == '--output' and i + 1 < len(args):
            output_path = args[i + 1]
            i += 2
        else:
            remaining.append(args[i])
            i += 1
    return output_path, remaining

def _is_json():
    return _json_mode or "--json" in sys.argv

def _out(data):
    """Print structured output to stdout."""
    if isinstance(data, (dict, list)):
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        print(data)

def _err(code, message, suggestions=None, retryable=False):
    """Print error and exit with semantic code."""
    if _is_json():
        err = {"success": False, "error": {"code": code, "message": message, "retryable": retryable}}
        if suggestions:
            err["error"]["suggestions"] = suggestions
        print(json.dumps(err, ensure_ascii=False, indent=2))
    else:
        print(f"❌ {message}", file=sys.stderr)
        if suggestions:
            for s in suggestions:
                print(f"   💡 {s}", file=sys.stderr)
    sys.exit(code)

def _ok(data, message=None):
    """Print success output."""
    if _is_json():
        out = {"success": True}
        if isinstance(data, dict):
            out.update(data)
        else:
            out["data"] = data
        if message:
            out["message"] = message
        _out(out)
    else:
        if message:
            print(f"✅ {message}", file=sys.stderr)
        if data and not isinstance(data, bool):
            _out(data)
    sys.exit(EXIT_OK)

def _load_deck(path):
    if not os.path.exists(path):
        _err(EXIT_NOT_FOUND, f"File not found: {path}",
             suggestions=["Check the file path", "Run: ls /home/claude/*.json"])
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        _err(EXIT_FAIL, f"Invalid JSON: {e}",
             suggestions=["Check JSON syntax", "Run: python3 -m json.tool " + path])

def _save_deck(deck, path):
    with open(path, 'w', encoding="utf-8") as f:
        json.dump(deck, f, ensure_ascii=False, indent=2)

def _all_slides(deck):
    """Yield (global_idx_1based, slide, item) for each slide."""
    idx = 0
    for lane in deck.get("lanes", []):
        for item in lane.get("items", []):
            for si, slide in enumerate(item.get("slides", [])):
                idx += 1
                yield idx, slide, item, si

def _get_slide(deck, num):
    """Get (slides_list, slide_index, item) for 1-indexed slide number."""
    for idx, slide, item, si in _all_slides(deck):
        if idx == num:
            return item["slides"], si, item
    return None, None, None

def _is_dark(slide):
    bg = slide.get("bg", "#0f172a")
    if not bg.startswith("#") or len(bg) < 7:
        return True
    r, g, b = int(bg[1:3], 16), int(bg[3:5], 16), int(bg[5:7], 16)
    return (r * 0.299 + g * 0.587 + b * 0.114) < 128


# ── COMPACT FORMAT ─────────────────────────────────────────────────────
# Compact JSON reduces LLM output tokens by ~61% via:
#   1. Flat slides array (no lanes/items nesting)
#   2. Short key names (_=type, x=text, s=size, etc.)
#   3. Theme presets (T.d/l/a → slides use "t":"d")
#   4. Spacer shorthand (8 instead of {"type":"spacer","h":8})
#
# Detection: compact decks have "S" key (slides array), full decks have "lanes".
# expand_deck() converts compact→full, compact_deck() converts full→compact.

# Block-level key map: short → full
_BK = {
    "_": "type", "x": "text", "s": "size", "c": "color",
    "i": "icon", "b": "bg", "ic": "iconColor", "ib": "iconBg",
    "I": "items", "B": "blocks", "nm": "name",
    "lb": "label", "v": "variant", "w": "weight",
    "g": "gap", "H": "headers", "R": "rows",
    "sl": "sublabel", "slc": "sublabelColor",
    "ac": "arrowColor", "lc": "labelColor",
    "ts": "titleSize", "xs": "textSize",
    "hb": "headerBg", "hc": "headerColor", "cc": "cellColor",
    "bc": "borderColor", "str": "striped", "lo": "loop",
    "lnc": "lineColor", "nc": "numberColor", "tc": "titleColor",
    "xc": "textColor", "dc": "dotColor",
    "cir": "circle", "dir": "direction"
}
_BK_REV = {v: k for k, v in _BK.items()}

# Slide-level key map: short → full
_SK = {"n": "title", "d": "duration", "B": "blocks", "p": "padding"}
_SK_REV = {v: k for k, v in _SK.items()}

# Theme preset key map: short → full slide property
_TK = {"b": "bg", "c": "color", "a": "accent", "p": "padding"}
_TK_REV = {v: k for k, v in _TK.items()}

# Slide properties that come from theme (omit when compacting if they match)
_THEME_PROPS = ["bg", "color", "accent", "padding"]


def _is_compact(deck):
    """Detect compact format."""
    return ("S" in deck or "G" in deck) and "lanes" not in deck


def _expand_keys(obj, keymap):
    """Recursively expand short keys in a dict using keymap."""
    if isinstance(obj, dict):
        result = {}
        for k, v in obj.items():
            full_k = keymap.get(k, k)
            # Recurse into items/blocks arrays but NOT into style objects
            if full_k in ("items", "blocks") and isinstance(v, list):
                result[full_k] = [_expand_block(item) for item in v]
            elif isinstance(v, dict) and full_k != "style":
                result[full_k] = _expand_keys(v, keymap)
            elif isinstance(v, list) and full_k not in ("rows", "headers"):
                result[full_k] = [_expand_keys(item, keymap) if isinstance(item, dict) else item for item in v]
            else:
                result[full_k] = v
        return result
    return obj


def _expand_block(block):
    """Expand a single block from compact form."""
    # Spacer shorthand: int → {"type": "spacer", "h": N}
    if isinstance(block, (int, float)):
        return {"type": "spacer", "h": int(block)}
    if isinstance(block, dict):
        return _expand_keys(block, _BK)
    return block


def _expand_slide(slide, themes):
    """Expand a compact slide: resolve theme, expand keys, expand blocks."""
    # Expand slide-level keys
    expanded = {}
    theme_name = None
    for k, v in slide.items():
        full_k = _SK.get(k, k)
        # Handle blocks array (LLM may write "B" or "blocks")
        if full_k == "blocks" and isinstance(v, list):
            expanded["blocks"] = [_expand_block(b) for b in v]
        elif k == "blocks" and isinstance(v, list) and "blocks" not in expanded:
            expanded["blocks"] = [_expand_block(b) for b in v]
        elif k == "t":
            theme_name = v  # consumed, not passed through
        else:
            expanded[full_k] = v

    # Apply theme defaults (only for props not already in slide)
    if theme_name and theme_name in themes:
        theme = themes[theme_name]
        for tk, tv in theme.items():
            full_prop = _TK.get(tk, tk)
            if full_prop not in expanded:
                expanded[full_prop] = tv

    return expanded


def expand_deck(compact):
    """Convert compact deck format to full Vela JSON."""
    if not _is_compact(compact):
        return copy.deepcopy(compact)  # Already full format

    # Resolve color palette aliases ($A→#3B82F6, etc.)
    if "C" in compact:
        raw_palette = compact.pop("C")

        # Normalize palette: must be flat {str: str}. Skip malformed entries.
        palette = {}
        if isinstance(raw_palette, dict):
            for k, v in raw_palette.items():
                if isinstance(k, str) and isinstance(v, str) and k.startswith("$"):
                    palette[k] = v
                elif isinstance(v, dict):
                    # LLM wrote nested palette like {"palette":{"bg":"#..."}} — skip
                    pass

        if palette:
            # Walk the JSON tree and replace $aliases in string values.
            # Skip known text-content keys to avoid corrupting prose.
            _TEXT_KEYS = frozenset({"n", "x", "text", "title", "label", "lb", "sublabel",
                                    "author", "loopLabel", "gateLabel", "caption",
                                    "annotation", "date", "markup", "deckTitle"})
            # Sort longest alias first so $AB is replaced before $A
            _sorted = sorted(palette.items(), key=lambda x: -len(x[0]))

            def _resolve(obj, skip=False):
                if isinstance(obj, str) and not skip:
                    for alias, color in _sorted:
                        obj = obj.replace(alias, color)
                    return obj
                if isinstance(obj, dict):
                    return {k: _resolve(v, skip=(k in _TEXT_KEYS)) for k, v in obj.items()}
                if isinstance(obj, list):
                    return [_resolve(v, skip) for v in obj]
                return obj

            compact = _resolve(compact)

    # Resolve theme presets
    raw_themes = compact.get("T", {})
    themes = {}
    for name, preset in raw_themes.items():
        themes[name] = dict(preset)  # shallow copy

    # Build full deck with lanes structure
    title = compact.get("n", compact.get("deckTitle", "Untitled"))

    # Handle grouped format "G" or flat "S"
    groups = compact.get("G", None)
    if groups and isinstance(groups, list):
        # Grouped: G=[{"g":"Section Title","S":[slides]}, ...]
        items = []
        for group in groups:
            group_title = group.get("g", group.get("title", "Section"))
            group_slides = group.get("S", group.get("slides", []))
            expanded = [_expand_slide(s, themes) for s in group_slides]
            items.append({
                "title": group_title,
                "status": "done",
                "importance": "must",
                "slides": expanded
            })
    else:
        # Flat: S=[slides] — group into single item
        slides = compact.get("S", [])
        expanded_slides = [_expand_slide(s, themes) for s in slides]
        items = [{
            "title": title,
            "status": "done",
            "importance": "must",
            "slides": expanded_slides
        }]

    result = {
        "deckTitle": title,
        "lanes": [{"title": "Main", "items": items}]
    }

    # Fix bare hex colors missing # prefix (common LLM output issue)
    import re
    raw = json.dumps(result, ensure_ascii=False)
    # Match color fields with 6-char hex missing #
    raw = re.sub(
        r'("(?:bg|color|accent|headerBg|headerColor|cellColor|borderColor|arrowColor|lineColor|dotColor|numberColor|iconColor|iconBg|border|c|b|a|ic|ib)":\s*")([0-9A-Fa-f]{6})"',
        r'\1#\2"', raw
    )
    result = json.loads(raw)

    return result


def _compact_keys(obj, keymap_rev):
    """Recursively shorten keys in a dict."""
    if isinstance(obj, dict):
        result = {}
        for k, v in obj.items():
            short_k = keymap_rev.get(k, k)
            if k in ("items", "blocks") and isinstance(v, list):
                result[short_k] = [_compact_block(item) for item in v]
            elif isinstance(v, dict) and k != "style":
                result[short_k] = _compact_keys(v, keymap_rev)
            elif isinstance(v, list) and k not in ("rows", "headers"):
                result[short_k] = [_compact_keys(item, keymap_rev) if isinstance(item, dict) else item for item in v]
            else:
                result[short_k] = v
        return result
    return obj


def _compact_block(block):
    """Compact a single block."""
    if isinstance(block, dict):
        # Spacer → int
        if block.get("type") == "spacer" and set(block.keys()) <= {"type", "h"}:
            return block["h"]
        return _compact_keys(block, _BK_REV)
    return block


def compact_deck(full):
    """Convert full Vela JSON to compact format."""
    if _is_compact(full):
        return copy.deepcopy(full)  # Already compact

    # Collect all slides and detect theme groups
    slides = []
    for lane in full.get("lanes", []):
        for item in lane.get("items", []):
            for s in item.get("slides", []):
                slides.append(s)

    # Auto-detect themes by grouping slides with identical bg/color/accent/padding
    theme_groups = {}
    for s in slides:
        key = tuple(s.get(p, "") for p in _THEME_PROPS)
        if key not in theme_groups:
            theme_groups[key] = []
        theme_groups[key].append(s)

    # Assign theme names: d (dark), l (light), a (alt), b, c, ... for extras
    themes = {}
    theme_for_key = {}
    names = iter("dlabcefghijkm")
    for key in sorted(theme_groups.keys(), key=lambda k: -len(theme_groups[k])):
        bg = key[0]
        if bg and _is_dark({"bg": bg}):
            name = "d" if "d" not in themes else next(names)
        else:
            name = "l" if "l" not in themes else ("a" if "a" not in themes else next(names))
        while name in themes:
            name = next(names)
        themes[name] = {_TK_REV.get(p, p): v for p, v in zip(_THEME_PROPS, key) if v}
        theme_for_key[key] = name

    # Compact each slide
    compact_slides = []
    for s in slides:
        key = tuple(s.get(p, "") for p in _THEME_PROPS)
        theme_name = theme_for_key.get(key, "d")

        cs = {"t": theme_name}
        for k, v in s.items():
            if k in _THEME_PROPS:
                continue  # Omit — comes from theme
            if k == "blocks":
                cs[_SK_REV.get(k, k)] = [_compact_block(b) for b in v]
            elif k in _SK_REV:
                cs[_SK_REV[k]] = v
            else:
                cs[k] = v
        compact_slides.append(cs)

    result = {
        "n": full.get("deckTitle", "Untitled"),
        "T": themes,
        "S": compact_slides
    }

    # Color palette: find repeated colors in the JSON, alias as $A, $B, ...
    raw = json.dumps(result, ensure_ascii=False, separators=(',', ':'))
    import re as _re
    color_counts = {}
    for m in _re.findall(r'#[a-fA-F0-9]{6,8}', raw):
        color_counts[m] = color_counts.get(m, 0) + 1
    for m in _re.findall(r'rgba\([^)]+\)', raw):
        color_counts[m] = color_counts.get(m, 0) + 1

    # Only alias colors that appear 2+ times (net savings)
    repeated = sorted(
        [(c, n) for c, n in color_counts.items() if n >= 2],
        key=lambda x: -x[1]
    )

    if repeated:
        alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl"
        cmap = {}
        for i, (color, _count) in enumerate(repeated):
            if i >= len(alpha):
                break
            alias = "$" + alpha[i]
            raw = raw.replace(color, alias)
            cmap[alias] = color
        result = json.loads(raw)
        result["C"] = cmap

    return result


# ── TURBO FORMAT ───────────────────────────────────────────────────────
# Positional arrays + color palette. ~44% token savings.
# NOT for LLM generation — for storage, cache, and inter-LLM context.
#
# Detection: top-level is a JSON array (not object).
# Structure: [deckTitle, lanes, colorPalette]
# Blocks: [type_id, ...positional values]
#
# Type IDs: 0=badge, 1=spacer, 2=heading, 3=text, 4=grid, 5=icon,
#           6=callout, 7=icon-row, 8=code, 9=table, 10=flow,
#           11=steps, 12=tag-group, 13=divider, 99=passthrough

_BLOCK_TYPE_IDS = {
    "badge": 0, "spacer": 1, "heading": 2, "text": 3, "grid": 4,
    "icon": 5, "callout": 6, "icon-row": 7, "code": 8, "table": 9,
    "flow": 10, "steps": 11, "tag-group": 12, "divider": 13
}
_BLOCK_ID_TYPES = {v: k for k, v in _BLOCK_TYPE_IDS.items()}


def _is_turbo(data):
    """Detect turbo format: top-level is a list."""
    return isinstance(data, list)


def _build_palette(deck):
    """Extract all unique color values from deck into an ordered palette."""
    colors = []
    seen = set()
    raw = json.dumps(deck, ensure_ascii=False)
    # Hex colors
    for m in __import__('re').findall(r'#[a-fA-F0-9]{6,8}', raw):
        if m not in seen:
            colors.append(m)
            seen.add(m)
    # rgba colors
    for m in __import__('re').findall(r'rgba\([^)]+\)', raw):
        if m not in seen:
            colors.append(m)
            seen.add(m)
    return colors


def _ci(palette, val):
    """Color index: return palette index or -1."""
    if not val or val == "":
        return -1
    try:
        return palette.index(val)
    except ValueError:
        return -1


def _turbo_encode_block(block, palette):
    """Encode a single block to positional array."""
    t = block.get("type", "")
    tid = _BLOCK_TYPE_IDS.get(t, 99)

    if t == "spacer":
        return [1, block.get("h", 0)]
    if t == "badge":
        return [0, block.get("text", ""), block.get("icon", ""),
                _ci(palette, block.get("bg", "")), _ci(palette, block.get("color", ""))]
    if t == "heading":
        return [2, block.get("text", ""), block.get("size", ""),
                block.get("weight", 0), _ci(palette, block.get("color", "")),
                block.get("icon", ""), block.get("iconColor", ""),
                block.get("align", "")]
    if t == "text":
        return [3, block.get("text", ""), block.get("size", ""),
                _ci(palette, block.get("color", "")),
                block.get("align", "")]
    if t == "icon":
        return [5, block.get("name", ""), block.get("size", ""),
                _ci(palette, block.get("color", "")),
                1 if block.get("circle") else 0,
                _ci(palette, block.get("bg", ""))]
    if t == "code":
        return [8, block.get("text", ""), block.get("label", ""),
                block.get("size", ""), _ci(palette, block.get("bg", "")),
                _ci(palette, block.get("color", ""))]
    if t == "callout":
        return [6, block.get("text", ""), block.get("icon", ""),
                _ci(palette, block.get("bg", "")),
                _ci(palette, block.get("border", "")),
                _ci(palette, block.get("color", ""))]
    if t == "icon-row":
        items = [[i.get("icon",""), i.get("title",""), i.get("text",""),
                  _ci(palette, i.get("iconColor","")),
                  _ci(palette, i.get("iconBg",""))]
                 for i in block.get("items", [])]
        return [7, items, block.get("gap", 0),
                block.get("titleSize", ""), block.get("textSize", "")]
    if t == "table":
        return [9, block.get("headers", []), block.get("rows", []),
                1 if block.get("striped") else 0,
                _ci(palette, block.get("headerBg", "")),
                _ci(palette, block.get("headerColor", "")),
                _ci(palette, block.get("cellColor", "")),
                _ci(palette, block.get("borderColor", "")),
                block.get("size", "")]
    if t == "flow":
        items = [[i.get("icon",""), i.get("label",""), i.get("sublabel","")]
                 for i in block.get("items", [])]
        return [10, items, _ci(palette, block.get("arrowColor", "")),
                block.get("direction", ""),
                _ci(palette, block.get("labelColor", "")),
                _ci(palette, block.get("sublabelColor", ""))]
    if t == "steps":
        items = [[i.get("title",""), i.get("text","")]
                 for i in block.get("items", [])]
        return [11, items, _ci(palette, block.get("lineColor", "")),
                _ci(palette, block.get("numberColor", "")),
                _ci(palette, block.get("titleColor", "")),
                _ci(palette, block.get("textColor", ""))]
    if t == "tag-group":
        items = [[i.get("text",""), _ci(palette, i.get("color",""))]
                 for i in block.get("items", [])]
        return [12, items, block.get("variant", ""), block.get("size", "")]
    if t == "grid":
        grid_items = []
        for gi in block.get("items", []):
            sub_blocks = [_turbo_encode_block(b, palette) for b in gi.get("blocks", [])]
            grid_items.append([sub_blocks, gi.get("style", {}), gi.get("direction", "")])
        return [4, block.get("cols", 0), block.get("gap", 0), grid_items]
    if t == "divider":
        return [13, _ci(palette, block.get("color", ""))]
    # Passthrough for unknown types
    return [99, block]


def _turbo_decode_block(arr, palette):
    """Decode a positional array back to a block dict."""
    def _cv(idx):
        """Color value from palette index."""
        if idx < 0 or idx >= len(palette):
            return ""
        return palette[idx]

    def _clean(d):
        """Remove empty-string values."""
        return {k: v for k, v in d.items() if v != "" and v != 0 and v is not None} if isinstance(d, dict) else d

    if not isinstance(arr, list) or len(arr) < 1:
        return arr
    tid = arr[0]

    if tid == 1:  # spacer
        return {"type": "spacer", "h": arr[1]}
    if tid == 0:  # badge
        r = {"type": "badge", "text": arr[1], "icon": arr[2]}
        bg = _cv(arr[3]); color = _cv(arr[4])
        if bg: r["bg"] = bg
        if color: r["color"] = color
        return r
    if tid == 2:  # heading
        r = {"type": "heading", "text": arr[1], "size": arr[2]}
        if arr[3]: r["weight"] = arr[3]
        c = _cv(arr[4])
        if c: r["color"] = c
        if len(arr) > 5 and arr[5]: r["icon"] = arr[5]
        if len(arr) > 6 and arr[6]: r["iconColor"] = arr[6]
        if len(arr) > 7 and arr[7]: r["align"] = arr[7]
        return r
    if tid == 3:  # text
        r = {"type": "text", "text": arr[1], "size": arr[2]}
        c = _cv(arr[3])
        if c: r["color"] = c
        if len(arr) > 4 and arr[4]: r["align"] = arr[4]
        return r
    if tid == 5:  # icon
        r = {"type": "icon", "name": arr[1], "size": arr[2]}
        c = _cv(arr[3])
        if c: r["color"] = c
        if arr[4]: r["circle"] = True
        bg = _cv(arr[5])
        if bg: r["bg"] = bg
        return r
    if tid == 8:  # code
        r = {"type": "code", "text": arr[1], "label": arr[2], "size": arr[3]}
        bg = _cv(arr[4])
        if bg: r["bg"] = bg
        c = _cv(arr[5])
        if c: r["color"] = c
        return r
    if tid == 6:  # callout
        r = {"type": "callout", "text": arr[1], "icon": arr[2]}
        bg = _cv(arr[3])
        if bg: r["bg"] = bg
        if arr[4] != "" and arr[4] >= 0:
            border = _cv(arr[4])
            if border: r["border"] = border
        c = _cv(arr[5])
        if c: r["color"] = c
        return r
    if tid == 7:  # icon-row
        items = [{"icon": i[0], "title": i[1], "text": i[2],
                  "iconColor": _cv(i[3]), "iconBg": _cv(i[4])}
                 for i in arr[1]]
        items = [{k:v for k,v in i.items() if v} for i in items]
        r = {"type": "icon-row", "items": items}
        if arr[2]: r["gap"] = arr[2]
        if arr[3]: r["titleSize"] = arr[3]
        if arr[4]: r["textSize"] = arr[4]
        return r
    if tid == 9:  # table
        r = {"type": "table", "headers": arr[1], "rows": arr[2]}
        if arr[3]: r["striped"] = True
        hb = _cv(arr[4])
        if hb: r["headerBg"] = hb
        hc = _cv(arr[5])
        if hc: r["headerColor"] = hc
        cc = _cv(arr[6])
        if cc: r["cellColor"] = cc
        bc = _cv(arr[7])
        if bc: r["borderColor"] = bc
        if arr[8]: r["size"] = arr[8]
        return r
    if tid == 10:  # flow
        items = [{"icon": i[0], "label": i[1], "sublabel": i[2]}
                 for i in arr[1]]
        r = {"type": "flow", "items": items}
        ac = _cv(arr[2])
        if ac: r["arrowColor"] = ac
        if arr[3]: r["direction"] = arr[3]
        lc = _cv(arr[4])
        if lc: r["labelColor"] = lc
        sc = _cv(arr[5])
        if sc: r["sublabelColor"] = sc
        return r
    if tid == 11:  # steps
        items = [{"title": i[0], "text": i[1]} for i in arr[1]]
        r = {"type": "steps", "items": items}
        lc = _cv(arr[2])
        if lc: r["lineColor"] = lc
        nc = _cv(arr[3])
        if nc: r["numberColor"] = nc
        tc = _cv(arr[4])
        if tc: r["titleColor"] = tc
        xc = _cv(arr[5])
        if xc: r["textColor"] = xc
        return r
    if tid == 12:  # tag-group
        items = [{"text": i[0], "color": _cv(i[1])} for i in arr[1]]
        items = [{k:v for k,v in i.items() if v} for i in items]
        r = {"type": "tag-group", "items": items}
        if arr[2]: r["variant"] = arr[2]
        if arr[3]: r["size"] = arr[3]
        return r
    if tid == 4:  # grid
        grid_items = []
        for gi in arr[3]:
            blocks = [_turbo_decode_block(b, palette) for b in gi[0]]
            item = {"blocks": blocks}
            if gi[1]: item["style"] = gi[1]
            if gi[2]: item["direction"] = gi[2]
            grid_items.append(item)
        r = {"type": "grid", "items": grid_items}
        if arr[1]: r["cols"] = arr[1]
        if arr[2]: r["gap"] = arr[2]
        return r
    if tid == 13:  # divider
        r = {"type": "divider"}
        c = _cv(arr[1]) if len(arr) > 1 else ""
        if c: r["color"] = c
        return r
    if tid == 99:  # passthrough
        return arr[1]
    return arr


def turbo_deck(deck):
    """Convert full deck JSON to turbo format (positional arrays + color palette)."""
    # Ensure full format first
    if _is_compact(deck):
        deck = expand_deck(deck)

    palette = _build_palette(deck)

    def encode_slide(s):
        return [
            s.get("title", ""),
            _ci(palette, s.get("bg", "")),
            s.get("bgGradient", ""),
            _ci(palette, s.get("color", "")),
            _ci(palette, s.get("accent", "")),
            s.get("align", ""),
            s.get("verticalAlign", ""),
            s.get("padding", ""),
            s.get("duration", 0),
            [_turbo_encode_block(b, palette) for b in s.get("blocks", [])]
        ]

    def encode_item(item):
        return [
            item.get("title", ""),
            item.get("status", "done"),
            item.get("importance", "must"),
            [encode_slide(s) for s in item.get("slides", [])]
        ]

    def encode_lane(lane):
        return [
            lane.get("title", ""),
            [encode_item(i) for i in lane.get("items", [])]
        ]

    return [
        deck.get("deckTitle", "Untitled"),
        [encode_lane(l) for l in deck.get("lanes", [])],
        palette
    ]


def unturbo_deck(data):
    """Convert turbo format back to full deck JSON."""
    if not _is_turbo(data):
        return data

    deck_title = data[0]
    lanes_data = data[1]
    palette = data[2] if len(data) > 2 else []

    def decode_slide(s):
        def _cv(idx):
            if idx < 0 or idx >= len(palette): return ""
            return palette[idx]
        result = {"title": s[0]}
        bg = _cv(s[1])
        if bg: result["bg"] = bg
        if s[2]: result["bgGradient"] = s[2]
        color = _cv(s[3])
        if color: result["color"] = color
        accent = _cv(s[4])
        if accent: result["accent"] = accent
        if s[5]: result["align"] = s[5]
        if s[6]: result["verticalAlign"] = s[6]
        if s[7]: result["padding"] = s[7]
        if s[8]: result["duration"] = s[8]
        result["blocks"] = [_turbo_decode_block(b, palette) for b in s[9]]
        return result

    def decode_item(item):
        return {
            "title": item[0],
            "status": item[1],
            "importance": item[2],
            "slides": [decode_slide(s) for s in item[3]]
        }

    def decode_lane(lane):
        return {
            "title": lane[0],
            "items": [decode_item(i) for i in lane[1]]
        }

    return {
        "deckTitle": deck_title,
        "lanes": [decode_lane(l) for l in lanes_data]
    }


def _load_full(path):
    """Load a deck JSON and auto-expand if compact or turbo."""
    deck = _load_deck(path)
    if _is_turbo(deck):
        return unturbo_deck(deck)
    if _is_compact(deck):
        return expand_deck(deck)
    return deck


# ── CAPABILITIES ───────────────────────────────────────────────────────
CAPABILITIES = {
    "version": "2.6.0",
    "resources": {
        "deck": {
            "commands": {
                "list": "vela deck list <deck.json> — TOC with slide#, title, blocks, duration",
                "validate": "vela deck validate <deck.json> — check deck JSON integrity",
                "split": "vela deck split <deck.json> --sections \"Title:N,...\" | --flat | --size N — regroup slides into sections (--flat to merge all into one)",
                "assemble": "vela deck assemble <deck.json> [--output <path>] — inject deck into JSX artifact",
                "ship": "vela deck ship <deck.json> [--output <path>] — validate + assemble in one call",
                "replace-text": "vela deck replace-text <deck.json> \"old\" \"new\" — find/replace across all slides (hex colors auto-cascade to rgba)",
                "stats": "vela deck stats <deck.json> — health audit: block distribution, missing durations, overflow, monotony issues",
                "find": "vela deck find <deck.json> --query \"text\" | --type flow | --missing duration — search slides by content, block type, or missing props",
                "dump": "vela deck dump <deck.json> [--full] — compact text-only view of all slides (--full for all text fields)",
                "extract-text": "vela deck extract-text <deck.json> [output.json] — extract all translatable text as key-value map",
                "patch-text": "vela deck patch-text <deck.json> <texts.json> — apply translated text map back into deck",
                "expand": "vela deck expand <compact.json> <full.json> — compact/turbo → full format",
                "compact": "vela deck compact <full.json> <compact.json> — full → compact format",
                "turbo": "vela deck turbo <deck.json> <turbo.json> — any → turbo format",
                "serve": "vela deck serve <deck.json> [--port N] — live preview with two-way sync",
                "zip": "vela deck zip [--output <path>] — build clean skill ZIP for Claude.ai upload",
            },
            "description": "Deck-level operations (auto-detects full/compact/turbo format)"
        },
        "slide": {
            "commands": {
                "view": "vela slide view <deck.json> <N> — show slide content summary",
                "edit": "vela slide edit <deck.json> <N> <key> <value> — edit slide/block property (block.I.key for blocks)",
                "remove": "vela slide remove <deck.json> <N> — remove a slide",
                "move": "vela slide move <deck.json> <from> <to> — reorder a slide",
                "duplicate": "vela slide duplicate <deck.json> <N> — copy a slide",
                "insert": "vela slide insert <deck.json> <N> <slide.json> — insert slide from file",
                "remove-block": "vela slide remove-block <deck.json> <N> <block#> — remove a block from a slide",
            },
            "description": "Slide-level operations (1-indexed slide numbers)"
        }
    },
    "global_flags": ["--json (structured output)", "--dry-run (preview without writing)", "--help"],
    "exit_codes": {"0": "success", "1": "failure", "2": "usage error", "3": "not found", "4": "validation error", "5": "conflict"}
}


# ── DECK COMMANDS ──────────────────────────────────────────────────────

def deck_list(args):
    """List slides as compact TOC. Usage: vela deck list <deck.json>"""
    if not args:
        _err(EXIT_USAGE, "Missing deck path", suggestions=["vela deck list /home/claude/deck.json"])
    deck = _load_full(args[0])
    slides = []
    for idx, slide, item, si in _all_slides(deck):
        blocks = slide.get("blocks", [])
        types = {}
        for b in blocks:
            t = b.get("type", "?")
            if t != "spacer":
                types[t] = types.get(t, 0) + 1
        theme = "dark" if _is_dark(slide) else "light"
        slides.append({
            "num": idx,
            "title": slide.get("title", "—"),
            "section": item.get("title", "?"),
            "blocks": len(blocks),
            "theme": theme,
            "duration": slide.get("duration", 0),
            "block_types": types
        })

    if _is_json():
        _ok({"deck_title": deck.get("deckTitle", "Untitled"), "slide_count": len(slides), "slides": slides})
    else:
        title = deck.get("deckTitle", "Untitled")
        print(f"📊 {title}")
        print(f"{'#':>3}  {'Title':<40} {'Blk':>4} {'Theme':>6} {'Dur':>5}  Types")
        print("─" * 95)
        for s in slides:
            types_str = ", ".join(f"{t}:{c}" for t, c in s["block_types"].items())
            print(f"{s['num']:>3}  {s['title'][:38]:<40} {s['blocks']:>4} {s['theme']:>6} {s['duration']:>4}s  {types_str}")
        print(f"\n   Total: {len(slides)} slides")
        sys.exit(EXIT_OK)

def deck_validate(args):
    """Validate deck JSON. Usage: vela deck validate <deck.json>"""
    if not args:
        _err(EXIT_USAGE, "Missing deck path", suggestions=["vela deck validate /home/claude/deck.json"])
    # Auto-expand to a temp file for validation — preserve original format on disk
    path = args[0]
    deck = _load_deck(path)
    validate_path = path
    if _is_turbo(deck) or _is_compact(deck):
        import tempfile
        expanded = unturbo_deck(deck) if _is_turbo(deck) else expand_deck(deck)
        tmp_fd, validate_path = tempfile.mkstemp(suffix=".json")
        os.close(tmp_fd)
        _save_deck(expanded, validate_path)
    result = subprocess.run(["python3", VALIDATE_PY, validate_path], capture_output=True, text=True)
    if validate_path != path:
        os.unlink(validate_path)
    if result.returncode != 0:
        if _is_json():
            _err(EXIT_VALIDATION, result.stdout.strip() or result.stderr.strip(), retryable=True,
                 suggestions=["Fix the reported errors and re-run: vela deck validate <deck.json>",
                              "Use --json for structured error details"])
        else:
            print(result.stdout, end="")
            print(result.stderr, end="", file=sys.stderr)
            sys.exit(EXIT_VALIDATION)
    else:
        if _is_json():
            _ok({"valid": True, "output": result.stdout.strip()}, "Deck is valid")
        else:
            print(result.stdout, end="")
            sys.exit(EXIT_OK)

def deck_assemble(args):
    """Assemble deck JSON into JSX artifact.
    Usage: vela deck assemble <deck.json> [--output <path>]"""
    # Parse --output flag
    output_path, filtered = _extract_output_flag(args)
    if not filtered:
        _err(EXIT_USAGE, "Missing deck path", suggestions=["vela deck assemble deck.json", "vela deck assemble deck.json --output out.jsx"])
    # Auto-expand to temp file for assembly — preserve original format on disk
    path = filtered[0]
    assemble_path = path
    deck = _load_deck(path)
    if _is_turbo(deck) or _is_compact(deck):
        import tempfile
        expanded = unturbo_deck(deck) if _is_turbo(deck) else expand_deck(deck)
        tmp_fd, assemble_path = tempfile.mkstemp(suffix=".json")
        os.close(tmp_fd)
        _save_deck(expanded, assemble_path)
    cmd = ["python3", ASSEMBLE_PY, assemble_path]
    if output_path:
        cmd += ["--output", output_path]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if assemble_path != path:
        os.unlink(assemble_path)
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "Unknown error"
        _err(EXIT_FAIL, f"Assembly failed: {detail}", retryable=True)
    else:
        if _is_json():
            _ok({"assembled": True, "output": result.stdout.strip()})
        else:
            print(result.stdout, end="")
            sys.exit(EXIT_OK)

def deck_extract(args):
    """Extract STARTUP_PATCH deck JSON from a .jsx artifact.
    Usage: vela deck extract <source.jsx> [output.json]"""
    import re as _re
    if not args:
        _err(EXIT_USAGE, "Missing source .jsx path",
             suggestions=["vela deck extract artifact.jsx",
                          "vela deck extract artifact.jsx deck.json"])
    source = args[0]
    output = args[1] if len(args) > 1 else source.replace('.jsx', '-deck.json')

    if not os.path.isfile(source):
        _err(EXIT_NOT_FOUND, f"File not found: {source}")

    with open(source, 'r', encoding="utf-8") as f:
        content = f.read()

    match = _re.search(r'const STARTUP_PATCH = ({.*?});\s*\n', content, _re.DOTALL)
    if not match:
        _err(EXIT_NOT_FOUND, "No STARTUP_PATCH found in file",
             suggestions=["Is this a Vela .jsx artifact?",
                          "The file must contain 'const STARTUP_PATCH = {...};'"])

    try:
        deck = json.loads(match.group(1))
    except json.JSONDecodeError as e:
        _err(EXIT_FAIL, f"STARTUP_PATCH JSON is invalid: {e}")

    with open(output, 'w', encoding="utf-8") as f:
        json.dump(deck, f, ensure_ascii=False)

    lanes = len(deck.get('lanes', []))
    slides = sum(len(item.get('slides', []))
                 for lane in deck.get('lanes', [])
                 for item in lane.get('items', []))

    if _is_json():
        _ok({"extracted": True, "output": output, "deckTitle": deck.get("deckTitle", ""),
             "lanes": lanes, "slides": slides})
    else:
        print(f"✅ Extracted: {output}")
        print(f"   {deck.get('deckTitle', '?')} — {lanes} lane(s), {slides} slide(s)")
        sys.exit(EXIT_OK)

def deck_ship(args):
    """Validate + assemble + copy JSON to outputs. One-shot pipeline.
    Auto-expands compact format before processing.
    Usage: vela deck ship <deck.json> [--output <path>]"""
    output_path, filtered = _extract_output_flag(args)

    # Handle --sample flag
    if "--sample" in filtered:
        filtered = [a for a in filtered if a != "--sample"]
        sample_path = os.path.join(SKILL_ROOT, "..", "..", "examples", "starter-deck.json")
        sample_path = os.path.normpath(sample_path)
        if not os.path.isfile(sample_path):
            _err(EXIT_NOT_FOUND, "Sample deck not found",
                 suggestions=[f"Expected at: {sample_path}"])
        # Copy sample to a working location
        work_path = os.path.join(OUTPUT_DIR, "sample-deck.json")
        os.makedirs(os.path.dirname(work_path) or '.', exist_ok=True)
        shutil.copy2(sample_path, work_path)
        filtered = [work_path]

    # Handle --demo flag (bundled demo deck showcasing all block types)
    elif "--demo" in filtered:
        filtered = [a for a in filtered if a != "--demo"]
        demo_path = os.path.join(SKILL_ROOT, "examples", "vela-demo.json")
        if not os.path.isfile(demo_path):
            _err(EXIT_NOT_FOUND, "Demo deck not found",
                 suggestions=[f"Expected at: {demo_path}"])
        work_path = os.path.join(OUTPUT_DIR, "vela-demo.json")
        os.makedirs(os.path.dirname(work_path) or '.', exist_ok=True)
        shutil.copy2(demo_path, work_path)
        filtered = [work_path]

    if not filtered:
        _err(EXIT_USAGE, "Missing deck path", suggestions=["vela deck ship deck.json", "vela deck ship deck.json --output out.jsx"])
    path = filtered[0]
    steps = []
    was_compact = False

    # Step 0: Auto-expand compact or turbo to a temp file for validate+assemble.
    # Preserve original format on disk so the source deck stays compact.
    deck = _load_deck(path)
    ship_path = path  # path used for validate+assemble (may be temp)
    if _is_turbo(deck) or _is_compact(deck):
        import tempfile
        was_compact = True
        expanded = unturbo_deck(deck) if _is_turbo(deck) else expand_deck(deck)
        tmp_fd, ship_path = tempfile.mkstemp(suffix=".json")
        os.close(tmp_fd)
        _save_deck(expanded, ship_path)
        slides_n = sum(1 for _ in _all_slides(expanded))
        fmt_name = "turbo" if _is_turbo(deck) else "compact"
        steps.append({"step": "expand", "success": True,
                       "output": f"Expanded {fmt_name} format ({slides_n} slides)"})

    # Step 1: Validate
    result = subprocess.run(["python3", VALIDATE_PY, ship_path], capture_output=True, text=True)
    steps.append({"step": "validate", "success": result.returncode == 0, "output": result.stdout.strip()})
    if result.returncode != 0:
        if ship_path != path:
            os.unlink(ship_path)
        if _is_json():
            _err(EXIT_VALIDATION, "Validation failed", suggestions=["Fix issues and retry"])
        else:
            print(result.stdout, end="")
            print("❌ Validation failed — aborting ship", file=sys.stderr)
            sys.exit(EXIT_VALIDATION)

    # Step 2: Assemble
    assemble_cmd = ["python3", ASSEMBLE_PY, ship_path, "--minify"]
    if output_path:
        assemble_cmd += ["--output", output_path]
    result = subprocess.run(assemble_cmd, capture_output=True, text=True)
    steps.append({"step": "assemble", "success": result.returncode == 0, "output": result.stdout.strip()})
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "Unknown error"
        if _is_json():
            _err(EXIT_FAIL, f"Assembly failed: {detail}")
        else:
            print(result.stdout, end="")
            print(f"❌ Assembly failed: {detail}", file=sys.stderr)
            sys.exit(EXIT_FAIL)

    # Clean up temp expanded file
    if ship_path != path:
        os.unlink(ship_path)

    # Step 3: Copy JSON to outputs (skip if already in output dir)
    basename = os.path.splitext(os.path.basename(path))[0]
    out_dir = os.path.dirname(os.path.abspath(output_path)) if output_path else OUTPUT_DIR
    json_out = os.path.join(out_dir, basename + ".json")
    if os.path.abspath(path) != os.path.abspath(json_out):
        os.makedirs(out_dir, exist_ok=True)
        shutil.copy2(path, json_out)
        steps.append({"step": "copy_json", "success": True, "output_path": json_out})
    else:
        steps.append({"step": "copy_json", "success": True, "output_path": path, "skipped": "already in output dir"})

    # Find the JSX output
    jsx_path = None
    for line in steps[-2]["output"].split("\n"):
        if "Assembled:" in line:
            parts = line.split("Assembled:")
            if len(parts) > 1:
                jsx_path = parts[1].strip().split()[0] if parts[1].strip() else None

    files_to_present = []
    if jsx_path and os.path.exists(jsx_path):
        files_to_present.append(jsx_path)
    files_to_present.append(json_out)

    if _is_json():
        _ok({
            "shipped": True,
            "was_compact": was_compact,
            "steps": steps,
            "present_files": files_to_present
        }, "Deck shipped successfully")
    else:
        for s in steps:
            if s.get("output"):
                print(s["output"])
        if was_compact:
            print(f"✅ Auto-expanded from compact format", file=sys.stderr)
        print(f"✅ JSON copied to {json_out}", file=sys.stderr)
        print(f"\n📦 Ready to present:", file=sys.stderr)
        for f in files_to_present:
            print(f"   {f}", file=sys.stderr)
        sys.exit(EXIT_OK)

def _is_hex_color(s):
    """Check if a string looks like a hex color (#rrggbb)."""
    import re as _re
    return bool(_re.match(r'^#[0-9a-fA-F]{6}$', s))

def deck_replace_text(args):
    """Find/replace text across entire deck. Idempotent.
    When replacing hex colors, also cascades into rgba() values automatically.
    Usage: vela deck replace-text <deck.json> <old> <new>"""
    if len(args) < 3:
        _err(EXIT_USAGE, "Need: <deck.json> <old> <new>",
             suggestions=["vela deck replace-text deck.json \"old text\" \"new text\"",
                          "vela deck replace-text deck.json \"#3b82f6\" \"#2563eb\"  (also remaps rgba)"])
    path, old, new = args[0], args[1], args[2]
    deck = _load_deck(path)
    raw = json.dumps(deck, ensure_ascii=False)
    count = raw.count(old)
    if count == 0:
        if _is_json():
            _ok({"replaced": 0, "old": old, "new": new}, "Text not found — no changes")
        else:
            print(f"⚠️  \"{old}\" not found in deck — no changes", file=sys.stderr)
            sys.exit(EXIT_OK)
    raw = raw.replace(old, new)

    # Cascade: if replacing a hex color, also remap matching rgba() values
    rgba_count = 0
    if _is_hex_color(old) and _is_hex_color(new):
        old_h = old.lstrip("#")
        new_h = new.lstrip("#")
        old_r, old_g, old_b = int(old_h[0:2], 16), int(old_h[2:4], 16), int(old_h[4:6], 16)
        new_r, new_g, new_b = int(new_h[0:2], 16), int(new_h[2:4], 16), int(new_h[4:6], 16)
        for old_pat, new_pat in [
            (f"rgba({old_r},{old_g},{old_b},", f"rgba({new_r},{new_g},{new_b},"),
            (f"rgba({old_r}, {old_g}, {old_b},", f"rgba({new_r},{new_g},{new_b},"),
        ]:
            c = raw.count(old_pat)
            if c > 0:
                raw = raw.replace(old_pat, new_pat)
                rgba_count += c

    deck = json.loads(raw)
    _save_deck(deck, path)
    total = count + rgba_count
    if _is_json():
        result = {"replaced": count, "old": old, "new": new}
        if rgba_count > 0:
            result["rgba_cascaded"] = rgba_count
        _ok(result)
    else:
        msg = f"✅ Replaced {count} occurrence(s): \"{old}\" → \"{new}\""
        if rgba_count > 0:
            msg += f" (+{rgba_count} rgba cascaded)"
        print(msg, file=sys.stderr)
        sys.exit(EXIT_OK)

def deck_expand(args):
    """Expand compact or turbo deck to full Vela JSON.
    Usage: vela deck expand <deck.json> [output.json]"""
    if not args:
        _err(EXIT_USAGE, "Missing deck path",
             suggestions=["vela deck expand compact.json full.json"])
    path = args[0]
    output = args[1] if len(args) > 1 else None
    deck = _load_deck(path)
    if _is_turbo(deck):
        expanded = unturbo_deck(deck)
        fmt_name = "turbo"
    elif _is_compact(deck):
        expanded = expand_deck(deck)
        fmt_name = "compact"
    else:
        if _is_json():
            _ok({"already_full": True}, "Deck is already in full format")
        else:
            print("⚠️  Deck is already in full format — no expansion needed", file=sys.stderr)
            sys.exit(EXIT_OK)
        return
    out_path = output or path
    _save_deck(expanded, out_path)
    slide_count = sum(1 for _ in _all_slides(expanded))
    if _is_json():
        _ok({"expanded": True, "from": fmt_name, "slides": slide_count, "output": out_path})
    else:
        print(f"✅ Expanded {fmt_name} → {slide_count} slides → {out_path}", file=sys.stderr)
        sys.exit(EXIT_OK)

def deck_compact(args):
    """Compact a full deck to compact format (~61% fewer tokens).
    Usage: vela deck compact <full.json> [output.json]"""
    if not args:
        _err(EXIT_USAGE, "Missing deck path",
             suggestions=["vela deck compact full.json compact.json"])
    path = args[0]
    output = args[1] if len(args) > 1 else None
    deck = _load_deck(path)
    if _is_compact(deck):
        if _is_json():
            _ok({"already_compact": True}, "Deck is already compact")
        else:
            print("⚠️  Deck is already compact — no compaction needed", file=sys.stderr)
            sys.exit(EXIT_OK)
    compacted = compact_deck(deck)
    out_path = output or path

    # Calculate savings
    full_mini = json.dumps(deck, ensure_ascii=False, separators=(',',':'))
    compact_mini = json.dumps(compacted, ensure_ascii=False, separators=(',',':'))
    full_bytes = len(full_mini.encode())
    compact_bytes = len(compact_mini.encode())
    savings = (1 - compact_bytes / full_bytes) * 100 if full_bytes > 0 else 0

    with open(out_path, 'w', encoding="utf-8") as f:
        json.dump(compacted, f, ensure_ascii=False, separators=(',',':'))

    slide_count = len(compacted.get("S", []))
    themes = len(compacted.get("T", {}))
    if _is_json():
        _ok({"compacted": True, "slides": slide_count, "themes": themes,
             "full_bytes": full_bytes, "compact_bytes": compact_bytes,
             "savings_pct": round(savings, 1), "output": out_path})
    else:
        print(f"✅ Compacted {slide_count} slides, {themes} themes → {out_path}", file=sys.stderr)
        print(f"   {full_bytes:,}B → {compact_bytes:,}B ({savings:.0f}% smaller)", file=sys.stderr)
        sys.exit(EXIT_OK)

def deck_turbo(args):
    """Convert deck to turbo format (positional arrays + color palette).
    ~44% token savings. For storage/cache, not LLM generation.
    Usage: vela deck turbo <deck.json> [output.json]"""
    if not args:
        _err(EXIT_USAGE, "Missing deck path",
             suggestions=["vela deck turbo deck.json turbo.json"])
    path = args[0]
    output = args[1] if len(args) > 1 else None
    deck = _load_deck(path)

    # Accept any format as input
    if _is_turbo(deck):
        if _is_json():
            _ok({"already_turbo": True}, "Deck is already in turbo format")
        else:
            print("⚠️  Deck is already in turbo format", file=sys.stderr)
            sys.exit(EXIT_OK)
    if _is_compact(deck):
        deck = expand_deck(deck)

    turbo = turbo_deck(deck)
    out_path = output or path

    # Calculate savings
    full_mini = json.dumps(deck, ensure_ascii=False, separators=(',',':'))
    turbo_mini = json.dumps(turbo, ensure_ascii=False, separators=(',',':'))
    full_bytes = len(full_mini.encode())
    turbo_bytes = len(turbo_mini.encode())
    savings = (1 - turbo_bytes / full_bytes) * 100 if full_bytes > 0 else 0

    with open(out_path, 'w', encoding="utf-8") as f:
        json.dump(turbo, f, ensure_ascii=False, separators=(',',':'))

    slide_count = sum(1 for _ in _all_slides(deck))
    palette_size = len(turbo[2]) if len(turbo) > 2 else 0

    if _is_json():
        _ok({"turbo": True, "slides": slide_count, "palette_colors": palette_size,
             "full_bytes": full_bytes, "turbo_bytes": turbo_bytes,
             "savings_pct": round(savings, 1), "output": out_path})
    else:
        print(f"✅ Turbo: {slide_count} slides, {palette_size} colors → {out_path}", file=sys.stderr)
        print(f"   {full_bytes:,}B → {turbo_bytes:,}B ({savings:.0f}% smaller)", file=sys.stderr)
        sys.exit(EXIT_OK)


# ── SLIDE COMMANDS ─────────────────────────────────────────────────────

def _block_summary(block):
    """Compact one-line summary of a block."""
    t = block.get("type", "?")
    if t == "spacer": return f"[spacer h={block.get('h', '?')}]"
    if t == "heading":
        icon = f" 🔹{block.get('icon','')}" if block.get("icon") else ""
        return f"[heading/{block.get('size','?')}] \"{block.get('text', '')}\"{icon}"
    if t == "text":
        txt = block.get("text", "")[:80]
        if len(block.get("text", "")) > 80: txt += "..."
        return f"[text/{block.get('size','?')}] \"{txt}\""
    if t == "badge": return f"[badge] \"{block.get('text', '')}\" bg={block.get('bg', '?')}"
    if t == "bullets":
        n = len(block.get("items", []))
        return f"[bullets ×{n}]"
    if t == "icon-row":
        titles = [i.get("title", "?") for i in block.get("items", [])[:3]]
        return f"[icon-row ×{len(block.get('items',[]))}] {' · '.join(titles)}"
    if t == "grid":
        return f"[grid cols={block.get('cols','?')} cells={len(block.get('items',[]))}]"
    if t == "flow":
        labels = [i.get("label", "?") for i in block.get("items", [])]
        loop = " 🔁" if block.get("loop") else ""
        return f"[flow] {' → '.join(labels)}{loop}"
    if t == "table":
        return f"[table {len(block.get('headers',[]))}cols × {len(block.get('rows',[]))}rows]"
    if t == "metric": return f"[metric] {block.get('value','?')} — {block.get('label','')}"
    if t == "callout":
        txt = block.get("text", "")[:65]
        return f"[callout] \"{txt}...\""
    if t == "timeline":
        items = block.get("items", [])
        return f"[timeline ×{len(items)}]" if items else "[timeline]"
    if t == "svg":
        return f"[svg {len(block.get('markup',''))}ch] align={block.get('align','?')}"
    if t == "divider": return f"[divider] color={block.get('color','?')}"
    if t == "steps": return f"[steps ×{len(block.get('items',[]))}]"
    if t == "progress": return f"[progress ×{len(block.get('items',[]))}]"
    if t == "quote": return f"[quote] \"{block.get('text','')[:50]}...\""
    if t == "image": return f"[image]"
    if t == "code": return f"[code] {block.get('label','?')}"
    if t == "icon": return f"[icon] {block.get('name','?')}"
    if t == "tag-group": return f"[tag-group ×{len(block.get('items',[]))}]"
    return f"[{t}]"

def slide_view(args):
    """View a single slide. Usage: vela slide view <deck.json> <num> [--json|--raw]"""
    if len(args) < 2:
        _err(EXIT_USAGE, "Need: <deck.json> <slide_num>",
             suggestions=["vela slide view deck.json 3", "vela slide view deck.json 3 --raw"])
    path, num = args[0], int(args[1])
    raw_mode = "--raw" in args
    deck = _load_full(path)

    slides, si, item = _get_slide(deck, num)
    if slides is None:
        _err(EXIT_NOT_FOUND, f"Slide {num} not found",
             suggestions=["Run: vela deck list " + path])

    slide = slides[si]
    if raw_mode or _is_json():
        _ok(slide if raw_mode else {
            "num": num,
            "section": item.get("title", "?"),
            "slide": slide
        })
    else:
        print(f"━━━ Slide {num}: {slide.get('title', '—')} ━━━")
        print(f"  Section: {item.get('title', '?')}")
        print(f"  bg: {slide.get('bg','?')}  accent: {slide.get('accent','?')}  align: {slide.get('align','left')}  vAlign: {slide.get('verticalAlign','top')}")
        if slide.get("bgGradient"):
            g = slide["bgGradient"]
            print(f"  gradient: {g[:60]}{'...' if len(g)>60 else ''}")
        print(f"  padding: {slide.get('padding','?')}  duration: {slide.get('duration','?')}s")
        print(f"  blocks ({len(slide.get('blocks', []))}):")
        for i, block in enumerate(slide.get("blocks", [])):
            print(f"    [{i}] {_block_summary(block)}")
        sys.exit(EXIT_OK)

def slide_edit(args):
    """Edit a slide property. Usage: vela slide edit <deck.json> <num> <key> <value>"""
    if len(args) < 4:
        _err(EXIT_USAGE, "Need: <deck.json> <slide_num> <key> <value>",
             suggestions=["vela slide edit deck.json 3 duration 90",
                          "vela slide edit deck.json 3 bg \"#ffffff\""])
    path, num, key, value = args[0], int(args[1]), args[2], args[3]

    # Check for block edit: "block.N.key"
    if key.startswith("block."):
        parts = key.split(".")
        if len(parts) != 3:
            _err(EXIT_USAGE, "Block edit format: block.<index>.<property>",
                 suggestions=["vela slide edit deck.json 3 block.2.text \"New heading\""])
        bnum, bkey = int(parts[1]), parts[2]
        deck = _load_full(path)
        slides, si, _ = _get_slide(deck, num)
        if slides is None:
            _err(EXIT_NOT_FOUND, f"Slide {num} not found")
        blocks = slides[si].get("blocks", [])
        if bnum >= len(blocks):
            _err(EXIT_NOT_FOUND, f"Block {bnum} not found in slide {num} (has {len(blocks)} blocks)")
        # Type coercion
        try: value = int(value)
        except ValueError:
            try: value = float(value)
            except ValueError: pass
        if value == "true": value = True
        elif value == "false": value = False
        old = blocks[bnum].get(bkey, "<unset>")

        if "--dry-run" in args:
            _ok({"would_execute": "set_block", "slide": num, "block": bnum, "key": bkey, "old": str(old), "new": str(value), "reversible": True})
            return

        blocks[bnum][bkey] = value
        _save_deck(deck, path)
        _ok({"slide": num, "block": bnum, "key": bkey, "old": str(old), "new": str(value)},
            f"Slide {num} block [{bnum}].{bkey}: {old} → {value}")
        return

    # Slide-level edit
    deck = _load_full(path)
    slides, si, _ = _get_slide(deck, num)
    if slides is None:
        _err(EXIT_NOT_FOUND, f"Slide {num} not found")

    try: value = int(value)
    except ValueError:
        try: value = float(value)
        except ValueError: pass
    if value == "true": value = True
    elif value == "false": value = False

    old = slides[si].get(key, "<unset>")

    if "--dry-run" in args:
        _ok({"would_execute": "set", "slide": num, "key": key, "old": str(old), "new": str(value), "reversible": True})
        return

    slides[si][key] = value
    _save_deck(deck, path)
    _ok({"slide": num, "key": key, "old": str(old), "new": str(value)},
        f"Slide {num}.{key}: {old} → {value}")

def slide_remove(args):
    """Remove a slide. Usage: vela slide remove <deck.json> <num> [--dry-run]"""
    if len(args) < 2:
        _err(EXIT_USAGE, "Need: <deck.json> <slide_num>")
    path, num = args[0], int(args[1])
    deck = _load_full(path)
    slides, si, item = _get_slide(deck, num)
    if slides is None:
        _err(EXIT_NOT_FOUND, f"Slide {num} not found")

    title = slides[si].get("title", "?")
    if "--dry-run" in args:
        _ok({"would_execute": "remove_slide", "slide": num, "title": title, "reversible": False})
        return

    slides.pop(si)
    if len(slides) == 0:
        for lane in deck.get("lanes", []):
            if item in lane.get("items", []):
                lane["items"].remove(item)
                break
    _save_deck(deck, path)
    _ok({"removed": num, "title": title}, f"Removed slide {num}: \"{title}\"")

def slide_move(args):
    """Move a slide. Usage: vela slide move <deck.json> <from_num> <to_num>"""
    if len(args) < 3:
        _err(EXIT_USAGE, "Need: <deck.json> <from> <to>")
    path, from_num, to_num = args[0], int(args[1]), int(args[2])
    deck = _load_full(path)

    from_slides, from_si, from_item = _get_slide(deck, from_num)
    if from_slides is None:
        _err(EXIT_NOT_FOUND, f"Slide {from_num} not found")

    slide = from_slides.pop(from_si)
    if len(from_slides) == 0:
        for lane in deck.get("lanes", []):
            if from_item in lane.get("items", []):
                lane["items"].remove(from_item)
                break

    target = to_num if to_num <= from_num else to_num - 1
    to_slides, to_si, _ = _get_slide(deck, target)
    if to_slides is None:
        _err(EXIT_NOT_FOUND, f"Target position {to_num} not found")
    to_slides.insert(to_si + 1, slide)
    _save_deck(deck, path)
    _ok({"from": from_num, "to": to_num}, f"Moved slide {from_num} → position {to_num}")

def slide_duplicate(args):
    """Duplicate a slide. Usage: vela slide duplicate <deck.json> <num>"""
    if len(args) < 2:
        _err(EXIT_USAGE, "Need: <deck.json> <slide_num>")
    path, num = args[0], int(args[1])
    deck = _load_full(path)
    slides, si, _ = _get_slide(deck, num)
    if slides is None:
        _err(EXIT_NOT_FOUND, f"Slide {num} not found")
    dup = copy.deepcopy(slides[si])
    dup["title"] = dup.get("title", "") + " (copy)"
    slides.insert(si + 1, dup)
    _save_deck(deck, path)
    _ok({"duplicated": num, "new_position": num + 1}, f"Duplicated slide {num} → {num + 1}")

def slide_insert(args):
    """Insert a slide from JSON file. Usage: vela slide insert <deck.json> <after_num> <slide.json>"""
    if len(args) < 3:
        _err(EXIT_USAGE, "Need: <deck.json> <after_num> <slide_file.json>")
    path, after_num, slide_file = args[0], int(args[1]), args[2]
    slide_file = _safe_resolve(slide_file, "slide file")
    if not os.path.exists(slide_file):
        _err(EXIT_NOT_FOUND, f"Slide file not found: {slide_file}")
    with open(slide_file, encoding="utf-8") as f:
        new_slide = json.load(f)
    deck = _load_full(path)
    slides, si, _ = _get_slide(deck, after_num)
    if slides is None:
        _err(EXIT_NOT_FOUND, f"Slide {after_num} not found")
    slides.insert(si + 1, new_slide)
    _save_deck(deck, path)
    _ok({"inserted_after": after_num}, f"Inserted slide after {after_num}")

def slide_remove_block(args):
    """Remove a block from a slide. Usage: vela slide remove-block <deck.json> <slide_num> <block_num>"""
    if len(args) < 3:
        _err(EXIT_USAGE, "Need: <deck.json> <slide_num> <block_num>")
    path, snum, bnum = args[0], int(args[1]), int(args[2])
    deck = _load_full(path)
    slides, si, _ = _get_slide(deck, snum)
    if slides is None:
        _err(EXIT_NOT_FOUND, f"Slide {snum} not found")
    blocks = slides[si].get("blocks", [])
    if bnum >= len(blocks):
        _err(EXIT_NOT_FOUND, f"Block {bnum} not found in slide {snum}")

    removed = blocks[bnum]
    if "--dry-run" in args:
        _ok({"would_execute": "remove_block", "slide": snum, "block": bnum,
             "type": removed.get("type", "?"), "reversible": False})
        return

    blocks.pop(bnum)
    _save_deck(deck, path)
    _ok({"slide": snum, "block": bnum, "type": removed.get("type", "?")},
        f"Removed block [{bnum}] (type={removed.get('type','?')}) from slide {snum}")


# ── DECK STATS ─────────────────────────────────────────────────────────

def deck_stats(args):
    """Audit deck health: block distribution, quality issues, missing properties.
    Usage: vela deck stats <deck.json>
    Mirrors Vera's deck_stats tool — finds missing durations, overflow, monotony."""
    if not args:
        _err(EXIT_USAGE, "Missing deck path", suggestions=["vela deck stats deck.json"])
    path = args[0]
    deck = _load_full(path)

    total_slides = 0
    total_time = 0
    missing_duration = 0
    missing_bg = 0
    empty_modules = 0
    block_counts = {}
    issues = []

    for lane in deck.get("lanes", []):
        for item in lane.get("items", []):
            if len(item.get("slides", [])) == 0:
                empty_modules += 1
                issues.append(f'"{item.get("title", "?")}" has 0 slides')
            for si, slide in enumerate(item.get("slides", [])):
                total_slides += 1
                total_time += slide.get("duration", 0)
                if not slide.get("duration"):
                    missing_duration += 1
                    issues.append(f'Slide {total_slides}: missing duration')
                if not slide.get("bg") and not slide.get("bgGradient"):
                    missing_bg += 1
                    issues.append(f'Slide {total_slides}: missing bg/bgGradient')
                blocks = slide.get("blocks", [])
                block_count = len(blocks)
                if block_count > 7:
                    issues.append(f'Slide {total_slides}: {block_count} blocks (overflow risk)')
                for b in blocks:
                    bt = b.get("type", "unknown")
                    block_counts[bt] = block_counts.get(bt, 0) + 1
                    # Count nested blocks inside grid cells by their actual type
                    if bt == "grid":
                        for cell in b.get("items", []):
                            for cb in cell.get("blocks", []):
                                cbt = cb.get("type", "unknown")
                                block_counts[cbt] = block_counts.get(cbt, 0) + 1
                # Check heading+bullets monotony
                types = [b.get("type", "") for b in blocks]
                rich_types = {"flow", "grid", "table", "metric", "timeline", "steps",
                              "icon-row", "progress", "code", "svg", "image", "tag-group"}
                has_rich = any(t in rich_types for t in types)
                has_heading = "heading" in types
                has_bullets = "bullets" in types
                if has_heading and has_bullets and not has_rich and block_count >= 2:
                    issues.append(f'Slide {total_slides}: only heading+bullets — consider icon-row, grid, or flow')

    modules = sum(len(l.get("items", [])) for l in deck.get("lanes", []))
    m, s = divmod(total_time, 60)
    h, m = divmod(m, 60)
    time_str = f"{h}h {m}m" if h > 0 else f"{m}m {s}s" if m > 0 else f"{s}s"
    block_dist = sorted(block_counts.items(), key=lambda x: -x[1])

    if _is_json():
        _ok({
            "lanes": len(deck.get("lanes", [])),
            "modules": modules,
            "slides": total_slides,
            "duration": total_time,
            "duration_str": time_str,
            "blocks": dict(block_dist),
            "missing_duration": missing_duration,
            "missing_bg": missing_bg,
            "empty_modules": empty_modules,
            "issues": issues,
        })
    else:
        print(f"📊 {deck.get('deckTitle', 'Deck')}")
        print(f"   {len(deck.get('lanes', []))} lanes · {modules} modules · {total_slides} slides · {time_str}")
        print(f"   Blocks: {', '.join(f'{k}:{v}' for k, v in block_dist)}")
        if missing_duration:
            print(f"   ⚠ {missing_duration} slides missing duration")
        if missing_bg:
            print(f"   ⚠ {missing_bg} slides missing bg")
        if empty_modules:
            print(f"   ⚠ {empty_modules} empty modules")
        if issues:
            print(f"\n   🔍 Issues ({len(issues)}):")
            for issue in issues[:15]:
                print(f"   • {issue}")
            if len(issues) > 15:
                print(f"   ...and {len(issues) - 15} more")
        else:
            print(f"\n   ✅ No issues found")
        sys.exit(EXIT_OK)


# ── DECK FIND ──────────────────────────────────────────────────────────

def deck_find(args):
    """Search slides by text, block type, or missing properties.
    Usage: vela deck find <deck.json> [--query "text"] [--type flow] [--missing duration]
    Mirrors Vera's find_slides tool — fuzzy text search + block type + property filters."""
    if not args:
        _err(EXIT_USAGE, "Missing deck path",
             suggestions=["vela deck find deck.json --query 'ReAct'",
                          "vela deck find deck.json --type flow",
                          "vela deck find deck.json --missing duration"])
    path = args[0]
    deck = _load_full(path)

    # Parse flags
    query = ""
    block_type = ""
    prop_missing = ""
    i = 1
    while i < len(args):
        if args[i] == "--query" and i + 1 < len(args):
            query = args[i + 1].lower(); i += 2
        elif args[i] == "--type" and i + 1 < len(args):
            block_type = args[i + 1].lower(); i += 2
        elif args[i] == "--missing" and i + 1 < len(args):
            prop_missing = args[i + 1]; i += 2
        else:
            # Treat bare args as query
            if not query and not args[i].startswith("-"):
                query = args[i].lower()
            i += 1

    if not query and not block_type and not prop_missing:
        _err(EXIT_USAGE, "Need at least one of: --query, --type, --missing",
             suggestions=["vela deck find deck.json --query 'agent'",
                          "vela deck find deck.json --type table",
                          "vela deck find deck.json --missing duration"])

    def walk_text(blocks):
        parts = []
        for b in (blocks or []):
            for key in ("text", "title", "label", "value", "author", "caption"):
                if key in b and isinstance(b[key], str):
                    parts.append(b[key])
            for it in b.get("items", []):
                if isinstance(it, str):
                    parts.append(it)
                elif isinstance(it, dict):
                    for key in ("text", "label", "title", "sublabel"):
                        if key in it:
                            parts.append(it[key])
            if b.get("type") == "grid":
                for cell in b.get("items", []):
                    parts.extend(walk_text(cell.get("blocks", [])))
            for row in b.get("rows", []):
                if isinstance(row, list):
                    parts.extend(str(c) for c in row)
            for h in b.get("headers", []):
                if isinstance(h, str):
                    parts.append(h)
        return parts

    results = []
    slide_num = 0
    for lane in deck.get("lanes", []):
        for item in lane.get("items", []):
            for si, slide in enumerate(item.get("slides", [])):
                slide_num += 1
                match = True

                # Text search
                if query:
                    all_text = " ".join([
                        item.get("title", ""),
                        slide.get("title", ""),
                        *walk_text(slide.get("blocks", []))
                    ]).lower()
                    if query not in all_text:
                        match = False

                # Block type filter
                if block_type and match:
                    types = [b.get("type", "") for b in slide.get("blocks", [])]
                    # Also check grid cell blocks
                    for b in slide.get("blocks", []):
                        if b.get("type") == "grid":
                            for cell in b.get("items", []):
                                types.extend(cb.get("type", "") for cb in cell.get("blocks", []))
                    if block_type not in types:
                        match = False

                # Missing property
                if prop_missing and match:
                    if slide.get(prop_missing) is not None and slide.get(prop_missing) != 0:
                        match = False

                if match:
                    heading = ""
                    for b in slide.get("blocks", []):
                        if b.get("type") == "heading":
                            heading = b.get("text", "")
                            break
                    results.append({
                        "slide": slide_num,
                        "title": heading or slide.get("title", f"Slide {slide_num}"),
                        "module": item.get("title", ""),
                    })

    if _is_json():
        _ok({"found": len(results), "query": query or None, "type": block_type or None,
             "missing": prop_missing or None, "results": results})
    else:
        if not results:
            print(f"No matches found", file=sys.stderr)
            sys.exit(EXIT_OK)
        print(f"🔍 Found {len(results)} match{'es' if len(results) != 1 else ''}:")
        for r in results[:20]:
            print(f"   #{r['slide']:2d} {r['title']}")
        if len(results) > 20:
            print(f"   ...and {len(results) - 20} more")
        sys.exit(EXIT_OK)


# ── DECK DUMP ──────────────────────────────────────────────────────────

def deck_dump(args):
    """Compact text-only view of entire deck for content review.
    Usage: vela deck dump <deck.json> [--full]

    Default: one line per slide (heading + badge + first body text)
    --full: all text fields per slide (for detailed review/improvement)"""
    if not args:
        _err(EXIT_USAGE, "Missing deck path", suggestions=["vela deck dump deck.json", "vela deck dump deck.json --full"])
    path = args[0]
    full_mode = "--full" in args
    deck = _load_full(path)

    if full_mode:
        texts = _extract_texts(deck)
        if _is_json():
            _ok({"fields": len(texts), "texts": texts})
        else:
            cur_slide = ""
            for k, v in texts.items():
                # Group by slide
                slide_key = k.split(".")[0] if k.startswith("s") else k
                if slide_key != cur_slide and k.startswith("s"):
                    cur_slide = slide_key
                    print(f"\n━━━ Slide {slide_key[1:]} ━━━")
                print(f"  {k}: {v}")
            sys.exit(EXIT_OK)
    else:
        slide_num = 0
        lines = []
        for lane in deck.get("lanes", []):
            for item in lane.get("items", []):
                for si, slide in enumerate(item.get("slides", [])):
                    slide_num += 1
                    heading = ""
                    badge = ""
                    body = ""
                    for block in slide.get("blocks", []):
                        bt = block.get("type", "")
                        if bt == "heading" and not heading:
                            heading = block.get("text", "")
                        elif bt == "badge" and not badge:
                            badge = block.get("text", "")
                        elif bt in ("text", "callout") and not body and block.get("text"):
                            body = block["text"][:80]
                    line = f"  {slide_num:2d}. {heading}"
                    parts = []
                    if badge:
                        parts.append(f"[{badge}]")
                    if body:
                        parts.append(body)
                    if parts:
                        line += " — " + " | ".join(parts)
                    lines.append(line)

        if _is_json():
            _ok({"slides": slide_num, "dump": lines})
        else:
            print(f"📋 {deck.get('deckTitle', 'Deck')} ({slide_num} slides)\n")
            for line in lines:
                print(line)
            sys.exit(EXIT_OK)


# ── DECK EXTRACT-TEXT / PATCH-TEXT ─────────────────────────────────────

def _extract_texts(deck):
    """Walk deck JSON and extract all translatable text fields into a flat dict."""
    texts = {}
    # Deck title
    if deck.get("deckTitle"):
        texts["deckTitle"] = deck["deckTitle"]
    # Lane and item titles
    for li, lane in enumerate(deck.get("lanes", [])):
        if lane.get("title"):
            texts[f"l{li}.title"] = lane["title"]
        for ii, item in enumerate(lane.get("items", [])):
            if item.get("title"):
                texts[f"l{li}.m{ii}.title"] = item["title"]
    slide_num = 0
    for lane in deck.get("lanes", []):
        for item in lane.get("items", []):
            for si, slide in enumerate(item.get("slides", [])):
                slide_num += 1
                prefix = f"s{slide_num}"
                if slide.get("title"):
                    texts[f"{prefix}.title"] = slide["title"]
                for bi, block in enumerate(slide.get("blocks", [])):
                    bt = block.get("type", "")
                    bp = f"{prefix}.b{bi}"
                    # Skip code text (keep code as-is), but include code label
                    if bt == "code":
                        if "label" in block:
                            texts[f"{bp}.label"] = block["label"]
                        continue
                    if bt == "spacer":
                        continue
                    # Block-level text props
                    for key in ("text", "label", "title", "value", "author", "caption"):
                        if key in block and isinstance(block[key], str):
                            texts[f"{bp}.{key}"] = block[key]
                    # Nested items (flow, steps, icon-row, bullets, tag-group)
                    for ii, it in enumerate(block.get("items", [])):
                        if isinstance(it, str):
                            texts[f"{bp}.i{ii}"] = it
                        elif isinstance(it, dict):
                            for key in ("text", "x", "label", "lb", "sublabel", "sl", "title"):
                                if key in it and isinstance(it[key], str):
                                    texts[f"{bp}.i{ii}.{key}"] = it[key]
                    # Table headers and rows
                    for hi, h in enumerate(block.get("headers", [])):
                        if isinstance(h, str):
                            texts[f"{bp}.h{hi}"] = h
                    for ri, row in enumerate(block.get("rows", [])):
                        if isinstance(row, list):
                            for ci, cell in enumerate(row):
                                if isinstance(cell, str):
                                    texts[f"{bp}.r{ri}.c{ci}"] = cell
                    # Grid cell blocks
                    if bt == "grid":
                        for gi, gcell in enumerate(block.get("items", [])):
                            for gbi, gblock in enumerate(gcell.get("blocks", [])):
                                gbt = gblock.get("type", "")
                                gp = f"{bp}.g{gi}.b{gbi}"
                                if gbt in ("spacer", "icon"):
                                    continue
                                for key in ("text", "label", "title", "value"):
                                    if key in gblock and isinstance(gblock[key], str):
                                        texts[f"{gp}.{key}"] = gblock[key]
                                for gii, git in enumerate(gblock.get("items", [])):
                                    if isinstance(git, str):
                                        texts[f"{gp}.i{gii}"] = git
                                    elif isinstance(git, dict):
                                        for key in ("text", "x", "label", "title"):
                                            if key in git and isinstance(git[key], str):
                                                texts[f"{gp}.i{gii}.{key}"] = git[key]
    return texts


def _patch_texts(deck, texts):
    """Apply a text map back into the deck JSON. Returns count of patches applied."""
    import re as _re
    patched = 0
    # Deck title
    if "deckTitle" in texts:
        deck["deckTitle"] = texts["deckTitle"]; patched += 1
    # Lane and item titles
    for li, lane in enumerate(deck.get("lanes", [])):
        key = f"l{li}.title"
        if key in texts:
            lane["title"] = texts[key]; patched += 1
        for ii, item in enumerate(lane.get("items", [])):
            key = f"l{li}.m{ii}.title"
            if key in texts:
                item["title"] = texts[key]; patched += 1
    slide_num = 0
    for lane in deck.get("lanes", []):
        for item in lane.get("items", []):
            for si, slide in enumerate(item.get("slides", [])):
                slide_num += 1
                prefix = f"s{slide_num}"
                key = f"{prefix}.title"
                if key in texts:
                    slide["title"] = texts[key]; patched += 1
                for bi, block in enumerate(slide.get("blocks", [])):
                    bt = block.get("type", "")
                    bp = f"{prefix}.b{bi}"
                    if bt == "code":
                        key = f"{bp}.label"
                        if key in texts:
                            block["label"] = texts[key]; patched += 1
                        continue
                    if bt == "spacer":
                        continue
                    for prop in ("text", "label", "title", "value", "author", "caption"):
                        key = f"{bp}.{prop}"
                        if key in texts:
                            block[prop] = texts[key]; patched += 1
                    for ii, it in enumerate(block.get("items", [])):
                        if isinstance(it, str):
                            key = f"{bp}.i{ii}"
                            if key in texts:
                                block["items"][ii] = texts[key]; patched += 1
                        elif isinstance(it, dict):
                            for prop in ("text", "x", "label", "lb", "sublabel", "sl", "title"):
                                key = f"{bp}.i{ii}.{prop}"
                                if key in texts:
                                    it[prop] = texts[key]; patched += 1
                    for hi, h in enumerate(block.get("headers", [])):
                        key = f"{bp}.h{hi}"
                        if key in texts:
                            block["headers"][hi] = texts[key]; patched += 1
                    for ri, row in enumerate(block.get("rows", [])):
                        if isinstance(row, list):
                            for ci, cell in enumerate(row):
                                key = f"{bp}.r{ri}.c{ci}"
                                if key in texts:
                                    row[ci] = texts[key]; patched += 1
                    if bt == "grid":
                        for gi, gcell in enumerate(block.get("items", [])):
                            for gbi, gblock in enumerate(gcell.get("blocks", [])):
                                gp = f"{bp}.g{gi}.b{gbi}"
                                for prop in ("text", "label", "title", "value"):
                                    key = f"{gp}.{prop}"
                                    if key in texts:
                                        gblock[prop] = texts[key]; patched += 1
                                for gii, git in enumerate(gblock.get("items", [])):
                                    if isinstance(git, str):
                                        key = f"{gp}.i{gii}"
                                        if key in texts:
                                            gblock["items"][gii] = texts[key]; patched += 1
                                    elif isinstance(git, dict):
                                        for prop in ("text", "x", "label", "title"):
                                            key = f"{gp}.i{gii}.{prop}"
                                            if key in texts:
                                                git[prop] = texts[key]; patched += 1
    return patched


def deck_extract_text(args):
    """Extract all translatable text from a deck into a flat key-value JSON map.
    Usage: vela deck extract-text <deck.json> [output.json]
    Keys use dot-path format: s1.b0.text, s3.b4.i0.label, s9.b4.r0.c1
    Excludes code block content (but includes code labels)."""
    if not args:
        _err(EXIT_USAGE, "Missing deck path",
             suggestions=["vela deck extract-text deck.json texts.json"])
    path = args[0]
    output = args[1] if len(args) > 1 else None
    deck = _load_full(path)
    texts = _extract_texts(deck)

    result = json.dumps(texts, ensure_ascii=False, indent=2)
    if output:
        with open(output, "w", encoding="utf-8") as f:
            f.write(result)
        if _is_json():
            _ok({"extracted": len(texts), "output": output})
        else:
            print(f"✅ Extracted {len(texts)} text fields → {output}", file=sys.stderr)
            sys.exit(EXIT_OK)
    else:
        print(result)
        sys.exit(EXIT_OK)


def deck_patch_text(args):
    """Apply a translated text map back into a deck.
    Usage: vela deck patch-text <deck.json> <texts.json>
    The texts.json must use the same key format as extract-text output."""
    if len(args) < 2:
        _err(EXIT_USAGE, "Need: <deck.json> <texts.json>",
             suggestions=["vela deck patch-text deck.json translated.json"])
    path, texts_path = args[0], args[1]
    deck = _load_full(path)
    with open(texts_path, "r", encoding="utf-8") as f:
        texts = json.load(f)
    patched = _patch_texts(deck, texts)
    _save_deck(deck, path)
    if _is_json():
        _ok({"patched": patched, "total_keys": len(texts)})
    else:
        print(f"✅ Patched {patched}/{len(texts)} text fields", file=sys.stderr)
        sys.exit(EXIT_OK)


# ── DECK SPLIT ─────────────────────────────────────────────────────────

def deck_split(args):
    """Split a flat deck into sections (modules) by slide count or auto-grouping.
    Usage: vela deck split <deck.json> [--flat] [--size N] [--sections "Title1:3,Title2:4,..."]

    --flat           Flatten all modules into a single module
    --size N         Split every N slides into a section (auto-titled)
    --sections       Named sections with slide counts: "Intro:3,Core:5,Close:2"

    Works on multi-module decks — flattens internally before regrouping.
    Without flags: auto-groups by scanning for badge/section-break slides."""
    if not args:
        _err(EXIT_USAGE, "Missing deck path",
             suggestions=["vela deck split deck.json --size 5",
                          'vela deck split deck.json --sections "Intro:3,Core:5,Close:2"'])
    path = args[0]
    deck = _load_full(path)

    all_slides = [slide for _, slide, _, _ in _all_slides(deck)]
    if not all_slides:
        _err(EXIT_FAIL, "Deck has no slides")

    # Parse flags
    size = None
    sections_spec = None
    flat = "--flat" in args
    i = 1
    while i < len(args):
        if args[i] == "--size" and i + 1 < len(args):
            try:
                size = int(args[i + 1])
            except ValueError:
                _err(EXIT_USAGE, f"Invalid size: {args[i+1]}")
            i += 2
        elif args[i] == "--sections" and i + 1 < len(args):
            sections_spec = args[i + 1]
            i += 2
        else:
            i += 1

    new_items = []

    if flat:
        # Flatten all into one module
        title = deck.get("deckTitle", "All Slides")
        new_items.append({"title": title, "status": "done",
                          "importance": "must", "slides": all_slides})

    elif sections_spec:
        # Named sections: "Intro:3,Core:5,Close:2"
        offset = 0
        for part in sections_spec.split(","):
            part = part.strip()
            if ":" not in part:
                _err(EXIT_USAGE, f"Invalid section spec: '{part}' (use 'Title:N')",
                     suggestions=['vela deck split deck.json --sections "Intro:3,Core:5"'])
            title, count_str = part.rsplit(":", 1)
            try:
                count = int(count_str)
            except ValueError:
                _err(EXIT_USAGE, f"Invalid count in '{part}'")
            slides = all_slides[offset:offset + count]
            if slides:
                new_items.append({"title": title.strip(), "status": "done",
                                  "importance": "must", "slides": slides})
            offset += count
        # Remaining slides
        if offset < len(all_slides):
            new_items.append({"title": "Remaining", "status": "done",
                              "importance": "should", "slides": all_slides[offset:]})

    elif size:
        # Split every N slides
        for idx in range(0, len(all_slides), size):
            chunk = all_slides[idx:idx + size]
            first_title = chunk[0].get("title", "")
            # Try to get a meaningful title from the first slide's heading
            for block in chunk[0].get("blocks", []):
                if block.get("type") == "heading":
                    first_title = block.get("text", first_title)
                    break
                elif block.get("type") == "badge":
                    first_title = block.get("text", first_title)
            section_num = idx // size + 1
            title = first_title or f"Section {section_num}"
            new_items.append({"title": title, "status": "done",
                              "importance": "must", "slides": chunk})

    else:
        # Auto-group: scan for badge blocks that look like section markers
        current_slides = []
        current_title = "Introduction"
        for slide in all_slides:
            # Check if this slide starts a new section (has a badge block)
            badge_text = None
            for block in slide.get("blocks", []):
                if block.get("type") == "badge":
                    badge_text = block.get("text", "")
                    break
            # If the slide has a badge and we already have slides, start a new section
            if badge_text and current_slides:
                new_items.append({"title": current_title, "status": "done",
                                  "importance": "must", "slides": current_slides})
                current_slides = []
                # Get heading from this slide for the section title
                for block in slide.get("blocks", []):
                    if block.get("type") == "heading":
                        current_title = block.get("text", badge_text)
                        break
                else:
                    current_title = badge_text
            current_slides.append(slide)
        if current_slides:
            new_items.append({"title": current_title, "status": "done",
                              "importance": "must", "slides": current_slides})

    if "--dry-run" in args:
        summary = [{"title": it["title"], "slides": len(it["slides"])} for it in new_items]
        _ok({"would_execute": "split", "sections": summary, "total_slides": len(all_slides)})
        return

    deck["lanes"] = [{"title": "Main", "items": new_items}]
    _save_deck(deck, path)

    if _is_json():
        _ok({"sections": len(new_items), "slides": len(all_slides),
             "items": [{"title": it["title"], "slides": len(it["slides"])} for it in new_items]})
    else:
        print(f"✅ Split {len(all_slides)} slides into {len(new_items)} sections:")
        for it in new_items:
            print(f"   {it['title']} ({len(it['slides'])} slides)")
        sys.exit(EXIT_OK)


# ── DECK SERVE ─────────────────────────────────────────────────────────

def deck_serve(args):
    """Start local server for live editing. Usage: vela deck serve <deck.json> [--port 3030] [--no-open] [--no-auth] [--token TOKEN]"""
    if not args:
        _err(EXIT_USAGE, "Missing deck path", suggestions=["vela deck serve /path/to/deck.json"])
    path = args[0]
    if not os.path.isfile(path) and not os.path.isdir(path):
        _err(EXIT_NOT_FOUND, f"Path not found: {path}")

    # Forward all extra flags directly to serve.py
    serve_args = [sys.executable, os.path.join(SCRIPTS_DIR, "serve.py"), path] + args[1:]

    try:
        proc = subprocess.run(serve_args)
        sys.exit(proc.returncode)
    except KeyboardInterrupt:
        sys.exit(0)


# ── ZIP ────────────────────────────────────────────────────────────────

def deck_zip(args):
    """Build a clean skill ZIP for Claude.ai upload.
    Usage: vela deck zip [--output <path>]"""
    import zipfile
    output_path, _ = _extract_output_flag(args)
    if not output_path:
        output_path = os.path.join(os.getcwd(), "vela-slides.zip")

    skill_dir = SKILL_ROOT

    EXCLUDE_DIRS = {"node_modules", "__pycache__", ".git", ".idea", ".vscode", ".claude"}
    EXCLUDE_EXTS = {".pyc", ".pyo"}

    count = 0
    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(skill_dir):
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
            for fname in files:
                if any(fname.endswith(ext) for ext in EXCLUDE_EXTS):
                    continue
                full_path = os.path.join(root, fname)
                rel_path = os.path.relpath(full_path, os.path.dirname(skill_dir))
                zf.write(full_path, rel_path)
                count += 1

    size_kb = os.path.getsize(output_path) / 1024
    if _is_json():
        _ok({"path": output_path, "files": count, "size_kb": round(size_kb)},
            f"ZIP created: {output_path} ({count} files, {size_kb:.0f} KB)")
    else:
        print(f"✅ ZIP created: {output_path}")
        print(f"   {count} files | {size_kb:.0f} KB")
        print(f"   Upload to: Claude.ai → Customize → Skills → + → Upload")

# ── DECK INIT / SLIDE APPEND (incremental deck building) ──────────────

def deck_init(args):
    """Create a deck skeleton. Usage: vela deck init <output.json> --title "T" --palette '{"A":"#hex"}' --themes '{"d":{...}}' --sections "S1,S2,S3"
    Creates a valid compact deck with empty sections, ready for slide append."""
    if not args:
        _err(EXIT_USAGE, "Need: <output.json> --title \"T\" --sections \"S1,S2\"")

    path = args[0]
    rest = args[1:]

    title = "Untitled"
    palette = {}
    themes = {}
    sections = ["Main"]

    i = 0
    while i < len(rest):
        if rest[i] == "--title" and i + 1 < len(rest):
            title = rest[i + 1]; i += 2
        elif rest[i] == "--palette" and i + 1 < len(rest):
            palette = json.loads(rest[i + 1]); i += 2
        elif rest[i] == "--themes" and i + 1 < len(rest):
            themes = json.loads(rest[i + 1]); i += 2
        elif rest[i] == "--sections" and i + 1 < len(rest):
            sections = [s.strip() for s in rest[i + 1].split(",")]; i += 2
        else:
            i += 1

    deck = {"n": title}
    if palette:
        deck["C"] = palette
    if themes:
        deck["T"] = themes
    deck["G"] = [{"g": s, "S": []} for s in sections]

    with open(path, 'w', encoding="utf-8") as f:
        json.dump(deck, f, ensure_ascii=False)
    section_count = len(sections)
    _ok({"path": path, "sections": section_count},
        f"Deck initialized: {title} ({section_count} sections)")


def slide_append(args):
    """Append a slide to a deck section. Usage: vela slide append <deck.json> <section_index> '<slide_json>'
    Section index is 0-based. Slide JSON is compact format (inline string or @file)."""
    if len(args) < 3:
        _err(EXIT_USAGE, "Need: <deck.json> <section_index> '<slide_json>'")

    path = args[0]
    section_idx = int(args[1])
    slide_arg = args[2]

    # Accept @file or inline JSON
    if slide_arg.startswith("@"):
        safe = _safe_resolve(slide_arg[1:], "slide @file")
        with open(safe, encoding="utf-8") as f:
            slide = json.load(f)
    else:
        slide = json.loads(slide_arg)

    deck = _load_deck(path)

    # Support both G (grouped) and S (flat) formats
    if "G" in deck:
        groups = deck["G"]
        if section_idx < 0 or section_idx >= len(groups):
            _err(EXIT_NOT_FOUND, f"Section {section_idx} not found (have {len(groups)} sections)")
        groups[section_idx]["S"].append(slide)
        total = sum(len(g["S"]) for g in groups)
        section_name = groups[section_idx].get("g", f"Section {section_idx}")
    elif "S" in deck:
        deck["S"].append(slide)
        total = len(deck["S"])
        section_name = "flat"
    else:
        _err(EXIT_FAIL, "Deck has no G or S key — run deck init first")

    with open(path, 'w', encoding="utf-8") as f:
        json.dump(deck, f, ensure_ascii=False)

    slide_name = slide.get("n", "untitled")
    _ok({"total_slides": total, "section": section_name, "slide": slide_name},
        f"Slide appended: \"{slide_name}\" → {section_name} ({total} total)")


# ── ROUTING ────────────────────────────────────────────────────────────
COMMANDS = {
    "deck": {
        "list": deck_list,
        "validate": deck_validate,
        "extract": deck_extract,
        "assemble": deck_assemble,
        "ship": deck_ship,
        "replace-text": deck_replace_text,
        "expand": deck_expand,
        "compact": deck_compact,
        "turbo": deck_turbo,
        "stats": deck_stats,
        "find": deck_find,
        "dump": deck_dump,
        "extract-text": deck_extract_text,
        "patch-text": deck_patch_text,
        "split": deck_split,
        "serve": deck_serve,
        "zip": deck_zip,
        "init": deck_init,
    },
    "slide": {
        "view": slide_view,
        "edit": slide_edit,
        "remove": slide_remove,
        "move": slide_move,
        "duplicate": slide_duplicate,
        "insert": slide_insert,
        "remove-block": slide_remove_block,
        "append": slide_append,
    }
}

def main():
    global _json_mode
    _json_mode = "--json" in sys.argv
    # Strip global flags from argv for cleaner parsing
    clean_args = [a for a in sys.argv[1:] if a not in ("--json", "--dry-run")]

    if "--capabilities" in sys.argv:
        _out(CAPABILITIES)
        sys.exit(EXIT_OK)

    if not clean_args or clean_args[0] in ("--help", "-h", "help"):
        print(__doc__)
        sys.exit(EXIT_OK)

    resource = clean_args[0]
    if resource not in COMMANDS:
        _err(EXIT_USAGE, f"Unknown resource: {resource}",
             suggestions=[f"Available: {', '.join(COMMANDS.keys())}",
                          "Run: vela --capabilities"])

    if len(clean_args) < 2 or clean_args[1] in ("--help", "-h", "help"):
        cmds = ", ".join(COMMANDS[resource].keys())
        _err(EXIT_USAGE, f"Need an action for '{resource}'",
             suggestions=[f"Available: {cmds}", f"Example: vela {resource} {list(COMMANDS[resource].keys())[0]} --help"])

    action = clean_args[1]
    if action not in COMMANDS[resource]:
        _err(EXIT_USAGE, f"Unknown action: {resource} {action}",
             suggestions=[f"Available: {', '.join(COMMANDS[resource].keys())}"])

    # Pass remaining args (after resource + action) + any --dry-run
    remaining = clean_args[2:]
    if "--dry-run" in sys.argv:
        remaining.append("--dry-run")

    COMMANDS[resource][action](remaining)

if __name__ == "__main__":
    main()
