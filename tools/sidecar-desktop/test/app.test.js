'use strict';
// node --test test/  (no Electron needed: these are the app's pure parts)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseAddress, parseJoinLink, linkFromArgv, cleanName } = require('../src/address');
const { parseLine, describe, sessionLines, trayIconState } = require('../src/sidecar-status');
const { normalise, sortServers, serverLabel, decodeName } = require('../src/servers');
const { buildModel, toTemplate, toPlain, findById } = require('../src/menu-model');
const { Settings, cleanViewerBase } = require('../src/settings');
const { RotatingLog } = require('../src/logger');
const { desktopEntry, quoteExecArg } = require('../src/linux-integration');
const { trayVisibility } = require('../src/tray-support');

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
  assert.deepEqual(parseLine('[sidecar] the server plays market garden conquest (mod bf1942, from its gamespy): tables from cache in 3 ms'), { mapName: 'market garden', gameType: 'conquest' });
  assert.deepEqual(parseLine("[sidecar] loading bf1942/levels/wake/ coop.con (mod bf1942): the world dump waits for the level's tables"), { mapName: 'wake', gameType: 'coop' });
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

test('the menu model: sections, ids, both renderings', () => {
  const calls = [];
  const actions = new Proxy({}, { get: (_t, k) => (...a) => calls.push([k, ...a]) });
  const ctx = {
    session: { state: 'joined', address: '1.1.1.1:14567', serverName: 'A & B', mapName: 'wake', pageConnected: true },
    servers: normalise({ servers: [{ name: 'A & B', ip: '1.1.1.1', port: 14567, numPlayers: 2, maxPlayers: 32 },
      { name: 'Empty', ip: '1.1.1.2', port: 14567, numPlayers: 0, maxPlayers: 32 }] }),
    settings: { recent: [{ address: '9.9.9.9:14567', name: 'Old' }] },
    startAtLogin: true,
    actions,
  };
  const model = buildModel(ctx);
  const ids = [];
  const walk = (items) => items.forEach((i) => { ids.push(i.id); if (i.submenu) walk(i.submenu); });
  walk(model);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const id of ['status', 'join', 'recent', 'join-address', 'open-viewer', 'leave', 'logs', 'settings', 'start-at-login', 'quit']) {
    assert.ok(ids.includes(id), id);
  }
  assert.deepEqual(model.slice(0, 3).map((i) => i.label), ['In game', 'A && B (1.1.1.1:14567)', 'Wake']);
  const server = findById(model, 'server:1.1.1.1:14567');
  assert.match(server.label, /A && B/);
  server.click();
  assert.deepEqual(calls.at(-1), ['join', { host: '1.1.1.1', port: 14567, serverName: 'A & B', mapName: null }]);
  findById(model, 'recent:9.9.9.9:14567').click();
  assert.deepEqual(calls.at(-1), ['joinAddress', '9.9.9.9:14567', { serverName: 'Old' }]);
  assert.ok(findById(model, 'servers-empty').submenu.length === 1);
  const tpl = toTemplate(model);
  assert.equal(typeof tpl.find((t) => t.id === 'quit').click, 'function');
  const plain = toPlain(model);
  assert.equal(JSON.stringify(plain).includes('function'), false);
  assert.equal(plain.find((p) => p.id === 'start-at-login').checked, true);
  // Idle: nothing to leave.
  const idle = buildModel({ ...ctx, session: null });
  assert.equal(findById(idle, 'leave'), null);
  assert.equal(findById(idle, 'open-viewer'), null);
  assert.equal(idle[0].label, 'Not on a server');
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
