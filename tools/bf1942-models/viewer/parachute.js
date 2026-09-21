// Bailing out: free fall, the scream, the chute, the glide and the landing.
//
// Everything here is read out of `bf1942_lnxded.static` (the Linux dedicated
// server, not stripped) and out of the shipped `.con` data. Addresses are that
// binary's. The full write-up, with the commands that reproduce each one, is
// `features/viewer-parachute/README.md`.
//
// The four states the engine keeps, and what carries each:
//
//   free fall   `Lb_ParachuteFall` / `Ub_ParachuteFall`, entered from
//               `BFSoldier::handlePlayerInput` (`0x08275eaa`-`0x08275f5d`)
//   chute open  soldier state bit `0x10` at `BFSoldier+0x3e6`, set by
//               `BFSoldier::setIsParachuting(bool)` (`0x08276f90`)
//   glide       `Lb_ParachuteIdle`, which `Lb_ParachuteOpen`'s own
//               `addTransitionWhenDone` reaches
//   landing     `Lb_ParachuteHitGround`, which transitions to `Lb_Stand`
//
// This module is the state machine and the two forces. It imports nothing, so
// `tests/parachute_harness.mjs` can run it under node.

/**
 * Enter free fall when the soldier is falling faster than this. **Verified.**
 *
 * `BFSoldier::handlePlayerInput`, `0x08275eaa`:
 *
 *     fld    DWORD PTR [esi+0x4]        ; getPositionalSpeed().y
 *     fld    DWORD PTR ds:0x86d2714     ; -8.0
 *     fucompp / test ah,0x45 / jne      ; continue only while  vy < -8.0
 *
 * `./lnxded/vt.py --float 0x86d2714` prints -8.0.
 */
export const FALL_STATE_SPEED = -8.0;

/**
 * ...and only this far above the terrain. **Verified.**
 *
 * Same function, `0x08275f13`: the soldier's `getAbsolutePosition().y` minus
 * `terrainBase->getHeight(x, z)` (the global at `0x087435f0`, vtable `+0x54`)
 * is compared against the 10.0 at `0x086b9314` and the state is entered only
 * when the height is the greater. It is the **terrain** height, not a
 * raycast — standing 11 m up a building with terrain under you satisfies it.
 */
export const FALL_STATE_HEIGHT = 10.0;

/**
 * The chute closes at this vertical speed. **Verified, and it is `abs`.**
 *
 * `BFSoldier::handleUpdate` tests `|getPositionalSpeed().y| <= 2.0` in both of
 * its parachuting arms (`0x08272f3b` and `0x08273129`) and calls
 * `setIsParachuting(false)`. Under the chute the descent never falls to 2 m/s
 * in the air, so in practice this fires on the tick the ground stops you.
 */
export const CHUTE_CLOSE_SPEED = 2.0;

/**
 * `ObjectTemplate.setParachuteDrag 24.00`, `CommonSoldierData.inc`.
 *
 * Written to `BFSoldierTemplate+0x2e4` by `ConsoleClass181::executeObjectMethod`
 * (`0x082bc110`), and `setIsParachuting(true)` hands exactly that field to
 * `PointPhysicsNode::setDrag` (vtable `+0x94`, `0x08256920`) at `0x08277016`.
 * `setIsParachuting(false)` restores `BFSoldierTemplate+0x44`, which is the
 * soldier's own `ObjectTemplate.drag 1.0`.
 *
 * Surveyed across all 18 installed mods: 24.00 in vanilla, DC, DC_Final, EoD,
 * FH, FHSW, Pirates, WarFront, bfheroes, bg42 and interstate; 20.00 in
 * FinnWars; 5000.00 in Galactic Conquest; 0.00 in bf1918.
 */
export const PARACHUTE_DRAG = 24;

/**
 * `ObjectTemplate.setParachuteSpeed 30.00` — and it is an **acceleration**.
 *
 * This is the correction that matters. The name says speed and the number
 * coincides with a terminal velocity you can produce from the drag equation,
 * which is how it came to be recorded as one. It is not. The field is
 * `BFSoldierTemplate+0x2e8` (written by `ConsoleClass182::executeObjectMethod`,
 * `0x082bc3e0`) and it is read in exactly two places, both in
 * `BFSoldier::handleUpdate`, and both do the same thing with it:
 *
 *     fld    DWORD PTR [ebx+0x2e8]      ; parachuteSpeed
 *     ...    multiply rows +0x20/+0x24/+0x28 of a Mat4 by it
 *     call   [vt+0x6c]                  ; addAccelerationAtRelativePosition
 *
 * `PointPhysicsNode::addAccelerationAtRelativePosition` (`0x08256650`) ignores
 * its position argument entirely and adds the vector into the acceleration
 * accumulator at `+0x1c`, which `updatePositionalPhysics` (`0x082560c0`)
 * spends over the tick and then zeroes. So it is 30 m/s^2 along a forward
 * axis, every tick, beside gravity.
 *
 * Which forward axis is the difference between the two sites:
 *
 * | state | site | axis | clamp |
 * |---|---|---|---|
 * | free fall | `0x082726fd` | the **camera**'s `getAbsoluteTransformation()` row 2 (`*(soldier+0x3f0)` -> `+8` -> `queryInterface(0xc378)`) | `a.y` forced to <= 0 |
 * | under the chute | `0x082727e3` | the **soldier**'s own `getAbsoluteTransformation()` row 2 | none |
 *
 * So free fall steers on where you look and can never push you upward, and the
 * chute drives along the body's facing, which is upright and therefore
 * horizontal. One consequence is radius-independent and worth stating on its
 * own: under the chute the terminal glide ratio is
 * `parachuteSpeed : |g| = 30 : 14.73 = 2.037 : 1`, whatever the drag works out
 * to, because both terms divide by the same drag coefficient.
 */
export const PARACHUTE_SPEED = 30;

/**
 * The drag radius the parachute is flown at. **UNVERIFIED — a viewer number.**
 *
 * `PointPhysicsNode::updatePhysics` (`0x082562c0`) takes `r` from its own
 * vtable `+0x1c`, which forwards to the composite object's
 * `getBoundingRadius()` (`BCompositeObject`, `0x08165630`). That is
 * `max(geometry radius, max over children of |childPos| + childRadius)` — no
 * `.con` word sets it and it is not in the shipped data. Two ends of it are
 * known and neither is usable as-is:
 *
 *   - The soldier's own geometry is the `SkeletonCollisionMesh` `BodyCollision`,
 *     whose radius is `max |v|` over a **17-vertex hull the template's
 *     constructor hard-codes** (`0x083af34a`-`0x083af660`, `computeBoundingValues`
 *     `0x083afb80` called at `0x083af64a`). Emulating that constructor gives the
 *     hull exactly: an apex at (0,-1,0), a ring of four at y=-0.6 r=0.283, eight
 *     at y=0 r=0.447 and four at y=0.8 r=0.4 — so **the geometry radius is
 *     exactly 1.0**, in every mod, because nothing authored reaches it.
 *   - But the composite walk adds the children, and `CommonSoldierData.inc`
 *     hangs `ObjectTemplate.addTemplate Parachute` on the soldier at 0/0.3/0
 *     whose mesh (`standardMesh/Parachute_m1.sm`) has `max |v| = 13.493`. Taken
 *     literally that is r = 13.79, at which a soldier's terminal fall is
 *     2.5 m/s and HP-14 fall damage could never happen at all.
 *
 * So the engine's own number is somewhere between and this corpus cannot say
 * where. Two shipped behaviours bound it:
 *
 *   - a chute landing is survivable — `Lb_ParachuteHitGround`
 *     `addTransitionWhenDone Lb_Stand`, and the dead case has its own separate
 *     `Lb_ParachuteDeadHitGround` — so the terminal descent `|g| / k` must sit
 *     under HP-14's 8.0 m/s damage floor, i.e. `r > 1.563`;
 *   - HP-14 fall damage exists, so a 7.5 m drop must still arrive near
 *     15 m/s, i.e. the free-fall terminal must stay far above it: `r < 2.8`.
 *
 * 1.8 is taken from that window. At it the chute settles to 6.03 m/s down and
 * 12.28 m/s forward, lands with 2 m/s of margin under the damage floor, and
 * leaves the soldier's own drag inert (terminal 145 m/s). Treat it as a
 * tunable, not as the engine's.
 */
export const PARACHUTE_DRAG_RADIUS = 1.8;

/**
 * The drag to hand a body whose bounding radius is not the engine's.
 *
 * Only the product `r^2 * drag` reaches `updatePositionalDragSimple`
 * (`0x08255fc0`: `accel -= (scale*v - wind) * pi * r * r * drag / mass`), so a
 * viewer carrying a different radius reproduces the engine's coefficient by
 * scaling the drag instead. `physics.js` keeps `SOLDIER_BOUNDING_RADIUS = 0.8`
 * for the soldier's own inert drag and every fall-damage number measured
 * against it; this leaves those untouched.
 */
export function effectiveParachuteDrag(bodyRadius) {
  if (!(bodyRadius > 0)) return PARACHUTE_DRAG;
  const scale = PARACHUTE_DRAG_RADIUS / bodyRadius;
  return PARACHUTE_DRAG * scale * scale;
}

/**
 * `3PParachuteOpenLower.baf` is **41 frames** and `Lb_ParachuteOpen` plays it
 * at the `addAnimation` rate **0.5**, over the same nominal 26 fps
 * `physics.js`'s `DIVE_DURATION` is derived against — 3.154 s of opening clip
 * before `addTransitionWhenDone` hands the lower body to `Lb_ParachuteIdle`.
 * The frame count is read (`bf42.baf.parse`); the 26 fps is the same soft term
 * `DIVE_DURATION` carries, because no `.baf` header states a rate.
 */
export const OPEN_CLIP_SECONDS = 41 / (26 * 0.5);

/**
 * `3PParachuteGroundLower.baf` is **6 frames** at rate 1.0 — 0.231 s — before
 * `Lb_ParachuteHitGround`'s `addTransitionWhenDone Lb_Stand`. Same soft term.
 */
export const LANDED_CLIP_SECONDS = 6 / 26;

/** Not falling, or on the ground. */
export const PARA_NONE = 'none';
/** `Lb_ParachuteFall`: the scream, and look-steering. */
export const PARA_FALLING = 'falling';
/** `Lb_ParachuteOpen` playing, then `Lb_ParachuteIdle`: the glide. */
export const PARA_OPEN = 'open';
/** `Lb_ParachuteHitGround` playing out before `Lb_Stand`. */
export const PARA_LANDED = 'landed';

/**
 * The lower/upper animation pair each state names, exactly as
 * `animations/AnimationStatesParachute.con` creates them.
 *
 * Kept as data so a renderer can ask for the clip by the engine's own name
 * rather than by a viewer word. `open` plays once and `addTransitionWhenDone`
 * hands the lower body to `Lb_ParachuteIdle` and the **upper body back to
 * `Ub_StandAim`** — which is precisely why a man under a chute can aim and
 * fire: the engine puts his upper body back in the ordinary aiming state as
 * soon as the opening clip is done, and `Lb_ParachuteIdle` declares no
 * `c_AsmLockFreeLook` (only `Lb_ParachuteOpen` does).
 */
export const PARA_CLIPS = Object.freeze({
  [PARA_FALLING]: Object.freeze({ lower: 'Lb_ParachuteFall', upper: 'Ub_ParachuteFall' }),
  open: Object.freeze({ lower: 'Lb_ParachuteOpen', upper: 'Ub_ParachuteOpen' }),
  glide: Object.freeze({ lower: 'Lb_ParachuteIdle', upper: 'Ub_StandAim' }),
  [PARA_LANDED]: Object.freeze({ lower: 'Lb_ParachuteHitGround', upper: 'Ub_ParachuteHitGround' }),
  dead: Object.freeze({ lower: 'Lb_ParachuteDie', upper: 'Ub_ParachuteDie' }),
  deadLanded: Object.freeze({ lower: 'Lb_ParachuteDeadHitGround', upper: 'Ub_ParachuteDeadHitGround' }),
});

/**
 * `Objects/Soldiers/Common/Sounds/SoldierFallingHigh.ssc`, layer by layer.
 *
 * `c_SstFallingHigh` is the sound trigger both halves of the free-fall state
 * declare, so the whole script starts the moment the state is entered. Each
 * layer carries a `Volume <- Time` `Ramp p1 p2 0 1` and a `trigger Volume`,
 * which means the layer is silent until `Time` reaches `p1` and then plays —
 * so `at` below is the script's own p1, not a number anyone chose.
 *
 * Two patches: the first is the ambience the world hears, the second
 * (`newPatch` ... `randomPlay 1`) is the human voice, one of three picked at
 * random and localised under `@Language`.
 *
 * `soprupp.wav` is the easter egg. It is in the ambience patch, not with the
 * `@Language` screams, it is 0.853 s long, and its gate is 11.5 s of
 * continuous falling — roughly 830 m under this engine's gravity, which is
 * further than any vanilla level can drop you without a plane. **What the
 * sample actually contains was not listened to**, so "it is a fart" stays the
 * owner's account and is marked UNVERIFIED here; what is verified is the file,
 * the patch it sits in and the 11.5.
 */
export const FALL_SOUND_LAYERS = Object.freeze([
  Object.freeze({ id: 'rcktlp1', sample: 'rcktlp1', at: 0, loop: true, volume: 0.2 }),
  Object.freeze({ id: 'luft2', sample: 'luft2', at: 0, loop: true, volume: 1 }),
  Object.freeze({ id: 'fhs1', sample: 'fhs1', at: 1.2, loop: false, volume: 1 }),
  Object.freeze({ id: 'fhs2', sample: 'fhs2', at: 2.3, loop: false, volume: 1 }),
  Object.freeze({
    id: 'scream', at: 3.3, loop: false, volume: 0.7, voice: true,
    choices: Object.freeze(['fallparachute', 'fallparachute2', 'fallparachute3']),
  }),
  Object.freeze({ id: 'soprupp', sample: 'soprupp', at: 11.5, loop: false, volume: 1 }),
]);

/**
 * `SoldierOpenParachute.ssc`: `randomPlay 1` over three samples, each with its
 * own `Volume <- Time` gate — so the canopy's crack lands a third of a second
 * after you pull, not on the frame you pull.
 *
 * `extract_soldier_sounds.py` reads these from the script; the list here is
 * the fallback for a tree published before that ran, and
 * `tests/test_soldier_sounds.py` is what keeps the two honest.
 */
export const CHUTE_OPEN_LAYERS = Object.freeze([
  Object.freeze({ sample: 'para1', at: 0.4, volume: 1 }),
  Object.freeze({ sample: 'para2', at: 0.4, volume: 1 }),
  Object.freeze({ sample: 'para3', at: 0.3, volume: 1 }),
]);

/** Just the names, for a caller that only wants to know what to load. */
export const CHUTE_OPEN_SAMPLES = Object.freeze(
  CHUTE_OPEN_LAYERS.map((l) => l.sample));

/**
 * `c_SstParachuteLand` has **no script in vanilla**. `SoldierSound.inc` does
 * say `ObjectTemplate.loadSoundScript SoldierParachuteLand.ssc`, and both
 * `Lb_ParachuteHitGround` and `Lb_ParachuteDeadHitGround` declare the trigger,
 * but there is no such file anywhere in `Objects.rfa` — the sibling
 * `SoldierFallingHigh.ssc` and `SoldierOpenParachute.ssc` are both right
 * beside it. So a chute landing is silent in retail, and the `land` event
 * below is emitted for the animation state, not for a sample to play.
 */
export const CHUTE_LAND_HAS_NO_SCRIPT = true;

/**
 * One soldier's parachute, driven once per engine tick.
 *
 * Deliberately not a physics body: it reads the body's velocity and height and
 * answers with the drag to fly at and the acceleration to add, and the caller
 * pushes both into its own integrator. That keeps it testable under node and
 * keeps `physics.js` the only place an integrator lives.
 */
export class Parachute {
  constructor({ random = Math.random } = {}) {
    this.random = random;
    this.reset();
  }

  reset() {
    this.state = PARA_NONE;
    /** Seconds since the free-fall state was entered — the `.ssc` `Time`. */
    this.fallTime = 0;
    /** Seconds since the chute opened, for the one-shot opening clip. */
    this.openTime = 0;
    /** Drag to fly at this tick, or `null` for "leave the body alone". */
    this.drag = null;
    this.accel = { x: 0, y: 0, z: 0 };
    /** Events produced by the last `update`; the caller drains them. */
    this.events = [];
    this._fired = new Set();
    this._landedFor = 0;
    this._deployHeld = false;
    return this;
  }

  /** True while the chute is carrying the soldier (engine state bit 0x10). */
  get open() { return this.state === PARA_OPEN; }

  /** The lower/upper clip pair for the current state, or `null`. */
  clips(dead = false) {
    if (this.state === PARA_FALLING) return PARA_CLIPS[PARA_FALLING];
    if (this.state === PARA_OPEN) {
      if (dead) return PARA_CLIPS.dead;
      return this.openTime < OPEN_CLIP_SECONDS ? PARA_CLIPS.open : PARA_CLIPS.glide;
    }
    if (this.state === PARA_LANDED) {
      return dead ? PARA_CLIPS.deadLanded : PARA_CLIPS[PARA_LANDED];
    }
    return null;
  }

  /**
   * One engine tick.
   *
   * `forward` is the **camera**'s unit forward (free fall steers on the look
   * axis) and `bodyForward` the soldier's own, which is horizontal. Both are
   * the page's `(sin yaw * cos pitch, sin pitch, cos yaw * cos pitch)` frame.
   * `height` is metres above the terrain; `grounded` is the body's contact.
   */
  update({
    dt = 0,
    velocityY = 0,
    height = null,
    grounded = false,
    deploy = false,
    dead = false,
    forward = null,
    bodyForward = null,
  } = {}) {
    this.events.length = 0;
    this.accel.x = this.accel.y = this.accel.z = 0;
    this.drag = null;
    const pressed = deploy && !this._deployHeld;
    this._deployHeld = !!deploy;

    if (this.state === PARA_LANDED) {
      this._landedFor += dt;
      if (this._landedFor >= LANDED_CLIP_SECONDS) this.#toNone();
      return this;
    }

    if (this.state === PARA_NONE) {
      // `BFSoldier::handlePlayerInput` 0x08275eaa-0x08275f5d, both gates.
      // A non-finite height means the caller has no terrain to measure
      // against; the engine always has one (`terrainBase` is a singleton), so
      // the honest answer for a level with no collider is "no free fall"
      // rather than a height of infinity that arms it everywhere.
      if (!grounded && velocityY < FALL_STATE_SPEED
        && Number.isFinite(height) && height > FALL_STATE_HEIGHT) {
        this.state = PARA_FALLING;
        this.fallTime = 0;
        this._fired.clear();
        this.events.push({ type: 'state', state: PARA_FALLING, clips: PARA_CLIPS[PARA_FALLING] });
      } else {
        return this;
      }
    }

    if (this.state === PARA_FALLING) {
      if (grounded) { this.#toNone(); return this; }
      this.fallTime += dt;
      this.#fireFallSounds();
      // `c_PIMenuSelect9` -> TemplateMessage 18 -> setIsParachuting(true), and
      // `BFSoldier::handleMessage` (0x08277b84) takes it only while the lower
      // body is in `Lb_ParachuteFall` — which is this state exactly.
      if (pressed && !dead) {
        this.#toOpen();
      } else {
        // Free fall: the camera's forward times parachuteSpeed, y clamped so
        // the term can never lift you (0x0827274d-0x08272764).
        this.#steer(forward, true);
        return this;
      }
    }

    if (this.state === PARA_OPEN) {
      this.openTime += dt;
      this.drag = PARACHUTE_DRAG;
      // |vy| <= 2.0 closes it: 0x08272f3b and 0x08273129 in handleUpdate.
      if (grounded || Math.abs(velocityY) <= CHUTE_CLOSE_SPEED) {
        this.state = PARA_LANDED;
        this._landedFor = 0;
        this.drag = null;
        // No sample: `SoldierParachuteLand.ssc` does not ship (see
        // `CHUTE_LAND_HAS_NO_SCRIPT`). The event is the animation state's.
        this.events.push({
          type: 'sound', id: 'land', trigger: 'c_SstParachuteLand',
          sample: null,
        });
        this.events.push({
          type: 'state', state: PARA_LANDED,
          clips: dead ? PARA_CLIPS.deadLanded : PARA_CLIPS[PARA_LANDED],
        });
        return this;
      }
      // The chute drives along the body's own facing, not the view's, and has
      // no upward clamp (0x082727d4-0x082727f0).
      this.#steer(bodyForward, false);
    }
    return this;
  }

  #toNone() {
    this.state = PARA_NONE;
    this.fallTime = 0;
    this.openTime = 0;
    this.drag = null;
    this._fired.clear();
  }

  #toOpen() {
    this.state = PARA_OPEN;
    this.openTime = 0;
    this.drag = PARACHUTE_DRAG;
    const pick = CHUTE_OPEN_LAYERS[Math.min(
      CHUTE_OPEN_LAYERS.length - 1,
      Math.floor(this.random() * CHUTE_OPEN_LAYERS.length))];
    this.events.push({
      type: 'sound', id: 'open', trigger: 'c_SstOpenParachute',
      choices: CHUTE_OPEN_SAMPLES,
      sample: pick.sample, at: pick.at, volume: pick.volume,
    });
    this.events.push({ type: 'state', state: PARA_OPEN, clips: PARA_CLIPS.open });
  }

  #fireFallSounds() {
    for (const layer of FALL_SOUND_LAYERS) {
      if (this._fired.has(layer.id) || this.fallTime < layer.at) continue;
      this._fired.add(layer.id);
      const sample = layer.choices
        ? layer.choices[Math.min(layer.choices.length - 1,
          Math.floor(this.random() * layer.choices.length))]
        : layer.sample;
      this.events.push({
        type: 'sound', id: layer.id, trigger: 'c_SstFallingHigh',
        sample, loop: !!layer.loop, volume: layer.volume, at: layer.at,
      });
    }
  }

  #steer(dir, clampUp) {
    if (!dir) return;
    const x = dir.x || 0, z = dir.z || 0;
    let y = dir.y || 0;
    this.accel.x = x * PARACHUTE_SPEED;
    this.accel.z = z * PARACHUTE_SPEED;
    y *= PARACHUTE_SPEED;
    this.accel.y = clampUp && y > 0 ? 0 : y;
  }
}

