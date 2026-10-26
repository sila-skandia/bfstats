// Writes core/src/test/resources/parity/server-query.json from the Node
// sidecar's server-query.mjs: the GameSpy reply parser, the level readers
// over GameSpy and live-list rows, and queryServerLevel against a fake live
// list and real UDP stand-ins for GameSpy servers on 127.0.0.1 (A answers in
// one datagram, B in two, C without \final\, D never). Ports are ephemeral,
// so the fixture names them by token ("$A") and ServerQueryTest.kt runs its
// own stand-ins and substitutes its ports. Cases that fall through to the
// port guesses (game port + 8433 / + 7433) use game port 9, so a real server
// on this PC (server1 answers on 22000 and 23000) never takes part.
//   node parity/server-query.mjs
import dgram from 'node:dgram';
import { sidecar, write } from './lib/fixture.mjs';

delete process.env.SIDECAR_LIVE_LIST;
const Q = await sidecar('server-query.mjs');
const out = {};

out.parse = ['\\gameId\\bf1942\\mapname\\Wake\\', '', 'no slashes', '\\a\\1\\b', '\\\\x\\y\\', '\\A\\1\\a\\2\\B\\3', '\\10\\x\\2\\y\\k\\z\\1\\w',
  '\\hostname\\Café À\\final\\\\queryid\\1.1', 'x\\a\\b\\c\\d'].map((t) => [t, Q.parseGamespy(t)]);
out.fromGamespy = [
  { gameid: 'bf1942', mapname: 'Wake', gametype: 'conquest', hostname: 'Lab' }, { mapid: 'XPack1', mapname: 'Anzio' },
  { gameid: '', mapid: 'DC', mapname: 'x', gametype: '' }, { gameid: 'bf1942' }, { mapname: 'Wake' }, {},
].map((kv) => [kv, Q.levelFromGamespy(kv)]);
out.fromRow = [
  { mapId: 'BF1942', mapName: 'market garden', gameType: 'conquest', name: 'S', queryPort: 23000 },
  { gameId: 'bf1942', mapName: 'Wake' }, { mapId: null, gameId: 'XPack2', mapName: 'Peenemunde', queryPort: 0 },
  { mapId: 'DC', mapName: '' }, { mapName: 'x' }, {}, null, { mapId: 'BF1942', mapName: 'Wake', queryPort: '23001', name: '' },
].map((r) => [r, Q.levelFromLiveRow(r)]);

const ANSWERS = {
  A: ['\\gameId\\bf1942\\mapname\\Wake\\gametype\\conquest\\hostname\\Lab Server\\final\\\\queryid\\1.1'],
  B: ['\\gameId\\xpack1\\mapname\\An', 'zio\\gametype\\coop\\final\\'],
  C: ['\\gameId\\DC_Final\\mapname\\El Alamein\\gametype\\ctf'],
};
const servers = {};
for (const [k, chunks] of Object.entries(ANSWERS)) {
  const s = dgram.createSocket('udp4');
  s.on('message', (m, r) => { if (m.toString('latin1') === '\\status\\') for (const c of chunks) s.send(Buffer.from(c, 'latin1'), r.port, r.address); });
  await new Promise((res) => s.bind(0, '127.0.0.1', res));
  servers[k] = s;
}
const ports = Object.fromEntries(Object.entries(servers).map(([k, s]) => [k, s.address().port]));
{ const d = dgram.createSocket('udp4'); await new Promise((res) => d.bind(0, '127.0.0.1', res)); ports.D = d.address().port; d.close(); }
out.answers = ANSWERS;

const sub = (s) => s.replace(/"\$([A-D])"/g, (_, k) => String(ports[k]));
const unsub = (v) => {
  if (v && typeof v === 'object') { const o = Array.isArray(v) ? [] : {}; for (const [k, x] of Object.entries(v)) o[k] = unsub(x); return o; }
  for (const [k, p] of Object.entries(ports)) if (v === p) return `$${k}`;
  return v;
};
const row = (extra) => ({ ip: '127.0.0.1', port: 14567, mapId: 'BF1942', mapName: 'market garden', gameType: 'conquest', name: 'Listed Name', ...extra });
const cases = [
  { name: 'listAndA', port: 14567, body: JSON.stringify({ servers: [row({ ip: '10.0.0.1' }), row({ queryPort: '$A' })] }) },
  { name: 'listAndB', port: 14567, body: JSON.stringify([row({ queryPort: '$B' })]) },
  { name: 'listAndC', port: 14567, body: JSON.stringify([row({ queryPort: '$C' })]) },
  { name: 'listDeadQuery', port: 14567, body: JSON.stringify([row({ queryPort: '$D' })]) },
  { name: 'listStringPort', port: 14567, body: JSON.stringify([row({ port: '14567', queryPort: '$A' })]) },
  { name: 'listOff', port: 14567, url: 'off', queryPort: '$B', body: '[]' },
  { name: 'notOk', port: 9, body: null, queryPort: '$D' },
  { name: 'throws', port: 14567, body: 'throw', queryPort: '$C' },
  { name: 'badJson', port: 9, body: '{not json', queryPort: '$D' },
  { name: 'noRow', port: 9, body: JSON.stringify({ servers: [row({ port: 1 })] }) },
  { name: 'guessA', port: ['A', -8433], body: '[]' },
  { name: 'guessLan', port: ['C', -7433], body: '{}' },
  { name: 'explicitThenList', port: 14567, queryPort: '$D', body: JSON.stringify([row({ queryPort: '$A', name: null })]) },
  { name: 'rowNoLevel', port: 14567, queryPort: '$A', body: JSON.stringify([row({ mapName: '' })]) },
];
out.query = [];
for (const c of cases) {
  const port = Array.isArray(c.port) ? ports[c.port[0]] + c.port[1] : c.port;
  const fetchImpl = async () => {
    if (c.body === 'throw') throw new Error('offline');
    if (c.body == null) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => JSON.parse(sub(c.body)) };
  };
  if (c.url) process.env.SIDECAR_LIVE_LIST = c.url; else delete process.env.SIDECAR_LIVE_LIST;
  const qp = c.queryPort ? ports[c.queryPort.slice(1)] : null;
  const got = await Q.queryServerLevel('127.0.0.1', port, { queryPort: qp, timeoutMs: 300, fetchImpl });
  out.query.push({ ...c, out: unsub(got) });
}
delete process.env.SIDECAR_LIVE_LIST;
out.status = {};
for (const k of ['A', 'B', 'C', 'D']) out.status[k] = await Q.gamespyStatus('127.0.0.1', ports[k], { timeoutMs: 400 });
for (const s of Object.values(servers)) s.close();
write('server-query', out);
