# Agent profiles

A **profile** captures the stable, reusable facts about an execution environment so a
sprint never has to rediscover them. Detect the profile once at Phase 0, then trust
these values. If a fact below doesn't hold, you're in a different profile — re-probe
and record a new one.

---

## Profile: `claude-code-cloud-default`

Claude Code's default cloud/remote-execution environment (fresh container per session,
outbound HTTPS via a proxy). Verify with the probes at the bottom; update if versions
drift.

### Network
- Outbound HTTPS works **through the agent proxy** (`$HTTPS_PROXY`), but public
  **JS/CSS CDNs are blocked** (esm.sh, unpkg, the Playwright browser CDN, most font
  CDNs). `ERR_INVALID_URL` / `ERR_CONNECTION_CLOSED` on font/CDN fetches are harmless.
- **Consequence:** anything you open in a browser must be **self-contained** — no CDN
  `<script>`/`<link>`, no import maps to esm.sh, fonts inlined or system-stack only.
  The demo deck in `assets/demo/` is already built this way.

### Browser (Playwright, pre-installed)
- `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; do **not** run `playwright install`.
- Chromium: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (pin via
  `executablePath`; it's newer than the npm `playwright` package expects).
- Launch headless with `--no-sandbox`. Node 22, local `playwright` ~1.60.
- Record video via `browser.newContext({ recordVideo: { dir } })` → **VP8 `.webm`**
  (plays in Chromium and modern browsers; fine to embed in the HTML deck).

### Media / ffmpeg
- Bundled ffmpeg at `/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux` is **stripped** — it is
  the Playwright recorder, not a general tool. It has a PNG encoder but **no `lavfi`
  filters / limited demuxers**, so blind `ffmpeg -vf fps=1` frame extraction is
  unreliable. Do **not** depend on it for transcode/concat/frame-grab.
- **Frame-check the right way:** take `page.screenshot()` at each beat *while driving*
  the app. Those PNGs are your frame samples (exact, labelled, no ffmpeg). Segment the
  demo into separate per-feature clips (one context each) instead of concatenating.

### Git / signing
- Commits are authored `Claude <noreply@anthropic.com>` but **cannot be GPG/SSH-signed**
  (`ssh-keygen` absent, signing key empty) → GitHub shows "Unverified". Known, expected;
  don't burn turns trying to sign.
- Public repos may forbid session URLs / secrets in commit messages (a policy hook can
  block the push). Keep messages to technical content only; never bundle
  `add`+`commit`+`push` in one shell command (a block on one step silently skips the
  add).

### Probes (re-run to confirm the profile)
```bash
ls /opt/pw-browsers/                              # chromium-<v>, ffmpeg-<v>
echo "$PLAYWRIGHT_BROWSERS_PATH"                  # /opt/pw-browsers
node -e "console.log(require('playwright/package.json').version)"
curl -sS "$HTTPS_PROXY/__agentproxy/status"       # proxy / network policy
```
