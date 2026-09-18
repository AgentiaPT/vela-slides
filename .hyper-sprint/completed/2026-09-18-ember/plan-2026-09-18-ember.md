# Sprint plan — 2026-09-18 "ember" (silent-mode smoke)

## Verbatim invocation

```
/hyper-sprint --silent .hyper-sprint/sprint-2026-09-18-silent-smoke.md
```

Silent mode: ON. Sprint branch `claude/keen-bohr-70l6lu`. Sprint HEAD SHA `9b3b759`.
Base for "before" comparison: `.hyper-sprint/completed/README.md` at `9b3b759`.

## Scope

Docs-only. Three change requests against `.hyper-sprint/completed/README.md`, one per
silent-mode path (ship / decide / park). No app build, no browser, no `VELA_VERSION` bump.

| CR | Summary | Path |
|---|---|---|
| CR-1 | Repair the archive index table + add a check script | ship |
| CR-2 | Make the index easier to scan | decide (under-specified) |
| CR-3 | Link each row to its live cost dashboard | park (no such dashboard exists) |

## Clusters

One cluster only. Both shipped CRs touch the same two files, so file-locality gives a
single work item; parallel worktrees would add cost with no gain (principle 11).

- **C1** — `.hyper-sprint/completed/README.md`, `.hyper-sprint/check-completed-index.py`

## Right-sizing (principle 11)

The sprint has no drivable UI surface, so this run omits the app build, the offline render
and the `burst-bug-hunter` engine. The blind gate is scaled to the change, not relaxed:
**one fresh blind validator** that sees only the CR spec, the file at HEAD and the check
script, and never this sprint's history.

## Gate style / driver style / proof artifact (decided alone — silent mode)

- Gate style: single blind validator (docs-only, one surface).
- Driver style: the committed check script, run by the validator itself.
- Proof artifact: Markdown sprint report at `.hyper-sprint/completed/2026-09-18-ember/README.md`.

## What happened vs plan

- CR-1 and CR-2 landed in one commit as planned (`c92335c`); CR-3 parked at intake as planned.
- Blind gate round 1 was **not** clean: the reviewer found five defects in the check script
  that CR-1 commissioned. Fixed in `28f76a4`, which is scope the plan did not carry.
- Blind gate round 2 was dispatched twice against `0d08c8d` and never returned a verdict
  inside its registered wait. Under the silent-mode liveness rule the expiry action is
  "proceed and ship honestly", so the sprint closes with `blind gate NOT clean`.
- The plan assumed an in-process sub-agent tool for the implementation. None was exposed in
  this session, so the edit was made in the main context and only the gate was delegated.
