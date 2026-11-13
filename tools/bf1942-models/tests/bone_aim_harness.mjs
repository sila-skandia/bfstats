// Drives the bots' bone aim, the blast's source Armor and the material
// table's fallbacks under node and prints one JSON blob
// (`tests/test_bone_aim.py`).
import * as THREE from 'three';
import { BotSenses, senseBoneIndex, sensedPoint } from './bot-sense.js';
import { aimPoint, execTrigger } from './bot-plans.js';
import { splashDamage } from './projectile-damage.js';
import { soldierFallScalars } from './fall-damage.js';
import { VehicleDamageSet } from './vehicle-damage.js';
import { rigBones } from './rig-capsules.js';

const out = {};

// --- the pick: `pickSoldierRandomSensePosition` 0x085e3d20 -----------------
const COUNT = 67;                      // animations/UsSoldier.ske
const seen = new Set();
for (let i = 0; i < 100000; i++) seen.add(senseBoneIndex(COUNT, i / 100000));
out.pick = {
  distinct: seen.size, min: Math.min(...seen), max: Math.max(...seen),
  first: senseBoneIndex(COUNT, 0), top: senseBoneIndex(COUNT, 0.999999),
  half: senseBoneIndex(COUNT, 0.5), one: senseBoneIndex(1, 0.5), two: senseBoneIndex(2, 0.99),
};

// --- the sense rays and the re-test -----------------------------------------
// A skeleton of five bones, the last never picked; bone 2 the only one a wall
// leaves in sight.
const bones = [[0, 1.0, 0], [0, 1.5, 0], [0.3, 1.2, 0.1], [0, 0.5, 0], [9, 9, 9]];
const target = { id: 't', team: 2, soldier: { x: 10, y: 0, z: 0, yaw: 0, stance: 'stand' } };
let visible = new Set([2]);
// The collider answers by where the line ends: clear only to a visible bone.
const collider = {
  cast(ox, oy, oz, dx, dy, dz, max) {
    const end = [ox + dx * (max + 0.05), oy + dy * (max + 0.05), oz + dz * (max + 0.05)];
    for (const i of visible) {
      const b = live[i];
      if (Math.hypot(end[0] - (target.soldier.x + b[0]), end[1] - (target.soldier.y + b[1]), end[2] - (target.soldier.z + b[2])) < 0.01) return null;
    }
    return { t: max / 2, owner: 99 };
  },
};
let live = bones.map(b => b.slice());
let draws = [0.55, 0.1, 0.9, 0.3];     // -> indices 2, 0, 3, 1 of the 4 pickable
let n = 0;
const senses = new BotSenses({ random: () => draws[n++ % draws.length] });
senses.soldierBones = () => ({ count: live.length, at: i => live[i] });
const eye = [0, 1.6, 0];
const ray = senses._rays(collider, eye, target, [10, 0, 0], 3);   // near: several rays
out.rays = { bone: ray?.bone ?? null, offset: ray?.offset ?? null };
// The hook may answer a plain list, and nothing where no skeleton is posed.
const plain = new BotSenses({ random: () => 0.55 });
plain.soldierBones = () => live;
out.raysList = plain._rays(collider, eye, target, [10, 0, 0], 3)?.bone ?? null;
const none = new BotSenses({ random: () => 0.5 });
out.raysNoHook = none._rays(null, eye, target, [10, 0, 0], 3)?.bone ?? null;

// The re-test: the kept bone where it is now, then one new random bone.
const m = { bone: 2, offset: [0.3, 1.2, 0.1] };
live[2] = [0.4, 0.6, 0.2];             // the arm moved (he crouched)
n = 0;
const kept = senses._retestSoldier(collider, eye, target, [10, 0, 0], m);
out.retestKept = { bone: kept?.bone ?? null, offset: kept?.offset ?? null, draws: n };
visible = new Set([0]);                // the arm is hidden, the root shows
n = 0; draws = [0.1];
const moved = senses._retestSoldier(collider, eye, target, [10, 0, 0], m);
out.retestNew = { bone: moved?.bone ?? null, draws: n };
visible = new Set([3]);
n = 0; draws = [0.1];                  // one new bone only, and it is hidden
out.retestLost = senses._retestSoldier(collider, eye, target, [10, 0, 0], m);

// --- the aim point: `BAPAAimAtObject::getAimVec` 0x0853b820 -----------------
const world = { collider: null, players: new Map([['t', target]]) };
const bot = { world, senses: { memory: new Map([['t', { offset: [0.3, 1.2, 0.1], bone: 2, pos: [10, 0, 0] }]]) } };
out.aim = {
  sensed: aimPoint(bot, 't', target, [10, 0, 0]),
  turned: (() => { const p = { ...target, soldier: { ...target.soldier, yaw: Math.PI / 2 } }; return aimPoint(bot, 't', p, [10, 0, 0]); })(),
  noRecord: aimPoint({ world, senses: { memory: new Map() } }, 't', target, [10, 0, 0]),
  seated: aimPoint(bot, 't', { ...target, occupancy: { root: {} } }, [10, 0, 0]),
  // A stand-in height (no skeleton posed): the stand-in sphere's centre.
  standIn: aimPoint({ world, senses: { memory: new Map([['t', { offset: [0.1, 0.3, 0.2], bone: null }]]) } }, 't', target, [10, 0, 0]),
  same: sensedPoint(null, { offset: [0.3, 1.2, 0.1] }, target, -1),
};

// A hull: its origin while that is in sight (the record's point is the zero
// vector), else the point of its collision mesh that saw it, through the
// hull's live matrix; a hull the collider holds no triangles of keeps the
// stand-in metre.
{
  const tris = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]);
  const moved = new Map([[5, { fwd: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 10, 50, 1] }]]);
  const hullWorld = { collider: { statics: { owners: Int32Array.from([5]), tris }, moved }, players: new Map() };
  const crew = { id: 'h', team: 2, occupancy: { root: {} }, position: [100, 10, 50] };
  const gunner = (rec, owner = 5) => ({ world: hullWorld, senses: { memory: new Map(rec ? [['h', rec]] : []), unitOwnerOf: () => owner } });
  out.hullAim = {
    origin: aimPoint(gunner({ local: null }), 'h', crew, [100, 10, 50]),
    meshPoint: aimPoint(gunner({ local: [1, 0.5, -2] }), 'h', crew, [100, 10, 50]),
    noRecord: aimPoint(gunner(null), 'h', crew, [100, 10, 50]),
    standIn: aimPoint(gunner({ local: null }, 9), 'h', crew, [100, 10, 50]),
  };
  // The re-test puts the record back on the origin when the origin shows.
  const s2 = new BotSenses({ random: () => 0.5 });
  const rec = { local: [1, 0.5, -2] };
  out.hullAim.retest = [s2._retestHull(null, [0, 0, 0], crew, [100, 10, 50], rec, 5), rec.local];
}

// The trigger's line test goes to the same point (`execTrigger`): a wall that
// hides a metre over his feet does not hold the fire of a bot that sees, and
// aims at, his head.
{
  const eyeAt = [0, 1.6, 0];
  const lines = [];
  const head = [10.3, 1.2, 0.1];
  const want = { yaw: Math.atan2(head[0] - eyeAt[0], head[2] - eyeAt[2]), pitch: Math.atan2(head[1] - eyeAt[1], Math.hypot(head[0] - eyeAt[0], head[2] - eyeAt[2])) };
  const shooter = {
    world, senses: bot.senses, vehicle: null, weapons: [{ name: 'w', burst: true }], weaponIndex: 0, weaponData: {},
    holdFire: false, isFiring: false, yaw: want.yaw, pitch: want.pitch, playerId: 's', _aiTicks: 0,
    _aimReference: () => ({ yaw: want.yaw, pitch: want.pitch }), _aimOrigin: () => eyeAt, _eye: () => eyeAt,
    _lineClear: (from, to) => { lines.push(to.map(v => +v.toFixed(3))); return true; },
  };
  const action = { targetId: 't', targetPos: [10, 0, 0], tolerance: 0.05 };
  for (let i = 0; i < 400 && !lines.length; i++) { shooter._aiTicks = i; execTrigger(shooter, action, i / 30); }
  out.triggerLine = { to: lines[0] ?? null, fired: shooter.isFiring };
}

// --- the drawn rig's bones (`rig-capsules.js` `rigBones`) --------------------
{
  const scene = new THREE.Scene();
  const rig = new THREE.Group();
  scene.add(rig);
  rig.position.set(100, 5, 50);
  const mk = (name, parent, x, y, z, joint = true) => {
    const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z);
    if (joint) o.userData.joint = true;
    parent.add(o); return o;
  };
  const root = mk('Bip01', rig, 0, 1, 0);
  const head = mk('Bip01 Head', root, 0, 0.6, 0);
  mk('helmet', head, 0, 0.1, 0, false);                 // a graft: not a bone
  mk('HipPack', root, 0, 0, -0.2);
  const soldier = { x: 100, y: 5, z: 50, yaw: 0 };
  const b = rigBones(rig, soldier);
  out.rig = { count: b.count, head: b.at(1).map(v => +v.toFixed(4)), last: b.at(2).map(v => +v.toFixed(4)),
              detached: rigBones(new THREE.Group(), soldier) };
  // Turned a quarter: the frame is the soldier's, so the offset turns back.
  const q = rigBones(rig, { ...soldier, yaw: Math.PI / 2 });
  out.rig.turned = q.at(2).map(v => +v.toFixed(4));
}

// --- the material table: `MaterialManager::getDamageMod` 0x08175040 ----------
const materials = {
  0: { attGroup: 0, defGroup: 0, damage: 30 },
  60: { attGroup: 60, defGroup: 60, damage: 1 },
  90: { attGroup: 90, defGroup: 90, damage: 1 },
  202: { attGroup: 202, defGroup: 202, damage: 100 },
  224: { attGroup: 224, defGroup: 224, damage: 7 },
};
const modifiers = { 202: { 0: 0.5, 60: 2 }, 0: { 60: 0.25, 0: 0.1 }, 224: { 60: 1.75 } };
out.cells = {
  listed: splashDamage(202, 60, 0, 10, materials, modifiers),
  // A defined material with no cell: nothing (`defaultDamageMod` is 0.0).
  noCell: splashDamage(202, 90, 0, 10, materials, modifiers),
  // A victim material the table does not define is read as material 0.
  victimUndefined: splashDamage(202, 77, 0, 10, materials, modifiers),
  // So is an explosion material: material 0's damage and attack group.
  attackerUndefined: splashDamage(131, 60, 0, 10, materials, modifiers),
  // No material at all is our own gap, not material 0.
  noMaterial: splashDamage(null, 60, 0, 10, materials, modifiers),
  falloff: splashDamage(202, 60, 5, 10, materials, modifiers),
  fallUndefinedGround: soldierFallScalars({ materials, modifiers: { 0: { 0: 0.1, 40: 0.001 } } }, 33, 40),
};

// --- the blast's source Armor: the struck object's (HP-9g) -------------------
{
  const armor = hp => ({ hp, destroyed: false, splashMaterial: 60, damage(a) { const l = Math.min(this.hp, a); this.hp -= l; return l; } });
  const run = record => {
    const set = new VehicleDamageSet();
    const firerHull = armor(1000), struckHull = armor(1000), man = armor(1000), other = armor(1000);
    set.byOwner.set(7, firerHull); set.byOwner.set(8, struckHull);
    const targets = [
      { owner: 7, x: 1, y: 0, z: 0 }, { owner: 8, x: 0, y: 0, z: 1 },
      { owner: -1, armor: man, soldier: true, playerId: 'm', splashMaterial: 60, x: 0, y: 0, z: 2 },
      { owner: -1, armor: other, soldier: true, playerId: 'o', splashMaterial: 60, x: 2, y: 0, z: 0 },
    ];
    set.applySplash({ point: [0, 0, 0], splashRadius: 10, splashMaterial2: 202, ...record }, targets, { materials, modifiers });
    return { firerHull: firerHull.hp < 1000, struckHull: struckHull.hp < 1000, man: man.hp < 1000, other: other.hp < 1000 };
  };
  out.source = {
    hullStruck: run({ owner: 8, firer: 7 }),
    soldierStruck: run({ owner: -1, target: 'm', firer: 7 }),
    groundStruck: run({ owner: -1, firer: 7 }),
    ownHullStruck: run({ owner: 7, firer: 7 }),
    endOfLife: run({ owner: -1, firer: -1 }),
  };
}

process.stdout.write(JSON.stringify(out));
