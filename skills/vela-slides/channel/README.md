# Vela Channel — Browser ↔ Claude Code Bridge

Bridges the Vela browser UI to a running Claude Code session via the Channels API.

## How It Works

```
Browser [Click button] → POST :8787/action → Channel Server → Claude Code session
                                                              ↓
Browser [sees update]  ← long-poll :3030   ← file watcher   ← Claude edits deck
Browser [sees reply]   ← SSE :8787/events  ← reply tool     ← Claude responds
```

## Setup

```bash
# 1. Install deps (one-time)
cd skills/vela-slides/channel
npm install

# 2. Add to .mcp.json (project root)
# { "mcpServers": { "vela-channel": { "command": "npx", "args": ["tsx", "skills/vela-slides/channel/vela-channel.ts"] } } }

# 3. Start Claude Code with channel enabled
claude --dangerously-load-development-channels server:vela-channel

# 4. In another terminal, start the live preview
python3 skills/vela-slides/scripts/serve.py decks/your-deck.json --port 3030
```

## Browser Integration

From the browser (local.html), add a button that POSTs to the channel:

```javascript
// Ask Claude to improve a slide
fetch('http://localhost:8787/action', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'improve', slide: 3 })
}).then(r => r.json()).then(result => {
  console.log('Claude says:', result.reply);
});
```

## Available Actions

| Action | Payload | What Claude Does |
|--------|---------|-----------------|
| `improve` | `{slide: N}` | Reviews and improves the specified slide |
| `translate` | `{language: "pt-PT"}` | Translates entire deck using extract-text/patch-text |
| `restyle` | `{colors: {bg, color, accent}}` | Rebrands using replace-text |
| `prompt` | `{text: "free-form instruction"}` | Executes any natural language instruction |
| `stats` | `{}` | Runs deck health audit |

## Requirements

- Claude Code v2.1.80+ with claude.ai login
- `--dangerously-load-development-channels` flag (research preview)
- Node.js 18+ / Bun
