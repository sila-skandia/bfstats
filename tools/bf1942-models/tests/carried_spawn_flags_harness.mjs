// `viewer/spawn-flags.js` on spawn points an object carries: one flag per set
// of carriers sharing a spawn group, one ring per group at the average of its
// points, labelled by the points' own name (ledger SPAWNGRP-10).
//
// Argv: `<name> <scene.json>` pairs for the extracted levels to read (Desert
// Combat's No Fly Zone Day 2 and Operation Bragg, vanilla's Wake); a synthetic
// level always runs. Run by `tests/test_carried_spawn_flags.py`; prints one
// JSON object.

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { viewerDir, installModuleHooks } = await import(path.join(HERE, '..', 'sim', 'env.mjs'));
const viewer = viewerDir(path.join(HERE, '..', 'viewer'));
installModuleHooks(viewer);
const { spawnFlags } = await import(path.join(viewer, 'spawn-flags.js'));
const { flagMapSpots } = await import(path.join(viewer, 'deploy-spots.js'));

const round = v => (Array.isArray(v) ? v.map(x => +x.toFixed(3)) : v);
const describe = flags => flags.filter(f => f.vehicle).map(f => ({
  name: f.name,
  team: f.team,
  groups: f.groups.map(g => g.group),
  rings: flagMapSpots(f).map(s => ({ group: s.group, position: round(s.position) })),
  spawns: f.spawns.length,
  carriers: [...new Set(f.spawns.map(s => s.vehicle))],
}));
const average = points => {
  const at = [0, 0, 0];
  for (const p of points) for (let i = 0; i < 3; i++) at[i] += p.position[i];
  return round(at.map(v => v / points.length));
};

const out = { levels: {} };
const argv = process.argv.slice(2);
for (let i = 0; i + 2 <= argv.length; i += 2) {
  const extras = JSON.parse(readFileSync(argv[i + 1], 'utf8'));
  const carried = extras.vehicleSoldierSpawns || [];
  const byGroup = {};
  for (const p of carried) (byGroup[p.group] ??= []).push(p);
  out.levels[argv[i]] = {
    flags: describe(spawnFlags(extras)),
    averages: Object.fromEntries(Object.entries(byGroup).map(([g, pts]) => [g, average(pts)])),
    names: spawnFlags(extras).map(f => f.name),
  };
}

// Synthetic: two buildings share group 99, a third carries 98 of its own, a
// ship two deck groups. A hull under way moves its points' arrays in place;
// the ring and the flag's position follow.
{
  const pt = (vehicle, pad, group, team, name, position) =>
    ({ vehicle, spawner: `${vehicle}spawner`, pad, group, team, name, position, rotation: [0, 0, 0] });
  const extras = {
    controlPoints: [], soldierSpawns: [],
    vehicleSoldierSpawns: [
      pt('air_hangar', 1, 99, 1, 'airbase_soldierspawn', [0, 0, 0]),
      pt('air_hangar', 1, 99, 1, 'airbase_soldierspawn', [10, 0, 0]),
      pt('air_tower', 2, 99, 1, 'airbase_soldierspawn', [20, 0, 30]),
      pt('air_dome', 3, 98, 2, 'dome_soldierspawn', [500, 0, 500]),
      pt('carrier', 4, 75, 1, 'carrierdriversoldierspawn', [1000, 20, 0]),
      pt('carrier', 4, 76, 1, 'carrieraircraftsoldierspawn', [1000, 20, 100]),
      pt('carrier', 4, 76, 1, 'carrieraircraftsoldierspawn', [1000, 20, 120]),
    ],
  };
  const flags = spawnFlags(extras);
  const ship = flags.find(f => f.groups.some(g => g.group === 75));
  const before = round(ship.groups[1].position);
  for (const p of extras.vehicleSoldierSpawns) if (p.vehicle === 'carrier') p.position[0] += 50;
  out.synthetic = {
    flags: describe(flags),
    shipRingBefore: before,
    shipRingAfter: round(ship.groups[1].position),
    shipPositionAfter: round(ship.position),
  };
}

// Seat points (`setEnterOnSpawn 1`, ledger FHR-10): FH's circling Hellcat
// carries the one point of its group. A caller that seats its player
// (`enter`) is handed it; one that stands him on the point (a bot) is not,
// and the world never picks the flag for it. Taken, the point is inactive.
{
  const { pickSpawn } = await import(path.join(viewer, 'spawn-flags.js'));
  const { spawnPlayer } = await import(path.join(viewer, 'world-players.js'));
  let taken = false;
  const seat = { vehicle: 'F6F_Hellcat', spawner: 'airhellcatspawner', pad: 1, group: 66, team: 2,
                 name: 'hellcatpilotspawn', position: [1188, 309, -1359], rotation: [0, 0, 0],
                 enterOnSpawn: true, carrierLocal: [0, 0, -1] };
  Object.defineProperty(seat, 'inactive', { get: () => taken });
  const deck = { vehicle: 'fletcher', spawner: 'destroyerspawner', pad: 2, group: 69, team: 2,
                 name: 'fletchersoldierspawn', position: [1000, 66, -1500], rotation: [0, 0, 0] };
  const extras = { controlPoints: [], soldierSpawns: [], vehicleSoldierSpawns: [seat, deck] };
  const flags = spawnFlags(extras);
  const plane = flags.find(f => f.group === 66);
  const ship = flags.find(f => f.group === 69);
  const world = { flags, players: new Map([['bot_0', { team: 2 }], ['me', { team: 2 }]]),
                  groundHeight: () => 60, collider: null, extras: {} };
  out.seatPoints = {
    enterOnly: [plane.enterOnly, ship.enterOnly],
    standing: pickSpawn(plane, 0)?.name ?? null,
    seated: pickSpawn(plane, 0, { enter: true, group: 66 })?.name ?? null,
    botDefault: spawnPlayer(world, 'bot_0', {})?.flag?.name ?? null,
    botAsked: spawnPlayer(world, 'bot_0', { flag: plane }) ?? null,
    human: spawnPlayer(world, 'me', { flag: plane, group: 66, enter: true })?.spawn?.name ?? null,
  };
  taken = true;
  out.seatPoints.takenInactive = plane.inactive;
  out.seatPoints.takenPick = pickSpawn(plane, 0, { enter: true }) ?? null;
}

// The seat a point gives (SPAWN-25..SPAWN-27, SEAT-30, `spawn-seat.js`): the finder's
// reach, whose door wins, and the seat a human's Use ends in. And a bot that
// can be seated: the plane is a flag of his while a seat is in reach, the
// pick is the seat point as it is, and a deck point that seats only a bot
// stays a place for him to stand when the page has no seat to give.
{
  const { findEntryPoint, preferredSeat, wantsSeat, SPAWN_STANDS,
          SPAWN_SEAT_REACH, SPAWN_SEAT_REACH_AI, SPAWN_ENTER_REACH } = await import(path.join(viewer, 'spawn-seat.js'));
  const { pickSpawn, spawnOffered } = await import(path.join(viewer, 'spawn-flags.js'));
  const { spawnPlayer } = await import(path.join(viewer, 'world-players.js'));
  // A bomber: the pilot's door 1 m from the point, a gunner's 4 m, a
  // passenger's 9 m with a 2 m entry radius; a parked jeep's door 2 m off.
  const doors = [
    { seatId: 'pilot', vehicle: 'betty', radius: 4, at: 1, free: true, team: 0 },
    { seatId: 'gunner', vehicle: 'betty', radius: 4, at: 4, free: true, team: 0 },
    { seatId: 'tail', vehicle: 'betty', radius: 2, at: 9, free: true, team: 0 },
    { seatId: 'jeep', vehicle: 'jeep', radius: 3, at: 2, free: true, team: 0 },
  ];
  const find = (radius, { team = 2, useEntryRadius = false } = {}) => findEntryPoint(doors, radius, {
    useEntryRadius, distanceOf: d => d.at,
    open: d => d.free && (d.team === 0 || d.team === team),
  })?.seatId ?? null;
  const seat = {};
  seat.reach = [SPAWN_SEAT_REACH, SPAWN_SEAT_REACH_AI, SPAWN_ENTER_REACH];
  seat.nearest = find(SPAWN_SEAT_REACH);
  doors[0].free = false;                       // the pilot's seat is taken
  seat.pilotTaken = find(SPAWN_SEAT_REACH);    // the jeep's door, 2 m: any hull's
  doors[3].free = false;
  seat.gunnerLeft = find(SPAWN_SEAT_REACH);    // the gunner's, 4 m
  doors[1].free = false;
  seat.humanNone = find(SPAWN_SEAT_REACH);     // the tail's is 9 m: off for a human
  seat.botTail = find(SPAWN_SEAT_REACH_AI);    // and on for a bot, to 15 m
  seat.useTail = find(SPAWN_ENTER_REACH, { useEntryRadius: true });   // 9 m against a 2 m door
  for (const d of doors) d.free = true;
  doors[0].team = 1;                           // the enemy crews her: every door shut
  doors[1].team = 1; doors[2].team = 1;
  seat.enemyHull = find(SPAWN_SEAT_REACH);
  for (const d of doors) d.team = 0;
  // The reach is strict, and the distance is cut to whole centimetres.
  doors[3].free = false; doors[0].at = 5.004; doors[1].at = 5.006; doors[2].at = 99;
  seat.edge = [find(SPAWN_SEAT_REACH), (doors[0].at = 4.996, find(SPAWN_SEAT_REACH))];
  // The human's Use: within the door's own radius, and 3 m squared at most.
  doors[0].at = 3.9; doors[1].at = 4.1;
  seat.useOwnRadius = find(SPAWN_ENTER_REACH, { useEntryRadius: true });
  doors[0].radius = 12; doors[0].at = 9.5;
  seat.useSquared = find(SPAWN_ENTER_REACH, { useEntryRadius: true });
  seat.preferred = {
    tankGunner: preferredSeat('mg', { vehicleType: 'VTHeavyTank', rootId: 'tank', rootFree: true }),
    tankGunnerDriverIn: preferredSeat('mg', { vehicleType: 'VTHeavyTank', rootId: 'tank', rootFree: false }),
    apcGunner: preferredSeat('mg', { vehicleType: 'VTApc', rootId: 'lvt', rootFree: true }),
    untyped: preferredSeat('mg', { vehicleType: null, rootId: 'tank', rootFree: true }),
    hunter: preferredSeat('mg', { vehicleType: 'VTTankHunter', rootId: 'td', rootFree: true }),
  };
  // A spawner's two planes and the bake's one point (SPAWN-24): the plane on
  // the arm before the one flown off, and off only when neither has a seat.
  {
    const { pickBerth } = await import(path.join(viewer, 'spawn-seat.js'));
    const first = { name: 'first', down: false, held: true, seat: true };
    const second = { name: 'second', down: true, held: true, seat: true };
    const ask = () => {
      const r = pickBerth([first, second], { down: c => c.down, held: c => c.held, hasSeat: c => c.seat });
      return [r.pick?.name ?? null, r.none];
    };
    seat.berth = { start: ask() };
    first.seat = false; first.held = false;        // flown off, its pilot in it
    seat.berth.flown = ask();
    second.down = false;                           // the spawner stands the next one
    seat.berth.second = ask();
    first.seat = true;                             // the first one's pilot bails out
    seat.berth.bothFree = ask();
    second.seat = false; first.seat = false;
    seat.berth.bothTaken = ask();
  }
  seat.wants = [wantsSeat({ enterOnSpawn: true }), wantsSeat({ aiEnterOnSpawn: true }),
                wantsSeat({ aiEnterOnSpawn: true }, true), wantsSeat({}, true)];

  // A bot's spawn.
  let cockpit = { template: 'F6F_Hellcat', seatId: 'F6F_Hellcat' };
  const plane = { vehicle: 'F6F_Hellcat', spawner: 'airhellcatspawner', pad: 1, group: 66, team: 2,
                  name: 'hellcatpilotspawn', position: [1188, 309, -1359], rotation: [0, 0, 0],
                  enterOnSpawn: true, aiEnterOnSpawn: true, carrierLocal: [0, 0, -1] };
  Object.defineProperty(plane, 'inactive', { get: () => true });      // the human's 5 m finds nothing
  Object.defineProperty(plane, 'carrierDown', { get: () => false });  // and she is whole
  const deckSeat = { template: 'Fletcher', seatId: 'Fletcher_AA' };
  const deck = { vehicle: 'fletcher', spawner: 'destroyerspawner', pad: 2, group: 69, team: 2,
                 name: 'fletchersoldierspawn', position: [1000, 66, -1500], rotation: [0, 0, 0],
                 aiEnterOnSpawn: true };
  const flags = spawnFlags({ controlPoints: [], soldierSpawns: [], vehicleSoldierSpawns: [plane, deck] });
  const planeFlag = flags.find(f => f.group === 66);
  const deckFlag = flags.find(f => f.group === 69);
  let deckAnswer = deckSeat;
  const seatFor = spawn => (spawn === plane ? cockpit : spawn === deck ? deckAnswer : null);
  const world = { flags, players: new Map([['bot_0', { team: 2 }]]),
                  groundHeight: () => 60, collider: null, extras: {} };
  seat.bot = {
    offered: spawnOffered(planeFlag, { ai: true, seatFor }),
    pick: pickSpawn(planeFlag, 0, { ai: true, seatFor, group: 2 })?.name ?? null,
    spawned: spawnPlayer(world, 'bot_0', { flag: planeFlag, group: 2, ai: true, seatFor })?.spawn?.name ?? null,
    at: [world.players.get('bot_0').soldier.x, world.players.get('bot_0').soldier.y, world.players.get('bot_0').soldier.z],
    deckSeated: pickSpawn(deckFlag, 0, { ai: true, seatFor, group: 2 })?.name ?? null,
    // Without a way to seat him the plane is no flag of his, and the deck
    // point is the plain point it was.
    legacyPlane: spawnOffered(planeFlag, { ai: false }),
    legacyDeck: pickSpawn(deckFlag, 0, { group: 2 })?.name ?? null,
  };
  cockpit = null;                              // the pilot's seat is taken
  seat.bot.offeredTaken = spawnOffered(planeFlag, { ai: true, seatFor });
  seat.bot.spawnedTaken = spawnPlayer(world, 'bot_0', { flag: planeFlag, group: 2, ai: true, seatFor }) ?? null;
  deckAnswer = SPAWN_STANDS;                   // no seat the page can give: he stands
  seat.bot.deckStands = pickSpawn(deckFlag, 0, { ai: true, seatFor, group: 2 })?.name ?? null;
  out.seatRule = seat;
}

// Dead carriers (SPAWN-5, SPAWNGRP-10): Weapon Bunkers' Iraqi group 99 rides
// three bunkers. Each point's `inactive` is its carrier's state, as
// `hull-bodies.js` `bindCarriers` answers it in the page. A dead bunker's
// points leave the ring and the pick; with all three dead the flag is
// inactive, `pickSpawn` refuses, and the world's `spawnPlayer` spawns nobody
// there and never picks it.
{
  const { pickSpawn } = await import(path.join(viewer, 'spawn-flags.js'));
  const { spawnPlayer } = await import(path.join(viewer, 'world-players.js'));
  const down = { left: false, middle: false, right: false };
  const pt = (bunker, x) => {
    const p = { vehicle: `mil_wpbunker${bunker}_des`, spawner: `wpbunker${bunker}spawner`, pad: bunker,
                group: 99, team: 1, name: 'wb_soldierspawn', position: [x, 74, -813], rotation: [180, 0, 0] };
    Object.defineProperty(p, 'inactive', { get: () => down[bunker] });
    return p;
  };
  const extras = {
    controlPoints: [], soldierSpawns: [{ group: 2, team: 2, position: [0, 70, 0], name: 'us' }],
    vehicleSoldierSpawns: [pt('left', 400), pt('left', 402), pt('middle', 476), pt('middle', 478),
                           pt('right', 555), pt('right', 557)],
  };
  const flags = spawnFlags(extras);
  const bunkers = flags.find(f => f.vehicle);
  const state = () => ({
    inactive: bunkers.inactive,
    ring: round(bunkers.groups[0].position),
    picks: [0, 1, 2, 3, 4, 5].map(i => pickSpawn(bunkers, i)?.position?.[0] ?? null),
  });
  const world = { flags, players: new Map([['bot_0', { team: 1 }]]), groundHeight: () => 70, collider: null, extras: {} };
  const placed = () => spawnPlayer(world, 'bot_0', { flag: bunkers })?.spawn?.position?.[0] ?? null;
  out.deadCarriers = { allUp: state(), spawnAllUp: placed() };
  down.middle = true;
  out.deadCarriers.middleDown = state();
  down.left = true;
  down.right = true;
  out.deadCarriers.allDown = { ...state(), spawn: placed(),
                               defaultPick: spawnPlayer(world, 'bot_0', {})?.flag?.name ?? null };
}

// The end of a round's census (TKT-5, TKT-8): Weapon Bunkers' group 99 is
// Iraq's while a bunker stands; a dead bunker whose object is gone (`absent`,
// `bindCarriers`) takes its points out of the group, and with all three gone
// Iraq holds none. Both groups say `groupEnableToChangeTeam 0`, so neither
// side can ever take the other's.
{
  const { spawnGroupCensus } = await import(path.join(viewer, 'spawn-flags.js'));
  const gone = { left: false, middle: false, right: false };
  const pt = (bunker, x) => {
    const p = { vehicle: `mil_wpbunker${bunker}_des`, spawner: `wpbunker${bunker}spawner`, pad: bunker,
                group: 99, team: 1, name: 'wb_soldierspawn', position: [x, 74, -813], rotation: [180, 0, 0],
                changeTeam: false };
    Object.defineProperty(p, 'absent', { get: () => gone[bunker] });
    return p;
  };
  const extras = {
    controlPoints: [{ name: 'CoallitionBase', team: 2, spawnGroupId: 2, radius: 10, areaValue: 50 }],
    soldierSpawns: [{ group: 2, team: 2, position: [0, 70, 0], name: 'us', changeTeam: false }],
    vehicleSoldierSpawns: [pt('left', 400), pt('middle', 476), pt('right', 555)],
  };
  const flags = spawnFlags(extras);
  const census = { standing: spawnGroupCensus(flags) };
  gone.left = true; gone.middle = true;
  census.oneLeft = spawnGroupCensus(flags);
  gone.right = true;
  census.allGone = spawnGroupCensus(flags);
  // The same level with the default `groupEnableToChangeTeam 1`: the US group
  // is one Iraq could take, if it ever held the base.
  for (const s of extras.soldierSpawns) delete s.changeTeam;
  census.changeable = spawnGroupCensus(spawnFlags(extras));
  out.census = census;
}

process.stdout.write(JSON.stringify(out));
