#!/usr/bin/env python3
"""
snapshot.py — ccusage snapshot helper for isolated eval runs.

Usage (two-step, bash pipes ccusage output):
  # Before: pipe ccusage JSON in, saves snapshot
  ccusage session --json --since YYYYMMDD | python3 snapshot.py before

  # After: pipe ccusage JSON in, computes delta from saved snapshot
  ccusage session --json --since YYYYMMDD | python3 snapshot.py after
  ccusage session --json --since YYYYMMDD | python3 snapshot.py after --json

No subprocess calls — all external commands run in bash.
"""

import json, sys, os

SNAPSHOT_FILE = "/tmp/claude-1000/ccusage_snapshot.json"

def parse_subagent_usage(stdin_data):
    """Extract subagent session totals from ccusage JSON on stdin."""
    try:
        data = json.loads(stdin_data)
        for s in data.get("sessions", []):
            if s["sessionId"] == "subagents":
                return {
                    "cost": s["totalCost"],
                    "input": s["inputTokens"],
                    "output": s["outputTokens"],
                    "cache_read": s["cacheReadTokens"],
                    "cache_write": s["cacheCreationTokens"],
                }
    except (json.JSONDecodeError, KeyError):
        pass
    return {"cost": 0, "input": 0, "output": 0, "cache_read": 0, "cache_write": 0}

def cmd_before():
    usage = parse_subagent_usage(sys.stdin.read())
    os.makedirs(os.path.dirname(SNAPSHOT_FILE), exist_ok=True)
    with open(SNAPSHOT_FILE, "w", encoding="utf-8") as f:
        json.dump(usage, f)
    print(f"Snapshot saved: cost=${usage['cost']:.4f}")

def cmd_after():
    if not os.path.exists(SNAPSHOT_FILE):
        print("No snapshot found — run 'before' first", file=sys.stderr)
        sys.exit(1)
    with open(SNAPSHOT_FILE, encoding="utf-8") as f:
        before = json.load(f)
    after = parse_subagent_usage(sys.stdin.read())

    delta = {
        "cost_usd": round(after["cost"] - before["cost"], 6),
        "input_tokens": after["input"] - before["input"],
        "output_tokens": after["output"] - before["output"],
        "cache_read_tokens": after["cache_read"] - before["cache_read"],
        "cache_write_tokens": after["cache_write"] - before["cache_write"],
    }
    delta["total_tokens"] = (
        delta["input_tokens"] + delta["output_tokens"] +
        delta["cache_read_tokens"] + delta["cache_write_tokens"]
    )

    if "--json" in sys.argv:
        print(json.dumps(delta))
    else:
        print(f"Delta: cost=${delta['cost_usd']:.4f} "
              f"in={delta['input_tokens']:,} out={delta['output_tokens']:,} "
              f"cacheR={delta['cache_read_tokens']:,} cacheW={delta['cache_write_tokens']:,}")

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in ("before", "after"):
        print("Usage: ccusage ... | python3 snapshot.py before|after [--json]")
        sys.exit(1)
    if sys.argv[1] == "before":
        cmd_before()
    else:
        cmd_after()
