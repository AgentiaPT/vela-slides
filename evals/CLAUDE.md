# Vela Eval — Skill Version Benchmarking

> **See [RESEARCH.md](RESEARCH.md) for full session findings and methodology.**

## Quick Start

```bash
# Smoke test: compare versions with any prompt
bash evals/scripts/smoke-test.sh "Make a deck about AI" v6.0 v7.0

# Full eval: formal run with assertions
REPS=3 MODEL=sonnet TIMEOUT=300 bash evals/run-isolated.sh v6.0 create-compact

# Analyze results
python3 evals/scripts/analyze-results.py evals/results/

# Run all non-holdout scenarios for a version
REPS=2 bash evals/run-isolated.sh v6.0
```

## Architecture

```
evals/
├── RESEARCH.md            ← Full session findings (18 bugs, methodology, results)
├── CLAUDE.md              ← You are here
├── eval-scenarios.json    ← 14 scenarios + assertions (6 create, 6 edit, 2 load)
├── fixtures/              ← Deck fixtures for edit scenarios
├── skills/                ← SKILL.md versions to compare (v2.3 through v7.0 + live)
├── results/               ← Per-version result JSONs + deck copies
├── reports/               ← Timestamped eval reports
├── prompts/               ← Judge rubrics (single + A/B)
├── scripts/
│   ├── smoke-test.sh      ← Quick version comparison with any prompt
│   ├── analyze-results.py ← Detailed cost/token/quality analysis
│   ├── quality.py         ← Deterministic quality scoring
│   ├── judge.py           ← LLM judge (blind, randomized)
│   ├── report.py          ← Cross-version comparison tables
│   └── ...                ← harvest.py, gate.py, validate.py, etc.
└── run-isolated.sh        ← Main eval runner (real skill discovery, /tmp isolation)
```

## Key Methodology

1. **Real skill discovery** — `.claude/skills/vela-slides/` directory, not `--system-prompt`
2. **Workdirs in `/tmp`** — prevents CLAUDE.md contamination from repo
3. **vela.py preserves compact** — validate/ship/assemble use temp files, don't expand on disk
4. **Effort from frontmatter** — runner extracts `effort:` from SKILL.md and passes `--effort`
5. **Blind LLM judges** — randomized deck labels, no version info leaked

## Best Version: v6.0

**Ship v6.0 as production SKILL.md** (3.3KB, compact DSL, -42% cost vs baseline).
Add `effort: low` as optional deployment config for speed-sensitive use cases.

## Pricing (Sonnet)

| Token Type | Price/MTok |
|-----------|-----------|
| Input | $3.00 |
| Output | $15.00 |
| Cache Read | $0.30 |
| Cache Write | $3.75 |
