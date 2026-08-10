// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
// ━━━ Deck-ingress key allowlists ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECURITY (deck ingress): sanitizeSlide/sanitizeBlock used to start from a
// wholesale copy of the caller's object, so ANY key an untrusted deck (file,
// clipboard, startup patch, Vera tool result) chose rode into app state, was
// persisted, and was handed to every renderer/exporter downstream. Ingress is
// now an ALLOWLIST — same shape as SAFE_STYLE_KEYS for style objects: only the
// keys below are copied, everything else is dropped. This keeps the attack
// surface equal to the set of fields the app actually reads.
//
// The `_` prefix is a RESERVED renderer-private namespace. Internal flags
// (_gridCell, _solo, _virtual, and any future one) are set by our own code
// AFTER sanitization; a deck must never be able to forge one and pin itself
// into a layout branch the author never selected. Neither set therefore holds
// a `_` key, and building from the allowlist drops them by construction.
//
// MAINTENANCE: these two sets are the single source of truth for the key-drift
// check in tools/vela-dev/scripts/lint.py, which fails the build when
// part-blocks.jsx / part-slides.jsx read a slide.<key> or block.<key> that is
// not listed (or `_`-prefixed). Adding a renderer feature means adding its key
// here in the same change.
const SAFE_SLIDE_KEYS = new Set([
  // content
  "blocks", "L", "R", "layout",
  // legacy top-level content fields (pre-block decks; still sanitized above)
  "title", "subtitle", "quote", "author", "bullets",
  // theme / background
  "bg", "bgGradient", "bgImage", "color", "mutedColor", "accent",
  // layout & spacing
  "align", "verticalAlign", "padding", "gap",
  "splitGap", "contentFlex", "imageFlex", "imageCols",
  // presentation metadata
  "duration", "timeLock", "hidden", "notes", "speakerNotes", "studyNotes",
  "comments", "image",
]);
const SAFE_BLOCK_KEYS = new Set([
  // identity / shared. NOTE: `blocks` is deliberately absent — only a GRID CELL
  // carries a blocks array (handled by the grid branch below), never a block
  // itself, so `blocks` is a slide-only key (see SLIDE_ONLY_KEYS in part-engine).
  "type", "hidden", "style", "link", "items", "quadrants",
  "text", "content", "title", "label", "value", "name", "caption", "author",
  // typography
  "size", "align", "weight", "bold", "italic",
  "titleSize", "textSize", "labelSize", "sublabelSize", "captionSize",
  // color
  "color", "bg", "border", "borderColor", "titleColor", "textColor",
  "labelColor", "sublabelColor", "captionColor", "dateColor", "dotColor",
  "lineColor", "numberColor", "trackColor", "cellColor", "headerBg",
  "headerColor", "arrowColor", "gateColor", "loopColor", "annotationColor",
  "iconColor", "iconBg",
  // box / spacing
  "gap", "padding", "spacing", "maxWidth", "maxHeight", "height", "h",
  "rounded", "shadow", "bordered", "compact", "striped", "hideDivider",
  // media
  "src", "alt", "fit", "markup",
  // code
  "lang", "copy",
  // icon
  "icon", "iconShape", "circle", "strokeWidth",
  // table
  "headers", "rows", "cols",
  // flow / steps / timeline / cycle
  "direction", "connectorStyle", "activeStep",
  "gateIcon", "gateLabel", "loop", "loopLabel", "loopStyle",
  "centerLabel", "centerSub",
  // progress
  "showValue", "showIcons", "showLabels", "annotation",
  "leftLabel", "rightLabel", "leftIcon", "rightIcon",
  // comparison / matrix
  "dividerLabel", "variant", "xLeft", "xRight", "yTop", "yBottom",
  // callout
  "reveal",
]);

// Numeric slide fields: key → [min, max, integer?]. Deck input is coerced to a
// finite number and clamped; anything else (NaN, Infinity, "3; x", objects) is
// dropped so it can never reach a layout/CSS sink as an arbitrary token. The
// bounds are layout-sanity limits taken from how the renderer consumes each on
// the 960×540 canvas:
//   imageCols             — CSS grid track count for a run of adjacent images
//                           (1..6 cells across; beyond that a cell is unreadable)
//   gap / splitGap        — px gap between blocks / between columns (0..200 of 540)
//   contentFlex/imageFlex — flex-grow ratio of the two columns (0.1..20)
const SLIDE_NUMERIC_BOUNDS = {
  imageCols: [1, 6, true],
  gap: [0, 200, false],
  splitGap: [0, 200, false],
  contentFlex: [0.1, 20, false],
  imageFlex: [0.1, 20, false],
};
function clampDeckNumber(v, min, max, isInt) {
  const n = typeof v === "number" ? v
    : (typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
  if (!Number.isFinite(n)) return undefined;
  const c = Math.min(max, Math.max(min, n));
  return isInt ? Math.round(c) : c;
}

// Nesting cap for grid → items[].blocks[] recursion. A deck is a data file, so a
// deeply self-nested structure is never authored content — it is a cheap way to
// blow the stack (or the render tree) at load. Blocks deeper than this are dropped.
const MAX_BLOCK_DEPTH = 4;

function sanitizeBlock(block, depth = 0) {
  if (!block || typeof block !== "object" || Array.isArray(block)) return null;
  if (!SAFE_BLOCK_TYPES.has(block.type)) return null;
  if (depth > MAX_BLOCK_DEPTH) return null;
  // Allowlist copy (see SAFE_BLOCK_KEYS): unknown and `_`-prefixed keys never
  // enter `clean`, so the rest of this function only ever sees known fields.
  const clean = {};
  for (const k of SAFE_BLOCK_KEYS) {
    if (Object.prototype.hasOwnProperty.call(block, k)) clean[k] = block[k];
  }
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
  // Text-ish block fields that also reach the Markdown exporter — strip HTML at
  // ingress so no field relies on the export encoder alone (defense-in-depth,
  // complete mediation): a `<img>`/autolink in these must never survive import.
  if (clean.loopLabel) clean.loopLabel = sanitizeString(clean.loopLabel, 200);
  if (clean.alt) clean.alt = sanitizeString(clean.alt, 500);
  if (clean.centerLabel) clean.centerLabel = sanitizeString(clean.centerLabel, 200);
  if (clean.centerSub) clean.centerSub = sanitizeString(clean.centerSub, 200);
  if (clean.annotation) clean.annotation = sanitizeString(clean.annotation, 500);
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
      // NOTE: pass the recursion depth explicitly — a bare `.map(sanitizeBlock)`
      // would hand the array INDEX to the depth parameter.
      clean.items = clean.items.slice(0, 6).map((cell) => ({
        ...cell,
        // Cap nested breadth too: without this, a grid cell can carry an
        // unbounded blocks array (and each may itself be a grid), bypassing the
        // 30-blocks/slide breadth limit the slide-level arrays enforce.
        blocks: Array.isArray(cell?.blocks) ? cell.blocks.slice(0, 30).map((b) => sanitizeBlock(b, depth + 1)).filter(Boolean) : [],
      }));
    }
    if (clean.type === "icon-row") {
      clean.items = clean.items.slice(0, 20).map((it) => {
        if (typeof it === "string") return sanitizeString(it, 500);
        if (!it || typeof it !== "object") return null;
        const c = { ...it };
        if (c.text) c.text = sanitizeString(c.text, 500);
        if (c.label) c.label = sanitizeString(c.label, 200);
        if (c.title) c.title = sanitizeString(c.title, 500);
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
        if (c.sublabel) c.sublabel = sanitizeString(c.sublabel, 200);
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
        else if (c.value != null) c.value = sanitizeString(String(c.value), 20);
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
  // Strip CSS auto-load values from color/background scalars on the block
  // itself (the allowlisted top-level object). See scrubColorFields above. (v12.61)
  scrubColorFields(clean);
  scrubLayoutFields(clean);
  // Harden deck SUB-OBJECTS recursively (list items, grid cells, matrix
  // quadrants, comparison sides + their nested points): scrub color/layout/style
  // values on every nested object and drop the `_`-prefixed private namespace.
  // Unlike the top-level object these are raw-spread and keep arbitrary keys, so
  // the scrubbers are their only backstop — apply them at every level, not just
  // the first. See scrubSubObject above. (v13.24)
  if (Array.isArray(clean.items)) scrubSubObject(clean.items);
  if (Array.isArray(clean.quadrants)) scrubSubObject(clean.quadrants);
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
  // Allowlist copy (see SAFE_SLIDE_KEYS): unknown and `_`-prefixed keys are
  // dropped here, so no deck-supplied field can impersonate a renderer-private
  // flag or ride along into storage/export.
  const clean = {};
  for (const k of SAFE_SLIDE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(slide, k)) clean[k] = slide[k];
  }
  // Type + range at ingress for the numeric layout fields (see SLIDE_NUMERIC_BOUNDS).
  for (const k in SLIDE_NUMERIC_BOUNDS) {
    if (!(k in clean)) continue;
    const [min, max, isInt] = SLIDE_NUMERIC_BOUNDS[k];
    const n = clampDeckNumber(clean[k], min, max, isInt);
    if (n === undefined) delete clean[k]; else clean[k] = n;
  }
  // `hidden` (slide excluded from presentation/counts) — strict boolean only.
  if ("hidden" in clean) { if (clean.hidden === true) clean.hidden = true; else delete clean.hidden; }
  // NOTE: wrap the sanitizeBlock calls — a bare `.map(sanitizeBlock)` would pass
  // the array INDEX into the recursion-depth parameter.
  if (Array.isArray(clean.blocks)) clean.blocks = clean.blocks.slice(0, 30).map((b) => sanitizeBlock(b)).filter(Boolean);
  if (Array.isArray(clean.L)) clean.L = clean.L.slice(0, 30).map((b) => sanitizeBlock(b)).filter(Boolean);
  if (Array.isArray(clean.R)) clean.R = clean.R.slice(0, 30).map((b) => sanitizeBlock(b)).filter(Boolean);
  if (clean.title) clean.title = sanitizeString(clean.title, 500);
  if (clean.subtitle) clean.subtitle = sanitizeString(clean.subtitle, 500);
  if (clean.quote) clean.quote = sanitizeString(clean.quote, 2000);
  if (clean.author) clean.author = sanitizeString(clean.author, 200);
  // Speaker/presenter notes are plain-text metadata that the Markdown exporter
  // emits — HTML-strip them at ingress so no field depends on the export encoder
  // alone (defense-in-depth, complete mediation).
  if (clean.speakerNotes) clean.speakerNotes = sanitizeString(String(clean.speakerNotes), 5000);
  if (clean.notes) clean.notes = sanitizeString(String(clean.notes), 5000);
  if (Array.isArray(clean.bullets)) clean.bullets = clean.bullets.slice(0, 30).map((b) => sanitizeString(String(b), 1000));
  if (Array.isArray(clean.comments)) clean.comments = clean.comments.slice(0, MAX_COMMENTS).map(sanitizeComment).filter(Boolean);
  if (clean.studyNotes) {
    const sn = sanitizeStudyNotes(clean.studyNotes);
    if (sn) clean.studyNotes = sn; else delete clean.studyNotes;
  }
  // Slide background/color scalars (bg, bgGradient, color, accent, mutedColor)
  // feed inline CSS directly — scrub CSS auto-load values. See scrubColorFields. (v12.61)
  // sanitizeBlock also runs scrubLayoutFields on the analogous block-level layout
  // scalars (padding, gap, …) — apply the same pair here so the two ingress paths
  // stay consistent instead of one silently omitting a scrubber. (v13.26)
  scrubColorFields(clean);
  scrubLayoutFields(clean);
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

// SECURITY (storage-load re-sanitization): the boot path reads the deck back
// from persisted storage (localStorage / artifact storage) as raw
// `JSON.parse(...)` and used to dispatch it straight into LOAD, which only
// spreads the payload — it never re-runs sanitizeSlide. A slide that once
// reached state unsanitized (e.g. a value written before a sanitizer fix
// shipped, or via any future ingestion gap) would therefore reload — and keep
// reloading — with its dangerous value intact: the value is JSON-native, so it
// round-trips through storage perfectly. This is the persistence leg of the
// same "trust the ingress sanitizer, nothing else" gap; every OTHER load path
// (file import, startup-patch merge) already runs validateAndSanitizeDeck.
//
// Unlike validateAndSanitizeDeck (built for a fresh deck IMPORT — it discards
// ids, chat history, selection, branding, etc. and is not safe to use for a
// normal boot reload), this helper re-sanitizes ONLY the slide content inside
// an already-loaded lanes tree: ids, comments, order, and every other item/lane
// field are left exactly as read. It exists purely to re-run the same
// sanitizeSlide() gate (allowlist copy + scrubCssFields fail-closed delete) that
// every fresh-ingress path already gets, so a persisted deck can never be more
// trusted than a freshly-supplied one. (v13.26)
function resanitizeLoadedLanes(lanes) {
  if (!Array.isArray(lanes)) return lanes;
  return lanes.map((lane) => {
    if (!lane || typeof lane !== "object") return lane;
    const items = Array.isArray(lane.items) ? lane.items.map((item) => {
      if (!item || typeof item !== "object") return item;
      if (!Array.isArray(item.slides)) return item;
      return { ...item, slides: item.slides.map(sanitizeSlide).filter(Boolean) };
    }) : lane.items;
    return { ...lane, items };
  });
}

// SECURITY (storage-load re-sanitization, branding leg): resanitizeLoadedLanes
// above re-scrubs slide/block content read back from storage but deliberately
// leaves `branding` untouched (it isn't "slide content"). Branding's own color
// scalars (accentColor, footerBg, footerColor, ...) feed the exact same raw-CSS
// `background`/`color` sinks as slide/block fields, so a value that predates a
// scrubber fix (or reached storage through any future ingestion gap) would
// reload — and keep reloading — with its dangerous value intact, the same
// persistence gap resanitizeLoadedLanes exists to close for slides. Reuse
// scrubColorFields — the SAME function the SET_BRANDING reducer already runs on
// every runtime branding edit — so a persisted branding object can never be
// more trusted than a freshly-edited one. `logo` is additionally re-clamped to
// an inline `data:image/*` URI (mirroring validateAndSanitizeDeck's import-time
// clamp): it is an <img src> fetch sink that scrubColorFields' key patterns
// don't cover, so it needs its own re-validation on the same reload path. Every
// other branding field (names, ids, toggles, numeric sizing) is left exactly as
// read — this only re-runs the two sanitizers that already gate fresh ingress. (v13.27)
function resanitizeLoadedBranding(branding) {
  if (!branding || typeof branding !== "object") return branding;
  const b = { ...branding };
  scrubColorFields(b);
  if ("logo" in b) {
    const clamped = sanitizeImageDataUri(typeof b.logo === "string" ? b.logo : "");
    if (clamped) b.logo = clamped; else delete b.logo;
  }
  return b;
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

