#!/usr/bin/env npx tsx
// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
/**
 * Vela Channel Server — bridges browser UI to Claude Code session.
 *
 * Browser clicks "Ask Claude" → POST /action → channel pushes to Claude → Claude edits deck → browser updates.
 *
 * Usage:
 *   claude --dangerously-load-development-channels server:vela-channel
 *
 * Requires:
 *   - Claude Code v2.1.80+ with claude.ai login
 *   - @modelcontextprotocol/sdk
 *   - vela deck serve running separately for live preview
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

// ── Configuration ──────────────────────────────────────────────────
const PORT = parseInt(process.env.VELA_CHANNEL_PORT || "8787");
const SERVER_NAME = "vela-channel";
const LOG_PATH = path.join(process.env.HOME || "/tmp", "projects/vela-slides/vela-channel.log");
const CACHE_DIR = path.resolve(process.cwd(), ".channel-cache");
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

function log(msg: string) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  process.stderr.write(line);
  try { fs.appendFileSync(LOG_PATH, line); } catch {}
}

// ── Reply queue (Claude → browser) ────────────────────────────────
interface PendingReply {
  resolve: (value: string) => void;
  timeout: NodeJS.Timeout;
  silent?: boolean;
}
const replyQueue: Map<string, PendingReply> = new Map();
let replyCounter = 0;

// ── MCP Server ────────────────────────────────────────────────────
const mcp = new Server(
  { name: SERVER_NAME, version: "0.1.0" },
  {
    capabilities: {
      experimental: {
        "claude/channel": {},
      },
      tools: {},
    },
    instructions: [
      `Events from <channel source="${SERVER_NAME}"> are user actions from the Vela slide editor browser UI.`,
      `The content is a JSON object with an "action" field and optional parameters.`,
      ``,
      `ACTIONS:`,
      `  complete — LLM completion proxy. The channel event contains a _summary and _payloadFile path.`,
      `    Read the payload file to get {system, messages, temperature, max_tokens, _callType}.`,
      `    You ARE the LLM backend. Read the system prompt and messages, then reply with ONLY the raw text`,
      `    output (no markdown fences, no commentary). Match the role: follow the system prompt instructions`,
      `    exactly as if you were the API. The _callType hint tells you the context (chat, quick-edit,`,
      `    inline-edit, create, estimate). Respond as concisely and precisely as the system prompt requires.`,
      `  improve_slide — improve the slide specified in slide_context`,
      `  translate — translate deck to language specified in params`,
      `  restyle — change colors specified in params`,
      `  stats — run health audit`,
      `  fix_issues — find and fix quality issues`,
      `  prompt — execute free-form text instruction`,
      ``,
      `VELA CLI REFERENCE (use these exact commands):`,
      `  python3 skills/vela-slides/scripts/vela.py deck list <deck.json>`,
      `  python3 skills/vela-slides/scripts/vela.py deck dump <deck.json>`,
      `  python3 skills/vela-slides/scripts/vela.py deck stats <deck.json>`,
      `  python3 skills/vela-slides/scripts/vela.py deck find <deck.json> --query "text" | --type flow | --missing duration`,
      `  python3 skills/vela-slides/scripts/vela.py deck replace-text <deck.json> "old" "new"`,
      `  python3 skills/vela-slides/scripts/vela.py deck extract-text <deck.json> <output.json>`,
      `  python3 skills/vela-slides/scripts/vela.py deck patch-text <deck.json> <texts.json>`,
      `  python3 skills/vela-slides/scripts/vela.py deck split <deck.json> --sections "A:3,B:5" | --flat`,
      `  python3 skills/vela-slides/scripts/vela.py deck validate <deck.json>`,
      `  python3 skills/vela-slides/scripts/vela.py slide view <deck.json> <N>`,
      `  python3 skills/vela-slides/scripts/vela.py slide edit <deck.json> <N> <key> <value>`,
      ``,
      `SPEED RECIPES (use these patterns, not ad-hoc approaches):`,
      ``,
      `  TRANSLATE ONE SLIDE: use parallel replace-text calls (one per text string)`,
      `    1. slide view <deck> <N> — read current text`,
      `    2. Multiple parallel: replace-text <deck> "old text" "new text" (one per string)`,
      `    3. reply — done. Total: 2 steps.`,
      ``,
      `  TRANSLATE FULL DECK: use extract-text/patch-text pipeline`,
      `    1. deck extract-text <deck> texts.json`,
      `    2. Write translated texts-out.json (same keys, translated values)`,
      `    3. deck patch-text <deck> texts-out.json`,
      `    4. reply — done. Total: 4 steps.`,
      ``,
      `  IMPROVE ONE SLIDE: view it, edit specific properties`,
      `    1. slide view <deck> <N> — read content`,
      `    2. slide edit <deck> <N> block.0.text "Better headline" (parallel edits for multiple blocks)`,
      `    3. reply — done. Total: 2-3 steps.`,
      ``,
      `  RESTYLE: use replace-text for color swaps`,
      `    Multiple parallel: replace-text <deck> "#oldcolor" "#newcolor"`,
      ``,
      `RULES:`,
      `  - SPEED IS CRITICAL — users expect < 10 seconds for single-slide operations`,
      `  - The deck file path is in the channel event as "deck_path" — NEVER search for it`,
      `  - Parallelize independent tool calls in the SAME message`,
      `  - Always call the reply tool when done with a brief summary`,
      `  - Skip validation — CLI commands preserve structure`,
      `  - Use replace-text for text changes (not slide edit + str_replace)`,
      `  - NEVER write raw JSON to slide edit — use block.N.text for text properties`,
      `  - NEVER use str_replace on the JSON file — use CLI commands instead`,
      `  - The deck file is the user's work — be surgical, don't overwrite entire slides`,
    ].join("\n"),
  }
);

// ── Tool: reply ───────────────────────────────────────────────────
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description:
        "Send a result message back to the Vela browser UI. Call this after completing a channel action.",
      inputSchema: {
        type: "object" as const,
        properties: {
          text: {
            type: "string",
            description: "The result message to display in the browser",
          },
          request_id: {
            type: "string",
            description: "The request_id from the channel event (if provided)",
          },
        },
        required: ["text"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === "reply") {
    const { text, request_id } = req.params.arguments as {
      text: string;
      request_id?: string;
    };

    // Resolve pending reply if we have one
    let silent = false;
    if (request_id && replyQueue.has(request_id)) {
      const pending = replyQueue.get(request_id)!;
      clearTimeout(pending.timeout);
      silent = !!pending.silent;
      pending.resolve(text);
      replyQueue.delete(request_id);
    }

    // Also broadcast to any SSE listeners (skip silent/engine replies)
    broadcastSSE(JSON.stringify({ type: "reply", text, request_id, ...(silent ? { _silent: true } : {}) }));

    const snippet = text.length > 60 ? text.slice(0, 60) + "…" : text;
    return { content: [{ type: "text", text: `Reply sent (${text.length} chars): ${snippet}` }] };
  }
  throw new Error(`Unknown tool: ${req.params.name}`);
});

// ── SSE connections (for real-time reply streaming) ───────────────
const sseClients: Set<http.ServerResponse> = new Set();

function broadcastSSE(data: string) {
  const message = `data: ${data}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(message);
    } catch {
      sseClients.delete(res);
    }
  }
}

// ── HTTP Server (browser → channel) ──────────────────────────────
const httpServer = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // POST /action — browser sends an action for Claude
  if (req.method === "POST" && req.url === "/action") {
    let body = "";
    for await (const chunk of req) body += chunk;

    try {
      const action = JSON.parse(body);
      const requestId = `req_${++replyCounter}`;

      // Create a promise that resolves when Claude replies
      const isSilent = !!action._silent;
      const replyPromise = new Promise<string>((resolve) => {
        const timeout = setTimeout(() => {
          replyQueue.delete(requestId);
          resolve("Claude is still working on this...");
        }, 120_000); // 2 min timeout
        replyQueue.set(requestId, { resolve, timeout, silent: isSilent });
      });

      // Push to Claude via channel notification
      // For complete actions: write full payload to temp file, send compact summary
      const isComplete = action.action === "complete";
      let notificationContent: string;

      if (isComplete) {
        // Strip base64 image data before writing
        let cleanedAction = action;
        if (action.messages) {
          cleanedAction = { ...action, messages: action.messages.map((m: any) => {
            if (typeof m.content === "string") return m;
            if (Array.isArray(m.content)) {
              const imageCount = m.content.filter((p: any) => p.type === "image").length;
              if (imageCount === 0) return m;
              const cleaned = m.content.map((p: any) => p.type === "image" ? { type: "text", text: "[image]" } : p);
              return { ...m, content: cleaned };
            }
            return m;
          })};
        }
        // Write full payload to temp file
        const payloadPath = path.join(CACHE_DIR, `vela-channel-${requestId}.json`);
        fs.writeFileSync(payloadPath, JSON.stringify(cleanedAction, null, 2));

        // Build compact summary for console display
        const callType = action._callType || "chat";
        const msgCount = action.messages?.length || 0;
        const lastMsg = action.messages?.[msgCount - 1];
        const userSnippet = lastMsg?.content
          ? (typeof lastMsg.content === "string" ? lastMsg.content : "[multipart]").slice(0, 80)
          : "";
        notificationContent = JSON.stringify({
          action: "complete",
          _callType: callType,
          _silent: !!action._silent,
          request_id: requestId,
          _summary: `${callType} | ${msgCount} msg(s) | "${userSnippet}"`,
          _payloadFile: payloadPath,
        });
      } else {
        // Non-complete actions: send as-is but compact
        const { slide_context, ...rest } = action;
        const summary: any = { ...rest, request_id: requestId };
        if (slide_context) summary._slideHint = `slide ${slide_context.slideIndex ?? "?"}`;
        notificationContent = JSON.stringify(summary);
      }

      await mcp.notification({
        method: "notifications/claude/channel",
        params: {
          content: notificationContent,
          meta: {
            action: action.action || "unknown",
            request_id: requestId,
          },
        },
      });

      log(`Pushed action to Claude: ${action.action} (${requestId})`);

      // Wait for Claude's reply (or timeout)
      const reply = await replyPromise;

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, reply, request_id: requestId }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Invalid request" }));
    }
    return;
  }

  // GET /events — SSE stream for real-time replies
  if (req.method === "GET" && req.url === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  // GET /health
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        server: SERVER_NAME,
        pending_replies: replyQueue.size,
        sse_clients: sseClients.size,
      })
    );
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// ── Start ─────────────────────────────────────────────────────────
async function main() {
  log(`Starting (pid=${process.pid})`);

  // Connect to Claude Code via stdio FIRST — handshake must complete quickly
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  log(`Connected to Claude Code via stdio`);

  // Keep process alive — detect stdio close
  process.stdin.on("end", () => {
    log(`stdin closed (Claude Code disconnected)`);
    process.exit(0);
  });

  // Now start HTTP server in background (non-blocking)
  // Kill stale process on our port before binding
  try {
    const { execSync } = await import("node:child_process");
    const pids = execSync(`fuser ${PORT}/tcp 2>/dev/null || true`, { encoding: "utf8" }).trim();
    if (pids) {
      for (const pid of pids.split(/\s+/)) {
        if (pid && parseInt(pid) !== process.pid) {
          log(`Killing stale process ${pid} on port ${PORT}`);
          try { process.kill(parseInt(pid), "SIGTERM"); } catch {}
        }
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  } catch {}

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      log(`WARNING: Port ${PORT} in use, HTTP bridge disabled`);
    } else {
      log(`HTTP server error: ${err.message}`);
    }
  });
  httpServer.listen(PORT, "0.0.0.0", () => {
    log(`HTTP server on http://0.0.0.0:${PORT}`);
  });
}

// Global error handlers to prevent silent crashes
process.on("uncaughtException", (err) => {
  log(`Uncaught exception: ${err.message}\n${err.stack}`);
});
process.on("unhandledRejection", (reason) => {
  log(`Unhandled rejection: ${reason}`);
});

main().catch((err) => {
  log(`Fatal: ${err}`);
  process.exit(1);
});
