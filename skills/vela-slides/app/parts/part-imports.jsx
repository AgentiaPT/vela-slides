// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
import { useState, useReducer, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Plus, X, Presentation, Download, Upload, Search, FileDown } from "lucide-react";
import * as _LucideAll from "lucide-react";


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// VELA — Slide Engine powered by Vera AI
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// ⚠️  AI INSTRUCTION — READ BEFORE ANY EDIT:
//     On EVERY code change, you MUST:
//     1. Increment VELA_VERSION minor: "5.0" → "5.1" → "5.2" etc.
//     2. Add a VELA_CHANGELOG entry at the top of the array describing what changed.
//     3. Update SKILL.md version to match VELA_VERSION (both use major.minor format).
//     4. Never skip this. Never batch. Every edit = version bump.
//

const __DEBUG = false;
const dbg = __DEBUG ? console.log.bind(console) : () => {};
const VELA_LOCAL_MODE = false; // overridden to true by serve.py for local preview
const VELA_CHANNEL_PORT = 0; // overridden by serve.py with channel server port

// Clipboard helper — Clipboard API is blocked in Claude.ai artifact iframes
// Uses execCommand('copy') fallback with a temporary textarea
const velaClipboard = (text) => {
  const fallback = () => {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.cssText = "position:fixed;left:-9999px;opacity:0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch {}
    document.body.removeChild(ta);
  };
  fallback();
};

// Copy a slide to the system clipboard as a Vela envelope (cross-tab transfer)
const velaClipboardWriteSlide = async (slide) => {
  const envelope = { _velaSlide: true, v: 1, data: JSON.parse(JSON.stringify(slide)) };
  const text = JSON.stringify(envelope);
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch {}
  try { velaClipboard(text); return true; } catch { return false; }
};

// Read a Vela slide from the system clipboard (returns sanitized slide or null)
const velaClipboardReadSlide = async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return null;
    const parsed = JSON.parse(text.trim());
    if (parsed?._velaSlide && parsed.data && typeof parsed.data === "object") {
      return sanitizeSlide(parsed.data);
    }
  } catch {}
  return null;
};

const VELA_VERSION = "12.33";
const VELA_CHANGELOG = [
  { v: "12.33", d: "Code block copy button: new 'copy' property (compact: 'cp') adds a 'Copiar' button in the top-right corner that copies block.text to clipboard with 'Copiado ✓' feedback for 2s. Extracted CodeBlock sub-component for useState hook. paddingRight: 80 prevents text overlap when copy is active." },
  { v: "12.32", d: "Offline studyNotes: slides can embed pre-authored markdown, an inline SVG diagram, follow-up questions, and a glossary for Kindle-style X-Ray link popups — renders with zero API calls. Extended parseInline for [label](url) external links and [term](#key) glossary popups via sanitizeUrl. When a live channel is reachable, authored questions become clickable Vera prompts and an Ask input appears; otherwise the panel is pure static content. New 🎓 marker in TOC, gallery thumbnails, and slide viewer. Compact key 'sN', turbo position 10. validate.py + sanitizeStudyNotes enforce size limits and SVG/URL sanitization. JSON-only authoring for v1 (Vera set_study_notes tool deferred)." },
  { v: "12.31", d: "Fix fullscreen button collision: cinema tip (VelaIcon) was stacked on top of student toggle at same position (right:52) — shifted cinema to right:124 so all top-right buttons are visible." },
  { v: "12.30", d: "Comparison block: center content group within each pane using flex centering + fit-content wrapper, so bullet zones have equal spacing to VS divider regardless of text length." },
  { v: "12.29", d: "Fix matrix block vertical axis labels: replace absolute positioning with flex-based centering so labels align with their respective quadrant rows regardless of content height." },
  { v: "12.28", d: "Fix cycle block arrows: proper geometry using direct node-to-node vectors for start/end points and outward control points, replacing broken midAngle offsets that caused arrows to overshoot and cross." },
  { v: "12.27", d: "SKILL.md: additive-only update — live v12.2 verbatim + 6 new block examples (comparison, funnel, cycle, number-row, matrix, checklist), new compact keys, vela server start in fast paths/workflow/CLI. Eval-validated: 98% assertion rate, 18% cheaper than live, block variety +27%." },
  { v: "12.25", d: "6 new block primitives: comparison (A vs B with semantic coloring), funnel (tapered SVG stages), cycle (circular process diagram), number-row (inline big metrics), matrix (2×2 quadrant grid with axis labels), checklist (status-aware items: done/partial/pending/blocked). Compact and turbo format support for all new blocks. Block count: 21 → 27." },
  { v: "12.24", d: "Arrow Up/Down unified with Left/Right for PowerPoint-style slide navigation; server hardening with graceful lifecycle management; .vela extension support and deck rename command; supply chain security improvements." },
  { v: "12.23", d: "Fix PDF export: branding logo now renders in both canvas and vector PDF exports; agentIA watermark respects showBranding toggle instead of being hardcoded; vector PDF modal gets branding toggle UI." },
  { v: "12.22", d: "Flow and badge blocks: icons, arrows, padding now scale with size/labelSize — no longer hardcoded." },
  { v: "12.21", d: "Add explicit UTF-8 encoding to all file open() calls for Windows compatibility." },
  { v: "12.20", d: "Browser tab title syncs with deck title — shows 'DeckName — Vela Slides' instead of generic page title." },
  { v: "12.19", d: "Security: block data: and vbscript: URI schemes in SVG href/xlink:href and style url() — CodeQL incomplete URL scheme check." },
  { v: "12.18", d: "Security: SVG sanitizer rewritten with DOMParser — proper DOM-based tag/attribute removal instead of regex, fixes CodeQL incomplete multi-char sanitization." },
  { v: "12.16", d: "Fix: student mode routes through channel in local mode — was always hitting direct API (no key in browser), causing silent failures." },
  { v: "12.15", d: "Security: sanitize SVG in chat panel (dangerouslySetInnerHTML), block javascript: URIs in links and image src." },
  { v: "12.14", d: "Fix: footer/counter contrast on light slides — auto-detect slide brightness for footer bg/color defaults. Non-branding counter uses slide muted color instead of app theme." },
  { v: "12.13", d: "Fix: table header text defaults to white when headerBg is set. Global slide counter uses displayIndex/displayTotal to avoid breaking comments." },
  { v: "12.12", d: "Fix: section drag-and-drop broken by slide handlers swallowing events. Slide counter now shows global slide/total across all sections. Auto-focus Vera chat input." },
  { v: "12.10", d: "Fix: folder/local mode deck loading — STARTUP_PATCH (file on disk) is now authoritative over localStorage, preventing wrong deck from loading when multiple decks share the same origin." },
  { v: "12.9", d: "Comments UX: slide count badge always visible (hidden when panel/popover open). Module list comment count + 💬 toggle only in review mode." },
  { v: "12.8", d: "Review Mode: inline comment cards rendered next to referenced blocks (blockIndex). Resolve/delete buttons directly on each comment row in both inline cards and sidebar panel. Better UX — no need to scroll to batch actions." },
  { v: "12.7", d: "Review Mode: inline comments system — annotate slides and modules with review comments. Comments panel, visual badges, anchor quoting, batch resolve/clear. Vera list_comments/resolve_comment tools. Notes migrated to structured comments." },
  { v: "12.6", d: "Gallery: shimmer loading animation on thumbnails — replaces raw title flash before slide renders." },
  { v: "12.5", d: "Security: add symlink escape checks to save/upload endpoints for consistency with GET handler. Replace cmd.exe browser launch with webbrowser.open()." },
  { v: "12.4", d: "Rename vela-template.jsx → vela.jsx. Consolidate demo deck under skills/. Add themed example decks (startup-pitch, tech-talk, course-training, business-report)." },
  { v: "12.3", d: "Security hardening: DNS rebinding protection, path traversal on /poll/, symlink escape checks, safe Content-Length parsing, security headers, bounded thread pool, XSS-safe deck name injection, no info leakage." },
  { v: "12.1", d: "Channel mode: 120s timeout (was 30s) to match server, SSE late-reply recovery for chat tool_calls that arrive after timeout." },
  { v: "12.0", d: "UI polish: larger fonts across chrome (+2-4px), resizable TOC with persisted width, gallery delete & zoom persistence, cumulative time in TOC, strikethrough ~~text~~, clipboard skip on text selection, gallery/presenter +/- key isolation." },
  { v: "11.9", d: "Channel server: kill stale port processes on startup and gracefully handle EADDRINUSE." },
  { v: "11.7", d: "Channel complete action: route Vera AI completion calls through Claude Code via channel server (no API key needed)." },
  { v: "10.6", d: "Editor TOC auto-scrolls to active slide when navigating with arrow keys." },
  { v: "10.5", d: "Hot reload — browser auto-refreshes when template is rebuilt via concat.py." },
  { v: "10.4", d: "Fix Ctrl+C copying wrong slide — use ref to avoid stale closure in keyboard handler." },
  { v: "10.3", d: "Browser Fullscreen API in local mode (F/F5 triggers native fullscreen). Cross-tab slide clipboard (Ctrl+C/V via system clipboard with Vela envelope). TOC auto-scroll fix on slide navigation." },
  { v: "10.2", d: "Gallery drag-and-drop slide reorder (mouse-based, bypasses iframe sandbox). Extra zoom levels (560/800px). ZoomWrap badge-icon fix. Undo/redo state clamping hardened. Demo end-card prompt cards auto-send to Vera. Save excludes teacher state from storage. Size 983→947KB via CDN fonts + minify." },
  { v: "10.1", d: "Gallery View redesign — continuous-flow CSS grid with per-module color bars and labels, zero wasted rows. Theme-aware Gallery and Presenter TOC (D key). Student Mode close button (✕). Undo/Redo crash fix — selectedId/slideIndex clamped on restore. Demo end card prompt cards — 4 clickable prompts that auto-fill Vera chat, expand input, glow highlight, and auto-send. Artifact size 983→859KB: 2 rare fonts (DMSans-Italic, Sora-Regular) moved to CDN-only, indent collapse in safe_minify." },  { v: "10.0", d: "Student Mode (🎓) — Vera teaching assistant in presenter mode with streaming responses, SVG diagrams, per-slide Q&A history. Haiku 4.5 + prompt caching + N+1 prefetch for fast responses. Gallery View (🗂) — slide sorter overlay with real thumbnails. Press G in fullscreen." },
  { v: "9.30", d: "Auto-select first slide on every deck load (import, drag & drop, merge). Progress block supports flat format (value/label/color) alongside items array. Babel JSX validation on minified output." },
  { v: "9.29", d: "Smart deck merge — detects new embedded deck versions, per-item conflict resolution (Keep Mine / Use New / Keep Both). Babel JSX validation in assembly pipeline. Updated demo deck with 18 block types showcased." },
  { v: "9.28", d: "Vector PDF export — crisp scalable text with embedded fonts (zlib-compressed). Proper text baseline positioning, icon-to-circle alignment, image slide capture. ~860KB published artifact." },
  { v: "9.1", d: "Session cost tracker (💲). Cinematic 🎬 demo mode with 14-scene guided tour." },
  { v: "9.0", d: "Agentic editing & mobile-first. edit_slide tool for surgical edits. ReAct loop with 12 iterations. DOM Layout Stats in all AI paths. Mobile: swipe, fill-mode fullscreen, responsive popups. Variants (🎲). Cinema bookmarklet. UI test suite (32 tests). ELv2 licensing." },
  { v: "8.0", d: "First public release. 3-zone layout. Vera AI chat with 18 tools. Batch edit & auto-improve. Branding panel. PDF & Markdown export. Drag & drop. 280+ Lucide icons. WYSIWYG editing. Presenter mode. Keyboard shortcuts. Dark/light mode. Persistent storage." },
];

// ━━━ Session Cost Tracker ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Sonnet 4 pricing (USD per million tokens) — as of 2025-05
const VELA_PRICING = { input: 3, output: 15, cacheRead: 0.30, cacheCreate: 3.75 };
const velaSessionStats = {
  calls: [],
  add(entry) { this.calls.push({ ...entry, ts: Date.now() }); this._notify(); },
  _listeners: [],
  onChange(fn) { this._listeners.push(fn); return () => { this._listeners = this._listeners.filter((f) => f !== fn); }; },
  _notify() { for (const fn of this._listeners) fn(); },
  get totalCalls() { return this.calls.length; },
  get totalInputTokens() { return this.calls.reduce((s, c) => s + (c.input_tokens || 0), 0); },
  get totalOutputTokens() { return this.calls.reduce((s, c) => s + (c.output_tokens || 0), 0); },
  get totalCacheReadTokens() { return this.calls.reduce((s, c) => s + (c.cache_read_tokens || 0), 0); },
  get totalCacheCreateTokens() { return this.calls.reduce((s, c) => s + (c.cache_create_tokens || 0), 0); },
  get totalCost() {
    const m = 1_000_000;
    return (this.totalInputTokens * VELA_PRICING.input / m)
      + (this.totalOutputTokens * VELA_PRICING.output / m)
      + (this.totalCacheReadTokens * VELA_PRICING.cacheRead / m)
      + (this.totalCacheCreateTokens * VELA_PRICING.cacheCreate / m);
  },
  get byType() {
    const map = {};
    for (const c of this.calls) {
      const t = c.type || "unknown";
      if (!map[t]) map[t] = { calls: 0, input: 0, output: 0, cost: 0 };
      map[t].calls++;
      map[t].input += (c.input_tokens || 0);
      map[t].output += (c.output_tokens || 0);
      const m = 1_000_000;
      map[t].cost += ((c.input_tokens || 0) * VELA_PRICING.input / m) + ((c.output_tokens || 0) * VELA_PRICING.output / m)
        + ((c.cache_read_tokens || 0) * VELA_PRICING.cacheRead / m) + ((c.cache_create_tokens || 0) * VELA_PRICING.cacheCreate / m);
    }
    return map;
  },
  reset() { this.calls = []; this._notify(); },
};

const MASTER_KEY = "vela-deck";
const MOD_PREFIX = "vela-m-";
const uid = () => crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);

// ━━━ Startup Patch System ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Set STARTUP_PATCH to apply changes on load:
//   Full deck:  { lanes: [...], deckTitle: "..." }     → replaces entire deck
//   Slide list: { slides: [ {slide}, {slide}, ... ] }  → Levenshtein match & replace
//   null/undefined → no-op
const STARTUP_PATCH = null;

// Levenshtein distance (Wagner-Fischer)
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// Extract all text content from a slide for fuzzy matching
function extractSlideText(slide) {
  if (!slide) return "";
  const parts = [slide.title || ""];
  const walkBlocks = (blocks) => {
    if (!Array.isArray(blocks)) return;
    for (const b of blocks) {
      if (b.text) parts.push(b.text);
      if (b.title) parts.push(b.title);
      if (b.label) parts.push(b.label);
      if (b.items) {
        for (const item of b.items) {
          if (typeof item === "string") parts.push(item);
          else if (item) {
            if (item.text) parts.push(item.text);
            if (item.title) parts.push(item.title);
            if (item.label) parts.push(item.label);
            if (item.blocks) walkBlocks(item.blocks);
          }
        }
      }
    }
  };
  walkBlocks(slide.blocks);
  return parts.join(" ").toLowerCase().trim();
}

// Apply startup patch to loaded deck data
function applyStartupPatch(loadedDeck, dispatch) {
  if (!STARTUP_PATCH) return;
  dbg("[PATCH] Applying startup patch...");

  // Full deck replace
  if (STARTUP_PATCH.lanes) {
    dbg("[PATCH] Full deck replace");
    try {
      const sanitized = validateAndSanitizeDeck(STARTUP_PATCH);
      dispatch({ type: "LOAD", payload: { ...sanitized, deckTitle: STARTUP_PATCH.deckTitle || "Untitled" } });
    } catch (e) {
      dbg("[PATCH] Sanitize failed, loading raw:", e);
      dispatch({ type: "LOAD", payload: STARTUP_PATCH });
    }
    return;
  }

  // Slide-level patching via Levenshtein
  if (STARTUP_PATCH.slides && Array.isArray(STARTUP_PATCH.slides)) {
    const patchSlides = STARTUP_PATCH.slides;
    // Build index of all existing slides with their text fingerprint
    const index = [];
    for (const lane of (loadedDeck.lanes || [])) {
      for (const item of (lane.items || [])) {
        for (let si = 0; si < (item.slides || []).length; si++) {
          index.push({ itemId: item.id, slideIdx: si, text: extractSlideText(item.slides[si]), slide: item.slides[si] });
        }
      }
    }

    let matched = 0;
    for (const pSlide of patchSlides) {
      const pText = extractSlideText(pSlide);
      if (!pText) continue;

      // Find best match by normalized Levenshtein
      let bestScore = Infinity, bestEntry = null;
      for (const entry of index) {
        const dist = levenshtein(pText, entry.text);
        const maxLen = Math.max(pText.length, entry.text.length) || 1;
        const normalized = dist / maxLen;
        if (normalized < bestScore) { bestScore = normalized; bestEntry = entry; }
      }

      // Threshold: accept if < 0.6 normalized distance (allows significant edits)
      if (bestEntry && bestScore < 0.6) {
        dbg(`[PATCH] Matched "${pSlide.title || "?"}" → "${bestEntry.slide.title || "?"}" (score: ${bestScore.toFixed(3)})`);
        dispatch({ type: "UPDATE_SLIDE", id: bestEntry.itemId, index: bestEntry.slideIdx, patch: pSlide });
        matched++;
      } else {
        dbg(`[PATCH] No match for "${pSlide.title || "?"}" (best: ${bestScore.toFixed(3)})`);
      }
    }
    dbg(`[PATCH] Done: ${matched}/${patchSlides.length} slides matched and patched`);
  }
}

// ━━━ Distributed Storage: dirty tracking ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const _dirtyMods = new Set();
const _deletedMods = new Set();
const _loadedMods = new Set(); // Track modules that loaded successfully (vs read failures)
let _fullRewrite = false;
const now = () => new Date().toISOString();

// ━━━ Validation Constants ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const MAX_IMPORT_SIZE = 10 * 1024 * 1024;
const VALID_STATUSES = new Set(["todo", "done", "signed-off"]);
const VALID_IMPORTANCES = new Set(["must", "should", "nice"]);
const SAFE_BLOCK_TYPES = new Set(["heading", "text", "bullets", "image", "code", "grid", "callout", "metric", "quote", "divider", "spacer", "badge", "icon", "icon-row", "flow", "table", "progress", "steps", "tag-group", "timeline", "svg", "comparison", "funnel", "cycle", "number-row", "matrix", "checklist"]);

const defaultBranding = {
  enabled: false,
  accentBar: true, accentColor: "#3B82F6", accentHeight: 4,
  logo: null, logoPosition: "top-left", logoSize: 56,
  footerLeft: "", footerCenter: "", footerRight: "auto",
  footerBg: "rgba(0,0,0,0.35)", footerColor: "#94a3b8", footerSize: 9,
  imgMaxWidth: 600, imgQuality: 0.45,
};

// Friendly link preview for title attributes
function linkPreview(url, label) {
  if (label) return `${label}\n${url}`;
  try {
    const u = new URL(url);
    const domain = u.hostname.replace(/^www\./, "");
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "").split("/").slice(-2).join("/");
    return path ? `${domain}/${path}` : domain;
  } catch(_) { return url; }
}

// ━━━ Sanitizers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function sanitizeString(val, maxLen = 500) {
  if (typeof val !== "string") return "";
  // Defense-in-depth: strip NULL bytes (sentinel safety for parseInline link extraction) + HTML tags + truncate
  return val.replace(/\u0000/g, "").replace(/<[^>]*>/g, "").slice(0, maxLen);
}

function sanitizeUrl(url, allowedProtocols = ["http:", "https:", "mailto:"]) {
  if (typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed, "https://placeholder.invalid");
    if (allowedProtocols.includes(parsed.protocol)) return trimmed;
    return "";
  } catch (_) { return ""; }
}

const SVG_BLOCKED_TAGS = new Set(["script", "foreignobject", "iframe", "embed", "object", "use", "animate", "set", "handler", "listener"]);

function sanitizeSvgMarkup(raw) {
  if (typeof raw !== "string") return "";
  try {
    const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${raw}</svg>`, "image/svg+xml");
    const err = doc.querySelector("parsererror");
    if (err) return "";
    const walk = (node) => {
      const children = Array.from(node.childNodes);
      for (const child of children) {
        if (child.nodeType === 1) {
          const tag = child.localName.toLowerCase();
          if (SVG_BLOCKED_TAGS.has(tag)) { child.remove(); continue; }
          const attrs = Array.from(child.attributes);
          for (const a of attrs) {
            const name = a.name.toLowerCase();
            if (name.startsWith("on")) { child.removeAttribute(a.name); continue; }
            const val = a.value.trim().toLowerCase();
            if ((name === "href" || name === "xlink:href") && (val.startsWith("javascript:") || val.startsWith("data:") || val.startsWith("vbscript:"))) { child.removeAttribute(a.name); continue; }
            if (name === "xlink:href" && !val.startsWith("#")) { child.removeAttribute(a.name); continue; }
            if (name === "style" && (/url\s*\([^)]*(?:javascript|data|vbscript):/i.test(a.value) || /expression\s*\(/i.test(a.value))) { child.removeAttribute(a.name); continue; }
          }
          walk(child);
        }
      }
    };
    const root = doc.documentElement;
    walk(root);
    return root.innerHTML;
  } catch (_) { return ""; }
}

function sanitizeBlock(block) {
  if (!block || typeof block !== "object" || Array.isArray(block)) return null;
  if (!SAFE_BLOCK_TYPES.has(block.type)) return null;
  const clean = { ...block };
  if (clean.text) clean.text = sanitizeString(clean.text, 2000);
  if (clean.content) clean.content = sanitizeString(clean.content, 2000);
  if (clean.label) clean.label = sanitizeString(clean.label, 200);
  if (clean.caption) clean.caption = sanitizeString(clean.caption, 500);
  if (clean.author) clean.author = sanitizeString(clean.author, 200);
  if (clean.value) clean.value = sanitizeString(String(clean.value), 100);
  if (clean.title) clean.title = sanitizeString(clean.title, 500);
  if (clean.link) clean.link = sanitizeUrl(clean.link);
  if (clean.src && clean.type === "image") clean.src = sanitizeUrl(clean.src, ["http:", "https:", "data:"]);
  if (Array.isArray(clean.items)) {
    if (clean.type === "bullets") {
      clean.items = clean.items.slice(0, 50).map((it) =>
        typeof it === "string" ? sanitizeString(it, 1000) : typeof it === "object" && it.text ? { text: sanitizeString(it.text, 1000), ...(it.icon ? { icon: it.icon } : {}), ...(it.link ? { link: sanitizeUrl(it.link) } : {}) } : ""
      );
    }
    if (clean.type === "grid") {
      clean.items = clean.items.slice(0, 6).map((cell) => ({
        ...cell,
        blocks: Array.isArray(cell?.blocks) ? cell.blocks.map(sanitizeBlock).filter(Boolean) : [],
      }));
    }
    if (clean.type === "flow" || clean.type === "steps" || clean.type === "timeline" || clean.type === "tag-group" || clean.type === "funnel" || clean.type === "cycle" || clean.type === "number-row" || clean.type === "checklist") {
      clean.items = clean.items.slice(0, 20).map((it) => {
        if (!it || typeof it !== "object") return null;
        const c = { ...it };
        if (c.label) c.label = sanitizeString(c.label, 200);
        if (c.title) c.title = sanitizeString(c.title, 500);
        if (c.text) c.text = sanitizeString(c.text, 1000);
        if (c.date) c.date = sanitizeString(c.date, 50);
        return c;
      }).filter(Boolean);
    }
    if (clean.type === "progress") {
      clean.items = clean.items.slice(0, 20).map((it) => {
        if (!it || typeof it !== "object") return null;
        const c = { ...it };
        if (c.label) c.label = sanitizeString(c.label, 200);
        if (typeof c.value === "number") c.value = Math.max(0, Math.min(c.value, 100));
        return c;
      }).filter(Boolean);
    }
    if (clean.type === "comparison" || clean.type === "matrix") {
      clean.items = clean.items.slice(0, 4).map((it) => {
        if (!it || typeof it !== "object") return null;
        const c = { ...it };
        if (c.title) c.title = sanitizeString(c.title, 200);
        if (Array.isArray(c.items)) c.items = c.items.slice(0, 10).map((pt) => typeof pt === "string" ? sanitizeString(pt, 500) : typeof pt === "object" && pt.text ? { ...pt, text: sanitizeString(pt.text, 500) } : "");
        return c;
      }).filter(Boolean);
    }
  }
  if (clean.type === "table") {
    if (Array.isArray(clean.headers)) clean.headers = clean.headers.slice(0, 10).map((h) => sanitizeString(String(h), 200));
    if (Array.isArray(clean.rows)) clean.rows = clean.rows.slice(0, 30).map((row) =>
      Array.isArray(row) ? row.slice(0, 10).map((cell) => sanitizeString(String(cell), 500)) : []
    );
  }
  if (clean.type === "svg") {
    if (typeof clean.markup === "string") {
      clean.markup = clean.markup.slice(0, 50000)
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
        .replace(/<use[\s>][^]*?(?:<\/use>|\/>)/gi, "")
        .replace(/<animate[\s>][^]*?(?:<\/animate>|\/>)/gi, "")
        .replace(/<set[\s>][^]*?(?:<\/set>|\/>)/gi, "")
        .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
        .replace(/<embed[\s>][^]*?(?:<\/embed>|\/>)/gi, "")
        .replace(/<object[\s\S]*?<\/object>/gi, "")
        .replace(/\bon\w+\s*=/gi, "data-blocked=")
        .replace(/href\s*=\s*["']javascript:/gi, 'href="')
        .replace(/xlink:href\s*=\s*["'](?!#)/gi, 'data-blocked-href="')
        .replace(/style\s*=\s*["'][^"']*url\s*\([^)]*javascript:/gi, 'style="')
        .replace(/style\s*=\s*["'][^"']*expression\s*\(/gi, 'style="');
    } else { clean.markup = ""; }
  }
  // Guard: style must be a plain object, never an array or primitive
  if (clean.style && (typeof clean.style !== "object" || Array.isArray(clean.style))) delete clean.style;
  if (Array.isArray(clean.items)) {
    clean.items = clean.items.map(it => {
      if (it && typeof it === "object" && it.style && (typeof it.style !== "object" || Array.isArray(it.style))) {
        const c = { ...it }; delete c.style; return c;
      }
      return it;
    });
  }
  return clean;
}

const VALID_COMMENT_STATUSES = new Set(["open", "resolved"]);
const MAX_COMMENTS = 500;

function sanitizeComment(c) {
  if (!c || typeof c !== "object") return null;
  return {
    id: typeof c.id === "string" ? c.id.slice(0, 40) : "c_" + uid(),
    text: sanitizeString(c.text || "", 1000),
    anchor: typeof c.anchor === "string" ? sanitizeString(c.anchor, 200) : null,
    blockIndex: typeof c.blockIndex === "number" ? c.blockIndex : null,
    status: VALID_COMMENT_STATUSES.has(c.status) ? c.status : "open",
    createdAt: typeof c.createdAt === "string" ? c.createdAt.slice(0, 30) : now(),
    resolvedAt: typeof c.resolvedAt === "string" ? c.resolvedAt.slice(0, 30) : null,
  };
}

// ━━━ Offline Study Notes sanitizer ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Slide-level `studyNotes` field: pre-authored student-mode content that renders
// with zero API calls. Shape: { text, diagram?, questions?, glossary? }.
// Rich text (parseInline), inline X-Ray links ([label](url) + [term](#key)),
// optional inline SVG diagram, up to 6 follow-up questions, and a glossary map.
function sanitizeStudyNotes(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out = {};
  if (typeof raw.text === "string") {
    const t = sanitizeString(raw.text, 4000);
    if (t) out.text = t;
  }
  if (!out.text) return undefined; // text is required; drop the whole block otherwise
  if (typeof raw.diagram === "string" && raw.diagram.trim()) {
    const svg = sanitizeSvgMarkup(raw.diagram.slice(0, 8000));
    if (svg) out.diagram = svg;
  }
  if (Array.isArray(raw.questions)) {
    const qs = raw.questions.slice(0, 6)
      .map((q) => sanitizeString(typeof q === "string" ? q : String(q || ""), 160))
      .filter((q) => q.length > 0);
    if (qs.length) out.questions = qs;
  }
  if (raw.glossary && typeof raw.glossary === "object" && !Array.isArray(raw.glossary)) {
    const gl = {};
    let count = 0;
    for (const [k, v] of Object.entries(raw.glossary)) {
      if (count >= 24) break;
      if (typeof k !== "string" || !v || typeof v !== "object") continue;
      const key = k.toLowerCase().replace(/[^\w\-]/g, "").slice(0, 48);
      if (!key) continue;
      const def = sanitizeString(typeof v.definition === "string" ? v.definition : "", 400);
      if (!def) continue;
      const entry = { definition: def };
      if (typeof v.url === "string" && v.url.trim()) {
        const safe = sanitizeUrl(v.url.trim());
        if (safe) entry.url = safe;
      }
      gl[key] = entry;
      count++;
    }
    if (Object.keys(gl).length) out.glossary = gl;
  }
  return out;
}

function sanitizeSlide(slide) {
  if (!slide || typeof slide !== "object") return null;
  const clean = { ...slide };
  if (Array.isArray(clean.blocks)) clean.blocks = clean.blocks.slice(0, 30).map(sanitizeBlock).filter(Boolean);
  if (clean.title) clean.title = sanitizeString(clean.title, 500);
  if (clean.subtitle) clean.subtitle = sanitizeString(clean.subtitle, 500);
  if (clean.quote) clean.quote = sanitizeString(clean.quote, 2000);
  if (clean.author) clean.author = sanitizeString(clean.author, 200);
  if (Array.isArray(clean.bullets)) clean.bullets = clean.bullets.slice(0, 30).map((b) => sanitizeString(String(b), 1000));
  if (Array.isArray(clean.comments)) clean.comments = clean.comments.slice(0, MAX_COMMENTS).map(sanitizeComment).filter(Boolean);
  if (clean.studyNotes) {
    const sn = sanitizeStudyNotes(clean.studyNotes);
    if (sn) clean.studyNotes = sn; else delete clean.studyNotes;
  }
  return clean;
}

function sanitizeItem(item) {
  if (!item || typeof item !== "object") return null;
  const comments = Array.isArray(item.comments) ? item.comments.slice(0, MAX_COMMENTS).map(sanitizeComment).filter(Boolean) : [];
  // Migrate legacy notes to a module-level comment if no comments exist
  if (comments.length === 0 && typeof item.notes === "string" && item.notes.trim()) {
    comments.push({ id: "c_" + uid(), text: sanitizeString(item.notes.trim(), 1000), anchor: null, blockIndex: null, status: "open", createdAt: now(), resolvedAt: null });
  }
  return {
    id: uid(),
    title: sanitizeString(item.title || "Untitled", 200),
    notes: typeof item.notes === "string" ? sanitizeString(item.notes, 2000) : "",
    comments,
    status: VALID_STATUSES.has(item.status) ? item.status : "todo",
    importance: VALID_IMPORTANCES.has(item.importance) ? item.importance : "should",
    order: typeof item.order === "number" ? item.order : 0,
    slides: Array.isArray(item.slides) ? item.slides.slice(0, 100).map(sanitizeSlide).filter(Boolean) : [],
    createdAt: typeof item.createdAt === "string" ? item.createdAt.slice(0, 30) : now(),
    ...(item.presentCard ? { presentCard: true } : {}),
  };
}

function validateAndSanitizeDeck(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Invalid deck format");
  if (!Array.isArray(raw.lanes)) throw new Error("Missing lanes array");
  if (raw.lanes.length > 50) throw new Error("Too many lanes (max 50)");
  const lanes = raw.lanes.map((lane) => {
    if (!lane || typeof lane !== "object") return null;
    const items = Array.isArray(lane.items) ? lane.items.slice(0, 200).map(sanitizeItem).filter(Boolean) : [];
    return { id: uid(), title: sanitizeString(lane.title || "Untitled", 100), collapsed: !!lane.collapsed, items };
  }).filter(Boolean);
  const rawBranding = raw.branding && typeof raw.branding === "object" ? raw.branding : {};
  const importedBranding = {
    ...defaultBranding,
    enabled: !!rawBranding.enabled,
    accentBar: rawBranding.accentBar !== false,
    accentColor: sanitizeString(rawBranding.accentColor || "#3B82F6", 20),
    accentHeight: typeof rawBranding.accentHeight === "number" ? Math.min(rawBranding.accentHeight, 20) : 4,
    logo: typeof rawBranding.logo === "string" && rawBranding.logo.startsWith("data:") ? rawBranding.logo : null,
    logoPosition: ["top-left", "top-right", "bottom-left", "bottom-right"].includes(rawBranding.logoPosition) ? rawBranding.logoPosition : "top-left",
    logoSize: typeof rawBranding.logoSize === "number" ? Math.min(rawBranding.logoSize, 120) : 56,
    footerLeft: sanitizeString(rawBranding.footerLeft || "", 100),
    footerCenter: sanitizeString(rawBranding.footerCenter || "", 100),
    footerRight: sanitizeString(rawBranding.footerRight || "auto", 100),
    footerBg: sanitizeString(rawBranding.footerBg || "rgba(0,0,0,0.35)", 50),
    footerColor: sanitizeString(rawBranding.footerColor || "#94a3b8", 20),
    footerSize: typeof rawBranding.footerSize === "number" ? Math.min(rawBranding.footerSize, 16) : 9,
    imgMaxWidth: typeof rawBranding.imgMaxWidth === "number" ? Math.max(300, Math.min(rawBranding.imgMaxWidth, 960)) : 600,
    imgQuality: typeof rawBranding.imgQuality === "number" ? Math.max(0.15, Math.min(rawBranding.imgQuality, 0.85)) : 0.45,
  };
  const importedGuidelines = typeof raw.guidelines === "string" ? raw.guidelines.slice(0, 2000) : "";
  return { lanes, guidelines: importedGuidelines, selectedId: null, slideIndex: 0, fullscreen: false, chatOpen: false,
    chatMessages: [{ role: "assistant", content: "Deck imported successfully! Ready to sail. ⛵🖖", ts: now() }],
    chatLoading: false, lastDebug: "", branding: importedBranding };
}

// ━━━ Image Compression ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function compressImage(dataUrl, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

let IMG_SETTINGS = { maxWidth: defaultBranding.imgMaxWidth, quality: defaultBranding.imgQuality };
const compressSlideImage = (dataUrl) => compressImage(dataUrl, IMG_SETTINGS.maxWidth, IMG_SETTINGS.quality);

// ━━━ Status & Importance Meta ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const STATUSES = ["todo", "done", "signed-off"];
const STATUS_META = {
  todo: { label: "To Do", icon: "○", next: "done" },
  done: { label: "Done", icon: "●", next: "signed-off" },
  "signed-off": { label: "Signed Off", icon: "✦", next: "todo" },
};
const IMP = {
  must: { label: "Must", dot: "#ef4444" },
  should: { label: "Should", dot: "#f59e0b" },
  nice: { label: "Nice", dot: "#64748b" },
};

// ━━━ Themes ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const themes = {
  dark: {
    bg: "#060a14", bgPanel: "#0c1221", bgCard: "#111827", bgInput: "#0a0f1c",
    border: "#1a2540", borderLight: "#243050", accent: "#3B82F6", accentGlow: "rgba(59,130,246,0.12)",
    text: "#e2e8f0", textMuted: "#7a8ba4", textDim: "#4a5a72",
    green: "#10b981", purple: "#a78bfa", red: "#ef4444", amber: "#f59e0b",
    slideBg: "#0a0f1c", codeBg: "#0d1117", isDark: true,
  },
  light: {
    bg: "#f8fafc", bgPanel: "#ffffff", bgCard: "#ffffff", bgInput: "#f1f5f9",
    border: "#e2e8f0", borderLight: "#cbd5e1", accent: "#2563EB", accentGlow: "rgba(37,99,235,0.08)",
    text: "#0f172a", textMuted: "#64748b", textDim: "#94a3b8",
    green: "#059669", purple: "#7c3aed", red: "#ef4444", amber: "#d97706",
    slideBg: "#f1f5f9", codeBg: "#f1f5f9", isDark: false,
  },
};
let T = themes.dark;
const statusColor = (s) => ({ todo: T.textDim, done: T.green, "signed-off": T.purple }[s]);
const FONT = { display: "'Sora', sans-serif", body: "'DM Sans', sans-serif", mono: "'Space Mono', monospace" };

// ━━━ Vela Logo Icon ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function VelaIcon({ size = 18, color }) {
  const c = color || T.accent;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
    <path d="M12 2 L12 22" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
    <path d="M12 3 Q20 8 14 18 L12 18 Z" fill={c} opacity="0.85" />
    <path d="M12 6 Q6 10 10 18 L12 18 Z" fill={c} opacity="0.4" />
    <path d="M8 22 L16 22" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
  </svg>;
}
const BASE_SIZES = { xs: "0.85rem", sm: "0.95rem", md: "1.05rem", lg: "1.2rem", xl: "1.5rem", "2xl": "2rem", "3xl": "2.6rem", "4xl": "3.2rem" };

// ━━━ Style Factories & Helpers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const saveKV = (k, v) => window.storage.set(k, JSON.stringify(v)).catch((e) => { dbg("Storage error:", e); });
const delKV = (k) => window.storage.delete(k).catch((e) => { dbg("Storage delete error:", e); });
const extractSave = (s) => { const { chatLoading, fullscreen, lastDebug, _bootstrap, veraMode, teacherHistory, teacherLoading, reviewMode, commentsPanelOpen, ...rest } = s; if (rest.chatMessages) rest.chatMessages = rest.chatMessages.filter((m) => !m._system); return rest; };

// Distributed storage: master has items with metadata only (no slides)
const extractMaster = (s) => {
  const { chatLoading, fullscreen, lastDebug, ...rest } = s;
  return {
    ...rest,
    _version: 2,
    lanes: rest.lanes.map((l) => ({
      ...l,
      items: l.items.map(({ slides, ...meta }) => meta),
    })),
  };
};
// Collect all comments across items and slides, enriched with context
function collectComments(lanes, filter) {
  const results = [];
  for (const lane of lanes) {
    for (const item of lane.items) {
      for (const c of (item.comments || [])) {
        if (!filter || filter(c)) results.push({ ...c, itemId: item.id, itemTitle: item.title, laneTitle: lane.title, slideIndex: null });
      }
      for (let si = 0; si < (item.slides || []).length; si++) {
        for (const c of (item.slides[si].comments || [])) {
          if (!filter || filter(c)) results.push({ ...c, itemId: item.id, itemTitle: item.title, laneTitle: lane.title, slideIndex: si });
        }
      }
    }
  }
  return results;
}

// Format comments as structured markdown for agent consumption
function formatCommentsForAgent(lanes) {
  const open = collectComments(lanes, (c) => c.status === "open");
  if (open.length === 0) return "No open comments.";
  const grouped = {};
  for (const c of open) {
    const key = c.itemTitle;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(c);
  }
  let md = `## Comments (${open.length} open)\n`;
  for (const [mod, comments] of Object.entries(grouped)) {
    md += `\n### Module: "${mod}"\n`;
    for (const c of comments) {
      const loc = c.slideIndex != null ? `Slide ${c.slideIndex + 1}` : "(module)";
      const anchor = c.anchor ? ` ["${c.anchor}"]` : "";
      md += `- ${loc}${anchor}: ${c.text}\n`;
    }
  }
  return md;
}

// All item IDs across all lanes
const allItemIds = (lanes) => { const ids = []; for (const l of lanes) for (const i of l.items) ids.push(i.id); return ids; };
// Find an item by id across lanes
const findItem = (lanes, id) => { for (const l of lanes) { const it = l.items.find((i) => i.id === id); if (it) return it; } return null; };
const fmtSize = (b) => b < 1024 ? `${b}B` : b < 1048576 ? `${(b / 1024).toFixed(1)}KB` : `${(b / 1048576).toFixed(2)}MB`;
const fmtTime = (s) => { if (!s || s <= 0) return ""; const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60; if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`; if (m > 0) return sec > 0 ? `${m}m ${sec}s` : `${m}m`; return `${sec}s`; };
const sumDurations = (slides) => (slides || []).reduce((s, sl) => s + (sl.duration || 0), 0);
const S = {
  btn: (o = {}) => ({ padding: "3px 8px", fontSize: 10, fontFamily: FONT.mono, fontWeight: 700, background: "transparent", border: `1px solid ${T.border}`, borderRadius: 3, color: T.textDim, cursor: "pointer", ...o }),
  primaryBtn: (o = {}) => ({ padding: "4px 10px", fontSize: 10, fontFamily: FONT.mono, fontWeight: 700, background: T.accent, color: "#fff", border: "none", borderRadius: 3, cursor: "pointer", ...o }),
  cancelBtn: (o = {}) => ({ padding: "4px 8px", fontSize: 10, background: "transparent", color: T.textDim, border: `1px solid ${T.border}`, borderRadius: 3, cursor: "pointer", ...o }),
  input: (o = {}) => ({ flex: 1, padding: "4px 8px", fontSize: 12, fontFamily: FONT.body, background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 3, color: T.text, outline: "none", ...o }),
  panel: (o = {}) => ({ borderBottom: `1px solid ${T.border}`, background: T.bgPanel, ...o }),
};

// ━━━ CSS Generator ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const getCss = () => `
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{opacity:0.4;transform:scale(1)}50%{opacity:1;transform:scale(1.15)}}
@keyframes loading-bar{0%{transform:translateX(-100%)}50%{transform:translateX(60%)}100%{transform:translateX(-100%)}}
::-webkit-scrollbar{width:5px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:${T.border};border-radius:3px}
.concept-row{transition:all .15s;cursor:pointer} .concept-row:hover{background:${T.accentGlow}!important} .concept-row.selected{background:${T.accent}18!important;border-left-color:${T.accent}!important}
.status-btn{cursor:pointer;transition:transform .15s} .status-btn:hover{transform:scale(1.3)}
.slide-nav-btn{opacity:.4;transition:opacity .2s;cursor:pointer} .slide-nav-btn:hover{opacity:1}
.imp-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.add-btn{transition:all .15s} .add-btn:hover{background:${T.accent}!important;color:#fff!important}
.lane-header{transition:background .15s} .lane-header:hover{background:${T.bgCard}!important}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}} .fade-in{animation:fadeIn .3s ease-out}
@keyframes navToastIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes navToastOut{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-6px)}}
.nav-toast-in{animation:navToastIn .25s ease-out forwards}
.nav-toast-out{animation:navToastOut .3s ease-in forwards}
@keyframes magicReveal{
  0%{opacity:0;transform:scale(0.96);filter:blur(6px) brightness(1.3)}
  40%{opacity:1;transform:scale(1.01);filter:blur(0px) brightness(1.15)}
  70%{transform:scale(1.0);filter:blur(0px) brightness(1.05)}
  100%{transform:scale(1);filter:blur(0px) brightness(1)}
}
@keyframes shimmerSweep{
  0%{left:-100%}
  60%{left:100%}
  100%{left:100%}
}
@keyframes glowPulse{
  0%{box-shadow:0 0 0px rgba(59,130,246,0),0 0 0px rgba(167,139,250,0)}
  30%{box-shadow:0 0 24px rgba(59,130,246,0.4),0 0 48px rgba(167,139,250,0.2)}
  100%{box-shadow:0 0 0px rgba(59,130,246,0),0 0 0px rgba(167,139,250,0)}
}
.magic-reveal{animation:magicReveal .6s cubic-bezier(0.16,1,0.3,1) forwards, glowPulse 1.2s ease-out forwards;position:relative;overflow:hidden}
.magic-reveal::after{content:'';position:absolute;top:0;left:-100%;width:60%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.12),rgba(167,139,250,0.08),transparent);animation:shimmerSweep 1s ease-out .15s forwards;z-index:15;pointer-events:none}
@keyframes stg{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes veraScan{0%{left:-60%}100%{left:160%}}
@keyframes veraPulse{0%,100%{filter:brightness(1) saturate(1)}50%{filter:brightness(1.08) saturate(1.2)}}
.vera-thinking{position:relative;overflow:hidden;animation:veraPulse 2s ease-in-out infinite}
.vera-thinking::before{content:'';position:absolute;top:0;left:-60%;width:40%;height:100%;background:linear-gradient(90deg,transparent,rgba(59,130,246,0.06),rgba(167,139,250,0.12),rgba(59,130,246,0.06),transparent);animation:veraScan 2s ease-in-out infinite;z-index:15;pointer-events:none}
.vera-thinking::after{content:'';position:absolute;top:0;left:-60%;width:30%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.04),transparent);animation:veraScan 2s ease-in-out .6s infinite;z-index:15;pointer-events:none}
[class^="stg-"]{max-width:100%;box-sizing:border-box}
.stg-1{animation:stg .4s ease-out .05s both}.stg-2{animation:stg .4s ease-out .12s both}.stg-3{animation:stg .4s ease-out .19s both}
.stg-4{animation:stg .4s ease-out .26s both}.stg-5{animation:stg .4s ease-out .33s both}.stg-6{animation:stg .4s ease-out .4s both}.stg-7{animation:stg .4s ease-out .47s both}
.mob-tab{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 0;flex:1;cursor:pointer;border:none;background:transparent;font-family:${FONT.mono};font-size:8px;font-weight:600;letter-spacing:0.03em;transition:color .15s}
.mob-tab-active{color:${T.accent}!important}
.vela-pdf-capture [data-zoom-badge]{display:none!important}
`;

// ━━━ Mobile Detection ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const MOBILE_BP = 500;
function useIsMobile() {
  const [m, setM] = useState(() => {
    if (typeof window === "undefined") return false;
    const isTouch = window.matchMedia?.("(pointer: coarse)")?.matches;
    const isNarrow = window.innerWidth < MOBILE_BP;
    return isNarrow || (isTouch && window.innerWidth < 600);
  });
  useEffect(() => {
    const check = () => {
      const isTouch = window.matchMedia?.("(pointer: coarse)")?.matches;
      const isNarrow = window.innerWidth < MOBILE_BP;
      setM(isNarrow || (isTouch && window.innerWidth < 600));
    };
    window.addEventListener("resize", check);
    // Also re-check on orientation change (mobile rotation)
    window.addEventListener("orientationchange", () => setTimeout(check, 150));
    return () => { window.removeEventListener("resize", check); };
  }, []);
  return m;
}

function useSwipe(ref, { onLeft, onRight, threshold = 50 } = {}) {
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let startX = 0, startY = 0;
    const onStart = (e) => { const t = e.touches[0]; startX = t.clientX; startY = t.clientY; };
    const onEnd = (e) => {
      const t = e.changedTouches[0]; const dx = t.clientX - startX; const dy = t.clientY - startY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > threshold) {
        if (dx < 0 && onLeft) onLeft();
        if (dx > 0 && onRight) onRight();
      }
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    return () => { el.removeEventListener("touchstart", onStart); el.removeEventListener("touchend", onEnd); };
  }, [ref, onLeft, onRight, threshold]);
}

// ━━━ Shared Prompt Constants (deduped from 3 system prompts) ━━━━━━━
const BLOCK_REFERENCE = `Slide: { blocks: [...], bg?, bgGradient?: "linear-gradient(...)", color?, accent?, align?, verticalAlign?, padding?, gap?, duration?: seconds_integer, layout?: "stack"|"image-right"|"image-left", contentFlex?, imageFlex?, splitGap? }
Layout: "stack" (default) = vertical column. "image-right"/"image-left" = splits content blocks and image blocks side-by-side. contentFlex/imageFlex control column ratio (default 1:1). splitGap controls gap between columns (default 32).
Inline formatting: All text supports **bold**, *italic*, ***bold+italic*** using markdown syntax (also __bold__ and _italic_). Use in headings, text, bullets, callouts, etc.
Links: ANY block can have an optional "link" property: {type:"text", text:"Read the paper", link:"https://..."} — renders clickable. For sources/citations, ALWAYS use a descriptive text block or badge with link property instead of putting raw URLs in text. E.g. {type:"badge", text:"📎 Yao et al., ReAct (2022)", icon:"ExternalLink", link:"https://arxiv.org/abs/2210.03629"} or {type:"text", text:"Source: Snorkel AI Blog", size:"sm", link:"https://snorkel.ai/blog/..."}
Block types:
- heading: {type:"heading", text, size:"xs|sm|md|lg|xl|2xl|3xl|4xl", color?, weight?, align?, icon?:"Zap", iconColor?}
- text: {type:"text", text, size?, color?, bold?, italic?, align?, maxWidth?}
- bullets: {type:"bullets", items:["string" or {text, icon?:"CheckCircle", link?:"https://..."},...], size?, dotColor?, gap?, color?}
- image: {type:"image", src, caption?, maxWidth?, shadow?, rounded?}
- code: {type:"code", text:"code here", label?"JAVASCRIPT", size?, bg?, color?}
- grid: {type:"grid", cols:1|2|3, gap?, items:[{blocks:[...], bg?, padding?, borderRadius?, border?, style?, align?, direction?:"row"|"column"}]}
- callout: {type:"callout", text, title?, bg?, border?, color?, icon?:"AlertTriangle"}
- metric: {type:"metric", value:"42", label?"METRIC NAME", size?"3xl", color?, labelColor?, icon?:"TrendingUp", iconColor?}
- quote: {type:"quote", text, author?, size?, color?}
- badge: {type:"badge", text:"LABEL", color?, bg?, icon?:"Star"}
- icon: {type:"icon", name:"Zap", size?"sm|md|lg|xl", color?, bg?, circle?:true, label?, border?}
- icon-row: {type:"icon-row", items:[{icon:"Zap", title:"Title", text?"Description", link?:"https://...", iconColor?, iconBg?}], cols?:1|2|3, iconBg?, iconColor?, iconShape?"circle|square", gap?, titleSize?, textSize?}  — USE cols:2 for 4+ items with short text to fill horizontal space
- flow: {type:"flow", items:[{icon?:"FileText", label:"Step Name", sublabel?:"optional detail"},...], arrowColor?, direction?"horizontal|vertical", connectorStyle?"arrow|dashed|line", iconBg?, labelColor?, sublabelColor?, loop?:true, loopLabel?:"repeat until done", loopColor?, loopStyle?:"dashed|dotted|solid"}
- svg: {type:"svg", markup:"<svg viewBox='0 0 400 160' xmlns='http://www.w3.org/2000/svg'>...</svg>", maxWidth?:"80%", align?:"center", caption?, captionColor?, captionSize?:"sm", bg?, padding?, rounded?:true} — Use {{color}}, {{accent}}, {{bg}}, {{muted}} tokens for theme colors. For diagrams that structured blocks can't express (loops, fan-outs, meshes, variable-width layers).
- table: {type:"table", headers:["Col1","Col2",...], rows:[["cell","cell",...]], striped?:true, headerBg?, headerColor?, cellColor?, borderColor?, size?}
- progress: {type:"progress", items:[{label:"Python", value:90, color?"#3b82f6"},...], showValue?:true, trackColor?, height?, labelColor?, size?}
- steps: {type:"steps", items:[{title:"Step 1", text?"Description"},...], lineColor?, activeStep?:2, numberColor?, titleColor?, textColor?}
- tag-group: {type:"tag-group", items:[{text:"React", color?"#61dafb", icon?:"Code"},...], variant?"filled|outline|subtle", gap?, size?}
- timeline: {type:"timeline", items:[{date:"Q1 2025", title:"Alpha", text?"Internal testing"},...], lineColor?, dotColor?, dateColor?, titleColor?, textColor?, direction?"horizontal|vertical"}
- spacer: {type:"spacer", h:16}
- divider: {type:"divider", color?, spacing?}`;

const ICON_LIST = `Icons: any PascalCase Lucide name (1000+ available). Common: Zap, Star, CheckCircle, ArrowRight, Brain, Rocket, Shield, Target, Clock, Users, Heart, Globe, Code, Database, Settings, Lightbulb, AlertTriangle, TrendingUp, BarChart, Lock, Eye, Cpu, Layers, GitBranch, Terminal, Puzzle, Sparkles, Award, Book, MessageSquare, Send, Play, Pause, RefreshCw, Search, Filter, Download, Upload, Share2, Link, Bookmark, Flag, Bell, Calendar, Map, Compass, Coffee, Pen, Palette, Camera, Mic, Music, Film, Monitor, Smartphone, Tablet, Wifi, Cloud, Server, HardDrive, Box, Package, Truck, ShoppingCart, DollarSign, CreditCard, PieChart, Activity, Thermometer, Umbrella, Sun, Moon, Droplets, Wind, Flame, Leaf, TreePine, Mountain, Waves, Check, XCircle, Info, HelpCircle, ExternalLink, Copy, Trash2, Edit, Save, Home, Briefcase, GraduationCap, Trophy, MapPin, Phone, Mail, Tag, File, Clipboard, LineChart, TrendingDown, Anchor, Scissors, Image, ArrowUp, ArrowDown, ArrowLeft, ChevronUp, ChevronDown`;

const DESIGN_RULES = `### DESIGN RULES — follow these for every slide (user instructions override these if conflicting)
- Every slide MUST have a bg or bgGradient. Choose colors that match the overall theme (dark or light as instructed).
- Set color (text) and accent per-slide to ensure good contrast against the bg.
- USE THE FULL CANVAS WIDTH. Content should span at least 80% of the 960px width. Avoid narrow left-hugging layouts.
  - For 4+ icon-row items with short text: set cols:2 on the icon-row block to spread across the slide
  - For short text items: prefer grid (2-3 cols) with icon blocks, or icon-row with cols:2
  - Set padding to "36px 48px" or wider — never let content cluster in one corner
  - Headings and text blocks: use align:"left" with full width, not constrained maxWidth
- Use badge blocks for section labels/tags above headings — add icon prop for polish
- Use spacer blocks (h: 8-24) between sections for breathing room
- Size hierarchy: 3xl-4xl for title slides, 2xl for section headings, lg-md for body, sm-xs for labels
- Use callout blocks with custom bg/border colors and icons for key insights
- Use metric blocks for stats/numbers with large size, accent color, and icon
- Use grid blocks (cols: 2 or 3) for side-by-side comparisons with icon blocks inside
- Use icon-row blocks instead of bullets for feature lists — much more visual
- When icon-row has 4+ items with short text, PREFER grid with 2 cols of icon-row or icon blocks to fill horizontal space
- Use flow blocks for pipelines, architectures, processes, funnels — shows relationships with arrows
- Use flow with loop:true for iterative processes, agent loops, feedback cycles, ReAct patterns, OODA loops
- Use svg blocks for diagrams that no structured block can express — fan-outs, mesh connectors, probability distributions, variable-width layer stacks. Always use {{accent}}, {{color}}, {{muted}}, {{bg}} theme tokens in SVG markup. Keep viewBox height ≤200px. Use stroke-based outlines over filled shapes.
- Use table blocks for comparisons, pricing, feature matrices, schedules — avoid grid hacks for tabular data
- Use progress blocks for skills, benchmarks, completion bars, poll results — anything quantitative
- Use steps blocks for sequential processes, onboarding, methodology — implies numbered order with connecting line
- Use tag-group blocks for tech stacks, categories, labels — wrapping inline chips
- Use timeline blocks for roadmaps, milestones, company history — temporal progression
- Use icons in headings for visual anchors. Vary layouts: don't repeat heading+bullets.
- EVERY content slide should have at least one icon somewhere
- First slide = title slide: centered, gradient bg, large heading (3xl+), subtitle, badge with icon
- Last slide = summary/takeaway: gradient bg, quote or key bullets with icons, strong close
- ALWAYS set duration (integer seconds) estimating speaking time: title slides 15-30s, simple content 60-90s, dense/code 90-180s, metrics 20-40s, quotes 15-30s`;// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
