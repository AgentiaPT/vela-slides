#!/usr/bin/env python3
"""
baseline.py — Save and compare eval baselines.

Usage:
  python3 baseline.py save <version>                    # Snapshot results → baselines/
  python3 baseline.py compare <version> [--baseline V]  # Compare against baseline
  python3 baseline.py latest                            # Show current baseline
  python3 baseline.py list                              # List all baselines
"""

import json
import sys
import os
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent.parent
RESULTS_DIR = EVAL_DIR / "results"
BASELINES_DIR = EVAL_DIR / "baselines"


def load_version_results(version):
    """Load all result JSONs for a version."""
    version_dir = RESULTS_DIR / version
    if not version_dir.is_dir():
        return []
    runs = []
    for f in sorted(version_dir.glob("*.json")):
        with open(f, encoding="utf-8") as fh:
            data = json.load(fh)
            if isinstance(data, list):
                runs.extend(data)
            else:
                runs.append(data)
    return runs


def save_baseline(version):
    """Save a version's results as a baseline."""
    BASELINES_DIR.mkdir(exist_ok=True)
    runs = load_version_results(version)
    if not runs:
        print(f"No results found for {version} in {RESULTS_DIR}", file=sys.stderr)
        sys.exit(1)

    baseline = {
        "version": version,
        "runs": runs,
        "run_count": len(runs),
    }

    out_path = BASELINES_DIR / f"{version}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(baseline, f, indent=2)

    # Update latest symlink
    latest = BASELINES_DIR / "latest.json"
    if latest.is_symlink() or latest.exists():
        latest.unlink()
    latest.symlink_to(f"{version}.json")

    print(f"Saved baseline: {out_path} ({len(runs)} runs)")
    print(f"Updated latest → {version}")


def load_baseline(version=None):
    """Load a baseline. If version is None, load latest."""
    if version:
        path = BASELINES_DIR / f"{version}.json"
    else:
        path = BASELINES_DIR / "latest.json"

    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def mean(values):
    return sum(values) / len(values) if values else 0


def compare_versions(current_version, baseline_version=None):
    """Compare current results against a baseline."""
    current_runs = load_version_results(current_version)
    if not current_runs:
        print(f"No results for {current_version}", file=sys.stderr)
        sys.exit(1)

    baseline = load_baseline(baseline_version)
    if not baseline:
        label = baseline_version or "latest"
        print(f"No baseline found ({label})", file=sys.stderr)
        sys.exit(1)

    base_runs = baseline["runs"]
    base_ver = baseline["version"]

    metrics = ["cost_usd", "duration_s", "tool_calls", "output_tokens"]
    print(f"\n{'═' * 60}")
    print(f"  {current_version} vs {base_ver} (baseline)")
    print(f"{'═' * 60}")
    print(f"  {'Metric':<20} {'Baseline':>12} {'Current':>12} {'Delta':>12}")
    print(f"  {'─' * 20} {'─' * 12} {'─' * 12} {'─' * 12}")

    regressions = []
    for m in metrics:
        base_vals = [r["totals"].get(m, 0) for r in base_runs if "totals" in r]
        curr_vals = [r["totals"].get(m, 0) for r in current_runs if "totals" in r]
        base_mean = mean(base_vals)
        curr_mean = mean(curr_vals)
        if base_mean > 0:
            delta_pct = (curr_mean - base_mean) / base_mean * 100
        else:
            delta_pct = 0

        if m == "cost_usd":
            print(f"  {m:<20} ${base_mean:>11.4f} ${curr_mean:>11.4f} {delta_pct:>+11.1f}%")
        else:
            print(f"  {m:<20} {base_mean:>12,.0f} {curr_mean:>12,.0f} {delta_pct:>+11.1f}%")

        # Flag regressions
        if m == "cost_usd" and delta_pct > 20:
            regressions.append(f"Cost increased {delta_pct:.1f}% (threshold: 20%)")
        if m == "duration_s" and delta_pct > 30:
            regressions.append(f"Duration increased {delta_pct:.1f}% (threshold: 30%)")

    print()
    if regressions:
        print("  REGRESSIONS:")
        for r in regressions:
            print(f"    - {r}")
    else:
        print("  No regressions detected.")
    print()
    return len(regressions)


def list_baselines():
    """List all saved baselines."""
    if not BASELINES_DIR.exists():
        print("No baselines directory")
        return
    latest = None
    if (BASELINES_DIR / "latest.json").is_symlink():
        latest = os.readlink(BASELINES_DIR / "latest.json").replace(".json", "")

    for f in sorted(BASELINES_DIR.glob("*.json")):
        if f.name == "latest.json":
            continue
        ver = f.stem
        with open(f, encoding="utf-8") as fh:
            data = json.load(fh)
        n = data.get("run_count", len(data.get("runs", [])))
        marker = " (latest)" if ver == latest else ""
        print(f"  {ver}: {n} runs{marker}")


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 baseline.py <save|compare|latest|list> [args]", file=sys.stderr)
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "save":
        if len(sys.argv) < 3:
            print("Usage: python3 baseline.py save <version>", file=sys.stderr)
            sys.exit(1)
        save_baseline(sys.argv[2])

    elif cmd == "compare":
        if len(sys.argv) < 3:
            print("Usage: python3 baseline.py compare <version> [--baseline V]", file=sys.stderr)
            sys.exit(1)
        base_ver = None
        if "--baseline" in sys.argv:
            idx = sys.argv.index("--baseline")
            if idx + 1 < len(sys.argv):
                base_ver = sys.argv[idx + 1]
        regressions = compare_versions(sys.argv[2], base_ver)
        sys.exit(1 if regressions > 0 else 0)

    elif cmd == "latest":
        latest = BASELINES_DIR / "latest.json"
        if latest.exists():
            with open(latest, encoding="utf-8") as f:
                data = json.load(f)
            print(f"Latest baseline: {data['version']} ({data.get('run_count', '?')} runs)")
        else:
            print("No baseline saved yet")

    elif cmd == "list":
        list_baselines()

    else:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
