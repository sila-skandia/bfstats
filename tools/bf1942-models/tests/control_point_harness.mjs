// `ControlPoint::handleFrameUpdate` 0x08283b00 as the referee runs it
// (viewer/bot-referee.js `controlPointStep`), frame by frame at 30 Hz on a
// hand-made flag. Run by `tests/test_control_point_law.py`; prints one JSON
// object.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { viewerDir, installModuleHooks } = await import(path.join(HERE, '..', 'sim', 'env.mjs'));
const viewer = viewerDir(path.join(HERE, '..', 'viewer'));
installModuleHooks(viewer);
const { controlPointStep, controlPointSettings } = await import(path.join(viewer, 'bot-referee.js'));
const { spawnFlags, pickSpawn, flagSide, spawnGroupCensus } = await import(path.join(viewer, 'spawn-flags.js'));
const { createRoundState } = await import(path.join(viewer, 'round-state.js'));

const DT = 1 / 30;

/** Run `seconds` with the same players on the flag; the events and the team. */
function run(flag, teams, seconds) {
  const events = [];
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
    const ev = controlPointStep(flag, teams, DT);
    if (ev) events.push({ t: +((i + 1) * DT).toFixed(3), ...ev });
  }
  return { team: flag.team, events };
}

const flag = (team, extra = {}) => ({ name: 'F', team, position: [0, 0, 0], radius: 50, timeToGetControl: 10, ...extra });

const results = {
  defaults: controlPointSettings({}),
  // A neutral flag, one Allied soldier: taken after timeToGetControl.
  neutralTaken: run(flag(0), [2], 11),
  // An Axis flag, one Allied soldier alone: run down over timeToLoseControl
  // (the default 5 s), then taken over the next 10 s.
  ownedTaken: run(flag(1), [2], 16),
  // The Axis tank and the Allied tank both on an Axis flag, the vanilla
  // `loseControlWhenEnemyClose 1`: it runs down to neutral and then stays
  // neutral while both are there (two teams, no owner: nothing moves).
  contested: run(flag(1), [1, 2], 120),
  // The same with `loseControlWhenEnemyClose 0`: the defender holds it.
  contestedHeld: run(flag(1, { loseControlWhenEnemyClose: false }), [1, 2], 120),
  // Nobody there: an owned flag is held; with `loseControlWhenNotClose` it runs down.
  empty: run(flag(1), [], 30),
  emptyLoses: run(flag(1, { loseControlWhenNotClose: true, timeToLoseControl: 3 }), [], 5),
  // Two Allied attackers against `minNrToTakeControl 3`: never taken.
  tooFew: run(flag(0, { minNrToTakeControl: 3 }), [2, 2], 30),
  // `onlyTakeableByTeam 1`: the Allies cannot take it.
  onlyAxis: run(flag(0, { onlyTakeableByTeam: 1 }), [2], 30),
  // `timeToGetControl 0` (DC Medina Ridge): taken on the first frame.
  instant: run(flag(0, { timeToGetControl: 0 }), [2], 0.5),
  instantSettings: controlPointSettings(flag(0, { timeToGetControl: 0 })),
};

// Forgotten Hope's push maps (features/fh-mod-extraction), with the numbers
// from the archives. Gold Beach's `front`: neutral, `onlyTakeableByTeam 2`,
// 10 s to get and lose, enemy-close on. The British take it; the Germans can
// neither run it down alone nor with a British defender on it.
{
  const front = () => flag(0, { onlyTakeableByTeam: 2, timeToGetControl: 10, timeToLoseControl: 10, loseControlWhenEnemyClose: true });
  const f = front();
  results.gbFrontGermansFirst = run(front(), [1], 30);
  results.gbFrontTaken = run(f, [2], 11);
  results.gbFrontGermansAlone = run(f, [1], 60);
  results.gbFrontContested = run(f, [1, 2], 60);
  results.gbFrontGermansNothing = run(f, [], 60);
  // A German point of Gold Beach's Conquest layer: team 1, get 0, lose 5,
  // radius 6, `loseControlWhenEnemyClose 0`, no `onlyTakeableByTeam`. A
  // German on it holds it against any number of British; the British alone
  // run it down in 5 s and own it the next frame; the Germans alone take it
  // back the same way.
  const bunker = () => flag(1, { radius: 6, timeToGetControl: 0, timeToLoseControl: 5, loseControlWhenEnemyClose: false });
  const b = bunker();
  results.gbBunkerHeld = run(bunker(), [1, 2, 2], 60);
  results.gbBunkerTaken = run(b, [2], 6);
  results.gbBunkerRetaken = run(b, [1], 6);
  // The `beach`: team 2, 9999 s both ways, enemy-close off.
  const beach = () => flag(2, { radius: 5, timeToGetControl: 9999, timeToLoseControl: 9999, loseControlWhenEnemyClose: false, unableToChangeTeam: true });
  results.gbBeachGermans = run(beach(), [1], 600);
  // Omaha's `beach`: neutral, `onlyTakeableByTeam 2`, minNr 2, get 15, lose 99.
  const oBeach = () => flag(0, { onlyTakeableByTeam: 2, minNrToTakeControl: 2, timeToGetControl: 15, timeToLoseControl: 99, loseControlWhenEnemyClose: true });
  const o = oBeach();
  results.omahaBeachOneSoldier = run(oBeach(), [2], 60);
  results.omahaBeachTaken = run(o, [2, 2], 16);
  results.omahaBeachGermansAfter = run(o, [1, 1, 1], 200);
  // FHR-1: nobody inside, `loseControlWhenNotClose` and `onlyTakeableByTeam`:
  // the engine's `losingControl(-1)` is refused, so it is held.
  // FHR-4: `unableToChangeTeam` (`ControlPoint::setTeam` is a no-op) with
  // 10 s timers, XPack2 Essen's `allies` and Prokhorovka's `3rd_ss`: an enemy
  // alone on it runs it down with its spawns off and the team stays; he
  // leaves and the spawns are back.
  {
    const base = flag(2, { uncapturable: true, controlPointName: 'allies', timeToGetControl: 10, timeToLoseControl: 10, loseControlWhenEnemyClose: true });
    const down = run(base, [1], 12);
    results.fixedRunDown = { ...down, spawnsEnabled: base.spawnsEnabled };
    results.fixedStillThere = { ...run(base, [1], 30), spawnsEnabled: base.spawnsEnabled };
    results.fixedLeft = { ...run(base, [], 1), spawnsEnabled: base.spawnsEnabled };
    // A point the level makes unable with the 9999 timers never moves.
    const main = flag(1, { uncapturable: true, controlPointName: 'main', timeToGetControl: 9999, timeToLoseControl: 9999, loseControlWhenEnemyClose: false });
    results.fixedMain = { ...run(main, [2], 300), spawnsEnabled: main.spawnsEnabled };
  }
  results.notCloseOnlyTeam = run(flag(1, { onlyTakeableByTeam: 2, loseControlWhenNotClose: true, timeToLoseControl: 3 }), [], 10);
}

// A level's own settings through the page's flag list (spawn-flags.js, the
// scene's `controlPoints` as the exporter writes them): El Alamein's
// `timeToLoseControl 10`. One Allied soldier alone on the Axis point runs
// it down over 10 s, not the ctor's 5, then takes it over the next 10.
{
  const extras = {
    controlPoints: [{ name: 'CP', displayName: 'CP', position: [0, 0, 0], team: 1, radius: 50, spawnGroupId: 1,
                      timeToGetControl: 10, timeToLoseControl: 10, loseControlWhenEnemyClose: true,
                      loseControlWhenNotClose: false, minNrToTakeControl: null, onlyTakeableByTeam: null }],
    soldierSpawns: [{ name: 'S', group: 1, team: 1, position: [0, 0, 0] }],
  };
  const [f] = spawnFlags(extras);
  results.levelFlag = { settings: controlPointSettings(f), ...run(f, [2], 21) };
  // A scene extracted before the exporter carried the field: the default.
  const old = { ...extras, controlPoints: [{ ...extras.controlPoints[0], timeToLoseControl: undefined }] };
  results.oldScene = controlPointSettings(spawnFlags(old)[0]);
}

// Kasserine Pass SinglePlayer's `axis_base` and `allied_base`, as the
// exporter writes them: two spawn groups each, all four listed under the
// point's own side at the start (ledger SPAWNGRP-4). The engine enables one
// group per holder -- the first for team 1, the second for team 2 -- and a
// point going neutral zeroes both. Each step records which groups the flag
// offers, the group `pickSpawn` lands on, and every group's side.
{
  const spawn = (group, team, i) => ({ name: `s${group}_${i}`, group, team, position: [i, 0, 0] });
  const extras = {
    controlPoints: [
      { name: 'axis_base', team: 1, position: [0, 0, 0], radius: 50, spawnGroupId: 1, secondSpawnGroupId: 6 },
      { name: 'allied_base', team: 2, position: [500, 0, 0], radius: 50, spawnGroupId: 2, secondSpawnGroupId: 7 },
      { name: 'kasserine', team: 0, position: [250, 0, 0], radius: 50, spawnGroupId: 3, secondSpawnGroupId: null },
    ],
    soldierSpawns: [
      ...[0, 1, 2].map(i => spawn(1, 1, i)), ...[0, 1].map(i => spawn(6, 1, i)),
      ...[0, 1, 2].map(i => spawn(2, 2, i)), ...[0, 1].map(i => spawn(7, 2, i)),
      ...[0, 1].map(i => spawn(3, 0, i)),
    ],
  };
  const flags = spawnFlags(extras);
  const [axis, allied, village] = flags;
  const state = f => ({
    team: f.team,
    offered: [...new Set(f.spawns.map(s => s.group))],
    picked: pickSpawn(f, 0)?.group ?? null,
    groupTeams: f.groupTeams,
  });
  const steps = { start: state(axis) };
  // An Allied soldier alone on it: run down to neutral, then taken.
  const events = run(axis, [2], 25).events;
  steps.captured = { ...state(axis), events };
  // The Axis walk back in: neutral again, then theirs.
  run(axis, [1], 25);
  steps.retaken = state(axis);
  // A net-room decree writes the new side straight over the old one.
  axis.team = 2;
  steps.decreed = state(axis);
  allied.team = 0;
  steps.alliedLost = state(allied);
  allied.team = 1;
  steps.alliedTakenByAxis = state(allied);
  steps.alliedStart = state(spawnFlags(extras)[1]);
  village.team = 2;
  steps.village = state(village);
  results.kasserine = steps;
}

// A point that opens neutral keeps its groups on their `groupTeam` (ledger
// SPAWN-19: `ControlPoint::init` runs nothing for team 0; SPAWNGRP-4). FHSW's
// Crete SinglePlayer sets every point `setTeam 0`: Suda Bay's group 1 is
// `groupTeam 2`, the German airbase's group 2 `groupTeam 1`. Each side spawns
// on its own groups' points while the flag stays neutral; a capture hands
// the group over and losing the point zeroes it, as any point. A neutral
// point whose group is `groupTeam 0` (vanilla's) still offers every point
// and no side.
{
  const spawn = (group, team, i) => ({ name: `c${group}_${i}`, group, team, position: [i, 0, 0] });
  const extras = {
    controlPoints: [
      { name: 'suda_bay', team: 0, position: [0, 0, 0], radius: 20, spawnGroupId: 1 },
      { name: 'airbase', team: 0, position: [500, 0, 0], radius: 20, spawnGroupId: 2, unableToChangeTeam: true },
      { name: 'village', team: 0, position: [250, 0, 0], radius: 20, spawnGroupId: 3 },
    ],
    soldierSpawns: [
      ...[0, 1].map(i => spawn(1, 2, i)), ...[0, 1, 2].map(i => spawn(2, 1, i)), ...[0, 1].map(i => spawn(3, 0, i)),
    ],
  };
  const [suda, airbase, village] = spawnFlags(extras);
  const state = f => ({ team: f.team, side: flagSide(f), offered: [...new Set(f.spawns.map(s => s.group))],
    groupTeams: f.groupTeams });
  const out = { suda: state(suda), airbase: state(airbase), village: state(village),
    census: spawnGroupCensus([suda, airbase, village]) };
  run(suda, [1], 11);
  out.sudaTakenByAxis = state(suda);
  run(suda, [2], 25);
  out.sudaRetaken = state(suda);
  suda.team = 0;
  out.sudaLost = state(suda);
  results.neutralGroupTeams = out;
}

// A fixed base run down ends the round when its side has nobody alive (FHR-4,
// SPAWN-22, TKT-5, TKT-8). FHSW's Falaise Pocket co-op layer (inherited from
// FHSW's `SinglePlayer/`): `allied_base` is team 2, `unableToChangeTeam 1`,
// `timeToLoseControl 25`, `loseControlWhenEnemyClose 0`, group 2 (the Allies'
// only one; `groupTeam 2`, `groupEnableToChangeTeam` left at the ctor's 1);
// the German point holds group 1; the three middle points are neutral; every
// `areaValue` is 30, so neither side's weight reaches 100 and nobody bleeds
// in normal play. Tickets 100 / 90, 10 a minute, 16 slots. One German alone
// on the base: `lostControl` -> `CPDisable` writes 0 into group 2's team at
// 25 s, the Allies hold no group, and with nobody of theirs alive they bleed
// at the at-end 1000 a minute once the full 6 s countdown the shut gate left
// runs out: 90 tickets gone at 25 + 6 + 89 x 0.06 = 36.3 s. With one Ally
// alive anywhere they do not bleed (the German weight is 30), and with
// nobody on the base nothing moves.
{
  const point = (name, team, group, extra = {}) => ({ name, displayName: name, team, position: [group * 300, 0, 0], radius: 20,
    areaValue: 30, spawnGroupId: group, timeToGetControl: 15, timeToLoseControl: 10, loseControlWhenEnemyClose: true,
    loseControlWhenNotClose: false, minNrToTakeControl: null, onlyTakeableByTeam: null, ...extra });
  const extras = () => ({
    controlPoints: [
      point('south_center_flag', 1, 1),
      point('allied_base', 2, 2, { unableToChangeTeam: true, timeToGetControl: 20, timeToLoseControl: 25, loseControlWhenEnemyClose: false }),
      point('north_west_flag', 0, 3), point('north_center_flag', 0, 4), point('north_east_flag', 0, 5),
    ],
    soldierSpawns: [[1, 1], [1, 1], [2, 2], [2, 2], [3, 0], [4, 0], [5, 0]]
      .map(([group, team], i) => ({ name: `s${i}`, group, team, position: [group * 300 + i, 0, 0] })),
  });
  const play = (onBase, alliesAlive, seconds) => {
    const flags = spawnFlags(extras());
    const base = flags.find(f => f.name === 'allied_base');
    const round = createRoundState({ mode: 'CoOp', tickets: { team1: 100, team2: 90 }, rates: { team1: 10, team2: 10 } });
    let t = 0, runDown = null;
    while (t < seconds && round.status === 'playing') {
      for (const f of flags) controlPointStep(f, f === base ? onBase : [], DT);
      t += DT;
      if (runDown == null && base.spawnsEnabled === false) runDown = +t.toFixed(2);
      const census = spawnGroupCensus(flags);
      round.tick(DT, flags, { 1: { ...census[1], alive: true }, 2: { ...census[2], alive: alliesAlive } });
    }
    return { seconds: +t.toFixed(2), runDown, status: round.status, winner: round.winner,
      tickets: { ...round.tickets }, baseTeam: base.team, census: spawnGroupCensus(flags) };
  };
  results.fixedBaseRound = {
    nobodyOnIt: play([], false, 120),
    germanAloneNoAllies: play([1], false, 120),
    germanAloneAllyAlive: play([1], true, 120),
  };
}

// The old per-bot law on the contested case: two timers, one a bot, each
// taking the flag from the other every timeToGetControl.
{
  const f = flag(1);
  const timers = { 1: 0, 2: 0 };
  let trades = 0;
  for (let i = 0; i < 120 / DT; i++) {
    for (const team of [1, 2]) {
      if (f.team === team) { timers[team] = 0; continue; }
      timers[team] += DT;
      if (timers[team] >= 10) { f.team = team; timers[team] = 0; trades++; }
    }
  }
  results.oldLawTrades = trades;
}

// A point's spawns while it is being taken (SPAWN-22). Telemark's bridge
// points say `disableWhenLosingControl 1`: an Allied soldier alone on the
// Axis point runs it down with its spawns off, and the Axis defender
// stepping back on (no enemy now) holds it and turns them on again. Basrah's
// Edge's US base says `loseControlWhenEnemyClose 0` and
// `disableIfEnemyInsideRadius 1`: a defender and an enemy both on it hold it
// with its spawns off. A point without either keeps them on throughout.
{
  const extras = {
    controlPoints: [
      { name: 'axis_BASE_bridge', team: 1, spawnGroupId: 8, radius: 15, areaValue: 10,
        timeToLoseControl: 10, disableWhenLosingControl: true },
      { name: 'USspawn', team: 2, spawnGroupId: 1, radius: 15, areaValue: 10,
        disableWhenLosingControl: true, disableIfEnemyInsideRadius: true, loseControlWhenEnemyClose: false },
      { name: 'plain', team: 1, spawnGroupId: 3, radius: 15, areaValue: 10, timeToLoseControl: 10 },
    ],
    soldierSpawns: [
      { group: 8, team: 1, position: [0, 0, 0], name: 'bridge' },
      { group: 1, team: 2, position: [100, 0, 0], name: 'us' },
      { group: 3, team: 1, position: [200, 0, 0], name: 'plain' },
    ],
  };
  const flags = spawnFlags(extras);
  const [bridge, us, plain] = flags;
  const spawns = f => f.spawns.length;
  const step = (f, teams, seconds) => { for (let i = 0; i < Math.round(seconds / DT); i++) controlPointStep(f, teams, DT); };
  const out = { start: [bridge, us, plain].map(f => [f.spawnsEnabled, spawns(f)]) };
  step(bridge, [2], 3);
  step(plain, [2], 3);
  out.losing = { bridge: [bridge.team, bridge.spawnsEnabled, spawns(bridge), bridge._cp.state],
                 plain: [plain.team, plain.spawnsEnabled, spawns(plain)] };
  step(bridge, [1], 1);
  out.held = [bridge.team, bridge.spawnsEnabled, spawns(bridge), bridge._cp.state];
  step(bridge, [2], 11);
  out.lost = [bridge.team, bridge.spawnsEnabled, spawns(bridge)];
  step(us, [2, 1], 2);
  out.contested = [us.team, us.spawnsEnabled, spawns(us), us._cp.state];
  step(us, [2], 1);
  out.cleared = [us.team, us.spawnsEnabled, spawns(us)];
  results.switched = out;
}

process.stdout.write(JSON.stringify(results));
