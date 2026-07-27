# Screenshot Runbook

How to take screenshots of Vela slides for visual testing and comparison.

## Prerequisites

This container **blocks the React/lucide CDNs (esm.sh) and the Playwright browser
CDN**, so `serve.py`'s default esm.sh-importmap HTML never boots here, and
`npx playwright install` cannot fetch a browser. Don't try either. Use the
offline, no-CDN render harness instead — see skill **`vela-live-render`** (the
shared recipe: vendored UMD React/ReactDOM/lucide-react + Babel, transpiled in
Node, loaded as an external `<script>`; Chromium is pre-pinned at
`/opt/pw-browsers/`).

## Quick Recipe

**Ad-hoc / one-off screenshot** (explore a state, reproduce a bug, verify a UX
change): use the **`playwright-cli-setup`** skill. It drives a persistent
Playwright-CLI browser session (`open`, `snapshot`, `eval`, screenshot) against
the same offline render, one command at a time, so you can inspect state
between steps instead of running a script blind.

**Repeatable / committed screenshot** (CI, a benchmark, a recorded demo — the
script itself is the deliverable): use the **`vela-live-render`** skill's
committed `vela-drive.js`:

```bash
python3 tools/vela-dev/scripts/concat.py                                   # after editing parts
node tools/vela-dev/scripts/render-offline.js <deck.vela> /tmp/vout        # build offline render
node tools/vela-dev/scripts/vela-drive.js shot /tmp/vout/render.html /tmp/s.png --w 1280 --h 800
#     add: --eval "window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}))" --wait 500
```

For isolated components (SVG arrows, block layouts, before/after comparisons)
you don't need a full deck render at all — build a standalone HTML file (see
the Before/After pattern below) and screenshot *that* with either skill above;
it's much faster than booting the full app.

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

Use `clip` to zoom into specific areas — full-page screenshots are too small to see alignment issues:

```javascript
await page.screenshot({
  path: 'decks/test-block-row1.png',
  clip: { x: 0, y: 30, width: 1400, height: 350 }
});
```

### Debug Overlays

When centering is ambiguous, add visual markers:
- Red semi-transparent background on the container to show its bounds
- Absolute-positioned 1px red line at 50% to mark the true center
- Blue background on the text element to show its box model

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

Create a `.mjs` script that measures bounding boxes of key elements and computes gaps:

```javascript
// decks/screenshot-comparison.mjs
const metrics = await page.evaluate(() => {
  const rows = document.querySelectorAll('.row');
  const results = [];
  rows.forEach((row, ri) => {
    const tests = row.querySelectorAll('.test');
    tests.forEach((test, ti) => {
      const container = test.querySelector('div[style*="display:flex;gap:0"]');
      if (!container) return;
      const panes = container.children;

      // Find VS circle
      let vsRect = null;
      for (const child of panes) {
        const circle = child.querySelector('div[style*="border-radius:50%"]');
        if (circle && circle.textContent === 'VS') {
          vsRect = circle.getBoundingClientRect();
          break;
        }
      }

      // Find rightmost text pixel in left pane
      const leftPane = panes[0];
      let leftRightmostX = 0;
      leftPane.querySelectorAll('span').forEach(s => {
        const r = s.getBoundingClientRect();
        if (r.right > leftRightmostX && r.width > 0 && s.textContent.length > 0)
          leftRightmostX = r.right;
      });

      // Find leftmost element in right pane
      const rightPane = panes[panes.length - 1];
      let rightLeftmostX = Infinity;
      rightPane.querySelectorAll('span[style*="border-radius:50%"]').forEach(s => {
        const r = s.getBoundingClientRect();
        if (r.left < rightLeftmostX && r.width > 0)
          rightLeftmostX = r.left;
      });

      results.push({
        row: ri, variant: ti === 0 ? 'BEFORE' : 'AFTER',
        gapLeftTextToVS: vsRect ? Math.round(vsRect.left - leftRightmostX) : null,
        gapVSToRightText: vsRect ? Math.round(rightLeftmostX - vsRect.right) : null,
      });
    });
  });
  return results;
});

metrics.forEach(m => {
  const balance = Math.abs(m.gapLeftTextToVS - m.gapVSToRightText);
  console.log(`Row ${m.row} ${m.variant}: L→VS=${m.gapLeftTextToVS}px  VS→R=${m.gapVSToRightText}px  BALANCE: ${balance}px`);
});
```

### Checking Element Alignment (e.g., bullet dots share same x)

```javascript
// Verify all bullet dots in a pane share the same x coordinate
const dots = pane.querySelectorAll('span[style*="border-radius:50%;background:#"]');
const positions = [];
dots.forEach(d => positions.push(Math.round(d.getBoundingClientRect().left)));
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
| esm.sh / CDN import fails, `npx playwright install` hangs | CDNs are blocked in-container — use the offline render harness (`vela-live-render`), not `serve.py`'s default HTML |
| Inlining the 1.3MB monolith as `<script type="text/babel">` truncates | It contains literal `</script>` inside XSS-test payload strings; `render-offline.js` transpiles in Node and loads an external `app.js` instead |
| `ERR_INVALID_URL` / `ERR_CONNECTION_CLOSED` console errors | Harmless — just blocked external font/asset fetches; the app still renders fully |
| `serve.py` port binding gets SIGKILLed in a Bash tool call | Prefer the `file://` offline harness — it needs no server at all |

## File Conventions

- Test HTML files: `decks/test-*.html` (gitignored)
- Screenshot scripts: `decks/screenshot-*.mjs` (gitignored)
- Screenshot outputs: `decks/ss-*.png` (gitignored)
- Production screenshots: `docs/screenshots/` (committed)
