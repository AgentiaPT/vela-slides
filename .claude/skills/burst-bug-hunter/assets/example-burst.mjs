// example-burst.mjs — TEMPLATE for a defensive multi-step burst. Copy + adapt.
// Import the REPO's verb library (path from the repo's .hyper-sprint config), not any
// verbs from this generic skill. A burst runs unattended to completion; make it record
// a per-step trace so a wrong prediction fails at a NAMED step (cheap to correct) instead
// of silently derailing.
//
// import * as V from "file:///abs/path/to/<repo>/.hyper-sprint/<verbs>.mjs";

export async function run(page, ctx) {
  const trace = [];
  const step = async (name, fn) => {
    const t0 = Date.now();
    try { const r = await fn(); trace.push({ step: name, ok: true, ms: Date.now() - t0, r: r ?? null }); return r; }
    catch (e) { trace.push({ step: name, ok: false, ms: Date.now() - t0, err: String(e.message || e) }); throw e; }
  };
  const out = { trace };
  try {
    // await step("do X", () => V.someVerb(page, ...));
    // out.observed = await step("read state", () => page.evaluate(() => /* inspect DOM */));
    // ctx.reset() / ctx.shot("name") available. Use waitForFunction/waitForSelector, NOT fixed sleeps.
    out.reachedEnd = true;
  } catch (e) {
    out.failedAt = trace[trace.length - 1]; // exactly which predicted step was wrong
    out.reachedEnd = false;
  }
  return out;
}
