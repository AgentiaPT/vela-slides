/**
 * Vela Desktop — native window helpers regression (CR16 title, CR18 focus).
 *
 * Drives the REAL vela-neutralino/resources/js/window-host.js under Node.
 *   CR16: native title is "Vela Slides - <deck title>" and never repeats the
 *         app name when the deck title already has it.
 *   CR18: the window re-takes focus on regain (focus event) and on
 *         visibility return, and the binding can be removed.
 *
 * Usage: node tests/test_window_host.cjs
 * Prints "✅ N passed  ❌ M failed" and exits non-zero on any failure.
 */

const path = require('path');
const { pathToFileURL } = require('url');

const MOD = path.resolve(__dirname, '..', 'vela-neutralino', 'resources', 'js', 'window-host.js');

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  const { nativeWindowTitle, bindRegainFocus } = await import(pathToFileURL(MOD).href);

  console.log('CR16: native window title');
  const titleCases = [
    ['Pitch — Vela Slides', 'Vela Slides - Pitch'],
    ['Vela Slides', 'Vela Slides'],
    ['', 'Vela Slides'],
    ['Untitled', 'Vela Slides'],
    ['Vela Slides Intro — Vela Slides', 'Vela Slides Intro'],
    ['Notes on Vela Slides — Vela Slides', 'Notes on Vela Slides'],
    ['Line\u0000One — Vela Slides', 'Vela Slides - Line One'],
    ['Team   Plan — Vela Slides', 'Vela Slides - Team Plan'],
  ];
  for (const [input, want] of titleCases) {
    const got = nativeWindowTitle(input);
    check(`"${JSON.stringify(input).slice(1, -1)}" -> "${want}"`, got === want, `got "${got}"`);
  }
  const long = nativeWindowTitle('A'.repeat(300) + ' — Vela Slides');
  check('long deck title is capped at 200 characters', Array.from(long).length === 200,
    `length ${Array.from(long).length}`);

  console.log('CR18: regain focus');
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { hidden: false });
  let calls = 0;
  const unbind = bindRegainFocus(win, doc, () => { calls++; });
  win.dispatchEvent(new Event('focus'));
  check('window focus event re-runs the focus handler', calls === 1, `calls=${calls}`);
  doc.hidden = true;
  doc.dispatchEvent(new Event('visibilitychange'));
  check('hidden document does not re-run the handler', calls === 1, `calls=${calls}`);
  doc.hidden = false;
  doc.dispatchEvent(new Event('visibilitychange'));
  check('visible again re-runs the handler', calls === 2, `calls=${calls}`);
  unbind();
  win.dispatchEvent(new Event('focus'));
  doc.dispatchEvent(new Event('visibilitychange'));
  check('unbind removes both listeners', calls === 2, `calls=${calls}`);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ✅ ${passed} passed  ❌ ${failed} failed`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
