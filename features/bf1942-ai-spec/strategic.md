# Strategic AI

One `StrategicAI` per level drives both sides (`strategic.js`); the page
builds it only when the level ships strategic areas
(`bot-referee.js spawn`). Without them each bot walks at the nearest
flag its side does not hold (the fallback at the end).

The referee does not hold the SAI itself but the strategic interface in
front of it (`doctrine.js StrategicCommand`, [features/bot-doctrines](../bot-doctrines/README.md)):
the one place a bot's order comes from. Each pass it runs the SAI's shared
half (`beginPass`: flags bound, areas counted with every bot) and then asks
each side's doctrine for that side's orders. The default doctrine, `sai`, is
the SAI's own side half (`sidePass`: states, strategy, temperatures,
distribution), so everything below is what a bot gets unless another
doctrine is chosen (the runner's `--doctrine`); a seeded runner trace is
byte for byte the same through the interface as it was without it.

## Data

`extras.ai`, written by the extractor (`bf42/ai_level.py`) from the level's
`ai/StrategicAreas.con`, `conditions.con`, `prerequisites.con`,
`Strategies.con` and `AI.con`:

- **area**: `name`, the two points of `aiStrategicArea.create p1 p2 r` (kept
  by the exporter as `min` / `max`: p1 is (min x, max z), p2 (max x, min z)
  in the viewer's frame), `radius` r, `flags` (`Base`,
  `ControlPoint`, `Centre`, `Flank`, `ChokePoint`, `Close`, `AirField`,
  `StrongPoint`, `North`..., `Safe`), `neighbours` (the adjacency graph),
  `orderPositions` per vehicle type (`Infantery`, `Tank`, `Car`), `side`,
  `takeable` per side.
- **condition**: `fuzzy` (`Crisp` / `Fuzzy`), `op` (`Equal`, `EqualGreater`,
  `EqualSmaller`, `Quotient*`), `subject` (`Friendly` / `Enemy`), `object`
  (a state name), `value`, `strength` (`Required`, `RequiredPositive`,
  `RequiredNegative`, `Advisory`, `AdvisoryPositive`, `AdvisoryNegative`),
  `abort`.
- **prerequisite**: a list of `(condition, weight)`.
- **strategy**: `aggression`, `attacks`, `defences`, `timeLimit`,
  `prerequisite`, `modifiers` (`flag`, `factor`, `owner` status or null).
- `sideStrategies`: each side's strategy list, in `ai.addSAIStrategy` order.

**Geometry** (`areaGeometry`, AI-70): p2 is the area's position (its
middle) for both sides; the area is the **centre box** `p1 .. 2 p2 - p1`,
twice the authored rectangle on each axis (`isInside`); a side's radius is
`|p2 - p1|` for sides 1 and 2 and r for side 0 (`sideRadius`).

*Example.* El Alamein's `easternbase`, r 200, p1 (1310, -1334), p2 (1360,
-1384): the box is 100 x 100 m about p2, the side radius `hypot(50, 50) =
70.7` m.

**Ownership** is not authored per area (`StrategicLayer`): each control point
binds to the area whose centre box grown by r holds it, nearest middle
first, else the nearest middle (`bindFlags`, `areaAt`). An area's owner is
the side holding all its control points, 0 when they are neutral or split,
and the authored `side` for an area with none (`ownerOf`). Captures change it
live. A side may not take an area marked `takeable <side> 0` or whose control
points are all uncapturable (`takeableBy`).

Built since (ledger AI-74, `updatePresenceOwner`): `AIStrategicArea::update`
0x0863d6d0 makes an area with no control point Owned by a side that has units
in it and the enemy none, when takeable, and Hostile to a side with only enemy
units there when the enemy may take it; an empty area keeps its status.
Before that the code kept the authored side, so a pass
with `side` unset is Neutral for ever. On El Alamein `SouthBase`'s only
neighbour is `SouthMountainpass`, which can therefore never be Owned, and
`SouthBase` never gets an attack value from either side.

## The pass

`StrategicAI.update(dt, alive)` runs a pass at most once per
`SAI.updateFrequency` = **5 s (INVENTION)**. Research disagreement: README
§6.1 read `AISettings::reset` storing 2.0 in the SAI update frequency; the
later bot-behaviours §7 calls the default unread. Each pass, for both sides:

### 1. Areas (`_updateAreas`)

For every alive bot, its area (`areaAt` its position) gains it in `present`,
`friendly += 1` for its side and `enemy += 1` for the other (`SAI.unitValue`
1 per soldier, INVENTION). Then per area and side:

```
status      = Owned | Hostile | Neutral           (ownerOf vs side)
attackTemp  = friendly + enemy + radius
defenceTemp = radius
wanted      = round(2 * max(1, present))  x 1.25 when not Owned
```

The research has `attackTemp = unit strength in the area + base`; the code
counts both sides' units. `wanted` is `round((2 - SCurve(X)) * ...)` with the
never-written `X = 0`.

*Example.* A 50 m area holding 2 Axis and 1 Allied soldier, owned by the
Allies: for the Allies `attackTemp = 2 + 1 + 50 = 53`, `wanted = round(2 * 1)
= 2`; for the Axis `wanted = round(2 * 2 * 1.25) = 5`.

### 2. States (`_updateStates`)

Two maps a side, `friendly` and `enemy`: `ControlPoint` (flags held),
`Time`, `StartTime` (seconds since the active strategy was chosen),
`Attacks`, `Defences`, `Security` 1, `NumberOfFriendly/Neutral/HostileAreas`,
`Front` / `Safe` (an owned area with / without a hostile neighbour, counted
for the owner), `EnemyObject`, `UnReachable`, `FrontNeutral`, and per area
flag the flag's count (`Base`, `Flank`...) plus `Front<flag>` for a front
area. `Ticket` is never filled (the viewer has no ticket state).

### 3. The strategy (`_chooseStrategy`)

Each strategy's score is its prerequisite (`_evaluatePrerequisite`), per
condition `v = compare(condition, state) * weight` with `compareCondition`:

| op | Crisp | Fuzzy |
|---|---|---|
| `Equal` | `a == value ? 1 : -1` | `-abs(a - value)` |
| `EqualGreater` | `a >= value ? 1 : -1` | `a - value` |
| `EqualSmaller` | `a <= value ? 1 : -1` | `value - a` |
| `Quotient*` | the same on `a / b` | the same; a zero divisor gives +-1000 |

then by strength: `Required` / `RequiredPositive` kill the strategy (score 0)
on `v < 0`, `RequiredNegative` on `v > 0`; `Advisory` adds `v`,
`AdvisoryPositive` `max(0, v)`, `AdvisoryNegative` `min(0, v)`. An abort
condition counts only for the active strategy. No prerequisite scores 1.
`score = max(0, sum)`.

**A passing Required condition adds nothing.** On a level whose conditions
are all Required (El Alamein: `flankCond`, `broadCond`, `oneCPCond`... every
one `Required`), every strategy scores 0, the roulette has nothing to draw
from, and each side keeps its first strategy (`broad`) for the whole match:
the headless runner saw 0 strategy changes in 600 s. The weights the level
gives its Required conditions (5, 15) would be meaningless if the engine did
the same; whether `StrategyPrerequisite::evaluate` adds a passing Required
condition's `v` is worth a re-read.

The active strategy is kept while every strategy's `heat / score` stays
strictly inside 0.83 .. 1.2 (`heat` is the score at the last roulette) and
the active one's time is inside `timeLimit * (2 - 2^(1 - count))` (1x, then
1.5x, 1.75x of the limit on successive expiries). Otherwise every `heat`
becomes its score and a roulette over the positive scores picks; nothing
positive keeps the active one. A change frees every bot of the side and
clears every area's assignment.

*Example.* The synthetic level's `push` and `hold` have no prerequisite:
both score 1. At the first pass `heat` is 0, the ratio 0 is outside the
band, the roulette picks either at 50 %; from then on the ratio is 1 and the
choice holds until `timeLimit` 300 s, then 450 s more, then 525 s more.

*Example.* `timeCond` (Fuzzy EqualSmaller Friendly StartTime 200,
AdvisoryNegative, abort), weight 1, for the active strategy at StartTime 250:
`v = (200 - 250) * 1 = -50`, `min(0, -50)` adds -50, the score clamps to 0,
and the ratio test re-opens the choice.

### 4. Temperatures (`_updateTemperatures`)

Both temperatures of each area are multiplied by the active strategy's
factor for every modifier whose `owner` is null or the area's status and
whose `flag` the area carries, plus `Enemy` on a Hostile area, `Neutral` on a
Neutral one, `Front` / `Safe` on an Owned area with / without a hostile
neighbour. The temperatures are rebuilt each pass, so the factors do not
compound.

### 5. Targets and orders (`_distribute`)

- **Aggression** is the strategy's (0.5 when missing), forced to 1 when the
  side owns no area and to 0 when nothing is left to take.
- **The split**: free bots become attackers while `attackers / total <=
  aggression` (the first one when `aggression >= 0.5`), else defenders.
- **Attack value** (`_attackValue`): 0 for an Owned area, one the side may
  not take, or one with no Owned neighbour; else `attackTemp x 1.5` with a
  Hostile neighbour, `x 1.25` with a Neutral one, `x 1` otherwise. The
  enemy-cost term (`EnemyStatistics`) is 0 (INVENTION).
- **Defence need** (`_defenceNeed`): Owned areas only, `(enemy +
  attackTemp) x 2` with the same neighbour factors.
- The targets are the top `attacks` values and the top `defences` needs
  above 0.1. Bots assigned to an area no longer targeted are freed.
- **Collection**, round robin: each target in turn takes the nearest free
  bot of its kind (attack / defence) to its order position while it has
  fewer than `wanted`; repeat until no target takes one.
- A bot left free is re-ordered to the area it stands in every 20 s.
- **Arrived bots** (`_reorderArrived`, `SAI::updateBotPositions`): an
  assigned bot whose order has arrived, standing in its assigned area and
  seeing fewer than 2 objects, gets a fresh order into the same area (a new
  random point) 20 s after its last order on foot, 35 s mounted.
- **A new unit** (`botChangedUnit`, `SAI::handleChangingBot`): the page calls
  it when a bot takes or leaves a seat; the bot loses its assignment and is
  ordered afresh as the unit it now is at the next pass.

*Example.* El Alamein, the Allies holding `easternbase` (radius 200, flags
`StrongPoint ControlPoint Centre`), strategy `broad` (ControlPoint x2,
Safe x0.25 when Owned), 3 Allied bots and 1 Axis in it. Its neighbours are
two passes (Neutral), `NorthBase` (Neutral) and the Allied airfield and base
(Owned): no Hostile neighbour, so it is Safe. `attackTemp = 3 + 1 + 200 =
204`, x2 (ControlPoint) x0.25 (Safe) = 102; defence need `(1 + 102) x 2 x
1.25` (a Neutral neighbour) = 257.5. For the Axis the area is Hostile, and
it gets an attack value only once the Axis holds `NorthBase`: its other
neighbours are the two passes, which (see Ownership) are never Owned, and
Allied areas.

### 6. The order (`_order`, `WPMoveTo`; AI-70)

The page describes the bot's unit (`unitOf`, PAGE `botStrategicUnit`): its
search type (`Infantery`, `Tank`, `Car`, `Boat`, `LandingCraft`, `Plane`),
the test of its own search map (the infantry map on foot, the vehicle map in
a land vehicle, the water map afloat), its bounding radius (1 on foot, the
page's vehicle radius mounted) and whether it is mounted or flying.

```
point = randomizePos(area, 0.8): per axis p2 + rand * W * 0.8 - W / 2, W = 2 (p2 - p1)
        (the corner's 80 % of the box, not a disc), the first of 20 draws on a valid
        cell of the unit's map; else the unit type's order position when valid; else p2
R     = max(5, 0.25 * side radius + 2 * bounding radius)
```

`WPMoveTo.urgency(x, z, pathRadius)` with `Rr = round(R) + pathRadius` (the
unit's `getMaxPathPosRemovalDistance`: 1.0 on foot, `0.99 x max(0.5, radius)`
mounted; `bot.js _pathRadius`) and `d²` the squared distance to the point:

```
d² < Rr²:             arrived, urgency 0
not Owned:            factor 2
Owned, inside box:    factor 0, d² = 0
Owned, outside:       factor 1, d² = d² - side radius²
urgency = clamp(d² / (4 Rr²), 0.1, 1) x factor;   arrived again when d² < 2 Rr²
```

*Example.* `easternbase` (side radius 70.7), a soldier of a side that does
not hold it: `R = 0.25 x 70.7 + 2 = 19.7`, `Rr = 20 + 1 = 21`. From 60 m:
`3600 / 1764 = 2.04 -> 1`, urgency 2, x1.5 (MoveTo's personality) = 3.0 in
the contest. From 40 m: `1600 / 1764 = 0.907`, urgency 1.81, contest 2.72.
Inside 21 m: arrived, 0. `AlliedBase` (p1 50 x 100 m from p2) gives `R =
29.95`.

**Regression (since `ee729113`).** The order no longer carries the
`inside(x, z)` the bot reads for "inside the ordered area"
(`bot.js _insideOrderedArea`, the medic's `insideMyArea`, the vehicle
targeting's `insideArea`). `_insideOrderedArea` falls back to true, so the
0.75 outside-area factors of Fire and Change never apply; the medic's call
throws (`wp.inside is not a function`, `bot.js _urgencySpecial`) whenever a
medic bot holding an order weighs a wounded friend. The headless runner
records it as a `bot_error` event (synthetic level, seed 1: 248 in 30 s).

### 7. The air order (`_orderAir`, AI-71)

A flying unit is ordered to the area's own position p2 at the ground (or
water) + 75 m, a `WPAltitudeMoveTo` of radius `min(40, side radius)`, a 120 m
vertical band and a 50 m clearance (the move's, [controls.md](controls.md)):

```
urgency = 1 outside the radius across or the 120 m band, else (dy² + d²) / (R² + 120²)
```

It never reports arrival.

### 8. The beach order (`_orderBeach`, `doctrine-landing.js`; AI-96..AI-99)

**Data.** `extras.ai.landingZones`: `name`, `min` / `max` (a corner box, its
corners sorted per axis) and `beach`, the edge the con's direction names in
the viewer's frame (`LZXMin` -> `xMin`, `LZXMax` -> `xMax`, and z flipped:
`LZZMin` -> `zMax`, `LZZMax` -> `zMin`). An area carries `landingZones`
(`attachLandingZone`), `landingZoneUnits` (`addLandingZoneUnit`, the unit
types sent to its beach; `LandingCraft` on every vanilla level) and
`expelledUnits` (`addExpelledUnit`). Levels with live zones: vanilla Iwo
Jima (2), Midway (6), Omaha Beach (1), Truk (6), Wake (4); XPack1 Baytown
(2), Husky (1); XPack2 Essen (4), Mimoyecques (6), Telemark (10).

**Who gets it.** A bot at the helm of a landing craft (the `strategicUnit`
type `LandingCraft`: a Daihatsu or an LCVP on its `LandingCraft` water map)
that the SAI orders to an area:

- the area sends `LandingCraft` to a zone: a `WPBeachLanding` on its
  attached zone nearest the craft (the engine's no-route case);
- otherwise the first area on the shortest neighbour path from the craft's
  own area (not a zone user, not expelling it) that is a zone user gives a
  `WPMoveToBeachLanding` on its nearest zone (the path is INVENTION: the
  engine's route tables are not read; its intermediate points are not
  driven);
- otherwise the ordinary `WPMoveTo`.

A rider or gunner keeps the ordinary order; he does not drive.

**The order.** Radius 10 (`WPBeachLanding`) or 5 (`WPMoveToBeachLanding`),
urgency 1, never arrived. Outside the zone its point is an approach point,
uniform along the side opposite the beach and 10 m in, tried 20 times on the
craft's map; the craft routes there on the water map. Inside the zone
(distance 0; `d² < 10` for the `MoveTo` form) the order is replaced by one on
a beach point, uniform along the beach edge, which the helm runs straight at
(`BoatMoveToDirect`, no route, never done). Leaving the zone flips it back.

**Getting out** (`BBChangeLandingCraft`). Everyone aboard a craft gets out
when it is inside any zone, under 2 m/s and on a cell of the infantry map,
or when it has tipped; the order's executor presses Use for the whole crew,
and each occupant's seated Change makes the same test with urgency 4. The
crew's Change has no other bail and weighs no other hull. Out, each is a
soldier with a fresh order.

*Example.* Wake, seed 1, 8 a side, 300 s in the runner (2026-09-24, main
at `e9f260da` plus this): two Daihatsus taken at 0.1 and 0.2 s from the
soldier spawns beside them, gunners and riders aboard by 78 s. One lands on
`SouthLanding` at 143.2 s, its driver and three riders out together at
(1157, -703); a rider takes `Landing_Beach` 6.5 s later. The other grounds
off the west shore at (590, -1114) and tips, and its crew of four gets out
there at 217.8 s. Without the beach orders the same seed crews both craft
and they hold inland `WPMoveTo` orders to the end: no landing, no capture.

## The enemy strength tables

With the same cadence (`bot-referee.js tick`, `bot-strength.js
EnemyStrengthTables.update`), each side's view of the enemy: for every
occupied enemy unit the side knows (a soldier on foot counts with the
soldier's `setBattleStrength` table, a seat with its guns' table and its
class) `strengths[c] += security x table[c]`, `types[class] += security`,
then every entry is halved. The tables settle at the per-pass sum. A bot
reads its side's tables for `calculateFireStrength`
([vehicles.md](vehicles.md)); before the first pass it assumes the enemy
fields infantry only (`bot.js _fireStrengthOf`).

**Security** (AI-75) is what the side knows ([sensing.md](sensing.md#what-a-side-knows)):

```
security = 1 - SCurve((now - t0) / D)      t0 the last contact, spot, re-sight or heard shot
```

`D` is the unit template's `aiTemplate.degeneration`: 15 for a soldier, 5
for a fighter, 10 a jeep, 15 or 25 a tank, 20 a landing craft or a fixed
gun, 50 to 180 a ship (`bot-strength.js VEHICLE_DEGENERATION`, by the
`vehicle-ai.json` name; a vehicle outside it takes 15). An enemy no bot of
the side has had in its frustum is not summed at all, so at the start of a
match the tables are empty and every unit scores `0.5 m`. A dead player's
record is dropped with him. The referee passes each unit's player id and
the clock (`occupiedUnits`, `tick`); without them (the harness's older
calls) a unit weighs its own `security`, 1 by default.

*Example.* 8 enemy soldiers in sight all the time (`Infantry 4, LightArmour
2, HeavyArmour 1, Air 1`): `strengths.Infantry` goes 16, 24, 28 ... -> 32,
`types.Infantry` -> 8. One soldier last seen at t0: his weight is 1, 0.91,
0.5, 0.09 and 0 at 0, 3.75, 7.5, 11.25 and 15 s, and his share of the table
halves away after that.

## Spawning

The engine does not spawn bots itself: the game fills the server, the SAI
picks each dead bot's spawn group (50 % its last target's group, else a
roulette weighted by area temperature and empty vehicles), and the game's
spawn loop places it (AI-38). The viewer:

- `bot.js spawnBots`: `count` bots, the side alternating over `teams`; a
  bot's flag is `teamFlags[i % n]`, its spawn index `floor(i / n)`.
- the kit is uniform among the side's kits (PAGE `botKitFor`; the engine's
  `findKitDiff` is 1 for every kit, AI-38); the bot carries the kit's
  items' AI weapon templates, primary first.
- a dead bot waits **8 s (PAGE, INVENTION)**, then respawns on a uniformly
  random flag its side holds, on that flag's next spawn point, with a fresh
  Armor (PAGE `botRespawnTick`); `onRespawn` forgets its senses, plan,
  route, obstacles and behaviour states. Its order is dropped at death
  (`botDied`).
- a bot that makes no net progress toward its goal for 12 s while MoveTo
  is active is redeployed to its flag's next spawn point
  (`_updateObjectiveReadout`, PAGE `tickBots`; INVENTION).

## Capture

PAGE `botCaptureTick`: a bot within a flag's radius (8 m fallback) of a flag
its side does not hold, measured in 3D from the unit it controls (the hull
when mounted: `ControlPoint::handleFrameUpdate`, AI-70), takes it after the
point's `timeToGetControl` (8 s fallback), straight to its side; the timer
is per bot, restarts when the bot's nearest such flag changes, and does not
check that the bot is alive.

## Without strategic data

`bot.js _fallbackWaypoint`: the nearest flag the bot's side does not hold,
as a `WPMoveTo` with `R = 5` (INVENTION) and factor 2, rebuilt when the
nearest flag changes.
