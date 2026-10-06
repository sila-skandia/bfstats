# Bots on Desert Combat

Kind: fix. Package `bots` of the Desert Combat parity round
(`features/desert-combat-parity`), built 2026-10-06 from the census reports'
levels items 28 and 29, ground WP G6 and air item 25.

## 1. Every hull reaches its own AI template

**What was wrong.** `extract_vehicle_ai.py` keyed records by folder
(`Objects/Vehicles/<class>/<name>`), and the page finds a node's record by the
node's template name, a record's key first and then any record's seat
(`bot-units.js aiOf`). Three shapes fell through:

- a variant whose folder ships no `AI/Objects.con` and names another's
  template: DC's `A10_B` and `A10_C` (`aiTemplate A10`, 15 spawns on 8
  levels), vanilla's `Ho-Ha` (`aiTemplate Hanomag`, 5 Pacific levels), DC's
  `Mortar` (under `handweapons/`);
- several hulls in one folder: DC's `AV8` folder (AV-8A/B/C/H/M) and `SA-342`
  (S/G/H/L/M), DC Final's `H-6` (AH-6, OH-6, MH-6, MD-500, MH-500). Every hull
  after the first read the first one's Mobile, Physical and Unit words;
- a variant inside a folder whose template differs from the folder's root:
  the static `Fletcher2` (`FletcherStaticAI`, no Mobile plug-in) read the
  sailing Fletcher's `maxSpeed 15` on vanilla Omaha, Midway and Guadalcanal.

The engine looks the template up by the object's own name and nothing else
(AI-137, read 2026-10-06): an empty `aiTemplate` makes no AI object, an
unknown name is tried as a weapon template and otherwise makes none.

**What retail has no AI for, and stays without.** DC 0.7 comments out the
`aiTemplate` lines of the whole H-6 family and of the UH-60L and UH-60Q, and
its `Mirage` names a template (`Mirage`) that no AI file declares. The census
read the H-6 record's empty seat list as a bug; it is DC 0.7's data. DC
Final restores the H-6 family's lines, so there they are units.

**What changed.** After the folder records, `extract_vehicle_ai.py` gives
each root object (a PlayerControlObject no template adds) that the folder
records miss a record of its own, keyed by its template's name and built
from its own template wherever that is declared (`unanswered_roots`,
`object_record`). A root a record lists as a seat and whose own template is
a seat's (`aiTemplate.secondary`) keeps that record: these are passenger
templates no hull adds any more (DC's `UH-60_Passenger`). The folder records
are byte for byte what they were; the page needed no change, because a
record's key beats a seat listing in `aiOf`.

| tree | records before | after | added |
|---|---|---|---|
| vanilla | 45 | 48 | Ho-Ha, Fletcher2, FletcherStatic |
| XPack1 | 53 | 56 | the same three |
| XPack2 | 69 | 72 | the same three |
| Desert Combat | 98 | 112 | A10_B, A10_C, AV-8B/C/H/M, SA-342G/H/L/M, Mortar, Ho-Ha, Fletcher2, FletcherStatic |
| DC Final | 115 | 134 | the DC fourteen, M6-Linebacker, OH-6, MH-6, MD-500, MH-500 |

The counts are `--mod` runs of the extractor with levels (the published
vanilla table is one record short of either: it predates Caen's `Pak40`).

**How it was checked.** `tests/test_extract_vehicle_ai.py`
`ObjectAiTemplateTests` (a synthetic chain: a variant with no AI folder, two
hulls in a folder, an orphan passenger, a `rem`med line, an unknown name) and
the install tests `test_every_dc_hull_reaches_its_own_ai_template`,
`test_dc_final_gives_each_little_bird_its_own`,
`VanillaObjectAiTests`; `tests/bot_units_ai_of_harness.mjs` (a hull's own
record beats a folder record that lists it as a seat). Runner, DC Desert
Shield, `--seat bot_0=A10_B`: refused before ("no free A10_B"), seated after
and flown for the whole 20 s.

**Publishing.** The lead runs, from `tools/bf1942-models/`:

```sh
python3 extract_vehicle_ai.py --mod bf1942
python3 extract_vehicle_ai.py --mod XPack1 --out viewer/maps/mods/xpack1/_shared/vehicle-ai.json
python3 extract_vehicle_ai.py --mod XPack2 --out viewer/maps/mods/xpack2/_shared/vehicle-ai.json
python3 extract_vehicle_ai.py --mod DesertCombat --out viewer/maps/mods/desertcombat/_shared/vehicle-ai.json
python3 extract_vehicle_ai.py --mod DC_Final --out viewer/maps/mods/dc_final/_shared/vehicle-ai.json
```

then publishes the five `_shared/vehicle-ai.json` files. No scene re-bake.

**Vanilla, before and after** (runner, 6 a side, 300 s, seed 1). Wake and
Omaha Beach play byte for byte the same: Wake's Ho-Ha spawns in CTF only, and
Omaha's static Fletcher offers no seat a bot takes. On Guadalcanal (the
Ho-Ha in every mode, the static Fletcher in Conquest) the Ho-Ha joins the
units (46 to 47) and the static Fletcher's helm loses the sailing one's
`maxSpeed 15`; the match diverges (mounts 9 to 10).

## 2. Bots frozen in Change

**What was wrong.** Up to a third of a side stood in Change all round, on DC
and vanilla levels alike: four of six Iraqis on Basrah's Edge (all chasing
one Lada, one from 1.97 m), three on Desert Shield, five on Kharkov Day 2,
three each on vanilla Battleaxe and Kharkov. The census table's vanilla
numbers were taken with the regressed vanilla `loadouts.json` (22 of 28 AI
weapons lost, 10-03); with a fixed one (`loadouts_fixed.py`) main's viewer
freezes the same bots on Battleaxe (3) and Kharkov (5): the freeze does not
depend on the weapons, as nothing in it fires.

The page walked every bot to the door, or a point beside it, and seated it
only inside the door's radius. A bot pressed against the hull, against the
sandbags round an MG, or against a parked jeep never got there; the walk on
Basrah's Edge went to a pixel the strategic map has no path to (section 3)
and failed every tick from the spawn (51,793 route failures).

**What the engine does** (read 2026-10-06, AI-138, AI-140, AI-141). The on-foot
Change plan walks only from beyond 12.5 m, and then toward the unit itself
(the object finding, radius 6.25, AI-126's goal law); inside 12.5 m it does
not walk at all. Beside the walk it presses Use once the seat lies within
12.375 m, and the server seats a bot whose seat's own object is within 15 m
(`validateBFEntryPoint`), never asking where the door is. A
`setUseNoPathfindingToGetToObject` unit (the fixed guns) is walked to from
behind and pressed for only from behind it. A failed path ends the move and
the plan, and the plan is built again while the same target stays free: the
engine has no give-up timer (AI-140), and a walk-less plan made between
12.375 and 12.5 m waits for ever, which the viewer keeps.

**What changed.** `bot-mount.js planChange` builds the engine's plan: no walk
inside 12.5 m, the walk to `approachGoal` (the unit, or the first free point
toward the bot within 6.25 m) beyond it, the behind walk for a no-pathfinding
unit; the old door walk only where the finding has no goal (the engine's
`getNearStrategicPosition` fallback, not ported). `EnterVehicle` runs beside
the walk (it waited for it) and asks for the seat within 12.375 m of the
seat's own position (`seatPos`, new on every candidate). The door-side walk
of features/bot-stalemates (`doorApproach`, INVENTION) is gone: the press
from 12 m reaches every seat it was there to reach.

**How it was checked.** `tests/test_bot_ai.py`
`test_the_change_plan_is_the_engines` (no walk at 8 m; a walk to the unit
from 30 m, not after-move; presses at 12.3 and 2 m, none at 12.6 and 30; the
gun walked to from 12 m behind and pressed for only from behind). The bot,
route, stance, doctrine, landing, fire-approach, nav, strategic, sim match,
sim tickets, sim vehicles and vehicle-team suites pass (194 tests). Runner,
6 a side, 300 s, seed 1; before is main's viewer with the live DC tree and,
for vanilla, the fixed loadouts; after is this branch with the new AI table
(section 1) and the same loadouts:

| level | frozen | route failures | mounts | kills | captures | vehicle rounds |
|---|---|---|---|---|---|---|
| DC Basrah's Edge | 4 -> 1 | 51,793 -> 11,858 | 9 -> 13 | 0 -> 0 | 1 -> 0 | 0 -> 11 |
| DC Desert Shield | 3 -> 1 | 10,742 -> 21,550 | 18 -> 22 | 0 -> 1 | 1 -> 1 | 9 -> 155 |
| DC Kharkov Day 2 | 5 -> 3 | 180 -> 1 | 9 -> 9 | 0 -> 0 | 3 -> 2 | 0 -> 1 |
| DC Battleaxe | 3 -> 0 | 201 -> 4 | 10 -> 26 | 1 -> 9 | 0 -> 0 | 652 -> 3,077 |
| vanilla Battleaxe | 3 -> 0 | 199 -> 2 | 12 -> 15 | 1 -> 0 | 0 -> 0 | 564 -> 4,700 |
| vanilla Kharkov | 3 -> 0 | 4 -> 4 | 9 -> 39 | 0 -> 11 | 3 -> 4 | 132 -> 802 |
| vanilla El Alamein | 0 -> 0 | 0 -> 0 | 15 -> 32 | 0 -> 3 | 3 -> 3 | 33 -> 91 |
| vanilla Bocage | 0 -> 0 | 7 -> 0 | 34 -> 28 | 6 -> 5 | 3 -> 1 | 192 -> 213 |

"Frozen" is a bot in Change for 80 % of the match that never mounted.

The after column is this branch with section 4 as well. Desert Shield's
route failures are now drivers': more bots drive, and four of them re-route
toward order points the level's strategic map has no path to (section 3).

**Still open.** The bots still standing in Change are wedged, not waiting: on
Basrah's Edge an Iraqi 22 m from a sandbagged Browning, on Kharkov Day 2
three US soldiers at (235.8, -230.6) on their way to an M1A1's MG seat, each
pushing into a point the infantry map calls free while the follower plants an
obstacle every 5 s (AI-32) and re-routes into the same wall. That is the
body against the map, not the Change law, and was there before. On Basrah's
Edge one DPV's order point has no strategic path (section 3), so it
re-routes every tick (8,940 failures).

## 3. Basrah's Edge vehicle nav: authored, not mis-decoded

`Tank0Level0Map.raw` is 18,464 bytes: a 16 x 16 grid of 64 m blocks, 222 of
them the all-blocked special cell and 34 mixed (the format of AI-102,
`CellMap::loadRawFile` 0x085f8930). Decoded (and rendered over the minimap,
`~/.cache/dc-sweep/bots/render_searchmap.py`, `overlay_nav.py`), the mixed blocks draw one
connected road network through the centre of the city whose lines run on
across the block seams, and every ground vehicle the level spawns (BMP-2,
Technical, M2A3, Humvee, Humvee TOW, M163, DPV) stands on a free cell; only
the helicopters, the Browning pits and two Ladas parked on the kerb stand on
blocked ones. A mis-decode would scramble the roads at every seam. The
infantry map draws the same city with its buildings and yards. 81.5 % of the
combat area is blocked on the tank map (73.5 % on the infantry map) because
the city's only drivable cells are its streets and the engine's flood from
the spawn points blocks the rest; vanilla Kharkov's tank map, the other
1024 m level, is 76.6 % blocked over the whole map.

What does differ is DC's strategic data. On both DC-made levels checked, a
free pixel next to a wall can carry an Info value naming a region its 64 m
cell does not use: 4.6 % of Basrah's Edge's tank-map free pixels, 5.1 % of
its infantry map's, 0.9 % of Desert Shield's; vanilla El Alamein, Bocage,
Battleaxe, Kharkov and Wake have none (`info_census.mjs`). The engine hands
such a pixel's value on as it stands (AI-141), so a goal or start there has
no strategic path, there as here. That is what fails the Lada walk the
Iraqis froze on and the DPV's order point (425, -516). `nav-search.js
regionedNear` moves only a region-less end (INVENTION, unchanged); widening
it to these pixels would be a second invention, left for a decision.

## 4. Door-less artillery driver seats

DC's M-109, M-1974, MLRS, BM-21 and SCUD-B hang every door under the gun
seat's PCO; the driver's PCO has none (`door_census.py`: these five, no
vanilla, XPack1 or XPack2 hull). A bot's Use reaches a seat only through a
door in its own subtree (`getEntryPoint`, AI-138), so no bot can board such a
driver seat on foot. The seat swap can: `BBChangeTeleport` weighs the hull's
root and seats as units and switches with the seat's select key, and the
switch (`enterVehicle`) tests no door (AI-52, SEAT-26). The engine's on-foot
Change also weighs the door-less root (AI-139), which it then cannot enter;
whether retail ever ranks it first is open, and the page does not offer it.

**What changed.** `bot-units.js` gives each hull's door-less seats full
candidates of their own (`doorless`, riding on the hull's door candidates,
outside the list every other consumer reads), the seat swap and the seated
bot's own record look there (`bot-mount.js hullCandidates`), and the referee
finds them for the switch (`units.seatCandidate`).

**How it was checked.** `tests/test_bot_ai.py`
`test_the_seat_swap_reaches_a_driver_seat_with_no_door` (from the gun seat of
an M-109 the swap goes to the door-less root; without the door-less list it
goes nowhere). Runner, DC El Alamein, a bot seated in the M-109's gun seat
(`~/.cache/dc-sweep/bots/probe_swap.mjs`): on main the hull's candidates are
its two door seats and the swap can only go to the MG; now the root is
weighed from the first tick (swap urgency 3.9). With one bot a side it takes
the driver's seat at 2 s and drives (MoveTo); with four a side Fire outbids
the swap until its urge curve runs out, by when the MG seat, with an enemy
in its reach, scores higher, as before. Which seat wins is the swap law's
(AI-52).

## 5. The lead's speed and `useAimerOnly` (census CW12)

**What was wrong.** The bots led every vehicle gun with its FireArms'
projectile velocity. The engine's Aimer leads with the AI weapon's own
`weaponTemplate.exitVelocity` where the template sets one, and
`useAimerOnly` lets the trigger go the moment the barrel lies on the Aimer's
solution (AI-143). Vanilla sets each once (the Katyusha: 60); Desert Combat
sets `exitVelocity` 20 times (MLRS, BM-21 and SCUD 72, the TOW, Hellfire,
AT-5 and Spandrel 300, the Hydra 150, the Pantsyr 400, the Silkworm 120, the
CBU and Snakeye -5) and `useAimerOnly` 18 times, all on vehicle and
stationary weapons, none on a hand weapon.

**What changed.** `extract_vehicle_ai.py parse_weapons_con` writes both into
`vehicle-ai.json`'s AI weapons (`exitVelocity`, `useAimerOnly`; DC spells
the second `useAimeronly` on half its launchers). `bot-pilot.js
groupBallistics` leads with the weapon's own exit velocity when it is not 0
(a negative one stands, as `WeaponTemplate::init` leaves it), and
`bot-aim.js aimerOnlyHolds` holds the trigger condition before the
closest-approach miss test (`bot-plans.js execTrigger`).

**How it was checked.** `tests/test_extract_vehicle_ai.py`
`WeaponTemplateWordsTests` and the DC install test (MLRS 72, aimer-only);
`tests/test_bot_ai.py test_the_lead_uses_the_weapon_templates_exit_velocity`
(72, 0 -> the FireArms' 100, none -> 100, -5 kept; the hold only with the
barrel on the solution and the word set). A short runner match with a bot in
DC El Alamein's SCUD seat did not get it to fire either way, so the effect on
a live round is not measured. Publishing: the five `vehicle-ai.json` of
section 1 carry the two words; only vanilla's Katyusha record changes in
vanilla, XPack1 and XPack2.

## 6. A capture time of 0 (census CW9)

`captureDuration` read `timeToGetControl 0` as unset and gave the point 5 s.
`ControlPoint::handleFrameUpdate` tests the get timer before it runs it: above
0 it counts down (`gettingControl`), otherwise the point is taken the same
frame (`gotControl`), and every reset reloads the timer from the template
(AI-142). DC Medina Ridge sets 0 on all four of its points (radius 2 m, a
push map), so one side alone on one now takes it on the first frame.
`bot-referee.js captureDuration` keeps any number the level gives; pinned by
`tests/test_control_point_law.py test_a_zero_capture_time_takes_the_point_at_once`
(taken at 1/30 s).

**Open, not this package's file:** `server/authority.mjs` (the multiplayer
room's capture, `FLAG_CAPTURE_SECONDS`) has the same `> 0` guard.

## 7. A bot's shotgun fires every barrel

**What was wrong.** A bot's pull was one ray down its eye. DC's Remington
and Saiga12k declare eight barrels at the FireArms' origin, each turned up
to 1.5 degrees: the server fires each as its own round down its own turn of
the launch frame, for every player alike (ledger XHIT-12, XHIT-16). A bot
fired one pellet with an eighth of the pull's damage.

**What changed.** `bot-barrels.js` reads a weapon glb's barrels
(`fireArmsBarrels`: every `extras.muzzle` node under the FireArms node, its
transform relative to it) into the bot's fire data (`map.html
botWeaponData`, `sim/level.mjs weaponFire`), and `barrelRays` hands the
bot's eye and the barrels to `gun-groups.js cameraLaunch`, the law the
human's hand weapon (`hand-aim.js`) and the vehicle coax fire through.
`bot-referee.js fireTick` resolves one round per barrel, each drawing its
own deviation and paying the round's full damage; a gun with one plain
barrel keeps the one ray down the eye.

`cameraLaunch`'s export came with the hand weapons' barrels
(features/hand-weapon-barrels-sight-and-heat), on main since 2026-10-07.

**How it was checked.** `tests/test_bot_weapons.py BotBarrelsTests`: a
Remington pull is eight resolved rounds, each 0.5 to 1.5 degrees off the
view axis and no two alike; a Colt's is one, down the eye; barrel transforms
compose down the node path. The runner's own fire data on DC El Alamein
(`~/.cache/dc-sweep/bots/probe_barrels.mjs`): Remington and Saiga12k 8
barrels, 0.48 to 1.54 degrees off axis; M16A2, AK47, M249 one plain barrel.

## 8. A bot's MG burst stops at heat 0.8

**What was wrong.** Bots held an MG's trigger until the heat law locked the
gun (GUN-14): a stationary MG42 or a pintle Browning ran 38 rounds into the
2 s lockout and then fired about a round every 2 s. Retail bots never reach
the lockout. `createFirePlan` puts a hold around the loop's body,
`If(Or(empty, Not(BAPConWeaponHeat(0.8, 0.5))), hold, fire)`, re-read every
tick (ledger AI-144). The hold lets go of the fire channel and keeps looking
at the target. The plan goes on. The condition latches at 0.8 and releases at
0.5, and it is built with the plan, so a new plan fires while the heat is
under 0.8.

**What changed.** `bot-fire.js weaponHeatHolds` is `BAPConWeaponHeat::
evaluate`. `bot-plans.js heatHolds` runs it on the trigger action's own
condition, and `execTrigger` presses nothing while it is false. The heat is
the one that gates the gun: a seat's gun group's `FireState`
(`world.fireStateFor`, found through `weaponGroup`), or the hand weapon's
(`bot-referee.js heatOf`, a `FireState` over the fire data's heat words, one
per kit item for the life of the soldier, stepped while the item is held,
and its trigger refused at heat 1 or in the lockout). The fire data carries
the words: `map.html botWeaponData` and `sim/level.mjs weaponFire` take the
weapon block's `heat`, else the FireArms node's (`bot-barrels.js
fireArmsHeat`). A grenade's `heatAddWhenFire` is its throw's charge, so a
weapon with a `throw` gets none.

**Checked.** `tests/test_bot_weapons.py BotHeatHoldTests`, through the real
`FireState` and the world's order and cadence: a stationary MG42's first
burst is 30 rounds, a Browning's 30 and a Sherman coax's 20, where the lab's
bot bursts stop (GUN-15). The gun fires again on the tick after the heat is
under 0.5 (0.48 at the next round, the lab's peak) and never locks. A plan
made during the hold fires at once at 0.68. A hand M249 stops on the round
its own heat reaches 0.8, and without the hold the same trigger locks.

The lab's recordings say the same about the resume. Replaying their MG
rounds through GUN-14/15, the bursts after a stop start in a sharp peak just
under 0.5 and spread from 0.56 to 0.78, with none at 0.8 or above
(`~/.cache/dc-sweep/bots/heat_resume.py`, AI-144).

**Open.** The empty magazine is the `Or`'s other half: the engine holds the
plan, presses reload and keeps aiming, while `firePlanDone` ends the plan
on it (AI-130's reading). The planes' attack plan reads its own heat limits
(`PLANE_FIRE weaponHeatSmall`, `weaponHeatVehicle`), which nothing applies
yet.

## 9. A bot's hand weapon fires on whole ticks

**What was wrong.** The referee's rate-of-fire timer carried its fraction
from round to round, so a bot fired at its `roundOfFire` exactly: the M249 at
13.5 rounds a second, the Mp40 at 9. The engine sets `timeToFireFinished` to
`1 / roundOfFire` with each round and runs it down a tick at a time (GUN-13),
so a gun's rate is `30 / ceil(30 / roundOfFire)`: the M249 fires 10 a second
and the Mp40 7.5, as the human's guns already do (`gun-cycle.js
advanceGroups`). With the carried fraction a bot's M249 also heated faster
than the law allows (one drain every fourth round instead of every round)
and held at its 33rd round instead of its 48th.

**What changed.** `bot-referee.js fireTick` sets the timer to
`gun-cycle.js firePeriod(roundOfFire)` with each round and runs it down in
float32 on the world's ticks, floored at 0.

**Checked.** `tests/test_bot_weapons.py`: a held Mp40 empties its 32 rounds
over 31 periods of four ticks (4.13 s), an M249's rounds are 0.1 s apart, a
Thompson still fires 10 a second, and a bot's M249 holds at its 48th round,
where the heat law first reaches 0.8.

## 10. A bot's round lands on one point of its cone

**What was wrong.** `bot-referee.js rollCone` rolled each round into a fresh
disc of the total in degrees. The engine's cone is DEV-9's square in
hundredths of a radian, and a bot's rounds do not roll at all: in the lab's
server recordings every round of a bot's burst lands on the same point of the
square, scaled by the total.

**What the engine does** (ledger AI-145). `fireBarrel`'s two draws are a pure
function of the current input index plus the barrel, over a static table.
`simulatePlayerUpdate` takes the index from the player's action buffer. A
human's actions are numbered as they arrive. A bot's are queued with an index
nobody writes, so it keeps one value. The recordings settle that value. All
3,394 bot MG rounds, vanilla and Desert Combat, lie along one direction of
the square. The low edge of their sizes is (minDev + 0.3125) x 0.980 for
three guns with different minDevs. Only index 617 fits both, so a bot's
barrel 0 lands at (up 0.9517, right 0.2325) times the total.

**What changed.** `bot-deviation.js` holds index 617's draws for barrels 0 to
15, taken from the binary's own table and generator, and `botDeviate` hands
them to `round-launch.js deviate`, the human's square, on a frame whose +X is
the shooter's right. `resolveShot` and the flown rockets (`bot-rounds.js`)
call it with the bot's total in the cone's own unit. They used to multiply it
into degrees. `rollCone` is gone. A shotgun's barrel `i` takes point `i`.

**Checked.** `tests/test_bot_weapons.py BotDeviationPointTests`: facing -z
at a total of 1 the round is 0.0095 up and 0.0023 right, it scales with the
total, nothing is drawn at 0.01, each barrel has its own point, the right
axis turns with the line, and the table matches the binary's generator.

**Open.** The index is measured, not traced: the stack slot `AIPlayer::
addInput` leaves unwritten was not followed back to its writer. A server tick
that finds no queued action uses the index + 1 (618). A few percent of the
recorded rounds sit below the floor, which may be those ticks. The viewer
does not model them.

## 11. A bot leads a dragged round with its drag

**What was wrong.** The bot's Aimer search has a drag term, and the viewer
passed it 0 for every gun. A rocket that declares a drag, such as DC's MLRS
(`mass 20`, `drag 1.0`), was led as if it flew without one.

**What changed** (ledger AI-146). `WeaponFireArm::init` gives the Aimer the
round's `pi r^2 drag / mass`, the same frontal-area law the round flies by.
`bot-pilot.js aimerDrag` computes it from the round's `drag` and `mass` words
and the drawn round's radius, which the flight's drag law also uses.
`groupBallistics` returns it, and the three `firingDirection` calls take it.
A round without a `drag` word gets 0, so every vanilla bullet and shell is
unchanged.

**Checked.** `tests/test_bot_ai.py AimerDragTests`: the MLRS rocket on a
1.5 m round gets `pi x 2.25 / 20` (0.353). A bullet with no word gets 0, and
so does a round with no radius. An indirect lead at 300 m comes out at a
different elevation with the drag than without it.

