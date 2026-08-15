// driver-server.mjs — GENERIC persistent warm-app burst server (repo-agnostic).
//   node driver-server.mjs <app-url> <workdir> [config.json]
//
// The engine: open the app ONCE, keep it warm, run submitted multi-step job scripts
// ("bursts") to completion, one structured result each; enforce a hard deadline.
// ALL app-specifics come from the config (repo provides it, e.g. in .hyper-sprint/):
//   { "readyExpr":  "<JS predicate true when booted>",        // default: document.readyState==='complete'
//     "resetExpr":  "<JS that resets app to initial state>",  // optional; falls back to page.reload()
//     "initScript": "<path to JS injected BEFORE load>",       // optional (e.g. storage polyfill)
//     "viewport":   { "width":1280, "height":720 } }
// Nothing here knows about any particular app.
import { createRequire } from "module";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join, resolve, dirname, isAbsolute } from "path";
import { pathToFileURL } from "url";

// CommonJS resolution honors NODE_PATH, which lets mounted worktrees use a fast
// package store on the sandbox-local file system.
const { chromium } = createRequire(import.meta.url)("playwright");

const [url, workdirArg, configPath] = process.argv.slice(2);
if (!url) { console.error("usage: node driver-server.mjs <app-url> <workdir> [config.json]"); process.exit(2); }
const workdir = resolve(workdirArg || "/tmp/burst-drive");
const INBOX = join(workdir, "inbox"), OUTBOX = join(workdir, "outbox"), SHOTS = join(workdir, "shots");
[INBOX, OUTBOX, SHOTS].forEach(d => mkdirSync(d, { recursive: true }));

const cfg = configPath && existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
const cfgDir = configPath ? dirname(resolve(configPath)) : process.cwd();
const rel = (p) => (p && (isAbsolute(p) ? p : resolve(cfgDir, p))); // config paths resolve against the config file's dir
const READY = cfg.readyExpr || "document.readyState === 'complete'";
const RESET_EXPR = cfg.resetExpr || null;
const initPath = rel(cfg.initScript);
const INIT = initPath && existsSync(initPath) ? readFileSync(initPath, "utf8") : null;
const verbsPath = rel(cfg.verbs);
const VIEWPORT = cfg.viewport || { width: 1280, height: 720 };
const PINNED_CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const CHROME = process.env.CHROME_PATH || (existsSync(PINNED_CHROME) ? PINNED_CHROME : chromium.executablePath());
// HARD anti-hang cap: a job (import + run) may never block the loop longer than this.
// On timeout the job is ABANDONED and the context is recreated so the next job starts clean.
const JOB_TIMEOUT_MS = cfg.jobTimeoutMs || 8000;
// HARD anti-hang cap for hardRecover() itself: one END-TO-END budget covering stale-
// context close, new context/page creation, navigation, readiness wait, AND priming —
// openPage()'s own internal timeouts alone can reach ~30s, and hardRecover() can run
// again from ensureLive() on the very next job. Without a total deadline here, a queued
// job right behind a timed-out one could sit unprocessed (or wait on ensureLive()) far
// longer than any client's own wait budget (e.g. vrun's VRUN_WAIT). Keep this
// comfortably below (client wait − JOB_TIMEOUT_MS) via cfg.recoverBudgetMs if a repo's
// margin differs from the default.
const RECOVER_BUDGET_MS = cfg.recoverBudgetMs || 5000;

const browserBootStarted = Date.now();
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox"] });
// Test-only fault-injection helper shared by both control files below: the file may
// hold a count (how many attempts should fail in a row); a blank or unreadable file
// means "fail once". Decrementing (rather than a single flag) lets a test prove a
// BOUNDED retry span, not just single-attempt healing. Neither file is ever created by
// normal operation, so this has no effect outside a test.
function consumeFailCount(file) {
  let remaining = 1;
  try { const raw = readFileSync(file, "utf8").trim(); if (raw) remaining = parseInt(raw, 10) || 1; } catch {}
  if (remaining > 1) { try { writeFileSync(file, String(remaining - 1)); } catch {} }
  else { try { rmSync(file); } catch {} }
}
// Forces the next N hardRecover() attempts to fail BEFORE ever calling openPage() (a
// stand-in for a recovery that cannot even start, e.g. the browser process itself is
// gone) — see hardRecover() below.
const FORCE_RECOVER_FAIL_FILE = join(workdir, "force-recover-fail");
// Forces the next N openPage() attempts to fail AFTER the context is created — a
// stand-in for a real newPage/goto/init/readiness/priming failure — so a test can prove
// that context gets closed, not leaked. See openPage() below.
const FORCE_OPENPAGE_FAIL_FILE = join(workdir, "force-openpage-fail");
// Forces this and every following openPage() attempt to stall for the given ms AFTER
// the context is created, before proceeding — a stand-in for a real slow/stalled
// navigation or readiness wait (network stall, app that never reaches ready), as
// opposed to FORCE_OPENPAGE_FAIL_FILE's immediate throw. Read (not consumed): a test
// removes the file itself once the slow-recovery scenario is over, so the same stall
// can span more than one recovery attempt (job timeout + the next job's ensureLive()
// retry) — exactly the case a single-attempt failure fault cannot exercise.
const FORCE_OPENPAGE_DELAY_FILE = join(workdir, "force-openpage-delay-ms");
function forcedDelayMs(file) {
  try { const raw = readFileSync(file, "utf8").trim(); return raw ? parseInt(raw, 10) || 0 : 0; } catch { return 0; }
}
// One place opens a context+page and brings it to "ready": the initial boot AND the
// post-timeout hard-recover below both call this, so a recovered page is primed the
// same way the first one was.
async function openPage() {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  try {
    // Test-only fault injection: forces this attempt to fail right after the context
    // exists, standing in for a real newPage/goto/init/readiness/priming failure. See
    // FORCE_OPENPAGE_FAIL_FILE and the catch below.
    if (existsSync(FORCE_OPENPAGE_FAIL_FILE)) { consumeFailCount(FORCE_OPENPAGE_FAIL_FILE); throw new Error("forced openPage failure after context creation (test)"); }
    // Test-only fault injection: stalls right here, after the context exists but before
    // any navigation, standing in for a real slow/stalled navigation or readiness wait.
    // See FORCE_OPENPAGE_DELAY_FILE above.
    const forcedDelay = forcedDelayMs(FORCE_OPENPAGE_DELAY_FILE);
    if (forcedDelay > 0) await new Promise((r) => setTimeout(r, forcedDelay));
    const pg = await ctx.newPage();
    if (INIT) await pg.addInitScript(INIT);
    await pg.goto(url, { waitUntil: "load" });
    await pg.waitForFunction(READY, undefined, { timeout: 30000 });
    await pg.waitForTimeout(300);
    return { context: ctx, page: pg };
  } catch (e) {
    // A context this function itself created must never outlive it on failure: close
    // it before rethrowing so a repeatedly-failing recovery cannot leak one context per
    // attempt. The failed step's own error still propagates unchanged.
    try { await ctx.close(); } catch {}
    throw e;
  }
}
// `context`/`page` are `let`, not `const`: hardRecover() below reassigns them to a fresh
// pair on a job timeout. The explicit "reset" job type (below) reads these live, so it
// always acts on whatever pair is current. Per-job helpers do NOT read these — see
// makeJobCtx — so a stale job can never reach the fresh pair through them.
let { context, page } = await openPage();
const browserBootMs = Date.now() - browserBootStarted;
// True whenever `context`/`page` are a live, usable pair. Set false ONLY when
// hardRecover() itself fails to open a fresh pair — an explicit state a later job can
// check FIRST, instead of every job separately discovering "no live page" through a
// Playwright rejection. See hardRecover() and ensureLive() below.
let browserOk = true;

const resetTimesMs = [];
const resetResult = (result) => {
  resetTimesMs.push(result.ms);
  if (resetTimesMs.length > 50) resetTimesMs.shift();
  return result;
};
// Reset logic scoped to ONE explicit page `p`, never the mutable `page`/`context`
// variables — this is what lets a per-job ctx.reset (see makeJobCtx) stay pinned to
// its own job's page and reject cleanly once that page's context is closed, the same
// way a plain Playwright call would.
async function doReset(p) {
  const t0 = Date.now();
  if (RESET_EXPR) {
    // Restore the pristine init state (e.g. a storage polyfill) BEFORE the remount so a
    // prior burst's window-level override can't leak across the reset and the app boots
    // clean. addInitScript only runs on navigation, so an in-page reset must re-apply it.
    if (INIT) await p.evaluate(INIT);
    // Playwright evaluates a string argument as a JS expression IN THE PAGE (sandboxed
    // browser context, not this Node process). RESET_EXPR is trusted repo config.
    await p.evaluate(RESET_EXPR);
    await p.waitForFunction(READY, undefined, { timeout: 15000 });
    await p.waitForTimeout(200);
    return resetResult({ reset: true, mode: "in-page", ms: Date.now() - t0 });
  }
  await p.reload({ waitUntil: "load" });
  await p.waitForFunction(READY, undefined, { timeout: 30000 });
  await p.waitForTimeout(300);
  return resetResult({ reset: true, mode: "reload", ms: Date.now() - t0 });
}
// Used ONLY by the explicit "reset" job type in the main loop, which always wants
// whatever pair is CURRENTLY live (it dispatches synchronously against the live page).
async function reset() { return doReset(page); }
// A timed-out job's promise is NOT cancelled — Node has no generic way to interrupt an
// in-flight `await`. `reset()` alone (reload or in-page) is not enough here: the
// abandoned job still holds the OLD page/context and can keep calling Playwright
// methods on it while `reset()` (or the next job) uses the SAME object, so the two
// interleave. Closing the stale context turns every further Playwright call the
// abandoned job makes into an immediate rejection, and the fresh context/page this
// opens have a different identity, so a late settlement of the abandoned promise has
// nothing shared left to affect. Used ONLY on job timeout — normal jobs and explicit
// `reset` jobs keep the fast path above.
// The stale-context close AND the full openPage() (new context, new page, navigation,
// readiness wait, priming) run under ONE total deadline, RECOVER_BUDGET_MS: openPage()'s
// own internal timeouts alone can reach ~30s, and hardRecover() can run again from
// ensureLive() on the very next job — a hung or merely slow recovery must never block
// the loop, and so every later queued job, longer than this budget. A deadline win does
// NOT cancel the in-flight attempt (Playwright/Node have no such primitive for an
// in-progress await); the attempt is left to settle on its own, and if it later
// produces a context, that context is closed immediately (never adopted) so nothing it
// creates can outlive this function's own bookkeeping — see the orphan cleanup below.
async function hardRecover() {
  const t0 = Date.now();
  const stale = context;
  const recoverWork = (async () => {
    // Close the stale context FIRST and unconditionally — fail closed. If opening the
    // fresh pair below then fails, `context`/`page` are set to null (not left pointing
    // at this closed stale pair): the abandoned job's context is never left open and
    // shared with later work, even on recovery failure, and "no live page" becomes
    // unambiguous.
    try { await stale.close(); } catch {}
    if (existsSync(FORCE_RECOVER_FAIL_FILE)) {
      consumeFailCount(FORCE_RECOVER_FAIL_FILE);
      throw new Error("forced hard-recover failure (test)");
    }
    return await openPage();
  })();
  const DEADLINE = Symbol("recover-deadline");
  const raced = await Promise.race([
    recoverWork.then((pair) => ({ pair }), (e) => ({ err: e })),
    new Promise((res) => setTimeout(() => res(DEADLINE), RECOVER_BUDGET_MS)),
  ]);
  if (raced === DEADLINE) {
    // Budget expired before the attempt settled: fail closed NOW so the loop (and any
    // later job's own ensureLive() retry) is never blocked longer than this budget.
    context = null; page = null; browserOk = false;
    // The abandoned attempt keeps running in the background. If it eventually resolves
    // with a fresh pair, that pair was never adopted (this function already returned
    // failure) — close it so it cannot leak. If it rejects instead, openPage()'s own
    // catch already closed whatever context it had created.
    recoverWork.then((pair) => { pair.context.close().catch(() => {}); }, () => {});
    throw new Error(`hard-recover exceeded its ${RECOVER_BUDGET_MS}ms recovery budget — abandoned, browser marked unavailable`);
  }
  if (raced.err) {
    context = null; page = null; browserOk = false;
    throw raced.err;
  }
  ({ context, page } = raced.pair);
  browserOk = true;
  return resetResult({ reset: true, mode: "hard-recover", ms: Date.now() - t0 });
}
// One bounded attempt to bring the browser back BEFORE dispatching a job that needs a
// live page. When the browser is already fine this is a same-tick no-op (the fast path
// stays fast). When a prior hardRecover() failed, this tries exactly once more; success
// lets the caller proceed normally, failure lets the caller return a fast, structured
// result for that one job instead of touching a page that does not exist — no job ever
// waits out its own client-side timeout waiting on a dead browser.
async function ensureLive() {
  if (browserOk) return true;
  try { await hardRecover(); return true; } catch { return false; }
}
let verbsPromise = null;
const loadVerbs = () => {
  if (!verbsPath || !existsSync(verbsPath)) throw new Error("No verb library is configured");
  verbsPromise ||= import(pathToFileURL(verbsPath).href);
  return verbsPromise;
};
// One ctx object PER JOB, pinned to the exact page it was dispatched with (`jobPage`).
// This must never read the mutable `page`/`context` variables: if a timed-out job
// keeps running after hardRecover() swaps them for a fresh pair, a stale ctx.shot /
// ctx.sleep / ctx.reset call would otherwise silently act on the NEW page instead of
// its own. Pinned to `jobPage`, each call is an ordinary Playwright call against that
// specific page, so once its context is closed (hardRecover), every one of them
// rejects the same way a raw `jobPage.evaluate(...)` would — no separate staleness
// check needed. `verbs` is unaffected: it only loads a module, it never touches a
// page itself (job code passes its own page into each verb call), so it is shared.
function makeJobCtx(jobPage) {
  return {
    reset: () => doReset(jobPage),
    verbs: loadVerbs,
    shot: async (n) => { const p = join(SHOTS, n.endsWith(".png") ? n : n + ".png"); await jobPage.screenshot({ path: p }); return p; },
    sleep: (ms) => jobPage.waitForTimeout(ms),
  };
}

const deadlineFile = join(workdir, "deadline");
const deadlineTs = () => { try { return existsSync(deadlineFile) ? parseFloat(readFileSync(deadlineFile, "utf8")) : null; } catch { return null; } };
const remainingMs = () => { const d = deadlineTs(); return d == null ? null : Math.max(0, Math.round(d * 1000 - Date.now())); };
const pastDeadline = () => { const d = deadlineTs(); return d != null && Date.now() / 1000 > d; };
let jobs = 0, totalMs = 0;
const writeStats = () => writeFileSync(join(workdir, "stats.json"), JSON.stringify({
  browserBootMs,
  jobs,
  totalMs,
  resets: resetTimesMs.length,
  resetTimesMs,
  remainingMs: remainingMs(),
  closed: pastDeadline(),
  browserOk,
  // Live browser-context count: stays at 1 across repeated failed-then-retried
  // recovery when openPage() cleans up correctly; a leak would grow this unbounded.
  contexts: browser.contexts().length,
}));

// Writes one job's result, then accounts for it (stats/log). Called once per job. The
// TIMEOUT case below calls this itself BEFORE recovery — a slow hardRecover() must
// never delay a result that is already decided — then sets `payload = null` so the
// loop's own trailer (bottom of the `for`) skips a second write for the same job.
const finalizeJob = (id, out, payload) => {
  payload.remainingMs = remainingMs();
  writeFileSync(out, JSON.stringify(payload, null, 2));
  jobs++; totalMs += payload.ms || 0; writeStats();
  console.log(`[server] ${id} -> ${payload.ok ? "ok" : "ERR"} ${payload.ms}ms (rem=${payload.remainingMs ?? "-"})`);
};

console.log(`[server] app open once in ${browserBootMs}ms: ${url}  (ready='${READY}', reset=${RESET_EXPR ? "in-page" : "reload"})`);
writeFileSync(join(workdir, "boot-ms"), `${browserBootMs}\n`);
writeFileSync(join(workdir, "ready"), String(Date.now())); writeStats();
let running = true;
while (running) {
  for (const f of readdirSync(INBOX).filter(f => f.endsWith(".mjs")).sort()) {
    const id = f.replace(/\.mjs$/, ""), src = join(INBOX, f), out = join(OUTBOX, id + ".json"), t0 = Date.now();
    let payload;
    if (pastDeadline() && !id.startsWith("shutdown")) { try { rmSync(src); } catch {} writeFileSync(out, JSON.stringify({ ok: false, error: "DEADLINE: hunt window closed — stop now", remainingMs: 0 })); console.log(`[server] ${id} -> DEADLINE`); continue; }
    try {
      if (id.startsWith("shutdown")) { rmSync(src); running = false; payload = { ok: true, result: { shutdown: true }, ms: 0 }; }
      else if (id.startsWith("reset")) {
        rmSync(src);
        if (await ensureLive()) { payload = { ok: true, result: await reset(), ms: Date.now() - t0 }; }
        else { payload = { ok: false, error: "browser unavailable: hard recovery failed, retried and still down", ms: Date.now() - t0 }; }
      }
      else if (!(await ensureLive())) {
        // The browser is down and one bounded recovery attempt just failed again: give
        // THIS job a fast, structured result now instead of dispatching it against a
        // page that does not exist and leaving the caller to wait out its own timeout.
        try { rmSync(src); } catch {}
        payload = { ok: false, error: "browser unavailable: hard recovery failed, retried and still down", ms: Date.now() - t0 };
      }
      else {
        // Guard import AND run under one hard cap. A hung import or never-resolving
        // await can never freeze the loop: we abandon the promise and move on.
        // Capture THIS job's page + a ctx pinned to it before racing — if it times
        // out, hardRecover() below reassigns the shared `page`, but `jobPage`/`jobCtx`
        // keep pointing at the stale one, so the abandoned job stays isolated.
        const jobPage = page;
        const jobCtx = makeJobCtx(jobPage);
        const jobUrl = pathToFileURL(src).href + "?t=" + t0;
        const work = (async () => { const mod = await import(jobUrl); return await mod.run(jobPage, jobCtx); })();
        const TIMEOUT = Symbol("timeout");
        const raced = await Promise.race([
          work.then(r => ({ ok: r }), e => ({ err: String(e && e.stack || e) })),
          new Promise(res => setTimeout(() => res(TIMEOUT), JOB_TIMEOUT_MS)),
        ]);
        try { rmSync(src); } catch {}
        if (raced === TIMEOUT) {
          payload = { ok: false, error: `job exceeded ${JOB_TIMEOUT_MS}ms — abandoned, context recreated`, ms: Date.now() - t0 };
          // Write this result NOW: hardRecover() below can take far longer than the
          // client's own wait budget, and the result is already decided. Recovery still
          // runs before the loop reaches the next job, so no later job is ever
          // dispatched onto an unsafe page — only the client-facing write moved earlier.
          finalizeJob(id, out, payload);
          payload = null;
          try { await hardRecover(); } catch (e) { console.error(`[server] hard-recover failed: ${String(e && e.stack || e)}`); }
        }
        else if (raced.err) { payload = { ok: false, error: raced.err, ms: Date.now() - t0 }; }
        else { payload = { ok: true, result: raced.ok, ms: Date.now() - t0 }; }
      }
    } catch (e) { try { rmSync(src); } catch {} payload = { ok: false, error: String(e && e.stack || e), ms: Date.now() - t0 }; }
    if (payload) finalizeJob(id, out, payload);
  }
  // A plain Node timer, not a Playwright call: this poll must never depend on `page`
  // being open. `page` can legitimately be null here (browser down, recovery pending),
  // and a Playwright call on a closed/null page would throw an uncaught exception that
  // kills the whole server — the one thing every later job's response depends on.
  await new Promise((res) => setTimeout(res, 120));
}
await browser.close(); process.exit(0);
