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
