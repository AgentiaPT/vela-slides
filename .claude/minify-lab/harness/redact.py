#!/usr/bin/env python3
"""
redact.py — judge-bundle redaction + leak scan (harness-design.md §10.2).

Applied to EVERYTHING that reaches the judge: the task restatement and both
arms' artifact bundles (diff and/or final answer). Order matters — each step
below runs in sequence:

  1. stoplist term scrub (minify*, compress*, baseline, variant, arm, ...)
  2. path scrub (.claude/minify-lab, harness/, variants/, runs/, absolute
     paths, worktree dir names, run ids)
  3. patch-metadata scrub (index <sha>.., From/Date/Author/Co-Authored-By/
     Claude-Session lines)
  4. timestamp scrub (ISO timestamps, epoch seconds)
  5. instruction-file hunk removal (any hunk touching CLAUDE.md,
     .claude/skills/**, .claude/settings.json) — contaminates + quarantines
  6. leak scan (post-redaction, fail-closed) — any stoplist/absolute-path
     survivor quarantines the pair

Deliberately NOT applied: length normalization or diff truncation (§10.2
closing note — that would corrupt the very thing being judged).

Usage:
  python3 redact.py <file> [--stoplist-extra term1,term2] [--out PATH]
  python3 redact.py --selftest
"""

import argparse
import re
import sys
from pathlib import Path

HARNESS_DIR = Path(__file__).resolve().parent

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None


DEFAULT_STOPLIST = [
    r"minif\w*", r"compress\w*", r"condensed", r"telegraphic",
    r"token-reduced", r"shortened", r"baseline", r"original version",
    r"control", r"variant", r"arm-a", r"arm-b", r"variant a", r"variant b",
    r"\barm\b",
]

PATH_SCRUB_PATTERNS = [
    (re.compile(r"\.claude/minify-lab\S*"), "<PATH>"),
    (re.compile(r"(?<![\w-])harness/\S*"), "<PATH>"),
    (re.compile(r"(?<![\w-])variants/\S*"), "<PATH>"),
    (re.compile(r"(?<![\w-])runs/\S*"), "<PATH>"),
    (re.compile(r"/home/[^\s\"']+"), "<PATH>"),
    (re.compile(r"/tmp/[^\s\"']+"), "<PATH>"),
]

WORKTREE_DIR_RE = re.compile(r"\bwt-[a-zA-Z0-9_-]+\b|\bwt/[a-zA-Z0-9_/-]*")
RUN_ID_RE = re.compile(r"\b\d{4}-\d{2}-\d{2}-[a-z0-9-]+\b")  # e.g. 2026-08-14-telegraphic-claudemd

PATCH_METADATA_LINE_RE = re.compile(
    r"^(index [0-9a-f]+\.\.[0-9a-f]+.*|From [0-9a-f]{7,40}.*|Date:.*|Author:.*|"
    r"Co-Authored-By:.*|Claude-Session:.*)$",
    re.MULTILINE,
)

TIMESTAMP_RE = re.compile(
    r"\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b"
    r"|\b1[5-9]\d{8}\b"  # plausible epoch-seconds range (~2017-2033)
)

INSTRUCTION_FILE_HUNK_PATHS = (
    "CLAUDE.md", ".claude/skills/", ".claude/settings.json",
)

_HUNK_HEADER_RE = re.compile(r"^diff --git a/(\S+) b/(\S+)", re.MULTILINE)


class Contaminated(Exception):
    """Raised when a diff touches an instruction file — the pair must be
    quarantined rather than judged (§10.2 step 5)."""


def scrub_stoplist(text, extra_terms=None):
    terms = list(DEFAULT_STOPLIST) + list(extra_terms or [])
    for term in terms:
        pattern = re.compile(rf"(?i)\b(?:{term})\b" if r"\b" not in term else term, re.IGNORECASE)
        text = pattern.sub("[REDACTED]", text)
    return text


def scrub_paths(text):
    for pattern, repl in PATH_SCRUB_PATTERNS:
        text = pattern.sub(repl, text)
    text = WORKTREE_DIR_RE.sub("<PATH>", text)
    text = RUN_ID_RE.sub("<RUNID>", text)
    return text


def scrub_patch_metadata(text):
    return PATCH_METADATA_LINE_RE.sub("", text)


def scrub_timestamps(text):
    return TIMESTAMP_RE.sub("<TS>", text)


def _split_hunks(diff_text):
    """Split a unified diff into per-file hunks: list of (header_line, body)."""
    if not diff_text.strip():
        return []
    matches = list(_HUNK_HEADER_RE.finditer(diff_text))
    hunks = []
    for i, m in enumerate(matches):
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(diff_text)
        hunks.append((m.group(1), diff_text[start:end]))
    return hunks


def remove_instruction_file_hunks(diff_text):
    """Returns (cleaned_diff, contaminated: bool, touched_paths: list)."""
    hunks = _split_hunks(diff_text)
    if not hunks:
        return diff_text, False, []
    kept = []
    touched = []
    for path, body in hunks:
        if any(path == p or path.startswith(p) for p in INSTRUCTION_FILE_HUNK_PATHS):
            touched.append(path)
            continue
        kept.append(body)
    cleaned = "".join(kept)
    return cleaned, bool(touched), touched


def leak_scan(text, extra_terms=None):
    """Post-redaction fail-closed scan. Returns list of surviving stoplist
    terms / absolute-path patterns found (empty list = clean)."""
    survivors = []
    terms = list(DEFAULT_STOPLIST) + list(extra_terms or [])
    for term in terms:
        pattern = re.compile(rf"(?i)\b(?:{term})\b" if r"\b" not in term else term, re.IGNORECASE)
        if pattern.search(text):
            survivors.append(term)
    if re.search(r"/home/[^\s\"']+|/tmp/[^\s\"']+", text):
        survivors.append("absolute-path")
    if "[REDACTED]" not in text and "minif" in text.lower():
        # a stray "minif..." that the word-boundary regex above somehow missed
        survivors.append("minif* (unmatched substring)")
    return survivors


def redact_bundle(text, extra_terms=None, is_diff=False):
    """Full pipeline for one text blob. Returns (redacted_text, quarantine_reasons).

    quarantine_reasons is a list of strings; empty means clean. Both
    `judge_bundle_contaminated` (instruction-file hunk) and post-scan leak
    survivors land here.
    """
    reasons = []
    text = scrub_stoplist(text, extra_terms)
    text = scrub_paths(text)
    text = scrub_patch_metadata(text)
    text = scrub_timestamps(text)

    if is_diff:
        text, contaminated, touched = remove_instruction_file_hunks(text)
        if contaminated:
            reasons.append(f"judge_bundle_contaminated: instruction-file hunk(s) removed: {touched}")

    survivors = leak_scan(text, extra_terms)
    if survivors:
        reasons.append(f"leak_scan_survivors: {survivors}")

    return text, reasons


def redact_for_campaign(text, campaign_ids=None, approach_ids=None, is_diff=False):
    extra = list(campaign_ids or []) + list(approach_ids or [])
    extra = [re.escape(x) for x in extra]
    return redact_bundle(text, extra_terms=extra, is_diff=is_diff)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("file", nargs="?")
    ap.add_argument("--diff", action="store_true", help="treat input as a unified diff")
    ap.add_argument("--stoplist-extra", default="")
    ap.add_argument("--out")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if args.selftest:
        ok = _selftest()
        sys.exit(0 if ok else 1)

    if not args.file:
        ap.print_usage(sys.stderr)
        sys.exit(2)

    text = Path(args.file).read_text(encoding="utf-8")
    extra = [t for t in args.stoplist_extra.split(",") if t]
    redacted, reasons = redact_bundle(text, extra, is_diff=args.diff)

    if args.out:
        Path(args.out).write_text(redacted, encoding="utf-8")
    else:
        print(redacted)

    if reasons:
        print("QUARANTINED:", file=sys.stderr)
        for r in reasons:
            print(f"  - {r}", file=sys.stderr)
        sys.exit(1)
    sys.exit(0)


# ── self-test (§14.5) ──────────────────────────────────────────────────

def _selftest():
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        status = "OK" if cond else "FAIL"
        if not cond:
            ok = False
        print(f"  [{status}] {name}" + (f" — {detail}" if detail and not cond else ""))

    # stoplist scrub
    poisoned = "This is the minified variant, produced by our telegraphic compressor. baseline vs arm-a."
    redacted, reasons = redact_bundle(poisoned)
    check("stoplist terms scrubbed", "[REDACTED]" in redacted and "minified" not in redacted.lower())
    check("scrubbed text has no leak-scan survivors", reasons == [] or all("leak_scan" not in r for r in reasons),
          str(reasons))

    # absolute path scrub
    poisoned_path = "See /home/user/vela-slides/.claude/minify-lab/harness/runs/2026-08-14-telegraphic-claudemd/x for detail."
    redacted2, reasons2 = redact_bundle(poisoned_path)
    check("absolute path scrubbed", "/home/user" not in redacted2, redacted2)
    check("minify-lab path scrubbed", "minify-lab" not in redacted2, redacted2)
    check("run id scrubbed", "2026-08-14-telegraphic-claudemd" not in redacted2, redacted2)

    # patch metadata scrub
    patch_meta = (
        "diff --git a/src/parts/part-reducer.jsx b/src/parts/part-reducer.jsx\n"
        "index abc123..def456 100644\n"
        "From 1234567890abcdef1234567890abcdef12345678\n"
        "Date: Thu, 13 Aug 2026 00:00:00 +0000\n"
        "Author: Someone <someone@example.com>\n"
        "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>\n"
        "Claude-Session: https://claude.ai/code/session_abc123\n"
        "@@ -1,3 +1,4 @@\n+added line\n"
    )
    redacted3, reasons3 = redact_bundle(patch_meta, is_diff=True)
    for gone in ("index abc123", "From 1234567890", "Date: Thu", "Author: Someone",
                 "Co-Authored-By", "Claude-Session"):
        check(f"patch metadata line removed: {gone!r}", gone not in redacted3, redacted3)
    check("actual diff content survives", "+added line" in redacted3, redacted3)

    # timestamp scrub
    ts_text = "Started at 2026-08-13T10:15:00Z and epoch 1755079200 during the run."
    redacted4, _ = redact_bundle(ts_text)
    check("ISO timestamp scrubbed", "2026-08-13T10:15:00Z" not in redacted4, redacted4)
    check("epoch seconds scrubbed", "1755079200" not in redacted4, redacted4)

    # instruction-file hunk removal + contamination flag
    diff_with_instr = (
        "diff --git a/src/parts/part-reducer.jsx b/src/parts/part-reducer.jsx\n"
        "@@ -1,2 +1,3 @@\n+case 'SET_TOC_FILTER':\n"
        "diff --git a/CLAUDE.md b/CLAUDE.md\n"
        "@@ -10,2 +10,2 @@\n-old rule\n+new rule\n"
    )
    redacted5, reasons5 = redact_bundle(diff_with_instr, is_diff=True)
    check("CLAUDE.md hunk removed from bundle", "CLAUDE.md" not in redacted5, redacted5)
    check("non-instruction hunk survives", "SET_TOC_FILTER" in redacted5, redacted5)
    check("contamination flagged", any("judge_bundle_contaminated" in r for r in reasons5), str(reasons5))

    diff_with_skill = (
        "diff --git a/.claude/skills/vela-secure-coding/SKILL.md b/.claude/skills/vela-secure-coding/SKILL.md\n"
        "@@ -1,1 +1,1 @@\n-a\n+b\n"
    )
    _, reasons5b = redact_bundle(diff_with_skill, is_diff=True)
    check("skill-dir hunk also flags contamination", any("judge_bundle_contaminated" in r for r in reasons5b))

    # leak scan catches a survivor the scrub missed (simulated by disabling
    # scrub and calling leak_scan directly on unredacted text)
    unredacted = "the minified version wins on this dimension"
    survivors = leak_scan(unredacted)
    check("leak_scan flags an unredacted stoplist term", len(survivors) > 0, str(survivors))

    # clean bundle passes untouched (modulo whitespace)
    clean = "This change adds a new reducer action and updates the manifest file."
    redacted6, reasons6 = redact_bundle(clean, is_diff=False)
    check("clean bundle has no quarantine reasons", reasons6 == [], str(reasons6))
    check("clean bundle's meaningful content is preserved",
          "reducer action" in redacted6 and "manifest file" in redacted6)

    if ok:
        print("redact.py --selftest: ALL OK")
    else:
        print("redact.py --selftest: FAILURES ABOVE")
    return ok


if __name__ == "__main__":
    main()
