# BF1942 Refractor aircraft flight model — reference

The `Wing` / `Engine` physics of vanilla BF1942 aircraft, reconstructed from
shipped data for reimplementation in the map viewer (JS/Three.js), focus
vehicle the Corsair (Wake). Companion documents: [README.md](README.md)
(architecture spine), [input-and-cockpit.md](input-and-cockpit.md) (the
`c_PI*` enum, `setInputTo*` semantics, camera).

Survey method (repo convention: measure before you decompile): all `.con`
files of all 13 vanilla aircraft parsed and tabulated
(105 Wing templates, 16 Engine templates, 21 PlayerControlObjects), plus
value tallies across the whole of `Objects.rfa` (141 `setFlapLift` lines, 27
`setRegulateToLift`, 54 `setPitchOffset`, ...) and a grep of all 72 vanilla
archives for global physics settings. Survey script:
`survey_flightmodel.py` in the session scratchpad. Confidence tags:
`confirmed` (data proves it), `strong inference` (one sensible reading of the
data), `speculative`.

Ghidra was opened once, afterwards, and for one number: **gravity**. The value
this document originally inferred was wrong, and because everything in section
8 is calibrated against it, being wrong about it was expensive. Section 2c
carries the correction and the evidence; section 9 carries the re-derivation
it forced. The lesson is in the ledger: a constant that the whole model hangs
off is worth an hour of decompiling even when the data "corroborates" the
guess, because a corroboration you went looking for is not evidence.

**Then it was opened a second time, and the rest of section 8 went the same
way.** `calculateLift`, `PhysicsWing::updatePhysics`, `PhysicsEngine::
updatePhysics`, `Wing::handleUpdate` and `Wing::calculateNeutralLift` have all
been read; **section 2d** carries them with their addresses. Everything they
touch is now `confirmed` rather than inferred, and every fitted constant this
document used to carry is dead. What survives as `[free]` is one number: the
solid-box inertia estimate. The lesson repeats with more force — `setTorque`,
which four years of reading this data called "peak thrust", turns out to drive
nothing but the engine sound, and no amount of staring at `.con` files was ever
going to say so.

Coordinate convention used throughout (matches the extracted scenes):
**x right, y up, z forward (nose)**; rotation triples are **yaw/pitch/roll**.
`confirmed` — Corsair engine sits at z = +4.149 (nose), tail surfaces at
z ≈ -3.5, wheels at y < 0.

---

## 1. The architecture verdict first (Q3)

**The Refractor flight model is a real — crude, but real — per-surface
aerodynamic simulation. Control input never applies torque to the aircraft
directly. Input deflects `Wing` surfaces; each `Wing` turns local airflow
plus its deflection into a force at an authored application point; the
off-centre application points produce the roll/pitch/yaw torques.**
`confirmed`, by data alone. The evidence, in order of strength:

1. **The Ilyushin separates animation from physics completely**
   (`Objects/Vehicles/Air/Ilyushin/Physics.con`). Its *visible* ailerons are
   `RotationalBundle`s — geometry, input, no aero properties:

   ```con
   ObjectTemplate.create RotationalBundle IlyushinFlapL
   ObjectTemplate.geometry ILyushin_LFlap_M1
   ObjectTemplate.setAcceleration 0/-110/0
   ObjectTemplate.setInputToPitch c_PIRoll
   ```

   and its *physics* ailerons are `Wing`s with **no geometry at all**, driven
   by the same input at the same rates so the two stay in sync:

   ```con
   ObjectTemplate.create Wing IlyushinLeftWing        rem  <- no geometry line
   ObjectTemplate.setAcceleration 0/-110/0
   ObjectTemplate.setInputToPitch c_PIRoll
   ObjectTemplate.setPositionOffset 1.5/0/0.104
   ObjectTemplate.setWingLift 3
   ObjectTemplate.setFlapLift 2
   ```

   Same split for its rudder (`IlyushinRudderRC` RotationalBundle +
   `IlyushinVerticalRudder` meshless Wing) and its lift regulator
   (`IlyushinAirbreak`, meshless). An invisible Wing is pointless unless the
   Wing class itself generates force from its deflection state.

2. **Every aircraft carries Wings that take no input at all** and exist only
   to make force: the `*BodyWingVertical` fin on all 13 aircraft
   (`setWingLift 2`, `setFlapLift 0`, no input — passive yaw stability), and
   the regulator flaps (section 5). If input made torque directly, none of
   these templates would do anything.

3. **`setPositionOffset` is authored to move force application points.** On
   every regulator flap it is the *exact negation* of the part's
   `addTemplate` position — Corsair: attach `-2.563/-0.134/0.895`, offset
   `2.564/0.135/-0.895` — placing the applied force at the bundle origin
   (the CoM) so sustaining lift produces no torque. Nobody negates a vector
   to the third decimal for decoration.

4. **Wing is a generic aero-surface class reused everywhere forces are
   needed**: bombs and torpedoes (`Bomb_wing` / `Torpedo_Wing`,
   `setWingLift 0.2` and nothing else — pure weathervane stabilisation),
   the Katyusha rocket's fin, and every ship's rudder
   (`Fletcher_rudder`: `setWingLift 0`, `setFlapLift 2` — force from
   deflection only, driven by `c_PIYaw`). Ships steer through the same code
   path planes roll with.

5. **The purely cosmetic RotationalBundles use the same mirrored
   `setAcceleration` signs as the physical Wings** (Ilyushin FlapL `-110`
   vs FlapR `+110`), which proves the sign is input-to-deflection wiring in
   the servo, not anything about lift (section 3).

Consequence for the reimplementation: build a small per-surface aerodynamics
loop (section 8), not a "roll torque = k × roll input" arcade shim. Roll
authority, pitch trim, yaw stability, aerodynamic damping and stall-like
sink all *emerge* from the surface list — that is how DICE tuned these
planes, and it is why the .con files contain no "roll rate" number anywhere.

---

## 2. Parameter reference (Q1)

Complete — the full command inventory ever used on vanilla `Wing` templates
is 18 commands (tallied across `Objects.rfa`); `Engine` adds 9 more; nothing
else exists in shipped data.

### 2a. Wing

| Command | Units / sign | What it does | Vanilla aircraft range | Confidence |
|---|---|---|---|---|
| `setMinRotation` / `setMaxRotation` | deg, y/p/r triple | Deflection clamp on the surface's hinge axis (always the **pitch** component for aircraft surfaces) | ailerons ±25..±30; elevators −10..+20 (asymmetric, all planes); rudders ±15 (Ilyushin ±25); regulators ±2 (B17 brakes ±30) | confirmed |
| `setMaxSpeed` | deg/s, triple | Servo travel-rate cap | ailerons 110–150; elevators 30–60; rudders 60–150; regulators 30 (B17 brakes 3) | confirmed |
| `setAcceleration` | deg/s², triple; **sign = direction wiring** | Servo acceleration toward the commanded deflection; its sign maps input sign to deflection sign (section 3) | magnitudes 30–150 | confirmed |
| `setInputTo<Axis> c_PI*` | — | `<Axis>` names the part's own hinge; the argument names the player input (see input-and-cockpit.md §2) | pitch hinge everywhere | confirmed |
| `setAutomaticReset` | 0/1 | Input 0 → surface runs back to 0° at the same rates | 1 on all input-driven surfaces | confirmed |
| `rememberExcessInput` | 0/1 | Input past saturation accumulates and must be unwound (mouse-pitch feel); elevators only, all 13 aircraft, 24 uses, nowhere else in vanilla | — | confirmed distribution, strong inference meaning |
| `setWingLift` | dimensionless coefficient | **Passive lift ∝ surface angle of attack** (body attitude + incidence vs local flow). This is what stabilises bombs (`Bomb_wing` has *only* this) and damps rotation | 0.5 (elevators) – 3.2 (Stuka fin); 0 on ship rudders | confirmed role, see §4 |
| `setFlapLift` | dimensionless coefficient | **Control lift ∝ hinge deflection**. Ship rudders have `wingLift 0, flapLift 2`: force from deflection only | 0 (fins) – 4 (regulators) | confirmed role, see §4 |
| `setPositionOffset` | metres, **parent-body frame**, added to the part's attach position | Moves the force application point: `apply = attachPos + positionOffset` | regulators: exact negation of attach (→ CoM); ailerons/elevators: ±0.5 pulled inboard; rudders: 0/−0.5/0 pulled down the fin | confirmed (see §4b) |
| `setPitchOffset` | degrees | Static incidence added to the surface's aero angle — a built-in +0.5° AoA so lifting surfaces lift at zero body AoA. Value is 0.5 in 53 of 54 vanilla uses; the single 0 is the Katyusha rocket's fin, which must not veer | 0.5 | strong inference |
| `setRegulateToLift` | m/s² | Target for the closed-loop lift regulator; **4.91 = g/3 in every one of the 27 vanilla uses** (g = 14.7295, §2c; 14.7295/3 = 4.9098). A fighter's two surfaces therefore budget two thirds of gravity, the SBD's three exactly all of it | 4.91 only | confirmed value, strong inference units |
| `setWingToRegulatorRatio` | dimensionless | Regulator scaling; 1 everywhere except the B17's two ±30° brakes (3.0). Exact semantics not recoverable from data (loop gain vs target multiplier) | 1, 3.0 | speculative |
| `setPivotPosition` | metres | Hinge pivot relocation; only 2 vanilla uses, both `0/0/0` (SBD flaps) — a no-op. Ignore | 0/0/0 | confirmed inert in vanilla |
| `geometry` | — | Optional. A Wing without geometry is an invisible force generator (Ilyushin) | — | confirmed |

Non-physics: `setNetworkableInfo`/`networkableInfo`, `loadSoundScript`.

### 2b. Engine (aircraft, `setEngineType c_ETPlane`)

Corsair's engine, representative of all fighters (`confirmed`; B17 differs
only where noted):

```con
ObjectTemplate.setMinRotation -0.3/0/-3000
ObjectTemplate.setMaxRotation 0.3/0/5000
ObjectTemplate.setMaxSpeed 1000/0/500
ObjectTemplate.setAcceleration 500/0/1000
ObjectTemplate.setInputToRoll c_PIThrottle
ObjectTemplate.setAutomaticReset 1
ObjectTemplate.setEngineType c_ETPlane
ObjectTemplate.setTorque 15
ObjectTemplate.setDifferential 5
ObjectTemplate.setGearUp 0.7
ObjectTemplate.setGearDown 0.3
ObjectTemplate.setNoPropellerEffectAtSpeed 70
```

| Command | Meaning for `c_ETPlane` | Values across vanilla aircraft | Confidence |
|---|---|---|---|
| roll axis of min/max/maxSpeed/accel | The **crankshaft accumulator**: throttle input spins this axis. `maxSpeed[roll] = 500` deg/s is the visual prop rate at full throttle, `accel[roll] = 1000` deg/s² the spin-up. Bounds −3000/+5000 are accumulator limits — the 0.6 ratio matching weaker reverse (see below) | identical on all 16 engines except B17 props 500–600 | confirmed binding, strong inference details |
| yaw axis (±0.3°, speed 1000, accel 500) | No input is bound to it; present on every single-engined plane, zeroed on all four B17 engines. At most a cosmetic engine-block vibration; possibly dead data. **Ignore it** — 0.3° is invisible | ±0.3 fighters, 0 B17 | speculative |
| `setTorque` | **Nothing to do with thrust.** It scales `getCurrentTorque` (`0x0057be10`), whose only caller in the entire binary is `feedbackLoop` (`0x0057be90`), which spends the result on the RPM accumulator behind the engine sound. This row used to read "peak thrust as acceleration" and it was wrong for four years | 15 (fighters), 14.25 (SBD/Stuka/Ilyushin), 2.6 × 4 (B17) | confirmed *not* thrust |
| `setDifferential` | **The thrust parameter.** `getCurrentRatio` (`0x0057bd90`) returns `3.5 × setDifferential / gearRatioCurve`, and that is the scalar `PhysicsEngine::updatePhysics` multiplies its thrust by. Corsair: 3.5 × 5 / 0.94 = **18.617 m/s² per unit of K** (§2d) | 5 planes, 1.9 B17, 2 ships, 7 the Willy | confirmed |
| `setNoPropellerEffectAtSpeed` | **Forward speed (m/s) at which the speed term cancels the throttle.** Not where thrust reaches zero — past it the signed square goes negative and the propeller becomes an airbrake (§2d). The cross-fleet gradient still reads the same way: fighters 70; B17 inboard 70 / outboard 120; PT boats 150; the survivors' *rafts* 15; the Katyusha *rocket* 1000 | 70 / 120 / 150 / 15 / 200 / 1000 | confirmed field, corrected meaning |
| `setGearUp` / `setGearDown` | Transmission shift points as fraction of max revs — car legacy (`c_ETCar`/`c_ETTank` use 0.95/0.4–0.45 with `setNumberOfGears 5`). **Inert for `c_ETPlane`**, now confirmed from the other end: there is no gear-shifting code in the retail client at all. `Engine`'s constructor seeds `gear = 1` and nothing ever writes it again, so `getCurrentRatio` samples one fixed point of the gear curve forever. Note these are *not* the landing-gear thresholds — `LandingGear` templates carry their own (`setGearUpEngineInput 0.7` / `setGearDownEngineInput 0.4`, vs the Engine's 0.7/0.3) | 0.7 / 0.3 all aircraft | confirmed inert |

Comparison anchors (`confirmed`, read from `Objects.rfa`):
`WillyEngine` `c_ETCar` torque 10.5 diff 7, roll ±5000, maxSpeed 55000;
`ShermanEngine` `c_ETTank` torque 4 diff 4, yaw *and* roll span ±1° (the
body-lean documented in `bf42/con.py`); `Fletcher_Engine` `c_ETShip` torque
2 diff 2, `setNoPropellerEffectAtSpeed 120`.

### 2c. Body (PlayerControlObject, `Objects.con`)

| Command | Meaning | Corsair | Fleet range | Confidence |
|---|---|---|---|---|
| `mass` | kg | 2500 | 2500–3000 fighters/DBs, 25000 B17 | confirmed |
| `drag` | **Linear velocity damping, s⁻¹**: dragAccel = −drag·v. Terminal dive velocity = g/drag ≈ 226 m/s (Corsair), 118 (B17) — quadratic drag would give an absurd 15 m/s, so it is linear. (Both figures moved with the gravity correction below; the reading they support did not) | 0.0652 | 0.061–0.125 | strong inference |
| `inertiaModifier` | y/p/r multipliers on the engine-computed inertia tensor | 1.05/0.850/0.94 | 0.6–1.125 | confirmed field, inference on base tensor |
| `hpLostWhileUpSideDown` | HP/s while inverted (100 max HP → 10 s inverted = dead) | 10 | 10 all aircraft | confirmed value; whether it requires ground contact untested |
| `angleMod` / `speedMod` | collision-damage modifiers, not flight | 1 / 2 | identical | speculative |
| `explosionForceMod`, `hpLostWhileDamageFromWater`, etc. | damage system, out of scope | — | — | — |

### Gravity — CORRECTED

**This section used to say the engine default was −9.81. It is −14.7295.**
`confirmed`, by decompilation. Recording the correction in full, because the
wrong number was load-bearing for everything in §8 and §9.

**What it said**: "no `physics.gravity` (or any `physics.*`, or air density)
appears anywhere in the 72 vanilla archives — `confirmed` absence. The engine
default is −9.81, `strong inference`, corroborated *from inside the data* by
`setRegulateToLift 4.91` × 2 surfaces = 9.82."

**What the client says**: `BasicPhysicsSystem::BasicPhysicsSystem` at
**`0x00578f00`** in the retail client writes the literal `0xC16BAE14` into the
field at +0x8 — the one the get/set vtable slots touch — which is the IEEE-754
single **−14.7295379**. The same constructor writes `0x447A0000` = 1000.0 to
`airDensityZeroAtHeight` at +0x30, and zeroes the wind vector at +0xc..+0x14.

**Why no override can be hiding**: the question is closed by exhaustion, not by
absence of evidence. All 31 xrefs to the singleton (`DAT_0097d770`) are
classified. The only `setGravity` callers are the chat cheat handler at
`0x00729b30` — `EarthWalk` → −10.0, `MoonWalk` → −1.67, `SpaceWalk` → −0.1 —
and the `Physics` console property setter registered at `0x004c2370`. No map
load path touches it; everything else is a getter. The original finding stands
and gains force: `physics.gravity` appears in no vanilla file, and the default
*is* the value the game runs at.

Addresses are in `features/bf1942-engine-reference/symbols.json` under
subsystem `physics`; browse with `./xref.py list physics` and
`./xref.py sym 0x00578f00` from that directory.

**How the "corroboration" misled**: `setRegulateToLift 4.91` really is a
gravity fraction — it is g/**3**, not g/2. 14.7295/3 = 4.9098, which rounds to
4.91 with 0.0002 to spare; 9.81/2 = 4.905 needs 0.005. The tighter fit is the
true one, and the fleet confirms it by distribution rather than by arithmetic:

| Aircraft | Regulators × 4.91 | Fraction of g | Balance comes from |
|---|---|---|---|
| SBD / SBD-T | 3 → 14.73 | **exactly 1** | nothing needed |
| Corsair and the other fighters | 2 → 9.82 | 2/3 | `wingLift` surfaces at +0.5° incidence |
| Ilyushin | 1 → 4.91 | 1/3 | its `setWingLift 3` main wings, same way |

§5 already recorded the three-and-one counts as an unresolved bookkeeping
oddity ("the target is per surface with saturation doing the balancing, not an
exact global budget"). With g = 14.7295 they stop being odd: the regulator
budget is a per-surface third of gravity, and an aircraft carries as many
thirds as its passive wing area does not already provide. That is a stronger
reading of the data than the one it replaces, and it was reachable from the
data alone — the 9.81 assumption is what prevented it.

**Consequences elsewhere in this document**: terminal dive g/drag moves from
150 to 226 m/s (§2c, §5); the stall account in §4c is no longer "regulators
versus 9.81" but "regulators plus incidence versus 14.73"; and `K_LIFT` was
re-derived in §9 because its old value was fitted against the old g — before
being retired outright once the lift equation itself was read (§2d, §9a).

**CoM**: the PCO origin. `confirmed` by authoring: the regulator offsets
negate their attach positions to land exactly there, and `lodCorsair` /
`CorsairComplex` are attached at zero offset.

---

## 2d. The equations, read

Everything in this section is `confirmed` by decompilation. Addresses are the
retail client catalogued in `features/bf1942-engine-reference` (sha256
`60c9452d...`, subsystem `physics`); browse with `./xref.py list physics` and
`./xref.py decompile <addr>` from that directory. Where a reading was settled
on the Linux dedicated server instead — because it is unstripped and the
client is not — the `bf1942_lnxded.static` address is given and the fact is
marked *(lnxded)*.

### The lift equation — `dice::ref2::world::calculateLift`, `0x0057fa90`

```c
float calculateLift(const Vec3& vel, const Vec3& surfaceUp, float coeff) {
    float len = |vel|;  if (len == 0) return 0;
    float s = clamp(dot(vel/len, surfaceUp), -1, 1);
    float a = asin(s) * 57.29578;                      // DEGREES
    float c = (fabs(a) >= 45) ? 0
            : (a >= 0) ? a*(45 - a)/506.25 : a*(45 + a)/506.25;
    return (0.75*c + 0.25*s) * len*len * coeff * 0.0025;   // m/s^2
}
```

Matched instruction-for-instruction against `0x0824eb20` *(lnxded)*, which
carries a fourth leading `Vec3` its body never reads. Four things in it:

- **The speed exponent is 2.** `len*len`. §9c item 1 is closed, and it was the
  last thing standing between §8 and a data-derived lift term.
- **The coefficient curve is the stall model.** `c` peaks at exactly 1.0 at
  22.5°, and is *hard zero* past ±45°. Past the cliff only the `0.25*s` term
  survives, so a surface keeps about a fifth of its peak lift rather than
  none — which is why a tumbling aircraft is not weightless. Nothing in the
  data declares a stall angle because the engine hard-codes one.
- **It returns an acceleration**, not a force. Settled two ways: the caller
  hands it to `addAccelerationAtAbsolutePosition` (the only `add*At*` family in
  the binary — there is no `addForceAt` anywhere *(lnxded symbol table)*), and
  the regulator adds the return directly to `setRegulateToLift`, which is
  4.91 = g/3.
- Small-angle slope `0.75×45/506.25 + 0.25×π/180` = **0.07103 per degree** =
  4.0699 per radian. MSVC folded the `/506.25` into a multiply by
  0.0019753086419753087, which is why a byte search for 506.25 misses.

### The wing — `PhysicsWing::updatePhysics`, `0x0057fbf0`

```
coeff  = (setWingLift + setFlapLift) * getGravity() * -0.101833
flow   = velocityAt(surface world position) - wind
L      = calculateLift(flow, surfaceUp, coeff) * medium
force  = -clamp(L, -200, +200) * surfaceUp
         applied as an ACCELERATION at the surface's world position
medium = 10.0 submerged, else 1 - clamp(y / airDensityZeroAtHeight, 0, 1)
```

- **The two authored lift values are summed into one coefficient.** §4a used to
  say `setWingLift × AoA` and `setFlapLift × deflection` were independent
  terms. They are not; there is no deflection term in this function at all.
  The `-0.101833` is `-1/9.82`, the same gravity normalisation `PhysicsSpring`
  uses, so at the shipped g the coefficient is a flat **×1.49995**.
- **The force is applied off-centre**, at the surface's own world position, so
  the pitch, roll and yaw moments are `r × F` over the surface list and nothing
  has to declare them. §4b's table is the rigid-body layout, as it always said.
- **Lift fades to nothing at 1000 m.** `airDensityZeroAtHeight` is seeded 1000.0
  by `BasicPhysicsSystem`'s constructor and authored by no vanilla file, so
  every Refractor aircraft has a hard service ceiling one kilometre up. Newly
  read, and previously unmodelled.
- **Submerged surfaces make ten times the lift.** Which is how a `HullWing`
  steers a Fletcher.
- **±200 m/s² per surface.** 13.6 g, so it binds only in a crash.

### How `setWingLift` and `setFlapLift` are told apart — `Wing::handleUpdate`, `0x08250950` *(lnxded)*

They are summed into the coefficient, but they are *not* interchangeable, and
this is where the difference lives:

```
angle = deflection * setFlapLift / (setWingLift + setFlapLift) - setPitchOffset
transform = rotateXDeg(angle) * bundleTransformation
```

`setFlapLift` is **the moving share of one surface's area**. A ship rudder
(`wingLift 0 / flapLift 2`) swings all of it; a body fin (`2 / 0`) none; a
Corsair elevator (`0.5 / 0.5`) half, so its 20° of hinge is ten degrees of
aerodynamic angle. This is a better reading than the one it replaces and it
explains the population: `flapLift 0` surfaces are the ones that never move.

**`setPitchOffset` is a real rest incidence.** It is subtracted from the angle
at every update for every Wing, so a surface with `setPitchOffset 0.5` sits at
half a degree of incidence whether or not it regulates. That closes the open
question — 53 of 54 vanilla uses are 0.5 and the one 0 is the Katyusha rocket's
fin, which has no regulator and must not veer, and that only ever made sense if
the value biased the surface itself.

`rotateXDeg` builds row 1 = `(0, cos, sin)` (`setRotateXDeg`, `0x08251240`
*(lnxded)*), so a positive `setPitchOffset` tilts the normal forward and makes
*upward* lift, which is the sign an incidence is supposed to have.

### The regulator — the tail of `PhysicsWing::updatePhysics`, and `Wing::calculateNeutralLift`, `0x00580280`

Gated on the template's regulate-enabled flag:

```
refFlow = parentForward * |v|
command = clamp((calculateLift(refFlow, surfaceUp, coeff)
                 + calculateNeutralLift(refFlow, -setPitchOffset, coeff)
                   * setWingToRegulatorRatio
                 + setRegulateToLift) * getGravity() * 0.101833, -1, +1)
```

`calculateNeutralLift` builds `rotateXDeg(-setPitchOffset)`, composes it with
the wing's own bundle transform *and* its parent's world transform, and takes
row 1 — so it is exactly the lift this surface would make undeflected, and
`setWingToRegulatorRatio` is a feed-forward that discounts it. §5's closed loop
is verified rather than inferred. Three consequences the prose did not have:

1. **The reference flow is the body's forward axis, not the real one.** The
   regulator is speed-scheduled and knows nothing about angle of attack. It
   cannot save a stalled aircraft and it goes on working with the nose nowhere
   near the flight path.
2. **The command is an input in −1..1, not an angle.** It lands in the slot a
   player input would occupy and the ordinary ±2° servo chases it at
   `setMaxSpeed 30`. So the loop is *proportional* and it saturates; there is
   no integrator and a steady-state error is normal.
3. **`setRegulateToLift 4.91` is also `WingTemplate`'s constructor default**
   (`0x082514c0` *(lnxded)*, +0x1cc = `0x409d1eb8`), along with
   `setWingLift 1.0`, `setFlapLift 0.1`, `setPitchOffset 0.0` and
   `setWingToRegulatorRatio 1.0`. All 27 vanilla uses restate the default.

### Thrust — `PhysicsEngine::updatePhysics`, `0x0057bfb0`

```
rho = 1 - clamp(y / airDensityZeroAtHeight, 0, 1)
e   = throttle - rho * (vel . fwd) / setNoPropellerEffectAtSpeed
K   = 0.1*|throttle| + e*|e|                  // SIGNED SQUARE
F   = fwd * K * getCurrentRatio()
      applied as an ACCELERATION at the ENGINE NODE, not the centre of mass
```

- **`e*|e|` is a signed square, not a linear fade.** §6's `clamp(1 - v/70, 0, 1)`
  is wrong in shape and wrong at the end: past the fade speed `K` goes negative
  and the propeller becomes an airbrake worth several g. That, not `g/drag`, is
  what caps a dive.
- **`0.1*|throttle|` never fades**, so an engine at the fade speed still makes
  a tenth of its scalar.
- **`rho` multiplies only the speed term.** So thrust does *not* fade with
  altitude — it **grows**, because a high propeller does not know how fast it is
  going. The 1000 m ceiling is a lift ceiling only. (The brief this rebuild was
  written from said thrust faded to zero there as well; the binary says
  otherwise.)
- **It is applied at the engine node.** §6 said "apply it at the CoM,
  deliberately, because applying it at the nose would pitch the plane hard".
  The engine does apply it at the nose, and it does pitch the plane: a
  Corsair's hub is 0.446 m above the CoM and the nose-down moment that makes
  costs about a quarter of a degree of trimmed angle of attack.

### The thrust scalar — `getCurrentRatio` `0x0057bd90`, and `setTorque`'s alibi `0x0057be10`

```
getCurrentRatio() = 3.5 * setDifferential / lerp(gearRatioCurve, index)
index             = (gear / setNumberOfGears) * 100
```

`setTorque` is absent from the thrust expression entirely. It scales
`getCurrentTorque` (`0x0057be10`), whose **only caller in the whole binary** is
`feedbackLoop` (`0x0057be90`), which normalises an engine-load ratio into the
RPM accumulator behind the engine sound — and which takes its force argument by
value, so nothing it does can reach the thrust. §2b's "peak thrust as
acceleration" row is retired.

**The gear-ratio curve is read, and it is not data.** `EngineTemplate`'s
constructor (`0x005715d0`) allocates 101 floats at template+0x42c, fills them
all with 1.0, and then authors five control points with an
adjacent 128-bit "explicitly set" mask:

| index | 0 | 20 | 40 | 60 | 80 | 100 |
|---|---|---|---|---|---|---|
| gearRatioCurve | 1.00 | 3.50 | 2.20 | 1.50 | 1.10 | **0.94** |

There is no `.con` binding for it and no curve string anywhere in the binary,
so no mod can move it. The companion `torqueCurve` sits at template+0x26c and
is authored 0.7 / 0.8 / 0.9 / 1.0 / 0.85 / 0.7 at indices 0/10/30/60/85/100.
`EngineTemplate`'s own defaults are `setDifferential 10.0`, `setTorque 60.0`,
`setNumberOfGears 1`.

**Which entry an aircraft samples: index 100.** `PhysicsEngine`'s constructor
(`0x0824c770` *(lnxded)*) writes `gear = 1` into field +0xbc and nothing in
either binary ever writes it again — there is no gear-shifting code in the
retail client, only a debug readout — and no aircraft authors
`setNumberOfGears`, whose default is 1. So `index = 100` forever and the
divisor is **0.94**.

For the Corsair that is `3.5 × 5 / 0.94` = **18.617 m/s² per unit of K**, and a
thrust-to-weight at rest of `18.617 × 1.1 / 14.7295` = **1.39**. §9c item 3 is
closed on both halves.

### The B17 tension, checked and left standing

Four engines at `setDifferential 1.9` is 7.6 units against a fighter's 5, and
since thrust is an acceleration that means the 25,000 kg bomber out-accelerates
the 2,500 kg fighter off the line — 31.1 m/s² against 20.5. The `.con` values
were re-read from `Objects.rfa` and they are what this document already said;
all four B17 nacelles really are `Engine` templates and all four really do apply
thrust. The code reading is quadruple-anchored, so **this is evidence about the
authored data, not about the equations.**

What rescues it is drag rather than thrust: the B17's `drag 0.125` is roughly
double a fighter's, and its outboard pair carry
`setNoPropellerEffectAtSpeed 120` against the inboard pair's 70, so its level
top speed lands near 56 m/s — sensible for a bomber. Only its standing-start
acceleration is silly, and a B17 spawns airborne on every map that has one, so
nobody would ever have seen it. Recorded, not fixed: do not re-tune
`setDifferential` on the strength of it.

### Integration — `PointPhysicsNode`, `0x00578aa0`

Semi-implicit Euler in **four fixed sub-steps of dt/4**, read
instruction-by-instruction: each sub-step does `v += accel*h` and then
accumulates the position delta with the *updated* v. `World::update`
(`0x004b6cb0`) passes the frame dt through unmodified, with no accumulator and
no clamp. The viewer's sub-stepping is this, with a 240 Hz floor on top so a
0.1 s browser frame gets twenty-four short sub-steps rather than four long ones.

---

## 3. THE KEY QUESTION — opposite aileron deflection (Q2)

**It is pure config sign convention. `setAcceleration`'s magnitude is the
servo acceleration (deg/s²); its sign is the wiring from input sign to
deflection direction. The engine mirrors nothing.** `confirmed`.

Survey across every vanilla aircraft — the sign of the hinge-axis (pitch)
component of `setAcceleration`, with `setMaxSpeed` always positive on the
same axis:

| Aircraft | Left aileron | Right aileron | Elevator L | Elevator R | Rudder |
|---|---|---|---|---|---|
| AichiVal / -T | −150 | +150 | −60 | −60 | +60 / +150 |
| B17 | −120 | +120 | −50 | −50 | +60 |
| Corsair | −120 | +120 | −60 | −60 | +60 |
| Ilyushin | −110 | +110 | −30 | −30 | +150 |
| Mustang | −120 | +120 | −60 | −60 | +60 |
| SBD / SBD-T | −150 | +150 | −60 | −60 | +150 / +60 |
| Spitfire | −120 | +120 | −60 | −60 | +60 |
| Stuka | −150 | +150 | −60 | −60 | +60 |
| Yak9 | −120 | +120 | −60 | −60 | +60 |
| Zero | −120 | +120 | −60 | −60 | +60 |
| bf109 | −120 | +120 | −60 | −60 | +60 |

13 of 13: ailerons opposite-signed (left always negative), elevators
same-signed (both negative — they must move together), rudder single and
positive. The same wiring appears on parts with no aerodynamics at all —
Ilyushin's cosmetic `RotationalBundle` flaps (∓110), the Corsair's
tail-wheel steering (`CorsairWheelBack`, accel −110: castoring geometry
turns it opposite the rudder), the cockpit camera (`setAcceleration
5000/-5000/0`: inverted mouse-Y), and the Fletcher's bow `HullWing` (−10)
vs stern rudder (+10) so the ship carves. One mechanism everywhere.

**The "same maxSpeed sign" oddity, explained**: input-driven parts always
declare positive `maxSpeed` and encode direction in `accel`; `LandingGear`
parts (not input-driven — the retraction cycle drives them) do the
opposite, encoding direction in `maxSpeed` (Corsair right leg: `setMaxSpeed
-30/0/-30`, `setAcceleration 75/0/75`; left leg positive 30 / 75). The
engine evidently composes *both* signs — the effective drive direction is
their product — and vanilla authors simply used whichever field was
convenient per template class. `strong inference` (it is the only rule
consistent with both populations; `bf42/con.py`'s landing-gear comment
reached the same conclusion across 3,173 modded gear axes).

Data quirks to survive (`confirmed`, real bytes in shipped files):

- `ZeroFlapTailRight`, `StukaFlapTailRight`, `AichiValRudderRR` declare
  `setMaxSpeed 0/0/0` on their *bound* axis while their left twins say 60.
  If 0 were a real cap these three right elevators would never move and
  the planes would roll when pitching — not observed in game. **Treat
  maxSpeed 0 as "no cap"** (consistent with Refractor's absent-limits-mean-
  unlimited convention for turrets). Ledger-worthy open point.
- `Aichival-TRudderFR` says `setMaxSpeed 100/150/100` — the unused yaw/roll
  components are garbage. Only read the component of the bound hinge axis.

---

## 4. Forces and torques — how a Wing works (Q3 detail)

### 4a. The two lift terms — CORRECTED

**This section used to say `setWingLift × AoA` and `setFlapLift × deflection`
were two independent terms. They are not.** §2d has the decompilation; the
correction in full, because the old reading is what the first implementation
was built on:

- The engine **sums them into a single coefficient**:
  `coeff = (setWingLift + setFlapLift) × g/9.82`, one number, used once
  (`PhysicsWing::updatePhysics`, `0x0057fbf0`). There is no second term.
- What tells them apart is **the angle**, not the coefficient.
  `Wing::handleUpdate` poses the surface at
  `deflection × setFlapLift/(setWingLift + setFlapLift) − setPitchOffset`, so
  `setFlapLift` is **the moving share of one surface's area**.
- Lift is then `(0.75c(α) + 0.25 sin α) × |v|² × coeff × 0.0025` along the
  surface's own normal, where α is the angle between the local flow and that
  normal — attitude, mounting, incidence and deflection all folded into one
  rotation. **The speed exponent is 2**, which §8's free constants left open.

Everything the old reading was evidenced by still holds, and reads better:
`Bomb_wing` is `setWingLift 0.2` and nothing else, so its coefficient is 0.2
and *none* of it moves — a bomb weathervanes and has no control surface. A ship
rudder is `0 / 2`, so its whole area swings with the hinge. Every
`*BodyWingVertical` fin is `2 / 0`, so none of it does. A Corsair elevator is
`0.5 / 0.5`, so its 20° of hinge is 10° of aerodynamic angle. The consequence
worth stating plainly is the one the old reading hid: **a rudder (0/2) and a
body fin (2/0) go through identical arithmetic**, and differ only in whether
anything moves them.

A surface mounted rolled −89.999° (every rudder, every vertical fin) makes
*sideways* force through exactly the same formula — that mounting trick is why
the class needs no "vertical surface" concept.

### 4b. Where the force is applied — `setPositionOffset` (README open question 2, answered)

`applyPoint = addTemplate position + positionOffset`, both in the parent
body frame. `confirmed` by three independent patterns:

| Surface class | attach (Corsair) | offset | apply point | why |
|---|---|---|---|---|
| Regulator flaps | −2.563/−0.134/0.895 | +2.564/+0.135/−0.895 | ≈ 0/0/0 (CoM) | sustaining lift must not pitch or roll the plane |
| Ailerons | ∓4.129 (x) | ±0.5 | x ≈ ∓3.6 | full span lever for roll, slightly inboard |
| Elevators | ±1.13 (x), −3.54 (z) | ∓0.5 (x) | x ≈ ±0.63, z = −3.54 | long z lever for pitch; inboard x so the pair's roll components cancel |
| Rudder | 0.03/1.88/−2.649 (fin top) | 0/−0.5/0 | y 1.38, z −2.65 | side force behind CoM → yaw; pulled down to reduce roll coupling |
| Vertical body fin | 0/0/0 | 0/0/−0.1 | 0.1 m behind CoM | weathervane: sideslip → restoring yaw |

The parent-frame reading (not wing-local) is fixed by the rudder: its
−0.5 y offset must slide the point down the fin; in the rudder's own
−90°-rolled frame the same numbers would push it sideways, which is
meaningless. `strong inference`, and now `confirmed` from the other end:
`PhysicsWing::updatePhysics` adds `setPositionOffset` to the part's own
translation in the parent frame and applies the result through
`addAccelerationAtAbsolutePosition`.

This table *is* the whole rigid-body layout: torque = Σ r × F over the
surface list, with r = applyPoint (CoM is the origin). Note the static
stability it encodes — main lifting surfaces at z ≈ +0.2..+1.1 (slightly
ahead of CoM), tail surfaces 3.5–5 m behind, fin behind: a conventionally
stable aircraft.

### 4c. Damping and stall are emergent, not parameters

There is no roll/pitch/yaw damping constant and no stall parameter anywhere
in the data (`confirmed` absence — the full Wing command inventory is in
§2a). Both fall out of the per-surface model:

- **Damping**: a rolling plane gives its ailerons a vertical velocity
  component p·r, changing their local AoA by p·r/|v|; their `wingLift`
  responds opposing the roll. Same for pitch (tail arm) and yaw (fin).
  Steady rates are where control lift balances this — which is why DICE
  gave the ailerons `wingLift 1.85` even though "the wing" is nominally the
  body's job.

  The same mechanism, at zero rate, is **static stability**: the tail
  surfaces carry `wingLift` and no incidence 3.5 m behind the CoM, so flow
  arriving at any angle to the fuselage makes lift on a long lever and pushes
  the nose back onto the flight path. Nothing declares it; it is §4b's table
  plus `r × F`. A lumped model does *not* get it for free, and §9d is what it
  costs to put back — a model with no restoring moment has nothing that can
  move the nose except the stick, and therefore no way to recover from a
  stall, because what recovers an aeroplane from a stall is the nose falling.
- **Stall**: there *is* an explicit stall model, and it is in the engine
  rather than in the data. `calculateLift`'s coefficient peaks at 22.5° and is
  hard zero past ±45° (§2d), so a surface has a real maximum and then falls off
  a cliff. On top of that, lift scales with `|v|²` while the required 14.73
  does not, so the whole aircraft has a speed below which *no* angle of attack
  holds it up. For the Corsair that speed is **≈ 17.3 m/s**, swept
  numerically over the surface table with nothing fitted to it (§9e).

  This paragraph used to say "no explicit stall model" and "a Corsair holds
  altitude hands-off at cruise". The first is wrong. The second was an
  inference from the lumped model and does not survive the read equations
  either — see §9e.

  Note what the correction changed here. Under g = 9.81 the two regulators
  were exactly 1 g on their own, so the aircraft was on rails at *every*
  speed above saturation and stall was a single cliff at that speed. Under
  g = 14.7295 it is on rails at one speed — cruise — and trades altitude for
  airspeed either side of it, which is both closer to an aeroplane and closer
  to how BF1942 planes are remembered flying.

---

## 5. The lift regulator — why BF1942 planes hover on rails (Q4)

Every aircraft carries paired input-less Wings amidships (Corsair
`FlapLeftMiddle`/`FlapRightMiddle`, the SBD/Ilyushin "Airbreak"s, B17's
±30° brakes):

```con
ObjectTemplate.setMinRotation 0/-2/0
ObjectTemplate.setMaxRotation 0/2/0
ObjectTemplate.setMaxSpeed 0/30/0
ObjectTemplate.setAcceleration 0/120/0
ObjectTemplate.setPitchOffset 0.5
ObjectTemplate.setPositionOffset 2.564/0.135/-0.895
ObjectTemplate.setFlapLift 4
ObjectTemplate.setRegulateToLift 4.91
ObjectTemplate.setWingToRegulatorRatio 1
```

The engine servos each one's deflection (±2° range, 30 deg/s, at the CoM)
until its lift contribution reaches `setRegulateToLift` = **4.91 m/s² = g/3**
(§2c). All 27 uses in vanilla say 4.91 — which is also `WingTemplate`'s
constructor default, so every one of them is restating it.

**The loop is now read rather than inferred** (§2d), and it is a *proportional*
servo against a *reference* flow along the body's forward axis: it knows the
speed and not the angle of attack, it saturates, and it carries a steady-state
error. What it holds is `setRegulateToLift` discounted by the surface's own
undeflected lift, which `setWingToRegulatorRatio` feeds forward. The count per aircraft is then a
budget, not an oddity: the SBD's three surfaces come to exactly 1 g, a
fighter's two to two thirds, the Ilyushin's one to a third, and in the last
two cases the passive `wingLift` surfaces at +0.5° incidence make up the
remainder. This closed loop, not player skill, is most of what holds a BF1942
plane level; it is also why there is no flaps key. B17's
`wingToRegulatorRatio 3.0` on a ±30° range compensates its 10× mass; 1
everywhere else.

(This paragraph used to read "4.905 m/s² = g/2 — two surfaces = exactly
gravity", and filed the three-and-one counts as an unresolved bookkeeping
caveat. Both were artefacts of the wrong g.)

Level top speed, climb and stall were predicted here from a lumped model. All
four predictions are superseded by §9e, which measures them under the read
equations; the ones that moved and why:

| | predicted here | measured under §2d |
|---|---|---|
| Level top speed | 53.7 m/s, one number | **49.4 at the deck, 55.8 at 200 m** — thrust's speed term is scaled by an air density that thins with height, so there is no single top speed. The AI's authored 55.0 sits between them |
| Terminal dive | 226 m/s (= g/drag) | **≈ 54 m/s held vertical at the deck** — past the fade speed the propeller is a brake, so g/drag is never approached |
| Stall | "holds altitude hands-off at cruise, sinks below it" | no speed holds altitude hands-off; **≈ 17.3 m/s** is where no angle of attack makes 1 g at all |
| Climb | 36.5 m/s at the AI's 19° cap | unchanged in spirit; the ceiling is now a hard one at 1000 m |

The AI `maxClimbAngle 0.3333` corroboration is left standing but is weaker than
it looked: the real limit on a Refractor aircraft's climb is the 1000 m point
where its wings stop making lift.

---

## 6. Engine and throttle (Q5)

**The two starred lines below were wrong and are replaced by §2d.** Kept as
written, struck through in prose, because what they got wrong is instructive:
both were reasoned from the data alone and both were reasonable.

- `c_PIThrottle` ∈ [−1, +1] (W/S; no separate brake exists — see
  input-and-cockpit.md). The crankshaft accumulator integrates it: spin
  rate = throttle × 500 deg/s, approached at 1000 deg/s². The −3000/+5000
  accumulator bounds echo reverse being weaker than forward (0.6 ratio).
  `strong inference`, untouched.
- ~~**Thrust accel = `setTorque` × throttle × fade(v)**, `fade(v) =
  clamp(1 − v_forward/70, 0, 1)`~~ — **wrong parameter and wrong shape.**
  `setTorque` drives the engine sound and nothing else; the scalar is
  `3.5 × setDifferential / 0.94`, and the fade is
  `0.1|throttle| + e|e|` with `e = throttle − ρ·v_fwd/70`, a signed square
  that goes negative past the fade speed. §2d.
- ~~Thrust application point: unknown. **Apply it at the CoM** — applying
  15 m/s² × 2500 kg at the nose, 0.45 m above CoM, would pitch the plane hard,
  so the real engine cannot be doing that naively.~~ — **the engine does
  exactly that.** It applies thrust at the engine node, it does pitch the
  plane, and the nose-down moment is worth about a quarter degree of trimmed
  angle of attack on a Corsair. "The engine cannot be doing something naive"
  is not an argument; it is a preference.
- The prop LOD swaps static → blurred at `CompareSelector 0.07`
  (`lodCorsairPropeller`): blur when spin exceeds ~7% of max ≈ 35 deg/s.
  `confirmed` threshold, inference on the compared quantity.
- Landing gear is fully automatic (no input): retract above
  `setGearUpHeight 23` m with throttle ≥ `setGearUpEngineInput 0.7`,
  deploy below `setGearDownHeight 25` m or throttle ≤ 0.4; the wheel-bay
  hatches are LandingGear templates on the same triggers. Exact boolean
  combination untested; recommended: `up = alt > 23 && throttle ≥ 0.7 &&
  !onGround`, `down = alt < 25 || throttle ≤ 0.4`, rates from each leg's
  own maxSpeed/accel (30, 75). `confirmed` fields, inference on the logic.
- The Engine's own `setGearUp 0.7 / setGearDown 0.3` are transmission
  legacy, likely inert (§2b).

---

## 7. What `bf42/con.py` currently drops on the floor

Parsed today: `setMinRotation`, `setMaxRotation`, `setMaxSpeed` (signed),
`setInputTo*`, `setAutomaticReset`, `setEngineType`, child placement,
`hasMobilePhysics`, `setContinousRotationSpeed`.

Dropped (needed for flight, in priority order):

1. `setAcceleration` — **including its sign, which is the entire aileron
   mirroring** (README "the finding that answers the aileron question";
   fix plan is there).
2. `setWingLift`, `setFlapLift`, `setRegulateToLift`,
   `setWingToRegulatorRatio`, `setPitchOffset`, `setPositionOffset`.
3. `mass`, `drag`, `inertiaModifier` on the PCO.
4. `setDifferential` and `setNoPropellerEffectAtSpeed` on Engine — those two
   are the thrust model (§2d). `setTorque` and `setGearUp/Down` are wanted for
   the engine sound and for completeness, not for flight.
5. `rememberExcessInput`; `setGearUpHeight`/`setGearDownHeight`/
   `setGearUpEngineInput`/`setGearDownEngineInput` (con.py synthesises gear
   axes from the rotation bounds instead — fine for animation, not for the
   automation logic).
6. Spring `setStrength`/`setDamping`, `Grip` (ground handling, later).

---

## 8. Reimplementation spec — Corsair (Q6)

Everything marked **[data]** is read straight from the .con files above;
**[code]** is read out of the binary (§2d). **There is one [free] number left
in the whole model** — the solid-box inertia estimate — and everything that
used to be marked [free] here is dead. Integrate semi-implicit Euler in
sub-steps of at most 1/240 s, which is what the engine does (four fixed
sub-steps of dt/4, `0x00578aa0`) with a floor added so a long browser frame
does not change the answer.

**Retired, and why. Do not reintroduce any of these.**

| constant | was | verdict |
|---|---|---|
| `K_LIFT = 2.83` | [free], calibrated so level flight closed on g at 53.67 m/s | **dead.** The lift equation is read; the coefficient is `(setWingLift + setFlapLift) × g/9.82` and the speed law is `v²` |
| `AOA_CLAMP = 0.14` | [free], a per-surface lift saturation | **dead.** The engine's own coefficient curve peaks at 22.5° and cuts off at 45°; a linear slope with a clamp was standing in for it |
| `THRUST = 15` | [data: setTorque] | **dead, and it was never thrust.** `setTorque` scales an audio parameter |
| `V_FADE` linear fade `1 − v/70` | [data] | **wrong shape.** Signed square, and the speed term is scaled by air density |
| thrust at the CoM | `strong inference` | **wrong.** At the engine node |
| `REVERSE = 0.6` | [free-ish] | **unnecessary.** The signed square handles negative throttle on its own |
| `WEATHERVANE`, `WEATHERVANE_YAW`, `SLIP_DAMP` | [free], all three calibrated off `K_LIFT` | **deleted, not recalibrated.** They were the lumped model's way of faking `r × F` over the tail and the fin. A per-surface model gets all three for nothing, and §9d says so itself |
| `INERTIA_MOD` | [data] | kept |
| base inertia | [free] | kept, and now the only one |


### State vector

```
pos      vec3   world position
q        quat   body orientation  (body: x right, y up, z nose)
v        vec3   world velocity
w        vec3   world angular velocity
delta[s]        hinge angle, deg, one per control surface
excess          remembered elevator input overflow (rememberExcessInput)
spin            propeller accumulator, deg (visual only)
gear            0 deployed .. 1 retracted, and per-leg hinge angles
inputs   {pitch, roll, yaw, throttle} each -1..1
```

### Constants (Corsair)

```
MASS   = 2500        kg                                          [data]
DRAG   = 0.0652      s^-1 linear                                 [data]
G      = 14.7295379                        [code: client 0x00578f00, §2c]
INERTIA_MOD = (1.05, 0.850, 0.94)      y/p/r                     [data]
// base inertia: solid-box estimate from the mesh bbox (span 12.5 m,
// length 10.2 m, height 3.1 m) times INERTIA_MOD                [free]
// -> pitch 20126, yaw 56938, roll 32481 kg m^2

// the lift equation, per surface                     [code: 0x0057fa90]
LIFT_SCALE  = 0.0025
GRAV_NORM   = 0.101833      // 1/9.82
SURFACE_CLAMP = 200  m/s^2
AIR_DENSITY_ZERO_AT_HEIGHT = 1000  m       [code: 0x00578f00 +0x30]
SUBMERGED_MEDIUM = 10

// the engine                                         [code: 0x0057bfb0]
ENGINE_IDLE = 0.1
ENGINE_RATIO_SCALE = 3.5
GEAR_RATIO  = 0.94          // gearRatioCurve[100]    [code: 0x005715d0]
setDifferential = 5, setNoPropellerEffectAtSpeed = 70            [data]
// -> ratio = 3.5 * 5 / 0.94 = 18.617 m/s^2 per unit of K
```

There are no tuning targets, because there is nothing left to tune. What were
targets are now **falsifiers** — predictions the model makes with nothing
fitted to them, listed in §9e. Level top speed, the roll rate, the speed below
which nothing flies and the loop time are all of them.

### Surface table (Corsair) — [data]

Hinge is the part's local pitch (x) axis; `dir` is sign(setAcceleration);
apply points are body-frame (= attach + positionOffset); mount rotations
y/p/r degrees.

| id | node (glb) | attach | mount rot | apply pt | range deg | rate | accel | dir | input | wingLift | flapLift | inc |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ailL | CorsairFlapLeftOuter | −4.129/0.064/1.114 | 8/0/−9 | −3.629/0.064/0.214 | ±30 | 120 | 120 | −1 | roll | 1.85 | 1.7 | 0.5 |
| ailR | CorsairFlapRightOuter | 4.156/0.082/1.124 | −9/0/8 | 3.656/0.082/0.224 | ±30 | 120 | 120 | +1 | roll | 1.85 | 1.7 | 0.5 |
| elevL | CorsairFlapTailLeft | −1.124/0.812/−3.539 | 0/0/0 | −0.624/0.812/−3.539 | −10..+20 | 60 | 60 | −1 | pitch | 0.5 | 0.5 | 0 |
| elevR | CorsairFlapTailRight | 1.146/0.812/−3.539 | 0/0/0 | 0.646/0.812/−3.539 | −10..+20 | 60 | 60 | −1 | pitch | 0.5 | 0.5 | 0 |
| rud | CorsairRudder | 0.03/1.88/−2.649 | 0/0/−90 | 0.03/1.38/−2.649 | ±15 | 60 | 60 | +1 | yaw | 1.0 | 1.0 | 0 |
| regL | CorsairFlapLeftMiddle | −2.563/−0.134/0.895 | 9/0/−6 | ≈0/0/0 | ±2 | 30 | 120 | auto | — | 0 | 4 | 0.5 |
| regR | CorsairFlapRightMiddle | 2.52/−0.144/0.895 | −9/0/6 | ≈0/0/0 | ±2 | 30 | 120 | auto | — | 0 | 4 | 0.5 |
| fin | CorsairBodyWingVertical | 0/0/0 | 0/0/−90 | 0/0/−0.1 | — | — | — | — | — | 2 | 0 | 0 |

The mount rotation defines each surface's lift direction: `liftDir =
q_body · R(mountRot) · (0,1,0)`. The −90° roll on rudder and fin turns
their lift sideways — do not special-case them.

### Per-frame integration

Steps 1–5 run **per sub-step**, not per frame. The regulator is a proportional
loop closed through a rate-limited servo with a gain near 3, so given a whole
0.1 s frame the servo crosses its entire ±2° range in one step, the loop goes
bang-bang, and the aircraft trims somewhere else. Running the servo with the
sub-step makes the trim the same number at 1/60, 1/30 and 0.1 — and it is what
the engine does, since `Wing::handleUpdate` and `PhysicsWing::updatePhysics`
are the same tick.

```
1. INPUT SERVOS (per COMMANDED SURFACE, not per part)
   target = dir * input * (input > 0 ? max : -min)        // position servo
   move delta toward target, |rate| <= maxSpeed, clamp [min,max]
   automaticReset: input 0 -> target 0 at same rates
   // Key on control/input/axis so a mirrored pair is commanded together --
   // and then step each key ONCE. Stepping per part drives a shared entry
   // twice a frame, and the Corsair's two elevators travel at 120 deg/s
   // against their own setMaxSpeed 60.
   // Not modelled: setAcceleration's magnitude (servo accel), and
   // rememberExcessInput on the elevators.

2. REGULATOR SERVO (regL/regR)                         [code: 0x0057fbf0]
   refFlow = bodyForward * |v|                  // NOT the real flow
   command = clamp((calculateLift(refFlow, up, coeff)
                    + calculateNeutralLift(refFlow, -pitchOffset, coeff) * ratio
                    + setRegulateToLift) * G * 0.101833, -1, +1)
   // feeds step 1 as if it were a player input; the +-2 deg servo chases it

3. AERO FORCES (per surface, including fin and regulators) [code: 0x0057fa90]
   angle    = delta * flapLift/(wingLift + flapLift) - pitchOffset   // degrees
   up       = q_body * R(mountRot) * rotateX(angle) * (0,1,0)
   r        = q_body * applyPoint
   vLocal   = v + w x r                         // flow AT THE SURFACE
   coeff    = (wingLift + flapLift) * G * 0.101833
   medium   = submerged ? 10 : 1 - clamp(y/1000, 0, 1)
   L        = calculateLift(vLocal, up, coeff) * medium
   a        = -clamp(L, ±200) * up              // an ACCELERATION
   accel   += a ;  moment += r x a

4. THRUST (per engine)                                 [code: 0x0057bfb0]
   rho    = 1 - clamp(y_engine/1000, 0, 1)
   e      = throttle - rho * (v . fwd) / setNoPropellerEffectAtSpeed
   K      = 0.1*|throttle| + e*|e|
   a      = fwd * K * (3.5 * setDifferential / 0.94)
   accel += a ;  moment += r_engine x a         // AT THE ENGINE NODE

5. GRAVITY + DRAG, then INTEGRATE
   accel += (0, -G, 0) - DRAG * v
   v += accel h ; pos += v h
   // angular in the BODY frame, the only one I is diagonal in; the
   // gyroscopic term matters, yaw inertia is 2.8x pitch
   w_body += I^-1 (MASS * moment_body - w x Iw) h ;  q *= axisAngle(w, |w| h)

6. VISUALS (per frame)
   spin += throttle * 500 dt (approach at 1000 deg/s²); blur prop when |rate| > 35
   write delta[] to the rigged nodes (below); run gear automation (§6)

7. UNDERCARRIAGE (stand-in; the real thing is three Spring wheels, §7 item 6)
   while grounded: take roll out, stop the nose digging in, leave pitch-up alone

8. DAMAGE HOOKS  (later)
   inverted (bodyUp.y < 0): hp -= 10 dt        // hpLostWhileUpSideDown
```

Sign conventions: the servo `dir` column plus the existing viewer
handedness fix (`SIGN = {yaw: -1, pitch: -1, roll: 1}` in
`viewer/index.html`) determine which stick direction is which; the absolute
"does +20° elevator mean nose-up" mapping is a mesh-axis question the data
does not answer — expose one global sign per input and tune against feel
(elevator: the +20 side is the bigger travel and planes need more nose-up
authority, so wire negative pitch input → +20° → nose-up first, `strong
inference`).

### Control-surface animation

Identical to the physics servo state — write `delta` (deg) to each glb
node's local pitch rotation, on top of its authored mount rotation
(`node.rotation.x = mountPitch + delta`, order matching the extractor).
The nodes and their rig extras are already in Wake's glb (README table);
the only missing datum is the acceleration sign, §7 item 1. Gear legs and
hatches: drive 0→1 retraction through each leg's own bounds (left leg yaw/
roll +90, right −90, tail pitch +90, hatches roll ∓90) at 30 deg/s
(hatches 10), sign from the maxSpeed/accel product (§3).

---

## 9. The free constants, and what killed them

### 9a. `K_LIFT` and `AOA_CLAMP` — dead, and the derivation kept as a record

`K_LIFT = 2.83` was solved, not dialled: a Corsair holds altitude hands-off at
cruise, the regulators supply 9.82 of the 14.73, the passive surfaces at +0.5°
incidence must supply the remaining 4.9095, and at 53.67 m/s that pins the
slope. `AOA_CLAMP = 0.14` was then tied to it so per-surface saturation and the
model's 6 g ceiling agreed. Both were careful and both are gone.

They are gone because the equation is read. There is no slope to calibrate: the
coefficient is `(setWingLift + setFlapLift) × g/9.82` with **no** free
multiplier, the angle law is the engine's own curve, and the speed law is `v²`
rather than `v`. Every one of the four inputs to the old derivation was right;
the shape they were fitted into was not.

Worth keeping, because it is the failure mode to watch for: the calibration
*closed*. Solving for the passive share gave 4.9095, which rounds to the
authored 4.91, and that arithmetic landing on a shipped constant was taken as
confirmation the reading was right. It was a coincidence of construction — the
regulator budget and gravity are related by data, so the residual had to come
out a third of g whatever the slope was. A derivation that closes on a number
you already knew has told you nothing.

### 9b. The energy argument that said a Corsair could not loop — REFUTED

This section used to argue that a sustained loop from level cruise was
energy-limited: a 42 deg/s pull at 53.67 m/s describes a 73 m radius, so 146 m
of climb, costing 2150 J/kg against the 1440 J/kg a Corsair carries at cruise;
thrust-to-weight was 1.02; therefore a loop needed a dive entry, and *if the
real game loops from level flight then `setTorque`'s units are the thing that
is wrong, not the gravity*.

**The conditional was the right instinct and it has been collected on.** The
real game loops from level flight — the user filmed an SBD-T closing a 360°
loop from low level at full throttle in about eleven seconds — and `setTorque`
was indeed the thing that was wrong. It is not a thrust parameter at all.

The energy arithmetic itself was wrong in two independent ways, and both
pushed the same direction:

1. **It assumed a constant-radius circle at entry speed.** A real loop is not
   one. The aircraft slows as it climbs, and radius `v/ω` falls with it: the
   measured loop enters at 49 m/s and is down to 20 m/s over the top, so the
   upper half is far tighter and far cheaper than a 73 m circle. The height
   actually gained is **≈ 100 m**, not 146.
2. **It assumed thrust falls as the aircraft slows.** It rises.
   `K = 0.1|throttle| + e|e|` is largest at rest, so the aircraft is pushing
   hardest exactly where the old argument had it weakest — 11.4 m/s² at 20 m/s
   against 3.4 at cruise. Thrust-to-weight at rest is 1.39, not 1.02.

Under the read equations a Corsair closes a loop in **7.2 to 9.4 seconds**
depending on entry speed, and holds three and a half of them in thirty seconds
of held stick without running out of energy. Eleven seconds is comfortable,
which is what the filmed SBD-T — heavier, slower, a dive bomber — should be.

The methodological point is the one worth carrying: the argument was a
*conditional prediction with a named suspect*, and that is why it was useful.
It did not defend itself; it said which constant to doubt if the world
disagreed, and the world disagreed, and the constant was the one it named.

### 9c. The open points, closed

All six items in the old list, with their outcomes:

1. ~~The lift formula's speed exponent and units~~ — **closed.** `v²`, degrees,
   coefficient curve hard-coded. §2d.
2. ~~`setWingToRegulatorRatio` and the regulator loop shape~~ — **closed.**
   Proportional servo against a reference flow, with the ratio weighting a
   feed-forward of the surface's own undeflected lift. §2d.
3. ~~`setDifferential` for `c_ETPlane`; whether thrust applies at the Engine
   node or CoM~~ — **closed, both halves.** `3.5 × setDifferential / 0.94`,
   applied at the Engine node. §2d.
4. `setMaxSpeed 0` on a bound axis = uncapped? — **still open.** Not touched by
   this pass; the viewer treats 0 as "full travel in one second", which is not
   the same as uncapped and should be revisited with `calculateAndClipAngle`.
5. The fighter Engine's ±0.3° yaw axis — **still open**, still invisible.
6. `hpLostWhileUpSideDown` ground-contact gating — **still open.**

Newly opened by this pass:

7. **`setAcceleration`'s magnitude is not modelled.** The viewer's servo is a
   pure rate limiter; the engine's `RotationalBundle::calculateAndClipAngle`
   accelerates toward the commanded angle at `setAcceleration` deg/s² as well.
   It matters most for the regulator, whose loop gain is high enough that the
   servo's own dynamics are part of the answer.
8. **`rememberExcessInput`** — 24 uses, all elevators, still unmodelled.
9. **Drag.** The viewer uses `-drag × v`, which reproduces the shipped top
   speeds. `PointPhysicsNode::updatePositionalDragSimple` (`0x00578990`,
   `working`) is wind-relative and scaled by `π r²/mass` with a 25× submersion
   factor, which is linear in v but with a very different constant. Reconciling
   the two is the next thing worth reading.

### 9d. The three constants the lumped model needed — deleted

`WEATHERVANE = 5.24`, `WEATHERVANE_YAW = 2.78` and `SLIP_DAMP = 8.49` were the
price of applying body rates from the stick instead of deriving them from each
surface's off-centre lift. This section solved all three off §8's own surface
table, twice each, and they agreed to within a percent — which was the right
way to do it and is why the shim flew as well as it did.

**All three are now deleted rather than recalibrated**, and this section always
said they should be: *"None of the three belongs in §8. A per-surface
implementation gets all of them out of `r × F` over the surface table and
should not carry a constant for any."* It does, and it does not. The
restoring moment is the two elevators' `wingLift` on a 3.539 m lever; the yaw
stiffness is the rudder's and the body fin's on theirs; side drag is those same
two surfaces mounted rolled −90°, making their lift sideways. Nothing declares
any of it.

The same goes for `rollRate`, `pitchRate` and `yawRate`. There is no commanded
body rate anywhere in the model now. The measured full-stick roll rate is
**212 deg/s**, inside the surveyed 180–220 band, and nothing was fitted to put
it there: it is the ailerons' own lift on their own levers against the damping
their own motion creates.

### 9e. Measured under the read equations

`tests/test_flight.py` drives `viewer/flight.js` through node and asserts on
these; `tests/flight_harness.mjs` is the rig. Every number below is a
*prediction* of the equations in §2d and the `.con` data in §8 — nothing in the
model is fitted to any of them.

**The equation itself**, asserted directly rather than through a flight:

| | |
|---|---|
| Coefficient peak | 0.845671 at 22.5°, = `0.75 + 0.25 sin 22.5` exactly |
| Cliff at 45° | 0.18312 → 0.177085, and the residual is `0.25 sin 45.1` exactly |
| Small-angle slope | 0.071029 per degree |
| Speed exponent | doubling the flow quadruples the acceleration |
| `medium` | 1.0 at sea level, 0.5 at 500 m, 0.0 at and above 1000 m, 10.0 submerged |

**Flown**, Corsair, full throttle unless stated:

| | measured | note |
|---|---|---|
| Level top speed, 40 m | **49.4 m/s** | AI's authored `maxSpeed` is 55.0 |
| Level top speed, 200 m | **55.8 m/s** | the AI value sits between the two |
| Hands-off trim | 57.7 m/s in a **6.6° powered descent**, α 0.23° | a real equilibrium: 90 s more moves the sink rate by < 1 cm/s |
| Stick to hold height | **−0.05** (a twentieth of the elevator) | −0.1 climbs at 4.7 m/s |
| 360° loop, entry 49.4 / 55 / 60 m/s | **9.4 / 7.9 / 7.2 s** | 3.2–3.5 loops in 30 s of held stick; slowest point 20 m/s; 88–101 m gained |
| Full-stick roll at cruise | **212 deg/s** either way | surveyed band 180–220 |
| Lift ceiling crosses g | **≈ 17.3 m/s** | 18 m/s makes 16.0, 17 m/s makes 14.3 |
| Best angle of attack | 19.75–21.25° at every speed | the equation's 22.5°, less the surfaces' mounting |
| Terminal dive, held vertical, idle | peak 92 m/s, settles **54 m/s** at the deck | `g/drag` is 226 and is never approached |
| Service ceiling | **989 m** | best-effort climb; wings make nothing at 1000 |
| Takeoff | unstick at **13.5 s, 40.0 m/s** | rotate at 40, then holds 150 m level |
| Pitch / yaw / roll inertia | 20126 / 56938 / 32481 kg m² | yaw is 2.8× pitch |

**The `da6079b` properties, all preserved:**

| | measured |
|---|---|
| Nose displaced 25° off the path at cruise | closes in 0.17 s, **nose travels 38°** |
| Sideslip 20° at cruise | closes in 0.33 s, nose travels 11° |
| Nose 40° above the path at 15 m/s, idle | closes in 4.3 s, nose ends **25° below the horizon** |
| Hands off at 35 / 25 / 16.7 / 8 m/s, 10 s | drops 110 / 139 / 174 / 252 m, monotone, nose down in every case |
| Launched tail-first at 30 m/s | turns at **2.05 s** |
| Dropped nose-up from rest | turns at **4.55 s**, forward for 99.9% of the last fifteen seconds |
| 120 s of held full back stick | **0 s backwards**, worst α 10.8°, ends flying at 77 m/s |
| 4 s full back stick then hands off | peaks 88° nose-up, recovers at 3.9 s |
| ...at idle | peaks 72° nose-up, recovers at 3.4 s, ends in a 25° glide |
| 150 s of level flight at dt = 1/60, 1/30, 0.1 | **identical to three decimals** |

**Where the model disagrees with the expectations it was built against.** Both
are reported rather than tuned away:

- **Hands-off flight is a shallow powered descent, not level flight.** §4c and
  §5 both asserted that a Corsair holds altitude hands-off at cruise. Under the
  read equations it does not: it settles at 57.7 m/s descending 6.6°, and needs
  about a twentieth of the elevator to hold height. The cause is located and it
  is `verified` — thrust applied at the propeller hub 0.446 m above the centre
  of mass makes a nose-down moment that costs about a quarter of a degree of
  trimmed angle of attack. Measured by moving the hub to the centre of mass and
  changing nothing else: trim α goes 0.23° → **0.39°** and the sink rate
  6.8 m/s → **1.5 m/s**, a 1.7° descent instead of a 6.6° one. So the thrust
  moment is most of the gap but not all of it, and even at the centre of mass a
  Corsair does not quite hold altitude hands-off.
  The old assertion was never measured; it was a property of the lumped model.
  **An in-game measurement would settle it**, and it is the single most
  valuable one left.
- **The idle glide is steep.** The retail game was filmed holding a near-level
  attitude at idle and simply flying on. The model glides at 24° with the nose
  23° down, because with the throttle shut the signed square makes the
  propeller a brake worth 9.5 m/s² at 50 m/s — two thirds of a g — and the
  aircraft decelerates to 29 m/s and stays there. This is not a modelling
  choice: `K = -(ρv/70)²` at throttle 0 is what `0x0057bfb0` computes. Either
  the filmed throttle was not fully closed, or something gates the negative
  branch that has not been found.

**Corroborations that did fall out, with nothing fitted to them:** top speed at
the deck (49.4 against an expected 49.6), the speed below which no angle of
attack holds the aircraft up (17.3 against an expected 17), a full-stick roll
rate inside the surveyed band, and a loop time that makes the filmed eleven
seconds comfortable rather than marginal. The trim angle of attack did *not*:
0.23° measured against 0.73° expected, and the thrust moment above is why.

### For the engine-reference ledger (not yet recorded there)

- `setAcceleration` sign = input→deflection wiring; magnitude = servo
  accel. Evidence: 13/13 aircraft mirrored ailerons vs same-signed
  elevators; cosmetic RotationalBundles and ships use the same convention.
- Wing generates force independent of geometry (Ilyushin meshless Wings
  paired with cosmetic RotationalBundles).
- `setPositionOffset` = force application point delta in parent frame;
  regulator offsets exactly negate attach positions.
- Engine gravity is **−14.7295**, not −9.81: `BasicPhysicsSystem`'s ctor at
  `0x00578f00` seeds it with `0xC16BAE14`, and no map-load path overrides it
  (31 singleton xrefs audited; only the chat cheats and the console property
  write it). Already in `symbols.json` under subsystem `physics`; the point
  worth carrying is the *methodological* one — the 9.81 guess survived a year
  because a corroboration was gone looking for and duly found.
- `setRegulateToLift` universally 4.91 = **g/3**, and the per-aircraft count
  is a budget: SBD 3 (all of g), fighters 2, Ilyushin 1, balance from passive
  `wingLift` at +0.5° incidence. No gravity/air-density override exists
  anywhere in vanilla data.
- `setNoPropellerEffectAtSpeed` = thrust-zero speed (raft 15 / fighter 70 /
  PT boat 150 / rocket 1000 gradient).
- Open: `setMaxSpeed 0` semantics on a bound axis (§3).

Added by the second decompilation pass (§2d), and all of it `confirmed`:

- **`calculateLift` (`0x0057fa90`) is the whole aerodynamic model.** Speed
  exponent 2; coefficient curve peaking at 1.0 at 22.5° and hard zero past
  ±45°, which is the engine's built-in stall; returns an acceleration.
- **`setWingLift` and `setFlapLift` are summed into one coefficient**
  (`×g/9.82`), and told apart only by `Wing::handleUpdate`'s angle
  `deflection × flapLift/(wingLift + flapLift) − pitchOffset`. `setFlapLift`
  is the moving share of one surface's area.
- **`setPitchOffset` is a real rest incidence**, subtracted from that angle at
  every update for every Wing — not only the regulator's reference.
- **`setTorque` does not drive thrust.** Its only consumer is the engine
  sound. Thrust is `3.5 × setDifferential / gearRatioCurve[100]` times
  `0.1|throttle| + e|e|`, a signed square that turns the propeller into an
  airbrake past `setNoPropellerEffectAtSpeed`, applied **at the engine node**.
- **The gear-ratio curve is hard-coded**, six control points, and an aircraft
  samples index 100 = 0.94 forever: `gear` is seeded 1 and there is no
  gear-shifting code in the retail client.
- **Lift fades linearly to zero at 1000 m** (`airDensityZeroAtHeight`) and is
  ×10 submerged; per-surface lift is clamped at ±200 m/s². Thrust does *not*
  fade with altitude — the density scales only its speed term, so it grows.
- Methodological: `setTorque` was read as "peak thrust" for four years on the
  strength of a cross-fleet value gradient that fitted perfectly. The gradient
  was real and the conclusion was wrong. A parameter's *distribution* can
  corroborate any story you bring to it; only a caller can say what it does.
