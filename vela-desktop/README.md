# Vela Desktop

Standalone desktop app for [Vela Slides](https://github.com/AgentiaPT/vela-slides) — built with [Tauri v2](https://v2.tauri.app/).

## Features

- **Open `.vela` files** by double-clicking (file association on all platforms)
- **Local AI agents** — use Claude Code, Ollama, Aider, or any compatible CLI
- **Native experience** — fast startup, small binary (~15MB), auto-updates
- **Works offline** — rendering works without network; AI features need an agent

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| [Rust](https://rustup.rs) | 1.70+ | Tauri backend |
| [Node.js](https://nodejs.org) | 18+ | Frontend build (Vite) |
| Python | 3.8+ | Rebuild `vela.jsx` from parts |

### Linux system dependencies

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev \
  libsoup-3.0-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

### macOS

Xcode Command Line Tools required: `xcode-select --install`

## Quick Start

```bash
# 1. Install Tauri CLI
cargo install tauri-cli --version "^2"

# 2. Install frontend dependencies
cd vela-desktop && npm install

# 3. Rebuild vela.jsx monolith
python3 ../skills/vela-slides/scripts/concat.py

# 4. Run in development mode
cargo tauri dev
```

## Build for Distribution

```bash
# Full build (frontend + Tauri)
./build-vela.sh --tauri

# Or step by step:
python3 ../skills/vela-slides/scripts/concat.py  # Rebuild monolith
npm run build                                      # Vite frontend
cargo tauri build                                  # Native app
```

Build outputs:
- **Linux**: `.deb` and `.AppImage` in `src-tauri/target/release/bundle/`
- **macOS**: `.dmg` in `src-tauri/target/release/bundle/`
- **Windows**: `.exe` (NSIS installer) in `src-tauri/target/release/bundle/`

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Vela Desktop (Tauri v2)                                     │
│                                                              │
│  ┌──────────────────────────────┐                            │
│  │  React UI (vela.jsx → Vite)  │                            │
│  │  callClaudeAPI() → invoke()  │──── Tauri IPC ────┐        │
│  └──────────────────────────────┘                    │        │
│                                                      ▼        │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Agent Router (Rust backend)                         │    │
│  │                                                      │    │
│  │  Adapters:                                           │    │
│  │  ┌─────────────┐  ┌───────────────┐  ┌───────────┐  │    │
│  │  │ CLI          │  │ HTTP API      │  │ MCP       │  │    │
│  │  │ claude -p    │  │ Ollama        │  │ Channel   │  │    │
│  │  │ aider --msg  │  │ OpenAI-compat │  │ Bridge    │  │    │
│  │  └─────────────┘  └───────────────┘  └───────────┘  │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Native Services (Rust)                              │    │
│  │  - File I/O (open/save .vela, atomic writes)         │    │
│  │  - File associations (.vela → app)                   │    │
│  │  - Settings (~/.vela/config.json)                    │    │
│  │  - Storage (~/.vela/storage/)                        │    │
│  │  - Agent auto-discovery                              │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

## Agent Support

Vela Desktop auto-detects available AI agents on startup:

| Agent | Detection | How it works |
|-------|-----------|-------------|
| **Claude Code** | `claude` in PATH | `claude -p --output-format json "prompt"` |
| **Ollama** | Port 11434 open | HTTP API (`/api/chat`) |
| **Aider** | `aider` in PATH | `aider --message "prompt" --no-auto-commit` |
| **MCP Channel** | Port 8787 open | Existing `vela-channel.ts` protocol |
| **OpenAI-compat** | Manual config | Any `/v1/chat/completions` API |

### Adding a New Agent

1. Create a new adapter in `src-tauri/src/agent/` implementing `AgentAdapter`
2. Add detection logic in `discovery.rs`
3. Register the adapter type in `commands.rs`

## Configuration

Settings stored in `~/.vela/config.json`:

```json
{
  "agent": {
    "agent_type": "auto",
    "model": "llama3",
    "port": 11434
  },
  "theme": "dark",
  "window_state": { "width": 1280, "height": 800 }
}
```

## Testing

```bash
# Rust unit tests (29 tests)
cd src-tauri && cargo test

# Frontend build check
npm run build
```

## Project Structure

```
vela-desktop/
├── src-tauri/
│   ├── Cargo.toml                 # Rust dependencies
│   ├── tauri.conf.json            # App config, file associations, icons
│   ├── icons/                     # App icons (all platforms)
│   └── src/
│       ├── main.rs                # Entry point
│       ├── lib.rs                 # Module declarations, Tauri builder
│       ├── commands.rs            # Tauri IPC command handlers
│       ├── storage.rs             # Key-value storage backend
│       ├── settings.rs            # App settings persistence
│       ├── agent/
│       │   ├── mod.rs             # AgentAdapter trait + AgentRouter
│       │   ├── cli_adapter.rs     # CLI subprocess adapter
│       │   ├── http_adapter.rs    # HTTP API adapter (Ollama, OpenAI)
│       │   ├── mcp_adapter.rs     # MCP channel adapter
│       │   └── discovery.rs       # Auto-detect available agents
│       └── file/
│           ├── mod.rs
│           └── handler.rs         # Open/save .vela, recent files
├── src/
│   ├── main.jsx                   # React entry point
│   └── desktop-bridge.js          # Tauri IPC bridge for Vela
├── index.html                     # HTML shell with loading screen
├── vite.config.js                 # Vite configuration
├── package.json                   # Frontend dependencies
└── build-vela.sh                  # Full build script
```

## License

ELv2 — see [LICENSE](../LICENSE)
