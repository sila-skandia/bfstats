// Reads a `stances.json` the way the room server and the headless runner do
// (`server/soldier-capsules.mjs`) and prints what a soldier is hit on
// (`tests/test_stance_bodies.py`).
//   node stance_bodies_harness.mjs <models dir> <soldier> [<soldier> ...]
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const at = (...p) => pathToFileURL(path.join(HERE, '..', ...p)).href;
const { installModuleHooks, viewerDir } = await import(at('sim', 'env.mjs'));
installModuleHooks(viewerDir(null));
const { createStanceBodies } = await import(at('server', 'soldier-capsules.mjs'));
const [models, ...soldiers] = process.argv.slice(2);
const table = [
  { bone: 'Bip01_Head', distSq: 0.02, stretch: 2, material: 40 },
  { bone: 'Bip01_Spine', distSq: 0.08, stretch: 0, material: 41 },
];
const bodies = createStanceBodies({ modelsDirs: [models], glbsDir: null, table, soldierOf: team => soldiers[team - 1] ?? null });
const out = {};
soldiers.forEach((name, i) => {
  const man = pose => ({ team: i + 1, soldier: { x: 10, y: 0, z: 20, yaw: 0, pose } });
  const stand = bodies.capsulesFor(man(0));
  out[name] = {
    posed: bodies.posed(i + 1),
    capsules: stand?.map(c => ({ material: c.material, a: c.a, b: c.b })) ?? null,
    bones: bodies.bonesFor(man(0)) ?? null,
    world: bodies.capsulesAt(man(0))?.[0]?.a ?? null,
  };
});
process.stdout.write(JSON.stringify(out));
