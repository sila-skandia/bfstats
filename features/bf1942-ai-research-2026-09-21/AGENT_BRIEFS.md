# Agent briefs for the outstanding bot AI and viewer items (2026-09-23)

One self-contained brief per open item, ready to hand to an agent. Each is
independent unless its "Depends on" line says otherwise. Spawn in the order
listed when in doubt; A, B and C touch `bot.js` and `nav-grid.js` and should
not run at the same time as each other.

## Common rules (paste at the top of every brief)

You are working in /home/dylan/projects/skandia/bfstats, in a git worktree
of main. Commit in small steps with plain messages (no Co-Authored-By
lines), and land each verified step on main with `git fetch && git rebase
origin/main && git push origin HEAD:main`, resolving conflicts yourself.
Follow the repo CLAUDE.md: feature docs under features/, no emojis, run
`./scripts/verify.sh --skip-e2e` by absolute path from the repo root after
code changes and the full `./scripts/verify.sh` before your final report,
never run kubectl without confirming. Tests: `python3 -m unittest discover
-s tests -p "test_*.py"` in tools/bf1942-models (pytest is not installed);
the bot harness pins are tests/bot_ai_harness.mjs and tests/test_bot_ai.py.

Every engine claim you implement must be read from the decompile and cited
by address in the code comment, the ledger
(features/bf1942-engine-reference/ledger.md, next row AI-75+) and
features/bf1942-ai-spec/KNOBS.md; sub-agent summaries have been wrong
before, so read the C yourself and label anything unread INVENTION.
Decompiling: features/bf1942-engine-reference/lnxded/decompile.sh <outdir>
'<name-regex>' ... matches `nm -C` with grep -E (escape parentheses, e.g.
'SAI::update\(float\)'); a zero-match regex aborts the run (rc=1), so test
each with `nm -C /home/dylan/projects/public/bf42plus/bf1942_lnxded.static |
grep -c '<regex>'` first; output is <addr>.c plus index.txt, strip the
`_ZN4dice2bf2ai[0-9]*` prefixes with sed to read; vt.py '<class>' dumps
vtables; Ghidra's x87 float compares decode unreliably, check with objdump,
and when Ghidra loses a function's head use lnxded/x87emu.py (see
lnxded/towards_direction_emu.py for the pattern). Use the session scratchpad
for outputs.

Live checks use the Browser tools: preview_start {name: "model-viewer"},
then load `map.html?mod=bf1942&map=<map>&botCount=8&botSkill=0.75&shots&
noaudio&botDebug&r=<n>` (bump r each reload; refetch changed modules first
with `fetch('/<file>', {cache:'reload'})` from javascript_tool). Two
`__renderOnce(640,360)` calls are one 30 Hz tick; wait ~3 s after the first
120 frames for weapons and vehicles to load. Hooks: `__bots()`,
`__botCtl(id)`, `__botVehicles()`, `__botMount(id, 'Sherman'|'Spitfire'|
'Daihatsu', seat)`, `__botDismount(id)`, `__terrain(x,z)`. Freeze a target
bot with `__botCtl(id).tick = () => {}` after `world.player(id).soldier
.spawn(x, y, z, yaw)`, `setPosition`, `route = null`, `onRespawn()`. The
recipes are in features/bf1942-ai-research-2026-09-21/PARITY_STATUS_2026-09-23.md
and the memory file /home/dylan/.claude/projects/-home-dylan-projects-skandia-bfstats/memory/project_bot_fight_verification.md.
The headless runner tools/bf1942-models/sim (README there; `--why <bot>
<time>`) reproduces a seeded match; use it to check a change does not move
a trace you did not mean to move. Read features/bf1942-ai-spec/README.md
for the layer map before touching any of it, and
features/vehicle-instance-refactor/README.md for the module layout (map.html
is wiring; the vehicle code is vehicle-instance.js, the bot referee
bot-referee.js and bot-units.js, the human local-player.js).

Scope of assets (decided 2026-09-24): the parity target is BF1942 vanilla
plus XPack1 and XPack2. EoD (Eve of Destruction, 238 levels) is parked
until the vanilla issues are fixed: do not extract, re-bake or publish EoD
for a bot-AI change, and do not count it in a level pass. An exporter
change that only adds fields to scene.json is published by rewriting those
files (the patch path, as patch_ai_extras.py does), not by a full level
re-bake; measure which files the change reaches before choosing the tool.

Report at the end with what is verified live, what is still open, and the
commit hashes.

---

## Brief A: a soldier kill from the air

Depends on: nothing. Conflicts with: B (bot.js).

Status: the plane fires and kills a soldier on the runway, and the AI side
is read (sense frustum 3D, AI spread on vehicle guns, 50 m approach / 75 m
aim clearances, the precision trigger). Eight passes on El Alamein: the
approach lines the nose up (miss 5 m at 289 m) and the attack's pull-up
carries the nose away, the lead sitting below the line of sight. The
remaining suspect is the flight model's pitch response, not the AI.

Do:
1. Compare the viewer's aircraft pitch response (`flight.js` `Aircraft`,
   the `PhysicsWing` lift and the elevator authority) with the engine's for
   the Spitfire: read `PhysicsWing`/`Wing::update` and the plane's
   `Objects.con` wing and engine numbers, and measure in the viewer the
   pitch rate per full stick at 40 and 60 m/s against the engine's law
   (`PlaneControl::towardsDirection` 0x08629fa0 expects a response it was
   tuned for; its `pitchLookAhead` 1.2 and `pitchScale` 0.001 in the con
   block tell you what it assumes).
2. Build the two unbuilt pieces named in the status file: the
   closest-approach precision variant for non-burst weapons (bombs;
   `BAPCConBombPrecision3d` in `createMobileLessAttackPlan` 0x085a0080) and
   `EntryPlaneAimAt::execute` 0x0861f610's own direction clamps.
3. Then the recipe: a Spitfire bot against a frozen soldier 260 m down the
   runway must kill from the air (a `[bots] bot_4 hit ... (killed)` line
   while the plane is above 20 m AGL), and a second recipe against a
   Stuka in flight must land hits.

Acceptance: both recipes, a harness pin for the pitch law, KNOBS.md and the
ledger updated, the sim trace on seed 1 unchanged except where the plane's
behaviour changed.

## Brief B: `actionStatusDecision` states 1..9, and a hull that backs off

Depends on: nothing. Conflicts with: A (bot.js), C (nav-grid.js).

Status: `CommonControls::actionStatusDecision` 0x0860fbe0 is a
turn-in-the-box state machine on `BAPAMoveTo` +0x60 (about 700 decompiled
lines); the viewer ports state 0's reverse test only (`driveDecision` in
bot-vehicle.js). A wedged or beached hull, and a landing craft that runs
aground, cannot back off.

Do:
1. Decompile and read the whole function plus `getBox` 0x08612060,
   `getIntersection` and `checkLineAgainstObjects`, and the writers of
   +0x60 in `EntryTankMoveTo::execute` 0x08622e80 and `EntryBoatMoveTo`
   0x08613d60. Use the x87 emulator where Ghidra drops the float compares.
2. Port the state machine as a pure function in bot-vehicle.js with a
   harness pin per state transition, and drive it from `_steerToward` for
   tanks and boats. Include the boat's arrival braking
   (`BoatControl::resetControls`) so a landing craft stops at its point
   instead of beaching 23 m past it.
3. Live: a Sherman driven nose-first into a Bocage wall backs out and
   turns; a Daihatsu on Wake stops within its arrival radius of a beach
   point and, pushed onto the shelf, backs off.

Acceptance: the two live cases, the pins, the ledger and KNOBS rows, the
status file's item 4 and 6 updated.

## Brief C: Bocage's tank map has no bridge crossing

Depends on: nothing. Conflicts with: B (nav-grid.js).

Status: on the viewer-built Tank0 map the north bank, south bank and the
Sawmill are separate components, so after the bridges fall every order
across the river fails (`findStrategicPath` fails every tick, the Tigers
reach 259 path failures). The bridge decks are statics over water; how the
engine's map carries them is not read.

Do:
1. Read how the engine paints a drivable deck over water into a search map
   (`LocalMapInfo::update` 0x08480f50, `MapBuffer::paintBrush` 0x086011b0,
   `CellMap::setBlob`, the `objectClipAndRender` / `sampleAndRender` pair
   the existing nav-grid.js comments cite) and check it against the level's
   own baked bitmap if one is in the archive (`Pathfinding/*.raw` in the
   Bocage level RFA; bf42/rfa.py reads it).
2. Fix `buildNavMap` (nav-grid.js) so a deck above the water line is a
   surface on the tank map, with a unit test on a synthetic bridge over a
   channel.
3. Live on Bocage: after both bridges are held, a bot Tiger ordered across
   the river crosses a bridge (`routeFailed` false, `pathFailures` not
   climbing) and the north and south banks are one component
   (`__navMap()` coarse components).

Acceptance: the test, the live crossing, the ledger row, the status file's
item 5 updated.

## Brief D: the strategic AI sends landing craft to beaches

Depends on: B (arrival braking) for the live check to be clean; can start
the reading now.

Status: a ship's Daihatsu or LCVP is its own unit and a bot drives one on
the LandingCraft3 map, but only when given a point by hand; the SAI's
landing-zone orders (`WPBeachLanding`) are not built, and the headless
runner does not split craft off ships.

Do:
1. Decompile `WPBeachLanding` (ctors 0x085362b0 / 0x08536350, `getUrgency` 0x085363d0, `getGoalPoint` 0x08536450, `insideZone` / `closeToZone` 0x085364c0 / 0x085364d0, over an `AILandingZone`) and where the SAI issues it (`SAI::
   updateDistribution` 0x08632180, `orderNormalBot`, the landing-zone data
   in the level's AI con: `bf42/ai_level.py` parses strategic areas; check
   whether it parses landing zones and add it if not).
2. Build the order in strategic.js and its execution in bot.js (the craft
   drives to the zone, the passengers bail at the beach), and split craft
   off ships in sim/level.mjs the way bot-units.js does on the page.
3. Live on Wake: without any hand-given point, a bot takes a Daihatsu,
   carries at least one passenger bot, lands at a beach zone and the
   passengers walk to a flag.

Acceptance: the live landing, a sim run on Wake showing craft in the
trace, the ledger and KNOBS rows, the status file updated.

Done 2026-09-24 (ledger AI-96..AI-99; features/bf1942-ai-spec/strategic.md
§8). `bf42/ai_level.py` exports the landing zones and the areas' zone data
(10 extracted levels re-patched and published). `viewer/doctrine-landing.js`
has the orders and the bail; `strategic-ai.js _orderBeach` issues them,
`doctrine.js` registers both kinds with their executor, `bot-plans.js`
drives the beach leg and `bot-mount.js` gives the crew `BBChangeLandingCraft`.
The runner already split craft off ships (Brief I, `stage.mjs`). Runner,
Wake, seed 1: a crewed Daihatsu lands on `SouthLanding` and a rider takes
`Landing_Beach` 6.5 s later.
Live: natural boarding and riders, the zone flip and the run up the beach
with driver and rider out, shown with the craft placed at sea off
`SouthLanding` (the natural voyages ground under Wilkes' bridge and on the
north-tip shelf, a water-map and hull matter). Open items are in
PARITY_STATUS_2026-09-23.md item 6.

## Brief E: a target's information security decay

Depends on: nothing. Small.

Status: security is 1 on its own side and `1 - SCurve(age / decay)` on the
other (AI-72); the decay time's source was not traced, so the viewer uses 1.

Do: trace where the decay time comes from (`InformationReal::getSecurity`
0x085e8d00 / `getSecurity(float)` 0x085e8d10 and their template field),
build it into bot-sense.js and bot-strength.js's `EnemyStrengthTables`
input, pin it, and update the spec. Verify with `--why` in the sim that
enemy tables now decay for stale sightings.

## Brief F: the bot gunner's aim, and the hull that rises on boarding

Depends on: nothing. Touches bot.js (`_aimLook`) and vehicle-instance.js.

Status: a bot in the Sherman's hull-gunner seat fires steadily but its aim
oscillates +-2.4 deg about the target, because the count law assumes the
soldier's gains while the Browning's 90 deg/s servo moves about three times
per count what the tower's 20 does. Separately, any hull rises about 0.6 m
on its springs after adoption (60.85 to 61.49 on El Alamein's Sherman).

Do:
1. Read `mouseControlLookAtDirection` 0x08627b90 and
   `EntryMouseTurretAimAt::execute` 0x08619ac0 for how the engine scales
   the mouse counts by the ControlInfo `aimHorizontalSensitivity` /
   `lookHorizontalScale` numbers per seat (the con block per seat carries
   them; extract_vehicle_ai.py may need to export them), and make
   `_aimLook` use the seat's own gains. Pin it: a gunner converges on a
   fixed target within 0.5 deg in under a second in the harness.
2. Find why a hull rises on adoption (compare the parked body's spring rest
   length with the drive's at `adoptDrivenBody`; the parked pose is the
   spawn's, the drive re-solves the suspension) and make boarding leave the
   hull where it stands.
3. Live: the Sherman hull-gunner bot kills a frozen soldier at 40 m; a
   Sherman's y changes by under 0.05 m across a human boarding.
4. Added 2026-09-24 from the flak agent's report: a bot in the AA gun now
   targets the human's plane (AI-78, `258ba377`) but never fires, because
   the turret swings past a 55 m/s target and never settles. Once the
   gains are the seat's own, prove it live: a bot in El Alamein's AA gun
   fires at a Spitfire flying a straight pass 150 m out, and the flak
   bursts on it (the proximity fuse is on main, see
   features/flak-proximity-fuse/README.md). The gunner's lead comes from
   the same aim path; if it still misses, read where the engine leads a
   moving target before inventing one.

## Brief G: a level switch resets the bot side

Depends on: nothing. Small.

Status: the bot vehicle-candidate cache and the nav maps (infantry, tank,
water) are not reset on a level switch, so a second level in one page
session drives bots on the first level's maps.

Do: find every piece of bot-side state that outlives a level in
bot-units.js, bot-referee.js and level-load.js, give it a `reset()` on the
owning module called from the level switch, and add an E2E or unit check
that switching El Alamein to Bocage rebuilds the maps (log lines
`[bots] vehicle nav map` and `water nav map` appear again and
`__navMap().worldSize` changes).

Done 2026-09-23. What outlived a level: the referee's bots, clock, infantry
map, strategic AI, covers and enemy tables (replaced only when the next level
spawned, so the frames of the load ticked the old bots against the new World),
and the units layer's vehicle and water maps, door list and drive kinds (never
reset: the door list read as fresh off the old level's clock until the new
clock passed it). `referee.reset()` and `units.reset()` run from `show()`
through the page's `resetBots`, after the scene has loaded; `spawn` starts
from `referee.reset()`. El Alamein and Bocage are both 2048 m, so their
`worldSize` cannot change; live the vehicle map is null after the switch and
logs again when built, and Wake (2048) to Midway (4096) rebuilds all four
maps at 4096 with both `water nav map` lines. Pinned by
`tests/test_bot_level_switch.py`; the seeded synthetic trace is unchanged.

## Brief H: the last structural work

Depends on: nothing. No behaviour change.

Status: after Parts 1 to 3 of features/vehicle-instance-refactor/README.md
the page is wiring and every piece of state has one owner. Left: the
frame loop is one 420-line function in map.html, `ground.js` (3,169 lines)
holds wheels, tracks and suspension together, and the re-export shims the
splits left (`flight.js`, `collision.js`) still exist.

Do: split `frame()` into named phases (input, simulation, cameras, HUD
feed, draw) each in the module that owns its state; split ground.js into
wheels, tracks and suspension modules with one owner each; remove the
re-export shims by updating their importers. Rules as in the README: no new
behaviour, functions move with their tests, seeded sim traces and node
harness output byte-identical before and after, full verify.sh with E2E.

Done 2026-09-24 (features/vehicle-instance-refactor/README.md, Part 4).
`frame()` is 13 lines over named phases. The input and camera phases are in
`local-player.js` (`frameInput`, `frameCameras`), and `simulate`,
`presentWorld`, `draw` and `paintHud` are in the page. `ground.js` is now
`wheeled-vehicle.js` (the wheels), `suspension.js` (the springs, `Wheel`, the
probe) and `tracked-vehicle.js` (the tracks), with no re-exports.

Nothing in the page, the server or the tests imports `flight.js` or
`collision.js` any more. One importer each is left, in files other agents
owned at the time (`vehicle-hits.js`, `sim/env.mjs`). Change those two import
lines, then delete both shims.

Seeded sim traces and node harness output are byte-identical, and the cadence
check passes with and without `--bots`.

## Brief I: the headless runner loads the real vehicles

Depends on: nothing. Touches sim/ only.

Status: sim/README.md lists what the runner cannot load: real vehicle
physics and guns (a kinematic `SimDrive` and hitscan stand in), aircraft,
ships, fixed guns, parked vehicles as obstacles, ship-deck spawns.

Do: port the page's vehicle path into the runner in this order, each a
commit with a seeded test: VehicleInstance over the placed vehicle nodes
with the real drive classes and `World.setupBodies`; `GunFire` headless
(or its round flight without meshes) so shells splash and MG rounds cast;
aircraft and ships with `botWaterNav`; fixed guns from the seat surveys;
parked hulls as obstacles. Acceptance: El Alamein 8 a side, 600 s, still
under 2 min wall clock; the trace shows planes taking off, tanks capturing
and a fixed gun firing; a vehicle-kill count in the summary.

## Brief J: the strategic interface and the first play

Depends on: I (so plays can be evaluated with real vehicles), but the
interface and the play can be built and tested on the synthetic level
before I lands.

Status: the engine's strategic layer (strategic.js) is the only order
source. The plan agreed on 2026-09-23 is to put an interface in front of
it so alternative doctrines ("plays") can be swapped and compared in the
runner against the engine's SAI as the baseline.

Do:
1. Define `Doctrine`: given a side's bots (id, unit, position, health,
   order state), the areas and flag state, and the enemy tables, return
   each bot's order (`WPMoveTo` / air / beach orders as strategic.js builds
   them) once per strategic pass. Re-express the engine's SAI behind it
   with the seeded sim trace byte-identical.
2. Write the first play, squad follow: bots grouped in fours, one leader
   per squad ordered by the SAI, followers ordered to a point 8 m behind
   and beside the leader (a `WPFollow` with the leader as a moving point),
   regrouping when more than 25 m apart, all four taking the same vehicle
   when one is taken.
3. Run both doctrines on El Alamein and Bocage, 10 seeds each, 600 s, and
   report the metrics side by side (tickets, flags held over time, time to
   first capture, deaths per capture). Add `--doctrine <name>` to the
   runner and a comparison script that prints the table.

Acceptance: the SAI trace unchanged behind the interface, the play runs
without bot errors, the comparison table in a feature doc under
features/bot-doctrines/ with the seeds listed.

Done 2026-09-24 (built on the runner as it is before Brief I; re-run the
comparison once I lands). `viewer/doctrine.js StrategicCommand` is the one
order source the referee holds. The SAI runs behind it as the 'sai'
doctrine (`beginPass` / `sidePass`), and the seeded synthetic, El Alamein
and Bocage traces are byte for byte the same as before. An order kind
registers a per-tick executor with the `enter` / `exit` actuators: that is
where D's `WPBeachLanding` goes (features/bot-doctrines/README.md, "Adding
an order kind"). The squad play is `viewer/doctrine-squad.js`; its follow
and hold orders use the engine's `WPCloseTo` law (read, ledger AI-77; the
retail server never builds one). `run.mjs --doctrine` and `sim/compare.mjs`
give the table in features/bot-doctrines (El Alamein and Bocage, seeds 1..10,
600 s): the play loses on El Alamein (Axis -29.9 tickets against its own
SAI baseline, better in 1 seed of 10) and makes no measurable difference on
Bocage. There were no bot errors in 60 matches, after a latent
`findLocalPath` box bug the follow orders exposed was fixed. Open: the page's
no-progress redeploy keeps its best distance across a new order
(`bot-decision.js`), which redeploys followers keeping pace (54 a match for
the Allied squad side; 2 with the reset, measured on a scratch viewer).

## Brief K: what the headless runner found in the page

Added 2026-09-24 after Brief I. Depends on: F (it owns the B17 adoption
drop and the Sherman's backwards Browning), D (the landing craft's inland
order). Conflicts with: F (bot-aim.js), B and C (bot-route.js,
nav-grid.js). Start it after F and B report.

Status: the runner's first real-vehicle matches (El Alamein, 8 a side,
600 s, seeds 1..4; `tests/test_sim_vehicles.py`) surfaced page bugs none
of the other briefs cover:

1. No bot ever takes a fixed gun. Every vanilla gun's `strategicStrength`
   is 0 at index 0, the value `bot-units.js` scores a seat by, and the
   flak38's AI record is `Flak_38`, so the node `flak38` never matches it.
   Read `AITemplateUnit` / `AISettings` for which index the engine scores
   a seat by (the earlier read gave six battle-strength classes, ledger
   AI-50; the strategic strength per class is `setStrategicStrength`) and
   how it matches an object to its AI template (`AIObjectUnit`
   initialisation, the `aiTemplate` line in Objects.con is the link, not
   the node name). Fix the extractor and the scorer, and pin: a bot within
   50 m of a free AA gun on El Alamein with an enemy plane known takes it.
2. Allied Spitfires collide in pairs: two die on the same tick with no
   round involved, in every seed. Read where the engine spaces aircraft on
   a shared runway (`BBPTakeOff` / the spawner's `holdObject` timing) and
   whether a bot waits for the plane ahead; the viewer's take-off run may
   let two planes start at once. Pin: eight bots, four planes, no two
   planes destroyed on one tick in seeds 1..4.
3. A PanzerIV and a Sherman trade North outpost every 10 s for minutes
   without either killing the other (29 and 34 captures in seeds 1 and 4).
   Two things to check against the engine: the tank's `Fire` urgency versus
   `MoveTo` when an enemy tank is inside the capture radius, and whether the
   main gun's line of fire is blocked by the outpost's own statics (the
   viewer's LOS is from `_eye()`, the aim from `_aimOrigin()`). Report
   which, then fix what the engine does differently.
4. The page's 12 s no-progress redeploy in `bot-decision.js` keeps its best
   distance across a new order, so a bot keeping pace behind a moving
   point never shows progress and is sent to spawn (54 redeploys a match
   for the squad play's Allied side, 2 with the counter reset per order).
   Read the engine's own stuck test (`BotMain` / `AIObjectUnit` no-progress
   handling, if any; the redeploy may be INVENTION) and make the viewer
   match it; if the engine has no such test, keep the viewer's but reset
   it per order and mark it INVENTION in KNOBS.md. Seeded traces change;
   say so in the commit.
5. After 1 to 4 and after C lands, re-run the doctrine comparison
   (`sim/compare.mjs`, El Alamein and Bocage, seeds 1..10, 600 s) and
   replace the table in features/bot-doctrines/README.md.

Not for this brief: the B17 losing 112 HP on adoption and the Sherman's
turret Browning pointing backwards (both handed to F on 2026-09-24), the
landing craft failing an inland order every tick (D), El Alamein's AA
guns unable to hit soldiers on flat ground from their sandbag pits (level
geometry; the engine has the same pits, so first check whether the retail
bot in that gun fires at soldiers at all).

Acceptance: pins for 1 to 4, ledger and KNOBS rows for every engine read,
the doctrine table re-run, PARITY_STATUS_2026-09-23.md's Open list updated.

Done 2026-09-24 (ledger AI-92, AI-95, AI-100, AI-101; PARITY_STATUS item 7).
1: a seat's value is its `aiTemplate.basicTemp` (`Information+0x14`), not a
strategic strength (those are the SAI's); records are found by PCO, the
stationary MGs are units, `modifyForDriver` scales a seat's whole urgency,
and the reach test is `BBChange`'s; `vehicle-ai.json` re-extracted and
published. Pin `takeAA`. 2: `runwayClear` and the pilot's `BBAvoid` /
`BBPAvoidCollision3d`; pins `AirSpacingTests`, `headOn`; seeds 1..4 keep one
same-tick pair (an enemy Spitfire and Bf 109 head-on). 3: neither suspect:
the line between the tanks is blocked from the eye and the gun alike; the
trade was the capture law, now `ControlPoint::handleFrameUpdate`'s; pin
`test_control_point_law.py`. 4: the engine has no such test; the page's is
measured per order; pin `RedeployTests`. 5: the doctrine table re-run after
Brief C (features/bot-doctrines).

## Brief L: the AA gunner's trigger, and the soldier's count law

Added 2026-09-24 after Brief F. Depends on: F (landed: ledger AI-88..AI-91,
features/bot-gunner-aim/README.md). Conflicts with: K (bot-decision.js) if
run at the same time; start after K reports.

Status: F ported the mounted gunner's aim (`mouseControlLookAtDirection`
0x08627b90, the lead from `Aimer::getFiringDirection` 0x08538ad0, the
trigger from `BAPCConPrecision::evaluate` 0x0854b570). A bot in El
Alamein's AA gun now holds a crossing Spitfire without swinging past, but
never fires: the AA gun's ControlInfo scale is 1.0, a fifth of the
Sherman's, so it trails a 55 m/s plane by 15 to 25 m against the trigger's
11.3 m miss limit, and head-on the closest miss was 11.34 m. Two engine
mechanisms were read but not ported or not found:

1. `BAPAAimAt::correctAim` 0x0853a6d0 corrects the aim by 0.8 of each
   observed miss. Where the engine feeds a round's impact back into it was
   not found. Find the writer (search the callers of `correctAim` and the
   projectile's death path for the aim statement; `Aimer` and
   `BAPAAimAtObject` are the classes), port it, and check whether the
   retail AA bot fires at a crossing plane at all: the retail measure is
   the game itself (the user can confirm in game), the viewer's is the same
   two recipes F ran (crossing 150 m out at 55 m/s; head-on 90 m up).
2. The gunner first saw the plane at about 200 m of the level's 300 m
   view distance. Read the sense path for aircraft (`BotMain::sense`
   0x08521cf0 and the view-cone test for objects in the air) and check
   the viewer's against it.
3. Soldiers still use the viewer's old count law; the engine runs them
   through the same law F ported. Port it for soldiers with the soldier's
   ControlInfo scale, pin it in the harness, and say in the commit that
   every seeded trace changes. Also port the yaw-limit part of the count
   law (only the Defgun is affected).

Acceptance: the two AA recipes with numbers and rounds fired, the pins,
ledger and KNOBS rows for every read, PARITY_STATUS_2026-09-23.md updated.

Done 2026-09-24 (ledger AI-105..AI-109; PARITY_STATUS item 8;
features/bot-gunner-aim, "Brief L"). 1: the writer is the AI collision
handler (`event_firing` 0x0852cd90, `updateBotProjectiles` 0x084650e0,
`planExecution` 0x085202c0, `event_shotMissed` 0x08526a90); ported for
mounted gunners. The AA gunner had never fired for another reason: the
trigger's line to a plane ended on the plane (AI-109). Crossing: 2 rounds, 1
flak hit, then no more; head-on: 0 rounds, best miss 14.7 m; held still:
21 rounds in 8 s. 2: an aircraft is sensed like anything else; the sweep's
turn reset is ported. 3: ported, every seeded trace changes; the yaw window
too (45 seats, not the Defgun alone). Pins `BriefLTests`.

## Brief M: load the level's own search maps

Added 2026-09-24 after Brief C. Depends on: C (landed: ledger AI-93, AI-94,
`bf42/ai_level.py read_search_map_raw`). Conflicts with: nothing running;
K does not touch the nav modules. Can start now.

Status: C read that every level ships its baked search maps
(`Pathfinding/<Kind>Level<N>Map.raw`) and the retail server loads those
with `ai.loadMaps` (`CellMap::loadRawFile` 0x085f86a0, `getPixel`
0x085f9a00; a negative block record is followed inline by the block's 512
bytes) instead of painting. The viewer and the runner still paint their
own from the terrain and the collision meshes, which agrees with the baked
Bocage tank map 95.2 % of the time and less elsewhere (Omaha and Market
Garden block everything outside the play area; the viewer's do not;
Market Garden's `Ironbrdg1` deck is cut because the drivable list matches
"bridge" and not "brdg"). Parity for the map is the baked map.

Do:
1. Extract every level's search maps for every mod (vanilla, XPack1,
   XPack2, EoD; `extract_map.py` is the level extractor, the maps tree is
   `viewer/maps/<level>/`) into a compact published form (the raw blocks
   are fine; say what you chose and the size per level), publish with
   scripts/publish-mesh-delta.py, and confirm the live sizes. Asset
   publishing needs no confirmation.
2. `buildNavMap` and the runner load the level's baked map for each kind
   the level ships (infantry, Tank0, Boat2, LandingCraft3, and every other
   kind the level has), and paint only when a level has none (say which
   levels those are). Keep the painted path and its tests; add a test that
   a baked map loads, that its coarse components match C's numbers on
   Bocage, and that the runner's Bocage trace with the baked map still has
   under 100 route failures a match.
3. Fix `decode_pathfinding_raw.py` for inline blocks and correct
   `pathfinding-raw-format.md`.
4. Read what the engine's box test does for a hull that has no valid
   position (C left this unread), and whether the baked map's blocked
   spawns (El Alamein's Shermans at (1731, -804) and (888, -1822), three
   Willys) are handled by that or by the stopgap C kept in `bot-route.js`;
   replace the stopgap with the engine's rule if there is one.

Acceptance: the maps live for every level, the loader in both the page and
the runner, the tests, seeded Bocage and El Alamein runner traces before
and after with the route-failure and capture counts, ledger and KNOBS
rows, PARITY_STATUS_2026-09-23.md updated.

## Brief N: the landing craft's ramp, route and crew, and the expansion packs' AI data

Added 2026-09-24 after Brief D. Depends on: D (landed: ledger AI-96..AI-99,
`viewer/doctrine-landing.js`, `bot-mount.js` crew rule), M for items 1
and 2 (the baked water maps decide whether the grounding and the blocked
spawn cells remain). Start after M reports.

Status: D built `WPBeachLanding` / `WPMoveToBeachLanding` and
`BBChangeLandingCraft`; the runner lands a Daihatsu on Wake unaided and a
rider captures a flag. Left:

1. The engine only offers a craft's helm as a candidate when the craft
   sits on its own map (read by D, reverted because the painted water map
   blocked the Daihatsus' spawn cells). With M's baked maps, port it and
   pin it: after a beaching the crew do not climb back in every 8 s.
2. A craft entering its zone side-on drifts back out at braking speed and
   never turns to the beach. Read `BBPGotoWaypointBoat::createPlan`
   0x085b8c50 again for the in-zone leg's throttle and the helm's turn at
   low speed, and the boat brake's floor; the viewer's weak reverse
   thrust (B's report) is suspect too.
3. The ramp input (`PIPitch` held on the beach leg) and the engine's own
   "touching land" and tip tests, which D stood in for (labelled
   INVENTION): read the tests in `BBChangeLandingCraft` 0x085602b0 and
   port them.
4. The engine's strategic route for a routed order (no in-between points,
   arrival radius 5), which D did not build.
5. XPack1 and XPack2 levels had no AI data extracted at all; D patched the
   five with landing zones. Extract the AI data (strategic areas, landing
   zones, search maps if M has not) for every expansion-pack level and
   for EoD, publish, and confirm the live sizes. Asset publishing needs no
   confirmation and is not done until every level is live.

Acceptance: pins for 1 to 3, the Wake runner events with numbers, the live
sizes for every patched level, ledger and KNOBS rows,
PARITY_STATUS_2026-09-23.md updated.

Done 2026-09-24 (ledger AI-110..AI-114; PARITY_STATUS item 6). 1: the
own-map test for ships (land roots wait on Brief O item 3). 2: the helm's
throttle channel persists (`steerBoat`, bot.js sends a driven ship there;
`bot-route.js steerToward`'s ship branch is now unused and can go with
Brief O's next change there). 3: touching land, the two tip forms, the ramp.
4: the route, its points and popping for the beach orders; the approach
radius stays 5 (INVENTION, the engine's would stall the craft). 5: the
vehicle groups exporter fix; every level with an `AI.con` in every tree
re-patched and live. Wake seeds 1..4, the first crew out at a beach 155 /
185 / 153 / 141 s (before 213 / none / 200 / 263), `Landing_Beach`
neutralised in every seed, no re-boarding loop.

## Brief O: the engine's strategic map, and the capture drop after the baked maps

Added 2026-09-24 after Briefs K and M. Depends on: M (landed: ledger
AI-102..AI-104, `viewer/nav-baked.js`, the coarse route layer rebuilt as
each cell's connected free patches, labelled INVENTION). Conflicts with:
nothing running; N owns the landing modules, L owns bot-aim.js, P owns
capture.js and the fire plan. Can start now.

Status: the engine ships a strategic map beside the search maps
(`StrategicMap::load` 0x08609b60) and the viewer's coarse 16 m route layer
is an invention standing in for it. After M's baked maps and the new
coarse layer, captures fell on both maps (SAI, 8 a side, 600 s, seeds
1..10: El Alamein 2.7 / 2.4 to 0.8 / 1.4 a side, Bocage 2.4 / 2.1 to
1.4 / 2.0) and nobody has looked at why. K also read that the Mobile ctors
give soldiers the same 5 s collision look-ahead as vehicles, not the 0
`bot-route.js` assumes.

Do:
1. Read `StrategicMap::load` 0x08609b60 and its readers (the SAI's route
   between strategic areas, `AIStrategicArea` neighbours, and whatever the
   pathfinder's top level asks of it), extract the strategic map for every
   level that ships one, publish it, and replace the invented coarse layer
   with it. Keep the painted coarse layer only for levels without one.
2. Find why captures fell. Diff a seed's trace before and after M
   (`--why` on the first bot whose order or route differs); the suspects
   are the top level of the box (`maxLevel` 2, AI-104), order points the
   baked map blocks (Bocage's (753..761, -936)), and the coarse layer.
   Report the cause with numbers, and fix it if it is the viewer's.
3. Give each unit kind the map the engine gives it: Car4 for cars and
   jeeps, Amphibius4 for amphibious hulls, from the unit's `aiTemplate`
   search-map line (read where the engine binds a unit to its map,
   `AITemplateUnit` / `ai.addSearchMap` name lookup), instead of every
   land vehicle on Tank0.
4. Soldiers' 5 s look-ahead in `bot-route.js`, with a pin.
5. Re-run the doctrine table (`sim/compare.mjs`, El Alamein and Bocage,
   seeds 1..10, 600 s) on the result and replace it in
   features/bot-doctrines/README.md.

Acceptance: the strategic map live for every level, the runner numbers
before and after for both levels, the capture-drop cause, pins for 3 and
4, ledger and KNOBS rows, PARITY_STATUS_2026-09-23.md updated.

## Brief P: control point lose time, the human's capture, and the fire plan's approach

Added 2026-09-24 after Brief K. Depends on: K (landed: ledger AI-100, the
engine's `ControlPoint::handleFrameUpdate` law for bots). Conflicts with:
N (bot-plans.js); start after N reports.

Do:
1. The level exporter carries only `timeToGetControl`, so vanilla's 10 s
   lose time reads as the default 5 s. Export `timeToLoseControl` (and any
   other ControlPoint template field the engine's law reads: check the
   template defaults at 0x082846d0 against the exporter), then re-bake
   every level in every tree (vanilla, XPack1, XPack2, EoD) and publish
   with scripts/publish-mesh-delta.py. Per CLAUDE.md an exporter fix is
   not done until every tree is re-baked and live; budget ~5 min vanilla,
   ~15 min per expansion pack, ~1.5 h EoD. Confirm the live sizes.
2. The human's capture in `capture.js` still runs the old per-player
   timer; put the human through the same control-point law as the bots so
   one flag has one state. Check live: the human and a bot of the other
   side on one flag freeze it; the human alone takes it in the level's
   time; a bot standing with the owner runs it to neutral in the lose
   time.
3. The engine's fire plan moves toward a target it cannot fire on
   (`MoveToObjectFinding` at 0x085a9e6b in `BBPFire3d` /
   `BBPFireLargeBore::createPlan`; K read it in part). Read it in full and
   port it: a Sherman and a PanzerIV 158 m apart with a blocked line of
   fire close until one can fire, instead of sitting in Fire. Runner pin
   on the North outpost pair from K's report, and live on El Alamein.

Acceptance: every tree re-baked and live, the three live checks, the
runner pin, ledger and KNOBS rows, PARITY_STATUS_2026-09-23.md updated.

Done 2026-09-24 (ledger AI-115, AI-116; PARITY_STATUS item 7). 1: every
setting the law reads is exported (setters ConsoleClass635..650, `makeScript`
0x08284930), null where the level keeps the ctor's; a full extraction of any
level with `AI.con` had been dying on `info.statics` and is fixed; vanilla,
XPack1 and XPack2 re-baked and live (EoD re-baked locally, parked, not
published). 2: `capture.js` reads the flag's state and the law
takes it; the three live checks pass (20 s frozen, taken at 10.5 s, run to
neutral at 10.5 s). 3: the tank branch of `createPlanInternal` ported
(`MoveToObjectFinding` beyond mid while S fails); runner pin
`test_the_tank_pair_close_until_one_can_fire`. Open: the firing point's
attack-portal case, and the sense rays' soldier heights on a hull (live the
pair close 158 -> 45 m and hold without a shot).

## Brief Q: a carrier's deck aircraft is a unit of its own

Added 2026-09-24 from the user's in-game report: "planes are spawning on
carriers now, but when flying the plane it flies the entire carrier".
Depends on: nothing. Conflicts with: O (nav modules, bot-route.js,
bot-units.js item 3 map binding); keep to the files below. Can start now.

Status, traced in the code: Midway's bake nests each deck aircraft under
its carrier's node (`Corsair` and `SBD` under `EnterpriseComplex`, `Zero`
and `AichiVal` under `ShokakuComplex`; each is a `PlayerControlObject`
with `physics.mass` 2500..3000 and `vehicleCategory` `VCAir`), the same
way it nests the landing craft. `detachSpawnedCraft` (viewer/seats.js,
commit 870e6b5c) moves only the `VCSea` nested craft out to the level's
`spawners` group and says in its comment that deck aircraft stay put. So
`findAllVehicleRoots` (viewer/entry-points.js) never lists the plane as a
root (it has an ancestor PCO, the ship), `surveyVehicle` (viewer/
seat-survey.js) buckets the plane's PCO as a seat named `Corsair` of the
ship, its `EntryPoint` opens into that seat, and taking it enters the
carrier's `VehicleInstance`; the drive that gets built moves the carrier's
node, so the whole ship flies.

Do:
1. Read how the engine treats a ship's spawned aircraft: the ship
   template's `ObjectSpawner` children in Objects.rfa (as for the craft),
   `ObjectSpawner` spawning the object as an object of its own with a world
   pose, and how a parked plane then rides the moving deck (contact with a
   drivable deck face: the `ParkedVehicle` / ground response against a
   moving object; `body-statics.js` already has "riding a drivable
   object's face"). Cite by address.
2. Detach nested `VCAir` hulls with mass the way the craft are, world pose
   kept, before the scene is indexed (`level-load.js` calls
   `detachSpawnedCraft` once; the runner's `sim/stage.mjs` or `level.mjs`
   must do the same, check where it loads the scene). A plane parked on a
   deck that then moves (a bot or the human drives the carrier) must
   follow the deck: port the engine's contact if it is readable in a
   session, else carry the parked hull through the host's matrix delta as
   `rebaseDeckSpawns` does for spawn points and label it INVENTION. K's
   `runwayClear` (12 spans ahead) and the take-off run must still work on
   a carrier deck; a plane taken at rest keeps its parked height (F).
3. Pins: test_seats.py (a nested VCAir PCO with mass is detached, a seat
   PCO is not), and the runner on Midway seed 1: a plane takes off from
   each carrier and the carrier's position is unchanged by it.
4. Live on Midway (8 bots): the human takes the Corsair on the Enterprise
   and takes off; the Enterprise's position does not change; a bot takes
   a Zero on the Shokaku and takes off; with a bot driving the Enterprise
   200 m, a parked Corsair stays on the deck within 0.5 m of its pad.

Files: viewer/seats.js, viewer/entry-points.js, viewer/seat-survey.js,
viewer/hull-bodies.js, viewer/body-statics.js, viewer/level-load.js,
sim/stage.mjs or sim/level.mjs (one hunk, rebase often: Brief O edits
sim/level.mjs), viewer/bot-units.js only if the candidate list needs the
detached plane (rebase often: Brief O edits it), tests, the ledger, KNOBS,
the spec's vehicles page, PARITY_STATUS_2026-09-23.md.

Acceptance: the pins, the four live results with numbers, ledger and KNOBS
rows for every engine read, no change to the seeded El Alamein trace.

## Brief R: the tank that sees, scores and fires like the engine's

Added 2026-09-24 after Briefs K, O and P. Depends on: P (landed: the fire
plan's approach, AI-116), O (landed: the strategic map, AI-117..AI-120).
Conflicts with: Q (seats.js, hull-bodies.js, body-statics.js); keep to the
files below. Can start now.

Status: P's live check on El Alamein has a Sherman and a PanzerIV close
from 158 m to 45 m and then sit for 40 s with no shot. Two causes P found:
the Sherman sits 11 deg below the PanzerIV's 5 deg gun depression, and
neither ever gets the other into memory because the viewer's sensing rays
aim at soldier heights above the hull origin (an INVENTION in
`bot-sense.js`) and a crest 10 m ahead blocks them where a ray at 1.7 m
clears. K noted that `AIbehaviours.con` gives tanks the infantry fire
urgency (`BBFireInfantery`) while the viewer scores a tank's targets with
the large-bore rule. O found that an orbiting aircraft holds an area
Neutral in the viewer, that a tank's fire approach can aim at a spot its
map blocks (El Alamein seed 10, 67 route failures), and that a tank wedged
against a static keeps failing its route legs (seed 9).

Do:
1. Sensing from a vehicle. Read where the engine takes a mounted bot's
   view position and line-of-sight origin (`BotMain::sense` 0x08521cf0's
   caller chain, the seat's camera or the object's `getViewPosition`, and
   the line test's target point on a vehicle: the target's position plus
   what offset). Replace the soldier-height stand-in for mounted bots and
   pin it: the tank pair at 45 m on El Alamein each hold the other in
   memory as seen.
2. Fire urgency for tanks. Read `AIbehaviours.con` (which behaviour each
   unit kind gets) and `BBFireInfantery::calculateUrgency`; give tanks
   what the engine gives them and correct any earlier ledger row
   (AI-52..AI-58 area, `BBFireLargeBore`) that assumed otherwise.
3. Aim outside the gun's limits. In P's plan the engine goes to a firing
   point when it cannot aim; read what that point is for a target below the
   depression limit (`createPlanInternal` 0x085a74e0 branches P cited, the
   attack-portal case P did not port) and port it; the pair must end up
   with one of them firing. Live measure: the same pair, rounds fired and
   the time of the first.
4. Blocked and wedged. Read what the engine does when the fire approach's
   goal is a blocked pixel (the closest valid position search P and O
   referred to; `getValidPosition` at 0x085d54b0.. from C's read) and what
   its obstruction counters do for a hull that cannot move (B's report:
   the stuck handling is the obstruction counters, unread). Port both; the
   El Alamein seed 9 and 10 route failures fall to single digits.
5. Aircraft and areas. Read `AIStrategicArea::update` 0x0863d6d0 in full;
   if air units do not count in an area's hold, port it in
   `strategic-ai.js` / `strategic-layer.js` (an orbiting Spitfire no longer
   keeps a point Neutral). Pin it.

Files: viewer/bot-sense.js, viewer/bot-perception.js, viewer/bot-fire.js,
viewer/bot-plans.js, viewer/bot-decision.js, viewer/bot-route.js (item 4
only; O has landed), viewer/strategic-ai.js, viewer/strategic-layer.js,
tests, the ledger, KNOBS, the spec's sensing, behaviours and strategic
pages, PARITY_STATUS_2026-09-23.md. Do not touch viewer/seats.js,
viewer/entry-points.js, viewer/seat-survey.js, viewer/hull-bodies.js,
viewer/body-statics.js or viewer/level-load.js (Brief Q).

Acceptance: the live tank pair firing with numbers, pins for 1 to 5, the
El Alamein and Bocage runner numbers before and after (SAI, 8 a side,
600 s, seeds 1..10), ledger and KNOBS rows, the status file updated.

## Brief S: the level bake in layers

Added 2026-09-24 at the user's request: "I'm surprised we can't layer the
pieces so that only the layer that is affected needs changing." Depends
on: nothing. Conflicts with: nothing running (Q and R are in the viewer's
bot and vehicle modules; keep out of viewer/ except one read-side hook if
a layer's consumer must change). Can start now.

Status: `extract_map.py` writes `scene.glb` and `scene.json` in one run
(7 min vanilla, 3 + 14 min the packs, 1.5 h EoD). `scene.json` mixes con-
parsed data (`controlPoints`, `soldierSpawns`, `vehicleSoldierSpawns`,
`objectSpawns`, `tickets`, `modes`, `gameTypes`, `ai`, `damage`, `sounds`,
fog, sun, water level) with glb-derived data (`objects`, `terrain`,
`minimap`, `envmap`, `lensFlare`). Only the `ai` block has a patch path
(`patch_ai_extras.py`). Today a five-field control point change (Brief P)
was delivered by a full re-bake of every tree, and the publisher
(`scripts/publish-mesh-delta.py`) compares by size, so 2.17 GB of glbs
went up for a few numbers per level.

Do:
1. Split `scene.json` into named layers in the extractor, each a pure
   function of the level's con/archive files with no glb dependency:
   `controlPoints`, `spawns` (soldier, vehicle soldier, object), `game`
   (tickets, modes, gameTypes, gameplayMode), `ai`, `damage`, `sounds`,
   `environment` (fog, sun, water level, draw distance). Keep the glb-
   derived keys in a `scene` layer that only the full bake writes.
2. One tool, `patch_scene.py --layer <name>... [--mod M] [--levels ...|
   --all]`, that re-parses the named layers and rewrites only those keys
   in each level's `scene.json` (and `_shared/damage.json` for `damage`),
   preserving every other key byte for byte. Fold `patch_ai_extras.py` and
   `extract_map.py --damage-only` (if it exists; the flak brief used it)
   into it, keeping their names as aliases or removing them with the docs
   updated. The full bake must produce the same layer output as the patch
   (a test that runs both on one level and diffs the keys).
3. Make the glb bake deterministic: two runs on one level give a byte-
   identical `scene.glb` (find and pin the sources of difference, e.g.
   timestamps, dict order, temp names). Then the publisher can compare by
   content hash as well as size, and an unchanged glb is never sent.
   Add `--hash` to the publisher's compare, or a manifest of hashes it
   reads, whichever is smaller.
4. Docs: a layer map in tools/bf1942-models/README.md (or the extraction
   README the repo already has): for each kind of change, the files it
   reaches, the command, and the time. Replace the CLAUDE.md sentence "A
   fix to the exporter is not done until every tree it touches is
   re-baked and live" with one that says the same for *the layers the
   fix touches*, naming the tool. EoD stays parked: do not run anything
   against EoD; the layer tool must accept `--mod EoD` but the brief's
   verification uses vanilla and the packs only.
5. Prove it: run `patch_scene.py --layer controlPoints --mod bf1942 --all`
   against the live tree and show it changes nothing (P's bake already
   carries the fields); then a synthetic change to one level's control
   point in a scratch copy of the con files shows only that level's
   `scene.json` differs and the publisher's dry run lists only that file.

Files: tools/bf1942-models/extract_map.py, bf42/*.py, a new
patch_scene.py, patch_ai_extras.py, extract_maps_all.py, scripts/publish-
mesh-delta.py, tests, the extraction README, CLAUDE.md (that one
sentence). Do not write into the shared viewer/maps tree except through
the patch tool in item 5, and run item 5's no-op patch only after
checking `ps` for other extractors.

Acceptance: the layer tests, the determinism pin, item 5's two runs with
their output, the docs and the CLAUDE.md sentence, and a timing table
(full bake vs each layer) for vanilla.
