#!/usr/bin/env python3
"""Parse session transcripts (orchestrator + sub-agents) and compute real token cost
to the penny, broken down per-agent and per-model.

WHAT IT DOES
  Walks a transcript directory tree, reads each JSONL line, pulls the `usage` block
  off every assistant turn (input / output / cache-write / cache-read tokens + the
  `model` field), tiers the model against the editable PRICE table below, and sums
  cost per agent and per model tier. Prints a human table; `--json` also emits a
  machine-readable version so the cost/savings section of the Markdown sprint report
  (or, on the optional demo path, the demo-deck "cost" slide) can consume it directly.

CLAUDE-CODE TRANSCRIPT ASSUMPTION
  Defaults are shaped for Claude Code's on-disk transcript layout:
    ~/.claude/projects/<slug>/<session-id>.jsonl                  (orchestrator/main)
    ~/.claude/projects/<slug>/<session-id>/subagents/agent-*.jsonl (sub-agents)
  <slug> is normally the CWD with `/` replaced by `-`. This script auto-detects it
  from the current working directory, but you can always override with --project-dir,
  --main, --subagents-glob, or a plain list of --transcript paths — nothing here
  hard-depends on any one project existing.

TELEMETRY ADAPTER (non-Claude-Code stacks)
  Any other agent harness can still use this report: write a small adapter that
  reads your framework's own logs and re-emits one JSON object per turn shaped like
  `{"model": "...", "message": {"model": "...", "usage": {"input_tokens": N,
  "output_tokens": N, "cache_creation_input_tokens": N, "cache_read_input_tokens": N}}}`
  (or plain top-level `usage`/`model` keys — both are accepted), one per line, into a
  file per agent, then point `--transcript` / `--subagents-glob` at those files. The
  per-agent / per-model rollup and pricing logic are otherwise agent-framework-agnostic.

USAGE
  python3 sprint-cost.py                                   # auto-detect this project
  python3 sprint-cost.py --project-dir ~/.claude/projects/-home-user-foo
  python3 sprint-cost.py --main path/to/main.jsonl --transcript extra1.jsonl extra2.jsonl
  python3 sprint-cost.py --subagents-glob 'agents/agent-*.jsonl'
  python3 sprint-cost.py --roles roles.json             # optional agent-id -> role names
  python3 sprint-cost.py --json out.json                # machine-readable, to the cent

Exit codes: 0 success (even if some/all transcripts are missing — degrades gracefully
and reports what it found), 2 usage error.
"""
import argparse, glob, json, os, sys

# ---------------------------------------------------------------------------
# PRICING — edit this table when rates change or you add a model family.
# $ per MILLION tokens: (input, output, cache_write, cache_read).
# Update the tier's 4-tuple directly; add a new key + a substring match in
# tier() below for a new model family. cache_write is typically ~1.25x the
# input rate (5-minute cache) and cache_read is typically ~0.1x input (a 10x
# discount for a cache hit) — but always confirm against the current published
# rate card before trusting these; provider pricing changes over time and may
# include intro/promotional rates that expire on a stated date.
# ---------------------------------------------------------------------------
PRICE = {
    #           in     out    cache_write  cache_read
    "opus":    (5.00,  25.00,  6.25,        0.50),
    "sonnet":  (2.00,  10.00,  2.50,        0.20),
    "haiku":   (1.00,   5.00,  1.25,        0.10),
}
DEFAULT_TIER = "opus"  # fallback when a turn's model string doesn't match any tier


def tier(model):
    """Map a model id/string to a pricing tier by substring match."""
    m = (model or "").lower()
    for name in PRICE:
        if name in m:
            return name
    return DEFAULT_TIER


def cost_of(tok, t):
    pi, po, pw, pr = PRICE[t]
    return (tok["in"] / 1e6 * pi + tok["out"] / 1e6 * po
            + tok["cw"] / 1e6 * pw + tok["cr"] / 1e6 * pr)


def usage_of(rec):
    """Pull (model, in, out, cache_write, cache_read) off one transcript line.
    Accepts Claude-Code's {"message": {"model":..., "usage": {...}}} shape, or a
    flattened {"model":..., "usage": {...}} / top-level usage for adapters."""
    msg = rec.get("message") if isinstance(rec.get("message"), dict) else rec
    if not isinstance(msg, dict):
        return None
    u = msg.get("usage")
    if not isinstance(u, dict):
        u = rec.get("usage") if isinstance(rec.get("usage"), dict) else None
    if not isinstance(u, dict):
        return None
    model = msg.get("model") or rec.get("model")
    it = u.get("input_tokens", 0) or 0
    ot = u.get("output_tokens", 0) or 0
    cw = u.get("cache_creation_input_tokens", 0) or 0
    cr = u.get("cache_read_input_tokens", 0) or 0
    if it == 0 and ot == 0 and cw == 0 and cr == 0:
        return None
    return model, it, ot, cw, cr


def scan(path):
    """Return {tier: {in,out,cw,cr}} and call count for one transcript file."""
    agg, calls = {}, 0
    try:
        f = open(path, errors="ignore")
    except OSError:
        return agg, calls
    with f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            u = usage_of(rec)
            if not u:
                continue
            model, it, ot, cw, cr = u
            t = tier(model)
            a = agg.setdefault(t, {"in": 0, "out": 0, "cw": 0, "cr": 0})
            a["in"] += it; a["out"] += ot; a["cw"] += cw; a["cr"] += cr
            calls += 1
    return agg, calls


def default_project_dir():
    """Best-effort guess at the Claude-Code project dir from CWD. Callers should
    override with --project-dir when running this from somewhere other than the
    repo root, or when the transcript lives under a different account/home."""
    slug = os.getcwd().replace("/", "-")
    return os.path.join(os.path.expanduser("~/.claude/projects"), slug)


def discover(args):
    """Build the list of (label_hint, path) transcripts to scan."""
    paths = []
    if args.main:
        paths.append(args.main)
    if args.subagents_glob:
        paths += sorted(glob.glob(args.subagents_glob))
    if args.transcript:
        paths += args.transcript
    if not paths:
        proj = args.project_dir or default_project_dir()
        # Claude-Code layout: <proj>/<session>.jsonl is the main loop, and
        # <proj>/<session>/subagents/agent-*.jsonl are sub-agents. Without a
        # specific session id we take the most-recently-modified top-level
        # .jsonl as "main" and glob every subagents dir for the rest — this is
        # a convenience default, not a hard dependency (pass explicit paths on
        # any other layout).
        if os.path.isdir(proj):
            top = sorted(glob.glob(os.path.join(proj, "*.jsonl")),
                          key=lambda p: os.path.getmtime(p))
            if top:
                paths.append(top[-1])
            paths += sorted(glob.glob(os.path.join(proj, "*", "subagents", "agent-*.jsonl")))
    return paths


def agent_label(path, roles):
    base = os.path.basename(path)
    aid = base.replace("agent-", "").replace(".jsonl", "")
    if roles and aid in roles:
        return roles[aid]
    # main/orchestrator transcripts sit directly under the project dir (no
    # /subagents/ in the path) — label generically rather than by session id.
    if "subagents" not in path.replace("\\", "/"):
        return "orchestrator (main)"
    return aid


def load_roles(path):
    if not path:
        return {}
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def audit_transcript(path):
    """Context-bloat audit for a (usually orchestrator) transcript. Images and large
    tool-results are the un-evictable payloads that dominate cache-read in a long run:
    a pinned block is re-read on EVERY later turn, so its true cost is size x turns-survived.
    Returns a summary dict, or None if the transcript can't be read.

    Token sizes are estimates (from serialized length); the % is relative to the exact
    cache_read from usage, so the ranking is reliable even if absolute tokens are rough."""
    try:
        rows = [json.loads(l) for l in open(path) if l.strip()]
    except (OSError, json.JSONDecodeError):
        return None
    assistant_turns = 0
    total_cr = 0
    peak_ctx = 1         # largest live context (in+cw+cr) seen on any turn
    images = []          # (turn_index_seen, est_tokens)  — base64 ~ len//4 tokens
    big_results = []     # (turn_index_seen, est_tokens)
    for rec in rows:
        msg = rec.get("message") if isinstance(rec.get("message"), dict) else rec
        if isinstance(msg, dict) and msg.get("role") == "assistant":
            u = usage_of(rec)
            if u:  # u = (model, in, out, cache_write, cache_read)
                assistant_turns += 1
                total_cr += u[4]
                peak_ctx = max(peak_ctx, u[1] + u[3] + u[4])
        content = msg.get("content") if isinstance(msg, dict) else None
        if not isinstance(content, list):
            continue
        for b in content:
            if not isinstance(b, dict):
                continue
            if b.get("type") == "tool_result":
                cc = b.get("content")
                if isinstance(cc, list):
                    for bb in cc:
                        if isinstance(bb, dict) and bb.get("type") == "image":
                            data = (bb.get("source") or {}).get("data", "")
                            images.append((assistant_turns, max(1, len(data) // 4)))
                    approx = len(json.dumps(cc)) // 4
                elif isinstance(cc, str):
                    approx = len(cc) // 4
                else:
                    approx = 0
                if approx > 3000:
                    big_results.append((assistant_turns, approx))
            elif b.get("type") == "image":  # image pasted directly in a message
                data = (b.get("source") or {}).get("data", "")
                images.append((assistant_turns, max(1, len(data) // 4)))
    N = max(1, assistant_turns)
    img_tokens = sum(t for _, t in images)
    # Primary, bounded metric: images as a share of the PEAK standing context (they are
    # all still pinned at the end, so this is how much of the live window they occupy).
    img_pct_ctx = min(100, round(100 * img_tokens / peak_ctx)) if peak_ctx else 0
    # Secondary (estimate): cumulative cache-read attributable to images = size x turns
    # survived, vs total cache-read billed. Rough — depends on the token estimate above.
    img_exposure = sum(tok * (N - t) for t, tok in images)
    img_pct_cr = round(100 * img_exposure / total_cr) if total_cr else 0
    big_results.sort(key=lambda x: -x[1])
    return {
        "turns": assistant_turns, "cache_read": total_cr, "peak_context": peak_ctx,
        "images": len(images), "image_est_tokens": img_tokens,
        "image_pct_of_context": img_pct_ctx, "image_pct_of_cache_read_est": img_pct_cr,
        "big_tool_results": big_results[:8],
    }


def print_audit(rows_paths):
    print("\n" + "=" * 60)
    print("CONTEXT-BLOAT AUDIT  (--audit): un-evictable payloads pinned in the hub")
    print("=" * 60)
    any_main = False
    for label, path in rows_paths:
        if "orchestrator" not in label:
            continue  # audit the hub(s); sub-agents are isolated + short-lived
        a = audit_transcript(path)
        if not a:
            continue
        any_main = True
        print(f"\n{label}  ({path})")
        print(f"  assistant turns: {a['turns']:,}   cache_read: {a['cache_read']:,}"
              f"   peak context: {a['peak_context']:,}")
        flag = "  <-- images in the hub! delegate visual checks (see principle 3)" \
            if a["images"] else ""
        print(f"  images pinned:   {a['images']} (~{a['image_est_tokens']:,} tok) "
              f"= ~{a['image_pct_of_context']}% of standing context, "
              f"~{a['image_pct_of_cache_read_est']}% of cache-read (est){flag}")
        if a["big_tool_results"]:
            tops = ", ".join(f"~{tok:,}tok@turn{t}" for t, tok in a["big_tool_results"][:5])
            print(f"  largest pinned tool-results: {tops}")
    if not any_main:
        print("\n  (no orchestrator/main transcript identified to audit)")
    print("\n  Rule of thumb: any image in the hub, or images >=10% of cache-read, is a")
    print("  regression — the verifiers look; the hub reads their verdict. See")
    print("  references/context-economy.md.")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project-dir", help="Claude-Code project dir "
                     "(default: auto-detected from CWD under ~/.claude/projects)")
    ap.add_argument("--main", help="explicit path to the orchestrator/main transcript")
    ap.add_argument("--subagents-glob", help="glob for sub-agent transcripts, "
                     "e.g. 'agents/agent-*.jsonl'")
    ap.add_argument("--transcript", nargs="*", default=[],
                     help="one or more extra transcript paths (any role)")
    ap.add_argument("--roles", help="optional JSON file mapping agent-id -> role "
                     "name (e.g. {\"a1b2c3\": \"recon: auth\"}); falls back to the "
                     "raw id/filename when absent so this never depends on a "
                     "specific sprint's agent ids")
    ap.add_argument("--json", metavar="PATH", help="also write a machine-readable "
                     "report here (per-agent, per-model, grand total, tokens)")
    ap.add_argument("--audit", action="store_true", help="also print a context-bloat "
                     "audit of the orchestrator transcript(s): images pinned in the hub "
                     "and their cache-read share, plus the largest pinned tool-results")
    args = ap.parse_args()

    roles = load_roles(args.roles)
    paths = discover(args)
    if not paths:
        print("sprint-cost: no transcripts found (checked project-dir/--main/"
              "--subagents-glob/--transcript — pass one explicitly). "
              "See the module docstring for the telemetry-adapter note.",
              file=sys.stderr)
        # Not a hard error: a report with zero rows is still valid output.

    rows = []  # (label, total_cost, tokens{in,out,cw,cr}, calls, per_tier_agg)
    for path in paths:
        agg, calls = scan(path)
        if not agg:
            continue
        tot = sum(cost_of(tok, t) for t, tok in agg.items())
        tokens = {k: sum(tok[k] for tok in agg.values()) for k in ("in", "out", "cw", "cr")}
        rows.append((agent_label(path, roles), tot, tokens, calls, agg))

    rows.sort(key=lambda r: -r[1])
    grand = sum(r[1] for r in rows)
    GI = sum(r[2]["in"] for r in rows); GO = sum(r[2]["out"] for r in rows)
    GW = sum(r[2]["cw"] for r in rows); GR = sum(r[2]["cr"] for r in rows)
    grand_tok = GI + GO + GW + GR

    # per-model-tier rollup across all agents
    per_model = {}
    for _, _, _, _, agg in rows:
        for t, tok in agg.items():
            m = per_model.setdefault(t, {"in": 0, "out": 0, "cw": 0, "cr": 0})
            for k in tok:
                m[k] += tok[k]
    per_model_cost = {t: round(cost_of(tok, t), 2) for t, tok in per_model.items()}

    print(f"{'agent':<42}{'cost':>9}  {'in':>10}{'out':>9}{'cache_w':>10}{'cache_r':>12}  calls")
    print("-" * 100)
    for label, tot, tokens, calls, _ in rows:
        print(f"{label:<42}${tot:>7.2f}  {tokens['in']:>10,}{tokens['out']:>9,}"
              f"{tokens['cw']:>10,}{tokens['cr']:>12,}  {calls}")
    print("-" * 100)
    print(f"{'TOTAL':<42}${grand:>7.2f}  {GI:>10,}{GO:>9,}{GW:>10,}{GR:>12,}")
    print()
    if per_model_cost:
        by_model = "  ".join(f"{t}: ${c:.2f}" for t, c in sorted(per_model_cost.items(), key=lambda kv: -kv[1]))
        print(f"By model tier: {by_model}")
    if grand_tok:
        print(f"Grand total: ${grand:.2f} across {len(rows)} agent transcript(s), "
              f"{grand_tok:,} tokens (cache-read {GR:,} = {100 * GR / grand_tok:.0f}% of all tokens)")
    else:
        print(f"Grand total: ${grand:.2f} (no usage records parsed)")

    if args.audit:
        print_audit([(agent_label(p, roles), p) for p in paths])

    if args.json:
        report = {
            "agents": [
                {"label": label, "cost": round(tot, 2), "tokens": tokens,
                 "calls": calls, "by_model": {t: round(cost_of(tok, t), 2) for t, tok in agg.items()}}
                for label, tot, tokens, calls, agg in rows
            ],
            "by_model": per_model_cost,
            "grand_total": round(grand, 2),
            "tokens": {"in": GI, "out": GO, "cache_write": GW, "cache_read": GR, "total": grand_tok},
            "pricing": PRICE,
        }
        with open(args.json, "w") as f:
            json.dump(report, f, indent=2)
        print(f"\nwrote {args.json}")


if __name__ == "__main__":
    main()
