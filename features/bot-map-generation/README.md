# Bot map generation: adding bot support to levels that ship without it

Status: research and approach, 2026-11-10. Nothing here is built. No level was
extracted, baked, patched or published for it.

Every claim below carries its source: **measured** (how is in "How this was
measured" at the end), **repo** (a document or module in this checkout),
**web** (a URL, read by a research pass on 2026-11-10 and not re-fetched
afterwards), or **inference**.

## 1. Summary and recommendation

The owner's hypothesis was: many FHSW and FHSWEurope levels lack bot support
only because nobody got round to it, so learn how the botted levels do it and
apply the rule to the rest. The measurements change the picture in four ways.

1. **The gap is much smaller than it looks, and it is not where it looks.**
   FHSW 0.81 has 140 levels, 57 with an AI layer and 83 without. But 70 of
   those 83 have a same-named level in FHSWEurope that does carry an AI layer
   (the FHSWEurope team botted nearly everything in 2024), and 29 of the 70
   are the same level to the object count and the control point positions.
   FHSWEurope itself: 274 exported levels, 260 with an AI layer, 14 without.
   Levels with no bot data in either mod: 13 FHSW names and 14 FHSWEurope
   names, largely the same list; 10 of the 13 and 11 of the 14 are 8 km (one
   16 km) naval or air levels, nearly all ObjectiveMode only, the case
   retail's bot AI handles worst.
2. **"How the other bot maps do it" is three different crafts, not one rule.**
   DICE's 17 levels are hand-written and each is unique. FH and FHSW inherit
   or imitate that. FHSWEurope's 2024 work is template botting: three
   strategy files cover 148 of its 260 levels, and its search maps are mostly
   hand-drawn lanes, with 51 levels using one file for both tanks and
   infantry. A generator that imitated the majority of examples would imitate
   the templates and their defects.
3. **The existing community data fails checks a generator would have to
   pass.** On only 83 of 259 FHSWEurope levels does every co-op control point
   lie inside a strategic area; on 14 none does. One template (50 levels)
   names a condition its own file does not define. Three FHSW and three
   FHSWEurope levels ship search or strategic maps the engine refuses to
   load. A headless match on FHSWEurope's Ramelle with its own AI layer still
   logs about 1,800 route failures and 135 no-progress redeploys in 7 minutes.
4. **The repo already holds most of the generator.** The page's bots consume
   retail's own files (`AI.con`, `AI/*.con`, `Pathfinding/*.raw`). For a level
   with none, `viewer/nav-map.js` already paints the search map the way the
   engine does, and it agrees with DICE's shipped maps on 95 to 98 % of cells
   (Bocage, El Alamein). A deterministic headless match runner (`sim/run.mjs`)
   already reports captures, route failures, redeploys and behaviour shares.
   What is missing is a writer for the strategic maps, a strategic-area
   generator, a strategy template, a co-op layer writer, and the stuck,
   oscillation and outcome detectors on top of the runner.

**Recommendation.** Build it as a rule-based pipeline with a simulator in the
loop, and build the verifier before the generator, because the verifier is
useful on day one: it lints the 317 existing AI layers and ranks them. Then
generate for land Conquest levels, compare three ways on levels that have a
community layer (none, community, generated), and only then decide which
levels get generated data. Emit retail-format files as the single output; the
page, the headless runner and the lab's real server all read that format
already. Leave the 8 km naval ObjectiveMode levels to last: they need a game
mode designed, not data derived.

**Machine learning: not needed for the core, and the examples would not
support it.** Search maps and strategic maps are deterministic functions of
terrain and collision that the engine itself computes; the port exists.
Strategic areas and strategies would be the learning target, and the corpus
is 17 hand-made DICE levels plus a few hundred community levels dominated by
three copied templates with measured errors. Optimisation against the
simulator's own metrics (tuning radii, weights and route areas until bots
capture and stop getting stuck) uses the real objective and needs no training
set. Human round recordings are worth using as a prior for route areas and as
a validation signal, which is the hook for the separate recordings research.

## 2. What "bot support" is

### 2.1 Retail (Refractor) co-op and single player

Measured from the archives (Bocage, vanilla; A_Day_of_Zitadelle, FHSW) and
read from `features/bf1942-ai-research-2026-09-21/pathfinding-raw-format.md`,
`bot-movement-and-pathfinding.md` and `features/bf1942-ai-spec/strategic.md`.

| File in the level archive | What it is | Hand judgement or derivable |
|---|---|---|
| `GameTypes/Coop.con` (and a root `Coop.con` copy) | Tickets, then `run SinglePlayer/...` for spawns, pads and control points, and `if v_arg1 == host` / `run ai` | Derivable from Conquest |
| `SinglePlayerAllied.con`, `SinglePlayerAxis.con` | Instant Battle entry scripts; the game lists a level for single player only when one exists (repo: `features/fh-fhsw-open-issues/README.md`) | Derivable |
| `SinglePlayer/ControlPoints.con`, `ControlPointTemplates.con`, `SoldierSpawns.con`, `SoldierSpawnTemplates.con`, `ObjectSpawns.con`, `ObjectSpawnTemplates.con`, `spawnPointManagerSettings.con`, `bots.con`, `Skirmish.con` | The co-op layer: the Conquest layer, usually edited | Mostly a copy; the edits are judgement |
| `AI.con` | `aiSettings.setWorldMapSize`, view distance, bot manager quotas, `ai.createSAI`, then runs the files below and lists each side's strategies with `ai.addSAIStrategy` | Template |
| `AIpathFinding.con` | `ai.addSearchMap` per vehicle class, `ai.addSearchType`, `ai.setMapSpawnPoints`, `ai.loadMaps` | Template plus a table lookup |
| `Pathfinding/<Map>Level<L>Map.raw` | Search maps: one bit a pixel, 1 blocked; level L pixel is `2^L` m; 64 x 64 pixel blocks, sparse (a block is "all free", "all blocked" or 512 inline bytes) | Derivable (the engine computes it) |
| `Pathfinding/<Type>.raw`, `<Type>Info.raw` | Strategic map: per 64 m cell up to four regions with a point each and link bits to the +x and +z neighbours; `Info` is a two-bit region id per `2^(L+1)` m pixel | Derivable from the search map |
| `AI/StrategicAreas.con` | Named boxes (`aiStrategicArea.create name x1/z1 x2/z2 value`), neighbours, flags (`ControlPoint`, `Base`, `Route`, `Flank`, `ChokePoint`, ...), order positions per search type, side, `setTakeable`, vehicle groups, landing zones | The judgement-heavy file |
| `AI/Strategies.con`, `AI/conditions.con`, `AI/prerequisites.con` | Strategies (aggression, number of attacks and defences, time limit, per-flag temperature factors) gated by weighted conditions | Template by level archetype |

Engine rules that bound a generator (repo, ledger AI-102, AI-117, AI-118):

* `ai.loadMaps` stops at the first search map that fails to load (a missing
  level file or a header mismatch), and no strategic map loads when any
  search map failed. A map that did not load is all free.
* A unit routes on the search type its template's `vehicleNumber` indexes:
  0 for every vanilla land vehicle (so jeeps route on `Tank0`), 1 the
  soldier, 2 ships, 3 landing craft, 4 the amphibious hulls, aircraft -1 (no
  map: an aircraft is ordered to an area's middle at +75 m).
* The AI runs on the host only. Measured: A_Day_of_Zitadelle's `Coop.con`
  runs `ai` inside `if v_arg1 == host`.

### 2.2 The page's own bots

Repo: `viewer/bot-referee.js`, `viewer/nav-map.js`, `viewer/nav-baked.js`,
`viewer/strategic-map.js`, `viewer/strategic-ai.js`, `bf42/ai_level.py`,
`features/level-bake-layers/README.md`.

* **It reads retail's files, re-encoded only as JSON.** The exporter parses
  `AI.con`, `AIpathFinding.con` and `AI/*.con` into `scene.json` `ai`
  (`bf42/ai_level.py load_level_ai`), and copies each loaded search map's
  lowest level and each strategic map byte for byte into the level's
  `pathfinding/` folder with an `index.json`. `patch_scene.py --layer ai`
  rewrites exactly that for an already baked level in about 5 s, no glb
  touched.
* **With an AI layer:** routes are planned on the level's own strategic map
  and searched on its own search map; orders come from a port of the engine's
  strategic AI behind `viewer/doctrine.js`.
* **Without one, today:** the nav map is painted from the collider
  (`buildNavMap` with no baked map: water depth, slope, the statics' clip
  band, the brush, the spawn flood), land vehicles get a painted map with
  `Tank0` defaults, there is no water map (`waterNav` returns null with no
  `searchMaps` row), routes are planned on an invented 16 m coarse layer, and
  every bot walks at the nearest flag its side does not hold
  (`bot.js _fallbackWaypoint`). The side that holds every capturable flag
  stands idle (repo: FHX-19 in `features/fh-fhsw-open-issues/README.md`).
  Instant Battle lists such a level with a NO BOTS tag and starts it with
  `botCount=0` (repo: `features/fhsweurope-extraction/README.md`).
* **So the two consumers want the same artefact.** A generated AI layer in
  retail format feeds the page through the existing `ai` layer and feeds the
  real game unchanged. The page does not need the co-op layer to run bots (it
  can run them on Conquest); retail does.

## 3. Census

### 3.1 From the level archives on this machine (measured)

Each level's archives were merged down the mod chain (parents first), then
`bf42.ai_level` applied the engine's own load rules. "Complete" means
strategic areas and strategies exist and every declared search map and
strategic map loads.

| Install | Level archives | With `AI.con` and a CoOp game type | Complete | Notes |
|---|---|---|---|---|
| bf1942 (vanilla) | 21 | 17 | 15 | Gazala and Tobruk declare a `Car` type and ship no `Car.raw` (the last type, so nothing else is lost). No AI: Aberdeen, Coral Sea, Invasion of the Philippines, Liberation of Caen |
| XPack1 | 6 | 6 | 6 | |
| XPack2 | 9 | 8 | 8 | |
| FH 0.7 over vanilla | 60 | 48 | 48 | |
| FHSW 0.81 over FH and vanilla | 143 (140 levels and 3 texture archives) | 57 | 47 here | 7 more need the FH fan map pack base archives, which this install lacks; the published tree shows them complete |

FHSWEurope is not installed on this machine, so its archives were not read.

**FHSW level archives are overlays.** Many hold no heightmap and inherit the
rest from FH's or vanilla's archive of the same name. Of the 50 FHSW levels
whose strategic areas resolved here, 39 take `AI/StrategicAreas.con` from a
parent mod (FH 37, vanilla 2) while `StaticObjects.con` is FHSW's own: the AI
layer was written for FH 0.7's version of the level and FHSW changed the
level under it.

### 3.2 From the published trees (measured)

`maps.json`, `scene.json` and `pathfinding/index.json` of every level on
mesh.bfstats.io, which were baked from the full installs. This is the census
to quote.

| Tree | Exported levels | With an AI layer | Complete | Partial | No AI layer |
|---|---|---|---|---|---|
| FHSW 0.81 | 140 | 57 | 54 | 3 | 83 |
| FHSWEurope 0.84 | 274 | 260 | 257 | 3 | 14 |

Whether 274 is every level FHSWEurope installs was not verified.

Partial levels (the engine's stop-at-first-failure rule applied):

| Level | Tree | Defect | Effect in the engine |
|---|---|---|---|
| Arctic_Convoy-1942 | FHSW | `Tank.raw` is 64 x 64 cells, the map needs 128 | No strategic map loads |
| Operation_Kikusui_day2 | both | No `Boat2Level3Map.raw` | `Boat2` and every strategic map fail |
| Operation_Forager | both | No `Car.raw` | The last type only |
| muurola-1944 | FHSWEurope | No `Tank0Level2Map.raw` | Every search map and strategic map fails; all maps all free |

FHSW's 83 levels without an AI layer, by game type: Conquest only 68,
ObjectiveMode only 11, Conquest and CTF 2, Conquest and ObjectiveMode 1,
Conquest, CTF and TDM 1. By world size: 2048 m 41, 1024 m 26, 8192 m 11,
4096 m 5.

### 3.3 The twins

| Of FHSW's 83 levels without AI | Count |
|---|---|
| Have a same-named FHSWEurope level | 80 |
| ...and that level has an AI layer | 70 |
| ...and it is identical in world size, object count, and Conquest control point names and positions | 29 |
| No bot data in either mod | 13 |

The 29 identical twins: battle_for_ortona-1943, battle_of_edson_s_ridge,
berlin-1945-outskirts, bizerte-1943, fht_battle_of_kohima-1944,
hungary_forest-1945, in_the_hell_of_bocage-1944, iron_monster, pegasus,
ramelle_neuville-1944, salerno-1943 (1024 m); battle_of_iwo_jima,
battle_of_pavlov-1942, fht_battle_of_mareth_line-1943, fht_dinant-1940,
fht_operation_dracula-1945, fht_operation_longcloth-1943, korsun_pocket,
manchuria-1945, naichi-1945, operation_springawakening, seelow-heights-1945,
simusyu_to-1945, the_great_pursuit, the_merville_battery,
ural_mountains-1947, way_to_paris-1946 (2048 m); battle_of_bougainville,
saipan-1944 (4096 m).

The other 41 twins differ (objects added or removed, a control point moved,
renamed or added); each needs a diff before its AI layer can be trusted on
the FHSW copy. Of the 57 levels with AI in both trees, 53 have identical
strategic areas.

### 3.4 The levels with nothing anywhere

| Level | Tree | World | Game types | Control points | Soldier spawns |
|---|---|---|---|---|---|
| Aberdeen | both | 1024 | Conquest (FHSWEurope also lists CoOp with no AI behind it) | 7 | 55 |
| Adak_race | both | 2048 | Conquest | 3 | 20 |
| Operation_Varsity | FHSW | 2048 | Conquest | 8 | 122 |
| helsinki | FHSWEurope | 2048 | ObjectiveMode | 5 | 19 |
| Air_Raid_Alert_-Kure-1945, Operation_Hailstone | FHSW | 8192 | ObjectiveMode | 5 | 13, 23 |
| Battle_of_Leyte_Gulf_day2, Battle_of_Off_Malay, Dover_Strait, Monster_des_Stahles, Operation_A, Operation_Kikusui_day1, ScapaFlow-1946 | both | 8192 | ObjectiveMode | 0 to 4 | 0, except Dover_Strait 72 |
| Midway-1942 | both | 8192 | Conquest, ObjectiveMode | 2 | 1 |
| escape_from_leyte, july26-1945 | FHSWEurope | 8192 | ObjectiveMode | 5, 1 | 3, 19 |
| surigao_strait-1944 | FHSWEurope | 16384 | ObjectiveMode | 0 | 0 |

FHSWEurope's own release notes agree (web:
`https://www.moddb.com/mods/fhsw-european-mappacks/downloads/fhsweurope`,
12 March 2024): "Added singleplayer to all maps, except" twelve naval levels.

## 4. How existing bot maps do it

### 4.1 Search map parameters are a lookup table (measured)

| `ai.addSearchMap` line | vanilla (17) | FHSW (57) | FHSWEurope (260) |
|---|---|---|---|
| `Infantry1 0 1.5 30 1.0 0.4 2.0 1` | 14 | 53 | 233 |
| `Tank0 0 0 25 3.0 0.3 2.5 0` | 7 | 32 | 207 |
| `Tank0 0 0 30 3.0 0.3 2.5 0` | 7 | 18 | 31 |
| `LandingCraft3 1 1.4 30 4.0 0.3 2.5 0 2 5` | 2 | 13 | 54 |
| `Boat2 1 8 30 125 0.3 2.5 0 2 5` | 2 | 1 | 41 |
| `Boat2 1 15 3 1.0 0.3 2.5 0 2 5` | 0 | 10 | 11 |

Search type sets on FHSW: `Tank, Infantry` on 39 of 57; with `Boat,
LandingCraft` on 7; a fifth and sixth type (`Car`, `Amphibious` or
`Amphibius`, `PT`) on 10. The slope and the type list vary by mapper; nothing
else does.

### 4.2 Three ways the search maps were made (measured)

The metric: of the heightmap samples the terrain alone leaves walkable (not
deeper than the map's water depth, slope within its limit), the share the
shipped infantry map leaves free.

| Tree | Levels | Median free share | Under 40 % free | 40 to 75 % | 75 % and over | Nothing painted (all free) | Tank file byte-identical to Infantry file |
|---|---|---|---|---|---|---|---|
| vanilla (DICE) | 17 | 0.60 | 7 | 2 | 8 | 0 | 0 |
| FHSW 0.81 | 57 | 0.47 | 28 | 19 | 10 | 0 | 2 |
| FHSWEurope 0.84 | 256 | 0.12 | 206 | 30 | 16 | 4 | 51 (of 259 with both files) |

Water maps that are entirely free: FHSWEurope 36 of 126, FHSW 0 of 34.

Reading:

* **DICE's maps are engine output, often then restricted.** Bocage (0.91),
  El Alamein (0.91) and Midway (0.91) leave nearly all walkable ground free.
  Omaha Beach (0.03), Stalingrad (0.08), Berlin (0.08) and Battle of the
  Bulge (0.14) confine bots to the playable part. Part of that is the
  engine's own spawn-point flood (unreached ground is blocked); how much is
  hand editing was not separated. In every DICE level the tank and infantry
  files differ.
* **FHSWEurope's maps are mostly hand-drawn lanes.** Ramelle_Neuville-1944:
  both files are 30,240 bytes and 91.5 % blocked. The repo's painter agrees
  with them on 13.3 % (infantry) and 14.0 % (tank) of cells, the FHX-19
  figure reproduced, and 23 % of the cells the shipped infantry map leaves
  free (37 % for tanks) are cells where the painter finds static collision:
  the lanes were drawn over the streets by hand and overlap the walls.
  Moscow_Outskirts-1941 is the same (90 % blocked, 21 % and 26 % agreement).
* **The repo's painter reproduces the engine where the engine made the map.**
  Painted against shipped, with the level's own parameters and spawn seeds:

  | Level, map | Agreement | IoU of blocked cells | Shipped-blocked cells the painter leaves free | Shipped-free cells the painter blocks | Build time |
  |---|---|---|---|---|---|
  | Bocage `Tank0` | 95.2 % | 0.86 | 14.2 % | 0.2 % | 0.77 s |
  | Bocage `Infantry1` | 98.2 % | 0.92 | 7.5 % | 0.3 % | 0.58 s |
  | Bocage `Car4` | 95.5 % | 0.90 | 9.9 % | 0.4 % | 0.73 s |
  | El Alamein `Tank0` | 94.9 % | 0.79 | 19.6 % | 0.5 % | 0.73 s |
  | El Alamein `Infantry1` | 97.0 % | 0.83 | 14.6 % | 0.5 % | 0.59 s |
  | El Alamein `Car4` | 96.3 % | 0.92 | 7.2 % | 0.8 % | 0.89 s |

  The painter errs on one side: it under-blocks. What it misses is known in
  outline (repo: ledger AI-93): the engine clips against `aiMeshes.rfa` hulls
  where they exist, runs a convex-object pass that was not read, and blocks
  one terrain material whose id was not determined.

### 4.3 How the maps were made originally (web, with repo leads)

* The engine generates them. Community practice is the debug executable
  `BF1942_r.exe` with `ai.createAllMaps` placed in `AIpathFinding.con` after
  `ai.loadMaps`, or `ai.createMaps <n>` from the console per type (0 Tank,
  1 Infantry, 2 Boat, 3 LandingCraft, 4 Car), starting from all-black
  (all-free) placeholder maps
  (`https://web.archive.org/web/20120103180519/http://www.cajunwolf.com/Botinator%205%20Tutorial.html`,
  `https://classic-battlefield-modding.fandom.com/wiki/Fixing_the_Botinator_problems`).
* Hand editing afterwards is the norm: "It is rare that bf or bfv ... will
  create a perfect set of pathmaps. I always edit mine"
  (`https://classic-battlefield-modding.fandom.com/wiki/BF42_Pathmapping_-_Part_1`).
  Tools: Genpathmaps converts the raws to bitmaps and back and regenerates
  the derived strategic and coarse files from a level-0 map alone
  (`https://classic-battlefield-modding.fandom.com/wiki/Genpathmaps_Guide`);
  Rexman's AI Tools pack three 8-bit images into the 15 `Pathfinding` files.
* Mods whose statics lack AI meshes make generation freeze or streak; the
  workarounds are a wider infantry brush, `considerAITypes 0`, or generating
  with the level's custom objects disabled (same Botinator pages). FHSW and
  FH statics are in that class, which is the likely reason FHSWEurope's maps
  are hand-drawn (inference).
* Repo lead, not verified: the generator is in the Linux dedicated server
  binary the lab already runs. `features/bf1942-engine-reference/symbols.json` has
  `AIPathfinding::createMaps(unsigned int)` at 0x0847b2e0 (ledger AI-12 calls
  it the editor path), and the second corpus
  (`features/bf1942-engine-reference/recorpus.py createAllMaps`) lists
  `AIConsole::createAllMaps` 0x084751c0, `AIPathfinding::createAllMaps`
  0x08482730 and four `saveRawFile` functions. If the console word is
  registered in the release server and the save path is live, the lab server
  can produce the engine's own maps for any level with no debug executable,
  which would be the reference to hold the painter against on mod statics.

### 4.4 Strategic areas: what is regular and what is taste (measured)

| | vanilla (17) | FHSW (57) | FHSWEurope (260) |
|---|---|---|---|
| Areas per level, median | 10 | 9 | 6 |
| Co-op control points per level, median | 5 | 6 | 7 |
| Areas that are not `ControlPoint` or `Base`, per level, median | 5 | 2 | 1 |
| Levels where every co-op control point is inside an area's box grown by its value | 17 | 44 | 83 of 259 |
| ...under half the control points | 0 | 0 | 38 |
| ...none | 0 | 0 | 14 |
| `ControlPoint` or `Base` areas with a control point inside the centre box | 93 % | 87 % | 44 % |
| Box half-width over the control point's radius, median, for areas whose second corner is within 5 m of a flag | 1.00 | 1.00 | 0.80 |
| Neighbour count per area, median | 3 | 3 | 3 |
| Levels whose neighbour graph is complete | 0 | 2 | 63 |
| One-way neighbour references | 44 | 235 | 381 |
| Most used values (the fourth `create` word) | 150, 200, 50, 20 | 200, 50, 150, 100 | 100, 200, 50, 20, 1 |
| Most used flags after `ControlPoint` | Centre, Flank, Base, Route, Close | Base, Route, Centre, Flank | Route, Base, Centre |

All 1,041 areas in the vanilla, FH and FHSW archives are authored with the
second corner greater than the first on both axes, so the exporter's sorted
`min` / `max` loses nothing.

What a rule can produce:

* One area per control point, the second corner on the flag and the first at
  the flag minus its capture radius. This is both the measured DICE habit
  (half-width equals the radius at the median) and the community tutorial's
  rule (web:
  `https://classic-battlefield-modding.fandom.com/wiki/BF42_Understanding_the_AI_-_Part_2_-_Strategic_Areas`).
* Values from a small table: the tutorial gives 150 to 200 for control
  points, 50 to 100 for bases, 10 for waypoints; the measured values match.
* `Base`, the side and `setTakeable <side> 0` from the control point's team
  and its `unableToChangeTeam`.
* Compass flags (`North`, `East`, ...) from position; `Front` and `Safe` are
  computed by the engine, not authored.
* Neighbours from the search map: two areas are neighbours when the shortest
  route between them passes through no third area.

What is taste, and where DICE's levels differ from everyone else's:

* The extra areas. DICE adds a median of five per level that sit on no flag:
  `Route`, `Flank`, `ChokePoint`, `Close`, `Remote`, `StrongPoint`. They are
  what makes bots take a second road. The community mostly skips them.
* Order positions. Only 113 of vanilla's 454 are within 1.5 m of the area's
  middle; the rest were placed by hand on a road or behind cover.
* Which control points a co-op layer drops or adds (FHSWEurope 0.82 adds an
  attackers' flag "provoking more aggressive attacking behavior"; web:
  `https://www.moddb.com/mods/fhsw-european-mappacks/downloads/fhsweurope-082`).

### 4.5 Strategies: hand-written by DICE, templated by everyone since (measured)

| | vanilla (17) | FHSW (57) | FHSWEurope (260) |
|---|---|---|---|
| Distinct strategy, condition and prerequisite bodies | 17 | 53 | 91 |
| Levels covered by the three most used bodies | 3 | 6 | 148 |

FHSWEurope's three templates: `attack / hold2 / hold3` with the attacker on
side 2 (61 levels), the same with a `Front` modifier (37), and `attack /
hold4 / hold5` with the attacker on side 1 (50). The third names a
prerequisite condition `constantCond` that its `conditions.con` does not
define (it defines `constantCPCond`), and its `fourFriendlyCPCond` tests for
two control points. 73 FHSWEurope levels name their areas `1st`, `2nd`,
`3rd`.

The tutorials say the same (web:
`https://classic-battlefield-modding.fandom.com/wiki/BF42_Understanding_the_AI_-_Part_2_-_Strategic_Areas`
and its sister pages): borrow strategies from a similar map, Kursk's
`breakOut`, `holdAndCamp`, `single`, `double` as the base. Botinator 5, the
one whole-process tool the community had, writes a generic
attack/defend/repulse set and creates one area per control point, with known
bugs (areas off-centre and double size, order positions written x/y for x/z;
web:
`https://classic-battlefield-modding.fandom.com/wiki/Explaining_the_Botinator_Strategic_Area_problem`).

Repo caveat (`features/bf1942-ai-spec/strategic.md`): in the page's port a
passing `Required` condition adds nothing to a strategy's score, so on a
level whose conditions are all `Required` the strategy never changes. Whether
the engine does the same is an open read. Until it is settled, strategies
matter less to the page's bots than areas do.

### 4.6 The co-op layer against Conquest (measured)

| | vanilla (17) | FHSW (54 to 57) | FHSWEurope (about 250) |
|---|---|---|---|
| Co-op control point set identical to Conquest's | 11 | 40 | 140 |
| Soldier spawns identical | 0 | 25 | 27 |
| Vehicle pads, co-op over Conquest, median | 0.83 | 0.99 | 0.81 |
| Tickets identical | 12 of 17 | 42 of 54 | 22 of 246 |

The layer is Conquest with the vehicles bots cannot use taken out and the
tickets retuned. FHSW mostly copies it whole.

### 4.7 A measured baseline for "working"

Ramelle_Neuville-1944 from the FHSWEurope tree, the page's own bots in the
headless runner, Conquest layer, 8 a side, 420 s, no vehicles, seeds 1 and 2:

| | Captures | Deaths | Route failures | No-progress redeploys | Strategy changes | Wall clock |
|---|---|---|---|---|---|---|
| With FHSWEurope's AI layer | 4, 4 | 15, 25 | 1,927, 1,687 | 126, 145 | 2, 2 | 23 s, 18 s |
| AI layer removed (what the FHSW twin gets today) | 1, 1 | 3, 3 | 4,657, 4,926 | 184, 155 | 0, 0 | 9 s, 9 s |

The community layer makes a fight happen where none did. It also leaves
every bot redeployed about eight times in seven minutes. For scale, the
ledger's AI-104 records El Alamein at 0.0 route failures a match and Bocage
at 26 over ten 600 s seeds with vehicles. So "as good as the existing
community map" is a low bar on this level, and the DICE levels are the
baseline to aim at.

## 5. The generation pipeline

One output format: retail's files, written into an overlay directory per
level and packed as a numbered patch archive (`bf42/rfa.py write_rfa`
already writes `<Level>_NNN.rfa` overlays). The original archives and the
install are never modified. The page takes the result through
`patch_scene.py --layer ai` on a scratch tree first; the lab server takes the
archive. Every generated level is marked (`pathfinding/index.json`
`generated`, generator version, input hashes) so the menu can show it as
experimental, as agreed in principle on 2026-10-12 (repo:
`features/fh-fhsw-open-issues/README.md`, "Parked").

| Phase | Input | Output | Exists already | Size |
|---|---|---|---|---|
| 0. Census and lint | Level archives or a baked tree | Per-level AI inventory, engine load verdict, the static checks of section 6.1 | `bf42/ai_level.py` loaders; this document's scratch scripts | S |
| 1. Level facts | `scene.json` (control points, spawns, pads per mode, water level, heightmap), the collider (heightmap plus static collision), `_shared/vehicle-ai.json` | One JSON per level: which search types its placed vehicles need, which pads have an AI template, level archetype | `sim/level.mjs realLevel`, `sim/stage.mjs` build the collider headless; `extract_vehicle_ai.py` | S |
| 2. Search maps, land | Collider, the parameter table of 4.1, soldier spawns and pads as flood seeds | `Tank0Level0..2Map.raw`, `Infantry1Level0..2Map.raw` | `viewer/nav-map.js buildNavMap` paints level 0; a `.raw` writer and the OR pyramid are missing (the reader is `nav-baked.js`) | M |
| 3. Search maps, water | Heightmap, water level, ship collision | `Boat2Level2..5Map.raw`, `LandingCraft3Level2..5Map.raw` | `buildNavMap` with `waterMap: true` and the distance-transform brush | M |
| 4. Strategic maps | Each search map's lowest level | `<Type>.raw`, `<Type>Info.raw` | Reader only (`viewer/strategic-map.js`, `bf42/ai_level.py read_strategic_map_raw`); the format is fully documented in `pathfinding-raw-format.md`; AI-104's patch decomposition is the same idea at 16 m | M |
| 5. Strategic areas | Control points of the co-op layer, the search maps, optional route hints | `AI/StrategicAreas.con` | Nothing | M, then L for route areas |
| 6. Strategies | Level archetype | `AI/Strategies.con`, `conditions.con`, `prerequisites.con`, the `ai.addSAIStrategy` lines | Nothing; three archetype templates | S |
| 7. Co-op layer | Conquest layer, `vehicle-ai.json` | `SinglePlayer/*.con`, `Coop.con`, `GameTypes/Coop.con`, `SinglePlayerAllied.con`, `SinglePlayerAxis.con`, `AI.con`, `AIpathFinding.con` | Parsers in `bf42/level.py`; no writer | M |
| 8. Tune | The verifier's metrics | Adjusted radii, order positions, route areas | `sim/compare.mjs` runs a matrix | M |
| 9. Package and wire in | Overlay directory | Patch archive; a `bot_data_generated` pipeline step after `levels`; the `ai` layer patch | `write_rfa`, `patch_scene.py --layer ai`, `mod_pipeline.py` step table | M |

### Phase notes

**2, land search maps.** Take the painter as it is and add the two things it
lacks for output: the level 1 and 2 files (each pixel the OR of its four
children, as the engine builds them) and the sparse block writer. Run the
flood from every soldier spawn and vehicle pad, because a hull that starts
on a blocked cell gets no search box (ledger AI-103). Emit the FHSW-majority
parameters (`Tank0` slope 25, `Infantry1` slope 30). Known gaps to close or
accept: the 7 to 20 % under-blocking against DICE, the unread convex-object
pass, the unknown impassable material, and bridges, where the painter relies
on a name gate (`viewer/collision-meshes.js DRIVABLE_TOP_RE`) that has
already missed decks twice (repo: `features/fhsweurope-extraction/README.md`
item 5).

**3, water.** A water map is the inverse test (free where the water is at
least the map's depth) with a wide shore brush. The repo's `Boat2` painter
exists and Wake's landing craft already sail on a shipped map. Unknowns are
FHSW's own `Boat2` line (`15 3 1.0`, a 1 m brush where DICE uses 125) and
the `PT5` and `Amphibious4` types: an amphibious map is declared as a land
map with a 5,000 m water depth, so it is "everything but slopes and
statics".

**4, strategic maps.** Per 64 m cell, label the 4-connected components of
free pixels at the Info resolution, keep up to four (largest first; set the
overload bit when there were more), give each a point inside it, and set a
link bit wherever two regions touch across a cell edge. The engine's own
decomposition was not read, so the acceptance test is behavioural:
regenerate DICE's `Tank.raw` and `TankInfo.raw` from DICE's own level-0 map
on the 17 vanilla levels and require the same route (or one of equal cost)
for a fixed set of start and goal pairs through `viewer/strategic-map.js`.
The community's Genpathmaps does exactly this regeneration and its guide
says the Info files come out identical (web, 4.3), so the rule is
recoverable.

**5, strategic areas.** Version one is the control-point rule of 4.4 plus
neighbours from routes. Version two adds what DICE adds: a `Route` area at
the midpoint of any neighbour leg longer than a threshold, a `ChokePoint`
where the leg's narrowest free width on the tank map falls under a
threshold (a bridge, a pass, a street), and a `Flank` area on a second
route that shares little of the first. Order positions per type are the
free cell of that type's map nearest the area's middle, preferring a cell on
the route. Each addition is kept only if the simulator's metrics improve
(phase 8). This is the phase where human recordings would help most
(section 7).

**6, strategies.** Three archetypes cover the Conquest levels measured:
both sides hold capturable flags (symmetric), one side holds only an
uncapturable base (assault), and a line of flags (push). Ship one reviewed
template per archetype, taken from a DICE level of that shape rather than
from the community templates, and choose by rule from the control point
ownership at the start.

**7, co-op layer.** Copy the Conquest layer, drop the pads whose templates
have no `aiTemplate` in `vehicle-ai.json` (FHSW's file has 3,429 vehicle
records; the per-hull census of which placed hulls lack one, as
`features/bot-desert-combat` did for Desert Combat, is still to run), keep
tickets, and declare the search types in FHSW's own order (`Tank,
Infantry, Boat, LandingCraft, Amphibious, PT`) so every hull's
`vehicleNumber` resolves. That last point needs a census of
`vehicleNumber` across FHSW's objects before it is relied on.

### Special cases

| Case | Handling | Confidence |
|---|---|---|
| Bridges and piers | The painter frees a deck over water or slope; verify each deck with a route across it on the tank and infantry maps, and with the existing deck trace (`tests/perf/decktrace.cjs`) | Medium: name-gated |
| Water crossings with landing craft | Landing zones need a direction and a beach both the craft map and the infantry map reach; the engine's rules are read (repo: strategic.md section 8); generation is new work | Low until built; the tutorials call landing craft "the first things to break" (web: `https://classic-battlefield-modding.fandom.com/wiki/Landing_Craft_AI_Explained`) |
| Air | No search map. A pilot is ordered to an area's middle at +75 m. Needs only areas with sensible middles and an `AirField` flag | High |
| Ships and submarines | Vanilla has no submarine behaviour; a bot entering one is reported to crash a server (web, search snippet only, unconfirmed) | Out of scope for version one |
| ObjectiveMode-only levels | Several have no control point and no soldier spawn at all (Battle_of_Leyte_Gulf_day2, Monster_des_Stahles, Operation_A, surigao_strait-1944); three more have flags and no soldier spawns. A co-op layer has to be designed: which flags, where, whose | Needs the owner's decisions per level |
| CTF and TDM | Bots only exist in the co-op game type (repo: skill `bf1942-server-lab`) | Not a target |
| 4096 m and larger | Level 0 at 8192 m is 67 million pixels (8 MB of bits); the painter's time scales with area (about 12 s a map by extrapolation, not measured) | Feasible, untested |
| FHSW's levels with a stale inherited layer | The lint of phase 0 names them; regenerate search maps against FHSW's statics and keep FH's areas where the control points did not move | Medium |

## 6. The verification harness

Three rings, cheapest first. A level passes a ring before the next runs.

### 6.1 Static checks (seconds a level, no simulation)

| Check | Rule | Exists |
|---|---|---|
| Loads | Every declared search map and strategic map loads under the engine's rules | `bf42/ai_level.py level_search_maps`, `level_strategic_maps` |
| References | Every strategy's prerequisite, every prerequisite's condition, every `ai.addSAIStrategy` name, every neighbour and every modifier flag resolves; neighbours are symmetric | New (would have caught the `constantCond` template) |
| Coverage | Every co-op control point lies inside an area; every `ControlPoint` area holds one; no two areas claim one flag ambiguously | New (section 4.4's numbers are this check run by hand) |
| Order positions | Each lies on a free cell of its type's map, inside its own area's box | New |
| Connectivity | Per land type, all capturable control points are in one connected component of the search map; per pair, a strategic route exists and its local legs close | `viewer/nav-search.js findStrategicPath`, `findLocalPath`; the all-pairs driver is new |
| Detour | Route length over straight-line distance per pair, flagged above the DICE levels' 95th percentile | New |
| Width | Narrowest free width along each tank route against the widest hull placed on the level | New |
| Spawns | Every soldier spawn within 2 m of a free infantry cell in the main component; every pad on a free cell of its type's map | New; the flood already knows the component |
| Terrain sanity | No free cell under water deeper than the map's depth or steeper than its slope unless a deck covers it; the free share of walkable ground inside a band set from the DICE levels | New (section 4.2's metric) |
| Vehicles | Every co-op pad's template has an AI template; every `vehicleNumber` indexes a declared type | `vehicle-ai.json`; the check is new |
| Twin diff | Where another tree ships a layer for the same level: agreement, areas moved, flags uncovered | New |

### 6.2 Headless rounds (the page's own engine)

`sim/run.mjs` plays a seeded bots-only match on the viewer's unmodified AI,
vehicles, collision and tickets, byte-reproducible per seed; a 420 s
infantry match took 9 to 23 s here, and the repo records 80 to 100 s for
600 s on El Alamein with vehicles. `sim/compare.mjs` already runs a matrix
of levels, seeds and configurations in parallel.

What its summary gives today: winner and tickets, tickets and flags held
over time, time to first capture, captures, kills and deaths per side and
per bot, route failures (total and per bot), the 12 s no-progress redeploys,
strategy changes, bot errors, seconds per behaviour, vehicle mounts, rounds
and hulls destroyed, takeoffs and landings.

Detectors to add, all computable from the trace it already writes
(`pos`, `beh`, `order`, `route`, `stall`, `veh`, `ctl` per bot per tick):

| Detector | Definition |
|---|---|
| Stuck | A bot in `MoveTo` with throttle on whose position moves under 2 m in 10 s; reported as episodes with place and duration, on foot and mounted apart |
| Idle | Share of alive bot-seconds in `Idle` or `Scout` while its side has an attack target and no enemy is sensed |
| Oscillation | A bot whose ordered area alternates A, B, A within 60 s, or whose track revisits the same 8 m cell five times in 2 minutes |
| Self-inflicted death | Deaths with no killer: drowning, falls, crashes, own vehicle wrecks; a count and a map |
| Spawn trap | A death or a stuck episode within 10 s and 15 m of the spawn point |
| Vehicle use | Share of AI-capable pads ever mounted; hulls abandoned off their own map; aircraft that take off and crash within 30 s |
| Flag coverage | Across the seed set, every capturable flag changes hands at least once and each side makes at least one capture |
| Outcome sanity | Tickets bleed; the round can end by tickets within the level's intended length; neither side wins every seed unless the level is an assault by design |
| Route heat | An occupancy grid of bot positions per type, compared with the free map: lanes used, lanes never used, time spent off any lane |

**Baselines, not absolute thresholds.** Run the same detectors on the 17
DICE levels and the FH levels with hand-made layers, per bot-minute, and
gate a generated level on being inside the baseline's spread (for example
no worse than the baseline's 90th percentile on stuck time, route failures
and idle share, and at least the 10th percentile on captures). Where a level
has a community layer, report the three-way table of section 4.7: none,
community, generated. Section 4.7 shows why an absolute bar is wrong in both
directions: the community layer on Ramelle fails any strict one.

Limits to state with every result: the runner ticks AI at 30 Hz where the
page ticks per frame; it selects the level's default layer (Conquest) unless
told otherwise; and it is the repo's port of the AI, not retail's.

### 6.3 The real game (the lab)

The server lab (`tools/bf1942-models/lab/`, skill `bf1942-server-lab`) runs
the real dedicated server with bots in co-op and records rounds; its
scenarios take a `mod` per level and FHSW and FHSWEurope co-op scenarios
exist (`lab/scenarios/fhsw-arnhem-coop-rec.json`). A generated patch archive
dropped into a scratch copy of the mod's `levels` folder is the retail test:
does the server load the maps (it logs nothing when one fails, so compare
bot movement, not the console), do bots leave their base, does a flag
change hands. The recorder's output then runs through the same detectors
as the headless trace, which also measures how far the page's port is from
the engine on a generated layer. The lab lives on the Linux machine, so
nothing in this ring was run for this document.

### 6.4 What exists and what is missing

| Piece | State |
|---|---|
| Engine load rules in Python | Exists |
| Painter, searches, strategic map reader | Exist |
| Headless collider and match | Exist |
| Seeded match matrix | Exists |
| Quick in-page bot sample (`audit_behaviour.mjs`, 20 s of bots, `bots.no-ai-data` / `bots.stuck`) | Exists, too short to judge a layer |
| Static lint of an AI layer | Missing |
| All-pairs connectivity and detour driver | Missing |
| Stuck, idle, oscillation, self-death, coverage detectors | Missing |
| Baseline corpus of metrics on hand-made layers | Missing |
| Lab scenario template for a generated archive | Missing |

## 7. Where machine learning would and would not earn its place

**Not for the search maps or strategic maps.** They are a deterministic
function the engine defines and the repo has ported to 95 to 98 % agreement
on DICE's levels. A learned painter would need the engine's output as its
target and would be judged by the same rule it approximates.

**Not for learning strategic areas or strategies from the existing maps.**
The honest example count: 17 DICE levels, each hand-written with its own
strategies; about 48 FH levels in the same style; and FHSWEurope's roughly
200 levels of 2024, of which 148 share three strategy files and only 83
place every control point inside an area. That is one style with too few
examples and one style that is mostly a template with errors. A model fit
to it learns "one area per flag, paste template two", which is a ten-line
rule, plus the defects. And the examples carry no label for whether the
bots played well, which is the only thing that matters.

**Optimisation against the simulator is the useful kind of learning here.**
The runner is deterministic and a match costs seconds. Area values, box
sizes, order positions, which route areas to keep and the strategy factors
are a small parameter set per level; a black-box search (random restarts or
CMA-ES over tens of parameters, a few hundred matches) against the
detectors' score is cheap, needs no examples, and optimises the real
objective. Guard it with the DICE baselines so it cannot win by degenerate
play, and with the lab so it does not overfit the port.

**Human recordings: a prior and a check.** The site's round recordings hold
positions over time (repo: `features/round-replay-capture`,
`features/gameplay-recordings`, `features/recording-source`). Two hooks for
the separate recordings research (`features/recording-ml/README.md`), neither
designed here:

* As a prior for phase 5: per level and vehicle class, an occupancy and flow
  grid of where people drive, walk and fly. Its ridges are the roads people
  actually use and its junctions are candidates for `Route`, `Flank` and
  `ChokePoint` areas and for order positions, exactly the part of DICE's
  craft the rules derive worst.
* As a check for section 6.2: the overlap between bot route heat and human
  route heat, and human-used lanes no bot ever takes.

Both depend on how many recordings exist per level. The recordings research
counted the public feed on 2026-11-10: 13 FHSWEurope rounds (7.0 hours), none
of FHSW 0.81, and one round on most levels, each a player recording that sees
the other side about half the time (`features/recording-ml/README.md`, "The
measured data inventory"). That seeds a route and validates nothing, and a
level nobody plays has none; the rule-based path must stand alone.

## 8. Risks and unknowns

| Risk | Why it matters | What settles it |
|---|---|---|
| The levels truly without bot data are mostly 8 km naval or air ObjectiveMode | The generator derives data, not a game mode; ships, submarines and carriers are where retail bots are weakest | The owner decides whether those levels are in scope at all |
| The painter under-blocks by 7 to 20 % against DICE and uses collision where the engine uses AI meshes | Bots may be sent through gaps the engine closes; on FH and FHSW statics there is no engine reference yet | Read the convex pass and the material rule; try the lab server's `createAllMaps` lead for engine output on mod statics |
| The strategic map writer has no reference algorithm | A wrong decomposition gives routes the local search cannot close (the AI-104 failure) | The regenerate-DICE test of phase 4 |
| The page's strategy choice may be inert (`Required` conditions) | Strategy templates could be tuned against a port that ignores them | Re-read `StrategyPrerequisite::evaluate`; until then weight areas, not strategies |
| FHSW's inherited AI layers are stale | 39 of 50 take FH's areas over FHSW's changed statics | Phase 0 lint, then regenerate search maps only |
| Verified in the port is not verified in retail | The headless runner is the repo's AI | Ring 3 on a sample of every batch |
| Server-side-only delivery is unproven | AI runs on the host, so a server-only patch archive may be enough, but whether clients pass the content check in co-op without it was not confirmed (web: only indirect evidence) | One lab test |
| Community etiquette | No permission statement was found for FH, FHSW or FHSWEurope levels (web). The community norm is a numbered patch archive holding only new files, never a modified level, which is what this pipeline writes. FHSWEurope's team did the existing botting and is active | Ask before distributing an archive outside the site; credit the mod; never ship a changed level |
| The FHSWEurope twin's layer is tempting to port and is of mixed quality | 29 identical twins could get bots today by copying; section 4.7 shows what that buys | Port only after the layer passes rings 1 and 2, or use it as the comparison arm only |
| FHSW's unusual vehicles | A hull with no AI template, or a `vehicleNumber` past the declared types, stalls bots at its door (repo: `features/bot-desert-combat`) | The census in phase 1 |
| Measurements here compare against FHSWEurope 0.84's published co-op layers | A mismatch between areas and flags could in places be a level reworked after it was botted (its 0.82 notes say a rework's "Singleplayer mode is still old version") | The lint reports it either way; the bots are sent to the wrong place in both cases |
| Install dependency | FHSW needs the FH fan map packs for seven levels; this machine lacks them | Run archive work on the machine with the full install |

Not verified in this research: the FHSWEurope archives themselves (only the
published tree); whether the release Linux server registers
`ai.createAllMaps`; generation time and limits on 4096 m maps under the
debug executable; the engine's strategic map decomposition; anything on the
lab server.

## 9. First slice

The smallest end-to-end proof, on two named levels that both have an
identical FHSWEurope twin with a community layer, so every result has two
comparison arms.

1. **FHSW Ramelle_Neuville-1944** (1024 m, tank and infantry only, 8 control
   points, 1,419 objects, a town with a river and a bridge). It is the level
   FHX-19 was root-caused on, the hardest kind for the painter (streets,
   statics without AI meshes), and section 4.7 already has its two baseline
   arms.
2. **FHSW Seelow-Heights-1945** (2048 m, tank and infantry, 6 control
   points, open ground where the community map leaves 37 % of walkable
   terrain free). It exercises tank routes and long legs, where route areas
   should matter.

Scope: phases 0, 1, 2, 4, 5 version one, 6 with one template, and rings 1
and 2 with the stuck, idle, coverage and self-death detectors. No water, no
co-op layer (the page runs the bots on Conquest), no lab, no publish. Output
goes to an overlay directory and a scratch copy of the level tree through
`patch_scene.py --layer ai`.

Done means, for each level over ten seeds at 8 a side and 600 s, with
vehicles: the generated layer loads under the engine's rules and passes
every static check; every capturable flag changes hands in at least one
seed and both sides capture; stuck time and route failures per bot-minute
are below the community arm's and inside the spread of the Bocage and El
Alamein baseline; and the phase 4 writer reproduces DICE's routes on those
two vanilla levels. If the generated arm does not beat the community arm on
Ramelle, the finding is which detector separates them, and the slice still
delivers the verifier.

## 10. Task list

S is up to a day, M two to four days, L one to two weeks.

| # | Task | Size | Depends on |
|---|---|---|---|
| 1 | Commit the census as a survey (`surveys/census_ai_layers.py`): chain-merged archives or a baked tree, the engine's load verdict, the tables of section 3 | S | |
| 2 | AI layer lint: the static checks of 6.1 that need no search (loads, references, coverage, order positions, vehicles), run over all 317 existing layers, results in this folder | M | 1 |
| 3 | Read `StrategyPrerequisite::evaluate` for a passing `Required` condition; record the ledger row | S | |
| 4 | `.raw` writers in `bf42/ai_level.py`: search map levels with the OR pyramid, strategic cells and Info; round-trip tests against shipped files | M | |
| 5 | Headless painter CLI (node, on `sim/level.mjs` and `nav-map.js`): a level in, level-0 bitmaps per search type out; painted-against-shipped report as a regression number on the vanilla levels | M | 4 |
| 6 | Strategic map generation and the regenerate-DICE route test | M | 4, 5 |
| 7 | Connectivity, detour, width and spawn checks on the generated maps | M | 5, 6 |
| 8 | Strategic area generator version one (one area per control point, neighbours from routes, order positions on free cells) and a `StrategicAreas.con` writer | M | 5 |
| 9 | Strategy templates for the three archetypes, taken from DICE levels, and the archetype rule | S | 3 |
| 10 | Runner detectors: stuck, idle, oscillation, self-death, spawn trap, vehicle use, flag coverage, outcome, route heat; a `sim/judge.mjs` that scores a summary against a baseline file | M | |
| 11 | Baseline corpus: the detectors over the vanilla and FH hand-made layers, ten seeds each; the percentile file | S plus compute | 10 |
| 12 | First slice on Ramelle and Seelow Heights: three-way comparison, written up here | M | 5 to 11 |
| 13 | Overlay packaging (`write_rfa`), the generated marker, a `bot_data_generated` step in `mod_pipeline.py`, the menu's experimental tag | M | 12 |
| 14 | Route, flank and choke areas (version two) with the simulator in the loop; parameter search | L | 12 |
| 15 | Co-op layer writer and the per-hull AI template and `vehicleNumber` census for FHSW | M | 1 |
| 16 | Water: `Boat` and `LandingCraft` maps, landing zones, the beach checks | L | 12 |
| 17 | Lab ring: scenario template for a generated archive, the server-side-only test, the `createAllMaps` lead | M, on the lab machine | 13, 15 |
| 18 | Batch over FHSW's 70 levels with a community twin: lint the twin, generate, three-way table, decide per level | L, mostly compute | 13, 14 |
| 19 | ObjectiveMode and naval levels: a design per level with the owner | L, open-ended | owner |

## 11. How this was measured

All scripts were throwaway and are not in the repo; task 1 replaces them.

* **Archive census.** `bf42.rfa.RfaArchive` over each install's
  `Archives/bf1942/levels`, files merged per level down the chain (vanilla,
  FH, FHSW; a numbered patch after its base), `bf42.level.LevelFiles` for
  lookups, then `bf42.ai_level.load_level_ai`, `level_search_maps` and
  `level_strategic_maps`. FHSW 0.81 was read from the client package on this
  machine; FH 0.7, vanilla, XPack1 and XPack2 from the game install.
* **Published census.** For every row of each tree's `maps.json` on
  mesh.bfstats.io: `scene.json` (`ai`, `gameTypes`, `modes`, `controlPoints`,
  `heightmap`, `waterLevel`) and `pathfinding/index.json`, read on
  2026-11-10; then every loaded lowest-level search map (919 files) and
  every level's `terrain/heightmap.png`.
* **Twins.** Same directory name in both trees; identical means equal world
  size, equal `objects` count and equal Conquest control point names with
  positions within 1 m.
* **Area and control point geometry.** Areas from `scene.json` `ai`
  (`min` / `max` in the viewer's frame, the second corner at max x, min z),
  control points from the CoOp mode layer, else SinglePlayer. "Inside an
  area" is the centre box (twice the authored rectangle about the second
  corner) grown by the area's value, the page's binding rule.
* **Free share of walkable ground.** At each heightmap sample: walkable when
  the water is not deeper than the map's depth and the central-difference
  slope is within the map's limit; free when the shipped map's pixel there
  is 0.
* **Painter against shipped.** `sim/level.mjs realLevel` and
  `sim/stage.mjs createStage` (no vehicles) for the collider, then
  `buildNavMap` twice per declared map, once with the shipped map and once
  with `baked: false`, the soldier spawns as flood seeds; cell-by-cell
  comparison. Bocage and El Alamein from the local remote cache; Ramelle and
  Moscow Outskirts fetched from the FHSWEurope tree.
* **Headless rounds.** `node sim/run.mjs --map <level> --bots 8 --time 420
  --seed <1|2> --no-vehicles --no-trace` on the fetched Ramelle, and on a
  copy with the `ai` block removed from `scene.json` and no `pathfinding/`
  folder.
* **Web.** A research pass over the Classic Battlefield Modding wiki
  (through web.archive.org), cajunwolf.com (archived), ModDB pages for FHSW,
  the FHSW Coop Mappack 0.04 and FHSWEurope, and the DICE MDT documentation
  mirror. bfmods.com and team-simple.org could not be read; statements
  resting on search snippets alone are marked where used.
