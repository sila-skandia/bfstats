// The load settle's ground beside a cliff (`viewer/body-pose.js`
// `bodyTerrain`), and three FHSWEurope pads the census found far from their
// hulls (features/fhsweurope-extraction, 2026-10-28 "Load-settle outliers").
// Prints one JSON line. `node load_settle_terrain_harness.mjs <viewerDir>`.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const viewer = path.resolve(process.argv[2]);
const at = (...p) => pathToFileURL(path.join(...p)).href;
const { Heightfield } = await import(at(viewer, 'heightfield.js'));
const { bodyTerrain } = await import(at(viewer, 'body-pose.js'));
const out = {};

// A quay: flat at 97 m up to column 6, the sea bed at 76 m from column 7 on;
// the cell between columns 6 and 7 is the 21 m wall. Spacing 4 m.
{
  const dim = 16, n = dim + 1;
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = i <= 6 ? 97 : 76;
  const field = new Heightfield(dim, 4, heights);
  const ground = bodyTerrain(field, null);
  const nrm = [0, 0, 0];
  // 22.5 m east is in the last flat cell (20..24), 1.5 m short of the wall.
  out.flatBesideWall = { height: ground.height(22.5, -30), normal: [...ground.normal(22.5, -30, nrm)],
    centralDifference: [...field.normal(22.5, -30, [0, 0, 0])] };
  out.onWall = { height: ground.height(26, -30), normal: [...ground.normal(26, -30, nrm)] };
}

// The hulls the room's level settle leaves on three pads (`LevelData.instantiate`
// runs the same `settle` over the same `bodyTerrain` the page's load does).
const { loadRealLevel } = await import(at(viewer, '..', 'server', 'level.mjs'));
const pads = [
  ['bizerte-1943', 'SPA38R', [338.51, 95.87, -585.21]],
  ['fht_battle_of_mareth_line-1943', 'willy', [919.679, 96.97, -609.0]],
  ['way_to_paris-1946', 'AMX13_APCR', [0, 0, 0]],
  // A metre over a static, 39 m and 17 m over the terrain (`dropsOntoAStatic`).
  ['ural_mountains-1947', 'IS4', [1637.98, 67.42, -754.28]],
  ['the_great_pursuit', 'KingtigerP', [352.56, 110.9, -1270.78]],
  // Beside a static root the room's settle used to tumble into it.
  ['earned_in_blood', 'T34-85_random', [861.67, 76.19, -895.9]],
  // 0.5 m from a pad the round never fills, and 2.3 m from one it does not
  // fill at the start (`pad-nodes.js` `settleGroupsOf`).
  ['fht_pasir_panjang-1942', 'Type94_20mmType98AA', [810.003, 45.8568, -1538.78]],
  ['the_storm', 'KV9', [474.0, 55.0, -192.0]],
  ['the_storm', 'T-34_1942', [475.1672, 54.51211, -190.066]],
  // Two planes of one side the level placed in each other: both spawn on the
  // round's first frame and their contacts push them apart, as in retail.
  ['operation_blackknight-1945', 'Cub_Rosie_the_Rocketeer', [1225.76, 30.3445, -340.021]],
];
out.pads = [];
for (const [level, template, pad] of pads) {
  if (!existsSync(path.join(viewer, 'maps', 'mods', 'fhsweurope', level, 'scene.glb'))) continue;
  const data = loadRealLevel({ viewerDir: viewer, name: level, mod: 'fhsweurope' });
  const instance = data.instantiate(null);
  let best = null;
  for (const node of instance.ownerRoots) {
    const name = String(node?.userData?.control ?? node?.name ?? '');
    if (name.toLowerCase() !== template.toLowerCase()) continue;
    node.updateWorldMatrix(true, false);
    const e = node.matrixWorld.elements;
    const p = [e[12], e[13], e[14]];
    // The hull nearest its pad horizontally, wherever the settle put it.
    const d = Math.hypot(p[0] - pad[0], p[2] - pad[2]);
    if (!best || d < best.d) best = { d, p, up: e[5] };
  }
  out.pads.push({ level, template, pad, found: !!best, horizontal: best?.d ?? null, pos: best?.p ?? null,
    up: best?.up ?? null, ground: best ? data.heightfield.height(best.p[0], best.p[2]) : null });
}

// Which pads the round opens with (`padFirstTemplate`), and the template a
// node whose own name ends in `_<digits>` stands for (`padTemplateOf`).
{
  const { padFirstTemplate, padTemplateOf } = await import(at(viewer, 'level-statics.js'));
  const points = [
    { name: 'axisbase', team: 1, objectSpawnerId: 2, unableToChangeTeam: true },
    { name: 'neutral', team: 0, objectSpawnerId: 7 },
  ];
  const first = spawn => padFirstTemplate({ position: [0, 0, 0], vehicle: Object.values(spawn.templates)[0], ...spawn }, points, true);
  out.first = {
    otherSideOnly: first({ osId: 2, templates: { 2: 'lightaa_mki' } }),
    ownSide: first({ osId: 2, templates: { 1: 'type94_20mmtype98aa' } }),
    bothSides: first({ osId: 2, templates: { 1: 'T88HMC', 2: 'Zrinyi2' } }),
    neutralNoTeam: first({ osId: 7, templates: { 1: 'a', 2: 'b' } }),
    neutralOwnTeam: first({ osId: 7, team: 2, templates: { 1: 'a', 2: 'b' } }),
    noPoint: first({ osId: 9, templates: { 1: 'a', 2: 'b' }, vehicle: 'b' }),
  };
  out.templateOf = {
    tagged: padTemplateOf({ name: 'T-34_1942', userData: { control: 'T-34_1942' } }),
    suffixedName: padTemplateOf({ name: 'Sherman_1', userData: {} }),
  };
}
console.log(JSON.stringify(out));
