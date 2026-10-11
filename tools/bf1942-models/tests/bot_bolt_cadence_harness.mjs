// A bot's shot cadence per weapon class: the weapon's own `FireArms` timer and
// nothing else (ledger GUN-5, GUN-13, AI-133). Retail gates a soldier's next
// round on `FireArms::handleMessage` 0x082895c0: the reload, overheat and
// `timeToFireFinished` timers, and the last of them is `1 / roundOfFire`. The
// bolt-cycle animation (`Ub_StandBoltOperate<W>` in FH and FHSW) is the
// state the fire state returns to; it does not gate the round (the soldier's
// handlePlayerInput reads `isAnimationReadyToUse` only for the stance
// transition). So a bolt rifle's cadence is `1 / roundOfFire` on whole ticks,
// and the magazine's reload starts once that cycle has run out.
//
// The numbers are the extracted glbs' `extras.weapon` (FH's and vanilla's),
// read 2026-10-11. Run by `tests/test_bot_bolt_cadence.py`; one JSON object.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadViewerModules, viewerDir, seedMathRandom } from '../sim/env.mjs';
import { syntheticLevel } from '../sim/level.mjs';

const viewer = viewerDir();
const M = await loadViewerModules(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const { firePeriod } = await imp('gun-cycle.js');
seedMathRandom(3);
const log = console.log;
console.log = () => {};

const AI = { burst: 0, maxRange: 150, minRange: 0, weaponFire: 'PIFire',
             strength: { Infantry: 5, LightArmour: 0, HeavyArmour: 0, NavalArmour: 0, Submarine: 0, Air: 0 } };
// [class, mod, weapon, roundOfFire, magSize, magazines, reloadTime]
const WEAPONS = [
  ['bolt', 'fh', 'No4', 1.0, 10, 5, 2.5],
  ['bolt', 'fh', 'K98', 0.769, 5, 5, 3.2],
  ['bolt', 'fh', 'MosinNagant', 0.83, 5, 10, 1.6],
  ['bolt', 'fh', 'Arisaka', 0.769, 5, 10, 1.6],
  ['bolt', 'fh', 'Springfield03A3', 0.769, 5, 10, 3.0],
  ['bolt', 'vanilla', 'No4', 0.37, 5, 5, 1.6],
  ['bolt', 'vanilla', 'K98', 0.37, 5, 5, 1.6],
  ['semi', 'fh', 'M1Garand', 6.0, 8, 7, 4.0],
  ['semi', 'fh', 'SVT40', 6.0, 10, 5, 4.0],
  ['semi', 'fh', 'M1Carbine', 10.0, 15, 4, 4.0],
  ['semi', 'vanilla', 'M1Garand', 3.2, 8, 4, 4.0],
  ['auto', 'fh', 'Thompson', 11.67, 30, 6, 4.8],
  ['auto', 'vanilla', 'Thompson', 10.0, 30, 5, 4.8],
];

function run([cls, mod, name, roundOfFire, size, magazines, reloadTime]) {
  const L = syntheticLevel(M, { vehicles: false });
  const world = new M.World({ collider: L.collider, extras: L.extras });
  world.addBotPlayer('bot_0', { team: 2, flag: world.flags.find(f => f.team === 2) });
  world.setPlayerArmor('bot_0', new M.Armor(30));
  const bot = new M.BotController({ playerId: 'bot_0', world, weapons: [{ ...AI, name }] });
  bot.setWeaponData(name, { roundOfFire, velocity: 700, projectile: 'p',
                            magazine: { size, magazines, type: 0, reloadTime } });
  const shots = [];
  const referee = M.createBotReferee({
    world: () => world, armorFor: () => new M.Armor(30), roundDamage: () => 1,
    onShot: () => {
      const mag = bot._mags.get(name);
      shots.push({ t: referee.clock, reloadLeft: mag.reloadLeft });
    },
  });
  referee.bots.push(bot);
  const dt = 1 / 30;
  const seconds = 60;
  const reloadSpans = [];
  let reloading = null;
  for (let i = 0; i < seconds * 30; i++) {
    bot.isFiring = true;
    referee.clock += dt;
    referee.fireTick(dt);
    const mag = bot._mags.get(name);
    if (mag?.reloadLeft > 0 && reloading === null) reloading = referee.clock;
    if (!(mag?.reloadLeft > 0) && reloading !== null) { reloadSpans.push([reloading, referee.clock]); reloading = null; }
  }
  const gaps = [];
  for (let i = 1; i < shots.length; i++) gaps.push(+(shots[i].t - shots[i - 1].t).toFixed(4));
  // The gaps inside one magazine (size - 1 of every size), and across a reload.
  const within = [], across = [];
  shots.forEach((s, i) => {
    if (i === 0) return;
    ((i % size === 0) ? across : within).push(gaps[i - 1]);
  });
  return {
    cls, mod, name, roundOfFire, size, reloadTime,
    shots: shots.length,
    period: +(firePeriod(roundOfFire) * 1).toFixed(4),
    withinMin: Math.min(...within), withinMax: Math.max(...within),
    acrossMin: across.length ? Math.min(...across) : null,
    firedWhileReloading: shots.filter(s => s.reloadLeft > 0).length,
    spare: bot._mags.get(name).spare,
  };
}

log(JSON.stringify({ rows: WEAPONS.map(run) }));
