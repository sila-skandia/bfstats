# Aircraft flight law: the plane in the air against the server, per tick

Status: **measured and built** 2026-10-25. The page's `Aircraft` flies the
lab Bf109 within half a millimetre of the dedicated server an acknowledged
tick through a climb, rolls, rudder and a push (AIRGND-7), so the in-flight
law needed no change. Its correction did: the page took an aircraft's
correction through the delta reconciler, which in a dive ran 8.5 mm median
and 31 mm vertically an ack off. `Aircraft.rewind` now takes the server's
state at the acked tick and runs the ticks since again, as the tank does
(TANK-25, AIRGND-8), and the same dive holds 0.6 mm.

The lift-off's 57 mm (105 mm under the page's correction) was the wheel
meeting the page's bilinear floor instead of the engine's triangles; with
that fixed every lift-off and touchdown in three lab runs, two airframes,
holds to a millimetre an ack ("The lift-off", AIRGND-9).

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

## The lift-off (2026-10-25)

The 57 mm at the lift-off was not the RollGrip latch. **The wheel met the
wrong ground.** `aircraft-ground-law.js` `groundAt` took the engine's
triangles (TERR-16) and then the drive's `groundHeight` over them whenever
that stood more than a millimetre higher, to catch a deck. Off a deck,
`groundHeight` is the page's own bilinear read of the lattice
(`Heightfield.height`, through `bedGroundHeight` on the live page and
`collider.surfaceHeight` in the harness), and on a cell that bulges the
bilinear patch stands centimetres over both of the engine's triangles. On
Wake's pad the two agree; on El Alamein's sand at 43 m/s, with the wheels
sunk 0.2-0.5 m as the Bf109 bounced, they did not (AIRGND-9).

How it was shown: `lab/air_contact_check.mjs` puts the server's own pose and
velocity back at each acked tick and runs the page's collision pass there,
against the friction the server posted at that tick. At serial 3189 the
page's `fr` was (-12.15, 1.43, 3.92) m/s^2 against the server's
(-15.08, 1.49, 4.93); its wheel push at 3188 was 0.429 m where the
triangles give 0.408. Taking the terrain from the triangles alone, the pass
matches the server's `fr`, rolling resistance and friction moment to the
wire's precision at every contact of every lift-off and touchdown in the
three runs below (3189: -15.076 against -15.075), with the latch the page
already ran. The same tool's other half runs one tick from the server's
state with each spring's push and `Dprev` at the server's own two poses: the
velocity it ends at is the server's within 0.05-0.4 m/s^2 with the wheels
loaded, so the springs, the damper and the latch were right throughout.

The fix: `groundAt` takes a surface from `groundHeight` only when it stands
over the bilinear floor as well, which a deck (the ship's col0 faces, a
drivable static) does and the terrain itself never does. The decks' runs
(the Val and the Zero on the Shokaku) are unchanged to the hundredth of a
millimetre.

A second lab run was made for touchdowns (vanilla El Alamein co-op, no
bots, a private lab on port 14818, 2026-10-25): the other Axis Bf109's
takeoff roll skips off the sand and back onto it seven times between 26 and
51 m/s, touching down at up to 2.9 m/s, before a six-tick pull lifts it off
(`tests/fixtures/air_law_bf109_alamein_hops.json.gz`). The air harness now
scores the acks round each change of contact as `@liftoff` and `@touchdown`
(two ticks before the first acked state whose friction accumulator emptied
or filled again, to four after). Horizontal / vertical worst, mm, before ->
after, `acked` and `lag` (the page's own correction four ticks late):

| run | at | acked | lag |
|---|---|---|---|
| Bf109 pull | @liftoff | 57.2 / 14.1 -> 1.0 / 0.7 | 105.6 / 33.9 -> 2.3 / 1.7 |
| Bf109 pull | @touchdown | 0.5 / 2.9 -> 0.5 / 2.9 | 0.4 / 2.9 -> 0.4 / 2.9 |
| Bf109 hops | @liftoff | 0.6 / 3.5 -> 0.8 / 5.4 | 5.9 / 13.4 -> 6.7 / 11.3 |
| Bf109 hops | @touchdown | 0.7 / 3.7 -> 0.7 / 3.9 | 3.3 / 9.9 -> 7.1 / 9.7 |
| SBD takeoff (Wake) | @liftoff | 2.7 / 3.0 -> 0.6 / 0.7 | 5.3 / 7.0 -> 0.6 / 0.5 |
| SBD takeoff (Wake) | @touchdown | 2.0 / 6.0 -> 0.5 / 0.2 | 2.3 / 13.7 -> 0.6 / 0.3 |

Medians are 0.2-0.5 mm in every row after. The hops run's whole takeoff
roll went from 15.7 / 65.9 to 0.7 / 2.9 acked (21.3 / 65.9 to 1.0 / 2.9
under `lag`): its worst ack was a wheel loaded on a bulging cell, not a
change of contact. The same fix closes the SBD's rudder-coast residual on
Wake that `aircraft-ground-law` had left open (2.0 mm median, 9.9 worst
vertically, now 0.19 and 0.5).

What is left round the hops is in the air: the ticks over 2.5 mm in the
hops run's climb, float and glide have no wheel down, the pass matching the
server's empty accumulators, and the one-tick residual there is 1.4-1.9
m/s^2 vertically. That is the lift regulators: their servo integrates its
command and dithers by up to 1.3 degrees a tick near 45 m/s, and their angle
is never on the wire (`features/udp-sidecar/decodes/vehicle-children.md`
6.1, the regulator pair's `R` never set), so the page's dither runs at its
own phase. The same term sets the in-flight worst under `lag` (rudder right
4.8 mm before this change and 13.5 after, the two runs' regulators 0.1-0.25
degrees apart with no wheel down).

## Open

- **The lift regulators' hidden angle**, above. Not on the wire; the
  server's would have to be inferred from its accelerations.
- **The Corsair and the B17** have no run of their own; the Spitfire neither
  (El Alamein's Allied pad is past the escarpment from the open sand).
- A free run from the seat drifts (a plane at rest whose server root is
  asleep two ticks after the seat creeps on the page for 100 ticks, 28 mm):
  the harness seeds the sleep countdown at 100, the server's was nearly out.
