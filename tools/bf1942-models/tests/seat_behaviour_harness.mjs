// Seated bots (features/bot-map-generation/seat-behaviour.md): the fire
// correction's view of a round that struck past its target, and the
// behaviours and Fire rule a seat's `AIbehaviours.con` row gives it.
//
// Run by `tests/test_seat_behaviour.py` on the module set `test_bot_ai.py`
// stages. Output is one JSON object on stdout.

import * as aiming from './bot-aim.js';
import { AI_ROWS, rowFor, rowsOf } from './bot-rows.js';
import { fireMode } from './bot-perception.js';
import { registered, REGISTERED } from './bot-decision.js';

const r3 = v => Math.round(v * 1e3) / 1e3;

/** A seated gunner 50 m from a soldier: one round seen at 33 m, gone the
 *  next tick, its hit 3 m past the target (the wall behind it). */
function roundPastTarget(useLanding) {
  const group = { input: 'c_fire', stats: {} };
  const shot = { group, mesh: { position: { x: 0, y: 1, z: 33 } }, velocity: { x: 0, y: 0, z: 1000 }, travelled: 33 };
  const guns = { tracers: [shot], projectiles: [], hits: [] };
  const bot = { vehicle: { groups: [group] }, weapons: [], weaponIndex: 0, firingTarget: 'target',
                world: { guns, players: new Map() }, senses: {} };
  const rec = aiming.fireCorrection(bot);
  aiming.newCorrectionTarget(rec, 'target');
  rec.aimPoint = [0, 1, 50];                // the aim statement's predicted target
  aiming.trackOwnRounds(bot, 1.0);          // the round is taken, 33 m out
  guns.tracers = [];
  guns.hits = [{ firerGroup: group, point: [0.3, 1.2, 53], kind: 'object', target: null, owner: 7 }];
  if (!useLanding) {
    // The watch as it was: the round judged at its last sampled point.
    const round = rec.round;
    rec.round = null;
    rec.pre = round.pre; rec.post = round.pre; rec.target = round.target; rec.origin = round.start;
    rec.maxHeight = round.maxHeight; rec.resolved = true; rec.fresh = true; rec.passed = false; rec.observed++;
  } else {
    aiming.trackOwnRounds(bot, 1.1);        // gone: its fate is the hit
  }
  const passed = rec.passed;
  const sum = aiming.correctAim(bot, 1.1);
  return { passed, sum: sum.map(r3) };
}

const landing = (() => {
  const round = { start: [0, 0, 0], dist2: 2500, pre: [0, 0, 0], post: null, passed: false, maxHeight: 0, last: [0, 0, 0] };
  const past = aiming.landRound({ ...round }, [0, 0.5, 53]);
  const short = aiming.landRound({ ...round }, [0, 0.2, 20]);
  return { past: { passed: past.passed, post: past.post, last: past.last },
           short: { passed: short.passed, pre: short.pre, post: short.post } };
})();

const rowCase = (mod, equipment, equipmentType) => rowFor({ mod, equipment, equipmentType });
const rows = {
  bf1918Gunner: rowCase('bf1918', 'Gunner', 9),
  bf1918ByNumber: rowCase('bf1918', null, 9),
  vanilla9: rowCase('bf1942', null, 9),
  vanilla4: rowCase('bf1942', null, 4),
  dc4: rowCase('DesertCombat', null, 4),
  fh20: rowCase('FH', null, 20),
  fhTank: rowCase('FH', null, 0),
  unknown: rowCase('bf1942', null, 99),
  none: rowCase('bf1942', null, null),
};
const mode = row => fireMode({ row, drives: false, kind: 'gun' });
const fire = {
  bf1918Gunner: mode(rows.bf1918Gunner),
  vanilla9: mode(rows.vanilla9),
  vanilla4: mode(rows.vanilla4),
  fh20: mode(rows.fh20),
  bf1918Artillery: mode(rowCase('bf1918', 'Artillery', 7)),
  // A seat with no row: vanilla's numbers, as before.
  numberOnly9: fireMode({ equipmentType: 9 }),
  numberOnly4: fireMode({ equipmentType: 4 }),
};
const reg = vehicle => registered({ vehicle });
const behaviours = {
  foot: registered({ vehicle: null }),
  vanillaFixed: reg({ kind: 'gun', row: rows.vanilla4 }),
  vanillaTank: reg({ kind: 'tank', row: rowCase('bf1942', null, 0) }),
  vanillaPassenger: reg({ kind: 'ground', row: rowCase('bf1942', null, 8) }),
  vanillaCar: reg({ kind: 'ground', row: rowCase('bf1942', null, 5) }),
  fhTank: reg({ kind: 'tank', row: rows.fhTank }),
  bf1918HeavyTank: reg({ kind: 'tank', row: rowCase('bf1918', 'HeavyTank', 0) }),
  plane: reg({ kind: 'air', row: rowCase('bf1942', null, 1) }),
  noRow: reg({ kind: 'tank', row: null }),
};

process.stdout.write(JSON.stringify({
  landing,
  correction: { landed: roundPastTarget(true), sampled: roundPastTarget(false) },
  rows, fire, behaviours, REGISTERED,
  table: Object.fromEntries(Object.keys(AI_ROWS).map(k => [k, rowsOf(k)])),
}) + '\n');
