# Bot AI parity: where it stands and what comes next (2026-09-23, end of session)

This is the hand-off for the `/goal achieve parity with BF1942 for the bot AI`
work. Everything below `## Read this session` is engine fact read from the
decompiles (addresses given); everything marked INVENTION is a viewer stand-in.

## Read this session (all implemented unless noted)

| What | Where in the binary | Built in |
|---|---|---|
| The six battle-strength classes; a unit's table is the MAX over its `FireArms`' `setStrength` tables (a soldier's is `setBattleStrength`) | `AISettings::getNBattleStrengths` 0x084843d0, `AITemplateUnit::initFromObject` 0x085e1a90 | `bot-strength.js unitTable` |
| Each side's enemy tables: per strategic pass `strengths += security * table`, `types[type] += security`, then halved (`SAI::update` 0x086306d0 calls it at `period * 0.95`) | `SAI::updateStrengths` 0x08636c20, `getEnemyStrengths/Types` 0x08631830 / 0x08631840, `BFEnvironment::getEnemyStrengths/Types` 0x085e4fe0 / 0x085e5030 | `EnemyStrengthTables`; `map.html botOccupiedUnits` feeds them every `SAI.updateFrequency` |
| `calculateFireStrength`: own table + 0.4 (seat / aircraft) or 0.9 (ground root) x each other occupied seat; `max own^2` over the classes the enemy fields minus the enemy's strength vs my class; `0.5 max own^2` when the enemy fields nothing known; a fixed weapon with no aimable known enemy scores 0 | 0x08584580, `AIObjectControlInfo::validateCameraDirection` 0x085d4170 | `fireStrength`; `bot.js _fireStrengthOf / _candidateFire / _fixedAimable` |
| Change candidate radius 50 m, friendly 40 m, enemy objects 75 m (600 m aircraft); `engineHeatInfluence` `1 - (heat - 0.95) * 20` | `BFEnvironment::getHardware` 0x085e2fa0, `getFriendlyUnits` 0x085e2e50, `getEnemyObjects` 0x085e4eb0, 0x08585830 | `CHANGE.searchRadius = 50`, `STRENGTH`, `engineHeatInfluence` |
| The seat swap: root / own seat / other seat factors by where the bot sits (0.5/1.0/0.5 under a driver; 1.0/0.5/0.65 ship, 0.7 land, 1.5/0.5/0.5 air; root 1.0/—/0.5), x (1 - radio), order factor; `Declein(0.5 best/own) * 4`; 6.0 while a change is pending, 2.0 with no attack order and no plan; plan = the `setSelectKey` trigger | `BBChangeTeleport::calculateUrgency` 0x085611f0, `BBPChangeTeleport::createPlan` 0x08590590 | `TELEPORT`, `teleportChangeUrgency`; `bot.js _urgencyChangeTeleport`, `SwitchSeat` action; `map.html botVehicleTick` reseats |
| The box test: target behind the beam backs toward it when the heading's free run on the map <= turn radius (`aiTemplatePlugIn.turnRadius`), the angle > 1.2566 (72 deg) and the free box's short side >= 0.5 turn radius; else turn. Modes 2..5 (other move kinds) not reproduced | `CommonControls::actionStatusDecision` 0x0860fbe0, `getBox` 0x08612060 | `driveDecision`, `tankControl({freeAhead, boxShort, turnRadius})`, `nav-grid.js freeRun / freeBox` |
| Tank / seat guns' targeting: large-bore distance term `1 - clamp(1.5 d / R, 0.1, 1)`, `minRange` cut, enemy-manned vehicle scored over every seat, harmless x0.33, fixed weapon needs `validateCameraDirectionYaw`, 850 m unspotted pass at x0.75 | `BBFireLargeBore::calculateUrgency` 0x0856b390 | `bot-fire.js scoreVehicleTargets mode 'largeBore'`; `bot.js _chooseVehicleTarget` |
| Aircraft targeting: `min(1, d / 3R)` ground, `max(0, 1 - d / 1.5R)` air (x2 AA), facing `max(0.5, f.dir + 1) * 0.5`, AA rules, escape term, 600 m unspotted pass | `BBFire3d::calculateUrgency` 0x085662f0 | `scoreVehicleTargets mode 'air'` |
| Aircraft fire plan: mode by target (0.8 x extent / 5 m / 10 m / fixed seat); loop: inside 0.9 R with a line of fire aim + fire (in front 10 deg, inside 0.8 R) else `MoveTo3dObject(target, radius, maxSpeed, 0.5 maxSpeed, 50 m)`; a vehicle target adds the 200 m break after passing inside 1.3 x turnRadius; > 200 m from the zone fly back | `BBPFire3d::createPlan` 0x0859ad90, `createPlanInternal` 0x0859b4b0, `createMobileLessAttackPlan` 0x085a0080, `EntryPlaneAimAt::execute` 0x0861f610, `PlaneControl::aimAtDirection` 0x08629cf0 | `PLANE_FIRE`, `planeFireMode`, `attackRunStep`, `aimAtDirection`; `bot.js PlaneAttack` action |
| Plane idle: airborne or rolling > 0.1 m/s -> `MoveTo3d` to its own position under `ConFalse` (an orbit); on the ground still -> reset controls | `BBPIdle3d::createPlan` 0x085be0e0 | `bot.js _planIdle` orbit |
| ControlInfo3d +0x104 / +0x108 = `maxRollAngle` 0.9999 / `maxClimbAngle` 0.3333 (the last two of the 14 con floats) | `AITemplateControlInfo3d` ctor 0x085defc0 | `PLANE_FIRE.maxRollAngle / maxClimbAngle` (roll clamp; the climb during a takeoff aim) |
| The water map: `ai.addSearchMap Boat2 1 5.0 0 125 ...` — free where the water is >= depth deep, no slope test, brush keeps hulls off the shore | level `AIpathFinding.con` (`bf42/ai_level.py` already parsed `waterMap`) | `nav-grid.js buildNavMap({ waterMap })` (chamfer erosion for the 125 m brush); `map.html botWaterNav`; ships now route on it through `_steerToward`'s boat branch |
| `EntryPlaneRoll::execute` 0x08622540 / `PlaneControl::roll` 0x0862b430 (a roll to a target angle, +-2 pi wrap) | read, NOT built (no behaviour reaches it in the viewer yet) | — |
| `BAPAMoveTo3d::getFirstPoint` 0x08540de0 and friends | read, trivial | — |

Unit pins: `tests/bot_ai_harness.mjs` (strength, teleport, drive, vehicleFire,
planeFire, water) and `tests/test_bot_ai.py` (24 tests, all pass). The whole
`tools/bf1942-models` suite passes; `./scripts/verify.sh --skip-e2e` passed
(388 API tests) before the last two small edits to `bot.js` / `bot-fire.js`,
which the bot tests then covered.

## Verified live (El Alamein, 8 bots, `?botDebug`)

- The tables arrive at every bot (`__bots()[i].enemyTypes`, e.g. `{Infantry: 2, Air: 1.5}`).
- Bots now take **seats**, not only driver seats: a bot took the Priest's
  gunner seat unprompted (the gunner's 12^2 fire strength beats the empty hull).
- The seat-swap oscillation (driver <-> gunner every tick) was fixed: a seat of
  an undriven hull is a fixed weapon and needs an aimable known enemy.
- A Sherman under a bot aims exactly at a soldier 40 m ahead (barrel yaw ==
  bearing, barrel pitch == wanted pitch once the aim is taken from the gun
  node) and fires 17 shells.
- A Spitfire under a bot takes off, flies `approach`, and orbits its idle point.

## Session 2 (2026-09-23, later)

- **Verified live: a bot-driven Sherman's rounds reach soldiers.** Sherman
  at 40 m (bot_2, frozen bot_1): the hull MG path `[bots] bot_2 hit bot_1
  for 28 ... [round Browning_2]` kills in ~6 ticks; with the MG groups
  removed the shell's splash lands `for 30 ... [splash ShermanGunBarrel_2 d
  2.5]`. Fixed on the way: `applySplash` already takes the HP off a
  target's own Armor and returns `lost` (there is no `hit.damage`), so the
  bot side is now `botDamageLanded` (log, incoming fire, death) instead of a
  second `applyDamageToBot`; the firing seat comes from the record's new
  `firerGroup` (a driver and a gunner share the hull's owner id); an MG
  group's damage is its own projectile spec's (`botSpecDamage`), and the
  shell test is `splashSpec(...).impact`. The debug line now names the path.
- **The Priest seat swap every tick** (a regression the fight exposed):
  `calculateFireStrength` vacates the bot's own seat when it weighs another
  (AI-59), and a fixed gun's aimability is the candidate seat's own
  traverse. Live: no swaps in 1,200 frames.

## Open, in priority order (the next session starts here)

1. ~~**A bot-driven vehicle's rounds do not damage anyone.**~~ Done, see
   Session 2. `map.html`
   `splashTargets()` lists placed objects and the local soldier only, so a
   Sherman's shell splash never reaches a bot; and `botFireTick` skips mounted
   bots (`if (bot.vehicle) continue`), so its MG rounds (no splash) have no
   soldier hit test at all. Fix (all in `map.html`):
   - add every alive on-foot bot to `splashTargets()` as `{ owner: 'bot:' +
     id, armor: world.armorOf(id), soldier: true, pose, splashMaterial:
     SOLDIER_SPLASH_MATERIAL, x, y: soldier.y + CHARACTER_HEIGHT, z, botId }`;
     in `applyVehicleHit`, for `hit.target.botId` call
     `applyDamageToBot(botId, hit.damage, firerBotId, [record.x, record.y,
     record.z])` — `record.firer` is `group.owner`; map it to the bot whose
     `vehicle.groups`/`manned` holds the group (`botControllers.find(...)`).
   - in `botFireTick` for a mounted bot: compare each active group's
     `g.shots` with the last tick's; for every new shot whose
     `g.stats.projectile.damage.radius` is falsy (MG rounds) run the cone
     resolver with the gun's ray and `botRoundDamage(g.stats)`. Make
     `bot.aimRay()` use `_aimOrigin()` and the turret (`_aimReference`) or
     nose (`_noseReference`) direction when mounted.
   - the existing `[bots] X hit Y for N` log then proves both paths; re-run
     the Sherman-at-40 m recipe in `project_bot_fight_verification` memory.
2. **The plane never pulls the trigger.** In the last run `attackRunStep`
   reported `attack` while taxiing (d 257 -> 156, LOS true) but `fire` stayed
   false, and in the air the approach never reached `attack` because the
   line of sight from 100 m altitude at 400 m failed. Add
   `this._attackDbg = { dist, cosFront, inFront, los, fire }` in
   `_execPlaneAttack` and expose it in `__bots()`; the suspects are the
   10 deg `inFront` cone against the nose reference on the ground and the
   `lineClear` grazing the terrain at long range (the engine's
   `ObjectLineOfFire` runs from the camera base; consider testing LOS to the
   target's chest from `_aimOrigin()` with the hull's own collision skipped).
   Then verify: a Spitfire fires on a soldier 260 m down the runway and the
   `hit bot_x` log appears.
3. **Docs and ledger.** `bot-behaviours.md` needs a §12 with the table above;
   `features/bf1942-engine-reference/ledger.md` rows AI-50..AI-58 (tables,
   fire strength, seat swap, box test, large-bore targeting, aircraft
   targeting and plan, idle orbit, ControlInfo limits, water map); the README
   index line "Bots and the AI subsystem" should drop `BBFire3d/BBPFire3d`,
   `BBChangeTeleport`, `BBFireLargeBore`, the ControlInfo limits and the
   water bitmap from its Open list and add the two items above; the
   `IMPLEMENTATION_PLAN.md` gets "Follow-up 7". The decompiles are in the
   session scratchpad only (`scratchpad/decomp/{round3,sai,ctl,unit,unit2}`),
   so re-run `features/bf1942-engine-reference/lnxded/decompile.sh` with the
   names in the table if a claim needs re-reading (escape parentheses:
   `'SAI::update\(float\)'`; the script uses `grep -E`).
4. **Remaining INVENTIONs worth reading next**: `AISettings::getArmourClassValues`
   (+0x98, the per-class weighting; 1 here — find the `ai.setArmourClassValue`
   con handler), `BotMain::getHarmlessThrsh` (+0x2c; 0 here), the exact stall /
   dive terms of `PlaneControl::towardsDirection` (the viewer's 40 m / 10 m
   pull-ups and 15 / 45 deg nose limits), `actionStatusDecision` modes 2..5,
   a target's information `security` (+0x14; 1 here), and the 20 s
   `getBBPFeedback` veto for vehicles (shared with infantry).
5. **Boats live**: no vanilla boat drives on El Alamein; load Wake or
   Guadalcanal (`?map=wake`, water 95 m, `Boat2` depth 5 brush 125) and mount
   a bot in an Elco80 (`__botMount(id, 'Elco80')`); check the water nav builds
   (`[bots] water nav map (Boat2): N ms`) and the hull follows a route.
