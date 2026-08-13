#!/usr/bin/env python3
"""
check_preservation.py — trigger-word preservation gate for /minify.

Generic, stdlib-only. Works on any two plain-text files.

Usage:
    python3 check_preservation.py <original> <minified>

What it does:
  1. Splits both files into sentences.
  2. Extracts every sentence in either file that contains at least one
     "trigger word" — a word that marks conditional/exception/obligation
     logic (unless, except, only, never, must not, do not, before, after,
     when in doubt, otherwise, instead of, plus MUST/NEVER/MANDATORY-style
     modal emphasis).
  3. Normalizes whitespace/case for comparison and diffs the two trigger-
     sentence sets.
  4. Reports any trigger sentence present in the original but missing (or
     substantively altered) in the minified file -> HARD FAIL.
  5. Reports token counts (tiktoken if available, else an approximate
     whitespace/punctuation tokenizer) and % reduction.

Exit codes:
  0  gate passed  (all trigger sentences preserved, reduction in 0-50% band)
  1  gate failed  (missing/altered trigger-word content, or unusable input)
"""

import difflib
import re
import sys

TRIGGER_WORDS = [
    "unless",
    "except",
    "only",
    "never",
    "must not",
    "do not",
    "don't",
    "before",
    "after",
    "when in doubt",
    "otherwise",
    "instead of",
    "must",
    "mandatory",
    "critical",
    "required",
]

# Words whose presence alone is enough to flag a sentence (case-insensitive,
# word-boundary matched; multi-word phrases matched as substrings).
_TRIGGER_RE = re.compile(
    r"\b(" + "|".join(re.escape(w) for w in TRIGGER_WORDS) + r")\b",
    re.IGNORECASE,
)

# Rough sentence splitter: break on ., !, ? followed by whitespace+capital,
# or on newlines that look like list-item/markdown boundaries. Good enough
# for a preservation diff — false splits just make the comparison stricter.
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\-\*`\"'(])|\n{2,}")

# Strip markdown noise that would make cosmetic-only diffs look substantive.
_MD_STRIP_RE = re.compile(r"[`*_#>]|^\s*[-\d.]+\s+", re.MULTILINE)


def read_file(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except OSError as e:
        print(f"ERROR: could not read {path!r}: {e}", file=sys.stderr)
        sys.exit(1)


def split_sentences(text: str):
    # Work line-by-line first so single-newline lists don't get glued into
    # one giant "sentence", then further split within each line/paragraph.
    chunks = []
    for block in re.split(r"\n{2,}", text):
        block = block.strip()
        if not block:
            continue
        for line in block.split("\n"):
            line = line.strip()
            if not line:
                continue
            parts = _SENTENCE_SPLIT_RE.split(line)
            for p in parts:
                p = p.strip()
                if p:
                    chunks.append(p)
    return chunks


def normalize(sentence: str) -> str:
    s = _MD_STRIP_RE.sub(" ", sentence)
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s


def extract_trigger_sentences(text: str):
    """Returns dict: normalized_sentence -> original_sentence (first seen)."""
    result = {}
    for sentence in split_sentences(text):
        if _TRIGGER_RE.search(sentence):
            norm = normalize(sentence)
            if norm and norm not in result:
                result[norm] = sentence
    return result


def approx_tokenize(text: str):
    # Whitespace + punctuation split, approximating BPE token count.
    return re.findall(r"\w+|[^\w\s]", text, re.UNICODE)


def count_tokens(text: str):
    try:
        import tiktoken  # type: ignore

        enc = tiktoken.get_encoding("cl100k_base")
        return len(enc.encode(text)), "tiktoken(cl100k_base)"
    except Exception:
        return len(approx_tokenize(text)), "approx (whitespace/punctuation)"


def closest_match(norm_sentence: str, candidates):
    """Find the best fuzzy match for norm_sentence among candidates (normalized)."""
    if not candidates:
        return None, 0.0
    best = difflib.get_close_matches(norm_sentence, candidates, n=1, cutoff=0.0)
    if not best:
        return None, 0.0
    ratio = difflib.SequenceMatcher(None, norm_sentence, best[0]).ratio()
    return best[0], ratio

# A match above this similarity is considered "preserved, cosmetic edits
# only". Below it, the sentence is treated as substantively altered.
SIMILARITY_THRESHOLD = 0.85


def main():
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <original> <minified>", file=sys.stderr)
        sys.exit(1)

    orig_path, min_path = sys.argv[1], sys.argv[2]
    orig_text = read_file(orig_path)
    min_text = read_file(min_path)

    orig_triggers = extract_trigger_sentences(orig_text)
    min_triggers = extract_trigger_sentences(min_text)
    min_norms = list(min_triggers.keys())

    missing = []
    altered = []
    preserved = 0

    for norm, original_sentence in orig_triggers.items():
        if norm in min_triggers:
            preserved += 1
            continue
        match, ratio = closest_match(norm, min_norms)
        if match is not None and ratio >= SIMILARITY_THRESHOLD:
            preserved += 1
        elif match is not None and ratio >= 0.5:
            altered.append((original_sentence, min_triggers[match], ratio))
        else:
            missing.append(original_sentence)

    orig_tokens, orig_method = count_tokens(orig_text)
    min_tokens, min_method = count_tokens(min_text)
    if orig_tokens > 0:
        reduction_pct = 100.0 * (orig_tokens - min_tokens) / orig_tokens
    else:
        reduction_pct = 0.0

    gate_failed = bool(missing) or bool(altered)

    print("=" * 72)
    print("MINIFY PRESERVATION GATE")
    print("=" * 72)
    print(f"Original:  {orig_path}")
    print(f"Minified:  {min_path}")
    print()
    print(f"Tokenizer: {orig_method}"
          + (f" / {min_method}" if min_method != orig_method else ""))
    print(f"Original tokens:  {orig_tokens}")
    print(f"Minified tokens:  {min_tokens}")
    print(f"Reduction:        {reduction_pct:.1f}%")
    print()
    print(f"Trigger-word sentences in original: {len(orig_triggers)}")
    print(f"Trigger-word sentences in minified:  {len(min_triggers)}")
    print(f"Preserved (exact or near-identical): {preserved}")
    print(f"Substantively altered:               {len(altered)}")
    print(f"Missing entirely:                    {len(missing)}")
    print()

    if altered:
        print("-" * 72)
        print("ALTERED trigger-word sentences (similarity below threshold):")
        for orig_s, min_s, ratio in altered:
            print(f"\n  [similarity {ratio:.2f}]")
            print(f"  ORIGINAL:  {orig_s}")
            print(f"  MINIFIED:  {min_s}")
        print()

    if missing:
        print("-" * 72)
        print("MISSING trigger-word sentences (no match found in minified file):")
        for s in missing:
            print(f"\n  - {s}")
        print()

    print("=" * 72)
    if gate_failed:
        print("RESULT: FAIL — trigger-word (Tier N) content was dropped or")
        print("altered. Restore the sentences listed above verbatim (or with")
        print("only cosmetic edits) and re-run this gate.")
        print("=" * 72)
        sys.exit(1)

    if reduction_pct < 0 or reduction_pct > 50:
        print(f"RESULT: FAIL — reduction of {reduction_pct:.1f}% is outside the")
        print("sane 0-50% band (negative = file grew; >50% is implausible for")
        print("a single minify pass and likely means content was lost that")
        print("this gate's trigger-word list didn't happen to catch).")
        print("=" * 72)
        sys.exit(1)

    print("RESULT: PASS — all trigger-word content preserved.")
    print("=" * 72)
    sys.exit(0)


if __name__ == "__main__":
    main()
