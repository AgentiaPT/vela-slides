# Vela Channel — Browser ↔ Claude Code Bridge

Bridges the Vela browser UI to a running Claude Code session via the Channels API.

> **Status: experimental — on both sides.**
>
> - **The underlying platform feature is experimental.** Claude MCP Channels
>   (`claude/channel`, `notifications/claude/channel`, and the
>   `--dangerously-load-development-channels` flag) are, **as of July 2026, a
>   research preview by Anthropic**. The API is unstable and may change or be
>   withdrawn without notice. Nothing here should be treated as a supported
>   integration point, and the `--dangerously-` prefix is Anthropic's own signal
>   about the risk of loading development channels.
> - **This bridge is an experimental prototype.** The channel the Vela app
>   actually uses is `tools/vela-dev/scripts/agent_backend.py`. This MCP variant
>   is not wired into `serve.py` or CI, and is kept only for research-preview
>   work. If you are looking for Vela's AI channel, you want `agent_backend.py`.

## ⚠ Risks — read before enabling the HTTP bridge

`POST /action` hands an instruction to **your** Claude Code session. That session
holds your credentials, your spend, and whatever tool access you started it with,
and the `prompt` action is free-form. Anything that can reach the port and present
the token can therefore act as you.

Because of that, the HTTP bridge **does not open a port unless you ask for it**:

- **Off by default.** No `VELA_CHANNEL_HTTP=1`, no listener. Registering the MCP
  server alone never opens a port.
- **Loopback only.** The bind address is hard-coded to `127.0.0.1` and is not
  configurable — other machines on your network cannot reach it.
- **Token-gated.** `/action` and `/events` require `x-vela-token`. Set
  `VELA_CHANNEL_TOKEN`, or let the server mint one per run and print it to stderr.
- **Host + Origin validated.** Non-loopback `Host` or `Origin` values are rejected
  with 403, which is what stops a website you happen to be visiting from driving
  the channel via DNS rebinding. No CORS grant is issued to a foreign origin.

Enable it deliberately, for the length of a session, on a machine you trust:

```bash
VELA_CHANNEL_HTTP=1 claude --dangerously-load-development-channels server:vela-channel
```

These are the same controls `agent_backend.py` enforces, and they follow the MCP
guidance on local HTTP transports (bind loopback, validate `Host`/`Origin`,
authenticate even locally). Do not add a flag to widen the bind.

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
cd tools/vela-dev/channel
npm install

# 2. Add to .mcp.json (project root)
# { "mcpServers": { "vela-channel": { "command": "npx", "args": ["tsx", "tools/vela-dev/channel/vela-channel.ts"] } } }

# 3. Start Claude Code with the channel loaded.
#    Without VELA_CHANNEL_HTTP=1 the MCP server runs but NO port is opened —
#    opt in only when you want the browser bridge, and read "Risks" first.
VELA_CHANNEL_HTTP=1 VELA_CHANNEL_TOKEN="$(openssl rand -base64 24)" \
  claude --dangerously-load-development-channels server:vela-channel
# (omit VELA_CHANNEL_TOKEN and the server mints one, printing it to stderr)

# 4. In another terminal, start the live preview
python3 tools/vela-dev/scripts/serve.py decks/your-deck.json --port 3030
```

## Browser Integration

From the browser (local.html), add a button that POSTs to the channel:

```javascript
// Ask Claude to improve a slide. The token is required — without it the
// request is rejected with 403. Use the loopback host: a request whose Host
// or Origin is not loopback is refused.
fetch('http://localhost:8787/action', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-vela-token': VELA_CHANNEL_TOKEN },
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

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `VELA_CHANNEL_HTTP` | *(unset — bridge off)* | Set to `1` to open the HTTP bridge. Opt-in, per run. |
| `VELA_CHANNEL_TOKEN` | *(minted per run)* | Shared secret for `x-vela-token`. Printed to stderr if unset. |
| `VELA_CHANNEL_PORT` | `8787` | Listen port. Always bound to `127.0.0.1`. |

The bind address is intentionally not configurable.

## Requirements

- Claude Code v2.1.80+ with claude.ai login
- `--dangerously-load-development-channels` flag — Claude MCP Channels are an
  Anthropic **research preview as of July 2026**; unstable, subject to change
  or withdrawal, and not covered by any stability guarantee
- Node.js 18+ / Bun
