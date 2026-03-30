#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""
Vela Lint — Static checks for broken references and duplicate declarations.

Usage:
  python3 lint.py <file.jsx>                   # Lint a single JSX file (monolith)
  python3 lint.py --parts <parts_directory>    # Lint all part-files in a directory
"""

import sys, os, re

# ── Constants ────────────────────────────────────────────────────────

PART_ORDER = [
    "part-imports.jsx", "part-icons.jsx", "part-blocks.jsx",
    "part-reducer.jsx", "part-engine.jsx", "part-slides.jsx",
    "part-list.jsx", "part-chat.jsx", "part-test.jsx",
    "part-uitest.jsx", "part-demo.jsx", "part-pdf.jsx", "part-app.jsx",
]

COPYRIGHT_HEADER = "© 2025-present Rui Quintino"

# Top-level declaration pattern (const/let/function at column 0)
DECL_RE = re.compile(r'^(?:const|let|function)\s+([A-Za-z_$][A-Za-z0-9_$]*)', re.MULTILINE)

# console.log (should only appear guarded by __DEBUG)
CONSOLE_LOG_RE = re.compile(r'(?<!dbg\()console\.log\(')

# Unresolved merge conflict markers
CONFLICT_RE = re.compile(r'^[<>=]{7}', re.MULTILINE)


# ── Checks ───────────────────────────────────────────────────────────

def check_duplicates(source, label="file"):
    """Check for duplicate top-level const/let/function declarations."""
    errors = []
    decls = DECL_RE.findall(source)
    seen = {}
    for name in decls:
        if name in seen:
            seen[name] += 1
        else:
            seen[name] = 1
    for name, count in seen.items():
        if count > 1:
            errors.append(f"Duplicate declaration: '{name}' declared {count}x in {label}")
    return errors


def check_conflict_markers(source, label="file"):
    """Check for unresolved merge conflict markers."""
    errors = []
    if CONFLICT_RE.search(source):
        errors.append(f"Unresolved merge conflict markers in {label}")
    return errors


def check_startup_patch(source, label="file"):
    """Check that the STARTUP_PATCH marker exists (monolith only)."""
    errors = []
    if "const STARTUP_PATCH = null;" not in source:
        errors.append(f"STARTUP_PATCH marker missing in {label} — deck injection will fail")
    return errors


def check_version_constants(source, label="file"):
    """Check that VELA_VERSION and VELA_CHANGELOG exist."""
    errors = []
    if "VELA_VERSION" not in source:
        errors.append(f"VELA_VERSION not found in {label}")
    if "VELA_CHANGELOG" not in source:
        errors.append(f"VELA_CHANGELOG not found in {label}")
    return errors


def check_copyright_header(source, filename):
    """Check that the file starts with a copyright header."""
    errors = []
    first_line = source.split('\n', 1)[0]
    if COPYRIGHT_HEADER not in first_line:
        errors.append(f"Missing copyright header in {filename}")
    return errors


def check_balanced_braces(source, label="file"):
    """Quick check that braces/brackets/parens are roughly balanced."""
    warnings = []
    # Strip strings and comments to avoid false positives
    stripped = re.sub(r'//[^\n]*', '', source)          # line comments
    stripped = re.sub(r'/\*[\s\S]*?\*/', '', stripped)   # block comments
    stripped = re.sub(r'"(?:[^"\\]|\\.)*"', '', stripped) # double-quoted strings
    stripped = re.sub(r"'(?:[^'\\]|\\.)*'", '', stripped) # single-quoted strings
    stripped = re.sub(r'`(?:[^`\\]|\\.)*`', '', stripped) # template literals

    for open_ch, close_ch, name in [('(', ')', 'parentheses'), ('{', '}', 'braces'), ('[', ']', 'brackets')]:
        diff = stripped.count(open_ch) - stripped.count(close_ch)
        if abs(diff) > 2:  # allow small tolerance for template literal expressions
            warnings.append(f"Unbalanced {name} in {label}: {'+' if diff > 0 else ''}{diff}")
    return warnings


# ── Main runners ─────────────────────────────────────────────────────

def lint_monolith(filepath):
    """Lint the assembled monolith template."""
    with open(filepath, 'r', encoding="utf-8") as f:
        source = f.read()

    label = os.path.basename(filepath)
    errors = []
    warnings = []

    errors += check_duplicates(source, label)
    errors += check_conflict_markers(source, label)
    errors += check_startup_patch(source, label)
    errors += check_version_constants(source, label)
    warnings += check_balanced_braces(source, label)

    return errors, warnings


def lint_parts(parts_dir):
    """Lint all part-files in a directory."""
    errors = []
    warnings = []

    # Check all expected parts exist
    for part_name in PART_ORDER:
        part_path = os.path.join(parts_dir, part_name)
        if not os.path.exists(part_path):
            errors.append(f"Missing part file: {part_name}")
            continue

        with open(part_path, 'r', encoding="utf-8") as f:
            source = f.read()

        errors += check_copyright_header(source, part_name)
        errors += check_conflict_markers(source, part_name)
        warnings += check_balanced_braces(source, part_name)

    # Check duplicates across all parts combined
    combined = ""
    for part_name in PART_ORDER:
        part_path = os.path.join(parts_dir, part_name)
        if os.path.exists(part_path):
            with open(part_path, 'r', encoding="utf-8") as f:
                combined += f.read()

    errors += check_duplicates(combined, "combined parts")
    errors += check_startup_patch(combined, "combined parts")
    errors += check_version_constants(combined, "combined parts")

    return errors, warnings


# ── CLI ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 lint.py <file.jsx>", file=sys.stderr)
        print("       python3 lint.py --parts <parts_dir>", file=sys.stderr)
        sys.exit(2)

    if sys.argv[1] == "--parts":
        if len(sys.argv) < 3:
            print("Usage: python3 lint.py --parts <parts_dir>", file=sys.stderr)
            sys.exit(2)
        parts_dir = sys.argv[2]
        if not os.path.isdir(parts_dir):
            print(f"ERROR: Not a directory: {parts_dir}", file=sys.stderr)
            sys.exit(1)
        print(f"Linting parts in {parts_dir}...")
        errors, warnings = lint_parts(parts_dir)
        mode = "parts"
    else:
        filepath = sys.argv[1]
        if not os.path.isfile(filepath):
            print(f"ERROR: File not found: {filepath}", file=sys.stderr)
            sys.exit(1)
        print(f"Linting {filepath}...")
        errors, warnings = lint_monolith(filepath)
        mode = "monolith"

    # Report
    if warnings:
        for w in warnings:
            print(f"  ⚠️  {w}")

    if errors:
        for e in errors:
            print(f"  ❌ {e}")
        print(f"\n❌ Lint failed ({mode}): {len(errors)} error(s), {len(warnings)} warning(s)")
        sys.exit(1)
    else:
        print(f"\n✅ Lint passed ({mode}): 0 errors, {len(warnings)} warning(s)")
