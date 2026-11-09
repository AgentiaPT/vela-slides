#!/usr/bin/env python3
"""Tests for .claude/skills/hyper-sprint/assets/sprint-cost.py (stdlib only).

Synthetic Claude Code transcripts check that one API call is counted once
(Claude Code writes one JSONL line per content block, each with the same usage),
that 1-hour cache writes use the 1-hour rate, and that auto-discovery takes only
the files of the main session, each file once.

Run: python3 -m unittest tests.test_sprint_cost -v
Set SPRINT_COST_SCRIPT to test another copy of the script.
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.environ.get("SPRINT_COST_SCRIPT") or os.path.join(
    ROOT, ".claude", "skills", "hyper-sprint", "assets", "sprint-cost.py")

M = 1_000_000  # opus: $5 / MTok input, $25 / MTok output, cache write $6.25 (5m) / $10 (1h)


def line(msg_id, req_id, block, inp=M, out=0, cw=0, cw1h=None, uuid=None):
    usage = {"input_tokens": inp, "output_tokens": out,
             "cache_creation_input_tokens": cw, "cache_read_input_tokens": 0}
    if cw1h is not None:
        usage["cache_creation"] = {"ephemeral_5m_input_tokens": cw - cw1h,
                                   "ephemeral_1h_input_tokens": cw1h}
    msg = {"model": "claude-opus-x", "role": "assistant", "usage": usage,
           "content": [{"type": block}]}
    if msg_id:
        msg["id"] = msg_id
    rec = {"type": "assistant", "message": msg}
    if req_id:
        rec["requestId"] = req_id
    if uuid:
        rec["uuid"] = uuid
    return rec


def write(path, recs):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        for r in recs:
            f.write(json.dumps(r) + "\n")


def one_call(msg_id):
    """One API call split into 3 content-block lines ($5 of input)."""
    return [line(msg_id, "req_" + msg_id, b) for b in ("thinking", "text", "tool_use")]


class SprintCostTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def run_cost(self, *args):
        out = os.path.join(self.d, "out.json")
        p = subprocess.run([sys.executable, SCRIPT, *args, "--json", out],
                           capture_output=True, text=True, cwd=self.d)
        self.assertEqual(p.returncode, 0, p.stderr)
        with open(out) as f:
            return json.load(f), p.stdout

    def test_one_message_many_lines_counts_once(self):
        main = os.path.join(self.d, "main.jsonl")
        write(main, one_call("msg_a"))
        rep, _ = self.run_cost("--main", main)
        self.assertEqual(rep["grand_total"], 5.00)
        self.assertEqual(rep["agents"][0]["calls"], 1)
        self.assertEqual(rep["tokens"]["in"], M)

    def test_two_messages_count_both(self):
        main = os.path.join(self.d, "main.jsonl")
        write(main, one_call("msg_a") + one_call("msg_b"))
        rep, _ = self.run_cost("--main", main)
        self.assertEqual(rep["grand_total"], 10.00)
        self.assertEqual(rep["agents"][0]["calls"], 2)

    def test_streaming_lines_keep_max_output(self):
        main = os.path.join(self.d, "main.jsonl")
        write(main, [line("msg_a", "req_a", "text", inp=0, out=10),
                     line("msg_a", "req_a", "tool_use", inp=0, out=M)])
        rep, _ = self.run_cost("--main", main)
        self.assertEqual(rep["grand_total"], 25.00)

    def test_lines_without_ids_count_once_each(self):
        main = os.path.join(self.d, "main.jsonl")
        write(main, [line(None, None, "text", uuid="u1"),
                     line(None, None, "text", uuid="u2"),
                     line(None, None, "text")])
        rep, _ = self.run_cost("--main", main)
        self.assertEqual(rep["grand_total"], 15.00)

    def test_cache_write_1h_vs_5m_pricing(self):
        main = os.path.join(self.d, "main.jsonl")
        write(main, [line("m1", "r1", "text", inp=0, cw=M, cw1h=M),     # 1h: $10
                     line("m2", "r2", "text", inp=0, cw=M, cw1h=0),     # 5m: $6.25
                     line("m3", "r3", "text", inp=0, cw=M)])            # no breakdown: $6.25
        rep, _ = self.run_cost("--main", main)
        self.assertEqual(rep["grand_total"], 22.50)

    def make_project(self):
        proj = os.path.join(self.d, "projects", "-repo")
        old = os.path.join(proj, "old-session.jsonl")
        new = os.path.join(proj, "new-session.jsonl")
        write(old, one_call("old_main"))
        write(os.path.join(proj, "old-session", "subagents", "agent-x.jsonl"),
              one_call("old_sub"))
        write(new, one_call("new_main"))
        write(os.path.join(proj, "new-session", "subagents", "agent-y.jsonl"),
              one_call("new_sub"))
        write(os.path.join(proj + "--claude-worktrees-agent-y", "new-session.jsonl"),
              one_call("new_hook"))
        write(os.path.join(proj + "--claude-worktrees-agent-x", "old-session.jsonl"),
              one_call("old_hook"))
        past = time.time() - 3600
        os.utime(old, (past, past))
        return proj

    def test_discover_binds_to_main_session(self):
        proj = self.make_project()
        rep, _ = self.run_cost("--project-dir", proj)
        # new main + its sub-agent + its worktree session; nothing of old-session
        self.assertEqual(rep["grand_total"], 15.00)
        self.assertEqual(len(rep["agents"]), 3)

    def test_discover_without_worktree_sessions(self):
        proj = self.make_project()
        rep, _ = self.run_cost("--project-dir", proj, "--no-worktree-sessions")
        self.assertEqual(rep["grand_total"], 10.00)

    def test_symlinked_duplicate_counts_once(self):
        main = os.path.join(self.d, "main.jsonl")
        write(main, one_call("msg_a"))
        link = os.path.join(self.d, "link.jsonl")
        os.symlink(main, link)
        rep, _ = self.run_cost("--main", main, "--transcript", link)
        self.assertEqual(rep["grand_total"], 5.00)

    def test_copied_lines_across_files_count_once(self):
        main = os.path.join(self.d, "main.jsonl")
        copy = os.path.join(self.d, "copy.jsonl")
        write(main, one_call("msg_a"))
        write(copy, one_call("msg_a"))
        rep, _ = self.run_cost("--main", main, "--transcript", copy)
        self.assertEqual(rep["grand_total"], 5.00)

    def test_audit_counts_turns_per_message(self):
        main = os.path.join(self.d, "main.jsonl")
        write(main, one_call("msg_a") + one_call("msg_b"))
        _, stdout = self.run_cost("--main", main, "--audit")
        self.assertIn("assistant turns: 2 ", stdout)


if __name__ == "__main__":
    unittest.main()
