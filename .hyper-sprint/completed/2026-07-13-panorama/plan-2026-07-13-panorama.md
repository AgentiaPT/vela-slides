# Sprint "panorama" — Deck-Editor UX (multi-slide) — Plan

**Date:** 2026-07-13
**Branch:** `claude/deck-editor-ux-multi-slide-eva5yj` (base `main`)
**Baseline:** 361 tests passing; branch == origin/main at start.

## Verbatim original prompt

> use hyper sprint, important, for issues, it's mandatory the worker reproduces the issue, captures as a test failing, then code, confirm fixed
>
> - Issue: When opening any deck, show first slide instead of showing no slide. Currently opens with no slide, not great UX.
> - Issue: Possible due to recent changes, text that is centered on presenter view (correct) is being left aligned when in editor mode, possible related when text has icons on the left
> - Issue: On editor view, different slides are changing the height of the editor view, causing the slide toolbar with tools like ai edit, improve etc not to be visible nor accessible, slides should show the exact same with/height, toolbar position shoudnt change between slides
> - Feature: Currently we can copy a single slide to clipboard to copy to another vela deck, I want to allow multi selection and copy, be it to same deck or other deck, same behavior as in powerpoint
> - Feature: on the toc while in editor I want right click to show the slide toolbox options, for example, I should be able to do slide > right click > move > pick section
> - Improvement: when moving slide, on the section list, allow to search, increase the scrollbar with a bit, too narrow, also allow scrollwheel to work, currently the scrollwheel moves the slide, not the section scrollbar

## Change requests (parsed)

- **CR1 (bug):** Opening a deck shows the first slide, not a blank/no-slide state.
- **CR2 (bug):** Centered text (correct in presenter) renders left-aligned in editor mode; likely tied to left-icon text blocks.
- **CR3 (bug):** Editor slide viewport height varies per slide, pushing the slide toolbar (AI edit / improve) out of view. Fixed aspect box; toolbar position stable across slides.
- **CR4 (feature):** Multi-select + copy slides to clipboard (same/other deck), PowerPoint-like.
- **CR5 (feature):** Right-click a slide in the TOC → context menu with slide toolbox actions (move → pick section, etc.).
- **CR6 (improvement):** Move-slide section picker: add search/filter, widen scrollbar, make scrollwheel scroll the list (not move the slide).

## Discipline (per user)

For every **issue (CR1–CR3)**: reproduce → capture as a **failing test** → fix → confirm test passes. Features CR4–CR6 land with their own tests too.

## Conventions

- Edit `src/parts/part-*.jsx`; rebuild via `concat.py`; never edit compiled `vela.jsx` directly.
- Bump `VELA_VERSION` + `VELA_CHANGELOG` in `src/parts/part-imports.jsx` (currently 13.8) and SKILL.md version.
- CI: `python3 tests/test_vela.py` (361 baseline) + `python3 tools/vela-dev/scripts/concat.py`.
- Public repo: no secrets/session URLs; changelog concise.

## Clusters / batches

Heavy file coupling (`part-slides.jsx` touched by CR2/CR3/CR4/CR6; `part-reducer.jsx` by CR1/CR4) ruled out clean parallel worktrees, so two **sequential** workers in the shared tree:
- **Worker 1 (bugs):** CR1, CR2, CR3 — part-reducer/blocks/slides. Commit `652a0eb`.
- **Worker 2 (features):** CR4, CR5, CR6 — part-list/imports/slides/reducer/app. Commit `b6bac17`.

## What happened vs plan

- Both clusters landed as planned, sequentially, no merge conflicts.
- Blind gate **round 1** added scope: cross-cutting hunter found CR7 (multi-op undo granularity). Fixed via batch reducer actions (`9538de3`).
- Blind gate **round 2** came back clean: features verifier confirmed CR4–CR7; hunter found nothing in-scope.
- Round-1 features verifier and round-2 hunter both hit a driver artifact multi-selecting *across* modules (multi-select is same-module scoped); the round-2 features verifier resolved it authoritatively on the known same-module triple.
- Clipboard *read* round-trip is un-testable headless (`readText()` hangs) — pre-existing shipping behavior, not a regression; insert logic reducer-unit-tested.
- Version 13.8 → 13.11 (three minor bumps, one per commit). Tests 361 → 396 Python + 195 UI. Cost $58.26.
