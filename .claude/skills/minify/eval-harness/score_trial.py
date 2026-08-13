#!/usr/bin/env python3
"""
score_trial.py -- mechanical scorer for one captured /minify eval trial.

Given a trial manifest (produced by prepare_trial.py) and a "result" JSON
describing what happened when an agent ran the task prompt in that
worktree, this script:

  1. Applies the task's mechanical checks (tasks.json: forbidden_diff /
     required_diff / forbidden_output / required_output regexes) against
     the captured diff text and free-text output.
  2. Applies one task-specific structural check for C1 (exact tool-call
     count / no validate call), since that signal lives in the tool-call
     trace, not in regex-over-text.
  3. Folds in tokens / turns / tool errors from the result JSON as-is
     (this script does not compute them -- the external agent run does).
  4. Writes one JSON record (and appends one JSONL line to the shared
     results log) with a mechanical_verdict: "pass" | "violation" | "unclear".

This script does NOT run or judge quality itself -- mechanical_verdict is a
first-pass compliance signal only, meant to sit alongside (not replace) the
blind LLM-judge pass described in context.md / eval-task-set.md.

Usage:
    python3 score_trial.py --manifest <work_dir>/_trial_manifest.json \\
        --result result.json [--results-log results.jsonl] [--json]

result.json shape (produced by the external orchestrator running the
agent, see README.md):
{
  "tokens": 12345,
  "turns": 4,
  "tool_calls": [{"name": "Write", "ok": true}, {"name": "Bash", "ok": false, "error": "..."}],
  "diff": "<the full `git diff` text captured inside the trial's work_dir>",
  "output": "<the agent's final free-text response>"
}

Exit codes: 0 ok (record written, regardless of verdict), 1 fail (bad input), 2 usage.
"""

import argparse
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TASKS_PATH = os.path.join(HERE, "tasks.json")
DEFAULT_RESULTS_LOG = os.path.join(HERE, "results.jsonl")


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def die(msg, code=1):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


def any_match(patterns, text):
    if not text:
        return []
    hits = []
    for pat in patterns or []:
        try:
            if re.search(pat, text, re.IGNORECASE | re.MULTILINE):
                hits.append(pat)
        except re.error as e:
            hits.append(f"<bad regex {pat!r}: {e}>")
    return hits


def score_c1(result):
    """C1-specific structural check: exactly 2 tool calls (Write-family then
    a ship-family call), no validate/read call in between, no prose turn
    between the two calls. Best-effort against whatever shape tool_calls
    takes; flags 'unclear' rather than guessing if the trace doesn't look
    like a Vela-style {name, ok} list."""
    calls = result.get("tool_calls")
    if not isinstance(calls, list) or not calls:
        return "unclear", "no usable tool_calls trace in result.json"
    names = [c.get("name", "") for c in calls if isinstance(c, dict)]
    if len(names) != 2:
        return "violation", f"expected exactly 2 tool calls, got {len(names)}: {names}"
    if any(re.search(r"validate|read", n, re.IGNORECASE) for n in names):
        return "violation", f"a validate/read-family call appeared: {names}"
    return "pass", f"exactly 2 tool calls, no validate/read: {names}"


def score_task(task, result):
    checks = task.get("checks", {})
    diff_text = result.get("diff", "") or ""
    output_text = result.get("output", "") or ""

    forbidden_diff_hits = any_match(checks.get("forbidden_diff"), diff_text)
    forbidden_output_hits = any_match(checks.get("forbidden_output"), output_text)
    required_diff_hits = any_match(checks.get("required_diff"), diff_text)
    required_output_hits = any_match(checks.get("required_output"), output_text)

    has_forbidden = bool(forbidden_diff_hits or forbidden_output_hits)
    required_diff_specified = bool(checks.get("required_diff"))
    required_output_specified = bool(checks.get("required_output"))
    required_satisfied = (not required_diff_specified or bool(required_diff_hits)) and \
                          (not required_output_specified or bool(required_output_hits))

    detail = {
        "forbidden_diff_hits": forbidden_diff_hits,
        "forbidden_output_hits": forbidden_output_hits,
        "required_diff_hits": required_diff_hits,
        "required_output_hits": required_output_hits,
    }

    if has_forbidden:
        return "violation", detail
    if (required_diff_specified or required_output_specified) and not required_satisfied:
        return "unclear", detail  # required signal absent isn't proof of violation, just no positive confirmation
    if not required_diff_specified and not required_output_specified:
        return "unclear", detail  # no mechanical signal configured for this task at all
    return "pass", detail


TASKS = {}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--manifest", required=True, help="path to _trial_manifest.json from prepare_trial.py")
    ap.add_argument("--result", required=True, help="path to the captured result JSON (tokens/turns/tool_calls/diff/output)")
    ap.add_argument("--results-log", default=DEFAULT_RESULTS_LOG, help=f"JSONL file to append the scored record to (default: {DEFAULT_RESULTS_LOG})")
    ap.add_argument("--no-log", action="store_true", help="score and print only, do not append to the results log")
    ap.add_argument("--json", action="store_true", help="print the scored record as JSON only")
    args = ap.parse_args()

    global TASKS
    TASKS = load_json(TASKS_PATH)

    manifest = load_json(args.manifest)
    result = load_json(args.result)

    task_id = manifest["task_id"]
    task = TASKS.get(task_id)
    if task is None:
        die(f"manifest references unknown task id {task_id!r}", 1)

    if task_id == "C1":
        verdict, detail = score_c1(result)
    else:
        verdict, detail = score_task(task, result)

    tool_calls = result.get("tool_calls", []) or []
    tool_errors = [c for c in tool_calls if isinstance(c, dict) and c.get("ok") is False]

    record = {
        "trial_id": manifest.get("trial_id"),
        "task_id": task_id,
        "trap": manifest.get("trap"),
        "target": manifest.get("target"),
        "condition": manifest.get("condition"),
        "target_file": manifest.get("target_file"),
        "tokens": result.get("tokens"),
        "turns": result.get("turns"),
        "tool_call_count": len(tool_calls),
        "tool_error_count": len(tool_errors),
        "tool_errors": tool_errors,
        "mechanical_verdict": verdict,
        "mechanical_detail": detail,
        "scored_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    if args.json:
        print(json.dumps(record, indent=2))
    else:
        print(f"task {task_id} [{manifest.get('condition')}] -> mechanical_verdict = {verdict}")
        print(json.dumps(detail, indent=2))

    if not args.no_log:
        os.makedirs(os.path.dirname(os.path.abspath(args.results_log)) or ".", exist_ok=True)
        with open(args.results_log, "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")


if __name__ == "__main__":
    main()
