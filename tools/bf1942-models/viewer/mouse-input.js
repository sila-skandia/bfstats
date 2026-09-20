/**
 * The mouse-look input stage — everything between a pointer-lock pixel and
 * `PlayerInput[c_PIMouseLookX/Y]`, as the retail client computes it.
 *
 * Ledger GUN-2b, closed by the 2026-09-20 verifier and extended here. The one
 * sentence that matters, because every earlier reading of this file got it
 * wrong: **the mouse-look axis is a RATE, not a per-frame count.**
 *
 *     PlayerInput[c_PIMouseLookX] = 0.001 x (counts per second) x (5 x s + 0.1)
 *
 * and that value is computed ONCE per pumped frame and read by EVERY
 * simulation tick that frame produces. It is not spread across the ticks and
 * it is not re-sampled per tick, which is exactly why the total rotation for a
 * given hand movement is the same at 30, 60 and 144 fps.
 *
 * Read from instructions, client (`BF1942.exe`, sha256 `60c9452d...cd3699`)
 * unless said otherwise:
 *
 *   * The device. `dice.ref2.io.InputDeviceManager.DX8` (class-name string
 *     `0x009064ac`, registrar `0x005c1c20`, creator `0x005c1bd0`, ctor
 *     `0x0063cbe0`, vtable `0x009170f0`). `initDevices` `0x0063c9d0` builds the
 *     0x6c-byte mouse on `flags & 1` (IDFMouse = 1, lnxded
 *     `operator<<(ostream&, InputDeviceFlags)` `0x083f4d00`); its ctor
 *     `0x006701f0` seeds `axisScale[0..3] = 1.0f` at `+0x40..+0x4c`
 *     (`0x0067022a`) and `invert[0..3] = 0` at `+0x50..+0x53`. Device vtable
 *     `0x0091aba0`: `+0x2c getAxisValue` `0x0066ffa0`, `+0x30 setInvertAxis`
 *     `0x0066ff20`, `+0x38 setAxisScale` `0x0066ff60`.
 *   * `getAxisValue` does NO arithmetic — it returns `[this + axis*4 + 0x18]`
 *     (relative) or `+0x28` (absolute), negated when `[this + axis + 0x50]`.
 *     The whole conversion lives in `update(float dt)` `0x0066ffe0`:
 *     `GetDeviceState(0x14, &DIMOUSESTATE2)` (`0x0066fffe`), then a gate
 *     `fld dt; fcomp ds:0x8c41ac (= 0.0f); test ah,0x41; jne` at
 *     `0x00670028`-`0x00670037` that **skips the whole axis block unless
 *     `dt > 0`, leaving the registers exactly as they were**, then
 *     `0x00670039 fild lX; 0x0067003d fmul [esi+0x40]` (axisScale);
 *     `0x00670040 fld ds:0x8c53c8 (1.0f); 0x00670046 fdiv dt`;
 *     `0x0067004e fld ds:0x8d5bc4` = bytes `6f 12 83 3a` = **0.001f**;
 *     `fmul st,st(1); fmul 1/dt; 0x0067005a fstp [esi+0x18]`.
 *   * The scale. `applyMouseSensitivity` `0x006c55f0`:
 *     `0x006c5636 fld [esp+0x10]` (the profile sensitivity);
 *     `0x006c5642 fmul ds:0x8d646c` = `00 00 a0 40` = **5.0f**;
 *     `0x006c5648 fadd ds:0x8c53cc` = `cd cc cc 3d` = **0.1f**; handed to
 *     `device->vt[+0x38](0, scale)` (`0x006c566b`) and `(1, scale)`
 *     (`0x006c568a`). Its sibling `0x006c5580` resets both axes to **1.0f**
 *     (`push 0x3f800000`), which is what proves 1.0 is the identity scale.
 *   * The transport carries it verbatim: lnxded `ControlMap::axisToAxis`
 *     `0x083f24b0` asks the device for `relative = 1` (`0x083f24be push 0x1`,
 *     client twin `0x0061b490`) and is the only `resolveAxisMapping` arm with
 *     no `dt`; the mapping's trailing `0`/`1` (`AxisMapping+0x4c`) negates at
 *     `0x083f1f57`/`0x083f1f69`; `PlayerInput::fromControlMap` `0x00610f80`
 *     stores `getAxisValue(id)` straight through `PlayerInput::set`
 *     `0x00407dc0` for ids 0..0x36, with no arithmetic in between.
 *   * One pump per frame carries the whole consumed time:
 *     `InputManager::update` `0x0049ce70` pumps the device manager once with
 *     `nTicks x tickDt` (`0x0049cff7 fild nTicks; fmul tickDt; call [eax+0x20]`)
 *     and passes **0.0f** for ticks 2..N (`0x0049d02f push ebx`, `ebx = 0`),
 *     which fails the `dt > 0` gate above and leaves the axis registers alone.
 *     A frame that produces **no** tick does not pump at all
 *     (`0x0049cf46 jnp 0x49d14d`) and DirectInput keeps accumulating counts.
 *
 * THE ONE UNPROVEN UNIT: that one browser `movementX` pixel is one DirectInput
 * count. Nothing in either binary can settle that — it is a property of the
 * mouse and of Chromium's own pointer-lock plumbing. It is the single tunable
 * here (`countsPerPixel`, default 1.0, `?turret=` multiplies it). Everything
 * else in this file is transcribed.
 */

// --- the constants, each with the address its bytes were read at -----------

/** `ds:0x008d5bc4` = `6f 12 83 3a`. The per-millisecond-ish rate factor. */
export const RATE_FACTOR = 0.001;
/** `ds:0x008d646c` = `00 00 a0 40`. */
export const SENSITIVITY_GAIN = 5.0;
/** `ds:0x008c53cc` = `cd cc cc 3d`. */
export const SENSITIVITY_OFFSET = 0.1;
/** The `range` argument `PlayerAction::set` passes `floatToFixed`: lnxded
 *  `0x081128a0` pushes `0x41800000` at `0x081128c3`. */
export const AXIS_RANGE = 16.0;
/** ...and the `bits`: `0x081128c8 push 0xc`. */
export const AXIS_BITS = 12;
/** `(1 << 12) - 1`, built at lnxded `0x081134d1`-`0x081134d8`. */
export const AXIS_STEPS = (1 << AXIS_BITS) - 1;
/** `ds:0x086b01ac` = `00 00 c8 42` = 100.0f — the granularity `PlayerAction::
 *  get` snaps the decoded value to (lnxded `0x0815c611` / `0x0815c62b`). */
export const DECODE_GRANULARITY = 100.0;

/**
 * The four shipped profiles, read out of
 * `Mods/bf1942/Settings/Default/Controls/` (identical under
 * `Settings/Profiles/Default/Controls/`):
 *
 *   `Common.con:42`   `game.setCommonMouseSensitivity 0.25`
 *   `Infantry.con:28` `game.setInfMouseSensitivity 0.250000`
 *   `Land.con:22`     `game.setLandSeaMouseSensitivity 0.250000`
 *   `Air.con:27`      `game.setAirMouseSensitivity 0.7500000`
 *
 * so the axis scale is **1.35** everywhere except an aircraft, which is
 * **3.85**. The menu slider's 0..1 spans scales 0.1..5.1.
 */
export const DEFAULT_SENSITIVITY = Object.freeze({
  common: 0.25,
  infantry: 0.25,
  landSea: 0.25,
  air: 0.75,
});

export const PROFILES = Object.freeze(['common', 'infantry', 'landSea', 'air']);

/**
 * Which profile the player is on, given what he is doing.
 *
 * It is NOT in the Controls `.con` files: they only declare the three player
 * maps (`defaultPlayerInputControlMap` in `Infantry.con`,
 * `LandSeaPlayerInputControlMap` in `Land.con`, `AirPlayerInputControlMap` in
 * `Air.con`) plus `defaultGameControlMap` in `Common.con`. The client picks one
 * on entry from the PCO's own `getVehicleCategory()` — `pco->vtable[+0x78]` at
 * `0x006d78a5`, then `0x006d78aa` / `0x006d78b6` (`== 0` or `== 1`) push
 * `LandSeaPlayerInputControlMap` (`0x00922500`) and `0x006d78c2` (`== 2`)
 * pushes `AirPlayerInputControlMap` (`0x00922520`); any other value falls
 * through at `0x006d78da` **without changing the map**, so the soldier's own
 * `defaultPlayerInputControlMap` (`0x008cb790`) stays active. The enum is
 * lnxded `operator<<(ostream&, VehicleCategory)` `0x0829b530`: **0 VCLand,
 * 1 VCSea, 2 VCAir**.
 *
 * A survey of vanilla `Objects.rfa` settles what that means for a manned gun:
 * of 122 `PlayerControlObject` templates, 121 declare a category, and every
 * stationary weapon and every gunner position is **VCLand** —
 * `Stationary_Browning`, `Stationary_mg42`, `Defgun`, `flak38`, `AA_Allies`,
 * and also `B17_PCO1`, `StukaRearGunControl`, `AichiValRearGunControl` and the
 * rest of the aircraft gun positions, which therefore aim on the LandSea
 * profile while the pilot beside them is on Air. Only the 13 aircraft *pilot*
 * PCOs declare `VCAir`; the ships declare `VCSea`, which selects the same
 * LandSea map.
 *
 * Two things a first reading of that survey got wrong, both re-derived:
 *
 *   * Ten of the 121 declare the **unprefixed** spelling — `AA_Allies` says
 *     `setVehicleCategory Land`, and nine Daihatsu/Lcvp/PTRaft passenger PCOs
 *     say `Sea`. Those are real aliases, not typos: `operator>>(istream&,
 *     VehicleCategory&)` lnxded `0x0829b580` compares against `'VCLand'`
 *     (`0x086d4276`) **or** `'Land'` (`0x086d4030`) for 0, `'VCSea'`
 *     (`0x086d427d`) or `'Sea'` (`0x086d427f`) for 1, `'VCAir'`
 *     (`0x086d4270`) or `'Air'` (`0x086f3538`) for 2 — and writes **3** for
 *     anything it does not recognise, which is the one value that would fall
 *     through the client's branch and keep the infantry map.
 *   * `AA_Enterprise`, the one template that declares no category at all, is
 *     **not** left on the infantry map: `PlayerControlObjectTemplate`'s own
 *     constructor seeds the field to 0 = VCLand (`mov DWORD [ebx+0x1dc],0x0`
 *     at lnxded `0x08319628` and `0x083198a8`; the accessor pair is
 *     `setVehicleCategory` `0x0831b940` / `getVehicleCategory` `0x0831b970`,
 *     both on `+0x1dc`). So **every** vanilla PCO selects the LandSea or the
 *     Air map, and nothing a player can sit in keeps the infantry one.
 *
 * At the shipped defaults `infantry` and `landSea` are the same number, so this
 * only actually bites in an aircraft — but the four knobs are separate and a
 * player who moves one should see it move.
 */
export function profileFor(vehicleCategory) {
  switch (vehicleCategory) {
    case 'air': case 'VCAir': case 2: return 'air';
    case 'land': case 'VCLand': case 0:
    case 'sea': case 'VCSea': case 1: return 'landSea';
    default: return 'infantry';      // on foot, and the one uncategorised PCO
  }
}

/** `scale = 5 x sensitivity + 0.1` (`0x006c5642` / `0x006c5648`). */
export function axisScale(sensitivity) {
  return SENSITIVITY_GAIN * sensitivity + SENSITIVITY_OFFSET;
}

// --- the wire format -------------------------------------------------------

/**
 * `dice::bf::floatToFixed(float, int, float)` — lnxded `0x08113480`, read
 * instruction by instruction:
 *
 *   `0x08113492 fdivrp`            v / range
 *   `0x08113494`-`0x081134a3`      clamp above at +1.0 (`fld1`)
 *   `0x081134a5`-`0x08113522`      clamp below at `ds:0x086b05ec` = -1.0f
 *   `0x081134b6 faddp`             + 1.0
 *   `0x081134b8 fld QWORD ds:0x086be450` = 0.5 (double), `fmulp`
 *   `0x081134d1`-`0x081134e6`      x ((1 << bits) - 1), as a 64-bit fild
 *   `0x081134f2`-`0x08113501`      `mov ah,0xc` / `fldcw` / `fistp` — the
 *                                  rounding mode is forced to **truncate**
 *
 * `bits == 32` takes the `0x08113515` arm and uses `0xffffffff` instead.
 */
export function floatToFixed(value, bits = AXIS_BITS, range = AXIS_RANGE) {
  let x = value / range;
  if (!(x === x)) x = 0;                 // the engine's fucom treats NaN as "<"
  if (x > 1) x = 1;
  else if (x < -1) x = -1;
  const steps = bits === 32 ? 0xffffffff : (1 << bits) - 1;
  return Math.trunc((x + 1) * 0.5 * steps);
}

/**
 * The other half, and the piece the corpus did not have:
 * `dice::bf::PlayerAction::get(PlayerInput&) const` lnxded `0x0815c5a0`, per
 * id (the first is `0x0815c5de`-`0x0815c632`, and the 55 blocks are identical):
 *
 *   `fild n` (a 16-bit word), `fdiv QWORD ds:0x086c0cf0` = **4095.0**,
 *   `fadd st,st(0)` (x2), `fsubrp` (-1.0), `fmul QWORD ds:0x086c0cf8` = **16.0**
 *   -> `v = ((2n / 4095) - 1) x 16`
 *   then `fmul ds:0x086b01ac` = **100.0f**, `frndint`, `fistp`, `fild`,
 *   `fdiv ds:0x086b01ac` -> **the value is snapped to a multiple of 0.01**.
 *
 * That trailing snap is load-bearing and is why this is not a half-LSB-biased
 * encoding: a packed zero is `n = 2047`, which decodes to `-0.00390625`, and
 * the `frndint` turns that back into exactly 0. Without it every idle turret in
 * the game would creep left at a tenth of a degree a second.
 *
 * `frndint` runs under the default control word (round to nearest, ties to
 * even) — `floatToFixed` restores the word it changed (`0x08113507 fldcw`),
 * and nothing else touches it.
 */
export function fixedToFloat(n, bits = AXIS_BITS, range = AXIS_RANGE) {
  const steps = bits === 32 ? 0xffffffff : (1 << bits) - 1;
  const v = ((2 * n) / steps - 1) * range;
  return rndint(v * DECODE_GRANULARITY) / DECODE_GRANULARITY;
}

/** x87 `frndint` under the default control word: nearest, ties to even. */
export function rndint(v) {
  const floor = Math.floor(v);
  const diff = v - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * One value's whole round trip through the wire format, which is what the
 * simulation actually reads.
 *
 * It applies to a LOCAL player too, not only across the network:
 * `GameClient::processLocalPlayersInputs` `0x00488840` copies the queued
 * `PlayerInput` (`0x00488913 rep movs`, 0xF0 bytes) and packs it at
 * `0x00488935` (`call 0x00483e70`, `floatToFixed(v, 12, 16.0f)` inlined), and
 * on the authority side `GameServer::simulatePlayerUpdate` `0x0815bd00` calls
 * `PlayerAction::get` at `0x0815bd5e` and `0x0815bf10` to turn it back into the
 * `PlayerInput` the player object is then handed.
 *
 * Consequences worth stating: the axis **saturates at +-16**, and the value the
 * simulation sees is always a multiple of **0.01**. At the shipped 0.25 that
 * ceiling is `16 / (0.001 x 1.35)` = about **11,852 counts a second**.
 */
export function quantiseAxis(value) {
  return fixedToFloat(floatToFixed(value));
}

// --- the stage itself ------------------------------------------------------

/**
 * Raw pointer motion in, engine-unit axis values out.
 *
 * Usage mirrors the engine exactly:
 *
 *   * `accumulate(dx, dy)` on every `mousemove` — it may be called any number
 *     of times between pumps, or none.
 *   * `pump(elapsedSeconds, profile)` **once per frame that will run at least
 *     one simulation tick**, with the time those ticks consume
 *     (`nTicks / 30`), not the wall-clock frame time. That is the engine's own
 *     argument (`InputManager::update` `0x0049cff7`) and it is what makes the
 *     total rotation per frame exactly proportional to the counts.
 *   * `x` / `y` every tick of that frame. They do not change between pumps.
 *
 * A frame that produces no tick simply does not pump, and its counts stay in
 * the accumulator for the next one — the engine's behaviour, and the reason a
 * 144 fps player loses nothing on the seven frames in ten that run no tick.
 */
export class MouseInput {
  constructor({
    countsPerPixel = 1.0,
    sensitivity = null,
    invertX = false,
    invertY = false,
  } = {}) {
    /** The single unproven unit. `?turret=` multiplies it. */
    this.countsPerPixel = countsPerPixel;
    this.sensitivity = { ...DEFAULT_SENSITIVITY, ...(sensitivity || {}) };
    /** The mapping's trailing flag (`AxisMapping+0x4c`); every shipped
     *  `addAxisToAxisMapping c_PIMouseLookX IDFMouse IDAxis_0 0` line ends in
     *  a 0, so both default to false. */
    this.invertX = !!invertX;
    this.invertY = !!invertY;
    this._pixelsX = 0;
    this._pixelsY = 0;
    this._x = 0;
    this._y = 0;
    /** Which profile the last pump used, for the HUD/console to report. */
    this.profile = 'infantry';
  }

  /** The axis value every tick of the current frame reads. */
  get x() { return this._x; }
  get y() { return this._y; }

  /** Un-pumped pointer travel, in pixels. Diagnostics only. */
  get pendingPixels() { return { x: this._pixelsX, y: this._pixelsY }; }

  /** The scale the given profile currently buys: `5 x s + 0.1`. */
  scaleFor(profile = this.profile) {
    return axisScale(this.sensitivityFor(profile));
  }

  sensitivityFor(profile) {
    const value = this.sensitivity[profile];
    return value === undefined ? DEFAULT_SENSITIVITY.infantry : value;
  }

  /**
   * `game.set*MouseSensitivity`. **No clamp**, because the engine has none:
   * `ControlSettings::setSensitivity` `0x006eb1a0` is
   *
   *     mov eax,[esp+0x4] ; mov [ecx+0xc],eax
   *     cmp [ecx+0x10],0xbf800000 ; jne ; mov [ecx+0x10],[esp+0x4]
   *
   * -- a bare store of whatever it was handed, plus a one-time seed of the
   * "saved" slot while it still holds the -1.0f sentinel. `game.
   * setInfMouseSensitivity 2` really does buy a scale of 10.1 in retail, and
   * a negative one really does invert the axis (`5 x s + 0.1` goes negative
   * below -0.02). 0..1 is the MENU SLIDER's range, not the word's, and an
   * earlier revision of this file clamped to it -- which is exactly the kind
   * of invented guard this round exists to remove. Non-finite input is
   * rejected, which is the JS console's own business, not the engine's.
   * Returns what took effect.
   */
  setSensitivity(profile, value) {
    if (!PROFILES.includes(profile)) return undefined;
    const v = Number(value);
    if (Number.isFinite(v)) this.sensitivity[profile] = v;
    return this.sensitivity[profile];
  }

  /** Browser pixels, in the browser's own sense: `dx` right, `dy` down —
   *  the same sense DirectInput's `lX`/`lY` carry. */
  accumulate(dx, dy) {
    if (Number.isFinite(dx)) this._pixelsX += dx;
    if (Number.isFinite(dy)) this._pixelsY += dy;
  }

  /**
   * A held stick or a touch pad, which has a deflection rather than a count.
   *
   * There is no engine reading behind this: BF1942's own pad support binds a
   * controller axis through the same `axisToAxis` arm, so a gamepad really does
   * arrive as counts. A touch pad has no counts at all, so the viewer's own
   * choice — stated, not transcribed — is that **full deflection is a hand
   * moving `pixelsPerSecond` pixels a second**, which keeps the pad in the same
   * currency as the mouse and lets one tuning knob move both.
   */
  accumulateDeflection(x, y, seconds, pixelsPerSecond) {
    const travel = pixelsPerSecond * Math.max(0, seconds);
    this.accumulate(x * travel, y * travel);
  }

  /**
   * One frame's conversion. `elapsedSeconds` is the time the frame's ticks
   * consume; `profile` names the sensitivity in force.
   *
   * `elapsedSeconds <= 0` reproduces the device's own gate (`0x00670034`): the
   * held value is left exactly as it is and the counts are kept, so a
   * zero-tick frame and a paused page both lose nothing.
   */
  pump(elapsedSeconds, profile = this.profile) {
    this.profile = PROFILES.includes(profile) ? profile : this.profile;
    if (!(elapsedSeconds > 0)) return { x: this._x, y: this._y };
    const scale = this.scaleFor(this.profile);
    const countsX = this._pixelsX * this.countsPerPixel;
    const countsY = this._pixelsY * this.countsPerPixel;
    this._pixelsX = 0;
    this._pixelsY = 0;
    const rateX = RATE_FACTOR * countsX * scale / elapsedSeconds;
    const rateY = RATE_FACTOR * countsY * scale / elapsedSeconds;
    this._x = quantiseAxis(this.invertX ? -rateX : rateX);
    this._y = quantiseAxis(this.invertY ? -rateY : rateY);
    return { x: this._x, y: this._y };
  }

  /** Drop everything — a mode switch, a lost pointer lock, a console opening.
   *  The engine does the same when it activates a different control map
   *  (`ControlMap::reset`). */
  reset() {
    this._pixelsX = 0;
    this._pixelsY = 0;
    this._x = 0;
    this._y = 0;
  }
}

// --- what the soldier does with it ----------------------------------------
//
// `BFSoldier::handlePlayerInput(IPlayer*, PlayerInput const&, float dt)`
// lnxded `0x08273c70`. `c_PIMouseLookX` is PlayerInput id **4** and
// `c_PIMouseLookY` id **5** (the name table at `0x086c86a5` runs c_PIYaw,
// c_PIPitch, c_PIRoll, c_PIThrottle, c_PIMouseLookX, c_PIMouseLookY, ... and
// `con.py` already resolves a bare `4` in `AA_Allies_RotatingCrank` to
// `c_PIMouseLookX`). The function copies the whole `PlayerInput` to
// `[ebp-0x118]`, so id N sits at `[ebp-0x118 + 4N]` and the presence mask is
// `[ebp-0x3c]`/`[ebp-0x38]`.
//
// **Pitch** (`0x0827451d`-`0x0827453d`):
//
//     fld [ebp-0x2a4]          ; c_PIMouseLookY
//     fmul [ebp+0x14]          ; x dt
//     fmul ds:0x8716b5c        ; x g_simulationFps = 30.0
//     fsubr [eax+0x284] ; fst [eax+0x284]
//
// then clamped against the template's `+0x18c` / `-(+0x190)` at `0x08274543`
// and `0x08275289` — the `ObjectTemplate.setPointUpDownAngle 38.0 38.0` pair,
// which is what fixes the unit: `+0x284` is **degrees**.
//
// **Yaw** (`0x082742fc`-`0x0827431a`, applied at `0x08274561`-`0x082745f1`):
//
//     fld [ebp-0x29c]          ; c_PIMouseLookX
//     fmul [ebp+0x14] ; fmul ds:0x8716b5c      ; x dt x 30
//     fst [ebp-0x2c8]          ; ...also accumulated into [eax+0x288]
//     ...
//     fmul ds:0x86c08c8        ; = 00 00 40 40 = 3.0
//     call dice::ref2::yaw<float>(Mat4&, float)   0x08061db0
//     call dice::ref2::world::setTransformation   0x08061690
//
// and `yaw` -> `rotateAboutLine` `0x08061e10` -> `setRotateAboutLine`
// `0x080621b0` -> **`rotateZDeg<float>` `0x080625f0`**, so that angle is
// degrees too.
//
// Between the two, `[ebp-0x2c8]` is multiplied by the animation state's own
// turn factor (`0x082744c3`), one of the three floats
// `AnimationState::checkTransitions` `0x0832a0f0` copies out of the state at
// `+0xc8`/`+0xcc`/`+0xd0` — all three default to **1.0f** in the ctor
// (`0x08328c30`-`0x08328c44`), so a standing soldier's factor is 1.
//
// Which of the three, and what the shipped states set them to, matters and is
// now read. The x87 block at `0x0827449f`-`0x082744df` pairs them off:
// `+0xc8` multiplies `c_PIThrottle`, **`+0xcc` multiplies this yaw delta**,
// `+0xd0` multiplies `c_PIYaw`. They are the three arguments of the .con word
// `AnimationStateMachine.setSpeed <throttle> <mouseLook> <yaw>`, and a sweep of
// vanilla `animations.rfa` + `Objects.rfa` (284 states, 83 `setSpeed` lines)
// says only these depart from `1 1 1`:
//
//     Lb_ClimbLadder*          1.0 / 0.7  0  0      (a ladder locks the look)
//     Lb_Hit{Back,Chest}*      0          1  0
//     Lb_Parachute*            0          1  0
//     Lb_*InVehicle, passenger 0          0  0
//     Lb_ExplosionFly*, deaths 0          0  0
//     Lb_RunStandToLie         6.0        1  1      (the dive-to-prone lunge)
//
// so **no crouched or prone state slows the turn** — every `AnimationStates
// Crouching.con` and `AnimationStatesLie.con` state is `1.0 1.0 1.0`. A viewer
// with no ladders and no parachutes therefore has nothing to model here, and
// modelling a prone turn penalty would be inventing one.
// (Only the FIRST of the soldier's two state machines applies its factors:
// `0x0827449b test esi,esi; jne 0x82744e5` skips the multiply on the second
// pass of the `esi = 0..1` loop.)
//
// Since the tick is fixed at `dt = 1/30` (LOOP-1), `dt x g_simulationFps` is
// exactly 1 and the law collapses to:
//
//     pitch -= input.y            degrees per tick, clamped to +-38
//     yaw   -= input.x x 3        degrees per tick
//
// **Horizontal look is three times vertical for the same hand.** That is the
// whole of the answer to "what does `LOOK_SENS = 0.0022` stand for": at the
// shipped sensitivity the engine's yaw works out at
// `0.001 x 1.35 x 3 x 30 = 0.1215` degrees per count, and 0.0022 rad is
// **0.12605** degrees per pixel — within 3.7%. Someone fitted that constant by
// feel and landed on the read law, which is also the best evidence anyone has
// that `countsPerPixel` really is about 1.
//
// Two more things scale the on-foot look before any of the above, both read
// out of the tail of the same function (gcc put the blocks at the end; they
// `jmp 0x08274266`, i.e. BEFORE the yaw and pitch maths):
//
//   * **Zoom.** `0x08275bdf call [eax+0x114]` asks the held FireArms whether
//     it is zoomed; if so `0x08275bf2`-`0x08275c11` multiplies BOTH
//     `c_PIMouseLookX` and `c_PIMouseLookY` by the weapon TEMPLATE's `+0x270`
//     — `ObjectTemplate.zoomFov`, per `FireArmsTemplate::makeScript`
//     `0x0828f0e2` (`+0x274` is `SoldierZoomFov`, `0x0828f0b0`, and is NOT
//     what scales the hand). `map.html`'s `stepSoldierLook` carries this.
//   * **Recoil.** When `BFSoldier+0x544` is non-zero, `0x08275c5f`-`0x08275c8a`
//     ADDS `BFSoldier::yawRecoil()` `0x0827e720` to `c_PIMouseLookX` and
//     `pitchRecoil()` `0x0827e7d0` to `c_PIMouseLookY`, once per queued count,
//     and decrements the counter — so in retail the recoil kick travels the
//     same path as the hand, through the same x3 yaw gain and the same +-38
//     pitch clamp. This viewer writes recoil straight into `soldier.look`
//     instead, which is a different shape with the same visible effect but
//     does not inherit the 3:1 asymmetry. UNMODELLED, deliberately.
//
// STILL OPEN, and the viewer deliberately implements only the tick's own
// rotation: `BFSoldier+0x288` is a second register the tick decrements
// (`0x08274314 fsubr` — the RAW delta, before the animation turn factor),
// clamped at `0x08274412`/`0x08275337` to `[-(template+0x188), +template+0x184]`
// = the `ObjectTemplate.setTurnLeftRightAngle 20.0 14.0` pair
// (`CommonSoldierData.inc:46`), each first scaled by the held weapon's
// `vt[+0xa4]`/`vt[+0xa8]` multipliers (`0x082754ba`-`0x082754e3`) or by 0.6
// (`ds:0x86c4f68`) for one weapon class. A second site
// (`0x08274629`-`0x082746c5`, reached when `c_PIYaw != 0` or `c_PIThrottle
// != 0` — i.e. whenever the soldier is MOVING) rotates by `-3.0 x that`
// (`ds:0x086d26fc`) and zeroes it.
//
// What this round settled, and what it did not:
//
//   * The "two views of one quantity" reading is WRONG. Both sites fetch the
//     matrix from `this->queryInterface(ds:0x86c2a58)->vt[+0x74]()` and write
//     it back through `world::setTransformation` `0x08061690`, which resolves
//     the SAME interface (`0x080616a1` loads the same `ds:0x86c2a58`) and
//     calls its `vt[+0x78]` — the setter paired with that getter. So the two
//     rotations land on one matrix and, read literally, COMPOUND.
//   * Read literally, a moving soldier would therefore turn about twice as
//     fast per tick as a standing one, and the standing-to-moving transition
//     would snap the view by up to `3 x 20` = 60 degrees. Neither is what the
//     retail game does, so something outside this function must neutralise
//     one of them (a deferred/queued `setTransformation`, or a later pass
//     re-deriving the transform) and that was not found.
//   * `+0x288` is definitely ALSO a pose quantity: `BFSoldier::handleUpdate`
//     `0x08271f86`-`0x08271f97` builds `setRotateYDeg(-3.0 x +0x288)` beside
//     `setRotateXDeg(-2.5 x +0x284)` (`ds:0x86d2700` = -2.5), and
//     `BFSoldier::updateAnimations` `0x0826e67e` feeds it (negated) to the
//     aim-pose blend. The `setTurnLeftRightAngle` bound is the torso-twist
//     limit it reads like.
//
// Until that is closed, "the tick's own rotation only" is the conservative
// half: it is exactly right for a standing soldier and, if the literal reading
// holds, up to 2x slow for a walking one. Do not "fix" it by doubling on the
// strength of this comment.

/** `3.0`, `ds:0x086c08c8`, `BFSoldier::handlePlayerInput` `0x0827457d`. */
export const SOLDIER_YAW_GAIN = 3.0;
/** The pitch has no gain of its own: `0x08274537` subtracts the value as it
 *  stands. Named so the asymmetry is impossible to miss. */
export const SOLDIER_PITCH_GAIN = 1.0;

/** Degrees of yaw and pitch one tick of the given axis pair asks for. */
export function soldierLookDegrees(x, y, turnFactor = 1) {
  return {
    yaw: x * SOLDIER_YAW_GAIN * turnFactor,
    pitch: y * SOLDIER_PITCH_GAIN,
  };
}
