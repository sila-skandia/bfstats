// A plane's own gunners, read off its model (features/dogfight-doctrine,
// "The gunners from the planes' own data"): every manned gun on the plane
// that is not the pilot's, as the play front end wires that seat.
//
// A gunner's seat is a PlayerControlObject nested under the plane's root
// (`seat-survey.js` `surveyVehicle`), and its gun a FireArms on that seat's
// fire key that fires a bullet, under the seat's mouse-aimed
// RotationalBundles (GUN-2). What the gun can reach is not typed in: the
// seat's own aim rig (`turret-rig.js` `TurretRig`, the rig the mouse drives
// in play and the round replay lays from its recorded rounds) is pointed at
// every direction of a sphere around the plane, and the directions its line
// of fire comes within `REACH_TOLERANCE` of are the gun's arc. So a Stuka's
// MG 42 turns 40 degrees either side of astern and an Albatros C.III's 70;
// a DH.4's ring goes all the way round; none of them fires down past its own
// tail, because none of their pitch rigs depresses there.
//
// The gun's rate (`roundOfFire`), muzzle speed (`velocity`), the round's
// life and drop, its tracer interval and its deviation are the FireArms'
// own. What the school adds is the gunner: how far out they open fire
// (`GUNNER.range`), how long they take to react, and how much their aim
// wanders. Those are the gunner's, not the gun's, and are the same for
// every plane.
//
// This module is the plain half: the gunner's arc as data and the tests a
// fight runs on it (`dogfight-fight.js`), with no three.js, so a fight in node
// flies it as the page does. `dogfight-gunner-seats.js` reads a model's
// seats into it.

/** The gunner (not the gun): opens fire inside `range` metres, `react`
 *  seconds after the enemy comes into the arc; the aim wanders `spread`
 *  degrees on top of the gun's own deviation. */
export const GUNNER = Object.freeze({ range: 400, react: 0.8, spread: 1.2 });

/** The arc's grid, degrees: azimuth round the plane and elevation off its
 *  wings' plane. */
export const ARC_STEP = 3;
/** A direction is in the arc when the rig brings the line of fire this
 *  close to it, degrees. */
export const REACH_TOLERANCE = 2;

export const AZ = Math.round(360 / ARC_STEP);
export const EL = Math.round(180 / ARC_STEP) + 1;
const DEG = Math.PI / 180;

/** The body-frame unit vector of grid cell (`a`, `e`): azimuth 0 dead
 *  ahead (-z), 90 off the right wing (+x), 180 astern; elevation up (+y). */
export function cellDir(a, e, out = [0, 0, 0]) {
  const az = a * ARC_STEP * DEG, el = (e * ARC_STEP - 90) * DEG;
  out[0] = Math.cos(el) * Math.sin(az);
  out[1] = Math.sin(el);
  out[2] = -Math.cos(el) * Math.cos(az);
  return out;
}

/** The grid cell nearest a body-frame direction. */
export function cellOf(d) {
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  const el = Math.asin(Math.max(-1, Math.min(1, d[1] / l))) / DEG;
  let az = Math.atan2(d[0], -d[2]) / DEG;
  if (az < 0) az += 360;
  return [Math.round(az / ARC_STEP) % AZ, Math.max(0, Math.min(EL - 1, Math.round((el + 90) / ARC_STEP)))];
}

/** Whether a body-frame direction is inside a gunner's arc. */
export function inArc(gunner, dir) {
  const [a, e] = cellOf(dir);
  return gunner.arc[e * AZ + a] === 1;
}

/** The arc's extent in words a lesson can quote: the most it turns either
 *  side of astern (180 for all the way round), and the highest and lowest it
 *  reaches dead astern, degrees off the wings' plane (null where astern is
 *  out of reach). */
export function arcExtent(gunner) {
  let side = 0, up = null, down = null;
  for (let e = 0; e < EL; e++) {
    for (let a = 0; a < AZ; a++) {
      if (gunner.arc[e * AZ + a] !== 1) continue;
      const off = Math.abs(a * ARC_STEP - 180);
      if (Math.abs(e * ARC_STEP - 90) <= 15) side = Math.max(side, off);
      if (off === 0) {
        const el = e * ARC_STEP - 90;
        up = up === null ? el : Math.max(up, el);
        down = down === null ? el : Math.min(down, el);
      }
    }
  }
  return { side, up, down };
}

/** A plane's direction `v` (world) in its own body frame, given its world
 *  orientation `q` (`{ x, y, z, w }`). */
export function toBody(q, v) {
  const { x, y, z, w } = q;
  // The conjugate's rotation.
  const ix = w * v[0] - y * v[2] + z * v[1], iy = w * v[1] - z * v[0] + x * v[2];
  const iz = w * v[2] - x * v[1] + y * v[0], iw = x * v[0] + y * v[1] + z * v[2];
  return [ix * w + iw * x - iy * z + iz * y, iy * w + iw * y - iz * x + ix * z, iz * w + iw * z - ix * y + iy * x];
}
