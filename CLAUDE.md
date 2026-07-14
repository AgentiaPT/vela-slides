# Vela Slides — CLAUDE.md

## What is Vela?

AI-native presentation engine for Claude.ai. Single-file React app (~1.3MB, 18,476 lines) that runs inside Claude.ai artifacts. Users describe slides in conversation, Vela renders them with 27 semantic block types.

## Architecture

```
Source part-files  →  concat.py         →  vela.jsx           →  assemble.py  →  final.jsx
(src/parts)           (tools/vela-dev)      ships in skill dir     (skill)        ↑ with deck data
 ↑ edit these                               skills/vela-slides/app/
```

The app source (part-files) lives in `src/parts/`. The build/preview/AI
toolchain lives in `tools/vela-dev/` — both dev-only, never shipped. The
**lean skill** — `skills/vela-slides/` — carries only the compiled `vela.jsx`
plus the author→ship scripts (`vela.py`, `validate.py`, `assemble.py`).

**No bundler.** Python stdlib concatenation in fixed dependency order (~10ms).

### Part-File Order (fixed, never changes)
```
imports → icons → blocks → reducer → engine → slides → list → chat → test → uitest → demo → pdf → pptx → app
```

### Key Parts
| Part | Purpose |
|------|---------|
| `part-imports.jsx` | Constants, sanitizers, helpers, storage API, startup patch system |
| `part-icons.jsx` | 1000+ Lucide icon resolver |
| `part-blocks.jsx` | 27 block renderers (heading, flow, grid, metric, timeline, etc.) |
| `part-reducer.jsx` | useReducer state + dispatch actions |
| `part-engine.jsx` | Vera AI engine — callClaudeAPI(), 22 tools, ReAct loop |
| `part-slides.jsx` | SlidePanel rendering, fullscreen, thumbnails |
| `part-list.jsx` | Lane/module list, drag-and-drop |
| `part-chat.jsx` | ChatPanel, tool traces |
| `part-test.jsx` | Battery render tests |
| `part-demo.jsx` | Cinematic demo mode (19 scenes) |
| `part-uitest.jsx` | 186 UI tests in 33 suites |
| `part-pdf.jsx` | Canvas PDF export, markdown export |
| `part-pptx.jsx` | Native editable PowerPoint (.pptx) export |
| `part-app.jsx` | Root VelaApp, modals, keyboard handlers |

## Deck Format

JSON with three interchangeable formats (auto-expand on load via `_load_full()`):
- **Full** — human-readable, named keys
- **Compact** (~32% smaller) — short keys: `_`=type, `x`=text, `s`=size, `C`=palette, `S`=slides, `T`=themes
- **Turbo** (~47% smaller) — positional arrays for LLM context passing

Virtual canvas: **960×540px** (16:9).

### Deck Structure
```json
{
  "deckTitle": "...",
  "lanes": [{
    "title": "Section",
    "items": [{
      "title": "Module",
      "status": "todo|done",
      "slides": [{
        "bg": "#0f172a", "color": "#e2e8f0", "accent": "#3b82f6",
        "duration": 60,
        "blocks": [{ "type": "heading", "text": "..." }]
      }]
    }]
  }]
}
```

### Block Types (27)
Text: heading, text, quote, badge, callout
Lists: bullets, icon-row, tag-group, checklist
Data: grid, table, metric, progress, timeline, number-row, matrix
Flow: flow (gates & loops), steps, comparison, funnel, cycle
Media: image, code, svg, icon
Layout: spacer, divider

## CLI — `vela.py`

```bash
vela deck list|validate|split|dump|stats|find|extract-text|patch-text|replace-text|compact|expand|turbo|ship|assemble
vela slide view|edit|remove|move|duplicate|insert|remove-block
```

The shipped skill authors and ships decks only. The local-preview server, offline
render harness, and AI backend live in `tools/vela-dev/` (see below) and are never
part of the installed skill.

Exit codes: 0=success, 1=fail, 2=usage, 3=not-found, 4=validation, 5=conflict.
Supports `--json` for structured output and `--dry-run` for previews.

## Mandatory: Run CI Checks After Every Change

```bash
# 1. Run full test suite (365 tests)
python3 tests/test_vela.py

# 2. Verify template is in sync with parts
python3 tools/vela-dev/scripts/concat.py
```

All checks must pass before committing.

## Build Commands

```bash
# Rebuild monolith from parts
python3 tools/vela-dev/scripts/concat.py

# Assemble with a deck (rebuild the monolith first if you edited parts)
python3 tools/vela-dev/scripts/concat.py
python3 skills/vela-slides/scripts/assemble.py examples/vela-demo.vela

# Validate deck JSON
python3 skills/vela-slides/scripts/validate.py deck.vela

# Run tests
python3 tests/test_vela.py
```

## Neutralino Desktop Build (Docker)

Reproducible cross-OS binaries via `vela-neutralino/Dockerfile` (context = repo root):

```bash
DOCKER_BUILDKIT=1 docker build -f vela-neutralino/Dockerfile \
  -o type=local,dest=vela-neutralino/dist .
```

Single Linux build emits all win/linux/mac binaries (`neu build` bundles prebuilt runtimes). Runs `concat.py` → `neu update` → `verify-runtime.py` (SHA256 pins) → `sync-vela.py` → `neu build --embed-resources`. Output lands in `dist/vela/` (gitignored — never commit binaries). CI does **not** use Docker; this is a local convenience only.

## Key Directories

```
skills/vela-slides/      ← LEAN PAYLOAD (what installs / ships)
  app/vela.jsx           ← auto-generated monolith (ship template)
  scripts/               ← vela.py, assemble.py, validate.py (author→ship only)
  references/            ← block-schema.md, design-patterns.md, formats.md, themes.md
  examples/vela-demo.json ← for `vela deck ship --demo`
  SKILL.md               ← skill prompt
src/                     ← APP SOURCE (edit these; built into vela.jsx, never shipped raw)
  parts/                 ← part-*.jsx source part-files
tools/vela-dev/          ← DEV/TEST/CI TOOLCHAIN (never shipped)
  local.html             ← local-preview shell
  scripts/               ← concat.py, serve.py, agent_backend.py, render-offline.js,
                            vela-drive.js, lint.py, sync-skill-docs.py
  channel/               ← Node/pnpm MCP bridge
  evals/, references/    ← evals.json, app-editing.md
examples/                ← vela-demo.vela, themed example decks
decks/                   ← working deck files (gitignored)
docs/                    ← ARCHITECTURE.md, SECURITY.md, SCREENSHOTS.md (visual testing runbook)
evals/                   ← skill version benchmarking (see docs/EVAL-RUNBOOK.md)
tests/                   ← test_vela.py, test_serve.py
```

## AI Features (Vera Engine)

- Direct HTTP to Anthropic API from artifact (no client key — uses artifact proxy)
- ReAct loop with 22 tools (set_slides, edit_slide, add_slide, batch ops, etc.)
- Model: claude-sonnet-4-20250514, temp=0, max 16K tokens
- Session cost tracking built-in

## IMPORTANT: Version Bump Required for Skill Changes

**Any change to the shipped skill (`skills/vela-slides/`) or the app source (`src/parts/`) MUST include a `VELA_VERSION` bump.** CI will block the PR otherwise.

- `VELA_VERSION` lives in `src/parts/part-imports.jsx` (format: `major.minor`, e.g. `"10.2"` → `"10.3"`)
- Increment the minor version for each change. Bump major only for large rewrites.
- Also update `VELA_CHANGELOG` in the same file with a brief description of the change.
- **Changelog entries MUST be concise bullets — never walls of text.** Prefer a short array of terse points (`d: ["…", "…"]`), which the About dialog renders as a bulleted list; a single trivial change may stay a one-line string (`d: "…"`). Keep each bullet to one line, no marketing prose. **Never include sensitive information or exploit/reproduction detail** — security entries follow the *Security-Fix Disclosure Discipline* below (class of issue + what the fix does only). The About "Recent Changes" list is user-facing, so bloated entries make it unusable.
- SKILL.md `version` should match `VELA_VERSION` when app code changes.

If you forget, CI will fail with:
```
❌ Files under skills/vela-slides/ changed but VELA_VERSION was not bumped.
```

## Important Constants

- `STARTUP_PATCH` — marker in template where deck JSON gets injected by assemble.py
- `VELA_VERSION` — must be incremented on every skill code change (format: `major.minor`)
- `VELA_CHANGELOG` — should get a new entry on every code change
- SKILL.md `version` — must use same `major.minor` format. Bump when app changes; may also bump independently for skill-only changes. Release workflow triggers only when `skills/vela-slides/**` changes.
- Virtual canvas: 960×540px (16:9)
- All styling is inline (artifact sandbox — no CSS/Tailwind)

## Storage

- Claude.ai artifact storage API for persistence across sessions
- localStorage keys: `"vela-deck"` (main), `"vela-m-<moduleId>"` (per-module dirty tracking)

## CRITICAL: Public Repository — No Sensitive Information

**This is a PUBLIC repository. Everything committed or included in PRs is visible to everyone.**

- **NEVER** include Claude Code session URLs (e.g., `claude.ai/chat/...`, `claude.ai/p/...`) in commit messages, PR descriptions, comments, or any committed file. These are personal and must not be shared.
- **NEVER** include API keys, tokens, passwords, credentials, or secrets of any kind.
- **NEVER** include personal information (email addresses, phone numbers, private URLs, internal company links, etc.).
- **NEVER** reference private conversations, session IDs, or internal tool URLs in any git-visible content.
- PR descriptions must contain only technical information about the changes — what changed, why, and how to test. Nothing else.
- Before every commit and PR, review all content for accidental leaks of sensitive or personal information.

Violations of this policy cannot be undone — git history is permanent and public.

## CRITICAL: Security-Fix Disclosure Discipline

**Public-facing text about a security fix MUST NOT include detail that helps reproduce the issue in the wild.** This applies to **`VELA_CHANGELOG` entries, commit messages, PR titles/bodies, code review comments, and any other public-exposed document** (the changelog also renders in the in-app About dialog).

For any security-related change, describe it at a **high level only**:
- ✅ DO state: the class of issue (e.g. "CSS exfil channel", "mutation-XSS", "fail-open sanitization"), severity, the affected area, what the fix does, and that regression tests were added.
- ❌ DO NOT include: working payloads or example attack strings, the exact bypass token/primitive, step-by-step reproduction, "where the gap was" maps (precise unguarded fields/endpoints/parameters an attacker should target), or chained CVE/exploit references that amount to a recipe.

Rule of thumb: if a reader could copy a string or follow the steps to trigger the bug, it's too much — generalize it. Keep precise mechanics in **non-public** channels (private security threads / advisories), or, where genuinely needed for maintenance, in **in-code comments** (maintainer-facing, not surfaced in release notes) — and even there, prefer the minimum needed to explain *why* the guard exists.

This discipline is permanent and applies to **every** future change, not just the current one. When in doubt, write less.

## Eval / Benchmarking

Full eval runbook: **`docs/EVAL-RUNBOOK.md`** — covers running A/B comparisons, blind LLM judging, analysis scripts, and the complete scenario list. Read that doc instead of re-exploring `evals/` each time.

Quick reference:
```bash
# Copy current skill to eval versioned dir
mkdir -p evals/skills/v<VER> && cp skills/vela-slides/SKILL.md evals/skills/v<VER>/

# Run eval (n=1 quick, n=3+ for stats)
REPS=1 MODEL=sonnet TIMEOUT=300 bash evals/run-isolated.sh <version>

# Compare results
python3 evals/scripts/report.py evals/results/
```

## Running the app live in a browser (offline / demo videos / visual QA)

> **Pick the right tool first.** Doing a **one-off / interactive** thing — explore
> the app, screenshot a state, reproduce a bug, verify a UX change, poke a selector,
> drive presenter/gallery? → **Playwright CLI** (skill **`playwright-cli-setup`**, see
> next section). The `vela-drive.js` commands below are **code-based scripts for
> REPEATABLE, committed automation only** (CI, the interaction benchmark, recorded
> demo videos) — reach for them when the harness itself is the deliverable, not for
> ad-hoc exploration. When in doubt for a manual task, use the CLI.

The remote container **blocks the React/lucide CDNs (esm.sh) and the Playwright
browser CDN**, so `serve.py`'s default importmap HTML never boots here. Do NOT
try to reach esm.sh or run `npx playwright install`. Both paths use the offline
render (skill: **`vela-live-render`**) which reuses the Neutralino shell's
vendored-UMD recipe (Node-transpiled external script). The committed `vela-drive.js`
scripts (repeatable automation only):

```bash
python3 tools/vela-dev/scripts/concat.py                                   # after editing parts
node tools/vela-dev/scripts/render-offline.js <deck.vela> /tmp/vout        # build offline render
node tools/vela-dev/scripts/vela-drive.js shot     /tmp/vout/render.html /tmp/s.png   # screenshot
node tools/vela-dev/scripts/vela-drive.js uitests  /tmp/vout/render.html --json /tmp/ui.json  # run UI battery headless
node tools/vela-dev/scripts/vela-drive.js video    /tmp/vout/render.html /tmp/vid --script scenario.js  # demo video
node tools/vela-dev/scripts/vela-drive.js ai       examples/vela-demo.vela --json /tmp/ai.json         # test AI vs local `claude` CLI
```

**AI integration testing:** the `ai` mode drives real Vera/AI features against
the local `claude` CLI. It starts `agent_backend.py` — a loopback channel that
spawns `claude -p` locked to a pure text completion (`--tools "" --strict-mcp-config
--setting-sources ""`: no tools, MCP, or hooks) — builds an agent-mode render,
and asserts deck mutations. That lockdown is the security contract shared with
the Neutralino gatekeeper (`vela-neutralino/extensions/agent/main.go`), enforced
by a parity test in `tests/test_serve.py`. **AI is OFF by default** — it spawns
the user's `claude` (their credentials/spend), so it is strictly opt-in:
`python3 tools/vela-dev/scripts/serve.py <folder> --ai` (loopback-only,
token-gated), or the `ai` harness mode / `render-offline.js --channel-port …`
for dev/testing.

Key facts: Chromium is pinned at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
(newer than npm playwright expects); ffmpeg at `/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux`;
`npm i jsdom` once for the two Node security suites; `ERR_INVALID_URL`/`ERR_CONNECTION_CLOSED`
console errors are harmless font fetches. In-app UI battery is invokable headless via
`window.__velaRunUITests()`. Never inline the 1.3MB monolith as `text/babel` (its XSS-test
strings contain `</script>` and truncate the block) — the harness loads an external `app.js`.

## Ad-hoc testing & exploration: use the Playwright CLI, not throwaway code files

For **ad-hoc / exploratory** browser work — poking a state, reproducing a bug,
checking a selector, driving presenter/gallery flows, taking a quick screenshot —
drive the app with the **Playwright CLI** (`@playwright/cli`, skill:
**`playwright-cli-setup`**) rather than writing a one-off Playwright `.js` file. The
CLI keeps a persistent browser session (`-s=<name>`) and you run one command at a
time (`open`, `snapshot`, `click e15`, `press ArrowRight`, `eval "…"`), **inspecting
page state and command output between every step** — so you reason and adapt in real
time instead of running a script blind and re-editing it whenever a step fails.
`window` globals persist across calls, and output goes to `.playwright-cli/`
(gitignored) so nothing bloats the conversation. Reserve written `.js` harnesses
(`vela-drive.js`, etc.) for **repeatable, committed** automation (CI, the interaction
benchmark). Supply-chain note: `@playwright/cli` is installed **isolated and
script-blocked, never committed** to `package-lock.json` (it pulls a fresh alpha
`playwright`) — see the `playwright-cli-setup` skill.

## License

ELv2 (source-available, commercial use allowed for presentations)
