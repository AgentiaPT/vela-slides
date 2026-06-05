# Security

## Security Model

Vela Slides runs entirely inside Claude.ai's sandboxed artifact environment. There are no backend servers, no databases, no authentication flows. All data stays in the conversation and the artifact's local storage.

### Threat Surface

| Vector | Mitigation |
|---|---|
| Malicious JSON import | Block-type whitelisting, string sanitization, structure validation |
| SVG injection (XSS) | Multi-layer sanitization: script, foreignObject, use, animate, event handler, javascript: URI, xlink:href, CSS expression stripping |
| Oversized payloads | String length limits on all fields (200-50000 chars), block count limits (30/slide), row/column limits |
| CDN compromise (html2canvas) | Loaded from cdnjs.cloudflare.com with integrity checks — standard risk for client-side apps |
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
- String fields stripped of HTML tags and truncated
- Nested structures (grid cells, timeline entries) recursively sanitized
- Style objects validated as plain objects (no arrays, no primitives)
- SVG markup sanitized with the full pipeline above

### No Sensitive Data

The codebase contains zero:
- API keys or tokens
- Personal email addresses
- Private service URLs
- Authentication credentials
- Internal infrastructure references

### Local Development Server (`serve.py`)

The `vela server start` command starts a local HTTP server for live editing. Security measures:

| Control | Detail |
|---------|--------|
| Bind address | `127.0.0.1` by default (localhost only) |
| Path traversal | Deck names validated: `/`, `\`, `..` rejected. Symlink escape checks via `os.path.realpath()` |
| Payload limits | 5 MB for saves, 10 MB for uploads |
| Upload sanitization | `os.path.basename()` strips directory components, dot-files rejected |
| Authentication | Per-session token + `HttpOnly`, `SameSite=Strict` session cookie |
| Cross-origin writes | Mutating requests must match the server's full origin (scheme/host/port); saves require `application/json` |
| Host header check | DNS rebinding protection for localhost mode |

When using `--host 0.0.0.0` (LAN mode), the server is accessible to other devices on the network. Use only on trusted networks.

### Supply Chain Security

Node.js dependencies are managed with strict supply chain protections:

| Control | Config | Purpose |
|---------|--------|---------|
| No install scripts | `.npmrc: ignore-scripts=true` | Blocks malicious `postinstall` scripts |
| No native builds | `pnpm-workspace.yaml: onlyBuiltDependencies: []` | Blocks native binary compilation |
| 7-day release cooldown | `pnpm-workspace.yaml: minimumReleaseAge: 10080` | New releases must age before install |
| Lockfile integrity | `pnpm-lock.yaml` with SHA-512 hashes | Pins exact versions + verifies content |

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
| **Critical** | $100 + Hall of Fame | Remote code execution, arbitrary file read/write via serve.py |
| **High** | $35 + Hall of Fame | Stored XSS via deck JSON that bypasses sanitization and is executed |
| **Medium** | $25 + Hall of Fame | Path traversal, symlink escape, JS injection in serve.py |
| **Low** | $10 + Hall of Fame | Information leakage, denial of service, header injection |
| **Informational** | Hall of Fame | Best practice violations, defense-in-depth improvements |

**Total cash payouts are capped at $300 per calendar year.** Once the cap is reached, all subsequent valid findings receive Hall of Fame recognition only for the remainder of the year. Cash eligibility resets January 1.

**2026 remaining: $180 **

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
- Python scripts under `skills/vela-slides/scripts/` (vela.py, serve.py, assemble.py, validate.py, concat.py, lint.py)
- The Vela JSX application (`app/parts/*.jsx`, `app/vela.jsx`)
- Deck JSON parsing, validation, and sanitization
- Local development server endpoints and file handling
- SVG sanitization pipeline

**Out of scope:**
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
| Mirochill | XSS Vuln.| 2026-May |
| Mirochill | Beacon Vuln.| 2026-May |
| Mirochill | Origin Checks| 2026-May |

