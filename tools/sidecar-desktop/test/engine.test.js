'use strict';
// The engine choice (src/sidecar-engine.js) and the session's Kotlin -> Node
// fallback (src/sidecar-session.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DEFAULT_ENGINE, PACKAGED_NATIVE, nativeBinaryPath, nativeTarget, resolveEngine, sidecarArgs, engineEnv, cleanEngine,
} = require('../src/sidecar-engine');
const { SidecarSession } = require('../src/sidecar-session');
const { Settings } = require('../src/settings');

const yes = () => true;
const no = () => false;

test('engine: the native binary is Linux x64 only', () => {
  assert.equal(nativeTarget('linux', 'x64'), 'linux-x64');
  assert.equal(nativeTarget('win32', 'x64'), null);
  assert.equal(nativeTarget('linux', 'arm64'), null);
  assert.equal(nativeTarget('darwin', 'arm64'), null);
});

test('engine: where the native binary is, packaged and in a checkout', () => {
  const appDir = path.join('/repo', 'tools', 'sidecar-desktop');
  assert.equal(nativeBinaryPath({ packaged: true, resourcesPath: '/opt/app/resources', appDir, platform: 'linux', arch: 'x64', env: {} }),
    path.join('/opt/app/resources', PACKAGED_NATIVE));
  assert.equal(nativeBinaryPath({ packaged: false, appDir, platform: 'linux', arch: 'x64', env: {} }),
    path.join('/repo', 'tools', 'sidecar-android', 'core', 'build', 'bin', 'linuxX64', 'sidecarReleaseExecutable', 'sidecar.kexe'));
  assert.equal(nativeBinaryPath({ packaged: true, resourcesPath: 'C:\\app\\resources', appDir, platform: 'win32', arch: 'x64', env: {} }), null);
  assert.equal(nativeBinaryPath({ packaged: false, appDir, platform: 'win32', arch: 'x64', env: { SIDECAR_DESKTOP_NATIVE: '/x/sidecar' } }), '/x/sidecar');
});

test('engine: kotlin by default, Node where there is no binary, and Node when chosen', () => {
  assert.equal(DEFAULT_ENGINE, 'kotlin');
  const base = { nativePath: '/n/sidecar', nodeScript: '/s/sidecar.mjs', execPath: '/e/electron', platform: 'linux' };
  const k = resolveEngine({ ...base, executable: yes });
  assert.equal(k.engine, 'kotlin');
  assert.equal(k.command, '/n/sidecar');
  assert.deepEqual(k.prefix, []);
  assert.equal(k.reason, null);
  assert.deepEqual(k.fallback, { engine: 'node', command: '/e/electron', prefix: ['/s/sidecar.mjs'], reason: null, fallback: null });
  assert.equal(resolveEngine({ ...base, setting: undefined, executable: yes }).engine, 'kotlin');
  assert.equal(resolveEngine({ ...base, setting: 'nonsense', executable: yes }).engine, 'kotlin');

  const n = resolveEngine({ ...base, setting: 'node', executable: yes });
  assert.equal(n.engine, 'node');
  assert.equal(n.reason, null);
  assert.equal(n.fallback, null);

  const missing = resolveEngine({ ...base, executable: no });
  assert.equal(missing.engine, 'node');
  assert.match(missing.reason, /not at \/n\/sidecar/);
  const win = resolveEngine({ ...base, nativePath: null, platform: 'win32', executable: yes });
  assert.equal(win.engine, 'node');
  assert.match(win.reason, /no native sidecar is built for win32/);
  assert.deepEqual(win.prefix, ['/s/sidecar.mjs']);
});

test('engine: the arguments both engines take', () => {
  const a = sidecarArgs({ host: '192.0.2.1', port: 14567, name: 'skandia', team: 2, wsPort: 17942,
    recording: '/r/a.ndjson', review: '/r/a.review.ndjson', extraArgs: ['--allow-origin', 'http://localhost:5273'] });
  assert.deepEqual(a, ['192.0.2.1:14567', '--name', 'skandia', '--team', '2', '--ws', '17942', '--out', '/r/a.ndjson',
    '--review', '/r/a.review.ndjson', '--leave-on-stdin', '--allow-origin', 'http://localhost:5273']);
  const p = sidecarArgs({ host: 'h', port: 1, name: 'n', team: 0, wsPort: 2, recording: 'o', review: 'r', nameFromPage: true });
  assert.deepEqual(p.slice(-2), ['--leave-on-stdin', '--name-from-page']);
});

test('engine: the environment', () => {
  const env = { A: '1', ELECTRON_RUN_AS_NODE: '1' };
  assert.equal(engineEnv('node', { env: {} }).ELECTRON_RUN_AS_NODE, '1');
  assert.equal('ELECTRON_RUN_AS_NODE' in engineEnv('kotlin', { env }), false);
  assert.equal(engineEnv('kotlin', { env, gameDir: '/g' }).BF1942_DIR, '/g');
  assert.equal(engineEnv('kotlin', { env }).A, '1');
  assert.equal('BF1942_DIR' in engineEnv('node', { env: {} }), false);
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1');   // not changed in place
});

test('settings: the engine', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-engine-settings-'));
  const s = new Settings(dir);
  assert.equal(s.get('engine'), 'kotlin');
  assert.deepEqual(s.update({ engine: 'node' }), {});
  assert.equal(new Settings(dir).get('engine'), 'node');
  assert.ok(s.update({ engine: 'python' }).engine);
  assert.equal(s.get('engine'), 'node');
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ engine: 42 }));
  assert.equal(new Settings(dir).get('engine'), 'kotlin');
  assert.equal(cleanEngine('kotlin'), 'kotlin');
  assert.equal(cleanEngine('KOTLIN'), null);
});

// ---- the session's fallback ----

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-engine-'));
  // A stand-in Node sidecar: says its arguments and whether it runs as Node, then exits 0.
  const script = path.join(dir, 'echo.js');
  fs.writeFileSync(script, 'console.log("[sidecar] player name: " + JSON.stringify({ args: process.argv.slice(2), node: process.env.ELECTRON_RUN_AS_NODE ?? null }) + " (fallback)");');
  const node = { engine: 'node', command: process.execPath, prefix: [script], reason: null, fallback: null };
  const base = { host: '192.0.2.7', port: 14600, name: 'skandia-sc', team: 1, wsPort: 17999, dataDir: dir, nameFromPage: true };
  return { dir, node, base };
}

function sh(dir, name, body) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return p;
}

async function run(opts) {
  const lines = [];
  const s = new SidecarSession({ ...opts, log: (l) => lines.push(l) });
  const fell = [];
  s.on('fallback', (f) => fell.push(f));
  s.start();
  const code = await s.exited;
  return { s, code, lines, fell, said: s.view().playerName?.startsWith('{') ? JSON.parse(s.view().playerName) : null };
}

test('session: a missing native binary falls back to Node, same arguments', async () => {
  const { dir, node, base } = fixture();
  const r = await run({ ...base, engine: { engine: 'kotlin', command: path.join(dir, 'no-such-sidecar'), prefix: [], reason: null, fallback: node } });
  assert.equal(r.code, 0);
  assert.equal(r.s.view().engine, 'node');
  assert.match(r.s.view().fallbackReason, /the kotlin sidecar it failed to start \(.*ENOENT/);
  assert.equal(r.fell.length, 1);
  assert.ok(r.lines.some((l) => /falling back to the node sidecar/.test(l)));
  assert.deepEqual(r.said.args.slice(0, 7), ['192.0.2.7:14600', '--name', 'skandia-sc', '--team', '1', '--ws', '17999']);
  assert.ok(r.said.args.includes('--leave-on-stdin'));
  assert.ok(r.said.args.includes('--name-from-page'));
  assert.equal(r.said.node, '1');
  assert.equal(r.s.view().state, 'idle');
});

test('session: a native binary that dies before a [sidecar] line falls back', { skip: process.platform === 'win32' }, async () => {
  const { dir, node, base } = fixture();
  const bad = sh(dir, 'bad-sidecar', 'echo "error while loading shared libraries: libcurl.so.4" >&2; exit 127');
  const r = await run({ ...base, engine: { engine: 'kotlin', command: bad, prefix: [], reason: null, fallback: node } });
  assert.equal(r.code, 0);
  assert.equal(r.s.view().engine, 'node');
  assert.match(r.s.view().fallbackReason, /exited with code 127 before saying anything/);
});

test('session: a native sidecar that started is not replaced when it fails', { skip: process.platform === 'win32' }, async () => {
  const { dir, node, base } = fixture();
  const k = sh(dir, 'started-sidecar', 'echo "[sidecar] denied: server full"; exit 2');
  const r = await run({ ...base, engine: { engine: 'kotlin', command: k, prefix: [], reason: null, fallback: node } });
  assert.equal(r.code, 2);
  assert.equal(r.fell.length, 0);
  assert.equal(r.s.view().engine, 'kotlin');
  assert.equal(r.s.view().state, 'denied');
});

test('session: the native sidecar runs with the arguments, without ELECTRON_RUN_AS_NODE', { skip: process.platform === 'win32' }, async () => {
  const { dir, node, base } = fixture();
  const k = sh(dir, 'ok-sidecar', 'echo "[sidecar] player name: $* :${ELECTRON_RUN_AS_NODE:-unset}:${BF1942_DIR} (given)"');
  const r = await run({ ...base, gameDir: '/games/bf1942', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    engine: { engine: 'kotlin', command: k, prefix: [], reason: null, fallback: node } });
  assert.equal(r.code, 0);
  assert.equal(r.fell.length, 0);
  const said = r.s.view().playerName;
  assert.match(said, /^192\.0\.2\.7:14600 --name skandia-sc --team 1 --ws 17999 --out \S+\.ndjson --review \S+\.review\.ndjson --leave-on-stdin --name-from-page :unset:\/games\/bf1942$/);
});

test('session: a leave during the native sidecar is not a failed start', { skip: process.platform === 'win32' }, async () => {
  const { dir, node, base } = fixture();
  // Silent until stdin says leave (SIGINT ignored), then exits 0 without a [sidecar] line.
  const k = sh(dir, 'quiet-sidecar', 'trap "" INT; read line; exit 0');
  const s = new SidecarSession({ ...base, engine: { engine: 'kotlin', command: k, prefix: [], reason: null, fallback: node } });
  const fell = [];
  s.on('fallback', (f) => fell.push(f));
  s.start();
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(await s.stop(), 0);
  assert.equal(fell.length, 0);
  assert.equal(s.view().state, 'idle');
});

test('status: the native sidecar\'s port-in-use line reads as Node\'s does', () => {
  const { parseLine } = require('../src/sidecar-status');
  // SidecarCli.kt prints this one line; Node's uncaught error carries the same words.
  assert.deepEqual(parseLine('[sidecar] listen EADDRINUSE: address already in use 127.0.0.1:17942'),
    { state: 'failed', detail: 'Port 17942 is in use (another sidecar running?)' });
  assert.deepEqual(parseLine('Error: listen EADDRINUSE: address already in use 127.0.0.1:17942'),
    { state: 'failed', detail: 'Port 17942 is in use (another sidecar running?)' });
});
