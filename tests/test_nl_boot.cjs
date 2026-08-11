/** Behavioral tests for the isolated Neutralino title bridge. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "../vela-neutralino/resources/js/nl-boot.js"), "utf8");
const start = source.indexOf('const APP_TITLE = "Vela Slides";');
const end = source.indexOf("async function boot()", start);
if (start < 0 || end < 0) throw new Error("could not isolate title bridge");

let calls = 0;
const sandbox = {
  document: { title: "Quarterly Review — Vela Slides" },
  Neutralino: { window: { setTitle: () => {
    calls++;
    return calls === 1 ? Promise.reject(new Error("transient")) : Promise.resolve();
  } } },
  Promise, Error, setTimeout,
};
vm.createContext(sandbox);
vm.runInContext(source.slice(start, end) + "\nthis.api={formatNativeTitle,syncNativeTitle};", sandbox);

(async () => {
  if (sandbox.api.formatNativeTitle("Vela Slides") !== "Vela Slides") {
    throw new Error("brand-only title must not be duplicated");
  }
  if (sandbox.api.formatNativeTitle("Vela Slides — Vela Slides — Demo") !== "Vela Slides — Demo") {
    throw new Error("title brand normalization failed");
  }
  await sandbox.api.syncNativeTitle();
  await sandbox.api.syncNativeTitle();
  await sandbox.api.syncNativeTitle();
  if (calls !== 2) throw new Error(`expected rejection retry then success cache, got ${calls} calls`);
  console.log("nl-boot title retry: pass");
})().catch((err) => { console.error(err.stack || err); process.exit(1); });
