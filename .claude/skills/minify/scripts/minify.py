#!/usr/bin/env python3
"""
minify.py — the instrument the `/minify` skill points at files.

It never edits a file and never decides. It measures, enumerates, and reports.
You do the minifying; this proves whether the result kept every constraint.

    minify.py plan      <source>                    per-class compression budget
    minify.py inventory <source> [-o inv.json]      enumerated constraint inventory
    minify.py measure   <source> <minified>         size verdict only
    minify.py verify    <source> <minified>         both verdicts + all gates
    minify.py selftest                              fixture battery

Exit codes (repo convention): 0 ok · 1 size verdict below bar · 2 usage
· 3 file not found · 4 structure/gate rejection (do not ship) · 5 conflict.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import minify_lib as ml   # noqa: E402

EXIT_OK, EXIT_SIZE, EXIT_USAGE, EXIT_NOTFOUND, EXIT_REJECT = 0, 1, 2, 3, 4


# ---------------------------------------------------------------------------
# rendering
# ---------------------------------------------------------------------------

def _n(x: float) -> str:
    return f"{x:,}"


def render_plan(doc: ml.Doc, plan: dict) -> str:
    out = [f"BUDGET PLAN — {doc.path}", "=" * 72]
    m = ml.file_metrics(doc)
    out.append(f"  {_n(m['bytes'])} B · {_n(m['lines'])} lines · "
               f"verbatim {m['verbatim_fraction_pct']}% · function-word {m['function_word_ratio_pct']}%")
    if m["verbatim_fraction_pct"] > ml.PRE_DENSIFIED_VERBATIM_PCT or \
       m["function_word_ratio_pct"] < ml.PRE_DENSIFIED_FUNCWORD_PCT:
        out.append("  PRE-DENSIFIED — this file is already telegraphic; expect a small size verdict.")
    out.append("")
    out.append("  class  content                        bytes   budget   allowed cut")
    out.append("  " + "-" * 68)
    for cls in sorted(ml.CLASS_BUDGET):
        label, lo, hi, risk = ml.CLASS_BUDGET[cls]
        b = plan["per_class_bytes"].get(cls, 0)
        out.append(f"  {cls}     {label:<28} {_n(b):>7}   {lo:>4.0f}-{hi:<3.0f}%  "
                   f"{round(b*lo/100):>5}-{round(b*hi/100):<5} B   risk={risk}")
    lo_b, hi_b = plan["allowed_cut_bytes"]
    lo_p, hi_p = plan["allowed_cut_pct"]
    out.append("  " + "-" * 68)
    out.append(f"  FILE TARGET: cut {_n(lo_b)}-{_n(hi_b)} B ({lo_p}-{hi_p}%). "
               "This is a per-class sum, not a flat file-wide ratio.")
    out.append("")
    out.append("  Per section (largest first):")
    secs = sorted(plan["per_section_bytes"].items(),
                  key=lambda kv: -sum(kv[1].values()))
    for name, classes in secs[:15]:
        tot = sum(classes.values())
        mix = " ".join(f"{c}:{b}B" for c, b in sorted(classes.items(), key=lambda kv: -kv[1]))
        out.append(f"    {name[:44]:<44} {_n(tot):>6} B  {mix}")
    return "\n".join(out)


def render_inventory(inv: dict) -> str:
    c = inv["counts"]
    out = [f"CONSTRAINT INVENTORY — {inv['source']}", "=" * 72,
           f"  sha256 {inv['sha256'][:16]}…  {_n(inv['bytes'])} B",
           f"  {c['constraints']} constraints  "
           f"(obligation {c['obligations']} · prohibition {c['prohibitions']} · "
           f"exception {c['exceptions']} · default {c['defaults']} · "
           f"permission {c['permissions']} · conditional {c['conditionals']})",
           f"  atoms: {c['verbatim_spans']} verbatim spans · {c['numeric_literals']} numeric "
           f"literals · {c['reference_edges']} reference edges", ""]
    for k in inv["constraints"]:
        mod = k["modality"] or "-"
        q = ",".join(k["quantifiers"]) or "-"
        out.append(f"  {k['cid']}  L{k['line']:<4} {k['cls']}  {k['kind']:<12} "
                   f"mod={mod:<6} quant={q}")
        out.append(f"        {k['text'][:150]}")
    return "\n".join(out)


def render_size(v: dict) -> str:
    out = ["=" * 72, "VERDICT 1/2 — SIZE", "=" * 72,
           f"  bytes         {_n(v['bytes_before'])} -> {_n(v['bytes_after'])}  "
           f"({v['byte_cut_pct']:+.1f}% cut)",
           f"  tokens        wordpunct {_n(v['tokens_wordpunct'][0])} -> {_n(v['tokens_wordpunct'][1])} "
           f"({v['token_cut_pct']['wordpunct']:.1f}%)   "
           f"byterate {_n(v['tokens_byterate'][0])} -> {_n(v['tokens_byterate'][1])} "
           f"({v['token_cut_pct']['byterate']:.1f}%)",
           f"  reported cut  {v['token_cut_reported_pct']:.1f}%  "
           f"(lower of two stdlib proxies; not a real tokenizer)",
           f"  bar           >= {v['bar_pct']:.0f}%",
           f"  density       verbatim {v['verbatim_fraction_pct']}% · "
           f"function-word {v['function_word_ratio_pct']}%"]
    for f in v["flags"]:
        out.append(f"  FLAG          {f}")
    line = f"  RESULT        {v['result']}"
    if v["exemption_note"]:
        line += f" — {v['exemption_note']}"
    out.append(line)
    return "\n".join(out)


def render_structure(s: dict, refs: dict, fm: dict) -> str:
    out = ["", "=" * 72, "VERDICT 2/2 — STRUCTURE", "=" * 72,
           f"  constraints   {s['constraints_total']} inventoried | {s['present']} present | "
           f"{s['attested']} attested | {s['review_unattested']} review | {s['lost']} lost",
           f"  atoms         {len(s['atom_failures'])} failures "
           f"(verbatim spans / numeric literals)",
           f"  references    {refs['edges_before']} edges before -> {refs['edges_after']} after · "
           f"{len(refs['dropped_edges'])} dropped · {len(refs['unresolved'])} unresolved "
           f"({refs['resolution_checked']} resolution-checked)",
           f"  frontmatter   {fm['result']}"
           + (" — " + "; ".join(fm["problems"]) if fm["problems"] else ""),
           f"  explicitness  {s['explicit_gain']:+d} explicit quantifier/modality tokens",
           f"  score         structure_score = explicit_gain({s['explicit_gain']}) "
           f"- constraints_lost({s['constraints_lost']}) = {s['structure_score']}   (must be >= 0)"]

    bad = [f for f in s["findings"] if f["status"] in ("lost", "review")]
    if bad:
        out.append("")
        out.append("  UNSATISFIED INVENTORY ITEMS — each must be fixed or attested:")
        for f in bad:
            out.append(f"    {f['cid']}  {f['status'].upper():<7} coverage={f['coverage']:.2f} "
                       f"match=L{f['matched_line']}")
            for d in f["defects"]:
                out.append(f"        defect: {d}")
            if f["note"]:
                out.append(f"        {f['note']}")
    for a in s["atom_failures"]:
        out.append(f"    ATOM LOST  {a}")
    for d in refs["dropped_edges"]:
        out.append(f"    REF DROPPED  {d}")
    for u in refs["unresolved"]:
        out.append(f"    REF UNRESOLVED  {u}")

    result = s["result"]
    if refs["result"] == "REJECTED" or fm["result"] == "REJECTED":
        result = "REJECTED"
    out.append(f"  RESULT        {result}")
    out.append("")
    out.append("  The two verdicts above are separate and are never combined into a single")
    out.append("  number. A passing size verdict does not authorise shipping a REJECTED")
    out.append("  structure verdict; a passing structure verdict does not claim the file")
    out.append("  got usefully smaller.")
    return "\n".join(out)


# ---------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------

def _load(path: str) -> ml.Doc:
    if not os.path.exists(path):
        print(f"not found: {path}", file=sys.stderr)
        raise SystemExit(EXIT_NOTFOUND)
    return ml.load(path)


def cmd_plan(a: argparse.Namespace) -> int:
    doc = _load(a.source)
    plan = ml.budget_plan(doc)
    if a.json:
        print(json.dumps({"metrics": ml.file_metrics(doc), "plan": plan}, indent=2))
    else:
        print(render_plan(doc, plan))
    return EXIT_OK


def cmd_inventory(a: argparse.Namespace) -> int:
    doc = _load(a.source)
    inv = ml.inventory(doc, include_statements=a.all)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as fh:
            json.dump(inv, fh, indent=2, ensure_ascii=False)
        print(f"wrote {a.out}  ({inv['counts']['constraints']} constraints, "
              f"{inv['counts']['verbatim_spans']} verbatim spans, "
              f"{inv['counts']['numeric_literals']} numerics, "
              f"{inv['counts']['reference_edges']} reference edges)")
    if a.json and not a.out:
        print(json.dumps(inv, indent=2, ensure_ascii=False))
    elif not a.out:
        print(render_inventory(inv))
    return EXIT_OK


def cmd_measure(a: argparse.Namespace) -> int:
    o, m = _load(a.source), _load(a.minified)
    v = ml.size_verdict(o, m)
    print(json.dumps(v, indent=2) if a.json else render_size(v))
    return EXIT_OK if v["result"] in ("PASS", "EXEMPT") else EXIT_SIZE


def _run_verify(source: str, minified: str, inv_path: str = None,
                attest_path: str = None, root: str = None) -> dict:
    o, m = _load(source), _load(minified)
    if inv_path:
        with open(inv_path, encoding="utf-8") as fh:
            inv = json.load(fh)
        if inv.get("sha256") and inv["sha256"] != o.sha256:
            print("CONFLICT: inventory was taken from a different revision of the source "
                  f"({inv['sha256'][:12]}… vs {o.sha256[:12]}…). Re-run `inventory`.",
                  file=sys.stderr)
            raise SystemExit(5)
    else:
        inv = ml.inventory(o)
    attest = {}
    if attest_path:
        with open(attest_path, encoding="utf-8") as fh:
            attest = json.load(fh)
    return {
        "size": ml.size_verdict(o, m),
        "structure": ml.survival(inv, m, attest),
        "references": ml.reference_graph(o, m, root),
        "frontmatter": ml.frontmatter_check(o, m),
        "inventory_counts": inv["counts"],
    }


def cmd_verify(a: argparse.Namespace) -> int:
    r = _run_verify(a.source, a.minified, a.inventory, a.attest, a.root)
    if a.json:
        print(json.dumps(r, indent=2, ensure_ascii=False))
    else:
        print(render_size(r["size"]))
        print(render_structure(r["structure"], r["references"], r["frontmatter"]))
    rejected = (r["structure"]["result"] == "REJECTED"
                or r["references"]["result"] == "REJECTED"
                or r["frontmatter"]["result"] == "REJECTED")
    if rejected:
        return EXIT_REJECT
    return EXIT_OK if r["size"]["result"] in ("PASS", "EXEMPT") else EXIT_SIZE


# ---------------------------------------------------------------------------
# selftest — fixture battery
# ---------------------------------------------------------------------------

FIXTURES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures")

#: (name, source, candidate, expect) — expect is "accept" or a defect substring
#: that MUST appear in the rejection report.
CASES = [
    ("probe-a known-good", "probe-a.before.md", "probe-a.after.md", "accept"),
    ("probe-b known-good", "probe-b.before.md", "probe-b.after.md", "accept"),
    ("probe-c known-good", "probe-c.before.md", "probe-c.after.md", "accept"),
    ("probe-a dropped exception", "probe-a.before.md", "probe-a.lossy-exception.md", "reject"),
    ("probe-b flattened quantifier", "probe-b.before.md", "probe-b.lossy-quantifier.md", "reject"),
    ("probe-b truncated scope list", "probe-b.before.md", "probe-b.lossy-scopelist.md", "verbatim"),
    ("probe-c numeric drift", "probe-c.before.md", "probe-c.lossy-numeric.md", "numeric"),
    ("probe-c dropped cross-reference", "probe-c.before.md", "probe-c.lossy-ref.md", "reference"),
    ("probe-a weakened modality", "probe-a.before.md", "probe-a.lossy-modality.md", "reject"),
    ("frontmatter description compressed", "frontmatter.before.md",
     "frontmatter.lossy-description.md", "frontmatter"),
    ("output grew instead of shrinking", "probe-a.before.md", "probe-a.grown.md", "FAIL-GREW"),
]


def cmd_selftest(a: argparse.Namespace) -> int:
    failures = 0
    for name, src, cand, expect in CASES:
        s, c = os.path.join(FIXTURES, src), os.path.join(FIXTURES, cand)
        if not (os.path.exists(s) and os.path.exists(c)):
            print(f"  MISSING FIXTURE  {name}")
            failures += 1
            continue
        r = _run_verify(s, c)
        rejected = (r["structure"]["result"] == "REJECTED"
                    or r["references"]["result"] == "REJECTED"
                    or r["frontmatter"]["result"] == "REJECTED")
        blob = json.dumps(r, ensure_ascii=False)
        if expect == "accept":
            ok = not rejected
            detail = ""
            if not ok:
                bad = [f"{f['cid']}:{f['status']}:{','.join(f['defects'])}"
                       for f in r["structure"]["findings"] if f["status"] in ("lost", "review")]
                detail = ("  " + "; ".join(bad) + "; atoms=" + str(r["structure"]["atom_failures"])
                          + "; refs=" + str(r["references"]["dropped_edges"]))
        elif expect == "FAIL-GREW":
            ok = r["size"]["result"] == "FAIL-GREW"
            detail = "" if ok else f"  size result was {r['size']['result']}"
        else:
            ok = rejected and (expect == "reject" or expect in blob)
            detail = "" if ok else "  expected a rejection mentioning " + repr(expect)
        print(f"  {'PASS' if ok else 'FAIL'}  {name}{detail}")
        if not ok:
            failures += 1
        if a.verbose:
            print(render_size(r["size"]))
            print(render_structure(r["structure"], r["references"], r["frontmatter"]))
    print(f"\n  {len(CASES) - failures}/{len(CASES)} fixture cases pass")
    return EXIT_OK if failures == 0 else EXIT_REJECT


# ---------------------------------------------------------------------------

def main(argv: list) -> int:
    p = argparse.ArgumentParser(prog="minify.py", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--json", action="store_true", help="machine-readable output")
    sub = p.add_subparsers(dest="cmd")

    sp = sub.add_parser("plan", help="per-content-class compression budget")
    sp.add_argument("source")
    sp.set_defaults(fn=cmd_plan)

    si = sub.add_parser("inventory", help="enumerate every constraint in the source")
    si.add_argument("source")
    si.add_argument("-o", "--out", help="write inventory JSON here")
    si.add_argument("--all", action="store_true", help="include non-normative statements")
    si.set_defaults(fn=cmd_inventory)

    sm = sub.add_parser("measure", help="size verdict only")
    sm.add_argument("source")
    sm.add_argument("minified")
    sm.set_defaults(fn=cmd_measure)

    sv = sub.add_parser("verify", help="both verdicts + survival/reference/frontmatter gates")
    sv.add_argument("source")
    sv.add_argument("minified")
    sv.add_argument("--inventory", help="inventory JSON taken before minifying")
    sv.add_argument("--attest", help="JSON map cid -> {line, why} for restructured constraints")
    sv.add_argument("--root", help="repo/tree root for reference resolution + inbound edges")
    sv.set_defaults(fn=cmd_verify)

    ss = sub.add_parser("selftest", help="run the fixture battery")
    ss.add_argument("-v", "--verbose", action="store_true")
    ss.set_defaults(fn=cmd_selftest)

    a = p.parse_args(argv)
    if not getattr(a, "fn", None):
        p.print_help()
        return EXIT_USAGE
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
