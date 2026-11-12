# air-sea

## Summary

- MATCH: 27 groups (listed below)
- CODE-WRONG: 3 (F1 medium, F2 low, F3 low)
- LEDGER-WRONG: 1 (F3, the VERDICT.md doc claim the code follows)
- DELIBERATE: 3 (F4, F5, F6)
- INCONCLUSIVE: 1 (F7)
- SETTLED / RE-WRONG: 0

Depth went to aircraft.js, vectored-engines.js, aircraft-ground-law.js, body-float.js, ship-law.js,
ship.js, ship-spec.js, plus sonar.js. Each was checked on our own binaries (client BF1942.exe and lnxded.static).
The dogfight-* files cite only ledger ids (AI-60, GUN-2, GUN-13, PHY-30, TRC-1) and the gravity and
ceiling constants. I checked those as names and constants, not as laws.
Not reached: the submarine-hud.js SUB-1..SUB-4 Mac-client addresses (`0x0046207c`, `0x004607cc`,
which are Mac-dump addresses, not ours), the deep TANK-18..TANK-23 spring/collision arithmetic (owned
by the ground bucket; I confirmed only its constants here), and the bf1918 "armoured train" engine path.

## Findings (non-MATCH), most severe first

### F1 [CODE-WRONG] [medium] Unauthored Engine defaults: noPropellerEffectAtSpeed 70/120 and differential 1, where retail has 100 and 10 (and torque 0, where retail has 60)
- Code:
  - `tools/bf1942-models/viewer/aircraft.js:823`: `differential: part.differential ?? 1,`
  - `tools/bf1942-models/viewer/aircraft.js:825`: `noPropellerEffectAtSpeed: part.noPropellerEffectAtSpeed ?? 70,`
  - `tools/bf1942-models/viewer/aircraft.js:824`: `torque: part.torque,` (undefined, which `VectoredEngine` turns into 0)
  - `tools/bf1942-models/viewer/vectored-engines.js:281`: `currentRatio(spec.differential ?? 1)`; `:283` `this.torque = spec.torque ?? 0;` (`:284` `|| 100` is right but never sees an undefined, because aircraftSpec already filled in 70)
  - `tools/bf1942-models/viewer/ship-spec.js:196`: `differential: part.differential ?? 1,`; `:203` `noPropellerEffectAtSpeed: part.noPropellerEffectAtSpeed ?? 120,` (ship-spec's torque default of 60 is right, `DEFAULT_TORQUE`)
- Ledger: the TANK row at ledger.md:1132/1136 already says `+0x520` noPropellerEffectAtSpeed has a "ctor default 100.0 at `0x0823f06e`", and gives `+0x364` differential and `+0x368` torque. tank-driving.md:348 and ship-spec.js's own header say "differential = 10.0, torque = 60.0". The ledger is right, and the code has drifted from it.
- Third-party: not needed. The ledger and our binary agree.
- Our binary:
  - lnxded `EngineTemplate::EngineTemplate` `0x0823f230`: `movl $0x1,0x360` (numberOfGears), `movl $0x41200000,0x364` (10.0), `movl $0x42700000,0x368` (60.0), `movl $0x42c80000,0x520` (100.0).
  - `makeScript` `0x0823f580` prints `setDifferential` then `flds 0x364`, `setTorque` then `flds 0x368`, and `setNoPropellerEffectAtSpeed` then `flds 0x520`.
  - The client matches. `0x005715d0` writes `+0x414` = 0x41200000 and `+0x418` = 0x42700000 at `0x571656`/`0x571660`, and `+0x5d0` = 0x42c80000 at `0x5716cf`. `getCurrentRatio` `0x57bd90` reads `fmuls 0x8fdfa8` (3.5) times `+0x414`. The thrust law `0x57c148` reads `fdivs 0x5d0(%eax)`.
- Verdict reasoning: these are engine defaults for omitted properties. A census of the vanilla, XPack1, XPack2 and bf1918 `.con` dumps found:
  - every vanilla, XPack1 and XPack2 c_ETPlane/c_ETShip engine authors all three properties, so nothing in vanilla changes today;
  - 12 bf1918 c_ETPlane engines omit `setNoPropellerEffectAtSpeed`: every `ZeppelinL30Engine*`, `LebaudyEngineForward`/`UpDown`, and `ArmouredTrain_Locomotive_EnginePower`. On the aircraft path they fade thrust at 70 m/s where retail fades at 100.
  - Mods outside the dump (DC, FH, FHSW, EoD) were not counted.
- Fix:
  - aircraft.js:823 should be `?? 10`, :824 `?? 60`, :825 `?? 100`.
  - vectored-engines.js:281 should be `?? 10` and :283 `?? 60`.
  - ship-spec.js:196 should be `?? 10` and :203 `?? 100`.

### F2 [CODE-WRONG] [low] Box-drag face area is pi/4; retail uses 3.14*0.25 (0.785)
- Code: `tools/bf1942-models/viewer/aircraft.js:146` `const BOX_AREA = Math.PI / 4;` (used :1383 in `applyBoxDrag`, the law every `aircraftSpec` airframe flies); `tools/bf1942-models/viewer/ship.js:142` `const BOX_AREA = Math.PI / 4;` (used :999). Outside the bucket the same constant is at `ground-contact.js:530`, `amphibious.js:121` and `world-vehicle-tick.js:87`. `ship-law.js:85` (`3.14 * 0.25`) and `projectile-flight.js:49` are right.
- Ledger: SHIPLAW-3 says "the face areas are `3.14 * 0.25` times the box's faces, not pi/4". PHY-4 (box law) gives no constant. The code has drifted from SHIPLAW-3.
- Third-party: not needed.
- Our binary:
  - lnxded `PhysicsNode::updatePhysics` `0x082545b8` `flds 0x86d1384` (3.140000104904175) and `0x082545c8` `flds 0x86c08ac` (0.25) form the areas handed to `updatePositionalDragAdvanced` `0x08252f50`. That function carries no constant of its own.
  - In the client the same block uses `fmuls 0x8f733c` = 0.7850000262260437, alongside `fmuls 0x8f7210` = 25.0.
- Verdict reasoning: a 0.05% stronger drag on every aircraft and on the page's ship path. The top speed moves by about 0.025%.
- Fix: `const BOX_AREA = 3.14 * 0.25;` in aircraft.js:146 and ship.js:142 (and the three outside the bucket).

### F3 [RETRACTED, then CODE-WRONG the other way] [low] I decoded 0xC16BAE14 as -14.7295379; it is -14.73f. The aircraft code was the outlier (see "F3 retraction" at the end)
- Code:
  - `tools/bf1942-models/viewer/body-float.js:60` `export const GRAVITY = -14.73;`, with `:66` `LIFT_NORMALISER = 1.5` and the header (`:29`) "`g / -9.82` is exactly 1.5, not 1.49995".
  - `tools/bf1942-models/viewer/ship-law.js:57-59` takes `G` from it ("1.5 exactly") for the rudder `WING_SCALE` and seeds the root's accumulator with it (`:184`, `:376`).
  - aircraft.js:103 (`GRAVITY = 14.7295379`), aircraft-ground-law.js:55/111 and dogfight-flight.js:53 are right. The ship and aircraft laws therefore run on two different g's.
- Ledger: `features/bf1942-ships-research-2026-09-22/VERDICT.md:276` §2.7 says "`g / -9.82` is **exactly 1.5**, not 1.49995 ... -14.73 comes from configuration". It is contradicted by aircraft.js's own comment and by the binary. The ledger rows FA-23 and IMP-7 also quote "-14.73" loosely.
- Third-party: not needed.
- Our binary: lnxded `BasicPhysicsSystem::BasicPhysicsSystem` `0x08251e20`, `0x08251e3b: movl $0xc16bae14, 0x8(%edx)`, and `getGravity` `0x08251ec0` reads that field. The client `0x00578f11: movl $0xc16bae14, 0x8(%eax)`. 0xC16BAE14 = -14.7295379, so g/-9.82 = 1.49995. No map load writes the field (aircraft.js:89-97's xref survey).
- Verdict reasoning: the buoyancy normaliser is 1.49995 and gravity is -14.72954. The effect is 3e-5 relative, nowhere near what a player could notice. The doc statement is still false, and the two ship and aircraft laws disagree on g.
- Fix:
  - body-float.js:60 should be `GRAVITY = -14.7295379` and :66 `LIFT_NORMALISER = GRAVITY / BUOYANCY_DIVISOR` (1.49995). `EQUILIBRIUM_SUM` stays at 9.82, because `|g|/(g/-9.82)` is 9.82 either way.
  - Reword the :29 bullet and ship-law.js:57.
  - VERDICT.md §2.7 should say "1.49995: the field is seeded with 0xC16BAE14 by the ctor (`0x08251e3b`)".

### F4 [DELIBERATE] [low] The CORSAIR fallback table keeps a fitted `-drag*v`
- Code: aircraft.js:1349-1361, 1374 ("`CORSAIR` keeps the fitted `-drag v`, because every flight test is calibrated on it"). Every `aircraftSpec` airframe (`dragLaw: 'box'`, :506, :964) runs the retail box law.
- Documented in code and in ledger AI-75. Keep it.

### F5 [DELIBERATE] [low] The sonar sweep is pinned to 60 updates/s
- Code: sonar.js:22-28. Retail steps `BfMap::update` once per frame with no dt, so its sweep speed follows the frame rate. The viewer documents 60 as its own choice. Keep it.
- The constants it rests on match: `setSonarRotationSpeed` `0x006acd80` writes `+0x110` = speed and `+0x114` = speed / `0x91de38` (3.14159274), and the tint is 0x3f400000 at `0x0046d578`/`0x0046d5a7`/`0x0046d5b3`.

### F6 [DELIBERATE] [low] Helicopters keep the page's ground handling
- Code: aircraft-ground-law.js:31-32 ("A helicopter (`vectored`) keeps the page's own handling"); aircraft.js `GROUND_LEVEL_TAU` (:191) is the page's levelling. Retail runs the same spring law for every Spring part (AIRGND-1).
- This is a documented scope gap, not a retail value. Note it so nobody counts it as parity.

### F7 [INCONCLUSIVE] [low] Can `Armor::status` send 0x15 without first sending 0x14? (body-float.js:412 "UNVERIFIED")
- Code: body-float.js:410-414. A ship arms its sink rate only on TemplateMessage 0x14 (`FloatingBundle::handleMessage` `0x082402b0`: `cmpl $0x14`, rate stored `0x08240557 fstps 0xb0(%edi)`). If 0x15 can come without a 0x14, a ship destroyed in one blow never sinks.
- Our binary: lnxded `Armor::status` `0x081739e0` sends 0x14 at `0x08173ad6` and 0x15 at `0x08173d62`, on separate branches. Whether one call with hp falling from above the critical level to <= 0 passes the 0x14 branch first was not traced.
- What would settle it: walk the branch at `0x08173a06` (the argument against `0x86c0b90`) and `0x08173a3c` (hp `+0x38` against `+0xf0`), which belongs to the damage bucket, or a lab one-shot kill of a Higgins boat while watching its floaters' `+0xb0`.

## MATCH list

- `calculateLift` client `0x0057fa90`:
  - `0.75` (`0x8d1e28`), `0.25` (`0x8feb38` d), `45.0` (`0x8feb50` d / `0x8feb48` f), `1/506.25` (`0x8feb40` d = 0.0019753), `0.0025` (`0x8feb30`), rad->deg global `0x9a2130` = 180/pi (initialiser `0x855570`), clamp +-1, `len == 0` gives 0.
  - Checked against aircraft.js:229-237 `calculateLift`, its users ship-law.js and amphibious.js, and AI-60's surface law.
- `PhysicsWing::updatePhysics` client `0x0057fbf0`: `-0.101833` (`0x8fe898`), `+-200` (`0x8feb58`/`0x8feb5c`), `10.0` submerged (`0x8dbe18`). Checked against aircraft.js `GRAVITY_NORMALISER`, `SURFACE_LIFT_CLAMP`, `SUBMERGED_MEDIUM` and ship-law.js `WATER_MEDIUM`/`LIFT_CLAMP`.
- The regulator branch, lnxded `0x0824f08d` to `0x0824f1dc`:
  - gated on `WingTemplate+0x1c8`, which only `setRegulateToLift` `0x08251ba0` sets (with `+0x1cc`);
  - `(lift + calculateNeutralLift(refFlow, -pitchOffset) * ratio[+0x1d0] + regulateToLift) * -g / -9.82`, clamped to -1..1, into `+0x144`, which `Wing::handleUpdate` copies to its input `+0x120` the next tick;
  - checked against aircraft.js `regulate()` :1445-1458 and :872-876 (`regulateToLift ?? 0` is equivalent to the flag; `wingToRegulatorRatio ?? 1` matches ctor `0x1d0 = 1.0`).
- `WingTemplate` ctor lnxded `0x082514c0`: wingLift 1.0 (`+0x1b0`), flapLift 0.1 (`+0x1b4`), regulateToLift 4.91 (`+0x1cc` = 0x409d1eb8), ratio 1.0. Checked against aircraft.js:127-128 and :872-873 (AIRGND-6).
- `Wing::handleUpdate` lnxded `0x08250950`: `rotateXDeg(flapLift*angle/(flapLift+wingLift) - pitchOffset)`, and only the pitch axis (index 1) is stepped. Checked against aircraft.js `Surface.flapShare` and `orient`.
- `BasicPhysicsSystem` ctor client `0x00578f00` / lnxded `0x08251e20`: g = 0xC16BAE14 and airDensityZeroAtHeight 1000 (`+0x30`). Checked against aircraft.js:103/:112, dogfight-flight.js:53-55, ship-law.js:62 and aircraft-ground-law.js:55.
- `PhysicsEngine::updatePhysics` client `0x0057bfb0`: `rho = 1 - clamp(y/airZero)`, `e = revs[+0xa0] - rho*(v.fwd)/noProp[+0x5d0]`, `K = 0.1|revs| (0x8d1a78) + e|e|`, `F = fwd*K*getCurrentRatio`, then `feedbackLoop`. Checked against aircraft.js:1842-1855 and vectored-engines.js `thrust()`.
- `getCurrentRatio` `0x0057bd90`: `3.5*diff/lerp(curve, gear/gears*100)`. The curve control points (0x40600000, 0x400ccccd, 0x3fc00000, 0x3f8ccccd, 0x3f70a3d7 = 3.5/2.2/1.5/1.1/0.94) are written in `0x005715d0`. Checked against aircraft.js `GEAR_RATIO`/`ENGINE_RATIO_SCALE`.
- The ship water rule, lnxded `0x0824cc89`/`0x0824d047`/`0x0824d06d`: `&8` (ship) with the screw dry and `|revs| > 0.02` (`0x86d0cf0`) pins revs to 1.0; a plane engine under water has its revs zeroed (`0x0824cc92`); the wake is at `|revs| >= 0.05` (`0x86d0ce8`). Checked against ship-law.js:67-69, ship.js:492-497, aircraft.js:2182, :2220 and SHIPLAW-2.
- `LandingGearTemplate` ctor lnxded `0x08241a50`: 30/20/0.65/0.85 under setGearDownHeight/UpHeight/DownEngineInput/UpEngineInput. Checked against aircraft.js:801-802.
- `getGeometryInertia` lnxded `0x08253930`: 1/3 (`0x86d1390`). Checked against aircraft.js `boxInertia` 'geometry'.
- `PhysicsFloatingBundle::updatePhysics` lnxded `0x0824d640`, re-read whole:
  - `f = ((y-H) - water + sinkOffset[+0xac]) / H`, `t = clamp(angle[+0xa0] - f*H, 0, 1)` from the unclamped f (`fsts 0x0824d718`);
  - early return unless f < 0; `max(f,-1)`; `lift = (1-t)min[+0xa4] + t max[+0xa8]`; `-f*lift*g/-9.82`;
  - damping `((1-f)+25f)*100*DX*DZ*drag/mass * v_point.y`, vertical only;
  - a non-zero angle or sink rate wakes the parent first.
  - Checked against body-float.js `floatAcceleration`/`floatLift`/`submersion`. Callers pass the point velocity: ship.js:739, ship-law.js:320, aircraft.js:1312, amphibious.js:546.
- `FloatingBundle::handleMessage` lnxded `0x082402b0`: `q = clamp((2R + dz + dx)/(4R))` (`0x86c0304` = 4.0), `rate = (q + 0.1)(0x86b1ca0) * 0.05(0x86c08a8) * sinkingSpeedMod[+0x1c4]`. Checked against body-float.js `sinkRate`.
- The submerged drag scale `1 + 24 min(depth/DY,1)` (`0x082545fb` 25.0): ship-law.js and ship.js:138 (SHIPLAW-3).
- PhysicsNode sleep constants (`0x86d13a0` 2.5, `0x86c08ac` 0.25) in `0x082543d0`: aircraft-ground-law.js and ship-law.js (TANK-21; the limits 1000/62500/40000 were not re-read).
- `addFriction` lnxded `0x0825b6e0`: 9.82 literal (`0x86d16e4`), 1.5, 2.25 and the 1.0000001e-6 latch. Checked against aircraft-ground-law.js `COULOMB_LO`/`LATCH_EPS` (PHY-2).
- `ObjectSpawner::handleFrameUpdate` lnxded `0x083138c0`: the 0.1 release (`0x86b1ca0`). Checked against held-craft.mjs:22 (SPAWN-23).
- `SonarObject::getSensedObjects` lnxded `0x08321e20`: the sonar's dy >= 0 and dy <= r, and the radar's dy <= 0 and dy^2 <= r^2. Checked against sonar.js `sensedObjects`, with the third-party `decompiled_functions_bf42linuxServer/getSensedObjects.c:104-128`.
- `setSonarRotationSpeed` client `0x006acd80` and the tint 0.75: sonar.js and map-sonar.js.
- Engine type bits (thrust branch `&1` at `0x0824cc16`): ship-spec.js:185.
- Name-only or ledger-id citations, consistent with their rows: dogfight-* (AI-60, GUN-2, GUN-13, PHY-30, TRC-1), crew-instruments.js, spawned-craft.js (SPAWN-9/24/30, AI-121, FHR-10, COL-25), submarine-hud.js (SUB-1..4, PHY-3 crush address `0x08318da0`), and ship-spec.js (COL-14/15, `0x083b4e40`, `0x083a6200`).

## Outside my bucket

- Box-drag area pi/4 where retail uses 3.14*0.25 (F2):
  - `tools/bf1942-models/viewer/amphibious.js:121` `const BOX_AREA = Math.PI / 4;`
  - `tools/bf1942-models/viewer/world-vehicle-tick.js:87` `const area = (Math.PI / 4) * k.size[0] * k.size[2];`
  - `tools/bf1942-models/viewer/ground-contact.js:533`: already fixed by the soldier-physics verifier (`Math.fround(Math.fround(3.14) * 0.25)`).
- Gravity -14.73 where retail uses -14.7295379 (F3 class, found while fixing):
  - `tools/bf1942-models/viewer/rigid-body.js:45` `export const GRAVITY = -14.73;`. This is the integrator `FloatingHull` (body-float.js) steps, so with body-float now on the seed the free-floating hull's buoyancy (-14.7295) and its integrator's gravity (-14.73) disagree. Two body-float tests fail on it (see Fixes applied, F3).
    - Fix: `export const GRAVITY = -14.7295379;` in rigid-body.js. Better, make rigid-body.js the one home (it imports nothing) and have body-float.js re-export it, so there is one literal.
  - `tools/bf1942-models/viewer/point-body.js:17` `export const GRAVITY = -14.73;` (re-exported by `physics.js`, read by `projectile-flight.js`).
  - `tools/bf1942-models/viewer/aircraft-ground-law.js:55,111` and `dogfight-flight.js:53` carry the right value but as their own literals, not the shared constant.

## Fixes applied

### F1 (engine defaults)
- `viewer/ship-spec.js:12-25`: one shared definition, `DEFAULT_DIFFERENTIAL = 10`, `DEFAULT_TORQUE = 60` and `DEFAULT_NO_PROPELLER_EFFECT_AT_SPEED = 100`, with lnxded `0x0823f230`, client `0x005715d0` and `makeScript` `0x0823f580`. `:208` differential and `:215` fade now read them. The fade was 1 and 120.
- `viewer/aircraft.js:8-10` imports them. `:829-831` (aircraftSpec engines): differential, torque and fade were 1, undefined and 70.
- `viewer/vectored-engines.js:47` imports them. `:282-287`: ratio, torque and fade defaults were 1, 0 and `|| 100`.
- New test: `tests/test_engine_defaults.py` and `tests/engine_defaults_harness.mjs`. It builds an engine with only its type through `aircraftSpec`, `shipSpec` and `VectoredEngine`. 3/3 OK.
- No vanilla or expansion test moved: every one of those engines authors all three words, and the wider run is below.

### F2 (box area)
- `viewer/ship.js:142`: `BOX_AREA = 3.14 * 0.25`, citing `0x082545b8`, the client's 0.785 and SHIPLAW-3. The ship tests are OK.
- `viewer/aircraft.js:150`: STOPPED and left at `Math.PI / 4`.
  - With 3.14*0.25 in place, 39 dogfight-school and jet-lesson tests failed: `test_dogfight_school` and every `test_dogfight_jet_*` module. Those tests pin exact outcomes of the flown demos (`test_nobody_goes_over_the_roof`: 780 != 765 m top; hits; who is shot down). A 0.05% drag change moves them.
  - The control: with only this line reverted, `test_dogfight_jet_turnarounds` passes 23/23.
  - The retail value is still 0.785 (finding stands). Applying it means re-baselining the dogfight lessons' expected outcomes, which is the dogfight-school owner's call, not a parity fix I can make alone.

### F3 (gravity)
- `viewer/body-float.js:60-76`:
  - `GRAVITY = -14.7295379`, citing the 0xC16BAE14 seed at lnxded `0x08251e3b` and client `0x00578f11`;
  - `LIFT_NORMALISER = GRAVITY / BUOYANCY_DIVISOR` (1.49995);
  - `EQUILIBRIUM_SUM = -BUOYANCY_DIVISOR` (9.82, unchanged);
  - header bullets at `:29-36` reworded.
- `viewer/aircraft.js:96-103`: `GRAVITY = -SIGNED_GRAVITY`, imported from body-float.js. This is the shared constant. body-float.js is the home because aircraft.js already imports it, and the other way round would be an import cycle.
- `viewer/ship-law.js:57`: the comment only. It already reads body-float's `GRAVITY`.
- `features/bf1942-ships-research-2026-09-22/VERDICT.md` §1.3 equilibrium block (`:96-101`) and §2.7 bullet corrected in place.
- Tests that encoded the old value, now updated:
  - `tests/test_body_float.py`: the header, `GRAVITY`, and `test_the_lift_normaliser_is_exactly_three_halves`, renamed `..._is_the_seed_over_the_divisor`, which now expects 1.4999529.
  - The same file: the submarine-pair-centred test (`8 * mid = 9.82`), the Fletcher-node test (`8 * one = |g|`) and the damping-is-parents lift.
  - `tests/test_ship_law.py:64-68`: the rudder coefficient is `2 * 14.7295379 / 9.82` = 2.99991, not 3.
- STOPPED, partly. `test_body_float` still has 2 failures: `test_an_undamaged_hull_holds_its_draft_for_ever` and `test_a_hull_whose_floaters_are_all_mod_zero_never_sinks`, which give 20.224957 against 20.225.
  - Cause: `FloatingHull` integrates on `RigidBody`, whose `GRAVITY` is still -14.73 (`rigid-body.js:45`, outside my bucket). The hull settles 4.3e-5 m deep.
  - Fixing rigid-body.js:45 to the seed brings them back. I left it alone, as the rules require.

### Tests run
- After the aircraft.js F2 revert: `test_seats`, `test_dogfight_school`, `test_dogfight_jet_*` (8 modules besides turnarounds), `test_flight`, `test_room` and `test_world` ran 457 tests, OK (1 skipped). `test_dogfight_jet_turnarounds` ran 23/23 OK.
- Also run with F1+F3: `test_vehicle_respawn`, `test_tank_law`, `test_ship_underside`, `test_ship_dive`, `test_ship_held_axis`, `test_ground`, `test_bot_ai`, `test_body_ground`, `test_vehicle_bodies`, `test_con` and `test_effect_objects`. The only failures in that 882-test run were the 39 F2 dogfight ones (now reverted) and one `test_seats` turret-servo test that is another session's work in progress; it passed on the rerun.
- `python3 -m unittest tests.test_body_float tests.test_ship_law tests.test_ship tests.test_air_law`: 81 run, 2 failures (the two above). All else OK.
- `tests.test_engine_defaults`: 3/3 OK.

## Ledger edits

None to `ledger.md` itself.
- SHIPLAW-3 already carries the 3.14*0.25 area.
- The TANK row at ledger.md:1132/1136 already carries the 10/60/100 Engine defaults.
- VERDICT.md §2.7, a feature-folder doc, was corrected in place.
- Optional tidy, ledger FA-23 and IMP-7: where they quote "-14.73 m/s^2", read "-14.7295379 (0xC16BAE14, `BasicPhysicsSystem` ctor lnxded `0x08251e3b` / client `0x00578f11`)".

## Cross-cutting fixes (second go-ahead)

### Gravity: every engine-g literal is now the 0xC16BAE14 seed, -14.7295379
- One literal per import-free family, each citing lnxded `0x08251e3b` and client `0x00578f11`.
- Shared:
  - `rigid-body.js:47` declares it. `body-float.js` re-exports it, `aircraft.js` takes its magnitude from body-float, and `ship-law.js` reads body-float.
  - `ship-spec.js` imports it from rigid-body (`gravity: -ENGINE_GRAVITY`).
  - `point-body.js:19` declares it for `physics.js` and its importers. `tank-duel.js` now imports `GRAVITY` from `physics.js` (its `tank-ballistics.js` dependency already does).
- Literal with address, because these modules are import-free: `effects-core.js:27`, `bot-vehicle-air.js:716`, `tank-fights-detect.js:83`, `rocket-pack.js:280` (the default), `replay-accuracy.js:54`.
- `contact-response.js`: `CONTACT_GRAVITY` becomes 14.7295379. That value is the `getGravity()/30` tick, `0x0825b8b3`. The Coulomb budget, which hard-codes `1.5 * 9.82` (`0x86d16e4`, `0x86be4d0`) and never reads gravity, is now its own `COULOMB_BUDGET_ACCEL`. Before this change it shared the gravity option.
- Comments that quoted 14.73 as the engine's g, corrected (1.49995 where a ratio is quoted): `physics.js`, `test-hooks-soldier.js`, `tank-ballistics.js`, `suspension.js`, `tracked-vehicle.js`, `parachute.js`, `projectile-flight.js`, `torpedo-run.js` (x5), `bot-pilot.js`, `passing-rounds.js`, `body-world.js`, `tank-duel.js`, `tank-fights-detect.js`.
- Left alone on purpose:
  - `ground-contact.js:62,142` and `ground-specs.js:230`: these are the `1.5*9.82` Coulomb literal, which is right.
  - `local-player.js:402`: a measurement taken at -14.73.
- `server/` and `sim/` carry no 14.73.
- Tests updated because they encoded -14.73: `test_physics.py` (5 sites), `test_rigid_body.py` (2), `test_soldier.py`, `test_parachute.py`, `test_contact_response.py`, `test_effects.py`, `test_body_ground.py` (`GRAVITY`, `SPRING_K_COEFF`), and `throw_launch_harness.mjs` (`G`, the ballistic reference only; the lab-recorded grenade tracks still match).
- `tests/fixtures/make_rigid_body_golden.py`: `GRAVITY` changed, and `rigid_body_golden.json` regenerated (19 lines).
- The lab-measured laws did not move: `test_move_law` (PHY-34), `test_tank_law`, `test_air_law` and `test_ship_law` all pass.

### Box area 3.14*0.25
- `amphibious.js:121` is done. `ship.js:142` was done earlier.
- `aircraft.js:150` is HELD at pi/4 (STOPPED, item 3), and `world-vehicle-tick.js:87` is kept equal to it, since it bounds the aircraft law's own fall.
- Proof: with only `aircraft.js` reverted to pi/4, `test_dogfight_jet_turnarounds`, `test_dogfight_doctrine`, `test_dogfight_dfn_ol` and `test_dogfight_dfn_uh` all pass (56/56). The gravity change is not what moves the dogfights.

### Item 3: dogfight re-baseline NOT done. With 3.14*0.25, lessons change what they claim, beyond moved numbers
About 60 dogfight assertions fail across `test_dogfight_school`, `test_dogfight_doctrine`, `test_dogfight_dfn_*`, `test_dogfight_jet_*`, `test_dogfight_shape_*`, `test_dogfight_ascend` and `test_dogfight_live_wing`. Many are moved numbers: a 780 m top becomes 765, ranges move a few metres, kill times shift 0.6 s. A number of them are a lesson's declared verdict flipping, which is the lesson's content and not an outcome pin:
- `test_dogfight_doctrine.test_the_moves_scored_on_the_spitfire_are_the_counts_the_lessons_declare`: under-the-height/ninja is declared to work in 1 start and is measured to work in 2.
- `test_dogfight_dfn_uh.test_each_move_demo_says_what_was_flown`: the same ninja, declared 1 and measured 2.
- `test_dogfight_dfn_ol.test_each_verdict_is_what_the_nine_runs_give`: the flip is claimed to work in 1 and now works in 0.
- `test_dogfight_doctrine.test_the_pair_gets_a_shot_on_the_hunter`: "nobody hits you" no longer holds.
- `test_dogfight_dfn_sc.test_the_flip_out_slows_him_and_never_gets_behind_him`: 6 hits on you against at most 2.
- `test_dogfight_doctrine.test_the_falling_leaf_gets_away...`: 5 hits after the fall against at most 4.
- `test_dogfight_jet_the_circle.test_the_mig29_is_no_different_and_turning_back_is_worse`: the one hit that makes "worse" is gone.
- `test_dogfight_jet_break_turn.test_as_written_the_attacker_flies_through_a_slow_target`: 2 shot down where the lesson says 1.
- `test_dogfight_dfn_uh.test_the_flip_reverses_onto_him_but_the_shot_comes_from_a_later_dive`: no first shot at all.

These are the school's own law (features/dogfight-school: INVENTION pilots on the engine's airframe), not lab measurements. Re-baselining them means rewriting the lessons' captions and verdicts, which is the dogfight-school owner's call. aircraft.js stays at pi/4 until they take it. The full failure list is in the log `<scratch>/tools/dogfails.txt`.

### Item 4: whole suite (`python3 -m unittest discover -s tools/bf1942-models/tests`, the verify.sh form; `-s tests -t .` does not import because tests/ has no `__init__.py`)
The first run had every change in place, including aircraft 3.14*0.25: 9125 tests, 98 failures, 9 errors. Judgements:
- **Mine, and fixed:** the gravity-constant asserts listed above, and the rigid-body golden.
- **Mine, and held:** the dogfight family (aircraft BOX_AREA), see item 3.
- **Not mine, environment:** `test_verify_mutations` (7: `viewer/models/{Bar1918,Sherman,BritishSoldier}.glb` are not on disk), `test_level_art` (5: loading pictures and menu chrome missing from the trees), `test_parachute_assets` (no Parachute template in the local tree).
- **Not mine, another session or verifier:**
  - `test_font` (3, the HUD font's header and glyph count).
  - `test_ledger_index` (ledger.md changed, the index not regenerated: the coordinator's ledger edits).
  - `test_knockback_seams.test_two_blasts_in_one_tick_add` (17.15 vs 20.58). It passes on the HEAD export, still fails with my gravity files reverted (point-body and contact-response each tried), and `soldier.js` carries another verifier's uncommitted edits.
  - `test_ground_handling.test_a_bot_tank_cruises_at_retails_speed`: the M1A1 holds 13.32 where the lab floor is 13.5. It passes on HEAD and still fails with all my gravity literals, the contact budget and every box area reverted. Something else in the tree moves it.

## F3 retraction (2026-11-12)

F3 was backwards. I took aircraft.js's "0xC16BAE14 = -14.7295379" without decoding the word myself. It decodes to -14.729999542 (`struct.unpack('<f', bytes.fromhex('14ae6bc1'))`, and readmem `hexf` gives the same), the float32 of -14.73. So g/-9.82 = 1.5 to float precision, VERDICT.md §2.7 was right, and every -14.73 literal was right. The outliers were `aircraft.js` and `dogfight-flight.js` (and `aircraft-ground-law.js`, `proving-ground-page.js`, `tests/test_flight.py`, `tests/round_attitude_harness.mjs` and `tests/dogfight_eyes.mjs`), which carried 14.7295379.

Origin of 14.7295379: commit `7daf0ae33` (2026-09-15, "fix(flight): gravity is -14.73, and the lift calibration that follows"), `features/flyable-vehicles/flight-model.md`, "single **-14.7295379**". The same commit's title says -14.73, so the extra digits were a mis-decode of the hex word in that doc. It reached `flight.js` in `f09e32f14` and then `aircraft.js` in `6fe9fe58b`.

What was done:
- Every gravity edit of the cross-cutting round was reverted by exact inverse replacement, because several of those files carry other sessions' edits.
  - Value files: `point-body.js`, `effects-core.js`, `contact-response.js` (both the value and the Coulomb-budget split), `ship-spec.js`, `tank-duel.js`, `bot-vehicle-air.js`, `tank-fights-detect.js`, `rocket-pack.js`, `replay-accuracy.js`.
  - Comment-only files: `physics.js`, `test-hooks-soldier.js`, `tank-ballistics.js`, `suspension.js`, `tracked-vehicle.js`, `parachute.js`, `projectile-flight.js`, `torpedo-run.js`, `bot-pilot.js`, `passing-rounds.js`, `body-world.js`.
  - Every test of that round, including `fixtures/make_rigid_body_golden.py`. The regenerated golden json is byte-identical to HEAD again.
- The single shared value is `rigid-body.js` `GRAVITY = -14.73`, commented "0xC16BAE14 = -14.73f".
  - `body-float.js` re-exports it, with `LIFT_NORMALISER = GRAVITY / BUOYANCY_DIVISOR` (= 1.5) and its comments restored to 1.5.
  - `aircraft.js` takes its magnitude from body-float (`GRAVITY = -SIGNED_GRAVITY` = 14.73), with a note on the mis-decode and the normaliser comment fixed to x1.5.
  - `aircraft-ground-law.js` now imports `GRAVITY` from rigid-body.js for `SPRING_SCALE` and the accumulator seed.
  - `ship-law.js`: comment.
- Set to 14.73 with the "-14.73f" comment: `dogfight-flight.js` `G`, `proving-ground-page.js:1775`, `tests/test_flight.py` `G`, `tests/round_attitude_harness.mjs`, `tests/dogfight_eyes.mjs`.
- `test_body_float.py` and `test_ship_law.py` are back to their 1.5 / 3.0 expectations.
- VERDICT.md §2.7 is restored to "exactly 1.5", with the float reading (-14.7299995 / -9.8199997 = 1.5000000) and a line naming the mis-decode. The §1.3 block is restored.
- Box area 3.14*0.25 is kept and now applied everywhere, `aircraft.js:150` and `world-vehicle-tick.js:87` included.

### STOPPED: a lab-measured law moved past its tolerance
`test_air_law.LiftoffTouchdownTests.test_under_the_pages_own_correction_a_round_trip_late` (fixture `air_law_bf109_alamein.json.gz`, at `@liftoff`) fails: horizontal median 1.19 mm against the 1.0 mm bound (p90 2.36, max 2.36, n 8).
- It passes on HEAD.
- With only the aircraft box area put back to pi/4 it still fails.
- With only `aircraft-ground-law.js`'s two literals put back to 14.7295379 it still fails.
- So it is `aircraft.js`'s g, 14.7295379 -> 14.73, in the flight law: the wing coefficients and the root's gravity.

This is the AIRGND-9 lift-off, the scenario that law already flags as sensitive. The other 11 air-law tests pass, as do the move law (PHY-34), the tank law, the ship law and vehicle respawn. Not re-baselined, per the instruction. The value is the binary's. The 0.2 mm disagreement says the lab-fit page and the server part ways somewhere else in the lift-off, which the wrong g happened to offset.

## Ledger edits (replaces the optional tidy above, which must NOT be applied)
- IMP-7 (ledger.md:476): replace "scales -14.7295379 m/s^2 (0xC16BAE14, `BasicPhysicsSystem` ctor lnxded `0x08251e3b` / client `0x00578f11`; written -14.73 until 2026-11-12)" with "scales -14.73 m/s^2 (0xC16BAE14 = -14.73f, `BasicPhysicsSystem` ctor lnxded `0x08251e3b` / client `0x00578f11`)".
- `subsystems/physics.md:255-257` already says x1.5 / 1.49999995, and the FA-23, AIRGND-1 and SHIP-1 rows already carry the withdrawal. No change needed.

### Dogfight re-baseline (item 2 of the revert order): NOT done, lessons break
- With aircraft g = 14.73 and box area 0.785, all 25 dogfight test modules ran: 477 tests, 74 failures, 2 errors. Each change alone moves them: the box area alone moved 39 earlier, and the gravity alone moves `test_air_law`.
- Before touching any pin I sorted the 76 failures (list: `<scratch>/tools/dogfails2.txt`):
  - **Moved numbers only**, which could be re-pinned: about 40. Examples: jet turnarounds top 780 -> 765, MiG-29 roof 818 -> 812, boom-and-zoom perch range 587 -> 589, ranges and kill times moved a few metres or tenths of a second, endRange 1413 against a 1410 bound.
  - **The lesson's own criterion breaks**, which must not be re-pinned (about 30):
    - `test_dogfight_live_wing.test_nobody_flies_into_the_ground` (kursk-bf109, turn): 2 aircraft now fly into the ground.
    - `test_dogfight_arena_hunter.test_drag_and_bag_never_gets_you_shot_down_on_every_arena`: on Kursk (all three packs) the pair no longer gets a shot on the hunter (`onHunter` 0).
    - `test_dogfight_doctrine.test_the_pair_gets_a_shot_on_the_hunter`, and `test_the_falling_leaf_gets_away...` (5 hits after the fall against at most 4).
    - Declared verdicts no longer matching the flown ones:
      - `test_dogfight_doctrine.test_the_moves_scored_on_the_spitfire_are_the_counts_the_lessons_declare`: under-the-height/ninja, declared 1, measured 2.
      - `test_dogfight_dfn_uh.test_each_move_demo_says_what_was_flown`: same ninja, 1 against 2.
      - `test_dogfight_dfn_ol.test_each_verdict_is_what_the_nine_runs_give`: the flip, claimed 1, measured 0.
      - `test_dogfight_ascend` totals: 39 against 40.
    - `test_dogfight_school.test_the_counters_take_his_kill_shots_away` and `test_out_of_the_lock_turning_and_chopping_beats_flying_straight`: 4 against at most 1.
    - `test_dogfight_shape_tail.test_under_the_eyes_the_chop...`: 4 against at most 1.
    - `test_dogfight_shape_break.test_the_break_takes_his_shot_no_hit_after_its_first_two_seconds`: a hit now lands.
    - `test_dogfight_school.test_a_shot_that_would_land_always_reads_as_going_for_it` (break-turn/flip).
    - `test_dogfight_dfn_sc.test_the_flip_out_slows_him_and_never_gets_behind_him`: 3 hits on you against at most 2.
    - `test_dogfight_dfn_uh.test_the_flip_reverses_onto_him_but_the_shot_comes_from_a_later_dive`: no shot at all.
    - `test_dogfight_jet_the_circle.test_the_mig29_is_no_different_and_turning_back_is_worse`: the one hit that makes "worse" is gone.
    - `test_dogfight_jet_break_turn.test_as_written_the_attacker_flies_through_a_slow_target`: 2 shot down against 1.
    - `test_dogfight_jet_scissors.test_it_is_nobodys_kill`: a run now scores a hit.
- These are the school's own pilots (INVENTION), not lab data. But the lessons' captions, declared counts and safety claims are wrong at the corrected g and area, so the school needs its pilots retuned or its texts rewritten. That is the dogfight-school owner's job.
- Re-pinning only the moved numbers would leave the modules failing on the same tests, so I re-pinned none.
- Code is left at the binary's values (aircraft g 14.73, area 0.785). The coordinator decides between landing it with the dogfight suite red and holding `aircraft.js`'s two values until the school is retuned.

### Whole suite after the revert (`python3 -m unittest discover -s tools/bf1942-models/tests`)
9126 tests: 86 failures, 9 errors, 158 skipped.
- **This change** (aircraft g 14.73 plus area 0.785):
  - the 76 dogfight failures and errors above, held for the school's owner;
  - `test_air_law` 1 (the Bf109 lift-off, 1.19 mm against 1.0, STOPPED).
- **Environment**, assets not on disk: `test_verify_mutations` (7 errors, glbs), `test_level_art` (5), `test_parachute_assets` (1).
- **Other sessions or verifiers.** All three pass on the HEAD export and stay failing with my files bisected out.
  - `test_font` (3).
  - `test_knockback_seams` (1). `soldier.js` carries foreign edits.
  - `test_ground_handling` bot M1A1 cruise (1).
- `test_ledger_index` now passes.

## Held

The flight law alone stays on its old pair until the dogfight school is retuned. Everything else runs retail: the shared `rigid-body.js` g of -14.73 and the 0.785 box area.

### What is held (exact)
| Where | Held value | Retail value | Evidence |
|---|---|---|---|
| `tools/bf1942-models/viewer/aircraft.js` `FLIGHT_GRAVITY` (and the exported `GRAVITY = -FLIGHT_GRAVITY`, which drives the wing `coeff`, `CORSAIR.gravity`, `aircraftSpec().gravity` and the regulators) | -14.7295379 | 0xC16BAE14 = -14.73f | lnxded `0x08251e3b` `movl $0xc16bae14,0x8(%edx)`; client `0x00578f11`; `struct.unpack('<f', bytes.fromhex('14ae6bc1'))` = -14.7299995. The mis-decode dates from commit `7daf0ae33` |
| `aircraft.js` `BOX_AREA` (`applyBoxDrag`, every `aircraftSpec` airframe) | `Math.PI / 4` | `3.14 * 0.25` = 0.785f | lnxded `PhysicsNode::updatePhysics` `0x082545b8` / `0x082545c8` (3.14, 0.25); client `fmuls 0x8f733c` = 0.785; SHIPLAW-3 |
| `viewer/dogfight-flight.js` `G` (the school's pilots plan on it) | 14.7295379 | 14.73 | follows `FLIGHT_GRAVITY` |
| `viewer/world-vehicle-tick.js:87` `fallSinkFloor` area (bounds the aircraft law's own fall) | pi/4 | 0.785 | follows `aircraft.js` `BOX_AREA` |
| Tests that mirror the held flight law, at their HEAD values: `tests/test_flight.py` `G`, `tests/round_attitude_harness.mjs` (`roundWingsOf(NORDEN, 14.7295379)`), `tests/dogfight_eyes.mjs` | 14.7295379 | 14.73 | move them with the flight law |

Also held, against the first instruction: `aircraft-ground-law.js` `GRAVITY` (`SPRING_SCALE`, the accumulator seed) = -14.7295379, a local literal because `aircraft.js` imports that module. That law is the fixed-wing root's one Euler step in the air as well as on the wheels (AIRGND-1). With it alone on -14.73 (the flight law held), 3 tests fail:
- `test_air_law` Bf109 lift-off, past 1.0 mm;
- `test_dogfight_live_wing.test_nobody_flies_into_the_ground` (kursk-stuka, turn), a Stuka into the ground;
- `test_dogfight_jet_turnarounds.test_the_dip_works_in_all_nine`.

Putting the ground law back on 14.7295379 turns all three green.

Not held, on -14.73: the ship law and floats, the rigid and point bodies, and the effects. The box area 0.785 is applied in `ship.js`, `amphibious.js` and `ship-law.js`. `proving-ground-page.js:1775` is 14.73.

### What breaks at the retail pair (the retune's starting list)
Measured 2026-11-12 with `aircraft.js` at -14.73 and 0.785: 25 dogfight modules, 477 tests, 74 failures and 2 errors. Full assertion dump: `<scratch>/tools/dogfails2.txt`. Either value alone moves them: the area alone moved 39 tests with g unchanged, and g alone moves `test_air_law`.

**Lab-measured, retail-facing (must hold by fixing the law, not the bound):**
- `test_air_law.LiftoffTouchdownTests.test_under_the_pages_own_correction_a_round_trip_late`, fixture `air_law_bf109_alamein.json.gz` at `@liftoff`: horizontal median 1.19 mm against at most 1.0 mm (p90 2.36, max 2.36, n 8).
  - Caused by the flight-law g alone: the box area reverted alone and the ground-law literals reverted alone each still fail.
  - The AIRGND-9 lift-off. The wrong g was offsetting some other lift-off difference.

**Lessons that break their own claims** (the captions, declared counts or safety claims are wrong at retail):
- `test_dogfight_live_wing.test_nobody_flies_into_the_ground` (kursk-bf109, hands=turn): `[]` became `[2, 2]`, two aircraft into the ground.
- `test_dogfight_arena_hunter.test_drag_and_bag_never_gets_you_shot_down_on_every_arena`, Kursk on bf1942, xpack1 and xpack2: `onHunter` 0, so the pair never gets a shot on the hunter.
- `test_dogfight_doctrine.test_the_pair_gets_a_shot_on_the_hunter`: the bag no longer delivers.
- `test_dogfight_doctrine.test_the_falling_leaf_gets_away_from_the_pilot_who_takes_it_for_a_kill`: 5 hits after the fall against at most 4.
- `test_dogfight_doctrine.test_the_moves_scored_on_the_spitfire_are_the_counts_the_lessons_declare`: under-the-height/ninja, declared 1, flown 2.
- `test_dogfight_dfn_uh.test_each_move_demo_says_what_was_flown`: ninja 1 against 2. `test_the_flip_reverses_onto_him_but_the_shot_comes_from_a_later_dive`: no shot at all (`firstShotPhase` None). `test_the_ninja_wins_the_height_but_holds_it_only_in_the_fight_shown`: circling 10.8 against at most 10.5.
- `test_dogfight_dfn_ol.test_each_verdict_is_what_the_nine_runs_give`: the flip, claimed 1, flown 0. `test_the_flip_lands_a_pass_across_his_beam...`: kills 4 against 3. `test_the_ninja_gets_one_pass_and_his_nose_follows_you_up`: endHigh out of 40..62.
- `test_dogfight_ascend.test_the_totals`: works 40 against 39. `test_each_row_flies_what_the_review_claims` (astern/otBreaker): six_lost 0 against 0.13. `test_how_long_the_first_shot_takes_from_a_perch` (astern/taAce): 7 against 6.
- `test_dogfight_school.test_the_counters_take_his_kill_shots_away`: 4 against at most 1.
- `test_dogfight_school.test_out_of_the_lock_turning_and_chopping_beats_flying_straight`: 4 against at most 1.
- `test_dogfight_school.test_following_him_up_gets_you_nothing_and_following_shallow_gets_you_the_hits`: 10.3, not over 11.
- `test_dogfight_school.test_a_shot_that_would_land_always_reads_as_going_for_it`: break-turn/flip reads 0.
- `test_dogfight_school.test_the_flat_scissors_braids_along_one_line`: dy 135 against at most 130.
- `test_dogfight_shape_tail.test_under_the_eyes_the_chop_no_longer_makes_him_fly_past`: 4 against at most 1.
- `test_dogfight_shape_vertical.test_the_words_numbers_hold`: 10.3, not over 11.
- `test_dogfight_shape_break.test_the_break_takes_his_shot_no_hit_after_its_first_two_seconds`: a hit lands (0 against 1). `test_the_rushing_attacker_comes_past_his_tail_and_he_reverses`: 2.8 against at most 2.5, plus 2 errors in the generator.
- `test_dogfight_dfn_sc.test_the_flip_out_slows_him_and_never_gets_behind_him`: 3 hits on you against at most 2. `test_the_ninja_is_over_him_at_4_s_and_under_him_by_8`: the one run with hits on you now has none.
- `test_dogfight_dfn_ot.test_the_yo_yo_never_gets_the_shot...`: sixLost 1.17 against under 1. `test_the_dip_gets_clear_in_six_and_is_caught_from_further_back`: chaseMin out of 110..117.
- `test_dogfight_dfn_uo.test_the_flip_from_following_him_up_never_works`: 4 runs hit against 3.
- `test_dogfight_dfn_ci.test_coming_back_they_see_you_and_meet_you`: a meet falls outside 38..53. `test_going_straight_up_they_follow_and_it_is_the_circle_again`: hits [1, 2, 8] against [6, 8].
- `test_dogfight_dfn_bt.test_the_flip_shoots_at_him_but_never_from_behind_in_time`: 5 against 6. `test_the_dip_is_never_hit_and_he_gives_up`: endRange 1343 against at least 1400.
- `test_dogfight_jet_break_turn.test_as_written_the_attacker_flies_through_a_slow_target`: 2 shot down against 1.
- `test_dogfight_jet_the_circle.test_the_mig29_is_no_different_and_turning_back_is_worse`: the single hit that makes "worse" is gone. `test_nobody_is_hit_except_turning_back`: hits [13, 14, 17] against [10, 13, 17].
- `test_dogfight_jet_scissors.test_it_is_nobodys_kill`: run 3 now hits. `test_the_slower_one_gets_the_only_shots`: 4 against 3. `test_the_paths_braid_along_one_line`: maxRange 271.9 against at most 265. `test_the_dip_is_shot_down_from_every_start`: one run 13.9 s, outside 15..17. `test_the_flip_never_gets_behind_them`: 0.3 against at most 0.28. `test_as_written_full_throttle_throws_you_out_in_front`: 42.98 against at least 45.5. `test_both_are_on_the_brakes...`: 163.2 against at most 160.
- `test_dogfight_jet_under_the_height`: `test_three_or_four_dives_and_shots_in_three` (one more hit run), `test_the_dip_gets_clear_every_time`, `test_the_ninja_never_wins_the_energy`, `test_the_energy_for_a_moment_then_them_behind_you` (72, 25.7), `test_the_three_demos` (-28 against -31).
- `test_dogfight_jet_up_and_over`: `test_following_up_you_hang_and_are_shot_down` (5 against 4), `test_the_ninja_climbs_on_alone` ([1, 2] against [2, 3]), `test_the_moves` (3293, 6147), `test_they_come_round_and_hit_you_but_nobody_is_shot_down` ([2, 3, 5, 5] against [1, 4, 5, 5]).
- `test_dogfight_jet_on_his_tail.test_climbing_beside_their_break_gets_nothing_they_climb_too`: the one [2, 0] run is gone.
- `test_dogfight_jet_out_of_the_lock`: `test_turning_hard_nobody_is_hit...` (apart 673 against at most 672), `test_the_dip_never_gets_out` (minRange 42 against 43..45), `test_the_flip_and_the_ninja_never_get_on_top` (aceMinSpeed out of 60..67).

**Moved numbers only** (re-pin once the lessons hold):
- jet_turnarounds: top 780 -> 765; `let go at` 806 out of 755..801.
- jet_the_circle: MiG-29 roof 818 -> 812; out-and-back (5, 26) -> (3, 28); reversing (92, 146) -> (87, 147).
- jet_boom_and_zoom: perch (587, 621) -> (589, 621); dip (1736, 1828) -> (1732, 1828); ninja end range (1715, 3176) -> (1702, 3178); burst hits (11, 21) -> (15, 21); never-looks-up hits (10, 20) -> (8, 20).
- jet_break_turn: flip zoom (26, 744) -> (25, 744).
- jet_on_his_tail: end range (2601, 3360) -> (2601, 3361); chaseMin (73, 353) -> (70, 352).
- dfn_bt: ninja letGo 41 -> 40.
- dfn_bz: runMin15 731 against at least 732.
- dfn_ol: dip endRange 1413 against at most 1410.
- dfn_ot: ninja hits 9 -> 10.
- dfn_uo: ninja killT 19.7 -> 19.1.

### Results with the hold in place
- Ran: all 25 `test_dogfight_*` modules, plus `test_air_law`, `test_tank_law`, `test_ship`, `test_room`, `test_ground`, `test_flight`, `test_body_float`, `test_ship_law`, `test_engine_defaults` and `test_vehicle_respawn`.
- Result: 879 tests, OK (1 skipped). `test_ground`, `test_tank_law`, `test_room`, `test_ship` and `test_flight` are what covers `aircraft-ground-law.js`.
- The dogfight tests and harnesses I had touched (`tests/test_flight.py`, `tests/round_attitude_harness.mjs`, `tests/dogfight_eyes.mjs`) are byte-identical to HEAD.
