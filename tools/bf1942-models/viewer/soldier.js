// Standing in a level on foot: a soldier's eye, his legs, and the world
// stopping him.
//
// Companion to `collision.js` and, like it, **this module imports nothing** —
// not `three`, not the DOM. It reads a collider through the two methods it
// actually needs (`cast`, `surfaceHeight`) and returns plain numbers, which is
// what lets `tests/test_soldier.py` run the real module under node against a
// fake world with no renderer and no GL. The page owns the camera; this owns
// where the camera is allowed to be.
//
// Everything here that came out of the game's own data is cited to the file it
// came from. Everything that did not is marked DERIVED (measured off shipped
// assets, but not declared anywhere) or OURS (an invention, with the reasoning
// beside it). `features/bf1942-3d-models/first-person-soldier.md` is the long
// form of every one of these.

// -- what the game declares --------------------------------------------------

/**
 * Eye height above the soldier's feet, per stance, in metres.
 *
 * `Objects/Soldiers/Common/CommonSoldierData.inc` declares the *offsets*:
 *
 *     ObjectTemplate.setPoseCameraPos c_BfSoldierStanding  0/0.65/0
 *     ObjectTemplate.setPoseCameraPos c_BfSoldierCrouching 0/0.12/0
 *     ObjectTemplate.setPoseCameraPos c_BfSoldierLying     0/-0.7/0
 *
 * relative to a soldier origin whose height above the feet nothing states. The
 * absolute comes from the line beside it —
 *
 *     objectTemplate.center1pHands -0.12/-1.56/0.1
 *
 * which places the first-person render rig relative to the camera. Those meshes
 * are skinned to the ordinary soldier skeleton, whose mesh origin is the feet,
 * so the camera is 1.56 m above them. Confirmed twice over: `UsSoldier.ske`'s
 * root bone rests at 0.9266 m and 0.9266 + 0.65 = 1.577, and the posed 1P
 * body's neck stump tops out at 1.566.
 */
export const EYE = { stand: 1.56, crouch: 1.03, prone: 0.21 };

/**
 * Figure height per stance, for head clearance. DERIVED: the posed helmet bone
 * `A` sits at 1.754 / 1.194 / 0.420 m (US soldier holding a No4, the game's own
 * `Lb_*` + `Ub_*` clips at frame 0).
 */
export const HEIGHT = { stand: 1.75, crouch: 1.20, prone: 0.45 };

/**
 * Movement speed, m/s. DERIVED, because nothing in vanilla declares one.
 *
 * Two measurements multiply. The footstep clock is declared outright in
 * `Objects/Soldiers/Common/Sounds/SoldierSound.inc` as seconds between steps —
 * `setRunFrequency 0.36`, `setWalkFrequency 0.66`, `setCrouchFrequency 0.50`,
 * `setCrawlFrequency 0.6`. The step length is measurable off the posed feet,
 * because the locomotion clips are strictly in-place (net root travel under
 * 2 cm on every one, so the engine translates the body and the clip only cycles
 * the legs): 0.821 / 0.711 / 0.790 / 0.414 m.
 *
 * Not `aiTemplatePlugIn.maxSpeed 5.0`. That is the AI's planning figure and the
 * Hanomag half-track declares the same 5.0.
 */
export const SPEED = { run: 2.28, walk: 1.08, crouch: 1.58, prone: 0.69 };

/**
 * Look clamp, degrees. `ObjectTemplate.setPointUpDownAngle 38.0 38.0`.
 *
 * The soldier carries this, not `SoldierCamera` — which declares no
 * `setInputToYaw/Pitch`, no `setMin/MaxRotation` and no `toggleMouseLook`, so
 * unlike a vehicle camera it is not a part that rotates. The body turns and the
 * camera rides it, which is why there is no free-look on foot in BF1942.
 */
export const PITCH_LIMIT_DEG = 38;

/**
 * `ObjectTemplate.setLiePointUpDownAngle 0.0 -6.0` — declared, and deliberately
 * NOT applied.
 *
 * Read literally against its standing twin it means "prone, you may look 0
 * degrees up and 6 degrees down", which is a view so narrow it is almost
 * certainly a modifier on the standing pair rather than a replacement for it.
 * Guessing which would be inventing a rule and calling it data, so prone uses
 * the same +-38 as standing and this constant sits here unread until somebody
 * settles it.
 */
export const LIE_POINT_UP_DOWN_DEG = [0.0, -6.0];

/**
 * Vertical FOV, degrees. `ObjectTemplate.set1pFov 0.47` — the only first-person
 * FOV in vanilla, identical in all 18 places any installed mod declares it.
 *
 * Its unit does not survive the data: read as a half-angle in radians it is
 * 2 x 0.47 rad = 53.9 degrees, read as the tangent of one it is
 * 2 x atan(0.47) = 50.4. Both land inside four degrees of each other, so the
 * ambiguity costs nothing; this takes the first.
 */
export const FOV_DEG = 53.86;

/**
 * Seconds between footsteps, per gait. `SoldierSound.inc`, verbatim. Drives the
 * view bob's phase (below) and, later, the footstep audio.
 */
export const STEP_PERIOD = { run: 0.36, walk: 0.66, crouch: 0.50, prone: 0.60 };

/**
 * View bob, from `animations/AnimationStatesLower.con`'s camera shakes:
 *
 *     rem Lb_WalkForward                      rem Lb_RunForward
 *     setCameraShakeUpDown    0 0.06 7         0 0.08 15
 *     setCameraShakeLeftRight 0 0.01 0.5       0 0.02 5
 *     setCameraShakeYaw       0 0.10 3.0       0 0.15 8.0
 *     setCameraShakeFadeIn    0 0.6            0 0.6
 *
 * **The amplitudes and the fade are the game's; the rate is not.** The third
 * argument's unit does not survive measurement: taken as Hz, 15 against a
 * 2.78 steps/s run cadence is five times too fast, and the walk/run ratio it
 * implies (7:15 = 2.14) does not match the step-rate ratio the same archive
 * declares (0.66:0.36 = 1.83) either. So the phase comes from the footstep
 * clock instead — vertical bob twice per stride, lateral sway once — which is
 * unambiguous, is in the same file, and puts the bob in step with the footstep
 * audio stage 3 will hang off the same clock.
 *
 * `yaw` is in degrees and applied to the view, not to the direction of travel.
 */
export const BOB = {
  run:    { up: 0.08, side: 0.02, yaw: 0.15, fadeIn: 0.6 },
  walk:   { up: 0.06, side: 0.01, yaw: 0.10, fadeIn: 0.6 },
  crouch: { up: 0.04, side: 0.01, yaw: 0.08, fadeIn: 0.6 },
  prone:  { up: 0.02, side: 0.01, yaw: 0.05, fadeIn: 0.6 },
};

// -- what we had to derive ---------------------------------------------------

/**
 * Movement capsule radius, m. DERIVED from the posed third-person body skin,
 * whose standing bounding box is 0.62 m across.
 *
 * The eight `setSkeletonCollisionBone` capsules in `CommonSoldierData.inc` are
 * NOT this: they are the bullet hitbox, with materials 40 (head), 41 (chest)
 * and 42 (limbs). And `GeometryTemplate.create SkeletonCollisionMesh
 * BodyCollision / file bodycollision_m1` names a mesh that ships in no archive
 * of any of the 18 installed mod directories, so there is no authored movement
 * hull to read.
 */
export const RADIUS = 0.31;

/**
 * Step-up height, m. DERIVED: the standing knee (`Bip01 L Calf`, posed) is at
 * 0.547 m and the ankle (`Bip01 L Foot`) at 0.121 m, so a soldier can raise a
 * foot 0.426 m without lifting his hip. Nothing in vanilla declares a step
 * height — `grep -iE "stepheight|slope|climb"` over every `.con` in
 * `Bf1942/Game.rfa` returns zero live lines.
 */
export const STEP_UP = 0.43;

/**
 * Slope limit, degrees. OURS — but not arbitrary.
 *
 * Nothing declares one, so it was chosen against the terrain the game actually
 * ships. Sampling each level's own `Heightmap.raw` on its 4 m lattice, the
 * fraction of cells at or under 45 degrees is Bocage 98.5%, Wake 98.7%,
 * El Alamein 98.5%, Berlin 100%, Omaha Beach 96.9%. So 45 admits essentially
 * all walkable ground on every vanilla map and rejects exactly the features you
 * cannot walk up in game either — Omaha's bluff faces being 3.1% of that map.
 */
export const MAX_SLOPE_DEG = 45;

/**
 * Jump take-off speed, m/s. DERIVED, and the softest number here.
 *
 * `Lb_StandJump` plays `3pJumpStandLower.baf` (13 frames) at 0.8x. The clip
 * carries no arc at all — 4.3 cm of total root travel — so the hop is engine
 * side and undeclared. Against the ~26 fps nominal rate the walk cycle implies
 * (24 frames at 0.7x against a 0.66 s step period), that clip runs 0.625 s,
 * and a ballistic hop of that airtime under 9.81 leaves the ground at 3.07 m/s
 * and peaks 0.48 m up. Rounded to 3.0.
 */
export const JUMP_SPEED = 3.0;

/** m/s^2. Not declared for a soldier either; `gunfire.js` already uses 9.81. */
export const GRAVITY = 9.81;

/**
 * How long the eye takes to travel between stances, seconds. Not invented —
 * the animation state machine declares a clip and a rate for every one of these
 * transitions, and `frames / (fps x speed)` is how long it plays:
 *
 *     Lb_StandToCrouch  3PStand2CrouchLower.baf  5 frames  4.0x   48 ms
 *     Lb_CrouchToStand  3PStand2CrouchLower.baf  5 frames -4.0x   48 ms
 *     Lb_StandToLie     3PStand2CrouchLower.baf  5 frames  4.0x   48 ms
 *     Lb_CrouchToLie    3PCrouch2LieLower.baf    9 frames  1.6x  216 ms
 *     Lb_LieToCrouch    3PCrouch2LieLower.baf    9 frames -2.0x  173 ms
 *     Lb_LieToStand     3PCrouch2LieLower.baf    9 frames -3.0x  115 ms
 *
 * (`animations/AnimationStatesCrouching.con` and `...Lie.con`.) The one soft
 * term is the nominal clip rate, which no header states; 26 fps is what the
 * walk cycle implies against its own declared step period, and it is the same
 * assumption `JUMP_SPEED` rests on. Getting dropping-prone right at 48 ms and
 * standing-up-from-prone right at 115 ms is most of why BF1942 feels the way it
 * does going down and coming up.
 */
export const STANCE_TRANSITION = {
  'stand>crouch': 0.048, 'crouch>stand': 0.048,
  'stand>prone': 0.048, 'prone>stand': 0.115,
  'crouch>prone': 0.216, 'prone>crouch': 0.173,
};

// -- tuning that is purely runtime ------------------------------------------

/** How far a foot may be above the floor before it is falling rather than standing. */
const GROUND_SNAP = 0.35;
/** Keep the capsule this far off a surface, so a sliding contact cannot re-hit it. */
const SKIN = 0.02;
/** Slide passes per frame. Three resolves a corner; more buys nothing. */
const SLIDE_PASSES = 3;
/** Terminal velocity, so a fall off the world cannot integrate to infinity. */
const MAX_FALL = 80;

const DEG = Math.PI / 180;
const PITCH_LIMIT = PITCH_LIMIT_DEG * DEG;
const MAX_SLOPE_COS = Math.cos(MAX_SLOPE_DEG * DEG);

export const STANCES = ['stand', 'crouch', 'prone'];

/**
 * Lateral offsets of the horizontal probe ring, as fractions of the radius.
 *
 * A true capsule sweep against a triangle soup is a great deal of arithmetic
 * for a body that moves 4 cm a frame. This approximates it with rays from the
 * capsule axis: three heights up the body (`probeHeights`), each at the axis
 * and at +-0.8 of the radius to either side, every one cast `distance + RADIUS`
 * so a hit at `t - RADIUS` is the surface just touching the capsule's skin.
 *
 * What it trades away, stated plainly: a post thinner than ~0.5 m that threads
 * exactly between two probes is missed, and so is an overhang between two
 * probe heights. Nine rays is ~18 us; a real sweep is not worth it until
 * something is visibly wrong.
 */
const PROBE_LATERAL = [0, 0.8, -0.8];

/**
 * Where up the body the horizontal probes sit, in metres above the feet.
 *
 * The lowest one has to clear `STEP_UP`, or the sweep blocks on every surface
 * the step-up and the ground snap were going to handle anyway — including open
 * hillsides. A probe 0.21 m up casting 0.35 m forward strikes any slope past
 * 31 degrees, which would have refused terrain the slope limit explicitly
 * allows. Kept inside the body for a crouched or prone figure, which is why it
 * is a function and not a constant.
 */
function probeHeights(height) {
  const low = Math.min(STEP_UP + 0.08, height * 0.45);
  return [low, height * 0.55, height * 0.92];
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * One soldier's position, stance and view, stepped against an injected collider.
 *
 * The page never writes anything but `input` and `look()`, and never reads
 * anything but the eye pose — the same seam `flight.js` keeps between
 * `VehicleState` and the presentation layer, for the same reason: a replay
 * should be able to write the state directly and the camera must not be able to
 * tell the difference.
 *
 * Yaw follows this page's own convention (`map.html`'s `lookVector`): forward is
 * `(sin yaw, 0, cos yaw)` in glTF space, so yaw 0 looks down +Z.
 */
export class Soldier {
  constructor({ collider = null, worldSize = 0 } = {}) {
    this.collider = collider;
    this.worldSize = worldSize;

    // Feet, in world metres.
    this.x = 0; this.y = 0; this.z = 0;
    this.yaw = 0; this.pitch = 0;

    this.stance = 'stand';
    this.velocityY = 0;
    this.grounded = true;
    // Eased so the eye travels between stances instead of cutting.
    this.eyeHeight = EYE.stand;
    this.height = HEIGHT.stand;
    this.stanceFrom = EYE.stand;
    this.stanceProgress = 1;
    this.stanceDuration = STANCE_TRANSITION['stand>crouch'];

    this.speed = 0;           // horizontal, m/s, as actually achieved
    this.gait = 'stand';      // run | walk | crouch | prone | stand
    this.bobPhase = 0;        // seconds of continuous movement, for the fade-in
    this.stepPhase = 0;       // 0..1 through the current footstep
    this.steps = 0;           // footsteps taken, for stage 3's audio
    this.blocked = false;     // a wall stopped the last horizontal move
    this.casts = 0;           // collider casts spent on the last step()
    // `WorldCollider` treats the sea as one horizontal plane and reports it as
    // a surface, so standing on it is what falls out. BF1942 swims instead
    // (eight `3PSwim*` clips, `setSwimFrequency 1`), which is not this stage —
    // this flag exists so the page can say so rather than quietly lie.
    this.onWater = false;

    // Bob output, applied by the page to the camera after the eye pose.
    this.bobUp = 0; this.bobSide = 0; this.bobYaw = 0;
  }

  /** Place the soldier's feet, facing `yaw`. Clears all motion. */
  spawn(x, y, z, yaw = 0) {
    this.x = x; this.y = y; this.z = z;
    this.yaw = yaw; this.pitch = 0;
    this.stance = 'stand';
    this.velocityY = 0;
    this.grounded = false;
    this.eyeHeight = EYE.stand;
    this.height = HEIGHT.stand;
    this.stanceFrom = EYE.stand;
    this.stanceProgress = 1;
    this.speed = 0;
    this.bobPhase = 0; this.stepPhase = 0; this.steps = 0;
    this.bobUp = 0; this.bobSide = 0; this.bobYaw = 0;
    this.settle();
    return this;
  }

  /**
   * Drop to the floor immediately, the way the engine does on spawn.
   *
   * The probe starts just above the feet, not above the head: a spawn under a
   * bunker roof or a bridge deck must land on the floor it was authored on, and
   * a probe that begins above the ceiling finds the ceiling's top instead. It
   * reaches a long way down because a spawn authored slightly off its surface,
   * or one the level puts in the air, still has to arrive on the ground.
   */
  settle() {
    const floor = this.floorAt(this.x, this.z, this.y + 0.5, 600);
    if (floor) {
      this.y = floor.y;
      this.grounded = true;
      this.velocityY = 0;
    }
    return this;
  }

  /** Mouse delta, in the page's radians. Yaw is free, pitch is clamped. */
  look(dYaw, dPitch) {
    this.yaw += dYaw;
    this.pitch = clamp(this.pitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT);
  }

  get eyeY() { return this.y + this.eyeHeight; }

  /**
   * The floor under (x, z): the highest surface at or below `fromY`, within
   * `distance`. Returns `{ y, ny, kind }` or null, where `ny` is the surface
   * normal's vertical component — the slope test.
   *
   * Deliberately **not** one `WorldCollider.cast`. The collider's terrain
   * component marches the height lattice and then bisects eight times, so its
   * precision is `maxDist / 256` — fine for a 16 m round's flight, and 2.3 m of
   * error on the 600 m probe a spawn drop wants. That error put a spawned
   * soldier a fifth of a metre under his own feet and silently ate the first
   * jump, which is what the node harness caught.
   *
   * So the two halves are asked separately and the higher wins: hulls through
   * the grid (exact, Moller-Trumbore), ground and sea through
   * `surfaceHeight` (exact, bilinear off the same lattice) with no ray at all.
   */
  floorAt(x, z, fromY, distance = 4.0) {
    const collider = this.collider;
    if (!collider) return null;
    let best = null;
    if (collider.statics) {
      this.casts++;
      const record = this._hit || (this._hit = {
        t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0,
        dx: 0, dy: -1, dz: 0, material: 0, kind: '', owner: -1, triangle: -1,
      });
      record.dx = 0; record.dy = -1; record.dz = 0;
      const hit = collider.statics.cast(x, fromY, z, 0, -1, 0, distance, -1, record);
      if (hit) best = { y: hit.y, ny: hit.ny, kind: 'object' };
    }
    const ground = collider.surfaceHeight ? collider.surfaceHeight(x, z) : NaN;
    if (Number.isFinite(ground) && ground <= fromY && ground >= fromY - distance
        && (!best || ground > best.y)) {
      const sea = collider.waterLevel != null && ground <= collider.waterLevel + 1e-6;
      best = { y: ground, ny: sea ? 1 : this.groundNormalY(x, z), kind: sea ? 'water' : 'terrain' };
    }
    return best;
  }

  /** The vertical component of the terrain normal at (x, z); 1 with no lattice. */
  groundNormalY(x, z) {
    const field = this.collider?.heightfield;
    if (!field || !field.normal) return 1;
    const out = this._normal || (this._normal = [0, 1, 0]);
    field.normal(x, z, out);
    return Number.isFinite(out[1]) ? out[1] : 1;
  }

  /**
   * How far the capsule may travel along (dx, dz) before something stops it.
   *
   * Returns `{ distance, nx, nz }` — the free run in metres and the horizontal
   * normal of whatever ended it, which is what the slide is projected onto.
   * `baseY` lets the caller re-ask with the body lifted by `STEP_UP`, which is
   * the whole of step-up.
   */
  sweep(dx, dz, distance, baseY = this.y) {
    if (!this.collider) return { distance, nx: 0, nz: 0, hit: false };
    const sideX = dz, sideZ = -dx;      // the movement direction, turned 90deg
    let best = distance;
    let nx = 0, nz = 0, hit = false;
    const reach = distance + RADIUS;
    const heights = probeHeights(this.height);
    for (const height of heights) for (const lateral of PROBE_LATERAL) {
      const oy = baseY + height;
      const ox = this.x + sideX * lateral * RADIUS;
      const oz = this.z + sideZ * lateral * RADIUS;
      this.casts++;
      const probe = this.collider.cast(ox, oy, oz, dx, 0, dz, reach);
      if (!probe) continue;
      // How much travel to give up so the *body centre* ends one radius from
      // the surface's plane, rather than the probe ending one radius from it.
      //
      // Subtracting a flat RADIUS is only right when the surface faces straight
      // back down the direction of travel. Walk into a wall at 45 degrees and
      // it is wrong twice over — the leading probe starts 17 cm nearer the
      // wall, and a radius measured along the diagonal is only 22 cm of plane
      // clearance — which together stopped the capsule 0.39 m out instead of
      // 0.31. Both terms are exactly recoverable: `along` converts distance
      // along the plane normal into distance along the direction of travel, and
      // `offsetIntoPlane` is how much of the probe's lateral offset was already
      // spent closing on the plane.
      const along = Math.abs(dx * probe.nx + dz * probe.nz);
      // A surface whose normal is perpendicular to the travel cannot stop it;
      // the slide handles grazing contact.
      if (along < 1e-3) continue;
      const offsetX = sideX * lateral * RADIUS, offsetZ = sideZ * lateral * RADIUS;
      const offsetIntoPlane = offsetX * probe.nx + offsetZ * probe.nz;
      const free = probe.t - (RADIUS + offsetIntoPlane) / along;
      if (free < best) {
        best = free;
        nx = probe.nx; nz = probe.nz;
        hit = true;
      }
    }
    // The skin gap belongs to a *contact*, not to every step. Taking it off an
    // unobstructed move scales the whole gait down by SKIN/(speed*dt) — which
    // at 60 Hz is 53% of a run and the entirety of a walk, and is exactly the
    // bug the node harness caught on its first run.
    return { distance: hit ? Math.max(0, best - SKIN) : distance, nx, nz, hit };
  }

  /**
   * One frame.
   *
   * `input` is the raw control state, named for the `c_PI*` actions BF1942's own
   * `Settings/Default/Controls/Infantry.con` binds:
   *
   *   forward  c_PIThrottle   W / S
   *   strafe   c_PIYaw        D / A   (strafe, not turn - the mouse turns you)
   *   walk     c_PIWalk       LeftShift, and it is the SLOWER gait
   *   crouch   c_PICrouch     LeftCtrl, held
   *   prone    c_PILie        Z, a toggle
   *   jump     c_PIAction     Space
   */
  step(dt, input = {}) {
    this.casts = 0;
    if (!(dt > 0)) return this;
    dt = Math.min(dt, 0.1);

    this.applyStance(dt, input);

    const forward = clamp(input.forward || 0, -1, 1);
    const strafe = clamp(input.strafe || 0, -1, 1);
    const gait = this.gaitFor(input, forward, strafe);
    this.gait = gait;
    const speed = SPEED[gait] ?? 0;

    // Forward is (sin yaw, 0, cos yaw); right is that turned 90 degrees.
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wishX = sy * forward + cy * strafe;
    let wishZ = cy * forward - sy * strafe;
    const wishLength = Math.hypot(wishX, wishZ);
    if (wishLength > 1e-6) { wishX /= wishLength; wishZ /= wishLength; }

    const demand = wishLength > 1e-6 ? speed * dt : 0;
    const travelled = demand > 0 ? this.moveHorizontal(wishX, wishZ, demand) : 0;
    this.speed = dt > 0 ? travelled / dt : 0;

    this.moveVertical(dt, input, travelled > 1e-5);
    this.advanceBob(dt, travelled);
    return this;
  }

  /** Crouch is held, prone is a toggle, and the eye eases between them. */
  applyStance(dt, input) {
    const wantProne = !!input.prone;
    const wantCrouch = !!input.crouch;
    let want = wantProne ? 'prone' : (wantCrouch ? 'crouch' : 'stand');
    // Standing up into a ceiling is not allowed; stay down instead.
    if (want !== this.stance && HEIGHT[want] > HEIGHT[this.stance]
        && !this.headroom(HEIGHT[want])) {
      want = this.stance;
    }
    if (want !== this.stance) {
      // Travel from where the eye actually is, not from the stance's nominal
      // height: reversing a transition halfway must not jump.
      this.stanceFrom = this.eyeHeight;
      this.stanceProgress = 0;
      this.stanceDuration = STANCE_TRANSITION[`${this.stance}>${want}`] || 0.05;
      this.stance = want;
    }
    // The collision height snaps even though the eye eases, so a crouch under a
    // beam takes effect on the frame you asked for it rather than 200 ms later.
    this.height = HEIGHT[want];
    const target = EYE[want];
    if (this.stanceProgress >= 1) {
      this.eyeHeight = target;
      return;
    }
    this.stanceProgress = Math.min(1, this.stanceProgress + dt / this.stanceDuration);
    this.eyeHeight = this.stanceFrom + (target - this.stanceFrom) * this.stanceProgress;
  }

  /** Is there room to be `height` tall here? */
  headroom(height) {
    if (!this.collider) return true;
    this.casts++;
    const hit = this.collider.cast(this.x, this.y + 0.1, this.z, 0, 1, 0, height);
    return !hit;
  }

  gaitFor(input, forward, strafe) {
    if (!forward && !strafe) return 'stand';
    if (this.stance === 'prone') return 'prone';
    if (this.stance === 'crouch') return 'crouch';
    return input.walk ? 'walk' : 'run';
  }

  /**
   * Move along (dx, dz) by `demand` metres, sliding along whatever stops it.
   * Returns the distance actually covered.
   */
  moveHorizontal(dx, dz, demand) {
    this.blocked = false;
    const startX = this.x, startZ = this.z;
    let remainX = dx * demand, remainZ = dz * demand;

    for (let pass = 0; pass < SLIDE_PASSES; pass++) {
      const length = Math.hypot(remainX, remainZ);
      if (length < 1e-5) break;
      const ux = remainX / length, uz = remainZ / length;

      const run = this.sweep(ux, uz, length);
      this.x += ux * run.distance;
      this.z += uz * run.distance;

      if (!run.hit || run.distance >= length - 1e-4) break;
      this.blocked = true;
      // Slide: drop the component of what is left that points into the surface.
      const leftover = length - run.distance;
      let slideX = ux * leftover, slideZ = uz * leftover;
      const into = slideX * run.nx + slideZ * run.nz;
      slideX -= run.nx * into;
      slideZ -= run.nz * into;
      remainX = slideX; remainZ = slideZ;
    }

    this.refuseUnsteppable(startX, startZ);
    return Math.hypot(this.x - startX, this.z - startZ);
  }

  /**
   * How high a foot can be raised, this stance. See `STEP_UP`; prone gets a
   * token 12 cm because crawling over a knee-high kerb is not a thing, and no
   * data speaks to it either way. OURS.
   */
  stepUp() { return this.stance === 'prone' ? 0.12 : STEP_UP; }

  /**
   * Undo a horizontal move onto ground too high or too steep to have walked on.
   *
   * This, not the sweep, is what makes a kerb a kerb. The sweep's lowest probe
   * deliberately sits *above* the step-up height so that slopes and kerbs never
   * register as walls, which leaves it blind to exactly the two cases that
   * matter here — so they are settled afterwards, against the floor where you
   * actually landed, with one probe from head height that can see the top of an
   * obstruction up to a body tall.
   *
   * Walking downhill, or off the end of the world, is never refused: you are
   * allowed to fall off anything.
   */
  refuseUnsteppable(fromX, fromZ) {
    if (!this.grounded || (this.x === fromX && this.z === fromZ)) return;
    const floor = this.floorAt(this.x, this.z, this.y + this.height,
                               this.height + GROUND_SNAP);
    if (!floor) return;                       // walked off a ledge; allowed
    const rise = floor.y - this.y;
    if (rise <= 1e-4) return;                 // level or downhill
    if (rise > this.stepUp() || floor.ny < MAX_SLOPE_COS) {
      this.x = fromX; this.z = fromZ;
      this.blocked = true;
    }
  }

  /** Gravity, the jump, the floor, and the ceiling. */
  moveVertical(dt, input, movedHorizontally) {
    if (this.grounded && input.jump && this.stance === 'stand') {
      this.velocityY = JUMP_SPEED;
      this.grounded = false;
    }

    const wasAt = this.y;
    if (!this.grounded) {
      this.velocityY = Math.max(-MAX_FALL, this.velocityY - GRAVITY * dt);
      const rise = this.velocityY * dt;
      if (rise > 0 && !this.headroom(this.height + rise)) {
        this.velocityY = 0;                   // clipped the ceiling
      } else {
        this.y += rise;
      }
    }

    // Where is the floor now? Probe from a step's height above the feet while
    // standing, so a kerb crossed this frame is found; from barely above them
    // while airborne, so a fall is not teleported onto a ledge it is passing.
    //
    // The probe starts from wherever the feet were *higher* this frame, which is
    // what makes it swept: at terminal speed a frame covers 1.3 m, and a probe
    // that began where gravity had already put you would pass straight through
    // the ground and never find it again.
    const probeUp = this.grounded ? this.stepUp() : 0.02;
    const from = Math.max(this.y, wasAt) + probeUp;
    const floor = this.floorAt(this.x, this.z, from,
                               from - (this.y - GROUND_SNAP));
    if (!floor) {
      if (this.velocityY <= 0) this.grounded = false;
      this.onWater = false;
      return;
    }
    const rise = floor.y - this.y;
    if (rise > 1e-4) {
      // Being raised has to be *caused* by something. A step you walked onto,
      // or a surface you came down on — never simply standing still, or a body
      // parked inside stacked geometry ratchets a step's height upward every
      // frame until it is on the roof.
      const stepping = this.grounded && movedHorizontally && rise <= this.stepUp();
      const landing = !this.grounded || this.velocityY < 0;
      if (stepping || landing) {
        this.y = floor.y;
        this.velocityY = 0;
        this.grounded = true;
      }
    } else if (this.grounded && this.velocityY <= 0 && -rise <= GROUND_SNAP) {
      this.y = floor.y;                       // walked down a kerb, stayed glued
      this.velocityY = 0;
    } else if (this.velocityY <= 0) {
      this.grounded = false;                  // walked off a ledge
    }
    this.onWater = this.grounded && floor.kind === 'water';
  }

  /**
   * View bob. Amplitudes are the game's `setCameraShake*`; the phase runs off
   * the footstep clock (see `BOB`).
   */
  advanceBob(dt, travelled) {
    const moving = travelled > 1e-5 && this.grounded;
    const shake = BOB[this.gait] || BOB.walk;
    if (!moving) {
      this.bobPhase = Math.max(0, this.bobPhase - dt / shake.fadeIn);
    } else {
      this.bobPhase = Math.min(1, this.bobPhase + dt / shake.fadeIn);
      const period = STEP_PERIOD[this.gait] || STEP_PERIOD.walk;
      // A stride is two steps; how far through the current one we are drives
      // both the bob and, later, when a boot lands.
      const before = this.stepPhase;
      this.stepPhase = (this.stepPhase + dt / period) % 1;
      if (this.stepPhase < before) this.steps++;
    }
    const amount = this.bobPhase;
    if (amount <= 0) {
      this.bobUp = 0; this.bobSide = 0; this.bobYaw = 0;
      return;
    }
    // The head rises and falls twice per stride and sways once, which is what
    // a stride is; the yaw rides the sway.
    const stride = this.stepPhase * Math.PI * 2;
    this.bobUp = Math.sin(stride * 2) * shake.up * amount;
    this.bobSide = Math.sin(stride) * shake.side * amount;
    this.bobYaw = Math.sin(stride) * shake.yaw * amount;
  }
}

// -- picking a spawn ---------------------------------------------------------

/**
 * The level's flags, each with the soldier spawns it owns.
 *
 * The join is the one the engine makes: a `SpawnPoint` declares `setGroup <n>`
 * and a `ControlPoint` declares `spawnGroupId <n>`, and the flag's team owns
 * every spawn in its group. Both halves are already in `scene.json` —
 * `controlPoints[].spawnGroupId` and `soldierSpawns[].group` — because
 * `extract_map.py` has emitted them since `spawn-points.md`.
 *
 * `team` 0 is a flag that starts neutral, and a group no control point claims
 * (a carrier's, from `GlobalSpawnGroups.con`) simply has no flag and is left
 * out rather than guessed at.
 */
export function spawnFlags(extras) {
  const points = extras?.controlPoints || [];
  const spawns = extras?.soldierSpawns || [];
  const byGroup = new Map();
  for (const spawn of spawns) {
    if (spawn?.group == null) continue;
    if (!byGroup.has(spawn.group)) byGroup.set(spawn.group, []);
    byGroup.get(spawn.group).push(spawn);
  }
  const flags = [];
  for (const point of points) {
    const group = point?.spawnGroupId;
    const owned = group == null ? null : byGroup.get(group);
    if (!owned || !owned.length) continue;
    flags.push({
      name: point.displayName || point.name || `flag ${group}`,
      team: point.team ?? null,
      group,
      position: point.position || null,
      uncapturable: !!point.unableToChangeTeam,
      spawns: owned,
    });
  }
  return flags;
}

/**
 * Which spawn of a flag's set to use, skipping the ones that would drop you out
 * of an aeroplane.
 *
 * `setSpawnAsParaTroper` is declared 489 times across vanilla's levels and is
 * **live 43 times**, in Market Garden (36), Liberation of Caen (6) and Coral Sea
 * (1) — the rest are explicit zeroes. Newly extracted levels carry the flag as
 * `soldierSpawns[].paratrooper`; every level extracted before that does not, so
 * a spawn sitting more than `airborne` metres above the ground under it is
 * treated as one too. That keeps already-shipped maps correct without a
 * re-extract.
 */
export function pickSpawn(flag, index = 0, { groundAt = null, airborne = 12 } = {}) {
  const spawns = flag?.spawns || [];
  const usable = spawns.filter(spawn => {
    if (spawn.paratrooper) return false;
    if (!groundAt || !spawn.position) return true;
    const ground = groundAt(spawn.position[0], spawn.position[2]);
    return !Number.isFinite(ground) || spawn.position[1] - ground < airborne;
  });
  const pool = usable.length ? usable : spawns;
  if (!pool.length) return null;
  return pool[((index % pool.length) + pool.length) % pool.length];
}

/**
 * The page's look yaw that faces the way a spawn point was authored to face.
 *
 * `Object.rotation <yaw>/<pitch>/<roll>` is degrees in Refractor's frame, where
 * +Z is forward (measured in `camera-modes.md` §4 off the Corsair's own
 * propeller and rudder placements). The exporter mirrors Z, so a node's glTF
 * rotation is Ry(-yaw) and its forward becomes (sin yaw, 0, -cos yaw). This
 * page's own `lookVector` is (sin yaw, 0, cos yaw), so the two agree at
 * `PI - yaw`.
 */
export function spawnYaw(spawn) {
  const degrees = spawn?.rotation?.[0] || 0;
  return Math.PI - degrees * DEG;
}
