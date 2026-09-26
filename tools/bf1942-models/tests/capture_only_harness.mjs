// Capture-only flags (`viewer/spawn-flags.js` `captureZone`): a control point
// that can change hands and owns no soldier spawn -- Midway's two sea areas,
// Salerno's `The_top` in Conquest and CoOp -- is a flag the capture law runs
// on and nobody spawns at (ledger SPAWNGRP-7). The control points below are
// Midway Conquest's own, from its extracted `scene.json`; a handful of spawns
// stand in for each island group, and one deck spawn for each fleet.
//
// Run by `tests/test_capture_only_flags.py`; prints one JSON object.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { viewerDir, installModuleHooks, seedMathRandom, routeConsole } = await import(path.join(HERE, '..', 'sim', 'env.mjs'));
const viewer = viewerDir(path.join(HERE, '..', 'viewer'));
installModuleHooks(viewer);
const imp = f => import(path.join(viewer, f));
const { spawnFlags } = await imp('spawn-flags.js');
const { createBotReferee } = await imp('bot-referee.js');
const { World } = await imp('world.js');
const { spawnBots } = await imp('bot.js');
const { Armor } = await imp('armor.js');
const { createSpawning } = await imp('spawning.js');
const { createFlagCapture } = await imp('capture.js');
const { createRoundState } = await imp('round-state.js');
routeConsole(true);
seedMathRandom(7);

const DT = 1 / 30;
const clone = v => JSON.parse(JSON.stringify(v));

/** A control point as `extract_map.py _control_point_report` writes one. */
const cp = (name, displayName, position, extra = {}) => ({
  name, displayName, position, rotation: [0, 0, 0], team: 0, radius: 25, areaValue: 40,
  spawnGroupId: null, secondSpawnGroupId: null, objectSpawnerId: null, unableToChangeTeam: false,
  timeToGetControl: 10, timeToLoseControl: 10, disableIfEnemyInsideRadius: false,
  disableWhenLosingControl: false, loseControlWhenEnemyClose: true, loseControlWhenNotClose: false,
  minNrToTakeControl: null, onlyTakeableByTeam: null, ...extra,
});
const spawnsAt = (group, team, [x, y, z], n) => Array.from({ length: n }, (_, i) => ({
  name: `g${group}_${i}`, group, team, spawnId: i, paratrooper: false,
  position: [x + 4 * i, y, z + 8], rotation: [0, 0, 0],
}));

const AIRFIELD = [2078.63, 24.3187, -2112.66];
const BUNKER = [1836.99, 32.9391, -1972.83];
const NORTH = [2030.71, 19.9763, -3055.48];
const SOUTH = [2033.56, 19.8993, -1032.48];
const MIDWAY = {
  worldSize: 4096,
  controlPoints: [
    cp('The_Airfield', 'Airfield', AIRFIELD, { spawnGroupId: 4, objectSpawnerId: 4 }),
    cp('The_Radar_Bunker', 'Coastal_Defences', BUNKER, { spawnGroupId: 3, objectSpawnerId: 3 }),
    cp('North_Midway', 'NORTH_SEA_AREA', NORTH, { radius: 100 }),
    cp('South_Midway', 'SOUTH_SEA_AREA', SOUTH, { radius: 100 }),
  ],
  soldierSpawns: [...spawnsAt(4, 0, AIRFIELD, 3), ...spawnsAt(3, 0, BUNKER, 3)],
  vehicleSoldierSpawns: [
    { name: 'deck_us', group: 69, team: 2, position: [2600, 30, -2100], rotation: [0, 0, 0],
      vehicle: 'enterprise', spawner: 'EnterpriseSpawner', pad: 1 },
    { name: 'deck_jp', group: 75, team: 1, position: [1400, 30, -2100], rotation: [0, 0, 0],
      vehicle: 'shokaku', spawner: 'ShokakuSpawner', pad: 2 },
  ],
};
/** Midway with no fleet: the islands' two groups are the only spawns. */
const ISLANDS = { ...MIDWAY, vehicleSoldierSpawns: [] };

const collider = { waterLevel: null, surfaceHeight: () => 0, heightfield: null };
const makeWorld = extras => new World({ collider, extras: clone(extras), groundHeight: () => 0 });
const flagName = f => f?.controlPointName ?? f?.name ?? null;
const results = {};

// --- the flags -----------------------------------------------------------------

{
  const flags = spawnFlags(clone(MIDWAY));
  results.midway = flags.map(f => ({
    name: flagName(f), captureOnly: !!f.captureOnly, team: f.team, spawns: f.spawns.length,
    group: f.group ?? null, groups: f.groups?.length ?? 0, radius: f.radius ?? null,
    uncapturable: !!f.uncapturable, timeToGetControl: f.timeToGetControl ?? null,
  }));
  // Every flag that has spawns, and its index, as it was before the sea areas
  // were flags: the same list built with the two points left out.
  const bare = { ...clone(MIDWAY), controlPoints: clone(MIDWAY.controlPoints).slice(0, 2) };
  results.spawnFlagsUnchanged = JSON.stringify(spawnFlags(bare))
    === JSON.stringify(flags.filter(f => !f.captureOnly));
}
{
  // Salerno Conquest's hill (`spawnGroupId -1`, `objectSpawnerId 3`), and the
  // two a spawnless point is not: Battle of Britain's `Allied_Base`, which
  // cannot change hands, and Cassino CTF's `openbasecammo`, placed from a
  // template the layer never defines (the exporter's `tpl is None` report).
  const extras = {
    controlPoints: [
      cp('AxisBase', 'AXIS_VILLAGE', [147.2, 80, -214.2], { team: 1, radius: 5, areaValue: 0, spawnGroupId: 1,
        unableToChangeTeam: true, timeToGetControl: 9999, timeToLoseControl: 9999, loseControlWhenEnemyClose: false }),
      cp('The_top', 'HILL_424', [447.602, 144.248, -492.623], { radius: 10, areaValue: 50, spawnGroupId: -1,
        objectSpawnerId: 3 }),
      cp('Allied_Base', 'Allied_Base', [100, 0, -10], { team: 2, radius: 50, areaValue: 150, spawnGroupId: 30,
        unableToChangeTeam: true, timeToGetControl: 9999 }),
      { name: 'openbasecammo', position: [30, 0, -160], rotation: [0, 0, 0], team: 0, displayName: 'openbasecammo',
        radius: 0.0, areaValue: 0.0, spawnGroupId: null, secondSpawnGroupId: null, objectSpawnerId: null,
        unableToChangeTeam: false, timeToGetControl: null, timeToLoseControl: null, disableIfEnemyInsideRadius: null,
        disableWhenLosingControl: null, loseControlWhenEnemyClose: null, loseControlWhenNotClose: null,
        minNrToTakeControl: null, onlyTakeableByTeam: null, flagMesh: null, flagHeight: 0.0, visible: false },
    ],
    soldierSpawns: spawnsAt(1, 1, [147.2, 80, -214.2], 2),
  };
  const flags = spawnFlags(extras);
  results.salerno = flags.map(f => ({ name: flagName(f), captureOnly: !!f.captureOnly }));
  const top = flags.find(f => f.captureOnly) ?? {};
  results.top = {
    name: top.name, controlPointName: top.controlPointName, team: top.team, group: top.group,
    groups: top.groups, spawns: top.spawns, radius: top.radius, timeToGetControl: top.timeToGetControl,
    timeToLoseControl: top.timeToLoseControl, loseControlWhenEnemyClose: top.loseControlWhenEnemyClose,
    uncapturable: top.uncapturable, position: top.position,
  };
}

// --- the law, the map's entry and the round -----------------------------------

{
  // An American alone in each sea area in turn, then on the airfield, the way
  // the page runs it: `captureTick` once a frame, and its `onCapture` hoisting
  // the flag, which writes the owner into `extras.controlPoints` (what the
  // maps draw and what the round weighs).
  const world = makeWorld(MIDWAY);
  const page = {
    extras: world.extras, currentRoot: null, world,
    drawMinimap() {}, drawFullMap() {}, paintDeployChrome() {},
  };
  const flagCapture = createFlagCapture(page);
  const events = [];
  let clock = 0;
  const referee = createBotReferee({
    world: () => world,
    onCapture: (bot, flag, prevTeam, takers) => {
      events.push({ t: +clock.toFixed(3), got: flag.team, flag: flagName(flag), from: prevTeam, takers });
      flagCapture.hoistCaptureFlag(flag);
    },
    onNeutralise: (bot, flag, prevTeam) => {
      events.push({ t: +clock.toFixed(3), lost: prevTeam, flag: flagName(flag) });
      flagCapture.hoistCaptureFlag(flag);
    },
  });
  world.addPlayer('us', { team: 2 });
  const start = flagName(world.player('us').flag);
  const standIn = (at, seconds) => {
    world.player('us').soldier.spawn(at[0], at[1], at[2], 0);
    for (let i = 0, n = Math.round(seconds / DT); i < n; i++) { clock += DT; referee.captureTick(DT); }
  };
  standIn(NORTH, 11);
  standIn(SOUTH, 11);
  standIn(AIRFIELD, 11);
  const round = createRoundState({ tickets: { team1: 100, team2: 100 }, rates: { team1: 5, team2: 5 } });
  for (let i = 0; i < 61 * 30; i++) round.tick(DT, world.extras.controlPoints);
  results.law = {
    start, events,
    teams: Object.fromEntries(world.flags.filter(f => f.controlPointName).map(f => [f.controlPointName, f.team])),
    entries: Object.fromEntries(world.extras.controlPoints.map(p => [p.name, p.team])),
    held: { ...round.held }, bleeding: { ...round.bleeding }, tickets: { ...round.tickets },
    // The same round had the sea areas stayed neutral, which they did while
    // they were no flags: the islands alone weigh 80, never over 99.
    islandsOnly: (() => {
      const r = createRoundState({ tickets: { team1: 100, team2: 100 }, rates: { team1: 5, team2: 5 } });
      const points = world.extras.controlPoints.map(p => ({ ...p, team: p.name.endsWith('_Midway') ? 0 : 2 }));
      for (let i = 0; i < 61 * 30; i++) r.tick(DT, points);
      return { held: { ...r.held }, tickets: { ...r.tickets } };
    })(),
  };
}

// --- nowhere to spawn -----------------------------------------------------------

{
  // The islands with no fleet, the Americans holding North_Midway and nothing
  // else: the world's own pick goes to a neutral island flag, and a sea area
  // handed in is taken as no choice.
  const world = makeWorld(ISLANDS);
  const north = world.flags.find(f => f.controlPointName === 'North_Midway');
  north.team = 2;
  const own = world.addPlayer('us', { team: 2 });
  const picked = { flag: flagName(own.flag), team: own.team, spawn: own.spawn?.name ?? null };
  const asked = world.spawnPlayer('us', { flag: north });
  results.spawnPlayer = { picked, asked: { flag: flagName(asked?.flag), spawn: asked?.spawn?.name ?? null } };
}
{
  // An EoD-shaped point that starts on a side and owns no spawns: the bots
  // of that side start and respawn at the flags that have spawns.
  const extras = clone(ISLANDS);
  extras.controlPoints[2].team = 2;
  const world = makeWorld(extras);
  const bots = spawnBots({ world, count: 4, teams: [1, 2], flags: world.flags });
  const referee = createBotReferee({ world: () => world, armorFor: () => new Armor(30) });
  referee.bots = bots;
  const starts = bots.map(b => ({ id: b.playerId, team: b.team, flag: flagName(world.player(b.playerId)?.flag),
    spawned: !!world.player(b.playerId)?.spawn }));
  const respawns = [];
  for (const bot of bots.filter(b => b.team === 2)) {
    for (let i = 0; i < 20; i++) {
      world.setPlayerArmor(bot.playerId, new Armor(30, 0));
      bot._respawnIn = 0;
      referee.respawnTick(bot, DT);
      const record = world.player(bot.playerId);
      respawns.push({ flag: flagName(record.flag), atSpawn: !!record.flag?.spawns.some(s =>
        Math.hypot(s.position[0] - bot.position[0], s.position[2] - bot.position[2]) < 1e-6) });
    }
  }
  results.bots = { starts, respawns };
}

// --- the deploy screen ----------------------------------------------------------

{
  const world = makeWorld(ISLANDS);
  const noop = () => {};
  const element = () => ({ addEventListener: noop, blur: noop, setAttribute: noop, disabled: false,
    classList: { add: noop, remove: noop }, dataset: {} });
  const select = {
    value: '', selectedIndex: -1, hidden: false, options: [],
    set innerHTML(_) { this.options = []; this.value = ''; },
    appendChild(option) { this.options.push(option); if (this.value === '') this.value = option.value; },
  };
  globalThis.document = { createElement: () => ({}), activeElement: null, body: {} };
  const page = {
    get flags() { return world.flags; },
    refreshFlags: () => world.flags.length,
    spawnFlagSelect: select, world, worldReady: true, soldier: null, soldierDead: false,
    params: new URLSearchParams(''), deployTabs: [], deployKitHits: [],
    deploySuicideBtn: element(), deployResumeBtn: element(), deployScoreBtn: element(),
    fullmapCanvas: element(), fullmapBox: element(),
    deployActive: () => false, paintDeployChrome: noop, drawFullMap: noop, toggleFullMap: noop,
    layoutDeploy: noop, kitRowLabelFor: () => '', kitRowLayoutText: () => '',
  };
  const spawning = createSpawning(page);
  const [, , north, south] = world.flags;
  north.team = 1;
  south.team = 1;
  // The Axis hold both sea areas and neither side an island: nobody has a
  // spawn of his own, so the fresh join takes the default side, not the
  // Axis, and the select lists the two islands alone.
  spawning.openDeploy();
  results.deploy = {
    team: spawning.deployTeamId,
    options: select.options.map(o => o.value),
    built: spawning.buildSpawnFlags(),
    axisTab: (spawning.setDeployTeam(1, false), spawning.deployFlagIndices()),
    selectSea: spawning.selectDeployFlag(world.flags.indexOf(north)),
    selectIsland: spawning.selectDeployFlag(0),
    selected: select.value,
  };
}

process.stdout.write(JSON.stringify(results));
