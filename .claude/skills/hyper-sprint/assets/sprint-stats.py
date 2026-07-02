#!/usr/bin/env python3
"""Extract real sprint stats for the burndown + retro. Data availability depends on the
agent profile, so every source degrades gracefully:

  git    (almost always)  -> commit timeline, messages, test-file churn
  transcript jsonl (profile-specific path) -> tool calls, sub-agents, errors, per-event
                                              timestamps, user turns  [claude-code-cloud-*]
  task list / token usage  -> often NOT available headless; skipped if absent

Usage:
  python3 sprint-stats.py [--since <git-rev>] [--transcript <path>] [--json out.json]

On claude-code-cloud-default the transcript lives under
~/.claude/projects/<slug>/<session>.jsonl — pass it explicitly if you have it.
Prints a human summary and (optionally) writes JSON you can feed into the demo deck.
"""
import json, subprocess, sys, os, datetime as dt, argparse

def sh(*a):
    try: return subprocess.run(a, capture_output=True, text=True, timeout=30).stdout
    except Exception: return ""

def git_stats(since):
    rng = f"{since}..HEAD" if since else "-40"
    log = sh("git", "log", "--reverse", "--format=%aI\t%s", *( [rng] if since else [rng] ))
    commits = []
    for line in log.splitlines():
        if "\t" not in line: continue
        iso, subj = line.split("\t", 1)
        try: t = dt.datetime.fromisoformat(iso)
        except Exception: t = None
        commits.append({"t": iso, "subject": subj,
                        "is_fix": subj.startswith("fix"), "is_test": subj.startswith("test")})
    return {"commits": commits, "n_commits": len(commits),
            "n_fix": sum(c["is_fix"] for c in commits), "n_test": sum(c["is_test"] for c in commits)}

def transcript_stats(path):
    if not path or not os.path.exists(path): return {"available": False}
    tools, agents, errs, users = {}, [], 0, 0
    first = last = None
    def ts(o):
        s = o.get("timestamp")
        try: return dt.datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None
        except Exception: return None
    for line in open(path, errors="ignore"):
        try: o = json.loads(line)
        except Exception: continue
        t = ts(o)
        if t: first = first or t; last = t
        c = (o.get("message") or {}).get("content")
        if o.get("type") == "user" and isinstance(c, list) and any(isinstance(x, dict) and x.get("type") == "text" for x in c):
            users += 1
        if isinstance(c, list):
            for x in c:
                if isinstance(x, dict) and x.get("type") == "tool_use":
                    nm = x.get("name", "?"); tools[nm] = tools.get(nm, 0) + 1
                    if nm == "Agent":
                        d = ((x.get("input") or {}).get("description") or "")
                        p = ((x.get("input") or {}).get("prompt") or "").lower()
                        kind = "hunt" if ("bug-hunt" in d.lower() or "adversarial" in p) else ("recon" if ("map" in d.lower() or "explore" in p) else "other")
                        agents.append({"t": t.isoformat() if t else None, "kind": kind, "desc": d})
                if isinstance(x, dict) and x.get("type") == "tool_result" and x.get("is_error"):
                    errs += 1
    span_min = round((last - first).total_seconds() / 60) if first and last else None
    return {"available": True, "span_min": span_min,
            "first": first.isoformat() if first else None, "last": last.isoformat() if last else None,
            "tool_calls": sum(tools.values()), "tools": tools, "user_turns": users,
            "errors": errs, "n_agents": len(agents),
            "recon_agents": sum(a["kind"] == "recon" for a in agents),
            "hunt_agents": sum(a["kind"] == "hunt" for a in agents), "agents": agents}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since"); ap.add_argument("--transcript"); ap.add_argument("--json")
    a = ap.parse_args()
    out = {"git": git_stats(a.since), "transcript": transcript_stats(a.transcript)}
    g, tr = out["git"], out["transcript"]
    print(f"commits: {g['n_commits']}  (fix: {g['n_fix']}, test: {g['n_test']})")
    if tr.get("available"):
        print(f"session span: {tr['span_min']} min | tool calls: {tr['tool_calls']} | user turns: {tr['user_turns']} | tool errors: {tr['errors']}")
        print(f"sub-agents: {tr['n_agents']} (recon {tr['recon_agents']}, hunt {tr['hunt_agents']})")
        top = sorted(tr["tools"].items(), key=lambda x: -x[1])[:6]
        print("top tools:", ", ".join(f"{k}={v}" for k, v in top))
    else:
        print("transcript: not available on this profile — git-only stats")
    if a.json:
        json.dump(out, open(a.json, "w"), indent=2); print("wrote", a.json)

if __name__ == "__main__":
    main()
