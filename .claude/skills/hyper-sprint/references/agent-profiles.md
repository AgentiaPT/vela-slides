# Agent profiles

A **profile** captures the stable, reusable facts about an execution environment so a
sprint never has to rediscover them. Detect the profile once at Phase 0, then trust
these values. If a fact below doesn't hold, you're in a different profile — re-probe
and record a new one.

---

## Profile: `copilot-cli-sandbox`

GitHub Copilot CLI sandbox with an isolated kernel, a Windows-mounted repository,
and a fast Linux-local package store. Read `.hyper-sprint/config-copilot-cli-sandbox.md`
for the Vela commands and measured baselines.

### Detection markers

| Marker | Expected |
|---|---|
| `$HOME` | `/home/agent` |
| Repository path | `/d/Agentia/vela-slides` |
| Repository file system | `fuseblk` |
| Home file system | `overlayfs` |
| File `.hyper-sprint/copilot-env.sh` | Present |
| Directory `/home/agent/.local/share/vela-slides/npm/node_modules` | Present |
| `$HTTPS_PROXY` | Set |

Use this probe:

```bash
[ "$HOME" = /home/agent ] \
  && [ -f .hyper-sprint/copilot-env.sh ] \
  && [ -d /home/agent/.local/share/vela-slides/npm/node_modules/playwright ] \
  && [ "$(stat -f -c %T .)" = fuseblk ] \
  && echo copilot-cli-sandbox || echo "profile: unknown"
```

### Package and browser rules

- Source `.hyper-sprint/copilot-env.sh` before a Node or browser command.
- Keep installed packages under `/home/agent`. Do not put a `node_modules`
  directory on `/d`.
- The mounted drive does not support the required symbolic link. `NODE_PATH`
  gives Node access to the local package store.
- The burst driver uses CommonJS package resolution from ESM. This permits it to
  use `NODE_PATH`.
- `CHROME_PATH` selects the browser in
  `/home/agent/.local/share/vela-slides/browsers`.
- `VRUN_WAIT=30` is required: Vela permits a 20-second burst job plus a
  5-second recovery budget (25 seconds combined server-side); the client
  wait must stay above that combined budget, not equal to it.
- Do not run `playwright install`.
- Use one warm browser for a hunt. Do not start one browser for each test.
- Do not run `concat.py` before `burst-boot.sh`. The boot script runs it.

### Measured baseline

- Node: 22.22.2
- npm: 10.9.7
- Playwright: 1.61.1
- Playwright CLI: 0.1.15
- Chromium: 141
- FFmpeg: 8.0.1
- Poppler: 26.01.0
- Python suite: 504 passed
- UI battery: 238 passed, 9 skipped, 0 failed

### Known browser facts

- Use the offline render. External CDNs are not required.
- Use `.hyper-sprint/burst-boot.sh` for Hyper Sprint validation.
- Use `.hyper-sprint/burst-hunter.json` and `vela-verbs.mjs`.
- Use `.hyper-sprint/readiness-burst.mjs` for the readiness gate.
- The app reset is in memory. A reset usually takes 250 to 450 ms.
- `stats.json` records browser boot time and each warm reset time.
- In fullscreen presenter mode, real Playwright keyboard input and screenshots
  can stop. Use `presentKey`, `navKey`, `exitPresent`, and `swipe`. Exit
  presenter mode before a screenshot.
- Run browser work as multi-step bursts. One burst gives one structured result.
- Use one readiness burst in normal work. Use small bursts only for diagnosis.
- **Emoji font is a recording prerequisite.** This minimal image can have only
  DejaVu fonts. Chromium then renders emoji used by trusted app chrome as empty
  square glyphs. This is not a firewall or Lucide failure: Lucide is vendored,
  and emoji fallback comes from system Fontconfig, not Google Fonts.
- Before screenshots or video, require
  `fc-match "Noto Color Emoji" | grep -q "Noto Color Emoji"`. If it is missing
  and the system package manager is not writable, install the official Ubuntu
  package into the user font directory:

  ```bash
  mkdir -p "$VELA_DEV_WORK_ROOT/font-package" "$HOME/.local/share/fonts"
  cd "$VELA_DEV_WORK_ROOT/font-package"
  apt-get download -qq fonts-noto-color-emoji
  dpkg-deb -x fonts-noto-color-emoji_*.deb extracted
  cp extracted/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf \
    "$HOME/.local/share/fonts/"
  fc-cache -f
  fc-match "Noto Color Emoji"
  ```

  Restart Chromium after the font cache changes. Run one toolbar screenshot
  smoke test before a complete recording. Keep the package and font outside
  the repository. Do not replace app icons to compensate for a missing runner
  font.

### Sandbox security boundary

Root access is root access inside the isolated kernel. It is not proof of user
host access. The sandbox also has a Docker socket. Do not use Docker for Vela
tests. Keep GitHub write operations out of development and validation tasks.

---

## Profile: `claude-code-cloud-default`

Claude Code's default cloud/remote-execution environment (fresh container per session,
outbound HTTPS via a proxy). Verify with the probes at the bottom; update if versions
drift.

### Detection markers (identify the profile fast)
Check these **stable** signals first — if they hold, you're in this profile and can
trust the facts below without re-probing everything. Match on the *markers*, not exact
version numbers (those drift).

| Marker | Expected | Meaning |
|--------|----------|---------|
| `$PLAYWRIGHT_BROWSERS_PATH` | `/opt/pw-browsers` | pre-installed browser bundle |
| dir `/opt/pw-browsers/chromium-*` + `ffmpeg-*` | present | pinned Chromium + recorder ffmpeg |
| `$HTTPS_PROXY` / `$HTTP_PROXY` | set (agent proxy) | outbound is proxied |
| file `/root/.ccr/ca-bundle.crt` + `/root/.ccr/README.md` | present | agent-proxy CA + tool docs |
| git user email | `noreply@anthropic.com`, unsigned | commits show "Unverified" |
| CWD | fresh clone under a per-session path | ephemeral container |

One-liner (prints `claude-code-cloud-default` when it matches):
```bash
[ "$PLAYWRIGHT_BROWSERS_PATH" = /opt/pw-browsers ] && [ -d /opt/pw-browsers ] \
  && [ -n "$HTTPS_PROXY" ] && [ -f /root/.ccr/ca-bundle.crt ] \
  && echo claude-code-cloud-default || echo "profile: unknown — re-probe"
```
If markers partially match (e.g. `/opt/pw-browsers` but no proxy), you're in a *variant*
— reuse the browser facts, re-probe the network/git facts, and note the divergence.

### Network
- Outbound HTTPS works **through the agent proxy** (`$HTTPS_PROXY`), but public
  **JS/CSS CDNs are blocked** (esm.sh, unpkg, the Playwright browser CDN, most font
  CDNs). `ERR_INVALID_URL` / `ERR_CONNECTION_CLOSED` on font/CDN fetches are harmless.
- **Consequence:** anything you open in a browser must be **self-contained** — no CDN
  `<script>`/`<link>`, no import maps to esm.sh, fonts inlined or system-stack only. The
  offline render the blind verifiers drive (repo's own boot recipe → external app script)
  and the optional demo deck in `assets/demo/` are both built this way.

### Browser (Playwright, pre-installed)
- `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; do **not** run `playwright install`.
- Chromium: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (pin via
  `executablePath`; it's newer than the npm `playwright` package expects).
- Launch headless with `--no-sandbox`. Node 22, local `playwright` ~1.60.
- Record video via `browser.newContext({ recordVideo: { dir } })` → **VP8 `.webm`**
  (plays in Chromium and modern browsers; fine to embed in the HTML deck).
- **Read what the user sees, not `document.body.innerText`.** A fullscreen/overlay/modal
  occludes the DOM behind it but doesn't remove it — `innerText` returns the hidden layer
  and gives false readings. Read the top fixed/highest-z element (the overlay) instead.
- **In-app test batteries can hang headless** on fullscreen/animation steps — run them
  **per-suite / sharded**, not as one call, and don't block the sprint on a hang.

### Booting a self-contained SPA when CDNs are blocked (generic recipe)
Any CDN-dependent SPA needs the same offline transform — this is *not* app-specific, and
re-deriving it live is the most common readiness time-sink:
- **Vendor the libs as UMD** (React/ReactDOM + icons + a transpiler) — but their globals
  are **mixed-case**: React registers `window.React` while some UMDs (e.g. lucide) read
  `window.react` → **alias both** (`window.react = window.React`) or icons come back
  `undefined` and the app crashes deep in render (React #130), often surfacing only when
  you later drive a *different* screen — a false-alarm detour.
- **Load the app as an EXTERNAL script over a local http server**, never inline
  `<script type=text/babel>`: a `</script>` inside a string literal (XSS-test data, etc.)
  truncates an inline block; and `file://` blocks `fetch`/XHR — a local server fixes both.
- **Strip ESM `import` AND `export`** from the bundle and re-provide what they supplied as
  globals (destructured hooks, the icon namespace).
- **Fullscreen API is inert headless** — trigger the app's own "present/fullscreen"
  control instead of `requestFullscreen()`.
Persist the working builder+driver as a one-command entrypoint so workers/validators reuse
it verbatim (don't each rebuild it).

### Media / ffmpeg
- Bundled ffmpeg at `/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux` is **stripped** — it is
  the Playwright recorder, not a general tool. It has a PNG encoder but **no `lavfi`
  filters / limited demuxers**, so blind `ffmpeg -vf fps=1` frame extraction is
  unreliable. Do **not** depend on it for transcode/concat/frame-grab.
- **Frame-check the right way:** take `page.screenshot()` at each beat *while driving*
  the app. Those PNGs are your frame samples (exact, labelled, no ffmpeg). Segment the
  demo into separate per-feature clips (one context each) instead of concatenating.
- **Recorded webm has no duration header** — Playwright's VP8 output isn't seekable and
  `video.currentTime` reads 0, so you can't verify it by re-opening/seeking. Verify with
  the during-drive screenshots, not post-hoc playback.
- **Embedded clips need autoplay** — launch Chromium with
  `--autoplay-policy=no-user-gesture-required` or muted `<video>` clips won't play while
  recording, and the demo captures black boxes.

### Reading a spec PDF *with its screenshots*
Change-request specs often arrive as a PDF where the important detail is in **embedded
screenshots**, not the text. Reading the PDF directly gives you the prose but not
reliable image fidelity (and needs page-chunking over ~10pp). Instead extract both, then
*look* at the pages — `poppler-utils` is preinstalled (`apt-get install -y poppler-utils`
if a variant lacks it):
```bash
pdfinfo spec.pdf                                   # page count
pdftotext -layout spec.pdf spec.txt                # accurate text (layout preserved)
pdftoppm -png -r 100 spec.pdf out/page             # one PNG per page — the screenshots
```
Then `Read` each `out/page-*.png` so the actual UI screenshots are in context, and pair
them with `spec.txt` to build the change list. Bump `-r` (DPI) if a screenshot is too
small to read. (`pdfplumber` may be broken in this image via a `cffi`/`_cffi_backend`
error — use `poppler-utils` directly, don't debug the Python lib.)

### Git / signing
- Commits are authored `Claude <noreply@anthropic.com>` but **cannot be GPG/SSH-signed**
  (`ssh-keygen` absent, signing key empty) → GitHub shows "Unverified". Known, expected;
  don't burn turns trying to sign.
- Public repos may forbid session URLs / secrets in commit messages (a policy hook can
  block the push). Keep messages to technical content only; never bundle
  `add`+`commit`+`push` in one shell command (a block on one step silently skips the
  add).
- **Commit-trailer conflict (expected):** the harness may instruct a `Claude-Session: <url>`
  trailer, but a public repo's `CLAUDE.md` often forbids session URLs and the auto-mode
  classifier will **hard-block the first commit**. Check `CLAUDE.md` and **omit the trailer**
  there (keep `Co-Authored-By` only). Also expect the git stop-hook to nag about uncommitted
  changes / unverified signatures every idle turn — that's known noise; commit at cluster
  boundaries, don't chase it.

### Probes (re-run to confirm the profile)
```bash
ls /opt/pw-browsers/                              # chromium-<v>, ffmpeg-<v>
echo "$PLAYWRIGHT_BROWSERS_PATH"                  # /opt/pw-browsers
node -e "console.log(require('playwright/package.json').version)"
curl -sS "$HTTPS_PROXY/__agentproxy/status"       # proxy / network policy
```
