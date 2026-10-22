// The clock a sidecar page draws remotes by, under node (`net-sidecar.js`).
//
// The retail client draws every networkable it does not control at its own
// game time less interpolationTime, and its game time is the newest ghost
// block's server tick plus one tick per action in flight
// (GameClient::predictAll 0x00491f00, the clock reset at 0x00491c90). The page
// now does the same (`clientClockLead`), eases it (`followLead`, `slewLead`)
// and draws hulls past their newest sample through `createRemoteBlend`.
//
//   lead      clientClockLead's arithmetic, followLead's filter and jump,
//             slewLead's rate limit
//   quat      extrapolateQ carries a pair's turn on
//   blend     a track whose velocity changes at a new sample is drawn without
//             a step or a kink, and converges on the raw extrapolation
//   client    end to end: samples at 30 Hz ticks, words sent, an ack with its
//             tick; the drawn time is (tick + words in flight) / 30 - 0.1, and
//             with remoteClock 'lookback' the old newest-sample - 0.1
//   joints    a turret's turn carries on past its newest sample
import {
  createSidecarClient, clientClockLead, followLead, slewLead, extrapolateQ,
  createRemoteBlend, LEAD_SHARE, LEAD_RATE, RENDER_LOOKBACK_S,
} from './net-sidecar.mjs';

const results = {};

// --- lead ----------------------------------------------------------------
{
  const a = clientClockLead({ tick: 900, acked: 100, sent: 104, serverNow: 30.0 });
  const noTick = clientClockLead({ tick: null, acked: 100, sent: 104, serverNow: 30 });
  const ahead = clientClockLead({ tick: 900, acked: 104, sent: 100, serverNow: 30.0 });
  const first = followLead(null, 0.12);
  const eased = followLead(0.12, 0.16);
  const jump = followLead(0.12, 0.6);
  const capped = followLead(null, 5);
  const ignored = followLead(0.12, null);
  // 60 fps for one second toward a target 0.1 s away: at most LEAD_RATE moved.
  let d = 0.1;
  for (let i = 0; i < 60; i++) d = slewLead(d, 0.2, 1 / 60);
  results.lead = { a, noTick, ahead, first, eased, jump, capped, ignored, slewed: d,
                   share: LEAD_SHARE, rate: LEAD_RATE, slewJump: slewLead(0.1, 0.6, 0.01) };
}

// --- quat ----------------------------------------------------------------
{
  const yq = (deg) => [0, Math.sin(deg * Math.PI / 360), 0, Math.cos(deg * Math.PI / 360)];
  const yawOf = (q) => 2 * Math.atan2(q[1], q[3]) * 180 / Math.PI;
  results.quat = {
    half: yawOf(extrapolateQ(yq(10), yq(20), 0.5)),
    two: yawOf(extrapolateQ(yq(10), yq(20), 2)),
    flip: yawOf(extrapolateQ(yq(0), yq(170), 1)),
  };
}

// --- blend ---------------------------------------------------------------
{
  // A plane at 50 m/s along x; at t = 1.0 a new sample says it has turned:
  // the raw extrapolation now runs 50 m/s along x plus 5 m/s along z, from a
  // point 0.04 m off the old line.
  const b = createRemoteBlend();
  const oldTrack = (t) => ({ x: 50 * t, y: 100, z: 0, q: [0, 0, 0, 1] });
  const newTrack = (t) => ({ x: 50 * t, y: 100, z: 0.04 + 5 * (t - 1), q: [0, 0, 0, 1] });
  const frames = [];
  for (let i = 0; i <= 120; i++) {
    const t = 0.5 + i / 120;              // 120 fps across the switch
    const key = t < 1.0 ? 'a' : 'b';
    frames.push({ t, ...b.draw(key, t, key === 'a' ? oldTrack : newTrack) });
  }
  // The step at the switch and the largest second difference anywhere.
  let maxStep = 0, maxKink = 0;
  for (let i = 1; i < frames.length; i++) maxStep = Math.max(maxStep, Math.abs(frames[i].z - frames[i - 1].z));
  for (let i = 1; i + 1 < frames.length; i++) {
    maxKink = Math.max(maxKink, Math.abs(frames[i + 1].z - 2 * frames[i].z + frames[i - 1].z));
  }
  const lateT = 2.0;
  const late = b.draw('b', lateT, newTrack);
  // Without the blend the same switch is a jump of 0.04 m and a kink of
  // 5 m/s x 1/120 s.
  results.blend = { maxStep, maxKink, lateErr: Math.abs(late.z - newTrack(lateT).z),
                    rawStep: 0.04 + 5 / 120, snap: (() => {
                      const c = createRemoteBlend();
                      c.draw('a', 1.0, oldTrack);
                      const far = (t) => ({ x: 50 * t + 30, y: 100, z: 0, q: [0, 0, 0, 1] });
                      const r = c.draw('b', 1.01, far);
                      return Math.abs(r.x - far(1.01).x);
                    })() };
}

// --- client --------------------------------------------------------------
class FakeSocket { constructor() { this.sent = []; } send(b) { this.sent.push(b); } close() {} }
function makeClient(remoteClock) {
  let nowMs = 0;
  const ws = new FakeSocket();
  const c = createSidecarClient({ ws, now: () => nowMs, ...(remoteClock ? { remoteClock } : {}) });
  const feed = (rec) => c.handleMessage(JSON.stringify(rec));
  feed({ k: 'h', v: 5, plus: 'sidecar', name: 'probe' });
  feed({ k: 'e', t: 0, e: 'createPlayer', pid: 1, name: 'probe', team: 2, ai: 0, netId: 3, vehNetId: 4, camNetId: 4, kitNetId: 0 });
  feed({ k: 'me', pid: 1 });
  feed({ k: 'o', t: 0, id: 1472, tid: 1, tmpl: 'Corsair', team: 0, cls: 'SimpleObjectNetworkable' });
  return { c, feed, setNow: (ms) => { nowMs = ms; } };
}
function runClient(remoteClock) {
  const { c, feed, setNow } = makeClient(remoteClock);
  // 30 Hz ticks from tick 3000; each block arrives 10 ms after its tick;
  // the page sends one word a tick, and the server runs each word 4 ticks
  // after it was sent (its ack rides the block of that tick).
  const T0 = 3000;
  const base = 5000;                      // page ms at tick T0
  let lastDrawnT = null;
  const draws = [];
  for (let i = 0; i < 300; i++) {
    const tick = T0 + i;
    const pageMs = base + (i * 1000) / 30;
    setNow(pageMs);
    c.sendInput({}, { x: 0, y: 0 });       // word i + 1
    setNow(pageMs + 10);
    if (i >= 4) feed({ k: 'ack', t: 0, seq: i - 3, tick, iq: 0 });
    if (i % 3 !== 1) feed({ k: 's', t: 0, tick, o: [[1472, 60 * (tick / 30), 200, 0, 0, 0, 0, 1]] });
    const v = c.remoteVehicle(1472, pageMs + 20);
    if (v) { draws.push({ ms: pageMs + 20, t: v.t, x: v.x }); lastDrawnT = v.t; }
  }
  // The server time at the last frame: tick T0 + 299 at page base + 299/30 s,
  // and 20 ms on.
  const presentT = (T0 + 299) / 30 + 0.020;
  const last = draws[draws.length - 1];
  return { presentT, lastT: lastDrawnT, lead: c.renderLead(), lag: presentT - lastDrawnT,
           // the drawn x against where the plane is at the drawn time
           xErr: Math.abs(last.x - 60 * last.t) };
}
results.client = { retail: runClient(null), lookback: runClient('lookback') };

// --- joints --------------------------------------------------------------
{
  const { c, feed, setNow } = makeClient(null);
  setNow(1000);
  feed({ k: 'jn', t: 0, o: [[1472, 77, 'Tower']] });
  const yq = (deg) => [0, Math.sin(deg * Math.PI / 360), 0, Math.cos(deg * Math.PI / 360)];
  feed({ k: 's', t: 0, tick: 300, o: [[1472, 0, 0, 0, 0, 0, 0, 1]] });
  feed({ k: 'j', t: 0, tick: 300, o: [[1472, 77, ...yq(0)]] });
  setNow(1033.3);
  feed({ k: 's', t: 0, tick: 301, o: [[1472, 0, 0, 0, 0, 0, 0, 1]] });
  feed({ k: 'j', t: 0, tick: 301, o: [[1472, 77, ...yq(3)]] });
  // Draw 0.1 s after the newest: with no ack the lead is 0, so the render time
  // is the newest sample's - 0.1 + 0.1 = its own; ask further on instead.
  const at = (ms) => c.remoteVehicle(1472, ms)?.joints?.[0]?.q ?? null;
  const yawOf = (q) => (q ? 2 * Math.atan2(q[1], q[3]) * 180 / Math.PI : null);
  results.joints = { onNewest: yawOf(at(1033.3 + 100)), oneTickOn: yawOf(at(1033.3 + 100 + 1000 / 30)) };
}

process.stdout.write(JSON.stringify(results));
