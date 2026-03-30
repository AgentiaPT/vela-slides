#!/usr/bin/env python3
"""
harvest.py — Parse Claude Code JSONL session logs and extract token metrics.

Usage:
  python3 harvest.py <session.jsonl>                    # Single session
  python3 harvest.py <dir_with_jsonl_files>             # All sessions in dir
  python3 harvest.py <dir> --aggregate                  # Summary table
  python3 harvest.py <dir> --json                       # JSON output

JSONL format per line (Claude Code session log):
{
  "sessionId": "...",
  "message": {
    "role": "user|assistant",
    "model": "claude-sonnet-4-6-...",
    "content": [...],
    "usage": {
      "input_tokens": N,
      "output_tokens": N,
      "cache_creation_input_tokens": N,
      "cache_read_input_tokens": N
    }
  },
  "timestamp": "ISO-8601",
  "uuid": "..."
}
"""

import json
import sys
import os
from pathlib import Path
from datetime import datetime

# Pricing per million tokens (Sonnet 4.6, March 2026)
PRICING = {
    "input": 3.00,
    "output": 15.00,
    "cache_read": 0.30,
    "cache_write": 3.75,  # 1.25x input
}


def cost_usd(input_tok, output_tok, cache_read_tok, cache_write_tok):
    """Calculate cost in USD from token counts."""
    return (
        input_tok * PRICING["input"] / 1_000_000
        + output_tok * PRICING["output"] / 1_000_000
        + cache_read_tok * PRICING["cache_read"] / 1_000_000
        + cache_write_tok * PRICING["cache_write"] / 1_000_000
    )


def extract_trajectory(turns, tool_results):
    """Extract trajectory-level metrics from parsed turns and tool results."""
    # Build full tool sequence
    tool_sequence = []
    for t in turns:
        for tc in t.get("tool_calls", []):
            tool_sequence.append(tc)

    # Error count from tool results
    error_count = sum(1 for r in tool_results if r.get("is_error"))

    # Retry detection: consecutive identical tool names
    retry_count = 0
    for i in range(1, len(tool_sequence)):
        if tool_sequence[i] == tool_sequence[i - 1]:
            retry_count += 1

    # Validation discipline
    vela_calls = [t for t in tool_sequence if "vela" in t.lower()]
    validated = any("validate" in t or "ship" in t for t in vela_calls)
    shipped = any("ship" in t for t in vela_calls)

    # Bash command analysis
    bash_commands = []
    for t in turns:
        for cmd in t.get("bash_commands", []):
            bash_commands.append(cmd)

    # Batch vs individual operations
    batch_ops = sum(1 for c in bash_commands if "batch" in c.lower())
    individual_ops = sum(1 for c in bash_commands
                         if "slide edit" in c.lower() or "slide remove" in c.lower())

    return {
        "tool_sequence": tool_sequence,
        "unique_tools": len(set(tool_sequence)),
        "total_tool_calls": len(tool_sequence),
        "error_count": error_count,
        "retry_count": retry_count,
        "validated": validated,
        "shipped": shipped,
        "vela_calls": vela_calls,
        "batch_ops": batch_ops,
        "individual_ops": individual_ops,
        "first_attempt_success": error_count == 0,
    }


def parse_jsonl(path):
    """Parse a JSONL session file and extract per-turn metrics."""
    turns = []
    all_tool_results = []
    session_id = None
    seen_uuids = set()

    with open(path, encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            # Deduplicate by uuid if present
            uuid = entry.get("uuid")
            if uuid:
                if uuid in seen_uuids:
                    continue
                seen_uuids.add(uuid)

            if not session_id:
                session_id = entry.get("sessionId", "unknown")

            msg = entry.get("message", {})
            role = msg.get("role", entry.get("type", ""))
            usage = msg.get("usage", {})
            content = msg.get("content", [])
            timestamp = entry.get("timestamp", "")

            # Count tool calls in this message
            tool_calls = []
            bash_commands = []
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "tool_use":
                        name = block.get("name", "unknown")
                        tool_calls.append(name)
                        # Extract bash command prefix for Bash tool calls
                        if name == "Bash":
                            cmd = block.get("input", {}).get("command", "")
                            if cmd:
                                # Take first line, truncate to 80 chars
                                prefix = cmd.split("\n")[0][:80]
                                bash_commands.append(prefix)
                                # Annotate tool name with command context
                                if "vela" in prefix.lower():
                                    tool_calls[-1] = f"Bash:vela {prefix.split('vela')[-1].strip()[:40]}"
                    elif isinstance(block, dict) and block.get("type") == "tool_result":
                        all_tool_results.append({
                            "is_error": block.get("is_error", False),
                        })

            input_tok = usage.get("input_tokens", 0)
            output_tok = usage.get("output_tokens", 0)
            cache_read = usage.get("cache_read_input_tokens", 0)
            cache_write = usage.get("cache_creation_input_tokens", 0)

            # Only count turns with actual usage data
            if input_tok or output_tok:
                turns.append({
                    "turn": len(turns) + 1,
                    "role": role,
                    "model": msg.get("model", ""),
                    "timestamp": timestamp,
                    "input_tokens": input_tok,
                    "output_tokens": output_tok,
                    "cache_read_tokens": cache_read,
                    "cache_write_tokens": cache_write,
                    "cost_usd": cost_usd(input_tok, output_tok, cache_read, cache_write),
                    "tool_calls": tool_calls,
                    "tool_count": len(tool_calls),
                    "bash_commands": bash_commands,
                })

    # Compute session summary
    total_input = sum(t["input_tokens"] for t in turns)
    total_output = sum(t["output_tokens"] for t in turns)
    total_cache_read = sum(t["cache_read_tokens"] for t in turns)
    total_cache_write = sum(t["cache_write_tokens"] for t in turns)
    total_cost = sum(t["cost_usd"] for t in turns)
    total_tools = sum(t["tool_count"] for t in turns)

    # Time span
    timestamps = [t["timestamp"] for t in turns if t["timestamp"]]
    duration_s = 0
    if len(timestamps) >= 2:
        try:
            t0 = datetime.fromisoformat(timestamps[0].replace("Z", "+00:00"))
            t1 = datetime.fromisoformat(timestamps[-1].replace("Z", "+00:00"))
            duration_s = (t1 - t0).total_seconds()
        except (ValueError, TypeError):
            pass

    # Trajectory analysis
    trajectory = extract_trajectory(turns, all_tool_results)

    return {
        "session_id": session_id,
        "file": str(path),
        "turns": len(turns),
        "turn_details": turns,
        "totals": {
            "input_tokens": total_input,
            "output_tokens": total_output,
            "cache_read_tokens": total_cache_read,
            "cache_write_tokens": total_cache_write,
            "total_tokens": total_input + total_output + total_cache_read + total_cache_write,
            "cost_usd": round(total_cost, 6),
            "tool_calls": total_tools,
            "duration_s": round(duration_s, 1),
        },
        "trajectory": trajectory,
    }


def print_session(result):
    """Pretty-print a single session's metrics."""
    t = result["totals"]
    print(f"\n{'═' * 60}")
    print(f"  Session: {result['session_id']}")
    print(f"  File:    {result['file']}")
    print(f"  Turns:   {result['turns']} | Duration: {t['duration_s']}s")
    print(f"{'═' * 60}")
    print(f"  {'Turn':>4}  {'Role':<10} {'Input':>8} {'Output':>8} {'Cache R':>8} {'Cache W':>8} {'Cost':>8}  Tools")
    print(f"  {'─' * 4}  {'─' * 10} {'─' * 8} {'─' * 8} {'─' * 8} {'─' * 8} {'─' * 8}  {'─' * 15}")

    for turn in result["turn_details"]:
        tools_str = ", ".join(turn["tool_calls"][:3])
        if len(turn["tool_calls"]) > 3:
            tools_str += f" +{len(turn['tool_calls']) - 3}"
        print(
            f"  {turn['turn']:>4}  {turn['role']:<10}"
            f" {turn['input_tokens']:>8,}"
            f" {turn['output_tokens']:>8,}"
            f" {turn['cache_read_tokens']:>8,}"
            f" {turn['cache_write_tokens']:>8,}"
            f" ${turn['cost_usd']:>7.4f}"
            f"  {tools_str}"
        )

    print(f"  {'─' * 4}  {'─' * 10} {'─' * 8} {'─' * 8} {'─' * 8} {'─' * 8} {'─' * 8}")
    print(
        f"  {'SUM':>4}  {'':10}"
        f" {t['input_tokens']:>8,}"
        f" {t['output_tokens']:>8,}"
        f" {t['cache_read_tokens']:>8,}"
        f" {t['cache_write_tokens']:>8,}"
        f" ${t['cost_usd']:>7.4f}"
        f"  {t['tool_calls']} calls"
    )
    print()


def print_aggregate(results):
    """Print comparison table across sessions."""
    print(f"\n{'═' * 90}")
    print(f"  AGGREGATE — {len(results)} sessions")
    print(f"{'═' * 90}")
    print(f"  {'Session':<30} {'Turns':>5} {'Input':>9} {'Output':>9} {'Cache R':>9} {'Cost $':>9} {'Time':>7} {'Tools':>5}")
    print(f"  {'─' * 30} {'─' * 5} {'─' * 9} {'─' * 9} {'─' * 9} {'─' * 9} {'─' * 7} {'─' * 5}")

    total_cost = 0
    for r in results:
        t = r["totals"]
        label = Path(r["file"]).stem[:30]
        print(
            f"  {label:<30}"
            f" {r['turns']:>5}"
            f" {t['input_tokens']:>9,}"
            f" {t['output_tokens']:>9,}"
            f" {t['cache_read_tokens']:>9,}"
            f" ${t['cost_usd']:>8.4f}"
            f" {t['duration_s']:>6.0f}s"
            f" {t['tool_calls']:>5}"
        )
        total_cost += t["cost_usd"]

    print(f"  {'─' * 30} {'─' * 5} {'─' * 9} {'─' * 9} {'─' * 9} {'─' * 9} {'─' * 7} {'─' * 5}")
    print(f"  {'TOTAL':<30} {'':>5} {'':>9} {'':>9} {'':>9} ${total_cost:>8.4f}")
    print()


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 harvest.py <session.jsonl|dir> [--aggregate] [--json]", file=sys.stderr)
        sys.exit(1)

    target = sys.argv[1]
    do_json = "--json" in sys.argv
    do_aggregate = "--aggregate" in sys.argv

    paths = []
    if os.path.isdir(target):
        paths = sorted(Path(target).glob("*.jsonl"))
    elif os.path.isfile(target):
        paths = [Path(target)]
    else:
        print(f"Not found: {target}", file=sys.stderr)
        sys.exit(1)

    results = []
    for p in paths:
        r = parse_jsonl(p)
        if r["turns"] > 0:
            results.append(r)

    if do_json:
        # Strip turn_details for aggregate, keep for single
        if do_aggregate:
            output = [{"session_id": r["session_id"], "file": r["file"], "turns": r["turns"], "totals": r["totals"]} for r in results]
        else:
            output = results
        print(json.dumps(output, indent=2, ensure_ascii=False))
    elif do_aggregate:
        print_aggregate(results)
    else:
        for r in results:
            print_session(r)


if __name__ == "__main__":
    main()
