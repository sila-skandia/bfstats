// Pins the route probe (`sim/routeprobe.mjs`, features/bot-map-generation):
// the page's own planner asked whether a bot's route to a flag closes, and
// how much of it one standing teammate shuts. Run by
// `tests/test_route_probe.py`. One JSON object on stdout.
//
// The map is written by hand as pixels, encoded as the engine's search-map
// file and read back by the page's own loader (`viewer/nav-grid.js
// buildNavMap`), the way the generator hands its own map to the page.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const imp = rel => import(pathToFileURL(path.join(HERE, '..', rel)).href);
const gen = await imp('sim/botgen.mjs');
const rp = await imp('sim/routeprobe.mjs');
const lint = await imp('sim/botlint.mjs');
const nav = await imp('viewer/nav-grid.js');

const SIZE = 256;
const flat = { waterLevel: null, surfaceHeight() { return 0; }, heightfield: null };
/** A map from free rectangles `[x0, x1, z0, z1]` (cells, engine z down the page), everything else blocked. */
async function mapOf(rects) {
  const pixels = new Uint8Array(SIZE * SIZE).fill(1);
  for (const [x0, x1, z0, z1] of rects) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) pixels[z * SIZE + x] = 0;
  const searchMap = await gen.layerInfantryMap(null, null, gen.encodeSearchMap(pixels, SIZE, 0));
  return nav.buildNavMap(flat, SIZE, { searchMap, baked: true });
}
const at = (x, z) => [x + 0.5, -(z + 0.5)];

// A field on the west; from it a passage two cells wide and 100 m long to
// a room (the tower), and one nine cells wide to another (the yard); a room
// nothing joins (the vault).
const FIELD = [10, 120, 10, 240];
const level = await mapOf([
  FIELD,
  [121, 219, 60, 61], [220, 230, 56, 66],        // the narrow passage and the tower's room
  [121, 219, 180, 188], [220, 230, 178, 190],    // the wide passage and the yard
  [200, 210, 120, 130],                          // the vault
]);
const T = await rp.probeTools();
const out = { tools: { radius: T.radius, widenings: T.widenings, teammate: T.teammate, chokeMax: rp.CHOKE_MAX } };

const spawns = [{ side: 1, x: 20.5, z: -30.5 }, { side: 2, x: 20.5, z: -220.5 }];
const orders = { Field: at(100, 125), Tower: at(225, 61), Yard: at(225, 184), Vault: at(205, 125) };
const way = (from, to) => { const w = rp.probeWay(T, level, from, to); return { ok: w.ok, open: w.open, chokes: w.chokes, failures: w.failures, stage: rp.wayStop(w).stage ?? null }; };
out.ways = {
  field: way([20.5, -30.5], orders.Field),
  tower: way([20.5, -30.5], orders.Tower),
  yard: way([20.5, -30.5], orders.Yard),
  vault: way([20.5, -30.5], orders.Vault),
};
// The narrow passage on the bare map closes on the first plan: it is the teammate that shuts it.
const bare = rp.probeRoute(T, level, [20.5, -30.5], orders.Tower);
out.bare = { ok: bare.ok, failures: bare.failures, ends: bare.points[bare.points.length - 1] };
out.chokeInPassage = rp.chokePoints(T, level, bare.points).every(([x]) => x > 118 && x < 222);

const areasOf = names => names.map(n => ({ name: n, order: orders[n], neighbours: names.filter(m => m !== n) }));
const probe = rp.probeLevel(T, level, { areas: areasOf(['Field', 'Tower', 'Yard', 'Vault']), spawns });
out.level = {
  sides: Object.fromEntries(Object.entries(probe.flags).map(([n, f]) => [n, f.sides])),
  reach: { 1: probe.sides[1].flags, 2: probe.sides[2].flags },
  towerStop: rp.wayStop(probe.flags.Tower.direct[1]).stage,
  vaultStop: rp.wayStop(probe.flags.Vault.direct[1]).stage,
  shutLinks: probe.links.filter(l => !l.open).map(l => `${l.from}>${l.to}`).sort(),
};

// The generator's reading (`botgen.mjs probeAreas`): the areas in play, as it builds them.
const genAreas = ['Field', 'Tower', 'Yard', 'Vault'].map(n => ({ name: n, flag: { fixed: false }, unreachable: false, order: orders[n], neighbours: ['Field'].filter(m => m !== n) }));
const marker = gen.probeAreas(T, level, genAreas, spawns);
out.marker = { unreachable: marker.unreachable, stops: Object.fromEntries(Object.entries(marker.stops).map(([n, s]) => [n, [s[1].stage, s[2].stage]])),
               oneSided: marker.oneSided, chokeMax: marker.chokeMax, towerChokes: marker.chokes['Tower:1'] ?? null, fieldChokes: marker.chokes['Field:1'] };

// One side's base at the end of the narrow passage: its bots have an open way to nothing.
const far = [{ side: 1, x: 20.5, z: -30.5 }, { side: 2, x: 225.5, z: -61.5 }];
const lopsided = rp.probeLevel(T, level, { areas: areasOf(['Field', 'Yard']), spawns: far });
out.lopsided = { sides: Object.fromEntries(Object.entries(lopsided.flags).map(([n, f]) => [n, f.sides])), reach2: lopsided.sides[2].flags };

// --- the lint on the probe's findings ----------------------------------------------
const area = (name, [x, z], neighbours) => ({ name, min: [x - 5, z], max: [x, z + 5], radius: 10, neighbours, flags: ['ControlPoint'], orderPositions: { Infantry: [x, z] } });
const ai = names => ({
  strategicAreas: names.map(n => area(n, orders[n], names.filter(m => m !== n))),
  strategies: [{ name: 's', prerequisite: 'p', modifiers: [{ flag: 'ControlPoint', factor: 2 }] }],
  prerequisites: [{ name: 'p', conditions: [{ name: 'c', weight: 1 }] }],
  conditions: [{ name: 'c' }], sideStrategies: { 1: ['s'], 2: ['s'] },
});
const flagsOf = names => names.map(n => ({ name: n, x: orders[n][0], y: 0, z: orders[n][1], radius: 5, team: 0, fixed: false }));
const run = (names, p) => lint.lintLayer({ ai: ai(names), flags: flagsOf(names), probe: p });
const texts = r => ({ errors: r.errors.filter(e => e.check === 'route').map(e => e.text), dead: lint.predictedDead(r),
                      warnings: r.warnings.filter(w => w.check === 'route').map(w => w.text), facts: { shut: r.facts.routeShut, sides: r.facts.routeSides } });
out.lint = {
  all: texts(run(['Field', 'Tower', 'Yard', 'Vault'], probe)),
  sound: texts(run(['Field', 'Yard'], rp.probeLevel(T, level, { areas: areasOf(['Field', 'Yard']), spawns }))),
  lopsided: texts(run(['Field', 'Yard'], lopsided)),
};
console.log(JSON.stringify(out));
