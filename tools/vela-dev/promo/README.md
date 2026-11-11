# Vela promo video

Source of the Vela Slides promo: a beat-synced video (1920×1080, 30 fps, about
1 min 50 s), a silent loop for the README, and an interactive HTML tour. One
command builds each output again after the app changes. Dev-only: nothing
here ships in the skill.

## How it works

| Step | File | What it does |
|---|---|---|
| 1. Capture | `capture-assets.js` | Opens the real app offline and saves stills: each slide of the example decks at 2x, the editor, the gallery, the phone layout. Also saves the rectangle of each block. |
| 2. Facts | `render.js` | Reads the numbers from the code: line count, version, block types, deck format sizes (measured with the `vela` CLI), skill name and files. |
| 3. Composition | `comp/` | An HTML page. Each visual value is a function of the time, so each frame is reproducible. |
| 4. Frames | `render.js` | Seeks the page frame by frame in Chromium and saves each frame. |
| 5. Encode | `render.js` | Mixes the soundtrack and writes an H.264 + AAC `.mp4`, a GIF loop, or one standalone `.html` (with `comp/player.js`). |

All footage is real: it comes from `examples/*.vela` rendered by the current
build of the app. The numbers on screen come from the repository, not from
the storyboard.

## Build

The agent workflow (feature ranking, preview-first review, checks) is in the
skill `.claude/skills/vela-promo-video/SKILL.md`. Commands:

```bash
W=/tmp/vela-promo                                   # work folder, outside git
python3 tools/vela-dev/scripts/concat.py            # only after part-file edits
R="node tools/vela-dev/promo/render.js --work $W --fonts $W/fonts"

$R --stills 14.5,36.2                               # stills (the first run captures footage)
$R --skip-capture --audio track.mp3 --preview       # low-res full video: review this first
$R --skip-capture --audio track.mp3 --blur 4        # final 1080p video
$R --skip-capture --gif                             # silent README loop (GIF + MP4)
$R --skip-capture --audio track.mp3 --html          # interactive tour, one .html file
```

| Flag | Use |
|---|---|
| `--work <dir>` | Work folder (footage, frames, results). Keep it outside git. |
| `--audio <file>` | Soundtrack. Not stored in this repository. Without it the output is silent. |
| `--fonts <dir>` | Folder with the brand fonts (see below). Without it the fallback fonts are used. |
| `--skip-capture` | Use the footage that is already in the work folder. |
| `--preview` | Full video at 960×540 and 15 fps, no blur. About 3 minutes. |
| `--stills 1.5,14.4` | PNG stills at these times (seconds). Seconds to run. |
| `--gif` | Loop for the README. Ranges, width and frame rate: `readme` in `promo.config.json`. |
| `--html` | Standalone page: player, chapters (← →), soundtrack, images embedded. |
| `--blur <n>` | Motion blur for the final video: `n` samples in a 180° shutter. Use 4. |
| `--from <s> --to <s>` | Render only a part of the video. |
| `--jobs <n>` | Number of parallel browser pages (default 4). |

On 4 cores the final video takes about 6 minutes without blur and about 25
minutes with `--blur 4`.

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
4. **New claim on screen:** make sure that the README or the code supports it. A claim that the code cannot prove goes in `claims` in `promo.config.json`, with its source.

### Scene map (beats; the track plays two times, 120 beats each)

| Beats | Scene | Content |
|---|---|---|
| 0–8 | `open` | Hook: one word per beat |
| 8–32 | `build` | Prompt, then 10 slides appear |
| 32–49 | `logo`, `blitz`, `tagline` | Logo, one real slide per beat, tagline |
| 49–64 | `blocks` | Block types, cut out of real slides |
| 64–73 | `themes` | Example decks |
| 73–80 | `json` | The deck is JSON; format sizes measured by the CLI |
| 80–108 | `f-*` | One feature per bar: present, edit live, search, story mode, phone, export, numbers |
| 108–120 | `fill`, `handoff` | Hand it to your agent |
| 120–152 | `agent` | Claude Code + the vela CLI; the browser follows (simulated terminal, real output) |
| 152–169 | `skill` | Ships as a skill |
| 169–184 | `twist` | Line count, written by AI, README quote |
| 184–193 | `checks` | What keeps it in check (`claims` in the config) |
| 193–200 | `runtimes` | Three runtimes |
| 200–228 | `wall`, `ring`, `verbs`, `title` | 3D montage |
| 228–end | `think`, `end` | Last line, end card |

## Change the soundtrack

`promo.config.json` holds the beat grid of the track: `bpm`, `phase` (time of
the first beat, seconds), `passBeats` (beats in one pass), `passes` and `tail`
(seconds of hold after the last hit). Measure a new track and update these
values. The scene map above follows the structure of the current track
(drops at beats 32, 80 and 112), so a different track needs new scene times.
