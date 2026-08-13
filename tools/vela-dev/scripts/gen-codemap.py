#!/usr/bin/env python3
"""gen-codemap.py — generate src/parts/CODEMAP.md, the complete discovery index.

Why this exists: coding agents' input cost is dominated by DISCOVERY (finding
which file/symbol a change touches). A hand-curated routing table only covers
the tasks someone thought to write down — a blind eval found a feature (review
comments) spanning four files with no row, and the gap cost a full expensive
tree-scan to notice. This script derives a COMPLETE index from the code itself:
every top-level symbol (grouped by banner section), every reducer action with
the parts that dispatch it, every Vera tool, every UI-test suite — so any
novel change request resolves with one grep of one committed file.

Freshness is CI-gated (`--check`, wired beside the concat-sync gate): a stale
discovery index was measured to INCREASE change cost ~25% — worse than none —
so CODEMAP.md must regenerate in the same commit as any code change.

Backend note (deliberate design): extraction is stdlib regex, not AST/LSP.
This corpus is flat and convention-regular (column-0 declarations, literal
action/tool/suite strings — verified 100% coverage), Vela has no import graph
for an LSP to resolve, and this repo's dev tooling is stdlib-only by policy.
If the code ever outgrows that regularity, swap the extractors for an AST
backend (e.g. ast-grep) and KEEP the CODEMAP.md contract + freshness gate —
consumers depend on the artifact, not the parser.

Usage:
  python3 tools/vela-dev/scripts/gen-codemap.py           # (re)write CODEMAP.md
  python3 tools/vela-dev/scripts/gen-codemap.py --check   # exit 1 if stale
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parts_manifest import load_part_order, CANONICAL_PARTS_DIR  # noqa: E402
from partsize import find_sections  # noqa: E402

CODEMAP_PATH = os.path.join(CANONICAL_PARTS_DIR, "CODEMAP.md")

# Column-0 anchored on purpose: indented declarations are nested locals and
# outnumber top-level symbols 2:1 — including them would bury the signal.
SYMBOL_RE = re.compile(
    r"^(?:export\s+default\s+)?(?:async\s+)?function\s+(\w+)"
    r"|^const\s+(\w+)\s*="
    r"|^let\s+(\w+)\s*="
    r"|^class\s+(\w+)", re.M)

# Non-anchored findall catches fallthrough pairs (`case "A": case "B":`).
CASE_RE = re.compile(r'case\s+"([^"]+)"\s*:')
# Actions handled outside the switch (e.g. `if (a.type === "REDO")`).
TYPE_EQ_RE = re.compile(r'\.type\s*===\s*"([A-Z_0-9]+)"')
# Dispatch sites: primary literal form, plus a fallback that catches ternary
# action types (`type: cond ? "A" : "B"`) by taking every literal in the object.
DISPATCH_RE = re.compile(r'dispatch\(\{\s*type\s*:\s*"([A-Z_0-9]+)"')
DISPATCH_FALLBACK_RE = re.compile(r'dispatch\(\{\s*type\s*:[^}]*?"([A-Z_0-9]+)"')
UISUITE_RE = re.compile(r'uiSuite\(\s*"([^"]+)"')

# A stretch this long with no banner is navigation debt: agents can't ranged-
# read what they can't locate. WARN-only — visibility, not a gate.
DEBT_STRETCH_LINES = 350


def top_symbols(text):
    out = []
    for m in SYMBOL_RE.finditer(text):
        name = next(g for g in m.groups() if g)
        out.append((text.count("\n", 0, m.start()) + 1, name))  # (line, name)
    return out


def executetool_cases(text):
    """Tool names = case labels inside executeTool's switch only."""
    m = re.search(r"function executeTool\b", text)
    if not m:
        return []
    # Scope to executeTool's body: from its start to the next column-0 brace
    # close (the corpus convention: `}` alone at column 0 ends the function).
    end = text.find("\n}", m.start())
    body = text[m.start():end if end != -1 else len(text)]
    return CASE_RE.findall(body)


def build():
    parts = load_part_order()
    per_part = []           # (fname, [(section_title, [symbols])])
    debt = []
    dispatch_map = {}       # action -> set of part names
    actions, tools, suites = [], [], []

    for fname in parts:
        path = os.path.join(CANONICAL_PARTS_DIR, fname)
        text = open(path, encoding="utf-8").read()
        lines = text.split("\n")
        sections = find_sections(lines)
        syms = top_symbols(text)

        # Group symbols under the nearest preceding banner (any level).
        grouped, current, cur_title = [], [], "(file preamble)"
        sec_iter = iter(sections + [{"line": len(lines) + 1, "title": None}])
        nxt = next(sec_iter)
        for line_no, name in syms:
            while nxt["title"] is not None and line_no >= nxt["line"]:
                if current:
                    grouped.append((cur_title, current))
                cur_title, current = nxt["title"], []
                nxt = next(sec_iter)
            current.append(name)
        if current:
            grouped.append((cur_title, current))
        per_part.append((fname, grouped))

        # Dispatch sites (union of primary + fallback forms).
        for rex in (DISPATCH_RE, DISPATCH_FALLBACK_RE):
            for action in rex.findall(text):
                dispatch_map.setdefault(action, set()).add(fname)

        if fname == "part-reducer.jsx":
            actions = sorted(set(CASE_RE.findall(text)) | set(TYPE_EQ_RE.findall(text)))
        if fname == "part-engine.jsx":
            tools = executetool_cases(text)
        if fname == "part-uitest.jsx":
            suites = [s for s in UISUITE_RE.findall(text)]

        # Navigability debt.
        l1 = [s for s in sections if s["level"] == 1]
        if not l1:
            debt.append(f"{fname}: no level-1 banners ({len(lines)} lines)")
        bounds = [s["line"] for s in sections] + [len(lines)]
        prev = 1
        for b in bounds:
            if b - prev > DEBT_STRETCH_LINES:
                debt.append(f"{fname}: {b - prev}-line unbannered stretch after line {prev}")
            prev = b

    out = []
    out.append("# CODEMAP — generated discovery index. DO NOT EDIT BY HAND.")
    out.append("")
    out.append("Generated by `tools/vela-dev/scripts/gen-codemap.py`; CI fails if stale")
    out.append("(`--check`). Regenerate in the same commit as any `src/parts/` change.")
    out.append("Grep this file to find where a symbol/action/tool/suite lives, then grep")
    out.append("that symbol in the named part for the line. No line numbers here — they rot.")
    out.append("")
    out.append("## Top-level symbols by part and banner section")
    out.append("")
    for fname, grouped in per_part:
        out.append(f"### {fname}")
        for title, names in grouped:
            out.append(f"- {title}: " + " ".join(names))
        out.append("")
    out.append("## Reducer actions → parts that dispatch them")
    out.append("")
    out.append("Actions with no entry are reached only indirectly (Vera engine workspace,")
    out.append("keyboard ternaries) or are currently unused — check before assuming a UI exists.")
    out.append("")
    for action in actions:
        srcs = sorted(dispatch_map.get(action, []))
        out.append(f"- {action}: " + (" ".join(srcs) if srcs else "(no direct dispatch site)"))
    out.append("")
    out.append("## Vera engine tools (executeTool switch, part-engine.jsx)")
    out.append("")
    out.append(" ".join(tools))
    out.append("")
    out.append("## UI test suites (uiSuite, part-uitest.jsx)")
    out.append("")
    for s in suites:
        out.append(f"- {s}")
    out.append("")
    out.append("## Navigability debt (WARN — candidates for banners or splits)")
    out.append("")
    for d in debt:
        out.append(f"- {d}")
    out.append("")
    return "\n".join(out)


def main():
    content = build()
    if "--check" in sys.argv:
        on_disk = open(CODEMAP_PATH, encoding="utf-8").read() if os.path.exists(CODEMAP_PATH) else ""
        if on_disk != content:
            print("❌ CODEMAP.md is stale — regenerate it in the SAME commit as the code change:")
            print("   python3 tools/vela-dev/scripts/gen-codemap.py")
            print("   (a stale discovery index measurably costs more than none)")
            return 1
        print("✅ CODEMAP.md is fresh")
        return 0
    open(CODEMAP_PATH, "w", encoding="utf-8").write(content)
    print(f"✅ wrote {CODEMAP_PATH} ({len(content):,} chars)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
