# Car ground law: the server's per-tick drive for a wheeled car, on the page

Status: **built** 2026-10-25. A `c_ETCar` hull (the Willys, the Kubelwagen and
every car whose wheels are springs) is driven on the page by
`viewer/tracked-vehicle.js`, the same per-tick law the tank port measured
(ledger TANK-18..TANK-27, PHY-33), instead of `viewer/wheeled-vehicle.js`'s
own 60 Hz model. A correction now takes the Engine's throttle angle at its
own scale (TANK-28). Measured against the lab server on El Alamein: 0.4-1.3 mm
median an ack under the page's own reconciler a round trip late, through four
gear changes and both turns.

## Why

The tank port left the wheeled cars on `GroundVehicle`: 60 Hz sub-steps, ray
springs, a fitted roll damper and a static hold, because Wake's co-op layer
has no car to measure (`features/tank-ground-law`, "Open"). The engine runs
one law for every land hull on springs (PHY-33: same class, same path; a car's
Engine differs only in its load mean, `c_ETCar` taking the running mean where
a tank takes the max, TANK-13, and in its steered `c_PGFRollGrip` fronts).
`TrackedVehicle` already carried both for the M3A1 half-track.

## How it was checked

`lab/veh_law_probe.mjs` drove a sidecar player's car on vanilla El Alamein
co-op with no bots (a private lab on port 14738) at an even 30 Hz. Two things
were added to the probe for it: `NEAR=x,z` picks the hull nearest a point, and
`HEADING=deg` (`TURN`, `ORIENT_SPEED`) first crawls the hull round onto open
ground, logged as phase `orient`, which the fixture leaves out. The level's
statics are not in the harness, so the runs were aimed where the glb's placed
objects and the heightmap leave the longest clear, flat line
(`lab/veh_law_fixture.py` builds the three fixtures from a probe log: whole
states carried forward field by field, the terrain window with the level's
material tables, and the chassis the page builds on the real level).

| run | fixture | where |
|---|---|---|
| Kubelwagen | `tests/fixtures/vehicle_law_kubelwagen*` | Axis base, heading 352 on flat sand; met a static at the end of its left turn |
| Willys | `tests/fixtures/vehicle_law_willy*` | the airfield; its turns ran up the escarpment and onto an object |

Per ack, horizontal median / worst (mm), vertical worst, under the page's
own reconciler four ticks behind (`tests/vehicle_law_harness.mjs` `lag`, the
`rewind` path). Before = `GroundVehicle` on the same words.

| hull, phase | before | after |
|---|---|---|
| Kubelwagen idle | 0.4 / 1.0 | 0.4 / 0.8, vertical 1.5 |
| Kubelwagen throttle (gears 1-4, to 19 m/s) | 4.7 / 89, vertical 39, 18 gear misses | 0.4 / 5.0, vertical 1.2, none |
| Kubelwagen throttle+right | 21 / 50, vertical 41 | 0.8 / 1.5, vertical 2.1 |
| Kubelwagen throttle+left | 37 / 119, vertical 78 | 1.3 / 10, vertical 7.6 |
| Kubelwagen brake/reverse | 9.0 / 28, vertical 68 | 1.0 / 2.6, vertical 4.4 |
| Willys throttle | 5.5 / 66, vertical 40 | 0.4 / 3.1, vertical 2.2 |
| Willys brake/reverse | 4.9 / 25 | 0.8 / 4.3 |
| Willys throttle2 | 4.9 / 10 | 0.4 / 1.7 |

Uncorrected from the first ack, `GroundVehicle` rolled the Kubelwagen over
(up.y -0.22) where the server's stayed level (0.987).

## TANK-28: the Engine's angles on the wire

With `TrackedVehicle` on the Willys the `lag` replay still ran 20 mm behind the
server in the throttle phase while `acked` (pose and velocity only) held
0.5 mm. `EngineNetworkable::getNetUpdate` (lnxded `0x082279d0`) writes the
Engine's two bundle angles with `writeSignedFloat(angle, 16, 1.25 * L)`, `L`
the larger magnitude of the axis's component of the template's `maxRotation`
(the virtual getter, `EngineTemplate::getMaxRotation` `0x0823fd50` reading
`+0x15c`) and of the vector just before it (`+0x150`/`+0x158`, the minimum by
its place): `0x08227a4e`-`0x08227a71` keep the larger, `0x08227cb0`
multiplies by the double 1.25 at `0x86ce6a8`, so the wire carries the angle over its limit, and full throttle
reads 0.8 on every hull (the lab Willys: 366 states at +0.8, 246 at -0.8). The
page's `adopt` multiplied by 1.25 only: right for a Sherman, whose limit is 1,
and a Willys's throttle angle of 5000 came back as 1 at every correction, so
its rev filter saw no throttle for the 0.1 s the servo took to ramp back. A
car's yaw has no limit (`maxRotation.x` 0) and writes -1 always; it is left
alone. Fixed in `TrackedVehicle.adopt` and the harness's seed.

## Open

- The turns into statics. Neither lab run kept clear of objects through
  every phase; the harness has no statics, so contacts are not scored.
- Free runs drift: the friction latch flips on a tick the server's did not,
  1 cm and growing. The reconciler's corrections close it (`lag`).
- Other `c_ETCar` templates (DC's and the other mods' cars) share the class
  and were not run. Their chassis are read off the tree the same way. What
  backs them is PHY-33's reading (the spring and friction path tests the
  node's class, never `getEngineType`) and TANK-13's load mean, which
  `EngineState` already keyed on the engine type; the measurement is two
  vanilla cars on flat sand.
- Where it lands: `vehicle-occupancy.js` `ensureDrive` builds every drive
  the page makes, so this is not the sidecar's alone. Every `VCLand` hull
  with a `c_ETCar` and no `c_ETTank` (cars, trucks, jeeps, motorcycles,
  XPack2's Schwimmwagen on land) now drives by `TrackedVehicle` in solo play
  and under bots (`map.html` `classes`), and a replayed one presents its
  wheels through `TrackedVehicle.presentKinematic`. Its spec fallbacks are
  `TANK`'s, not `WILLYS`'s: drawn wheel lift caps at 0.35 m (0.30), and a
  steering bundle with no declared span locks at 40 degrees (30).
