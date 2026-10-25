'use strict';
// What the app and the sidecar do differently on Windows, checked on every
// platform (features/sidecar-desktop-app, "Windows").

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SIDECAR = path.resolve(__dirname, '..', '..', 'bf1942-models', 'sidecar');
const sidecarModule = (name) => import(pathToFileURL(path.join(SIDECAR, name)).href);

const { parseRegQuery, registryGameDir, findGameDir, defaultGameDirs, regExe } = require('../src/game-install');
const { sidecarEnv } = require('../src/sidecar-session');
const { strayImports } = require('../scripts/after-pack');

test('the sidecar keeps its cache and CD keys in the Windows folders', async () => {
  const P = await sidecarModule('paths.mjs');
  const env = { LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local', APPDATA: 'C:\\Users\\a\\AppData\\Roaming' };
  assert.equal(P.cacheDir({ env, platform: 'win32', home: 'C:\\Users\\a' }), 'C:\\Users\\a\\AppData\\Local\\bfstats-sidecar\\cache');
  assert.equal(P.configDir({ env, platform: 'win32', home: 'C:\\Users\\a' }), 'C:\\Users\\a\\AppData\\Roaming\\bfstats-sidecar');
  assert.equal(P.cacheDir({ env: {}, platform: 'win32', home: 'C:\\Users\\a' }), 'C:\\Users\\a\\AppData\\Local\\bfstats-sidecar\\cache');
  assert.equal(P.cacheDir({ env: { SIDECAR_CACHE: 'X:\\c' }, platform: 'win32' }), 'X:\\c');
  // Linux is as it was.
  assert.equal(P.cacheDir({ env: {}, platform: 'linux', home: '/h' }), path.join('/h', '.cache', 'bfstats-sidecar'));
  assert.equal(P.configDir({ env: {}, platform: 'linux', home: '/h' }), path.join('/h', '.config', 'bfstats-sidecar'));
});

test("the sidecar's game folder on Windows: BF1942_DIR, else the first default that exists", async () => {
  const P = await sidecarModule('paths.mjs');
  const env = { 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramFiles: 'C:\\Program Files' };
  const dirs = P.defaultGameDirs({ env, platform: 'win32' });
  assert.equal(dirs[0], 'C:\\Program Files (x86)\\EA Games\\Battlefield 1942');
  assert.ok(dirs.includes('C:\\Program Files (x86)\\Origin Games\\Battlefield 1942'));
  assert.equal(P.gameDir({ env, platform: 'win32', exists: (d) => d.includes('Origin') }), 'C:\\Program Files (x86)\\Origin Games\\Battlefield 1942');
  assert.equal(P.gameDir({ env, platform: 'win32', exists: () => false }), dirs[0]);
  assert.equal(P.gameDir({ env: { BF1942_DIR: 'D:\\BF' }, platform: 'win32' }), 'D:\\BF');
  assert.equal(P.pythonCommand({ env: {}, platform: 'win32' }), 'python');
  assert.equal(P.pythonCommand({ env: {}, platform: 'linux' }), 'python3');
});

test('no Python: the Store alias and a missing command are both a quick no', async () => {
  const P = await sidecarModule('paths.mjs');
  P.resetPythonProbe();
  // Windows' "python" without Python: the App Execution Alias prints a hint and exits 9009.
  const storeAlias = () => ({ status: 9009, stdout: '', stderr: 'Python was not found; run without arguments to install from the Microsoft Store' });
  assert.deepEqual(P.pythonAvailable('python', { run: storeAlias }), { ok: false, python: 'python', why: 'exit 9009' });
  P.resetPythonProbe();
  const enoent = () => ({ error: Object.assign(new Error('spawn x ENOENT'), { code: 'ENOENT' }), status: null, stdout: '' });
  assert.equal(P.pythonAvailable('python', { run: enoent }).why, 'ENOENT');
  P.resetPythonProbe();
  assert.equal(P.pythonAvailable('python', { run: () => ({ status: 0, stdout: '2\n' }) }).ok, false, 'Python 2 is not enough');
  P.resetPythonProbe();
  let runs = 0;
  const py3 = () => { runs++; return { status: 0, stdout: '3\r\n' }; };
  assert.equal(P.pythonAvailable('python', { run: py3 }).ok, true);
  assert.equal(P.pythonAvailable('python', { run: py3 }).ok, true);
  assert.equal(runs, 1, 'asked once per process');
  P.resetPythonProbe();
  // A real missing command, end to end.
  const t = Date.now();
  assert.equal(P.pythonAvailable(path.join(os.tmpdir(), 'no-such-python-here')).ok, false);
  assert.ok(Date.now() - t < 5000);
  P.resetPythonProbe();
});

test('an install with the mod computes its tables only with the helpers and a Python 3', async () => {
  const L = await sidecarModule('level-tables.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-install-'));
  fs.mkdirSync(path.join(dir, 'Mods', 'BF1942'), { recursive: true });
  const helper = path.join(dir, 'helper.py');
  fs.writeFileSync(helper, '');
  const yes = () => ({ ok: true });
  const no = () => ({ ok: false, python: 'python', why: 'exit 9009' });
  assert.equal(L.installCanCompute('bf1942', { dir, helpers: [helper], python: yes }), true);
  assert.equal(L.installCanCompute('BF1942', { dir, helpers: [helper], python: no }), false);
  assert.equal(L.installCanCompute('bf1942', { dir, helpers: [path.join(dir, 'gone.py')], python: yes }), false);
  assert.equal(L.installCanCompute('xpack1', { dir, helpers: [helper], python: yes }), false);
});

test("the table version: CRLF hashes as LF, and a bundle without the Python files reads the build's", async () => {
  const T = await sidecarModule('template-table.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-version-'));
  const lf = path.join(dir, 'a.py');
  const crlf = path.join(dir, 'b.py');
  fs.writeFileSync(lf, 'x = 1\ny = 2\n');
  fs.writeFileSync(crlf, 'x = 1\r\ny = 2\r\n');
  assert.equal(T.tableVersion([lf], path.join(dir, 'none.txt')), T.tableVersion([crlf], path.join(dir, 'none.txt')));
  const file = path.join(dir, 'table-version.txt');
  fs.writeFileSync(file, 'abcdef012345\n');
  assert.equal(T.tableVersion([path.join(dir, 'missing.py')], file), 'abcdef012345');
  // With every input there, the file is not read.
  assert.notEqual(T.tableVersion([lf], file), 'abcdef012345');
  // The repo's own version is computed from its files.
  assert.match(T.TEMPLATE_TABLE_VERSION, /^[0-9a-f]{12}$/);
});

test('the bundled sidecar imports nothing outside its folder', () => {
  assert.deepEqual(strayImports(SIDECAR), []);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-bundle-'));
  fs.writeFileSync(path.join(dir, 'a.mjs'), "import { x } from '../outside.mjs';\nimport './gone.mjs';\nconst y = import('./a.mjs');\n");
  assert.deepEqual(strayImports(dir), ['a.mjs imports ../outside.mjs (outside the bundle)', 'a.mjs imports ./gone.mjs (not in the bundle)']);
});

test('the registry: GAMEDIR, else Install Dir; reg.exe by its full path', async () => {
  assert.equal(parseRegQuery('    Install Dir    REG_SZ    C:\\Program Files (x86)\\Origin Games\\Battlefield 1942\\\r\n'),
    'C:\\Program Files (x86)\\Origin Games\\Battlefield 1942');
  assert.equal(parseRegQuery('    Install Dir    REG_SZ    D:\\X\r\n    GAMEDIR    REG_SZ    E:\\BF42\r\n'), 'E:\\BF42');
  assert.equal(regExe({ SystemRoot: 'C:\\WINDOWS' }), 'C:\\WINDOWS\\System32\\reg.exe');
  const cmds = [];
  const run = (cmd, a, _o, cb) => { cmds.push([cmd, ...a]); cb(new Error('not found'), ''); };
  assert.equal(await registryGameDir({ platform: 'win32', run }), null);
  assert.equal(cmds.length, 3);
  assert.ok(cmds.every(([cmd, q]) => /reg\.exe$/i.test(cmd) && q === 'query'));
  assert.ok(defaultGameDirs({ platform: 'win32', env: {} }).includes('C:\\Program Files (x86)\\Origin Games\\Battlefield 1942'));
});

test("the sidecar is handed the game folder, Settings or not", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-gamedir-'));
  const game = path.join(home, '.wine', 'drive_c', 'EA Games', 'Battlefield 1942');
  fs.mkdirSync(path.join(game, 'Mods', 'BF1942', 'Archives'), { recursive: true });   // never started: no Settings
  assert.equal(await findGameDir({ platform: 'linux', home, env: {} }), game);
  assert.equal(await findGameDir({ platform: 'linux', home: path.join(home, 'none'), env: {} }), null);
  assert.equal(await findGameDir({ override: game, platform: 'linux', home: path.join(home, 'none'), env: {} }), game);
  assert.equal(sidecarEnv({ gameDir: game, env: { A: '1' } }).BF1942_DIR, game);
  assert.equal(sidecarEnv({ gameDir: game, env: {} }).ELECTRON_RUN_AS_NODE, '1');
  assert.equal('BF1942_DIR' in sidecarEnv({ gameDir: null, env: {} }), false);
});
