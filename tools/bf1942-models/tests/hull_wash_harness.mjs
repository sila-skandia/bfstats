// Drives `viewer/vehicle-hits.js`'s share of the red damage wash outside a
// browser and prints one JSON blob: when the hull the local player sits in
// takes damage, the octant and alpha `_giveDamage` gives him (ledger HFD-10,
// HFD-11, HFD-13). The modules are imported from the viewer tree in place
// through the headless runner's hooks (`sim/env.mjs`, which resolve `three`
// to the vendored build), as `hit_indication_harness.mjs` imports them, so
// the file under test is the file the page loads.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, { createVehicleHits }, { VehicleDamageSet }] = await Promise.all([
  import('three'), imp('vehicle-hits.js'), imp('vehicle-damage.js'),
]);

const LOCAL = 'local';

/** A Sherman's Armor block: 100 HP, burning from 12 at 1.5 a second. */
const SHERMAN = {
  hitpoints: 100, maxHitpoints: 100, criticalDamage: 12,
  hpLostWhileCriticalDamage: 1.5, splashMaterial: 50, effects: [],
};
/** `damage.json`'s shape: a tank shell's splash (236) against a hull (50). */
const TABLES = {
  materials: {
    236: { attGroup: 236, defGroup: 236, damage: 10 },
    50: { attGroup: 50, defGroup: 50, damage: 0 },
  },
  modifiers: { 236: { 50: 2 } },
};

/** A hull's root node at `at`, turned by `yaw` about +y and then pitched by
 *  `pitch` about its own +x: -z is its nose, +x its right, as the exporter
 *  leaves every vehicle. */
function hullNode(at, { yaw = 0, pitch = 0 } = {}) {
  const node = new THREE.Object3D();
  node.position.set(at[0], at[1], at[2]);
  node.rotation.set(pitch, yaw, 0, 'YXZ');
  node.updateMatrixWorld(true);
  return node;
}

/** The page stub. `hulls` maps a collider owner to its root node; the local
 *  player sits in `seatedIn` (a node), or in nothing. */
function makePage({ hulls, seatedIn = null, seats = new Map(), bots = [], players = new Map() }) {
  const washes = [];
  const toPlayer = [];
  const damage = new VehicleDamageSet();
  const visuals = new Map();
  for (const [owner, node] of hulls) {
    damage.add(owner, SHERMAN, { name: `hull${owner}` });
    visuals.set(owner, { node });
  }
  const page = {
    LOCAL_PLAYER: LOCAL,
    occupancy: seatedIn ? { root: seatedIn } : null,
    triggerHitIndicator: (dir, alpha) => washes.push({ dir, alpha: Number(alpha.toFixed(6)) }),
    vehicles: { firerOf: group => seats.get(group) ?? null, instanceOf: () => null },
    damageVisuals: visuals,
    vehicleDamage: damage,
    world: { players, player: id => players.get(id) ?? null, armorOf: () => null },
    bots,
    bodyAt: () => null,
    capsulesOf: () => null,
    soldier: null,
    soldierArmor: null,
    soldierDead: false,
    optOnFoot: { checked: true },
    optPilot: { checked: false },
    guns: TABLES,
    camera: { position: { toArray: () => [0, 0, 0] } },
    collider: null,
    applyDamage: () => {},
    applyDamageToPlayer: (amount, from) => toPlayer.push({ amount, from }),
    showDamageTier: () => {},
    wreckVehicle: () => {},
    stepWrecks: () => {},
    feedVehicleHud: () => {},
  };
  return { hits: createVehicleHits(page), washes, toPlayer, damage };
}

const P = [100, 0, 50];
/** A round from `from` landing on hull 6 for `damage`. */
const round = (from, damage, extra = {}) => ({
  kind: 'object', owner: 6, damage, firerGroup: {}, point: [P[0], P[1] + 1, P[2]],
  origin: from, ...extra,
});
/** The page's step report, with only what `stepVehicleDamage` reads. */
const stepOf = ({ crashes = [], timedDamage = [] } = {}) => ({ crashes, timedDamage, damage: [] });

const out = { round: {}, splash: {}, crash: {}, timed: {}, onFoot: {} };

// --- a round on the hull he sits in ---------------------------------------------

{
  // The hull at P facing -z: a round fired from 40 m off its right side.
  const node = hullNode(P);
  const { hits, washes } = makePage({ hulls: new Map([[6, node]]), seatedIn: node });
  hits.applyVehicleHit(round([P[0] + 40, 1, P[2]], 30));
  out.round.fromTheRight = washes;
}
{
  // The same shot at the same hull turned to face +x: now it is dead ahead,
  // and one from the other side is dead astern. The hull's frame, not the
  // world's.
  const node = hullNode(P, { yaw: -Math.PI / 2 });
  const { hits, washes } = makePage({ hulls: new Map([[6, node]]), seatedIn: node });
  hits.applyVehicleHit(round([P[0] + 40, 1, P[2]], 30));
  hits.applyVehicleHit(round([P[0] - 40, 1, P[2]], 30));
  out.round.turned = washes.map(w => w.dir);
}
{
  // A hull in a 45-degree dive (an aircraft's root): a source along its nose
  // is its front; one level ahead is 45 degrees up from the nose, the
  // front-right arc (a right dot of exactly 0 is the right).
  const node = hullNode(P, { pitch: -Math.PI / 4 });
  const { hits, washes } = makePage({ hulls: new Map([[6, node]]), seatedIn: node });
  hits.applyVehicleHit(round([P[0], P[1] - 30, P[2] - 30], 10));
  hits.applyVehicleHit(round([P[0], P[1], P[2] - 40], 10));
  out.round.pitched = washes.map(w => w.dir);
}
{
  // A hit on some other hull, and his own hull hit while he is on foot.
  const mine = hullNode(P);
  const other = hullNode([0, 0, 0]);
  const seated = makePage({ hulls: new Map([[6, mine], [7, other]]), seatedIn: mine });
  seated.hits.applyVehicleHit({ ...round([40, 1, 0], 30), owner: 7 });
  out.round.otherHull = seated.washes;
  const walking = makePage({ hulls: new Map([[6, mine]]) });
  walking.hits.applyVehicleHit(round([P[0] + 40, 1, P[2]], 30));
  out.round.notSeated = walking.washes;
}
{
  // A record with no launch point: the wash with no arc.
  const node = hullNode(P);
  const { hits, washes } = makePage({ hulls: new Map([[6, node]]), seatedIn: node });
  hits.applyVehicleHit(round(null, 30));
  out.round.noOrigin = washes;
}
{
  // The alpha divides the round's damage, not the HP it could still take: 60
  // leaves 40, then a 70 kills it and washes at 0.7, and a 90 would have been
  // held to 0.75.
  const node = hullNode(P);
  const { hits, washes, damage } = makePage({ hulls: new Map([[6, node]]), seatedIn: node });
  hits.applyVehicleHit(round([P[0], 1, P[2] - 40], 60));
  hits.applyVehicleHit(round([P[0], 1, P[2] - 40], 70));
  out.round.killing = { washes, hp: damage.get(6).hitPoints };
  const capped = makePage({ hulls: new Map([[6, node]]), seatedIn: node });
  capped.hits.applyVehicleHit(round([P[0], 1, P[2] - 40], 90));
  out.round.capped = capped.washes;
  // A wreck takes no `_giveDamage`, so no wash.
  hits.applyVehicleHit(round([P[0], 1, P[2] - 40], 30));
  out.round.onTheWreck = washes.length;
}

// --- a blast beside it ------------------------------------------------------------

{
  // An end-of-life blast 4 m behind the hull (+z is astern): the arc points
  // at the blast's centre and the alpha is the splash's share.
  const node = hullNode(P);
  const { hits, washes, damage } = makePage({ hulls: new Map([[6, node]]), seatedIn: node });
  hits.applyVehicleHit({
    kind: 'endOfLife', owner: -1, firer: -1, damage: null, firerGroup: {},
    blast: 'endOfLife', splashMaterial2: 236, splashRadius: 12, splashYMod: 1,
    point: [P[0], P[1] + 0.5, P[2] + 4],
  });
  out.splash.behind = { washes, lost: 100 - damage.get(6).hitPoints };
}

// --- the world's own damage: crashes and the Armor's clocks -------------------------

{
  const node = hullNode(P);
  const { hits, washes } = makePage({ hulls: new Map([[6, node]]), seatedIn: node });
  const crash = (extra) => ({
    owner: 6, other: null, damage: 22.5, kill: false, water: false, lost: 22.5,
    at: [P[0] + 5, P[1] - 1, P[2]], ...extra,
  });
  // Against another object: the world origin, which lies ahead and to the
  // left of a hull at (100, 0, 50) facing -z.
  hits.stepVehicleDamage(stepOf({ crashes: [crash({ other: 9 })] }), 1 / 60);
  // Against the ground: the contact point, here off its right side.
  hits.stepVehicleDamage(stepOf({ crashes: [crash()] }), 1 / 60);
  // Against water: the world origin again.
  hits.stepVehicleDamage(stepOf({ crashes: [crash({ water: true })] }), 1 / 60);
  // The kill material: 1e10, held to 0.75, from a point nobody has read.
  hits.stepVehicleDamage(stepOf({ crashes: [crash({ kill: true, damage: 1e10 })] }), 1 / 60);
  out.crash.kinds = washes.splice(0);
  // A hull already dead took nothing, and another hull's crash is not his.
  hits.stepVehicleDamage(stepOf({ crashes: [crash({ lost: 0 })] }), 1 / 60);
  hits.stepVehicleDamage(stepOf({ crashes: [crash({ owner: 7 })] }), 1 / 60);
  out.crash.ignored = washes.length;
}
{
  // A burning hull: the real clock, one 1.5 HP tick a second, each a wash
  // at 0.015 pointing at the world origin.
  const node = hullNode(P);
  const { hits, washes, damage } = makePage({ hulls: new Map([[6, node]]), seatedIn: node });
  damage.get(6).damage(90);
  const ticks = [];
  damage.update(1.0, { ticks });
  out.timed.ticks = ticks.map(t => ({ owner: t.owner, amount: t.amount }));
  hits.stepVehicleDamage(stepOf({ timedDamage: ticks }), 1 / 60);
  out.timed.washes = washes;
}

// --- a round on the local player himself, on foot -------------------------------------

{
  // His arc points at the record's launch point when it has one, and at the
  // firer's gun as it stands now when it does not.
  const botGroup = {};
  const bot = { playerId: 'b3', getPosition: () => [1, 1, 1],
                aimRay: () => ({ origin: [9, 9, 9], dir: [0, 0, 1] }), recordHit() {} };
  const players = new Map([[LOCAL, { team: 2 }], ['b3', { team: 1 }]]);
  const { hits, toPlayer } = makePage({
    hulls: new Map(), seats: new Map([[botGroup, 'b3']]), bots: [bot], players,
  });
  const soldierRound = extra => ({ kind: 'soldier', target: LOCAL, owner: -1, damage: 20,
                                   firerGroup: botGroup, seated: false, ...extra });
  hits.applyVehicleHit(soldierRound({ origin: [5, 1.5, 7] }));
  hits.applyVehicleHit(soldierRound({}));
  out.onFoot = toPlayer.map(c => c.from);
}

console.log(JSON.stringify(out));
