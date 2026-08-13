#!/usr/bin/env python3
"""
prepare_trial.py -- stage one isolated eval trial for the /minify eval harness.

Given a task id (from tasks.json, itself a structured copy of
eval-task-set.md) and a condition (baseline|minified), this script:

  1. Looks up the task's target file pair (file_pairs.json).
  2. Creates an ISOLATED git worktree of the current HEAD in a scratch
     directory (never mutates the real working tree / repo state).
  3. For condition=minified, overwrites the target file inside that
     worktree with the contents of the minified candidate. For
     condition=baseline, the worktree already has the baseline file as
     checked in -- no change needed.
  4. Writes a trial manifest JSON describing exactly what an external
     orchestrator (human or agent) needs to run the trial: the working
     directory, the exact prompt text, and bookkeeping fields the scorer
     will need later (task id, condition, target file).

This script does NOT spawn an agent session itself -- see README.md for the
run step, which is deliberately external/manual (the orchestrator is
expected to already have Task/Agent-tool spawning capability).

Usage:
    python3 prepare_trial.py --task A1 --condition baseline
    python3 prepare_trial.py --task A1 --condition minified --json
    python3 prepare_trial.py --task A1 --condition minified --scratch-root /tmp/foo
    python3 prepare_trial.py --list-tasks

Exit codes: 0 ok, 1 fail, 2 usage, 3 not-found.
"""

import argparse
import json
import os
import subprocess
import sys
import time
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
TASKS_PATH = os.path.join(HERE, "tasks.json")
PAIRS_PATH = os.path.join(HERE, "file_pairs.json")


def repo_root():
    out = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        cwd=HERE, capture_output=True, text=True, check=True,
    )
    return out.stdout.strip()


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def die(msg, code=1):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


def make_worktree(root, scratch_root):
    """Create a detached worktree of HEAD under scratch_root. Returns path."""
    os.makedirs(scratch_root, exist_ok=True)
    wt_dir = os.path.join(scratch_root, f"trial-{uuid.uuid4().hex[:10]}")
    # Detached worktree at current HEAD -- no new branch, no effect on
    # the real repo's branches/refs beyond the worktree registration
    # itself (removed by the caller / a `git worktree prune` later).
    subprocess.run(
        ["git", "worktree", "add", "--detach", wt_dir, "HEAD"],
        cwd=root, capture_output=True, text=True, check=True,
    )
    return wt_dir


def swap_file(worktree_dir, rel_path, minified_rel_path):
    """Overwrite rel_path inside the worktree with minified_rel_path's content."""
    src = os.path.join(worktree_dir, minified_rel_path)
    dst = os.path.join(worktree_dir, rel_path)
    if not os.path.isfile(src):
        die(f"minified source file not found in worktree: {src}", 3)
    with open(src, "r", encoding="utf-8") as f:
        content = f.read()
    with open(dst, "w", encoding="utf-8") as f:
        f.write(content)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--task", help="task id from tasks.json, e.g. A1")
    ap.add_argument("--condition", choices=["baseline", "minified"], help="which file variant to stage")
    ap.add_argument("--scratch-root", default=None, help="parent dir for the worktree (default: <repo>/.minify-eval-scratch, gitignored-by-convention -- create a .gitignore entry if missing)")
    ap.add_argument("--json", action="store_true", help="print manifest as JSON only")
    ap.add_argument("--list-tasks", action="store_true", help="list task ids and exit")
    ap.add_argument("--keep-existing-scratch-root", action="store_true", help="do not error if scratch root already has unrelated content (default: fine either way, this flag is a no-op kept for CLI symmetry with vela.py-style scripts)")
    args = ap.parse_args()

    tasks = load_json(TASKS_PATH)
    pairs = load_json(PAIRS_PATH)

    if args.list_tasks:
        for tid, t in sorted(tasks.items()):
            if tid.startswith("_"):
                continue
            print(f"{tid}\t{'[trap]' if t.get('trap') else '[general]'}\t{t['target']}\t{t['prompt'][:70]}")
        return

    if not args.task or not args.condition:
        die("--task and --condition are required (or use --list-tasks)", 2)

    task = tasks.get(args.task)
    if task is None:
        die(f"unknown task id {args.task!r}; see --list-tasks", 3)

    pair = pairs.get(task["target"])
    if pair is None:
        die(f"unknown target {task['target']!r} in file_pairs.json", 3)

    root = repo_root()
    scratch_root = args.scratch_root or os.path.join(root, ".minify-eval-scratch")

    worktree_dir = make_worktree(root, scratch_root)

    if args.condition == "minified":
        swap_file(worktree_dir, pair["baseline"], pair["minified"])
        active_variant_path = pair["minified"]
    else:
        active_variant_path = pair["baseline"]

    trial_id = os.path.basename(worktree_dir)
    manifest = {
        "trial_id": trial_id,
        "task_id": args.task,
        "trap": bool(task.get("trap")),
        "target": task["target"],
        "condition": args.condition,
        "target_file": pair["baseline"],
        "variant_file_used_as_source": active_variant_path,
        "prompt": task["prompt"],
        "trips": task.get("trips", ""),
        "work_dir": worktree_dir,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "instructions_for_orchestrator": (
            f"Run the task prompt against a FRESH agent session with cwd={worktree_dir} "
            f"(this is an isolated git worktree; the real repo is untouched). "
            f"Capture: total tokens, turn count, tool-call list (name + error/ok), "
            f"the final `git diff` inside {worktree_dir}, and the agent's final text output. "
            f"Feed all of that into score_trial.py as a transcript JSON (see README.md)."
        ),
    }

    manifest_path = os.path.join(worktree_dir, "_trial_manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    manifest["manifest_path"] = manifest_path

    if args.json:
        print(json.dumps(manifest, indent=2))
    else:
        print(f"trial_id       : {trial_id}")
        print(f"task           : {args.task} ({'trap' if task.get('trap') else 'general'})")
        print(f"target         : {task['target']}")
        print(f"condition      : {args.condition}")
        print(f"target_file    : {pair['baseline']}")
        print(f"work_dir       : {worktree_dir}")
        print(f"manifest       : {manifest_path}")
        print()
        print("prompt:")
        print(f"  {task['prompt']}")


if __name__ == "__main__":
    main()
