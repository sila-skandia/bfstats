// The world's vehicle bodies: the BodyWorld built once the level's hulls
// have owner ids, a parked hull entering it, and a hull trading its parked
// body for the driven one and back. Plain functions of the `World`
// (world.js), which delegates its methods here.

import { BodyWorld } from './body-world.js';
import { buildParkedVehicle, collisionPartsFor, DrivenBody } from './vehicle-bodies.js';
import { onBodyDamage } from './world-damage.js';

/** The level's parked hulls, once the collider has handed out owner ids.
 *  `terrain` is the body world's ground (page's `bodyTerrain` glue); the
 *  world owns the BodyWorld and the crash-damage accounting from here on. */
export function setupBodies(world, { tables, terrain, statics = null }) {
  if (world.bodyWorld || !tables || !terrain) return;
  world.bodyWorld = new BodyWorld({
    tables,
    terrain,
    statics,
    onDamage: (owner, result, at, other) => onBodyDamage(world, owner, result, at, other),
  });
}

/** One parked hull enters the body world, exactly as the page used to. */
export function addParkedBody(world, owner, spec, pose) {
  if (!world.bodyWorld) return;
  world.bodyWorld.addParked(owner, buildParkedVehicle(spec, pose), spec);
}

/** The player has taken a drivable vehicle: its drive model stands in for
 *  the parked body, the way `adoptDrivenBody` used to arrange it. */
export function adoptDriven(world, owner, vehicle, spec) {
  if (!world.bodyWorld || !vehicle) return;
  world.bodyWorld.remove(owner);
  const driven = new DrivenBody(vehicle, spec);
  world.bodyWorld.addDriven(owner, driven,
    collisionPartsFor(spec, driven, { hullOnly: true }), spec);
  // The solver now owns this hull's contacts with the static world, so the
  // drive model's own swept sphere stands down (`wheeled-vehicle.js` `hullSolved`).
  // Only when there IS a static world to probe: without one a building is
  // still the sweep's business.
  if (world.bodyWorld.statics && 'hullSolved' in vehicle) vehicle.hullSolved = true;
}

/** ... and has left it: it stands on its own springs again, where it was
 *  left, trading the driven pose for a parked one at the given world pose. */
export function releaseDriven(world, owner, vehicle, spec, pose, wheelState = null) {
  if (!world.bodyWorld || !vehicle) return;
  if (!world.bodyWorld.get(owner)?.driven) return;
  if ('hullSolved' in vehicle) vehicle.hullSolved = false;
  world.bodyWorld.remove(owner);
  const parked = buildParkedVehicle(spec, {
    ...pose,
    asleep: false,
    wheelState,
  });
  const v = vehicle.state.velocity;
  parked.body.v[0] = v.x; parked.body.v[1] = v.y; parked.body.v[2] = v.z;
  const w = vehicle.state.angularVelocity;
  for (let i = 0; i < 3; i++) {
    parked.body.w[i] = w.x * pose.axes[0][i]
      + w.y * pose.axes[1][i] + w.z * pose.axes[2][i];
  }
  world.bodyWorld.addParked(owner, parked, spec);
}
