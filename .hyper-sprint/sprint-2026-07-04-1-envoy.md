# Sprint 2026-07-04-1 · ⭐ Envoy

**Theme:** Interchange — hand a Vela deck to anyone, as native PowerPoint.
**Codename:** *Envoy* — a representative you send into foreign territory; this sprint
carries a Vela deck intact into PowerPoint / Keynote / Google Slides, as editable
objects rather than a flattened picture.
**Reviewed build:** `VELA_VERSION 12.82` · SKILL.md `12.82`.
**Runner:** coding agents. **CR division:** decided separately — this document is
**scope only**, no engineer/agent assignment, ownership, or sequencing.

---

## Why this sprint

Vela exports Vela (.vela), PDF, Markdown, JSON — but **no editable `.pptx`**, the #1
interchange format business/enterprise users expect when handing a deck to colleagues
who don't use Vela (roadmap **VELA-CR-07**). This sprint ships that export at the
**vector-PDF fidelity bar**: **maximum visual equivalence with vector shapes and images
preserved**, landing as **native, editable PowerPoint objects** (retype the text,
restyle the shapes) — deliberately higher than CR-07's original "lossy-but-useful"
framing, because native-editable output is what makes a `.pptx` actually useful to a
recipient and is what separates Vela from tools that flatten every slide to an image.

**Why it's tractable now:** Vela already produces the hard part. The vector-PDF exporter
(`part-pdf.jsx` `buildVectorPdf`) renders each slide off-screen and extracts a positioned,
resolution-independent **primitive IR** (`extractBoxes` / `extractTextRuns` /
`extractCircles` / `extractSVGs` / `extractLinks`). PowerPoint export is a **second
emitter over that same IR** — not a new engine. A throwaway spike (`spike/pptx/`) already
proved a library-free OOXML + ZIP writer turns that IR into native, editable objects
(a real slide → 17 editable text boxes + 9 native autoshapes, python-pptx-verified).

> **Scope decisions**
> - **Client-side, in the artifact** (a new Export-menu entry) — mirrors every other
>   Vela export and the `PdfExportModal` precedent; library-free hand-rolled OOXML,
>   since CDNs are blocked and the vector-PDF engine already proves no lib is needed.
> - **Editability-first hybrid:** text / boxes / circles / tables → **native shapes**;
>   irreducibly-vector content (`svg` block, `flow`/`cycle`/`funnel`, Lucide icons) →
>   **embedded native SVG picture** (asvg blip + PNG fallback, "Convert to Shape"-able);
>   image-heavy slides → raster hybrid, exactly as the vector-PDF path already does.
> - **Python CLI `vela deck pptx` (Alternative B) is OUT** — the deck JSON has no
>   geometry, so a headless exporter needs a client-emitted positions sidecar; that's a
>   separate follow-up. Full detail: `docs/POWERPOINT-EXPORT-RESEARCH.md`.

Each item carries its intent and a concrete **Verify** condition so it can be picked up
independently. The in-scope items build up one exporter; where they touch the same file
(`part-pptx.jsx`) they still divide cleanly by IR primitive.

---

## In scope

### PPTX-1 · Core exporter — native editable objects (foundation)

New **`part-pptx.jsx`** with `buildPptx(pages, …)` consuming the per-slide IR that
`buildVectorPdf` already builds. **Promote the proven spike emitter**
(`spike/pptx/pptx-emitter.mjs`) as the starting point. Reuse: `collectAllSlides`
(`part-pdf.jsx:3456`), the off-screen `SlideContent` render, and
`extractBoxes`/`extractTextRuns`/`extractCircles`/`extractLinks`. Emit:

- text runs → `<p:sp>` **text boxes** with `<a:r>` runs (font/size/color/bold/italic/align)
- boxes → **roundRect autoshapes** (`solidFill`, borders); circles → **ellipse** autoshapes
- slide background + `bgGradient` as a full-bleed fill
- links → `hlinkClick`

Add `part-pptx` to `PART_ORDER` (`concat.py`). Units: **1 Vela px = 12700 EMU**; font px
→ centipoints `round(px·0.75·100)`; 16:9 = 12192000×6858000 EMU. Apply the on-screen
`fitScale` shrink-to-fit so content doesn't overflow the slide.

**Verify:** export a text/heading/metric/callout slide → opens clean in PowerPoint;
text is selectable & editable; shapes are real objects; `python-pptx` read-back reports
the expected editable text boxes + autoshapes; block positions within a small tolerance
of the source render.

### PPTX-2 · Vector diagrams — native SVG embed (the parity core)

Capture every inline `<svg>` in the rendered slide — Lucide icons, `flow`
arrows/gates/loops, `cycle`, `funnel`, the `svg` block, `steps`/`timeline` connectors —
serialize each to a standalone SVG, and embed as a **native SVG picture** (`<p:pic>`
with `asvg:svgBlip` + a browser-rasterized **PNG fallback** for pre-365 clients). Reuse
`extractSVGs` (`part-pdf.jsx:1739`) for detection/geometry; rasterize the fallback
in-browser via `Image`→`canvas`→`toBlob`.

**Verify:** export the "Edge-First Request Architecture" slide (flow + cycle + icons) →
arrows/icons render **vector-sharp**; right-click → **"Convert to Shape"** works in
PowerPoint 365; on an SVG-less client the PNG fallback shows; reconstruction preview
matches the source Vela render within tolerance. (This is the exact content the spike
deliberately left uncaptured.)

### PPTX-3 · Structured data — tables & images

- `table` block → native **`<a:tbl>`** graphicFrame (editable PowerPoint table:
  headers, rows, striping, border/color from the block).
- `image` block (base64 data URI or URL) → **`<p:pic>`** embedded media.
- **Image-heavy slide raster hybrid**: mirror the vector-PDF `slideHasImages`
  (`part-pdf.jsx:974`) fall-back so photo slides still round-trip.

**Verify:** exported table is an editable PPT table (not an image); embedded image
displays; a photo slide round-trips via the raster path.

### PPTX-4 · Fidelity parity — gradients, colors, borders, fonts

- Gradients: reuse **`parseLinearGradient`** (`part-pdf.jsx:1026`) → OOXML
  **`<a:gradFill>`** (stops + angle). Handle 8-digit hex / `+"15"` alpha suffixes and
  per-side borders (`<a:ln>` or thin rects).
- Fonts: map **Sora / DM Sans / Space Mono**; decide **embed** (reuse the TTFs already in
  `COMPRESSED_FONTS`) vs theme-substitution, documenting the trade-off.

**Verify:** a gradient background + gradient callout render correctly; colors match the
source within a small ΔE tolerance; a long-content slide reproduces the shrink-to-fit
without overflow.

### PPTX-5 · UI & wiring

Add **Export → "PowerPoint (.pptx)"** to the export menu (`part-app.jsx:1390–1404`) and a
**`PptxExportModal`** mirroring `PdfExportModal` (`part-pdf.jsx:576` / `part-app.jsx:1566`):
ratio picker, progress, optional "Made with Vela" branding toggle, thumbnails, and the
existing Blob→`<a download>` save.

**Verify:** the menu item appears; the modal runs to completion and downloads a `.pptx`;
re-opening it in PowerPoint shows the deck.

### PPTX-6 · Tests, version bump & docs

- New **`test_pptx_*`** suite: structural (valid zip, well-formed XML) + `python-pptx`
  read-back assertions (native text/shapes/pics/SVG present, per-slide counts), following
  `test_pdf_title_cards` (`test_vela.py:2817`) and the `test_cli_commands` subprocess
  pattern. A Node harness test drives the real export via the offline render.
- **`VELA_VERSION` + `VELA_CHANGELOG` bump** in `part-imports.jsx` and SKILL.md `version`
  (CI blocks otherwise — `skills/vela-slides/**` changes). Fold `spike/pptx/` learnings
  into the changelog note (high-level only).

**Verify:** `python3 tests/test_vela.py` green; `concat.py` reports in-sync; the CI
version-bump gate passes.

---

## Verification approach (whole sprint)

`soffice` headless is **non-functional in the sprint container** (fails on a plain
`.txt`), so visual round-trip can't use LibreOffice here. Prove parity via **(a)**
`python-pptx` read-back — objective "these are native editable objects, not a picture"
— plus per-slide object counts and positions, and **(b)** an **in-browser reconstruction
preview**: re-render the emitted IR to a PNG and diff against the source Vela render
within tolerance. Final visual sign-off is a human opening the `.pptx` in real PowerPoint
(or local `soffice --headless --convert-to png`).

**Stop rule / artifact:** a real multi-block deck (headings, bullets, table, metric,
`flow`, `cycle`, image, gradient) exports; `python-pptx` confirms native objects on
every slide; the reconstruction diff is within tolerance; and the file opens clean in
PowerPoint (local sign-off). A short exported sample `.pptx` is attached as the proof
artifact.

---

## Explicitly NOT in this sprint (backlog)

- **Python CLI `vela deck pptx` (Alternative B)** — headless/batch export; blocked on a
  client-emitted positions sidecar (deck JSON has no geometry). Natural next follow-up.
- **Charts as native PPT charts**, **animations / slide transitions → PPT**, and
  **Keynote-specific quirk tuning** — out of scope; SVG/native-shape parity covers the
  visual result.
- **Font embedding vs substitution** may land as substitution-first if embedding proves
  costly; embedding can follow (the TTFs already exist for PDF).

---

## Reference

- **Design & alternatives:** `docs/POWERPOINT-EXPORT-RESEARCH.md` (current state, gap,
  industry survey, 3 alternatives, recommendation, block→OOXML mapping, effort/phasing).
- **Working PoC:** `spike/pptx/` — library-free emitter + real-slide extraction; run
  `node build-minimal-pptx.mjs` and `node slide-to-pptx.mjs ../../examples/tech-talk.vela 0 1 0`,
  then `python3 verify.py out/*.pptx`.
- **Roadmap entry:** `docs/NEXT-SPRINT-CRs.md` → VELA-CR-07.
- **Reusable code:** `part-pdf.jsx` — `collectAllSlides` (:3456), `extractBoxes` (:1371),
  `extractTextRuns` (:1590), `extractCircles` (:1706), `extractSVGs` (:1739),
  `extractLinks` (:1670), `parseLinearGradient` (:1026), `slideHasImages` (:974).
