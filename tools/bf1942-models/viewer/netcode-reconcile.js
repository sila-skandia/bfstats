// P4's correction law: what a client-predicted soldier does with the
// authority's word about where it is.
//
// The page predicts its own soldier by running the same `World` the room runs,
// from the same input words it puts on the wire (netcode.md §4). Prediction
// without reconciliation is only half an architecture, and P2/P3 shipped the
// half: `map.html`'s snapshot handler compared the authority's position at
// server tick T against the local soldier's position NOW and, past a 4 m
// grace, called `soldier.spawn()` on it. Three things were wrong with that,
// and each of them is a law this module owns instead.
//
// 1. THE COMPARISON WAS NOT LIKE FOR LIKE. The authority's snapshot describes
//    tick T; the client has already simulated the words for T+1..N, which the
//    authority has not run yet. The difference between those two positions is
//    mostly INPUT LATENCY, not prediction error, and correcting to it drags
//    the player backwards by the latency every time the window is crossed.
//    The wire now carries `ack` -- the seq the authority's last tick consumed
//    (netcode.js) -- so the error can be measured where both sides have run
//    the same words, and the client's own unacknowledged motion re-applied on
//    top. That re-application IS the input replay a predicted client owes:
//    the same words on the same integrator produced this motion once already,
//    so the recorded per-tick displacement is what re-running them would
//    reproduce, to the bit. Re-stepping the soldier instead would also
//    re-advance its bob, step and gait clocks N times per correction, which
//    is a rendering artefact bought for no accuracy.
//
// 2. A CORRECTION IS NOT A RESPAWN. `Soldier.spawn()` zeroes the velocity, the
//    PHY-6 movement ramps, the stance, the gait, the bob and the soldier's own
//    60 Hz clock, and resets the view pitch to 0 -- and, called with no yaw
//    argument, it sets the facing to 0 as well. A correction must move the
//    body and touch nothing else, so this module returns a position and says
//    whether it is a hard set; the caller writes it with the rigid body's own
//    `setPosition`, which moves `position` and `previous` and nothing more.
//
// 3. AN ERROR SMALLER THAN THE GRACE WAS NOT CORRECTED AT ALL, SO IT COULD
//    ONLY GROW. Under the grace the old handler did nothing, which is fine for
//    noise and wrong for a standing divergence: a heading error of a few
//    degrees splays the two paths apart at `2 v sin(dTheta/2)` and the grace
//    is crossed again within seconds, forever. Every accepted snapshot now
//    closes a fraction of the error -- position and facing both -- so a
//    standing divergence decays instead of accumulating, and noise stays
//    invisible.
//
// No THREE, no DOM: `tests/netcode_reconcile_harness.mjs` drives it under node.

/**
 * Past this, the authority is not describing the same event the prediction is
 * running -- a respawn, a teleport out of a hull, a body the server pushed out
 * of geometry -- and the position is taken whole.
 *
 * Justified from the sim rather than from what stops the snapping. With the
 * replay above, the residual a correct prediction can leave at the ACKED tick
 * is bounded by what the two sims can legitimately disagree about over one
 * snapshot period (50 ms at the default 20 Hz rate):
 *
 *   * the authority's own idle ticks. A tick the client's word has not reached
 *     yet consumes the engine's zeroed word (world.js's tick law), which runs
 *     the PHY-6 ramp DOWN rather than holding; a measured local run shows ~4%
 *     of ticks idle, so ~2 ticks per snapshot period, at most 2/30 s of the
 *     6 m/s run table = 0.4 m;
 *   * the input record's quantization, which is 0.01 on a +-16 axis and so
 *     sub-millimetre on a walk;
 *   * float order of operations between two runs of the same integrator,
 *     which is zero here (both sides are one build of one module).
 *
 * So 0.4 m is the honest worst case and 4.0 m is ten times it. The old
 * `NET_POS_GRACE` carried the same number for a different job -- there it was
 * the only thing standing between the player and a teleport, which is why it
 * had to be generous; here it is the line between "correct this smoothly" and
 * "this is a different event".
 */
export const CORRECTION_HARD_LIMIT = 4.0;

/**
 * The fraction of the remaining error each accepted snapshot closes. At the
 * default 20 Hz that is a ~0.17 s time constant: a 1 m standing error is
 * halved in three snapshots and spent in under a second, while a 5 cm
 * disagreement moves the body by 12 mm and nothing on screen says so.
 *
 * A fraction, not a speed: the correction can never overshoot, never reverse,
 * and needs no per-frame state -- it runs on the snapshot cadence the wire
 * already has, whatever that cadence has been choked to (R-1).
 */
export const CORRECTION_SMOOTHING = 0.25;

/**
 * How many of its own ticks the client keeps. The authority acknowledges
 * within one snapshot period plus the round trip; 120 ticks is four seconds of
 * them, which covers a stall far longer than the room's own tolerance and is
 * ~5 kB of numbers.
 */
export const HISTORY_TICKS = 120;

/**
 * The predictor's side of the correction law.
 *
 *   recordTick(seq, x, y, z, yaw, pitch)  one entry per tick the local world
 *                              ran, in the order the words went on the wire;
 *                              `seq` is the wire's own sequence for that tick,
 *                              `yaw` and `pitch` the view (radians) that tick
 *                              ended on.
 *   accept({x, y, z, yaw, viewYaw, viewPitch, ack})  the authority's row for
 *                              the local player; `viewYaw` (degrees), where it
 *                              has one, is the facing the player's input
 *                              turns, which a standing soldier's body yaw is
 *                              not; `viewPitch` (degrees, up positive) the
 *                              view's pitch at the acked tick.
 *                              Returns the plan, or null when there is
 *                              nothing to do.
 *   reset()                    a respawn or a rejoin: the history describes a
 *                              body that no longer exists.
 *
 * The plan is `{x, y, z, yawDelta, pitchDelta, error, hard, replayed, acked}`:
 *   x, y, z    where the body should be put (y only on a hard set -- see below)
 *   yawDelta   radians to add to the local facing this correction
 *   pitchDelta radians to add to the local view pitch ('acked' only: the
 *              server's pitch at the acked tick against this page's at the
 *              same tick, closed whole, as the facing is)
 *   error      the measured prediction error at the acked tick, in metres
 *   hard       the error crossed the hard limit: take the position whole
 *   replayed   how many unacknowledged ticks were re-applied
 *   acked      the seq the plan was measured at (0 when unacknowledged)
 */
export function createReconciler({
  hardLimit = CORRECTION_HARD_LIMIT,
  smoothing = CORRECTION_SMOOTHING,
  historyTicks = HISTORY_TICKS,
  // 'share': pull the current facing a share of the way to the authority's
  // (the room's law). 'acked': the retail client's, which sets the whole
  // control-object state, rotation included, at the tick the server
  // acknowledged and re-runs the newer actions on top (readControlObjectState,
  // wire.md section 20): the facing error is measured against the yaw this
  // page had at that same tick, and closed in full.
  facing = 'share',
} = {}) {
  /** {seq, x, y, z, yaw} per local tick, oldest first. */
  let history = [];
  let lastAck = 0;

  const out = {};

  out.recordTick = (seq, x, y, z, yaw = null, pitch = null) => {
    if (!Number.isInteger(seq) || !Number.isFinite(x) || !Number.isFinite(z)) return;
    history.push({ seq, x, y, z, yaw: Number.isFinite(yaw) ? yaw : null, pitch: Number.isFinite(pitch) ? pitch : null });
    if (history.length > historyTicks) history.splice(0, history.length - historyTicks);
  };

  out.reset = () => { history = []; lastAck = 0; };

  /** Unacknowledged local ticks (diagnostics, and the smoke's own read). */
  out.pending = () => history.length;
  out.lastAck = () => lastAck;

  out.accept = ({ x, y, z, yaw = null, viewYaw = null, viewPitch = null, ack = 0 }, local) => {
    const serverYaw = Number.isFinite(viewYaw) ? viewYaw : yaw;
    if (!Number.isFinite(x) || !Number.isFinite(z) || !local) return null;
    if (!Number.isFinite(local.x) || !Number.isFinite(local.z)) return null;
    if (Number.isInteger(ack) && ack > lastAck) lastAck = ack;

    // The tick the authority's row describes, in the client's own ledger: the
    // newest entry it has already run. Exactly `ack` normally; the newest at
    // or below it when the authority's own receive law dropped one of the
    // client's words (the trim-to-four), which is still the last tick both
    // sides ran the same input for.
    let at = null;
    if (Number.isInteger(ack) && ack > 0) {
      let keep = 0;
      while (keep < history.length && history[keep].seq <= ack) {
        at = history[keep];
        keep++;
      }
      // The acknowledged prefix is spent either way.
      if (keep) history.splice(0, keep);
    }

    // NO ACKNOWLEDGEMENT, NO CORRECTION. Before the authority has run one of
    // this body's own words there is nothing to measure: the only difference
    // available is "where the authority had this player BEFORE it heard about
    // the deploy" against "where the prediction put him after it", and acting
    // on that teleports a freshly spawned player to wherever the room's
    // join-time spawn was -- measured at 1103 m on Aberdeen, a jump across the
    // map on the first snapshot of every spawn. The acknowledgement arrives
    // within a round trip and every correction after it is honest.
    if (!at) return null;

    // The error, where both sides have run the same words.
    const ex = x - at.x;
    const ez = z - at.z;
    const error = Math.hypot(ex, ez);
    // The replay: the local motion of the words the authority has not run
    // yet, which is the client's own recorded displacement since that tick.
    const rx = local.x - at.x;
    const rz = local.z - at.z;
    const replayed = history.length;
    // The facing at the acked tick, whole ('acked'); the newer ticks' turns
    // ride on top because the delta is added to the current yaw.
    const ackedYaw = facing === 'acked' && Number.isFinite(at.yaw)
      ? yawDeltaOf(serverYaw, at.yaw, 1) : null;
    // The view's pitch by the same law. A look the page turned that the
    // server never ran (live, Wake 2026-10-17: the page spawned 16 deg off the
    // server's level view) otherwise holds for the whole life, and every
    // round leaves the server that far from where the page aims.
    const pitchDelta = facing === 'acked' && Number.isFinite(at.pitch) && Number.isFinite(viewPitch)
      ? viewPitch * Math.PI / 180 - at.pitch : 0;

    if (error > hardLimit) {
      // A different event. Take the authority's position whole, replay on top
      // (the unacknowledged words still happened), and let the caller write y
      // as well -- a respawn or a push out of geometry moves the body in it.
      return rebase({ x: x + rx, y, z: z + rz,
                      yawDelta: ackedYaw ?? yawDeltaOf(serverYaw, local.yaw, 1), pitchDelta,
                      error, hard: true, replayed, acked: at.seq }, local);
    }
    if (error === 0 && !ackedYaw && !pitchDelta) return null;
    // Otherwise close a fraction of it. y is the local ground solver's answer
    // and is not corrected: the two heightfields agree to centimetres and a
    // y write is how a corrected body ends up underground or hanging.
    return rebase({
      x: local.x + ex * smoothing,
      y: null,
      z: local.z + ez * smoothing,
      yawDelta: ackedYaw ?? yawDeltaOf(serverYaw, local.yaw, smoothing), pitchDelta,
      error, hard: false, replayed, acked: at.seq,
    }, local);
  };

  /**
   * The other half of a rollback, and the half that is easy to forget: a
   * correction moves the body, so every UNACKNOWLEDGED tick still in the
   * ledger now describes a trajectory the body is no longer on. Shift them by
   * the same delta the body is about to be shifted by and they describe the
   * corrected one, which is what the next acknowledgement will be measured
   * against.
   *
   * Without this the same error is re-measured against the stale ledger on
   * every snapshot and re-applied in full: the correction compounds instead of
   * converging. Measured, on a 1.1 km spawn mismatch: 1103 m, 2206, 4413,
   * 8824, 17649, 35292 -- a doubling per snapshot, the body thrown off the map
   * in a couple of seconds. With it, the same first correction lands once and
   * the residual decays.
   */
  function rebase(plan, local) {
    const dx = plan.x - local.x;
    const dz = plan.z - local.z;
    const dy = Number.isFinite(plan.y) ? plan.y - local.y : 0;
    if (dx || dy || dz) {
      for (const h of history) { h.x += dx; h.y += dy; h.z += dz; }
    }
    // The facing the same way: the unacknowledged ticks were turned from the
    // old one, and the next acknowledgement is measured against them.
    if (facing === 'acked' && plan.yawDelta) {
      for (const h of history) if (h.yaw != null) h.yaw += plan.yawDelta;
    }
    if (facing === 'acked' && plan.pitchDelta) {
      for (const h of history) if (h.pitch != null) h.pitch += plan.pitchDelta;
    }
    return plan;
  }

  return out;
}

/**
 * The facing correction, in radians, wrapped to the short way round.
 *
 * The two sims turn from the same look words, so in normal play this is noise
 * and the smoothed share of it is invisible. It exists because a heading error
 * is the one divergence that grows without bound: two bodies running the same
 * forward word along headings `dTheta` apart separate at `2 v sin(dTheta/2)`,
 * so an unrepaired 17.7 deg -- what a mismatched spawn point cost -- is
 * 1.9 m/s of divergence at the 6 m/s run table. Leaving facing uncorrected is
 * what made the old handler's teleport periodic instead of one-off.
 *
 * `serverYaw` is the wire's degrees; `localYaw` the soldier's radians.
 */
export function yawDeltaOf(serverYaw, localYaw, share) {
  if (!Number.isFinite(serverYaw) || !Number.isFinite(localYaw)) return 0;
  const target = serverYaw * Math.PI / 180;
  let delta = target - localYaw;
  const turn = Math.PI * 2;
  delta -= Math.round(delta / turn) * turn;
  return delta * share;
}

// --- the driven hull --------------------------------------------------------

/**
 * The hull the local player drives, corrected the way the retail client
 * corrects it. BF1942.exe predicts its own control object every tick whatever
 * it is, and on a control-object state (readControlObjectState 0x004968a0,
 * applied at once) puts the hull at the server's state and re-runs the
 * unacknowledged actions (0x00491c90 steps the vehicle's physics through
 * performMobilePhysicsUpdate, one 1/30 s tick each). This is the soldier's
 * law for a hull: the server's pose against this page's own hull at the ACKED
 * tick, that error applied whole to the present hull (position, orientation,
 * and the velocity turned with it), the newer ticks carried on top.
 *
 * **The velocity too, when the server's is known.** readControlObjectState
 * sets the velocities with the transform; a pose with `v` (the sidecar's ack
 * row, the hull's state at the acked tick) closes the velocity error at that
 * tick on the present hull as well. Without it a hull the page's own
 * prediction drove through a static it missed kept its 12 m/s while the
 * server's stood at the wall: each ack pulled the position back, the drive
 * pushed it on, and the error rode 0.4-0.8 m for two seconds (Tobruk,
 * 2026-10-17, features/udp-sidecar/wire.md section 31).
 *
 *   record(seq, x, y, z, qx, qy, qz, qw[, vx, vy, vz])  one entry per tick sent
 *       while driving, its velocity when the caller has it
 *   reset()                                a new seat: the ledger is another hull's
 *   accept(pose, ack, state)  pose {x, y, z, q: [x, y, z, w], v?: [x, y, z]}
 *       the server's state at `ack` (or its newest pose); ack the newest word
 *       it ran; state the drive's {position, orientation, velocity} (THREE
 *       objects or plain {x, y, z(, w)}), moved in place. Returns {error,
 *       acked, speedError?} or null when there was nothing to do.
 *
 * Pure (no THREE): quaternions are plain [x, y, z, w] here, unit throughout.
 * A drive hands out orientations a hair off unit length, and the conjugate is
 * an inverse only for a unit quaternion: a delta of length 1.056 (an M3A1,
 * live) grew the velocity by its square on every correction, to Infinity in a
 * second.
 */
export function createHullReconciler({ historyTicks = HISTORY_TICKS } = {}) {
  let ticks = [];
  const out = {};
  out.record = (seq, x, y, z, qx, qy, qz, qw, vx = NaN, vy = NaN, vz = NaN) => {
    const v = [x, y, z, qx, qy, qz, qw];
    if (!Number.isInteger(seq) || !v.every(Number.isFinite)) return;
    const q = qNormalize([qx, qy, qz, qw]);
    if (!q) return;
    const vel = Number.isFinite(vx + vy + vz) ? [vx, vy, vz] : null;
    ticks.push({ seq, x, y, z, q, vel });
    if (ticks.length > historyTicks) ticks.splice(0, ticks.length - historyTicks);
  };
  out.reset = () => { ticks = []; };
  out.pending = () => ticks.length;
  out.accept = (pose, ack, state) => {
    if (!pose || !state?.position || !Number.isInteger(ack)) return null;
    let at = null, keep = 0;
    while (keep < ticks.length && ticks[keep].seq <= ack) at = ticks[keep++];
    if (keep) ticks.splice(0, keep);
    if (!at) return null;
    const dx = pose.x - at.x, dy = pose.y - at.y, dz = pose.z - at.z;
    if (!Number.isFinite(dx + dy + dz)) return null;
    const server = Array.isArray(pose.q) ? qNormalize(pose.q) : null;
    let delta = null;
    if (server && state.orientation) {
      delta = qNormalize(qMultiply(server, qConjugate(at.q)));
      if (delta) {
        const o = qNormalize(qMultiply(delta, [state.orientation.x, state.orientation.y, state.orientation.z, state.orientation.w]));
        if (o) setQ(state.orientation, o);
        if (state.velocity) setV(state.velocity, qRotate(delta, [state.velocity.x, state.velocity.y, state.velocity.z]));
        for (const h of ticks) {
          h.q = qNormalize(qMultiply(delta, h.q)) ?? h.q;
          if (h.vel) h.vel = qRotate(delta, h.vel);
        }
      }
    }
    setV(state.position, [state.position.x + dx, state.position.y + dy, state.position.z + dz]);
    for (const h of ticks) { h.x += dx; h.y += dy; h.z += dz; }
    // The velocity error at the acked tick, the page's own velocity there
    // turned as the present one was, closed whole on the present hull and
    // carried onto the newer ticks.
    let speedError;
    if (Array.isArray(pose.v) && at.vel && state.velocity && pose.v.every(Number.isFinite)) {
      const mine = delta ? qRotate(delta, at.vel) : at.vel;
      const ex = pose.v[0] - mine[0], ey = pose.v[1] - mine[1], ez = pose.v[2] - mine[2];
      setV(state.velocity, [state.velocity.x + ex, state.velocity.y + ey, state.velocity.z + ez]);
      for (const h of ticks) if (h.vel) { h.vel[0] += ex; h.vel[1] += ey; h.vel[2] += ez; }
      speedError = Math.hypot(ex, ey, ez);
    }
    return speedError === undefined ? { error: Math.hypot(dx, dz), acked: at.seq }
      : { error: Math.hypot(dx, dz), acked: at.seq, speedError };
  };
  return out;
}

function qNormalize(q) {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  return n > 1e-9 && Number.isFinite(n) ? [q[0] / n, q[1] / n, q[2] / n, q[3] / n] : null;
}
function qConjugate(q) { return [-q[0], -q[1], -q[2], q[3]]; }
function qMultiply(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
function qRotate(q, v) {
  const r = qMultiply(qMultiply(q, [v[0], v[1], v[2], 0]), qConjugate(q));
  return [r[0], r[1], r[2]];
}
function setQ(o, q) { if (typeof o.set === 'function') o.set(q[0], q[1], q[2], q[3]); else { o.x = q[0]; o.y = q[1]; o.z = q[2]; o.w = q[3]; } }
function setV(o, v) { if (typeof o.set === 'function') o.set(v[0], v[1], v[2]); else { o.x = v[0]; o.y = v[1]; o.z = v[2]; } }
