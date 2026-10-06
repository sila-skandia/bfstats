## AIR census: Desert Combat aircraft

### 1. Summary

**Domain score: about 62%** (34.8 / 56 weighted).

- Helicopter and Harrier thrust (PHY-12..14) is built and correct in node. Seats, weapons wiring, HUD data, spawns and engine notes are mostly in place.
- Both of the owner's reports are reproduced with numbers below. They come from **one evaluation-order bug in `aircraft.js:1106`** (the "RollGrip" friction bug, explained below), plus, for the DC 0.7 Black Hawk, **a gyroscopic term the engine doesn't have** (`aircraft.js:1019`).
- The rest of the gap is input: the mouse doesn't fly anything, the fixed-wing throttle latches where retail springs back, and the arrow keys carry a stick spring retail doesn't have. Cockpit interiors are missing for 14 aircraft classes.

### How the owner's reports happen

Everything here was flown in node from the real glbs, through a copy of the page's air-seat chain: the `world-vehicle-tick.js` air branch plus `world-input.js`'s `axisToward`, with dt 1/30 s. Scripts are in `~/.cache/dc-sweep/air/work/v/air_*.mjs` and outputs in `~/.cache/dc-sweep/air/*.txt`. The fix was trialled only in the scratch copy `work/vfix` (nothing in the repo was edited).

**Harrier (AV-8B; AV-8A/C/H share `AV8Common`)**

- **Parked, pilot aboard, no keys:** it slides 12.7 → 22.9 → 29.7 m/s over 3 s and turns −4 → −25° of heading (yaw −8..−11°/s).
- **Hold S:** it leaves the pad already turning. By 4 s it is yawing 35.6°/s with −9.7° of bank. Released, it reaches −88° of bank 3 s later. This is the "rotates sideways like a chopper".
- **The owner's likely sequence** (S 3 s to lift, W 4 s to transition, ArrowDown 1 s to pull up): at W+4 s it is banked −41° on heading +61°. Two seconds after the pull-up it has pitch −7.6° and bank −66°: the nose falls when you pull. This is "responds almost opposite".
- **The cause, `aircraft.js:1106`:** `_gfWant.copy(_gfAxle).multiplyScalar(-_gfWant.dot(_gfAxle))`.
  - The `copy` runs before the argument is evaluated, so the dot product is always |axle|² = 1.
  - Every `c_PGFRollGripWhenOccupied` wheel therefore pushes a constant −axle velocity change, up to its Coulomb budget, on every sub-step, whatever the hull is doing.
  - The grip only becomes RollGrip while the seat is occupied (`liveGrip`, `engineRunning` set from occupancy in `vehicle-instance.js:385`). That is why an empty Harrier sits still and an occupied one spins.
  - The bug arrived in the salvaged commit 75edb204 (2026-09-30).
- **With the dot taken first:**
  - Parked, the speed is 0.000 m/s.
  - S lifts it straight up: 29 m/s climb after 3 s, yaw 0, bank 0.
  - The owner's sequence gives bank 0.1° and a clean pull-up: +6°/s of pitch, climbing to 121 m.
  - In hover, Up / Right / D give nose-down / right bank / nose-right.
- **What retail does instead:**
  - Per the data, S fires the three lift jets: `setAcceleration 0/0/-10000` negates the input. I confirmed that the input is negated in the `automaticReset` branch too, in lnxded at `0x081d75b9`–`0x081d75d4`, before `fmul [tmpl+0x15c]` (maxRotation).
  - W drives the forward engine. A parked Harrier stands still.
- **Same bug in DC Final:** its UH-60/L/Q, Mi-24, Mi-8 and MH-53 use RollGripWhenOccupied. On HEAD a parked DC Final UH-60 yaws at 93 → 176°/s. If the owner's Black Hawk was DC Final, this is the whole story.

**Black Hawk (DC 0.7 UH-60, `c_PGFDummyGrip`, so no ground spin)**

- **Gyroscopic coupling.** `aircraft.js:1019` adds ω×Iω. The engine has no gyroscopic term and keeps ω in world axes (ledger COL-8, collision-response §4.2).
  - The UH-60's `inertiaModifier 0.2/0.6/0.6` puts yaw between pitch and roll, which makes yaw rotation unstable.
  - Two seconds of D, then hands off: yaw 54°/s, and it tumbles into roll −38°/s, bank 22°, pitch −10°.
  - With the term removed: yaw 59°/s, roll 0, bank 0.8°. The AH-64 and Mi-24 are barely affected.
- **No damping.** Any cyclic input leaves a rotation that never decays.
  - UH-60, 1 s of Right, then released: the roll rate holds at −20.3°/s and the bank keeps growing to 48° and beyond.
  - AH-64, 1 s of Up: the pitch rate is still −16°/s 2 s later.
  - The engine's angular box drag (`drag·|ω|/mass`) is negligible at 2500–4000 kg, so retail may be the same. That needs a DC measurement (open question 1).

### 2. Inventory

DC 0.7 aircraft on its 35 levels (spawner counts from every `scene.json` `objectSpawns`):

- **Helicopters:** Mi24D 23, AH64 15, AH-6 14, Mi8 12, UH-60 9, MH-6 9, UH-60L 7, UH-60Q 7, SA-342G/S/L/M 15, MH-500 3, OH-6 2. Nimitz carriers add MH-53, UH-60 and MH-6.
- **Harriers:** AV-8B 2, AV-8H 2, AV-8C 1, plus two AV-8A on each Nimitz (Midway ×2, Wake, Iwo Jima).
- **Jets:** Mig29 22, F16 19, SU-25 18, A10_B 11, F-15C 9, Mirage 8, A10_C 4, F-14B 3 (+2 per Nimitz), A10 1.
- **AC-130:** 2 (Operation Bragg, Gazala).

25 of the 35 levels carry aircraft. DC 0.7 has no UAVs, and its Mi-8 paradrop crate is commented out (`rem`).

**Pilot input mapping.** Retail uses the shipped `Air.con` map; DC ships no control maps. Keys: W/S → `c_PIThrottle`, D/A → `c_PIYaw`, ArrowUp/Down and mouse Y (invert 1) → `c_PIPitch` (Up = +1), ArrowRight/Left and mouse X → `c_PIRoll`, LMB/Space → `c_PIFire`, RMB/Numpad0 → `c_PIAltFire`, LShift → `c_PIMouseLook`.

| Input | Helicopters | Harrier | Jets | Viewer |
|---|---|---|---|---|
| `c_PIThrottle` | Hover engines' roll axis, AR (`automaticReset`), clipped to an idle floor (0.2–0.46). S is the same as releasing | Forward engine `+`; lift jets negated, so S = full lift in 0.5 s | AR with negative minimum: release → 0, S → −0.17..−0.3 (reverse thrust) | Helicopters/Harrier: held ±1 (matches). Jets: 0..1 latch (differs) |
| `c_PIYaw` | Front and rear racks roll ±20° in opposite senses | Same, on the lift-jet racks, plus the rudder Wing | Rudder | Key spring 2.4/s on top of the part's own servo; retail rise time is 0.001 s |
| `c_PIPitch` | All racks pitch ±20° (Up = nose down) | Lift-jet racks plus PitchWings | Elevator | Arrows only; the mouse is not bound (`controls.js:133` skips mouse axes) |
| `c_PIRoll` | Middle rack roll ±20° | Middle rack plus RollWings | Ailerons | Arrows only |
| Fire / AltFire | AH-64 Hydra / Hellfire; Mi-24 S-5 / AT-2; UH-60 right mouse = HoverEngine4 lift boost | Gun / MK83 | Gun / Aim-9 or bombs | Wired |

Gunner seats take mouse X/Y on `c_PIMouseLookX/Y` and fire on `c_PIFire`.

| # | Item | DC usage | Status | Wt | Evidence |
|---|---|---|---|---|---|
| 1 | Helicopter thrust: each engine along its own axis, racks, gearbox | 14 classes, ~120 spawners | Works | H | `vectored-engines.js`. `tests.test_flight`: 73 OK. W climbs 20 m/s in 4 s from the pad |
| 2 | Collective as a held axis (helicopters.md "W/S latch" open item) | all helicopters | Works | H | `world-vehicle-tick.js:164-172`. Fixed in 75edb204 |
| 3 | Helicopter attitude: gyroscopic coupling, no damping | all helicopters | Broken | H | Tumble and rate-hold numbers above; COL-8 |
| 4 | Harrier VTOL in the air: S = lift jets, W = forward, wings | AV-8A/B/C/H, 13 spawns | Works | M | Fixed-copy flights above. The "lift jets never fire" open item is closed |
| 5 | Harrier ground friction (RollGrip bug) | AV-8 ×5 wheels; DC Final helicopters | Broken | M | `aircraft.js:1106`; numbers above |
| 6 | Jet flight model | 103 spawns | Partial | H | Level top speed 63–87 m/s vs AI maxSpeed 60 (Mirage 105). Box inertia /12 vs the engine's /3 (AI-80). Gyroscopic term. Roll rate ~225°/s after 1 s |
| 7 | Jet throttle: latch vs retail held axis, AR spring-back, S = reverse thrust | all jets | Partial | H | Every DC jet engine declares `setAutomaticReset 1` with a negative minimum (F-15C −200/750, F16 −500/3000). The viewer latches (`world-vehicle-tick.js:172`) |
| 8 | Mouse flies the aircraft | every pilot | Missing | H | pilot-mouse-look README: "The retail mouse flies the plane while the key is up. That part is not built." |
| 9 | Key shaping | every pilot | Partial | M | `STICK_RATE 2.4` (`world-input.js:12`) is the viewer's own. `game.setAirKeyboardSensitivity 0.5` is unread |
| 10 | AC-130 flight | 2 | Broken | L | Never leaves 12.9 m/s; from 80 m/s at 300 m it falls in. Drag 2.2 over a 46×28×32 m hull box: the `AC-130_Interior` mesh is 26.5 m tall |
| 11 | Landing gear | all | Partial | L | Fixed Corsair 25/23 m thresholds (`aircraft.js:599`). Ignores `setGearUp/DownEngineInput` |
| 12 | Ground contact | all | Partial | L | Clearance clamp plus `settle`, not the Spring wheels (helicopters.md open item) |
| 13 | Engine stops on critical damage | all helicopters | Missing | L | `engineRunning` only follows occupancy (`vehicle-instance.js:385`). PHY-14 says which engine message clears it but not who sends it |
| 14 | Rotor and rack visuals | all helicopters | Partial | L | Rotor and engine note follow revs. Racks still share one rig servo |
| 15 | First-person cockpit interiors | 17 classes | Missing | M | `.cockpit.glb` exists only for A10, A10_B, A10_C, SU-25 and AC-130. The tree was extracted before `inside_view_alternative` existed (75edb204). A dry run now finds a cockpit for 15/16 (UH-60: none) |
| 16 | Seat survey and cameras | all | Works | M | `surveyVehicle`: AH64M230Control, Mi24DGGunControl, UH-60_Gunner/2 and AC-130_Gunner1-4 come out as aimable gun seats; passengers as seats |
| 17 | Pilot weapons fire | Hydra, Hellfire, S-5, AT-2, Aim-9, MK83, Snakeye | Works (wiring) | H | Fire and AltFire are both set for air seats. Guided-missile behaviour belongs to the weapons agent |
| 18 | Gunner weapons | M230, 12.7 mm, miniguns, AC-130 guns | Works | M | As 16 |
| 19 | UH-60 right-mouse lift boost | UH-60/L/Q | Works | L | HoverEngine4 on `c_PIAltFire` |
| 20 | Air HUD | all | Works | H | Root `hud` extras: icon, ammo bars, CHTIcon. DC ships no altimeter or helicopter HUD (MENU.rfa has only minimap helicopter icons) |
| 21 | Helicopter engine and rotor sound | all helicopters | Works | M | `engineRpm` = the scripted engine's revs (`vehicle-audio.js:741`). Not listened to |
| 22 | Jet afterburner sound layer | jets | Partial | L | Fixed-wing rpm = latched throttle ≤ 1, so the F16's `C_F16_High` layer (rpm 1.0–1.2) never sounds |
| 23 | Helicopter bots | AH64, Mi24D, UH-60, Mi8 | Partial | M | `helicopterControl` is a law the code itself calls invented; the harness flies 700 m and lands |
| 24 | Jet bots | all jets | Partial | M | AI-60 plane law, verified on vanilla only. Not flown on a DC jet here |
| 25 | Bots never board A10_B/A10_C | 15 spawns on 8 levels | Broken | M | `bot-units.js:94` `aiOf` goes by record and seat names. The root extras carry no `aiTemplate`, so A10_B/C (whose `aiTemplate` is A10) return null. AH-6/MH-6/OH-6/MH-500 and Mirage have no AI in retail either |
| 26 | Harrier bots | AV-8 | Broken | L | `hovers` is false, so they fly the plane law, and the ground bug spins them on the pad |
| 27 | Spawns: airfields and Nimitz decks | 25 levels | Works | H | Spawners and carrier-borne craft are in the bakes. Not checked in the page |
| 28 | Crash and damage | all | Works | M | Shared vanilla machinery (`armor.js`: upside-down and water HP loss). Not re-checked for DC |

### 3. Root causes

1. **The RollGrip evaluation-order bug** (`aircraft.js:1106`) causes items 5 and 26 and both owner reports in DC Final. A pinned test missed it because the parked check (`real.parked`) only covers the AH-64, UH-60, Mi-24 and AH-6, which all use DummyGrip.
2. **The viewer's rigid-body step differs from the engine's** (COL-8): it adds a gyroscopic term (item 3) and uses box /12 inertia for fixed wings (item 6). The fixed-wing path keeps its calibrated departures deliberately (AI-80, the comment at `world-vehicle-tick.js:150`).
3. **The air input stage is the viewer's own, not the control map's:** no mouse axes (8), a key spring (9) and a fixed-wing throttle latch (7, 22).
4. **The extracted trees predate exporter work:** cockpits (15). The AI link (25) is a related extras gap: the root carries no `aiTemplate`.

### 4. Work packages

**WP1. Fix the RollGrip friction and pin it** (S). Closes 5, 26, both owner reports in DC Final, and the Harrier half in DC 0.7.
- Take `along = _gfWant.dot(_gfAxle)` before the `copy`.
- Engine source: physics.md §6 and PHY-2 (RollGrip asks back only the axle component).
- Files: `viewer/aircraft.js` (`groundFriction`), `tests/flight_harness.mjs`, `tests/test_flight.py`.
- Proof:
  - Extend `real.parked` to AV-8B and to DC Final's UH-60, Mi24D and Mi8 (moved < 0.05 m in 20 s).
  - Add the owner's S→W→pull sequence with |bank| < 2°.
  - My fixed copy gives 0.000 m/s parked and bank 0.1°.
- No re-extract.

**WP2. Remove the gyroscopic term for vectored airframes** (S). Closes item 3's tumble.
- Engine source: COL-8 and collision-response §4.2 (no gyroscopic term; ω in world axes).
- Files: `aircraft.js` `step()` (line 1019 area). Fixed-wing stays as it is (calibrated on the term) and goes into WP5.
- Proof: a harness yaw-only input keeps roll and pitch < 1° on UH-60, AH64 and Mi24D. Measured: 38°/s of roll with the term, 0 without.
- Conflicts with WP1 and WP5 on `aircraft.js`: sequence them or give them to one agent.

**WP3. Make the air seat's input chain match retail** (M–L). Closes 8 and 9.
- Mouse X/Y fly `c_PIRoll`/`c_PIPitch` (Air map, `setAirMouseInvert 1`, `setAirMouseSensitivity 0.75`) while `c_PIMouseLook` is up.
- Drop the key spring for keyboard axes (`ControlMap::buttonsToAxis` lnxded `0x083f2080`, 0.001 s rise/fall); keep it only for touch.
- Engine source: MLK-1..6, the `mouse-input.js` rate law (GUN-2b). **Needs a client engine read** of how a mouse axis scales into `c_PIPitch`/`c_PIRoll`, and what the keyboard sensitivity does.
- Files: `local-player.js` (`sampleInput`), `controls.js` (mouse axis bindings), `local-look.js`, `mouse-look-key.js`, `world-vehicle-tick.js`, `world-input.js`. Shared hot files: `local-player.js` and `world-vehicle-tick.js`.
- Proof: extend `test_mouse_look_key.py` / `test_controls.py` so mouse counts → stick with the invert sign; a key gives a full channel in one tick.

**WP4. Re-extract the DC and DC Final aircraft with `--cockpit`** (S–M). Closes 15.
- Then `optimise_mesh.py` and `publish-mesh-delta.py`. Confirm 15/16 `.cockpit.glb`, and find out why the UH-60 has none.
- Files: the asset trees only, plus `bf42/assemble.py` if the UH-60 needs a rule.
- Proof: `.cockpit.glb` count, the reports' `cockpitSwaps`, and the owner's in-page first-person check.
- Spawners load from the model tree, so no level re-bake is expected. The Nimitz decks bake AV-8A/F-14B/MH-53 into `scene.glb`, so check whether those need the cockpit too (see `level-bake-layers`).

**WP5. Run fixed-wing on the engine's own throttle and body laws** (L; needs the owner's decision, because vanilla changes too). Closes 6, 7 and 22.
- The throttle comes from the Engine's AR roll axis through the gearbox, as `vectored-engines.js` already does: W held, release → 0, S = reverse thrust. Also /3 geometry inertia and no gyroscopic term.
- Engine source: PHY-13, GUN-2, TANK-12/13, AI-80, COL-8.
- Files: `aircraft.js`, `world-vehicle-tick.js`, `bot-pilot.js`, `bot-aim.js`, `vehicle-audio.js`, the flight harness and its calibrations.
- Proof: re-derive AI-80's top-speed brackets; T1 springs back on release.

**WP6. Let bots board A10_B/A10_C** (S). Closes 25.
- Either have `extract_vehicle_ai.py` add every PCO whose `aiTemplate` names a record, or emit `aiTemplate` on root extras and have `aiOf` prefer it.
- Then republish `maps/mods/{desertcombat,dc_final}/_shared/vehicle-ai.json`.
- Proof: `aiOf(A10_B)` returns the A10 record.

**WP7. Make the AC-130 fly** (M). Closes 10.
- **Needs an engine read:** which geometry box `PhysicsNode`'s box drag and `getGeometryInertia` read for a PCO root.
- Then fix `hullGeometry` so the interior mesh doesn't count.
- Files: `ship-spec.js` (**shared with ships**), `aircraft.js`.
- Proof: the AC-130 reaches its AI maxSpeed of 50 m/s.

**WP8. Helicopter loose ends** (M). Closes 11, 12, 13 and 14.
- Critical damage clears `engineRunning` (PHY-14's sender is still open); gear thresholds from the `LandingGear` data; per-rack visual servos; optionally Spring-wheel ground contact.
- Files: `aircraft.js`, `vehicle-instance.js`, `vehicle-damage.js`, `vehicle-base.js`/`model-rig.js`.

### 5. Open questions

1. **Does anything damp a helicopter's rotation in retail?** The laws read so far say no, and the viewer holds rates indefinitely. The parity lab has no DC support, so it needs a DC recording or a server-lab round.
2. **What does `game.setAirKeyboardSensitivity 0.5` do?** It is absent from lnxded, and `buttonsToAxis` applies none. If it halves key deflection, W and S give T1 = 0.5, which would change the helicopter collective and the Harrier hover completely.
3. **Which box does a PCO root's drag and inertia use?** This decides item 10 and every aircraft's rotation.
4. **Why does the UH-60 get no cockpit** (`reaches_first_person` is false)?
5. **Does retail spring a vanilla plane's throttle back too?** The data says yes (Corsair `setAutomaticReset 1`, minimum −3000), but the owner may prefer the latch.

Scratch scripts and outputs are in `~/.cache/dc-sweep/air/` (`air_owner.mjs`, `air_harrier_AV-8B*.txt`, `air_heli_*.txt`, `air_jets.txt`, `air_level_spawns.txt`, `air_specs.jsonl`). Key code: `<repo>/tools/bf1942-models/viewer/aircraft.js` lines 1106 and 1019.