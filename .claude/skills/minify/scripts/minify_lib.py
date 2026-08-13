#!/usr/bin/env python3
"""
minify_lib.py — deterministic instrumentation for the `/minify` skill.

Python stdlib only. No model calls, no network. Every number this module
reports is reproducible from the two input files alone.

What lives here
---------------
1. Document model      — frontmatter split, byte-frozen verbatim zones, units.
2. Metrics             — bytes/lines, verbatim fraction, function-word ratio,
                         two independent token proxies.
3. Content classes     — C1..C7 taxonomy + per-class compression budgets.
4. Constraint inventory— enumerate every constraint / exception / quantifier /
                         verbatim span / numeric / reference / enumeration.
5. Survival check      — map each inventory item into the minified file.
6. Reference graph     — edge preservation + (optionally) resolution.
7. Verdicts            — `size` and `structure`, emitted separately, never
                         merged into a single number.

Measurement definitions follow the Appendix of
`.claude/minify-lab/research-encoding-formats.md` so numbers stay comparable
with the phase-1 probes.
"""

from __future__ import annotations

import hashlib
import math
import os
import re
import unicodedata
from dataclasses import dataclass, field, asdict
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

# ---------------------------------------------------------------------------
# 0. Fixed vocabularies (frozen — changing these changes every reported number)
# ---------------------------------------------------------------------------

#: Fixed 84-word English function-word list (research Appendix definition).
FUNCTION_WORDS: Set[str] = set("""
a about after all also an and any are as at be because been before being but by
can could did do does each either else every for from had has have how if in
into is it its may might must never no nor not of on only or other out over
shall should so some such than that the their them then there these they this
those to unless was we were what when where which while who will with would you
""".split())
assert len(FUNCTION_WORDS) == 84, f"function-word list must stay at 84 words, got {len(FUNCTION_WORDS)}"

#: Modality ladder. Strength is what may not be weakened; polarity is separate.
MODALITY_STRENGTH = {"MUST": 3, "NEVER": 3, "SHOULD": 2, "MAY": 1, None: 0}

#: Modality detection. TRB field labels at line start are first-class carriers:
#: `NEVER`/`MUST NOT` -> NEVER, `MUST`/`DO`/`GATE`/`RULE` -> MUST, `EXC` -> MAY.
_MODALITY_PATTERNS: Sequence[Tuple[str, re.Pattern]] = (
    ("NEVER", re.compile(
        r"\b(?:must\s+not|shall\s+not|may\s+not|cannot|can't|do\s+not|don't|never|"
        r"forbidden|prohibited|disallowed|banned|refuse)\b|❌"
        r"|^\s*(?:NEVER|MUST NOT)\b", re.I | re.M)),
    ("MUST", re.compile(
        r"\b(?:must|shall|required|require|requires|mandatory|non-negotiable|"
        r"always|hard\s+rule|hard-gate|hard\s+gate|obligatory|has\s+to|have\s+to)\b|✅"
        r"|^\s*(?:MUST|DO|GATE|RULE|TEST|TIE|STOP)\b", re.I | re.M)),
    ("SHOULD", re.compile(
        r"\b(?:should|prefer|preferred|recommend|recommended|advisable|"
        r"expected\s+to)\b|^\s*SHOULD\b", re.I | re.M)),
    ("MAY", re.compile(r"\b(?:may|permitted|allowed|optional|at\s+your\s+discretion)\b"
                       r"|^\s*(?:MAY|EXC)\b", re.I | re.M)),
)

_NEGATIVE_MARKER = re.compile(
    r"(?i)\b(?:not|never|no|nor|without|neither|none|avoid|forbidden|prohibited|"
    r"disallowed|refuse|don't|doesn't|isn't|won't|cannot|can't)\b|❌")

#: Hedges. A hedged statement that becomes MUST/NEVER is R15 (hard-rule collapse).
_HEDGE = re.compile(
    r"(?i)\b(?:heuristic|not\s+a\s+hard|rule\s+of\s+thumb|typically|generally|usually|"
    r"ideally|when\s+possible|where\s+possible|aim\s+to|try\s+to|by\s+default|"
    r"as\s+a\s+default|suggest|suggested|roughly|prefer|preferably|in\s+principle)\b")

#: Quantifier families. Key -> alternatives that count as carrying the same force.
QUANTIFIERS: Dict[str, re.Pattern] = {
    "any":        re.compile(r"(?i)\bany\b|∨|\beither\b|\bat\s+least\s+one\b"),
    "all":        re.compile(r"(?i)\ball\b|\bevery\b|\beach\b|∀|\bwhole\b|\bentire\b"),
    # `AND` only counts as a conjunction quantifier in its explicit upper-case
    # form — lower-case "and" is ordinary prose and would match everything.
    "both":       re.compile(r"(?i)\bboth\b|∧|(?-i:\bAND\b)"),
    "only":       re.compile(r"(?i)\bonly\b|\bsolely\b|\bexclusively\b|\bnothing\s+else\b"),
    "always":     re.compile(r"(?i)\balways\b|\bevery\s+time\b|\bpermanent\b|∀"),
    "never":      re.compile(r"(?i)\bnever\b|\bnot\s+once\b|\bat\s+no\s+point\b|❌"),
    "regardless": re.compile(r"(?i)\bregardless\b|\birrespective\b|\bwhichever\b|\beither\s+way\b"),
    "except":     re.compile(r"(?i)\bexcept\b|\bunless\b|\bother\s+than\b|\bapart\s+from\b|"
                             r"\bcarve-?out\b|\bexception\b|\bEXC\b|\bexempt\b"),
    "atleast":    re.compile(r"(?i)\bat\s+least\b|≥|>="),
    "atmost":     re.compile(r"(?i)\bat\s+most\b|≤|<=|\bno\s+more\s+than\b"),
    "neither":    re.compile(r"(?i)\bneither\b|\bnor\b|\bnone\s+of\b"),
}

#: Quantifiers whose loss changes a rule's scope. Dropping one is a hard failure.
SCOPE_QUANTIFIERS = frozenset({"any", "all", "both", "only", "always", "never",
                               "regardless", "except", "neither"})

_CONDITIONAL = re.compile(
    r"(?i)\b(?:if|when|whenever|unless|once|in\s+case|provided\s+that|as\s+soon\s+as|"
    r"before|after|until|WHEN|GATE|TEST|ELSE)\b|⇒|→(?!\s*$)")

_EXAMPLE = re.compile(r"(?i)\b(?:e\.g\.|for\s+example|for\s+instance|such\s+as|worked\s+example|i\.e\.)\b")

#: TRB field labels (see references/trb-format.md). Used to recognise rule blocks.
TRB_FIELDS = ("WHEN", "SCOPE", "MUST", "MUST NOT", "NEVER", "SHOULD", "MAY", "DO",
              "EXC", "WHY", "TEST", "REF", "EVID", "GATE", "ELSE", "TIE", "NOTE",
              "RULE", "PATH")
_TRB_LINE = re.compile(r"^(?:" + "|".join(re.escape(f) for f in sorted(TRB_FIELDS, key=len, reverse=True)) + r")\b")

# ---------------------------------------------------------------------------
# 1. Document model
# ---------------------------------------------------------------------------

_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z`*#§⇒✅❌§“\"(])")
_LIST_ITEM = re.compile(r"^\s{0,6}(?:[-*+·]|\d+[.)])\s+")
_HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
_TABLE_ROW = re.compile(r"^\s*\|.*\|\s*$")

FENCE_PLACEHOLDER = "\x00F{}\x00"
CODE_PLACEHOLDER = "\x00c{}\x00"
_PLACEHOLDER_RE = re.compile(r"\x00[Fc](\d+)\x00")


@dataclass
class Verbatim:
    """A byte-frozen span. Budget = 0%.

    Five kinds, all equally frozen: `fence`, `inline` (code), `url` (bare or
    autolinked), `linkdest` (the destination inside `[text](dest)`), and
    `linkdef` (a `[label]: url` reference-definition line). URLs and link
    machinery are not prose — you cannot reword a URL — and counting them as
    compressible badly misreads how much of a file is actually available.
    """
    vid: str
    kind: str
    text: str          # exact bytes, fence markers excluded for fences
    raw: str           # exact bytes including fence/backtick/paren markers
    line: int


#: Kinds that make up the narrow `verbatim_fraction` (phase-1 definition).
CODE_KINDS = ("fence", "inline")
#: Kinds added by the extended `frozen_fraction`.
LINK_KINDS = ("url", "linkdest", "linkdef")


@dataclass
class Unit:
    """One addressable chunk of prose: list item, table row, sentence, TRB line."""
    uid: str
    line: int
    kind: str          # heading | list | table | trb | para
    text: str          # masked text (verbatim spans replaced by placeholders)
    raw: str           # text with verbatim spans restored
    section: str       # nearest enclosing heading title ("" at file top)
    ordinal: Optional[int] = None   # for ordered list items


@dataclass
class Doc:
    path: str
    text: str
    frontmatter: Optional[str]
    frontmatter_map: Dict[str, str]
    body: str
    body_offset: int               # line number where body starts (1-based)
    masked: str                    # body with verbatim spans replaced
    verbatims: List[Verbatim]
    units: List[Unit]
    headings: List[Tuple[int, int, str]]   # (line, level, title)

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.text.encode("utf-8")).hexdigest()


def _split_frontmatter(text: str) -> Tuple[Optional[str], str, int]:
    if not text.startswith("---\n"):
        return None, text, 1
    end = text.find("\n---", 3)
    if end == -1:
        return None, text, 1
    nl = text.find("\n", end + 1)
    if nl == -1:
        nl = len(text)
    fm = text[: nl + 1]
    body = text[nl + 1:]
    return fm, body, fm.count("\n") + 1


def _parse_frontmatter(fm: Optional[str]) -> Dict[str, str]:
    """Minimal YAML-ish reader: top-level `key: value`, folded/literal blocks."""
    out: Dict[str, str] = {}
    if not fm:
        return out
    lines = fm.split("\n")[1:]          # skip opening ---
    key = None
    buf: List[str] = []
    for ln in lines:
        if ln.strip() == "---":
            break
        m = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", ln)
        if m:
            if key is not None:
                out[key] = "\n".join(buf).strip()
            key, first = m.group(1), m.group(2)
            buf = [] if first in (">", ">-", "|", "|-", "") else [first]
        elif key is not None:
            buf.append(ln.strip())
    if key is not None:
        out[key] = "\n".join(buf).strip()
    return out


def _extract_verbatims(body: str) -> Tuple[str, List[Verbatim]]:
    """Replace fenced blocks and inline-code spans with placeholders.

    Line numbering is preserved exactly so every reported line number is real.
    """
    verbatims: List[Verbatim] = []
    lines = body.split("\n")
    out: List[str] = []
    i = 0
    fence_re = re.compile(r"^\s*(```+|~~~+)")
    while i < len(lines):
        m = fence_re.match(lines[i])
        if m:
            marker = m.group(1)
            start = i
            body_lines: List[str] = []
            j = i + 1
            while j < len(lines) and not re.match(r"^\s*" + re.escape(marker) + r"\s*$", lines[j]):
                body_lines.append(lines[j])
                j += 1
            closed = j < len(lines)
            raw = "\n".join(lines[start: j + 1 if closed else j])
            vid = f"V{len(verbatims) + 1:03d}"
            verbatims.append(Verbatim(vid, "fence", "\n".join(body_lines), raw, start + 1))
            out.append(FENCE_PLACEHOLDER.format(len(verbatims)))
            out.extend([""] * ((j if closed else j - 1) - start))   # keep line count
            i = j + 1 if closed else j
            continue
        out.append(lines[i])
        i += 1

    masked = "\n".join(out)

    def _freezer(kind: str, group: str):
        def _sub(m: re.Match) -> str:
            line = masked_ref[0][: m.start()].count("\n") + 1
            vid = f"V{len(verbatims) + 1:03d}"
            verbatims.append(Verbatim(vid, kind, m.group(group), m.group(0), line))
            return CODE_PLACEHOLDER.format(len(verbatims))
        return _sub

    masked_ref = [masked]
    for kind, rx, grp in (
            # inline code spans (runs of N backticks), on the fence-masked text
            ("inline", re.compile(r"(?P<t>`+)(?P<c>[^`]+?)(?P=t)"), "c"),
            # link-reference definitions:  [label]: https://example/x "title"
            ("linkdef", re.compile(r"^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*(?P<c>\S+)"
                                   r"(?:[ \t]+\"[^\"\n]*\")?[ \t]*$", re.M), "c"),
            # destination inside [text](dest)
            ("linkdest", re.compile(r"\]\((?P<c>[^)\s]+)(?:[ \t]+\"[^\"\n]*\")?\)"), "c"),
            # autolinks and bare URLs
            ("url", re.compile(r"<(?P<c>(?:https?|mailto|ftp)://[^>\s]+)>"), "c"),
            ("url", re.compile(r"(?<![\w(<])(?P<c>(?:https?://|www\.)[^\s<>\)\]\"'`]+)"), "c"),
    ):
        masked_ref[0] = masked
        masked = rx.sub(_freezer(kind, grp), masked)
    return masked, verbatims


def _restore(masked_text: str, verbatims: List[Verbatim]) -> str:
    def _sub(m: re.Match) -> str:
        idx = int(m.group(1)) - 1
        return verbatims[idx].raw if 0 <= idx < len(verbatims) else ""
    return _PLACEHOLDER_RE.sub(_sub, masked_text)


def _units(masked: str, verbatims: List[Verbatim], line_offset: int) -> Tuple[List[Unit], List[Tuple[int, int, str]]]:
    units: List[Unit] = []
    headings: List[Tuple[int, int, str]] = []
    section = ""
    para: List[Tuple[int, str]] = []

    def flush_para() -> None:
        nonlocal para
        if not para:
            return
        first_line = para[0][0]
        joined = " ".join(t for _, t in para).strip()
        for s in _SENT_SPLIT.split(joined):
            s = s.strip()
            if s:
                units.append(Unit(f"U{len(units)+1:03d}", first_line, "para", s,
                                  _restore(s, verbatims), section))
        para = []

    for idx, ln in enumerate(masked.split("\n")):
        lineno = idx + line_offset
        stripped = ln.strip()
        hm = _HEADING.match(ln)
        if hm:
            flush_para()
            title = _restore(hm.group(2), verbatims).strip()
            headings.append((lineno, len(hm.group(1)), title))
            section = title
            units.append(Unit(f"U{len(units)+1:03d}", lineno, "heading", hm.group(2),
                              title, section))
            continue
        if not stripped:
            flush_para()
            continue
        if _TABLE_ROW.match(ln):
            flush_para()
            units.append(Unit(f"U{len(units)+1:03d}", lineno, "table", stripped,
                              _restore(stripped, verbatims), section))
            continue
        lm = _LIST_ITEM.match(ln)
        if lm:
            flush_para()
            om = re.match(r"^\s{0,6}(\d+)[.)]\s+", ln)
            units.append(Unit(f"U{len(units)+1:03d}", lineno, "list", stripped,
                              _restore(stripped, verbatims), section,
                              int(om.group(1)) if om else None))
            continue
        if _TRB_LINE.match(stripped):
            flush_para()
            units.append(Unit(f"U{len(units)+1:03d}", lineno, "trb", stripped,
                              _restore(stripped, verbatims), section))
            continue
        if _PLACEHOLDER_RE.fullmatch(stripped):
            flush_para()
            continue
        para.append((lineno, stripped))
    flush_para()
    return units, headings


def load(path: str) -> Doc:
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()
    return parse(text, path)


def parse(text: str, path: str = "<memory>") -> Doc:
    fm, body, offset = _split_frontmatter(text)
    masked, verbatims = _extract_verbatims(body)
    units, headings = _units(masked, verbatims, offset)
    return Doc(path=path, text=text, frontmatter=fm, frontmatter_map=_parse_frontmatter(fm),
               body=body, body_offset=offset, masked=masked, verbatims=verbatims,
               units=units, headings=headings)


# ---------------------------------------------------------------------------
# 2. Metrics
# ---------------------------------------------------------------------------

def _words(text: str) -> List[str]:
    return re.findall(r"[A-Za-z][A-Za-z'-]*", text)


def function_word_ratio(doc: Doc) -> float:
    """Share of alphabetic word tokens that are function words.

    Definition (research Appendix): computed after stripping fenced blocks and
    replacing inline-code spans with a placeholder — i.e. on `doc.masked`.
    ~44% is ordinary English prose; <30% means already-telegraphic input.
    """
    toks = [w.lower() for w in _words(_PLACEHOLDER_RE.sub(" ", doc.masked))]
    if not toks:
        return 0.0
    return 100.0 * sum(1 for w in toks if w in FUNCTION_WORDS) / len(toks)


def verbatim_fraction(doc: Doc) -> float:
    """Narrow definition: bytes inside fences + inline-code spans, / file bytes.

    Kept because phase-1's published per-file numbers use it. For anything that
    decides how much of a file is *available* to compress, use `frozen_fraction`.
    """
    total = len(doc.text.encode("utf-8"))
    if not total:
        return 0.0
    vb = sum(len(v.raw.encode("utf-8")) for v in doc.verbatims if v.kind in CODE_KINDS)
    return 100.0 * vb / total


def frozen_fraction(doc: Doc) -> float:
    """Extended definition: code spans PLUS URLs, link destinations, link defs.

    This is the fraction the yield prediction uses. Measured effect of the
    extension on a link-heavy real file: 5.0% -> 37.5% frozen.
    """
    total = len(doc.text.encode("utf-8"))
    if not total:
        return 0.0
    vb = sum(len(v.raw.encode("utf-8")) for v in doc.verbatims)
    return 100.0 * vb / total


def tokens_wordpunct(text: str) -> int:
    """Proxy A — structural. Words split at ~4.5 chars, punctuation/digits single."""
    n = 0
    for tok in re.findall(r"[A-Za-z]+|\d+|[^\sA-Za-z\d]", text):
        if tok[0].isalpha():
            n += max(1, math.ceil(len(tok) / 4.5))
        elif tok[0].isdigit():
            n += max(1, math.ceil(len(tok) / 3.0))
        else:
            n += 1
    return n


def tokens_byterate(text: str) -> int:
    """Proxy B — byte-based, independent of proxy A's segmentation."""
    return max(1, round(len(text.encode("utf-8")) / 4.0))


def file_metrics(doc: Doc) -> Dict[str, float]:
    return {
        "bytes": len(doc.text.encode("utf-8")),
        "lines": doc.text.count("\n") + (0 if doc.text.endswith("\n") else 1),
        "verbatim_fraction_pct": round(verbatim_fraction(doc), 2),
        "frozen_fraction_pct": round(frozen_fraction(doc), 2),
        "function_word_ratio_pct": round(function_word_ratio(doc), 2),
        "tokens_wordpunct": tokens_wordpunct(doc.text),
        "tokens_byterate": tokens_byterate(doc.text),
        "frozen_spans": {k: sum(1 for v in doc.verbatims if v.kind == k)
                         for k in CODE_KINDS + LINK_KINDS},
    }


# --- yield prediction -------------------------------------------------------
#
# `expected_reduction = (1 - frozen_fraction) x prose_rate(function_word_ratio)`.
#
# `prose_rate` bands are calibrated on 9 measured hand-minification probes (5
# from the phase-1 study on this repo's files, 4 from the normal-density
# corroboration study on public instruction files), each at 100% constraint
# survival. Both source studies used their own function-word list; their probe
# values are shifted onto THIS module's list before banding (+7.8 for phase 1,
# +2.9 for the corroboration study, from the three files all three instruments
# measured). Bands are wide on purpose: rewriting technique moved the observed
# rate by more than 3x at constant density, so a point estimate would be false
# precision.
PROSE_RATE_BANDS: Sequence[Tuple[float, float, float]] = (
    # (min function-word ratio, low rate %, high rate %)
    (45.0, 24.0, 35.0),   # verbose normative prose
    (40.0, 12.0, 30.0),
    (35.0, 5.0, 26.0),
    (30.0, 0.0, 16.0),    # already-telegraphic
    (0.0, 0.0, 12.0),     # extrapolation — no probe observed below here
)


def prose_rate(fw_pct: float) -> Tuple[float, float]:
    for lo_fw, lo, hi in PROSE_RATE_BANDS:
        if fw_pct >= lo_fw:
            return lo, hi
    return 0.0, 12.0


def predict_reduction(doc: Doc) -> Dict[str, object]:
    """Predict what THIS file can give up, before any of it is rewritten."""
    fz = frozen_fraction(doc)
    fw = function_word_ratio(doc)
    lo, hi = prose_rate(fw)
    avail = 1.0 - fz / 100.0
    return {
        "frozen_fraction_pct": round(fz, 1),
        "function_word_ratio_pct": round(fw, 1),
        "prose_rate_band_pct": [lo, hi],
        "predicted_cut_pct": [round(avail * lo, 1), round(avail * hi, 1)],
        "extrapolated": fw < 30.0,
        "basis": "(1 - frozen_fraction) x prose_rate(function-word ratio); "
                 "bands from 9 measured probes at 100% constraint survival",
    }


# ---------------------------------------------------------------------------
# 3. Content classes C1..C7 and their budgets
# ---------------------------------------------------------------------------

#: (label, min_cut_pct, max_cut_pct, risk) — from research §2.
CLASS_BUDGET: Dict[str, Tuple[str, float, float, str]] = {
    "C1": ("verbatim invariants",          0.0,  0.0, "critical"),
    "C2": ("routing / lookup tables",      0.0,  5.0, "high"),
    "C3": ("hard constraints",            10.0, 15.0, "high"),
    "C4": ("sequential procedures & gates", 10.0, 15.0, "medium-high"),
    "C5": ("conditional triage / booleans", 5.0, 10.0, "critical"),
    "C6": ("rationale & war stories",     10.0, 20.0, "critical"),
    "C7": ("orientation / background",    20.0, 30.0, "low"),
}

_C3_HINT = re.compile(r"(?i)critical|non-negotiable|mandatory|hard rule|must|never|do not|❌|✅|forbidden")
_C4_HINT = re.compile(r"(?i)\bphase\b|\bstep\b|\bstage\b|\bgate\b|\bbefore committing\b|\bthen\b|\bfirst\b|\border\b|\bpipeline\b")
_C6_HINT = re.compile(r"(?i)\bwhy\b|\bbecause\b|\bmeasured\b|\brationale\b|\bhistory\b|\bin one sprint\b|"
                      r"\bhas actually\b|\bcame from\b|\bEVID\b|\$\d|\bthe point\b|\bso that\b|\botherwise\b")


def classify_unit(u: Unit) -> str:
    """Assign one content class to a unit. Deterministic, order matters."""
    if u.kind == "table":
        return "C2"
    text = u.raw
    quant_hits = sum(1 for k, rx in QUANTIFIERS.items() if rx.search(text))
    cond = bool(_CONDITIONAL.search(text))
    if cond and quant_hits >= 2:
        return "C5"
    if _C3_HINT.search(text) and modality_of(text)[0] is not None:
        return "C3"
    if _C4_HINT.search(text) and (u.ordinal is not None or u.kind in ("list", "heading")):
        return "C4"
    if _C6_HINT.search(text):
        return "C6"
    if modality_of(text)[0] is not None:
        return "C3"
    return "C7"


def budget_plan(doc: Doc) -> Dict[str, object]:
    """Per-section, per-class byte budget. The anti-flat-ratio instrument."""
    per_class: Dict[str, int] = {k: 0 for k in CLASS_BUDGET}
    per_section: Dict[str, Dict[str, int]] = {}
    for u in doc.units:
        if u.kind == "heading":
            continue
        cls = classify_unit(u)
        b = len(u.raw.encode("utf-8"))
        per_class[cls] += b
        per_section.setdefault(u.section or "(file top)", {}).setdefault(cls, 0)
        per_section[u.section or "(file top)"][cls] += b
    frozen = sum(len(v.raw.encode("utf-8")) for v in doc.verbatims)
    per_class["C1"] += frozen

    lo = sum(b * CLASS_BUDGET[c][1] / 100.0 for c, b in per_class.items())
    hi = sum(b * CLASS_BUDGET[c][2] / 100.0 for c, b in per_class.items())
    total = len(doc.text.encode("utf-8"))
    return {
        "bytes": total,
        "per_class_bytes": per_class,
        "per_section_bytes": per_section,
        "allowed_cut_bytes": (round(lo), round(hi)),
        "allowed_cut_pct": (round(100.0 * lo / total, 1) if total else 0.0,
                            round(100.0 * hi / total, 1) if total else 0.0),
    }


# ---------------------------------------------------------------------------
# 4. Constraint inventory
# ---------------------------------------------------------------------------

def modality_of(text: str) -> Tuple[Optional[str], bool]:
    """Return (modality, is_negative). MUST NOT / NEVER collapse to NEVER."""
    for label, rx in _MODALITY_PATTERNS:
        if rx.search(text):
            return label, bool(_NEGATIVE_MARKER.search(text)) or label == "NEVER"
    return None, bool(_NEGATIVE_MARKER.search(text))


def quantifiers_of(text: str) -> List[str]:
    return sorted(k for k, rx in QUANTIFIERS.items() if rx.search(text))


_NUMERIC = re.compile(
    r"(?:[~≈≥≤><]\s*)?\$?\d[\d,]*(?:\.\d+)?"
    r"(?:\s*[–—-]\s*\$?\d[\d,]*(?:\.\d+)?)?"
    r"\s*(?:%|×|x\b|K\b|M\b|G\b|B\b|KB|MB|GB|px|ms\b|s\b|pts?\b|tokens?\b|lines?\b|turns?\b)?")

_APPROX = re.compile(r"[~≈]|\b(?:approx\.?|approximately|about|roughly|around)\b")


def _normalise_numeric(raw: str) -> str:
    """Canonical numeric identity: approx-flag + digits + unit, whitespace-free.

    `~10–37K tokens` and `≈10–37K tokens` are the same operator; `10–37K` alone
    is NOT (the approximation marker was dropped — a changed rule, R16).
    """
    approx = "~" if _APPROX.search(raw) else ""
    core = _APPROX.sub("", raw)
    core = unicodedata.normalize("NFKC", core)
    core = core.replace("—", "-").replace("–", "-").replace(",", "")
    core = re.sub(r"\s+", "", core).lower()
    return approx + core


_REF_PATTERNS: Sequence[Tuple[str, re.Pattern]] = (
    ("section", re.compile(r"§\s?\d+(?:\s*[–—-]\s*§?\s?\d+)?")),
    ("ordinal", re.compile(r"(?i)\b(?:principle|phase|step|stage|rule|item|point)\s+\d+[a-z]?\b")),
    ("link", re.compile(r"\]\(([^)\s]+)\)")),
    ("path", re.compile(r"\b[\w.@-]+(?:/[\w.@-]+)+(?:\.\w+)?/?|\b[\w-]+\.(?:md|py|jsx|js|mjs|cjs|json|txt|html|sh|ya?ml|toml)\b")),
    # single-asterisk italics only — `**bold**` is emphasis, not a citation
    ("emphasised-title", re.compile(r"(?<![\w*])\*([A-Z][^*\n]{4,70})\*(?![\w*])")),
)


def _refs_in(text: str) -> List[Tuple[str, str]]:
    out: List[Tuple[str, str]] = []
    for kind, rx in _REF_PATTERNS:
        for m in rx.finditer(text):
            val = m.group(1) if m.lastindex else m.group(0)
            out.append((kind, re.sub(r"\s+", " ", val).strip()))
    return out


def _stem(w: str) -> str:
    """Light inflection stripper so `bodies`/`body` and `titles`/`title` match."""
    w = w.lower()
    for suf, rep in (("ies", "y"), ("ing", ""), ("ed", ""), ("es", ""), ("s", "")):
        if len(w) > len(suf) + 2 and w.endswith(suf):
            return w[: len(w) - len(suf)] + rep
    return w


def _keys_of(text: str) -> Set[str]:
    """Distinctive content tokens used to locate a constraint after minification."""
    plain = re.sub(r"[*_`#>]", " ", text)
    toks = {_stem(w) for w in _words(plain) if len(w) >= 4 and w.lower() not in FUNCTION_WORDS}
    toks |= {_normalise_numeric(m.group(0)) for m in _NUMERIC.finditer(text) if any(ch.isdigit() for ch in m.group(0))}
    return toks


_PAREN = re.compile(r"\(([^()]{25,400})\)")
_EXC_CLAUSE = re.compile(
    r"(?i)(?:except|unless|other\s+than|apart\s+from|the\s+one\s+exception|"
    r"carve-?out|but\s+not|save\s+for)\b([^.;]{15,300})")

GLOSS_COVERAGE = 0.60


def _glosses(doc: Doc) -> List[Dict[str, object]]:
    """Sub-clause spans that die first under compression (research R2, R13).

    Parentheticals and `except/unless/...` clauses are grammatically subordinate,
    so a whole-sentence key-coverage check can lose one without noticing. Each is
    tracked as its own atom with its own survival threshold.
    """
    out: List[Dict[str, object]] = []
    for u in doc.units:
        if u.kind == "heading":
            continue
        for rx, kind in ((_PAREN, "parenthetical"), (_EXC_CLAUSE, "exception-clause")):
            for m in rx.finditer(u.raw):
                body = m.group(1).strip()
                keys = _keys_of(body)
                if len(keys) >= 3:
                    out.append({"id": f"G{len(out)+1:03d}", "kind": kind, "line": u.line,
                                "text": body[:200], "keys": sorted(keys)})
    return out


@dataclass
class Constraint:
    cid: str
    kind: str                     # obligation | prohibition | permission | default |
                                  # conditional | exception | enumeration | statement
    modality: Optional[str]
    negative: bool
    hedged: bool
    quantifiers: List[str]
    line: int
    section: str
    cls: str
    text: str
    keys: List[str]
    verbatims: List[str]          # exact spans this constraint depends on
    numerics: List[str]           # canonical numeric identities
    refs: List[List[str]]         # [kind, value]
    examples: int
    enum_items: List[str] = field(default_factory=list)


def _kind_for(mod: Optional[str], neg: bool, hedged: bool, quants: List[str], text: str) -> str:
    if "except" in quants:
        return "exception"
    if mod == "NEVER" or (neg and mod == "MUST"):
        return "prohibition"
    if mod == "MUST":
        return "obligation"
    if mod == "SHOULD" or hedged:
        return "default"
    if mod == "MAY":
        return "permission"
    if _CONDITIONAL.search(text) and quants:
        return "conditional"
    if quants:
        return "quantified"
    return "statement"


def _enum_items(u: Unit) -> List[str]:
    """Identity of each member of an in-line enumeration (>=3 code spans or list)."""
    spans = re.findall(r"`([^`]+)`", u.raw)
    if len(spans) >= 3:
        return spans
    return []


def inventory(doc: Doc, include_statements: bool = False) -> Dict[str, object]:
    """Enumerate every constraint / exception / quantifier / atom in `doc`.

    This runs BEFORE minification. Its output is the contract the minified file
    must satisfy — see `survival()`.
    """
    constraints: List[Constraint] = []
    for u in doc.units:
        if u.kind == "heading":
            continue
        text = u.raw
        mod, neg = modality_of(text)
        quants = quantifiers_of(text)
        hedged = bool(_HEDGE.search(text))
        interesting = (mod is not None or bool(set(quants) & SCOPE_QUANTIFIERS)
                       or _CONDITIONAL.search(text) or hedged)
        if not interesting and not include_statements:
            continue
        keys = _keys_of(text)
        if not keys:
            continue
        constraints.append(Constraint(
            cid=f"K{len(constraints)+1:03d}",
            kind=_kind_for(mod, neg, hedged, quants, text),
            modality=mod, negative=neg, hedged=hedged, quantifiers=quants,
            line=u.line, section=u.section, cls=classify_unit(u), text=text,
            keys=sorted(keys),
            verbatims=re.findall(r"`+([^`]+)`+", text),
            numerics=sorted({_normalise_numeric(m.group(0))
                             for m in _NUMERIC.finditer(re.sub(r"`[^`]*`", " ", text))
                             if any(ch.isdigit() for ch in m.group(0))}),
            refs=[list(r) for r in _refs_in(text)],
            examples=len(_EXAMPLE.findall(text)),
            enum_items=_enum_items(u),
        ))

    glosses = _glosses(doc)
    all_numerics = sorted({_normalise_numeric(m.group(0))
                           for m in _NUMERIC.finditer(_PLACEHOLDER_RE.sub(" ", doc.masked))
                           if any(ch.isdigit() for ch in m.group(0))})
    all_refs = sorted({(k, v) for k, v in _refs_in(_restore(doc.masked, doc.verbatims))})

    return {
        "source": doc.path,
        "sha256": doc.sha256,
        "bytes": len(doc.text.encode("utf-8")),
        "metrics": file_metrics(doc),
        "constraints": [asdict(c) for c in constraints],
        "atoms": {
            "verbatim": [{"id": v.vid, "kind": v.kind, "line": v.line, "text": v.text}
                         for v in doc.verbatims],
            "glosses": glosses,
            "numerics": all_numerics,
            "references": [[k, v] for k, v in all_refs],
            "headings": [{"line": l, "level": lv, "title": t} for l, lv, t in doc.headings],
        },
        "counts": {
            "constraints": len(constraints),
            "obligations": sum(1 for c in constraints if c.kind == "obligation"),
            "prohibitions": sum(1 for c in constraints if c.kind == "prohibition"),
            "exceptions": sum(1 for c in constraints if c.kind == "exception"),
            "defaults": sum(1 for c in constraints if c.kind == "default"),
            "permissions": sum(1 for c in constraints if c.kind == "permission"),
            "conditionals": sum(1 for c in constraints if c.kind == "conditional"),
            "verbatim_spans": len(doc.verbatims),
            "numeric_literals": len(all_numerics),
            "reference_edges": len(all_refs),
        },
    }


# ---------------------------------------------------------------------------
# 5. Survival check
# ---------------------------------------------------------------------------

COVERAGE_PRESENT = 0.80
COVERAGE_REVIEW = 0.55
COVERAGE_LOCATED = 0.50   # below this we did not find the rule; skip local defect checks
ATTEST_MIN_COVERAGE = 0.50   # mechanical floor an attestation must clear
WINDOW = 3


@dataclass
class Finding:
    cid: str
    status: str        # present | attested | review | lost
    coverage: float    # file-wide key coverage — the survival measure
    coverage_local: float
    matched_line: Optional[int]
    defects: List[str] = field(default_factory=list)
    note: str = ""


def _matches(key: str, pool: Set[str]) -> bool:
    """Telegraphic rewriting abbreviates: `documents`->`doc`, `repro`->`reproduce`.

    A key counts as surviving if some target token is a prefix of it, or it is a
    prefix of some target token (>=3 chars). Exact match is the common case.
    """
    if key in pool:
        return True
    if len(key) < 3 or not key[0].isalpha():
        return False
    for t in pool:
        if len(t) >= 3 and (t.startswith(key[:4]) or key.startswith(t[:4])):
            if t.startswith(key) or key.startswith(t):
                return True
    return False


def _coverage(keys: Set[str], pool: Set[str]) -> float:
    if not keys:
        return 0.0
    return sum(1 for k in keys if _matches(k, pool)) / len(keys)


def _missing(keys: Set[str], pool: Set[str]) -> List[str]:
    return sorted(k for k in keys if not _matches(k, pool))


def _allowed_missing(n_keys: int) -> int:
    """Short constraints must not be failed by one abbreviated word.

    Budget = one free token, plus 15% of the constraint's distinctive tokens.
    """
    return max(1, math.ceil(0.15 * n_keys))


def _unit_keys(doc: Doc) -> List[Tuple[Unit, Set[str]]]:
    return [(u, _keys_of(u.raw)) for u in doc.units if u.kind != "heading"]


def _window_size(n_keys: int) -> int:
    """A big source constraint may legitimately fan out into many TRB lines."""
    return min(10, max(WINDOW, math.ceil(n_keys / 8)))


def _best_match(keys: Set[str], target: List[Tuple[Unit, Set[str]]]
                ) -> Tuple[float, Optional[Unit], str]:
    """Return (best window coverage, best single unit, best window text).

    The single best unit is where modality/quantifier tokens are read from — a
    multi-unit window bleeds a neighbouring rule's `NEVER` into this rule.
    """
    if not keys:
        return 0.0, None, ""
    size = _window_size(len(keys))
    best_cov, best_text = 0.0, ""
    best_unit, best_unit_cov = None, 0.0
    for i, (u, ks) in enumerate(target):
        c = _coverage(keys, ks)
        if c > best_unit_cov:
            best_unit_cov, best_unit = c, u
        acc: Set[str] = set()
        for w in range(size):
            if i + w >= len(target):
                break
            acc = acc | target[i + w][1]
            cov = _coverage(keys, acc)
            if cov > best_cov:
                best_cov = cov
                best_text = "\n".join(t[0].raw for t in target[i: i + w + 1])
    return best_cov, best_unit, best_text


def survival(inv: Dict[str, object], minified: Doc,
             attest: Optional[Dict[str, Dict[str, object]]] = None) -> Dict[str, object]:
    """Map every inventory item into `minified`. Mechanical, no model calls."""
    attest = attest or {}
    target = _unit_keys(minified)
    file_pool: Set[str] = set()
    for _u, ks in target:
        file_pool |= ks
    min_raw = minified.text
    min_nums_all = {_normalise_numeric(m.group(0)) for m in _NUMERIC.finditer(min_raw)
                    if any(ch.isdigit() for ch in m.group(0))}
    min_flat = re.sub(r"\s+", " ", min_raw).lower()
    findings: List[Finding] = []
    explicit_gain = 0

    for craw in inv["constraints"]:                       # type: ignore[index]
        keys = set(craw["keys"])
        cov_file = _coverage(keys, file_pool)
        missing = _missing(keys, file_pool)
        cov_local, unit, win_text = _best_match(keys, target)
        located = cov_local >= COVERAGE_LOCATED
        # Modality/quantifier are read from the single best-matching unit when it
        # covers the rule — a multi-unit window bleeds a neighbour's tokens in.
        win = ""
        if located:
            u_cov = _coverage(keys, _keys_of(unit.raw)) if unit else 0.0
            win = unit.raw if (unit and u_cov >= COVERAGE_PRESENT) else win_text
        defects: List[str] = []

        # -- verbatim spans this constraint depends on must be byte-present
        for span in craw["verbatims"]:
            if span not in min_raw:
                defects.append(f"verbatim-missing:{span[:48]}")

        # -- numerics must survive with identical canonical identity
        for n in craw["numerics"]:
            if n not in min_nums_all:
                defects.append(f"numeric-drift:{n}")

        # -- reference edges must survive (resolution checked separately)
        for kind, val in craw["refs"]:
            if kind in ("section", "ordinal") and re.sub(r"\s+", " ", val).lower() not in min_flat:
                defects.append(f"reference-dropped:{val}")

        # -- enumerations may not be truncated
        for item in craw["enum_items"]:
            if item not in min_raw:
                defects.append(f"enum-item-missing:{item[:40]}")

        # -- modality / polarity / hedge (only where the rule was actually located)
        mod_after, neg_after = modality_of(win) if located else (None, False)
        mod_before = craw["modality"]
        # Only hard modality loss is a defect: MUST/NEVER softened, or any
        # modality erased entirely. SHOULD<->MAY drift is below detector precision.
        if located and mod_before and (
                (MODALITY_STRENGTH[mod_before] == 3 and MODALITY_STRENGTH[mod_after] < 3)
                or mod_after is None):
            defects.append(f"modality-weakened:{mod_before}->{mod_after}")
        if located and craw["negative"] and not neg_after:
            defects.append("polarity-flipped")
        if located and craw["hedged"] and mod_after in ("MUST", "NEVER") and \
                MODALITY_STRENGTH[mod_before] < 3 and not _HEDGE.search(win):
            defects.append(f"hedge-hardened:->{mod_after}")

        # -- quantifiers whose loss changes scope
        q_after = set(quantifiers_of(win)) if located else set()
        if located:
            for q in craw["quantifiers"]:
                if q in SCOPE_QUANTIFIERS and q not in q_after:
                    defects.append(f"quantifier-erosion:{q}")

        # -- explicitness gain (capped per constraint so repetition can't inflate)
        before_tokens = len(craw["quantifiers"]) + (1 if mod_before else 0)
        after_tokens = len(q_after) + (1 if mod_after else 0)
        explicit_gain += max(-3, min(3, after_tokens - before_tokens)) if located else 0

        within_budget = len(missing) <= _allowed_missing(len(keys))
        if (cov_file >= COVERAGE_PRESENT or within_budget) and not defects:
            status = "present"
        elif cov_file >= COVERAGE_REVIEW or defects:
            status = "review"
        else:
            status = "lost"

        note = ""
        if status in ("review", "lost") and craw["cid"] in attest:
            a = attest[craw["cid"]]
            if defects:
                # A mechanical defect is a measured fact, not a judgement call.
                # It has to be fixed in the file; it can never be attested away.
                note = ("attestation NOT APPLICABLE: mechanical defects must be fixed "
                        "in the minified file, not attested")
            else:
                ok, why = _check_attestation(craw, a, minified)
                if ok:
                    status, note = "attested", f"attested -> line {a.get('line')}: {a.get('why', '')}"
                else:
                    note = f"attestation REJECTED: {why}"
        findings.append(Finding(craw["cid"], status, round(cov_file, 3), round(cov_local, 3),
                                unit.line if unit else None, defects, note))

    # -- global atom checks (independent of any single constraint)
    atom_failures: List[str] = []
    for v in inv["atoms"]["verbatim"]:                     # type: ignore[index]
        if v["text"] not in min_raw:
            atom_failures.append(f"verbatim-span-lost[{v['id']}]: {v['text'][:60]!r}")
    for n in inv["atoms"]["numerics"]:                     # type: ignore[index]
        if n not in min_nums_all:
            atom_failures.append(f"numeric-literal-lost: {n}")
    for g in inv["atoms"].get("glosses", []):              # type: ignore[union-attr]
        cov = _coverage(set(g["keys"]), file_pool)
        if cov < GLOSS_COVERAGE:
            atom_failures.append(f"{g['kind']}-lost[{g['id']}] cov={cov:.2f}: {g['text'][:70]!r}")

    lost = [f for f in findings if f.status == "lost"]
    review = [f for f in findings if f.status == "review"]
    defect_count = sum(len(f.defects) for f in findings if f.status != "attested")
    constraints_lost = len(lost) + len(review) + len(atom_failures)
    structure_score = explicit_gain - constraints_lost

    return {
        "verdict_kind": "structure",
        "constraints_total": len(findings),
        "present": sum(1 for f in findings if f.status == "present"),
        "attested": sum(1 for f in findings if f.status == "attested"),
        "review_unattested": len(review),
        "lost": len(lost),
        "atom_failures": atom_failures,
        "defect_count": defect_count,
        "explicit_gain": explicit_gain,
        "constraints_lost": constraints_lost,
        "structure_score": structure_score,
        "result": "PASS" if (constraints_lost == 0 and structure_score >= 0) else "REJECTED",
        "findings": [asdict(f) for f in findings],
    }


def _check_attestation(craw: Dict[str, object], a: Dict[str, object],
                       minified: Doc) -> Tuple[bool, str]:
    """An attestation is a claim with a mechanical floor, not a free pass.

    It must name a line in the minified file, and that line's neighbourhood must
    carry at least half of the constraint's distinctive tokens. Blanket
    attestation is therefore impossible: pointing at an unrelated line fails.

    Consequence worth knowing: a rule paraphrased into entirely new vocabulary
    cannot be attested either. Keep a rule's distinctive terms, or the tool has
    no way to tell your paraphrase from a deletion.
    """
    line = a.get("line")
    if not isinstance(line, int):
        return False, "missing integer `line`"
    lines = minified.text.split("\n")
    if not (1 <= line <= len(lines)):
        return False, f"line {line} out of range"
    win = "\n".join(lines[max(0, line - 2): line + 2])
    cov = _coverage(set(craw["keys"]), _keys_of(win))             # type: ignore[index]
    if cov >= ATTEST_MIN_COVERAGE:
        return True, ""
    return False, (f"attested line carries only {cov:.0%} of the constraint's distinctive "
                   f"tokens (need >= {ATTEST_MIN_COVERAGE:.0%})")


# ---------------------------------------------------------------------------
# 6. Reference graph
# ---------------------------------------------------------------------------

def providers(doc: Doc) -> Set[str]:
    """Anchors this file provides: heading titles, section numbers, ordinals."""
    out: Set[str] = set()
    for _line, _lvl, title in doc.headings:
        out.add("title:" + _norm_title(title))
        m = re.match(r"^(?:§\s?)?(\d+)[.)]?\s", title)
        if m:
            out.add(f"section:§{m.group(1)}")
        for m2 in re.finditer(r"(?i)\b(principle|phase|step|stage|rule|item|point)\s+(\d+[a-z]?)", title):
            out.add(f"ordinal:{m2.group(1).lower()} {m2.group(2).lower()}")
    for u in doc.units:
        if u.ordinal is not None:
            out.add(f"ord:{u.ordinal}")
    return out


def _norm_title(t: str) -> str:
    t = re.sub(r"[`*_]", "", t)
    t = re.sub(r"\s+", " ", t).strip().lower()
    return t


def _edge_key(kind: str, val: str) -> str:
    if kind == "section":
        n = re.findall(r"\d+", val)
        return f"section:§{n[0]}" if n else f"section:{val}"
    if kind == "ordinal":
        m = re.match(r"(?i)(\w+)\s+(\d+[a-z]?)", val)
        return f"ordinal:{m.group(1).lower()} {m.group(2).lower()}" if m else f"ordinal:{val.lower()}"
    if kind == "emphasised-title":
        return "title:" + _norm_title(val)
    return f"{kind}:{val}"


def reference_graph(original: Doc, minified: Doc, root: Optional[str] = None) -> Dict[str, object]:
    """Two checks: (1) edge preservation, always; (2) resolution, when `root` given."""
    o_edges = {_edge_key(k, v): (k, v) for k, v in _refs_in(_restore(original.masked, original.verbatims))}
    m_edges = {_edge_key(k, v) for k, v in _refs_in(_restore(minified.masked, minified.verbatims))}

    # An italic phrase is only a citation if some file actually provides that
    # heading; otherwise it is ordinary emphasis and must not be tracked as an edge.
    known_titles = providers(original) | providers(minified)
    if root:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in (".git", "node_modules", "dist", "__pycache__")]
            for fn in filenames:
                if fn.endswith(".md"):
                    try:
                        known_titles |= providers(load(os.path.join(dirpath, fn)))
                    except (OSError, UnicodeDecodeError):
                        continue
    o_edges = {k: v for k, v in o_edges.items()
               if v[0] != "emphasised-title" or k in known_titles}

    dropped = [v for k, (kind, v) in o_edges.items()
               if kind in ("section", "ordinal", "emphasised-title", "link") and k not in m_edges]

    unresolved: List[str] = []
    checked = 0
    if root:
        corpus: Dict[str, Set[str]] = {}
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in (".git", "node_modules", "dist", "__pycache__")]
            for fn in filenames:
                if fn.endswith(".md"):
                    p = os.path.join(dirpath, fn)
                    try:
                        corpus[p] = providers(load(p))
                    except (OSError, UnicodeDecodeError):
                        continue
        own = os.path.abspath(original.path)
        corpus[own] = providers(minified)          # substitute the minified version
        universe: Set[str] = set().union(*corpus.values()) if corpus else set()

        for key, (kind, val) in o_edges.items():
            if kind == "path":
                checked += 1
                cand = os.path.join(root, val)
                if not (os.path.exists(cand) or os.path.exists(val)):
                    unresolved.append(f"path not found: {val}")
                continue
            if kind in ("section", "ordinal", "emphasised-title"):
                checked += 1
                if key not in universe and key.replace("ordinal:", "ord:") not in universe:
                    ordv = re.findall(r"\d+", val)
                    if not (ordv and f"ord:{ordv[0]}" in universe):
                        unresolved.append(f"unresolved reference: {val}")

    return {
        "edges_before": len(o_edges),
        "edges_after": len(m_edges),
        "dropped_edges": dropped,
        "resolution_checked": checked,
        "unresolved": unresolved,
        "result": "PASS" if not dropped and not unresolved else "REJECTED",
    }


# ---------------------------------------------------------------------------
# 7. Frontmatter freeze
# ---------------------------------------------------------------------------

FROZEN_FRONTMATTER_KEYS = ("name", "description")


def frontmatter_check(original: Doc, minified: Doc) -> Dict[str, object]:
    """`description` is a retrieval key, not prose (research R7). Byte-frozen."""
    problems: List[str] = []
    o, m = original.frontmatter_map, minified.frontmatter_map
    if (original.frontmatter is None) != (minified.frontmatter is None):
        problems.append("frontmatter block added or removed")
    for k in FROZEN_FRONTMATTER_KEYS:
        if k in o and o[k] != m.get(k):
            problems.append(f"frozen frontmatter key changed: `{k}` "
                            f"({len(o[k])}B -> {len(m.get(k, ''))}B)")
    for k in o:
        if k not in FROZEN_FRONTMATTER_KEYS and k in m and o[k] != m[k]:
            problems.append(f"note: non-frozen frontmatter key changed: `{k}`")
    hard = [p for p in problems if not p.startswith("note:")]
    return {"problems": problems, "result": "PASS" if not hard else "REJECTED"}


# ---------------------------------------------------------------------------
# 8. Verdicts — size and structure, emitted separately
# ---------------------------------------------------------------------------

#: Reference bar only. Reported for continuity with the phase-1 gate; it is NOT
#: what the size verdict is decided on — a flat percentage was wrong on four of
#: six real files measured. The verdict is "did this file hit its own predicted
#: range", computed per file from frozen fraction + function-word ratio.
SIZE_BAR_PCT = 20.0
PRE_DENSIFIED_VERBATIM_PCT = 25.0
PRE_DENSIFIED_FUNCWORD_PCT = 30.0
#: Above the bar but still dense. Reported, never gating. Calibration: ordinary
#: English prose with no code (a licence text) measures 48.2% under this skill's
#: frozen 84-word list; this repo's instruction files measure 19.9-34.0%.
BORDERLINE_FUNCWORD_PCT = 35.0
ORDINARY_PROSE_FUNCWORD_PCT = 48.2
IMPLAUSIBLE_CUT_PCT = 60.0
PROXY_SPREAD_FLAG_PTS = 5.0


def size_verdict(original: Doc, minified: Doc) -> Dict[str, object]:
    ob, mb = len(original.text.encode()), len(minified.text.encode())
    byte_cut = 100.0 * (ob - mb) / ob if ob else 0.0
    ta_o, ta_m = tokens_wordpunct(original.text), tokens_wordpunct(minified.text)
    tb_o, tb_m = tokens_byterate(original.text), tokens_byterate(minified.text)
    cut_a = 100.0 * (ta_o - ta_m) / ta_o if ta_o else 0.0
    cut_b = 100.0 * (tb_o - tb_m) / tb_o if tb_o else 0.0
    spread = abs(cut_a - cut_b)
    vf = verbatim_fraction(original)
    fz = frozen_fraction(original)
    fw = function_word_ratio(original)
    pred = predict_reduction(original)
    p_lo, p_hi = pred["predicted_cut_pct"]                # type: ignore[misc]

    exempt_reasons: List[str] = []
    if vf > PRE_DENSIFIED_VERBATIM_PCT:
        exempt_reasons.append(f"verbatim fraction {vf:.1f}% > {PRE_DENSIFIED_VERBATIM_PCT:.0f}%")
    if fw < PRE_DENSIFIED_FUNCWORD_PCT:
        exempt_reasons.append(f"function-word ratio {fw:.1f}% < {PRE_DENSIFIED_FUNCWORD_PCT:.0f}%")
    exempt = bool(exempt_reasons)

    reported = min(cut_a, cut_b)
    flags: List[str] = []
    if spread > PROXY_SPREAD_FLAG_PTS:
        flags.append(f"proxy-disagreement: {cut_a:.1f}% vs {cut_b:.1f}% ({spread:.1f} pts apart)")
    if byte_cut - reported > PROXY_SPREAD_FLAG_PTS:
        flags.append(f"byte cut ({byte_cut:.1f}%) overstates token cut ({reported:.1f}%)")
    if reported > IMPLAUSIBLE_CUT_PCT:
        flags.append(f"implausible reduction >{IMPLAUSIBLE_CUT_PCT:.0f}% — verify nothing was deleted wholesale")
    if pred["extrapolated"]:
        flags.append(f"prediction extrapolated: function-word ratio {fw:.1f}% sits below "
                     "the lowest band any calibration probe covered")
    if fz > 50.0:
        flags.append(f"{fz:.0f}% of this file is frozen content — the reachable prize is small "
                     "however well it is rewritten")

    if mb > ob:
        result = "FAIL-GREW"
    elif reported > IMPLAUSIBLE_CUT_PCT:
        result = "IMPLAUSIBLE"
    elif reported > p_hi:
        result = "ABOVE-PREDICTION"
    elif reported >= p_lo:
        result = "MET-PREDICTION"
    else:
        result = "BELOW-PREDICTION"

    return {
        "verdict_kind": "size",
        "bytes_before": ob, "bytes_after": mb, "byte_cut_pct": round(byte_cut, 1),
        "tokens_wordpunct": [ta_o, ta_m], "tokens_byterate": [tb_o, tb_m],
        "token_cut_pct": {"wordpunct": round(cut_a, 1), "byterate": round(cut_b, 1)},
        "token_cut_reported_pct": round(reported, 1),
        "proxy_spread_pts": round(spread, 1),
        "verbatim_fraction_pct": round(vf, 1),
        "frozen_fraction_pct": round(fz, 1),
        "function_word_ratio_pct": round(fw, 1),
        "prediction": pred,
        "reference_bar_pct": SIZE_BAR_PCT,
        "meets_reference_bar": reported >= SIZE_BAR_PCT,
        "pre_densified": exempt,
        "exemption_note": ("pre-densified, exempt from the 20% bar (" + "; ".join(exempt_reasons) + ")")
                          if exempt else "",
        "flags": flags,
        "result": result,
    }
