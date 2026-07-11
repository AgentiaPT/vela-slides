---
name: vela-browser-test
description: Verify Vela rendering/security behavior in a REAL browser (and against the REAL deck sanitizers) inside the remote-execution container. Use when you need to confirm whether a deck/SVG/CSS payload actually executes or fires a network request when rendered — e.g. exfil/XSS hunts, "does this beacon fire", confirming a sanitizer fix, or any claim that needs more than reading source. Also records how to launch the prebuilt Chromium here despite blocked CDNs.
allowed-tools: Bash(node *), Bash(npm install*), Bash(python3 skills/vela-slides/scripts/*), Read, Write, Edit, Glob, Grep
---

# Vela browser/sanitizer testing

The principle for Vela security work: **a defense is only proven once a payload is
fed through the real code and observed to be neutralized.** Reading source is not
proof. This skill gives you the two layers needed to do that here.

## Environment facts (this remote-execution container)

- **Prebuilt Chromium exists** under `/opt/pw-browsers/chromium-*/chrome-linux/chrome`
  (and a `headless_shell`). It is part of the image, so it survives across sessions.
- **Playwright's browser-download CDN is blocked** — `npx playwright install` fails.
  Do NOT try to download a browser. Launch the existing one via `executablePath`
  and ignore Playwright's version pin:
  ```js
  const { chromium } = require("./node_modules/playwright");          // or playwright-core
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-XXXX/chrome-linux/chrome", args: ["--no-sandbox"] });
  ```
  (`scripts/browser-probe.cjs` auto-discovers the path — don't hardcode the build number.)
- **`registry.npmjs.org` is reachable (200); general web is blocked (403).** So
  `npm install jsdom playwright` works, but the React/Babel/cdnjs CDNs that
  `app/local.html` pulls are blocked → **the full Vela app will not boot from CDN**
  in the browser. Test the rendered **sinks** (the markup Vela emits) directly, or
  vendor react/react-dom/@babel-standalone into `node_modules` and rewrite the
  `<script src>` tags to local paths if you truly need the whole app.
- **`node_modules` is gitignored and ephemeral.** On a fresh container, restore deps:
  ```bash
  (cd "$REPO" && npm install --no-audit --no-fund --ignore-scripts jsdom playwright)
  ```
- For outbound-request / exfil tests there is no need to reach the internet: point
  payloads at a **local collector** (a throwaway `http.createServer` on `127.0.0.1`)
  and check its hit log. Both scripts below do this for you.

## Layer 1 — real sanitizers (static): `scripts/sanitizer-harness.cjs`

Loads the actual `validateAndSanitizeDeck` / `sanitizeSvgMarkup` / `sanitizeStyle` /
`scrubColorFields` / `sanitizeUrl` from `app/parts/part-imports.jsx` into jsdom.

```bash
node .claude/skills/vela-browser-test/scripts/sanitizer-harness.cjs   # self-test
```
```js
const H = require("<repo>/.claude/skills/vela-browser-test/scripts/sanitizer-harness.cjs");
const out = H.validateAndSanitizeDeck(rawDeck);   // full local-mode load path (fail-closed)
H.findLeaks(out);                                 // [] = nothing dangerous survived as a string
H.svgNetworkRefs(H.sanitizeSvgMarkup(markup));    // re-parsed exactly like dangerouslySetInnerHTML
```
Caveat: `findLeaks`/`svgNetworkRefs` are deliberately over-eager string matchers.
They flag `url()`/schemes even in attributes the browser never fetches from
(e.g. SVG filter `in`/`in2`/`result`/`values`) and are blind inside **base64**
`data:` URIs. A "leak" here means **go confirm it in Layer 2**, not "confirmed bug".

## Layer 2 — real browser (dynamic): `scripts/browser-probe.cjs`

Renders HTML in the real Chromium and reports which vectors actually executed or
fetched (via a live collector). This is what distinguishes a true bug from a
false positive — most notably the browser's **secure static mode**: SVG/HTML
loaded via `<img>` or CSS `background-image` runs with **scripting disabled and
external loads blocked**, so `data:image/svg+xml,<svg onload=…>` and
`data:text/html,<script>…>` in those sinks are inert.

```bash
node .claude/skills/vela-browser-test/scripts/browser-probe.cjs --self-test
# Custom page (use the literal token __COLLECTOR__ for the attacker origin):
node .claude/skills/vela-browser-test/scripts/browser-probe.cjs /tmp/page.html
```
`--self-test` is also a **regression gate** for the core invariant: it asserts the
Vela sinks (`<img src>`, CSS `background-image`, branding logo) stay inert while
three controls (inline `<svg onload>`, direct external `<img>`,
`<object type=image/svg+xml>`) DO fire — proving the probe isn't blind.

Established results (June 2026 audit, real Chromium): all `image.src` / `slide.bgImage`
/ `branding.logo` `data:` payloads are **inert**; the only active SVG contexts are
inline (`dangerouslySetInnerHTML` → both routed through `sanitizeSvgMarkup`) and
`<object>`/`<embed>`/`<iframe>` (Vela never uses these for deck content). The
invariant to protect on future changes: **never render deck-controlled SVG in an
active context.** Re-run `--self-test` after any change to image/bg/logo/SVG
rendering or the sanitizers.

## Full end-to-end against the live server (optional)

To test the actual serve.py → STARTUP_PATCH pipeline, boot a server on a temp
decks folder and point the probe at a vendored-deps build (CDN is blocked):
```bash
python3 tools/vela-dev/scripts/serve.py /tmp/decks --port 3031 --no-open --no-auth --channel-port 0 &
```
Without vendored react/babel the page won't hydrate, so for sink-level questions
prefer Layer 2 with the exact emitted markup; use the live server mainly for the
server-side surface (path traversal, auth, origin/CSRF, script-context escaping)
which is testable with plain `curl`.
