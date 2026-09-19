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

> **A single reader has since disputed this for the server, and the
> disagreement is unresolved. Ledger LOOP-1, status `open`.**
>
> On 2026-09-20 one reading of **lnxded**'s own loop found: `g_simulationFps`
> (`0x08716b5c`, `.data`, raw `0000f041` = 30.0) has **no writer anywhere** in
> the file and no console word; `Setup::initEngine` **doubles** it into the
> loop's target rate at `0x080bc632` (`fld [0x08716b5c]; fadd st,st(0);
> fstp [ecx+0xc4]` = 60.0); and `Setup::mainLoop` (`0x080bc0b0`) computes
> `fld1; fdiv [ebx+0xc4]` = a 1/60 s period, spins on `System::getExactTime`
> until the deadline (`je 0x080bc3b0`, `0x080bc3b2`), then stores the
> **measured** `now − last` as the frame dt (`0x080bc0f6 fsubrp`,
> `0x080bc0f8 fstp [ebx+0xc8]`). Below it, `Game::updateWorld` (`0x0805d9b0`)
> forwards that dt unchanged and `BasicPhysicsSystem::update` (`0x08251ef0`)
> is an empty stub, so no accumulator re-quantises it.
>
> If that holds, the server steps at a nominal 60 Hz with a real, varying dt,
> and **every per-call quantity in this corpus is per frame rather than per
> 1/30 s** — the jump impulse (§8), the locomotion ramp (§8), deviation decay
> ([handweapon-view-and-deviation.md](handweapon-view-and-deviation.md) §2) and
> the gearbox's 0.05 rev filter
> ([tank-driving.md](tank-driving.md) §4). PHY-1's 1.12 m apex and PHY-6's
> 0.212 s would then be the figures for a machine at 30 fps, not engine
> constants; both rows now carry that qualifier.
>
> **It is one reader and it is not re-derived, so nothing here is rewritten on
> its strength.** The 30 Hz chain above was read on the **client**, and the two
> binaries may genuinely differ. What a second reader must settle, in order:
> (1) that `Setup+0xc4`/`+0xc8` really are the loop period and the frame dt, by
> walking every reader of both offsets; (2) what the client does, since DEV-5,
> GL-1 and GL-2 all rest on its tick accumulator; (3) whether anything between
> `Setup::mainLoop` and `GameServer::simulateFrame` (`0x0815c2a0`) re-quantises
> the dt the way the client's does.

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
(lnxded `0x082543d0`), and it is **not** this integrator: a `PhysicsNode` takes
one semi-implicit Euler step per tick, linear then angular, with no sub-steps
([collision-response.md](collision-response.md) §4 — the four sub-steps above
are `PointPhysicsNode` only). **Only the root node integrates.** A node that is
asleep (vtable +0xcc is `isSleeping`) or is not the root copies the root's
sleepiness, zeroes its own speeds and accumulators and returns, with no drag
and no gravity seeded; nothing is handed to the root at that point (an earlier
reading here said it was). Engine, wing, spring and float nodes reach the root
by calling its `addAcceleration…` themselves. For an awake root, bit 0x4 of the
composite object's byte +0x7 chooses the drag law:
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
neither law, and nothing calls its setter.

**The selector bit is never set (ledger PHY-4, settled 2026-09-17).** Object
ctors write default flags `0x2090400` at `+0x4` (lnxded `0x08191811` /
`0x08191a51`; client `0x0050dc84` family) — byte `+0x7` bit `0x4` clear. No
instruction in either binary ORs `0x4000000` into object flags; no
`ObjectTemplate::updateFlags` caller pushes it; `hasPointPhysics` is a different
switch (`setPhysicsNodeComponent` `0x081dd490` builds a `PointPhysicsNode` and
sets object flag `0x8`). So every live `PhysicsNode` takes the box branch; the
sphere-`r = 0.1` arm is dead. Vehicles in the viewer therefore need the box law,
not `−drag·v` (`flight.js`) and not the PointPhysics sphere form (`ground.js` /
`physics.js`).

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

**What "displacement" is** (lnxded `0x0824ddd0` decompiled in full, 2026-09-20,
for the viewer's parked-vehicle bodies). It is a world **vector**, not a scalar
along the body's up axis:

```
anchor = the wheel's authored relative position, through its parent's absolute transformation
D      = anchor − wheelNode.absolutePosition
Dprev  = last tick's D (+0xc4);  D is stored whether or not the root is asleep
if the root is awake:
    wheel.setRelativeTransformation(identity, authored position)     // the wheel SNAPS BACK to rest, every tick
    a = −( strength(+0xd4)·D·(g·−0.101833)  +  damping(+0xd0)·(D − Dprev)/dt )
    root.addAccelerationAtRelativePosition(anchor − root.pos, a)
```

The only thing that ever moves a wheel off its anchor is `solveImpulse`'s spring
branch in the resolve pass ([collision-response.md](collision-response.md) §6.4),
which pushes it along the averaged contact normal by `clamp(penetration, 0, 1)`.
So each tick's compression is simply how far the rest-pose wheel sank into
whatever it is standing on, measured afresh; the force acts along the **ground's
normal** (a taildragger standing nose-high is not pushed backwards by its own
springs); there is no travel limit, no bump stop and no relaxation state. At
rest `Σ 1.5·strength·penetration = |g|`: a Willy (four springs of 25) sinks
0.098 m per wheel. A viewer model with accumulated compression and a force
along body-up crept a parked Corsair backwards indefinitely; the read law
settles it in four seconds.

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
  `getCurrentDifferentialRPM` into `SpinWheel` — and, corrected 2026-09-19,
  that same surface speed is the friction solve's *target velocity*, which is
  the only traction there is.
- **RollGrip** (2) removes the contact velocity along the wheel's own axis, so
  the wheel rolls freely and resists sideways.
- **Neither** — plain contact — asks for the whole tangential velocity to
  stop. The solver sets **StaticFriction** (0x80) itself once the wanted change
  fits inside the kinetic limit, and breaks it above 1.5× that — in **all
  three** grip modes, not only this one (corrected 2026-09-19).
- **DummyGrip** (0x20) is read from the authored byte +0xb5
  (`getPermanentGrip`), not the live one. It bypasses the friction solve only
  together with EngineGrip (0x24), where just the visual wheel spin is driven; a
  bare 0x20 runs the ordinary contact path (corrected 2026-09-19).
- **RollGripWhenOccupied** (8) never reaches the solver: `PhysicsSpring`
  rewrites it first (above).

There is no slip-angle curve, and `ground.js`'s single-`mu` tyre model is not
what the engine does. The magnitudes were read on 2026-09-19
([collision-response.md](collision-response.md) §8): there is no force and no
mass in the friction solver. Each touching part asks for the velocity change
its grip wants, the *vector* is clamped to a Coulomb disc of radius
`μ·N.y·|g|/30` m/s per tick (1.5× that while the static latch holds), and the
result goes to the root at the contact point. The power slide is that clamp
acting on the whole vector: a spinning driven wheel spends its budget
longitudinally and has no lateral grip left.

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

### The table is reached through a ramp (2026-09-19, ledger PHY-6)

The speed is not applied the instant a key goes down. `applyMovementFactors`
(lnxded `0x082807a0`, the mangled signature `(float, char, char, char&)` fixing
the types) keeps a **signed byte** per axis — forward at `this+0x58d`, strafe at
`this+0x58c` — and `handlePlayerInput` calls it twice, at `0x0827475a` and
`0x0827477f`, with `accel = 20` (`0x0872ee14`) and `decel = 12` (`0x0872ee18`),
both `movsx`-loaded from beside `walkSpeedFactor`:

```
input == 0 && state != 0 : state moves toward 0 by decel
input >  0               : state = min(max(state, 0) + accel, +127)
input <  0               : state = max(min(state, 0) - accel, -127)
```

The byte is then **multiplied by 1/127** (`0x086d2718`, the nearest float32 to
1/127; `fmul` at `0x082747c6`) and scales
`directionalSpeed[pose*2 + (ramp <= 0)]` at `0x08274800`. At 30 Hz that is
**0.212 s to full speed and 0.353 s to a stop** — and the forward/backward slot
is chosen from the **ramp byte, not the raw input** (`0x082747e0 cmp BYTE
[ecx+0x58d],0; setle`), so the table does not flip the instant the key does.

Two things about how that speed is applied. The result is a **force**, `accel =
0.75·vCmd` (`0x08274a09`, `0x086ba8cc`) with **no** `×30`, so `Δv = vCmd/40` per
tick — and it runs **only when `IResponsePhysics+0xa4 == 0`**, i.e. only on a
tick where the collision solver resolved no impulse. A soldier standing on the
ground is therefore not moved by this at all; it is moved by the friction path
(§10). The swimming `5.0·vCmd` (`0x08274b6f`, `0x086c5288`, state bit `0x8`) is
**not** under that gate — `0x08274a03`'s `jne` lands past the 0.75 block but
before the swim test at `0x08274b5f`.

### The jump: 6.0 m/s, one tick, and the server computes it too (2026-09-19, ledger PHY-1)

The gate is as read in 2026-09-16: in the client's `handlePlayerInput`
(`0x00500190`) the jump bit 0x80 is set only when the soldier is standing (0x60
clear), Action is held, the soldier has a +0x140 pointer and a non-zero word at
`[esp+0x2c]`, and `BFSoldier::getSoundTrigger` (`0x004f5c60`) is not
`c_SstJump` — the upper body's current sound trigger, or the lower body's when
the upper has none, so a soldier already in a jump state cannot jump again.
Sound triggers are console constants, identical in both binaries: `c_SstStand`
1, `c_SstWalk` 2, `c_SstRun` 3, `c_SstJump` 4, then `c_SstToCrouch` 6 through
`c_SstClimbLadder` 23 (table in symbols `0x08298280`).

What is new is the impulse itself:

```
K     = min(1 + dot(normalise(vCmd with y = 0), N), 1.0)
accel = ( -0.25*vCmd.x ,  K*N.y*6.0 - 0.25*vCmd.y ,  -0.25*vCmd.z ) * g_simulationFps
node->addAccelerationAtRelativePosition(Vec3::zero, accel)      // slot +0x6c
vCmd *= 0.0
```

client `0x0050165c`–`0x005017ca`, lnxded `0x08274f86`–`0x08275126`. The `6.0` is
`0x008eb25c` / `0x086d271c`, raw `40c00000` in both. Slot `+0x6c` is the same
virtual index on every node class a soldier might carry — `PointPhysicsNode`
(vtable `0x0872e080` → `0x08256650`), `PhysicsNode` (`0x0872df00` →
`0x08255230`) and `StaticPhysicsNode` (`0x0872e340` → `0x0825e750`) — and the
callee proves the argument order rather than leaving it assumed: it adds its
*second* argument to `this+0x1c`, the acceleration accumulator, and ignores the
first. Because
`PointPhysicsNode::updatePositionalPhysics` (`0x082560c0`) runs four
semi-implicit sub-steps of `dt/4` and then **zeroes the acceleration
accumulator** (`0x082562aa`), the `×30` makes this exactly a one-tick impulse:
`Δv = +6.0 m/s` on flat ground. Under `g = −14.73` and that same integrator the
apex is **1.12 m and the airtime 0.80 s** — not the continuum `v²/2g` figures of
1.222 m and 0.815 s, which the discrete integrator does not produce.

Three details a reader will want. The commanded direction is normalised **with
y forced to zero**, by an explicit `mov DWORD [esp+0x1c],0` in the client
(`0x0050166c`) and, in lnxded, by storing the `fldz` the branch's own compare
left on the x87 stack (`0x08274fa2`) — grep for the `mov` in the server and you
will not find it. The `−0.25·vCmd` lands on the **actual velocity** and then
`vCmd` is set to zero outright, so at 6 m/s forward the jump tick costs 1.5 m/s
of speed: a backward kick ten times the size of a normal tick's forward gain.
And `N` is not simply the last collision normal — `BFSoldier::handleCollision`
(`0x0827d3b0`) keeps the **most upward** normal of the frame
(`0x0827d4d5`–`0x0827d503`).

**The server's block is live.** The 2026-09-16 reading called it dead code
behind an always-equal `0.0 == 0.0` test; that is the *not-armed* arm. Arming
bit `0x40` is set on **both** binaries when a contact's `normal.y > 0.1` and the
contact material is not 1 (Water) — client `0x004fa764`, lnxded `0x0827d566`
(`or WORD PTR [edi+0x3e6],0x40`, found by grepping all 60 accesses to `+0x3e6`;
it is the only one) — and cleared every tick (client `0x00501bb6`, lnxded
`0x08274d29`). When it is set, `0x082741ad` jumps to `0x08275f86`, which calls
`getSoundTrigger` and, when the answer is not `c_SstJump`, skips the `fldz`
that would have zeroed the input. One tick is enforced three ways: the
accumulator is cleared each tick, the arming bit is cleared each tick and needs
a fresh upward contact (and after a jump tick the soldier is rising at ~5.5 m/s,
so there is none), and `c_SstJump` blocks a repeat.

That `0.1` is **the only slope threshold in soldier movement**. There is no
walk-slope limit, no step-up code and no movement capsule: the collider is the
object's `SimpleCollisionMesh` vertices swept by `ResponsePhysics::checkVsTerrain`
(`0x0825a960`). The viewer's `MAX_GROUND_SLOPE` (cos 60°), `STEP_HEIGHT` and
`BODY_RADIUS` remain viewer choices, and the slope one is *stricter* than the
engine — which is why a real BF1942 soldier climbs dunes.

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

## 10. Friction magnitudes, the spring, and submersion (2026-09-19)

Three things §3 and §6 left as "not read", closed by the movement round and its
verifier. The general friction solver — what each grip mode asks for, the ×30,
the mean over touching parts, the dead six float arguments and the
`−resistance·Vt` sum — is written up in
[collision-response.md](collision-response.md) §8, which was read independently
the same day and agrees on the budgets; this section records what is specific to
the soldier, the spring, and the drag field.

### The Coulomb budgets, and the soldier's own pair

`ResponsePhysics::addFriction` (lnxded `0x0825b6e0`) forms two per-tick caps on
the tangential velocity change, at `0x0825b7c9`:

```
mu_hi = A * 2.25 * 9.82 * L / 30      (break-away / static)     2.25 = 0x086d16e0
mu_lo = A * 1.50 * 9.82 * L / 30      (sliding / kinetic)       1.5  = 0x086be4d0
```

both in **m/s of Δv per 30 Hz tick**. They are the two **arms of a branch**, not
two passes: `0x0825bb72 mov dl,[esi+0xb4]; test dl,dl; jns 0x0825bebc` sends a
body that already holds `StaticFriction` to the break-away test and one that
does not to the re-latch test. Exceeding `mu_hi` scales the demand down to it
(`fsqrt` `0x0825bbdd`, `fdivrp` `0x0825bbec`) and clears the latch; staying
inside `mu_lo` sets it. Break away at 2.25, re-latch at 1.5.

`A` is the contact's friction scalar, `IResponsePhysics+0xa8`, written by
`impulseOn` (`0x08258900`, tail `0x08258b6a`–`0x08258ba0`) as
`0.5·(getFrictionForMaterial(matA) + getFrictionForMaterial(matB))` — the mean
of the two surfaces' `MaterialManager.materialFriction`. That lookup
(`0x081751b0`, MaterialManager vptr+0x58) returns `material+0xc`, falling back
to material 0 and then to a hard 1.0. The same tail refreshes the live grip byte
as `(old & 0x80) | getPermanentGrip()`, so the static latch survives the
refresh, and both constructors seed `+0xa8 = 1.0`.

Vanilla's table, re-surveyed: 0 default 1.0, 1 water 0.1, 2/3 grass 0.8, 4 dry
dirt 1.0, 5 wet dirt 0.8, 6 mud 0.5, 7 outside-map 0.5, 8 gravel 1.1, 9 frozen
0.8, 10/11 sand 0.8, 12 rock 0.6, 13/14 roads 1.0, 15 paved 1.1, 70 grenades
2.0, 96/97/98 stairs 10.0. **13** installed mods carry the word, over a range of
**0.0 to 100.0** (EoD's `damage_system/APMinePCO.con` has the 100.0), and
Interstate 82 ships an entirely different set — 0.3, 0.75, 0.9, 1.4, 1.6 — which
matters the moment a viewer keys off the table per mod.

**A soldier gets its own pair.** A second `CID_BFSoldierTemplate` test at
`0x0825b83e` diverts to `0x0825c5d2`, which recomputes both budgets as

```
mu_hi = A * 7.2 * 9.82 * n.y^5 / 30        7.2 = 0x086d16e8   (break-away)
mu_lo = A * 4.8 * 9.82 * n.y^5 / 30        4.8 = 0x086d16ec   (sliding)
```

with `n.y` the contact normal at `IResponsePhysics+0x9c` that
`BFSoldier::handleCollision` writes. The 9.82 is present — it arrives live on
the x87 stack through `[ebp-0x218]` (parked `0x0825b832`, reloaded
`0x0825b844`), which is why a first reading came out without it. Same 1.5:1
hysteresis, **3.2× the vehicle's magnitude**, and a **quintic** — not linear —
falloff with contact tilt, formed by duplicating `n.y` at `0x0825c5fb` and
multiplying it in at `0x0825c615`/`61f`/`623`/`627`/`62b`. On flat ground with
`A = 1` the caps are **2.357 and 1.571 m/s of Δv per tick**, far above a
soldier's 6 m/s top speed: friction cancels tangential slip outright and the
soldier sticks. With §8's locomotion force gated off whenever contacts exist,
**this is what moves a soldier standing on the ground.**

One imprecision worth carrying: `getPermanentGrip() & 0x20` jumps to
`0x0825c660`, which is *not* simply the spin-only path — it re-tests `& 0x4` and
falls back into the normal path at `0x0825b761` when EngineGrip is absent. The
`NoGrip` early-out (`+0xa4 == 0` or `getPermanentGrip() == 0` → live grip byte 0,
return, `0x0825b76b`) is exactly as described.

Which accumulator supplies `L` is the one point on which two same-day readings
differ: this one reads `impulse_avg.y` (`+0x68`/`+0x6c`) for a vehicle part and
`normal_avg.y` (`+0x98`/`+0x9c`) for a soldier, swapped at `0x0825c63e`, while
collision-response.md §8 describes the general case as the averaged normal.
Settle it before either number is used as an absolute.

### The spring, and why there is no ray (ledger PHY-5)

`PhysicsSpring::updatePhysics` (lnxded `0x0824ddd0`, client `0x0057f0d0`):

```
anchor = parentPos + rot(parentTransform) * offset          // offset = +0xb8
D      = anchor - this->getAbsolutePosition()
accel  = -( strength * g * (-1/9.82) * D  +  damping * (D - D_prev) / dt )
root->addAccelerationAtRelativePosition(anchor - rootPos, accel)
```

`strength` (`+0xd4` ← `SpringTemplate::getStrength` `0x082503c0`, template
`+0x16c`) multiplies the three `g·C·D` terms at `0x0824e325`; `damping`
(`+0xd0` ← `getDamping` `0x082503f0`, `+0x168`) multiplies the three difference
terms at `0x0824e340` — the pairing that could have been backwards and is not,
confirmed independently by the constructor's own bindings. `D_prev` is read at
`0x0824df7f` **before** the new `D` is stored at `0x0824e192`, so the damping
term is a one-tick backward difference of the displacement, not a node velocity.
The whole thing is skipped when `isSleeping()` (`+0xcc`), after
`setSleepiness(root->getSleepiness())`.

Two corrections to this corpus's old note on the client twin: the call is
`addAccelerationAtRelativePosition` (slot `+0x6c`), **not**
`AtAbsolutePosition`, and the position is relative to the **root** node, not to
the wheel contact.

**The axis is authored data that nobody authors** (read 2026-09-19, PHY-5
extended). `SpringTemplate`'s constructor (`0x0824fc40`) writes
`axisFixation = (0, 1, 0)` at `+0x15c` — `0x0824fc50 mov ecx,0x3f800000`, stores
`0x0824fc89`/`0x0824fc92`/`0x0824fc95` — and `positionalFixation = (0, 0, 0)` at
`+0x150`, and **no `.con` in any of the 18 installed mods writes
`setAxisFixation` or `setPositionalFixation`**: every objects archive was
surveyed per mod, zero hits. So every spring in every install runs on **the
object's own +Y**, which leans with the hull and is still never world-vertical.
The same constructor seeds damping `+0x168 = 0.5` and strength `+0x16c = 1.0`.

One consequence worth carrying, because it kills a tuning argument: at the
shipped `g = −14.73` the `−1/9.82` makes every spring act at **1.5× its
authored `strength`**, so the real heave damping ratio is `1/sqrt(1.5)` =
**0.816**, not 1.0. "DICE tuned these critically damped" depended on dropping
the 1.5.

**There is no ray**, along any axis — as far as a negative can be confirmed.
`Spring::handleCollision` (`0x0824f9b0`) writes only `+0x103` (touching) and
`+0x10c` (the material id) and tail-calls the base; contacts come from
`checkVsTerrain` (`0x0825a960`) walking `getVertexCollision` (`+0x5c`) and
`getFaceCollision` (`+0x58`); and the binary's only line-versus-triangle
primitive, `lineIntersection` (`0x08603b40`), has exactly two callers, both
inside AI pathfinding's object map. The spring's axis is authored data
(`SpringTemplate+0x15c`, `setAxisFixation`, printed by `makeScript`
`0x0824fe30` beside `setPositionalFixation` at `+0x150`) and is never
world-vertical. The mount offset `+0xb8` has one writer,
`setRelationToParentPosition` (`0x0824dda0`), whose only caller in the whole
binary is `Spring::init` at `0x0824f5ce` — so there is no `.con` word behind it.

The `c_PGFRollGripWhenOccupied` rewrite reads the occupancy byte at
**compositeObject `+0x105`** (`0x0824de24`), not `+0x11e`, under a mask of
`0x8`, and sets permanent grip 10 when occupied and 9 when empty.

### Submersion drag (ledger PHY-7)

`+0x44` in `PointPhysicsNode`'s drag scale is **submersion depth in metres**:
`setUnderWater(float)` (`0x08256ad0`) writes it and `getUnderWater()`
(`0x08256ae0`) reads it. The vehicle sibling keeps the same quantity at `+0x8c`
(`PhysicsNode::setUnderWater` `0x0824d430`, getter `0x0824d450`), which is why
§3 has `+0x8c` for the box law, and `StaticPhysicsNode::setUnderWater`
(`0x0825ead0`) is a pure no-op whose getter returns `fldz`. The law, re-derived
at `0x082562f2`–`0x08256320`:

```
scale = 1 + min(underWater / getBoundingRadius(), 1) * (25.0 - 1)      // 25.0 = 0x086ccce0
```

i.e. the familiar `1 + 24·min(uw/r, 1)`, with the 25.0 now read out of the
binary. `first-person-soldier.md` §7's entry can be closed; the soldier's own
bounding radius stays inferred.

---

## Still open

| | |
|---|---|
| ~~Jump impulse velocity~~ | **closed 2026-09-19** (§8, ledger PHY-1): **6.0 m/s**, applied as a one-tick acceleration through `addAccelerationAtRelativePosition` on both binaries, giving a 1.12 m apex and 0.80 s airtime. The server's block is live, not dead. It was never a velocity write, which is why the three ruled-out hiding places were all genuinely empty |
| ~~Per-bit grip force semantics~~ | **closed 2026-09-16** for what each bit selects (§6, ledger PHY-2); the magnitudes **closed 2026-09-19** ([collision-response.md](collision-response.md) §8) |
| ~~Whether the frame timer clamps `dt` before `World::update`~~ | **closed 2026-09-15** — there is no frame `dt` to clamp: the dispatch is `GameClient::simulateFrame(1/30)` run `nTicks` times per frame (§3); the tick *count* is clamped (>10 → 1 in `InputManager::update`, >9 → 1 in `GameClient::update`) |
| ~~`submarineData`'s 7 parameters~~ | **closed 2026-09-16** for five of them (ledger PHY-3): the 6th is the crush depth, the 5th the depth below which oxygen drains (with the 4th, the periscope pair), the 1st the drain rate and the 2nd the refill rate, capped at 1.0. The 3rd and 7th (suffocation and crush damage) are not re-verified |
| ~~Drag's `r` and `scale` factors~~ | **closed 2026-09-16** — `r` = `getBoundingRadius()`, delegated to the composite object; `scale = 1 + 24·min(underWater/r, 1)`, clamped above only, `underWater` = +0x44 (§3) |
| ~~What selects `PhysicsNode`'s Advanced drag~~ | **closed 2026-09-17** (ledger PHY-4): the bit is never set, so every `PhysicsNode` always runs Advanced/box drag; sphere `r = 0.1` is unreachable. `hasPointPhysics` selects `PointPhysicsNode` (flag `0x8`), a separate path (§3) |
| **The server's tick rate (LOOP-1, opened 2026-09-20)** | **One reader** says lnxded's `Setup::mainLoop` (`0x080bc0b0`) targets **60 Hz** with a **measured** frame dt and no accumulator below it, `g_simulationFps` being a never-written scale constant that `Setup::initEngine` doubles (`0x080bc632`). That would make every per-call quantity in this corpus per *frame*, and PHY-1's apex and PHY-6's ramp times frame-rate figures. Not re-derived; §3 says what a second reader must check. **Do not build on it, and do not restate the 30 Hz claim as settled without reading it** |
| A spawned particle's mass and bounding radius | the body defaults to mass 1.0; the radius a sprite or mesh particle reports is unread — the blocker for replacing `effects-core.js`'s exponential drag |
| B17 `setDifferential` tension | 4 nacelles at 1.9 = 7.6 vs a fighter's 5. Code reading is quadruple-anchored, so this is evidence about the `.con` data or the gear table — **do not re-tune on it** |
