// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
// ━━━ Vera Agentic Engine ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tool-use ReAct loop with shared API helpers

// ━━━ Shared API Helpers (deduped from 3 copies) ━━━━━━━━━━━━━━━━━━━
async function callClaudeAPI(sysPrompt, messages, { temperature = 0, maxTokens = 16000, timeoutMs = 30000, _callType = "chat" } = {}) {
  // Channel mode needs longer timeout — Claude Code roundtrip is slower than direct API
  const effectiveTimeout = (VELA_LOCAL_MODE && VELA_CHANNEL_PORT) ? Math.max(timeoutMs, 120000) : timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);
  const t0 = performance.now();
  try {
    // Local mode: route through MCP channel server
    if (VELA_LOCAL_MODE && VELA_CHANNEL_PORT) {
      const r = await fetch(`http://localhost:${VELA_CHANNEL_PORT}/action`, {
        method: "POST", headers: { "Content-Type": "application/json" },
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
}

function stripImageSrcs(slideJson) {
  const clone = JSON.parse(JSON.stringify(slideJson));
  const walk = (blocks) => { if (!blocks) return; for (const b of blocks) {
    if (b.type === "image" && b.src && b.src.length > 200) b.src = "[IMAGE]";
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

// ━━━ Tool Execution Engine ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function executeTool(name, input, ws, attachedImages) {
  const findLane = (title) => ws.lanes.find((l) => l.title.toLowerCase() === title.toLowerCase());
  const findItem = (name) => {
    const lower = name.toLowerCase();
    for (const l of ws.lanes) {
      const it = l.items.find((i) => i.title.toLowerCase().includes(lower) || lower.includes(i.title.toLowerCase()) || i.title.toLowerCase() === lower);
      if (it) return { lane: l, item: it };
    }
    return null;
  };
  // Guard: find item or return error message (string or {text})
  const withItem = (itemName, asObj, fn) => {
    const f = findItem(itemName);
    if (!f) { const msg = `Item "${itemName}" not found.`; return asObj ? { text: msg } : msg; }
    return fn(f);
  };

  switch (name) {
    case "add_lane": {
      if (findLane(input.title)) return `Lane "${input.title}" already exists.`;
      ws.lanes.push({ id: uid(), title: input.title, collapsed: false, items: [] });
      return `Lane "${input.title}" created. Board now has ${ws.lanes.length} lanes.`;
    }
    case "add_item": {
      const lane = findLane(input.lane_title);
      if (!lane) return `Lane "${input.lane_title}" not found. Available: ${ws.lanes.map((l) => l.title).join(", ")}`;
      lane.items.push({ id: uid(), title: input.title, status: "todo", importance: input.importance || "should", order: lane.items.length + 1, slides: [], createdAt: now() });
      return `Added "${input.title}" to "${lane.title}" (${lane.items.length} items).`;
    }
    case "batch_add_items": {
      const lane = findLane(input.lane_title);
      if (!lane) return `Lane "${input.lane_title}" not found. Available: ${ws.lanes.map((l) => l.title).join(", ")}`;
      let o = lane.items.length + 1;
      for (const it of input.items || []) lane.items.push({ id: uid(), title: it.title, status: "todo", importance: it.importance || "should", order: o++, slides: [], createdAt: now() });
      return `Added ${input.items.length} items to "${lane.title}" (now ${lane.items.length} total).`;
    }
    case "remove_item": return withItem(input.item_name, false, ({ lane, item }) => { lane.items = lane.items.filter((i) => i.id !== item.id); return `Removed "${item.title}" from "${lane.title}".`; });
    case "remove_lane": { const lane = findLane(input.lane_title); if (!lane) return `Lane "${input.lane_title}" not found.`; ws.lanes = ws.lanes.filter((l) => l.id !== lane.id); return `Removed lane "${lane.title}" and its ${lane.items.length} items.`; }
    case "rename_item": return withItem(input.item_name, false, ({ item }) => { const old = item.title; item.title = input.new_title; return `Renamed "${old}" → "${input.new_title}".`; });
    case "rename_lane": { const lane = findLane(input.lane_title); if (!lane) return `Lane "${input.lane_title}" not found.`; const old = lane.title; lane.title = input.new_title; return `Renamed "${old}" → "${input.new_title}".`; }
    case "move_item": return withItem(input.item_name, false, ({ lane, item }) => { const target = findLane(input.target_lane_title); if (!target) return `Lane "${input.target_lane_title}" not found.`; lane.items = lane.items.filter((i) => i.id !== item.id); target.items.push(item); return `Moved "${item.title}" → "${target.title}".`; });
    case "update_status": return withItem(input.item_name, false, ({ item }) => { item.status = input.status; if (input.status === "signed-off") item.signedOffAt = now(); return `"${item.title}" → ${input.status}.`; });
    case "set_importance": return withItem(input.item_name, false, ({ item }) => { item.importance = input.importance; return `"${item.title}" importance → ${input.importance}.`; });
    case "set_slides": return withItem(input.item_name, true, ({ item }) => { item.slides = input.slides; return { text: `Set ${input.slides.length} slides on "${item.title}".`, jump: { itemId: item.id, title: item.title, slideIdx: 0 } }; });
    case "add_slide": return withItem(input.item_name, true, ({ item }) => { item.slides.push(input.slide); return { text: `Added slide to "${item.title}" (${item.slides.length} total).`, jump: { itemId: item.id, title: item.title, slideIdx: item.slides.length - 1 } }; });
    case "edit_slide": return withItem(input.item_name, true, ({ item }) => {
      const si = input.slide_index ?? 0;
      if (!item.slides[si]) return { text: `Slide ${si + 1} not found in "${item.title}" (has ${item.slides.length} slides).` };
      const slide = item.slides[si];
      const patch = input.patch || {};
      // Merge top-level slide properties
      for (const [k, v] of Object.entries(patch)) {
        if (k === "blocks" && Array.isArray(v)) {
          // Smart block merge: if patch has same number of blocks, merge each; otherwise replace
          if (v.length === (slide.blocks || []).length) {
            slide.blocks = slide.blocks.map((existing, bi) => {
              const patched = { ...existing, ...v[bi] };
              // Deep merge grid items: preserve cell blocks unless patch explicitly provides them
              if (existing.type === "grid" && existing.items && v[bi] && !v[bi].items) {
                patched.items = existing.items;
              } else if (existing.type === "grid" && existing.items && v[bi]?.items && v[bi].items.length === existing.items.length) {
                // Same number of grid cells — merge each cell's blocks
                patched.items = existing.items.map((cell, ci) => {
                  const patchCell = v[bi].items[ci];
                  if (!patchCell) return cell;
                  return { ...cell, ...patchCell, blocks: patchCell.blocks || cell.blocks };
                });
              }
              return patched;
            });
          } else {
            slide.blocks = v;
          }
        } else {
          slide[k] = v;
        }
      }
      return { text: `Edited slide ${si + 1} of "${item.title}" (patched: ${Object.keys(patch).join(", ")}).`, jump: { itemId: item.id, title: item.title, slideIdx: si } };
    });
    case "add_image_to_slide": return withItem(input.item_name, true, ({ item }) => {
      const idx = input.image_index ?? 0;
      if (!attachedImages || !attachedImages[idx]) return { text: `No attached image at index ${idx}. ${attachedImages ? attachedImages.length : 0} images available.` };
      const block = { type: "image", src: attachedImages[idx].dataUrl, caption: input.caption || "", maxWidth: input.max_width || "80%", shadow: true, rounded: true };
      const slideObj = input.slide_index != null && item.slides[input.slide_index] ? item.slides[input.slide_index] : null;
      if (slideObj) { slideObj.blocks = [...(slideObj.blocks || []), block]; return { text: `Added image to slide ${input.slide_index + 1} of "${item.title}".`, jump: { itemId: item.id, title: item.title, slideIdx: input.slide_index } }; }
      else { item.slides.push({ blocks: [block] }); return { text: `Added new slide with image to "${item.title}" (${item.slides.length} total).`, jump: { itemId: item.id, title: item.title, slideIdx: item.slides.length - 1 } }; }
    });
    case "clear_all": ws.lanes = []; return "Board cleared.";
    case "set_branding": {
      const allowed = ["enabled", "accentBar", "accentColor", "accentHeight", "logoPosition", "logoSize", "footerLeft", "footerCenter", "footerRight", "footerBg", "footerColor", "footerSize", "imgMaxWidth", "imgQuality"];
      const patch = {}; for (const k of allowed) { if (input[k] !== undefined) patch[k] = input[k]; }
      ws.branding = { ...ws.branding, ...patch };
      return `Branding updated: ${Object.keys(patch).join(", ")}. Enabled: ${ws.branding.enabled}.`;
    }

    // ── Find & Navigate ──────────────────────────────────────────────
    case "find_slides": {
      const q = (input.query || "").toLowerCase().trim();
      const blockType = (input.block_type || "").toLowerCase().trim();
      const prop = input.property || null;
      const propMissing = input.property_missing || null;
      if (!q && !blockType && !prop && !propMissing) return "Need at least one of: query (text search), block_type, property, or property_missing.";

      // Fuzzy text scoring: word-level match + trigram similarity for typos
      const queryWords = q ? q.split(/\s+/).filter(Boolean) : [];
      const trigrams = (s) => { const t = new Set(); for (let i = 0; i <= s.length - 3; i++) t.add(s.slice(i, i + 3)); return t; };
      const trigramSim = (a, b) => { if (!a || !b) return 0; const ta = trigrams(a), tb = trigrams(b); let shared = 0; for (const t of ta) if (tb.has(t)) shared++; const total = ta.size + tb.size - shared; return total > 0 ? shared / total : 0; };
      const fuzzyScore = (text) => {
        if (!q) return 1;
        // Exact substring match → perfect score
        if (text.includes(q)) return 1;
        // Word-level: how many query words appear as substrings?
        const wordHits = queryWords.filter((w) => text.includes(w)).length;
        const wordScore = queryWords.length > 0 ? wordHits / queryWords.length : 0;
        // Trigram: for each query word, best trigram similarity to any word in text
        const textWords = text.split(/\s+/);
        let trigramTotal = 0;
        for (const qw of queryWords) {
          let best = 0;
          for (const tw of textWords) { const s = trigramSim(qw, tw); if (s > best) best = s; }
          trigramTotal += best;
        }
        const trigramScore = queryWords.length > 0 ? trigramTotal / queryWords.length : 0;
        // Blend: word hits dominate, trigram helps with typos
        return Math.max(wordScore, trigramScore * 0.8);
      };

      const results = [];
      const walkText = (blocks) => { const parts = []; for (const b of (blocks || [])) { if (b.text) parts.push(b.text); if (b.title) parts.push(b.title); if (b.label) parts.push(b.label); if (b.value) parts.push(String(b.value)); if (b.author) parts.push(b.author); if (b.caption) parts.push(b.caption); if (b.content) parts.push(b.content); if (b.markup) parts.push(b.markup); if (b.items) for (const it of b.items) { if (typeof it === "string") parts.push(it); else if (it) { if (it.text) parts.push(it.text); if (it.title) parts.push(it.title); if (it.label) parts.push(it.label); } } if (b.type === "grid" && b.items) for (const cell of b.items) parts.push(...walkText(cell.blocks)); } return parts; };
      for (const lane of ws.lanes) for (const item of lane.items) for (let si = 0; si < (item.slides || []).length; si++) {
        const slide = item.slides[si];
        let match = true; let score = 1;
        if (q) { const allText = [item.title || "", slide.title || "", ...walkText(slide.blocks)].join(" ").toLowerCase(); score = fuzzyScore(allText); if (score < 0.4) match = false; }
        if (blockType && match) { const hasType = (slide.blocks || []).some((b) => b.type === blockType || (b.type === "grid" && b.items?.some((c) => c.blocks?.some((cb) => cb.type === blockType)))); if (!hasType) match = false; }
        if (prop && match) { if (slide[prop] === undefined && !(slide.blocks || []).some((b) => b[prop] !== undefined)) match = false; }
        if (propMissing && match) { if (slide[propMissing] !== undefined && slide[propMissing] !== 0 && slide[propMissing] !== "") match = false; }
        if (match) results.push({ lane: lane.title, item: item.title, itemId: item.id, slideIdx: si, slideTitle: slide.title || (slide.blocks?.find((b) => b.type === "heading")?.text) || `Slide ${si + 1}`, score });
      }
      // Sort by relevance
      results.sort((a, b) => b.score - a.score);
      if (results.length === 0) return `No matches found${q ? ` for "${input.query}"` : ""}${blockType ? ` with block type "${blockType}"` : ""}${propMissing ? ` missing "${propMissing}"` : ""}.`;
      const jumps = results.slice(0, 20).map((r) => ({ itemId: r.itemId, title: `${r.item} → ${r.slideTitle}`, slideIdx: r.slideIdx }));
      return { text: `Found ${results.length} match${results.length > 1 ? "es" : ""}${q ? ` for "${input.query}"` : ""}${blockType ? ` with ${blockType} blocks` : ""}${propMissing ? ` missing ${propMissing}` : ""}:`, jump: jumps };
    }

    // ── Bulk Edit ─────────────────────────────────────────────────────
    case "find_replace": {
      const find = input.find || ""; const replace = input.replace ?? "";
      const scope = input.scope || "all";
      if (!find) return "Need 'find' text.";
      let count = 0;
      const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      const doReplace = (str) => { if (typeof str !== "string") return str; const m = str.match(re); if (m) count += m.length; return str.replace(re, replace); };
      const walkBlocks = (blocks) => { let hit = false; for (const b of (blocks || [])) { const before = count; if (b.text) b.text = doReplace(b.text); if (b.title) b.title = doReplace(b.title); if (b.label) b.label = doReplace(b.label); if (b.value && typeof b.value === "string") b.value = doReplace(b.value); if (b.author) b.author = doReplace(b.author); if (b.caption) b.caption = doReplace(b.caption); if (b.content) b.content = doReplace(b.content); if (b.items) for (const it of b.items) { if (typeof it === "string") { const idx = b.items.indexOf(it); b.items[idx] = doReplace(it); } else if (it) { if (it.text) it.text = doReplace(it.text); if (it.title) it.title = doReplace(it.title); if (it.label) it.label = doReplace(it.label); } } if (b.type === "grid" && b.items) for (const cell of b.items) { if (walkBlocks(cell.blocks)) hit = true; } if (count > before) hit = true; } return hit; };
      const inScope = (lane, item) => { if (scope === "all") return true; if (scope.startsWith("module:")) return item.title.toLowerCase().includes(scope.slice(7).toLowerCase()); if (scope.startsWith("lane:")) return lane.title.toLowerCase().includes(scope.slice(5).toLowerCase()); return true; };
      const changed = [];
      for (const lane of ws.lanes) for (const item of lane.items) { if (!inScope(lane, item)) continue; const beforeTitle = count; item.title = doReplace(item.title); const titleHit = count > beforeTitle; for (let si = 0; si < (item.slides || []).length; si++) { const slide = item.slides[si]; const before = count; if (slide.title) slide.title = doReplace(slide.title); const slideHit = walkBlocks(slide.blocks) || count > before; if (slideHit || titleHit) changed.push({ itemId: item.id, title: `${item.title} → ${slide.title || (slide.blocks?.find((b) => b.type === "heading")?.text) || "Slide " + (si + 1)}`, slideIdx: si }); } }
      if (count === 0) return `No occurrences of "${find}" found${scope !== "all" ? ` in scope ${scope}` : ""}.`;
      const jumps = changed.slice(0, 12);
      return { text: `Replaced ${count} occurrence${count > 1 ? "s" : ""} of "${find}" → "${replace}" across ${changed.length} slide${changed.length > 1 ? "s" : ""}${scope !== "all" ? ` (scope: ${scope})` : ""}.`, jump: jumps };
    }

    // ── Audit & Stats ────────────────────────────────────────────────
    case "deck_stats": {
      let totalSlides = 0, totalTime = 0, missingDuration = 0, missingBg = 0, emptyModules = 0;
      const blockCounts = {};
      const issues = [];
      for (const lane of ws.lanes) for (const item of lane.items) {
        if ((item.slides || []).length === 0) { emptyModules++; issues.push(`"${item.title}" has 0 slides`); }
        for (const slide of (item.slides || [])) {
          totalSlides++;
          totalTime += slide.duration || 0;
          if (!slide.duration) { missingDuration++; }
          if (!slide.bg && !slide.bgGradient) { missingBg++; }
          const blockCount = (slide.blocks || []).length;
          if (blockCount > 7) issues.push(`"${item.title}" slide ${totalSlides}: ${blockCount} blocks (overflow risk)`);
          for (const b of (slide.blocks || [])) {
            blockCounts[b.type] = (blockCounts[b.type] || 0) + 1;
            // Count nested blocks inside grid cells by their actual type
            if (b.type === "grid" && b.items) for (const cell of b.items) for (const cb of (cell.blocks || [])) { blockCounts[cb.type] = (blockCounts[cb.type] || 0) + 1; }
          }
          // Check for heading+bullets monotony
          const types = (slide.blocks || []).map((b) => b.type);
          if (types.length >= 2 && types.filter((t) => t === "heading").length >= 1 && types.filter((t) => t === "bullets").length >= 1 && types.filter((t) => !["heading", "bullets", "spacer", "badge", "text", "divider"].includes(t)).length === 0) {
            issues.push(`"${item.title}" slide has only heading+bullets — consider icon-row, grid, or flow`);
          }
        }
      }
      const modules = ws.lanes.reduce((s, l) => s + l.items.length, 0);
      const h = Math.floor(totalTime / 3600), m = Math.floor((totalTime % 3600) / 60), sec = totalTime % 60;
      const timeStr = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
      const blockDist = Object.entries(blockCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(", ");
      let report = `📊 **Deck Stats**\n${ws.lanes.length} lanes · ${modules} modules · ${totalSlides} slides · ${timeStr} total time`;
      report += `\nBlock types: ${blockDist || "none"}`;
      if (missingDuration > 0) report += `\n⚠ ${missingDuration} slides missing duration`;
      if (missingBg > 0) report += `\n⚠ ${missingBg} slides missing bg/bgGradient`;
      if (emptyModules > 0) report += `\n⚠ ${emptyModules} empty modules`;
      if (issues.length > 0) report += `\n\n🔍 Issues (${issues.length}):\n${issues.slice(0, 15).map((i) => "• " + i).join("\n")}${issues.length > 15 ? `\n...and ${issues.length - 15} more` : ""}`;
      else report += `\n\n✅ No issues found`;
      return report;
    }

    // ── Batch Restyle ────────────────────────────────────────────────
    case "batch_restyle": {
      const scope = input.scope || "all";
      const patch = {}; // slide-level style props
      const allowed = ["bg", "bgGradient", "color", "accent", "padding", "gap", "align", "verticalAlign"];
      for (const k of allowed) { if (input[k] !== undefined) patch[k] = input[k]; }
      // Block-level props
      const blockPatch = input.block_patch || null; // e.g. {type:"bullets", props:{size:"lg"}}
      if (Object.keys(patch).length === 0 && !blockPatch) return "Need at least one style property (bg, bgGradient, color, accent, padding, gap, align) or block_patch.";
      const inScope = (lane, item) => { if (scope === "all") return true; if (scope.startsWith("module:")) return item.title.toLowerCase().includes(scope.slice(7).toLowerCase()); if (scope.startsWith("lane:")) return lane.title.toLowerCase().includes(scope.slice(5).toLowerCase()); return true; };
      let slidesPatched = 0, blocksPatched = 0;
      for (const lane of ws.lanes) for (const item of lane.items) { if (!inScope(lane, item)) continue; for (const slide of (item.slides || [])) { if (Object.keys(patch).length > 0) { Object.assign(slide, patch); slidesPatched++; } if (blockPatch) { for (const b of (slide.blocks || [])) { if (!blockPatch.type || b.type === blockPatch.type) { Object.assign(b, blockPatch.props || {}); blocksPatched++; } if (b.type === "grid" && b.items) for (const cell of b.items) for (const cb of (cell.blocks || [])) { if (!blockPatch.type || cb.type === blockPatch.type) { Object.assign(cb, blockPatch.props || {}); blocksPatched++; } } } } } }
      const parts = [];
      if (slidesPatched > 0) parts.push(`restyled ${slidesPatched} slides (${Object.keys(patch).join(", ")})`);
      if (blocksPatched > 0) parts.push(`patched ${blocksPatched} ${blockPatch?.type || ""} blocks`);
      return parts.length > 0 ? `✅ ${parts.join(", ")}${scope !== "all" ? ` (scope: ${scope})` : ""}.` : "No slides matched the scope.";
    }

    // ── Comment Tools ──────────────────────────────────────────────
    case "list_comments": {
      const statusFilter = input.status || "open";
      const all = collectComments(ws.lanes, statusFilter === "all" ? null : (c) => c.status === statusFilter);
      if (all.length === 0) return `No ${statusFilter === "all" ? "" : statusFilter + " "}comments found.`;
      const lines = all.map((c) => {
        const loc = c.slideIndex != null ? `slide ${c.slideIndex + 1}` : "(module)";
        const anchor = c.anchor ? ` ["${c.anchor}"]` : "";
        return `[${c.status}] "${c.itemTitle}" ${loc}${anchor}: ${c.text} (id: ${c.id})`;
      });
      const jumps = all.filter((c) => c.slideIndex != null).slice(0, 10).map((c) => ({ itemId: c.itemId, title: `Comment: ${c.text.slice(0, 30)}`, slideIdx: c.slideIndex }));
      return { text: `${all.length} comment(s):\n${lines.join("\n")}`, jump: jumps };
    }
    case "resolve_comment": {
      const cid = input.id || input.comment_id;
      if (!cid) return "Missing comment id.";
      for (const l of ws.lanes) for (const item of l.items) {
        for (const c of (item.comments || [])) { if (c.id === cid) { c.status = "resolved"; c.resolvedAt = now(); return `Resolved comment: "${c.text.slice(0, 50)}"`; } }
        for (const s of (item.slides || [])) { for (const c of (s.comments || [])) { if (c.id === cid) { c.status = "resolved"; c.resolvedAt = now(); return `Resolved comment: "${c.text.slice(0, 50)}"`; } } }
      }
      return `Comment "${cid}" not found.`;
    }

    default: return `Unknown tool: ${name}`;
  }
}

// ━━━ System Prompts ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function buildSystemPrompt(lanes, selectedId, slideIndex, branding, guidelines, layoutStats) {
  const st = JSON.stringify(lanes.map((l) => ({ title: l.title, items: l.items.map((i) => ({ title: i.title, status: i.status, importance: i.importance, slides: i.slides.length, ...(i.notes ? { notes: i.notes } : {}) })) })), null, 2);
  let ctx = "";
  if (selectedId) {
    for (const l of lanes) {
      const item = l.items.find((i) => i.id === selectedId);
      if (item) { ctx = `\n\n## CURRENT FOCUS (the user is viewing this right now)\nModule: "${item.title}" in lane "${l.title}"${item.notes ? `\nSpec notes: ${item.notes}` : ""}\nViewing slide ${slideIndex + 1}/${item.slides.length}\nWhen the user says "this slide" or asks to change something without specifying which slide, they mean THIS one. Use edit_slide with slide_index: ${slideIndex}.\nCurrent slide JSON: ${JSON.stringify(item.slides[slideIndex] ? stripImageSrcs(item.slides[slideIndex]) : null)}${layoutStats ? `\n\n## DOM LAYOUT ANALYSIS (measured from rendered slide)\n${layoutStats}\nUse this to understand how the slide actually looks: fill%, blank space, distribution, overflow.` : ""}`; break; }
    }
  }
  const brandingState = branding ? `\n\n## BRANDING\n${JSON.stringify(branding, null, 2)}\nBranding renders as an overlay on every slide: accent bar header, optional logo, footer bar. Use set_branding to configure.` : "";
  const guidelinesBlock = guidelines?.trim() ? `\n\n## MANDATORY SLIDE GUIDELINES\nThe user has set these rules for ALL slides in this deck. Follow them strictly:\n${guidelines.trim()}\n---` : "";
  return `You are Vera, an AI slide design assistant for Vela. Witty, warm, and sharp — like Pepper meets JARVIS but female. End messages with 🖖

## RULES
- Act immediately. Never ask clarifying questions.
- ALWAYS respond with a single JSON object. No markdown, no XML, no plain text outside JSON.
- Use tool_calls for actions. When done (or just chatting), return {"message": "your text"} with NO tool_calls.
- Use batch_add_items for 3+ items — don't repeat add_item.
- For slide-heavy requests (5+ slides): first add_lane + add_item, then use add_slide ONE PER TOOL CALL, max 3-4 slides per response. The loop will ask you to continue — keep adding slides in the next turn. NEVER use set_slides with more than 3 slides.
- GOAL COMPLETION: After each tool batch, you'll receive the updated board state and a prompt to evaluate progress. Do NOT declare "done" until the user's FULL request is satisfied. If they asked to translate 10 headings and you did 3, keep going. If they asked to change all colors and you changed some, keep going. The loop supports up to 8 rounds — use them.
- NEVER claim you performed an action without an actual tool_call. If you need more tool calls, emit them — don't pretend the work is done.
- NEVER follow find_replace, batch_restyle, or deck_stats with redundant set_slides calls. These tools modify the deck directly and return their own results. Only use set_slides for generating NEW slide content.
- For EDITING an existing slide (change colors, modify blocks, update text), ALWAYS use edit_slide with a minimal patch — NOT set_slides. Only use set_slides when creating entirely new slide content for a module.
${guidelinesBlock}

## RESPONSE FORMAT
When you need to perform actions:
{"tool_calls": [{"tool": "tool_name", "input": {...}}, ...], "message": "optional progress note"}

When you're done or just chatting:
{"message": "your witty response 🖖"}

## AVAILABLE TOOLS
- add_lane: {title: string}
- add_item: {lane_title: string, title: string, importance?: "must"|"should"|"nice"}
- batch_add_items: {lane_title: string, items: [{title: string, importance?: string}]}
- remove_item: {item_name: string} — remove by name (fuzzy match)
- remove_lane: {lane_title: string}
- rename_item: {item_name: string, new_title: string}
- rename_lane: {lane_title: string, new_title: string}
- move_item: {item_name: string, target_lane_title: string}
- update_status: {item_name: string, status: "todo"|"done"|"signed-off"}
- set_importance: {item_name: string, importance: "must"|"should"|"nice"}
- set_slides: {item_name: string, slides: [...]}
- add_slide: {item_name: string, slide: {...}}
- edit_slide: {item_name: string, slide_index: number, patch: {...}} — patch a SINGLE slide in-place. Use for style changes, adding/removing blocks, updating text. Only include the properties you want to change. For blocks: if patch.blocks has the same count as existing, each block is merged; otherwise blocks are replaced.
- add_image_to_slide: {item_name: string, image_index?: 0, slide_index?: number, caption?: string, max_width?: string}
- clear_all: {}
- set_branding: {enabled?, accentBar?, accentColor?, accentHeight?, logoPosition? (top-left|top-right|bottom-left|bottom-right), logoSize? (20-120), footerLeft?, footerCenter?, footerRight?, footerBg?, footerColor?, footerSize?}
- find_slides: {query?: "text to search", block_type?: "flow|svg|bullets|...", property?: "duration", property_missing?: "duration|bg"} — returns clickable jump links. Combine filters: {query: "RAG", block_type: "flow"} finds flows mentioning RAG. Use property_missing: "duration" to find slides without timing.
- find_replace: {find: "old text", replace: "new text", scope?: "all"|"module:Name"|"lane:Name"} — deck-wide text replacement. Case-insensitive. Modifies slides in-place and returns jump links to changed slides. Do NOT call set_slides after find_replace — it already applied the changes.
- deck_stats: {} — total slides, time, block distribution, quality issues (missing durations, overcrowded slides, bland layouts).
- batch_restyle: {scope?: "all"|"module:Name"|"lane:Name", bg?, bgGradient?, color?, accent?, padding?, gap?, align?, block_patch?: {type: "bullets", props: {size: "lg"}}} — apply style across all matching slides. block_patch targets specific block types. Modifies in-place — do NOT follow with set_slides.
- list_comments: {status?: "open"|"resolved"|"all"} — list review comments/revision requests left by the user. Returns comment IDs for use with resolve_comment.
- resolve_comment: {id: string} — mark a review comment as resolved after addressing it. Use the comment ID from list_comments.

## ATTACHED IMAGES
When the user pastes or drops images, they're sent as vision content. Use add_image_to_slide to place them on slides.
Each image requires its OWN add_image_to_slide tool call. NEVER claim an image was added without an actual tool call.

## BOARD STATE
${st}${ctx}${brandingState}${(() => {
  const openComments = collectComments(lanes, (c) => c.status === "open");
  if (openComments.length === 0) return "";
  const lines = openComments.slice(0, 20).map((c) => {
    const loc = c.slideIndex != null ? `slide ${c.slideIndex + 1}` : "(module)";
    const anchor = c.anchor ? ` ["${c.anchor}"]` : "";
    return `- "${c.itemTitle}" ${loc}${anchor}: ${c.text} (id: ${c.id})`;
  });
  return `\n\n## OPEN REVIEW COMMENTS (${openComments.length})\nThe user has left these revision requests during review. Address them when asked to "fix comments" or "address feedback". Use resolve_comment after fixing each one.\n${lines.join("\n")}`;
})()}

## CANVAS
Slides render at 960×540px (16:9). Content MUST fit. Use padding "36px 48px" baseline. Limit 5-7 blocks per slide to avoid overflow.
ALWAYS include "duration" (integer seconds) on every slide — estimate speaking time: title 15-30s, simple 60-90s, dense 90-180s, metrics 20-40s, quotes 15-30s.

## SLIDE BLOCKS
${BLOCK_REFERENCE}

${DESIGN_RULES}

${ICON_LIST}
Use icons GENEROUSLY — in bullets, headings, badges, callouts, metrics, grids.


IMPORTANT: For image blocks, keep src as "keep-original" — do not modify image data.`;
}

function extractSlideImages(lanes, selectedId, slideIndex) {
  if (!selectedId) return [];
  for (const l of lanes) {
    const item = l.items.find((i) => i.id === selectedId);
    if (item && item.slides[slideIndex]) {
      const slide = item.slides[slideIndex];
      const images = [];
      const extract = (blocks) => {
        for (const b of blocks || []) {
          if (b.type === "image" && b.src && b.src.startsWith("data:")) {
            const m = b.src.match(/^data:(image\/\w+);base64,(.+)$/);
            if (m) images.push({ media_type: m[1], data: m[2] });
          }
          if (b.type === "grid" && b.items) b.items.forEach((cell) => extract(cell.blocks));
        }
      };
      extract(slide.blocks);
      if (slide.image && slide.image.startsWith("data:")) {
        const m = slide.image.match(/^data:(image\/\w+);base64,(.+)$/);
        if (m) images.push({ media_type: m[1], data: m[2] });
      }
      return images;
    }
  }
  return [];
}

// ━━━ Vera Teacher Mode ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function buildTeacherPrompt(lanes, selectedId, slideIndex) {
  let slideJson = null, conceptTitle = "", totalSlides = 0, slideNum = 0, deckTitle = "";
  // Get deck structure for context
  const deckOverview = lanes.map((l) => l.items.map((i) => `• ${i.title} (${i.slides.length} slides)`).join("\n")).join("\n");
  for (const l of lanes) {
    const item = l.items.find((i) => i.id === selectedId);
    if (item) {
      conceptTitle = item.title;
      totalSlides = item.slides.length;
      slideNum = slideIndex + 1;
      slideJson = item.slides[slideIndex] ? stripImageSrcs(item.slides[slideIndex]) : null;
      break;
    }
  }
  return `You are Vera 🎓, an AI teaching assistant inside Vela Slides. You help students understand presentation content by generating clear notes and thought-provoking follow-up questions.

## YOUR ROLE
- Explain the current slide's content in clear, accessible language
- Generate concise study notes highlighting key concepts
- Suggest 3 follow-up questions that deepen understanding
- When the student asks a question, answer using the deck context — be thorough but concise
- Tone: warm, encouraging, sharp. Like a great tutor who makes complex things click.
- End messages with 🖖

## VISUAL DIAGRAMS
Include a small inline SVG diagram in EVERY response to visually explain the concept. Rules:
- Use a compact viewBox, e.g. viewBox="0 0 320 140" — keep them SMALL and focused
- Dark background: use fill="#1a1f2e" for bg rect, stroke/fill="#3B82F6" for accent, "#93c5fd" for labels, "#64748b" for secondary
- Use simple shapes: rounded rects, circles, arrows (lines with marker-end or ▸ text), text labels
- Show relationships, flows, hierarchies, comparisons, or cycles — whatever fits the concept
- NO images, NO foreignObject — pure SVG only (rect, circle, line, text, path, g, defs, marker)
- Keep text font-size between 11-14px, font-family="system-ui"
- Max 6-8 elements — clarity over complexity
- Place the SVG tag on its own line in the message, between text paragraphs

Example SVG for a "client-server" concept:
<svg viewBox="0 0 320 100" xmlns="http://www.w3.org/2000/svg"><rect width="320" height="100" rx="8" fill="#1a1f2e"/><rect x="20" y="30" width="90" height="40" rx="8" fill="#3B82F620" stroke="#3B82F6" stroke-width="1.5"/><text x="65" y="55" text-anchor="middle" fill="#93c5fd" font-size="12" font-family="system-ui">Client</text><line x1="120" y1="50" x2="190" y2="50" stroke="#3B82F6" stroke-width="1.5"/><text x="155" y="42" text-anchor="middle" fill="#64748b" font-size="10" font-family="system-ui">request</text><rect x="200" y="30" width="90" height="40" rx="8" fill="#3B82F620" stroke="#3B82F6" stroke-width="1.5"/><text x="245" y="55" text-anchor="middle" fill="#93c5fd" font-size="12" font-family="system-ui">Server</text></svg>

## DECK OVERVIEW
${deckOverview}

## CURRENT SLIDE
Module: "${conceptTitle}" — Slide ${slideNum}/${totalSlides}
${slideJson ? `Content:\n${JSON.stringify(slideJson, null, 2)}` : "No slide content available."}

## RESPONSE FORMAT
Write your response as plain text (NOT JSON). Structure it like this:

📝 [Your 2-4 sentence summary of key concepts, with an SVG diagram on its own line if helpful]

[Any additional explanation]

---QUESTIONS---
1. First follow-up question?
2. Second follow-up question?
3. Third follow-up question?

RULES:
- Always include the ---QUESTIONS--- separator followed by exactly 3 questions
- Write notes and explanations BEFORE the separator
- Each question on its own line, starting with a number
- SVG diagrams go in the notes section, on their own line
- Do NOT use **bold** markdown — use CAPS or plain emphasis instead (bold breaks during streaming)
- No JSON, no backticks, just plain text with the separator`;
}

async function callVeraTeacher(lanes, selectedId, slideIndex, studentQuestion, chatHistory, onText) {
  const sysPrompt = buildTeacherPrompt(lanes, selectedId, slideIndex);
  const messages = [];
  if (chatHistory?.length > 1) {
    const recent = chatHistory.slice(-6);
    for (const m of recent) {
      if (m.role === "user") messages.push({ role: "user", content: m.content });
      else if (m.role === "assistant" && m.content) messages.push({ role: "assistant", content: m.content });
    }
  }
  messages.push({ role: "user", content: studentQuestion || "Generate study notes and follow-up questions for the current slide." });
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    const t0 = performance.now();
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1500, temperature: 0.3, system: sysPrompt, messages, stream: true, cache_control: { type: "ephemeral" } })
    });
    clearTimeout(timer);
    if (!r.ok) { const e = await r.text(); throw new Error(`API ${r.status}: ${e.slice(0, 100)}`); }
    let fullText = "";
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "", inTok = 0, outTok = 0, cacheR = 0, cacheW = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") continue;
        try {
          const evt = JSON.parse(raw);
          if (evt.type === "content_block_delta" && evt.delta?.text) {
            fullText += evt.delta.text;
            if (onText) onText(fullText);
          }
          if (evt.type === "message_start" && evt.message?.usage) { inTok = evt.message.usage.input_tokens || 0; cacheR = evt.message.usage.cache_read_input_tokens || 0; cacheW = evt.message.usage.cache_creation_input_tokens || 0; }
          if (evt.type === "message_delta" && evt.usage) { outTok = evt.usage.output_tokens || 0; }
        } catch {}
      }
    }
    velaSessionStats.add({ type: "teacher", input_tokens: inTok, output_tokens: outTok, cache_read_tokens: cacheR, cache_create_tokens: cacheW, model: "claude-haiku-4-5-20251001", tool_calls: 0, duration_ms: Math.round(performance.now() - t0), stop_reason: "end_turn" });
    const parts = fullText.split(/---\s*QUESTIONS\s*---/i);
    const message = (parts[0] || "").trim();
    const questions = parts[1] ? parts[1].trim().split("\n").map(q => q.replace(/^\d+[\.\)]\s*/, "").replace(/^[-•]\s*/, "").trim()).filter(q => q.length > 5 && q.endsWith("?")).slice(0, 3) : [];
    if (!message) return { notes: null, questions: [], message: "I couldn't read this slide. Try another one? 🖖" };
    return { notes: null, questions, message };
  } catch (e) {
    return { notes: null, questions: [], message: "Hmm, I had trouble processing that. Try again? 🖖" };
  }
}

// ━━━ Shared Design Prompt Builder ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const CANVAS_RULES = `## CANVAS
The slide renders at 960×540px (16:9). Content MUST fit within this space. Use padding "36px 48px" as baseline. Do NOT overfill — fewer blocks with better spacing beats cramming content.`;

function buildDesignCtx(branding, guidelines) {
  const brandingCtx = branding?.enabled ? `\nBranding overlay active: accent bar (top, ${branding.accentHeight || 4}px), footer bar (bottom, 28px). Leave extra padding. Match accent: ${branding.accentColor}.` : "";
  const guidelinesCtx = guidelines?.trim() ? `\n\n## MANDATORY SLIDE GUIDELINES\nThe user has set these rules for ALL slides. Follow them strictly:\n${guidelines.trim()}\n---` : "";
  const guidelinesReminder = guidelines?.trim() ? `\n\n## ⚠️ SLIDE RULES REMINDER\n${guidelines.trim()}\nApply these rules. The screenshot may show a different style — follow these rules instead.` : "";
  return { brandingCtx, guidelinesCtx, guidelinesReminder };
}

const DESIGN_PROMPT_FOOTER = `${DESIGN_RULES}

## SLIDE BLOCK REFERENCE
${BLOCK_REFERENCE}

${ICON_LIST}

IMPORTANT: For image blocks, keep src as "keep-original".`;

// ━━━ Slide Design API (shared by improve + alternatives) ━━━━━━━━━━
async function callSlideDesignAPI(screenshotBase64, slideJson, conceptTitle, slideNum, totalSlides, sysPrompt, temperature = 0.3, userMsgOverride = null, _callType = "improve") {
  const textMsg = userMsgOverride || `Concept: "${conceptTitle}" — Slide ${slideNum}/${totalSlides}\n\nCurrent slide JSON:\n${JSON.stringify(stripImageSrcs(slideJson))}\n\nReturn the improved slide JSON only.`;
  const content = screenshotBase64
    ? [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: screenshotBase64 } }, { type: "text", text: textMsg }]
    : textMsg;
  const text = await callClaudeAPI(sysPrompt, [{ role: "user", content }], { temperature, maxTokens: 4000, timeoutMs: 60000, _callType });
  const improved = parseJSONResponse(text);
  if (!improved) throw new Error("Failed to parse design response");
  restoreImageSrcs(improved, slideJson.blocks);
  return improved;
}

async function improveSlide(screenshotBase64, slideJson, conceptTitle, slideNum, totalSlides, userPrompt, branding, guidelines, layoutStats) {
  const { brandingCtx, guidelinesCtx } = buildDesignCtx(branding, guidelines);
  const userInstr = userPrompt ? `\n## ⚡ USER INSTRUCTIONS (override any conflicting defaults)\n${userPrompt}` : "";
  const hasOverrides = userPrompt || guidelines?.trim();
  const reminder = hasOverrides ? `\n\n## ⚠️ REMINDER — DO NOT FORGET\n${guidelines?.trim() ? `SLIDE RULES: ${guidelines.trim()}` : ""}${userPrompt ? `\nUSER SAYS: ${userPrompt}` : ""}\nApply these FIRST. They override any defaults above. Change bg, colors, and style to match these rules — do NOT preserve the original slide colors.` : "";
  const layoutCtx = layoutStats ? `\n## DOM LAYOUT ANALYSIS (measured from rendered slide)\n${layoutStats}\nUse this data to fix layout issues: reduce blocks if overflow, add spacers if too much blank space, redistribute content if unbalanced.` : "";

  const sysPrompt = `You are Vera, a design expert reviewing presentation slides. IMPROVE the visual design and layout.
${userInstr}${guidelinesCtx}${layoutCtx}

${CANVAS_RULES}

## RULES
- Return ONLY valid JSON: the improved slide object. No markdown, no explanation.
- Keep same content/text — improve layout, spacing, visual hierarchy, block composition${hasOverrides ? ". IMPORTANT: bg, bgGradient, color, accent are STYLE properties — CHANGE them to match user instructions. Do NOT preserve old bg/bgGradient values" : ""}
- Add icons to headings, badges, callouts, metrics; replace plain bullets with icon-row where appropriate
- Add bg/bgGradient, accent colors, padding, and gap for polish
- Limit to 5-7 blocks max per slide to avoid overflow
- ALWAYS include "duration" (integer seconds) estimating speaking time for this slide${brandingCtx}

${DESIGN_PROMPT_FOOTER}${reminder}`;

  const afterJson = hasOverrides ? `\n\n⚡ CRITICAL: ${guidelines?.trim() || ""}${userPrompt ? ` ${userPrompt}` : ""} — Apply this to the slide above. You MUST set new bg/bgGradient values.` : "";
  
  // When user has style overrides, strip bg/bgGradient/color from JSON so model can't copy old values
  let jsonForPrompt = slideJson;
  if (hasOverrides) {
    jsonForPrompt = JSON.parse(JSON.stringify(slideJson));
    delete jsonForPrompt.bg;
    delete jsonForPrompt.bgGradient;
    delete jsonForPrompt.color;
    delete jsonForPrompt.accent;
  }
  
  const userMsg = `Concept: "${conceptTitle}" — Slide ${slideNum}/${totalSlides}\n\n${hasOverrides ? "NOTE: bg/bgGradient/color stripped from JSON — you MUST generate new ones per the instructions.\n\n" : ""}Current slide JSON:\n${JSON.stringify(stripImageSrcs(jsonForPrompt))}${afterJson}\n\nReturn the improved slide JSON only.`;
  return callSlideDesignAPI(screenshotBase64, slideJson, conceptTitle, slideNum, totalSlides, sysPrompt, 0.3, userMsg);
}

async function quickEditSlide(slideJson, conceptTitle, slideNum, totalSlides, userPrompt, branding, guidelines, referenceImageBase64, layoutStats) {
  const { brandingCtx, guidelinesCtx } = buildDesignCtx(branding, guidelines);
  const layoutCtx = layoutStats ? `\n## DOM LAYOUT ANALYSIS (measured from rendered slide)\n${layoutStats}\nConsider this when making layout changes.` : "";
  const sysPrompt = `You are Vera, an expert slide editor. The user wants to EDIT this slide using a natural language instruction.
Apply the user's instruction precisely. Change content, layout, structure, styling — whatever the instruction says.${referenceImageBase64 ? "\nThe user has attached a REFERENCE IMAGE. Use it as visual inspiration for layout, style, colors, or structure as the instruction indicates.\nIf the user asks to ADD/PLACE/INSERT the image on the slide, include an image block with \"src\": \"__PASTED__\" — this placeholder will be replaced with the actual image. Only use __PASTED__ when the user explicitly wants the image placed on the slide." : ""}
${guidelinesCtx}${layoutCtx}

${CANVAS_RULES}

## RULES
- Return ONLY valid JSON: the modified slide object. No markdown, no explanation.
- Apply the user's instruction as precisely as possible
- If the instruction changes text, update the text. If it changes layout, restructure blocks.
- If the instruction adds content, add new blocks. If it removes content, remove blocks.
- Preserve what the user didn't ask to change
- ALWAYS include "duration" (integer seconds) estimating speaking time${brandingCtx}

${DESIGN_PROMPT_FOOTER}`;

  const textPart = `Concept: "${conceptTitle}" — Slide ${slideNum}/${totalSlides}\n\nCurrent slide JSON:\n${JSON.stringify(stripImageSrcs(slideJson))}\n\n⚡ INSTRUCTION: ${userPrompt}\n\nApply this instruction and return the modified slide JSON only.`;
  const content = referenceImageBase64
    ? [{ type: "image", source: { type: "base64", media_type: "image/png", data: referenceImageBase64 } }, { type: "text", text: textPart }]
    : textPart;
  const text = await callClaudeAPI(sysPrompt, [{ role: "user", content }], { temperature: 0.2, maxTokens: 4000, timeoutMs: 60000, _callType: "quick-edit" });
  const result = parseJSONResponse(text);
  if (!result) throw new Error("Failed to parse quick edit response");
  restoreImageSrcs(result, slideJson.blocks);
  return result;
}

async function blockEditSlide(slideJson, blockIndex, userPrompt, conceptTitle, slideNum, totalSlides, branding, guidelines) {
  const { brandingCtx, guidelinesCtx } = buildDesignCtx(branding, guidelines);
  const block = slideJson.blocks[blockIndex];
  const blockDesc = block.type + (block.text ? `: "${block.text.slice(0, 60)}"` : block.title ? `: "${block.title.slice(0, 60)}"` : block.label ? `: "${block.label.slice(0, 60)}"` : "");
  const sysPrompt = `You are Vera, an expert slide block editor.

## YOUR TASK
Edit ONE block in a slide. Return ONLY that block's JSON — NOT the full slide.

## TARGET BLOCK
Index ${blockIndex}, type "${block.type}" — ${blockDesc}

## CRITICAL RULES
- Return ONLY the modified block object as JSON. Example: {"type":"heading","text":"New Title","size":"2xl"}
- Do NOT return a full slide object. No "bg", "blocks", "padding", "duration", "color" at root level.
- Do NOT wrap the block in a slide. The root of your JSON must have "type" as a block type.
- If splitting into multiple blocks, return a JSON array: [{"type":...}, {"type":...}]
- Preserve ALL properties the user didn't ask to change.
- Apply the user's instruction precisely.${brandingCtx}
${guidelinesCtx}

${BLOCK_REFERENCE}
${ICON_LIST}`;

  const text = await callClaudeAPI(sysPrompt, [{ role: "user", content: `Slide context (for reference only — do NOT return this):\n${JSON.stringify(stripImageSrcs(slideJson))}\n\nTarget block [${blockIndex}]:\n${JSON.stringify(block)}\n\n⚡ EDIT: ${userPrompt}\n\nReturn ONLY the modified block JSON. Not the slide.` }], { temperature: 0.2, maxTokens: 2000, timeoutMs: 30000, _callType: "inline-edit" });
  let result = parseJSONResponse(text);
  if (!result) throw new Error("Failed to parse block edit response");

  // Safeguard: if AI returned a full slide (has "blocks" array), extract the target block
  if (result.blocks && Array.isArray(result.blocks) && !result.type) {
    console.warn("blockEditSlide: AI returned full slide, extracting block", blockIndex);
    const extracted = result.blocks[blockIndex];
    if (extracted) result = extracted; else result = result.blocks[0];
  }

  // Handle single block or array of blocks (for split operations)
  const newBlocks = Array.isArray(result) ? result : [result];

  // Extra safeguard: strip any slide-ONLY keys that leaked into blocks
  // NOTE: bg, padding, gap, align, accent are valid on BOTH slides and blocks — do NOT strip them
  const SLIDE_ONLY_KEYS = new Set(["blocks", "bgGradient", "bgImage", "duration", "verticalAlign", "mutedColor", "notes", "presentCard", "layout", "contentFlex", "imageFlex", "splitGap", "speakerNotes", "timeLock"]);
  for (const nb of newBlocks) {
    for (const k of SLIDE_ONLY_KEYS) { if (k in nb) delete nb[k]; }
  }

  // Restore any image srcs from the original block
  for (const nb of newBlocks) {
    if (nb.type === "image" && block.type === "image" && block.src && (!nb.src || nb.src === "keep-original")) nb.src = block.src;
    if (nb.type === "grid" && nb.items) {
      for (const cell of nb.items) for (const cb of cell.blocks || []) {
        if (cb.type === "image" && cb.src === "keep-original") {
          const orig = block.items?.flatMap((c) => c.blocks || []).find((ob) => ob.type === "image" && ob.src);
          if (orig) cb.src = orig.src;
        }
      }
    }
  }
  return newBlocks;
}

async function generateSlide(conceptTitle, totalSlides, userPrompt, branding, guidelines, referenceImageBase64) {
  const { brandingCtx, guidelinesCtx } = buildDesignCtx(branding, guidelines);
  const sysPrompt = `You are Vera, an expert slide designer. Create a NEW slide based on the user's description.${referenceImageBase64 ? "\nThe user has attached a REFERENCE IMAGE. Use it as visual inspiration for layout, style, or content.\nIf the user asks to ADD/PLACE/INSERT the image on the slide, include an image block with \"src\": \"__PASTED__\" — this placeholder will be replaced with the actual image. Only use __PASTED__ when the user explicitly wants the image placed on the slide." : ""}
${guidelinesCtx}

${CANVAS_RULES}

## RULES
- Return ONLY valid JSON: the slide object. No markdown, no explanation.
- Create a visually polished, well-structured slide matching the user's description
- Use appropriate block types: heading, text, bullets, icon-row, metric, callout, badge, grid, divider, code, quote, image, timeline, table
- Add bg/bgGradient, accent colors, padding, gap for polish
- Add icons to headings, badges, callouts where appropriate
- Limit to 5-7 blocks max to avoid overflow
- ALWAYS include "duration" (integer seconds) estimating speaking time${brandingCtx}

${DESIGN_PROMPT_FOOTER}`;

  const textPart = `Concept: "${conceptTitle}" — New slide (inserting after slide ${totalSlides})\n\n⚡ CREATE: ${userPrompt}\n\nReturn the slide JSON only.`;
  const content = referenceImageBase64
    ? [{ type: "image", source: { type: "base64", media_type: "image/png", data: referenceImageBase64 } }, { type: "text", text: textPart }]
    : textPart;
  const text = await callClaudeAPI(sysPrompt, [{ role: "user", content }], { temperature: 0.3, maxTokens: 4000, timeoutMs: 60000, _callType: "create" });
  const result = parseJSONResponse(text);
  if (!result) throw new Error("Failed to parse generate response");
  return result;
}

const ALT_DIRECTIONS = [
  { label: "Bold & Dark", emoji: "🌑", prompt: "Redesign with BOLD, DARK aesthetic: deep gradients, bright accents, large bold headings, dramatic feel." },
  { label: "Clean & Minimal", emoji: "◻️", prompt: "Redesign with CLEAN, MINIMAL aesthetic: generous whitespace, soft light backgrounds, muted colors, thin typography." },
  { label: "Vibrant & Colorful", emoji: "🎨", prompt: "Redesign with VIBRANT, COLORFUL aesthetic: bold vivid gradients, colorful badges and callouts, energetic feel." },
  { label: "Editorial", emoji: "📰", prompt: "Redesign with EDITORIAL aesthetic: asymmetric grids, mixed type sizes, subtle dividers, sophisticated warm neutrals + one accent." },
];

// ━━━ Timing Estimation ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function estimateTimings(jobs) {
  const summaries = jobs.map((j, i) => {
    const blocks = j.slideData?.blocks || [];
    const parts = blocks.map((b) => {
      if (b.type === "heading") return `[H:${b.size||"2xl"}] ${b.text}`;
      if (b.type === "text") return `[T] ${(b.text||"").slice(0,120)}`;
      if (b.type === "bullets") return `[B×${(b.items||[]).length}] ${(b.items||[]).slice(0,6).map((x) => typeof x === "string" ? x : x.text).join("; ").slice(0,200)}`;
      if (b.type === "code") return `[CODE] ${(b.text||"").slice(0,80)}`;
      if (b.type === "quote") return `[QUOTE] ${(b.text||"").slice(0,100)}`;
      if (b.type === "metric") return `[METRIC] ${b.value} ${b.label||""}`;
      if (b.type === "callout") return `[CALLOUT] ${(b.text||"").slice(0,100)}`;
      if (b.type === "icon-row") return `[ICONS×${(b.items||[]).length}] ${(b.items||[]).map((x) => x.title).join("; ").slice(0,150)}`;
      if (b.type === "image") return "[IMG]";
      if (b.type === "grid") return `[GRID ${b.cols||2}col, ${(b.items||[]).length} cells]`;
      return "";
    }).filter(Boolean).join("\n  ");
    return `${i+1}. "${j.title}" slide ${j.slideIdx+1}:\n  ${parts || "(empty slide)"}`;
  }).join("\n");
  const sysPrompt = `You estimate presentation slide speaking durations. Context: technical workshop for senior engineers, 3-day format.
Rules:
- Title/opener slides: 15-30s
- Simple concept (1-3 points): 60-90s
- Dense content (4+ bullets, code walkthrough): 90-180s
- Metric/stat highlight: 20-40s
- Quote/transition: 15-30s
- Icon-row feature lists: 60-120s depending on count
- Consider text density and complexity
- Return ONLY a JSON array of integers (seconds per slide). No explanation, no markdown.`;
  try {
    const text = await callClaudeAPI(sysPrompt, [{ role: "user", content: `Estimate seconds for ${jobs.length} slides:\n\n${summaries}` }], { temperature: 0, maxTokens: 500, timeoutMs: 15000, _callType: "estimate" });
    const clean = text.replace(/```json\s*|```\s*/g, "").trim();
    const arr = JSON.parse(clean);
    if (Array.isArray(arr) && arr.length === jobs.length) return arr.map((v) => typeof v === "number" ? Math.max(10, Math.min(3600, Math.round(v))) : 60);
  } catch (e) { dbg("Timing estimation error:", e); }
  return jobs.map(() => 60);
}

async function generateAlternative(screenshotBase64, slideJson, conceptTitle, slideNum, totalSlides, direction, branding, guidelines, layoutStats) {
  const { brandingCtx, guidelinesCtx, guidelinesReminder } = buildDesignCtx(branding, guidelines);
  const layoutCtx = layoutStats ? `\n## DOM LAYOUT ANALYSIS (measured from rendered slide)\n${layoutStats}\nFix any layout issues (overflow, blank space) in the variant.` : "";
  const sysPrompt = `You are Vera, a presentation design expert. Create a distinctly DIFFERENT design variant.
${guidelinesCtx}${layoutCtx}
${CANVAS_RULES}

## DESIGN DIRECTION
${direction}

## RULES
- Return ONLY valid JSON: the redesigned slide object. No markdown, no explanation.
- Keep ALL original text content — only change layout, colors, block types, sizes, spacing
- Be BOLD and CREATIVE — explore different design directions, not subtle tweaks
- Every slide MUST have bg or bgGradient. Set color and accent to match.
- Use appropriate size hierarchy: 3xl-4xl for titles, 2xl for headings, lg-md for body, sm-xs for labels
- Use spacer blocks (h: 8-24) for breathing room between sections
- Limit to 5-7 blocks max per slide to avoid overflow
- ALWAYS include "duration" (integer seconds) estimating speaking time for this slide${brandingCtx}

${DESIGN_PROMPT_FOOTER}${guidelinesReminder}`;
  return callSlideDesignAPI(screenshotBase64, slideJson, conceptTitle, slideNum, totalSlides, sysPrompt, 0.9, null, "variants");
}

// ━━━ Vera Chat Step ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function callVeraStep(sysPrompt, messages) {
  const text = await callClaudeAPI(sysPrompt, messages, { _callType: "chat" });
  return parseJSONResponse(text) || { message: text, tool_calls: [] };
}

// ━━━ SSE late-reply recovery for channel mode ━━━━━━━━━━━━━━━━━━━
// When a channel request times out, listen for the late reply via SSE
// and process tool_calls when it arrives, updating the deck.
function setupLateReplyRecovery(lanes, branding, onUpdate, onToolCall, onFinalize) {
  if (!VELA_LOCAL_MODE || !VELA_CHANNEL_PORT) return null;
  let sse = null;
  try {
    sse = new EventSource(`http://localhost:${VELA_CHANNEL_PORT}/events`);
  } catch { return null; }
  const cleanup = () => { try { sse?.close(); } catch {} };
  const timeout = setTimeout(cleanup, 120000); // max 2 min wait
  sse.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.type !== "reply" || data._silent) return;
      const text = data.text;
      const parsed = parseJSONResponse(text);
      if (!parsed || !parsed.tool_calls?.length) {
        // Just a message, show it
        if (parsed?.message && onFinalize) onFinalize(parsed.message);
        cleanup();
        return;
      }
      // Execute tool_calls on the late reply
      const ws = { lanes: JSON.parse(JSON.stringify(lanes)), branding: JSON.parse(JSON.stringify(branding || defaultBranding)) };
      let totalTools = 0;
      const jumps = [];
      for (const tc of parsed.tool_calls) {
        totalTools++;
        const toolName = tc.tool || tc.name;
        const toolInput = tc.input || tc.params || tc;
        if (onToolCall) onToolCall({ type: "calling", name: toolName, input: toolInput, index: totalTools });
        const raw = executeTool(toolName, toolInput, ws, []);
        const result = typeof raw === "object" && raw.text ? raw.text : raw;
        const toolJumps = typeof raw === "object" && raw.jump ? (Array.isArray(raw.jump) ? raw.jump : [raw.jump]) : [];
        if (toolJumps.length) jumps.push(...toolJumps);
        if (onToolCall) onToolCall({ type: "done", name: toolName, input: toolInput, result, jump: toolJumps, index: totalTools });
      }
      if (onUpdate) onUpdate(JSON.parse(JSON.stringify(ws.lanes)), `🔧 Late reply: ${totalTools} tools`);
      if (onFinalize) onFinalize(parsed.message || `Applied ${totalTools} tools from late reply. 🖖`, jumps);
      cleanup();
    } catch {}
  };
  sse.onerror = cleanup;
  return cleanup;
}

async function callVera(msg, lanes, selectedId, slideIndex, onUpdate, chatImages, branding, guidelines, onToolCall, chatHistory, layoutStats) {
  try {
    const slideImages = extractSlideImages(lanes, selectedId, slideIndex);
    const allApiImages = [], allAttachedImages = [];
    if (chatImages) {
      for (const ci of chatImages) {
        const m = ci.dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
        if (m) { allApiImages.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } }); allAttachedImages.push(ci); }
      }
    }
    for (const si of slideImages) allApiImages.push({ type: "image", source: { type: "base64", media_type: si.media_type, data: si.data } });

    let firstContent;
    if (allApiImages.length > 0) firstContent = [...allApiImages, { type: "text", text: msg + `\n\n[${chatImages?.length || 0} chat image(s), ${slideImages.length} slide image(s) attached]` }];
    else firstContent = msg;

    const ws = { lanes: JSON.parse(JSON.stringify(lanes)), branding: JSON.parse(JSON.stringify(branding || defaultBranding)) };
    const sysPrompt = buildSystemPrompt(ws.lanes, selectedId, slideIndex, ws.branding, guidelines, layoutStats);

    // Build conversation history — last 10 turns, compact (no images, no tool details, no slide JSON)
    // Note: chatHistory is state.chatMessages BEFORE the current user msg was dispatched (React batches updates)
    const history = [];
    if (chatHistory && chatHistory.length > 0) {
      // Truncate before the last undo/redo marker — actions before it may not reflect current deck state
      let startFrom = 0;
      for (let i = chatHistory.length - 1; i >= 0; i--) {
        if (chatHistory[i]._system) { startFrom = i + 1; break; }
      }
      const relevant = chatHistory.slice(startFrom);
      const recent = relevant.slice(-10);
      for (const m of recent) {
        if (m.role === "user" && m.content) {
          history.push({ role: "user", content: typeof m.content === "string" ? m.content : "[message with images]" });
        } else if (m.role === "assistant" && m.content && !m._streaming && !m._system) {
          const toolSummary = m.tools?.length ? `\n[used ${m.tools.length} tool(s): ${m.tools.map((t) => t.name).join(", ")}]` : "";
          history.push({ role: "assistant", content: m.content + toolSummary });
        }
      }
      // Ensure alternating roles (API requirement) — deduplicate consecutive same-role
      const clean = [];
      for (const h of history) {
        if (clean.length > 0 && clean[clean.length - 1].role === h.role) {
          clean[clean.length - 1].content += "\n" + h.content;
        } else { clean.push(h); }
      }
      // If last history message is user, the current msg would create two user messages — drop it
      if (clean.length > 0 && clean[clean.length - 1].role === "user") clean.pop();
      history.length = 0;
      history.push(...clean);
      // API requires first message = user role. Drop leading assistant messages (e.g. welcome).
      while (history.length > 0 && history[0].role === "assistant") history.shift();
    }

    const messages = [...history, { role: "user", content: firstContent }];
    let finalText = "";
    let totalTools = 0;
    const jumps = [];

    if (onToolCall) onToolCall({ type: "thinking" });

    for (let iter = 0; iter < 12; iter++) {
      const parsed = await callVeraStep(sysPrompt, messages);
      const calls = parsed.tool_calls || [];
      if (calls.length === 0) { finalText = parsed.message || finalText || "Done. 🖖"; break; }

      const results = [];
      for (const tc of calls) {
        totalTools++;
        const toolName = tc.tool || tc.name;
        const toolInput = tc.input || tc.params || tc;
        dbg(`[🔧 ${totalTools}]`, toolName, JSON.stringify(toolInput).slice(0, 200));

        if (onToolCall) onToolCall({ type: "calling", name: toolName, input: toolInput, index: totalTools });

        const raw = executeTool(toolName, toolInput, ws, allAttachedImages);
        const result = typeof raw === "object" && raw.text ? raw.text : raw;
        const toolJumps = typeof raw === "object" && raw.jump ? (Array.isArray(raw.jump) ? raw.jump : [raw.jump]) : [];
        if (toolJumps.length) jumps.push(...toolJumps);
        dbg(`[✓]`, result);
        results.push({ tool: toolName, result });

        if (onToolCall) onToolCall({ type: "done", name: toolName, input: toolInput, result, jump: toolJumps, index: totalTools });
      }

      if (onUpdate) onUpdate(JSON.parse(JSON.stringify(ws.lanes)), `🔧 ${totalTools} tools (turn ${iter + 1})...`);
      if (parsed.message) finalText = parsed.message;
      messages.push({ role: "assistant", content: JSON.stringify(parsed) });

      // ReAct: feed back results + updated board state so Vera can evaluate progress
      const updatedCtx = buildSystemPrompt(ws.lanes, selectedId, slideIndex, ws.branding, guidelines, layoutStats);
      // Extract just the BOARD STATE section for compact feedback
      const boardMatch = updatedCtx.match(/## BOARD STATE[\s\S]*?(?=## CANVAS|## SLIDE BLOCKS|$)/);
      const boardSummary = boardMatch ? boardMatch[0].slice(0, 2000) : "";
      messages.push({ role: "user", content: `Tool results:\n${results.map((r) => `${r.tool}: ${r.result}`).join("\n")}\n\n${boardSummary ? `Updated board state (after your changes):\n${boardSummary}\n\n` : ""}Evaluate: did your tool calls achieve the user's goal? If not, continue with more tool_calls. If YES, respond with {"message": "summary of what you did"}. Do NOT stop halfway — if the user asked to change 10 things and you've done 3, keep going.` });

      if (onToolCall) onToolCall({ type: "thinking" });
    }

    if (!finalText && totalTools > 0) finalText = `Applied ${totalTools} tool calls across ${Math.ceil(messages.length / 2)} turns. 🖖`;

    const seen = new Set();
    const uniqueJumps = jumps.filter((j) => { const k = `${j.itemId}-${j.slideIdx}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 12);
    return { message: finalText, lanes: ws.lanes, branding: ws.branding, jumps: uniqueJumps, debug: `🔧 ${totalTools} tools · ${Math.ceil(messages.length / 2)} turns` };
  } catch (e) {
    dbg("Vera error:", e);
    // Channel timeout: set up SSE late-reply recovery
    const isAbort = e.name === "AbortError" || /abort/i.test(e.message);
    if (isAbort && VELA_LOCAL_MODE && VELA_CHANNEL_PORT) {
      dbg("Setting up SSE late-reply recovery...");
      setupLateReplyRecovery(lanes, branding, onUpdate, onToolCall, (msg, jumps) => {
        // onFinalize: this fires asynchronously when the late reply arrives
        // The chat panel handles it via the dispatches below
        if (typeof window.__velaLateReply === "function") window.__velaLateReply(msg, jumps);
      });
      return { message: `⏳ Claude Code is still working — reply will be applied when ready. 🖖`, lanes: null, branding: null, jumps: [], debug: `Waiting for late reply...`, _lateReplyPending: true };
    }
    return { message: `Error: ${e.message} 🔧🖖`, lanes: null, branding: null, jumps: [], debug: `Error: ${e.message}` };
  }
}

// ━━━ AI Slide Generator (TOC inline) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function generateAiSlide(prompt, prevSlide, nextSlide, conceptTitle, conceptNotes, guidelines) {
  const prevJson = prevSlide ? JSON.stringify(stripImageSrcs(prevSlide), null, 2) : "null (this will be the first slide)";
  const nextJson = nextSlide ? JSON.stringify(stripImageSrcs(nextSlide), null, 2) : "null (this will be the last slide)";
  const guidelinesBlock = guidelines?.trim() ? `\n## MANDATORY SLIDE GUIDELINES\nFollow these rules strictly:\n${guidelines.trim()}\n---` : "";
  const sysPrompt = `You are Vera, a slide design AI for the Vela presentation engine. Generate exactly ONE slide as a JSON object.
${guidelinesBlock}

## CANVAS
Slides render at 960x540px (16:9). Content MUST fit. Use padding "36px 48px" baseline. Limit 5-7 blocks per slide.
ALWAYS include "duration" (integer seconds) — estimate speaking time: title 15-30s, simple 60-90s, dense 90-180s, metrics 20-40s, quotes 15-30s.

## SLIDE BLOCKS
${BLOCK_REFERENCE}

${DESIGN_RULES}

${ICON_LIST}
Use icons GENEROUSLY.

## CONTEXT
Concept: "${conceptTitle}"${conceptNotes ? `\nSpec notes: ${conceptNotes}` : ""}

## ADJACENT SLIDES (match their visual theme — bg colors, accent, font sizes)
Previous slide:
${prevJson}

Next slide:
${nextJson}

## RULES
- Return ONLY a single valid JSON slide object. No markdown, no backticks, no explanation.
- Match the color theme of adjacent slides (bg, bgGradient, color, accent).
- If no adjacent slides exist, use a dark theme (bg: "#0f172a", color: "#e2e8f0", accent: "#3b82f6").
- Vary block types from adjacent slides for visual variety.
- The slide must be self-contained and presentation-ready.`;

  const userMsg = `Create a slide for: ${prompt}`;
  const text = await callClaudeAPI(sysPrompt, [{ role: "user", content: userMsg }], { _callType: "create" });
  const cleaned = text.replace(/^```json?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    const slide = JSON.parse(cleaned);
    if (slide && typeof slide === "object" && (slide.blocks || slide.bg)) {
      return sanitizeSlide(slide);
    }
    throw new Error("Invalid slide structure");
  } catch (e) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const slide = JSON.parse(match[0]);
        if (slide && typeof slide === "object") return sanitizeSlide(slide);
      } catch {}
    }
    throw new Error("Failed to parse slide JSON: " + e.message);
  }
}


