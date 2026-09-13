# BF1942 player input and cockpit view — reference

How Refractor maps player input to vehicle parts and how the first-person view is
assembled, researched for a flyable first-person plane in the map viewer. Focus
vehicle: the Corsair (US fighter, Wake). Every claim is grounded in files read from
the vanilla install (`~/.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/`) or in
this repo, and is tagged `confirmed` (read directly from data / already proven by our
runtime), `strong inference` (data pattern admits one sensible reading), or
`speculative`.

Survey method (repo convention: measure before you decompile): scripts in the session
scratchpad parsed all 1,751 `.con` files inside vanilla `Objects.rfa` (plus `ai.rfa`
and the `Settings/` control maps), `beginrem`/`endrem`-aware. 526 raw
`setInput*` lines; 6 of them (the SBD pilot-hatch block) are inside `beginrem` and
dead. Ghidra was not opened; nothing here needed it.

---

## 1. The `c_PI*` player-input enum

### 1a. Constants used as *part inputs* in vanilla `Objects.rfa` (all vehicle classes)

| constant | axis uses | on template types | vehicle classes |
|---|---|---|---|
| `c_PIMouseLookX` | 114 | Camera 61, RotationalBundle 53 | land 49, sea 41, air 24 |
| `c_PIMouseLookY` | 114 | Camera 59, RotationalBundle 55 | land 47, sea 42, air 25 |
| `c_PIYaw` | 97 | Wing 41, RotationalBundle 42, Engine 14 | land 39, sea 31, air 27 |
| `c_PIThrottle` | 57 | Engine 54, RotationalBundle 3 | land 20, sea 20, air 16, common 1 |
| `c_PIPitch` | 39 | Wing 33, RotationalBundle 4, FloatingBundle 2 | air 27, sea 12 |
| `c_PIRoll` | 30 | Wing 26, RotationalBundle 4 | air 30 (air-only) |
| `c_PINone` | 26 | Camera 12, RotationalBundle 14 | explicit no-op binding |
| `c_PIMenuSelect3` | 12 live (18 raw) | Camera only (live uses) | open-top transports, see quirk below |
| `c_PIFire` | 2 (`setInputFire`) | FireArms | sea |
| `c_PIAltFire` | 17 (`setInputFire`) | FireArms | air 13, emplacement 2, sea 2 |

`confirmed` — full-archive tabulation.

### 1b. Raw numeric ids used in vanilla, and their resolution

Only three numeric ids appear, 12 lines total:

| id | uses | where | resolves to | evidence |
|---|---|---|---|---|
| `4` | 6 | `setInputToYaw 4` on StationaryBrowning/MG42 mounts, PanzerIVBrowningHolder; `setInputToPitch 4` on AA cranks | `c_PIMouseLookX` | The Stationary_Browning point says `setInputToYaw 4` / `setInputToPitch 5` where the functionally identical Sherman browning mount says `c_PIMouseLookX` / `c_PIMouseLookY` (113/111 symbolic uses of the same pair). `confirmed` |
| `5` | 4 | `setInputToPitch 5` on the same MG mounts | `c_PIMouseLookY` | same pairing. `confirmed` |
| `1` | 2 | `setInputToPitch 1` on `Torpedo_Floater` (`Objects/Vehicles/Common/Physics.con`) and `Shallow_Torpedo_Floater` (Elco80) | `c_PIYaw` | by enum ordering only (below). `strong inference` |

With 4=`c_PIMouseLookX` and 5=`c_PIMouseLookY` anchored, and the axis trio obviously
contiguous, the enum head is:

```
0 c_PINone   1 c_PIYaw   2 c_PIPitch   3 c_PIRoll   4 c_PIMouseLookX   5 c_PIMouseLookY
```

This is exactly `PLAYER_INPUTS` in `tools/bf1942-models/bf42/con.py` (lines 67-75) —
the survey confirms it and finds **no numeric id above 5 anywhere in vanilla**.
`confirmed` for 0/4/5, `strong inference` for 1/2/3.

**Unresolved:** the numeric ids of `c_PIThrottle`, `c_PIFire`, `c_PIAltFire`,
`c_PIMenuSelect*` and everything in 1c never appear numerically in shipped data, so we
cannot place them in the enum from data alone. Flagged; irrelevant for our runtime
(we key on symbolic names).

### 1c. The rest of the `c_PI` namespace (from `Settings/Default/Controls/*.con`)

These exist as *bindable actions* in ControlMap files, not as part inputs. Complete
list observed across `Common.con` / `Infantry.con` / `Land.con` / `Air.con`
(`confirmed`, direct read):

- Axes: `c_PIYaw`, `c_PIPitch`, `c_PIRoll`, `c_PIThrottle`, `c_PIMouseLookX`,
  `c_PIMouseLookY`, `c_PICameraX`, `c_PICameraY`
- Fire/use: `c_PIFire`, `c_PIAltFire`, `c_PIUse`, `c_PIReload`, `c_PIDrop`,
  `c_PIAction`, `c_PINextItem`, `c_PIPrevItem`
- Stance/movement (infantry): `c_PIWalk`, `c_PIRun`, `c_PICrouch`, `c_PILie`
- Position/menu: `c_PIMenuSelect1`..`c_PIMenuSelect6`, `c_PIMenuSelect9`
- Camera: `c_PIMouseLook` (the hold-to-freelook modifier), `c_PIToggleCameraMode`,
  `c_PICameraMode1`..`c_PICameraMode4`
- UI/comms: `c_PIMap`, `c_PIZoomMap`, `c_PIShowScoreBoard`, `c_PIToolTip`,
  `c_PISayAll`, `c_PISayTeam`, `c_PIRadio1`..`c_PIRadio8`, `c_PIScreenShot`,
  `c_PIShowMapVote`, `c_PIVoteYes`, `c_PIVoteNo`

### 1d. Quirk: `c_PIMenuSelect3` as an axis input

12 live lines bind Camera axes to `c_PIMenuSelect3` — only on open-top transport
passenger cameras (Hanomag, Ho-Ha, M3A1, Katyusha), e.g.:

```
ObjectTemplate.setInputToYaw c_PIMenuSelect3     [hanomagCamera2]
```

A menu trigger delivers no sustained axis value, so the practical effect is a camera
with frozen axes — same as `c_PINone`, which DICE uses elsewhere. Why they chose a
trigger constant here is unknown (`speculative`: copy-paste artifact). The 6
additional raw hits (SBD/SBD-T `CockpitPilotHatch`) sit inside `beginrem` and are
dead code. Parsers must honour `beginrem`/`endrem` or they will report these.

---

## 2. `setInputToYaw/Pitch/Roll` semantics — the confusing part

**The command names the part's own rotation axis; the argument names the player
input that drives it.** `confirmed` — the reading our model browser rig already
implements (`bf42/con.py` `rig()`, `viewer/index.html` "Refractor rig" section), and
the only reading consistent with the data:

```
rem *** CorsairFlapLeftOuter ***                      (aileron)
ObjectTemplate.setInputToPitch c_PIRoll               = "this part rotates about its
                                                         PITCH axis, driven by the
                                                         player's ROLL input"
rem *** CorsairRudder ***
ObjectTemplate.setRotation 0/0/-89.999                (mounted rolled 90 degrees)
ObjectTemplate.setInputToPitch c_PIYaw                = rudder pitches in local space;
                                                        because the bundle is rolled
                                                        90 deg, that reads as yaw
```

Axis order everywhere (`setRotation`, `setMinRotation`, `setMaxSpeed`,
`setAcceleration`) is **Yaw/Pitch/Roll triples** (con.py `rig()` docstring, verified
against every vanilla surface: the bound component of min/max/speed/accel is always
the one the `setInputTo<Axis>` names).

Traps, all `confirmed` in data:

- **The Engine trap.** `ObjectTemplate.setInputToRoll c_PIThrottle` on `CorsairEngine`
  does not mean "roll the plane with throttle" — the Engine part's roll axis is the
  crankshaft. Its roll range is `-3000..5000` degrees: an accumulator that the input
  spins (the propeller). Tank engines bind the same way over a +/-1 degree span (body
  lean). See `assemble.py` `engine_spin_axes()` for how we already disambiguate.
- **Mounting rotation redirects the axis.** The rudder above; also
  `CorsairBodyWingVertical` (`setRotation 0/0/-89.999`) — a lift surface rolled
  vertical so its "pitch" lift acts sideways.
- **Numeric and symbolic args are interchangeable** (section 1b).
- **`c_PINone` is a real binding to nothing** and must not produce an axis.
- **One input, many parts — broadcast within the control scope.** Every template in
  the occupied PlayerControlObject's subtree that names an input receives it
  simultaneously. On the Corsair, `c_PIYaw` drives the rudder *and* the tail-wheel
  steering (`CorsairWheelBack`, a RotationalBundle: `setInputToYaw c_PIYaw`);
  `c_PIRoll` drives both outer-wing ailerons. Opposite deflection comes from the
  **sign of `setAcceleration`**, not from separate inputs: left aileron
  `setAcceleration 0/-120/0`, right aileron `0/120/0`.

---

## 3. Control authority bounds (Corsair, complete)

Source: `Objects/Vehicles/Air/Corsair/{Objects,Physics}.con` (extracted copies in the
session scratchpad; identical to `Objects.rfa`). All `confirmed`.

| input | part (type) | part axis | range (deg) | maxSpeed (deg/s) | accel (deg/s^2) | reset | rememberExcess |
|---|---|---|---|---|---|---|---|
| `c_PIPitch` | CorsairFlapTailLeft/Right (Wing) | pitch | -10..+20 | 60 | -60 | 1 | **1** |
| `c_PIRoll` | CorsairFlapLeftOuter (Wing) | pitch | -30..+30 | 120 | -120 | 1 | – |
| `c_PIRoll` | CorsairFlapRightOuter (Wing) | pitch | -30..+30 | 120 | +120 | 1 | – |
| `c_PIYaw` | CorsairRudder (Wing, rolled 90) | pitch | -15..+15 | 60 | +60 | 1 | – |
| `c_PIYaw` | CorsairWheelBack (RotationalBundle) | yaw | -20..+20 | 200 | -110 | 1 | – |
| `c_PIThrottle` | CorsairEngine (Engine) | roll | -3000..+5000 (accumulator) | 500 | 1000 | 1 | – |
| `c_PIMouseLookX` | CorsairCamera (Camera) | yaw | -70..+70 | 90 | 5000 | – | – |
| `c_PIMouseLookY` | CorsairCamera (Camera) | pitch | -40..+5 | 90 | -5000 | – | – |
| (none) | CorsairLandingGearLeft/Right/Back + hatches (LandingGear) | see below | 90 | 30 (hatches 10) | 75 | – | – |

Untouched by input: `CorsairFlapLeftMiddle/RightMiddle` (inner flaps) and
`CorsairBodyWingVertical` are **automatic lift regulators** — no `setInputTo*`, instead
`setFlapLift 4` / `setRegulateToLift 4.91` / `setWingToRegulatorRatio 1`. The engine
servos them to hold lift; the player cannot deploy flaps. The SBD's `SBDAirbreak` is
the same template pattern despite its name — dive brakes are not player-controlled in
vanilla either. `confirmed`.

### `setAutomaticReset 1` precisely

When the driving input is zero (key released, mouse stationary), the axis does not
hold — it runs back to its neutral pose (angle 0) at the part's own `setMaxSpeed` /
`setAcceleration` rates. When input is non-zero, it deflects toward the commanded
value at the same rates. This is why a BF1942 plane's stick centres itself and why
tank turrets (mouse-look-driven, **no** `setAutomaticReset` anywhere on them) stay
where you aimed. Distribution `confirmed`: all 113 Wing uses, 53 Engine uses, and 51
RotationalBundle uses (steering wheels, tail wheels, handlebars) have it; turret and
MG-mount RotationalBundles do not. Exact spring-back interpolation curve is engine
internals — the rates above are what the data declares. `strong inference` on the
exact rate symmetry (return rate = deflect rate); `confirmed` on the centring
behaviour itself.

### `rememberExcessInput 1`

24 uses in vanilla, **exclusively on the elevator surfaces of every aircraft**
(Corsair/Zero/Stuka tail flaps, bf109 tail flaps, Mustang/Spitfire/Yak9/SBD/AichiVal
rear rudders, B17 back rudders). `confirmed`. Meaning (`strong inference`): pitch is
mouse-driven, i.e. an accumulating relative input. When the surface saturates at its
clamp (+20 deg), further pull accumulates in the input rather than being discarded;
pushing forward must first unwind the remembered excess before the surface physically
moves back. This reproduces the "wind-up" elevator feel of BF1942 planes and only
matters for relative devices, which is why ailerons (also mouse-driven) having it on
no plane is odd — DICE evidently judged roll saturation less objectionable.

### Landing gear (no player input at all)

```
ObjectTemplate.setGearDownHeight 25          gear extends below 25 m above ground
ObjectTemplate.setGearUpHeight 23            ...retracts above 23 m
ObjectTemplate.setGearDownEngineInput 0.4    ...extends when engine input < 0.4
ObjectTemplate.setGearUpEngineInput 0.7      ...retracts when engine input > 0.7
```

Gear is fully automatic, gated on altitude AND throttle; the wheel-bay hatches are
their own LandingGear templates with the same thresholds. Our
`bf42/con.py` already synthesises this as the pseudo-input `c_PILandingGear`
(`GEAR_INPUT`, line 81). `confirmed`.

---

## 4. Seats, crew stations, input scoping, and the real control scheme

### PCO hierarchy

A vehicle is a `PlayerControlObject` (PCO). **Each crew position is its own PCO**,
nested via `addTemplate`; each PCO owns exactly one `SeatObject`, one `EntryPoint`,
one `Camera`, and whatever parts that crew member controls. The Corsair is
single-crew (one seat, one camera, one entry, directly in `CorsairComplex`). The SBD
shows the multi-crew pattern (`Objects/Vehicles/Air/SBD/Objects.con`):

```
ObjectTemplate.create PlayerControlObject SBD
  ...
  ObjectTemplate.addTemplate SBDCamera_For_PCO0        pilot camera
  ObjectTemplate.addTemplate SBDSeat                   pilot seat
  ObjectTemplate.addTemplate SBDEntry                  pilot entry
  ObjectTemplate.addTemplate SBD_PCO1                  <- rear gunner, a nested PCO
  ...
ObjectTemplate.create PlayerControlObject SBD_PCO1
  ObjectTemplate.addTemplate SBDEntry / SBDSeatPC01 / SBDBrowningRotation /
                             SBDCamera_For_PCO1 / SBD-6_guns
```

DICE's own camera names (`SBDCamera_For_PCO0`, `IlyushinCamera_For_PCO0`,
`Katyusha_Camera_PcoId1`) confirm PCOs are id-indexed. **Input scoping**: a player's
input state feeds only the subtree of the PCO they occupy, stopping at nested PCO
boundaries — `c_PIMouseLookY` on the SBD pilot's camera and on the rear gunner's
Browning are two different players' mice. Our assembler models exactly this
(`bf42/con.py` `control_scope()` line 302; `bf42/assemble.py` lines 1197-1201).
`confirmed` (it is how every multi-turret vehicle in the game behaves, and our rig
runtime reproduces it).

Position switching: `c_PIMenuSelect1..6` are bound to keys 1-6 in every vehicle
control map; no vehicle template consumes them for parts (the 12 camera bindings in
1d aside), so seat cycling itself is engine behaviour keyed on those triggers.
`strong inference`.

Seat visuals: `ObjectTemplate.seatFlags` — observed values `c_SeatShowHalfBodySoldier`
(Corsair pilot), `c_SeatShowFullBodySoldier`, `c_SeatShowStandingSoldier`,
`c_SeatIsOutside` (SBD rear gunner adds this to HalfBody), `c_SeatHalfBodySoldier`.
`confirmed` (frequency: 46/23/23/13/2).

### The default air control scheme (`Settings/Default/Controls/Air.con`, `confirmed`)

```
ControlMap.addKeysToAxisMapping  c_PIThrottle IDFKeyboard IDKey_W IDKey_S
ControlMap.addKeysToAxisMapping  c_PIYaw      IDFKeyboard IDKey_D IDKey_A
ControlMap.addAxisToAxisMapping  c_PIPitch    IDFMouse    IDAxis_1 0
ControlMap.addKeysToAxisMapping  c_PIPitch    IDFKeyboard IDKey_ArrowUp IDKey_ArrowDown 1
ControlMap.addAxisToAxisMapping  c_PIRoll     IDFMouse    IDAxis_0 0
ControlMap.addKeysToAxisMapping  c_PIRoll     IDFKeyboard IDKey_ArrowRight IDKey_ArrowLeft 1
ControlMap.addButtonToTriggerMapping c_PIFire    IDFMouse IDButton_0 c_CMPushAndHold
ControlMap.addButtonToTriggerMapping c_PIAltFire IDFMouse IDButton_1 c_CMPushAndHold
ControlMap.addKeyToTriggerMapping    c_PIMouseLook IDFKeyboard IDKey_LeftShift c_CMPushAndHold
ControlMap.addAxisToAxisMapping  c_PIMouseLookX IDFMouse IDAxis_0 0
ControlMap.addAxisToAxisMapping  c_PIMouseLookY IDFMouse IDAxis_1 0
game.setAirKeyboardSensitivity 0.5
game.setAirMouseSensitivity 0.75
game.setAirMouseInvert 1
```

So: **the flight stick is the mouse** (mouse X = roll, mouse Y = pitch, inverted by
default), with arrow keys as a secondary binding (the trailing `1` marks the second
binding slot — `strong inference`). W/S = throttle, A/D = rudder. Fire = LMB/Space,
bombs = RMB/Numpad0. **Mouse-look is modal, not independent**: holding LeftShift
(`c_PIMouseLook`) reroutes the same physical mouse from roll/pitch onto
`c_PIMouseLookX/Y`, which only the Camera template consumes — you cannot look around
and steer with the mouse at the same time. Keys 1-6 switch position, E
(`c_PIUse`, in the Common section of Air.con) exits/bails, C and F9-F12 change
camera, Numpad4/6/8/2 nudge the free camera (`c_PICameraX/Y`).

---

## 5. First-person / cockpit rendering

### Template structure (Corsair, `confirmed`)

```
CorsairComplex (Bundle)
 +- lodCorsairCockpit (LodObject)
 |   +- CorsairCockpitExternal (Bundle)   geometry Corsair_Hull_M1      3P: whole hull
 |   |   +- CorsairCockpit (SimpleObject) geometry Corsair_cock_M1      3P: canopy/pilot shell @ 0.03/1.23/0.3
 |   +- CorsairCockpitInternal (SimpleObject) geometry 1P_Corsair       1P: interior mesh @ origin
 |   lodSelector CorsairCockpitSelector
 +- CorsairCamera (Camera) @ 0.028/1.202/0.04
 +- CorsairEntry / CorsairSeat / CorsairEngine / control surfaces / guns ...

LodSelectorTemplate.create DistCompareSelector CorsairCockpitSelector
LodSelectorTemplate.addLodDistance 20
LodSelectorTemplate.addLodComparison 0.5
```

The exterior hull is not duplicated: `CorsairCockpitExternal` IS the hull plus the
canopy shell; `CorsairCockpitInternal` is the 1P interior. The `DistCompareSelector`
picks between them: the comparison term selects Internal when the observer is the
occupant in inside view (threshold 0.5 against a 0/1 "in-cockpit" scalar), the
distance term (20 m) covers everyone else. The same `CompareSelector` machinery
swaps the static propeller for the blurred disc at engine input 0.07
(`CorsairPropSelector`, `addLodComparison 0.07`). Threshold mechanics `confirmed`;
what exactly feeds the comparison scalar is `strong inference` (engine-side).

Every vanilla aircraft follows the identical pattern, all with `1P_*` interior
geometry (`confirmed`, full sweep): Zero `1P_Zero_m1`, Stuka `1P_Stuka_Driver_M1`,
Mustang `1P_Mustang_M1`, Spitfire `1P_Spitfire_M1`, Yak9 `1P_Yak9_M1`,
SBD/SBD-T `1p_SBD-6_cockpit_m1`, Ilyushin `1p_Ilyushin_cockpit_m1`,
AichiVal(-T) `1p_Aichi_Val_m1`, B17 `1P_B17_Int_M1`, bf109 `1p_bf109_m1` — plus
per-station 1P meshes for gunner PCOs (`1p_B17_Bellygun_m1`, `1p_Aichi_Val_Gunner_m1`,
`1P_B17_Turret_m1`, ...).

### Camera placement and view modes

- **1P camera** = the PCO's `Camera` template at its `addTemplate` position
  (`0.028/1.202/0.04` — eye height above the seat, at the hull origin line). Look
  clamps/rates are the `setMinRotation/setMaxRotation/setMaxSpeed/setAcceleration` on
  the Camera (section 3). `toggleMouseLook 1` appears on every aircraft pilot camera
  — it marks the camera as consuming the shift-held mouse-look rerouting
  (`strong inference`; the constants only ever co-occur with `c_PIMouseLookX/Y`
  bindings).
- **3P**: `ObjectTemplate.OutsideHudOffset 0/-0.4/4.45` (Corsair) — offset applied to
  the outside/chase view (every plane declares one; name says it positions the HUD
  reticle anchor in outside view; `strong inference` on exact semantics). There is no
  per-vehicle chase-camera distance in data — chase framing is engine behaviour.
- **Mode switching** is player-driven: `c_PIToggleCameraMode` (C) cycles,
  `c_PICameraMode1..4` (F9-F12) select directly. Which modes a camera allows is
  data-driven via `CVM*` flags: `SoldierCamera` declares the complete set —
  `CVMInside 1, CVMChase 0, CVMFrontChase 0, CVMFlyBy 0, CVMTrace 0,
  CVMExternTrace 0` (soldier is 1P-only). Vehicle cameras omit them (engine defaults
  allow the standard cycle) except artillery/battleship gunner cameras which add
  `CVMExternTrace 1` (Defgun, Wespe, Priest, Sexton, Katyusha PCO1, Yamato, Fletcher,
  Hatsuzuki, PrinceOW — the shell-following external trace view). `confirmed` for the
  flag inventory, `strong inference` for default-on semantics of unlisted modes.
- **FOV**: no FOV command exists on any vehicle Camera template (complete Camera
  vocabulary surveyed: setMaxSpeed/setAcceleration/setInputTo*/setMin/MaxRotation/
  setPivotPosition/toggleMouseLook/OutsideHudOffset/CVM*/setHasTarget/
  setContinousRotationSpeed only), and nothing FOV-shaped exists in `Settings/`.
  Vehicle 1P FOV is an engine constant. Only hand weapons scale it:
  `ObjectTemplate.zoomFov` / `soldierZoomFov` (fractions, e.g. sniper `zoomFov 0.1`).
  Absence `confirmed`; "hardcoded" `strong inference`.

### Do we have the cockpit meshes?

- Game data: `standardMesh/1P_corsair.sm` + `1P_corsair.rs` exist in vanilla
  `standardMesh.rfa`. The `.sm` parses cleanly with `bf42.stdmesh.parse` (203,746
  bytes, 6 LODs). Its `.rs` references `texture/Corsair_Interior_I`,
  `texture/SBD-6_crosshair_H` (the interior gunsight reuses the SBD crosshair
  texture) and `texture/f4u1_main_I`. `confirmed`.
- Extracted viewer assets (`tools/bf1942-models/viewer/models/`): `Corsair.glb`,
  `Corsair.Truk.glb`, `Corsair.wreck.glb` (+ reports). **The interior is in none of
  them**: `Corsair.report.json` lists `CorsairCockpitInternal` under
  `lodAlternativesSkipped` and selected `lodCorsairCockpit -> CorsairCockpitExternal`.
  This is deliberate pipeline policy — `bf42/assemble.py` `geometry_is_first_person()`
  (line 41) hard-skips any `1P*` geometry (line 1210) and `_select_lod_children`
  (lines 1053-1070) steers LOD alternatives away from 1P meshes. No `1P_*` GLB exists
  anywhere under `viewer/models/`. `confirmed`.
- Consequence: shipping a cockpit view needs either (a) a small extractor mode that
  assembles `CorsairCockpitInternal` (the mesh, reader and texture resolution all
  already work — only the 1P skip stands in the way), or (b) rendering the exterior
  GLB from the camera position with a near-plane cull. Note the exterior GLB has no
  interior faces, so (a) is the honest option.

---

## 6. What a player can actually command in a BF1942 plane

| control | input | driven / bounded by | data or engine |
|---|---|---|---|
| Pitch | `c_PIPitch` (mouse Y, arrows) | elevator `Wing` templates: range/speed/accel/reset/rememberExcess | **data** (`Physics.con`) — `confirmed` |
| Roll | `c_PIRoll` (mouse X, arrows) | aileron `Wing` templates, opposite-signed accel | **data** — `confirmed` |
| Yaw / rudder | `c_PIYaw` (A/D) | rudder `Wing` + tail-wheel `RotationalBundle` | **data** — `confirmed` |
| Throttle | `c_PIThrottle` (W/S) | `Engine` template: torque/differential/gear points; prop spin is the Engine's roll accumulator | **data** — `confirmed` |
| Landing gear | — none — | automatic: `setGearUp/DownHeight` + `setGearUp/DownEngineInput` on `LandingGear` | **data thresholds, engine logic** — `confirmed` |
| Wheel brakes | — none — | no brake input exists in vanilla; S (throttle reverse) is the only deceleration | absence `confirmed` |
| Flaps / dive brakes | — none — | inner flaps are auto lift-regulators (`setRegulateToLift`); SBD "Airbreak" likewise | absence `confirmed` |
| Primary fire (MGs) | `c_PIFire` (LMB/Space) | `FireArms` with no `setInputFire` defaults to primary fire (our assembler: `input_fire or "c_PIFire"`, assemble.py:886) | **data** weapon, default binding `strong inference` |
| Secondary (bombs) | `c_PIAltFire` (RMB) | `FireArms` with explicit `setInputFire c_PIAltFire` (`CorsairBombDummy`) | **data** — `confirmed` |
| Free look | hold `c_PIMouseLook` (LShift) -> `c_PIMouseLookX/Y` | `Camera` template clamps (-70..70 yaw, -40..+5 pitch) | routing **engine**, clamps **data** — `confirmed` |
| Camera mode 1P/3P | `c_PIToggleCameraMode` (C), `c_PICameraMode1-4` (F9-F12) | `CVM*` flags per Camera; cockpit mesh swap via `DistCompareSelector` | switching **engine**, availability + meshes **data** — `confirmed`/`strong inference` |
| Seat switching | `c_PIMenuSelect1..6` (keys 1-6) | nested PCOs, one Seat/Entry/Camera each | seats **data**, cycling **engine** — `strong inference` |
| Enter / bail out | `c_PIUse` (E) | `EntryPoint` radius, `setSoldierExitLocation` | **data** anchors, action **engine** — `confirmed` |
| Horn/bell, flares, ... | — | do not exist on vanilla planes | absence `confirmed` |

For the viewer's flyable plane this means the honest input surface is exactly five
axes/triggers — pitch, roll, yaw, throttle, fire/alt-fire — plus modal free-look, and
everything else (gear, prop blur, flaps) is derived state we already know how to
compute from the same `.con` values the game uses.

---

## 7. Tie-ins to our existing runtime

- `bf42/con.py` — `PLAYER_INPUTS` (numeric map, lines 67-74), `GEAR_INPUT` synthetic
  landing-gear input (line 81), `rig()` (per-part axis extraction, honours all traps
  in section 2), `control_scope()` (PCO scoping, line 302). Note: the header comment
  there says only ids 4 and 5 occur numerically; the survey also found two live
  `setInputToPitch 1` lines on torpedo FloatingBundles (section 1b) — harmless for
  rigs, but the comment undercounts.
- `bf42/assemble.py` — `browse_rig()` / `_DRIVETRAIN_INPUTS` (what the model browser
  exposes as sliders), `engine_spin_axes()` (prop accumulator handling + display
  scaling), `geometry_is_first_person()` + `_select_lod_children()` (the 1P skip a
  cockpit extractor must bypass), FireArms default input at line 886.
- `viewer/index.html` — "Refractor rig" runtime from line 3609; input groups at
  4420-4423 (`AIM` = MouseLookX/Y, `STICK` = Roll/Pitch, `DRIVE` = Yaw/Throttle) with
  WASD/arrow bindings at 4428-4430 that already mirror `Air.con`'s scheme.
- Missing for first person: a cockpit-configuration extract (section 5), a camera
  rig using the Camera template's position/clamps, and the `setAutomaticReset` /
  `rememberExcessInput` integrator semantics from section 3 — the rig runtime
  currently poses axes directly from slider values and has no spring-back or
  excess-accumulation behaviour.
