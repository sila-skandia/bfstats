# Aircraft flight law: the plane in the air against the server, per tick

Status: **measured and built** 2026-10-25. The page's `Aircraft` flies the
lab Bf109 within half a millimetre of the dedicated server an acknowledged
tick through a climb, rolls, rudder and a push (AIRGND-7), so the in-flight
law needed no change. Its correction did: the page took an aircraft's
correction through the delta reconciler, which in a dive ran 8.5 mm median
and 31 mm vertically an ack off. `Aircraft.rewind` now takes the server's
state at the acked tick and runs the ticks since again, as the tank does
(TANK-25, AIRGND-8), and the same dive holds 0.6 mm.

## Why

The ground law (`features/aircraft-ground-law`) was measured on the SBD's
takeoff roll and two deck runs. The air above that had been checked once,
off Wake's cliff with no input (AIRGND-6). Planes in flight with the stick
moving were the open item with the most playtest weight, and no harness
corrected an aircraft the way the live page does, a round trip late.

## How it was checked

`lab/veh_law_probe.mjs` (KIND=plane) flew a sidecar player's Bf109 off El
Alamein's Axis airfield on a private lab (co-op, no bots, port 14738),
2026-10-25. The plan word now also carries the stick (`pitchUp`/`pitchDown`,
`rollLeft`/`rollRight`, the wire's PITCH and ROLL axes); `tests/air_law_harness.mjs`
hands them to `c_PIPitch` / `c_PIRoll`. On this airframe a +1 on PITCH
pushes the nose down: the first three runs, which pulled with `pitchUp`, flew
into the ground.

The fixture is `tests/fixtures/air_law_bf109_alamein.json.gz` with its
terrain window, built by `lab/veh_law_fixture.py` (an aircraft's states and
`aircraftSpec` table in the air harness's one-file shape; the chassis is the
drive `lab/veh_law_chassis.mjs` seats a bot in on the real level). The plane
took off at 43 m/s with no input, climbed to 109 m, rolled each way, ruddered
each way, and the push at the end turned into a dive that met the ground,
where the run ends.

Per acknowledged tick, horizontal median / worst and vertical median / worst
(mm). `acked` puts the server's position, rotation, velocity and spin back at
every ack; `delta` is the page's old correction four ticks behind, `lag` the
new one (`rewind`).

| phase | acked | delta (before) | lag (after) |
|---|---|---|---|
| takeoff (to 38 m/s) | 0.30 / 0.8, 0.18 / 2.9 | 0.37 / 2.5, 0.23 / 2.9 | 0.37 / 1.0, 0.20 / 2.9 |
| climb2 (to 109 m) | 0.34 / 1.1, 0.29 / 2.4 | 0.56 / 10.9, 0.59 / 29.5 | 0.62 / 3.2, 0.56 / 5.7 |
| bank | 0.32 / 0.6, 0.18 / 0.5 | 0.29 / 0.7, 0.28 / 0.8 | 0.39 / 1.1, 0.40 / 1.5 |
| level | 0.40 / 0.7, 0.42 / 3.9 | 0.52 / 2.2, 0.85 / 16.5 | 0.53 / 1.8, 0.91 / 11.0 |
| rudder right | 0.43 / 1.0, 1.10 / 4.1 | 1.49 / 2.7, 5.20 / 15.0 | 0.58 / 1.8, 1.81 / 4.8 |
| steady | 0.36 / 0.7, 0.18 / 0.5 | 0.33 / 0.8, 0.15 / 0.7 | 0.38 / 0.9, 0.17 / 0.6 |
| push | 0.23 / 1.1, 2.55 / 6.2 | 0.89 / 12.8, 6.04 / 57.2 | 1.04 / 3.2, 4.23 / 7.5 |
| steady2 (the dive, 60-68 m/s) | 0.37 / 1.3, 0.37 / 7.6 | 8.51 / 17.5, 31.6 / 102 | 0.64 / 1.9, 0.37 / 8.9 |

The ground runs gain too under `lag`: the Val's last deck throttle 20.9 mm
median under `delta`, 0.5 with `rewind`; the SBD taxi's release 2.3 mm
vertically, 0.9.

## The correction

`Aircraft.rewind(tickId, pose)` (`viewer/aircraft.js`), with
`viewer/drive-history.js` keeping each law tick's inputs and whole state:
the state, the ground law's accumulators, legs and sleep, the engines'
registers, the surfaces' servos, the wheel latches. It restores the kept tick,
puts the server's pose, velocity and spin there, adopts the accumulators, the
sleep flag and the first Engine's revs, load and throttle angle (`adopt`,
over the angle's limit as TANK-28 reads the wire), and runs the newer ticks
again on their own inputs and their spawner hold. The wheels' springs are
re-derived at the corrected pose on the first tick run again (`rebase`,
AIRGND-3). `net-room.js` `correctDrivenHull` already calls `rewind` on any
drive that keeps a `tickId`, so the page needed no change there.

## Open

- **The lift-off.** For the three or four ticks the wheels skip on and off
  the sand at 43 m/s, the friction the server posts flips sign each tick
  (`fr` -12, +7, -10 m/s^2) and the page's follows it at a different size,
  33 mm at the 90th percentile an ack in `pull`. It is the ground law's
  RollGrip latch on a barely loaded wheel.
- **The Corsair and the B17** have no run of their own; the Spitfire neither
  (El Alamein's Allied pad is past the escarpment from the open sand).
- A free run from the seat drifts (a plane at rest whose server root is
  asleep two ticks after the seat creeps on the page for 100 ticks, 28 mm):
  the harness seeds the sleep countdown at 100, the server's was nearly out.
