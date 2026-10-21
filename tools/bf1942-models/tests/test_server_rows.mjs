/**
 * The MULTIPLAY list's server rows under node: `viewer/play/server-list.js`
 * (an API server as the fields the engine's row builder reads) and the row
 * helpers in `viewer/play/multiplay-layout.js` (what BF1942.exe draws in
 * each cell, and where).
 *
 * The numbers are the binary's (`features/multiplay-front-end/README.md`,
 * "The server rows"); a change here is a change to what the engine was read
 * as doing, not a refactor.
 */
import assert from 'node:assert/strict';
import { LOCAL_STATS, serverRow, statsBase } from '../viewer/play/server-list.js';
import {
  CLIP_MARGIN, COLUMN_X, COLUMNS, ICON_CELLS, ROW_INSET, TEXT_COLUMNS,
  dedicatedIcon, filterInvalid, globMatch, modIcon, numberPasses, parseNumberFilter,
  passesFilters, playersText, rowGeometry, textPasses,
} from '../viewer/play/multiplay-layout.js';

// --- the API row -------------------------------------------------------------

// One server as `/stats/liveservers/bf1942/servers` sends it (trimmed).
const api = {
  name: '*NEW* SiMPLE | RtR+SW', ip: '37.187.92.162', port: 14568, password: false,
  gameVersion: 'v1.61', dedicated: 2, status: 4, contentCheck: true, anticheat: true,
  reservedSlots: 4, numPlayers: 11, maxPlayers: 36, mapName: 'husky',
  gameType: 'conquest', gameId: 'xpack1', mapId: 'XPack1',
  joinLink: 'bf1942://37.187.92.162:14568?mod=xpack1',
};
const row = serverRow(api);
assert.equal(row.kind, 'server');
assert.equal(row.name, '*NEW* SiMPLE | RtR+SW');
assert.equal(row.address, '37.187.92.162:14568');
assert.equal(row.gameId, 'xpack1');
assert.equal(row.pure, true, 'content_check is the pure icon');
assert.equal(row.punkbuster, true, 'anticheat is sv_punkbuster');
assert.equal(row.ping, null, 'a browser cannot take the ping');
assert.equal(row.map, 'HUSKY', 'the game uppercases mapname');
assert.equal(row.gameType, 'CONQUEST', 'and gametype');
assert.equal(serverRow({ ...api, mapName: 'kharkov-é' }).map, 'KHARKOV-é', 'ASCII only, as toupper');
assert.equal(row.joinLink, api.joinLink, 'the API link, mod and all, as the stats site uses it');

// A server without a link still joins by its address; one without `gameId`
// falls back to `mapId`, which BFList fills with the mod too.
const bare = serverRow({ ...api, joinLink: '', gameId: '' });
assert.equal(bare.joinLink, 'bf1942://37.187.92.162:14568');
assert.equal(bare.gameId, 'XPack1');

// --- where it reads from -----------------------------------------------------

const at = (href) => { const u = new URL(href); return { hostname: u.hostname, search: u.search }; };
assert.equal(statsBase(at('https://play.bfstats.io/play/index.html')), '', 'deployed: this origin');
assert.equal(statsBase(at('http://localhost:5273/play/index.html')), LOCAL_STATS, 'local: the stats dev server');
assert.equal(LOCAL_STATS, 'http://localhost:5173');
assert.equal(statsBase(at('http://localhost:5273/?api=http://127.0.0.1:9333/')), 'http://127.0.0.1:9333');

// --- the cells -----------------------------------------------------------------

assert.equal(playersText(row), '11/36(4)', 'reserved slots in brackets');
assert.equal(playersText({ players: 0, max: 32, reserved: 0 }), '0/32');

assert.equal(dedicatedIcon(2, 4), 'menu_icon_linux_green_16x16');
assert.equal(dedicatedIcon(1, 3), 'menu_icon_dedicated_green_16x16');
assert.equal(dedicatedIcon(1, 2), 'menu_icon_dedicated_yellow_16x16');
assert.equal(dedicatedIcon(2, 1), 'menu_icon_linux_red_16x16');
assert.equal(dedicatedIcon(1, 0), 'menu_icon_dedicated_16x16', 'no status, plain icon');
assert.equal(dedicatedIcon(0, 4), 'menu_icon_player_16x16', 'a listen server');

const badges = { xpack1: 'modbadge_xpack1', bf1942: null, stfhswe: null };
assert.equal(modIcon('XPack1', badges), 'modbadge_xpack1', 'case-blind, as the engine compares');
assert.equal(modIcon('bf1942', badges), null, 'vanilla has no badge');
assert.equal(modIcon('stfhswe', badges), null, 'installed without serverInfo');
assert.equal(modIcon('gcn_mario_kart', badges), 'unknown_game', 'not installed');
assert.equal(modIcon('', badges), null);

// --- where they go ---------------------------------------------------------------

// The five heads and the five text columns line up: each text column starts
// within a few pixels of its head's label in `menu/InternetMenu`.
const box = { rect: [28, 188, 562, 270], rowHeight: 14, scrollbarWidth: 6, scrollbarOffset: 4 };
const labels = [35, 254, 316, 360, 456];
assert.equal(COLUMNS.length, TEXT_COLUMNS.length);
for (const [i, col] of TEXT_COLUMNS.entries()) {
  if (i === 0) continue;  // the name is after the icon cells, under the SERVER head
  const x = box.rect[0] + ROW_INSET + COLUMN_X[col];
  assert.ok(Math.abs(x - labels[i]) <= 7, `column ${col} at ${x}, its head's label at ${labels[i]}`);
}
assert.equal(box.rect[0] + ROW_INSET + COLUMN_X[6], 107, 'the name at 107');
assert.equal(COLUMN_X[7] - COLUMN_X[6] - CLIP_MARGIN, 134, 'the name clips at 134 px');

// The icons are under the SERVER head, left of the name.
for (const [, x] of Object.values(ICON_CELLS)) {
  const left = box.rect[0] + ROW_INSET + x;
  assert.ok(left >= 30 && left + 16 <= 107, `icon at ${left}`);
}

const geo = rowGeometry(box);
assert.equal(geo.count, 17, 'seventeen rows in the shipped box');
assert.equal(geo.baseline(0), 216, 'the first baseline two rows down');
assert.deepEqual(geo.select(0), [30, 204, 540, 14]);
assert.ok(geo.baseline(geo.count - 1) <= 188 + 270 - 14, 'the last row a row clear of the bottom');
assert.equal(geo.select(1)[1] - geo.select(0)[1], 14);

// --- the filters (FUN_0069bfc0, FUN_0069cf00, FUN_0069e0a0) -------------------

// Number filters: the operator codes, the bare default, one space, and a 0
// that has to be written as 0.
assert.deepEqual(parseNumberFilter('<10', 4), { op: 1, n: 10 });
assert.deepEqual(parseNumberFilter('>5', 3), { op: 2, n: 5 });
assert.deepEqual(parseNumberFilter('>=5', 3), { op: 3, n: 5 });
assert.deepEqual(parseNumberFilter('<=100', 4), { op: 4, n: 100 });
assert.deepEqual(parseNumberFilter('=8', 3), { op: 5, n: 8 });
assert.deepEqual(parseNumberFilter('> 50', 3), { op: 2, n: 50 });
assert.deepEqual(parseNumberFilter('150', 4), { op: 4, n: 150 }, 'a bare ping is a ceiling');
assert.deepEqual(parseNumberFilter('2', 3), { op: 3, n: 2 }, 'a bare player count is a floor');
assert.deepEqual(parseNumberFilter('>0', 3), { op: 2, n: 0 });
assert.equal(parseNumberFilter('> 0', 3), null, 'a 0 past two characters is refused');
assert.equal(parseNumberFilter('> 5', 3), null, 'a space needs four characters');
assert.equal(parseNumberFilter('abc', 3), null);
assert.equal(parseNumberFilter('>', 3), null);
assert.equal(parseNumberFilter('==5', 3), null);
assert.ok(numberPasses({ op: 3, n: 2 }, 5) && !numberPasses({ op: 3, n: 2 }, 1));
assert.ok(numberPasses({ op: 4, n: 100 }, 0), 'no ping reads as 0, as atoi reads an empty reply');

// Text filters: what is typed with a * after it, matched whole, case-blind.
assert.ok(textPasses('fight', 'Fight Club'));
assert.ok(!textPasses('club', 'Fight Club'), 'a prefix, not a substring');
assert.ok(textPasses('*club', 'Fight Club'), 'a * of its own reaches inside');
assert.ok(textPasses('f?ght', 'FIGHT CLUB'));
assert.ok(globMatch('', '*') && !globMatch('a', '') && globMatch('abc', 'a*c'));

const rows = [
  { name: 'Fight Club', players: 5, ping: null, gameType: 'CONQUEST', map: 'WAKE' },
  { name: 'Oz Wake', players: 0, ping: null, gameType: 'COOP', map: 'WAKE' },
  { name: 'BFSERVER', players: 12, ping: null, gameType: 'CTF', map: 'BERLIN' },
];
const pick = f => rows.filter(r => passesFilters(r, f)).map(r => r.name);
assert.deepEqual(pick({ 'Filter/MapFilter': 'wake' }), ['Fight Club', 'Oz Wake']);
assert.deepEqual(pick({ 'Filter/MapFilter': 'wake', 'Filter/PlayersFilter': '1' }), ['Fight Club']);
assert.deepEqual(pick({ 'Filter/GameFilter': 'c' }), ['Fight Club', 'Oz Wake', 'BFSERVER']);
assert.deepEqual(pick({ 'Filter/PlayersFilter': 'oops' }), rows.map(r => r.name), 'a refused filter is not applied');
assert.ok(filterInvalid('Filter/PlayersFilter', 'oops') && !filterInvalid('Filter/MapFilter', 'oops'));

console.log('server rows: ok');
