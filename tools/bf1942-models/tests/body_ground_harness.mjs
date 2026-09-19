// Drives `viewer/body-friction.js` and `viewer/body-ground.js` outside a
// browser and prints one JSON blob. Unlike `body-contact.js`'s harness, both
// modules under test here import real siblings (`rigid-body.js`,
// `body-friction.js`), so — like `test_vehicle_damage.py`'s harness — this
// one runs against the REAL `rigid-body.mjs`, `body-contact.mjs` and
// `crash-damage.mjs`, copied in beside it by `test_body_ground.py` (which
// also rewrites each module's own `from './x.js'` imports to `./x.mjs`).
//
// Two kinds of scenario:
//
//  - `addFriction` unit cases (part (a) of this track's tests): a hand-built
//    `Response`-shaped plain object and a `FakeBody` that only records what
//    was posted to it — every number in `test_body_ground.py`'s assertions
//    for these was worked by hand from `collision-response.md` §8 before
//    this file was written, not read back from `body-friction.js`'s output.
//  - `ParkedVehicle` integration cases (parts (b)-(d)): the REAL `RigidBody`,
//    `Response` and `CollisionPart` from the copied modules, ticked forward
//    with `vehicle.accumulate/body.step/vehicle.detectGround/vehicle.resolve`
//    in the spec's own §2 order, on an analytic flat or sloped terrain.
import { RigidBody, TICK, GRAVITY } from './rigid-body.mjs';
import { Response, CollisionPart } from './body-contact.mjs';
import { contactMaterialValues } from './crash-damage.mjs';
import {
  addFriction,
  GRIP_NONE, GRIP_CONTACT, GRIP_ROLL, GRIP_ENGINE, GRIP_ROLL_WHEN_OCCUPIED,
  GRIP_DUMMY, GRIP_ENGINE_DUMMY, GRIP_STATIC_FRICTION,
  COULOMB_GRAVITY, COULOMB_KINETIC_COEFFICIENT, COULOMB_STATIC_MULTIPLIER,
  WAKE_CONTACT_SPEED_SQ, FRICTION_MIN_MAGNITUDE_SQ, SIMULATION_FPS,
  parkedGrip,
} from './body-friction.mjs';
import { terrainContact, WheelSpring, ParkedVehicle } from './body-ground.mjs';

const out = {};

// =============================================================================
// (a) addFriction unit cases
// =============================================================================

class FakeBody {
  constructor({ sleepiness = 100 } = {}) {
    this.sleepiness = sleepiness;
    this.accelCalls = [];
    this.frictionAtCalls = [];
    this.woke = false;
  }
  addAcceleration(a) { this.accelCalls.push([a[0], a[1], a[2]]); }
  addFrictionAt(p, f) { this.frictionAtCalls.push({ p: [p[0], p[1], p[2]], f: [f[0], f[1], f[2]] }); }
  wake() { this.woke = true; this.sleepiness = 100; }
}

function makeResponse({ grip, liveGrip, friction, resistance = 0, avgNormal, avgSpeed,
                         avgRelPos = [0, 0, 0], surfaceSpeed = [0, 0, 0], count, kind = 'body' }) {
  return {
    grip, liveGrip: liveGrip ?? grip,
    friction, resistance,
    avgNormal: avgNormal.slice(), avgSpeed: avgSpeed.slice(), avgRelPos: avgRelPos.slice(),
    surfaceSpeed: surfaceSpeed.slice(),
    count, kind,
    clearContacts() {
      this.avgNormal = [0, 0, 0]; this.avgSpeed = [0, 0, 0]; this.avgRelPos = [0, 0, 0];
      this.count = 0; this.surfaceSpeed = [0, 0, 0];
    },
  };
}

out.constants = {
  GRIP_NONE, GRIP_CONTACT, GRIP_ROLL, GRIP_ENGINE, GRIP_ROLL_WHEN_OCCUPIED,
  GRIP_DUMMY, GRIP_ENGINE_DUMMY, GRIP_STATIC_FRICTION,
  COULOMB_GRAVITY, COULOMB_KINETIC_COEFFICIENT, COULOMB_STATIC_MULTIPLIER,
  WAKE_CONTACT_SPEED_SQ, FRICTION_MIN_MAGNITUDE_SQ, SIMULATION_FPS,
};

out.parkedGrip = {
  rollGripWhenOccupiedAlone: parkedGrip(GRIP_ROLL_WHEN_OCCUPIED),
  rollGripPlusOccupied: parkedGrip(GRIP_ROLL | GRIP_ROLL_WHEN_OCCUPIED),
  plainContact: parkedGrip(GRIP_CONTACT),
  noGrip: parkedGrip(GRIP_NONE),
};

out.addFriction = {};

// A ContactGrip part sliding at 5 m/s on flat ground, mu 1: the wanted
// change is far more than limKinetic and gets clamped to exactly that,
// opposite the motion; F*30 is what addFrictionAt receives.
{
  const response = makeResponse({
    grip: GRIP_CONTACT, friction: 1.0, resistance: 0,
    avgNormal: [0, 1, 0], avgSpeed: [5, 0, 0], count: 1,
  });
  const body = new FakeBody();
  const result = addFriction(response, body, [0, 0, 0], {});
  out.addFriction.contactGripSlide = {
    result, frictionAtCalls: body.frictionAtCalls, accelCalls: body.accelCalls,
    liveGripAfter: response.liveGrip,
  };
}

// The static latch: sets when the wanted change already fits inside
// limKinetic, holds up to limStatic even though that already exceeds
// limKinetic, breaks above limStatic. Three ticks on the SAME response
// object (liveGrip persists; the contact averages are re-populated each
// tick the way `impulseOn` would).
{
  const response = makeResponse({
    grip: GRIP_CONTACT, friction: 1.0, resistance: 0,
    avgNormal: [0, 1, 0], avgSpeed: [0, 0, 0], count: 1,
  });
  const body = new FakeBody();
  const calls = [];
  for (const speed of [0.3, 0.6, 1.0]) {
    response.avgNormal = [0, 1, 0];
    response.avgSpeed = [speed, 0, 0];
    response.count = 1;
    calls.push(addFriction(response, body, [0, 0, 0], {}));
  }
  out.addFriction.latchSequence = calls;
}

// A vertical contact-normal component of 0 (a side-on ram): zero Coulomb
// friction (limKinetic == limStatic == 0), but the resistance term still
// runs and `addFrictionAt` still gets a (zero) sample.
{
  const response = makeResponse({
    grip: GRIP_CONTACT, friction: 1.0, resistance: 0.02,
    avgNormal: [1, 0, 0], avgSpeed: [0, 0, 5], count: 1,
  });
  const body = new FakeBody();
  const result = addFriction(response, body, [0, 0, 0], {});
  out.addFriction.sideOnRam = { result, frictionAtCalls: body.frictionAtCalls, accelCalls: body.accelCalls };
}

// The 0x24 (EngineDummyGrip) early exit: no friction sample, no reset.
{
  const response = makeResponse({
    grip: GRIP_ENGINE_DUMMY, friction: 1.0, resistance: 0,
    avgNormal: [0, 1, 0], avgSpeed: [3, 0, 0], count: 1,
  });
  const beforeCount = response.count, beforeSpeedX = response.avgSpeed[0];
  const body = new FakeBody();
  const result = addFriction(response, body, [0, 0, 0], {});
  out.addFriction.engineDummyExit = {
    result,
    frictionAtCallCount: body.frictionAtCalls.length,
    accelCallCount: body.accelCalls.length,
    countUnchanged: response.count === beforeCount,
    avgSpeedUnchanged: response.avgSpeed[0] === beforeSpeedX,
  };
}

// No contact this tick: clear the latch, touch nothing else.
{
  const response = makeResponse({
    grip: GRIP_CONTACT, liveGrip: GRIP_CONTACT | GRIP_STATIC_FRICTION,
    friction: 1.0, resistance: 0, avgNormal: [0, 1, 0], avgSpeed: [0, 0, 0], count: 0,
  });
  const body = new FakeBody();
  const result = addFriction(response, body, [0, 0, 0], {});
  out.addFriction.noContactExit = { result, liveGripAfter: response.liveGrip };
}

// NoGrip (authored 0): same shape as the no-contact exit.
{
  const response = makeResponse({
    grip: GRIP_NONE, liveGrip: GRIP_STATIC_FRICTION,
    friction: 1.0, resistance: 0, avgNormal: [0, 1, 0], avgSpeed: [5, 0, 0], count: 1,
  });
  const body = new FakeBody();
  const result = addFriction(response, body, [0, 0, 0], {});
  out.addFriction.noGripExit = { result, liveGripAfter: response.liveGrip };
}

// RollGrip removes only the axle-aligned component of the tangential speed,
// leaving the rolling (perpendicular) component alone.
{
  const response = makeResponse({
    grip: GRIP_ROLL, friction: 1.0, resistance: 0,
    avgNormal: [0, 1, 0], avgSpeed: [3, 0, 4], count: 1,
  });
  const body = new FakeBody();
  const result = addFriction(response, body, [0, 0, 0], { axle: [1, 0, 0] });
  out.addFriction.rollGrip = { result, frictionAtCalls: body.frictionAtCalls };
}

// EngineGrip: dV = T - Vt, T supplied by the caller (already tangent to N).
{
  const response = makeResponse({
    grip: GRIP_ENGINE, friction: 1.0, resistance: 0,
    avgNormal: [0, 1, 0], avgSpeed: [1, 0, 0], count: 1,
  });
  const body = new FakeBody();
  const result = addFriction(response, body, [0, 0, 0], { engineSurfaceSpeed: [3, 0, 0] });
  out.addFriction.engineGrip = { result, frictionAtCalls: body.frictionAtCalls };
}

// Wake test: |avgSpeed|^2 > 0.1 wakes an eligible (sleepiness >= 0) body;
// a small contact speed does not; a permanently-held body (sleepiness < 0)
// is never woken.
{
  const respBig = makeResponse({ grip: GRIP_CONTACT, friction: 1.0, avgNormal: [0, 1, 0], avgSpeed: [5, 0, 0], count: 1 });
  const bodyBig = new FakeBody({ sleepiness: 0 });
  const rBig = addFriction(respBig, bodyBig, [0, 0, 0], {});

  const respSmall = makeResponse({ grip: GRIP_CONTACT, friction: 1.0, avgNormal: [0, 1, 0], avgSpeed: [0.1, 0, 0], count: 1 });
  const bodySmall = new FakeBody({ sleepiness: 0 });
  addFriction(respSmall, bodySmall, [0, 0, 0], {});

  const respHeld = makeResponse({ grip: GRIP_CONTACT, friction: 1.0, avgNormal: [0, 1, 0], avgSpeed: [5, 0, 0], count: 1 });
  const bodyHeld = new FakeBody({ sleepiness: -1 });
  addFriction(respHeld, bodyHeld, [0, 0, 0], {});

  out.addFriction.wake = {
    bigSpeedWoke: bodyBig.woke, bigResultWoke: rBig.woke,
    smallSpeedWoke: bodySmall.woke,
    heldNotWoken: bodyHeld.woke,
  };
}

// =============================================================================
// (a2) WheelSpring.apply directly, against PhysicsSpring::updatePhysics's own
// law (body-ground.js's header comment above WheelSpring, decompiled
// 2026-09-20): a = -(strength*D*(g*-0.101833) + damping*(D-Dprev)/dt), where
// D = -push (a world vector along the contact normal, NOT the body's up
// axis) and D is rolled into "previous" every tick, asleep or not, while the
// force itself and the clearing of `push` only happen while awake.
// =============================================================================

class SpringFakeBody {
  constructor() { this.calls = []; }
  addAccelerationAt(p, a) { this.calls.push({ p: [p[0], p[1], p[2]], a: [a[0], a[1], a[2]] }); }
}

const SPRING_STRENGTH = 25, SPRING_DAMPING = 5;

out.wheelSpring = {};

// The static term alone: prime `previous` to equal this tick's D so the
// damping term (which reads D - previous) is exactly zero, isolating
// -(strength * D * |g|*0.101833).
{
  const spring = new WheelSpring({ strength: SPRING_STRENGTH, damping: SPRING_DAMPING });
  spring.compress([0, 0.1, 0]);           // this tick's push -> D = (0, -0.1, 0)
  spring.previous[0] = 0; spring.previous[1] = -0.1; spring.previous[2] = 0;
  const body = new SpringFakeBody();
  spring.apply(body, [2, 0, 3], TICK, false);
  out.wheelSpring.staticTerm = { calls: body.calls };
}

// Damping opposes further compression: D grows (more negative Y, sinking
// further) from the previous tick's D -> the damper ADDS to the static push.
{
  const spring = new WheelSpring({ strength: SPRING_STRENGTH, damping: SPRING_DAMPING });
  spring.previous[0] = 0; spring.previous[1] = -0.05; spring.previous[2] = 0;
  spring.compress([0, 0.1, 0]);
  const body = new SpringFakeBody();
  spring.apply(body, [0, 0, 0], TICK, false);
  out.wheelSpring.compressing = { calls: body.calls };
}

// Damping opposes rebound: the task's own named case — a wheel that leaves
// the ground this tick (nothing calls `compress()`, so `push` — and so D —
// stays zero) right after a compressed previous tick (Dprev != 0). The
// damper alone produces a force, and it points the OPPOSITE way from the
// compressing case above.
{
  const spring = new WheelSpring({ strength: SPRING_STRENGTH, damping: SPRING_DAMPING });
  spring.previous[0] = 0; spring.previous[1] = -0.1; spring.previous[2] = 0;
  const body = new SpringFakeBody();
  spring.apply(body, [0, 0, 0], TICK, false);
  out.wheelSpring.rebound = { calls: body.calls, pushAfter: [...spring.push] };
}

// The push this tick's `compress()` stored is cleared once an awake `apply`
// has consumed it — nothing carries a displacement forward.
{
  const spring = new WheelSpring({ strength: SPRING_STRENGTH, damping: SPRING_DAMPING });
  spring.compress([0.02, 0.2, -0.01]);
  const body = new SpringFakeBody();
  spring.apply(body, [0, 0, 0], TICK, false);
  out.wheelSpring.clearedAfterAwake = { pushAfter: [...spring.push] };
}

// Asleep: no force posted (s.4.3 "springs... skip their force" while the
// root sleeps) but `previous` still rolls forward from the CURRENT push, and
// the push itself is untouched (only an awake apply clears it).
{
  const spring = new WheelSpring({ strength: SPRING_STRENGTH, damping: SPRING_DAMPING });
  spring.compress([0, 0.2, 0]);
  const body = new SpringFakeBody();
  spring.apply(body, [0, 0, 0], TICK, true);
  out.wheelSpring.asleep = {
    callCount: body.calls.length,
    pushAfter: [...spring.push],
    prevAfter: [...spring.previous],
  };
}

// =============================================================================
// (b)-(d) ParkedVehicle integration: real RigidBody/Response/CollisionPart
// =============================================================================

const STRENGTH = 25;
const DAMPING = 5;
const REST_Y = -0.5;
const SPREAD_WHEEL_OFFSETS = [
  [1, REST_Y, 1.5], [-1, REST_Y, 1.5], [1, REST_Y, -1.5], [-1, REST_Y, -1.5],
];

const materialTables = {
  materials: { 0: { attGroup: 0, defGroup: 0, friction: 1.0, resistance: 0.02, elasticity: 0 } },
  modifiers: {},
};

function emptyShape() {
  return { layers: [{ vertices: new Float32Array(0), vertexMaterials: new Uint16Array(0) }], radius: 1 };
}
function oneVertexShape(mat = 0) {
  return { layers: [{ vertices: new Float32Array([0, 0, 0]), vertexMaterials: new Uint16Array([mat]) }], radius: 0.4 };
}

function buildVehicle({ position, wheelOffsets = SPREAD_WHEEL_OFFSETS, authoredWheelGrip = GRIP_ROLL_WHEN_OCCUPIED, box = [2, 1, 3] }) {
  const body = new RigidBody({ mass: 2500, box, position: position.slice() });
  const hullResponse = new Response('body', GRIP_CONTACT);
  const hullPart = new CollisionPart({
    body, shape: emptyShape(), response: hullResponse, isRoot: true, offset: [0, 0, 0], kind: 'body',
  });

  const wheels = [];
  const parts = [hullPart];
  for (const off of wheelOffsets) {
    const response = new Response('spring', authoredWheelGrip);
    const part = new CollisionPart({
      body, shape: oneVertexShape(0), response, isRoot: false, offset: off.slice(), kind: 'spring',
    });
    const spring = new WheelSpring({ strength: STRENGTH, damping: DAMPING });
    wheels.push({ part, spring });
    parts.push(part);
  }

  const vehicle = new ParkedVehicle({ body, parts, wheels });
  return { body, parts, wheels, vehicle };
}

function makeFlatTerrain() {
  return {
    height: () => 0,
    normal: (x, z, o) => { o[0] = 0; o[1] = 1; o[2] = 0; return o; },
    material: () => 0,
    waterLevel: -Infinity,
  };
}

function makeHandlers() {
  return {
    onTerrain() {},
    onWater() {},
    materialValues(matSelf, matTerrain) { return contactMaterialValues(materialTables, matSelf, matTerrain); },
  };
}

function tickOnce(vehicle, body, terrain, handlers) {
  vehicle.accumulate(TICK);
  body.step(TICK);
  vehicle.detectGround(terrain, handlers);
  vehicle.resolve();
}

// --- (b) drop, settle, sleep -------------------------------------------------

const flatTerrain = makeFlatTerrain();
const handlers = makeHandlers();

const DROP_HEIGHT = 0.5;
const settled = buildVehicle({ position: [0, DROP_HEIGHT - REST_Y, 0] });

let settleTicks = -1;
// The wheels' own `push` is a TRANSIENT, this-tick-only reading: an awake
// `accumulate()` always clears it right after consuming it, and it is only
// ever refreshed by `detectGround` -> `resolve`, which stop running the
// instant the body sleeps. So the tick body.sleeping FIRST reads true is
// already one tick past the last real ground-contact reading — `displacement`
// sampled after that point is a structural zero, not the equilibrium
// compression. Capture it on the LAST AWAKE tick instead, where detectGround
// still ran and the springs are at (or extremely close to) equilibrium after
// 100+ consecutive quiet ticks.
let restDisplacements = null;
const SETTLE_MAX_TICKS = 3000;
for (let t = 1; t <= SETTLE_MAX_TICKS; t++) {
  tickOnce(settled.vehicle, settled.body, flatTerrain, handlers);
  if (settled.body.sleeping) { settleTicks = t; break; }
  restDisplacements = settled.wheels.map(w => w.spring.displacement);
}

let staysAsleep = settleTicks > 0;
if (staysAsleep) {
  for (let i = 0; i < 30; i++) {
    tickOnce(settled.vehicle, settled.body, flatTerrain, handlers);
    if (!settled.body.sleeping) { staysAsleep = false; break; }
  }
}

out.settle = {
  strength: STRENGTH, damping: DAMPING, restOffsetY: REST_Y,
  wheelCount: SPREAD_WHEEL_OFFSETS.length, dropHeight: DROP_HEIGHT,
  settleTicks, staysAsleep,
  finalBodyPos: [...settled.body.pos],
  restDisplacements,
  postSleepDisplacements: settled.wheels.map(w => w.spring.displacement),
  finalSleepiness: settled.body.sleepiness,
  grippAfterConstruction: settled.wheels.map(w => w.part.response.grip),
};

// --- (c) shove: decelerate under friction, sleep again; off-centre yaws ----

const shoveResults = { attempted: settleTicks > 0 };
if (settleTicks > 0) {
  const { body, vehicle } = settled;
  // A real ram, not a nudge. `addAccelerationAt` is a one-tick acceleration
  // (rigid-body.js: no /mass anywhere), so a Dv worth testing needs a large
  // one-tick value: 150 m/s^2 for 1/30 s is Dv = 5 m/s. The vehicle has been
  // asleep long enough beforehand (the 30-tick staysAsleep loop above) that
  // every wheel's `push`/`previous` have decayed to exactly zero — see the
  // WheelSpring unit tests' "asleep" case and (b)'s displacement comment —
  // so accumulate()'s FIRST tick after waking contributes no spring force at
  // all (D and Dprev both read zero); only from the second tick on, once
  // `detectGround`/`resolve` have refreshed `push` from real terrain contact,
  // does the spring see the sudden 0 -> real-penetration jump in one tick and
  // produce a sharp, genuine one-tick vertical "resync" transient. That
  // transient is real (the engine's own checkVsTerrain is skipped for a
  // sleeping part, spec s.2/s.4.3), but it is a SUSPENSION effect, not a
  // friction one, so it must not be read as part of "deceleration bounded by
  // friction" below.
  const SHOVE_ACCEL = 150;
  body.addAccelerationAt([body.pos[0], body.pos[1], body.pos[2]], [SHOVE_ACCEL, 0, 0]);
  body.wake();

  // addFriction's own Vt strips the contact normal's component out of V
  // before the Coulomb clamp ever sees it (collision-response.md s.8) — on
  // flat ground (N = (0,1,0)) that means friction NEVER touches vertical
  // speed at all. So "decel bounded by mu*g*N.y" is a horizontal-speed
  // question; folding the springs' own vertical resync transient (above)
  // into the same number would bound the wrong thing.
  const horizSpeeds = [];
  let maxHorizDecelPerTick = 0;
  let cameToRestTick = -1;
  let resleptTick = -1;
  let prevHorizSpeed = null;
  let finalSpeed3 = 0;
  const SHOVE_MAX_TICKS = 3000;
  for (let t = 1; t <= SHOVE_MAX_TICKS; t++) {
    tickOnce(vehicle, body, flatTerrain, handlers);
    const horizSpeed = Math.hypot(body.v[0], body.v[2]);
    horizSpeeds.push(horizSpeed);
    if (prevHorizSpeed !== null && horizSpeed < prevHorizSpeed) {
      const decel = (prevHorizSpeed - horizSpeed) / TICK;
      if (decel > maxHorizDecelPerTick) maxHorizDecelPerTick = decel;
    }
    prevHorizSpeed = horizSpeed;
    finalSpeed3 = Math.hypot(body.v[0], body.v[1], body.v[2]);
    if (cameToRestTick < 0 && finalSpeed3 < 0.02) cameToRestTick = t;
    if (body.sleeping) { resleptTick = t; break; }
  }

  shoveResults.peakSpeed = Math.max(...horizSpeeds);
  shoveResults.finalSpeed = finalSpeed3;
  shoveResults.cameToRestTick = cameToRestTick;
  shoveResults.resleptTick = resleptTick;
  shoveResults.maxDecelPerTick = maxHorizDecelPerTick;
  shoveResults.movedAtAll = shoveResults.peakSpeed > 0.5;

  // Off-centre impulse at one wheel's world position: yaws the body.
  body.wake();
  const corner = [body.pos[0] + 1, body.pos[1], body.pos[2] + 1.5];
  body.addAccelerationAt(corner, [0, 0, 8]);
  const wBefore = [...body.w];
  vehicle.accumulate(TICK);
  body.step(TICK);
  const wAfterStep = [...body.w];
  vehicle.detectGround(flatTerrain, handlers);
  vehicle.resolve();

  shoveResults.offCentre = { wBefore, wAfterStep };
}
out.shove = shoveResults;

// --- (d) 10-degree slope: static friction holds, no creep -------------------

const SLOPE_DEG = 10;
const slopeRad = SLOPE_DEG * Math.PI / 180;
const slopeTerrain = {
  height: (x) => -x * Math.tan(slopeRad),
  normal: (x, z, o) => { o[0] = Math.sin(slopeRad); o[1] = Math.cos(slopeRad); o[2] = 0; return o; },
  material: () => 0,
  waterLevel: -Infinity,
};

// Collocated wheels: every wheel at the same (x, z) footprint, so the slope
// (which varies height with x) does not need the hull to roll/pitch to
// settle — isolates the friction/creep question this test is about from the
// unrelated question of a tilted hull's own rotational equilibrium.
//
// A very large `box` (-> very large rotational inertia, §4.2's box-shaped
// inertia scales with the extents) is used for THIS vehicle only: friction
// applied below the centre of mass (every wheel sits at `REST_Y`) is a real
// lever arm and DOES produce a genuine roll torque on a slope — confirmed by
// instrumenting a normal-sized box, which tips, keeps tipping as its own
// "up" axis leans away from vertical, and runs away long before anything
// related to `addFriction`'s creep-prevention gets a fair test. That
// rotational settling question is real but unrelated to what test (d) is
// about (§8's `V.y += g/30` term, a per-part translational effect) and the
// corpus does not pin down a vehicle's rotational equilibrium on a slope at
// all — so it is deliberately engineered away here rather than chased.
// `test_body_ground.py`'s shove test already exercises real, human-scale
// rotation (the off-centre-impulse yaw) with the ordinary `box`.
const COLLOCATED_OFFSETS = [[0, REST_Y, 0], [0, REST_Y, 0], [0, REST_Y, 0], [0, REST_Y, 0]];
const onSlope = buildVehicle({
  position: [0, 0.2 - REST_Y, 0], wheelOffsets: COLLOCATED_OFFSETS, box: [20, 20, 20],
});

let slopeSettleTicks = -1;
const SLOPE_MAX_TICKS = 3000;
for (let t = 1; t <= SLOPE_MAX_TICKS; t++) {
  tickOnce(onSlope.vehicle, onSlope.body, slopeTerrain, handlers);
  if (onSlope.body.sleeping) { slopeSettleTicks = t; break; }
}

const xAtSleep = onSlope.body.pos[0];
let xAfterExtra = xAtSleep;
if (slopeSettleTicks > 0) {
  const EXTRA_TICKS = 300;
  for (let i = 0; i < EXTRA_TICKS; i++) {
    tickOnce(onSlope.vehicle, onSlope.body, slopeTerrain, handlers);
  }
  xAfterExtra = onSlope.body.pos[0];
}

out.slope = {
  slopeDeg: SLOPE_DEG,
  settleTicks: slopeSettleTicks,
  xAtSleep, xAfterExtra,
  drift: Math.abs(xAfterExtra - xAtSleep),
  finalBodyPos: [...onSlope.body.pos],
  finalSleeping: onSlope.body.sleeping,
};

process.stdout.write(JSON.stringify(out));
