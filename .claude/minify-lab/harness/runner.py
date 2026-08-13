#!/usr/bin/env python3
"""
runner.py — one (scenario, arm, rep) agent run (harness-design.md §8.1).

Orchestrates, for ONE (scenario, arm, rep):

  1. `prepare.prepare_arm(...)`      -> worktree, prepared_base_sha, anchors.json
  2. capture `base_texts` (BEFORE the agent runs) for the assertions that diff
     against the prepared base: version_bumped / changelog_entry_added /
     ci_version_gate
  3. compose the prompt: prompts/harness-preamble.md + scenario `prompt`
  4. invoke the agent-under-test (`claude -p ...`, stream-json) -> transcript.jsonl
  5. `transcript.parse_jsonl(...)`   -> events.json, metrics.json, final-answer.txt
  6. `prepare.post_run_diff(...)`    -> diff.patch, files-changed.json
  7. `assertions.run_assertions(...)` -> assertions.json
  8. `prepare.cleanup(wt)`           -> worktree removed (always, success or failure)

The agent invocation is pluggable via an `invoke` callable (mirrors judge.py's
`model_call` pattern: "pluggable ... default: none for the CLI, a real
callable wires it for a pilot run"). This lets `--selftest` exercise the full
prepare -> run -> transcript -> diff -> assert -> cleanup path with a stub
that writes a canned transcript instead of spawning `claude` — zero model
spend, per harness-design.md §14 item 8.

DEVIATION FROM THE LITERAL §8.1 BASH SNIPPET (documented, not a bug): the
spec's example pipes `> transcript.jsonl 2> runner.err` relative to `cd
"$WT"` (i.e. inside the worktree). §3's authoritative directory tree instead
lists `transcript.jsonl` as a sibling of `diff.patch`/`events.json` under
`<scenario>/<arm>/rep<N>/` — i.e. in `run_dir`, NOT inside `wt`. This module
follows §3: the agent's cwd is still `wt` (so it discovers the repo exactly
as spec'd), but the transcript/stderr files are written to `run_dir`
(`wt`'s parent). Writing them inside `wt` would make `post_run_diff`'s
`git add -A` pick them up as spurious untracked content in the agent's own
diff — the exact bug class already found and fixed for `anchors.json` in
`prepare.py` (see that module's `prepare_arm`).

Usage:
  python3 runner.py --campaign <id> --scenario <id> --arm baseline|minified \
      --rep N [--approach telegraphic] [--base-ref HEAD] \
      [--hooks-mode parity|neutralized] [--runs-root <dir>] [--run-dir <dir>] \
      [--keep-worktree] [--json]
  python3 runner.py --selftest
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

HARNESS_DIR = Path(__file__).resolve().parent
REPO_ROOT = HARNESS_DIR.parent.parent.parent  # .claude/minify-lab/harness -> repo root

sys.path.insert(0, str(HARNESS_DIR))
import prepare as prepare_mod  # noqa: E402
import transcript as transcript_mod  # noqa: E402
import assertions as assertions_mod  # noqa: E402

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None


class RunnerError(RuntimeError):
    """A failure in this module's own orchestration (distinct from
    prepare.PrepareError, which is raised by prepare_arm and simply left to
    propagate — see run_one's try/finally)."""


def _load_config():
    if yaml is None:
        return {}
    cfg_path = HARNESS_DIR / "config.yaml"
    if cfg_path.exists():
        with open(cfg_path, encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    return {}


def _load_scenarios(scenarios_file=None):
    if yaml is None:
        raise RuntimeError("PyYAML required")
    path = Path(scenarios_file) if scenarios_file else HARNESS_DIR / "scenarios" / "claude-md.yaml"
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or []


# ── §8.1 step 2 — prompt composition ───────────────────────────────────────

def compose_prompt(scenario):
    preamble_path = HARNESS_DIR / "prompts" / "harness-preamble.md"
    preamble = preamble_path.read_text(encoding="utf-8") if preamble_path.exists() else ""
    return preamble + scenario.get("prompt", "")


# ── §8.1 step 3 — agent-under-test invocation ──────────────────────────────

def default_invoke(prompt, wt, run_dir, model, max_turns, timeout_s, allowed_tools, permission_mode):
    """Real agent-under-test call. Returns
    (transcript_path, runner_err_path, timed_out, returncode).

    `claude -p --output-format stream-json` flushes JSONL incrementally, so a
    `timeout`-killed process still leaves a usable (truncated) transcript.jsonl
    on disk — transcript.parse_jsonl treats a truncated final line as
    non-fatal (see its JSONDecodeError branch), matching §8.1's "the run
    still produces a diff (whatever the agent had written)"."""
    transcript_path = Path(run_dir) / "transcript.jsonl"
    err_path = Path(run_dir) / "runner.err"
    cmd = [
        "timeout", f"{timeout_s}s",
        "claude", "-p", prompt,
        "--output-format", "stream-json",
        "--verbose",
        "--model", model,
        "--max-turns", str(max_turns),
        "--permission-mode", permission_mode,
        "--allowedTools", *allowed_tools,
    ]
    with open(transcript_path, "w", encoding="utf-8") as out_f, \
         open(err_path, "w", encoding="utf-8") as err_f:
        cp = subprocess.run(cmd, cwd=str(wt), stdout=out_f, stderr=err_f)
    timed_out = cp.returncode == 124  # `timeout`'s own exit code for "killed"
    return str(transcript_path), str(err_path), timed_out, cp.returncode


# ── full pipeline for one (scenario, arm, rep) ─────────────────────────────

def run_one(scenario, arm, rep, run_dir, config=None, approach=None, base_ref=None,
            hooks_mode=None, repo_root=REPO_ROOT, scenarios_for_leak_check=None,
            invoke=None, keep_worktree=False):
    """Runs §8.1 steps 1-8 for ONE (scenario, arm, rep). Writes every artifact
    harness-design.md §3 lists under runs/<campaign>/<scenario>/<arm>/rep<N>/
    EXCEPT judge/* (judge.py's job, run separately once both arms exist).

    `invoke` is the pluggable agent-under-test call:
        invoke(prompt, wt, run_dir, model, max_turns, timeout_s, allowed_tools,
               permission_mode) -> (transcript_path, runner_err_path, timed_out,
                                     returncode)
    Defaults to `default_invoke` (spawns a real `claude -p`). Pass a stub for
    --selftest / dry runs — zero model spend.

    Returns a summary dict: scenario, arm, rep, run_dir, prepared_base_sha,
    timed_out, metrics, assertions, files_changed.

    Cleanup is unconditional (try/finally) and targets the deterministic
    `run_dir/wt` path regardless of how far prepare_arm got — worktree_remove
    is documented best-effort/never-raises, so this is safe even when the
    worktree was never created (e.g. a PrepareError before worktree_add)."""
    config = config or _load_config()
    invoke = invoke or default_invoke
    run_dir = Path(run_dir)
    wt = run_dir / "wt"  # same derivation prepare_arm uses internally

    run_cfg = config.get("run", {})
    model = config.get("agent_model", "sonnet")
    max_turns = scenario.get("max_turns", run_cfg.get("max_turns", 30))
    timeout_s = scenario.get("timeout_s", run_cfg.get("timeout_s", 900))
    allowed_tools = run_cfg.get("allowed_tools", ["Bash", "Read", "Write", "Edit", "MultiEdit", "Glob", "Grep", "Skill"])
    permission_mode = run_cfg.get("permission_mode", "acceptEdits")
    hooks_mode = hooks_mode or scenario.get("hooks_mode") or run_cfg.get("hooks_mode", "parity")

    try:
        prepared = prepare_mod.prepare_arm(
            scenario, arm, run_dir, config=config, approach=approach, base_ref=base_ref,
            hooks_mode=hooks_mode, repo_root=repo_root,
            scenarios_for_leak_check=scenarios_for_leak_check,
        )
        prepared_base_sha = prepared["prepared_base_sha"]

        # Persisted as a FILE (not just the in-memory return value):
        # assertions.py's own CLI (`main()`) reads run_dir/"prepared-base.sha"
        # for a standalone re-run of assertions against an already-run rep.
        (run_dir / "prepared-base.sha").write_text(prepared_base_sha + "\n", encoding="utf-8")

        # base_texts MUST be captured now, before the agent mutates the
        # worktree — version_bumped / changelog_entry_added / ci_version_gate
        # (assertions.py's _BASE_TEXT_DISPATCH) diff the pre-agent text.
        base_texts = {}
        imports_rel = "src/parts/part-imports.jsx"
        imports_path = wt / imports_rel
        if imports_path.exists():
            base_texts[imports_rel] = imports_path.read_text(encoding="utf-8")

        prompt = compose_prompt(scenario)

        transcript_path, _runner_err_path, timed_out, _returncode = invoke(
            prompt, wt, run_dir, model, max_turns, timeout_s, allowed_tools, permission_mode,
        )

        pricing = config.get("pricing", {})
        events, metrics, final_answer = transcript_mod.parse_jsonl(
            transcript_path, pricing=pricing, hooks_mode=hooks_mode,
        )
        if timed_out:
            metrics["timed_out"] = True

        (run_dir / "events.json").write_text(json.dumps(events, indent=2), encoding="utf-8")
        (run_dir / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
        (run_dir / "final-answer.txt").write_text(final_answer, encoding="utf-8")

        # Diff is taken from whatever is on disk in `wt` right now, timeout or
        # not — §8.1: "the run still produces a diff (whatever the agent had
        # written)".
        diff_text, changed = prepare_mod.post_run_diff(wt, prepared_base_sha, run_dir)

        run = assertions_mod.RunData(run_dir, worktree_dir=wt)
        assertion_out = assertions_mod.run_assertions(
            scenario.get("assertions", []), run, config, base_texts,
        )
        (run_dir / "assertions.json").write_text(json.dumps(assertion_out, indent=2), encoding="utf-8")

        return {
            "scenario": scenario["id"], "arm": arm, "rep": rep,
            "run_dir": str(run_dir), "prepared_base_sha": prepared_base_sha,
            "timed_out": timed_out, "metrics": metrics, "assertions": assertion_out,
            "files_changed": changed,
        }
    finally:
        prepare_mod.cleanup(wt, repo_root=repo_root, keep=keep_worktree)


# ── CLI ─────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--campaign")
    ap.add_argument("--scenario")
    ap.add_argument("--scenarios-file", default=str(HARNESS_DIR / "scenarios" / "claude-md.yaml"))
    ap.add_argument("--arm", choices=["baseline", "minified"])
    ap.add_argument("--rep", type=int)
    ap.add_argument("--approach", default="telegraphic")
    ap.add_argument("--runs-root", default=str(HARNESS_DIR / "runs"))
    ap.add_argument("--run-dir", default=None,
                     help="override the derived <runs-root>/<campaign>/<scenario>/<arm>/rep<N> path")
    ap.add_argument("--base-ref", default=None)
    ap.add_argument("--hooks-mode", choices=["parity", "neutralized"], default=None)
    ap.add_argument("--keep-worktree", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if args.selftest:
        ok = _selftest()
        sys.exit(0 if ok else 1)

    if not args.campaign or not args.scenario or not args.arm or args.rep is None:
        ap.print_usage(sys.stderr)
        sys.exit(2)

    config = _load_config()
    scenarios = _load_scenarios(args.scenarios_file)
    scenario = next((s for s in scenarios if s["id"] == args.scenario), None)
    if scenario is None:
        print(f"scenario not found: {args.scenario}", file=sys.stderr)
        sys.exit(3)

    run_dir = Path(args.run_dir) if args.run_dir else (
        Path(args.runs_root) / args.campaign / args.scenario / args.arm / f"rep{args.rep}"
    )

    try:
        outcome = run_one(
            scenario, args.arm, args.rep, run_dir, config=config,
            approach=args.approach if args.arm != "baseline" else None,
            base_ref=args.base_ref, hooks_mode=args.hooks_mode,
            scenarios_for_leak_check=scenarios, keep_worktree=args.keep_worktree,
        )
    except prepare_mod.PrepareError as e:
        print(f"RUN FAILED (prepare): {e}", file=sys.stderr)
        sys.exit(1)

    a = outcome["assertions"]
    if args.json:
        print(json.dumps({
            "scenario": outcome["scenario"], "arm": outcome["arm"], "rep": outcome["rep"],
            "run_dir": outcome["run_dir"], "timed_out": outcome["timed_out"],
            "passed": a["passed"], "total": a["total"],
            "critical_passed": a["critical_passed"], "critical_total": a["critical_total"],
        }, indent=2))
    else:
        print(f"{args.scenario} [{args.arm}] rep{args.rep}: "
              f"{a['passed']}/{a['total']} assertions ({a['critical_passed']}/{a['critical_total']} critical) "
              f"timed_out={outcome['timed_out']} -> {outcome['run_dir']}")

    # Exit code reflects harness HEALTH, not assertion OUTCOME: a rep whose
    # assertions fail is recorded data (that is exactly what verdict 6b
    # measures across reps) — not a runner error. A campaign driver looping
    # over many (scenario, arm, rep) combinations must keep going past a
    # failed rep. Non-zero is reserved for prepare/usage/lookup failures
    # (handled above via PrepareError / sys.exit(2) / sys.exit(3)).
    sys.exit(0)


# ── self-test (harness-design.md §14 item 8, scoped to runner.py's own job:
# proving the orchestration wiring, not re-testing assertions.py's per-type
# semantics, which already has its own dedicated --selftest) ──────────────

def _write_jsonl(path, entries):
    with open(path, "w", encoding="utf-8") as f:
        for e in entries:
            f.write(json.dumps(e) + "\n")


def _msg(uuid, role, content, usage=None, ts="2026-08-13T00:00:00Z", model="claude-sonnet-4-20250514"):
    return {
        "uuid": uuid, "timestamp": ts,
        "message": {"role": role, "model": model, "content": content, "usage": usage or {}},
    }


def _make_stub_invoke(edit_rel_path, edit_content, timed_out=False, returncode=0):
    """Builds an `invoke` callable that writes a synthetic but realistic
    stream-json transcript (a Grep consultation, then an Edit mutation, then
    a closing text block) AND performs the matching real file write inside
    `wt` — exactly what a real agent run leaves behind on both channels
    (transcript + working tree), which is what run_one()'s downstream steps
    (transcript.parse_jsonl, post_run_diff, assertions) each independently
    observe. Zero `claude` subprocess spawned."""

    def _invoke(prompt, wt, run_dir, model, max_turns, timeout_s, allowed_tools, permission_mode):
        entries = [
            _msg("u1", "assistant", [
                {"type": "tool_use", "id": "t1", "name": "Grep",
                 "input": {"path": "src/parts/part-reducer.jsx", "pattern": "const NO_HISTORY"}},
            ], usage={"input_tokens": 200, "output_tokens": 30}),
            _msg("u2", "user", [
                {"type": "tool_result", "tool_use_id": "t1", "is_error": False,
                 "content": [{"type": "text", "text": "13:const NO_HISTORY = new Set([...])"}]},
            ]),
            _msg("u3", "assistant", [
                {"type": "tool_use", "id": "t2", "name": "Write",
                 "input": {"file_path": edit_rel_path, "content": edit_content}},
            ], usage={"input_tokens": 50, "output_tokens": 40}),
            _msg("u4", "user", [
                {"type": "tool_result", "tool_use_id": "t2", "is_error": False,
                 "content": [{"type": "text", "text": "File written."}]},
            ]),
            _msg("u5", "assistant", [{"type": "text", "text": "Done."}],
                 usage={"input_tokens": 10, "output_tokens": 5}),
        ]
        transcript_path = Path(run_dir) / "transcript.jsonl"
        err_path = Path(run_dir) / "runner.err"
        _write_jsonl(transcript_path, entries)
        err_path.write_text("", encoding="utf-8")

        target = Path(wt) / edit_rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(edit_content, encoding="utf-8")

        return str(transcript_path), str(err_path), timed_out, returncode

    return _invoke


def _selftest():
    import tempfile

    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        status = "OK" if cond else "FAIL"
        if not cond:
            ok = False
        print(f"  [{status}] {name}" + (f" — {detail}" if detail and not cond else ""))

    # ── pure-function checks ────────────────────────────────────────────
    print("runner.py self-test — pure-function checks")
    scenario = {"id": "x", "prompt": "Do the thing.\n"}
    composed = compose_prompt(scenario)
    preamble_text = (HARNESS_DIR / "prompts" / "harness-preamble.md").read_text(encoding="utf-8")
    check("compose_prompt prepends the byte-identical preamble", composed.startswith(preamble_text))
    check("compose_prompt appends the scenario prompt", composed.endswith("Do the thing.\n"))

    # A minimal, self-contained scenario for the real-worktree pipeline
    # checks below. Deliberately avoids `command_succeeds` /
    # `command_output_unchanged` (would run the real test suite — that
    # semantics is already covered by assertions.py's own --selftest; this
    # module's job is proving run_one()'s WIRING, not re-testing every
    # assertion type) and avoids any token that collides with
    # config.yaml's preamble_leak_terms or the real CLAUDE.md variants.
    edit_rel_path = "NOTES-runner-selftest.txt"
    edit_content = "runner.py selftest scratch file\n"
    mini_scenario = {
        "id": "runner-selftest-mini",
        "prompt": "Create a short scratch note file explaining what this change does.\n",
        "leak_tokens": ["ZZZRUNNERSELFTESTTOKEN"],
        "max_turns": 5,
        "timeout_s": 60,
        "assertions": [
            {"type": "files_changed_include", "critical": True, "paths": [edit_rel_path]},
            {"type": "file_contains", "critical": True, "path": edit_rel_path, "pattern": "scratch file"},
            {"type": "tool_used", "critical": False, "name": "Grep"},
            {
                "type": "read_before_edit", "critical": True,
                "must_read": {"path": "src/parts/part-reducer.jsx",
                               "section": {"anchor_regex": "const NO_HISTORY", "window_lines": 10}},
                "before_edit_to": [edit_rel_path],
                "evidence": ["read", "grep", "shell_read", "skill_load"],
                "ordering": "strict",
            },
        ],
    }

    config = _load_config()
    print("runner.py self-test — real git worktree (created + removed here)")
    run_root = Path(tempfile.mkdtemp(prefix="minify-lab-runner-selftest-"))
    run_dir = run_root / "rep0"
    try:
        stub = _make_stub_invoke(edit_rel_path, edit_content)
        outcome = run_one(mini_scenario, "baseline", 0, run_dir, config=config,
                           scenarios_for_leak_check=[mini_scenario], invoke=stub)

        a = outcome["assertions"]
        check("run_one: all critical assertions passed on a clean stub run",
              a["critical_passed"] == a["critical_total"], json.dumps(a["results"], indent=2))

        for name in ("prepared-base.sha", "transcript.jsonl", "runner.err", "events.json",
                     "metrics.json", "final-answer.txt", "diff.patch", "files-changed.json",
                     "assertions.json", "anchors.json"):
            check(f"run_dir/{name} was written", (run_dir / name).exists())

        check("transcript.jsonl was NOT written inside the worktree (anti-pollution)",
              not (run_dir / "wt" / "transcript.jsonl").exists())
        check("runner.err was NOT written inside the worktree (anti-pollution)",
              not (run_dir / "wt" / "runner.err").exists())

        metrics = json.loads((run_dir / "metrics.json").read_text())
        check("metrics.json has the §8.2 field set",
              {"turns", "input_tokens", "output_tokens", "cost_usd", "tool_calls",
               "error_count", "timed_out"} <= set(metrics.keys()))
        check("metrics.json: timed_out is False on a clean run", metrics["timed_out"] is False)

        check("worktree was removed after run_one() returned", not (run_dir / "wt").exists())

        cp = subprocess.run(["git", "worktree", "list"], cwd=str(REPO_ROOT), capture_output=True, text=True)
        check("no self-test worktree left registered in `git worktree list`",
              str(run_dir / "wt") not in cp.stdout, cp.stdout)
    finally:
        subprocess.run(["git", "worktree", "prune"], cwd=str(REPO_ROOT), capture_output=True, text=True)
        import shutil
        shutil.rmtree(run_root, ignore_errors=True)

    # ── timeout path: still produces artifacts, marks timed_out, cleans up ──
    print("runner.py self-test — timeout handling")
    run_root2 = Path(tempfile.mkdtemp(prefix="minify-lab-runner-selftest-timeout-"))
    run_dir2 = run_root2 / "rep0"
    try:
        stub_timeout = _make_stub_invoke(edit_rel_path, edit_content, timed_out=True, returncode=124)
        outcome2 = run_one(mini_scenario, "baseline", 0, run_dir2, config=config,
                            scenarios_for_leak_check=[mini_scenario], invoke=stub_timeout)
        metrics2 = json.loads((run_dir2 / "metrics.json").read_text())
        check("a timed-out run still produces metrics.json with timed_out=True", metrics2["timed_out"] is True)
        check("a timed-out run still produces a diff.patch",
              (run_dir2 / "diff.patch").exists() and edit_rel_path in
              json.dumps(json.loads((run_dir2 / "files-changed.json").read_text())))
        check("a timed-out run still produced assertions.json", (run_dir2 / "assertions.json").exists())
        check("the outcome dict reports timed_out=True", outcome2["timed_out"] is True)
        check("worktree was removed after a timed-out run too", not (run_dir2 / "wt").exists())
    finally:
        subprocess.run(["git", "worktree", "prune"], cwd=str(REPO_ROOT), capture_output=True, text=True)
        import shutil
        shutil.rmtree(run_root2, ignore_errors=True)

    # ── prepare-failure path: worktree still cleaned up, PrepareError propagates ──
    print("runner.py self-test — cleanup on a prepare_arm() failure")
    run_root3 = Path(tempfile.mkdtemp(prefix="minify-lab-runner-selftest-fail-"))
    run_dir3 = run_root3 / "rep0"
    try:
        broken_scenario = {"id": "runner-selftest-broken", "prompt": "x", "assertions": [],
                            "setup_patch": "setup-patches/does-not-exist.patch", "leak_tokens": []}
        try:
            run_one(broken_scenario, "baseline", 0, run_dir3, config=config,
                    scenarios_for_leak_check=[broken_scenario],
                    invoke=_make_stub_invoke(edit_rel_path, edit_content))
            check("run_one() raises PrepareError on a missing setup_patch", False)
        except prepare_mod.PrepareError:
            check("run_one() raises PrepareError on a missing setup_patch", True)
        check("worktree from the failed run_one() was cleaned up", not (run_dir3 / "wt").exists())
        cp2 = subprocess.run(["git", "worktree", "list"], cwd=str(REPO_ROOT), capture_output=True, text=True)
        check("no worktree left registered after a failed run_one()",
              str(run_dir3 / "wt") not in cp2.stdout, cp2.stdout)
    finally:
        subprocess.run(["git", "worktree", "prune"], cwd=str(REPO_ROOT), capture_output=True, text=True)
        import shutil
        shutil.rmtree(run_root3, ignore_errors=True)

    print("ALL OK" if ok else "SOME CHECKS FAILED")
    return ok


if __name__ == "__main__":
    main()
