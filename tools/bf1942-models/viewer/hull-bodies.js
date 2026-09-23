// The scene half of the body world: every placed hull a rigid body (parked
// on its springs, or adopted as a driven one by the hull's instance), the
// ships afloat at their draft and going down when they sink, the deck spawns
// riding a carrier, the crash damage, and the bodies drawn back onto their
// nodes each tick. Lifted out of map.html (features/vehicle-instance-
// refactor Part 2); `body-world.js` and `world.js` stay the simulation.

import * as THREE from 'three';
import { BodyWorld } from './body-world.js';
import { buildParkedVehicle, describeVehicleParts } from './vehicle-bodies.js';
import { equilibriumRootY, floatNodesOf, localiseFloats, FloatingHull } from './body-float.js';
import { bodyPoseOf, bodyTerrain } from './body-pose.js';
import { DECK_STEP_UP } from './ground-contact.js';
import { spawnHoldOf } from './spawned-craft.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `bust`, `collider`, `damageTables`, `damageVisuals`,
 * `DEFAULT_SURFACE_FRICTION`, `drawsHull`, `dropEntryPoints`, `effects`, `extras`,
 * `forgetEntryPoints`, `MAPS_BASE`, `materialFrictionById`, `vehicleDamage`,
 * `vehicles`, `vehicleSpawnActive`, `world`.
 */
export function createHullBodies(page) {
  const hullBodies = {};

  /**
   * The Armor of the vehicle the player is in, or null. Matched by scene node
   * rather than by seat: hit points live on the root object and are shared by
   * every seat (VHUD-8, R2-31), so the driver and the hull gunner read the same
   * number.
   */
  // ---------------------------------------------------------------------------
  // Vehicles as rigid bodies: ram a parked plane and it moves, and both pay.
  //
  // Every placed vehicle with a mass is a body in `bodyWorld` (`body-world.js`):
  // parked ones stand on their own wheel springs, asleep until something touches
  // them; the one under the player takes part through a `DrivenBody` wrapped
  // round its drive model. The engine rules - contact finding, the mass-ratio
  // push, the friction pass, crash damage - are the framework-free modules;
  // everything here is the scene half: which node is which body, writing a
  // body's pose back onto its node, and telling the collider where a hull that
  // has been shoved now stands so that rounds and boots still meet it.
  // ---------------------------------------------------------------------------

  /** Crash events, kept only when a test asks for them (`window.__crashLog`). */
  hullBodies.crashLog = null;
  /** Start (or keep) recording crash contacts; the list, live. */
  hullBodies.recordCrashes = () => (hullBodies.crashLog ??= []);
  /** `_shared/collision-meshes.json`: every collision layer of every vehicle mesh. */
  hullBodies.collisionMeshes = null;
  hullBodies.bodyWorld = null;
  // owner -> { node, spec, spawnInverse: Matrix4, moved: boolean }
  const bodyScene = new Map();
  const _bodyMatrix = new THREE.Matrix4();
  const _bodyParentInv = new THREE.Matrix4();
  const _bodyFwd = new THREE.Matrix4();
  const _bodyInv = new THREE.Matrix4();
  const _bodyScale = new THREE.Vector3();

  async function loadCollisionMeshes(dir) {
    if (hullBodies.collisionMeshes) return hullBodies.collisionMeshes;
    const ref = page.extras?.damage;
    if (!ref?.path) return null;
    const path = ref.path.replace(/damage\.json$/, 'collision-meshes.json');
    try {
      hullBodies.collisionMeshes = await fetch(`${page.MAPS_BASE}/${dir}/${path}${page.bust()}`)
        .then(r => r.ok ? r.json() : null);
    } catch { hullBodies.collisionMeshes = null; }
    return hullBodies.collisionMeshes;
  }

  /**
   * Whether a placed vehicle becomes a simulated body.
   *
   * Ships stay out of the PARKED body world. `floatPlacedVehicles` puts every hull
   * at its closed-form draft before the collision index bakes it, so a moored ship
   * is correct *scenery* — solid, walkable, at the right waterline — and never
   * wakes. The body world's parked path is gravity plus wheel springs against the
   * heightfield (`body-ground.js`); a destroyer woken into that would sink through
   * the sea, because the float term lives in the drive model (`ship.js`) rather
   * than in `ParkedVehicle`.
   *
   * A ship a player is DRIVING is a different matter and does enter the body world
   * — see `setupVehicleBodies`, which describes her hull anyway so `adoptDriven`
   * has a spec to hand it. Runtime buoyancy for an unoccupied hull — ram a moored
   * Fletcher and watch her rock — is the piece this still leaves open.
   */
  function bodySpecFor(node) {
    if (isSeaHull(node)) return null;
    return describeVehicleParts(node, hullBodies.collisionMeshes);
  }

  /** A floating hull: the one vehicle category that stays out of the parked body
   *  world and enters the driven one instead. */
  function isSeaHull(node) {
    return node?.userData?.physics?.vehicleCategory === 'VCSea';
  }

  /**
   * The contact friction scalar for the sea bed under (x, z).
   *
   * `impulseOn` (`0x08258900`) writes `A = 0.5*(friction(matA) + friction(matB))`,
   * the mean of the two surfaces' `MaterialManager.materialFriction` (physics.md
   * §10). The hull's own material is the table's default 1.0; the bottom's is the
   * heightfield's own, read RAW rather than through `surfaceFriction`, which
   * answers water's 0.1 for anything under the sea line and would let a beached
   * destroyer slide off a sandbank.
   */
  /** Scratch for the ship's sea-bed normal query; the heightfield writes a plain
   *  array, `Ship` wants a THREE.Vector3. */
  const _shipNormal = [0, 1, 0];

  function seabedFriction(x, z) {
    const table = page.materialFrictionById;
    const id = page.collider?.heightfield?.material(x, z);
    const bottom = table && Number.isInteger(id) && id >= 0 && id < table.length
      ? table[id] : page.DEFAULT_SURFACE_FRICTION;
    return 0.5 * (page.DEFAULT_SURFACE_FRICTION + bottom);
  }

  /**
   * Put every floating hull at its own draft, before anything is indexed.
   *
   * The engine does this by simulating: a ship is born awake at the spawner's
   * authored pose and its `FloatingBundle`s settle it, which on Midway means
   * lifting a Yamato 4.72 m and dropping a Hatsuzuki 6.08 m from pads the level
   * author placed at the *other* fleet's draft. Doing it by simulation here
   * would cost thousands of ticks — the law is overdamped by a factor of about
   * 15, so a Fletcher's slow pole is 0.036 per second and 300 ticks leaves it
   * 0.147 m high — so the draft is solved in closed form instead
   * (`body-float.js` `equilibriumRootY`, the root of `sum (-f)*lift = 9.82`).
   * It is exact, it is free, and it is the same fixed point the settle would
   * crawl to.
   *
   * Only `y` moves. The force is world-vertical and every vanilla hull hangs its
   * eight float nodes at one height, so there is no couple to find: pitch and
   * roll righting only has anything to do when the nodes sit at different depths,
   * which off a level's own pad they never do.
   *
   * A hull whose float nodes cannot carry it gets `null` and is left where it was
   * authored rather than dropped through the sea bed.
   */
  /**
   * A burning ship stops being a spawn point.
   *
   * `BFSpawnPoint::getActive(bool, int)` (`0x08163dd0`) walks the chain to the
   * nearest `IID_IArmor` (`0xc4a4`) and returns 0 when it reports
   * `isCriticalDamaged()` (Armor vtable `+0xcc`, `0x08174320`) — the same
   * threshold that arms the sink, so the moment a destroyer starts going down it
   * stops offering her decks. Answered per hull here because the world's flag
   * list is built once at load and the state is live.
   */
  function shipFlagInactive(flag) {
    if (!flag?.vehicle || !flag.position) return false;
    for (const host of floatHosts) {
      if (host.sinking) {
        const p = host.sinking.body.pos;
        if (Math.hypot(flag.position[0] - p[0], flag.position[2] - p[2])
            <= host.radius + 40) return true;
        continue;
      }
      // The hull where she is NOW, not where she was authored: a flag whose rings
      // have been rebased onto a carrier under way has to be matched against the
      // carrier under way.
      host.node.updateWorldMatrix(true, false);
      const e = host.node.matrixWorld.elements;
      const d = Math.hypot(flag.position[0] - e[12], flag.position[2] - e[14]);
      if (d > host.radius + 40) continue;
      const owner = page.collider?.statics?.ownerOf?.(host.node) ?? -1;
      return !!(owner >= 0 && page.vehicleDamage?.get(owner)?.critical);
    }
    return false;
  }

  function floatPlacedVehicles(ownerRoots, waterLevel) {
    floatHosts.length = 0;
    heldCraft.length = 0;
    for (const node of ownerRoots) {
      const hold = spawnHoldOf(node);
      if (hold) heldCraft.push({ node, host: hold.host, local: hold.local, released: false, hostAt: null });
    }
    if (!Number.isFinite(waterLevel)) { pinHeldCraft(); return; }
    for (const node of ownerRoots) {
      if (node?.userData?.physics?.vehicleCategory !== 'VCSea') continue;
      const floats = floatNodesOf(node);
      if (!floats.length) continue;
      node.updateWorldMatrix(true, false);
      const authored = node.matrixWorld.elements;
      const host = {
        node,
        // The pose the extractor baked the deck spawns against — this one, right
        // now, before the hull moves. See `rebaseDeckSpawns`.
        authored: [authored[12], authored[13], authored[14]],
        authoredInverse: node.matrixWorld.clone().invert(),
        radius: 0,
      };
      for (const float of floats) {
        host.radius = Math.max(host.radius,
          Math.hypot(float.offsetX, float.offsetZ));
      }
      floatHosts.push(host);
      const y = equilibriumRootY(floats, waterLevel);
      if (!Number.isFinite(y)) continue;
      node.position.y += y - authored[13];
      node.updateMatrix();
      node.updateMatrixWorld(true);
    }
    // The deck aircraft go with their ships, before the index bakes them.
    pinHeldCraft();
  }

  /**
   * Put one hull back at her closed-form draft, and stop her sinking.
   *
   * The respawn path's half of `floatPlacedVehicles`: an ObjectSpawner replaces
   * the object at its authored pose and the level's pad is not her draft, so the
   * same `equilibriumRootY` has to run again.
   */
  function refloatHull(node) {
    const waterLevel = page.collider?.waterLevel ?? page.extras?.waterLevel;
    if (!Number.isFinite(waterLevel)) return;
    const floats = floatNodesOf(node);
    if (!floats.length) return;
    node.updateWorldMatrix(true, false);
    const y = equilibriumRootY(floats, waterLevel);
    if (Number.isFinite(y)) {
      node.position.y += y - node.matrixWorld.elements[13];
      node.updateMatrix();
      THREE.Object3D.prototype.updateMatrixWorld.call(node, true);
    }
    const host = floatHosts.find(h => h.node === node);
    if (host) host.sinking = null;
  }

  /** Placed floating hulls, with the pose their deck spawns were baked against. */
  const floatHosts = [];
  const _deckPoint = new THREE.Vector3();

  // ---------------------------------------------------------------------------
  // A carrier's deck aircraft (Brief Q).
  //
  // The engine spawns a ship's aircraft as objects of their own
  // (`spawned-craft.js`), and every vanilla ship spawner sets
  // `holdObject 1`. `ObjectSpawner::handleFrameUpdate` 0x083138c0, while the
  // spawner's hold flag (+0x164) is set, each frame:
  //
  //   - drops the hold when the spawned object's Armor (IID 0xc4a4) reports
  //     destroyed (vt+0xc8, the test the slot sweep above it uses too);
  //   - finds the object's engine (`getEngineFromChildsAndSiblings`, as IID
  //     0xc422, the physics node) and drops the hold when its +0xa0 (the revs
  //     `Engine::handleUpdate` 0x0823e120 writes and the thrust law reads) is
  //     0.1 or more: `fabs; fucompp` against 0x86b1ca0 (0.1) at 0x08313ed5,
  //     the hold kept only on `0.1 > |revs|`; an object with no engine is let
  //     go at once;
  //   - otherwise holds it: the object's physics node is `reset()` (vt+0xc8,
  //     0x08252d10) and given the ship's own velocity at the object's position
  //     (the spawner's root node's `getTangentSpeed` vt+0x74, 0x08254b90, into
  //     `setPositionalSpeed` vt+0x40, 0x0824d1f0), and the object is put at
  //     the spawner's absolute transformation plus its `spawnOffset`
  //     (`setAbsoluteTransformation` vt+0x44).
  //
  // On the frame the hold drops, the object gets `setSleepiness(0)` (vt+0xd8,
  // 0x0824d4c0) and the ship's velocity at its position once more, and from
  // then on it is a body like any other. So a parked Corsair rides the
  // Enterprise exactly, whoever drives her, and a pilot's plane stays on its
  // pad until his throttle is up; the hold is never taken again (only
  // `spawnObject` sets it, from the template).
  //
  // The viewer's `state.throttle` spools like the engine's revs
  // (`Aircraft.step`, `throttleRate`), and stands in for +0xa0. The two
  // calls `handleFrameUpdate` also makes on a live hold (child vt+0x8c, and
  // the object's +0x102 from the root's vt+0x74) are not ported: not read.
  // ---------------------------------------------------------------------------

  /** `|revs|` at which the spawner lets its object go (0x86b1ca0). */
  const HOLD_RELEASE_THROTTLE = 0.1;

  /** Deck aircraft held by their ship's spawner: `{ node, host, local,
   *  released, hostAt }`, rebuilt by `floatPlacedVehicles` each level. */
  const heldCraft = [];
  const _holdMatrix = new THREE.Matrix4();
  const _holdPos = new THREE.Vector3();
  const _holdQuat = new THREE.Quaternion();
  const _holdScale = new THREE.Vector3();
  const _holdVel = [0, 0, 0];
  const _holdAt = [0, 0, 0];

  /** The pose a held craft's spawner puts it at: its ship's live matrix
   *  times its baked pose on her. */
  function holdMatrix(rec) {
    rec.host.updateWorldMatrix(true, false);
    return _holdMatrix.multiplyMatrices(rec.host.matrixWorld, rec.local);
  }

  /** A world matrix onto a node (which may be frozen). */
  function setNodeWorld(node, m) {
    if (node.parent) {
      node.parent.updateWorldMatrix(true, false);
      _bodyParentInv.copy(node.parent.matrixWorld).invert();
      _bodyFwd.multiplyMatrices(_bodyParentInv, m);
    } else {
      _bodyFwd.copy(m);
    }
    _bodyFwd.decompose(node.position, node.quaternion, _bodyScale);
    node.updateMatrix();
    THREE.Object3D.prototype.updateMatrixWorld.call(node, true);
  }

  /** Every held craft onto its spawner's pose, the node only: the load's
   *  half, run after the ships are floated and before the index bakes them. */
  function pinHeldCraft() {
    for (const rec of heldCraft) {
      if (rec.released) continue;
      setNodeWorld(rec.node, holdMatrix(rec));
      rec.hostAt = rec.host.matrixWorld.clone();
    }
  }

  /** The level's owner id of `node`, cached per index (`ownerOf` walks the
   *  owner list). */
  function cachedOwner(rec, node) {
    const statics = page.collider?.statics;
    if (!statics) return -1;
    if (rec.ownerStatics !== statics) {
      rec.ownerStatics = statics;
      rec.owner = statics.ownerOf?.(node) ?? -1;
    }
    return rec.owner;
  }

  /**
   * The ship's velocity at world point `p`, into `out`: `getTangentSpeed`,
   * v + w x (p - c), from her drive when someone drives her, her sinking body
   * when she is going down, else zero (a moored ship does not move).
   */
  function hostPointVelocity(hostNode, p, out) {
    out[0] = 0; out[1] = 0; out[2] = 0;
    let v = null, w = null, c = null;
    const sinking = floatHosts.find(h => h.node === hostNode)?.sinking;
    if (sinking) {
      v = sinking.body.v; w = sinking.body.w; c = sinking.body.pos;
    } else {
      const s = page.vehicles?.instanceOf?.(hostNode)?.drive?.state;
      if (!s?.velocity) return out;
      v = [s.velocity.x, s.velocity.y, s.velocity.z];
      const av = s.angularVelocity;
      w = av ? [av.x, av.y, av.z] : [0, 0, 0];
      c = [s.position.x, s.position.y, s.position.z];
    }
    const rx = p[0] - c[0], ry = p[1] - c[1], rz = p[2] - c[2];
    out[0] = v[0] + w[1] * rz - w[2] * ry;
    out[1] = v[1] + w[2] * rx - w[0] * rz;
    out[2] = v[2] + w[0] * ry - w[1] * rx;
    return out;
  }

  /**
   * The spawners' hold, once a tick (`stepSinkingHulls`): each held craft is
   * put back on its pad on its ship, with the ship's velocity there, until
   * its pilot's throttle reaches 0.1 or it is destroyed. A parked craft is
   * only rewritten when its ship has moved or its body is awake; a driven
   * one every tick, as its drive has just integrated.
   */
  function holdSpawnedCraft() {
    for (const rec of heldCraft) {
      if (rec.released) continue;
      const owner = cachedOwner(rec, rec.node);
      const visual = owner >= 0 ? page.damageVisuals?.get(owner) : null;
      if (page.vehicleDamage?.get(owner)?.destroyed || visual?.wrecked || visual?.removed) {
        rec.released = true;
        continue;
      }
      const drive = page.vehicles?.instanceOf?.(rec.node)?.drive ?? null;
      const m = holdMatrix(rec);
      m.decompose(_holdPos, _holdQuat, _holdScale);
      _holdAt[0] = _holdPos.x; _holdAt[1] = _holdPos.y; _holdAt[2] = _holdPos.z;
      hostPointVelocity(rec.host, _holdAt, _holdVel);
      const scene = owner >= 0 ? bodyScene.get(owner) : null;
      if (drive?.state) {
        const s = drive.state;
        if (Math.abs(s.throttle ?? 0) >= HOLD_RELEASE_THROTTLE) {
          // Let go, with the ship's velocity where the craft stands.
          rec.released = true;
          s.velocity.set(_holdVel[0], _holdVel[1], _holdVel[2]);
          continue;
        }
        s.position.copy(_holdPos);
        s.orientation.copy(_holdQuat);
        s.velocity.set(_holdVel[0], _holdVel[1], _holdVel[2]);
        s.angularVelocity?.set(0, 0, 0);
        if (!page.drawsHull?.(drive)) drive.applyTransform?.();
        if (scene) publishMovedHull(owner, scene, rec.node, _holdAt);
        rec.hostAt = (rec.hostAt ?? new THREE.Matrix4()).copy(rec.host.matrixWorld);
        continue;
      }
      const body = hullBodies.bodyWorld?.get(owner)?.parked?.body ?? null;
      const hostMoved = !rec.hostAt || !rec.hostAt.equals(rec.host.matrixWorld);
      if (!hostMoved && (!body || body.sleeping)) continue;
      rec.hostAt = (rec.hostAt ?? new THREE.Matrix4()).copy(rec.host.matrixWorld);
      if (body) {
        const e = m.elements;
        body.pos[0] = e[12]; body.pos[1] = e[13]; body.pos[2] = e[14];
        body.axes[0][0] = e[0]; body.axes[0][1] = e[1]; body.axes[0][2] = e[2];
        body.axes[1][0] = e[4]; body.axes[1][1] = e[5]; body.axes[1][2] = e[6];
        body.axes[2][0] = e[8]; body.axes[2][1] = e[9]; body.axes[2][2] = e[10];
        body.v[0] = _holdVel[0]; body.v[1] = _holdVel[1]; body.v[2] = _holdVel[2];
        body.w[0] = 0; body.w[1] = 0; body.w[2] = 0;
      }
      setNodeWorld(rec.node, m);
      if (scene) {
        publishMovedHull(owner, scene, rec.node, _holdAt);
        scene.moved = true;
      }
      page.forgetEntryPoints?.();
    }
  }

  /** How far under its query height a ship's deck is looked for. */
  const SHIP_DECK_REACH = 6;
  /** A deck face is no steeper than this (`ground-contact.js DECK_FLOOR_COS`). */
  const SHIP_DECK_FLOOR_COS = 0.5;
  const _shipRay = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, dx: 0, dy: -1, dz: 0,
                     material: 0, kind: '', owner: -1, triangle: -1 };
  const shipDeck = { y: -Infinity, nx: 0, ny: 1, nz: 0, material: 0, owner: -1 };

  /**
   * The top of a ship's own hull under (x, z), at or below `fromY` and at
   * most `reach` under it, or null: `{ y, nx, ny, nz, material, owner }`,
   * valid until the next call. Asked of each floating hull whose footprint
   * (x, z) is in, against that owner's triangles alone, in her baked frame
   * once she has been driven off it (`WorldCollider.setMovedOwner`).
   *
   * What a deck aircraft stands and rolls on once its spawner has let it go.
   * In the engine that is its wheels' contact with the ship's faces
   * (`ResponsePhysics::checkObjectVsObject` 0x08259690, the smaller body
   * the vertex side); the viewer's aircraft drive and parked bodies meet the
   * ground through a height function, so the ship's hull top is handed to
   * them as one, as a bridge deck is (`WorldCollider.deckHeight`), which
   * only knows the level's drivable statics and never a moved hull.
   */
  function shipDeckAt(x, z, fromY, reach = SHIP_DECK_REACH, skipOwner = -1) {
    shipDeck.y = -Infinity;
    const collider = page.collider;
    const statics = collider?.statics;
    if (!statics || !floatHosts.length || !Number.isFinite(fromY)) return null;
    for (const host of floatHosts) {
      const e = host.node.matrixWorld.elements;
      const dx = x - e[12], dz = z - e[14];
      const r = host.radius + 40;
      if (dx * dx + dz * dz > r * r) continue;
      const owner = cachedOwner(host, host.node);
      if (owner < 0 || owner === skipOwner) continue;
      const moved = collider.moved?.get(owner);
      let hit;
      if (moved) {
        const m = moved.inv;
        _shipRay.dx = -m[4]; _shipRay.dy = -m[5]; _shipRay.dz = -m[6];
        hit = statics.cast(
          m[0] * x + m[4] * fromY + m[8] * z + m[12],
          m[1] * x + m[5] * fromY + m[9] * z + m[13],
          m[2] * x + m[6] * fromY + m[10] * z + m[14],
          _shipRay.dx, _shipRay.dy, _shipRay.dz, reach, -1, _shipRay, owner);
      } else {
        _shipRay.dx = 0; _shipRay.dy = -1; _shipRay.dz = 0;
        hit = statics.cast(x, fromY, z, 0, -1, 0, reach, -1, _shipRay, owner);
      }
      if (!hit) continue;
      let nx = hit.nx, ny = hit.ny, nz = hit.nz;
      if (moved) {
        const f = moved.fwd;
        const wx = f[0] * nx + f[4] * ny + f[8] * nz;
        const wy = f[1] * nx + f[5] * ny + f[9] * nz;
        const wz = f[2] * nx + f[6] * ny + f[10] * nz;
        nx = wx; ny = wy; nz = wz;
      }
      if (ny < SHIP_DECK_FLOOR_COS) continue;
      const y = fromY - hit.t;
      if (y <= shipDeck.y) continue;
      shipDeck.y = y;
      shipDeck.nx = nx; shipDeck.ny = ny; shipDeck.nz = nz;
      shipDeck.material = hit.material;
      shipDeck.owner = owner;
    }
    return shipDeck.y > -Infinity ? shipDeck : null;
  }

  /**
   * A ship that has taken critical damage is going down.
   *
   * `FloatingBundle::handleMessage` (`0x082402b0`) arms the per-node sink rate on
   * TemplateMessage **`0x14`** — `criticalDamage`, the same threshold that stops
   * a ship being a spawn point (`BFSpawnPoint::getActive` `0x08163dd0` step 2) —
   * not on death. For a Fletcher that is 50 of its 300 hit points.
   *
   * The body world does not carry ships (see `bodySpecFor`), so a hull that
   * starts sinking gets its own `FloatingHull` (`body-float.js`): a `RigidBody`
   * with the float law posted at each node, which is precisely what the engine
   * runs. Each node's rate is its own, so the offsets diverge and she goes down
   * by one end; on a capital ship the spread is about 2:1, and the vanilla hull
   * that actually rolls over is the LCVP.
   *
   * The deck spawns follow, because `rebaseDeckSpawns` resolves them through the
   * hull's live matrix: a burning destroyer carries her spawn points down with
   * her, which is the engine's own arrangement and the reason the critical gate
   * exists at all.
   */
  function armSinkingHull(host) {
    if (host.sinking) return host.sinking;
    const floats = floatNodesOf(host.node);
    if (!floats.length) return null;
    host.node.updateWorldMatrix(true, false);
    const e = host.node.matrixWorld.elements;
    const axes = [[e[0], e[1], e[2]], [e[4], e[5], e[6]], [e[8], e[9], e[10]]];
    const spec = host.node.userData?.physics || {};
    const box = new THREE.Box3().setFromObject(host.node);
    const size = box.getSize(new THREE.Vector3());
    let radius = 0;
    for (const float of floats) {
      radius = Math.max(radius, Math.hypot(float.offsetX, float.offsetY, float.offsetZ));
    }
    host.sinking = new FloatingHull({
      floats: localiseFloats(floats, axes),
      mass: spec.mass || 1, drag: spec.drag || 0,
      box: [size.x, size.y, size.z],
      inertiaModifier: spec.inertiaModifier || [1, 1, 1],
      waterLevel: page.collider?.waterLevel ?? page.extras?.waterLevel ?? 0,
      boundingRadius: radius,
      position: [e[12], e[13], e[14]], axes,
    });
    host.sinking.arm();
    return host.sinking;
  }

  function stepSinkingHulls(step) {
    if (!floatHosts.length) { if (heldCraft.length) holdSpawnedCraft(); return; }
    // A driven hull moves whether or not the body world ticked — a level with no
    // collision meshes has no body world at all — so the rebase is not gated on
    // `bodyTicks`; only the sinking integration is.
    const ticks = step?.bodyTicks ?? 0;
    let stirred = false;
    for (const host of floatHosts) {
      if (!host.sinking) {
        // A driven hull is its drive model's, not this pass's — but it is
        // still a hull that has moved, so its deck points still owe a rebase.
        if (page.vehicles.instanceOf(host.node)?.drive) { stirred = true; continue; }
        const owner = page.collider?.statics?.ownerOf?.(host.node) ?? -1;
        const record = owner >= 0 ? page.vehicleDamage?.get(owner) : null;
        if (!record?.critical) continue;
        if (!ticks || !armSinkingHull(host)) continue;
      }
      for (let tick = 0; tick < ticks; tick++) host.sinking.step();
      const body = host.sinking.body;
      writeBodyPose(host.node, body);
      stirred = true;
    }
    // The deck spawns ride whichever hull moved: the same live re-resolution the
    // level load does, re-evaluated now. Once per tick rather than once per hull —
    // `rebaseDeckSpawns` walks every point on the level, so calling it inside the
    // loop did the work once per ship for no gain.
    //
    // This is what makes the minimap's rings follow a carrier under way: a ship
    // flag's `groups[].position` IS the spawn's own array (soldier.js
    // `spawnFlags`), so `drawSpawnRings` draws wherever this put them, and the
    // owner watching the map sees the spots move with the hull exactly as the
    // game does.
    if (stirred) rebaseDeckSpawns();
    // ... and the spawners' hold puts each deck aircraft back on its pad on
    // whichever ship has moved (`holdSpawnedCraft`).
    if (heldCraft.length) holdSpawnedCraft();
  }

  /**
   * Move every deck spawn with the hull it belongs to.
   *
   * `BFSpawnPoint::spawn` (`0x08163d70`) is one line —
   * `soldier->setAbsolutePosition(this->getAbsolutePosition())` — and a
   * `SpawnPoint` is an ordinary composite child of the ship, so in the engine a
   * deck spawn is *never* a world position: it is a ship-local offset through the
   * hull's live transform at the moment of the spawn. `extract_map.py` bakes the
   * world position it has at the authored pad, which is right until something
   * moves the hull — and `floatPlacedVehicles`, one line above, has just moved
   * every one of them by up to 6 m.
   *
   * So each baked point is carried through `hull.matrixWorld * authoredInverse`,
   * which is exactly the offset-and-re-resolve the engine does, recovered from
   * the bake rather than from a re-extract: the inverse of the pose it was baked
   * against turns a world point back into the ship-local offset, and the hull's
   * current matrix puts it back. It costs no extractor change and it is right for
   * pitch and roll as well as heave.
   *
   * Rewriting `extras` in place rather than resolving lazily keeps the deploy
   * screen's rings, `spawn-safety.js`'s walk and the spawn itself reading one
   * number — and because a ship flag's `groups[].position` IS the spawn's own
   * array (`soldier.js` `spawnFlags`), moving these moves the minimap's rings for
   * free.
   *
   * Called at load, once per tick for any hull that has moved
   * (`stepSinkingHulls`), and again at the top of `spawnAtFlag` so the spawn
   * itself reads the hull's pose at the instant of the spawn, which is what
   * `BFSpawnPoint::spawn` does.
   */
  function rebaseDeckSpawns() {
    const spawns = page.extras?.vehicleSoldierSpawns;
    if (!spawns?.length || !floatHosts.length) return;
    for (const spawn of spawns) {
      if (!spawn.position) continue;
      // Idempotent: the bake, kept, so a second index pass on the same `extras`
      // rebases from the authored point rather than from its own output.
      spawn.deckBake ??= spawn.position.slice();
      const [x, , z] = spawn.deckBake;
      let host = null, best = Infinity;
      for (const candidate of floatHosts) {
        const d = Math.hypot(x - candidate.authored[0], z - candidate.authored[2]);
        // Inside the hull's own float-node footprint, generously: a deck point is
        // on the ship it was authored on, and the fleet's pads are hundreds of
        // metres apart.
        if (d < best && d <= candidate.radius + 40) { best = d; host = candidate; }
      }
      if (!host) continue;
      _deckPoint.set(x, spawn.deckBake[1], z)
        .applyMatrix4(host.authoredInverse).applyMatrix4(host.node.matrixWorld);
      // In place, not a fresh array: `new World(...)` has already run
      // `spawnFlags(extras)`, and a flag's own `position` (the ring the deploy
      // map draws) is a reference to THIS array.
      spawn.position[0] = +_deckPoint.x.toFixed(3);
      spawn.position[1] = +_deckPoint.y.toFixed(3);
      spawn.position[2] = +_deckPoint.z.toFixed(3);
    }
  }

  /** Longest a spawned vehicle is given to come to rest: ten seconds of ticks. */
  const SETTLE_TICKS = 300;

  /**
   * Let every placed vehicle drop onto its springs, before anything is indexed.
   *
   * An ObjectSpawner sits a little above the ground - a Willy's wheels hang
   * 0.2 m clear at its authored pose - and the engine's vehicles are born awake:
   * they fall, settle on their springs and go to sleep about three seconds
   * later. Doing the same here, once, at load, puts each one where the game
   * would have it, a third of a metre lower, so the collision index bakes the
   * hull where it rests and a first touch does not make a parked plane drop.
   * No damage is counted: wheels are what land, and wheels cost nothing.
   */
  function settlePlacedVehicles(ownerRoots, heightfield) {
    if (!hullBodies.collisionMeshes || !page.damageTables || !heightfield) return;
    const world = new BodyWorld({
      tables: page.damageTables, terrain: bodyTerrain(heightfield, page.extras?.waterLevel) });
    const settling = [];
    ownerRoots.forEach((node, index) => {
      // A deck aircraft is held at its spawner's pose, not dropped onto the
      // heightfield under its ship (`holdSpawnedCraft`).
      if (spawnHoldOf(node)) return;
      const spec = node?.userData?.armor ? bodySpecFor(node) : null;
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

  /** The body world's ground: the heightfield, plus the level's drivable
   *  decks once the collider exists (`body-pose.js bodyTerrain`). */
  function groundFor(heightfield, waterLevel) {
    return withShipDecks(bodyTerrain(heightfield, waterLevel, page.collider ?? null, DECK_STEP_UP));
  }

  /**
   * A body terrain that also stands a vertex on a ship's hull top
   * (`shipDeckAt`), asked from `DECK_STEP_UP` above the vertex as a bridge
   * deck is: a deck aircraft its spawner has let go and whose pilot left it
   * on the deck. Only when the caller passes the vertex's height and a
   * ship's footprint is under it; everything else is the terrain as before.
   */
  function withShipDecks(ground) {
    const deckAt = (x, z, y) => {
      if (!Number.isFinite(y) || !floatHosts.length) return null;
      const d = shipDeckAt(x, z, y + DECK_STEP_UP, DECK_STEP_UP + SHIP_DECK_BODY_REACH);
      return d && d.y > ground.height(x, z, y) ? d : null;
    };
    return {
      ...ground,
      height: (x, z, y) => deckAt(x, z, y)?.y ?? ground.height(x, z, y),
      normal: (x, z, out, y) => {
        const d = deckAt(x, z, y);
        if (!d) return ground.normal(x, z, out, y);
        out[0] = d.nx; out[1] = d.ny; out[2] = d.nz;
        return out;
      },
      material: (x, z, y) => deckAt(x, z, y)?.material ?? ground.material(x, z, y),
    };
  }

  /** How far under a body vertex its ship deck is still found. */
  const SHIP_DECK_BODY_REACH = 1.5;

  /** Does a drivable deck lie under the hull's footprint? The pose's origin and
   *  eight points on a ring of its bounding radius (at most 4 m), each asked
   *  from 2 m above the origin. */
  function overDeck(position, radius) {
    const collider = page.collider;
    if (!collider?.deckSurface || !collider.drivableMask) return false;
    const [x, y, z] = position;
    const r = Math.min(Number.isFinite(radius) ? radius : 3, 4);
    if (collider.deckSurface(x, z, y + 2)) return true;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      if (collider.deckSurface(x + Math.cos(a) * r, z + Math.sin(a) * r, y + 2)) return true;
    }
    return false;
  }

  /**
   * Settle the parked hulls that stand over a drivable deck again, now that the
   * collider knows its decks. `settlePlacedVehicles` runs before the collision
   * index exists (the index bakes each hull where it rests), so it settles on
   * the heightfield alone and sinks a hull placed on a tank pad or a bay apron
   * into it. The drive the hull is given on boarding rides the deck
   * (`surfaceHeight(x, z, axle + DECK_STEP_UP)`), so boarding lifted it: El
   * Alamein's Sherman_1 from 60.85 to 61.49 through a 2 m bounce (Brief F item
   * 2). The engine has one body standing on the pad throughout; here the parked
   * body is settled on the deck the drive will see, and the collider is told the
   * hull moved (`setMovedOwner`), as for any parked body that moves.
   *
   * `owners` are body-scene owners; returns the owners it moved.
   */
  function settleOnDecks(owners) {
    const heightfield = page.collider?.heightfield;
    if (!heightfield || !page.damageTables || !page.collider?.drivableMask) return [];
    const world = new BodyWorld({
      tables: page.damageTables, terrain: groundFor(heightfield, page.collider.waterLevel) });
    const settling = [];
    for (const owner of owners) {
      const scene = bodyScene.get(owner);
      if (!scene || scene.sea) continue;
      const pose = bodyPoseOf(scene.node);
      if (!overDeck(pose.position, scene.spec.boundingRadius)) continue;
      const parked = buildParkedVehicle(scene.spec, { ...pose, asleep: false });
      world.addParked(owner, parked, scene.spec);
      settling.push({ owner, scene, body: parked.body });
    }
    if (!settling.length) return [];
    for (let tick = 0; tick < SETTLE_TICKS; tick++) {
      world.tick();
      if (tick > 30 && settling.every(s => s.body.sleeping)) break;
    }
    for (const { owner, scene, body } of settling) {
      writeBodyPose(scene.node, body);
      publishMovedHull(owner, scene, scene.node, body.pos);
      scene.moved = true;
    }
    return settling.map(s => s.owner);
  }

  /** Rebuild the body world for the level `buildCollider` just indexed. */
  function setupVehicleBodies() {
    bodyScene.clear();
    hullBodies.bodyWorld = null;
    const heightfield = page.collider?.heightfield;
    if (!hullBodies.collisionMeshes || !page.damageTables || !heightfield) return;
    // The world owns the BodyWorld and its crash-damage accounting; this page
    // half keeps the scene records and feeds each parked hull in.
    // `statics` is what turns a building from a wall into a contact: a driven
    // hull probes its own collision vertices against the level's triangles and
    // the same solver that shoves a parked plane pushes and spins it
    // (`body-statics.js`). Without a `drivableMask` the deck gate inside it has
    // nothing to gate, which is exactly right for a level with no bridge.
    page.world?.setupBodies({ tables: page.damageTables,
                         terrain: groundFor(heightfield, page.collider.waterLevel),
                         statics: page.collider.statics ? page.collider.staticProbe() : null });
    hullBodies.bodyWorld = page.world?.bodyWorld ?? null;
    const parkedOwners = [];
    for (const [owner, visual] of page.damageVisuals) {
      // A ship gets a scene record and a collision spec but no PARKED body: her
      // hull is described so that the moment a player takes the helm she can enter
      // the body world as a DRIVEN one and probe the level's piers and islands
      // through `body-statics.js`, which is the machinery W6-C built and left
      // unwired for want of buoyancy. Moored, she stays what `bodySpecFor` says
      // she is — scenery — because the parked path is gravity plus wheel springs
      // and would sink her.
      const sea = isSeaHull(visual.node);
      const spec = sea ? describeVehicleParts(visual.node, hullBodies.collisionMeshes)
                       : bodySpecFor(visual.node);
      if (!spec) continue;
      visual.node.updateWorldMatrix(true, false);
      bodyScene.set(owner, {
        node: visual.node, spec, sea, moved: false, spawnActive: true,
        spawnInverse: visual.node.matrixWorld.clone().invert(),
      });
      if (sea) continue;
      page.collider.statics?.setBodyOwner?.(owner, true);
      parkedOwners.push(owner);
    }
    // A hull placed on a deck stands on it before it becomes a body.
    settleOnDecks(parkedOwners);
    for (const owner of parkedOwners) {
      const scene = bodyScene.get(owner);
      page.world?.addParkedBody(owner, scene.spec, bodyPoseOf(scene.node));
    }
    syncVehicleSpawnOwnership();
  }

  /** Neutral capture zones have no live parked hulls until their flag changes. */
  function syncVehicleSpawnOwnership() {
    for (const [owner, visual] of page.damageVisuals) {
      const scene = bodyScene.get(owner);
      if (!scene || scene.sea) continue;
      const active = page.vehicleSpawnActive(scene.node);
      if (scene.spawnActive === active) continue;
      scene.spawnActive = active;
      page.dropEntryPoints();
      if (active) {
        page.collider.statics?.enableOwner?.(owner);
        page.collider.statics?.setBodyOwner?.(owner, true);
        page.world?.addParkedBody(owner, scene.spec, bodyPoseOf(scene.node));
      } else {
        page.world?.removeBody(owner);
        page.collider.statics?.disableOwner?.(owner);
        page.collider.statics?.setBodyOwner?.(owner, false);
        scene.node.visible = false;
      }
    }
  }

  /**
   * The collider a driven vehicle sweeps its hull against: everything the real
   * one holds except other simulated bodies, which the contact solver owns. A
   * swept sphere can only stop dead; the solver pushes, spins and damages.
   */
  function bodyAwareCollider() {
    if (!page.collider || !hullBodies.bodyWorld) return page.collider;
    const world = page.collider;
    return Object.create(world, {
      sweepSphere: {
        // The drivable-deck gate is forwarded, not swallowed: this wrapper IS the
        // collider a driven vehicle is handed, so dropping the last two arguments
        // would leave a tank welded to every bridge deck it touched.
        // `skipBodies` stays true whatever the caller says — that is this
        // wrapper's whole job — but the gate is passed straight through.
        value: (ox, oy, oz, dx, dy, dz, maxDist, radius, skipOwner = -1,
                _skipBodies = true, deckStepTop = -Infinity, deckFloorCos = 2) =>
          world.sweepSphere(ox, oy, oz, dx, dy, dz, maxDist, radius, skipOwner,
                            true, deckStepTop, deckFloorCos),
      },
    });
  }

  /** A crash cost `owner` hit points. Called by the world's BodyWorld callback
   *  BEFORE the damage lands (world.js #onBodyDamage), so the console record
   *  reads the same pre-damage hit points it always did; the world applies the
   *  damage itself right after — this half is the presentation: the record a
   *  `window.__crashLog` check wants and the effect bundle where the impact
   *  was. The destroyed guard is the old skip: a wreck has already died, so the
   *  impact stays silent. */
  function onCrashDamage(owner, result, at, other) {
    const vehicle = page.vehicleDamage.get(owner);
    if (hullBodies.crashLog) {
      hullBodies.crashLog.push({ tick: hullBodies.bodyWorld.ticks, owner, other, damage: result.damage,
        kill: result.kill, cell: result.effectCell, hp: vehicle?.hitPoints ?? null });
      if (hullBodies.crashLog.length > 200) hullBodies.crashLog.shift();
    }
    const effect = result.effectCell
      ? page.damageTables?.effects?.[result.effectCell[0]]?.[result.effectCell[1]] : null;
    if (effect) page.effects.play(effect, { position: [at[0], at[1], at[2]], normal: [0, 1, 0] });
    if (!vehicle) return;
  }

  /**
   * How far the hull's own col0 collision VERTICES reach below its origin, in the
   * hull's frame — the same set `BodyWorld.#drivenTerrainDamage` bills and the same
   * set `checkVsTerrain` (`0x0825a960`) drops on the heightfield.
   *
   * `Ship.keel` is the collision BOX's bottom, and on a level whose drawn tree
   * carries no hull collision node it is the drawn geometry box's bottom (ships
   * README §15). A Gato's col0 vertices reach 1.06 m below that box, so a hull
   * grounded on the box would report herself clear of a reef while the damage pass
   * still had a vertex inside it — the one hull on Midway that kept dying after the
   * footprint grounding went in. Handing `Ship` this number makes the two agree.
   */
  function hullCollisionKeel(spec) {
    let lowest = Infinity;
    for (const desc of spec?.parts || []) {
      if (desc.kind !== 'body') continue;
      const layer = desc.shape?.layers?.[0];
      const v = layer?.vertices;
      if (!v) continue;
      const rot = desc.rot;
      for (let i = 0; i < v.length; i += 3) {
        // Part-local -> body frame, `body-contact.js`'s own row convention.
        const y = desc.offset[1]
          + v[i] * rot[0][1] + v[i + 1] * rot[1][1] + v[i + 2] * rot[2][1];
        if (y < lowest) lowest = y;
      }
    }
    return Number.isFinite(lowest) ? lowest : null;
  }

  /**
   * The hull's own collision material for the beaching groan: the first hull
   * (`body`, not `spring`) part's layer-0 vertex material — the same vertex
   * set `BodyWorld.#drivenTerrainDamage` bills and `hullCollisionKeel` reads.
   * Falls back to material 0 (the `materialOf` chain resolves it) when the
   * spec has no hull layer, so `effectNameFor` still answers.
   */
  function hullCollisionMaterial(node) {
    const owner = page.collider?.statics?.ownerOf?.(node) ?? -1;
    const scene = bodyScene.get(owner);
    for (const desc of scene?.spec?.parts || []) {
      if (desc.kind !== 'body') continue;
      const vm = desc.shape?.layers?.[0]?.vertexMaterials;
      if (vm?.length) return vm[0];
    }
    return 0;
  }

  /**
   * An aircraft's drive has no springs: it clamps its origin at the ground plus
   * `groundClearance`, the lowest wheel mesh's bottom unloaded (`aircraftSpec`),
   * or the Corsair's 1.2 when no wheel mesh is there to measure (the headless
   * runner). The parked body stands on the same wheels through
   * `PhysicsSpring`'s law, sagged under the airframe's weight. The two
   * disagree, and boarding moved the hull by the difference: El Alamein's B17
   * rose 0.58 m on the page (42.96 to 43.54), and in the runner it fell 1.6 m
   * onto the 1.2 fallback, landed at 4.4 m/s and lost 112 of its 128 hit
   * points (Brief F item 2). The engine has one body on those springs
   * throughout, so a plane at rest when it is taken keeps the height it rests
   * at: its drive's clearance becomes the parked height over the ground, and
   * the page's 0.2 m lift off the wheels is taken back. A plane still moving
   * (shoved, or falling) keeps its spec.
   */
  function standAircraftWhereParked(vehicle, scene, parked) {
    const spec = vehicle?.spec;
    if (!spec || !Number.isFinite(spec.groundClearance) || typeof vehicle.groundHeight !== 'function') return;
    if (!vehicle.state?.position || !parked) return;
    const v = parked.v;
    if (!parked.sleeping && Math.hypot(v[0], v[1], v[2]) > 0.5) return;
    scene.node.updateWorldMatrix(true, false);
    const e = scene.node.matrixWorld.elements;
    const floor = vehicle.groundHeight(e[12], e[14]);
    if (!Number.isFinite(floor)) return;
    const clearance = e[13] - floor;
    // On its wheels, not on its belly or up a hangar wall.
    if (!(clearance > 0.1) || clearance > spec.groundClearance + 3) return;
    vehicle.spec = { ...spec, groundClearance: clearance };
    vehicle.state.position.y = e[13];
  }

  /**
   * A tracked drive meets the ground at `radius` below each axle, the drawn
   * wheel's size (`measureWheelRadius`, 0.255 m on a Sherman). The parked body
   * meets it at the wheel's own collision probe: `checkVsTerrain` (0x0825a960)
   * drops a spring part's col0 vertices on the ground, vertex 0 alone when the
   * layer has three or fewer (`body-ground.js terrainContact`), and a Sherman
   * road wheel's probe sits 0.304 m under its axle. With the same springs the
   * two rest 0.049 m apart, so a Sherman sank that much when it was boarded
   * and rose it again when it was left. The drive is handed each wheel's probe
   * depth (`wheel.contactDepth`), matched to its spring part by the axle's
   * place in the hull; the drawn radius still turns the wheel.
   */
  function wheelContactDepths(vehicle, spec) {
    if (!vehicle?.wheels?.length || !('radius' in vehicle.wheels[0])) return;
    const springs = (spec?.parts ?? []).filter(p => p.kind === 'spring' && p.shape?.layers?.[0]?.vertices?.length);
    for (const wheel of vehicle.wheels) {
      if (!wheel.rest) continue;
      let best = null, bestD = Infinity;
      for (const part of springs) {
        const d = Math.hypot(part.offset[0] - wheel.rest.x, part.offset[2] - wheel.rest.z);
        if (d < bestD) { bestD = d; best = part; }
      }
      if (!best || bestD > 0.25) continue;
      const v = best.shape.layers[0].vertices;
      const count = v.length / 3 <= 3 ? 1 : v.length / 3;
      const rot = best.rot;
      let low = Infinity;
      for (let i = 0; i < count; i++) {
        const j = i * 3;
        const y = best.offset[1] + v[j] * rot[0][1] + v[j + 1] * rot[1][1] + v[j + 2] * rot[2][1];
        if (y < low) low = y;
      }
      const depth = wheel.rest.y - low;
      if (depth > 0.05 && depth < 2) wheel.contactDepth = depth;
    }
  }

  /**
   * An aircraft's drive meets the ground through `groundHeight`, the terrain
   * and the sea: taken on a carrier it would stand on the sea 20 m under the
   * deck, and a Corsair let go by its spawner fell through the Enterprise.
   * Its floor becomes the higher of that and the hull top of a ship under it
   * (`shipDeckAt`, from half a metre above the aircraft's origin down to
   * `SHIP_DECK_REACH`), skipping nothing but other ships' footprints. Before
   * `standAircraftWhereParked`, so a plane taken at rest on a deck keeps the
   * height it rests at (Brief F). Idempotent: the base function is kept.
   */
  function aircraftOnShipDecks(vehicle) {
    if (vehicle.node?.userData?.physics?.vehicleCategory !== 'VCAir') return;
    if (typeof vehicle.groundHeight !== 'function' || !vehicle.state?.position) return;
    const base = vehicle.groundHeight.shipDeckBase ?? vehicle.groundHeight;
    const floor = (x, z, fromY) => {
      const ground = base(x, z, fromY);
      const deck = shipDeckAt(x, z, vehicle.state.position.y + 0.5, SHIP_DECK_REACH);
      return deck && !(deck.y <= ground) ? deck.y : ground;
    };
    floor.shipDeckBase = base;
    vehicle.groundHeight = floor;
  }

  /** The player has taken a vehicle: its drive model now stands in for the body. */
  function adoptDrivenBody(vehicle) {
    if (vehicle) aircraftOnShipDecks(vehicle);
    if (!hullBodies.bodyWorld || !vehicle) return;
    const owner = page.collider?.statics?.ownerOf(vehicle.node) ?? -1;
    const scene = bodyScene.get(owner);
    if (!scene) return;
    if (!scene.sea) {
      standAircraftWhereParked(vehicle, scene, hullBodies.bodyWorld.get(owner)?.parked?.body);
      wheelContactDepths(vehicle, scene.spec);
    }
    page.world.adoptDriven(owner, vehicle, scene.spec);
    scene.moved = true;
    // A hull that has just become a body must leave the static index at once, not
    // at the end of the first tick: `setMovedOwner` disables the baked owner and
    // re-asks every query in the hull's own frame, and a 1,400-triangle destroyer
    // that probed its own baked triangles for one tick would shove itself.
    if (scene.sea) {
      // Ground her on the same geometry the crash-damage pass bills.
      if ('sampleKeel' in vehicle) vehicle.sampleKeel = hullCollisionKeel(scene.spec);
      scene.node.updateWorldMatrix(true, false);
      const e = scene.node.matrixWorld.elements;
      publishMovedHull(owner, scene, scene.node, [e[12], e[13], e[14]]);
    }
  }

  /** ... and has left it: it stands on its own springs again, where it was left. */
  function releaseDrivenBody(vehicle) {
    if (!hullBodies.bodyWorld || !vehicle) return;
    const owner = page.collider?.statics?.ownerOf(vehicle.node) ?? -1;
    const scene = bodyScene.get(owner);
    if (!scene || !hullBodies.bodyWorld.get(owner)?.driven) return;
    // A ship left at sea goes back to being scenery where her driver left her:
    // she has no parked body to fall back on, and building one would put a
    // destroyer on wheel springs over the sea bed. `setMovedOwner` still holds the
    // hull's collision at the pose she was abandoned in, so her deck stays
    // walkable wherever that is.
    if (scene.sea) {
      hullBodies.bodyWorld.remove(owner);
      return;
    }
    const wheelState = vehicle.wheels
      ? new Map(vehicle.wheels.map(wheel => [wheel.node, wheel])) : null;
    page.world.releaseDriven(owner, vehicle, scene.spec, bodyPoseOf(vehicle.node), wheelState);
  }

  /** A wreck is scenery and a respawn is a fresh vehicle on its pad. */
  function retireVehicleBody(owner) {
    if (!bodyScene.has(owner)) return;
    page.world.retireBody(owner);
  }
  function respawnVehicleBody(owner) {
    const scene = bodyScene.get(owner);
    if (!scene || !hullBodies.bodyWorld) return;
    page.world.removeBody(owner);
    scene.moved = false;
    scene.dirty = false;
    page.collider?.clearMovedOwner?.(owner, { enable: false });
    // Back on its pad: the engine replaces the object at the ObjectSpawner, and
    // the static index still holds the hull exactly there.
    const node = scene.node;
    _bodyMatrix.copy(scene.spawnInverse).invert();
    if (node.parent) {
      node.parent.updateWorldMatrix(true, false);
      _bodyParentInv.copy(node.parent.matrixWorld).invert();
      _bodyMatrix.premultiply(_bodyParentInv);
    }
    _bodyMatrix.decompose(node.position, node.quaternion, _bodyScale);
    node.updateMatrix();
    THREE.Object3D.prototype.updateMatrixWorld.call(node, true);
    // A ship respawned on her pad is put back at her draft rather than on a parked
    // body's springs — the same closed form `floatPlacedVehicles` used at load.
    if (scene.sea) {
      refloatHull(scene.node);
      rebaseDeckSpawns();
      return;
    }
    // A deck aircraft comes back off its ship's spawner, wherever she is now,
    // and held again: `spawnObject` 0x083140a0 sets the hold on every spawn.
    const held = heldCraft.find(rec => rec.node === node);
    if (held) {
      held.released = false;
      setNodeWorld(node, holdMatrix(held));
      held.hostAt = held.host.matrixWorld.clone();
      node.updateWorldMatrix(true, false);
      const e = node.matrixWorld.elements;
      publishMovedHull(owner, scene, node, [e[12], e[13], e[14]]);
      scene.moved = true;
      page.world.addParkedBody(owner, scene.spec, bodyPoseOf(node));
      return;
    }
    // Back on its pad is back IN its pad when the pad is a deck.
    settleOnDecks([owner]);
    page.world.addParkedBody(owner, scene.spec, bodyPoseOf(scene.node));
  }

  /** Write a body's pose onto its node and tell the collider where the hull is. */
  function syncBodyNode(owner, scene, body) {
    writeBodyPose(scene.node, body);
    publishMovedHull(owner, scene, scene.node, body.pos);
    // EntryPoint world positions are cached between proximity scans. A released
    // vehicle carries those points with it, so discard the cache as soon as its
    // parked body moves rather than leaving an enter prompt at the exit spot.
    page.forgetEntryPoints();
  }

  /** A body's world pose, written onto a scene node (which may be frozen). */
  function writeBodyPose(node, body) {
    const a = body.axes, p = body.pos;
    _bodyMatrix.set(
      a[0][0], a[1][0], a[2][0], p[0],
      a[0][1], a[1][1], a[2][1], p[1],
      a[0][2], a[1][2], a[2][2], p[2],
      0, 0, 0, 1);
    if (node.parent) {
      _bodyParentInv.copy(node.parent.matrixWorld).invert();
      _bodyFwd.multiplyMatrices(_bodyParentInv, _bodyMatrix);
    } else {
      _bodyFwd.copy(_bodyMatrix);
    }
    _bodyFwd.decompose(node.position, node.quaternion, _bodyScale);
    node.updateMatrix();
    // The node may be frozen (`freeze` swaps `updateMatrixWorld` for a no-op);
    // a body that moves has to go round that, and only that node pays for it.
    THREE.Object3D.prototype.updateMatrixWorld.call(node, true);
  }

  function publishMovedHull(owner, scene, node, p) {
    _bodyFwd.multiplyMatrices(node.matrixWorld, scene.spawnInverse);
    _bodyInv.copy(_bodyFwd).invert();
    page.collider.setMovedOwner(owner, _bodyFwd.elements, _bodyInv.elements,
      p[0], p[1], p[2], scene.spec.boundingRadius);
  }

  /** One body tick of the world, drawn: the world's step() (frame(), above)
   *  already ran the BodyWorld itself — `step.bodyTicks` is the report of it —
   *  and this half only writes the bodies that moved back onto their scene
   *  nodes and tells the collider where a shoved hull now stands. */
  function stepVehicleBodies(step) {
    if (!step.bodyTicks || !hullBodies.bodyWorld) return;
    for (const [owner, entry] of hullBodies.bodyWorld.entries) {
      const scene = bodyScene.get(owner);
      if (!scene) continue;
      if (entry.driven) {
        // The contact solver may have pushed the drive model's state; draw it.
        // Unless the render interpolation owns this node (every occupied hull,
        // local-look.js), in which case the push is already in the pose it
        // captured at the end of the tick, and re-applying the raw state here
        // would put the hull back on the tick the frame has just drawn it off.
        if (!page.drawsHull(entry.driven.vehicle)) {
          entry.driven.vehicle.applyTransform();
        }
        const s = entry.driven.vehicle.state.position;
        publishMovedHull(owner, scene, scene.node, [s.x, s.y, s.z]);
        continue;
      }
      const body = entry.parked.body;
      if (body.sleeping && !scene.dirty) continue;
      scene.dirty = !body.sleeping;          // one last sync on the tick it falls asleep
      if (!scene.moved) {
        const e = scene.node.matrixWorld.elements;
        const dx = body.pos[0] - e[12], dy = body.pos[1] - e[13], dz = body.pos[2] - e[14];
        if (dx * dx + dy * dy + dz * dz < 1e-6 && body.sleeping) continue;
        scene.moved = true;
      }
      syncBodyNode(owner, scene, body);
    }
  }

  Object.assign(hullBodies, {
    _shipNormal,
    adoptDrivenBody,
    bodyAwareCollider,
    bodyScene,
    floatHosts,
    floatPlacedVehicles,
    hullCollisionMaterial,
    loadCollisionMeshes,
    onCrashDamage,
    rebaseDeckSpawns,
    releaseDrivenBody,
    respawnVehicleBody,
    retireVehicleBody,
    seabedFriction,
    settlePlacedVehicles,
    setupVehicleBodies,
    shipFlagInactive,
    stepSinkingHulls,
    stepVehicleBodies,
    syncVehicleSpawnOwnership,
  });
  return hullBodies;
}
