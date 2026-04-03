# Screenshot Runbook

How to take screenshots of Vela slides for visual testing and comparison.

## Prerequisites

- **Node.js 22+** with Playwright installed via pnpm
- Playwright is a Node module (not Python) — use `node` to run scripts, not `python3`

## Quick Recipe

### 1. Static HTML screenshots (fastest, no server needed)

For testing isolated components (SVG arrows, block layouts, etc.), create a standalone HTML file and screenshot it directly:

```bash
# Create your test HTML in decks/ (gitignored)
# Then screenshot it:
node -e "
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto('file:///absolute/path/to/test.html');
await page.waitForTimeout(500);
await page.screenshot({ path: 'decks/screenshot.png', fullPage: true });
await browser.close();
" --input-type=module
```

Or use a `.mjs` script:

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

### 2. Full deck screenshots (requires server)

The Vela server compiles JSX via in-browser Babel — the 1MB monolith takes **15-30+ seconds** to render. Key gotchas:

**Server must run in the same bash invocation as the node script.** Background processes (`&`) don't persist across separate Bash tool calls. Use this pattern:

```bash
python3 skills/vela-slides/scripts/serve.py decks/ --no-open --no-auth --port 3034 &
sleep 6
node decks/screenshot-deck.mjs
kill %1 2>/dev/null
```

**The deck takes a long time to load.** Wait for actual content, not just `networkidle`:

```javascript
// Wait for Vela loading screen to finish
for (let attempt = 0; attempt < 30; attempt++) {
  await page.waitForTimeout(2000);
  const text = await page.textContent('body');
  if (text && text.includes('Your Expected Content')) break;
}
```

**Server auth:** Use `--no-auth` for automated screenshots. The token file is `.vela.env` (not `.vela-server-*`).

**Deck URL pattern:** `http://127.0.0.1:{port}/deck/{filename.vela}`

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

## Gotchas

| Issue | Solution |
|-------|----------|
| `ModuleNotFoundError: playwright` | Playwright is Node-only. Use `node`, not `python3` |
| Server dies between bash calls | Run server + node in same `bash` command with `&` |
| Deck stuck on loading screen | Wait 15-30s+ for Babel compilation of 1MB JSX |
| `networkidle` timeout | Use `load` + content polling instead |
| Screenshots show loading spinner | Increase wait time or poll for expected text content |
| Port already in use | Use a different `--port` value |

## File Conventions

- Test HTML files: `decks/test-*.html` (gitignored)
- Screenshot scripts: `decks/screenshot-*.mjs` (gitignored)
- Screenshot outputs: `decks/ss-*.png` (gitignored)
- Production screenshots: `docs/screenshots/` (committed)
