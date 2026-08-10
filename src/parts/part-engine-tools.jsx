// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
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
      // Snapshot the pre-edit blocks so any image the model echoed back as the
      // "keep-original" placeholder (incl. grid-nested) can be restored below.
      const _origBlocks = slide.blocks ? JSON.parse(JSON.stringify(slide.blocks)) : [];
      // Merge top-level slide properties
      for (const [k, v] of Object.entries(patch)) {
        if (k === "blocks" && Array.isArray(v)) {
          // Smart block merge: if patch has same number of blocks, merge each; otherwise replace
          if (v.length === (slide.blocks || []).length) {
            slide.blocks = slide.blocks.map((existing, bi) => {
              const patched = { ...existing, ...v[bi] };
              // Never let an edit overwrite an existing image's src — the model
              // only ever sees the "keep-original" placeholder, so echoing it back
              // must not clobber the real image data (CR: preserve images).
              if (existing.type === "image" && existing.src) patched.src = existing.src;
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
            // Block count changed → the model may have re-ordered or dropped
            // blocks. Preserve existing images so they are never lost.
            slide.blocks = preserveImages(v, slide.blocks);
          }
        } else if ((k === "L" || k === "R") && Array.isArray(v)) {
          // Split-column arrays can hold images too — preserve them like blocks.
          slide[k] = preserveImages(v, slide[k]);
        } else {
          slide[k] = v;
        }
      }
      // Final guard: never persist a "keep-original" placeholder (top-level or
      // grid-nested) — restore the real image data from the pre-edit blocks.
      if ("blocks" in patch) restoreKeepOriginal(slide.blocks, _origBlocks);
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


IMPORTANT: The slide may contain image blocks shown with src:"keep-original" — these are REAL images. You MUST keep every image block (never delete or omit one). You may move, resize, recaption, or lay them out differently, but leave src exactly "keep-original".`;
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

