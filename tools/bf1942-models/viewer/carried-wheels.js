// The wheels and belts of a hull the page moves by someone else's word: a
// room's hull its player rides without driving (`net-room.js`
// `carryRiddenHull`). Nothing integrates such a hull here, so nothing turns
// its wheels: `TrackedVehicle` rolls a wheel by the ground speed under it
// (`tracked-vehicle.js`, `wheel.angle += along / radius * dt`) and scrolls a
// belt at its side's contact speed, and this does the same off the motion the
// hull was drawn through (`track-scroll.js` `motionBetween`).
//
// A wheel is a `Spring` with a drawn mesh, turned about its own X by the
// distance its hull moved forward over its radius, on top of the rotation
// the model gives it. The radius is the drawn mesh's, the measure
// `measureWheelRadius` takes (half the mean of its Y and Z extents).
import * as THREE from 'three';
import { motionBetween, scrollBeltsByMotion } from './track-scroll.js';

const wheelSets = new WeakMap();
const _spin = new THREE.Quaternion();
const _euler = new THREE.Euler();

function drawnRadius(node) {
  let target = null;
  node.traverse(child => {
    if (!target && child.geometry && !child.userData?.collision) target = child;
  });
  if (!target) return null;
  if (!target.geometry.boundingBox) target.geometry.computeBoundingBox();
  const box = target.geometry.boundingBox;
  if (!box) return null;
  const radius = ((box.max.y - box.min.y) + (box.max.z - box.min.z)) / 4;
  return radius > 0.05 ? radius : null;
}

/** The wheels under `root`: `{ node, base, radius, angle }` each, found once. */
export function carriedWheels(root) {
  let wheels = wheelSets.get(root);
  if (wheels) return wheels;
  wheels = [];
  root.traverse(node => {
    if (node.userData?.templateKind !== 'Spring') return;
    const radius = drawnRadius(node);
    if (radius) wheels.push({ node, base: node.quaternion.clone(), radius, angle: 0 });
  });
  wheelSets.set(root, wheels);
  return wheels;
}

/**
 * One frame of a carried hull: `was` is `{ pos, quat }` it was drawn at last
 * frame (THREE objects), `root` stands at its new pose. Rolls every wheel and
 * scrolls every belt by the motion between the two. Returns that motion,
 * `{ forward, yawRate }` (m/s, rad/s).
 */
export function turnCarriedRunningGear(root, was, dt) {
  const motion = motionBetween(was.pos, was.quat, root.position, root.quaternion, dt);
  // A hull put somewhere else (a join, a respawn) did not roll there.
  if (!Number.isFinite(motion.forward) || Math.abs(motion.forward) > 80) return { forward: 0, yawRate: 0 };
  for (const wheel of carriedWheels(root)) {
    wheel.angle += (motion.forward / wheel.radius) * dt;
    wheel.node.quaternion.copy(wheel.base).multiply(_spin.setFromEuler(_euler.set(-wheel.angle, 0, 0)));
  }
  scrollBeltsByMotion(root, motion, dt);
  return motion;
}
