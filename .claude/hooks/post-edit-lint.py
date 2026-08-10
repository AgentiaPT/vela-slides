#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""PostToolUse hook: run the security lints the moment a part-file is edited.

Harness enforcement (mechanism, not prompt): the deck-ingress key-drift check
and the CSS fetch-sink encoder gate already run in CI, but CI feedback arrives
minutes after the mistake. This hook runs the same lint.py (~150ms) right after
an Edit/Write touches src/parts/, so a renderer reading a non-allowlisted key
or an un-encoded CSS color sink is surfaced to the agent immediately, in the
turn that introduced it.

Contract: exit 2 feeds stderr back to Claude as actionable feedback; every
other failure mode exits 0 — the hook must never break editing (fail-open is
correct here: the authoritative gate remains CI, this layer only buys speed).
"""
import json
import os
import subprocess
import sys


def main():
    try:
        payload = json.load(sys.stdin)
        file_path = (payload.get("tool_input") or {}).get("file_path", "")
    except Exception:
        return 0
    if not isinstance(file_path, str) or not file_path:
        return 0
    norm = file_path.replace("\\", "/")
    if "/src/parts/" not in norm and not norm.startswith("src/parts/"):
        return 0
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    lint = os.path.join(repo_root, "tools", "vela-dev", "scripts", "lint.py")
    parts = os.path.join(repo_root, "src", "parts")
    if not os.path.exists(lint):
        return 0
    try:
        r = subprocess.run(
            [sys.executable, lint, "--parts", parts],
            capture_output=True, text=True, timeout=30,
        )
    except Exception:
        return 0
    if r.returncode != 0:
        sys.stderr.write(
            "Security lint failed after this edit (key-drift / CSS fetch-sink "
            "gate — see .claude/skills/vela-secure-coding/SKILL.md):\n"
            + (r.stdout or "") + (r.stderr or "")
        )
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
