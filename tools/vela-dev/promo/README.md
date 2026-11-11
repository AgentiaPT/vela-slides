# Vela promo video

Source of the Vela Slides promo: a beat-synced video (1920×1080, 30 fps, about
2 min 29 s), a silent loop for the README, and an interactive HTML tour. One
command builds each output again after the app changes. Dev-only: nothing
here ships in the skill.

## How it works

| Step | File | What it does |
|---|---|---|
| 1. Capture | `capture-assets.js` | Opens the real app offline and saves stills: each slide of the showcase decks at 2x, the phone layout, search, edit while presenting, story mode, and each state of the agent edit (made with the real `vela` CLI). Also saves the rectangle of each block. |
| 2. Facts | `render.js` | Reads the numbers from the code: line count, version, block types, deck format sizes (measured with the `vela` CLI), skill name and files. |
| 3. Composition | `comp/` | An HTML page. Each visual value is a function of the time, so each frame is reproducible. |
| 4. Frames | `render.js` | Seeks the page frame by frame in Chromium and saves each frame. |
| 5. Encode | `render.js` | Mixes the soundtrack and writes an H.264 + AAC `.mp4`, a GIF loop, or one standalone `.html` (with `comp/player.js`). |

All footage is real: the current build of the app renders the sample decks in
`examples/` (`vela-tour`, `startup-pitch`, `course-training`,
`business-report`, `tech-talk`). Each slide is designed and checked by eye
(`shoot-deck.js`). The numbers on screen come from the repository, not from
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

### Scene map (global beats)

The track plays in three segments (`music.segments` in the config): two full
passes of 120 beats, then the track again from its first drop (88 beats).
About 2 min 29 s. Rule: each line of text stays on screen for 3 seconds or
more (single big words excepted).

| Beats | Scene | Content |
|---|---|---|
| 0–8 | `open` | Hook: one word per beat |
| 8–32 | `build` | Prompt, then the 10 slides of the tour deck appear |
| 32–49 | `logo`, `blitz`, `tagline` | Logo, one real slide per beat, tagline |
| 49–64 | `blocks` | Block types, cut out of real slides |
| 64–73 | `themes` | Showcase decks |
| 73–80 | `lead` | Now run the show |
| 80–120 | `f-*` | Two bars each: present, edit live, search, story mode, phone |
| 120–138 | `agent` | Claude Code + the vela CLI; the browser follows (simulated terminal, real output) |
| 138–152 | `inline` | The other direction: AI Edit inside Vela; the app calls the agent CLI (real UI, real arguments) |
| 152–169 | `skill` | Ships as a skill |
| 169–184 | `json` | A deck is JSON; format sizes measured by the CLI |
| 184–193 | `export` | Export formats |
| 193–200 | `numbers` | At a glance |
| 200–228 | `twist` | Line count, written by AI, README quote |
| 228–240 | `who`, `tests` | Who checks it? The test total (`claims`) |
| 240–257 | `checks` | What keeps it in check (`claims`) |
| 257–272 | `runtimes` | Three runtimes |
| 272–288 | `verbs`, `think` | Recap verbs, You think. |
| 288–320 | `wall`, `ring`, `shows`, `title`, `black` | Vela shows. 3D montage |
| 320–end | `end` | End card |

### Showcase decks

The video shows the sample decks in `examples/`. They are also the public
gallery decks, so a better slide improves both. To change or add one:

```bash
node tools/vela-dev/promo/shoot-deck.js examples/course-training.vela /tmp/shots --fonts $W/fonts --portrait
# read /tmp/shots/sheet.jpg (and sheet-p.jpg), fix the deck, shoot again
```

Quality bar: balanced, one focal point, no text below about 13px on the
960×540 canvas, no clipping, natural content height below about 430px (above
that the app scales the slide down and aligns it to the top). `footage` in the
config names the decks, the tour deck, the phone slides and the search query.
The agent scenes edit slide 4 of `startup-pitch.vela` (on a copy): keep
`blocks[0]` a heading with the text `Traction`, and keep `$480K` and `22%` on
that slide. `tests/test_pptx_export.cjs` needs 5 or more slides in
`tech-talk.vela`.

## Change the soundtrack

`promo.config.json` holds the beat grid of the track: `bpm`, `phase` (time of
the first beat, seconds), `segments` (parts of the track, in beats, played one
after the other) and `tail` (seconds of hold after the last hit). Measure a
new track and update these values. The scene map follows the structure of the
current track (drops at track beats 32, 80 and 112), so a different track
needs new scene times.
