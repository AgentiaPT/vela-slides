# PPTX export spike (VELA-CR-07 de-risk)

**Throwaway proof-of-concept — NOT production code.** Proves the recommended
path for PowerPoint export (see `docs/POWERPOINT-EXPORT-RESEARCH.md`): a per-slide
primitive IR → **native, editable** PowerPoint objects, in a **library-free**,
hand-rolled OOXML + ZIP writer (mirroring the vector-PDF engine in `part-pdf.jsx`).

Nothing here is wired into the app. Deleting `spike/` has no effect on Vela.

## Files
| File | Role |
|---|---|
| `pptx-emitter.mjs` | Library-free OOXML emitter + hand-written STORE/deflate ZIP. `buildPptx(slides)` → `.pptx` Buffer. IR → `<p:sp>` text boxes / roundRect + ellipse autoshapes / `<p:pic>` images / native SVG picture (asvg blip + PNG fallback). |
| `png.mjs` | Tiny solid-color PNG generator (no image lib) for fixtures/fallbacks. |
| `build-minimal-pptx.mjs` | **Step 1** — hand-authored IR → `out/minimal.pptx` (text box + roundRect + ellipse + PNG + native SVG). Proves the skeleton + native objects. |
| `build-single-slide.cjs` | Builds an offline page mounting ONE real `VirtualSlide`/`SlideContent` at 960×540 (no editor chrome). Mirrors `render-offline.js`. |
| `slide-to-pptx.mjs` | **Step 2** — renders a real deck slide, measures its DOM into an IR (the `getBoundingClientRect` / Range-rect approach `part-pdf.jsx` already uses), emits `out/real-slide.pptx`. |
| `verify.py` | Reads the `.pptx` back with **python-pptx** and asserts it contains real editable text runs + autoshapes (+ picture/SVG with `--require-media`). This is the objective "is it editable?" check. |

## Run
```bash
cd spike/pptx
node build-minimal-pptx.mjs
python3 verify.py out/minimal.pptx --require-media

node slide-to-pptx.mjs ../../examples/tech-talk.vela 0 1 0   # lane.item.slide
python3 verify.py out/real-slide.pptx
```

## Results (verified)
- `minimal.pptx` — valid zip, 14 parts all well-formed; **3 editable text boxes,
  4 native autoshapes, 2 pictures, 1 native SVG** (`svgBlip` reference present).
- `real-slide.pptx` (real "Edge-First Request Architecture" slide) — **17 editable
  text boxes + 9 native autoshapes** measured straight off the live Vela render.
- `out/real-slide-source.png` — screenshot of the source Vela render for comparison.

## Known spike limitations (informing the production plan)
- Extracts **text + solid-fill boxes + circles** only. The source slide's **flow
  arrows, cycle arrows and Lucide icons are inline SVG** and are **not** captured
  here — that is exactly the content the production **Alternative-C embedded-SVG
  fallback** handles (native SVG picture, "Convert to Shape"). The spike deliberately
  stops at the native-shape boundary to make that boundary visible.
- No gradients, borders, images, tables, or font embedding yet (all straightforward
  extensions of the emitter; the vector-PDF path already extracts gradients/borders).
- **Visual render of the generated `.pptx`** works via LibreOffice, but the container
  ships a *stripped* build (only `pdfimport`/`xsltfilter` modules — fails on any
  `.pptx`/`.txt`). One-time fix: `apt-get install -y libreoffice-impress`. Then:
  `bash render-pptx.sh out/real-slide.pptx out` (pptx→png) and
  `python3 compare.py out/real-slide-source.png out/real-slide.png cmp.png` (source vs
  pptx side-by-side). python-pptx read-back remains the objective editability check.
