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
