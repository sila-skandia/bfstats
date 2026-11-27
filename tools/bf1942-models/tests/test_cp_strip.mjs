// The control point strip under the minimap (viewer/cp-strip.js, ledger
// HUD-32): retail's tally, main bases left out, each side from its own end.
// Run by test_cp_strip.py.
import assert from 'node:assert/strict';
import { cpStripSlots } from '../viewer/cp-strip.js';

const cp = (team, base = false) => ({ team, unableToChangeTeam: base });

// Berlin-like: two uncapturable bases, five flags held 1, 2, 1, 0, 1 in the
// level's own order. Bases are no slot; team 2 from the left, team 1 from
// the right, the neutral one between.
assert.deepEqual(cpStripSlots([cp(1, true), cp(1), cp(2), cp(1), cp(0), cp(1), cp(2, true)], 'Conquest'),
  [2, 0, 1, 1, 1]);
// The level's order does not move a slot.
assert.deepEqual(cpStripSlots([cp(0), cp(1), cp(1), cp(2), cp(1)], 'Conquest'),
  cpStripSlots([cp(1), cp(2), cp(1), cp(0), cp(1)], 'Conquest'));
// All neutral at the start of a round.
assert.deepEqual(cpStripSlots([cp(0), cp(0), cp(0)], 'Conquest'), [0, 0, 0]);
// Seven slots at most, filled as retail's array then cut.
assert.deepEqual(cpStripSlots(Array.from({ length: 9 }, () => cp(1)), 'Conquest'), [1, 1, 1, 1, 1, 1, 1]);
assert.deepEqual(cpStripSlots([...Array(8)].map((_, i) => cp(i < 2 ? 2 : 0)).concat(cp(1)), 'Conquest'),
  [2, 2, 0, 0, 0, 0, 0]);
// Co-op and Objective show it; CTF and TDM do not.
assert.equal(cpStripSlots([cp(1)], 'CoOp').length, 1);
assert.equal(cpStripSlots([cp(1)], 'ObjectiveMode').length, 1);
assert.deepEqual(cpStripSlots([cp(1)], 'Ctf'), []);
assert.deepEqual(cpStripSlots([cp(1)], 'TDM'), []);
// No layer named plays as Conquest; no points, no strip.
assert.deepEqual(cpStripSlots([cp(2)], undefined), [2]);
assert.deepEqual(cpStripSlots(undefined, 'Conquest'), []);
console.log('ok');
