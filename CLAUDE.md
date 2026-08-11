# Vela Slides — CLAUDE.md

## What is Vela?

AI-native presentation engine for Claude.ai. Single-file React app (~1.3MB, 18,421 lines) that runs inside Claude.ai artifacts. Users describe slides in conversation, Vela renders them with 27 semantic block types.

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

**`src/parts/MANIFEST.txt` is the single source of truth** for the part list, the
build order, and each part's purpose — `concat.py`, `lint.py` and
`tests/test_vela.py` all read it, none keeps its own copy. Order is TDZ-sensitive
(one shared scope, no modules): never reorder it. Add a new part there in the
same change, or the lint fails.

```
imports → icons → blocks → reducer → engine → slides → list → chat → test → uitest → demo → pdf → pptx → app
```

Read `src/parts/MANIFEST.txt` for the per-part purpose line. For a size/section
map of any part (banner sections with line, byte and token counts — how to find
a region inside a big file without reading it all):

```bash
python3 tools/vela-dev/scripts/partsize.py part-slides.jsx   # sections of one part
python3 tools/vela-dev/scripts/partsize.py --totals-only     # every part, summary
```

## Where does X live

Open the named file(s) FIRST and grep the named symbol — don't scan the tree.
Every row below was verified against the code (CI-enforced by `check-routing.py`);
if you find one wrong, fix the row in the same change. Line numbers are
deliberately omitted (they rot) — grep the symbol, or use `partsize.py` for the
section map.

**Read sections, not files.** Most changes fit inside one banner section. Grep
the symbol for its line, or run `partsize.py <part>` for the section map, then
Read just that range (offset/limit) — only fall back to whole-file reads for
files under ~300 lines.

| Change | Open first | Grep for |
|---|---|---|
| Add / change a **block renderer** (new block type, block layout) | `src/parts/part-blocks.jsx` | `RenderBlock` — the `switch (block.type)`; new-item defaults `newItemFor` / `blankItemFor` / `PLACEHOLDER_FIELDS`. A new deck field also needs `SAFE_BLOCK_KEYS`, `skills/vela-slides/scripts/validate.py` and `references/block-schema.md` |
| **Sanitization / allowlists / a new slide or block field** | `src/parts/part-imports.jsx` | `SAFE_SLIDE_KEYS`, `SAFE_BLOCK_KEYS`, `sanitizeBlock`, `sanitizeSlide`, `validateAndSanitizeDeck`, `cssColor` / `cssGradient` / `cssUrl`, `sanitizeStyle`; storage-reload path `resanitizeLoadedLanes` / `resanitizeLoadedBranding`. Read `.claude/skills/vela-secure-coding/SKILL.md` first |
| **Slide chrome** — accent bar, footer, slide numbers, logo | `src/parts/part-branding.jsx` | `BrandingOverlay` (renders accent bar, footer strip, `NN / NN` slide number, logo) |
| **Slide background / slide palette** | `src/parts/part-canvas.jsx`, `src/parts/part-slides.jsx` (thumbnails) | `bgStyle` in `SlideContent` (`slide.bg` / `bgGradient` / `bgImage`); thumbnail/fullscreen bg in `VirtualSlide`. App-chrome tokens are `themes` / `T` in `part-imports.jsx` — a different thing from deck palettes |
| **Branding settings UI** | `src/parts/part-slides.jsx` | `BrandingPanel`; defaults `defaultBranding` and re-scrub in `part-imports.jsx`, action `SET_BRANDING` in `part-reducer.jsx` |
| **Lane / module / slide list (TOC)**, incl. per-row action controls | `src/parts/part-list.jsx` | `ModuleList` → `ConceptRow` (module row: collapse caret, ▲/▼ move glyphs, `REORDER`) → `SlideListWithAdder` (slide rows); menus `ContextMenu` / `CtxItem` / `AddMenu`; inline AI add `AiSlideAdder` |
| **TOC drag & drop** | `src/parts/part-list.jsx` | `handleSlideDragStart` / `handleSlideDrop` / `handleContainerDrop`, module-level `_velaDrag` |
| **Block toolbar & in-slide editing UX** | `src/parts/part-canvas.jsx` | `renderBlockItem` (per-block hover toolbar + block AI-prompt popup) inside `SlideContent`; inline text `EditableText`/`ItemChrome` stay in `part-blocks.jsx`. The AI driver `runBlockEdit` lives in `part-slides.jsx` |
| **Fullscreen / presenter / gallery** | `src/parts/part-slides.jsx` | `SlidePanel` (arrow/space nav, wheel nav, Fullscreen-API sync), `PresenterView`, Presenter TOC, Gallery View, `StudentPanel`; state via `SET_FULLSCREEN` in `part-reducer.jsx` |
| **PDF export** | `src/parts/part-pdf.jsx` | vector path `buildVectorPdf` + its export modal; canvas path `PdfExportModal` / `buildPdfFromImages`; every string through `pdfStringEncode`; DOM extraction `extractBoxes` / `extractCircles` / `extractLinks` |
| **PPTX export** | `src/parts/part-pptx.jsx` | `buildPptx`, `pptxEsc`, `pptxExtractTextBoxes` (reuses part-pdf's extractors); the modal `PptxExportModal` is in `part-app.jsx` |
| **Markdown export** | `src/parts/part-pdf.jsx` | `deckToMarkdown`, encoders `mdInline` / `mdCell` / `escGap`. Standalone-HTML export sits in the same file (its own section) |
| **Vera AI engine tools** | `src/parts/part-engine.jsx` | `executeTool` — the `switch (name)` — AND the tool contract prose inside the system prompt in the same file. Both must change together or the model calls a tool that doesn't exist |
| **Chat panel / tool traces** | `src/parts/part-chat.jsx` | `ChatPanel`, `ToolTraceCard`, `TOOL_META` (per-tool label/icon), `ChatMarkdown` |
| **Reducer action / undo-redo** | `src/parts/part-reducer.jsx` | `innerReducer` (the action switch), `NO_HISTORY` (actions that must NOT create an undo step), `reducer` (history wrapper), `MAX_HISTORY` |
| **Keyboard shortcuts & modals** | `src/parts/part-app.jsx` | global `window.addEventListener("keydown", …)` in `VelaApp` (undo/redo, `?`, `r`); the user-visible list is `ShortcutHelp`; modals `ModalBackdrop`, `NewDeckDialog`, `StatsDialog`, `ChangelogDialog`, `MergePatchDialog`. In-slide/presenter keys live in `part-slides.jsx` |
| **UI test battery** | `src/parts/part-uitest.jsx` | `uiSuite("<name>", [...])` to add a suite, `runUITests`, headless entry `window.__velaRunUITests` (dev builds only — keep new hooks inside a `VELA:DEV-ONLY` fence) |
| **Storage / persistence** | `src/parts/part-app.jsx` | the `Storage: Load` and `Storage: Save` effects (debounced, `extractSave`); `saveKV` / `MASTER_KEY` (`"vela-deck"`) in `part-imports.jsx`; startup-patch merge in the same load effect |

## Deck Format

Virtual canvas **960×540px** (16:9). Deck JSON has three interchangeable
formats — Full (named keys), Compact (~32% smaller), Turbo (~47% smaller,
positional) — auto-expanded on load. 27 block types across text, lists, data,
flow, media, and layout groups.
**Reference (read on demand, do not memorize here):**
`skills/vela-slides/references/formats.md` (formats + key maps),
`references/block-schema.md` (per-block fields), `references/themes.md`.

## CLI — `vela.py`

```bash
vela deck list|validate|split|dump|stats|find|extract-text|patch-text|replace-text|compact|expand|turbo|ship|assemble
vela slide view|edit|remove|move|duplicate|insert|remove-block
```
Author→ship only (the shipped skill has no preview/AI backend — that lives in
`tools/vela-dev/`). Exit codes: 0 ok, 1 fail, 2 usage, 3 not-found,
4 validation, 5 conflict. Supports `--json` and `--dry-run`.

## Mandatory: Run CI Checks After Every Change

```bash
# 1. Run full test suite (361 tests)
python3 tests/test_vela.py

# 2. Verify template is in sync with parts
python3 tools/vela-dev/scripts/concat.py
```

All checks must pass before committing.

## Minimal-diff policy

Make the smallest change that fully solves the request. No drive-by
refactors, renames, restructures, or adjacent fixes in the same change; no
speculative polish. If you found something else worth fixing, note it for a
separate change instead of bundling it. (Measured: unscoped changes cost
~10% more agent time/tokens and are harder to review.)

## Mandatory: Read the secure-coding skill before writing or reviewing code

**Before writing, changing, or reviewing ANY code in this repo — feature work,
bug fixes, refactors, exports, tooling, code reviews, security reviews —
read `.claude/skills/vela-secure-coding/SKILL.md`.**
Vela renders untrusted deck JSON in runtimes with real filesystem and network
capability, and nearly every vulnerability in this repo's history came from
ordinary feature code, not from work labelled "security". Start with the
skill's **Triage** section: it defines when its §0 essentials plus the helper
table suffice (static app-chrome/editor-UI changes) and when the full read is
mandatory (anything touching deck values, sanitizers, exporters, server or
native code). When in doubt, full read.

## Dependency bumps — start with the sweeper, not by hand

Use the **`dependency-sweep`** skill — it drives
`tools/vela-dev/scripts/dep-sweep.py` (deterministic discovery/cooldown/
provenance/audit checks, exit 4 = high/critical finding) and owns the
judgement calls. Not wired into CI by design.

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

`DOCKER_BUILDKIT=1 docker build -f vela-neutralino/Dockerfile -o type=local,dest=vela-neutralino/dist .`
(context = repo root; one Linux build emits win/linux/mac; output gitignored —
never commit binaries; CI does not use Docker). Details: `vela-neutralino/`
and its `SECURITY.md`.

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
    MANIFEST.txt         ← build order + per-part purpose (single source of truth)
tools/vela-dev/          ← DEV/TEST/CI TOOLCHAIN (never shipped)
  local.html             ← local-preview shell
  scripts/               ← concat.py, parts_manifest.py, partsize.py, serve.py,
                            agent_backend.py, render-offline.js, vela-drive.js,
                            lint.py, sync-skill-docs.py, dep-sweep.py
  channel/               ← Node/pnpm MCP bridge
  evals/, references/    ← evals.json, app-editing.md
examples/                ← vela-demo.vela, themed example decks
decks/                   ← working deck files (gitignored)
docs/                    ← ARCHITECTURE.md, SECURITY.md, SCREENSHOTS.md (visual testing runbook)
evals/                   ← skill version benchmarking (see docs/EVAL-RUNBOOK.md)
tests/                   ← test_vela.py, test_serve.py
```

## AI Features (Vera Engine)

Direct HTTP to the Anthropic API via the artifact proxy (no client key).
ReAct loop, 22 tools, model `claude-sonnet-4-20250514`, temp 0, 16K max
tokens, session cost tracking. All in `src/parts/part-engine.jsx`.

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

Skill-version benchmarking lives in `evals/` — read **`docs/EVAL-RUNBOOK.md`**
for the full workflow (A/B runs, blind judging, analysis) instead of
re-exploring `evals/` each time.

## Running the app live in a browser (offline / demo videos / visual QA)

The container blocks the React/lucide CDNs and Playwright downloads — never
fetch esm.sh or run `npx playwright install`. Chromium is pinned at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, ffmpeg at
`/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux`.
- **One-off / interactive** work (explore, screenshot, reproduce, verify UX):
  use the **`playwright-cli-setup`** skill (persistent CLI browser, one
  command at a time). Default choice for manual tasks.
- **Repeatable, committed automation** (CI, benchmark, demo videos, headless
  UI battery, opt-in AI harness): use the **`vela-live-render`** skill
  (`render-offline.js` + `vela-drive.js`). AI mode is strictly opt-in — it
  spawns the user's `claude` under the lockdown flags shared with the
  Neutralino gatekeeper (parity-tested in `tests/test_serve.py`).
- Browser-truth security checks (does a payload actually fire?): skill
  **`vela-browser-test`**.

## Ad-hoc testing & exploration: use the Playwright CLI, not throwaway code files

Covered by the `playwright-cli-setup` skill (see section above): persistent
session, inspect between steps, output under `.playwright-cli/` (gitignored).
Never install `@playwright/cli` into `package-lock.json` — isolated and
script-blocked only.

## License

ELv2 (source-available, commercial use allowed for presentations)
