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

# ── Deck key-drift check ─────────────────────────────────────────────
# Deck ingress (sanitizeSlide/sanitizeBlock in part-imports.jsx) is an
# ALLOWLIST: only keys in SAFE_SLIDE_KEYS / SAFE_BLOCK_KEYS survive. A renderer
# that reads a key missing from those sets therefore reads `undefined` for every
# deck loaded from disk — silently, with no error. This check fails the build on
# that drift. The allowlists are parsed from part-imports.jsx so there is exactly
# one source of truth.
KEY_SOURCE_FILE = "part-imports.jsx"
KEY_CONSUMER_FILES = ["part-blocks.jsx", "part-slides.jsx"]

SET_LITERAL_RE_TPL = r'const\s+{name}\s*=\s*new\s+Set\(\[(.*?)\]\)'
QUOTED_RE = re.compile(r'"([^"]*)"|\'([^\']*)\'')

# `slide.foo` / `block.foo` member reads. `rawBlock` is the pre-guard alias used
# by RenderBlock.
MEMBER_RE = re.compile(r'\b(slide|block|rawBlock)\.([A-Za-z_$][A-Za-z0-9_$]*)')
# `slide["foo"]` / `block['foo']` bracket-notation reads with a STRING-LITERAL
# key — the same drift the dotted form would trip, just written differently.
# (Computed `block[k]` reads can't be resolved statically and are out of scope;
# this catches the literal-key form only.)
BRACKET_RE = re.compile(r'\b(slide|block|rawBlock)\[\s*["\']([A-Za-z_$][A-Za-z0-9_$]*)["\']\s*\]')
# `const { a, b: c } = slide` destructuring.
DESTRUCT_RE = re.compile(r'\{([^{}]*)\}\s*=\s*(slide|block|rawBlock)\b')

# Members that are NOT deck fields: a local named `block` may hold a DOM element
# (the measurement pass in part-slides.jsx walks rendered nodes), and JS/DOM
# built-ins are never deck keys. Keep this list minimal and explicit — anything
# added here is a key the drift check stops protecting.
NON_DECK_MEMBERS = {
    # DOM element members read off a variable named `block`
    "getBoundingClientRect", "dataset", "className", "textContent", "classList",
    "closest", "querySelector", "querySelectorAll", "parentElement", "children",
    "scrollHeight", "offsetHeight", "offsetWidth", "getAttribute", "setAttribute",
    "appendChild", "cloneNode", "remove",
    # JS built-ins / React
    "length", "map", "filter", "forEach", "slice", "find", "some", "every",
    "push", "includes", "join", "toString", "hasOwnProperty", "props", "key",
}


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


def _parse_set_literal(source, name):
    """Extract the string members of a `const <name> = new Set([...])` literal."""
    m = re.search(SET_LITERAL_RE_TPL.format(name=name), source, re.DOTALL)
    if not m:
        return None
    body = m.group(1)
    # Drop comments so a key mentioned in prose isn't picked up as a member.
    body = re.sub(r'//[^\n]*', '', body)
    body = re.sub(r'/\*[\s\S]*?\*/', '', body)
    return {a or b for a, b in QUOTED_RE.findall(body)}


def _destructured_names(inner):
    """Yield the source-side property names of a destructuring pattern body."""
    for part in inner.split(","):
        part = part.strip()
        if not part or part.startswith("..."):
            continue
        # `foo: bar` renames -> the deck key is `foo`; `foo = 1` defaults -> `foo`
        name = part.split(":")[0].split("=")[0].strip()
        if re.fullmatch(r'[A-Za-z_$][A-Za-z0-9_$]*', name or ""):
            yield name


def check_deck_key_drift(parts_dir):
    """Every slide.<key>/block.<key> read must be allowlisted at deck ingress."""
    errors = []
    src_path = os.path.join(parts_dir, KEY_SOURCE_FILE)
    if not os.path.exists(src_path):
        return [f"Key-drift check: {KEY_SOURCE_FILE} not found in {parts_dir}"]

    with open(src_path, 'r', encoding="utf-8") as f:
        allow_src = f.read()

    allow = {}
    for kind, set_name in (("slide", "SAFE_SLIDE_KEYS"), ("block", "SAFE_BLOCK_KEYS")):
        keys = _parse_set_literal(allow_src, set_name)
        if not keys:
            return [f"Key-drift check: could not parse {set_name} from {KEY_SOURCE_FILE}"]
        allow[kind] = keys
    # `rawBlock` is RenderBlock's alias for the same object.
    allow["rawBlock"] = allow["block"]

    for fname in KEY_CONSUMER_FILES:
        fpath = os.path.join(parts_dir, fname)
        if not os.path.exists(fpath):
            continue
        with open(fpath, 'r', encoding="utf-8") as f:
            src = f.read()

        seen = set()
        hits = [(kind, key) for kind, key in MEMBER_RE.findall(src)]
        hits += [(kind, key) for kind, key in BRACKET_RE.findall(src)]
        for m in DESTRUCT_RE.finditer(src):
            hits += [(m.group(2), name) for name in _destructured_names(m.group(1))]

        for kind, key in hits:
            # `_`-prefixed keys are the reserved renderer-private namespace:
            # set by our own code after sanitization, never from deck input.
            if key.startswith("_") or key in NON_DECK_MEMBERS:
                continue
            if key in allow[kind]:
                continue
            label = "block" if kind == "rawBlock" else kind
            sig = (fname, label, key)
            if sig in seen:
                continue
            seen.add(sig)
            errors.append(
                f"Deck key drift in {fname}: reads {label}.{key}, which is not in "
                f"SAFE_{label.upper()}_KEYS ({KEY_SOURCE_FILE}) — deck ingress would "
                f"strip it, so this always reads undefined for a loaded deck"
            )
    return errors


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
    errors += check_deck_key_drift(parts_dir)

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
