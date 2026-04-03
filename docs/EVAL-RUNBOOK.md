# Vela Eval Runbook

> How to benchmark skill versions with blind A/B comparison. This doc contains everything needed to run evals without re-exploring the codebase.

## TL;DR — Run a Full A/B Eval

```bash
# 1. Set up new version in evals/skills/
mkdir -p evals/skills/v<NEW>
cp skills/vela-slides/SKILL.md evals/skills/v<NEW>/SKILL.md

# 2. Run both versions (n=1 for quick, n=3+ for statistical power)
REPS=1 MODEL=sonnet TIMEOUT=300 bash evals/run-isolated.sh live
REPS=1 MODEL=sonnet TIMEOUT=300 bash evals/run-isolated.sh v<NEW>

# 3. Generate comparison report
python3 evals/scripts/report.py evals/results/

# 4. Run blind A/B LLM judge on each matching scenario
# See "A/B Judging" section below

# 5. Regression gate
python3 evals/scripts/gate.py evals/results/
```

## Directory Layout

```
evals/
├── eval-scenarios.json      ← 14 scenarios (6 create, 6 edit, 2 load)
├── run-isolated.sh          ← Main runner: isolates each run in /tmp
├── fixtures/                ← Deck fixtures for edit scenarios
│   ├── fixture-30.json      ← 30-slide deck
│   └── malformed-deck.json  ← Broken deck for error recovery
├── skills/                  ← SKILL.md versions to compare
│   ├── live/SKILL.md        ← Current production version
│   ├── v12.3/SKILL.md       ← Historical versions...
│   └── v<NEW>/SKILL.md      ← New version under test
├── results/                 ← Output: per-version subdirs with run JSONs + deck copies
├── prompts/
│   ├── judge-rubric.md      ← Single-deck scoring (3-point, 5 dimensions)
│   └── judge-ab-rubric.md   ← A/B blind comparison rubric
└── scripts/
    ├── harvest.py           ← JSONL → token/cost metrics
    ├── validate.py          ← Assertion checker (9 types)
    ├── quality.py           ← Deterministic quality metrics (no LLM)
    ├── judge.py             ← LLM judge (single + A/B blind)
    ├── report.py            ← Cross-version comparison tables
    ├── analyze-results.py   ← Detailed cost/token analysis
    ├── gate.py              ← Regression gate (thresholds)
    └── baseline.py          ← Save/load baselines
```

## Versions

- **live**: `evals/skills/live/SKILL.md` — current production (check version in frontmatter)
- **Current app**: `skills/vela-slides/SKILL.md` — version matches `VELA_VERSION` in `part-imports.jsx`
- Historical: `evals/skills/v2.3/` through `v12.3/`

To compare current vs live, copy current SKILL.md into `evals/skills/v<VERSION>/`.

## run-isolated.sh — The Main Runner

**Environment variables:**

| Var | Default | Purpose |
|-----|---------|---------|
| `REPS` | 2 | Repetitions per scenario |
| `MODEL` | sonnet | Claude model |
| `MAX_TURNS` | 12 | Max agent turns per run |
| `TIMEOUT` | 180 | Per-run timeout (seconds) |
| `SCENARIOS_FILTER` | all non-holdout | Comma-separated scenario IDs |

**Usage:**

```bash
# Single version, all scenarios
REPS=1 bash evals/run-isolated.sh v12.25

# Single scenario
REPS=1 bash evals/run-isolated.sh v12.25 create-5

# Single run (version, scenario, rep number)
bash evals/run-isolated.sh v12.25 create-5 1

# All versions
bash evals/run-isolated.sh all
```

**What it does per run:**
1. Creates `/tmp/vela-eval/<version>/<scenario>-run<N>/` with isolated workdir
2. Sets up `.claude/skills/vela-slides/SKILL.md` + symlinks to scripts/refs/app
3. Extracts `effort:` from SKILL.md frontmatter, passes `--effort` flag
4. Runs `claude -p "<prompt>" --model $MODEL --max-turns $MAX_TURNS --output-format json`
5. Extracts token counts, cost, duration from JSON output
6. Validates assertions against produced deck
7. Runs deterministic quality scoring
8. Saves result JSON + deck copy to `evals/results/<version>/`

**Output per run:** `evals/results/<version>/<scenario>-run<N>.json` containing:
- `session_id`, `model`, `version`, `scenario`, `rep`
- `totals`: input/output/cache tokens, cost_usd, tool_calls, duration_s
- `assertions`: passed/total + per-assertion results
- `quality.deterministic`: block_diversity, types_used, entropy, etc.

Deck copy: `evals/results/<version>/<scenario>-run<N>-deck.json`

## Scenarios (14 total, 12 non-holdout)

### Create (6)

| ID | Slides | Difficulty | Key assertions |
|----|--------|-----------|----------------|
| `create-30` | 30 | Hard | slide_count(30), 11+ block types, format_compact |
| `create-5` | 5 | Easy | slide_count(5), icon-row/flow/metric |
| `create-blocks` | 21 | Hard | All 21 block types present |
| `create-compact` | 6 | Medium | slide_count(6), format_compact |
| `create-multi-module` | 12 | Medium | slide_count(12), 3 lanes, text_present |
| `create-ship-serve` | 10 | Medium | JSON+JSX output, slide_count(10) |

### Edit (6)

| ID | Fixture | Difficulty | Key assertions |
|----|---------|-----------|----------------|
| `edit-translate` | fixture-30 | Hard | slide_count(30), Portuguese text |
| `edit-improve` | fixture-30 | Medium | Enhance slides 4,11,30 |
| `edit-rebrand` | fixture-30 | Medium | Light theme colors |
| `edit-delete` | fixture-30 | Medium | slide_count(23) |
| `edit-add` | fixture-30 | Medium | slide_count(35), "Security" text |
| `edit-error-recovery` | malformed | Hard | Fix broken deck |

### Load (2 — 1 holdout)

| ID | Holdout | Notes |
|----|---------|-------|
| `load-sample` | No | `vela deck ship --sample` |
| `create-ambiguous` | **Yes** | Vague prompt, tests generalization |

## Assertion Types

- `file_exists` — File at path exists
- `json_valid` — Valid JSON structure
- `slide_count` — Expected number of slides (exact match)
- `block_type_present` — Specific block type used anywhere in deck
- `ships_ok` — Deck has >0 slides (structural validity)
- `format_compact` — Uses compact keys (`S`/`G`/`_`) not verbose (`lanes`/`type`)
- `text_present` — Case-insensitive text found in raw deck JSON
- `text_not_present` — Text NOT in deck JSON

## Quality Metrics (Deterministic, No LLM)

Run: `python3 evals/scripts/quality.py <deck.json> --json`

Returns: `block_diversity` (0-1), `block_types_used`, `block_type_entropy` (Shannon), `theme_variety`, `heading_rate`, `badge_rate`, `words_per_slide`, `blocks_per_slide`, `slide_count`.

## A/B Judging (Blind LLM Comparison)

The judge system uses `evals/scripts/judge.py` + `evals/prompts/judge-ab-rubric.md`.

### How It Works

1. **Generate prompt**: `judge.py --ab <deck_a> <deck_b> --prompt` — randomizes order, outputs prompt + saves mapping to `evals/output/ab-mapping.json`
2. **Run blind subagent**: Send the prompt as user message with `judge-ab-rubric.md` as system prompt. The judge has NO access to version info, scenario, or SKILL.md.
3. **Parse response**: `judge.py --ab-parse <response.json>` — validates JSON, normalizes winners
4. **Resolve**: `resolve_ab_result(parsed, mapping)` — unswaps to map "Deck 1"/"Deck 2" back to original files

### Manual A/B Judging Flow

For each scenario that produced decks in both versions:

```bash
# 1. Generate blind A/B prompt (order randomized)
python3 evals/scripts/judge.py --ab \
  evals/results/live/<scenario>-run1-deck.json \
  evals/results/v12.25/<scenario>-run1-deck.json \
  --prompt > /tmp/ab-prompt.txt

# 2. Run as blind judge subagent via claude -p
claude -p "$(cat /tmp/ab-prompt.txt)" \
  --system-prompt "$(cat evals/prompts/judge-ab-rubric.md)" \
  --model sonnet --max-turns 1 \
  --output-format json > /tmp/ab-response.json

# 3. Parse response (extract JSON from result field)
# The response is claude -p JSON — extract the text, feed to --ab-parse

# 4. Resolve: read mapping from evals/output/ab-mapping.json, apply to parsed result
```

### A/B Judge Output Format

```json
{
  "dimensions": {
    "structural": {"winner": "1"|"2"|"tie", "reasoning": "..."},
    "visual_hierarchy": {"winner": "1"|"2"|"tie", "reasoning": "..."},
    "content_quality": {"winner": "1"|"2"|"tie", "reasoning": "..."},
    "block_variety": {"winner": "1"|"2"|"tie", "reasoning": "..."},
    "brand_consistency": {"winner": "1"|"2"|"tie", "reasoning": "..."}
  },
  "overall_winner": "1"|"2"|"tie",
  "overall_reasoning": "..."
}
```

### Single-Deck Judge (Non-A/B)

```bash
python3 evals/scripts/judge.py <deck.json> --deterministic-only --json  # Free metrics
python3 evals/scripts/judge.py <deck.json> --prompt                     # Generate judge prompt
```

Scores on 3-point scale across 5 dimensions: structural, visual_hierarchy, content_quality, block_variety, brand_consistency. Overall = mean of 5 scores.

## Analysis & Reporting

```bash
# Cross-version comparison table (mean, CI, Cohen's d)
python3 evals/scripts/report.py evals/results/
python3 evals/scripts/report.py evals/results/ --markdown

# Detailed token/cost breakdown
python3 evals/scripts/analyze-results.py evals/results/

# Regression gate (blocks if cost +20%, quality -0.5, etc.)
python3 evals/scripts/gate.py evals/results/

# Save baseline for future comparison
python3 evals/scripts/baseline.py save v12.25
```

## Pricing Model (Sonnet, as of March 2026)

| Token Type | $/MTok |
|-----------|--------|
| Input | $3.00 |
| Output | $15.00 |
| Cache Read | $0.30 |
| Cache Write | $3.75 |

## Smoke Tests (Quick Comparison)

```bash
bash evals/scripts/smoke-test.sh "Make a deck about AI" v6.0 v12.25
```

Quick single-prompt comparison without full scenario assertions.

## Result Persistence

Eval results in `evals/results/` are **committed to git** so previous version results are reusable. When running a new version comparison, you only need to run the new version — prior results are already saved.

After running evals, commit the results:
```bash
git add evals/results/<version>/
git commit -m "eval: add results for v<VERSION>"
```

## Typical Workflow

1. Make changes to `skills/vela-slides/SKILL.md` (bump version)
2. Copy to `evals/skills/v<NEW>/SKILL.md`
3. Run: `REPS=1 bash evals/run-isolated.sh live` then `REPS=1 bash evals/run-isolated.sh v<NEW>`
4. Check results: `python3 evals/scripts/report.py evals/results/`
5. For deeper comparison, run A/B judge on each scenario's deck pair
6. Gate check: `python3 evals/scripts/gate.py evals/results/`
7. If passing, update `evals/skills/live/SKILL.md` with new version
