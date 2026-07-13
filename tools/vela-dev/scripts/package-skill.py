#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""
package-skill — build a clean skills/vela-slides ZIP for Claude.ai upload.

DEV/RELEASE TOOL — not part of the shipped skill. This packages the skill
tree itself for distribution/re-upload; it is not a deck-authoring capability,
so it lives in the dev toolchain rather than the shipped `vela` CLI.

Usage:
  python3 tools/vela-dev/scripts/package-skill.py [--output <path>]

The release pipeline builds its own archive with `zip -r`; this script is a
local convenience for producing the same upload ZIP by hand.

Security: the archive builder skips symlinks and refuses any member whose
canonical (realpath) source escapes the skill root, so a stray or planted
link inside the tree cannot pull outside-of-root bytes into the archive under
an in-root member name.
"""
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.realpath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
SKILL_DIR = os.path.join(REPO_ROOT, "skills", "vela-slides")

EXCLUDE_DIRS = {"node_modules", "__pycache__", ".git", ".idea", ".vscode", ".claude"}
EXCLUDE_EXTS = {".pyc", ".pyo"}


def _extract_output_flag(argv):
    """Extract --output <path> from argv. Returns the path or None."""
    i = 0
    while i < len(argv):
        if argv[i] == "--output" and i + 1 < len(argv):
            return argv[i + 1]
        i += 1
    return None


def build_zip(skill_dir, output_path):
    """Zip skill_dir into output_path. Returns (files_written, links_skipped).

    Symlinks (file and directory) are refused and any member whose canonical
    realpath escapes skill_dir is skipped — zipfile.write() would otherwise
    copy the link *target's* bytes under an in-root member name.
    """
    root_real = os.path.realpath(skill_dir)
    parent = os.path.dirname(os.path.normpath(skill_dir))
    count = 0
    skipped = 0
    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(skill_dir):
            # Prune excluded dirs and directory symlinks. os.walk already will
            # not descend links (followlinks=False), but we also never list one.
            pruned = []
            for d in dirs:
                if d in EXCLUDE_DIRS:
                    continue
                if os.path.islink(os.path.join(root, d)):
                    skipped += 1
                    continue
                pruned.append(d)
            dirs[:] = pruned
            for fname in files:
                if any(fname.endswith(ext) for ext in EXCLUDE_EXTS):
                    continue
                full_path = os.path.join(root, fname)
                # Refuse file symlinks outright.
                if os.path.islink(full_path):
                    skipped += 1
                    continue
                # Belt-and-braces: the canonical source must stay under root
                # (guards intermediate-component links too).
                real = os.path.realpath(full_path)
                if os.path.commonpath([root_real, real]) != root_real:
                    skipped += 1
                    continue
                rel_path = os.path.relpath(full_path, parent)
                zf.write(full_path, rel_path)
                count += 1
    return count, skipped


def main():
    argv = sys.argv[1:]
    output_path = _extract_output_flag(argv) or os.path.join(os.getcwd(), "vela-slides.zip")

    if not os.path.isdir(SKILL_DIR):
        print(f"❌ Skill directory not found: {SKILL_DIR}", file=sys.stderr)
        sys.exit(1)

    count, skipped = build_zip(SKILL_DIR, output_path)
    size_kb = os.path.getsize(output_path) / 1024
    print(f"✅ ZIP created: {output_path}")
    print(f"   {count} files | {size_kb:.0f} KB")
    if skipped:
        print(f"   ⚠ skipped {skipped} symlink(s) / out-of-root path(s)")
    print("   Upload to: Claude.ai → Customize → Skills → + → Upload")


if __name__ == "__main__":
    main()
