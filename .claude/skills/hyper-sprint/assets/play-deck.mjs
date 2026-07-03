#!/usr/bin/env node
// Record the FINISHED demo deck as ONE integrated video — the final deliverable.
// Plays index.html straight through: dwells on text slides, lets each embedded clip
// play once, and screenshots mid-slide (ground-truth frame-check — see note below).
//
//   node play-deck.mjs <deck-dir> [out.webm]
//
// deck-dir is the folder holding index.html/deck.js/clips (what record-demo.mjs made).
// Requires the deck to expose window.__deckReady and window.__deckGoto (index.html does).
//
// NOTE: Playwright-recorded VP8 .webm has NO duration header, so you cannot seek it or
// read currentTime to verify it afterwards. Do NOT frame-check by re-opening the video.
// The screenshots this script takes *while recording* are the real frame-check.

// playwright is this skill's ONLY non-OS dependency (driver only — browsers are already
// at /opt/pw-browsers). Do NOT auto-install: if it's missing, ask the user to approve it.
let chromium;
try { ({ chromium } = await import("playwright")); }
catch { console.error("hyper-sprint: needs the Node 'playwright' package (driver only; browsers already present).\nThis is the skill's only non-OS dependency — new packages require user approval.\nAsk the user to approve:  npm i playwright   then re-run."); process.exit(3); }
import { mkdirSync, readdirSync } from "fs";
import { resolve, join } from "path";

const dir = resolve(process.argv[2] || ".");
const outWebm = process.argv[3] ? resolve(process.argv[3]) : join(dir, "demo.webm");
const CHROME = process.env.CHROME_PATH
  || (readdirSync("/opt/pw-browsers").find(d => d.startsWith("chromium-") && !d.includes("headless"))
      ? `/opt/pw-browsers/${readdirSync("/opt/pw-browsers").find(d => d.startsWith("chromium-") && !d.includes("headless"))}/chrome-linux/chrome`
      : undefined);
const vdir = join(dir, "_rec"), sdir = join(dir, "shots-full");
[vdir, sdir].forEach(d => mkdirSync(d, { recursive: true }));

const RATE = Number(process.env.RATE || 1.3);          // speed embedded clips so boot dead-time doesn't drag
const b = await chromium.launch({ headless: true, executablePath: CHROME,
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] }); // clips must autoplay
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: vdir, size: { width: 1280, height: 720 } } });
const p = await ctx.newPage();
await p.goto("file://" + join(dir, "index.html"), { waitUntil: "load" });
await p.waitForFunction(() => window.__deckReady);
const n = await p.evaluate(() => document.querySelectorAll(".slide").length);

await p.waitForTimeout(1200); // opening hold
for (let i = 0; i < n; i++) {
  await p.evaluate(x => window.__deckGoto(x), i);
  await p.waitForTimeout(250);
  const info = await p.evaluate((r) => { const v = document.querySelector(".slide.on video"); if (!v) return { video: false }; v.playbackRate = r; v.currentTime = 0; v.play().catch(() => {}); return { video: true, dur: v.duration || 10 }; }, RATE);
  const dwell = info.video ? Math.min(info.dur, 19) / RATE * 1000 + 500 : 4200;
  await p.waitForTimeout(Math.round(dwell * 0.55));
  await p.screenshot({ path: join(sdir, `slide-${String(i).padStart(2, "0")}.png`) }); // frame-check
  await p.waitForTimeout(Math.round(dwell * 0.45));
}
await p.waitForTimeout(1500); // closing hold
const vid = p.video();
await ctx.close();
if (vid) { await vid.saveAs(outWebm); await vid.delete().catch(() => {}); }
await b.close();
console.log(`✓ ${outWebm}\n  frame-check: inspect ${sdir}/slide-*.png (one per slide, mid-dwell)`);
