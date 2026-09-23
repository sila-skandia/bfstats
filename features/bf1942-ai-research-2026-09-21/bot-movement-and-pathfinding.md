# Bots: how a soldier walks its path — the movement and pathfinding read

**Date:** 2026-09-23. **Binary:** `bf1942_lnxded.static` (the corpus copy at
`/home/dylan/projects/public/bf42plus/`, interchangeable with the patched
copy per AI-25). Decompiled headless with
`features/bf1942-engine-reference/lnxded/decompile.sh`; 626 functions across
`dice::bf::ai::{BotMain, AIPathfinding, AStarLocalSearch, LocalMap, CellMap,
BBAvoid, BBPAvoidCollisionInfantery, BBPGotoWaypointSoldier, Entry*,
BAPAMoveTo*, Bresenham<MapTracing>}` plus `infanteryControlTowardsDirection`.
Vtable slots named with `lnxded/vt.py`. Three summarising passes over the
decompiles were run and cross-checked against each other and against the
raw C; where they disagreed the raw C decided. Every claim below carries its
function address; **INFERRED** marks what the code implies but does not state.

This closes README §3.4 (the row encoding, open item C) and most of §7 Stage 2
("it walks"). It was prompted by two symptoms in the viewer's bots: walking
to an objective facing backwards, and jamming behind sandbags. The first was a
viewer rendering bug (§8); the second was the viewer's navigation grid, which
was built 64 times too coarse from a misreading of the `.raw` header (§1).

## 1. The map is one bit a metre, and the `.raw` "row" is a 64 x 64 block

`LocalMap::LocalMap(name, terrain, bool, waterDepth, maxSlope, minLevel,
maxLevel, sizeXBits, sizeZBits)` **0x085fb120** builds, for every level
`L = minLevel .. maxLevel`, `CellMap(name + "_" + L, L, 0, L + 6, sizeXBits,
sizeZBits)`. `LocalMap::getLevelPixelSize(L)` **0x085ff170** is `1 << L`:
**a level-0 pixel is one map unit**, one world metre when
`aiSettings.setWorldMapSize` is the terrain size.

`CellMap::CellMap(name, p3 = level, p4 = 0, p5 = level + 6, p6, p7)`
**0x085f7af0** allocates its `MemoryPool` with cells of `4 << (p4 - 5 + 2 *
(p5 - p3))` = `4 << 7` = **512 bytes**: a 64 x 64-pixel block of one-bit
pixels. The row array holds `(1 << (p6 - p5)) * (1 << (p7 - p5))` block
pointers, so a 2048 m level (`sizeXBits = 11`) at level 0 is 32 x 32 blocks of
64 m — which is exactly the header `pathfinding-raw-format.md` reads, and why
that document's "32 x 32 cells of 64 m" was wrong: those are blocks, not
cells. `CellMap::getPixel(MapPos)` **0x085f9a00** masks the pixel with
`(1 << +0x28) - 1` where `+0x28 = 1 << p4 = 1`: **one bit, 1 = blocked, 0 =
free** (`AStarLocalSearch::__checkThisLevel` treats `getPixel() == 0` as
passable). The two special cells the constructor registers, `0` and
`0xffffffff`, are the all-free and all-blocked blocks the sparse file refers
to by index.

The infantry map is `ai.addSearchMap Infantry1 0 1.5 30 1.0 0.4 2.0 1`
(`name / waterHeight / waterDepth / maxSlope / brush / lowClip / hiClip /
considerAITypes` in the level's own comment). `addSearchMap` **0x0847b0a0**
forwards the seven values plus two level bounds to
`AIPathfinding::LocalMapInfo::LocalMapInfo` **0x0847a480**, which stores the
brush at `+0x0`, `considerAITypes` at `+0x4`, `lowClip`/`hiClip` at
`+0x114`/`+0x118`, and builds the embedded `LocalMap` with `+0x1c = 1.5`
(water depth) and `+0x20 = 30 * 0.017453292` (max slope, **radians**). The
first numeric argument is a `bool` (`LocalMap+0x14`), not a water height: it
selects a water-going map whose test is the inverse of the land one.

## 2. How the bitmap is painted (`LocalMap::update` 0x085fe090)

Per level-0 pixel, the terrain pass samples `ITerrain::getHeight(x, z)`
(vtable `+0x44`) and the water height (`+0x5c`, INFERRED from its use):

- **water:** blocked iff `waterHeight - terrainHeight > waterDepth` (1.5 m);
- **slope:** blocked iff any of 4 x 5 sub-samples per metre has
  `ITerrain +0x58 (x', z') > maxSlope` (an angle in radians; INFERRED to be
  the terrain's own slope function);
- **material:** one designated material id (from game object `0x1d4c1`,
  `+0x2c0`) is impassable — which one was not determined.

A blocked pixel is painted through `CellMap::setBlob` **0x085f9250** with the
map's brush, so terrain obstacles are dilated exactly as objects are.

The **brush** (`LocalMapInfo::update` **0x08480f50**): from the float `b`,
`n = round(|b|) * 2 + 1`, bit set where `(col + 0.5 - c)^2 + (row + 0.5 - c)^2
<= b^2`, `c = n / 2 + 0.5`. For `b = 1.0` that is **a plus of five pixels**
(centre and four orthogonal neighbours), painted by `MapBuffer::paintBrush`
**0x086011b0** around every painted pixel.

The **object pass** (`objectClipAndRender` **0x085fbfa0**, driven by
`createAllSearchMaps` **0x0847bb60** over the object manager's roots): for
each object with a collision mesh inside the map, the mesh's faces are clipped
against two horizontal planes at `minY + lowClip` and `minY + hiClip` where
`minY` is the mesh's own lowest vertex (`clipFaceToPlane`, the anonymous
helper at `0x085fdab2`), and each intersection segment is drawn as a
Bresenham line (`LocalMap::renderLine` **0x085fb960**,
`Bresenham<MapRenderer>::originalLine` **0x085ffa30**) with the brush. **Edges
only; nothing fills a triangle.** When an `aiMeshes.rfa` hull exists for the
object (`IAIMeshLoader +0x8`), the collision faces are clipped against that
hull's faces instead of the two planes. Cover objects (`AIObjectCover` at
`+0x58`, deferred by template property `0x13`) then have their portals
(doorways) carved back out with `unSetBit`.

Two clearing steps and a flood finish level 0: `SamplingObjectBuffer::
sampleAndRender` **0x08601390** frees every cell whose four sub-samples a
downward ray finds an object top under (the ride surface of a pier, a bridge,
a ramp); `floodLevelZeroMap` **0x085fbae0** (`flags & 2`) floods the free
cells from `ai.setMapSpawnPoints` and **blocks every free cell it did not
reach**, which is how a sandbag's top and a walled yard with no door end up
impassable. Levels `1 .. maxLevel` are then the OR of each pixel's four
children.

## 3. The local search (`AStarLocalSearch`)

`AIPathfinding::localSearch(int, int, MapPos&, MapPos const&, float radius,
double const& time, IPathBuffer&, bool&, bool, vector<pair<Pos2, float>>*)`
**0x0847d940** (`IAIPathfinding` vtable `+0x64`) validates both ends with
`isValidPosition` (`+0x70`), calls `initNormal` **0x085f28b0** — or
`initRestrictedNormal` **0x085f2a10** when an obstacle list is given — and
runs `AStar::performSearch` **0x085f0c20**.

- `newPositionsAndCosts` **0x085f4c00** expands exactly four directions:
  `(0,1) (1,0) (0,-1) (-1,0)`. **The engine's local A* is 4-connected.**
- `checkDirection` **0x085f4d90** tries the higher level first
  (`__checkHigherLevel`), then this level (`__checkThisLevel` **0x085f5d20**),
  then recurses into the two lower-level children along the step
  (`__checkLowerLevel` **0x085f5a20**): the search walks the pyramid, coarse
  where it can and fine where it must.
- A step's cost (`__checkThisLevel`):
  `((1 << level) + levelCost[level]) * 16 + round((|dh| * 3 + (1 - |ny|)^2 * 7) * 16)`,
  `dh` the terrain height difference to the neighbour (from `ITerrain +0x54`,
  which also returns the normal), `ny` the normal's y. The heuristic is
  `4 << (maxLevel - minLevel)` per unit (`initNormal +0x10`).
- `initNormal` stores `round(radius)` at `+0x4` and `round(radius *
  1.41421)` at `+0x5c` (the box), `0x400` at `+0xc` (the node cap, INFERRED)
  and `round(param6 * 5)` at `+0x54`.
- Restrictions are `(Pos2, radius)` circles the node test refuses;
  `resolveStartPositionAgainstConstraints` **0x085f3270** first moves a start
  that lies inside one out of it.

Line-of-walk is `Bresenham<MapTracing>::modifiedLine` **0x08480190** behind
`trace` (`+0x50`) and `traceValidPoint` (`+0x58`, **0x0847e3a0**): every cell
along the line is tested with `isValidPosition(Vec2)` (`+0x7c`), and a
diagonal step also tests the two cells it cuts between. `trace` walks while
the cells are valid and reports the last valid one before the first blocked
cell. `traceValidPoint` (0x0847e3a0, read 2026-09-23) is the **inverted**
walk: the start itself when it is valid, else the **first valid cell** along
the line (the `MapTracing` "continue while invalid" mode, byte +10 of the
tracer), and false when none is found — the primitive that pushes a point
inside an obstacle out to open ground.

## 4. The follower (`BotMain::Path`, at `BotMain+0x144`)

`Path` layout, as read: `+0x8` look-ahead index, `+0xc` state (0 strategic,
1 local, 2 done, 3 failed — `updatePathfinding` **0x08526d40**), `+0x40/+0x44`
the goal (floats), `+0x50..+0x58` the current target, `+0x5c/+0x60` search
radius, `+0x70` deque of coarse points still to refine, `+0x98` deque of the
followed points, `+0xc0` flags (bit 1 obstructed, bit 2 "target set", bit 4
obstacles changed).

- **`BBPGotoWaypointSoldier::createPlan`** **0x085bb660** emits
  `BAPCombinerSerial{ BAPASoldierPose(1), BAPAMoveToFinding(bot, pos, R, R,
  BAPConFalse, ..., arriveRadius) }` wrapped in `BAPIWMoveTo`. `R` is the
  soldier template's max speed (`getPlugIn(2)->+0x14->+8`). The plan is
  rebuilt only when the goal has moved by more than `4 * R`
  (`(4 R)^2 < d^2`); a position-type waypoint's break radius is capped at
  50 m.
- **`updateLocalPath`** **0x08527120** refines the route a leg at a time: it
  launches a local search only when **fewer than `getSmoothing()` followed
  points remain** (`ai.setSmoothing 1 10` for infantry, vtable `+0x2c`), from
  the last followed point to the next coarse point, with radius
  `10 + rand * 14` raised to the largest potential-obstacle radius, plus 1,
  and the `+0x170` obstacle list as restrictions. The search is asynchronous
  (an `AStar` resource is held in `+0x184` across ticks). Success appends the
  points; an empty result sets state 2 (done); failure sets state 3.
- **`getNewIntermediatePathPos`** **0x0852ab60** chooses the steering point:
  for `i = min(getSmoothing(), size) - 1` down to `0`, the first
  `followed[i]` that `trace(bot, followed[i])` reaches wins — **the farthest
  visible of the next ten, farthest first**. With obstacles present the
  segment must also be at least 1.0 m long and pass no obstacle within its
  radius. If nothing traces clear, both stall counters increment and the tick
  counts as obstructed.
- **`updatePath`** **0x0852b8f0** / **`checkAgainstPath`** **0x0852bc40** /
  **`stepInPath`** **0x0852bee0** pop the front point when the body is inside
  the AI object's radius of it (`(vehicle+0x24)->v(0x30)`), or has crossed the
  plane through it perpendicular to the look-ahead point (`dot(next - front,
  pos - front) >= 0`, only when a look-ahead index is set). **The last point
  is never popped.** `getMaxPathPosRemovalDistance` **0x0852b780** is
  `0.99 * max(0.5, radius - |sphere offset|)`.
- **`reachedEndOfPath`** **0x0852c000**: state 2, one followed point left, and
  the obstructed bit clear.
- **`EntryInfanteryMoveTo::execute`** **0x08616270** is the instruction that
  drives the soldier: it enables physics, asks the action for its point
  (`+0x24`), resets the controls and finishes when within the arrive radius
  (`+0x28`), else calls `infanteryControlTowardsDirection` with the unit XZ
  direction and the template's max speed. `EntryMoveToMediumSoldier::execute`
  **0x0861cb30** is the same selection with the control step replaced by a
  kinematic transform write (physics disabled, `dt * speed` along the
  direction, height snapped to `env +0xb8`'s ground) — the medium-LOD mover.

## 5. Steering (`infanteryControlTowardsDirection` 0x08627000)

With `f` the camera forward (XZ, from the `Mat4` at `+0x20`), `d` the desired
direction (XZ, normalised), `n = normal(f)`:

```
angle   = acos(clamp(dot(n, d))) - pi/2         // signed lateral angle
ahead   = dot(d, f)
if (ahead < 0 || |angle| > 0.5497787)           // behind, or > 31.5 deg off
    throttle = 0; flag = 1; if (ahead < 0) angle = sign(angle) * pi/2
else
    throttle = speed; flag = 0
mouseControlLookAtDirection(d, cameraMat, &pitch = 0, &angle, ...)
PlayerInput[c_PIThrottle] = |throttle| < maxThrottle ? throttle / maxThrottle
                                                     : sign(throttle)
```

**A soldier bot throttles only inside a 31.5 degree cone of its facing;
outside it stops and turns, a target behind it at the full rate. It never
strafes** (`c_PIYaw` is untouched; `infanteryResetControls` **0x08627740**
zeroes channels 0..5 and, on the third flag, fire/alt-fire/menu/use/reload).

## 6. Obstruction and potential obstacles

`BotMain::ObstructionDetection::update(bot, distSq)` **0x08532b00** (two
counters at `BotMain+0x1c0`): reset both when `distSq >=
getMaxPathPosRemovalDistance()^2` or when the body moves at `>= 1.0` with a
yaw rate `>= 0.1`; else increment both. Its only caller passes the squared
distance to the path goal, so it counts a body that is at its goal and not
moving. The other increment is the no-visible-point case in §4. Thresholds in
`getNewIntermediatePathPos`: counter `> 0x96` (150) sets the obstructed bit;
`>= 0x191` (401) fails the path. `isObstructed` **0x0852e3a0** reads the
second counter `> 3000`. All are counts of AI ticks (the tick rate is not in
the corpus; the viewer runs its AI on the 30 Hz world tick).

What keeps the engine's bot off a static it is about to walk into is not the
counter but **`BBAvoid::calculateUrgency`** **0x0855c650**: it queries the
environment grid within `T * |v| + R` of the bot (`T` the vehicle setup's
`+0x2c`), runs `collisionPredicted` **0x0855d2f0** (closing at `>= 0.2` m/s,
miss distance under the two radii, time to contact within `T`) against each
candidate, and for a candidate slower than `getPotentialObstacleMaxSpeed`
calls **`addSlowMovingPathfindingObstacle`** **0x0855d550**, which adds it and
every slow neighbour within `5 * setup.+8 + R` as **potential obstacles**
(`BotMain::addPotentialObstacle` **0x0852ceb0**). Only a fast mover feeds
the Avoid behaviour's own side-step plan (`BBPAvoidCollisionInfantery::
createPlan` **0x08588400**: a 45 degree diagonal one second of travel long, on
the side away from the obstacle, ended by `1.1 * timeToContact` or arrival
within 5 m).

**`updatePotentialObstacles`** **0x0852d880** rewrites the `+0x170`
restriction list every tick as one `(x, z, R_bot + subSphereRadius)` circle
per sub-sphere of each obstacle, frozen where the object was when it was
added; an entry is dropped when its object is gone, exceeds `1.2 *
getPotentialObstacleMaxSpeed`, or is older than `getPotentialObstacleMaxAge`
**and** more than `5 * setup.+8 + R_own` away. **`checkAndInitAvoidPathfinding`**
**0x08527bf0** then plans around them: the goal is the first followed point
past the touching obstacle, the start is pushed off the obstacle's side axis
(`1.1 *` the projection, then up to 20 m along `traceValidPoint`), and
`initPathfinding` (cache 4) runs the restricted local search into the avoid
path.

## 7. What the viewer built from this (2026-09-23)

`viewer/nav-grid.js` — the map: one byte a metre (`CELL_FREE` or a why-code),
the terrain water and slope tests with the infantry parameters, the collision
triangles clipped per cell to the band above the object's base (the base
raised to the cell's own terrain), the plus brush applied to terrain and
object cells alike, object tops outside the band and drivable decks freed,
the spawn-point flood, a 16 m "any free" coarse level (INVENTION: the engine's
`StrategicMap` was not read), a 4-connected boxed local A* with the engine's
cost and obstacle circles, the Bresenham trace, and string-pulling.

`viewer/bot.js` — the follower: coarse legs refined ten points ahead, the
farthest-visible steering point, the radius/plane pop rule, the 31.5 degree
cone with no strafing, the 150/401 stall counts (the no-visible-point case as
the engine has it, plus — INVENTION — a throttle-on-and-under-1 m/s case in
place of the collision-prediction layer the viewer lacks), potential
obstacles planted a metre ahead of a stall and aged out, and a re-plan
against them.

`viewer/map.html` — see §8.

Deliberate differences, all labelled in the code: the band is filled per cell
rather than drawn as an outline (the same cells for a wall or a sandbag, and
no portal carving needed); the base is raised to the terrain so a building on
a slope keeps its uphill wall; `BOT_RADIUS = 1.0` stands in for the soldier
AI object's radius (not read; the engine floors the removal distance at 0.5);
`OBSTACLE_RADIUS = 1.5` and `OBSTACLE_MAX_AGE = 20 s` stand in for
`R_bot + R_object` and `getPotentialObstacleMaxAge` (defaults not in the
corpus); and the viewer keeps a 12 s no-net-progress redeploy as a safety net
the engine does not have.

## 8. The two symptoms

**Facing backwards.** `map.html`'s bot renderer multiplied the group's
quaternion by `SOLDIER_YAW_FLIP`, the baked half turn `netcode-render.js`
applies to a wire pose. The local third-person body is drawn without it (its
"three placement facts" comment: the pose glb is built in the page's own
forward convention), and a bot's yaw is a soldier's yaw, so the flip turned
every bot to face the way it had come. Removed. The old follower's body-frame
strafing (`moveStrafe = sin(rel) * 0.5`) also let a bot slide sideways toward
a waypoint it was not facing; the engine's cone rule (§5) replaces it.

**Blur.** Bot visuals were placed at the raw 30 Hz tick position every display
frame while the camera and the local body are drawn at `presentAlpha` between
tick boundaries; at 60 Hz and above that is a body stepping 20 cm at a time
under a smooth camera. `captureBotPresentationTick` now snapshots every bot's
pose from `World.onTick`, and `updateBotVisuals` blends position and yaw by
the frame's alpha, snapping on spawn and on a jump of more than 8 m.

**Sandbags.** The 64 m grid could not represent one. The metre map does, the
local search routes around the end of the line, and the trace-based look-ahead
keeps the bot walking along the route rather than at the flag.

## 9. Verified

- `tests/test_nav_grid.py` (11): cell size, the plus brush, a 5.7 degree hill
  free and a 45 degree ridge blocked, deep water blocked, a 1 m wall blocked and
  a 0.3 m kerb free, the wall grown by one metre, a doorless yard unreachable,
  a pier deck over deep water free, the trace refusing the wall, the local
  search routing around it, the whole-route query.
- `tests/test_bot_ai.py` (14): the look contract, sensing and turning to a
  target, no friendly fire, the wall blocked and the bot crossing its line
  outside its span with no stall, the steering cone (behind: turn without
  throttle; ahead: full; 45 degrees off: none), MoveTo winning and moving.
- El Alamein in the viewer with four bots: the map builds in ~320 ms
  (2048 x 2048, coarse 128 x 128), every bot holds a route with coarse legs
  and moves ~30 m per 5 s of stepped frames with no obstacles planted.

## 10. Still open

- The AI tick rate behind the 150 / 401 / 3000 counts.
- `getPotentialObstacleMaxSpeed` / `MaxAge` defaults, the soldier AI object's
  radius, and the vehicle setup fields `+8` (a speed) and `+0x2c` (a time).
- The impassable terrain material id, and the `StrategicMap` and the strategic
  search (`AStarStrategicSearch`), which decide *where* a bot goes rather than
  how it gets there.
- `BBAvoid` against moving objects (vehicles, other soldiers): the viewer has
  no collision-prediction layer, so bots meet each other through the stall
  counter.
