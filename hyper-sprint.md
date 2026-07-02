# Hyper-Sprint — repo config (Vela Slides)

Repo facts for the `hyper-sprint` skill (any agent stack). Loaded in Phase 0; honor over guesses.

- **Branch:** use the base branch you're handed (default `main`). Only the sprint branch + its base are in scope.
- **Build:** `python3 skills/vela-slides/scripts/concat.py` · **Test:** `python3 tests/test_vela.py` (keep green). Baseline may show ~2 pre-existing failures until node deps are provisioned — record them, don't chase.
- **Provisioning:** `jsdom` is a **declared** devDependency (`package.json`) needed by two node test suites — `npm i jsdom` is fine (not a new package). Vendored, **never install:** react / react-dom / lucide-react / @babel/standalone (at `vela-neutralino/resources/vendor/`).
- **Version bump:** any `skills/vela-slides/**` change needs `VELA_VERSION` + `VELA_CHANGELOG` in `part-imports.jsx` (CI blocks otherwise).
- **Boot the app (CDNs blocked):** use the **`vela-browser-test` / `vela-live-render` skill** — it has the working offline recipe (external app.js over a local server; inline `text/babel` truncates on `</script>` in test strings; strip `import`+`export`; provide React hooks + `lucideReact` globals from the vendored UMD; Chromium pre-installed; UI battery `window.__velaRunUITests()`). Convenience script `skills/vela-slides/scripts/render-offline.js <deck> /tmp/vout` → `file:///tmp/vout/render.html` **exists only where the offline-harness commit has landed (not on plain `main`)** — if absent, use the skill recipe, don't rebuild from scratch. See CLAUDE.md "Running the app live".
- **Public repo:** no secrets, keys, session URLs, or PII in commits; security notes stay high-level. Canvas 960×540, inline styles only.
- **Stop rule:** a blind best-model hunt ≥3 min finds no bugs + all features present, and a frame-checked recorded demo deck exists.

```json
{ "baseBranch": "main",
  "build": "python3 skills/vela-slides/scripts/concat.py",
  "test": "python3 tests/test_vela.py",
  "bootAppCmd": "node skills/vela-slides/scripts/render-offline.js {deck} /tmp/vout",
  "appUrl": "file:///tmp/vout/render.html",
  "packagesVendored": ["react","react-dom","lucide-react","@babel/standalone"],
  "stopRule": { "blindHuntMinutes": 3, "artifact": "recorded demo deck" } }
```
