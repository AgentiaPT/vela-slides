# Vela Desktop (Neutralino) — Security Notes

The desktop shell wraps the same Vela engine in a Neutralino webview that is
granted **native filesystem capabilities** the browser/artifact runtimes
never have: `filesystem.*` (to read/write decks on disk). This raises the
stakes of any in-app XSS: in the artifact sandbox a sanitizer bypass is
contained DOM XSS; **in this webview the same bypass could reach
`Neutralino.filesystem.*` and read/overwrite files inside the user's
allowed roots.**

`os.spawnProcess` — the host command-execution primitive — is **not granted**.
With it absent, even a full script-execution escape in the webview has no
exec to call, so the worst case is bounded to file reads/writes within the
allowed roots (see layer 3), not host RCE.

The primary defense remains the engine's deck-JSON sanitization
(`validateAndSanitizeDeck` / `sanitizeSvgMarkup` / link sanitizers — see the
repo-level `docs/SECURITY.md`). The measures here exist to **contain the
blast radius if that primary defense is ever bypassed.**

The shell also surfaces an **explicit "externally authored deck" warning**
on every deck open (see `resources/js/deck-warning.js`). Vela is intended
for personal authoring with AI-agent assistance — opening someone else's
deck is the primary social-engineering vector and the warning forces an
acknowledgment before the deck mounts.

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

   **`os.spawnProcess` is intentionally NOT granted, and the AI integration
   that depended on it is fully disabled.** Process spawn is the host
   command-execution primitive and is the single largest XSS→RCE risk.
   `nl-boot.js` no longer imports `agents-bridge.js`, no longer probes for
   a CLI agent, and hardcodes `window.__velaAgentReady = false` so the
   monolith's `velaAIAvailable()` reports AI as unavailable. The
   `agents-bridge.js` source file is kept for reference but is dead code —
   none of its `Neutralino.os.spawnProcess` / `updateSpawnedProcess` calls
   can run because (a) the methods are absent from the allowlist and
   (b) nothing imports the module. The desktop app is a **viewer/editor
   only**. Re-enabling AI later requires: (1) putting `os.spawnProcess`
   and `os.updateSpawnedProcess` back in the allowlist, (2) re-importing
   `agents-bridge.js` from `nl-boot.js` and restoring `installAgentsBridge()`,
   (3) accepting the larger XSS→RCE blast radius (or first moving exec
   into a Neutralino extension process).

3. **Filesystem path guard** (`resources/js/fs-guard.js`). The shell still
   needs `filesystem.*` to read/write decks and app config, so a
   script-execution escape could otherwise read/write arbitrary files.
   `fsGuard.install()` (called in `nl-boot.js` right after
   `Neutralino.init()`) wraps every `Neutralino.filesystem.*` method so its
   path argument(s) must resolve inside an explicitly-allowed root. Only
   two roots are ever registered:

   - The **user's decks folder** — registered by `deck-io.js` after the
     user picks it via `os.showFolderDialog`. **This is the only location
     deck saves can write to.** All in-app edits flow through
     `deckIO.saveCurrent` → `Neutralino.filesystem.writeFile` with a path
     under this root.
   - **`~/.vela`** — registered by `config-store.js` for the global app
     config (`config.json`, recent folders) and per-folder trust state
     (`<folder>/.vela/trust.json`). Holds no deck content.

   Traversal (`..`) segments and prefix-sibling paths (`/Decks` vs
   `/DecksEvil`) are rejected. Re-audit allowed roots with:
   ```
   grep -n "fsGuard.allow" resources/js/*.js
   ```
   This caps the *file* blast radius to Vela's own data. It is not a full
   sandbox — same-realm JS can never be fully contained — but combined
   with no `os.spawnProcess`, it removes the "arbitrary file read/write"
   capability outside those two roots.

4. **Inert error/UI surfaces** (`resources/js/nl-boot.js`). Strings that may
   contain attacker-controlled deck content (validator errors, agent
   stderr/stdout, on-disk filenames in the deck picker) are rendered with
   `textContent`-only DOM nodes — never `innerHTML` — so a filename like
   `<img src=x onerror=…>.vela` cannot execute.

5. **Injection-safe agent bridge** (`resources/js/agents-bridge.js`).
   Currently **not imported** by `nl-boot.js` and therefore not executed at
   all (see layer 2). Kept as reference for any future AI re-enablement.
   If re-enabled, the CLI would be invoked with a hardcoded command
   (`claude -p …`) and the prompt passed on **stdin**, never interpolated
   into the command line.

6. **Externally-authored-deck warning** (`resources/js/deck-warning.js`).
   A modal shown on every deck load (initial boot + picker selection)
   reminds the user that Vela is intended for personal authoring with AI
   agents, and that externally authored decks should never be trusted. The
   user has to explicitly acknowledge before the deck mounts. There is no
   "don't show again" — the reminder is the point. This is a behavioural /
   social-engineering defense, layered on top of (not in place of) the
   technical sanitizers and the no-`os.spawnProcess` posture.

7. **Update notifier** (`resources/js/update-check.js`). Fetches a static JSON
   manifest from `raw.githubusercontent.com` once per 24 hours to check for
   new Vela releases. This is the app's **first outbound network connection**.

   **No new native permissions.** The release URL is opened via
   `window.open(url, '_blank')` (standard web API, delegated to the system
   browser by the webview), not via `Neutralino.os.open`. The
   `nativeAllowList` is unchanged.

   **Release URL is hardcoded**, not read from the manifest. Constructed as
   `https://github.com/agentiapt/vela-slides/releases/tag/v${version}`. The
   manifest only carries `latest` (string) and `minSafeVersion` (string),
   both validated as semver. This eliminates path-traversal attacks where a
   poisoned `releaseUrl` like `https://github.com/agentiapt/vela-slides/../../attacker/repo`
   would pass a `startsWith` check but resolve to an attacker-controlled
   page. Even with the hardcoded pattern, the built URL is normalized via
   `new URL().href` and verified against the expected origin.

   **CSP change:** The `connect-src` directive was extended with the **exact
   manifest URL** on `raw.githubusercontent.com` — path-pinned, not a
   domain-wide grant. CSP path matching ensures XSS cannot `fetch()` from
   arbitrary paths on that domain (e.g., attacker-controlled repos). The
   fetch carries no authentication, no cookies, and sends no user data.

   **Residual risk — `unsafe-eval` compound.** With `script-src` still
   allowing `'unsafe-eval'`, an XSS exploit could theoretically read the
   manifest response. However, the path-pinned CSP means only the single
   manifest JSON file is reachable — not arbitrary GitHub content — so
   the attacker cannot use `raw.githubusercontent.com` as a stage-2 payload
   source. The long-term fix is eliminating `unsafe-eval` (see "Known gap"
   below).

   **Privacy.** The fetch leaks the user's IP address and User-Agent to
   GitHub/Fastly CDN. This is opt-outable via `checkForUpdates: false` in
   `~/.vela/config.json`.

   **Modal UI** uses `textContent`-only DOM construction (no `innerHTML`).
   No attacker-controlled text from the manifest is rendered — all modal
   copy is hardcoded. The security modal (shown when current version is
   below `minSafeVersion`) is dismissible to prevent denial-of-service via a
   poisoned manifest; the dismissal expires after 7 days.

   **Response size cap.** The fetch aborts if `Content-Length` exceeds 10 KB,
   and the response body is checked after read. This prevents memory
   exhaustion from a compromised endpoint serving a large response.

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
