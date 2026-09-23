# Bots: the behaviour layer, sensing, the strategic AI and spawning — the read

**Date:** 2026-09-23. **Binary:** `bf1942_lnxded.static` (the corpus copy,
interchangeable with the patched one per AI-25), decompiled headless with
`features/bf1942-engine-reference/lnxded/decompile.sh`: 656 functions across
the behaviours (`BB*`, `BBP*`, `UC*`, `BotBehaviour`, `BotMemory`), the
entries (`EntryTrigger`, `EntryMouseTurretAimAt`, `EntrySense`), `BotMain::
sense / updateMemory / updateHearingMemory / event_*`, and 438 across the
strategic AI (`SAI`, `SAIMap`, `AIStrategicArea`, `Strategy*`, `WP*`,
`BotSpawner`, `BotManager`). Six summarising passes, each told to quote the
line behind every claim and to mark inference; the raw C decided where they
disagreed, and the small functions and the x87 curve bodies were read by hand.
`INFERRED` marks what the code implies but does not state.

This closes README §7 Stage 3 ("it plays the game") as research, and most of
it is built: `viewer/bot.js`, `bot-sense.js`, `bot-fire.js`,
`bot-behaviours.js`, `strategic.js`, and the extractor's `bf42/ai_level.py`.
The movement half is `bot-movement-and-pathfinding.md`.

## 1. Sensing — corrections to `ai-22-sensing-decoded.md`

`BotMain::sense` **0x08521cf0** is a state machine (`+0x110`), not one pass:

- **Three nested frustums**, one per sub-state (`+0x10c`, cycling 0 → 1 → 2 →
  0 per completed pass), each over a band of the view distance
  (`tweak_frustumUpdateStateMinMaxDistances` 0x086ffed8: 0 .. 0.5, 0.5 ..
  0.75, 0.75 .. 1.0) with its own full field of view
  (`tweak_frustumUpdateAngle` 0x087d0860, radians into `Frustum::setupFrustum`
  0x08440c70 which halves them): **infantry 100° / 60° / 30°, a vehicle 75° /
  45° / 15°**; near plane 0.01. The sub-state snaps back to 0 when the camera
  turns past 25° / 15° / 7.5° (18.75 / 11.25 / 3.75 for a vehicle). The old
  53° / 113° figures were a misread of the half-angle constant.
- **The side filter** is `SideFilter::predicate` 0x08533120: own side out;
  side 0 only if the object is a unit; inside `viewDist²`. `updateMemory`
  also purges any remembered object that is now on the bot's side.
- **The rays**: `n = clamp(round(30 * boundingRadius / distance), 1, 10)`
  rays from the eye to random sense points on the target (`pickSoldierRandom
  SensePosition`, env vtable +0x60, for a soldier; `pickRandomSensePosition`
  +0x5c otherwise), tested with `collideLineWithWorld` (+0x54, ignoring self,
  target and the target's vehicle); the first clear ray spots it
  (`event_SpottedEnemyObject` 0x08523ae0, which also tells every bot in the
  same vehicle). The "10 steps of 0.8 m" was a misread of the 5th argument.
- **The firing target is not set here.** `setFiringTarget` has no call from
  `sense`; it is written by `BBFireInfantery::initializeGenerator` from the
  Fire behaviour's own scoring (§3). Sorting by distance only orders the rays.

`updateMemory` **0x085244e0**: every remembered object inside the near
frustum is re-tested; seen refreshes it, the first miss marks it lost with a
timestamp, and the entry is erased **60.0 s** after that. The remembered point
is a body-fixed offset re-projected through the object's **live** transform,
so a bot knows where a lost enemy really is until the memory expires. The
spotted list the Fire behaviour scores is rebuilt from every entry, seen or
lost.

`updateHearingMemory` **0x085240e0** / `soundPerceptionCalculation`
**0x08523290** / `event_soundEmitter` **0x085237c0**: a bot is **deaf for 3.0
s after its own shot** (`+0x118`, `event_firing`); an emitter that fired within
3.0 s is heard inside its weapon's sound radius, otherwise any mobile enemy
inside the listener's sound sphere (`setSoundSphereRadius 0 15` on the
soldier) unless that soldier is crouched or prone; the probability roll
`((1 - d) * pMin + d * pMax) * (1 - x) < rand` uses `x = max(speed /
maxSpeed, 1)`, so for any listener with a mobile plug-in the product is ≤ 0
and **hearing is deterministic inside the radius**. A heard object is kept
**30.0 s**.

Incoming fire: `event_projectile` **0x085269e0** appends a `FireObject`
(strength per armour class, time, decay rate); `updateMemory` sums
`strength / (age * rate + 1)` (×10 for a hit) over a list that lives
`min(60 / n, 5)` s and keeps an attacker map for `max(300 / n, 10)` s that
`isAttacking` **0x08526950** reads. `event_shotHit / shotMissed / shotTimeOut`
are feedback on the bot's **own** shots.

## 2. The decision loop — `BotMain::decisionMaking` 0x08520620

- `calculateMods` **0x08525b80**: `currentMods[i] = moral[i] * personality[i]
  * basic[i]` (with an order's multipliers when taking orders). `personality`
  is `StandardWeights` (`setStandardPersonality` for both sides: Fire 7.5,
  TakeCover 2.0, Change 1.9, MoveTo 1.5, Idle 0.1, others 1.0); `basic` is
  `UnitWeights` (all 1). The moral mode is drawn **once at construction**
  (`BotMoralAdmin::moralUpdate` is called only from the two `BotMain`
  constructors; `BotMain::moralUpdate` has no caller), so `moral` never
  changes in 1.61.
- With no plan, behaviour `i` is evaluated with `mod = currentMods[i]`. With
  a plan, `mod = BotMemory::modifyBehaviourUrgency(...) * active.modifiers[i]
  * currentMods[i]` where the first factor is the **active behaviour's
  `UrgeCurve` over the seconds it has been active** (1.0 for every other
  behaviour, `BotMemory::modifyBehaviourUrgency` 0x08533bd0) and the second
  the active behaviour's own modifier column — `AvoidInhibit` (MoveTo 0.3,
  Special 0.5) while Avoid is active, `UnitWeights` otherwise for infantry. A
  behaviour with `mod <= 0` is not evaluated and keeps its old urgency.
- The curves (x87, since Ghidra emitted empty bodies): `UCConstant` = c;
  `UCLinear::calculate` **0x085838f0** = `max(0, a * x + b)`; `UCXInverse::
  calculate` **0x08583a50** = `max(0, a / (c * x + b) + d)` with the con's
  four arguments in order. `UCFire linear -0.22 1.3` reaches 0 after **5.9 s**
  as the active behaviour, which is what re-opens the contest for a bot that
  has been shooting; `UCScout XInverse 2.5 0.9 1.0 0.5` is `2.5 / (x + 0.9) +
  0.5`.
- The winner is the **strict maximum** of `urgency[bot]` over the registered
  behaviours (`UrgencyMerger::updateActiveUrgency` 0x08534dc0). With a plan,
  re-selection happens only when `UrgencyMerger::hasChanged` **0x08534f30**
  fires: some behaviour's `urgency / activeUrgency` outside **0.87 .. 1.15**
  (`quotientChanged` 0x08583540), appeared from 0, dropped to 0, or reports a
  changed target. `activeUrgency` is the snapshot taken at selection. The
  con's `setPlannedDecisionMakingThreshold` / `setUnplanned...` values are
  stored at `BotManager+0x60..0x88` and **never read** (dead in 1.61).
- The winner's `generatePlan` **0x08583380** runs every tick; the same plan
  object is kept, a different one resets all controls. `prio` only orders the
  evaluation lists under CPU starvation; the parallel mask has no consumer.
- "NEVER ALLOW IDLE's urgency to become 0": with every urgency at 0 the merger
  picks nothing and `decisionMaking` dereferences NULL.

## 3. Fire — `BBFire::calculateUrgency` 0x08563570 and the infantry plan

- **Not the nearest visible enemy.** Every spotted entry is scored (for an
  infantry bot only the ones it sees now, see `sightAge` below): per weapon
  `strength[targetType] / (1 + (20 * (shots - hits) + 10) / ammo)` picks the
  weapon (the `setStrength` table of `Ai/Weapons.con`, `ammo` the weapon's
  `getAmmo()`, −1 read as 65536), where **`shots` and `hits` are the memory
  record's own per-weapon-slot tallies for that target** (+0x34 and +0x54,
  eight slots) — a fresh target starts every weapon clean, and a string of
  misses on one target walks the choice down to the knife; the score is `curve * range * bestWeapon * sightAge *
  speed * attacked * area * strength * rangeFactor` with `range = max(0, 1 -
  d / (1.5 * maxRange))`, `rangeFactor = (minRange + 0.1 * (maxRange -
  minRange)) / d`; `sightAge` is 1.0 for a target the bot sees now (the
  memory record's lost byte at +0x14 clear) and `1 / (1 + 0.05 * (now -
  lostAt))` for a lost one (+0x18); beyond `maxRange` the target is kept
  while `d - maxRange < 5 * size` with `size` the bot's `IPIMobile` +0x14 →
  +8 term (5.0 for a soldier, the same factor behind the 25.5 m obstacle
  drop); the null test on `Information+0x2c` beside both is the bot's mobile
  object, which every bot has (the obstruction detector dereferences it
  unconditionally) — **not** an infantry test, as a first reading on
  2026-09-23 had it; `speed = 1 / (1 + 0.5 * |v|)` inside range and 0.25
  beyond, `attacked =
  1.5 .. 1.0` over 30 s for an attacker (`isAttacking`), `area = 0.75` when
  the bot is outside its ordered area, and `strength` the target's own
  `setBattleStrength` against the bot's class (×0.5), ×0.33 when harmless.
  **UCFire's `x` here is a per-target pseudo-random in [0, 1)** (jitter ×1.08
  .. ×1.30), not a distance. A new target replaces the current one only at
  **1.2×** its score. A bot wading deeper than **0.75 m** does not fire. A
  target the plan gave up on is vetoed for **20 s** unless someone moves at 2
  m/s. The returned urgency is `DecleiningSlopeCurve(2 * best)`.
- `BBPFireInfantery::createPlan` **0x085a3870** / `createPlanInternal`
  **0x085a74e0** / `createFirePlan` **0x085ac240**: `getFiringPose`
  **0x085a26f0** tries **prone, crouch, stand** (the first whose eye still
  sees the target); the weapon is changed to the chosen one, a reload pulse
  when the magazine is empty; out of `0.9 * maxRange` the bot walks closer
  (`BAPAMoveToObjectFinding`), inside `minRange + 1` it backs off to `2 *
  minRange + 5` (`calculateAwayPosition`); `BAPALookAtObject` turns within
  **5°** (0.0873), the aim condition's tolerance is `0.25 * the target's
  extents` (at least 0.4 m); a single-shot weapon (`burst 0`) fires **one
  one-tick pulse per `BAPATrigger`** with a shot counter of up to 10, a burst
  weapon holds the trigger (`BAPATriggerContinously`) while aligned; the plan
  ends on the target's death, an empty magazine, an overheated barrel
  (`heat < 0.8`, re-arm at 0.5) or **3.0 s**. Decisions 2 / 3 / 4 move to an
  "away" point or a cover portal before firing (weighted random). There is
  no strafing in the fire plan.
- `EntryTrigger::execute` **0x086257d0**: on `c_PIFire` / `c_PIAltFire` it
  hands the weapon `setBotSkill(getBotSkill(), firingTargetTime, extra)` with
  `extra = 0` against infantry, **30** against a vehicle (10 for a primary or
  occupied one; 3 / 1 for the continuous entry). No angle test of its own —
  the aim condition is the plan's. `EntryMouseTurretAimAt` **0x08619ac0** →
  `mouseControlLookAtDirection` **0x08627b90**: `log10(9 v + 1)` response
  shaping, mouse counts capped at **±4.0 a tick**, a target behind forces the
  pitch to ±π/2. `BAPAAimAt::correctAim` 0x0853a6d0 nudges the aim by `0.8 ×`
  the last miss.

## 4. Scout — `BBScout::calculateUrgency` 0x08579a50, `BBPScoutInfantery::createPlan` 0x085c5070

Eight sensing quadrants (`computeQuadrants` 0x08579150, 25° / 45° cones)
each carry an inertia (`BotMain+0x1f0`: seconds since the camera covered it,
`updateSensingQuads` 0x0852ee00). Interest per quadrant = `inertia * 0.01`
(0.005 under a TakeCover plan) + incoming fire (`strength / (age * decay +
1)`, floor 0.1) + heard enemies (their threat, aged over 30 s when not heard
directly) + lost sightings (`threat / (d * 0.01 + 1) * age`) + attackers
(`10 * strength`, ×3 into danger, boost 1.0 instead of 0.75). The winning
quadrant's direction (an object's, or `getQuadRecommendedLookDirection`'s
22.5° jitter) is the look target; one within **5°** of the camera is no
scout. `urgency = DecleiningSlopeCurve((accum * 0.2 + interest * 0.1) *
boost)` with `accum` starting at **100** (a fresh bot looks around at full
urgency) and zeroed when the `Sense` instruction completes (look within
**10°**, `EntrySense` → `setInvAttention(0)`). **The plan does not move**:
`ResetControls; { BAPICScout; LookInDir(dir); Sense(LookDeviation 10°);
SoldierPose(stand / prone under fire / crouch in danger) }`.

## 5. TakeCover — `BBTakeCoverInfantry::calculateUrgency` 0x08580140, `getCoverObject` 0x08581a70, `BBPTakeCoverInfantry::createPlan` 0x085c97d0

Danger by quadrant: incoming fire fading over **3 s** (×2 when aimed), heard
enemies `security * threat / d` attenuated by `1 - SCurve(d / weaponRange)`
(ignored beyond it), spotted enemies `threat² / d` (×0.5 .. ×1 by staleness
over 30 s, ×2 into the bin). The threat must be able to see the bot
(`collideLineWithWorld` threat → bot) or the urgency is 0. Cover candidates
come from `BFEnvironment::getCover`; one lying past the halfway line toward
the threat is refused; the standing point is `traceValidPoint(cover + 0.75 R
· n, cover + 2 R · n)` along threat → cover — the **first walkable** point
from 0.75 R behind the cover outwards to 2 R, so a point inside the cover's
own footprint is pushed out to its far edge; no walkable point on that
segment refuses the cover (a cover with portals: 2 m inside the doorway);
score `base * coverValue / distance` with `base = 0.25 *
clamp(0.2 * widthRatio) + 0.75 * clamp(0.5 * heightRatio)`. **A cover object
is not a condition of the urgency**: `getCoverObject` only fills the plan's
point and id (−1 when none). `urgency = Declein(total) * Declein(d * 0.01)
* k * (1 + radio)` with **`d` the distance to the threat** clamped 2 .. 100
m and `radio` the strength of radio message 0x29 (0 in the viewer), halved
in a vehicle; it is **recomputed only when the cover id changed or is −1**
(the per-slot flag at `+0x1c`) and otherwise the stored value is returned,
0 once the danger total is 0. The plan walks
there (arrival `max(4, 0.5 * maxSpeed)`), then the pose ladder (stand if the
danger is still in the line of fire, else crouch, else prone) and a look at
the danger; without cover it walks to the **lowest ground in a 100 m box on
the far side** (4 m grid) and goes prone. Plan reuse while the danger moves
less than 3 m (1 m for an object). `DecleiningSlopeCurve` **0x08655560** and
`SCurve` **0x08658420** are 101-entry tables (Declein: 0.146 at 0.05, 0.292 at
0.1, 0.579 at 0.2, 0.754 at 0.3, 0.895 at 0.5, 0.955 at 0.7; SCurve logistic
0.087 / 0.5 / 0.913 at 0.25 / 0.5 / 0.75).

## 6. Idle, MedicAssist, Change

`BBIdle::calculateUrgency` **0x08572550** returns its modifier (0.1 with the
standard personality); `BBPIdleInfantery::createPlan` **0x085bea00** is
`while (true) ResetControls(1, 1, 1)`.

**MedicAssist (`Special`)** — `BBMedicAssist::calculateUrgency` **0x08573840**
and `BBPMedicAssist::createPlan` **0x085bf350**, read in full 2026-09-23:

- `isAplicable` **0x085748e0**: the bot carries a weapon whose template has
  `weaponTemplate.healing 1` (vanilla: `MedPackAI` strength Infantry 2,
  `RepairPackAI` strength 2 for every armour class; both `maxRange 2.5`).
- Not while wading deeper than **0.75 m** (the same gate as Fire; the bot is
  un-inited and its urgency zeroed).
- Per healing weapon with more than one round, the best `strength[type]` per
  target type and that weapon's `maxRange²`. The friends come from
  `IAIEnvironment` +0xc at the bot's position (radius not read); each with
  the unit flag set, a healing weapon for its type, and health `h` with
  **0 < h < 0.95** is kept when its up vector against the ground normal is
  ≥ **0.7071** and its `AIObjectUnit` +0x17 byte is clear (not inside another
  object); beyond the weapon's range it must stand on a valid cell of the
  bot's map (`isValidPosition`) — or, for a vehicle-type friend, a valid
  point along its reverse heading (`traceValidPoint`).
- Each keeps `term = value / (d × SCurve(h))` with `value` the friend's
  `Information+0x14` (× the bot's outside-area factor when it stands outside
  the bot's ordered area); `sum += term`; the largest `term × (1 + radio
  strength of message 0x28 or 0x36)` is the target. `urgency = Declein(sum)
  × 4 × k`, the change flag is "target differs from the last", and
  `BBPMedicAssist::init(target)` is called.
- The plan: `ResetControls(1,0,1)`; the healing weapon through `BAPIWFire`;
  when farther than `R_target + 0.9 × maxRange` a `MoveToObjectFinding` there
  (re-planned when the target moves); `ResetControls(1,1,1)`; then `while
  (target exists && health < 0.95 && distance ≤ that && magazine has rounds)
  Parallel { LookAtObject within 5° (0.0873); Trigger PIFire }`.
- The MedPack itself is a `HandFireArms` with no projectile (`magType 1`,
  1800 "rounds", `roundOfFire 10`, `reloadtime 1.5`). The heal is the
  soldier's: `BFSoldier::useRepairPack` **0x08276100** queries the objects
  within the template's reach radii (+0x2ec / +0x2f0, constructor defaults
  3.0 and 2.0 m), takes the closest damaged armour whose owner is on the
  same side, and calls `Armor::heal(+0x2e0)` — the constructor default
  (`BFSoldierTemplate` **0x0827a210**) is **0.1**; no vanilla soldier con
  overrides these. The caller's cadence is not read: taken as the 30 Hz
  tick while the pack fires (INFERRED), so the viewer heals 0.3 a round at
  10 rounds a second — 3 hp/s, a 30 hp soldier in 10 s.

**Change** — `BBChange::calculateUrgency` **0x0855e0c0** scores nearby
enterable vehicles against staying on foot ×1.25 through
`calculateVehicleUrgency` **0x08583b10**, `DecleiningSlopeCurve(0.5 * best /
current) * (mod * 4)`; the full read is §8.

## 7. The strategic AI — `SAI`

- `SAI::update` **0x086306d0**: a budgeted state machine; the strategic pass
  (`prepareUpdate → updateStrategicObjects → chooseStrategy →
  modifyStrategicObjectsTemperatures → updateBotPositions →
  updateDistribution → distributeResources → distributeDefence /
  distributeAttack`) runs at most once per `getSAIUpdateFrequency` seconds
  (default not in the corpus).
- `SAI::updateStates` **0x086348c0** fills 48 named counters per side
  (`Conditional` enum 0x084878d0): Ticket, ControlPoint, Time, **StartTime =
  seconds since the current strategy was chosen**, Attacks, Defences,
  NumberOfFriendly / Neutral / HostileAreas, the flag counts (Flank, Base,
  Close, Centre, Remote, Route, Bridge, North .. East) with `Front*` variants
  for an owned area that touches a hostile one, Front, Safe, FrontNeutral,
  EnemyObject, UnReachable.
- `SAI::chooseStrategy` **0x08631cd0**: each strategy's score is
  `Strategy::calculatePrerequisite` **0x08639c40** → `StrategyPrerequisite::
  evaluate` **0x0863aa50**: per condition `v = compare * weight`; **Required**
  / RequiredPositive: `v < 0` kills the strategy; RequiredNegative: `v > 0`
  kills it; Advisory sums `v`, AdvisoryPositive `max(0, v)`, AdvisoryNegative
  `min(0, v)`; abort conditions count only while the strategy is active.
  `SCConstant::compare` **0x08639250** / `internalCompare` **0x0863a560**:
  Crisp gives ±1 (`Equal` `a - b == v`, `EqualGreater` `>=`, `EqualSmaller`
  `<=`, Quotient forms on `a / b`), Fuzzy the signed distance (`v - (a - b)`
  for EqualSmaller, `-|...|` for Equal, ±1000 for a zero divisor). The active
  strategy is kept while every `heat / score` ratio stays inside **0.83 ..
  1.2** and its TimeLimit × `(2 - 2^(1 - count))` has not passed; otherwise a
  **roulette** over the positive scores picks. A change frees every bot of
  the side (`changeStrategy` 0x08631940).
- `AIStrategicArea::update` **0x0863d6d0**: `attackTemp = unit strength in
  the area + base` (the `create` radius), `defenceTemp = base + static
  strength`; status from the control point's owner (`Owned` / `Hostile` /
  `Neutral`; an area without one: friends and no enemies → Owned when
  takeable); wanted strength `round((2 - SCurve(X)) * max(1, Σ present
  values))`, ×1.25 when not owned, with `X` (`+0xac + side*4`) never
  written. `updateTemperature` **0x0863e8b0** multiplies both temperatures by
  the strategy's modifier for each flag the area carries under its status,
  then `Enemy` for Hostile, `Front` / `Safe` for Owned with / without a
  hostile neighbour, `Neutral`. `calculateAttackValue` **0x0863e3f0**: not
  owned and touching an owned area → `attackTemp × (1.5 hostile neighbour |
  1.25 neutral neighbour) - cost` (`EnemyStatistics`); `calculateDefenseNeed`
  **0x0863e360**: owned → `(enemyStrength + attackTemp) × (2 - SCurve(X))`
  with the same neighbour factors.
- `SAI::distributeResources` **0x086329b0**: free bots become attackers or
  defenders in the strategy's **Aggression** ratio (1 with no owned area, 0
  with nothing left to take); `categoryDistributeAttack` **0x08633d00** takes
  the top `NumberOfAttacks` areas with value > 0.1 (up to 2N within 0.8× of
  the Nth), `categoryDistributeDefence` **0x086333b0** the top
  `NumberOfDefences` needs (within 0.9×); each target's `collectResources`
  **0x0863eb50** takes available bots from the nearest source areas until
  `present >= wanted`, then the targets round-robin one unit at a time
  (`collectAdditionalResources`); `releaseSurplus` keeps ≈110 % of wanted.
- `AIStrategicArea::orderNormalBot` **0x08640bd0**: a `WPMoveTo(radius =
  0.25 * area radius + 2 * unit radius, ...)` (at least **5**) at the area's
  position randomised inside 0.8 of its radius (20 tries for a valid map
  point, else the order position), 25 m up for the air bot variant. `WPMoveTo
  ::getUrgency` **0x085374a0** on the last point: `clamp(d² / (4 R²), 0.1, 1)
  × 2` for a non-owned area, ×1 owned and outside, 0 owned and inside;
  arrived when `d² < 2 R²`. `SAI::updateBotPositions` **0x08635bc0** re-orders
  an idle present bot every **20 s** (35 s in a vehicle). `BBMoveTo::
  calculateUrgency` **0x08574f80** is that urgency times the radio messages
  and the modifier. `BotMain::recieveOrder` **0x085211a0** (order multipliers
  of 1.3) has no caller in the dumped SAI: orders travel as waypoints.

## 8. Spawning — `GameServer::gameStatusPlaying` 0x08150df0, `BotSpawner`

- The AI never spawns a bot; it writes a spawn group and a kit into the same
  `BFPlayer` fields a human's spawn menu writes (`AIPlayer::setSpawnGroup`
  `+0x90`, `setSpawnKit` `+0x80`), and the game's spawn loop does the rest.
  `gameStatusPlaying` fills the server to `serverMaxPlayers` (capped by
  `aiSettings.setMaxNBots`) with `autoSpawnBots` set, the side from the
  game's own team balance (`getTeamToAddPlayer`). Dead players wait the
  game's spawn delay (`+0x8c`), the spawn sweep runs every third tick and
  spawns at most one player per sweep. **There is no bot-specific respawn
  timer.**
- `SAI::prepareUpdate` **0x08635210** calls `BotSpawner::findSuitableSpawn
  Group` **0x0864ac80** for every dead bot: with probability 0.5 the bot's
  last strategic target's group (the "nearest" comparison uses a constant
  `1e9` and never tightens, so effectively any eligible group), else
  `findSuitableSpawnGroup(side)` **0x0864b3e0**, a roulette over the side's
  eligible groups weighted by the nearest area's temperature plus
  `5 * 0.1 * maxTemp * (known empty vehicles - spawns already sent)`.
- `findKitDiff` **0x0864ba30** (x87): `1 + Σ (kit[i] * enemyTypes[i] *
  armourClassValue[i])²` over 6 classes; `SAI+0x18c` (enemy types) is only
  ever zeroed in the corpus, so the weight is **1 for every kit allowed on
  the side: the kit is uniform random**.

## 9. What the viewer built from this

- `bot-sense.js`: the three-band frustum, the side filter, the sense rays
  through the collider's ray, 60 s memory that tracks the live position,
  deterministic hearing with the weapon's sound radius and the 3 s deaf
  window, the incoming-fire ledger and attacker map.
- `bot.js`: the decision loop exactly as §2 (personality, the active
  behaviour's curve over its active time and inhibitor column, strict max,
  0.87 / 1.15 hysteresis, changed-target re-selection), the generators and
  plans for Avoid, MoveTo, Idle, Fire, Scout, TakeCover, the interpreter's
  entries (`Trigger` / `TriggerContinously` with the plan's aim tolerance,
  `MouseTurretAimAt` at the 4-count rate, `MouseTurretLookAt`, `Sense`,
  `SoldierPose` with the ladder, the movers), the movement half unchanged.
- `bot-fire.js`: the target scoring of §3 with the kit's `Ai/Weapons.con`
  templates (now in `_shared/loadouts.json` `aiWeapons`, keyed by item, with
  `ObjectTemplate.aiTemplate` recorded by `bf42/con.py`), the pose test, the
  approach / back-off ranges, the trigger modes.
- `bot-behaviours.js`: the two curve tables, the eight-quadrant Scout, the
  TakeCover threat sum and cover choice with the levels' `coverValue`s
  (`extras.ai.coverValues`, from `aiTemplatePlugIn.coverValue` per placed
  template).
- `strategic.js`: the areas bound to the control points, the states, the
  prerequisite evaluation and roulette, the temperatures and modifiers, the
  attack / defence targets, collection, and the `WPMoveTo` orders; `bf42/
  ai_level.py` + `patch_ai_extras.py` put every vanilla level's strategic
  scripts in its `scene.json`.
- `map.html`: kit choice uniform among the side's kits with the kit's AI
  weapons and its primary for the visual; every shot heard by every bot;
  every hit as incoming fire; the strategic pass per level; cover objects
  from the collider's owners; respawn resets the senses.

Deliberate differences, labelled in the code: `DecleiningSlopeCurve` is the
sampled table (Fire's too, since 2026-09-23); each bot's weapon rate,
magazine and deviation channels come from its weapon glb's `extras.weapon`
and the magazine is the page's own count; the radio-message term in
TakeCover's urgency is 0; `Change` and `Special` are not registered (no
vehicles, no healing yet); the Avoid behaviour uses the soldier's zero look-ahead
(touching bodies) and a half-second diagonal step; `SAIUpdateFrequency` is 5
s; the enemy-cost term in attack values is 0; unit strength is 1 per
soldier; `X` is 0 as in the binary; the viewer runs sensing every tick for
every bot rather than under the engine's time budget; a bot's respawn stays
the page's timer.

## 8. Vehicles: Change, the tank law, and what the viewer drives

Read 2026-09-23 from `BBChange::calculateUrgency` **0x0855e0c0**,
`calculateVehicleUrgency` **0x08583b10** and its file-local helpers
`calculateVehicleMoveUrgency` **0x08584310**, `calculateFireStrength`
**0x08584580** and `airOverheatBail` **0x08585750**, `BBChange::
modifyForDriver` **0x0855f7d0**, `getRadioStrength` **0x0855fc10**,
`isMannedByEnemy` **0x0855fcb0**, `isUpsideDown` **0x0855fcf0**,
`BBPChange::createPlan` **0x0858b5c0**, `EntryTankMoveTo::execute`
**0x08622e80** and `TankControl::controlTowardsDirection` **0x0862c670**
(ledger AI-43..AI-45).

- **The AI plug-ins carry the numbers.** A vehicle's `AI/Objects.con`
  (`extract_vehicle_ai.py` → `_shared/vehicle-ai.json`) declares its
  `Mobile` plug-in (`maxSpeed` — the Sherman 16, the Willy 25, a soldier 5;
  `turnRadius`; `vehicleNumber`, which `ai.addSearchMap` it drives on),
  `Physical` (`setStrType HeavyArmour` …), `Unit` (`setStrategicStrength`
  per side), `Cover` (`coverValue`), and its guns' `weaponTemplate`s in
  `AI/Weapons.con` (the Sherman main gun: range 2..250, strength Infantry 10,
  LightArmour 7, HeavyArmour 2, Air 1). `IPIMobile` +0x14 → +8, the term the
  Fire behaviour's range grace and the obstacle drop multiply by five, is
  this `maxSpeed`.
- **A unit's urgency** (`calculateVehicleUrgency`): 0 when the unit is
  occupied and team-locked to another side, or an aircraft's engine heat is
  at 1 (`airOverheatBail`); else `SCurve(health) × (fireStrength × (w1 +
  0.15) + moveUrgency × w2) + Information+0x14`, with `w1 / w2` from the
  bot's order strengths (`Bot` +0x168 / +0x16c: both 0 → 0.5 / 0.5, only the
  first > 0 → 0 / 1, only the second → 1 / 0, else the normalised split),
  `moveUrgency = engineHeatInfluence × maxSpeed × 4` (× 2.5 instead when
  another bot already sits in it), and `fireStrength` the unit's weapon
  strengths with its manned seats' at 0.4 (0.9 for a plane's) folded against
  the environment's per-class tables (the exact weighting is **not read**;
  the viewer uses the classes it has spotted, INVENTION). A unit the bot
  left within 15 s and a unit spawned within 15 s are scaled by `age / 15`.
- **The decision** (`BBChange::calculateUrgency`): on foot, `staying` is the
  bot's own unit urgency × 1.25 (× `modifyForDriver`: 0.77 / 0.5 for a
  manned unit's secondary seats by class). The environment lists the units
  around (radius R); each not manned by the enemy, not upside down
  (`up · ground normal < 0.6914`), and — beyond 12 m — standing on a valid
  cell of the bot's map (a vehicle-type unit: a valid point 12 m behind it)
  scores `u × (f + 0.5) × (1 + radio)` with `f = min(0.5, (R² − d²) / R²)`;
  a plane also needs `runwayClear`; its secondary seats are scored through
  `modifyForDriver`. The best target calls `BBPChange::init(target, isDriver)`
  and `urgency = Declein(0.5 × best / staying) × k × 4 × ramp × area` with
  `ramp = min(1, (now − lastChange) / 10)` and `area` the outside-area
  factor, doubled inside a vehicle when bailing is wanted (`isBailAllowed`,
  not read). `k` is 1.9 (StandardWeights). In the viewer a mounted bot never
  bails on its own (INVENTION); a destroyed hull unseats and kills it.
- **The plan** (`BBPChange::createPlan`): farther than 12.5 m (156.25 = 12.5²)
  a `MoveToObjectFinding` to 6.25 m with `size × 0.5` slack, broken when the
  unit is occupied, enemy-occupied or moved; a vehicle-type unit is
  approached from 12 m behind it (`MoveToFinding` at `size × 0.75`); then
  within 12.375 m and with the unit "behind" the bot (`ObjectBehind` −0.8)
  the Use input (channel 10) is held until `ObjectOccupied`, `UpdateVehicle`
  swaps the bot's unit and `ChangeVehicle` re-registers its behaviours
  (`ChangeInhibit` zeroes MoveTo while Change is active). The viewer walks to
  the door's own radius and asks the page for the seat (`EnterVehicle`).
- **Driving** (`EntryTankMoveTo::execute`, `TankControl::
  controlTowardsDirection`): arrival inside the move's radius resets the
  controls; `CommonControls::actionStatusDecision` picks forward or reverse
  and the target angle (**not read**: the viewer drives forward and backs
  out for 2 s after an obstruction, INVENTION); the angle limit is 30°, 60°
  on a move marked so. Inside the limit the wanted speed is 20 m/s cut by `1
  − SCurve(slope × ControlInfo+0x4c)` over two terrain probes 20 m ahead
  (floor 2), divided by `|lateral velocity| × 10 + 1`, capped at `maxSpeed`;
  `throttle = clamp(2 × ((wanted − speed) − clamp(speed / (30 |wanted −
  speed| + 1), ±10)), ±1)`, `steer = clamp(angle − clamp(rate / (30 |angle|
  + 1), ±10), ±1)`. The turn-first branch outside the limit is not read (the
  viewer: full throttle, full lock, the direction kept across the seam
  behind the hull). The vehicle map is the level's `Tank0` / `Car4`
  `addSearchMap` (El Alamein: brush 3.0, clip 0.3..2.5, slope 30 / 20).
- **What the viewer builds** (`bot-vehicle.js`, `bot.js` mounted mode,
  `map.html` `botEnterVehicle` / `botLeaveVehicle`): the Change behaviour on
  foot for `ground` / `tank` roots with AI data, the walk to the door and
  the seat through the page's own `VehicleOccupancy` + drivetrain (adopted
  into the body world, driven by the bot's input word through the world's
  seated-player tick, drawn by `stepVehicleBodies`), the Tank map built on
  first use, the tank law on the route, the Fire behaviour with the unit's
  AI weapons through the turret's look and the hull's trigger, damage on a
  seated bot landing on the hull. Not built: aircraft, boats, fixed guns,
  passenger and gunner seats, voluntary bailing. Verified live on El
  Alamein (2026-09-23): five of eight bots took vehicles unprompted; a
  Kubelwagen followed its route at up to 17 m/s; a Panzer IV left its
  compound on the tank map; a Sherman traversed onto a soldier 44 m ahead
  and killed him with the main gun and coaxial.

## 9. Seats, bailing, the turn, aircraft and boats

Read 2026-09-23 from `BBChange::isBailAllowed` **0x0855fd70**, the seated
branch of `BBChange::calculateUrgency` **0x0855e0c0**, `BBMoveToFixed::
calculateUrgency` **0x08575680**, `TankControl::turnTowardsDirection`
**0x0862d630** and its three `tweak_*` data words, `CommonControls::
actionStatusDecision` **0x0860fbe0**, `PlaneControl::towardsPoint`
**0x08629730** / `towardsDirection` **0x08629fa0** (first cited as 0x0862a2a0, an address inside it), `EntryPlaneMoveTo::
execute` **0x08620220**, `BBPGotoWaypoint3d::createPlan` **0x085b81e0**,
`BoatControl::towardsDirection` **0x0860df70** / `speedControl`
**0x0860e130`, `EntryBoatMoveTo::execute` **0x08613d60** (ledger AI-46..AI-49).

- **Every door is a Change candidate.** The seated branch iterates the
  root's secondary seats (`+0x80` / `+0x78`) with `modifyForDriver` (0.5 for
  a plane's seats, 0.77 for the 0x20 class, 1 otherwise); a seat's own
  `aiTemplate` (the `seatsAi` block of `vehicle-ai.json`: `secondary 1`, its
  `Unit` strengths, the FireArms it reaches through `addTemplate`) gives its
  fire strength and value, and `calculateVehicleMoveUrgency` gives a rider
  the hull's `maxSpeed × 4` only while someone drives it (`× 2.5` under a
  bot driver whose order differs). A seat that does not drive registers
  `BBMoveToFixed`, which publishes the order's urgency to the bot
  (`+0x160`) and **returns 0**: a gunner or a fixed gun never walks.
- **Bailing.** `isBailAllowed`: the soldier's own map must hold the hull's
  position (`isValidPosition` on the infantry map; a vehicle-type unit or an
  unoccupied one is refused when it does not), and no passenger object with
  the +7 & 8 flag rides along. Seated, `staying = own seat urgency × 1.25
  × modifyForDriver × radio`, 0 when upside down; the foot alternative is
  `calculateVehicleUrgency(soldier)`; the environment's other units are
  weighed only when not bailing; a bail doubles the urgency. The viewer
  keeps a flying bot aboard until it is under 6 m (no parachute for a bot:
  INVENTION).
- **The turn and the reverse.** `turnTowardsDirection`: full lock away from
  the angle's sign; `tweak_highThrottle` (1.0) while `|v| ≤ min(1, angle² ×
  tweak_velocityLimitModifier 0.3)` else `tweak_lowThrottle` (0.4), signs
  following the drive direction. `actionStatusDecision` returns the signed
  angle (`−(acos(normal · dir) − π/2)`), the velocity's sign along the
  heading, and the drive direction: forward when the wanted direction is
  ahead of the beam (`forward · dir ≥ 0`); behind it a box test on the map
  (`getBox`, `getIntersection`, `checkLineAgainstObjects`, the 1.2566 rad =
  72° and half-box thresholds) decides between a reverse and a turn. The
  viewer reverses for a target behind within three hull lengths (that box
  test's branches are not reproduced: INVENTION).
- **Aircraft.** The plan for a 3D waypoint is `MoveTo3d(point, point,
  maxSpeed, ConPosition(point, 4 × unit radius))`; `towardsPoint` within
  100 m of the point lifts the wanted height to ground / water plus the
  move's clearance blended by `0.0001 × d²`, frames on the velocity over
  100 m, and flags a takeoff run under 50 m/s while `speed / maxSpeed <
  0.5`; `towardsDirection` probes 50 m along the plane's axes, rolls by the
  wanted direction's right component, pitches by its up component × 0.5
  plus stall / dive terms, yaws by a tenth of the lateral error, cuts the
  bank above cos 0.866, levels a nose more than 50 m/s down, and shapes a
  speed term `((e^(2.3 (1 − v/43)) − 1) / 9) × −0.833 + 0.333` into the pitch
  limit (`ControlInfo` +0x104 / +0x108). Not read: the ControlInfo limits,
  the stall / dive terms, the throttle channel's own write, `BBFire3d` /
  `BBPFire3d`, `BBPIdle3d`, `BBRoam3d` (commented out in vanilla). The
  viewer (`bot-vehicle-air.js`): full throttle, rotate at 35 m/s with the
  stick (negative is nose up in the viewer's drivetrain), a wings-level
  climb-out to 40 m, then the roll / pitch / yaw terms above with the bank
  cut; `Fire` from a plane is a run at the target with the trigger held
  inside a 5° nose cone (INVENTION). Verified live on El Alamein
  (2026-09-23): a bot's Spitfire took off, climbed out to 60 m, reached its
  ordered area (`goalReached`) and orbited it at 45..150 m and 32..48 m/s
  for the whole 160 s run; three bf109s and a Stuka were taken by bots
  unprompted.
- **Boats.** `BoatControl::towardsDirection` takes `actionStatusDecision`'s
  angle and direction into `speedControl`: full rudder past 30° (0.5236),
  the throttle held while the heading is within cos 0.996, a 3 m/s speed
  band and a 0.03 rudder dead band; `BBChangeTeleport` (boats) and
  `BBFireLargeBore` are not read. The viewer's boat holds a straight line to
  the point (no water bitmap: INVENTION) and fires through the turret plan.
- **Fixed guns.** A `gun` root (AA, Defgun, a stationary MG) is a seat with
  no drive: the bot's guns are its `aiWeapons`, MoveTo is 0, Fire through
  the turret's traverse and elevation, Change against the foot.

## 10. Verified

- `tests/test_bot_ai.py` (14), `tests/test_nav_grid.py` (11),
  `tests/test_strategic.py` (7: the condition compare table, ownership from
  control points, the strategy choice, targets and orders on a fixture and on
  El Alamein's shipped data), `tests/test_ai_level.py` (4).
- El Alamein in the viewer with six bots: both sides choose `broad`, Allied
  bots are ordered to the eastern base and the south pass, Axis bots to the
  two passes; MoveTo wins at 3.0 (a hostile area's ×2 times the 1.5
  personality) over Scout 1.0 and Idle 0.1, and every bot walks its route.

## 11. Still open

- `getSAIUpdateFrequency`'s default and where `SAI+0x1d8` is stamped; the
  console mapping of a condition's `<value>` to constant vs target;
  `EnemyStatistics` (the attack cost); `TemperatureTree` and `SAIMap`'s
  influence propagation (the temperature map behind spawn-group weights).
- `WeaponFireArm::setBotSkill`'s body (the deviation model is from README
  §6.2); `BAPAAimAtObject::getAimVec` (lead and ballistics); `CustomCurve`.
- The AI tick rate behind every tick-counted constant.
- Vehicles: `BBChange`, the plane / tank / boat behaviours and plans, `WP
  AltitudeMoveTo`, `orderAirBot`; the medic's `BBMedicAssist`.

## 12. Strength tables, the seat swap, the fire plans and the flight law

Read 2026-09-23 (ledger AI-50..AI-63); every row is built unless noted.

| What | Where in the binary | Built in |
|---|---|---|
| Six battle-strength classes; a unit's table is the max over its `FireArms`' `setStrength` tables | `AISettings::getNBattleStrengths` 0x084843d0, `AITemplateUnit::initFromObject` 0x085e1a90 | `bot-strength.js unitTable` |
| Each side's enemy tables, `strengths += security x table`, halved per strategic pass | `SAI::updateStrengths` 0x08636c20, `BFEnvironment::getEnemyStrengths/Types` 0x085e4fe0 / 0x085e5030 | `EnemyStrengthTables` |
| `calculateFireStrength`: own table + 0.4 / 0.9 x each other occupied seat, `max own^2` over the fielded classes minus the enemy's strength vs my class; **the seat the bot would leave counts empty** when it weighs another; a fixed weapon with nothing known or in range scores a flat 5.0 along its strategic direction | 0x08584580 | `fireStrength`, `bot.js _candidateFire / _fixedAimable` (per candidate seat's own traverse) |
| The seat swap | `BBChangeTeleport::calculateUrgency` 0x085611f0 | `teleportChangeUrgency`, `SwitchSeat` |
| The seated Change only while bailing is allowed | `BBChange::calculateUrgency` 0x0855e0c0 | `bot.js _urgencyChange` |
| The box test behind the beam | `CommonControls::actionStatusDecision` 0x0860fbe0, `getBox` 0x08612060 | `driveDecision` |
| Large-bore and aircraft targeting | `BBFireLargeBore` 0x0856b390, `BBFire3d` 0x085662f0 | `scoreVehicleTargets` |
| The aircraft fire plan: mode 0 is "inside 0.9 R and seen: aim + trigger, else MoveTo3dObject(target, 50 m)"; modes 1 / 2 add the 10 m half-space and the break; the trigger is distance <= R and the round's miss along the current barrel <= the precision; line of fire is the memory's seen flag; the battle zone is the map less 150 / 200 m | `createPlanInternal` 0x0859b4b0, `createMobileLessAttackPlan` 0x085a0080, `BAPCConPrecision3d` 0x0854baf0, `ObjectInFront` 0x08550e70, `ObjectLineOfFire` 0x08551890, `InsideBattleZone` 0x0854e670 | `attackRunStep`, `roundMiss`, `insideBattleZone` |
| The flight law, line for line | `towardsDirection` 0x08629fa0, `towardsPoint` 0x08629730, `aimAtDirection` 0x08629cf0, `InformationReal::getAltitude(Vec3)` 0x085e8950 | `towardsDirectionEngine`, `towardsPoint`, `aimAtDirection` |
| The sense rays skip the bot's own unit and the target's; the vehicle frustums while seated | `BotMain::sense` 0x08521cf0 | `bot-sense.js lineClear`, `BotSenses.selfOwner` |
| ControlInfo3d: +0x104 maxClimbAngle, +0x108 maxRollAngle, the four channel indices | con setters 0x0850dad0 / 0x0850dec0 / 0x0850e2b0 / 0x0850e6a0 | `PLANE_FIRE` |
| The water map | level `AIpathFinding.con` | `buildNavMap({ waterMap })` |

**How the flight law was read.** Ghidra's output for 0x08629fa0 starts in
the middle of the function (register inputs, the head lost). The function was
read instead by emulating it: a small i386 + x87 emulator
(`features/bf1942-engine-reference/lnxded/x87emu.py`, numeric with a symbolic shadow; `towards_direction_emu.py` fuzzes the port against it) runs
the disassembly on concrete inputs and prints the formula along the taken
path; a Python port was then written from those formulas and the emulator
compared with it on 1,700 random inputs (every reachable branch taken both
ways), and the JS port with it on 400 more. The tool is worth reusing for any
x87-heavy function Ghidra mangles.

**What the viewer shows with it.** A bot's Spitfire takes off tail-up (the
airspeed's climb limit holds the nose down until about 23 m/s), climbs, sets
its airborne flag at 50 m and half its top speed, and cruises at 90..110 m;
it turns through 180 deg in about 12 s at 60..68 deg of bank without losing
height. The attack approaches at about 45 m (the move's 50 m clearance), and
the aim's 75 m clearance pulls the nose up when the attack starts, so a
strafing pass sweeps the nose through the target rather than holding it;
the precision gate opens (100 ticks against a Stuka at 210..240 m) but no
soldier was hit from the air in the runs made, and a plane can circle a
soldier inside its turn circle without ever seeing him (the viewer's frustum
test is yaw-only; the engine's is a 3D camera frustum).
