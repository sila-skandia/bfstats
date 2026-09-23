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
| infantry | PAGE `spawnBotsForLevel` | the level's baked `Infantry1` (below); painted: water depth 1.5, slope 30 deg, brush 1.0, clip 0.4 .. 2.0 (the code's defaults) |
| a hull's own | `bot-units.js typeNav`, on first use | the map of the hull's search type (below): `Tank0` for every vanilla land vehicle, the water maps for the ships and landing craft |
| land vehicles (no search types) | PAGE `botVehicleNav`, on first use | the level's `Tank*` line (El Alamein `Tank0`: depth 0, slope 30, brush 3.0, clip 0.3 .. 2.5) |
| boats, landing craft (no search types) | PAGE `botWaterNav` | the level's `Boat*` / `LandingCraft*` water map (`Boat2 1 5.0 0 125`: free where the water is at least 5 m deep, no slope test, brush 125 m) |

**A unit's map is its search type's (AI-118).** The level declares its search
types with `ai.addSearchType <name> [map] [level]` (Bocage: `Tank 0 0`,
`Infantery 1 0`, `Boat`, `LandingCraft`, `Car 2 0`), and a unit's
`aiTemplatePlugIn.vehicleNumber` (the Mobile plug-in's +4) is an index into
that list: `AIObjectMobile::init` 0x085d54b0 hands it to `isVehicleUsed` and
`isValidPosition`, and `BotMain::initPathfinding` 0x0852a0d0 searches with
it. Every vanilla land vehicle, the Willys and Kubelwagen included, names 0:
they route on `Tank0`, and `Car4`, which Bocage, El Alamein and 18 other
levels declare, is searched by no vanilla unit. The soldier names 1, the
ships 2, the landing craft 3; XPack2's LVT4 and Schwimmwagen name 4
(`Amphibius` / `Amphibious` on seven XPack2 levels, `Car` elsewhere); a type
with no map (Bocage's `Boat`) gets no pathfinding. The viewer reads the
number from `_shared/vehicle-ai.json` and the level's list from
`pathfinding/index.json` (`nav-baked.js searchTypeMaps`); a level whose
index lists no types (an older tree, a painted level) keeps the choice by
drive kind. The SAI's order position is looked up by the same type's name
(`bot-referee.js strategicUnit`).

Per cell, in order:

1. **Terrain**: the heightfield at the cell centre; no terrain blocks; water
   deeper than the map's depth blocks (a water map: shallower blocks).
2. **Slope**: the normal from central differences over the neighbours;
   `ny < cos(maxSlope)` blocks (not on a water map).
3. **Statics**: each collision triangle is clipped to every cell it covers;
   a piece whose height range meets `[base + lowClip, base + hiClip]` stamps
   the cell, `base` the object's lowest vertex raised to the cell's terrain.
   An upward face above the band frees the cell (the engine's
   `sampleAndRender`, which clears the terrain's water and slope blocks
   under an object's faces before the outlines go in, AI-93). INVENTION: the
   engine draws the band's outline and relies on the flood to close the
   inside; filling per cell reaches the same cells for a wall. Simulated
   bodies (parked vehicles) are skipped: the engine meets them through
   Avoid, not the map. Faces of collision material 99 stamp nothing (the
   engine's outline loop skips them).

   **Drivable objects** (the drivable mask: bridges, repair pads, ramps,
   docks) stand in for the engine's AI meshes (`aiMeshes.rfa`), against
   which the engine outlines those objects instead of the two planes; a
   bridge's AI mesh is a sheet over its deck, so only the parapets draw
   (AI-93, INVENTION as a stand-in): every flat face (`|ny| > 0.5`, either
   winding; the export's winding is mixed) is a surface, never a wall, and
   a steep face over a cell the terrain pass blocked (the river, the bank
   under the bridge's end) stamps nothing, so the cell is free where the
   deck covers it and the blocked ground either side keeps its brush.
4. **Brush**: every blocked cell, terrain or object, stamps
   `n = 2 round(b) + 1`, the cells with `(col + 0.5 - c)² + (row + 0.5 - c)²
   <= b²`, `c = n/2 + 0.5`. A water map's 125 m brush is a chamfer distance
   transform instead (the same disc).
5. **Flood**: from the seeds (every soldier spawn point; plus the vehicle
   spawns on the vehicle map), 4-connected; free cells the flood never
   reaches are blocked (`floodLevelZeroMap`: a walled yard with no door).
6. **Coarse level** (a painted map only; a level's own map carries its
   strategic map, below): 16 m cells, each cell's 4-connected patches of
   free metres a node (INVENTION, AI-104).

*Example.* The brush for 1.0 is 5 cells (a plus), for 3.0 29 cells, for 4.0
49. A 1 m sandbag (base 0, band 0.4 .. 2.0) is blocked and grown by a metre
each side; a 0.3 m kerb is below the band and free. A 30 deg slope is
`ny = 0.866`: a hill rising 0.5 m a metre (`ny = 0.894`) is walkable, 0.6 m a
metre (`ny = 0.857`) is not.

*Example.* Bocage's small stone bridge at (812, -1414): its deck is 26.8 ..
29.1 m over a river bed at 3.4 m and banks at 14 .. 25 m; at the west end
the deck is 0.5 .. 2.3 m over the bank (inside the tank map's 0.3 .. 2.5 m
band) and an abutment stands 2.8 m out of the slope under it. On the tank
map (brush 3) the deck is free across the river in a strip 5 to 6 m wide,
the level's baked map's 6.

**The level's own map (AI-102).** Every level with an `AI.con` ships its
search maps baked (`Pathfinding/<name>Level<L>Map.raw`), and the server loads
them with `ai.loadMaps` instead of painting: each declared map, levels
`minLevel .. maxLevel` (the line's 9th and 10th words, 0 and 2 when absent),
stopping at the first map that fails and leaving it and every later one all
free (`loadSearchMaps` 0x0847c5c0, `LocalMap::loadRawFile` 0x085fefb0,
`CellMap::loadRawFile` 0x085f8930, `CellMap::CellMap` 0x085f7af0; the file is
`features/bf1942-ai-research-2026-09-21/pathfinding-raw-format.md`). The
viewer does the same: the extractor copies each loaded map's lowest level to
`<level>/pathfinding/` (`extract_search_maps.py`, `bf42/ai_level.py
level_search_maps`), the page's `show()` and the runner's `level.mjs` load
them onto the collider (`nav-baked.js`), and `buildNavMap` takes the map
whose six parameters are the call's (the referee's call, all defaults, takes
the level's infantry map). The baked pixels are the map: statics, brush and
flood are the server's own, only the terrain passes run (for the step costs
and to say why a blocked cell is blocked). A water map's lowest level is
usually 2, a 4 m pixel (`Boat2 1 5 0 125.0 0.3 2.5 0 2 5`), which the 1 m
map repeats. Every declared map on every shipped level loads (796 maps on 271
levels, 66.8 MB); the six levels with no `AI.con` (Aberdeen, Coral Sea,
Invasion of the Philippines, Liberation of Caen, Raid on Agheila, EoD's
Operation Linebacker) are painted as below. Bocage's baked `Tank0` and
`Infantry1` are one coarse component each, the painted ones' number (AI-93).
The same load then reads each search type's strategic map
(`loadSearchTypes` 0x0847c6b0, AI-117), which the extractor copies beside the
search maps (794 on the 271 levels, 41.0 MB) and `buildNavMap` hands to the
map it belongs to (`nav.strategic`).

**Painted.** On a level with no baked map, the painted map above stands in.
Against Bocage's `Tank0Level0Map` it agrees on 95.2 % of cells (60.8 % before
the drivable rules), `Infantry1Level0Map` 98.2 % (56.4 %). On Bocage most of
what remains is the slope test (the engine samples its own slope function
4 x 5 times a metre and blocks on any sample over the limit, the viewer tests
one central-difference normal a cell). On Market Garden (58 %) and Omaha
(54 %) the baked maps block everything outside an oval around the play area
(INFERRED the combat area; where the engine paints that was not read), and
Market Garden's iron bridge (`Ironbrdg1`) is not in the drivable mask
(`DRIVABLE_TOP_RE` matches `bridge`, not `brdg`); neither matters now that
those levels load their own maps.

## The searches

**Strategic** (`findStrategicPath`). On a level's own map it walks the
level's strategic map (`strategic-map.js`, AI-117;
`features/bf1942-ai-research-2026-09-21/pathfinding-raw-format.md` has the
files): one per search type, 64 m cells of up to four regions, each region a
point and links to the regions of the next cells, and a two-bit Info map of
which region each pixel is in.

```
start, goal -> (cell, region): the Info pixel; -1 on a pixel the unit's map
               blocks (getStrategicCellInfoNo 0x08608fa0; a 3 in an overloaded
               cell only when a flood inside the cell reaches region 3's point)
same (cell, region), region used -> no strategic path (isInSameStrategicArea)
else A* over (cell, region):  step to one of the 16 linked neighbours,
               cost |dx| + |dz| between the two regions' points,
               heuristic |dx| + |dz| to the goal's point, goal = its (cell, region)
path = the nodes' points; drop the first, and the second if it is the only one left
```

The engine refuses a route whose goal is on a blocked pixel or has no region,
and takes the start from the searcher's last valid position when it stands
on a blocked pixel (`initPathfinding` 0x0852a0d0). The viewer moves a blocked
goal, and the start of a searcher that never stood on a free pixel (a hull
parked on a cell its map blocks), to the nearest free metre within 20 m, as
the local search does, and an end on a free pixel with no region (a pocket
of an overloaded cell) to the nearest pixel with one within 20 m
(INVENTION: the viewer's plans hand goals the engine's would have
validated). Every route asks it, however near the goal: the same region
needs no strategic legs.

*Example.* Bocage, the Axis base (773, -954) to the Allied base (1372, -664)
on `Tank`: 17 region points across both river branches, 40 to 103 m apart,
and every leg closes in the local search's box.

On a painted map (INVENTION, AI-104): A* over each 16 m cell's free patches,
a step to a patch across a cell side, costed `1 + 2 (1 - free fraction)`,
octile heuristic; one free metre per patch, nearest its cell's centre, ending
at the exact goal; used only when the goal is farther than 32 m.

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
doc's "last valid before blocked" is corrected there). The drive's box is
`bot-vehicle.js searchBox` over `freeLevel` (`getSearchBox` 0x085f4180,
[controls.md](controls.md#the-turn-in-the-box-actionstatusdecision));
`freeRun` / `freeBox` are no longer read by the bots.

## The follower

`_execInfantryMoveTo(action)`, for the waypoint `target` with arrive radius
`arrive` (3 m default):

1. Arrived (horizontal distance < arrive): stop, complete. A boat brakes
   first and completes only at or under 1 m/s (`BoatControl::resetControls`,
   [controls.md](controls.md#boat)). A hull's move carries its own
   `actionStatusDecision` state (`action._asd`, 0 for a new move).
2. The stall bookkeeping (below) on last tick's throttle.
3. **Route** (`_ensureRoute`): kept while not failed and the goal has moved
   at most `4 x 5.0 = 20 m`; else rebuilt: the strategic path (none: a
   failure), whose first entry is dropped; with no strategic legs the goal is
   the only coarse leg. On a painted map only a goal farther than 32 m asks
   for one. A failed route is retried
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
(a hull's backing out is its move's `actionStatusDecision`, which the
potential obstacles feed through its object check). Any uncounted tick resets the
count. The counts are bot ticks, so they scale with the page's frame rate
([README](README.md#the-tick)).

**Prediction** (`predictObstacles`, AI-119): on foot, every tick, the
soldier's own side's bodies (soldiers on foot, own-side and empty hulls)
within `5 s x speed + R` are tested with `collisionPredicted` (relative
position and velocity, the radii summed, 5 s ahead: the Mobile plug-in's
`avoidCollisionLookAhead`, 5.0 from both ctors, which no soldier template
changes). One predicted that stands still (the potential-obstacle speed is 0
on every level), or that touches now, becomes a circle of `R_bot + R_object`
at its centre, and so does every other still body within `5 x 5 + R_object`
of it (`addSlowMovingPathfindingObstacle` 0x0855d550); the route is rebuilt
around them. The hull the bot is walking to board is left out and its
circles dropped once his plan boards it, his circles go when he mounts, and
a route's last leg leaves out a predicted circle over its own end
(INVENTION). A hull with an enemy aboard is not in the two grids read.
Moving bodies are the Avoid behaviour's (`bot-decision.js urgencyAvoid`,
still the touching rule).

*Example.* A soldier running at 5 m/s at a friend standing 8 m ahead plants
a 2 m circle on him 1.2 s before they would touch, and steers round; a friend
running beside him at the same speed plants nothing.

**Contact** (`_trackContact`, INVENTION): on foot, the body blocked against
a near-vertical surface with the throttle on for 10 ticks plants a 1.5 m
circle 1 m behind the contact normal and fails the route. The engine plants
potential obstacles from `BBAvoid`'s collision prediction, radius `R_bot +
R_object` (AI-32).

**Obstacles** are dropped when the bot is more than `5 x 5.0 + 0.5 = 25.5 m`
away (`AIPathfinding`'s max speed and age are 0 in every shipped level, so
only distance removes them).

**Redeploy** (`_updateObjectiveReadout`, INVENTION, AI-101): with MoveTo
active and no net progress of 0.5 m toward the goal for 12 s under one order,
the page moves the bot to its flag's next spawn point. A new order (a new
waypoint object, or a new nearest enemy flag without one) starts the
measure again. The engine has no such test.

*Example.* A bot 120 m from its order point, a sandbag line across the way:
the strategic path gives ~8 coarse legs; the first two are refined (each
~16 m, string-pulled to a handful of points) until 10 points are queued;
the bot steers at the farthest of them the trace reaches, which is the end
of the sandbag line, pops points as it passes them, and refines the next leg
when fewer than 10 remain.
