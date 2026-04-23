# Vela Desktop — Architecture

## Overview

Vela Desktop packages the Vela Slides presentation engine as a standalone desktop application using [Tauri v2](https://v2.tauri.app/). It provides:

1. **Native file handling** — open `.vela` files by double-clicking
2. **Local AI agents** — use any CLI or HTTP-based AI without API keys
3. **Native experience** — small binary, fast startup, OS integration

## Core Design: Agent Adapter Pattern

### The Universal Contract

Every AI call in Vela flows through `callClaudeAPI(systemPrompt, messages, opts)`. In the desktop app, this function calls the Tauri backend via IPC, which routes to the active agent adapter.

```
Frontend                          Rust Backend
─────────                         ────────────
callClaudeAPI()                   
  → invoke('agent_complete')  ──→ commands::agent_complete()
                                    → settings::load() // which agent?
                                    → adapter.complete(system, msgs, opts)
                                    ← CompletionResponse {ok, reply, error}
  ← {ok, reply}               ←──
```

### Agent Adapter Trait

```rust
trait AgentAdapter: Send + Sync {
    fn name(&self) -> &str;
    fn is_available(&self) -> bool;
    async fn health_check(&self) -> Result<String, AgentError>;
    async fn complete(
        &self,
        system: &str,
        messages: Vec<Message>,
        opts: CompletionOpts,
    ) -> Result<String, AgentError>;
}
```

### Adapter Types

| Adapter | Implementation | When Used |
|---------|---------------|-----------|
| `CliAdapter` | Spawns subprocess, captures stdout | Claude Code, Aider, custom CLIs |
| `HttpAdapter` | HTTP POST to API endpoint | Ollama, OpenAI-compatible servers |
| `McpAdapter` | HTTP POST to channel server | Existing vela-channel.ts bridge |

### Agent Discovery

On startup and every 30 seconds, the discovery service checks:

1. **PATH** for known CLIs (`claude`, `aider`)
2. **Known ports** for services (11434 for Ollama, 8787 for channel)
3. Emits `agents-changed` Tauri event when the set changes

### CLI `-p` Mode

Any agent CLI with a "print" mode (non-interactive) can be wrapped:

```
[System]
You are a presentation expert.

[User]
Add a slide about AI trends.
```

The adapter builds this prompt, spawns the process, and captures its output.

## File Management

### Storage

Replaces `window.storage` (Claude.ai artifact API) with local files:

- Location: `~/.vela/storage/`
- One JSON file per key (key sanitized to safe filename)
- Tauri IPC: `storage_get`, `storage_set`, `storage_delete`

### File Handler

- **Open**: Read `.vela` file → validate JSON → return to frontend
- **Save**: Write to `.tmp` → atomic rename → prevents corruption
- **Recent files**: Track in `~/.vela/recent.json` (max 20 entries)
- **File watcher**: Planned — detect external changes

### Settings

Stored in `~/.vela/config.json`:

```json
{
  "agent": {
    "agent_type": "auto",     // auto, claude-cli, ollama, mcp-channel, custom
    "model": "llama3",        // for HTTP-based agents
    "port": 11434             // for HTTP-based agents
  },
  "theme": "dark",
  "window_state": { "width": 1280, "height": 800 }
}
```

## Frontend Integration

### Desktop Bridge

`src/desktop-bridge.js` runs before the Vela React app mounts. It:

1. Provides `window.storage` polyfill via Tauri IPC
2. Listens for `file-opened` events from OS
3. Exposes `window.__velaDesktop` API for agent management
4. Dispatches `vela-agents-changed` DOM events

### Minimal Frontend Changes

The existing React app (`vela.jsx`) requires almost no changes because:

- `callClaudeAPI()` already supports channel mode
- The desktop bridge provides the same `window.storage` contract
- Agent status UI is additive (new component, no existing code changed)

## Build Pipeline

```
concat.py (parts → vela.jsx)
    ↓
Vite (bundle → dist/)
    ↓
Tauri (package → .deb/.dmg/.exe)
```

### Development

```bash
cargo tauri dev   # Starts Vite dev server + Tauri app
```

### Production

```bash
cargo tauri build  # Full optimized build
```

## Design Decisions

1. **Tauri v2 over Electron** — 15MB vs 200MB+; Vela has no Node.js runtime dependencies
2. **Agent adapter pattern** — future-proof; new agent = ~100 lines of Rust
3. **CLI `-p` mode** — universal fallback for any text-in/text-out agent
4. **Separate `vela-desktop/` directory** — doesn't pollute existing skill/app structure
5. **Frontend nearly untouched** — only additions are desktop bridge and agent UI
