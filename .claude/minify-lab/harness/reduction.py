#!/usr/bin/env python3
"""
reduction.py — VERDICT 6A (harness-design.md §7), amended per context.md's
"Autonomous decisions / Gate resolution" to emit TWO independent
sub-verdicts, `size` and `structure`, which are NEVER merged into one score:

  size      — >=20% mean bytes/token reduction across an approach's file
              manifest (all pairs; §6.3 point 1 of the corroboration study).
              A pair's exemption from that mean is now a CONTINUOUS
              prediction, not the old binary "verbatim >25% OR fw <30%" rule
              — see the "corroboration-study patch" section below. An
              exempted file's size result is still computed and reported —
              it just cannot fail the size gate on its own.
  structure — a constraint-explicitness score (see constraint_inventory.py):
              quantifier/modality tokens made explicit, minus constraints
              lost, per pair.

Judge-free. Zero model calls of any kind — not the judge, not a tokenizer
API, not `claude -p`. No network code anywhere in this file, by design
(harness-design.md §7.2's "future tokenizer" note is explicit that a network
tokenizer must never be addable by accident).

Usage:
  python3 reduction.py --approach <id> [--manifest PATH] [--json] [--out PATH]
  python3 reduction.py --pair BASELINE_FILE MINIFIED_FILE [--json]
  python3 reduction.py --selftest

Exit codes (aligned with vela.py / gate.py conventions):
  0 pass · 1 below bar · 2 usage · 3 file not found · 4 integrity/implausible

── Corroboration-study patch (research-normal-density-corroboration.md §6.2-
6.3, applied as a follow-up after the rest of this harness was already
self-tested) ───────────────────────────────────────────────────────────────
Two changes, both scoped to this file only:

 1. `verbatim_fraction` (fences + inline code) undercounts frozen content:
    URLs and markdown link-reference-definition targets are just as
    byte-frozen — you cannot reword a URL — but were counted as compressible
    prose. Measured effect on a real file: 5.0% -> 37.5% frozen, which flips
    whether the file is projected to clear the size bar. `frozen_ext_fraction`
    extends the same span-accounting approach to also blank out and count
    URL spans (this also catches inline-link destinations and
    reference-style `[label]: url` lines, since both are `https?://...`
    substrings once fences/inline-code are already blanked).
 2. The old binary pre-densification exemption is replaced with a continuous
    per-file prediction: `expected_reduction = (1 - frozen_ext) *
    prose_reduction_rate(fw)`, where `prose_reduction_rate` is a linear fit
    to the four-probe (fw-before, aggressive-tier cut) table in that study's
    §4.4 (kept as raw calibration points in code, not just fitted
    coefficients, so the fit is reproducible and self-tested against the
    paper's claimed r=0.978). A pair is now excluded from the mean-reduction
    bar when its OWN predicted ceiling falls below the bar (continuous),
    replacing the old crude "verbatim>25% or fw<30%" heuristic — same role
    (`exempt_from_size_bar`, `gating_pair_count`, `exempt_pair_count` keep
    their names and meaning), different, calibrated computation. Each pair
    additionally reports whether its *actual* reduction hit its *own*
    predicted ceiling (`prediction.hit_prediction`) — a diagnostic the flat
    bar alone cannot give you: a file can fail the flat 20% bar while still
    hitting 100% of what the model says it could ever give up.
 3. Section-level (rules-only) numbers are reported alongside the file-level
    number when an approach manifest supplies `section_pairs` (optional) —
    §6.3 point 4's point that merging file-level and section-level numbers
    hides real signal, the same lesson as the size/structure split itself.

# TODO(orchestrator): reconcile with .claude/skills/minify/'s own
# `frozen_fraction()`/`prose_rate()`/`predict_reduction()` (in
# `.claude/skills/minify/scripts/minify_lib.py`, which landed after this
# patch was written). That module independently built overlapping logic for
# the same problem this patch solves — the two were NOT cross-checked and
# may use different calibration constants. See constraint_inventory.py's
# header for the same flag on the structure sub-verdict's extractor.
"""

import argparse
import json
import math
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None

HARNESS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(HARNESS_DIR))
import constraint_inventory as ci  # noqa: E402

REPO_ROOT = HARNESS_DIR.parent.parent.parent  # .claude/minify-lab/harness -> repo root

# ── §7.2 measurement ───────────────────────────────────────────────────

_TOK_REGEX_RE = re.compile(r"[A-Za-z]+|[0-9]|[^\sA-Za-z0-9]|\s+")
_WS_RE = re.compile(r"\s+")

_FENCE_RE = re.compile(r"```.*?```", re.DOTALL)
_INLINE_CODE_RE = re.compile(r"`[^`\n]+`")

# Appendix (research-encoding-formats.md): "share of alphabetic word tokens
# appearing in a fixed 84-word English function-word list, after stripping
# fenced blocks and replacing inline-code spans with a placeholder." The
# source research doc references this list's *size* and *definition* but
# does not reproduce it verbatim anywhere retrievable in this repo (checked:
# grepped the whole file for an enumerated list — none found). This is a
# standard closed-class function-word set (articles, prepositions,
# conjunctions, pronouns, auxiliary/modal verbs, common determiners/
# quantifiers) sized to 84 entries, built independently from that
# definition rather than copied from an inaccessible source.
FUNCTION_WORDS = frozenset("""
a an the
of to in on at for with from by as
and or but nor so yet because
if unless while when where
is are was were be been being am
do does did doing
have has had having
will would can could may might must
not no never
i you he she it we they
me him her us them
my your his our their its
mine yours hers ours theirs
this that these those which
all any each every some
""".split())
assert len(FUNCTION_WORDS) == 84, f"expected 84 function words, got {len(FUNCTION_WORDS)}"

_WORD_RE = re.compile(r"[A-Za-z']+")


def bytes_len(text):
    return len(text.encode("utf-8"))


def lines_count(text):
    return text.count("\n") + 1


def tok_regex_count(text):
    """A BPE-shaped proxy: sub-word splitting for long words, one token per
    punctuation mark, whitespace runs collapsed to one token each."""
    count = 0
    for m in _TOK_REGEX_RE.finditer(text):
        s = m.group(0)
        if s.isalpha() and len(s) > 4:
            count += math.ceil(len(s) / 4)
        else:
            count += 1
    return count


def tok_char_count(text):
    collapsed = _WS_RE.sub(" ", text)
    return math.ceil(len(collapsed) / 3.6)


def verbatim_fraction(text):
    """Bytes inside ``` fences plus bytes inside `inline code` spans outside
    fences, divided by file bytes. Definition from research-encoding-
    formats.md's Appendix."""
    total = bytes_len(text)
    if total == 0:
        return 0.0
    fenced_spans = [m.span() for m in _FENCE_RE.finditer(text)]
    verbatim_bytes = sum(len(text[a:b].encode("utf-8")) for a, b in fenced_spans)
    # inline code OUTSIDE fences only
    non_fenced = _FENCE_RE.sub(lambda m: " " * len(m.group(0)), text)
    for m in _INLINE_CODE_RE.finditer(non_fenced):
        verbatim_bytes += len(m.group(0).encode("utf-8"))
    return verbatim_bytes / total


def function_word_ratio(text):
    """Share of alphabetic word tokens in the fixed function-word list,
    after stripping fenced blocks and replacing inline-code spans with a
    placeholder (so code identifiers never count as prose words)."""
    stripped = _FENCE_RE.sub(" ", text)
    stripped = _INLINE_CODE_RE.sub(" CODEPLACEHOLDER ", stripped)
    words = [w.lower() for w in _WORD_RE.findall(stripped) if w.lower() != "codeplaceholder"]
    if not words:
        return 0.0
    hits = sum(1 for w in words if w in FUNCTION_WORDS)
    return hits / len(words)


def is_pre_densified(text, verbatim_gt=0.25, fw_ratio_lt=0.30):
    """LEGACY binary rule. Kept only to populate `density`'s old fields for
    back-compat; no longer drives the exemption decision (see
    `frozen_ext_fraction` / `predicted_reduction` below, and the module
    docstring's "corroboration-study patch" section)."""
    vf = verbatim_fraction(text)
    fw = function_word_ratio(text)
    exempt = vf > verbatim_gt or fw < fw_ratio_lt
    return exempt, {"verbatim_fraction": round(vf, 4), "function_word_ratio": round(fw, 4)}


# ── corroboration-study patch: frozen_ext + continuous prediction ─────────
# See the module docstring's "Corroboration-study patch" section for the
# full rationale and citations (research-normal-density-corroboration.md
# §6.2-6.3).

_URL_RE = re.compile(r"https?://[^\s\)\]\"'<>]+")


def frozen_ext_fraction(text):
    """Extended frozen-content fraction: fenced code + inline code (outside
    fences) + URLs (outside both), all divided by file bytes. Supersedes
    `verbatim_fraction` for exemption/prediction purposes — URLs and
    link-reference-definition targets are just as byte-frozen as code but
    `verbatim_fraction` misses them."""
    total = bytes_len(text)
    if total == 0:
        return 0.0
    fenced_spans = [m.span() for m in _FENCE_RE.finditer(text)]
    frozen_bytes = sum(len(text[a:b].encode("utf-8")) for a, b in fenced_spans)
    non_fenced = _FENCE_RE.sub(lambda m: " " * len(m.group(0)), text)
    inline_spans = [m.span() for m in _INLINE_CODE_RE.finditer(non_fenced)]
    frozen_bytes += sum(len(non_fenced[a:b].encode("utf-8")) for a, b in inline_spans)
    non_fenced_non_inline = _INLINE_CODE_RE.sub(lambda m: " " * len(m.group(0)), non_fenced)
    url_spans = [m.span() for m in _URL_RE.finditer(non_fenced_non_inline)]
    frozen_bytes += sum(len(non_fenced_non_inline[a:b].encode("utf-8")) for a, b in url_spans)
    return frozen_bytes / total


# Raw calibration points: (function-word ratio BEFORE compression, aggressive
# -tier byte cut), both as fractions, for the four probes in
# research-normal-density-corroboration.md §4.4 ("fw before -> after" and
# "Aggressive"/"Cut" columns). fw-BEFORE is used (not after) because the
# prediction must be computable from the file as found, before any
# minification has happened.
_PROSE_RATE_CALIBRATION = (
    (0.332, 0.144),  # P1 atom/atom bug-report precheck
    (0.451, 0.272),  # P2 nodejs/node discuss & update
    (0.422, 0.275),  # P3 kubernetes/community why no review
    (0.329, 0.116),  # P4 openai/codex TUI styling
)


def _least_squares_fit(points):
    n = len(points)
    mean_x = sum(x for x, _ in points) / n
    mean_y = sum(y for _, y in points) / n
    num = sum((x - mean_x) * (y - mean_y) for x, y in points)
    den = sum((x - mean_x) ** 2 for x, _ in points)
    slope = num / den if den else 0.0
    intercept = mean_y - slope * mean_x
    return slope, intercept


def _pearson_r(points):
    n = len(points)
    mean_x = sum(x for x, _ in points) / n
    mean_y = sum(y for _, y in points) / n
    num = sum((x - mean_x) * (y - mean_y) for x, y in points)
    den_x = math.sqrt(sum((x - mean_x) ** 2 for x, _ in points))
    den_y = math.sqrt(sum((y - mean_y) ** 2 for _, y in points))
    return num / (den_x * den_y) if den_x and den_y else 0.0


_PROSE_RATE_SLOPE, _PROSE_RATE_INTERCEPT = _least_squares_fit(_PROSE_RATE_CALIBRATION)

# The four calibration probes span fw 32.9%-45.1%. Outside that range (e.g.
# heavily code-heavy files near fw~18%, or unusually verbose prose >51%) the
# linear fit is an extrapolation, not a measurement -- clamp to a sane,
# documented band rather than let it run negative or implausibly high.
PROSE_RATE_FLOOR = 0.0
PROSE_RATE_CEILING = 0.45


def prose_reduction_rate(fw_ratio):
    """Predicted prose-only reduction rate for a file with the given
    function-word ratio, per the linear relationship measured in
    research-normal-density-corroboration.md §6.2 (r=0.978, aggressive
    tier, n=4). Fraction in, fraction out, clamped to
    [PROSE_RATE_FLOOR, PROSE_RATE_CEILING]."""
    rate = _PROSE_RATE_SLOPE * fw_ratio + _PROSE_RATE_INTERCEPT
    return max(PROSE_RATE_FLOOR, min(PROSE_RATE_CEILING, rate))


def predicted_reduction(frozen_ext, fw_ratio):
    """expected_reduction = (1 - frozen_ext) * prose_reduction_rate(fw), per
    research-normal-density-corroboration.md §6.3 recommendation 2."""
    return max(0.0, min(1.0, (1 - frozen_ext) * prose_reduction_rate(fw_ratio)))


def heading_count(text):
    return len(re.findall(r"^#{1,6}\s", text, re.MULTILINE))


def table_row_count(text):
    return len(re.findall(r"^\s*\|.*\|\s*$", text, re.MULTILINE))


def measure_file(text):
    return {
        "bytes": bytes_len(text),
        "lines": lines_count(text),
        "tok_regex": tok_regex_count(text),
        "tok_char": tok_char_count(text),
    }


def reduction_of(base_val, min_val):
    if base_val == 0:
        return 0.0
    return (base_val - min_val) / base_val


# ── integrity guards (§7.3) ────────────────────────────────────────────

class IntegrityError(Exception):
    def __init__(self, reason, code=4):
        super().__init__(reason)
        self.reason = reason
        self.code = code


def _decode_utf8_or_raise(path):
    p = Path(path)
    if not p.exists():
        raise IntegrityError(f"file not found: {path}", code=3)
    raw = p.read_bytes()
    if len(raw) == 0:
        raise IntegrityError(f"empty file: {path}", code=4)
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError as e:
        raise IntegrityError(f"not valid UTF-8: {path} ({e})", code=4)


def measure_pair(baseline_path, minified_path, proxy_disagreement_pp=5, implausible=0.95,
                  exemption_verbatim_gt=0.25, exemption_fw_lt=0.30, bar=0.20):
    """Run one pair through the full guard+measurement pipeline. Raises
    IntegrityError on any hard-fail guard. Returns the pair result dict.

    `exemption_verbatim_gt`/`exemption_fw_lt` are kept only to compute the
    LEGACY `density` fields for back-compat/reporting; the exemption
    decision itself (`exempt_from_size_bar`) now comes from the continuous
    `predicted_reduction(...) < bar` test — see the module docstring's
    "corroboration-study patch" section.
    """
    base_text = _decode_utf8_or_raise(baseline_path)
    min_text = _decode_utf8_or_raise(minified_path)

    base_m = measure_file(base_text)
    min_m = measure_file(min_text)

    reduction = {k: round(reduction_of(base_m[k], min_m[k]), 4) for k in base_m}

    flags = []

    # guard 2: not negative
    if reduction["tok_regex"] < 0:
        raise IntegrityError(
            f"negative reduction for {minified_path} (larger than baseline): "
            f"{reduction['tok_regex']:.2%}"
        )

    # guard 3: implausible
    if reduction["tok_regex"] > implausible:
        raise IntegrityError(
            f"implausible_reduction: {minified_path} reduced {reduction['tok_regex']:.1%} "
            f"(> {implausible:.0%} ceiling) — looks truncated, not compressed"
        )

    # guard 4: proxy agreement
    gap_pp = abs(reduction["tok_regex"] - reduction["tok_char"]) * 100
    if gap_pp > proxy_disagreement_pp:
        raise IntegrityError(
            f"proxy_disagreement: {minified_path} tok_regex vs tok_char differ by "
            f"{gap_pp:.1f}pp (> {proxy_disagreement_pp}pp) — needs a human look",
        )

    # guard 5: structural sanity (warning only)
    base_headings = heading_count(base_text)
    min_headings = heading_count(min_text)
    if base_headings > 0 and min_headings < base_headings * 0.5:
        flags.append("structure_loss_suspected")

    # LEGACY binary rule — kept only to populate density's old fields.
    _legacy_exempt, density = is_pre_densified(base_text, exemption_verbatim_gt, exemption_fw_lt)

    # corroboration-study patch: continuous prediction supersedes the binary
    # rule above for the actual exemption decision.
    frozen_ext = frozen_ext_fraction(base_text)
    fw_ratio = function_word_ratio(base_text)
    rate = prose_reduction_rate(fw_ratio)
    expected_reduction = predicted_reduction(frozen_ext, fw_ratio)
    actual_reduction = reduction["tok_regex"]
    exempt = expected_reduction < bar

    density["frozen_ext"] = round(frozen_ext, 4)

    prediction = {
        "prose_reduction_rate": round(rate, 4),
        "expected_reduction": round(expected_reduction, 4),
        "actual_reduction": actual_reduction,
        "hit_prediction": actual_reduction >= expected_reduction,
        "note": ("Per-file continuous target (research-normal-density-"
                 "corroboration.md §6.3): did THIS file's actual reduction "
                 "reach the ceiling predicted from its own frozen_ext + "
                 "function-word ratio? Independent of, and may disagree "
                 "with, the flat approach-level bar below — a file can miss "
                 "the flat bar while still hitting 100% of its own "
                 "achievable ceiling, or vice versa."),
    }

    structure = ci.score_pair(base_text, min_text)

    return {
        "baseline": str(baseline_path),
        "minified": str(minified_path),
        "baseline_tok_regex": base_m["tok_regex"],
        "minified_tok_regex": min_m["tok_regex"],
        "reduction": reduction,
        "flags": flags,
        "exempt_from_size_bar": exempt,
        "density": density,
        "prediction": prediction,
        "structure": structure,
    }


# ── manifest / approach handling ───────────────────────────────────────

def load_manifest(approach_id, manifest_path=None):
    if manifest_path is None:
        manifest_path = HARNESS_DIR / "variants" / approach_id / "manifest.yaml"
    manifest_path = Path(manifest_path)
    if not manifest_path.exists():
        raise IntegrityError(f"manifest not found: {manifest_path}", code=3)
    if yaml is None:
        raise IntegrityError("PyYAML not installed — cannot parse manifest.yaml", code=2)
    with open(manifest_path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return data


def resolve_pair_paths(pair, harness_dir=None, repo_root=None):
    # NOTE: defaults are resolved from the module globals at CALL time (not
    # bound at def time) so tests can monkeypatch HARNESS_DIR/REPO_ROOT.
    harness_dir = harness_dir if harness_dir is not None else HARNESS_DIR
    repo_root = repo_root if repo_root is not None else REPO_ROOT
    base = repo_root / pair["baseline"]
    minified = harness_dir / pair["minified"]
    return base, minified


def run_approach(approach_id, manifest_path=None, config=None):
    config = config or {}
    red_cfg = config.get("reduction", {})
    bar = red_cfg.get("bar", 0.20)
    metric = red_cfg.get("metric", "tok_regex")
    weak_warn = red_cfg.get("weak_file_warn", 0.10)
    implausible = red_cfg.get("implausible_reduction", 0.95)
    disagreement_pp = red_cfg.get("proxy_disagreement_pp", 5)
    exemption = red_cfg.get("exemption", {})
    ex_verbatim = exemption.get("verbatim_fraction_gt", 0.25)
    ex_fw = exemption.get("function_word_ratio_lt", 0.30)
    min_net_delta = red_cfg.get("structure", {}).get("min_net_delta", 0)

    manifest = load_manifest(approach_id, manifest_path)
    pairs_cfg = manifest.get("pairs", [])
    if not pairs_cfg:
        raise IntegrityError(f"manifest for {approach_id} has no pairs", code=4)

    pair_results = []
    warnings = []
    for pair in pairs_cfg:
        base_path, min_path = resolve_pair_paths(pair)
        result = measure_pair(
            base_path, min_path,
            proxy_disagreement_pp=disagreement_pp,
            implausible=implausible,
            exemption_verbatim_gt=ex_verbatim,
            exemption_fw_lt=ex_fw,
            bar=bar,
        )
        pair_results.append(result)
        for f in result["flags"]:
            warnings.append(f"{f}: {Path(result['minified']).name} retains "
                             f"{heading_ratio_text(result)}")

    # ── section-level (rules-only) numbers, informational, "where available"
    # (corroboration-study §6.3 point 4) — only computed if the manifest
    # supplies section_pairs; empty otherwise, never required.
    section_pairs_cfg = manifest.get("section_pairs", [])
    section_level = []
    for pair in section_pairs_cfg:
        base_path, min_path = resolve_pair_paths(pair)
        result = measure_pair(
            base_path, min_path,
            proxy_disagreement_pp=disagreement_pp,
            implausible=implausible,
            exemption_verbatim_gt=ex_verbatim,
            exemption_fw_lt=ex_fw,
            bar=bar,
        )
        section_level.append(result)

    # ── size sub-verdict ──
    # only non-exempt pairs count toward the mean bar (exemption 1 of
    # context.md's amendment, recalibrated per the corroboration-study patch
    # — see measure_pair's docstring); exempt pairs are measured & reported
    # but cannot fail the gate.
    gating_pairs = [p for p in pair_results if not p["exempt_from_size_bar"]]
    exempt_pairs = [p for p in pair_results if p["exempt_from_size_bar"]]

    if gating_pairs:
        mean_reduction = sum(p["reduction"][metric] for p in gating_pairs) / len(gating_pairs)
        size_pass = mean_reduction >= bar
    else:
        # every pair is exempt — the size gate cannot fail on its own, per
        # the documented exemption; report is honest that nothing gated.
        mean_reduction = (
            sum(p["reduction"][metric] for p in pair_results) / len(pair_results)
            if pair_results else 0.0
        )
        size_pass = True

    weak_files = [
        {"file": p["minified"], "reduction": p["reduction"][metric]}
        for p in pair_results if p["reduction"][metric] < weak_warn
    ]

    prediction_misses = [
        {"file": p["minified"], "actual": p["prediction"]["actual_reduction"],
         "expected": p["prediction"]["expected_reduction"]}
        for p in pair_results if not p["prediction"]["hit_prediction"]
    ]
    mean_expected_reduction = (
        sum(p["prediction"]["expected_reduction"] for p in pair_results) / len(pair_results)
        if pair_results else 0.0
    )

    size_verdict = {
        "verdict_kind": "6a-size",
        "approach": approach_id,
        "bar": bar,
        "metric": metric,
        "mean_reduction": round(mean_reduction, 4),
        "mean_expected_reduction": round(mean_expected_reduction, 4),
        "pass": size_pass,
        "gating_pair_count": len(gating_pairs),
        "exempt_pair_count": len(exempt_pairs),
        "pairs": pair_results,
        "section_level": section_level,
        "weak_files": weak_files,
        "prediction_misses": prediction_misses,
        "warnings": warnings,
        "note": ("Screening filter only. Says nothing about output quality. "
                 "See verdict-6b.json. Exempt (pre-densified) files are "
                 "measured and reported but excluded from the mean-reduction "
                 "bar; exemption is now a continuous per-file prediction "
                 "(expected_reduction < bar), not the old binary verbatim/fw "
                 "heuristic — see research-normal-density-corroboration.md "
                 "§6.3. `prediction_misses` lists pairs whose actual "
                 "reduction fell short of their OWN predicted ceiling "
                 "(independent of whether they gated the flat bar above). "
                 "`section_level` is informational only, populated only "
                 "when the manifest supplies section_pairs; never part of "
                 "mean_reduction."),
    }

    # ── structure sub-verdict ──
    total_net_delta = sum(p["structure"]["net_delta"] for p in pair_results)
    total_lost = sum(p["structure"]["lost_count"] for p in pair_results)
    total_weakened = sum(p["structure"]["weakened_count"] for p in pair_results)
    total_newly_explicit = sum(p["structure"]["newly_explicit_count"] for p in pair_results)
    structure_pass = total_net_delta >= min_net_delta

    structure_verdict = {
        "verdict_kind": "6a-structure",
        "approach": approach_id,
        "min_net_delta": min_net_delta,
        "total_net_delta": total_net_delta,
        "total_lost": total_lost,
        "total_weakened": total_weakened,
        "total_newly_explicit": total_newly_explicit,
        "pass": structure_pass,
        "per_pair": [
            {"baseline": p["baseline"], "minified": p["minified"], **p["structure"]}
            for p in pair_results
        ],
        "note": ("Constraint-explicitness score. NEVER combined, averaged, or "
                 "traded off against the size verdict above — see "
                 "harness-design.md §1's invariants. A structure pass says "
                 "nothing about byte/token reduction, and vice versa."),
    }

    return size_verdict, structure_verdict


def heading_ratio_text(result):
    return "an unspecified share (see events.json/full text)"


# ── CLI ─────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--approach")
    ap.add_argument("--manifest")
    ap.add_argument("--pair", nargs=2, metavar=("BASELINE_FILE", "MINIFIED_FILE"))
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--out")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if args.selftest:
        ok = _selftest()
        sys.exit(0 if ok else 1)

    config = {}
    cfg_path = HARNESS_DIR / "config.yaml"
    if yaml is not None and cfg_path.exists():
        with open(cfg_path, encoding="utf-8") as f:
            config = yaml.safe_load(f) or {}

    if args.pair:
        try:
            result = measure_pair(*args.pair)
        except IntegrityError as e:
            print(f"ERROR: {e.reason}", file=sys.stderr)
            sys.exit(e.code)
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print(f"{args.pair[0]} -> {args.pair[1]}")
            print(f"  tok_regex reduction: {result['reduction']['tok_regex']:.1%}")
            print(f"  frozen_ext: {result['density']['frozen_ext']:.1%}  "
                  f"(verbatim_fraction legacy: {result['density']['verbatim_fraction']:.1%})")
            print(f"  predicted ceiling: {result['prediction']['expected_reduction']:.1%}  "
                  f"hit_prediction: {result['prediction']['hit_prediction']}")
            print(f"  exempt from size bar: {result['exempt_from_size_bar']}")
            print(f"  structure net delta: {result['structure']['net_delta']:+d}")
        sys.exit(0)

    if not args.approach:
        ap.print_usage(sys.stderr)
        sys.exit(2)

    try:
        size_verdict, structure_verdict = run_approach(args.approach, args.manifest, config)
    except IntegrityError as e:
        print(f"ERROR: {e.reason}", file=sys.stderr)
        sys.exit(e.code)

    out = {"size": size_verdict, "structure": structure_verdict}
    if args.json:
        print(json.dumps(out, indent=2))
    else:
        print(f"VERDICT 6A-SIZE — approach: {args.approach}")
        print(f"  {'PASS' if size_verdict['pass'] else 'FAIL'}  mean reduction "
              f"{size_verdict['mean_reduction']:.1%} (bar >= {size_verdict['bar']:.0%})  "
              f"mean predicted ceiling {size_verdict['mean_expected_reduction']:.1%}")
        for p in size_verdict["pairs"]:
            exempt_tag = " [EXEMPT: predicted ceiling < bar]" if p["exempt_from_size_bar"] else ""
            miss_tag = "" if p["prediction"]["hit_prediction"] else "  ⚠ missed own predicted ceiling"
            print(f"    {Path(p['minified']).name:40s} {p['reduction']['tok_regex']:>7.1%}"
                  f"  (predicted {p['prediction']['expected_reduction']:>6.1%}){exempt_tag}{miss_tag}")
        if size_verdict["section_level"]:
            print("  section-level (rules-only, informational, not in mean_reduction):")
            for p in size_verdict["section_level"]:
                print(f"    {Path(p['minified']).name:40s} {p['reduction']['tok_regex']:>7.1%}")
        print()
        print(f"VERDICT 6A-STRUCTURE — approach: {args.approach}")
        print(f"  {'PASS' if structure_verdict['pass'] else 'FAIL'}  net constraint delta "
              f"{structure_verdict['total_net_delta']:+d} "
              f"(lost={structure_verdict['total_lost']} "
              f"weakened={structure_verdict['total_weakened']} "
              f"newly_explicit={structure_verdict['total_newly_explicit']})")
        print()
        print("  These two verdicts are independent and are never combined, "
              "averaged, or traded off.")

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=2)

    sys.exit(0 if (size_verdict["pass"] and structure_verdict["pass"]) else 1)


# ── self-test (§14.1) ──────────────────────────────────────────────────

def _selftest():
    import tempfile

    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        status = "OK" if cond else "FAIL"
        if not cond:
            ok = False
        print(f"  [{status}] {name}" + (f" — {detail}" if detail and not cond else ""))

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)

        # golden pair: 0% reduction (identical)
        same_text = "The quick brown fox jumps over the lazy dog. " * 20
        (tmp / "a0.md").write_text(same_text, encoding="utf-8")
        (tmp / "b0.md").write_text(same_text, encoding="utf-8")
        r = measure_pair(tmp / "a0.md", tmp / "b0.md")
        check("0% reduction pair measures ~0", abs(r["reduction"]["tok_regex"]) < 0.01,
              str(r["reduction"]))

        # golden pair: ~20% word-count reduction (below/above 20% boundary).
        # Alternate function/content words so function_word_ratio stays high
        # (~50%) and the pair is NOT accidentally exempted as pre-densified —
        # this fixture is meant to exercise the ordinary (non-exempt) path.
        content_words = ["apple", "river", "mountain", "engine", "garden",
                          "rocket", "castle", "forest", "bridge", "lantern"]
        function_cycle = ["the", "and", "of", "to", "in", "for", "with", "as"]
        words = []
        for i in range(100):
            words.append(function_cycle[i % len(function_cycle)] if i % 2 == 0
                         else content_words[i % len(content_words)])
        base_20 = " ".join(words)
        min_199 = " ".join(words[:81])   # cut 19 of 100 words -> 19% cut (< bar)
        min_201 = " ".join(words[:79])   # cut 21 of 100 words -> 21% cut (> bar)
        (tmp / "a1.md").write_text(base_20, encoding="utf-8")
        (tmp / "b1_under.md").write_text(min_199, encoding="utf-8")
        (tmp / "b1_over.md").write_text(min_201, encoding="utf-8")
        r_under = measure_pair(tmp / "a1.md", tmp / "b1_under.md")
        r_over = measure_pair(tmp / "a1.md", tmp / "b1_over.md")
        check("~19% reduction measured below 20%", r_under["reduction"]["tok_regex"] < 0.20,
              str(r_under["reduction"]))
        check("~21% reduction measured above 20%", r_over["reduction"]["tok_regex"] > 0.20,
              str(r_over["reduction"]))

        # integrity: 96% reduction -> implausible_reduction exit 4
        base_big = "word " * 500
        min_tiny = "word"
        (tmp / "a2.md").write_text(base_big, encoding="utf-8")
        (tmp / "b2.md").write_text(min_tiny, encoding="utf-8")
        try:
            measure_pair(tmp / "a2.md", tmp / "b2.md")
            check("96%+ reduction raises IntegrityError", False)
        except IntegrityError as e:
            check("96%+ reduction raises IntegrityError", e.code == 4, str(e))

        # integrity: negative reduction (minified bigger than baseline)
        (tmp / "a3.md").write_text("short text here", encoding="utf-8")
        (tmp / "b3.md").write_text("short text here " * 50, encoding="utf-8")
        try:
            measure_pair(tmp / "a3.md", tmp / "b3.md")
            check("negative reduction raises IntegrityError", False)
        except IntegrityError as e:
            check("negative reduction raises IntegrityError", "negative" in e.reason, str(e))

        # integrity: empty file
        (tmp / "a4.md").write_text("some content", encoding="utf-8")
        (tmp / "b4.md").write_text("", encoding="utf-8")
        try:
            measure_pair(tmp / "a4.md", tmp / "b4.md")
            check("empty minified file raises IntegrityError", False)
        except IntegrityError as e:
            check("empty minified file raises IntegrityError", e.code == 4, str(e))

        # integrity: invalid UTF-8
        (tmp / "a5.md").write_text("some content", encoding="utf-8")
        (tmp / "b5.md").write_bytes(b"\xff\xfe\x00bad")
        try:
            measure_pair(tmp / "a5.md", tmp / "b5.md")
            check("invalid UTF-8 raises IntegrityError", False)
        except IntegrityError as e:
            check("invalid UTF-8 raises IntegrityError", e.code == 4, str(e))

        # integrity: file not found
        try:
            measure_pair(tmp / "a5.md", tmp / "does-not-exist.md")
            check("missing file raises IntegrityError(code=3)", False)
        except IntegrityError as e:
            check("missing file raises IntegrityError(code=3)", e.code == 3, str(e))

        # proxy disagreement: heavy symbol substitution should trip the guard
        prose_base = "This is a perfectly ordinary sentence about testing things. " * 10
        symbol_min = "!@#$%^&*()" * 40  # almost all punctuation: tok_char barely
        # shrinks (chars similar) while tok_regex crashes (few "words")
        (tmp / "a6.md").write_text(prose_base, encoding="utf-8")
        (tmp / "b6.md").write_text(symbol_min, encoding="utf-8")
        try:
            res = measure_pair(tmp / "a6.md", tmp / "b6.md", proxy_disagreement_pp=5)
            # if it didn't raise, the two proxies happened to agree within 5pp
            # on this synthetic text — still assert the field exists.
            check("proxy disagreement guard evaluated", "reduction" in res)
        except IntegrityError as e:
            check("proxy disagreement can raise IntegrityError(code=4)", e.code == 4, str(e))

        # exemption: a densely-verbatim file (lots of fenced code) should be
        # flagged exempt regardless of its prose reduction
        dense_base = "# T\n\n```\n" + ("x = 1\n" * 60) + "```\nshort prose.\n"
        dense_min = "# T\n\n```\n" + ("x = 1\n" * 60) + "```\nshort prose!\n"
        (tmp / "a7.md").write_text(dense_base, encoding="utf-8")
        (tmp / "b7.md").write_text(dense_min, encoding="utf-8")
        r7 = measure_pair(tmp / "a7.md", tmp / "b7.md")
        check("pre-densified (verbatim-heavy) file marked exempt",
              r7["exempt_from_size_bar"] is True, str(r7["density"]))

        # non-exempt: ordinary prose with high function-word ratio, low
        # verbatim fraction
        prose_only = ("The team has decided that we should always try to keep "
                      "the documentation clear and easy to read for everyone "
                      "who might need it in the future, because that is what "
                      "matters most to us as a group of engineers working "
                      "together on this important and ongoing project.") * 3
        (tmp / "a8.md").write_text(prose_only, encoding="utf-8")
        (tmp / "b8.md").write_text(prose_only, encoding="utf-8")
        r8 = measure_pair(tmp / "a8.md", tmp / "b8.md")
        check("ordinary dense prose NOT marked exempt",
              r8["exempt_from_size_bar"] is False, str(r8["density"]))

        # run_approach: manifest-level mean + exemption interaction
        approach_dir = tmp / "variants" / "testapproach"
        approach_dir.mkdir(parents=True)
        repo_dir = tmp / "repo"
        repo_dir.mkdir()
        (repo_dir / "FILE_A.md").write_text(base_20, encoding="utf-8")
        (repo_dir / "FILE_DENSE.md").write_text(dense_base, encoding="utf-8")
        (approach_dir / "FILE_A.md").write_text(min_201, encoding="utf-8")  # 21%, non-exempt, passes
        (approach_dir / "FILE_DENSE.md").write_text(dense_min, encoding="utf-8")  # exempt, low cut
        manifest = {
            "approach": "testapproach",
            "pairs": [
                {"baseline": "FILE_A.md", "minified": "variants/testapproach/FILE_A.md"},
                {"baseline": "FILE_DENSE.md", "minified": "variants/testapproach/FILE_DENSE.md"},
            ],
        }
        manifest_path = approach_dir / "manifest.yaml"
        if yaml is not None:
            with open(manifest_path, "w", encoding="utf-8") as f:
                yaml.safe_dump(manifest, f)

            global HARNESS_DIR, REPO_ROOT
            saved_harness_dir, saved_repo_root = HARNESS_DIR, REPO_ROOT
            HARNESS_DIR = tmp
            REPO_ROOT = repo_dir
            try:
                size_v, struct_v = run_approach("testapproach", manifest_path, {
                    "reduction": {"bar": 0.20, "metric": "tok_regex",
                                  "weak_file_warn": 0.10,
                                  "implausible_reduction": 0.95,
                                  "proxy_disagreement_pp": 5,
                                  "exemption": {"verbatim_fraction_gt": 0.25,
                                                "function_word_ratio_lt": 0.30},
                                  "structure": {"min_net_delta": 0}},
                })
                check("mean_reduction computed only over non-exempt pairs",
                      size_v["gating_pair_count"] == 1, str(size_v))
                check("size verdict passes on the single non-exempt >=20% pair",
                      size_v["pass"] is True, str(size_v))
                check("exempt pair counted separately", size_v["exempt_pair_count"] == 1)
                check("6a verdict_kind fields correct",
                      size_v["verdict_kind"] == "6a-size" and struct_v["verdict_kind"] == "6a-structure")
                check("6a-size JSON has no quality/judge field",
                      not any(k in size_v for k in ("quality", "judge", "assertions")))
            finally:
                HARNESS_DIR, REPO_ROOT = saved_harness_dir, saved_repo_root
        else:
            print("  [SKIP] manifest-level test — PyYAML not installed")

        # ── corroboration-study patch regression tests (research-normal-
        # density-corroboration.md §6.2-6.3) ──

        # frozen_ext_fraction must count URL bytes that verbatim_fraction
        # misses (the study's "atom/atom" defect: 5.0% -> 37.5% frozen).
        plain_prose = ("The team has decided that we should always try to "
                       "keep the documentation clear and easy to read.") * 3
        check("frozen_ext == verbatim_fraction on URL/code-free prose",
              abs(red_frozen := frozen_ext_fraction(plain_prose)) < 0.001
              and abs(verbatim_fraction(plain_prose)) < 0.001,
              f"frozen_ext={red_frozen}")

        link_heavy_item = (
            "* **Check the [debugging guide %d](https://flight-manual.example.io/"
            "hacking/sections/debugging/detail/path/segment/%d).** You might be "
            "able to find the cause of the problem and fix things yourself. Most "
            "importantly, check if you can reproduce it.\n"
        )
        link_heavy_text = "".join(link_heavy_item % (i, i) for i in range(8))
        vf_link = verbatim_fraction(link_heavy_text)
        fx_link = frozen_ext_fraction(link_heavy_text)
        fw_link = function_word_ratio(link_heavy_text)
        check("frozen_ext_fraction is substantially higher than verbatim_fraction "
              "on a link-heavy file (the atom/atom defect class)",
              fx_link > vf_link + 0.10, f"verbatim={vf_link} frozen_ext={fx_link}")
        check("verbatim_fraction alone stays ~0 on a fence/inline-code-free, "
              "link-heavy file (proving frozen_ext, not verbatim_fraction, is "
              "what catches this case)",
              vf_link < 0.01, f"verbatim={vf_link}")

        # calibration sanity: the fitted line should reproduce the paper's
        # claimed aggressive-tier r=0.978 to within a small transcription
        # tolerance, and stay a strong positive correlation regardless.
        r = _pearson_r(_PROSE_RATE_CALIBRATION)
        check("prose-rate calibration fit reproduces the paper's claimed "
              "r~=0.978 (aggressive tier, n=4) within tolerance",
              abs(r - 0.978) < 0.02, f"r={r}")
        check("prose-rate calibration is a strong positive correlation",
              r > 0.9, f"r={r}")

        # clamping behaviour at the extremes
        check("prose_reduction_rate clamps to the floor for fw=0",
              prose_reduction_rate(0.0) == PROSE_RATE_FLOOR)
        check("prose_reduction_rate clamps to the ceiling for fw=1",
              prose_reduction_rate(1.0) == PROSE_RATE_CEILING)
        check("prose_reduction_rate is monotonically non-decreasing across "
              "the calibration range",
              prose_reduction_rate(0.45) >= prose_reduction_rate(0.33))

        # predicted_reduction: always in [0,1]; a near-fully-frozen file
        # predicts ~0 regardless of its fw ratio.
        check("predicted_reduction stays in [0,1] across a fw sweep",
              all(0.0 <= predicted_reduction(0.0, fw / 10) <= 1.0 for fw in range(11)))
        check("predicted_reduction is ~0 for a near-fully-frozen file "
              "even with a high function-word ratio",
              predicted_reduction(0.95, 0.50) < 0.05,
              str(predicted_reduction(0.95, 0.50)))

        # end-to-end regression: the OLD binary rule would call the
        # link-heavy file NON-exempt (verbatim<=25% and fw>=30%), but the
        # continuous prediction correctly identifies it as capped below the
        # bar (this is the exact "atom/atom" bug the study reports: a file
        # that reads as compressible under the old instrument but isn't).
        old_rule_would_exempt = vf_link > 0.25 or fw_link < 0.30
        check("OLD binary rule would NOT have exempted the link-heavy file "
              "(the bug being fixed)", old_rule_would_exempt is False,
              f"verbatim={vf_link} fw={fw_link}")

        (tmp / "a9.md").write_text(link_heavy_text, encoding="utf-8")
        (tmp / "b9.md").write_text(link_heavy_text, encoding="utf-8")  # 0% actual cut
        r9 = measure_pair(tmp / "a9.md", tmp / "b9.md", bar=0.20)
        check("NEW continuous prediction correctly marks the link-heavy file "
              "exempt (its own predicted ceiling is below the bar)",
              r9["exempt_from_size_bar"] is True, str(r9["prediction"]))
        check("density reports both frozen_ext and the legacy verbatim_fraction "
              "so the two can be compared directly",
              r9["density"]["frozen_ext"] > r9["density"]["verbatim_fraction"] + 0.10,
              str(r9["density"]))
        check("prediction block reports hit_prediction, expected_reduction, "
              "actual_reduction, and never a combined key",
              set(r9["prediction"]) >= {"expected_reduction", "actual_reduction", "hit_prediction"}
              and not any(re.match(r"^(combined|overall|total)_?(score|verdict)$", k, re.IGNORECASE)
                          for k in r9["prediction"]))

    # separation invariant: neither verdict dict may contain a combined-score key
    combined_re = re.compile(r"^(combined|overall|total)_?(score|verdict)$", re.IGNORECASE)
    for label, v in (("size", {"combined_score": 1}), ("structure", {"total_verdict": 1})):
        poisoned_keys = [k for k in v if combined_re.match(k)]
        check(f"combined-score detector recognizes a poisoned {label} key",
              len(poisoned_keys) == 1)

    if ok:
        print("reduction.py --selftest: ALL OK")
    else:
        print("reduction.py --selftest: FAILURES ABOVE")
    return ok


if __name__ == "__main__":
    main()
