// Drives `viewer/physics.js` outside a browser and prints one JSON blob.
//
// Same shape as `collision_harness.mjs`, and for the same reason: neither module
// imports anything, so node can run both with no renderer and no GL.
// `tests/test_physics.py` copies `physics.js` *and* `collision.js` into a
// temporary directory as `.mjs` and asserts on the output. The collision module
// is here because the interesting half of a walking body is what it does when
// it meets a real hull, and a fake world would only test the fake.

import {
  GRAVITY, SUB_STEPS, TICK_DT, PointBody, FixedStep, SoldierBody,
  DIRECTIONAL_SPEED, STRAFE_SPEED, WALK_SPEED_FACTOR, directionalSpeed,
  poseFromFlags, POSE_STAND, POSE_CROUCH, POSE_PRONE,
  POSE_FLAG_CROUCH, POSE_FLAG_PRONE, EYE_HEIGHT, BODY_RADIUS,
  SOLDIER_MASS, SOLDIER_BOUNDING_RADIUS, PARACHUTE_DRAG, PARACHUTE_SPEED,
  JUMP_IMPULSE, JUMP_COMMAND_KICK, JUMP_CONTACT_NORMAL_Y, MATERIAL_WATER,
  LOCOMOTION_GAIN, MAX_GROUND_SLOPE, STEP_HEIGHT,
  RAMP_ACCEL, RAMP_DECEL, RAMP_LIMIT, RAMP_SCALE, ENGINE_TICK_RATE,
  RAMP_TO_FULL_SECONDS, RAMP_TO_STOP_SECONDS,
  applyMovementFactors, rampedDirectionalSpeed, rampedStrafeSpeed,
} from './physics.mjs';
import {
  buildHeightfield, buildCollisionIndex, WorldCollider,
} from './collision.mjs';
import { SwimState, SWIM_FLOAT_DRAFT, SWIM_ACCEL_GAIN } from './swim.js';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** The four fields of a three.js Mesh that `collision.js` actually reads. */
function fakeMesh(positions, { index = null, material = 0, matrix = IDENTITY,
                               collision = true, kind = '' } = {}) {
  const node = {
    isMesh: true,
    name: kind || 'mesh',
    parent: null,
    children: [],
    userData: collision ? { collision: true } : { kind },
    matrixWorld: { elements: matrix },
    geometry: {
      attributes: {
        position: {
          array: Float32Array.from(positions),
          count: positions.length / 3,
        },
      },
      index: index ? { array: Uint32Array.from(index), count: index.length } : null,
      userData: { defenseMaterial: material, collision },
    },
    traverse(fn) { fn(node); for (const c of node.children) c.traverse(fn); },
  };
  return node;
}

function group(children) {
  const node = {
    children, parent: null, userData: {},
    traverse(fn) { fn(node); for (const c of children) c.traverse(fn); },
  };
  for (const c of children) c.parent = node;
  return node;
}

// A 64 m world on a 4 m lattice at a constant height, emitted as loose
// triangles the way an exported terrain tile is. Z is negated by the exporter,
// so the level occupies x in [0, 64] and z in [-64, 0].
function flatTile(height = 0, worldSize = 64, spacing = 4) {
  const positions = [];
  for (let iz = 0; iz < worldSize / spacing; iz++) {
    for (let ix = 0; ix < worldSize / spacing; ix++) {
      const x0 = ix * spacing, x1 = x0 + spacing;
      const z0 = -iz * spacing, z1 = z0 - spacing;
      positions.push(x0, height, z0, x1, height, z0, x1, height, z1);
      positions.push(x0, height, z0, x1, height, z1, x0, height, z1);
    }
  }
  return fakeMesh(positions, { collision: false, kind: 'terrain' });
}

/** An axis-aligned box as 12 triangles, for a body to walk into and onto. */
function box(x0, y0, z0, x1, y1, z1, material = 92) {
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
    [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
  ];
  const faces = [
    [0, 1, 2], [0, 2, 3],   // bottom
    [4, 6, 5], [4, 7, 6],   // top
    [0, 5, 1], [0, 4, 5],
    [1, 6, 2], [1, 5, 6],
    [2, 7, 3], [2, 6, 7],
    [3, 4, 0], [3, 7, 4],
  ];
  const positions = [];
  for (const f of faces) for (const i of f) positions.push(...v[i]);
  return fakeMesh(positions, { material });
}

const results = {};

// --- the constants themselves ----------------------------------------------

results.constants = {
  gravity: GRAVITY,
  subSteps: SUB_STEPS,
  tickDt: TICK_DT,
  directional: [...DIRECTIONAL_SPEED],
  strafe: [...STRAFE_SPEED],
  walkFactor: WALK_SPEED_FACTOR,
  eyeHeights: [...EYE_HEIGHT],
  jumpImpulse: JUMP_IMPULSE,
  jumpCommandKick: JUMP_COMMAND_KICK,
  jumpContactNormalY: JUMP_CONTACT_NORMAL_Y,
  locomotionGain: LOCOMOTION_GAIN,
  materialWater: MATERIAL_WATER,
};

// The table indexing at 0x005013f8, over every pose and both signs of input.
results.speedTable = {
  standForward: directionalSpeed(POSE_STAND, 1),
  standBack: directionalSpeed(POSE_STAND, -1),
  standStill: directionalSpeed(POSE_STAND, 0),
  crouchForward: directionalSpeed(POSE_CROUCH, 1),
  crouchBack: directionalSpeed(POSE_CROUCH, -1),
  proneForward: directionalSpeed(POSE_PRONE, 1),
  proneBack: directionalSpeed(POSE_PRONE, -1),
};
results.poses = {
  none: poseFromFlags(0),
  crouch: poseFromFlags(POSE_FLAG_CROUCH),
  prone: poseFromFlags(POSE_FLAG_PRONE),
  // Crouch is tested first, so it wins if both bits are somehow set.
  both: poseFromFlags(POSE_FLAG_CROUCH | POSE_FLAG_PRONE),
};

// --- the integrator --------------------------------------------------------

// One tick of pure gravity. Four sub-steps of h = dt/4, each adding a*h to v and
// then v*h to the position, sum to a*h^2*(1+2+3+4) = 10*a*dt^2/16 = 0.625*a*dt^2
// -- distinguishable from a single semi-implicit step (1.0), an explicit one
// (0.0) and the exact answer (0.5). That ratio is the whole test.
const faller = new PointBody({ mass: 100, drag: 0 });
faller.updatePhysics(TICK_DT);
results.oneTick = {
  velocityY: faller.velocity.y,
  deltaY: faller.delta.y,
  ratio: faller.delta.y / (GRAVITY * TICK_DT * TICK_DT),
  // Spent and cleared, then re-seeded with exactly one gravity.
  accelY: faller.accel.y,
};

// A second of free fall, and the accumulator must not compound.
const drop = new PointBody({ mass: 100, drag: 0 });
for (let i = 0; i < 60; i++) drop.updatePhysics(TICK_DT);
results.oneSecond = { velocityY: drop.velocity.y, y: drop.position.y };

// An added acceleration is spent once and then gone.
const pushed = new PointBody({ mass: 100, drag: 0, gravityModifier: 0 });
pushed.addAcceleration(10, 0, 0);
pushed.updatePhysics(TICK_DT);
const afterPush = pushed.velocity.x;
pushed.updatePhysics(TICK_DT);
results.accelIsSpentOnce = {
  after: afterPush, later: pushed.velocity.x, same: pushed.velocity.x === afterPush,
};

// --- drag ------------------------------------------------------------------

// Terminal velocity under the parachute's drag. The shipped pair is
// setParachuteDrag 24 / setParachuteSpeed 30, and the drag equation reproduces
// the second from the first -- which is the evidence for the equation's shape.
const chute = new PointBody({
  mass: SOLDIER_MASS, drag: PARACHUTE_DRAG,
  boundingRadius: SOLDIER_BOUNDING_RADIUS,
});
for (let i = 0; i < 60 * 30; i++) chute.updatePhysics(TICK_DT);
results.parachute = {
  terminal: Math.abs(chute.velocity.y),
  declared: PARACHUTE_SPEED,
  // The closed form the loop is converging on.
  closedForm: Math.abs(GRAVITY) / (Math.PI * SOLDIER_BOUNDING_RADIUS
    * SOLDIER_BOUNDING_RADIUS * PARACHUTE_DRAG / SOLDIER_MASS),
};

// A soldier's own drag 1.0 is nearly inert -- a man falls in near-vacuum.
const bare = new PointBody({
  mass: SOLDIER_MASS, drag: 1, boundingRadius: SOLDIER_BOUNDING_RADIUS,
});
for (let i = 0; i < 60; i++) bare.updatePhysics(TICK_DT);
results.soldierDragIsNearlyInert = Math.abs(bare.velocity.y);

// Wind-relative, not plain -drag*v: a body at rest in a wind is pushed by it.
const still = new PointBody({
  mass: 100, drag: 24, boundingRadius: 0.8, gravityModifier: 0,
});
still.updatePhysics(TICK_DT, { wind: { x: 10, y: 0, z: 0 } });
results.windPushesAStillBody = still.velocity.x;

// --- the fixed clock -------------------------------------------------------

const clock = new FixedStep();
const ticks = [];
ticks.push(clock.advance(1 / 60));          // exactly one
ticks.push(clock.advance(1 / 120));         // half of one: none yet
const halfAlpha = clock.alpha;
ticks.push(clock.advance(1 / 120));         // the other half: one
ticks.push(clock.advance(0.1));             // six
ticks.push(clock.advance(30));              // capped, and the rest dropped
results.clock = {
  ticks, halfAlpha, dropped: clock.dropped,
  cappedAt: ticks[4],
  // After the cap the accumulator must be back under one tick, not owing 30 s.
  accumulator: clock.accumulator,
};

// --- the swept sphere ------------------------------------------------------

// A wall across x = 8, 10 m tall, spanning z -10..0.
const wall = fakeMesh(
  [8, 0, 0, 8, 0, -10, 8, 10, -10, 8, 10, 0],
  { index: [0, 1, 2, 0, 2, 3], material: 92 });
const statics = buildCollisionIndex(group([wall]), { ownerRoots: [wall] });
const walled = new WorldCollider({ statics });

// Head-on: a 0.5 m sphere from x = 0 stops with its centre 0.5 m short.
const head = walled.sweepSphere(0, 5, -5, 1, 0, 0, 16, 0.5);
results.sweepFace = head && {
  t: head.t, x: head.x, nx: head.nx, ny: head.ny, nz: head.nz,
  material: head.material, kind: head.kind,
};
// A point ray down the same line stops at the wall itself, 0.5 m further on:
// the radius is the whole difference between the two queries.
const ray = walled.cast(0, 5, -5, 1, 0, 0, 16, -1);
results.sweepVsCast = { sweep: head && head.t, cast: ray && ray.t };

// Past the top edge: the centre passes 0.3 m above the parapet, so the face
// test misses and the edge quadratic is what has to catch it.
const edge = walled.sweepSphere(0, 10.3, -5, 1, 0, 0, 16, 0.5);
results.sweepEdge = edge && {
  t: edge.t, x: edge.x, ny: edge.ny,
  // The contact must be on the wall's top edge, not on its face.
  py: edge.py, px: edge.px,
};
// Clear over the top by more than the radius: nothing.
results.sweepClears = walled.sweepSphere(0, 11, -5, 1, 0, 0, 16, 0.5) === null;
// Round the end of the wall, past z = 0.
results.sweepMissesPastTheEnd =
  walled.sweepSphere(0, 5, 1, 1, 0, 0, 16, 0.5) === null;
// Backwards, and short.
results.sweepBehind = walled.sweepSphere(0, 5, -5, -1, 0, 0, 16, 0.5) === null;
results.sweepShort = walled.sweepSphere(0, 5, -5, 1, 0, 0, 4, 0.5) === null;
// Thin-wall tunnelling, the reason this is a sweep: one 16 m step over a
// zero-thickness quad. A point test at the destination sees nothing.
results.sweepDoesNotTunnel = Boolean(
  walled.sweepSphere(0, 5, -5, 1, 0, 0, 16, 0.5));
// Landing on a roof: straight down onto the top of a box.
const roof = buildCollisionIndex(group([box(0, 0, -10, 10, 3, 0)]));
const roofed = new WorldCollider({ statics: roof });
const down = roofed.sweepSphere(5, 8, -5, 0, -1, 0, 10, 0.5);
results.sweepRoof = down && { t: down.t, y: down.y, py: down.py, ny: down.ny };

// --- a body that walks -----------------------------------------------------

const field = buildHeightfield([flatTile(0)], { worldSize: 64, dim: 16 });
const ground = new WorldCollider({ heightfield: field });

/** Run a body for `seconds` of fixed ticks and report where it got to. */
function walk(world, input, seconds, { yaw = Math.PI / 2, start = null,
                                       pose = null, setup = null } = {}) {
  const soldier = new SoldierBody({ world, yaw });
  soldier.place(start?.x ?? 4, start?.y ?? 0, start?.z ?? -32, yaw);
  if (pose === POSE_CROUCH) soldier.setCrouch(true);
  if (pose === POSE_PRONE) soldier.setProne(true);
  setup?.(soldier);
  // One settling tick so `grounded` is true before the first input, the way a
  // spawned body gets one before the player touches anything.
  soldier.step(TICK_DT, {});
  const from = { ...soldier.position };
  for (let i = 0; i < Math.round(seconds * 60); i++) soldier.step(TICK_DT, input);
  return {
    soldier,
    travelled: Math.hypot(soldier.position.x - from.x, soldier.position.z - from.z),
    x: soldier.position.x, y: soldier.position.y, z: soldier.position.z,
    grounded: soldier.grounded,
  };
}

/**
 * The same, but with the movement ramp already saturated before the clock
 * starts — so the distance is the table speed rather than the table speed
 * minus a ramp-up. `warm` seconds of the same input are spent first.
 */
function cruise(world, input, seconds, opts = {}) {
  const yaw = opts.yaw ?? Math.PI / 2;
  const soldier = new SoldierBody({ world, yaw });
  soldier.place(opts.start?.x ?? 4, opts.start?.y ?? 0, opts.start?.z ?? -32, yaw);
  if (opts.pose === POSE_CROUCH) soldier.setCrouch(true);
  if (opts.pose === POSE_PRONE) soldier.setProne(true);
  soldier.step(TICK_DT, {});
  for (let i = 0; i < Math.round((opts.warm ?? 1) * 60); i++) soldier.step(TICK_DT, input);
  const from = { ...soldier.position };
  for (let i = 0; i < Math.round(seconds * 60); i++) soldier.step(TICK_DT, input);
  return Math.hypot(soldier.position.x - from.x, soldier.position.z - from.z);
}

// Yaw pi/2 faces +X, which is into the level rather than out of it.
results.walkSpeeds = {
  standForward: walk(ground, { forward: 1 }, 1).travelled,
  // Backwards runs start deeper into the field: yaw pi/2 walks -X, and the
  // 64 m lattice ends at x = 0. Off its edge `surfaceHeight` is NaN, the body
  // goes airborne, and the air-control law then accelerates it past the table.
  standBack: walk(ground, { forward: -1 }, 1, { start: { x: 40, y: 0, z: -32 } }).travelled,
  standStrafe: walk(ground, { strafe: 1 }, 1).travelled,
  standWalking: walk(ground, { forward: 1, walk: true }, 1).travelled,
  crouchForward: walk(ground, { forward: 1 }, 1, { pose: POSE_CROUCH }).travelled,
  crouchStrafe: walk(ground, { strafe: 1 }, 1, { pose: POSE_CROUCH }).travelled,
  proneForward: walk(ground, { forward: 1 }, 1, { pose: POSE_PRONE }).travelled,
  // Diagonal must not beat the table by sqrt(2).
  diagonal: walk(ground, { forward: 1, strafe: 1 }, 1).travelled,
};

// The same second of input once the ramp is saturated: now the table speed.
results.topSpeeds = {
  standForward: cruise(ground, { forward: 1 }, 1),
  standBack: cruise(ground, { forward: -1 }, 1, { start: { x: 40, y: 0, z: -32 } }),
  standStrafe: cruise(ground, { strafe: 1 }, 1),
  standWalking: cruise(ground, { forward: 1, walk: true }, 1),
  crouchForward: cruise(ground, { forward: 1 }, 1, { pose: POSE_CROUCH }),
  crouchStrafe: cruise(ground, { strafe: 1 }, 1, { pose: POSE_CROUCH }),
  proneForward: cruise(ground, { forward: 1 }, 1, { pose: POSE_PRONE }),
  diagonal: cruise(ground, { forward: 1, strafe: 1 }, 1),
};

// --- the movement ramp (PHY-6) ---------------------------------------------

/** Step a body at `rate` Hz and report its ramp register each tick. */
function rampLadder(rate, ticks, input, warm = null) {
  const dt = 1 / rate;
  const soldier = new SoldierBody({ world: ground, yaw: Math.PI / 2 });
  soldier.place(4, 0, -32);
  soldier.step(dt, {});
  if (warm) for (let i = 0; i < warm.ticks; i++) soldier.step(dt, warm.input);
  const out = [];
  for (let i = 0; i < ticks; i++) {
    soldier.step(dt, input);
    out.push(Number(soldier.forwardRamp.toFixed(6)));
  }
  return out;
}

/** Ticks at `rate` Hz before the register saturates, and before it empties. */
function rampTiming(rate) {
  const dt = 1 / rate;
  const soldier = new SoldierBody({ world: ground, yaw: Math.PI / 2 });
  soldier.place(4, 0, -32);
  soldier.step(dt, {});
  let up = 0;
  while (Math.abs(soldier.forwardRamp) < RAMP_LIMIT - 1e-9 && up < 1000) {
    soldier.step(dt, { forward: 1 }); up++;
  }
  let down = 0;
  while (Math.abs(soldier.forwardRamp) > 1e-9 && down < 1000) {
    soldier.step(dt, {}); down++;
  }
  return { rate, upTicks: up, downTicks: down, up: up * dt, down: down * dt };
}

results.ramp = {
  accel: RAMP_ACCEL, decel: RAMP_DECEL, limit: RAMP_LIMIT,
  scale: RAMP_SCALE, engineRate: ENGINE_TICK_RATE,
  nominalToFull: RAMP_TO_FULL_SECONDS, nominalToStop: RAMP_TO_STOP_SECONDS,
  // At the engine's own 30 Hz the register must walk the exact integer ladder
  // `applyMovementFactors` produces: +20 a tick to a 127 clamp, -12 a tick to a
  // hard zero. Any rate scaling that is not exact shows up here first.
  up30: rampLadder(30, 9, { forward: 1 }),
  down30: rampLadder(30, 12, {}, { ticks: 20, input: { forward: 1 } }),
  // Reversal snaps through zero rather than decelerating through it:
  // `max(min(state, 0) - 20, -127)` from a saturated +127 is -20, not +107.
  reversal30: rampLadder(30, 1, { forward: -1 },
                         { ticks: 20, input: { forward: 1 } })[0],
  timing: [rampTiming(30), rampTiming(60), rampTiming(120)],
};

// The table slot is chosen from the ramp byte, not the raw input: a soldier
// still coasting forward on a positive register reads the forward row even
// with the key released, and only flips to the backward row once it is <= 0.
results.rampChoosesTheSlot = {
  forwardAtFullRamp: rampedDirectionalSpeed(POSE_STAND, RAMP_LIMIT),
  backAtFullRamp: rampedDirectionalSpeed(POSE_STAND, -RAMP_LIMIT),
  // Half a register is half the speed, off the same row.
  forwardAtHalf: rampedDirectionalSpeed(POSE_STAND, RAMP_LIMIT / 2),
  // Zero takes the "not forward" row, but scales it to nothing.
  atZero: rampedDirectionalSpeed(POSE_STAND, 0),
  walkingAtFull: rampedDirectionalSpeed(POSE_STAND, RAMP_LIMIT, true),
  strafeAtFull: rampedStrafeSpeed(POSE_STAND, RAMP_LIMIT),
};

// Only the sign of the input is read: a half-pressed axis ramps at the same
// rate and to the same ceiling as a fully pressed one.
results.rampReadsTheSignOnly = {
  full: applyMovementFactors(1, 0, 1 / 30),
  quarter: applyMovementFactors(0.25, 0, 1 / 30),
  negative: applyMovementFactors(-0.25, 0, 1 / 30),
};

// Direction, not just distance: +X at yaw pi/2, -Z at yaw pi.
const heading = walk(ground, { forward: 1 }, 1);
results.walkHeading = { dx: heading.x - 4, dz: heading.z + 32 };
const backwards = walk(ground, { forward: 1 }, 1, { yaw: Math.PI });
results.walkHeadingPi = { dx: backwards.x - 4, dz: backwards.z + 32 };

// The ground clamp: dropped from 20 m onto flat terrain, it lands and stops.
const dropped = walk(ground, {}, 3, { start: { x: 4, y: 20, z: -32 } });
results.landsOnTerrain = {
  y: dropped.y, grounded: dropped.grounded,
  vy: dropped.soldier.velocity.y,
};

// The fall arc itself, sampled: a 20 m drop under -14.73 takes sqrt(2h/g) and
// the samples must sit on that curve, not on a 9.81 one.
const arc = new SoldierBody({ world: ground, yaw: 0 });
arc.place(4, 20, -32);
const arcSamples = [];
for (let i = 1; i <= 60; i++) {
  arc.step(TICK_DT, {});
  if (i % 20 === 0) arcSamples.push({ t: i / 60, y: arc.position.y });
}
results.fallArc = arcSamples;

// Water. `WorldCollider.surfaceHeight` answers max(heightfield, waterLevel) and
// a body used to be settled onto that, so it stood on the sea and could walk out
// to the horizon. It cannot any more: the engine has no surface there for a
// soldier -- `BFSoldier::updateSwimming` is the only thing that ever puts a
// soldier's y on the water, and it puts it 0.4 m under.
//
// Three metres of water over a flat seabed at 0.
const sea = new WorldCollider({ heightfield: field, waterLevel: 3 });
// With no swim collaborator the surface is not a floor at all, so the body goes
// through it and settles on the seabed: honest "not modelled" rather than
// "walks on water".
const noSwim = walk(sea, {}, 2, { start: { x: 4, y: 20, z: -32 } });
results.withoutASwimStateHeSinksToTheBed = {
  y: noSwim.y, grounded: noSwim.grounded, bed: 0, waterLevel: 3 };
// With one he floats at `waterLevel - SWIM_FLOAT_DRAFT` and `c_AsmIsSwimming` is
// up. Dropped from 20 m, so his vertical velocity when he hits is 19 m/s and the
// draft is a clamp, not a settle.
const swam = walk(sea, {}, 3, {
  start: { x: 4, y: 20, z: -32 },
  setup: s => { s.swim = new SwimState(); },
});
results.swimsInsteadOfStanding = {
  y: swam.y, grounded: swam.grounded, swimming: swam.soldier.swimming,
  depth: swam.soldier.swimDepth,
  draft: SWIM_FLOAT_DRAFT, waterLevel: 3,
  family: swam.soldier.swim.family,
};
// Wading: 20 cm of water over a seabed at 2.8 is under the 0.43 threshold, so he
// walks on the bed with the bed's own normal and never enters the swim state.
const shallowField = buildHeightfield([flatTile(2.8)], { worldSize: 64, dim: 16 });
const shallow = new WorldCollider({ heightfield: shallowField, waterLevel: 3 });
const waded = walk(shallow, { forward: 1 }, 2, {
  start: { x: 4, y: 2.8, z: -32 },
  setup: s => { s.swim = new SwimState(); },
});
results.wadesOnTheSeabed = {
  y: waded.y, grounded: waded.grounded, swimming: waded.soldier.swimming,
  depth: waded.soldier.swimDepth, travelled: waded.travelled,
};
// Swimming into the shallows: the seabed has to be able to end the swim.
//
// This is the ordering trap. The pin puts the feet at `surface - 0.4` every
// tick, so a depth measured BEFORE the resolve is always exactly 0.4 and the
// 0.35 exit test can never fire -- a man swimming at a beach would never stand
// up. The engine measures it in `handleUpdate`, after the tick's resolve, where
// the seabed has already pushed him up. Started over deep water, then the bed is
// raised to 2.7 (0.3 m of water, inside the exit threshold).
{
  const swimmer = new SoldierBody({ world: sea, yaw: Math.PI / 2 });
  swimmer.swim = new SwimState();
  swimmer.place(4, 2.5, -32);
  for (let i = 0; i < 60; i++) swimmer.step(TICK_DT, {});
  const afloat = { swimming: swimmer.swimming, y: swimmer.position.y,
                   family: swimmer.swim.family };
  const shelf = buildHeightfield([flatTile(2.7)], { worldSize: 64, dim: 16 });
  swimmer.world = new WorldCollider({ heightfield: shelf, waterLevel: 3 });
  const trace = [];
  for (let i = 0; i < 90; i++) {
    swimmer.step(TICK_DT, {});
    if (i % 10 === 0) {
      trace.push({ tick: i, family: swimmer.swim.family,
                   swimming: swimmer.swimming,
                   depth: +swimmer.swimDepth.toFixed(3),
                   y: +swimmer.position.y.toFixed(3),
                   grounded: swimmer.grounded });
    }
  }
  results.swimsIntoTheShallows = {
    afloat,
    sawExitClip: trace.some(t => t.family === 'swimEnd'),
    ended: { swimming: swimmer.swimming, family: swimmer.swim.family,
             grounded: swimmer.grounded,
             y: +swimmer.position.y.toFixed(3),
             depth: +swimmer.swimDepth.toFixed(3) },
    trace,
  };
}

// Swimming forward: the `5.0 * vCmd` acceleration against the water's drag, with
// no `v = vCmd` assignment anywhere, so the speed is a balance and not a table
// entry. What matters is that he moves, in the direction he is facing, and slower
// than the 6 m/s the standing row of `directionalSpeed` names.
const stroked = walk(sea, { forward: 1 }, 6, {
  start: { x: 4, y: 2.6, z: -32 },
  setup: s => { s.swim = new SwimState(); },
});
results.swimsForward = {
  travelled: stroked.travelled, speed: stroked.soldier.groundSpeed,
  y: stroked.y, family: stroked.soldier.swim.family,
  runSpeed: DIRECTIONAL_SPEED[0],
};

// Hulls: a wall at x = 8 across the walker's path.
const blocker = fakeMesh(
  [8, 0, -40, 8, 0, -24, 8, 6, -24, 8, 6, -40],
  { index: [0, 1, 2, 0, 2, 3], material: 92 });
const town = new WorldCollider({
  heightfield: field,
  statics: buildCollisionIndex(group([blocker]), { ownerRoots: [blocker] }),
});
const stopped = walk(town, { forward: 1 }, 3);
results.stopsAtTheWall = {
  x: stopped.x, contacts: stopped.soldier.contacts,
  // Free ground would have carried it 18 m; it must be parked one radius short.
  short: 8 - BODY_RADIUS - stopped.x,
};
// Facing 45 degrees into a wall long enough that it cannot get round the end:
// it slides along the face rather than sticking to it or passing through.
const longWall = fakeMesh(
  [8, 0, -64, 8, 0, 0, 8, 6, 0, 8, 6, -64],
  { index: [0, 1, 2, 0, 2, 3], material: 92 });
const corridor = new WorldCollider({
  heightfield: field,
  statics: buildCollisionIndex(group([longWall])),
});
const sliding = walk(corridor, { forward: 1 }, 2, { yaw: Math.PI / 4 });
results.slidesAlongTheWall = {
  x: sliding.x, z: sliding.z, movedAlong: Math.abs(sliding.z + 32),
};

// A kerb the body steps onto, and a wall it does not.
const stepUp = new WorldCollider({
  heightfield: field,
  statics: buildCollisionIndex(group([box(8, 0, -40, 20, 0.3, -24)])),
});
const stepped = walk(stepUp, { forward: 1 }, 2);
results.stepsOntoAKerb = { x: stepped.x, y: stepped.y, grounded: stepped.grounded };
const tooTall = new WorldCollider({
  heightfield: field,
  statics: buildCollisionIndex(group([box(8, 0, -40, 20, 2.5, -24)])),
});
const blocked = walk(tooTall, { forward: 1 }, 2);
results.doesNotClimbAWall = { x: blocked.x, y: blocked.y };

// Jump: leaves the ground, peaks at the documented apex, and comes back.
//
// `rate` matters and is the whole point of taking it as a parameter. PHY-1's
// 1.12 m / 0.80 s are what the engine's four sub-steps of `dt/4` produce at its
// own 30 Hz, and they come out only if the impulse goes through the
// acceleration accumulator beside gravity. The viewer's 60 Hz step integrates
// nearer the continuum and lands a little higher; both are reported so the
// parity figure is asserted separately from the regression figure.
function jumpArc(rate, world = ground, input = {}) {
  const dt = 1 / rate;
  const jumper = new SoldierBody({ world, yaw: 0 });
  jumper.place(4, 0, -32);
  for (let i = 0; i < 4; i++) jumper.step(dt, input);
  jumper.jump();
  let apex = 0, airborne = 0, left = false;
  for (let i = 0; i < Math.round(4 * rate); i++) {
    jumper.step(dt, input);
    apex = Math.max(apex, jumper.position.y);
    if (!jumper.grounded) { airborne++; left = true; } else if (left) break;
  }
  return {
    rate, apex, airborne, airTime: airborne * dt,
    landed: jumper.grounded, y: jumper.position.y,
    // The continuum figures the discrete integrator must NOT reproduce.
    continuumApex: (JUMP_IMPULSE * JUMP_IMPULSE) / (2 * Math.abs(GRAVITY)),
    continuumAir: 2 * JUMP_IMPULSE / Math.abs(GRAVITY),
  };
}
results.jump = jumpArc(60);
results.jump30 = jumpArc(30);

// A running jump: the `-0.25 * vCmd` kick lands on the velocity, so a soldier
// at a full 6 m/s leaves the ground at 4.5 m/s and then claws it back through
// the airborne `0.75 * vCmd` force. Sampled the tick after take-off.
const runner = new SoldierBody({ world: ground, yaw: Math.PI / 2 });
runner.place(4, 0, -32, Math.PI / 2);
runner.step(TICK_DT, {});
for (let i = 0; i < 60; i++) runner.step(TICK_DT, { forward: 1 });
const beforeJump = runner.groundSpeed;
runner.jump();
runner.step(TICK_DT, { forward: 1 });
const afterJump = runner.groundSpeed;
let airPeak = afterJump;
for (let i = 0; i < 120 && !runner.grounded; i++) {
  runner.step(TICK_DT, { forward: 1 });
  airPeak = Math.max(airPeak, runner.groundSpeed);
}
results.runningJump = {
  before: beforeJump, after: afterJump, airPeak,
  // What the kick costs, as a fraction of the commanded speed.
  fraction: afterJump / beforeJump,
};

// Air control is the engine's `0.75 * vCmd` acceleration, not a lerp: from a
// standing jump with forward held, the horizontal speed climbs linearly at
// 4.5 m/s^2 rather than snapping to the table speed.
const airborneSteer = new SoldierBody({ world: ground, yaw: Math.PI / 2 });
airborneSteer.place(4, 40, -32, Math.PI / 2);
airborneSteer.step(TICK_DT, {});
const steerSamples = [];
for (let i = 1; i <= 60; i++) {
  airborneSteer.step(TICK_DT, { forward: 1 });
  if (i % 20 === 0) {
    steerSamples.push({ t: i / 60, speed: airborneSteer.groundSpeed });
  }
}
results.airControl = {
  samples: steerSamples,
  gain: LOCOMOTION_GAIN,
  // 0.75 * 6 m/s, the acceleration a full forward command buys in the air.
  predictedAccel: LOCOMOTION_GAIN * DIRECTIONAL_SPEED[0],
};

// --- the jump gate is a contact normal, not a slope limit (PHY-1) ----------

// A face at 80 degrees: normal.y = cos(80) = 0.174, which clears the engine's
// 0.1 but is far past `MAX_GROUND_SLOPE` (cos 60 = 0.5). The engine arms a jump
// there; a `grounded` test would not.
function armingFor(ny, material) {
  const soldier = new SoldierBody({ world: ground, yaw: 0 });
  soldier.place(4, 0, -32);
  soldier.step(TICK_DT, {});
  // Drive the arming the way a contact does, through the same private path the
  // resolver uses: a synthetic world whose settle reports this normal.
  const flat = Math.sqrt(Math.max(0, 1 - ny * ny));
  const faked = new SoldierBody({
    world: {
      waterLevel: null,
      surfaceHeight: () => 0,
      heightfield: {
        normal: (x, z, out) => { out[0] = flat; out[1] = ny; out[2] = 0; return out; },
        material: () => material,
      },
    },
    yaw: 0,
  });
  faked.place(4, 0, -32);
  faked.step(TICK_DT, {});
  return { armed: faked.jumpArmed, grounded: faked.grounded, ny };
}
results.jumpGate = {
  threshold: JUMP_CONTACT_NORMAL_Y,
  maxGroundSlope: MAX_GROUND_SLOPE,
  flat: armingFor(1.0, 4),
  // 80 degrees: armed, and deliberately not `grounded` by the viewer's own
  // stricter walk test.
  steep: armingFor(Math.cos(80 * Math.PI / 180), 4),
  // 87 degrees: normal.y = 0.052, under the threshold. No jump.
  tooSteep: armingFor(Math.cos(87 * Math.PI / 180), 4),
  // Flat, but material 1 is Water. Treading water never arms a jump.
  water: armingFor(1.0, MATERIAL_WATER),
};

// And the gate really governs: a swimmer cannot jump. He is not `grounded`, he
// is holding no contact worth arming, and the swim branch spends a queued jump
// rather than banking it for the moment he wades out.
const sea2 = new WorldCollider({ heightfield: field, waterLevel: 3 });
const swimmer = new SoldierBody({ world: sea2, yaw: 0 });
swimmer.swim = new SwimState();
swimmer.place(4, 20, -32);
for (let i = 0; i < 180; i++) swimmer.step(TICK_DT, {});
const floatY = swimmer.position.y;
swimmer.jump();
for (let i = 0; i < 10; i++) swimmer.step(TICK_DT, {});
results.cannotJumpOffWater = {
  floatY, after: swimmer.position.y, armed: swimmer.jumpArmed,
  rose: swimmer.position.y - floatY, swimming: swimmer.swimming,
  gain: SWIM_ACCEL_GAIN,
};
// --- thin geometry, and a body that starts inside it -----------------------
//
// `sweepCapsule` skips contacts the motion is already travelling away from.
// That is narrower than it sounds -- `#sweepTriangle` rejects a receding
// *face* before it computes anything (`nv >= -1e-9`), so the only contacts the
// skip can reach are edge and corner ones, whose separating direction can
// point anywhere. The thing to prove is that it did not open a hole: nothing
// that could stop the motion is dropped, so a 10 cm wall stays solid whether
// you walk into it, start overlapping it, or are put down inside it -- which
// is what leaving a seat beside a wall does (`map.html`'s `exitVehicle` trusts
// `soldierExitLocation` and lets `spawn()` settle it).
const FENCE_X0 = 9.95, FENCE_X1 = 10.05;
const fence = new WorldCollider({
  heightfield: field,
  statics: buildCollisionIndex(group([box(FENCE_X0, 0, -48, FENCE_X1, 3, -16)])),
});
function pushAt(startX, forward, seconds = 3) {
  const r = walk(fence, { forward }, seconds, { start: { x: startX, y: 0, z: -32 } });
  return { x: r.x, y: r.y, z: r.z, grounded: r.grounded,
           speed: Math.hypot(r.soldier.velocity.x, r.soldier.velocity.z),
           contacts: r.soldier.contacts };
}
results.thinWall = {
  bounds: [FENCE_X0, FENCE_X1],
  radius: BODY_RADIUS,
  // A clean run-up from 6 m away: stopped one radius short, on the near side.
  runUp: pushAt(4, 1),
  // Already overlapping the near face when the tick starts (centre 5 cm out,
  // which is inside the 30 cm sphere). This is the case the receding skip
  // touches, because the sphere is resting on the face's edge.
  fromInsideNear: pushAt(FENCE_X0 - 0.05, 1),
  // Put down dead centre *in* the wall, as an exit point inside a fence would
  // be, then told to walk into it.
  fromDeadCentre: pushAt((FENCE_X0 + FENCE_X1) / 2, 1),
  // And the mirror: overlapping the far face, walking back the other way.
  fromInsideFar: pushAt(FENCE_X1 + 0.05, -1),
};

// An inside corner: the push-out from one face moves the body along the other.
// Four slide passes have to settle it rather than shuttling between the two.
// Yaw pi/4 heads (+X, +Z), so the two faces that meet it are at x = 20 and
// z = -12 and the inside corner is the point (20, -12).
const CORNER_X = 20, CORNER_Z = -12;
const cornerWorld = new WorldCollider({
  heightfield: field,
  statics: buildCollisionIndex(group([
    box(CORNER_X, 0, -60, 40, 3, -4),        // face at x = 20
    box(0, 0, CORNER_Z, 40, 3, -4),          // face at z = -12
  ])),
});
{
  // Facing into the corner at 45 degrees from open ground.
  const s = new SoldierBody({ world: cornerWorld, yaw: Math.PI / 4 });
  s.place(4, 0, -28, Math.PI / 4);
  s.step(TICK_DT, {});
  let peakSpeed = 0, maxY = 0;
  const samples = [];
  for (let i = 0; i < 300; i++) {
    s.step(TICK_DT, { forward: 1 });
    peakSpeed = Math.max(peakSpeed, Math.hypot(s.velocity.x, s.velocity.z));
    maxY = Math.max(maxY, s.position.y);
    if (i >= 290) samples.push([+s.position.x.toFixed(5), +s.position.z.toFixed(5)]);
  }
  // How far the last ten ticks wandered: a limit cycle shows up here.
  const xs = samples.map(p => p[0]), zs = samples.map(p => p[1]);
  results.insideCorner = {
    x: s.position.x, z: s.position.z, y: s.position.y, maxY, peakSpeed,
    grounded: s.grounded,
    wanderX: Math.max(...xs) - Math.min(...xs),
    wanderZ: Math.max(...zs) - Math.min(...zs),
  };
}

// --- the kick lands on the ACTUAL velocity (PHY-1, item 1's third "do NOT") -
//
// A soldier pressed into `tooTall`'s 2.5 m face with the ramp saturated: his
// velocity is ~0 because the resolver strips it every tick, his command is a
// full 6 m/s into the wall, and the engine's `-0.25 * vCmd` is therefore a
// 1.5 m/s kick **backward, off the wall**. Reading it as `vCmd *= 0.75` — or
// arriving at the same thing by assigning `v = vCmd` before applying it —
// gives him 4.5 m/s *into* the wall instead, which the resolver then strips to
// nothing, and he rises straight up still touching it. The sign of `awayX` is
// the whole test.
function jumpFromAWall(world, yaw = Math.PI / 2) {
  const s = new SoldierBody({ world, yaw });
  s.place(4, 0, -32, yaw);
  // Two seconds is a run to the wall plus a second of standing on it, which
  // saturates the ramp while the velocity stays stripped.
  for (let i = 0; i < 120; i++) s.step(TICK_DT, { forward: 1 });
  const pressed = { x: s.position.x, vx: s.velocity.x, ramp: s.forwardRamp,
                    contacts: s.contacts };
  s.jump();
  s.step(TICK_DT, { forward: 1 });
  return {
    pressed,
    // Positive = into the wall (+X at yaw pi/2), negative = off it.
    awayX: s.velocity.x,
    vy: s.velocity.y,
    grounded: s.grounded,
  };
}
results.jumpOffAWall = jumpFromAWall(tooTall);
// The same body with nothing in front of it: the velocity already equals the
// command when the tick begins, so the assignment was a no-op either way and
// 6.0 still becomes 4.5. This is the case every measured figure comes from,
// and it must not have moved.
results.jumpInTheOpen = (() => {
  const s = new SoldierBody({ world: ground, yaw: Math.PI / 2 });
  s.place(4, 0, -32, Math.PI / 2);
  for (let i = 0; i < 120; i++) s.step(TICK_DT, { forward: 1 });
  const before = s.velocity.x;
  s.jump();
  s.step(TICK_DT, { forward: 1 });
  return { before, after: s.velocity.x, ratio: s.velocity.x / before };
})();

// Prone bodies do not jump.
const prone = new SoldierBody({ world: ground, yaw: 0 });
prone.place(4, 0, -32);
prone.setProne(true);
prone.step(TICK_DT, {});
prone.jump();
prone.step(TICK_DT, {});
results.proneDoesNotJump = prone.position.y <= 1e-6;

// Eye height follows the pose, and is animated rather than snapped.
const ducker = new SoldierBody({ world: ground, yaw: 0 });
ducker.place(4, 0, -32);
ducker.step(TICK_DT, {});
const eyeStanding = ducker.eyeHeight;
ducker.setCrouch(true);
ducker.step(TICK_DT, {});
const eyeOneTickLater = ducker.eyeHeight;
for (let i = 0; i < 60; i++) ducker.step(TICK_DT, {});
results.eye = {
  standing: eyeStanding,
  afterOneTick: eyeOneTickLater,
  crouched: ducker.eyeHeight,
  worldY: ducker.eye(1).y,
  stepHeight: STEP_HEIGHT,
};

process.stdout.write(JSON.stringify(results));
