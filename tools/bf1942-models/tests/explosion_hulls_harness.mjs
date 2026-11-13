// A blast on hulls (gap audit 2026-11-12 entries 2, 3 and 30), driven outside
// a browser: the push law on a hull (`knockback.js` `objectBlastAcceleration`,
// `blastPushPoint`; KNOCK-4, KNOCK-5), a destroyed Armor's own blast
// (`vehicle-damage.js` `armorExplosion` / `deathBlastRecord`; `Armor::status`
// 0x081739e0), and the seated crew a blast splashes as soldiers (HFD-12), on
// both paths that run them: the page's (`vehicle-hits.js`, which the headless
// runner shares) and the room server's (`server/room-hits.mjs`). One JSON
// blob on stdout; run by `tests/test_explosion_hulls.py`.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [kb, vd, { createVehicleHits }, { Armor }] = await Promise.all([
  imp('knockback.js'), imp('vehicle-damage.js'), imp('vehicle-hits.js'), imp('armor.js'),
]);
const { createRoomHits } = await import(
  pathToFileURL(path.join(viewer, '..', 'server', 'room-hits.mjs')).href);

const round = (v, n = 6) => Math.round(v * 10 ** n) / 10 ** n;
const vec = a => [round(a.x), round(a.y), round(a.z)];
const out = {};

// --- the law ------------------------------------------------------------------

const IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const law = extra => {
  const a = kb.objectBlastAcceleration({ force: 150, radius: 8, distance: 4,
    offset: [4, 0, 0], axes: IDENTITY, forceMod: 13, forceMax: 300, ...extra });
  return { a: vec(a), force: round(a.force) };
};
out.law = {
  // A Sherman (`explosionForceMod 13`) 4 m off a dying Sherman's blast
  // (`explosionForce` 150, radius 8): 13 * 150 / 8 = 243.75, under 300; no
  // distance falloff (KNOCK-4), along normalize(s^ + its right row).
  sherman: law(),
  // A Willy (20): 375, held to the constructor's 300.
  willy: law({ forceMod: 20 }),
  // Twice as far: the same force (no falloff), nothing past the radius.
  far: law({ distance: 7.9, offset: [7.9, 0, 0] }),
  past: law({ distance: 8, offset: [8, 0, 0] }),
  // A diagonal blast on a hull turned 90 degrees: the row most along s.
  turned: law({ offset: [3, 0, 1], distance: Math.hypot(3, 1),
                axes: [[0, 0, -1], [0, 1, 0], [1, 0, 0]] }),
  // Under it: the up row.
  under: law({ offset: [0.5, 2, 0], distance: Math.hypot(0.5, 2) }),
  // On it (its own death blast, d = 0): the terrain's normal.
  onIt: law({ distance: 0, offset: [0, 0, 0], terrainNormal: { x: 0, y: 1, z: 0 } }),
  // No soldier rise and no half-radius cut: a hull 6 m off is pushed.
  noCut: law({ distance: 6, offset: [6, 0, 0] }),
};
out.point = {
  // Outside the 3 m sphere: pulled onto it.
  outside: kb.blastPushPoint([10, 0, 0], [0, 0, 0], 3).map(v => round(v)),
  // Inside: the blast's own point.
  inside: kb.blastPushPoint([1, 1, 0], [0, 0, 0], 3).map(v => round(v)),
};

// --- the words ------------------------------------------------------------------

const ARMORS = {
  sherman: { explosionRadius: 8, explosionDamage: 5, explosionForceMod: 13 },
  willy: { explosionRadius: 8, explosionDamage: 5, explosionForceMod: 20 },
  daihatsu: { explosionForceMod: 20 },
  elco80raft: { explosionRadius: 0, explosionDamage: 0, explosionForce: 0, explosionForceMod: 0 },
};
const tables = {
  armors: ARMORS,
  // Vanilla's MaterialManager rows the blast reads (`Game.rfa`): material 204
  // against soldiers (40) 12, against armour (50) 3.5, a jeep (45) 3.
  materials: { 204: { attGroup: 204, defGroup: 204, damage: 20 }, 40: { defGroup: 40 },
               45: { defGroup: 45 }, 50: { defGroup: 50 } },
  modifiers: { 204: { 40: 12, 45: 3, 50: 3.5 } },
};
out.words = {
  sherman: vd.armorExplosion(tables, 'Sherman'),
  daihatsu: vd.armorExplosion(tables, 'Daihatsu'),
  raft: vd.deathBlastRecord(vd.armorExplosion(tables, 'Elco80Raft'), [0, 0, 0]),
  noArmor: vd.armorExplosion(tables, 'Palm'),
  oldTree: vd.armorExplosion({ materials: {} }, 'Sherman'),
  shermanRecord: vd.deathBlastRecord(vd.armorExplosion(tables, 'Sherman'), [1, 2, 3]),
};

// --- the page -------------------------------------------------------------------

/** A body that records what it is handed. */
const fakeBody = (pos, radius) => ({
  pos: [...pos], axes: IDENTITY.map(r => [...r]), boundingRadius: radius, woke: 0, pushes: [],
  wake() { this.woke++; },
  addAccelerationAt(p, a) { this.pushes.push({ p: p.map(v => round(v)), a: a.map(v => round(v)) }); },
});
const nodeAt = (x, y, z) => ({
  userData: {},
  getWorldPosition(v) { v.set(x, y, z); return v; },
  getWorldQuaternion(q) { q.set(0, 0, 0, 1); return q; },
});

/**
 * Four hulls: a Sherman (owner 1) that dies at the origin, a Willy 3 m off
 * (2) that its blast kills, a Daihatsu 6 m back (3) whose open seat holds a
 * bot, a Sherman 12 m off (4) out of reach, plus a bot on foot 4 m off.
 */
function scene() {
  const set = new vd.VehicleDamageSet();
  const add = (owner, template, hp, material) => {
    const v = set.add(owner, { hitpoints: hp, maxHitpoints: hp, splashMaterial: material },
                      { name: template });
    v.template = template;
    return v;
  };
  const hulls = {
    tank: add(1, 'Sherman', 1, 50),
    jeep: add(2, 'Willy', 9, 45),
    boat: add(3, 'Daihatsu', 150, 45),
    far: add(4, 'Sherman', 100, 50),
  };
  const at = { 1: [0, 0, 0], 2: [3, 0, 0], 3: [0, 0, -6], 4: [12, 0, 0] };
  const bodies = new Map([[1, fakeBody(at[1], 3)], [2, fakeBody(at[2], 2)],
                          [3, fakeBody(at[3], 5)], [4, fakeBody(at[4], 3)]]);
  const players = new Map([
    ['footBot', { team: 2, soldier: { x: 0, y: -1, z: 4, pose: 1 }, armor: new Armor(30) }],
    ['crewBot', { team: 2, soldier: { pose: 0 }, armor: new Armor(30) }],
    ['driverBot', { team: 2, soldier: { pose: 0 }, armor: new Armor(30) }],
  ]);
  return { set, hulls, at, bodies, players };
}

function pageRun() {
  const { set, hulls, at, bodies, players } = scene();
  const damageVisuals = new Map(Object.entries(at).map(([o, p]) => [Number(o), { node: nodeAt(...p) }]));
  // The boat's passenger seat reaches a SeatObject; the far tank's driver's
  // does not (SEAT-37): he is neither splashed nor drawn.
  const boatSeat = { seatObjects: [nodeAt(0, 1, -6)] };
  const tankSeat = { seatObjects: [] };
  const instances = new Map([
    ['boat', { seats: new Map([['passenger', 'crewBot']]), occupancy: { seatInfo: () => boatSeat } }],
    ['far', { seats: new Map([['driver', 'driverBot']]), occupancy: { seatInfo: () => tankSeat } }],
  ]);
  const landed = [];
  const wrecked = [];
  const world = {
    players, player: id => players.get(id) ?? null, armorOf: id => players.get(id)?.armor ?? null,
    damageTables: tables,
    bodyWorld: { get: owner => (bodies.has(owner) ? { parked: { body: bodies.get(owner) } } : null) },
  };
  const page = {
    LOCAL_PLAYER: 'local',
    vehicles: { instances, firerOf: () => null, instanceOf: () => null },
    damageVisuals, vehicleDamage: set, world,
    bots: [{ playerId: 'footBot', team: 2, vehicle: null }],
    bodyAt: () => null, capsulesOf: () => null,
    soldier: null, soldierArmor: null, soldierDead: false,
    optOnFoot: { checked: false }, optPilot: { checked: false },
    guns: { materials: tables.materials, modifiers: tables.modifiers },
    camera: { position: { toArray: () => [0, 0, 0] } },
    collider: null,
    applyDamage() {}, applyDamageToPlayer() {},
    damageLanded: (id, lost, attacker) => landed.push({ id, lost: round(lost, 4), attacker }),
    showDamageTier() {}, wreckVehicle: v => wrecked.push(v.owner), raiseHitIndication() {},
  };
  const hits = createVehicleHits(page);
  // A round of player p1's kills the tank: its death blast follows.
  hits.applyVehicleHit({ kind: 'object', owner: 1, damage: 5, stamp: { firer: 'p1' } });
  const hp = Object.fromEntries(Object.entries(hulls).map(([k, v]) => [k, round(v.hitPoints, 4)]));
  return {
    wrecked, landed, hp,
    jeepKiller: hulls.jeep.lastHitPlayer,
    footBot: round(players.get('footBot').armor.hitPoints, 4),
    crewBot: round(players.get('crewBot').armor.hitPoints, 4),
    driverBot: round(players.get('driverBot').armor.hitPoints, 4),
    pushes: Object.fromEntries([...bodies].map(([o, b]) => [o, { woke: b.woke, pushes: b.pushes }])),
  };
}
out.page = pageRun();

// The same tank killed on a tree published before the `armors` table: no
// blast, nothing pushed (the page does not guess).
out.pageOldTree = (() => {
  const saved = tables.armors;
  delete tables.armors;
  try { return pageRun(); } finally { tables.armors = saved; }
})();

// --- the room server --------------------------------------------------------------

function roomRun() {
  const { set, hulls, at, bodies, players } = scene();
  const boatSeat = { seatObjects: [{ matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, -6, 1] } }] };
  const tankSeat = { seatObjects: [] };
  players.get('crewBot').occupancy = { activeSeatId: 'p', seatInfo: () => boatSeat, root: null };
  players.get('driverBot').occupancy = { activeSeatId: 'd', seatInfo: () => tankSeat, root: null };
  const world = {
    players, player: id => players.get(id) ?? null, vehicleDamage: set,
    bodyWorld: { get: owner => (bodies.has(owner) ? { parked: { body: bodies.get(owner) } } : null) },
    vehiclePose: owner => (at[owner] ? { x: at[owner][0], y: at[owner][1], z: at[owner][2] } : null),
    reconcile(vehicle) {
      const r = vehicle.update(0);
      return { vehicle, changed: r.changed, tier: r.tier, died: r.died };
    },
  };
  const rows = [];
  const room = {
    instance: { world, ownerRoots: new Map(), table: [], ownerToEntry: new Map(), collider: null,
                ownerOf: () => null },
    levelData: { damageTables: tables, name: 'x' },
    authority: { dead: new Set(), mayInput: () => true },
  };
  const hits = createRoomHits({ room, onRow: r => rows.push(r) });
  // The tank dies on the world's damage pass (a round's hit landed between
  // ticks); the tick hands the step to `deathBlasts` before `hullDeaths`.
  hulls.tank.damage(5, 7);
  const step = { damage: [] };
  for (const v of set.values()) {
    const r = v.update(0);
    if (r.died) step.damage.push({ vehicle: v, changed: r.changed, tier: r.tier, died: r.died });
  }
  const blasts = hits.deathBlasts(step);
  return {
    blasts,
    died: step.damage.map(c => c.vehicle.owner),
    hp: Object.fromEntries(Object.entries(hulls).map(([k, v]) => [k, round(v.hitPoints, 4)])),
    footBot: round(players.get('footBot').armor.hitPoints, 4),
    footBotLastHit: players.get('footBot').armor.lastHit ?? null,
    crewBot: round(players.get('crewBot').armor.hitPoints, 4),
    driverBot: round(players.get('driverBot').armor.hitPoints, 4),
    pushes: Object.fromEntries([...bodies].map(([o, b]) => [o, { woke: b.woke, pushes: b.pushes }])),
  };
}
out.room = roomRun();

process.stdout.write(JSON.stringify(out));
