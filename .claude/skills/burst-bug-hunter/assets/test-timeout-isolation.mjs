// test-timeout-isolation.mjs — behavioral regression test for driver-server.mjs.
//
// Proves the timeout-isolation fix: once a job exceeds jobTimeoutMs and the server
// recovers, that abandoned job's ctx (ctx.shot/ctx.sleep/ctx.reset) must stay pinned
// to its OWN (now-closed) page — it must never be able to reach the fresh page/context
// opened for later jobs through a shared ctx. Also proves the recovery-budget fix:
// hardRecover() must never block the loop (and so a queued next job) longer than
// recoverBudgetMs, even when the underlying recovery is merely SLOW/stalled rather
// than erroring outright, and any late-arriving context from an abandoned recovery
// attempt must be closed, never leaked or adopted. Run directly:
//   node .claude/skills/burst-bug-hunter/assets/test-timeout-isolation.mjs
//
// Uses the real driver-server.mjs, a real Chromium (no mocks), and a self-contained
// data: URL app — no fixture file needed. Exits 0 on pass, 1 on fail.
import { spawn } from "child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIVER = join(HERE, "driver-server.mjs");
// Matches the root .gitignore's `tmp*` pattern, so a leftover run never gets committed.
const WORKDIR = join(HERE, "..", "..", "..", "..", "tmp-timeout-isolation-test");
const INBOX = join(WORKDIR, "inbox"), OUTBOX = join(WORKDIR, "outbox");
const EVIDENCE_FILE = join(WORKDIR, "evidence.json");
// Explicit inter-process signal: the abandoned job waits for THIS file, not a fixed
// timer, before it tries any ctx helper. The test writes it only after it has itself
// confirmed BOTH that recovery finished AND that a fresh job already succeeded — so
// the abandoned job's ctx attempts can never race a still-in-progress recovery.
const RECOVERY_SIGNAL_FILE = join(WORKDIR, "recovery-signal");
const CONFIG_FILE = join(WORKDIR, "config.json");

let failures = 0;
const check = (label, cond, detail) => {
  if (cond) { console.log(`  PASS  ${label}`); }
  else { failures++; console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`); }
};

rmSync(WORKDIR, { recursive: true, force: true });
mkdirSync(INBOX, { recursive: true });
// jobTimeoutMs is short so the test runs fast and reliably triggers the timeout path.
// recoverBudgetMs must stay comfortably above openPage()'s own ~300ms fixed priming
// wait (so a normal, unfaulted recovery never spuriously trips the deadline) while
// staying well below the slow-recovery fault's injected stall below, so the deadline
// section can tell "bounded by budget" apart from "bounded only by the stall itself".
writeFileSync(CONFIG_FILE, JSON.stringify({ jobTimeoutMs: 300, recoverBudgetMs: 900 }));

const APP_URL = "data:text/html,<title>timeout-isolation-fixture</title><h1>ready</h1>";

const server = spawn(process.execPath, [DRIVER, APP_URL, WORKDIR, CONFIG_FILE], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, EVIDENCE_FILE, RECOVERY_SIGNAL_FILE },
});
let serverLog = "";
server.stdout.on("data", (d) => { serverLog += d; });
server.stderr.on("data", (d) => { serverLog += d; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForFile(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (existsSync(path)) return true; await sleep(50); }
  return false;
}
async function submit(id, body) {
  writeFileSync(join(INBOX, id + ".mjs"), body);
  const outPath = join(WORKDIR, "outbox", id + ".json");
  const got = await waitForFile(outPath, 10000);
  if (!got) return { ok: false, error: "test: no server response in time" };
  const parsed = JSON.parse(readFileSync(outPath, "utf8"));
  rmSync(outPath, { force: true });
  return parsed;
}

try {
  const booted = await waitForFile(join(WORKDIR, "ready"), 30000);
  check("server boots and opens the app once", booted);
  if (!booted) throw new Error("server never became ready:\n" + serverLog);

  // 1) A normal, fast job must still succeed quickly (warm-run behavior preserved).
  const t0 = Date.now();
  const normal = await submit("j-normal", `
    export async function run(page, ctx) { return await page.evaluate(() => document.title); }
  `);
  const normalMs = Date.now() - t0;
  check("normal job succeeds", normal.ok === true && normal.result === "timeout-isolation-fixture", JSON.stringify(normal));
  check("normal job stays fast (warm-run, < 2000ms)", normalMs < 2000, `${normalMs}ms`);

  // 2) A job that waits for an EXPLICIT SIGNAL (a plain Node timer poll on a file, not
  // a Playwright call and not a fixed-duration guess) before it touches its ctx at all.
  // The signal is only written by the test once it has ITSELF confirmed both that
  // recovery finished and that a fresh job already succeeded (see step 3 below) — so
  // this job's ctx attempts can never race however long hardRecover() actually takes.
  // It exercises ctx.sleep, ctx.shot, and ctx.reset SEPARATELY, each in its own
  // try/catch, so a regression in any single helper is caught and not masked by the
  // other two. This isolates exactly what we're testing: once the server has
  // recovered from the timeout, does the abandoned job's OWN ctx stay pinned to its
  // now-closed page (must reject), or is it a shared ctx that silently reaches the
  // fresh page opened for later jobs (the round-2 bug)?
  const hangJob = `
    import { writeFileSync, existsSync } from "fs";
    export async function run(page, ctx) {
      const sig = process.env.RECOVERY_SIGNAL_FILE;
      const deadline = Date.now() + 20000;
      while (!existsSync(sig) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const outcomes = {};
      const tryCall = async (name, fn) => {
        try { await fn(); outcomes[name] = "SUCCEEDED"; }
        catch (e) { outcomes[name] = "REJECTED:" + String(e && e.message || e); }
      };
      await tryCall("sleep", () => ctx.sleep(1));
      await tryCall("shot", () => ctx.shot("post-timeout-leak-check"));
      await tryCall("reset", () => ctx.reset());
      writeFileSync(process.env.EVIDENCE_FILE, JSON.stringify({ outcomes, at: Date.now() }));
      return { done: true };
    }
  `;
  // Baseline read BEFORE the timeout, for the deterministic finding-1 proof below.
  const resetsBeforeHang = JSON.parse(readFileSync(join(WORKDIR, "stats.json"), "utf8")).resets;
  const timedOut = await submit("j-hang", hangJob);
  check("timed-out job is reported as abandoned, not hung forever", timedOut.ok === false && /exceeded/.test(timedOut.error || ""), JSON.stringify(timedOut));

  // Finding 1, proven WITHOUT any timing threshold: stats.json is rewritten exactly
  // once per job, by finalizeJob(); hardRecover() itself never rewrites it (nothing
  // else does either, until the NEXT job runs). So if the client-facing timeout result
  // is written BEFORE hardRecover() runs (the fix), stats.json read right after the
  // client receives that result must still show the PRE-recovery reset count — it can
  // only advance once a later job runs. If the server instead waits for hardRecover()
  // to finish before writing (the bug), that same write already includes the new
  // reset count, since both happen back-to-back with no job in between.
  const statsRightAfterTimeout = JSON.parse(readFileSync(join(WORKDIR, "stats.json"), "utf8"));
  check(
    "timeout result is written before hard-recovery's reset is accounted for (client is not kept waiting on hard-recover)",
    statsRightAfterTimeout.resets === resetsBeforeHang,
    `before=${resetsBeforeHang} right-after-response=${statsRightAfterTimeout.resets}`
  );

  // 3) Immediately after the timeout, a fresh job must still work — the server
  // recovered and accepted new work without waiting on the abandoned job.
  const after = await submit("j-after", `
    export async function run(page, ctx) { return await page.evaluate(() => document.title); }
  `);
  check("next job after recovery succeeds", after.ok === true && after.result === "timeout-isolation-fixture", JSON.stringify(after));
  // Sanity check on the deterministic proof above: recovery DID eventually happen and
  // IS now accounted for, once this next job's own finalizeJob() ran.
  const statsAfterNextJob = JSON.parse(readFileSync(join(WORKDIR, "stats.json"), "utf8"));
  check("recovery is accounted for once the next job runs (sanity on the check above)", statsAfterNextJob.resets === resetsBeforeHang + 1, `resets=${statsAfterNextJob.resets}`);

  // Only NOW — after the test has itself confirmed recovery finished AND a fresh job
  // succeeded — tell the abandoned job it may try its ctx calls. This is the explicit
  // signal finding 2 requires, replacing any fixed timer.
  writeFileSync(RECOVERY_SIGNAL_FILE, String(Date.now()));

  // 4) Give the abandoned job's signal-polling loop time to notice and act, then
  // verify each of its three ctx calls was rejected, not silently reaching the fresh
  // page. A pass here proves ctx stayed pinned to the abandoned job's own (closed)
  // page — a shared ctx that read the live page would report SUCCEEDED for one or more.
  const gotEvidence = await waitForFile(EVIDENCE_FILE, 5000);
  check("abandoned job's evidence file was written", gotEvidence);
  if (gotEvidence) {
    const evidence = JSON.parse(readFileSync(EVIDENCE_FILE, "utf8"));
    check("abandoned ctx.sleep was rejected, not reaching the fresh page (isolated)", /^REJECTED:/.test(evidence.outcomes && evidence.outcomes.sleep || ""), JSON.stringify(evidence.outcomes));
    check("abandoned ctx.shot was rejected, not reaching the fresh page (isolated)", /^REJECTED:/.test(evidence.outcomes && evidence.outcomes.shot || ""), JSON.stringify(evidence.outcomes));
    check("abandoned ctx.reset was rejected, not reaching the fresh page (isolated)", /^REJECTED:/.test(evidence.outcomes && evidence.outcomes.reset || ""), JSON.stringify(evidence.outcomes));
  }

  // 5) Hard-recovery failure must not crash the server or leave later jobs hanging.
  // Force the next 2 hardRecover() attempts to fail (test-only control file, no
  // network or extra dependency): the first from THIS job's own timeout handler, the
  // second from the very next job's own bounded recovery retry. This proves: (a) the
  // server survives a failed recovery instead of an uncaught-exception crash, (b) the
  // job immediately after gets a FAST structured failure rather than hanging until a
  // client-side timeout, and (c) recovery self-heals once the fault clears, so a later
  // job succeeds again.
  writeFileSync(join(WORKDIR, "force-recover-fail"), "2");
  const hangJob2 = `
    export async function run(page, ctx) {
      await new Promise((resolve) => setTimeout(resolve, 1800));
      return { done: true };
    }
  `;
  const timedOut2 = await submit("j-hang2", hangJob2);
  check("second timed-out job is also reported as abandoned", timedOut2.ok === false && /exceeded/.test(timedOut2.error || ""), JSON.stringify(timedOut2));
  // Give the main loop one more full turn (bottom-of-loop poll) past the timeout
  // response above, so a crash on that poll — the exact defect being tested — has time
  // to happen before this check reads exitCode.
  await sleep(400);
  check("server process is still alive after a failed hard-recovery", server.exitCode === null, `exitCode=${server.exitCode}`);

  const failT0 = Date.now();
  const afterFail = await submit("j-after-fail", `
    export async function run(page, ctx) { return await page.evaluate(() => document.title); }
  `);
  const afterFailMs = Date.now() - failT0;
  check("job after a failed hard-recovery gets a structured failure, not a hang", afterFail.ok === false && /browser unavailable/.test(afterFail.error || ""), JSON.stringify(afterFail));
  check("that structured failure arrives fast (< 3000ms), not via a client-side timeout", afterFailMs < 3000, `${afterFailMs}ms`);

  const healed = await submit("j-healed", `
    export async function run(page, ctx) { return await page.evaluate(() => document.title); }
  `);
  check("server stays responsive and a later job succeeds once the fault clears (bounded retry then heal)", healed.ok === true && healed.result === "timeout-isolation-fixture", JSON.stringify(healed));

  // 6) openPage() must not leak a context on failure. Force the next 3 openPage()
  // attempts (each invoked from inside hardRecover()) to fail AFTER their context is
  // created — a stand-in for a real newPage/goto/init/readiness/priming failure. If a
  // failing attempt does not close that context, browser.contexts() grows by one per
  // attempt; if it does, the count stays put. hardRecover() itself never rewrites
  // stats.json, so the count is only observable right after a job that runs its own
  // finalizeJob() — three "reset" jobs (cheap, no import needed) drive three separate
  // recovery attempts, then a fourth job proves recovery finally succeeds once the
  // fault clears.
  writeFileSync(join(WORKDIR, "force-openpage-fail"), "3");
  const hangJob3 = `
    export async function run(page, ctx) {
      await new Promise((resolve) => setTimeout(resolve, 1800));
      return { done: true };
    }
  `;
  const timedOut3 = await submit("j-hang3", hangJob3);
  check("leak-test timed-out job is reported as abandoned", timedOut3.ok === false && /exceeded/.test(timedOut3.error || ""), JSON.stringify(timedOut3));
  const retryFail1 = await submit("reset-leak-1", "");
  check("leak-test recovery retry #2 still fails while fault is injected", retryFail1.ok === false, JSON.stringify(retryFail1));
  const retryFail2 = await submit("reset-leak-2", "");
  check("leak-test recovery retry #3 still fails while fault is injected", retryFail2.ok === false, JSON.stringify(retryFail2));
  const retrySucceed = await submit("reset-leak-3", "");
  check("leak-test recovery finally succeeds once the fault clears", retrySucceed.ok === true, JSON.stringify(retrySucceed));
  const statsAfterLeakTest = JSON.parse(readFileSync(join(WORKDIR, "stats.json"), "utf8"));
  check(
    "no context leak across 3 repeated failed recovery attempts (contexts stays at 1, not accumulating)",
    statsAfterLeakTest.contexts === 1,
    `contexts=${statsAfterLeakTest.contexts}`
  );

  // 7) A recovery that is merely SLOW (never errors) must still respect the total
  // recovery deadline. Every fault above makes an attempt throw immediately, which
  // every check above can pass even WITHOUT a total recovery deadline — a same-tick
  // throw never blocks the loop on its own. This section forces openPage() to
  // genuinely stall for 5000ms (the shape of a real slow/stalled navigation or
  // readiness wait), comfortably longer than this test's 900ms recoverBudgetMs, and
  // proves recovery still gives up at its OWN budget rather than at the stall's
  // duration — so neither this job's own recovery NOR the very next job's ensureLive()
  // retry (which triggers a SECOND stalled attempt, since the first is still failed)
  // is ever kept waiting anywhere near the injected stall. Without the deadline fix,
  // hardRecover() would await the full ~5000ms stall and then SUCCEED (this fault only
  // delays, it never errors) — so the job right behind it would wait out that entire
  // stall too, defeating the fast structured failure this proves instead.
  const FORCE_OPENPAGE_DELAY_FILE = join(WORKDIR, "force-openpage-delay-ms");
  writeFileSync(FORCE_OPENPAGE_DELAY_FILE, "5000");
  const hangJob4 = `
    export async function run(page, ctx) {
      await new Promise((resolve) => setTimeout(resolve, 1800));
      return { done: true };
    }
  `;
  const slowT0 = Date.now();
  const timedOut4 = await submit("j-hang4", hangJob4);
  check("slow-recovery timed-out job is reported as abandoned", timedOut4.ok === false && /exceeded/.test(timedOut4.error || ""), JSON.stringify(timedOut4));

  // The job right behind it must get a FAST structured failure — bounded by the
  // recovery budget (900ms, x2 for this job's own retry via ensureLive()), not by the
  // 5000ms injected stall.
  const afterSlow = await submit("j-after-slow", `
    export async function run(page, ctx) { return await page.evaluate(() => document.title); }
  `);
  const afterSlowMs = Date.now() - slowT0;
  check("job right behind a slow/stalled recovery gets a fast structured failure, not a hang", afterSlow.ok === false && /browser unavailable/.test(afterSlow.error || ""), JSON.stringify(afterSlow));
  check("that failure arrives well under the injected 5000ms stall (< 4000ms total)", afterSlowMs < 4000, `${afterSlowMs}ms`);

  // Clear the fault now (does not affect the two stalls already in flight above — each
  // captured its own 5000ms delay when it started — it only keeps any FURTHER recovery
  // attempt from stalling too).
  rmSync(FORCE_OPENPAGE_DELAY_FILE, { force: true });

  // Give BOTH abandoned stalled attempts (this job's own hard-recover, and the next
  // job's ensureLive() retry) time to finish their 5000ms stall and settle in the
  // background, before checking anything that depends on their outcome. Their late
  // contexts must be closed as orphans well before this sleep ends.
  await sleep(6000);

  // The server heals: the very next recovery attempt (driven by this job's own
  // ensureLive(), since browserOk is still false from the deadline above) is no longer
  // stalled and succeeds normally. Its OWN finalizeJob() is also what forces a FRESH
  // stats.json write — hardRecover()'s orphan cleanup does not rewrite stats.json
  // itself, so the context count is only observable right after a job that runs its
  // own finalizeJob(), same as the leak check in section 6 above.
  const healedAfterSlow = await submit("j-healed-after-slow", `
    export async function run(page, ctx) { return await page.evaluate(() => document.title); }
  `);
  check("server heals and a later job succeeds once the slow/stalled fault clears", healedAfterSlow.ok === true && healedAfterSlow.result === "timeout-isolation-fixture", JSON.stringify(healedAfterSlow));

  // Even though the two earlier stalled attempts eventually SUCCEEDED (the fault only
  // delays, it never errors), neither must have been adopted — the server already
  // committed to failure for both callers before either attempt settled, so each must
  // have been closed as an orphan instead of leaking. Only the fresh context this
  // healed job just opened should remain.
  const statsAfterSlow = JSON.parse(readFileSync(join(WORKDIR, "stats.json"), "utf8"));
  check("no context leak from a slow/stalled recovery that resolves after its own deadline (contexts stays at 1)", statsAfterSlow.contexts === 1, `contexts=${statsAfterSlow.contexts}`);

  await submit("shutdown-1", "");
} catch (e) {
  failures++;
  console.log(`  FAIL  unexpected test error — ${e && e.stack || e}\n--- server log ---\n${serverLog}`);
} finally {
  try { server.kill(); } catch {}
  rmSync(WORKDIR, { recursive: true, force: true });
}

console.log(failures === 0 ? "\ntest-timeout-isolation: ALL PASS" : `\ntest-timeout-isolation: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
