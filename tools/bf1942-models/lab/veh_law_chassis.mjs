// A ground hull's chassis as the page's drive collects it on a real level, for
// the vehicle-law fixtures (`tests/fixtures/vehicle_law_*`): the root's mass
// and drag, the Engine's physics and rig, every Spring's rest, grip, strength,
// damping and the col0 probe depth the page hands the drive on boarding
// (`vehicle-bodies.js` `wheelContactDepths`), each steering bundle's rig, and
// the inertia box (`inertiaGeometryBox` over the level's collision sidecar).
//
//   node lab/veh_law_chassis.mjs <viewer assets dir> <map> <Template> [mod]
//
// It seats a runner bot in the template's nearest root seat (`sim/stage.mjs`)
// and reads the drive the page would build.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIM = path.join(HERE, '..', 'sim');
const { viewerDir, loadViewerModules, seedMathRandom, routeConsole } = await import(path.join(SIM, 'env.mjs'));
const { realLevel } = await import(path.join(SIM, 'level.mjs'));
const { Match } = await import(path.join(SIM, 'match.mjs'));

const [assets, map, template, mod = null] = process.argv.slice(2);
const M = await loadViewerModules(viewerDir(path.join(HERE, '..', 'viewer')));
routeConsole(true);
seedMathRandom(7);
const maps = mod ? path.join(assets, 'maps', 'mods', mod) : path.join(assets, 'maps');
const level = await realLevel(M, { maps, models: path.join(assets, 'models'), map });
const match = new Match({ M, level, botsPerSide: 1, duration: 3600, seed: 7, sink: null, wreckLoader: null });
match.setup();
const cands = match.stage.units.candidates().filter(c => String(c.template).toLowerCase() === template.toLowerCase() && c.isRoot);
// Either side's bot: a hull's team rule decides who may take it.
const b = match.bots.find(bot => cands.some(c => match.referee.enterVehicle(bot, c)));
if (!b) throw new Error(`no ${template} root seat on ${map}: ${[...new Set(match.stage.units.candidates().filter(c => c.isRoot).map(c => c.template))].join(",")}`);
const drive = b.vehicle.drive;
// An aircraft's chassis is its `aircraftSpec` table, what
// `tests/air_law_harness.mjs` builds the airframe from.
if (drive.constructor.name === 'Aircraft') {
  process.stdout.write(JSON.stringify({ map, template, mod, cls: 'Aircraft', spec: drive.spec }) + '\n');
  process.exit(0);
}
const root = drive.node;
root.updateWorldMatrix(true, true);
const inv = root.matrixWorld.clone().invert();
const r6 = (v) => +v.toFixed(6);
const nodes = [];
const index = new Map();
// The tree under the root, as the drive reads it: kind, name, local pose, the
// physics and rig extras; meshes carry only their place (the inertia box is
// given whole below).
root.traverse((obj) => {
  if (obj === root) return;
  const data = obj.userData || {};
  if (!data.templateKind) return;
  let parent = obj.parent;
  while (parent && parent !== root && !index.has(parent)) parent = parent.parent;
  index.set(obj, nodes.length);
  nodes.push({
    name: obj.name, kind: data.templateKind, parent: parent === root ? -1 : index.get(parent),
    position: obj.position.toArray().map(r6), quaternion: obj.quaternion.toArray().map(r6),
    ...(data.physics ? { physics: data.physics } : {}), ...(data.rig ? { rig: data.rig } : {}),
    ...(data.geometry ? { geometry: data.geometry } : {}),
  });
});
const wheels = drive.wheels.map((w) => ({ name: w.node.name, rest: w.rest.toArray().map(r6),
  contactDepth: w.contactDepth ?? null, radius: r6(w.radius),
  materialFriction: w.materialFriction ?? null, materialResistance: w.materialResistance ?? null }));
process.stdout.write(JSON.stringify({
  map, template, mod, physics: root.userData.physics, cls: drive.constructor.name,
  geometryBox: drive.geometryBox, nodes, wheels,
}) + '\n');
process.exit(0);
