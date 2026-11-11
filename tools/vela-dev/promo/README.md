# Vela promo video

Source of the Vela Slides promo video (1920×1080, 30 fps, about 1 min 50 s).
One command builds the video again after the app changes. Dev-only: nothing
here ships in the skill.

## How it works

| Step | File | What it does |
|---|---|---|
| 1. Capture | `capture-assets.js` | Opens the real app offline and saves stills: each slide of the example decks at 2x, the editor, the gallery, the phone layout. Also saves the rectangle of each block. |
| 2. Facts | `render.js` | Reads the numbers from the code: line count, version, block types, Vera tools, changelog versions. |
| 3. Composition | `comp/` | An HTML page. Each visual value is a function of the time, so each frame is reproducible. |
| 4. Frames | `render.js` | Seeks the page frame by frame in Chromium and saves each frame. |
| 5. Encode | `render.js` | Mixes the soundtrack and writes an H.264 + AAC `.mp4` with ffmpeg. |

All footage is real: it comes from `examples/*.vela` rendered by the current
build of the app. The numbers on screen come from the repository, not from
the storyboard.

## Build

```bash
python3 tools/vela-dev/scripts/concat.py          # only after part-file edits

node tools/vela-dev/promo/render.js \
  --work  /tmp/vela-promo \
  --audio /path/to/track.mp3 \
  --fonts /tmp/vela-promo/fonts \
  --blur 4
# result: /tmp/vela-promo/vela-promo.mp4
```

| Flag | Use |
|---|---|
| `--work <dir>` | Work folder (footage, frames, result). Keep it outside git. |
| `--audio <file>` | Soundtrack. Not stored in this repository. Without it the video is silent. |
| `--fonts <dir>` | Folder with the brand fonts (see below). Without it the fallback fonts are used. |
| `--skip-capture` | Use the footage that is already in the work folder. |
| `--stills 1.5,14.4` | Write PNG stills at these times (seconds). No video. Fast check of a scene. |
| `--from <s> --to <s>` | Render only a part of the video. |
| `--jobs <n>` | Number of parallel browser pages (default 4). |
| `--blur <n>` | Motion blur: `n` samples for each frame in a 180° shutter. Use 4 for the final video. Default 1 (no blur). |

On 4 cores a full build takes about 6 minutes without blur and about 25 minutes with `--blur 4`.

### Brand fonts

The app uses Sora, DM Sans and Space Mono from Google Fonts. The dev container
blocks that host, so the fonts come from npm (SIL Open Font License):

```bash
mkdir -p /tmp/vela-promo/fonts && cd /tmp/vela-promo/fonts
npm pack @fontsource/sora@5.3.0 @fontsource/dm-sans@5.3.0 @fontsource/space-mono@5.3.0
for f in *.tgz; do d=${f%-5.3.0.tgz}; mkdir -p "$d" && tar xzf "$f" -C "$d" --strip-components=1; done
```

Do not add these packages to `package.json`.

## Update the video for a new feature

1. **Numbers and footage change automatically.** Build again.
2. **New copy or a new scene:** edit `comp/storyboard.js`. Each scene is one
   `tl.scene(name, start, end, build)` block. Times are in beats: `B(g)` is
   the time of beat `g`. Keep cuts on beats.
3. **Check the scene** with `--stills` before a full build.
4. **New claim on screen:** make sure that the README or the code supports it.

### Scene map (beats; the track plays two times, 120 beats each)

| Beats | Scene | Content |
|---|---|---|
| 0–8 | `open` | Hook: one word per beat |
| 8–32 | `build` | Prompt, then 10 slides appear |
| 32–36 | `logo` | Logo, slides fly past the camera |
| 36–44 | `blitz` | One real slide per beat |
| 44–49 | `tagline` | Describe it. Present it. |
| 49–64 | `blocks` | Block types, cut out of real slides |
| 64–73 | `themes` | Example decks |
| 73–80 | `vera` | Edit by talking |
| 80–108 | `f-*` | One feature per bar (7 bars) |
| 108–120 | `fill`, `twist` | Line count, written by AI |
| 120–152 | `factory` | README quote, validation, version counter |
| 152–169 | `dark` | Dark AI software factory, version |
| 169–184 | `yours` | No servers, no deploys, no accounts |
| 184–193 | `runtimes` | Three runtimes |
| 193–200 | `byoa` | Works with your agent |
| 200–228 | `wall`, `ring`, `verbs`, `title` | 3D montage |
| 228–end | `think`, `end` | Last line, end card |

## Change the soundtrack

`promo.config.json` holds the beat grid of the track: `bpm`, `phase` (time of
the first beat, seconds), `passBeats` (beats in one pass), `passes` and `tail`
(seconds of hold after the last hit). Measure a new track and update these
values. The scene map above follows the structure of the current track
(drops at beats 32, 80 and 112), so a different track needs new scene times.
