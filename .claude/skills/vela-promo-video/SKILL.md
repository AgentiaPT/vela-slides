---
name: vela-promo-video
description: Make or update the Vela Slides promo — the beat-synced video (LinkedIn), the silent README loop (GIF) and the interactive HTML tour — from real app footage. Use when asked for a promo, demo or launch video, a README animation, a product tour page, or to refresh these after new features. Owns the fast loop: rank features, edit the storyboard, check stills, show a low-res preview, and render the final video only after the owner approves the preview.
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(node tools/vela-dev/promo/*), Bash(python3 tools/vela-dev/scripts/concat.py*), Bash(python3 skills/vela-slides/scripts/vela.py*), Bash(ffmpeg *), Bash(ffprobe *), Bash(git status*), Bash(git diff*), Bash(git log*)
---

# Vela promo video

The promo is code: `tools/vela-dev/promo/`. All footage is real (the current
app build renders the example decks). All product numbers come from the
repository at build time. One storyboard gives three outputs.

| Output | Command mode | Use |
|---|---|---|
| Low-res preview (960×540, 15 fps) | `--preview` | Review. Always first. About 4 minutes. |
| Final video (1080p, motion blur) | default + `--blur 4` | LinkedIn and other social posts |
| README loop (GIF + small MP4, no sound) | `--gif` | GitHub README |
| Interactive tour (one `.html` file) | `--html` | Browser: play, pause, go chapter by chapter |

## Rule 1: preview first, final last

Do not start a final render before the owner approves a preview. A final
render with blur takes about 25 minutes. A check with stills takes seconds.

1. `--stills <t,t,...>` for each scene you changed. Read the images. Fix.
2. `--preview` for the full video. Send the file to the owner. Stop and wait.
3. Apply the review comments. Go back to step 1.
4. After approval only: final video, then `--gif`, then `--html`.

## Rule 2: put only true things on screen

- Each feature in the storyboard must exist in the code. Find the symbol or
  the changelog version before you add a scene.
- Numbers come from `PROMO_DATA.facts` (see `buildData` in `render.js`). Do
  not type product numbers in the storyboard.
- A claim that the code cannot prove (test total, audit schedule) goes in
  `promo.config.json` under `claims`, with a `_source` note. Measure the test
  total again with `tools/vela-dev/scripts/ci-local.sh` before a release.
- Do not list agent tools or integrations that the repository does not ship.
- A simulated screen (for example the agent terminal) must use real commands,
  real output and real renders, and must carry the on-screen "simulated" note.
- Quotes from the README must be exact.

## Workflow for an update

### 1. Rank the features

Read the newest entries of `VELA_CHANGELOG` in `src/parts/part-imports.jsx`.
Rank the user-facing features by: visual impact, how new, how unusual for a
slide tool. Take the top seven for the feature bars. The owner's standing
priorities: external agent integration (Claude Code + the `vela` CLI + live
reload), the skill, the JSON deck format, story mode, search, edit while
presenting. Do not feature the built-in Vera chat.

### 2. Make the slides gorgeous

The video shows the showcase decks in `tools/vela-dev/promo/decks/`, not the
example decks. The owner's bar: each slide balanced, one focal point, readable,
no clipping. For a new or changed slide: edit the deck, run `shoot-deck.js`,
read `sheet.jpg`, fix, shoot again. Give one deck to one subagent when you make
many slides. Keep the natural content height below about 430px or the app
scales the slide down. See "Showcase decks" in the promo README.

### 3. Get the footage

`capture-assets.js` drives the offline app and saves stills. Add a new block
in `extras()` for a new feature. Use `--only extras` to run that part only.
Use the `playwright-cli-setup` skill first if you must find a selector or a
key. Save file names in `manifest.json`; the storyboard reads them from
`D.manifest`.

### 4. Edit the storyboard

`comp/storyboard.js`. One `tl.scene(name, start, end, build)` for each scene.
Times are in beats: `B(g)` is the time of beat `g`. Keep cuts on beats.
**Reading time:** each line of text stays on screen for 3 seconds or more
(about 7 beats); only single big words can be shorter. If the content does not
fit, add a track segment in `music.segments` (the owner accepts up to 2 min 30 s)
or remove a scene. Do not shorten the hold. Add a
`chapter(g, label)` line for each new section (the HTML tour uses it).
Helpers: `slam` (big word), `type` (typed text), `count` (number roll),
`reel` (stills in sequence), `feature` (one feature bar), `crop` (a block cut
out of a real slide). Engine API: top of `comp/engine.js`.

Text with a gradient class must not have transformed child spans (Chrome
paints it wrong). Put the gradient class on each span.

### 5. Build

```bash
W=/tmp/vela-promo        # work folder, outside git
python3 tools/vela-dev/scripts/concat.py                       # after part-file edits
node tools/vela-dev/promo/render.js --work $W --fonts $W/fonts --stills 14.5,36.2   # first run captures footage
node tools/vela-dev/promo/render.js --work $W --fonts $W/fonts --audio track.mp3 --skip-capture --preview
# after approval:
node tools/vela-dev/promo/render.js --work $W --fonts $W/fonts --audio track.mp3 --skip-capture --blur 4
node tools/vela-dev/promo/render.js --work $W --fonts $W/fonts --skip-capture --gif
node tools/vela-dev/promo/render.js --work $W --fonts $W/fonts --audio track.mp3 --skip-capture --html
```

Fonts and soundtrack are not in the repository. See
`tools/vela-dev/promo/README.md` for the font command and the beat grid.

### 6. Verify before you send

- `ffprobe`: size, frame rate, duration, audio stream.
- Loudness near −14 LUFS: `ffmpeg -i out.mp4 -af ebur128 -f null -`.
- Make a contact sheet from the file and read it:
  `ffmpeg -i out.mp4 -vf "fps=1/1.8,scale=480:270,tile=8x8" -frames:v 1 sheet.jpg`.
- HTML tour: open it in Chromium, start it, press → some times, check that the
  console has no errors and that the page does not scroll sideways at 390 px.
- README loop: keep the GIF under 10 MB (`readme` block in the config).

### 7. Report

Tell the owner: what changed, which screens are simulated, which claims rest
on the owner's word, and what you could not verify (for example, you cannot
hear the soundtrack).

## Files

| File | Purpose |
|---|---|
| `tools/vela-dev/promo/render.js` | All build modes; facts from the repository |
| `tools/vela-dev/promo/capture-assets.js` | Real footage and `manifest.json` |
| `tools/vela-dev/promo/decks/*.vela` | Showcase decks (the slides in the video) |
| `tools/vela-dev/promo/shoot-deck.js` | Stills and a contact sheet of one deck, for design review |
| `tools/vela-dev/promo/comp/storyboard.js` | Scenes, copy, chapters |
| `tools/vela-dev/promo/comp/engine.js` | Deterministic timeline |
| `tools/vela-dev/promo/comp/player.js` | Player for the HTML tour |
| `tools/vela-dev/promo/comp/index.html` | Stage and styles |
| `tools/vela-dev/promo/promo.config.json` | Beat grid and segments, claims, footage choices, README loop ranges |

Do not commit the soundtrack, the fonts, the work folder or the rendered
files unless the owner asks. Dev-only: no `VELA_VERSION` bump is necessary.
