#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""PostToolUse hook: run the security lints the moment a part-file is edited.

Harness enforcement (mechanism, not prompt): the deck-ingress key-drift check
and the CSS fetch-sink encoder gate (plus the other part-file structural
checks) already run in CI, but CI feedback arrives minutes after the mistake.
This hook runs the same lint.py (~0.7s) right after an Edit/Write touches THIS
repo's src/parts/, so a violation is surfaced to the agent in the turn that
introduced it rather than minutes later in CI.

Two-layer path scoping, on purpose:
  1. settings.json `if: "Edit(src/parts/**)|Write(src/parts/**)"` is a cheap
     pre-filter so the hook process is not even spawned for non-part edits.
  2. This script re-checks that the edited file's REAL path is inside THIS
     repo's src/parts/ before linting — the authoritative gate, so a same-named
     path in another checkout / worktree / scratchpad clone can never trigger a
     lint of (or a misattributed failure against) this repo's tree.

Contract: exit 2 feeds stderr back to Claude as actionable feedback; every
other path exits 0 — the hook must never break editing (fail-open: the
authoritative gate remains CI, this layer only buys speed). The fail-open
branches that skip the lint (missing script, timeout, subprocess error) emit a
one-line stderr NOTE with exit 0, so a silent no-op stays visible instead of
looking identical to "lint passed".
"""
import json
import os
import subprocess
import sys


def _repo_root():
    # Prefer the harness-provided project root (the value settings.json's
    # command line already depends on); fall back to walking up from __file__.
    env = os.environ.get("CLAUDE_PROJECT_DIR")
    if env and os.path.isdir(env):
        return os.path.realpath(env)
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _note(msg):
    sys.stderr.write("NOTE (post-edit-lint skipped — CI still gates): " + msg + "\n")


def main():
    try:
        payload = json.load(sys.stdin)
        file_path = (payload.get("tool_input") or {}).get("file_path", "")
        if not isinstance(file_path, str) or not file_path:
            return 0
        repo_root = _repo_root()
        parts = os.path.realpath(os.path.join(repo_root, "src", "parts"))
        # Authoritative scope check: the edited file must resolve to inside THIS
        # repo's src/parts. realpath collapses ./, //, .. and symlinks; the
        # commonpath test refuses a same-named tree elsewhere on disk.
        edited = os.path.realpath(file_path)
        try:
            in_scope = os.path.commonpath([edited, parts]) == parts
        except ValueError:  # different drive on Windows, etc.
            return 0
        if not in_scope:
            return 0
        lint = os.path.join(repo_root, "tools", "vela-dev", "scripts", "lint.py")
        if not os.path.exists(lint):
            _note("lint.py not found at " + lint)
            return 0
        try:
            r = subprocess.run(
                [sys.executable, lint, "--parts", parts],
                capture_output=True, text=True, timeout=45,
            )
        except subprocess.TimeoutExpired:
            _note("lint.py timed out")
            return 0
        except Exception as e:
            _note("lint.py could not run (%s)" % e)
            return 0
        if r.returncode != 0:
            sys.stderr.write(
                "Part-file lint failed after an edit under src/parts/ — this "
                "runs the security gates (key-drift, CSS fetch-sink, SVG <style> "
                "tamper) AND the structural checks; read the specific error "
                "below, then .claude/skills/vela-secure-coding/SKILL.md:\n"
                + (r.stdout or "") + (r.stderr or "")
            )
            return 2
        return 0
    except Exception:
        # Absolute backstop: nothing this hook does may break editing.
        return 0


if __name__ == "__main__":
    sys.exit(main())
