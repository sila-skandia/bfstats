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
 *   recordTick(seq, x, y, z)   one entry per tick the local world ran, in the
 *                              order the words went on the wire; `seq` is the
 *                              wire's own sequence for that tick.
 *   accept({x, y, z, yaw, ack})  the authority's row for the local player.
 *                              Returns the plan, or null when there is
 *                              nothing to do.
 *   reset()                    a respawn or a rejoin: the history describes a
 *                              body that no longer exists.
 *
 * The plan is `{x, y, z, yawDelta, error, hard, replayed, acked}`:
 *   x, y, z    where the body should be put (y only on a hard set -- see below)
 *   yawDelta   radians to add to the local facing this correction
 *   error      the measured prediction error at the acked tick, in metres
 *   hard       the error crossed the hard limit: take the position whole
 *   replayed   how many unacknowledged ticks were re-applied
 *   acked      the seq the plan was measured at (0 when unacknowledged)
 */
export function createReconciler({
  hardLimit = CORRECTION_HARD_LIMIT,
  smoothing = CORRECTION_SMOOTHING,
  historyTicks = HISTORY_TICKS,
} = {}) {
  /** {seq, x, y, z} per local tick, oldest first. */
  let history = [];
  let lastAck = 0;

  const out = {};

  out.recordTick = (seq, x, y, z) => {
    if (!Number.isInteger(seq)) return;
    history.push({ seq, x, y, z });
    if (history.length > historyTicks) history.splice(0, history.length - historyTicks);
  };

  out.reset = () => { history = []; lastAck = 0; };

  /** Unacknowledged local ticks (diagnostics, and the smoke's own read). */
  out.pending = () => history.length;
  out.lastAck = () => lastAck;

  out.accept = ({ x, y, z, yaw = null, ack = 0 }, local) => {
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

    if (error > hardLimit) {
      // A different event. Take the authority's position whole, replay on top
      // (the unacknowledged words still happened), and let the caller write y
      // as well -- a respawn or a push out of geometry moves the body in it.
      return rebase({ x: x + rx, y, z: z + rz,
                      yawDelta: yawDeltaOf(yaw, local.yaw, 1),
                      error, hard: true, replayed, acked: at.seq }, local);
    }
    if (error === 0) return null;
    // Otherwise close a fraction of it. y is the local ground solver's answer
    // and is not corrected: the two heightfields agree to centimetres and a
    // y write is how a corrected body ends up underground or hanging.
    return rebase({
      x: local.x + ex * smoothing,
      y: null,
      z: local.z + ez * smoothing,
      yawDelta: yawDeltaOf(yaw, local.yaw, smoothing),
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
