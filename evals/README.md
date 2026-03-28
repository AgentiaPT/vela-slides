# Vela Eval

Benchmark the Vela slides skill across versions in Claude Code.

## What It Measures

| Metric | Source | Why |
|---|---|---|
| Input tokens | JSONL `usage.input_tokens` | SKILL.md size overhead |
| Output tokens | JSONL `usage.output_tokens` | Compact format savings |
| Cache read/write | JSONL `usage.cache_*` | Prompt caching efficiency |
| Cost ($) | Computed from tokens | Bottom line |
| Duration (s) | JSONL timestamps | Time to completion |
| Tool calls | JSONL content blocks | CLI usage efficiency |
| Assertions pass/fail | validate.py | Correctness |
| Quality (1-5) | LLM-as-judge (optional) | Deck quality |

## Versions Tested

| Version | Format | Key Feature |
|---|---|---|
| **v2.3** | Full JSON | Baseline — no compact format |
| **v2.4** | Compact | Short keys + themes + spacer ints (~30% fewer bytes) |
| **v2.5.1** | Compact + palette | + Color palette `$A`→`#hex` + leaner SKILL.md (~32% fewer bytes) |

## Usage

```bash
# Full benchmark
chmod +x run.sh
./run.sh

# Single version
./run.sh v2.5.1

# Single version + scenario
./run.sh v2.5.1 create-6

# More repetitions
REPS=5 ./run.sh

# Just the report (after runs)
python3 scripts/report.py results/
python3 scripts/report.py results/ --markdown
```

## Requirements

- Claude Code CLI (`claude` command)
- Python 3.8+
- Vela CLI (`vela` — installed by the skill)
- `jq` (for shell script)

## Data Flow

```
claude -p (with skill SKILL.md appended)
    ↓ creates JSONL session log
harvest.py (parses JSONL)
    ↓ extracts per-turn token metrics
validate.py (checks deck output)
    ↓ assertion pass/fail
report.py (compares across versions)
    ↓ comparison table + markdown
```
