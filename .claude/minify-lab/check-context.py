#!/usr/bin/env python3
"""Report the current Claude Code session's real context-window usage.

Reads the live session transcript under ~/.claude/projects/<cwd-slug>/*.jsonl
(picking whichever *.jsonl was modified most recently), finds the most
recent assistant message's `usage` block, and sums the three input-side
token fields (input_tokens + cache_creation_input_tokens +
cache_read_input_tokens) — that sum is the actual context size at the last
API call. This is a real reading, not a byte-count guess.

Usage:
    python3 .claude/minify-lab/check-context.py [--threshold N] [--file PATH]

Default threshold is 300000 (this project's auto-compact setting).
"""
import argparse
import glob
import json
import os
import sys


def project_transcript_dir():
    slug = os.getcwd().replace(os.sep, "-")
    return os.path.join(os.path.expanduser("~"), ".claude", "projects", slug)


def latest_transcript(transcript_dir):
    files = glob.glob(os.path.join(transcript_dir, "*.jsonl"))
    if not files:
        return None
    return max(files, key=os.path.getmtime)


def last_usage(path):
    usage = None
    with open(path, "r", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            msg = obj.get("message") if isinstance(obj, dict) else None
            if isinstance(msg, dict) and msg.get("usage"):
                usage = msg["usage"]
    return usage


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--threshold", type=int, default=300_000,
                     help="auto-compact token threshold (default 300000)")
    ap.add_argument("--file", help="explicit transcript path (skips auto-discovery)")
    args = ap.parse_args()

    path = args.file
    if not path:
        d = project_transcript_dir()
        path = latest_transcript(d)
        if not path:
            print(f"No transcript found under {d}", file=sys.stderr)
            sys.exit(1)

    usage = last_usage(path)
    if not usage:
        print(f"No usage data yet in {path}", file=sys.stderr)
        sys.exit(1)

    context_tokens = (
        usage.get("input_tokens", 0)
        + usage.get("cache_creation_input_tokens", 0)
        + usage.get("cache_read_input_tokens", 0)
    )
    pct = context_tokens / args.threshold * 100
    headroom = args.threshold - context_tokens

    print(f"transcript:      {path}")
    print(f"context tokens:  {context_tokens:,}")
    print(f"threshold:       {args.threshold:,}")
    print(f"used:            {pct:.1f}%")
    print(f"headroom:        {headroom:,} tokens")


if __name__ == "__main__":
    main()
