# Hyper-Sprint — Claude Cloud profile config

Read this in **Phase 0** when running the `hyper-sprint` skill on the **Claude Code
cloud / remote-execution** environment (profile `claude-code-cloud-default`). It records
the stable environment facts *and the readiness shortcuts* so a sprint never re-pays the
bring-up cost. Pair it with the repo config (`.hyper-sprint/config.md`).

## TL;DR — the env is pre-provisioned; keep readiness under ~25s

The container **setup script has already provisioned everything** before the session
starts: `node_modules/` (incl. the declared `jsdom` devDep + `playwright`), the built
`skills/vela-slides/app/vela.jsx`, and the pinned Chromium. **Do NOT re-provision.** The
readiness gate is a *thin verification*, not a rebuild.

A past readiness run took **~17 minutes**; ~15 of those were pure waste. Don't repeat it.

## Detect the profile (stable markers)
```bash
[ "$PLAYWRIGHT_BROWSERS_PATH" = /opt/pw-browsers ] && [ -d /opt/pw-browsers ] \
  && [ -n "$HTTPS_PROXY" ] && [ -f /root/.ccr/ca-bundle.crt ] \
  && echo claude-code-cloud-default || echo "profile: unknown — re-probe"
```

## Fast readiness gate (do this INLINE in the orchestrator — no sub-agent needed)

When a setup script has pre-provisioned the container, the orchestrator itself runs the
gate in a few seconds; spinning up a readiness *sub-agent* that re-discovers the recipe
adds bring-up overhead for no gain.

```bash
# 1. verify provisioning (~1s) — do NOT npm-install or rebuild if these hold
[ -e node_modules/jsdom ] && [ -e skills/vela-slides/app/vela.jsx ] \
  && ls /opt/pw-browsers/chromium-*/chrome-linux/chrome >/dev/null && echo "provisioned ✓"

# 2. build sync + suite (the real gate)
python3 skills/vela-slides/scripts/concat.py     # ~0.2s — must print "in sync"
python3 tests/test_vela.py                        # ~17s — BASELINE: 353 passed / 0 failed

# 3. ONE browser smoke (~8s) — single launch drives editor→present→gallery
python3 skills/vela-slides/scripts/concat.py
node hyper-sprint.render-offline.js examples/vela-demo.vela /tmp/vout
node <SCRATCH>/drive.mjs file:///tmp/vout/render.html <shotDir>
```
`<SCRATCH>` = the session scratch dir holding `drive.mjs` (a validated one-launch
Playwright driver: Chromium `/opt/pw-browsers/chromium-*/chrome-linux/chrome`, launch
`--no-sandbox --autoplay-policy=no-user-gesture-required`, waits `window.__velaBooted`).

Total ≈ **25s** (or **<10s** if you trust concat-sync and defer the full Python suite to
integration). Baseline = **353 pass / 0 fail** (jsdom installed) — anything lower is a
regression you introduced.

## Driving AI-dependent tests (deck-from-source, Vera, "AI available" battery)

The `claude` CLI is present (`/opt/node22/bin/claude`), so the app's real AI paths work
here **against the local `claude` CLI** via a loopback channel. Verified live: channel up
(`claude 2.1.199`), `callClaudeAPI` round-trips. **When a test needs AI, boot with the
channel wired — do NOT rely on the default no-AI offline render** (there `velaAIAvailable()`
is false and AI features are correctly skipped/disabled).

Two ways, both reuse `agent_backend.py` (the ONE sandboxed place that spawns `claude
-p`, locked to `--tools "" --strict-mcp-config --setting-sources ""`) + the repo's
`skills/vela-slides/scripts/render-offline.js --channel-port` (NOT the root
`hyper-sprint.render-offline.js`, which has no channel support):

- **Committed probes (repeatable/CI-style):** `node skills/vela-slides/scripts/vela-drive.js
  ai <deck.vela> [--only ping,veraAddSlide,generateSlide,veraChatUI] [--json out.json]`.
  Add a new probe to `AI_PROBES` in `vela-drive.js` for each new AI feature (e.g.
  `deckFromSource`) so it stays verifiable.
- **Ad-hoc AI UI flows (validators/workers):** `node <SCRATCH>/drive-ai.mjs <deck.vela>
  <scenario.mjs> [shotDir]` — boots the channel + `--channel-port` render + a live
  Chromium page, then runs `scenario.mjs`'s `export default async (page, shot, helpers)`
  against the LIVE app. `helpers.velaAIAvailable()` is true inside it.

Each AI run spawns `claude` (real, the user's spend) — opt-in, only when a test needs it.
Engine globals exposed in the classic-script build: `callClaudeAPI`, `callVera`,
`generateSlide`, `velaAIAvailable`.

## The three time-sinks that cost ~15 min — never repeat

1. **Full `window.__velaRunUITests()` HANGS headless** on the fullscreen/animation
   suites. The past run blocked on it repeatedly with `timeout 60/110/170` + `sleep 170`
   (~7 min lost). **In readiness: skip the battery entirely.** For real coverage, run it
   **per-suite / sharded** with a hard per-suite timeout and move on regardless of a hang
   — defer full-battery coverage to the blind gate.
2. **Re-deriving the Playwright driver** (import path, `executablePath`) from scratch —
   ~8 failed retries (~2 min). **Reuse the committed `drive.mjs` verbatim**; don't
   re-author inline `node -e` scripts.
3. **One fresh browser launch per surface** — each cold Chromium boot is ~30s; the past
   run relaunched ~10× (~4 min). **One `page` drives editor→present→gallery→export in a
   single launch.**

## Other stable env facts (from `references/agent-profiles.md`)
- **CDNs blocked** (esm.sh/unpkg/Playwright browser CDN/most fonts). Anything opened in a
  browser must be self-contained → use `hyper-sprint.render-offline.js` (vendored UMD,
  external transpiled `app.js`, `import`/`export` stripped, `lucideReact` global). Never
  inline the monolith as `text/babel` (its XSS-test strings contain `</script>`).
- Harmless console noise: `ERR_INVALID_URL` / `ERR_CONNECTION_CLOSED` / font fetches.
- **Occluded DOM:** present/gallery/modal overlays sit *on top of* the editor DOM — read
  the top fixed/high-z element, not `document.body.innerText`, or you read the hidden layer.
- ffmpeg at `/opt/pw-browsers/ffmpeg-*` is the stripped Playwright recorder (no `lavfi`);
  don't use it for frame extraction — **frame-check via `page.screenshot()` while driving**.
- Playwright VP8 `.webm` has no duration header (not seekable) — verify recordings via
  during-drive screenshots, not post-hoc playback. Embedded demo clips need
  `--autoplay-policy=no-user-gesture-required` or they record black.
- Commits: `Co-Authored-By` only — **no `Claude-Session:` URL trailer** (public repo;
  the auto-mode classifier hard-blocks it). Signing unavailable → "Unverified" is expected.
- Git stop-hook nags about uncommitted/unsigned every idle turn — expected noise; commit
  at cluster boundaries. Silence untracked sprint tooling with `.git/info/exclude` (local,
  uncommitted) rather than editing `.gitignore`.

## Sprint conventions (repo-specific)
- Any `skills/vela-slides/**` change → bump `VELA_VERSION` + add a `VELA_CHANGELOG` entry
  in `part-imports.jsx` (CI blocks otherwise); keep SKILL.md `version` in sync when app
  code changes. **Do the bump ONCE centrally at integration** so parallel workers don't
  collide on `part-imports.jsx`.
- Shared monolith files (`part-app.jsx`, `part-slides.jsx`, `part-blocks.jsx`) and the
  single test files (`part-uitest.jsx`, `tests/test_vela.py`) are touched by most CRs →
  **serialize colliding writers** (the skill's rule) rather than forcing worktree merges;
  give any genuinely-disjoint cluster its own worktree.
