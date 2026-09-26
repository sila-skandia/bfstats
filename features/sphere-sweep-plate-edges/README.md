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

- The beached-ramp wedge is reduced, not gone. Fixed in the follow-up below
  ("The straddle"); 22 of 144 to 0.
- The approaching branch (`nv < 0`) still tests seams; unchanged from before.
- Wake stuck-on-foot totals over seeds 1-4 are noisy (matches diverge within seconds);
  the Hatsuzuki deck spots (644.9, -1442.2) and (653.7, -1455.8) are stuck in both.
  The stall counter now reaches the obstruction count on them, which it never did.

## The straddle (follow-up, 2026-09-27)

`viewer/static-index.js` (`shell`), `viewer/world-collider.js`,
`viewer/soldier-resolve.js`.

### What it was

Traced walk by walk against the beach recipe (`sim_vehicles_harness.mjs`, Wake
seed 7, 144 walks at `DaihatsuLanding2_1`). The 22 were not one path:

- Waist launch: the middle sphere met the ramp's side edge a few centimetres above
  the plate with ny 0.61. That is `>= MAX_GROUND_SLOPE`, so it counted as floor,
  was not flattened, and the velocity strip threw him up at 2.45 m/s.
- Slide along the edge: grounded, pressed against the ramp's angled side edge
  with the edge between his lowest and middle spheres. Stripping against the
  flattened wall normal left the move's small vertical part closing on the edge
  itself; the middle sphere ended tangent, then a hair inside, and from then on
  `#sweepTriangle` let go of that edge on every sweep. The overlap grew from
  1 cm to 29 cm as he slid on.
- Head under the plate: the beach rising under a run lifted him 3-4 cm a tick
  through the terrain clamp, unswept, into the underside of the bow and ramp.
  Once inside, let go, and he walked on underneath.

All three end the same way: something puts a sphere a little way into an edge,
and the let-go-on-overlap rule makes the edge transparent for good.

### The fix

- `CollisionIndex.sweepSphere(..., shell)`: an edge or corner a sphere is no more
  than `shell` into is still met, at `t = 0`, by a move that closes on it; moving
  away or along it is free, and seams are never met this way. A sphere buried
  deeper than three shells in anything at all drops every graze (a body spawned
  into a hut wall is otherwise held there by the wall's far edges). The hit
  carries `depth`, how far the `t = 0` contact already is into the sphere. Default
  0, so vehicles and rounds are unchanged; the soldier passes `EDGE_SHELL`, 2 cm.
- `resolveMove`: after stripping against a flattened wall normal, what is left is
  stripped against the contact's own normal too. After the flat strip that can
  only shrink the vertical part (by ny^2 of it), never make a climb.
- `settleFeet`: a lift onto higher ground is swept with the top sphere (headroom).
  If it would put the head more than the shell into something facing down
  (ny < -0.25), the step is refused, as `refuseSteepGround` refuses a cliff. A
  head already deeper than the shell is not held there. The ground lookup moved
  into `groundUnder` so it can be redone at the refused position.

### Candidates measured and not taken

| variant | under the ramp (of 144) |
|---|---|
| HEAD | 22 |
| capsule normals (side spheres' contacts laid flat, floor only from the bottom cap) | 25 |
| swept vertical follow alone | 3 |
| shell alone (with the second strip) | 4 |
| shell + second strip + headroom (shipped) | **0** |

- Capsule normals fix the waist launch but alone make the straddle worse, and on
  top of the shipped fix they added snags (Wake 13 to 23, Berlin 29 to 43 walks cut
  short) while stopping soldiers mounting waist-high rubble by walking into it.
  A gameplay change, left out.
- A swept vertical follow in both directions (refuse the step if lift or glue
  would push any sphere into a hull) froze 73 Wake and 132 Berlin walks: bodies
  already embedded at spawn, knees in the step zone against a parked Willy's,
  near-vertical walls. Only the upward, top-sphere half survived, as headroom.

### Verification

Before = `558a12c2`, after = this change.

| check | before | after |
|---|---|---|
| beach recipe, 144 walks ending under an active `DaihatsuLanding*` | 22 | 0 |
| walk sweep, walks crossing a surface, Wake / Berlin | 27 / 75 | 25 / 78 |
| walk sweep, walks cut short that did not cross, Wake / Berlin | | 13 / 28 |
| stair and ramp climbs > 1 m ending in the same place, Wake / Berlin | | 95/98, 56/78 |
| jumps onto crates, barrels, sandbags, ammo boxes, bunkers (low tops, 4 sides), Wake / Berlin | 65/67, 61/61 on top | 64/67, 61/61 |
| Wake ladders, 47 climbs from both sides, reaching the top | 34 | 35 |

The cut-short walks were replayed and the torso and head spheres' depth into the
level measured along the way. On Wake 8 of the 13, on Berlin 17 of the 28, HEAD
pushed a torso or head sphere more than 3 cm into geometry where the fix stops
at the surface; 1 and 3 start already embedded (the walk sweep spawns bodies
inside huts and rubble). The other 4 and 8 (0.5 to 7.5 m shorter) show no
torso or head penetration in either; the one traced end to end (Wake 5576:75) is
path divergence: a lintel grazed where HEAD passed through sent the fix half a
metre aside, into the wall beside the door HEAD walked through.
The four lost climbs all had HEAD's head or torso 7-29 cm into a ruin, a Defgun
bunker or a steel hedgehog. The five jumps whose outcome changed (3 lost, 2 gained) are all tank hedgehogs
(landing on a girder); crates and the rest land as before. Walks HEAD left frozen
at their spawn (the four passes burnt at `t = 0` against the same edge) now move;
the Berlin walks that newly cross a surface are those, escaping what they spawned
in.

### Still open

- A long waist-high plate edge with the ground falling away along it: in a
  synthetic sweep (plate at 0.8-1.05 m, ground falling 2-3 %, sliding along its
  side edge) 22 of 108 end under it against HEAD's 15. HEAD's clear ones mostly
  froze against the edge early; the fix slides on, and the ground glue lowers the
  top sphere onto the edge, unswept. The downward half of the follow is the fix
  and it snagged too much as written (above). The beached ramp does not reach it.

## Tests

- `tests/test_physics.py`: `test_a_level_sweep_meets_the_edge_of_an_open_plate`,
  `test_an_edge_the_sphere_already_overlaps_lets_it_go`,
  `test_a_seam_inside_a_flat_wall_is_not_an_edge`,
  `test_a_body_stops_at_the_edge_of_a_plate_it_walks_level_into`,
  `test_a_shell_keeps_an_edge_solid_to_a_sphere_only_grazing_it`,
  `test_a_shell_still_lets_a_buried_sphere_go`,
  `test_a_step_up_is_refused_where_the_head_has_no_room`.
- `tests/test_bot_ai.py`: `test_a_wedged_body_stalls_even_while_its_velocity_reads_a_run`.
- `tests/test_soldier.py`: `test_the_ground_covered_is_kept_beside_the_speed`.
