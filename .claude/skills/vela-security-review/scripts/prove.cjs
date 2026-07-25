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
 * payloads.json: [{ "id": "p1", "kind": "svg|deck|url|css", "input": <string|object> }]
 *   svg  - through sanitizeSvgMarkup, survivors rendered inline (the dangerouslySetInnerHTML sink)
 *   css  - a style value through sanitizeStyle, survivors rendered as an inline style
 *   deck - through validateAndSanitizeDeck; layer 1 only (rendering needs the full app)
 *   url  - through sanitizeUrl; reports the emitted value and where it resolves
 *
 * Put the literal token __COLLECTOR__ in the payload where an attacker origin belongs.
 * A payload with no __COLLECTOR__ cannot be layer-2 proven; it is reported layer-1 only.
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

const H = require(path.join(SKILL_SCRIPTS, "sanitizer-harness.cjs"));
const payloads = JSON.parse(fs.readFileSync(file, "utf8"));

// ── layer 1: real sanitizers, one pass, no browser ──────────────────────────
const results = [];
for (const p of payloads) {
  const r = { id: p.id, kind: p.kind, layer1: null, layer2: null, note: "" };
  try {
    if (p.kind === "svg") {
      const out = H.sanitizeSvgMarkup(String(p.input));
      r.sanitized = out;
      r.layer1 = out.includes("__COLLECTOR__") || /\son[a-z]+\s*=/i.test(out);
      r.refs = H.svgNetworkRefs(out);
    } else if (p.kind === "css") {
      const styled = H.sanitizeStyle(typeof p.input === "object" ? p.input : { backgroundColor: String(p.input) });
      r.sanitized = JSON.stringify(styled);
      r.layer1 = r.sanitized.includes("__COLLECTOR__");
    } else if (p.kind === "deck") {
      const out = H.validateAndSanitizeDeck(typeof p.input === "object" ? p.input : JSON.parse(p.input));
      const leaks = H.findLeaks(out);
      r.layer1 = leaks.length > 0;
      r.leaks = leaks.slice(0, 8);
      r.note = "deck payloads are layer-1 only — confirm the render path separately";
    } else if (p.kind === "url") {
      const out = H.sanitizeUrl(String(p.input));
      r.sanitized = out;
      r.layer1 = Boolean(out);
      try {
        r.resolves_to = out ? new URL(out, "https://vela.local/deck").href : null;
      } catch (_) { r.resolves_to = "(unparseable)"; }
      r.note = "url payloads are layer-1 only — a link sink is not auto-fetched";
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
