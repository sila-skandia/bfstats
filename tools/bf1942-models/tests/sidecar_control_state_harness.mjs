// The control-object state decoder over a live capture: a spawned soldier
// walking forward, turning, then standing (lab, 2026-10-16). Each record is
// the field bits after the 12-bit length, as session.mjs hands them over.
import fs from 'node:fs';
import { decodeControlState, ControlBaselines } from '../sidecar/ghost/control-state.mjs';
import { decodePcoBody } from '../sidecar/ghost/pco.mjs';

const rows = JSON.parse(fs.readFileSync(new URL('./fixtures/sidecar_control_state.json', import.meta.url), 'utf8'));
const baselines = new ControlBaselines();
const out = { n: rows.length, exact: 0, full: 0, delta: 0, maxStep: 0, serialsIncrease: true, first: null, last: null, yaws: [] };
let prev = null, prevCtrl = -1;
for (const r of rows) {
  const c = decodeControlState(r.hex, r.bits, { classOf: () => 'BFSoldierNetworkable', baselines, animStates: 1395 });
  if (c.ok) out.exact++;
  if (c.isDelta) out.delta++; else out.full++;
  if (c.controlId <= prevCtrl) out.serialsIncrease = false;
  prevCtrl = c.controlId;
  const p = c.body?.pos;
  if (p && prev) out.maxStep = Math.max(out.maxStep, Math.hypot(p[0] - prev[0], p[2] - prev[2]));
  if (p) { prev = p; out.last = p; if (!out.first) out.first = p; }
  const q = c.body?.rot;
  if (q) out.yaws.push(2 * Math.atan2(q[1], q[3]) * 180 / Math.PI);
}

// A Sherman driven by the player: hull plus its child networkables, every
// SimpleObject one against its own baseline entry.
const veh = JSON.parse(fs.readFileSync(new URL('./fixtures/sidecar_control_state_vehicle.json', import.meta.url), 'utf8'));
const vb = new ControlBaselines();
const v = { n: veh.rows.length, exact: 0, maxStep: 0, first: null, last: null, hp: null };
let vp = null;
for (const r of veh.rows) {
  const c = decodeControlState(r.hex, r.bits, { classOf: () => 'SimpleObjectNetworkable', templateOf: () => veh.template, baselines: vb });
  if (c.ok) v.exact++;
  const p = c.body?.pos;
  if (p && vp) v.maxStep = Math.max(v.maxStep, Math.hypot(p[0] - vp[0], p[2] - vp[2]));
  if (p) { vp = p; v.last = p; if (!v.first) v.first = p; }
  if (c.body?.hp != null) v.hp = c.body.hp;
}
out.vehicle = v;

// The spawn-screen camera (a player's camNetId).
const cam = JSON.parse(fs.readFileSync(new URL('./fixtures/sidecar_control_state_camera.json', import.meta.url), 'utf8'));
const cb = new ControlBaselines();
out.camera = { n: cam.length, exact: 0 };
for (const r of cam) {
  const c = decodeControlState(r.hex, r.bits, { classOf: () => 'FreeCameraNetworkable', baselines: cb });
  if (c.ok || c.reason === 'no-baseline') out.camera.exact++;
}

// Ordinary records in a block that opened with a control state: a hull's
// compressed position is relative to that state's root position (a Corsair
// in flight, live). Each is checked against the same object's previous
// position, a few hundredths of a second earlier.
const refs = JSON.parse(fs.readFileSync(new URL('./fixtures/sidecar_block_reference.json', import.meta.url), 'utf8'));
out.blockRef = { n: refs.length, near: 0, nearWithout: 0 };
for (const x of refs) {
  const withRef = decodePcoBody(x.rec.hex, x.rec.bodyBits, { template: x.t, strict: false, ref: x.rec.ref }).pos;
  const without = decodePcoBody(x.rec.hex, x.rec.bodyBits, { template: x.t, strict: false }).pos;
  const d = (p) => Math.hypot(p[0] - x.prev[0], p[1] - x.prev[1], p[2] - x.prev[2]);
  if (d(withRef) < 5) out.blockRef.near++;
  if (d(without) < 5) out.blockRef.nearWithout++;
}
// A gunner's control object is his seat (the hull's netId + 1): its descriptor
// is the seat's child tail alone, read with the seat spec.
{
  const seat = JSON.parse(fs.readFileSync(new URL('./fixtures/sidecar_control_state_seat.json', import.meta.url), 'utf8'));
  const sb = new ControlBaselines();
  out.seat = { n: seat.rows.length, exact: 0, mags: [] };
  for (const r of seat.rows) {
    const n = r.hex.length * 4;
    let got = null;
    for (let k = n; k > n - 8 && !got?.ok; k--) {
      const c = decodeControlState(r.hex, k, { classOf: (id) => (id === seat.root.netId + 1 ? 'Seat' : null),
        seatOf: (id) => (id === seat.root.netId + 1 ? { root: seat.root.netId, seat: 1, tmpl: seat.root.tmpl } : null), baselines: sb });
      if (!got || c.ok) got = c;
    }
    if (got.ok) { out.seat.exact++; const f = got.body.children.find((ch) => ch.type === 'F'); if (f?.magA != null) out.seat.mags.push(f.magA); }
  }
}
console.log(JSON.stringify(out));
