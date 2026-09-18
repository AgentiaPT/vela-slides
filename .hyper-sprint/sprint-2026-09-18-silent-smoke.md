# Sprint request — silent-mode smoke test (2026-09-18)

Tiny, docs-only change set. Its purpose is to exercise the `hyper-sprint` skill's
**silent mode** contract end to end at the smallest possible scale
(`.claude/skills/hyper-sprint/references/silent-mode.md` §6). Three change requests, one
per silent-mode path: decide, park, ship.

Target file: `.hyper-sprint/completed/README.md` (the archive index). No app code. No
browser. No `VELA_VERSION` bump (nothing under `skills/vela-slides/` or `src/parts/`).

## CR-1 — Repair the archive index table

The index table is malformed. The `palisade` sprint appears **twice**, and its second row
has 5 cells against a 4-column header, so the trailing cell does not render. Rows are also
not in date order.

**Verify:** a check script asserts, on the committed file, that (a) every data row has
exactly 4 cells, (b) each sprint folder under `.hyper-sprint/completed/` appears on exactly
one row, (c) rows are sorted by date, newest first. Add the script and run it.

## CR-2 — Make the index easier to scan

The index is hard to read at a glance.

**Verify:** the index is easier to scan than before, and CR-1's check script still passes.

## CR-3 — Link each sprint row to its live cost dashboard

Every row should link to that sprint's live cost dashboard so spend is visible from the index.

**Verify:** each row links to its dashboard.
