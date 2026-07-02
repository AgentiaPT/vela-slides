#!/usr/bin/env python3
"""Extract real sprint stats for the burndown, retro, and a per-phase cost drill-down.
Data availability depends on the agent profile, so every source degrades gracefully:

  git    (almost always)  -> commit timeline, messages, test-file churn
  transcript jsonl (profile-specific path) -> tool calls, sub-agents, errors, per-event
                                              timestamps, per-message token usage + $ cost,
                                              bucketed into phases  [claude-code-cloud-*]
  task list / token budget -> often NOT available headless; skipped if absent

CAVEAT (cost): the transcript's `usage` covers the MAIN orchestrator loop only. Sub-agent
(recon / bug-hunt) token usage lives in separate agent-*.jsonl transcripts, so the
per-phase cost below is orchestrator cost; fan-out (sub-agent count) is reported alongside.

Phases are inferred per assistant turn from the tools it used (heuristic, tune PHASE_RULES):
  recon | implement | bug-hunt | bug-fix | demo | other

Usage:
  python3 sprint-stats.py [--transcript <path>] [--since <git-rev>] [--json out.json] \
                          [--price-in 5 --price-out 25 --price-cw 6.25 --price-cr 0.5]

Default pricing = Claude Opus 4.8 per-MTok (input 5 / output 25 / cache-write 6.25 /
cache-read 0.5). Override for other models. Prints a human summary + optional JSON.
"""
import json, subprocess, sys, os, datetime as dt, argparse

# Per-million-token USD. Opus 4.8 default; override via flags for other models.
PRICE = {"in": 5.0, "out": 25.0, "cw": 6.25, "cr": 0.5}

def classify(text):
    t = text.lower()
    if "bug-hunt" in t or "adversarial" in t or "bug hunt" in t: return "bug-hunt"
    if "map " in t or "explore the" in t or "recon" in t: return "recon"
    if "demo" in t or "deck.js" in t or "record-demo" in t or "play-deck" in t or "scenario" in t \
       or "webm" in t or "ffmpeg" in t or "render-offline" in t or "pdftoppm" in t or "sprint-stats" in t:
        return "demo"
    if '"git commit' in t and ("fix(" in t or "fix:" in t): return "bug-fix"
    return "implement"

def sh(*a):
    try: return subprocess.run(a, capture_output=True, text=True, timeout=30).stdout
    except Exception: return ""

def git_stats(since):
    log = sh("git", "log", "--reverse", "--format=%aI\t%s", (f"{since}..HEAD" if since else "-40"))
    commits = []
    for line in log.splitlines():
        if "\t" not in line: continue
        iso, subj = line.split("\t", 1)
        commits.append({"t": iso, "subject": subj, "is_fix": subj.startswith("fix"), "is_test": subj.startswith("test")})
    return {"commits": commits, "n_commits": len(commits),
            "n_fix": sum(c["is_fix"] for c in commits), "n_test": sum(c["is_test"] for c in commits)}

def cost(u):
    return (u["in"] * PRICE["in"] + u["out"] * PRICE["out"] + u["cw"] * PRICE["cw"] + u["cr"] * PRICE["cr"]) / 1e6

def transcript_stats(path):
    if not path or not os.path.exists(path): return {"available": False}
    ORDER = ["recon", "implement", "bug-hunt", "bug-fix", "demo", "other"]
    ph = {k: {"turns": 0, "tools": 0, "errors": 0, "in": 0, "out": 0, "cw": 0, "cr": 0} for k in ORDER}
    agents = {"recon": 0, "bug-hunt": 0, "other": 0}
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
        m = o.get("message") or {}
        c = m.get("content")
        if o.get("type") == "assistant" and isinstance(m, dict):
            phase = classify(json.dumps(c)) if isinstance(c, list) else "other"
            u = m.get("usage") or {}
            b = ph[phase]; b["turns"] += 1
            b["in"] += u.get("input_tokens", 0); b["out"] += u.get("output_tokens", 0)
            b["cw"] += u.get("cache_creation_input_tokens", 0); b["cr"] += u.get("cache_read_input_tokens", 0)
            if isinstance(c, list):
                for x in c:
                    if isinstance(x, dict) and x.get("type") == "tool_use":
                        b["tools"] += 1
                        if x.get("name") == "Agent":
                            d = ((x.get("input") or {}).get("description") or "") + " " + ((x.get("input") or {}).get("prompt") or "")
                            k = "bug-hunt" if ("bug-hunt" in d.lower() or "adversarial" in d.lower()) else ("recon" if ("map" in d.lower() or "explore" in d.lower()) else "other")
                            agents[k] += 1
        if isinstance(c, list):  # tool_result errors, attributed to the preceding turn's phase is hard; count globally
            for x in c:
                if isinstance(x, dict) and x.get("type") == "tool_result" and x.get("is_error"):
                    ph["other"]["errors"] += 1  # global error tally lands here
    for k in ORDER:
        ph[k]["cost"] = round(cost(ph[k]), 2)
        ph[k]["out_k"] = round(ph[k]["out"] / 1000)
    span = round((last - first).total_seconds() / 60) if first and last else None
    total_cost = round(sum(ph[k]["cost"] for k in ORDER), 2)
    return {"available": True, "span_min": span, "phases": ph, "order": ORDER,
            "agents": agents, "total_cost": total_cost, "pricing": PRICE,
            "first": first.isoformat() if first else None, "last": last.isoformat() if last else None}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--transcript"); ap.add_argument("--since"); ap.add_argument("--json")
    for k in PRICE: ap.add_argument(f"--price-{k}", type=float)
    a = ap.parse_args()
    for k in PRICE:
        v = getattr(a, f"price_{k}")
        if v is not None: PRICE[k] = v
    out = {"git": git_stats(a.since), "transcript": transcript_stats(a.transcript)}
    g, tr = out["git"], out["transcript"]
    print(f"commits: {g['n_commits']} (fix {g['n_fix']}, test {g['n_test']})")
    if tr.get("available"):
        print(f"session span: {tr['span_min']} min | sub-agents: recon {tr['agents']['recon']}, hunt {tr['agents']['bug-hunt']} | est. orchestrator cost ${tr['total_cost']}")
        print(f"\n{'phase':<11}{'turns':>6}{'tools':>6}{'out_tok':>9}{'cost$':>8}   (main loop; Opus 4.8 pricing)")
        for k in tr["order"]:
            p = tr["phases"][k]
            if p["turns"] or p["tools"]:
                print(f"{k:<11}{p['turns']:>6}{p['tools']:>6}{p['out_k']:>8}k{p['cost']:>8}")
    else:
        print("transcript: not available on this profile — git-only stats")
    if a.json:
        json.dump(out, open(a.json, "w"), indent=2); print("\nwrote", a.json)

if __name__ == "__main__":
    main()
