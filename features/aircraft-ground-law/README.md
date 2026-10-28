# Aircraft ground law: the server's per-tick undercarriage, on the page

Status: **built** 2026-10-23 for the SBD, the Aichi Val and the Zero (and, by
the same table, every fixed-wing airframe whose wheels are springs).
`viewer/aircraft-ground-law.js` stands a plane on its three `Spring` wheels as
the dedicated server does, and `viewer/aircraft.js` runs its root on the
server's one Euler step a 30 Hz tick, in the air as on the ground. Measured
against the lab server per acknowledged tick: 0.3-0.8 mm horizontal median on
the ground, where the page was half a metre off vertically before, and the
wings' unauthored lift now takes the engine's defaults. Open: the Corsair's own
run, a moving deck (the rudder-coast residual closed 2026-10-25, AIRGND-9). 2026-10-28: a driven plane's hull
meets the terrain (AIRGND-12), and FHSWEurope's A6M2b chattering on its springs
is measured as retail's own (AIRGND-11).

## Why

A browser player taxiing an aircraft through the UDP sidecar predicts his own
airframe, and the hull reconciler closes the error at every ack. The page's
aircraft stood on a ride-height clamp: its origin held `groundClearance`
(1.72 m for the SBD, the lowest wheel mesh's bottom) over the heightfield,
levelled by a fitted slerp (`Aircraft.settle`) and steered by a per-step
friction on the vertical axis only (`groundFriction`). The server's SBD sits
1.23 m over the terrain on springs compressed 0.10-0.16 m, so every ack on the
ground corrected the page by 0.43-0.54 m vertically and by up to 12 mm
horizontally: the bumpy taxi and rudder the owner reported, masked since by
the correction blend.

The note in `features/udp-sidecar/README.md` that "the runway is a static
object about 1.2 m above the heightmap" was a misreading of that 1.2 m: on
Wake the SBD's pad and roll are on the terrain itself. Inverting the server's
own acceleration at the pad gives each wheel's spring compression
(0.155 / 0.156 / 0.098 m) within 3 mm of the col0 vertices' depth in the
heightmap. The Japanese planes stand on the Shokaku's deck, which is an object
contact (below).

## The law

One server tick, in the server's order (TANK-18 for the shape, AIRGND-1..5):

1. The handleUpdate phase: each Engine (`Engine::handleUpdate`), each Wing's
   servo, the tail wheel's steering bundle (`calculateAndClipAngle` under
   `setAutomaticReset 1`: +-25 degrees at 150 deg/s on the SBD, +-20 at 110 on
   the Zero, the Val and the Corsair).
2. The springs: `-(1.49995 k D + c (D - Dprev) 30)` at each anchor, `k` 24,
   `c` 12 on every vanilla plane, `D` the push the last collision pass left,
   the wheel snapped back to rest (TANK-19; `PhysicsSpring::updatePhysics`
   0x0824ddd0, the 1.49995 being `getGravity() * -0.101833`). A steered tail
   wheel's anchor and vertex are turned with its bundle.
3. The wings, the engine and the box drag as the page already ran them, into
   the same accumulators; the root's sleep and one Euler step (TANK-21,
   TANK-22): `v += acc dt`, `v += fr dt`, `x += v dt`, omega from the torques
   over the box/3 inertia, the rows turned about omega.
4. The collision pass: each awake wheel's col0 vertex 0 against the terrain's
   triangles (TERR-16) or the deck's col0 faces, pushed out along the normal
   by at most 1 m (TANK-20), and `addFriction`'s arm for the wheel's live grip
   byte: `c_PGFRollGripWhenOccupied` is RollGrip with a pilot aboard
   (`PhysicsSpring::updatePhysics` writes 10) and ContactGrip without (9).
   RollGrip asks back only the contact's speed along the wheel's row 0 (its
   axle, turned by the steering bundle) laid in the contact plane, clamped by
   the static latch (PHY-2), posted as the mean of every contact into the next
   tick's `fr` / `rfr` (`addFriction` 0x0825b6e0, the `& 2` branch). Rolling
   resistance `acc += -res Vt` with the wheel's material 37, which vanilla
   never defines, so material 0's **0.02** (TANK-26's rule).

`Aircraft.groundLaw` holds the root's accumulators and sleep between ticks
and each wheel's push, `Dprev`, latch and steering servo. `integrate(dt)` runs
whole 1/30 s ticks off an accumulator.

### Corrections

The wire carries no spring state for an aircraft (the SBD's children are its
wings, its engine and its guns). With the plane's damper (`c` 12, 360 m/s^2
per metre of `D - Dprev`, three times a tank's), a correction that moves the
hull but leaves the springs where the page's own prediction put them turns a
millimetre into a kick the next correction answers larger: the acked replay
diverged by half a metre within a second. `rebase` re-derives the hidden
state from the corrected state whenever the hull has been moved between
ticks: the push from the ground at the corrected pose, `Dprev` from the pose
one tick before, which the root's step makes exactly `pos - v dt` turned back
by `omega dt`, and the collision pass's friction and resistance again from the
latches it started with.

### Decks

A plane on a carrier meets the ship object against object: its col0 wheel
vertices against the ship's col0 faces, since its root's bounding radius is
over 4 m (COL-6). The level's statics index carries a ship's col1 hull, which
on the Shokaku's flight deck stands 9-12 mm above her col0. `hull-bodies.js`
`aircraftLawOnShipDecks` hands a law-driven aircraft the ship's col0 deck
(`col0DeckAt`, from `collision-meshes.json` by the ship's live pose), its face
normal, and the deck material's own friction and resistance (materials 59/66:
1.0 and the `Material` default 0.01), with no `hullLift`. A deck plane its
spawner still holds runs its engines and no physics (`drive.held`, set by
`holdSpawnedCraft`), and stands on its wheels fresh when the revs reach 0.1
and it is let go; the server's Val and Zero hover 0.16 m over the deck until
then and drop onto it.

## How it was checked

`lab/veh_law_probe.mjs` (KIND=plane; `TEAM`, `WAYPOINTS`, `HOSTS`, `USE_AT`
added for this) drove a sidecar player's aircraft on vanilla Wake through
scripted words at an even 30 Hz (2026-10-22/23). The control states,
re-decoded whole from the raw hex, the words and each airframe's
`aircraftSpec` table are the fixtures `tests/fixtures/air_law_{sbd,val,zero}_wake.json.gz`
(the deck runs carry the Shokaku's col0 faces at the server's pose of her),
with the terrain windows `air_law_*_terrain.json.gz`.
`tests/air_law_harness.mjs` replays the words through the page's own
`Aircraft`; `tests/test_air_law.py` holds it.

Per acknowledged tick, the server's position, rotation, velocity and omega put
back at every ack (`acked`), against the page before (`clamp`), in mm,
median / p90 / max:

| run | phase | horizontal, law | vertical, law | horizontal, before | vertical, before |
|---|---|---|---|---|---|
| SBD takeoff | idle | 0.34 / 0.57 / 0.71 | 0.24 / 0.66 / 0.67 | 0.44 / 0.60 / 0.97 | 534 / 540 / 541 |
| SBD takeoff | throttle to 33 m/s | 0.37 / 1.08 / 5.36 | 0.37 / 2.25 / 11.4 | 1.55 / 5.81 / 12.1 | 428 / 540 / 541 |
| SBD takeoff | release, lifting off at 36 m/s | 0.35 / 0.69 / 2.75 | 0.23 / 0.65 / 1.81 | 0.55 / 6.92 / 8.22 | 2.1 / 67 / 83 |
| SBD taxi | throttle | 0.35 / 0.59 / 4.62 | 0.36 / 0.89 / 6.19 | 0.60 / 2.34 / 6.62 | 537 / 540 / 541 |
| SBD taxi | right rudder, coasting | 0.54 / 1.64 / 4.16 | 1.97 / 7.36 / 9.91 | 6.54 / 9.40 / 9.71 | 474 / 505 / 516 |
| SBD taxi | left rudder, coasting | 0.26 / 0.59 / 3.97 | 0.34 / 0.79 / 12.9 | 7.93 / 9.78 / 12.9 | 459 / 475 / 477 |
| SBD taxi | throttle + left | 0.28 / 0.46 / 0.68 | 0.23 / 0.50 / 0.62 | 3.13 / 7.57 / 7.81 | 488 / 491 / 491 |
| Val deck | held | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 225 / 225 / 225 |
| Val deck | throttle | 0.27 / 0.51 / 0.88 | 0.23 / 0.57 / 16.2 | 0.30 / 0.59 / 0.82 | 413 / 432 / 432 |
| Val deck | throttle + right | 0.58 / 1.24 / 1.66 | 0.25 / 0.55 / 0.61 | 2.99 / 4.75 / 5.13 | 420 / 427 / 428 |
| Val deck | throttle + left | 0.59 / 1.78 / 7.69 | 0.22 / 0.50 / 0.54 | 4.76 / 7.59 / 12.5 | 374 / 396 / 400 |
| Val deck | throttle, to the deck's edge | 0.33 / 0.48 / 0.56 | 0.16 / 0.42 / 1.57 | 1.11 / 3.42 / 6.24 | 231 / 293 / 310 |
| Zero deck | throttle | 0.26 / 0.56 / 0.85 | 0.16 / 0.44 / 16.2 | 0.29 / 0.66 / 1.65 | 356 / 376 / 376 |
| Zero deck | throttle + right | 0.50 / 1.02 / 1.39 | 0.23 / 0.54 / 0.59 | 2.79 / 4.35 / 7.40 | 362 / 369 / 371 |
| Zero deck | throttle + left | 1.15 / 2.02 / 2.02 | 0.21 / 0.39 / 0.39 | 6.68 / 10.1 / 10.1 | 332 / 338 / 338 |

### The wings' defaults

Above about 8 m/s the regulator flaps start carrying weight, and the first
port still missed the server there by 1-4 mm vertically a tick; in the air
off Wake's cliff (38-41 m/s, no input) the page made 1.6 m/s^2 more lift along
the body's up and 0.3 m/s^2 more drag along the nose, with no torque
difference. The page read an unauthored `setWingLift` and `setFlapLift` as 0;
`WingTemplate`'s constructor makes them 1.0 and 0.1 (AIRGND-6), and every
vanilla lift regulator omits `setWingLift`. The SBD's flaps are therefore a
coefficient of 4.5 (not 3.0) of which two thirds moves, and its airbrake 7.5
(not 6.0) of which 0.8 moves. With the engine's defaults the in-air residual
is 0.00 +- 0.02 m/s^2 and the takeoff roll's vertical error falls to the
table's (the airborne `brake` and `idle2` phases of the takeoff log: 2.5 to
0.2 mm median). A Wing the export carries no physics block for at all (DC's
one-sided `AV8Aileron_R`) is left inert, as before.

The steering bundle's sign and servo are what the rudder phases show: with
the tail wheel unsteered or steered the other way the same phases miss by
10-20 mm a tick. The 16 mm worst on a deck is the release tick (the spawner's
hold and the server's let go a tick apart).

## Open

In flight and the correction a round trip late: [aircraft-flight-law](../aircraft-flight-law/README.md)
(2026-10-25, AIRGND-7, AIRGND-8).

- ~~Rudder while coasting at 8-10 m/s.~~ Closed 2026-10-25 (AIRGND-9): the
  2 mm median, 10 mm worst vertically was the wheel meeting the page's
  bilinear floor where it stood over the engine's triangles; the SBD's
  coast now holds 0.19 mm median, 0.5 worst
  ([aircraft-flight-law](../aircraft-flight-law/README.md), "The lift-off").
- **The other `?? 0` wing defaults**: `amphibious.js`, `ship-spec.js`,
  `rocket-motor.js` and `torpedo-run.js` read unauthored lift as 0 too
  (vanilla's `Torpedo_Wing`, `Bomb_wing`, `Shallow_Torpedo_Wing` and
  `B17_Body_Wing` omit `setFlapLift`), and the hand-written `CORSAIR` table
  gives its regulators 0/4 where the engine's are 1/2. PHY-26's level-trim
  difference is likely the same defect and wants measuring again.
- **A moving deck.** The contact speed is the plane's own; on a ship under
  way the engine's is relative to the deck (`getTangentSpeed` of both).
- **The Corsair**, the same law and table shape, has no lab run of its own
  yet: the lab's probe could not reach Wake's (on the pad, past a farmhouse
  on the plateau's edge) before the round turned.
- Collisions with statics and other hulls on the ground are not in the law
  (the lab SBD's taxi run hit one and is cut there).
- **The A6M2b's creep.** Parked, the page's FHSWEurope A6M2b chatters as the
  server's does (AIRGND-11) but turns 1 degree in 4.5 minutes where the
  server's turned 22 (2026-10-28 below).

## The hull meets the ground, and the A6M2b's chatter is retail (2026-10-28)

Two follow-ups to fhsweurope-extraction's "Wake's A6M2b wrecked 8 s after
boarding" (2628ca8b).

**A plane that never sleeps on its springs** (AIRGND-11). FHSWEurope's
`A6M2b` flips its vertical speed about +-0.4 m/s every tick on its wheels,
parked and with a pilot, where the F4F-3 on the same Wake pad sleeps at 4 s.
Both stand on the same three springs (k 24, c 12, RollGripWhenOccupied).
The difference is the pitch inertia: the A6M2b authors `inertiaModifier
0.4/0.6/1` (COL-13: the first divides pitch) over a box 2.47 x 8.72 m in
y and z, the F4F-3 0.76 over 3.09 x 8.99. The damper's
`c (D - Dprev) 30` couples heave and pitch through the tail wheel 5.9 m aft;
that mode's gain a tick comes out about 1.8 for the A6M2b against 1.2 for
the F4F-3, close enough to the explicit step's limit of 2 that each tick
over-corrects the last. Halving the damping, or any modifier from 0.76 up,
puts the page's A6M2b to sleep in 4 s (`surveys`, not kept).

Retail does the same. The lab ran fht_pasir_panjang-1942 Conquest with no
bots (`lab/scenarios/fhsweurope-pasir_panjang-cq-zero.json`) and
`lab/veh_law_probe.mjs` (`HOSTS=A6M2b`) watched the axis base's parked
A6M2b for 4.5 minutes: a ghost state every tick or two throughout, the
height flipping by 14 mm, a creep of 2.9 m and 22 degrees of heading. The
page's body law from the same spawner's pose rests within 3 cm of the
server's height and chatters the same way; it creeps 1.8 m and 1 degree in
the same time. So the chatter stays. The load settle already takes such a
hull at rest by its net movement over a second (2628ca8b). Guards:
`tests/test_vehicle_bodies.py`
`test_a_parked_a6m2b_chatters_on_its_springs_and_an_f4f3_sleeps` (the page
law, synthetic airframes with both planes' numbers) and
`test_the_lab_servers_parked_a6m2b_never_rests`
(`tests/fixtures/zero_chatter_pasir.json.gz`).

**The hull's own terrain contact** (AIRGND-12). The aircraft drive had the
damage half of `checkVsTerrain` alone (`BodyWorld.#drivenTerrainDamage`): a
plane boarded with its fuselage in the ground was lifted by its springs at
3 m/s with its col0 vertices still under the terrain, and billed for the
scrape. Nothing in the server's collision pass asks whether a seat is
taken, so a driven plane's hull is pushed out as a pad's is (SPAWN-28):
each mobile part's push-out moves the root at once, the closing speed
comes off through the next root step's accumulators (COL-9), its
ContactGrip friction is one more sample in the wheels' mean, and the
damage call is made in the same pass. Built: `body-world.js`
`#drivenTerrain` runs `terrainContact` for a drive with `hullPushOut`;
`aircraft.js` answers it (`hullPushOut` while the law's root is awake and
no spawner holds it; `onHullPushed` moves the law's last collision pose
with the hull, so `rebase` does not read the push as a correction, and
takes the hull's push off each wheel's as COL-21's Spring branch does;
`takeContactAcceleration`; `hullFriction` through `body-friction.js`
`addFriction`). A plane handed to its drive with its col0 vertices in the
ground is first stood out of it at rest (`BodyWorld.standDrivenOut`, from
`hull-bodies.js` `adoptDrivenBody`): in retail the pass would have lifted it
the tick after its spawner placed it, and without this the drive's first
tick sprang it up on its springs before the body world's pass. A falling
wreck is left out (`fallingWreck`): it comes down under the wreck list's own
fall and crashes at its ride height, and held up on its wings it tumbled for
seconds (`test_sim_vehicles` Bocage Bf109, 8.5 s against 4). `DrivenBody`
now reads and writes an aircraft's spin in the world frame (`spinIsWorld`),
which it has always been; it treated it as body rates. A ship keeps the old
reading (`Ship.spinIsWorld` false): Wake's LCVP beach landing
(`test_sim_vehicles`) no longer reached its zone in the world frame, and her
contact response wants its own measured change. Guards in `tests/test_vehicle_bodies.py`
(`an_aircraft_on_the_ground_law_*`,
`a_driven_aircraft_spin_is_read_and_written_in_the_world_frame`).

