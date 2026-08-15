# Hyper Sprint - Copilot CLI Sandbox Profile

Use this profile with `.hyper-sprint/config.md`.

## Detection

```bash
[ "$HOME" = /home/agent ] \
  && [ -f .env.vela-dev ] \
  && [ -d /home/agent/.local/share/vela-slides/npm/node_modules/playwright ] \
  && [ "$(stat -f -c %T .)" = fuseblk ] \
  && echo copilot-cli-sandbox || echo "profile: unknown"
```

## Required environment

Source the environment file before Node or browser commands:

```bash
. ./.env.vela-dev
```

It sets these paths:

- work and proof output:
  `/home/agent/.local/share/vela-slides`
- npm packages:
  `/home/agent/.local/share/vela-slides/npm/node_modules`
- command tools: `/home/agent/.local/bin`
- Chromium:
  `/home/agent/.local/share/vela-slides/browsers/chromium-1194/chrome-linux/chrome`
- burst client wait: 25 seconds

Do not install packages on `/d`. The repository mount is `fuseblk`, and large
package trees are slow on this mount. The mounted drive does not support the
required `node_modules` symbolic link. `NODE_PATH` connects Node to the
Linux-local package store.

Do not run `playwright install`. Do not use Docker for Vela tests.

### Recording font prerequisite

Before screenshots or video, verify Chromium has an emoji fallback font:

```bash
fc-match "Noto Color Emoji" | grep -q "Noto Color Emoji"
```

If the check fails, install the official Ubuntu package for the current user:

```bash
mkdir -p "$VELA_DEV_WORK_ROOT/font-package" "$HOME/.local/share/fonts"
cd "$VELA_DEV_WORK_ROOT/font-package"
apt-get download -qq fonts-noto-color-emoji
dpkg-deb -x fonts-noto-color-emoji_*.deb extracted
cp extracted/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf \
  "$HOME/.local/share/fonts/"
fc-cache -f
```

Restart Chromium and capture one toolbar smoke screenshot. Confirm icons,
button borders, separators, and shading before a full recording. Missing emoji
glyphs are a runner-font defect, not a CDN/firewall or vendored-Lucide defect.
Keep font files under `/home/agent`; do not add them to the repository.

## Fast readiness gate

The environment is pre-provisioned. Do not run `npm ci` during normal sprint
readiness.

```bash
. ./.env.vela-dev

node -e "
  for (const p of ['playwright', 'jsdom', 'react', 'react-dom']) {
    require(p);
  }
"

OUT="$VELA_DEV_WORK_ROOT/hyper-ready"
URL=$(bash .hyper-sprint/burst-boot.sh examples/vela-demo.vela "$OUT")

bash .claude/skills/burst-bug-hunter/assets/start-hunt.sh \
  "$VELA_DEV_WORK_ROOT/hunt-ready" \
  "$URL" \
  .hyper-sprint/burst-hunter.json

python3 -c 'import time; print(time.time() + 120)' \
  > "$VELA_DEV_WORK_ROOT/hunt-ready/deadline"

VDRIVE="$VELA_DEV_WORK_ROOT/hunt-ready" \
  .claude/skills/burst-bug-hunter/assets/vrun \
  .hyper-sprint/readiness-burst.mjs
```

Do not run `concat.py` before `burst-boot.sh`. The boot script already runs it.
The extra build is an avoidable control step.

The readiness burst must use the warm engine. It must confirm these surfaces in
one browser:

1. Editor boot.
2. Heading edit and save state.
3. Presenter entry and next-slide navigation.
4. Safe presenter exit.
5. Gallery entry.
6. Export menu or another modal.
7. In-memory reset.

Do not make a temporary Playwright driver. Use the Vela verb library:

`/d/Agentia/vela-slides/.hyper-sprint/vela-verbs.mjs`

The canonical readiness job is:

`/d/Agentia/vela-slides/.hyper-sprint/readiness-burst.mjs`

It uses one warm browser and an in-memory reset between scenarios. The save
check waits until the edited heading is present in the offline storage payload.

Measured on 2026-08-14: the full burst took 4,951 ms. The save check took
1,746 ms because the app uses a 1.5-second debounce before the storage write.

The engine writes these timing fields to `stats.json`:

- `browserBootMs`
- `totalMs`
- `resetTimesMs`

Normal readiness uses one `vrun` job. Split the job only to diagnose a named
failure.

## Full validation

Use these commands when a change requires full validation:

```bash
. ./.env.vela-dev
python3 tests/test_vela.py
python3 tools/vela-dev/scripts/concat.py
```

Measured baseline on 2026-08-14:

- Python tests: 504 passed
- UI battery: 238 passed, 9 skipped, 0 failed
- Playwright: 1.61.1
- Playwright CLI: 0.1.15
- Chromium: 141

The test count can increase. A lower count or a new failure requires
investigation.

## Fast browser rules

- Build a fresh offline render after each commit that changes app code.
- Open the app once for each hunter.
- Submit multi-step bursts with `vrun`.
- Use `ctx.reset()` between scenarios.
- Use stable verbs. Do not find selectors again in each test.
- Take screenshots in the validation burst. Do not run a separate screenshot
  pass.
- Keep screenshots out of the orchestrator context.
- Run independent hunters in parallel work directories.
- Put all render, browser, and test output under
  `/home/agent/.local/share/vela-slides`.

## Fullscreen rule

Real Playwright keyboard input and screenshots can stop in headless fullscreen
mode. Use these verbs:

- `presentKey`
- `navKey`
- `swipe`

Exit presenter mode before a screenshot.

## AI tests

AI tests are not part of normal readiness. They can use the user's account and
can have a cost. Run them only when the user or the acceptance test requires
them.

Use the committed AI driver:

```bash
. ./.env.vela-dev
node tools/vela-dev/scripts/vela-drive.js ai \
  examples/vela-demo.vela \
  --json /home/agent/.local/share/vela-slides/ai-tests.json
```

Do not write a temporary AI bridge or browser driver.
