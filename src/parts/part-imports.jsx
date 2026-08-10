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

// Copy N slides to the system clipboard. A single slide is written in the legacy
// single envelope ({_velaSlide}) so older Vela builds can still paste it; two or
// more slides use the multi envelope ({_velaSlides, data:[...]}). Order preserved.
const velaClipboardWriteSlides = async (slides) => {
  const arr = (Array.isArray(slides) ? slides : [slides]).filter(Boolean);
  if (arr.length === 0) return false;
  const clone = JSON.parse(JSON.stringify(arr));
  const envelope = arr.length === 1
    ? { _velaSlide: true, v: 1, data: clone[0] }
    : { _velaSlides: true, v: 1, data: clone };
  const text = JSON.stringify(envelope);
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch {}
  try { velaClipboard(text); return true; } catch { return false; }
};

// Read N slides from the system clipboard (returns array of sanitized slides).
// Accepts BOTH the new multi envelope ({_velaSlides}) and the legacy single
// envelope ({_velaSlide}) so old single-slide clipboards still paste.
const velaClipboardReadSlides = async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return [];
    const parsed = JSON.parse(text.trim());
    if (parsed?._velaSlides && Array.isArray(parsed.data)) {
      return parsed.data.map((s) => sanitizeSlide(s)).filter(Boolean);
    }
    if (parsed?._velaSlide && parsed.data && typeof parsed.data === "object") {
      const s = sanitizeSlide(parsed.data);
      return s ? [s] : [];
    }
  } catch {}
  return [];
};

const VELA_VERSION = "13.37";
const VELA_CHANGELOG = [
  { v: "13.37", d: ["Internal: part list/order single-sourced to src/parts/MANIFEST.txt (build, lint, and tests all read it; fixes a drift where two consumers were missing a part).", "Dev tooling: parts lint gains a size-target warning and a manifest↔disk completeness error; new partsize.py section-size report."] },
  { v: "13.36", d: ["CI hardening: the SVG-<style> recurrence guard now scans every part-file (not a hardcoded list that had drifted), forbids built-in prototype tampering that the sanitizer's tag lookup relies on, requires the redress/overlay tests to keep their real assertions, and fails (never skips) if the sanitizer source can't be located. Added a PART_ORDER-completeness guard.", "Housekeeping: added the missing license header to the PPTX export part-file."] },
  { v: "13.35", d: ["Security (High): the SVG inline style filter now also rejects CSS layout/positioning (position/inset/z-index/pointer-events/viewport-sizing), closing a UI-integrity gap where a positioned SVG element could overlay or clickjack app chrome from a non-clipped diagram panel — the same redress/clickjack class, via the inline-style path rather than the <style> element. SVG paint styling is unaffected.", "CI hardening: security sanitizer regression tests are now un-skippable at runtime (a skip is failed), and the allowlist-tamper guard also catches aliased membership overrides — closing seams where a regression could reach green CI."] },
  { v: "13.34", d: ["CI hardening: the SVG-<style> exclusion lint now also rejects runtime tampering with the tag allowlist (membership-method override / reassignment), and requires the real-runtime redress regression test to always run (security UI tests can't be marked skippable) — closing two seams where the element could be re-admitted with green CI.", "Test fix: the student-mode teacher-panel tests now navigate to a notes-free slide instead of being AI-gated, restoring real coverage of the panel shell."] },
  { v: "13.33", d: ["Test integrity: the in-app UI battery now fails a test whose assertion returns false — previously only a thrown error failed a test, so return-based checks (incl. the SVG-<style> redress regression) never failed. Corrected 5 pre-existing tests this surfaced (4 AI-gated, 1 stale selector).", "CI: hardened the SVG-<style> exclusion lint to verify runtime semantics — it now rejects dynamic or escaped allowlist constructions that could re-admit the element past a byte-level check."] },
  { v: "13.32", d: ["Security (High): the deck SVG sanitizer no longer allows a `<style>` element, closing a UI-integrity gap where document-global CSS could restyle/relocate/re-label the app's own controls (a redress class, escalatable to clickjacking a one-click action). Deck paint uses element-local presentation attributes instead.", "Added a new UI-integrity threat-model invariant, a browser regression test proving deck SVG cannot affect app chrome, and a lint guard preventing re-introduction."] },
  { v: "13.31", d: "Security (defense-in-depth): unified table-cell Markdown escaping into one complete pass (backslash escaped alongside pipe), resolving a static-analysis incomplete-escaping finding; no behavior change." },
  { v: "13.30", d: ["Security (defense-in-depth): adversarial review hardened the 13.29 fixes to rock-solid. The dev-server deck listing now refuses to follow a symlinked entry at open time, closing a check/use race rather than relying on a prior path check. Markdown export now applies complete Markdown-context output encoding to every deck-text field at the sink — link/image destinations, reference-style syntax, raw HTML and autolinks, code fences and tables — with matching HTML-stripping of the contributing text fields at import.", "Extensive regression tests added."] },
  { v: "13.29", d: ["Security (Medium, defense-in-depth): the local dev-server deck listing now enforces the same folder-containment check as every other file endpoint, closing a symlink-escape information disclosure.", "Security (Medium): the local AI channel now requires an authentication token unconditionally and no longer treats a request's Origin as an access boundary, closing an opaque-origin cross-origin access class.", "Security (Low, defense-in-depth): Markdown export now routes deck text through the shared URL-scheme allowlist and Markdown-context output encoding, reaching parity with the live renderer and closing a link/image injection class.", "Regression tests added across all three."] },
  { v: "13.28", d: ["Security (defense-in-depth): every deck color that reaches a URL-auto-loading CSS sink now passes through the allowlist color encoder (fail-closed), closing a CSS auto-load beacon gap where the ingress denylist was the only guard on a few render sinks.", "CI: a new lint enforces this encoder-gating at every such sink so the pattern can't regress.", "Regression tests added."] },
  { v: "13.27", d: ["Security (defense-in-depth): brand style sinks are now encoder-gated at render and re-sanitized on load, closing the same class of gap fixed for slide/block styles in 13.26.", "Regression tests added."] },
  { v: "13.26", d: ["Security (Medium, defense-in-depth): closed a fail-open gap in the deck CSS scrubber where a non-string value on a color/layout key could bypass sanitization and reach a rendered style property; scrubbing is now fail-closed by type.", "Security (defense-in-depth): background/gradient style sinks are now additionally output-encoded at render, and persisted decks are re-sanitized on load, not just on import.", "Regression tests added, including type-fuzzing across the affected fields."] },
  { v: "13.25", d: ["Security (defense-in-depth): the deck sub-object scrubber now fails closed at its nesting limit — over-deep structures are dropped instead of passed through unscrubbed.", "Security (defense-in-depth): sub-object CSS scrubbing now covers the background/mask/filter property families, matched on a normalized key stem.", "Build: the release bundle's test-hook assertion now matches the test-global naming convention, and the in-bundle UI battery is fenced and runtime-gated like the other test hooks.", "Behavioral regression tests added for all of the above."] },
  { v: "13.24", d: ["Security (defense-in-depth): deck sub-objects (list items, grid cells, matrix quadrants, comparison points) are now hardened recursively — CSS color/layout/style scrubbing at every level plus dropping the internal-use key namespace.", "Security (defense-in-depth): nested grid-cell block arrays now honor the same per-slide breadth cap.", "Desktop: watcher deck reads are re-checked against the size cap after reading, closing a stat/read race.", "Build: the desktop ship bundle now strips internal test hooks while keeping the production save channel.", "CI: key-drift lint also catches bracket-notation reads; docs state its exact scope.", "Regression tests added across all of the above."] },
  { v: "13.23", d: "TOC: clicking a slide row then immediately pressing an arrow key no longer loses the keypress — the row's selection now commits synchronously so the following nav lands." },
  { v: "13.22", d: ["Security (defense-in-depth): deck import now builds slide/block data from an explicit key allowlist instead of copying input, drops an internal-use key namespace at ingress, and bounds recursion depth on nested block structures.", "Security (defense-in-depth): the slide accent custom property stays encoder-gated and CSS type-registered, closing a residual inline-style exfil path.", "Desktop: save writes are now verified by reading the file back, with bounded, size-capped watcher reads.", "Release builds strip internal test hooks from the shipped bundle.", "Security (defense-in-depth): unified the deck-JSON script-injection escaping used by the Python and JS build paths, with a parity test keeping them in sync.", "CI: new drift guards keep the deck key allowlist and the release bundle in sync with the source.", "Regression tests added across all of the above."] },
  { v: "13.21", d: "Outline (TOC) keyboard nav now moves the shown slide — arrow keys keep one selection cursor in sync with the preview (no freeze after clicking into the outline); collapsed sections navigate section-by-section, landing on each section's first slide." },
  { v: "13.20", d: ["Gallery now renders section title-card slides as they present.", "TOC: arrow-key collapse/expand for sections, with a current-slide marker on collapsed sections.", "Balanced multi-image paste layouts — side-by-side and grids, up to 5 images per slide; grid images now render at full height instead of collapsing.", "Consistent “AI working” animation across all AI edits, including chat; switching modules no longer flashes the settle on an untouched slide.", "Desktop save reliability: retry/verify with a visible save-status indicator (no more silent stalls)."] },
  { v: "13.19", d: ["Reorder items inside a block — hover any point/card/step in edit mode and use the ▲▼ arrows (next to delete) to move it up or down. Works across bullets, checklists, grids, timelines, comparisons and more.", "Security (defense-in-depth): closed a mutation-XSS gap in the deck SVG sanitizer where an event handler could survive on a <style> element, and added layered backstops — a namespace-validity invariant and an output-side re-parse check that rejects any markup a handler/script would survive on the HTML render.", "Desktop shell: the filesystem guard is now frozen and refuses whole-volume, shallow, and OS-critical system roots, further capping file read/write blast radius.", "Regression tests added for all of the above."] },
  { v: "13.18", d: ["Present view now has an Edit toggle (✎ button, or Shift+E) that turns on inline click-to-edit while presenting — off by default so the audience sees a clean slide; resets each time you leave Present.", "Security (High): hardened the SVG <style>/presentation-attribute CSS filter against a CSS-URL exfil-beacon bypass — external and scheme-relative references are now rejected on token presence rather than on a well-formed match, and at-rules (@import/@font-face) are refused. Closes a zero-click render-time fetch on the host runtimes where the deck sanitizers are the sole backstop.", "Added malformed-input regression tests exercised against the real browser sink."] },
  { v: "13.17", d: "Ctrl/⌘-click a section's collapse arrow in the list to collapse or expand every section at once — plain click still toggles just that one section." },
  { v: "13.16", d: "Fixed a race where opening/reloading a deck appended a spurious empty \u201CNew section\u201D each time — the empty-deck seed no longer fires against a deck that is still loading." },
  { v: "13.15", d: "Move a slide/selection to another section with Ctrl/⌘-click on the destination to move it \u201Cout\u201D while keeping focus in the current section on the next slide (or the first slide of the following section when you move the last one) — plain click still follows the slide into its new section." },
  { v: "13.14", d: "Opening/switching a deck now always lands on the first slide of the first non-empty module — a deck switch that preserved a stale selection (e.g. an empty leading section) no longer leaves the editor showing \u201CNo slides yet.\u201D" },
  { v: "13.13", d: "Multi-slide delete / paste / move now undo in a single step (one gesture = one Ctrl+Z)." },
  { v: "13.12", d: ["Multi-select slides in the section list (shift/⌘-click) and copy them all with Ctrl/⌘+C — paste (Ctrl/⌘+V) into the same deck or another Vela deck, order preserved; old single-slide clipboards still paste.", "Right-click a slide in the list for a context menu: Move → section, Duplicate, Delete, Hide/Show.", "Move-slide section picker now has a search box, a wider scrollbar, and the mouse wheel scrolls the list instead of changing the slide."] },
  { v: "13.11", d: ["Editor now opens straight into the first slide of the first non-empty module — no more blank editor on load.", "Centered headings render centered in the editor too (a left icon no longer left-aligns centered text), matching Present mode.", "Editor slide viewport is a fixed 16:9 box and the slide toolbar (AI Edit / Improve / …) stays put across slides of differing content."] },
  { v: "13.10", d: ["Security (defense-in-depth): PDF export now routes every hyperlink target through the single audited PDF-string encoder, closing a PDF literal-string injection where a crafted deck link could inject PDF action syntax. Both the raster and vector export paths share one encoder now.", "Regression tests added."] },
  { v: "13.9", d: ["Security (defense-in-depth): closed a URL-sanitizer scheme-allowlist bypass affecting exported hyperlink targets — deck links are now validated and emitted as a single canonical form, and malformed or non-http(s)/mailto references are rejected before they reach PowerPoint/PDF export.", "PowerPoint export re-validates hyperlink targets at the external-relationship boundary.", "Regression tests added."] },
  { v: "13.8", d: ["Skill packaging moved to the dev toolchain — the shipped CLI now does deck author→ship only, not skill self-packaging.", "Hardened the skill-archive builder to skip symlinks and keep every archive member's source within the skill root; regression tests added."] },
  { v: "13.7", d: ["Badge blocks: fixed icon/text spacing that collapsed because the size math produced an invalid value.", "CLI: `deck init` no longer silently overwrites an existing deck — it stops with a conflict error unless you pass --force."] },
  { v: "13.6", d: "UI test battery ~37% faster again — fixed settle-sleeps replaced with condition polling that returns as soon as the UI is ready; no test coverage removed." },
  { v: "13.5", d: "UI test battery ~38% faster headless — AI-dependent student-mode checks skip cleanly when AI is unavailable instead of waiting out long timeouts." },
  { v: "13.4", d: "CI now runs the in-app UI test battery headless; battery is order- and headless-robust (selects a slide per suite, state-aware review toggles)." },
  { v: "13.3", d: "Leaner installed skill: dev/preview/AI tooling relocated out of the skill; it now does author → ship .jsx only." },
  { v: "13.2", d: "PowerPoint export: single-line values (metric numbers, badges, short titles) no longer wrap to two lines on a deck's first open in PowerPoint." },
  { v: "13.1", d: ["Export: fixed an intermittent crash ('str.includes is not a function') that aborted export on slides with a non-string background — gradient/color parsing now tolerates any value.", "Dialogs now scroll instead of clipping in short/narrow panes — fixes empty-looking About/Recent Changes.", "Escape closes the icon picker consistently with other dialogs.", "Block hover-toolbar icons no longer clipped at a column's edge.", "Artifact mode shows a dismissible reminder that the deck lives in browser/Claude.ai storage — export often to back up."] },
  { v: "13.0", d: ["Native PowerPoint (.pptx) export — the deck exports as a fully editable .pptx with real text boxes, shapes and tables (not flattened images), vector diagrams as native SVG with PNG fallback, and gradient/color fidelity carried through.", "Milestone release consolidating the .pptx exporter."] },
  { v: "12.88", d: ["PowerPoint export: fixed inline bold/italic text appearing misplaced — bold and italic segments now stay as runs within their paragraph instead of floating to a separate box.", "Fixed numbers/labels centered via flex/grid (e.g. step-number circles) hugging the left edge — centering is now carried through.", "Fixed table text on shrink-to-fit slides exporting oversized and overflowing the blocks below — cell fonts now use the same scale as the rest of the slide.", "Regression tests added."] },
  { v: "12.87", d: ["PowerPoint export: fixed a repair prompt real PowerPoint could still show on first open — a run whose measured font size collapsed to zero emitted an out-of-range size PowerPoint rejects; exported font sizes are now clamped to PowerPoint's valid range.", "Regression test added."] },
  { v: "12.86", d: ["PowerPoint export: fixed the repair prompt real PowerPoint showed on first open of decks with a table — exported tables now carry a table-style reference and the package ships the matching table-styles part.", "Fixed exported text rendering ~25% too small — font sizes now match the slide's 1:1 canvas-px→point scale, sized correctly relative to shapes and boxes.", "Regression tests added for both."] },
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
      dispatch({ type: "LOAD", payload: { ...sanitized, deckTitle: sanitizeDeckTitle(STARTUP_PATCH.deckTitle) } });
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

