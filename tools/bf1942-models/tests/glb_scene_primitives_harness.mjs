// `server/glb-scene.mjs` `buildSceneTree`: every primitive of a collision mesh
// reaches the room's collision index, as the page's GLTFLoader gives it one
// mesh per primitive (FHSWEurope Operation Da's hangar floor was primitive 4).
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const viewer = viewerDir();
installModuleHooks(viewer);
const { buildSceneTree } = await import(pathToFileURL(path.join(HERE, '..', 'server', 'glb-scene.mjs')).href);
const { buildCollisionIndex } = await import(pathToFileURL(path.join(viewer, 'static-index.js')).href);

// Two triangles, one a primitive: a wall at x 0 and a floor at y 1.
const positions = new Float32Array([
  0, 0, -5, 0, 5, -5, 0, 0, 5,            // primitive 0, the wall
  -5, 1, -5, 5, 1, -5, 0, 1, 5,           // primitive 1, the floor
]);
const indices = new Uint16Array([0, 1, 2]);
const bin = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer)]);
const gltf = {
  nodes: [{ name: 'hangar collision 1', mesh: 0, extras: { collision: true } }],
  meshes: [{ primitives: [
    { attributes: { POSITION: 0 }, indices: 2, extras: { collision: true, defenseMaterial: 81 } },
    { attributes: { POSITION: 1 }, indices: 2, extras: { collision: true, defenseMaterial: 85 } },
  ] }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
    { bufferView: 0, byteOffset: 36, componentType: 5126, count: 3, type: 'VEC3' },
    { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
  ],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 72 }, { buffer: 0, byteOffset: 72, byteLength: 6 }],
};
const { root } = buildSceneTree(gltf, bin);
root.updateMatrixWorld(true);
const meshes = [];
root.traverse(o => { if (o.isMesh) meshes.push({ name: o.name, material: o.geometry.userData?.defenseMaterial ?? o.userData?.defenseMaterial }); });
const index = buildCollisionIndex(root, { ownerRoots: [] });
const hit = index.cast(0.5, 3, 0, 0, -1, 0, 5, -1, { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 });
process.stdout.write(JSON.stringify({ meshes, floorY: hit ? hit.y : null, floorMaterial: hit ? hit.material : null }));
