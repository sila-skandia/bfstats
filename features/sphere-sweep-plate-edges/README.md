# Swept sphere: plate edges met along the plane

2026-09-26. `viewer/static-index.js` `CollisionIndex.#sweepTriangle`, and the bots'
stall input in `viewer/bot-route.js`.

## The bug

`#sweepTriangle` returned before its edge and corner tests whenever the sphere was
not closing on the triangle's plane (`nv >= -1e-9`). A sphere moving parallel to a
face, or away from it, therefore never met that triangle's edges, even inside the
face's slab (`sd < radius`) with its centre off the face. A soldier capsule walking
level into the edge of a thin, near-flat plate slid under or through it.

Seen in the seeded runner (Wake, seed 1, 8 a side): bot_12 left a beached Daihatsu at
t=198 s and by t=203 was wedged under the lowered ramp `DaihatsuLanding1` at
(1165.08, 95.58, -702.5) until the no-progress redeploy at t=214.8. Three more
spells at that spot in the same match (bot_2, bot_6, bot_12 again), all with the
stall counter at 0.

The stall counter stayed at 0 because `execInfantryMoveTo` fed `trackObstruction`
`soldier.speed`, the body's velocity. A grounded tick re-sets the velocity to the
command, so a held body read a full run.

## The fix

In `#sweepTriangle`:

- Not closing on the plane and outside the slab: no contact (as before; nothing on
  the triangle is within reach).
- Not closing, inside the slab, centre over the face: embedded, let go (as before).
- Not closing, inside the slab, centre off the face: fall through to the edge and
  corner tests (new). This is the plate-edge case.
- An edge or corner the sphere already overlaps is never a contact, in either
  branch. For an overlapped feature `lowestRoot` returns the far-side root, the
  moment the sphere comes out, which the old code reported as a contact. Stopping at
  `t = 0` while closing is no better: a body caught inside a parked jeep closes on
  some edge in every heading and freezes (the first version did that; the walk
  sweep below found it).
- In the new branch, seams are skipped: `markInternalEdges` flags, at index build,
  each edge shared with a triangle of the same owner and sub-part lying across it
  within about 10 degrees of the same plane. A sphere sunk into a wall or a floor
  meets those seams edge-on as it slides. Without the filter they were two thirds of
  the new contacts (8,356 of 12,486 divergent sweep calls on Wake).
- In the new branch, a border contact reached with the centre over the face at the
  contact time is dropped: that is a sphere that slid in across a seam reaching the
  surface's far rim from inside.

In `soldier.js` / `bot-route.js`: `Soldier.travelSpeed` is the horizontal ground the
last ticked frame covered over its time, and the infantry stall test reads it.
`soldier.speed` (the HUD's integrator number) is unchanged.

## Verification

Before = HEAD `fd3ca777`, after = this change; same assets.

| check | before | after |
|---|---|---|
| unit plates: level into a flat plate's edge, a tilted plate's side edge | no contact | contact at 1.7172 |
| Wake seed 1 runner, stuck-on-foot spells at the ramp (1165, -702) | 4 | 0 |
| node walk sweep, Wake (1,592 walks at real triangles): walks crossing a surface | 28 | 27 |
| same, Berlin (1,556 walks) | 74 | 75 |
| walks identical before/after (Wake / Berlin) | | 1,526 / 1,457 |
| stair and ramp climbs (> 1 m up) ending in the same place (Wake / Berlin) | | 97/99, 66/75 |
| page (Playwright via :5273), 8 walks each on Wake and Berlin | | match the node sweep |
| page ladders on Wake (4 ladders, both sides) | | identical |
| Tiger across two Bocage bridges both ways on the hull sweep | crosses | crosses, identical path |
| scripted beached Daihatsu (`sim_vehicles_harness` beach recipe), 144 walks at the ramp ending under it | 28 | 22 |

The walks that shortened were read one by one: a parked Willy's flat bed at knee
height, an AA gun's shield, Berlin ruin and rubble slabs at head height, door jambs
of single-plane hut walls. Each is a real edge the old sweep let a sphere through.

## Not fixed

- The beached-ramp wedge is reduced, not gone. The remaining path: a soldier's
  middle sphere meets the ramp's side edge from a few centimetres above the plate,
  the contact normal tilts up as the beach rises under his feet, `grounded` drops,
  the lowest sphere shifts down 0.225 m, and the response carries him over the edge
  until his middle sphere rests on the ramp's top face with the plate between it and
  his lowest sphere. That is `resolveMove` climbing an edge at waist height plus the
  unswept vertical moves (terrain clamp, capsule offsets), not the sweep; HEAD reaches
  the same straddle with no contact at all.
- The approaching branch (`nv < 0`) still tests seams; unchanged from before.
- Wake stuck-on-foot totals over seeds 1-4 are noisy (matches diverge within seconds);
  the Hatsuzuki deck spots (644.9, -1442.2) and (653.7, -1455.8) are stuck in both.
  The stall counter now reaches the obstruction count on them, which it never did.

## Tests

- `tests/test_physics.py`: `test_a_level_sweep_meets_the_edge_of_an_open_plate`,
  `test_an_edge_the_sphere_already_overlaps_lets_it_go`,
  `test_a_seam_inside_a_flat_wall_is_not_an_edge`,
  `test_a_body_stops_at_the_edge_of_a_plate_it_walks_level_into`.
- `tests/test_bot_ai.py`: `test_a_wedged_body_stalls_even_while_its_velocity_reads_a_run`.
- `tests/test_soldier.py`: `test_the_ground_covered_is_kept_beside_the_speed`.
