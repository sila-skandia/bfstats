// `viewer/spawned-craft.js` `stripSpawnedCraft`: a template's model as a
// server draws it. The Shokaku's deck planes and landing craft are objects of
// their own on a server, so a hull stood from her glb keeps her AA batteries
// and nothing her spawners field.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, { stripSpawnedCraft }] = await Promise.all([
  imp('vendor/three.module.js'), imp('spawned-craft.js'),
]);
const node = (name, userData = {}, children = []) => {
  const obj = new THREE.Group();
  obj.name = name; obj.userData = userData;
  for (const child of children) obj.add(child);
  return obj;
};
const pco = (name, extra = {}, children = []) => node(name, { templateKind: 'PlayerControlObject', control: name, ...extra }, children);
const held = { spawner: 'ShokakuZeroSpawner', holdObject: true };
const names = root => { const out = []; root.traverse(o => out.push(o.name)); return out; };

// Her own glb: a scene Group over the Shokaku root.
const shokaku = () => node('Scene', {}, [pco('Shokaku', { physics: { mass: 4e7, vehicleCategory: 'VCSea' } }, [
  node('ShokakuComplex', { templateKind: 'Bundle' }, [
    pco('Zero', { heldSpawner: held, physics: { mass: 2000, vehicleCategory: 'VCAir' } }, [node('ZeroComplex')]),
    pco('AichiVal', { heldSpawner: held, physics: { mass: 3000, vehicleCategory: 'VCAir' } }, [pco('AichiValRearGunControl')]),
    // An older export, without the stamp: taken by the craft rule.
    pco('Daihatsu', { physics: { mass: 30000, vehicleCategory: 'VCSea' } }),
    pco('ShokakuAABattery1', { physics: { vehicleCategory: 'VCSea' } }),
    node('ShokakuEngine', { templateKind: 'Engine' }),
  ]),
])]);

const carrier = shokaku();
const gone = stripSpawnedCraft(carrier);
const kept = names(carrier);
// The plane's own glb loses nothing: its root is no one's craft.
const zero = node('Scene', {}, [pco('Zero', { physics: { mass: 2000, vehicleCategory: 'VCAir' } }, [pco('ZeroGunner')])]);
const zeroGone = stripSpawnedCraft(zero);
// Nor does a plane's glb that carries its own spawner stamp (the exporter
// writes `heldSpawner` on the vehicle node, which is the glb's root when the
// held template is exported as a model of its own).
const stamped = node('Scene', {}, [pco('Zero', { heldSpawner: held, physics: { mass: 2000, vehicleCategory: 'VCAir' } })]);
const stampedGone = stripSpawnedCraft(stamped);
console.log(JSON.stringify({ gone, kept, zeroGone, zeroKept: names(zero), stampedGone, stampedKept: names(stamped) }));
