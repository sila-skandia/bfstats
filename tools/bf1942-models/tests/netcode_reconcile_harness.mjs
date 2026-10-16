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

// --- (j) the retail client's facing law ('acked') ---------------------------
// The facing error is measured against the yaw the page had at the ACKED tick
// and closed whole; the newer ticks' turns ride on top, and the ledger's yaws
// are rebased so the next acknowledgement is not the same error again.
{
  const rad = Math.PI / 180;
  const r = createReconciler({ smoothing: 1, facing: 'acked' });
  // Ten ticks turning 3 degrees a tick from 0, walking +z.
  for (let i = 1; i <= 10; i++) r.recordTick(i, 0, 0, 0.2 * i, 3 * i * rad);
  const local = { x: 0, y: 0, z: 2.0, yaw: 30 * rad };
  // The server ran tick 5 at 15 degrees, as the page did: no facing error,
  // although its yaw is 15 degrees behind the page's present one.
  const agree = r.accept({ x: 0, y: 0, z: 1.0, yaw: 15, ack: 5 }, local);
  // The server's view at tick 7 is 48 degrees round from the page's (21): the
  // whole of it, whatever the page has turned since.
  const off = r.accept({ x: 0, y: 0, z: 1.4, yaw: 69, ack: 7 }, local);
  // The ledger's tick 9 was turned from the old facing: rebased, it now
  // agrees with a server that kept the corrected heading.
  const after = r.accept({ x: 0, y: 0, z: 1.8, yaw: 75, ack: 9 }, local);
  // A standing soldier's view is not his body yaw: viewYaw wins when given.
  const view = createReconciler({ smoothing: 1, facing: 'acked' });
  for (let i = 1; i <= 3; i++) view.recordTick(i, 0, 0, 0, 0);
  const standing = view.accept({ x: 0, y: 0, z: 0, yaw: -42, viewYaw: 0, ack: 2 }, { x: 0, y: 0, z: 0, yaw: 0 });
  // The room's law is unchanged: a share of the error against the present.
  const share = createReconciler();
  for (let i = 1; i <= 3; i++) share.recordTick(i, 0, 0, 0, 0);
  const room = share.accept({ x: 0, y: 0, z: 0.01, yaw: 20, ack: 2 }, { x: 0, y: 0, z: 0, yaw: 0 });
  results.j = {
    agree: agree ? +(agree.yawDelta / rad).toFixed(6) : null,
    off: +(off.yawDelta / rad).toFixed(6),
    after: after ? +(after.yawDelta / rad).toFixed(6) : null,
    standing: standing ? +(standing.yawDelta / rad).toFixed(6) : null,
    room: +(room.yawDelta / rad).toFixed(6),
  };
}

process.stdout.write(JSON.stringify(results));
