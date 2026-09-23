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
const { spawnFlags } = await import(path.join(viewer, 'spawn-flags.js'));

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
};

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

process.stdout.write(JSON.stringify(results));
