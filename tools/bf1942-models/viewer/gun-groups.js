// Collecting a vehicle's guns: every FireArms node under a root, its muzzles,
// flash emitters, drawn projectile body, trail sprite and tracer streak, into
// the `group` records the rest of `GunFire` fires and steps. Split out of
// `gunfire.js`; `collectGroups` takes the `GunFire` instance (`guns`) it
// indexes the groups into.

import * as THREE from 'three';
import { launchesADrawnBody } from './bomb-release.js';
import { TRACER_MAX_RANGE, TRACER_SPEED_SCALE } from './round-launch.js';

const _extent = new THREE.Vector3();

/** `GunFire.collect`, which documents the options: index every FireArms under `root`. */
export function collectGroups(guns, root, options = {}) {
  const {
    replace = true,
    hideEffects = true,
    speedScale = TRACER_SPEED_SCALE,
    maxRange = TRACER_MAX_RANGE,
    roundLifetime = 'fixed',
    tracerLength = 'fixed',
    platformVelocity = null,
    aimRay = null,
    spreadDeg = null,
  } = options;
  if (replace) {
    guns.clear();
    guns.groups.length = 0;
  }
  const found = [];
  if (hideEffects) {
    // Every baked effect stays dark until a shot strobes it — this also parks
    // non-gun effects (water-touch planes, shell ejects on unarmed variants).
    // Projectile bodies and trail sprites are spawn templates, never drawn
    // in place.
    root.traverse(obj => {
      if (obj.userData?.effect || obj.userData?.projectileMesh
          || obj.userData?.projectileTrail
          || obj.userData?.tracerMesh) obj.visible = false;
    });
  }
  root.traverse(obj => {
    const stats = obj.userData?.fireArms;
    if (!stats) return;
    const muzzles = [];
    const emitters = [];
    let projectileMesh = null;
    let trailQuad = null;
    let tracerMesh = null;
    obj.traverse(node => {
      if (node.userData?.muzzle) muzzles.push(node);
      if (node.userData?.projectileMesh || ((node.isMesh || (node.children && node.children.some(c => c.isMesh))) && (/rocket|projectile/i.test(node.name) || /rocket|projectile/i.test(node.userData?.geometry || '')))) projectileMesh = node;
      if (node.userData?.projectileTrail) trailQuad = node;
      if (node.userData?.tracerMesh) tracerMesh = node;
      const spec = node.userData?.effect;
      if (!spec || spec.kind === 'bundle') return;
      // Emitter materials are shared through the exporter's cache (both wing
      // flashes, or two seats' glows, reference one material); tinting a
      // shared one would flash every gun at once. Clone per emitter.
      const materials = [];
      node.traverse(part => {
        if (!part.isMesh) return;
        const cloned = [part.material].flat().map(m => {
          const clone = m.clone();
          // glTF has no additive blend mode, so the exporter marks the
          // flash's materials in extras and GLTFLoader lands that in
          // userData. The model browser applies it to the whole model at
          // load; the map path never did, and its own dynamic-shading pass
          // rebuilds vehicle materials from scratch — so the mark is
          // honoured here too, where both pages go through.
          if (clone.userData?.additive) {
            clone.blending = THREE.AdditiveBlending;
            clone.transparent = true;
            clone.depthWrite = false;
            clone.needsUpdate = true;
          }
          guns.onMaterial?.(clone);
          materials.push(clone);
          return clone;
        });
        part.material = cloned.length === 1 ? cloned[0] : cloned;
      });
      emitters.push({
        node, spec, materials, age: Infinity, spin: 0,
        // Which barrel this flash belongs to, so only the barrel that fired
        // lights up. Null for a flash hung off the FireArms itself by
        // `addTemplate` (the Sherman's `e_MuzzPanz`), which fires every shot.
        muzzle: ancestorMuzzle(node, obj),
        // Authored placement, kept aside so drift along the direction of
        // fire (offsetInDof + speedInDof x age) and billboarding never
        // accumulate into the node's own transform.
        basePos: node.position.clone(),
        baseQuat: node.quaternion.clone(),
      });
    });
    // A bomb rack declares no flash, no tracer and no recoil, and releases at
    // zero muzzle velocity -- so it matched every clause of the guard that
    // used to stand here and no plane in this viewer has ever dropped a bomb
    // (ledger BOMB-9). The guard is not deleted: what it protected against is
    // a `FireArms` placeholder with no signature AND nothing to launch, which
    // would still cost a trigger, a cooldown and a stream of invisible rounds
    // spending collision casts. `launchesADrawnBody` is the amended test and
    // carries the whole argument.
    if (!launchesADrawnBody(stats, projectileMesh)
        && !emitters.length && !stats.tracer && !stats.recoil
        && !(stats.velocity > 0)) return;
    // The template's cross-section, measured once, so the width floor is
    // expressed against real metres rather than a guess at what a tracer mesh
    // is shaped like. Measured on the *geometry*, in the streak's own frame:
    // `Box3.setFromObject` works in world space, and the AABB of a thin spike
    // rotated by the airframe reads 0.42 m across instead of its real 0.0061,
    // which silently pinned the floor below the streak's own scale.
    let tracerWidth = 0;
    if (tracerMesh) {
      tracerMesh.traverse(part => {
        if (!part.isMesh || !part.geometry) return;
        if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
        const size = part.geometry.boundingBox.getSize(_extent);
        tracerWidth = Math.max(tracerWidth, size.x, size.y);
      });
      // The streak's own `.rs` says `blendDest one` and `depthWrite false`,
      // and the exporter carries both through as the same `additive` extras
      // flag the flash emitters use. Applied once on the template rather than
      // per clone: every round of a gun looks identical, so unlike a flash
      // (tinted per shot by its colour ramp) there is nothing to keep apart,
      // and one shared material is one draw-call state change.
      tracerMesh.traverse(part => {
        if (!part.isMesh) return;
        for (const material of [part.material].flat()) {
          if (!material.userData?.additive) continue;
          material.blending = THREE.AdditiveBlending;
          material.transparent = true;
          material.depthWrite = false;
          material.needsUpdate = true;
        }
      });
    }
    // The recoil path poses the gun node from its authored rest position.
    // The model browser stamps `home` on every node at load for its explode
    // slider; the map path does not, so take it here when it is missing.
    if (!obj.userData.home) obj.userData.home = obj.position.clone();
    const group = {
      node: obj,
      stats,
      // `PointPhysicsNode::updatePositionalDragSimple` (`0x00578990`) takes
      // the body's own `getBoundingRadius` (virtual slot `+0x1c`) into the
      // drag term as a frontal area, pi*r^2. Nothing exports it, so it is
      // measured here off the drawn body's geometry — the same object the
      // engine is measuring — once per group rather than once per round.
      boundingRadius: projectileMesh ? meshRadius(projectileMesh) : 0,
      muzzles: muzzles.length ? muzzles : [obj],
      emitters,
      projectileMesh,
      trailQuad,
      tracerMesh,
      tracerWidth,
      projectilePool: [],
      puffPool: [],
      tracerMeshPool: [],
      firing: false,
      cooldown: 0,
      shots: 0,
      // Which placed object this gun is part of, so its own rounds ignore its
      // own hull. Resolved lazily against whatever collider is in force —
      // see `gunOwner` in projectile-flight.js — because a level switch replaces both.
      owner: -1,
      ownerFor: undefined,
      speedScale,
      maxRange,
      roundLifetime,
      tracerLength,
      platformVelocity,
      // Both null on every vehicle. `aimRay` is the hand-weapon contract:
      // 25 of 28 hand weapons declare `fireInCameraDof 1` with
      // `projectilePosition 0/0/0`, meaning the round is spawned on the
      // camera's line of fire and the muzzle node only places the flash
      // (`first-person-soldier.md` §2.7). `spreadDeg` is the deviation
      // cone's half-angle, asked per shot so a blooming burst walks.
      aimRay,
      spreadDeg,
      // 1 = barrel home; a shot resets to 0 and it eases forward again.
      recoil: stats.recoil ? 1 : null,
    };
    guns.groups.push(group);
    found.push(group);
  });
  return found;
}

/**
 * The bounding-sphere radius of a template mesh, in its own frame, metres.
 *
 * Measured on the geometry rather than with `Box3.setFromObject`, for the same
 * reason the tracer width is (see `collect`): a world-space AABB of a body
 * rotated by the airframe reads the wrong number. Returns 0 for a node with no
 * geometry, which switches the drag term off rather than inventing an area.
 */
function meshRadius(node) {
  let radius = 0;
  node.traverse(part => {
    if (!part.isMesh || !part.geometry) return;
    if (!part.geometry.boundingSphere) part.geometry.computeBoundingSphere();
    radius = Math.max(radius, part.geometry.boundingSphere?.radius || 0);
  });
  return radius;
}

/** The `muzzle` node `node` hangs off, searching no further than `stop`. */
function ancestorMuzzle(node, stop) {
  for (let n = node; n && n !== stop; n = n.parent) {
    if (n.userData?.muzzle) return n;
  }
  return null;
}
