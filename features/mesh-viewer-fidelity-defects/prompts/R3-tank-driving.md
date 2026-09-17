# R3 — The force law that actually moves a tank

You are a research agent on the map-viewer fidelity round. Read
`features/mesh-viewer-fidelity-defects/BRIEFING.md` first if you have not.
You read the engine and the shipped data; you do not change the viewer.

## The defect

Driving the tank in the viewer, it "barely moves". In the retail capture the
same tank pulls away at a normal pace and covers ground.

Note this is a *magnitude* defect, and the gear curve it would be tempting to
blame is already settled and already implemented correctly. The most likely
home of the bug is the one thing in the chain that was never read out of the
binary — see below.

## Evidence

`/home/dylan/bf1942-tank-drive-shoot.mp4` (6.7 s, 60 fps): the player enters a
US medium tank (the HUD icon reads as the Sherman), drives forward down the
airfield road past a row of huts and palms, fires the coaxial MG
(`400 → 195` rounds) and then the cannon (`30 → 29`). `game-tank-sheet.png` is
the 4 fps contact sheet. The world is Wake.

## What is already settled — do not re-derive it

From `subsystems/tank-driving.md` and ledger `TANK-1…6`:

- **There is no tank-specific code path.** Differential steering is ordinary
  per-wheel friction code reading whichever axes an Engine happens to expose.
  `engineType` is parsed and dumped back by `makeScript` and **no simulation
  code anywhere calls `getEngineType()`** (exhaustive: 0 call sites in
  2,408,565 lines of lnxded disassembly).
- **TANK-2, byte-exact.** `getCurrentDifferentialRPM(side)` (client
  `0x0057bcb0`), called per `EngineGrip` wheel from `addFriction`:
  `side == 0` → throttle; `side > 0` → `clamp(throttle x (1 − 1.5 x yaw), −1, 1)`;
  `side < 0` → `clamp(throttle x (1 + 1.5 x yaw), −1, 1)`.
- **TANK-3, corrected.** `getCurrentRatio() = differential x 3.5 / curve[idx]`
  with `idx = trunc(gear / numberOfGears x 100)` — truncation via the MSVC
  `_ftol` idiom — against a materialised 101-slot array that is 1.0 everywhere
  except indices 20/40/60/80/100 (3.5/2.2/1.5/1.1/0.94). Sherman = 4.0,
  Willy = 7.0, M3A1 = 17.5. Only `numberOfGears` of 1 or 5 ever touches the
  curve's authored shape.
- **TANK-4.** `getCurrentTorque()` samples a second 101-float curve and feeds
  **only the engine sound's RPM**. `setTorque` is not thrust.
- **TANK-6.** A Sherman's only load-bearing driven wheels are the rear bogie
  springs (`EngineGrip`); every other track wheel is non-physical or
  `EngineDummyGrip` (spin only). At zero throttle both sides return exactly 0
  regardless of yaw — a tank cannot pivot from a dead stop.
- `viewer/ground.js` implements all of the above (`engineRatio`,
  `differentialRPM`, the 101-slot curve). Check it before suspecting it.

**And the gap that matters.** `features/bf1942-3d-models/ground-vehicles.md`,
"Open gaps (`TrackedVehicle`)", says in its own words:

> **The exact retail force law a tracked wheel's own friction applies** is
> still unread (verify-r7.md's own Open section, PHY-2/PHY-4) — `driveAccel`
> is this file's bridge between two confirmed-but-separate formulas (TANK-10's
> per-side split, `PhysicsEngine::updatePhysics`'s whole-body thrust law), not
> a third confirmed one.

That bridge is a fitted constant standing between two read ones. **Closing it
is this track's main job.** The same section also records that no number in the
`mu` / `corneringStiffness` / `trackResistance` / `angularDamping` table is a
recorded drive against the real game, and that suspension is vertical-ray with
no hull collision. (It also says `TrackedVehicle` is "not wired into
`map.html`"; that is now stale — `map.html` around line 3660 picks
`TrackedVehicle` for a tank and falls back to `GroundVehicle`. Note the
staleness in your report.)

## Questions, in priority order

1. **Read the force law.** Follow a driven `EngineGrip` wheel from
   `addFriction` through to the force or acceleration that actually reaches the
   body, in the client (`0x0057bcb0` is your anchor) and in lnxded where the
   symbols help. What quantity does the wheel apply, in what units, at what
   point of application, against what mass and inertia? Give the closed form.
   This is the number `driveAccel` is standing in for.
2. **What opposes it.** Rolling resistance, engine braking, the vehicle drag
   laws (PHY-4 records that vehicles have a second, box-shaped drag law), and
   the terrain's own contribution. Give each as a formula with the shipped
   values for the Sherman.
3. **Does the ground material scale drive force?** `materialFriction` per
   terrain material, and what the engine multiplies by it. Wake's airfield road
   versus sand versus the beach — if the viewer is driving on a material whose
   friction it applies differently, that alone could read as "barely moves".
4. **The Sherman's own numbers**, read out of
   `Objects/Vehicles/Land/Sherman/*.con` across the archives: mass, the
   Engine's `differential`, `numberOfGears`, `torque`, any rev limit, each
   spring/grip wheel with its radius and side sign, and the drag words. Wheel
   radius has already been independently measured at ≈0.255 m from `scene.glb`;
   say whether the data agrees.
5. **Predict, then check.** From (1)–(4), give the expected forward
   acceleration from a standing start and the expected top speed on flat
   ground, in m/s. Then cross-check against the retail recording: time the tank
   past two landmarks whose world positions you can read out of the extracted
   Wake scene (`viewer/maps/wake/scene.json` and the level's own object
   placements) and report the measured speed with its error bars. A prediction
   that disagrees with the video is a finding, not a failure.
6. **Steering while moving.** Turn rate at speed for a given yaw input, and
   what the retail capture shows. TANK-6 fixes the dead-stop case; this is the
   moving case.
7. **What stops a tank.** Does the retail hull collide with statics, and with
   what shape? The viewer inherits a vertical-ray suspension with no hull
   collision from `GroundVehicle`, so if retail resolves hull contacts the
   viewer may be catching its wheels on geometry it should push past — or, the
   other way round, sinking into something it should ride over. Establish what
   retail does; the implementer needs to know whether the viewer's sweep is
   even the right test.

## Deliverable

The report shape in the briefing, plus:

- The force law as a formula, with every symbol defined and each one labelled
  `confirmed` (address cited) or `inferred`.
- A parameter table for the Sherman: every value the implementer must feed
  `TrackedVehicle`, with its source file.
- Two numbers with error bars: retail's standing-start acceleration and its
  top speed on flat ground.
- A short note on what `viewer/ground.js` would have to change, named by
  function. Do not write the code.

## What would make this report wrong

- Blaming the gear curve. It is settled and implemented.
- Taking `setTorque` for thrust (TANK-4: it drives the engine *sound*).
- Giving a top speed fitted to the video without the data-side derivation, or
  the reverse. The report is worth much more when both exist and agree — and
  most of all when they disagree and you say so.
- Forgetting that every per-call quantity in this code is per-1/30 s.
