// A hull's crew dies on the lethal call, so their kill line names that call's
// weapon, not the one the attacker holds when the hull finally dies (ledger
// KILLSTAMP-1; owner report, FH Omaha Charlie: a satchel kill printed [K 98]).
// Drives the page's referee `vehicleTick` with a stub unit layer and prints
// the `onDeath` opts. Run by `tests/test_vehicle_kill_credit.py`.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadViewerModules, viewerDir, seedMathRandom } from '../sim/env.mjs';
import { syntheticLevel } from '../sim/level.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const viewer = viewerDir(path.join(HERE, '..', 'viewer'));
const M = await loadViewerModules(viewer);
seedMathRandom(5);
console.log = () => {}; console.warn = () => {};

function run(killedWith, attacker) {
  const level = syntheticLevel(M, { vehicles: false });
  const world = new M.World({ collider: level.collider, extras: level.extras });
  const deaths = [];
  let destroyed = false;
  const referee = M.createBotReferee({
    world: () => world, groundAt: () => 0,
    armorFor: () => new M.Armor(30), roundDamage: () => 30,
    units: {
      tick() {}, candidates: () => [], destroyed: () => destroyed,
      attackerOf: () => attacker, killedWithOf: () => killedWith,
      leave: bot => ({ x: bot.position[0], y: bot.position[1], z: bot.position[2] }),
      invalidate() {},
    },
    onDeath: (bot, attackerId, opts) => deaths.push({ attackerId, ...opts }),
  });
  referee.spawn({ count: 1, botSkill: 0.5, teams: [1], kitFor: (t, i) => level.kits.kitFor(t, i) });
  const bot = referee.bots[0];
  bot.vehicle = { template: 'Cromwell', vehicleId: 'v', seatId: 0 };
  destroyed = true;
  try { referee.vehicleTick(); } catch (e) { return { error: String(e.stack ?? e) }; }
  return deaths[0] ?? null;
}

console.error = () => {};
process.stdout.write(JSON.stringify({
  satchel: run({ weapon: 'SatchelShort', splash: true }, 7),
  none: run(null, 7),
  nobody: run(null, null),
}));
