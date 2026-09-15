// Drives `viewer/soldier.js` outside a browser and prints one JSON blob.
//
// `tests/test_soldier.py` copies this file, the module under test, `physics.js`
// and `collision.js` into a temporary directory and asserts on the output. The
// collider is the **real** `WorldCollider` over real fake meshes, not a stub,
// because the thing worth testing is the pair: a capsule that slides correctly
// against a mock but not against the module that ships is worth nothing. And
// since the merge that put `soldier.js` on top of `physics.js`, the body under
// it is the real one too — the engine's gravity, integrator and speed tables,
// not a presentation layer's idea of them.
//
// `tests/physics_harness.mjs` covers the body on its own: the integrator, the
// drag, the speed tables, the sweep. This one covers what `soldier.js` adds —
// the camera, the stances, the bob, the footstep clock, spawning at a flag —
// and asserts that the movement numbers arriving through it are still the
// engine's, which is the thing a presentation layer is most able to quietly
// break.
//
// The world, 64 m square on a 4 m lattice:
//
//    x=0..20   flat ground at y = 0
//    x=20..32  a 20-degree ramp, rising to 4.37 m  (walkable)
//    x=32..40  flat at 4.37 m
//    x=40..48  a 70-degree face, rising to 26.4 m  (refused)
//    x=48..64  flat at 26.4 m
//
// The face is 70 degrees and not 60 because `MAX_GROUND_SLOPE` is cos(60) and a
// 60-degree face sits exactly on the boundary, where the lattice's own bilinear
// normal decides it either way. 70 is unambiguously past the limit.
//
//  and, standing on the flat part:
//
//    a wall at x = 10, y 0..3, z -20..0
//    a kerb 0.30 m high from x = 13 to 15   (steppable: under STEP_HEIGHT)
//    a kerb 0.80 m high from x = 16 to 18   (not steppable)
//    a beam roofing x 12..20, z -34..-30 at y 1.40..1.60 (too low to stand under)
//    a 4 m platform at x 12..18, z -46..-40  (to walk off)
//
// Anything that needs a long clear run does it along -Z from z = -24 at x = 4,
// which is 40 m of flat ground with nothing whatever in it. A soldier covers
// that in under seven seconds now, which is worth remembering when reading the
// frame counts below: a run frame is 0.1 m, not the 0.038 m it used to be.

import {
  buildHeightfield, buildCollisionIndex, WorldCollider,
} from './collision.js';
import {
  Soldier, spawnFlags, pickSpawn, spawnYaw,
  EYE, HEIGHT, GAIT_SPEED, BODY_RADIUS, STEP_HEIGHT, MAX_GROUND_SLOPE,
  JUMP_SPEED, GRAVITY, DIRECTIONAL_SPEED, STRAFE_SPEED, WALK_SPEED_FACTOR,
  PITCH_LIMIT_DEG, FOV_DEG, BOB, CAMERA_SHAKE_FACTOR, STEP_PERIOD,
  STANCE_TRANSITION,
} from './soldier.js';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function fakeMesh(positions, { index = null, material = 0, collision = true,
                               kind = '' } = {}) {
  const node = {
    isMesh: true, name: kind || 'mesh', parent: null, children: [],
    userData: collision ? { collision: true } : { kind },
    matrixWorld: { elements: IDENTITY },
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

const RAMP_TOP = Math.tan(20 * Math.PI / 180) * 12;      // 4.368
const CLIFF_DEG = 70;
const CLIFF_TOP = RAMP_TOP + Math.tan(CLIFF_DEG * Math.PI / 180) * 8;

function groundHeight(x) {
  if (x <= 20) return 0;
  if (x <= 32) return (x - 20) * Math.tan(20 * Math.PI / 180);
  if (x <= 40) return RAMP_TOP;
  if (x <= 48) return RAMP_TOP + (x - 40) * Math.tan(CLIFF_DEG * Math.PI / 180);
  return CLIFF_TOP;
}

/** A terrain tile whose vertices sit on the lattice, the way the exporter writes them. */
function terrainTile(worldSize = 64, spacing = 4) {
  const positions = [];
  const h = groundHeight;
  for (let iz = 0; iz < worldSize / spacing; iz++) {
    for (let ix = 0; ix < worldSize / spacing; ix++) {
      const x0 = ix * spacing, x1 = x0 + spacing;
      const z0 = -iz * spacing, z1 = z0 - spacing;
      positions.push(x0, h(x0), z0, x1, h(x1), z0, x1, h(x1), z1);
      positions.push(x0, h(x0), z0, x1, h(x1), z1, x0, h(x0), z1);
    }
  }
  return fakeMesh(positions, { collision: false, kind: 'terrain' });
}

/** An axis-aligned box as 12 triangles. */
function box(x0, y0, z0, x1, y1, z1, material = 92) {
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const faces = [
    [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
    [0, 4, 5], [0, 5, 1], [3, 2, 6], [3, 6, 7],
    [0, 3, 7], [0, 7, 4], [1, 5, 6], [1, 6, 2],
  ];
  const positions = [];
  for (const f of faces) for (const i of f) positions.push(...v[i]);
  return fakeMesh(positions, { material });
}

const terrain = terrainTile();
const field = buildHeightfield([terrain], { worldSize: 64, dim: 16 });

const wall = box(10, 0, -20, 10.4, 3, 0, 92);
const lowKerb = box(13, 0, -20, 15, 0.30, 0, 80);
const highKerb = box(16, 0, -20, 18, 0.80, 0, 80);
const beam = box(12, 1.40, -34, 20, 1.60, -30, 80);
const platform = box(12, 0, -46, 18, 4.0, -40, 92);
const root = group([terrain, wall, lowKerb, highKerb, beam, platform]);
const statics = buildCollisionIndex(root, { ownerRoots: root.children, cellSize: 8 });
const collider = new WorldCollider({ heightfield: field, statics, waterLevel: -50 });

const results = { constants: {
  eye: EYE, height: HEIGHT, gaitSpeed: GAIT_SPEED,
  radius: BODY_RADIUS, stepHeight: STEP_HEIGHT,
  maxSlopeDeg: Math.acos(MAX_GROUND_SLOPE) * 180 / Math.PI,
  jumpSpeed: JUMP_SPEED, gravity: GRAVITY,
  directional: [...DIRECTIONAL_SPEED], strafe: [...STRAFE_SPEED],
  walkFactor: WALK_SPEED_FACTOR,
  pitchLimitDeg: PITCH_LIMIT_DEG, fovDeg: FOV_DEG,
  bobRunUp: BOB.run.up, bobWalkUp: BOB.walk.up,
  cameraShakeFactor: CAMERA_SHAKE_FACTOR,
  stepPeriod: STEP_PERIOD, stanceTransition: STANCE_TRANSITION,
} };

const DT = 1 / 60;

/** Run `frames` steps of the same input and hand back the soldier. */
function walk(soldier, input, frames) {
  for (let i = 0; i < frames; i++) soldier.step(DT, input);
  return soldier;
}

function fresh(x, y, z, yaw = 0) {
  return new Soldier({ collider }).spawn(x, y, z, yaw);
}

/** Facing -Z, which is 40 m of clear flat ground from z = -24. */
const NORTH = Math.PI;
const RUNWAY_Z = -24;
const runway = () => fresh(4, 0.5, RUNWAY_Z, NORTH);

// --- stances and the eye ---------------------------------------------------

{
  const s = fresh(4, 5, RUNWAY_Z, NORTH);
  results.spawnSettles = { y: s.y, grounded: s.grounded, eyeY: s.eyeY };

  walk(s, { crouch: true }, 60);
  results.crouchEye = s.eyeY;

  // crouch -> prone is the slowest declared transition (216 ms, 13 frames at
  // 60 Hz), so it is the one where the ease is observable at all.
  const down = [];
  for (let i = 0; i < 20; i++) { s.step(DT, { prone: true }); down.push(s.eyeY); }
  results.proneEye = s.eyeY;
  results.crouchToProneFrames = down.findIndex(y => Math.abs(y - EYE.prone) < 1e-6) + 1;
  results.proneEaseMonotonic = down.slice(0, 12).every((y, i) => i === 0 || y <= down[i - 1] + 1e-9);

  // prone -> stand is declared at 115 ms, about 7 frames.
  const up = [];
  for (let i = 0; i < 20; i++) { s.step(DT, {}); up.push(s.eyeY); }
  results.standEye = s.eyeY;
  results.proneToStandFrames = up.findIndex(y => Math.abs(y - EYE.stand) < 1e-6) + 1;
}

// --- the speeds, and Shift being the slow one ------------------------------
//
// These are the tell. Every one of them is a number out of the two tables at
// 0x009581b4, arriving through the whole presentation layer: a run is 6 m/s and
// a backpedal is 4, which is the 6:4 pair the engine indexes on "is there any
// forward input at all". A module that had quietly kept its own speed table
// would miss every one of them by more than a factor of two.

{
  // Straight up -Z for one second, in metres covered.
  const measure = (input) => {
    const s = runway();
    walk(s, { forward: 1, ...input }, 60);
    return RUNWAY_Z - s.z;
  };
  // Sideways, where the strafe table applies instead.
  const sideways = (input) => {
    const s = runway();
    walk(s, { forward: 0, strafe: 1, ...input }, 60);
    return Math.abs(s.x - 4);
  };
  results.travel = {
    run: measure({}),
    back: -measure({ forward: -1 }),
    walk: measure({ walk: true }),
    crouch: measure({ crouch: true }),
    prone: measure({ prone: true }),
    strafe: sideways({}),
    crouchStrafe: sideways({ crouch: true }),
  };
  results.shiftIsSlower = results.travel.walk < results.travel.run;
  // The HUD speed is the body's ground speed, not a distance divided by a dt.
  const running = runway();
  walk(running, { forward: 1 }, 60);
  results.reportedSpeed = { speed: running.speed, gait: running.gait };
}

// --- look clamp ------------------------------------------------------------

{
  const s = runway();
  s.look(0, 10);
  const up = s.pitch;
  s.look(0, -20);
  const down = s.pitch;
  s.look(7, 0);
  results.look = { up, down, yaw: s.yaw, limit: PITCH_LIMIT_DEG * Math.PI / 180 };
}

// --- a wall you cannot pass ------------------------------------------------

{
  // Start at x = 6 and run at the wall's face at x = 10 for three seconds.
  const s = fresh(6, 0.5, -10, -Math.PI / 2);   // forward = (sin,0,cos) = (-1,0,0)
  // Face +X instead: yaw = +PI/2 gives (1, 0, 0).
  s.yaw = Math.PI / 2;
  walk(s, { forward: 1 }, 180);
  results.wall = { x: s.x, blocked: s.blocked, gap: 10 - s.x };
}

// --- sliding along it ------------------------------------------------------

{
  // Run diagonally into the wall: the into-wall component is removed and the
  // along-wall component survives, so z must still change.
  //
  // Started at z = -18 and not -10 because a run is 6 m/s: three seconds of
  // diagonal is 12.7 m along the wall, and from -10 that walks off the end of
  // it (the wall spans z -20..0) and the test measures nothing at all.
  const START_Z = -18;
  const s = fresh(6, 0.5, START_Z);
  s.yaw = Math.PI / 4;          // forward = (0.707, 0, 0.707)
  walk(s, { forward: 1 }, 180);
  results.slide = { x: s.x, z: s.z, movedAlong: s.z - START_Z,
                    blocked: s.blocked, alongSpeed: 6 / Math.SQRT2 };
}

// --- step up, and refuse to -----------------------------------------------

{
  // The 0.30 m kerb spans x 13..15, so a walk from 11.5 crosses it and steps off
  // the far side again — the height while *on* it is what matters, not the end.
  // Forty frames is 4 m at a run, which clears the kerb and stops short of the
  // 0.80 m one at x = 16.
  const low = fresh(11.5, 0.5, -10);
  low.yaw = Math.PI / 2;
  let lowPeak = 0, climbedAt = 0;
  for (let i = 0; i < 40; i++) {
    low.step(DT, { forward: 1 });
    if (low.y > lowPeak) { lowPeak = low.y; climbedAt = low.x; }
  }
  results.stepUp = { peakY: lowPeak, climbedAt, endX: low.x, endY: low.y };

  // The 0.80 m kerb spans x 16..18 and must stop him dead in front of it: it is
  // over `STEP_HEIGHT`, so the capsule's lowest sphere — lifted to the step
  // height while grounded — still overlaps its near face.
  const high = fresh(15.2, 0.5, -10);
  high.yaw = Math.PI / 2;
  let highPeak = 0;
  for (let i = 0; i < 120; i++) {
    high.step(DT, { forward: 1 });
    highPeak = Math.max(highPeak, high.y);
  }
  results.stepRefused = { x: high.x, peakY: highPeak, blocked: high.blocked };
}

// --- slopes ----------------------------------------------------------------

{
  // 20 degrees: walkable, and the feet must follow the ground up. A hundred
  // frames is 10 m of x, which stops on the ramp rather than over its top.
  const gentle = fresh(21, groundHeight(21) + 0.2, -10);
  gentle.yaw = Math.PI / 2;
  walk(gentle, { forward: 1 }, 100);
  results.rampClimb = { x: gentle.x, y: gentle.y,
                        expected: groundHeight(gentle.x) };

  // 70 degrees: past `MAX_GROUND_SLOPE`, so x stops at the foot of the face.
  // The terrain is never in the capsule sweep — it is a clamp — so this is
  // `SoldierBody`'s own slope refusal and nothing else.
  const steep = fresh(38, groundHeight(38) + 0.2, -10);
  steep.yaw = Math.PI / 2;
  walk(steep, { forward: 1 }, 300);
  results.cliffRefused = { x: steep.x, y: steep.y, blocked: steep.blocked,
                           rampTop: RAMP_TOP };
}

// --- walking off a ledge ---------------------------------------------------

{
  // Stand on the 4 m platform and walk off its northern edge. Two seconds, not
  // four: a run covers 12 m in that, and another 12 would take him off the end
  // of the 64 m tile and into a fall with no floor under it.
  const s = fresh(15, 4.2, -42, NORTH);
  const ys = [];
  let airborne = 0;
  for (let i = 0; i < 120; i++) {
    s.step(DT, { forward: 1 });
    ys.push(s.y);
    if (!s.grounded) airborne++;
  }
  results.ledge = { startY: ys[0], endY: s.y, fell: ys[0] - s.y,
                    grounded: s.grounded, airborneFrames: airborne, z: s.z,
                    // sqrt(2h/g) at the engine's gravity, in 60 Hz frames.
                    predictedFrames: Math.sqrt(2 * 4 / Math.abs(GRAVITY)) * 60 };
}

// --- the jump --------------------------------------------------------------

{
  const s = runway();
  let apex = 0;
  s.step(DT, { jump: true });
  for (let i = 0; i < 120; i++) { s.step(DT, {}); apex = Math.max(apex, s.y); }
  // Predicted under the engine's gravity, not Earth's. The two differ by half
  // again: the same take-off speed peaks at 1.49 m under 9.81 and 0.99 m here.
  results.jump = { apex, landed: s.grounded, y: s.y,
                   predicted: (JUMP_SPEED * JUMP_SPEED) / (2 * Math.abs(GRAVITY)),
                   underEarthGravity: (JUMP_SPEED * JUMP_SPEED) / (2 * 9.81) };
}

// --- a held Space jumps once -----------------------------------------------

{
  // The game jumps on the press edge only: land with Space still down and
  // you stay on the floor until it is released and pressed again. Count
  // liftoffs across three airborne seconds of held key, then release and
  // press again to prove the latch re-arms.
  const s = runway();
  let liftoffs = 0, wasGrounded = true;
  for (let i = 0; i < 180; i++) {
    s.step(DT, { jump: true });
    if (wasGrounded && !s.grounded) liftoffs++;
    wasGrounded = s.grounded;
  }
  const heldLiftoffs = liftoffs;
  s.step(DT, {});                       // release
  s.step(DT, { jump: true });           // fresh press
  for (let i = 0; i < 5 && s.grounded; i++) s.step(DT, { jump: true });
  results.heldJump = { heldLiftoffs, rearmed: !s.grounded };
}

// --- head clearance --------------------------------------------------------

{
  // Under the 1.40 m beam: crouched is fine, standing up is refused.
  const s = fresh(16, 0.2, -32);
  walk(s, { crouch: true }, 60);
  const crouchedY = s.eyeY;
  walk(s, {}, 60);              // release crouch under the beam
  results.headroom = { crouchedY, stance: s.stance, eyeY: s.eyeY };

  const clear = fresh(4, 0.2, -28);
  walk(clear, { crouch: true }, 60);
  walk(clear, {}, 60);
  results.headroomClear = { stance: clear.stance, eyeY: clear.eyeY };
}

// --- view bob --------------------------------------------------------------

// Two separate things are under test here, and they were one thing until the
// binary settled the camera shake's units.
//
//   1. The shipped configuration has *no* walking bob at all, because the
//      engine multiplies the lower body's shake by `cameraShakeFactor` and that
//      ships as zero. This is the thing the user sees.
//   2. Turn the factor up and the shape underneath must be the engine's:
//      `amplitude * sin(rate * t)` with `rate` in radians per second and no
//      term in ground speed anywhere.
//
// The rate is measured off interpolated rising zero crossings rather than
// counted, so it is not quantised by the sample window.

/** Hz of a sampled channel, first crossing to last. */
function cycleRate(series) {
  const cross = [];
  for (let i = 1; i < series.length; i++) {
    if (series[i - 1] <= 0 && series[i] > 0) {
      const f = series[i] === series[i - 1]
        ? 0 : -series[i - 1] / (series[i] - series[i - 1]);
      cross.push((i - 1 + f) * DT);
    }
  }
  if (cross.length < 2) return 0;
  return (cross.length - 1) / (cross[cross.length - 1] - cross[0]);
}

/**
 * Hold `input` for 40 s and report the bob's shape over the last 30, by which
 * time the slowest declared fade (0.3 per second, i.e. 3.3 s) is long
 * saturated.
 *
 * Deliberately not on the runway: that is 40 m of clear ground and a 40 s run
 * covers 240. The world here is an unbounded flat plane — a `surfaceHeight`
 * and nothing else, which `physics.js` explicitly supports — because the
 * instrument wanted for measuring a camera curve is one with no geometry in it
 * to perturb the gait. Everything about the *body* is measured elsewhere in
 * this file against the real collider.
 */
const PLANE = { surfaceHeight: () => 0, casts: 0 };

function bobShape(input, factor) {
  const s = new Soldier({ collider: PLANE }).spawn(0, 0, 0, 0);
  if (factor !== undefined) s.cameraShakeFactor = factor;
  const up = [], side = [], yaw = [];
  let speed = 0;
  for (let i = 0; i < 2400; i++) {
    s.step(DT, input);
    if (i >= 600) { up.push(s.bobUp); side.push(s.bobSide); yaw.push(s.bobYaw); speed += s.speed; }
  }
  const peak = (a) => Math.max(...a.map(Math.abs));
  return {
    speed: speed / up.length,
    upPeak: peak(up), upHz: cycleRate(up),
    sidePeak: peak(side), sideHz: cycleRate(side),
    yawPeak: peak(yaw), yawHz: cycleRate(yaw),
  };
}

{
  // What the module ships: the factor left alone.
  results.bobShipped = {
    run: bobShape({ forward: 1 }),
    walk: bobShape({ forward: 1, walk: true }),
    crouch: bobShape({ forward: 1, crouch: true }),
    prone: bobShape({ forward: 1, prone: true }),
    factor: new Soldier({}).cameraShakeFactor,
    constant: CAMERA_SHAKE_FACTOR,
  };

  results.bobShape = {
    run: bobShape({ forward: 1 }, 1),
    walk: bobShape({ forward: 1, walk: true }, 1),
    crouch: bobShape({ forward: 1, crouch: true }, 1),
    prone: bobShape({ forward: 1, prone: true }, 1),
    // Backpedalling is 4 m/s against a run's 6 and strafing is 4 as well.
    // `Lb_RunBackward` and `Lb_StrafeLeft/Right` declare exactly the run's
    // numbers, so all three must come out identical: that is the assertion
    // that there is no speed term.
    backpedal: bobShape({ forward: -1 }, 1),
    strafe: bobShape({ strafe: 1 }, 1),
    still: bobShape({}, 1),
  };
  results.bobDeclared = {
    run: { up: BOB.run.up, upRate: BOB.run.upRate, side: BOB.run.side,
           sideRate: BOB.run.sideRate, yaw: BOB.run.yaw, yawRate: BOB.run.yawRate },
    walk: { up: BOB.walk.up, upRate: BOB.walk.upRate, side: BOB.walk.side,
            sideRate: BOB.walk.sideRate, yaw: BOB.walk.yaw, yawRate: BOB.walk.yawRate },
    crouch: { up: BOB.crouch.up, upRate: BOB.crouch.upRate, side: BOB.crouch.side },
    prone: { up: BOB.prone.up, upRate: BOB.prone.upRate, side: BOB.prone.side },
  };

  // The fade is a rate per second, so full amplitude arrives after 1 / 0.6 s
  // and not before. Half a ramp in, it must still be climbing and must be
  // within a frame of `fadeIn * elapsed`.
  const f = new Soldier({ collider: PLANE }).spawn(0, 0, 0, 0);
  f.cameraShakeFactor = 1;
  const half = [];
  const halfFrames = 50;                 // 0.833 s, half of the 1.67 s ramp
  for (let i = 0; i < halfFrames; i++) { f.step(DT, { forward: 1 }); half.push(f.bobPhase); }
  results.bobFade = {
    fadeIn: BOB.run.fadeIn,
    phaseAfterHalfARamp: f.bobPhase,
    expected: BOB.run.fadeIn * halfFrames * DT,
    monotonic: half.every((v, i) => i === 0 || v >= half[i - 1]),
  };

  // Stopping kills it dead — no `Lb_*` state declares `setCameraShakeFadeOut`.
  const s = new Soldier({ collider: PLANE }).spawn(0, 0, 0, 0);
  s.cameraShakeFactor = 1;
  for (let i = 0; i < 240; i++) s.step(DT, { forward: 1 });
  const movingPeak = Math.abs(s.bobUp);
  s.step(DT, {});
  results.bobStop = { movingPeak, afterOneStillFrame: Math.abs(s.bobUp) };

  // Footsteps land on the declared clock: one second of running is 1 / 0.36.
  // The same clock no longer drives the bob, so this has to keep working on
  // its own.
  const steps = runway();
  walk(steps, { forward: 1 }, 300);      // five seconds
  results.steps = { taken: steps.steps, expected: 5 / STEP_PERIOD.run };
}

// --- cost ------------------------------------------------------------------

// A frame is one capsule sweep (three spheres, one pass over open ground) plus
// the one downward ray that finds the floor. A blocked frame pays for extra
// slide passes. `casts` is read off the collider's own counter rather than a
// second tally kept in `soldier.js`, so it cannot drift from what was spent.

{
  const s = runway();
  walk(s, { forward: 1 }, 10);
  const open = s.casts;
  const blockedSoldier = fresh(9.4, 0.5, -10);
  blockedSoldier.yaw = Math.PI / 2;
  walk(blockedSoldier, { forward: 1 }, 10);
  results.casts = { open, blocked: blockedSoldier.casts };

  // Run on the ground for the whole measurement, turning round rather than
  // walking off the tile: a soldier in free fall is not what costs anything.
  const timed = runway();
  const FRAMES = 30000;
  for (let i = 0; i < 2000; i++) timed.step(DT, { forward: 1 });   // warm the JIT
  const started = process.hrtime.bigint();
  for (let i = 0; i < FRAMES; i++) {
    if (timed.z < -60 || timed.z > -6) { timed.yaw += Math.PI; }
    timed.step(DT, { forward: 1 });
  }
  const ns = Number(process.hrtime.bigint() - started);
  results.perFrameMicroseconds = ns / FRAMES / 1000;
  results.perFrameCasts = timed.casts;
}

// --- spawn selection -------------------------------------------------------

{
  const extras = {
    controlPoints: [
      { name: 'AXISBASE_Cpoint', displayName: '2nd_Panzer_Division_HQ', team: 1,
        spawnGroupId: 1, unableToChangeTeam: true, position: [590, 34, -1078] },
      { name: 'ALLIESBase_Cpoint', displayName: 'US_HQ', team: 2,
        spawnGroupId: 2, unableToChangeTeam: true, position: [1214, 20, -566] },
      { name: 'broaxis_Cpoint', displayName: 'Bridge', team: 0,
        spawnGroupId: 6, unableToChangeTeam: false, position: [760, 31, -940] },
      // A flag whose group no spawn point claims: left out entirely.
      { name: 'Empty_Cpoint', displayName: 'Nowhere', team: 0, spawnGroupId: 99 },
    ],
    soldierSpawns: [
      { name: 'a', position: [587, 34, -1122], rotation: [37.44, 0, 0], group: 1, team: 1 },
      { name: 'b', position: [626, 34, -1100], rotation: [90, 0, 0], group: 1, team: 1 },
      { name: 'c', position: [1162, 20, -590], rotation: [0, 0, 0], group: 2, team: 2 },
      { name: 'd', position: [1020, 21, -810], rotation: [180, 0, 0], group: 6, team: 0 },
      // Declared airborne, the way a newly extracted level says it.
      { name: 'para', position: [600, 200, -1100], rotation: [0, 0, 0], group: 1,
        team: 1, paratrooper: true },
      // Not declared, but 160 m over the ground: the fallback has to catch it.
      { name: 'legacy-para', position: [610, 194, -1100], rotation: [0, 0, 0],
        group: 1, team: 1 },
    ],
  };
  const flags = spawnFlags(extras);
  results.flags = flags.map(f => ({
    name: f.name, team: f.team, group: f.group,
    spawns: f.spawns.length, uncapturable: f.uncapturable,
  }));

  const axis = flags.find(f => f.group === 1);
  const groundAt = () => 34;
  const chosen = [];
  for (let i = 0; i < 4; i++) chosen.push(pickSpawn(axis, i, { groundAt })?.name);
  results.picked = chosen;
  results.pickedWithoutGround = pickSpawn(axis, 0)?.name;
  results.pickedNames = axis.spawns.map(s => s.name);

  results.spawnYaw = {
    zero: spawnYaw({ rotation: [0, 0, 0] }),
    ninety: spawnYaw({ rotation: [90, 0, 0] }),
    oneEighty: spawnYaw({ rotation: [180, 0, 0] }),
  };
  // A spawn facing Refractor yaw 0 faces Refractor +Z, which the exporter
  // mirrors to glTF -Z; the page's own lookVector at PI is (0, 0, -1).
  const forward = (yaw) => [Math.sin(yaw), Math.cos(yaw)];
  results.spawnForward = {
    zero: forward(results.spawnYaw.zero),
    ninety: forward(results.spawnYaw.ninety),
  };
}

// --- a collider-less soldier still moves ----------------------------------

{
  const s = new Soldier({}).spawn(0, 10, 0);
  walk(s, { forward: 1 }, 60);
  results.noCollider = { z: s.z, y: s.y, finite: Number.isFinite(s.y) };
}

process.stdout.write(JSON.stringify(results, null, 1));
