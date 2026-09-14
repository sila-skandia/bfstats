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
  JUMP_SPEED, STEP_HEIGHT,
} from './physics.mjs';
import {
  buildHeightfield, buildCollisionIndex, WorldCollider,
} from './collision.mjs';

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
  jumpSpeed: JUMP_SPEED,
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

// Yaw pi/2 faces +X, which is into the level rather than out of it.
results.walkSpeeds = {
  standForward: walk(ground, { forward: 1 }, 1).travelled,
  standBack: walk(ground, { forward: -1 }, 1).travelled,
  standStrafe: walk(ground, { strafe: 1 }, 1).travelled,
  standWalking: walk(ground, { forward: 1, walk: true }, 1).travelled,
  crouchForward: walk(ground, { forward: 1 }, 1, { pose: POSE_CROUCH }).travelled,
  crouchStrafe: walk(ground, { strafe: 1 }, 1, { pose: POSE_CROUCH }).travelled,
  proneForward: walk(ground, { forward: 1 }, 1, { pose: POSE_PRONE }).travelled,
  // Diagonal must not beat the table by sqrt(2).
  diagonal: walk(ground, { forward: 1, strafe: 1 }, 1).travelled,
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

// Water: the ground the feet find is max(heightfield, waterLevel).
const sea = new WorldCollider({ heightfield: field, waterLevel: 3 });
const floated = walk(sea, {}, 2, { start: { x: 4, y: 20, z: -32 } });
results.standsOnTheSea = { y: floated.y, grounded: floated.grounded };

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

// Jump: leaves the ground, peaks near the documented apex, and comes back.
const jumper = new SoldierBody({ world: ground, yaw: 0 });
jumper.place(4, 0, -32);
jumper.step(TICK_DT, {});
jumper.jump();
let apex = 0;
let airborne = 0;
for (let i = 0; i < 120; i++) {
  jumper.step(TICK_DT, {});
  apex = Math.max(apex, jumper.position.y);
  if (!jumper.grounded) airborne++;
}
results.jump = {
  apex, airborne, landed: jumper.grounded, y: jumper.position.y,
  // The apex a v0 of JUMP_SPEED reaches under this gravity.
  predicted: (JUMP_SPEED * JUMP_SPEED) / (2 * Math.abs(GRAVITY)),
};
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
