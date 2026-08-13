#!/usr/bin/env python3
"""minify-check — measurement and invariant verification for the /minify skill.

This script never rewrites a file. It measures and it checks. All of the
judgement (what to compress, what to keep, what to flag) belongs to the agent;
this tool exists so the mechanical claims in the self-report are actually
measured rather than asserted.

Commands
    measure ORIG MIN            size delta: bytes, chars, estimated tokens
    verify  ORIG MIN            invariant checks (frozen payload, modality,
                                exceptions, headings, frontmatter, legend)
    xref    FILE [--root DIR] [--exclude SUBSTR ...]
                                which other files cite FILE's headings/path,
                                i.e. what breaks if you rename or reorder them
    exceptions FILE             list every exception/carve-out clause, so each
                                one can be ticked off in the minified file
    report  ORIG MIN [--root DIR]
                                measure + verify in one markdown block

Exit codes: 0 clean · 1 HARD finding(s) · 2 usage error.
Stdlib only. Add --json to any command for machine-readable output.
"""

from __future__ import annotations

import json
import math
import os
import re
import sys

# ---------------------------------------------------------------- token proxy

def _tiktoken_count(text: str):
    """Real BPE count if tiktoken happens to be installed. Usually it is not."""
    try:
        import tiktoken  # type: ignore
        return len(tiktoken.get_encoding("cl100k_base").encode(text))
    except Exception:
        return None


_CAMEL = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")
_PIECE = re.compile(r"[A-Za-z]+|[0-9]+|\n+|[ \t]+|[^\sA-Za-z0-9]+")


def est_tokens(text: str) -> int:
    """Heuristic BPE proxy, tuned for identifier-heavy markdown.

    chars/4 badly understates files full of paths and symbol names, which is
    exactly what instruction files are. This splits camelCase, charges per
    sub-word piece, and charges separately for punctuation and indentation.
    It is a proxy, not ground truth: trust the RATIO between two files
    measured the same way, not the absolute number.
    """
    total = 0
    for piece in _PIECE.findall(text):
        ch = piece[0]
        if ch.isalpha():
            for seg in _CAMEL.split(piece):
                total += max(1, round(len(seg) / 4.5))
        elif ch.isdigit():
            total += max(1, math.ceil(len(piece) / 3))
        elif ch == "\n":
            total += max(1, math.ceil(len(piece) / 2))
        elif ch in " \t":
            total += len(piece) // 4  # indentation costs; a single space merges
        else:
            total += max(1, math.ceil(len(piece) / 2))
    return total


# ------------------------------------------------------------------ extractors

FENCE_RE = re.compile(r"^(?P<f>```|~~~)[^\n]*\n.*?^(?P=f)[ \t]*$", re.S | re.M)
INLINE_RE = re.compile(r"``([^`]+)``|`([^`\n]+)`")
HEADING_RE = re.compile(r"^(#{1,6})[ \t]+(.+?)[ \t]*#*$", re.M)
URL_RE = re.compile(r"https?://[^\s)>\]`\"']+")
PATHY_RE = re.compile(r"(?:[\w.@-]+/)+[\w.@-]+")
NUMREF_RE = re.compile(
    r"(?:principle|step|phase|rule|risk|§|section)\s*#?\s*\d+(?:\.\d+)?", re.I
)

EXCEPTION_RE = re.compile(
    r"\b(?:except(?:\s+(?:when|for|if|that|the))?|unless|only\s+(?:if|when|after|for|"
    r"where|with|in)|other\s+than|aside\s+from|apart\s+from|provided\s+that|but\s+not|"
    r"save\s+for|does\s+not\s+apply|doesn't\s+apply|exempt|carve[- ]out|caveat|"
    r"with\s+the\s+exception)\b",
    re.I,
)

NEGATION_RE = re.compile(
    r"\b(?:never|not|no|none|nothing|cannot|can't|don't|doesn't|won't|mustn't|"
    r"shouldn't|avoid|forbidden|prohibited|banned|refuse|skip)\b",
    re.I,
)

MODALS = [
    "MUST NOT", "MUST", "SHALL NOT", "SHALL", "SHOULD NOT", "SHOULD", "MAY",
    "REQUIRED", "OPTIONAL", "RECOMMENDED", "NEVER", "ALWAYS", "ONLY",
    "EVERY", "EACH", "ANY", "ALL", "PROHIBITED", "MANDATORY", "CRITICAL",
    "IMPORTANT",
]

FIELD_LABELS = [
    "SCOPE:", "RULE:", "DO:", "NEVER:", "EXCEPT:", "IF:", "THEN:", "GATE:",
    "TEST:", "WHY:", "SEE:", "STEP ",
]

SKIP_DIRS = {
    ".git", "node_modules", "dist", "build", ".venv", "venv", "__pycache__",
    ".playwright-cli", ".pytest_cache", "results", "coverage", ".next",
}
TEXT_EXT = {
    ".md", ".txt", ".py", ".jsx", ".js", ".cjs", ".mjs", ".ts", ".tsx",
    ".json", ".yml", ".yaml", ".sh", ".toml", ".html", ".cfg", ".ini",
}


def read(path: str) -> str:
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        return fh.read()


def split_frontmatter(text: str):
    """Return (frontmatter_or_None, body). Only a leading --- block counts."""
    if not text.startswith("---"):
        return None, text
    m = re.match(r"---[ \t]*\n(.*?)\n---[ \t]*(?:\n|$)", text, re.S)
    if not m:
        return None, text
    return m.group(1), text[m.end():]


def strip_fences(text: str) -> str:
    return FENCE_RE.sub("", text)


def fences(text: str):
    return [m.group(0).strip() for m in FENCE_RE.finditer(text)]


def inline_spans(text: str):
    out = []
    for m in INLINE_RE.finditer(text):
        out.append((m.group(1) or m.group(2)).strip())
    return out


def headings(text: str):
    body = strip_fences(text)
    return [(len(m.group(1)), m.group(2).strip()) for m in HEADING_RE.finditer(body)]


def is_payload(span: str) -> bool:
    """Does this inline span look like a literal an agent will copy verbatim?

    Paths, commands, flags, symbol names, dotted identifiers, CONSTANT_NAMES.
    Losing one of these is a broken instruction that still reads fine, so they
    are checked hard rather than flagged for review.
    """
    s = span.strip()
    if not s:
        return False
    if "/" in s or s.startswith("-") or s.startswith("$") or "(" in s:
        return True
    if re.search(r"\.(py|jsx?|tsx?|md|json|ya?ml|sh|txt|html|css|lock|toml)\b", s):
        return True
    if "_" in s and s.upper() == s:
        return True
    if re.search(r"[a-z][A-Z]", s):  # camelCase
        return True
    if re.match(r"^[A-Za-z_][\w.]*\.\w+$", s):  # dotted identifier
        return True
    return False


IDIOM_RE = re.compile(r"\bat all\b|\bnot at all\b", re.I)


def counts(text: str, needles) -> dict:
    """Count each modal/quantifier once, longest phrase first.

    Consumption must be case-insensitive: a lowercase "must not" has to be
    removed by the MUST NOT pass, or the MUST pass counts it a second time and
    reports a phantom loss when the minified file writes it as "MUST NOT".
    """
    hay = IDIOM_RE.sub(" ", strip_fences(text))  # "at all" is not a quantifier
    out = {}
    consumed = hay
    for word in needles:
        pattern = r"\b" + word.replace(" ", r"\s+") + r"\b"
        exact = re.compile(pattern)
        loose = re.compile(pattern, re.I)
        out[word] = {"emphatic": len(exact.findall(consumed)),
                     "total": len(loose.findall(consumed))}
        consumed = loose.sub(" ", consumed)
    return out


def lines_matching(text: str, rx) -> list:
    out = []
    for i, line in enumerate(text.splitlines(), 1):
        if rx.search(line):
            out.append((i, line.strip()))
    return out


# -------------------------------------------------------------------- measure

def measure(orig_path: str, min_path: str) -> dict:
    o, m = read(orig_path), read(min_path)
    ob, mb = len(o.encode("utf-8")), len(m.encode("utf-8"))
    ot, mt = est_tokens(o), est_tokens(m)
    real_o, real_m = _tiktoken_count(o), _tiktoken_count(m)

    def pct(a, b):
        return round((a - b) / a * 100, 1) if a else 0.0

    data = {
        "original": orig_path, "minified": min_path,
        "bytes": {"orig": ob, "min": mb, "delta_pct": pct(ob, mb)},
        "chars": {"orig": len(o), "min": len(m), "delta_pct": pct(len(o), len(m))},
        "est_tokens": {"orig": ot, "min": mt, "delta_pct": pct(ot, mt),
                       "method": "heuristic sub-word proxy (minify-check)"},
        "chars_over_4": {"orig": len(o) // 4, "min": len(m) // 4,
                         "delta_pct": pct(len(o) // 4, len(m) // 4)},
        "lines": {"orig": o.count("\n") + 1, "min": m.count("\n") + 1},
    }
    if real_o and real_m:
        data["tiktoken_cl100k"] = {"orig": real_o, "min": real_m,
                                   "delta_pct": pct(real_o, real_m)}
    return data


def fmt_delta(p: float) -> str:
    """Positive delta_pct means the file shrank. Negative means it GREW —
    which happens on files that are already dense, where field labels and the
    legend cost more than the prose they replace. That is a real answer."""
    if p > 0:
        return f"-{p}%"
    if p < 0:
        return f"+{abs(p)}% GREW"
    return "0%"


def print_measure(d: dict) -> None:
    print(f"orig: {d['original']}\nmin : {d['minified']}\n")
    row = "  {:<18} {:>10} {:>10} {:>9}"
    print(row.format("metric", "original", "minified", "delta"))
    for key, label in (("bytes", "bytes"), ("chars", "chars"),
                       ("est_tokens", "est. tokens"),
                       ("chars_over_4", "chars/4 proxy"),
                       ("tiktoken_cl100k", "tiktoken cl100k")):
        if key in d:
            v = d[key]
            print(row.format(label, v["orig"], v["min"], fmt_delta(v["delta_pct"])))
    print(row.format("lines", d["lines"]["orig"], d["lines"]["min"], ""))
    print("\n  Token counts are a proxy — no Claude tokenizer here. Both files are")
    print("  measured the same way, so the RATIO is meaningful; the absolute count")
    print("  is not. Report bytes as the hard number and tokens as an estimate.")


# --------------------------------------------------------------------- verify

def verify(orig_path: str, min_path: str) -> dict:
    o, m = read(orig_path), read(min_path)
    o_fm, o_body = split_frontmatter(o)
    m_fm, m_body = split_frontmatter(m)
    hard, review, ok = [], [], []

    # 1. Frontmatter is a retrieval key, not documentation.
    if o_fm is None and m_fm is None:
        ok.append("no frontmatter in either file")
    elif o_fm != m_fm:
        if o_fm is None or m_fm is None:
            hard.append("frontmatter block was added or removed entirely")
        else:
            o_keys = dict(re.findall(r"^(\w[\w-]*):(.*)$", o_fm, re.M))
            m_keys = dict(re.findall(r"^(\w[\w-]*):(.*)$", m_fm, re.M))
            for k in sorted(set(o_keys) | set(m_keys)):
                if o_keys.get(k) != m_keys.get(k):
                    tag = "description (SKILL retrieval key)" if k == "description" else k
                    hard.append(f"frontmatter field changed: {tag}")
            if o_fm.strip() != m_fm.strip() and not hard:
                hard.append("frontmatter differs (whitespace/multiline body)")
    else:
        ok.append("frontmatter byte-identical")

    # 2. Fenced blocks are the spec, not a description of it.
    of, mf = fences(o), fences(m)
    missing_f = [f for f in of if f not in mf]
    if missing_f:
        for f in missing_f[:12]:
            head = f.splitlines()[0][:60]
            hard.append(f"fenced block missing or edited (starts `{head}`)")
        if len(missing_f) > 12:
            hard.append(f"... and {len(missing_f) - 12} more altered fenced blocks")
    else:
        ok.append(f"all {len(of)} fenced blocks verbatim")

    # 3. Inline literals: paths, commands, symbols.
    o_spans, m_spans = inline_spans(o), set(inline_spans(m))
    lost_payload = sorted({s for s in o_spans if is_payload(s) and s not in m_spans})
    lost_other = sorted({s for s in o_spans
                         if not is_payload(s) and s not in m_spans})
    for s in lost_payload[:20]:
        hard.append(f"literal dropped: `{s}`")
    if len(lost_payload) > 20:
        hard.append(f"... and {len(lost_payload) - 20} more dropped literals")
    if not lost_payload:
        ok.append("every path/command/symbol literal survives")
    for s in lost_other[:15]:
        review.append(f"inline span gone (non-payload): `{s}`")

    # 4. Bare paths and URLs outside code spans.
    o_urls, m_urls = set(URL_RE.findall(o)), set(URL_RE.findall(m))
    for u in sorted(o_urls - m_urls):
        hard.append(f"URL dropped: {u}")
    o_paths = {p for p in PATHY_RE.findall(strip_fences(o)) if "/" in p and "." in p}
    m_paths = set(PATHY_RE.findall(m))
    for p in sorted(o_paths - m_paths)[:15]:
        review.append(f"bare path no longer present: {p}")

    # 5. Headings are frozen identifiers — other files cite them.
    oh, mh = headings(o), headings(m)
    o_titles = [t for _, t in oh]
    m_titles = [t for _, t in mh]
    for t in o_titles:
        if t not in m_titles:
            hard.append(f"heading missing or renamed: \"{t}\"")
    common = [t for t in o_titles if t in m_titles]
    if common != [t for t in m_titles if t in o_titles]:
        hard.append("heading ORDER changed (position affects salience; "
                    "citations use titles)")
    added = [t for t in m_titles if t not in o_titles]
    for t in added:
        review.append(f"heading added: \"{t}\"")
    if not any(f.startswith("heading") for f in hard):
        ok.append(f"all {len(oh)} headings present, same order")

    # 6. Modality and quantifiers — the smallest words carry the constraint.
    oc, mc = counts(o, MODALS), counts(m, MODALS)
    for w in MODALS:
        od, md = oc[w]["total"], mc[w]["total"]
        if od and md < od:
            review.append(f"modal/quantifier '{w}' {od} -> {md} "
                          f"(-{od - md}); confirm no rule weakened")
        oe, me = oc[w]["emphatic"], mc[w]["emphatic"]
        if oe and me < oe:
            review.append(f"emphatic (uppercase) '{w}' {oe} -> {me}; "
                          "caps carry salience")
    if not any(r.startswith(("modal", "emphatic")) for r in review):
        ok.append("no modal/quantifier lost")
    # Family total: "any" -> "every" is a swap, not a loss. Per-word lines still
    # demand a justification, but the family total says whether universality
    # survived somewhere or genuinely evaporated.
    fam = ["EVERY", "EACH", "ANY", "ALL"]
    of = sum(oc[w]["total"] for w in fam)
    mfam = sum(mc[w]["total"] for w in fam)
    if of:
        if mfam >= of:
            ok.append(f"universal-quantifier family total held ({of} -> {mfam}) "
                      "— per-word deltas above are swaps, confirm each")
        else:
            review.append(f"universal-quantifier family total {of} -> {mfam}: "
                          "universality genuinely reduced, not just reworded")

    # 7. Exception clauses — few tokens, easy to mistake for filler.
    o_exc = lines_matching(strip_fences(o), EXCEPTION_RE)
    m_exc_text = strip_fences(m).lower()
    unmatched = []
    for ln, txt in o_exc:
        probe = EXCEPTION_RE.search(txt)
        key = txt[max(0, probe.start() - 25): probe.end() + 40].lower() if probe else ""
        key_words = [w for w in re.findall(r"[a-z]{4,}", key)]
        if key_words and sum(1 for w in key_words if w in m_exc_text) < max(
                2, len(key_words) // 2):
            unmatched.append((ln, txt))
    for ln, txt in unmatched[:15]:
        review.append(f"exception clause may be gone (orig L{ln}): {txt[:110]}")
    if o_exc and not unmatched:
        ok.append(f"all {len(o_exc)} exception-bearing lines have a counterpart")

    # 8. Negations — a prohibition rewritten as a positive is narrower.
    on = len(NEGATION_RE.findall(strip_fences(o)))
    mn = len(NEGATION_RE.findall(strip_fences(m)))
    if mn < on * 0.85:
        review.append(f"negation words {on} -> {mn}; check no 'never X' became "
                      "'always Y' (that narrows the prohibition)")
    else:
        ok.append(f"negation density held ({on} -> {mn})")

    # 9. Numbered references others cite ("principle 7", "§3.2").
    o_num = set(x.lower().replace(" ", "") for x in NUMREF_RE.findall(strip_fences(o)))
    m_num = set(x.lower().replace(" ", "") for x in NUMREF_RE.findall(strip_fences(m)))
    for n in sorted(o_num - m_num):
        review.append(f"numbered reference no longer present: {n}")

    # 10. Legend, if the file introduces notation (guards dialect drift).
    used = [lab for lab in FIELD_LABELS if lab in m]
    if len(used) >= 2 or "→" in m:
        head = "\n".join(m.splitlines()[:60]).lower()
        if "legend" not in head and "notation" not in head:
            hard.append("minified file uses field/symbol notation but has no "
                        "legend near the top (future hand-edits will drift)")
        else:
            ok.append("notation legend present")

    return {"original": orig_path, "minified": min_path,
            "hard": hard, "review": review, "ok": ok}


def print_verify(v: dict) -> None:
    print(f"verify {v['original']} -> {v['minified']}\n")
    if v["hard"]:
        print(f"HARD ({len(v['hard'])}) — fix before delivering:")
        for f in v["hard"]:
            print(f"  x {f}")
        print()
    if v["review"]:
        print(f"REVIEW ({len(v['review'])}) — justify each in the self-report:")
        for f in v["review"]:
            print(f"  ? {f}")
        print()
    if v["ok"]:
        print("OK:")
        for f in v["ok"]:
            print(f"  . {f}")
    print("\n  Clean checks are necessary, not sufficient: no static check can see")
    print("  a rule that still parses but now means something narrower.")


# ----------------------------------------------------------------------- xref

def walk_files(root: str):
    for dirpath, dirnames, filenames in os.walk(root):
        keep = []
        for d in dirnames:
            if d in (".claude", ".github"):
                keep.append(d)
            elif d not in SKIP_DIRS and not d.startswith("."):
                keep.append(d)
        dirnames[:] = keep
        for fn in filenames:
            if os.path.splitext(fn)[1].lower() in TEXT_EXT:
                yield os.path.join(dirpath, fn)


def slug(title: str) -> str:
    s = re.sub(r"[^\w\s-]", "", title.lower()).strip()
    return re.sub(r"[\s_]+", "-", s)


def xref(path: str, root: str, exclude=()) -> dict:
    text = read(path)
    hs = headings(text)
    target = os.path.abspath(path)
    base = os.path.basename(path)
    cited = {t: [] for _, t in hs if len(t) >= 8}
    hits_per_file = {}
    numrefs = {}
    file_refs = []

    for other in walk_files(root):
        if os.path.abspath(other) == target:
            continue
        rel = os.path.relpath(other, root)
        if any(pat in rel for pat in exclude):
            continue
        try:
            body = read(other)
        except OSError:
            continue
        if base in body or path.replace("./", "") in body:
            file_refs.append(rel)
        low = body.lower()
        for title in cited:
            if title.lower() in low or ("#" + slug(title)) in low:
                cited[title].append(rel)
                hits_per_file[rel] = hits_per_file.get(rel, 0) + 1
        for n in NUMREF_RE.findall(body):
            key = n.lower().replace(" ", "")
            if base.split(".")[0].lower() in low or base in body:
                numrefs.setdefault(key, set()).add(rel)

    # A file that echoes nearly every heading is a copy of the target (a
    # snapshot, a backup, an earlier minified candidate), not a citation.
    # Counting it as a citer makes every heading look frozen by something.
    snapshots = sorted(f for f, n in hits_per_file.items()
                       if len(cited) >= 3 and n >= 0.9 * len(cited))
    if snapshots:
        for title in cited:
            cited[title] = [f for f in cited[title] if f not in snapshots]
        file_refs = [f for f in file_refs if f not in snapshots]

    self_refs = sorted({n.lower().replace(" ", "")
                        for n in NUMREF_RE.findall(strip_fences(text))})
    return {
        "file": path,
        "headings": [t for _, t in hs],
        "cited_headings": {k: v for k, v in cited.items() if v},
        "uncited_headings": [k for k, v in cited.items() if not v],
        "files_referencing_this_file": sorted(set(file_refs)),
        "likely_copies_of_this_file": snapshots,
        "self_numbered_refs": self_refs,
        "external_numbered_refs": {k: sorted(v) for k, v in numrefs.items()},
    }


def print_xref(x: dict) -> None:
    print(f"xref {x['file']}\n")
    print(f"{len(x['headings'])} headings. Headings cited elsewhere are FROZEN "
          "identifiers — renaming, merging or renumbering them dangles the "
          "citation silently.\n")
    if x["cited_headings"]:
        print("CITED BY OTHER FILES (do not rename/reorder/merge):")
        for t, files in sorted(x["cited_headings"].items()):
            print(f"  \"{t}\"\n      <- {', '.join(files[:6])}"
                  + (" ..." if len(files) > 6 else ""))
    else:
        print("No heading of this file is cited by title elsewhere under root.")
    if x["likely_copies_of_this_file"]:
        print("\nIGNORED (echo nearly every heading — copies/snapshots, not "
              "citations):")
        for f in x["likely_copies_of_this_file"][:10]:
            print(f"  {f}")
    if x["files_referencing_this_file"]:
        print("\nFILES THAT POINT AT THIS FILE (they may describe its structure):")
        for f in x["files_referencing_this_file"][:25]:
            print(f"  {f}")
    if x["self_numbered_refs"]:
        print("\nNUMBERED REFERENCES INSIDE THIS FILE (numbering is frozen):")
        print("  " + ", ".join(x["self_numbered_refs"]))
    if x["external_numbered_refs"]:
        print("\nNUMBERED REFERENCES ELSEWHERE THAT MAY POINT HERE:")
        for k, v in sorted(x["external_numbered_refs"].items()):
            print(f"  {k} <- {', '.join(v[:5])}")
    print("\n  Matching is deliberately over-inclusive — a short generic title "
          "like\n  \"Architecture\" matches that word anywhere. Confirm each hit "
          "before\n  acting on it. And a heading with no citation is still not "
          "free to move:\n  position affects attention, so reordering needs a "
          "reason of its own.")


# ----------------------------------------------------------------- exceptions

def exceptions(path: str) -> dict:
    text = strip_fences(read(path))
    return {"file": path,
            "clauses": [{"line": ln, "text": t}
                        for ln, t in lines_matching(text, EXCEPTION_RE)]}


def print_exceptions(e: dict) -> None:
    print(f"{len(e['clauses'])} exception/carve-out clauses in {e['file']}")
    print("Each must survive minification as its own EXCEPT: field or inline "
          "clause.\n")
    for c in e["clauses"]:
        print(f"  L{c['line']:>4}  {c['text'][:150]}")


# --------------------------------------------------------------------- report

def report(orig: str, mini: str, root: str) -> dict:
    d = measure(orig, mini)
    v = verify(orig, mini)
    print("### Measured reduction\n")
    print(f"- bytes: {d['bytes']['orig']} -> {d['bytes']['min']} "
          f"(**{fmt_delta(d['bytes']['delta_pct'])}**)")
    print(f"- est. tokens: {d['est_tokens']['orig']} -> {d['est_tokens']['min']} "
          f"(**{fmt_delta(d['est_tokens']['delta_pct'])}**) — heuristic sub-word "
          "proxy, no Claude tokenizer available; ratio is meaningful, absolute "
          "count is not")
    if "tiktoken_cl100k" in d:
        t = d["tiktoken_cl100k"]
        print(f"- tiktoken cl100k: {t['orig']} -> {t['min']} "
              f"({fmt_delta(t['delta_pct'])}) — different tokenizer than "
              "Claude's, still only a proxy")
    print(f"- lines: {d['lines']['orig']} -> {d['lines']['min']}")
    print("\n### Invariant checks\n")
    if not v["hard"]:
        print("- HARD: none")
    else:
        print(f"- HARD ({len(v['hard'])}):")
        for f in v["hard"]:
            print(f"  - {f}")
    if v["review"]:
        print(f"- REVIEW ({len(v['review'])}):")
        for f in v["review"]:
            print(f"  - {f}")
    print(f"- passed: {'; '.join(v['ok'])}")
    print("\n_Static checks only. They cannot see a rule that still parses but "
          "now means something narrower — that is what the human review list "
          "and the eval harness are for._")
    return v


# ------------------------------------------------------------------------ cli

def main(argv) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    cmd = argv[1]
    args, excludes = [], []
    as_json = False
    root = "."
    rest = argv[2:]
    i = 0
    while i < len(rest):
        a = rest[i]
        if a == "--json":
            as_json = True
        elif a == "--root" and i + 1 < len(rest):
            i += 1
            root = rest[i]
        elif a == "--exclude" and i + 1 < len(rest):
            i += 1
            excludes.append(rest[i])
        elif a.startswith("--"):
            print(f"unknown option: {a}")
            return 2
        else:
            args.append(a)
        i += 1

    try:
        if cmd == "measure":
            if len(args) != 2:
                print("usage: minify-check.py measure ORIG MIN"); return 2
            d = measure(*args)
            print(json.dumps(d, indent=2) if as_json else "", end="")
            if not as_json:
                print_measure(d)
            return 0
        if cmd == "verify":
            if len(args) != 2:
                print("usage: minify-check.py verify ORIG MIN"); return 2
            v = verify(*args)
            if as_json:
                print(json.dumps(v, indent=2))
            else:
                print_verify(v)
            return 1 if v["hard"] else 0
        if cmd == "xref":
            if len(args) != 1:
                print("usage: minify-check.py xref FILE [--root DIR] "
                      "[--exclude SUBSTR ...]"); return 2
            x = xref(args[0], root, tuple(excludes))
            if as_json:
                print(json.dumps(x, indent=2))
            else:
                print_xref(x)
            return 0
        if cmd == "exceptions":
            if len(args) != 1:
                print("usage: minify-check.py exceptions FILE"); return 2
            e = exceptions(args[0])
            if as_json:
                print(json.dumps(e, indent=2))
            else:
                print_exceptions(e)
            return 0
        if cmd == "report":
            if len(args) != 2:
                print("usage: minify-check.py report ORIG MIN [--root DIR]")
                return 2
            return 1 if report(args[0], args[1], root)["hard"] else 0
    except FileNotFoundError as exc:
        print(f"error: {exc}")
        return 2
    print(f"unknown command: {cmd}\n{__doc__}")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
