# Sprint "lumen" — plan (2026-10-19)

## Verbatim original prompt

> hyper sprint this, use silent mode
> (attachment: vela next sprint — change-request HTML export)

## Sprint

- Base / sprint branch: `claude/affectionate-lovelace-tunpl7`
- Sprint HEAD SHA: `cd72a0b265cefb0bb12a8ba3d2d2c7f5fabb6f29`
- Mode: silent (no progress output; one final message)

## Change requests (19)

| CR | Summary | Cluster |
|---|---|---|
| 1 | Deck IDs and timestamps change on open — confirm root cause, fix if a bug | C1 Data |
| 2 | Gradient on slide background — validation must reject it | C1 Data |
| 3 | Image left/right of content — top margin/alignment | C2 Layout |
| 4 | Gallery: add hide-slide option next to delete | C3 Gallery/TOC |
| 5 | Vector PDF: some chars stretched/thin — check PPTX too | C4 Export/Neutralino |
| 6 | Copy/paste items with proper location — needs UX research | PARK |
| 7 | Review mode: cycle only unchecked slides; checkmark toggle (editor mode only) | C3 Gallery/TOC |
| 8 | Remove top brand line (0 px still visible) | C2 Layout |
| 9 | Branding config panel to right side pane | C2 Layout |
| 10 | Gallery icon (top right, presenter) not visible | C3 Gallery/TOC |
| 11 | Edit icon (top right, presenter) inconsistent | C3 Gallery/TOC |
| 12 | Neutralino HTML export: `useState` redeclared error | C1 Data |
| 13 | Gallery view not hidden; mode switch (presenter/editor/gallery) near present mode | C3 Gallery/TOC |
| 14 | TOC in editor: delete-slide icon | C3 Gallery/TOC |
| 15 | Block toolbar cut off when image fills slide — needs UX research | PARK (see decisions) |
| 16 | Neutralino window title: "Vela Slides - <Deck Title>" | C4 Export/Neutralino |
| 17 | Text-block links misplaced (overlap / far right) — stress test | C4 Export/Neutralino |
| 18 | Neutralino keyboard dead after focus return — must work without click | C4 Export/Neutralino |
| 19 | Neutralino AI shows "offline" after new build until restart — root cause and fix | C4 Export/Neutralino |

Verbatim CR text: `scratchpad/spec-lumen.txt` (outside repo).

## Clusters (file locality)

- **C1 Data & validation:** CR 1, 2, 12. Files: `part-imports.jsx`, `skills/vela-slides/scripts/validate.py`, `part-export-md.jsx`.
- **C2 Slide layout & branding:** CR 3, 8, 9. Files: `part-branding.jsx`, `part-blocks.jsx`, `part-app-modals.jsx`.
- **C3 Gallery / TOC / presenter:** CR 4, 7, 10, 11, 13, 14. Files: `part-list.jsx`, `part-slides.jsx`, `part-slidepanel.jsx`, `part-reducer.jsx`, `part-app.jsx`.
- **C4 Export & Neutralino:** CR 5, 16, 17, 18, 19. Files: `part-pdf-vector.jsx`, `part-pptx.jsx`, `part-blocks.jsx`, `vela-neutralino/`.
- **PARK:** CR 6, 15 (UX research, no code this sprint).

## Silent-mode decisions (pre-declared)

- Conservative reading for CR 13: move the overview/gallery entry next to the present-mode control; keep gallery reachable.
- CR 6 and 15 parked: UX choice required, no code shipped.

## Gate

Blind hybrid validation (per-cluster verifiers + broad hunters), engine-enforced deadline, `burst-bug-hunter` harness. Markdown report in this folder.

## Outcome

(filled at close)
