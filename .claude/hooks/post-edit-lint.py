#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""PostToolUse hook: run the security lints the moment a part-file is edited,
and surface the mandatory secure-coding read at the exact moment it matters.

Harness enforcement (mechanism, not prompt): the deck-ingress key-drift check
and the CSS fetch-sink encoder gate (plus the other part-file structural
checks) already run in CI, but CI feedback arrives minutes after the mistake.
This hook runs the same lint.py (~0.7s) right after an Edit/Write touches a
src/parts/ tree of THIS repo — the main checkout OR one of its linked git
worktrees — so a violation is surfaced to the agent in the turn that
introduced it rather than minutes later in CI.

Why worktrees are in scope (measured, not hypothetical): parallel agents work
in `git worktree` copies of this repo. An earlier version of this hook only
accepted the main checkout's src/parts, which meant worktree agents got zero
edit-time security feedback — and measurably skipped the mandatory
secure-coding read far more often than main-checkout agents. Coverage here is
a compliance mechanism, not a convenience.

Scoping is still authoritative and closed:
  1. settings.json spawns the hook for every Edit/Write/MultiEdit (no path
     pre-filter — a glob there could not express "any worktree of this repo"
     reliably); this script exits 0 immediately for out-of-scope paths.
  2. The edited file's REAL path must live under `<root>/src/parts` where
     <root> is (a) this repo's main checkout, or (b) a linked worktree whose
     `.git` file's `gitdir:` pointer realpath-resolves inside this repo's own
     `.git` directory. A same-named tree anywhere else on disk (scratchpad
     clone, foreign repo) is rejected — we never execute a lint.py from a
     tree that isn't a commit of this repository.
  3. The lint executed is the accepted checkout's OWN lint.py, so a worktree
     pinned to an older commit is checked by that commit's rules — no
     cross-version misattribution.

One-time pre-edit gate (`--pre`, wired as a PreToolUse hook): the FIRST
in-scope edit per checkout (marker file in the system temp dir, never inside
the repo — the tree must stay clean) is blocked with exit 2 and a pointer to
.claude/skills/vela-secure-coding/SKILL.md and its Triage section; the agent
reads the skill (or confirms it already has) and re-runs the edit, which then
passes. Delivery matters here: a PostToolUse exit-2 stderr is not reliably
surfaced to subagents (measured — reminders fired but never reached any
worktree agent's context), while a blocked tool call MUST be read for the
agent to proceed, and it arrives BEFORE code is written. Every agent that
edits app code therefore receives the mandate exactly once, deterministically,
regardless of whether it read CLAUDE.md.

Contract: exit 2 feeds stderr back to Claude as actionable feedback; every
other path exits 0 — the hook must never break editing (fail-open: the
authoritative gate remains CI, this layer only buys speed). The fail-open
branches that skip the lint (missing script, timeout, subprocess error) emit a
one-line stderr NOTE with exit 0, so a silent no-op stays visible instead of
looking identical to "lint passed".
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile

# Files above this line count get the one-time ranged-read nudge. Chosen well
# under the Read tool's own 2000-line silent-truncation threshold, so the gate
# fires before an agent can unknowingly work from partial file content.
READ_GATE_LINES = 800

READ_GATE_MSG = (
    "LARGE-FILE READ GATE (one-time per file — this read was NOT executed): "
    "{path} is {n} lines. Whole-file reads of large files are costly, and "
    "reads beyond 2000 lines are silently truncated — you could be working "
    "from incomplete content without knowing. Prefer a ranged read "
    "(offset/limit): grep the symbol you need for its line, or run "
    "`python3 tools/vela-dev/scripts/partsize.py <part-file>` for the "
    "section map. If you genuinely need the whole file, re-run this exact "
    "Read — it will go through."
)

SKILL_GATE_MSG = (
    "SECURITY GATE (one-time per checkout — this edit was NOT applied): every "
    "code change in this repo requires .claude/skills/vela-secure-coding/"
    "SKILL.md — start with its Triage section (static app-chrome/editor-UI "
    "edits: §0 + the helper table is enough; anything touching deck values, "
    "sanitizers, exporters, server or native code: full read). Read it now if "
    "you haven't in this session, then re-run this exact edit — it will go "
    "through."
)


def _repo_root():
    # Prefer the harness-provided project root (the value settings.json's
    # command line already depends on); fall back to walking up from __file__.
    env = os.environ.get("CLAUDE_PROJECT_DIR")
    if env and os.path.isdir(env):
        return os.path.realpath(env)
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _note(msg):
    sys.stderr.write("NOTE (post-edit-lint skipped — CI still gates): " + msg + "\n")


def _checkout_root_for(edited, repo_root):
    """Return the accepted checkout root containing `edited`, or None.

    Accepted roots: the main checkout itself, or a linked worktree of it
    (verified via the worktree's `.git` file gitdir pointer — the unforgeable
    link back to this repo; a path or name resemblance is not enough).
    """
    d = os.path.dirname(edited)
    for _ in range(30):  # bounded walk — no unbounded traversal toward /
        if os.path.isdir(os.path.join(d, "src", "parts")):
            if d == repo_root:
                return d
            gitfile = os.path.join(d, ".git")
            if os.path.isfile(gitfile):
                try:
                    with open(gitfile, "r", encoding="utf-8") as f:
                        first = f.readline().strip()
                except OSError:
                    return None
                if first.startswith("gitdir:"):
                    gitdir = os.path.realpath(
                        os.path.join(d, first[len("gitdir:"):].strip()))
                    main_git = os.path.realpath(os.path.join(repo_root, ".git"))
                    try:
                        if os.path.commonpath([gitdir, main_git]) == main_git:
                            return d
                    except ValueError:
                        return None
            return None
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent
    return None


def _marker_pending(name, seed):
    """Generic once-only marker in the temp dir (never inside the repo — the
    tree must stay clean). True exactly once per seed."""
    key = hashlib.sha1(seed.encode("utf-8")).hexdigest()[:16]
    marker = os.path.join(tempfile.gettempdir(), name + key)
    if os.path.exists(marker):
        return False
    try:
        with open(marker, "w", encoding="utf-8") as f:
            f.write(seed + "\n")
    except OSError:
        return False  # can't persist → stay quiet rather than nag every call
    return True


def _reminder_pending(root):
    return _marker_pending("vela-secskill-note-", root)


def main():
    try:
        payload = json.load(sys.stdin)
        file_path = (payload.get("tool_input") or {}).get("file_path", "")
        if not isinstance(file_path, str) or not file_path:
            return 0
        repo_root = _repo_root()
        edited = os.path.realpath(file_path)
        root = _checkout_root_for(edited, repo_root)
        if root is None:
            return 0
        if "--pre-read" in sys.argv:
            # PreToolUse gate on Read: nudge offset-less reads of large files
            # toward ranged reads, ONCE per (checkout, file). A read that
            # already carries offset/limit is intentional targeted reading and
            # always passes; the identical retry after the nudge also passes.
            ti = payload.get("tool_input") or {}
            if ti.get("offset") is not None or ti.get("limit") is not None:
                return 0
            try:
                with open(edited, "rb") as f:
                    n = sum(1 for _ in f)
            except OSError:
                return 0
            if n <= READ_GATE_LINES:
                return 0
            if _marker_pending("vela-readgate-", root + "\0" + edited):
                sys.stderr.write(
                    READ_GATE_MSG.format(path=os.path.basename(edited), n=n) + "\n")
                return 2
            return 0
        parts = os.path.realpath(os.path.join(root, "src", "parts"))
        try:
            in_scope = os.path.commonpath([edited, parts]) == parts
        except ValueError:  # different drive on Windows, etc.
            return 0
        if not in_scope:
            return 0
        if "--pre" in sys.argv:
            # PreToolUse gate: block the FIRST in-scope edit per checkout with
            # the mandatory-read instruction; every later edit passes straight
            # through. Blocking (not informing after the fact) is deliberate:
            # a blocked call's message is guaranteed to reach the agent.
            if _reminder_pending(root):
                sys.stderr.write(SKILL_GATE_MSG + "\n")
                return 2
            return 0
        lint = os.path.join(root, "tools", "vela-dev", "scripts", "lint.py")
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
