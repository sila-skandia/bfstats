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
import { applyJoints } from './netcode-render.js';
import { surveyVehicle } from './seat-survey.js';
import {
  ENGINE_TICK_HZ, discAt, engineOfLodPair, lodNodeKey, lodSpinState, poseLodSpin, stepLodSpin,
} from './engine-spin.js';

/** A hull that has not moved this far is not republished to the collider:
 *  a millimetre and a thousandth of a quaternion, both well under what a
 *  snapshot's own quantisation carries. */
const POSE_EPS = 0.001;
const QUAT_EPS = 0.001;

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
 *   `groundY(x, z)` the ground, for a createObject with no height
 *   `ownId()` the entity id this page's player controls, or null
 */
export function createServerEntities(ctx) {
  /** netId -> entity. An entity exists from the moment the server names the
   *  object; `loaded` says whether its glb has arrived yet. */
  const entities = new Map();
  let disposed = false;
  let lastSync = null;   // the previous sync's clock, for the engine spin's dt

  /**
   * A hull, and not one of the other things the server's object table holds.
   * The server names the class outright: `SimpleObjectNetworkable` is every
   * vehicle on El Alamein, from a Tiger to a Stationary_mg42, while a flag
   * is a `ControlPointNetworkable`, a soldier a `BFSoldierNetworkable`, a
   * dropped kit a `KitNetworkable` and a round a `ProjectileNetworkable`.
   * Standing those too gave the field six `MultiPlayerFreeCamera`s, five
   * control points and a set of soldier and kit bodies as collidable hulls.
   * An entry whose class never arrived falls back to the template, which is
   * how the cameras are kept out: they carry no class in the world dump.
   */
  function isHull(v) {
    // Strictly the class, never a guess from the name. The fallback this
    // replaces let through every object whose class had not arrived yet,
    // and two `BritishSoldier` bodies were stood as static world models
    // beside the soldiers the renderer was already drawing (live,
    // 2026-10-17). An object whose class arrives later is stood on the
    // frame it arrives, so nothing is lost by waiting for it.
    // A class the server states is taken at its word. Silence has to be
    // allowed -- about half of a level's vehicles never get a class row,
    // and requiring one left 20 hulls standing out of 46 -- so what comes
    // through silent is filtered twice more: by identity, where the roster
    // names a player's body, camera or kit (`client.playerOwned`, applied
    // by the caller), and by the one name rule below.
    //
    // The name rule is a STOPGAP and only for silence: vanilla's control
    // points are `<Place>Base` and its soldier bodies `<Nation>Soldier`,
    // both of which arrived classless and stood on the field as props (five
    // control points and two `BritishSoldier` bodies, live 2026-10-18). A
    // mod that names either differently will leak one through until its
    // class arrives; the real fix is to find why these objects carry no
    // class row, which is a wire question, not a viewer one.
    if (v.cls) return v.cls === 'SimpleObjectNetworkable';
    // A dropped kit is named by the mod's own loadouts, so that list
    // answers for kits exactly and for every mod (`GB_Medic`,
    // `German_Assault_Desert` and three more stood as props here before it
    // was asked).
    if (ctx.isKit?.(v.template)) return false;
    return !/(?:Base|Soldier)$/i.test(v.template);
  }

  function ensure(id, template) {
    const have = entities.get(id);
    if (have && have.template === template) return have;
    if (have) drop(id);
    const group = new THREE.Group();
    group.name = `server vehicle ${id} ${template}`;
    // The template, where the level's own nodes carry it: the map surfaces
    // pick a hull's minimap silhouette by `userData.control` (map-surfaces.js
    // `drawVehicles`), and these groups are what stands for a hull there.
    group.userData.control = template;
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
      // The joint-node index is of the glb's nodes: one cached off the bare
      // group before the glb landed would be empty for ever.
      e.jointNodes = null;
      // The seat table on these fresh nodes. The survey's order is the law
      // the server's `seatIndex` addresses (root first, seat-survey.js), so
      // a seat index off the wire indexes this directly.
      e.survey = surveyVehicle(e.group);
      e.spin = collectSpinPairs(e.group);
      // Registration waits for a pose: `addOwner` bakes the hull where it
      // stands, and a hull baked at the origin would have to be published
      // as a moved owner forever (below).
      if (e.posed) register(e);
    }).catch(() => {});
    return e;
  }

  /**
   * Every propeller, rotor and screw in a loaded hull, as `model-clips.js`
   * `collectAnimations` gathers them: the blade mesh and the blurred disc the
   * exporter kept as real siblings (`extras.propellerBlur`), paired with the
   * Engine they hang under. Only pairs under an Engine are kept -- one under
   * no engine is a legacy asset the page turns from a baked clip, and that
   * clip is not ours to run on someone else's hull.
   */
  function collectSpinPairs(root) {
    const pairs = [];
    root.traverse(obj => {
      const blur = obj.userData?.propellerBlur;
      if (!blur) return;
      const staticKey = lodNodeKey(blur.static), blurredKey = lodNodeKey(blur.blurred);
      const staticNode = obj.children.find(c => lodNodeKey(c.name) === staticKey);
      const blurredNode = obj.children.find(c => lodNodeKey(c.name) === blurredKey);
      const engine = engineOfLodPair(obj);
      if (!staticNode || !blurredNode || !engine) return;
      const pair = { static: staticNode, blurred: blurredNode, engine,
                     threshold: blur.comparisons?.[0] ?? 0.07, ...lodSpinState(staticNode, blurredNode) };
      // Standing still until the server says otherwise: blade shown at its
      // authored pose, disc hidden, exactly as a model loads with its engine
      // off (`Engine+0x142` clear, PHY-14).
      pair.static.visible = true;
      pair.blurred.visible = false;
      poseLodSpin(pair);
      pairs.push(pair);
    });
    return pairs.length ? pairs : null;
  }

  /**
   * One frame of this hull's propellers, from the revs the SERVER sent for its
   * Engine children (`net-sidecar.js` `revs`, the ghost's `E` bodies in
   * template tree order). A client is told these -- it does not derive them:
   * `EngineNetworkable::updateStateMask` (0x08227620) puts `PhysicsEngine+0xa0`
   * on the wire under mask bit 0x080, and `setNetUpdate` (0x08227da0) writes
   * it back to the same offset, which is what the tail of
   * `PhysicsEngine::updatePhysics` spins the first child LodObject from
   * (PHY-30, `engine-spin.js`).
   *
   * The figure is 80% of the server's and is used as it arrives: the writer
   * divides by 1.25 and the reader drops its `max` argument, so retail's own
   * remote propellers turn at revs/1.25 (see `sidecar/ghost/engine.mjs`).
   * Measured live: a parked plane sits at 0.000 and a flying one tops out at
   * 0.96, which is the engine's 1.2 clamp over 1.25.
   *
   * Pairing revs to pairs: index for index while the counts agree (a B17 sends
   * four engine bodies and carries four propellers), otherwise every pair
   * takes the first engine's revs. One throttle drives all of a plane's
   * engines, so the two differ only for a hull losing one.
   */
  function spin(e, revs, dt) {
    if (!e.spin || !Array.isArray(revs) || !revs.length) return;
    const ticks = Math.max(0, dt) * ENGINE_TICK_HZ;
    if (!(ticks > 0)) return;
    const byIndex = revs.length === e.spin.length;
    for (let i = 0; i < e.spin.length; i++) {
      const pair = e.spin[i];
      const r = Number.isFinite(byIndex ? revs[i] : revs[0]) ? (byIndex ? revs[i] : revs[0]) : 0;
      stepLodSpin(pair, r, ticks);
      pair.static.visible = !discAt(r, pair.threshold);
      pair.blurred.visible = !pair.static.visible;
      poseLodSpin(pair);
    }
  }

  /** Its hulls into the collider and its Armor into the damageables, at the
   *  pose it is standing in now -- which is the server's, because `place`
   *  runs before the glb arrives and again every frame after. */
  function register(e) {
    if (e.registered) return;
    e.registered = true;
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
    // CreateObject's position is three raw float32s off the wire and the
    // server does send NaN heights (El Alamein's PanzerIV 554 came as
    // [1330.36, NaN, 1361.35], live 2026-10-18): a NaN that reaches the
    // group poisons its matrix, the collider bake and every map read of it.
    // Finite x/z with a bad y stands on the ground; a bad x or z is no pose.
    if (!Number.isFinite(pose.x) || !Number.isFinite(pose.z)) return;
    if (!Number.isFinite(pose.y)) {
      const g = ctx.groundY?.(pose.x, pose.z);
      if (!Number.isFinite(g)) return;
      pose = { ...pose, y: g };
    }
    // Nothing to do for a hull standing exactly where it stood: the matrix
    // walk and the collider publish below are the frame cost, and on a
    // level where 40-odd of the 46 are parked they are nearly all waste.
    // (Measured cost unknown: a slow headless page that prompted this turned
    // out to be two Chromiums contending, not this work -- the same page ran
    // as slowly with the mode off. Kept because it is right, not because it
    // was the culprit.)
    const still = e.last && e.posed && e.group.visible === e.loaded
      && Math.abs(e.last[0] - pose.x) <= POSE_EPS
      && Math.abs(e.last[1] - pose.y) <= POSE_EPS
      && Math.abs(e.last[2] - pose.z) <= POSE_EPS
      && (!pose.q || (Math.abs(e.last[3] - pose.q[0]) <= QUAT_EPS
                      && Math.abs(e.last[4] - pose.q[1]) <= QUAT_EPS
                      && Math.abs(e.last[5] - pose.q[2]) <= QUAT_EPS
                      && Math.abs(e.last[6] - pose.q[3]) <= QUAT_EPS));
    if (still) return;
    e.group.position.set(pose.x, pose.y, pose.z);
    if (pose.q) e.group.quaternion.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]);
    e.group.updateMatrixWorld(true);
    e.posed = true;
    if (e.loaded) e.group.visible = true;
    e.last = [pose.x, pose.y, pose.z,
              pose.q?.[0] ?? 0, pose.q?.[1] ?? 0, pose.q?.[2] ?? 0, pose.q?.[3] ?? 1];
    // The first pose is the hull's baked one: it goes into the collider's
    // STATIC index, where the level's own vehicles live, and costs nothing
    // per cast. Only a hull that then moves is published as a moved owner.
    // `CollisionIndex.cast` walks every moved owner on every ray and sweep
    // and `setMovedOwner` takes the hull out of the static index, so making
    // all 46 of a level's vehicles moved owners would put the whole vehicle
    // set on that path. Reasoned from the collider, not measured: the slow
    // page that prompted the look was two headless Chromiums contending.
    // Registration needs BOTH the glb (there is nothing to bake without it)
    // and a pose (a hull baked at the origin would be a moved owner for
    // ever). Whichever arrives last does it, and bakes it where it stands.
    // Registering on the pose alone left 47 of 48 hulls with no collider
    // owner at all, because the first pose beats the glb.
    if (e.loaded && !e.registered) { register(e); return; }
    if (!e.registered) return;
    if (e.owner >= 0 && e.bakedInverse) {
      _fwd.multiplyMatrices(e.group.matrixWorld, e.bakedInverse);
      _inv.copy(_fwd).invert();
      ctx.collider?.()?.setMovedOwner?.(e.owner, _fwd.elements, _inv.elements,
        pose.x, pose.y, pose.z, e.radius);
    }
  }

  /**
   * The server's word on a hull: its hit points, and whether it is wrecked.
   * Nothing else may decide either in this mode. The page's own abandon
   * clock cannot touch these (an object registered `spawned: true` has none,
   * EMT-11 -- which is why an idling APC no longer blows up ten seconds
   * before the server's does), but a local round can still bite the Armor,
   * and this overwrites that the moment the server's row arrives: the same
   * damage-to-the-difference idiom `net-room.js` `applyObject` uses to bring
   * a static to the server's number.
   */
  function hull(id, hp, destroyed) {
    const e = entities.get(id);
    const armor = e?.damageable;
    if (!armor) return false;
    if (destroyed) {
      if (!armor.destroyed) armor.damage(armor.hitPoints + 1);
      return true;
    }
    if (!Number.isFinite(hp)) return false;
    const diff = armor.hitPoints - hp;
    if (diff > 0.05) armor.damage(diff);
    else if (diff < -0.05 && !armor.destroyed) armor.heal?.(-diff);
    return true;
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
    // The spin is cumulative per tick, so it needs the frame's own length.
    const dt = lastSync == null ? 0 : Math.min(0.25, Math.max(0, (nowMs - lastSync) / 1000));
    lastSync = nowMs;
    const driven = ctx.drivenId?.() ?? null;
    const own = ctx.ownId?.() ?? null;
    const seen = new Set();
    for (const [id, v] of client.vehicles ?? []) {
      if (!v?.template || !isHull(v) || client.playerOwned?.(id)) continue;
      // The hull this page drives is drawn by its own prediction, not here: a
      // second copy at the server's pose is the clone the owner saw drift and
      // stutter. Left out of `seen`, so the drop-loop below takes this entity
      // and its collider away while the page owns it; a fresh one returns from
      // the object table the moment the page gets out.
      if (id === driven) continue;
      seen.add(id);
      const e = ensure(id, v.template);
      // The server's live transform where it sends one; otherwise the pose
      // it created the object at. Most of a level's vehicles are parked and
      // never move, and the server sends no transform for them at all.
      const live = client.remoteVehicle?.(id, nowMs) ?? null;
      place(e, live ?? (v.spawnPos
        ? { x: v.spawnPos[0], y: v.spawnPos[1], z: v.spawnPos[2], q: v.spawnQ ?? null }
        : null));
      // Its turning parts (a tank's tower, a gun's barrel), where the server
      // ghosts them (the j rows, interpolated by `net-sidecar.js jointsAt`).
      // The replica renderer applied these, and server-authority mode stood
      // its own hulls without them: every remote turret froze at its authored
      // angle while retail players traversed (the replica loop never runs in
      // this mode, netcode-render.js `replicateVehicles`). Never the hull
      // this page controls: the server ghosts nothing about it while it is
      // ours (the rows in the table are from before boarding), and the
      // player's own traverse owns those nodes (`correctSeatAim` squares it
      // with the ack's word).
      if (e.loaded && live?.joints?.length && id !== own) {
        applyJoints(e, live.joints);
      }
      spin(e, v.revs, dt);
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
      props: e.spin?.length ?? 0,
      spin: e.spin?.map(p => +(p.revs ?? 0).toFixed(3)) ?? null,
      // The turning parts the server's j rows have posed on this hull
      // (`applyJoints` builds the node index on first use), and a tower
      // node's worn rotation, so a headless check can see a turret turn.
      jointNodes: e.jointNodes ? e.jointNodes.size : null,
      tower: (() => {
        if (!e.jointNodes) return null;
        for (const [name, node] of e.jointNodes) {
          if (/tower|turret/.test(name)) {
            return [name, ...[node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w]
              .map(v => +v.toFixed(4))];
          }
        }
        return null;
      })(),
      // Never throws: a diagnostic that dies on one bad row hides the rest.
      at: e.posed ? [e.group.position.x, e.group.position.y, e.group.position.z]
        .map(v => (Number.isFinite(v) ? +v.toFixed(1) : null)) : null,
    }));
  }

  /** The server's id for a node in one of these hulls, or null: the group
   *  itself or anything under it. `net-room.js` `netVehicleIdFor` reads the
   *  LEVEL's nodes, and in this mode the hull a player stands in is not a
   *  level node at all, so every lookup that identifies the occupied hull
   *  -- the seat bookkeeping, the hull correction, the aim drift -- needs
   *  this instead. */
  function idForNode(node) {
    for (let n = node; n; n = n.parent) {
      for (const e of entities.values()) if (e.group === n) return e.id;
    }
    return null;
  }

  return { sync, drop, hull, dispose, debug, entities, idForNode,
           entityFor: id => entities.get(id) ?? null };
}
