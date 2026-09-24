// Pins the bots' hand weapons (features/bot-weapons): the magazine made from
// the weapon's fire data and never before it (bot-referee.js `magazineOf`),
// the reload, a held trigger's rate carrying its fraction, the round flown by
// the caller instead of resolved (`env.launchRound`), a full kit on respawn,
// the fire plan's empty-magazine end, which rounds are flown (bot-rounds.js
// `launchesDrawnRound`), and whose damage a bot's flown round is
// (vehicle-hits.js).
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
const { firePlanDone, PLAN_ACTION } = await imp('bot-plans.js');
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
};
const DATA = {
  Bazooka: { roundOfFire: 1.0, velocity: 50, projectile: 'BazookaProjectile',
             magazine: { size: 1, magazines: 6, type: 0, reloadTime: 5.6, autoReload: true } },
  Colt: { roundOfFire: 6.0, velocity: 400, projectile: 'coltProjectile',
          magazine: { size: 8, magazines: 4, type: 0, reloadTime: 4.0 } },
  Thompson: { roundOfFire: 10.0, velocity: 1000, projectile: 'ThomsonProjectile',
              magazine: { size: 30, magazines: 5, type: 0, reloadTime: 4.8 } },
  Mp40: { roundOfFire: 9.0, velocity: 1000, projectile: 'mp40Projectile',
          magazine: { size: 32, magazines: 5, type: 0, reloadTime: 4.3 } },
};

/**
 * One bot with the trigger held for `seconds` at `hz`, its kit's fire data
 * handed over `dataAt` seconds in (the page fetches it after the bot's first
 * tick). `launch` is the caller's answer to `launchRound` (null: no hook).
 */
function hold({ kit, seconds, dataAt = 1.0, hz = 30, launch = null }) {
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
    onShot: b => rounds.push([+referee.clock.toFixed(4), b.weaponAi?.name ?? null]),
    ...(launch === null ? {} : { launchRound: () => { launched++; return launch; } }),
  });
  const resolve = referee.resolveShot;
  referee.resolveShot = (...args) => { resolved++; return resolve(...args); };
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
    bot.isFiring = true;
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
    entriesBeforeData, rounds, launched, resolved, reloads,
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

// The held rate at 60 frames a second: the Mp40's 9 rounds a second.
{
  const r = hold({ kit: ['Mp40'], seconds: 4.4, dataAt: 0, hz: 60 });
  const first = r.rounds[0][0];
  out.mp40At60 = { rounds: r.rounds.length, span: +(r.rounds[r.rounds.length - 1][0] - first).toFixed(4) };
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
  world.armorOf('bot_0').damage(1e6);
  bot._respawnIn = 0.01;
  referee.respawnTick(bot, 0.02);
  bot.isFiring = false;
  referee.fireTick(1 / 30);
  const mag = bot._mags.get('Bazooka');
  out.respawn = { dry, refilled: mag ? { rounds: mag.rounds, spare: mag.spare } : null };
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

console.log = log;
console.log(JSON.stringify(out));
