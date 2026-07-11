# PowerPoint (.pptx) Export — Research & Design

> Sprint research for **VELA-CR-07 · PowerPoint (.pptx) export** (see
> `docs/NEXT-SPRINT-CRs.md`). Goal: export a deck to `.pptx` with **maximum visual
> equivalence — vector shapes and images preserved — landing as native, editable
> PowerPoint objects**, the same fidelity bar as the existing vector-PDF export.
> A working proof-of-concept accompanies this doc in `spike/pptx/` (throwaway).

---

## 1. Context

Vela's export menu today offers **Vela (.vela), PDF, Markdown, JSON**. `.pptx` is
the #1 interchange format business/enterprise users expect when handing a deck to
colleagues who don't use Vela. The bar we're setting is deliberately higher than
CR-07's original "lossy-but-useful first cut": we want **editable native objects**
(text you can retype, shapes you can restyle) rather than a deck of flat images —
because that is what makes a `.pptx` actually useful to a recipient, and because
Vela is unusually well-positioned to produce it (see §3).

Delivery target (decided): **client-side, in the artifact**, as a new entry in the
Export menu — where users already are, and where every other Vela export lives.

---

## 2. Current state — the vector-PDF pipeline is the foundation

All export lives in `tools/vela-dev/app/parts/part-pdf.jsx`, **hand-rolled with
no external library** (a `.pdf` is written byte-by-byte). There are two PDF engines:

- **Raster** (`PdfExportModal`, ~:576) — DOM→canvas→JPEG per page. Flat pixels.
- **Vector** (`VectorPdfExportModal` ~:2951 / `buildVectorPdf` ~:2203) — renders
  `SlideContent` **off-screen**, then extracts a **positioned, resolution-independent
  primitive IR** and emits PDF vector operators. **This IR is the reusable asset for
  PPTX.** The extractors:

  | Function (part-pdf.jsx) | Produces |
  |---|---|
  | `extractBoxes` (~:1371) | rects `{x,y,w,h,bg,gradient,borderRadius,borders}` |
  | `extractTextRuns` (~:1590) | text runs `{text,x,y,w,h,fontSize,color,fontWeight,fontStyle,fontFamily,letterSpacing}` (via `TreeWalker` + `Range.getClientRects`) |
  | `extractCircles` (~:1706) | `{cx,cy,r,bg,borderWidth,borderColor}` |
  | `extractSVGs` (~:1739) | icon/diagram SVG paths → bezier (`svgPathToPdf` ~:1896) |
  | `extractLinks` (~:1670) | `<a href>` rects → link annotations |
  | `extractEmojiImages` (~:1226), `extractLogoImages` (~:1305) | raster fallbacks |

  Fonts (DM Sans / Sora / Space Mono) are already embedded as TTF
  (`COMPRESSED_FONTS`, `parseTTF` ~:2712). Image-heavy slides already **hybridise**
  — they fall back to per-slide raster capture (~:3002).

Reusable helpers: `collectAllSlides(lanes, branding)` (~:3456) flattens the deck to
an ordered slide list; the Blob → `<a download>` save pattern (~:3661).

**Rendering model** (`part-blocks.jsx`, `part-slides.jsx`): 27+ block types render
as **flexbox-flowed HTML/CSS with NO stored x/y** — positions exist only after
rendering + DOM measurement, on a **960×540** virtual canvas. Final on-screen size
= `BASE_SIZES(rem×16) × fontScale × fitScale` (shrink-to-fit auto-scale). Colors are
literal CSS strings (incl. 8-digit hex + `+"15"` alpha suffixes). Images are usually
base64 data URIs. Icons, the `svg` block, `flow` arrows, `funnel`/`cycle` are inline
stroke SVG.

**Constraints:** no bundler, no runtime deps, CSP-limited artifact, and the offline
container blocks all CDNs. → **a PPTX exporter must be library-free and hand-rolled**,
exactly like the vector-PDF engine.

---

## 3. Gap

1. **No `.pptx` / OOXML / ZIP-writer anywhere** — greenfield output format. (A
   `.pptx` is a ZIP of XML; an uncompressed STORE zip is trivially hand-writable —
   the spike does it in ~70 lines.)
2. The vector IR currently targets **PDF operators**; we need a second emitter that
   consumes the **same IR** and writes OOXML **DrawingML** (`<p:sp>` shapes / text
   boxes / `<p:pic>` pictures).
3. **Editability is a richer target than PDF.** PDF bakes text as glyph runs;
   PowerPoint wants real **text boxes with `<a:r>` runs** and **autoshapes** so the
   recipient can edit. That's more mapping work but the same source data.
4. **SVG diagrams/icons** must become either embedded **native SVG pictures**
   (vector-sharp, "Convert to Shape") or DrawingML `custGeom` paths.

---

## 4. How other platforms do this

| Tool | Approach | Fidelity / editability |
|---|---|---|
| **Gamma** | Card/HTML model flattened on export | Layout shifts; **~30% editable text**, rest flat images |
| **Canva** | Some native, heavy image fallback | Fonts substituted; complex layouts → images |
| **Beautiful.ai** | Native-shape mapping | **Best-in-class** editable fidelity |
| **dom-to-pptx** (OSS, on PptxGenJS) | "Coordinate scraper & style engine" — walks DOM, reads computed styles → native shapes + text boxes; `svgAsVector:true` keeps SVG vector | Fully editable, vector-sharp |
| **PptxGenJS** | Low-level native OOXML generator (text/shape/table/image/SVG), browser-capable | Native objects; no HTML parsing of its own |

**Takeaways**

- The winning pattern (Beautiful.ai / dom-to-pptx) is **measure the rendered DOM →
  emit native PPTX primitives**. **Vela is already ahead here** — it *has* that
  DOM-measured IR from the vector-PDF path, so there's no DOM-scraping engine to
  build from scratch. This is the single biggest reason to be optimistic.
- **The anti-pattern to avoid is Gamma's**: exporting slides as flat images. Vela's
  IR lets us skip that for everything except genuinely image-heavy slides.
- **PowerPoint native SVG:** modern PowerPoint (2016+/365) embeds an SVG as a picture
  (`<a:blip>` + `asvg` extension + PNG raster fallback) and offers **"Convert to
  Shape"** → editable vectors. Older/locked builds gracefully show the PNG fallback.
  So SVG-embed gives vector sharpness with a safe degrade.

Sources: PptxGenJS docs & shapes/images pages; dom-to-pptx (github.com/atharva9167j/dom-to-pptx);
Microsoft Learn / support on SVG "Convert to Shape"; python-pptx freeform/custom-geometry docs;
industry comparisons of Gamma/Canva/Beautiful.ai `.pptx` export fidelity.

---

## 5. Three strong alternatives

### Alternative A — Native-shape mapping from the existing vector IR ★ recommended
*Client-side, hand-rolled OOXML.* New `part-pptx.jsx` with `buildPptx(pages,…)` that
consumes the **same per-slide IR** `buildVectorPdf` produces and emits OOXML instead
of PDF operators:

- text runs → `<p:sp>` **text boxes** with `<a:r>` runs (font/size/color/bold/italic) — selectable, editable
- boxes → **roundRect autoshapes** with `solidFill` / `gradFill` / line borders
- circles → **ellipse** autoshapes
- images → `<p:pic>` embedded media (base64 data URI → `ppt/media/`)
- SVG icons / `svg` block / flow arrows → **native SVG picture** (asvg blip + PNG fallback)
- links → `hlinkClick`
- package parts into a hand-rolled **STORE zip**; save via the existing Blob helper

**Pros:** maximum native editability; reuses ~80% of the vector pipeline; no deps;
works in-artifact and offline. **Cons:** most OOXML-authoring effort; EMU units
(914400/in — conveniently **1 Vela px = 12700 EMU exactly**), gradient/alpha parsing,
PPT-version SVG quirks.

### Alternative B — Python CLI `vela deck pptx` *(headless / batch)*
Server-side command in `vela.py` (beside `assemble`/`ship`/`zip`); `_load_full()`
normalises any deck format, walk `lanes→items→slides→blocks`; emit OOXML via stdlib
`zipfile` + XML strings (zero deps) or `python-pptx` (one pip dep). Testable via the
existing `test_cli_commands` subprocess pattern. **Pros:** automatable, CI-friendly,
no browser. **Cons:** the deck JSON has **no geometry** — Python can't measure the
DOM, so it must re-implement Vela's flexbox + auto-fit layout engine (large, brittle)
or accept a coarse "semantic placeholder" layout → lower visual equivalence.
Contradicts the max-fidelity goal unless paired with a client-emitted positions
sidecar.

### Alternative C — SVG-per-slide → embedded native vector picture *(max visual equivalence, least mapping)*
Serialise each rendered slide to one self-contained SVG and embed it as a native SVG
picture per slide (PNG fallback). Optional **hybrid**: overlay real text boxes (from
`extractTextRuns`) so text stays selectable while shapes stay vector. **Pros:**
essentially pixel/vector-perfect, fastest high-fidelity v1, minimal OOXML authoring.
**Cons:** editability depends on PowerPoint's SVG "Convert to Shape" (great in 365,
degraded in some builds, none <2016); without the text overlay it reads as one
graphic, not native objects — weaker on the editability goal.

**Decision axis:** editability (A) ↔ visual-equivalence-with-least-work (C) ↔
automatable-but-geometry-blind (B).

---

## 6. Recommendation

**Lead with Alternative A, with Alternative C as the targeted fallback.** Text +
boxes + circles + tables become **real editable PowerPoint objects**; only
irreducibly-vector content — the `svg` block, `flow` connectors, `funnel`/`cycle`,
Lucide icons — rides in as an **embedded native SVG picture** (still vector, still
"Convert to Shape"-able). Genuinely image-heavy slides fall back to raster capture,
exactly as the vector-PDF path already does. **Alternative B is a documented Phase-2
complement** (headless `vela deck pptx`) once a client-emitted positions sidecar
exists — not built now.

The spike (§7) validated this boundary concretely: on a real slide, text/boxes/circles
mapped cleanly to native shapes, while the flow/cycle **SVG arrows + icons were not
captured by the native-shape pass** — precisely the content Alternative C absorbs.

---

## 7. Proof-of-concept (`spike/pptx/`) — what was proven

A throwaway, library-free spike (see `spike/pptx/README.md`) established the
load-bearing risks are retired:

1. **Hand-rolled OOXML + ZIP is viable & correct.** `pptx-emitter.mjs` writes a valid
   `.pptx` with no pptxgenjs / python-pptx / zip lib (STORE/deflate ZIP + DrawingML
   strings). `out/minimal.pptx`: valid zip, all XML well-formed, and python-pptx reads
   back **3 editable text boxes, 4 native autoshapes, 2 pictures, and 1 native SVG**
   (`svgBlip` reference present).
2. **Real-slide, measure-DOM → native-objects works end to end.** A real Vela slide
   ("Edge-First Request Architecture") was rendered in isolation (`build-single-slide.cjs`
   mounts one real `VirtualSlide` — the production render path), measured into an IR the
   way `part-pdf.jsx` measures, and emitted: **17 editable text boxes + 9 native
   autoshapes** (`out/real-slide.pptx`, verified by `verify.py`). Source render saved as
   `out/real-slide-source.png` for comparison.
3. **The native/SVG boundary is real and matches the plan.** The same slide's flow &
   cycle **SVG arrows and icons were not captured** by the native-shape pass — which is
   exactly the content the Alternative-C embedded-SVG fallback is for.

Verification note: editability is proven objectively via **python-pptx read-back** (real
`TextFrame` runs + autoshapes, not a flattened picture). **Visual** round-trip of the
generated `.pptx` also works in-container: the shipped LibreOffice is *stripped* (only
`pdfimport`/`xsltfilter` modules — fails on any `.pptx`/`.txt`), but
`apt-get install -y libreoffice-impress` restores rendering, after which
`soffice --headless --convert-to png` renders slides faithfully (native SVG included).
Helpers: `spike/pptx/render-pptx.sh` + `spike/pptx/compare.py`. That first visual pass
confirmed the emitter is correct (the minimal fixture renders pixel-clean incl. the
native SVG) and localised the remaining fidelity gaps to the DOM extraction — see the
sprint spec's "Baseline findings".

---

## 8. Block → OOXML mapping (production target)

`text box` = `<p:sp>` txBox with `<a:r>` runs · `autoshape` = `<p:sp>` `prstGeom` ·
`table` = `<a:tbl>` (graphicFrame) · `picture` = `<p:pic>` embedded media ·
`native-SVG` = `<p:pic>` asvg blip + PNG fallback.

| Block(s) | Primary target | Notes |
|---|---|---|
| heading, text, quote, badge, code, metric label | **text box** | fonts → Sora/DM Sans/Space Mono (embed or theme-map) |
| bullets, checklist, tag-group, icon-row | **text box** (+ small autoshapes/SVG for dots/icons) | bullet dots = tiny ellipses or paragraph bullets |
| callout, grid cell, table header/cell bg, badge bg | **roundRect autoshape** + text box | gradient/border from `extractBoxes` |
| metric value, number-row, progress track/fill | **autoshape(s)** + text box | progress = two rects |
| table | **`<a:tbl>` graphicFrame** | native editable table |
| image | **`<p:pic>`** | base64 → `ppt/media/` |
| icon (Lucide), svg block, flow arrows, funnel, cycle, timeline connectors | **native-SVG picture** | vector, "Convert to Shape"; PNG fallback |
| divider, spacer | **line autoshape / gap** | |

Units: **1 Vela px = 12700 EMU**; font px → centipoints = `round(px·0.75·100)`; slide
= 12192000×6858000 EMU (16:9). Must apply the same `fitScale` shrink-to-fit as on
screen so content doesn't overflow.

---

## 9. Effort & phased rollout

- **Phase 1 (M):** emitter + IR bridge for text boxes, roundRect/ellipse autoshapes,
  images, links, slide background/gradient. Reuse `collectAllSlides` + off-screen
  `SlideContent` render + `extractBoxes/TextRuns/Circles/Links`. Menu entry + modal
  mirroring `PdfExportModal`. **This alone yields an editable, useful `.pptx`.**
- **Phase 2 (S–M):** native-SVG fallback for `svg`/`flow`/`funnel`/`cycle`/icons;
  native `<a:tbl>` tables; font embedding vs theme-substitution decision.
- **Phase 3 (S):** image-heavy-slide raster hybrid; optional headless `vela deck pptx`
  (Alternative B) fed by a client-emitted positions sidecar.

Overall effort **M–L**, in line with CR-07's "L".

**Risks:** PPT-version SVG support (mitigated by PNG fallback); font embedding vs
substitution (Sora/DM Sans/Space Mono are already embedded as TTF for PDF — reuse);
auto-fit scaling parity; gradient/8-digit-alpha color parsing (already handled in the
vector-PDF path — reuse).

**Version note:** the production `part-pptx.jsx` build touches `skills/vela-slides/`,
so it **must** bump `VELA_VERSION` + add a `VELA_CHANGELOG` entry (CI enforces this).
This research doc and the `spike/` PoC live outside `skills/`, so no bump is needed
for them.
