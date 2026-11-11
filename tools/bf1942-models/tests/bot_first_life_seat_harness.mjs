// A bot's first life is a spawn like any other (`bot-referee.js`
// `placeFirstLives`, SPAWN-27): BF1918 fao_landing in Conquest, where the
// British own no control point and spawn only from hulls, the Gnat
// (`setAIEnterOnSpawn`) and eleven landing boats (`setEnterOnSpawn`, one
// group). `spawnBots` cannot ask a seat, so before the fix every British bot
// stood on the Gnat's point and nobody took a boat. Positions are the
// level's own; three boats stand in for the eleven.
//
// Run by `tests/test_bot_first_life_seat.py`; prints one JSON object.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { viewerDir, installModuleHooks, seedMathRandom, routeConsole } = await import(path.join(HERE, '..', 'sim', 'env.mjs'));
const viewer = viewerDir(path.join(HERE, '..', 'viewer'));
installModuleHooks(viewer);
const imp = f => import(path.join(viewer, f));
const { createBotReferee } = await imp('bot-referee.js');
const { World } = await imp('world.js');
const { spawnBots } = await imp('bot.js');
const { Armor } = await imp('armor.js');
const { SPAWN_STANDS } = await imp('spawn-seat.js');
routeConsole(true);
seedMathRandom(7);

const clone = v => JSON.parse(JSON.stringify(v));
const FORT = [352.75, 84.4, -766.06];
const cp = (name, position, team, group) => ({
  name, displayName: name, position, rotation: [0, 0, 0], team, radius: 25, areaValue: 40,
  spawnGroupId: group, secondSpawnGroupId: null, objectSpawnerId: null, unableToChangeTeam: false,
  timeToGetControl: 10, timeToLoseControl: 10, disableIfEnemyInsideRadius: false,
  disableWhenLosingControl: false, loseControlWhenEnemyClose: true, loseControlWhenNotClose: false,
  minNrToTakeControl: null, onlyTakeableByTeam: null,
});
const boat = (pad, position) => ({
  vehicle: 'barkasseteam2_spawner', spawner: 'sloep', pad, name: 'b_spawner1', group: 74, team: 2,
  position, rotation: [0, 0, 0], enterOnSpawn: true, aiEnterOnSpawn: true,
});
const FAO = {
  worldSize: 1024,
  controlPoints: [cp('Fao_Fortress', FORT, 1, 1)],
  soldierSpawns: Array.from({ length: 4 }, (_, i) => ({
    name: `Fao_Fortress_Spawn${i + 1}`, group: 1, team: 1, spawnId: i, paratrooper: false,
    position: [FORT[0] + 6 * i, 76.2, FORT[2]], rotation: [0, 0, 0],
  })),
  vehicleSoldierSpawns: [
    { vehicle: 'gnat', spawner: 'Gnatx', pad: 1, name: 'gnatdriversoldierspawn', group: 64, team: 2,
      position: [713.0, 78.48, -186.0], rotation: [270, 0, 0], aiEnterOnSpawn: true },
    boat(2, [532.26, 76.37, -247.97]), boat(3, [539.24, 76.37, -250.74]), boat(4, [548.57, 76.37, -252.7]),
  ],
};
const collider = { waterLevel: null, surfaceHeight: () => 0, heightfield: null };
const makeWorld = extras => new World({ collider, extras: clone(extras), groundHeight: () => 0 });

/**
 * The units layer as far as the pass asks it: a boat point's seat is its own
 * boat's passenger seat while free, the Gnat's point has none the page can
 * give (it stands its bot, `SPAWN_STANDS`). `ready` is whether the hulls have
 * landed: before, there are no candidates.
 */
function stubUnits(state) {
  const seatAt = spawn => `boat${spawn.pad}`;
  return {
    candidates: () => (state.ready ? [{ id: 'any' }] : []),
    spawnSeat: spawn => {
      if (!state.ready) return spawn.enterOnSpawn ? null : SPAWN_STANDS;
      if (!spawn.enterOnSpawn) return SPAWN_STANDS;
      const id = seatAt(spawn);
      return state.taken.has(id) ? null : { id, template: 'BarkasseTeam2_Spawner', seatId: 'Barkasse_Passenger_PCO1' };
    },
  };
}

function run({ ready = true, clock = 0, count = 8 } = {}) {
  const world = makeWorld(FAO);
  const state = { ready, taken: new Set() };
  const units = stubUnits(state);
  const bots = spawnBots({ world, count, teams: [1, 2], flags: world.flags });
  const referee = createBotReferee({ world: () => world, armorFor: () => new Armor(30), units });
  referee.bots = bots;
  referee.clock = clock;
  const seated = [];
  referee.enterVehicle = (bot, cand) => {
    state.taken.add(cand.id);
    seated.push({ id: bot.playerId, seat: cand.id });
    return true;
  };
  const before = bots.map(b => ({ id: b.playerId, team: b.team, flag: world.player(b.playerId)?.flag?.name ?? null,
    at: [...b.position] }));
  referee.firstLivesPending = true;
  referee.placeFirstLives();
  const after = bots.map(b => ({ id: b.playerId, team: b.team, flag: world.player(b.playerId)?.flag?.name ?? null,
    at: [...b.position] }));
  return { before, after, seated, pending: referee.firstLivesPending };
}

process.stdout.write(JSON.stringify({
  ready: run(),
  notLanded: run({ ready: false }),
  late: run({ ready: false, clock: 20 }),
  crowded: run({ count: 14 }),
}));
