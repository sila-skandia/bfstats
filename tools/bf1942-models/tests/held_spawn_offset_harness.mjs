// `viewer/spawned-craft.js`: a held craft is held at its spawner plus the
// spawner's `spawnOffset` (AI-121). FHSW's carriers set 1.98 m up, and held at
// the spawner itself Midway's deck planes sat in the deck.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, { detachSpawnedCraft, spawnHoldOf }] = await Promise.all([
  imp('vendor/three.module.js'), imp('spawned-craft.js'),
]);
const node = (name, userData = {}, children = [], at = [0, 0, 0]) => {
  const obj = new THREE.Group();
  obj.name = name; obj.userData = userData; obj.position.set(...at);
  for (const child of children) obj.add(child);
  return obj;
};
const plane = (name, spawnOffset) => node(name, {
  templateKind: 'PlayerControlObject', physics: { mass: 1000, vehicleCategory: 'VCAir' },
  heldSpawner: { holdObject: true, spawnOffset } }, [], [-1, 18.592, -20]);
const ship = node('Enterprise', { templateKind: 'PlayerControlObject', physics: { mass: 1e6, vehicleCategory: 'VCSea' } },
  [plane('F4F-4', [0, 1.983, 0]), plane('Corsair', [0, 0, 0]), plane('Skewed', [0.5, 0, 2])], [3398.58, 19.8651, -2856.49]);
const root = node('level', {}, [node('spawners', { kind: 'spawners' }, [ship])]);
root.updateMatrixWorld(true);
detachSpawnedCraft(root);
const at = name => {
  const hold = spawnHoldOf(root.getObjectByName(name));
  const p = new THREE.Vector3().setFromMatrixPosition(hold.local);
  return p.toArray().map(n => +n.toFixed(3));
};
process.stdout.write(JSON.stringify({ wildcat: at('F4F-4'), corsair: at('Corsair'), skewed: at('Skewed') }));
