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
