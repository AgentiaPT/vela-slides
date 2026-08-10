# Security

## Security Model

Vela Slides runs entirely inside Claude.ai's sandboxed artifact environment. There are no backend servers, no databases, no authentication flows. All data stays in the conversation and the artifact's local storage.

### Runtime Threat Model — Blast Radius by Execution Context

The same deck-JSON sanitizers run in three very different runtimes. The stakes
of a sanitizer bypass are **not** equal across them — they scale with what the
host page is allowed to do. Ranked highest-stakes first:

| Runtime | Host capabilities | Worst case if a deck-JSON sanitizer is bypassed | Backstop |
|---|---|---|---|
| **Neutralino desktop** | Native `filesystem.*` (read/write decks on disk) **and** real network egress (top-level webview). Worst case is **both** outbound exfil *and* file read/overwrite | Read/overwrite files inside the two allowed roots (`<decks>`, `~/.vela`), **plus** zero-click outbound exfil of deck/host/file data. No host RCE — `os.spawnProcess`/`os.execCommand` are **not** in `nativeAllowList` | `<meta>` CSP, minimal `nativeAllowList`, `fs-guard` path containment, deck-open warning. The desktop `<meta>` CSP no longer permits `https:` in `img-src`/`font-src`, so render-time image/font beacons are CSP-blocked here just as under `serve.py` — defense-in-depth on top of the deck sanitizers (which already force legitimate image `src`/`bgImage` to `data:` URIs), not the sole backstop. |
| **Local `serve.py`** | Top-level browser page on `localhost` — real network egress, reads loopback ports | Zero-click **outbound exfil** of deck/host data (no artifact-iframe CSP to fall back on) | HTTP-header CSP (`img-src 'self' data:`, closed `connect-src` allowlist), origin/CSRF/auth, path containment. Tighter than desktop: image/font beacons *are* CSP-blocked here, so a sanitizer miss still needs a `connect-src`-reachable sink to exfil |
| **Claude.ai artifact** | Sandboxed iframe; outbound network already blocked by Anthropic's CSP | Contained DOM XSS; exfil still blocked by the iframe CSP | Anthropic sandbox CSP (defense-in-depth on top of our sanitizers) |

**Priority order for this threat model: Neutralino desktop and local `serve.py`,
because they execute on the user's host with capabilities the artifact sandbox
denies.** The artifact's own CSP must never be treated as the primary control —
the sanitizers are, and they are what these two host runtimes rely on.

The central invariant the sanitizers protect, stated runtime-independently:
**no deck-supplied value may reach a sink that auto-fetches an external
resource on render, executes script, or reaches the native bridge.** Every
"image-loading" CSS/SVG/HTML construct is the regulated surface.

### Actively-Monitored Exfil / Leak Vector Classes

Tracked because they are the live edge of CSS/SVG/HTML-injection research and
map directly onto the `serve.py` / desktop "render fires a network request"
threat. Each is a **class to keep tested against the real code**, not a claim
that a hole exists — Vela's history (v12.52–v12.66) is a sequence of closing
exactly these as they emerged:

- **CSS auto-load beacons** — `url()`, `image-set()` / `image()` / `cross-fade()` / `src()` string sources, and any future string-taking CSS function in inline `style`, color/background scalars, or SVG `<style>`/presentation attributes. A render-time outbound GET = zero-click exfil.
- **Inline-style-only exfil primitives** — current published research (PortSwigger, *Inline Style Exfiltration*, 2026) shows CSS custom properties, `attr()`, and `if()`/`style()` conditionals can leak **same-element** data through a single `style=""` attribute with no selector and no external sheet — defeating "we only ban external stylesheets" reasoning. Defensive posture: no custom `--*` properties, no `attr()`/`if()`/`style()`-bearing values, no string-source functions — with exactly one narrow, deliberate exception (`--vera-accent`, the AI-working sweep tint). That property is held to a stricter bar than the general allowlist: the value is routed through the same CSS-context output encoder used at every other color sink before it ever reaches the custom property, *and* the property itself is CSS type-registered to the `<color>` syntax, so the CSS engine rejects any non-color value at the layer below JS as well. Both the general allowlist and this one gated exception are verified empirically against the real `sanitizeStyle`/`scrubColorFields`/encoder code, since on the host runtimes the sanitizer is the primary control.
- **Font-driven character exfil** — `@font-face` / `unicode-range` / `local()`+`src:url()` combinations that fetch a glyph file per leaked character.
- **Namespace-confusion / mutation XSS** — SVG↔HTML (and MathML) re-parse divergence where a node the sanitizer reads as inert text the browser re-parses as live markup (the `dangerouslySetInnerHTML` round-trip). Guarded by SVG-scope wrapping + CDATA/comment/PI stripping; must stay regression-tested.
- **Script-context breakout at injection** — deck JSON is embedded inline in `<script type="text/babel">` by `assemble.py` / `serve.py`, and by the in-app **Standalone-HTML export** (`buildStandaloneHtml`, which also inlines the transpiled app); `<`, `>`, `&`, U+2028/2029 are escaped so a deck string cannot close the script element or terminate the JS literal. The escaper is a single canonical implementation per language (Python / JS), reused at every injection site via replacer-function substitution (never pattern-splicing), and a parity test asserts the two implementations produce identical output — closing the "kept in sync by review" gap where the escapers could silently drift apart.
- **`serve.py` server surface** — path traversal / symlink escape on deck names, auth-token / session handling, cross-origin write (CSRF) and Host-header (DNS-rebinding) checks, and the script-context escaping above.
- **Neutralino native-bridge reachability** — the desktop webview is granted `filesystem.*` + `os.getEnv`. A deck value that achieves script execution in this realm could call `Neutralino.filesystem.*`/`os.getEnv` directly. `fs-guard.js` caps file blast radius to the two allowed roots (traversal-segment reject + prefix containment); `nativeAllowList` withholds `os.spawnProcess`/`os.execCommand` (no RCE). The invariant to keep tested: **no deck-supplied value reaches an active script context** (only inert/static SVG sinks), and `fs-guard` containment holds against path-normalization tricks (`..`, symlink, UNC/`\\`, drive-relative, URL-encoded separators).
- **Desktop CSP image/font egress (resolved)** — the desktop `<meta>` CSP formerly permitted `img-src/font-src https:`, which left image/CSS-url and font sinks as live render-time beacons on desktop even though the identical payload was CSP-blocked under `serve.py`. `https:` has now been dropped from both directives (`img-src 'self' data: blob:`, `font-src 'self' data:`), so a deck value reaching an `<img src>`, CSS `background-image`/`url()`, `image-set()`, or `@font-face src:url()` is CSP-blocked on desktop as it is under `serve.py` — defense-in-depth on top of the deck sanitizers, which already force legitimate image sources to `data:`. Empirically verified in a real browser under the actual desktop meta CSP: an `https:` image is now blocked at the CSP layer (was previously allowed to leave), while `data:` images render unchanged. Google Fonts (Sora / DM Sans / Space Mono) were already system-fallback on desktop — the getCss() `@import` is governed by `style-src` (`'self' 'unsafe-inline'`, no `fonts.googleapis.com`) and blocked one layer above `font-src`, so dropping `font-src https:` is a visual no-op for typography. Keep testing image/font/CSS-url sinks against the desktop CSP, not just the server CSP.

A defense in any of these classes is considered proven **only** when a payload
is fed through the real sanitizers and the real browser sink and observed to be
neutralized (see `.claude/skills/vela-browser-test/`) — never from source
review alone.

### Threat Surface

| Vector | Mitigation |
|---|---|
| Malicious JSON import | Block-type whitelisting, string sanitization, structure validation |
| SVG injection (XSS) | Multi-layer sanitization: script, foreignObject, use, animate, event handler, javascript: URI, xlink:href, CSS expression stripping |
| Oversized payloads | String length limits on all fields (200-50000 chars), block count limits (30/slide), row/column limits |
| CDN compromise (runtime libs) | `html2canvas` (PDF-export thumbnails only) loads best-effort from cdnjs.cloudflare.com and fails safe to layout-stats-only if it can't load; it is not SRI-pinned. The **Standalone-HTML export** pins React / ReactDOM / lucide-react from jsdelivr by SHA-384 `integrity` + `crossorigin` (byte-identical to the vendored Neutralino UMD copies). Standard client-side-app risk |
| Credential leakage | No API keys, tokens, or secrets in the codebase. Anthropic API calls use Claude.ai's built-in proxy |

### SVG Sanitization (Defense-in-Depth)

SVG blocks accept raw markup for custom diagrams. Vela applies sanitization at **two layers**:

1. **Import time** (`part-imports.jsx`) — when JSON is loaded or pasted
2. **Render time** (`part-blocks.jsx`) — before `dangerouslySetInnerHTML`

Both layers strip:
- `<script>` tags
- `<foreignObject>` (arbitrary HTML injection)
- `<use>` elements (external reference injection)
- `<animate>` and `<set>` elements (event handler vectors)
- `<iframe>`, `<embed>`, `<object>` elements
- `on*` event handler attributes
- `javascript:` URIs in `href`
- `xlink:href` pointing to external resources
- CSS `url(javascript:...)` and `expression()` in style attributes

### Import Validation

All imported deck JSON passes through `validateAndSanitizeDeck()` which enforces:
- Whitelisted block types only (`SAFE_BLOCK_TYPES`)
- Whitelisted slide/block **keys** — sanitizers build their output by iterating an explicit allowlist (`SAFE_SLIDE_KEYS` / `SAFE_BLOCK_KEYS`) instead of copying input, so any key not on the list is dropped at ingress rather than passed through
- A reserved internal-use key namespace — any key beginning with `_` is stripped on import unconditionally, so deck JSON can never impersonate renderer-derived state
- String fields stripped of HTML tags and truncated
- Nested structures (grid cells, timeline entries) recursively sanitized, with a bounded recursion depth so a deeply self-nested structure is rejected rather than exhausting the stack or render tree
- Numeric layout fields coerced to type and clamped to a fixed range at ingress; non-numeric or out-of-range values are dropped in favor of the renderer default
- Style objects validated as plain objects (no arrays, no primitives)
- SVG markup sanitized with the full pipeline above

A **CI drift guard** (`tools/vela-dev/scripts/lint.py`, `check_deck_key_drift`) parses the same allowlists out of the source and fails the build when it finds a non-allowlisted key read. Its scope is bounded and stated here honestly rather than as universal coverage: it scans the two primary renderer part-files (`part-blocks.jsx`, `part-slides.jsx`) and matches `slide.`/`block.`/`rawBlock.` dotted reads, string-literal bracket reads (`slide["x"]`), and shallow destructuring. It does not resolve computed (`block[k]`) reads, aliased objects, or reads in the other consumers (PDF/PPTX exporters, engine). Within that scope the allowlist is the single source of truth, kept in sync with the code rather than a document that can silently drift.

### No Sensitive Data

The codebase contains zero:
- API keys or tokens
- Personal email addresses
- Private service URLs
- Authentication credentials
- Internal infrastructure references

### Local Development Server (`serve.py`)

Running `tools/vela-dev/scripts/serve.py <folder>` starts a local HTTP server for live editing. Security measures:

| Control | Detail |
|---------|--------|
| Bind address | `127.0.0.1` by default (localhost only) |
| Path traversal | Deck names validated (`_validate_deck_name`): `/`, `\`, `..`, null bytes and quote/angle/backtick chars rejected — after NFKC-folding so fullwidth/Unicode separator & dot lookalikes and bidi/format controls (RTLO spoofing) can't slip past the check. Symlink escape closed by realpath containment (`_safe_deck_path`) |
| Payload limits | Save requests capped at 5 MB (`413 Payload too large` above the limit) |
| Deck extension | Only `.vela` files are listed, served, or accepted for save |
| Authentication | Per-session token + `HttpOnly`, `SameSite=Strict` session cookie |
| Cross-origin writes | Mutating requests must match the server's full origin (scheme/host/port); saves require `application/json` |
| Host header check | DNS rebinding protection for localhost mode |

When using `--host 0.0.0.0` (LAN mode), the server is accessible to other devices on the network. Use only on trusted networks.

### Desktop Save Integrity (Neutralino)

Deck saves on the desktop shell verify what actually landed on disk instead of trusting the write call to have succeeded:

| Control | Detail |
|---------|--------|
| Read-back verification | Every save reads the file back and compares it against what was written (signature plus exact text) |
| Tri-state outcome | A save reports confirmed / unverifiable / failed rather than collapsing "couldn't verify" into a silent success |
| Watcher echo suppression | The file-change watcher confirms a signature hit against the exact written text before treating an event as its own echo, closing a window where a genuine external edit could be swallowed |
| Bounded watcher reads | Watcher-triggered reads are size-capped and stat-checked before any file content is read, through a single audited read path |

### Supply Chain Security

Node.js dependencies are managed with strict supply chain protections:

| Control | Config | Purpose |
|---------|--------|---------|
| No install scripts | `.npmrc: ignore-scripts=true` | Blocks malicious `postinstall` scripts |
| No native builds | `pnpm-workspace.yaml: onlyBuiltDependencies: []` | Blocks native binary compilation |
| 7-day release cooldown | `pnpm-workspace.yaml: minimumReleaseAge: 10080` | New releases must age before install |
| …in the MCP channel too | `tools/vela-dev/channel/pnpm-workspace.yaml` | That directory installs standalone, so the root floor does not reach it |
| Tiered bump cooldown | `.github/dependabot.yml: cooldown:` | 7d patch / 14d minor / 30d major before a bump is even proposed. Security fixes are exempt |
| Lockfile integrity | `pnpm-lock.yaml` / `package-lock.json` with SHA-512 hashes | Pins exact versions + verifies content |
| Actions pinned by SHA | `.github/workflows/*.yml` | A moved tag cannot change what CI executes; the `# vN` comment is the human-readable label |
| Runtime binaries pinned | `vela-neutralino/checksums/*.sha256` | Per-binary SHA256 for the Neutralino runtime + client, verified after every `neu update` |
| Pinned test requirements | `tests/requirements-test.txt` (exact `==`) | CI installs pip deps without a lockfile, so an open range would admit a same-day upload |

Coverage is enforced by Dependabot across every manifest that feeds a build:
the repo root (npm + Actions), `tools/vela-dev/channel`, `vela-neutralino`,
`tests/` (pip) and the desktop `Dockerfile` (docker).

**Release-artifact packaging** — the shipped skill ZIP is built by `tools/vela-dev/scripts/package-skill.py` (dev toolchain, never shipped; also used by the release workflows). The archive builder skips file and directory symlinks and requires every member's canonical realpath to stay under the skill root, so a link planted in the tree cannot pull outside-of-root bytes into the ZIP under an in-root name. It also excludes `__pycache__` / `*.pyc` / `*.pyo` so no build-time bytecode is shipped. Regression-tested.

**Release bundle hygiene** — `concat.py`'s opt-in release mode strips internal test hooks (window-scoped testing entry points) from the shipped bundle entirely, and a dedicated test suite asserts the stripped bundle carries none of them while the default dev build stays byte-identical to the committed template — a CI guard against either surface silently regressing.

### CLI Tools (`vela.py`, `assemble.py`, etc.)

All Python scripts use standard library only (zero external dependencies). Security properties:

- No `eval()`, `exec()`, `pickle`, `os.system()`, or `shell=True`
- All `subprocess` calls use list-form arguments (injection-safe)
- JSON-only deserialization (`json.load` / `json.loads`)
- No dynamic imports with user input
- No hardcoded secrets or credentials

## Reporting Vulnerabilities

If you discover a security vulnerability in Vela Slides, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email: **info@agentia.pt**
3. Include: description, reproduction steps, and potential impact
4. We will acknowledge receipt within 48 hours

## Security Bounty Program

Vela Slides is a solo-maintained open-source project. We offer **symbolic bounties** as a token of appreciation — not market-rate compensation — to researchers who help make Vela safer. Hall of Fame recognition is the primary reward; cash is supplementary and capped.

### Rewards

| Severity | Bounty | Examples |
|----------|--------|----------|
| **Critical** | $100 + Hall of Fame | Remote code execution, arbitrary file read/write, exfiltration of private information |
| **High** | $35 + Hall of Fame | Stored XSS via deck JSON that bypasses sanitization and is executed |
| **Medium** | $25 + Hall of Fame | Path traversal, symlink escape, JS injection in serve.py |
| **Low** | $10 + Hall of Fame | beacon/non sensitive information leakage, denial of service, header injection |
| **Informational** | Hall of Fame | Best practice violations, defense-in-depth improvements |

**Medium and above require crossing a security boundary.** A finding is eligible for Medium or higher *only if* it grants capability the attacker did not already hold — it must cross a trust boundary, not presuppose access that already grants equal-or-greater capability by a simpler path. If the precondition already yields as much, the finding is defense-in-depth and is capped at **Low or Informational**, regardless of how severe the isolated primitive sounds.

**Total cash payouts are capped at $300 per calendar year.** Once the cap is reached, all subsequent valid findings receive Hall of Fame recognition only for the remainder of the year. Cash eligibility resets January 1.

**2026 remaining: $50 **

This ceiling is non-negotiable. Reports submitted after the cap is hit are still triaged and credited — they simply do not receive cash that year. Final severity and reward are at maintainer discretion.

Bounties are paid via GitHub Sponsors, PayPal, or donation to a charity of the reporter's choice.

### Submission Requirements (mandatory)

Reports missing **any** of the following will be closed without triage:

1. **Working proof-of-concept** — exact reproduction steps, payload, or minimal repro deck. Theoretical issues without a PoC are not eligible.
2. **Demonstrated impact** — what an attacker actually gains (data accessed, code executed, etc.). "Could potentially lead to..." is not impact.
3. **Affected commit SHA or version** — pin the vulnerability to specific code.
4. **Suggested severity with justification** — map your finding to the table above.

Automated-scanner output and AI-generated reports **without manual verification and a working PoC** will be closed without response.

### Rules

- **One issue per report.** Duplicates of known issues are not eligible.
- **First valid report of a given class wins.** Subsequent reports of the same root cause receive Hall of Fame only.
- **Provide a clear reproduction.** Include steps, environment, and expected vs. actual behavior.
- **Allow 48 hours** for acknowledgment and **30 days** for a fix before public disclosure.
- **Do not** test against production Claude.ai artifacts or other users' data.
- **Do not** use automated scanners that generate excessive traffic against the local server.

### Scope

**In scope:**
- Shipped skill scripts under `skills/vela-slides/scripts/` (vela.py, assemble.py, validate.py) and dev toolchain under `tools/vela-dev/scripts/` (serve.py, concat.py, lint.py, agent_backend.py, package-skill.py)
- The Vela JSX application (`src/parts/*.jsx`, built into `skills/vela-slides/app/vela.jsx`)
- Deck JSON parsing, validation, and sanitization
- Local development server endpoints and file handling
- SVG sanitization pipeline

**Out of scope:**
- The experimental MCP bridge in `tools/vela-dev/channel/`. It is a prototype
  against Claude MCP Channels — an Anthropic research preview as of July 2026 —
  and is not part of Vela: nothing in the app, `serve.py`, or CI invokes it, and
  it only runs if a developer registers it by hand and starts Claude Code with
  `--dangerously-load-development-channels`. Vela's actual AI channel is
  `tools/vela-dev/scripts/agent_backend.py`, which **is** in scope.
- Claude.ai's artifact sandbox (managed by Anthropic)
- The Anthropic API and its security model
- Third-party CDN availability or integrity (html2canvas)
- User-generated content within slide decks (this is a presentation tool)
- Social engineering or phishing attacks
- Denial of service via resource exhaustion on localhost

### Hall of Fame

We gratefully acknowledge the following security researchers:

<!-- Add entries as: | [@handle](https://github.com/handle) | Description of finding | YYYY-MM | -->

| Researcher | Contribution | Date |
|------------|-------------|------|
| Mirochill | XSS Vuln., Beacon Vuln., Origin Checks, SymLink| 2026-May, 2026-Jul |

