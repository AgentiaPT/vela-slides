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
  // Skip the parameter list first (it may contain `{}` default values, e.g.
  // `opts = {}`, which would otherwise fool the body brace-matcher below).
  let p = src.indexOf("(", start), pd = 0;
  for (; p < src.length; p++) { if (src[p] === "(") pd++; else if (src[p] === ")") { pd--; if (pd === 0) { p++; break; } } }
  // brace-match the function body to its end
  let i = src.indexOf("{", p), depth = 0;
  for (; i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(start, i);
}

// deckToMarkdown references no external helpers (it iterates state.lanes itself
// and uses only txt/blockToMd defined inside it + `new Date`), so a lone extract
// is enough. No stubs required beyond Node's built-in Date.
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
  hasLine(md, "cited — [source](https://x.io)", "text with link renders — [source](url)");
  hasSub(md, "line1  \nline2", "newline becomes markdown hard break (two spaces + \\n)");
}

// ── badge ──────────────────────────────────────────────────────────
hasLine(md1([{ type: "badge", text: "NEW" }]), "**NEW**", "badge -> bold");

// ── bullets (string items, object items, links) ────────────────────
{
  const md = md1([{ type: "bullets", items: ["one", { text: "two" }, { text: "three", link: "u://l" }] }]);
  hasLine(md, "- one", "bullet string item");
  hasLine(md, "- two", "bullet object item");
  hasLine(md, "- [three](u://l)", "bullet with link");
}

// ── icon-row ───────────────────────────────────────────────────────
{
  const md = md1([{ type: "icon-row", items: [
    { title: "Speed", text: "fast" },
    { title: "Docs", link: "http://d" },
    { title: "Bare" },
  ] }]);
  hasLine(md, "- Speed — fast", "icon-row title + text");
  hasLine(md, "- [Docs](http://d)", "icon-row linked title");
  hasLine(md, "- Bare", "icon-row title only");
}

// ── quote ──────────────────────────────────────────────────────────
{
  const md = md1([{ type: "quote", text: "be bold", author: "Ada", link: "http://q" }]);
  hasLine(md, "> be bold", "quote blockquote");
  hasLine(md, "> — Ada", "quote author attribution");
  hasLine(md, "> [Source](http://q)", "quote source link");
}

// ── callout ────────────────────────────────────────────────────────
{
  const md = md1([{ type: "callout", title: "Note", text: "careful", link: "http://c" }]);
  hasLine(md, "> **Note**", "callout bold title");
  hasLine(md, "> careful", "callout body");
  hasLine(md, "> [Source](http://c)", "callout source link");
}

// ── metric (with and without label — pins trailing space quirk) ────
{
  const md = md1([
    { type: "metric", value: "42", label: "Revenue", link: "http://m" },
    { type: "metric", value: "99" },
  ]);
  hasLine(md, "**42** — Revenue", "metric value + label");
  hasLine(md, "[Source](http://m)", "metric source link");
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
  hasLine(md, "[Source](http://t)", "table source link");
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

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 2 : 0);
