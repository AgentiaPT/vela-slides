#!/usr/bin/env python3
"""Freshness gate for the CLAUDE.md "Where does X live" routing table.

Why this exists: the routing table is a discovery index for coding agents —
measured to cut per-change input cost — but a STALE index is worse than none
(a row pointing at a file or symbol that no longer exists was measured to
*increase* change cost by ~25%, because agents burn tokens reconciling docs
against reality). The table's file list and symbol claims must therefore be
CI-verified against the tree on every change, the same way concat-sync gates
the monolith.

Checks (fail-closed, exit 1 on any error):
  1. Every `path`-looking token in the table (src/..., skills/..., tools/...,
     tests/..., docs/...) names a file that exists.
  2. Every plain-identifier symbol in backticks appears somewhere under
     src/parts/ or skills/vela-slides/scripts/ (catches renames/deletions
     without over-constraining which file a symbol lives in).
Non-identifier tokens (code snippets, quoted strings, globs) are skipped —
this gate is for reference rot, not prose style.

Stdlib only. Run: python3 tools/vela-dev/scripts/check-routing.py [repo_root]
"""
import os
import re
import sys

def main():
    root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else
                           os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    claude_md = os.path.join(root, "CLAUDE.md")
    if not os.path.exists(claude_md):
        print("check-routing: CLAUDE.md not found at repo root")
        return 1
    text = open(claude_md, encoding="utf-8").read()

    # Isolate the routing-table section (from its heading to the next ## heading).
    m = re.search(r"^##\s+Where does X live.*?$(.*?)(?=^##\s|\Z)", text,
                  re.M | re.S)
    if not m:
        print("check-routing: 'Where does X live' section not found in CLAUDE.md "
              "(if the table was renamed, update this check in the same change)")
        return 1
    section = m.group(1)
    rows = [ln for ln in section.splitlines()
            if ln.strip().startswith("|") and not re.match(r"^\|[\s\-|]+\|$", ln.strip())]
    if len(rows) < 5:
        print(f"check-routing: routing table looks truncated ({len(rows)} rows)")
        return 1

    errors = []

    # 1. Path claims must exist on disk.
    path_re = re.compile(r"`((?:src|skills|tools|tests|docs)/[A-Za-z0-9_./\-]+)`")
    paths = set(p for row in rows for p in path_re.findall(row))
    for p in sorted(paths):
        if not os.path.exists(os.path.join(root, p)):
            errors.append(f"routing table names missing file: {p}")

    # 2. Symbol claims must exist somewhere in the app source or skill scripts.
    #    Only plain identifiers are checked; snippets/globs/strings are skipped.
    corpus = []
    for base in ("src/parts", "skills/vela-slides/scripts"):
        d = os.path.join(root, base)
        for fn in sorted(os.listdir(d)):
            fp = os.path.join(d, fn)
            if os.path.isfile(fp) and fn.endswith((".jsx", ".py", ".txt")):
                corpus.append(open(fp, encoding="utf-8", errors="replace").read())
    corpus = "\n".join(corpus)

    ident_re = re.compile(r"`([A-Za-z_][A-Za-z0-9_]*)`")
    # Words that are prose/markup conventions, not code symbols.
    skip = {"NN", "main", "docs", "Read", "grep"}
    symbols = set(s for row in rows for s in ident_re.findall(row)) - skip
    for s in sorted(symbols):
        if s not in corpus:
            errors.append(f"routing table names symbol not found in source: {s}")

    if errors:
        print(f"❌ check-routing: {len(errors)} stale routing claim(s):")
        for e in errors:
            print(f"   - {e}")
        print("   Fix the routing table in the SAME commit as the rename/move "
              "(a stale index measurably costs more than no index).")
        return 1
    print(f"✅ check-routing: {len(paths)} path claims and {len(symbols)} symbol "
          f"claims verified fresh")
    return 0

if __name__ == "__main__":
    sys.exit(main())
