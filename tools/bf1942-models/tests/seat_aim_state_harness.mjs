// The seated gun against the server's, under node (wire.md section 40).
//
//   r  a rig built on a node something else has already turned measures from
//      the node's authored rest, not from where it stands (`rest-pose.js`):
//      the owner's Defgun, re-manned after the server's rows had left it
//      traversed, drew every angle 16 degrees past the server's
//   s  the acked-tick correction with the server's speed register: the
//      page's newer ticks re-run from the server's whole state reproduce
//      the server's turret exactly through fast swings, where closing the
//      angle alone leaves a slow servo (the Defgun's 50 deg/s^2) coasting on
//      the page's own speed between acks
//
// One JSON blob out; `test_seat_aim_state.py` asserts on it.

import * as THREE from 'three';
import { TurretAxis } from './turret-rig.js';
import { noteRest } from './rest-pose.js';
import { createAimReconciler } from './netcode-reconcile.js';

const results = {};
const DT = 1 / 30;
const DEFGUN_YAW = { input: 'c_PIMouseLookX', min: -90, max: 90, free: false, driver: 'position', maxSpeed: 90, direction: 1, acceleration: 50 };
const DEFGUN_PITCH = { input: 'c_PIMouseLookY', min: -30, max: 10, free: false, driver: 'position', maxSpeed: 50, direction: 1, acceleration: 75 };

function node(name) {
  const n = new THREE.Object3D();
  n.name = name;
  return n;
}
const angleBetween = (a, b) => {
  const d = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
  return 2 * Math.acos(d) * 180 / Math.PI;
};

{
  // r: the rest. A turret node at its authored pose (identity), turned 16
  // degrees by the server's joint rows (which note the rest before writing,
  // `netcode-render.js` applyJoints), then manned: the new rig at angle 0
  // must stand the node back at its authored pose, and at angle a draw a
  // degrees from it. Before, the rig took the turned pose for its zero.
  const authored = new THREE.Quaternion();
  const n = node('DefgunTurret');
  noteRest(n);
  n.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 16 * Math.PI / 180);
  const axis = new TurretAxis('yaw', n, DEFGUN_YAW);
  axis.hold(0);
  const atZero = angleBetween(n.quaternion, authored);
  axis.hold(10);
  const atTen = angleBetween(n.quaternion, authored);
  // A second rig on the same node after the first left it at 40 (the page's
  // own previous visit): it too measures from the authored rest.
  axis.hold(40);
  const again = new TurretAxis('yaw', n, DEFGUN_YAW);
  again.hold(0);
  results.r = { atZero: +atZero.toFixed(4), atTen: +atTen.toFixed(4), secondRigAtZero: +angleBetween(n.quaternion, authored).toFixed(4) };
}

{
  // s: fast swings on the Defgun's two axes. The server runs the inputs it
  // received; the page runs the same inputs a round trip ahead, starting
  // from a different speed register (a gun still coasting from its last
  // user, which the page cannot know), and is corrected at every ack, 20 Hz
  // (every 1.5 ticks), four ticks old. Reported: the page's error against
  // the server at the same tick, after the corrections, through the swings
  // and once the hand is still.
  const inputs = [];
  const push = (n, x, y) => { for (let i = 0; i < n; i++) inputs.push([x, y]); };
  for (let rep = 0; rep < 3; rep++) {
    push(12, 6, 1.5); push(45, 0, 0); push(20, -6, -2); push(45, 0, 0);
    push(6, 16, 4); push(4, -16, 0); push(45, 0, 0); push(30, 1.2, 0); push(45, 0, 0);
  }
  const run = (law) => {
    const srv = [new TurretAxis('yaw', node('t'), DEFGUN_YAW), new TurretAxis('pitch', node('g'), DEFGUN_PITCH)];
    const pg = [new TurretAxis('yaw', node('t'), DEFGUN_YAW), new TurretAxis('pitch', node('g'), DEFGUN_PITCH)];
    // The server's gun is still coasting from its last user when the page
    // takes the seat; the page starts it at rest, at the right angle.
    srv[0].angle = 8.5; srv[0].speed = -10; srv[1].angle = 9.9; srv[1].speed = 6;
    pg[0].angle = 8.5; pg[1].angle = 9.9;
    const served = [];           // server state after each tick
    const ledger = createAimReconciler();
    const LAG = 4;
    const errSwing = [], errStill = [];
    let still = 0;
    for (let t = 0; t < inputs.length; t++) {
      const [x, y] = inputs[t];
      // Server tick t.
      srv[0].setInput(x); srv[1].setInput(y);
      srv.forEach(a => a.step(DT));
      served.push(srv.map(a => [a.angle, a.speed]));
      // Page tick t, recorded.
      pg[0].setInput(x); pg[1].setInput(y);
      pg.forEach(a => a.step(DT));
      ledger.record(t + 1, pg.map(a => a.angle), { speeds: pg.map(a => a.speed), inputs: [x, y], scale: 1 });
      // An ack every 1.5 ticks, LAG ticks old.
      if (t >= LAG && (t % 3 !== 1)) {
        const ack = t + 1 - LAG;
        const s = served[ack - 1];
        const opts = law === 'state' ? {
          speeds: s.map(v => v[1]),
          replay: (i, angle, speed, input, scale) => pg[i].stepFrom(angle, speed, input, DT, scale),
        } : undefined;
        const d = ledger.accept(ack, s.map(v => v[0]), opts);
        if (d) d.forEach((v, i) => { pg[i].angle += v; pg[i].speed += d.speeds?.[i] ?? 0; });
      }
      // The page's present against the server's at the same tick.
      const e = Math.max(Math.abs(pg[0].angle - srv[0].angle), Math.abs(pg[1].angle - srv[1].angle));
      still = (x || y) ? 0 : still + 1;
      // From the first ack on: before it the page cannot know the server's
      // leftover speed.
      if (t > LAG + 1) (still > 15 ? errStill : errSwing).push(e);
    }
    const med = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    return { swingMax: +Math.max(...errSwing).toFixed(4), swingMedian: +med(errSwing).toFixed(4),
      stillMax: +Math.max(...errStill).toFixed(4), ticks: inputs.length };
  };
  results.s = { angle: run('angle'), state: run('state') };
}

process.stdout.write(JSON.stringify(results));
