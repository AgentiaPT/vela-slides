#!/usr/bin/env python3
"""PreToolUse(Bash) guard: block git commit/push that would publish a Claude session URL.

CLAUDE.md forbids session URLs in commits and PRs (public repo). Cloud sessions
can still ask for a `Claude-Session: https://claude.ai/code/session_...` trailer,
so this hook enforces the rule deterministically:
  - `git commit` whose command line carries a session URL -> blocked.
  - `git push` while an unpushed commit message carries one -> blocked.
Any internal error fails open (exit 0) so the hook never wedges normal work.
"""
import json
import re
import subprocess
import sys

# Match real links (an id after the path), not prose that names the pattern.
URL = re.compile(r"claude\.ai/(?:code/session_[A-Za-z0-9]{8,}|chat/[0-9a-fA-F-]{8,}|p/[A-Za-z0-9_-]{6,})")


def unpushed_messages(cwd):
    # Commits reachable from HEAD that no remote-tracking ref has yet.
    out = subprocess.run(
        ["git", "log", "--format=%B", "HEAD", "--not", "--remotes"],
        cwd=cwd, capture_output=True, text=True, timeout=10,
    )
    return out.stdout if out.returncode == 0 else ""


def main():
    data = json.load(sys.stdin)
    cmd = (data.get("tool_input") or {}).get("command") or ""
    cwd = data.get("cwd") or None
    if not re.search(r"\bgit\b", cmd):
        return 0
    if re.search(r"\bcommit\b", cmd) and URL.search(cmd):
        reason = "commit message contains a Claude session URL"
    elif re.search(r"\bpush\b", cmd) and URL.search(unpushed_messages(cwd)):
        reason = "an unpushed commit message contains a Claude session URL"
    else:
        return 0
    print(
        f"Blocked: {reason}. CLAUDE.md forbids session URLs in this public repo. "
        "Remove the `Claude-Session:` line (reword the commit) and try again.",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
