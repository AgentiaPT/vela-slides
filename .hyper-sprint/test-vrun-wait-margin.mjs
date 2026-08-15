// test-vrun-wait-margin.mjs — focused config-drift guard for this repo's burst
// client wait.
//
// Invariant: the client-side wait (VRUN_WAIT, sourced from copilot-env.sh) must
// stay ABOVE this repo's combined server-side budget (jobTimeoutMs from
// burst-hunter.json + driver-server.mjs's recoverBudgetMs default), with a
// minimum margin — never equal to or below it. An equal value has zero margin:
// a job queued right behind one that just timed out can still return after the
// client already gave up (see driver-server.mjs's own RECOVER_BUDGET_MS
// comment for why a queued job can be delayed up to that budget).
//
// This does not re-implement driver-server.mjs's defaults — RECOVER_BUDGET_MS
// below mirrors its literal fallback (`cfg.recoverBudgetMs || 5000`) because
// that script is a long-running server (importing it here would launch a real
// browser), so update this constant in lockstep if that default ever changes.
// If burst-hunter.json ever adds its own `recoverBudgetMs` key, this test uses
// that value instead of the mirrored default.
//
// Run directly:
//   node .hyper-sprint/test-vrun-wait-margin.mjs
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const COPILOT_ENV = join(HERE, "copilot-env.sh");
const BURST_HUNTER_CONFIG = join(HERE, "burst-hunter.json");

// Must track driver-server.mjs's `const RECOVER_BUDGET_MS = cfg.recoverBudgetMs || 5000;`.
const RECOVER_BUDGET_MS_DEFAULT = 5000;
// Minimum required cushion above the combined server-side budget: covers vrun's
// own 0.2s poll granularity plus normal process start/stop and scheduling
// overhead. Chosen deliberately smaller than the actual configured margin
// (30s − 25s = 5s), so this fails only on real drift, not on the current value.
const MIN_MARGIN_MS = 3000;

let failures = 0;
const check = (label, cond, detail) => {
  if (cond) { console.log(`  PASS  ${label}`); }
  else { failures++; console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`); }
};

// Source the real shell script rather than regexing its text, so this proves the
// actual runtime default, not a string that merely looks right.
let vrunWaitSeconds = NaN;
try {
  const out = execFileSync("sh", ["-c", `. "$1" && printf '%s' "$VRUN_WAIT"`, "sh", COPILOT_ENV], {
    encoding: "utf8",
    env: { PATH: process.env.PATH || "/usr/bin:/bin" }, // VRUN_WAIT must NOT be pre-set — we need the script's own default
  });
  vrunWaitSeconds = parseInt(out.trim(), 10);
} catch (e) {
  check("copilot-env.sh sources cleanly", false, String(e && e.message || e));
}
check("copilot-env.sh sets a numeric VRUN_WAIT default", Number.isFinite(vrunWaitSeconds), `got ${JSON.stringify(vrunWaitSeconds)}`);

let jobTimeoutMs = NaN;
let recoverBudgetMs = RECOVER_BUDGET_MS_DEFAULT;
try {
  const cfg = JSON.parse(readFileSync(BURST_HUNTER_CONFIG, "utf8"));
  jobTimeoutMs = cfg.jobTimeoutMs;
  if (typeof cfg.recoverBudgetMs === "number") recoverBudgetMs = cfg.recoverBudgetMs;
} catch (e) {
  check("burst-hunter.json parses cleanly", false, String(e && e.message || e));
}
check("burst-hunter.json sets a numeric jobTimeoutMs", Number.isFinite(jobTimeoutMs), `got ${JSON.stringify(jobTimeoutMs)}`);

if (Number.isFinite(vrunWaitSeconds) && Number.isFinite(jobTimeoutMs)) {
  const vrunWaitMs = vrunWaitSeconds * 1000;
  const combinedBudgetMs = jobTimeoutMs + recoverBudgetMs;
  const marginMs = vrunWaitMs - combinedBudgetMs;
  check(
    `VRUN_WAIT (${vrunWaitSeconds}s) stays above the combined server budget (job ${jobTimeoutMs}ms + recovery ${recoverBudgetMs}ms = ${combinedBudgetMs}ms) by at least ${MIN_MARGIN_MS}ms`,
    marginMs >= MIN_MARGIN_MS,
    `margin=${marginMs}ms`
  );
}

console.log(failures === 0 ? "\ntest-vrun-wait-margin: ALL PASS" : `\ntest-vrun-wait-margin: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
