# Sprint "lumen" — report (2026-10-19)

- Branch: `claude/affectionate-lovelace-tunpl7`
- Sprint base HEAD: `cd72a0b`
- Final HEAD at gate: `75ae4c0`
- Plan: `plan-2026-10-19-lumen.md`

## Result

- **11 / 19 CRs done**
- **Blind gate: NOT clean.** The only blind round was source-level. It ran no browser checks.
- **8 parked or partial.**

## Per CR

| CR | Status | Note |
|---|---|---|
| 1 | Partial | Ids kept on ingest. Open still rewrites the source file: the startup LOAD path in `part-app.jsx` does not set `_localSyncIncoming`. |
| 2 | Done | `validate.py` rejects a gradient as `bg`. Test in `test_vela.py`. |
| 3 | Parked | Tall side image fills the column. Root cause in `part-canvas.jsx`, outside cluster scope. |
| 4 | Done | Gallery hide toggle beside delete (`gallery-hide-slide`). |
| 5 | Done | Vector PDF spacing used UTF-16 units, not WinAnsi bytes. PPTX not affected. |
| 6 | Parked | Copy/paste placement needs UX research. No code. |
| 7 | Partial | Approve toggle works in session. Reload drops `approved`: `SAFE_SLIDE_KEYS` lacks it. |
| 8 | Done | `accentHeight || 4` turned 0 into 4px. Fixed. |
| 9 | Parked | `BrandingPanel` is in `part-slides.jsx`, outside the owning cluster. |
| 10 | Done | Gallery icon was an emoji with no emoji font. Now a Lucide SVG on a dark backing. |
| 11 | Done | White pencil on light slides. Dark backing added. |
| 12 | Done | UMD shim was prepended twice on Neutralino HTML export. |
| 13 | Done | Silent-mode decision: Editor | Gallery switch before Present. Overview removed from the slide toolbar. |
| 14 | Done | TOC row delete icon (`toc-delete-slide`). |
| 15 | Parked | Block toolbar clipped by full-bleed image. UX research needed. No code. |
| 16 | Done | Window title `Vela Slides - <deck>`. Unit-tested; not checked in a real window. |
| 17 | Parked | Link badge placement in `part-canvas.jsx`. Outside cluster scope. |
| 18 | Partial | Re-focus on window focus and visibility return added. Native alt-tab not verified here. |
| 19 | Done | Stale handshake cache kept AI "offline". Cache dropped on transport error. |

## Blind gate

- Round 1 (one source-level validator, 8 features): 7 PASS, 1 UNVERIFIED (feature 5). No in-scope defect found in source reading.
- No runtime browser pass ran. The skill requires an engine-enforced deadline and a driven run. This round did not meet that bar.
- **Gate status: not clean.** Next step: a runtime round through `burst-bug-hunter`, plus the follow-up wave for CR 1, 3, 7, 9, 17, 18.

## Assumptions and unilateral decisions

- CR 13: overview moved next to Present as a segmented switch. Present stays the presenter entry.
- CR 6 and 15: parked. Both need a UX decision.
- Version bump: not done. Left for the close-out change (`VELA_VERSION` and `VELA_CHANGELOG`).

## Out of scope (found, not fixed)

- `part-app.jsx`: local startup path writes the deck back on open (CR 1 root cause).
- `validate.py`: non-string slide `bg` raises `AttributeError` in the contrast check.
- `agents-bridge.js`: unkeyed handshake file is read before the keyed one when the keyed one is missing.
- `part-imports.jsx`: `SAFE_SLIDE_KEYS` missing `approved` (CR 7).
- Editor top bar wraps and clips at 1400px width (not verified against base).
- `part-slides.jsx`: 🗂 emoji still in the Gallery header.
- `part-branding.jsx` slider: `accentHeight || 4` shows 4 while the label says 0px.
- Demo deck: 9 "may overflow" warnings (cosmetic).

## Validation at HEAD `75ae4c0`

- `python3 tests/test_vela.py`: 564 passed, 0 failed.
- `tests/test_standalone_html.cjs`: 20 passed.
- `tests/test_deck_key_allowlist.cjs`: 105 passed.
- `tests/test_window_host.cjs`, `tests/test_agents_bridge.cjs`: exit 0.
- `tests/test_desktop.py`: OK.
- `tests/test_pdf_export.cjs`: 22 passed.
- UI battery (from C3 and C4 worker runs, pre-merge): 281 and 280 passed.
