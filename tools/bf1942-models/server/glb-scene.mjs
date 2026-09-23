// The level `scene.glb`, headless: the BIN chunk's accessors (terrain tiles and
// collision meshes only), the terrain material id map, and the whole node tree
// as Object3D instances. `glb-tree.mjs` owns the GLB container and a vehicle
// template's JSON-only tree; this is the level half, which does read geometry.
// Split out of `level.mjs`, which re-exports `decodeMaterialIds` and
// `buildSceneTree`.

import * as THREE from 'three';
import { inflateSync } from 'node:zlib';

// --- the GLB BIN chunk, exactly as little as the sim needs ------------------

/**
 * One glTF accessor's contents, decoded from the BIN chunk.
 *
 * Supports what this exporter emits: positions and indices, tightly packed
 * or `byteStride`-ed, u8/u16/u32/FLOAT32 components. The mesh half of
 * `scene.glb` is decoded lazily — terrain tiles and collision-tagged
 * primitives only — the same set the page's collider walks
 * (`extras.collision`, `geometry.userData.defenseMaterial`).
 */
function decodeAccessor(gltf, bin, accessorIndex) {
  const accessor = gltf.accessors[accessorIndex];
  const view = gltf.bufferViews[accessor.bufferView];
  if (view.buffer !== 0) throw new Error('external buffer in scene.glb');
  const componentBytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  const csize = componentBytes[accessor.componentType];
  if (!csize) throw new Error(`unsupported componentType ${accessor.componentType}`);
  const items = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type] || 1;
  const stride = view.byteStride || (items * csize);
  const out = new Uint8Array(accessor.count * items * csize);
  // `bin` is already a Buffer slice of the BIN chunk: index it relative to
  // the slice (its own byteOffset is not part of the index space). The
  // stride is per *element* (per VEC3), and the components inside an element
  // are consecutive — walking scalars with the element stride would skip
  // e.g. every y of a VEC3 and hand the lattice a grid of x coordinates.
  const rowStart = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  for (let e = 0; e < accessor.count; e++) {
    const row = rowStart + e * stride;
    for (let c = 0; c < items; c++) {
      const at = (e * items + c) * csize;
      for (let b = 0; b < csize; b++) out[at + b] = bin[row + c * csize + b];
    }
  }
  switch (accessor.componentType) {
    case 5126: return new Float32Array(out.buffer, out.byteOffset, out.length / 4);
    case 5125: return new Uint32Array(out.buffer, out.byteOffset, out.length / 4);
    case 5123: return new Uint16Array(out.buffer, out.byteOffset, out.length / 2);
    case 5122: return new Int16Array(out.buffer, out.byteOffset, out.length / 2);
    case 5121: return out;
    default: throw new Error(`unsupported componentType ${accessor.componentType}`);
  }
}

/**
 * The terrain material id map, red channel only, from `terrain/materials.png`.
 *
 * The exporter writes the raw id into the red channel of an 8-bit RGB(A) PNG
 * (see `write_terrain_materials`), so one byte per sample is the whole map.
 * Node's zlib does the inflate; the ~35 lines below are the PNG spec's scan
 * line unfiltering (filters 0-4, non-interlaced — the only form the exporter
 * emits), all of which is public law, not engine law.
 */
export function decodeMaterialIds(png) {
  if (png.length < 33 || png[0] !== 0x89 || png[1] !== 0x50) {
    throw new Error('materials.png: not a PNG');
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const bitDepth = png[24];
  const colorType = png[25];
  const interlace = png[28];
  if (bitDepth !== 8 || interlace !== 0) {
    throw new Error(`materials.png: unsupported (depth ${bitDepth}, interlace ${interlace})`);
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3
    : colorType === 0 ? 1 : 0;
  if (!channels) throw new Error(`materials.png: unsupported colorType ${colorType}`);
  const idat = [];
  let at = 8;
  while (at + 8 <= png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    if (type === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = prev[x];
      const ul = x >= channels ? prev[x - channels] : 0;
      let v = src[x];
      if (filter === 1) v = (v + left) & 0xff;
      else if (filter === 2) v = (v + up) & 0xff;
      else if (filter === 3) v = (v + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = left + up - ul;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - ul);
        v = (v + (pa <= pb && pa <= pc ? left : pb <= pc ? up : ul)) & 0xff;
      }
      row[x] = v;
    }
    for (let x = 0; x < width; x++) out[y * width + x] = row[x * channels];
    prev = row;
  }
  return out;
}

/**
 * The whole node tree of a `scene.glb` as Object3D instances, plus the
 * terrain/collision geometry the collider needs.
 *
 * Every node becomes a real THREE.Object3D (name, transform, children,
 * userData = extras), so world matrices compose and the seats/drive modules
 * walk the tree exactly as they walk the page's loaded scene. Mesh nodes
 * carry a geometry duck — `attributes.position` + `index` +
 * `userData.defenseMaterial`, the only surface `buildHeightfield` and
 * `buildCollisionIndex` read — decoded only for the meshes those two will
 * touch; every other mesh node gets an empty stub that never passes
 * `isCollisionMesh` and is never inspected. No GPU structures exist
 * server-side.
 *
 * One deliberate squashing: three's GLTFLoader forks a gltf mesh's
 * primitives into one THREE.Mesh per primitive (`assignExtrasToUserData`
 * lands the primitive's extras on the mesh AND the geometry), so a
 * multi-primitive mesh's collision half lives on a *sibling mesh* node, not
 * the gltf node. This builder attaches the first primitive's geometry to the
 * gltf node and — when a later primitive carries the collision tag — decodes
 * that primitive too and attaches it the same way, which is exactly the set
 * of objects `buildCollisionIndex`'s `isCollisionMesh` test would admit.
 */
export function buildSceneTree(gltf, bin) {
  const nodes = gltf.nodes || [];
  const meshes = gltf.meshes || [];
  const made = new Array(nodes.length);
  const terrainTiles = [];
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
    obj.userData = (n.extras && typeof n.extras === 'object') ? n.extras : {};
    made[i] = obj;
  }
  for (const [i, n] of nodes.entries()) {
    if (!n.children) continue;
    for (const child of n.children) made[i].add(made[child]);
  }
  const root = new THREE.Object3D();
  root.name = 'level';
  for (let i = 0; i < made.length; i++) {
    if (made[i].parent === null) root.add(made[i]);
  }

  // The geometry pass. Only primitive 0 is read — three's GLTFLoader builds
  // one Mesh per gltf mesh from the first primitive, so this is the page's
  // own resolution.
  const primitiveOf = (nodeIndex) => {
    const n = nodes[nodeIndex];
    if (n.mesh == null || !meshes[n.mesh]?.primitives?.length) return null;
    return meshes[n.mesh].primitives[0];
  };
  const geometryFor = (prim) => {
    // A REAL BufferGeometry, never a duck: the drive code measures wheels
    // and tracer meshes against `geometry.boundingBox`, and a plain-object
    // stub threw where the page's loaded scenes always answered. The
    // geometry here carries positions only for the collision/terrain meshes
    // the sim walks; render meshes stay empty (nothing on the server
    // draws), which is exactly what `computeBoundingBox` needs to answer.
    const geometry = new THREE.BufferGeometry();
    const pos = prim.attributes?.POSITION;
    if (pos != null) {
      const array = decodeAccessor(gltf, bin, pos);
      geometry.setAttribute('position', new THREE.BufferAttribute(array, 3));
    }
    if (prim.indices != null) {
      const array = decodeAccessor(gltf, bin, prim.indices);
      geometry.setIndex(new THREE.BufferAttribute(array, 1));
    }
    geometry.userData = (prim.extras && typeof prim.extras === 'object')
      ? prim.extras : {};
    return geometry;
  };
  for (let i = 0; i < nodes.length; i++) {
    const prim = primitiveOf(i);
    if (!prim) continue;
    const obj = made[i];
    const extras = obj.userData;
    const want = Boolean(
      extras.kind === 'terrain' || extras.collision
      || obj.parent?.userData?.collision || prim.extras?.collision);
    obj.isMesh = true;
    obj.geometry = want ? geometryFor(prim) : new THREE.BufferGeometry();
    if (extras.kind === 'terrain') terrainTiles.push(obj);
  }
  root.updateMatrixWorld(true);
  return { root, terrainTiles };
}
