// Gap 16 — ladders: the climb state of the on-foot soldier, and the index of
// climbable ladders a level's scene carries (`features/ladder-climbing/README.md`).
//
// The engine's own subsystem, from `bf1942_lnxded.static` (ledger LADDER-1..5):
//
//   `BFSoldier::handleCollision`  0x0827d3b0  a contact with a ladder material
//                                             (192..195) on an object in the
//                                             ladder collision group records
//                                             the ladder (`+0x3c8`, `+0x3c4`,
//                                             0x0827d464)
//   `BFSoldier::handleClimbAction` 0x08281080 the grab, the per-tick snap, the
//                                             climb direction, the exits
//   `getLadderClosestPosition`    0x08280b40  the snap: the ladder's own frame,
//                                             across the rungs clamped, up the
//                                             ladder kept, -0.48 on its z
//   `BFSoldier::stopClimbing`     0x08281ca0  every way off: the top's lift
//                                             through the ladder, the push down
//   `BFSoldier::handlePlayerInput` 0x08273c70 gravity off (0x0827515e) and the
//                                             velocity set along the ladder's
//                                             up axis (0x08274ccd) while a
//                                             ladder is held
//
// Everything the engine measures here is in the LADDER'S frame, from the
// placed object's own transform and the `.sm` header's bounding box
// (`BStandardMesh::getBoundingBox` 0x083b4e40, filled by `loadHeader`
// 0x083a6200), and against the soldier's ORIGIN, which is a metre over the
// feet this body carries (`CHARACTER_HEIGHT`, `swim.js` THE ORIGIN):
//
//  * **The frame.** The ladder's rows: x across the rungs, y up the ladder, z
//    its face normal. The climber is always snapped to z = -0.48, so he climbs
//    the -z face looking along +z; the +z side is the deck side, where the top
//    exit puts him. The exporter's `extras.isLadder` carries the box, not the
//    frame, so `ladderRecord` reads the frame off the node's world matrix:
//    the exporter mirrors Refractor's z, so the ladder's +z is the node's
//    glTF -z.
//  * **The box.** The `.sm` header bounds are the LOD-0 vertex box for all 15
//    meshes the 17 vanilla ladder geometries draw (measured), which is what
//    the exporter's bottom and top are: `yMin` / `yMax` are the box's y extent
//    in the ladder's frame, `xMin` / `xMax` its x extent.
//
// Like `swim.js`, this module imports nothing browser-specific and the body
// reads its collaborators duck-typed, so the whole file runs under plain node
// (`tests/test_ladder.py` drives `tests/ladder_harness.mjs`).
//
// The ladder index (`collectLadders`) is built once per level by
// `level-terrain.js`'s `buildCollider` from the scene nodes the exporter
// stamped `extras.isLadder` on (Gap 16). It reads three.js objects through the
// two fields it needs (`traverse`, `matrixWorld.elements`) and hands back plain
// numbers, so the climb law never touches a scene graph.

import {
  DIRECTIONAL_SPEED, applyMovementFactors, rampedDirectionalSpeed,
} from './soldier-locomotion.js';
import { CHARACTER_HEIGHT, POSE_STAND } from './soldier-pose.js';

/** `getLadderClosestPosition` 0x08280b40: the climber's place on the ladder's
 *  own z, `-0.48` (the immediate `0xbef5c28f` at 0x08280e18), in metres. */
export const LADDER_STANDOFF = 0.48;

/** Same function: across the rungs he is clamped into `[bbox.min.x + 0.4,
 *  bbox.max.x - 0.4]` (`0x086c4f70`, loaded at 0x08280dd5). */
export const LADDER_RUNG_INSET = 0.4;

/** `handleClimbAction`: the grab's facing test, his forward against the
 *  ladder's +z, `> 0.8` below its origin and `< -0.8` above it (`0x086d2954`
 *  at 0x082817da, `0x086d2958` at 0x08281802). */
export const LADDER_GRAB_DOT = 0.8;

/** The grab refuses a man whose origin is this far under the water or more
 *  (`0x086d2950`, 0x082817b0). */
export const LADDER_GRAB_WATER = 0.48;

/** The top grab drops him this far before the snap (`0x086c08c4`, 0x0828191c),
 *  and `stopClimbing` lifts him the same 2.0 at the top (0x08281efa). */
export const LADDER_TOP_DROP = 2.0;

/** The bottom exit: moving down with his origin under `bbox.min.y + 1.6` in the
 *  ladder's frame (`0x086d295c`, 0x0828154e) — his feet 0.6 m over the box. */
export const LADDER_BOTTOM_ZONE = 1.6;

/** The top: his origin over `bbox.max.y - 0.8` (`0x086d2954`, 0x0828163a in
 *  `handleClimbAction`, 0x08281e2b in `stopClimbing`). */
export const LADDER_TOP_ZONE = 0.8;

/** Climbing down with his origin more than 0.5 m under the water lets go
 *  (`0x086b05e8`, 0x0828160a). */
export const LADDER_WATER_EXIT = 0.5;

/** `stopClimbing`'s top arm adds his own forward, a unit vector, which the
 *  snap has held on the ladder's +z every climbing tick (0x08282002-0x08282027):
 *  from z = -0.48 to z = +0.52, a metre through the ladder. */
export const LADDER_EXIT_THROUGH = 1.0;

/** And every `stopClimbing` hands the root physics `(0, -100, 0)` through
 *  `addAccelerationAtRelativePosition` (`0xc2c80000` at 0x08281e6f, vt+0x6c at
 *  0x08281ecc): an acceleration for one tick, not an impulse — no
 *  `g_simulationFps` scales it, so what it takes off his speed is the tick's
 *  length times 100 (3.3 m/s at 30 Hz, 1.7 at this page's 60). */
export const LADDER_EXIT_PUSH = -100;

/** `AnimationStatesClimb.con`: `Lb_ClimbLadder1`, `1B`, `2` and `2B` all
 *  declare `setSpeed 0.7 0 0`, and a held throttle hands each idle straight
 *  on to the next of the four (`addTransitionOne c_PIThrottle 0.5 1`, and
 *  `-1 -0.5` down). */
export const LADDER_STATE_SPEED = 0.7;

/** The climb rate, m/s, both ways, at the full ramp, running: the standing row
 *  of `directionalSpeed` (6 forward, 4 not) times `LADDER_STATE_SPEED`, which
 *  `handlePlayerInput` sets as the velocity along the ladder's up axis
 *  (`setPositionalSpeed`, 0x08274ccd). The walk key takes a third of it, as it
 *  does on the ground. Derived here, not chosen: see `climbSpeed`. */
export const LADDER_CLIMB_SPEED = DIRECTIONAL_SPEED[0] * LADDER_STATE_SPEED;
export const LADDER_DESCENT_SPEED = DIRECTIONAL_SPEED[1] * LADDER_STATE_SPEED;

/** How near the ladder a soldier must be to be touching it. The engine's
 *  touch is a collision contact with the ladder's own collision mesh
 *  (`handleCollision` 0x0827d437-0x0827d46a), which this page's resolve does
 *  not record; 1.0 m from the ladder's face and edges stands in for it.
 *  The page's number, not the engine's. */
export const LADDER_REACH = 1.0;

/** How far above the ladder's visible top the touch reaches. The collision
 *  meshes run past their rungs: `ladder_10m_m1` 1.13 m, `ladder_5m_m1` 1.33,
 *  `ladder_20m_m1` 1.08, the four `Shokaku_lad` 0.89-1.29, the nets 0.49-1.62,
 *  `Woodladder_4m_m1` 0.17 (`.sm` collision layers against their headers).
 *  That is what lets a man on the deck touch the ladder he is about to take.
 *  One page number for all of them. */
export const LADDER_TOUCH_ABOVE = 1.1;

function unit(x, y, z) {
  const length = Math.hypot(x, y, z);
  return length > 0
    ? { x: x / length, y: y / length, z: z / length, length }
    : { x: 0, y: 0, z: 0, length: 0 };
}

/** A world point in the ladder's frame: `(p - origin) . row`. */
function toLocal(ladder, x, y, z) {
  const dx = x - ladder.ox, dy = y - ladder.oy, dz = z - ladder.oz;
  return {
    x: dx * ladder.rx + dy * ladder.ry + dz * ladder.rz,
    y: dx * ladder.ux + dy * ladder.uy + dz * ladder.uz,
    z: dx * ladder.zx + dy * ladder.zy + dz * ladder.zz,
  };
}

/** A point in the ladder's frame back to the world. */
function fromLocal(ladder, lx, ly, lz) {
  return {
    x: ladder.ox + ladder.rx * lx + ladder.ux * ly + ladder.zx * lz,
    y: ladder.oy + ladder.ry * lx + ladder.uy * ly + ladder.zy * lz,
    z: ladder.oz + ladder.rz * lx + ladder.uz * ly + ladder.zz * lz,
  };
}

/**
 * The across-rungs clamp of `getLadderClosestPosition` (0x08280dd5-0x08280dfb
 * and its far arm): below `min.x + 0.4` takes `min.x + 0.4`; otherwise past
 * `max.x - 0.4` takes `max.x - 0.4`. A ladder narrower than 0.8 m has the two
 * bounds crossed, and the order of the tests is the whole answer: a 0.63 m
 * ladder puts him 8.5 cm to one side of its middle or the other, never on it.
 */
function clampAcross(ladder, x) {
  if (!(ladder.xMin + LADDER_RUNG_INSET <= x)) return ladder.xMin + LADDER_RUNG_INSET;
  if (ladder.xMax - LADDER_RUNG_INSET < x) return ladder.xMax - LADDER_RUNG_INSET;
  return x;
}

/**
 * Turn a node's `extras.isLadder` into a world-space climbable record.
 *
 * `e` is the node's `matrixWorld.elements` (column-major, as three stores it)
 * read AFTER `indexScene` has composed the level; the spec's points are in the
 * node's own glTF frame, so the bundle a ladder hangs in composes itself.
 *
 * The record keeps the old line fields (`x..tz` bottom and top, `face`,
 * `length`, `width`) for the hooks, and adds the ladder's own frame, which is
 * what the climb works in: the origin (`o*`), the rows (`r*` across, `u*` up,
 * `z*` the ladder's +z, glTF -z because the exporter mirrors Refractor's z),
 * and the box in that frame. `yMin`/`yMax` are the bottom and top projected on
 * the up row; `xMin`/`xMax` are the centre line plus and minus half the width,
 * which is the box's x extent when the spec's face is the mesh's z — true of
 * every vanilla ladder — and nothing otherwise.
 */
export function ladderRecord(spec, e, name = null) {
  const at = (p) => ({
    x: e[0] * p[0] + e[4] * p[1] + e[8] * p[2] + e[12],
    y: e[1] * p[0] + e[5] * p[1] + e[9] * p[2] + e[13],
    z: e[2] * p[0] + e[6] * p[1] + e[10] * p[2] + e[14],
  });
  const bottom = at(spec.bottom);
  const top = at(spec.top);
  const face = unit(
    e[0] * spec.face[0] + e[4] * spec.face[1] + e[8] * spec.face[2],
    e[1] * spec.face[0] + e[5] * spec.face[1] + e[9] * spec.face[2],
    e[2] * spec.face[0] + e[6] * spec.face[1] + e[10] * spec.face[2]);
  const right = unit(e[0], e[1], e[2]);
  const up = unit(e[4], e[5], e[6]);
  const plusZ = unit(-e[8], -e[9], -e[10]);
  const record = {
    name: name || spec.geometry || null,
    x: bottom.x, y: bottom.y, z: bottom.z,
    tx: top.x, ty: top.y, tz: top.z,
    length: Math.hypot(top.x - bottom.x, top.y - bottom.y, top.z - bottom.z)
      || spec.length,
    fx: face.x, fy: face.y, fz: face.z,
    width: spec.width,
    ox: e[12], oy: e[13], oz: e[14],
    rx: right.x, ry: right.y, rz: right.z,
    ux: up.x, uy: up.y, uz: up.z,
    zx: plusZ.x, zy: plusZ.y, zz: plusZ.z,
    yMin: 0, yMax: 0, xMin: 0, xMax: 0,
  };
  const lb = toLocal(record, bottom.x, bottom.y, bottom.z);
  const lt = toLocal(record, top.x, top.y, top.z);
  record.yMin = Math.min(lb.y, lt.y);
  record.yMax = Math.max(lb.y, lt.y);
  const across = Math.abs(spec.face?.[2] ?? 0) > 0.9
    ? 0.5 * (spec.width || 0) * right.length : 0;
  record.xMin = lb.x - across;
  record.xMax = lb.x + across;
  return record;
}

/**
 * One climbable per node the exporter stamped `extras.isLadder` on.
 *
 * Runs over the whole scene root, parked vehicles included: a ship's
 * `ClimbingNet` hangs inside a spawner child's subtree exactly as a guard
 * tower's ladder hangs inside the tower. Nodes the exporter wrote no spec on
 * (an unbaked level, a missing mesh file) are skipped — an index of nothing is
 * honest, and `__ladderInject` exists for a headless check that must stand a
 * ladder in by hand.
 */
export function collectLadders(root) {
  const ladders = [];
  root.traverse(obj => {
    const spec = obj.userData?.isLadder;
    if (!spec || typeof spec !== 'object') return;
    obj.updateWorldMatrix(true, false);
    ladders.push(ladderRecord(spec, obj.matrixWorld.elements, obj.name));
  });
  return ladders;
}

/**
 * The climb state of one soldier. Created by `Soldier` (soldier.js), stepped
 * from its tick loop, reset on spawn/bail-out — the same seams the parachute
 * and the swim state hang on.
 */
export class ClimbState {
  constructor() {
    this.active = false;
    /** The ladder in hand, and where on it, in its own frame: `lx` the
     *  across-rungs place stored at the grab (the engine's `+0x3cc`, a -4711.0
     *  sentinel until `getLadderClosestPosition` first writes it), `ly` his
     *  ORIGIN's height up the ladder. */
    this.ladder = null;
    this.lx = 0;
    this.ly = 0;
    /** What the last climb ended in, for the hooks and the tests: `{ kind,
     *  lifted, x, y, z }` with the feet where `stopClimbing` left them. */
    this.lastExit = null;
  }

  reset() {
    this.active = false;
    this.ladder = null;
    this.lx = 0;
    this.ly = 0;
  }

  get ladderName() { return this.ladder?.name ?? null; }

  /** His feet's place up the ladder's box, 0 at the bottom, 1 at the top. */
  get t() {
    const l = this.ladder;
    if (!l || !(l.yMax > l.yMin)) return 0;
    return (this.ly - CHARACTER_HEIGHT - l.yMin) / (l.yMax - l.yMin);
  }

  /** The side he hangs on, horizontally: the ladder's -z. */
  get sx() { return this.ladder ? -this.ladder.zx : 0; }
  get sz() { return this.ladder ? -this.ladder.zz : 0; }
}

/**
 * Put him at his place on the ladder: his origin at `(clampAcross(lx), ly,
 * -0.48)` in the ladder's frame, his feet a metre under it.
 * `getLadderClosestPosition`, which `handleClimbAction` runs every climbing
 * tick (0x082812b1). `teleport` is a grab: it drops the render's
 * interpolation and turns him to face the ladder's +z. The engine hands him
 * the ladder's rows every tick (`setAbsoluteTransformation`, 0x08281364); the
 * page turns him once, at the grab, and leaves the mouse his. A climbing tick
 * keeps the interpolation, so the climb draws smooth between ticks.
 */
function placeOnLadder(climb, body, teleport) {
  const ladder = climb.ladder;
  const origin = fromLocal(ladder, clampAcross(ladder, climb.lx), climb.ly,
                           -LADDER_STANDOFF);
  const feetY = origin.y - CHARACTER_HEIGHT;
  const point = body.body;
  if (teleport) {
    point.setPosition(origin.x, feetY, origin.z);
    body.yaw = Math.atan2(ladder.zx, ladder.zz);
  } else {
    point.previous.x = point.position.x;
    point.previous.y = point.position.y;
    point.previous.z = point.position.z;
    point.position.x = origin.x;
    point.position.y = feetY;
    point.position.z = origin.z;
  }
  // Every rung is a contact while climbing: a man who lets go mid-ladder is
  // billed from where he let go.
  body.lastCollisionHeight = feetY;
  body.grounded = false;
}

/**
 * Whether his body is touching a ladder, and how near: the page's stand-in for
 * the collision contact that records one (see `LADDER_REACH`). His origin must
 * be within `LADDER_REACH` of the ladder's face rectangle, measured in its own
 * frame (off the face along z, off the edges across the rungs), and his body's
 * height must overlap the ladder's, which runs `LADDER_TOUCH_ABOVE` past the
 * visible top. Returns the distance, or `Infinity`, and which side of the
 * ladder's plane he is on (`z`, its own).
 */
function touch(ladder, body) {
  const p = body.position;
  const local = toLocal(ladder, p.x, p.y + CHARACTER_HEIGHT, p.z);
  const feet = local.y - CHARACTER_HEIGHT;
  const height = body.height || 1.8;
  if (feet > ladder.yMax + LADDER_TOUCH_ABOVE || feet + height < ladder.yMin) {
    return { d: Infinity, z: local.z };
  }
  const across = Math.max(0, ladder.xMin - local.x, local.x - ladder.xMax);
  const d = Math.hypot(across, local.z);
  return { d: d <= LADDER_REACH ? d : Infinity, z: local.z };
}

/**
 * The grab, `BFSoldier::handleClimbAction` 0x08281080, for a man holding
 * forward (`c_PIThrottle > 0`, 0x082811b6-0x082811c5 — the caller checks it).
 *
 * The nearest ladder he is touching takes him when his origin is under less
 * than 0.48 m of water (0x082817c8) and one of two arms holds (`fwd` his
 * facing, `+z` the ladder's, `origin` his and the ladder's own):
 *
 *   below  the ladder's origin above his, and `fwd . +z > 0.8` (0x082817ed):
 *          walking into it from its -z side. No position is written
 *          (0x082818f4); the snap keeps his height.
 *   above  the ladder's origin below his, and `fwd . +z < -0.8` (0x08281817):
 *          walking forward off the deck over it, facing out. He is dropped
 *          2.0 m (0x0828192e) before `getLadderClosestPosition` (0x08281964)
 *          puts him on the -z face, turned to face the ladder.
 *
 * There is no backward grab, and no ground test: a man in the air touching a
 * ladder with forward held takes it. A soldier level with the ladder's origin
 * takes neither arm. Returns true when the climb took.
 *
 * The page's touch also asks that he be on the side he faces the ladder from
 * — its -z for the below arm, its +z for the above — because the contact the
 * engine records is his hull meeting the ladder's, which a man walking away
 * from a ladder does not do; the page's metre of reach otherwise takes a man
 * with his back to it and puts him through it.
 */
export function climbStart(climb, body, ladders) {
  const p = body.position;
  const originY = p.y + CHARACTER_HEIGHT;
  const water = body.world?.waterLevel;
  if (Number.isFinite(water) && water - originY >= LADDER_GRAB_WATER) return false;
  const fx = Math.sin(body.yaw), fz = Math.cos(body.yaw);
  let best = null;
  let bestD = Infinity;
  let bestDrop = 0;
  for (const ladder of ladders) {
    const { d, z } = touch(ladder, body);
    if (!(d < bestD)) continue;
    const dot = fx * ladder.zx + fz * ladder.zz;
    let drop;
    if (ladder.oy > originY && dot > LADDER_GRAB_DOT && z <= 0) drop = 0;
    else if (originY > ladder.oy && dot < -LADDER_GRAB_DOT && z >= 0) drop = LADDER_TOP_DROP;
    else continue;
    best = ladder;
    bestD = d;
    bestDrop = drop;
  }
  if (!best) return false;
  const local = toLocal(best, p.x, originY - bestDrop, p.z);
  climb.active = true;
  climb.ladder = best;
  climb.lx = clampAcross(best, local.x);
  climb.ly = local.y;
  climb.lastExit = null;
  placeOnLadder(climb, body, true);
  // The velocity is the climb's from here (`setPositionalSpeed` every tick);
  // whatever he walked or fell in with is gone.
  body.body.setVelocity(0, 0, 0);
  return true;
}

/**
 * `stopClimbing` (0x08281ca0): every way off the ladder. At the top — his
 * origin over `bbox.max.y - 0.8` (0x08281e45) — he is lifted 2.0 m, snapped
 * again, and moved a metre along the ladder's +z, through it onto the deck
 * side (0x08281efa-0x08282037). Anywhere else he is simply let go where he
 * hangs. Either way the root physics gets its `(0, -100, 0)` for one tick
 * (0x08281ecc), and his velocity is left as the climb set it.
 */
export function climbStop(climb, body, kind) {
  const ladder = climb.ladder;
  let lifted = false;
  if (ladder && climb.ly > ladder.yMax - LADDER_TOP_ZONE) {
    const origin = fromLocal(ladder, clampAcross(ladder, climb.lx),
                             climb.ly + LADDER_TOP_DROP,
                             -LADDER_STANDOFF + LADDER_EXIT_THROUGH);
    body.body.setPosition(origin.x, origin.y - CHARACTER_HEIGHT, origin.z);
    lifted = true;
  }
  body.body.addAcceleration(0, LADDER_EXIT_PUSH, 0);
  body.grounded = false;
  body.lastCollisionHeight = body.position.y;
  const p = body.position;
  climb.lastExit = { kind, lifted, x: p.x, y: p.y, z: p.z };
  climb.reset();
  return kind;
}

/**
 * The climb's speed along the ladder's up axis for a direction and the body's
 * forward ramp: `handlePlayerInput`'s own forward command (PHY-6, PHY-9) with
 * the pose the climb states give (standing: none of them declares
 * `c_AsmIsCrouching` or `c_AsmIsLying`), times `LADDER_STATE_SPEED`. The ramp
 * is the same register the walk uses (`this+0x58d`), so a man who runs into a
 * ladder climbs at full speed from the first tick. The page steps the ramp
 * linearly, as `walking-body.js` does (PHY-9's square is not built there
 * either); the two agree at the full ramp, which is `LADDER_CLIMB_SPEED`.
 */
export function climbSpeed(body, direction, dt, walk) {
  body.forwardRamp = applyMovementFactors(direction, body.forwardRamp || 0, dt);
  return rampedDirectionalSpeed(POSE_STAND, body.forwardRamp, walk) * LADDER_STATE_SPEED;
}

/**
 * One tick of climbing, `handleClimbAction`'s climbing half then
 * `handlePlayerInput`'s motion. `input` is `{ forward, pitch, walk }`: the
 * clamped throttle axis, his look pitch (radians, up positive) and the walk
 * key. Returns what ended the climb ('top', 'bottom', 'water'), or null while
 * it continues.
 *
 *  * **Which way.** A held throttle, either way, climbs the way he LOOKS: the
 *    sign of his aim pitch (`+0x284`, 0x08281382-0x082813aa); only a level
 *    look leaves the key's own sign. So W looking down descends, and S looking
 *    up climbs. Nothing held hangs, once the ramp has run down.
 *  * **The ends**, tested before this tick's motion, against his origin's
 *    height in the ladder's frame: moving down under `bbox.min.y + 1.6`
 *    (0x08281565-0x08281587), moving up over `bbox.max.y - 0.8`
 *    (0x0828163a-0x082816de), or moving down more than 0.5 m under the water
 *    (0x0828160a) — each `stopClimbing`.
 *  * **The motion**: gravity off (0x0827515e) and the velocity set to the up
 *    axis times `climbSpeed` (0x08274ccd), which the physics then integrates.
 *
 * `Lb_ClimbLadderEnd1`, `Lb_ClimbLadderExit` and `StopClimbing` are tested at
 * the top (0x08281685-0x082816d6) and from the hang (0x08281a90), but no
 * transition in `AnimationStatesClimb.con` enters them and no code sets them
 * (their names are read only by `BFSoldierTemplate::init`, 0x0827ad9f-
 * 0x0827ae3f): in vanilla those arms never run, and they are not built.
 */
export function climbTick(climb, body, dt, input = {}) {
  if (!climb.active) return null;
  const ladder = climb.ladder;
  const raw = input.forward || 0;
  const pitch = input.pitch || 0;
  const direction = raw === 0 ? 0 : (pitch > 0 ? 1 : pitch < 0 ? -1 : Math.sign(raw));
  const originY = climb.ly;
  if (direction < 0 && originY < ladder.yMin + LADDER_BOTTOM_ZONE) {
    return climbStop(climb, body, 'bottom');
  }
  if (direction > 0 && originY > ladder.yMax - LADDER_TOP_ZONE) {
    return climbStop(climb, body, 'top');
  }
  if (direction < 0) {
    const water = body.world?.waterLevel;
    const worldOrigin = body.position.y + CHARACTER_HEIGHT;
    if (Number.isFinite(water) && water - worldOrigin > LADDER_WATER_EXIT) {
      return climbStop(climb, body, 'water');
    }
  }
  const speed = climbSpeed(body, direction, dt, !!input.walk);
  climb.ly += speed * dt;
  placeOnLadder(climb, body, false);
  body.body.setVelocity(ladder.ux * speed, ladder.uy * speed, ladder.uz * speed);
  return null;
}
