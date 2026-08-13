# Screenshot Runbook

How to screenshot Vela slides for visual testing/comparison.

## Prerequisites

- **Node.js 22+** with Playwright via pnpm
- Playwright is a Node module (not Python) — use `node` to run scripts, not `python3`

## Quick Recipe

### 1. Static HTML screenshots (fastest, no server needed)

For isolated components (SVG arrows, block layouts, etc.): standalone HTML file in `decks/` (gitignored), screenshot with a `.mjs` script:

```javascript
// decks/screenshot.mjs
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto(`file://${path.join(__dirname, 'test.html')}`);
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(__dirname, 'screenshot.png'), fullPage: true });
await browser.close();
```

```bash
node decks/screenshot.mjs
```

(Equivalently, `node -e "<same code>" --input-type=module` works inline without a file.)

### 2. Full deck screenshots (requires server)

The Vela server compiles JSX via in-browser Babel — the 1MB monolith takes **15-30+ seconds** to render.

**Server must run in the same bash invocation as the node script.** Background processes (`&`) don't persist across separate Bash tool calls. Use this pattern:

```bash
python3 tools/vela-dev/scripts/serve.py decks/ --no-open --no-auth --port 3034 &
sleep 6
node decks/screenshot-deck.mjs
kill %1 2>/dev/null
```

**The deck takes a long time to load.** Wait for actual content, not just `networkidle`:

```javascript
for (let attempt = 0; attempt < 30; attempt++) {
  await page.waitForTimeout(2000);
  const text = await page.textContent('body');
  if (text?.includes('Your Expected Content')) break;
}
```

**Server auth:** `--no-auth` for automated screenshots; token file is `.vela.env` (not `.vela-server-*`).

**Deck URL:** `http://127.0.0.1:{port}/deck/{filename.vela}`

## Before/After Comparison Pattern

For visual fixes (alignment, spacing, arrows, centering), create a single HTML file that renders **BEFORE** and **AFTER** side by side. This is the fastest way to confirm a fix without serving a full deck.

### Structure

```html
<!-- decks/test-<block>.html -->
<div class="row">
  <div class="test">
    <h3>BEFORE</h3>
    <div id="before-0"></div>
  </div>
  <div class="test">
    <h3>AFTER</h3>
    <div id="after-0"></div>
  </div>
</div>
```

Render the original (broken) code in the BEFORE column, the fix in the AFTER column. Use multiple test cases with varying content sizes (e.g., 2-6 items, even/uneven content) to catch edge cases.

### Cropped Screenshots

Use `clip` to zoom into specific areas — full-page shots are too small to see alignment issues:

```javascript
await page.screenshot({
  path: 'decks/test-block-row1.png',
  clip: { x: 0, y: 30, width: 1400, height: 350 }
});
```

### Debug Overlays

When centering is ambiguous, add: a red semi-transparent container background (bounds), an absolute 1px red line at 50% (true center), a blue background on the text element (box model).

```html
<div style="...flex centering...; background: rgba(255,0,0,0.1); position: relative;">
  <span style="...label...; background: rgba(0,100,255,0.2);">LABEL</span>
  <div style="position:absolute;left:0;right:0;top:50%;height:1px;background:red;"></div>
</div>
```

### Technique Comparison

When the fix approach is unclear, render 3+ techniques side by side in one HTML file to compare visually before committing to one. Example: testing `writing-mode: vertical-rl` vs `rotate(-90deg)` vs `margin: auto` for vertical label centering.

### CSS Vertical Text

`writing-mode: vertical-rl` + `transform: rotate(180deg)` has a known centering issue — flex `align-items: center` doesn't visually center the text because the layout box doesn't match the visual center after transform. Use `transform: rotate(-90deg)` + `white-space: nowrap` instead — it preserves the original horizontal layout box so flex centering works correctly.

## Pixel-Level Alignment Verification

**Don't trust LLM vision for alignment checks.** Use Playwright's `page.evaluate()` to measure actual pixel positions via `getBoundingClientRect()`.

### Measuring Gap Balance (e.g., VS divider spacing)

`.mjs` script pattern: measure bounding boxes of key elements, compute gaps (here, a "VS" circle vs. the nearest text edges in each pane), diff the two:

```javascript
// decks/screenshot-comparison.mjs
const metrics = await page.evaluate(() => {
  const results = [];
  document.querySelectorAll('.row').forEach((row, ri) => {
    row.querySelectorAll('.test').forEach((test, ti) => {
      const panes = test.querySelector('div[style*="display:flex;gap:0"]')?.children;
      if (!panes) return;
      let vsRect = null;
      for (const p of panes) {
        const c = p.querySelector('div[style*="border-radius:50%"]');
        if (c?.textContent === 'VS') { vsRect = c.getBoundingClientRect(); break; }
      }
      let leftX = 0, rightX = Infinity;
      panes[0].querySelectorAll('span').forEach(s => {
        const r = s.getBoundingClientRect();
        if (r.right > leftX && r.width > 0 && s.textContent.length) leftX = r.right;
      });
      panes[panes.length - 1].querySelectorAll('span[style*="border-radius:50%"]').forEach(s => {
        const r = s.getBoundingClientRect();
        if (r.left < rightX && r.width > 0) rightX = r.left;
      });
      results.push({
        row: ri, variant: ti === 0 ? 'BEFORE' : 'AFTER',
        gapLeftTextToVS: vsRect ? Math.round(vsRect.left - leftX) : null,
        gapVSToRightText: vsRect ? Math.round(rightX - vsRect.right) : null,
      });
    });
  });
  return results;
});

metrics.forEach(m => console.log(`Row ${m.row} ${m.variant}: L→VS=${m.gapLeftTextToVS}px  VS→R=${m.gapVSToRightText}px  BALANCE: ${Math.abs(m.gapLeftTextToVS - m.gapVSToRightText)}px`));
```

### Checking Element Alignment (e.g., bullet dots share same x)

```javascript
const positions = [...pane.querySelectorAll('span[style*="border-radius:50%;background:#"]')]
  .map(d => Math.round(d.getBoundingClientRect().left));
const allSame = positions.every(x => x === positions[0]);
console.log(`dots at x=${positions.join(', ')}${allSame ? ' ✅ ALIGNED' : ' ❌ MISALIGNED'}`);
```

### Key Principles

- **Always measure pixels, never eyeball.** `getBoundingClientRect()` is ground truth.
- **1px tolerance is acceptable** — sub-pixel rounding is normal.
- **Test multiple scenarios**: short text, long text, uneven item counts, wrapping text.
- **Before/After HTML** side-by-side lets you run both versions in one screenshot pass.
- **Reusable scripts** go in `decks/screenshot-*.mjs` and `decks/check-*.mjs` (gitignored).

## Gotchas

| Issue | Solution |
|-------|----------|
| `ModuleNotFoundError: playwright` | Playwright is Node-only. Use `node`, not `python3` |
| Server dies between bash calls | Run server + node in same `bash` command with `&` |
| Deck stuck on loading screen | Wait 15-30s+ for Babel compilation of 1MB JSX |
| `networkidle` timeout | Use `load` + content polling instead |
| Screenshots show loading spinner | Increase wait time or poll for expected text |
| Port already in use | Use a different `--port` |

## File Conventions

- Test HTML: `decks/test-*.html` (gitignored)
- Screenshot scripts: `decks/screenshot-*.mjs` (gitignored)
- Screenshot outputs: `decks/ss-*.png` (gitignored)
- Production screenshots: `docs/screenshots/` (committed)
