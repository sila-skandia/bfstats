// A man in the water: the swim state, the draft he floats at, and the clock
// that drowns him.
//
// Everything in this file was read out of `bf1942_lnxded.static` and out of
// `animations/AnimationStatesSwim.con`, and every number carries the address or
// the line that says so. Free of `three` and of the DOM, so
// `tests/swim_harness.mjs` runs the real thing under node.
//
// THE STATE. `BFSoldier::updateSwimming(float)` (lnxded `0x08282190`) runs once
// per tick out of `BFSoldier::handleUpdate` (`0x0827237a`, `0x08272c63`) and is
// the whole of it:
//
//   1. `terrainBase->vtbl+0xc` == -1.0 (`0x086b05ec`) -> return. A level with no
//      water has no swimming (`0x082821b9 cmp ah,0x40; jne`).
//   2. the LOWER body's `getCurrentStateFlags()` (`this+0x294`,
//      `0x082821d0`) carries `c_AsmIsClimbing` 0x10 -> return
//      (`0x082821da test eax,0x10`). A man on a ladder is not swimming.
//   3. `surfaceY = terrainBase->vtbl+0x5c(pos.x, pos.z)` (`0x08282215`) and
//      `depth = max(0, surfaceY - pos.y)` (`0x0828221e` .. `0x0828223a`).
//      **A function of x and z only** — the same trap HP-5's `touchesWater`
//      documents on the vehicle side: altitude is what decides water contact,
//      and it is decided against the soldier's own origin, which is his FEET.
//   4. not swimming yet: enter if `depth > 0.43` (`0x086d29bc`, tested at
//      `0x082823c5`) or if the surface is above the composite object's own
//      reference height (`0x082823b1`). Entering is two `setAnimationState`
//      calls, `Lb_StartSwim` (`0x086d299e`, `0x082823f7`) and `Ub_StartSwim`
//      (`0x086d29ab`, `0x08282426`).
//   5. already swimming: leave if `depth <= 0.35` (`0x086d29b8`, tested at
//      `0x082822a8`) — `Lb_EndSwim` (`0x086d2988`) and `Ub_EndSwim`
//      (`0x086d2993`) — else, while `surfaceY > pos.y` (`0x082822bc`), TELEPORT
//      the body to `surfaceY - 0.4` (`0x086c4f70`, `0x082822d4`, written
//      through `vtbl+0x3c`).
//
// So the swim state is not a physics mode the engine solves: it is an
// **animation state**, entered by name, and the thing physics reads is the
// `c_AsmIsSwimming` flag that state carries. `BFSoldier::isSwimming()`
// (`0x0827eba0`) is literally `getCurrentStateFlags(this+0x294) >> 3 & 1`.
// That is PHY-6's "state-flag bit 0x8", and this is what sets and clears it.
//
// The flag values are `ObjTemplBFModule::init`'s own `addConstantHelper` calls
// (`0x08298280`), one per bit, and they are consecutive: `c_AsmHideWeapon` 0x2
// (`0x0829914a`), `c_AsmLockFreeLook` 0x4 (`0x0829917a`), `c_AsmIsSwimming` 0x8
// (`0x082991aa`), `c_AsmIsClimbing` 0x10 (`0x082991da`), `c_AsmIsCrouching`
// 0x20 (`0x0829920a`), `c_AsmIsLying` 0x40 (`0x0829923a`) — which independently
// re-derives PHY-8's 0x20/0x40 pair.

/**
 * `c_AsmHideWeapon`. Every one of the five lower swim states declares it, and
 * `BFSoldier::enableItem(char)` returns without enabling anything while it is
 * set (`0x082784a1` reads the flags, `0x082784af and eax,0x2`, `0x082784b2 jne`
 * straight to the exit). So a swimming soldier's weapon really is stowed —
 * read, not assumed — and the swim clips living under `animations/3P_NoWeapon/`
 * is the art agreeing with the code.
 */
export const ASM_HIDE_WEAPON = 0x2;
/** `c_AsmIsSwimming`, PHY-6's bit (`0x082991aa`). */
export const ASM_IS_SWIMMING = 0x8;
/** `c_AsmIsClimbing` (`0x082991da`). `updateSwimming` early-outs on it. */
export const ASM_IS_CLIMBING = 0x10;

/** Enter the swim state above this much water over the feet (`0x086d29bc`). */
export const SWIM_ENTER_DEPTH = 0.43;
/** And leave it at or below this much (`0x086d29b8`). The hysteresis is the
 *  engine's: 8 cm of it, which is what stops a man in the surf flickering. */
export const SWIM_LEAVE_DEPTH = 0.35;
/** How far below the surface a swimmer's feet are pinned (`0x086c4f70`). */
export const SWIM_FLOAT_DRAFT = 0.4;
/**
 * The swim locomotion gain: `a = 5.0 * vCmd` (`0x086c5288`, applied at
 * `0x08274b6f`-`0x08274b98` and handed to
 * `addAccelerationAtRelativePosition`).
 *
 * PHY-6's important half: this is **not** under the `IResponsePhysics+0xa4 == 0`
 * gate that the ordinary `0.75 * vCmd` locomotion force is under —
 * `0x08274a03`'s `jne` lands past the 0.75 block and before the swim test at
 * `0x08274b5f`. A swimmer is accelerated every tick, in contact or not.
 */
export const SWIM_ACCEL_GAIN = 5.0;

/**
 * The ceiling on a swimmer's horizontal speed, as a fraction of the standing
 * forward table entry. **A viewer number, and the one thing in this file that
 * is not read out of the engine.** It is labelled as such for the same reason
 * `CANOPY_VIEW_MARGIN` is.
 *
 * WHY THERE HAS TO BE ONE. The engine's swim force is an acceleration of
 * `5.0 * vCmd` and nothing caps it; what caps it is the drag on a body in water.
 * That drag is **not** the law `physics.js` carries. A soldier is a `PhysicsNode`,
 * and PHY-4 settled that every live `PhysicsNode` takes the **box** branch
 * (`0x08252f50` / `0x08253280`), which is *quadratic* in speed:
 *
 *     relV   = scale*v - wind,   scale = 1 + 24*min(depth/DY, 1)
 *     accel += -(drag*|relV|/mass) * (Ax*projX(relV) + Ay*projY + Az*projZ)
 *     Ax = (pi/4)*DY*DZ   Ay = (pi/4)*DX*DZ   Az = (pi/4)*DX*DY
 *
 * `PointBody.applyDrag` here is the *sphere* law, linear in v, with an inferred
 * bounding radius (`SOLDIER_BOUNDING_RADIUS`). Balancing `5*vCmd` against that
 * gives about 167 m/s at a 6 m/s command — a man crossing Wake in four seconds.
 * So the module must either carry the box law or cap the speed, and the box law
 * is a bigger job than this stream and belongs beside the vehicles that need it
 * too (`physics.md` §3 says so in as many words).
 *
 * WHY THIS NUMBER. Two things agree on about 2 m/s:
 *
 *  1. The box law's own balance, with the scale saturated (`depth >= DY`, i.e.
 *     25x dry drag) and the soldier's collision extent taken as roughly
 *     0.8 x 1.8 m: `v = sqrt(5*6*100 / (25^2 * (pi/4)*0.8*1.8))` = **2.06 m/s**.
 *     The saturation is the assumption — at the 0.4 m draft against a 1.8 m box
 *     the scale would be 6.33 and the balance 8.1 m/s, which is *faster than
 *     running* and so is almost certainly not what the engine does. Which of the
 *     two `ResponsePhysics::checkVsTerrain` (`0x0825a960`, `setUnderWater` at
 *     `0x0825ac60`) actually produces was **not** settled; see the feature doc.
 *  2. `walkSpeedFactor` (1/3, `0x0872ee10`), which is a shipped constant, gives
 *     exactly 2.0 m/s off the standing row — and a swimming soldier moving at
 *     about a walk is the observable everyone who has played the game has.
 *
 * So the ceiling is the shipped walk factor, and the arithmetic above is written
 * out so that whoever reads `checkVsTerrain` can replace it with the real thing.
 */
export const SWIM_SPEED_CEILING_FACTOR = 1 / 3;

/**
 * `MaterialManager` index 1 is water.
 *
 * Not inferred from the material list: `GameServer::handleCollisionLandOrWater`
 * (`0x08154960`) hardcodes the literal 1 into all three material lookups on its
 * `param_7 == 1` arm (`getEffectForMaterial`, `getDamageForMaterial`,
 * `getDamageModifier`), and `Armor::setLastHitMaterialIndex` tests `mat == 1`
 * before it touches the water byte at all.
 */
export const MATERIAL_WATER = 1;

/**
 * The drowning law, and it is `Armor`'s ordinary water-damage tick — the same
 * mechanism as the vehicle's `hpLostWhileDamageFromWater`, not a separate one.
 *
 * `Armor::update(float dt)` (`0x08172f40`), fields mapped off their own
 * setters:
 *
 * ```
 * inWater = armor[0x10]                                  // refreshed from +0x11
 * if (!inWater || !damageFromWater)  timer = waterDamageDelay   // +0xe0, +0xec
 * else {
 *   timer -= dt                                          // +0xe4
 *   if (timer < 0) { damage(hpLostWhileDamageFromWater);  // +0x124
 *                    timer = 1.0 }                       // 0x3f800000, NOT the delay
 * }
 * ```
 *
 * `setDamageFromWater` writes +0xe0 (`0x08173fd9`); `setWaterDamageDelay`
 * writes BOTH the live timer +0xe4 and the stored delay +0xec (`0x08174059`,
 * `0x0817405f`); `setHpLostWhileDamageFromWater` writes +0x124 (`0x081743d9`).
 * The reset to a flat 1.0 rather than to the delay is the load-bearing detail:
 * the delay is a grace period that happens once, and after it the bleed is one
 * tick of `hpLost` per second.
 *
 * WHAT ARMS IT FOR A SOLDIER, and this is the part that makes it swim-keyed
 * rather than depth-keyed. `Armor::setLastHitMaterialIndex(int)`
 * (`0x081736b0`, IArmor vtable +0x60):
 *
 * ```
 * if (mat != 1) return;                                   // water only
 * if (object->getTemplate()->getClassId() == CID_BFSoldierTemplate)  // 0x086c2b88
 *      armor[0x11] = BFSoldier::isSwimming(object);        // 0x08173700-0x0817370e
 * else armor[0x11] = 1;                                   // 0x081736f3
 * ```
 *
 * A vehicle that touches water is wet. A **soldier** is wet only while the
 * `c_AsmIsSwimming` flag is up — so wading never starts the clock, and leaving
 * the water resets it, because `Armor::update`'s own `!inWater` arm puts the
 * timer back to the full delay every tick he is dry.
 *
 * The numbers are `Objects/Soldiers/Common/CommonSoldierData.inc`, which every
 * vanilla soldier includes:
 *
 *     ObjectTemplate.hpLostWhileDamageFromWater 1
 *     ObjectTemplate.WaterDamageDelay 90
 *     ObjectTemplate.DamageFromWater 1
 *     ObjectTemplate.HitPoints 30
 *
 * 90 s of grace, then 1 HP a second off 30 — so a soldier who never surfaces
 * dies 120 s after he starts swimming. No vanilla object anywhere sets
 * `deepWaterLevel`, `damageFromDeepWater`, `deepWaterDamageDelay` or
 * `hpLostWhileDamageFromDeepWater` (surveyed over every text entry of every
 * `Mods/bf1942/Archives/**.rfa`), so `Armor::update`'s second, deep-water
 * timer is inert in vanilla and is not modelled here.
 */
export const WATER_DAMAGE_DELAY = 90;
/** `hpLostWhileDamageFromWater` off `CommonSoldierData.inc`. */
export const HP_LOST_WHILE_DAMAGE_FROM_WATER = 1;
/** What `Armor::update` resets the timer to after a hit — a flat second. */
export const WATER_DAMAGE_INTERVAL = 1.0;

/**
 * The five lower-body swim states and the four upper-body ones that pair with
 * them, exactly as `animations/AnimationStatesSwim.con` creates them, plus the
 * death pair from `animations/AnimationStatesDie.con`.
 *
 * Keyed by the viewer-side family name, valued by the engine's own state names,
 * so the baked clips carry the engine's names and there is no translation table
 * between this and `soldier-body.js` — the same discipline `PARA_CLIPS` keeps.
 *
 * `Lb_EndSwim` plays `3PSwimStartLower.baf` at a **negative** speed (-3.2,
 * `3pAnimationsTweaking.con`): the exit is the entry run backwards, one clip
 * serving both. And `Lb_EndSwim` still declares `c_AsmIsSwimming`, so the flag
 * — and therefore the drowning clock and the 5.0 gain — stay up until the clip
 * finishes and `addTransitionWhenDone Lb_Stand` fires.
 */
export const SWIM_CLIPS = Object.freeze({
  swimStart: Object.freeze({ lower: 'Lb_StartSwim', upper: 'Ub_StartSwim' }),
  swimFloat: Object.freeze({ lower: 'Lb_Floating', upper: 'Ub_Floating' }),
  swimForward: Object.freeze({ lower: 'Lb_SwimForward', upper: 'Ub_SwimForward' }),
  swimBackward: Object.freeze({ lower: 'Lb_SwimBackward', upper: 'Ub_SwimBackward' }),
  swimEnd: Object.freeze({ lower: 'Lb_EndSwim', upper: 'Ub_EndSwim' }),
  swimDie: Object.freeze({ lower: 'Lb_DieSwim', upper: 'Ub_DieSwim' }),
});

/**
 * The flag word each family's LOWER state declares, verbatim from
 * `animations/AnimationStatesSwim.con` and `AnimationStatesDie.con`.
 *
 * All five swim states declare `setFlag c_AsmHideWeapon` **and**
 * `setFlag c_AsmIsSwimming`, in that order. `Lb_DieSwim` is in the death file
 * and declares `c_AsmHideWeapon` and `c_AsmLockFreeLook` like every other
 * lower death state there (`AnimationStatesDie.con` lines 124-125), and not
 * `c_AsmIsSwimming`: a corpse is not swimming. `c_AsmLockFreeLook` (0x80) is
 * left out of the word because nothing here reads it. The upper five declare
 * nothing, which is consistent with every reader in the binary looking at
 * `this+0x294`, the lower machine.
 *
 * The lower machine is the one the engine reads, so this word is the whole of
 * what a swimming soldier's state contributes to `getCurrentStateFlags()`.
 */
export const SWIM_STATE_FLAGS = Object.freeze({
  swimStart: ASM_HIDE_WEAPON | ASM_IS_SWIMMING,
  swimFloat: ASM_HIDE_WEAPON | ASM_IS_SWIMMING,
  swimForward: ASM_HIDE_WEAPON | ASM_IS_SWIMMING,
  swimBackward: ASM_HIDE_WEAPON | ASM_IS_SWIMMING,
  swimEnd: ASM_HIDE_WEAPON | ASM_IS_SWIMMING,
  swimDie: ASM_HIDE_WEAPON,
});

/**
 * THE ITEM GATE: what `c_AsmHideWeapon` actually shuts, which is far more than a
 * weapon's visual.
 *
 * The engine does **not** block the fire input. It leaves the swimmer with
 * nothing to fire, and it does so in three independent places, all reading
 * `AnimationStateMachineInstance::getCurrentStateFlags(this+0x294)` (lnxded
 * `0x0832b110`) and testing bit `0x2`:
 *
 *  1. **`BFSoldier::handleMessage(TemplateMessage, IPlayer*)`** (`0x08277260`),
 *     the big one: `0x082772a4` calls `getCurrentStateFlags`, `0x082772ac
 *     and eax,0x2`, `0x082772af jne` — straight past the **whole** dispatch.
 *     The dispatch is `lea eax,[edi-0x6]` / `cmp eax,0x10` / `jmp DWORD PTR
 *     [eax*4+0x86d2748]`, a 17-entry jump table over messages **6 to 22**, so
 *     while the bit is up the soldier discards every one of them. Two are named
 *     in this tree already (the demolitions block in `map.html` reads them out
 *     of this same function): **Fire is message 6** and **AltFire is message 7**,
 *     and **MenuSelect4 is message 13** — so the MenuSelect family, the weapon
 *     slots, is in the range too. Messages `0x15` (destruction, HP-13) and
 *     `0x12` are intercepted *before* the gate at `0x08277275` and `0x0827728e`
 *     and are the only two that survive it.
 *  2. **`BFSoldier::selectBestLoadedWeapon()`** (`0x08273a80`): `0x08273ae9`
 *     reads the flags, `0x08273af1 and eax,0x2`, `0x08273af4 jne 0x08273be5` —
 *     the automatic switch away from an empty weapon is off as well.
 *  3. **`BFSoldier::enableItem(char)`** (`0x08278460`): `0x082784a1` reads the
 *     flags, `0x082784af and eax,0x2`, `0x082784b2 jne 0x082787d1`, the
 *     function's own `ret`. Nothing can be enabled by any other path either.
 *
 * So the honest implementation of "a swimmer cannot fire" is **not** a special
 * case on the trigger. It is: while this bit is up there is no active item, so
 * the trigger, the alt-fire, the slot keys, the reload and the plunger all have
 * nothing to act on. `handleSwimAction` (`0x08282460`) is a separate and much
 * smaller thing — it zeroes the *jump* axis (`c_PIAction`, index 9) and leaves
 * `c_PIFire` (index 8) alone, which is why reading that function alone gives the
 * wrong answer.
 */
export function itemsLocked(stateFlags) {
  return (Number(stateFlags) & ASM_HIDE_WEAPON) !== 0;
}

/**
 * The throttle band that picks the stroke, out of the states' own
 * `addTransitionOne c_PIThrottle` clauses:
 *
 *     Lb_Floating  c_PIThrottle  0.5  1   -> Lb_SwimForward
 *     Lb_Floating  c_PIThrottle -1   -0.5 -> Lb_SwimBackward
 *
 * and both stroke states `returnToState Lb_Floating`, so anything inside
 * [-0.5, 0.5] falls back to treading water. The band is the engine's, not a
 * dead zone anyone chose.
 */
export const SWIM_THROTTLE_BAND = 0.5;

/**
 * How long the two one-shots last, in seconds.
 *
 * A state's `addAnimation <clip> <speed>` number is **cycles per second**, not a
 * playback multiplier: `AnimationStateMachineInstance::updateState` advances a
 * normalised phase by `dt * speed` and `applyOnSkeleton` reads frame
 * `int(phase * N) % N` (ledger ANIM-1), so a clip's wall-clock period is
 * `1 / |speed|` whatever its frame count. `3PSwimStartLower.baf` holds 8 frames
 * and that changes nothing but the resolution.
 *
 * The speeds are the ones the state machine ends up with, which are NOT the ones
 * `AnimationStatesSwim.con` writes: `animations/3pAnimationsTweaking.con`
 * re-declares the entry as `set3pAnimationSpeed Lb_StartSwim 2.60`, overriding
 * the 3.6 in the state file. The exit's -3.2 is declared in both and agrees.
 *
 * These are timers for the *state machine*, not for the animation — the renderer
 * gets the real clip out of `swim.gait.glb` at its baked period. They exist so
 * `addTransitionWhenDone` fires at the same moment here as there.
 */
export const SWIM_START_SPEED = 2.6;
export const SWIM_END_SPEED = 3.2;
export const SWIM_START_SECONDS = 1 / SWIM_START_SPEED;
export const SWIM_END_SECONDS = 1 / SWIM_END_SPEED;

/**
 * `max(0, surfaceY - feetY)`, the engine's own quantity (`0x0828221e`).
 *
 * `surfaceY` is the water surface at (x, z) and nothing else — pass `null` for
 * a level with no water and the answer is 0, which is `updateSwimming`'s
 * `terrainBase->getWaterLevel() == -1.0` early-out in a different shape.
 */
export function swimDepth(surfaceY, feetY) {
  if (surfaceY == null || !Number.isFinite(surfaceY) || !Number.isFinite(feetY)) {
    return 0;
  }
  const depth = surfaceY - feetY;
  return depth > 0 ? depth : 0;
}

/**
 * The stroke a throttle asks for, by the states' own transition bands.
 *
 * `null` means "not a stroke": the caller is not swimming, or is still playing
 * one of the one-shots.
 */
export function swimStroke(throttle) {
  const t = Number.isFinite(throttle) ? throttle : 0;
  if (t > SWIM_THROTTLE_BAND) return 'swimForward';
  if (t < -SWIM_THROTTLE_BAND) return 'swimBackward';
  return 'swimFloat';
}

/**
 * Each swim state's `setMorphFactor`, `animations/AnimationStatesSwim.con` and
 * `AnimationStatesDie.con`: 4.0 on every swim state but `Ub_EndSwim`'s 1.0,
 * and 20 on the swim death. With `STAND_MORPH`, the base the exit's
 * `addTransitionWhenDone Lb_Stand` / `Ub_Stand` lands on
 * (`AnimationStatesLower.con` / `AnimationStatesUpper.con`, the same numbers
 * `soldier-actions.js` `VANILLA_STATES` carries for `stand.lower` /
 * `stand.upper`).
 *
 * The morph is ANIM-4's weight ramp: on entering a state the blend weight
 * starts at 0 and gains `dt x morph` a tick, the bones slerped from where they
 * stood toward the new clip, so a state is fully in after `1 / morph` seconds.
 */
export const SWIM_MORPH = Object.freeze({
  Lb_StartSwim: 4.0, Ub_StartSwim: 4.0,
  Lb_Floating: 4.0, Ub_Floating: 4.0,
  Lb_SwimForward: 4.0, Ub_SwimForward: 4.0,
  Lb_SwimBackward: 4.0, Ub_SwimBackward: 4.0,
  Lb_EndSwim: 4.0, Ub_EndSwim: 1.0,
  Lb_DieSwim: 20.0, Ub_DieSwim: 20.0,
});
export const STAND_MORPH = Object.freeze({ lower: 2.0, upper: 0.7 });

/**
 * The swim family (`SWIM_CLIPS` key) a `{ lower, upper }` clip pair is, or
 * null. The lower name decides: it is the machine the engine reads.
 */
export function swimFamilyOfPair(pair) {
  const lower = pair?.lower;
  if (!lower) return null;
  for (const [family, clips] of Object.entries(SWIM_CLIPS)) {
    if (clips.lower === lower) return family;
  }
  return null;
}

/**
 * How long each half's morph takes when a whole-body renderer switches from
 * family `from` to family `to`, as `{ lower, upper }` seconds -- or null when
 * neither end is a swim family, which leaves every other switch as it was.
 *
 * Into a swim state: that state's own morph (`SWIM_MORPH`). Out of one onto
 * the gait: the stand base's, because `Lb_EndSwim` / `Ub_EndSwim` hand over to
 * `Lb_Stand` / `Ub_Stand` and those are what the weight ramps into. Null from
 * a rig that drew nothing yet.
 */
export function swimMorphSeconds(from, to) {
  // Nothing drawn before (a fresh rig) is nothing to morph from.
  if (from == null || to == null || from === to) return null;
  const into = SWIM_CLIPS[to];
  if (into) {
    return { lower: 1 / (SWIM_MORPH[into.lower] ?? 4.0),
             upper: 1 / (SWIM_MORPH[into.upper] ?? 4.0) };
  }
  if (SWIM_CLIPS[from]) {
    return { lower: 1 / STAND_MORPH.lower, upper: 1 / STAND_MORPH.upper };
  }
  return null;
}

/**
 * Switch a whole-body rig's `families` (`{ family: [lowerAction, upperAction] }`,
 * or a single-action pose family) from `from` to `to`: the new family on from
 * its first frame, everything else off. Into or out of the water it is the
 * engine's morph instead of a cut -- the new family's actions fade in and the
 * old one's out over `swimMorphSeconds`, which is the weight ramp above done as
 * a cross-fade between the two clips. Duck-typed on three.js `AnimationAction`
 * (`reset`, `play`, `setEffectiveWeight`, `fadeIn`, `fadeOut`), so this module
 * stays free of `three`.
 */
export function switchFamily(families, from, to) {
  const fade = swimMorphSeconds(from, to);
  const seconds = (i, n) => (n > 1 && i > 0 ? fade.upper : fade.lower);
  for (const [family, actions] of Object.entries(families ?? {})) {
    actions.forEach((a, i) => {
      if (family === to) {
        a.paused = false;
        a.reset();
        a.setEffectiveWeight(1);
        if (fade) a.fadeIn(seconds(i, actions.length));
        a.play();
      } else if (fade && family === from) {
        a.fadeOut(seconds(i, actions.length));
      } else {
        a.setEffectiveWeight(0);
      }
    });
  }
}

/**
 * `updateSwimming`, as a state object.
 *
 * Owns exactly what the engine's function owns: whether the `c_AsmIsSwimming`
 * flag is up, which of the six states is current, and the draft the body is to
 * be pinned at. It does NOT own the body — the caller (`SoldierBody`) applies
 * the pin, because the engine's own `setPosition` call is on the object and not
 * on the animation.
 */
export class SwimState {
  constructor() {
    this.reset();
  }

  reset() {
    /** Is `c_AsmIsSwimming` up? This is the bit physics and `Armor` read. */
    this.swimming = false;
    /** The current family name, or `null` when dry. */
    this.family = null;
    /** `max(0, surfaceY - feetY)` as of the last `update`. */
    this.depth = 0;
    /** The water surface the last `update` saw, or `null`. */
    this.surfaceY = null;
    /** Seconds left of a one-shot (`Lb_StartSwim` / `Lb_EndSwim`). */
    this.oneShotLeft = 0;
    /** Did this update cross into, or out of, the water? For sound and HUD. */
    this.entered = false;
    this.left = false;
    /** Seconds spent continuously swimming, which is what the clock bills. */
    this.swimTime = 0;
    return this;
  }

  /** The locomotion gain a swimmer is accelerated at, for the body to read. */
  get gain() { return SWIM_ACCEL_GAIN; }

  /** The horizontal speed ceiling, as a fraction of the table's own entry. */
  get ceilingFactor() { return SWIM_SPEED_CEILING_FACTOR; }

  /** True while a one-shot is still playing, so the caller clamps it. */
  get oneShot() {
    return this.family === 'swimStart' || this.family === 'swimEnd';
  }

  /**
   * `getCurrentStateFlags()` of the LOWER machine — the word every reader in the
   * binary tests (`this+0x294`). 0 when he is dry, because a dry man's state is
   * `Lb_Stand`, which declares no flags.
   */
  get stateFlags() {
    return this.family ? (SWIM_STATE_FLAGS[this.family] ?? 0) : 0;
  }

  /**
   * Is the engine's item gate shut? See `itemsLocked` for the three call sites.
   *
   * Keyed off the live lower state, which is what `getCurrentStateFlags` reads.
   * `Lb_EndSwim` declares `c_AsmHideWeapon` like the other four, so the weapon
   * stays away for the third of a second the exit clip takes — the same span
   * over which the drowning clock and the 5.0 gain stay up.
   */
  get itemsLocked() { return itemsLocked(this.stateFlags); }

  /** The lower/upper clip pair for the current state, or `null` when dry. */
  clips(dead = false) {
    if (dead) return this.swimming ? SWIM_CLIPS.swimDie : null;
    return this.family ? SWIM_CLIPS[this.family] : null;
  }

  /**
   * One tick.
   *
   * `surfaceY` is the water surface at the body's own (x, z), or `null` where
   * there is no water; `feetY` is the body origin. `throttle` is the forward
   * input, which is what `c_PIThrottle` is. `climbing` is `c_AsmIsClimbing`,
   * which switches the whole function off.
   *
   * Returns the y the body is to be pinned at, or `null` for "leave it alone" —
   * the engine only writes the position while `surfaceY > pos.y`.
   */
  update({ dt = 0, surfaceY = null, feetY = 0, throttle = 0,
           climbing = false, dead = false } = {}) {
    this.entered = false;
    this.left = false;
    const depth = swimDepth(surfaceY, feetY);
    this.depth = depth;
    this.surfaceY = surfaceY == null || !Number.isFinite(surfaceY) ? null : surfaceY;
    // `0x082821da`: a man on a ladder is not swimming, and the function does not
    // even look at the water. It does not take him out of the state either --
    // it returns before the exit test -- so this mirrors that exactly.
    if (climbing) return null;
    if (this.oneShotLeft > 0) {
      this.oneShotLeft = Math.max(0, this.oneShotLeft - dt);
      if (this.oneShotLeft === 0) {
        // `addTransitionWhenDone`: the entry hands over to `Lb_SwimForward`,
        // and from there the throttle bands take over; the exit hands over to
        // `Lb_Stand`, which is the first state without `c_AsmIsSwimming` and so
        // is where the flag actually drops.
        if (this.family === 'swimEnd') {
          this.swimming = false;
          this.family = null;
          this.left = true;
          this.swimTime = 0;
        } else {
          this.family = 'swimForward';
        }
      }
    }
    if (!this.swimming) {
      if (depth > SWIM_ENTER_DEPTH) {
        this.swimming = true;
        this.family = 'swimStart';
        this.oneShotLeft = SWIM_START_SECONDS;
        this.entered = true;
        this.swimTime = 0;
      }
      return this.swimming ? this.#pin(feetY) : null;
    }
    this.swimTime += dt;
    if (depth <= SWIM_LEAVE_DEPTH) {
      if (this.family !== 'swimEnd') {
        this.family = 'swimEnd';
        this.oneShotLeft = SWIM_END_SECONDS;
      }
      // Still `c_AsmIsSwimming` — `Lb_EndSwim` declares it — but out of the
      // water, so no pin: the engine's pin is inside the `depth > 0.35` arm.
      return null;
    }
    if (!this.oneShot) this.family = swimStroke(dead ? 0 : throttle);
    return this.#pin(feetY);
  }

  /** `0x082822bc`: only while the surface really is above the feet. */
  #pin(feetY) {
    if (this.surfaceY == null) return null;
    if (!(this.surfaceY > feetY)) return null;
    return this.surfaceY - SWIM_FLOAT_DRAFT;
  }
}

/**
 * `Armor::update`'s water-damage timer, on its own.
 *
 * `update(dt, inWater)` returns the HP to take off this tick — 0 on almost
 * every tick, `HP_LOST_WHILE_DAMAGE_FROM_WATER` on the one where the timer
 * runs out. The caller applies it to the `Armor`, because that is where
 * `Armor::update` applies it and because this viewer's soldier Armor lives in
 * the page.
 */
export class DrownTimer {
  constructor({ delay = WATER_DAMAGE_DELAY,
                hpLost = HP_LOST_WHILE_DAMAGE_FROM_WATER,
                interval = WATER_DAMAGE_INTERVAL,
                damageFromWater = true } = {}) {
    this.delay = delay;
    this.hpLost = hpLost;
    this.interval = interval;
    this.damageFromWater = Boolean(damageFromWater);
    this.timer = delay;
    /** Total HP this timer has taken off, for a HUD or a test. */
    this.lost = 0;
  }

  reset() {
    this.timer = this.delay;
    this.lost = 0;
    return this;
  }

  /** Seconds of grace left before the first hit, or 0 once it has landed. */
  get graceLeft() {
    return this.timer > this.interval ? this.timer : 0;
  }

  update(dt, inWater) {
    if (!inWater || !this.damageFromWater) {
      // The engine puts the timer back to the FULL delay every dry tick
      // (`Armor::update`'s `param_1[0x39] = param_1[0x3b]`), so surfacing for
      // one tick buys the whole 90 s again. That is the engine's, not a choice.
      this.timer = this.delay;
      return 0;
    }
    this.timer -= dt;
    if (this.timer >= 0) return 0;
    this.timer = this.interval;
    this.lost += this.hpLost;
    return this.hpLost;
  }
}
