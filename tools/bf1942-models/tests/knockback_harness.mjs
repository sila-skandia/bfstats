// A blast's push and the flight it throws a soldier into (`viewer/knockback.js`,
// ledger KNOCK-1..KNOCK-8), driven outside a browser: the law on its own, a
// real `Soldier` body on flat ground thrown and landed, and the page's own
// splash path (`vehicle-hits.js` `applyVehicleHit`) pushing a bot and the
// human with a vanilla and a Desert Combat soldier template at the same blast.
// The modules are imported from the viewer tree in place through the runner's
// hooks (`sim/env.mjs`). One JSON blob on stdout; run by
// `tests/test_knockback.py`.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [kb, { Soldier }, { createVehicleHits }, { VehicleDamageSet }, { Armor }, locomotion,
  { GRAVITY }] = await Promise.all([
  imp('knockback.js'), imp('soldier.js'), imp('vehicle-hits.js'), imp('vehicle-damage.js'),
  imp('armor.js'), imp('soldier-locomotion.js'), imp('point-body.js'),
]);
const { Knockback, soldierBlastAcceleration } = kb;
const ENGINE_TICK = 1 / locomotion.ENGINE_TICK_RATE;

const out = {};
const round = (v, n = 6) => Math.round(v * 10 ** n) / 10 ** n;
const vec = a => [round(a.x), round(a.y), round(a.z)];

// --- the law ------------------------------------------------------------------

// The two soldier templates' own words (`CommonSoldierData.inc`).
const VANILLA = { forceMod: 75, forceMax: 600 };
const DC = { forceMod: 150, forceMax: 600 };
// A grenade's: radius 15, the constructor's 150, a man 5 m off along +Z
// facing +Z (yaw 0), level with the blast.
const blast = (extra = {}) => ({ force: 150, radius: 15, distance: 5, offset: [0, 0, 5],
                                 yaw: 0, ...extra });
const push = (template, extra) => {
  const a = soldierBlastAcceleration({ ...blast(extra), ...template });
  return { a: vec(a), force: round(a.force), dv: round(a.force * ENGINE_TICK) };
};
out.law = {
  // Under the ceiling (a standing man is at most half seen, HP-10; a quarter
  // here): Desert Combat's push is twice vanilla's, along the same line.
  quarterVanilla: push(VANILLA, { exposure: 0.25 }),
  quarterDc: push(DC, { exposure: 0.25 }),
  // Fully seen: 750 and 1500 both held to `explosionForceMax` 600.
  fullVanilla: push(VANILLA, { exposure: 1 }),
  fullDc: push(DC, { exposure: 1 }),
  // Standing's best (0.5): vanilla 375, DC 750 -> 600.
  halfVanilla: push(VANILLA, { exposure: 0.5 }),
  halfDc: push(DC, { exposure: 0.5 }),
  // Past half the radius: priced, stamped, and not pushed at all.
  pastTheCut: push(VANILLA, { distance: 7.6, offset: [0, 0, 7.6] }),
  atTheCut: push(VANILLA, { distance: 7.5, offset: [0, 0, 7.5], exposure: 0.25 }),
  // In water, a tenth.
  inWater: push(VANILLA, { exposure: 0.25, underWater: 0.3 }),
  // Friendly fire's cut of the damage cuts the push: none at 0, half at 0.5.
  friendlyOff: push(VANILLA, { exposure: 0.25, damageRatio: 0 }),
  friendlyHalf: push(VANILLA, { exposure: 0.25, damageRatio: 0.5 }),
  // The template's own defaults: 1.0 and 300.
  defaults: (() => {
    const a = soldierBlastAcceleration(blast({ exposure: 1 }));
    return { force: round(a.force) };
  })(),
  // The direction: his forward row (along +Z here) plus the separation, the
  // rise replaced by (1 - 5/15) * 5.
  rise: round((1 - 5 / 15) * 5),
  // From the side (+X, yaw 0): his right row, signed along the separation.
  side: push(VANILLA, { exposure: 0.25, offset: [5, 0, 0] }),
  // Facing the blast (yaw pi, forward -Z, the blast at -Z of him): the
  // backward row, still away from the blast.
  facing: push(VANILLA, { exposure: 0.25, yaw: Math.PI }),
  // Under him: his up row.
  under: push(VANILLA, { exposure: 0.25, distance: 2, offset: [0.1, 2, 0] }),
  // On top of him: the terrain's normal.
  onTop: (() => {
    const a = soldierBlastAcceleration({ ...blast({ exposure: 0.25 }), distance: 0.0005,
                                         offset: [0, 0.0005, 0], ...VANILLA,
                                         terrainNormal: { x: 0.6, y: 0.8, z: 0 } });
    return vec(a);
  })(),
};

// --- a body, thrown -------------------------------------------------------------

/** Flat ground at y = 0, no hulls. */
const flatWorld = () => ({
  waterLevel: null,
  surfaceHeight: () => 0,
  heightfield: {
    normal: (x, z, o) => { o[0] = 0; o[1] = 1; o[2] = 0; return o; },
    material: () => 4,
    height: () => 0,
  },
});

/** One soldier on his feet at the origin, facing +Z, settled. */
function standing() {
  const s = new Soldier({ collider: flatWorld() });
  s.spawn(0, 0, 0, 0);
  for (let i = 0; i < 30; i++) s.step(1 / 60, {});
  s.body.knockback = new Knockback();
  return s;
}

/**
 * Throw `s` with `a` and run him until his legs are his own again or `seconds`
 * pass, logging the states his legs went through and the flight.
 */
function throwHim(s, a, { ai = false, dead = false, seconds = 8, input = {} } = {}) {
  const v0 = { ...s.body.velocity };
  s.body.blast(a.x, a.y, a.z, { ai });
  const states = [];
  let apex = 0;
  let firstTickDv = null;
  let landedAt = null;
  let landingSpeed = null;
  for (let t = 0, i = 0; t < seconds; i++, t += 1 / 60) {
    s.step(1 / 60, { ...input, dead });
    if (i === 0) {
      const v = s.body.velocity;
      // One body tick's gravity rides in with it.
      firstTickDv = [round(v.x - v0.x, 4), round(v.y - v0.y - GRAVITY / 60, 4),
                     round(v.z - v0.z, 4)];
    }
    apex = Math.max(apex, s.y);
    const family = s.body.knockback.family;
    if (states.at(-1)?.family !== family) states.push({ family, t: round(t, 3) });
    if (s.landing && landedAt === null) {
      landedAt = [round(s.x, 3), round(s.z, 3)];
      landingSpeed = round(s.landing.impactSpeed, 3);
    }
    if (!dead && landedAt && family === null && t > 0.5) break;
  }
  return { states, apex: round(apex, 3), landedAt, landingSpeed, firstTickDv,
           locked: s.body.knockback.locked };
}

/** The push a grenade 5 m behind him (at -Z) gives a template, standing,
 *  a quarter seen: the same blast for both soldiers. */
const behind = template => soldierBlastAcceleration({
  ...blast({ exposure: 0.25 }), ...template });

out.body = {
  // A human (no AI): thrown forward, and straight back on his feet the
  // moment he touches down (KNOCK-8).
  vanillaHuman: throwHim(standing(), behind(VANILLA)),
  dcHuman: throwHim(standing(), behind(DC)),
  // A bot: the survive landing, then the get-up, then his own legs.
  dcBot: throwHim(standing(), behind(DC), { ai: true }),
  // The blast kills him: the dead flight and the landing he holds.
  dcDead: throwHim(standing(), behind(DC), { dead: true, seconds: 4 }),
  // Under the 8 m/s the flight needs: shoved, never thrown.
  weak: throwHim(standing(), { x: 0, y: 0, z: 200 }, { seconds: 1 }),
  // His legs are not his own in the air: holding W does not steer.
  heldForward: (() => {
    const s = standing();
    s.body.blast(0, 450, 300, {});
    s.step(1 / 60, {});
    s.step(1 / 60, {});
    const before = s.body.velocity.z;
    for (let i = 0; i < 20; i++) s.step(1 / 60, { forward: 1 });
    return { family: s.body.knockback.family, before: round(before, 3),
             after: round(s.body.velocity.z, 3) };
  })(),
  // A placed body is a new life: no state, no stamp.
  placedResets: (() => {
    const s = standing();
    s.body.blast(0, 450, 300, {});
    for (let i = 0; i < 5; i++) s.step(1 / 60, {});
    const flying = s.body.knockback.family;
    s.spawn(10, 0, 10, 0);
    return { flying, after: s.body.knockback.family, stamped: s.body.knockback.stamped };
  })(),
  // The state machine alone: a dead flight that meets a wall face first
  // bounces (the wall has taken the speed into it), and the bounce hands over
  // to the opposite flight after its 1 s. A wall met back first out of a
  // forward flight is not a bounce: he flies on.
  bounce: (() => {
    const k = new Knockback();
    k.stamp({});
    k.update({ dt: 1 / 60, dead: true, vx: 0, vy: 0, vz: 12, yaw: 0 });
    const flew = k.family;
    k.update({ dt: 1 / 60, dead: true, vx: 0, vy: -1, vz: 0, yaw: 0,
               contact: { x: 0, y: 0, z: -1 } });
    const hit = k.family;
    k.update({ dt: 1.01, dead: true, vx: 0, vy: -1, vz: 0, yaw: 0 });
    const then = k.family;
    const k2 = new Knockback();
    k2.stamp({});
    k2.update({ dt: 1 / 60, dead: true, vx: 0, vy: 0, vz: 12, yaw: 0 });
    k2.update({ dt: 1 / 60, dead: true, vx: 0, vy: -1, vz: 0, yaw: 0,
                contact: { x: 0, y: 0, z: 1 } });
    // A slope between the two thresholds (0.1 < y < 0.3) neither lands nor
    // bounces him.
    const k3 = new Knockback();
    k3.stamp({});
    k3.update({ dt: 1 / 60, dead: true, vx: 0, vy: 0, vz: 12, yaw: 0 });
    k3.update({ dt: 1 / 60, dead: true, vx: 0, vy: -1, vz: 0, yaw: 0,
                contact: { x: 0, y: 0.2, z: -0.98 } });
    return { flew, hit, then, backFirst: k2.family, slope: k3.family };
  })(),
  // Alive and past the 0.2 s window: not thrown, however fast.
  lateWindow: (() => {
    const k = new Knockback();
    k.stamp({});
    k.update({ dt: 0.25, vx: 0, vy: 20, vz: 0, yaw: 0 });
    return k.family;
  })(),
  // Under an open canopy: never thrown.
  canopy: (() => {
    const k = new Knockback();
    k.stamp({});
    k.update({ dt: 1 / 60, vx: 0, vy: 20, vz: 0, yaw: 0, canopy: true });
    return k.family;
  })(),
};

// --- the page: vehicle-hits.js ---------------------------------------------------

const LOCAL = 'local';
const BOT = 'bot';

/** A page with the human and one bot on foot, both 5 m from the blast. */
function pageOf(soldierBody) {
  const human = standing();
  human.spawn(0, 0, 5, 0);
  for (let i = 0; i < 30; i++) human.step(1 / 60, {});
  const bot = standing();
  bot.spawn(5, 0, 0, 0);
  for (let i = 0; i < 30; i++) bot.step(1 / 60, {});
  const humanArmor = new Armor(30);
  const botArmor = new Armor(30);
  const players = new Map([
    [LOCAL, { id: LOCAL, team: 1, soldier: human, armor: humanArmor }],
    [BOT, { id: BOT, team: 2, soldier: bot, armor: botArmor }],
  ]);
  const world = {
    players, player: id => players.get(id) ?? null,
    armorOf: id => players.get(id)?.armor ?? null, collider: null,
  };
  const landed = [];
  const page = {
    LOCAL_PLAYER: LOCAL,
    vehicles: { firerOf: () => null, instanceOf: () => null },
    damageVisuals: new Map(),
    vehicleDamage: new VehicleDamageSet(),
    world,
    bots: [{ playerId: BOT, team: 2, vehicle: null, getPosition: () => [bot.x, bot.y, bot.z] }],
    bodyAt: () => null, capsulesOf: () => null,
    soldier: human, soldierArmor: humanArmor, soldierDead: false,
    soldierBody,
    soldierTemplateFor: ({ team }) => (team === 1 ? 'USSoldier' : 'IraqSoldier'),
    optOnFoot: { checked: true }, optPilot: { checked: false },
    guns: {
      // A blast of material 205 does 4 HP at its centre to a soldier (40).
      materials: { 205: { attGroup: 205, defGroup: 205, damage: 4 }, 40: { defGroup: 40 } },
      modifiers: { 205: { 40: 1 } },
    },
    camera: { position: { toArray: () => [0, 0, 0] } },
    collider: null,
    applyDamage() {}, applyDamageToPlayer() {},
    damageLanded: (id, lost) => landed.push({ id, lost }),
    showDamageTier() {}, wreckVehicle() {}, raiseHitIndication() {},
  };
  return { hits: createVehicleHits(page), human, bot, landed };
}

/** One grenade at the origin, through the page's own splash pass, and one
 *  world tick (two body ticks) after it. `force` is the round's
 *  `forceOnExplosion`; 30 keeps both templates under the 600 ceiling. */
function pageBlast(soldierBody, force) {
  const { hits, human, bot } = pageOf(soldierBody);
  hits.applyVehicleHit({
    splashPoint: [0, 0, 0], splashRadius: 15, splashMaterial2: 205, splashYMod: 1,
    splashForce: force, firer: -1,
  });
  const out = {};
  for (const [name, s] of [['human', human], ['bot', bot]]) {
    const v0 = { ...s.body.velocity };
    s.step(1 / 60, {});
    const v = s.body.velocity;
    out[name] = {
      dv: [round(v.x - v0.x, 4), round(v.y - v0.y - GRAVITY / 60, 4), round(v.z - v0.z, 4)],
      ai: s.body.knockback?.ai ?? null,
      stamped: s.body.knockback?.stamped ?? false,
    };
  }
  return out;
}

// The same tree twice but for the soldier's own words: vanilla's
// `soldierBody`, then Desert Combat's (KNOCK-7, S8). The top level is the
// tree's first soldier; `templates` each one's.
const vanillaBody = { template: 'BritishSoldier', explosionForceMod: 75, explosionForceMax: 600,
                      templates: { USSoldier: { explosionForceMod: 75, explosionForceMax: 600 } } };
const dcBody = { template: 'BritishSoldier', explosionForceMod: 150, explosionForceMax: 600,
                 templates: { USSoldier: { explosionForceMod: 150, explosionForceMax: 600 },
                              IraqSoldier: { explosionForceMod: 150, explosionForceMax: 600 } } };
out.page = {
  vanilla: pageBlast(vanillaBody, 30),
  dc: pageBlast(dcBody, 30),
  // A tree published before `soldierBody` carried the words: vanilla's.
  noWords: pageBlast({ template: 'BritishSoldier' }, 30),
  // A round that declares none: the constructor's 150.
  vanillaDefaultForce: pageBlast(vanillaBody, null),
};

process.stdout.write(JSON.stringify(out));

