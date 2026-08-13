#!/usr/bin/env python3
"""
cleanup_trial.py -- remove a trial's git worktree after scoring.

Usage:
    python3 cleanup_trial.py --work-dir <path>       # remove one trial worktree
    python3 cleanup_trial.py --all                    # remove every worktree under
                                                        # the default scratch root
"""

import argparse
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def repo_root():
    out = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        cwd=HERE, capture_output=True, text=True, check=True,
    )
    return out.stdout.strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--work-dir", help="a single trial's worktree path (from prepare_trial.py's manifest)")
    ap.add_argument("--all", action="store_true", help="remove every worktree under <repo>/.minify-eval-scratch")
    ap.add_argument("--scratch-root", default=None)
    args = ap.parse_args()

    root = repo_root()
    scratch_root = args.scratch_root or os.path.join(root, ".minify-eval-scratch")

    if args.work_dir:
        subprocess.run(["git", "worktree", "remove", "--force", args.work_dir], cwd=root, check=True)
        print(f"removed worktree: {args.work_dir}")
        return

    if args.all:
        if not os.path.isdir(scratch_root):
            print("nothing to clean up")
            return
        for name in os.listdir(scratch_root):
            wt = os.path.join(scratch_root, name)
            subprocess.run(["git", "worktree", "remove", "--force", wt], cwd=root, check=False)
        subprocess.run(["git", "worktree", "prune"], cwd=root, check=False)
        print(f"cleaned up all worktrees under {scratch_root}")
        return

    print("nothing to do -- pass --work-dir or --all", file=sys.stderr)
    sys.exit(2)


if __name__ == "__main__":
    main()
