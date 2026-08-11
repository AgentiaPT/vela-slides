#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""
Vela Part Size — per-section size accounting for the app source part-files.

Prints, for every part-file (or one named on the command line), each banner
section with its start line, title, line count, byte count and token estimate,
plus a per-file summary. The point is to derive split cut-points from the code
itself instead of transcribing line numbers by hand — the numbers are always
current, so a plan built on them can't drift from the tree.

Sections are the existing banner comments:
  `// ━━━ Title ━━━`  → level 1 (top-level section)
  `// ── Title ──`     → level 2 (sub-section, may be indented)

A level-1 row spans to the next level-1 banner (so level-1 rows + the file
header sum to the whole file). Level-2 rows are nested inside and span to the
next banner of any level. Lines before the first banner are reported as
`(file header)`.

Usage:
  python3 tools/vela-dev/scripts/partsize.py                 # every part-file
  python3 tools/vela-dev/scripts/partsize.py part-slides.jsx # one part-file
  python3 tools/vela-dev/scripts/partsize.py path/to/file.jsx
  python3 tools/vela-dev/scripts/partsize.py --totals-only   # summary table only
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parts_manifest import load_part_order, CANONICAL_PARTS_DIR  # noqa: E402

# Empirical chars-per-token for this codebase's JSX. Keep it in one place: every
# size budget in the refactor plan is quoted in these tokens.
CHARS_PER_TOKEN = 2.35

BANNER_RE = re.compile(r'^\s*//\s*(━{2,}|─{2,})\s*(.*?)\s*$')


def _title(raw):
    """Strip the trailing rule characters from a banner title."""
    return raw.strip("━─ ").strip() or "(untitled)"


def find_sections(lines):
    """→ list of dicts: {line, level, title} in file order."""
    out = []
    for i, line in enumerate(lines, 1):
        m = BANNER_RE.match(line)
        if not m:
            continue
        out.append({"line": i, "level": 1 if m.group(1)[0] == "━" else 2,
                    "title": _title(m.group(2))})
    return out


def measure(lines, start, end):
    """Size of lines[start-1 : end-1] (1-based, end exclusive)."""
    chunk = lines[start - 1:end - 1]
    chars = sum(len(x) for x in chunk)
    return len(chunk), chars


def analyze(path):
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    lines = text.splitlines(keepends=True)
    total = len(lines)
    sections = find_sections(lines)

    rows = []
    if not sections or sections[0]["line"] > 1:
        first = sections[0]["line"] if sections else total + 1
        if first > 1:
            n, c = measure(lines, 1, first)
            rows.append({"line": 1, "level": 1, "title": "(file header)",
                         "lines": n, "chars": c})

    for idx, sec in enumerate(sections):
        if sec["level"] == 1:
            nxt = next((s["line"] for s in sections[idx + 1:] if s["level"] == 1),
                       total + 1)
        else:
            nxt = sections[idx + 1]["line"] if idx + 1 < len(sections) else total + 1
        n, c = measure(lines, sec["line"], nxt)
        rows.append({"line": sec["line"], "level": sec["level"],
                     "title": sec["title"], "lines": n, "chars": c})

    return {"path": path, "name": os.path.basename(path), "total_lines": total,
            "total_chars": len(text), "rows": rows,
            "sections": sum(1 for s in sections if s["level"] == 1)}


def tokens(chars):
    return int(round(chars / CHARS_PER_TOKEN))


def print_file(rep):
    print(f"\n━━━ {rep['name']} — {rep['total_lines']} lines, "
          f"{rep['total_chars']:,} bytes, ~{tokens(rep['total_chars']):,} tokens "
          f"({rep['sections']} top-level sections)")
    print(f"  {'line':>6}  {'lines':>6}  {'bytes':>8}  {'tokens':>7}  section")
    for r in rep["rows"]:
        indent = "    " if r["level"] == 2 else "  "
        title = ("· " if r["level"] == 2 else "") + r["title"]
        print(f"  {r['line']:>6}  {r['lines']:>6}  {r['chars']:>8,}  "
              f"{tokens(r['chars']):>7,}  {indent}{title}")


def resolve(arg):
    if os.path.isfile(arg):
        return arg
    candidate = os.path.join(CANONICAL_PARTS_DIR, arg)
    if os.path.isfile(candidate):
        return candidate
    candidate += ".jsx"
    if os.path.isfile(candidate):
        return candidate
    print(f"ERROR: no such part-file: {arg}", file=sys.stderr)
    sys.exit(2)


def main(argv):
    totals_only = "--totals-only" in argv
    argv = [a for a in argv if a != "--totals-only"]

    if argv:
        paths = [resolve(a) for a in argv]
    else:
        paths = [os.path.join(CANONICAL_PARTS_DIR, p) for p in load_part_order()]

    reports = [analyze(p) for p in paths]
    if not totals_only:
        for rep in reports:
            print_file(rep)

    print(f"\n━━━ Summary ({len(reports)} part-file(s), "
          f"~{CHARS_PER_TOKEN} chars/token)")
    print(f"  {'lines':>6}  {'bytes':>9}  {'tokens':>8}  {'sect':>4}  part")
    for rep in sorted(reports, key=lambda r: -r["total_lines"]):
        print(f"  {rep['total_lines']:>6}  {rep['total_chars']:>9,}  "
              f"{tokens(rep['total_chars']):>8,}  {rep['sections']:>4}  {rep['name']}")
    tl = sum(r["total_lines"] for r in reports)
    tc = sum(r["total_chars"] for r in reports)
    print(f"  {tl:>6}  {tc:>9,}  {tokens(tc):>8,}  {'':>4}  TOTAL")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
