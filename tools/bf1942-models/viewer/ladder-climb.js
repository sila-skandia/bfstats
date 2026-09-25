// Gap 16 — ladders: the climb state of the on-foot soldier, and the index of
// climbable ladders a level's scene carries (`features/ladder-climbing/README.md`).
//
// The engine's own subsystem, from `bf1942_lnxded.static` (Ghidra pass recorded
// in `features/bf1942-3d-models/parity-audit/level-content.md`, Gap 16):
//
//   `BFSoldier::startClimbing`   0x08281b20  joins collision group 4 via
//                                            IResponsePhysics vt+0x30, snaps
//                                            onto the ladder plane, plays
//                                            `Ub_ClimbLadder1`
//   `getLadderClosestPosition`   0x08280b40  a fixed **-0.48 m** perpendicular
//                                            standoff off the ladder plane
//   `handleClimbAction`          0x08281080  reads the forward/back throttle axis
//                                            each tick; ladder-top and
//                                            ladder-bottom exit tests
//   `stopClimbing`               0x08281ca0  leaves the group, restores the
//                                            default animation state
//   `updateClimbing`             0x08280f10  a literal no-op — climbing has no
//                                            coded speed constant at all;
//                                            motion is animation root-motion
//
// Two consequences drive the design:
//
//  * **The climb speed is a placeholder, and says so in one place.** The engine
//    gives no number to copy (`updateClimbing` is `return;`); the one-rung
//    `.baf` clips play at `setSpeed 0.7` and their root motion was never
//    measured. `LADDER_CLIMB_SPEED = 2.5` m/s is chosen to read as a brisk
//    climb and is the only place the number lives.
//  * **The -0.48 m standoff is the engine's own.** `LADDER_STANDOFF` is the
//    perpendicular distance from the ladder plane the soldier is snapped to.
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

/** The climb rate, m/s. PLACEHOLDER — the engine's climbing is animation-driven
 *  and has no coded speed to copy (see the header). One place, deliberately. */
export const LADDER_CLIMB_SPEED = 2.5;

/** `getLadderClosestPosition` 0x08280b40: the fixed perpendicular distance the
 *  snapped soldier stands off the ladder plane, in metres. */
export const LADDER_STANDOFF = 0.48;

/** How close to the ladder's axis a soldier must be, with forward held, for
 *  `startClimbing` to take him. Pressed against the ladder's collision hull he
 *  stands roughly the standoff plus a body radius out; 1.0 m reaches that and
 *  no casual walk-past nearer than a metre to a ladder grabs it. */
export const LADDER_REACH = 1.0;

/** The horizontal step onto the deck when the climb ends at the top, through
 *  the ladder — a guard tower's platform is on the far side of its ladder from
 *  the man who just climbed it. Metres. */
export const LADDER_TOP_STEP = 0.4;

/** Nearest point on one ladder's segment to a point, as a parameter and a
 *  squared distance. `t` runs 0 at the bottom to 1 at the top and may leave
 *  [0, 1] — the caller decides what a close approach beyond the ends means. */
function closestOnLadder(ladder, x, y, z) {
  const ax = ladder.tx - ladder.x;
  const ay = ladder.ty - ladder.y;
  const az = ladder.tz - ladder.z;
  const span = ax * ax + ay * ay + az * az;
  const t = span > 0
    ? ((x - ladder.x) * ax + (y - ladder.y) * ay + (z - ladder.z) * az) / span
    : 0;
  const px = ladder.x + ax * t;
  const py = ladder.y + ay * t;
  const pz = ladder.z + az * t;
  const dx = x - px, dy = y - py, dz = z - pz;
  return { t, d2: dx * dx + dy * dy + dz * dz, px, py, pz };
}

/**
 * Turn a node's `extras.isLadder` into a world-space climbable record.
 *
 * `e` is the node's `matrixWorld.elements` (column-major, as three stores it)
 * read AFTER `indexScene` has composed the level; the spec's points are in the
 * node's own glTF frame, so the bundle a ladder hangs in composes itself.
 * `face` is a direction, so it goes through the linear part only and is
 * re-normalised in case the level scales its statics.
 */
export function ladderRecord(spec, e, name = null) {
  const at = (p) => ({
    x: e[0] * p[0] + e[4] * p[1] + e[8] * p[2] + e[12],
    y: e[1] * p[0] + e[5] * p[1] + e[9] * p[2] + e[13],
    z: e[2] * p[0] + e[6] * p[1] + e[10] * p[2] + e[14],
  });
  const bottom = at(spec.bottom);
  const top = at(spec.top);
  const face = {
    x: e[0] * spec.face[0] + e[4] * spec.face[1] + e[8] * spec.face[2],
    y: e[1] * spec.face[0] + e[5] * spec.face[1] + e[9] * spec.face[2],
    z: e[2] * spec.face[0] + e[6] * spec.face[1] + e[10] * spec.face[2],
  };
  const length = Math.hypot(face.x, face.y, face.z);
  if (length > 0) {
    face.x /= length; face.y /= length; face.z /= length;
  } else {
    face.x = face.y = face.z = 0;
  }
  return {
    name: name || spec.geometry || null,
    x: bottom.x, y: bottom.y, z: bottom.z,
    tx: top.x, ty: top.y, tz: top.z,
    length: Math.hypot(top.x - bottom.x, top.y - bottom.y, top.z - bottom.z)
      || spec.length,
    fx: face.x, fy: face.y, fz: face.z,
    width: spec.width,
  };
}

/**
 * One climbable per node the exporter stamped `extras.isLadder` on.
 *
 * Runs over the whole scene root, parked vehicles included: a ship's
 * `ClimbingNet` hangs inside a spawner child's subtree exactly as a guard
 * tower's ladder hangs inside the tower. Nodes the exporter wrote no spec on
 * (an unbaked level, a missing mesh file) are skipped — an index of nothing is
 * honest, and `__ladderInject` exists for the headless check that must stand a
 * ladder in before the re-bake ships the real extras.
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
    /** The ladder in hand, and where on it: `t` runs 0 at the bottom, 1 at
     *  the top. `sx`/`sz` are the horizontal standoff direction — the side of
     *  the ladder the soldier was snapped onto, oriented toward him at grab
     *  time (the exporter's `face` sign is arbitrary). */
    this.ladder = null;
    this.t = 0;
    this.sx = 0;
    this.sz = 0;
  }

  reset() {
    this.active = false;
    this.ladder = null;
    this.t = 0;
    this.sx = 0;
    this.sz = 0;
  }

  get ladderName() { return this.ladder?.name ?? null; }
}

/**
 * Try to start a climb: the nearest ladder whose axis lies within
 * `LADDER_REACH` of the soldier's mid-body.
 *
 * Forward input grabs anywhere along the ladder (walking into it from the
 * ground, the engine's own start); backward input grabs only near the TOP —
 * stepping backwards off a deck onto the ladder to climb down, which is the
 * other way the game is played. On a grab the soldier is snapped onto the
 * axis line at the closest point, offset perpendicular by the engine's
 * 0.48 m standoff on the side he approached from, and turned to face the
 * ladder. Returns true when the climb took (the caller skips that tick's
 * normal body step).
 */
export function climbStart(climb, body, ladders) {
  const p = body.position;
  const midY = p.y + body.height * 0.5;
  let best = null;
  let bestD2 = LADDER_REACH * LADDER_REACH;
  let bestT = 0;
  for (const ladder of ladders) {
    const near = closestOnLadder(ladder, p.x, midY, p.z);
    // Reach is a horizontal test against the axis; the vertical span is the
    // segment's own job. Allow a little past the ends so the top-grab (a man
    // standing on the deck, whose mid-body is beside the ladder's top rung)
    // still finds the ladder at all.
    if (near.d2 < bestD2 && near.t >= -0.2 && near.t <= 1.2) {
      best = ladder;
      bestD2 = near.d2;
      bestT = near.t;
    }
  }
  if (!best) return false;
  const near = closestOnLadder(best, p.x, midY, p.z);
  const t = Math.min(1, Math.max(0, near.t));
  // The standoff side: the ladder's own face normal, flipped to point at the
  // soldier; a ladder whose face never resolved stands him on an arbitrary
  // but fixed side (face is horizontal by construction, so it is at worst
  // cosmetic which side).
  let sx = best.fx, sz = best.fz;
  if (sx === 0 && sz === 0) { sx = 1; sz = 0; }
  const toSoldierX = p.x - near.px, toSoldierZ = p.z - near.pz;
  if (sx * toSoldierX + sz * toSoldierZ < 0) {
    sx = -sx;
    sz = -sz;
  }
  climb.active = true;
  climb.ladder = best;
  climb.t = t;
  climb.sx = sx;
  climb.sz = sz;
  placeOnLadder(climb, body, 0);
  // Face the ladder: the page's convention is forward = (sin yaw, 0, cos yaw),
  // and facing the ladder is looking along the negated standoff direction.
  body.yaw = Math.atan2(-climb.sx, -climb.sz);
  return true;
}

/** Put the feet on the climb line at the state's `t`, plus the standoff. */
function placeOnLadder(climb, body, dt) {
  const ladder = climb.ladder;
  const stand = LADDER_STANDOFF;
  const x = ladder.x + (ladder.tx - ladder.x) * climb.t + climb.sx * stand;
  const y = ladder.y + (ladder.ty - ladder.y) * climb.t;
  const z = ladder.z + (ladder.tz - ladder.z) * climb.t + climb.sz * stand;
  body.body.setPosition(x, y, z);
  body.body.setVelocity(0, 0, 0);
  // Every rung is a contact while climbing: a leap off mid-ladder is billed
  // from where he let go, and the top exit lands with nothing owed.
  body.lastCollisionHeight = y;
  if (dt > 0) {
    body.body.previous.x = x;
    body.body.previous.y = y;
    body.body.previous.z = z;
  }
  return { x, y, z };
}

/**
 * One tick of climbing. `forward` is the clamped throttle axis: positive
 * climbs up, negative down, zero hangs on. Returns what ended the climb, or
 * null while it continues — 'top' when the soldier reached the ladder's top
 * and was stepped off onto the deck side, 'bottom' when his feet reached the
 * bottom and normal physics takes over there.
 */
export function climbTick(climb, body, dt, forward) {
  if (!climb.active) return null;
  const rate = LADDER_CLIMB_SPEED;
  const ladder = climb.ladder;
  if (forward > 0) {
    climb.t += rate * dt / (ladder.length || 1);
    if (climb.t >= 1) {
      placeOnLadder(climb, body, dt);
      // Off the top: through the ladder, onto the deck it is standing against.
      body.body.setPosition(
        ladder.tx - climb.sx * LADDER_TOP_STEP,
        ladder.ty,
        ladder.tz - climb.sz * LADDER_TOP_STEP);
      body.body.setVelocity(0, 0, 0);
      body.grounded = false;
      climb.reset();
      return 'top';
    }
  } else if (forward < 0) {
    climb.t -= rate * dt / (ladder.length || 1);
    if (climb.t <= 0) {
      climb.t = 0;
      placeOnLadder(climb, body, dt);
      body.body.setVelocity(0, 0, 0);
      body.grounded = false;
      climb.reset();
      return 'bottom';
    }
  }
  placeOnLadder(climb, body, dt);
  body.grounded = false;
  return null;
}
