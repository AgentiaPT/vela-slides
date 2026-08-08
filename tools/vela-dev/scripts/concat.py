#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""
Vela Concat — Builds monolith from parts.

Two modes:
  1. Default (no args):  python3 concat.py
     Reads app source part-files from src/parts/
     Outputs monolith to skills/vela-slides/app/vela.jsx

  2. From working dir:   python3 concat.py /path/to/parts/ [output.jsx]
     Reads from specified directory
     Outputs to specified file or ./vela-built.jsx

Concatenation order is fixed (matches dependency graph):
  imports → icons → blocks → reducer → engine → slides → list → chat → test → uitest → demo → pdf → pptx → app

RELEASE builds (--release):
  Dev-only code (the window test-hook object and the UI battery's binding to it)
  is fenced between `// VELA:DEV-ONLY:BEGIN` / `// VELA:DEV-ONLY:END` markers.
  `--release` drops every fenced block at build time, so the resulting bundle
  contains no test-hook surface at all — the pipeline-side half of ASVS
  V14.1.3 / V14.2.2 (the runtime gates in part-app.jsx are the other half).
  A release build MUST be written somewhere other than the committed template:

      python3 concat.py --release --out /tmp/vela-release.jsx

  The COMMITTED skills/vela-slides/app/vela.jsx stays a DEV build on purpose —
  the in-bundle UI battery and the offline render harness (render-offline.js →
  vela-drive.js uitests, which CI runs) both build from it and need the hooks,
  which are inert unless the runtime gate opts in. Release CI asserts the
  stripped build is clean (tests/test_release_build.cjs).
"""

import sys, os, tempfile

# Fence markers for build-time-strippable dev-only code. Both must appear on
# their own line (leading whitespace allowed); blocks must not nest.
DEV_ONLY_BEGIN = "// VELA:DEV-ONLY:BEGIN"
DEV_ONLY_END = "// VELA:DEV-ONLY:END"
DEV_ONLY_STUB = "// [release build] dev-only block stripped by concat.py --release"


def strip_dev_only(content, part_name, release):
    """Validate DEV-ONLY fences; drop the fenced blocks when release=True.

    Returns (content, blocks_stripped). Validation runs in BOTH modes so an
    unbalanced/nested marker is caught by the normal dev build too, long before
    a release build would silently ship (or silently mangle) the region.
    """
    out, depth, stripped, opened_at = [], 0, 0, 0
    for lineno, line in enumerate(content.split("\n"), 1):
        stripped_line = line.strip()
        if stripped_line.startswith(DEV_ONLY_BEGIN):
            if depth:
                print(f"ERROR: nested {DEV_ONLY_BEGIN} in {part_name}:{lineno} "
                      f"(opened at line {opened_at})", file=sys.stderr)
                sys.exit(1)
            depth, opened_at = 1, lineno
            if release:
                indent = line[:len(line) - len(line.lstrip())]
                out.append(indent + DEV_ONLY_STUB)
                stripped += 1
            else:
                out.append(line)
            continue
        if stripped_line.startswith(DEV_ONLY_END):
            if not depth:
                print(f"ERROR: unmatched {DEV_ONLY_END} in {part_name}:{lineno}", file=sys.stderr)
                sys.exit(1)
            depth = 0
            if not release:
                out.append(line)
            continue
        if depth and release:
            continue
        out.append(line)
    if depth:
        print(f"ERROR: unclosed {DEV_ONLY_BEGIN} in {part_name}:{opened_at}", file=sys.stderr)
        sys.exit(1)
    return "\n".join(out), stripped

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
    "part-pptx.jsx",
    "part-app.jsx",
]

# concat.py (dev tooling) lives at tools/vela-dev/scripts/, reads the app source
# part-files from src/parts/, and writes the built monolith into the lean shipped
# skill dir (skills/vela-slides/app/vela.jsx).
DEV_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # tools/vela-dev
REPO_ROOT = os.path.dirname(os.path.dirname(DEV_DIR))                  # repo root
SKILL_PARTS = os.path.join(REPO_ROOT, "src", "parts")
SKILL_TEMPLATE = os.path.join(REPO_ROOT, "skills", "vela-slides", "app", "vela.jsx")

def concat(parts_dir, output_path, release=False):
    chunks = []
    total_lines = 0
    total_stripped = 0

    for part_name in PART_ORDER:
        part_path = os.path.join(parts_dir, part_name)
        if not os.path.exists(part_path):
            print(f"ERROR: Missing part: {part_path}", file=sys.stderr)
            sys.exit(1)
        with open(part_path, 'r', encoding="utf-8") as f:
            content = f.read()
        content, stripped = strip_dev_only(content, part_name, release)
        total_stripped += stripped
        lines = content.count('\n') + (0 if content.endswith('\n') else 1)
        total_lines += lines
        chunks.append(content)
        print(f"  {part_name}: {lines} lines" + (f" (−{stripped} dev-only block(s))" if stripped else ""))

    result = ''.join(chunks)

    # Atomic write: build into a temp file in the same directory, then
    # os.replace() into place. os.replace is atomic on POSIX, so a concurrent
    # reader (e.g. a test rendering vela.jsx while another stack regenerates it
    # in a parallel CI run) always sees a complete old-or-new file, never a
    # half-written one. A plain open('w') truncates then streams ~1MB and would
    # expose that partial state to readers.
    out_dir = os.path.dirname(output_path) or '.'
    os.makedirs(out_dir, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=out_dir, prefix='.concat-', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding="utf-8") as f:
            f.write(result)
        # mkstemp creates the temp file 0600; restore the umask-respecting mode a
        # plain open('w') would have produced so the committed monolith keeps its
        # normal readable permissions after os.replace().
        umask = os.umask(0); os.umask(umask)
        os.chmod(tmp_path, 0o666 & ~umask)
        os.replace(tmp_path, output_path)
    except BaseException:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise

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

    if release:
        # Fail the build (never silently ship) if any test-hook surface survived
        # the strip — e.g. a new call site added outside the DEV-ONLY fences.
        leaks = [i + 1 for i, ln in enumerate(result.split("\n")) if "__velaTest" in ln]
        if leaks:
            print(f"   ❌ RELEASE BUILD LEAK: '__velaTest' still present on "
                  f"{len(leaks)} line(s), first at {leaks[0]}", file=sys.stderr)
            sys.exit(1)
        print(f"   Release strip: {total_stripped} dev-only block(s) removed, no test hooks ✓")

    return output_path


USAGE = ("Usage: python3 concat.py [parts_dir] [output.jsx]\n"
         "       python3 concat.py --release --out <output.jsx> [parts_dir]")


if __name__ == "__main__":
    argv = sys.argv[1:]
    release = False
    if "--release" in argv:
        release = True
        argv.remove("--release")
    out_flag = None
    if "--out" in argv:
        i = argv.index("--out")
        if i + 1 >= len(argv):
            print("ERROR: --out needs a path\n" + USAGE, file=sys.stderr)
            sys.exit(2)
        out_flag = argv[i + 1]
        del argv[i:i + 2]

    if release and not out_flag and len(argv) < 2:
        # Guard rail: the committed template is the DEV build. A release build
        # must be written elsewhere so it can never clobber it by accident.
        print("ERROR: --release requires an explicit output path "
              "(--out <file>), so it never overwrites the committed dev template.\n" + USAGE,
              file=sys.stderr)
        sys.exit(2)

    parts_dir = argv[0] if argv else SKILL_PARTS
    if out_flag:
        output = out_flag
    elif len(argv) > 1:
        output = argv[1]
    elif argv:
        output = os.path.join(os.getcwd(), "vela-built.jsx")
    else:
        output = SKILL_TEMPLATE

    print(("Building RELEASE from " if release else "Building from ")
          + ("skill parts..." if parts_dir == SKILL_PARTS else f"{parts_dir}..."))
    concat(parts_dir, output, release=release)
