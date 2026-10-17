// The world, as the server has it: every vehicle on the field is one the
// server's object table names, stood up from its template at the pose the
// server sends and taken away when the server destroys it.
//
// This is the entity half of server-authoritative multiplayer
// (`features/server-authoritative-multiplayer/README.md`). The page's own
// law, which this replaces in that mode, is the opposite one: the level
// places every vehicle at load, nothing is ever created afterwards (a pad's
// "respawn" un-hides a node that was always there, `vehicle-wrecks.js`
// `respawnVehicle`), and a server object is married onto one of those level
// copies by template and proximity (`net-room.js` `sidecarNodeFor`, a 25 m
// bind radius). The marriage fails whenever identity does not line up -- a
// hull respawned under a fresh netId while the dead one still holds the
// node, a plane that flew away from its pad, more server instances than the
// level places -- and a failed marriage leaves NO body: nothing drawn,
// nothing to collide with, nothing to enter. Live on 2026-10-17 the owner
// walked through a Stuka and a flak gun that his retail client could see,
// and found a respawned APC 108 m from where the page drew its wreck.
//
// What an entity is here: the template's glb, a seat survey so it can be
// entered (`seat-survey.js` `surveyVehicle`, whose order is the one the
// server's `seatIndex` names), a collider owner so the player can stand on
// it and bump into it (`world-collider.js` `addOwner` / `setMovedOwner`, the
// arrangement `hull-bodies.js` `publishMovedHull` uses for a shoved hull),
// and an Armor so it can be shot (`registerDamageable`, `spawned: true` --
// the category EMT-10 gives an object no ObjectSpawner made). What it is
// NOT is a simulated vehicle: nothing here integrates physics. The server
// owns where it is, and this draws it there.
import * as THREE from 'three';
import { surveyVehicle } from './seat-survey.js';

const _fwd = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();

/**
 * `ctx`:
 *   `scene`      the group to hang entities under
 *   `model(t)`   a promise of the template's scene, already painted and
 *                shaded (`netcode-render.js` owns the cache and the paint)
 *   `collider()` the page's collider, or null
 *   `registerDamageable(owner, node, opts)` / `page.world`'s side of it
 *   `onRemoved(id)` told when an entity goes, so a caller can forget it
 */
export function createServerEntities(ctx) {
  /** netId -> entity. An entity exists from the moment the server names the
   *  object; `loaded` says whether its glb has arrived yet. */
  const entities = new Map();
  let disposed = false;

  function ensure(id, template) {
    const have = entities.get(id);
    if (have && have.template === template) return have;
    if (have) drop(id);
    const group = new THREE.Group();
    group.name = `server vehicle ${id} ${template}`;
    // Hidden until its first pose: a hull drawn at the origin for one frame
    // is a vehicle that flicks across the map on every spawn.
    group.visible = false;
    ctx.scene.add(group);
    const e = { id, template, group, survey: null, loaded: false, owner: -1,
                bakedInverse: null, radius: 0, posed: false };
    entities.set(id, e);
    ctx.model?.(template)?.then(m => {
      if (disposed || entities.get(id) !== e || !m) return;
      e.group.add(m);
      e.loaded = true;
      // The seat table on these fresh nodes. The survey's order is the law
      // the server's `seatIndex` addresses (root first, seat-survey.js), so
      // a seat index off the wire indexes this directly.
      e.survey = surveyVehicle(e.group);
      register(e);
    }).catch(() => {});
    return e;
  }

  /** Its hulls into the collider and its Armor into the damageables, at the
   *  pose it is standing in now -- which is the server's, because `place`
   *  runs before the glb arrives and again every frame after. */
  function register(e) {
    e.group.updateWorldMatrix(true, true);
    e.bakedInverse = e.group.matrixWorld.clone().invert();
    _box.setFromObject(e.group);
    if (!_box.isEmpty()) {
      _box.getSize(_size);
      e.radius = _size.length() / 2;
    }
    const collider = ctx.collider?.();
    e.owner = collider?.addOwner?.(e.group) ?? -1;
    if (e.owner >= 0) {
      e.damageable = ctx.registerDamageable?.(e.owner, e.group, {
        spawned: true, onRemoved: () => drop(e.id),
      }) ?? null;
    }
  }

  /** The server's pose for this frame. `pose` is `{x, y, z, q}` in the
   *  page's frame (`net-sidecar.js` `remoteVehicle`, already lerped through
   *  the render lookback). */
  function place(e, pose) {
    if (!pose) return;
    e.group.position.set(pose.x, pose.y, pose.z);
    if (pose.q) e.group.quaternion.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]);
    e.group.updateMatrixWorld(true);
    e.posed = true;
    if (e.loaded) e.group.visible = true;
    if (e.owner >= 0 && e.bakedInverse) {
      _fwd.multiplyMatrices(e.group.matrixWorld, e.bakedInverse);
      _inv.copy(_fwd).invert();
      ctx.collider?.()?.setMovedOwner?.(e.owner, _fwd.elements, _inv.elements,
        pose.x, pose.y, pose.z, e.radius);
    }
  }

  function drop(id) {
    const e = entities.get(id);
    if (!e) return;
    entities.delete(id);
    if (e.owner >= 0) ctx.collider?.()?.clearMovedOwner?.(e.owner, { enable: false });
    e.group.parent?.remove(e.group);
    ctx.onRemoved?.(id);
  }

  /**
   * One frame. `client` is the sidecar client: `client.vehicles` is the
   * server's object table (id -> {id, template, ...}) and
   * `client.remoteVehicle(id, nowMs)` its pose at the drawn moment. Every
   * object the server has gets an entity; every entity the server no longer
   * has goes.
   */
  function sync(client, nowMs) {
    if (disposed || !client) return;
    const seen = new Set();
    for (const [id, v] of client.vehicles ?? []) {
      if (!v?.template) continue;
      seen.add(id);
      const e = ensure(id, v.template);
      place(e, client.remoteVehicle?.(id, nowMs) ?? null);
    }
    for (const id of [...entities.keys()]) if (!seen.has(id)) drop(id);
  }

  function dispose() {
    disposed = true;
    for (const id of [...entities.keys()]) drop(id);
  }

  /** For a headless check: what stands on the field, and where. */
  function debug() {
    return [...entities.values()].map(e => ({
      id: e.id, template: e.template, loaded: e.loaded, posed: e.posed,
      owner: e.owner, seats: e.survey?.order?.length ?? 0,
      at: e.posed ? [+e.group.position.x.toFixed(1), +e.group.position.y.toFixed(1),
                     +e.group.position.z.toFixed(1)] : null,
    }));
  }

  return { sync, drop, dispose, debug, entities, entityFor: id => entities.get(id) ?? null };
}
