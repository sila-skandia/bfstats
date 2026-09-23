# Movement

The maps and searches are `nav-grid.js`; the follower is `bot.js`
(`_ensureRoute`, `_extendRoute`, `_lookAhead`, `_popPassed`,
`_trackObstruction`, `_trackContact`, `_execInfantryMoveTo`).

## The maps (`buildNavMap`)

One byte a metre over the level (the engine's map is one bit a metre, AI-26;
the byte says why a cell is blocked). The frame is the exporter's: x in
`[0, worldSize]`, z in `[-worldSize, 0]`, cell `(floor(x), floor(-z))`.

| map | built by | parameters (`ai.addSearchMap`) |
|---|---|---|
| infantry | PAGE `spawnBotsForLevel` | water depth 1.5, slope 30 deg, brush 1.0, clip 0.4 .. 2.0 (the `Infantry1` line; the code uses these defaults, not the level's line) |
| land vehicles | PAGE `botVehicleNav`, on first use | the level's `Tank*` line (El Alamein `Tank0`: depth 0, slope 30, brush 3.0, clip 0.3 .. 2.5) |
| boats, landing craft | PAGE `botWaterNav` | the level's `Boat*` / `LandingCraft*` water map (`Boat2 1 5.0 0 125`: free where the water is at least 5 m deep, no slope test, brush 125 m) |

Per cell, in order:

1. **Terrain**: the heightfield at the cell centre; no terrain blocks; water
   deeper than the map's depth blocks (a water map: shallower blocks).
2. **Slope**: the normal from central differences over the neighbours;
   `ny < cos(maxSlope)` blocks (not on a water map).
3. **Statics**: each collision triangle is clipped to every cell it covers;
   a piece whose height range meets `[base + lowClip, base + hiClip]` stamps
   the cell, `base` the object's lowest vertex raised to the cell's terrain.
   An upward face above the band, or any drivable deck, frees the cell
   (the engine's `sampleAndRender`). INVENTION: the engine draws the band's
   outline and relies on the flood to close the inside; filling per cell
   reaches the same cells for a wall. Simulated bodies (parked vehicles) are
   skipped: the engine meets them through Avoid, not the map.
4. **Brush**: every blocked cell, terrain or object, stamps
   `n = 2 round(b) + 1`, the cells with `(col + 0.5 - c)² + (row + 0.5 - c)²
   <= b²`, `c = n/2 + 0.5`. A water map's 125 m brush is a chamfer distance
   transform instead (the same disc).
5. **Flood**: from the seeds (every soldier spawn point; plus the vehicle
   spawns on the vehicle map), 4-connected; free cells the flood never
   reaches are blocked (`floodLevelZeroMap`: a walled yard with no door).
6. **Coarse level**: 16 m cells, free when any metre inside is free
   (INVENTION: the engine's `StrategicMap` was not read).

*Example.* The brush for 1.0 is 5 cells (a plus), for 3.0 29 cells, for 4.0
49. A 1 m sandbag (base 0, band 0.4 .. 2.0) is blocked and grown by a metre
each side; a 0.3 m kerb is below the band and free. A 30 deg slope is
`ny = 0.866`: a hill rising 0.5 m a metre (`ny = 0.894`) is walkable, 0.6 m a
metre (`ny = 0.857`) is not.

## The searches

**Strategic** (`findStrategicPath`, INVENTION): 8-connected A* over the
coarse cells, a diagonal needs one of its two side cells free, step cost
`(1 or sqrt 2) x (1 + 2 (1 - free fraction))`, octile heuristic. The path is
one free metre per coarse cell, nearest its centre, ending at the exact goal.
Used only when the goal is farther than 32 m.

**Local** (`findLocalPath`): 4-connected A* on the metre map (AI-29), boxed
`radius` metres around the start and stretched to hold the goal. A start or
goal on a blocked cell (or inside an obstacle circle) is moved to the
nearest open cell within 20 cells, else no path. Step cost

```
1 + 3 |dh| + 7 (1 - |ny|)²           dh the height step, ny the neighbour's normal y
```

(the engine's step is
`((1 << level) + levelCost) x 16 + round((3 abs(dh) + 7 (1 - abs(ny))²) x 16)`;
this is it at level 0 with the 16 scale and the level cost dropped),
Manhattan heuristic, at most `0x400 x 8` expansions (the engine's 0x400,
x8 INVENTION). The result is string-pulled (`smoothPath`: from each kept
point, the farthest later point a trace reaches).

*Example.* A flat step costs 1; a 0.5 m climb onto a slope with `ny = 0.9`
costs `1 + 1.5 + 0.07 = 2.57`.

**Obstacle circles** `{x, z, r}` restrict a search; a circle the searcher
stands in only blocks the part deeper than the searcher
(`resolveStartPositionAgainstConstraints`).

**Traces**: `traceClear` is the Bresenham walk over the map (a diagonal step
also tests the two cells it cuts between), true when every cell is open;
`traceValidPoint` returns the start when it is free, else the first free
cell along the line, else null (AI-39: research disagreement, the movement
doc's "last valid before blocked" is corrected there). `freeRun` /
`freeBox` answer the drive's box test ([controls.md](controls.md)).

## The follower

`_execInfantryMoveTo(action)`, for the waypoint `target` with arrive radius
`arrive` (3 m default):

1. Arrived (horizontal distance < arrive): stop, complete.
2. The stall bookkeeping (below) on last tick's throttle.
3. **Route** (`_ensureRoute`): kept while not failed and the goal has moved
   at most `4 x 5.0 = 20 m`; else rebuilt: a goal farther than 32 m first
   gets a strategic path (none: a failure), whose first entry is dropped;
   otherwise the goal is the only coarse leg. A failed route is retried
   after 1.5 s (INVENTION); meanwhile no route.
4. **Refine** (`_extendRoute`, AI-30): while fewer than `smoothing = 10`
   followed points remain and coarse legs are left, search from the last
   followed point to the next coarse point in a box of

   ```
   radius = 10 + rand x 14, raised to the largest obstacle radius, + 1 + 16 x min(3, failures)
   ```

   (`updateLocalPath`'s box; the failure widening is INVENTION), widened by
   16 m up to 6 more times (INVENTION); still nothing fails the route.
5. **Pop** (`_popPassed`): drop the front point while the body is inside its
   radius of it (1.0 m on foot, INVENTION; 3 m in a hull) or has crossed the
   plane through it facing the look-ahead point; the last point stays.
6. **Look ahead** (`_lookAhead`): the farthest of the next 10 points that
   `traceClear` reaches from the body, farthest first; none: the front point,
   and the tick counts as obstructed.
7. **Steer** at it ([controls.md](controls.md)).

No route (no map, or it failed): a soldier walks straight at the target; a
hull with a map stops.

**Obstruction** (`_trackObstruction`, AI-32): a tick counts when no point
traced clear, or (INVENTION) when the throttle is on and the body is under
1.0 m/s. At 151 counted ticks an obstacle circle (r 1.5 m, INVENTION) is
planted 1 m ahead and the route rebuilt around it; at 401 the route fails
(a hull also backs out for 2 s, INVENTION). Any uncounted tick resets the
count. The counts are bot ticks, so they scale with the page's frame rate
([README](README.md#the-tick)).

**Contact** (`_trackContact`, INVENTION): on foot, the body blocked against
a near-vertical surface with the throttle on for 10 ticks plants a 1.5 m
circle 1 m behind the contact normal and fails the route. The engine plants
potential obstacles from `BBAvoid`'s collision prediction, radius `R_bot +
R_object` (AI-32).

**Obstacles** are dropped when the bot is more than `5 x 5.0 + 0.5 = 25.5 m`
away (`AIPathfinding`'s max speed and age are 0 in every shipped level, so
only distance removes them).

**Redeploy** (`_updateObjectiveReadout`, INVENTION): with MoveTo active and
no net progress of 0.5 m toward the goal for 12 s, the page moves the bot to
its flag's next spawn point.

*Example.* A bot 120 m from its order point, a sandbag line across the way:
the strategic path gives ~8 coarse legs; the first two are refined (each
~16 m, string-pulled to a handful of points) until 10 points are queued;
the bot steers at the farthest of them the trace reaches, which is the end
of the sandbag line, pops points as it passes them, and refines the next leg
when fewer than 10 remain.
