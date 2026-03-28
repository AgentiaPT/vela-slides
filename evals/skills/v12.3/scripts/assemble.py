#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""
Vela Deck Assembler
Injects deck JSON into Vela template → ready-to-use .jsx artifact.

Usage:
  python3 assemble.py <deck.json> [output.jsx]
  python3 assemble.py <deck.json> --from-parts [output.jsx]
  python3 assemble.py <deck.json> --output <output.jsx>

--from-parts: rebuild template from parts/ before injecting (use after app edits)
Without flag: uses pre-built vela.jsx (fast path for deck-only generation)
"""

import sys, json, os, re, subprocess

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE = os.path.join(SKILL_DIR, "app", "vela.jsx")
CONCAT_SCRIPT = os.path.join(SKILL_DIR, "scripts", "concat.py")

def safe_minify(jsx_text):
    """JSX-safe minification: strip comments, blanks, changelog. Never breaks ASI."""
    # Phase 1: nuke multi-line const blocks (VELA_CHANGELOG) in one regex pass
    text = re.sub(
        r'const VELA_CHANGELOG = \[.*?\];',
        'const VELA_CHANGELOG = [];',
        jsx_text,
        flags=re.DOTALL
    )
    # Phase 2: line-by-line strip
    out = []
    for line in text.split('\n'):
        s = line.strip()
        if not s:
            continue
        if s.startswith('//') and not s.startswith('//!'):  # pure // comments (keep //! directives)
            continue
        if re.match(r'^\s*console\.\w+\(', s):  # console.log/warn/error
            continue
        out.append(line)
    return '\n'.join(out)


def slugify(text):
    s = re.sub(r'[^\w\s-]', '', text.lower().strip())
    s = re.sub(r'[\s_]+', '-', s)
    return s[:60] or "vela-deck"

def assemble(deck_json_path, output_path=None, from_parts=False, minify=False):
    # Step 0: optionally rebuild template from parts
    if from_parts:
        print("Rebuilding template from parts...")
        result = subprocess.run(
            [sys.executable, CONCAT_SCRIPT],
            capture_output=True, text=True
        )
        print(result.stdout)
        if result.returncode != 0:
            print(f"ERROR: concat failed:\n{result.stderr}", file=sys.stderr)
            sys.exit(1)

    # Step 1: read deck JSON
    with open(deck_json_path, 'r') as f:
        deck = json.load(f)

    # Auto-expand compact/turbo format to full format
    if ('S' in deck or 'G' in deck) and 'lanes' not in deck:
        vela_py = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vela.py")
        result = subprocess.run(
            [sys.executable, vela_py, "deck", "expand", deck_json_path],
            capture_output=True, text=True
        )
        if result.returncode == 0:
            with open(deck_json_path, 'r') as f2:
                deck = json.load(f2)
            print("Auto-expanded compact format")
        else:
            print(f"ERROR: Failed to expand compact format: {result.stderr}", file=sys.stderr)
            sys.exit(1)

    # Normalize: wrap bare slides array in deck structure
    if 'slides' in deck and 'lanes' not in deck:
        title = deck.get('deckTitle', 'Presentation')
        deck = {
            "deckTitle": title,
            "lanes": [{
                "title": "Main",
                "items": [{
                    "title": title,
                    "status": "todo",
                    "importance": "must",
                    "slides": deck["slides"]
                }]
            }]
        }

    if 'lanes' not in deck:
        print("ERROR: JSON must have 'lanes' or 'slides'", file=sys.stderr)
        sys.exit(1)

    deck_json_str = json.dumps(deck, ensure_ascii=False, separators=(',', ':'))

    # Step 2: read template
    with open(TEMPLATE, 'r') as f:
        template = f.read()

    marker = "const STARTUP_PATCH = null;"
    if marker not in template:
        print(f"ERROR: Marker not found in template. Was the app modified incorrectly?", file=sys.stderr)
        sys.exit(1)

    assembled = template.replace(marker, f"const STARTUP_PATCH = {deck_json_str};", 1)

    # Step 3: determine output path
    if not output_path:
        slug = slugify(deck.get('deckTitle', 'presentation'))
        output_dir = os.environ.get("VELA_OUTPUT_DIR", os.getcwd())
        output_path = os.path.join(output_dir, f"{slug}.jsx")

    if minify:
        assembled = safe_minify(assembled)

    out_dir = os.path.dirname(output_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(output_path, 'w') as f:
        f.write(assembled)

    # Stats
    total_slides = sum(
        len(item.get('slides', []))
        for lane in deck.get('lanes', [])
        for item in lane.get('items', [])
    )
    total_duration = sum(
        slide.get('duration', 0)
        for lane in deck.get('lanes', [])
        for item in lane.get('items', [])
        for slide in item.get('slides', [])
    )

    print(f"✅ Assembled: {output_path}")
    print(f"   Slides: {total_slides} | Duration: {total_duration//60}m {total_duration%60}s | Size: {os.path.getsize(output_path)//1024}KB")
    return output_path


if __name__ == "__main__":
    if '--help' in sys.argv or '-h' in sys.argv or len(sys.argv) < 2:
        print(__doc__.strip())
        sys.exit(0)
    from_parts = '--from-parts' in sys.argv
    minify = '--minify' in sys.argv
    # Parse --output <path> flag
    out_path = None
    filtered = []
    argv = sys.argv[1:]
    i = 0
    while i < len(argv):
        if argv[i] in ('--from-parts', '--minify'):
            i += 1
            continue
        if argv[i] == '--output' and i + 1 < len(argv):
            out_path = argv[i + 1]
            i += 2
            continue
        filtered.append(argv[i])
        i += 1

    if not filtered:
        print("Usage: python3 assemble.py <deck.json> [--from-parts] [--output <path>] [output.jsx]", file=sys.stderr)
        sys.exit(1)

    deck_path = filtered[0]
    # Positional output path as fallback
    if not out_path and len(filtered) > 1:
        out_path = filtered[1]
    assemble(deck_path, out_path, from_parts, minify)
