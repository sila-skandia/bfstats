// Pins the bot side's level switch: the referee (`bot-referee.js`) and the
// units layer (`bot-units.js`) each forget the old level on `reset()`, so the
// next level spawns its bots on its own infantry map and builds its own
// vehicle and water maps on first use, and the door list is not read as fresh
// off the old level's clock.
//
// The flow is the page's: spawn on a 256 m level, build every map and the
// candidate list 120 s in, then `resetBots` (`referee.reset()` +
// `units.reset()`), a tick in the gap before the next spawn, and a spawn on a
// 512 m level. A control runs the same switch without the resets.
//
// The viewer modules load straight out of `viewer/` through the runner's
// module hooks (`sim/env.mjs`). Run by `tests/test_bot_level_switch.py`.
// One JSON object on stdout.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadViewerModules, viewerDir, seedMathRandom } from '../sim/env.mjs';
import { syntheticLevel } from '../sim/level.mjs';

const viewer = viewerDir();
const M = await loadViewerModules(viewer);
const { createBotUnits } = await import(pathToFileURL(path.join(viewer, 'bot-units.js')).href);
seedMathRandom(1);

const logs = [];
const log = console.log;
console.log = (...args) => { logs.push(args.join(' ')); };

// Two levels: the synthetic one (256 m) and the same flags and spawns on a
// 512 m world. Both carry a Boat water map so the water map is built too.
function levelOf(worldSize) {
  const L = syntheticLevel(M, { vehicles: false });
  const extras = structuredClone(L.extras);
  extras.worldSize = worldSize;
  extras.level = `Synthetic_${worldSize}`;
  extras.ai.searchMaps.push({ name: 'Boat2', waterMap: true, waterDepth: 5, maxSlope: 0, brush: 125, lowClip: 0.3, hiClip: 2.5 });
  const dim = worldSize / 4;
  const heightfield = new M.Heightfield(dim, 4, new Float32Array((dim + 1) * (dim + 1)));
  const collider = new M.WorldCollider({ heightfield, statics: L.collider.statics, waterLevel: -2, drivableMask: null });
  return { ...L, extras, collider };
}
const A = levelOf(256);
const B = levelOf(512);

function side({ reset }) {
  let world = null;
  const units = createBotUnits({
    world: () => world,
    referee: () => referee,
    vehicles: { holder: () => null, driverOf: () => null },
    aiUrl: () => '',
    entryPoints: () => [],
    currentRoot: () => null,
    vehicleSpawnActive: () => true,
    collider: () => world?.collider ?? null,
    localPlayerId: 'local',
  });
  units.ai = new Map();
  const referee = M.createBotReferee({
    world: () => world,
    get units() { return units; },
    groundAt: () => 0,
    armorFor: () => new M.Armor(30),
    roundDamage: () => 30,
  });
  const spawn = level => {
    world = new M.World({ collider: level.collider, extras: level.extras });
    referee.spawn({ count: 4, botSkill: 0.75, teams: [1, 2], kitFor: (team, i) => level.kits.kitFor(team, i) });
  };
  const size = nav => nav?.worldSize ?? null;

  spawn(A);
  const firstBots = referee.bots.slice();
  referee.clock = 120;
  units.candidates();
  const before = {
    infantry: size(referee.navGrid), vehicle: size(units.vehicleNav()), water: size(units.waterNav('Boat')),
    candidatesAt: units.candidateCache.at, bots: referee.bots.length,
  };

  const logsBefore = logs.length;
  let gap = null;
  if (reset) {
    referee.reset();
    units.reset();
    gap = {
      bots: referee.bots.length, clock: referee.clock, infantry: referee.navGrid, strategy: referee.strategy,
      covers: referee.covers.length, vehicle: units.navVehicle, water: units.navWater.size,
      candidatesAt: units.candidateCache.at,
    };
    // The new World is built before the new bots are spawned; the page's
    // frames tick the referee in between.
    world = new M.World({ collider: B.collider, extras: B.extras });
    referee.tick(1 / 30);
    gap.tickedClock = referee.clock;
  }
  spawn(B);
  // The first `candidates()` of the new level: rebuilt at its own clock, or
  // (without the reset) read as fresh off the old one.
  const list = units.candidates();
  const after = {
    infantry: size(referee.navGrid), vehicle: size(units.vehicleNav()), water: size(units.waterNav('Boat')),
    candidatesAt: units.candidateCache.at, candidatesStale: list === units.candidateCache.list && units.candidateCache.at === 120,
    bots: referee.bots.length, carried: referee.bots.filter(b => firstBots.includes(b)).length,
  };
  const newLogs = logs.slice(logsBefore);
  return {
    before, gap, after,
    vehicleLogAgain: newLogs.some(l => l.startsWith('[bots] vehicle nav map')),
    waterLogAgain: newLogs.some(l => l.startsWith('[bots] water nav map')),
  };
}

const out = { withReset: side({ reset: true }), withoutReset: side({ reset: false }) };
console.log = log;
console.log(JSON.stringify(out));
