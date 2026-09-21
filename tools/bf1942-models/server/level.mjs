// The level load; the room server's mirror of `map.html`'s build sequence.
//
// One published maps tree entry (`viewer/maps/<level>/scene.json` + the level
// `scene.glb`) becomes a read-only LevelData (terrain lattice, materials,
// damage tables, collision sidecars, template trees, the vehicle table
// assembly), and each room calls `instantiate()` for its own mutable copy:
// a cloned scene tree, a freshly built collider, the World, the parked hulls
// and the per-instance vehicle table. The split is the resource law: the
// expensive half (decoding a ~40 MB BIN chunk's terrain tiles and collision
// meshes, inflating the material map) runs once per level, while a room only
// pays for clones and index rebuilds (~20 k triangles), and no two rooms
// share a mutable node.
//
// THE HEIGHTFIELD DECISION (documented in `server/README.md`): the terrain
// lattice is recovered from the level's own `scene.glb` at load, the same
// way the page's `buildHeightfield` recovers it from the loaded scene — the
// exporter writes tile vertices at absolute world positions on exact
// multiples of the sample spacing, so snapping recovers `Heightmap.raw`
// exactly, and the JSON chunk's nodes name every tile (`extras.kind
// "terrain"`). No new asset, never out of sync with the scene, and the law
// stays in `collision.js`; the cost is one accessor decode per level
// (~270 k vertices) against the alternative bake script, which would need a
// publish step and a second source of truth to drift against.
//
// What mirrors what (the page's function names in parentheses):
//   - `bodyPoseOf`/`writeBodyPose`/`settlePlacedVehicles`: placed hulls drop
//     onto their springs for SETTLE_TICKS before the index bakes them
//   - `buildCollider`: heightfield + statics index + WorldCollider + owners
//   - `registerDamageables`/`setupVehicleBodies`: armor owners, body world
//   - the mount glue mirrors `setPilot`/`switchSeat`/`leaveVehicle`/
//     `exitVehicle`/`exitPoseManned`
//
// The one deliberate divergence is single-drive-per-hull: a vehicle
// simulates through at most one drive model at a time (the current root-
// seat occupant's), because the World's `#vehicleTick` integrates
// `player.vehicle` for every seated player, and two drivers of one hull
// would advance it twice a tick. Passengers ride in the same cloned node
// tree without a drive; the room poses them each tick from the root's live
// world matrix (`player.position` feed), which the driver's `applyTransform`
// keeps fresh even while the hull coasts. When the driver leaves, the hull
// parks where it stood (`releaseDriven`, the render's E-key law), and no
// client ever sees the vehicle die on the spot.
//
// P3 seams are flagged `// P3 seam:` through this file — projectile damage
// (`guns` is null for now, so `play.netcode.js`'s fire events cannot resolve
// into rounds), supply depots, kit hit points (loadouts.json), spawner
// respawn windows.

import * as THREE from 'three';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

import { World } from '../viewer/world.js';
import {
  WorldCollider, buildCollisionIndex, buildHeightfield,
} from '../viewer/collision.js';
import { VehicleOccupancy, classifyRoot, listEntryPoints, readWorldPose } from '../viewer/seats.js';
import { Aircraft } from '../viewer/flight.js';
import { GroundVehicle, TrackedVehicle } from '../viewer/ground.js';
import { BodyWorld } from '../viewer/body-world.js';
import {
  buildParkedVehicle, describeVehicleParts,
} from '../viewer/vehicle-bodies.js';
import { spawnerWindow } from '../viewer/game-modes.js';
import { loadVehicleTree, readGlb } from './glb-tree.mjs';

/** The occupancy classes the page hands `VehicleOccupancy` (map.html's own
 *  pick: `TrackedVehicle` straight out of ground.js). */
const DRIVE_CLASSES = { Aircraft, GroundVehicle, TrackedVehicle };

/** Longest a spawned vehicle is given to come to rest (map.html: 300). */
export const SETTLE_TICKS = 300;

/** The body world's ground (map.html `bodyTerrain`, glue the page owns). */
function bodyTerrainOf(heightfield, waterLevel) {
  const normal = [0, 1, 0];
  return {
    height: (x, z) => {
      const h = heightfield.height(x, z);
      return Number.isFinite(h) ? h : -Infinity;
    },
    normal: (x, z, out) => {
      heightfield.normal(x, z, normal);
      out[0] = normal[0]; out[1] = normal[1]; out[2] = normal[2];
      return out;
    },
    material: (x, z) => heightfield.material(x, z),
    waterLevel: Number.isFinite(waterLevel) ? waterLevel : null,
  };
}

/** A node's world pose as `position` + row `axes` (map.html `bodyPoseOf`). */
function bodyPoseOf(node) {
  node.updateWorldMatrix(true, false);
  const e = node.matrixWorld.elements;
  return {
    position: [e[12], e[13], e[14]],
    axes: [[e[0], e[1], e[2]], [e[4], e[5], e[6]], [e[8], e[9], e[10]]],
  };
}

/** The quaternion's basis as the body modules' row `axes` (the inverse of
 *  `quaternionFromAxes`: the matrix rows are the axes, mirroring `bodyPoseOf`). */
function quaternionToAxes(q) {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
  const e = m.elements;
  return [[e[0], e[1], e[2]], [e[4], e[5], e[6]], [e[8], e[9], e[10]]];
}

/** A body position/axes pose written back onto a scene node (map.html
 *  `writeBodyPose`: the world matrix composed from the axes rows, then
 *  decomposed into the node's local transform). */
function writeBodyPose(node, body) {
  const a = body.axes, p = body.pos;
  const m = new THREE.Matrix4().set(
    a[0][0], a[1][0], a[2][0], p[0],
    a[0][1], a[1][1], a[2][1], p[1],
    a[0][2], a[1][2], a[2][2], p[2],
    0, 0, 0, 1);
  if (node.parent) {
    const parentInv = node.parent.matrixWorld.clone().invert();
    m.premultiply(parentInv);
  }
  m.decompose(node.position, node.quaternion, new THREE.Vector3());
  node.updateMatrix();
  node.updateMatrixWorld(true);
}

/** The template a placed node is an instance of (map.html `templateNameOf`). */
function templateNameOf(node) {
  return node?.userData?.control || node?.name || '';
}

/** Ships stay scenery (map.html `bodySpecFor`: a hull afloat is a
 *  FloatingBundle's work, and nothing here models one). */
function bodySpecFor(node, data) {
  if (node?.userData?.physics?.vehicleCategory === 'VCSea') return null;
  return describeVehicleParts(node, data.collisionMeshes);
}

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

// --- the shared (read-only) level data --------------------------------------

/**
 * One level, loaded once and shared by every room that plays it; every
 * field below is effectively immutable after construction. A room gets its
 * own scene-tree clone, collider, World and parked hulls via `instantiate`.
 */
export class LevelData {
  constructor(source) {
    this.name = source.name;
    this.extras = source.extras;
    this.sceneRoot = source.sceneRoot;         // null for descriptor levels
    this.heightfield = source.heightfield;     // shared lattice + materials
    this.damageTables = source.damageTables;
    this.collisionMeshes = source.collisionMeshes;
    this.templates = source.templates;         // name(lower) -> Object3D tree
    this.colliderMock = source.colliderMock;   // fake levels only
    this.loadouts = source.loadouts;           // P3 seam: kit hit points
    this.descriptor = source.descriptor || null;
    // The spawn list the vehicle table is assembled from: a descriptor's
    // own `vehicles` rows, else scene.json's objectSpawns ∪
    // vehicleSoldierSpawns (they share the ObjectSpawner shape).
    this.spawnables = source.descriptor?.vehicles ?? [
      ...(source.extras?.objectSpawns || []),
      ...(source.extras?.vehicleSoldierSpawns || []),
    ];
  }

  /** A fresh room's worth of mutable world: a clone of the level's data. */
  instantiate() {
    const extras = this.extras;
    const root = this.sceneRoot ? this.sceneRoot.clone(true) : new THREE.Object3D();
    root.name = 'room';
    root.updateMatrixWorld(true);
    if (this.sceneRoot) {
      // THREE's Object3D.copy does not carry `isMesh`/`geometry` (they are
      // Mesh-constructor fields, not Object3D fields), so a clone comes back
      // mesh-less. Re-attach the source geometry ducks onto the cloned nodes
      // by parallel traversal order — clone(true) preserves the DFS order —
      // sharing the read-only typed arrays across rooms (the index build
      // copies out what it needs; nothing writes in place).
      const srcAll = [];
      const dstAll = [];
      this.sceneRoot.traverse(o => srcAll.push(o));
      root.traverse(o => dstAll.push(o));
      if (srcAll.length !== dstAll.length) {
        throw new Error('scene clone changed shape; mesh re-attach is unsafe');
      }
      for (let i = 0; i < srcAll.length; i++) {
        if (srcAll[i].isMesh) {
          dstAll[i].isMesh = true;
          dstAll[i].geometry = srcAll[i].geometry;
        }
      }
    }
    const spawnersRoot = findSpawnersRoot(root);
    const ownerRoots = [];
    for (const child of root.children) {
      if (child === spawnersRoot) ownerRoots.push(...child.children);
      else ownerRoots.push(child);
    }

    const heightfield = this.heightfield;
    const waterLevel = extras?.waterLevel;
    const haveGround = Boolean(heightfield && this.damageTables && this.collisionMeshes);

    // Let placed hulls drop onto their springs before the index bakes them
    // (map.html settlePlacedVehicles).
    if (haveGround) settle(root, ownerRoots, heightfield, waterLevel, this);

    const statics = this.sceneRoot ? buildCollisionIndex(root, { ownerRoots }) : null;
    const collider = (this.sceneRoot && (heightfield || statics
      || Number.isFinite(waterLevel)))
      ? new WorldCollider({ heightfield, statics, waterLevel })
      : this.colliderMock;

    const groundHeightAt = collider
      ? (x, z) => {
        const h = collider.surfaceHeight(x, z);
        return Number.isFinite(h) ? h : 0;
      }
      : () => 0;
    const world = new World({
      collider,
      extras,
      damageTables: this.damageTables,
      groundHeight: groundHeightAt,
    });
    // P3 seam: `guns: null` — fire events cannot resolve into rounds until a
    // headless GunFire joins the World here (guns.collider/modifiers wiring).
    world.setCollider(collider);

    // Damageables: every owner root that carries armor extras (map.html
    // registerDamageables).
    const regPos = new THREE.Vector3();
    ownerRoots.forEach((node, owner) => {
      const armorExtras = node?.userData?.armor;
      world.addDamageable(owner, node, armorExtras, {
        name: node?.name || null,
        position: node ? (() => {
          node.updateWorldMatrix(true, false);
          node.getWorldPosition(regPos);
          return [regPos.x, regPos.y, regPos.z];
        })() : null,
      });
    });

    // Parked hulls on their own springs (map.html setupVehicleBodies).
    if (haveGround) {
      world.setupBodies({ tables: this.damageTables,
                           terrain: bodyTerrainOf(heightfield, waterLevel) });
      for (const [owner, node] of ownerRoots.entries()) {
        const spec = node?.userData?.armor ? bodySpecFor(node, this) : null;
        if (!spec) continue;
        node.updateWorldMatrix(true, false);
        statics?.setBodyOwner?.(owner, true);
        world.addParkedBody(owner, spec, bodyPoseOf(node));
      }
    }

    return new LevelInstance(this, { root, spawnersRoot, ownerRoots,
      collider, world, statics, groundHeightAt });
  }
}

function findSpawnersRoot(root) {
  let found = null;
  root.traverse(obj => {
    if (obj === root) return;
    if (obj.userData?.kind === 'spawners' || obj.name === 'spawners') found = obj;
  });
  return found;
}

function settle(root, ownerRoots, heightfield, waterLevel, data) {
  const world = new BodyWorld({
    tables: data.damageTables,
    terrain: bodyTerrainOf(heightfield, waterLevel),
  });
  const settling = [];
  ownerRoots.forEach((node, index) => {
    const spec = node?.userData?.armor ? bodySpecFor(node, data) : null;
    if (!spec) return;
    const parked = buildParkedVehicle(spec, { ...bodyPoseOf(node), asleep: false });
    world.addParked(index, parked, spec);
    settling.push({ node, body: parked.body });
  });
  for (let tick = 0; tick < SETTLE_TICKS; tick++) {
    world.tick();
    if (tick > 30 && settling.every(s => s.body.sleeping)) break;
  }
  for (const { node, body } of settling) writeBodyPose(node, body);
}

// --- one room's mutable half -------------------------------------------------

/**
 * A room's own World and its mounted vehicle table.
 *
 * `table` is one entry per seatable spawn (objectSpawns ∪
 * vehicleSoldierSpawns, or a fake descriptor's rows), `id` = 1-based index:
 * `{id, template, owner, root, kind, window, team, seated, driver}`. `root`
 * is the mount node: the cloned scene instance when the level has one, else
 * a clone of the template tree at the authored pose (an extract that
 * predates the pad).
 */
export class LevelInstance {
  constructor(data, { root, spawnersRoot, ownerRoots, collider, world, statics, groundHeightAt }) {
    this.data = data;
    this.root = root;
    this.spawnersRoot = spawnersRoot;
    this.ownerRoots = ownerRoots;
    this.collider = collider;
    this.world = world;
    this.statics = statics;
    this.groundHeightAt = groundHeightAt;
    this.surfaceFrictionAt = surfaceFrictionAt(data, collider, groundHeightAt);
    this.table = this.#buildTable(data);
    this.ownerToEntry = new Map();
    for (const entry of this.table) this.ownerToEntry.set(entry.owner, entry);
  }

  #buildTable(data) {
    const table = [];
    const spawners = this.spawnersRoot?.children || [];
    const extras = data.extras;
    let nextOwner = this.ownerRoots.length;

    const addEntry = (spawn) => {
      const template = String(spawn.vehicle || '');
      const tree = data.templates.get(template.toLowerCase());
      if (!tree) return;                          // no published model: unmountable
      if (listEntryPoints(tree).length === 0) return;  // ships and scenery stay out
      const kind = classifyRoot(tree) || 'seat';
      const window = spawnerWindow(spawn.spawner, extras?.gameplayMode) ?? (
        (Number.isFinite(spawn.minSpawnDelay) || Number.isFinite(spawn.maxSpawnDelay))
          ? { minSpawnDelay: spawn.minSpawnDelay, maxSpawnDelay: spawn.maxSpawnDelay }
          : null);
      const want = template.toLowerCase();
      const pos = spawn.position || [];
      let instance = null;
      let best = null;
      let bestDist = Infinity;
      for (const node of spawners) {
        const name = templateNameOf(node).toLowerCase();
        if (name !== want && !name.startsWith(want)) continue;
        node.updateWorldMatrix(true, false);
        const p = node.getWorldPosition(new THREE.Vector3());
        const dist = pos.length === 3
          ? Math.hypot(p.x - pos[0], p.y - pos[1], p.z - pos[2]) : 0;
        if (dist < bestDist) { bestDist = dist; best = node; }
      }
      const entry = {
        id: table.length + 1,
        template,
        owner: -1,
        root: null,
        kind,
        window,
        team: spawn.team ?? null,
        seated: 0,            // players currently mounted in this hull
        driver: null,         // the player holding the drive, if any
      };
      if (best) {
        entry.owner = this.ownerRoots.indexOf(best);
        entry.root = best;
      } else {
        // No scene instance: a template clone at the authored pose, parked
        // in as damageable furniture with a position but no static hull
        // (it cannot collide until an extractor rebuilds the level).
        entry.owner = nextOwner++;
        entry.root = tree.clone(true);
        entry.root.name = `${template}_placeholder`;
        if (pos.length === 3) entry.root.position.set(pos[0], pos[1], pos[2]);
        if (Array.isArray(spawn.rotation) && spawn.rotation.length >= 3) {
          entry.root.quaternion.setFromEuler(new THREE.Euler(
            THREE.MathUtils.degToRad(spawn.rotation[0]),
            THREE.MathUtils.degToRad(spawn.rotation[1]),
            THREE.MathUtils.degToRad(spawn.rotation[2]), 'XYZ'));
        }
        entry.root.updateMatrixWorld(true);
        const armorExtras = entry.root.userData?.armor;
        if (armorExtras) {
          const p = entry.root.getWorldPosition(new THREE.Vector3());
          this.world.addDamageable(entry.owner, entry.root, armorExtras, {
            name: entry.root.name, position: [p.x, p.y, p.z] });
        }
      }
      table.push(entry);
    };

    for (const spawn of data.spawnables) addEntry(spawn);
    return table;
  }

  /** The flags the room's HELLO carries (the world owns a copy as well). */
  get flags() { return this.world.flags; }

  /** The world owner id of the room vehicle whose seat-root is `root` — the
   *  authority's crash/water attribution lookup (one map hop over the
   *  table). */
  ownerOf(root) {
    for (const [owner, entry] of this.ownerToEntry) {
      if (entry.root === root) return owner;
    }
    return null;
  }

  /**
   * Mount `playerId` into `entry`'s seat at `seatIndex` (0 = root, then the
   * occupancy survey's declaration order — the same index the snapshot's
   * seatIndex carries).
   *
   * Mirrors map.html's `setPilot` enter flow: one VehicleOccupancy per
   * mounted player (its own active seat and aim rig), a single drive model
   * per hull (the root seat's occupant — `#vehicleTick` integrates
   * `player.vehicle` once per seated player, so a second driver would
   * advance one hull twice a tick), the drivetrain's own FireArms as
   * `groups` and the active seat's as `manned`, then `world.setPlayerVehicle`
   * with exactly the shape `#vehicleTick` consumes.
   *
   * Returns `{occupancy, vehicle, kind, seatId, entry}`, or null for a bad
   * id/seat. `world.setPlayerVehicle` has already been called on success.
   */
  mountIntoSeat(world, playerId, entry, seatIndex) {
    if (!entry) return null;
    if (!world.player(playerId)) return null;   // joined players only
    const occ = new VehicleOccupancy(entry.root, DRIVE_CLASSES);
    const order = occ.order;
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= order.length) {
      seatIndex = 0;
    }
    const seatId = order[seatIndex];
    occ.setActiveSeat(seatId);
    const kind = occ.rootKind;
    let vehicle = null;
    const driveGranted = seatId === occ.rootId
      && ['air', 'ground', 'tank'].includes(kind)
      && !this.#driveHeldByOther(playerId, entry);
    if (driveGranted) {
      vehicle = occ.ensureDrive(this.root, {
        cockpit: false,                        // no fetch of a cockpit glb
        groundHeight: (x, z) => this.groundHeightAt(x, z),
        surfaceFriction: this.surfaceFrictionAt,
      });
      if (vehicle) {
        if (kind === 'air') vehicle.state.position.y += 0.2;  // map.html's lift
        vehicle.autoFirstPerson = false;
        const spec = entry.owner >= 0 ? bodySpecFor(entry.root, this.data) : null;
        if (spec) world.adoptDriven(entry.owner, vehicle, spec);
        entry.driver = playerId;
      }
    }
    const gunGroup = node => ({ node, stats: node.userData?.fireArms || {} });
    const groups = (occ.seatInfo(occ.rootId)?.fireArms ?? []).map(gunGroup);
    const manned = occ.activeFireArmsNodes().map(gunGroup);
    world.setPlayerVehicle(playerId, { occupancy: occ, vehicle, kind, groups, manned });
    world.setPlayerPosition(playerId, this.positionOf(occ));
    entry.seated++;
    return { occupancy: occ, vehicle, kind, seatId, entry };
  }

  /** Not another mounted player holding this hull's drive. */
  #driveHeldByOther(playerId, entry) {
    return entry.driver !== null && entry.driver !== playerId;
  }

  /** The seat survey a mount would get: for the failure log — the order's
   *  size and the root kind decide why `mountIntoSeat` refused. */
  seatSurveyOf(entry) {
    if (!entry?.root) return null;
    const occ = new VehicleOccupancy(entry.root, DRIVE_CLASSES);
    return { order: occ.order.length, kind: occ.rootKind,
             rootId: occ.rootId, extras: !!(entry.root.userData?.vehicleSoldierSpawns) };
  }

  /** A seated player's current world position: the root's live world matrix,
   *  kept fresh by the driver's `applyTransform` (the page's per-frame
   *  `setPlayerPosition` feed, for the bare-seat combat-area and snapshot). */
  positionOf(occ) {
    occ.root.updateMatrixWorld(true);
    const e = occ.root.matrixWorld.elements;
    return [e[12], e[13], e[14]];
  }

  /**
   * Unmount: the engine's leave law, mirrored from map.html's leaveVehicle +
   * exitVehicle + exitPoseManned — the drive's velocities zero, the state is
   * applied back onto the node (`applyTransform`/`applyRig`), the hull parks
   * on its springs where it stood (`releaseDriven`, carry velocity), the
   * soldier is re-placed at the seat's exit point, and the world's mount is
   * cleared. Returns the exit pose, or null if nothing was mounted.
   */
  unmountFromSeat(world, playerId, entry) {
    const player = world.player(playerId);
    if (!player?.occupancy) return null;
    const occ = player.occupancy;
    const exit = this.exitPoseOf(occ);
    const vehicle = player.vehicle;
    if (vehicle) {
      vehicle.state.velocity.set(0, 0, 0);
      vehicle.state.angularVelocity.set(0, 0, 0);
      vehicle.state.throttle = 0;
      vehicle.setInput('c_PIThrottle', 0);
      vehicle.setInput('c_PIYaw', 0);
      vehicle.setInput('c_PIFire', 0);
      vehicle.applyTransform();
      vehicle.applyRig();
      const spec = bodySpecFor(occ.root, this.data);
      if (spec) {
        const s = vehicle.state;
        world.releaseDriven(entry.owner, vehicle, spec, {
          position: [s.position.x, s.position.y, s.position.z],
          axes: quaternionToAxes(s.orientation),
        });
      }
      entry.driver = null;
    }
    if (entry.seated > 0) entry.seated--;
    world.clearPlayerVehicle(playerId);
    world.resetStick(playerId);
    if (player.soldier) {
      player.soldier.collider = world.collider;
      player.soldier.spawn(exit.x, exit.y, exit.z, exit.yaw);
    }
    return exit;
  }

  /** The seat's exit point in world space (map.html exitPoseManned — the
   *  ROOT's transform, not the seat's: a hull door is a hull door, and the
   *  root is the one the drive keeps fresh). */
  exitPoseOf(occ) {
    const declared = occ.exitLocationNode()?.userData?.physics?.soldierExitLocation;
    const local = (declared && Array.isArray(declared.position))
      ? new THREE.Vector3(declared.position[0], declared.position[1],
        -declared.position[2])
      : new THREE.Vector3(-2, 0.5, 0);
    const position = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    readWorldPose(occ.root, position, quat);
    local.applyQuaternion(quat).add(position);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    return { x: position.x, y: position.y, z: position.z,
             yaw: Math.atan2(fwd.x, fwd.z) };
  }

  /** Seat switch within the same hull: the active seat changes, the manned
   *  guns and the aim rig rebuild, the bare-seat position feed refreshes.
   *  The drive model stays with the mounting player and coasts — round 3's
   *  first disclosed gap is the law here, not a bug to fix. */
  switchSeat(world, playerId, entry, seatIndex) {
    const player = world.player(playerId);
    if (!player?.occupancy?.root || player.occupancy.root !== entry.root) return null;
    const occ = player.occupancy;
    const order = occ.order;
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= order.length) {
      return null;
    }
    const seatId = order[seatIndex];
    if (seatId === occ.activeSeatId) return { occ, seatId, changed: false };
    occ.setActiveSeat(seatId);
    const gunGroup = node => ({ node, stats: node.userData?.fireArms || {} });
    const manned = occ.activeFireArmsNodes().map(gunGroup);
    world.refreshMount(playerId, { manned });
    world.setPlayerPosition(playerId, this.positionOf(occ));
    return { occ, seatId, changed: true };
  }
}

/**
 * The page's `surfaceFriction(x, z)`: the lazily built material-friction
 * table from `_shared/damage.json`, water forced to the water material
 * (damage.json's own WATER id — collision.js's WATER_MATERIAL — is what the
 * body modules key on), everything else the default 1.0. A level without
 * damage tables answers the default for every sample.
 */
function surfaceFrictionAt(data, collider, groundHeightAt) {
  let table = null;
  const materials = data.damageTables?.materials;
  if (materials) {
    table = new Float32Array(Math.max(1, ...Object.keys(materials).map(Number)) + 1)
      .fill(1);
    for (const [id, m] of Object.entries(materials)) {
      const n = Number(id);
      if (Number.isFinite(n) && n >= 0 && n < table.length) {
        table[n] = Number.isFinite(m?.friction) ? m.friction : 1;
      }
    }
  }
  const waterLevel = data.extras?.waterLevel;
  return (x, z) => {
    if (!table) return 1;
    let id = collider?.heightfield?.material(x, z) ?? 0;
    if (Number.isFinite(waterLevel) && groundHeightAt(x, z) <= waterLevel) {
      id = 1;   // collision.js WATER_MATERIAL — the body modules' key
    }
    if (!Number.isInteger(id) || id < 0 || id >= table.length) return 1;
    return table[id];
  };
}

// --- fake levels (the harness's EXTRAS-shaped descriptor) -------------------

/**
 * The harness level: a flat-ground mock collider, two flags and a pair of
 * seatable vehicles resolved from the models dir. `rooms.mjs` registers it
 * under the name `test`, so the socket test drives the whole junction
 * without a real map — the same way `world_harness`'s collider mock stands
 * in for the page's buildCollider.
 */
export function fakeLevelDescriptor({ viewerDir }) {
  return {
    name: 'test',
    extras: {
      worldSize: 600,
      gameplayMode: 'Conquest',
      controlPoints: [
        { name: 'North', spawnGroupId: 1, team: 1, position: [10, 0, 10] },
        { name: 'South', spawnGroupId: 2, team: 2, position: [-10, 0, -10] },
      ],
      soldierSpawns: [
        // rotation [180,0,0] so `spawnYaw` is 0 — the page yaw that faces +Z.
        { name: 'N1', group: 1, team: 1, position: [10, 0, 10], rotation: [180, 0, 0] },
        { name: 'N2', group: 1, team: 1, position: [14, 0, 10], rotation: [180, 0, 0] },
        { name: 'S1', group: 2, team: 2, position: [-10, 0, -10], rotation: [180, 0, 0] },
        { name: 'S2', group: 2, team: 2, position: [-14, 0, -10], rotation: [180, 0, 0] },
      ],
      tickets: { team1: 100, team2: 100,
        lossPerMin: { team1: 30, team2: 30 } },
    },
    collider: {
      waterLevel: null,
      heightfield: null,
      statics: null,
      surfaceHeight(x, z) { return 0; },
    },
    vehicles: [
      // Real published templates (the harness copies the glbs into its temp
      // overlay), so the seat table, the drive model and the body spec are
      // the real thing rather than a hand-built fixture.
      { vehicle: 'Willy', team: 1, position: [40, 0, 40], rotation: [0, 0, 0],
        minSpawnDelay: 40, maxSpawnDelay: 80 },
      { vehicle: 'Zero', team: 2, position: [-40, 0, -40], rotation: [0, 0, 0],
        minSpawnDelay: 40, maxSpawnDelay: 80 },
    ],
  };
}

/**
 * A LevelData built from a descriptor rather than a maps tree entry: the
 * vehicle instances are clones of the published template trees at the
 * descriptor's poses; no scene.glb, no heightfield, no sidecars. The room's
 * World runs on the descriptor's collider mock (flat ground by default).
 */
export function buildLevelFromDescriptor({ viewerDir, descriptor = null }) {
  const spec = descriptor || fakeLevelDescriptor({ viewerDir });
  const templates = new Map();
  for (const v of spec.vehicles || []) {
    const name = String(v.vehicle || '').toLowerCase();
    if (templates.has(name)) continue;
    const path = resolveTemplatePath(modelsDirOf(viewerDir), String(v.vehicle || ''));
    if (!existsSync(path)) continue;
    templates.set(name, loadVehicleTree(path));
  }
  return new LevelData({
    name: spec.name || 'test',
    extras: spec.extras,
    sceneRoot: null,
    heightfield: null,
    damageTables: null,
    collisionMeshes: null,
    templates,
    colliderMock: spec.collider || null,
    loadouts: null,
    descriptor: spec,
  });
}

// --- the real level ----------------------------------------------------------

/**
 * Load a published maps tree entry, headless.
 *
 * `viewerDir` is the viewer directory (`.../viewer`); `name` is the level's
 * directory under `viewer/maps` (e.g. `wake`). Reads scene.json, the
 * scene.glb's JSON + BIN chunks, the terrain material map, and the shared
 * sidecars (damage.json via scene.json's own `damage.path`, plus
 * collision-meshes.json and loadouts.json in `maps/_shared`), then builds
 * the terrain lattice with the page's own `buildHeightfield` law.
 */
export function loadRealLevel({ viewerDir, name }) {
  const mapsDir = join(viewerDir, 'maps');
  const levelDir = join(mapsDir, name);
  const sharedDir = join(mapsDir, '_shared');
  const scenePath = join(levelDir, 'scene.json');
  if (!existsSync(scenePath)) throw new Error(`no scene.json for level "${name}"`);

  const extras = JSON.parse(readFileSync(scenePath, 'utf8'));
  const { json, bin } = readGlb(join(levelDir, 'scene.glb'));
  const { root, terrainTiles } = buildSceneTree(json, bin);

  // The heightfield, recovered from the terrain tiles by the page's own snap
  // law (see the header comment), shared read-only by every room.
  const heightfield = buildHeightfield(terrainTiles, {
    worldSize: extras?.worldSize || 0,
    dim: extras?.terrain?.materials?.dim || 0,
  });

  // The per-sample material id map: the red channel of the authored PNG.
  const terrain = extras?.terrain || {};
  const materials = terrain.materials;
  if (heightfield && materials?.image) {
    const pngPath = join(levelDir, materials.image);
    if (existsSync(pngPath)) {
      const ids = decodeMaterialIds(readFileSync(pngPath));
      heightfield.setMaterials(ids, materials.dim, materials.spacing
        || heightfield.spacing);
    }
  }

  // Shared sidecars. `extras.damage.path` is URI-style ("../_shared/...").
  const damageTables = readShared(sharedDir, levelDir, extras.damage?.path, 'damage.json');
  const collisionMeshes = readShared(sharedDir, levelDir, null, 'collision-meshes.json');
  const loadouts = readShared(sharedDir, levelDir, null, 'loadouts.json');

  // The published template trees, cached per template name.
  const templates = new Map();
  for (const spawn of [...(extras.objectSpawns || []),
    ...(extras.vehicleSoldierSpawns || [])]) {
    const template = String(spawn.vehicle || '').toLowerCase();
    if (templates.has(template)) continue;
    const path = resolveTemplatePath(modelsDirOf(viewerDir), String(spawn.vehicle || ''));
    if (!existsSync(path)) continue;
    templates.set(template, loadVehicleTree(path));
  }

  return new LevelData({
    name, extras, sceneRoot: root, heightfield, damageTables,
    collisionMeshes, templates, colliderMock: null, loadouts,
  });
}

function modelsDirOf(viewerDir) { return join(viewerDir, 'models'); }

/**
 * A template's published glb, matched case-insensitively: the plain
 * `<Template>.glb` when it exists (replica/replay assets), else the first
 * per-level instance (`<Template>.<Level>.glb` — the extractor publishes
 * most vehicles under the level they were captured from; the seat trees are
 * identical across instances, so any one mounts the same way). Scene JSON
 * spells vehicle names lowercase and the files are CamelCase, so the whole
 * match is case-folded.
 */
function resolveTemplatePath(modelsDir, template) {
  const stem = `${template.toLowerCase()}.`;
  let plain = null;
  let prefixed = null;
  try {
    for (const entry of readdirSync(modelsDir)) {
      const lower = entry.toLowerCase();
      if (!lower.startsWith(stem) || !lower.endsWith('.glb')) continue;
      if (lower === `${stem}glb` && plain === null) plain = entry;
      else if (prefixed === null) prefixed = entry;
      if (plain && prefixed) break;
    }
  } catch { /* the models dir is optional on a bare harness */ }
  if (plain) return join(modelsDir, plain);
  if (prefixed) return join(modelsDir, prefixed);
  return join(modelsDir, `${template}.glb`);
}

/**
 * One sidecar, first match of the level-relative URI (scene.json's own
 * `damage.path`) then the `_shared` name; null when neither exists (an old
 * extract, a harness overlay) — never throws.
 */
function readShared(sharedDir, levelDir, uri, fallbackName) {
  const candidates = [];
  if (uri) candidates.push(join(levelDir, uri));
  if (fallbackName) candidates.push(join(sharedDir, fallbackName));
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw new Error(`bad sidecar ${path}: ${error.message}`);
    }
  }
  return null;
}