#!/usr/bin/env python3
"""
analyze-results.py — Detailed cost/token/quality analysis from eval results.

Usage:
  python3 evals/scripts/analyze-results.py evals/results/
  python3 evals/scripts/analyze-results.py evals/results/ --json
  python3 evals/scripts/analyze-results.py evals/results/ --save-report
"""

import json
import os
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = EVAL_DIR.parent
QUALITY_PY = EVAL_DIR / "scripts" / "quality.py"

# Sonnet pricing (per token)
INPUT_PRICE = 3.0 / 1_000_000
OUTPUT_PRICE = 15.0 / 1_000_000
CACHE_READ_PRICE = 0.30 / 1_000_000
CACHE_WRITE_PRICE = 3.75 / 1_000_000


def load_results(results_dir):
    """Load all result JSONs grouped by version and scenario."""
    data = defaultdict(lambda: defaultdict(list))
    for ver_dir in sorted(Path(results_dir).iterdir()):
        if not ver_dir.is_dir():
            continue
        ver = ver_dir.name
        for f in sorted(ver_dir.glob("*.json")):
            if f.name.endswith("-deck.json"):
                continue
            with open(f, encoding="utf-8") as fh:
                r = json.load(fh)
            scenario = r.get("scenario", "")
            t = r.get("totals", {})
            a = r.get("assertions", {})

            # Check deck format
            deck_f = f.with_name(f.stem + "-deck.json")
            compact = verbose = deck_size = 0
            types_used = []
            slides = 0
            if deck_f.exists():
                raw = deck_f.read_text()
                compact = raw.count('"_":')
                verbose = raw.count('"type":')
                deck_size = len(raw)
                # Run quality.py
                qr = subprocess.run(
                    ["python3", str(QUALITY_PY), str(deck_f), "--json"],
                    capture_output=True, text=True,
                )
                if qr.returncode == 0:
                    q = json.loads(qr.stdout)
                    types_used = q.get("block_types_used", [])
                    slides = q.get("slide_count", 0)

            data[ver][scenario].append({
                "file": f.name,
                "cost": t.get("cost_usd", 0),
                "duration": t.get("duration_s", 0),
                "turns": r.get("turns", 0),
                "input_tokens": t.get("input_tokens", 0),
                "output_tokens": t.get("output_tokens", 0),
                "cache_read": t.get("cache_read_tokens", 0),
                "cache_write": t.get("cache_write_tokens", 0),
                "assert_pass": a.get("passed", 0),
                "assert_total": a.get("total", 0),
                "is_compact": compact > verbose and deck_size > 0,
                "deck_size": deck_size,
                "block_types": len(types_used),
                "slides": slides,
                "error": r.get("error", ""),
            })
    return data


def calc_cost(r):
    """Calculate accurate cost from token counts."""
    return (
        r["input_tokens"] * INPUT_PRICE
        + r["output_tokens"] * OUTPUT_PRICE
        + r["cache_read"] * CACHE_READ_PRICE
        + r["cache_write"] * CACHE_WRITE_PRICE
    )


def avg(vals):
    return sum(vals) / len(vals) if vals else 0


def print_report(data):
    """Print detailed comparison report."""
    versions = sorted(data.keys())

    print("=" * 100)
    print("EVAL RESULTS ANALYSIS")
    print("=" * 100)

    # Per-scenario breakdown
    all_scenarios = set()
    for ver in versions:
        all_scenarios.update(data[ver].keys())

    for scenario in sorted(all_scenarios):
        print(f"\n── {scenario} ──")
        print(f"{'Ver':>8} {'Assert':>8} {'Compact':>8} {'Cost':>8} {'Time':>6} "
              f"{'Turns':>6} {'OutTok':>8} {'Types':>6} {'Deck':>7}")
        print("-" * 80)

        for ver in versions:
            runs = data[ver].get(scenario, [])
            if not runs:
                continue
            ap = sum(r["assert_pass"] for r in runs)
            at = sum(r["assert_total"] for r in runs)
            compact_count = sum(1 for r in runs if r["is_compact"])
            deck_count = sum(1 for r in runs if r["deck_size"] > 0)

            print(
                f"{ver:>8} {ap}/{at:>5} "
                f"{compact_count}/{deck_count:>5} "
                f"${avg([r['cost'] for r in runs]):>7.3f} "
                f"{avg([r['duration'] for r in runs]):>5.0f}s "
                f"{avg([r['turns'] for r in runs]):>5.0f} "
                f"{avg([r['output_tokens'] for r in runs]):>7,.0f} "
                f"{avg([r['block_types'] for r in runs]):>5.0f} "
                f"{avg([r['deck_size'] for r in runs if r['deck_size']>0])/1024:>5.1f}KB"
            )

    # Totals
    print("\n" + "=" * 100)
    print("TOTALS")
    print("=" * 100)
    print(f"{'Ver':>8} {'Runs':>5} {'Assert':>10} {'Compact':>8} "
          f"{'Cost':>10} {'AvgTime':>8} {'OutTok':>10} {'Types':>6}")
    print("-" * 80)

    for ver in versions:
        all_runs = [r for s in data[ver].values() for r in s]
        ap = sum(r["assert_pass"] for r in all_runs)
        at = sum(r["assert_total"] for r in all_runs)
        compact = sum(1 for r in all_runs if r["is_compact"])
        decks = sum(1 for r in all_runs if r["deck_size"] > 0)
        total_cost = sum(r["cost"] for r in all_runs)

        print(
            f"{ver:>8} {len(all_runs):>5} "
            f"{ap}/{at} ({ap/at*100:.0f}%) " if at else f"{ver:>8} {len(all_runs):>5} 0/0 "
            f"{compact}/{decks:>5} "
            f"${total_cost:>9.3f} "
            f"{avg([r['duration'] for r in all_runs]):>7.0f}s "
            f"{sum(r['output_tokens'] for r in all_runs):>9,} "
            f"{avg([r['block_types'] for r in all_runs if r['block_types']>0]):>5.0f}"
        )

    # Token cost breakdown
    print("\n" + "=" * 100)
    print("COST BREAKDOWN (by token type)")
    print("=" * 100)
    print(f"{'Ver':>8} {'Input':>10} {'Output':>10} {'CacheRead':>10} "
          f"{'CacheWrite':>10} {'TOTAL':>10}")
    print("-" * 70)

    for ver in versions:
        all_runs = [r for s in data[ver].values() for r in s]
        ci = sum(r["input_tokens"] for r in all_runs) * INPUT_PRICE
        co = sum(r["output_tokens"] for r in all_runs) * OUTPUT_PRICE
        cr = sum(r["cache_read"] for r in all_runs) * CACHE_READ_PRICE
        cw = sum(r["cache_write"] for r in all_runs) * CACHE_WRITE_PRICE
        total = ci + co + cr + cw
        print(
            f"{ver:>8} ${ci:>9.4f} ${co:>9.4f} ${cr:>9.4f} "
            f"${cw:>9.4f} ${total:>9.4f}"
        )


def save_report(data, results_dir):
    """Save timestamped JSON report."""
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    commit = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"],
        capture_output=True, text=True, cwd=str(REPO_ROOT),
    ).stdout.strip()

    report = {
        "run_id": run_id,
        "commit": commit,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "versions": {},
    }

    for ver, scenarios in data.items():
        all_runs = [r for s in scenarios.values() for r in s]
        ap = sum(r["assert_pass"] for r in all_runs)
        at = sum(r["assert_total"] for r in all_runs)

        report["versions"][ver] = {
            "runs": len(all_runs),
            "assertions": {"passed": ap, "total": at},
            "compact_decks": sum(1 for r in all_runs if r["is_compact"]),
            "total_cost": sum(r["cost"] for r in all_runs),
            "avg_duration": avg([r["duration"] for r in all_runs]),
            "total_output_tokens": sum(r["output_tokens"] for r in all_runs),
        }

    reports_dir = EVAL_DIR / "reports"
    reports_dir.mkdir(exist_ok=True)
    out_path = reports_dir / f"{run_id}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")
    print(f"\nReport saved: {out_path}")


def main():
    args = sys.argv[1:]
    if not args:
        print("Usage: python3 analyze-results.py <results-dir> [--json] [--save-report]")
        sys.exit(1)

    results_dir = args[0]
    do_json = "--json" in args
    do_save = "--save-report" in args

    data = load_results(results_dir)

    if do_json:
        # Dump raw data
        output = {}
        for ver, scenarios in data.items():
            output[ver] = {s: runs for s, runs in scenarios.items()}
        print(json.dumps(output, indent=2))
    else:
        print_report(data)

    if do_save:
        save_report(data, results_dir)


if __name__ == "__main__":
    main()
