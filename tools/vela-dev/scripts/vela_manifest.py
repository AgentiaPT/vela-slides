#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""
vela_manifest — the ONE parser for src/parts/MANIFEST.txt.

The manifest is the single source of truth for the part-file list and its
fixed concatenation order. It lives IN the parts directory so every consumer
(concat.py, lint.py, tests) reads the order that belongs to the parts it is
actually processing. Format: one filename per line; `#` starts a comment
(whole-line or trailing). Stdlib only — this module must stay import-light so
the dev scripts keep their zero-dependency contract.
"""

import os
import sys

MANIFEST_NAME = "MANIFEST.txt"


def load_manifest(parts_dir):
    """Return the ordered part-file list from <parts_dir>/MANIFEST.txt.

    Fails closed: a missing manifest, an empty manifest, a malformed entry, or
    a duplicate entry is a hard error (exit 1) — silently building from a
    partial list is exactly the drift bug (part-pptx.jsx once missing from two
    of the three hardcoded copies) this file exists to prevent.
    """
    path = os.path.join(parts_dir, MANIFEST_NAME)
    if not os.path.isfile(path):
        print(f"ERROR: manifest not found: {path}", file=sys.stderr)
        sys.exit(1)
    parts = []
    with open(path, "r", encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            entry = line.split("#", 1)[0].strip()
            if not entry:
                continue
            if len(entry.split()) != 1 or not (entry.startswith("part-") and entry.endswith(".jsx")):
                print(f"ERROR: malformed manifest entry at {path}:{lineno}: {entry!r} "
                      "(expected a single part-*.jsx filename)", file=sys.stderr)
                sys.exit(1)
            if entry in parts:
                print(f"ERROR: duplicate manifest entry at {path}:{lineno}: {entry}", file=sys.stderr)
                sys.exit(1)
            parts.append(entry)
    if not parts:
        print(f"ERROR: manifest is empty: {path}", file=sys.stderr)
        sys.exit(1)
    return parts
