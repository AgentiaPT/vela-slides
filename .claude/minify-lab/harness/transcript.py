#!/usr/bin/env python3
"""
transcript.py — normalize a `claude -p --output-format stream-json` JSONL
transcript into `events.json` + `metrics.json` + `final-answer.txt`.

Port of evals/scripts/harvest.py's parser (dedupe by `uuid`, walk
`message.content`, sum `usage.*`, derive duration from ISO timestamps, count
`is_error` results, detect consecutive-identical-tool retries) EXTENDED per
harness-design.md §8.2: harvest.py discards `tool_use.input` beyond an
80-char Bash prefix; this module keeps the full input, because
`assertions.py`'s `read_before_edit` (§9.3) needs `file_path`, `offset`,
`limit`, `pattern` verbatim.

Usage:
  python3 transcript.py <transcript.jsonl> --out-dir <run_dir>
  python3 transcript.py <transcript.jsonl> --json      # events to stdout
  python3 transcript.py --selftest
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

HARNESS_DIR = Path(__file__).resolve().parent


def _load_config():
    try:
        import yaml
        cfg_path = HARNESS_DIR / "config.yaml"
        if cfg_path.exists():
            with open(cfg_path, encoding="utf-8") as f:
                return yaml.safe_load(f) or {}
    except ImportError:
        pass
    return {}


def cost_usd(model, input_tok, output_tok, cache_read_tok, cache_write_tok, pricing):
    p = pricing.get(model, pricing.get("sonnet", {}))
    return (
        input_tok * p.get("input", 0) / 1_000_000
        + output_tok * p.get("output", 0) / 1_000_000
        + cache_read_tok * p.get("cache_read", 0) / 1_000_000
        + cache_write_tok * p.get("cache_write", 0) / 1_000_000
    )


def _model_family(model_name):
    """Map a full model id to the pricing table's short key."""
    if not model_name:
        return "sonnet"
    m = model_name.lower()
    if "opus" in m:
        return "opus"
    if "haiku" in m:
        return "haiku"
    return "sonnet"


def parse_jsonl(path, pricing=None, hooks_mode="parity"):
    """Parse a stream-json JSONL transcript into normalized events + metrics.

    Returns (events, metrics, final_answer_text).
    """
    pricing = pricing or {}
    events = []
    seen_uuids = set()
    index = 0

    input_tok = output_tok = cache_read_tok = cache_write_tok = 0
    cost_total = 0.0
    error_count = 0
    retry_count = 0
    hook_firings = []
    timestamps = []
    timed_out = False
    agent_committed = False
    final_answer_parts = []
    last_tool_name = None

    with open(path, encoding="utf-8") as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                # a truncated final line (e.g. process killed mid-write) —
                # record and move on rather than crash the whole parse.
                timed_out = True
                continue

            uuid = entry.get("uuid")
            if uuid:
                if uuid in seen_uuids:
                    continue
                seen_uuids.add(uuid)

            ts = entry.get("timestamp")
            if ts:
                timestamps.append(ts)

            via_subagent = bool(entry.get("parentToolUseId") or entry.get("isSidechain"))

            msg = entry.get("message", {})
            role = msg.get("role", entry.get("type", ""))
            model = msg.get("model", "")
            usage = msg.get("usage", {})
            content = msg.get("content", [])

            if isinstance(content, str):
                content = [{"type": "text", "text": content}]

            if usage:
                it = usage.get("input_tokens", 0)
                ot = usage.get("output_tokens", 0)
                crt = usage.get("cache_read_input_tokens", 0)
                cwt = usage.get("cache_creation_input_tokens", 0)
                input_tok += it
                output_tok += ot
                cache_read_tok += crt
                cache_write_tok += cwt
                cost_total += cost_usd(_model_family(model), it, ot, crt, cwt, pricing)

            if not isinstance(content, list):
                continue

            for block in content:
                if not isinstance(block, dict):
                    continue
                btype = block.get("type")

                if btype == "tool_use":
                    name = block.get("name", "unknown")
                    tool_input = block.get("input", {})
                    events.append({
                        "index": index,
                        "role": role,
                        "kind": "tool_use",
                        "name": name,
                        "input": tool_input,
                        "result": None,
                        "via_subagent": via_subagent,
                        "hook_blocked": False,
                        "timestamp": ts,
                        "tool_use_id": block.get("id"),
                    })
                    if name == last_tool_name:
                        retry_count += 1
                    last_tool_name = name
                    if name == "Bash":
                        cmd = tool_input.get("command", "")
                        if any(marker in cmd for marker in ("git commit", "git push")):
                            agent_committed = True
                    index += 1

                elif btype == "tool_result":
                    is_error = bool(block.get("is_error", False))
                    result_content = block.get("content", "")
                    if isinstance(result_content, list):
                        text_parts = [c.get("text", "") for c in result_content
                                      if isinstance(c, dict) and c.get("type") == "text"]
                        result_text = "\n".join(text_parts)
                    else:
                        result_text = str(result_content)

                    hook_blocked = is_error and (
                        "PreToolUse" in result_text or "hook" in result_text.lower()
                        and "exit code 2" in result_text.lower()
                    )

                    # attach to the most recent matching tool_use event
                    tool_use_id = block.get("tool_use_id")
                    matched = None
                    for e in reversed(events):
                        if e["kind"] == "tool_use" and e.get("tool_use_id") == tool_use_id:
                            matched = e
                            break
                    if matched is None and events:
                        for e in reversed(events):
                            if e["kind"] == "tool_use" and e["result"] is None:
                                matched = e
                                break
                    if matched is not None:
                        matched["result"] = {
                            "is_error": is_error,
                            "empty": (result_text.strip() == ""),
                            "bytes": len(result_text.encode("utf-8")),
                        }
                        matched["hook_blocked"] = hook_blocked

                    if is_error:
                        error_count += 1
                    if hook_blocked:
                        hook_firings.append({
                            "index": matched["index"] if matched else index,
                            "tool": matched["name"] if matched else "unknown",
                            "stderr_excerpt": result_text[:300],
                        })

                elif btype == "text" and role == "assistant":
                    text = block.get("text", "")
                    if text:
                        final_answer_parts.append(text)
                    events.append({
                        "index": index, "role": role, "kind": "text",
                        "name": None, "input": None, "result": None,
                        "text": text, "via_subagent": via_subagent,
                        "hook_blocked": False, "timestamp": ts,
                    })
                    index += 1

    duration_s = 0.0
    if len(timestamps) >= 2:
        try:
            t0 = datetime.fromisoformat(timestamps[0].replace("Z", "+00:00"))
            t1 = datetime.fromisoformat(timestamps[-1].replace("Z", "+00:00"))
            duration_s = (t1 - t0).total_seconds()
        except (ValueError, TypeError):
            pass

    tool_events = [e for e in events if e["kind"] == "tool_use"]
    turns = len([e for e in events if e["kind"] == "text" and e["role"] == "assistant"]) or len(tool_events)

    metrics = {
        "turns": turns,
        "input_tokens": input_tok,
        "output_tokens": output_tok,
        "cache_read_tokens": cache_read_tok,
        "cache_write_tokens": cache_write_tok,
        "cost_usd": round(cost_total, 6),
        "tool_calls": len(tool_events),
        "unique_tools": len({e["name"] for e in tool_events}),
        "error_count": error_count,
        "retry_count": retry_count,
        "duration_s": round(duration_s, 1),
        "hook_firings": hook_firings,
        "timed_out": timed_out,
        "agent_committed": agent_committed,
        "hooks_mode": hooks_mode,
    }

    final_answer = final_answer_parts[-1] if final_answer_parts else ""

    return events, metrics, final_answer


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("transcript", nargs="?")
    ap.add_argument("--out-dir")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--hooks-mode", default="parity")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if args.selftest:
        ok = _selftest()
        sys.exit(0 if ok else 1)

    if not args.transcript:
        ap.print_usage(sys.stderr)
        sys.exit(2)

    config = _load_config()
    pricing = config.get("pricing", {})

    events, metrics, final_answer = parse_jsonl(args.transcript, pricing, args.hooks_mode)

    if args.out_dir:
        out = Path(args.out_dir)
        out.mkdir(parents=True, exist_ok=True)
        with open(out / "events.json", "w", encoding="utf-8") as f:
            json.dump(events, f, indent=2)
        with open(out / "metrics.json", "w", encoding="utf-8") as f:
            json.dump(metrics, f, indent=2)
        with open(out / "final-answer.txt", "w", encoding="utf-8") as f:
            f.write(final_answer)
        print(f"wrote events.json ({len(events)} events), metrics.json, final-answer.txt to {out}")
    elif args.json:
        print(json.dumps({"events": events, "metrics": metrics, "final_answer": final_answer}, indent=2))
    else:
        print(json.dumps(metrics, indent=2))


# ── self-test (§14.2) ──────────────────────────────────────────────────

def _write_jsonl(path, entries):
    with open(path, "w", encoding="utf-8") as f:
        for e in entries:
            f.write(json.dumps(e) + "\n")


def _msg(uuid, role, content, usage=None, ts="2026-08-13T00:00:00Z", model="claude-sonnet-4-20250514"):
    return {
        "uuid": uuid, "timestamp": ts,
        "message": {"role": role, "model": model, "content": content, "usage": usage or {}},
    }


def _selftest():
    import tempfile

    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        status = "OK" if cond else "FAIL"
        if not cond:
            ok = False
        print(f"  [{status}] {name}" + (f" — {detail}" if detail and not cond else ""))

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)

        # 1. normal run: a read, an edit, token sums
        normal = [
            _msg("u1", "assistant", [
                {"type": "tool_use", "id": "t1", "name": "Read",
                 "input": {"file_path": "src/parts/part-reducer.jsx", "offset": 1, "limit": 60}},
            ], usage={"input_tokens": 100, "output_tokens": 20}),
            _msg("u2", "user", [
                {"type": "tool_result", "tool_use_id": "t1", "is_error": False,
                 "content": [{"type": "text", "text": "const NO_HISTORY = new Set([...])"}]},
            ]),
            _msg("u3", "assistant", [
                {"type": "tool_use", "id": "t2", "name": "Edit",
                 "input": {"file_path": "src/parts/part-reducer.jsx", "old_string": "a", "new_string": "b"}},
            ], usage={"input_tokens": 150, "output_tokens": 30}),
            _msg("u4", "user", [
                {"type": "tool_result", "tool_use_id": "t2", "is_error": False, "content": "ok"},
            ]),
            _msg("u5", "assistant", [{"type": "text", "text": "Done."}], usage={"input_tokens": 10, "output_tokens": 5}),
        ]
        p1 = tmp / "normal.jsonl"
        _write_jsonl(p1, normal)
        events, metrics, final = parse_jsonl(p1)
        check("token sums correct", metrics["input_tokens"] == 260 and metrics["output_tokens"] == 55,
              str(metrics))
        check("tool_use.input survives (file_path)",
              any(e["kind"] == "tool_use" and e["input"].get("file_path") == "src/parts/part-reducer.jsx"
                  for e in events))
        check("tool_use.input survives (offset/limit)",
              any(e["kind"] == "tool_use" and e["input"].get("offset") == 1 and e["input"].get("limit") == 60
                  for e in events))
        check("final answer captured", final == "Done.", final)
        check("no errors in normal run", metrics["error_count"] == 0)

        # 2. hook-blocked edit
        hook_blocked = [
            _msg("h1", "assistant", [
                {"type": "tool_use", "id": "t1", "name": "Edit",
                 "input": {"file_path": "src/parts/part-pptx.jsx"}},
            ], usage={"input_tokens": 50, "output_tokens": 10}),
            _msg("h2", "user", [
                {"type": "tool_result", "tool_use_id": "t1", "is_error": True,
                 "content": [{"type": "text", "text": "PreToolUse hook blocked (exit code 2): read the "
                                                        "secure-coding SKILL.md first"}]},
            ]),
        ]
        p2 = tmp / "hookblocked.jsonl"
        _write_jsonl(p2, hook_blocked)
        events2, metrics2, _ = parse_jsonl(p2)
        check("hook-blocked edit counted as error", metrics2["error_count"] == 1)
        check("hook_firings recorded", len(metrics2["hook_firings"]) == 1, str(metrics2["hook_firings"]))
        edit_event = next(e for e in events2 if e["kind"] == "tool_use")
        check("hook_blocked flag set on the event", edit_event["hook_blocked"] is True)

        # 3. subagent tool call
        subagent = [
            {**_msg("s1", "assistant", [
                {"type": "tool_use", "id": "t1", "name": "Skill", "input": {"skill": "vela-secure-coding"}},
             ], usage={"input_tokens": 20, "output_tokens": 5}),
             "parentToolUseId": "parent-task-1"},
        ]
        p3 = tmp / "subagent.jsonl"
        _write_jsonl(p3, subagent)
        events3, _, _ = parse_jsonl(p3)
        check("subagent tool call flagged via_subagent", events3[0]["via_subagent"] is True)

        # 4. duplicate uuid dedupe
        dupe = [
            _msg("d1", "assistant", [{"type": "text", "text": "first"}], usage={"input_tokens": 5, "output_tokens": 1}),
            _msg("d1", "assistant", [{"type": "text", "text": "first-dupe"}], usage={"input_tokens": 999, "output_tokens": 999}),
        ]
        p4 = tmp / "dupe.jsonl"
        _write_jsonl(p4, dupe)
        _, metrics4, _ = parse_jsonl(p4)
        check("duplicate uuid deduped (tokens not double-counted)", metrics4["input_tokens"] == 5, str(metrics4))

        # 5. truncated/timeout transcript (malformed trailing line)
        p5 = tmp / "truncated.jsonl"
        with open(p5, "w", encoding="utf-8") as f:
            f.write(json.dumps(normal[0]) + "\n")
            f.write('{"uuid": "broken", "message": {"role": "assistant", "content": [{"type": "tex')
        events5, metrics5, _ = parse_jsonl(p5)
        check("truncated trailing line does not crash the parser", len(events5) >= 1)
        check("truncated transcript flagged timed_out-ish", metrics5["timed_out"] is True)

        # 6. retry detection: consecutive identical tool names
        retry = [
            _msg("r1", "assistant", [{"type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "ls"}}]),
            _msg("r2", "user", [{"type": "tool_result", "tool_use_id": "t1", "is_error": True, "content": "err"}]),
            _msg("r3", "assistant", [{"type": "tool_use", "id": "t2", "name": "Bash", "input": {"command": "ls"}}]),
            _msg("r4", "user", [{"type": "tool_result", "tool_use_id": "t2", "is_error": False, "content": "ok"}]),
        ]
        p6 = tmp / "retry.jsonl"
        _write_jsonl(p6, retry)
        _, metrics6, _ = parse_jsonl(p6)
        check("consecutive-identical-tool retry detected", metrics6["retry_count"] == 1, str(metrics6))

        # 7. agent_committed detection
        committed = [
            _msg("c1", "assistant", [{"type": "tool_use", "id": "t1", "name": "Bash",
                                       "input": {"command": "git commit -m 'x'"}}]),
        ]
        p7 = tmp / "committed.jsonl"
        _write_jsonl(p7, committed)
        _, metrics7, _ = parse_jsonl(p7)
        check("agent_committed flag set on git commit", metrics7["agent_committed"] is True)

        # out-dir writing
        out_dir = tmp / "rundir"
        events, metrics, final = parse_jsonl(p1)
        out_dir.mkdir()
        with open(out_dir / "events.json", "w", encoding="utf-8") as f:
            json.dump(events, f)
        check("events.json is JSON-serializable", True)

    if ok:
        print("transcript.py --selftest: ALL OK")
    else:
        print("transcript.py --selftest: FAILURES ABOVE")
    return ok


if __name__ == "__main__":
    main()
