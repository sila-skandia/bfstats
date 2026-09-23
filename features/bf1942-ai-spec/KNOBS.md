# Knobs

Every constant the bot AI runs on. **Kind**: ENGINE (read from
`bf1942_lnxded.static`, or the client where marked; INFERRED where the
research says so), CON (read from shipped data), INVENTION (labelled so in
the code), UNSOURCED (no label in the code and no source in the research:
treat as INVENTION). Addresses are the research's (ledger AI-1..AI-66).
Code paths are under `tools/bf1942-models/viewer/`; `map.html` entries are
the page's referee. "Unused" marks a constant declared and never read.

| area | constant | value | source | code | kind |
|---|---|---|---|---|---|
| contest | personality `StandardWeights` | Avoid 1, MoveTo 1.5, Idle 0.1, Fire 7.5, Special 1, Scout 1, TakeCover 2.0, Change 1.9 | `Game.rfa AIbehaviours.con`, `setStandardPersonality`; `calculateMods` 0x08525b80 | `bot.js STANDARD_WEIGHTS` | CON |
| contest | basic `UnitWeights` | all 1 | `AIbehaviours.con` | `bot.js UNIT_WEIGHTS` | CON |
| contest | moral | 1 (drawn once, never updated) | `BotMoralAdmin::moralUpdate` has no caller | `bot.js _currentMod` | ENGINE |
| contest | `AvoidInhibit` | MoveTo 0.3, Special 0.5, else 1 | `AIbehaviours.con` | `bot.js AVOID_INHIBIT` | CON |
| contest | `ChangeInhibit` | MoveTo 0, else 1 | `AIbehaviours.con` (AI-44) | `bot.js CHANGE_INHIBIT` | CON |
| contest | `UCFire` | `max(0, -0.22 t + 1.3)` | `createUCLinear UCFire -0.22 1.3`; `UCLinear::calculate` 0x085838f0 | `bot.js URGENCY_CURVE.fire` | CON |
| contest | `UCScout` | `max(0, 2.5 / (t + 0.9) + 0.5)` | `createUCXInverse UCScout 2.5 0.9 1.0 0.5`; `UCXInverse::calculate` 0x08583a50 | `bot.js URGENCY_CURVE.scout` | CON |
| contest | `UCUnion` | 1 | `createUCConstant UCUnion 1.0` | `bot.js URGENCY_CURVE.union` | CON |
| contest | hysteresis band | 0.87 .. 1.15 | `BotBehaviour::quotientChanged` 0x08583540 | `bot.js HYSTERESIS_LOW/HIGH` | ENGINE |
| contest | initial snapshot | 1e-5 | the comment names the `BotBehaviour` ctor; no value in the research | `bot.js ACTIVE_URGENCY_INIT` | UNSOURCED |
| contest | Idle floor | 0.001 (the engine crashes) | `AIbehaviours.con` warning | `bot.js IDLE_FLOOR` | INVENTION |
| contest | registered rows | infantry 8, vehicle 7 (no Special) | `AIbehaviours.con` `Infantery` / `Tank` rows | `bot.js REGISTERED`, `REGISTERED_VEHICLE` | CON |
| contest | AI time budget | 0.95 of `aiSystemQuotient`; plans 0.40, the rest by `setSystemQuotient 40 40 20`; LOD ticks 6 6 6 | `AIMain::action` 0x084778d0, `BotManager::action` 0x0849a130; level `AI.con` | not built: every phase, every bot, every call | ENGINE / CON |
| contest | plan step rate | `(0.1 skill + 0.1) x time increase` | `BotManager::actionExecutePlan` 0x0849a41f | not built | ENGINE |
| contest | decision thresholds | `setPlannedDecisionMakingThreshold` 0.5, `setUnplanned...` 0.3 / 0.4 | level `AI.con`; stored, never read (AI-35) | not built | CON |
| curves | `DecleiningSlopeCurve` samples | 0.05 -> 0.146, 0.1 -> 0.292, 0.2 -> 0.579, 0.3 -> 0.754, 0.5 -> 0.895, 0.7 -> 0.955, 1 -> 1 | `DecleiningSlopeCurve::calculate` 0x08655560 (101 entries) | `bot-behaviours.js DECLEIN_POINTS` | ENGINE; linear in between INVENTION |
| curves | `SCurve` samples | 0.25 -> 0.087, 0.5 -> 0.5, 0.75 -> 0.913 | `SCurve::calculate` 0x08658420 | `bot-behaviours.js SCURVE_POINTS` | ENGINE; linear in between INVENTION |
| sensing | view distance | 600 default; the level's (El Alamein 300) | `AISettings::reset` 0x08484450 (+0x1c); `AI.con aiSettings.setViewDistance` | `bot.js DEFAULT_VIEW_DISTANCE` | ENGINE / CON |
| sensing | fields of view | 100 / 60 / 30 deg; mounted 75 / 45 / 15; square (aspect 1.0) about the camera | `tweak_frustumUpdateAngle` 0x087d0860; `Frustum::setupFrustum(fov, 1.0, ...)` (AI-67) | `bot-sense.js FRUSTUM_FOV`, `inFrustum`; `bot.js _cameraBasis` | ENGINE |
| sensing | bands | 0..0.5, 0.5..0.75, 0.75..1 of the view distance | `tweak_frustumUpdateStateMinMaxDistances` 0x086ffed8 | `bot-sense.js FRUSTUM_BANDS` | ENGINE |
| sensing | sub-state restart on turning | 25 / 15 / 7.5 deg (18.75 / 11.25 / 3.75 mounted) | `BotMain::sense` 0x08521cf0 | not built: one sub-state a tick | ENGINE |
| sensing | near plane | 0.01 m | `Frustum::setupFrustum` 0x08440c70 | `bot-sense.js FRUSTUM_NEAR` | ENGINE |
| sensing | rays | `clamp(round(30 radius / d), 1, 10)` | `BotMain::sense` 0x08521cf0 | `bot-sense.js RAYS_PER_METRE_RADIUS`, `RAYS_MAX` | ENGINE |
| sensing | soldier radius | 1.0 m | not read | `bot-sense.js SOLDIER_RADIUS` | INVENTION |
| sensing | sense points | heights 0.3, 0.8, 1.2, 1.55 m, +-0.25 m jitter | not read (`pickSoldierRandomSensePosition`) | `bot-sense.js SENSE_HEIGHTS`, `SENSE_JITTER` | INVENTION |
| sensing | eye heights | 1.6 / 1.1 / 0.4 m | not read (`getSoldierPoseCameraPosition`) | `bot.js EYE_BY_STANCE`, `bot-fire.js FIRING_POSES` | UNSOURCED |
| sensing | mounted eye | 2.0 m above the hull | | `bot.js VEHICLE_EYE_HEIGHT` | INVENTION |
| sensing | memory expiry | 60 s after lost | `BotMain::updateMemory` 0x085244e0 | `bot-sense.js MEMORY_EXPIRY` | ENGINE |
| sensing | hearing retention | 30 s | `updateHearingMemory` 0x085240e0 | `bot-sense.js HEARING_RETENTION` | ENGINE |
| sensing | deaf after own shot | 3 s | `event_firing` (+0x118) | `bot-sense.js DEAF_AFTER_FIRE` | ENGINE |
| sensing | a shot's own sound radius window | 3 s | `soundPerceptionCalculation` 0x08523290 | `bot-sense.js SHOT_SOUND_WINDOW` | ENGINE |
| sensing | soldier sound sphere | 15 m | `Objects/Soldiers/Common/AI/Objects.con setSoundSphereRadius 0 15` | `bot-sense.js SOLDIER_SOUND_RADIUS` | CON |
| sensing | incoming-fire list life | `min(60 / n, 5)` s | `event_projectile` 0x085269e0 / `updateMemory` | `bot-sense.js FIRE_LIST_BUDGET`, `FIRE_LIST_TTL` | ENGINE |
| sensing | attacker map life | `max(300 / n, 10)` s | `isAttacking` 0x08526950 | `bot-sense.js ATTACKER_BUDGET`, `ATTACKER_TTL` | ENGINE |
| sensing | hit multiplier | x10 | `updateMemory` | `bot-sense.js incomingStrength` | ENGINE |
| sensing | fire decay rate | 1.0 | not read | `bot-sense.js FIRE_DECAY_RATE` | INVENTION |
| sensing | under-fire window | 1.5 s (Scout's prone pose) | | `bot.js tick` | UNSOURCED |
| sensing | quadrants | 4 x 90 deg azimuth, split at 25 deg elevation | `computeQuadrants` 0x08579150 (INFERRED from 0.7071 / 0.9063) | `bot-behaviours.js quadrantOf` | ENGINE (INFERRED) |
| fire | water gate | 0.75 m | `BBFire::calculateUrgency` 0x08563570 | `bot-fire.js FIRE.waterGate` | ENGINE |
| fire | give-up veto | 20 s, lifted at 2 m/s | `getBBPFeedback` (BBFire); dead in retail: its writer needs `detectAimingFailure` 0x085a3860, which returns 0 (AI-72) | `FIRE.feedbackVeto`, `movingVetoSpeed` | ENGINE; nothing writes the veto map, as in retail |
| fire | weapon value | `strength / (1 + (20 missed + 10) / ammo)`, ammo -1 = 65536 | `BBFire::calculateUrgency` | `scoreTargets` | ENGINE |
| fire | attacker bonus | 1.5 .. 1.0 over 30 s | `BBFire` | `FIRE.attackedWindow` | ENGINE |
| fire | lost decay | `1 / (1 + 0.05 age)` | `BBFire` (AI-40) | `FIRE.sightAgeDecay` | ENGINE |
| fire | outside area | x0.75 (applied twice in the code) | `BBFire` | `FIRE.outsideAreaFactor` | ENGINE |
| fire | minimum distance | 0.5 m | | `FIRE.minDistance` | UNSOURCED |
| fire | speed term | `1 / (1 + 0.5 abs(v))` in range, 0.25 beyond | `BBFire` | `FIRE.inRangeSpeedFactor`, `beyondRangeFactor` | ENGINE |
| fire | beyond range and 5 m higher | `0.25 / (3 + 0.5 abs(v))` | | `scoreTargets` | UNSOURCED |
| fire | range grace | 5 x mobile size (5.0 on foot) = 25 m | `BBFire`; size `IPIMobile +0x14 -> +8` (INFERRED) | `MOBILE_SIZE_INFANTRY` | ENGINE (INFERRED) |
| fire | range term | `max(0, 1 - d / (1.5 maxRange))` | `BBFire` | `FIRE.rangeSlack` | ENGINE |
| fire | range factor | `(minRange + 0.1 (maxRange - minRange)) / d` | `BBFire` | `FIRE.rangeFactorMin` | ENGINE |
| fire | target strength | soldier table x area x 0.5 | `BBFire` | `scoreTargets` | ENGINE |
| fire | harmless | x0.33 | `BBFire` | `FIRE.harmlessFactor` | ENGINE |
| fire | score jitter | `max(0, -0.22 u + 1.3)`, `u` per target | `BBFire` (a per-target pseudo-random) | `seededUnit(hashId(id))` | ENGINE; the generator INVENTION |
| fire | switch hysteresis | 1.2x | `BBFire` | `FIRE.switchHysteresis` | ENGINE |
| fire | approach | 0.9 maxRange | `BBPFireInfantery::createPlanInternal` 0x085a74e0 | `FIRE.approachRange` | ENGINE |
| fire | back off | inside `minRange + 1` to `2 minRange + 5` | `createPlanInternal`, `calculateAwayPosition` | `FIRE.tooClose`, `awayRadius` | ENGINE |
| fire | look tolerance | 5 deg (0.0873) | `BAPALookAtObject` | `FIRE.lookTolerance`, `bot.js LOOK_TOLERANCE` | ENGINE |
| fire | aim tolerance | `0.25 x extents`, at least 0.4 m | `createFirePlan` 0x085ac240 | `FIRE.aimToleranceFraction`, `aimToleranceMin` | ENGINE |
| fire | plan timeout | 3 s | `createFirePlan` | `FIRE.planTimeout` | ENGINE |
| fire | shots | up to 10; the uniform draw `1 + floor(rand x 10)` | `createFirePlan` | `FIRE.shotsMax`, `firePlanFor` | ENGINE; the draw UNSOURCED |
| fire | pose order | prone, crouch, stand | `getFiringPose` 0x085a26f0 | `FIRING_POSES` | ENGINE |
| fire | trigger extra `C` | 0 infantry, 30 vehicle, 10 primary/occupied (AI-36); AI-18 reads an AA penalty | `EntryTrigger::execute` 0x086257d0 | `FIRE.vehicleExtra`, `vehicleOccupiedExtra` (unused) | ENGINE |
| fire | soldier battle strength | Infantry 4, LightArmour 2, HeavyArmour 1, Air 1 | `Objects/Soldiers/Common/AI/Objects.con setBattleStrength` | `SOLDIER_BATTLE_STRENGTH` | CON |
| fire | weapon template defaults | deviation 5.0, correction time 10.0 | `WeaponTemplate` ctor 0x085ef740 | `weaponAiOf` | ENGINE |
| fire | weapon template fallbacks | maxRange 60, strength Infantry 1 | | `weaponAiOf` | UNSOURCED |
| fire | armour class values | 1, 3, 8, 15, 1, 6 | `AISettings` ctor 0x08482cf0 (+0x98) | `ARMOUR_CLASS_VALUES` | ENGINE |
| fire | harmless threshold | 0 | `BotManager` ctor calls (AI-65) | `scoreVehicleTargets` | ENGINE |
| fire | information security | 1 | own side `InformationReal` 1 (`getSecurity` 0x085e8d10); an enemy's `1 - SCurve(age / decay)` (0x085e8670), the decay not traced (AI-72) | `scoreVehicleTargets` | INVENTION (the enemy's decay) |
| fire | large-bore distance | `1 - clamp(1.5 d / R, 0.1, 1)` | `BBFireLargeBore::calculateUrgency` 0x0856b390 | `VEHICLE_FIRE.largeBoreRangeFactor`, `largeBoreFloor` | ENGINE |
| fire | aircraft distance | ground `min(1, d / 3R)`, air `max(0, 1 - d / 1.5R)` | `BBFire3d::calculateUrgency` 0x085662f0 | `VEHICLE_FIRE.airGroundRangeFactor`, `airAirRangeFactor` | ENGINE |
| fire | facing | `max(0.5, f.dir + 1) x 0.5` | `BBFire3d` | `VEHICLE_FIRE.facingFloor`, `facingScale` | ENGINE |
| fire | anti-aircraft rules | non-AA 0 past 0.5 R or 15 m/s; AA 1 inside 0.9 R | `BBFire3d` | `VEHICLE_FIRE.aaNonAaRange`, `aaNonAaSpeed`, `aaRange` | ENGINE |
| fire | escaping target | faster by 5 m/s beyond range | `BBFire3d` | `VEHICLE_FIRE.escapeSpeedGap` | ENGINE |
| fire | unspotted enemies | x0.75; 850 m hulls, 600 m aircraft, 75 m else | `getEnemyObjects` 0x085e4eb0 | `VEHICLE_FIRE.environment*` | ENGINE |
| fire | `losRange` | 0.89 | | `VEHICLE_FIRE.losRange` (unused) | UNSOURCED |
| aim | yaw gain | 3 deg a count | `BFSoldier::handlePlayerInput` 0x0827457d (`ds:0x086c08c8`) | `bot.js YAW_GAIN`, `mouse-input.js SOLDIER_YAW_GAIN` | ENGINE |
| aim | pitch gain | 1 deg a count | `0x08274537` | `bot.js PITCH_GAIN` | ENGINE |
| aim | axis saturation | +-16 | `PlayerAction::set` 0x081128a0 (`floatToFixed` range) | `bot.js AXIS_MAX`, `mouse-input.js AXIS_RANGE` | ENGINE |
| aim | aim rate | 4 counts a tick | `mouseControlLookAtDirection` 0x08627b90 | `bot.js AIM_COUNTS_MAX` | ENGINE |
| aim | bot skill | 0.75 default; slider 0.25 / 0.5 / 0.75 / 1.0 | `AISettings::reset` (+0x24); client `FUN_006dd910` | `bot.js DEFAULT_BOT_SKILL`; `map.html BOT_SKILL` | ENGINE |
| aim | AI deviation | `(1 - 0.75 A) C + dev (max(0, T (1 - A) - t) / T + 0.25 (1 - A))` | `WeaponFireArm::setBotSkill` 0x085ee580 | `deviation.js setAIDeviation` | ENGINE |
| aim | deviation clock | 30 Hz | `g_simulationFps` | `deviation.js TICK_HZ` | ENGINE |
| aim | aim point | the target's +1.0 m | | `bot.js _execTrigger`, `_execMouseTurretAimAt` | UNSOURCED |
| infantry | steering cone | 0.5497787 rad (31.5 deg) | `infanteryControlTowardsDirection` 0x08627000 | `bot.js STEER_CONE` | ENGINE |
| infantry | waypoint arrival default | 3 m | | `bot.js WAYPOINT_REACH_RADIUS` | UNSOURCED |
| avoid | contact distance | 1.2 m (`2 x 1.0 x 0.6`) | | `bot.js _urgencyAvoid` | INVENTION |
| avoid | closing speed | 0.2 m/s | `collisionPredicted` 0x0855d2f0 | `bot.js _urgencyAvoid` | ENGINE |
| avoid | side step | 5 m, 0.5 s, 45 deg | engine: a second of travel, 1.1 x time to contact, 5 m | `bot.js AVOID_STEP`, `AVOID_TIME` | INVENTION |
| move | fallback waypoint radius | 5 m | | `bot.js FALLBACK_WAYPOINT_RADIUS` | INVENTION |
| move | no-progress redeploy | 12 s, 0.5 m | | `bot.js NO_PROGRESS_RESPAWN` | INVENTION |
| move | smoothing | 10 points | `AIpathFinding.con ai.setSmoothing 1 10` (`getSmoothing`, vtable +0x2c) | `bot.js SMOOTHING` | CON |
| move | local search box | `10 + rand x 14` m, + largest obstacle, + 1 | `BotMain::updateLocalPath` 0x08527120 | `bot.js LOCAL_SEARCH_RADIUS_MIN/RAND` | ENGINE |
| move | retry and widening | 1.5 s; +16 m per failure (3 max); 6 widenings of 16 m; 20,000 x w nodes | | `bot.js ROUTE_RETRY_AFTER`, `ROUTE_RETRY_WIDEN`, `ROUTE_LEG_WIDENINGS`, `ROUTE_LEG_WIDE_NODES` | INVENTION |
| move | body radius (pop) | 1.0 m on foot, 3.0 m in a hull | engine floors the removal distance at 0.5 (`getMaxPathPosRemovalDistance` 0x0852b780) | `bot.js BOT_RADIUS`, `VEHICLE_RADIUS` | INVENTION |
| move | re-plan on goal move | 20 m (`4 x maxSpeed 5`) | `BBPGotoWaypointSoldier::createPlan` 0x085bb660 | `bot.js REPLAN_GOAL_MOVE` | ENGINE |
| move | stall counts | 150 obstructed, 401 failed | `getNewIntermediatePathPos` 0x0852ab60 | `bot.js OBSTRUCTED_TICKS`, `PATH_FAIL_TICKS` | ENGINE (counts bot ticks, frame-rate dependent) |
| move | moving speed | 1.0 m/s; also counts throttle-on and slow | `ObstructionDetection::update` 0x08532b00 | `bot.js MOVING_SPEED` | ENGINE; the throttle-on case INVENTION |
| move | obstacle circle | 1.5 m, 1 m ahead | | `bot.js OBSTACLE_RADIUS`, `OBSTACLE_AHEAD` | INVENTION |
| move | obstacle drop | 25.5 m (`5 x 5 + 0.5`) | `updatePotentialObstacles` 0x0852d880; `AIPathfinding` ctor 0x0847a780 zeroes max speed / age | `bot.js OBSTACLE_DROP_DISTANCE` | ENGINE |
| move | contact ticks | 10 | | `bot.js CONTACT_TICKS` | INVENTION |
| move | hull back-out | 2 s | `actionStatusDecision` modes 2..5 not read | `bot.js VEHICLE_REVERSE_SECONDS` | INVENTION |
| map | cell | 1 m | `LocalMap::getLevelPixelSize` 0x085ff170 | `nav-grid.js NAV_CELL` | ENGINE |
| map | infantry map | water 1.5 m, slope 30 deg, brush 1.0, clip 0.4 .. 2.0 | `AIpathFinding.con ai.addSearchMap Infantry1 0 1.5 30 1.0 0.4 2.0 1` | `nav-grid.js INFANTRY_SEARCH_MAP` | CON |
| map | vehicle map defaults | depth 0, slope 30, brush 3.0, clip 0.3 .. 2.5 | `AIpathFinding.con ai.addSearchMap Tank0 ...` | `map.html botVehicleNav` | CON |
| map | water maps | `Boat2` depth 5.0, brush 125; `LandingCraft3` 1.4, 4 | `AIpathFinding.con` | `map.html botWaterNav` | CON |
| map | brush | `n = 2 round(b) + 1`, disc `<= b²` | `LocalMapInfo::update` 0x08480f50 | `nav-grid.js brushOffsets` | ENGINE |
| map | statics per cell | the band filled per cell | engine draws the outline (`objectClipAndRender` 0x085fbfa0) | `nav-grid.js rasteriseTriangle` | INVENTION |
| map | coarse level | 16 m, any free metre | `StrategicMap` not read | `nav-grid.js COARSE_CELL` | INVENTION |
| map | coarse cost | `(1 or sqrt 2)(1 + 2 (1 - free fraction))` | | `findStrategicPath` | INVENTION |
| map | local step cost | `1 + 3 abs(dh) + 7 (1 - abs(ny))²` | `__checkThisLevel` 0x085f5d20 (x16 and level cost dropped) | `findLocalPath` | ENGINE (simplified) |
| map | local node cap | `0x400 x 8` | `initNormal` +0xc (0x400, INFERRED) | `LOCAL_SEARCH_MAX_NODES` | ENGINE; the x8 INVENTION |
| map | start / goal resolution | nearest open cell within 20 | the avoid path's 20 m start push (`checkAndInitAvoidPathfinding` 0x08527bf0) | `START_RESOLVE_CELLS` | INVENTION |
| map | default search box | 24 m | | `findLocalPath` | UNSOURCED |
| scout | initial accumulator | 100 | `BBScout::calculateUrgency` 0x08579a50 | `SCOUT.initialAccum` | ENGINE |
| scout | weights | accum 0.2, interest 0.1, inertia 0.01 (0.005 under cover) | `BBScout` | `SCOUT.accumWeight`, `interestWeight`, `inertiaWeight`, `inertiaWeightCover` | ENGINE |
| scout | boost | 0.75, 1.0 toward an attacker | `BBScout` | `SCOUT.boostDefault`, `boostAttacker` | ENGINE |
| scout | fire floor, sound age, lost falloff, attacker | 0.1, 30 s, 0.01, x10 | `BBScout` | `SCOUT.fireFloor`, `soundAge`, `lostFalloff`, `attackerStrength` | ENGINE |
| scout | attacker danger | x3 | `BBScout` | `SCOUT.attackerDanger` (unused) | ENGINE |
| scout | look gate | 5 deg (0.087) | `BBScout` | `SCOUT.lookGate` | ENGINE |
| scout | sense done | 10 deg | `EntrySense` | `SCOUT.senseDeviation` | ENGINE |
| scout | quadrant done | 5 s | | `SCOUT.quadDoneAfter` | UNSOURCED |
| scout | plan reuse | cos 0.95 | | `SCOUT.planReuseCos` | UNSOURCED |
| scout | look jitter | `(1 - min(25, inertia) / 30)(rand - 0.5) 45 deg` | engine: 22.5 deg steps (`getQuadRecommendedLookDirection`) | `ScoutState.evaluate` | UNSOURCED |
| scout, cover | threat of a soldier | 4 | the soldier's battle strength | `bot.js _urgencyScout`, `_urgencyTakeCover` | INVENTION |
| cover | fire fade | 3 s | `BBTakeCoverInfantry::calculateUrgency` 0x08580140 | `TAKE_COVER.fireFade` | ENGINE |
| cover | threat distance | clamp 2 .. 100 m, x0.01 | `BBTakeCoverInfantry` (AI-41) | `TAKE_COVER.minDistance`, `distanceCap`, `distanceScale` | ENGINE |
| cover | staleness | 0.5 .. 1 over 30 s | `BBTakeCoverInfantry` | `TAKE_COVER.staleCap` | ENGINE |
| cover | cover choice | halfway 0.5; stand 0.75 R .. 2 R; width 0.25 x 0.2, height 0.75 x 0.5 | `getCoverObject` 0x08581a70 | `TAKE_COVER.*` | ENGINE |
| cover | the bot's extents | 0.6 x 1.8 m | | `bot.js _urgencyTakeCover` | UNSOURCED |
| cover | search radius | 20 m | `Objects/Soldiers/Common/AI/Objects.con coverSearchRadius 20.0` | `TAKE_COVER.coverSearchRadius` | CON |
| cover | arrival | `max(4, 0.5 maxSpeed)` = 4 m | `BBPTakeCoverInfantry::createPlan` 0x085c97d0 | `TAKE_COVER.arriveMin` | ENGINE |
| cover | no-cover search | 100 m box, 4 m grid | `createPlan` | `TAKE_COVER.noCoverBox`, `noCoverStep` | ENGINE |
| cover | plan reuse | danger moved < 3 m (1 m an object) | `createPlan` | `TAKE_COVER.reuseMoveStatic`, `reuseMoveObject` | ENGINE |
| cover | radio term | 0 | `AIRadio` message 0x29 | `TakeCoverState.evaluate` | INVENTION |
| cover | `saiUrgency` | 0.2 | | `TAKE_COVER.saiUrgency` (unused) | UNSOURCED |
| medic | gates | water 0.75 m, health < 0.95, upright cos 0.7071 | `BBMedicAssist::calculateUrgency` 0x08573840 | `MEDIC.*` | ENGINE |
| medic | urgency | `Declein(sum) x 4`, x0.75 outside the area | `BBMedicAssist` | `MEDIC.urgencyScale`, `outsideAreaFactor` | ENGINE |
| medic | approach | `R + 0.9 maxRange` | `BBPMedicAssist::createPlan` 0x085bf350 | `MEDIC.rangeFraction` | ENGINE |
| medic | friend search | 60 m | not read | `MEDIC.searchRadius` | INVENTION |
| medic | friend value | 1 | not read (`Information +0x14`) | `MEDIC.unitValue` | INVENTION |
| medic | heal a round | 0.3 HP (0.1 at 30 Hz, 10 rounds/s) | `BFSoldierTemplate` ctor 0x0827a210 (+0x2e0); the cadence INFERRED | `MEDIC.healPerRound`, `map.html BOT_HEAL_PER_ROUND` | ENGINE (INFERRED) |
| medic | heal reach | range + 0.5 m, 20 deg of the aim | | `map.html resolveBotHeal` | UNSOURCED |
| medic | heal plan give-up | 2 m past the approach | | `bot.js _healPlanDone` | UNSOURCED |
| strength | classes | 6 | `AISettings::getNBattleStrengths` 0x084843d0 | `BATTLE_CLASSES` | ENGINE |
| strength | seat shares | 0.4 seat / aircraft, 0.9 ground root | `calculateFireStrength` 0x08584580 | `STRENGTH.seatShare`, `hullShare` | ENGINE |
| strength | nothing known | 0.5 x max² | `calculateFireStrength` | `STRENGTH.noTypesFactor` | ENGINE |
| strength | fixed gun, strategic only | 5.0 | `calculateFireStrength` | `STRENGTH.fixedStrategic` | ENGINE |
| strength | strategic direction | the nearest enemy flag's bearing | engine: the strategic object's links | `bot.js _fixedAimable` | INVENTION |
| strength | table decay | x0.5 a pass | `SAI::updateStrengths` 0x08636c20 | `STRENGTH.decay` | ENGINE |
| strength | engine heat | 1 to 0.95, then `1 - (heat - 0.95) x 20` | `engineHeatInfluence` 0x08585830 | `STRENGTH.heatKnee`, `heatSlope` | ENGINE |
| strength | radii | candidates 50, friends 40, enemies 75 / 600 | `getHardware` 0x085e2fa0, `getFriendlyUnits` 0x085e2e50, `getEnemyObjects` 0x085e4eb0 | `STRENGTH.candidateRadius`, `friendlyRadius`, `enemyRadius*` (unused; `CHANGE.searchRadius` is read) | ENGINE |
| change | staying | x1.25 | `BBChange::calculateUrgency` 0x0855e0c0 | `CHANGE.stayFactor` | ENGINE |
| change | fire bias, move factors | 0.15; x4, x2.5 with a bot driver | `calculateVehicleUrgency` 0x08583b10, `calculateVehicleMoveUrgency` 0x08584310 | `CHANGE.fireBias`, `moveFactor`, `moveFactorOccupied` | ENGINE |
| change | order split | both 0: 0.5 / 0.5; attack only 0 / 1; defence only 1 / 0 | `Bot` +0x168 / +0x16c | `orderSplit` | ENGINE |
| change | upside down | up . normal < 0.6914 | `isUpsideDown` 0x0855fcf0 | `CHANGE.upsideDownCos` | ENGINE |
| change | search radius | 50 m | `getHardware` 0x085e2fa0 | `CHANGE.searchRadius` | ENGINE |
| change | distance factor | `min(0.5, (R² - d²) / R²) + 0.5` | `BBChange` | `changeUrgency` | ENGINE |
| change | urgency | `Declein(0.5 best / staying) x 4`, x2 bailing | `BBChange` | `CHANGE.urgencyScale` | ENGINE |
| change | change ramp | 10 s | `BBChange` | `CHANGE.rampSeconds` | ENGINE |
| change | unit ramps | 15 s after leaving it and after its spawn | `calculateVehicleUrgency` | `CHANGE.unitRampSeconds` | ENGINE (the left-unit ramp never matches: README) |
| change | outside area | x0.75 | `BBChange` | `CHANGE.outsideAreaFactor` | ENGINE |
| change | approach | 12.5 -> 6.25 m, Use within 12.375 m | `BBPChange::createPlan` 0x0858b5c0 | `CHANGE.approachFrom`, `approachTo`, `useWithin` (unused: the viewer walks to the door) | ENGINE |
| change | door arrival | the door's radius, at least 2 m (4 when none) | | `bot.js _planChange` | UNSOURCED |
| change | seat factors | x0.5 an aircraft's seats, x0.77 a ship's | `modifyForDriver` 0x0855f7d0 (0.77 for the 0x20 class) | `map.html botVehicleCandidates seatFactor` | ENGINE |
| change | air bail height | under 6 m | | `bot.js _urgencyChange` | INVENTION |
| change | `driverFactor` | 1 | | `CHANGE.driverFactor` (unused, stale comment) | UNSOURCED |
| swap | factors root / own / other | driver 1.0 / 1.0 / 0.5; seat under a driver 0.5 / 1.0 / 0.5; ship seat 1.0 / 0.5 / 0.65; land seat 1.0 / 0.5 / 0.7; aircraft seat 1.5 / 0.5 / 0.5 | `BBChangeTeleport::calculateUrgency` 0x085611f0 | `TELEPORT.root`, `seatUnderDriver`, `seatShip`, `seatLand`, `seatAir` | ENGINE |
| swap | scale, pending, no order | x4; 6.0; 2.0 below a 0.05 attack split | `BBChangeTeleport` | `TELEPORT.urgencyScale`, `pendingUrgency`, `noOrderUrgency`, `noOrderSplit` | ENGINE (6.0 and 2.0 never reach the contest) |
| swap | order factor | 1 with an order, else the bot's skill | `BBChangeTeleport` | `bot.js _urgencyChangeTeleport` | ENGINE |
| tank | wanted speed | 20 m/s, floor 2, `/ (10 abs(lateral) + 1)`, cap maxSpeed | `TankControl::controlTowardsDirection` 0x0862c670 | `TANK.wantedSpeed`, `minWantedSpeed`, `lateralDamping` | ENGINE |
| tank | damping | 30, cap +-10, gain 2 | `controlTowardsDirection` | `TANK.speedDamping`, `dampingCap`, `throttleGain` | ENGINE |
| tank | angle limit | 30 deg, 60 deg marked | `EntryTankMoveTo::execute` 0x08622e80 | `TANK.angleLimit`, `angleLimitLastLeg` | ENGINE |
| tank | slope | probes 20 m ahead (not built), gain 1 | `controlTowardsDirection`; `ControlInfo +0x4c` not read | `TANK.slopeProbe` (unused), `slopeGain` | ENGINE / INVENTION |
| tank | turn throttle | 1.0 below `min(1, angle² x 0.3)`, else 0.4 | `turnTowardsDirection` 0x0862d630; tweaks 0x08762ca4 / 0x08762ca0 / 0x08762c9c | `TANK.turnHighThrottle`, `turnLowThrottle`, `turnVelocityLimit` | ENGINE |
| tank | turn hysteresis | 150 deg | | `TANK.turnKeepAngle` | INVENTION |
| tank | box test | 1.2566 rad, box >= 0.5 turnRadius, run <= turnRadius | `CommonControls::actionStatusDecision` 0x0860fbe0, `getBox` 0x08612060 | `TANK.reverseAngle`, `reverseBoxFraction` | ENGINE |
| tank | turn radius default | 5 m | Sherman `aiTemplatePlugIn.turnRadius` | `TANK.defaultTurnRadius` | CON |
| tank | soldier max speed | 5 m/s | `Objects/Soldiers/Common/AI/Objects.con maxSpeed 5.0` | `TANK.soldierMaxSpeed` | CON |
| tank | yaw channel sign | +1 | calibrated on the Kubelwagen | `bot.js VEHICLE_YAW_SIGN` | INVENTION (calibration) |
| plane | arrival | 4 x radius; radius 10 m | `BBPGotoWaypoint3d::createPlan` 0x085b81e0 (`ConPosition`); the radius not read | `PLANE.arriveRadiusFactor`, `map.html BOT_VEHICLE_RADIUS_LARGE` | ENGINE / INVENTION |
| plane | waypoint clearance | 50 m | `WPAltitudeMoveTo` +0x14 from `orderAirBot` 0x08640982, read by `BBPGotoWaypoint3d::createPlan` 0x085b81e0 (AI-71) | `SAI.airClearance`; `PLANE.cruiseClearance` when a waypoint has none | ENGINE |
| plane | law constants | 43.0, ln 10, -0.833, 0.333, 0.866 / 0.134, 0.9, 0.1, 18.0, 0.3, 9.0, roll rate 0.5 | `PlaneControl::towardsDirection` 0x08629fa0 (0x087058a8 ..) | `TOWARDS.*` | ENGINE |
| plane | limits | maxClimb 0.3333, maxRoll 0.9999 | `ControlInfo3d` +0x104 / +0x108 (setters 0x0850dad0 / 0x0850dec0) | `PLANE_FIRE.maxClimbAngle`, `maxRollAngle` | CON |
| plane | probes | aim 50 m, point 100 m, lift inside 100 m at 0.0001 d² | `aimAtDirection` 0x08629cf0, `towardsPoint` 0x08629730 | `TOWARDS.probe`, `pointProbe`, `pointLiftRange`, `pointLiftRate` | ENGINE |
| plane | takeoff | aim y 0.3333, flag at 50 m and half top speed, wanted 200 m | `aimAtDirection`, `towardsPoint` | `TOWARDS.takeoffDirY`, `takeoffHeight`, `takeoffSpeedFraction`, `takeoffTargetY` | ENGINE |
| plane | airborne flag clear | when the controlled object changes, or the bot is built | `updateBotVehicle` 0x0852c899, ctor 0x0851d475 (AI-71) | `bot.js mount`, `dismount` | ENGINE |
| plane | altitude probe samples | 0, 0.2 .. 0.9 | `InformationReal::getAltitude` 0x085e8950 | `bot.js _altitudeAlong` | ENGINE |
| plane | attack ranges | 0.9 R approach; fire inside R | `BBPFire3d::createPlanInternal` 0x0859b4b0 | `PLANE_FIRE.approachRange` (`fireRange` 0.8 unused) | ENGINE |
| plane | in front | 10 m half-space | `BAPConObjectInFront` 0x08550e70 | `PLANE_FIRE.inFrontDistance` | ENGINE |
| plane | precision | `max(0.1, p)`; p 0.8 x extent (>= 0.5), 5 / 10 m vehicles | `BAPCConPrecision3d` 0x0854b9e0 / 0x0854baf0; `BBPFire3d::createPlan` 0x0859ad90 | `PLANE_FIRE.precisionMin`, `radius*` | ENGINE |
| plane | clearances | aim 75 m (50 m mode 1), approach 50 m | `BAPAAimAtObject3d` ctor 0x0853c5f0, `MoveTo3dObject` +0x44 | `PLANE_FIRE.aimClearance`, `aimClearanceVehicle`, `clearance` | ENGINE |
| plane | break | 200 m after passing inside 1.3 turnRadius | `createPlanInternal` | `PLANE_FIRE.breakDistance`, `passRadiusFactor` (`breakSpeedFactor`, `arriveSpeedFactor` unused) | ENGINE |
| plane | battle zone | loop inside 150 m of the edge; fly to the centre at 200 m inside 200 m | `BAPConInsideBattleZone` 0x0854e670 | `PLANE_FIRE.battleZone`, `battleZoneReturn`, `battleZoneHeight` | ENGINE |
| plane | weapon heat | 0.5 / 0.8 | `BBPFire3d` | `PLANE_FIRE.weaponHeat*` (stored, not enforced) | ENGINE |
| plane | idle speed | 0.1 m/s | `BBPIdle3d::createPlan` 0x085be0e0 | `PLANE_FIRE.idleSpeed` | ENGINE |
| plane | round speed fallback | 600 m/s | | `bot.js _gunBallistics` | UNSOURCED |
| boat | rudder, throttle | full past 30 deg; hold within cos 0.996; 3 m/s band; 0.03 dead band | `BoatControl::speedControl` 0x0860e130 | `BOAT.fullRudderAngle`, `alignedCos`, `speedBand`, `rudderDeadBand` | ENGINE |
| boat | in-between values | rudder `angle / 30 deg`; throttle 0.5 / 0.8; -0.5 braking | | `boatControl` | UNSOURCED |
| boat | arrival | 4 x radius | | `BOAT.arriveRadiusFactor` | UNSOURCED |
| strategic | pass period | 5 s | README §6.1 read 2.0 (`AISettings::reset` +0x28) | `strategic.js SAI.updateFrequency` | INVENTION |
| strategic | strategy hysteresis | 0.83 .. 1.2 | `SAI::chooseStrategy` 0x08631cd0 | `SAI.hysteresisLow/High` | ENGINE |
| strategic | time limit growth | `x (2 - 2^(1 - count))` | `chooseStrategy` | `_chooseStrategy` | ENGINE |
| strategic | target threshold | 0.1 | `categoryDistributeAttack` 0x08633d00, `...Defence` 0x086333b0 | `SAI.candidateMin` | ENGINE |
| strategic | keep ratios | 0.8 attack, 0.9 defence, 1.1 surplus | same, `releaseSurplus` | `SAI.attackKeep`, `defenceKeep`, `surplusKeep` (unused) | ENGINE |
| strategic | neighbour factors | 1.5 hostile, 1.25 neutral | `calculateAttackValue` 0x0863e3f0, `calculateDefenseNeed` 0x0863e360 | `SAI.hostileNeighbour`, `neutralNeighbour` | ENGINE |
| strategic | wanted | `round(2 max(1, present))`, x1.25 not owned | `AIStrategicArea::update` 0x0863d6d0 (`X` never written) | `SAI.wantedNotOwned` | ENGINE |
| strategic | re-order | a free bot every 20 s; an arrived assigned bot after 20 s on foot, 35 s mounted, while it sees fewer than 2 objects | `SAI::updateBotPositions` 0x08635bc0 (AI-70) | `SAI.reorderIdle`, `reorderMounted`, `reorderSpottedMax` | ENGINE |
| strategic | area geometry | the centre box `p1 .. 2 p2 - p1`; side radius `abs(p2 - p1)` (r for side 0) | `AIStrategicArea` ctor 0x0863c000, `isInside` 0x08641d40 (AI-70) | `strategic.js areaGeometry` | ENGINE |
| strategic | order point | `randomizePos(0.8)`: per axis `p2 + rand W 0.8 - W / 2`, `W = 2 (p2 - p1)`, 20 tries on the unit's own map; else the unit type's order position if valid; else p2 | `AIStrategicArea::orderNormalBot` 0x08640bd0, `randomizePos` 0x086449e0, `getOrderPos` 0x0863e830 | `SAI.randomizeFraction`, `randomizePos`, `orderPosition` | ENGINE |
| strategic | order radius | `max(5, 0.25 side radius + 2 bounding radius)` | `orderNormalBot`, `WPMoveTo` ctor 0x08537200 | `SAI.waypointRadiusFraction`, `waypointRadiusMin` | ENGINE |
| strategic | bounding radius, unit value | 1 on foot (the page's 3 / 10 m mounted), 1 a soldier | not read | `SAI.unitRadius`, `unitValue`; `map.html botStrategicUnit` | INVENTION |
| strategic | path radius | 1.0 on foot; `0.99 x max(0.5, radius)` mounted | `getMaxPathPosRemovalDistance` 0x0852b780 (the soldier's radius not read) | `bot.js _pathRadius` | ENGINE; the radii INVENTION |
| strategic | order urgency | 0 inside `Rr = round(R) + path radius`; else `clamp(d² / 4 Rr², 0.1, 1) x (2 / 1 / 0)`; arrived `d² < 2 Rr²` | `WPMoveTo::getUrgency` 0x085374a0, `getMaxPathPosRemovalDistance` 0x0852b780 | `_order`, `bot.js _pathRadius` | ENGINE |
| strategic | owned-outside distance | `d² - side radius²` | `WPMoveTo::getUrgency` (AI-70) | `_order` | ENGINE |
| strategic | air order | p2 at ground + 75 m, radius `min(40, side radius)`, 120 m band, clearance 50; urgency 1 outside, else `(dy² + d²) / (R² + 120²)` | `orderAirBot` 0x08640810, `WPAltitudeMoveTo::getUrgency` 0x08535610 (AI-71) | `SAI.airOrderHeight`, `airRadiusMax`, `airVertical`, `airClearance`; `_orderAir` | ENGINE |
| strategic | aggression default | 0.5; attacks 1, defences 0 | | `_distribute` | UNSOURCED |
| strategic | enemy cost | 0 | `EnemyStatistics` not read | `_attackValue` | INVENTION |
| strategic | security | 1 | not read | `map.html botOccupiedUnits` | INVENTION |
| page | respawn wait | 8 s | engine: the game's spawn delay | `map.html BOT_RESPAWN_DELAY` | INVENTION |
| page | fallback rate, damage | 8 rounds/s, 30 | | `map.html BOT_FALLBACK_ROF`, `BOT_FALLBACK_DAMAGE` | UNSOURCED |
| page | soldier capsule | radius 0.6 m at +1.0 m | the height is `setCharacterHeight -1.00` (`physics.js CHARACTER_HEIGHT`) | `map.html BOT_BODY_RADIUS`, `BOT_BODY_HEIGHT` | INVENTION / CON |
| page | round range | 600 m | | `map.html BOT_FIRE_RANGE` | UNSOURCED |
| page | line of sight | a terrain march, at most 10 steps of 0.8 m, 0.5 m margin | | `map.html botLineOfSight` | INVENTION |
| page | capture | the flag's radius (8 m fallback) in 3D from the controlled object, `timeToGetControl` (8 s fallback), per bot | the level's control points; `ControlPoint::handleFrameUpdate` 0x08283b00 (AI-70) | `map.html botCaptureTick`, `nearestEnemyFlag`, `CAPTURE_FALLBACK_SECONDS` | CON / ENGINE; fallbacks UNSOURCED |
| page | candidate list | rebuilt every 0.5 s; doors recollected every 10 s | engine: the environment query | `map.html botVehicleCandidates` | INVENTION |
| page | vehicle body radius | 3 m land, 10 m air / ship | | `map.html BOT_VEHICLE_RADIUS`, `BOT_VEHICLE_RADIUS_LARGE` | INVENTION |
| page | soldier hit points | the kit's `maxHitpoints` (30 in vanilla), 30 fallback | `_shared/loadouts.json` | `map.html soldierMaxHp` | CON |
| page | bot count | 0 .. 32 (`?botCount=`) | | `map.html BOT_COUNT` | UNSOURCED |
