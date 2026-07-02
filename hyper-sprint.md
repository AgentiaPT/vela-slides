# Hyper-Sprint — repo config (Vela Slides)

Repo facts for the `hyper-sprint` skill (any agent stack). Loaded in Phase 0; honor over guesses.

- **Branch:** use the base branch you're handed (default `main`). Only the sprint branch + its base are in scope.
- **Build:** `python3 skills/vela-slides/scripts/concat.py` · **Test:** `python3 tests/test_vela.py` (keep green).
- **Version bump:** any `skills/vela-slides/**` change needs `VELA_VERSION` + `VELA_CHANGELOG` in `part-imports.jsx` (CI blocks otherwise).
- **Boot the app (CDNs blocked):** `node skills/vela-slides/scripts/render-offline.js <deck.vela> /tmp/vout` → drive/record `file:///tmp/vout/render.html` (Chromium pre-installed; UI battery: `window.__velaRunUITests()`). See CLAUDE.md "Running the app live".
- **Never npm-install** react / react-dom / lucide-react / @babel/standalone — vendored at `vela-neutralino/resources/vendor/`.
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
