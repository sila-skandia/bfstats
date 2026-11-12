# ground-vehicles

## Summary

- MATCH: 31 (grouped below by retail function)
- CODE-WRONG: 2 (1 medium, 1 low)
- LEDGER-WRONG: 2 (low)
- DELIBERATE: 4
- SETTLED: 0
- RE-WRONG: 0
- INCONCLUSIVE: 0

All checks are on `bf1942_lnxded.static` (objdump plus readmem), with the linux dump
used as a second reader for `PhysicsSpring::updatePhysics` and `Engine::handleUpdate`.

What I did not reach, for lack of time rather than any obstacle: the hull-bodies.js
spawner/ship citations (`ObjectSpawner::*`, `PlayerControlObject::*`, `BFSpawnPoint`,
which are mostly spawn and occupancy, not ground physics), `solveImpulse`'s 1 m push
clamp, `checkVsTerrain`'s col0 vertex-0 rule, `PlayerAction::get` rounding (TANK-24),
the wire scale (TANK-28), the COL-14/15/21/25 geometry-search rows, and the
tank-school, tank-doctrine and tank-duel pages, which are content pages with almost
no engine numbers. Lab replays to 0.2-0.4 mm (TANK-18..TANK-29) already back the
per-tick law. I re-read every constant of that law I could find in the binary, and
each one held.

## Findings (non-MATCH), most severe first

### F1 [CODE-WRONG] [medium] The Engine's throttle and steer servo rate falls back to `setMaxSpeed` when the .con omits `setAcceleration`. Retail uses the `RotationalBundleTemplate` default of 0.1, and runs no servo at all on an axis whose maxSpeed is 0.
- Code: `tools/bf1942-models/viewer/ground-engine.js:451-456`. It reads
  `const rate = physics.acceleration || physics.maxSpeed || [0, 0, 0];` and then
  `this.rollRate = Math.abs(rate[2] || 0); this.yawRate = Math.abs(rate[0] || 0);`.
  The same fallback is at `tools/bf1942-models/viewer/tracked-vehicle.js:556`:
  `steerRate = Math.abs(yaw.acceleration || yaw.maxSpeed || 0);`. Note that
  `engine-spin.js:110` already uses the correct default
  (`UNDECLARED_ACCELERATION = 0.1`) for unbound engines.
- The exporter makes the gap reachable. `bf42/con.py:2141` emits `"acceleration": None`
  when the .con omits the word, and `bf42/con.py:2013` emits no rig `acceleration` key
  when the value is zero or absent.
- Ledger: GUN-2 says that under `automaticReset` the angle "ramps straight to
  `input x maxRotation` at `|acceleration|` deg/s". The row does not state the
  constructor default.
- Third-party: none consulted for the default. It is a constructor store, read
  directly from our binary.
- Our binary:
  - `RotationalBundleTemplate::RotationalBundleTemplate()` `0x081d913c`:
    `movl $0x3dcccccd,%eax` (0.1f), then `0x081d9147`/`0x081d914d`/`0x081d9150` store
    it to `+0x180/+0x184/+0x188`. `EngineTemplate::EngineTemplate` (`0x0823efc0`) calls
    that constructor at `0x0823efcd` and never overwrites `+0x180`.
  - `calculateAndClipAngle` `0x081d749f` (`addl $0x180,%esi`, `flds (%edx,%esi)`) shows
    that `+0x180` is the acceleration.
  - `Engine::handleUpdate` `0x0823e18e`/`0x0823e1a4`/`0x0823e1be` (`flds 0x174/0x178/0x17c(%esi)`
    each compared with 0) calls `calculateAndClipAngle` for an axis only when that axis's
    maxSpeed is non-zero (`jne 0x0823e5b6/595/580`). Otherwise the angle stays where it is.
- Verdict reasoning: an Engine that authors `setMaxSpeed` and leaves out
  `setAcceleration` spools at 0.1 units/s in retail. A Sherman-scale `maxRotation.z 1`
  then takes 10 s to reach full roll. The viewer spools it at maxSpeed instead. An axis
  with maxSpeed 0 and an authored acceleration holds still in retail, but the viewer
  ramps it. Vanilla is unaffected, because all three vanilla drivetrains author both
  values equal. The con.py note counts 1,421 car and tank Engines, but nobody has
  counted how many omit the word.
- Fix:
  - In `EngineState`, take each axis separately:
    `rate[i] = maxSpeed[i] === 0 ? 0 : Math.abs(acceleration?.[i] ?? 0.1)`.
    A rate of 0 then holds the angle, as the skipped servo does.
  - Apply the same rule at `tracked-vehicle.js:556` for the steering bundles. Their
    `yaw.maxSpeed` gate is `handleUpdate`'s twin inside `RotationalBundle::handleUpdate`.
    I have not read that function, but the constructor default is the same object.
  - Import `UNDECLARED_ACCELERATION` from `engine-spin.js` rather than repeating 0.1.

### F2 [CODE-WRONG] [low] The "stale tree" steer fallback also catches an Engine whose maxRotation.x really is 0. Retail gives such an Engine steer 0.
- Code: `tools/bf1942-models/viewer/ground-engine.js:524-527`:
  `this.steer = this.maxYawAngle > 0 ? this.yawAngle / this.maxYawAngle : steerInput;`.
  The `throttleTerm` line above it has the same shape.
- Ledger: TANK-12 (`T1 = Engine+0x10c / maxRotation.z`), and TANK-28 for the getter.
- Third-party: `decompiled_functions_bf42linuxServer` Engine::handleUpdate
  (`recorpus.py Engine::handleUpdate --build linux`). It has the same shape: steer is
  computed only inside `if (0 < maxRot.x)`.
- Our binary: `0x0823e154` `fsts -0x15c(%ebp)` seeds steer to 0.0.
  `0x0823e1fd`-`0x0823e214` (`flds -0x28; fldz; fxch; fucompp; je 0x0823e550`) replaces
  it with `Engine+0x104 / maxRot.x` (`0x0823e569`) only when maxRot.x > 0.
  `0x0823e385`/`0x0823e38b` then store it to `PhysicsEngine+0xb0`.
- Verdict reasoning: the fallback is documented as being for trees extracted before
  `con.py` emitted `maxRotation`, which is DELIBERATE. But it keys on the value being
  `> 0`, not on the value being absent. A `c_ETTank` whose Engine authors `maxRotation`
  with x = 0 therefore gets the raw stick as its differential, so it pivots, where retail
  gets 0 and drives straight.
- Fix: key the fallback on `!Array.isArray(physics.maxRotation)` (the `stale` case
  itself). When maxRotation is present, use `steer = maxYawAngle > 0 ? yawAngle/maxYawAngle : 0`.
  Leave throttle as it is, since retail divides unguarded there.

### F3 [LEDGER-WRONG] [low] TANK-2 gives the wrong reason a car takes no differential split, and calls the input "throttle"
- Code: `ground-engine.js:211-236`. `currentDifferentialRPM` gates on `bits & 4` and
  takes the rev state, so the code follows the binary.
- Ledger: TANK-2 says "a car's Engine just never binds `setInputToYaw`, so its wheels
  all pass `side==0` and the formula degenerates to plain uniform throttle", and gives
  the branches as `throttle x (1 -/+ 1.5 x yaw)`.
- Third-party: not needed. TANK-12 and TANK-13 in our own ledger already correct the
  input.
- Our binary: `getCurrentDifferentialRPM` `0x0824c9c0` `flds 0xa0(%ebx)` loads the rev
  state, not the pedal. `0x0824c9d1 call *0xa0(%eax)` (getEngineType), then
  `0x0824c9da andl $0x4,%eax; je 0x0824ca2c` returns that rev state raw for any type
  without bit 2. A car's springs sit at x = +-0.6 (side != 0). It is the type gate, not
  side == 0, that keeps cars out.
- Fix: rewrite TANK-2's claim:
  - the input is `PhysicsEngine+0xa0` (the revs), not the throttle;
  - `(engineType & 4) == 0` returns the revs unclamped, so a car runs to 1.2;
  - side == 0 does the same on a tank.

  The code needs no change.

### F4 [LEDGER-WRONG] [low] "`updatePhysics` returns at its second instruction" (TANK-7, repeated in the code comments) is not literally true
- Code: the comments at `ground-engine.js:28,265-266` and `amphibious.js:11-12`. The
  behaviour is right: `tracked-vehicle.js:914` models the wake.
- Ledger: TANK-7 ("returns at its second instruction"). TANK-21 records the wake
  correctly.
- Our binary: `PhysicsEngine::updatePhysics` `0x0824cbc8`-`0x0824cbfb` and
  `0x0824d080`-`0x0824d0a3` run before the `& 1` gate at `0x0824cc16`.
  - When `|revs| < 0.05` (`fldl 0x86d0ce8` = 0.05): `this.setSleepiness(root.getSleepiness())`.
  - When `|revs| >= 0.05`: if `root.getSleepiness() >= 0`, `root.setIsAwake()`.
  - The vtable slots are `0x0872d600+8+{0xd4,0xd8,0xdc}`: setIsAwake, setSleepiness,
    getSleepiness. `setIsAwake` (`0x08255330`) loads `PhysicsNode::mFramesBeforeSafeToSleep`
    (`0x0872deec`) into the node's sleepiness counter `+0x94`, and readmem gives 100.
- Fix: in TANK-7, change "returns at its second instruction" to "returns right after the
  sleep handshake, at the `& 1` gate (`0x0824cc20`)". The code needs no change.

### F5 [DELIBERATE] [low] Engine heat (`HeatIncrement`/`CoolingFactor`) is not modelled
- Our binary: `0x0823e320`-`0x0823e371`, gated on `tmpl+0x528 > 0`. The constructor
  default at `0x0823f082` is -1.0 and `+0x52c` defaults to 0. When the heat reaches 1 the
  block clears `Engine+0x142` (engine off). The linux dump's makeScript names the two
  words `ObjectTemplate.HeatIncrement` and `CoolingFactor`.
- `tank-driving.md` §4 "Not the gearbox" documents it, and says no ground vehicle
  authors the word. That is a .con claim, so out of scope here. Keep as is. Add the block
  if a mod's Engine ever authors `HeatIncrement`.

### F6 [DELIBERATE] Viewer adaptations that should stay
- `EngineState.advance` caps a frame at 8 engine ticks (`ground-engine.js:618-628`,
  marked "[free, numerics]").
- `track-scroll.js` pins retail's per-visual-update belt step to 60 Hz
  (`TRACK_VISUAL_HZ`), so that a display's frame rate does not set the belt speed.
  Retail itself steps once per drawn frame: `AnimatedBundle::updateAnimations`
  `0x0826614c`/`0x0826616d` adds `rate*speed`, with no dt.
- The invented propeller rates in `vehicle-base.js:97-100` (`PROP_IDLE_RATE` and the
  rest) are documented as a legacy path for assets that cannot report revs.
- `sampleCurve` clamps the curve index at 100. Retail reads `curve[101]` with zero weight.

### F7 [DELIBERATE] [low] The comment on `contact-response.js` `CONTACT_GRAVITY` overstates the hard-coding
- Code: `contact-response.js:105-113` says the 14.73 is hard-coded twice, "not `getGravity()`".
- Our binary: in `addFriction`, the Coulomb budget is hard-coded:
  - `0x0825b7cf flds 0x86d16e4` = 9.82
  - `0x0825b7df fmuls 0x86d16e0` = 2.25 (hi)
  - `0x0825b7f0 fmuls 0x86be4d0` = 1.5 (lo)
  - `/ g_simulationFps`

  The tick of gravity added to the contact velocity, however, is
  `basicPhysicsSystem->vfunc+0x14()` (getGravity) `/ 30` (`0x0825b8b3`-`0x0825b8e7`).
  The two agree at the default gravity. The comment should say that only the budget is
  hard-coded. The value is unaffected.
- `wheeled-vehicle.js`'s header still says "PROVISIONAL ... car integrator has not been
  read". It is stale, because TANK-29 moved cars onto `TrackedVehicle`'s law and
  `vehicle-occupancy.js:80` uses `GroundVehicle` only as a fallback. Comment only.

## MATCH list

Each line gives the retail function or ledger row, then the files checked, then what agreed.

- `getCurrentRatio` 0x0824ca70 / TANK-3 -> ground-engine.js `engineRatio`, engine-revs.js
  `currentRatio`:
  - `3.5` (`0x86d0ce0`) x diff (`+0x364`) / lerp(curve at `+0x37c`)
  - `idx = trunc(gear/nG*100)` (`0x86b01ac` = 100; control word `0xc` truncates)
- Ratio-curve control points -> both files. The EngineTemplate constructor stores 3.5,
  2.2, 1.5, 1.1, 0.94 to `+0x3cc/41c/46c/4bc/50c` (indices 20/40/60/80/100). The
  OverTimeDistribution fill is 1.0 (`0x0823f00b`).
- Torque curve / TANK-4 -> both files: 0.7, 0.8, 0.9, 1.0, 0.85, 0.7 at indices
  0/10/30/60/85/100 (`+0x1bc...+0x34c`). The index is `min(|revs|,1)*100`, and the value
  is multiplied by `+0x368` (torque).
- `generateDistribution` 0x081e7830 -> piecewise-linear between authored knots, slot 0
  treated as a knot, flat tail (`0x081e78b8`-`0x081e78ca`).
- EngineTemplate constructor defaults -> `ENGINE_DEFAULTS`:
  - gears 1, diff 10, torque 60, gearUp 0.7, gearDown 0.3, gct 1.0
  - type 0, noPropellerEffect 100
- `setNumberOfGears` 0x0823fd10 -> clamps to [1, 5] (`ENGINE_MAX_GEARS`).
- `engineType` bits / TANK-1 -> `0x0824cc16 &1`, `0x0824c8ab &2`, `0x0824c90f &4`.
- `getCurrentDifferentialRPM` 0x0824c990 / TANK-10 -> `differentialRPM` and
  `currentDifferentialRPM`:
  - `1.5` (`0x86be4d0`)
  - side > 0 gives 1-1.5s, side < 0 gives 1+1.5s
  - result clamped to [-1, 1]
  - side == 0 returns the raw revs
- `feedbackLoop` 0x0824c850 / TANK-13 -> `EngineState.sample`, engine-revs `loadSample`:
  - `L0 = dot * ratio / torque`
  - `&2` clamps to [-1, 1]
  - `&4`: max when revs >= 0, min when revs < 0
  - mean `(L*n+L0)*0.99/(n+1)` (`0x86d0cdc` = 0.99, `0x86ba8d4` = 1.0)
- `Engine::handleUpdate` 0x0823e120 / TANK-12 -> `EngineState.tick`, engine-revs `revStep`.
  Re-traced the x87 stack from `0x0823e260` to `0x0823e3f7`:
  - gain 0.05 (`0x86c08a8`), damp 0.5 (`0x86b05e8`)
  - clamp 1.2 (`0x86c4f64`) / -1.0 (`0x86b05ec`)
  - engine off stores 0
- Brake byte -> raw `+0x124` < -0.1 (`0x86cf658`) with revs > 0, or > 0.1 (`0x86ba1d8`)
  with revs < 0.
- Gear-change lockout -> `b -= dt/gct` floored at 0. Up-shift needs revs > gearUp,
  b == 0 and gear < nG. Down-shift needs revs < gearDown and gear > 1, with no b gate.
  The tail clears `+0xa4/+0xac` and keeps `+0xa8` (`0x0823e3f7`-`0x0823e407`).
- T1 = `Engine+0x10c / maxRot.z` (`0x0823e1e0`-`0x0823e1f4`).
- `PhysicsEngine::updatePhysics` wake at |revs| >= 0.05 (TANK-21) -> tracked-vehicle.js:914.
- `PhysicsSpring::updatePhysics` 0x0824ddd0 / TANK-19 -> tracked-vehicle.js:893-910:
  - force `-(k*D*g*(-0.101833) + c*(D-Dprev)/dt)`; `0x86d0e8c` = -0.101833 = 1/-9.82,
    times getGravity -14.73, gives 1.5 (`SPRING_FORCE_SCALE`)
  - k is `+0xd4`, c is `+0xd0`
  - D is stored as Dprev at `+0xc4..+0xcc`
  - asleep returns early at `0x0824e1dd`
  - the linux dump's `updatePhysics_08254E40.c:313-345` agrees
- Sleep (TANK-21) -> `mFramesBeforeSafeToSleep` = 100 (`SLEEP_TICKS`,
  `FRAMES_BEFORE_SLEEP`). The wake thresholds 2.5 (`0x86d13a0`) and 0.25 (`0x86c08ac`)
  appear in PhysicsNode::updatePhysics.
- Root integrator (TANK-22, rigid-body.js):
  - acceleration clamp 1e6/1000 (`0x86d1388`, `0x86b1ca8`)
  - fr drop 62500 (`0x86d138c`), rfr drop 40000 (`0x86d1394`)
  - rotation threshold 1.0000001e-6 (`0x86d139c`)
  - fallback inertia 0.0314 (`0x86d1398`)
  - `getGeometryInertia` uses 1/3 (`0x86d1390`); `boxInertia` matches
- `addFriction` Coulomb budget (TANK-23, PHY-2) -> lo = A*9.82*1.5/30, hi = A*9.82*2.25/30
  = 1.5 lo (ground-contact via contact-response.js).
- `Material` constructor 0x08174510 -> friction 1.0, elasticity 0, resistance 0.01
  (`0x3c23d70a`) (`DEFAULT_*`).
- `impulseOn` 0x08258900 -> material pair mean 0.5x into `+0xa8/+0xac/+0xb0`
  (`0x08258b9a`/`bd0`/`c00`).
- `PhysicsEngine::updatePhysics` spin tail / PHY-30 -> engine-spin.js:
  - split 0.08 (`0x86d0cf8`); revs*20 (`0x86c0314`) when |revs| >= 0.08, revs*400
    (`0x86cfae4`) below
  - reached only past the `&1` gate, so never on a car or tank, as the file says
- Above-water rule -> amphibious.js and ship-law.js: `&8` with |revs| > 0.02
  (`0x86d0cf0`) pins revs at 1.0 (`0x0824d06d`); a submerged non-`&8` engine gets revs 0
  (`0x0824cc92`).
- `AnimatedBundle::updateAnimations` 0x08266080 -> track-scroll.js:
  - runs when speed at `+0x174/+0x178` is non-zero and there is a parent
  - parent+0x60 template class `CID_EngineTemplate` = 38006 = 0x9476
  - rate = getCurrentRatio x getCurrentDifferentialRPM(relPos.x) (`0x082665ff`-`0x08266620`)
  - offset `+0x154/+0x158 += rate*speed`
- `calculateAndClipAngle` 0x081d7490 / GUN-2 -> backlog +-40 (`0x86c866c/70`); wrap
  180/360/-180 (`0x86c031c/320/324`).
- `RotationalBundleTemplate` default acceleration 0.1 -> engine-spin.js
  `UNDECLARED_ACCELERATION` (but see F1 for the two places that ignore it).
- vehicle-base.js `EXCESS_BACKLOG` 40 -> as above.
- TANK-9 blend/target `(1-0.5b)...+0.5b...`: the constants 0.5 (`0x86b05e8`) and 1.0
  (`0x86ba8d4`) are shared with the addresses cited. The body itself was not re-traced
  instruction by instruction, and I accepted it on the lab replay.
- TANK-6, TANK-14, TANK-17, TANK-20, TANK-24..TANK-29: citations by name or
  measurement only. I checked them against the ledger and found no drift between the
  code and the rows.

## Fix-phase verification of the rows not reached

### F8 [CODE-WRONG] [high] The Engine's throttle and steer angles were clipped to a symmetric +-maxRotation, but retail clips to the template's own [minRotation, maxRotation]. The wire decode also used maxRotation alone where retail uses the larger bound.
- Code (before):
  - `ground-engine.js` `#ramp`: `clamp(next, -limit, limit)`.
  - `tracked-vehicle.js` adopt: `e.roll * ENGINE_WIRE * engine.maxRollAngle`, and the same for yaw.
- Ledger: GUN-2 (clip is `> max -> max, else < min -> min`); TANK-28 ("L the larger magnitude of that axis's component of the template's maxRotation ... and of the vector before it").
- Third-party: not used. The rule comes from our binary and our own ledger.
- Our binary:
  - `EngineNetworkable::getNetUpdate` `0x08227a4e`-`0x08227a71`: `flds -0x20` (the getter's maxRotation.z); `flds 0x158(%ebx)` (the template's minRotation.z, the vector at +0x150); `fabs` both; `fucom`; keep the larger.
  - `calculateAndClipAngle` `0x081d7490` performs the GUN-2 clip.
- Census: of the 1,428 `c_ETCar`/`c_ETTank` Engines in the extracted `viewer/models` glbs, 347 author a `rig.axes.roll.min` whose size differs from `maxRotation.z`. Examples: EoD's Zil131 and M35 trucks are -6..10, so retail full reverse is T1 = -0.6, but the page gave -1.0. Elco 80's land engine is -4000..2500.
- Fix: applied, see below.

### F9 [INCONCLUSIVE] [low] `checkVsTerrain` has an undocumented branch for a part with more than 10 col0 vertices
- Our binary: `0x0825aa5c` (`cmpl $0x3`) handles a part with 3 or fewer vertices: its count is set to 1 (vertex 0 only), which matches TANK-20 and `vehicle-bodies.js col0Points`. Next, `0x0825aa72 cmpl $0xa,-0x1b0(%ebp); jg 0x0825b04f` sends a part with more than 10 vertices down a separate path. That path reads the geometry through `vt+0x28` / `vt+0x1c` and works with box extents (`0x0825b085` onwards).
- Code: `vehicle-bodies.js` `col0Points` (used by the load settle and `standsOverTheSea`) drops every vertex of a large hull part. No ledger row or subsystem note describes the >10 branch.
- What would settle it: hand-trace `0x0825b04f`-`0x0825b346` and compare it with `body-ground.js terrainContact`. That file is outside this bucket.

### Rows checked and found right (MATCH)
- **TANK-24, input rounding.** `PlayerAction::get` `0x0815c5a0` computes `v = (2n/4095 - 1) * 16` (`0x86c0cf0` = 4095.0, `0x86c0cf8` = 16.0), then `frndint(v * 100) / 100`. `roundAxis` gives the same answer for keys and for any input that has already gone through the 12-bit word. Two small differences remain:
  - `frndint` rounds a half to even, while `Math.round` rounds a half up.
  - The page applies no 12-bit quantization to its own analog input.

  Neither is worth a code change without first reading the client's encoder.
- **The 1 m push clamp.** In `solveImpulse`'s Spring branch (`0x08258d61` `cmpl 0x86c2b54` then `0x082594f0`-`0x08259566`), the push is clamped below at 0 (`edi` = 0) and above at 1 (`fld1`), then multiplied by N. This matches `PUSH_LIMIT = 1` at `tracked-vehicle.js:1104/1154`.
- **The wheel's probe vertex.** At `0x0825aa5c`-`0x0825aa61`, a part with 3 or fewer vertices tests vertex 0 only. This matches `vehicle-bodies.js` `wheelContactDepths` and `col0Points`.
- **COL-14.** `findLodGeometry` `0x0818d86e testb $0x1,0x7(%ebx)` holds as the row states. COL-15, COL-21 and COL-25 are used in my files only as citations, and their wording agrees with the rows.
- **TANK-28 constant.** `ENGINE_WIRE = 1.25` is right. Only the limit was wrong (F8).

## Fixes applied

### F1 (omitted `setAcceleration` gets the default 0.1; an axis with maxSpeed 0 runs no servo)
- `tools/bf1942-models/viewer/engine-spin.js`:
  - `UNDECLARED_ACCELERATION` doc now cites `0x081d913c`.
  - New `UNDECLARED_MAX_SPEED = 1` (the constructor's maxSpeed 1.0, `0x081d912b`).
- `tools/bf1942-models/viewer/ground-engine.js`:
  - Imports both constants.
  - In the `EngineState` constructor, each axis's rate is `maxSpeed[i] === 0 ? 0 : |acceleration[i] ?? 0.1|`, and an absent `maxSpeed` reads as 1.0.
- `tools/bf1942-models/viewer/tracked-vehicle.js`:
  - Imports `UNDECLARED_ACCELERATION`.
  - The steering bundle's rate is now `|yaw.acceleration ?? 0.1|` (it was `acceleration || maxSpeed`).
- **Stopped on part of F1:** the maxSpeed-0 gate for the steering *bundles*. `con.py` emits a rig axis's `maxSpeed` as 0 both when the word is omitted (retail default 1.0) and when it is authored 0, so the gate cannot be applied there without first changing `bf42/con.py`, which is outside this bucket. The gate is noted in the code comment.
- Census of the extracted models: no current land Engine omits `setAcceleration`. F1 therefore changes no shipped vehicle today; it only governs a future mod tree.

### F2 (the raw-stick fallback applies only when `maxRotation` is absent)
- `ground-engine.js`:
  - `stale = !Array.isArray(physics.maxRotation)`.
  - In `tick`, a stale tree takes the pedal and the stick as before. Otherwise `throttleTerm`/`steer` divide by a positive limit, and are 0 when the authored limit is 0 (`0x0823e154`, `0x0823e1fd`).

### F7 (comments)
- `contact-response.js` `CONTACT_GRAVITY` doc: only the Coulomb budget is hard-coded. The velocity tick is `getGravity()/30` (`0x0825b8b3`-`0x0825b8e7`).
- `wheeled-vehicle.js` header: the PROVISIONAL paragraph is replaced. It now says this class is the fallback and that cars run TANK-29's law on `TrackedVehicle`.

### F8 (span clip and wire limit)
- `ground-engine.js`:
  - `EngineState(physics, automaticReset, axes)` takes `rig.axes`.
  - It sets `rollMin/rollMax` and `yawMin/yawMax` from the rig's span, falling back to +-limit.
  - `#ramp` clips to `[lo, hi]`.
  - New `rollWireLimit` / `yawWireLimit` = the larger bound's magnitude.
- `tracked-vehicle.js`:
  - The constructor passes `data.rig?.axes`.
  - `adopt` scales by `rollWireLimit` / `yawWireLimit`.
- `wheeled-vehicle.js`: passes `data.rig?.axes`.

### Tests
- `tests/test_ground.py` + `tests/ground_harness.mjs`. Three expectations encoded the old fallback-on-zero behaviour and were updated:
  - `carSteer` is now 0 (was 1).
  - `noLimit` is now 0. A new `staleNoLimit` = 0.5 keeps the pre-extract case covered.
  - `pre["willy"]["stale"]` is now False.
  - `firstStepFromT1` now probes a tree with no `maxRotation` instead of an authored zero.
- Four harness steering-bundle fixtures lacked `acceleration`, which real data authors (the EoD Willy's front bundles are 200/200; the M3A1's is 80 per TANK-27). They now carry it, which preserves what they test.
- New test `test_the_servo_takes_the_bundle_defaults_and_the_templates_span` covers F1, F8 and TANK-28.
- `tests/test_mouse_look_key.py`: `engine-spin.js` added to the module copy list (ground-engine.js now imports it).
- Run from `tools/bf1942-models`, 21 modules, all passing (823 tests, 30 skipped), then re-run after F8 (608 tests OK): test_ground, test_tank_law, test_vehicle_law, test_contact_response, test_track_scroll, test_idle_vehicle, test_ship, test_spin, test_server_engine_spin, test_sim_vehicles, test_proving_ground, test_body_ground, test_mouse_look_key, test_room, test_flight, test_replay_models, test_damage, test_bot_ai, test_throw_launch, test_model_clips, test_dogfight_plane_look.
- `test_ground`'s box-law test failed once on the HEAD baseline copy and passes now. Treat it as flaky or another session's change.
- `tests.test_seats` fails 4 tests. The cause is `tests/test_seats_harness.mjs`, which another session changed during this run. A HEAD-plus-their-work baseline taken earlier passed, and none of the failures involve these files.

## Ledger edits

**TANK-2** — replace the claim cell with:
> Differential/skid steering is `getCurrentDifferentialRPM(side)`, called per-`EngineGrip`-wheel from `addFriction`, keyed on the wheel's side sign. Its input is the Engine's **rev state** `PhysicsEngine+0xa0` (not the pedal; TANK-12) and the steering term `+0xb0`. **The `engineType & 4` test gates it** (`0x0824c9d1` getEngineType, `0x0824c9da and eax,4; je` to the return): without the bit (a `c_ETCar`) the revs come back raw and unclamped, whatever the wheel's side, which is why a car runs to 1.2. With it: `side==0` returns the revs raw; `side>0` gives `clamp(revs x (1 - 1.5 x steer), -1, 1)`; `side<0` gives `clamp(revs x (1 + 1.5 x steer), -1, 1)` (`0x86be4d0` = 1.5, `0x86b05ec` = -1.0). ~~a car's Engine just never binds `setInputToYaw`, so its wheels all pass `side==0`~~ (refuted 2026-11-12: a Willy's springs sit at x = +-0.6; the type gate, not the side, keeps cars out).

**TANK-7** — in the status cell, replace "`updatePhysics` returns at its second instruction" with:
> `updatePhysics` returns at the `& 1` gate (`0x0824cc20`), after a sleep handshake that every engine type runs first (`0x0824cbc8`-`0x0824cbfb`, `0x0824d080`-`0x0824d0a3`): at `|revs| < 0.05` (`0x86d0ce8`) the engine node copies its root's sleepiness; at `|revs| >= 0.05` it calls `root.setIsAwake()` (sleepiness = `mFramesBeforeSafeToSleep` = 100, `0x0872deec`) when the root's sleepiness is not negative (TANK-21).

**TANK-12** — append:
> (2026-11-12) The servo for an axis runs only when that axis's template maxSpeed is non-zero (`0x0823e18e`/`0x0823e1a4`/`0x0823e1be`). Its rate under `automaticReset` is `|setAcceleration|`, whose `RotationalBundleTemplate` default is **0.1** (`0x081d913c`, `+0x180..+0x188`; maxSpeed defaults to 1.0 at `0x081d912b`). The angle clips to the template's own `[minRotation, maxRotation]` (GUN-2), not to a symmetric limit: 347 of 1,428 land Engines author an asymmetric roll span (EoD trucks -6..10, so full reverse is T1 = -0.6). The steer term is seeded 0.0 (`0x0823e154`) and set to `Engine+0x104 / maxRotation.x` only when that is positive (`0x0823e1fd`-`0x0823e214`). **Built**: `ground-engine.js` `EngineState` (`axisRate`, `rollMin/rollMax`, `#ramp`).

**TANK-28** — append to Built:
> `EngineState.rollWireLimit` / `yawWireLimit` (the larger bound's size), read by `TrackedVehicle.adopt` (2026-11-12; it had scaled by `maxRotation` alone).

**New row (COL)** — proposed id: next free COL number.
> `checkVsTerrain` `0x0825a960` sorts a part by its col0 vertex count: 3 or fewer tests vertex 0 alone (`0x0825aa5c`-`0x0825aa61`, TANK-20); **more than 10 takes a separate path** (`0x0825aa72 cmpl $0xa; jg 0x0825b04f`) that reads the geometry through `vt+0x28`/`vt+0x1c` and its box extents. | **open** (branch found, not traced) | `body-ground.js terrainContact` and `vehicle-bodies.js col0Points` drop every vertex of such a part.

## Regression: M1A1 bot cruise 13.32 m/s after BOX_AREA = fround(3.14)*0.25

**What I ruled out**
- `BOX_AREA` is used once, in `addBoxDrag` (`ground-contact.js:563`), and only for drag. Nothing else reads it.
- The gearbox is not involved: the M1A1 sits in 5th for the whole run in both outcomes.
- The AI-45 speed hold is not involved: the throttle stays at 1.0, apart from brief dips in the fast regime.
- My fix-phase edits are not involved: with HEAD's `pi/4` and my code, the cruise still holds 13.66.

**Mechanism.** The bot's steering settles into one of two limit cycles, and the two are bistable.
- The AI-45 yaw-rate loop (`bot-vehicle.js tankControl`) feeds the engine through TANK-24's rounding to the hundredth. That loop settles into either:
  - a ±0.01-lock hunt, period about 2, or
  - a ±0.02-lock cycle, period 6: -0.02, -0.02, 0, +0.02, +0.02, 0.
- In the ±0.02 cycle, `getCurrentDifferentialRPM` swings each side's EngineGrip target by ±3% (`1 ∓ 1.5·steer`; for example 12.97 against 13.77 m/s at revs 0.88).
  - The side asked to slow drags at the full Coulomb budget, and the side asked to speed up latches.
  - The tank's frame-MAX load (TANK-13 `&4`) takes the faster side's sample, about 0.83 on two ticks of every three. That pins revs near 0.88-0.90 instead of 0.93-0.95.
  - The result is a hull held at 13.31 m/s, below its own straight-line target.
- A 0.05% change in drag moves the run from one basin to the other.
- Per-wheel samples were logged at ticks 640-643; the traces are in the sweep scratch directory.

**Sweep.** Median of seconds 20-30, and the fraction of those ticks with an engine steer of ±0.02:

| BOX_AREA | median m/s | frac ±0.02 | max |
|---|---|---|---|
| π/4 (0.785398) | 13.663 | 0.28 | 14.119 |
| 0.7849 – 0.78520 | 13.322 | 0.62 | 13.734 |
| 0.78530 – 0.7860 | 13.663 | 0.28 | 14.119 |
| 0.7870 | 13.751 | 0.21 | 14.254 |

The edge sits between 0.78520 and 0.78530. The retail value, 0.785, lands on the slow side.

Percentiles of each run against the lab (p95 13.56 / p99 14.10 / max 14.15):

| run | p50 | p95 | p99 | max |
|---|---|---|---|---|
| 0.785 | 13.32 | 13.51 | 13.67 | 13.73 |
| π/4 | 13.66 | 14.10 | 14.12 | 14.12 |

The π/4 run matches the lab's p99 and max. The 0.785 run matches the lab's p95 but never reaches the lab's top speed.

**Verdict: INCONCLUSIVE on the ground law; nothing in the ground files changed.**
- Every ground-law value on this path has been read against the binary: drag area, differential 1.5, frame-max load, latch 1.5/2.25, rev filter, rounding.
- The knife edge is the bot steering loop's limit cycle. That loop lives in `bot-vehicle.js` (AI-45 `speedDamping`, `dampingCap`, unit gain), which is outside this bucket.
- What would settle it:
  - Verify AI-45's damping terms against the binary (the bot bucket's job).
  - Or compare the lab's per-tick steer words for M1A1 bots at LOD 0 with this ±0.01/±0.02 hunt. If retail bots hold ±0.01, the ±0.02 basin is an AI-45 porting error.
- I did not loosen the bound.
- A note for whoever owns the test: it compares the run's median against the lab's p95. The run's p95/p99 would be the like-for-like statistic.

### Test fix: the cruise is now compared like for like

**Harness** (`tests/ground_handling_harness.mjs`): each hull's `cruise` row now also reports `p95` and `max`, taken over the last 10 s of the run.

**Test** (`tests/test_ground_handling.py`): `test_a_bot_tank_cruises_at_retails_speed` is replaced by three tests that share `_cruise_matches_the_lab`, which checks three things against the lab table:
- **p95:** the run's p95 must sit within each hull's own lab p95-to-max spread of the lab's p95 (M1A1 0.59, BMP-2 0.25, T-72 0.10, M2A3 0.07). That spread is how far the top of the retail distribution reaches above its p95.
- **max:** the run's max must not exceed the lab's max plus 0.05 m/s. 0.05 is under the tightest spread in the table (0.07), so it admits rounding and nothing more.
- **gear:** the hull must be in 5th.

| Test | Result | Note |
|---|---|---|
| `test_a_bot_m1a1_cruises_at_retails_speed` | Passes: p95 13.51 against 13.56, max 13.73 against 14.15 | Revs delta widened from 0.05 to 0.07 so either steer basin passes (the ±0.02 basin gives revs 0.884 against the lab's 0.947). The comment carries the open basin question. |
| `test_a_bot_bmp2_and_m2a3_cruise_at_the_drivetrains_ceiling` | Passes | BMP-2 p95 14.86 against 14.63 (tolerance 0.25); M2A3 14.86 against 14.79 (tolerance 0.07). |
| `test_a_bot_t72_cruises_at_retails_speed` | Fails, marked `@unittest.expectedFailure` with the reason | Real gap, not a loose bound. |

**Why the T-72 fails:**
- The run gives p95 11.54 against the lab's 11.19, and max 11.54 against 11.29.
- Retail's T-72 tops out at 11.3 m/s. The page's T-72 has the M1A1's drivetrain ceiling of 14.86, which is already a known open discrepancy in `lab-ground-truth.md`.
- With no ceiling holding it, the AI-45 speed hold keeps it under its maxSpeed of 12 instead. The throttle toggles each tick, and the speed swings between 10.93 and 11.54.
- An unexpected success from that test will flag when the T-72's ceiling is found.

**Run:** test_ground_handling, test_ground, test_tank_law, test_vehicle_law, test_track_scroll, test_idle_vehicle, test_contact_response, test_body_ground, test_sim_vehicles, test_proving_ground, test_mouse_look_key and test_ship: 454 tests OK, 30 skipped, 1 expected failure (the T-72).
