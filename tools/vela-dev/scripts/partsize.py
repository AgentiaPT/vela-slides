#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""
partsize — per-section size report for Vela part-files.

Splits a part-file on its banner comment lines (lines starting with `// ━` or
`// ─`) and prints line count, byte count, and a token estimate (chars/2.35)
per section — the raw data for deciding where to split an oversized part.

Usage:
  python3 partsize.py                       # all parts from src/parts/MANIFEST.txt
  python3 partsize.py src/parts/part-pdf.jsx [more.jsx ...]   # specific file(s)

Stdlib only. Dev tooling — never shipped.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vela_manifest import load_manifest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__)))))
PARTS_DIR = os.path.join(REPO_ROOT, "src", "parts")

TOKEN_CHARS = 2.35  # empirical chars-per-token estimate for this codebase


def section_name(line):
    """Human label for a banner line: strip `//` and box-drawing chars."""
    name = line.lstrip("/").strip().strip("━─").strip()
    return name or "(unnamed banner)"


def report(path):
    with open(path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    sections = []  # (name, line_count, byte_count)
    cur_name, cur_lines, cur_bytes = "(preamble)", 0, 0
    for line in lines:
        stripped = line.lstrip()
        if stripped.startswith("// ━") or stripped.startswith("// ─"):
            if cur_lines:
                sections.append((cur_name, cur_lines, cur_bytes))
            cur_name, cur_lines, cur_bytes = section_name(stripped), 0, 0
        cur_lines += 1
        cur_bytes += len(line.encode("utf-8"))
    if cur_lines:
        sections.append((cur_name, cur_lines, cur_bytes))

    total_lines = len(lines)
    total_bytes = sum(b for _, _, b in sections)
    print(f"\n{os.path.basename(path)} — {total_lines} lines, {total_bytes} bytes, "
          f"~{int(total_bytes / TOKEN_CHARS)} tokens")
    print(f"  {'lines':>6}  {'bytes':>8}  {'~tokens':>8}  section")
    for name, n_lines, n_bytes in sections:
        print(f"  {n_lines:>6}  {n_bytes:>8}  {int(n_bytes / TOKEN_CHARS):>8}  {name[:80]}")


if __name__ == "__main__":
    targets = sys.argv[1:]
    if not targets:
        targets = [os.path.join(PARTS_DIR, p) for p in load_manifest(PARTS_DIR)]
    bad = [t for t in targets if not os.path.isfile(t)]
    if bad:
        print(f"ERROR: file(s) not found: {bad}", file=sys.stderr)
        sys.exit(1)
    for t in targets:
        report(t)
