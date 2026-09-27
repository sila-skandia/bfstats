// Drives `viewer/soldier.js` + `viewer/ladder-climb.js` headless (Gap 16,
// `features/ladder-climbing/README.md`, ledger LADDER-1..5):
// the engine's grab (below and above the ladder's origin, the facing test,
// no backward press), the snap onto the ladder's -z face, the climb rate both
// ways, the direction the look picks, the hang, the exits against the
// ladder's box (the top's lift through the ladder, the bottom, the water), the
// let-go on a jump, the dead-body drop. Run by `tests/test_ladder.py`, which
// stands the modules up exactly as `test_gait_select.py` does and asserts on
// the JSON blob.
//
// The ladder is built the way a level builds one: an `extras.isLadder` spec
// (a 20 m ladder, its origin at its middle, the mesh's z its face) through
// `ladderRecord` with a node matrix that yaws it 90 degrees, so its +z — the
// deck side — is world -x. It stands at x = 2 with its box from y = 0 to 20;
// the climber hangs on its -z face at x = 2.48. The cases that need a deck at
// the top stand one in as the terrain's own step, 20 m for x < 2 and the
// ground beyond; the rest have open ground on both sides, so a man who lets
// go falls to the ground rather than into the step.
//
// The fake collider is deliberately the duck-typed minimum the body reads:
// `surfaceHeight`, `waterLevel` and `ladders`, with no static index.
//
// The module is imported as a namespace so that a missing export reads as
// `undefined` and the old module can still be run against these cases (the
// failing-before check).

import { Soldier } from '../viewer/soldier.js';
import * as Ladder from '../viewer/ladder-climb.js';

const TICK = 1 / 60;
const AX = 2;               // the ladder's plane, world x
const MID_Y = 10;           // its origin, world y
const TOP_Y = 20;           // the top of its box, and the deck's height

const SPEC = {
  axis: [0, 1, 0], length: 20, bottom: [0, -10, 0], top: [0, 10, 0],
  width: 0.6, face: [0, 0, -1],
};
// Column-major: x column (0, 0, -1), y column (0, 1, 0), z column (1, 0, 0),
// the node at (2, 10, 0). The ladder's +z is the node's glTF -z: world -x.
const ELEMENTS = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, AX, MID_Y, 0, 1];
const LADDER = Ladder.ladderRecord(SPEC, ELEMENTS, 'Ladder_20m');

function ladderWorld({ deck = false, water = null } = {}) {
  return {
    waterLevel: water,
    casts: 0,
    surfaceHeight: x => (deck && x < AX ? TOP_Y : 0),
    ladders: [LADDER],
  };
}

const FACE_YAW = -Math.PI / 2;   // forward (-1, 0, 0): the ladder's +z
const OUT_YAW = Math.PI / 2;     // forward (+1, 0, 0): off the deck, over it

function spawnAt(x, z, yaw = FACE_YAW, world = ladderWorld()) {
  const s = new Soldier({ collider: world, worldSize: 2048 });
  s.spawn(x, 0, z, yaw);
  return s;
}

/** A soldier stood at (x, y) with his feet planted, facing `yaw`. */
function standAt(x, y, yaw, world = ladderWorld()) {
  const s = spawnAt(5, 0, yaw, world);
  s.body.place(x, y, 0, yaw);
  s.body.plant(1, -1);
  return s;
}

function stepSeconds(s, seconds, input) {
  for (let i = 0, n = Math.round(seconds / TICK); i < n; i++) s.step(TICK, input);
}

function stepUntilLetGo(s, input, limit = 3000) {
  let frames = 0;
  while (s.climb.active && frames < limit) { s.step(TICK, input); frames++; }
  return frames;
}

const out = {};

out.constants = {
  climb: Ladder.LADDER_CLIMB_SPEED ?? null,
  descent: Ladder.LADDER_DESCENT_SPEED ?? null,
  stateSpeed: Ladder.LADDER_STATE_SPEED ?? null,
  standoff: Ladder.LADDER_STANDOFF ?? null,
  reach: Ladder.LADDER_REACH ?? null,
};
out.record = {
  origin: [LADDER.ox, LADDER.oy, LADDER.oz],
  plusZ: [LADDER.zx, LADDER.zy, LADDER.zz],
  yMin: LADDER.yMin, yMax: LADDER.yMax, xMin: LADDER.xMin, xMax: LADDER.xMax,
};

// 1. The grab from the ground: walking forward into the ladder's -z face,
//    facing its +z, below its origin. Snapped to the face, 0.48 m off it,
//    turned to face +z, and across the rungs where the clamp puts him.
{
  const s = spawnAt(2.8, 0);
  s.step(TICK, { forward: 1 });
  out.snap = {
    active: s.climb.active, name: s.climb.ladderName,
    x: s.x, y: s.y, z: s.z, yaw: s.yaw, t: s.climb.t,
  };
}

// 2. He takes it at his own height: from the ground and from a platform 3 m
//    up (his origin, 4 m, still under the ladder's 10). One tick of climbing
//    rides the grab's tick, as it does in the engine.
{
  const s = spawnAt(2.8, 0);
  s.step(TICK, { forward: 1 });
  const ground = { y: s.y, t: s.climb.t, active: s.climb.active };
  const p = standAt(2.8, 3, FACE_YAW);
  p.step(TICK, { forward: 1 });
  out.grabHeight = { ground, platform: { y: p.y, t: p.climb.t, active: p.climb.active } };
}

// 3. The climb rate up: two consecutive seconds, the first with the ramp.
{
  const s = spawnAt(2.8, 0);
  s.step(TICK, { forward: 1 });
  const y0 = s.y;
  stepSeconds(s, 1, { forward: 1 });
  const y1 = s.y;
  stepSeconds(s, 1, { forward: 1 });
  out.rate = { rise1: y1 - y0, rise2: s.y - y1, active: s.climb.active };
}

// 4. The rate down, and the walk key's third, each over a full-ramp second.
{
  const s = spawnAt(2.8, 0);
  s.step(TICK, { forward: 1 });
  stepSeconds(s, 3, { forward: 1 });
  stepSeconds(s, 0.5, { forward: -1 });
  const y0 = s.y;
  stepSeconds(s, 1, { forward: -1 });
  const down = y0 - s.y;
  const w = spawnAt(2.8, 0);
  w.step(TICK, { forward: 1, walk: true });
  stepSeconds(w, 1, { forward: 1, walk: true });
  const w0 = w.y;
  stepSeconds(w, 1, { forward: 1, walk: true });
  out.rates = { down, walkUp: w.y - w0, active: s.climb.active && w.climb.active };
}

// 5. The look picks the way: W looking down descends, S looking up climbs.
{
  const s = spawnAt(2.8, 0);
  s.step(TICK, { forward: 1 });
  stepSeconds(s, 1.5, { forward: 1 });
  const y0 = s.y;
  s.pitch = -0.3;
  stepSeconds(s, 1, { forward: 1 });
  const wDown = s.y - y0;
  const y1 = s.y;
  s.pitch = 0.3;
  stepSeconds(s, 1, { forward: -1 });
  out.look = { wDown, sUp: s.y - y1, active: s.climb.active };
}

// 6. The hang: no input, and once the ramp has run down, no motion.
{
  const s = spawnAt(2.8, 0);
  s.step(TICK, { forward: 1 });
  stepSeconds(s, 1, { forward: 1 });
  stepSeconds(s, 0.5, {});
  const a = s.y;
  stepSeconds(s, 0.5, {});
  out.hang = { a, b: s.y, stillActive: s.climb.active };
}

// 7. The top: climbing up, he lets go where his origin passes 0.8 m under the
//    box's top, and `stopClimbing` lifts him 2.0 m and a metre along +z,
//    through the ladder, over the deck. Then he settles on the deck.
{
  const s = spawnAt(2.8, 0, FACE_YAW, ladderWorld({ deck: true }));
  s.step(TICK, { forward: 1 });
  const frames = stepUntilLetGo(s, { forward: 1 });
  const exit = s.climb.lastExit;
  stepSeconds(s, 1, {});
  out.topExit = {
    frames, active: s.climb.active, exit,
    settled: { x: s.x, y: s.y, grounded: s.grounded },
  };
}

// 8. The bottom: climbing down, he lets go where his origin passes 1.6 m over
//    the box's bottom (his feet 0.6 m over it) and drops to the ground.
{
  const s = spawnAt(2.8, 0);
  s.step(TICK, { forward: 1 });
  stepSeconds(s, 2, { forward: 1 });
  const frames = stepUntilLetGo(s, { forward: -1 });
  const exit = s.climb.lastExit;
  stepSeconds(s, 0.5, {});
  out.bottomExit = { frames, exit, settled: { y: s.y, grounded: s.grounded } };
}

// 9. The jump press lets go and nothing more: no leap on top of the climb.
{
  const s = spawnAt(2.8, 0);
  s.step(TICK, { forward: 1 });
  stepSeconds(s, 1, { forward: 1 });
  const yAt = s.y;
  s.step(TICK, { forward: 0, jump: true });
  const atLetGo = { active: s.climb.active, vy: s.body.velocity.y, y: s.y,
                    exit: s.climb.lastExit };
  stepSeconds(s, 2, {});
  out.jumpOff = { yAt, atLetGo, yAfter: s.y };
}

// 10. The dead body falls out of the climb: `stopClimbing` from the damage
//     path, and no grab while dead.
{
  const s = spawnAt(2.8, 0);
  s.step(TICK, { forward: 1 });
  stepSeconds(s, 1, { forward: 1 });
  const yAt = s.y;
  s.step(TICK, { forward: 1, dead: true });
  const active = s.climb.active;
  stepSeconds(s, 1, { forward: 1, dead: true });
  out.deadDrop = { yAt, active, exit: s.climb.lastExit, y: s.y, stillOff: !s.climb.active };
}

// 11. Out of reach: 2.2 m off the face is refused.
{
  const s = spawnAt(4.2, 0);
  for (let i = 0; i < 10; i++) s.step(TICK, { forward: 1 });
  out.tooFar = { active: s.climb.active };
}

// 12. A world without ladders never grabs.
{
  const s = new Soldier({
    collider: { waterLevel: null, surfaceHeight: () => 0 }, worldSize: 2048,
  });
  s.spawn(1, 0, 0, 0);
  for (let i = 0; i < 10; i++) s.step(TICK, { forward: 1 });
  out.noLadders = { active: s.climb.active };
}

// 13. The top grab: on the deck, walking forward off it over the ladder
//     (facing its -z), above its origin. Dropped 2.0 m onto the -z face and
//     turned to face the ladder; looking down, W takes him down it.
{
  const s = standAt(1.3, TOP_Y, OUT_YAW, ladderWorld({ deck: true }));
  s.pitch = -0.5;
  const before = s.y;
  s.step(TICK, { forward: 1 });
  const grab = { active: s.climb.active, x: s.x, y: s.y, yaw: s.yaw, drop: before - s.y };
  const frames = stepUntilLetGo(s, { forward: 1 });
  const exit = s.climb.lastExit;
  stepSeconds(s, 0.5, {});
  out.topGrab = { grab, frames, exit, settled: { y: s.y, grounded: s.grounded } };
}

// 14. No backward grab: on the deck with his back to the ladder, S walks him
//     toward it and never takes it.
{
  const s = standAt(1.6, TOP_Y, FACE_YAW, ladderWorld({ deck: true }));
  let took = false;
  for (let i = 0; i < 10; i++) { s.step(TICK, { forward: -1 }); took ||= s.climb.active; }
  out.noBackGrab = { took };
}

// 15. The facing test: at the foot of the ladder but facing along it, W does
//     not take it.
{
  const s = spawnAt(2.8, 0, 0);
  let took = false;
  for (let i = 0; i < 10; i++) { s.step(TICK, { forward: 1 }); took ||= s.climb.active; }
  out.sideways = { took };
}

// 16. Level with or above the ladder's origin on its -z side, facing it: the
//     below arm wants the ladder's origin over his, so neither arm takes him.
{
  const s = standAt(2.8, 12, FACE_YAW);
  let took = false;
  for (let i = 0; i < 5; i++) { s.step(TICK, { forward: 1 }); took ||= s.climb.active; }
  out.aboveOrigin = { took };
}

// 16b. Walking away from it on its +z side, facing +z, within the page's
//      reach: his back is to the ladder and he does not take it (the page's
//      touch asks that he be on the side he faces it from).
{
  const s = spawnAt(1.5, 0);
  let took = false;
  for (let i = 0; i < 5; i++) { s.step(TICK, { forward: 1 }); took ||= s.climb.active; }
  out.walkingAway = { took, x: s.x };
}

// 17. Water: a man whose origin is 0.48 m or more under it cannot take the
//     ladder; a man climbing down lets go 0.5 m under it.
{
  const wet = ladderWorld({ water: 5 });
  const s = standAt(2.8, 3.4, FACE_YAW, wet);
  s.step(TICK, { forward: 1 });
  const refused = !s.climb.active;
  const d = standAt(2.8, 8, FACE_YAW, wet);
  d.step(TICK, { forward: 1 });
  const took = d.climb.active;
  const frames = stepUntilLetGo(d, { forward: -1 });
  out.water = { refused, took, frames, exit: d.climb.lastExit };
}

// 18. A swimmer takes a net: pinned with his origin 0.4 m under the surface,
//     under the grab's 0.48, he takes the ladder, and the climb's states end
//     his swim.
{
  const wet = ladderWorld({ water: 5 });
  const s = spawnAt(2.8, 0, FACE_YAW, wet);
  stepSeconds(s, 3, {});
  const before = { swimming: s.swim.swimming, y: s.y };
  s.step(TICK, { forward: 1 });
  out.swimmer = {
    before, active: s.climb.active, swimming: s.swim.swimming, y: s.y,
  };
}

console.log(JSON.stringify(out));
