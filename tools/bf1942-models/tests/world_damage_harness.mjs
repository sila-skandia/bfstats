// Drives `viewer/world-damage.js`'s two per-hull readings under node and prints
// one JSON blob: the upside-down test `Armor::update` runs once its bank is full
// (`upsideDownOwners`, ledger HP-18) and a hull's depth under the sea
// (`submersionDepth`, PHY-16). A fake world is enough, the way
// `world_harness.mjs` fakes a body-world entry for `touchesWater`: both read
// `world.collider.heightfield`, `world.bodyWorld.entries`,
// `world.vehicleDamage.get` and a part's `shape.layers[0].vertices` and
// `worldVertex`.

import { upsideDownOwners, submersionDepth, UPSIDE_DOWN_COS } from './world-damage.js';

// A 2 m cube whose bottom is 1 m under the origin, turned by `axes` (rows: the
// body's x, y, z in the world).
const CUBE = [
  -1, -1, -1, 1, -1, -1, 1, -1, 1, -1, -1, 1,
  -1, 1, -1, 1, 1, -1, 1, 1, 1, -1, 1, 1,
];

function rollAxes(degrees) {
  const r = degrees * Math.PI / 180;
  // About the body's z (forward): x and y turn in the world's x-y plane.
  return [[Math.cos(r), Math.sin(r), 0], [-Math.sin(r), Math.cos(r), 0], [0, 0, 1]];
}

function body({ pos, axes, v = [0, 0, 0], w = [0, 0, 0], sleeping = false }) {
  return {
    pos, axes, v, w, sleeping,
    tangentSpeed(p, out) {
      const r = [p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]];
      out[0] = v[0] + w[1] * r[2] - w[2] * r[1];
      out[1] = v[1] + w[2] * r[0] - w[0] * r[2];
      out[2] = v[2] + w[0] * r[1] - w[1] * r[0];
      return out;
    },
  };
}

function part(b, node = 'hull') {
  return {
    node, kind: 'body',
    shape: { layers: [{ vertices: CUBE }] },
    worldVertex(layer, i, out) {
      const x = CUBE[3 * i], y = CUBE[3 * i + 1], z = CUBE[3 * i + 2];
      const a = b.axes;
      out[0] = b.pos[0] + x * a[0][0] + y * a[1][0] + z * a[2][0];
      out[1] = b.pos[1] + x * a[0][1] + y * a[1][1] + z * a[2][1];
      out[2] = b.pos[2] + x * a[0][2] + y * a[1][2] + z * a[2][2];
      return out;
    },
  };
}

function world(entries, { ground = 0, slope = null, rate = 10 } = {}) {
  const map = new Map(entries.map((e, i) => [i + 1, e]));
  return {
    collider: {
      waterLevel: 5,
      heightfield: {
        height: (x) => (slope ? ground + slope * x : ground),
        normal: (x, z, out) => {
          const n = slope ? [-slope, 1, 0] : [0, 1, 0];
          const l = Math.hypot(...n);
          out[0] = n[0] / l; out[1] = n[1] / l; out[2] = n[2] / l;
          return out;
        },
      },
    },
    bodyWorld: { entries: map, get: owner => map.get(owner) ?? null },
    vehicleDamage: { get: () => ({ destroyed: false, hpLostWhileUpSideDown: rate }) },
  };
}

const parked = (opts, extra = {}) => {
  const b = body(opts);
  return { parked: { body: b }, parts: [part(b)], spec: { boundingRadius: 1.8, ...extra } };
};
const driven = opts => {
  const b = body(opts);
  return { driven: Object.assign(b, { vehicle: { hullContacts: [] } }), parts: [part(b)], spec: { boundingRadius: 1.8 } };
};
const has = (w, owner = 1) => upsideDownOwners(w).has(owner);

const out = { cos: UPSIDE_DOWN_COS };

// Parked and asleep on its roof, its origin 1 m over the ground: up.y = -1.
out.roofAsleep = has(world([parked({ pos: [0, 1, 0], axes: rollAxes(180), sleeping: true })]));
// On its side (up.y = 0) and at 70 degrees (up.y = 0.34): 0.3 is the line.
out.side = has(world([parked({ pos: [0, 1, 0], axes: rollAxes(90), sleeping: true })]));
out.at70 = has(world([parked({ pos: [0, 1, 0], axes: rollAxes(70), sleeping: true })]));
out.at75 = has(world([parked({ pos: [0, 1, 0], axes: rollAxes(75), sleeping: true })]));
// Upright, asleep: never.
out.upright = has(world([parked({ pos: [0, 1, 0], axes: rollAxes(0), sleeping: true })]));
// Roof down but awake and still: no contact fired, not asleep, so no bill.
out.roofAwakeStill = has(world([parked({ pos: [0, 1, 0], axes: rollAxes(180) })]));
// Roof down, awake, sliding at 2 m/s with its roof in the ground: contact.
out.roofSliding = has(world([parked({ pos: [0, 0.9, 0], axes: rollAxes(180), v: [2, 0, 0] })]));
// Upside down in the air 10 m up, asleep or not: out of reach of the test
// (`pos.y - 2r` is above the ground).
out.flippedHigh = has(world([parked({ pos: [0, 10, 0], axes: rollAxes(180), sleeping: true })]));
// A hull rate of 0.01 is the engine's own off switch.
out.rateOff = has(world([parked({ pos: [0, 1, 0], axes: rollAxes(180), sleeping: true })], { rate: 0.01 }));
// Driven: still for 100 ticks is the sleep the engine's root would reach.
{
  const entry = driven({ pos: [0, 1, 0], axes: rollAxes(180) });
  const w = world([entry]);
  let first = null;
  for (let tick = 1; tick <= 120 && first === null; tick++) if (has(w)) first = tick;
  out.drivenQuietFirstTick = first;
}
// Origin within 0.1 m of the ground: the tilt is taken against the slope's
// own normal. Rolled 80 degrees on a 45 degree slope the hull is 35 off the
// slope's normal (fine) but only 10 above the horizon (upside down to world
// up). Lying there with its origin a metre up, world up is the test.
{
  const slope = 1;
  const low = parked({ pos: [0, 0.05, 0], axes: rollAxes(80), sleeping: true });
  out.onSlopeLow = has(world([low], { slope }));
  const high = parked({ pos: [0, 1, 0], axes: rollAxes(80), sleeping: true });
  out.onSlopeHigh = has(world([high], { slope }));
}

// Upright on a steep slope, flush with it and asleep (review, 2026-10-07): the
// hull's up is the slope's normal. Its origin a metre up takes the world-up
// branch, so it is billed only past acos 0.3 = 72.5 degrees of slope, as the
// engine bills it; within 0.1 m of the ground the tilt is against the normal,
// which an upright hull meets exactly.
{
  const flush = (deg, y) => {
    const slope = Math.tan(deg * Math.PI / 180);
    return has(world([parked({ pos: [0, y, 0], axes: rollAxes(deg), sleeping: true })], { slope }));
  };
  out.uprightOnSlope = { at45: flush(45, 1), at60: flush(60, 1), at70: flush(70, 1), at75: flush(75, 1),
    at60Low: flush(60, 0.05), at80Low: flush(80, 0.05) };
}

// The depth: the root part's lowest tested vertex under the sea, found by the
// spec's `waterPart`, and 0 above it or for a hull with none.
{
  const sunk = parked({ pos: [0, 2, 0], axes: rollAxes(0) }, {});
  sunk.spec.waterPart = { node: 'hull' };
  out.depthSunk = submersionDepth(sunk, 5);          // bottom at 1: 4 m
  const dry = parked({ pos: [0, 8, 0], axes: rollAxes(0) });
  dry.spec.waterPart = { node: 'hull' };
  out.depthDry = submersionDepth(dry, 5);
  const none = parked({ pos: [0, 2, 0], axes: rollAxes(0) });
  out.depthNoPart = submersionDepth(none, 5);
}

process.stdout.write(JSON.stringify(out, null, 1));
