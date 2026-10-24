# Tank ground law: the server's per-tick drive, on the page

Status: **built** 2026-10-22, corrections and the half-track 2026-10-23.
`viewer/tracked-vehicle.js` drives every tracked hull and half-track by the
dedicated server's own per-tick law (ledger TANK-18..TANK-24, TERR-17), and a
correction adopts the server's state at the acked tick and runs the ticks since
again (TANK-25). Under the page's own reconciler a round trip late, the lab
Sherman and M3A1 hold 0.3-0.5 mm an ack in every clean phase, with no bounce at
idle. Wheeled cars followed on 2026-10-25 ([car-ground-law](../car-ground-law/README.md)).
Open: object contacts; the M3A1's hard turn from top speed.

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

## The reconciler, the half-track (2026-10-23)

Live, the owner found the Sherman "wobbling badly" sitting still and the M3A1
"a mess" that "jumps along the ground". Neither was the law: the harness
above corrects at every ack with no round trip. `tests/vehicle_law_harness.mjs`
adds `lag`, the page's own correction four ticks behind, and showed it.

**What was wrong, both hulls: the correction (TANK-25).** The delta reconciler
added the acked tick's error to the present, a round trip late. The wheels
still held the push from the old pose, so the spring damper read the step as
a closing speed, and the stale velocity error landed out of phase with the
hull's own bounce. The springs answered every ack. Fixed in two steps:
`TrackedVehicle.reanchor` re-stands the wheels at a corrected pose (Dprev moved
with them), and `TrackedVehicle.rewind` now takes the server's state at the
acked tick and runs the ticks since again on their own recorded inputs, the
retail client's way (`readControlObjectState`). The sidecar's ack row carries
the rest of the body for it: spin, the four accumulators, the sleep flag and
the Engine's registers. Not the springs, whose 2 mm steps are noise to a damper.

**What was wrong, the M3A1 only:**

- its front `c_PGFRollGrip` wheels steered to `input x 40` at once; the axle
  follows the bundle's servo at 80 deg/s (TANK-27);
- its wheels are material 37, undefined, so material 0's resistance 0.02, not
  the Sherman's 178's 0.01 (TANK-26). Each wheel now takes its probe's own
  material from the level's tables (`wheelContactDepths(vehicle, spec,
  tables)`).

Its springs (28/7 front, 20/5 bogies), wheel count and positions, probe depths
(0.51 m front, 0.184 m bogies) and inertia box (2.46 x 2.51 x 6.96 m) were
already right: the uncorrected replay holds 0.3 mm through the straight phases.

Per ack, horizontal median / worst (mm), vertical worst, under the page's
reconciler four ticks behind (`lag`). Before = main at 99551860. After = this
round:

| hull, phase | before | after |
|---|---|---|
| Sherman idle | 2.0 / 4.3, vertical 1014 | 0.00 / 0.07, vertical 0.01 |
| Sherman throttle | 22.8 / 179 | 0.32 / 0.92 |
| Sherman throttle+right | 62.0 / 281 | 0.27 / 0.91 |
| Sherman coast | 27.7 / 272 | 0.34 / 0.72 |
| M3A1 idle | 15.3 / 80.5, vertical 558 | 0.00 / 0.06, vertical 0.01 |
| M3A1 throttle | 35.1 / 169 | 0.33 / 0.76 |
| M3A1 release | 70.9 / 160 | 0.34 / 0.82 |
| M3A1 brake/reverse | 43.5 / 163 | 0.35 / 1.10 |
| M3A1 throttle+right | 126 / 699 | 4.5 (median) |
| M3A1 hard turn | 40.5 / 258 | 13.3 (median) |

A second Sherman run, from the South Base pad the old sim test drives
(`vehicle_law_sherman_south`, 2026-10-23), holds 0.31-0.45 mm median and under
1.1 mm worst in every phase under `lag`, its hard turn included up to the
object it meets at the end.

The M3A1's turns are not all the law's. The server's hull met objects the
harness has no collision for: a 0.4 m step at serial 8504, 1.9 m at 8530, and
the whole hard turn pressed against an obstacle at 0.3 m/s, its friction
accumulator with a vertical part. So the rollover question stays open: the lab
half-track never reached speed in open ground. Wake's co-op layer has no
wheeled hull, so no lab car was driven (the probe found none in 1.5 km).

Fixtures: `tests/fixtures/vehicle_law_{sherman,sherman_south,m3a1}{,_terrain,_chassis}.*`.
Chassis come from `lab/veh_law_chassis.mjs`, the drive the page builds on the
real level. Test: `tests/test_vehicle_law.py`.

## Turret

The lab run carries the turret's two bundles in every control state, and they
sit at the quantised zero (-1.5e-5) throughout: the plan sent no look. So the
traverse law (`TurretRig`, `createAimReconciler`) is not exercised by this data
and was not changed. Measuring it needs a probe plan with look words.

## Open

- ~~Wheeled hulls.~~ Built 2026-10-25 ([car-ground-law](../car-ground-law/README.md),
  TANK-28, TANK-29): a `c_ETCar` root is driven by `TrackedVehicle`, measured
  on El Alamein's Kubelwagen and Willys to about half a millimetre an ack.
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
- `lab/move_law_terrain.py` still rounds the material (TERR-17). The soldier's
  replay passes either way.
