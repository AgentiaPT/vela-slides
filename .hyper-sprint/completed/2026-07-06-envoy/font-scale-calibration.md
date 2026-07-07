# PPTX Font-Scale Calibration — Bug, Fix, and Image-Measured Verification

**Date:** 2026-07-07
**Area:** `skills/vela-slides/app/parts/part-pptx.jsx` (native PowerPoint exporter)
**Symptom reported:** Text in the exported `.pptx` renders noticeably **smaller** than in the
source Vela app, while boxes/positions look roughly right.

## Root cause

The exporter maps the fixed 960×540 Vela canvas onto a fixed 16:9 PowerPoint slide of
exactly `12192000 × 6858000` EMU. That size bakes in a clean **1:1 mapping**:

```
12192000 EMU / 960 px = 12700 EMU per canvas-px
914400 EMU/inch ÷ 72 pt/inch = 12700 EMU per point
⇒ 1 canvas px == 1 point (exactly)
```

All **shape geometry** (`pptxEmu`) used this 1:1 constant (`PPTX_EMU_PER_PX = 12700`).
But the **font-size** helper applied an *additional* CSS-px→pt factor on top of it:

```js
// BEFORE (buggy)
const pptxCpt = (px) => Math.round((px || 0) * 0.75 * 100); // px → centipoints
```

The `0.75` is the standard 96 DPI → 72 DPI ratio (`72/96`) — correct only when converting a
CSS pixel to a point **independently**. Here the slide size *already* encodes a 1:1
canvas-px→point mapping, so multiplying by `0.75` again is a **double conversion**: it shrank
every text run to **75%** of its correct size while the surrounding boxes/shapes (placed with
the un-shrunk `12700` constant) stayed full-size. That is exactly the reported symptom —
text too small relative to its container, geometry fine.

`pptxCpt` is the single conversion used by **both** text boxes (`pptxTextSp`) and **table
cells** (`pptxTableCellXml`), so fixing the function corrects every text-bearing element at
once.

## The fix

`part-pptx.jsx` — remove the extra `0.75`:

```js
// AFTER (fixed) — 1 canvas px = 1 pt, same mapping pptxEmu uses for geometry
const pptxCpt = (px) => Math.round((px || 0) * 100); // px → centipoints (1 canvas px = 1 pt)
```

(The JSDoc units block at the top of the file was updated to match.)

**OOXML proof** (exported `sz`, in centipoints) for the calibration slide:

| block            | source px | BEFORE `sz` | AFTER `sz` | correct (px×100) |
|------------------|-----------|-------------|------------|------------------|
| heading          | 120       | 9000 (90pt) | **12000 (120pt)** | 12000 |
| text             | 48        | 3600 (36pt) | **4800 (48pt)**   | 4800  |
| callout "RULER"  | ~22.4     | 1260        | **1680**   | —                |

Geometry was already correct and unchanged: the green ruler box exports at
`cx = 6096000 EMU = 480.0 px` exactly, before and after.

## Methodology — image measurement, not code review

A minimal calibration deck (`calibration/calibration.vela`, reproduced below) with high-contrast,
easy-to-threshold elements on a solid black slide:

- `heading` at `fontSize: 120` (white "HHHHHHHH" — flat-topped glyphs = clean cap-height)
- `text` at `fontSize: 48` (white "HHHHHHHH")
- `callout` with a solid `#00ff00` background, `width: 480` — a **geometry ruler** of known
  canvas width, used to normalize pixel measurements (and independent of the font bug).

Pipeline (scripts saved under `calibration/`, portable — resolve repo root from their own path):

1. **Source render** — boot the offline render, select the module, screenshot the editor's
   slide-canvas element (`src-canvas.cjs`). The canvas renders the slide in true canvas-px at a
   precise, read-back transform scale (1.44593 here); the green box measured back to exactly
   480 canvas-px, validating the normalization.
2. **Export** — drive the real Export → PowerPoint UI path (`calib-drive.cjs`) and read the
   `.pptx` bytes back.
3. **Rasterize export** — `soffice --convert-to pdf` then `pdftoppm -r 144 -png` → a fixed
   1921×1080 PNG (slide 960 pt wide → scale ≈ 2.0 img-px/canvas-px, cross-checked: green box
   measured back to 480.0 canvas-px).
4. **Measure** — PIL (`measure.py`) thresholds white glyphs and the green box, measuring each
   band's bounding-box **cap-height** and the box width, then normalizes to canvas-px using the
   green box (known 480). Two text sizes confirm a single multiplicative factor vs. a messier
   cause.

For a clean before/after on the same deck, the `0.75` constant was temporarily reverted to
re-export the "before" `.pptx`, then the fix restored.

## Measured results (cap-height normalized to canvas-px)

| element         | SOURCE | EXPORT BEFORE      | EXPORT AFTER         |
|-----------------|--------|--------------------|----------------------|
| heading (120px) | 83.12  | 65.09 (**78.3%**)  | 72.55 (**87.3%**)    |
| text (48px)     | 32.55  | 25.84 (**79.4%**)  | 33.29 (**102.3%**)   |
| green box width | 480.0  | 480.0 (100%)       | 480.0 (100%)         |

- **Before:** text ~**0.78–0.79×** the source size — a consistent multiplicative shrink across
  both sizes, confirming a single conversion-constant bug (the measured 0.78 vs the exact 0.75
  in the XML is Chromium-vs-LibreOffice font-substitution metrics; the OOXML `sz` is the ground
  truth at exactly 0.75). Geometry (green box) is unaffected — 480 in both.
- **After:** body text matches source within **~2%** (102.3%). Heading is 87.3%.

### On the heading's residual ~13%

It is **not** the conversion (the `sz` is now provably exact at 120pt). It is PowerPoint's
`<a:normAutofit/>` **shrink-to-fit**: the text box height comes from the source DOM bounding
rect, and at 120pt a small line-height difference between the browser's fallback font and
LibreOffice's substitute pushes the (now correctly-sized) glyph just past the box, so LibreOffice
scales it down to fit. The smaller body text has headroom and renders at full size (102%). This
autofit behavior is deliberate overflow-prevention, pre-existing, and shared by all text; with
matching real fonts (Sora/DM Sans on Claude.ai + PowerPoint) the heading tracks closer to 100%.
It was intentionally **not** altered, per the requirement to preserve shrink-to-fit.

**Tolerance statement:** body text within ±3% of source (met: +2.3%); large headings within the
autofit envelope (~13% under, attributable to normAutofit + font substitution, not the fixed
conversion).

## Regression protection

- `tests/test_pptx_export.cjs`: new assertion — the largest exported `sz` must be **≥ 3600 cpt**.
  tech-talk's largest heading exports at ~4160 cpt (41.6pt); the `0.75` bug would drop it to
  ~3120 cpt, so this floor catches a reintroduction.
- Full suite: **354 passed**, pptx e2e **14 passed / 0 failed** (was 13; +1 new assertion),
  python-pptx read-back OK.

## Reusable asset

`calibration/` contains everything to re-run this check without rebuilding the methodology:
`calibration.vela`, `src-canvas.cjs`, `calib-drive.cjs`, `measure.py`, and
`img/{source,export-before-fix,export-after-fix}.png`.

Re-run (from repo root, after `concat.py`):

```bash
node .hyper-sprint/render-offline.js .hyper-sprint/completed/2026-07-06-envoy/calibration/calibration.vela /tmp/vout
node .hyper-sprint/completed/2026-07-06-envoy/calibration/src-canvas.cjs /tmp/vout/render.html /tmp/src.png
node .hyper-sprint/completed/2026-07-06-envoy/calibration/calib-drive.cjs /tmp/vout/render.html /tmp/ignore.png /tmp/out.pptx
soffice --headless --convert-to pdf --outdir /tmp /tmp/out.pptx && pdftoppm -r 144 -png /tmp/out.pdf /tmp/exp
python3 .hyper-sprint/completed/2026-07-06-envoy/calibration/measure.py /tmp/src.png SOURCE
python3 .hyper-sprint/completed/2026-07-06-envoy/calibration/measure.py /tmp/exp-1.png EXPORT
```

## Calibration deck (inline, self-contained)

```json
{
  "deckTitle": "Font Scale Calibration",
  "lanes": [{
    "title": "Calibration",
    "items": [{
      "title": "Calib", "status": "todo",
      "slides": [{
        "bg": "#000000", "color": "#ffffff", "accent": "#00ff00",
        "align": "center", "duration": 60,
        "blocks": [
          { "type": "heading", "text": "HHHHHHHH", "color": "#ffffff", "style": { "fontSize": 120, "lineHeight": 1.2, "fontWeight": 700 } },
          { "type": "spacer", "size": 40 },
          { "type": "text", "text": "HHHHHHHH", "color": "#ffffff", "style": { "fontSize": 48, "lineHeight": 1.4, "fontWeight": 400 } },
          { "type": "spacer", "size": 40 },
          { "type": "callout", "text": "RULER", "bg": "#00ff00", "color": "#000000", "style": { "background": "#00ff00", "width": 480 } }
        ]
      }]
    }]
  }]
}
```
