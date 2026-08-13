// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
// ━━━ Markdown Export ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function deckToMarkdown(state, opts = {}) {
  const { includeNotes = true } = opts;
  const lines = [];
  const ln = (...a) => lines.push(...a);
  const blank = () => { if (lines.length && lines[lines.length - 1] !== "") lines.push(""); };

  // SECURITY (CWE-116, output encoding at the sink): deck text is emitted into a
  // MARKDOWN grammar, so it needs Markdown-context encoding — the HTML-tag strip
  // in sanitizeString does not cover it. Without this, a deck string could embed
  // `[x](javascript:…)` or a zero-click image beacon `![](https://attacker/…)`
  // that survives verbatim into the exported .md (the live renderer already
  // re-validates such inline links via sanitizeUrl in parseInline; this reaches
  // parity). Defense-in-depth: (1) allowlist link/image DESTINATION schemes via
  // the same sanitizeUrl gate used everywhere else, and (2) backslash-escape
  // Markdown metacharacters in any text placed inside a link label.
  const mdUrl = (u) => { try { return (typeof sanitizeUrl === "function" ? (sanitizeUrl(u) || "") : ""); } catch { return ""; } };
  // Encode a scheme-validated URL for the Markdown link-DESTINATION context
  // `(...)`. sanitizeUrl fixes the SCHEME, but that is an HTML-href validator, not
  // a Markdown-destination encoder: the WHATWG URL parser leaves `)` (and `(`)
  // unescaped in a path, and the authority-less (mailto:) branch returns the raw
  // target — so a `)` closes the destination early (letting the trailing bytes
  // render as a fresh image/link) and a mailto: newline injects block structure.
  // Percent-encode exactly the bytes that break out of `(...)` — parens,
  // whitespace/controls, angle brackets, backslash, backtick — leaving a still-
  // functional URL. Every URL that lands inside `(...)` MUST go through this.
  const mdDest = (u) => { const s = mdUrl(u); return s ? s.replace(/[\s()<>\\`]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")) : ""; };
  // Free BODY text: keep emphasis (**bold**, *italic*, ~~strike~~) but sanitize
  // inline [label](target) link targets and NEUTRALIZE image auto-load (the live
  // renderer never auto-loads text images) — a blocked/opaque scheme collapses
  // the span to its plain label, an allowed one stays a link (never an image).
  const mdInline = (t, cell) => {
    if (t == null) return "";
    const src = String(t);
    // Walk the string as alternating INLINE-link spans and the gaps between them.
    // In each gap, escape every `[`/`]` so Markdown reference-style links/images
    // ([a][ref], ![a][ref], collapsed/shortcut [ref]) AND their definition lines
    // ([ref]: url) cannot form: those forms contain no literal `(`, so the inline
    // rewriter and mdDest never see them and their URL would otherwise reach a .md
    // viewer unchecked. The live renderer (parseInline) supports only inline links,
    // so escaping is both safe (same literal text) and parity-correct (CWE-116:
    // cover the whole grammar, not just the `(...)` form). The escaper ALSO covers
    // `<`/`>`: Markdown permits RAW HTML and autolinks (`<img src=beacon>`,
    // `<a href=javascript:…>`, `<scheme:…>`), which need neither `(` nor `[` and
    // would otherwise reach a .md viewer live — the "parity" argument does not hold
    // here because the live app renders these fields as escaped React text, not as
    // markup. Each inline span is scheme-checked + destination-encoded (mdDest), the
    // leading `!` dropped so an image can only downgrade to a link, and a blocked
    // scheme collapses to the plain label. The label group is `*?` (empty allowed)
    // so an empty-alt beacon `![](url)` (which the live renderer ignores) is caught
    // too, and the surviving label is escaped so it cannot carry raw HTML either.
    // Backslash is escaped FIRST-CLASS (in the same class), not just the target
    // metachars: a lone `\` before an escaped char would otherwise revive it —
    // attacker `\<` -> `\\<` renders as a literal `\` + a LIVE `<`. Escaping `\`
    // too makes every `\[`/`\]`/`\<`/`\>` unrevivable.
    // In cell mode `|` joins the class so it is escaped in the SAME pass as
    // backslash (escaped first-class), not by a separate order-dependent replace.
    const gapRe = cell ? /[\\\[\]<>|]/g : /[\\\[\]<>]/g;
    const escGap = (g) => g.replace(gapRe, "\\$&");
    const re = /!?\[([^\[\]\n]*?)\]\(([^\s)\n]+?)\)/g;
    let out = "", last = 0, m;
    while ((m = re.exec(src)) !== null) {
      out += escGap(src.slice(last, m.index));
      const safe = mdDest(m[2]);
      out += safe ? `[${escGap(m[1])}](${safe})` : escGap(m[1]);
      last = m.index + m[0].length;
    }
    out += escGap(src.slice(last));
    return out.replace(/\n/g, "  \n");
  };
  // Text used INSIDE a [ … ] link label: strict metachar escape so a crafted
  // label cannot break out of, or nest inside, the surrounding link syntax.
  const mdLabel = (t) => String(t == null ? "" : t).replace(/\n/g, " ").replace(/([\\`*_\[\]()~!<>])/g, "\\$1");
  // Build a link only when the destination passes the scheme allowlist; a blocked
  // target degrades to the plain (escaped) label rather than emitting a bad URL.
  const mdLink = (label, target) => { const s = mdDest(target); return s ? `[${mdLabel(label)}](${s})` : mdLabel(label); };
  // Table cell: inline-sanitize in CELL mode (escGap escapes `|` alongside
  // backslash/brackets/angles in one complete pass — no separate, order-dependent
  // pipe replace), then collapse newlines. A cell cannot inject columns or break
  // the row grammar, and backslash is not double-escaped.
  const mdCell = (t) => mdInline(t, true).replace(/\n/g, " ");
  // Code fence long enough that backtick runs in the content cannot close it.
  const mdFence = (code) => { const runs = String(code == null ? "" : code).match(/`+/g) || []; const max = runs.reduce((m, r) => Math.max(m, r.length), 0); return "`".repeat(Math.max(3, max + 1)); };
  // Heading text: inline-sanitize then collapse newlines so a title cannot spill
  // past its single `#`-prefixed line into injected markdown.
  const mdHead = (t) => mdInline(t).replace(/\n/g, " ");
  const txt = mdInline;

  const blockToMd = (b, depth = 0) => {
    const indent = "  ".repeat(depth);
    switch (b.type) {
      case "heading": {
        const level = ({ "4xl": 1, "3xl": 1, "2xl": 2, xl: 2, lg: 3, md: 3, sm: 4 })[b.size || "2xl"] || 2;
        blank();
        ln(`${indent}${"#".repeat(level)} ${txt(b.text)}`);
        break;
      }
      case "text": {
        blank();
        const src = mdDest(b.link);
        ln(`${indent}${txt(b.text)}${src ? ` — [source](${src})` : ""}`);
        break;
      }
      case "badge":
        ln(`${indent}**${txt(b.text)}**`);
        break;
      case "bullets":
        blank();
        for (const item of (b.items || [])) {
          const t = typeof item === "string" ? item : item.text;
          const link = typeof item === "object" ? item.link : null;
          if (link) ln(`${indent}- ${mdLink(t, link)}`);
          else ln(`${indent}- ${txt(t)}`);
        }
        break;
      case "icon-row":
        blank();
        for (const item of (b.items || [])) {
          const title = item.title || "";
          const sub = item.text ? ` — ${txt(item.text)}` : "";
          if (item.link) ln(`${indent}- ${mdLink(title, item.link)}${sub}`);
          else ln(`${indent}- ${txt(title)}${sub}`);
        }
        break;
      case "quote":
        blank();
        ln(`${indent}> ${txt(b.text)}`);
        if (b.author) ln(`${indent}> — ${txt(b.author)}`);
        { const s = mdDest(b.link); if (s) ln(`${indent}> [Source](${s})`); }
        break;
      case "callout":
        blank();
        if (b.title) ln(`${indent}> **${txt(b.title)}**`);
        ln(`${indent}> ${txt(b.text)}`);
        { const s = mdDest(b.link); if (s) ln(`${indent}> [Source](${s})`); }
        break;
      case "metric":
        ln(`${indent}**${txt(b.value)}** ${b.label ? `— ${txt(b.label)}` : ""}`);
        { const s = mdDest(b.link); if (s) ln(`${indent}[Source](${s})`); }
        break;
      case "code": {
        blank();
        if (b.label) ln(`${indent}*${txt(b.label)}*`);
        // Fence longer than any backtick run in the body so `b.text` cannot close
        // the fence early and inject markdown after it; lang is word-chars only.
        const fence = mdFence(b.text);
        const lang = String(b.lang || "").replace(/[^A-Za-z0-9_+.-]/g, "");
        ln(`${indent}${fence}${lang}`);
        ln(b.text || "");
        ln(`${indent}${fence}`);
        break;
      }
      case "table": {
        blank();
        const cols = b.headers || [];
        const rows = b.rows || [];
        if (cols.length) {
          ln(`${indent}| ${cols.map(mdCell).join(" | ")} |`);
          ln(`${indent}| ${cols.map(() => "---").join(" | ")} |`);
        }
        for (const row of rows) {
          const cells = Array.isArray(row) ? row : (row.cells || []);
          ln(`${indent}| ${cells.map(mdCell).join(" | ")} |`);
        }
        { const s = mdDest(b.link); if (s) ln(`${indent}[Source](${s})`); }
        break;
      }
      case "grid":
        for (const cell of (b.items || [])) {
          for (const cb of (cell.blocks || [])) {
            blockToMd(cb, depth);
          }
          blank();
        }
        break;
      case "flow":
      case "steps":
        blank();
        for (let i = 0; i < (b.items || []).length; i++) {
          const item = b.items[i];
          const label = item.label || item.title || "";
          const sub = item.sublabel || item.text || "";
          ln(`${indent}${i + 1}. **${txt(label)}**${sub ? ` — ${txt(sub)}` : ""}`);
        }
        if (b.loop && b.loopLabel) ln(`${indent}*↺ ${txt(b.loopLabel)}*`);
        else if (b.loop) ln(`${indent}*↺ (loops back to step 1)*`);
        break;
      case "svg":
        if (b.caption) { blank(); ln(`${indent}*${txt(b.caption)}*`); }
        break;
      case "timeline":
        blank();
        for (const item of (b.items || [])) {
          const date = item.date ? `**${txt(item.date)}** ` : "";
          ln(`${indent}- ${date}${txt(item.title || "")}${item.text ? ` — ${txt(item.text)}` : ""}`);
        }
        break;
      case "progress":
        blank();
        for (const item of (b.items || [])) {
          ln(`${indent}- ${txt(item.label || "")}: ${txt(item.value ?? 0)}%`);
        }
        break;
      case "tag-group":
        blank();
        ln(`${indent}${(b.items || []).map(item => { const s = String(typeof item === "string" ? item : (item.text || item.label || "")).replace(/[`\n]/g, " "); return `\`${s}\``; }).join("  ")}`);
        break;
      case "image": {
        // Only emit a markdown image for a scheme-allowlisted external src; alt
        // text is metachar-escaped. A blocked/opaque src degrades to the caption.
        const isrc = (b.src && !b.src.startsWith("data:")) ? mdDest(b.src) : "";
        if (isrc) {
          blank();
          ln(`${indent}![${mdLabel(b.alt || b.caption || "")}](${isrc})`);
        } else if (b.caption) {
          ln(`${indent}*${txt(b.caption)}*`);
        }
        break;
      }
      case "divider":
        blank();
        ln(`${indent}---`);
        break;
      // spacer, icon — skip silently
    }
  };

  // Title
  ln(`# ${mdHead(state.deckTitle || "Untitled Deck")}`);
  blank();

  let slideNum = 0;
  for (const lane of (state.lanes || [])) {
    // Lane as top section
    blank();
    ln(`---`);
    blank();
    ln(`# ${mdHead(lane.title || "Untitled Section")}`);
    blank();

    for (const item of (lane.items || [])) {
      // Module as sub-section
      blank();
      ln(`## ${mdHead(item.title || "Untitled Module")}`);

      for (const slide of (item.slides || [])) {
        if (slide && slide.hidden) continue; // hidden slides are not exported
        slideNum++;
        blank();

        // Speaker notes as metadata
        const blocks = (slide.blocks || []).filter((b) => !(b && b.hidden));
        if (!blocks.length) continue;

        for (const b of blocks) blockToMd(b);

        if (includeNotes && slide.speakerNotes) {
          blank();
          ln(`> 🎤 *${txt(slide.speakerNotes)}*`);
        }
      }
    }
  }

  blank();
  ln(`---`);
  ln(`*Exported from Vela · ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}*`);

  return lines.join("\n");
}

function exportMarkdown(state, opts = {}) {
  const md = deckToMarkdown(state, opts);
  const title = state.deckTitle || "Untitled";
  const safeTitle = title.replace(/[^a-zA-Z0-9_\s-]/g, "").replace(/\s+/g, "-").slice(0, 60) || "vela-deck";
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url;
  a.download = `${safeTitle}.md`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ━━━ Standalone HTML Export ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// One shareable .html: the transpiled app + the current deck, inlined; React/
// ReactDOM/lucide-react load from a CDN with SHA-pinned SRI (small output,
// supply-chain-safe, needs network at open time — acceptable tradeoff vs.
// embedding ~800KB of UMD bundles in every export). The pure string-transform
// below is delimited by comment markers and regex-extracted verbatim by
// tests/test_standalone_html.cjs so it can be unit-tested with the vendored
// Babel outside the browser — do not reshape it without checking that test.
// STANDALONE_HTML_PURE_START
// SRI = sha384 base64 of vela-neutralino/resources/vendor/{react,react-dom,
// lucide-react}.min.js (byte-identical to these npm-canonical jsdelivr URLs).
const VELA_STANDALONE_LIBS = [
  { src: "https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js", integrity: "sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z" },
  { src: "https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js", integrity: "sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1" },
  { src: "https://cdn.jsdelivr.net/npm/lucide-react@0.344.0/dist/umd/lucide-react.min.js", integrity: "sha384-EQEJvIFEf8npkbAdLZg6nG0ZK4cOAdEhtoe9EDUq7a0abTM5sG7ufDwzmJBsHVVf" },
];

// Escape a JSON string for safe inline embedding inside a <script> block — the
// same 5-char rule as assemble.py/serve.py/nl-boot.js's escape_for_script_context()
// (independently duplicated per-language by existing convention in this repo;
// kept in sync by review, not shared code).
function escapeForScriptContext(jsonStr) {
  return jsonStr
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

// Strip the ESM imports the app source needs when running under a bundler /
// text-babel host; the standalone output supplies React/lucide as UMD globals
// instead via a shim (mirrors render-offline.js's proven transform).
//
// The exported deck is meant to be SHARED (GitHub Pages / email), so it must open
// as a read-only PRESENTATION, not the editor. We flip VELA_PRESENTATION_MODE to
// true in the source (see flipPresentationMode below): that boots fullscreen present
// (init.fullscreen = VELA_PRESENTATION_MODE) with the editor chrome + test runners
// suppressed. The read-only-viewer blank-gate (part-app.jsx: `if
// (VELA_PRESENTATION_MODE && (!state.selectedId || !state.lanes.length)) return
// <blank/>`) needs a selected module, which a fresh STARTUP_PATCH load doesn't set —
// so the LOAD reducer (part-reducer.jsx) now auto-selects the first module when
// VELA_PRESENTATION_MODE is on. Together these make the export open on its first
// slide with zero edit chrome.
function stripEsmImportsForStandalone(jsx) {
  return jsx
    .replace(/^import\s+\{[^}]+\}\s+from\s+"react";\s*$/m, "")
    .replace(/^import\s+\{[^}]+\}\s+from\s+"lucide-react";\s*$/m, "")
    .replace(/^import\s+\*\s+as\s+\w+\s+from\s+"lucide-react";\s*$/m, "")
    .replace(/^export\s+default\s+function\s+/m, "function ");
}

// Replace the value bound to `const STARTUP_PATCH = ...;` with the current
// deck, whether the source holds the pristine `null` sentinel (Neutralino:
// freshly fetched vela.jsx) or an already-embedded deck object (artifact/
// serve.py: scraped from the live text/babel tag, patched at load time with
// whatever deck was open then — export always wants the deck open NOW). A
// plain regex can't safely find the end of an embedded JSON object (its
// string values may themselves contain `;`/`{`/`}`), so this walks the
// source respecting string/escape boundaries to find the top-level
// statement-terminating `;`.
function spliceStartupPatch(jsx, deckObj) {
  const marker = "const STARTUP_PATCH = ";
  const idx = jsx.indexOf(marker);
  if (idx === -1) throw new Error("STARTUP_PATCH marker not found in source");
  const valueStart = idx + marker.length;
  let i = valueStart, depth = 0, inStr = null;
  for (; i < jsx.length; i++) {
    const c = jsx[i];
    if (inStr) {
      if (c === "\\") { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "{" || c === "[" || c === "(") { depth++; continue; }
    if (c === "}" || c === "]" || c === ")") { depth--; continue; }
    if (c === ";" && depth === 0) break;
  }
  if (i >= jsx.length) throw new Error("STARTUP_PATCH statement terminator not found");
  const deckJson = escapeForScriptContext(JSON.stringify(deckObj));
  return jsx.slice(0, valueStart) + deckJson + jsx.slice(i);
}

// Flip the read-only-viewer flag so the exported HTML boots as a presentation
// (fullscreen, no editor chrome / test runners) rather than the editor. The source
// declares `const VELA_PRESENTATION_MODE = false;` exactly once (part-imports.jsx).
function flipPresentationMode(jsx) {
  const decl = "const VELA_PRESENTATION_MODE = false;";
  if (jsx.indexOf(decl) === -1) throw new Error("VELA_PRESENTATION_MODE declaration not found in source");
  return jsx.replace(decl, "const VELA_PRESENTATION_MODE = true;");
}

const MADE_WITH_VELA_FOOTER_HTML =
  "<div id=\"vela-standalone-footer\" style=\"position:fixed;right:10px;bottom:8px;z-index:99999;" +
  "font:600 11px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e2e8f0;" +
  "background:rgba(15,23,42,0.72);padding:4px 10px;border-radius:999px;" +
  "pointer-events:none;letter-spacing:.02em;user-select:none\">Made with Vela ⛵</div>";

function escapeHtmlText(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

// The pure, testable transform. `babel` is a Babel-standalone-shaped object
// (window.Babel in-browser, or the vendored babel.min.js required in a Node
// test) — passed in rather than read off a global so this can be unit-tested
// outside the browser. Returns the full standalone HTML document string.
function buildStandaloneHtml(jsxSource, deckObj, opts = {}) {
  const { footer = false, babel } = opts;
  if (!babel || typeof babel.transform !== "function") throw new Error("buildStandaloneHtml requires a Babel-standalone instance");
  let jsx = stripEsmImportsForStandalone(jsxSource);
  jsx = spliceStartupPatch(jsx, deckObj);
  jsx = flipPresentationMode(jsx);
  const shim =
    "const { useState, useReducer, useEffect, useLayoutEffect, useRef, useCallback, useMemo } = React;\n" +
    "const _LucideAll = window.lucideReact;\n" +
    "const { ChevronLeft, ChevronRight, Maximize2, Minimize2, Plus, X, Presentation, Download, Upload, Search, FileDown } = window.lucideReact;\n";
  const tail =
    "\ntry { window.App = App; window._createRoot(document.getElementById(\"root\")).render(React.createElement(App)); window.__velaBooted = true; }" +
    " catch (e) { window.__velaBootError = String(e && e.stack || e); }\n";
  const src = shim + jsx + tail;
  const { code } = babel.transform(src, { presets: [["react", { runtime: "classic" }]], comments: false });
  // Neutralize </script and <!-- in the COMPILED output before inlining — the
  // proven serve.py transform (a backslash inside a JS string/regex literal is
  // inert at runtime but hides the token from the HTML tokenizer). Several of
  // the app's own XSS-regression-test strings contain literal `</script` and
  // would otherwise truncate this very <script> block. NEVER inline
  // un-neutralized compiled output.
  const safeCode = code.replace(/<\/(?=script)/gi, "<\\/").replace(/<!--/g, "<\\!--");
  const title = escapeHtmlText((deckObj && deckObj.deckTitle) || "Vela Deck");
  const libTag = (l) => `<script src="${l.src}" integrity="${l.integrity}" crossorigin="anonymous"></script>`;
  const [reactLib, reactDomLib, lucideLib] = VELA_STANDALONE_LIBS;
  // `window.react = window.React` MUST run between the react.min.js and
  // lucide-react.min.js tags: lucide's UMD wrapper reads the browser-global
  // fallback `a.react` (lowercase) synchronously at its OWN top-level
  // evaluation time (classic <script src> executes in document order), not
  // lazily — putting the shim after all 3 tags (as a naive reading of the
  // CDN+SRI shape might suggest) leaves `window.react` undefined when
  // lucide-react.min.js runs, and it silently destructures `undefined`
  // (`TypeError: reading 'forwardRef'`). Same ordering render-offline.js /
  // serve.py / index.html already use for the non-standalone runtimes.
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>html,body{margin:0;height:100%;background:#0f172a}#root{height:100vh}</style>
${libTag(reactLib)}
<script>window.react=window.React;</script>
${libTag(reactDomLib)}
${libTag(lucideLib)}
<script>window.lucideReact=window.LucideReact;window._createRoot=window.ReactDOM.createRoot;</script>
</head><body><div id="root"></div>
<script>${safeCode}</script>
${footer ? MADE_WITH_VELA_FOOTER_HTML : ""}
</body></html>`;
}
// STANDALONE_HTML_PURE_END

// Per-runtime acquisition of the app's own JSX source. Neutralino serves its
// own pristine vela.jsx same-origin (STARTUP_PATCH still `null`); artifact/
// serve.py wrap the (already deck-patched) source in a `text/babel` script
// tag — assemble.py/serve.py state that both the local preview AND the
// Claude.ai artifact viewer use this wrapping (see assemble.py's own
// docstring), so scraping its textContent is the only same-origin route in
// those runtimes. spliceStartupPatch() above re-splices the CURRENT deck over
// whichever value is already there.
async function getStandaloneJsxSource() {
  if (typeof Neutralino !== "undefined") {
    const res = await fetch("vela.jsx");
    if (!res.ok) throw new Error(`fetch vela.jsx failed: ${res.status}`);
    return await res.text();
  }
  const tag = document.querySelector('script[type="text/babel"]');
  if (tag && tag.textContent && tag.textContent.includes("STARTUP_PATCH")) return tag.textContent;
  throw new Error("App source not found (no vela.jsx and no script[type=text/babel] tag)");
}

// Gate reason for the export menu entry — null means available. Checked at
// render time (cheap: two typeof checks + a DOM query) so the button can be
// visible-but-disabled with an explanatory title instead of silently no-oping.
function velaStandaloneExportGateReason() {
  if (typeof window === "undefined" || typeof window.Babel === "undefined") return "Babel not available in this runtime";
  if (typeof Neutralino !== "undefined") return null; // Neutralino: vela.jsx always fetchable same-origin
  if (typeof document !== "undefined" && document.querySelector('script[type="text/babel"]')) return null;
  return "App source not available in this runtime";
}

// ━━━ Standalone HTML Export Modal ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function StandaloneHtmlModal({ state, onClose }) {
  const [footer, setFooter] = useState(true);
  const [phase, setPhase] = useState("choose"); // choose | exporting | done | error
  const [errorMsg, setErrorMsg] = useState("");
  const gateReason = useMemo(() => velaStandaloneExportGateReason(), []);

  const doExport = useCallback(async () => {
    setPhase("exporting");
    setErrorMsg("");
    try {
      const jsxSource = await getStandaloneJsxSource();
      const save = extractSave(state);
      const deckTitle = state.deckTitle || "Untitled";
      const deck = { deckTitle, lanes: save.lanes || [] };
      if (save.branding) deck.branding = save.branding;
      if (save.guidelines) deck.guidelines = save.guidelines;
      const html = buildStandaloneHtml(jsxSource, deck, { footer, babel: window.Babel });
      const safeTitle = deckTitle.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-{2,}/g, "-").slice(0, 60) || "vela-deck";
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url;
      a.download = `${safeTitle}-standalone.html`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setPhase("done");
    } catch (err) {
      setErrorMsg((err && err.message) || String(err));
      setPhase("error");
    }
  }, [footer, state]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 10001, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 12, width: "min(440px, 94vw)", boxShadow: "0 20px 60px rgba(0,0,0,0.6)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14 }}>🌐</span>
            <span style={{ fontFamily: FONT.mono, fontSize: 11, fontWeight: 700, color: T.accent, letterSpacing: 1 }}>EXPORT STANDALONE HTML</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 16, padding: "0 4px", lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: "20px 16px" }}>
          {phase === "choose" && <>
            <div style={{ fontFamily: FONT.body, fontSize: 13, color: T.textMuted, marginBottom: 16, lineHeight: 1.5 }}>
              One self-contained .html file with this deck baked in — drop it on GitHub Pages, attach it to an email, or open it locally. React/lucide load from a SHA-pinned CDN, so it needs network the first time it's opened.
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, padding: "10px 12px", background: "rgba(255,255,255,0.03)", border: `1px solid ${T.border}`, borderRadius: 8 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontFamily: FONT.body, fontSize: 13, color: T.text }}>Made with Vela footer</span>
                <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim }}>Small badge · bottom-right corner</span>
              </div>
              <button onClick={() => setFooter((v) => !v)} style={{
                width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer",
                background: footer ? T.accent : "rgba(255,255,255,0.12)",
                position: "relative", transition: "background .2s", flexShrink: 0,
              }}>
                <div style={{
                  width: 16, height: 16, borderRadius: 8, background: "#fff",
                  position: "absolute", top: 3,
                  left: footer ? 21 : 3,
                  transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                }} />
              </button>
            </div>
            {gateReason && <div style={{ marginBottom: 16, padding: "8px 12px", background: `${T.red}15`, border: `1px solid ${T.red}40`, borderRadius: 8, fontFamily: FONT.mono, fontSize: 11, color: T.red }}>{gateReason}</div>}
            <button onClick={doExport} disabled={!!gateReason} title={gateReason || "Export standalone HTML"} style={{
              width: "100%", padding: "10px", fontFamily: FONT.mono, fontSize: 12, fontWeight: 700,
              background: gateReason ? T.border : T.accent, color: gateReason ? T.textDim : "#fff", border: "none", borderRadius: 6,
              cursor: gateReason ? "not-allowed" : "pointer", letterSpacing: 1, opacity: gateReason ? 0.6 : 1,
            }}>
              EXPORT HTML
            </button>
          </>}
          {phase === "exporting" && <div style={{ textAlign: "center", padding: "20px 0", fontFamily: FONT.mono, fontSize: 12, color: T.textMuted }}>Building…</div>}
          {phase === "done" && <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontFamily: FONT.mono, fontSize: 12, color: T.green, marginBottom: 12 }}>✅ Downloaded</div>
            <button onClick={onClose} style={{ padding: "8px 16px", fontFamily: FONT.mono, fontSize: 12, fontWeight: 700, background: T.accent, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>Close</button>
          </div>}
          {phase === "error" && <div style={{ textAlign: "center", padding: "10px 0" }}>
            <div style={{ fontFamily: FONT.mono, fontSize: 11, color: T.red, marginBottom: 12 }}>{errorMsg}</div>
            <button onClick={() => setPhase("choose")} style={{ padding: "8px 16px", fontFamily: FONT.mono, fontSize: 12, fontWeight: 700, background: T.border, color: T.text, border: "none", borderRadius: 6, cursor: "pointer" }}>Back</button>
          </div>}
        </div>
      </div>
    </div>
  );
}


