// Behavioral unit test for Markdown export (coverage gap G7).
// deckToMarkdown (src/parts/part-pdf.jsx) is a pure state->string function with
// zero prior coverage. We eval-extract it under Node (no browser/React/canvas
// needed — it only touches state, strings, and `new Date`) and pin its REAL
// output contract for every block type + the slide/section structure, plus a
// few malformed decks to prove it never throws.
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "src/parts/part-pdf.jsx"), "utf8");

function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  // Capture from the declaration up to the next TOP-LEVEL declaration (a
  // column-0 `function`/`const`/`let`/`var`). This avoids brace-counting the
  // body entirely, so braces inside strings, template literals, comments, or
  // JSX can't corrupt the boundary. (Inner declarations are indented, so the
  // `\n`-anchored match only stops at module-level ones.) Mirrors the extractor
  // in tests/test_engine_tools.cjs.
  const after = start + `function ${name}`.length;
  const m = src.slice(after).search(/\n(?:async function |function |const |let |var )/);
  const end = m === -1 ? src.length : after + m;
  return src.slice(start, end);
}

// deckToMarkdown now routes every link/image DESTINATION through sanitizeUrl
// (the shared http/https/mailto scheme allowlist) as its Markdown-context output
// encoder, so load the REAL sanitizeUrl from part-imports.jsx first. It is
// self-contained (only `new URL`), so a lone extract of each is enough.
const importsSrc = fs.readFileSync(path.join(__dirname, "..", "src/parts/part-imports.jsx"), "utf8");
function extractFrom(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  const after = start + `function ${name}`.length;
  const m = source.slice(after).search(/\n(?:async function |function |const |let |var )/);
  const end = m === -1 ? source.length : after + m;
  return source.slice(start, end);
}
// eslint-disable-next-line no-eval
eval(extractFrom(importsSrc, "sanitizeUrl"));
// eslint-disable-next-line no-eval
eval(extract("deckToMarkdown"));

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✅ " + n); };
const bad = (n, d) => { fail++; console.log("  ❌ " + n + (d ? " — " + d : "")); };

// assert an exact line is present in the emitted markdown
const hasLine = (md, line, name) => {
  if (md.split("\n").includes(line)) ok(name);
  else bad(name, "missing line: " + JSON.stringify(line));
};
const hasSub = (md, sub, name) => {
  if (md.includes(sub)) ok(name);
  else bad(name, "missing substring: " + JSON.stringify(sub));
};
const noSub = (md, sub, name) => {
  if (!md.includes(sub)) ok(name);
  else bad(name, "unexpected substring: " + JSON.stringify(sub));
};
// A `<` is only dangerous (raw HTML tag / autolink) when UNescaped. `\<` renders
// as a literal `<`, so assert there is no `<` (that isn't backslash-escaped)
// immediately followed by a tag/comment/autolink start.
const noRawTag = (md, name) => {
  if (/(^|[^\\])<[a-zA-Z/!]/.test(md)) bad(name, "unescaped tag/autolink open present");
  else ok(name);
};

// Build a minimal deck wrapping a single slide's block list.
const deckWith = (blocks, slideExtra = {}, deckExtra = {}) => ({
  deckTitle: "T", ...deckExtra,
  lanes: [{ title: "Sec", items: [{ title: "Mod", slides: [{ blocks, ...slideExtra }] }] }],
});
const md1 = (blocks, slideExtra, deckExtra) => deckToMarkdown(deckWith(blocks, slideExtra, deckExtra));

// ── Deck / section / module scaffolding ────────────────────────────
{
  const md = md1([{ type: "text", text: "body" }], {}, { deckTitle: "My Deck" });
  hasLine(md, "# My Deck", "deck title is H1");
  hasLine(md, "# Sec", "lane/section is H1");
  hasLine(md, "## Mod", "module is H2");
  hasLine(md, "---", "horizontal rules separate sections");
  hasSub(md, "*Exported from Vela ·", "footer credit line present");
}

// ── heading: size → level mapping ──────────────────────────────────
{
  const md = md1([
    { type: "heading", text: "A", size: "4xl" },
    { type: "heading", text: "B", size: "2xl" },
    { type: "heading", text: "C", size: "lg" },
    { type: "heading", text: "D", size: "sm" },
    { type: "heading", text: "E" }, // default 2xl -> ##
  ]);
  hasLine(md, "# A", "4xl heading -> H1");
  hasLine(md, "## B", "2xl heading -> H2");
  hasLine(md, "### C", "lg heading -> H3");
  hasLine(md, "#### D", "sm heading -> H4");
  hasLine(md, "## E", "unsized heading defaults to H2");
}

// ── text (plain + link + hard-break) ───────────────────────────────
{
  const md = md1([
    { type: "text", text: "hello world" },
    { type: "text", text: "cited", link: "https://x.io" },
    { type: "text", text: "line1\nline2" },
  ]);
  hasLine(md, "hello world", "plain text passthrough");
  hasLine(md, "cited — [source](https://x.io/)", "text with link renders — [source](url)");
  hasSub(md, "line1  \nline2", "newline becomes markdown hard break (two spaces + \\n)");
}

// ── badge ──────────────────────────────────────────────────────────
hasLine(md1([{ type: "badge", text: "NEW" }]), "**NEW**", "badge -> bold");

// ── bullets (string items, object items, links) ────────────────────
{
  const md = md1([{ type: "bullets", items: ["one", { text: "two" }, { text: "three", link: "https://l.io" }] }]);
  hasLine(md, "- one", "bullet string item");
  hasLine(md, "- two", "bullet object item");
  hasLine(md, "- [three](https://l.io/)", "bullet with allowlisted link");
}

// ── icon-row ───────────────────────────────────────────────────────
{
  const md = md1([{ type: "icon-row", items: [
    { title: "Speed", text: "fast" },
    { title: "Docs", link: "http://d" },
    { title: "Bare" },
  ] }]);
  hasLine(md, "- Speed — fast", "icon-row title + text");
  hasLine(md, "- [Docs](http://d/)", "icon-row linked title");
  hasLine(md, "- Bare", "icon-row title only");
}

// ── quote ──────────────────────────────────────────────────────────
{
  const md = md1([{ type: "quote", text: "be bold", author: "Ada", link: "http://q" }]);
  hasLine(md, "> be bold", "quote blockquote");
  hasLine(md, "> — Ada", "quote author attribution");
  hasLine(md, "> [Source](http://q/)", "quote source link");
}

// ── callout ────────────────────────────────────────────────────────
{
  const md = md1([{ type: "callout", title: "Note", text: "careful", link: "http://c" }]);
  hasLine(md, "> **Note**", "callout bold title");
  hasLine(md, "> careful", "callout body");
  hasLine(md, "> [Source](http://c/)", "callout source link");
}

// ── metric (with and without label — pins trailing space quirk) ────
{
  const md = md1([
    { type: "metric", value: "42", label: "Revenue", link: "http://m" },
    { type: "metric", value: "99" },
  ]);
  hasLine(md, "**42** — Revenue", "metric value + label");
  hasLine(md, "[Source](http://m/)", "metric source link");
  // no-label metric emits a trailing space after the bold value (real quirk)
  hasLine(md, "**99** ", "metric without label keeps trailing space after bold value");
}

// ── code (language fence + label) ──────────────────────────────────
{
  const md = md1([{ type: "code", lang: "js", label: "demo", text: "const x = 1;" }]);
  hasLine(md, "*demo*", "code label -> italic");
  hasLine(md, "```js", "code opens fenced block with language");
  hasLine(md, "const x = 1;", "code body emitted verbatim");
  // exactly one bare closing fence
  const md2 = md1([{ type: "code", text: "noop" }]);
  hasLine(md2, "```", "code without lang -> bare fence");
}

// ── table (headers + separator + rows, array + {cells}) ────────────
{
  const md = md1([{ type: "table",
    headers: ["Name", "Val"],
    rows: [["a", "1"], { cells: ["b", "2"] }],
    link: "http://t" }]);
  hasLine(md, "| Name | Val |", "table header row");
  hasLine(md, "| --- | --- |", "table separator row (one --- per column)");
  hasLine(md, "| a | 1 |", "table array row");
  hasLine(md, "| b | 2 |", "table {cells} row");
  hasLine(md, "[Source](http://t/)", "table source link");
}

// ── flow / steps (numbered, loop labels) ───────────────────────────
{
  const md = md1([{ type: "flow", items: [
    { label: "Start", sublabel: "begin" },
    { title: "End" },
  ], loop: true, loopLabel: "again" }]);
  hasLine(md, "1. **Start** — begin", "flow step 1 with label/sublabel");
  hasLine(md, "2. **End**", "flow step 2 falls back to title, no sub");
  hasLine(md, "*↺ again*", "flow loop label rendered");

  const md2 = md1([{ type: "steps", items: [{ label: "Only" }], loop: true }]);
  hasLine(md2, "1. **Only**", "steps type shares flow numbering");
  hasLine(md2, "*↺ (loops back to step 1)*", "loop without label uses default text");
}

// ── timeline ───────────────────────────────────────────────────────
{
  const md = md1([{ type: "timeline", items: [
    { date: "2020", title: "Launch", text: "v1" },
    { title: "Later" },
  ] }]);
  hasLine(md, "- **2020** Launch — v1", "timeline date/title/text");
  hasLine(md, "- Later", "timeline item with only a title");
}

// ── progress ───────────────────────────────────────────────────────
{
  const md = md1([{ type: "progress", items: [
    { label: "Alpha", value: 80 },
    { label: "Beta" },
  ] }]);
  hasLine(md, "- Alpha: 80%", "progress label + value");
  hasLine(md, "- Beta: 0%", "progress missing value defaults to 0%");
}

// ── tag-group ──────────────────────────────────────────────────────
{
  const md = md1([{ type: "tag-group", items: ["react", { text: "node" }, { label: "css" }] }]);
  hasLine(md, "`react`  `node`  `css`", "tag-group backtick-wraps, joins with two spaces");
}

// ── image (external src, data src, caption fallbacks) ──────────────
{
  const md = md1([{ type: "image", src: "https://img/p.png", alt: "Pic" }]);
  hasLine(md, "![Pic](https://img/p.png)", "external image -> markdown image with alt");

  const md2 = md1([{ type: "image", src: "https://img/p.png", caption: "Cap" }]);
  hasLine(md2, "![Cap](https://img/p.png)", "image alt falls back to caption");

  const md3 = md1([{ type: "image", src: "data:image/png;base64,AAAA", caption: "Only cap" }]);
  hasLine(md3, "*Only cap*", "data: image drops binary, keeps caption as italic");
  noSub(md3, "data:image", "data: image src is never inlined into markdown");

  const md4 = md1([{ type: "image", src: "data:image/png;base64,AAAA" }]);
  noSub(md4, "AAAA", "data: image with no caption emits nothing");
}

// ── divider / svg ──────────────────────────────────────────────────
{
  const md = md1([{ type: "svg", caption: "diagram", svg: "<svg/>" }]);
  hasLine(md, "*diagram*", "svg emits only its caption (no raw markup)");
  noSub(md, "<svg", "svg markup is not emitted");

  const md2 = md1([{ type: "text", text: "a" }, { type: "divider" }, { type: "text", text: "b" }]);
  // section rules also emit ---, so just confirm divider text neighbours + a rule exist
  hasSub(md2, "---", "divider emits a horizontal rule");
}

// ── grid (nested blocks flattened) ─────────────────────────────────
{
  const md = md1([{ type: "grid", items: [
    { blocks: [{ type: "heading", text: "Left", size: "lg" }, { type: "text", text: "l-body" }] },
    { blocks: [{ type: "text", text: "r-body" }] },
  ] }]);
  hasLine(md, "### Left", "grid cell heading rendered at same depth");
  hasLine(md, "l-body", "grid cell text rendered");
  hasLine(md, "r-body", "second grid cell rendered");
}

// ── speaker notes (includeNotes default on / off) ──────────────────
{
  const md = md1([{ type: "text", text: "x" }], { speakerNotes: "say this" });
  hasLine(md, "> 🎤 *say this*", "speaker notes rendered by default");
  const off = deckToMarkdown(deckWith([{ type: "text", text: "x" }], { speakerNotes: "say this" }), { includeNotes: false });
  noSub(off, "say this", "includeNotes:false omits speaker notes");
}

// ── hidden slides / blocks / empty slides are skipped ──────────────
{
  const state = {
    deckTitle: "H",
    lanes: [{ title: "L", items: [{ title: "M", slides: [
      { hidden: true, blocks: [{ type: "text", text: "HIDDEN-SLIDE" }] },
      { blocks: [{ type: "text", text: "VISIBLE" }, { type: "text", text: "HIDDEN-BLOCK", hidden: true }] },
      { blocks: [] },                                   // empty -> skipped
      { blocks: [{ type: "text", text: "x", hidden: true }] }, // all hidden -> skipped
    ] }] }],
  };
  const md = deckToMarkdown(state);
  hasSub(md, "VISIBLE", "visible block survives");
  noSub(md, "HIDDEN-SLIDE", "hidden slide excluded");
  noSub(md, "HIDDEN-BLOCK", "hidden block filtered out");
}

// ── malformed / edge decks must not throw ──────────────────────────
const noThrow = (name, fn) => { try { fn(); ok(name); } catch (e) { bad(name, e.message); } };
noThrow("empty deck object does not throw", () => {
  const md = deckToMarkdown({});
  if (!md.includes("# Untitled Deck")) throw new Error("missing default title");
  if (!md.includes("Exported from Vela")) throw new Error("missing footer");
});
noThrow("null-ish lanes/items/slides tolerated", () =>
  deckToMarkdown({ deckTitle: "x", lanes: [{ items: [{ slides: null }] }, { items: null }] }));
noThrow("blocks with missing fields do not throw", () =>
  md1([
    { type: "heading" }, { type: "text" }, { type: "bullets" }, { type: "table" },
    { type: "code" }, { type: "metric" }, { type: "flow" }, { type: "timeline" },
    { type: "progress" }, { type: "tag-group" }, { type: "quote" }, { type: "callout" },
    { type: "icon-row" }, { type: "image" }, { type: "grid" }, { type: "svg" },
  ]));
noThrow("unknown/no-op block types are skipped silently", () =>
  md1([{ type: "spacer" }, { type: "icon", name: "star" }, { type: "totally-made-up" }]));
noThrow("missing lane/module/deck titles use defaults", () => {
  const md = deckToMarkdown({ lanes: [{ items: [{ slides: [{ blocks: [{ type: "text", text: "y" }] }] }] }] });
  if (!md.includes("# Untitled Section")) throw new Error("missing default section title");
  if (!md.includes("## Untitled Module")) throw new Error("missing default module title");
});

// ── SECURITY (F1): Markdown-context output encoding ────────────────
// Untrusted deck text must not smuggle links/images that bypass the app's
// http/https/mailto scheme allowlist. The live renderer validates inline
// [x](url) via sanitizeUrl and never auto-loads text images; the export path
// reaches parity here (CWE-116: encode at the sink for the Markdown grammar).
{
  // (1) javascript: inline link in free text collapses to its plain label
  const m1 = md1([{ type: "text", text: "click [here](javascript:alert1) now" }]);
  noSub(m1, "javascript:", "text: javascript inline link stripped");
  hasSub(m1, "here", "text: blocked inline link degrades to plain label");

  // (2) zero-click image beacons are neutralized — no markdown image survives
  const m2a = md1([{ type: "text", text: "hi ![](https://attacker.example/x.png) bye" }]);
  noSub(m2a, "![", "text: empty-alt image syntax neutralized (no auto-load)");
  const m2b = md1([{ type: "text", text: "x ![alt](javascript:alert1) y" }]);
  noSub(m2b, "![", "text: javascript image neutralized");
  noSub(m2b, "javascript:", "text: javascript image URL removed");

  // (3) file:/data:/vbscript: inline-link schemes are dropped
  for (const scheme of ["file", "data", "vbscript"]) {
    const t = scheme === "file" ? "file:///etc/passwd" : scheme === "data" ? "data:text/html,x" : "vbscript:msgbox";
    const m = md1([{ type: "text", text: `a [l](${t}) b` }]);
    noSub(m, scheme + ":", `text: ${scheme}: inline link dropped`);
  }

  // (4) an explicit .link field with a blocked scheme emits no link at all
  const m4 = md1([{ type: "text", text: "body", link: "javascript:alert1" }]);
  noSub(m4, "javascript:", "explicit .link javascript: dropped");
  noSub(m4, "[source]", "explicit .link source omitted when scheme blocked");

  // (5) table cell: literal pipe escaped (no column injection) + inline link sanitized
  const m5 = md1([{ type: "table", headers: ["a|b", "[c](javascript:alert1)"], rows: [["p|q", "ok"]] }]);
  noSub(m5, "javascript:", "table cell: inline javascript link stripped");
  hasSub(m5, "a\\|b", "table cell: literal pipe escaped, not a column break");

  // (6) code fence breakout: a ``` run in the body cannot close the fence early
  const m6 = md1([{ type: "code", text: "```\n![](https://attacker.example/x)\n```" }]);
  hasSub(m6, "````", "code: fence widened past the backtick run in the body");

  // (7) title/heading injection is neutralized and stays on one line
  const m7 = deckToMarkdown({ deckTitle: "T ![](javascript:alert1)\n# owned", lanes: [] });
  noSub(m7, "![", "title: image syntax neutralized in heading");
  noSub(m7, "javascript:", "title: javascript URL removed from heading");
  noSub(m7, "\n# owned", "title: embedded newline cannot inject a second heading");

  // (8) RED-TEAM regression (v13.28): a .link/.src DESTINATION whose sanitizeUrl
  // output still carries markdown-breaking bytes (the URL parser leaves `)`/`(`
  // unescaped; the mailto: branch returns raw newlines) must be percent-encoded
  // so it cannot close `(...)` early and inject a sibling image/link or a heading.
  const rt1 = md1([{ type: "text", text: "body", link: "https://ok.com/a)![](https://attacker.example/beacon.png)" }]);
  noSub(rt1, "![](", "link field: unbalanced ) cannot spawn a sibling image");
  noSub(rt1, ")![", "link field: destination-breaking ) is percent-encoded");
  hasSub(rt1, "%29", "link field: ) is percent-encoded inside the destination");

  const rt2 = md1([{ type: "quote", text: "q", link: "mailto:x\n# OWNED" }]);
  noSub(rt2, "\n# OWNED", "mailto link field: embedded newline cannot inject a heading");

  const rt3 = md1([{ type: "text", text: "see [x](https://ok.com/a)![](https://attacker.example/b.png)" }]);
  noSub(rt3, "![](", "inline: destination breakout downgrades, never an image");

  const rt4 = md1([{ type: "image", src: "https://ok.com/a)![](https://attacker.example/c.png)", alt: "z" }]);
  noSub(rt4, "](https://attacker.example/c.png)", "image block src: breakout neutralized in destination");

  const rt5 = md1([{ type: "bullets", items: [{ text: "b", link: "https://ok.com/a) ![](https://attacker.example/d.png)" }] }]);
  noSub(rt5, "![](", "bullet link field: breakout neutralized");

  // (11) RED-TEAM regression #3: reference-style links/images and their
  // definition lines contain no `(`, so they bypass the inline rewriter and the
  // definition URL never reaches sanitizeUrl. Residual `[`/`]` are now escaped so
  // no reference use resolves and no `[ref]: url` definition can form.
  const ref1 = deckToMarkdown({ deckTitle: "D", lanes: [{ title: "S", items: [{ title: "M", slides: [{ blocks: [
    { type: "text", text: "look ![beac][r1] here" },
    { type: "text", text: "[r1]: https://attacker.example/ref1.png" },
  ] }] }] }] });
  noSub(ref1, "![beac][r1]", "reference image USE is escaped (cannot auto-load)");
  noSub(ref1, "\n[r1]: https", "reference DEFINITION line cannot form");
  hasSub(ref1, "\\[r1\\]", "residual reference brackets are backslash-escaped");

  const ref2 = md1([{ type: "text", text: "[click][r3]\n\n[r3]: javascript:alert1" }]);
  noSub(ref2, "[r3]: javascript", "reference def with dangerous scheme neutralized");
  noSub(ref2, "[click][r3]", "reference link use escaped");

  const ref3 = md1([{ type: "text", text: "![shortcut]\n\n[shortcut]: https://attacker.example/s.png" }]);
  noSub(ref3, "![shortcut]", "shortcut/collapsed reference image escaped");

  // inline links must still survive the bracket-escaping intact
  const keep = md1([{ type: "text", text: "see [docs](https://ok.example/x) now" }]);
  hasSub(keep, "[docs](https://ok.example/x)", "legit inline link preserved through escaping");

  // (12) RED-TEAM regression #4: Markdown permits RAW HTML and autolinks
  // (`<img src>`, `<a href=javascript:>`, `<scheme:...>`) which need neither `(`
  // nor `[`. Every field routed through mdInline/mdLabel now escapes `<`/`>` so
  // none render as live markup in the exported .md.
  noRawTag(md1([{ type: "text", text: "x <img src=https://attacker.example/x.png> y" }]), "text: raw <img> beacon escaped");
  noRawTag(md1([{ type: "text", text: "a <https://attacker.example/auto.png> b" }]), "text: autolink escaped");
  noRawTag(md1([{ type: "text", text: "z <a href=\"javascript:alert(1)\">c</a>" }]), "text: raw <a>/<script> escaped");
  // the specific fields the red-team found un-backstopped at import — all route
  // through mdInline/mdLabel in export, so all are neutralized there
  noRawTag(md1([{ type: "flow", items: [{ label: "S", sublabel: "<img src=https://attacker.example/sub.png>" }] }]), "flow sublabel: raw <img> escaped");
  noRawTag(md1([{ type: "steps", items: [{ label: "x" }], loop: true, loopLabel: "<img src=https://attacker.example/loop.png>" }]), "loopLabel: raw <img> escaped");
  noRawTag(md1([{ type: "icon-row", items: [{ title: "<img src=https://attacker.example/t.png>" }] }]), "icon-row unlinked title: raw <img> escaped");
  // raw HTML smuggled inside an inline-link LABEL is escaped too
  noRawTag(md1([{ type: "text", text: "[<img src=https://attacker.example/l.png>](https://ok.example/y)" }]), "inline-link label: raw <img> escaped");
  // and confirm the escaped form is actually emitted (fix present, not just absent)
  hasSub(md1([{ type: "text", text: "<img x>" }]), "\\<img x\\>", "raw < and > are backslash-escaped");

  // (13) RED-TEAM regression #5/#6 + backslash-revive:
  // progress.value and timeline.date were emitted RAW; both now route through the encoder.
  noRawTag(md1([{ type: "progress", items: [{ label: "L", value: "<img src=https://attacker.example/p.png>" }] }]), "progress value: raw <img> neutralized");
  noRawTag(md1([{ type: "timeline", items: [{ date: "<img src=https://attacker.example/d.png>", title: "t" }] }]), "timeline date: raw <img> neutralized");
  // escGap now escapes BACKSLASH too, so an attacker `\<` cannot revive a live `<`.
  noRawTag(md1([{ type: "text", text: "a \\<img src=https://attacker.example/b.png\\> z" }]), "text: backslash-revive of <img> neutralized");
  // speakerNotes (a slide field) reaches the exporter; the backslash-revive attempt
  // is neutralized at the export encoder (and additionally HTML-stripped at import).
  const snExport = deckToMarkdown({ deckTitle: "D", lanes: [{ title: "S", items: [{ title: "M", slides: [{ blocks: [{ type: "text", text: "x" }], speakerNotes: "\\<img src=https://attacker.example/nu.png\\>" }] }] }] });
  noRawTag(snExport, "speakerNotes: backslash-revive neutralized in export");

  // (14) CodeQL regression: a table cell escapes backslash AND pipe in one pass —
  // backslash exactly once (no double-escape), pipe escaped so it can't add a column.
  const cellbs = md1([{ type: "table", headers: ["a\\b|c"], rows: [["p|q"]] }]);
  hasSub(cellbs, "a\\\\b\\|c", "table cell: backslash escaped once + pipe escaped");
  noSub(cellbs, "a\\\\\\\\b", "table cell: backslash NOT double-escaped");
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 2 : 0);
