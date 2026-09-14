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
| `setTorque` | **Peak thrust as acceleration, m/s²** (mass-independent; the engine multiplies by mass internally). See §6 for the equilibrium check against AI cruise speeds | 15 (fighters), 14.25 (SBD/Stuka/Ilyushin), 2.6 × 4 (B17) | strong inference |
| `setDifferential` | Not decodable from aircraft data (cars use it as final-drive ratio). Planes: 5; B17: 1.9; ships: 2. Not needed — `setTorque` + fade reproduces observed speeds without it | 5, 1.9 | speculative |
| `setNoPropellerEffectAtSpeed` | **Forward speed (m/s) at which propeller thrust reaches zero.** The cross-fleet values nail it: fighters 70; B17 inboard 70 / outboard 120; PT boats 150; the survivors' *rafts* 15 (slow paddling); the Katyusha *rocket* 1000 (a rocket never loses thrust with speed) | 70 / 120 / 150 / 15 / 200 / 1000 | strong inference |
| `setGearUp` / `setGearDown` | Transmission shift points as fraction of max revs — car legacy (`c_ETCar`/`c_ETTank` use 0.95/0.4–0.45 with `setNumberOfGears 5`). Planes declare no gear count; **likely inert** for `c_ETPlane`. Note these are *not* the landing-gear thresholds — `LandingGear` templates carry their own (`setGearUpEngineInput 0.7` / `setGearDownEngineInput 0.4`, vs the Engine's 0.7/0.3) | 0.7 / 0.3 all aircraft | strong inference (inert) |

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
versus 9.81" but "regulators plus incidence versus 14.73"; and `K_LIFT` is
re-derived in §9, because its old value was fitted against the old g.

**CoM**: the PCO origin. `confirmed` by authoring: the regulator offsets
negate their attach positions to land exactly there, and `lodCorsair` /
`CorsairComplex` are attached at zero offset.

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

### 4a. The two lift terms

Each Wing produces force along its **local +y (up), rotated by its mounting
rotation**, proportional to two independent terms:

- **`setWingLift` × (angle of attack)** — the passive term. AoA is the
  angle between the local airflow and the wing plane, *including* the +0.5°
  `setPitchOffset` incidence and the body's attitude. Evidence: `Bomb_wing`
  is `setWingLift 0.2` and nothing else, and bombs weathervane; every
  `*BodyWingVertical` fin is wingLift-only and yaw-stabilises; ship rudders
  zero it because a rudder aligned with flow must make no force.
- **`setFlapLift` × (hinge deflection)** — the control term. Evidence:
  ship rudders are `wingLift 0 / flapLift 2` and steer battleships; the
  regulator flaps are flapLift-only and hold planes up (section 5).

Both scale with airspeed (the data does not fix the exponent — see §8's
free constants). A surface mounted rolled −89.999° (every rudder, every
vertical fin) makes *sideways* force through exactly the same formula —
that mounting trick is why the class needs no "vertical surface" concept.

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
meaningless. `strong inference`.

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
- **Stall**: lift authority scales with airspeed while the required 14.73
  does not. A fighter's regulators only budget 9.82 of that (§2c), so the
  balance rides on the passive `wingLift` surfaces at their +0.5° incidence,
  and *that* term is the one that gives out first: a Corsair holds altitude
  hands-off at cruise, sinks gently as it slows, and is beyond saving well
  before the regulators themselves saturate at ±2°. Mushy low-speed
  behaviour, with no explicit stall model. `strong inference`.

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
(§2c). All 27 uses in vanilla say 4.91. The count per aircraft is then a
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

Level top speed, climb and stall are then set by (`strong inference`,
equilibria under §8's model):

- **Top speed**: thrust fade (`setNoPropellerEffectAtSpeed 70`) against
  linear drag. With linear fade, v* = T/(T/70 + drag) = **53.7 m/s** for the
  Corsair — the AI's authored `aiTemplatePlugIn.maxSpeed` is **55.0**
  (`Ai/Objects.con`), and the fleet's AI values (40–60) bracket every
  plane's prediction (43–54). A hard cutoff at 70 fits the AI data worse.
- **Terminal dive**: g/drag ≈ **226 m/s** (thrust is zero above 70).
- **Stall**: sink onset ~17 m/s with the re-derived constants below; the
  regulators themselves do not saturate until ~12.4 m/s, which is the change
  the gravity correction made to this line (§9).
- **Climb**: excess thrust along an inclined flight path. The AI caps itself
  at `maxClimbAngle 0.3333` (rad, ≈ 19°), and the corrected g makes that cap
  look chosen rather than arbitrary: at 19° a Corsair's steady climb settles
  at 36.5 m/s, comfortably flying, whereas under g = 9.81 the same cap left
  42 m/s of margin it did not need. Weak corroboration, but it points the
  right way.

---

## 6. Engine and throttle (Q5)

Assembled model, `strong inference` except where tagged:

- `c_PIThrottle` ∈ [−1, +1] (W/S; no separate brake exists — see
  input-and-cockpit.md). The crankshaft accumulator integrates it: spin
  rate = throttle × 500 deg/s, approached at 1000 deg/s². The −3000/+5000
  accumulator bounds echo reverse being weaker than forward (0.6 ratio).
- **Thrust accel = `setTorque` × throttle × fade(v)**, applied along body
  +z; `fade(v) = clamp(1 − v_forward/70, 0, 1)` (linear — the reading that
  matches AI speeds; a hard cutoff is the fallback). Reverse throttle:
  multiply by 0.6 (`speculative`, from the accumulator ratio) — it exists
  to brake on the runway.
- Thrust application point: unknown (engine attaches at nose,
  0.02/0.446/4.149). **Apply it at the CoM** — applying 15 m/s² × 2500 kg
  at the nose, 0.45 m above CoM, would pitch the plane hard, so the real
  engine cannot be doing that naively. `strong inference`.
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
4. `setTorque`, `setDifferential`, `setNoPropellerEffectAtSpeed`,
   `setGearUp/Down` on Engine.
5. `rememberExcessInput`; `setGearUpHeight`/`setGearDownHeight`/
   `setGearUpEngineInput`/`setGearDownEngineInput` (con.py synthesises gear
   axes from the rotation bounds instead — fine for animation, not for the
   automation logic).
6. Spring `setStrength`/`setDamping`, `Grip` (ground handling, later).

---

## 8. Reimplementation spec — Corsair (Q6)

Everything marked **[data]** is read straight from the .con files above.
Everything marked **[free]** is a calibration constant the data cannot fix;
its tuning target is given. Integrate at fixed dt (1/60 s), semi-implicit
Euler is fine.

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
MASS   = 2500        kg                [data]
DRAG   = 0.0652      s^-1 linear      [data]
G      = 14.7295                       [data: client 0x00578f00, §2c]
THRUST = 15          m/s^2 peak        [data: setTorque]
V_FADE = 70          m/s               [data: setNoPropellerEffectAtSpeed]
REVERSE= 0.6         reverse-thrust factor            [free-ish: accumulator ratio]
INCIDENCE = 0.5      deg               [data: setPitchOffset]
INERTIA_MOD = (1.05, 0.850, 0.94)      y/p/r          [data]
// base inertia: solid-box estimate from the mesh bbox (span 12.5 m,
// length 10.2 m, height 3.1 m) times INERTIA_MOD                  [free]
K_LIFT = 2.83        m/s^2 per (unit coeff · rad · m/s)            [free]
AOA_CLAMP = 0.14     rad — per-surface lift saturation             [free]
```

`K_LIFT` and `AOA_CLAMP` are both re-derived from the corrected g; the working
is in §9. Tuning targets for the free constants: level top speed ≈ 55,
terminal dive ≈ 226, full-stick roll ≈ 180–220 deg/s at cruise. The old
"stall 20–25 m/s" and "sustained loop ≈ 40 deg/s" targets are retired as
independent constraints — see §9 for why.

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

```
1. INPUT SERVOS (per input-driven surface)
   target = dir * input * (input > 0 ? max : -min)        // position servo
   move delta toward target: rate accelerates at accel deg/s²,
   |rate| <= maxSpeed (maxSpeed 0 in data means uncapped), clamp [min,max]
   automaticReset: input 0 -> target 0 at same rates
   elevator only (rememberExcessInput): overflow past clamp accumulates
   in `excess`; opposite input unwinds `excess` before moving delta

2. REGULATOR SERVO (regL/regR)
   err = 4.91 - currentLiftAccelOf(surface)        // g/3, per surface
   drive delta toward saturation in the err direction at 30 deg/s, ±2°
   // The pair tops out at 9.82, which is NOT gravity. The missing 4.91 is
   // step 3's passive term at INCIDENCE; do not "fix" it here.

3. AERO FORCES (per surface, including fin and regulators)
   vLocal   = bodyVel + w x r_apply            // flow at the surface, body frame
   flowDir  = -normalize(vLocal)
   aoa      = clamp(angleInLiftPlane(flowDir, surfacePlane) + inc, ±AOA_CLAMP)
   accel    = (wingLift * aoa_rad + flapLift * delta_rad) * |vLocal| * K_LIFT
   F        = accel * MASS * liftDir(surface)
   forces  += F ;  torques += r_apply x F

4. THRUST
   fade   = clamp(1 - vForward / V_FADE, 0, 1)
   thrust = THRUST * throttle * (throttle < 0 ? REVERSE : 1) * fade
   forces += thrust * MASS * bodyForward        // at CoM, deliberately

5. GRAVITY + DRAG
   forces += MASS * (0, -G, 0)  +  MASS * -DRAG * v

6. INTEGRATE  v += F/m dt ; pos += v dt ; w += I^-1 (torque - w x Iw) dt ; q += ...

7. VISUALS
   spin += throttle * 500 dt (approach at 1000 deg/s²); blur prop when |rate| > 35
   write delta[] to the rigged nodes (below); run gear automation (§6)

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

## 9. Calibrating the free constants, and what would settle the rest

### 9a. `K_LIFT`, re-derived against the corrected g

The old derivation was: `K_LIFT = 1.4`, calibrated so the two regulators
saturate at ~25 m/s — 2 × 4 × 2° × K × v = 9.81 → v ≈ 25. It has one
constraint and it is the wrong one. It only worked because the regulator pair
was believed to make exactly 1 g, which made "the speed they stop making it"
and "the speed the aircraft stops flying" the same number. At g = 14.7295 the
pair makes 9.82 and those are two different speeds, so the calibration has to
hang off something else.

**The constraint that replaces it**: a Corsair holds altitude hands-off at
cruise. That is the one behaviour of a BF1942 fighter nobody disputes, and
every term in it is now data except `K_LIFT`:

```
regulators + passive incidence lift = g,  at the speed level flight settles at
```

Left to right:

- **Cruise speed** is fixed by thrust against drag, neither of which involves
  gravity: `15 × (1 − v/70) = 0.0652 v` → `v* = 15 / 0.279486` = **53.67 m/s**
  (§5's 53.7, and the AI's authored 55.0 is 2.5% away).
- **Regulators**: 2 × 4.91 = **9.82** m/s², data, §2c.
- **Required from the passive surfaces**: 14.7295 − 9.82 = **4.9095** m/s² —
  which is 4.91 again, i.e. exactly the third of gravity a fighter is short of
  a regulator. The arithmetic closing on the authored constant is the check
  that this reading is the right one.
- **What the passive surfaces offer**, per §8 step 3, is
  `K_LIFT × Σ(wingLift × inc) × v`. The Corsair's incidence-carrying lifting
  surfaces are the two outer wings at `wingLift 1.85` and `setPitchOffset
  0.5`; the elevators carry `inc 0`, and the rudder and fin are mounted −90°
  and lift sideways. So Σ = 2 × 1.85 × 0.0087266 rad = **0.0322886**.

```
K_LIFT = 4.9095 / (0.0322886 × 53.67)
       = 4.9095 / 1.732936
       = 2.833                                  ->  K_LIFT = 2.83
```

Doubled-and-a-bit from 1.4, and it had to be: the old value was sized to make
a ±2° flap at `flapLift 4` do all the work, and now it has to make a fixed
+0.5° incidence do a third of it.

What falls out, none of it calibrated, all of it checkable:

| Quantity | Was (g = 9.81) | Now (g = 14.7295) |
|---|---|---|
| Regulator saturation speed | 25.1 m/s | 4.91 / (4 × 2° × K) = **12.4 m/s** |
| Hands-off sink onset | same 25.1 (they were one number) | (0.2793 + 0.0323) × K × v = g → **16.7 m/s** |
| Terminal dive, g/drag | 150 m/s | **226 m/s** |
| Level cruise | 53.67 m/s | 53.67 m/s (unchanged — no g in it) |

**`AOA_CLAMP`, re-derived**: 0.35 rad was set loosely against "keep a 20°
body-AoA pull from producing 10 g", and against a slope a seventh as stiff it
never bound at all. Tie it to the ceiling the model already has instead — the
6 g cap on total lift — so per-surface saturation and the global cap agree at
cruise rather than fighting:

```
K_LIFT × Σ(wingLift) × aoa × v* + 9.82 = 6 g
2.83 × 3.7 × aoa × 53.67 = 88.38 − 9.82
aoa = 78.56 / 561.9 = 0.1398                    ->  AOA_CLAMP = 0.14 rad (8°)
```

### 9b. Two tuning targets that were retired, and why

`stall 20–25 m/s` and `sustained loop ≈ 40 deg/s` are gone from §8's target
list. Neither was ever measured; both were downstream of g = 9.81 and are
therefore not independent evidence about anything.

- **Stall 20–25** was the old `K_LIFT` calibration restated. Using it as a
  check on a constant it defined is circular, and under the corrected g it is
  also unsatisfiable: the ratio of regulator-saturated lift to incidence lift
  is fixed by data at 8.65 : 1, so one `K_LIFT` cannot put sink onset at 22
  *and* hold cruise level. Level flight is the constraint with data on both
  sides; it wins. Sink onset lands at 16.7 m/s and is a prediction now, not a
  target.
- **Loop 40 deg/s** is still what an in-game measurement should be compared
  against, but it is no longer something the constants can be tuned to hit.
  A 42 deg/s pull at 53.67 m/s describes a loop 73 m in radius, so 146 m of
  climb, costing 2150 J/kg against the 1440 J/kg a Corsair carries at cruise.
  Under g = 9.81 that budget balanced almost exactly, which is why the loop
  target looked achievable; under the real g the aircraft is energy-limited in
  the vertical and a loop needs a dive entry. Thrust-to-weight is 15/14.7295 =
  1.02, so this is not a modelling artefact — it is what `setTorque 15`
  against the real gravity means, and if in-game Corsairs do loop from level
  cruise then `setTorque`'s units (§2b, `strong inference`) are the thing that
  is wrong, not the gravity.

### 9c. What would settle the open points

In order of value; all are `bf1942_lnxded.static` targets (the Linux
dedicated server is unstripped — 54,895 symbols, per
`features/bf1942-engine-reference/ledger.md` — and flight physics must run
server-side, so `dice::ref2::...Wing::update` / the `c_ETPlane` branch are
findable by name there, far cheaper than the stripped client):

1. The lift formula's speed exponent and units (linear-in-v vs dynamic
   pressure; degrees vs radians) — replaces `K_LIFT` guesswork.
2. `setWingToRegulatorRatio` and the regulator loop shape.
3. `setDifferential` for `c_ETPlane`; whether thrust applies at the Engine
   node or CoM.
4. `setMaxSpeed 0` on a bound axis = uncapped? (three vanilla elevators).
5. The fighter Engine's ±0.3° yaw axis.
6. `hpLostWhileUpSideDown` ground-contact gating.

Item 1 is now the *only* thing standing between §8 and a fully data-derived
lift term: with g known and `setRegulateToLift` read correctly, `K_LIFT`'s
value is pinned by level flight (§9a) and only its *shape* — linear in v
versus dynamic pressure, degrees versus radians — is still a guess. A
`Wing::update` that turns out to be quadratic in v changes the value but not
the method: re-solve the same level-flight equation at 53.67 m/s.

In-game measurement (wine + vanilla install) settles 1 and 3 without
decompiling: time a full roll, a loop, 0→top-speed on the deck, and the
sink onset. Two of those four now carry more weight than they used to,
because §9b retired the guessed targets: whether a Corsair can loop from
level cruise, and what speed it starts sinking at, are the measurements that
would either confirm this calibration or indict `setTorque`'s units.

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
