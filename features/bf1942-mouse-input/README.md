# The mouse-look input stage

Wave-3 stream W3-G, 2026-09-20. Built on the W3-F research pair (LOOP-1 and
GUN-2b), where the verifier's reading is the binding one.

Before this, everything between a pointer-lock pixel and a gun's traverse was
invented. `viewer/map.html` turned a soldier's head at `LOOK_SENS = 0.0022`
radians per pixel, a number fitted by feel; `viewer/seats.js` turned that into
degrees with `TURRET_DEGREES_PER_PIXEL`, normalised the result into +-1 against
a ceiling, and multiplied every gun's declared `setMaxSpeed` by
`TURRET_SPEED_SCALE = 4` to make the outcome feel right. None of the three had
a citation, and the normalisation had a side effect nobody had noticed: every
hand faster than the ceiling aimed at exactly the same rate.

All three are gone. The engine's own law is now in one module.

## What the engine does

```
PlayerInput[c_PIMouseLookX] = 0.001 x (mouse counts per second) x (5 x s + 0.1)
```

**It is a rate, not a per-frame count.** It is computed once per pumped frame
over the time that frame's ticks consume, and *every* simulation tick of that
frame reads the same value. A frame that owes no tick does not pump at all and
its counts wait for the next one. Then the value is clamped to +-16 and
quantised to twelve bits on the way into the simulation -- for a local player
as much as across the network.

The addresses are in `tools/bf1942-models/viewer/mouse-input.js`'s own header,
which is written to be re-derived. The short version:

| piece | where |
|---|---|
| `0.001`, the rate factor, and the `/ dt` beside it | client `InputDeviceManager.DX8`'s mouse `update(float)` `0x0066ffe0`, at `0x0067004e` and `0x00670046` |
| the `dt > 0` gate that holds the value for ticks 2..N | `0x00670028`-`0x00670037` |
| `5.0` and `0.1` | `applyMouseSensitivity` `0x006c55f0`, at `0x006c5642` / `0x006c5648` |
| one pump per frame, with `nTicks x tickDt` | `InputManager::update` `0x0049ce70`, at `0x0049cff7` |
| the fixed 30 Hz tick itself | `g_simulationFps` lnxded `0x08716b5c` = 30.0; `Setup+0xcc` / client `Setup+0x184` |
| `floatToFixed(v, 12, 16.0f)` | lnxded `0x08113480`, called from `PlayerAction::set` `0x081128a0` |
| the decode, **which this round read for the first time** | `PlayerAction::get` lnxded `0x0815c5a0` |
| the soldier's own look law | `BFSoldier::handlePlayerInput` lnxded `0x08273c70` |

### Two things the corpus did not have

**The decode has a second quantisation, and it matters.**
`PlayerAction::get` turns the packed word back into
`((2n / 4095) - 1) x 16` (`ds:0x086c0cf0` = 4095.0, `ds:0x086c0cf8` = 16.0)
and then snaps it with `frndint(v x 100) / 100` (`ds:0x086b01ac` = 100.0f,
`0x0815c611` / `0x0815c62b`). Without that snap the format would be biased: a
packed zero is `n = 2047`, which decodes raw to `-0.0039072`, and every idle
turret in the game would creep at 0.137 deg/s. With it, zero comes back as
zero and everything the simulation reads is a multiple of **0.01**.
`GameServer::simulatePlayerUpdate` `0x0815bd00` is what calls it
(`0x0815bd5e`, `0x0815bf10`), so this is the value the authority runs on.

**Which sensitivity profile a seat uses is not in the Controls `.con` files.**
Those only declare the maps: `defaultPlayerInputControlMap` (Infantry.con),
`LandSeaPlayerInputControlMap` (Land.con), `AirPlayerInputControlMap`
(Air.con) and `defaultGameControlMap` (Common.con). The client picks one on
entry from the PCO's own `getVehicleCategory()` -- `pco->vtable[+0x78]` at
`0x006d78a5`, then `0x006d78aa`/`0x006d78b6` (`== 0` or `== 1`) push the
LandSea map and `0x006d78c2` (`== 2`) pushes the Air one; anything else falls
through at `0x006d78da` **without changing the map**, leaving the soldier's own
active. The enum is lnxded `operator<<(ostream&, VehicleCategory)`
`0x0829b530`: 0 VCLand, 1 VCSea, 2 VCAir.

A survey of vanilla `Objects.rfa` (121 of 122 `PlayerControlObject` templates
declare a category) settles what that means:

* Every stationary weapon is **VCLand** -- `Defgun`, `Stationary_Browning`,
  `Stationary_mg42`, `flak38`, `AA_Allies`. So is every gunner position,
  **including an aircraft's**: `B17_PCO1`, `StukaRearGunControl`,
  `AichiValRearGunControl` and the rest. A bomber's tail gunner aims on the
  LandSea profile while the pilot a metre away is on Air.
* Only the 13 aircraft *pilot* PCOs are VCAir.
* Ships are VCSea, which selects the same LandSea map.
* `AA_Enterprise` is the one template with no category -- but it still gets
  **VCLand**, not the infantry map: `PlayerControlObjectTemplate`'s own
  constructor seeds the field to 0 (`mov DWORD [ebx+0x1dc],0x0` at lnxded
  `0x08319628` and `0x083198a8`; the accessors are `setVehicleCategory`
  `0x0831b940` / `getVehicleCategory` `0x0831b970`, both on `+0x1dc`). So
  **every** vanilla PCO selects LandSea or Air and nothing a player can sit in
  keeps the infantry map. [corrected by the review, 2026-09-20]
* Ten of the 121 use the **unprefixed** spelling and the engine accepts it:
  `AA_Allies` declares `setVehicleCategory Land`, and nine Daihatsu/Lcvp/PTRaft
  passenger PCOs declare `Sea`. `operator>>(istream&, VehicleCategory&)` lnxded
  `0x0829b580` compares against `'VCLand'` (`0x086d4276`) **or** `'Land'`
  (`0x086d4030`) for 0, `'VCSea'` (`0x086d427d`) or `'Sea'` (`0x086d427f`) for
  1, `'VCAir'` (`0x086d4270`) or `'Air'` (`0x086f3538`) for 2, and writes
  **3** for anything else -- 3 being the one value that falls through the
  client's branch and leaves the infantry map in place.

Shipped sensitivities, read out of `Mods/bf1942/Settings/Default/Controls/`:
`Common.con:42` 0.25, `Infantry.con:28` 0.25, `Land.con:22` 0.25,
`Air.con:27` **0.75**. So the axis scale is 1.35 everywhere but an aircraft
cockpit, which is 3.85.

## What was built

### `viewer/mouse-input.js` (new)

Pure, no `three` import, unit-testable under node. It holds the constants with
their addresses, the wire format (`floatToFixed` / `fixedToFloat` /
`quantiseAxis`), the profile table and selection rule, and one class:

```js
const mouse = new MouseInput();        // countsPerPixel 1.0, shipped defaults
mouse.accumulate(e.movementX, e.movementY);   // any number of times per frame
mouse.pump(nTicks / 30, 'landSea');           // once per frame that will tick
mouse.x; mouse.y;                             // read by every tick of it
```

`pump` with a non-positive elapsed time reproduces the device's own gate: the
held value is left alone and the counts are kept.

It also carries `soldierLookDegrees(x, y)` and the two gains behind it.

### `viewer/seats.js`

`TURRET_SPEED_SCALE`, `TURRET_DEGREES_PER_PIXEL`, `setTurretSpeedScale`,
`turretSpeedScale` and `TurretAxis.feed` are deleted. `TurretAxis.setInput`
takes the engine's own axis value and **holds** it -- `step` no longer consumes
it, because the engine hands the same number to every tick of a frame.
`TurretRig.aim(x, y)` sets the pair (and zeroes it for a wreck, since a held
value would otherwise spin the gun forever). The servo is untouched except that
neither `maxSpeed` nor `acceleration` is scaled by anything any more, and the
saturating +-1 normalisation is gone: an input above 1 really does command more
than `setMaxSpeed`, up to the wire's +-16, exactly as the engine's does.

HP-15's 0.2 is still spent exactly once, in `step`, on the value entering the
servo -- which is where the engine spends it
(`RotationalBundle::handlePlayerInput` `0x081d834f`, `ds:0x86c8678`).

### `viewer/map.html`

The page steps everything else on the render dt (the soldier body has its own
60 Hz accumulator in `physics.js`, the drivetrain its own in `ground.js`).
Only the look path was moved onto the engine's tick, because a page-wide fixed
step is a bigger change than one stream should make while four others are
editing this file. The new block is next to `lookDelta`:

* `simTicks(dt)` -- the whole-tick accumulator, with the engine's backlog gate
  (above nine, collapse to one and drop the rest; never stretch `dt`).
* `lookProfile()` -- infantry on foot, air in an aircraft's own pilot seat,
  landSea everywhere else, which is what the `setVehicleCategory` survey says.
* `pumpLook(dt)` -- pumps with `nTicks / 30` and resets the stage when the
  profile changes, then returns the ticks the caller owes.
* `stepTurret(dt)` -- pump, `aim()` once, then `step(1/30)` per tick.
* `stepSoldierLook(ticks)` -- the on-foot law, with the zoom factor, which is
  the weapon's **`zoomFov`** (`FireArmsTemplate+0x270`, read at
  `0x08275bf2`-`0x08275c11`), NOT `SoldierZoomFov` (`+0x274`). The two are
  different .con properties with different shipped values -- a K98 is
  `zoomFov 0.4 / soldierZoomFov 0.6`, a Colt `0.7 / 0.5` -- and the first
  revision used the wrong one. [corrected 2026-09-20]

`lookDelta` now only accumulates for those two branches; the free-fly camera
and `VehicleCamera` paths are unchanged (they are debug surfaces with no engine
equivalent, and `LOOK_SENS` survives for the free camera alone).

The touch pad feeds the same stage. A pad has a deflection, not a count rate,
and the engine has nothing to transcribe here, so the viewer's own choice --
stated in `feedMobileTurretAim` -- is that **full deflection is a hand moving
`MOBILE_AIM_PIXELS_PER_SECOND` (720) pixels a second**. That keeps the pad in
the same currency as the mouse, so the profiles, the +-16 saturation and
`countsPerPixel` all reach it unchanged.

### The console

`game.setCommonMouseSensitivity`, `game.setInfMouseSensitivity`,
`game.setLandSeaMouseSensitivity` and `game.setAirMouseSensitivity` are
registered, one float argument, **unclamped**, read-back with no argument.
0..1 is the menu slider's range, not the word's: `ControlSettings::
setSensitivity` `0x006eb1a0` is `mov eax,[esp+0x4]; mov [ecx+0xc],eax` plus a
one-time seed of the saved slot at `+0x10` while it holds the `-1.0f`
sentinel, with no clamp anywhere on the path, so `2` really does buy a scale
of 10.1 and a negative value really does invert the axis. An earlier revision
clamped to 0..1; the review removed it. [corrected 2026-09-20] They are the engine's own words: they are what the shipped Controls
`.con` files call, and they are in the retail client's `game` method table
(registrar `FUN_006bba90`, body at vtable `+0x48` = `0x006bbbe0` ->
`0x006c57f0` -> `ControlSettings::setSensitivity` `0x006eb1a0`).

`game.setCommonMouseSensitivity` is registered for completeness and is
genuinely inert: the Common profile belongs to `defaultGameControlMap`, which
binds `c_GIMouseLookX/Y` -- the menu and map cursor -- and this page has no
surface that reads it.

## The soldier's look law

Read this round, with addresses, and built.

`BFSoldier::handlePlayerInput` (lnxded `0x08273c70`) copies the `PlayerInput`
to `[ebp-0x118]`, so id N sits at `[ebp-0x118 + 4N]`; `c_PIMouseLookX` is id 4
and `c_PIMouseLookY` id 5 (the name table at `0x086c86a5`, which is also what
makes `con.py`'s bare `4` in `AA_Allies_RotatingCrank` mean MouseLookX).

**Pitch**, `0x0827451d`-`0x0827453d`:

```
fld [ebp-0x2a4]       ; c_PIMouseLookY
fmul [ebp+0x14]       ; x dt
fmul ds:0x8716b5c     ; x g_simulationFps = 30.0
fsubr [eax+0x284] ; fst [eax+0x284]
```

clamped at `0x08274543` and `0x08275289` against the template's `+0x18c` and
`-(+0x190)` -- the `setPointUpDownAngle 38.0 38.0` pair. That is what fixes the
unit: `+0x284` is **degrees**.

**Yaw**, `0x082742fc`-`0x0827431a`, applied at `0x08274561`-`0x082745f1`:
the same `x dt x 30`, then the animation state's own turn factor
(`0x082744c3`; `AnimationState::checkTransitions` `0x0832a0f0` copies it out of
the state at `+0xcc`, and the ctor defaults all three factors to 1.0f at
`0x08328c30`), then

```
fmul ds:0x86c08c8     ; = 00 00 40 40 = 3.0
call dice::ref2::yaw<float>(Mat4&, float)   0x08061db0
```

and `yaw` -> `rotateAboutLine` `0x08061e10` -> `setRotateAboutLine` `0x080621b0`
-> **`rotateZDeg<float>` `0x080625f0`**, so that angle is degrees too.

Since the tick is fixed at `dt = 1/30`, `dt x g_simulationFps` is exactly 1 and
the law collapses to:

```
pitch -= input.y           degrees per tick, clamped to +-38
yaw   -= input.x x 3       degrees per tick
```

**Horizontal look is three times vertical for the same hand.** The viewer had
them equal.

At the shipped 0.25 that is `0.001 x 1.35 x 3 x 30` = **0.1215 degrees of yaw
per count** and 0.0405 in pitch. The `LOOK_SENS = 0.0022` rad/px it replaces
comes to **0.12605** degrees per pixel -- 3.7% away. Someone fitted that
constant by feel and landed on the read law, which is also the best evidence
anyone has that one browser pixel is about one mouse count.

**Still open, and deliberately not modelled.** `BFSoldier+0x288` is not only
the tick's yaw: the tick decrements it with the RAW delta (`0x08274314`,
before the animation turn factor), and a second site
(`0x08274629`-`0x082746c5`, reached when `c_PIYaw != 0` or `c_PIThrottle != 0`
-- i.e. whenever the soldier is MOVING) applies it with the matching `-3.0`
(`ds:0x086d26fc`) and zeroes it.

The review re-read it and moved it on, without closing it:

* The bound is not "built from 0.6 and 18.0". It is
  `[-(template+0x188), +template+0x184]` -- the
  `ObjectTemplate.setTurnLeftRightAngle 20.0 14.0` pair from
  `Objects/Soldiers/Common/CommonSoldierData.inc:46` -- each first multiplied
  by the held weapon's `vt[+0xa4]`/`vt[+0xa8]` (`0x082754ba`-`0x082754e3`), or
  by 0.6 for one weapon class. The 18.0 is the default of a *third*
  accumulator, `+0x290`, which takes twice the yaw delta and decays.
* The "two views of one quantity" hedge is **wrong**. Both sites fetch the
  matrix from `this->queryInterface(ds:0x86c2a58)->vt[+0x74]()` and write it
  back through `world::setTransformation` `0x08061690`, which resolves the
  same interface (`0x080616a1` loads the same `ds:0x86c2a58`) and calls its
  `vt[+0x78]` -- the setter paired with that getter. Read literally the two
  rotations therefore COMPOUND on one matrix: a moving soldier would turn
  about twice as fast per tick, and the standing-to-moving transition would
  snap the view by up to `3 x 20` = 60 degrees.
* Neither is what the retail game does, so something outside this function
  neutralises one of them, and the review did not find it.
* `+0x288` is definitely also a pose quantity: `BFSoldier::handleUpdate`
  `0x08271f86`-`0x08271f97` builds `setRotateYDeg(-3.0 x +0x288)` beside
  `setRotateXDeg(-2.5 x +0x284)` (`ds:0x86d2700` = -2.5), and
  `updateAnimations` `0x0826e67e` feeds it negated into the aim-pose blend.

The viewer implements the tick's own rotation only, which is exactly right for
a standing soldier and, if the literal reading holds, up to 2x slow for a
walking one. Do not change that on the strength of this paragraph.

**Nothing in vanilla slows a crouched or prone turn.** The animation state's
turn factor that multiplies the yaw delta is `+0xcc`, the **second** argument
of `AnimationStateMachine.setSpeed <throttle> <mouseLook> <yaw>` (the pairing
is `0x0827449f`-`0x082744df`; only the first of the soldier's two state
machines applies its factors -- `0x0827449b test esi,esi; jne`). Across 284
vanilla states and 83 `setSpeed` lines the only departures from `1 1 1` are
ladders (`1.0/0.7 0 0`), hit reactions and parachutes (`0 1 0`), vehicle and
death states (`0 0 0`) and the dive-to-prone lunge `Lb_RunStandToLie`
(`6.0 1.0 1.0`). Every `AnimationStatesCrouching.con` and
`AnimationStatesLie.con` state is `1.0 1.0 1.0`.

**Recoil takes the same path in retail.** When `BFSoldier+0x544` is non-zero,
`0x08275c5f`-`0x08275c8a` ADDS `yawRecoil()` `0x0827e720` to `c_PIMouseLookX`
and `pitchRecoil()` `0x0827e7d0` to `c_PIMouseLookY` before the law runs, so
the kick inherits the x3 yaw gain and the +-38 pitch clamp. This viewer writes
recoil straight into `soldier.look` instead. Unmodelled, deliberately.

Aircraft stick input (`viewer/flight.js`) is untouched and is not a one-line
consequence: `Air.con` binds the mouse to `c_PIPitch` and `c_PIRoll`, not to
the mouse-look axes, so those go through the same rate formula (on the Air
profile, scale 3.85) into a completely different consumer -- the flight model's
own control surfaces. Wiring it would mean reading what `Airplane`/`Wing` do
with `c_PIPitch`, which nobody has.

## The one unproven unit

**That one browser `movementX` pixel is one DirectInput count.** Nothing in
either binary can settle it: it is a property of the mouse and of Chromium's
pointer-lock plumbing. It is the single tunable, `countsPerPixel`, default 1.0.

* `?turret=<n>` multiplies it (the same query parameter as before -- it used to
  scale `setMaxSpeed`, and has moved to the quantity that is actually open).
* `window.__turretScale()` reads and writes it live.
* `window.__mouseLook()` and `window.__mouseLook(dx, dy)` expose and drive the
  whole stage for a headless check.

Turn it up and everything aims faster, including the soldier's head, which is
correct: a mouse count is a mouse count.

## What a player should feel

Degrees per second, for the same hand, before and after. "Before" is
`maxSpeed x 4` as a ceiling with the ask saturating into it; "after" is
`0.001 x counts/s x 1.35 x maxSpeed`.

| hand | Sherman tower (`setMaxSpeed 35`) | MG42 (`setMaxSpeed 70`) |
|---|---|---|
| 500 px/s | 63 -> **23.6** | 63 -> **47.3** |
| 2000 px/s | 140 (at the old ceiling) -> **94.5** | 252 -> **189** |
| 4000 px/s | 140 -> **189** | 280 -> **378** |

Read it as three separate changes:

1. **Slow, careful aiming is much slower**, because the old model gave a slow
   hand the same degrees it gave the soldier's head and only the ceiling made a
   turret heavier. A Sherman tower at a gentle 500 px/s now traverses at 23.6
   deg/s instead of 63 -- a shade under a third. That is the change a player
   will notice first, and it is the one the engine's own numbers demand:
   `setMaxSpeed 35` really is 35 degrees a second per unit of input.
2. **Fast flicks are no longer capped.** The old ceiling was `maxSpeed x 4`
   and a hand faster than it bought nothing. Now a 4000 px/s flick genuinely
   asks for 189 deg/s on a Sherman and gets it, subject only to the axis's own
   `setAcceleration` and the wire's +-16 (about 11,852 counts a second, which
   is a hand no one has).
3. **Heavy guns feel heavy and light guns feel light.** The ratio between a
   Sherman tower and an MG42 was always 2:1 in the data, but the old
   saturating clamp flattened it for exactly the fast hands a fight produces.

On foot, the yaw is within 4% of what it was and the **pitch is three times
slower**, which is the retail asymmetry the viewer never had.

None of this is fps-dependent any more, in either direction: the same hand
movement turns the same amount at 30, 60 and 144 frames a second, and through
a 200 ms stall.

### The review's own table, with the pitch split out

Measured, not derived: `tests/` harness driving the real `MouseInput` and the
real `TurretAxis` (script in `.../scratchpad/r3g/hw/feel2.mjs`). "Old" is
`min(0.12605 x px/s, 4 x maxSpeed)` for a turret and a flat 0.12605 deg/px on
foot; "new" is `axis x maxSpeed` with `axis = quantise(0.001 x px/s x 1.35)`.

| hand | axis | on foot yaw | on foot pitch | Sherman 35 | MG42 70 | Defgun 90 |
|---|---|---|---|---|---|---|
| 300 px/s | 0.40 | 37.8 -> **36.0** | 37.8 -> **12.0** | 37.8 -> **14.0** | 37.8 -> **28.0** | 37.8 -> **36.0** |
| 1000 px/s | 1.35 | 126.1 -> **121.5** | 126.1 -> **40.5** | 126.1 -> **47.3** | 126.1 -> **94.5** | 126.1 -> **121.5** |
| 3000 px/s | 4.04 | 378.2 -> **363.6** | 378.2 -> **121.2** | 140 -> **141.4** | 280 -> **282.8** | 360 -> **363.6** |

Three things change by more than 2x, and only one of them is a judgement call:

* **On-foot pitch, 3.1x slower at every hand.** The evidence is the strongest
  in the whole stream -- the `x3.0` is a single `fmul ds:0x86c08c8` on the yaw
  path only, and the pitch's own unit is fixed by the `setPointUpDownAngle
  38.0 38.0` clamp it is compared against. Ship it.
* **A Sherman tower, 2.7x slower at ordinary hand speeds.** Also solid:
  `setMaxSpeed 35` is 35 deg/s per unit of input, and 1000 counts a second is
  1.35 units. Ship it.
* **The Defgun's wind-up, 4x slower.** Not in the table, because it is not a
  steady-state number: the old model scaled `setAcceleration` by the same 4 it
  scaled `maxSpeed` by, so a Defgun (`setMaxSpeed 90 / setAcceleration 50`)
  used to ramp at 200 deg/s^2 and now ramps at 50. Its *steady* rate barely
  moves (36.0 against 37.8 at 300 px/s -- a coincidence, `0.001 x 1.35 x 90` =
  0.1215 is almost exactly the old `0.12605` deg/px) but it takes four times
  as long to get there, and a Defgun is the gun a player will most notice it
  on. The engine's number is the engine's number; flag it, do not scale it.

On the unproven unit: the 3.7% agreement between the new on-foot yaw
(0.1215 deg/count) and the old hand-fitted `LOOK_SENS` (0.12605 deg/px) is
**weak** evidence for `countsPerPixel = 1`, and the review's confidence is low.
`LOOK_SENS` was fitted on foot, where the old model was isotropic, so it was
fitted against a law that was wrong in one of its two axes; landing within 4%
of the yaw half of the right law is as consistent with "the fitter matched the
horizontal feel of a 400-800 dpi mouse" as with "one pixel is one count". Two
other numbers land in the same place by construction (a Defgun's 0.1215, a
Stationary_Browning's 0.1215) because `maxSpeed 90` and `3 x 30` are both 90,
which is a coincidence of the data, not corroboration. Treat 1.0 as a starting
point to be set by playing, exactly as the stream says -- not as evidence.

## Tuning it

* By playing: `?turret=1.4`, or `window.__turretScale(1.4)` live. It moves
  everything at once, which is the point -- it is a unit conversion, not a feel
  knob.
* By profile: `game.setInfMouseSensitivity 0.4` in the console, or
  `setLandSeaMouseSensitivity` / `setAirMouseSensitivity`. The scale it buys is
  `5 x s + 0.1`. 0..1 is the menu slider's range; the word itself does not
  clamp, because the engine's does not.
* Do **not** reintroduce a per-turret multiplier. `setMaxSpeed` and
  `setAcceleration` are now used as the engine uses them; if a gun feels wrong,
  the extract is wrong or `countsPerPixel` is.

## Tests

`tools/bf1942-models/tests/test_mouse_input.py` + `mouse_input_harness.mjs`
(36 tests), plus the reworked turret block in `test_seats.py` /
`test_seats_harness.mjs`. Run with
`cd tools/bf1942-models && python3 -m unittest discover -s tests`.

What they pin:

* every constant, against the address it was read at;
* the formula, and that the Air profile is 3.85 while the rest are 1.35;
* the wire's `+-16` saturation, at about 11,852 counts a second;
* that a packed zero decodes back to exactly zero (the half-LSB trap), and that
  everything the simulation reads is a multiple of 0.01;
* the same hand turning a turret the same amount at 30, 60 and 144 fps and
  through a deliberately vile slicing of uneven frames -- to within 1%, which
  is the wire's own truncation bias and not the loop's;
* zero-tick frames losing nothing, and a `dt <= 0` pump leaving the registers
  alone;
* a Sherman tower commanded at 47.25 deg/s for 1000 counts a second, an MG42
  at 94.5, and an input above 1 really exceeding `setMaxSpeed`;
* the soldier's 3:1 yaw-to-pitch, and that it lands within 4% of the constant
  it replaces;
* HP-15's 0.2 spent exactly once, whatever the hand is doing.

## Verified on the page

Served from the worktree, `map.html?map=Wake&shots`, Playwright with
SwiftShader, stepping `__renderOnce` (which runs exactly `frame(1/60)`).

* **On foot**, 1200 counts over 60 stepped frames (one second, 30 ticks):
  yaw moved **144.9 degrees** and the pitch stopped at **exactly 38.00
  degrees**, the `setPointUpDownAngle` clamp. The nominal yaw is
  `1200 x 0.1215` = 145.8; the 0.6% gap is the wire's truncation (the axis
  value reads 1.61 where the unquantised rate is 1.62), which is the engine's
  own behaviour.
* **In a Defgun**, the same hand: profile `landSea` (correct -- the Defgun
  declares `setVehicleCategory VCLand`), axis 1.61, and the turret traversed
  **25.8333 degrees** in the second. The Defgun's turret is
  `setMaxSpeed 90 / setAcceleration 50`, so at 50 deg/s^2 it is still winding
  up after a second, and the discrete servo's exact answer is
  `(50/900) x 30 x 31 / 2` = **25.83333**. It matched to five decimals.
* The four console words are registered and dispatch:
  `game.setAirMouseSensitivity 0.5` moves the Air profile and reads back.
* `window.__turretScale(2.5)` takes effect and restores.
* No page errors.

## What the adversarial review changed (2026-09-20)

Second reader, re-derived from the binaries and the shipped data rather than
from this document. Verdict: the engine claims hold; two code defects and
three factual errors were fixed on the branch.

**Confirmed, independently:** `c_PIMouseLookX` = id 4 / `c_PIMouseLookY` = id 5
(mask bits 4 and 5 at `0x08273e3c`/`0x08273e6b` into `[ebp-0x29c]`/`[ebp-0x2a4]`);
both `x dt` and `x g_simulationFps` on both axes; `ds:0x086c08c8` = bytes
`00 00 40 40` = 3.0 used at `0x0827457d` (the same pool slot another stream read
as the prone divisor -- the same float, and really used here); degrees, because
`setRotateZDeg` `0x08062740` multiplies by `ds:0x086b1ca4` = 0.0174533; the
`+0x18c` clamp compared against the same register the pitch was just stored to
(`0x0827453d fst` then `0x0827454b fucomp`), and `setPointUpDownAngle 38.0 38.0`
is the only such line in vanilla. `PlayerAction::get`'s `frndint(v x 100)/100`
snap and `floatToFixed`'s forced-truncate `fldcw 0x0c00`: both confirmed byte
for byte, and the viewer reproduces encode and decode exactly, negatives
included -- after the `+1.0` shift the `fistp` argument is never negative, so
truncate-toward-zero and floor are the same thing, and the resulting
one-step negative bias (`q(v) + q(-v) = -0.01`) is the engine's, faithfully
kept. The client's control-map branch at `0x006d78a5` and the strings at
`0x00922500`/`0x00922520`: confirmed. A re-run of the `Objects.rfa` survey:
122 PCOs, 58 VCLand + 1 Land, 40 VCSea + 9 Sea, 13 VCAir, 1 undeclared.

**Code defects fixed:**

1. The look stage was pumped only when `driving`/`flying`, which are
   `isActiveRoot() && !blocked`. A wrecked hull's own driver therefore pumped
   nothing: measured on the page, a destroyed Sherman's driver banked
   `pendingPixels.x = 1200` over 60 frames and the axis stayed at 0. Now gated
   on the seat instead, which is exactly the case `manned()` declines, so there
   is still one pump a frame; the same run now reads `pendingPixels = 0`,
   `axis = 1.61`, `traverse = 0` (HP-15 still honoured inside `TurretRig.aim`).
2. `stepSoldierLook` scaled the zoomed hand by `SoldierZoomFov`. The authority
   scales it by `zoomFov` (`FireArmsTemplate+0x270`, `0x08275bf2`). A scoped
   K98 aimed 50% too fast, a sighted Colt 29% too slow.
3. The console words clamped to 0..1. `ControlSettings::setSensitivity`
   `0x006eb1a0` does not clamp at all. Removed; verified live through the real
   console (`game.setAirMouseSensitivity 2` now sticks at 2).

**Page checks re-run on this branch** (`map.html?map=Wake&shots`, SwiftShader,
stepping `__renderOnce`): on foot, 1200 counts over 60 frames moved yaw
**-144.90 degrees** and stopped pitch at **-38.00**; a 12-frame pitch-only run
gave **-12.12 degrees** against a yaw-only run's **-36.36** -- the 3:1
asymmetry, measured; `?turret=2.5` reaches `countsPerPixel`; a Sherman tower
traversed **55.58 degrees** in the second at axis 1.61 (`1.61 x 35` = 56.35
steady, less the 1000 deg/s^2 ramp); no page errors anywhere.

**FPS invariance, measured over 20 s** at 1000 px/s: on-foot yaw 121.50 deg/s
at 30, 60 and 240 fps, 120.60 at 75, 120.90 at 100, 120.79 at 144, and 121.15
through 494 randomly sliced frames -- a 0.6% spread, all of it the wire's own
truncation. A 5 s stall cannot burst: the page clamps its own frame dt to 0.1 s
(`renderer.setAnimationLoop(() => frame(Math.min(clock.getDelta(), 0.1)))`) and
`simTicks` collapses a backlog above nine to a single tick, and the worst a
single tick can do is the wire's +-16, i.e. 48 degrees of yaw.

**Still open** (see the `+0x288` section above), and one thing that is not a
defect but is worth knowing: on a touch device the joystick pad aims a turret
but has never aimed an on-foot soldier -- `feedMobileTurretAim` returns unless
`occupancy?.turret` exists, and on foot the pad drives movement instead. That
predates this stream.
