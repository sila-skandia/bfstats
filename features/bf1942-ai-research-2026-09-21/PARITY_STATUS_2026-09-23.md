# Bot AI parity: where it stands and what comes next (2026-09-23, end of session)

This is the hand-off for the `/goal achieve parity with BF1942 for the bot AI`
work. Everything below `## Read this session` is engine fact read from the
decompiles (addresses given); everything marked INVENTION is a viewer stand-in.

## Read this session (all implemented unless noted)

| What | Where in the binary | Built in |
|---|---|---|
| The six battle-strength classes; a unit's table is the MAX over its `FireArms`' `setStrength` tables (a soldier's is `setBattleStrength`) | `AISettings::getNBattleStrengths` 0x084843d0, `AITemplateUnit::initFromObject` 0x085e1a90 | `bot-strength.js unitTable` |
| Each side's enemy tables: per strategic pass `strengths += security * table`, `types[type] += security`, then halved (`SAI::update` 0x086306d0 calls it at `period * 0.95`) | `SAI::updateStrengths` 0x08636c20, `getEnemyStrengths/Types` 0x08631830 / 0x08631840, `BFEnvironment::getEnemyStrengths/Types` 0x085e4fe0 / 0x085e5030 | `EnemyStrengthTables`; `bot-referee.js occupiedUnits` feeds them every `SAI.updateFrequency`, each unit weighed by its side's security (AI-75) |
| `calculateFireStrength`: own table + 0.4 (seat / aircraft) or 0.9 (ground root) x each other occupied seat; `max own^2` over the classes the enemy fields minus the enemy's strength vs my class; `0.5 max own^2` when the enemy fields nothing known; a fixed weapon with no aimable known enemy scores 0 | 0x08584580, `AIObjectControlInfo::validateCameraDirection` 0x085d4170 | `fireStrength`; `bot.js _fireStrengthOf / _candidateFire / _fixedAimable` |
| Change candidate radius 50 m, friendly 40 m, enemy objects 75 m (600 m aircraft); `engineHeatInfluence` `1 - (heat - 0.95) * 20` | `BFEnvironment::getHardware` 0x085e2fa0, `getFriendlyUnits` 0x085e2e50, `getEnemyObjects` 0x085e4eb0, 0x08585830 | `CHANGE.searchRadius = 50`, `STRENGTH`, `engineHeatInfluence` |
| The seat swap: root / own seat / other seat factors by where the bot sits (0.5/1.0/0.5 under a driver; 1.0/0.5/0.65 ship, 0.7 land, 1.5/0.5/0.5 air; root 1.0/—/0.5), x (1 - radio), order factor; `Declein(0.5 best/own) * 4`; 6.0 while a change is pending, 2.0 with no attack order and no plan; plan = the `setSelectKey` trigger | `BBChangeTeleport::calculateUrgency` 0x085611f0, `BBPChangeTeleport::createPlan` 0x08590590 | `TELEPORT`, `teleportChangeUrgency`; `bot.js _urgencyChangeTeleport`, `SwitchSeat` action; `map.html botVehicleTick` reseats |
| The box test (superseded 2026-09-24 by AI-85: the whole state machine, states 0..9, on the pathfinder's search box; the 72 deg test is on the side angle) | `CommonControls::actionStatusDecision` 0x0860fbe0, `getBox` 0x08612060, `getSearchBox` 0x085f4180 | `bot-vehicle.js actionStatusDecision`, `searchBox`; `bot-route.js hullDecision` |
| Tank / seat guns' targeting: large-bore distance term `1 - clamp(1.5 d / R, 0.1, 1)`, `minRange` cut, enemy-manned vehicle scored over every seat, harmless x0.33, fixed weapon needs `validateCameraDirectionYaw`, 850 m unspotted pass at x0.75 | `BBFireLargeBore::calculateUrgency` 0x0856b390 | `bot-fire.js scoreVehicleTargets mode 'largeBore'`; `bot.js _chooseVehicleTarget` |
| Aircraft targeting: `min(1, d / 3R)` ground, `max(0, 1 - d / 1.5R)` air (x2 AA), facing `max(0.5, f.dir + 1) * 0.5`, AA rules, escape term, 600 m unspotted pass | `BBFire3d::calculateUrgency` 0x085662f0 | `scoreVehicleTargets mode 'air'` |
| Aircraft fire plan: mode by target (0.8 x extent / 5 m / 10 m / fixed seat); loop: inside 0.9 R with a line of fire aim + fire (in front 10 deg, inside 0.8 R) else `MoveTo3dObject(target, radius, maxSpeed, 0.5 maxSpeed, 50 m)`; a vehicle target adds the 200 m break after passing inside 1.3 x turnRadius; > 200 m from the zone fly back | `BBPFire3d::createPlan` 0x0859ad90, `createPlanInternal` 0x0859b4b0, `createMobileLessAttackPlan` 0x085a0080, `EntryPlaneAimAt::execute` 0x0861f610, `PlaneControl::aimAtDirection` 0x08629cf0 | `PLANE_FIRE`, `planeFireMode`, `attackRunStep`, `aimAtDirection`; `bot.js PlaneAttack` action |
| Plane idle: airborne or rolling > 0.1 m/s -> `MoveTo3d` to its own position under `ConFalse` (an orbit); on the ground still -> reset controls | `BBPIdle3d::createPlan` 0x085be0e0 | `bot.js _planIdle` orbit |
| ControlInfo3d +0x104 / +0x108 = `maxClimbAngle` 0.3333 / `maxRollAngle` 0.9999 (corrected in session 2 from the con setters; first read swapped) | `AITemplateControlInfo3d` ctor 0x085defc0 | `PLANE_FIRE.maxRollAngle / maxClimbAngle` (roll clamp; the climb during a takeoff aim) |
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

- **The plane fires and kills.** The Spitfire recipe (a frozen soldier 260 m
  down the runway) ends `[bots] bot_4 hit bot_1 for 30 ... (killed) [round
  SpitfireGuns]`. Why it never fired: the gate was a misread. The engine's
  mode 0 (a soldier) has no in-front test at all; `ObjectInFront` is a 10 m
  half-space for modes 1 / 2, not a 10 deg cone; the trigger is the
  precision test (the round's miss along the current barrel at the lead
  time), the line of fire is the memory's seen flag (no ray), and the battle
  zone is the map (AI-61). The sense rays hit the plane's own fuselage
  0.9 m out, so a plane never saw anything (AI-62).
- **The flight law is the engine's** (AI-60): `towardsDirection` read at its
  real address 0x08629fa0 by emulating its x87 code
  (`features/bf1942-engine-reference/lnxded/x87emu.py`,
  `towards_direction_emu.py`), plus `towardsPoint` and `aimAtDirection`.
  `planeControl` (the INVENTION law) is gone. Live: tail-up takeoff, a 180
  deg turn in 12 s holding height, 240 s of flight without loss, three Axis
  planes cruising at 98..127 m.
- **A Spitfire bot left its plane at 66 m** for a Wespe passing below; the
  seated Change is now gated on bailing (AI-63).
- Docs: bot-behaviours §12, ledger AI-57 (offsets corrected: +0x104 is
  maxClimbAngle, +0x108 maxRollAngle) and AI-59..AI-63, the README index
  line, IMPLEMENTATION_PLAN Follow-up 8.

- **Boats** (AI-66): the water map is built as read (a 125 m brush for
  `Boat2`), and it is nearly shut: on Truk 0.3 % of the world is free and
  every big-ship spawn sits in a blocked cell, so a bot in the Yamato or a
  destroyer takes the seat and never finds a route (Wake: the Hatsuzuki
  too). Landing craft (`LandingCraft3`, depth 1.4, brush 4) are the boats
  bots should drive, but the viewer lists a carrier's / destroyer's LCVP /
  Daihatsu as a seat of the parent hull, so none drives alone yet; the
  levels with a free LCVP / Elco (`invasion_of_the_philippines`) ship no AI
  data.
- **Two INVENTIONs retired**: the armour-class values are 1, 3, 8, 15, 1, 6
  (AI-64), the harmless threshold is the 0 every `BotManager` call passes
  (AI-65).

- **Tanks capture on Bocage** (AI-70): the strategic order is the engine's
  (centre box about p2, the corner-anchored random point on the unit's own
  map, the per-type order position as fallback, the side radius |p2 - p1| in
  the WP radius, arrival inside round(R) + the unit's path radius, the 20 s /
  35 s re-order of an arrived bot) and a vehicle captures by its hull's 3D
  distance. Before: no capture in 150 s, tanks parked 51..134 m out. After:
  a Tiger takes the north bridge and an M3A1 the south one inside 160 s.

## Open, in priority order (the next session starts here)

1. **No soldier kill from the air (2026-09-24, brief A: still none, and
   now explained).** Built since (AI-79..AI-83): every aircraft flies on its
   own `.con` table (the Spitfire had been flying the Corsair's) with the
   box drag law; `EntryPlaneAimAt`'s two Aimer branches (a ground target is
   aimed on the line of sight with the plane's speed added to the round's,
   throttle floor 0.5); the precision tests' closest-approach variants and
   the bomb class's nearest-approach test; the approach and break clearances
   are 100 m, not 50 (AI-56 / AI-69 misread); bombs fire on PIAltFire. The
   pitch law is not the problem: on the Spitfire's own airframe
   `aimAtDirection` settles a 10 deg step in 0.72 s. Live (AI-84): with the
   soldier 260 m down the runway the climb-out passes over him and the plane
   then orbits him inside its turn circle (bank ~60 deg, the soldier 80..110
   deg off the nose) for as long as the Fire behaviour holds him, never
   seeing him; from 800 m out the attack brings the nose within 2 deg of him
   at 121 m before the 75 m aim clearance pulls it off, and the wing guns,
   converging 93 m out while the gate is taken on the centreline, pass 1.6
   to 4.9 m either side of him between 150 and 270 m. A Stuka flying straight
   250 m ahead is shot down in 3 s. Not read, and the one thing that could
   still move the soldier case: whether the engine's Fire behaviour lets go
   of a target it cannot see sooner than the viewer's does (in the orbit
   Fire scores 2.96 against MoveTo's 1.5). Not built and not on this path:
   the break point's construction (0x0859bc90, modes 1 / 2) and the
   air-target throttle regulation in `EntryPlaneMoveToObject` 0x08621d30.
2. ~~The waypoint move's clearance~~ read and built (AI-71): 50 m, the
   point at ground + 75 over the area's own position (`orderAirBot`).
3. ~~The airborne flag~~ read and built (AI-71): cleared only on a change of
   controlled object, so a landed plane keeps it.
4. **Remaining INVENTIONs worth reading next**: ~~`actionStatusDecision`
   states 1..9~~ read, ported and built (AI-85..AI-87, 2026-09-24): the
   whole state machine (0..9; 1 has no writer, 0 -> 6 is unreachable) with
   the search box it reads, checked against the function's machine code in
   the x87 emulator (0 mismatches over 3,155 cases); the tank law's tail is
   full lock with the drive's throttle at or under 2 m/s
   (`turnTowardsDirection` is only `EntryTankTurnTo`'s), the angle negated
   while the hull moves against the drive, the wanted speed damped by the
   roll rate. Live on Bocage a Sherman driven nose-first into a wall backed
   2.2 m turning 61 deg, then turned and drove 38 m to its point. Open: a
   viewer full-lock pivot creeps backward, which flips the steer through the
   negation; a hull whose pad the viewer's map paints blocked (El Alamein's
   nearest Allied Sherman) stays on it. Read since
   (AI-72): the 20 s feedback veto is dead in retail (its writer is gated on
   a `detectAimingFailure` that returns 0), and a target's security is 1 on
   its own side and `1 - SCurve(age / decay)` on the other. ~~The decay
   source~~ read and built (AI-75): the template's `aiTemplate.degeneration`
   (15 for a soldier), the record made at a bot's first frustum contact and
   refreshed by spots, re-sights and heard shots; the enemy tables weigh
   each unit by it. The Fire scoring still uses 1.
5. ~~**Bocage's Tank0 map has no bridge crossing**~~ read and fixed (AI-93,
   AI-94, 2026-09-24). The engine frees whatever pixels an object's faces
   cover (`sampleAndRender` 0x08601390) after the terrain pass and before
   the outlines go in, and outlines a bridge against its AI mesh (a sheet
   over the deck), so only the parapets draw. The viewer painted every deck
   a wall at its ramps and its abutments; the drivable mask now stands in
   for the AI meshes. Checked against the level's own baked map
   (`Pathfinding/Tank0Level0Map.raw`, shipped and loaded by `ai.loadMaps`,
   read by `bf42/ai_level.py read_search_map_raw`): 95.2 % of cells agree
   (60.8 % before), one component. Live: a bot Tiger ordered from the Axis
   base to the Allied base crossed both river branches on the decks and
   arrived with `pathFailures` 0; both bot maps are one coarse component.
   Runner (SAI, 8 a side, 600 s, seeds 1..10): route failures 67,636 a match
   before, 86 after. El Alamein's nearest Allied Sherman (item 4's open
   point) now starts on a free strip through its repair pad; the
   never-valid-hull stopgap stays for the five hull spawns El Alamein's own
   baked map paints blocked. Open: the viewer ships no AI meshes (porting
   them, or loading the baked maps outright, would close the remaining
   differences: the slope test's sub-sampling; on Omaha and Market Garden
   the baked maps block everything outside the play area; and Market
   Garden's `Ironbrdg1` is not in the drivable mask, so its deck is still
   cut).
6. **Boats** (AI-73): a ship's Daihatsu / LCVP is split off at load as its
   own unit; the helm runs `speedControl`'s regulated speed and turn. Live
   on Wake a bot drove a Daihatsu 558 m on `LandingCraft3` to a south-shore
   beach point and beached 23 m past it. ~~`actionStatusDecision` states
   1..9, braking on arrival~~ built (AI-85, AI-87, 2026-09-24): the helm runs
   the box state machine on the water map and the move's arrival brakes at
   full reverse until 1 m/s. Live on Wake, a 20 m radius: the craft braked
   from 20 m out at 15.1 m/s, ran on 33 m past the point afloat, backed off
   under state 8 at up to 6.6 m/s and stopped 11.9 m from the point. Open:
   the viewer's reverse thrust is weak (15 -> 11 m/s over 15 m), so from full
   speed the craft overshoots any radius under about 40 m; pushed onto the
   shelf at rest, state 8 holds full reverse but the hull does not move and
   climbs 5 m (hull physics, not the helm). ~~The SAI's landing-zone
   orders~~ built (AI-96..AI-99, 2026-09-24, Brief D): a craft's helm gets
   `WPBeachLanding` / `WPMoveToBeachLanding` on the zones the level's
   `StrategicAreas.con` attaches (now in `extras.ai`), runs to an approach
   point 10 m in from the seaward side, then straight at the beach once in
   the zone, and everyone aboard gets out there (`BBChangeLandingCraft`:
   in a zone, under 2 m/s, on the infantry map, or tipped). Runner, Wake,
   seed 1, 8 a side, 300 s: a crewed Daihatsu lands on `SouthLanding` at
   143.2 s, four out together, and a rider takes `Landing_Beach` 6.5 s later;
   the other grounds and tips off the west shore (without the orders both
   crews hold inland orders to the end, no landing, no capture). Live: bots take the
   Daihatsus beside their spawns, riders board, a craft enters its zone,
   flips to the beach leg, runs up at 15 m/s and its driver and rider get
   out on the beach. Open: (a) the water map routes craft under Wilkes'
   wooden bridge at (894, -920) and over the 1 m shelf off the north tip
   (819, -1413), where the hull grounds, climbs and tips (the crew bails
   there by the tip rule); (b) a craft that enters its zone side-on turns
   too slowly at the helm's braking speed to face the beach and can drift
   out of the zone; (c) the crew climbs back into the beached craft's MG
   after the 15 s unit ramp and is bailed again at once, a loop every ~8 s
   (the engine's `BBChange` would do the same for a seat, which carries no
   own-map test; for the root that test, 0x0855ee25 -> 0x0855f0f0, is not
   applied because the viewer's water map blocks the Daihatsus' spawn
   cells); (d) the ramp input is not written; (e) the engine's strategic
   route (`validateDistances`) is not read, so a routed landing drives no
   intermediate points.