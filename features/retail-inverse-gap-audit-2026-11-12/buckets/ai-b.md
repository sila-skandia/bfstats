# ai-b

Rows: 42 (`rows/ai-b.txt`). Sweep: AIRadio and its readers, the behaviour classes the binary
builds, MedicAssist, the SAI's strategy and statistics code, pathfinding and sensing INVENTION
labels. Binary: `~/bf1942-lab/linux-src/bf1942_lnxded.static` (objdump, read
2026-11-12).

Note: `viewer/bot-radio.js` is untracked and `bot-mount.js` / `bot-referee.js` are modified in
the working tree (today's seat-yield work from another session). The AI-169..AI-172 BUILT rows
below rely on that uncommitted code.

## Summary

Rows: BUILT 29, NOT-GAME 2, PARTIAL 7, MISSING 1, DIFFERENT 1, UNREAD 2.
Sweep: 3 findings (1 PARTIAL high, 1 PARTIAL medium, 1 MISSING medium), plus confirmations of
what retail never does.

Top findings:
1. **PARTIAL high, S**: bots hear 21 radio messages but our behaviours read only 3 of them
   (GetIn, BailOut, AbandonShip). Retail also scales Fire by Fire, Cover me and Hold fire; MoveTo
   by Go, Hold position and Wait; TakeCover by Take cover; Scout by Check your six and the seven
   "spotted" calls; MedicAssist by Medic and Need repairs.
2. **PARTIAL medium, M**: engineer bots never repair vehicles. Retail's MedicAssist takes
   friendly vehicles as targets for the RepairPack (strength 2 against every armour class).
   Ours lists only soldiers.
3. **MISSING medium, M**: the SAI's battle statistics (`EnemyStatistics`) and the
   wanted-strength integer of AI-168. Ours uses `round(2 x present)` with an enemy cost of 0, so
   retail's "send more bots where the side is losing" never happens.
4. **PARTIAL medium, M**: AI-158. The fire plan's grenade branch (`soldier_choseThrownWeapon`
   inside `BBPFireInfantery::createPlan`'s state switch) is not ported. Bots throw only when
   BBFire scores the grenade as their best weapon.
5. **PARTIAL low-medium, M**: AI-72. An enemy's information security never decays from 1, so
   a remembered enemy weighs on Fire and TakeCover as much as one in sight.

## Findings (MISSING / PARTIAL / DIFFERENT / UNREAD), highest impact first

### [PARTIAL] [impact: high] [effort: S] Bots hear the player's radio, but only Change reacts to it
- Retail: `AIRadio::getMessageStrength` 0x084825c0 has 15 callers (objdump, the message id
  pushed before each call). Each reader multiplies its urgency by the bot's own strength `s`,
  which a shout within 70 m raises (AI-169/AI-170: `s += (1 - s) x gain x 0.8`, decaying 0.1/s):
  - `BBFire` 0x08563570 (0x085652b9/e3/0x08565313), `BBFire3d` 0x085662f0, `BBFireLargeBore`
    0x0856b390, `BBFireUnarmed` 0x0856eb90 and `BBFireGuided` 0x085705d0, all the same:
    `x (1 + s[Fire 0x25]) x (1 + s[CoverMe 0x2b]) x (1 - s[HoldFire 0x26])` (`faddp` / `fsubp` after
    `fld1`, product kept at -0x258(%ebp) in BBFire).
  - `BBMoveTo` 0x08574f80 (0x08575039/5d/84) and `BBMoveToFixed` 0x08575680:
    `(1 + s[Go 0x31]) x (1 - s[HoldPosition 0x2c]) x (1 - s[Wait 0x24])`.
  - `BBTakeCover` 0x0857c120 (0x0857d063) and `BBTakeCoverInfantry` 0x08580140 (0x0858103d):
    `s[TakeCover 0x29] + 1.0` (`fadds 0x86ba8d4`). `BBTakeCover3d` 0x0857e4c0: `s[CheckYourSix
    0x34] + 1`.
  - `BBScout` 0x08579a50 (0x0857a81e..0x0857a968): `(1 + s[CheckYourSix 0x34]) x prod(1 +
    s[0xf..0x15])`, the seven team "spotted" messages (Armor, Infantry, Unit, Ship, Submarine,
    Airplane, Scout).
  - `BBMedicAssist` 0x08573840: `(1 + s[Medic 0x28])` for a soldier target (`Information+6 &
    0x40`, 0x085742ae -> `fmuls -0x1c4`) and `(1 + s[NeedRepairs 0x36])` for any other target
    (`fmuls -0x1c8` at 0x08574320).
  - FireInHole (39) is subscribed by `radio.con` but no behaviour reads it.
- Ours: `viewer/bot-radio.js` holds the store and its decay. `bot-mount.js` `urgencyChange` /
  `urgencyChangeTeleport` read GetIn / BailOut / AbandonShip. Every other reader is a constant 1:
  `bot-behaviours.js:454` says so outright ("the radio message term `(1 + strength)` is 1 (no
  radio in the viewer)"), `bot-fire.js` `scoreTargets` / the environmental branch (line 816) has
  no radio term, ScoutState `boost` has none, and `MedicState.evaluate` has none.
- A player notices: "Hold position" or "Wait" near teammate bots should damp their MoveTo to
  about 0.2 for several seconds (they stop advancing), and "Hold fire" does the same to their
  firing. "Go" and "Cover me" push them forward and make them shoot. "Take cover" sends nearby
  bots to cover. "Medic!" or "Need repairs!" makes a medic or engineer prefer to help. "Infantry
  spotted" makes the team look around. Today every one of these keys does nothing to the bots.
- To build: pass `s(id)` (the referee's `radio.strength(bot.playerId, id)`, as `bot-mount.js`
  does) into `urgencyFire` / `scoreTargets` (one product on the urgency), `urgencyMoveTo` and the
  Fixed MoveTo in `bot-decision.js`, `TakeCoverState.evaluate` (`ctx.radio`), `ScoutState`, and
  `MedicState.evaluate` (per target, soldier vs not). Add the RM ids to `bot-radio.js`'s `RM`. Pin
  each one in `tests/test_bot_seat_yield.py`'s style. Offline only, as today. The node room has
  no bots.

### [PARTIAL] [impact: medium] [effort: M] Engineer bots never repair a vehicle
- Retail: `BBMedicAssist::calculateUrgency` 0x08573840 takes its friends from `IAIEnvironment`
  +0xc. Any unit with a healing weapon for its armour type counts, and vehicles are included: a
  non-soldier target takes the NeedRepairs radio term (0x08574320), and a vehicle-type friend
  beyond reach is tested with `traceValidPoint` along its reverse heading
  (features/bf1942-ai-research-2026-09-21/bot-behaviours.md section 6). Vanilla `RepairPackAI`
  has strength 2 for every armour class (same note), so an engineer bot walks to a damaged
  friendly tank and holds the RepairPack on it (`BBPMedicAssist::createPlan` 0x085bf350).
- Ours: `bot-decision.js urgencySpecial` builds `friends` from `world.players` only, with
  `type: 'Infantry'`. `MedicState.evaluate` (`bot-behaviours.js`) also skips `inVehicle`. A
  damaged hull is never a candidate, so an engineer's RepairPack (no Infantry strength) never
  scores. `MEDIC.unitValue` is 1 for everything (INVENTION). Retail uses `Information+0x14`,
  which AI-92 already extracts as `basicTemp`.
- A player notices: a damaged tank parked beside a bot engineer is never repaired, and a human
  driver who shouts "Need repairs!" gets nothing. In retail engineer bots do repair.
- To build: add friendly hulls to `friends` with their armour class, hit-point fraction, upright
  test and radius. Use `bot-units.js` `aiOf().basicTemp` as the value. Run the heal on hull
  armour through the referee's `useRepairPack` path. Use the vehicle's reverse-heading
  valid-point test for an out-of-reach hull. Files: `bot-decision.js`, `bot-behaviours.js`,
  `bot-referee.js`.

### [MISSING] [impact: medium] [effort: M] The SAI's battle statistics and wanted strength (AI-168)
- Retail: `AIStrategicArea::update` 0x0863d6d0 keeps a running integer `+0xd4[side]`. Each pass
  sets it to `trunc((2 - SCurve(+0xac)) x max(1, wanted))` when the area is owned, or
  `trunc((2 - SCurve(+0xb4)) x 1.25 x max(1, wanted))` otherwise, then adds
  `EnemyStatistics::sample` 0x0862dfa0 per object. The statistics come from the battle (the
  `AreaAssignment` / `SampleHelper` classes, which no code or doc of ours names). The sampler
  itself is not read (AI-168 open).
- Ours: `strategic-ai.js` around line 361, `s.wanted = round(2 x present)` (x `wantedNotOwned`),
  and the header labels "the enemy-cost term (`EnemyStatistics`) is 0" as INVENTION.
- A player notices: the commander does not reinforce areas where its side keeps dying, or
  ease off where it is unopposed. Bots spread over flags by headcount alone.
- To build: read `EnemyStatistics::sample` and `SampleHelper::addSample` 0x0862e0a0 plus who
  feeds them (the kill events), then port it into `strategic-ai.js` `_updateAreas`. Pin it in
  `tests/test_strategic.py`.

### [PARTIAL] [impact: medium] [effort: M] AI-158: the fire plan's throw branch
- Retail: `BBPFireInfantery::createPlan` 0x085a3870 calls `choseWeapon` (0x085a402f) **and**
  `soldier_choseThrownWeapon` 0x085cf300 (0x085a4067, its only caller), keeping both indexes
  (-0x404 / -0x408). It then runs a state switch over the firing state's +4 (a jump table at
  0x8702d50, 8 cases; a `Rand` draw per candidate in a loop over 7 at 0x085a45fa..0x085a46ee).
  Cases at 0x085a5376..0x085a548c put the thrown weapon in the plan's weapon slot (-0x244) in
  states 0 -> 1 and 3, the latter with `getNumShotsFired` on it. In other words retail has a
  dedicated throw mode, separate from BBFire's pick.
- Ours: `bot-plans.js` around line 176 says it outright: "the thrown weapon's branch ... is not
  ported". A bot throws only when `choseWeapon` returns a grenade as the in-range strongest.
- A player notices: bot infantry rarely lob grenades at a held position, where in retail
  grenades come over walls at close range.
- To build: read the state switch's eight cases (what selects state 0/3 and the -0x41a flag),
  then add a throw plan to `bot-plans.js` `planFire` with the thrown weapon. The referee already
  flies thrown rounds (`bot-rounds.js`). This is the UNREAD part to settle first.

### [PARTIAL] [impact: low-medium] [effort: M] AI-72: a remembered enemy's security never decays
- Retail: an enemy's `InformationKnown::getSecurity(t)` 0x085e8670 is `1 - SCurve((t - +0x3c) /
  +0x40)`. It is refreshed by `setTime` 0x085e8210 at a sighting and decays with the object's info
  record +0xc. Fire (`scoreMountedInfantry` base) and TakeCover (heard threats) both multiply by
  it.
- Ours: security is 1 always (`bot-fire.js` header, labelled INVENTION; `bot-decision.js:433`
  passes `security: 1` for heard enemies).
- A player notices: a bot that lost sight of them keeps scoring them and cowering from them at
  full weight, where retail's bot gradually forgets.
- To build: trace what writes the info record +0xc (per AI template?), then decay in
  `bot-sense.js` knowledge and feed `bot-fire.js` / `bot-behaviours.js`.

### [PARTIAL] [impact: low] [effort: S] AI-116: the tank's attack-portal firing point
- Retail: `createPlan`'s state switch can replace the firing point with
  `getPortalLookAtPosition` (`getAttackPortal`, the level's cover data).
- Ours: `bot-fire.js` `FIRE_APPROACH` / `bot-plans.js execFireApproach` use own position or the
  away point. The portal case is INVENTION.
- A player notices: rarely. It decides where a tank parks to engage.
- To build: read `getAttackPortal`, then add the portal case in `execFireApproach`.

### [PARTIAL] [impact: low] [effort: S] AI-113: the landing approach radius
- Retail: unknown. The route's R (96 m on Wake) would stop the craft short, yet retail craft
  land.
- Ours: `doctrine-landing.js` keeps the no-route 5 m (INVENTION).
- A player notices: no. Craft do land.
- To build: read what overrides R between `WPMoveToBeachLanding` and the approach.

### [PARTIAL] [impact: low] [effort: S] AI-83: the break point's x/z
- Retail: a line-circle construction near 0x0859bc90.
- Ours: 200 m along the heading (INVENTION, `bot-pilot.js` `PLANE_FIRE`).
- A player notices: pilots' extension after a pass differs slightly.

### [PARTIAL] [impact: low] [effort: S] AI-95: the air-avoid grid test and the plan's speed
- Ours: `bot-vehicle-air.js` / `bot-pilot.js` have the runway and 5 s prediction. The grid's
  inside test and the avoid plan's speed are not ported (the row's own status).

### [PARTIAL] [impact: low] [effort: S] AI-170: the subscription table is hard-coded per mod
- Ours: `bot-radio.js subscriptionsFor` has vanilla's list, with GC/bf1918 one-argument gains,
  rather than reading the level's `Game/AI/radio.con`. That is right for every shipped mod read,
  but a mod with its own file would be wrong. The header says "22 messages" while the list (and
  vanilla's file) has 21.

### [UNREAD] [impact: low-medium] [effort: M] AI-173: a seat request on a ship bot
- Retail: `BBChangeTeleport` with a standing request on its own seat and no better seat scores
  6.0 toward its own unit (0x085619ce). `BBPChangeTeleport::createPlan` 0x08590590 for that case
  is not read.
- Ours: `bot-mount.js` passes `requestAge` to the BBChange paths (lines 234, 340, 405) but not to
  `urgencyChangeTeleport` (line 355). Ship rows (`Boat`, `BoatFixed`, `UnarmedBoat`) run
  ChangeTeleport, so a request for a bot's ship gun seat does nothing.
- A player notices: on a destroyer or carrier, asking a bot gunner for their seat gets no
  response. Retail's response is unknown until the plan is read.
- To settle: read 0x08590641 -> 0x0859117b.

### [UNREAD] [impact: low] AI-91: the Aimer's miss correction
- Retail: `BAPAAimAt::correctAim` 0x0853a6d0 adds 0.8 x the last observed miss. Who writes the
  record (+0x138) is not found.
- Ours: not ported (features/bot-gunner-aim).
- To settle: find the writer of `Bot+0x138` (a projectile-impact callback).

### [DIFFERENT] [impact: low] AI-160: AI LOD 2 drops deck bots through a ship
- Retail: at LOD 2 the cheap mover drops a deck bot through the deck to the sea. At LOD 0 they
  walk the deck.
- Ours: every bot runs the full mover (no AI LOD), the LOD 0 behaviour. This is deliberate.
  Retail's LOD 2 result is a defect not worth copying.

### [MISSING] AI-168. See the SAI finding above.

## From the sweep: retail behaviour with no ledger row

- The radio readers (15 call sites, message by message) and MedicAssist's vehicle targets are
  the first two findings above. Neither has a ledger row naming the readers' message ids. They
  should go in as AI-174/AI-175.
- **Behaviours retail never runs (BUILT: correctly absent).** `BBExplosives`, `BBMine`,
  `BBResupply`, `BBRepair`, `BBCombatMovement`, `BBManWpn`, `BBIndirect`, `BBRadio` have
  `calculateUrgency` bodies but their constructors have no callers (objdump: no `call` to any
  of their ctors). `BBBailOut` and `BBTakeCover` are built by the anonymous
  `BBCreateFunction*` factories (0x08494c10 for BailOut), but no shipped `AIbehaviours.con`
  (vanilla, FH, FHSW, EoD, bf1918, GCMOD) registers BailOut. So retail bots never plant mines or
  explosives, never fetch ammo, never bail by a damage curve, and never speak radio (RADIO-8,
  SPOT-14). Ours does none of these either.
- **Commands retail bots ignore (BUILT: correctly absent).** Follow me (48), Stick together
  (47), Fall back (46), Go for enemy flag (45), Pickup (8), Defending/Attacking (29/30),
  Roger/Negative and the support requests are not in `radio.con`, so `sendMessage` drops them
  (0x0848266a). Ours ignores them too. `doctrine-squad.js`'s squad follow is a labelled
  INVENTION, not a reply to "Follow me".
- **BBRoam (bf1918, GCMOD Special on armed hulls).** It is listed in `bot-rows.js` but not
  modelled (the file's own note). PARTIAL, low: mod-only.
- **The strategy manager's con words.** `StrategyManager::addSpecificObjectModifier`
  0x08518860, `addProhibitedPrecedingStrategy` 0x08518800, `createHeterogeneousCondition`
  0x085192e0 and `createAreaCondition` 0x085194d0 have no match in `bf42/ai_level.py` or
  `strategic-ai.js` (`StrategicObjectsModifier` and constant conditions are parsed). UNREAD for
  impact: settle it by grepping each shipped level's `Strategies.con` / `conditions.con` for
  these words. If none uses them, they are NOT-GAME.
- **Pathfinding.** With a level's baked strategic map the engine search is used
  (`nav-search.js engineStrategicPath`). Without one the coarse-region A* is labelled INVENTION,
  as are the retry, back-out and wedge rules in `bot-route.js`. No new retail rule was found
  beyond AI-163. Generated levels (no strategic map) run the invented layer by design.
- **Sensing.** `bot-sense.js` labels its environment grid (a scan of `world.players`), sense
  heights and re-cast count as INVENTION. Its only uncited retail gap is the security decay
  (AI-72 above).

## BUILT and NOT-GAME, one line each

- AI-73 BUILT: landing craft as own vehicles and the boat helm -> `spawned-craft.js`
  `detachSpawnedCraft`, `bot-vehicle-air.js boatSpeedControl`, `bot-plans.js freeLevel`.
- AI-74 BUILT: prerequisite sum, presence ownership, SAI update frequency ->
  `strategic-ai.js _evaluatePrerequisite`, `_chooseStrategy`.
- AI-78 BUILT: `setIsAntiAircraft` on Armament -> `extract_vehicle_ai.py`, `bot-fire.js`
  `isAntiAircraft`.
- AI-79 BUILT: per-aircraft `.con` table -> `aircraft.js aircraftSpec`.
- AI-80 BUILT: box drag -> `aircraft.js applyBoxDrag`.
- AI-81 BUILT: plane aim and throttle floor -> `bot-vehicle-air.js planeAimFor`, `bot-pilot.js`.
- AI-82 BUILT: precision classes -> `bot-vehicle-air.js precisionGate`, `nearestMiss`.
- AI-86 BUILT: tank law tail and damping -> `bot-vehicle.js` `tankControl`, `TANK.rollDamping`.
- AI-88 BUILT: gunner look counts -> `bot-aim.js lookAtCounts`.
- AI-89 BUILT: turret lead -> `bot-aim.js firingDirection`, `turretAimAt`.
- AI-92 BUILT: `basicTemp` and the 12 m reach -> `bot-units.js aiOf`, `bot-mount.js
  unitReachable`.
- AI-97 BUILT: landing zones -> `doctrine-landing.js landingZonesOf`, `randomPosOnSide`.
- AI-98 BUILT: beach run with the ramp down -> `doctrine-landing.js beachLandingOrder`,
  `bot-plans.js BoatMoveToDirect`. The ramp is now written (AI-111 `RAMP_INPUT`).
- AI-109 BUILT: line test skipping the target's hull -> `bot-perception.js
  lineClearSkippingSelf`.
- AI-110 BUILT: a craft off its map is offered to nobody -> `bot-units.js ownMapOf`,
  `bot-mount.js onOwnMap`.
- AI-111 BUILT: crew bails aground, tip test -> `doctrine-landing.js craftBailReason`,
  `craftTipped`.
- AI-114 BUILT: `aiSettings` vehicle groups extracted -> `bf42/ai_level.py`.
- AI-141 BUILT: an Info pixel naming an unused region -> `strategic-map.js regionAt`.
- AI-156 BUILT: `choseWeapon` by distance -> `bot-fire.js choseWeapon`, `bot-plans.js`.
- AI-157 BUILT: trigger channel `weaponFire` -> `extract_loadouts.py`, `bot-aim.js writeInput`.
- AI-162 BUILT: control point capture fields -> server recorder `sample_cpt`,
  `replay-capture.js`.
- AI-163 BUILT: obstruction count zeroed on a new path -> `bot-route.js ensureRoute`
  (`_replanKeepsCount`).
- AI-164 BUILT: SCurve / Declein tables -> `bot-behaviours.js SCURVE_TABLE`, `DECLEIN_TABLE`.
- AI-165 BUILT: `ceil(R)` arrival -> `strategic-ai.js`, `bot-decision.js _captureRing`.
- AI-166 BUILT: Aimer halving count truncates -> `bot-aim.js firingDirection`.
- AI-167 BUILT: mounted-infantry seat strength truncates -> `bot-fire.js scoreMountedInfantry`.
- AI-169 BUILT (offline, uncommitted): player radio to the AI -> `bot-radio.js createAIRadio`,
  `bot-referee.js radioMessage`, `map.html botsHearRadio`.
- AI-171 BUILT (uncommitted): BBChange radio term -> `bot-mount.js urgencyChange`,
  `bot-radio.js changeRadioStrength`.
- AI-172 BUILT (uncommitted): seat request `age / 15` -> `bot-referee.js requestSeat`,
  `bot-mount.js seatRequestAge`.
- AI-84 NOT-GAME: a measurement of our plane orbiting a soldier (parity record).
- AI-120 NOT-GAME: runner capture-rate measurements.
