// The shared (read-only) half of a level and the per-room `instantiate()`
// that clones it into a LevelInstance. Split out of `level.mjs`, which
// re-exports `LevelData`.

import * as THREE from 'three';

import { MAX_PLAYERS } from '../viewer/netcode.js';
import { pruneToMode, resolveMode, selectGameMode } from '../viewer/game-modes.js';
import { scaleTickets } from '../viewer/round-state.js';
import { World } from '../viewer/world.js';
import { WorldCollider } from '../viewer/world-collider.js';
import { collectLadders } from '../viewer/ladder-climb.js';
import { detachSpawnedCraft } from '../viewer/spawned-craft.js';
import { bindArm } from '../viewer/held-arm.js';
import { buildCollisionIndex } from '../viewer/static-index.js';
import { attachCoarseLayer } from '../viewer/coarse-layer.js';
import { addLentCollisionCopies } from '../viewer/collision-meshes.js';
import { bodyPoseOf, bodySpecFor, bodyTerrainOf, settle } from './level-bodies.mjs';
import { LevelInstance } from './level-instance.mjs';
import { createRoomShips, floatSeaHulls, ownDeckPoints } from './room-ships.mjs';
import { collectSupplyDepots } from '../viewer/supply-collect.js';

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
    this.paths = source.paths ?? null;         // the level's trees (`room-bots.mjs`)
    this.soldierBody = source.soldierBody ?? null;   // gaits.json's: a blast's push
    this.descriptor = source.descriptor || null;
    // scene.glb node index -> the rotation keys of a turning part that
    // carries a held craft (`glb-scene.mjs` `readArmTracks`).
    this.armTracks = source.armTracks ?? new Map();
    // The default layer's spawn list (`spawnablesFor`); a room on another
    // layer builds its own from that layer's report.
    this.spawnables = this.spawnablesFor(source.extras);
  }

  /** The layer `wanted` names on this level, the page's `?mode=` law
   *  (`game-modes.js` `resolveMode`): the default layer for nothing or a
   *  name the level does not have, null for a report with no layers. */
  modeOf(wanted = null) {
    return resolveMode(this.extras, wanted);
  }

  /** The report as one layer reads it (`selectGameMode`, what the page's
   *  `show()` does with `?mode=`): that layer's flags, spawns, pads, tickets,
   *  combat area and CTF bases over the level's own keys. */
  extrasFor(mode = null) {
    return selectGameMode(this.extras, mode);
  }

  /** The spawn list a vehicle table is assembled from: a descriptor's own
   *  `vehicles` rows, else the layer's objectSpawns ∪ vehicleSoldierSpawns
   *  (they share the ObjectSpawner shape). */
  spawnablesFor(extras) {
    return this.descriptor?.vehicles ?? [
      ...(extras?.objectSpawns || []),
      ...(extras?.vehicleSoldierSpawns || []),
    ];
  }

  /** A fresh room's worth of mutable world: a clone of the level's data, on
   *  the layer `mode` names (the default for none). */
  instantiate(mode = null) {
    // The room's own deck points: a ship under way here moves no other
    // room's (`room-ships.mjs`).
    const extras = ownDeckPoints(this.extrasFor(mode));
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
        // And the node's `scene.glb` index (`glb-scene.mjs`), which a clone
        // does not carry either.
        if (srcAll[i].levelNode != null) dstAll[i].levelNode = srcAll[i].levelNode;
      }
    }
    // The glb holds every layer's vehicles and statics; the page detaches
    // the ones its layer does not place before anything indexes the scene
    // (`level-load.js`, `pruneToMode`), and so does the room, so both build
    // their owner lists, collision and vehicle tables from the same nodes.
    if (this.sceneRoot) pruneToMode(root, extras?.gameplayMode);
    // A craft a static's spawner holds is a vehicle of its own, as it is on
    // the page (`spawned-craft.js`, FH's flying spawn), and the part that
    // carries it turns with this world's ticks (`held-arm.js`). So is a
    // ship's landing craft or deck aircraft, split off her before anything
    // indexes the scene (`room-ships.mjs` floats and sails her).
    // Her spawners' other slots are copies of the baked craft, each a
    // vehicle of its own that `room-pads.mjs` stands when its turn comes
    // (SPAWN-24); a static's held craft has the baked one alone here.
    const heldCraft = this.sceneRoot ? detachSpawnedCraft(root, { extraSlots: 'ship', clone: cloneWithMeshes }) : [];
    if (this.armTracks.size) {
      root.traverse(node => {
        const track = node.levelNode != null ? this.armTracks.get(node.levelNode) : null;
        if (track) bindArm(node, track);
      });
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

    // A borrowed collision mesh at its root's own transform as well (COL-18,
    // level-terrain.js buildCollider).
    addLentCollisionCopies(ownerRoots, THREE);
    // Every floating hull at its draft, its deck aircraft and deck points
    // with it, before the settle and the index (`hull-bodies.js`
    // `floatPlacedVehicles`).
    const ships = createRoomShips(this, this.sceneRoot
      ? floatSeaHulls(ownerRoots, waterLevel, extras) : { floatHosts: [], deckHosts: [] });
    // Let placed hulls drop onto their springs before the index bakes them
    // (map.html settlePlacedVehicles).
    if (haveGround) settle(root, ownerRoots, heightfield, waterLevel, this, extras);

    const statics = this.sceneRoot
      ? buildCollisionIndex(root, { ownerRoots, collisionGroups: extras?.collisionGroups ?? null })
      : null;
    // A large root's layer of each two-layer static (COL-22, `coarse-layer.js`).
    attachCoarseLayer(statics, this.collisionMeshes?.staticCoarse,
      { collisionGroups: extras?.collisionGroups ?? null });
    // The level's ladders, as the page's `buildCollider` indexes them: the
    // room is the authority for a soldier's movement, and `soldier.js` climbs
    // only what `collider.ladders` holds, so without them a client's climb was
    // corrected back to the foot. Each keeps the owner it hangs in, and follows
    // that hull's moves (`followLadder`; LADDER-1, 0x0827d3b0).
    const ladders = this.sceneRoot
      ? collectLadders(root, { ownerOf: node => statics?.ownerOf?.(node) ?? -1 })
      : null;
    const collider = (this.sceneRoot && (heightfield || statics
      || Number.isFinite(waterLevel)))
      ? new WorldCollider({ heightfield, statics, waterLevel,
                            ladders: ladders?.length ? ladders : null })
      : this.colliderMock;

    ships.bind(collider);
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
    // The World's `guns` join it per room (`room-guns.mjs`, which needs the
    // room's hits and its random): the seat guns' rounds are flown there.
    world.setCollider(collider);
    // The room's own tickets: the level's scaled for the room's slot count
    // (round-state.js `scaleTickets`, ledger TKT-1), which at the lobby's 16
    // is the level's numbers except where its script sets its own max
    // players. A copy, so the authority spends this room's counts and not
    // the ones every room of the level shares.
    world.tickets = scaleTickets(extras?.tickets, MAX_PLAYERS);

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

    // The level's supply depots, found by the page's own walk
    // (`supply-collect.js`): the room's world heals, rearms and repairs at
    // them (`world-fields.js` `supplyFieldTick`), and the page takes the
    // server's hit points (`net-room.js`).
    world.setSupplyDepots(collectSupplyDepots(root, { spawnersRoot }));

    // Parked hulls on their own springs (map.html setupVehicleBodies).
    if (haveGround) {
      // The static world as the page hands it (`hull-bodies.js`
      // `setupVehicleBodies`): a driven hull's col0 against the buildings is
      // the contact solver's, and its drive's swept sphere stands down.
      world.setupBodies({ tables: this.damageTables,
                           terrain: ships.withDecks(bodyTerrainOf(heightfield, waterLevel)),
                           statics: collider?.statics && typeof collider.staticProbe === 'function'
                             ? collider.staticProbe() : null });
      for (const [owner, node] of ownerRoots.entries()) {
        const spec = node?.userData?.armor ? bodySpecFor(node, this) : null;
        if (!spec) continue;
        node.updateWorldMatrix(true, false);
        statics?.setBodyOwner?.(owner, true);
        world.addParkedBody(owner, spec, bodyPoseOf(node));
      }
    }

    return new LevelInstance(this, { root, spawnersRoot, ownerRoots,
      collider, world, statics, groundHeightAt,
      extras, spawnables: this.spawnablesFor(extras), heldCraft, ships });
  }
}

/** `o.clone(true)` with what a clone drops put back (see `instantiate`):
 *  each mesh's geometry, shared with the source and never written. The
 *  copy keeps no `levelNode`: it is no node of `scene.glb`. */
function cloneWithMeshes(o) {
  const copy = o.clone(true);
  const src = [];
  const dst = [];
  o.traverse(n => src.push(n));
  copy.traverse(n => dst.push(n));
  for (let i = 0; i < src.length && i < dst.length; i++) {
    if (src[i].isMesh) { dst[i].isMesh = true; dst[i].geometry = src[i].geometry; }
  }
  return copy;
}

function findSpawnersRoot(root) {
  let found = null;
  root.traverse(obj => {
    if (obj === root) return;
    if (obj.userData?.kind === 'spawners' || obj.name === 'spawners') found = obj;
  });
  return found;
}
