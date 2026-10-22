# Tank ground law: the server's per-tick drive, on the page

Status: **built** 2026-10-22. `viewer/tracked-vehicle.js` drives a tracked hull
by the dedicated server's own per-tick law (ledger TANK-18..TANK-24, TERR-17).
The lab Sherman replays through the page's own `TrackedVehicle` to 0.25-0.35 mm
an acknowledged tick in every phase. Open: the M3A1 rolls over in a hard turn
from top speed, and object contacts and the turret were not exercised.

## Why

A browser player driving a tank through the UDP sidecar predicts his own hull
and the reconciler closes the error at every ack
(`netcode-reconcile.js` `createHullReconciler`). The page's old drive was a
reconstruction: 120 Hz sub-steps, a spring probed down the hull's axis with
travel, bump stop and a seeded damper, per-sub-step friction, a fitted angular
damper, a static hold, a body-frame Euler rotation and no sleep. It missed the
server by centimetres an ack, and every correction shook the drawn hull and
the camera.

## The law

One server tick, in the server's order (TANK-18):

1. `Engine::handleUpdate` (`EngineState.tick`, TANK-12), on inputs rounded to
   hundredths (TANK-24).
2. The springs: `-(1.5 k D + c (D - Dprev) 30)` at each anchor, `D` the push
   the last collision pass left, the wheel then snapped back to rest (TANK-19).
   The engine's revs wake the root, then the root sleeps or steps: box drag,
   `v += acc dt + fr dt`, `x += v dt`, omega from the torques over the box
   inertia, the rows turned about omega (TANK-21, TANK-22).
3. The collision pass: each awake wheel's col0 vertex 0 against the engine's
   terrain triangles (TERR-16), pushed out along the face normal by at most
   1 m (TANK-20), and `addFriction`'s EngineGrip arm posting one clamped
   delta-v a wheel, meaned, into the next tick (TANK-23). The terrain
   material is read by truncation (TERR-17). The road wheel's resistance is
   0.01.

`TrackedVehicle.law` holds the root's state between ticks in the server's own
terms (`acc`, `racc`, `fr`, `rfr`, `sleepiness`); each wheel holds its `push`
and `dPrev`. `integrate(dt)` runs whole 1/30 s ticks off an accumulator.

What the page keeps of its own, marked in the code: the swept sphere against
statics where the body world does not own the hull, the ground clamp as a
failsafe for an origin under the ground (a driven Sherman never reaches it),
the static push from the body world taken when deeper than the terrain's, the
hull contacts' friction samples (`hullContactFriction`), the amphibian's water
half, and `#settleWheels`, which stands a freshly boarded hull on the push its
wheels already have.

## How it was checked

`lab/veh_law_probe.mjs` drove a sidecar player's Sherman on vanilla Wake through
a nine-phase plan at an even 30 Hz (2026-10-22). Its control states, re-decoded
whole from the raw hex, are `tests/fixtures/tank_law_wake.ndjson.gz`, and the
terrain window round the run is `tests/fixtures/tank_law_wake_terrain.json.gz`.

- `lab/veh_law_check.py` is the law in Python. `--mode step` re-seeds every ack
  and gives 0.2-0.4 mm median, under 1.1 mm worst.
- `tests/test_tank_law.py` and `tests/tank_law_harness.mjs` replay the words
  through the page's own `TrackedVehicle`, seeded from the server's whole state
  at the seat (serial 2115). At every ack the server's position, rotation and
  velocity are put back, as the reconciler does.

| phase | n | horizontal median / max (mm) | vertical max (mm) | yaw max (deg) |
|---|---|---|---|---|
| idle | 40 | 0.00 / 0.02 | 0.01 | 0.000 |
| throttle | 40 | 0.25 / 0.97 | 0.13 | 0.000 |
| throttle+right | 60 | 0.34 / 0.67 | 0.46 | 0.002 |
| throttle+left | 60 | 0.34 / 0.72 | 0.14 | 0.001 |
| release | 30 | 0.35 / 0.66 | 0.24 | 0.001 |
| brake/reverse | 40 | 0.24 / 0.53 | 0.24 | 0.000 |
| idle2 | 30 | 0.28 / 0.65 | 0.04 | 0.000 |
| throttle+left2 | 40 | 0.30 / 0.73 | 0.13 | 0.000 |
| coast | 40 | 0.31 / 0.56 | 0.30 | 0.000 |

Revs stay within 0.001 of the server's with no gear miss. The root sleeps and
wakes on the server's acks (2218, 2280). One uncorrected run from the seat is
within 1.8 mm through the throttle and 2 mm through the right turn. The
0.05-degree yaw it gathers in the long left turn leaves it 11-14 mm off for the
rest of the plan, 22 s on. The same
run handed two 1/60 s frames a word gives the same numbers.

The plan's last word (2786) is not scored. Two server ticks ran against its
serial as the probe's words stopped.

## Turret

The lab run carries the turret's two bundles in every control state, and they
sit at the quantised zero (-1.5e-5) throughout: the plan sent no look. So the
traverse law (`TurretRig`, `createAimReconciler`) is not exercised by this data
and was not changed. Measuring it needs a probe plan with look words.

## Open

- The M3A1 test double (`tests/ground_harness.mjs`) rolls over in a turn from
  its 17.4 m/s top speed at any lock from 0.2 up (TANK-22). Its contacts sit
  1.44 m under the origin and 0.975 m out, so a skid past 10 m/s^2 tips it.
  The old fitted roll damper held it. The double has no hull-terrain contact
  (the body world's, on the page) and no col0 probe depth. Whether the retail
  half-track rolls in that turn is unmeasured, so the case was taken out of
  `test_turning_never_flips_from_the_vehicles_own_top_speed_either`.
- A slow yaw drift in long free runs, about 0.03 deg/s (float32, or the exact
  hull box).
- Object contacts (statics, hulls) were not in the lab run.
- The M3A1's RollGrip axle takes the steer from the input at once. The engine
  reads the steering bundle's servoed angle.
- `lab/move_law_terrain.py` still rounds the material (TERR-17). The soldier's
  replay passes either way.
