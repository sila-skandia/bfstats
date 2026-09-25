// Drives `viewer/soldier.js` + `viewer/ladder-climb.js` headless (Gap 16,
// `features/ladder-climbing/README.md`): the grab, the -0.48 m snap, the
// constant climb rate, the hang, the top and bottom exits, the leap off, the
// dead-body drop, the reach refusal, the ladder-less world and the backward
// grab from a deck. Run by `tests/test_ladder.py`, which stands the modules
// up exactly as `test_gait_select.py` does and asserts on the JSON blob.
//
// The fake collider is deliberately the duck-typed minimum the body reads:
// `surfaceHeight`, `waterLevel` and `ladders`, with no static index — a level
// without one, which is exactly the honest harness for a climb law that must
// not care how the ground is built. The deck for the backward-grab case is
// stood in with `body.place` + `plant` rather than a fake static mesh.

import { Soldier } from '../viewer/soldier.js';
import {
  LADDER_CLIMB_SPEED, LADDER_STANDOFF, LADDER_REACH,
} from '../viewer/ladder-climb.js';

const TICK = 1 / 60;
const AX = 2;               // ladder axis x
const TOP_Y = 10;           // ladder top

const LADDER = {
  name: 'Ladder_10m',
  x: AX, y: 0, z: 0, tx: AX, ty: TOP_Y, tz: 0, length: TOP_Y,
  fx: 1, fy: 0, fz: 0, width: 0.6,
};

function ladderWorld() {
  return {
    waterLevel: null,
    casts: 0,
    surfaceHeight: () => 0,
    ladders: [LADDER],
  };
}

const FACE_YAW = -Math.PI / 2;   // forward (-1, 0, 0): looking at the ladder

function spawnAt(x, z, yaw = FACE_YAW) {
  const s = new Soldier({ collider: ladderWorld(), worldSize: 2048 });
  s.spawn(x, 0, z, yaw);
  return s;
}

function stepSeconds(s, seconds, input) {
  for (let i = 0, n = Math.round(seconds / TICK); i < n; i++) s.step(TICK, input);
}

const out = {};

out.constants = {
  climb: LADDER_CLIMB_SPEED, standoff: LADDER_STANDOFF, reach: LADDER_REACH,
};

// 1. The grab: walking forward into the ladder takes it, snaps the body onto
//    the climb line at the engine's standoff and turns him to face it.
{
  const s = spawnAt(2.8, 0);
  s.step(TICK, { forward: 1 });
  out.snap = {
    active: s.climb.active, name: s.climb.ladderName,
    x: s.x, y: s.y, yaw: s.yaw, t: s.climb.t,
    standoffDist: Math.abs(s.x - AX),
  };
}

// 2. The rate: two consecutive seconds on the climb, each measured.
{
  const s = spawnAt(2.8, 0);
  s.step(TICK, { forward: 1 });
  const atGrab = s.y;
  stepSeconds(s, 1, { forward: 1 });
  const y1 = s.y;
  stepSeconds(s, 1, { forward: 1 });
  out.rate = { atGrab, y1, y2: s.y, rise1: y1 - atGrab, rise2: s.y - y1 };
}

// 3. The hang: no input, no motion, still on the ladder.
{
  const s = spawnAt(2.8, 0);
  s.step(TICK, { forward: 1 });
  stepSeconds(s, 0.5, { forward: 1 });
  const during = s.y;
  stepSeconds(s, 0.5, { forward: 0 });
  out.hang = { during, after: s.y, stillActive: s.climb.active };
}

// 4. The top exit: climbed out onto the deck side, climb over.
{
  const s = spawnAt(2.8, 0);
  s.step(TICK, { forward: 1 });
  let frames = 0;
  while (s.climb.active && frames < 1200) { s.step(TICK, { forward: 1 }); frames++; }
  out.topExit = {
    frames, active: s.climb.active, x: s.x, y: s.y, z: s.z,
    inwardStep: Math.abs(s.x - AX),
  };
}

// 5. The bottom exit: up part-way, down the rest, feet back on the ground.
//    The down leg steps frame by frame until the climb ends (the grab's own
//    parameter offset means an equal-duration up/down does not land exactly
//    at the bottom).
{
  const s = spawnAt(2.8, 0);
  s.step(TICK, { forward: 1 });
  stepSeconds(s, 2, { forward: 1 });
  const yUp = s.y;
  let frames = 0;
  while (s.climb.active && frames < 1200) { s.step(TICK, { forward: -1 }); frames++; }
  const atExit = { y: s.y, active: s.climb.active };
  stepSeconds(s, 0.5, {});
  out.bottomExit = { yUp, atExit, settled: { y: s.y, grounded: s.grounded } };
}

// 6. The leap: jump while climbing tears the climb off; the queued impulse
//    fires on the tick the ordinary body step resumes.
{
  const s = spawnAt(2.8, 0);
  s.step(TICK, { forward: 1 });
  stepSeconds(s, 1, { forward: 1 });
  const yAt = s.y;
  s.step(TICK, { forward: 0, jump: true });
  const atLeap = { active: s.climb.active, vy: s.body.velocity.y, y: s.y };
  stepSeconds(s, 1, {});
  out.jumpOff = { yAt, atLeap, yAfter: s.y, landed: s.body.landed };
}

// 7. The dead body falls out of the climb.
{
  const s = spawnAt(2.8, 0);
  s.step(TICK, { forward: 1 });
  stepSeconds(s, 1, { forward: 1 });
  const yAt = s.y;
  s.step(TICK, { forward: 1, dead: true });
  out.deadDrop = { yAt, active: s.climb.active, y: s.y };
}

// 8. Out of reach: a soldier two metres from the axis is refused.
{
  const s = spawnAt(4.2, 0);
  for (let i = 0; i < 10; i++) s.step(TICK, { forward: 1 });
  out.tooFar = { active: s.climb.active, x: s.x };
}

// 9. A world without ladders never grabs.
{
  const s = new Soldier({
    collider: { waterLevel: null, surfaceHeight: () => 0 }, worldSize: 2048,
  });
  s.spawn(1, 0, 0, 0);
  for (let i = 0; i < 10; i++) s.step(TICK, { forward: 1 });
  out.noLadders = { active: s.climb.active };
}

// 10. The backward grab: standing on the deck beside the ladder's top rungs,
//     stepping backwards takes the ladder downward.
{
  const s = spawnAt(5, 0);          // parked well out of reach
  s.body.place(2.6, TOP_Y, 0, FACE_YAW);
  s.body.plant(1, -1);
  s.step(TICK, { forward: -1 });
  const grab = {
    active: s.climb.active, t: s.climb.t,
    x: s.x, y: s.y, standoffDist: Math.abs(s.x - AX),
  };
  stepSeconds(s, 2, { forward: -1 });
  const descend = { y: s.y, active: s.climb.active };
  let frames = 0;
  while (s.climb.active && frames < 1200) { s.step(TICK, { forward: -1 }); frames++; }
  stepSeconds(s, 0.5, {});
  out.backGrab = { grab, descend, finished: { y: s.y, active: s.climb.active } };
}

console.log(JSON.stringify(out));
