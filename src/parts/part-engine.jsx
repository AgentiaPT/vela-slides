// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
// ━━━ Vera Agentic Engine ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tool-use ReAct loop with shared API helpers

// SECURITY (audit 2025-05, H5 cost-amplification DoS): the ReAct loop must
// cap not just iteration count, but also tool-calls per turn, total tool
// calls across the session, and the cumulative messages-payload size. A
// prompt-injected deck can otherwise instruct Vera to emit thousands of
// tool calls per turn (e.g. "verify each slide with find_slides 200 times"),
// blowing up output tokens × 12 iterations. With max_tokens=16000 and
// Sonnet-4 pricing, this is a real money/latency DoS vector.
const MAX_TOOLS_PER_TURN = 16;
const MAX_TOTAL_TOOLS = 40;
const MAX_MESSAGES_BYTES = 200 * 1024;

// ━━━ Shared API Helpers (deduped from 3 copies) ━━━━━━━━━━━━━━━━━━━
async function callClaudeAPI(sysPrompt, messages, { temperature = 0, maxTokens = 16000, timeoutMs = 30000, _callType = "chat" } = {}) {
  if (!velaAIAvailable()) throw new Error(VELA_AI_UNAVAILABLE_MSG);
  // Neutralino desktop mode: the host shell installs window.__velaAgentSend
  // that spawns a local coding CLI (Claude Code by default). We bypass the
  // rest of this function entirely — no HTTP, no AbortController, timeouts
  // are managed by the subprocess wrapper.
  if (typeof window !== "undefined" && typeof window.__velaAgentSend === "function") {
    // Per-deck trust gate (Neutralino desktop only). Returns "allow" / "deny";
    // the shell shows a consent modal on first use. Missing gate → allow
    // (artifact / serve.py runtimes have their own trust models).
    if (typeof window.__velaTrustGate === "function") {
      const decision = await window.__velaTrustGate();
      if (decision === "deny") {
        throw new Error("AI is disabled for this deck. Trust it in Settings to enable.");
      }
    }
    const t0 = performance.now();
    const text = await window.__velaAgentSend({
      system: sysPrompt, messages, temperature, max_tokens: maxTokens, _callType,
    });
    velaSessionStats.add({
      type: _callType, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_create_tokens: 0,
      model: window.__velaAgentActive || "cli-agent", tool_calls: 0,
      duration_ms: Math.round(performance.now() - t0), stop_reason: "cli",
    });
    return text || "";
  }
  // Channel mode needs longer timeout — Claude Code roundtrip is slower than direct API
  const effectiveTimeout = (VELA_LOCAL_MODE && VELA_CHANNEL_PORT) ? Math.max(timeoutMs, 120000) : timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);
  const t0 = performance.now();
  try {
    // Local mode: route through MCP channel server
    if (VELA_LOCAL_MODE && VELA_CHANNEL_PORT) {
      const r = await fetch(`http://localhost:${VELA_CHANNEL_PORT}/action`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-vela-token": VELA_CHANNEL_TOKEN },
        signal: controller.signal,
        body: JSON.stringify({ action: "complete", _silent: true, system: sysPrompt, messages, temperature, max_tokens: maxTokens, _callType })
      });
      if (!r.ok) throw new Error(`Channel ${r.status}`);
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || "Channel error");
      velaSessionStats.add({
        type: _callType, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_create_tokens: 0,
        model: "claude-code-channel", tool_calls: 0, duration_ms: Math.round(performance.now() - t0), stop_reason: "channel",
      });
      return data.reply || "";
    }
    // Artifact mode: direct Anthropic API (via artifact proxy)
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: maxTokens, temperature, system: sysPrompt, messages })
    });
    if (!r.ok) throw new Error(`API ${r.status}`);
    const data = await r.json();
    // Record usage stats
    const u = data.usage || {};
    velaSessionStats.add({
      type: _callType,
      input_tokens: u.input_tokens || 0,
      output_tokens: u.output_tokens || 0,
      cache_read_tokens: u.cache_read_input_tokens || 0,
      cache_create_tokens: u.cache_creation_input_tokens || 0,
      model: data.model || "claude-sonnet-4-20250514",
      tool_calls: (data.content || []).filter((b) => b.type === "tool_use").length,
      duration_ms: Math.round(performance.now() - t0),
      stop_reason: data.stop_reason || "",
    });
    return (data.content || []).map((b) => b.type === "text" ? b.text : "").join("");
  } finally { clearTimeout(timer); }
}

function parseJSONResponse(text) {
  let clean = text.replace(/```json\s*|```\s*/g, "").trim();
  if (!clean.startsWith("{")) { const m = clean.match(/\{[\s\S]*\}/); if (m) clean = m[0]; else return null; }
  try { return JSON.parse(clean); } catch { return null; }
}

function restoreImageSrcs(improved, originalBlocks) {
  if (!improved?.blocks || !originalBlocks) return;
  const origImages = originalBlocks.filter((b) => b.type === "image");
  let imgIdx = 0;
  for (let bi = 0; bi < improved.blocks.length; bi++) {
    const b = improved.blocks[bi];
    if (b.type === "image" && origImages[imgIdx]) { b.src = origImages[imgIdx].src; imgIdx++; }
    if (b.type === "grid" && b.items) {
      for (const gi of b.items) {
        for (const gb of gi.blocks || []) {
          if (gb.type === "image" && origImages[imgIdx]) { gb.src = origImages[imgIdx].src; imgIdx++; }
        }
      }
    }
    // Restore links from original blocks at same index
    if (originalBlocks[bi]?.link && !b.link) b.link = originalBlocks[bi].link;
  }
  // GUARANTEE no image is lost (CR: AI edits must never drop existing images).
  // If the model returned fewer image blocks than the original, re-append the
  // dropped originals so their content survives even when the model omits them.
  for (; imgIdx < origImages.length; imgIdx++) improved.blocks.push({ ...origImages[imgIdx] });
}

// Merge a model-produced block array with the originals so that existing image
// blocks are always preserved: real src is restored (never left as the
// "keep-original" placeholder), the model's repositioning/resizing/recaptioning
// is kept, and any image the model dropped is re-appended. Used by edit_slide,
// which replaces the block array wholesale.
function preserveImages(newBlocks, originalBlocks) {
  const origImages = (originalBlocks || []).filter((b) => b && b.type === "image");
  if (origImages.length === 0) return newBlocks;
  let idx = 0;
  const out = [];
  for (const b of (newBlocks || [])) {
    if (b && b.type === "image") {
      const orig = origImages[idx];
      if (orig) { out.push({ ...orig, ...b, src: orig.src }); idx++; }
      else out.push(b);
    } else out.push(b);
  }
  for (; idx < origImages.length; idx++) out.push({ ...origImages[idx] });
  return out;
}

// Last-line guard for edit_slide: after a merge, replace any image whose src is
// still the "keep-original" placeholder (or empty) with the real src from the
// original blocks, matched positionally. Walks GRID cells too — the per-block
// merge/preserveImages paths only reach top-level images, so a grid-nested image
// would otherwise persist the placeholder and be dropped on the next sanitize.
function restoreKeepOriginal(finalBlocks, originalBlocks) {
  const origSrcs = [];
  const collect = (arr) => { for (const b of (arr || [])) { if (!b) continue; if (b.type === "image" && b.src && b.src !== "keep-original") origSrcs.push(b.src); if (b.type === "grid" && Array.isArray(b.items)) for (const c of b.items) collect(c && c.blocks); } };
  collect(originalBlocks);
  let i = 0;
  const walk = (arr) => { for (const b of (arr || [])) { if (!b) continue; if (b.type === "image") { if ((b.src === "keep-original" || !b.src) && origSrcs[i] != null) b.src = origSrcs[i]; i++; } if (b.type === "grid" && Array.isArray(b.items)) for (const c of b.items) walk(c && c.blocks); } };
  walk(finalBlocks);
}

function stripImageSrcs(slideJson) {
  const clone = JSON.parse(JSON.stringify(slideJson));
  // Replace bulky image data with a stable "keep-original" placeholder (matches
  // the system-prompt instruction) so the model still SEES the image blocks and
  // keeps them in place, but never has to reproduce the data. NOTE: only `blocks`
  // (and nested grid cells) are stripped — the restore paths (restoreImageSrcs /
  // preserveImages) only re-attach `blocks`/grid srcs. Stripping L/R here without
  // a matching restore would turn split-column side images into the literal
  // "keep-original" string (data loss), so L/R are intentionally left intact.
  const walk = (blocks) => { if (!blocks) return; for (const b of blocks) {
    if (b.type === "image" && b.src && b.src.length > 200) b.src = "keep-original";
    if (b.link) delete b.link;
    if (b.type === "grid" && b.items) for (const gi of b.items) walk(gi.blocks || []);
  }};
  walk(clone.blocks);
  return clone;
}

function replacePastedImage(slideObj, base64DataUrl) {
  if (!slideObj?.blocks || !base64DataUrl) return;
  const walk = (blocks) => { for (const b of blocks) {
    if (b.type === "image" && b.src === "__PASTED__") b.src = base64DataUrl;
    if (b.type === "grid" && b.items) for (const gi of b.items) walk(gi.blocks || []);
  }};
  walk(slideObj.blocks);
}

