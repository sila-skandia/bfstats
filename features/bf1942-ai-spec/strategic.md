# Strategic AI

One `StrategicAI` per level drives both sides (`strategic.js`); the page
builds it only when the level ships strategic areas
(`map.html spawnBotsForLevel`). Without them each bot walks at the nearest
flag its side does not hold (the fallback at the end).

## Data

`extras.ai`, written by the extractor (`bf42/ai_level.py`) from the level's
`ai/StrategicAreas.con`, `conditions.con`, `prerequisites.con`,
`Strategies.con` and `AI.con`:

- **area**: `name`, a box `min..max` (x, z), `radius`, `flags` (`Base`,
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

**Ownership** is not authored per area (`StrategicLayer`): each control point
binds to the area whose box grown by its radius holds it, nearest centre
first, else the nearest centre (`bindFlags`, `areaAt`). An area's owner is
the side holding all its control points, 0 when they are neutral or split,
and the authored `side` for an area with none (`ownerOf`). Captures change it
live. A side may not take an area marked `takeable <side> 0` or whose control
points are all uncapturable (`takeableBy`).

Research divergence: `AIStrategicArea::update` makes an area with no
control point Owned by a side that has units in it and the enemy none, when
takeable (bot-behaviours §7). The code keeps the authored side, so a pass
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

### 6. The order (`_order`, `WPMoveTo`)

```
base  = the area's Infantery order position, else its first control point, else its centre
R     = max(5, 0.25 * area radius + 2 * unit radius)          unit radius 1 (INVENTION)
point = base + a random offset inside 0.8 * area radius, the first of 20 draws on a walkable cell, else base
```

`WPMoveTo.urgency(x, z, r)` with `Rr = R + r` and `d²` the squared distance
to the point:

```
not Owned:           factor 2
Owned, inside area:  factor 0, d² = 0
Owned, outside:      factor 1, d² = max(0, d² - area radius²)
urgency = clamp(d² / (4 Rr²), 0.1, 1) x factor;   arrived when d² < 2 Rr²
```

The `d² - radius²` reduction for an owned area is the code's own; the
research has `x1` only.

*Example.* A 20 m area: `R = max(5, 5 + 2) = 7`, `Rr = 8`. From 60 m, not
owned: `3600 / 256 = 14.1 -> 1`, urgency 2; x1.5 (MoveTo's personality) = 3.0
in the contest. From 10 m: `100 / 256 = 0.39`, urgency 0.78, contest 1.17.
Arrived inside 11.3 m. On El Alamein a 50 m area gives `R = 14.5`.

## The enemy strength tables

With the same cadence (`map.html tickBots`, `bot-strength.js
EnemyStrengthTables.update`), each side's view of the enemy: for every
occupied enemy unit (a soldier on foot counts with the soldier's
`setBattleStrength` table, a seat with its guns' table and its class)
`strengths[c] += security x table[c]`, `types[class] += security` (security
1, INVENTION), then every entry is halved. The tables settle at the per-pass
sum. A bot reads its side's tables for `calculateFireStrength`
([vehicles.md](vehicles.md)); before the first pass it assumes the enemy
fields infantry only (`bot.js _fireStrengthOf`).

*Example.* 8 enemy soldiers (`Infantry 4, LightArmour 2, HeavyArmour 1,
Air 1`): `strengths.Infantry` goes 16, 24, 28 ... -> 32, `types.Infantry` ->
8.

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

## Without strategic data

`bot.js _fallbackWaypoint`: the nearest flag the bot's side does not hold,
as a `WPMoveTo` with `R = 5` (INVENTION) and factor 2, rebuilt when the
nearest flag changes.
