# Behaviours

`bot.js BotController`: the contest (`_decisionMaking`), the urgency
generators (`_urgency*`, with `bot-fire.js`, `bot-behaviours.js`,
`bot-vehicle.js`), the plan generators (`_plan*`) and the interpreter
(`_runPlan`).

## The contest

**Registered behaviours**, in evaluation order (ties go to the earlier):
on foot `Avoid, MoveTo, Idle, Fire, Special, Scout, TakeCover, Change`
(`REGISTERED`, the `Infantery` rows of `AIbehaviours.con`); in any vehicle
the same without `Special` (`REGISTERED_VEHICLE`, the `Tank` rows).

**Modifier.** `base(i) = moral x personality(i) x basic(i)` with moral 1
(drawn once and never updated in 1.61), personality `StandardWeights` and
basic `UnitWeights` (all 1):

| | Avoid | MoveTo | Idle | Fire | Special | Scout | TakeCover | Change |
|---|---|---|---|---|---|---|---|---|
| StandardWeights | 1.0 | 1.5 | 0.1 | 7.5 | 1.0 | 1.0 | 2.0 | 1.9 |
| AvoidInhibit | 1 | 0.3 | 1 | 1 | 0.5 | 1 | 1 | 1 |
| ChangeInhibit | 1 | 0 | 1 | 1 | 1 | 1 | 1 | 1 |

With no plan, `mod(i) = base(i)`. With a plan (a winner and a non-empty
plan), `mod(i) = base(i) x curve_active(t) [i = active only] x
inhibitor_active(i)`, `t` the seconds the active behaviour has held, the
inhibitor column `AvoidInhibit` while Avoid is active, `ChangeInhibit` while
Change is, `UnitWeights` otherwise. **A behaviour whose `mod <= 0` is not
evaluated and keeps its old urgency** (MoveTo while Change is active).

**Curves** (`URGENCY_CURVE`), over the active behaviour's seconds:

```
UCUnion   1                                  every behaviour but Fire and Scout
UCFire    max(0, -0.22 t + 1.3)              zero after 5.91 s
UCScout   max(0, 2.5 / (t + 0.9) + 0.5)      3.28 at 0 s, 1.36 at 2 s, 0.73 at 10 s, -> 0.5
```

Research disagreement: IMPLEMENTATION_PLAN departure 3 fed UCFire
`distance / viewDistance`; bot-behaviours §2 and §3 (later) read its `x` as
the active seconds in the contest and as a per-target pseudo-random inside
the Fire score. The code follows the later reading.

**Selection.** Without a plan the contest always runs. With one it re-runs
only when some behaviour's `urgency / snapshot` leaves 0.87 .. 1.15 (a
snapshot of 0 re-runs on any positive urgency, an urgency of 0 on any
positive snapshot) or reports a changed target (`_quotientChanged`,
`changedTarget`). A run snapshots every urgency and picks the strict
maximum; nothing positive picks Idle at 0.001 (the engine dereferences NULL:
`IDLE_FLOOR`, INVENTION). The clock `t` restarts only when the winner
changes.

**Plan.** The winner's generator runs every tick. A generator that returns
the current plan object keeps it; a different non-empty plan first resets the
controls (input zeroed, route dropped: `_execInfantryResetControls`).

*Example: why a shooting bot flickers.* A bot walking an order (MoveTo raw 2,
urgency 3.0) sees an enemy it can hit (Fire raw 1, saturated): Fire appears
from 0, the contest runs, Fire wins at 7.5. Fire's modifier then decays as
7.5 x (1.3 - 0.22 t); each time it leaves the band the snapshot is retaken,
and at 4.33 s Fire is at 2.60 < 3.0 and MoveTo wins. On the next tick Fire
is no longer the active behaviour, its modifier is 7.5 again, 7.5 / 2.60 is
outside the band, and Fire wins with a fresh clock. Result: 4.33 s of Fire,
one tick of MoveTo, repeat (replayed in a script against `_decisionMaking`'s
rules). The one-tick MoveTo resets the controls twice.

## Curve tables

`DecleiningSlopeCurve` (`decleiningSlope`) and `SCurve` (`sCurve`) are 101
entry tables in the engine; the code holds the read samples and interpolates
linearly between them (INVENTION of the in-between values), 0 at or below 0,
1 at or above 1:

| x | 0.05 | 0.1 | 0.2 | 0.3 | 0.5 | 0.7 | 1.0 |
|---|---|---|---|---|---|---|---|
| Declein | 0.146 | 0.292 | 0.579 | 0.754 | 0.895 | 0.955 | 1 |

| x | 0.25 | 0.5 | 0.75 | 1.0 |
|---|---|---|---|---|
| SCurve | 0.087 | 0.5 | 0.913 | 1 |

The whole `SCurve` table is read since (`SCurve::init` 0x08658030, AI-75):
`bot-sense.js SCURVE_TABLE` / `sCurveExact` carry it for the information
security; the behaviours still use the samples above.

## Avoid

- **Inputs**: every other player on foot (`_urgencyAvoid`).
- **Urgency**: for a soldier closer than 1.2 m (`2 x 1.0 x 0.6`) whose
  velocity relative to the bot is at least 0.2 m/s, `|v_rel| / d`; the
  largest, x mod. The soldier's `avoidCollisionLookAhead` is 0, so the
  engine's collision prediction reduces to bodies already touching. Statics
  and parked objects are the map's and the follower's business
  ([movement.md](movement.md)).
- **Curve** UCUnion. While active: MoveTo x0.3, Special x0.5.
- **Plan** (`_planAvoid`): one `InfanteryMoveToDirection` 45 deg off the
  facing, on the side away from the body, 5 m, ended after 0.5 s
  (INVENTION: the engine's step is a second of travel, ended at 1.1 x the
  time to contact or within 5 m).

*Example.* A teammate 1.0 m away crossing at 2 m/s: `2 / 1.0 = 2.0`, beats a
MoveTo order at 1.5 .. 3.0 only while it lasts.

**In an aircraft** (the pilot; ledger AI-95) the engine's prediction runs in
full (`bot-pilot.js airAvoid`): every other hull of the bot's side, the
neutral ones and the enemy ones whose crew the side knows, within `5 x speed
+ r`; the hulls as spheres (the local box's centre and half diagonal); a
collision within the 5 s look-ahead adds `mass x |relVel| / distance` (a
Spitfire's 2500 kg: about 1250 head-on at 200 m, far above anything else).
The plan is `BBPAvoidCollision3d`: fly to the point one second of travel
ahead turned 45 deg away from the other, `2 t` lower when below it (higher
when above), for `1.1 t`. Two Spitfires set head-on 600 m apart pass 29 m
apart (6.9 m without it). The ENGINE's own blind spot is kept: a pair whose
pursuit curves close late (two planes attacking each other) is predicted
only a second or so out, and a plane cannot turn in that time.

A soldier's Mobile plug-in has the same 5 s look-ahead (both ctors write
it, AI-95); the on-foot avoid above still uses none.

## MoveTo

- **Inputs**: the order (`waypoints`, [strategic.md](strategic.md)) or the
  nearest-enemy-flag fallback.
- **Urgency** (`_urgencyMoveTo`): `order.urgency(x, z, pathRadius, y) x
  mod`: for a `WPMoveTo`, 0 inside `round(R) + pathRadius` of its point, else
  `clamp(d² / 4 (round(R) + pathRadius)², 0.1, 1) x factor`; for an air
  order the `WPAltitudeMoveTo` form ([strategic.md](strategic.md)); the
  fallback `clamp(d² / 4 (5 + 1)², 0.1, 1) x 2`. `pathRadius` is 1.0 on foot,
  `0.99 x max(0.5, radius)` mounted. A seat that does not drive publishes the
  value (`_orderUrgency`) and returns 0 (`BBMoveToFixed`): gunners and fixed
  guns never walk. A new waypoint object is a changed target.
- **Curve** UCUnion.
- **Plan** (`_planMoveTo`): one `InfanteryMoveTo(point, arrive R, stand)`,
  the point's height the air order's when it has one; kept while the
  waypoint object is the same.
- **End**: never by itself; the urgency is 0 on arrival and inside an owned
  area's box, and at least `0.1 x 2 x 1.5 = 0.3` short of a hostile one.

*Example* in [strategic.md](strategic.md#6-the-order-_order-wpmoveto): 3.0
from 60 m, 2.72 from 40 m of `easternbase`'s point, 0 inside 21 m.

## Idle

- **Urgency**: `mod` (0.1); never 0.
- **Plan** (`_planIdle`): `InfanteryResetControls`, persistent. A plane that
  flies or rolls faster than 0.1 m/s instead holds a `MoveTo3d` to its own
  position under `ConFalse`: an orbit ([controls.md](controls.md)).

## Fire (on foot)

`bot-fire.js scoreTargets`, the score over the whole spotted list.

- **Inputs**: every memory record (seen and lost), the bot's AI weapons
  (their `ammo` follows the page's magazine), the attacker map, target
  velocities, the current target and score, whether the bot is inside its
  ordered area, the water depth, the bot's speed.
- **Gate**: water deeper than 0.75 m at the bot: urgency 0.
- **Weapon value**, per weapon, against the target's class:
  `round(strength[class]) / (1 + (20 (shots - hits) + 10) / ammo)`, `ammo`
  -1 read as 65536, `shots - hits` the memory record's tally for this target
  and weapon slot, a healing weapon 0. The best weapon is kept per target.
- **Per target**:

  ```
  d        = max(0.5, 3D distance)
  sight    = 1, or 1 / (1 + 0.05 (now - lostAt)) for a lost record
  attacked = 1.5 - 0.5 clamp((now - attackedAt) / 30), 1 if it never shot at the bot
  in range (d <= maxRange):  speed = 1 / (1 + 0.5 |v|)
  beyond:                    speed = 0.25 (0.25 / (3 + 0.5 |v|) when 5 m higher);
                             skipped when d - maxRange > 5 x 5.0 (the mobile size, INFERRED)
  range    = max(0, 1 - d / (1.5 maxRange))
  rangeF   = (minRange + 0.1 (maxRange - minRange)) / d
  area     = 1, 0.75 outside the ordered area
  strength = round(soldier table[class]) x area x 0.5
  jitter   = max(0, -0.22 u + 1.3), u a fixed pseudo-random in [0, 1) per target id
  score    = jitter x range x value x sight x speed x attacked x area x strength x rangeF
             (x 0.33 when strength <= 0)
  ```

  `maxRange` / `minRange` are the largest / smallest over the bot's weapons.
  The area factor enters twice (see [README](README.md#divergences-from-the-research-found-while-writing-this)),
  and since `ee729113` never applies: the order no longer answers "inside"
  ([strategic.md](strategic.md#6-the-order-_order-wpmoveto)).
- **Switch**: the current target keeps its place unless another scores 1.2x
  it. A target change is a changed target (re-runs the contest) and stamps
  `firingTargetTime` (the deviation's settle clock).
- **Urgency**: `Declein(2 x score) x mod`.
- **Curve** UCFire.

*Example.* A K98 (strength 4, range 0..200, 25 rounds) and a Colt against a
still soldier seen at 80 m, jitter 1.135 for his id: value `4 / (1 + 10/25) =
2.857`, range `1 - 80/300 = 0.733`, rangeF `20 / 80 = 0.25`, strength `4 x 1 x
0.5 = 2`; score `1.135 x 0.733 x 2.857 x 2 x 0.25 = 1.19`; urgency
`Declein(2.38) = 1`, x7.5. At 180 m: range 0.4, rangeF 0.111, score 0.288,
`Declein(0.576) = 0.918`, urgency 6.88. At 230 m (30 m past the K98's range,
more than 25 m): not scored.

- **Plan** (`firePlanFor`), per target:
  1. `SoldierPose`: the first of prone, crouch, stand whose eye (0.4 / 1.1 /
     1.6 m) has a clear line to the target's +1 m.
  2. farther than `0.9 maxRange`: `InfanteryMoveToObject` to `0.9 maxRange`;
     closer than `minRange + 1`: `InfanteryMoveTo` to a point `2 minRange + 5`
     from the target, away from it.
  3. `MouseTurretAimAt` the target, after the move.
  4. `Trigger` (a `burst 0` weapon, `1 + floor(rand x 10)` shots, at most 10)
     or `TriggerContinously` (a burst weapon), after the move, tolerance
     `atan(max(0.4, 0.25 x 3.0) / d)`.
- **End** (`_firePlanDone`): 3 s, the shot count, an empty magazine, the
  target destroyed. The next tick builds a fresh plan if Fire still wins.
  Not built: the overheated-barrel end (`heat < 0.8`) on foot. The 20 s
  give-up veto (`vetoedTargets`) is read and expired but nothing writes it,
  and in retail nothing does either: its only writer runs when
  `detectAimingFailure` returns true, which it never does (AI-72).

## Fire (mounted)

`scoreVehicleTargets`, by the unit's `AIbehaviours.con` row (its
`equipmentType`; `bot-perception.js fireMode`, AI-124): `mode 'infantry'`
(`scoreMountedInfantry`, `BBFire::calculateUrgency` 0x08563570) for Tank,
Fixed and LandingCraftFixed units: the spotted list only, no minRange cut,
the range factor from the chosen weapon, a fixed gun only what its camera
points at and, in range, sees; `mode 'largeBore'` (below) for Boat,
BoatFixed and FixedLargeBore; `'air'` for an aircraft. A tank's trigger runs
only while the approach's S holds, with the precision alone (AI-125), and its
approach closes on the first valid pixel toward it when the target stands on
a blocked one (AI-126). The large-bore rule:

- Same weapon value; a weapon whose `minRange` the target is inside scores 0
  (large bore); a fixed weapon must be able to point at the target
  (`_turretCanPoint`).
- **Base**: an enemy-manned vehicle over every seat,
  `sum (seat.table[myClass] + 1 + myTable[seatClass]) x classValue[seatClass]`
  (x0.33 when the seats' `table[myClass]` sum is at most 0, the harmless
  threshold); anything else `myTable[class] x classValue[class]`; x the
  order and area factors. Class values 1, 3, 8, 15, 1, 6 (Infantry,
  LightArmour, HeavyArmour, NavalArmour, Submarine, Air; AI-64). Security is
  1 here: the engine's is the side's `1 - SCurve(age / degeneration)`
  (AI-72, AI-75; [sensing.md](sensing.md#what-a-side-knows)), which the enemy
  tables use and this scoring does not yet (`BotSenses.securityOf` holds it;
  INVENTION).
- **Distance**: large bore `1 - clamp(1.5 d / maxRange, 0.1, 1)`; air,
  ground target `min(1, d / (3 maxRange))`, air target `max(0, 1 - d / (1.5
  maxRange))` (x2 base for anti-aircraft guns), times a facing term
  `max(0.5, forward . dir + 1) x 0.5`.
- **Movement**: a non-mobile target 1; in range `1 / (0.5 |v| + 1)`; beyond,
  an escaping target `0.25 / (0.5 |v| + 2 max(0, dv.dir) + 2 max(0, dv.side)
  + 1)`, else 0.25; a ground unit against an aircraft: non-AA guns 0 beyond
  half their range or against more than 15 m/s, AA guns 1 inside 0.9 of it.
- **Unspotted enemies** (`getEnemyObjects`): when no spotted enemy scores
  above 0 and the current target is not a spotted one, enemies within 850 m
  (a `ground`, `tank`, `ship` or `gun` unit), 600 m (an aircraft) or 75 m
  (anything else) are scored with `value = strength / (10 / ammo + 1)`, x0.75,
  and the urgency is `Declein(2 x score) x score`.
- Hysteresis 1.2; `Declein(2 x score)`.

*Example.* A Sherman gun (Infantry 10, range 2..250) against a still soldier:
base `10 x 1 = 10`, value 10; at 40 m distance `1 - 0.24 = 0.76`, score 76;
at 100 m 40; from 166.7 m on, 0 (the clamp reaches 1 at `d = maxRange /
1.5`).

- **Plans**: a tank runs `BBPFireInfantery` (the Tank row of
  `AIbehaviours.con`), but a unit that moves and drives on other controls
  than it aims with takes its own branch (`createPlanInternal` 0x085a74e0
  from 0x085a7c5e; AI-116): the look (`LookAtObject` 5 deg) and the trigger
  run beside one statement re-evaluated every tick,
  `If(S, reset the drive, If(target within mid, If(target within 1.5 minRange
  + 1 of the firing point, End, go to the firing point), MoveToObjectFinding
  to the target))`. S is the target within `minRange .. 0.9 maxRange` (3D),
  a valid aim (the seat's camera window) and a line of fire (the memory
  record of it seen); mid is `minRange + min(50, 0.5 (maxRange - minRange))`,
  52 m for the 2 .. 250 m main guns; the finding paths to the target with the
  goal radius `min(0.9 maxRange, 1.1 x its radius)` and searches again when S
  is lost. The firing point is the bot's own position (the away point when
  the target is inside `minRange + 1`; the engine's attack-portal case is not
  ported), so inside mid without S a tank holds. `bot-plans.js planFire`,
  `execFireApproach`; `bot-fire.js fireApproachStep`. The runner's North
  outpost pair (K's, 158.7 m, the line blocked both ways): the old plan sat
  in Fire 120 s, 0 rounds; the approach closes to 42 m in 15 s and the
  PanzerIV's 4 rounds put the Sherman at 43 HP before its crew bails at 41 s
  (`tests/test_sim_vehicles.py`). An aircraft's plan is the attack loop in
  [controls.md](controls.md#the-attack-loop).

## Scout

`bot-behaviours.js ScoutState.evaluate`.

- **Inputs**: the quadrant inertias, incoming fire, heard enemies (threat 4,
  INVENTION), lost records, attackers.
- **Interest** per quadrant: `inertia x 0.01` (0.005 while TakeCover is
  active) plus: fire `max(0.1, strength / (age x rate + 1))`; heard `threat`;
  lost `threat / (0.01 d + 1) x (now - lastSeen)`; attacker `10 x strength /
  (age x rate + 1)` (that quadrant's boost 1.0, else 0.75).
- **Direction**: the winning quadrant's strongest non-fire source, else the
  quadrant's own direction turned by `(1 - min(25, inertia) / 30) x (rand -
  0.5) x 45 deg`. Within 5 deg (0.087) of the camera: no scout (urgency 0).
- **Urgency**: `Declein((accum x 0.2 + sum x 0.1) x boost) x mod`, `sum` over
  quadrants 1..7 (the code skips quadrant 0). `accum` starts at 100 and is 0
  from the tick after the first `Sense` completes; it is also zeroed when
  scouting has run 5 s. A new quadrant is a changed target.
- **Curve** UCScout.
- **Plan** (`_planScout`): `SoldierPose` (prone within 1.5 s of a hit, else
  stand; the engine's crouch-in-danger is not built), `MouseTurretLookAt`
  the direction (persistent), `Sense` (complete within 10 deg). Kept while
  the new direction is within `acos 0.95` (18 deg) of the plan's.

*Example.* A fresh bot: `Declein((20 + ...) x 0.75) = 1`, x1 mod, x3.28 once
active: a spawned bot looks around first. After its first Sense, with every
quadrant at 10 s inertia and nothing else: `sum = 7 x 0.1 = 0.7`,
`Declein(0.0525) = 0.153`.

## TakeCover

`bot-behaviours.js TakeCoverState.evaluate`, `_planTakeCover`.

- **Inputs**: incoming fire (with the shooter's position), heard enemies
  (security 1, threat 4), spotted records (threat 4), the cover list (the
  level's placed objects with an `aiTemplatePlugIn.coverValue` within 20 m,
  their extents from the collider: PAGE `buildBotCovers`), the collider's
  line test, the map.
- **Danger** into eight bins, and a total:

  ```
  fire     s = strength / (age x rate + 1) x clamp(1 - age / 3), x2 when it hit
  heard    s = security x threat / max(2, d)
  spotted  s = threat² / max(2, d), x (0.5 + 0.5 (1 - min(age, 30) / 30)) when not seen; 2s into the bin
  ```

  The threat is the largest contributor in the largest bin. A heard or
  spotted threat must see the bot (a line from its +1 m to the bot's +1 m)
  or the urgency is 0.
- **Cover choice** (`chooseCover`): skip a cover past the halfway line toward
  the threat; the standing point is `traceValidPoint(cover + 0.75 R n, cover
  + 2 R n)` along threat -> cover (the first free cell outward); score
  `base x coverValue / distance`, `base = 0.25 clamp(0.2 width / 0.6) + 0.75
  clamp(0.5 height / 1.8)`. A cover is not a condition of the urgency.
- **Urgency**: `Declein(total) x Declein(clamp(d_threat, 2, 100) x 0.01) x
  mod`, recomputed only when the cover id changes or is -1, else the stored
  value; the radio term is 0 (INVENTION).
- **Curve** UCUnion.
- **Plan**: `InfanteryMoveTo` the standing point (arrive 4 m), then the pose
  ladder (stand if the danger still has a line to the standing eye, else
  crouch, else prone) and a persistent look at the danger. With no cover:
  the lowest walkable ground in a 100 m box on the far side (4 m grid),
  prone. Kept while the danger has moved less than 3 m (1 m for an object).

*Example.* Hit 0.5 s ago by a rifleman 50 m away whom the bot sees: fire `1 /
1.5 x 0.833 x 2 = 1.11`, spotted `16 / 50 = 0.32`, total 1.43; `Declein(1.43)
x Declein(0.5) x 2.0 = 1 x 0.895 x 2 = 1.79`. A MoveTo order at 3.0 still
wins; a bot with no order (Idle 0.1) takes cover.

## Special (MedicAssist)

`bot-behaviours.js MedicState.evaluate`, `_planSpecial`.

- **Applies** to a bot carrying a `weaponTemplate.healing 1` weapon with more
  than one round (the MedPack; the RepairPack heals armour classes only).
  Not deeper than 0.75 m of water.
- **Inputs**: friends of the bot's side within 60 m (INVENTION) on foot, with
  `0 < health < 0.95`, upright, on a walkable cell when out of reach.
- **Urgency**: `term = value / (max(0.5, d) x SCurve(health))`, value 1
  (INVENTION), x0.75 outside the ordered area; `Declein(sum term) x 4 x mod`;
  the target is the largest term. A new target is a changed target. Since
  `ee729113` a medic holding a strategic order throws here as soon as a
  wounded friend passes the filters (the order has no `inside`); without an
  order it runs as written.
- **Curve** UCUnion.
- **Plan**: stand; `InfanteryMoveToObject` to `R + 0.9 x maxRange` (1 + 2.25
  = 3.25 m); aim; `TriggerContinously` within 5 deg. The page heals 0.3 HP a
  MedPack round (10 rounds/s) on the friend nearest the aim within reach +
  0.5 m and 20 deg (PAGE `resolveBotHeal`, INFERRED cadence).
- **End**: the friend gone, at 95 % or more, farther than `arrive + 2 m`, or
  the pack dry.

*Example.* A friend at half health 10 m away: `1 / (10 x 0.5) = 0.2`,
`Declein(0.2) x 4 = 2.32`: a medic with no order goes; one with a MoveTo
order far from its point (3.0) does not.

## Change

The on-foot, seated and seat-swap urgencies and their plans are in
[vehicles.md](vehicles.md). Curve UCUnion; while active, MoveTo is inhibited
(x0).

## The interpreter

`_runPlan` runs every action of the plan every tick, in order, except that
an action marked `afterMove` waits while any `InfanteryMoveTo` /
`InfanteryMoveToObject` of the plan is unfinished. An action that completes
is marked done; when every non-persistent action is done and none is
persistent, the plan empties and the next tick regenerates it.

| action | executor | completes |
|---|---|---|
| `InfanteryMoveTo`, `MoveToMediumSoldier` | `_execInfantryMoveTo` (the follower, the tank law, the plane or boat law) | inside `arrive` (3 m default) |
| `InfanteryMoveToObject` | the target's live position, then as above | the same |
| `InfanteryMoveToDirection` | steer at a point `distance` along the direction | at `until` |
| `MouseTurretAimAt` | `_aimLook` at the target's +1 m, 4 counts a tick | every tick |
| `MouseTurretLookAt` | a direction or a point, 4 counts a tick | every tick |
| `Trigger`, `TriggerContinously` | fire while the facing is within `max(tolerance, 5 deg)` and a line to the target is clear | never (the plan's end conditions) |
| `SoldierPose` | a stance, or the TakeCover ladder | at once, then held |
| `Sense` | marks the tick as scouting | look within 10 deg |
| `InfanteryResetControls` | zero the controls, drop the route | at once |
| `EnterVehicle` / `ExitVehicle` / `SwitchSeat` | a request to the page | when seated / unseated / reseated |
| `PlaneAttack` | the aircraft attack loop | never |
| `InfoWrapper` | nothing | at once |
