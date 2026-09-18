#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""
Vela Deck Assembler
Injects deck JSON into Vela template → ready-to-use .jsx artifact.

Usage:
  python3 assemble.py <deck.vela> [output.jsx]
  python3 assemble.py <deck.vela> --output <output.jsx>

Injects the deck into the prebuilt skills/vela-slides/app/vela.jsx monolith.
(Rebuilding vela.jsx from parts is a dev/CI concern — see tools/vela-dev/scripts/concat.py.)
"""

import sys, json, os, re

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE = os.path.join(SKILL_DIR, "app", "vela.jsx")

def escape_for_script_context(json_str):
    """Make a JSON string safe to embed inline in an HTML <script> block.

    The assembled .jsx is loaded inside <script type="text/babel"> (both
    app/local.html and the Claude.ai artifact viewer wrap it that way), so
    the HTML tokenizer sees the JSON before the JS parser does. We escape
    the full set of chars that can either break out of the script element
    or terminate a JS string literal:

      <            HTML parser closes <script> on </script (and historically
                   on <!-- / <script>); escape to \\u003c.
      >            symmetric; escape to \\u003e for defense in depth.
      &            matches the Django/Flask/Rails json_script escape set;
                   harmless inside <script> but cheap and consistent.
      U+2028/2029  terminate JS string literals on pre-ES2019 engines and
                   on some Babel-standalone code paths.

    All five remain valid JSON (\\uXXXX is legal inside JSON strings, and
    these characters never appear in JSON structural positions). Keep this
    in sync with serve.py:escape_for_script_context().
    """
    return (
        json_str
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


def safe_minify(template_text):
    """JSX-safe minification: strip comments, blanks, changelog. Never breaks ASI.

    SECURITY CONTRACT — call this on the RAW TEMPLATE ONLY, never on assembled
    output. Every transform here rewrites trusted application source. Once deck
    JSON has been injected the buffer holds untrusted bytes, and a pattern run
    over that mixed buffer can be re-anchored by deck-chosen content, letting
    deck data delete or rewrite trusted source. assemble() enforces the ordering;
    verify_injection_integrity() is the fail-closed backstop if it ever regresses.
    """
    # Phase 1: nuke multi-line const blocks (VELA_CHANGELOG) in one regex pass.
    # Anchored to start-of-line (MULTILINE): the declaration always sits at
    # column 0 in the template, while injected deck JSON is always mid-line and
    # can carry no real newline (json.dumps escapes them). The anchor is defence
    # in depth — it denies the marker-forgery primitive even if the ordering
    # guarantee above is ever broken.
    text = re.sub(
        r'^const VELA_CHANGELOG = \[.*?\];',
        'const VELA_CHANGELOG = [];',
        template_text,
        flags=re.DOTALL | re.MULTILINE
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


MARKER = "const STARTUP_PATCH = null;"


def verify_injection_integrity(assembled, template, injected):
    """Fail-closed gate: the deck may occupy the marker slot and nothing else.

    Recomputes the only legal output from the trusted template and the single
    injected value, and compares it to the bytes we are about to write. Any step
    that runs after injection and rewrites trusted source — a minifier, a
    patcher, a future post-processing pass whose pattern a hostile deck can
    re-anchor — fails this check instead of shipping a silently corrupted
    artifact. Invariant: attacker bytes never change template bytes.
    """
    return assembled == template.replace(MARKER, injected, 1)


def slugify(text):
    s = re.sub(r'[^\w\s-]', '', text.lower().strip())
    s = re.sub(r'[\s_]+', '-', s)
    return s[:60] or "vela-deck"

def assemble(deck_json_path, output_path=None, minify=False):
    # Step 1: read deck JSON
    with open(deck_json_path, 'r', encoding="utf-8") as f:
        deck = json.load(f)

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
    deck_json_str = escape_for_script_context(deck_json_str)

    # Step 2: read template
    with open(TEMPLATE, 'r', encoding="utf-8") as f:
        template = f.read()

    # Step 2b: transform the TEMPLATE, then inject. Order is a security control,
    # not a style choice — see safe_minify()'s contract. Injection must be the
    # last operation that touches the output buffer.
    if minify:
        template = safe_minify(template)

    if MARKER not in template:
        print(f"ERROR: Marker not found in template. Was the app modified incorrectly?", file=sys.stderr)
        sys.exit(1)

    injected = f"const STARTUP_PATCH = {deck_json_str};"
    assembled = template.replace(MARKER, injected, 1)

    # Step 3: determine output path
    if not output_path:
        slug = slugify(deck.get('deckTitle', 'presentation'))
        output_dir = os.environ.get("VELA_OUTPUT_DIR", os.getcwd())
        output_path = os.path.join(output_dir, f"{slug}.jsx")

    # Fail closed before anything reaches disk.
    if not verify_injection_integrity(assembled, template, injected):
        print("ERROR: assembled output failed the injection-integrity check — refusing to write.",
              file=sys.stderr)
        sys.exit(1)

    out_dir = os.path.dirname(output_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(output_path, 'w', encoding="utf-8") as f:
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
    minify = '--minify' in sys.argv
    # Parse --output <path> flag
    out_path = None
    filtered = []
    argv = sys.argv[1:]
    i = 0
    while i < len(argv):
        if argv[i] == '--minify':
            i += 1
            continue
        if argv[i] == '--output' and i + 1 < len(argv):
            out_path = argv[i + 1]
            i += 2
            continue
        filtered.append(argv[i])
        i += 1

    if not filtered:
        print("Usage: python3 assemble.py <deck.vela> [--output <path>] [output.jsx]", file=sys.stderr)
        sys.exit(1)

    deck_path = filtered[0]
    # Positional output path as fallback
    if not out_path and len(filtered) > 1:
        out_path = filtered[1]
    assemble(deck_path, out_path, minify)
