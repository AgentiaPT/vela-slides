// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
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
    const t0 = performance.now();
    let fullText = "";

    // Local mode: route through MCP channel server (no streaming)
    if (VELA_LOCAL_MODE && VELA_CHANNEL_PORT) {
      const timer = setTimeout(() => controller.abort(), 120000);
      const r = await fetch(`http://localhost:${VELA_CHANNEL_PORT}/action`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-vela-token": VELA_CHANNEL_TOKEN },
        signal: controller.signal,
        body: JSON.stringify({ action: "complete", _silent: true, system: sysPrompt, messages, temperature: 0.3, max_tokens: 1500, _callType: "teacher" })
      });
      clearTimeout(timer);
      if (!r.ok) throw new Error(`Channel ${r.status}`);
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || "Channel error");
      fullText = data.reply || "";
      if (onText) onText(fullText);
      velaSessionStats.add({ type: "teacher", input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_create_tokens: 0, model: "claude-code-channel", tool_calls: 0, duration_ms: Math.round(performance.now() - t0), stop_reason: "channel" });
    } else {
      // Artifact mode: direct Anthropic API with streaming
      const timer = setTimeout(() => controller.abort(), 25000);
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1500, temperature: 0.3, system: sysPrompt, messages, stream: true, cache_control: { type: "ephemeral" } })
      });
      clearTimeout(timer);
      if (!r.ok) { const e = await r.text(); throw new Error(`API ${r.status}: ${e.slice(0, 100)}`); }
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
    }

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

IMPORTANT: Image blocks with src:"keep-original" are REAL existing images — keep every one of them (never delete or omit an image block), leave src as "keep-original", and feel free to reposition/resize/recaption around them.`;

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

  // Extra safeguard: strip any slide-ONLY keys that leaked into blocks.
  // DERIVED, not hand-maintained: "slide-only" is exactly the set difference
  // SAFE_SLIDE_KEYS − SAFE_BLOCK_KEYS (part-imports.jsx), so this list can never
  // drift from the ingress allowlists. Keys valid on BOTH (bg, color, padding,
  // gap, align, title, author, hidden…) are in both sets and so are not stripped.
  // `presentCard` is added explicitly: it is a module/item-level key the model
  // sometimes emits onto a slide, and it is not in either allowlist.
  const SLIDE_ONLY_KEYS = new Set(
    [...SAFE_SLIDE_KEYS].filter((k) => !SAFE_BLOCK_KEYS.has(k)).concat(["presentCard"])
  );
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
  // Fail loud: a request/parse failure must NOT be papered over with a
  // fabricated uniform duration written onto every slide. Throw so the caller
  // can leave existing durations untouched and tell the user it failed.
  let text;
  try {
    text = await callClaudeAPI(sysPrompt, [{ role: "user", content: `Estimate seconds for ${jobs.length} slides:\n\n${summaries}` }], { temperature: 0, maxTokens: 500, timeoutMs: 15000, _callType: "estimate" });
  } catch (e) {
    dbg("Timing estimation request failed:", e);
    throw new Error(`Timing estimation request failed: ${e?.message || e}`);
  }
  let arr;
  try {
    arr = JSON.parse(text.replace(/```json\s*|```\s*/g, "").trim());
  } catch (e) {
    throw new Error("Timing estimation returned non-JSON output");
  }
  if (!Array.isArray(arr) || arr.length !== jobs.length) {
    throw new Error(`Timing estimation returned ${Array.isArray(arr) ? arr.length : "non-array"} values for ${jobs.length} slides`);
  }
  // A single malformed entry is clamped to a sane default; the batch as a whole
  // is known-valid (correct length), so this is not masking a request failure.
  return arr.map((v) => typeof v === "number" ? Math.max(10, Math.min(3600, Math.round(v))) : 60);
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

    let capHit = "";
    for (let iter = 0; iter < 12; iter++) {
      const parsed = await callVeraStep(sysPrompt, messages);
      const calls = parsed.tool_calls || [];
      if (calls.length === 0) { finalText = parsed.message || finalText || "Done. 🖖"; break; }

      // SECURITY (H5): cap tool_calls per turn to limit cost-amplification
      // via prompt injection. Excess calls are dropped this turn; the loop
      // continues so legitimate progress isn't blocked.
      const safeCalls = calls.slice(0, MAX_TOOLS_PER_TURN);
      if (calls.length > MAX_TOOLS_PER_TURN) {
        dbg(`[⚠️ cap] tool_calls/turn ${calls.length} > ${MAX_TOOLS_PER_TURN}; truncating`);
        capHit = `tool_calls/turn cap (${MAX_TOOLS_PER_TURN})`;
      }

      const results = [];
      for (const tc of safeCalls) {
        if (totalTools >= MAX_TOTAL_TOOLS) {
          dbg(`[⚠️ cap] total tools >= ${MAX_TOTAL_TOOLS}; stopping`);
          capHit = `total tools cap (${MAX_TOTAL_TOOLS})`;
          break;
        }
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

      // SECURITY (H5): bound cumulative messages payload to prevent unbounded
      // input-token growth across iterations.
      let msgBytes = 0;
      for (const m of messages) { const c = m.content; msgBytes += typeof c === "string" ? c.length : JSON.stringify(c || "").length; }
      if (msgBytes > MAX_MESSAGES_BYTES) {
        dbg(`[⚠️ cap] messages bytes ${msgBytes} > ${MAX_MESSAGES_BYTES}; stopping ReAct loop`);
        capHit = `messages-bytes cap (${MAX_MESSAGES_BYTES})`;
        break;
      }
      if (totalTools >= MAX_TOTAL_TOOLS) break;

      if (onToolCall) onToolCall({ type: "thinking" });
    }
    if (capHit && !finalText) finalText = `Stopped at ${capHit}. Run again to continue. 🖖`;

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


