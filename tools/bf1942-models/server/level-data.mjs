// The shared (read-only) half of a level and the per-room `instantiate()`
// that clones it into a LevelInstance. Split out of `level.mjs`, which
// re-exports `LevelData`.

import * as THREE from 'three';

import { World } from '../viewer/world.js';
import { WorldCollider } from '../viewer/world-collider.js';
import { buildCollisionIndex } from '../viewer/static-index.js';
import { bodyPoseOf, bodySpecFor, bodyTerrainOf, settle } from './level-bodies.mjs';
import { LevelInstance } from './level-instance.mjs';

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
