---
name: copilot-session-cost
description: Calculate local Copilot session cost.
allowed-tools: Read, Bash(python3 .claude/skills/copilot-session-cost/scripts/*)
---

# Copilot session cost report

This skill runs one read-only script,
`scripts/session-cost-report.py`. The script reads local Copilot CLI
storage only:

- `~/.copilot/session-store.db` (table `assistant_usage_events`)
- `~/.copilot/session-state/<id>/` (used only to find the active session)

It reports call counts, token counts (input, output, cache-read,
cache-write, reasoning), a per-model breakdown, and root-vs-subagent
totals, in AI credits. It also reports **cost concentration**: per
primary metric (token type, calls, AI credits), which model, agent,
initiator, or time window holds an outsized share of that metric.

## Overall token mix

Before the concentration drilldown, the report shows a concise
**overall token mix** that still gives all 5 recorded counters
(input, output, cache-read, cache-write, reasoning) a visible
percentage or ratio — but never claims they form one partition:

- **Top-level**: `input_tokens` and `output_tokens` as a percentage of
  their own sum. This is the one safe, non-overlapping pair — neither
  field can include the other.
- **Cache ratios**: `cache_read_tokens` and `cache_write_tokens`, EACH
  shown as its own independent ratio to `input_tokens` — shown only
  when the schema has real cache columns and `input_tokens > 0`. The
  two ratios are not claimed to sum to 100%.
- **Reasoning ratio**: `reasoning_tokens` shown as its own ratio to
  `output_tokens` — shown only when the schema has a real
  `reasoning_tokens` column and `output_tokens > 0`.

**No uncached-input or non-reasoning remainder is ever inferred.**
Counter semantics (whether cache-read/cache-write/reasoning tokens are
already included in input/output accounting) depend on the model, and
this repository has no documented contract that fixes that semantics.
A session total can mix rows from several models, so an aggregate
inequality happening to hold (e.g. `cache_read + cache_write <=
input_tokens`) is not proof the counters are disjoint for that mix —
treating it as proof was a past bug. So the cache and reasoning ratios
are always shown as independent ratios once their denominator is
usable; they are never subtracted from a whole to invent an
"uncached" or "non-reasoning" count. If the combined ratio happens to
exceed 100%, a warning notes this is expected when a session mixes
models with different counter semantics — but the ratio is still
shown, not hidden.

A ratio is omitted only when its denominator is 0 or the underlying
column is missing from this local schema — never when a numerator is
"too large", since that is exactly the case the ratio (not a
partition) is designed to report safely. The JSON report carries this
as a stable `overall_token_mix` object (`top_level`, `cache_ratios`,
`reasoning_ratio`, `overlap_note`, `warnings`) alongside all existing
fields. Any sum across these overlapping counters, if ever shown, is
labeled as raw counter volume only — never as a unique-token total or
a token composition.

## Cost tree

A `du`-style nested tree, one per primary metric root, in this fixed
order: `input, output, cache-read, cache-write, reasoning, calls,
ai_credits` (same order and same zero-total skip rule as the
concentration section below). Each root nests **one dimension at a
time**, in `--tree-order` sequence (default `model, agent, initiator,
time_bucket`) — a true partition, not four parallel 100%-of-root
facets, so a node's children always sum back (plus `Other`) to that
node's own value. The nesting order is a display choice, stated in
every tree header, never a causal claim.

Every node shows its absolute value, its share of its own parent node,
and its share of that metric's session total. **Exact raw
reconciliation holds at every node:** `sum(shown children) + Other ==
parent`, computed from raw integer/nano-AIU sums — never from rounded
display values. Ties sort by value descending, then by label
ascending, so output is deterministic.

CLI flags:
- `--tree-depth N` (1-4, default 2): nested levels to expand. Capped
  at `len(--tree-order)` if that list is shorter; a warning notes the
  clamp.
- `--tree-top N` (1-20, default 5): branches shown per node before the
  remainder rolls into `Other`. `Other`'s value is the exact raw
  remainder, never a second, independently-rounded sum.
- `--tree-order LIST`: comma-separated, duplicate-free nesting
  sequence drawn from `model, agent, initiator, time_bucket`. An
  unknown or repeated name exits with code 2.
- `--no-tree`: omit the "Cost tree" section from **human** output
  only. JSON always includes `cost_tree`.

A genuinely missing/unknown value (a column absent from this schema,
an empty field on one row, an unparsable timestamp) gets its own real,
stable label — `(unavailable)`, `(unknown)`, `(unknown model)`,
`(unknown time)` — and competes normally for a spot in the top-N. It
is never silently folded into the synthetic `Other` rollup, which
exists only to represent branches omitted by `--tree-top`.

Time-bucket labels always carry the full date on both edges (not just
`HH:MM:SS`), so a window spanning midnight still reads in
chronological order; each bucket's exact ISO start/end is also kept in
JSON (`dimensions.time_bucket.bucket_bounds`, and
`cost_tree.time_bounds`), never only embedded in the label text.

## Cost-concentration analysis

**Token type is the primary axis.** Every share is one item's value
divided by that SAME metric's own session total — metrics are never
summed into one fake total, because cache fields can overlap input
accounting. A metric with a zero total is skipped everywhere (no
share, no flag).

Secondary (drill-down) dimensions, built only from safe, content-free
local columns:
- **model** — the `model` column.
- **agent** — `root` (agent_id is null) plus one row per distinct
  `agent_id` (an opaque tool-call id, never task/prompt content).
- **initiator** — `user | agent | sub-agent | compaction | (unknown)`.
- **time_bucket** — 6 equal-width windows spanning the in-scope rows'
  own timestamps.

A dimension item is a **hotspot** only when its share is strictly
greater than `--hotspot-threshold` (a percentage, default 20) AND its
dimension has at least 2 distinct items. This stops a single-item
dimension — e.g. `agent` under `--root-only`, or a one-event session —
from ever reporting a false 100% hotspot.

`--top-opportunities` (default 4, 1-20) caps the ranked list. Ranking
never repeats one dominant item once per metric: each `(dimension,
item)` pair is one candidate merging all its flagged metrics, scored by
its AI-credit share (falling back to its best token/call share only
when session AI credits total 0), and diversified so different
dimensions appear before any repeat.

**Cache-read nuance:** a high cache-read share often means one agent or
time window is legitimately reusing a large context — a
workload-concentration signal, not automatic proof of waste. A token
share also does not cut the bill by the same share; cache and reasoning
tokens are not priced 1:1 with plain input/output tokens.

## Privacy boundary

The script makes no network call. It does not read prompts, assistant
responses, tool arguments, file paths, task descriptions, or credentials.
It prints only session IDs, timestamps, model names, opaque agent-call
ids, a fixed initiator enum, and numeric usage data. Standard library
only (`sqlite3`, `json`, `argparse`, `glob`, `os`, `sys`, `time`) — no
third-party packages.

## Dollar-equivalent caveat

The script can show a dollar figure. This figure is an AI-credit-equivalent
estimate. **It is not your bill.** Local storage does not keep your plan
or quota state, so the script cannot tell if your usage sits inside an
included allowance or counts as metered overage.

## Common commands

Run from the repository root.

Human-readable report for the current session (root + subagents):
```bash
python3 .claude/skills/copilot-session-cost/scripts/session-cost-report.py
```

JSON report, no dollar estimate:
```bash
python3 .claude/skills/copilot-session-cost/scripts/session-cost-report.py --json --no-dollar-estimate
```

List locally known sessions:
```bash
python3 .claude/skills/copilot-session-cost/scripts/session-cost-report.py --list-sessions
```
This lists only session ID, timestamps, and active state — no branch
name or other free-text field.

Root-conversation-only report for one session ID:
```bash
python3 .claude/skills/copilot-session-cost/scripts/session-cost-report.py --session-id <id> --root-only
```

Custom hotspot threshold (30%) and opportunity count (3):
```bash
python3 .claude/skills/copilot-session-cost/scripts/session-cost-report.py --hotspot-threshold 30 --top-opportunities 3
```

Custom cost tree: nest by agent then model, 3 levels deep, 3 branches
per node:
```bash
python3 .claude/skills/copilot-session-cost/scripts/session-cost-report.py --tree-order agent,model --tree-depth 3 --tree-top 3
```

Human output without the "Cost tree" section (JSON always keeps it):
```bash
python3 .claude/skills/copilot-session-cost/scripts/session-cost-report.py --no-tree
```

Run `--help` for the full option list, including `--store`,
`--state-dir`, and `--rates-file` overrides.

## Tests

Focused stdlib `unittest` tests (synthetic SQLite data only, no real
session content) live at `scripts/test_session_cost_report.py`:
```bash
python3 .claude/skills/copilot-session-cost/scripts/test_session_cost_report.py
```
