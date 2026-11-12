# ai-a

## Summary

42 ledger rows read, plus a sweep of every `dice::bf::ai` `BB*` / `BBP*` / `BAP*` class in
`bf1942_lnxded.static` against vanilla `Game/AIbehaviours.con` (re-extracted from
`linux-src/mods/bf1942/archives/bf1942/game.rfa`) and `viewer/bot-*.js`.

| Class | Rows | Sweep |
|---|---|---|
| BUILT | 33 | (most live behaviours) |
| NOT-GAME | 8 | 10 classes no shipped row registers |
| PARTIAL | 1 (AI-41, AI-42 radio term; counted once) | 3 |
| DIFFERENT | 1 (AI-43) | 2 |
| MISSING | 0 | 2 |
| UNREAD | 1 (AI-15 plan-step half) | 2 |

Top findings by impact:

1. MISSING, high: **bots ignore every radio command except the Change ones.** Retail's Fire,
   MoveTo, Scout, TakeCover and MedicAssist urgencies all read the bot's AIRadio strengths
   ("Hold fire!", "Fire!", "Cover me!", "Go!", "Hold position!", "Wait!", "Check your six!",
   the seven "... spotted!" calls, "Take cover!", "Medic!", "Need repairs!").
2. MISSING, high: **a driven hull predicts no collision.** Retail runs `BBAvoid`, with a 5 s
   look-ahead, for every Tank / Car / Boat row and side-steps with `BBPAvoidCollision2d`. Ours
   checks only soldiers touching the hull's centre (0.72 m), so bot drivers run into friendly
   soldiers and hulls.
3. DIFFERENT, medium: **the vehicle-choice split is the bot's fire / move inclination, not its
   order.** `calculateVehicleUrgency`'s `w1/w2` are `BotMain::getFireInclination` /
   `getMoveInclination` (vtable +0x16c / +0x168), which smooth the Fire and MoveTo urgencies.
   Ours computes them from the order's attack/defence strengths. AI-43 misread the two vtable
   slots as fields.
4. DIFFERENT, medium: **`ChangeInhibit` has the wrong values and is applied to the wrong
   rows.** The file holds Avoid 0.8, MoveTo 0, Idle 0.01, Fire 0.75, Special 0, Scout 0.5;
   ours zeroes MoveTo and leaves the rest at 1. The infantry row's Change also uses
   `UnitWeights`, so a soldier walking to a vehicle can still be pulled back to MoveTo. Ours
   zeroes MoveTo for them.
5. PARTIAL, medium: **a tank's TakeCover runs the soldier's rule.** Retail's Tank and
   ArtilleryDriver rows register `BBTakeCover` / `BBPTakeCover`: cover portals, vehicle
   occupancy, and a MoveToFinding plan with no poses. Ours runs `BBTakeCoverInfantry` for the
   hull, with soldier cover objects, a soldier's 0.6 x 1.8 m size and prone poses.
6. PARTIAL, medium: **a soldier's Avoid urgency still uses no look-ahead.** The obstacle half
   got the 5 s look-ahead (AI-119); the urgency half did not, and the side-step is invented.

## Findings (MISSING / PARTIAL / DIFFERENT / UNREAD), highest impact first

### [MISSING] [impact: high] [effort: S] Bots ignore radio commands (Fire, MoveTo, Scout, TakeCover, Medic)
- Retail: `AIRadio::getMessageStrength` 0x084825c0 has these callers, with the pushed message
  ids read at each site (ids per `radio.js RADIO_MESSAGES`):
  - `BBFire` 0x085652b5..0x08565329, `BBFire3d` 0x08567d43.., `BBFireLargeBore` 0x0856cba3..,
    `BBFireGuided`, `BBFireUnarmed`: `x (1 + s[37 Fire]) x (1 + s[43 CoverMe]) x (1 - s[38 HoldFire])`.
  - `BBMoveTo` 0x08575035..0x08575096 and `BBMoveToFixed` 0x085756ee..: `(1 + s[49 Go]) x
    (1 - s[44 HoldPosition]) x (1 - s[36 Wait])`, times the modifier, into the urgency
    (0x08575143).
  - `BBScout` 0x0857a81a..0x0857a964: `s[52 CheckYourSix]` and `s[15..21]`, the seven
    "... spotted" calls.
  - `BBTakeCoverInfantry` 0x08581039 and `BBTakeCover` 0x0857d05f: `(1 + s[41 TakeCover])` (AI-41).
  - `BBMedicAssist` 0x08573d55 / 0x08573d7f: `s[40 Medic]` and `s[54 NeedRepairs]` in the
    target pick (AI-42).
  - `BBChange` / `BBChangeTeleport` / `BBChangeLandingCraft`: 51 / 42 / 53 (already in hand).

  All 22 messages are subscribed `10 0.8` by vanilla `Game/AI/radio.con`. They reach every
  bot of the speaker's team within 70 m, and a team broadcast reaches all of them.
- Ours: `bot-radio.js`, uncommitted and in progress in another session, stores the strengths
  and feeds only the three Change reads (`bot-mount.js`). `bot-behaviours.js
  TakeCoverState.evaluate` hard-codes the TakeCover term to 1 ("no radio in the viewer").
  `MedicState.evaluate` has no radio term. `urgencyFire`, `urgencyMoveTo` and `urgencyScout`
  read none.
- A player notices: in single player or Instant Battle, "Hold fire!" or "Hold position!"
  near bot teammates does nothing, "Take cover!" moves nobody, and "Medic!" does not make a
  medic bot come to them first. In retail each of these visibly moves the nearby bots.
- To build: once `bot-radio.js` lands, read `bot.radio` in `bot-decision.js` (`urgencyMoveTo`,
  `urgencyScout`, `urgencyTakeCover`) and in `bot-perception.js` / `bot-fire.js` (the Fire
  urgency), and in `bot-behaviours.js MedicState` (per target type: 40 for soldiers, 54 for
  hulls). Before writing the Scout combination, read how `BBScout` combines its eight terms
  (0x0857a81a..0x0857a9a0). Confirm the `fsubp` direction once, at 0x0856531d.

### [MISSING] [impact: high] [effort: M] A driven hull predicts no collisions (BBAvoid / BBPAvoidCollision2d)
- Retail: every driven-ground and boat row registers `Avoid BBAvoid BBPAvoidCollision2d ...
  AvoidInhibit`: Tank, Boat, Car, UnarmedTank, LandingCraft, ArtilleryDriver and
  AmphibiousCar (`AIbehaviours.con`). `BBAvoid::calculateUrgency` 0x0855c650 queries the
  bot's side's grid and the neutral grid within `lookAhead x speed + R`, `lookAhead` being
  the Mobile plug-in's `avoidCollisionLookAhead`, 5.0 by default (AI-119). It tests each
  object with `collisionPredicted` 0x0855d2f0, and plants slow ones as potential obstacles
  (`addSlowMovingPathfindingObstacle` 0x0855d550, AI-32). `BBPAvoidCollision2d::createPlan`
  0x08586420 is a `BAPAMoveToDirect` to a point it computes with sin/cos and
  `getIntersection`, ended by `ConTime` or `ConPosition`.
- Ours: `bot-decision.js urgencyAvoid`. A pilot gets `airAvoid`. Any other seat, driven
  hulls included, scores only soldiers within `2 x 0.6 x 0.6` m of `bot.position`, the hull's
  centre, so in practice never. `bot-route.js predictObstacles` returns 0 when `bot.vehicle`
  is set. A hull learns of an obstacle only by touching it (`trackHullContact`, marked
  INVENTION).
- A player notices: bot tanks and jeeps drive into friendly soldiers (and the player), into
  friendly hulls and into props, rather than steering round them as retail's drivers do.
  This is the other half of the owner's "stuck under a vehicle" report.
- To build: port `collisionPredicted` and the 2d side-step to driven hulls, in `bot-decision.js
  urgencyAvoid` and `bot-plans.js planAvoid`. Let `predictObstacles` run for a driven hull,
  with its own radius and sub-spheres (`getSubSpheres2d`, already ported). Read
  `BBPAvoidCollision2d::createPlan` 0x08586420 for the step point and end conditions.

### [DIFFERENT] [impact: medium] [effort: S] The vehicle choice weighs fire against move by the bot's inclinations, not its order
- Retail: `BBChange::calculateUrgency` 0x0855e0c0 calls the bot's vtable +0x16c and +0x168
  at 0x0855e128 and 0x0855f726..0x0855f774. `vtable for BotMain` is at 0x0875d100, and its
  slot +0x168 is `getMoveInclination` 0x0852e280 and slot +0x16c is `getFireInclination`
  0x0852e310. With fire > 0 it takes `w1 = fire / (fire + move)` and `w2 = move / (fire +
  move)`; otherwise `w1 = 0` and `w2 = 1`. It passes them as `calculateVehicleUrgency`'s two
  floats (0x0855e221..0x0855e242, 0x0855ee5d..).

  `addToFireInclination` 0x0852e320 (`+0x1ac += x`) is called by every Fire generator with
  its urgency: BBFire 0x08563623 / 0x0856545f / 0x08565614, BBFire3d, BBFireLargeBore,
  BBFireGuided and BBFireUnarmed. `addToMoveInclination` 0x0852e290 is called by `BBMoveTo`
  0x08574fdb and `BBMoveToFixed` 0x085756c6. `decisionMaking` steps both each pass:
  `step*Inclination` 0x0852e2d0 / 0x0852e360 compute `v = 0.8 v + 0.2 acc` and then zero
  `acc` (constants `[0x086d2954]` = 0.8, `[0x086c4f74]` = 0.2).
- Ours: `bot-vehicle.js orderSplit(attack, defence)`, fed from `bot.waypoints.attack /
  defence` in `bot-mount.js` (lines 199, 337, 402, 574). AI-43 reads the two values as "Bot
  +0x168/+0x16c, the bot's order split", but they are vtable slots, not fields.
  `bot-perception.js:301` already notes that "addToFireInclination ... not modelled".
- A player notices: in retail a bot that has been fighting rates armed vehicles higher and an
  idle one rates fast vehicles higher. Ours ranks them by order type, so a bot under fire
  with an attack order still chooses by speed: it takes the jeep over the tank beside it.
- To build: keep two smoothed accumulators on the bot (`bot.js`). Add each Fire urgency and
  each MoveTo urgency in `bot-decision.js`, step them in `decisionMaking`, and replace
  `orderSplit` with the share rule. Correct AI-43 in the ledger.

### [DIFFERENT] [impact: medium] [effort: S] ChangeInhibit's values and which rows use it
- Retail: `AIbehaviours.con` `createBehaviourModifiers ChangeInhibit`: Avoid 0.8, MoveTo 0.0,
  Idle 0.01, Fire 0.75, Special 0.0, Scout 0.5, TakeCover 1.0, Change 1.0. The modifier
  column is per row:
  - `Infantery Change ... UnitWeights`, so nothing is inhibited while an infantry bot changes
    (the research's own bot-behaviours.md §2 says "UnitWeights otherwise for infantry").
  - Tank, Plane, Boat, BoatFixed, UnarmedTank, LandingCraft, Passenger, the landing-craft
    passenger seats, UnarmedBoat, ArtilleryDriver and UnarmedPlane use `ChangeInhibit`.
  - Fixed, Car, LandingCraftFixed, FixedLargeBore, AmphibiousCar and
    FixedGuidedMissileLauncher use `UnitWeights`.

  `BotMain::calculateMods` 0x08525b80 multiplies `+0x44[i]`, the active behaviour's column,
  into every mod while a plan runs (AI-35).
- Ours: `bot-decision.js CHANGE_INHIBIT = { MoveTo: 0, else 1 }`, applied to every bot,
  infantry included (`INHIBITOR.Change`, line 62; spec `behaviours.md` table, KNOBS.md row 18).
- A player notices: a soldier bot heading for a vehicle never breaks off to follow a stronger
  order, whereas retail's can. A seated bot getting out or swapping seats keeps its Fire and
  Scout at full weight, where retail damps them (x0.75, x0.5).
- To build: carry the inhibitor column per row in `bot-rows.js` (transcribe the 10th field of
  each mod's list) and use it in `decisionMaking`. Fix the spec table.

### [PARTIAL] [impact: medium] [effort: M] A hull's TakeCover runs the soldier's urgency and plan
- Retail: Tank and ArtilleryDriver register `TakeCover BBTakeCover BBPTakeCover` (FH's and
  FHSW's Tank rows do not). `BBTakeCover::calculateUrgency` 0x0857c120 is 8 KB. It calls
  `AIObjectCover::getPortalCount`, `vehicleOccupied`, `SCurve`, `DecleiningSlopeCurve` and
  `AIRadio(41)`, and `BBPTakeCover::init` with either a point or an object id.
  `BBPTakeCover::createPlan` 0x085c6b80 builds `ResetControls`, `MoveToFinding` under
  `ConPosition & ...`, `LookAtObject` / `LookInDir` and `BAPIWTakeCover`, with no
  `SoldierPose`. Neither function has been read.
- Ours: `urgencyTakeCover` / `planTakeCover` are `BBTakeCoverInfantry` for every unit:
  `myWidth 0.6`, `myHeight 1.8`, the soldier's `coverSearchRadius 20`, prone and crouch
  `SoldierPose` actions, and the lowest-ground fallback.
- A player notices: a bot tank under fire looks for soldier-sized cover within 20 m, or for
  "lowest ground", rather than pulling behind a building or portal as retail's do.
- To build: read 0x0857c120 and 0x085c6b80, add a `HullTakeCoverState` in
  `bot-behaviours.js`, and dispatch on the row's generator in `bot-decision.js` and
  `bot-plans.js`.

### [PARTIAL] [impact: medium] [effort: S] A soldier's Avoid urgency has no look-ahead, and the side-step is invented
- Retail: the infantry row is `Avoid BBAvoid BBPAvoidCollisionInfantery`. The soldier's
  look-ahead is 5.0 (AI-119), so `BBAvoid` predicts contact 5 s ahead with own-side and
  neutral bodies. `BBPAvoidCollisionInfantery::createPlan` 0x08588400 is a 9 KB plan: seven
  `BAPAMoveToDirect`, `isInBox` tests, `BAPASoldierPose`, and `ConPosition` ends.
- Ours: the AI-119 obstacle half is built (`predictObstacles`). The urgency is still the
  zero-look-ahead "touching within 0.72 m" rule (`urgencyAvoid`). The plan is a 45 degree,
  5 m, 0.5 s step marked INVENTION (`bot-plans.js AVOID_STEP / AVOID_TIME`).
- A player notices: bot squads on foot bump and shuffle through each other at doors and
  narrow paths. Retail's step aside before contact.
- To build: give `urgencyAvoid` the `collisionPredicted` test the pilots already use
  (`bot-pilot.js airAvoid`), and read 0x08588400 for the step.

### [PARTIAL] [impact: low] [effort: S] A hull's Scout turns the hull when the turret cannot look
- Retail: the hull rows' Scout plan is `BBPScout` 0x085c3a70:
  `If(ObjectValidYawAiming) ... else BAPATurnTowardsDirection`, with `LookInDir`, `Sense` and
  `BAPCConLookDeviation`, and no pose.
- Ours: `planScout` is the infantry plan for everyone: `SoldierPose`, `MouseTurretLookAt` and
  `Sense`.
- A player notices: a fixed-gun tank or a tank destroyer sits facing away from a threat it is
  scouting, where retail turns the hull to face it.
- To build: branch in `bot-plans.js planScout` on a driven hull whose gun yaw cannot reach the
  direction (`bot._turretCanPoint` exists).

### [DIFFERENT] [impact: low] [effort: M] EoD's SAM sites run the large-bore rule (BBFireGuided)
- Retail: `FixedGuidedMissileLauncher` (row 17) registers `Fire BBFireGuided BBPFireGuided`.
  The units are EoD's Hawk, SA2 and SA2 bunkers, BF1918's M1uboot and GCMOD's droid
  controls; vanilla has none. Its own `calculateUrgency` 0x08570xxx (with the radio terms
  above) has not been read.
- Ours: `bot-perception.js fireMode` returns `'largeBore'` for any generator other than
  FireInfantery and FireDriver.
- A player notices: on EoD levels a bot at a SAM site scores targets like a ship's gun.
- To build: read `BBFireGuided::calculateUrgency` and `BBPFireGuided::createPlan`, then add a
  `'guided'` mode.

### [UNREAD] [impact: low] [effort: S] botSkill's plan-step half (AI-15)
- Retail: `BotManager::actionExecutePlan` 0x0849a41f computes `(skill x 0.1 + 0.1) x
  getTimeIncrease()` and passes it, with the bot's vt+0xd8 value, to vt+0x34 of an object
  hanging off a per-bot record when that record's flag `+0x10 & 0x10` is set (0x0849a53a..
  0x0849a56b). It is not the plan-execution budget itself. The trigger-accuracy half is
  built (`bot-deviation.js`).
- Ours: nothing reads skill outside the deviation.
- To settle: name the record at `BotManager+0x2c` / `+0x20` and its vt+0x34. If it is
  `Information` degeneration (AI-75), it is the rate at which a side forgets.

### [UNREAD] [impact: low] [effort: M] BF1918's `BBRoam` Special on its armed hulls
- Retail: BF1918's list gives HeavyTank, LightTank, ArmedCar, Car, Boat, Submarine,
  FighterPlane and others `Special BBRoam` (`bot-rows.js`). `BBRoam` and
  `BBPRoam2d` / `BBPRoam3d` have not been read.
- Ours: Special is not run on any seat (`bot-decision.js registered`).
- A player notices: on BF1918 levels, bot hulls with no order may sit where retail's roam.
- To settle: read `BBRoam::calculateUrgency` and `BBPRoam2d::createPlan`.

## From the sweep: retail behaviour with no ledger row

These are the findings above that rest on no ledger row:

- The radio terms in Fire, MoveTo, Scout and Medic. Only TakeCover's (AI-41) and Change's are
  in rows.
- The fire / move inclination: `BotMain` 0x0852e280..0x0852e395 and its writers. AI-43 holds
  the misreading.
- ChangeInhibit's real values and the per-row modifier columns (data in `AIbehaviours.con`).
- `BBTakeCover`, `BBPTakeCover`, `BBPScout`, `BBPAvoidCollision2d`,
  `BBPAvoidCollisionInfantery` (plan contents) and `BBFireGuided` / `BBPFireGuided`.

Two more facts from the sweep:

- `PlaneWeights` (Avoid 0, Fire 1.5, TakeCover 0, Change 0) is created in the file but used by
  no `setStandardPersonality` line, so it is dead.
- The urge curve is per row (`Car Fire UCUnion`, `LandingCraftPassenger Fire UCScout`); ours
  special-cases only ArtilleryDriver. Both affected rows' generator is `BBFireUnarmed`, which
  always returns 0 (SPOT-16), so nothing is visible.

## BUILT and NOT-GAME, one line each

- AI-1 BUILT: bots write the same input channels as players. `bot.js` input word,
  `input-index.js`.
- AI-3 NOT-GAME: the layout of the engine's input struct.
- AI-5 NOT-GAME: AIMain vtable thunks.
- AI-7 BUILT: `bot-referee.js spawn` plus respawn. There are no bots in the multiplayer
  `server/` rooms, by design.
- AI-9 BUILT: `bot-units.js` / `bot-fire.js` information-type flags (ITAir, ITNaval,
  ITSoldier).
- AI-10 BUILT: `nav-map.js` / `nav-grid.js` aiMeshes binding by name.
- AI-11 NOT-GAME: aiMeshes.rfa data census.
- AI-12 BUILT: `bf42/ai_level.py` and `sim/level.mjs` load the `Pathfinding/` maps.
- AI-13 BUILT: `bf42/ai_level.py` raw header.
- AI-14 BUILT: `bot.js DEFAULT_BOT_SKILL = 0.75`.
- AI-15 BUILT for the trigger half (`bot-deviation.js`). The plan-step half is UNREAD (above).
- AI-16, AI-17, AI-19 BUILT: `bot-deviation.js`, `bot-fire.js` (the aiPending term).
- AI-22 BUILT: the coop skill is not fed to the AI, matching retail.
- AI-23 NOT-GAME: `precision` is dead in the engine.
- AI-24 NOT-GAME: ai.rfa is scaffolding.
- AI-25 NOT-GAME: binary copies.
- AI-26 BUILT: `nav-baked.js` / `nav-grid.js`, one bit a metre.
- AI-28 BUILT: `sim/botgen.mjs` / `bf42/ai_level.py` object pass.
- AI-29 BUILT: `nav-search.js` hierarchical 4-connected A*.
- AI-30 BUILT: `bot-route.js` follower smoothing.
- AI-31 BUILT: `bot-route.js` 31.5 degree throttle cone.
- AI-34 BUILT: `bot-sense.js MEMORY_EXPIRY 60`, `HEARING_RETENTION 30`, `DEAF_AFTER_FIRE 3`.
- AI-35 BUILT: `bot-decision.js decisionMaking`, apart from the ChangeInhibit column
  (DIFFERENT above).
- AI-37 BUILT: `bot-behaviours.js ScoutState / TakeCoverState`, `planIdle`.
- AI-41 BUILT apart from the radio term (MISSING above).
- AI-42 BUILT: `MedicState`. Its radio term is MISSING (above).
- AI-43 DIFFERENT (above).
- AI-48 BUILT: `bot-pilot.js` / `bot-vehicle-air.js`.
- AI-49 BUILT: `bot-vehicle-air.js boatControl`.
- AI-55 BUILT: `bot-fire.js scoreVehicleTargets 'air'`.
- AI-57 BUILT: `bot-vehicle-air.js PLANE_FIRE`.
- AI-58 BUILT: `bf42/ai_level.py` / `bot-units.js` water map.
- AI-59 BUILT: `bot-mount.js` / `bot.js _fixedAimable`.
- AI-61 BUILT: `bot-aim.js` / `bot-vehicle-air.js` precision gate.
- AI-62 BUILT: `bot-sense.js lineClear(skip[])`.
- AI-63 BUILT: `bot-mount.js` bail gate.
- AI-64, AI-65 BUILT: `bot-fire.js ARMOUR_CLASS_VALUES`, `harmlessThreshold = 0`.
- AI-67 BUILT: `bot-sense.js inFrustum`.
- AI-70 BUILT: `bot-referee.js` / `nav-search.js` / `bf42/ai_level.py` area orders.
- AI-71 BUILT: `bot-plans.js` / `bot-referee.js` air order and its 50 m clearance.
- Sweep NOT-GAME: `BBRepair`, `BBResupply`, `BBExplosives`, `BBMine`, `BBRadio`, `BBIndirect`,
  `BBBailOut`, `BBCombatMovement`, `BBManWpn`, `BBPPattern` and `BBTakeCover3d` are compiled
  in but registered by no row of vanilla's, FH's, BF1918's or EoD's `AIbehaviours.con`. A bot
  never repairs, resupplies, mines or plants charges through a behaviour in any shipped game.
- Sweep BUILT: `BBPIdle2d` (`while(true) ResetControls`, as `planIdle`), `BBPIdle3d`,
  `BBFireUnarmed` (always 0, `chooseVehicleTarget`), `BBFireArtilleryDriver`, `BBMoveToFixed`,
  `BBChangeTeleport`, `BBChangeLandingCraft`, `BBMedicAssist`, `BBFire3d`, `BBFireLargeBore`.
  The `BAP*` interpreter classes are the plan engine that `bot-plans.js PLAN_ACTION` stands in
  for. `BAPDebugger` and `BAPInterpreter` are NOT-GAME.
