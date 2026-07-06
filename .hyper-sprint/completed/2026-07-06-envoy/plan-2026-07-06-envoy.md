# Sprint plan — 2026-07-06 · Envoy (PowerPoint export)

## Original prompt (verbatim)

> ensure you have latest main, no stale
> then use hyper sprint skill to fully implement the power point export feature, sprint details in . hyper-sprint

Sprint spec: `.hyper-sprint/sprint-2026-07-04-1-envoy.md` (6 change requests, PPTX-1..PPTX-6).

## Phase 0 outcomes

- Branch `claude/powerpoint-export-feature-jhuc8c` == `origin/main` exactly (prior PR #94
  already merged, remote branch deleted) — no rebase needed, started clean from latest main.
- Readiness: environment pre-provisioned. `concat.py` in sync, `test_vela.py` baseline
  **354 passed / 0 failed**. Booted through the `burst-bug-hunter` engine
  (`.hyper-sprint/burst-boot.sh` + `start-hunt.sh` + `vela-verbs.mjs`) and proved
  present→gallery via one `vrun` burst — harness confirmed working before building on it.
- Installed (user-approved): `python-pptx` (pip, test/verification-only) and
  `libreoffice-impress` (apt, was missing the Impress module — stripped base image).
  Both verification prongs proven end-to-end against the spike's own minimal fixture:
  `python3 verify.py` → PASS (native text boxes/autoshapes/pictures/SVG blip), and
  `render-pptx.sh` → clean PNG via LibreOffice headless convert.
- Decisions (asked, batched): blind-hunt length **3 min/hunter** (repo default), proof
  artifact **Markdown report only** (no video).

## Key recon finding that reshapes the plan

The spike's `slide-to-pptx.mjs` (real-slide DOM extraction) does **NOT** reuse
`part-pdf.jsx`'s proven extractors — it's a from-scratch, simpler `page.evaluate()` walk,
and **every one of the sprint doc's 5 baseline bugs is a regression specific to that
reimplementation**, not a flaw in the emitter or in `part-pdf.jsx`. Concretely:

- Duplicated/overlapping text ← spike pushes whole-node text at every per-line rect
  instead of per-line substrings (part-pdf.jsx's `getTextLines` already does this right).
- Wrong text color ← spike's `hex()` drops alpha / hardcodes a fallback color instead of
  compositing (part-pdf.jsx's `parseColor`/`compositeColor` already do this right).
- Flattened circle fill/border ← spike only reads `bg`, never border (part-pdf.jsx's
  `extractCircles` already captures border color/width).
- Hidden "zoom" badge leak ← spike has zero visibility/opacity filtering.
- Missing vector diagrams ← spike's extractor has no SVG handling at all (this one is
  genuinely new work in both the spike and production, not a regression).

**Decision:** production `part-pptx.jsx` wires directly to `part-pdf.jsx`'s existing,
already-correct extractors (`extractBoxes`, `extractCircles`, `extractLinks`,
`parseLinearGradient`, `slideHasImages` — reusable as-is) instead of re-deriving
extraction from the spike. Only the OOXML+ZIP emitter (`pptx-emitter.mjs`) and the
test/verify scripts are promoted from the spike as-is. `extractTextRuns` needs a NEW
sibling (not a reuse) because PDF wants exact per-line positioned runs (no reflow) while
native PPTX text wants one box per text element with real paragraph wrapping — so this is
a from-scratch, per-element grouping pass, not an adapter over the existing per-line one.

Font decision (pre-approved by the sprint doc's own backlog note): **substitution-first**
— reference Sora/DM Sans/Space Mono by name in the OOXML, let PowerPoint substitute if the
recipient lacks the font. Embedding (OOXML's obfuscated `.fntdata` container) is real
extra complexity or explicitly deferred per the spec.

## Clusters (file-locality; Phase 3 Build)

All of PPTX-1..PPTX-4 land in the same new file (`part-pptx.jsx`) and build on each other
— **sequential**, not parallel workers. PPTX-5 (UI) touches disjoint files
(`part-app.jsx`, `.hyper-sprint/vela-verbs.mjs`) once PPTX-1's `buildPptx()` signature
exists, so it runs **in parallel** with PPTX-2..4. PPTX-6 (tests/version/docs) needs
everything merged first.

| # | Cluster | Files | Model/effort | Depends on |
|---|---------|-------|---------------|------------|
| 1 | PPTX-1 core exporter (shapes/text/bg/links + hygiene fixes to shared extractors) | `part-pptx.jsx` (new), `concat.py`, `part-pdf.jsx` (hygiene patch only) | best, high | — |
| 2 | PPTX-2 SVG/vector embed | `part-pptx.jsx` | best, high | 1 |
| 3 | PPTX-3 tables & images | `part-pptx.jsx` | best, high (table geometry is fiddly) | 2 |
| 4 | PPTX-4 fidelity (gradients/colors/borders/fonts) | `part-pptx.jsx` | mid, medium | 3 |
| 5 | PPTX-5 UI & wiring | `part-app.jsx`, `.hyper-sprint/vela-verbs.mjs` | mid, medium | 1 (parallel with 2-4) |
| 6 | PPTX-6 tests, version bump, docs, CI | `tests/test_vela.py` (new suite), `skills/vela-slides/scripts/render-offline.js`, `part-imports.jsx`, `SKILL.md`, `.github/workflows/ci.yml`, `tests/requirements-test.txt` (new) | mid, medium | 1-5 |

Verify text handed to each worker **verbatim** from the sprint spec's per-CR Verify
sections. Reference fixture for flow/cycle/icon/table verification:
`examples/tech-talk.vela` (has flow, cycle-ish, table blocks; matches the sprint doc's
"Edge-First Request Architecture" slide reference).

## Gate style

Hybrid, but scoped down per orchestration.md's own worked example ("6 CRs → an exporter
with ~3 drivable surfaces ⇒ fix-round hunt(1) → blind(1-2) is enough") — this sprint IS
that example. Surfaces: (a) core export fidelity (shapes/text/color/tables/images —
python-pptx + LibreOffice-render diff), (b) SVG/vector parity, (c) UI wiring (menu → modal
→ download, driven live). Plan: one fix-round hunt across all 3 surfaces, then a blind
round of 3 per-surface verifiers + one broad cross-cutting hunter, best model/max effort,
3 min each (repo default). Repeat on any confirmed defect.

## Proof artifact

Single Markdown report at `.hyper-sprint/completed/2026-07-06-envoy/README.md` — burndown,
before/after screenshots (from the blind verifiers' `ctx.shot()`s + a base-commit render
for "before"), cost breakdown, bugs found/fixed. No video (declined).
