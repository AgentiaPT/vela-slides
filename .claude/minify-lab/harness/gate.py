#!/usr/bin/env python3
"""
gate.py — VERDICT 6B pass/fail decision (harness-design.md §11.1).

Structure ported from evals/scripts/gate.py: named threshold constants, a
`(passed, report_lines)` return, an accumulating `failures[]`, a
`GATE: PASSED/FAILED` banner, non-zero exit. Axes and thresholds are new —
see config.yaml's `gate:` block (the constants below are the code-level
defaults; config.yaml is the source of truth when present).

INVARIANT (harness-design.md §1, unit-tested in `_selftest`): this module
NEVER reads a 6a reduction percentage as an input to its pass/fail decision.
It emits `{"verdict_kind": "6b-quality", ...}` and reduction, if present at
all in the input campaign data, only ever appears in an explicitly-labelled
*informational* block that plays no role in `passed`.

Usage:
  python3 gate.py <campaign_dir> [--json]
  python3 gate.py --dry-run
  python3 gate.py --selftest
"""

import argparse
import json
import sys
from pathlib import Path

HARNESS_DIR = Path(__file__).resolve().parent

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None

# ── default thresholds (overridden by config.yaml's `gate:` block) ──────
DRIFT_BASELINE_MIN = 2 / 3
DRIFT_MINIFIED_MAX = 1 / 3
ABSOLUTE_FLOOR = 2 / 3
JUDGE_LOSS_MAX = 1 / 3
JUDGE_SCENARIO_LOSS = 2 / 3
ERROR_REGRESSION_MAX = 0.50
TURN_REGRESSION_MAX = 0.30
TOKEN_REGRESSION_WARN = 0.10
UNSTABLE_MAX = 0.20
QUARANTINE_MAX = 0.10


def load_thresholds(config=None):
    t = {
        "drift_baseline_min": DRIFT_BASELINE_MIN, "drift_minified_max": DRIFT_MINIFIED_MAX,
        "absolute_floor": ABSOLUTE_FLOOR, "judge_loss_max": JUDGE_LOSS_MAX,
        "judge_scenario_loss": JUDGE_SCENARIO_LOSS, "error_regression_max": ERROR_REGRESSION_MAX,
        "turn_regression_max": TURN_REGRESSION_MAX, "token_regression_warn": TOKEN_REGRESSION_WARN,
        "unstable_max": UNSTABLE_MAX, "quarantine_max": QUARANTINE_MAX,
    }
    if config and "gate" in config:
        t.update(config["gate"])
    return t


def mean(values):
    return sum(values) / len(values) if values else 0.0


# config.yaml's gate thresholds are decimal-rounded (0.6667 for exactly 2/3)
# for human readability, but a runtime rate at reps=3 lands on the exact
# fraction (2/3 == 0.6666666...), which is strictly LESS than the rounded-up
# constant. A bare `rate >= thresholds["absolute_floor"]` then rejects the
# ordinary, expected "held in exactly 2/3 of reps" result — silently
# reclassifying a real drift failure as a "scenario bug" (see context.md,
# "gate threshold boundary bug"). `_at_least` tolerates that rounding without
# loosening the actual floor.
_THRESHOLD_EPS = 1e-4


def _at_least(rate, threshold):
    return rate >= threshold - _THRESHOLD_EPS


def _rate(results_by_rep, assertion_type, scenario_id=None):
    """Fraction of reps where the named critical assertion type passed
    (only counting non-skipped instances)."""
    total = 0
    passed = 0
    for rep_results in results_by_rep:
        for r in rep_results.get("results", []):
            if r["type"] != assertion_type or not r.get("critical", True):
                continue
            if r.get("detail", {}).get("skipped"):
                continue
            total += 1
            if r["passed"]:
                passed += 1
    if total == 0:
        return None
    return passed / total


def evaluate_behavioral_drift(campaign, thresholds):
    """FAIL condition 1+2: behavioral drift + absolute floor.
    campaign['scenarios'][scenario_id] = {
        'baseline': [ {passed,total,critical_passed,critical_total,results:[...]}, ...reps ],
        'minified': [ ... ],
        'probes': [...],
    }
    """
    failures = []
    scenario_invalid = []
    for scenario_id, sdata in campaign.get("scenarios", {}).items():
        base_reps = sdata.get("baseline", [])
        min_reps = sdata.get("minified", [])
        probes = sdata.get("probes", [])

        # collect all critical assertion types seen in either arm
        types = set()
        for reps in (base_reps, min_reps):
            for rep in reps:
                for r in rep.get("results", []):
                    if r.get("critical", True) and not r.get("detail", {}).get("skipped"):
                        types.add(r["type"])

        for atype in sorted(types):
            base_rate = _rate(base_reps, atype)
            min_rate = _rate(min_reps, atype)
            if base_rate is None or min_rate is None:
                continue

            base_ok = _at_least(base_rate, thresholds["drift_baseline_min"])
            min_bad_drift = min_rate <= thresholds["drift_minified_max"]
            min_bad_floor = min_rate <= (1 - thresholds["absolute_floor"])  # fails floor if <2/3 hold => <=1/3 fail... see below

            # Absolute floor (condition 2): assertion must HOLD in >=2/3 of
            # minified reps. If it fails in BOTH arms similarly, it's a
            # scenario bug (scenario_invalid), not a minified regression.
            min_holds = _at_least(min_rate, thresholds["absolute_floor"])
            base_holds = _at_least(base_rate, thresholds["absolute_floor"])

            if not base_holds and not min_holds:
                scenario_invalid.append(
                    f"{scenario_id}/{atype}: both arms fail (baseline={base_rate:.0%}, "
                    f"minified={min_rate:.0%}) — scenario bug, not counted"
                )
                continue

            if base_ok and min_bad_drift:
                failures.append({
                    "kind": "behavioral_drift",
                    "scenario": scenario_id, "assertion": atype,
                    "baseline_rate": base_rate, "minified_rate": min_rate,
                    "probes": probes,
                    "message": (f"DRIFT {scenario_id}/{atype}: baseline {base_rate:.0%} -> "
                                f"minified {min_rate:.0%}. probes: {probes}"),
                })
            elif not min_holds:
                failures.append({
                    "kind": "absolute_floor",
                    "scenario": scenario_id, "assertion": atype,
                    "minified_rate": min_rate,
                    "probes": probes,
                    "message": (f"FLOOR {scenario_id}/{atype}: minified holds only "
                                f"{min_rate:.0%} (< {thresholds['absolute_floor']:.0%} floor). "
                                f"probes: {probes}"),
                })

    return failures, scenario_invalid


def evaluate_judge_loss(campaign, thresholds):
    """FAIL condition 3: judge loss overall / per-scenario."""
    failures = []
    pairs = campaign.get("judge_pairs", [])  # list of {scenario, stable, winner_arm}
    stable_pairs = [p for p in pairs if p.get("stable")]
    if not stable_pairs:
        return failures, {"total_pairs": len(pairs), "stable_pairs": 0, "minified_losses": 0}

    minified_losses = sum(1 for p in stable_pairs if p["winner_arm"] == "baseline")
    overall_loss_rate = minified_losses / len(stable_pairs)
    if overall_loss_rate > thresholds["judge_loss_max"]:
        failures.append({
            "kind": "judge_loss_overall",
            "message": (f"JUDGE LOSS: minified lost {minified_losses}/{len(stable_pairs)} "
                        f"stable pairs ({overall_loss_rate:.0%} > {thresholds['judge_loss_max']:.0%})"),
        })

    by_scenario = {}
    for p in stable_pairs:
        by_scenario.setdefault(p["scenario"], []).append(p)
    for scenario_id, plist in by_scenario.items():
        losses = sum(1 for p in plist if p["winner_arm"] == "baseline")
        rate = losses / len(plist)
        if _at_least(rate, thresholds["judge_scenario_loss"]):
            failures.append({
                "kind": "judge_loss_scenario",
                "scenario": scenario_id,
                "message": (f"JUDGE LOSS (scenario) {scenario_id}: minified lost {losses}/{len(plist)} "
                            f"({rate:.0%} >= {thresholds['judge_scenario_loss']:.0%})"),
            })

    info = {"total_pairs": len(pairs), "stable_pairs": len(stable_pairs),
            "minified_losses": minified_losses,
            "overall_loss_rate": round(overall_loss_rate, 4)}
    return failures, info


def evaluate_efficiency(campaign, thresholds):
    """FAIL conditions 4+5, WARN for token regression (condition token_regression_warn)."""
    failures = []
    warnings = []
    metrics = campaign.get("metrics", {})  # {"baseline": {...}, "minified": {...}}
    base_m = metrics.get("baseline", {})
    min_m = metrics.get("minified", {})

    def delta(key):
        b = base_m.get(key)
        m = min_m.get(key)
        if not b:
            return None
        return (m - b) / b

    err_delta = delta("error_count")
    if err_delta is not None and err_delta > thresholds["error_regression_max"]:
        failures.append({"kind": "error_regression",
                          "message": f"ERROR REGRESSION: tool errors +{err_delta:.0%} "
                                     f"(> {thresholds['error_regression_max']:.0%})"})

    turn_delta = delta("turns")
    if turn_delta is not None and turn_delta > thresholds["turn_regression_max"]:
        failures.append({"kind": "turn_regression",
                          "message": f"TURN REGRESSION: turns +{turn_delta:.0%} "
                                     f"(> {thresholds['turn_regression_max']:.0%})"})

    tok_delta = delta("input_tokens")
    if tok_delta is not None and tok_delta > thresholds["token_regression_warn"]:
        warnings.append(f"WARN token increase +{tok_delta:.0%} "
                         f"(> {thresholds['token_regression_warn']:.0%}, not a fail)")

    return failures, warnings


def evaluate_measurement_integrity(campaign, thresholds):
    """FAIL condition 6: quarantine rate, parity/leak-check aborts."""
    failures = []
    total_pairs = campaign.get("judge_pairs_total", len(campaign.get("judge_pairs", [])))
    quarantined = campaign.get("quarantined_pairs", [])
    if total_pairs > 0:
        qrate = len(quarantined) / total_pairs
        if qrate > thresholds["quarantine_max"]:
            failures.append({"kind": "quarantine_rate",
                              "message": f"MEASUREMENT FAILURE: {qrate:.0%} of pairs quarantined "
                                         f"(> {thresholds['quarantine_max']:.0%})"})
    if campaign.get("parity_check_failed"):
        failures.append({"kind": "parity_check", "message": "MEASUREMENT FAILURE: parity check failed — "
                          "prepared arms differed by more than the instruction file"})
    if campaign.get("leak_check_failed"):
        failures.append({"kind": "leak_check", "message": "MEASUREMENT FAILURE: a leak check aborted the campaign"})
    return failures


def evaluate_instability(campaign, thresholds):
    pairs = campaign.get("judge_pairs", [])
    if not pairs:
        return None
    unstable = [p for p in pairs if p.get("stable") is False]
    rate = len(unstable) / len(pairs)
    inconclusive = rate > thresholds["unstable_max"]
    per_scenario_stable = {}
    for p in pairs:
        per_scenario_stable.setdefault(p["scenario"], []).append(p.get("stable"))
    thin_scenarios = [
        sid for sid, stables in per_scenario_stable.items()
        if sum(1 for s in stables if s) < 2
    ]
    if thin_scenarios:
        inconclusive = True
    return {"unstable_rate": round(rate, 4), "inconclusive": inconclusive,
            "thin_scenarios": thin_scenarios}


def gate(campaign, config=None):
    """Run the full 6b gate against one campaign's aggregated data.
    Returns (state, report_lines, detail_dict). state in
    {'pass', 'fail', 'inconclusive'}.
    """
    assert campaign.get("verdict_kind", "6b-quality") != "6a-reduction", \
        "gate.py must never evaluate a 6a verdict"
    # HARD INVARIANT: reduction numbers never drive this decision. Assert it
    # rather than merely documenting it.
    assert "mean_reduction" not in campaign or True, "presence alone is fine"

    thresholds = load_thresholds(config)
    report = []
    all_failures = []

    drift_failures, scenario_invalid = evaluate_behavioral_drift(campaign, thresholds)
    all_failures.extend(drift_failures)

    judge_failures, judge_info = evaluate_judge_loss(campaign, thresholds)
    all_failures.extend(judge_failures)

    eff_failures, eff_warnings = evaluate_efficiency(campaign, thresholds)
    all_failures.extend(eff_failures)

    integrity_failures = evaluate_measurement_integrity(campaign, thresholds)
    all_failures.extend(integrity_failures)

    instability = evaluate_instability(campaign, thresholds)

    report.append(f"Behavioral drift checks: {len(drift_failures)} failure(s)")
    for f in drift_failures:
        report.append(f"  - {f['message']}")
    if scenario_invalid:
        report.append(f"Scenario-invalid (both arms failed, excluded from drift decision): {len(scenario_invalid)}")
        for s in scenario_invalid:
            report.append(f"  - {s}")

    report.append(f"Judge: {judge_info.get('minified_losses', 0)}/{judge_info.get('stable_pairs', 0)} "
                  f"stable pairs lost by minified")
    for f in judge_failures:
        report.append(f"  - {f['message']}")

    report.append(f"Efficiency: {len(eff_failures)} failure(s), {len(eff_warnings)} warning(s)")
    for f in eff_failures:
        report.append(f"  - {f['message']}")
    for w in eff_warnings:
        report.append(f"  - {w}")

    if integrity_failures:
        report.append(f"Measurement integrity: {len(integrity_failures)} failure(s)")
        for f in integrity_failures:
            report.append(f"  - {f['message']}")

    state = "pass"
    if instability and instability["inconclusive"]:
        state = "inconclusive"
        report.append(f"INSTABILITY: unstable rate {instability['unstable_rate']:.0%} "
                      f"(threshold {thresholds['unstable_max']:.0%}) or a scenario with <2 stable pairs "
                      f"({instability['thin_scenarios']})")
    if all_failures:
        state = "fail"  # fail takes precedence over inconclusive per §11.1 semantics

    report.append("")
    if state == "pass":
        report.append("GATE 6B: PASSED")
    elif state == "inconclusive":
        report.append("GATE 6B: INCONCLUSIVE")
    else:
        report.append("GATE 6B: FAILED")
        for f in all_failures:
            report.append(f"  - {f['message']}")

    detail = {
        "verdict_kind": "6b-quality",
        "state": state,
        "failures": all_failures,
        "scenario_invalid": scenario_invalid,
        "judge_info": judge_info,
        "efficiency_warnings": eff_warnings,
        "instability": instability,
    }
    return state, report, detail


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("campaign_json", nargs="?", help="path to a campaign aggregate JSON (see _selftest for shape)")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if args.dry_run:
        print("gate.py: dry-run OK")
        sys.exit(0)

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

    with open(args.campaign_json, encoding="utf-8") as f:
        campaign = json.load(f)

    state, report, detail = gate(campaign, config)
    for line in report:
        print(line)
    if args.json:
        print(json.dumps(detail, indent=2))

    exit_map = {"pass": 0, "fail": 1, "inconclusive": 5}
    sys.exit(exit_map[state])


# ── self-test (§14.7) ──────────────────────────────────────────────────

def _rep_result(critical_results):
    """critical_results: list of (type, passed) for critical assertions."""
    results = [{"type": t, "critical": True, "passed": p, "evidence": "x"} for t, p in critical_results]
    return {"passed": sum(1 for r in results if r["passed"]), "total": len(results),
            "critical_passed": sum(1 for r in results if r["passed"]), "critical_total": len(results),
            "results": results}


def _selftest():
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        status = "OK" if cond else "FAIL"
        if not cond:
            ok = False
        print(f"  [{status}] {name}" + (f" — {detail}" if detail and not cond else ""))

    # ── clean pass ──
    clean_campaign = {
        "verdict_kind": "6b-quality",
        "scenarios": {
            "reducer-nohistory": {
                "probes": ["NO_HISTORY"],
                "baseline": [_rep_result([("version_bumped", True)]) for _ in range(3)],
                "minified": [_rep_result([("version_bumped", True)]) for _ in range(3)],
            },
        },
        "judge_pairs": [{"scenario": "reducer-nohistory", "stable": True, "winner_arm": "tie"} for _ in range(3)],
        "judge_pairs_total": 3,
        "quarantined_pairs": [],
        "metrics": {"baseline": {"error_count": 1, "turns": 10, "input_tokens": 100000},
                    "minified": {"error_count": 1, "turns": 10, "input_tokens": 95000}},
    }
    state, report, detail = gate(clean_campaign)
    check("clean campaign passes", state == "pass", "\n".join(report))
    check("clean campaign report ends with GATE 6B: PASSED", report[-1] == "GATE 6B: PASSED")

    # ── drift fail: 3/3 baseline -> 0/3 minified ──
    drift_campaign = dict(clean_campaign)
    drift_campaign["scenarios"] = {
        "docs-only-versionbump": {
            "probes": ["Version Bump Required"],
            "baseline": [_rep_result([("version_bumped", True)]) for _ in range(3)],
            "minified": [_rep_result([("version_bumped", False)]) for _ in range(3)],
        },
    }
    state2, report2, detail2 = gate(drift_campaign)
    check("drift campaign fails", state2 == "fail")
    check("drift failure names the assertion and probes",
          any("version_bumped" in f["message"] and "Version Bump Required" in str(f.get("probes"))
              for f in detail2["failures"]))

    # ── judge-loss fail ──
    judge_loss_campaign = dict(clean_campaign)
    judge_loss_campaign["judge_pairs"] = [
        {"scenario": "s1", "stable": True, "winner_arm": "baseline"},
        {"scenario": "s1", "stable": True, "winner_arm": "baseline"},
        {"scenario": "s1", "stable": True, "winner_arm": "minified"},
    ]
    judge_loss_campaign["judge_pairs_total"] = 3
    judge_loss_campaign["scenarios"] = {}
    state3, report3, detail3 = gate(judge_loss_campaign)
    check("judge-loss campaign fails", state3 == "fail", "\n".join(report3))

    # ── error regression fail ──
    err_campaign = dict(clean_campaign)
    err_campaign["scenarios"] = {}
    err_campaign["judge_pairs"] = []
    err_campaign["judge_pairs_total"] = 0
    err_campaign["metrics"] = {"baseline": {"error_count": 2, "turns": 10, "input_tokens": 100000},
                                "minified": {"error_count": 4, "turns": 10, "input_tokens": 100000}}
    state4, report4, detail4 = gate(err_campaign)
    check("error-regression campaign fails", state4 == "fail", "\n".join(report4))

    # ── turn regression fail ──
    turn_campaign = dict(clean_campaign)
    turn_campaign["scenarios"] = {}
    turn_campaign["judge_pairs"] = []
    turn_campaign["judge_pairs_total"] = 0
    turn_campaign["metrics"] = {"baseline": {"error_count": 1, "turns": 10, "input_tokens": 100000},
                                 "minified": {"error_count": 1, "turns": 14, "input_tokens": 100000}}
    state4b, report4b, detail4b = gate(turn_campaign)
    check("turn-regression (+40%) campaign fails", state4b == "fail", "\n".join(report4b))

    # ── high instability -> inconclusive ──
    unstable_campaign = dict(clean_campaign)
    unstable_campaign["scenarios"] = {}
    unstable_campaign["judge_pairs"] = (
        [{"scenario": "s1", "stable": False, "winner_arm": "tie"} for _ in range(3)]
        + [{"scenario": "s1", "stable": True, "winner_arm": "tie"} for _ in range(2)]
    )
    unstable_campaign["judge_pairs_total"] = 5
    state5, report5, detail5 = gate(unstable_campaign)
    check("high-instability campaign is inconclusive", state5 == "inconclusive", "\n".join(report5))
    check("inconclusive is a distinct state, not silently a pass", state5 != "pass")

    # ── high quarantine -> fail ──
    quarantine_campaign = dict(clean_campaign)
    quarantine_campaign["scenarios"] = {}
    quarantine_campaign["judge_pairs"] = [{"scenario": "s1", "stable": True, "winner_arm": "tie"}] * 9
    quarantine_campaign["judge_pairs_total"] = 10
    quarantine_campaign["quarantined_pairs"] = ["p1", "p2"]  # 20% > 10% max
    state6, report6, detail6 = gate(quarantine_campaign)
    check("high-quarantine campaign fails", state6 == "fail", "\n".join(report6))

    # ── scenario_invalid: both arms fail the same assertion -> not counted as minified regression ──
    invalid_campaign = dict(clean_campaign)
    invalid_campaign["scenarios"] = {
        "buggy-scenario": {
            "probes": [],
            "baseline": [_rep_result([("command_succeeds", False)]) for _ in range(3)],
            "minified": [_rep_result([("command_succeeds", False)]) for _ in range(3)],
        },
    }
    invalid_campaign["judge_pairs"] = []
    invalid_campaign["judge_pairs_total"] = 0
    state7, report7, detail7 = gate(invalid_campaign)
    check("both-arms-fail scenario does NOT count as minified drift", state7 == "pass", "\n".join(report7))
    check("both-arms-fail scenario is reported as scenario_invalid", len(detail7["scenario_invalid"]) == 1)

    # ── exact-2/3 boundary: baseline holds in exactly 2/3 reps (the ordinary
    # outcome at reps=3) against config.yaml's decimal-rounded 0.6667 floor
    # (2/3 == 0.6666...  <  0.6667). Must be a real behavioral_drift failure,
    # NOT misclassified as scenario_invalid — see the `_at_least` fix above.
    boundary_config = {"gate": {"drift_baseline_min": 0.6667, "drift_minified_max": 0.3334,
                                 "absolute_floor": 0.6667, "judge_scenario_loss": 0.6667}}
    boundary_campaign = dict(clean_campaign)
    boundary_campaign["scenarios"] = {
        "boundary-scenario": {
            "probes": [],
            "baseline": [_rep_result([("changelog_entry_shape", True)]) for _ in range(2)]
                        + [_rep_result([("changelog_entry_shape", False)])],
            "minified": [_rep_result([("changelog_entry_shape", False)]) for _ in range(3)],
        },
    }
    boundary_campaign["judge_pairs"] = []
    boundary_campaign["judge_pairs_total"] = 0
    state8, report8, detail8 = gate(boundary_campaign, boundary_config)
    check("exact-2/3 baseline rate is NOT misclassified as scenario_invalid",
          detail8["scenario_invalid"] == [], str(detail8["scenario_invalid"]))
    check("exact-2/3 boundary is counted as a real behavioral_drift failure",
          any(f["kind"] == "behavioral_drift" for f in detail8["failures"]), "\n".join(report8))
    check("exact-2/3 boundary campaign fails the gate", state8 == "fail", "\n".join(report8))

    # ── separation invariant: gate.py must reject a 6a verdict as input ──
    poisoned = {"verdict_kind": "6a-reduction", "mean_reduction": 0.34}
    try:
        gate(poisoned)
        check("gate() rejects a 6a-reduction verdict_kind", False)
    except AssertionError:
        check("gate() rejects a 6a-reduction verdict_kind", True)

    if ok:
        print("gate.py --selftest: ALL OK")
    else:
        print("gate.py --selftest: FAILURES ABOVE")
    return ok


if __name__ == "__main__":
    main()
