#!/usr/bin/env python3
"""
campaign.py — Phase 6 pilot driver (harness-design.md §8-11).

Orchestrates a full VERDICT 6B campaign for one or more scenarios:

  1. For each scenario x arm(baseline, minified) x rep(0..reps-1):
     `runner.run_one(...)` — worktree, agent-under-test call, transcript,
     diff, assertions (harness-design.md §8.1).
  2. Per scenario x rep, a redacted blind A/B judge pair, judged
     `judge_rounds` times for stability (§10): `redact.redact_bundle` on the
     scenario prompt and both arms' bundles, `judge.generate_ab_prompt`, a
     real (or stubbed) judge model call, `judge.parse_ab_response` +
     `judge.resolve_ab_result`, `judge.compare_stability` across rounds.
  3. A one-time `prepare.parity_check` per scenario (the two arms' prepared
     trees must differ in exactly `CLAUDE.md`) and campaign-wide metrics
     aggregation (mean turns / input_tokens / error_count per arm).
  4. Assembles the `campaign.json` contract `gate.gate()` and
     `report.two_panel_report()` consume, and (optionally) the 6a
     size/structure panel via `reduction.run_approach()`.

Both the agent-under-test call and the judge call are pluggable (`invoke` /
`judge_invoke`), mirroring runner.py's own stub pattern, so `--selftest`
exercises the full wiring — including gate.py and report.py — at zero model
spend.

Usage:
  python3 campaign.py --campaign-id <id> --scenario <id> [--scenario <id> ...]
      [--approach telegraphic] [--reps N] [--judge-rounds N]
      [--runs-root <dir>] [--out campaign.json] [--report report.md]
      [--skip-reduction] [--keep-worktree] [--json]
  python3 campaign.py --selftest
"""

import argparse
import json
import re
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

HARNESS_DIR = Path(__file__).resolve().parent
REPO_ROOT = HARNESS_DIR.parent.parent.parent  # .claude/minify-lab/harness -> repo root

sys.path.insert(0, str(HARNESS_DIR))
import runner as runner_mod  # noqa: E402
import judge as judge_mod  # noqa: E402
import redact as redact_mod  # noqa: E402
import gate as gate_mod  # noqa: E402
import report as report_mod  # noqa: E402
import reduction as reduction_mod  # noqa: E402
import transcript as transcript_mod  # noqa: E402
import prepare as prepare_mod  # noqa: E402


def mean(values):
    return sum(values) / len(values) if values else 0.0


# ── judge model invocation (pluggable, mirrors runner.py's `invoke`) ───────

def default_judge_invoke(prompt, model, timeout_s=300):
    """Real blind-judge call: a fresh, tool-less session that sees ONLY the
    prompt text (harness-design.md §10.1 — "no tools, no repository access").
    `--max-turns 1` bounds it to a single reply; cwd is an empty temp dir
    (not REPO_ROOT) so even an unexpected default tool grant finds nothing to
    explore. Isolated exactly like the agent-under-test call
    (runner.isolated_agent_env / a fresh --session-id) so it can never attach
    to this orchestrator's own session.

    `acceptEdits`, not `bypassPermissions`: the CLI refuses
    --dangerously-skip-permissions outright when running as root/sudo (this
    harness's own containers do), which silently zeroed every judge call —
    an immediate nonzero exit, empty transcript, empty response. `acceptEdits`
    is accepted under root and is behaviorally identical here since the judge
    has no `--allowedTools` and proposes no edits; it matches config.yaml's
    `run.permission_mode` used for the agent-under-test call."""
    session_id = str(uuid.uuid4())
    cmd = [
        "timeout", f"{timeout_s}s",
        "claude", "-p", prompt,
        "--session-id", session_id,
        "--no-session-persistence",
        "--output-format", "stream-json",
        "--verbose",
        "--model", model,
        "--max-turns", "1",
        "--permission-mode", "acceptEdits",
    ]
    with tempfile.TemporaryDirectory(prefix="minify-lab-judge-") as tmp:
        transcript_path = Path(tmp) / "transcript.jsonl"
        err_path = Path(tmp) / "runner.err"
        with open(transcript_path, "w", encoding="utf-8") as out_f, \
             open(err_path, "w", encoding="utf-8") as err_f:
            subprocess.run(cmd, cwd=tmp, stdout=out_f, stderr=err_f,
                            env=runner_mod.isolated_agent_env())
        _events, _metrics, final_answer = transcript_mod.parse_jsonl(
            str(transcript_path), pricing={}, hooks_mode="parity",
        )
    return final_answer


def _judge_prompt(scenario, bundle_baseline, bundle_minified, scenario_prompt_r,
                   campaign_id, rep, judging_round):
    artifact = scenario.get("judge_artifact", "diff")
    ab_prompt, mapping = judge_mod.generate_ab_prompt(
        bundle_baseline, bundle_minified, scenario_prompt_r,
        campaign_id, scenario["id"], rep, judging_round, artifact,
    )
    rubric = judge_mod.RUBRIC_PATH.read_text(encoding="utf-8")
    dims = scenario.get("judge_dimensions") or judge_mod.DIMENSIONS
    dims_line = "## Dimensions to score for this task\n" + ", ".join(dims) + "\n\n"
    return rubric + "\n\n" + dims_line + ab_prompt, mapping


# ── one scenario's redacted judge pairs, `judge_rounds` each ───────────────

def _judge_pairs_for_rep(scenario, campaign_id, rep, base_dir, min_dir, judge_rounds, judge_invoke, judge_model):
    artifact = scenario.get("judge_artifact", "diff")
    bundle_baseline = judge_mod.load_bundle(base_dir, artifact)
    bundle_minified = judge_mod.load_bundle(min_dir, artifact)

    # scenario-specific bait/canary tokens (e.g. a fixture's fake CVE id) are
    # pre-existing in BOTH arms' source and would otherwise reach the judge
    # bundle unredacted, since they're not on redact.py's generic stoplist —
    # see claude-md.yaml's security-changelog-discipline note_for_implementer.
    extra_terms = [re.escape(t) for t in (scenario.get("leak_tokens") or [])]

    scenario_prompt_r, _ = redact_mod.redact_bundle(scenario.get("prompt", ""), extra_terms=extra_terms)
    reasons_a, reasons_b = [], []
    if artifact in ("diff", "both"):
        bundle_baseline["diff"], ra = redact_mod.redact_bundle(bundle_baseline.get("diff", ""), extra_terms=extra_terms, is_diff=True)
        bundle_minified["diff"], rb = redact_mod.redact_bundle(bundle_minified.get("diff", ""), extra_terms=extra_terms, is_diff=True)
        reasons_a += ra
        reasons_b += rb
    if artifact in ("answer", "both"):
        bundle_baseline["answer"], ra2 = redact_mod.redact_bundle(bundle_baseline.get("answer", ""), extra_terms=extra_terms)
        bundle_minified["answer"], rb2 = redact_mod.redact_bundle(bundle_minified.get("answer", ""), extra_terms=extra_terms)
        reasons_a += ra2
        reasons_b += rb2

    if reasons_a or reasons_b:
        return None, {"scenario": scenario["id"], "rep": rep,
                       "baseline_reasons": reasons_a, "minified_reasons": reasons_b}

    # dims used both to build the judge prompt (mirrored inside
    # `_judge_prompt`) and to validate the response actually covers what
    # this scenario requires — must be the SAME set both places.
    dims = scenario.get("judge_dimensions") or judge_mod.DIMENSIONS

    resolved_rounds = []
    # diagnostic fields (additive only — do not change `stable`/`winner_arm`
    # meaning below): per-round presentation-order swap, per-round raw
    # resolved winner before stability collapses them to one boolean, and
    # whether any round's judge response failed to parse.
    swap_per_round = []
    raw_winner_per_round = []
    parse_failure = False
    for jround in range(1, judge_rounds + 1):
        prompt, mapping = _judge_prompt(scenario, bundle_baseline, bundle_minified,
                                         scenario_prompt_r, campaign_id, rep, jround)
        swap_per_round.append(mapping.get("swapped"))
        response_text = judge_invoke(prompt, judge_model)
        ab_result = judge_mod.parse_ab_response(response_text, expected_dims=dims)
        if "error" in ab_result:
            parse_failure = True
            raw_winner_per_round.append(None)
            continue
        resolved = judge_mod.resolve_ab_result(ab_result, mapping)
        resolved_rounds.append(resolved)
        raw_winner_per_round.append(resolved["winner_arm"])

    if len(resolved_rounds) >= 2:
        stable = judge_mod.compare_stability(resolved_rounds[0], resolved_rounds[1])
    else:
        stable = False  # can't establish agreement from <2 usable roundings — excluded from win-rate
    winner_arm = resolved_rounds[0]["winner_arm"] if resolved_rounds else "tie"

    pair = {
        "scenario": scenario["id"], "rep": rep, "stable": stable, "winner_arm": winner_arm,
        "swap_per_round": swap_per_round,
        "raw_winner_per_round": raw_winner_per_round,
        "parse_failure": parse_failure,
    }
    return pair, None


# ── full campaign ────────────────────────────────────────────────────────

def run_campaign(scenario_ids, campaign_id, config=None, approach="telegraphic",
                  reps=None, judge_rounds=None, runs_root=None, scenarios_file=None,
                  scenarios_override=None, base_ref=None, hooks_mode=None,
                  invoke=None, judge_invoke=None, keep_worktree=False, repo_root=REPO_ROOT):
    config = config or runner_mod._load_config()
    reps = reps if reps is not None else config.get("reps", 3)
    judge_rounds = judge_rounds if judge_rounds is not None else config.get("judge_rounds", 2)
    judge_model = config.get("judge_model", "opus")
    runs_root = Path(runs_root) if runs_root else runner_mod.DEFAULT_RUNS_ROOT
    invoke = invoke or runner_mod.default_invoke
    judge_invoke = judge_invoke or default_judge_invoke

    all_scenarios = scenarios_override if scenarios_override is not None else runner_mod._load_scenarios(scenarios_file)
    chosen = [s for s in all_scenarios if s["id"] in scenario_ids]
    missing = set(scenario_ids) - {s["id"] for s in chosen}
    if missing:
        raise ValueError(f"scenario(s) not found: {sorted(missing)}")

    campaign = {
        "verdict_kind": "6b-quality",
        "campaign_id": campaign_id,
        "approach": approach,
        "agent_model": config.get("agent_model", "sonnet"),
        "judge_model": judge_model,
        "reps": reps,
        "scenarios": {},
        "judge_pairs": [],
        "judge_pairs_total": 0,
        "quarantined_pairs": [],
        "metrics": {"baseline": {}, "minified": {}},
    }

    per_arm_metrics = {"baseline": [], "minified": []}
    prepare_errors = []

    for scenario in chosen:
        sid = scenario["id"]
        sdata = {"probes": scenario.get("probes", []), "baseline": [], "minified": []}
        prepared_sha = {"baseline": None, "minified": None}

        for arm in ("baseline", "minified"):
            for rep in range(reps):
                run_dir = runs_root / campaign_id / sid / arm / f"rep{rep}"
                try:
                    # Scope to `chosen`, not the full scenarios file: variant_leak_check
                    # scans a variant against every scenario's leak_tokens in whatever list
                    # is passed, and several frozen scenarios have pre-existing token
                    # collisions with CLAUDE.md's own routing table (see prepare.py's
                    # module docstring "KNOWN FINDING"). Passing the full file would make
                    # unrelated scenarios spuriously block a campaign that never runs them.
                    outcome = runner_mod.run_one(
                        scenario, arm, rep, run_dir, config=config,
                        approach=approach if arm != "baseline" else None,
                        base_ref=base_ref, hooks_mode=hooks_mode, repo_root=repo_root,
                        scenarios_for_leak_check=chosen, invoke=invoke,
                        keep_worktree=keep_worktree,
                    )
                except prepare_mod.PrepareError as e:
                    msg = str(e)
                    if "leak" in msg.lower():
                        campaign["leak_check_failed"] = True
                    prepare_errors.append({"scenario": sid, "arm": arm, "rep": rep, "error": msg})
                    continue
                sdata[arm].append(outcome["assertions"])
                per_arm_metrics[arm].append(outcome["metrics"])
                if rep == 0:
                    prepared_sha[arm] = outcome["prepared_base_sha"]

        campaign["scenarios"][sid] = sdata

        if prepared_sha["baseline"] and prepared_sha["minified"]:
            try:
                prepare_mod.parity_check(prepared_sha["baseline"], prepared_sha["minified"], repo_for_diff=repo_root)
            except prepare_mod.PrepareError as e:
                campaign["parity_check_failed"] = True
                prepare_errors.append({"scenario": sid, "arm": "parity", "rep": None, "error": str(e)})

        for rep in range(reps):
            base_dir = runs_root / campaign_id / sid / "baseline" / f"rep{rep}"
            min_dir = runs_root / campaign_id / sid / "minified" / f"rep{rep}"
            if not (base_dir / "diff.patch").exists() and not (base_dir / "final-answer.txt").exists():
                continue  # this rep's prepare/run failed — already recorded above
            if not (min_dir / "diff.patch").exists() and not (min_dir / "final-answer.txt").exists():
                continue
            campaign["judge_pairs_total"] += 1
            pair, quarantined = _judge_pairs_for_rep(
                scenario, campaign_id, rep, base_dir, min_dir, judge_rounds, judge_invoke, judge_model,
            )
            if quarantined:
                campaign["quarantined_pairs"].append(quarantined)
            else:
                campaign["judge_pairs"].append(pair)

    for arm in ("baseline", "minified"):
        recs = per_arm_metrics[arm]
        campaign["metrics"][arm] = {
            "error_count": mean([r.get("error_count", 0) for r in recs]),
            "turns": mean([r.get("turns", 0) for r in recs]),
            "input_tokens": mean([r.get("input_tokens", 0) for r in recs]),
        }

    if prepare_errors:
        campaign["prepare_errors"] = prepare_errors

    return campaign


# ── CLI ─────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--campaign-id")
    ap.add_argument("--scenario", action="append", dest="scenarios", help="scenario id; repeatable")
    ap.add_argument("--scenarios-file", default=str(HARNESS_DIR / "scenarios" / "claude-md.yaml"))
    ap.add_argument("--approach", default="telegraphic")
    ap.add_argument("--reps", type=int, default=None)
    ap.add_argument("--judge-rounds", type=int, default=None)
    ap.add_argument("--runs-root", default=str(runner_mod.DEFAULT_RUNS_ROOT))
    ap.add_argument("--out", default=None, help="write the assembled campaign.json here")
    ap.add_argument("--report", default=None, help="write the two-panel markdown report here")
    ap.add_argument("--base-ref", default=None)
    ap.add_argument("--hooks-mode", choices=["parity", "neutralized"], default=None)
    ap.add_argument("--skip-reduction", action="store_true", help="omit the 6a size/structure panel")
    ap.add_argument("--keep-worktree", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if args.selftest:
        ok = _selftest()
        sys.exit(0 if ok else 1)

    if not args.campaign_id or not args.scenarios:
        ap.print_usage(sys.stderr)
        sys.exit(2)

    config = runner_mod._load_config()

    reduction_result = None
    if not args.skip_reduction:
        try:
            size_v, structure_v = reduction_mod.run_approach(args.approach, config=config)
            reduction_result = {"size": size_v, "structure": structure_v}
        except reduction_mod.IntegrityError as e:
            print(f"WARNING: 6a reduction verdict unavailable: {e}", file=sys.stderr)

    campaign = run_campaign(
        args.scenarios, args.campaign_id, config=config, approach=args.approach,
        reps=args.reps, judge_rounds=args.judge_rounds, runs_root=args.runs_root,
        scenarios_file=args.scenarios_file, base_ref=args.base_ref, hooks_mode=args.hooks_mode,
        keep_worktree=args.keep_worktree,
    )

    if args.out:
        Path(args.out).write_text(json.dumps(campaign, indent=2), encoding="utf-8")

    console_text, markdown_text, detail = report_mod.two_panel_report(reduction_result, campaign, config)
    print(console_text)
    if args.report:
        report_mod.write_report(args.report, markdown_text)
    if args.json:
        print(json.dumps(detail, indent=2))

    exit_map = {"pass": 0, "fail": 1, "inconclusive": 5}
    sys.exit(exit_map[detail["verdict_6b"]["state"]])


# ── self-test — zero model spend: stub agent + stub judge ─────────────────

def _selftest():
    import shutil

    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        status = "OK" if cond else "FAIL"
        if not cond:
            ok = False
        print(f"  [{status}] {name}" + (f" — {detail}" if detail and not cond else ""))

    print("campaign.py self-test — zero-cost stub run (agent + judge both stubbed)")

    edit_rel_path = "NOTES-campaign-selftest.txt"
    content_by_arm = {
        "baseline": "campaign selftest scratch file (baseline arm)\n",
        "minified": "campaign selftest scratch file (minified arm), a bit different\n",
    }
    mini_scenario = {
        "id": "campaign-selftest-mini",
        "prompt": "Create a short scratch note file explaining what this change does.\n",
        "leak_tokens": ["ZZZCAMPAIGNSELFTESTTOKEN"],
        "max_turns": 5,
        "timeout_s": 60,
        "judge_artifact": "diff",
        "judge_dimensions": ["requirement_coverage", "communication_quality"],
        "assertions": [
            {"type": "files_changed_include", "critical": True, "paths": [edit_rel_path]},
            {"type": "file_contains", "critical": True, "path": edit_rel_path, "pattern": "scratch file"},
        ],
    }

    def stub_invoke(prompt, wt, run_dir, model, max_turns, timeout_s, allowed_tools, permission_mode):
        arm = Path(run_dir).parent.name  # .../<scenario>/<arm>/rep<N>
        inner = runner_mod._make_stub_invoke(edit_rel_path, content_by_arm[arm])
        return inner(prompt, wt, run_dir, model, max_turns, timeout_s, allowed_tools, permission_mode)

    def stub_judge_invoke(prompt, model, timeout_s=60):
        payload = {
            "dimensions": {d: {"winner": "tie", "reasoning": "stub"} for d in mini_scenario["judge_dimensions"]},
            "overall_winner": "tie", "overall_reasoning": "stub",
            "confidence": "high", "instability_flags": [],
        }
        return json.dumps(payload)

    config = runner_mod._load_config()
    run_root = Path(tempfile.mkdtemp(prefix="minify-lab-campaign-selftest-"))
    try:
        campaign = run_campaign(
            ["campaign-selftest-mini"], "selftest-campaign", config=config, approach="telegraphic",
            reps=2, judge_rounds=2, runs_root=run_root, scenarios_override=[mini_scenario],
            invoke=stub_invoke, judge_invoke=stub_judge_invoke, keep_worktree=False,
        )

        sdata = campaign["scenarios"].get("campaign-selftest-mini", {})
        check("campaign has 2 baseline reps recorded", len(sdata.get("baseline", [])) == 2)
        check("campaign has 2 minified reps recorded", len(sdata.get("minified", [])) == 2)
        check("both stub reps passed their critical assertion",
              all(r["critical_passed"] == r["critical_total"] for r in sdata.get("baseline", []) + sdata.get("minified", [])),
              json.dumps(sdata, indent=2))

        pairs = [p for p in campaign["judge_pairs"] if p["scenario"] == "campaign-selftest-mini"]
        check("campaign recorded a judge pair per rep", len(pairs) == 2, json.dumps(campaign["judge_pairs"]))
        check("stub judge ties are recorded as stable ties",
              all(p["stable"] and p["winner_arm"] == "tie" for p in pairs), json.dumps(pairs))
        check("judge pairs carry the new diagnostic fields, additively",
              all({"scenario", "rep", "stable", "winner_arm", "swap_per_round",
                   "raw_winner_per_round", "parse_failure"} <= set(p.keys()) for p in pairs),
              json.dumps(pairs))
        check("swap_per_round has one entry per judge round (2) and raw_winner_per_round agrees with winner_arm",
              all(len(p["swap_per_round"]) == 2 and len(p["raw_winner_per_round"]) == 2
                  and p["raw_winner_per_round"][0] == p["winner_arm"] for p in pairs),
              json.dumps(pairs))
        check("no parse failures recorded on a clean stub judge run",
              all(p["parse_failure"] is False for p in pairs), json.dumps(pairs))
        check("no pairs quarantined on a clean stub run (no stoplist terms in stub content)",
              campaign["quarantined_pairs"] == [], json.dumps(campaign["quarantined_pairs"]))
        check("no prepare errors recorded on a clean stub run", "prepare_errors" not in campaign,
              json.dumps(campaign.get("prepare_errors")))
        check("no parity-check or leak-check failure flagged",
              not campaign.get("parity_check_failed") and not campaign.get("leak_check_failed"))

        m = campaign["metrics"]
        check("campaign metrics has flat baseline/minified aggregates",
              {"turns", "input_tokens", "error_count"} <= set(m["baseline"].keys())
              and {"turns", "input_tokens", "error_count"} <= set(m["minified"].keys()))

        state, report_lines, detail = gate_mod.gate(campaign, config)
        check("gate() accepts the assembled campaign.json without raising", True)
        check("gate state is a valid tri-state value", state in ("pass", "fail", "inconclusive"), state)

        console_text, markdown_text, report_detail = report_mod.two_panel_report(None, campaign, config)
        check("two_panel_report renders console text", bool(console_text))
        check("two_panel_report renders markdown text", bool(markdown_text))
        check("two_panel_report's detail carries verdict_6b, no verdict_6a (skipped)",
              "verdict_6b" in report_detail and "verdict_6a" not in report_detail)

        # a quarantine round-trips: an agent that (mis)edits CLAUDE.md itself
        # produces a diff hunk touching the instruction file, which
        # redact_bundle's instruction-file-hunk removal must catch and
        # quarantine rather than hand to the judge.
        def leaky_invoke(prompt, wt, run_dir, model, max_turns, timeout_s, allowed_tools, permission_mode):
            inner = runner_mod._make_stub_invoke("CLAUDE.md", "an agent edit that touches CLAUDE.md itself\n")
            return inner(prompt, wt, run_dir, model, max_turns, timeout_s, allowed_tools, permission_mode)

        leaky_scenario = dict(mini_scenario, assertions=[])
        run_root2 = Path(tempfile.mkdtemp(prefix="minify-lab-campaign-selftest-leak-"))
        try:
            campaign2 = run_campaign(
                ["campaign-selftest-mini"], "selftest-campaign-leak", config=config, approach="telegraphic",
                reps=1, judge_rounds=2, runs_root=run_root2, scenarios_override=[leaky_scenario],
                invoke=leaky_invoke, judge_invoke=stub_judge_invoke, keep_worktree=False,
            )
            check("an agent diff touching CLAUDE.md quarantines the pair instead of judging it",
                  len(campaign2["quarantined_pairs"]) == 1 and campaign2["judge_pairs"] == [],
                  json.dumps(campaign2["quarantined_pairs"]))
        finally:
            shutil.rmtree(run_root2, ignore_errors=True)
            subprocess.run(["git", "worktree", "prune"], cwd=str(REPO_ROOT), capture_output=True, text=True)

        # a judge round that fails to parse must surface via `parse_failure`
        # (and leave `stable=False`, unchanged) instead of being silently
        # swallowed — round 1 returns unparseable text, round 2 a real tie.
        def _make_flaky_judge_invoke():
            calls = {"n": 0}

            def invoke(prompt, model, timeout_s=60):
                calls["n"] += 1
                if calls["n"] == 1:
                    return "not json at all { broken"
                return stub_judge_invoke(prompt, model, timeout_s)
            return invoke

        run_root3 = Path(tempfile.mkdtemp(prefix="minify-lab-campaign-selftest-flaky-"))
        try:
            campaign3 = run_campaign(
                ["campaign-selftest-mini"], "selftest-campaign-flaky", config=config, approach="telegraphic",
                reps=1, judge_rounds=2, runs_root=run_root3, scenarios_override=[mini_scenario],
                invoke=stub_invoke, judge_invoke=_make_flaky_judge_invoke(), keep_worktree=False,
            )
            flaky_pairs = [p for p in campaign3["judge_pairs"] if p["scenario"] == "campaign-selftest-mini"]
            check("a judge round that fails to parse is surfaced via parse_failure",
                  len(flaky_pairs) == 1 and flaky_pairs[0]["parse_failure"] is True,
                  json.dumps(flaky_pairs))
            check("raw_winner_per_round records None for the failed round, the real winner for the other",
                  bool(flaky_pairs) and flaky_pairs[0]["raw_winner_per_round"] == [None, "tie"],
                  json.dumps(flaky_pairs))
            check("swap_per_round is still recorded for the failed round (mapping exists before the parse)",
                  bool(flaky_pairs) and len(flaky_pairs[0]["swap_per_round"]) == 2,
                  json.dumps(flaky_pairs))
            check("only 1 of 2 usable roundings still yields stable=False, unchanged from before this fix",
                  bool(flaky_pairs) and flaky_pairs[0]["stable"] is False,
                  json.dumps(flaky_pairs))
        finally:
            shutil.rmtree(run_root3, ignore_errors=True)
            subprocess.run(["git", "worktree", "prune"], cwd=str(REPO_ROOT), capture_output=True, text=True)
    finally:
        shutil.rmtree(run_root, ignore_errors=True)
        subprocess.run(["git", "worktree", "prune"], cwd=str(REPO_ROOT), capture_output=True, text=True)

    print("ALL OK" if ok else "SOME CHECKS FAILED")
    return ok


if __name__ == "__main__":
    main()
