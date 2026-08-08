/**
 * Vela Slides — Release-build hardening tests
 *
 * Asserts that `concat.py --release` produces a bundle with NO test-hook
 * surface (ASVS V14.1.3 / V14.2.2 — remove test/debug code from the production
 * build), and that stripping the dev-only fences leaves a bundle that still
 * parses and keeps the ship-critical markers intact.
 *
 * The COMMITTED skills/vela-slides/app/vela.jsx is deliberately a DEV build:
 * the in-bundle UI battery and the offline render harness both build from it
 * and need the (runtime-gated, inert-by-default) hooks. This test is what CI
 * calls to prove the release path is clean.
 *
 * Usage:  node tests/test_release_build.cjs
 * Exit:   0 all pass · 1 any failure
 */

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const CONCAT = path.join(ROOT, 'tools', 'vela-dev', 'scripts', 'concat.py');
const PARTS = path.join(ROOT, 'src', 'parts');
const DEV_BUNDLE = path.join(ROOT, 'skills', 'vela-slides', 'app', 'vela.jsx');
const VENDOR = path.join(ROOT, 'vela-neutralino', 'resources', 'vendor');

// Unique temp dir so parallel stacks never race on the same release artifact.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-release-'));
const RELEASE_BUNDLE = path.join(TMP, 'vela-release.jsx');

// The token that must not survive into a release build. Assembled at runtime so
// this test file itself never trips a repo-wide grep for the literal.
const HOOK_TOKEN = '__vela' + 'Test';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('\n━━━ Release-build strip ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// ── Build the release bundle ─────────────────────────────────────────
let buildOut = '';
try {
  buildOut = execFileSync('python3', [CONCAT, '--release', '--out', RELEASE_BUNDLE, PARTS],
    { encoding: 'utf8', cwd: ROOT });
} catch (e) {
  console.error('concat.py --release FAILED:\n' + (e.stdout || '') + (e.stderr || ''));
  process.exit(1);
}

const release = fs.readFileSync(RELEASE_BUNDLE, 'utf8');
const dev = fs.existsSync(DEV_BUNDLE) ? fs.readFileSync(DEV_BUNDLE, 'utf8') : '';

function occurrences(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

test('release build contains ZERO test-hook references', () => {
  const hits = release.split('\n')
    .map((ln, i) => (ln.includes(HOOK_TOKEN) ? `${i + 1}: ${ln.trim().slice(0, 120)}` : null))
    .filter(Boolean);
  assert(hits.length === 0, `${hits.length} leaked line(s):\n     ` + hits.slice(0, 5).join('\n     '));
});

test('release build reports the strip in its own output', () => {
  assert(/Release strip: [1-9]\d* dev-only block\(s\) removed/.test(buildOut),
    'concat.py --release did not report stripping any dev-only block:\n' + buildOut.trim().slice(-400));
});

test('no unstripped DEV-ONLY fences remain in the release build', () => {
  assert(!release.includes('VELA:DEV-ONLY:BEGIN') && !release.includes('VELA:DEV-ONLY:END'),
    'DEV-ONLY marker survived the release strip');
});

test('release build is smaller than the dev build (something was actually removed)', () => {
  assert(dev.length > 0, 'dev bundle missing — run concat.py first');
  assert(release.length < dev.length,
    `release ${release.length}B is not smaller than dev ${dev.length}B`);
});

test('committed bundle is the DEV build (hooks present, runtime-gated)', () => {
  // Intentional: the offline render harness + in-bundle UI battery build from
  // the committed template. If this ever flips, vela-drive.js uitests goes dark.
  assert(occurrences(dev, HOOK_TOKEN) > 0,
    'committed vela.jsx has no test hooks — did the committed template become a release build?');
});

test('dev build keeps the test hooks behind a runtime gate', () => {
  assert(dev.includes('window.__velaTestMode'),
    'dev build installs test hooks without the __velaTestMode / local-mode gate');
  assert(/if \(!\(VELA_LOCAL_MODE \|\| \(typeof window !== "undefined" && window\.__velaTestMode\)\)\) return;/.test(dev),
    'expected runtime gate on the test-hook effect not found in the dev build');
});

test('release build keeps the save-status channel gated', () => {
  assert(release.includes('if (!(VELA_LOCAL_MODE || window.__velaSaveState != null)) return;'),
    'save-status channel is not gated in the release build');
});

// ── The strip must be strictly opt-in ────────────────────────────────
// tests/test_vela.py's template-sync check asserts the committed vela.jsx is
// byte-identical to a fresh default concat.py build. If --release ever leaks
// into the default path, that check breaks — so pin it here too.
test('default build is byte-identical to the committed template (strip is opt-in)', () => {
  const probe = path.join(TMP, 'vela-default.jsx');
  execFileSync('python3', [CONCAT, PARTS, probe], { encoding: 'utf8', cwd: ROOT });
  const built = fs.readFileSync(probe, 'utf8');
  assert(built === dev,
    `default concat.py output differs from the committed vela.jsx (${built.length}B vs ${dev.length}B) — ` +
    'the release strip must not affect the default build');
});

test('default build keeps every DEV-ONLY fence intact', () => {
  const b = occurrences(dev, 'VELA:DEV-ONLY:BEGIN'), e = occurrences(dev, 'VELA:DEV-ONLY:END');
  assert(b > 0 && b === e, `dev build fences unbalanced: ${b} BEGIN vs ${e} END`);
});

// ── Desktop (Neutralino) save-status is PRODUCTION wiring, not a test hook ──
// It lives next to the test hooks in part-app.jsx and must survive the strip and
// the runtime gate. The desktop shell satisfies the gate's FIRST clause:
// sync-vela.py flips VELA_LOCAL_MODE → true for the Neutralino build, so the
// channel is wired at mount — nl-boot only publishes __velaSaveState on the
// first save transition, which happens after mount.
test('release build keeps the desktop save-status production wiring', () => {
  for (const sym of ['__velaOnSaveStatus', '__velaForceSave', '__velaSaveState']) {
    assert(release.includes(sym), `desktop save wiring '${sym}' was stripped from the release build`);
  }
  assert(release.includes('data-testid="save-status-pill"'), 'save-status pill removed from the release build');
});

test('desktop build opens the save-status gate via VELA_LOCAL_MODE', () => {
  const sync = path.join(ROOT, 'vela-neutralino', 'scripts', 'sync-vela.py');
  if (!fs.existsSync(sync)) { console.log('     (sync-vela.py missing — skipped)'); return; }
  const src = fs.readFileSync(sync, 'utf8');
  assert(src.includes('const VELA_LOCAL_MODE = false;') && src.includes('const VELA_LOCAL_MODE = true;'),
    'sync-vela.py no longer flips VELA_LOCAL_MODE — the desktop save-status pill would go dark at mount');
});

// ── The DESKTOP ship path must strip the hooks (F2) ──────────────────
// sync-vela.py flips VELA_LOCAL_MODE→true for the Neutralino build, which opens
// the runtime hook gate — so the Docker ship build MUST concat with --release,
// otherwise window.__velaTestHooks would be live in the shipped desktop app.
test('desktop Dockerfile builds the embedded bundle with --release', () => {
  const dockerfile = path.join(ROOT, 'vela-neutralino', 'Dockerfile');
  if (!fs.existsSync(dockerfile)) { console.log('     (Dockerfile missing — skipped)'); return; }
  const df = fs.readFileSync(dockerfile, 'utf8');
  // Find the concat.py invocation that feeds sync-vela.py.
  const line = df.split('\n').find((l) => l.includes('concat.py') && !l.trim().startsWith('#'));
  assert(line, 'no concat.py invocation found in the Dockerfile');
  assert(/concat\.py\s+--release\b/.test(line) && /--out\b/.test(line),
    'Dockerfile concat.py does not use --release --out — the desktop ship bundle would keep test hooks live:\n     ' + (line || '').trim());
});

test('release build keeps the STARTUP_PATCH ship marker', () => {
  assert(release.includes('const STARTUP_PATCH = null;'),
    'STARTUP_PATCH marker missing — assemble.py could not inject a deck');
});

test('release build still parses (Babel transpile of the stripped monolith)', () => {
  const babelPath = path.join(VENDOR, 'babel.min.js');
  if (!fs.existsSync(babelPath)) { console.log('     (vendored babel missing — skipped)'); return; }
  const Babel = require(babelPath);
  let src = release
    .replace(/^import\s+\{[^}]+\}\s+from\s+"react";\s*$/m, '')
    .replace(/^import\s+\{[^}]+\}\s+from\s+"lucide-react";\s*$/m, '')
    .replace(/^import\s+\*\s+as\s+\w+\s+from\s+"lucide-react";\s*$/m, '')
    .replace(/^export\s+default\s+function\s+/m, 'function ');
  const { code } = Babel.transform(src, { presets: [['react', { runtime: 'classic' }]] });
  assert(code && code.length > 100000, 'transpiled release bundle looks truncated');
});

test('unbalanced DEV-ONLY fences fail the build', () => {
  const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-fence-'));
  for (const f of fs.readdirSync(PARTS)) fs.copyFileSync(path.join(PARTS, f), path.join(bad, f));
  const victim = path.join(bad, 'part-app.jsx');
  fs.writeFileSync(victim,
    fs.readFileSync(victim, 'utf8').replace('// VELA:DEV-ONLY:END', '// (end removed by test)'));
  let failed = false;
  try {
    execFileSync('python3', [CONCAT, bad, path.join(bad, 'out.jsx')],
      { encoding: 'utf8', cwd: ROOT, stdio: 'pipe' });
  } catch { failed = true; }
  fs.rmSync(bad, { recursive: true, force: true });
  assert(failed, 'concat.py accepted an unclosed DEV-ONLY fence');
});

fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\n${fail === 0 ? '✅' : '❌'} Release build: ${pass} passed, ${fail} failed, ${pass + fail} total\n`);
process.exit(fail ? 1 : 0);
