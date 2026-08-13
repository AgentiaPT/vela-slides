#!/usr/bin/env python3
"""
constraint_inventory.py — extract a constraint inventory from an instruction
file and score how many of a baseline's constraints survive (explicit) in a
minified counterpart.

# TODO(orchestrator): reconcile with .claude/skills/minify/'s extractor —
# BOTH NOW EXIST. This module was built by the phase-5 harness agent under a
# time-boxed, no-agent-run constraint, at a point when `.claude/skills/minify/`
# did not exist yet on disk (checked: `ls .claude/skills/` — absent). It has
# since landed: `.claude/skills/minify/scripts/minify_lib.py` now has its own
# `Constraint`/`inventory()`/`survival()` (constraint extraction + survival
# scoring) plus its own `frozen_fraction()`/`prose_rate()`/
# `predict_reduction()` — i.e. independently-built overlapping logic for
# BOTH this file's job AND reduction.py's corroboration-study patch (see that
# file's module docstring). The two implementations were NOT cross-checked
# against each other and may use different calibration constants/thresholds.
# Do not let them silently diverge — reconcile by either importing phase 4's
# version from here or folding this file's harness-specific bits (weighting
# for 6a's structure sub-verdict, the `min_net_delta` gate hookup) into it
# and deleting this one.
#
# Re-evaluated during the runner.py build-out (phase 5 completion pass):
# reconciliation is NOT a drop-in import. `reduction.py` calls this module's
# `score_pair(base, min) -> {net_delta, lost_count, weakened_count,
# newly_explicit_count}` directly (see `ci.score_pair` in `measure_pair()`)
# and `run_approach()` sums those four fields verbatim into the 6a structure
# verdict. `minify_lib.py`'s `inventory()`/`survival()` — confirmed by
# reading `.claude/skills/minify/scripts/minify_lib.py` — returns a richer,
# differently-shaped result instead: `survival(inv, minified_doc, attest=None)`
# -> `{structure_score, result: "PASS"|"REJECTED", findings: [Finding(cid,
# status: present|attested|review|lost, coverage, defects: [...])]}`, where
# `structure_score = explicit_gain - constraints_lost` is computed from
# per-Constraint survival, not from four flat counters. `parse(text,
# path="<memory>")` does accept raw text with no real file needed, so the
# plumbing side of a reuse is easy — but a correct adapter still has to
# derive `lost_count`/`weakened_count`/`newly_explicit_count` from
# `findings[].status`/`defects[]` (e.g. status=="lost" -> lost_count,
# a `modality-weakened:*` defect -> weakened_count, an explicit-count
# comparison for newly_explicit_count) and cross-check both modules'
# calibration constants agree before wiring it in — real engineering, not a
# rename. Given `constraint_inventory.py` is already wired into `reduction.py`
# and both pass `--selftest` matching the locked §7 spec, this pass leaves
# the two implementations in place rather than risk regressing a working,
# spec-matching gate under time pressure. Next step for whoever picks this
# up: write the findings->counts adapter above, run both self-tests plus a
# corroboration diff against a handful of real pairs, THEN delete this file
# in favor of the import.

Purpose (harness-design.md §7, context.md's amended verdict-6a "structure"
sub-verdict): a size-only reduction metric hides the exact signal probe B
surfaced in research-encoding-formats.md — a rewrite that only cuts 4.6% of
bytes while turning three implicit quantifiers into explicit ones is a real
win that a bytes-only score cannot see. This module makes that measurable:

  1. Extract every "constraint" from a text — a sentence/bullet that carries
     an explicit quantifier or modality token (MUST, NEVER, ALWAYS, at least
     N, exactly, every, before/after ordering, etc.), tagged with a semantic
     "polarity class" (obligation / prohibition / quantity / ordering /
     conditional).
  2. Given a baseline and a minified counterpart, match each baseline
     constraint to its best-effort counterpart region in the minified text
     (keyword-overlap based — there is no ground-truth alignment across a
     rewrite) and classify it as RETAINED (still explicit, same polarity
     class), WEAKENED (content present but the modality token dropped —
     become implicit), or LOST (no trace of the content found at all).
  3. Also detect NEWLY-EXPLICIT constraints: content that was *implicit* in
     the baseline (present, no modality token) but carries one in the
     minified text — this is the positive signal probe B demonstrated.

This is intentionally NOT a semantic/LLM-based matcher — 6a is specified as
judge-free and zero-model-calls (harness-design.md §7). It is a deliberately
conservative, explainable, regex/keyword-overlap heuristic. It will produce
false negatives (a paraphrase it fails to match) more often than false
positives, which is the safe direction for a pre-filter: it should never
report a passing structure score by hallucinating a match.
"""

import re
import sys
import unicodedata

# ── Modality / quantifier vocabulary, by polarity class ──────────────────
# Order matters for classification precedence when a sentence matches more
# than one class (prohibition beats obligation beats quantity, etc. — a
# sentence that says "MUST NOT" is a prohibition, not merely an obligation).

PROHIBITION_TOKENS = [
    r"must\s+not", r"never", r"do\s+not", r"don't", r"cannot", r"can't",
    r"no\s+more\s+than", r"not\s+allowed", r"forbidden", r"disallow\w*",
    r"never\s+skip", r"NEVER",
]
OBLIGATION_TOKENS = [
    r"\bmust\b", r"\brequired\b", r"\bmandatory\b", r"\bshall\b",
    r"\bshould\b", r"\balways\b", r"\bensure\b", r"\bneeds?\s+to\b",
]
QUANTITY_TOKENS = [
    r"\bat\s+least\b", r"\bat\s+most\b", r"\bexactly\b", r"\bevery\b",
    r"\beach\b", r"\ball\b", r"\bany\b", r"\bonly\b", r"[<>]=?\s*\d",
    r"\d+\s*%", r"≥", r"≤", r"\bmax(?:imum)?\b", r"\bmin(?:imum)?\b",
    r"\bno\s+more\s+than\b",
]
ORDERING_TOKENS = [
    r"\bbefore\b", r"\bafter\b", r"\bfirst\b", r"\bthen\b", r"\bonce\b",
    r"\bprior\s+to\b",
]
CONDITIONAL_TOKENS = [
    r"\bif\b", r"\bunless\b", r"\bwhen(?:ever)?\b", r"\bin\s+case\b",
]

CLASSES = [
    ("prohibition", PROHIBITION_TOKENS),
    ("obligation", OBLIGATION_TOKENS),
    ("quantity", QUANTITY_TOKENS),
    ("ordering", ORDERING_TOKENS),
    ("conditional", CONDITIONAL_TOKENS),
]
_CLASS_RES = [(name, re.compile("|".join(pats), re.IGNORECASE)) for name, pats in CLASSES]

# A minimal stopword set for keyword-overlap signatures (not the same list as
# research-encoding-formats.md's 84-word function-word list — that measures
# lexical density of prose; this one just needs to strip noise words so the
# signature keys on content words).
_STOPWORDS = frozenset("""
a an the of to in on for and or but is are was were be been being this
that these those it its as at by from with without into onto than then
so if unless when whenever not no nor do does did done doing have has
had having will would can could should shall may might must never always
only also just very more most such each every any all both either neither
own same too also i you he she we they them his her their your our my
me him us s t d ll re ve
""".split())

_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9_'-]{2,}")
_FENCE_RE = re.compile(r"```.*?```", re.DOTALL)
_INLINE_CODE_RE = re.compile(r"`[^`\n]+`")


def _stem(word):
    """Deliberately crude suffix-stripping (not Porter) so a rewrite that
    merely re-inflects a word ("editing" -> "edit", "messages" -> "message")
    still counts as the same content word. Good enough for a keyword-overlap
    pre-filter; not a linguistic claim."""
    w = word.lower()
    for suf in ("'s",):
        if w.endswith(suf):
            w = w[: -len(suf)]
    if len(w) > 5 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 4 and w.endswith("es"):
        return w[:-2]
    if len(w) > 4 and w.endswith("ing"):
        return w[:-3]
    if len(w) > 4 and w.endswith("ed"):
        return w[:-2]
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def strip_code(text):
    """Remove fenced and inline code so constraint extraction only looks at
    prose (verbatim spans are frozen at 0% budget per research §2 C1 — they
    are not where constraint-explicitness compression happens)."""
    text = _FENCE_RE.sub(" ", text)
    text = _INLINE_CODE_RE.sub(" ", text)
    return text


def split_sentences(text):
    """Split into sentence-ish units: markdown bullets/table rows are their
    own unit; prose is split on '.', '!', '?' followed by whitespace+capital
    or end-of-line. Deliberately simple — this is a pre-filter, not an NLP
    pipeline."""
    text = strip_code(text)
    units = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        # markdown table row or bullet: whole line is one unit
        if line.startswith(("-", "*", "|", ">")) or re.match(r"^\d+[.)]\s", line):
            units.append(line)
            continue
        # otherwise split on sentence boundaries
        for piece in re.split(r"(?<=[.!?])\s+(?=[A-Z(`\"'*])", line):
            piece = piece.strip()
            if piece:
                units.append(piece)
    return units


def classify(unit):
    """Return the highest-precedence polarity class matching `unit`, or None."""
    for name, rx in _CLASS_RES:
        if rx.search(unit):
            return name
    return None


def signature(unit, top_n=6):
    """Content-word signature for fuzzy matching across a rewrite."""
    words = [_stem(w) for w in _TOKEN_RE.findall(unit)]
    content = [w for w in words if w not in _STOPWORDS and len(w) > 1]
    # keep order but dedupe, cap length
    seen = []
    for w in content:
        if w not in seen:
            seen.append(w)
    return seen[:top_n] if len(seen) <= top_n else seen[:top_n]


def extract_constraints(text):
    """Return a list of {unit, class, signature} dicts — one per sentence/
    bullet in `text` carrying an explicit modality/quantifier token."""
    out = []
    for unit in split_sentences(text):
        cls = classify(unit)
        if cls is None:
            continue
        sig = signature(unit)
        if not sig:
            continue
        out.append({"unit": unit, "class": cls, "signature": sig})
    return out


def _normalize_for_search(text):
    text = strip_code(text).lower()
    text = unicodedata.normalize("NFKD", text)
    return text


def _overlap_score(signature_words, haystack_words_set):
    if not signature_words:
        return 0.0
    hits = sum(1 for w in signature_words if w in haystack_words_set)
    return hits / len(signature_words)


def match_constraint(constraint, target_text, overlap_threshold=0.5, window_words=40):
    """Best-effort search for `constraint`'s content in `target_text`.

    Returns one of:
      "retained"       — a matching window exists AND carries a token of the
                          SAME (or a stricter — prohibition counts as
                          satisfying an obligation search) polarity class.
      "weakened"        — a matching window exists (content present) but no
                          modality/quantifier token of an equal-or-stricter
                          class was found in it — i.e. it went implicit.
      "lost"            — no window in target_text has sufficient keyword
                          overlap with the constraint's signature at all.
    """
    norm_target = _normalize_for_search(target_text)
    target_words = [_stem(w) for w in _TOKEN_RE.findall(norm_target)]
    n = len(target_words)
    sig = constraint["signature"]
    if n == 0 or not sig:
        return "lost"

    best_overlap = 0.0
    best_window_text = ""
    step = max(1, window_words // 2)
    for start in range(0, max(n - window_words, 0) + 1, step):
        window = target_words[start:start + window_words]
        window_set = set(window)
        score = _overlap_score(sig, window_set)
        if score > best_overlap:
            best_overlap = score
            best_window_text = " ".join(window)
    # also check the tail window (range() above can undershoot short texts)
    if n <= window_words:
        window_set = set(target_words)
        score = _overlap_score(sig, window_set)
        if score > best_overlap:
            best_overlap = score
            best_window_text = " ".join(target_words)

    if best_overlap < overlap_threshold:
        return "lost"

    found_cls = classify(best_window_text)
    if found_cls is None:
        return "weakened"
    # prohibition is treated as satisfying any search (it is the strictest
    # class); otherwise require the same class family or a stricter one.
    strict_order = ["prohibition", "obligation", "quantity", "ordering", "conditional"]
    wanted_rank = strict_order.index(constraint["class"])
    found_rank = strict_order.index(found_cls)
    if found_rank <= wanted_rank:
        return "retained"
    return "weakened"


def score_pair(baseline_text, minified_text, overlap_threshold=0.5):
    """Compute the constraint-explicitness structure score for one
    (baseline, minified) pair.

    Returns a dict with counts and `net_delta` = (retained_count credited at
    +0, newly_explicit at +1, weakened at -1, lost at -1) — i.e. the score
    only moves on CHANGE, not on things that simply stayed the same. This
    matches context.md's framing: "quantifier/modality tokens made explicit,
    minus constraints lost."
    """
    base_constraints = extract_constraints(baseline_text)
    retained, weakened, lost = [], [], []
    for c in base_constraints:
        verdict = match_constraint(c, minified_text, overlap_threshold)
        if verdict == "retained":
            retained.append(c)
        elif verdict == "weakened":
            weakened.append(c)
        else:
            lost.append(c)

    # Newly-explicit: constraints implicit in baseline (no modality token,
    # so NOT in base_constraints) that ARE explicit in minified. We look at
    # minified-side constraints whose signature has no matching baseline
    # constraint at all (best-effort — same overlap heuristic, reversed).
    min_constraints = extract_constraints(minified_text)
    newly_explicit = []
    for mc in min_constraints:
        # if this minified constraint doesn't match any *baseline*
        # constraint, but its content DOES appear somewhere in the baseline
        # prose (just without a modality token there), credit it as newly
        # explicit rather than counting it as unrelated new content.
        matches_existing = any(
            _overlap_score(mc["signature"], {_stem(w) for w in _TOKEN_RE.findall(_normalize_for_search(bc["unit"]))})
            >= overlap_threshold
            for bc in base_constraints
        )
        if matches_existing:
            continue
        present_in_baseline_prose = match_constraint(mc, baseline_text, overlap_threshold) != "lost" or \
            _overlap_score(mc["signature"], {_stem(w) for w in _TOKEN_RE.findall(_normalize_for_search(baseline_text))}) >= overlap_threshold
        if present_in_baseline_prose:
            newly_explicit.append(mc)

    net_delta = len(newly_explicit) - len(weakened) - len(lost)

    return {
        "baseline_constraint_count": len(base_constraints),
        "retained_count": len(retained),
        "weakened_count": len(weakened),
        "lost_count": len(lost),
        "newly_explicit_count": len(newly_explicit),
        "net_delta": net_delta,
        "lost": [c["unit"] for c in lost],
        "weakened": [c["unit"] for c in weakened],
        "newly_explicit": [c["unit"] for c in newly_explicit],
    }


def main():
    import argparse
    import json

    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--pair", nargs=2, metavar=("BASELINE_FILE", "MINIFIED_FILE"))
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if args.selftest:
        ok = _selftest()
        sys.exit(0 if ok else 1)

    if not args.pair:
        ap.print_usage(sys.stderr)
        sys.exit(2)

    base_path, min_path = args.pair
    with open(base_path, encoding="utf-8") as f:
        base_text = f.read()
    with open(min_path, encoding="utf-8") as f:
        min_text = f.read()

    result = score_pair(base_text, min_text)
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"baseline constraints: {result['baseline_constraint_count']}")
        print(f"  retained:       {result['retained_count']}")
        print(f"  weakened:       {result['weakened_count']}")
        print(f"  lost:           {result['lost_count']}")
        print(f"  newly explicit: {result['newly_explicit_count']}")
        print(f"  net delta:      {result['net_delta']:+d}")


def _selftest():
    """Offline self-test with synthetic text — no files, no network."""
    baseline = """
## Rules

- You MUST bump VELA_VERSION on every skill change.
- NEVER include session URLs in commit messages.
- Read the file before editing it.
- Keep changelog entries short.
"""
    # (1) fully preserved, reworded
    minified_ok = """
## Rules
MUST: bump VELA_VERSION every skill change.
NEVER: session URLs in commits.
DO: read file before edit.
DO: short changelog entries.
"""
    # (2) one constraint dropped its modality token (implicit now)
    minified_weak = """
## Rules
MUST: bump VELA_VERSION every skill change.
Session URLs are not something you'd normally put in commit messages.
DO: read file before edit.
DO: short changelog entries.
"""
    # (3) one constraint's content vanishes entirely
    minified_lost = """
## Rules
MUST: bump VELA_VERSION every skill change.
DO: read file before edit.
DO: short changelog entries.
"""
    ok = True

    r1 = score_pair(baseline, minified_ok)
    if r1["lost_count"] != 0:
        print(f"FAIL selftest#1: expected 0 lost, got {r1['lost_count']}: {r1['lost']}", file=sys.stderr)
        ok = False
    if r1["retained_count"] < 3:
        print(f"FAIL selftest#1: expected >=3 retained, got {r1['retained_count']}", file=sys.stderr)
        ok = False

    r2 = score_pair(baseline, minified_weak)
    if r2["weakened_count"] < 1:
        print(f"FAIL selftest#2: expected >=1 weakened, got {r2['weakened_count']}", file=sys.stderr)
        ok = False

    r3 = score_pair(baseline, minified_lost)
    if r3["lost_count"] < 1:
        print(f"FAIL selftest#3: expected >=1 lost, got {r3['lost_count']}", file=sys.stderr)
        ok = False
    if r3["net_delta"] >= 0:
        print(f"FAIL selftest#3: expected negative net_delta, got {r3['net_delta']}", file=sys.stderr)
        ok = False

    # newly-explicit case: baseline states a fact with no modal, minified adds MUST
    base_implicit = "Commit messages describe the change. Session urls do not belong there."
    min_explicit = "MUST: commit messages describe the change. NEVER include session urls."
    r4 = score_pair(base_implicit, min_explicit)
    if r4["newly_explicit_count"] < 1:
        print(f"FAIL selftest#4: expected >=1 newly_explicit, got {r4['newly_explicit_count']}", file=sys.stderr)
        ok = False

    if ok:
        print("constraint_inventory.py --selftest: OK")
    return ok


if __name__ == "__main__":
    main()
