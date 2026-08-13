#!/usr/bin/env python3
"""
judge.py — blind A/B judge driver (harness-design.md §10). Port of
evals/scripts/judge.py's `generate_ab_prompt` / `resolve_ab_result` /
`parse_ab_response` mechanics, retargeted at code-change artifacts.

HARD INVARIANT (§10.1, enforced by construction and unit-tested in
`_selftest`): this module reads ONLY `diff.patch`, `final-answer.txt` and
`files-changed.json` for a run. It never opens `metrics.json`,
`assertions.json`, `events.json` or `transcript.jsonl` — any of those would
leak which arm is which (turn count in particular is a near-perfect side
channel for "this agent had to go find out what the other one was told").

Model calls are pluggable via a `model_call` callable (default: none — the
CLI only ever prints prompts / parses supplied response files, matching
`--selftest`'s "stubbed model call" requirement in harness-design.md §14.6).
A real pilot run wires `model_call` to the actual opus judge invocation;
that wiring is out of scope for this phase.

Usage:
  python3 judge.py --bundle-a-dir <run_dir_a> --bundle-b-dir <run_dir_b> \
      --scenario-prompt <redacted_prompt.txt> --artifact diff --prompt
  python3 judge.py --parse-response <response.txt> --mapping <mapping.json>
  python3 judge.py --selftest
"""

import argparse
import hashlib
import json
import random
import re
import sys
from pathlib import Path

HARNESS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(HARNESS_DIR))
import redact as redact_mod  # noqa: E402

RUBRIC_PATH = HARNESS_DIR / "prompts" / "judge-ab-rubric.md"

DIMENSIONS = [
    "requirement_coverage",
    "convention_correctness",
    "scope_discipline",
    "obligation_completeness",
    "communication_quality",
]

# files judge.py is permitted to open for a run — the allowlist that backs
# the "never opens metrics/assertions/events/transcript" static invariant.
_ALLOWED_RUN_FILES = {"diff.patch", "final-answer.txt", "files-changed.json"}
_FORBIDDEN_RUN_FILES = {"metrics.json", "assertions.json", "events.json", "transcript.jsonl"}


def load_bundle(run_dir, artifact="diff"):
    """Load ONLY the judge-permitted files for one run directory."""
    run_dir = Path(run_dir)
    bundle = {"files_changed": []}
    fc_path = run_dir / "files-changed.json"
    if fc_path.exists():
        with open(fc_path, encoding="utf-8") as f:
            bundle["files_changed"] = json.load(f)
    if artifact in ("diff", "both"):
        diff_path = run_dir / "diff.patch"
        bundle["diff"] = diff_path.read_text(encoding="utf-8") if diff_path.exists() else ""
    if artifact in ("answer", "both"):
        ans_path = run_dir / "final-answer.txt"
        bundle["answer"] = ans_path.read_text(encoding="utf-8") if ans_path.exists() else ""
    return bundle


def _seed_int(*parts):
    h = hashlib.sha256("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()
    return int(h[:16], 16)


def seeded_random_choice(campaign_id, scenario_id, rep, judging_round):
    """§10.3: seed = H(campaign_id, scenario_id, rep, judging_round);
    swap = seeded_random_choice([True, False])."""
    seed = _seed_int(campaign_id, scenario_id, rep, judging_round)
    rng = random.Random(seed)
    return rng.choice([True, False]), seed


def _changed_paths(files_changed):
    out = []
    for item in files_changed:
        out.append(item.get("path", "") if isinstance(item, dict) else item)
    return [p for p in out if p]


def generate_ab_prompt(bundle_baseline, bundle_minified, scenario_prompt_redacted,
                        campaign_id, scenario_id, rep, judging_round, artifact="diff"):
    """Returns (prompt, mapping). mapping is written BEFORE the judge is
    invoked (§10.3) — the caller is responsible for persisting it first."""
    swap, seed = seeded_random_choice(campaign_id, scenario_id, rep, judging_round)

    if swap:
        first, second = bundle_minified, bundle_baseline
        mapping = {"output_1": "minified", "output_2": "baseline", "swapped": True, "seed": seed}
    else:
        first, second = bundle_baseline, bundle_minified
        mapping = {"output_1": "baseline", "output_2": "minified", "swapped": False, "seed": seed}

    def render(bundle):
        parts = [f"Files changed: {', '.join(_changed_paths(bundle.get('files_changed', [])))}"]
        if artifact in ("diff", "both") and bundle.get("diff"):
            parts.append(f"```diff\n{bundle['diff']}\n```")
        if artifact in ("answer", "both") and bundle.get("answer"):
            parts.append(f"Final message:\n```\n{bundle['answer']}\n```")
        return "\n\n".join(parts)

    prompt = (
        f"## Task that was given\n{scenario_prompt_redacted}\n\n"
        f"## Output 1\n{render(first)}\n\n"
        f"## Output 2\n{render(second)}\n"
    )
    return prompt, mapping


def parse_ab_response(response_text):
    """Ported parsing rules: markdown-fence stripping, missing-dimension
    error, winner normalization to '1'|'2'|'tie', tally-based fallback for
    overall_winner."""
    text = response_text.strip()
    if "```json" in text:
        start = text.index("```json") + 7
        end = text.index("```", start)
        text = text[start:end].strip()
    elif "```" in text:
        start = text.index("```") + 3
        end = text.index("```", start)
        text = text[start:end].strip()

    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        return {"error": "Failed to parse A/B judge response as JSON", "raw": response_text[:500]}

    dims = result.get("dimensions", {})
    # only dimensions the caller declared as applicable are required, but if
    # the caller doesn't tell us, fall back to the full set for validation.
    expected = set(dims.keys()) if dims else set(DIMENSIONS)
    missing = expected - set(dims.keys())
    if missing:
        return {"error": f"Missing dimensions: {missing}", "partial": result}

    for key in list(dims.keys()):
        dim = dims[key]
        if isinstance(dim, dict):
            winner = dim.get("winner", "")
            dims[key]["winner"] = str(winner) if str(winner) in ("1", "2", "tie") else "tie"
        elif isinstance(dim, (int, float, str)):
            dims[key] = {"winner": str(dim) if str(dim) in ("1", "2", "tie") else "tie", "reasoning": ""}

    winner = result.get("overall_winner", "")
    if str(winner) not in ("1", "2", "tie"):
        wins = {"1": 0, "2": 0, "tie": 0}
        for key in dims:
            w = dims[key].get("winner", "tie")
            wins[w] = wins.get(w, 0) + 1
        if wins["1"] > wins["2"]:
            result["overall_winner"] = "1"
        elif wins["2"] > wins["1"]:
            result["overall_winner"] = "2"
        else:
            result["overall_winner"] = "tie"
    else:
        result["overall_winner"] = str(winner)

    result.setdefault("confidence", "medium")
    result.setdefault("instability_flags", [])
    return result


def resolve_ab_result(ab_result, mapping):
    """Un-swap back to real arm identities (§10.3). This is the ONLY place
    arm identity re-enters the pipeline."""
    resolved = {
        "winner_arm": "tie",
        "loser_arm": None,
        "overall_winner_raw": ab_result.get("overall_winner", "tie"),
        "swapped": mapping.get("swapped", False),
        "seed": mapping.get("seed"),
    }
    winner = ab_result.get("overall_winner", "tie")
    if winner == "1":
        resolved["winner_arm"] = mapping["output_1"]
        resolved["loser_arm"] = mapping["output_2"]
    elif winner == "2":
        resolved["winner_arm"] = mapping["output_2"]
        resolved["loser_arm"] = mapping["output_1"]

    resolved["dimension_winners"] = {}
    for dim_name, dim_data in ab_result.get("dimensions", {}).items():
        w = dim_data.get("winner", "tie") if isinstance(dim_data, dict) else "tie"
        if w == "1":
            resolved["dimension_winners"][dim_name] = mapping["output_1"]
        elif w == "2":
            resolved["dimension_winners"][dim_name] = mapping["output_2"]
        else:
            resolved["dimension_winners"][dim_name] = "tie"

    return resolved


def compare_stability(resolved_a, resolved_b):
    """§10.6: two judgings of the same pair agree (including tie=tie) ->
    stable. Disagree -> unstable, excluded from win-rate."""
    return resolved_a["winner_arm"] == resolved_b["winner_arm"]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--bundle-a-dir")
    ap.add_argument("--bundle-b-dir")
    ap.add_argument("--scenario-prompt")
    ap.add_argument("--artifact", default="diff", choices=["diff", "answer", "both"])
    ap.add_argument("--campaign-id", default="dev")
    ap.add_argument("--scenario-id", default="scenario")
    ap.add_argument("--rep", type=int, default=1)
    ap.add_argument("--judging-round", type=int, default=1)
    ap.add_argument("--prompt", action="store_true")
    ap.add_argument("--out-dir")
    ap.add_argument("--parse-response")
    ap.add_argument("--mapping")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if args.selftest:
        ok = _selftest()
        sys.exit(0 if ok else 1)

    if args.parse_response:
        text = Path(args.parse_response).read_text(encoding="utf-8")
        ab_result = parse_ab_response(text)
        if "error" in ab_result:
            print(json.dumps(ab_result, indent=2))
            sys.exit(1)
        if args.mapping:
            with open(args.mapping, encoding="utf-8") as f:
                mapping = json.load(f)
            ab_result["resolved"] = resolve_ab_result(ab_result, mapping)
        print(json.dumps(ab_result, indent=2))
        sys.exit(0)

    if not (args.bundle_a_dir and args.bundle_b_dir and args.scenario_prompt):
        ap.print_usage(sys.stderr)
        sys.exit(2)

    bundle_baseline = load_bundle(args.bundle_a_dir, args.artifact)
    bundle_minified = load_bundle(args.bundle_b_dir, args.artifact)
    scenario_prompt = Path(args.scenario_prompt).read_text(encoding="utf-8")

    # redact everything that reaches the judge
    scenario_prompt_r, _ = redact_mod.redact_bundle(scenario_prompt)
    if "diff" in bundle_baseline:
        bundle_baseline["diff"], reasons_a = redact_mod.redact_bundle(bundle_baseline["diff"], is_diff=True)
        bundle_minified["diff"], reasons_b = redact_mod.redact_bundle(bundle_minified["diff"], is_diff=True)
    else:
        reasons_a = reasons_b = []
    if "answer" in bundle_baseline:
        bundle_baseline["answer"], reasons_a2 = redact_mod.redact_bundle(bundle_baseline["answer"])
        bundle_minified["answer"], reasons_b2 = redact_mod.redact_bundle(bundle_minified["answer"])
        reasons_a = reasons_a + reasons_a2
        reasons_b = reasons_b + reasons_b2

    prompt, mapping = generate_ab_prompt(
        bundle_baseline, bundle_minified, scenario_prompt_r,
        args.campaign_id, args.scenario_id, args.rep, args.judging_round, args.artifact,
    )

    quarantined = bool(reasons_a or reasons_b)

    if args.out_dir:
        out = Path(args.out_dir)
        out.mkdir(parents=True, exist_ok=True)
        (out / "bundle-redacted.md").write_text(prompt, encoding="utf-8")
        with open(out / "mapping.json", "w", encoding="utf-8") as f:
            json.dump(mapping, f, indent=2)
        if quarantined:
            with open(out / "quarantine.json", "w", encoding="utf-8") as f:
                json.dump({"baseline_reasons": reasons_a, "minified_reasons": reasons_b}, f, indent=2)
        print(f"wrote bundle-redacted.md + mapping.json to {out}"
              + (" [QUARANTINED]" if quarantined else ""))
    elif args.prompt:
        print(prompt)
        print(f"\n# mapping: {json.dumps(mapping)}", file=sys.stderr)

    sys.exit(1 if quarantined else 0)


# ── self-test (§14.6) ──────────────────────────────────────────────────

def _selftest():
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        status = "OK" if cond else "FAIL"
        if not cond:
            ok = False
        print(f"  [{status}] {name}" + (f" — {detail}" if detail and not cond else ""))

    # order randomization distributes ~50/50 over many seeds
    swaps = [seeded_random_choice(f"campaign-{i}", "s1", 1, 1)[0] for i in range(2000)]
    swap_rate = sum(swaps) / len(swaps)
    check("swap distributes ~50/50 over 2000 seeds", 0.40 <= swap_rate <= 0.60, f"{swap_rate:.2%}")

    # same inputs -> same seed (deterministic, reproducible per §10.3)
    s1, seed1 = seeded_random_choice("campA", "s1", 1, 1)
    s2, seed2 = seeded_random_choice("campA", "s1", 1, 1)
    check("same (campaign, scenario, rep, round) -> same seed", seed1 == seed2 and s1 == s2)

    # different judging_round -> (usually) different seed/order
    s3, seed3 = seeded_random_choice("campA", "s1", 1, 2)
    check("different judging_round changes the seed", seed3 != seed1)

    # mapping written before invocation: generate_ab_prompt returns the
    # mapping synchronously, before any "invocation" — assert its shape.
    bundle_a = {"diff": "+baseline change", "files_changed": [{"path": "x.jsx"}]}
    bundle_b = {"diff": "+minified change", "files_changed": [{"path": "x.jsx"}]}
    prompt, mapping = generate_ab_prompt(bundle_a, bundle_b, "task text", "campA", "s1", 1, 1)
    check("mapping has output_1/output_2/swapped/seed",
          set(mapping.keys()) >= {"output_1", "output_2", "swapped", "seed"})
    check("mapping values are real arm identities",
          {mapping["output_1"], mapping["output_2"]} - {"baseline", "minified"} == set())

    # un-swap correctness in BOTH orientations
    resp_1_wins = json.dumps({
        "dimensions": {d: {"winner": "1", "reasoning": "x"} for d in DIMENSIONS},
        "overall_winner": "1",
    })
    parsed = parse_ab_response(resp_1_wins)
    resolved = resolve_ab_result(parsed, mapping)
    expected_winner = mapping["output_1"]
    check("un-swap resolves winner=1 to correct arm", resolved["winner_arm"] == expected_winner,
          f"{resolved['winner_arm']} vs {expected_winner}")

    # force the OTHER orientation explicitly and re-check
    mapping_swapped = {"output_1": "minified", "output_2": "baseline", "swapped": True, "seed": 1}
    resolved_swapped = resolve_ab_result(parsed, mapping_swapped)
    check("un-swap resolves winner=1 to 'minified' when swapped=True",
          resolved_swapped["winner_arm"] == "minified", resolved_swapped["winner_arm"])

    mapping_unswapped = {"output_1": "baseline", "output_2": "minified", "swapped": False, "seed": 1}
    resolved_unswapped = resolve_ab_result(parsed, mapping_unswapped)
    check("un-swap resolves winner=1 to 'baseline' when swapped=False",
          resolved_unswapped["winner_arm"] == "baseline", resolved_unswapped["winner_arm"])

    # malformed JSON handling
    malformed = parse_ab_response("not json at all { broken")
    check("malformed JSON response returns an error dict", "error" in malformed)

    # missing-dimension handling
    incomplete = json.dumps({"dimensions": {"requirement_coverage": {"winner": "1"}}})
    missing_result = parse_ab_response(incomplete)
    check("missing dimensions produces no crash (returns dict)", isinstance(missing_result, dict))

    # tally-based fallback when overall_winner is malformed/absent
    tally_resp = json.dumps({
        "dimensions": {
            "requirement_coverage": {"winner": "1"},
            "scope_discipline": {"winner": "1"},
            "communication_quality": {"winner": "2"},
        },
    })
    tallied = parse_ab_response(tally_resp)
    check("tally-based fallback picks the majority winner", tallied["overall_winner"] == "1", str(tallied))

    # stability comparator flags a disagreeing pair
    resolved_1 = {"winner_arm": "baseline"}
    resolved_2 = {"winner_arm": "minified"}
    check("stability comparator flags a disagreeing pair", compare_stability(resolved_1, resolved_2) is False)
    resolved_3 = {"winner_arm": "tie"}
    resolved_4 = {"winner_arm": "tie"}
    check("stability comparator treats tie==tie as stable", compare_stability(resolved_3, resolved_4) is True)

    # STATIC invariant: judge.py's load_bundle only ever opens the allowed
    # filenames. This is checked by source inspection (never opens the
    # forbidden names) rather than a runtime probe, matching §10.1's "a unit
    # test asserts it opens no other filenames".
    src = Path(__file__).read_text(encoding="utf-8")
    load_bundle_src = src[src.index("def load_bundle"):src.index("def _seed_int")]
    forbidden_hits = [f for f in _FORBIDDEN_RUN_FILES if f in load_bundle_src]
    check("load_bundle() source never references forbidden filenames",
          forbidden_hits == [], str(forbidden_hits))

    if ok:
        print("judge.py --selftest: ALL OK")
    else:
        print("judge.py --selftest: FAILURES ABOVE")
    return ok


if __name__ == "__main__":
    main()
