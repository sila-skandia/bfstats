// How a sidecar page draws a remote soldier and a remote turret between and
// past their samples, and its remotes' clock through a server hitch and a
// round restart, under node (`net-sidecar.js`).
//
//   soldierHold  BFSoldierNetworkable::predict holds the newest rotation past
//                it (0x08224049); a hull carries its pair's turn (the page's
//                choice, wire.md section 38)
//   aim          the aim registers are lerped with the body between the
//                embracing samples (0x08223a85..0x08223ac1), and the newest
//                past it (0x08223f4e)
//   ring         a turret is read off its ring at render time
//                (RotationalBundleNetworkable::predict 0x08234f10), not held at
//                the older of two samples
//   hitch        the server stalls 0.45 s and its tick does not catch up (lab,
//                2026-10-25): the drawn clock stays on retail's
//   restart      the server's tick starts again from 0: the same
import {
  createSidecarState, createSidecarClient, RENDER_LOOKBACK_S, SERVER_TICK_HZ,
} from './net-sidecar.mjs';

const results = {};
const yq = (deg) => [0, Math.sin(deg * Math.PI / 360), 0, Math.cos(deg * Math.PI / 360)];
const yawOf = (q) => 2 * Math.atan2(q[1], q[3]) * 180 / Math.PI;
// The page's quaternion for a wire one is (-x, -y, z, w): a wire yaw of d
// reads back as -d here, so the checks below compare magnitudes.

// --- soldierHold -----------------------------------------------------------
{
  const s = createSidecarState();
  s.ingest({ k: 'o', t: 0, id: 700, tid: 1, tmpl: 'JapSoldier', team: 1, cls: 'BFSoldierNetworkable' });
  s.ingest({ k: 'o', t: 0, id: 800, tid: 2, tmpl: 'Sherman', team: 2, cls: 'SimpleObjectNetworkable' });
  s.ingest({ k: 's', t: 0, tick: 300, o: [[700, 0, 1, 0, ...yq(0)], [800, 0, 0, 0, ...yq(0)]] });
  s.ingest({ k: 's', t: 0, tick: 301, o: [[700, 1, 1, 0, ...yq(60)], [800, 1, 0, 0, ...yq(6)]] });
  const past = 301 / 30 + 0.05;
  const sol = s.xfAt(700, past);
  const hull = s.xfAt(800, past);
  results.soldierHold = { soldierYaw: Math.abs(yawOf(sol.q)), soldierX: sol.x,
                          hullYaw: Math.abs(yawOf(hull.q)) };
}

// --- aim -------------------------------------------------------------------
{
  const s = createSidecarState();
  s.ingest({ k: 'anim', t: 0, states: [[0, 'Lb_Stand', 0], [1, 'Ub_Stand', 0]] });
  s.ingest({ k: 'e', t: 0, e: 'createPlayer', pid: 5, name: 'bot', team: 1, ai: 1, netId: 700, vehNetId: 701, camNetId: 701, kitNetId: 0 });
  s.ingest({ k: 'o', t: 0, id: 700, tid: 1, tmpl: 'JapSoldier', team: 1, cls: 'BFSoldierNetworkable' });
  s.ingest({ k: 'e', t: 0, e: 'control', pid: 5, netId: 700 });
  const sample = (tick, x) => s.ingest({ k: 's', t: 0, tick, o: [[700, x, 1, 0, ...yq(0)]] });
  sample(300, 0);
  s.ingest({ k: 'st', t: 0, tick: 300, o: [[700, 0, 1, 0, 0, 0, 0]] });
  sample(302, 1);
  s.ingest({ k: 'st', t: 0, tick: 302, o: [[700, 0, 1, 10, 4, 0, 0]] });
  sample(303, 2);   // no aim change in this block: the registers hold
  const slot = [...s.state.roster.keys()][0];
  const row = (t) => s.playerRow(slot, t);
  results.aim = {
    slot: slot ?? null,
    mid: row(301 / 30),             // halfway between ticks 300 and 302
    held: row(302.5 / 30),          // between 302 and 303: both blocks say 10
    past: row(303 / 30 + 0.05),     // past the newest: the newest
    newest: row(null),
  };
}

// --- ring ------------------------------------------------------------------
{
  const s = createSidecarState();
  s.ingest({ k: 'o', t: 0, id: 800, tid: 2, tmpl: 'Sherman', team: 2, cls: 'SimpleObjectNetworkable' });
  s.ingest({ k: 'jn', t: 0, o: [[800, 801, 'ShermanTurret']] });
  for (let i = 0; i < 6; i++) {
    const tick = 300 + i;
    s.ingest({ k: 's', t: 0, tick, o: [[800, 0, 0, 0, 0, 0, 0, 1]] });
    s.ingest({ k: 'j', t: 0, tick, o: [[800, 801, ...yq(3 * i)]] });
  }
  const at = (t) => Math.abs(yawOf(s.jointsAt(800, t)[0].q));
  // A render time a block and a half behind the newest (tick 305): a page
  // whose lead is under interpolationTime draws there.
  results.ring = { behind: at(303.5 / 30), past: at(305 / 30 + 1 / 30), newest: at(null) };
  // A row without a tick takes the block clock of the `s` row before it.
  s.ingest({ k: 's', t: 0, tick: 306, o: [[800, 0, 0, 0, 0, 0, 0, 1]] });
  s.ingest({ k: 'j', t: 0, o: [[800, 801, ...yq(18)]] });
  results.ring.untimed = at(305.5 / 30);
}

// --- hitch / restart -------------------------------------------------------
class FakeSocket { constructor() { this.sent = []; } send(b) { this.sent.push(b); } close() {} }
function clockRun(events) {
  let nowMs = 0;
  const c = createSidecarClient({ ws: new FakeSocket(), now: () => nowMs });
  const feed = (rec) => c.handleMessage(JSON.stringify(rec));
  feed({ k: 'h', v: 5, plus: 'sidecar', name: 'probe' });
  feed({ k: 'e', t: 0, e: 'createPlayer', pid: 1, name: 'probe', team: 2, ai: 0, netId: 3, vehNetId: 4, camNetId: 4, kitNetId: 0 });
  feed({ k: 'me', pid: 1 });
  feed({ k: 'o', t: 0, id: 1472, tid: 1, tmpl: 'Corsair', team: 0, cls: 'SimpleObjectNetworkable' });
  // 30 Hz page ticks; a block per tick except where the script stalls the
  // server; each block arrives 40 ms after the page tick that made it and
  // runs the word sent 4 page ticks before.
  let tick = 9000, lastAck = null;
  const errs = [];
  for (let i = 0; i < 900; i++) {
    const pageMs = 1000 + (i * 1000) / 30;
    nowMs = pageMs;
    const seq = c.sendInput({}, { x: 0, y: 0 });
    const ev = events(i);
    if (ev === 'stall') continue;
    if (ev === 'restart') tick = 0;
    tick += 1;
    nowMs = pageMs + 40;
    if (seq > 4) { feed({ k: 'ack', t: 0, seq: seq - 4, tick, iq: 0 }); lastAck = { ms: nowMs, tick, pending: 4 }; }
    feed({ k: 's', t: 0, tick, o: [[1472, tick / 30, 200, 0, 0, 0, 0, 1]] });
    const frame = pageMs + 50;
    nowMs = frame;
    const v = c.remoteVehicle(1472, frame);
    if (v && lastAck) {
      const retail = (lastAck.tick + lastAck.pending) / SERVER_TICK_HZ + (frame - lastAck.ms) / 1000 - RENDER_LOOKBACK_S;
      errs.push({ i, err: v.t - retail });
    }
  }
  return errs;
}
const worst = (errs, from, to) => Math.max(...errs.filter((e) => e.i >= from && e.i < to).map((e) => Math.abs(e.err)));
{
  // 14 page ticks (0.47 s) with no block at i = 300..313; the server's tick
  // resumes one on, as the lab's did (it does not catch up the stall).
  const errs = clockRun((i) => (i >= 300 && i < 314 ? 'stall' : null));
  results.hitch = { before: worst(errs, 100, 300), after: worst(errs, 330, 900), right: worst(errs, 314, 330) };
}
{
  const errs = clockRun((i) => (i === 400 ? 'restart' : null));
  results.restart = { before: worst(errs, 100, 400), after: worst(errs, 402, 900) };
}

process.stdout.write(JSON.stringify(results));
