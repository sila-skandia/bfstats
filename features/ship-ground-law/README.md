# Ship law: the server's per-tick drive of a ship, on the page

Status: **built** 2026-10-23. `viewer/ship.js` drives a ship by the dedicated
server's own per-tick law (`viewer/ship-law.js`, ledger SHIPLAW-1..SHIPLAW-4).
The lab Daihatsu replays through the page's own `Ship` to 0.27-0.38 mm median
and under 0.8 mm worst an acknowledged tick in every phase. Open: the hull
against the sea bed and against other objects, and the Hatsuzuki, whose helm a
lab bot holds.

## Why

A browser player driving a boat through the UDP sidecar predicts his own hull
and the reconciler closes the error at every ack. The page's ship was the
aircraft's pedal path: a throttle spooled at `throttleRate`, 240 Hz sub-steps,
a gyroscopic term, the rudders on the rig's position servo at `setMaxSpeed`,
the submerged scale on the linear drag only, the depth taken off the collision
box, and no sleep. It missed the server by 1-5 mm median and up to 21 mm an
ack in a turn, which the reconciler showed as a shake.

## The law

One server tick, in the server's order (SHIPLAW-1, the tank's TANK-18 with
floats for springs):

1. The handleUpdate pass. The Engine's roll axis ramps to the throttle at
   `setAcceleration` (an automatic-reset axis, GUN-2; 5000 over 5000, one
   second to full) and the gearbox moves the revs toward `2 (T1 - L)` on the
   load the last tick left (TANK-12/13). Each rudder ramps the same way on
   `c_PIYaw` at its own `setAcceleration` (36 deg/s on a Daihatsu, 10 on a
   Hatsuzuki), not at `setMaxSpeed` (SHIPLAW-4). Inputs to the hundredth
   (TANK-24).
2. The children into the root's accumulators. The Engine wakes the root at
   `|revs| >= 0.05`; with the screw under the sea it pushes `fwd K ratio` at
   the screw and posts the load (`feedbackLoop`); out of the sea it pins the
   revs to 1 and pushes nothing, but only above `|revs| = 0.02` (SHIPLAW-2).
   Each rudder lifts `-clamp(10 calculateLift(...), +-200)` along its up at
   its own position. Each float adds PHY-3's buoyancy and heave damping,
   while the root is awake.
3. The root: the sleep test on those accumulators (TANK-21), the box drag with
   `s = 1 + 24 min(underWater/DY, 1)` on both arms (SHIPLAW-3), one Euler
   step (TANK-22; the rows turn only above `|w|^2 = 1e-6`).
4. `checkVsTerrain` writes `underWater` from the lowest col0 vertex
   (`Ship.underside`, the page's `hullCollisionLayers`). The page takes it at
   the start of the next tick from the same pose, so a correction re-derives
   it; nothing else the law carries is hidden from the wire except the load
   and the ramps, which it keeps.

`Ship.integrate(dt)` runs whole 1/30 s ticks off an accumulator; two 1/60 s
frames a word give the same numbers as one 1/30 s frame.

What the page keeps of its own: the hull on the sea bed. The engine's answer
there (each col0 vertex's `impulseOn` and friction) is not ported, so while the
hull touches the bed, for 8 ticks after, and for any law tick whose step would
reach it (run again from where it started), a tick runs the old beaching model
(the pedal path through `hullFloor`, `settle` and `pushOutOfBed`, W8-A/W9-A).
The gearbox, the throttle's angle and the rudders carry over both ways.
`options.shipLaw: false` keeps the old path whole.

## How it was checked

`lab/veh_law_probe.mjs` (`TEAM=1 KIND=plane WANT=Daihatsu SG=76 USE_AT=3.5`)
walked a sidecar soldier off the Shokaku's lower spawn into a parked Daihatsu
on vanilla Wake and drove two plans at an even 30 Hz (2026-10-23): throttle,
either helm with way on, release, astern with and without helm, idle, rudder
alone, coast. Its control states, re-decoded whole from the raw hex, are
`tests/fixtures/ship_law_daihatsu_wake.json.gz` with the hull's table, its
Engine, rudder and float nodes and its col0 underside. The fixture leaves out
the ticks where the hull scraped the Shokaku's stern (0.4-1.5 m/s kicks in one
tick: object contacts are not the law's) and the wake from sleep, whose delta
states decode against a stale base.

`tests/test_ship_law.py` and `tests/ship_law_harness.mjs` replay the words
through the page's own `Ship`, seeded from the server's whole state at each
run's first ack, with the server's position, rotation, velocity and omega put
back at every ack as the reconciler does. Per acknowledged tick, horizontal
median / worst in mm (the second run, 2026-10-23, `wake_d2`):

| phase | n | before (pedal path) | after (law) | vertical worst, after | yaw worst, after (deg) |
|---|---|---|---|---|---|
| throttle | 20 | 1.43 / 3.02 | 0.30 / 0.61 | 0.38 | 0.003 |
| throttle+right | 80 | 2.14 / 7.46 | 0.35 / 0.68 | 0.46 | 0.007 |
| throttle2 | 40 | 3.39 / 15.71 | 0.32 / 0.77 | 0.41 | 0.005 |
| throttle+left | 80 | 4.90 / 15.08 | 0.36 / 0.63 | 0.49 | 0.006 |
| release | 40 | 3.92 / 18.40 | 0.38 / 0.57 | 0.49 | 0.003 |
| reverse | 60 | 1.87 / 3.59 | 0.29 / 0.65 | 0.44 | 0.007 |
| reverse+left | 30 | 1.92 / 3.69 | 0.35 / 0.70 | 0.39 | 0.007 |
| idle2 | 40 | 0.49 / 2.23 | 0.27 / 0.54 | 0.39 | 0.003 |
| rudder only | 60 | 0.30 / 0.70 | 0.29 / 0.69 | 0.39 | 0.004 |
| throttle+left2 | 40 | 1.08 / 3.30 | 0.35 / 0.75 | 0.37 | 0.006 |
| coast | 60 | 0.53 / 2.85 | 0.36 / 0.60 | 0.50 | 0.006 |

The first run's open-water stretches (`wake_d1a`, `wake_d1b`) give the same:
0.27-0.37 mm median, under 0.75 mm worst. Before, its worst was 21 mm in the
left turn and 17 mm on release. The revs stay within 6e-4 of the server's (the
pedal path: 9e-3). One uncorrected run of the second plan, 30 s, stays within
18 mm and 0.006 degrees; the drift is the revs' 3e-4 offset from the wire's
quantised seed.

`tests/test_ship.py` (the Fletcher's float, gearbox, helm, beaching and reef
tests) runs on the law. Two of its tests changed with it: a hull dropped a
metre above her draft now falls and sleeps short of it, as the server's root
does, and the first sample on the bank allows 0.05 m/s (she meets it on an
even keel, without the old model's 0.13 degrees of trim).

## Open

- **The Hatsuzuki was not driven.** On the lab a co-op bot holds her helm and
  never moves (she sits asleep at (1119, 89.4, 377)); a sidecar soldier spawned
  on her bridge (SG 71) stood at the driver's entry and Use did nothing. The
  law builds for her (one `c_ETShip` Engine, the HullWing and rudder, eight
  floats; the two carried Daihatsus' parts are not hers) and the Fletcher-
  shaped tests in `test_ship.py` run on it, but no lab run measures a capital
  ship. Measuring her needs the bot out of the seat.
- The hull against the sea bed (the col0 vertices' `impulseOn`, `solveImpulse`
  and `addFriction`) and against other objects (a carrier's hull, another
  boat) are not ported: beaching runs the old model.
- The wake from sleep is not scored (the decoder's delta states before it).
- A one-shot kill's sink and the damaged sink offset (SHIP-4) were not in the
  runs.
