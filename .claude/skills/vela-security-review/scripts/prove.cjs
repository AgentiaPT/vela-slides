#!/usr/bin/env node
/**
 * Batch prover — confirm many payloads in ONE call.
 *
 * Proving payloads one at a time is the dominant cost of a review: every browser probe
 * pays a fresh Chromium launch plus a settle wait, and every probe costs an agent turn.
 * This runs layer 1 over all payloads, then renders every layer-1 survivor in a SINGLE
 * page with one browser launch, and reports a per-payload verdict.
 *
 *   node prove.cjs payloads.json [--tree <dir>] [--json]
 *
 * payloads.json: [{ "id": "p1", "kind": "svg|deck|url|css|script-ctx", "input": <string|object> }]
 *   svg        - through sanitizeSvgMarkup, survivors rendered inline (the dangerouslySetInnerHTML sink)
 *   css        - a style value through sanitizeStyle, survivors rendered as an inline style
 *   deck       - through validateAndSanitizeDeck; layer 1 only (rendering needs the full app)
 *   url        - through sanitizeUrl; reports the emitted value and where it resolves
 *   script-ctx - a deck run through the tree's assembler, whose output is embedded in a
 *                <script> block; proven if an HTML tokenizer ends the element early
 *
 * Put the literal token __COLLECTOR__ in the payload where an attacker origin belongs.
 * A payload with no __COLLECTOR__ cannot be layer-2 proven; it is reported layer-1 only.
 * `script-ctx` is the exception — it needs no attacker origin, because the proof is that
 * the element closed, not that anything was fetched.
 *
 * Verdicts: fired=true is proof. fired=false with a live positive control is proof of
 * ABSENCE, which is just as useful — it is what stops an unproven finding being reported
 * as real. fired=null means the render did not happen, so nothing was learned.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const SKILL_SCRIPTS = path.resolve(__dirname, "../../vela-browser-test/scripts");
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const treeArg = args.includes("--tree") ? args[args.indexOf("--tree") + 1] : null;
const asJson = args.includes("--json");

if (!file) {
  console.error("usage: node prove.cjs payloads.json [--tree <dir>] [--json]");
  process.exit(2);
}
if (treeArg) process.env.VELA_REPO = path.resolve(treeArg);

// Lazy: the harness evaluates the tree's sanitizer source, whose exported symbol set
// varies across history — an older tree can fail to load it entirely. Requiring it up
// front made the whole prover unusable there, including for classes that need no
// sanitizer at all (script-context is decided by the HTML tokenizer). Load on first use
// so an unloadable harness only costs the kinds that actually depend on it.
let _H = null;
function harness() {
  if (_H === null) _H = require(path.join(SKILL_SCRIPTS, "sanitizer-harness.cjs"));
  return _H;
}
const payloads = JSON.parse(fs.readFileSync(file, "utf8"));

// ── layer 1: real sanitizers, one pass, no browser ──────────────────────────
const results = [];
for (const p of payloads) {
  const r = { id: p.id, kind: p.kind, layer1: null, layer2: null, note: "" };
  try {
    if (p.kind === "svg") {
      const out = harness().sanitizeSvgMarkup(String(p.input));
      r.sanitized = out;
      r.layer1 = out.includes("__COLLECTOR__") || /\son[a-z]+\s*=/i.test(out);
      r.refs = harness().svgNetworkRefs(out);
    } else if (p.kind === "css") {
      const styled = harness().sanitizeStyle(typeof p.input === "object" ? p.input : { backgroundColor: String(p.input) });
      r.sanitized = JSON.stringify(styled);
      r.layer1 = r.sanitized.includes("__COLLECTOR__");
    } else if (p.kind === "deck") {
      const out = harness().validateAndSanitizeDeck(typeof p.input === "object" ? p.input : JSON.parse(p.input));
      const leaks = harness().findLeaks(out);
      r.layer1 = leaks.length > 0;
      r.leaks = leaks.slice(0, 8);
      r.note = "deck payloads are layer-1 only — confirm the render path separately";
    } else if (p.kind === "url") {
      const out = harness().sanitizeUrl(String(p.input));
      r.sanitized = out;
      r.layer1 = Boolean(out);
      try {
        r.resolves_to = out ? new URL(out, "https://vela.local/deck").href : null;
      } catch (_) { r.resolves_to = "(unparseable)"; }
      r.note = "url payloads are layer-1 only — a link sink is not auto-fetched";
    } else if (p.kind === "script-ctx") {
      // Output-encoding class: a value is spliced into a document that will be embedded
      // inside a <script> block. There is no beacon to observe and no sanitizer to run,
      // so layer 1 cannot decide it — the question is whether an HTML tokenizer ends the
      // script element early. Deferred wholly to layer 2.
      r.layer1 = true;
      r.note = "script-context payload — decided in layer 2";
    } else {
      r.note = "unknown kind";
    }
  } catch (e) {
    r.note = "layer-1 error: " + e.message;
  }
  results.push(r);
}

// ── layer 2: every renderable survivor in ONE page, ONE browser launch ──────
const renderable = results.filter(
  (r) => r.layer1 && (r.kind === "svg" || r.kind === "css") &&
         String(r.sanitized || "").includes("__COLLECTOR__"));

if (renderable.length) {
  const body = renderable.map((r) => {
    // Namespace each payload's collector path by id so hits attribute unambiguously.
    const tagged = String(r.sanitized).split("__COLLECTOR__").join(`__COLLECTOR__/P_${r.id}`);
    return r.kind === "svg"
      ? `<div>${tagged}</div>`
      : `<div style='${JSON.parse(tagged).backgroundColor ? `background-image:${JSON.parse(tagged).backgroundColor}` : ""}'>x</div>`;
  }).join("\n");

  const html = `<!DOCTYPE html><html><body>${body}` +
               `<img src="__COLLECTOR__/PROVE_CONTROL.png"></body></html>`;
  const tmp = path.join(os.tmpdir(), `prove-${process.pid}.html`);
  fs.writeFileSync(tmp, html);
  let hits = [];
  try {
    const out = execFileSync("node", [path.join(SKILL_SCRIPTS, "browser-probe.cjs"), tmp],
                             { encoding: "utf8", timeout: 180000 });
    hits = out.split("\n").filter((l) => l.trim().startsWith("HIT "))
             .map((l) => l.trim().slice(4).trim());
  } catch (e) {
    for (const r of renderable) r.note = "layer-2 error: " + e.message;
  } finally {
    fs.unlinkSync(tmp);
  }
  // Without a live control the page never rendered — report null, never a false "inert".
  const control = hits.some((h) => h.includes("PROVE_CONTROL"));
  for (const r of renderable) {
    r.layer2 = control ? hits.some((h) => h.includes(`P_${r.id}`)) : null;
    if (!control) r.note = "positive control did not fire — render failed, nothing proven";
  }
}

// Run the tree's own assembler over a deck carrying the payload and return ONLY the line
// that inlines it. Embedding the whole assembled bundle would also embed the application
// source, which legitimately contains its own script-closing strings in test fixtures —
// the sentinel then fires no matter what the payload does, proving nothing.
function assembleWith(input, r) {
  const tree = process.env.VELA_REPO || process.cwd();
  let deck = input;
  if (typeof deck === "string") {
    const i = deck.indexOf("{");
    try { deck = JSON.parse(i >= 0 ? deck.slice(i) : deck); }
    catch (_) {
      // Models often wrap the payload in prose. Take the first balanced JSON object.
      let depth = 0, start = -1, found = null;
      for (let k = i; k >= 0 && k < deck.length; k++) {
        if (deck[k] === "{") { if (depth++ === 0) start = k; }
        else if (deck[k] === "}" && --depth === 0) { found = deck.slice(start, k + 1); break; }
      }
      try { deck = JSON.parse(found); }
      catch (_) { r.note = "payload is not parseable as a deck"; return null; }
    }
  }
  if (!deck || typeof deck !== "object") { r.note = "payload is not a deck object"; return null; }
  // A bare block is legal input; wrap it so the assembler sees a well-formed deck.
  if (!deck.lanes && !deck.slides) {
    deck = { deckTitle: "probe", lanes: [{ title: "l", items: [
      { title: "m", slides: [{ blocks: [deck] }] }] }] };
  }
  const asm = ["skills/vela-slides/scripts/assemble.py", "tools/vela-dev/scripts/assemble.py"]
    .map((rel) => path.join(tree, rel)).find((p) => fs.existsSync(p));
  if (!asm) { r.note = "no assembler in this tree"; return null; }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prove-asm-"));
  try {
    const deckPath = path.join(dir, "probe.vela");
    fs.writeFileSync(deckPath, JSON.stringify(deck));
    const outJsx = path.join(dir, "final.jsx");
    // The flag is --output at this vintage; -o is swallowed as a positional.
    for (const argv of [[deckPath, "--output", outJsx], [deckPath]]) {
      try { execFileSync("python3", [asm, ...argv], { cwd: dir, timeout: 180000, stdio: "pipe" }); }
      catch (_) { /* fall through to the next form */ }
      if (fs.existsSync(outJsx)) break;
    }
    let jsx = null;
    if (fs.existsSync(outJsx)) jsx = fs.readFileSync(outJsx, "utf8");
    else {
      const any = fs.readdirSync(dir).filter((f) => f.endsWith(".jsx"));
      if (!any.length) { r.note = "assembler produced no output"; return null; }
      jsx = fs.readFileSync(path.join(dir, any[0]), "utf8");
    }
    const lines = jsx.split("\n").filter((l) => l.includes("STARTUP_PATCH"));
    const line = lines.find((l) => /<\/script/i.test(l)) ||
                 lines.sort((a, b) => b.length - a.length)[0];
    if (!line) { r.note = "payload not found in assembled output"; return null; }
    return line;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── layer 2, script-context: one page each, because a breakout ejects the rest ──
//
// Detection is payload-agnostic: a sentinel <img> is placed INSIDE the script block,
// after the injected value. If the value does not end the element, the sentinel is inert
// text in a non-executing block and stays silent. If it does, everything after it —
// sentinel included — is parsed as live markup and the image loads. The payload is never
// inspected or rewritten, so this measures the reviewer's input, not our expectations.
//
// Isolated per page deliberately: batching them would let the first breakout swallow
// every later block and report them all as firing.
for (const r of results.filter((x) => x.kind === "script-ctx")) {
  const src = payloads.find((p) => p.id === r.id);
  const assembled = assembleWith(src && src.input, r);
  if (assembled == null) continue;
  const html = `<!DOCTYPE html><html><body><div id=root></div>\n` +
               `<script type="text/babel">\n${assembled}\n` +
               `<img src="__COLLECTOR__/P_${r.id}.png">\n</script>\n` +
               `<img src="__COLLECTOR__/PROVE_CONTROL.png"></body></html>`;
  const tmp = path.join(os.tmpdir(), `prove-sc-${process.pid}-${r.id}.html`);
  fs.writeFileSync(tmp, html);
  let hits = [];
  try {
    const out = execFileSync("node", [path.join(SKILL_SCRIPTS, "browser-probe.cjs"), tmp],
                             { encoding: "utf8", timeout: 180000 });
    hits = out.split("\n").filter((l) => l.trim().startsWith("HIT "))
             .map((l) => l.trim().slice(4).trim());
  } catch (e) {
    r.note = "layer-2 error: " + e.message;
    continue;
  } finally {
    fs.unlinkSync(tmp);
  }
  if (!hits.some((h) => h.includes("PROVE_CONTROL"))) {
    r.layer2 = null;
    r.note = "positive control did not fire — render failed, nothing proven";
  } else {
    r.layer2 = hits.some((h) => h.includes(`P_${r.id}`));
  }
}

const verdict = (r) => r.layer2 === true ? "CONFIRMED"
  : r.layer2 === false ? "inert (proven not to fire)"
  : r.layer1 ? "survives layer 1 — layer 2 not established"
  : "blocked";

if (asJson) {
  console.log(JSON.stringify(results.map((r) => ({ ...r, verdict: verdict(r) })), null, 2));
} else {
  for (const r of results) console.log(`  ${verdict(r).padEnd(38)} ${r.id} (${r.kind}) ${r.note}`);
  const n = results.filter((r) => r.layer2 === true).length;
  console.log(`\n  ${n}/${results.length} CONFIRMED in a real browser`);
}
