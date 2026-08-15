// Regression suite for the AI-operation-cancellation owner-token bug (finding 1/4):
// timing (estimate) and Alternatives cancellation used to delete the owner
// token WITHOUT clearing state.aiWork, so their own async finalizer's
// operationIsCurrent() check then failed and could never clear it either —
// leaving the shimmer/busy state stuck. clearOwnedAiWork() is the shared fix:
// a cancel path clears aiWork only if it still owns the named slot, and must
// never clear a DIFFERENT, still-active operation's aiWork.
const fs = require("fs");
const path = require("path");
const P = (f) => path.join(__dirname, "..", "src/parts", f);
const panel = fs.readFileSync(P("part-slidepanel.jsx"), "utf8");

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  \u2705 " + n); };
const bad = (n, d) => { fail++; console.log("  \u274c " + n + (d ? " \u2014 " + d : "")); };

// ---- extract `const NAME = (...) => { ... };` (multi-line, brace-matched) ----
function arrowBlock(src, name) {
  const marker = `const ${name} = `;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error("not found: " + name);
  const braceStart = src.indexOf("{", start);
  if (braceStart < 0) throw new Error("no body brace for: " + name);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i).replace(/^const\s+\w+\s*=\s*/, "");
}

// clearOwnedAiWork references free variables (operationOwnersRef, dispatch) from
// the enclosing component scope — eval it inside a factory that supplies them.
function makeClearOwnedAiWork(operationOwnersRef, dispatch) {
  // eslint-disable-next-line no-eval
  return eval("(" + arrowBlock(panel, "clearOwnedAiWork") + ")");
}

// Test 1: cancelling an operation that STILL owns the shared marker clears it.
{
  const operationOwnersRef = { current: { alternatives: {} } };
  let aiWork = { itemId: "altTarget", slideIdx: 1 };
  const dispatch = (a) => { if (a.type === "SET_AI_WORK") aiWork = a.value; };
  const fn = makeClearOwnedAiWork(operationOwnersRef, dispatch);
  fn("alternatives");
  if (aiWork === null && operationOwnersRef.current.alternatives === undefined) {
    ok("cancel clears matching aiWork + drops the owner token");
  } else {
    bad("cancel clears matching aiWork", `aiWork=${JSON.stringify(aiWork)} owner=${JSON.stringify(operationOwnersRef.current.alternatives)}`);
  }
}

// Test 2: cancelling a name that is NOT currently owned (already finished, or
// never started — e.g. a defensive Escape/arrow-nav cancel with nothing running)
// must NOT touch aiWork, even though a DIFFERENT, still-active operation
// (e.g. "improve") currently owns it. This is the "must not clear newer AI
// work" requirement.
{
  const operationOwnersRef = { current: { improve: {} } }; // alternatives NOT owned
  let aiWork = { itemId: "improveTarget", slideIdx: 2 }; // set by the OTHER op
  const dispatch = (a) => { if (a.type === "SET_AI_WORK") aiWork = a.value; };
  const fn = makeClearOwnedAiWork(operationOwnersRef, dispatch);
  fn("alternatives"); // defensive cancel of a name that isn't active
  if (aiWork && aiWork.itemId === "improveTarget") {
    ok("cancel of a not-currently-owned name never clears a newer/different op's aiWork");
  } else {
    bad("cancel must not clear newer aiWork", `aiWork=${JSON.stringify(aiWork)}`);
  }
}

// Test 3: stale-operation isolation is preserved — the owner token is always
// dropped by the cancel path (so a stale async finalizer's own
// operationIsCurrent() still correctly reports false), regardless of whether
// aiWork was cleared.
{
  const operationOwnersRef = { current: {} };
  const dispatch = () => { throw new Error("must not dispatch when nothing owned"); };
  const fn = makeClearOwnedAiWork(operationOwnersRef, dispatch);
  let threw = false;
  try { fn("estimate"); } catch { threw = true; }
  if (!threw && !("estimate" in operationOwnersRef.current)) {
    ok("cancelling an unowned name is a no-op (no dispatch, token stays absent)");
  } else {
    bad("cancelling an unowned name must no-op", threw ? "dispatch was called" : "token present");
  }
}

// ---- static proof every timing + Alternatives cancel path was wired to the fix ----
// (Stop button, ribbon toggle, Escape/keyboard cancel, and the slide-change
// effect all funnel through clearOwnedAiWork — not a bare `delete`.)
const siteChecks = [
  [/stopAlternatives = \(\) => \{ clearOwnedAiWork\("alternatives"\)/, "stopAlternatives (Stop/Escape/nav) uses clearOwnedAiWork"],
  [/stopEstimate = \(\) => \{ clearOwnedAiWork\("estimate"\)/, "stopEstimate (ribbon toggle + stop button) uses clearOwnedAiWork"],
  [/toggleTiming: \(\) => estimating \? stopEstimate\(\)/, "ribbon toggleTiming routes through stopEstimate"],
  [/onClick=\{stopEstimate\}/, "inline timing stop button wired to stopEstimate"],
];
for (const [re, label] of siteChecks) {
  if (re.test(panel)) ok(label); else bad(label, "pattern not found in part-slidepanel.jsx");
}

// The slide-change effect that used to `delete operationOwnersRef.current.alternatives`
// bare must now also route through clearOwnedAiWork.
const slideChangeEffect = panel.slice(panel.indexOf("// Clear alternatives when slide changes"), panel.indexOf("// Clear alternatives when slide changes") + 300);
if (/clearOwnedAiWork\("alternatives"\)/.test(slideChangeEffect)) {
  ok("slide-change effect clears alternatives' aiWork via clearOwnedAiWork");
} else {
  bad("slide-change effect must use clearOwnedAiWork", slideChangeEffect);
}

// No remaining bare `delete operationOwnersRef.current.alternatives` / `.estimate`
// outside clearOwnedAiWork itself (regression guard against a future drift back
// to the old, non-clearing pattern).
const bareDeletes = (panel.match(/delete operationOwnersRef\.current\.(alternatives|estimate)\b/g) || []);
if (bareDeletes.length === 0) {
  ok("no bare delete-only cancellation remains for alternatives/estimate");
} else {
  bad("bare delete-only cancellation still present", bareDeletes.join(", "));
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 2 : 0);
