// Pins the bots' hand weapons (features/bot-weapons): the magazine made from
// the weapon's fire data and never before it (bot-referee.js `magazineOf`),
// the reload, a held trigger's rate on whole ticks (GUN-13), the round flown by
// the caller instead of resolved (`env.launchRound`), a full kit on respawn,
// the fire plan's empty-magazine end, which rounds are flown (bot-rounds.js
// `launchesDrawnRound`), and whose damage a bot's flown round is
// (vehicle-hits.js), and the heat hold (bot-plans.js `heatHolds`) on a seat's
// MG and a hand MG.
//
// The viewer modules load straight out of `viewer/` through the runner's
// module hooks (`sim/env.mjs`). Run by `tests/test_bot_weapons.py`. One JSON
// object on stdout.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadViewerModules, viewerDir, seedMathRandom } from '../sim/env.mjs';
import { syntheticLevel } from '../sim/level.mjs';

const viewer = viewerDir();
const M = await loadViewerModules(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const { firePlanDone, PLAN_ACTION, heatHolds } = await imp('bot-plans.js');
const { FireState } = await imp('fire-state.js');
const { firePeriod } = await imp('gun-cycle.js');
const { fireArmsHeat } = await imp('bot-barrels.js');
const { botDeviate, deviationPoint, deviationIndex, declaredBarrels, footInputIndex, botInputIndex, SEAT_INPUT_INDEX } = await imp('bot-deviation.js');
const { launchesDrawnRound } = await imp('bot-rounds.js');
const { createVehicleHits } = await imp('vehicle-hits.js');
seedMathRandom(3);

const log = console.log;
console.log = () => {};

// The weapons' own values (`_shared/loadouts.json` aiWeapons, the glbs'
// `extras.weapon`).
const AI = {
  Bazooka: { burst: 0, maxRange: 100, minRange: 0, weaponFire: 'PIFire',
             strength: { Infantry: 2, LightArmour: 3, HeavyArmour: 2, NavalArmour: 0, Submarine: 0, Air: 1 } },
  Colt: { burst: 0, maxRange: 60, minRange: 0, weaponFire: 'PIFire',
          strength: { Infantry: 2, LightArmour: 0, HeavyArmour: 0, NavalArmour: 0, Submarine: 0, Air: 0 } },
  Thompson: { burst: 1, maxRange: 100, minRange: 0, weaponFire: 'PIFire',
              strength: { Infantry: 4, LightArmour: 0, HeavyArmour: 0, NavalArmour: 0, Submarine: 0, Air: 0 } },
  Mp40: { burst: 1, maxRange: 100, minRange: 0, weaponFire: 'PIFire',
          strength: { Infantry: 4, LightArmour: 0, HeavyArmour: 0, NavalArmour: 0, Submarine: 0, Air: 0 } },
  Remington: { burst: 0, maxRange: 50, minRange: 0, weaponFire: 'PIFire',
               strength: { Infantry: 4, LightArmour: 0, HeavyArmour: 0, NavalArmour: 0, Submarine: 0, Air: 0 } },
  M249: { burst: 1, maxRange: 100, minRange: 0, weaponFire: 'PIFire',
          strength: { Infantry: 4, LightArmour: 0, HeavyArmour: 0, NavalArmour: 0, Submarine: 0, Air: 0 } },
};
// DC's Remington: eight barrels at the FireArms' origin, each turned (the
// glb's `Remington muzzle N` rotations, quaternions x, y, z, w).
const REMINGTON_BARRELS = [
  [0.006980844947881171, -0.01090782567168717, 7.615222607486751e-05, 0.9999161371553956],
  [0.0061085562410720514, -0.004363227875173742, 2.6653773887783413e-05, 0.9999718231393999],
  [-0.010908040613928303, 0.003054139725216969, 3.331681774275032e-05, 0.9999358408270469],
  [-0.002268912257765743, -0.0034906424302308145, -7.920030035121748e-06, 0.9999913336573792],
  [-0.008726519415937776, 0.0019197878953759835, 1.6753735149245275e-05, 0.999960080199521],
  [-0.0030540597709430026, 0.013089534515572338, 3.99798324215911e-05, 0.9999096635230075],
  [-0.0019197878953759835, -0.008726519415937776, -1.6753735149245275e-05, 0.999960080199521],
  [0.010907791405663263, 0.007417139990439531, -8.091165547980405e-05, 0.9999129960023105],
].map(rotation => ({ position: [0, 0, 0], rotation }));
const DATA = {
  Bazooka: { roundOfFire: 1.0, velocity: 50, projectile: 'BazookaProjectile',
             magazine: { size: 1, magazines: 6, type: 0, reloadTime: 5.6, autoReload: true } },
  Colt: { roundOfFire: 6.0, velocity: 400, projectile: 'coltProjectile',
          magazine: { size: 8, magazines: 4, type: 0, reloadTime: 4.0 } },
  Thompson: { roundOfFire: 10.0, velocity: 1000, projectile: 'ThomsonProjectile',
              magazine: { size: 30, magazines: 5, type: 0, reloadTime: 4.8 } },
  Mp40: { roundOfFire: 9.0, velocity: 1000, projectile: 'mp40Projectile',
          magazine: { size: 32, magazines: 5, type: 0, reloadTime: 4.3 } },
  Remington: { roundOfFire: 1.0, velocity: 500, projectile: '9mm_Projectile',
               magazine: { size: 8, magazines: 5, type: 0, reloadTime: 3.3 }, barrels: REMINGTON_BARRELS },
  // DC's M249: the glb's FireArms heat words, and a magazine too deep to run
  // dry inside the hold.
  M249: { roundOfFire: 13.5, velocity: 900, projectile: 'M249_Projectile',
          magazine: { size: 200, magazines: 3, type: 0, reloadTime: 5.0 },
          heat: { heatAddWhenFire: 0.0265, coolDownPerSec: 0.3, timeDelayOnOverheat: 2.0, roundOfFire: 13.5 } },
};
// The seat MGs' FireArms heat words (the glbs' `extras.fireArms`).
const SEAT_MG = {
  MG42: { heatAddWhenFire: 0.04, coolDownPerSec: 0.4, timeDelayOnOverheat: 2.0, roundOfFire: 15.0 },
  Browning: { heatAddWhenFire: 0.04, coolDownPerSec: 0.4, timeDelayOnOverheat: 2.0, roundOfFire: 10.0 },
  Coaxial_browning: { heatAddWhenFire: 0.05, coolDownPerSec: 0.3, timeDelayOnOverheat: 2.0, roundOfFire: 12.0 },
};

/**
 * One bot with the trigger held for `seconds` at `hz`, its kit's fire data
 * handed over `dataAt` seconds in (the page fetches it after the bot's first
 * tick). `launch` is the caller's answer to `launchRound` (null: no hook).
 */
function hold({ kit, seconds, dataAt = 1.0, hz = 30, launch = null, trigger = null }) {
  const L = syntheticLevel(M, { vehicles: false });
  const world = new M.World({ collider: L.collider, extras: L.extras });
  world.addBotPlayer('bot_0', { team: 2, flag: world.flags.find(f => f.team === 2) });
  world.setPlayerArmor('bot_0', new M.Armor(30));
  const bot = new M.BotController({ playerId: 'bot_0', world,
                                    weapons: kit.map(name => ({ ...AI[name], name })) });
  const rounds = [];
  let launched = 0, resolved = 0;
  const referee = M.createBotReferee({
    world: () => world,
    armorFor: () => new M.Armor(30),
    roundDamage: () => 10,
    onShot: b => rounds.push([+referee.clock.toFixed(4), b.weaponAi?.name ?? null,
                              b._heat?.get(b.weaponAi?.name)?.heat ?? null]),
    ...(launch === null ? {} : { launchRound: () => { launched++; return launch; } }),
  });
  const resolve = referee.resolveShot;
  const rays = [];
  referee.resolveShot = (...args) => { resolved++; rays.push(args[4] ?? null); return resolve(...args); };
  referee.bots.push(bot);
  const dt = 1 / hz;
  let entriesBeforeData = null;
  const reloads = [];
  for (let i = 0; i < Math.round(seconds * hz); i++) {
    const t = i * dt;
    if (t >= dataAt && !bot.weaponData[kit[0]]) {
      entriesBeforeData = bot._mags?.size ?? 0;
      for (const name of kit) bot.setWeaponData(name, DATA[name]);
    }
    bot.isFiring = trigger ? trigger(bot) : true;
    referee.clock += dt;
    referee.fireTick(dt);
    const mag = bot._mags?.get(bot.weaponAi.name);
    if (mag?.reloadLeft > 0 && (!reloads.length || reloads[reloads.length - 1].end !== null)) {
      reloads.push({ start: +referee.clock.toFixed(4), length: mag.reloadTime, end: null });
    }
    if (reloads.length && reloads[reloads.length - 1].end === null && !(mag?.reloadLeft > 0)) {
      reloads[reloads.length - 1].end = +referee.clock.toFixed(4);
    }
  }
  const mag = bot._mags?.get(kit[0]) ?? null;
  return {
    entriesBeforeData, rounds, launched, resolved, reloads, rays,
    mag: mag && { rounds: mag.rounds, spare: mag.spare, size: mag.size, reloadTime: mag.reloadTime,
                  reloadLeft: mag.reloadLeft, autoReload: mag.autoReload },
    ammo: bot.weapons.map(w => [w.name, w.ammo, w.rounds ?? null]),
    empty: bot.magazineEmpty, endsPlan: bot.magazineEndsPlan,
    bot, referee, world,
  };
}

const after = (r, t) => r.rounds.filter(([at]) => at >= t);

const gaps = list => list.slice(1).map(([t], i) => +(t - list[i][0]).toFixed(4));

const out = {};

/** A list of round times cut into bursts where a gap runs past 1.6 periods. */
function bursts(times, period) {
  const list = [];
  for (const [i, t] of times.entries()) {
    if (!i || t - times[i - 1] > 1.6 * period) list.push([]);
    list[list.length - 1].push(i);
  }
  return list;
}

// --- the heat hold (bot-plans.js `heatHolds`, ledger AI-144) -------------------
//
// A seat's MG: the bot's trigger through `heatHolds` with the plan's action
// (the world's `fireStateFor`, found by `weaponGroup`), then the world's own
// order (world-vehicle-tick.js: the state steps, the trigger is gated on
// `canFire`) and the cadence of `advanceGroups` (gun-cycle.js). `replanAt`
// swaps the trigger action for a new plan's at that second.
function seatHold(words, { seconds = 8, replanAt = null, input = 'c_PIFire' } = {}) {
  const node = { name: 'gun', userData: { fireArms: words } };
  const states = new Map();
  const world = { fireStateFor: n => (states.get(n) ?? states.set(n, new FireState(n.userData.fireArms)).get(n)) };
  const bot = { vehicle: { groups: [{ node, stats: { input } }] }, world, weaponIndex: 0,
                weapons: [{ name: 'gun', burst: 1, weaponFire: input.slice(2) }] };
  const state = world.fireStateFor(node);
  const period = firePeriod(words.roundOfFire);
  const dt = 1 / 30;
  let action = { type: PLAN_ACTION.TriggerContinously };
  let cooldown = 0, maxHeat = 0, locked = false;
  const times = [], before = [];
  for (let i = 0; i < Math.round(seconds * 30); i++) {
    if (replanAt !== null && i === Math.round(replanAt * 30)) action = { type: PLAN_ACTION.TriggerContinously };
    const pressed = !heatHolds(bot, action);
    state.step(dt);
    if (pressed && state.canFire && cooldown <= 0) {
      times.push(i * dt);
      before.push(state.heat);
      state.registerShot(1);
      cooldown = period;
    }
    if (cooldown > 0) cooldown = Math.max(0, Math.fround(cooldown - Math.fround(dt)));
    maxHeat = Math.max(maxHeat, state.heat);
    if (state.overheatRemaining > 0) locked = true;
  }
  const b = bursts(times, period);
  return {
    bursts: b.map(x => x.length),
    resumeHeat: b.slice(1).map(x => +before[x[0]].toFixed(4)),
    resumeAt: b.slice(1).map(x => +times[x[0]].toFixed(4)),
    lastHeat: b.map(x => +(before[x[x.length - 1]] + words.heatAddWhenFire).toFixed(4)),
    maxHeat: +maxHeat.toFixed(4), locked,
  };
}

/** The first round on which the heat law, the trigger held, reaches 0.8. */
function lawReaches(words, level = Math.fround(0.8)) {
  const state = new FireState(words);
  const period = firePeriod(words.roundOfFire);
  let cooldown = 0, n = 0;
  for (let i = 0; i < 30 * 60; i++) {
    state.step(1 / 30);
    if (state.canFire && cooldown <= 0) {
      state.registerShot(1);
      n++;
      if (state.heat >= level) return n;
      cooldown = period;
    }
    if (cooldown > 0) cooldown = Math.max(0, Math.fround(cooldown - Math.fround(1 / 30)));
  }
  return null;
}

{
  const handAction = { type: PLAN_ACTION.TriggerContinously };
  const hand = hold({ kit: ['M249'], seconds: 12, dataAt: 0, trigger: b => !heatHolds(b, handAction) });
  const times = hand.rounds.map(([t]) => t);
  const b = bursts(times, firePeriod(13.5));
  const free = hold({ kit: ['M249'], seconds: 12, dataAt: 0 });
  const g = hold({ kit: ['Colt'], seconds: 0.1, dataAt: 0 });
  g.bot.setWeaponData('GrenadeAllies', { roundOfFire: 1, throw: { velocity: 15 }, heat: { heatAddWhenFire: 0.03 } });
  out.heat = {
    mg42: seatHold(SEAT_MG.MG42),
    mg42Replan: seatHold(SEAT_MG.MG42, { replanAt: 2.3 }),
    browning: seatHold(SEAT_MG.Browning, { seconds: 10 }),
    coax: seatHold(SEAT_MG.Coaxial_browning, { input: 'c_PIAltFire' }),
    lawReaches: Object.fromEntries([...Object.entries(SEAT_MG), ['M249', DATA.M249.heat]]
      .map(([name, words]) => [name, lawReaches(words)])),
    noHeat: seatHold({ roundOfFire: 10 }, { seconds: 4 }),
    // The fire data's heat words (bot-barrels.js `fireArmsHeat`), and a
    // grenade's, which are its throw's charge and no heat at all.
    words: fireArmsHeat({ ...SEAT_MG.MG42, projectile: 'x', magSize: -1 }),
    noWords: fireArmsHeat({ roundOfFire: 10 }),
    grenade: g.referee.heatOf(g.bot, 'GrenadeAllies'),
    colt: g.referee.heatOf(g.bot, 'Colt'),
    hand: {
      bursts: b.map(x => x.length),
      // The round on which the bot's own barrel first reached 0.8.
      reaches: hand.rounds.findIndex(([, , heat]) => heat >= Math.fround(0.8)) + 1,
      heat: +(hand.bot._heat?.get('M249')?.heat ?? -1).toFixed(4),
      freeRounds: free.rounds.length,
      // The lockout: a 2 s gap in a held trigger's rounds.
      freeLocked: Math.max(...gaps(free.rounds)) >= 1.9,
    },
  };
}

// --- a shotgun's barrels ----------------------------------------------------

{
  // Every barrel fires its own round down its own turn (ledger XHIT-12,
  // XHIT-16): a pull of DC's Remington is eight rounds, each off the eye's
  // axis by its barrel's turn; a Colt with no barrels is one ray down the eye.
  const shot = hold({ kit: ['Remington'], seconds: 2.5, dataAt: 0 });
  const pulls = shot.rounds.length;
  const eye = shot.bot.aimRay();
  const offAxis = shot.rays.filter(Boolean).slice(0, 8).map(r => {
    const c = (r.dir[0] * eye.dir[0] + r.dir[1] * eye.dir[1] + r.dir[2] * eye.dir[2])
      / (Math.hypot(...r.dir) * Math.hypot(...eye.dir));
    return +(Math.acos(Math.min(1, c)) * 180 / Math.PI).toFixed(3);
  });
  const colt = hold({ kit: ['Colt'], seconds: 2, dataAt: 0 });
  const { barrelRays, fireArmsBarrels } = await imp('bot-barrels.js');
  // A FireArms node with a bundle under it holding two barrels: the turns
  // compose down the path.
  const half = Math.SQRT1_2;
  const json = { nodes: [
    { name: 'gun', extras: { fireArms: {} }, children: [1] },
    { name: 'bundle', rotation: [0, half, 0, half], children: [2, 3] },
    { name: 'm2', translation: [0, 0, -1], extras: { muzzle: { index: 1 } } },
    { name: 'm1', extras: { muzzle: { index: 0 } } },
  ] };
  const parsed = fireArmsBarrels(json);
  out.barrels = {
    pulls, resolved: shot.resolved, offAxis,
    distinct: new Set(shot.rays.filter(Boolean).slice(0, 8).map(r => r.dir.map(v => v.toFixed(5)).join())).size,
    colt: { pulls: colt.rounds.length, resolved: colt.resolved, rays: colt.rays.filter(Boolean).length },
    parsed: parsed.map(b => ({ position: b.position.map(v => +v.toFixed(6)), rotation: b.rotation.map(v => +v.toFixed(6)) })),
    plain: barrelRays([0, 0, 0], [0, 0, 1], [{ position: [0, 0, 0], rotation: [0, 0, 0, 1] }]),
    noBarrels: fireArmsBarrels({ nodes: [{ extras: { fireArms: {} } }] }).length,
  };
}

// --- the magazine race ------------------------------------------------------

{
  const r = hold({ kit: ['Bazooka', 'Colt'], seconds: 40, launch: true });
  const data = after(r, 1.0);
  out.bazooka = {
    entriesBeforeData: r.entriesBeforeData,
    beforeData: r.rounds.filter(([t]) => t < 1.0).length,
    rockets: data.length,
    gaps: gaps(data),
    reloads: r.reloads.filter(x => x.end !== null).map(x => +(x.end - x.start).toFixed(4)),
    // From the round to its reload's first tick: the fire cycle, 1 / roundOfFire.
    reloadDelays: r.reloads.map(x => +(x.start - data.filter(([t]) => t <= x.start).at(-1)[0]).toFixed(4)),
    mag: r.mag, ammo: r.ammo, empty: r.empty, endsPlan: r.endsPlan,
    launched: r.launched, resolved: r.resolved,
  };
}

{
  const r = hold({ kit: ['Thompson', 'Colt'], seconds: 20 });
  const data = after(r, 1.0);
  // Bursts: runs of rounds no more than one period and a tick apart.
  const bursts = [];
  for (const [t] of data) {
    const last = bursts[bursts.length - 1];
    if (last && t - last.end <= 0.15) { last.end = t; last.n++; } else bursts.push({ start: t, end: t, n: 1 });
  }
  out.thompson = {
    entriesBeforeData: r.entriesBeforeData,
    bursts: bursts.map(b => ({ start: b.start, n: b.n, rate: b.n > 1 ? +((b.n - 1) / (b.end - b.start)).toFixed(3) : null })),
    gapsBetween: bursts.slice(1).map((b, i) => +(b.start - bursts[i].end).toFixed(4)),
    reloads: r.reloads.filter(x => x.end !== null).map(x => +(x.end - x.start).toFixed(4)),
    resolved: r.resolved, launched: r.launched, endsPlan: r.endsPlan,
  };
}

// The held rate on the world's ticks (GUN-13): the Mp40's `roundOfFire 9`
// and the M249's 13.5, each a round per whole number of ticks.
{
  const span = r => +(r.rounds[r.rounds.length - 1][0] - r.rounds[0][0]).toFixed(4);
  const mp40 = hold({ kit: ['Mp40'], seconds: 4.4, dataAt: 0 });
  const m249 = hold({ kit: ['M249'], seconds: 1.0, dataAt: 0 });
  out.wholeTicks = {
    mp40: { rounds: mp40.rounds.length, span: span(mp40) },
    m249: { rounds: m249.rounds.length, gaps: [...new Set(gaps(m249.rounds))] },
  };
}

// Without a caller that flies it, the round is the referee's ray.
{
  const r = hold({ kit: ['Bazooka'], seconds: 3, launch: false });
  out.unflown = { launched: r.launched, resolved: r.resolved, rounds: r.rounds.length };
}

// A new soldier is a new kit: the respawn puts the magazines back.
{
  const r = hold({ kit: ['Bazooka'], seconds: 40, launch: true });
  const { bot, referee, world } = r;
  const dry = { rounds: bot._mags.get('Bazooka').rounds, spare: bot._mags.get('Bazooka').spare };
  const index = [bot.lives, bot.inputIndex];
  world.armorOf('bot_0').damage(1e6);
  bot._respawnIn = 0.01;
  referee.respawnTick(bot, 0.02);
  index.push(bot.lives, bot.inputIndex);
  bot.isFiring = false;
  referee.fireTick(1 / 30);
  const mag = bot._mags.get('Bazooka');
  out.respawn = { dry, refilled: mag ? { rounds: mag.rounds, spare: mag.spare }  : null, index,
                  expected: [footInputIndex(bot.playerId, 0), footInputIndex(bot.playerId, 1)] };
}

// --- the plan's empty-magazine end ------------------------------------------

{
  const plan = [{ type: PLAN_ACTION.TriggerContinously, timeout: 3, shots: 10 }];
  plan.startedAt = 0; plan.targetId = 'x';
  const botOf = (o) => ({ world: { armorOf: () => ({ destroyed: false }) }, ...o });
  out.planEnd = {
    smgRanDry: firePlanDone(botOf({ magazineEmpty: true, magazineEndsPlan: true, _shotsThisPlan: 4 }), plan, 1),
    smgPlanMadeInReload: firePlanDone(botOf({ magazineEmpty: true, magazineEndsPlan: true, _shotsThisPlan: 0 }), plan, 1),
    bazookaReloading: firePlanDone(botOf({ magazineEmpty: true, magazineEndsPlan: false, _shotsThisPlan: 1 }), plan, 1),
    loaded: firePlanDone(botOf({ magazineEmpty: false, magazineEndsPlan: true, _shotsThisPlan: 4 }), plan, 1),
  };
}

// --- which rounds are flown ----------------------------------------------------

out.flown = {
  bazooka: launchesDrawnRound({ projectile: { kind: 'shell', damage: { radius: 4, material2: 200, damageType: 1, hasCollisionEffect: true } } }),
  grenade: launchesDrawnRound({ projectile: { kind: 'shell', damage: { radius: 15, material2: 205, damageType: 1, hasCollisionEffect: false, dieAfterColl: false } } }),
  landmine: launchesDrawnRound({ projectile: { kind: 'shell', damage: { radius: 4, material2: 232, damageType: 4, hasCollisionEffect: false, dieAfterColl: false } } }),
  bullet: launchesDrawnRound({ projectile: { kind: 'bullet', damage: { hasCollisionEffect: true, dieAfterColl: true } } }),
  bareTemplateName: launchesDrawnRound({ projectile: 'BazookaProjectile' }),
  none: launchesDrawnRound(null),
};

// --- whose damage a bot's flown round is (vehicle-hits.js) --------------------

{
  const hull = { name: 'PanzerIV', getWorldPosition: v => v.set(0, 0, 0) };
  const bot = { playerId: 'bot_0', recordHit: () => {}, getPosition: () => [0, 0, 30] };
  const applyHitAttackers = [], splashAttackers = [], landed = [];
  const page = {
    LOCAL_PLAYER: 'local',
    vehicles: { firerOf: () => null, instanceOf: node => (node === hull ? { seats: new Map([['driver', 'bot_1']]) } : null) },
    damageVisuals: new Map([[994, { node: hull }]]),
    vehicleDamage: {
      get: () => null,
      applyHit: (record, attacker) => { applyHitAttackers.push(attacker); return null; },
      applySplash: (record, targets, opts) => {
        splashAttackers.push(opts.attacker);
        return [{ target: { soldier: true, botId: 'bot_5', armor: {} }, lost: 3, distance: 1.9, damage: 3, vehicle: {} }];
      },
    },
    world: { players: new Map(), player: () => null, armorOf: () => null },
    bots: [bot],
    bodyAt: () => null, capsulesOf: () => null,
    soldier: null, soldierArmor: null, soldierDead: false,
    optOnFoot: { checked: false }, optPilot: { checked: false },
    guns: { materials: null, modifiers: null },
    camera: { position: { toArray: () => [0, 0, 0] } },
    applyDamage: () => {}, applyDamageToPlayer: () => {},
    damageLanded: (id, lost, attacker, at, opts) => landed.push({ id, attacker, opts }),
  };
  const hits = createVehicleHits(page);
  const rocket = { firer: 'bot_0', weapon: 'Bazooka' };        // bot-rounds.js tags
  hits.applyVehicleHit({ kind: 'object', owner: 994, damage: 20, firerGroup: rocket, gun: 'Bazooka',
                         splashRadius: 4, point: [0, 1, 0], splashPoint: [0, 1.1, 0] });
  hits.applyVehicleHit({ kind: 'object', owner: 994, damage: 20, firerGroup: {}, gun: 'x' });
  out.billing = {
    hullAttackers: applyHitAttackers, splashAttackers,
    splashOnBot: landed.map(l => ({ id: l.id, attacker: l.attacker, splash: !!l.opts?.splash, weapon: l.opts?.weapon ?? null })),
  };
}

// --- the bots' deviation point (bot-deviation.js, ledger AI-145) -------------
{
  const off = (d, total, k) => {
    const v = botDeviate(d, total, k);
    return v.map(x => +x.toFixed(7));
  };
  const seatK = deviationIndex(SEAT_INPUT_INDEX, 0, 0);
  // A bot on foot: one index a life (the referee's spawn and respawn), the
  // seat's once seated, the seat's for a bot the referee never gave one.
  const lives = Array.from({ length: 42 }, (_, life) => footInputIndex('bot_7', life));
  const onFoot = botInputIndex({ inputIndex: lives[0] });
  const seated = botInputIndex({ inputIndex: lives[0], vehicle: { vehicleId: 'x' } });
  const unset = botInputIndex({});
  out.devPoint = {
    seatIndex: SEAT_INPUT_INDEX, seatK,
    shotgunK: [0, 1, 7].map(i => deviationIndex(476, 8, i)),
    rifleK: deviationIndex(476, 0, 0), launcherK: deviationIndex(476, 1, 0),
    // A glb muzzle list: none, the one a barrel-less gun is given, eight.
    declared: [declaredBarrels([]), declaredBarrels([{}]), declaredBarrels(new Array(8).fill({})), declaredBarrels(null)],
    lives, onFoot, seated, unset, again: footInputIndex('bot_7', 0),
    // Looking down -z: right is +x, up is +y, each u x total / 100.
    north: off([0, 0, -1], 1.0, seatK),
    north2: off([0, 0, -1], 2.0, seatK),
    floor: off([0, 0, -1], 0.01, seatK),
    barrel1: off([0, 0, -1], 1.0, seatK + 1),
    // Looking east (+x): the right is +z in the viewer's frame.
    east: off([1, 0, 0], 1.0, seatK),
    table: Array.from({ length: 1024 }, (_, k) => deviationPoint(k)),
  };
}

console.log = log;
console.log(JSON.stringify(out));
