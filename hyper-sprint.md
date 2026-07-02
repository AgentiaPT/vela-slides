# Hyper-Sprint — repo config (Vela Slides)

Stack-agnostic config for the `hyper-sprint` skill. Any agent framework can read this;
the skill loads it in Phase 0 and honors it over guesses.

## Branch
- Base branch: the one you're handed (this repo's default is `main`). Only the sprint
  branch + its base are in scope — don't peek at or diff against other branches.

## Build & test
- Build (rebuild monolith from parts): `python3 skills/vela-slides/scripts/concat.py`
- Tests: `python3 tests/test_vela.py` (349+; must stay green) and `tests/test_serve.py`
- After any `skills/vela-slides/**` change, CI requires a **`VELA_VERSION` bump** +
  `VELA_CHANGELOG` entry in `skills/vela-slides/app/parts/part-imports.jsx` (SKILL.md
  `version` matches when app code changes).

## Boot & drive the app (readiness + demo recording)
The React/lucide CDNs are **blocked** here, and react / react-dom / lucide-react /
@babel/standalone are **already vendored** at `vela-neutralino/resources/vendor/`.
**Never npm-install them** — the offline harness reuses them.
- Build a bootable render: `node skills/vela-slides/scripts/render-offline.js <deck.vela> /tmp/vout`
- App URL to drive/record: `file:///tmp/vout/render.html` (Chromium is pre-installed)
- In-app UI battery headless: `window.__velaRunUITests()`
- See `CLAUDE.md` → "Running the app live" and the `vela-live-render` skill.

## Conventions
- **Public repo** — never commit secrets, API keys, session URLs (`claude.ai/...`), or
  personal info. Security-fix notes stay high-level (no working payloads/repros).
- Virtual canvas 960×540; inline styles only (artifact sandbox — no CSS/Tailwind).

## Stop rule (default)
- A **blind, best-model** validation round of **≥ 3 min** finds no bugs and confirms every
  change present, **and** a recorded demo deck of the real app exists (frame-checked).

## Machine-readable extract (optional; stdlib-parseable — no install)
```json
{
  "baseBranch": "main",
  "appUrl": "file:///tmp/vout/render.html",
  "bootAppCmd": "node skills/vela-slides/scripts/render-offline.js {deck} /tmp/vout",
  "build": "python3 skills/vela-slides/scripts/concat.py",
  "test": "python3 tests/test_vela.py",
  "packagesVendored": ["react", "react-dom", "lucide-react", "@babel/standalone"],
  "stopRule": { "blindHuntMinutes": 3, "artifact": "recorded demo deck" }
}
```
