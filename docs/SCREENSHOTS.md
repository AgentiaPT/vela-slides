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
