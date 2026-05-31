# Vela Desktop (Neutralino) — Security Notes

The desktop shell wraps the same Vela engine in a Neutralino webview that is
granted **native capabilities** the browser/artifact runtimes never have:
`os.spawnProcess` (to run the local coding-agent CLI) and `filesystem.*`
(to read/write decks on disk). This raises the stakes of any in-app XSS: in
the artifact sandbox a sanitizer bypass is contained DOM XSS; **in this
webview the same bypass could reach `Neutralino.os.spawnProcess` → host RCE.**

The primary defense remains the engine's deck-JSON sanitization
(`validateAndSanitizeDeck` / `sanitizeSvgMarkup` / link sanitizers — see the
repo-level `docs/SECURITY.md`). The measures here exist to **contain the
blast radius if that primary defense is ever bypassed.**

## Layers in place

1. **Content-Security-Policy** (`resources/index.html`, `<meta http-equiv>`).
   Active directives: `object-src 'none'`, `base-uri 'none'`,
   `frame-ancestors 'none'`, `form-action 'none'`, and a `connect-src`
   restricted to same-origin + the local Neutralino WebSocket bridge
   (`localhost`). These block plugin/embed injection, `<base>` hijacking,
   clickjacking/framing, form-based exfiltration, and arbitrary network
   exfiltration — none of which the legitimate app needs.

2. **Minimal `nativeAllowList`** (`neutralino.config.json`). Only the native
   methods the shell actually calls are exposed; wildcards like `os.*` /
   `filesystem.*` and unused namespaces (`clipboard.*`, `computer.*`,
   `extensions.*`) are **not** granted. Re-audit with:
   ```
   grep -rhoE "Neutralino\.[a-zA-Z]+\.[a-zA-Z]+" resources/ | sort -u
   ```
   Any method in the allowlist that no longer appears in that list should be
   removed.

3. **Inert error/UI surfaces** (`resources/js/nl-boot.js`). Strings that may
   contain attacker-controlled deck content (validator errors, agent
   stderr/stdout, on-disk filenames in the deck picker) are rendered with
   `textContent`-only DOM nodes — never `innerHTML` — so a filename like
   `<img src=x onerror=…>.vela` cannot execute.

4. **Injection-safe agent bridge** (`resources/js/agents-bridge.js`). The CLI
   is invoked with a hardcoded command (`claude -p …`); the prompt is passed
   on **stdin**, never interpolated into the command line.

## Known gap / path to strict CSP

`script-src` still allows `'unsafe-inline'` and `'unsafe-eval'` because the
desktop boot (`nl-boot.js`) fetches `vela.jsx` and transpiles it with Babel
**at runtime**, then evaluates the result, and `index.html` contains inline
`<script>` blocks.

The strongest containment — `script-src 'self'` (which would neutralize *all*
injected `<script>` / `on*=` / `javascript:` execution before it could reach
the native bridge) — requires:

1. **Pre-transpile `vela.jsx` at build time** (Node-side Babel, as the E2E
   harness already does) and ship plain JS, dropping the runtime Babel +
   `eval`.
2. **Move the inline `<script>` blocks** in `index.html` into separate `.js`
   files served from the document root.

After both, `'unsafe-inline'`/`'unsafe-eval'` can be dropped from
`script-src`. This is a build-pipeline change tracked as future work.

## When changing any of the above

There is **no Neutralino runtime in CI**, so changes to the CSP, the
`nativeAllowList`, or the boot scripts require a manual **desktop smoke
test** — in particular confirm the native bridge still connects (deck
load/save, folder picker, agent availability) under the current CSP.
