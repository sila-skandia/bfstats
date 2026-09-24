// Damage parity (ledger DMG-3, DMG-4), driven outside a browser: what one
// round costs a soldier, and the angle term a round pays on a hull.
//
//   - a bot's hand-weapon round (`vehicle-hits.js botRoundDamage`): the struck
//     material's price, the round's falloff over the distance it flew, and the
//     stand-in body priced as the torso;
//   - the referee's `resolveShot` handing that price the material and the
//     distance it met;
//   - the runner's copy of the law on the synthetic level (`sim/level.mjs`);
//   - the direct hit's angle term (`round-impact.js impact`): the struck
//     object's own `angleMod`, the template's 0 where it authors none.
//
// The prices are vanilla's `_shared/damage.json` rows and the rounds the
// weapon glbs' `fireArms.projectile` blocks carry (2026-09-24). Modules load
// through the runner's hooks (`sim/env.mjs`), so `three` is the vendored
// build. One JSON blob on stdout; run by `tests/test_damage_parity.py`.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadViewerModules, viewerDir } from '../sim/env.mjs';
import { syntheticLevel } from '../sim/level.mjs';

const viewer = viewerDir();
const M = await loadViewerModules(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [{ createVehicleHits }, { impact }, { BOT_BODY_HEIGHT, BOT_BODY_RADIUS, BOT_BODY_MATERIAL, createBotReferee },
  { Armor }] = await Promise.all([
  imp('vehicle-hits.js'), imp('round-impact.js'), imp('bot-referee.js'), imp('armor.js'),
]);

const out = {};
const round4 = v => (v == null ? v : Math.round(v * 1e4) / 1e4);

// --- the tables: vanilla's rows for the three rounds ---------------------------------

const MATERIALS = {
  214: { attGroup: 214, defGroup: 214, damage: 5 },   // coltProjectile
  216: { attGroup: 216, defGroup: 216, damage: 5 },   // ThomsonProjectile
  219: { attGroup: 219, defGroup: 219, damage: 5 },   // k98Projectile
  40: { attGroup: 40, defGroup: 40, damage: 10 },     // head
  41: { attGroup: 41, defGroup: 41, damage: 10 },     // chest
  42: { attGroup: 42, defGroup: 42, damage: 10 },     // limbs
};
const MODIFIERS = {
  214: { 40: 3.5, 41: 2, 42: 1 },
  216: { 40: 3, 41: 1.8, 42: 1 },
  219: { 40: 10, 41: 4, 42: 2 },
};
const PROJECTILES = { coltprojectile: { material: 214 }, thomsonprojectile: { material: 216 },
                      k98projectile: { material: 219 } };
/** `GunFire.attackerMaterial`: the spec's own material, else the table's. */
const attackerMaterial = spec => (Number.isFinite(spec?.material) ? spec.material
  : PROJECTILES[String(spec?.template ?? '').toLowerCase()]?.material ?? null);

// A bot's weapon data as map.html's `botWeaponData` hands it over: the weapon
// block (the template name) and the round's own spec beside it.
const WEAPON = {
  Colt: { projectile: 'coltProjectile',
          round: { template: 'coltProjectile', material: 214,
                   damage: { minDamage: 0.5, distToStartLoseDamage: 20, distToMinDamage: 40 } } },
  Thompson: { projectile: 'ThomsonProjectile',
              round: { template: 'ThomsonProjectile', material: 216,
                       damage: { minDamage: 0.5, distToStartLoseDamage: 40, distToMinDamage: 80 } } },
  K98: { projectile: 'k98Projectile',
         round: { template: 'k98Projectile', material: 219, damage: { hasCollisionEffect: true } } },
};

// --- the page's law: vehicle-hits.js botRoundDamage ----------------------------------------

const visuals = new Map([
  [1, { node: { userData: { physics: { angleMod: 1 } } } }],   // an aircraft
  [2, { node: { userData: { physics: { mass: 30000 } } } }],   // a tank: none authored
  [3, { node: { userData: {} } }],                              // a static
]);
const hits = createVehicleHits({
  LOCAL_PLAYER: 'local',
  guns: { materials: MATERIALS, modifiers: MODIFIERS, attackerMaterial },
  damageVisuals: visuals,
  vehicles: { firerOf: () => null, instanceOf: () => null },
  world: null,
  bots: [],
});
const price = (weapon, material, distance) => round4(hits.botRoundDamage(weapon, material, distance));
out.price = {
  standIn: BOT_BODY_MATERIAL,
  colt: {
    head10: price(WEAPON.Colt, 40, 10), chest10: price(WEAPON.Colt, 41, 10), limb10: price(WEAPON.Colt, 42, 10),
    chest20: price(WEAPON.Colt, 41, 20), chest30: price(WEAPON.Colt, 41, 30),
    chest40: price(WEAPON.Colt, 41, 40), chest60: price(WEAPON.Colt, 41, 60),
    head60: price(WEAPON.Colt, 40, 60),
    // No material and no distance: the stand-in, at the muzzle.
    unnamed: round4(hits.botRoundDamage(WEAPON.Colt)),
    // Only the template name (a weapon whose glb carries no round): the
    // table's material, and no falloff to apply.
    templateOnly60: price({ projectile: 'coltProjectile' }, 41, 60),
  },
  thompson: {
    chest30: price(WEAPON.Thompson, 41, 30), chest60: price(WEAPON.Thompson, 41, 60),
    chest100: price(WEAPON.Thompson, 41, 100), head60: price(WEAPON.Thompson, 40, 60),
  },
  k98: {
    head150: price(WEAPON.K98, 40, 150), chest150: price(WEAPON.K98, 41, 150), limb150: price(WEAPON.K98, 42, 150),
  },
};
out.angleModOf = { aircraft: hits.angleModOf(1), tank: hits.angleModOf(2), placed: hits.angleModOf(3),
                   unknown: hits.angleModOf(99) };

// --- the referee: what resolveShot hands the price ---------------------------------------

function worldOf(entries) {
  const players = new Map(entries);
  return { players, player: id => players.get(id) ?? null,
           armorOf: id => players.get(id)?.armor ?? null, collider: null };
}
/** One round down +z at chest height; `capsules` is the target's, if drawn. */
function shotAt(z, capsules = null) {
  const world = worldOf([['shooter', { team: 2 }], ['foe', { team: 1, soldier: { x: 0, y: 0, z } }]]);
  const referee = createBotReferee({
    world: () => world, groundAt: () => 0, armorFor: () => new Armor(30),
    roundDamage: () => 99, capsulesOf: id => (id === 'foe' ? capsules : null),
  });
  const bot = { playerId: 'shooter', aimDeviation: 0,
                aimRay: () => ({ origin: [0, BOT_BODY_HEIGHT, 0], dir: [0, 0, 1] }) };
  const asked = [];
  const hit = referee.resolveShot(bot, 99, null, (material, distance) => {
    asked.push([material, round4(distance)]);
    return hits.botRoundDamage(WEAPON.Colt, material, distance);
  });
  return { asked: asked.at(-1) ?? null, damage: round4(hit?.damage ?? null), material: hit?.material ?? null };
}
const headAt = z => [{ bone: 'Bip01 Head', material: 40, distSq: 0.02,
                       a: [0, BOT_BODY_HEIGHT - 0.1, z], b: [0, BOT_BODY_HEIGHT + 0.1, z] }];
out.referee = {
  radius: BOT_BODY_RADIUS,
  standIn10: shotAt(10),
  standIn30: shotAt(30),
  head30: shotAt(30, headAt(30)),
};

// --- the runner's law on the synthetic level (sim/level.mjs) -------------------------------

{
  const L = syntheticLevel(M, { vehicles: false });
  const colt = L.weaponFire('Colt');
  const thompson = L.weaponFire('Thompson');
  const k98 = L.weaponFire('K98');
  const at = (fire, material, distance) => round4(L.roundDamage(fire, material, distance));
  out.synthetic = {
    coltUnnamed: round4(L.roundDamage(colt)), coltHead10: at(colt, 40, 10), coltChest30: at(colt, 41, 30),
    coltChest60: at(colt, 41, 60), coltLimb10: at(colt, 42, 10),
    thompsonChest60: at(thompson, 41, 60), k98Unnamed: round4(L.roundDamage(k98)), k98Head150: at(k98, 40, 150),
  };
}

// --- the angle term: round-impact.js impact ------------------------------------------------

/**
 * One round of material 200 (100 HP against material 50, modifier 1) meeting
 * a face whose normal is +z, `deg` off square. `angleModOf` answers for
 * owners 1 (an aircraft, angleMod 1) and 2 (a tank, none); `hook: false` is
 * the model browser, which installs none.
 */
function landed({ deg, kind = 'object', owner = 2, hook = true, angleMod = undefined }) {
  const guns = {
    attackerMaterial: () => 200,
    materials: { 200: { attGroup: 200, defGroup: 200, damage: 100 }, 50: { attGroup: 50, defGroup: 50 } },
    modifiers: { 200: { 50: 1 } },
    damageEffects: null, effects: null, impactMarkers: false, hits: [],
    angleModOf: hook ? o => (angleMod !== undefined ? angleMod : hits.angleModOf(o)) : undefined,
  };
  const a = deg * Math.PI / 180;
  const v = { x: 400 * Math.sin(a), y: 0, z: -400 * Math.cos(a) };
  v.length = () => Math.hypot(v.x, v.y, v.z);
  impact(guns, { node: { name: 'gun' }, owner: 9 }, { template: 'x' },
         { kind, owner, material: 50, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 1, t: 10 }, v, 10);
  const record = guns.hits[0];
  return { incidence: round4(record.incidence), damage: round4(record.damage) };
}
out.angle = {
  tankSquare: landed({ deg: 0 }),
  tank60: landed({ deg: 60 }),
  tankGraze: landed({ deg: 90 }),
  aircraft60: landed({ deg: 60, owner: 1 }),
  soldier60: landed({ deg: 60, kind: 'soldier', owner: -1 }),
  placed60: landed({ deg: 60, owner: 3 }),
  browser60: landed({ deg: 60, hook: false }),
  half60: landed({ deg: 60, angleMod: 0.5 }),
};

console.log(JSON.stringify(out));
