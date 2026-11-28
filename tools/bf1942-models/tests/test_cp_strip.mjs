// The control point strip under the minimap (viewer/cp-strip.js, ledger
// HUD-32): retail's tally, main bases left out, each side from its own end.
// Run by test_cp_strip.py.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { cpStripSlots } from '../viewer/cp-strip.js';
import { createTicketFeed } from '../viewer/ticket-feed.js';
import { CONTROL_POINTS_DEFAULT } from '../viewer/hud.js';

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

// Retail draws the strip as its own `menu/InGame` node under the minimap
// frame (a 2026-11-28 report: ours sat inside the minimap). The HUD's
// fallback group is vanilla's node as `extract_hud_layout.py` decodes it:
// the plate at (620,207) and seven 16x8 slots at y 211.
// The extracted pack is not in git (a checkout with the asset tree checks it).
const layoutUrl = new URL('../viewer/maps/_shared/hud/hud-layout.json', import.meta.url);
if (existsSync(layoutUrl)) {
  const layout = JSON.parse(readFileSync(layoutUrl));
  assert.deepEqual(layout.groups.controlPoints?.elements, CONTROL_POINTS_DEFAULT.elements);
}
assert.deepEqual(CONTROL_POINTS_DEFAULT.elements[0].rect, [620, 207, 256, 16]);
assert.deepEqual(CONTROL_POINTS_DEFAULT.elements.slice(1).filter((_, i) => i % 3 === 0).map(e => e.rect[0]),
  [634, 657, 679, 702, 723, 744, 765]);

// The feed writes the layout's variables: Hellendoorn's seven, three blue,
// one grey, three red, as the owner's retail capture shows them.
const page = {
  extras: { gameplayMode: 'Conquest', controlPoints: [cp(2), cp(1), cp(2), cp(0), cp(1), cp(2), cp(1)] },
  bfmap: { z: 0 }, minimapDisk: false,
};
const feed = createTicketFeed(page);
const vars = {};
assert.equal(feed.feedControlPointVars(vars), true);
assert.equal(vars['Radio/NumberOfControlPoints'], 7);
assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(i => vars[`ControlPoint/ControlPoint${i}`]), [2, 2, 2, 0, 1, 1, 1]);
// Down with the full-screen map open, on a phone's disk, and in CTF.
page.bfmap.z = 1;
assert.equal(feed.feedControlPointVars({}), false);
page.bfmap.z = 0; page.minimapDisk = true;
assert.equal(feed.feedControlPointVars({}), false);
page.minimapDisk = false; page.extras.gameplayMode = 'Ctf';
assert.equal(feed.feedControlPointVars({}), false);
console.log('ok');
