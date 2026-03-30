#!/usr/bin/env python3
"""
Status writer for Vela Eval Runner.
Maintains evals/output/status.js as a JSONP-style file:
  var EVAL_STATUS = { ... };

Commands:
  init          Initialize status with state="running"
  current       Update current progress pointer
  complete-run  Record a completed run with harvest totals
  validate-run  Record validation results for a run
  finish        Set state="completed"
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone


def get_status_path():
    return os.environ.get("STATUS_FILE", os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "output", "status.js"
    ))


def read_status():
    path = get_status_path()
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    # Strip "var EVAL_STATUS = " prefix and ";" suffix
    prefix = "var EVAL_STATUS = "
    if text.startswith(prefix):
        text = text[len(prefix):]
    if text.rstrip().endswith(";"):
        text = text.rstrip()[:-1]
    return json.loads(text)


def write_status(data):
    path = get_status_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write("var EVAL_STATUS = ")
        json.dump(data, f, indent=2)
        f.write(";\n")


def cmd_init(args):
    versions_list = [v.strip() for v in args.versions.split(",") if v.strip()]

    # Merge with existing status — never wipe previous data
    existing = read_status()
    existing_versions = existing.get("versions", {})

    versions = {}
    for v in versions_list:
        skill_chars = 0
        if args.skills_dir:
            skill_path = os.path.join(args.skills_dir, v, "SKILL.md")
            if os.path.exists(skill_path):
                skill_chars = os.path.getsize(skill_path)
        if v in existing_versions:
            # Preserve existing runs
            versions[v] = existing_versions[v]
            versions[v]["skill_chars"] = skill_chars
        else:
            versions[v] = {
                "skill_chars": skill_chars,
                "runs": []
            }

    completed_runs = sum(len(v.get("runs", [])) for v in versions.values())

    status = {
        "started_at": existing.get("started_at", datetime.now(timezone.utc).isoformat()),
        "model": args.model,
        "reps": int(args.reps),
        "max_turns": int(args.max_turns),
        "state": "running",
        "progress": {
            "total_runs": int(args.total_runs),
            "completed_runs": completed_runs,
            "current": None
        },
        "versions": versions
    }
    write_status(status)


def add_activity(status, msg):
    """Append a timestamped activity entry (keep last 20)."""
    if "activity" not in status:
        status["activity"] = []
    status["activity"].append({
        "time": datetime.now(timezone.utc).strftime("%H:%M:%S"),
        "msg": msg
    })
    status["activity"] = status["activity"][-20:]


def cmd_current(args):
    status = read_status()
    add_activity(status, f"Started {args.version} / {args.scenario} r{args.rep} — {args.step}")
    status["progress"]["current"] = {
        "version": args.version,
        "scenario": args.scenario,
        "rep": int(args.rep),
        "step": args.step,
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
    if args.session_id:
        status["progress"]["current"]["session_id"] = args.session_id
    write_status(status)


def cmd_complete_run(args):
    status = read_status()
    harvest_file = args.harvest_file

    totals = {}
    if harvest_file and os.path.exists(harvest_file):
        with open(harvest_file, encoding="utf-8") as f:
            data = json.load(f)
        raw = data[0]["totals"] if isinstance(data, list) else data["totals"]
        totals = {
            "input_tokens": raw.get("input_tokens", 0),
            "output_tokens": raw.get("output_tokens", 0),
            "cache_read_tokens": raw.get("cache_read_tokens", raw.get("cache_read_input_tokens", 0)),
            "cache_write_tokens": raw.get("cache_write_tokens", raw.get("cache_creation_input_tokens", 0)),
            "cost_usd": raw.get("cost_usd", 0),
            "duration_s": raw.get("duration_s", 0),
            "tool_calls": raw.get("tool_calls", 0),
            "turns": raw.get("turns", 0),
        }

    run_entry = {
        "scenario": args.scenario,
        "rep": int(args.rep),
        "status": "completed",
        "totals": totals,
        "validation": None
    }

    version = args.version
    if version in status.get("versions", {}):
        status["versions"][version]["runs"].append(run_entry)

    status["progress"]["completed_runs"] = status["progress"].get("completed_runs", 0) + 1
    cost = totals.get("cost_usd", 0)
    dur = totals.get("duration_s", 0)
    tools = totals.get("tool_calls", 0)
    add_activity(status, f"Completed {args.version} / {args.scenario} r{args.rep} — ${cost:.4f} / {dur:.0f}s / {tools} tools")
    write_status(status)


def cmd_validate_run(args):
    status = read_status()
    version = args.version
    scenario = args.scenario
    rep = int(args.rep)

    results = []
    if args.results_json:
        try:
            results = json.loads(args.results_json)
        except json.JSONDecodeError:
            results = []

    validation = {
        "passed": int(args.passed),
        "total": int(args.total),
        "results": results
    }

    if version in status.get("versions", {}):
        for run in status["versions"][version]["runs"]:
            if run["scenario"] == scenario and run["rep"] == rep:
                run["validation"] = validation
                break

    write_status(status)


def cmd_judge_run(args):
    status = read_status()
    version = args.version
    scenario = args.scenario
    rep = int(args.rep)

    scores = {}
    if args.scores_json:
        try:
            scores = json.loads(args.scores_json)
        except json.JSONDecodeError:
            scores = {}

    if version in status.get("versions", {}):
        for run in status["versions"][version]["runs"]:
            if run["scenario"] == scenario and run["rep"] == rep:
                run.setdefault("quality", {})["judge"] = scores
                break

    overall = scores.get("overall", "?")
    add_activity(status, f"Judged {version} / {scenario} r{rep} — quality={overall}")
    write_status(status)


def cmd_finish(args):
    status = read_status()
    status["state"] = "completed"
    status["progress"]["current"] = None
    write_status(status)


def main():
    parser = argparse.ArgumentParser(description="Vela Eval status writer")
    sub = parser.add_subparsers(dest="command", required=True)

    # init
    p = sub.add_parser("init")
    p.add_argument("--model", required=True)
    p.add_argument("--reps", required=True)
    p.add_argument("--max-turns", required=True)
    p.add_argument("--versions", required=True, help="Comma-separated version list")
    p.add_argument("--total-runs", required=True)
    p.add_argument("--skills-dir", default="", help="Path to evals/skills dir for skill_chars")

    # current
    p = sub.add_parser("current")
    p.add_argument("--version", required=True)
    p.add_argument("--scenario", required=True)
    p.add_argument("--rep", required=True)
    p.add_argument("--step", required=True)
    p.add_argument("--session-id", default="")

    # complete-run
    p = sub.add_parser("complete-run")
    p.add_argument("--version", required=True)
    p.add_argument("--scenario", required=True)
    p.add_argument("--rep", required=True)
    p.add_argument("--harvest-file", default="")

    # validate-run
    p = sub.add_parser("validate-run")
    p.add_argument("--version", required=True)
    p.add_argument("--scenario", required=True)
    p.add_argument("--rep", required=True)
    p.add_argument("--passed", required=True)
    p.add_argument("--total", required=True)
    p.add_argument("--results-json", default="[]")

    # judge-run
    p = sub.add_parser("judge-run")
    p.add_argument("--version", required=True)
    p.add_argument("--scenario", required=True)
    p.add_argument("--rep", required=True)
    p.add_argument("--scores-json", default="{}")

    # finish
    sub.add_parser("finish")

    args = parser.parse_args()

    commands = {
        "init": cmd_init,
        "current": cmd_current,
        "complete-run": cmd_complete_run,
        "validate-run": cmd_validate_run,
        "judge-run": cmd_judge_run,
        "finish": cmd_finish,
    }
    commands[args.command](args)


if __name__ == "__main__":
    main()
