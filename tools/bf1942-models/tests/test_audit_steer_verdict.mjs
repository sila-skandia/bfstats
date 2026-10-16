// The behaviour audit's steering verdict (`audit_steer_verdict.mjs`): a hull
// still swinging left from a knock when D goes down is not a reversed steer.
//
//   node tests/test_audit_steer_verdict.mjs
import assert from 'node:assert/strict';
import { rightTurn, steerVerdict, SETTLE_RATE } from '../audit_steer_verdict.mjs';

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`ok - ${name}`); } catch (e) { failures++; console.log(`not ok - ${name}\n  ${e.message}`); }
};

// Axes of a hull heading `yaw` radians, nose -z at yaw 0 and right +x, turning
// right as yaw grows (the page's frame: `__hull().axes`).
const axes = yaw => ({
  forward: [Math.sin(yaw), 0, -Math.cos(yaw)],
  right: [Math.cos(yaw), 0, Math.sin(yaw)],
});

test('rightTurn is signed: right positive, left negative', () => {
  assert.ok(Math.abs(rightTurn(axes(0), axes(0.3)) - 0.3) < 1e-9);
  assert.ok(Math.abs(rightTurn(axes(1), axes(0.8)) + 0.2) < 1e-9);
});

test('a hull at rest on its heading that turns right under D is ok', () => {
  const v = steerVerdict({ preRate: 0, turnA: 0.25, dtA: 0.5, turned: 0.9, speed: 8 });
  assert.equal(v.verdict, 'ok');
});

test('a hull that turns left under D from a steady heading is reversed', () => {
  const v = steerVerdict({ preRate: 0, turnA: -0.25, dtA: 0.5, turned: 0.9, speed: 8 });
  assert.equal(v.verdict, 'reversed');
});

// The Prokhorovka Cavalry_Nagant: struck something, slewing left with no key
// down; D's right turn is smaller than the slew, so the nose still goes left.
test('a left slew that outlasts the press, with D turning right, is not reversed', () => {
  const preRate = -0.6;                      // rad/s left before D
  const turnA = preRate * 0.5 + 0.12;        // the slew plus D's own right turn
  const v = steerVerdict({ preRate, turnA, dtA: 0.5, turned: 0.3, speed: 4 });
  assert.notEqual(v.verdict, 'reversed');
  assert.ok(v.induced > 0, `D's share ${v.induced} should be rightward`);
});

test('a slow residual left drift is taken off, and a real reversal still shows', () => {
  const small = -SETTLE_RATE / 2;
  const right = steerVerdict({ preRate: small, turnA: small * 0.5 + 0.2, dtA: 0.5, turned: 0.5, speed: 6 });
  assert.equal(right.verdict, 'ok');
  const left = steerVerdict({ preRate: small, turnA: small * 0.5 - 0.25, dtA: 0.5, turned: 0.5, speed: 6 });
  assert.equal(left.verdict, 'reversed');
});

test('a hull still slewing hard left whose press adds left is unsettled, not reversed', () => {
  const v = steerVerdict({ preRate: -0.5, turnA: -0.5, dtA: 0.5, turned: 0.6, speed: 5 });
  assert.equal(v.verdict, 'unsettled');
});

test('a hull at speed whose heading never moves does not steer', () => {
  assert.equal(steerVerdict({ preRate: 0, turnA: 0, dtA: 0.5, turned: 0.005, speed: 7 }).verdict, 'no-steer');
});

test('a hull too slow to judge gets no verdict', () => {
  assert.equal(steerVerdict({ preRate: 0, turnA: -0.01, dtA: 0.5, turned: 0.01, speed: 0.4 }).verdict, 'slow');
});

if (failures) { console.log(`${failures} failed`); process.exit(1); }
