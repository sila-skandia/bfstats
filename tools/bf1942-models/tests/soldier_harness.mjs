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

import { buildHeightfield } from './heightfield.js';
import { buildCollisionIndex } from './static-index.js';
import { WorldCollider } from './world-collider.js';
import {
  Soldier, spawnFlags, pickSpawn, spawnYaw,
  EYE, HEIGHT, GAIT_SPEED, BODY_RADIUS, STEP_HEIGHT, MAX_GROUND_SLOPE,
  JUMP_IMPULSE, GRAVITY, DIRECTIONAL_SPEED, STRAFE_SPEED, WALK_SPEED_FACTOR,
  PITCH_LIMIT_DEG, FOV_DEG, BOB, CAMERA_SHAKE_FACTOR, STEP_PERIOD,
  STANCE_TRANSITION, RAMP_ACCEL, RAMP_LIMIT, ENGINE_TICK_RATE,
  DIVE_SPEED_FACTOR, DIVE_DURATION,
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
// A ship's own two decks, well clear of the terrain so nothing here is the
// world's ground: a hold floor at y 8, a deck over it at y 9.6..9.8, and its
// weather deck at 12.2..12.4. A spawn authored in the hold has 1.6 m of
// headroom -- no room to stand -- and `settle`'s upward escape is what puts him
// on the deck instead. A spawn on the deck itself has 2.4 m and stays.
const hold = box(-20, 7.8, -20, -12, 8.0, -12, 92);
const tween = box(-20, 9.6, -20, -12, 9.8, -12, 92);
const weather = box(-20, 12.2, -20, -12, 12.4, -12, 92);
const root = group([terrain, wall, lowKerb, highKerb, beam, platform,
                    hold, tween, weather]);
const statics = buildCollisionIndex(root, { ownerRoots: root.children, cellSize: 8 });
const collider = new WorldCollider({ heightfield: field, statics, waterLevel: -50 });

const results = { constants: {
  eye: EYE, height: HEIGHT, gaitSpeed: GAIT_SPEED,
  radius: BODY_RADIUS, stepHeight: STEP_HEIGHT,
  maxSlopeDeg: Math.acos(MAX_GROUND_SLOPE) * 180 / Math.PI,
  jumpSpeed: JUMP_IMPULSE, gravity: GRAVITY,
  directional: [...DIRECTIONAL_SPEED], strafe: [...STRAFE_SPEED],
  walkFactor: WALK_SPEED_FACTOR,
  pitchLimitDeg: PITCH_LIMIT_DEG, fovDeg: FOV_DEG,
  bobRunUp: BOB.run.up, bobWalkUp: BOB.walk.up,
  cameraShakeFactor: CAMERA_SHAKE_FACTOR,
  stepPeriod: STEP_PERIOD, stanceTransition: STANCE_TRANSITION,
} };

const DT = 1 / 60;

/**
 * Seconds of full-speed travel the movement ramp costs a standing start.
 *
 * PHY-6's register climbs `RAMP_ACCEL * 30 * DT` a frame and clamps at
 * `RAMP_LIMIT`, and the speed is the table times `state / 127`, so the distance
 * lost against an instant start is the area over the ramp — which is a pure
 * time, independent of which table row is in play. Every distance figure below
 * is short by `speed * this`, and the tests subtract it rather than carrying a
 * second set of magic distances.
 */
const RAMP_DEFICIT_SECONDS = (() => {
  const step = RAMP_ACCEL * ENGINE_TICK_RATE * DT;
  let lost = 0;
  for (let state = 0; state < RAMP_LIMIT; ) {
    state = Math.min(state + step, RAMP_LIMIT);
    lost += (1 - state / RAMP_LIMIT) * DT;
  }
  return lost;
})();

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
  // Prone is measured from an ALREADY prone soldier. Pressing Z while moving
  // forward enters `Lb_RunStandToLie`, whose own `setSpeed 6.0` runs the first
  // 0.282 s of it at a full run (PHY-7, `proneDive` below) — that is the dive,
  // not the crawl, and folding it into this row would measure the wrong thing.
  const measureProne = (input) => {
    const s = runway();
    walk(s, { prone: true }, 60);            // dive, then settle at a crawl
    const from = s.z;
    walk(s, { forward: 1, prone: true, ...input }, 60);
    return from - s.z;
  };
  results.travel = {
    run: measure({}),
    back: -measure({ forward: -1 }),
    walk: measure({ walk: true }),
    crouch: measure({ crouch: true }),
    prone: measureProne({}),
    strafe: sideways({}),
    crouchStrafe: sideways({ crouch: true }),
  };
  // The prone dive itself (PHY-7): a soldier at a saturated run who presses Z.
  // `setSpeed 6.0` against the prone table's 1 m/s is the standing run exactly,
  // so the dive covers `DIVE_DURATION * 6` and then the crawl takes over.
  {
    const diving = runway();
    walk(diving, { forward: 1 }, 60);        // saturate the ramp at a run
    const from = diving.z;
    const frames = Math.round(DIVE_DURATION / DT);
    walk(diving, { forward: 1, prone: true }, frames);
    const slide = from - diving.z;
    const after = diving.z;
    walk(diving, { forward: 1, prone: true }, frames);
    results.proneDive = {
      slide,
      // The same span of frames once the dive is over: a 1 m/s crawl.
      crawl: after - diving.z,
      duration: DIVE_DURATION,
      factor: DIVE_SPEED_FACTOR,
    };
    // Backing up when you press it is `Lb_StandToLie`, `setSpeed 1.0` — no
    // dive at all, so the same span covers a backward crawl and nothing more.
    const backward = runway();
    walk(backward, { forward: -1 }, 60);
    const backFrom = backward.z;
    walk(backward, { forward: -1, prone: true }, frames);
    results.proneDive.backwardSlide = backward.z - backFrom;
    // And from a crouch it is `Lb_CrouchToLie`, also 1.0.
    const crouched = runway();
    walk(crouched, { forward: 1, crouch: true }, 60);
    const crouchFrom = crouched.z;
    walk(crouched, { forward: 1, crouch: true, prone: true }, frames);
    results.proneDive.fromCrouchSlide = crouchFrom - crouched.z;
  }
  results.shiftIsSlower = results.travel.walk < results.travel.run;
  // What a standing start costs, so the tests can subtract it once instead of
  // carrying a second set of distances.
  results.rampDeficitSeconds = RAMP_DEFICIT_SECONDS;
  // Cruising: the same second of input with the ramp already saturated.
  const cruised = runway();
  walk(cruised, { forward: 1 }, 60);
  const fromZ = cruised.z;
  walk(cruised, { forward: 1 }, 60);
  results.travelCruising = fromZ - cruised.z;
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
  // Forty-four frames is 3.84 m at a run *after* the movement ramp's own
  // 0.098 s (PHY-6), which clears the kerb and stops short of the 0.80 m one
  // at x = 16 -- whose near face is met at 15.7, one body radius out.
  const low = fresh(11.5, 0.5, -10);
  low.yaw = Math.PI / 2;
  let lowPeak = 0, climbedAt = 0;
  for (let i = 0; i < 44; i++) {
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
  // Stand on the 4 m platform and walk off its northern edge. Two and a half
  // seconds, not four: a run covers 14.4 m in that once the movement ramp's
  // 0.59 m is paid (PHY-6), and another 14 would take him off the end of the
  // 64 m tile and into a fall with no floor under it.
  const s = fresh(15, 4.2, -42, NORTH);
  const ys = [];
  let airborne = 0;
  for (let i = 0; i < 150; i++) {
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
                   predicted: (JUMP_IMPULSE * JUMP_IMPULSE) / (2 * Math.abs(GRAVITY)),
                   underEarthGravity: (JUMP_IMPULSE * JUMP_IMPULSE) / (2 * 9.81) };
}

// --- the same jump on a 30 fps phone and a 144 Hz monitor ------------------
//
// `Soldier.step` takes a **frame** dt and spends it through a `FixedStep`
// accumulator that runs whole 60 Hz ticks of the body, leaving `clock.alpha`
// for the render to interpolate with. The sim is therefore already independent
// of the frame rate, which is the property that matters: the engine's own
// `Setup::mainLoop` (lnxded `0x080bc0b0`) rate-limits to `1 / (2 *
// g_simulationFps)` and then integrates with the **measured** elapsed time, so
// retail's own jump does move with the frame rate. This viewer deliberately
// does not, because a recorded input stream has to replay to the same position
// on any machine.
//
// Apex is sampled once per frame, so a 30 fps run sees every second tick and a
// 144 Hz run sees each tick more than once; near the apex a tick moves the body
// about 2 mm, which is the whole tolerance these need.
function jumpAtFrameRate(fps, seconds = 2) {
  const s = runway();
  const dt = 1 / fps;
  let apex = 0, airFrames = 0, left = false;
  s.step(dt, { jump: true });
  for (let i = 0; i < Math.round(seconds * fps); i++) {
    s.step(dt, {});
    apex = Math.max(apex, s.y);
    if (!s.grounded) { airFrames++; left = true; } else if (left) break;
  }
  return { fps, apex, airTime: airFrames * dt, landed: s.grounded, y: s.y,
           ticks: s.clock.ticks };
}
results.frameRateJump = [jumpAtFrameRate(30), jumpAtFrameRate(60),
                         jumpAtFrameRate(144), jumpAtFrameRate(23.7)];

// And the landing a fall-damage caller reads. This one must be *exact*: the
// landing happens on one particular tick whatever the frames around it were,
// so the impact speed and the drop the formula is fed cannot move at all.
function fallAtFrameRate(fps, height = 8) {
  const s = runway();
  const dt = 1 / fps;
  s.step(dt, {});
  // The page's own `__dropFromHeight`: lift the settled body, zero its
  // vertical speed and tell it the last thing it touched was up there.
  s.body.position.y += height;
  s.body.velocity.y = 0;
  s.body.grounded = false;
  s.body.lastCollisionHeight += height;
  let landing = null;
  for (let i = 0; i < Math.round(6 * fps) && !landing; i++) {
    s.step(dt, {});
    landing = s.landing;
  }
  return landing && { fps, impactSpeed: landing.impactSpeed,
                      fallHeight: landing.fallHeight,
                      cosTheta: landing.cosTheta, material: landing.material };
}
results.frameRateFall = [fallAtFrameRate(30), fallAtFrameRate(60),
                         fallAtFrameRate(144), fallAtFrameRate(23.7)];

// The ramp too: a second of held W covers the same ground at any frame rate.
function rampAtFrameRate(fps, seconds = 1) {
  const s = runway();
  const dt = 1 / fps;
  const from = s.z;
  for (let i = 0; i < Math.round(seconds * fps); i++) s.step(dt, { forward: 1 });
  return { fps, travelled: from - s.z, speed: s.speed };
}
results.frameRateRamp = [rampAtFrameRate(30), rampAtFrameRate(60),
                         rampAtFrameRate(144), rampAtFrameRate(23.7)];

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

// --- `settle`'s upward escape ------------------------------------------------
//
// `BFSpawnPoint::spawn` (0x08163d70) writes the authored position and nothing
// else; a point authored inside a hull is saved by the ordinary contact push,
// which a downward probe cannot do. The gate is "the floor is a hull's, not the
// world's", because the engine's push goes the shortest way out and for a man
// standing on the ground under a beam that is downward.
{
  // In the hold, 1.6 m under the tween deck: lifted onto it (9.8).
  results.escapeFromHold = fresh(-16, 8.1, -16).y;
  // Already on the tween deck, 2.4 m under the weather deck: left alone.
  results.escapeStaysOnDeck = fresh(-16, 9.9, -16).y;
  // On the weather deck with open sky: left alone.
  results.escapeOpenDeck = fresh(-16, 12.5, -16).y;
  // On the ground under the 1.40 m beam -- no room to stand, but the floor is
  // the world's, so he stays under it and the stance system refuses the stand.
  results.escapeUnderBeam = fresh(16, 0.2, -32).y;
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

  // No footfalls in the water. A pinned swimmer is never grounded, so the case
  // that matters is wading out: `Lb_EndSwim` still carries `c_AsmIsSwimming`
  // after the boots are back on the bottom. A tide does it on flat ground — up
  // to 0.5 m (past the 0.43 entry) and back to 0.2 m (under the 0.35 exit) —
  // and the frame it rises is swept so a stride is mid-phase when he comes out.
  let wadingFrames = 0, wadingSteps = 0;
  for (let k = 0; k < 22; k++) {
    const tide = { level: -5 };
    const beach = { surfaceHeight: () => 0, get waterLevel() { return tide.level; } };
    const s = new Soldier({ collider: beach }).spawn(0, 0, 0, 0);
    for (let i = 0; i < 600; i++) {
      if (i === 60 + k) tide.level = 0.5;
      if (i === 240) tide.level = 0.2;
      const before = s.footstepEvents.length;
      s.step(DT, { forward: 1 });
      if (s.grounded && s.swim.swimming) {
        wadingFrames++;
        wadingSteps += s.footstepEvents.length - before;
      }
    }
  }
  results.wadingFootsteps = { frames: wadingFrames, steps: wadingSteps };
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
      // The authored spawn group belongs to Axis, but the control point starts
      // neutral. The live owner comes from the ControlPoint, not this group.
      { name: 'd', position: [1020, 21, -810], rotation: [180, 0, 0], group: 6, team: 1 },
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

  // Battle of Britain's shape: one group the level declares `OnlyForAI`, one
  // it declares `OnlyForHuman`, both on the same flag. The AI point sits at
  // the building's own origin, which is indoors.
  const bunker = {
    name: 'East_Harwick_RadarTower', team: 2, group: 74, vehicle: true,
    spawns: [
      { name: 'ai', position: [1427.3, 103, -1258.1], rotation: [0, 0, 0],
        group: 64, team: 2, onlyForAI: true },
      { name: 'human-1', position: [1427.3, 103, -1276.7], rotation: [0, 0, 0],
        group: 74, team: 2, onlyForHuman: true },
      { name: 'human-2', position: [1432.1, 103, -1275.3], rotation: [0, 0, 0],
        group: 74, team: 2, onlyForHuman: true },
    ],
  };
  results.bunkerPicks = [0, 1, 2, 3].map(i => pickSpawn(bunker, i)?.name);
  // And the geometry gate on top of it: a collider that calls the first
  // human point solid walks on to the second.
  const solidAt = (x, z) => Math.abs(x - 1427.3) < 1 && Math.abs(z + 1276.7) < 1;
  const blockingWorld = {
    sweepSphere(ox, oy, oz) {
      return solidAt(ox, oz)
        ? { t: 0, x: ox, y: oy, z: oz, nx: 0, ny: 1, nz: 0, material: 0 }
        : null;
    },
  };
  results.bunkerAvoidsSolid =
    pickSpawn(bunker, 0, { world: blockingWorld })?.name;

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
