# Plan — sprint "tideline" (2026-09-29)

## Original prompt (verbatim)

> create a pr on top of this one with also this, hyper sprint silent mode, add new sprint

Attached: four screenshots of a spec document with items 21–25 and an
unnumbered item "1" (renumbered CR26 here).

## Parsed change requests

- **CR21** — TOC drag-and-drop: auto-scroll the list when the drag is near its top or bottom edge.
- **CR22** — A pasted image sometimes fills only the right 50% of the slide.
- **CR23** — Multi-image placement: three images must not always go in one horizontal row. Pick the layout that uses the space best for the image aspect ratios.
- **CR24** — A pasted wide image lands at the top of the slide, and the rest of the slide stays empty.
- **CR25** — An image must never push other content off the slide.
- **CR26** — The checklist/status-list block is not editable. All text in all blocks must be editable inline.

## Base

- Branch `claude/tideline` from `claude/nice-allen-4zrvzg` @ `6ca9e48` (the open sprint "meridian" PR).
- Baseline: `tests/test_vela.py` has 579 passed, 0 failed.

## Clusters (file-locality)

| Cluster | CRs | Main files | Model |
|---|---|---|---|
| A — image placement | CR22, CR23, CR24, CR25 | image paste / layout code (`part-app`, `part-canvas`, `part-blocks`, `part-slides`, as found) | flagship |
| B — TOC drag auto-scroll | CR21 | `part-list.jsx` | flagship |
| C — inline editing | CR26 | `part-blocks.jsx` | flagship |

A, B and C run in parallel worktrees. Tests go into new `tideline-*` UI suites and unit tests.

## Changes applied from the "meridian" retrospective

- Route by visual and interaction risk: all three clusters are UI-risky, so all use the flagship model.
- Each worker runs a short adversarial burst on its own diff before it returns.
- Each worker runs full CI once, at the end. The orchestrator runs full CI once, before the gate.
- Fixes are pipelined. A round with one or fewer low-severity defects gets only a scoped verifier.
- A worker has a budget of 120 tool calls.

## Stop rule

- A blind gate through the burst-bug-hunter engine, with an engine deadline: per-surface verifiers (image placement, TOC, editing) plus one broad hunter. Zero in-scope defects ends the gate.
- A Markdown report at this folder's `README.md`.
