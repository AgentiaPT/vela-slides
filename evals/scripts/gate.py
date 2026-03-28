#!/usr/bin/env python3
"""
gate.py — Eval regression gate.

Compares eval results against a baseline and exits non-zero on regression.

Usage:
  python3 gate.py <results_dir>                              # Compare against latest baseline
  python3 gate.py <results_dir> --baseline baselines/v3.1.json
  python3 gate.py --dry-run                                  # Validate script compiles

Regression criteria (any triggers failure):
  - Any assertion fails in >50% of trials
  - Cost increases >20% vs baseline
  - Quality (overall) drops >0.5pt vs baseline
  - Duration increases >30% vs baseline
"""

import json
import sys
import os
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent.parent
BASELINES_DIR = EVAL_DIR / "baselines"

# Regression thresholds
COST_THRESHOLD = 0.20       # 20% increase
DURATION_THRESHOLD = 0.30   # 30% increase
QUALITY_THRESHOLD = 0.5     # 0.5 point drop (on 3-point scale)
ASSERTION_THRESHOLD = 0.50  # >50% failure rate


def load_results(results_dir):
    """Load all result JSONs from a directory (flat or version-nested)."""
    results_dir = Path(results_dir)
    runs = []

    # Try flat directory first
    for f in sorted(results_dir.glob("*.json")):
        with open(f) as fh:
            data = json.load(fh)
            if isinstance(data, list):
                runs.extend(data)
            else:
                runs.append(data)

    # Try nested version dirs
    if not runs:
        for vdir in sorted(results_dir.iterdir()):
            if vdir.is_dir():
                for f in sorted(vdir.glob("*.json")):
                    with open(f) as fh:
                        data = json.load(fh)
                        if isinstance(data, list):
                            runs.extend(data)
                        else:
                            runs.append(data)
    return runs


def load_baseline(path=None):
    """Load baseline from explicit path or latest."""
    if path:
        p = Path(path)
    else:
        p = BASELINES_DIR / "latest.json"

    if not p.exists():
        return None
    with open(p) as f:
        return json.load(f)


def mean(values):
    return sum(values) / len(values) if values else 0


def gate(results_dir, baseline_path=None):
    """Run regression gate. Returns (passed, report_lines)."""
    runs = load_results(results_dir)
    if not runs:
        return False, ["No results found"]

    baseline = load_baseline(baseline_path)
    report = []
    failures = []

    # --- Assertion pass rate ---
    validation_results = []
    for r in runs:
        v = r.get("validation")
        if v and isinstance(v, dict):
            total = v.get("total", 0)
            passed = v.get("passed", 0)
            if total > 0:
                validation_results.append(passed / total)

    if validation_results:
        assertion_rate = mean(validation_results)
        report.append(f"Assertion pass rate: {assertion_rate:.0%}")
        if assertion_rate < (1 - ASSERTION_THRESHOLD):
            failures.append(f"Assertion failure rate {1-assertion_rate:.0%} exceeds {ASSERTION_THRESHOLD:.0%} threshold")

    # --- Comparison vs baseline ---
    if baseline:
        base_runs = baseline.get("runs", [])
        base_ver = baseline.get("version", "?")
        report.append(f"Baseline: {base_ver} ({len(base_runs)} runs)")

        # Cost
        base_cost = mean([r["totals"].get("cost_usd", 0) for r in base_runs if "totals" in r])
        curr_cost = mean([r["totals"].get("cost_usd", 0) for r in runs if "totals" in r])
        if base_cost > 0:
            cost_delta = (curr_cost - base_cost) / base_cost
            report.append(f"Cost: ${curr_cost:.4f} vs ${base_cost:.4f} ({cost_delta:+.1%})")
            if cost_delta > COST_THRESHOLD:
                failures.append(f"Cost increased {cost_delta:.1%} (threshold: {COST_THRESHOLD:.0%})")

        # Duration
        base_dur = mean([r["totals"].get("duration_s", 0) for r in base_runs if "totals" in r])
        curr_dur = mean([r["totals"].get("duration_s", 0) for r in runs if "totals" in r])
        if base_dur > 0:
            dur_delta = (curr_dur - base_dur) / base_dur
            report.append(f"Duration: {curr_dur:.0f}s vs {base_dur:.0f}s ({dur_delta:+.1%})")
            if dur_delta > DURATION_THRESHOLD:
                failures.append(f"Duration increased {dur_delta:.1%} (threshold: {DURATION_THRESHOLD:.0%})")

        # Quality (if present)
        base_quality = [r.get("quality", {}).get("judge", {}).get("overall", 0)
                        for r in base_runs if r.get("quality", {}).get("judge")]
        curr_quality = [r.get("quality", {}).get("judge", {}).get("overall", 0)
                        for r in runs if r.get("quality", {}).get("judge")]
        if base_quality and curr_quality:
            base_q = mean(base_quality)
            curr_q = mean(curr_quality)
            q_delta = curr_q - base_q
            report.append(f"Quality: {curr_q:.2f} vs {base_q:.2f} ({q_delta:+.2f})")
            if q_delta < -QUALITY_THRESHOLD:
                failures.append(f"Quality dropped {abs(q_delta):.2f}pt (threshold: {QUALITY_THRESHOLD:.1f}pt)")
    else:
        report.append("No baseline available — skipping comparison")

    # --- Summary ---
    passed = len(failures) == 0
    report.append("")
    if passed:
        report.append("GATE: PASSED")
    else:
        report.append("GATE: FAILED")
        for f in failures:
            report.append(f"  - {f}")

    return passed, report


def main():
    if "--dry-run" in sys.argv:
        print("gate.py: dry-run OK")
        sys.exit(0)

    if len(sys.argv) < 2:
        print("Usage: python3 gate.py <results_dir> [--baseline <path>]", file=sys.stderr)
        print("       python3 gate.py --dry-run", file=sys.stderr)
        sys.exit(2)

    results_dir = sys.argv[1]
    baseline_path = None
    if "--baseline" in sys.argv:
        idx = sys.argv.index("--baseline")
        if idx + 1 < len(sys.argv):
            baseline_path = sys.argv[idx + 1]

    passed, report = gate(results_dir, baseline_path)
    for line in report:
        print(line)

    if "--json" in sys.argv:
        print(json.dumps({"passed": passed, "report": report}, indent=2))

    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
