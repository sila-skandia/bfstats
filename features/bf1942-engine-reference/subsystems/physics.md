# Refractor physics, read out of the client

What the engine actually computes, with the address that says so. Every claim
here was read in `BF1942.exe` (sha256 `60c945…cd3699`) through the Ghidra
bridge; `bf1942_lnxded.static` supplied names and signatures only, per
[README](../README.md). Addresses are in [symbols.json](../symbols.json) —
`./xref.py sym 0x…` for the note, `./xref.py decompile 0x…` to re-read it.

Confidence is the corpus ladder. Anything still `open` says so; do not promote
it without an address.

Established 2026-09-14/15. Before this, the viewer's flight model rested on nine
fitted constants and the wrong gravity. It now rests on one free number.

---

## 1. The shape of it

Physics is a tree of `PhysicsNode`s. Forces enter as **accelerations, not
newtons** — the API is `addAccelerationAtAbsolutePosition` / `AtRelativePosition`
and there is no `addForceAt` anywhere in the binary. So `.con` tuning values like
`setRegulateToLift 4.91` are m/s², mass-independent. Mass matters for collision
response and inertia, not for reading the numbers.

Behaviour lives in subnode classes constructed from their templates —
`PhysicsEngine`, `PhysicsSpring`, `PhysicsWing`, `PhysicsFloatingBundle` — each
with its own `updatePhysics(float)`.

**There is no `PhysicsType` / `c_PT*`.** That is BF2 vocabulary. In Refractor 1
the physics class *is* the template type. Zero `c_PT*` across 1,753 vanilla
`.con` files, and the binary agrees.

| | |
|---|---|
| `BasicPhysicsSystem::BasicPhysicsSystem` | `0x00578f00` |
| `GameClient::simulateFrame(float tickDt)` — the physics dispatch, formerly labelled "`World::update`" | `0x004b6cb0` (`verified`, relabelled 2026-09-15) |
| `g_simulationFps` = 30.0 | `0x00957640` (`verified`; lnxded `0x08716b5c`) |

---

## 2. Gravity is −14.73 m/s²

The constructor writes `0xC16BAE14` = **−14.73** to the gravity field, and
`0x447A0000` = 1000.0 to `airDensityZeroAtHeight`.

Closed by exhaustion, not inference: the singleton has 31 xrefs, all classified
by vtable slot. The only `setGravity` callers are the chat cheat handler
(`0x00729b30` — `EarthWalk` → −10.0, `MoonWalk` → −1.67, `SpaceWalk` → −0.1;
note EARTH does *not* restore the default) and the console property setter
(`0x004c2370`). No map-load path touches it, and `physics.gravity` appears in no
vanilla file.

Corroboration from the other direction: the SBD's three `setRegulateToLift 4.91`
surfaces sum to 14.73 exactly. **`4.91` is g/3, not g/2** — 14.7295/3 = 4.9098
rounds to 4.91 with room to spare, where 9.81/2 = 4.905 does not.

---

## 3. Integration: four sub-steps, semi-implicit

`PointPhysicsNode` integrator at `0x00578aa0`. Per update, with frame `dt`:

```
h = dt * 0.25
repeat 4:  v += accel * h          // velocity first
           pos += v * h            // then position, with the UPDATED v
accel = 0                          // accumulator cleared
accel.y += gravity * gravityModifier    // re-seeded for the next update
```

Semi-implicit (symplectic) Euler, four fixed sub-steps. The `dt` that reaches
the dispatch at `0x004b6cb0` is **not the frame time**. That function is
`GameClient::simulateFrame(float tickDt)` (GameClient vtable slot vptr+0x13c,
twin of lnxded `GameServer::simulateFrame` 0x0815c2a0), and it is called
`nTicks` times per rendered frame by `GameClient::update(int nTicks, float
tickDt)` (`0x0048fca0`, twin of `GameServer::update` 0x08132940) with a
**fixed `tickDt = 1/g_simulationFps = 1/30 s`**. The count comes from a
plain fixed-step accumulator — `InputManager::update` (`0x0049ce70`; lnxded
`Setup::updateInputs` 0x080bc540): `n = floor((now − lastTick) / tickDt)`,
`lastTick += n·tickDt`, and a backlog above 10 ticks is dropped to 1
(`GameClient::update` drops above 9 as well). `Setup::mainLoop`
(`0x0044abc0`; lnxded 0x080bc090) then calls `game->update(n, Setup+0x184)`
where `Setup+0x184` was set to `1.0f / inputManager+0x1c` by
`Setup::initInputDevices` (`0x00444e70`; lnxded 0x080be490 stores
`1/g_simulationFps` at Setup+0xcc) and `+0x1c` is the constructor argument
`g_simulationFps` (`0x00957640`, 30.0f, 50 READ xrefs and no writer; lnxded
`0x08716b5c`, also 30.0, no console word in either binary). The frame `dt`
(`Setup+0x180`) goes only to rendering and to `ObjectManager::
handleFrameUpdates` (slot +0x18), never into the physics.

So **retail physics is a fixed 30 Hz step, not frame-rate coupled**, and the
"clamp" is on the tick count, not on `dt`: every physics call sees exactly
1/30 s, whatever the frame rate. The four sub-steps inside are therefore
1/120 s each. The earlier reading of "frame `dt` straight through, no clamp"
was true of the dispatch itself but wrong about what it was handed.

> The viewer's fixed outer tick is therefore the engine's own design, with one
> number to correct: the engine ticks at 30 Hz, not 60. The four sub-steps
> *inside* each tick stand.

Drag (`0x00578990`, `verified`) is wind-relative and area/mass-scaled, **not**
the plain `−drag·v` the viewer once assumed, and not an exponential decay:
`accel -= (scale*v − wind) * π * r² * drag / mass`, added to the accumulator
once per tick, before the four sub-steps. In `PointPhysicsNode::updatePhysics`
(`0x00578ca0`), `r` is the body's own `getBoundingRadius()` — vtable +0x1c, which
forwards to the composite object's bounding sphere, so no `.con` word sets it —
and `scale = 1 + 24·min(underWater/r, 1)`, clamped above only, with `underWater`
at +0x44 (named by lnxded `setUnderWater`/`getUnderWater`): a fully submerged
body feels 25× its dry drag. Particles are `PointPhysicsNode` bodies too
(`Particle::handleUpdate` lnxded `0x0820ad20` sets their drag every tick), so
this is also the particle drag law (ledger EMT-5). The viewer's `physics.js`
implements it; its comments still call `r` and `scale` unproven.

`PhysicsNode` — vehicles and their engines, wings and springs — is less simple
(lnxded `0x082543d0`). A non-root node for which a virtual predicate (vtable
+0xcc) holds hands its force and torque to the root and skips drag and gravity
for that tick. Otherwise bit 0x4 of the composite object's byte +0x7 chooses:
set, the same formula with fixed `r = 0.1`, `scale = 1`; clear, an "Advanced"
pair that treats the object as a box (client `0x0053f5f0` / `0x0053f7c0`,
lnxded `0x08252f50` / `0x08253280`, read 2026-09-16):

```
relV    = scale·v − wind
k       = −drag · |relV| / mass                  // quadratic in speed
accel  += k · (Ax·proj0(relV) + Ay·proj1(relV) + Az·proj2(relV))
k'      = −drag · |ω| / mass
angAcc += k' · ((Ay+Az)·proj0(ω) + (Ax+Az)·proj1(ω) + (Ax+Ay)·proj2(ω))

Ax = (π/4)·DY·DZ   Ay = (π/4)·DX·DZ   Az = (π/4)·DX·DY   // ellipses in the box's faces
scale = 1 + 24·min(depth / DY, 1)                // depth at client +0x8c; DY vertical
```

`projN` projects onto row N of the object's absolute transform (reading the rows
as X, Y, Z is inferred from how the areas pair with them). The box comes from the
object's geometry, queried with IID 0x492fe0fe — one of the interfaces
`BStandardMesh::queryInterface` answers with itself. `dragOffset` is read by
neither law, and nothing calls its setter. What sets the selector bit is not
known (Still open).

---

## 4. Lift — `calculateLift`, `0x0057fa90`

The single most valuable function in this subsystem.

```c
float calculateLift(const Vec3& vel, const Vec3& surfaceUp, float coeff) {
    float len = |vel|;  if (len == 0) return 0;
    float s = clamp(dot(vel/len, surfaceUp), -1, 1);
    float a = asin(s) * 57.29578;                        // DEGREES
    float c = (fabs(a) >= 45) ? 0
            : (a >= 0) ? a*(45 - a)/506.25
                       : a*(45 + a)/506.25;
    return (0.75*c + 0.25*s) * len*len * coeff * 0.0025; // m/s^2
}
```

**The speed exponent is 2** — `len*len`, unambiguous. MSVC folds `/506.25` into
`*0.0019753086419753087`, which is why grepping for `506.25` finds nothing.

**The engine ships a stall model nobody had gone looking for.** The coefficient
peaks at exactly 1.0 at 22.5° (`22.5²/506.25 = 1`) and is cut to hard zero past
±45°. Small-angle slope is 4.0699 per radian.

Note the cutoff is in the coefficient `c`, **not** the return: the `0.25*s` term
survives, so a surface keeps ~21% of peak lift at 45° and 0.25 at 90°. That
residual is what stops a tumbling aircraft being weightless.

The `0.0025` scale constant is at `0x008feb30`.

### How a Wing feeds it — `PhysicsWing::updatePhysics`, `0x0057fbf0`

- `coeff = (setWingLift + setFlapLift) * getGravity() * -0.101833`. That constant
  is **−1/9.82** — the same earth-gravity normalisation `PhysicsSpring` uses. At
  the shipped g this is a flat ×1.49995.
- `setWingLift` and `setFlapLift` are **summed into one coefficient**. There is
  no `flapLift × deflection` term; a hinge reaches the arithmetic only by
  rotating the surface's world matrix.
- Force = `−clamp(L * medium, ±200) * surfaceUp`, applied at the **surface's
  world position**. `medium` = 10.0 submerged, else `1 − clamp(y/1000, 0, 1)`.
- Regulator servo command:
  `clamp((L_ref + neutralLift*setWingToRegulatorRatio + setRegulateToLift) * g * 0.101833, −1, +1)`.
  Equilibrium is "this surface makes `setRegulateToLift` m/s² upward" —
  approximately, since the feed-forward and the proportional servo's
  steady-state error both bite.

`Wing::calculateNeutralLift` is at `0x00580280`.

### `setPitchOffset` and the flapLift/wingLift split

`Wing::handleUpdate` (lnxded `0x08250950`) subtracts `setPitchOffset` from the
posed angle every update, for every Wing — so it biases the **rest orientation**,
not only the regulator's reference incidence. The same instruction shows how the
two lift terms are told apart despite being summed:

```
angle = deflection * flapLift/(wingLift + flapLift) − pitchOffset
```

**`setFlapLift` is the moving share of one surface's area.** A rudder (`0/2`) and
a fin (`2/0`) run identical arithmetic but are not interchangeable — the fin's
moving share is zero, so nothing moves it.

---

## 5. Thrust — and `setTorque`'s alibi

`PhysicsEngine::updatePhysics`, `0x0057bfb0`:

```
rho = 1 - clamp(y/airDensityZeroAtHeight, 0, 1)
e   = throttle - rho*(vel·fwd)/setNoPropellerEffectAtSpeed
K   = 0.1*|throttle| + e*|e|          // SIGNED SQUARE, not a linear fade
F   = fwd * K * getCurrentRatio()     // at the ENGINE NODE, not the CoM
```

**`setTorque` is not in that expression.** It scales `getCurrentTorque()`
(`0x0057be10`), whose only caller in the entire binary is `feedbackLoop`
(`0x0057be90`), which spends it on the RPM accumulator behind the **engine
sound**. The force `feedbackLoop` receives is passed by value and the caller
re-derives the applied force afterwards, so nothing it does can reach thrust.

This mattered: `flight-model.md` carried `setTorque` as the thrust parameter
through seven audits and a full recalibration, and the "a loop cannot close from
level cruise" conclusion was arithmetic on an audio parameter.

Thrust scale is `getCurrentRatio()` (`0x0057bd90`) = `3.5 * setDifferential /
gearRatioCurve` — `setDifferential` being the field previously marked
speculative and "not needed".

**Thrust does not fade with altitude; it grows.** `rho` multiplies only the
speed term, so a high propeller does not know how fast it is going. The 1000 m
figure is a *lift* ceiling only.

### The gear-ratio curve — `EngineTemplate::EngineTemplate`, `0x005715d0`

101 floats at `template+0x42c`, filled 1.0, then five control points:
`[20]=3.5, [40]=2.2, [60]=1.5, [80]=1.1, [100]=0.94`. No `.con` binding exists,
so no mod can move it. The sampled index is **100 forever**: `PhysicsEngine`'s
ctor seeds `gear = 1` (lnxded `0x0824c770`), there is no gear-shifting code in
the client, and no aircraft authors `setNumberOfGears` (default 1).

`EngineTemplate::makeScript` (`0x00571290`) prints fields back out with their
`.con` names attached — the anchor that settles which offset is which.
`WingTemplate::makeScript` is `0x005721e0`.

---

## 6. Springs — `PhysicsSpring::updatePhysics`, `0x0057f0d0`

```
accel = −( setStrength * displacement * |g|/9.82 + setDamping * d(displacement)/dt )
```

The `−0.101833` = −1/9.82 normalises to earth gravity, so suspension sag is
gravity-invariant **by design** — and at the shipped g every spring acts at
**1.5× its `.con` strength**. Units: strength is m/s² per metre of displacement,
damping m/s² per m/s.

`c_PGFRollGripWhenOccupied` is mechanical, not descriptive: a wheel with bit 8
set is rewritten every update to grip `10` (…|RollGrip) while occupied and `9`
(…|ContactGrip) while empty. That is how parked vehicles stop creeping downhill.

### Grip is a bitfield, not an enum — `0x0054bb10`

```
NoGrip=0  ContactGrip=1  RollGrip=2  EngineGrip=4  RollGripWhenOccupied=8
DummyGrip=0x20  EngineDummyGrip=0x24  StaticFriction=0x80
```

`EngineDummyGrip = EngineGrip | DummyGrip` proves the bitfield reading. What each
bit does is read out of `ResponsePhysics::addFriction` (lnxded `0x0825b6e0`,
2026-09-16; ledger PHY-2), which tests the live byte at +0xb4:

- **EngineGrip** (4) spins the wheel from the engine: `getCurrentRatio` ×
  `getCurrentDifferentialRPM` into `SpinWheel`.
- **RollGrip** (2) removes the contact velocity along the wheel's own axis, so
  the wheel rolls freely and resists sideways.
- **Neither** — plain contact — takes a Coulomb friction direction, and the
  solver sets **StaticFriction** (0x80) itself once sliding slows below a
  threshold: kinetic friction latching to static.
- **DummyGrip** (0x20) is read from the authored byte +0xb5
  (`getPermanentGrip`), not the live one, and bypasses the friction solve; with
  EngineGrip also set, only the wheel spin is driven.
- **RollGripWhenOccupied** (8) never reaches the solver: `PhysicsSpring`
  rewrites it first (above).

There is no slip-angle curve. The force magnitudes — what actually produces
the BF1942 power slide — were not read, and `ground.js`'s single-`mu` tyre
model is not what the engine does.

---

## 7. An Engine node never poses its own subtree

`EngineTemplate` derives from `RotationalBundleTemplate`, which is the *only*
reason a `.con` may legally write `setInputToRoll c_PIThrottle` on an Engine. But
the object it creates is a `PhysicsEngine` deriving from `PhysicsNode`
(lnxded `0x0824c6f0`) — **not** `RotationalBundle`.

`RotationalBundle::handleUpdate` (lnxded `0x081d78e0`) is the one place those
numbers become a transform, and `PhysicsEngine` does not inherit it. The tail of
`PhysicsEngine::updatePhysics` instead walks two interface queries to one object
and pushes a rotation speed into it: the propeller.

So the axis never poses the Engine node, and never poses its children. The `.con`
syntax looks like it spins the engine and does not. A viewer that falls back to
rotating the Engine node takes the landing gear and wheels round the prop shaft
with it — which is exactly what shipped to production for two days.

---

## 8. Soldier locomotion is hardcoded

Table at `0x009581b4`, indexing at `0x005013f8`:

```
pose  = (flags & 0x20) ? 1 : (flags & 0x40) >> 5     // 0 stand, 1 crouch, 2 prone
index = pose*2 + (forwardInput <= 0 ? 1 : 0)
directionalSpeed[6] = {6, 4, 2, 2, 1, 1}             // 0x009581b4
strafeSpeed[3]      = {4, 2, 1}                      // 0x009581cc
walkSpeedFactor     = 1/3                            // 0x009581d8
```

Stand 6 forward / 4 back, crouch 2/2, prone 1/1. The **pairing** is settled by
the indexing code, not inferred from table layout. `walkSpeedFactor` has a write
xref (`0x004f1302`), so it is mutable at runtime.

`aiTemplatePlugIn.maxSpeed 5.0` is the **AI plugin's** number and is not the
player's. A walk mode built to that line is visibly wrong.

**Jump velocity is still `open`**, but the trigger is read and three hiding
places are ruled out (2026-09-16, ledger PHY-1). In the client's
`handlePlayerInput` (`0x00500190`) the jump bit 0x80 is set only when the
soldier is standing (0x60 clear), Action is held, the soldier has a +0x140
pointer and a non-zero word at `[esp+0x2c]`, and `BFSoldier::getSoundTrigger`
(`0x004f5c60`) is not `c_SstJump`: the upper body's current sound trigger, or
the lower body's when the upper has none, so a soldier already in a jump state
cannot jump again. Sound triggers are console constants, identical in both
binaries — `c_SstStand` 1, `c_SstWalk` 2, `c_SstRun` 3, `c_SstJump` 4, then
`c_SstToCrouch` 6 through `c_SstClimbLadder` 23 (table in symbols `0x08298280`).
The server's copy of the gate is dead code. No `.con` word in any mod sets a jump strength,
`AnimationState` has no velocity primitive, and neither `handlePlayerInput` nor
the server's `handleFrameUpdate` writes the velocity of the soldier's physics
node (`IObject+0x60`).

There is no ragdoll because the bones were never dynamics:
`setSkeletonCollisionBone` capsules are hit regions for damage only.

---

## 9. The walking view bob is multiplied by a shipped zero

See ledger rows **CS-1..CS-6** for the full evidence. In short:

- `getCameraShakeTransform` (`0x00613e90`): per channel,
  `amplitude * sin(rate * t) * fade * cameraShakeFactor`, `t` a seconds
  accumulator advanced `t += dt`. **The third `.con` argument is an angular rate
  in radians per second** — 15 rad/s is 2.387 Hz. Not Hz, not a duration.
- The **first** argument is a slot index 0..2; a state may chain three shakes.
  All of vanilla uses slot 0.
- `fadeIn`/`fadeOut` are **rates**, not durations: `0.6` is a 1.67 s ramp.
- **Nothing scales the shake by ground speed.**
- `BFSoldier::updateCameraShake` (`0x004facd0`) passes `cameraShakeFactor`
  (`0x0099000c`) to the **lower-body** state machine — which owns every
  `Lb_Walk/Run/Crouch/Lie` state — and a hardcoded `1.0f` to the upper-body and
  trigger machines. That global is `0.0f` at start-up — it lies past `.data`'s
  raw bytes (which end at `0x00960000`), so the loader zero-fills it — and no
  vanilla file assigns it.

**Retail BF1942 has no first-person walking view bob.** DICE authored the
amplitudes, tuned them, and shipped them inert. Weapon recoil and explosion
shakes are unaffected.

---

## Still open

| | |
|---|---|
| Jump impulse velocity | the client's gate is read and three places are ruled out (§8, ledger PHY-1): no `.con` word, no `AnimationState` primitive, no velocity write in `handlePlayerInput` or the server's `handleFrameUpdate`; the per-list call (lnxded `0x082751bf`, client `0x00501613` by shape) is `ActiveKitPart::update`. Next: `BFSoldier::updateAnimations` (`0x004fb150`), the class of the physics node at `IObject+0x60`, and the client's own `handleFrameUpdate` |
| ~~Per-bit grip force semantics~~ | **closed 2026-09-16** for what each bit selects (§6, ledger PHY-2); the force magnitudes behind the power slide remain unread |
| ~~Whether the frame timer clamps `dt` before `World::update`~~ | **closed 2026-09-15** — there is no frame `dt` to clamp: the dispatch is `GameClient::simulateFrame(1/30)` run `nTicks` times per frame (§3); the tick *count* is clamped (>10 → 1 in `InputManager::update`, >9 → 1 in `GameClient::update`) |
| ~~`submarineData`'s 7 parameters~~ | **closed 2026-09-16** for five of them (ledger PHY-3): the 6th is the crush depth, the 5th the depth below which oxygen drains (with the 4th, the periscope pair), the 1st the drain rate and the 2nd the refill rate, capped at 1.0. The 3rd and 7th (suffocation and crush damage) are not re-verified |
| ~~Drag's `r` and `scale` factors~~ | **closed 2026-09-16** — `r` = `getBoundingRadius()`, delegated to the composite object; `scale = 1 + 24·min(underWater/r, 1)`, clamped above only, `underWater` = +0x44 (§3) |
| What selects `PhysicsNode`'s Advanced drag | the two laws are read (§3, 2026-09-16), but not what sets the composite object's byte +0x7 bit 0x4: no `.con` word, no `or` of that bit anywhere in either binary, and not `SimpleObjectTemplate::setPhysicsNodeComponent`, which only picks the node class. It decides which drag an aircraft really gets (see features/flyable-vehicles/flight-model.md) |
| A spawned particle's mass and bounding radius | the body defaults to mass 1.0; the radius a sprite or mesh particle reports is unread — the blocker for replacing `effects-core.js`'s exponential drag |
| B17 `setDifferential` tension | 4 nacelles at 1.9 = 7.6 vs a fighter's 5. Code reading is quadruple-anchored, so this is evidence about the `.con` data or the gear table — **do not re-tune on it** |
