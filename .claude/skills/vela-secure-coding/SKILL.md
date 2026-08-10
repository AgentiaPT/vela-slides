---
name: vela-secure-coding
description: Vela's secure-coding rules — READ BEFORE writing or changing ANY code in this repo (src/parts/*.jsx, skills/vela-slides/scripts/*.py, tools/vela-dev/**, vela-neutralino/**, tests, CI). Encodes the repo's threat model, the canonical sanitizer/encoder helpers you must reuse instead of re-implementing, the recurring vulnerability classes this codebase has actually shipped and fixed, and the proof/CI/version-bump gates a change must pass. Use it for feature work, bug fixes, refactors, and exports — not only for work labelled "security".
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(python3 tests/test_vela.py*), Bash(python3 tools/vela-dev/scripts/*), Bash(node tests/*), Bash(node tools/vela-dev/scripts/*), Bash(git *)
---

# Vela secure coding

Vela renders **untrusted deck JSON** in runtimes that have real filesystem and
network capability. Almost every security bug in this repo's history came from
ordinary feature code — an export path, a new block renderer, a colour field —
not from "security work". So these rules apply to **every** change.

## 0. The five non-negotiables

1. **Untrusted in = deck JSON, always.** A deck arrives from a file, clipboard,
   startup patch, storage reload, or a Vera/AI tool result. All four paths are
   equally hostile. Never trust a value because it "came from our own state".
2. **Allowlist, never denylist**, for anything structural (keys, block types,
   tags, schemes, CSS properties). A denylist is only ever an *extra* layer on
   top of an allowlist, never the gate.
3. **Fail closed.** When a guard rejects, *drop* the value/subtree. Never
   `continue`, never `return` the unvisited thing, never pass it through.
4. **One canonical helper per context — reuse it, never re-implement.** Every
   drift bug in this repo came from a second copy of a filter or escaper.
5. **A defense is proven only when a payload runs through the real code and the
   real sink** (browser, exported file, live server). Source review is not proof.

## 1. Threat model in six lines

The same sanitizers run in three runtimes; the blast radius of a bypass differs.
Priority order — **desktop and `serve.py` first**, because they execute on the
user's host:

| Runtime | Worst case on sanitizer bypass | Backstop |
|---|---|---|
| Neutralino desktop | file read/overwrite in the 2 allowed roots **+** outbound exfil (no host RCE — `os.spawnProcess` is not granted) | `<meta>` CSP, enumerated `nativeAllowList`, `fs-guard`, deck-open warning |
| Local `serve.py` | zero-click outbound exfil of deck/host data | HTTP CSP, origin/CSRF/Host checks, token auth, realpath containment |
| Claude.ai artifact | contained DOM XSS | Anthropic sandbox CSP |

**The invariant to protect, everywhere:** *no deck-supplied value may reach a
sink that auto-fetches an external resource on render, executes script, or
reaches the native bridge.* Every image-loading CSS/SVG/HTML construct is
regulated surface. The host CSPs are defense-in-depth — **the sanitizers are the
primary control.**

Full detail: `docs/SECURITY.md`, `vela-neutralino/SECURITY.md`.

## 2. Canonical helpers — reuse these, do not write new ones

All in `src/parts/part-imports.jsx` unless noted.

| Context you are writing into | Use | Never |
|---|---|---|
| Any deck string reaching the DOM/state | `sanitizeString(v, maxLen)` | your own tag strip / `.replace(/<[^>]*>/g,"")` once |
| Deck title | `sanitizeDeckTitle` | raw assignment |
| Any link/URL | `sanitizeUrl(url)` — then re-validate **at the sink** | returning the raw input after validating a parsed view |
| `window.open` on a deck link | `openExternalLink` | `window.open(url)` |
| Colour scalar → CSS | `cssColor(v)` (fail-closed allowlist) | interpolating `slide.bg`/`block.accent` raw |
| Gradient → CSS | `cssGradient(v)` | weakening `cssColor` |
| Value inside `url(...)` | `cssUrl(v)` | string concatenation |
| `block.style` object | `sanitizeStyle` (keys: `SAFE_STYLE_KEYS`, values: `STYLE_VALUE_REJECT`) | a second value regex |
| Nested/spread sub-objects | `scrubSubObject` (+ `scrubColorFields` / `scrubPaintFields` / `scrubLayoutFields`) | raw spread |
| SVG markup | `sanitizeSvgMarkup` (tags: `SVG_ALLOWED_TAGS`; CSS: `isSvgStyleSafe`) | a tag denylist |
| Image data URI | `sanitizeImageDataUri` (`SAFE_RASTER_DATA_IMAGE`, SVG re-encoded) | passing `data:` through |
| New slide/block field | add it to `SAFE_SLIDE_KEYS` / `SAFE_BLOCK_KEYS` (+ `validate.py`, `block-schema.md`, compact/turbo maps) | reading a key that isn't allowlisted (CI lint fails) |
| Numeric layout field | `clampDeckNumber` + `SLIDE_NUMERIC_BOUNDS` | trusting the number |
| PDF literal string / URI | `pdfStringEncode` (`part-pdf.jsx`) | an inline escape |
| PPTX / OOXML text | `pptxEsc` (`part-pptx.jsx`) | manual `&`/`<` replaces |
| Markdown export text | `mdInline` / `mdCell` / `escGap` (`part-pdf.jsx`) | writing a deck field into `.md` raw |
| Deck JSON inlined into `<script>` | `escapeForScriptContext` — JS: `vela-neutralino/resources/js/script-escape.js`; Python: `escape_for_script_context` in `skills/vela-slides/scripts/assemble.py` (byte-parity test in `tests/test_vela.py`) | a per-site escape |
| Marker substitution in a template | `String.replace(marker, () => value)` (replacer **function**) | a string replacement (`$&`/`$1` splicing) |
| Local HTTP auth compare | `hmac.compare_digest` | `==` |
| Desktop filesystem path | go through `fs-guard` (`vela-neutralino/resources/js/fs-guard.js`) | a direct `Neutralino.filesystem.*` call |

If you genuinely need a new encoder: put it next to its siblings, give it the
type-check-first shape below, and add a test that the sinks all route through it.

## 3. The recurring failure modes (each one shipped here at least once)

Check your diff against every line. `references/history.md` maps each to the real
commit if you want the full story.

1. **Validate-then-return-raw.** If you parse a value to check it, emit *the
   parsed/canonical form* — never hand back the raw bytes a later sink re-parses.
2. **Fail-open on type.** A non-string on a CSS/colour key must be **deleted**,
   not skipped. `String(v)` before an allowlist test is a bypass: `["red"]` and a
   `{toString}` gadget both satisfy a colour regex. **Type-check first, coerce never.**
3. **Depth/breadth guard that returns instead of dropping.** At the cap, delete
   the subtree (`obj.length = 0` / `delete obj[k]`). A guard that `return`s hands
   the attacker an opt-out: nest one level deeper and the scrubbers never ran.
4. **Incomplete mediation.** Gating one sink is not gating the class. When you
   fix a sink, grep for its siblings and gate all of them — *and* strip at the
   source too, so no field depends on a single encoder.
5. **Two copies that drift.** One filter/escaper per context, shared by every
   caller (`STYLE_VALUE_REJECT`, `pdfStringEncode`, `escapeForScriptContext`).
   If you find a second copy, unify it in the same change.
6. **Incomplete escaping.** Escape the whole grammar of the target format, not
   the one form you thought of — and **escape the escape character first**, or an
   attacker's `\<` revives a live `<`. Markdown alone needed: inline links,
   reference-style links/definitions, raw HTML, autolinks, table pipes, backslash.
   Do it in **one pass** over one character class; a second `.replace` double-escapes.
7. **Regex that needs a well-formed match.** Reject on **token presence**, not on
   a complete match: a malformed `url(` with no closing paren still fetches.
   Same for comments (`/*`) as token separators.
8. **TOCTOU.** Don't validate a path then re-open it by path. Open once with
   `O_NOFOLLOW`, then `fstat`/read from that same descriptor.
9. **Origin/Host as an access boundary.** They are a coarse pre-filter — an
   opaque `Origin: null` is forgeable. The **unforgeable token** is the gate
   (constant-time compare). Emit a constant `Access-Control-Allow-Origin`, never
   the request's own Origin (header-splitting).
10. **Wildcard capability grants.** Enumerate every native method / tool / scope
    actually used. A namespace wildcard admits future methods nobody audited.
11. **Secrets to a long-lived sink.** Minted tokens go to stderr, never to a log
    file; never echo an operator-supplied secret.
12. **Test/debug surface shipped.** Any test hook, panel, listener, or global
    sits behind the single `velaTestSurfaceEnabled()` gate inside a
    `VELA:DEV-ONLY` fence, and `concat.py --release` must strip it.
13. **Namespace forgery.** Deck input can never carry a `_`-prefixed key —
    renderer-private flags are set by our code *after* sanitization.
14. **`.map(fn)` passing the index.** `arr.map(sanitizeBlock)` feeds the array
    index as the depth argument. Always `arr.map((b) => sanitizeBlock(b))`.

## 4. Per-surface checklist

**New/changed block renderer (`part-blocks.jsx`, `part-slides.jsx`)**
- Every deck field you read is in `SAFE_BLOCK_KEYS` / `SAFE_SLIDE_KEYS` (the
  key-drift lint enforces this) and is sanitized at ingress.
- Every colour/paint value reaching `background`, `backgroundImage`, `mask`,
  `filter`, `border*`, `fill`, `stroke` goes through `cssColor`/`cssGradient`/
  `cssUrl` (the `check_css_fetch_sink_gate` lint enforces this).
- No `dangerouslySetInnerHTML` except the sanitized-SVG path. No new CSS custom
  property (`--*`) — the one exception, `--vera-accent`, is encoder-gated *and*
  `@property`-typed to `<color>`; hold any new one to the same bar.
- No new external fetch (image, font, stylesheet). Deck images are `data:` only.

**Ingress / sanitizers (`part-imports.jsx`)**
- New field → allowlist entry + type + length/range clamp + the right sanitizer.
- New nested shape → reached by `scrubSubObject`, breadth-sliced, depth-capped.
- Re-sanitize on the **storage-reload** path too, not only on import
  (`resanitizeLoadedLanes` / `resanitizeLoadedBranding`).

**Exporters (PDF, PPTX, Markdown, Standalone HTML)**
- Each output format is its own injection context. Route **every** deck value
  through that format's canonical encoder, including labels, table cells, alt
  text, notes, titles, and link destinations — and re-validate URLs at the sink.

**Python (`serve.py`, `assemble.py`, `vela.py`, `agent_backend.py`, `package-skill.py`)**
- stdlib only; no `eval`/`exec`/`pickle`/`os.system`/`shell=True`; `subprocess`
  in list form; JSON-only deserialization.
- Filesystem: NFKC-fold + reject separators/traversal/quotes, then **realpath
  containment**, then open with `O_NOFOLLOW` and use the fd. Skip symlinks in
  archive builders and require member realpaths to stay in-root.
- HTTP: loopback bind, mandatory token (`compare_digest`), Origin **and** Host
  checks, payload cap, extension allowlist, `HttpOnly`/`SameSite=Strict` cookies.
- Anything spawning the user's `claude` keeps the `CLAUDE_LOCKDOWN` flags
  (`--tools "" --strict-mcp-config --setting-sources ""`) — a parity test in
  `tests/test_serve.py` locks this against the Go gatekeeper.

**Desktop shell (`vela-neutralino/`)**
- Adding a `Neutralino.*` call means adding **that exact method** to
  `nativeAllowList` — never a namespace wildcard, never `os.spawnProcess`,
  `extensions.dispatch`, or `extensions.broadcast`.
- New filesystem access goes through `fs-guard`; new roots must reject volume
  roots, shallow single-segment roots, and OS-critical system directories.
- Don't loosen the `<meta>` CSP. `img-src`/`font-src` must not regain `https:`.

**Build / CI**
- Never edit `skills/vela-slides/app/vela.jsx` by hand — regenerate with
  `concat.py`. Release paths (`_build-desktop.yml`, `build.sh`, Dockerfile) must
  keep `--release`.

## 5. Prove it, then gate it

Every security-relevant change ships with a **regression test that fails without
the fix**. Behavioral tests over source-text assertions.

```bash
python3 tests/test_vela.py                      # full suite (unit+integration)
python3 tools/vela-dev/scripts/concat.py        # monolith must be in sync
python3 tools/vela-dev/scripts/lint.py --parts src/parts   # key-drift + CSS sink gate
node tests/test_release_build.cjs               # test surface stripped on release
tools/vela-dev/scripts/ci-local.sh              # all 8 CI stacks
```

Relevant existing suites to extend rather than duplicate: `test_css_exfil.cjs`,
`test_svg_mxss.cjs`, `test_deck_key_allowlist.cjs`, `test_markdown_export.cjs`,
`test_fs_guard.cjs`, `test_data_image_uri.cjs`, `test_pdf_export.cjs`,
`test_pptx_export.cjs`, `test_standalone_html.cjs`, `test_serve.py`,
`test_desktop.py`, `test_release_build.cjs`.

**Browser/real-sink proof** is required for any claim about rendering, CSS, SVG,
or exfil — use the `vela-browser-test` skill (real sanitizers + real Chromium) or
`playwright-cli-setup` for interactive checks. "The regex looks right" is not a
result.

## 6. Ship discipline

- **Version bump**: any change under `skills/vela-slides/` or `src/parts/` needs
  `VELA_VERSION` + `VELA_CHANGELOG` in `part-imports.jsx` and a matching
  `SKILL.md` version. CI blocks otherwise.
- **Disclosure discipline** (CLAUDE.md, permanent): changelog, commit messages,
  PR titles/bodies, and review comments state only the *class* of issue, the
  affected area, what the fix does, and that tests were added. **No payloads, no
  bypass tokens, no reproduction steps, no "where the gap was" maps.** Precise
  mechanics belong in in-code comments (maintainer-facing) or a private thread.
- **Public repo**: no session URLs, keys, tokens, or personal data in anything
  committed.
- Comment the *why* next to every guard — the invariant it protects and what
  breaks if it's removed. That's how this codebase keeps the rules from eroding.
