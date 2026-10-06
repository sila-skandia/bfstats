All five items are worked through. Items 1, 2, 3 and 5 are done and committed. The AC-130 (item 4) does not fly, and I did not change any code for it: the engine read shows the interior mesh is not what keeps it down. Six commits are on `worktree-agent-a3ebbf5bd5063a80b`, nothing pushed or merged. The whole suite passes (4599 tests, 10 skipped, 0 failures). Nothing needs re-extracting, so you have no asset commands to run.

**1. RollGrip friction (owner's Harrier, DC Final helicopters).** At `aircraft.js` `groundFriction` the dot was taken after `_gfWant` had been overwritten, so it was always 1. It is now taken first. Everything below is flown in the harness through the page's real `vehicleTick`:
- **Parked level, seat taken, before:** Harrier 247 m and 61°, DC Final UH-60 63 m and 176°, Mi8 277 m.
- **Parked, after:** AV-8B and DC Final UH-60, Mi24D, Mi8 move 0.000–0.002 m.
- **Owner's S 3 s / W 4 s / ArrowDown 1 s:** max bank 0.14° (was 41°), and the pull answers nose-up (11.3° → 20.6°).
- I staged the new parked check level, not at the existing check's 6° nose-up. At 6° DC Final's UH-60 rolls back about 0.2 m on its free-rolling mains, which is the engine's own law, not the bug. Even level, the bug shows as tens of metres.

**2. Rotation law for vectored airframes.** The gyroscopic term is gone for vectored airframes only. Checking COL-8 also turned up a second error the census missed:
- **Axis order:** the engine reads `inertiaModifier` as x/y/z, with x the pitch axis. `boxInertia` read it as yaw/pitch/roll, so the UH-60's `.2/.6/.6` had a light yaw axis where the engine has a light pitch one. I confirmed this in the binary and recorded it as a new ledger row, COL-13. Vectored airframes now use the engine's order.
- **Pedal-only hover, against the same hover without pedal:** UH-60 leans 0.19° with 0 deg/s roll (was 22° and 38 deg/s); AH64 0.42°, Mi24D 0.04°.
- **Side effect:** the bot now lands the UH-60 0.06 m off its point (was 5.5 m).
- **Fixed-wing:** a full before/after harness diff shows every fixed-wing number byte-identical.
- **Bound loosened:** the UH-60's existing parked bound went from 0.1 to 0.2 m. Its now-light pitch axis lets it rock from the 6° stage onto its gear, which swings its origin 0.11 m forward before it stands still.
- **Harrier feel change:** its pitch axis is now its light one too. It noses up 5.6°/s in the S hover and reaches 29° after 4 s of W hands-off (was 11°). That is DC's own data, not checked against the real game.

**3. Harrier bots.** No law change; DC's data supports the plane law it already flies. Its AI template is a jet's (same plane control as the F-15C), and retail has no hover law for any airframe. The helicopter hover law can't fly it: positive throttle opens the forward engine and closes the lift jets, so it drove down the strip at 80 m/s and never lifted. With fix 1 the plane law takes off at 4.5 s with no swerve (was 17°) and reaches a point 3 km away at 41 s. That is now a test.

**4. AC-130: not fixed.** I read the binary for which box the drag and inertia use (new ledger row COL-14). It is the cockpit LOD's exterior mesh, `AC-130_fus_M1`, 38.8 × 10.3 m face. On that box, DC's `drag 2.2` over `mass 10000` meets its four engines' thrust at about 21 m/s, against an AI maxSpeed of 50. The interior only takes it from 21 to 13 m/s; the drag figure is the problem.

The engine-correct box rule would also change 709 of 3161 vehicle glbs: vanilla BF109, B17, Stuka, SBD, Ju88A and Ilyushin, the XPack C47, BF110 and Mosquito, and ships including the Elco80, Daihatsu and LVT4. That breaks "vanilla aircraft and ships unchanged", so I reverted it. The patch is in `~/.cache/dc-sweep/air-flight/hullGeometry-lod-rule.patch` and the before/after survey in `hullGeometry-lod-rule.survey.txt` in the same folder. The README note was conditional on this landing, so I left it out.

**5. Critical damage stops helicopter engines.** The ledger plus my binary read settle it. On going critical or being destroyed, the Armor tells every engine to stop and latches them so re-boarding can't restart them. On recovery they restart if the seat is held. `vehicleTick` now keeps `engineRunning` off while the hull is critical or destroyed (vectored airframes only). Test: an AH-64 that goes critical in a climb drops to zero revs and falls at 23 m/s on full collective, then climbs again once recovered. Ledger row PHY-14 updated.

**Commits:**
- `18bd2bf1` fix(flight): RollGrip axle velocity
- `ecb33907` fix(flight): vectored rotation law (COL-13)
- `c3e2cece` test(flight): Harrier bot on the plane law
- `92bfa810` docs(engine): COL-14 geometry read, symbols
- `2f2941b3` fix(flight): critical damage stops the engines (PHY-14)
- `6e653382` docs(flight): helicopters.md

**Files touched:**
- `tools/bf1942-models/viewer/aircraft.js`, `tools/bf1942-models/viewer/world-vehicle-tick.js`
- `tools/bf1942-models/tests/flight_harness.mjs`, `tools/bf1942-models/tests/test_flight.py`
- `features/bf1942-engine-reference/ledger.md`, `features/bf1942-engine-reference/symbols.json`
- `features/bf1942-engine-reference/subsystems/collision-response.md`, `features/bf1942-engine-reference/subsystems/physics.md`
- `features/flyable-vehicles/flight-model.md`, `features/flyable-vehicles/helicopters.md`

The `world-vehicle-tick.js` hunk is the self-contained engine-stop line, outside the air-input code.

**Tests:** the flight suite is now 78 tests, all passing, and the six new checks each fail on the old code. The bot, ground, ship, world, room and vehicle-bodies suites also pass. I did not check it in the page; the harness drives the page's own tick chain.

**Suggested DC parity README rows (yours to write):**
- **Done:** census items 5, 26 and the helicopter tumble in item 3; item 13 (critical damage).
- **Still open:** item 3's undamped rotation; item 10 (AC-130).

**Still open:**
- **AC-130:** needs a measurement in real DC, or the owner's call on whether `drag 2.2` should apply.
- **Rotation damping:** nothing damps a rotation. The UH-60 holds 20 deg/s of roll after a 1 s input.

**For the fixed-wing package:**
- **Same rotation errors:** fixed-wing aircraft still carry the gyroscopic term and the swapped modifier order (COL-8, COL-13).
- **Box rule:** the COL-14 rule and its blast radius. The four fighters the existing top-speed calibration was measured on (Spitfire, Yak9, Zero, Mustang) already get the engine-correct box. The BF109, Stuka and B17 do not.