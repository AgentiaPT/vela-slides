#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""
Vela Lint — Static checks for broken references and duplicate declarations.

Usage:
  python3 lint.py <file.jsx>                   # Lint a single JSX file (monolith)
  python3 lint.py --parts <parts_directory>    # Lint all part-files in a directory
"""

import sys, os, re

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vela_manifest import load_manifest, MANIFEST_NAME

# ── Constants ────────────────────────────────────────────────────────

# The part list and its fixed order come from <parts_dir>/MANIFEST.txt —
# the single source of truth parsed by vela_manifest.load_manifest().

# Size guard threshold: parts larger than this get a WARNING (not an error —
# current parts are far larger; a hard fail would break CI today). The goal of
# the refactoring sprint is to shrink parts under this line, then harden it.
PART_SIZE_WARN_LINES = 700

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


# ── CSS fetch-sink encoder-gate check ────────────────────────────────
# A deck-supplied color/paint scalar written into a CSS property that can
# AUTO-LOAD a URL on render (background / background-image / mask / border-image
# / list-style-image / cursor) MUST be routed through the allowlist output
# encoder (cssColor / cssGradient / cssUrl) — never emitted raw. The ingress
# scrubbers gate these fields with a value DENYLIST (STYLE_VALUE_REJECT), which
# is fail-OPEN: any fetching primitive it does not enumerate (an image-set()/
# image()/cross-fade() string source, a protocol-relative //host, a future CSS
# function) rides through and becomes a render-time network beacon. The encoder
# is an ALLOWLIST (accept only a color/gradient token, else empty) — fail-CLOSED
# by construction. This check enforces COMPLETE MEDIATION: it fails the build if
# any such sink in the renderer files receives a raw deck color field, or a local
# variable whose own definition holds one un-encoded. One missed sink is all a
# beacon needs, so the invariant is verified mechanically, not by review.
CSS_FETCH_FILES = ["part-blocks.jsx", "part-slides.jsx"]
FETCH_PROP_RE = re.compile(
    r'\b(background|backgroundImage|maskImage|WebkitMaskImage|borderImage'
    r'|listStyleImage|cursor)\s*:')
ENCODER_RE = re.compile(r'css(?:Color|Gradient|Url)\s*\(')
# A deck object member read: block.x / item?.color / left.color / cell.bg / …
DECK_REF_RE = re.compile(
    r'\b(block|item|cell|left|right|qd|rawBlock|slide)\s*(?:\?\.|\.)\s*'
    r'([A-Za-z_$][A-Za-z0-9_$]*)')
# Field NAMES that carry a CSS color/paint value (mirrors CSS_COLOR_KEY intent):
# only these, reached through a fetching property un-encoded, are the risk. A
# boolean/layout field (block.striped, block.gap) in a condition is not.
COLOR_FIELD_RE = re.compile(
    r'(?:[Cc]olor|Bg|Gradient|Fill|Stroke)$|^(?:bg|color|accent|fill|stroke|background)$')
LOCAL_DEF_RE = re.compile(r'\b(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=')
# A bare VALUE identifier: not a property (`.x`) and not the object of a member
# access (`x.`/`x[`). `st.accent` yields neither `st` (object) nor `accent`
# (property); `${col}` yields `col`. This keeps theme reads (st./T.) out of scope
# while still resolving a local like `trackCol` used as a sink value.
VALUE_IDENT_RE = re.compile(r'(?<![\w$.])([A-Za-z_$][A-Za-z0-9_$]*)(?![\w$]*[.\[])')


def _capture_expr(src, start):
    """Capture an expression starting at `start`, up to the next top-level
    ',' / ';' / newline or an unmatched ')' ']' '}' — respecting (), [], {},
    and template-literal nesting. Bounded so a malformed source can't run away."""
    depth = 0
    i = start
    n = min(len(src), start + 400)
    tick = False
    out = []
    while i < n:
        c = src[i]
        if tick:
            out.append(c)
            if c == '`':
                tick = False
            i += 1
            continue
        if c == '`':
            tick = True; out.append(c); i += 1; continue
        if c in '([{':
            depth += 1; out.append(c); i += 1; continue
        if c in ')]}':
            if depth == 0:
                break
            depth -= 1; out.append(c); i += 1; continue
        if depth == 0 and (c in ',;\n'):
            break
        out.append(c); i += 1
    return ''.join(out)


def _expr_has_direct_deck_color(expr):
    """True if `expr` reads a deck COLOR field directly (block.dotColor, item.color…)."""
    for _obj, field in DECK_REF_RE.findall(expr):
        if COLOR_FIELD_RE.search(field):
            return True
    return False


def _local_defs(src):
    """name -> list of (position, single-line RHS) for each `const/let name = …`.
    Single-line only: the deck-color locals we guard are all one-liners; a
    multi-line object (e.g. the theme `st`) is not a color scalar and must not
    be misread as one. Positions let the sink resolve the NEAREST PRECEDING
    definition — a lexical-scope approximation, so a `labelColor` computed from
    literals in one block case is not confused with a same-named deck-color
    local in another."""
    defs = {}
    for m in LOCAL_DEF_RE.finditer(src):
        eol = src.find('\n', m.end())
        rhs = src[m.end():eol if eol != -1 else len(src)]
        defs.setdefault(m.group(1), []).append((m.start(), rhs))
    return defs


def _nearest_def(defs, name, before):
    """The RHS of the `name` definition closest before `before`, or None."""
    best = None
    for pos, rhs in defs.get(name, ()):
        if pos < before and (best is None or pos > best[0]):
            best = (pos, rhs)
    return best[1] if best else None


def check_css_fetch_sink_gate(parts_dir):
    """Every URL-auto-loading CSS property must route deck colors through the
    cssColor/cssGradient/cssUrl allowlist encoder (fail-closed). Flags a raw
    deck color field in the sink, or a bare local whose one-line definition
    holds an un-encoded deck color."""
    errors = []
    for fname in CSS_FETCH_FILES:
        fpath = os.path.join(parts_dir, fname)
        if not os.path.exists(fpath):
            continue
        with open(fpath, 'r', encoding="utf-8") as f:
            src = f.read()
        defs = _local_defs(src)
        seen = set()
        for m in FETCH_PROP_RE.finditer(src):
            prop = m.group(1)
            value = _capture_expr(src, m.end())
            if ENCODER_RE.search(value):
                continue
            bad = _expr_has_direct_deck_color(value)
            if not bad:
                for ident in VALUE_IDENT_RE.findall(value):
                    rhs = _nearest_def(defs, ident, m.start())
                    if rhs and not ENCODER_RE.search(rhs) and _expr_has_direct_deck_color(rhs):
                        bad = True
                        break
            if not bad:
                continue
            line = src.count('\n', 0, m.start()) + 1
            sig = (fname, prop, line)
            if sig in seen:
                continue
            seen.add(sig)
            errors.append(
                f"CSS fetch-sink not encoder-gated in {fname}:{line}: `{prop}` "
                f"receives a raw deck color — route it through cssColor()/"
                f"cssGradient() (the fail-closed allowlist). A raw value can "
                f"auto-load a URL on render (CSS beacon)."
            )
    return errors


def _strip_js_comments(src):
    """Remove // and /* */ comments while preserving string/template literals
    verbatim (so a `//` inside "http://…" or a `]` inside a comment can't distort
    later bracket-matching). Not a full JS parser — good enough for the allowlist
    region, and it treats string bodies as opaque."""
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c in "\"'`":
            q = c
            out.append(c)
            i += 1
            while i < n:
                out.append(src[i])
                if src[i] == "\\" and i + 1 < n:
                    out.append(src[i + 1]); i += 2; continue
                if src[i] == q:
                    i += 1; break
                i += 1
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            while i < n and src[i] != "\n":
                i += 1
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            i += 2
            while i + 1 < n and not (src[i] == "*" and src[i + 1] == "/"):
                i += 1
            i += 2
            continue
        out.append(c); i += 1
    return "".join(out)


def check_svg_style_element_disallowed(parts_dir):
    """UI-integrity guard: the SVG <style> ELEMENT must never be allowed. A
    <style> injected via dangerouslySetInnerHTML applies DOCUMENT-GLOBAL CSS
    (not scoped to the SVG), letting deck selectors restyle/relocate/re-label the
    trusted app UI and clickjack a real destructive control. Deck paint uses
    presentation attributes (fill="url(#id)"), not a stylesheet.

    Fail-closed at RUNTIME semantics, not source bytes: it strips comments first
    (so a `]` hidden in a comment can't truncate the match), requires
    SVG_ALLOWED_TAGS to be `new Set([ ...quoted string literals only... ])` with the
    array as the SOLE argument (no `].concat(...)`), and rejects any backslash in the
    body (so an escaped `"styl\\u0065"` that DECODES to "style" at runtime can't hide
    from a byte-level check). Any spread / concatenation / template / bare identifier /
    .add() / escape makes the guard FAIL rather than pass. The authoritative guard is
    still behavioral — the real-sanitizer test in tests/test_svg_mxss.cjs and the
    in-browser UI-battery redress test both execute the actual code — this lint is the
    fast static backstop, now honest about verifying runtime meaning."""
    errors = []
    fpath = os.path.join(parts_dir, "part-imports.jsx")
    if not os.path.exists(fpath):
        return errors
    with open(fpath, 'r', encoding="utf-8") as f:
        raw = f.read()
    # Work on a comment-free, string-preserving copy so comments can neither hide a
    # `]`/`style` nor trip the static-list checks.
    src = _strip_js_comments(raw)

    anchor = re.search(r'SVG_ALLOWED_TAGS\s*=\s*new Set\(\s*\[', src)
    if not anchor:
        errors.append(
            "SVG_ALLOWED_TAGS must be a literal `new Set([...])` of string literals so the "
            "UI-integrity guard can statically verify <style> is excluded — not found in the "
            "expected form (a non-literal construction could silently re-admit <style>)."
        )
        return errors
    i, depth, n = anchor.end(), 1, len(src)
    while i < n and depth > 0:
        c = src[i]
        if c == '[':
            depth += 1
        elif c == ']':
            depth -= 1
        i += 1
    body = src[anchor.end(): i - 1]
    # The array literal must be the SOLE argument to Set(): the next non-space char
    # after the closing ']' must be ')'. Anything else (`.concat(...)`, `,`, another
    # arg) is a dynamic construction that could inject "style" past this check.
    j = i
    while j < n and src[j] in " \t\r\n":
        j += 1
    if j >= n or src[j] != ')':
        errors.append(
            "SVG_ALLOWED_TAGS's array must be the sole argument to new Set() — found extra "
            "tokens after the closing ']' (e.g. .concat(...)). A dynamic tail can re-admit a "
            "document-global <style> element (redress / clickjack)."
        )
    # STATIC list only: no spread/concat/template, no backslash escapes (which decode
    # to a different value at runtime), no bare identifiers — every entry a quoted literal.
    if '...' in body or '`' in body or '+' in body:
        errors.append(
            "SVG_ALLOWED_TAGS must be a STATIC list of quoted string literals "
            "(no spread / concatenation / template) so the UI-integrity guard can "
            "verify <style> is excluded — a dynamic allowlist can silently re-admit "
            "a document-global <style> element (redress / clickjack)."
        )
    if '\\' in body:
        errors.append(
            "SVG_ALLOWED_TAGS entries must be plain (no backslash escape): an escaped tag "
            'like "styl\\u0065" decodes to "style" at runtime and would hide from a static '
            "check while genuinely re-admitting a document-global <style> element."
        )
    residue = re.sub(r'"[^"]*"|\'[^\']*\'', '', body)
    if re.search(r'[A-Za-z_$]', residue):
        errors.append(
            "SVG_ALLOWED_TAGS contains a non-string-literal entry — it must be a "
            "static list of quoted tag names so the guard can verify <style> is excluded."
        )
    allowed = set(re.findall(r'["\']([^"\']+)["\']', body))
    if 'style' in allowed:
        errors.append(
            'SVG_ALLOWED_TAGS must NOT include "style": a <style> element is '
            'document-global CSS (UI-redress / clickjack of real controls). Drop '
            'it and use presentation attributes (fill="url(#id)") for deck paint.'
        )
    # Block dynamic re-admission after construction and any filter-and-keep branch
    # (both loose and strict equality, either operand order).
    if re.search(r'SVG_ALLOWED_TAGS\s*\.\s*add\s*\(', src):
        errors.append(
            "SVG_ALLOWED_TAGS must not be mutated with .add() — the allowlist has to "
            "stay a static Set so <style> cannot be dynamically re-admitted."
        )
    if re.search(r'tag\s*===?\s*["\']style["\']', src) or re.search(r'["\']style["\']\s*===?\s*tag', src):
        errors.append(
            'part-imports.jsx has a `tag === "style"` retention branch — a <style> '
            'element must be dropped by the SVG_ALLOWED_TAGS allowlist, never '
            'filtered-and-kept (document-global CSS UI-redress / clickjack).'
        )
    # The literal allowlist being clean is not enough: the Set's membership can be
    # swapped at RUNTIME (e.g. `SVG_ALLOWED_TAGS.has = t => t==="sty"+"le" || ...`),
    # which re-admits <style> while the literal stays byte-clean and the node suites
    # (which extract fragments) miss the module-scope seam. Crucially the monolith is
    # ONE module scope, so a tamper statement can live in ANY part-file (an aliased Set
    # in part-app.jsx re-admits just as well) — scan the WHOLE concatenated, comment-
    # stripped source, not only part-imports.jsx.
    part_files = sorted(
        os.path.join(parts_dir, f) for f in os.listdir(parts_dir)
        if f.startswith("part-") and f.endswith(".jsx")
    )
    all_src = _strip_js_comments("\n".join(
        open(fp, 'r', encoding="utf-8").read() for fp in part_files
    ))
    for pat, label in (
        (r'SVG_ALLOWED_TAGS\s*\.\s*(?:has|add|delete|clear)\s*=(?!=)', 'reassigns SVG_ALLOWED_TAGS.has/add/delete'),
        (r'SVG_ALLOWED_TAGS\s*\[[^\]]*\]\s*=(?!=)', 'assigns into SVG_ALLOWED_TAGS[...]'),
        (r'(?:Object\.defineProperty|Object\.assign|Reflect\.\w+|new\s+Proxy)\s*\(\s*SVG_ALLOWED_TAGS', 'defines/wraps SVG_ALLOWED_TAGS'),
        # Patching Set.prototype (dot or bracket) reaches every Set incl. the allowlist.
        (r'Set\s*\.\s*prototype\s*\.\s*(?:has|add|delete|clear)\s*=(?!=)', 'patches Set.prototype.has/add/delete'),
        (r'Set\s*\.\s*prototype\s*\[[^\]]*\]\s*=(?!=)', 'patches Set.prototype[...]'),
        # Swapping the prototype swaps the membership methods just as effectively.
        (r'Object\.setPrototypeOf\s*\(\s*(?:SVG_ALLOWED_TAGS|Set\s*\.\s*prototype)', 'setPrototypeOf on the allowlist / Set.prototype'),
        (r'\.\s*__proto__\s*=(?!=)', 'reassigns a __proto__ (prototype swap)'),
        # Reassigning ANY .has/.add/.delete/.clear reaches the allowlist through an
        # alias (`const x = SVG_ALLOWED_TAGS; x.has = ...`). No part legitimately
        # reassigns these (they are only ever called), so flag any such assignment.
        (r'\.\s*(?:has|add|delete|clear)\s*=(?!=)', 'reassigns a Set membership method (aliased allowlist)'),
        # The walk decides membership via `SVG_ALLOWED_TAGS.has(child.localName.toLowerCase())`,
        # so overriding a BUILT-IN prototype method/getter it relies on (e.g.
        # `String.prototype.toLowerCase = ...` mapping "style"->an allowed tag, or an
        # `Element.prototype.localName` getter) re-admits <style> without touching the Set.
        # This app never monkey-patches a built-in prototype; forbid it outright.
        (r'\b[A-Za-z_$][\w$]*\s*\.\s*prototype\s*\.\s*[\w$]+\s*=(?!=)', 'patches a built-in prototype method'),
        (r'\b[A-Za-z_$][\w$]*\s*\.\s*prototype\s*\[[^\]]*\]\s*=(?!=)', 'patches a prototype via [...]'),
        (r'Object\.definePropert(?:y|ies)\s*\(\s*[A-Za-z_$][\w$]*\s*\.\s*prototype', 'defineProperty on a prototype'),
        (r'Object\.definePropert(?:y|ies)\s*\(\s*(?:Element|Node|HTMLElement|String|Array|Object|Set|Map|Function)\b', 'defineProperty on a built-in'),
        (r'(?:Object|Reflect)\.setPrototypeOf\s*\(', 'setPrototypeOf (prototype swap)'),
    ):
        if re.search(pat, all_src):
            errors.append(
                "SVG_ALLOWED_TAGS membership must not be tampered with anywhere in the app (" + label +
                "): a runtime override in any part-file re-admits a document-global <style> element "
                "(redress / clickjack) while the literal allowlist stays clean and fragment-extracting "
                "tests miss it."
            )
    # SVG_ALLOWED_TAGS assigned exactly once (its const declaration) across the whole app.
    if len(re.findall(r'(?<![=!<>+\-*/%&|^])\bSVG_ALLOWED_TAGS\s*=(?!=)', all_src)) > 1:
        errors.append(
            "SVG_ALLOWED_TAGS is assigned more than once — it must be a single immutable const "
            "Set so its membership can't be swapped at runtime to re-admit <style>."
        )
    return errors


def check_security_tests_not_skippable(parts_dir):
    """The SVG-<style> UI-integrity regression tests must ALWAYS run in the UI
    battery. CI treats a skipped test (pass:"skip") as non-failing, so if a security
    test could be marked requiresAI, an attacker could re-admit <style> and skip the
    real-runtime tests that catch it — reaching green CI with the vuln live. Forbid
    requiresAI on security-named tests, and assert the flagship redress test exists
    (the battery is the ground-truth guard: it runs the real module, unlike the
    fragment-extracting node suites)."""
    errors = []
    fpath = os.path.join(parts_dir, "part-uitest.jsx")
    if not os.path.exists(fpath):
        return errors
    with open(fpath, 'r', encoding="utf-8") as f:
        raw = f.read()
    # Comment-strip first so a `/*fn:*/`-style padding comment can't fool the scan.
    src = _strip_js_comments(raw)
    if 'cannot restyle/relocate app chrome' not in src:
        errors.append(
            'the SVG-<style> redress regression test ("SECURITY: deck SVG <style> cannot '
            'restyle/relocate app chrome") is missing from part-uitest.jsx — it is the '
            'real-runtime guard against the UI-redress / clickjack class and must stay.'
        )
    # Bound each test object by the NEXT test's `name:` (not a fixed char window or a
    # split on the first `fn:`), so requiresAI can't hide past a truncation point.
    names = list(re.finditer(r'name:\s*"([^"]*)"', src))
    for idx, m in enumerate(names):
        name = m.group(1)
        end = names[idx + 1].start() if idx + 1 < len(names) else len(src)
        obj = src[m.end():end]
        name_security = bool(re.search(r'SECURITY:|<style>|redress|clickjack', name))
        is_security = name_security or 'sanitizeSvgMarkup' in obj
        if is_security and 'requiresAI' in obj:
            errors.append(
                'security UI test ' + repr(name) + ' must not be requiresAI — it must always run '
                'in the battery (a skip is treated as non-failing, so requiresAI would let a sanitizer '
                'regression pass CI). Note the runner also fails such a skip at runtime (part-uitest.jsx).'
            )
        # A named security test must EXERCISE the real sanitizer — a vacuous body
        # (e.g. `return true`) keeps the required name but neuters the ground-truth
        # guard lint-invisibly. Require the call so the assertion stays load-bearing.
        if name_security and 'sanitizeSvgMarkup(' not in obj:
            errors.append(
                'security UI test ' + repr(name) + ' must call sanitizeSvgMarkup(...) — a body that '
                'does not exercise the real sanitizer (a vacuous `return true`) would neuter the '
                'redress/overlay guard while keeping its name. Keep the assertion load-bearing.'
            )
        # The chrome-safety flagship/overlay tests must keep their computed-style /
        # hit-test assertion — calling sanitizeSvgMarkup then just `return true` would
        # neuter them while passing the call-substring check above.
        if re.search(r'restyle/relocate app chrome|overlay app chrome', name) and \
           not re.search(r'getComputedStyle|elementFromPoint', obj):
            errors.append(
                'security UI test ' + repr(name) + ' must keep its computed-style / hit-test '
                'assertion (getComputedStyle / elementFromPoint) — a body that only calls '
                'sanitizeSvgMarkup and returns a constant would neuter the redress/overlay guard.'
            )
        # A security test must return a COMPUTED result, not a constant. Requiring the
        # assertion tokens above is not enough — they can be kept as dead code beside a
        # hardcoded `return true;`. A bare constant return neuters the test; forbid it.
        if name_security and re.search(r'\breturn\s+(?:true|false)\s*;', obj):
            errors.append(
                'security UI test ' + repr(name) + ' must not return a constant (`return true/false;`) '
                '— its pass/fail must be a computed assertion. A constant return neuters the guard '
                'while keeping the required name and token(s).'
            )
    return errors


def check_part_order_complete(parts_dir, part_order):
    """The manifest (src/parts/MANIFEST.txt) must list every part-*.jsx file on
    disk, and every manifest entry must exist on disk. A missing entry (e.g.
    part-pptx.jsx once was, in two of three hardcoded copies of this list)
    silently drops that part from every manifest-driven check — including the
    security allowlist-tamper scan — so a tamper statement hidden in the
    unlisted part evades the static guard. Both directions are hard errors."""
    errors = []
    if not os.path.isdir(parts_dir):
        return errors
    actual = sorted(f for f in os.listdir(parts_dir)
                    if f.startswith("part-") and f.endswith(".jsx"))
    missing = [f for f in actual if f not in part_order]
    extra = [f for f in part_order if f not in actual]
    if missing:
        errors.append(
            f"{MANIFEST_NAME} is missing part-file(s) present on disk: {missing} — add them "
            "so every part is built, linted and scanned by the security allowlist-tamper guard."
        )
    if extra:
        errors.append(f"{MANIFEST_NAME} lists part-file(s) that don't exist on disk: {extra} — remove them.")
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
    """Lint all part-files in a directory (list/order from MANIFEST.txt)."""
    errors = []
    warnings = []

    # load_manifest fails closed (exit 1) if the manifest is missing/malformed.
    part_order = load_manifest(parts_dir)

    # Check all expected parts exist
    for part_name in part_order:
        part_path = os.path.join(parts_dir, part_name)
        if not os.path.exists(part_path):
            errors.append(f"Missing part file: {part_name}")
            continue

        with open(part_path, 'r', encoding="utf-8") as f:
            source = f.read()

        errors += check_copyright_header(source, part_name)
        errors += check_conflict_markers(source, part_name)
        warnings += check_balanced_braces(source, part_name)

        # Size guard — warning only for now (see PART_SIZE_WARN_LINES).
        line_count = source.count("\n") + (0 if source.endswith("\n") else 1)
        if line_count > PART_SIZE_WARN_LINES:
            warnings.append(
                f"{part_name}: {line_count} lines exceeds the {PART_SIZE_WARN_LINES}-line "
                "size target (warning only — split candidate)"
            )

    # Check duplicates across all parts combined
    combined = ""
    for part_name in part_order:
        part_path = os.path.join(parts_dir, part_name)
        if os.path.exists(part_path):
            with open(part_path, 'r', encoding="utf-8") as f:
                combined += f.read()

    errors += check_duplicates(combined, "combined parts")
    errors += check_startup_patch(combined, "combined parts")
    errors += check_version_constants(combined, "combined parts")
    errors += check_deck_key_drift(parts_dir)
    errors += check_css_fetch_sink_gate(parts_dir)
    errors += check_svg_style_element_disallowed(parts_dir)
    errors += check_security_tests_not_skippable(parts_dir)
    errors += check_part_order_complete(parts_dir, part_order)

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
