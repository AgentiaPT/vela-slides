# Vela Eval Orchestrator

You are running a Vela skill eval benchmark. Follow these steps exactly.

## Setup

1. Read `evals/eval-scenarios.json` for scenario definitions
2. Run: `bash evals/run.sh init --version VERSION --reps REPS --model MODEL`
3. For each (version, scenario, rep) tuple, execute steps below

## Per-Run Execution

For each run (version V, scenario S, rep R):

### Step 1: Update progress
```bash
bash evals/run.sh current --version V --scenario S --rep R --step create
```

### Step 2: Copy fixture (for edit scenarios with fixture field)
If the scenario has a `"fixture"` field, copy it before running:
```bash
cp evals/fixtures/<fixture>.json evals/output/eval-deck.json
```

### Step 3: Spawn a BLIND scenario subagent
Spawn a subagent with:
- **System prompt**: The SKILL.md from `evals/skills/V/SKILL.md`
- **User prompt**: The scenario's `prompt` field from eval-scenarios.json
- **Important**: The subagent must NOT see other versions, scenarios, or eval infrastructure
- Track the subagent's token usage and duration via deltas

### Step 4: Record metrics
```bash
bash evals/run.sh record --version V --scenario S --rep R \
    --total-tokens TOKENS --tool-uses TOOLS --duration-ms DURATION
```

### Step 5: Validate
```bash
bash evals/run.sh validate --version V --scenario S --rep R
```

### Step 6: Deterministic quality
```bash
python3 evals/scripts/quality.py evals/output/eval-deck.json --json
```

### Step 7: Judge quality (spawn BLIND judge subagent)
Spawn a separate subagent with:
- **System prompt**: Contents of `evals/prompts/judge-rubric.md`
- **User prompt**: Output of `python3 evals/scripts/judge.py evals/output/eval-deck.json --prompt`
- **Max turns**: 1 (single response, no tools needed)
- **Important**: Judge must NOT see the scenario prompt, SKILL.md, or version info
- Parse response: `python3 evals/scripts/judge.py --parse-response <response>`

### Step 8: Store judge scores
```bash
bash evals/run.sh judge --version V --scenario S --rep R --scores-json 'JUDGE_JSON'
```

## Finalization

1. Generate report: `bash evals/run.sh report`
2. Run gate (if baseline exists): `python3 evals/scripts/gate.py evals/results/ --baseline evals/baselines/latest.json`
3. Finish: `bash evals/run.sh finish`

## Key Principles

- **Blind subagents**: Scenario agents see only SKILL.md + prompt. Judge agents see only deck + rubric. No cross-contamination.
- **Sequential within version**: Run all reps for one version before moving to the next
- **Track costs via deltas**: Note token counts before/after each subagent spawn
- **Fixture-based edits**: Edit scenarios use pre-built fixture decks, not chained from create runs
