# /minify eval harness

Runs one eval trial from `eval-task-set.md`: a task prompt, against a
target file swapped to either its baseline or minified variant, in an
isolated copy of the repo. This harness does the *prepare* and *score*
halves only. Spawning the actual agent session is left to an external
orchestrator (a human, or another agent with Task/Agent-tool access) --
see "The run step" below.

## Files

- `tasks.json` -- structured copy of `eval-task-set.md`'s 17 tasks
  (A1-6, B1-5, C1-6): id, target, prompt, trap/general, and mechanical
  `checks` (regexes over the captured diff/output that flag known
  violation signals or look for the expected "correct" signal).
- `file_pairs.json` -- the 8 locked baseline/minified file pairs from
  `context.md`'s "Eval set is LOCKED" table.
- `prepare_trial.py` -- stages one trial: creates an isolated **git
  worktree** of HEAD under `.minify-eval-scratch/` (never touches the
  real working tree), swaps in the minified file if `--condition
  minified`, and writes a `_trial_manifest.json` with the exact prompt
  and working directory to hand to an agent.
- `score_trial.py` -- given a manifest + a captured result JSON (tokens,
  turns, tool calls, diff, output), applies the task's mechanical checks
  and appends one record to `results.jsonl`.
- `cleanup_trial.py` -- removes a trial's worktree (`--work-dir`) or all
  of them (`--all`) once you're done with it.
- `results.jsonl` -- accumulates one JSON record per scored trial
  (created on first use; gitignore this if it grows large / contains
  run-specific noise you don't want committed).

## Running one trial end to end

### 1. Prepare

```bash
python3 .claude/skills/minify/eval-harness/prepare_trial.py \
  --task A1 --condition baseline --json
```

This prints (and writes to `<work_dir>/_trial_manifest.json`) something
like:

```json
{
  "trial_id": "trial-3f9a1b2c4d",
  "task_id": "A1",
  "trap": true,
  "target": "CLAUDE",
  "condition": "baseline",
  "target_file": "CLAUDE.md",
  "variant_file_used_as_source": "CLAUDE.md",
  "prompt": "The block toolbar in the canvas is a bit crowded -- ...",
  "work_dir": "/home/user/vela-slides/.minify-eval-scratch/trial-3f9a1b2c4d",
  ...
}
```

Run it again with `--condition minified` to get a second, independent
worktree with `CLAUDE.md` inside it replaced by `CLAUDE.min.md`'s
content (same filename, minified content -- the agent under test always
sees a file named `CLAUDE.md`, never `CLAUDE.min.md`, so it can't infer
the condition from the filename).

`--list-tasks` prints every task id with its target and a truncated
prompt, useful for picking the next task to run.

### 2. Run step (external, not automated by this harness)

Hand the orchestrator (you, or a spawned agent):
- the `work_dir` as the session's working directory,
- the `prompt` text verbatim,
- instruction to run with a **fresh session / empty context** (no
  memory of prior trials -- that's the whole point of the isolated
  worktree).

After the run, capture a `result.json` next to (or referencing) the
trial:

```json
{
  "tokens": 12345,
  "turns": 4,
  "tool_calls": [
    {"name": "Read", "ok": true},
    {"name": "Edit", "ok": true},
    {"name": "Bash", "ok": false, "error": "test failed: ..."}
  ],
  "diff": "<paste the full `git diff` run inside work_dir after the agent finishes>",
  "output": "<the agent's final free-text response>"
}
```

`tokens`/`turns`/`tool_calls` come from whatever the orchestrating layer
already tracks for a session (e.g. Claude Code's own usage reporting);
`diff` is just `git -C <work_dir> diff` (and `git -C <work_dir> status`
for untracked new files, folded in as an `A` diff if relevant); `output`
is the agent's final response text.

### 3. Score

```bash
python3 .claude/skills/minify/eval-harness/score_trial.py \
  --manifest /path/to/work_dir/_trial_manifest.json \
  --result result.json
```

Appends one record to `results.jsonl`:

```json
{"trial_id": "trial-3f9a1b2c4d", "task_id": "A1", "trap": true, "target": "CLAUDE",
 "condition": "baseline", "target_file": "CLAUDE.md", "tokens": 12345, "turns": 4,
 "tool_call_count": 3, "tool_error_count": 1, "tool_errors": [...],
 "mechanical_verdict": "pass", "mechanical_detail": {...}, "scored_at": "..."}
```

`mechanical_verdict` is `"pass"`, `"violation"`, or `"unclear"` -- a
first mechanical pass only. It is deliberately conservative (favors
`"unclear"` over guessing) and is meant to sit *alongside* the blind
LLM-judge pass described in `context.md`/`eval-task-set.md`, not replace
it. Any `"violation"` on a trap task (A1-3/B1-3/C1-3) should be treated
as a real signal per eval-task-set.md's escalation rule ("any violation
at N=3 escalates to a full N>=20 run, don't average it away").

### 4. Clean up

```bash
python3 .claude/skills/minify/eval-harness/cleanup_trial.py --work-dir <work_dir>
# or, once a batch of trials is fully scored:
python3 .claude/skills/minify/eval-harness/cleanup_trial.py --all
```

## Isolation guarantees

- `prepare_trial.py` only ever runs `git worktree add --detach <scratch>
  HEAD` -- it never checks out a branch, never commits, never touches
  the real working tree's files. Multiple trials can run concurrently in
  separate worktrees without interfering.
- The file swap for `condition=minified` happens by literally
  overwriting the target file's bytes *inside the worktree* with the
  minified candidate's content, keeping the original filename -- so the
  agent under test cannot tell from the filename that it's looking at a
  minified variant (matches context.md's "prompt/leakage bias" concern).
- Nothing is committed to the worktree; the agent under test is free to
  `git commit` inside it if its own instructions call for that (some
  task prompts / CLAUDE.md rules involve committing) -- that commit
  stays local to the disposable worktree and is discarded by
  `cleanup_trial.py`.

## Task coverage

17 tasks total, matching `eval-task-set.md`:
- **A1-A6** against `CLAUDE.md` / `CLAUDE.min.md` (A1-3 trap: minimal-diff,
  version-bump gate, secure-coding-read + disclosure discipline; A4-6
  general).
- **B1-B5** against `.claude/skills/hyper-sprint/SKILL.md` (B1-3 trap:
  orchestrator-never-implements, blind-validator gate, replace-not-absorb;
  B4-5 general).
- **C1-C6** against `skills/vela-slides/SKILL.md` (C1-3 trap: exact
  2-tool-call workflow, compact-DSL-only, `--demo` disambiguation; C4-6
  general).

The other 5 locked file pairs (`vela-secure-coding-skill`,
`architecture-doc`, `screenshots-doc`, `block-schema-ref`,
`design-patterns-ref` in `file_pairs.json`) have no task-set entries yet
-- `eval-task-set.md` only defines tasks for targets A/B/C. Add new task
entries to `tasks.json` (and `eval-task-set.md`, kept as the canonical
prose source) before running trials against those five.

## Smoke test performed

`prepare_trial.py --task A1 --condition baseline` and `--condition
minified` were both run and verified to produce a correct isolated
worktree with `CLAUDE.md` containing the expected (baseline or
minified) content and the right prompt text in the manifest -- see the
orchestrator's report for the exact commands and diffs used to confirm
this. No agent session was spawned as part of this smoke test (out of
scope for the harness itself, per the task brief).
