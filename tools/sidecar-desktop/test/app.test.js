'use strict';
// node --test test/  (no Electron needed: these are the app's pure parts)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseAddress, parseJoinLink, linkFromArgv, cleanName } = require('../src/address');
const { parseLine, describe, sessionLines, trayIconState, gameTypeTitle } = require('../src/sidecar-status');
const { normalise, sortServers, serverLabel, decodeName } = require('../src/servers');
const { buildModel, toTemplate, toPlain, findById } = require('../src/menu-model');
const { Settings, cleanViewerBase } = require('../src/settings');
const { RotatingLog } = require('../src/logger');
const { desktopEntry, quoteExecArg } = require('../src/linux-integration');
const { trayVisibility } = require('../src/tray-support');
const { trayAnchoredPosition, cornerPosition, clampToArea, trayEdge, fitSize } = require('../src/panel-position');
const { mapImageUrl, mapSlug } = require('../src/map-image');
const { panelState } = require('../src/panel-state');

test('addresses: host and port, strictly', () => {
  assert.deepEqual(parseAddress('127.0.0.1:14568'), { host: '127.0.0.1', port: 14568 });
  assert.deepEqual(parseAddress(' 51.81.48.224 '), { host: '51.81.48.224', port: 14567 });
  assert.deepEqual(parseAddress('Play.Example.com:1'), { host: 'play.example.com', port: 1 });
  for (const bad of ['', ':14567', '1.2.3.4:0', '1.2.3.4:65536', '1.2.3.4:abc', '256.1.1.1:1', '999.1.1.1',
    'a b:1', '-x.com:1', 'x-.com:1', 'host:1:2', 'http://1.2.3.4:1', '1.2.3.4:1/x', '--name', '$(id):1', 'a;b:1',
    '[::1]:1', 'x'.repeat(300)]) {
    assert.equal(parseAddress(bad), null, bad);
  }
});

test('join links: the one shape, nothing else', () => {
  assert.deepEqual(parseJoinLink('bfstats-sidecar://join/127.0.0.1:14568'), { action: 'join', host: '127.0.0.1', port: 14568 });
  assert.deepEqual(parseJoinLink('bfstats-sidecar://join/1.2.3.4:14567/'), { action: 'join', host: '1.2.3.4', port: 14567 });
  assert.deepEqual(parseJoinLink('BFSTATS-SIDECAR://JOIN/1.2.3.4:14567'), { action: 'join', host: '1.2.3.4', port: 14567 });
  assert.deepEqual(parseJoinLink('bfstats-sidecar://join/1.2.3.4:14567?name=Big%20Ben'), { action: 'join', host: '1.2.3.4', port: 14567, name: 'Big Ben' });
  for (const bad of [
    'bfstats-sidecar://leave/1.2.3.4:14567',
    'bfstats-sidecar://join/1.2.3.4:14567/more',
    'bfstats-sidecar://join:80/1.2.3.4:14567',
    'bfstats-sidecar://user@join/1.2.3.4:14567',
    'bfstats-sidecar://join/',
    'bfstats-sidecar://join/1.2.3.4:99999',
    'bfstats-sidecar://join/1.2.3.4:14567?name=',
    'bfstats-sidecar://join/1.2.3.4:14567?name=%22quoted%22',
    'bfstats-sidecar://join/1.2.3.4:14567?name=' + 'x'.repeat(33),
    'bfstats-sidecar://join/--inspect=0.0.0.0:9229',
    'bfstats-sidecar://join/%2D%2Dinspect:1',
    'bf1942://1.2.3.4:14567',
    'https://join/1.2.3.4:14567',
    'not a url',
  ]) {
    assert.equal(parseJoinLink(bad), null, bad);
  }
  assert.equal(linkFromArgv(['/usr/bin/electron', '.', 'bfstats-sidecar://join/1.2.3.4:1']), 'bfstats-sidecar://join/1.2.3.4:1');
  assert.equal(linkFromArgv(['/usr/bin/electron', '.']), null);
  assert.equal(cleanName('ok_Name-1 [x]'), 'ok_Name-1 [x]');
  assert.equal(cleanName('café'), null);
});

test("the sidecar's console lines drive the status", () => {
  assert.deepEqual(parseLine('[sidecar] live feed: http://127.0.0.1:17943/  (ws on the same port)'), { state: 'listening', wsPort: 17943 });
  assert.deepEqual(parseLine('[sidecar] connected id=3'), { state: 'connecting' });
  assert.deepEqual(parseLine('[sidecar] joined as player 4 team 2: 9 players, 120 objects'), { state: 'joined', playerId: 4, team: 2, joinedPlayers: 9 });
  assert.deepEqual(parseLine('[sidecar] server name: MoonGamers.com | Est. 2004'), { reportedName: 'MoonGamers.com | Est. 2004' });
  assert.deepEqual(parseLine('[sidecar] the server plays market garden conquest (mod bf1942, from its gamespy): tables from cache in 3 ms'), { mapName: 'market garden', gameType: 'conquest', mod: 'bf1942' });
  assert.deepEqual(parseLine("[sidecar] loading bf1942/levels/wake/ coop.con (mod bf1942): the world dump waits for the level's tables"), { mapName: 'wake', gameType: 'coop', mod: 'bf1942' });
  assert.equal(parseLine('[sidecar] denied: serverFull').state, 'denied');
  assert.equal(parseLine('[sidecar] not rejoining: kicked -- You were kicked').state, 'ended');
  assert.equal(parseLine('[sidecar] no answer from 1.2.3.4:1 after 10 s: is the server running? (still trying)').state, 'unreachable');
  assert.equal(parseLine('[sidecar] rejoining (attempt 2, team 1)').state, 'rejoining');
  assert.equal(parseLine('[sidecar] back on after 12.0 s, 1 attempt(s)').state, 'joined');
  assert.equal(parseLine('[sidecar] leaving').state, 'leaving');
  assert.equal(parseLine('Error: listen EADDRINUSE: address already in use 127.0.0.1:17942').state, 'failed');
  assert.equal(parseLine('[sidecar] page connected (1 open): snapshot of 3 rows').pageConnected, true);
  assert.equal(parseLine('[sidecar] page socket closed (0 open)').pageConnected, false);
  assert.equal(parseLine('[sidecar] stats: {}'), null);
  assert.equal(describe(null), 'Idle');
  assert.equal(describe({ state: 'joined', address: '1.2.3.4:1', serverName: 'Lab', mapName: 'wake' }), 'In game on Lab (1.2.3.4:1) - Wake');
  assert.equal(describe({ state: 'joined', address: '1.2.3.4:1', reportedName: 'Ïðèâåò' }), 'In game on Привет (1.2.3.4:1)');
  assert.equal(describe({ state: 'connecting', address: '1.2.3.4:1' }), 'Joining 1.2.3.4:1');
});

test('the sidecar script still prints what the status reads', () => {
  // The patterns above are only worth anything while sidecar.mjs says these.
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'bf1942-models', 'sidecar', 'sidecar.mjs'), 'utf8');
  for (const s of ['[sidecar] live feed: http://127.0.0.1:', '[sidecar] connected id=', '[sidecar] joined as player ',
    "'[sidecar] denied:'", '[sidecar] not rejoining: ', '[sidecar] no answer from ', '[sidecar] rejoining (attempt ',
    '[sidecar] back on after ', '[sidecar] leaving', '[sidecar] page connected (', '[sidecar] page socket closed (',
    '[sidecar] server name: ', '[sidecar] the server plays ', '[sidecar] loading ']) {
    assert.ok(src.includes(s), `sidecar.mjs no longer prints ${s}`);
  }
});

test('servers: populated first, anticheat marked, Cyrillic names decoded', () => {
  const list = sortServers(normalise({ servers: [
    { name: 'B empty', ip: '1.1.1.2', port: 14567, numPlayers: 0, maxPlayers: 32 },
    { name: 'A busy', ip: '1.1.1.1', port: 14567, numPlayers: 20, maxPlayers: 64, mapName: 'kharkov', anticheat: true },
    { name: 'no address' },
    { name: 'C some', ip: '1.1.1.3', port: 14568, numPlayers: 3, maxPlayers: 32 },
  ] }));
  assert.deepEqual(list.map((s) => s.name), ['A busy', 'C some', 'B empty']);
  assert.equal(serverLabel(list[0]), '20/64  A busy - kharkov  [AC]');
  // "Привет" as cp1251 bytes read as cp1252.
  assert.equal(decodeName('Ïðèâåò'), 'Привет');
  assert.equal(decodeName('Plain name'), 'Plain name');
});

test('the menu model: the brief, Open panel, Quit', () => {
  const calls = [];
  const actions = new Proxy({}, { get: (_t, k) => (...a) => calls.push([k, ...a]) });
  const ctx = {
    session: { state: 'joined', address: '1.1.1.1:14567', serverName: 'A & B', mapName: 'wake', pageConnected: true },
    servers: [],
    settings: { recent: [{ address: '9.9.9.9:14567', name: 'Old' }] },
    startAtLogin: true,
    actions,
  };
  const model = buildModel(ctx);
  const ids = model.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  // The brief first, then the panel, then Quit; nothing else (it is all in the panel).
  assert.deepEqual(model.filter((i) => i.type !== 'separator').map((i) => i.id), ['status', 'status-0', 'status-1', 'open-panel', 'quit']);
  assert.deepEqual(model.slice(0, 3).map((i) => i.label), ['In game', 'A && B (1.1.1.1:14567)', 'Wake']);
  assert.ok(model.slice(0, 3).every((i) => i.enabled === false), 'the brief is read-only');
  findById(model, 'open-panel').click();
  assert.deepEqual(calls.at(-1), ['openPanel']);
  const tpl = toTemplate(model);
  assert.equal(typeof tpl.find((t) => t.id === 'quit').click, 'function');
  const plain = toPlain(model);
  assert.equal(JSON.stringify(plain).includes('function'), false);
  // Idle: one line, then the panel and Quit.
  const idle = buildModel({ ...ctx, session: null });
  assert.deepEqual(idle.filter((i) => i.type !== 'separator').map((i) => i.label), ['Not on a server', 'Open panel', 'Quit']);
  // No tray: no Open panel item (the panel is the window).
  const trayless = buildModel({ ...ctx, actions: { quit: () => {}, openPanel: null } });
  assert.equal(findById(trayless, 'open-panel'), null);
});

test('the session header and the tray dot', () => {
  const s = { state: 'joined', address: '1.1.1.1:14567', serverName: 'Moon', mapName: 'el_alamein', gameType: 'conquest', players: 19, maxPlayers: 64 };
  assert.deepEqual(sessionLines(s), { title: 'In game', lines: ['Moon (1.1.1.1:14567)', 'El Alamein, Conquest - 19/64 players'] });
  assert.deepEqual(sessionLines({ state: 'connecting', address: '1.1.1.1:14567', joinedPlayers: 3 }).lines, ['1.1.1.1:14567', '3 players at join']);
  assert.equal(sessionLines({ state: 'denied', detail: 'Denied: serverFull' }).title, 'Last session ended: Denied: serverFull');
  assert.equal(trayIconState(null), null);
  assert.equal(trayIconState({ state: 'joined' }), 'joined');
  for (const st of ['starting', 'listening', 'connecting', 'unreachable', 'rejoining', 'leaving']) assert.equal(trayIconState({ state: st }), 'joining', st);
  for (const st of ['idle', 'failed', 'ended', 'denied']) assert.equal(trayIconState({ state: st }), null, st);
  for (const f of ['tray-joined.png', 'tray-joined@2x.png', 'tray-joining.png', 'tray-joining@2x.png']) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets', f)), f);
  }
});

test('settings: validated, persisted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-settings-'));
  const s = new Settings(dir);
  assert.deepEqual(s.update({ playerName: 'Tester', team: 2, viewerBase: 'http://localhost:5273', wsPort: 18000 }), {});
  const errs = s.update({ playerName: 'x"y', viewerBase: 'javascript:alert(1)', wsPort: 80 });
  assert.deepEqual(Object.keys(errs).sort(), ['playerName', 'viewerBase', 'wsPort']);
  s.addRecent('1.2.3.4:1', 'One'); s.addRecent('5.6.7.8:1', null); s.addRecent('1.2.3.4:1', 'One');
  const again = new Settings(dir);
  assert.equal(again.get('playerName'), 'Tester');
  assert.equal(again.get('team'), 2);
  assert.equal(again.get('viewerBase'), 'http://localhost:5273/');
  assert.deepEqual(again.get('recent').map((r) => r.address), ['1.2.3.4:1', '5.6.7.8:1']);
  assert.equal(cleanViewerBase('https://mesh.bfstats.io/map.html?x=1'), 'https://mesh.bfstats.io/');
  assert.equal(cleanViewerBase('file:///etc/'), null);
});

test('the log rotates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-log-'));
  const log = new RotatingLog(dir, 'x', { maxBytes: 200, keep: 2, tail: 5 });
  for (let i = 0; i < 20; i++) log.write(`line ${i} ${'.'.repeat(20)}`);
  const files = fs.readdirSync(dir).sort();
  assert.deepEqual(files, ['x.1.log', 'x.2.log', 'x.log']);
  assert.equal(log.lines.length, 5);
  assert.match(log.lines.at(-1), /line 19/);
});

test('desktop entries', () => {
  const e = desktopEntry({ exec: ['/opt/My App/app', '/x'], icon: '/i.png' });
  assert.match(e, /^Exec="\/opt\/My App\/app" \/x %u$/m);
  assert.match(e, /^MimeType=x-scheme-handler\/bfstats-sidecar;$/m);
  assert.equal(quoteExecArg('a"b'), '"a\\"b"');
  assert.doesNotMatch(desktopEntry({ exec: ['/a'], withUrl: false }), /MimeType|%u/);
});

test('tray visibility', async () => {
  assert.equal((await trayVisibility({ platform: 'win32' })).visible, true);
  assert.equal((await trayVisibility({ platform: 'linux', owner: async () => true })).visible, true);
  const gnome = await trayVisibility({ platform: 'linux', env: { XDG_CURRENT_DESKTOP: 'GNOME' }, owner: async () => false });
  assert.deepEqual([gnome.visible, gnome.reason], [false, 'gnome-no-appindicator']);
  assert.equal((await trayVisibility({ platform: 'linux', owner: async () => null })).visible, null);
});

// ---- the player name (features/game-profiles) ------------------------------

const { defaultGameDirs, parseRegQuery, registryGameDir, findInstall, listProfiles, playerNameOf } = require('../src/game-install');
const { cleanProfileName } = require('../src/address');
const { SidecarSession } = require('../src/sidecar-session');

test("the sidecar's player name line, and the header's Playing as", () => {
  assert.deepEqual(parseLine('[sidecar] player name: skandia (from the page)'), { playerName: 'skandia', playerNameFrom: 'page' });
  assert.deepEqual(parseLine('[sidecar] player name: BrowserSoldier (fallback)'), { playerName: 'BrowserSoldier', playerNameFrom: 'fallback' });
  assert.deepEqual(parseLine('[sidecar] player name: A (b) (fallback)'), { playerName: 'A (b)', playerNameFrom: 'fallback' });
  assert.equal(parseLine('[sidecar] player name: x'), null);
  const s = { state: 'joined', address: '1.1.1.1:14567', serverName: 'Moon', mapName: 'wake' };
  assert.deepEqual(sessionLines({ ...s, playerName: 'skandia' }).lines, ['Moon (1.1.1.1:14567)', 'Wake', 'Playing as skandia']);
  assert.deepEqual(sessionLines({ ...s, state: 'listening', nameFromPage: true }).lines,
    ['Moon (1.1.1.1:14567)', 'Wake', "Playing as: waiting for the viewer's profile"]);
  // The line it reads is still the one the sidecar prints.
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'bf1942-models', 'sidecar', 'sidecar.mjs'), 'utf8');
  assert.ok(src.includes('[sidecar] player name: ${name} (${who.from})'));
  assert.ok(src.includes("from: 'from the page'") && src.includes("from: 'fallback'"));
});

test('profile names: what the sidecar can send', () => {
  assert.equal(cleanProfileName('skandia'), 'skandia');
  assert.equal(cleanProfileName(' café '), 'café');
  assert.equal(cleanProfileName('say "hi"'), null);
  assert.equal(cleanProfileName('Женя'), null);
  assert.equal(cleanProfileName('x'.repeat(30)), 'x'.repeat(23));
  assert.equal(cleanProfileName(''), null);
});

test('the game install: registry, default paths, profiles', async () => {
  assert.equal(parseRegQuery('\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\EA GAMES\\Battlefield 1942\r\n    GAMEDIR    REG_SZ    C:\\Games\\Battlefield 1942\\\r\n'),
    'C:\\Games\\Battlefield 1942');
  assert.equal(parseRegQuery('ERROR: The system was unable to find the specified registry key or value.'), null);
  const asked = [];
  const run = (_cmd, args, _o, cb) => { asked.push(args[1]); cb(null, args[1].includes('WOW6432Node') ? '' : '    GAMEDIR    REG_SZ    D:\\BF42\r\n'); };
  assert.equal(await registryGameDir({ platform: 'win32', run }), 'D:\\BF42');
  assert.deepEqual(asked, ['HKLM\\SOFTWARE\\WOW6432Node\\EA GAMES\\Battlefield 1942', 'HKLM\\SOFTWARE\\EA GAMES\\Battlefield 1942']);
  assert.equal(await registryGameDir({ platform: 'linux', run }), null);
  assert.equal(defaultGameDirs({ platform: 'linux', home: '/h', env: {} })[0], '/h/.wine/drive_c/EA Games/Battlefield 1942');
  assert.equal(defaultGameDirs({ platform: 'linux', home: '/h', env: { WINEPREFIX: '/p' } })[0], '/p/drive_c/EA Games/Battlefield 1942');
  assert.equal(defaultGameDirs({ platform: 'win32', env: {} })[0], 'C:\\Program Files (x86)\\EA Games\\Battlefield 1942');

  // An install as Wine lays it out, in the game's own casing.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-install-'));
  const game = path.join(home, '.wine', 'drive_c', 'EA Games', 'Battlefield 1942');
  const settingsDir = path.join(game, 'Mods', 'BF1942', 'Settings');
  const profile = (folder, text) => {
    fs.mkdirSync(path.join(settingsDir, 'Profiles', folder), { recursive: true });
    if (text != null) fs.writeFileSync(path.join(settingsDir, 'Profiles', folder, 'GeneralOptions.con'), text, 'latin1');
  };
  profile('Default', 'game.setPlayerName "Player"\n');
  profile('skandia', 'rem x\ngame.setPlayerName "skandia"\ngame.setToolTip 0\n');
  profile('Broken', null);
  fs.writeFileSync(path.join(settingsDir, 'Profile.con'), 'game.setProfile "skandia"\n');
  const found = await findInstall({ platform: 'linux', home, env: {} });
  assert.equal(found.gameDir, game);
  assert.equal(found.from, 'default path');
  assert.deepEqual(listProfiles(found.settings), [
    { folder: 'Default', playerName: 'Player', current: false },
    { folder: 'skandia', playerName: 'skandia', current: true },
  ]);
  // A folder set in Settings wins, and one with no Settings says so.
  assert.equal((await findInstall({ override: game, platform: 'linux', home: '/nowhere', env: {} })).from, 'settings');
  assert.equal((await findInstall({ override: home, platform: 'linux', home, env: {} })).missing, true);
  assert.equal(await findInstall({ platform: 'linux', home: '/nowhere', env: {} }), null);
  assert.equal(playerNameOf('game.setPlayerName ""'), null);
});

test("the sidecar is run with --name-from-page only when the name is the page's", async () => {
  // A stand-in sidecar that says its argv as the player name line.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-args-'));
  const script = path.join(dir, 'echo.js');
  fs.writeFileSync(script, 'console.log("[sidecar] player name: " + JSON.stringify(process.argv.slice(2)) + " (fallback)");');
  const base = { script, host: '127.0.0.1', port: 14567, team: 0, wsPort: 17999, dataDir: dir };
  const page = new SidecarSession({ ...base, name: 'Last', nameFromPage: true });
  assert.equal(page.view().playerName, null);       // not known until the sidecar says
  assert.equal(page.view().nameFromPage, true);
  page.start();
  await page.exited;
  const pageArgs = JSON.parse(page.view().playerName);
  assert.ok(pageArgs.includes('--name-from-page'));
  assert.deepEqual(pageArgs.slice(pageArgs.indexOf('--name'), pageArgs.indexOf('--name') + 2), ['--name', 'Last']);
  const install = new SidecarSession({ ...base, name: 'Typed', nameSource: 'install' });
  assert.equal(install.view().playerName, 'Typed');
  assert.equal(install.view().playerNameFrom, 'install');
  install.start();
  await install.exited;
  assert.ok(!JSON.parse(install.view().playerName).includes('--name-from-page'));
});

test('settings: the name source', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-settings-'));
  const s = new Settings(dir);
  assert.equal(s.get('nameSource'), 'page');
  assert.deepEqual(s.update({ nameSource: 'install', installProfile: 'skandia', gameDir: '/games/bf42' }), {});
  assert.deepEqual(Object.keys(s.update({ nameSource: 'other', gameDir: 'relative/path' })).sort(), ['gameDir', 'nameSource']);
  assert.equal(s.update({ gameDir: 'C:\\Games\\BF42' }).gameDir, undefined);
  s.update({ lastPageName: 'from "page"' });
  assert.equal(s.get('lastPageName'), '');
  s.update({ lastPageName: 'skandia' });
  const again = new Settings(dir);
  assert.deepEqual([again.get('nameSource'), again.get('installProfile'), again.get('gameDir'), again.get('lastPageName')],
    ['install', 'skandia', 'C:\\Games\\BF42', 'skandia']);
});

test('the panel opens against the tray, inside the work area', () => {
  const size = { width: 384, height: 640 };
  // Windows: taskbar at the bottom, tray icon bottom right.
  const winArea = { x: 0, y: 0, width: 1920, height: 1040 };
  const winTray = { x: 1800, y: 1048, width: 24, height: 24 };
  assert.equal(trayEdge(winTray, winArea), 'bottom');
  assert.deepEqual(trayAnchoredPosition({ trayBounds: winTray, size, workArea: winArea }), { x: 1536, y: 400 });
  // Centred on the icon when there is room.
  assert.deepEqual(trayAnchoredPosition({ trayBounds: { x: 900, y: 1048, width: 24, height: 24 }, size, workArea: winArea }), { x: 720, y: 400 });
  // KDE panel on top: below it, clamped at the right edge.
  const kdeArea = { x: 0, y: 44, width: 2560, height: 1396 };
  assert.deepEqual(trayAnchoredPosition({ trayBounds: { x: 2530, y: 10, width: 22, height: 22 }, size, workArea: kdeArea }), { x: 2176, y: 44 });
  // Left and right taskbars: beside it, vertically clamped.
  assert.deepEqual(trayAnchoredPosition({ trayBounds: { x: 10, y: 1000, width: 24, height: 24 }, size, workArea: { x: 48, y: 0, width: 1872, height: 1080 } }), { x: 48, y: 440 });
  assert.deepEqual(trayAnchoredPosition({ trayBounds: { x: 1890, y: 20, width: 24, height: 24 }, size, workArea: { x: 0, y: 0, width: 1872, height: 1080 } }), { x: 1488, y: 0 });
  // A second display to the left (negative coordinates).
  assert.deepEqual(trayAnchoredPosition({ trayBounds: { x: -100, y: 1050, width: 24, height: 24 }, size, workArea: { x: -1920, y: 0, width: 1920, height: 1040 } }), { x: -384, y: 400 });
  // An auto-hiding panel inside the work area: the nearest edge.
  assert.equal(trayEdge({ x: 1890, y: 1050, width: 20, height: 20 }, { x: 0, y: 0, width: 1920, height: 1080 }), 'bottom');
  // Linux StatusNotifierItem: no bounds, no anchor.
  assert.equal(trayAnchoredPosition({ trayBounds: { x: 0, y: 0, width: 0, height: 0 }, size, workArea: winArea }), null);
  assert.equal(trayAnchoredPosition({ trayBounds: undefined, size, workArea: winArea }), null);
  // GNOME: the top-right corner of the primary display's work area (below the top bar).
  assert.deepEqual(cornerPosition({ workArea: { x: 0, y: 32, width: 2560, height: 1408 }, size }), { x: 2168, y: 40 });
  assert.deepEqual(cornerPosition({ workArea: { x: 2560, y: 0, width: 1920, height: 1200 }, size, corner: 'bottom-left' }), { x: 2568, y: 552 });
  // Too tall for a small screen: shrink, then it fits.
  assert.deepEqual(fitSize(size, { x: 0, y: 0, width: 1366, height: 600 }), { width: 384, height: 584 });
  assert.deepEqual(clampToArea({ x: -50, y: 5000 }, size, winArea), { x: 0, y: 400 });
});

test('servers keep what the panel shows: map image, round, tickets, teams', () => {
  const [s] = normalise({ servers: [{
    name: 'Moon', ip: '1.1.1.1', port: 14567, numPlayers: 16, maxPlayers: 64, gameId: 'bf1942', mapName: 'battle of the bulge',
    gameType: 'conquest', roundTimeRemain: 349, tickets1: 637, tickets2: '563', country: 'US',
    teams: [{ index: 1, label: 'Axis', tickets: 637 }, { index: 2, label: 'Allied', tickets: 563 }],
  }] });
  assert.equal(s.thumb, 'https://bfstats.io/stats/assets/maps/bf1942/battle_of_the_bulge');
  assert.deepEqual([s.roundTimeRemain, s.tickets1, s.tickets2, s.team1, s.team2, s.country, s.gameId], [349, 637, 563, 'Axis', 'Allied', 'US', 'bf1942']);
  const [bare] = normalise({ servers: [{ ip: '1.1.1.2', port: 1, roundTimeRemain: null, tickets1: 'x', country: 'usa' }] });
  assert.deepEqual([bare.thumb, bare.roundTimeRemain, bare.tickets1, bare.tickets2, bare.team1, bare.country], [null, null, null, null, null, null]);
  assert.equal(mapSlug(' Operation Coronet-1946 '), 'operation_coronet-1946');
  assert.equal(mapImageUrl('DC_Final', 'dc bridge'), 'https://bfstats.io/stats/assets/maps/dc_final/dc_bridge');
  assert.equal(mapImageUrl('', 'wake'), null);
  assert.equal(mapImageUrl('bf1942', null), null);
});

test('the panel state: the session card, idle, and the name', () => {
  const servers = normalise({ servers: [{
    name: 'Moon', ip: '1.1.1.1', port: 14567, numPlayers: 16, maxPlayers: 64, gameId: 'bf1942', mapName: 'battle of the bulge',
    gameType: 'conquest', roundTimeRemain: 349, tickets1: 637, tickets2: 563,
    teams: [{ index: 1, label: 'Axis' }, { index: 2, label: 'Allied' }],
  }] });
  const settings = { recent: [{ address: '1.1.1.1:14567', name: 'Moon' }], nameSource: 'page', playerName: 'BrowserSoldier' };
  const joined = panelState({
    session: { state: 'joined', address: '1.1.1.1:14567', serverName: 'Moon', mapName: 'battle_of_the_bulge', gameType: 'conquest', mod: 'bf1942', playerName: 'Ace', wsPort: 17942, pageConnected: true },
    servers, serversAt: 1000, settings, nameInfo: { name: 'BrowserSoldier', source: 'page' }, tray: { visible: true },
  });
  assert.equal(joined.dot, 'joined');
  assert.equal(joined.current, '1.1.1.1:14567');
  assert.deepEqual(
    [joined.card.name, joined.card.map, joined.card.gameType, joined.card.players, joined.card.maxPlayers, joined.card.playerName, joined.card.thumb],
    ['Moon', 'Battle Of The Bulge', 'Conquest', 16, 64, 'Ace', 'https://bfstats.io/stats/assets/maps/bf1942/battle_of_the_bulge'],
  );
  assert.deepEqual([joined.card.roundTimeRemain, joined.card.tickets1, joined.card.tickets2, joined.card.team1], [349, 637, 563, 'Axis']);
  assert.equal(joined.name.label, 'Viewer profile');
  assert.equal(joined.trayless, false);
  // Joining an unlisted server: the card is there, the round is not.
  const joining = panelState({ session: { state: 'connecting', address: '127.0.0.1:14567', nameFromPage: true }, servers, settings });
  assert.equal(joining.dot, 'joining');
  assert.equal(joining.card.waitingForName, true);
  assert.equal(joining.card.roundTimeRemain, null);
  assert.equal(joining.card.thumb, null);
  assert.equal(joining.card.canOpenViewer, false);
  // Idle, and a session that ended: no card, the reason kept.
  const idle = panelState({ session: null, servers, settings: { ...settings, nameSource: 'custom' }, tray: { visible: false } });
  assert.equal(idle.card, null);
  assert.equal(idle.current, null);
  assert.deepEqual([idle.name.label, idle.name.name, idle.trayless], ['Custom name', 'BrowserSoldier', true]);
  const ended = panelState({ session: { state: 'denied', detail: 'Denied: serverFull', address: '1.1.1.1:14567' }, servers, settings });
  assert.equal(ended.card, null);
  assert.equal(ended.lastEnded, 'Denied: serverFull');
  assert.equal(ended.dot, null);
  assert.equal(panelState({ session: null, servers, settings, nameInfo: { name: 'Pvt', source: 'install' } }).name.label, 'Install profile');
  assert.deepEqual(['ctf', 'coop', 'conquest', 'tdm', 'king_of_hill', null].map(gameTypeTitle), ['CTF', 'Co-op', 'Conquest', 'TDM', 'King Of Hill', '']);
});
