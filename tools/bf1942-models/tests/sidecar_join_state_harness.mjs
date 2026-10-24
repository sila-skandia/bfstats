// What a page that joins mid-session knows, against a page that was there
// from the start (features/udp-sidecar/browser.md, "Joining late").
//
// 1. EQUIVALENCE. A session's rows are fed to two `net-sidecar.js` states: one
//    takes every row from the start; the other, at each cut, takes only the
//    sidecar's live snapshot of the rows so far (`sidecar/live-snapshot.mjs`,
//    what sidecar.mjs sends a page that connects). The state each one holds
//    -- the roster, who controls and sits in what, every object and its
//    class, the rounds, poses, stances, hit points, kits, flags, tickets,
//    engines, scores, bodies, bf42++ statics, the ghost scope -- must agree.
// 2. CASES the recordings do not carry: a four-engine hull, a body, a kit
//    whose object the server destroyed, a pool that reuses a shorter pool's
//    first id, bf42++ statics, a round restart's flags.
// 3. ROUNDS. Ghost bodies of a grenade and a laid mine from a real session
//    (bf1942-australia, Market Garden, 2026-10-24) through the sidecar's
//    body decoder and ghost writer, and the page's reading of the result.
//
// Run by tests/test_sidecar_join_state.py, which copies the viewer modules and
// live-snapshot.mjs into a temp dir and passes the fixtures and the sidecar
// directory.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { createSidecarState } from './net-sidecar.js';
import { createLiveState } from './live-snapshot.mjs';

const [sidecarDir, ...fixtures] = process.argv.slice(2);
const { BodyDecoder } = await import(pathToFileURL(`${sidecarDir}/body-decoder.mjs`).href);
const { GhostWriter } = await import(pathToFileURL(`${sidecarDir}/ghost-writer.mjs`).href);
const { recordFor } = await import(pathToFileURL(`${sidecarDir}/record.mjs`).href);

const readRows = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const sortMap = (m, f = (v) => v) => [...m].sort((a, b) => (a[0] > b[0] ? 1 : -1)).map(([k, v]) => [k, f(v)]);
const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : x);

/** The state a page holds, as comparable data. What it keeps of an object the
 *  server destroyed or of a player who left is not state a joining page needs,
 *  and a long-running page bounds its round table, so the rounds are compared
 *  over the reference's. */
function view(p, ref = null) {
  const st = p.state;
  const alive = (m) => new Map([...m].filter(([k]) => st.objects.has(k)));
  const pids = new Set([...st.roster.values()].map((r) => r.pid));
  const inRoster = (m) => new Map([...m].filter(([pid]) => pids.has(pid)));
  const refRounds = ref ? ref.state.rounds : null;
  return {
    level: st.level, mod: st.mod, server: st.server, modeFile: st.modeFile, status: st.status,
    nameTags: st.nameTags ?? null,
    roster: sortMap(st.roster, (r) => ({ ...r })),
    control: sortMap(st.control), boarded: sortMap(st.boarded),
    objects: sortMap(st.objects, (o) => ({ tid: o.tid, tmpl: o.tmpl, team: o.team, cls: o.cls, spawnPos: o.spawnPos ?? null })),
    rounds: sortMap(refRounds ? new Map([...st.rounds].filter(([k]) => refRounds.has(k))) : st.rounds),
    xform: sortMap(st.xform, (x) => [r3(x.x), r3(x.y), r3(x.z)]),
    states: sortMap(alive(st.states)),
    hp: sortMap(alive(st.hp)), kitNets: sortMap(inRoster(st.kitNets)),
    kits: [...st.roster.values()].map((r) => [r.pid, st.objects.get(st.kitNets.get(r.pid))?.tmpl || st.kits.get(r.pid) || null]),
    cps: sortMap(st.cps), tickets: st.tickets,
    joints: sortMap(st.joints, (m) => sortMap(m, (j) => ({ name: j.name, q: j.q?.map(r3) }))),
    revs: sortMap(st.revs, (a) => [...a]),
    scores: sortMap(inRoster(st.scores)), spawnWait: sortMap(inRoster(st.spawnWait)),
    result: st.result, roundsWon: st.roundsWon,
    statics: { off: st.statics.off, objects: sortMap(st.statics.objects, (o) => ({ ...o, rev: 0 })) },
    bodies: sortMap(st.bodies), inScope: [...st.inScope].sort((a, b) => a - b),
    mePid: st.mePid,
  };
}

function diff(a, b, path = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => diff(a[k], b[k], `${path}.${k}`));
  }
  const pairs = (v) => Array.isArray(v) && v.every((x) => Array.isArray(x) && x.length === 2);
  if (pairs(a) && pairs(b)) {
    const ma = new Map(a.map(([k, v]) => [JSON.stringify(k), JSON.stringify(v)]));
    const mb = new Map(b.map(([k, v]) => [JSON.stringify(k), JSON.stringify(v)]));
    return [...new Set([...ma.keys(), ...mb.keys()])].filter((k) => ma.get(k) !== mb.get(k))
      .map((k) => `${path}[${k}]: from the start ${ma.get(k)}, joined ${mb.get(k)}`);
  }
  return [`${path}: from the start ${JSON.stringify(a)?.slice(0, 160)}, joined ${JSON.stringify(b)?.slice(0, 160)}`];
}

function joined(L) {
  const late = createSidecarState();
  for (const line of L.liveSnapshot()) late.ingest(JSON.parse(line));
  late.ingest({ k: 'live' });
  return late;
}

/** Feed `rows` to a page from the start and a live snapshot together; at each
 *  cut, join a fresh page from the snapshot and diff the two. */
function equivalence(rows, cuts) {
  const full = createSidecarState();
  const L = createLiveState();
  const out = [];
  let ci = 0;
  const check = (cut) => {
    full.ingest({ k: 'live' });
    const late = joined(L);
    out.push({ cut, diffs: diff(view(full), view(late, full)).slice(0, 20), snapshotRows: L.liveSnapshot().length });
  };
  for (const r of rows) {
    while (ci < cuts.length && (r.t ?? 0) > cuts[ci]) check(cuts[ci++]);
    full.ingest(r);
    L.remember(r);
  }
  while (ci < cuts.length) check(cuts[ci++]);
  return out;
}

const result = { equivalence: {}, cases: {}, rounds: {} };
for (const f of fixtures) {
  const rows = readRows(f);
  const end = rows.reduce((m, r) => (Number.isFinite(r.t) && r.t > m ? r.t : m), 0);
  const cuts = Array.from({ length: 12 }, (_, i) => +(((i + 1) / 13) * end).toFixed(2));
  result.equivalence[f.split('/').pop()] = equivalence(rows, cuts);
}

// --- 2. the cases ---------------------------------------------------------
{
  const base = [
    { k: 'e', t: 0, e: 'serverInfo', mod: 'bf1942' },
    { k: 'e', t: 0, e: 'setLevel', level: 'bf1942/levels/wake/', mode: 'coop.con', nameTags: [100, 300] },
    { k: 'e', t: 1, e: 'createObject', tid: 1976, netId: 529, tmpl: 'B17', pos: [1, 2, 3], rot: [0, 0, 0], cls: 'SimpleObjectNetworkable' },
    { k: 'e', t: 1, e: 'createObject', tid: 1754, netId: 900, tmpl: 'USMarineSoldier', pos: [5, 6, 7], rot: [0, 0, 0] },
    { k: 'e', t: 1, e: 'createObject', tid: 1524, netId: 901, tmpl: 'UsMarine_Assault', pos: [5, 6, 7], rot: [0, 0, 0] },
    { k: 'e', t: 1, e: 'createPlayer', pid: 7, name: 'Bot', team: 2, ai: 1, netId: 400, vehNetId: 900, camNetId: 401, kitNetId: 901 },
    { k: 'e', t: 1, e: 'pickupKit', pid: 7, netId: 901 },
    { k: 'o', t: 1.1, id: 529, tid: 1976, tmpl: 'B17', team: 0, cls: 'SimpleObjectNetworkable' },
    { k: 'o', t: 1.1, id: 900, tid: 1754, tmpl: 'USMarineSoldier', team: 2, cls: 'BFSoldierNetworkable' },
    { k: 'o', t: 1.1, id: 901, tid: 1524, tmpl: 'UsMarine_Assault', team: 0, cls: 'KitNetworkable' },
    { k: 'g', t: 1.2, o: [[529, 0.77, 1, 1, 0, 0], [529, 0.771, 1, 1, 0, 1], [529, 0.629, 1, 1, 0, 2], [529, 0.629, 1, 1, 0, 3]] },
    { k: 'a', t: 1.2, a: [[529, 160]] },
    { k: 's', t: 1.2, tick: 10, o: [[529, 1, 2, 3, 0, 0, 0, 1], [900, 5, 7, 7, 0, 0, 0, 1]] },
    // The B17 leaves this client's scope, its standing damage known.
    { k: 'd', t: 2, id: 529 },
    // The soldier dies on foot: his body lies until the server destroys it.
    { k: 'e', t: 3, e: 'score', kind: 4, pid: 7 },
    { k: 'e', t: 3, e: 'control', pid: 7, netId: 401 },
    // ... and his kit object goes before he picks up another.
    { k: 'e', t: 4, e: 'destroyObject', netId: 901 },
    // A pool of nine, freed and taken by a pool of three at the same first id.
    { k: 'e', t: 5, e: 'projPool', tid: 1281, tmpl: 'ExpPackProjectile', netId: 700, count: 9 },
    { k: 'e', t: 6, e: 'projPool', tid: 1288, tmpl: 'GrenadeAlliesProjectile', netId: 700, count: 3 },
    // bf42++ statics: one made and moved, one made and deleted.
    { k: 'e', t: 7, e: 'createStatic', tid: 55, tmpl: 'Crate', id: 3, pos: [1, 1, 1], rot: [0, 0, 0] },
    { k: 'e', t: 7, e: 'updateStatic', id: 3, action: 'move', value: [2, 2, 2] },
    { k: 'e', t: 7, e: 'createStatic', tid: 55, tmpl: 'Crate', id: 4, pos: [1, 1, 1], rot: [0, 0, 0] },
    { k: 'e', t: 7, e: 'updateStatic', id: 4, action: 'delete' },
    // A capture, then a round restart: the old flag goes with the round.
    { k: 'e', t: 8, e: 'gameStatus', status: 1 },
    { k: 'e', t: 8, e: 'cp', id: 515, team: 1 },
  ];
  const full = createSidecarState();
  const L = createLiveState();
  for (const r of base) { full.ingest(r); L.remember(r); }
  full.ingest({ k: 'live' });
  const late = joined(L);
  const ls = late.state;
  result.cases.beforeRestart = {
    diffs: diff(view(full), view(late, full)),
    revs: ls.revs.get(529) ?? null,
    hp: ls.hp.get(529) ?? null,
    b17Known: ls.objects.get(529)?.cls ?? null,
    b17InScope: ls.inScope.has(529),
    body: ls.bodies.get(7) ?? null,
    kitTmpl: ls.kits.get(7) ?? null,
    pool: [700, 702, 703, 708].map((n) => ls.rounds.get(n)?.tmpl ?? null),
    statics: [...ls.statics.objects.values()].map((o) => ({ id: o.id, pos: o.pos })),
    nameTags: ls.nameTags ?? null,
    cp: ls.cps.get(515) ?? null,
  };
  const restart = [{ k: 'e', t: 9, e: 'gameStatus', status: 3 }, { k: 'e', t: 9.5, e: 'gameStatus', status: 1 }];
  for (const r of restart) { full.ingest(r); L.remember(r); }
  const late2 = joined(L);
  result.cases.afterRestart = { diffs: diff(view(full), view(late2, full)), cp: late2.state.cps.get(515) ?? null };
  // The body goes with its object; a destroyed hull's hit points with it.
  for (const r of [{ k: 'e', t: 12, e: 'destroyObject', netId: 900 }, { k: 'e', t: 12, e: 'destroyObject', netId: 529 },
    { k: 'e', t: 13, e: 'createObject', tid: 1976, netId: 529, tmpl: 'B17', pos: [1, 2, 3], rot: [0, 0, 0], cls: 'SimpleObjectNetworkable' }]) {
    full.ingest(r); L.remember(r);
  }
  const late3 = joined(L);
  result.cases.afterDestroy = {
    diffs: diff(view(full), view(late3, full)),
    body: late3.state.bodies.get(7) ?? null, fullBody: full.state.bodies.get(7) ?? null,
    remadeHp: full.state.hp.get(529) ?? null, remadeRevs: full.state.revs.get(529) ?? null,
  };
}

// --- 3. rounds --------------------------------------------------------------
{
  // GrenadeAlliesProjectile 744, of a pool made before the sidecar joined: the
  // database sent it as a createObject at the origin (ledger J-5). Its first
  // body (mask 0xaf, thrown), a delta, the body whose detonate bool is set
  // (mask 0x0f), and two bodies after it.
  const grenade = [
    { dt: 26.282, tick: 3597, netId: 744, action: 1, bodyBits: 103, hex: 'af8a617007647fb23dfc984242', ref: [1131.39111328125, 35.571128845214844, 1450.50634765625] },
    { dt: 26.338, tick: 3599, netId: 744, action: 1, bodyBits: 95, hex: '03326540095c7fbab222394f', ref: [1131.7349853515625, 35.59949493408203, 1450.2890625] },
    { dt: 29.243, tick: 3686, netId: 744, action: 1, bodyBits: 97, hex: '0f52b6600ce46f7a1aae72eb01', ref: [1136.4642333984375, 35.36172103881836, 1441.0335693359375] },
    { dt: 29.292, tick: 3687, netId: 744, action: 1, bodyBits: 95, hex: '0362b6600c446f2299e70a6d', ref: [1136.4698486328125, 35.36172103881836, 1440.8291015625] },
    { dt: 29.38, tick: 3690, netId: 744, action: 1, bodyBits: 95, hex: '0382b6580cb46d5a96dd7370', ref: [1136.4837646484375, 35.36172103881836, 1440.3231201171875] },
  ];
  // LandmineProjectile 823, laid before the join and created where it lies.
  const mine = [{ dt: 19.036, tick: 3380, netId: 823, action: 1, bodyBits: 151, hex: 'afb8691a121dbf26086d9b79120140c2fc3f22' }];
  const created = [
    { e: 'createObject', tid: 1286, netId: 744, tmpl: 'GrenadeAlliesProjectile', pos: [0, 0, 0], rot: [0, 0, 0] },
    { e: 'createObject', tid: 1323, netId: 823, tmpl: 'LandmineProjectile', pos: [1076.83, 34.42, 1267.21], rot: [-21.91, -0.05, -0.64] },
  ];
  const dec = new BodyDecoder({ tidNames: { 1286: 'GrenadeAlliesProjectile', 1323: 'LandmineProjectile', 1288: 'GrenadeAlliesProjectile' } });
  const rows = [];
  const objInfo = new Map();
  const gw = new GhostWriter({ write: (r) => rows.push(r), objInfo });
  for (const c of created) {
    dec.note(c);
    objInfo.set(c.netId, { tid: c.tid, tmpl: c.tmpl, team: 0 });
    rows.push({ k: 'e', t: 6.885, ...c, cls: dec.classOf(c.netId) });
  }
  dec.note({ e: 'projPool', tid: 1288, netId: 1000, count: 3 });
  for (const r of [...mine, ...grenade].sort((a, b) => a.dt - b.dt)) {
    const rec = { ...r };
    dec.decode(rec);
    gw.block(rec.dt, [rec], rec.tick);
  }
  const page = createSidecarState();
  page.ingest({ k: 'live' });
  const seen = [];
  for (const r of rows) {
    page.ingest(r);
    seen.push({ t: r.t, k: r.k, e: r.e ?? null, drawn: page.roundRows().map((x) => x.id) });
  }
  const det = rows.find((r) => r.e === 'detonate');
  result.rounds = {
    poolClass: dec.classOf(1001),
    createdCls: rows.filter((r) => r.e === 'createObject').map((r) => r.cls),
    samples: rows.filter((r) => r.k === 's').map((r) => [r.t, ...r.o[0].slice(0, 4)]),
    detonate: det ?? null,
    detonations: rows.filter((r) => r.e === 'detonate').length,
    pageRounds: [...page.state.rounds.keys()],
    drawnBeforeBlast: seen.filter((s) => s.t < 29.243).at(-1)?.drawn ?? null,
    drawnAfterBlast: seen.at(-1)?.drawn ?? null,
    events: page.state.events.filter((e) => e.type === 'detonate' || e.type === 'projPool'),
    padSpawns: page.state.events.filter((e) => e.type === 'padSpawn').length,
  };
  // A binocular marker's pool made 0.2 s before this record (Market Garden,
  // 2026-10-24, netId 3157): its first record is a full body at the origin
  // with both bools set. It comes into scope, so the retail client resets
  // it before the detonate test, and Projectile::detonate does nothing for a
  // round already out (0x0831e688): no blast, and no sample of its pool slot.
  {
    const rowsB = [];
    const decB = new BodyDecoder({ tidNames: { 1235: 'BinocularsProjectile' } });
    const gwB = new GhostWriter({ write: (r) => rowsB.push(r), objInfo: new Map() });
    decB.note({ e: 'projPool', tid: 1235, netId: 3157, count: 1 });
    const rec = { dt: 1087.338, tick: 35429, netId: 3157, action: 1, bodyBits: 173, hex: 'ff5db34e1307d42390fffbbfffdb893b9d807f0a700f',
      ref: [1204.2740478515625, 36.226844787597656, 1322.1864013671875] };
    decB.decode(rec);
    gwB.block(rec.dt, [rec], rec.tick);
    result.rounds.spentScopeIn = { body: rec.body ? { reset: rec.body.reset, detonate: rec.body.detonate } : null,
      detonations: rowsB.filter((r) => r.e === 'detonate').length, samples: rowsB.filter((r) => r.k === 's').length };
  }
  // The SetLevel's nametag caps as the sidecar records them.
  result.rounds.setLevel = recordFor({ type: 'SetLevel', levelPath: 'bf1942/levels/wake/', modeFile: 'coop.con', nameTagNear: 100, nameTagScope: 300 });
}

console.log(JSON.stringify(result));
