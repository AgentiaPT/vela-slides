/**
 * Vela Desktop — agents bridge handshake regression (CR19).
 *
 * Bug: after a new build starts, AI showed "offline" until the app was closed
 * and reopened, even after a rescan. The bridge cached the gatekeeper handshake
 * (port + token) for the whole session and only dropped it on HTTP 401. A stale
 * handshake from an earlier gatekeeper (dead port) therefore stuck, and every
 * later detect() reused it.
 *
 * This test drives the REAL agents-bridge.js (copied next to its ESM
 * dependencies) against a Neutralino stub backed by the real filesystem, and a
 * live loopback gatekeeper stand-in:
 *   1. Only a stale handshake exists (dead port). Boot probe: AI unavailable.
 *   2. The live gatekeeper writes its keyed handshake files.
 *   3. A rescan (detect) must re-read the files and report AI available.
 *
 * Usage: node tests/test_agents_bridge.cjs
 * Prints "✅ N passed  ❌ M failed" and exits non-zero on any failure.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');

const SRC = path.resolve(__dirname, '..', 'vela-neutralino', 'resources', 'js');

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, () => resolve(server.address().port)));
}

async function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-agents-bridge-'));
  const home = path.join(work, 'home');
  const vela = path.join(home, '.vela');
  fs.mkdirSync(vela, { recursive: true });

  // Copy the bridge and its ESM dependencies into a module-typed directory so
  // Node loads them as ES modules without touching the repo tree.
  const jsDir = path.join(work, 'js');
  fs.mkdirSync(jsDir);
  for (const f of ['agents-bridge.js', 'fs-guard.js', 'config-store.js']) {
    fs.copyFileSync(path.join(SRC, f), path.join(jsDir, f));
  }
  fs.writeFileSync(path.join(jsDir, 'package.json'), '{"type":"module"}');

  const fsp = fs.promises;
  globalThis.Neutralino = {
    os: { getEnv: async (k) => (k === 'HOME' ? home : undefined) },
    filesystem: {
      readFile: (p) => fsp.readFile(p, 'utf8'),
      getStats: (p) => fsp.stat(p),
      createDirectory: (p) => fsp.mkdir(p, { recursive: true }),
      writeFile: (p, d) => fsp.writeFile(p, d),
      move: (a, b) => fsp.rename(a, b),
      remove: (p) => fsp.unlink(p),
    },
  };
  // NL_PORT keys the handshake files for this window (see readHandshake).
  globalThis.window = { NL_PORT: 4242 };

  // Live gatekeeper stand-in: answers /detect only with the right token.
  const TOKEN = 'live-token-for-test';
  const server = http.createServer((req, res) => {
    if (req.headers['x-vela-token'] !== TOKEN) { res.writeHead(401); return res.end('{}'); }
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        providers: { 'claude-code': { id: 'claude-code', label: 'Claude Code', available: true, version: '1.0.0' } },
      }));
    });
  });
  const livePort = await listen(server);

  // A port nothing listens on: the stale gatekeeper from an earlier build.
  const dead = http.createServer();
  const deadPort = await listen(dead);
  await new Promise((r) => dead.close(r));

  const { agents } = await import(pathToFileURL(path.join(jsDir, 'agents-bridge.js')).href);

  try {
    console.log('CR19: AI handshake after a new build');

    // Step 1: only a stale handshake exists (unkeyed files, dead port).
    fs.writeFileSync(path.join(vela, 'agent-ext.port'), String(deadPort));
    fs.writeFileSync(path.join(vela, 'agent-ext.token'), 'stale-token');
    await agents.detect();
    check('stale handshake: boot probe reports AI unavailable', !agents.available());

    // Step 2: the live gatekeeper for this window writes its keyed files.
    fs.writeFileSync(path.join(vela, 'agent-ext-4242.port'), String(livePort));
    fs.writeFileSync(path.join(vela, 'agent-ext-4242.token'), TOKEN);

    // Step 3: rescan. It must not reuse the stale handshake.
    await agents.detect();
    check('rescan re-reads handshake and reports AI available', agents.available());
    check('rescan selects the detected provider', agents.activeId() === 'claude-code',
      `activeId=${agents.activeId()}`);
    check('info() lists the provider after rescan',
      agents.info().providers.some((p) => p.id === 'claude-code'));
  } finally {
    server.close();
    fs.rmSync(work, { recursive: true, force: true });
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ✅ ${passed} passed  ❌ ${failed} failed`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
