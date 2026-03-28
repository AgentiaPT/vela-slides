#!/usr/bin/env python3
"""
report.py — Compare harvested results across skill versions.

Usage:
  python3 report.py results/              # Compare all version dirs
  python3 report.py results/ --markdown   # Output markdown table
  python3 report.py results/ --json       # Output JSON

Expected directory structure:
  results/
  ├── v2.3/
  │   ├── create-6-run1.json
  │   ├── create-6-run2.json
  │   └── ...
  ├── v2.4/
  │   └── ...
  └── v2.5.1/
      └── ...

Each .json file is the output of: python3 harvest.py <session.jsonl> --json
"""

import json
import sys
import os
import random
import math
from pathlib import Path
from collections import defaultdict


def load_results(results_dir):
    """Load all harvested results grouped by version."""
    versions = {}
    for version_dir in sorted(Path(results_dir).iterdir()):
        if not version_dir.is_dir():
            continue
        version = version_dir.name
        runs = []
        for f in sorted(version_dir.glob("*.json")):
            with open(f) as fh:
                data = json.load(fh)
                if isinstance(data, list):
                    runs.extend(data)
                else:
                    runs.append(data)
        if runs:
            versions[version] = runs
    return versions


def stats(values):
    """Compute mean, stddev, min, max, median, IQR, and bootstrap CI."""
    if not values:
        return {"mean": 0, "std": 0, "min": 0, "max": 0, "median": 0,
                "ci_lo": 0, "ci_hi": 0, "n": 0}
    n = len(values)
    mean_val = sum(values) / n
    variance = sum((x - mean_val) ** 2 for x in values) / n if n > 1 else 0
    sorted_vals = sorted(values)
    median = sorted_vals[n // 2] if n % 2 else (sorted_vals[n // 2 - 1] + sorted_vals[n // 2]) / 2

    # Bootstrap 95% CI
    ci_lo, ci_hi = bootstrap_ci(values)

    return {
        "mean": round(mean_val, 4),
        "std": round(math.sqrt(variance), 4),
        "min": round(min(values), 4),
        "max": round(max(values), 4),
        "median": round(median, 4),
        "ci_lo": round(ci_lo, 4),
        "ci_hi": round(ci_hi, 4),
        "n": n,
    }


def bootstrap_ci(values, n_boot=1000, ci=0.95):
    """Bootstrap confidence interval using stdlib random."""
    if len(values) < 2:
        v = values[0] if values else 0
        return (v, v)
    random.seed(42)  # Reproducible
    means = []
    for _ in range(n_boot):
        sample = random.choices(values, k=len(values))
        means.append(sum(sample) / len(sample))
    means.sort()
    lo_idx = int((1 - ci) / 2 * n_boot)
    hi_idx = int((1 + ci) / 2 * n_boot) - 1
    return (means[lo_idx], means[hi_idx])


def cohens_d(a_values, b_values):
    """Cohen's d effect size. 0.2=small, 0.5=medium, 0.8=large."""
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
    """Human label for Cohen's d."""
    d_abs = abs(d)
    if d_abs < 0.2:
        return "negligible"
    elif d_abs < 0.5:
        return "small"
    elif d_abs < 0.8:
        return "medium"
    else:
        return "large"


def compare(versions):
    """Build comparison table across versions."""
    table = {}
    for version, runs in versions.items():
        # Filter to result files only (must have totals key)
        result_runs = [r for r in runs if "totals" in r]
        inputs = [r["totals"]["input_tokens"] for r in result_runs]
        outputs = [r["totals"]["output_tokens"] for r in result_runs]
        cache_reads = [r["totals"]["cache_read_tokens"] for r in result_runs]
        costs = [r["totals"]["cost_usd"] for r in result_runs]
        durations = [r["totals"]["duration_s"] for r in result_runs]
        tools = [r["totals"]["tool_calls"] for r in result_runs]
        turns = [r.get("turns", 0) for r in result_runs]

        # Quality scores (if present)
        quality_scores = [r["quality"]["judge"]["overall"]
                          for r in runs
                          if r.get("quality", {}).get("judge", {}).get("overall")]

        # Trajectory metrics (if present)
        error_counts = [r.get("trajectory", {}).get("error_count", 0) for r in runs
                        if "trajectory" in r]

        # Assertion pass rates (if present)
        assert_passed = 0
        assert_total = 0
        for r in result_runs:
            a = r.get("assertions", {})
            assert_passed += a.get("passed", 0)
            assert_total += a.get("total", 0)

        # Quality metrics (deterministic)
        diversities = []
        type_counts_list = []
        for r in runs:
            q = r.get("quality", {}).get("deterministic", {})
            if q:
                diversities.append(q.get("block_diversity", 0))
                tc = q.get("block_types_used", [])
                type_counts_list.append(len(tc) if isinstance(tc, list) else tc)

        entry = {
            "runs": len(result_runs),
            "turns": stats(turns),
            "input_tokens": stats(inputs),
            "output_tokens": stats(outputs),
            "cache_read_tokens": stats(cache_reads),
            "cost_usd": stats(costs),
            "duration_s": stats(durations),
            "tool_calls": stats(tools),
        }

        if diversities:
            entry["diversity"] = stats(diversities)
            entry["block_types"] = stats(type_counts_list)

        if assert_total > 0:
            entry["assert_pass_rate"] = round(assert_passed / assert_total * 100, 1)
            entry["assert_passed"] = assert_passed
            entry["assert_total"] = assert_total

        if quality_scores:
            entry["quality"] = stats(quality_scores)
        if error_counts:
            entry["error_count"] = stats(error_counts)

        table[version] = entry

    return table


def print_comparison(table):
    """Pretty-print comparison table with CIs and effect sizes."""
    versions = sorted(table.keys())

    print(f"\n{'═' * 90}")
    print(f"  SKILL VERSION COMPARISON — {len(versions)} versions")
    print(f"{'═' * 90}")

    metrics = [
        ("Runs", "runs", "", False),
        ("Turns", "turns", "", False),
        ("Input tokens", "input_tokens", "", False),
        ("Output tokens", "output_tokens", "", False),
        ("Cache read tok", "cache_read_tokens", "", False),
        ("Cost ($)", "cost_usd", "$", True),
        ("Duration (s)", "duration_s", "s", False),
        ("Tool calls", "tool_calls", "", False),
        ("Assert pass %", "assert_pass_rate", "%", False),
        ("Quality", "quality", "", False),
        ("Errors", "error_count", "", False),
    ]

    # Header
    header = f"  {'Metric':<20}"
    for v in versions:
        header += f" {v:>22}"
    print(header)
    print(f"  {'─' * 20}" + f" {'─' * 22}" * len(versions))

    for label, key, unit, is_cost in metrics:
        # Skip optional metrics not present in any version
        if key in ("quality", "error_count", "assert_pass_rate"):
            if not any(key in table[v] for v in versions):
                continue

        row = f"  {label:<20}"
        for v in versions:
            d = table[v]
            if key == "runs":
                row += f" {d[key]:>22}"
            elif key == "assert_pass_rate":
                if key in d:
                    row += f" {d[key]:>5.1f}% ({d['assert_passed']}/{d['assert_total']})     "
                else:
                    row += f" {'—':>22}"
            elif key not in d:
                row += f" {'—':>22}"
            else:
                m = d[key]["mean"]
                ci_lo = d[key]["ci_lo"]
                ci_hi = d[key]["ci_hi"]
                if is_cost:
                    row += f" ${m:.4f} [{ci_lo:.4f},{ci_hi:.4f}]"
                elif key == "quality":
                    row += f" {m:>5.2f} [{ci_lo:.2f},{ci_hi:.2f}]   "
                else:
                    row += f" {m:>8,.0f} [{ci_lo:,.0f},{ci_hi:,.0f}]"
        print(row)

    # Delta vs baseline with effect sizes
    baseline = versions[0]
    if len(versions) > 1:
        print(f"\n  Δ vs {baseline}:")
        for v in versions[1:]:
            parts = []
            for key, label in [("output_tokens", "output"), ("cost_usd", "cost"), ("quality", "quality")]:
                if key not in table[baseline] or key not in table[v]:
                    continue
                base_mean = table[baseline][key]["mean"]
                this_mean = table[v][key]["mean"]
                if base_mean:
                    pct = ((this_mean - base_mean) / base_mean * 100)
                else:
                    pct = 0
                # Would need raw values for effect size; use stored n for now
                parts.append(f"{label} {pct:+.1f}%")
            print(f"    {v}: {' | '.join(parts)}")

    print()


def print_markdown(table):
    """Output markdown comparison table."""
    versions = sorted(table.keys())

    print(f"| Metric | {' | '.join(versions)} |")
    print(f"|---|{'|'.join(['---'] * len(versions))}|")

    rows = [
        ("Runs", "runs", False),
        ("Turns (mean)", "turns", False),
        ("Input tokens", "input_tokens", False),
        ("Output tokens", "output_tokens", False),
        ("Cache read", "cache_read_tokens", False),
        ("Cost ($)", "cost_usd", True),
        ("Duration (s)", "duration_s", False),
        ("Tool calls", "tool_calls", False),
    ]

    for label, key, is_cost in rows:
        cells = []
        for v in versions:
            d = table[v]
            if key == "runs":
                cells.append(str(d[key]))
            elif is_cost:
                cells.append(f"${d[key]['mean']:.4f}")
            else:
                cells.append(f"{d[key]['mean']:,.0f}")
        print(f"| {label} | {' | '.join(cells)} |")


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 report.py <results_dir> [--markdown] [--json]", file=sys.stderr)
        sys.exit(1)

    results_dir = sys.argv[1]
    versions = load_results(results_dir)

    if not versions:
        print(f"No results found in {results_dir}", file=sys.stderr)
        sys.exit(1)

    table = compare(versions)

    if "--json" in sys.argv:
        print(json.dumps(table, indent=2))
    elif "--markdown" in sys.argv:
        print_markdown(table)
    else:
        print_comparison(table)


if __name__ == "__main__":
    main()
