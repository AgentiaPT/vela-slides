#!/usr/bin/env node
// Generic, app-agnostic demo recorder for the claude-code-cloud-default profile.
// Records one .webm per feature clip and a screenshot at every beat (the frame-check),
// then scaffolds a self-contained HTML deck you fill in.
//
//   node record-demo.mjs <app-url> <out-dir> <scenario.mjs>
//
// The scenario is the ONLY app-specific file. It exports:
//   export async function boot(page) {}                  // wait until the app is ready
//   export const clips = [                               // one entry per change/feature
//     { name:'change-1', run: async (page, shot) => { /* drive it */ await shot('a'); } },
//   ];
// `shot(label)` saves out/shots/<clip>-<label>.png — inspect these to confirm the
// feature is actually on screen before shipping (green tests are not proof of the demo).

// playwright is this skill's ONLY non-OS dependency (driver only — the browsers are
// already at /opt/pw-browsers). Do NOT auto-install: if it's missing, ask the user.
let chromium;
try { ({ chromium } = await import("playwright")); }
catch { console.error("hyper-sprint: needs the Node 'playwright' package (driver only; browsers already present).\nThis is the skill's only non-OS dependency — new packages require user approval.\nAsk the user to approve:  npm i playwright   then re-run."); process.exit(3); }
import { mkdirSync, copyFileSync, existsSync, readdirSync } from "fs";
import { dirname, resolve, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.VELA_CHROME
  || (readdirSync("/opt/pw-browsers").find(d => d.startsWith("chromium-") && !d.includes("headless"))
      ? `/opt/pw-browsers/${readdirSync("/opt/pw-browsers").find(d => d.startsWith("chromium-") && !d.includes("headless"))}/chrome-linux/chrome`
      : undefined); // undefined → Playwright's own resolution

const [appUrl, outDir, scenarioPath] = process.argv.slice(2);
if (!appUrl || !outDir || !scenarioPath) {
  console.error("usage: node record-demo.mjs <app-url> <out-dir> <scenario.mjs>");
  process.exit(2);
}
const out = resolve(outDir);
const clipsDir = join(out, "clips"), shotsDir = join(out, "shots");
[out, clipsDir, shotsDir].forEach(d => mkdirSync(d, { recursive: true }));

// Scaffold the self-contained deck next to the clips (no CDN, app-independent).
for (const f of ["index.html", "deck.js"]) {
  const src = join(HERE, "demo", f), dst = join(out, f);
  if (existsSync(src) && !existsSync(dst)) copyFileSync(src, dst);
}

const scenario = await import(pathToFileURL(resolve(scenarioPath)).href);
const clips = scenario.clips || [];
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox"] });

for (const clip of clips) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: clipsDir, size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", e => errs.push(e.message));
  let n = 0;
  const shot = async (label) => { await page.screenshot({ path: join(shotsDir, `${clip.name}-${label || ++n}.png`) }); };
  try {
    await page.goto(appUrl, { waitUntil: "load" });
    if (scenario.boot) await scenario.boot(page);
    await clip.run(page, shot);
  } catch (e) { console.error(`clip ${clip.name} failed:`, e.message); }
  const vid = page.video();
  await ctx.close(); // finalizes the video
  if (vid) { await vid.saveAs(join(clipsDir, `${clip.name}.webm`)).catch(() => {}); await vid.delete().catch(() => {}); }
  console.log(`✓ ${clip.name}.webm  (${errs.length ? "console errs: " + errs.slice(0, 2).join("; ") : "clean"})`);
}
await browser.close();
console.log(`\nDeck scaffolded at ${out}/index.html — edit deck.js, then frame-check ${shotsDir}/*.png before shipping.`);
