// Drives `viewer/soldier.js` outside a browser and prints one JSON blob.
//
// `tests/test_soldier.py` copies this file, the module under test and
// `collision.js` into a temporary directory and asserts on the output. The
// collider is the **real** `WorldCollider` over real fake meshes, not a stub,
// because the thing worth testing is the pair: a capsule that slides correctly
// against a mock but not against the module that ships is worth nothing.
//
// The world, 64 m square on a 4 m lattice:
//
//    x=0..20   flat ground at y = 0
//    x=20..32  a 20-degree ramp, rising to 4.37 m  (walkable)
//    x=32..40  flat at 4.37 m
//    x=40..48  a 60-degree face, rising to 18.2 m  (refused)
//    x=48..64  flat at 18.2 m
//
//  and, standing on the flat part:
//
//    a wall at x = 10, y 0..3, z -20..0
//    a kerb 0.30 m high from x = 13 to 15   (steppable: under STEP_UP)
//    a kerb 0.80 m high from x = 16 to 18   (not steppable)
//    a beam roofing x 12..20, z -34..-30 at y 1.40..1.60 (too low to stand under)
//    a 4 m platform at x 12..18, z -46..-40  (to walk off)
//
// Anything that needs a long clear run does it along -Z from z = -24 at x = 4,
// which is 40 m of flat ground with nothing whatever in it.

import {
  buildHeightfield, buildCollisionIndex, WorldCollider,
} from './collision.mjs';
import {
  Soldier, spawnFlags, pickSpawn, spawnYaw,
  EYE, HEIGHT, SPEED, RADIUS, STEP_UP, MAX_SLOPE_DEG, JUMP_SPEED,
  PITCH_LIMIT_DEG, FOV_DEG, BOB, STEP_PERIOD,
} from './soldier.mjs';

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
const CLIFF_TOP = RAMP_TOP + Math.tan(60 * Math.PI / 180) * 8;

function groundHeight(x) {
  if (x <= 20) return 0;
  if (x <= 32) return (x - 20) * Math.tan(20 * Math.PI / 180);
  if (x <= 40) return RAMP_TOP;
  if (x <= 48) return RAMP_TOP + (x - 40) * Math.tan(60 * Math.PI / 180);
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
  eye: EYE, height: HEIGHT, speed: SPEED, radius: RADIUS, stepUp: STEP_UP,
  maxSlopeDeg: MAX_SLOPE_DEG, jumpSpeed: JUMP_SPEED,
  pitchLimitDeg: PITCH_LIMIT_DEG, fovDeg: FOV_DEG,
  bobRunUp: BOB.run.up, bobWalkUp: BOB.walk.up,
  stepPeriod: STEP_PERIOD,
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

// --- the four speeds, and Shift being the slow one -------------------------

{
  const measure = (input) => {
    const s = runway();
    walk(s, { ...input, forward: 1 }, 60);   // one second, straight up -Z
    return RUNWAY_Z - s.z;
  };
  results.travel = {
    run: measure({}),
    walk: measure({ walk: true }),
    crouch: measure({ crouch: true }),
    prone: measure({ prone: true }),
  };
  results.shiftIsSlower = results.travel.walk < results.travel.run;
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
  const s = fresh(6, 0.5, -10);
  s.yaw = Math.PI / 4;          // forward = (0.707, 0, 0.707)
  walk(s, { forward: 1 }, 180);
  results.slide = { x: s.x, z: s.z, movedAlong: s.z - -10, blocked: s.blocked };
}

// --- step up, and refuse to -----------------------------------------------

{
  // The 0.30 m kerb spans x 13..15, so a walk from 11.5 crosses it and steps off
  // the far side again — the height while *on* it is what matters, not the end.
  const low = fresh(11.5, 0.5, -10);
  low.yaw = Math.PI / 2;
  let lowPeak = 0, climbedAt = 0;
  for (let i = 0; i < 120; i++) {
    low.step(DT, { forward: 1 });
    if (low.y > lowPeak) { lowPeak = low.y; climbedAt = low.x; }
  }
  results.stepUp = { peakY: lowPeak, climbedAt, endX: low.x, endY: low.y };

  // The 0.80 m kerb spans x 16..18 and must stop him dead in front of it.
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
  // 20 degrees: walkable, and the feet must follow the ground up.
  const gentle = fresh(21, groundHeight(21) + 0.2, -10);
  gentle.yaw = Math.PI / 2;
  walk(gentle, { forward: 1 }, 300);
  results.rampClimb = { x: gentle.x, y: gentle.y,
                        expected: groundHeight(gentle.x) };

  // 60 degrees: refused, so x stops at the foot of the face.
  const steep = fresh(38, groundHeight(38) + 0.2, -10);
  steep.yaw = Math.PI / 2;
  walk(steep, { forward: 1 }, 300);
  results.cliffRefused = { x: steep.x, y: steep.y, blocked: steep.blocked };
}

// --- walking off a ledge ---------------------------------------------------

{
  // Stand on the 4 m platform and walk off its northern edge.
  const s = fresh(15, 4.2, -42, NORTH);
  const ys = [];
  let airborne = 0;
  for (let i = 0; i < 240; i++) {
    s.step(DT, { forward: 1 });
    ys.push(s.y);
    if (!s.grounded) airborne++;
  }
  results.ledge = { startY: ys[0], endY: s.y, fell: ys[0] - s.y,
                    grounded: s.grounded, airborneFrames: airborne, z: s.z };
}

// --- the jump --------------------------------------------------------------

{
  const s = runway();
  let apex = 0;
  s.step(DT, { jump: true });
  for (let i = 0; i < 120; i++) { s.step(DT, {}); apex = Math.max(apex, s.y); }
  results.jump = { apex, landed: s.grounded, y: s.y,
                   predicted: (JUMP_SPEED * JUMP_SPEED) / (2 * 9.81) };
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

{
  const s = runway();
  const peaks = [];
  for (let i = 0; i < 240; i++) { s.step(DT, { forward: 1 }); peaks.push(Math.abs(s.bobUp)); }
  const runPeak = Math.max(...peaks.slice(120));
  // Standing still, it fades out within the declared 0.6 s.
  for (let i = 0; i < 60; i++) s.step(DT, {});
  const restPeak = Math.abs(s.bobUp);

  const w = runway();
  const wpeaks = [];
  for (let i = 0; i < 240; i++) { w.step(DT, { forward: 1, walk: true }); wpeaks.push(Math.abs(w.bobUp)); }
  results.bob = {
    runPeak, walkPeak: Math.max(...wpeaks.slice(120)), restPeak,
    declaredRun: BOB.run.up, declaredWalk: BOB.walk.up,
  };

  // Footsteps land on the declared clock: one second of running is 1 / 0.36.
  const f = runway();
  walk(f, { forward: 1 }, 300);          // five seconds
  results.steps = { taken: f.steps, expected: 5 / STEP_PERIOD.run };
}

// --- cost ------------------------------------------------------------------

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
