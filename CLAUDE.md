# Vela Slides — CLAUDE.md

## What is Vela?

AI-native presentation engine for Claude.ai. Single-file React app (~963KB, 12,650 lines) that runs inside Claude.ai artifacts. Users describe slides in conversation, Vela renders them with 21 semantic block types.

## Architecture

```
Source (13 part-files)  →  concat.py  →  vela.jsx  →  assemble.py  →  final.jsx
     ↑ edit these                         ↑ monolith                  ↑ with deck data
```

**No bundler.** Python stdlib concatenation in fixed dependency order (~10ms).

### Part-File Order (fixed, never changes)
```
imports → icons → blocks → reducer → engine → slides → list → chat → test → uitest → demo → pdf → app
```

### Key Parts
| Part | Purpose |
|------|---------|
| `part-imports.jsx` | Constants, sanitizers, helpers, storage API, startup patch system |
| `part-icons.jsx` | 270+ Lucide icon resolver |
| `part-blocks.jsx` | 21 block renderers (heading, flow, grid, metric, timeline, etc.) |
| `part-reducer.jsx` | useReducer state + dispatch actions |
| `part-engine.jsx` | Vera AI engine — callClaudeAPI(), 20 tools, ReAct loop |
| `part-slides.jsx` | SlidePanel rendering, fullscreen, thumbnails |
| `part-list.jsx` | Lane/module list, drag-and-drop |
| `part-chat.jsx` | ChatPanel, tool traces |
| `part-test.jsx` | Battery render tests |
| `part-demo.jsx` | Cinematic demo mode (18 scenes) |
| `part-uitest.jsx` | 95 UI tests in 22 suites |
| `part-pdf.jsx` | Canvas PDF export, markdown export |
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

### Block Types (21)
Text: heading, text, quote, badge, callout
Lists: bullets, icon-row, tag-group
Data: grid, table, metric, progress, timeline
Flow: flow (gates & loops), steps
Media: image, code, svg
Layout: spacer, divider

## CLI — `vela.py`

```bash
vela deck list|validate|split|dump|stats|find|extract-text|patch-text|replace-text|compact|expand|turbo|ship|assemble
vela server start|stop
vela slide view|edit|remove|move|duplicate|insert|remove-block
```

Exit codes: 0=success, 1=fail, 2=usage, 3=not-found, 4=validation, 5=conflict.
Supports `--json` for structured output and `--dry-run` for previews.

## Mandatory: Run CI Checks After Every Change

```bash
# 1. Run full test suite (198 tests)
python3 tests/test_vela.py

# 2. Verify template is in sync with parts
python3 skills/vela-slides/scripts/concat.py
```

All checks must pass before committing.

## Build Commands

```bash
# Rebuild monolith from parts
python3 skills/vela-slides/scripts/concat.py

# Assemble with a deck
python3 skills/vela-slides/scripts/assemble.py examples/vela-demo.vela --from-parts

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
skills/vela-slides/
  app/parts/           ← 13 source part-files (edit these)
  app/vela.jsx ← auto-generated monolith
  scripts/             ← vela.py, concat.py, assemble.py, validate.py, serve.py, sync-skill-docs.py
  references/          ← block-schema.md, design-patterns.md, themes.md
  SKILL.md             ← skill prompt v12.24
examples/              ← vela-demo.vela, themed example decks
decks/                 ← working deck files (gitignored)
docs/                  ← ARCHITECTURE.md, SECURITY.md, SCREENSHOTS.md (visual testing runbook)
evals/                 ← skill version benchmarking (see docs/EVAL-RUNBOOK.md)
tests/                 ← test_vela.py (198 tests), test_serve.py (72 tests)
```

## AI Features (Vera Engine)

- Direct HTTP to Anthropic API from artifact (no client key — uses artifact proxy)
- ReAct loop with 20 tools (set_slides, edit_slide, add_slide, batch ops, etc.)
- Model: claude-sonnet-4-20250514, temp=0, max 16K tokens
- Session cost tracking built-in

## IMPORTANT: Version Bump Required for Skill Changes

**Any change to files under `skills/vela-slides/` MUST include a `VELA_VERSION` bump.** CI will block the PR otherwise.

- `VELA_VERSION` lives in `skills/vela-slides/app/parts/part-imports.jsx` (format: `major.minor`, e.g. `"10.2"` → `"10.3"`)
- Increment the minor version for each change. Bump major only for large rewrites.
- Also update `VELA_CHANGELOG` in the same file with a brief description of the change.
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

## License

ELv2 (source-available, commercial use allowed for presentations)
