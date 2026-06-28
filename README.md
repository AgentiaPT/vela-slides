<div align="center">

# ⛵ Vela Slides **(Alpha/Experimental)**

**Agent-native presentation engine — runs in any AI artifact host or as a desktop app driven by your local coding-agent CLI**

Create, edit, and present beautiful slide decks — entirely through conversation with the AI agent of your choice.

[![License: ELv2](https://img.shields.io/badge/License-ELv2-blue.svg)](LICENSE)
[![Agent-native](https://img.shields.io/badge/Runtime-Agent--native-orange.svg)](#how-it-works)
[![Skill](https://img.shields.io/badge/Format-Claude%20Skill-purple.svg)](#1-use-as-a-claudeai-skill)
[![Desktop](https://img.shields.io/badge/Desktop-Linux%20%7C%20macOS%20%7C%20Windows-2ea44f.svg)](#3-run-as-a-desktop-app)

[Get Started](#get-started) · [Features](#features) · [Desktop App](#3-run-as-a-desktop-app) · [Examples](#examples) · [Architecture](docs/ARCHITECTURE.md) · [Dependencies](docs/DEPENDENCIES.md)

</div>

### :warning: This project is 100% vibe coded

> **No human has reviewed the source code.**
>
> Every line of Vela — 14,000+ lines of JSX, Python CLI tools, and build scripts — was generated entirely by AI (Claude). The codebase is validated by extensive AI code reviews, 270+ automated tests, and static analysis, but no human has ever read or audited the code.
>
> **You are responsible for your own review before using this in any production or sensitive context.**
>
> Found something? We have a [security bounty program](docs/SECURITY.md#security-bounty-program).

---

![Vela Slides Screenshot](docs/screenshot.png)

## Get Started

| | Approach | Best for |
|---|----------|----------|
| **Try instantly** | **[▶ Browse the gallery](https://agentiapt.github.io/vela-slides/)** | View sample decks in any browser — no account needed |
| | **[▶ Open the live demo](https://claude.ai/public/artifacts/327281d4-4331-4ff8-bdbf-a436b698fe73)** | Interactive artifact on Claude.ai with Vera AI assistant |
| **Set up for creation** | **[Upload as a Claude.ai skill](#1-use-as-a-claudeai-skill)** | Generate decks from conversation on Claude.ai |
| | **[Run locally with a coding-agent CLI](#2-run-locally-with-a-coding-agent-cli)** | Full CLI, live preview, file system access — works with any agent that can run shell commands |
| | **[Install the desktop app](#3-run-as-a-desktop-app)** | Native window on Linux/macOS/Windows; Vera routes to your local coding-agent CLI |

> The Claude.ai artifact runs entirely in your browser. AI features (Vera chat, batch edit) use your Claude.ai subscription. Vela has no backend and no access to your data. Requires **Settings → Feature Preview → AI-powered artifacts** enabled.

### 1. Use as a Claude.ai Skill

Upload the skill so Claude generates Vela decks from your descriptions:

1. Download **[`vela-slides-skill-v*.zip`](https://github.com/AgentiaPT/vela-slides/releases/latest)** from the latest release (or build a fresh one: `python3 skills/vela-slides/scripts/vela.py deck zip`)
2. In Claude.ai → **Customize → Skills → "+" → Upload a skill** → upload the ZIP
3. Start a conversation: *"Create a 10-slide deck about the future of AI agents"*

Claude will generate structured slide JSON, assemble it into the Vela engine, and output an interactive artifact.

### 2. Run Locally with a Coding-Agent CLI

Full CLI access, live browser preview, file system integration:

```bash
git clone https://github.com/AgentiaPT/vela-slides.git
cd vela-slides
python3 skills/vela-slides/scripts/vela.py server start examples/
# → Opens browser at localhost:3030 with deck browser and live editing
```

The `vela` CLI is plain Python with structured JSON I/O — any coding-agent CLI that can run shell commands can drive it (Claude Code, GitHub Copilot CLI, Codex CLI, Aider, Cursor's terminal agent, custom agents, etc.). Agents that load the bundled SKILL.md gain Vela's deck conventions and can generate, edit, translate, and rebrand decks while saving 80-97% of tokens vs manual JSON editing. SKILL.md follows the [Claude Skills](https://www.anthropic.com/news/claude-skills) format but is just markdown — drop it into any agent's prompt or system context.

**Channel bridge** (experimental): Connect the browser UI to your coding-agent CLI for click-to-edit workflows. See [`skills/vela-slides/channel/README.md`](skills/vela-slides/channel/README.md).

### 3. Run as a Desktop App

Vela also ships as a native desktop window built on [Neutralino.js](https://neutralino.js.org/). The shell wraps the same Vela engine and replaces the artifact's hosted LLM with a bridge to your **locally-installed coding-agent CLI** — so Vera's edits, batch ops, and chat all run on your machine via that agent's print/headless mode.

**Today**: ships with a [Claude Code](https://docs.claude.com/en/docs/claude-code) adapter (`claude -p`). The backend layer is pluggable — adapters for GitHub Copilot CLI, Codex CLI, and others are tracked on the roadmap; contributions welcome. See [`vela-neutralino/resources/js/agents-bridge.js`](vela-neutralino/resources/js/agents-bridge.js) for the adapter contract.

Download the matching binary from the **[latest release](https://github.com/AgentiaPT/vela-slides/releases/latest)**:

| Platform | Asset |
|---|---|
| Linux x64 | `vela-desktop-v*-linux_x64.zip` |
| Linux arm64 | `vela-desktop-v*-linux_arm64.zip` |
| macOS Intel | `vela-desktop-v*-mac_x64.zip` |
| macOS Apple Silicon | `vela-desktop-v*-mac_arm64.zip` |
| macOS universal | `vela-desktop-v*-mac_universal.zip` |
| Windows x64 | `vela-desktop-v*-win_x64.zip` |

Unzip, then launch the `vela-*` binary alongside the bundled `resources.neu`. On first AI action per deck, the shell prompts for consent and stores trust under `<deck-folder>/.vela/trust.json`. Windows builds rely on the system [WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (shipped on Windows 10 1809+ and Windows 11).

> Desktop builds are **unsigned preview binaries** — macOS Gatekeeper and Windows SmartScreen will warn on first launch. Source and build scripts: [`vela-neutralino/`](vela-neutralino/).

---

## What is Vela?

Vela is an **agent-native** presentation engine. Decks are described in conversation with whatever AI agent you already use; Vela handles the structure, layout, and rendering. The same React application runs in three places — Claude.ai artifacts, a local browser server driven by a coding-agent CLI, or a native desktop window — and Vera (the in-app AI assistant) routes to whichever AI backend is available in that runtime.

```
You: "Create a 10-slide deck on the future of AI agents"
Agent: ⛵ Generates structured slides with diagrams, metrics, flows, and timelines
```

The result is a **fully interactive React application** — complete with presenter mode, PDF export, dark/light themes, drag-and-drop reordering, and a built-in AI chat for iterating on your slides.

### Why Vela?

| Traditional slides | Vela |
|---|---|
| Click. Drag. Format. Repeat. | Describe what you want. Get it. |
| One block type: text box | 27 semantic block types (flows, grids, metrics, timelines, matrices, funnels, SVG diagrams...) |
| Static once created | Built-in AI assistant for live iteration |
| Separate design step | Design patterns baked in — every slide looks considered |
| Export to PDF requires plugins | Vector PDF export built in |

---

## How It Works

Vela ships as a **skill** — a structured prompt + reference architecture (markdown + JSON schemas + a Python CLI) that teaches an AI agent how to generate Vela-compatible decks and assemble them into runnable apps. The skill format follows the [Claude Skills](https://www.anthropic.com/news/claude-skills) spec but the content is plain markdown and a deterministic CLI, so any agent runtime can consume it.

```
┌──────────────────────────────────────────────────┐
│  You describe your presentation to your agent    │
│  ↓                                               │
│  Agent generates structured slide JSON            │
│  ↓                                               │
│  Assembly script injects JSON into Vela engine    │
│  ↓                                               │
│  You get a runnable app — artifact, browser, or  │
│  desktop window — with live AI iteration         │
└──────────────────────────────────────────────────┘
```

The Vela engine is a **14,000+ line React application**. The same engine renders in three runtimes — Claude.ai's artifact sandbox, a local browser server, and the Neutralino desktop window — with Vera transparently routed to whichever AI backend is available (artifact proxy, channel bridge to a local coding-agent CLI, or the desktop's bundled adapter). No servers, no deploys, no accounts; your data stays where you put it.

---

## Features

### 27 Semantic Block Types
Headings, bullets, flows, grids, metrics, timelines, steps, tables, callouts, quotes, SVG diagrams, icon rows, tag groups, progress bars, badges, images, code blocks — plus comparison (A vs B), funnel, cycle, number-row, 2×2 matrix, and status-aware checklist. Each with semantic properties, not just text boxes. Two-column layouts via `cols` (left/right block arrays).

### Vera — Built-in AI Assistant
An agentic AI chat panel inside the slide engine. Vera can search your deck, batch-edit across slides, restyle sections, add slides from descriptions, and improve designs — all through conversation. Vera is **backend-agnostic**: in Claude.ai it uses the artifact proxy; in the desktop app it routes to a locally-installed coding-agent CLI via a pluggable adapter (Claude Code shipping today, more adapters planned); the experimental channel bridge connects the browser UI to whichever coding agent is driving your terminal session.

### Offline Study Notes
Slides can embed pre-authored markdown, an inline SVG diagram, follow-up questions, and a glossary for Kindle X-Ray-style popups. Renders with zero API calls; when a live AI backend is available, authored questions become clickable Vera prompts.

### Interactive Block Affordances
Code blocks ship with a one-click copy button. Callouts can be set to `reveal: true` to start collapsed and expand on click — useful for spoiler-friendly walk-throughs.

### `.vela` File Extension
Decks use the `.vela` extension — a standard JSON file with a dedicated identity. All CLI tools, the local server, and imports recognize both `.vela` and `.json`.

### Presenter Mode
Fullscreen presentation with arrow keys (Up/Down/Left/Right), Space, and Escape — PowerPoint-style navigation across slides and modules. Designed for 16:9 projection.

### Vector PDF Export
Canvas-rendered PDF output with clickable links, branding overlays, and watermarks. Every slide exports as a crisp vector page.

### Dark & Light Themes
Full dark/light mode with 7+ theme directions (midnight, warm, editorial, minimal, vibrant). Themes propagate to all block types including SVG diagrams via token injection.

### Persistent Storage
Decks save across sessions automatically — to Claude.ai's artifact storage API in the artifact runtime, and to the local filesystem in the server and desktop runtimes. No manual export needed to keep your work.

### WYSIWYG Editing
Click any text on a slide to edit it inline. Supports bold, italic, and markdown formatting.

### Drag & Drop
Reorder slides and modules by dragging. Reorganize your deck structure without leaving the app.

---

## Examples

### Generate a deck from a topic

```
Create a 12-slide presentation on "The Rise of Agentic AI"
with sections: Introduction, Core Patterns, Architecture, Case Studies, Future
```

### Import and iterate

```
Here's my existing deck JSON. Can you:
1. Add a new section on "Security Considerations"
2. Restyle all slides to use a midnight blue theme
3. Make sure every slide has timing estimates
```

### Use Vera inside the artifact

Once a Vela artifact is running, click the Vera button to open the chat panel. You can ask Vera to modify slides, search content, batch-edit, or generate new slides — all without leaving the artifact.

### Live Demo

Try the self-demonstrating deck — slides that showcase every block type, with Vera ready for hands-on editing:

**[▶ Open Vela Slides v12 Live Demo](https://claude.ai/public/artifacts/327281d4-4331-4ff8-bdbf-a436b698fe73)** · [`skills/vela-slides/examples/vela-demo.vela`](skills/vela-slides/examples/vela-demo.vela)

See [`examples/`](examples/) for themed sample decks (startup pitch, tech talk, course, business report).

---

## Repository Structure

```
vela-slides/
├── skills/
│   └── vela-slides/          ← Installable skill folder (ZIP for Claude.ai)
│       ├── SKILL.md           ← Skill prompt + workflows
│       ├── app/
│       │   ├── parts/         ← Modular source (13 part-files)
│       │   └── vela.jsx ← Assembled monolith (auto-generated)
│       ├── scripts/
│       │   ├── vela.py        ← CLI: deck/slide operations + zip
│       │   ├── assemble.py    ← Inject deck JSON → final .jsx
│       │   ├── concat.py      ← Parts → monolith builder
│       │   ├── validate.py    ← Deck JSON quality checks
│       │   ├── serve.py       ← Local dev server with live reload
│       │   ├── lint.py        ← Code linting checks
│       │   └── sync-skill-docs.py ← Sync CLI reference into SKILL.md
│       ├── references/        ← Block schema, design patterns, themes, formats
│       ├── examples/          ← vela-demo.vela (bundled demo deck)
│       └── evals/             ← Skill quality test cases
├── vela-neutralino/           ← Desktop app shell (Neutralino.js + pluggable coding-agent bridge)
│   ├── neutralino.config.json
│   ├── resources/             ← index.html, vela.jsx (synced from skills/), vendored deps
│   └── scripts/               ← setup.sh, run.sh, build.sh, sync-vela.py
├── docs/
│   ├── ARCHITECTURE.md        ← Technical deep dive
│   └── SECURITY.md            ← Security model + audit
├── examples/
│   ├── vela-demo.vela         ← Demo deck
│   └── *.vela                 ← Themed example decks
├── evals/                     ← Version benchmarking infrastructure
├── tests/
│   ├── test_vela.py           ← Core engine tests (198 tests)
│   └── test_serve.py          ← Server endpoint & security tests (72 tests)
├── LICENSE                    ← Elastic License v2
├── CONTRIBUTING.md
└── README.md
```

---

## Security

Vela's artifact runtime is fully sandboxed inside Claude.ai; the local server and desktop runtimes apply additional defenses (CSP, native API allowlists, per-deck AI trust gate). See [docs/SECURITY.md](docs/SECURITY.md) for the full security model, including:

- SVG sanitization (defense-in-depth against XSS)
- Import validation and block-type whitelisting
- Content-length limits on all string inputs
- Stored XSS prevention in the local development server
- Supply chain security: `ignore-scripts`, 7-day release cooldown, lockfile integrity (SHA-512)
- No credentials or secrets in the codebase

Found something? We have a [security bounty program](docs/SECURITY.md#security-bounty-program).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. The modular part-file architecture makes it straightforward to contribute to specific subsystems without touching the entire codebase.

---

## License & Commercial Use

Vela Slides is source-available under the [Elastic License 2.0 (ELv2)](LICENSE) — © Rui Quintino.

**You can freely use Vela to create, present, and export slide decks for any purpose — personal, commercial, client work, workshops, conferences.** Your content is yours. No attribution required on your decks.

ELv2 restricts three things: offering Vela itself as a hosted service, removing or obscuring the Vela Slides branding, and removing the copyright notice (© Rui Quintino). These must remain visible in the software.

**Enterprise & White-Label Licensing** — If you want to embed Vela into your own product, rebrand it, or need IP indemnification, reach out: info@agentia.pt

---

<div align="center">

**Built for the agent-native era**

*Vela is Latin for "sail" — because presentations should carry your ideas forward.*

⛵

</div>
