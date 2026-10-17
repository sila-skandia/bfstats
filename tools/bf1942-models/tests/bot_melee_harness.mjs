// Pins how a bot uses a knife and a bayonet (features/fh-fhsw-open-issues
// FHX-12): the engine has no melee notion of its own, so it is the general
// fire rules applied to a melee weapon's data.
//
//  * `BBFire::calculateUrgency` 0x08563570 scores the target with the weapon
//    of the best `strength[type] / (1 + (20 (shots - hits) + 10) / ammo)`,
//    range playing no part (bot-fire.js `scoreTargets`): Desert Combat's
//    knives (9) every time, vanilla's (1) once nothing else has a round.
//  * The fire plan fires what `choseWeapon` 0x085cf0e0 picks for the
//    target's distance (bot-fire.js `choseWeapon`): the knife inside 1.5 m.
//  * The trigger is the AI weapon's `weaponFire` (`createFirePlan` 0x085ac240
//    builds it on the template's +0x44): XPack1's `No4Bayonet` stabs on
//    `PIAltFire`, so what goes off is the item's `c_PIAltFire` FireArms, its
//    `fireDelay` and cycle, and not the rifle's magazine.
//  * A round flies no further than `velocity x timeToLive`: a knife's 3.3 m.
//  * The FireArms a bot fires is the item's own `c_PIFire` one, not the first
//    in the glb (FHSW's bayonet rifles list the stab first).
//  * The fire plan changes his hands to the weapon (`BAPAChangeWeapon`), so
//    the body the page draws holds the knife it stabs with.
//
// The viewer modules load straight out of `viewer/` through the runner's
// module hooks (`sim/env.mjs`). Run by `tests/test_bot_melee.py`. One JSON
// object on stdout.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadViewerModules, viewerDir, seedMathRandom } from '../sim/env.mjs';
import { syntheticLevel } from '../sim/level.mjs';

const viewer = viewerDir();
const M = await loadViewerModules(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const { fireArmsNodes, fireArmsBarrels, botWeaponData, roundReach } = await imp('bot-barrels.js');
const { scoreTargets, weaponAiOf, choseWeapon } = await imp('bot-fire.js');
const { writeInput, PI } = await imp('bot-aim.js');
const { planFire } = await imp('bot-plans.js');
const { fireTicks, timerTicks } = await imp('gun-cycle.js');
seedMathRandom(5);

const log = console.log;
console.log = () => {};
const out = {};

// --- the glb: which FireArms is which --------------------------------------
//
// FHSW's `M1GarandBay` as exported: the stab (`BayonetM1Garand`, c_PIAltFire,
// five muzzles) is a child of the rifle and comes first in the node list; the
// rifle's own muzzle is its sibling.
{
  const muzzle = (name, index, t) => ({ name, translation: t, extras: { muzzle: { index } } });
  const nodes = [
    muzzle('BayonetM1Garand muzzle 1', 0, [0, 0, 0.5]),
    muzzle('BayonetM1Garand muzzle 2', 1, [0.05, 0, 0.5]),
    muzzle('BayonetM1Garand muzzle 3', 2, [-0.05, 0, 0.5]),
    { name: 'BayonetM1Garand', children: [0, 1, 2], extras: { fireArms: {
      input: 'c_PIAltFire', roundOfFire: 1.51, velocity: 105, magSize: -1, throw: { fireDelay: 0.2 },
      projectile: { template: 'Melee_Bayonet_Projectile', timeToLive: 0.065, material: 405 } } } },
    muzzle('M1GarandBay muzzle 1', 0, [0, 0.1, 0.6]),
    { name: 'M1GarandBay', children: [3, 4], extras: { fireArms: {
      input: 'c_PIFire', roundOfFire: 6, velocity: 855, magSize: 8,
      projectile: { template: '7,62mmProjectile', timeToLive: 1.067, material: 123 } } } },
  ];
  const json = { nodes, extras: { weapon: { roundOfFire: 6, velocity: 855, projectile: '7,62mmProjectile',
                                            magazine: { size: 8, magazines: 7 } } } };
  const firstNode = nodes.findIndex(n => n.extras?.fireArms);
  const at = fireArmsNodes(json, 'M1GarandBay');
  const built = botWeaponData(json, 'M1GarandBay');
  out.glb = {
    firstNodeIsTheStab: nodes[firstNode].name === 'BayonetM1Garand',
    fire: nodes[at.fire]?.name ?? null,
    alt: nodes[at.alt]?.name ?? null,
    rifleBarrels: fireArmsBarrels(json).length,
    stabBarrels: fireArmsBarrels(json, at.alt).length,
    round: built.data.round?.template ?? null,
    reach: +built.data.reach.toFixed(3),
    altName: built.data.alt?.name ?? null,
    altRound: built.data.alt?.round?.template ?? null,
    altReach: +built.data.alt.reach.toFixed(4),
    altDelay: built.data.alt?.fireDelay ?? null,
    altRate: built.data.alt?.roundOfFire ?? null,
    fireArms: built.fireArms?.projectile?.template ?? null,
    // No input word is the primary button; a weapon with one FireArms has
    // no alternate.
    plain: fireArmsNodes({ nodes: [{ name: 'Colt', extras: { fireArms: {} } }] }, 'Colt'),
    knifeReach: +roundReach({ velocity: 50, projectile: { timeToLive: 0.0665 } }).toFixed(4),
    noReach: roundReach({ velocity: 50, projectile: {} }),
  };
}

// --- the choice -------------------------------------------------------------
//
// The weapon each kit's bot picks against an infantryman seen at `d` metres,
// the loadouts' own AI entries.
const STRENGTH = inf => ({ Infantry: inf, LightArmour: 0, HeavyArmour: 0, NavalArmour: 0, Submarine: 0, Air: 0 });
const KITS = {
  // Desert Combat's Iraq_HeavyAssault and vanilla's Assault (loadouts.json).
  dc: [['PKM', 5, 175, 3], ['Browninghipo', 3, 25, 1], ['KnifeAxis', 9, 1.5, 0], ['GrenadeAllies', 2, 20, 5]],
  vanilla: [['Thompson', 4, 100, 0], ['Colt', 2, 60, 0], ['KnifeAllies', 1, 1.5, 0], ['GrenadeAllies', 2, 20, 5]],
};
function choose(kit, { d = 30, ammo = {}, misses = {} } = {}) {
  const weapons = KITS[kit].map(([name, inf, maxRange, minRange]) => weaponAiOf({
    name, strength: STRENGTH(inf), maxRange, minRange, ammo: ammo[name] ?? -1 }));
  const shots = weapons.map(w => misses[w.name] ?? 0);
  const r = scoreTargets({
    spotted: [{ id: 'enemy', pos: [0, 0, d], seen: true, shots, hits: weapons.map(() => 0) }],
    position: [0, 0, 0], weapons, now: 0, typeOf: () => 'Infantry',
  });
  return r.weaponIndex >= 0 ? weapons[r.weaponIndex].name : null;
}
out.choice = {
  dcAt30: choose('dc'),
  dcAt1: choose('dc', { d: 1 }),
  vanillaAt1: choose('vanilla', { d: 1 }),
  vanillaDry: choose('vanilla', { d: 1, ammo: { Thompson: 0, Colt: 0, GrenadeAllies: 0 } }),
  // The engine's own reading of the rounds (`getAmmo`, the weapon's total):
  // a Colt's 32 after two misses scores 2 / (1 + 50/32) = 0.78, under the
  // knife's 1, with the Thompson dry. The page reads unlimited while a
  // weapon has a round (bot-referee.js `magazineTick`, ledger AI-132).
  vanillaRetailMisses: choose('vanilla', { d: 1, ammo: { Thompson: 0, Colt: 32, GrenadeAllies: 0 },
                                            misses: { Colt: 2 } }),
};

// --- the referee: a knife's reach, a bayonet's stab --------------------------

/**
 * Bot `bot_0` with `kit` (AI entries), its fire data, and an enemy standing
 * `d` metres down its aim; the trigger held for `seconds` at 30 Hz.
 */
function fight({ kit, data, d, seconds = 3 }) {
  const L = syntheticLevel(M, { vehicles: false });
  const world = new M.World({ collider: L.collider, extras: L.extras });
  world.addBotPlayer('bot_0', { team: 2, flag: world.flags.find(f => f.team === 2) });
  world.addBotPlayer('bot_1', { team: 1, flag: world.flags.find(f => f.team === 1) });
  world.setPlayerArmor('bot_0', new M.Armor(1000));
  world.setPlayerArmor('bot_1', new M.Armor(1000));
  const bot = new M.BotController({ playerId: 'bot_0', world, weapons: kit });
  for (const [name, fire] of Object.entries(data)) bot.setWeaponData(name, fire);
  const s0 = world.player('bot_0').soldier;
  bot.setPosition(s0.x, s0.y, s0.z);
  bot.aimDeviation = 0;
  const { origin, dir } = bot.aimRay();
  const s1 = world.player('bot_1').soldier;
  // His stand-in body's centre (`BOT_BODY_HEIGHT` above the feet) on the
  // line of the bot's eye.
  s1.spawn(origin[0] + dir[0] * d, origin[1] - 1.0, origin[2] + dir[2] * d);
  // Wherever the ground put him, the bot looks at his centre.
  const c = [s1.x - origin[0], s1.y + 1.0 - origin[1], s1.z - origin[2]];
  bot.pitch = Math.atan2(c[1], Math.hypot(c[0], c[2]));
  const dist = Math.hypot(...c);
  const events = [];
  const referee = M.createBotReferee({
    world: () => world,
    armorFor: () => new M.Armor(1000),
    roundDamage: () => 10,
    onShot: b => events.push(['shot', +referee.clock.toFixed(4), b.weaponAi?.name ?? null]),
    onStab: (b, at, alt) => events.push(['stab', +referee.clock.toFixed(4), alt?.name ?? null]),
    onHit: (b, hit) => events.push(['hit', +referee.clock.toFixed(4), +hit.dist.toFixed(3)]),
  });
  referee.bots.push(bot);
  const dt = 1 / 30;
  for (let i = 0; i < Math.round(seconds * 30); i++) {
    bot.isFiring = true;
    bot.aimDeviation = 0;
    referee.clock += dt;
    referee.fireTick(dt);
  }
  return { bot, events, dist, hp: world.armorOf("bot_1").hitPoints };
}

const KNIFE_AI = { name: 'KnifeAllies', burst: 0, minRange: 0, maxRange: 1.5, weaponFire: 'PIFire', strength: STRENGTH(1) };
const KNIFE_DATA = { roundOfFire: 2.0, fireOnce: true, velocity: 50, projectile: 'KnifeProjectile',
                     magazine: { size: -1, magazines: 4, reloadTime: 1.0 },
                     round: { template: 'KnifeProjectile', timeToLive: 0.0665, material: 210 }, reach: 3.325 };
{
  const near = fight({ kit: [KNIFE_AI], data: { KnifeAllies: KNIFE_DATA }, d: 2 });
  const far = fight({ kit: [KNIFE_AI], data: { KnifeAllies: KNIFE_DATA }, d: 10 });
  // The same swing with no reach in its data: the old 600 m ray.
  const unbounded = fight({ kit: [KNIFE_AI], data: { KnifeAllies: { ...KNIFE_DATA, reach: undefined } }, d: 10 });
  const count = (r, kind) => r.events.filter(e => e[0] === kind).length;
  out.knife = {
    nearSwings: count(near, 'shot'), nearHits: count(near, 'hit'),
    farSwings: count(far, 'shot'), farHits: count(far, 'hit'),
    unboundedHits: count(unbounded, 'hit'),
  };
}

const NO4_AI = { name: 'No4Bayonet', burst: 0, minRange: 0, maxRange: 1.5, weaponFire: 'PIAltFire', strength: STRENGTH(1) };
const NO4_DATA = {
  roundOfFire: 0.37, fireOnce: true, velocity: 1000, projectile: 'no4Projectile',
  magazine: { size: 5, magazines: 5, type: 0, reloadTime: 1.6 },
  round: { template: 'no4Projectile', timeToLive: 1.0, material: 218 }, reach: 1000,
  alt: { name: 'No4BayonetStabFireArm', roundOfFire: 1.3, fireDelay: 0.12, velocity: 50,
         round: { template: 'BayonetProjectile', timeToLive: 0.0665, material: 257 }, reach: 3.325, barrels: [] },
};
{
  const stab = fight({ kit: [NO4_AI], data: { No4Bayonet: NO4_DATA }, d: 2, seconds: 3 });
  const far = fight({ kit: [NO4_AI], data: { No4Bayonet: NO4_DATA }, d: 10, seconds: 3 });
  const stabs = stab.events.filter(e => e[0] === 'stab');
  const hits = stab.events.filter(e => e[0] === 'hit');
  const mag = stab.bot._mags?.get('No4Bayonet');
  // The input word: the right button, not the left.
  stab.bot.isFiring = true;
  stab.bot.weaponIndex = 0;
  writeInput(stab.bot);
  out.bayonet = {
    stabs: stabs.map(e => e[1]), names: [...new Set(stabs.map(e => e[2]))],
    hits: hits.map(e => e[1]),
    shots: stab.events.filter(e => e[0] === 'shot').length,
    rifleRounds: mag ? mag.rounds : null,
    period: +((timerTicks(0.12) + fireTicks(1.3)) / 30).toFixed(4),
    farHits: far.events.filter(e => e[0] === 'hit').length,
    input: { fire: stab.bot.input[PI.Fire], altFire: stab.bot.input[PI.AltFire] },
  };
  // An item whose AI weapon is on the right button with nothing there fires
  // nothing (the engine's press toggles a zoom or does nothing).
  const bare = fight({ kit: [NO4_AI], data: { No4Bayonet: { ...NO4_DATA, alt: undefined } }, d: 2, seconds: 1 });
  out.bayonet.bareEvents = bare.events.length;
}

// --- the plan's weapon (`choseWeapon`) and his hands --------------------------
//
// `BBFire` scores the target with one weapon; the fire plan fires the one
// `choseWeapon` picks for the target's distance, `BBFire`'s counting three
// times, and changes his hands to it.
const DC_KIT = [
  { name: 'PKM', burst: 1, maxRange: 175, minRange: 3, weaponFire: 'PIFire', strength: STRENGTH(5) },
  { name: 'Browninghipo', burst: 0, maxRange: 25, minRange: 1, weaponFire: 'PIFire', strength: STRENGTH(3) },
  { name: 'KnifeAxis', burst: 1, maxRange: 1.5, minRange: 0, weaponFire: 'PIFire', strength: STRENGTH(9) },
  { name: 'GrenadeAllies', burst: 0, maxRange: 20, minRange: 5, weaponFire: 'PIFire', strength: STRENGTH(2) },
];
function planAt(d, kit = DC_KIT, scored = 2) {
  const L = syntheticLevel(M, { vehicles: false });
  const world = new M.World({ collider: L.collider, extras: L.extras });
  world.addBotPlayer('bot_0', { team: 2, flag: world.flags.find(f => f.team === 2) });
  world.addBotPlayer('bot_1', { team: 1, flag: world.flags.find(f => f.team === 1) });
  const bot = new M.BotController({ playerId: 'bot_0', world, weapons: kit });
  const s0 = world.player('bot_0').soldier;
  const s1 = world.player('bot_1').soldier;
  s1.spawn(s0.x, s0.y, s0.z + d);
  bot.setPosition(s0.x, s0.y, s0.z);
  const before = bot.heldWeapon;
  bot.firingTarget = 'bot_1';
  bot.targetPosition = [s1.x, s1.y, s1.z];
  bot.weaponIndex = scored;
  const plan = planFire(bot, 0);
  const fired = bot.weapons[bot.weaponIndex]?.name ?? null;
  // The plan runs on: `BBFire` scores another weapon, the plan keeps its own.
  bot.currentPlan = plan;
  bot.planBehaviour = M.BEHAVIOUR.Fire;
  bot.weaponIndex = bot.weaponIndex === 0 ? 1 : 0;
  planFire(bot, 0.1);
  const kept = bot.weapons[bot.weaponIndex]?.name ?? null;
  const result = {
    before, held: bot.heldWeapon, fired, kept,
    approach: plan.find(a => a.arrive != null)?.arrive ?? null,
  };
  bot.onRespawn();
  result.afterRespawn = bot.heldWeapon;
  return result;
}
out.plan = { at30: planAt(30), at1: planAt(1), at2: planAt(2) };
{
  const ak = [{ name: 'AK47', burst: 1, maxRange: 175, minRange: 0, strength: STRENGTH(5) },
              { name: 'KnifeAxis', burst: 1, maxRange: 1.5, minRange: 0, strength: STRENGTH(9) }].map(weaponAiOf);
  const thompson = [{ name: 'Thompson', maxRange: 100, minRange: 0, strength: STRENGTH(4) },
                    { name: 'Colt', maxRange: 60, minRange: 0, strength: STRENGTH(2) },
                    { name: 'KnifeAllies', maxRange: 1.5, minRange: 0, strength: STRENGTH(1) }].map(weaponAiOf);
  const name = (kit, i) => (i >= 0 ? kit[i].name : null);
  const pair = (a, b) => [{ name: 'A', maxRange: 10, minRange: 0, strength: STRENGTH(a) },
                          { name: 'B', maxRange: 10, minRange: 0, strength: STRENGTH(b) }].map(weaponAiOf);
  out.chose = {
    // Scored with the AK: three times 5 beats the knife's 9.
    akKeepsAk: name(ak, choseWeapon(ak, 0, 1)),
    // Scored with the knife: the knife.
    akKnife: name(ak, choseWeapon(ak, 1, 1)),
    vanilla: name(thompson, choseWeapon(thompson, 0, 1)),
    vanillaDry: name(thompson, choseWeapon(thompson.map((w, i) => (i < 2 ? { ...w, ammo: 0 } : w)), 0, 1)),
    // In range an equal strength goes to the later; out of range to the earlier.
    tieInRange: name(pair(3, 3), choseWeapon(pair(3, 3), -1, 5)),
    tieOutOfRange: name(pair(3, 3), choseWeapon(pair(3, 3), -1, 50)),
    // The ends of the window are out of it.
    atMax: choseWeapon([weaponAiOf({ name: 'C', maxRange: 10, minRange: 0, strength: STRENGTH(1) }),
                        weaponAiOf({ name: 'G', maxRange: 20, minRange: 0, strength: STRENGTH(1) })], -1, 10),
    atMin: choseWeapon([weaponAiOf({ name: 'G', maxRange: 20, minRange: 5, strength: STRENGTH(2) }),
                        weaponAiOf({ name: 'C', maxRange: 60, minRange: 0, strength: STRENGTH(1) })], -1, 5),
    healingSkipped: choseWeapon([weaponAiOf({ name: 'MedPack', maxRange: 2.5, healing: true, strength: STRENGTH(2) })], -1, 1),
    indirectSkipped: choseWeapon([weaponAiOf({ name: 'Mortar', maxRange: 300, minRange: 20, indirect: 1,
                                               strength: STRENGTH(3) })], -1, 100),
    none: choseWeapon([], -1, 1),
  };
}

log(JSON.stringify(out));
