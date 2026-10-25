// test_sidecar_level_tables.py's node half: the level tables without an
// install (sidecar/level-tables.mjs). A local HTTP server stands in for
// mesh.bfstats.io; BF1942_DIR is an empty directory and SIDECAR_CACHE a
// scratch one, both set by the caller before this module loads anything.
//
//   node tests/sidecar_level_tables_harness.mjs
//
// Prints one JSON line.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const L = await import('../sidecar/level-tables.mjs');
const { templateTable, levelTemplates } = await import('../sidecar/template-table.mjs');
const { gameTables } = await import('../sidecar/game-tables.mjs');
const { namesForLevel } = await import('../sidecar/names.mjs');
const { Session } = await import('../sidecar/session.mjs');
const { objectsChecksum } = await import('../sidecar/objects-checksum.mjs');

const out = {};

// ---- the mod -> tree -> URL mapping ----------------------------------------
const base = 'https://mesh.example/';
out.urls = {
  bf1942: L.tablesUrl({ mod: 'bf1942', level: 'bf1942/levels/Wake/', mode: 'coop.con' }, base),
  BF1942: L.tablesUrl({ mod: 'BF1942', level: 'market garden', mode: 'conquest' }, base),
  XPack1: L.tablesUrl({ mod: 'XPack1', level: 'bf1942/levels/Anzio/', mode: 'CoOp.con' }, base),
  xpack2: L.tablesUrl({ mod: 'xpack2', level: 'Essen', mode: 'GPM_OBJECTIVEMODE' }, base),
  DC_Final: L.tablesUrl({ mod: 'DC_Final', level: 'dc lostvillage', mode: 'ctf' }, base),
  FHSW: L.tablesUrl({ mod: 'FHSW', level: 'bf1942/levels/Lake_Ladoga-1944/', mode: null }, base),
  noSlash: L.tablesUrl({ mod: 'DesertCombat', level: 'tobruk', mode: 'coop' }, 'https://mesh.example'),
};
out.keys = { level: L.levelKey('bf1942\\levels\\Market_Garden\\'), mode: [L.modeKey('CoOp.con'), L.modeKey('GPM_CQ'), L.modeKey(''), L.modeKey('objective')] };

// ---- a stand-in for the published tables -------------------------------------
const { TEMPLATE_TABLE_VERSION } = await import('../sidecar/template-table.mjs');
// rev: a rebake on the server bumps it (a new ETag, a new last tid name);
// v: the code version the copy was baked by.
const served = new Map(); // level -> { rev, v }
const state = (level) => { if (!served.has(level)) served.set(level, { rev: 1, v: TEMPLATE_TABLE_VERSION }); return served.get(level); };
const baked = (level, mode) => {
  const { rev, v } = state(level);
  const names = ['ObjectManagerCamera', 'BlueFlag', 'RedFlag', 'Sherman', 'Tiger', rev === 1 ? 'TestTank' : `TestTank${rev}`];
  return {
    format: 1, mod: 'bf1942', level, mode,
    tids: { v, mod: 'bf1942', level, mode, names, classes: ['Camera', 'Flag', 'Flag', 'PlayerControlObject', 'PlayerControlObject', 'PlayerControlObject'], specs: {}, hulls: {}, soldiers: {} },
    animStates: [[0, 'Idle', 0], [1, 'Run', 0], [2, 'Prone', 0]].slice(0, rev === 1 ? 3 : 2),
    cpNames: { ALLIES_base: 'Airfield' },
  };
};
const requests = [];
const conditional = [];  // [url, If-None-Match, If-Modified-Since, status]
let down = false;        // the server takes the request and never answers
const server = http.createServer((req, res) => {
  requests.push(req.url);
  if (down) return;
  const m = req.url.match(/^\/maps(?:\/mods\/([^/]+))?\/([^/]+)\/sidecar\/([^/]+)\.json$/);
  if (m && m[2] === 'slow') return; // never answers
  if (m && m[2] === 'garbled') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"format":99}'); }
  if (m && ['wake', 'el_alamein', 'anzio', 'berlin', 'oldcode'].includes(m[2])) {
    const { rev, v } = state(m[2]);
    // As mesh.bfstats.io: a weak ETag and a Last-Modified, both honoured.
    const etag = `W/"${m[2]}-${rev}-${v}"`;
    const lastModified = new Date(Date.UTC(2026, 9, 25, 3, rev)).toUTCString();
    const inm = req.headers['if-none-match'] ?? null;
    const ims = req.headers['if-modified-since'] ?? null;
    const fresh = inm ? inm === etag : (ims ? ims === lastModified : false);
    conditional.push([req.url, inm, ims, fresh ? 304 : 200]);
    if (fresh) { res.writeHead(304, { etag, 'last-modified': lastModified }); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/json', etag, 'last-modified': lastModified });
    return res.end(JSON.stringify(baked(m[2], m[3])));
  }
  res.writeHead(404); res.end('not found');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.SIDECAR_TABLES_URL = `http://127.0.0.1:${server.address().port}`;

const wake = { mod: 'bf1942', level: 'bf1942/levels/wake/', mode: 'coop.con' };

// 1. No install, nothing cached: the sync lookups find nothing, and say so.
out.before = { table: templateTable(wake), anim: gameTables(wake).animStates };
// 2. prepareLevel downloads into the cache; the sync lookups now answer from it.
out.first = await L.prepareLevel(wake);
out.cacheFile = fs.existsSync(L.bakedCacheFile(wake)) ? path.relative(process.env.SIDECAR_CACHE, L.bakedCacheFile(wake)) : null;
const t = templateTable(wake);
out.after = {
  count: t?.count ?? 0, tid5: t?.tidNames?.['5'] ?? null, cls3: t?.tidClasses?.['3'] ?? null,
  layouts: !!levelTemplates(wake),
  anim: gameTables(wake).animStates?.length ?? 0,
  cp: gameTables(wake).cpNames?.ALLIES_base ?? null,
  named: (() => { const n = namesForLevel(wake.level, { mod: wake.mod, mode: wake.mode }); return { computed: n.computed, tid4: n.tidNames['4'] ?? null }; })(),
};
// 3. Asked again a moment later (the pre-join, then the SetLevel): the memo, no request.
const n1 = requests.length;
out.again = (await L.prepareLevel(wake)).source;
out.requestsForAgain = requests.length - n1;
// 4. The next join (the memo forgotten): the cached copy, revalidated with a
//    conditional GET carrying its ETag, and the server's 304 keeps it.
L.resetLevelTables();
{
  const r = await L.prepareLevel(wake);
  const c = conditional.at(-1);
  out.revalidate304 = { source: r.source, revalidated: r.revalidated ?? null, ifNoneMatch: c[1], ifModifiedSince: c[2], status: c[3], tid5: templateTable(wake)?.tidNames?.['5'] ?? null };
}
// 5. The server rebaked: the conditional GET gets a 200, the new copy
//    replaces the cached one, and the sync lookups (memoised) see it.
state('wake').rev = 2;
L.resetLevelTables();
{
  const r = await L.prepareLevel(wake);
  out.revalidate200 = { source: r.source, replaced: r.replaced ?? false, status: conditional.at(-1)[3], tid5: templateTable(wake)?.tidNames?.['5'] ?? null, anim: gameTables(wake).animStates?.length ?? 0 };
}
// 6. Offline: the server takes the request and never answers, or nothing
//    listens. The cached copy is used without waiting past revalidateMs.
L.resetLevelTables();
down = true;
{
  const t0 = Date.now();
  const r = await L.prepareLevel(wake, { revalidateMs: 300 });
  out.offlineHung = { source: r.source, stale: r.stale ?? false, quick: Date.now() - t0 < 2000, tid5: templateTable(wake)?.tidNames?.['5'] ?? null };
}
down = false;
L.resetLevelTables();
{
  const t0 = Date.now();
  const r = await L.prepareLevel(wake, { base: 'http://127.0.0.1:9/', revalidateMs: 300 });
  out.offlineRefused = { source: r.source, stale: r.stale ?? false, quick: Date.now() - t0 < 2000 };
}
// 7. A cached copy baked by other code: fetched whole (no validators) and
//    the fresh copy preferred.
{
  const old = { mod: 'bf1942', level: 'oldcode', mode: 'coop' };
  state('oldcode').v = 'other-code';
  await L.prepareLevel(old);
  const before = L.readBaked(old)?.tids?.v ?? null;
  state('oldcode').v = TEMPLATE_TABLE_VERSION;
  L.resetLevelTables();
  const r = await L.prepareLevel(old);
  const c = conditional.at(-1);
  out.otherCode = { before, source: r.source, conditional: !!(c[1] || c[2]), after: L.readBaked(old)?.tids?.v === TEMPLATE_TABLE_VERSION };
}
state('wake').rev = 1;
L.resetLevelTables();
await L.prepareLevel(wake);
// 5. An expansion's level comes from its own tree.
out.xpack = (await L.prepareLevel({ mod: 'XPack1', level: 'bf1942/levels/Anzio/', mode: 'CoOp.con' })).source;
// 6. Not published: none, and the recorded fallback stands in.
out.missing = (await L.prepareLevel({ mod: 'bf1942', level: 'bf1942/levels/no_such_level/', mode: 'conquest.con' })).source;
out.missingTable = templateTable({ mod: 'bf1942', level: 'bf1942/levels/no_such_level/', mode: 'conquest.con' });
out.missingNamed = namesForLevel('bf1942/levels/no_such_level/', { mod: 'bf1942', mode: 'conquest.con' }).computed;
// 7. A server that never answers is given up on in time.
{
  const t0 = Date.now();
  const r = await L.prepareLevel({ mod: 'bf1942', level: 'slow', mode: 'coop' }, { timeoutMs: 300 });
  out.slow = { source: r.source, quick: Date.now() - t0 < 3000 };
}
// 8. A document of another format is refused.
out.garbled = (await L.prepareLevel({ mod: 'bf1942', level: 'garbled', mode: 'coop' })).source;
// 9. Downloads off.
{
  const keep = process.env.SIDECAR_TABLES_URL;
  process.env.SIDECAR_TABLES_URL = 'off';
  out.off = (await L.prepareLevel({ mod: 'bf1942', level: 'berlin', mode: 'ctf' })).source;
  process.env.SIDECAR_TABLES_URL = keep;
}

// ---- the session holds the level load until the tables are there -----------
function stubSession(opts) {
  const s = new Session('127.0.0.1', 1, { name: 'lt', ...opts });
  s.conn.state = 'connected';
  try { s.conn.sock.close(); } catch { /* never bound */ }
  const order = [];
  s.on('event', (ev) => order.push(ev.type));
  return { s, order };
}
const dump = (level) => [
  { type: 'ServerInfo', mapId: 'BF1942', mod: 'bf1942', gameId: 'BF1942' },
  { type: 'SetLevel', levelPath: `bf1942/levels/${level}/`, modeFile: 'coop.con' },
  { type: 'CreateObject', netId: 700, template: 5, pos: [0, 0, 0], rot: [0, 0, 0] },
  { type: 'DataBaseComplete' },
];

// 10. A gate that resolves later: nothing past the SetLevel runs, ghosts
//     included, and the world dump's acks wait; then all of it in order.
{
  let release;
  const gateCalls = [];
  const { s, order } = stubSession({ levelGate: (i) => { gateCalls.push(i); return new Promise((r) => { release = r; }); } });
  s._deliver({ index: 0, resend: false, events: dump('wake') }, 1);
  s._work.push({ fn: () => order.push('ghost') }); s._pump();
  s._deliver({ index: 1, resend: false, events: [{ type: 'CreateObject', netId: 701, template: 4 }] }, 2);
  const held = { order: order.slice(), outbox: s.outbox.map(([n]) => n), gate: gateCalls[0] ?? null };
  const released = new Promise((r) => s.once('level-release', r));
  release({ source: 'download' });
  const rel = await released;
  out.gate = { held, order: order.slice(), outbox: s.outbox.map(([n]) => n), release: { timedOut: rel.timedOut, source: rel.result?.source ?? null } };
}
// 11. The real prepareLevel as the gate, on a level nobody fetched yet: the
//     body decoder names the CreateObject from the downloaded table.
{
  const { s, order } = stubSession({ levelGate: (i) => L.prepareLevel({ mod: i.mod, level: i.levelPath, mode: i.modeFile }) });
  const released = new Promise((r) => s.once('level-release', r));
  s._deliver({ index: 0, resend: false, events: dump('el_alamein') }, 1);
  const heldOrder = order.slice();
  const rel = await released;
  out.realGate = { heldOrder, order: order.slice(), source: rel.result?.source ?? null, tmpl700: s.bodies.info(700)?.tmpl ?? null, ack: s.outbox.some(([n]) => n === 'Ack') };
}
// 12. A gate that never resolves: the level loads anyway after levelHoldMs.
{
  const { s, order } = stubSession({ levelGate: () => new Promise(() => {}), levelHoldMs: 200 });
  const released = new Promise((r) => s.once('level-release', r));
  s._deliver({ index: 0, resend: false, events: dump('wake') }, 1);
  const rel = await released;
  out.gateTimeout = { timedOut: rel.timedOut, order: order.slice() };
}
// 13. No gate (an install, or a test): handled at once, as before.
{
  const { s, order } = stubSession({});
  s._deliver({ index: 0, resend: false, events: dump('wake') }, 1);
  out.noGate = order.slice();
}

// ---- the objects.rfa CRC without the install ---------------------------------
out.crc = { bf1942: objectsChecksum('BF1942'), xpack2: objectsChecksum('XPack2'), unknown: objectsChecksum('NoSuchMod'), notBundled: objectsChecksum('BF1942', { bundled: false }) };

out.requests = requests;
server.close();
console.log(JSON.stringify(out));
process.exit(0);
