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
  createAimReconciler, createHullReconciler, createReconciler, yawDeltaOf,
  CORRECTION_HARD_LIMIT, CORRECTION_SMOOTHING, CORRECTION_Y_TOLERANCE, HISTORY_TICKS,
} from './netcode-reconcile.mjs';
import { soldierYawStep } from './mouse-input.js';

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

// --- (j2) the view's pitch, the same law --------------------------------------
// A page that spawned 16 degrees off the server's level view (Wake,
// 2026-10-17) and then looked down 2 degrees a tick: at the acked tick the
// server's pitch is the page's minus 16, closed whole; the ledger is rebased,
// so the next ack agrees; a row with no pitch, or the room's law, leaves it.
{
  const rad = Math.PI / 180;
  const r = createReconciler({ smoothing: 1, facing: 'acked' });
  for (let i = 1; i <= 6; i++) r.recordTick(i, 0, 0, 0, 0, (16 - 2 * i) * rad);
  const local = { x: 0, y: 0, z: 0, yaw: 0 };
  const first = r.accept({ x: 0, y: 0, z: 0, yaw: 0, viewPitch: -6, ack: 3 }, local);
  const next = r.accept({ x: 0, y: 0, z: 0, yaw: 0, viewPitch: -10, ack: 5 }, local);
  const none = createReconciler({ smoothing: 1, facing: 'acked' });
  for (let i = 1; i <= 3; i++) none.recordTick(i, 0, 0, 0, 0, 0.1);
  const noPitch = none.accept({ x: 0, y: 0, z: 0.5, yaw: 0, ack: 2 }, local);
  const share = createReconciler();
  for (let i = 1; i <= 3; i++) share.recordTick(i, 0, 0, 0, 0, 0.1);
  const room = share.accept({ x: 0, y: 0, z: 0.5, yaw: 0, viewPitch: -20, ack: 2 }, local);
  results.j2 = {
    first: +(first.pitchDelta / rad).toFixed(6),
    next: next ? +(next.pitchDelta / rad).toFixed(6) : null,
    noPitch: noPitch ? noPitch.pitchDelta : null,
    room: room ? room.pitchDelta : null,
  };
}

// --- (k) the driven hull, the same law ---------------------------------------
{
  const yawQ = (deg) => { const h = deg * Math.PI / 360; return [0, Math.sin(h), 0, Math.cos(h)]; };
  // A hull driving +x at 0.4 m a tick; the server agrees about every tick it
  // ran. The page is three ticks ahead: no correction is error, only latency.
  const hr = createHullReconciler();
  for (let s = 1; s <= 10; s++) hr.record(s, 0.4 * s, 0, 0, ...yawQ(0));
  const state = { position: { x: 4.0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 }, velocity: { x: 12, y: 0, z: 0 } };
  const agree = hr.accept({ x: 2.8, y: 0, z: 0, q: yawQ(0) }, 7, state);
  // The server's hull at tick 9 is 0.5 m further and turned 10 degrees: the
  // whole of it lands on the present hull and the one newer tick.
  const off = hr.accept({ x: 4.1, y: 0, z: 0, q: yawQ(10) }, 9, state);
  const afterOff = { x: state.position.x, yaw: 2 * Math.atan2(state.orientation.y, state.orientation.w) * 180 / Math.PI,
    speed: Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z) };
  // Tick 10 was rebased with it, so a server that kept the corrected hull agrees.
  const rebased = hr.accept({ x: 4.5, y: 0, z: 0, q: yawQ(10) }, 10, state);
  // Recorded orientations a hair off unit length (a drive's own, live: 1.056)
  // must not grow the velocity: 200 corrections later it is the same speed.
  const grow = createHullReconciler();
  const g = { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0.89, z: 0, w: 0.569 }, velocity: { x: 10, y: 0, z: 0 } };
  for (let s = 1; s <= 200; s++) {
    grow.record(s, 0, 0, 0, 0, 0.89, 0, 0.569);
    grow.accept({ x: 0, y: 0, z: 0, q: [0, 0.843, 0, 0.539] }, s, g);
  }
  results.k = {
    agree: agree && +agree.error.toFixed(6),
    off: off && +off.error.toFixed(6),
    afterOff: { x: +afterOff.x.toFixed(6), yaw: +afterOff.yaw.toFixed(4), speed: +afterOff.speed.toFixed(6) },
    rebased: rebased && +rebased.error.toFixed(6),
    pending: hr.pending(),
    grownSpeed: +Math.hypot(g.velocity.x, g.velocity.y, g.velocity.z).toFixed(6),
    finite: [g.position.x, g.orientation.y, g.velocity.x].every(Number.isFinite),
  };
}

// --- (l) the driven hull's velocity, when the ack carries it -------------------
{
  const yawQ0 = [0, 0, 0, 1];
  // The page drove on at 12 m/s through a static its own probe missed; the
  // server's hull stopped at the wall at tick 5 (Tobruk, 2026-10-17). The ack
  // for tick 7 says: here, at rest. The present hull (tick 10) is put back by
  // the position error AND loses the 12 m/s it should not have.
  const hr = createHullReconciler();
  for (let s = 1; s <= 10; s++) hr.record(s, 0.4 * s, 0, 0, ...yawQ0, 12, 0, 0);
  const state = { position: { x: 4.0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 }, velocity: { x: 12, y: 0, z: 0 } };
  const wall = hr.accept({ x: 2.0, y: 0, z: 0, q: yawQ0, v: [0, 0, 0] }, 7, state);
  const after = { x: state.position.x, vx: state.velocity.x };
  // Agreeing velocity: nothing moves.
  const again = createHullReconciler();
  for (let s = 1; s <= 10; s++) again.record(s, 0.4 * s, 0, 0, ...yawQ0, 12, 0, 0);
  const st2 = { position: { x: 4.0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 }, velocity: { x: 12, y: 0, z: 0 } };
  const agree = again.accept({ x: 2.8, y: 0, z: 0, q: yawQ0, v: [12, 0, 0] }, 7, st2);
  // An older ack row (no `v`) leaves the velocity alone, as before.
  const old = createHullReconciler();
  for (let s = 1; s <= 10; s++) old.record(s, 0.4 * s, 0, 0, ...yawQ0, 12, 0, 0);
  const st3 = { position: { x: 4.0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 }, velocity: { x: 12, y: 0, z: 0 } };
  old.accept({ x: 2.0, y: 0, z: 0, q: yawQ0 }, 7, st3);
  results.l = {
    wall: wall && { error: +wall.error.toFixed(6), speedError: +wall.speedError.toFixed(6) },
    after: { x: +after.x.toFixed(6), vx: +after.vx.toFixed(6) },
    agree: agree && { error: +agree.error.toFixed(6), speedError: +agree.speedError.toFixed(6), vx: st2.velocity.x },
    oldVx: st3.velocity.x,
  };
}

{
  // m: one accept reports the divergence decomposed -- horizontal position,
  // vertical, orientation angle and speed, each on its own -- so a live drive
  // says which integrator term is adrift, not merely that one is.
  const hr = createHullReconciler();
  for (let s = 1; s <= 5; s++) hr.record(s, s, 0, 0, 0, 0, 0, 1, 0, 0, 0);
  const state = { position: { x: 5, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 }, velocity: { x: 0, y: 0, z: 0 } };
  // Server at the acked tick (5): 3 m across, 2 m up, yawed 90 deg, 4 m/s off.
  const d = hr.accept({ x: 5, y: 2, z: 3, q: [0, 0, Math.SQRT1_2, Math.SQRT1_2], v: [4, 0, 0] }, 5, state);
  results.m = d && {
    error: +d.error.toFixed(4), errorY: +d.errorY.toFixed(4),
    oriError: +d.oriError.toFixed(4), speedError: +d.speedError.toFixed(4),
  };
}


{
  // n: the seated player's own turret (wire.md section 35). A traverse of
  // 1.5 deg a tick; the ack for tick 4 arrives with the page at tick 10. The
  // server agrees with the page's tick-4 angle, so nothing moves: the old law
  // pulled the present angle (15) 30% of the way back to 6. A real error at
  // the acked tick is closed whole and carried onto the newer ticks, so the
  // next ack agreeing with the corrected path moves nothing; a repeated or
  // older ack does nothing; a wrap is the short way; an axis the server says
  // nothing about is left alone.
  const ar = createAimReconciler();
  for (let s = 1; s <= 10; s++) ar.record(s, [1.5 * s, 2]);
  const agree = ar.accept(4, [6, null]);
  const err = ar.accept(5, [7, 2.5]);           // page had 7.5 and 2 at tick 5
  const after = ar.accept(8, [11.5, 2.5]);      // tick 8: 12 - 0.5, 2 + 0.5
  const repeat = ar.accept(8, [0, 0]);
  const wrap = createAimReconciler();
  wrap.record(1, [179]);
  results.n = { agree, err, after, repeat, wrap: wrap.accept(1, [-179]) };
}

{
  // o: a PAN is smooth, and its smoothness is the acked-tick law's, not the
  // frame rate's. The retail client turns the view 3 x axis degrees a tick
  // (`BFSoldier::handlePlayerInput` 0x08273c45), so a steady hand must be
  // drawn as a steady rotation: no ack may step the view back, and the only
  // step allowed is the wire's own 12-bit quantisation of the axis
  // (floatToFixed, 0.01 on a +-16 channel). A page at 30 Hz, acks at 20 Hz
  // and two ticks behind, one turn a second (axis 3.7), the authority
  // integrating the axis it actually received.
  //
  // What this pins: the yaw step an ack applies, the count of backward steps,
  // and the turns the pan covered. Before the acked-tick law (wire.md section
  // 20) the same pan was corrected against the PRESENT yaw, so every ack
  // subtracted a round trip of turn and the view walked backwards at 20 Hz.
  const wireAxis = (v) => {
    const clamp = Math.max(-1, Math.min(1, v / 16));
    const n = Math.round(4095 * (clamp + 1) * 0.5);
    return Math.round((((2 * n) / 4095) - 1) * 16 * 100) / 100;
  };
  const pr = createReconciler({ smoothing: 1, facing: 'acked' });
  const AXIS = 3.714;               // channel units; 11.14 deg a tick standing
  // (not a hundredth, so the wire's 0.01 snap really is exercised)
  const served = wireAxis(AXIS);    // what the authority integrates
  const RAD = Math.PI / 180;
  let pageYaw = 0, seq = 1;
  const deltas = [];
  for (let tick = 1; tick <= 30 * 6; tick++) {   // 6 s of ticks
    pageYaw += 3 * AXIS * RAD;
    const s = seq++;
    pr.recordTick(s, 0, 0, 0, pageYaw);
    // Acks at 20 Hz: two of every three ticks, each naming the tick the
    // authority has run by then (two behind).
    if (tick > 3 && tick % 3 !== 0) {
      const ack = s - 2;
      const plan = pr.accept({
        x: 0, y: 0, z: 0, yaw: 0,
        viewYaw: 3 * served * ack, ack,
      }, { x: 0, y: 0, z: 0, yaw: pageYaw });
      if (plan) { deltas.push(plan.yawDelta); pageYaw += plan.yawDelta; }
    }
  }
  const deg = (r) => Math.abs(r) * 180 / Math.PI;
  results.o = {
    ackedAxis: served,
    acks: deltas.length,
    maxStepDeg: +Math.max(...deltas.map(deg)).toFixed(4),
    backwards: deltas.filter((d) => deg(d) > 0.001 && d * served < 0).length,
    turns: +(pageYaw / (2 * Math.PI)).toFixed(3),
    expectedTurns: +(3 * AXIS * 30 * 6 / 360).toFixed(3),
  };
}

{
  // p: a facing RESIDUE settles instead of snapping. `yawShare` is how much of
  // the acked facing error one ack closes; with the whole of it (the room's
  // law) a four degree residue is one frame of camera snap, which is what the
  // owner saw at the end of every pan (2026-10-21). With a share it takes a
  // few acks, monotonically, and never overshoots.
  const RAD = Math.PI / 180;
  const run = (yawShare) => {
    const r = createReconciler({ smoothing: 1, facing: 'acked', yawShare });
    let yaw = 0;
    const left = [];
    for (let s = 1; s <= 10; s++) {
      r.recordTick(s, 0, 0, 0, yaw);
      // The authority stands ten degrees off and never moves.
      const plan = r.accept({ x: 0, y: 0, z: 0, yaw: 0, viewYaw: 10, ack: s },
                            { x: 0, y: 0, z: 0, yaw });
      if (plan) yaw += plan.yawDelta;
      left.push(+(((10 * RAD) - yaw) / RAD).toFixed(3));
    }
    return left;
  };
  const eased = run(0.5);
  const whole = run(1);
  results.p = {
    eased, whole,
    overshoot: eased.some((e) => e < -0.001),
    settledBy: eased.findIndex((e) => Math.abs(e) < 0.05),
  };
}

{
  // q: THE TWIST REPLAY. The server turns the soldier by the engine's yaw law
  // (soldierYawStep: the torso twist winds to its -14/+20 clamp, the body
  // turns past it, a move folds it back). The page runs the same law, so with
  // the same starting state every acknowledgement must ask for no turn at
  // all, across clamp crossings and folds; and from a wrong starting twist the
  // first acknowledgement must put the page exactly on the server's path,
  // after which it stays there. Acks at 20 Hz, two ticks behind.
  const DEG = Math.PI / 180;
  const words = [];
  for (let i = 0; i < 30; i++) words.push({ d: 1.0, moving: false });   // a standing pan past the clamp
  for (let i = 0; i < 10; i++) words.push({ d: 1.0, moving: true });    // walk on, still turning
  for (let i = 0; i < 20; i++) words.push({ d: -2.5, moving: false });  // a fast pan back, crossing the other clamp
  for (let i = 0; i < 5; i++) words.push({ d: 0, moving: true });       // a press with the twist on its clamp
  for (let i = 0; i < 20; i++) words.push({ d: 1.5, moving: false });
  const run = (pageTwist0) => {
    const r = createReconciler({ smoothing: 1, facing: 'acked' });
    const srv = { twist: 0, view: 0 };          // engine degrees
    const page = { twist: pageTwist0, yaw: 0 }; // page radians
    const served = [];                          // the server's state after each tick
    const steps = [];
    const after = [];
    let seq = 0;
    for (const w of words) {
      seq++;
      const s = soldierYawStep(srv.twist, w.d, w.moving);
      srv.twist = s.twist; srv.view += s.view;
      served[seq] = { twist: srv.twist, view: srv.view };
      const p = soldierYawStep(page.twist, w.d, w.moving);
      page.twist = p.twist; page.yaw -= p.view * DEG;
      r.recordTick(seq, 0, 0, 0, page.yaw, null, { twist: page.twist, d: w.d, moving: w.moving });
      if (seq > 3 && seq % 3 !== 0) {
        const ack = seq - 2;
        const plan = r.accept({ x: 0, y: 0, z: 0, yaw: 0, viewYaw: -served[ack].view,
          twist: served[ack].twist, ack }, { x: 0, y: 0, z: 0, yaw: page.yaw });
        if (plan) {
          steps.push(Math.abs(plan.yawDelta) / DEG);
          page.yaw += plan.yawDelta;
          if (Number.isFinite(plan.twist)) page.twist = plan.twist;
        } else steps.push(0);
        after.push(Math.abs(((page.yaw / DEG) + srv.view + 540) % 360 - 180));
      }
    }
    return { maxStep: +Math.max(...steps).toFixed(6), firstStep: +steps[0].toFixed(4),
      laterMaxStep: +Math.max(...steps.slice(1)).toFixed(6),
      endError: +after[after.length - 1].toFixed(6), endTwistError: +Math.abs(page.twist - srv.twist).toFixed(6) };
  };
  results.q = { same: run(0), wrongTwist: run(8) };
}

// --- (r) the height: taken past the tolerance, left alone under it ----------
// A body the page dropped under a deck (the Enterprise's glb landed late) while
// the server walks him across it: the page's ground solver kept him below, and
// the reconciler, x and z only, left him there for good (Midway, 2026-10-24).
{
  const sidecar = () => createReconciler({ smoothing: 1, facing: 'acked', yTolerance: CORRECTION_Y_TOLERANCE });
  // Under the deck: the page fell to 2 m and is still falling; the server has
  // him on the deck at 32.2 at every acked tick.
  const under = sidecar();
  let y = 2.0;
  for (let seq = 1; seq <= 8; seq++) { y -= 0.1; under.recordTick(seq, 0, y, seq * 0.2); }
  const plan = under.accept({ x: 0, y: 32.2, z: 1.0, yaw: 0, ack: 5 }, { x: 0, y, z: 1.6, yaw: 0 });
  // The ledger is rebased onto the server's surface: the next ack, which the
  // server has at the same height, asks for nothing more vertical.
  const followY = plan.y;
  for (let seq = 9; seq <= 10; seq++) under.recordTick(seq, 0, followY, seq * 0.2);
  const next = under.accept({ x: 0, y: 32.2, z: 1.8, yaw: 0, ack: 9 }, { x: 0, y: followY, z: 2.0, yaw: 0 });
  // On terrain: the ground law's millimetres are never written.
  const ground = sidecar();
  for (let seq = 1; seq <= 8; seq++) ground.recordTick(seq, 0, 10 + seq * 0.001, seq * 0.2);
  const groundPlan = ground.accept({ x: 0, y: 10.0052, z: 1.01, yaw: 0, ack: 5 }, { x: 0, y: 10.008, z: 1.6, yaw: 0 });
  // The room's law (no tolerance) never takes it.
  const room = createReconciler();
  for (let seq = 1; seq <= 8; seq++) room.recordTick(seq, 0, 2 - seq * 0.1, seq * 0.2);
  const roomPlan = room.accept({ x: 0, y: 32.2, z: 1.01, yaw: 0, ack: 5 }, { x: 0, y: 1.2, z: 1.6, yaw: 0 });
  results.r = {
    tolerance: CORRECTION_Y_TOLERANCE,
    under: { y: plan.y, yTaken: plan.yTaken, yError: +plan.yError.toFixed(4), hard: plan.hard, x: plan.x, z: plan.z },
    next: next ? { yTaken: next.yTaken, yError: +next.yError.toFixed(4) } : null,
    ground: groundPlan ? { y: groundPlan.y, yTaken: groundPlan.yTaken, yError: +groundPlan.yError.toFixed(4) } : null,
    room: roomPlan ? { y: roomPlan.y, yTaken: roomPlan.yTaken } : null,
  };
}

process.stdout.write(JSON.stringify(results));

