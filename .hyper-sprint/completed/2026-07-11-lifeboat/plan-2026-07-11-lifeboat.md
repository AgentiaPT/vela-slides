# Hyper-Sprint "lifeboat" — plan (2026-07-11)

## Verbatim original prompt
> hyper sprint this changes
>
> For all issues ensure we have a failing test first to reproduce then fix it, make green, classic tdd refactor
> - Export functions are failing, both when using claude ai and neutralino, not always, but frequently, not sure what the root cause. `❌ Export failed on slide 7: str.includes is not a function`
> - When loading as claude artifact we should warn the user it's using claude ai/local storage to save the deck, backup/export frequently to ensure no work is lost
> - The jsx when being used on claude ai artifact shows a blank release notes (VELA v13.0 / Recent Changes blank)
> - Sometime the block tool icons on the block top right are being cut, the full tool circles are not shown and have a cut on the top and right, the right most icon get cuts on both top and right, doesn't happen to all block types
> - Pick an icon should close when pressing escape, same for any other similar dialogs, should be consistent behavior

## Base / branch
base `main` · sprint branch `claude/export-ui-bugs-sprint-n58up8`. Baseline: build clean, **354 tests pass**.

## Parsed change requests (5) → clusters (file-locality, disjoint)
| CR | Summary | File (exclusive) | New test | Model |
|----|---------|------------------|----------|-------|
| CR1 | Export `str.includes` crash — harden `parseLinearGradient`/`slideBg.includes` vs non-string bg | part-pdf.jsx | test_export_robustness.cjs | sonnet |
| CR2 | Artifact-mode backup/local-storage warning (dismissible) | part-app.jsx | test_storage_warning.cjs | sonnet |
| CR3 | Blank release notes = ModalBackdrop overflow in short artifact pane → add maxHeight+overflowY | part-app.jsx | test_modal_scroll.cjs | (with CR2) |
| CR4 | Block hover toolbar icons clipped by container overflow | part-blocks.jsx | test_block_toolbar_clip.cjs | sonnet |
| CR5 | Escape closes IconPicker (input stopPropagation swallows Esc) | part-icons.jsx | test_icon_picker_escape.cjs | sonnet |

CR2+CR3 share part-app.jsx → one worker. CR1/CR4/CR5 each own a distinct file. **4 workers, parallel.**
Shared files (`vela.jsx`, `test_vela.py`, `part-uitest.jsx`, `part-imports.jsx`) owned by orchestrator at integration
(wire cjs, single VELA_VERSION bump + changelog, regenerate monolith, full suite between merges).

## Batches
- Batch 1 (parallel): W1 part-pdf (CR1) · W2 part-app (CR2+CR3) · W3 part-blocks (CR4) · W4 part-icons (CR5)
- Integration: apply, wire tests, bump v13.0→13.1, `concat.py`, full suite green.
- Fix-round hunt → BLIND gate (per-CR verifiers + cross-cutting hunter, burst-bug-hunter engine, deadline-enforced).
- Proof: Markdown report with before/after shots under this folder.

## What happened vs plan
- 4 disjoint-file workers ran in parallel as planned; integration clean, suite 354→359 green, no merge conflicts. Single v13.0→13.1 bump at integration.
- Blind gate: first round inconclusive due to a validation-harness bug (two validators sharing one warm browser page — one's CR2 iframe injection clobbered the other's DOM). Re-run on **isolated** warm servers → clean, 0 in-scope defects. Root cause = orchestration, not the app.
- CR2 artifact-mode positive path not drivable in headless `file://` sandbox → covered by unit/source test + logic; documented limitation.
- 1 out-of-scope pre-existing finding (SVG `<path d>` percentage coordinate console warning during PPTX render) — noted, not fixed.
- Full report: `README.md` in this folder.
