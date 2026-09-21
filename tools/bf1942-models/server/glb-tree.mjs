// The vehicle template tree, read off the GLB's JSON chunk alone.
//
// A published vehicle glb (`viewer/models/<Template>.glb`) is a standard GLB
// container: u32 magic 0x46546c67 ("glTF"), u32 version, u32 total length,
// then 4-byte-type + content chunks, the first a UTF-8 JSON chunk
// (0x4e4f534a "JSON"), the second binary (0x4e4942 "BIN"). The page loads it
// with three's GLTFLoader; the room server has no GPU and needs none of the
// geometry — the assembly data the sim walks (seat hierarchy, EntryPoint
// reach, VehicleOccupancy inputs, cameras, armor/physics extras, rigs) lives
// in the JSON chunk's `nodes[].extras`, exactly as `assemble.py` stamped it —
// so this module rebuilds the Object3D tree (names, transforms, children,
// userData) from the JSON chunk and touches neither the BIN chunk nor a mesh
// accessor. `viewer/seats.js`'s survey and `vehicles.js`'s drive models walk
// exactly this surface (`traverse`, `userData`, `parent`, `quaternion`), so
// the tree this module returns is usable headless by every downstream
// consumer, which is why the nodes are real THREE.Object3D instances rather
// than a bespoke record: the sim never notices it is not a loaded scene.
//
// Node transforms are the glTF defaults where the JSON omits them
// (translation 0, rotation identity, scale 1), and `extras` map to
// `userData` the way GLTFLoader maps them (assignment, not a clone). The
// `spawner` extras keys the page's `spawnerWindow` reads are preserved by
// the same assignment. Nothing here decodes accessors — `level.mjs` owns
// the few accessors it does need (terrain tiles, collision meshes).
//
// P0 ledger: GLB container layout is glTF 2.0 spec; the extras contract is
// `bf42/assemble.py`'s own stamp (see `features/bf1942-engine-reference/
// subsystems/netcode.md` §6's list of what the room reads off vehicle
// templates).

import * as THREE from 'three';
import { readFileSync } from 'node:fs';

export const GLB_MAGIC = 0x46546c67;
export const GLB_JSON = 0x4e4f534a;
export const GLB_BIN = 0x4e4942;

/**
 * The GLB's two chunks, split at the container level.
 *
 * Returns `{ json, bin }` where `json` is the parsed glTF document and `bin`
 * is the raw BIN chunk (a Buffer, null when the container has no BIN chunk).
 * `level.mjs` decodes terrain and collision accessors out of `bin`.
 */
export function readGlb(path) {
  const data = readFileSync(path);
  if (data.length < 12) throw new Error(`GLB too small: ${path}`);
  const magic = data.readUInt32LE(0);
  if (magic !== GLB_MAGIC) {
    throw new Error(`not a GLB (magic ${magic.toString(16)}): ${path}`);
  }
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset + 8 <= data.length) {
    const length = data.readUInt32LE(offset);
    const type = data.readUInt32LE(offset + 4);
    offset += 8;
    if (offset + length > data.length) throw new Error(`GLB chunk overruns: ${path}`);
    if (type === GLB_JSON && json === null) {
      json = JSON.parse(data.toString('utf8', offset, offset + length));
    } else if (type === GLB_BIN && bin === null) {
      bin = data.subarray(offset, offset + length);
    }
    offset += length;
  }
  if (!json) throw new Error(`GLB has no JSON chunk: ${path}`);
  return { json, bin };
}

/**
 * The JSON chunk's node tree as Object3D nodes, no geometry.
 *
 * @param {string} path  path to a `.glb` file
 * @returns {THREE.Object3D} the scene root with every node under it
 */
export function loadVehicleTree(path) {
  const { json } = readGlb(path);
  const nodes = json.nodes || [];
  const made = new Array(nodes.length);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const obj = new THREE.Object3D();
    obj.name = n.name || '';
    if (Array.isArray(n.translation)) {
      const [x = 0, y = 0, z = 0] = n.translation;
      obj.position.set(x, y, z);
    }
    if (Array.isArray(n.rotation)) {
      const [x = 0, y = 0, z = 0, w = 1] = n.rotation;
      obj.quaternion.set(x, y, z, w);
    }
    if (Array.isArray(n.scale)) {
      const [x = 1, y = 1, z = 1] = n.scale;
      obj.scale.set(x, y, z);
    }
    // The assembler's extras land in userData the way GLTFLoader lands them.
    obj.userData = (n.extras && typeof n.extras === 'object') ? n.extras : {};
    made[i] = obj;
  }
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!n.children) continue;
    for (const child of n.children) {
      if (made[child]) made[i].add(made[child]);
    }
  }
  const root = new THREE.Object3D();
  root.name = path;
  let attached = 0;
  for (let i = 0; i < made.length; i++) {
    if (!made[i].parent) {
      root.add(made[i]);
      attached++;
    }
  }
  if (!attached) {
    // A template with every node under the scene root's default one.
    const scene = (json.scenes && json.scenes[0] && json.scenes[0].nodes) || [];
    if (scene.length) root.add(made[scene[0]]);
  }
  // The survey's root seat is keyed by the root's own `userData.control`
  // (`surveyVehicle`, seats.js), and a vehicle template's root PCO carries it
  // ("Willy") — so the tree this module returns must BE that node, the way
  // the page's `gltf.scene` is, or the engine/axes its descendants declare
  // would land on a sibling seat and the root would classify as a bare
  // 'seat'. A published model glb has exactly one scene node (its vehicle
  // root). Multi-child scenes (a level) keep the synthetic wrapper, and
  // callers that survey those never do — the level's vehicle table is built
  // from the instance nodes, which are spawner children with `control`.
  const sceneRef = (json.scenes && json.scenes[0]?.nodes) || [];
  if (sceneRef.length === 1) {
    const root = made[sceneRef[0]];
    root.name = path;
    root.updateMatrixWorld(true);
    return root;
  }
  root.updateMatrixWorld(true);
  return root;
}