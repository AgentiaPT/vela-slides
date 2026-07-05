# Hyper-Sprint — repo config (Vela Slides)

Repo facts for the `hyper-sprint` skill (any agent stack). Loaded in Phase 0; honor over guesses.

- **Branch:** use the base branch you're handed (default `main`). Only the sprint branch + its base are in scope.
- **Build:** `python3 skills/vela-slides/scripts/concat.py` · **Test:** `python3 tests/test_vela.py` (keep green). Baseline may show ~2 pre-existing failures until node deps are provisioned — record them, don't chase.
- **Provisioning:** `jsdom` is a **declared** devDependency (`package.json`) needed by two node test suites — `npm i jsdom` is fine (not a new package). Vendored, **never install:** react / react-dom / lucide-react / @babel/standalone (at `vela-neutralino/resources/vendor/`).
- **Version bump:** any `skills/vela-slides/**` change needs `VELA_VERSION` + `VELA_CHANGELOG` in `part-imports.jsx` (CI blocks otherwise).
- **Boot the app (CDNs blocked):** first `python3 skills/vela-slides/scripts/concat.py`, then `node .hyper-sprint/render-offline.js <deck.vela> /tmp/vout` → drive/record `file:///tmp/vout/render.html` (Chromium pre-installed; app signals readiness via `window.__velaBooted`; UI battery `window.__velaRunUITests()`). This builder ships **in `.hyper-sprint/` alongside this config** so it's always present. It reuses the vendored UMD recipe (external app.js, strip `import`+`export`, `lucideReact` global) — so if it's ever missing, don't rebuild from scratch: use the `vela-browser-test` / `vela-live-render` skill, which documents the same recipe. See CLAUDE.md "Running the app live".
  - **Worktrees:** the script's own file location decides which tree it builds by default (`__dirname`-based). If you invoke a copy of this script from a path OTHER than the tree you mean to build (e.g. always calling the main tree's absolute path while a worktree sits at an older commit), pass `--repo-root <worktree-path>` (or set `HYPER_SPRINT_REPO_ROOT`) — otherwise it silently builds the wrong commit's app. Always rebuild fresh immediately before any validator/fix-verification dispatch; never reuse a render dir across a commit boundary (see `references/orchestration.md`'s blind-gate section).
- **Public repo:** no secrets, keys, session URLs, or PII in commits; security notes stay high-level. Canvas 960×540, inline styles only.
- **Commit policy:** `Co-Authored-By` only — **no `Claude-Session:` URL trailer** (CLAUDE.md forbids it; the auto-mode classifier blocks the commit otherwise). Commit at cluster boundaries; the git stop-hook nagging about unsigned/uncommitted is expected noise.
- **UI battery:** `window.__velaRunUITests()` may hang on fullscreen/animation tests headless — run **per-suite / sharded**, don't block on a hang.
- **Parallel workers:** workers racing on the single `part-uitest.jsx` + `concat.py`→`vela.jsx`/`test_vela.py` outputs force serialization — give each parallel worker a **unique temp build dir** (and prefer per-feature test files) so disjoint-file clusters run concurrently.
- **Stop rule:** a blind best-model hunt ≥3 min finds no bugs + all features present, and a frame-checked recorded demo deck exists.

```json
{ "baseBranch": "main",
  "build": "python3 skills/vela-slides/scripts/concat.py",
  "test": "python3 tests/test_vela.py",
  "bootAppCmd": "node .hyper-sprint/render-offline.js {deck} /tmp/vout",
  "appUrl": "file:///tmp/vout/render.html",
  "packagesVendored": ["react","react-dom","lucide-react","@babel/standalone"],
  "stopRule": { "blindHuntMinutes": 3, "artifact": "recorded demo deck" } }
```
