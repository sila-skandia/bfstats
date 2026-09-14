# Flyable vehicles in the map flythrough

Exploration: can we take a vehicle that already stands in an extracted map
scene and *fly* it — in first person, from the cockpit, with its real control
surfaces moving, its real engine note, and a crash when it hits a building?

Target for the experiment: **the Corsair on Wake Island**.

Longer-term motivation (not in scope here, but it shapes the architecture):
capture a real round on a real server via a DLL hook, upload the capture, and
replay it on the same map. That makes the vehicle state *externally driven* —
so nothing here may assume the local player's input is the only source of
truth. See [Replay-shaped from day one](#replay-shaped-from-day-one).

## Companion documents

| Track | Document |
|---|---|
| Flight model — `Wing`/`Engine` templates, lift, torque, throttle | [flight-model.md](flight-model.md) |
| Player input enum, seats, cockpit camera | [input-and-cockpit.md](input-and-cockpit.md) |
| Cockpit / chase / front / fly-by views — which are data, which are ours | [camera-modes.md](camera-modes.md) |
| Collision hulls, terrain, crash damage, wrecks | [collision-and-crash.md](collision-and-crash.md) |
| `.ssc` sound scripts, RPM crossfade, Web Audio recipe | [engine-sound.md](engine-sound.md) |

---

## What we already have (verified against the shipped Wake scene)

This is the headline: **far more of this is already built than it looks.**
Everything below was read out of
`tools/bf1942-models/viewer/maps/wake/scene.glb` (37 MB, 1831 nodes) and
`scene.json` as they stand at HEAD.

### The Corsair is already in the map, fully assembled

`scene.json` reports `objects.spawners: 32`. The exporter walks
`info.spawn_objects` and calls `spawn_vehicle()` to resolve each
`ObjectSpawner` to the vehicle its team actually gets, then assembles it with
the *same* assembler the model browser uses ([extract_map.py:573-591](../../tools/bf1942-models/extract_map.py#L573)).
Wake gets one Corsair, at world `(1441.79, 116.987, -665.0)` with a real
authored rotation, under a `spawners` group node.

Its subtree is 42 nodes and contains everything the experiment needs:

```
Corsair
  lodCorsair / CorsairComplex
    lodCorsairCockpit
      CorsairCockpitExternal  [mesh]  Corsair_Hull_M1
        CorsairCockpit        [mesh]  Corsair_cock_M1     <- interior geometry
    CorsairCamera                                         <- cockpit eye point
    CorsairEngine                                         <- rig: propeller
      lodCorsairPropeller / CorsairPropellerStatic  [mesh]
      CorsairLandingGearLeft/Right/Back             [mesh, rig]
      CorsairRearWheelHatchL/R                      [mesh, rig]
    CorsairFlapLeftMiddle / RightMiddle             [mesh]   <- main lift wings
    CorsairFlapLeftOuter  / RightOuter              [mesh, rig]  <- ailerons
    CorsairFlapTailLeft   / TailRight               [mesh, rig]  <- elevators
    CorsairRudder                                   [mesh, rig]
    CorsairGuns (2 muzzles, e_MuzzHeavy)
    CorsairBombDummy
```

### The control surfaces already carry their rig metadata

The assembler stamps a `rig` extra on every input-driven part
([assemble.py:1340-1349](../../tools/bf1942-models/bf42/assemble.py#L1340)).
Read straight out of Wake's glb:

| Node | axis | input | min | max | maxSpeed | autoReset |
|---|---|---|---|---|---|---|
| `CorsairFlapLeftOuter` | pitch | `c_PIRoll` | -30 | 30 | 120 | yes |
| `CorsairFlapRightOuter` | pitch | `c_PIRoll` | -30 | 30 | 120 | yes |
| `CorsairFlapTailLeft` | pitch | `c_PIPitch` | -10 | 20 | 60 | yes |
| `CorsairFlapTailRight` | pitch | `c_PIPitch` | -10 | 20 | 60 | yes |
| `CorsairRudder` | pitch | `c_PIYaw` | -15 | 15 | 60 | yes |
| `CorsairEngine` | roll | `c_PIThrottle` | -3000 | 5000 | 500 | yes (rate driver) |
| `CorsairWheelBack` | yaw | `c_PIYaw` | -20 | 20 | 200 | yes |
| `CorsairLandingGear*` | various | `c_PILandingGear` | 0 | ±90 | ±30 | no |

Note `setInputToPitch c_PIRoll` on the ailerons: `setInputTo<Axis>` names the
**part's own rotation axis** and takes the **player input** as its argument.
The ailerons rotate about their pitch axis, driven by the roll input.

### The cockpit camera is already extracted

`CorsairCamera` is an empty node at local `(0.028, 1.202, -0.04)` with
`extras.templateKind: "Camera"` and `extras.cameraView.control: "Corsair"`.
That is the first-person eye point, in the vehicle's own frame, already in the
map scene. First person costs us a `getWorldPosition`/`getWorldQuaternion`,
not an extraction change.

### A rig runtime already exists — in the wrong viewer

`viewer/index.html` (the model browser) has a complete Refractor rig runtime at
its `--- Refractor rig ---` section: `applyRig()` with position / rate / gear /
free drivers, per-seat input scoping via `keyOf(control, input)`, the
handedness fix (`SIGN = { yaw: -1, pitch: -1, roll: 1 }`), and a slider per
player input. `viewer/map.html` has **none** of it — Wake's glb carries zero
animation clips and map.html creates no `AnimationMixer`, so the propeller and
every control surface currently sit frozen in the flythrough.

Porting `applyRig()` into map.html is the single highest-value move and is
maybe 60 lines.

---

## The finding that answers the aileron question

> "A plane will roll left, with the flaps moving in opposite direction. Does
> this control come from the config or from within the game itself?"

**It comes from the config — and our extractor is currently dropping it.**

`Objects/Vehicles/Air/Corsair/Physics.con`, the two ailerons:

```con
rem *** CorsairFlapLeftOuter ***
ObjectTemplate.setMinRotation 0/-30/0
ObjectTemplate.setMaxRotation 0/30/0
ObjectTemplate.setMaxSpeed 0/120/0
ObjectTemplate.setAcceleration 0/-120/0      rem <- negative
ObjectTemplate.setInputToPitch c_PIRoll

rem *** CorsairFlapRightOuter ***
ObjectTemplate.setMinRotation 0/-30/0
ObjectTemplate.setMaxRotation 0/30/0
ObjectTemplate.setMaxSpeed 0/120/0
ObjectTemplate.setAcceleration 0/120/0       rem <- positive
ObjectTemplate.setInputToPitch c_PIRoll
```

Identical range, identical rate, identical input. The **only** difference
between the left and right aileron is the *sign of `setAcceleration`*. That
sign is what makes one surface go up while the other goes down.

Contrast the elevators, which must move *together*: `CorsairFlapTailLeft` and
`CorsairFlapTailRight` both declare `setAcceleration 0/-60/0` — same sign. And
the rudder, a single surface, `0/60/0`.

So the mirroring is authored data, not engine cleverness. The engine's
contribution is only the integration rule (roughly: the signed acceleration
drives the surface toward its commanded position, clamped to `min..max` and
rate-limited by `maxSpeed`).

**Our bug:** `bf42/con.py` parses `setMinRotation`, `setMaxRotation` and
`setMaxSpeed` ([con.py:449-456](../../tools/bf1942-models/bf42/con.py#L449))
but has no `setAcceleration` case at all, and `ObjectTemplate` has no field for
it. That is why the rig table above shows the two ailerons as *byte-identical*
specs — and why, in the model browser today, dragging the roll slider deflects
both ailerons the **same way**. The mirroring information was thrown away at
parse time.

Landing gear escapes this because the gear legs mirror via
`setMinRotation`/`setMaxRotation` instead (left `max: 90`, right `max: -90`),
which we *do* parse — which is exactly why the gear animates correctly today
and the ailerons do not.

The fix is small and lands in three places:

1. `con.py` — add `setacceleration` to the vec3 directive tuple and an
   `acceleration` field on `ObjectTemplate`.
2. `ObjectTemplate.rig()` — emit the per-axis signed acceleration (or a
   derived `direction: ±1`) in each axis spec.
3. The rig runtime — multiply the input by that sign before mapping to
   `min..max`.

Then re-extract. See [flight-model.md](flight-model.md) for the surveyed
evidence that this sign convention holds across every vanilla aircraft, and
for the exact semantics to encode.

---

## Prototype architecture

### Replay-shaped from day one

The stated end goal is replaying captured rounds, so the design splits into
three layers with a deliberate seam between them:

```
  input source            vehicle state             presentation
  ------------            -------------             ------------
  local keyboard   -->                        -->   rig  (control surfaces)
  replay stream    -->    { position,         -->   camera (cockpit / chase)
  (future: net)           orientation,        -->   audio (engine RPM)
                            velocity,         -->   effects (dust, crash)
                            inputs{} }
```

The flight model is what turns *inputs* into *state*. A replay supplies state
directly and can either re-simulate from captured inputs or interpolate
captured state — but the presentation layer must not care which. Concretely:
`applyRig()` reads from the same `inputValues` map whether a key press or a
replay frame wrote it.

This is why the prototype should drive the plane through an explicit state
object rather than mutating `Object3D` transforms in the input handler.

### Integration points in `map.html`

| What | Where | Change |
|---|---|---|
| Find and detach the Corsair | after `indexScene(currentRoot)` ([map.html:1493](../../tools/bf1942-models/viewer/map.html#L1493)) | reparent from `spawners` to scene root, preserving world transform |
| Rig runtime | new `viewer/flight.js`, imported as a module | port `applyRig()` from index.html, add the acceleration sign |
| Control input | extend the existing `keydown`/`keyup` + pointer-lock block ([map.html:277-350](../../tools/bf1942-models/viewer/map.html#L277)) | a mode flag: free-fly camera vs. piloting |
| Camera | `applyLook()` / `placeCamera()` ([map.html:364-384](../../tools/bf1942-models/viewer/map.html#L364)) | when piloting, take position+orientation from `CorsairCamera`'s world transform |
| Per-frame step | `frame(dt)` ([map.html:1568](../../tools/bf1942-models/viewer/map.html#L1568)) | integrate flight, advance rig, update audio |
| Culling | `applyVisibility()` ([map.html:1353](../../tools/bf1942-models/viewer/map.html#L1353)) | the flown vehicle must never be culled, and `optVehicles` must not hide it |

The existing free-fly camera (WASD + pointer-lock mouse look, `FLY_SPEED`,
`isSlow()`) stays as-is; piloting becomes a second mode so the flythrough is
not regressed.

### Known integration hazards

- **`spawnersRoot.visible = optVehicles.checked`** ([map.html:1359](../../tools/bf1942-models/viewer/map.html#L1359))
  will hide the plane you are flying the moment the "vehicles" toggle is
  unticked. Reparenting out of `spawners` solves this and the culling problem
  at once.
- **Baked effect payloads are force-hidden on load** — muzzle flashes,
  projectile bodies and trail quads are set `visible = false` for the whole
  scene ([map.html:1468-1471](../../tools/bf1942-models/viewer/map.html#L1468)).
  Firing the Corsair's guns means selectively re-enabling them for the flown
  vehicle. `features/bf1942-3d-models/firing-effects.md` already documents the
  effect chain; the model browser animates them.
- **Draw distance is 500 m on Wake** and fog ends there
  (`scene.json`: `drawDistance: 500`, `fogEnd: 500`). That is correct for the
  engine — see `features/bf1942-3d-models/flythrough-fidelity-gap.md` — but it
  means a plane at altitude sees very little. Decide deliberately whether
  piloting uses the honest 500 m or the "render entire map" path, and say which
  in the UI rather than silently inflating the far plane; inflating it is the
  exact bug that document was written about.
- **No collision geometry in the map scene.** `map.html` has an `isCollision()`
  helper ([map.html:1304](../../tools/bf1942-models/viewer/map.html#L1304)) and
  hides such meshes, but Wake's glb contains **zero** collision-flagged nodes —
  they are not exported on the map path today. See
  [collision-and-crash.md](collision-and-crash.md).
- **Water is at y = 95** (`scene.json`: `waterLevel: 95.0`) and Wake is mostly
  ocean, so a water-impact case is not an edge case, it is the common one.

---

## Answers to the questions this exploration opened

1. **Aerodynamic, not impulse.** The Refractor flight model is a real (crude)
   per-surface aerodynamic simulation: input never torques the aircraft
   directly, it deflects `Wing` surfaces, and each surface turns local airflow
   plus its own deflection into a force applied at an authored off-centre
   point. The torques fall out of the geometry. The clinching evidence is the
   Ilyushin, which splits the two roles apart: its *visible* ailerons are
   geometry-only `RotationalBundle`s and its *physics* ailerons are `Wing`s
   with no geometry at all, driven by the same input at the same rates. An
   invisible wing is pointless unless it makes force.
   ([flight-model.md](flight-model.md) §1)
2. **`setPositionOffset` is the force application point** — a delta from the
   part's attach position, in the parent frame. It is not a lever arm and not a
   mesh position, which is why the outer wings' ±0.5 looked wrong next to the
   inner wings' ±2.564. The mount rotation sets the lift *direction*
   (`liftDir = q_body · R(mountRot) · (0,1,0)`), which is how the rudder's −90°
   roll turns its lift sideways with no special case.
   ([flight-model.md](flight-model.md) §4b)
3. **Yes, and they are nearly free.** Collision hulls live *inside* each `.sm`
   as collision layers; `bf42/stdmesh.py` already parses them and the assembler
   already exports them. `extract_map.py` simply passes `include_collision=False`.
   Every building and prop on Wake has a hull (~9k coarse triangles island-wide);
   the palms keep theirs in `.tm` files, which `treemesh.py` currently skips.
   ([collision-and-crash.md](collision-and-crash.md) §1)
4. **A three-layer linear crossfade on a normalised `Engine::Rpm`** (engine
   rotation over `maxRotation.roll` = 5000). Idle fades 1→0 over 0–0.6, mid
   rises 0–0.6 then falls 0.6–0.99, high rises 0.6–1.0, and each layer's
   playback rate sweeps 0.70→1.00 across its own band. Note the trap:
   `#templateLevel HIGH/MEDIUM/LOW` in the `.ssc` files is the sound *quality*
   setting, not RPM banding. ([engine-sound.md](engine-sound.md) §2)

Two more findings that change the prototype's shape:

- **Landing gear and flaps are not player inputs.** Gear retracts automatically
  on altitude (23/25 m) and engine-input (0.4/0.7) thresholds; the "flaps" are
  auto lift regulators. There is no wheel-brake input at all. What a pilot
  actually commands is pitch, roll, yaw, throttle, guns, bombs, free-look,
  camera mode and seat. ([input-and-cockpit.md](input-and-cockpit.md) §6)
- **`setRegulateToLift` is universally 4.905 = g/2**, on two inner wings, so the
  pair holds exactly 1 g. That is the whole reason BF1942 aircraft fly as if on
  rails, and the regulators' ±2° saturation *is* the stall model — there is no
  stall parameter anywhere. ([flight-model.md](flight-model.md) §5)

## Status

Research complete; a working prototype flies. Implemented so far:

- `bf42/con.py` parses `setAcceleration` and `rig()` emits a per-axis
  `direction`, so mirrored control surfaces mirror. Wake re-extracted.
- `viewer/flight.js` — the rig runtime, the vehicle/state seam, and a
  provisional flight model using the researched constants.
- `viewer/map.html` — a "pilot the plane" mode: mouse stick, W/S throttle,
  A/D rudder, R to reset, cockpit camera, terrain and sea floor.
- **The cockpit interior.** `extract_models.py --cockpit` writes
  `<Name>.cockpit.glb`, the first-person branch of the same template walk that
  every other export deliberately refuses, and `flight.js` grafts it onto the
  flown vehicle by node name and reproduces the LodObject's hull/interior swap.
  All 12 vanilla aircraft and the 1P ground and sea vehicles come out with no
  per-vehicle handling. ([input-and-cockpit.md](input-and-cockpit.md) §8)
- Engine sound. `parse_ssc` handles multi-load layers, `#include` and the
  `beginEffect` modulators; `extract_map.py` ships each spawned vehicle's
  parsed engine script and its wavs; `viewer/engine-audio.js` evaluates the
  same curves the engine does. Nothing is hard-coded per vehicle, so every
  vanilla aircraft, tank and ship already has its note.

Verified headlessly on Wake: the Corsair rolls down the strip, lifts off,
retracts its gear on the altitude threshold, and holds ~34 m/s climbing at
full throttle 10 s in. Commanding full roll deflects
`CorsairFlapLeftOuter` to +30.3° and `CorsairFlapRightOuter` to −29.8°. Over
the same run the engine's three core loops crossfade on exactly the bands
`EngineHigh.ssc` declares and each sweeps playback rate 0.70 to 1.00 across its
own — see [engine-sound.md](engine-sound.md) §7.5 for the measured table.

Not yet done, in rough priority order:

1. **Collision.** Flip `include_collision=True` in `extract_map.py`, teach
   `treemesh.py` to keep trunk hulls, then swept segment probes (nose,
   wingtips, tail, belly) against a 64 m uniform grid. A 100 m/s plane covers
   1.7 m per frame and will tunnel a 0.2 m wall with discrete tests.
2. **Per-surface aero.** Replace the provisional body-rate model with the
   surface loop in [flight-model.md](flight-model.md) §8, which is the
   architecture the engine actually uses and which gets roll coupling,
   adverse yaw and the regulator stall for free.
3. **Damage and the crash chain.** Smoke at 65 HP, fire at 20, then `e_ExplGas`
   plus scrap emitters throwing `Wreck_Corsair2_M1` — all specced in
   [collision-and-crash.md](collision-and-crash.md), and `Corsair.wreck.glb` is
   already in the viewer.

### A caution for the replay goal

`flight-model.md` §8 leaves several constants free (inertia, `K_LIFT`,
`AOA_CLAMP`) because the shipped data cannot fix them. Four in-game
measurements settle them without decompiling: time a full roll, a loop, a
0→top-speed run on the deck, and the onset of stall sink. Until those are
taken, a replay that re-simulates from captured *inputs* will drift from what
the server actually did; a replay that interpolates captured *state* will not.
That argues for capturing state as well as inputs.
