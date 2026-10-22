// A correction moves the simulation; the drawn pose eases onto it.
//
// Against a real server the page predicts its own soldier and hull and takes
// the server's state at every acknowledged tick, whole, the way the retail
// client does (net-room.js, netcode-reconcile.js). Retail gets away with
// taking it whole because its prediction runs the engine's own integrator:
// the error at the acked tick is zero and the correction moves nothing. Ours
// runs the page's integrators, which are not yet the engine's on the ground
// (features/udp-sidecar/review-2026-10-21.md), so every acknowledgement moves
// the body a little, twenty times a second. A camera riding that body showed
// it as a shake: measured headless on the lab, 2026-10-22, the camera's speed
// while walking jittered 15.3% rms frame to frame through the sidecar against
// 2.6% solo, with a correction of about 1 cm on nearly every ack.
//
// The simulation keeps the whole correction: where the body IS stays the
// server's, so collisions, rounds and the next acknowledgement all see it.
// Only what is DRAWN carries the jump as an offset, cancelling it at the
// instant it lands and fading it to nothing over `CORRECTION_BLEND_S`. The
// drawn pose is therefore continuous, and converges on the simulated one
// within a few frames.
//
// A correction too large to be prediction residue (a respawn, a push out of a
// wall, a seat change) is not blended: the offset is dropped and the drawn pose
// snaps, which is what the eye expects of a teleport.
//
// No THREE, no DOM: `tests/correction_blend_harness.mjs` drives it under node.

/** The offset's time constant, seconds. Short enough that the drawn pose is
 *  never visibly behind (a 1 cm correction is under a millimetre in 0.25 s),
 *  long enough to spread a correction over several frames at any frame rate. */
export const CORRECTION_BLEND_S = 0.1;

/** Past this many metres the correction is a different event: snap. */
export const CORRECTION_BLEND_MAX_M = 2.0;

/** Past this many radians of orientation the correction is a different event. */
export const CORRECTION_BLEND_MAX_RAD = 0.5;

/**
 * One drawn object's correction offset: a position and an orientation the
 * drawn pose adds on top of the simulated one.
 *
 *   shift(dx, dy, dz)  the simulation was just moved by d: the offset takes -d
 *   rotate(q)          the simulation's orientation was just premultiplied by
 *                      q ([x, y, z, w]): the offset takes q's inverse
 *   decay(dt)          once a drawn frame, by the frame's own dt
 *   reset()            a snap: draw the simulated pose as it is
 *
 * `offset` is `{ x, y, z, q: [x, y, z, w] }`; `active` says whether there is
 * anything to add, so a caller can skip the work at rest.
 */
export function createCorrectionBlend({
  tau = CORRECTION_BLEND_S,
  maxShift = CORRECTION_BLEND_MAX_M,
  maxAngle = CORRECTION_BLEND_MAX_RAD,
} = {}) {
  const offset = { x: 0, y: 0, z: 0, q: [0, 0, 0, 1] };
  const out = { offset, snaps: 0, blends: 0 };

  out.reset = () => {
    offset.x = 0; offset.y = 0; offset.z = 0;
    offset.q[0] = 0; offset.q[1] = 0; offset.q[2] = 0; offset.q[3] = 1;
  };

  out.active = () => offset.x !== 0 || offset.y !== 0 || offset.z !== 0 || offset.q[3] !== 1;

  out.shift = (dx, dy, dz) => {
    if (!Number.isFinite(dx + dy + dz)) return false;
    const after = Math.hypot(offset.x - dx, offset.y - dy, offset.z - dz);
    if (Math.hypot(dx, dy, dz) > maxShift || after > maxShift) {
      out.reset();
      out.snaps++;
      return false;
    }
    offset.x -= dx; offset.y -= dy; offset.z -= dz;
    out.blends++;
    return true;
  };

  out.rotate = (q) => {
    if (!q || !Number.isFinite(q[0] + q[1] + q[2] + q[3])) return false;
    if (angleOf(q) > maxAngle) { out.reset(); out.snaps++; return false; }
    // offset' = offset * inverse(q): the drawn orientation, offset * sim, stays
    // where it was when sim becomes q * sim (offset * q^-1 * q * sim).
    const inv = [-q[0], -q[1], -q[2], q[3]];
    mul(offset.q, inv, offset.q);
    normalise(offset.q);
    if (angleOf(offset.q) > maxAngle) { out.reset(); out.snaps++; return false; }
    out.blends++;
    return true;
  };

  out.decay = (dt) => {
    if (!(dt > 0) || !out.active()) return;
    const keep = Math.exp(-dt / tau);
    offset.x *= keep; offset.y *= keep; offset.z *= keep;
    if (Math.hypot(offset.x, offset.y, offset.z) < 1e-5) { offset.x = 0; offset.y = 0; offset.z = 0; }
    slerpToIdentity(offset.q, 1 - keep);
    if (angleOf(offset.q) < 1e-6) { offset.q[0] = 0; offset.q[1] = 0; offset.q[2] = 0; offset.q[3] = 1; }
  };

  return out;
}

/** a * b into out (all [x, y, z, w]); out may alias either. */
function mul(a, b, out) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

function normalise(q) {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  q[0] /= n; q[1] /= n; q[2] /= n; q[3] /= n;
  // The short way round: w >= 0.
  if (q[3] < 0) { q[0] = -q[0]; q[1] = -q[1]; q[2] = -q[2]; q[3] = -q[3]; }
  return q;
}

function angleOf(q) {
  return 2 * Math.acos(Math.min(1, Math.abs(q[3])));
}

/** q toward the identity by `t` of its angle, in place. */
function slerpToIdentity(q, t) {
  normalise(q);
  const half = Math.acos(Math.min(1, q[3]));
  if (half < 1e-9) return q;
  const s = Math.sin(half);
  const scale = Math.sin((1 - t) * half) / s;
  q[0] *= scale; q[1] *= scale; q[2] *= scale;
  q[3] = Math.cos((1 - t) * half);
  return normalise(q);
}

/** The rotation that takes `from` to `to` ([x, y, z, w] each): to * inverse(from). */
export function deltaRotation(from, to, out = [0, 0, 0, 1]) {
  mul(to, [-from[0], -from[1], -from[2], from[3]], out);
  return normalise(out);
}

/** The offset applied to a drawn quaternion: offset * q, in place on `q`. */
export function applyRotation(offsetQ, q) {
  return mul(offsetQ, q, q);
}
