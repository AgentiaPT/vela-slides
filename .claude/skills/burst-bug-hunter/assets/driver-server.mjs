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
import { chromium } from "playwright";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join, resolve, dirname, isAbsolute } from "path";
import { pathToFileURL } from "url";

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
const VIEWPORT = cfg.viewport || { width: 1280, height: 720 };
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
// HARD anti-hang cap: a job (import + run) may never block the loop longer than this.
// On timeout the job is ABANDONED and the page is reset so the next job starts clean.
const JOB_TIMEOUT_MS = cfg.jobTimeoutMs || 8000;

const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: VIEWPORT });
const page = await context.newPage();
if (INIT) await page.addInitScript(INIT);
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(READY, { timeout: 30000 });
await page.waitForTimeout(300);

async function reset() {
  const t0 = Date.now();
  if (RESET_EXPR) {
    // Restore the pristine init state (e.g. a storage polyfill) BEFORE the remount so a
    // prior burst's window-level override can't leak across the reset and the app boots
    // clean. addInitScript only runs on navigation, so an in-page reset must re-apply it.
    if (INIT) await page.evaluate(INIT);
    // Playwright evaluates a string argument as a JS expression IN THE PAGE (sandboxed
    // browser context, not this Node process). RESET_EXPR is trusted repo config.
    await page.evaluate(RESET_EXPR);
    await page.waitForFunction(READY, { timeout: 15000 });
    await page.waitForTimeout(200);
    return { reset: true, mode: "in-page", ms: Date.now() - t0 };
  }
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(READY, { timeout: 30000 });
  await page.waitForTimeout(300);
  return { reset: true, mode: "reload", ms: Date.now() - t0 };
}
const ctx = { reset, shot: async (n) => { const p = join(SHOTS, n.endsWith(".png") ? n : n + ".png"); await page.screenshot({ path: p }); return p; }, sleep: (ms) => page.waitForTimeout(ms) };

const deadlineFile = join(workdir, "deadline");
const deadlineTs = () => { try { return existsSync(deadlineFile) ? parseFloat(readFileSync(deadlineFile, "utf8")) : null; } catch { return null; } };
const remainingMs = () => { const d = deadlineTs(); return d == null ? null : Math.max(0, Math.round(d * 1000 - Date.now())); };
const pastDeadline = () => { const d = deadlineTs(); return d != null && Date.now() / 1000 > d; };
let jobs = 0, totalMs = 0;
const writeStats = () => writeFileSync(join(workdir, "stats.json"), JSON.stringify({ jobs, totalMs, remainingMs: remainingMs(), closed: pastDeadline() }));

console.log(`[server] app open once: ${url}  (ready='${READY}', reset=${RESET_EXPR ? "in-page" : "reload"})`);
writeFileSync(join(workdir, "ready"), String(Date.now())); writeStats();
let running = true;
while (running) {
  for (const f of readdirSync(INBOX).filter(f => f.endsWith(".mjs")).sort()) {
    const id = f.replace(/\.mjs$/, ""), src = join(INBOX, f), out = join(OUTBOX, id + ".json"), t0 = Date.now();
    let payload;
    if (pastDeadline() && !id.startsWith("shutdown")) { try { rmSync(src); } catch {} writeFileSync(out, JSON.stringify({ ok: false, error: "DEADLINE: hunt window closed — stop now", remainingMs: 0 })); console.log(`[server] ${id} -> DEADLINE`); continue; }
    try {
      if (id.startsWith("shutdown")) { rmSync(src); running = false; payload = { ok: true, result: { shutdown: true }, ms: 0 }; }
      else if (id.startsWith("reset")) { rmSync(src); payload = { ok: true, result: await reset(), ms: Date.now() - t0 }; }
      else {
        // Guard import AND run under one hard cap. A hung import or never-resolving
        // await can never freeze the loop: we abandon the promise and move on.
        const jobUrl = pathToFileURL(src).href + "?t=" + t0;
        const work = (async () => { const mod = await import(jobUrl); return await mod.run(page, ctx); })();
        const TIMEOUT = Symbol("timeout");
        const raced = await Promise.race([
          work.then(r => ({ ok: r }), e => ({ err: String(e && e.stack || e) })),
          new Promise(res => setTimeout(() => res(TIMEOUT), JOB_TIMEOUT_MS)),
        ]);
        try { rmSync(src); } catch {}
        if (raced === TIMEOUT) { payload = { ok: false, error: `job exceeded ${JOB_TIMEOUT_MS}ms — abandoned, page reset`, ms: Date.now() - t0 }; try { await reset(); } catch {} }
        else if (raced.err) { payload = { ok: false, error: raced.err, ms: Date.now() - t0 }; }
        else { payload = { ok: true, result: raced.ok, ms: Date.now() - t0 }; }
      }
    } catch (e) { try { rmSync(src); } catch {} payload = { ok: false, error: String(e && e.stack || e), ms: Date.now() - t0 }; }
    payload.remainingMs = remainingMs();
    writeFileSync(out, JSON.stringify(payload, null, 2));
    jobs++; totalMs += payload.ms || 0; writeStats();
    console.log(`[server] ${id} -> ${payload.ok ? "ok" : "ERR"} ${payload.ms}ms (rem=${payload.remainingMs ?? "-"})`);
  }
  await page.waitForTimeout(120);
}
await browser.close(); process.exit(0);
