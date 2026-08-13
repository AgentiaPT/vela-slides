#!/usr/bin/env python3
"""
report.py — two-panel report (harness-design.md §11.2). Console + report.md.

The two verdicts (6a reduction pre-filter, 6b quality gate) are rendered as
SEPARATE banner panels with separate PASS/FAIL words and a fixed,
non-removable disclaimer between them. This module never computes a combined
score, and `--selftest` enforces that invariant structurally (§1):

  - No emitted JSON key or Markdown column may match
    /^(combined|overall|total)_?(score|verdict)$/i.
  - The 6b gate state must be provably unaffected by the 6a reduction numbers
    (a differential test, not just "we didn't write the code that way").
  - Where a 6a number appears inside the 6b panel at all, it is confined to
    one explicitly-labelled *informational* line that plays no role in the
    gate's pass/fail decision (§1's "reduction appears in the 6b report only
    in an explicitly-labelled informational block").

`stats()`, `bootstrap_ci()`, `cohens_d()`, `effect_label()` are ported
verbatim (stdlib-only, `random.seed(42)`) from `evals/scripts/report.py`,
applied to turns/tokens/errors instead of deck metrics (harness-design.md §2).

Usage:
  python3 report.py <reduction_json> <campaign_json> [--out report.md] [--json]
  python3 report.py --selftest
"""

import argparse
import json
import math
import random
import re
import sys
from pathlib import Path

HARNESS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(HARNESS_DIR))
import gate as gatemod  # noqa: E402

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None

WIDTH = 78

DISCLAIMER = [
    "These two verdicts are independent and are never combined, averaged, or",
    "traded off. 6A screens an APPROACH for whether further spend is justified.",
    "6B is the ship bar for a (approach, target file) pair. A 6A pass says",
    "nothing whatsoever about quality.",
]

# harness-design.md §1 — the forbidden-key detector. Any emitted structure
# (JSON dict key, or a Markdown/console column header) matching this pattern
# is a combined-score leak.
COMBINED_KEY_RE = re.compile(r"^(combined|overall|total)_?(score|verdict)$", re.IGNORECASE)


# ── ported from evals/scripts/report.py (stdlib-only, verbatim shape) ──────

def stats(values):
    """Mean, stddev, min, max, median, bootstrap 95% CI."""
    if not values:
        return {"mean": 0, "std": 0, "min": 0, "max": 0, "median": 0,
                "ci_lo": 0, "ci_hi": 0, "n": 0}
    n = len(values)
    mean_val = sum(values) / n
    variance = sum((x - mean_val) ** 2 for x in values) / n if n > 1 else 0
    sorted_vals = sorted(values)
    median = sorted_vals[n // 2] if n % 2 else (sorted_vals[n // 2 - 1] + sorted_vals[n // 2]) / 2
    ci_lo, ci_hi = bootstrap_ci(values)
    return {
        "mean": round(mean_val, 4), "std": round(math.sqrt(variance), 4),
        "min": round(min(values), 4), "max": round(max(values), 4),
        "median": round(median, 4), "ci_lo": round(ci_lo, 4), "ci_hi": round(ci_hi, 4),
        "n": n,
    }


def bootstrap_ci(values, n_boot=1000, ci=0.95):
    if len(values) < 2:
        v = values[0] if values else 0
        return (v, v)
    random.seed(42)  # reproducible
    means = []
    for _ in range(n_boot):
        sample = random.choices(values, k=len(values))
        means.append(sum(sample) / len(sample))
    means.sort()
    lo_idx = int((1 - ci) / 2 * n_boot)
    hi_idx = int((1 + ci) / 2 * n_boot) - 1
    return (means[lo_idx], means[hi_idx])


def cohens_d(a_values, b_values):
    if not a_values or not b_values:
        return 0
    mean_a = sum(a_values) / len(a_values)
    mean_b = sum(b_values) / len(b_values)
    var_a = sum((x - mean_a) ** 2 for x in a_values) / max(len(a_values) - 1, 1)
    var_b = sum((x - mean_b) ** 2 for x in b_values) / max(len(b_values) - 1, 1)
    pooled_sd = math.sqrt((var_a + var_b) / 2)
    if pooled_sd == 0:
        return 0
    return (mean_a - mean_b) / pooled_sd


def effect_label(d):
    d_abs = abs(d)
    if d_abs < 0.2:
        return "negligible"
    elif d_abs < 0.5:
        return "small"
    elif d_abs < 0.8:
        return "medium"
    else:
        return "large"


# ── 6a panel ────────────────────────────────────────────────────────────

def _box_top(title):
    return "╔" + "═" * (WIDTH - 2) + "╗\n" + f"║ {title}".ljust(WIDTH - 1) + "║"


def _box_mid():
    return "╠" + "═" * (WIDTH - 2) + "╣"


def _box_line(text=""):
    return f"║ {text}".ljust(WIDTH - 1) + "║"


def _box_bottom():
    return "╚" + "═" * (WIDTH - 2) + "╝"


def render_6a_console(size_verdict, structure_verdict):
    lines = []
    approach = size_verdict.get("approach", "?")
    lines.append(_box_top(f"VERDICT 6A — REDUCTION PRE-FILTER          approach: {approach}"))
    lines.append(_box_line("judge-free · no model calls · screening only"))
    lines.append(_box_mid())
    size_word = "PASS" if size_verdict["pass"] else "FAIL"
    lines.append(_box_line(
        f"SIZE       {size_word}   mean reduction {size_verdict['mean_reduction']:.1%}   "
        f"(bar >= {size_verdict['bar']:.0%})"
    ))
    for p in size_verdict.get("pairs", []):
        name = Path(p["minified"]).name
        pct = p["reduction"].get(size_verdict.get("metric", "tok_regex"), 0.0)
        tag = "  ⚠ EXEMPT (pre-densified)" if p.get("exempt_from_size_bar") else ""
        for f in p.get("flags", []):
            tag += f"  ⚠ {f}"
        lines.append(_box_line(f"  {name:<38} {pct:>7.1%}{tag}"))
    lines.append(_box_line(
        f"  gating pairs: {size_verdict.get('gating_pair_count', 0)}   "
        f"exempt pairs: {size_verdict.get('exempt_pair_count', 0)}"
    ))
    lines.append(_box_line())
    struct_word = "PASS" if structure_verdict["pass"] else "FAIL"
    lines.append(_box_line(
        f"STRUCTURE  {struct_word}   net constraint delta {structure_verdict['total_net_delta']:+d}   "
        f"(lost={structure_verdict['total_lost']} "
        f"weakened={structure_verdict['total_weakened']} "
        f"newly_explicit={structure_verdict['total_newly_explicit']})"
    ))
    lines.append(_box_bottom())
    return "\n".join(lines)


def render_6a_markdown(size_verdict, structure_verdict):
    approach = size_verdict.get("approach", "?")
    lines = [f"## VERDICT 6A — Reduction pre-filter (approach: `{approach}`)", ""]
    lines.append("Judge-free. No model calls. Screening only.")
    lines.append("")
    size_word = "PASS" if size_verdict["pass"] else "FAIL"
    lines.append(f"**SIZE: {size_word}** — mean reduction "
                  f"{size_verdict['mean_reduction']:.1%} (bar ≥ {size_verdict['bar']:.0%})")
    lines.append("")
    lines.append("| file | reduction | exempt | flags |")
    lines.append("|---|---|---|---|")
    for p in size_verdict.get("pairs", []):
        name = Path(p["minified"]).name
        pct = p["reduction"].get(size_verdict.get("metric", "tok_regex"), 0.0)
        exempt = "yes" if p.get("exempt_from_size_bar") else ""
        flags = ", ".join(p.get("flags", []))
        lines.append(f"| {name} | {pct:.1%} | {exempt} | {flags} |")
    lines.append("")
    struct_word = "PASS" if structure_verdict["pass"] else "FAIL"
    lines.append(f"**STRUCTURE: {struct_word}** — net constraint delta "
                  f"{structure_verdict['total_net_delta']:+d} "
                  f"(lost={structure_verdict['total_lost']}, "
                  f"weakened={structure_verdict['total_weakened']}, "
                  f"newly_explicit={structure_verdict['total_newly_explicit']})")
    lines.append("")
    return "\n".join(lines)


# ── 6b panel ────────────────────────────────────────────────────────────

def _critical_counts(reps_list):
    passed = total = 0
    for rep in reps_list:
        passed += rep.get("critical_passed", 0)
        total += rep.get("critical_total", 0)
    return passed, total


def render_6b_console(campaign, state, gate_report_lines, gate_detail, config=None, informational_size=None):
    lines = []
    approach = campaign.get("approach", "?")
    target = campaign.get("target", "?")
    agent_model = campaign.get("agent_model", "?")
    judge_model = campaign.get("judge_model", "?")
    n_scenarios = len(campaign.get("scenarios", {}))
    reps = campaign.get("reps", "?")

    lines.append(_box_top(f"VERDICT 6B — QUALITY GATE                  approach: {approach}"))
    lines.append(_box_line(
        f"target: {target} · agent: {agent_model} · judge: {judge_model} · "
        f"{n_scenarios} scenarios × {reps} reps"
    ))
    lines.append(_box_mid())

    word = {"pass": "PASS", "fail": "FAIL", "inconclusive": "INCONCLUSIVE"}[state]
    headline = ""
    if state == "fail" and gate_detail["failures"]:
        kinds = sorted({f["kind"] for f in gate_detail["failures"]})
        headline = "  " + ", ".join(kinds)
    lines.append(_box_line(f"{word}{headline}"))
    lines.append(_box_line())

    base_p = min_p = base_t = min_t = 0
    for sdata in campaign.get("scenarios", {}).values():
        bp, bt = _critical_counts(sdata.get("baseline", []))
        mp, mt = _critical_counts(sdata.get("minified", []))
        base_p += bp
        base_t += bt
        min_p += mp
        min_t += mt
    lines.append(_box_line(f" Critical assertions        baseline {base_p}/{base_t}   minified {min_p}/{min_t}"))

    for f in gate_detail["failures"]:
        if f["kind"] in ("behavioral_drift", "absolute_floor"):
            tag = "DRIFT" if f["kind"] == "behavioral_drift" else "FLOOR"
            lines.append(_box_line(f"  {tag}  {f['scenario']} / {f['assertion']}"))
            if "probes" in f and f["probes"]:
                lines.append(_box_line(f"         probe: {f['probes']}"))
    lines.append(_box_line())

    judge_info = gate_detail.get("judge_info", {})
    stable = judge_info.get("stable_pairs", 0)
    total_pairs = judge_info.get("total_pairs", 0)
    losses = judge_info.get("minified_losses", 0)
    pairs = campaign.get("judge_pairs", [])
    wins = sum(1 for p in pairs if p.get("stable") and p.get("winner_arm") == "minified")
    ties = sum(1 for p in pairs if p.get("stable") and p.get("winner_arm") == "tie")
    lines.append(_box_line(
        f" Blind A/B (stable pairs {stable}/{total_pairs})   "
        f"baseline {losses} · minified {wins} · tie {ties}"
    ))
    unstable_n = total_pairs - stable
    unstable_pct = (unstable_n / total_pairs) if total_pairs else 0.0
    quarantined = len(campaign.get("quarantined_pairs", []))
    lines.append(_box_line(f" Unstable {unstable_n}/{total_pairs} ({unstable_pct:.1%})  ·  Quarantined {quarantined}"))
    lines.append(_box_line())

    raw = campaign.get("raw_metrics", {})
    base_raw = raw.get("baseline", {})
    min_raw = raw.get("minified", {})
    if base_raw and min_raw:
        lines.append(_box_line(" Metric        baseline               minified               Δ        d"))
        for key, label in (("turns", "turns"), ("input_tokens", "input tokens"), ("error_count", "tool errors")):
            bv = base_raw.get(key, [])
            mv = min_raw.get(key, [])
            if not bv or not mv:
                continue
            bs = stats(bv)
            ms = stats(mv)
            d = cohens_d(bv, mv)
            delta_pct = ((ms["mean"] - bs["mean"]) / bs["mean"] * 100) if bs["mean"] else 0.0
            lines.append(_box_line(
                f"  {label:<12} {bs['mean']:>8,.1f} [{bs['ci_lo']:,.1f},{bs['ci_hi']:,.1f}]  "
                f"{ms['mean']:>8,.1f} [{ms['ci_lo']:,.1f},{ms['ci_hi']:,.1f}]  "
                f"{delta_pct:+.1f}%  {d:.2f} {effect_label(d)}"
            ))
        lines.append(_box_line())

    hdc = campaign.get("hook_dependent_compliance", [])
    if hdc:
        lines.append(_box_line(" hook_dependent_compliance:"))
        for entry in hdc:
            lines.append(_box_line(f"   {entry}"))
        lines.append(_box_line())

    if gate_detail.get("efficiency_warnings"):
        for w in gate_detail["efficiency_warnings"]:
            lines.append(_box_line(f" {w}"))
        lines.append(_box_line())

    if informational_size is not None:
        lines.append(_box_line(
            f" [informational only — NOT an input to this gate] 6A size verdict: "
            f"{'PASS' if informational_size['pass'] else 'FAIL'} "
            f"mean reduction {informational_size['mean_reduction']:.1%}"
        ))
        lines.append(_box_line())

    lines.append(_box_bottom())
    return "\n".join(lines)


def render_6b_markdown(campaign, state, gate_detail, informational_size=None):
    lines = [f"## VERDICT 6B — Quality gate (approach: `{campaign.get('approach', '?')}`, "
             f"target: `{campaign.get('target', '?')}`)", ""]
    word = {"pass": "PASS", "fail": "FAIL", "inconclusive": "INCONCLUSIVE"}[state]
    lines.append(f"**{word}**")
    lines.append("")
    if gate_detail["failures"]:
        lines.append("| kind | scenario | assertion | message |")
        lines.append("|---|---|---|---|")
        for f in gate_detail["failures"]:
            lines.append(f"| {f['kind']} | {f.get('scenario', '')} | {f.get('assertion', '')} | {f['message']} |")
        lines.append("")
    if gate_detail.get("scenario_invalid"):
        lines.append("Scenario-invalid (both arms failed identically, excluded from the drift decision):")
        for s in gate_detail["scenario_invalid"]:
            lines.append(f"- {s}")
        lines.append("")
    raw = campaign.get("raw_metrics", {})
    base_raw = raw.get("baseline", {})
    min_raw = raw.get("minified", {})
    if base_raw and min_raw:
        lines.append("| metric | baseline mean [95% CI] | minified mean [95% CI] | Δ | Cohen's d |")
        lines.append("|---|---|---|---|---|")
        for key, label in (("turns", "turns"), ("input_tokens", "input tokens"), ("error_count", "tool errors")):
            bv = base_raw.get(key, [])
            mv = min_raw.get(key, [])
            if not bv or not mv:
                continue
            bs = stats(bv)
            ms = stats(mv)
            d = cohens_d(bv, mv)
            delta_pct = ((ms["mean"] - bs["mean"]) / bs["mean"] * 100) if bs["mean"] else 0.0
            lines.append(f"| {label} | {bs['mean']:.1f} [{bs['ci_lo']:.1f},{bs['ci_hi']:.1f}] | "
                          f"{ms['mean']:.1f} [{ms['ci_lo']:.1f},{ms['ci_hi']:.1f}] | "
                          f"{delta_pct:+.1f}% | {d:.2f} ({effect_label(d)}) |")
        lines.append("")
    if informational_size is not None:
        lines.append(f"_[informational only, not an input to this gate]_ 6A size verdict: "
                      f"{'PASS' if informational_size['pass'] else 'FAIL'} "
                      f"mean reduction {informational_size['mean_reduction']:.1%}")
        lines.append("")
    return "\n".join(lines)


# ── combined entry point ───────────────────────────────────────────────

def two_panel_report(reduction_result, campaign, config=None):
    """reduction_result: {"size": size_verdict, "structure": structure_verdict}
    or None if 6a has not been run for this approach yet.
    campaign: the 6b campaign dict (same shape gate.py consumes), optionally
    augmented with 'raw_metrics', 'approach', 'target', 'agent_model',
    'judge_model', 'reps', 'hook_dependent_compliance' for display.

    Returns (console_text, markdown_text, detail_dict). detail_dict is the
    JSON-serializable combined verdict payload — it always keeps
    verdict_kind-tagged sub-objects and NEVER a merged key.
    """
    state, gate_report_lines, gate_detail = gatemod.gate(campaign, config)

    console_parts = []
    md_parts = []
    informational_size = None

    if reduction_result is not None:
        size_v = reduction_result["size"]
        structure_v = reduction_result["structure"]
        informational_size = size_v
        console_parts.append(render_6a_console(size_v, structure_v))
        md_parts.append(render_6a_markdown(size_v, structure_v))
        console_parts.append("")
        console_parts.append("  " + "\n  ".join(DISCLAIMER))
        console_parts.append("")
        md_parts.append("> " + "\n> ".join(DISCLAIMER))
        md_parts.append("")

    console_parts.append(render_6b_console(campaign, state, gate_report_lines, gate_detail, config, informational_size))
    md_parts.append(render_6b_markdown(campaign, state, gate_detail, informational_size))

    console_text = "\n".join(console_parts)
    markdown_text = "\n".join(md_parts)

    detail = {"verdict_6b": gate_detail}
    if reduction_result is not None:
        detail["verdict_6a"] = {"size": reduction_result["size"], "structure": reduction_result["structure"]}
    return console_text, markdown_text, detail


def write_report(path, markdown_text):
    Path(path).write_text(markdown_text, encoding="utf-8")


# ── combined-key scanner (the §1 self-test invariant, reusable) ─────────

def find_combined_keys(obj, path=""):
    """Recursively scan a JSON-serializable structure for any dict key
    matching COMBINED_KEY_RE. Returns a list of offending paths."""
    hits = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(k, str) and COMBINED_KEY_RE.match(k):
                hits.append(f"{path}.{k}" if path else k)
            hits.extend(find_combined_keys(v, f"{path}.{k}" if path else str(k)))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            hits.extend(find_combined_keys(v, f"{path}[{i}]"))
    return hits


def find_combined_text(text):
    """Scan rendered console/Markdown text for a bare combined-score/verdict
    token (e.g. a stray column header), independent of the key scanner
    above (which only sees structured JSON)."""
    hits = []
    for m in re.finditer(r"\b\w+\b", text):
        if COMBINED_KEY_RE.match(m.group(0)):
            hits.append(m.group(0))
    return hits


# ── CLI ─────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("reduction_json", nargs="?")
    ap.add_argument("campaign_json", nargs="?")
    ap.add_argument("--out", default=None, help="write markdown report here")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if args.selftest:
        ok = _selftest()
        sys.exit(0 if ok else 1)

    if not args.campaign_json:
        ap.print_usage(sys.stderr)
        sys.exit(2)

    config = {}
    cfg_path = HARNESS_DIR / "config.yaml"
    if yaml is not None and cfg_path.exists():
        with open(cfg_path, encoding="utf-8") as f:
            config = yaml.safe_load(f) or {}

    reduction_result = None
    if args.reduction_json:
        with open(args.reduction_json, encoding="utf-8") as f:
            reduction_result = json.load(f)

    with open(args.campaign_json, encoding="utf-8") as f:
        campaign = json.load(f)

    console_text, markdown_text, detail = two_panel_report(reduction_result, campaign, config)
    print(console_text)
    if args.out:
        write_report(args.out, markdown_text)
        print(f"\n(markdown report written to {args.out})", file=sys.stderr)
    if args.json:
        print(json.dumps(detail, indent=2))


# ── self-test (§14.7 shape, §1 separation invariants) ────────────────────

def _selftest():
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        status = "OK" if cond else "FAIL"
        if not cond:
            ok = False
        print(f"  [{status}] {name}" + (f" — {detail}" if detail and not cond else ""))

    # ── ported stats fns sanity ──
    check("cohens_d(same,same) == 0", cohens_d([1, 2, 3], [1, 2, 3]) == 0)
    check("effect_label boundaries", effect_label(0.1) == "negligible" and effect_label(0.3) == "small"
          and effect_label(0.6) == "medium" and effect_label(0.9) == "large")
    s = stats([1, 2, 3, 4, 5])
    check("stats() computes a sane mean", s["mean"] == 3.0, str(s))
    check("bootstrap_ci is reproducible (seed=42)", bootstrap_ci([1, 2, 3, 4, 5]) == bootstrap_ci([1, 2, 3, 4, 5]))

    # ── synthetic size/structure verdicts (reduction.py output shape) ──
    size_verdict = {
        "verdict_kind": "6a-size", "approach": "telegraphic", "bar": 0.20, "metric": "tok_regex",
        "mean_reduction": 0.341, "pass": True, "gating_pair_count": 2, "exempt_pair_count": 0,
        "pairs": [
            {"baseline": "CLAUDE.md", "minified": "variants/telegraphic/CLAUDE.md",
             "reduction": {"tok_regex": 0.374}, "flags": [], "exempt_from_size_bar": False},
            {"baseline": ".claude/skills/vela-secure-coding/SKILL.md",
             "minified": "variants/telegraphic/SKILL.md",
             "reduction": {"tok_regex": 0.308}, "flags": ["structure_loss_suspected"],
             "exempt_from_size_bar": False},
        ],
        "weak_files": [], "warnings": [], "note": "screening only",
    }
    structure_verdict = {
        "verdict_kind": "6a-structure", "approach": "telegraphic", "min_net_delta": 0,
        "total_net_delta": -1, "total_lost": 1, "total_weakened": 2, "total_newly_explicit": 1,
        "pass": False, "per_pair": [], "note": "constraint-explicitness, never combined",
    }
    reduction_result = {"size": size_verdict, "structure": structure_verdict}

    # ── synthetic 6b campaign with a drift failure (interesting output) ──
    def rep(critical_ok):
        results = [{"type": "version_bumped", "critical": True, "passed": critical_ok, "evidence": "x"}]
        return {"passed": int(critical_ok), "total": 1, "critical_passed": int(critical_ok),
                "critical_total": 1, "results": results}

    campaign = {
        "verdict_kind": "6b-quality", "approach": "telegraphic", "target": "CLAUDE.md",
        "agent_model": "sonnet", "judge_model": "opus", "reps": 3,
        "scenarios": {
            "docs-only-versionbump": {
                "probes": ["IMPORTANT: Version Bump Required for Skill Changes"],
                "baseline": [rep(True), rep(True), rep(True)],
                "minified": [rep(False), rep(False), rep(False)],
            },
        },
        "judge_pairs": [
            {"scenario": "docs-only-versionbump", "stable": True, "winner_arm": "tie"},
            {"scenario": "docs-only-versionbump", "stable": True, "winner_arm": "baseline"},
        ],
        "judge_pairs_total": 2,
        "quarantined_pairs": [],
        "metrics": {"baseline": {"error_count": 0.6, "turns": 14.2, "input_tokens": 128000},
                    "minified": {"error_count": 0.9, "turns": 15.9, "input_tokens": 111000}},
        "raw_metrics": {
            "baseline": {"turns": [13, 14, 15.6], "input_tokens": [119000, 128000, 138000],
                         "error_count": [0.2, 0.6, 1.1]},
            "minified": {"turns": [13.4, 15.9, 18.6], "input_tokens": [104000, 111000, 120000],
                         "error_count": [0.4, 0.9, 1.6]},
        },
        "hook_dependent_compliance": [
            "blockfield-safekeys (secure-coding read only occurred after the "
            "PreToolUse hook blocked the first edit, minified arm, 3/3 reps; "
            "baseline arm 0/3)",
        ],
    }

    console_text, markdown_text, detail = two_panel_report(reduction_result, campaign)

    check("console has a 6A banner", "VERDICT 6A" in console_text)
    check("console has a 6B banner", "VERDICT 6B" in console_text)
    check("console shows FAIL for 6b (drift)", "FAIL" in console_text.split("VERDICT 6B")[1][:400])
    check("disclaimer text present verbatim between panels",
          "independent and are never combined" in console_text)
    check("markdown has both panel headers",
          "VERDICT 6A" in markdown_text and "VERDICT 6B" in markdown_text)
    check("drift failure names the assertion in console",
          "version_bumped" in console_text and "docs-only-versionbump" in console_text)
    check("probe text surfaced in console",
          "Version Bump Required" in console_text)
    check("hook_dependent_compliance rendered",
          "hook_dependent_compliance" in console_text)

    # ── §1 invariant: no combined-score key anywhere in the JSON detail ──
    hits = find_combined_keys(detail)
    check("detail dict has zero combined-score/verdict keys", hits == [], str(hits))

    # positive control: prove the scanner isn't vacuous
    poisoned = {"verdict_6b": {"combined_score": 0.5}, "nested": {"total_verdict": "pass"}}
    poisoned_hits = find_combined_keys(poisoned)
    check("scanner DOES catch a deliberately poisoned combined_score key",
          "verdict_6b.combined_score" in poisoned_hits)
    check("scanner DOES catch a deliberately poisoned total_verdict key",
          "nested.total_verdict" in poisoned_hits)

    # ── §1 invariant: no combined-score token in rendered text either ──
    text_hits = find_combined_text(console_text) + find_combined_text(markdown_text)
    check("rendered console/markdown text has zero combined-score tokens", text_hits == [], str(text_hits))
    poisoned_text_hits = find_combined_text("Overall_Score: 91  |  Total_Verdict: pass")
    check("text scanner DOES catch a deliberately poisoned column header",
          len(poisoned_text_hits) == 2, str(poisoned_text_hits))

    # ── §1 invariant: 6b gate state is provably unaffected by 6a numbers ──
    # Differential test: swap the reduction verdict for a wildly different
    # one (0% vs 99% "reduction", FAIL vs PASS) against the IDENTICAL
    # campaign, and assert the 6b state/detail do not change one bit.
    extreme_size_verdict = dict(size_verdict)
    extreme_size_verdict["mean_reduction"] = 0.99
    extreme_size_verdict["pass"] = True
    extreme_structure_verdict = dict(structure_verdict)
    extreme_structure_verdict["total_net_delta"] = 50
    extreme_structure_verdict["pass"] = True
    extreme_reduction_result = {"size": extreme_size_verdict, "structure": extreme_structure_verdict}
    _, _, detail_extreme = two_panel_report(extreme_reduction_result, campaign)
    check("6b gate state is byte-identical regardless of the 6a reduction numbers",
          detail_extreme["verdict_6b"] == detail["verdict_6b"])

    other_reduction_result = {
        "size": {**size_verdict, "mean_reduction": 0.0, "pass": False},
        "structure": {**structure_verdict, "total_net_delta": 0, "pass": True},
    }
    _, _, detail_none = two_panel_report(None, campaign)
    _, _, detail_other = two_panel_report(other_reduction_result, campaign)
    check("6b gate state is byte-identical with no 6a data at all vs. any 6a data",
          detail_none["verdict_6b"] == detail_other["verdict_6b"] == detail["verdict_6b"])

    # ── informational-only placement: 6a number appears in 6b panel exactly
    # once, and only inside a line explicitly labelled "informational" ──
    b6_console = console_text.split("VERDICT 6B", 1)[1]
    info_lines = [ln for ln in b6_console.splitlines() if "34.1%" in ln or f"{0.341:.1%}" in ln]
    check("the 6a mean-reduction figure, if it appears in the 6b panel, is on an "
          "explicitly-labelled informational line",
          all("informational" in ln.lower() for ln in info_lines), str(info_lines))

    # ── write_report() round-trips to disk ──
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        out_path = Path(tmp) / "report.md"
        write_report(out_path, markdown_text)
        check("write_report() writes a non-empty markdown file",
              out_path.exists() and out_path.stat().st_size > 0)
        check("written file round-trips the content",
              out_path.read_text(encoding="utf-8") == markdown_text)

    # ── inconclusive state renders distinctly (not silently a pass) ──
    inconclusive_campaign = dict(campaign)
    inconclusive_campaign["scenarios"] = {}
    inconclusive_campaign["judge_pairs"] = (
        [{"scenario": "s1", "stable": False, "winner_arm": "tie"} for _ in range(3)]
        + [{"scenario": "s1", "stable": True, "winner_arm": "tie"} for _ in range(2)]
    )
    inconclusive_campaign["judge_pairs_total"] = 5
    inconclusive_campaign["raw_metrics"] = {}
    # clear inherited metrics so only the instability axis can trigger here —
    # otherwise the drift-fixture's baseline/minified metrics (which differ
    # by exactly the error-regression threshold under floating point) would
    # also fail the campaign and mask the state we're testing for.
    inconclusive_campaign["metrics"] = {}
    console_inc, _, detail_inc = two_panel_report(None, inconclusive_campaign)
    check("inconclusive campaign renders INCONCLUSIVE, not PASS or FAIL",
          "INCONCLUSIVE" in console_inc.split("VERDICT 6B")[1])
    check("inconclusive is a distinct state in the detail dict too",
          detail_inc["verdict_6b"]["state"] == "inconclusive")

    if ok:
        print("report.py --selftest: ALL OK")
    else:
        print("report.py --selftest: FAILURES ABOVE")
    return ok


if __name__ == "__main__":
    main()
