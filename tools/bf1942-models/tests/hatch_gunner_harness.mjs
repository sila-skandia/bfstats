// A tank's hatch gunner can be shot (browser-play feedback #6, 2026-11-06:
// "sometimes you can't kill the machinegun guy on the tank"), driven outside a
// browser through the page's own modules.
//
// Every seat that reaches a SeatObject keeps its soldier in the round's
// contact test (`SeatObject::enter` lnxded 0x083208d0 never sets object flag
// bit 0), the half-body ones (`c_SeatShowHalfBodySoldier`, every tank's hatch
// MG) as much as a jeep's; only a seat with none, a tank's driver, does
// (`PlayerControlObject::enter` 0x08316f00 sets it, 0x08317372). The half
// body hides the legs (`setUseSeat` 0x08271950, `disableBoneTree("Bip01
// Pelvis")`) and keeps the torso out of the hatch.
//
// What is real here: `seat-ik.js` (the flags), `seat-body.js` (the seated body,
// `hideBelowPelvis`, the stand-in while loading), `rig-capsules.js` and
// `skeleton-hit.js` (the capsules), `bot-visuals.js` (`seatedBodyAt`,
// `capsulesOf`), `seat-pose.js` (the human's own seat), `bot-referee.js`
// (a bot's round) and `vehicle-hits.js` (`roundBodyCast`, every gunfire.js
// round the human fires). What is synthetic: the soldier skeleton (vanilla
// UsSoldier.ske's hierarchy, a seated pose at the SeatObject) and the hull.
// One JSON blob on stdout; run by `tests/test_hatch_gunner.py`.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, { createSeatBodies, hideBelowPelvis }, { createBotVisuals }, { createSeatPose }, { BOT_BODY_HEIGHT, createBotReferee },
  { createVehicleHits }, { Armor }] = await Promise.all([
  imp('vendor/three.module.js'), imp('seat-body.js'), imp('bot-visuals.js'), imp('seat-pose.js'),
  imp('bot-referee.js'), imp('vehicle-hits.js'), imp('armor.js'),
]);

/** Vanilla `CommonSoldierData.inc`'s eight `setSkeletonCollisionBone` lines. */
const COLLISION_BONES = [
  { bone: 'Bip01_Head', distSq: 0.02, stretch: 2, material: 40 },
  { bone: 'Bip01_Spine2', distSq: 0.08, stretch: -0.45, material: 41 },
  { bone: 'Bip01_L_Forearm', distSq: 0.02, stretch: 0, material: 42 },
  { bone: 'Bip01_R_Forearm', distSq: 0.02, stretch: 0, material: 42 },
  { bone: 'Bip01_L_Calf', distSq: 0.03, stretch: 0.3, material: 42 },
  { bone: 'Bip01_R_Calf', distSq: 0.03, stretch: 0.3, material: 42 },
  { bone: 'Bip01_L_Foot', distSq: 0.035, stretch: 0, material: 42 },
  { bone: 'Bip01_R_Foot', distSq: 0.035, stretch: 0, material: 42 },
];

/** Seat flags as the vanilla `.con` files declare them (objects.rfa). */
const SEATS = {
  'Chi-ha_BrowningSeat': ['c_SeatShowHalfBodySoldier', 'c_SeatIsOutside'],
  ShermanBrowningSeat: ['c_SeatShowHalfBodySoldier', 'c_SeatIsOutside'],
  PanzerIVBrowningSeat: ['c_SeatShowHalfBodySoldier', 'c_SeatIsOutside'],
  HanomagMG42Seat: ['c_SeatShowStandingSoldier', 'c_SeatIsOutside'],
  WillySeat: ['c_SeatShowFullBodySoldier', 'c_SeatIsOutside'],
};
/** A tank's driving position: EntryPoints, a Camera, no SeatObject. */
const DRIVER = 'ShermanDriver';

// The hull: a turret whose roof is at y = 2 and whose front face is at z = 1;
// the hatch, and the SeatObject in it, at (0, 2, 0). The shooter stands at
// z = 20 and fires down -z, so a round meets the turret face at t = 19 and
// the gunner, about the origin, at t of about 20.
const SEAT_AT = new THREE.Vector3(0, 2, 0);
const HULL_FACE_T = 19;
const SHOOTER_Z = 20;

/** A seated soldier on vanilla UsSoldier.ske's hierarchy -- the pelvis holds
 *  only the legs, the spine hangs off `Spine Root` beside it -- in a sitting
 *  pose: the root on the seat, thighs forward, calves down. */
function seatedSoldier() {
  const scene = new THREE.Group();
  const bone = (name, parent, x, y, z) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    parent.add(b);
    return b;
  };
  const root = bone('Bip01', scene, 0, 0, 0);
  const pelvis = bone('Bip01 Pelvis', root, 0, 0, 0);
  for (const [side, x] of [['L', 0.1], ['R', -0.1]]) {
    const thigh = bone(`Bip01 ${side} Thigh`, pelvis, x, 0, 0);
    const calf = bone(`Bip01 ${side} Calf`, thigh, 0, 0, -0.45);
    const foot = bone(`Bip01 ${side} Foot`, calf, 0, -0.45, 0);
    bone(`Bip01 ${side} Toe0`, foot, 0, 0, -0.1);
  }
  const spineRoot = bone('Spine Root', root, 0, 0.05, 0);
  const spine = bone('Bip01 Spine', spineRoot, 0, 0.1, 0);
  const spine1 = bone('Bip01 Spine1', spine, 0, 0.1, 0);
  const spine2 = bone('Bip01 Spine2', spine1, 0, 0.15, 0);
  const spine3 = bone('Bip01 Spine3', spine2, 0, 0.1, 0);
  const neck = bone('Bip01 Neck', spine3, 0, 0.1, 0);
  bone('Bip01 Head', neck, 0, 0.1, 0);
  for (const [side, x] of [['L', 0.15], ['R', -0.15]]) {
    const clav = bone(`Bip01 ${side} Clavicle`, neck, x, -0.05, 0);
    const upper = bone(`Bip01 ${side} UpperArm`, clav, 0.05, -0.05, 0);
    const fore = bone(`Bip01 ${side} Forearm`, upper, 0, -0.1, 0.25);
    bone(`Bip01 ${side} Hand`, fore, 0, 0, 0.25);
  }
  return scene;
}

function seatOf(name) {
  const hull = new THREE.Group();
  hull.name = `${name}-hull`;
  const node = new THREE.Object3D();
  node.name = name;
  hull.add(node);
  if (name === DRIVER) return { hull, seat: { node, seatObjects: [] } };
  const anchor = new THREE.Object3D();
  anchor.name = name;
  anchor.position.copy(SEAT_AT);
  anchor.userData.seat = { flags: SEATS[name] };
  hull.add(anchor);
  return { hull, seat: { node, seatObjects: [anchor] } };
}

const world3d = new THREE.Scene();
const bodiesRoot = new THREE.Group();
world3d.add(bodiesRoot);
const seatBodies = createSeatBodies({
  pose: async () => ({ scene: seatedSoldier(), animations: [] }),
  parent: bodiesRoot,
  dispose() {},
});

/** One scenario: a shooter on foot at z = 20 and the gunner in `name`. */
async function scenario(name, { loaded = true } = {}) {
  const { hull, seat } = seatOf(name);
  world3d.add(hull);
  hull.updateMatrixWorld(true);
  const players = new Map([
    ['shooter', { team: 1, soldier: { x: 0, y: 0, z: SHOOTER_Z }, armor: new Armor(100) }],
    ['gunner', { team: 2, occupancy: { root: hull }, armor: new Armor(100) }],
  ]);
  const world = {
    players, player: id => players.get(id) ?? null, armorOf: id => players.get(id)?.armor ?? null,
    collider: null,
  };
  const page = {
    vehicles: { seatOf: id => (id === 'gunner' ? { seatId: 1, rootId: 0, seatInfo: () => seat } : null) },
    soldierBody: { collisionBones: COLLISION_BONES },
    scene: world3d, bindDynamicShading() {}, disposeFootBodyScene() {},
  };
  const bots = createBotVisuals(page);
  const sb = loaded ? await seatBodies.load('USSoldier', seat, { rootId: 0 }) : null;
  if (sb) {
    sb.scene.visible = true;
    seatBodies.step(sb, 0, BOT_BODY_HEIGHT);
  }
  bots.botVisuals.set('gunner', { bot: { playerId: 'gunner', vehicle: { root: hull } }, seat: sb, group: new THREE.Group() });
  const referee = createBotReferee({
    world: () => world, groundAt: () => 0, armorFor: () => new Armor(100), roundDamage: () => 40,
    seatedBodyAt: id => bots.seatedBodyAt(id), capsulesOf: id => bots.capsulesOf(id),
  });
  return { hull, seat, sb, bots, referee, world, players };
}

/** A bot on foot at z = 20 firing down -z at height `y`. */
function botShot(referee, y) {
  const bot = { playerId: 'shooter', aimDeviation: 0, aimRay: () => ({ origin: [0, y, SHOOTER_Z], dir: [0, 0, -1] }) };
  const hit = referee.resolveShot(bot, 40);
  return hit ? { target: hit.targetId, damage: hit.damage } : null;
}

/** The human's round (`vehicle-hits.js` `roundBodyCast`, what every
 *  gunfire.js round asks): down -z at height `y`, out to `maxDist` -- the hull
 *  face's `t` where the collider met it first. */
function humanRound(s, y, maxDist) {
  const local = 'local';
  s.players.set(local, { team: 1, soldier: { x: 0, y: 0, z: SHOOTER_Z } });
  const gun = { firer: local };
  const hits = createVehicleHits({
    LOCAL_PLAYER: local, world: s.world,
    vehicles: { firerOf: group => group?.firer ?? null, instanceOf: () => null },
    bodyAt: id => s.referee.bodyAt(id), capsulesOf: id => s.referee.capsulesOf(id),
    soldierDead: false, optOnFoot: { checked: true }, optPilot: { checked: false }, soldier: null,
    damageVisuals: new Map(), guns: { materials: {}, modifiers: {} }, camera: { position: { toArray: () => [0, 0, 0] } },
  });
  const met = hits.roundBodyCast(0, y, SHOOTER_Z, 0, 0, -1, maxDist, gun);
  s.players.delete(local);
  return met ? { target: met.target, material: met.material, bone: met.bone, seated: met.seated, t: +met.t.toFixed(3) } : null;
}

const capsuleBones = caps => (caps ?? []).map(c => c.bone);

const out = { seats: {}, loading: {}, human: {} };

// --- a bot's gunner, his seat drawn ---------------------------------------------------

for (const name of [...Object.keys(SEATS), DRIVER]) {
  const s = await scenario(name);
  out.seats[name] = {
    drawn: s.sb !== null,
    halfBody: s.sb?.halfBody ?? null,
    body: s.bots.seatedBodyAt('gunner'),
    capsules: capsuleBones(s.bots.capsulesOf('gunner')),
    // A bot's rifle round at his chest (2.45 is Spine2).
    botChest: botShot(s.referee, 2.45),
    // The human's rounds: at his chest and his head with nothing in between;
    // at his chest with the turret face nearer (the collider met it first);
    // and one just under the chest capsule's reach, nothing in the way, which
    // only a leg capsule could meet -- on a half body, one the scale has
    // collapsed onto the pelvis at the hatch rim.
    humanChest: humanRound(s, 2.45, 40),
    humanHead: humanRound(s, 2.92, 40),
    humanChestBehindHull: humanRound(s, 2.45, HULL_FACE_T),
    humanBelowTorso: humanRound(s, 1.88, 40),
  };
  if (s.sb?.halfBody) {
    // The same round, were the hidden legs' capsules kept: a ball round his
    // waist (`hideBelowPelvis` leaves them out; this is why).
    const hidden = s.sb.scene.userData.hiddenBones;
    delete s.sb.scene.userData.hiddenBones;
    out.seats[name].legsKeptBelowTorso = humanRound(s, 1.88, 40);
    s.sb.scene.userData.hiddenBones = hidden;
  }
}

// --- his seat's body still loading ------------------------------------------------------

for (const name of ['ShermanBrowningSeat', DRIVER]) {
  const s = await scenario(name, { loaded: false });
  out.loading[name] = {
    body: s.bots.seatedBodyAt('gunner'),
    capsules: s.bots.capsulesOf('gunner'),
    botChest: botShot(s.referee, 2.45),
  };
}

// --- the human in a hatch, shot by a bot ---------------------------------------------

for (const loaded of [true, false]) {
  const { hull, seat } = seatOf('ShermanBrowningSeat');
  world3d.add(hull);
  hull.updateMatrixWorld(true);
  const page = {
    optPilot: { checked: true }, occupancy: { activeSeatId: 1, rootId: 0, seatInfo: () => seat },
    soldierBody: { collisionBones: COLLISION_BONES }, scene: world3d, view: { inside: false },
    MODELS_BASE: 'models', bust: () => '', bindDynamicShading() {},
  };
  const seatPose = createSeatPose(page);
  if (loaded) {
    // What `loadSeatPose` leaves for this seat: the half body, on the anchor.
    const body = seatedSoldier();
    hideBelowPelvis(body);
    body.position.copy(SEAT_AT);
    world3d.add(body);
    seatPose.seatSoldier = body;
    seatPose.seatHalfBody = true;
    seatPose.seatPoseTarget = seat.seatObjects[0];
  }
  const players = new Map([
    ['shooter', { team: 1, soldier: { x: 0, y: 0, z: SHOOTER_Z }, armor: new Armor(100) }],
    ['local', { team: 2, occupancy: { root: hull }, armor: new Armor(100) }],
  ]);
  const world = { players, player: id => players.get(id) ?? null, armorOf: id => players.get(id)?.armor ?? null, collider: null };
  const referee = createBotReferee({
    world: () => world, groundAt: () => 0, armorFor: () => new Armor(100), roundDamage: () => 40,
    seatedBodyAt: id => (id === 'local' ? seatPose.seatedBody() : undefined),
    capsulesOf: id => (id === 'local' ? seatPose.seatCapsules() : null),
  });
  out.human[loaded ? 'drawn' : 'loading'] = {
    body: seatPose.seatedBody(),
    capsules: capsuleBones(seatPose.seatCapsules()),
    botChest: botShot(referee, 2.45),
  };
  if (seatPose.seatSoldier) world3d.remove(seatPose.seatSoldier);
}

const round = v => (v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'number' ? +x.toFixed(3) : x]))
  : v);
for (const group of Object.values(out)) for (const row of Object.values(group)) row.body = round(row.body);

console.log(JSON.stringify(out));
