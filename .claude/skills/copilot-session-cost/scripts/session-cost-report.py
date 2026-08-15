#!/usr/bin/env python3
"""session-cost-report.py — read-only GitHub Copilot CLI usage/cost report.

Reads ONLY local Copilot CLI storage that already exists on this machine:
  - ~/.copilot/session-store.db              (SQLite; table assistant_usage_events)
  - ~/.copilot/session-state/<id>/            (used only to find the current
    session and to check whether it is still active; no event content is read)

It does not call any network service, does not read prompts or assistant
messages, and does not modify any file it reads. Python standard library
only (sqlite3, json, argparse, glob, os, sys, time) — no third-party
packages.

WHAT "root" AND "subagent" MEAN HERE
  A GitHub Copilot CLI subagent (task/general-purpose/code-review/... agent)
  does NOT get its own top-level session row. It is recorded as extra rows
  in the SAME session's assistant_usage_events table, tagged with a
  non-null agent_id (the tool-call id that launched it). Rows with a null
  agent_id are the root/main conversation. "Descendant/subagent sessions"
  in this script therefore means "rows with a non-null agent_id under the
  chosen session_id" — not a separate session_id.

AI-CREDIT AND DOLLAR MATH — ALL RATES ARE EXPLICIT AND OVERRIDABLE
  total_nano_aiu is written by the CLI itself per API call (already priced
  by the Copilot backend for that exact model/token mix). This script only
  converts it using two documented constants, both changeable below:
    nano_aiu_per_credit = 1e9   (1 credit = 1e9 nano-AIU)
    usd_per_credit      = 0.01 (GitHub's documented pay-as-you-go/overage
                                 rate; NOT necessarily what you are billed
                                 under a flat-fee plan with included quota)
  Override either with --nano-aiu-per-credit / --usd-per-credit, or supply
  both via --rates-file pointing at a JSON file such as:
    {"nano_aiu_per_credit": 1000000000, "usd_per_credit": 0.01}
  Precedence: CLI flag > rates file > built-in default.

  RATE VALIDATION: nano_aiu_per_credit must be finite and greater than 0 (it
  is a divisor); usd_per_credit must be finite and 0 or greater (0 is valid
  for a zero dollar conversion). A CLI flag that fails this check is a usage
  error (nonzero exit). A --rates-file value that fails this check is
  ignored with a warning; the prior valid/default value is kept.

  THE DOLLAR FIGURE THIS SCRIPT PRINTS IS NEVER YOUR BILL. It is a labeled
  "AI-credit-equivalent" value only. Local storage does not retain your
  plan/quota state (that data is stripped before being written to disk), so
  this script cannot know whether your usage falls inside an included
  allowance (cost to you: $0) or counts as metered overage.

EXIT CODES
  0 = report produced (warnings possible)
  2 = usage error / bad arguments
  3 = required local data not found or unreadable
"""
import argparse
import glob
import json
import math
import os
import sqlite3
import sys
import time
from datetime import datetime, timedelta, timezone

DEFAULT_NANO_AIU_PER_CREDIT = 1_000_000_000
DEFAULT_USD_PER_CREDIT = 0.01

# Candidate numeric columns this script knows how to sum. Every one is
# looked up against the live schema first (see get_columns()) so a renamed
# or removed column degrades to a clear warning instead of a crash.
TOKEN_COLUMNS = [
    ("input_tokens", "input_tokens"),
    ("output_tokens", "output_tokens"),
    ("cache_read_tokens", "cache_read_tokens"),
    ("cache_write_tokens", "cache_write_tokens"),
    ("reasoning_tokens", "reasoning_tokens"),
    ("total_nano_aiu", "nano_aiu"),
    ("duration_ms", "duration_ms"),
]

# --- Cost-concentration analysis (hotspots / opportunities) -----------------
#
# TOKEN TYPE IS THE PRIMARY AXIS. Every share/hotspot below is computed one
# primary metric at a time, against that metric's own session total. Cache
# fields can overlap input accounting in some models, so metrics are never
# summed into one fake "total cost" figure — each metric keeps its own
# denominator (see compute_shares_and_hotspots).
PRIMARY_METRICS = [
    "input_tokens", "output_tokens", "cache_read_tokens",
    "cache_write_tokens", "reasoning_tokens", "calls", "ai_credits",
]

# Secondary (drill-down) dimensions, all built from safe, content-free local
# columns only: an enum-like scalar, an opaque call id, or a timestamp.
DIMENSION_ORDER = ["model", "agent", "initiator", "time_bucket"]

# Fixed number of equal-width time windows spanning the in-scope rows. Not a
# CLI flag — kept out of the flag surface on purpose (see design checkpoint).
TIME_BUCKETS = 6

# --- Cost tree (du-style nested drilldown) ----------------------------------
#
# One nested tree per primary metric root, in PRIMARY_METRICS order. The
# nesting order below is a DISPLAY CHOICE, stated in every tree header, never
# a causal claim: children of a node are grouped by ONE dimension at a time,
# in this sequence, so a node's children always sum (plus "Other") back to
# that node's own value — a true partition, not a second 100%-of-root facet.
DEFAULT_TREE_ORDER = ["model", "agent", "initiator", "time_bucket"]
TREE_DEPTH_MIN, TREE_DEPTH_MAX, DEFAULT_TREE_DEPTH = 1, 4, 2
TREE_TOP_MIN, TREE_TOP_MAX, DEFAULT_TREE_TOP = 1, 20, 5

# Real, stable fallback labels for a row that has no natural-language content
# to hide: "column not in this schema" vs "column present, value empty for
# this one row" are kept distinct so a genuine unknown never gets silently
# merged into the synthetic "Other" rollup bucket.
UNAVAILABLE_LABEL = "(unavailable)"
UNKNOWN_INITIATOR_LABEL = "(unknown)"
UNKNOWN_MODEL_LABEL = "(unknown model)"
UNKNOWN_TIME_LABEL = "(unknown time)"

TREE_DIM_NOUN = {
    "model": "model", "agent": "agent", "initiator": "initiator",
    "time_bucket": "time bucket",
}

# Tie-break order when one item is flagged on more than one metric at the
# same top share: prefer AI-credit share (the actual cost lens), then the
# more directly actionable token categories.
METRIC_PRIORITY = [
    "ai_credits", "output_tokens", "cache_read_tokens", "input_tokens",
    "cache_write_tokens", "reasoning_tokens", "calls",
]

CACHE_READ_NUANCE = (
    "A high cache-read share often means one agent or time window is reusing "
    "a large, legitimate context on purpose. Treat it as a workload-"
    "concentration signal, not automatic proof of waste."
)
TOKEN_SHARE_BILLING_NOTE = (
    "A token share does not imply a proportional cut to the bill. Cache and "
    "reasoning tokens are not priced 1:1 with plain input/output tokens."
)


def nano_aiu_per_credit_type(value):
    """--nano-aiu-per-credit: the report divides every nano-AIU total by this
    value, so it must be finite and strictly positive. NaN, +/-infinity,
    zero, and negative values would all produce a zero, negative, NaN, or
    infinite AI-credit figure and non-standard JSON — reject at parse time
    so a bad CLI value is a clear usage error, not a silently wrong report."""
    try:
        f = float(value)
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError(f"{value!r} is not a number")
    if not math.isfinite(f) or f <= 0:
        raise argparse.ArgumentTypeError(
            "must be a finite number greater than 0 (NaN, infinity, zero, "
            "and negative values are invalid)")
    return f


def usd_per_credit_type(value):
    """--usd-per-credit: multiplies the AI-credit total into a dollar
    figure, so it must be finite. Zero is valid (a user who wants no dollar
    conversion); negative, NaN, and infinity are not."""
    try:
        f = float(value)
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError(f"{value!r} is not a number")
    if not math.isfinite(f) or f < 0:
        raise argparse.ArgumentTypeError(
            "must be a finite number 0 or greater (NaN, infinity, and "
            "negative values are invalid)")
    return f


def hotspot_threshold_type(value):
    """--hotspot-threshold: a percentage, strictly in (0, 100]."""
    try:
        f = float(value)
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError(f"{value!r} is not a number")
    if not (0 < f <= 100):
        raise argparse.ArgumentTypeError(
            "must be a percentage greater than 0 and at most 100 (e.g. 20 for 20%)")
    return f


def top_opportunities_type(value):
    """--top-opportunities: a bounded positive integer."""
    try:
        i = int(value)
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError(f"{value!r} is not an integer")
    if not (1 <= i <= 20):
        raise argparse.ArgumentTypeError("must be an integer from 1 to 20")
    return i


def tree_depth_type(value):
    """--tree-depth: bounded integer, how many nested levels to expand."""
    try:
        i = int(value)
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError(f"{value!r} is not an integer")
    if not (TREE_DEPTH_MIN <= i <= TREE_DEPTH_MAX):
        raise argparse.ArgumentTypeError(
            f"must be an integer from {TREE_DEPTH_MIN} to {TREE_DEPTH_MAX}")
    return i


def tree_top_type(value):
    """--tree-top: bounded integer, branches shown per node before 'Other'."""
    try:
        i = int(value)
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError(f"{value!r} is not an integer")
    if not (TREE_TOP_MIN <= i <= TREE_TOP_MAX):
        raise argparse.ArgumentTypeError(
            f"must be an integer from {TREE_TOP_MIN} to {TREE_TOP_MAX}")
    return i


def tree_order_type(value):
    """--tree-order: a comma-separated, duplicate-free list drawn only from
    the supported dimensions. Order is a display choice; --tree-depth caps
    how many of these levels actually get expanded."""
    names = [s.strip() for s in value.split(",") if s.strip()]
    if not names:
        raise argparse.ArgumentTypeError("must list at least one dimension")
    seen = set()
    for n in names:
        if n not in DEFAULT_TREE_ORDER:
            raise argparse.ArgumentTypeError(
                f"{n!r} is not a supported tree dimension "
                f"(choices: {', '.join(DEFAULT_TREE_ORDER)})")
        if n in seen:
            raise argparse.ArgumentTypeError(
                f"{n!r} repeated in --tree-order; each dimension may appear once")
        seen.add(n)
    return names


def snapshot_arg_type(value):
    """--snapshot: parsed and validated once, here, at argument-parsing
    time. Rejects a malformed value as a CLI usage error (non-zero exit)
    instead of letting it fall through to a query that silently changes
    scope. The original string is returned (not a datetime) so it is still
    echoed verbatim in the report; parse_iso_ts is only used to validate it."""
    if parse_iso_ts(value) is None:
        raise argparse.ArgumentTypeError(
            f"{value!r} is not a valid ISO-8601 timestamp, e.g. "
            "'2026-08-15T10:44:16Z' or '2026-08-15T10:44:16+00:00'")
    return value


def eprint(*a, **kw):
    print(*a, file=sys.stderr, **kw)


def parse_args(argv=None):
    home = os.path.expanduser("~")
    p = argparse.ArgumentParser(
        prog="session-cost-report.py",
        description="Read-only local Copilot CLI usage/cost report (stdlib only, no network).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  session-cost-report.py\n"
            "      Report the current/latest active session, root + subagents, human output.\n"
            "  session-cost-report.py --session-id <id> --root-only\n"
            "      Report only the main conversation for one session.\n"
            "  session-cost-report.py --json --no-dollar-estimate\n"
            "      Machine-readable output, AI-credit numbers only, no $ figure.\n"
            "  session-cost-report.py --list-sessions\n"
            "      List locally known sessions (id, timestamps) and exit.\n"
            "  session-cost-report.py --rates-file my-rates.json\n"
            "      Override nano_aiu_per_credit / usd_per_credit from a JSON file.\n"
            "  session-cost-report.py --hotspot-threshold 30 --top-opportunities 3\n"
            "      Flag concentration only above 30% share; show up to 3 opportunities.\n"
            "  session-cost-report.py --tree-depth 3 --tree-top 3 --tree-order agent,model\n"
            "      Cost tree nested agent > model, 3 levels deep, 3 branches per node.\n"
            "  session-cost-report.py --no-tree\n"
            "      Human output without the 'Cost tree' section (JSON keeps cost_tree).\n"
        ),
    )
    p.add_argument("--session-id", default=None,
                    help="Session id to report on. Default: auto-detect the most recently "
                         "active local session (see --list-sessions to inspect candidates).")
    p.add_argument("--root-only", action="store_true",
                    help="Report only root/main-conversation rows (agent_id IS NULL). "
                         "Default: root + all subagent rows combined.")
    p.add_argument("--snapshot", default=None, type=snapshot_arg_type,
                    help="ISO-8601 cutoff timestamp (SQLite-style 'YYYY-MM-DD HH:MM:SS' is "
                         "also accepted); only rows created_at <= this value are counted, "
                         "compared as real datetimes. Default: no cutoff (everything "
                         "available right now). An unparsable value is a usage error.")
    p.add_argument("--store", default=os.path.join(home, ".copilot", "session-store.db"),
                    help="Path to session-store.db (default: %(default)s)")
    p.add_argument("--state-dir", default=os.path.join(home, ".copilot", "session-state"),
                    help="Path to the session-state root, used only for session "
                         "auto-detection and active-session checks (default: %(default)s)")
    p.add_argument("--rates-file", default=None,
                    help="Optional JSON file with nano_aiu_per_credit and/or usd_per_credit.")
    p.add_argument("--nano-aiu-per-credit", type=nano_aiu_per_credit_type, default=None,
                    help=f"Override nano-AIU per AI credit (default {DEFAULT_NANO_AIU_PER_CREDIT}). "
                         "Must be finite and greater than 0.")
    p.add_argument("--usd-per-credit", type=usd_per_credit_type, default=None,
                    help=f"Override USD per AI credit (default {DEFAULT_USD_PER_CREDIT}). "
                         "This is a labeled equivalent, never a bill. Must be finite and 0 or greater.")
    p.add_argument("--no-dollar-estimate", action="store_true",
                    help="Omit the dollar-equivalent figure; report AI credits only.")
    p.add_argument("--hotspot-threshold", type=hotspot_threshold_type, default=20.0,
                    help="Percentage in (0, 100]; a dimension item is a cost-concentration "
                         "hotspot when its per-metric share is strictly greater than this "
                         "value. Default: 20 (meaning 20%%).")
    p.add_argument("--top-opportunities", type=top_opportunities_type, default=4,
                    help="Number of ranked improvement opportunities to show (1-20). "
                         "Default: 4.")
    p.add_argument("--tree-depth", type=tree_depth_type, default=DEFAULT_TREE_DEPTH,
                    help=f"Nested levels to expand in the cost tree ({TREE_DEPTH_MIN}-"
                         f"{TREE_DEPTH_MAX}). Default: {DEFAULT_TREE_DEPTH}.")
    p.add_argument("--tree-top", type=tree_top_type, default=DEFAULT_TREE_TOP,
                    help=f"Branches shown per tree node before the remainder rolls into "
                         f"'Other' ({TREE_TOP_MIN}-{TREE_TOP_MAX}). Default: {DEFAULT_TREE_TOP}.")
    p.add_argument("--tree-order", type=tree_order_type, default=list(DEFAULT_TREE_ORDER),
                    help="Comma-separated nesting sequence for the cost tree, drawn from "
                         f"{{{','.join(DEFAULT_TREE_ORDER)}}}, no repeats. "
                         f"Default: {','.join(DEFAULT_TREE_ORDER)}.")
    p.add_argument("--no-tree", action="store_true",
                    help="Omit the 'Cost tree' section from human output only. "
                         "JSON output always includes cost_tree.")
    p.add_argument("--json", action="store_true", help="Emit machine-readable JSON instead of text.")
    p.add_argument("--list-sessions", action="store_true",
                    help="List locally known sessions (id, timestamps, active state; no content) and exit.")
    return p.parse_args(argv)


def open_ro(path, label):
    if not os.path.exists(path):
        eprint(f"ERROR: {label} not found at {path}")
        eprint("This usually means the Copilot CLI has not been run on this machine yet, "
               "or a custom --store/--state-dir path is needed.")
        sys.exit(3)
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        con.execute("select 1")
        return con
    except sqlite3.Error as e:
        eprint(f"ERROR: cannot open {label} at {path} read-only: {e}")
        sys.exit(3)


def get_columns(con, table):
    try:
        cur = con.execute(f"PRAGMA table_info({table})")
        return {row[1] for row in cur.fetchall()}
    except sqlite3.Error:
        return set()


def find_active_session_candidates(state_dir):
    """Sessions with a live inuse.*.lock file, ranked by events.jsonl mtime
    (most recent activity first). Returns a list of (session_id, mtime)."""
    candidates = []
    for lock_path in glob.glob(os.path.join(state_dir, "*", "inuse.*.lock")):
        session_dir = os.path.dirname(lock_path)
        session_id = os.path.basename(session_dir)
        events_path = os.path.join(session_dir, "events.jsonl")
        if os.path.exists(events_path):
            mtime = os.path.getmtime(events_path)
        else:
            mtime = os.path.getmtime(lock_path)
        candidates.append((session_id, mtime))
    candidates.sort(key=lambda t: -t[1])
    return candidates


def list_known_sessions(con, state_dir):
    cols = get_columns(con, "sessions")
    if not cols:
        eprint("WARNING: no 'sessions' table found; cannot list sessions from the database.")
        rows = []
    else:
        cur = con.execute("select id, created_at, updated_at from sessions order by updated_at desc")
        rows = cur.fetchall()
    active = {sid for sid, _ in find_active_session_candidates(state_dir)}
    print(f"{'session_id':40} {'created_at':25} {'updated_at':25} active")
    for sid, created_at, updated_at in rows:
        flag = "yes" if sid in active else "no"
        print(f"{sid:40} {str(created_at or ''):25} {str(updated_at or ''):25} {flag}")


def resolve_session_id(explicit_id, con, state_dir):
    if explicit_id:
        return explicit_id, []
    warnings = []
    candidates = find_active_session_candidates(state_dir)
    if candidates:
        return candidates[0][0], warnings
    warnings.append("No active (locked) local session found; falling back to the most "
                     "recently updated session in session-store.db.")
    cols = get_columns(con, "sessions")
    if "id" in cols and "updated_at" in cols:
        cur = con.execute("select id from sessions order by updated_at desc limit 1")
        row = cur.fetchone()
        if row:
            return row[0], warnings
    eprint("ERROR: could not auto-detect a session id. Pass --session-id explicitly, "
           "or run with --list-sessions to see what is available locally.")
    sys.exit(3)


def is_session_active(session_id, state_dir):
    return len(glob.glob(os.path.join(state_dir, session_id, "inuse.*.lock"))) > 0


def _rate_is_valid(key, value):
    """A rate value must be finite (not NaN/+-infinity) and, for
    nano_aiu_per_credit, strictly positive (it is a divisor), or, for
    usd_per_credit, zero or positive (zero is a valid 'no dollar figure'
    rate; negative is not). A value that fails this check must never reach
    the report math — it would produce a zero, negative, NaN, or infinite
    AI-credit/dollar figure and non-standard JSON."""
    if not math.isfinite(value):
        return False
    return value > 0 if key == "nano_aiu_per_credit" else value >= 0


def _json_type_name(value):
    """Name a parsed JSON value's shape for a --rates-file warning, using
    JSON vocabulary (array/object/string/number/boolean/null) rather than
    the Python type name, since the file is JSON, not Python source."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, list):
        return "array"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    return type(value).__name__


def load_rates(args):
    rates = {
        "nano_aiu_per_credit": DEFAULT_NANO_AIU_PER_CREDIT,
        "usd_per_credit": DEFAULT_USD_PER_CREDIT,
    }
    warnings = []
    if args.rates_file:
        if not os.path.exists(args.rates_file):
            warnings.append(f"--rates-file {args.rates_file} not found; using built-in defaults.")
        else:
            try:
                with open(args.rates_file) as f:
                    data = json.load(f)
                # A rates file must hold a JSON object (dict) with named
                # rate keys. Valid JSON of any other shape (array, null, a
                # number, a string) has no keys to read: fail closed here
                # with one clear warning and keep the current rates dict
                # (defaults, or an earlier valid override) instead of
                # letting `key in data` / `data[key]` / `data.keys()` raise
                # TypeError or AttributeError below.
                if not isinstance(data, dict):
                    warnings.append(
                        f"--rates-file {args.rates_file} does not contain a JSON object "
                        f"(found {_json_type_name(data)}); using built-in/current defaults.")
                else:
                    for key in ("nano_aiu_per_credit", "usd_per_credit"):
                        if key in data:
                            try:
                                value = float(data[key])
                            except (TypeError, ValueError):
                                warnings.append(f"--rates-file value for {key!r} is not numeric; ignored.")
                                continue
                            # json.load accepts non-standard NaN/Infinity tokens by
                            # default; reject those here, keeping the prior
                            # (default, or an earlier valid override's) value.
                            if not _rate_is_valid(key, value):
                                warnings.append(
                                    f"--rates-file value for {key!r} ({data[key]!r}) is out of range; "
                                    "keeping the current value.")
                                continue
                            rates[key] = value
                    unknown = set(data.keys()) - {"nano_aiu_per_credit", "usd_per_credit"}
                    if unknown:
                        warnings.append(f"--rates-file has unrecognized keys, ignored: {sorted(unknown)}")
            except (json.JSONDecodeError, OSError) as e:
                warnings.append(f"--rates-file {args.rates_file} could not be parsed: {e}. Using defaults.")
    # CLI overrides: parse_args's nano_aiu_per_credit_type/usd_per_credit_type
    # already reject a non-finite or out-of-range value as a usage error, so
    # args.nano_aiu_per_credit/args.usd_per_credit are guaranteed valid here.
    if args.nano_aiu_per_credit is not None:
        rates["nano_aiu_per_credit"] = args.nano_aiu_per_credit
    if args.usd_per_credit is not None:
        rates["usd_per_credit"] = args.usd_per_credit
    return rates, warnings


def build_query(cols, root_only):
    """Build a row-level SELECT (one row per event, no GROUP BY) that only
    references columns actually present, so a schema change degrades to
    'field unavailable' instead of an exception. Row-level fetch (instead of
    a single grouped SQL query) lets one pass build every drill-down
    dimension (model, agent, initiator, time_bucket) in Python without
    re-querying; totals/by_model/root_vs_subagent are aggregated from the
    same rows and stay numerically identical to the old grouped query."""
    warnings = []
    select_parts = []
    token_col_available = {}
    for db_col, out_name in TOKEN_COLUMNS:
        available = db_col in cols
        token_col_available[out_name] = available
        if available:
            select_parts.append(f"{db_col} as {out_name}")
        else:
            warnings.append(f"Column '{db_col}' not present in this schema; "
                             f"'{out_name}' will be reported as unavailable (null).")
            select_parts.append(f"NULL as {out_name}")

    has_agent_id = "agent_id" in cols
    if not has_agent_id:
        warnings.append("Column 'agent_id' not present; cannot distinguish root vs subagent "
                         "rows, everything is reported as root.")

    has_initiator = "initiator" in cols
    if not has_initiator:
        warnings.append("Column 'initiator' not present; the initiator dimension will be "
                         "reported as unavailable.")

    agent_expr = "agent_id" if has_agent_id else "NULL"
    initiator_expr = "initiator" if has_initiator else "NULL"
    # No created_at bound here on purpose: SQLite compares TEXT lexically,
    # and this column mixes SQLite-default and ISO-8601 forms, so a text
    # comparison against the snapshot can include/exclude the wrong same-day
    # rows. The snapshot cutoff is applied afterwards in Python, using real
    # parsed datetimes (see query_usage).
    sql = (
        f"select {agent_expr} as agent_id, model, {initiator_expr} as initiator, "
        f"created_at, " + ", ".join(select_parts)
        + " from assistant_usage_events where session_id = ?"
    )
    if root_only and has_agent_id:
        sql += " and agent_id is null"
    return sql, warnings, has_agent_id, has_initiator, token_col_available


def query_usage(con, session_id, snapshot_ts, root_only):
    cols = get_columns(con, "assistant_usage_events")
    warnings = []
    if not cols:
        eprint("ERROR: table 'assistant_usage_events' not found. The installed Copilot CLI "
               "version may use a different local schema; this script cannot continue.")
        sys.exit(3)
    for required in ("session_id", "model", "created_at"):
        if required not in cols:
            eprint(f"ERROR: required column '{required}' missing from assistant_usage_events; "
                   "schema is incompatible with this script.")
            sys.exit(3)

    # Parse and validate the snapshot cutoff exactly once, here, to a real
    # UTC-aware instant. A caller that reaches this function with an
    # unparsable snapshot (the CLI itself is already gated by
    # snapshot_arg_type in parse_args) gets the same clear, non-zero-exit
    # rejection rather than a query that silently changes scope.
    snapshot_dt = parse_iso_ts(snapshot_ts)
    if snapshot_dt is None:
        eprint(f"ERROR: --snapshot value {snapshot_ts!r} is not a valid ISO-8601 timestamp "
               "(e.g. '2026-08-15T10:44:16Z' or '2026-08-15T10:44:16+00:00').")
        sys.exit(2)

    sql, build_warnings, has_agent_id, has_initiator, token_col_available = build_query(cols, root_only)
    warnings.extend(build_warnings)
    try:
        cur = con.execute(sql, (session_id,))
        all_rows = cur.fetchall()
        col_names = [d[0] for d in cur.description]
    except sqlite3.Error as e:
        eprint(f"ERROR: query against assistant_usage_events failed: {e}")
        sys.exit(3)

    # Apply the snapshot cutoff here, by real datetime semantics, not by the
    # SQLite text ordering build_query() deliberately avoids. A row whose
    # created_at can't be parsed can't be placed on either side of the
    # cutoff; it stays in scope (with a warning) rather than being silently
    # dropped, matching how the time_bucket dimension already treats a bad
    # timestamp as UNKNOWN_TIME_LABEL instead of discarding the row.
    created_idx = col_names.index("created_at")
    rows = []
    unparsable_count = 0
    for row in all_rows:
        ts = parse_iso_ts(row[created_idx])
        if ts is None:
            unparsable_count += 1
            rows.append(row)
        elif ts <= snapshot_dt:
            rows.append(row)
    if unparsable_count:
        warnings.append(f"{unparsable_count} row(s) had an unparsable created_at and could "
                         "not be checked against the --snapshot cutoff; they are kept in the "
                         "report rather than silently dropped.")

    if not rows:
        warnings.append(f"No usage rows found for session_id={session_id!r} at or before "
                         f"the snapshot cutoff. Check --session-id, --snapshot, and --store.")
    return rows, col_names, has_agent_id, has_initiator, token_col_available, warnings


def zero(v):
    return v if v is not None else 0


def parse_iso_ts(s):
    """Parse a created_at value in any form this local schema is known to
    use: SQLite's own default 'YYYY-MM-DD HH:MM:SS[.ffffff]' (no offset,
    written in UTC), ISO-8601 with a 'Z' suffix, or ISO-8601 with an
    explicit offset. Always returns a UTC-aware datetime (never a naive
    one), so two rows from different forms stay directly comparable —
    mixing a naive and an aware datetime raises TypeError in min()/max().
    Returns None on anything unparsable so one bad row degrades to
    'excluded from time_bucket' / 'kept without a snapshot check', never a
    crash."""
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        # SQLite's CURRENT_TIMESTAMP default is UTC with no offset marker;
        # attach it explicitly rather than leaving the value ambiguous.
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _bucket_label(index, total, start, end):
    """Full-date bucket label (both edges), so a window that crosses
    midnight still reads in order — a bucket sorted by value elsewhere in
    the tree keeps its own fixed 1..N index in the label text."""
    return (f"bucket {index}/{total} ({start.strftime('%Y-%m-%d %H:%M:%S')} UTC "
            f"\u2013 {end.strftime('%Y-%m-%d %H:%M:%S')} UTC)")


def build_time_bucket_labels(ts_list, time_buckets=TIME_BUCKETS):
    """Assign every row (by position, aligned with ts_list) a REAL time-
    bucket label. Rows with an unparsable/missing timestamp get the real
    label UNKNOWN_TIME_LABEL — never silently dropped, never folded into a
    synthetic 'Other' — so the cost tree can reconcile exactly even when
    some created_at values are bad. Returns (labels, bucket_bounds,
    dropped_count): `labels` is one string per row; `bucket_bounds` is the
    ordered list of {index, label, start (ISO), end (ISO)} actually used
    (empty when no row has a usable timestamp)."""
    valid_ts = [ts for ts in ts_list if ts is not None]
    dropped = len(ts_list) - len(valid_ts)
    if not valid_ts:
        return [UNKNOWN_TIME_LABEL] * len(ts_list), [], dropped

    min_ts, max_ts = min(valid_ts), max(valid_ts)
    span = (max_ts - min_ts).total_seconds()
    if span <= 0:
        label = (f"bucket 1/1 ({min_ts.strftime('%Y-%m-%d %H:%M:%S')} UTC, "
                 f"single timestamp)")
        bounds = [{"index": 1, "label": label, "start": min_ts.isoformat(),
                   "end": max_ts.isoformat()}]
        labels = [label if ts is not None else UNKNOWN_TIME_LABEL for ts in ts_list]
        return labels, bounds, dropped

    width = span / time_buckets
    bucket_label = {}
    bounds = []
    for b in range(time_buckets):
        start = min_ts + timedelta(seconds=b * width)
        end = min_ts + timedelta(seconds=(b + 1) * width)
        label = _bucket_label(b + 1, time_buckets, start, end)
        bucket_label[b] = label
        bounds.append({"index": b + 1, "label": label, "start": start.isoformat(),
                        "end": end.isoformat()})
    labels = []
    for ts in ts_list:
        if ts is None:
            labels.append(UNKNOWN_TIME_LABEL)
        else:
            b = min(int((ts - min_ts).total_seconds() / width), time_buckets - 1)
            labels.append(bucket_label[b])
    return labels, bounds, dropped


FIELDS = ["calls", "input_tokens", "output_tokens", "cache_read_tokens",
          "cache_write_tokens", "reasoning_tokens", "nano_aiu", "duration_ms"]


def new_agg():
    return dict(calls=0, input_tokens=0, output_tokens=0, cache_read_tokens=0,
                cache_write_tokens=0, reasoning_tokens=0, nano_aiu=0, duration_ms=0)


def add_vals(agg, vals):
    for f in FIELDS:
        agg[f] += vals[f]


def package_dimension(agg_by_label, with_credits, available=True):
    """Wrap one dimension's per-label aggregates into the stable
    {items, item_count, trivial, available} shape. `trivial` (fewer than 2
    distinct items) is the guard that stops a single-item dimension —
    e.g. `agent` under --root-only, or a one-event session — from ever
    reporting a false 100% hotspot."""
    items = [dict(with_credits(agg), label=label) for label, agg in agg_by_label.items()]
    return {
        "items": items,
        "item_count": len(items),
        "trivial": len(items) < 2,
        "available": available,
    }


def compute_shares_and_hotspots(dimensions, totals, threshold):
    """TOKEN TYPE IS THE PRIMARY AXIS: for each primary metric, each item's
    share is that item's value divided by the SAME metric's own session
    total (never a summed/fake cross-metric total, since cache fields can
    overlap input accounting). A metric with a zero total is skipped
    everywhere — no share, no flag. A hotspot needs share > threshold AND
    at least 2 distinct items in that dimension (the trivial guard)."""
    hotspots = []
    skipped_metrics = [m for m in PRIMARY_METRICS if not totals.get(m)]
    for dim_name, dim in dimensions.items():
        for item in dim["items"]:
            shares = {}
            for metric in PRIMARY_METRICS:
                total_val = totals.get(metric, 0)
                if not total_val:
                    continue
                share = item.get(metric, 0) / total_val
                shares[metric] = share
                if not dim["trivial"] and share > threshold:
                    hotspots.append({
                        "dimension": dim_name, "item": item["label"], "metric": metric,
                        "share": share, "value": item.get(metric, 0), "total": total_val,
                    })
            item["shares"] = shares
    return hotspots, skipped_metrics


OVERALL_MIX_OVERLAP_NOTE = (
    "The 5 recorded counters overlap and are never one summed total: cache-read/cache-write "
    "tokens can be part of input accounting, and reasoning tokens are part of output "
    "accounting, and counter semantics can differ by model. This report never infers an "
    "uncached-input or non-reasoning remainder, because no documented contract in this "
    "repository fixes that semantics across models — a session total can mix rows from "
    "several models, so an aggregate inequality holding is not proof the counters don't "
    "overlap. cache_ratios and reasoning_ratio below are independent ratios of one counter "
    "to another, not a partition: they are not required to sum to 100%, and any sum of "
    "overlapping counters is counter volume only, never a unique-token total or a token "
    "composition."
)


def _pct(part, whole):
    return round(part / whole * 100, 2) if whole else None


def compute_overall_token_mix(totals, token_col_available):
    """Build the safe 'overall token mix' view. TOKEN TYPE FIRST, PERCENT OF
    ITS OWN WHOLE ONLY, NEVER AN INFERRED REMAINDER:
      1. top_level: input_tokens and output_tokens as a share of their own
         sum (input + output). This never includes cache/reasoning fields,
         so it never double-counts them.
      2. cache_ratios: cache_read_tokens and cache_write_tokens EACH shown
         as their own independent ratio to input_tokens. Computed only
         when the schema has real cache_read_tokens/cache_write_tokens
         columns (not NULL-defaulted from a missing column) and
         input_tokens > 0. These two ratios are not claimed to sum to
         100%, and no 'uncached' remainder is ever derived from them —
         per-model counter semantics are not documented in this repo, so
         an aggregate inequality (cache_read + cache_write <= input) is
         not treated as proof the counters are disjoint. If the combined
         ratio exceeds 100%, a warning notes this (expected when a session
         mixes models with different cache-counter semantics), but the
         ratios are still shown.
      3. reasoning_ratio: reasoning_tokens shown as its own ratio to
         output_tokens, on the same terms — no 'non_reasoning' remainder
         is ever derived. Same >100% warning-but-still-shown rule.
    Returns a dict with top_level, cache_ratios (or None), reasoning_ratio
    (or None), an overlap_note, and a warnings list."""
    warnings = []
    input_tokens = totals.get("input_tokens", 0) or 0
    output_tokens = totals.get("output_tokens", 0) or 0
    cache_read = totals.get("cache_read_tokens", 0) or 0
    cache_write = totals.get("cache_write_tokens", 0) or 0
    reasoning = totals.get("reasoning_tokens", 0) or 0

    top_denominator = input_tokens + output_tokens
    top_level = {
        "denominator": top_denominator,
        "components": {
            "input_tokens": {"value": input_tokens, "pct": _pct(input_tokens, top_denominator)},
            "output_tokens": {"value": output_tokens, "pct": _pct(output_tokens, top_denominator)},
        },
    }
    if top_denominator <= 0:
        warnings.append("input_tokens + output_tokens is 0; top-level token mix "
                         "percentages are unavailable.")

    cache_ratios = None
    cache_cols_available = (token_col_available.get("cache_read_tokens", True)
                             and token_col_available.get("cache_write_tokens", True))
    if not cache_cols_available:
        warnings.append("cache_read_tokens/cache_write_tokens column unavailable in this "
                         "schema; cache ratios omitted.")
    elif input_tokens <= 0:
        warnings.append("input_tokens total is 0; cache ratios omitted.")
    else:
        if (cache_read + cache_write) > input_tokens:
            warnings.append(
                f"cache_read_tokens + cache_write_tokens ({cache_read + cache_write}) exceeds "
                f"input_tokens ({input_tokens}) in this aggregate. This does not mean the "
                "data is wrong: it can happen when rows from different models with "
                "different cache-counter semantics are combined. cache_ratios below are "
                "shown as independent ratios, not a partition of input_tokens.")
        cache_ratios = {
            "denominator": input_tokens,
            "components": {
                "cache_read_tokens": {"value": cache_read, "pct": _pct(cache_read, input_tokens)},
                "cache_write_tokens": {"value": cache_write, "pct": _pct(cache_write, input_tokens)},
            },
        }

    reasoning_ratio = None
    reasoning_col_available = token_col_available.get("reasoning_tokens", True)
    if not reasoning_col_available:
        warnings.append("reasoning_tokens column unavailable in this schema; reasoning "
                         "ratio omitted.")
    elif output_tokens <= 0:
        warnings.append("output_tokens total is 0; reasoning ratio omitted.")
    else:
        if reasoning > output_tokens:
            warnings.append(
                f"reasoning_tokens ({reasoning}) exceeds output_tokens ({output_tokens}) in "
                "this aggregate. This does not mean the data is wrong: it can happen when "
                "rows from different models with different reasoning-counter semantics are "
                "combined. reasoning_ratio below is shown as an independent ratio, not a "
                "share of a fixed output_tokens partition.")
        reasoning_ratio = {
            "denominator": output_tokens,
            "components": {
                "reasoning_tokens": {"value": reasoning, "pct": _pct(reasoning, output_tokens)},
            },
        }

    return {
        "top_level": top_level,
        "cache_ratios": cache_ratios,
        "reasoning_ratio": reasoning_ratio,
        "overlap_note": OVERALL_MIX_OVERLAP_NOTE,
        "warnings": warnings,
    }


def rank_opportunities(dimensions, hotspots, totals, top_n):
    """De-duplicated ranking: never list the same dominant (dimension, item)
    once per metric. One candidate per (dimension, item) merges all its
    flagged metrics. A diverse pass takes each dimension's own top candidate
    first (up to top_n, each a different lens); a fill pass then tops up
    from the remaining pool by score. Score prefers AI-credit share (the
    actual cost lens); falls back to the best flagged token/call share only
    when session AI credits total is 0."""
    if not hotspots:
        return []
    grouped = {}
    for h in hotspots:
        grouped.setdefault((h["dimension"], h["item"]), []).append(h)

    ai_credits_total = totals.get("ai_credits", 0)
    candidates = []
    for (dim_name, item_label), hs in grouped.items():
        item = next((it for it in dimensions[dim_name]["items"] if it["label"] == item_label), None)
        ai_credits_share = (item["shares"].get("ai_credits", 0.0) if item else 0.0)
        ai_credits_value = (item.get("ai_credits", 0.0) if item else 0.0)

        hs_sorted = sorted(hs, key=lambda h: -h["share"])
        max_share = hs_sorted[0]["share"]
        tied = [h for h in hs_sorted if h["share"] == max_share]
        if len(tied) > 1:
            tied.sort(key=lambda h: METRIC_PRIORITY.index(h["metric"])
                      if h["metric"] in METRIC_PRIORITY else len(METRIC_PRIORITY))
        main = tied[0]

        if ai_credits_total > 0:
            score, score_note = ai_credits_share, None
        else:
            score = main["share"]
            score_note = (f"session ai_credits total is 0; ranked by {main['metric']} "
                           "share instead of ai_credits share.")

        others = [h for h in hs_sorted if h is not main]
        candidates.append({
            "dimension": dim_name, "item": item_label,
            "main_metric": main["metric"], "main_metric_share": main["share"],
            "main_metric_value": main["value"],
            "ai_credits_share": ai_credits_share, "ai_credits_value": ai_credits_value,
            "other_flagged_metrics": [
                {"metric": h["metric"], "share": h["share"], "value": h["value"]} for h in others
            ],
            "score": score, "score_note": score_note,
        })

    by_dim = {}
    for c in candidates:
        by_dim.setdefault(c["dimension"], []).append(c)

    chosen, chosen_keys = [], set()
    for dim_name in DIMENSION_ORDER:
        pool = by_dim.get(dim_name, [])
        if not pool or len(chosen) >= top_n:
            continue
        best = max(pool, key=lambda c: c["score"])
        key = (best["dimension"], best["item"])
        if key not in chosen_keys:
            chosen.append(best)
            chosen_keys.add(key)

    if len(chosen) < top_n:
        remaining = sorted(
            (c for c in candidates if (c["dimension"], c["item"]) not in chosen_keys),
            key=lambda c: -c["score"])
        for c in remaining:
            if len(chosen) >= top_n:
                break
            chosen.append(c)
            chosen_keys.add((c["dimension"], c["item"]))

    for i, c in enumerate(chosen, start=1):
        c["rank"] = i
    return chosen


# --- Cost tree: nested du-style breakdown, one tree per PRIMARY_METRICS root
#
# TOKEN TYPE STAYS THE PRIMARY AXIS: one tree root per metric, same order as
# PRIMARY_METRICS. Children of a node are grouped by ONE dimension at a
# time, in --tree-order sequence — a true partition, so
# sum(shown children raw) + Other raw == parent raw EXACTLY at every node
# (see build_tree_children). All arithmetic (sums, Other's remainder,
# shares) is done on RAW integers (token/call counts, or nano_aiu for
# ai_credits); only the human-facing "value" for ai_credits is rounded for
# display, and that rounding never feeds back into any other computation.
def raw_field_for_metric(metric):
    return "nano_aiu" if metric == "ai_credits" else metric


def display_value_for_metric(metric, raw_value, rates):
    if metric == "ai_credits":
        return round(raw_value / rates["nano_aiu_per_credit"], 4)
    return raw_value


def make_tree_node(label, dim_name, raw_value, parent_raw, session_raw, metric, rates,
                    is_other):
    return {
        "label": str(label),
        "dimension": dim_name,
        "value": display_value_for_metric(metric, raw_value, rates),
        "raw_value": raw_value,
        "share_of_parent": (raw_value / parent_raw) if parent_raw else None,
        "share_of_session": (raw_value / session_raw) if session_raw else None,
        "is_other": is_other,
        "children": [],
        "other": None,
    }


def build_tree_children(records, tree_order, level_idx, depth, top_n, raw_field,
                         parent_raw, session_raw, metric, rates):
    """One node's children, grouped by tree_order[level_idx], recursing to
    the next level until `depth` or len(tree_order) is reached. `records` is
    every row (label_tuple, vals) belonging to this node — every row always
    carries a REAL label for every dimension (never dropped), so groups
    here exhaustively partition `records`. Sort is value-desc with a
    deterministic string tie-break. Other's value is parent_raw minus the
    exact sum of shown children — never a second, independently rounded
    computation — so reconciliation is exact by construction."""
    if level_idx >= depth or level_idx >= len(tree_order):
        return [], None
    dim_name = tree_order[level_idx]
    groups = {}
    for labels, vals in records:
        groups.setdefault(labels[level_idx], []).append((labels, vals))

    group_sums = []
    for label, recs in groups.items():
        raw_sum = sum(v[raw_field] for _, v in recs)
        group_sums.append((label, raw_sum, recs))
    group_sums.sort(key=lambda t: (-t[1], str(t[0])))

    shown = group_sums[:top_n]
    children = []
    for label, raw_sum, recs in shown:
        node = make_tree_node(label, dim_name, raw_sum, parent_raw, session_raw, metric,
                               rates, is_other=False)
        child_children, child_other = build_tree_children(
            recs, tree_order, level_idx + 1, depth, top_n, raw_field, raw_sum,
            session_raw, metric, rates)
        node["children"] = child_children
        node["other"] = child_other
        children.append(node)

    other = None
    if len(group_sums) > top_n:
        shown_total = sum(v for _, v, _ in shown)
        other_raw = parent_raw - shown_total  # exact remainder, raw units
        other = make_tree_node("Other", dim_name, other_raw, parent_raw, session_raw,
                                metric, rates, is_other=True)
        other["omitted_count"] = len(group_sums) - top_n
    return children, other


def build_cost_tree(row_records, tree_order, depth, top_n, totals, rates, skipped_metrics,
                     bucket_bounds, dropped_ts_rows):
    """row_records: list of (label_dict, vals) — one per in-scope row, every
    dimension already carrying a real, stable label (never task/prompt
    content: model name, 'root'/opaque agent-call id, initiator enum, or a
    time-bucket string). Builds one tree per PRIMARY_METRICS root."""
    converted = [(tuple(labels[d] for d in tree_order), vals) for labels, vals in row_records]
    roots = []
    for metric in PRIMARY_METRICS:
        raw_field = raw_field_for_metric(metric)
        session_raw = totals.get(raw_field, 0)
        skipped = metric in skipped_metrics
        root = {
            "metric": metric,
            "value": display_value_for_metric(metric, session_raw, rates),
            "raw_value": session_raw,
            "skipped": bool(skipped),
            "children": [],
            "other": None,
        }
        if not skipped and session_raw:
            children, other = build_tree_children(
                converted, tree_order, 0, depth, top_n, raw_field, session_raw,
                session_raw, metric, rates)
            root["children"] = children
            root["other"] = other
        roots.append(root)
    return {
        "order": tree_order,
        "depth": depth,
        "top": top_n,
        "time_bounds": {
            "min": bucket_bounds[0]["start"] if bucket_bounds else None,
            "max": bucket_bounds[-1]["end"] if bucket_bounds else None,
            "unknown_time_rows": dropped_ts_rows,
            "buckets": bucket_bounds,
        },
        "roots": roots,
    }


def build_report(rows, col_names, has_agent_id, has_initiator, token_col_available, root_only,
                  rates, no_dollar, hotspot_threshold, top_opportunities,
                  tree_depth=DEFAULT_TREE_DEPTH, tree_top=DEFAULT_TREE_TOP, tree_order=None):
    idx = {name: i for i, name in enumerate(col_names)}
    tree_order = list(tree_order) if tree_order else list(DEFAULT_TREE_ORDER)
    tree_depth_effective = min(tree_depth, len(tree_order))
    totals = new_agg()
    by_model = {}
    root_agg = new_agg()
    sub_agg = new_agg()
    sub_instance_ids = set()

    dim_agg = {name: {} for name in DIMENSION_ORDER}
    time_rows = []  # (ts_or_None, vals) — bucketed after min/max is known
    row_records = []  # (label_dict, vals) — one per row, feeds the cost tree

    for row in rows:
        agent_id = row[idx["agent_id"]]
        model = row[idx["model"]] or UNKNOWN_MODEL_LABEL
        initiator = row[idx["initiator"]] if has_initiator else None
        initiator_label = initiator if initiator else UNKNOWN_INITIATOR_LABEL
        vals = {f: zero(row[idx[f]]) if f in idx else 0 for f in FIELDS}
        vals["calls"] = 1  # row-level fetch: each row is exactly one call

        add_vals(totals, vals)
        add_vals(by_model.setdefault(model, new_agg()), vals)
        add_vals(dim_agg["model"].setdefault(model, new_agg()), vals)

        agent_label = "root" if agent_id is None else agent_id
        add_vals(dim_agg["agent"].setdefault(agent_label, new_agg()), vals)
        if agent_id is None:
            add_vals(root_agg, vals)
        else:
            sub_instance_ids.add(agent_id)
            add_vals(sub_agg, vals)

        if has_initiator:
            add_vals(dim_agg["initiator"].setdefault(initiator_label, new_agg()), vals)

        ts = parse_iso_ts(row[idx["created_at"]]) if "created_at" in idx else None
        time_rows.append((ts, vals))

        # Tree row label: EVERY dimension always gets a real, stable label
        # here (never dropped), so the tree's per-row partition is exact.
        # "(unavailable)" (column missing from this schema) is kept distinct
        # from "(unknown)" (column present, this row's value empty) — both
        # real states, neither a synthetic Other rollup.
        tree_initiator_label = initiator_label if has_initiator else UNAVAILABLE_LABEL
        row_records.append(({
            "model": model, "agent": agent_label, "initiator": tree_initiator_label,
        }, vals))

    # time_bucket: TIME_BUCKETS equal-width windows spanning the in-scope
    # rows' own min..max created_at (not wall-clock "now"), so the buckets
    # always describe this report's data. Labels carry the full date on both
    # edges so a window crossing midnight still reads in chronological
    # order (see build_time_bucket_labels).
    ts_list = [ts for ts, _ in time_rows]
    bucket_labels, bucket_bounds, dropped_ts = build_time_bucket_labels(ts_list)
    for (ts, vals), label in zip(time_rows, bucket_labels):
        if ts is not None:  # legacy dims: unparsable timestamps stay excluded
            add_vals(dim_agg["time_bucket"].setdefault(label, new_agg()), vals)
    for rec, label in zip(row_records, bucket_labels):
        rec[0]["time_bucket"] = label  # tree: every row gets a real label

    def with_credits(d):
        d = dict(d)
        d["ai_credits"] = round(d["nano_aiu"] / rates["nano_aiu_per_credit"], 4)
        return d

    report = {
        "totals": with_credits(totals),
        "by_model": {m: with_credits(v) for m, v in by_model.items()},
        "root_only": root_only,
    }
    if has_agent_id and not root_only:
        root_agg_c = with_credits(root_agg)
        sub_agg_c = with_credits(sub_agg)
        sub_agg_c["subagent_instance_count"] = len(sub_instance_ids)
        report["root_vs_subagent"] = {"root": root_agg_c, "subagents": sub_agg_c}

    if not no_dollar:
        report["cost_estimate"] = {
            "nano_aiu_per_credit": rates["nano_aiu_per_credit"],
            "usd_per_credit": rates["usd_per_credit"],
            "ai_credits": report["totals"]["ai_credits"],
            "usd_equivalent": round(report["totals"]["ai_credits"] * rates["usd_per_credit"], 4),
            "disclaimer": (
                "This is a labeled AI-credit-equivalent value, NOT a bill. It equals a real "
                "charge only if this account is on metered/pay-as-you-go billing and has used "
                "up its included plan allowance. Local storage does not retain plan/quota "
                "state, so this script cannot confirm billing impact."
            ),
        }

    dimensions = {
        "model": package_dimension(dim_agg["model"], with_credits, available=True),
        "agent": package_dimension(dim_agg["agent"], with_credits, available=has_agent_id),
        "initiator": package_dimension(dim_agg["initiator"], with_credits, available=has_initiator),
        "time_bucket": package_dimension(dim_agg["time_bucket"], with_credits, available=True),
    }
    dimensions["time_bucket"]["bucket_bounds"] = bucket_bounds
    threshold_fraction = hotspot_threshold / 100.0
    hotspots, skipped_metrics = compute_shares_and_hotspots(dimensions, report["totals"], threshold_fraction)
    ranked = rank_opportunities(dimensions, hotspots, report["totals"], top_opportunities)

    report["hotspot_threshold"] = threshold_fraction
    report["dimensions"] = dimensions
    report["hotspots"] = hotspots
    report["ranked_opportunities"] = ranked
    report["skipped_metrics"] = skipped_metrics
    report["time_bucket_dropped_rows"] = dropped_ts
    report["overall_token_mix"] = compute_overall_token_mix(report["totals"], token_col_available)
    report["dimension_notes"] = {
        "cache_read_tokens": CACHE_READ_NUANCE,
        "token_share_billing": TOKEN_SHARE_BILLING_NOTE,
    }
    # Cost tree: derived from the SAME per-row records built above (one row
    # iteration feeds both `dim_agg`/`dimensions` and `row_records`) — never
    # a second independent scan or re-derivation of hotspot-level numbers.
    report["cost_tree"] = build_cost_tree(
        row_records, tree_order, tree_depth_effective, tree_top, report["totals"], rates,
        skipped_metrics, bucket_bounds, dropped_ts)
    return report



def format_metric_value(metric, value):
    if metric == "ai_credits":
        return f"{value:g} credits"
    if metric == "calls":
        return f"{int(value):,} calls"
    return f"{int(value):,} tok"


def human_label(dim_name, label):
    """Human-report-only display label. Agent ids are already opaque
    (call ids), never natural-language content — this only shortens a
    long id for column width; the JSON report always keeps the full id."""
    if dim_name == "agent" and label != "root" and len(str(label)) > 16:
        return str(label)[:12] + "…"
    return str(label)


def _print_mix_row(label, comp):
    pct = comp["pct"]
    pct_str = f"{pct:5.1f}%" if pct is not None else "  n/a"
    print(f"    {label:26} {comp['value']:>10,} tok  ({pct_str})")


def render_overall_token_mix(otm):
    """OVERALL MIX BEFORE COST CONCENTRATION: a quick top-level read (input
    vs output share, plus cache/reasoning ratios) ahead of the deeper
    hotspot drill-down. The 5 recorded counters are never shown as one
    summed total, and cache_ratios/reasoning_ratio are independent ratios,
    never an inferred uncached/non-reasoning remainder — see overlap_note."""
    print("\n-- Overall token mix --")
    print(f"  Note: {otm['overlap_note']}")

    top = otm["top_level"]
    print(f"  input vs output (of input + output = {top['denominator']:,} tok):")
    _print_mix_row("input_tokens", top["components"]["input_tokens"])
    _print_mix_row("output_tokens", top["components"]["output_tokens"])

    cr = otm.get("cache_ratios")
    if cr:
        print(f"  cache ratios (each vs. input_tokens = {cr['denominator']:,} tok; "
              "independent ratios, not a partition):")
        for key in ("cache_read_tokens", "cache_write_tokens"):
            _print_mix_row(key, cr["components"][key])
    else:
        print("  cache ratios: omitted (see warnings)")

    rr = otm.get("reasoning_ratio")
    if rr:
        print(f"  reasoning ratio (vs. output_tokens = {rr['denominator']:,} tok; "
              "independent ratio, not a partition):")
        _print_mix_row("reasoning_tokens", rr["components"]["reasoning_tokens"])
    else:
        print("  reasoning ratio: omitted (see warnings)")


def _tree_node_label(node):
    """Human label for one tree node. 'Other' carries the omitted-branch
    count so a reader can see how many real items were rolled up, without
    printing any of their (possibly numerous) individual labels."""
    if node["is_other"]:
        count = node.get("omitted_count", 0)
        noun = TREE_DIM_NOUN.get(node["dimension"], node["dimension"])
        noun = noun if count == 1 else noun + "s"
        return f"Other ({count} more {noun})"
    return human_label(node["dimension"], node["label"])


def _pct_of(share):
    return f"{share * 100:5.1f}%" if share is not None else "  n/a"


def _print_tree_node(node, metric, prefix, is_last):
    connector = "\u2514\u2500 " if is_last else "\u251c\u2500 "
    label = _tree_node_label(node)
    val_str = format_metric_value(metric, node["value"])
    line = (f"{prefix}{connector}{label:<26} {val_str:>13}  "
            f"{_pct_of(node['share_of_parent'])} of parent  "
            f"{_pct_of(node['share_of_session'])} of session")
    print(line)
    children = list(node.get("children") or [])
    if node.get("other"):
        children.append(node["other"])
    child_prefix = prefix + ("   " if is_last else "\u2502  ")
    for i, child in enumerate(children):
        _print_tree_node(child, metric, child_prefix, i == len(children) - 1)


def render_cost_tree(cost_tree):
    """One nested du-style tree per PRIMARY_METRICS root. Nesting order is a
    DISPLAY CHOICE (stated below), never a causal claim: a node's children
    plus its 'Other' rollup sum back to that node's own value exactly, at
    every level (raw-value reconciliation, not rounded)."""
    order = cost_tree["order"][:cost_tree["depth"]]
    print(f"\n-- Cost tree (order: {' > '.join(order)}, depth {cost_tree['depth']}, "
          f"top {cost_tree['top']}) --")
    print("  Each node: absolute value, % of its own parent node, % of that "
          "metric's session total.")
    for root in cost_tree["roots"]:
        metric = root["metric"]
        if root["skipped"]:
            print(f"  {metric:26} (skipped: zero total this scope)")
            continue
        val_str = format_metric_value(metric, root["value"])
        print(f"  {metric:26} {val_str:>13}  100.0% of session")
        children = list(root.get("children") or [])
        if root.get("other"):
            children.append(root["other"])
        for i, child in enumerate(children):
            _print_tree_node(child, metric, "  ", i == len(children) - 1)


def render_human(session_id, root_only, snapshot_ts, active, warnings, report, no_tree=False):
    print("=" * 92)
    print(f"Copilot CLI session cost report")
    print(f"session_id      : {session_id}")
    print(f"scope           : {'root only' if root_only else 'root + subagents'}")
    print(f"snapshot cutoff : {snapshot_ts}")
    print(f"session active  : {'yes (numbers will keep changing)' if active else 'no lock found'}")
    print("=" * 92)

    if warnings:
        print("\nWarnings:")
        for w in warnings:
            print(f"  - {w}")

    t = report["totals"]
    print("\n-- Totals --")
    print(f"  calls={t['calls']}  input={t['input_tokens']}  output={t['output_tokens']}  "
          f"cache_read={t['cache_read_tokens']}  cache_write={t['cache_write_tokens']}  "
          f"reasoning={t['reasoning_tokens']}")
    print(f"  AI credits: {t['ai_credits']}")

    print("\n-- By model --")
    for model, m in sorted(report["by_model"].items(), key=lambda kv: -kv[1]["ai_credits"]):
        print(f"  {model:24} calls={m['calls']:5} input={m['input_tokens']:>10} "
              f"output={m['output_tokens']:>8} cache_read={m['cache_read_tokens']:>10} "
              f"cache_write={m['cache_write_tokens']:>9} credits={m['ai_credits']:>9}")

    if "root_vs_subagent" in report:
        r = report["root_vs_subagent"]["root"]
        s = report["root_vs_subagent"]["subagents"]
        print("\n-- Root vs subagents --")
        print(f"  root      : calls={r['calls']:5} credits={r['ai_credits']}")
        print(f"  subagents : instances={s['subagent_instance_count']:3} "
              f"calls={s['calls']:5} credits={s['ai_credits']}")

    if "cost_estimate" in report:
        c = report["cost_estimate"]
        print("\n-- Cost estimate (NOT A BILL — see disclaimer) --")
        print(f"  rate: 1 credit = {c['nano_aiu_per_credit']:.0f} nano-AIU, "
              f"1 credit = ${c['usd_per_credit']}")
        print(f"  {c['ai_credits']} credits ~ ${c['usd_equivalent']} AI-credit-equivalent")
        print(f"  {c['disclaimer']}")

    render_overall_token_mix(report["overall_token_mix"])

    if not no_tree:
        render_cost_tree(report["cost_tree"])

    # TOKEN TYPE IS THE PRIMARY AXIS: the concentration section is organized
    # metric-first (one block per token type / calls / ai_credits), each
    # listing which secondary-dimension items (model, agent, initiator,
    # time_bucket) crossed the threshold for THAT metric — never the other
    # way around.
    threshold_pct = report["hotspot_threshold"] * 100
    hotspots = report.get("hotspots", [])
    by_metric = {m: [] for m in PRIMARY_METRICS}
    for h in hotspots:
        by_metric[h["metric"]].append(h)

    print(f"\n-- Cost concentration (share > {threshold_pct:.0f}%) --")
    print("  Share = item value / that metric's OWN session total (metrics are never summed).")
    any_flag = False
    for metric in PRIMARY_METRICS:
        flags = sorted(by_metric[metric], key=lambda h: -h["share"])
        if not flags:
            continue
        any_flag = True
        print(f"  {metric}:")
        for h in flags:
            value_str = format_metric_value(metric, h["value"])
            print(f"    [{h['dimension']:11}] {human_label(h['dimension'], h['item']):20} "
                  f"{h['share'] * 100:5.1f}% ({value_str})")
    if not any_flag:
        print(f"  No item in model/agent/initiator/time_bucket exceeded {threshold_pct:.0f}% "
              "share for any metric.")
    if report.get("skipped_metrics"):
        print(f"  (skipped, zero total this scope: {', '.join(report['skipped_metrics'])})")

    print("\n-- Top improvement opportunities --")
    ranked = report.get("ranked_opportunities", [])
    if not ranked:
        print(f"  No candidate crossed the {threshold_pct:.0f}% threshold.")
    else:
        max_also_shown = 2  # keep each line scannable; JSON keeps the full list
        for c in ranked:
            main_val = format_metric_value(c["main_metric"], c["main_metric_value"])
            parts = [f"main {c['main_metric']} {c['main_metric_share'] * 100:.1f}% ({main_val})"]
            if c["main_metric"] != "ai_credits":
                parts.append(f"ai_credits {c['ai_credits_share'] * 100:.1f}% "
                             f"({c['ai_credits_value']:g} credits)")
            shown = c["other_flagged_metrics"][:max_also_shown]
            for o in shown:
                v = format_metric_value(o["metric"], o["value"])
                parts.append(f"also {o['metric']} {o['share'] * 100:.1f}% ({v})")
            hidden = len(c["other_flagged_metrics"]) - len(shown)
            if hidden > 0:
                parts.append(f"(+{hidden} more flagged metric{'s' if hidden > 1 else ''})")
            print(f"  {c['rank']}. [{c['dimension']}] {human_label(c['dimension'], c['item'])} : "
                  + "  ".join(parts))
            if c["score_note"]:
                print(f"     note: {c['score_note']}")

    print("\nNotes:")
    print(f"  - {CACHE_READ_NUANCE}")
    print(f"  - {TOKEN_SHARE_BILLING_NOTE}")
    print()


def main(argv=None):
    args = parse_args(argv)
    con = open_ro(args.store, "session-store.db")

    if args.list_sessions:
        list_known_sessions(con, args.state_dir)
        return 0

    session_id, resolve_warnings = resolve_session_id(args.session_id, con, args.state_dir)
    snapshot_ts = args.snapshot or datetime.now(timezone.utc).isoformat()
    active = is_session_active(session_id, args.state_dir)

    rates, rate_warnings = load_rates(args)
    rows, col_names, has_agent_id, has_initiator, token_col_available, query_warnings = query_usage(
        con, session_id, snapshot_ts, args.root_only)
    report = build_report(rows, col_names, has_agent_id, has_initiator, token_col_available,
                           args.root_only, rates, args.no_dollar_estimate,
                           args.hotspot_threshold, args.top_opportunities,
                           args.tree_depth, args.tree_top, args.tree_order)

    warnings = resolve_warnings + rate_warnings + query_warnings
    warnings.extend(report.get("overall_token_mix", {}).get("warnings", []))
    if report.get("skipped_metrics"):
        warnings.append("Metrics with a zero total in this scope are skipped in cost-"
                         f"concentration analysis: {', '.join(report['skipped_metrics'])}.")
    if report.get("time_bucket_dropped_rows"):
        warnings.append(f"{report['time_bucket_dropped_rows']} row(s) had an unparsable "
                         "created_at and were excluded from the time_bucket dimension. The "
                         "cost tree still accounts for them under the real "
                         f"{UNKNOWN_TIME_LABEL} label.")
    if args.tree_depth > len(args.tree_order):
        warnings.append(f"--tree-depth {args.tree_depth} clamped to {len(args.tree_order)} "
                         "(the length of --tree-order).")
    if active:
        warnings.append("Session is currently active (lock file present): counts will keep "
                         "growing after this snapshot, including from running this report.")

    if args.json:
        out = {
            "session_id": session_id,
            "root_only": args.root_only,
            "snapshot_ts": snapshot_ts,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "session_active": active,
            "warnings": warnings,
            "report": report,
        }
        print(json.dumps(out, indent=2))
    else:
        render_human(session_id, args.root_only, snapshot_ts, active, warnings, report,
                     args.no_tree)
    return 0


if __name__ == "__main__":
    sys.exit(main())
