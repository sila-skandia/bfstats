// Pins `bot-units.js` `aiOf`: a vehicle root finds its AI record by its
// template's own name before an instance suffix is cut. DC Final's
// `Howitzer_155` is a template whose name ends in digits, and cutting `_155`
// first looked up `howitzer`, which no record answers, so no bot ever took
// the gun. A placed copy's suffix (`Sherman_3`) is still cut. A hull whose
// own record `extract_vehicle_ai.py` keys by its template (DC Final's `OH-6`,
// one of five hulls in the `H-6` folder whose record lists it as a seat)
// finds that record, not the folder's.
//
// The viewer modules load straight out of `viewer/` through the runner's
// module hooks (`sim/env.mjs`). Run by `tests/test_bot_units_ai_of.py`.
// One JSON object on stdout.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadViewerModules, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
await loadViewerModules(viewer);
const { createBotUnits } = await import(pathToFileURL(path.join(viewer, 'bot-units.js')).href);

const units = createBotUnits({ referee: () => null });
const records = {
  Howitzer_155: { seatsAi: { Howitzer_155: {} } },
  Howitzer: { seatsAi: { Howitzer: {} } },
  Sherman: { seatsAi: { Sherman: {}, shermanBrowning_PCO1: {} } },
  'H-6': { aiTemplate: 'AH6', seatsAi: { 'AH-6': {}, 'OH-6': {}, H6CoPilot: {} } },
  'OH-6': { aiTemplate: 'OH6', seatsAi: { 'OH-6': {}, H6CoPilot: {} } },
  A10_B: { aiTemplate: 'A10', seatsAi: { A10_B: {} } },
};
units.ai = new Map(Object.entries(records).map(([name, info]) => [name.toLowerCase(), { name, ...info }]));

const nameOf = node => units.aiOf(node)?.name ?? null;
console.log(JSON.stringify({
  howitzer155: nameOf({ name: 'x', userData: { control: 'Howitzer_155' } }),
  shermanCopy: nameOf({ name: 'Sherman_3', userData: {} }),
  shermanSeat: nameOf({ name: 'y', userData: { control: 'shermanBrowning_PCO1' } }),
  unknown: nameOf({ name: 'Crate_2', userData: {} }),
  ownRecord: nameOf({ name: 'z', userData: { template: 'OH-6' } }),
  folderHull: nameOf({ name: 'AH-6_1', userData: {} }),
  variant: nameOf({ name: 'A10_B_4', userData: {} }),
}));
