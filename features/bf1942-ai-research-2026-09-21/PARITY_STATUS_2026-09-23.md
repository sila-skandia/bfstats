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
   negation. ~~A hull whose pad the map paints blocked stays on it~~ settled
   (AI-103, 2026-09-24): a hull never valid gets no box and runs the state
   machine's no-box rows, as `getBox` 0x08612060 does; live, El Alamein's
   Sherman on the blocked (1731, -804) drove off 92 m. Read since
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
   cut). **Loaded outright (AI-102..AI-104, 2026-09-24, Brief M):** every
   level's own maps are extracted (`extract_search_maps.py`, 796 maps on 271
   levels, 66.8 MB, live on mesh.bfstats.io) and the page and the runner
   search them; only the six levels with no `AI.con` paint. A hull's box
   stops at the map's `maxLevel` (2 on `Tank0`), and the coarse layer is each
   cell's free patches (the old any-free-metre cell joined ground across El
   Alamein's cliffs). Runner, SAI, 8 a side, 600 s, seeds 1..10, main
   `cd2d3328` -> after: route failures a match Bocage 7.0 -> 26.0, El Alamein
   116.4 -> 0.0; captures (Axis / Allies) Bocage 2.4 / 2.1 -> 1.4 / 2.0, El
   Alamein 2.7 / 2.4 -> 0.8 / 1.4. ~~Open: the engine's `StrategicMap`
   is shipped beside the maps and not read; the coarse layer is still an
   INVENTION.~~ read and built (AI-117, Brief O): every route is planned on
   the level's own strategic map (item 9). ~~Bocage's remaining failures
   are tanks within 15 m of order points the baked `Tank0` blocks~~ gone
   with it (22 -> 1 a match). ~~The `Car4` and `Amphibius4` maps are
   published but no viewer unit searches them~~ settled (AI-118): a unit's
   map is the search type its `vehicleNumber` names; every vanilla land
   vehicle, jeeps included, names `Tank0`, so no vanilla unit searches
   `Car4`, and XPack2's amphibians name the level's fifth type.
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
   intermediate points. **On the baked maps (Brief M, 2026-09-24):** all
   four Wake Daihatsus' parked cells, (561, -1386), (572, -1374),
   (460, -1358), (473, -1343), are free on the level's own `LandingCraft3`
   (level 2), so the root's own-map test (0x0855ee25 -> 0x0855f0f0) is now
   portable (follow-up, not built here); (a) the baked `LandingCraft3` is
   free under Wilkes' bridge at (894, -920) too (the engine routes a craft
   there as well), and blocks the shelf at (819, -1413) (the nearest free
   cell is 8 m west). Runner, Wake, seed 1, 8 a side, 300 s, main `cd2d3328`
   -> baked: both Daihatsus taken within 0.27 s either way; painted,
   `Daihatsu_1` lands on `SouthLanding` at 143.2 s and a rider takes
   `Landing_Beach` at 149.7 s, `Daihatsu` bails off the west shore at
   217.8 s; baked, `Daihatsu` (bound for `EastLanding`) bails at 119.5 s at
   (1133, -836) on the lagoon's north shelf, a pixel off the free water and
   in no zone, and `Daihatsu_1` reaches the `SouthLanding` approach at 120 s,
   overshoots (open item (b), the weak reverse) and is re-ordered between
   `CentreLanding` and `EastLanding` to the end: no capture (2 before).
   Route failures 17,303 -> 13,736, 13,675 of them on foot at the
   Shokaku's deck (620..660, -1420..-1460): a ship is not on the baked
   infantry map (it was not on the engine's either), so a soldier standing
   on the carrier fails every route; the painted map had the deck.
   **Brief N (2026-09-24, AI-110..AI-114).** ~~(c) the crew climbs back
   in~~ fixed: `BBChange`'s own-map test offers a ship only on a valid cell
   of its water map, so a beached craft is offered to nobody (land roots
   wait on Brief O's per-unit maps). ~~(d) the ramp~~ built: the beach leg
   holds `PIPitch` at 1.0 into the world's word. ~~`isTouchingLand` and the
   tip stand-ins~~ ported: the crew bails in a zone only aground (the Ship's
   terrain latch while a helm drives it, off its own map once the driver
   has bailed), and the tip test has the engine's two forms. ~~(b) side-on
   entry~~ the helm's cause: the engine's throttle channel persists between
   ticks, so `speedControl`'s turn keeps a full astern at or under 3 m/s and
   the hull backs and fills round (the viewer rebuilt the word and always
   drove on); a craft that enters its zone side-on still circles out and back
   under state 9, as the engine's would. ~~(e) the strategic route~~ built
   for the beach orders (`getDistances`, the route points and their popping);
   the approach leg keeps the no-route radius 5 (INVENTION: the engine's
   route radius, 96 m on Wake, is the path's goal tolerance and would stop the
   craft outside its zone, so something between is unread). The levels'
   vehicle groups were never exported (wrong con words); fixed, and every
   XPack1, XPack2 and EoD level now carries its AI block (live). Runner,
   Wake, 8 a side, 300 s, on main `be61dd5d` (with Brief L), the first crew
   out at a beach (within 10 m of a zone), seeds 1..4: 155, 185, 153, 141 s
   (main `da237ffb`: 213, none, 200, 263 s), `Landing_Beach` neutralised 3
   to 11 s later in every seed; boardings of a beached craft within 10 s of
   leaving it: 0 in every seed (10, 0, 14, 20). Seed 1: `Daihatsu_1`
   reaches `SouthLanding` through the `SeaArea1` route point, driver and
   rider out at the zone's east edge at 155.3 s, a rider neutralises
   `Landing_Beach` at 166.5 s, and the Allies' Defgun takes it back at
   222.9 s (seed 4 the same at 292.4 s); no seed has an Axis capture in
   300 s. On the Brief N commits before the rebase onto Brief L the same
   seeds landed at 136, 138, 164 and 163 s. Live (worktree viewer, Wake, 8 bots): a Daihatsu
   taken at the carrier with a rider aboard at 25 s, its `SeaArea1` point
   popped at 119.5 s, the zone entered at 162.9 s with the ramp input at
   1.0, driver and rider out on the beach at (1161, -706) at 173.1 s, nobody
   back in, the driver walking up the beach past the flag. Open: the land
   roots' own-map test (Brief O item 3), the routed `WPMoveTo` for a craft
   whose route has no zone user, the waypoint error flag, and the approach
   radius question above.

7. **What the runner found in the page (Brief K, 2026-09-24).**
   ~~No bot takes a fixed gun~~ fixed (AI-92): a seat's value in the Change
   score is its `aiTemplate.basicTemp` (`Information+0x14`; AA 9, Sherman
   12, Spitfire 15, B17 35), not strategic strength index 0 (0 on every
   gun); a record is found by any of its PCOs (`flak38` is `Flak_38`'s);
   the stationary MGs are units; a secondary seat's whole urgency is scaled
   by `modifyForDriver`'s root-type factor; the reach test is `BBChange`'s
   (12 m free, the unit's own cell beyond, a line 12 m behind a
   no-pathfinding gun). Live and in the runner a bot 30 m from El Alamein's
   AA gun with a Bf 109 in view takes it in 5 s and fires. In matches no
   bot takes one yet: the tanks, planes and B17 near the spawns outbid it.
   ~~Spitfires collide in pairs~~ mostly fixed (AI-95): `runwayClear` (a
   plane is taken only with no mobile hull 0.6..12 spans ahead) and the
   pilot's `BBAvoid` (collision predicted 5 s out, a turn 45 deg away);
   seeds 1..4 keep one same-tick pair, an enemy Spitfire and Bf 109 head-on
   in a mutual attack run, predicted only 1.4 s out. ~~Tanks trade a flag
   every 10 s~~ fixed (AI-100): the control point's own law (the owner's
   player holds, an enemy with him runs it down to neutral, one side alone
   takes it). ~~The redeploy keeps its best distance across orders~~ fixed
   (AI-101): the engine has no such test; the page's is measured per order.
   Brief P (2026-09-24; AI-115, AI-116): ~~(a) the extractor exports only
   `timeToGetControl`~~ fixed: every setting the law reads is exported (the
   lose time is 10 s on 85 of vanilla's 115 placed points), vanilla, XPack1
   and XPack2 re-baked and live; ~~(b) the human's capture runs its own timer~~ fixed: the HUD
   reads the flag's state and the law takes it (live: human + Axis bot on a
   neutral point hold it 20 s; the human alone takes it in 10 s; an Axis bot
   with the human on his point runs it to neutral in 10 s); ~~(c) two tanks
   out of each other's line of fire sit in Fire~~ ported: a tank's fire plan
   closes by `MoveToObjectFinding` while it cannot shoot and the target is
   beyond `minRange + min(50, half the span)` (runner: K's pair 158.7 m
   apart close to 42 m and the PanzerIV fires at 15.9 s; 0 rounds and no
   move before). Still open from (c): inside that 52 m a tank without a
   shot holds at its firing point, whose attack-portal case
   (`getPortalLookAtPosition`) is not ported; and the sense rays aim at a
   soldier's heights on a hull (`bot-sense.js SENSE_HEIGHTS`, INVENTION), so
   live the pair close to 45 m on a slope and never have each other in
   memory (a crest hides the 1.0 m ray; 1.7 m clears). ~~(d) the Mobile
   plug-in's look-ahead is 5 s for soldiers too (both ctors), not the 0
   `bot-route.js` assumes (Brief O)~~ built for the obstacle half (AI-119,
   item 9); the Avoid behaviour's side step is still the touching rule.

8. **The AA gunner's trigger, the correction, the soldier's count law (Brief
   L, 2026-09-24; AI-105..AI-109; features/bot-gunner-aim).** ~~No AA gunner
   ever fires at a plane~~ fixed (AI-109): the trigger's line to the
   target's +1 m ended on the target's own hull, and the sense rays re-cast
   past only 4 of a skipped hull's faces. Live, bot_3 in AA_Allies_1 against
   the human's Spitfire: held 181 m out, 21 rounds in 8 s and 2 flak hits
   (0 before); crossing 150 m out at 55 m/s, 2 rounds as the gun swings on
   and 1 flak hit, then a 22..34 m lag and no more (0 before); head-on 90 m
   up, best miss 14.7 m, 0 rounds (as before). ~~`correctAim`'s writer~~
   found and ported (AI-105): the AI collision handler watches one round at
   a time and the miss is fed back at 0.8; it needs rounds to leave first.
   ~~The sense path for aircraft~~ read (AI-107): nothing special, the same
   banded frustum at the level's view distance; the sweep now goes back to
   the near band when the camera turns past the next band's angle. ~~The
   soldier's count law~~ ported (AI-108): every seeded trace changes from the
   first tick. ~~The yaw window~~ ported (AI-106): 45 of 92 seat
   ControlInfos, not the Defgun alone. Open: (a) whether the retail AA bot
   fires at a crossing plane at all (the game itself); (b) K's take of the
   AA gun (AI-92) did not happen live with a plane held in view from 20 to
   60 m (the bot took a Willy 35 m away, or fired his rifle); (c) the
   soldier's trigger is still the tolerance test, not the precision
   condition, and his correction is not built (the page's soldier round is a
   hit scan); (d) the candidate test's sphere radius (`Frustum::inside`
   0x08532710) is not ported.

9. **The engine's strategic map, the unit's own map, the soldier's look-ahead
   and the capture drop (Brief O, 2026-09-24; AI-117..AI-120).** ~~The
   coarse layer is an INVENTION~~ read and built (AI-117): every level's
   strategic maps (`Pathfinding/<type>.raw`, `<type>Info.raw`, 794 on the
   271 levels with search maps, 41.0 MB) are extracted beside the search
   maps and live on mesh.bfstats.io, and every route is planned on them as
   `initPathfinding` / `updateStrategicPath` / `AStarStrategicSearch` do
   (regions of 64 m cells, Manhattan costs, the same region needing no
   legs); the painted patches stay for the six levels with none. ~~Every
   land vehicle on `Tank*`~~ settled (AI-118): a unit routes on the search
   type its `vehicleNumber` names, which is `Tank0` for every vanilla land
   vehicle, jeeps included; `Car4` is searched by no vanilla unit. ~~The
   soldier's zero look-ahead~~ read and built for the obstacle half
   (AI-119): 5 s like every Mobile plug-in; a still own-side or neutral
   body he will meet becomes potential obstacles, one circle a sub-sphere.
   **The capture drop** (AI-120): AI-104's before predated K's control-point
   law; against K's commit the drop is El Alamein's Axis alone (45 -> 28
   captures over seeds 1..30), and its cause is the Allied Willy, which
   wedged at (1380, -1175) on the painted map in 13 of 30 seeds and now
   takes East outpost at 87 s in 30 of 30, so the Axis PanzerIV that used
   to take East, North and South in turn never gets East. Not a fault of M's.
   Runner, SAI both sides, 8 a side, 600 s, seeds 1..10, on main with
   Briefs L, N and P (`47353211` before, `0c55ab7f` after), Axis / Allies:
   El Alamein captures 1.5 / 2.4 -> 1.7 / 1.9, deaths 6.4 / 9.7 -> 3.2 / 7.7, route failures 0 / 0 -> 1 / 67 (one seed, 634: a tank closing on a target where `Tank0` has no free pixel within 20 m); Bocage captures 2.1 / 2.1 -> 1.4 / 2.2, deaths 10.2 / 10.3 -> 8.2 / 6.9, route failures 37 / 0 -> 6 / 11. Staged on `da237ffb` (M's main), the same runs: the strategic map
   El Alamein captures 0.8 / 1.7 -> 1.1 / 2.2 and Bocage route failures 22 ->
   1; the unit's map no change on these two levels (every land vehicle names
   0 there); the look-ahead El Alamein captures 1.1 / 2.2 -> 2.0 / 1.5 and
   Bocage route failures 1 / 1 -> 8 / 0. The doctrine table is re-run in
   features/bot-doctrines. Live (the worktree's page): Bocage and El Alamein
   route every bot on region points with no failure; a Kubelwagen and a
   Willy drive on `Tank0`. Open: (a) the viewer counts an aircraft in an
   area's presence (`strategic-ai.js _updateAreas`), so an orbiting Spitfire
   holds a pass Neutral; `AIStrategicArea::update` 0x0863d6d0 skips, in its
   outer count, an object whose Information type word has bit 0x10 (INFERRED
   air), not read to the end; (b) a route to a goal the unit's map blocks
   with no free pixel within 20 m still fails (a tank's TakeCover point),
   as the engine's would; (c) a tank wedged against a static keeps failing
   its legs (El Alamein seed 9, a PanzerIV at (528, -1491)); (d) EoD's local
   `pathfinding/index.json` lost its `searchTypes` / `strategic` rows in
   Brief P's re-bake (161 of 238 levels; the live copies are intact); EoD is
   parked, and its next publish must restore them first (`extract_search_maps.py`
   on main writes them).
