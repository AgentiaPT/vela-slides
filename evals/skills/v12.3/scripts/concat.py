#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""
Vela Concat — Builds monolith from parts.

Two modes:
  1. From skill parts:  python3 concat.py
     Reads from /mnt/skills/user/vela-slides/app/parts/
     Outputs to /mnt/skills/user/vela-slides/app/vela.jsx

  2. From working dir:   python3 concat.py /path/to/parts/ [output.jsx]
     Reads from specified directory
     Outputs to specified file or ./vela-built.jsx

Concatenation order is fixed (matches dependency graph):
  imports → icons → blocks → reducer → engine → slides → list → chat → test → uitest → demo → pdf → app
"""

import sys, os

PART_ORDER = [
    "part-imports.jsx",
    "part-icons.jsx",
    "part-blocks.jsx",
    "part-reducer.jsx",
    "part-engine.jsx",
    "part-slides.jsx",
    "part-list.jsx",
    "part-chat.jsx",
    "part-test.jsx",
    "part-uitest.jsx",
    "part-demo.jsx",
    "part-pdf.jsx",
    "part-app.jsx",
]

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL_PARTS = os.path.join(SKILL_DIR, "app", "parts")
SKILL_TEMPLATE = os.path.join(SKILL_DIR, "app", "vela.jsx")

def concat(parts_dir, output_path):
    chunks = []
    total_lines = 0

    for part_name in PART_ORDER:
        part_path = os.path.join(parts_dir, part_name)
        if not os.path.exists(part_path):
            print(f"ERROR: Missing part: {part_path}", file=sys.stderr)
            sys.exit(1)
        with open(part_path, 'r') as f:
            content = f.read()
        lines = content.count('\n') + (0 if content.endswith('\n') else 1)
        total_lines += lines
        chunks.append(content)
        print(f"  {part_name}: {lines} lines")

    result = ''.join(chunks)

    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)
    with open(output_path, 'w') as f:
        f.write(result)

    size_kb = os.path.getsize(output_path) // 1024
    print(f"\n✅ Built: {output_path}")
    print(f"   {total_lines} lines | {size_kb}KB | {len(PART_ORDER)} parts")

    # Verify STARTUP_PATCH marker exists
    if "const STARTUP_PATCH = null;" in result:
        print("   STARTUP_PATCH marker: present ✓")
    else:
        print("   ⚠️  STARTUP_PATCH marker NOT found — deck injection will fail!")

    # Check for duplicate top-level const/function declarations
    import re as _re
    decl_pattern = _re.compile(r'^(?:const|let|function)\s+([A-Za-z_$][A-Za-z0-9_$]*)', _re.MULTILINE)
    decls = decl_pattern.findall(result)
    seen = {}
    dupes = []
    for name in decls:
        if name in seen:
            if name not in [d[0] for d in dupes]:
                dupes.append((name, seen[name], decls.count(name)))
        else:
            seen[name] = name
    if dupes:
        print(f"   ❌ DUPLICATE DECLARATIONS ({len(dupes)}):")
        for name, _, count in dupes:
            print(f"      {name} — declared {count}x")
        sys.exit(1)
    else:
        print("   No duplicate declarations ✓")

    return output_path


if __name__ == "__main__":
    if len(sys.argv) == 1:
        # Default: build from skill parts → update skill template
        print("Building from skill parts...")
        concat(SKILL_PARTS, SKILL_TEMPLATE)
    elif len(sys.argv) >= 2:
        parts_dir = sys.argv[1]
        output = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.getcwd(), "vela-built.jsx")
        print(f"Building from {parts_dir}...")
        concat(parts_dir, output)
    else:
        print("Usage: python3 concat.py [parts_dir] [output.jsx]", file=sys.stderr)
        sys.exit(1)
