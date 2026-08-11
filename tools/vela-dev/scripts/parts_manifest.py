#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""
Vela part-file manifest reader — the ONE parser for src/parts/MANIFEST.txt.

The manifest is both the build order (concat.py) and the routing table a reader
uses to find code. Every tool that needs the part list reads it through here:
concat.py, lint.py, partsize.py and tests/test_vela.py. Nobody keeps a second
copy — a hardcoded list is exactly how part-pptx.jsx once fell out of the
lint/test coverage while still being built into the bundle.

Format: one `part-<name>.jsx  # purpose` per line, in concat order. Blank lines
and `#` lines are ignored; text after `#` on a part line is the purpose comment.
"""

import os

MANIFEST_NAME = "MANIFEST.txt"

# tools/vela-dev/scripts/ → tools/vela-dev → tools → repo root
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__)))))
CANONICAL_PARTS_DIR = os.path.join(_REPO_ROOT, "src", "parts")


def manifest_path(parts_dir=None):
    """Resolve the manifest for `parts_dir`.

    A throwaway parts directory (the lint/drift tests copy only `*.jsx` into a
    temp dir) has no manifest of its own, so fall back to the canonical
    src/parts/MANIFEST.txt rather than failing: the manifest describes this
    repo's source tree, not whichever directory a caller points at.
    """
    if parts_dir:
        candidate = os.path.join(parts_dir, MANIFEST_NAME)
        if os.path.isfile(candidate):
            return candidate
    return os.path.join(CANONICAL_PARTS_DIR, MANIFEST_NAME)


def parse_manifest(text):
    """Parse manifest text → list of (part_filename, purpose)."""
    entries = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        name, _, purpose = line.partition("#")
        name = name.strip()
        if name:
            entries.append((name, purpose.strip()))
    return entries


def load_manifest(parts_dir=None):
    """Read the manifest → list of (part_filename, purpose), in concat order."""
    path = manifest_path(parts_dir)
    with open(path, "r", encoding="utf-8") as f:
        entries = parse_manifest(f.read())
    if not entries:
        raise ValueError(f"{path} lists no part-files")
    return entries


def load_part_order(parts_dir=None):
    """Read the manifest → list of part filenames, in concat order."""
    return [name for name, _ in load_manifest(parts_dir)]


if __name__ == "__main__":
    for _name, _purpose in load_manifest():
        print(f"{_name:20} {_purpose}")
