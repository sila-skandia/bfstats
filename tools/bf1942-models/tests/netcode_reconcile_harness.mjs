// `viewer/netcode-reconcile.js` under node: P4's correction law, and the
// snap-back defect it was written for.
//
// One node run, many scenarios, one JSON blob out — the pattern of
// `netcode_client_harness.mjs`. The module is pure (no three, no DOM), so the
// python side copies it alone.
//
// The scenarios are the laws:
//   a  the acknowledgement is what makes the comparison honest — the error is
//      measured at the acked tick, not against the client's present position,
//      so input latency is not read as error
//   b  the unacknowledged ticks are replayed on top of the correction
//   c  no acknowledgement, no correction (the spawn-time teleport)
//   d  a standing error decays instead of accumulating (the smoothing law)
//   e  THE REGRESSION: a correction re-bases the ledger, so it converges
//      instead of compounding
//   f  the hard limit is a different event, and it keeps the replay
//   g  facing is corrected too — an unrepaired heading error is the one
//      divergence that grows without bound
//   h  a dropped word (the authority's trim-to-four) still finds a tick both
//      sides ran, and the ledger is bounded

import {
  createReconciler, yawDeltaOf,
  CORRECTION_HARD_LIMIT, CORRECTION_SMOOTHING, HISTORY_TICKS,
} from './netcode-reconcile.mjs';

const results = {};

/** A walker: one tick of 0.2 m along +z per word, as the 6 m/s run table is. */
function walk(r, from, ticks, startSeq = 1) {
  let { x, y, z } = from;
  for (let i = 0; i < ticks; i++) {
    z += 0.2;
    r.recordTick(startSeq + i, x, y, z);
  }
  return { x, y, z };
}

// --- (a) the error is measured at the acked tick -----------------------------
{
  const r = createReconciler();
  // Ten ticks walked; the authority has run five of them and agrees exactly
  // about where the body was at tick 5. There is NO error — only 1 m of
  // latency — and the old handler's comparison would have called it 1 m.
  const at5 = { x: 0, y: 0, z: 1.0 };
  const now = walk(r, { x: 0, y: 0, z: 0 }, 10);
  const plan = r.accept({ x: at5.x, y: at5.y, z: at5.z, yaw: 0, ack: 5 },
    { x: now.x, y: now.y, z: now.z, yaw: 0 });
  results.a = {
    latency: +(now.z - at5.z).toFixed(4),
    plan,
    nakedComparison: +Math.hypot(at5.x - now.x, at5.z - now.z).toFixed(4),
  };
}

// --- (b) the replay rides on top of an accepted correction -------------------
{
  const r = createReconciler();
  const now = walk(r, { x: 0, y: 0, z: 0 }, 10);
  // The authority puts the body 5 m to the +x side at tick 5: past the hard
  // limit, so a different event, taken whole.
  const plan = r.accept({ x: 5, y: 0, z: 1.0, yaw: 0, ack: 5 },
    { x: 0, y: 0, z: now.z, yaw: 0 });
  results.b = {
    plan,
    // The five unacknowledged ticks are 1 m of +z, kept on top of the
    // authority's own z.
    replayedZ: +(plan.z - 1.0).toFixed(4),
    pending: r.pending(),
  };
}

// --- (c) no acknowledgement, no correction ----------------------------------
{
  const r = createReconciler();
  const now = walk(r, { x: 0, y: 0, z: 0 }, 10);
  results.c = {
    // The room's join-time spawn, a kilometre from where the deploy row put
    // the prediction: before the authority has run one of this body's words
    // there is nothing to measure.
    noAck: r.accept({ x: 905, y: 93, z: -913, yaw: 0, ack: 0 },
      { x: now.x, y: now.y, z: now.z, yaw: 0 }),
    pending: r.pending(),
  };
  // An ack naming a tick older than everything in the ledger is the same
  // situation: the page respawned, the ledger was reset, and the authority is
  // still acknowledging the words of the body that no longer exists.
  const after = createReconciler();
  walk(after, { x: 0, y: 0, z: 0 }, 5, 100);
  results.c.staleAck = after.accept({ x: 905, y: 93, z: -913, yaw: 0, ack: 7 },
    { x: 0, y: 0, z: 1, yaw: 0 });
  results.c.stalePending = after.pending();
}

// --- (d) a standing error decays --------------------------------------------
{
  const r = createReconciler();
  // Two bodies a metre apart in x, both walking +z: the authority acks every
  // tick, so the error is pure and standing. Each accepted snapshot closes
  // `CORRECTION_SMOOTHING` of what is left.
  let local = { x: 1, y: 0, z: 0, yaw: 0 };
  const errors = [];
  let seq = 0;
  // Three ticks in flight before the first snapshot, so every snapshot's ack
  // names a tick the ledger holds (the steady state; scenario (c) covers the
  // spawn, where it does not).
  for (let i = 0; i < 3; i++) {
    seq++;
    local = { ...local, z: local.z + 0.2 };
    r.recordTick(seq, local.x, local.y, local.z);
  }
  for (let snap = 0; snap < 12; snap++) {
    // three ticks between snapshots (30 Hz sim, 10 Hz here for a short trace)
    for (let i = 0; i < 3; i++) {
      seq++;
      local = { ...local, z: local.z + 0.2 };
      r.recordTick(seq, local.x, local.y, local.z);
    }
    const authority = { x: 0, y: 0, z: local.z - 0.6, yaw: 0, ack: seq - 3 };
    const plan = r.accept(authority, local);
    if (plan) {
      errors.push(+plan.error.toFixed(5));
      local = { ...local, x: plan.x, z: plan.z };
    } else {
      errors.push(0);
    }
  }
  results.d = { errors, smoothing: CORRECTION_SMOOTHING, finalX: +local.x.toFixed(5) };
}

// --- (e) THE REGRESSION: a correction re-bases the ledger --------------------
{
  // Without the re-base the same error is re-measured against the stale ledger
  // on every snapshot and re-applied in full: the correction DOUBLES each time
  // (measured live at 1103 m, 2206, 4413, 8824, 17649, 35292 before the fix).
  const r = createReconciler();
  let local = { x: 0, y: 0, z: 0, yaw: 0 };
  let seq = 0;
  const errors = [];
  const xs = [];
  for (let i = 0; i < 3; i++) {
    seq++;
    local = { ...local, z: local.z + 0.2 };
    r.recordTick(seq, local.x, local.y, local.z);
  }
  for (let snap = 0; snap < 8; snap++) {
    for (let i = 0; i < 3; i++) {
      seq++;
      local = { ...local, z: local.z + 0.2 };
      r.recordTick(seq, local.x, local.y, local.z);
    }
    // The authority is a fixed 10 m off in x — a hard event, once.
    const plan = r.accept({ x: 10, y: 0, z: local.z - 0.6, yaw: 0, ack: seq - 3 },
      local);
    if (plan) {
      errors.push(+plan.error.toFixed(4));
      local = { ...local, x: plan.x, z: plan.z };
    }
    xs.push(+local.x.toFixed(4));
  }
  results.e = { errors, xs };
}

// --- (f) the hard limit is a different event --------------------------------
{
  const r = createReconciler();
  const now = walk(r, { x: 0, y: 0, z: 0 }, 6);
  const soft = createReconciler();
  walk(soft, { x: 0, y: 0, z: 0 }, 6);
  results.f = {
    hardLimit: CORRECTION_HARD_LIMIT,
    // just inside: smoothed, and y is left to the local ground solver
    inside: soft.accept({ x: CORRECTION_HARD_LIMIT - 0.5, y: 999, z: 0.2, yaw: 0, ack: 1 },
      { x: 0, y: 0, z: now.z, yaw: 0 }),
    // just outside: taken whole, y included
    outside: r.accept({ x: CORRECTION_HARD_LIMIT + 0.5, y: 999, z: 0.2, yaw: 0, ack: 1 },
      { x: 0, y: 0, z: now.z, yaw: 0 }),
  };
}

// --- (g) facing ------------------------------------------------------------
{
  const deg = 17.719;                       // the measured spawn-point gap
  results.g = {
    // The wire's degrees against the soldier's radians, at the smoothing share
    share: +yawDeltaOf(deg, 0, CORRECTION_SMOOTHING).toFixed(8),
    whole: +yawDeltaOf(deg, 0, 1).toFixed(8),
    expected: +(deg * Math.PI / 180).toFixed(8),
    // the short way round: 350 deg against 10 deg is -20 deg, not +340
    shortWay: +(yawDeltaOf(350, 10 * Math.PI / 180, 1) * 180 / Math.PI).toFixed(5),
    // a seated player's NaN facing turns nobody
    nan: yawDeltaOf(NaN, 0, 1),
    // and the splay a 17.719 deg error costs at the 6 m/s run table
    splayPerSecond: +(2 * 5.998 * Math.sin(deg * Math.PI / 180 / 2)).toFixed(4),
  };
}

// --- (h) a dropped word, and the ledger's bound -----------------------------
{
  const r = createReconciler();
  const now = walk(r, { x: 0, y: 0, z: 0 }, 10);
  // The authority's trim dropped seq 6; it acks 6 all the same. The newest
  // tick at or below it is 6's neighbour, which both sides did run.
  const plan = r.accept({ x: 0.5, y: 0, z: 1.2, yaw: 0, ack: 6 },
    { x: now.x, y: now.y, z: now.z, yaw: 0 });
  const bounded = createReconciler({ historyTicks: 8 });
  walk(bounded, { x: 0, y: 0, z: 0 }, 40);
  results.h = {
    acked: plan?.acked ?? null,
    pending: r.pending(),
    boundedTicks: bounded.pending(),
    historyTicks: HISTORY_TICKS,
  };
}

// --- (i) a reset forgets a body that no longer exists ------------------------
{
  const r = createReconciler();
  walk(r, { x: 0, y: 0, z: 0 }, 10);
  r.reset();
  results.i = {
    pending: r.pending(),
    lastAck: r.lastAck(),
    // Nothing to measure against, so nothing happens — the respawn's own
    // position is the page's, not a correction's.
    plan: r.accept({ x: 100, y: 0, z: 100, yaw: 0, ack: 8 },
      { x: 0, y: 0, z: 2, yaw: 0 }),
  };
}

process.stdout.write(JSON.stringify(results));
