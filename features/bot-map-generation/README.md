# Bot map generation: adding bot support to levels that ship without it

Status: research and approach, 2026-11-10, with a follow-up the same day
(sections 12 and 13), then phase A of the build (section 14): the generator,
the lint, the detectors and the judge exist, and shigaisen_B has a generated
layer kept as source. Phase A2 (section 15) fixed the three causes section
14.6 named: shigaisen_B now passes every check at 8 a side and misses one at
16 a side by 0.0008 redeploys a bot-minute, so its verdict is still a fail
and the batch was not run. Phase B (section 16) took a census of the twenty
fetched community levels and judged the six that could be judged: fourteen
are classed out before a match is run (eleven of them arenas of stacked
floors), none of the six passes at both sizes, and three are better than the
same level with no layer (shigaisen_B, The_Maze, HOP). Section 17 is how a
layer goes live and what is live: shigaisen_B and The_Maze, both accepted
short of the bar and tagged EXPERIMENTAL BOTS in the Community Maps list.
Phase C (section 18) added a route probe and a judge that reads each side,
republished The_Maze with two flags out of play, and judged the mods with
their vehicles in: 47 botless levels of Desert Combat, Forgotten Hope,
BF1918 and FHSW censused, four run through the full matrix, none passing.
The owner accepted, the same day, that the stacked-floor community arenas
get no bots, and asked for the mods next. Phase D (section 19, with
[page-matches.md](page-matches.md) and [seat-behaviour.md](seat-behaviour.md))
found on 2026-11-11 that the verifier had been judging something a player
never meets: bots with a stand-in weapon on the community levels, and the
engine's SAI where the page plays the garrison. With both put right and
both bars rebuilt, The_Maze is still better than nothing and stays live on
a new layer; shigaisen_B is not and was taken off the page; no mod level
reaches better-than-nothing, on DICE's bar or its own mod's.

**What is live, 2026-11-11:** The_Maze (Community Maps), which fails the
page check on team kills and says so in its acceptance, and two mod levels
that pass it: Desert Combat's DC_LostVillage and FHSW's Tunis-1943. A level
now goes to the page without its
menu flag, is played there three times against a bar from DICE's levels
played the same way, and gets the flag after ([page-matches.md](page-matches.md),
section 6).

**Owner decisions, 2026-11-10.** Any level without bots is a candidate, in
every mod and in the community maps, not only FHSW. The priority is on-foot
and air play in a contained space, because that is what is fun against bots.
The big naval levels are out. Section 12 is the census and the ranked
shortlist under that rule; sections 1, 6.3, 8, 9 and 10 were revised to match.

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
   retail's bot AI handles worst. Across every mod measured (section 12):
   1,077 levels, 266 with no bot data, 92 of those with a botted twin in
   another mod, and 68 of them community maps. The best targets under the
   owner's rule are not in FHSW at all: they are small community infantry
   levels and air arenas that are already published and have no bots anywhere.
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
5. **The engine's own generator runs in the lab.** `ai.createAllMaps` in the
   release Linux dedicated server painted and saved Kharkov's search maps on
   this machine: within 0.06 % of DICE's shipped cells, and byte-identical
   whether it started from the shipped maps or from empty ones. No debug
   executable is needed for the search maps. The process aborts before it
   writes the strategic maps, and a mod level was not tried (section 13).

**Recommendation.** Build it as a rule-based pipeline with a simulator in the
loop, and build the verifier before the generator, because the verifier is
useful on day one: it lints the 317 existing AI layers and ranks them. Use
the two FHSW levels with a community twin as the proving ground (none,
community, generated), and make the first real delivery a contained on-foot
level with no bots anywhere: the community map shigaisen_B (section 9). Then
work down the shortlist of section 12: contained on-foot first, air arenas
second, land vehicles after. Emit retail-format files as the single output;
the page, the headless runner and the lab's real server all read that format
already. Where the lab can load the level, take the search maps from the
engine itself and keep the repo's painter as the fast path and the
cross-check. The 8 km naval levels are out (owner, 2026-11-10); they would
need a game mode designed, not data derived.

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
* The generator is in the release Linux dedicated server the lab runs, and
  it works there (measured 2026-11-10, section 13). The lead was
  `features/bf1942-engine-reference/symbols.json`
  (`AIPathfinding::createMaps(unsigned int)` at 0x0847b2e0, which ledger AI-12
  calls the editor path) and the second corpus
  (`features/bf1942-engine-reference/recorpus.py createAllMaps`:
  `AIConsole::createAllMaps`, `AIPathfinding::createAllMaps`, four
  `saveRawFile` functions).

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

Updated 2026-11-10: the engine is now a second source for this phase, and
the better one for retail output. The release Linux server paints and saves a
level's search maps itself (section 13), so where the lab can load the level
the files come from the engine and the painter becomes the cross-check and
the page's instant path. The painter stays necessary: it needs no server, it
runs in under a second, and the page uses it for any level with no baked map.

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
exist (`lab/scenarios/fhsw-arnhem-coop-rec.json`).

**Corrected 2026-11-10.** The first version of this section said the lab
lives on the Linux machine and so nothing could be run. That was wrong. Both
servers run on this Mac (repo: the skill, "On a Mac"; `lab/INSTALL.md`): the
Windows one, `BF1942_w32ded.exe` 1.61 in the client's CrossOver bottle, which
is the one the owner uses because it proved more reliable, and the Linux one
in a container in the emulated x86_64 Colima VM `bf1942-lab-x86`, which
`lab.py` reaches through `lab/linux-container/lab.sh`. Measured:
`python3 lab/lab.py status` answered "no lab server running", and the
container was up. What was then run is section 13: the engine's map
generator, in a private instance beside the lab's install.

A generated patch archive in a private copy of the instance's `levels`
folder is the retail test: does the server load the maps (it logs nothing
when one fails, so compare bot movement, not the console), do bots leave
their base, does a flag change hands. The recorder's output then runs
through the same detectors as the headless trace, which also measures how
far the page's port is from the engine on a generated layer. That part has
not been run: there is no generated layer yet. Two things the section 13
test taught about doing it:

* The engine does not read an archive written by `bf42/rfa.py write_rfa`.
  It reads one that keeps the 148-byte block after the 8-byte header and the
  four trailing bytes of a game archive (measured, section 13). A writer the
  engine accepts is a prerequisite for this ring.
* The lab's install links its `archives` folders to the server's source, so
  a test that changes an archive needs an instance of its own with its own
  `levels` folder (links to the source archives plus the changed file), not
  an edit under the shared install.

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
| The engine's own search map generator, run in the lab | Works by hand for one vanilla level (section 13); no script, no archive writer the engine reads |

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
| In FHSW and FHSWEurope the levels truly without bot data are mostly 8 km naval or air ObjectiveMode | The generator derives data, not a game mode; ships, submarines and carriers are where retail bots are weakest | Settled: out of scope (owner, 2026-11-10). Section 12 ranks what is in |
| The painter under-blocks by 7 to 20 % against DICE on Bocage and El Alamein, and on Kharkov's infantry map agrees on only 74 % (it leaves free 35 % of the cells DICE blocks) | Bots may be sent through gaps the engine closes | The engine's own output is now available as the reference (section 13): diff the painter against it per level, and read the convex pass and the material rule where they disagree |
| The engine generator is proven on one vanilla level only | FH and FHSW statics lack AI meshes, and the tutorials report freezes and streaked infantry maps there; the process aborts before the strategic maps | Run it on FHSW Ramelle in a private instance with the mod linked in; find the abort |
| Flagless arenas need an invented objective | A knife or air arena with two fixed bases gives the strategic AI nothing to attack; the generator must add a meeting area the level's author never wrote | Label it as generated; judge it by play and by the detectors, not by parity |
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
published tree); the engine generator on a mod level, on a 4096 m level, on
the Windows server, or through to the strategic maps; the engine's strategic
map decomposition; a recorded bot round on any generated layer; the level
archives of bg42, FinnWars, Pirates and Interstate, which are not installed
here and have no level tree published.

## 9. First slice

Revised 2026-11-10 after the owner's priority rule and the broadened census.
The recommendation: keep Ramelle and Seelow Heights as the verifier's proving
ground, and make the first real delivery a contained on-foot level that has
no bots anywhere, the community map shigaisen_B.

### 9.1 The first delivery: shigaisen_B

Measured (section 12): a 1024 m vanilla community level, Conquest, CTF and
TDM, eight control points (six capturable) all within 222 m of each other,
23 soldier spawns, no vehicle pad at all, vanilla kits, already published in
vanilla's tree, and no bot data in any mod. It is the owner's case exactly:
on foot, contained, playable on the page today without bots.

It is also the smallest thing that can ship, because the page needs less
than retail does. The page builds its strategic AI whenever the level's `ai`
block has strategic areas (`viewer/bot-referee.js`), and paints its own
infantry map when the level ships none. So for the page the first delivery
is `AI.con`, `AI/StrategicAreas.con` and one strategy template: one area per
control point by the rule of section 4.4, neighbours from routes on the
painted map, sides and `setTakeable` from the flags. No `.raw` file, no
co-op layer, no vehicles to assign.

Done means: the generated layer passes the static checks; over ten seeds at
8 a side and 600 s on the Conquest layer every capturable flag changes hands
at least once, both sides capture, and stuck time, idle share and route
failures per bot-minute are inside the spread of the vanilla baseline; then
the owner plays it from a local viewer before anything is published. The
comparison arm is the level as it is today (the nearest-flag fallback).

Next two after it, to cover the other shapes on the shortlist before any
batch: the_dungeon (five capturable flags indoors, the nav map's hard case)
and omaturi_channel_airmini (an air arena with two fixed bases, which needs
the meeting-area rule of section 12.4 and no search map at all).

### 9.2 The proving ground: Ramelle and Seelow Heights

Two FHSW levels that both have an identical FHSWEurope twin with a community
layer, so every result has two comparison arms. They prove the verifier and
the retail-format half of the pipeline; they are not the first thing a
player gets.

1. **FHSW Ramelle_Neuville-1944** (1024 m, tank and infantry only, 8 control
   points, 1,419 objects, a town with a river and a bridge). It is the level
   FHX-19 was root-caused on, the hardest kind for the painter (streets,
   statics without AI meshes), and section 4.7 already has its two baseline
   arms. It is also the level to run the engine's generator on next
   (section 13), since FHSW's statics are the open question there.
2. **FHSW Seelow-Heights-1945** (2048 m, tank and infantry, 6 control
   points, open ground where the community map leaves 37 % of walkable
   terrain free). It exercises tank routes and long legs, where route areas
   should matter.

Scope: phases 0, 1, 2, 4, 5 version one, 6 with one template, and rings 1
and 2 with the stuck, idle, coverage and self-death detectors. No water, no
co-op layer (the page runs the bots on Conquest), no publish. Output goes to
an overlay directory and a scratch copy of the level tree through
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
| 12 | Proving ground on Ramelle and Seelow Heights (section 9.2): three-way comparison, written up here | M | 5 to 11 |
| 13 | Overlay packaging (`write_rfa`), the generated marker, a `bot_data_generated` step in `mod_pipeline.py`, the menu's experimental tag | M | 12 |
| 14 | Route, flank and choke areas (version two) with the simulator in the loop; parameter search | L | 12 |
| 15 | Co-op layer writer and the per-hull AI template and `vehicleNumber` census for FHSW | M | 1 |
| 16 | Water: `Boat` and `LandingCraft` maps, landing zones, the beach checks | L | 12 |
| 17 | Lab ring: scenario template for a generated archive, the server-side-only test (the lab runs on this Mac; section 6.3) | M | 13, 15, 21 |
| 18 | Batch over FHSW's 70 levels with a community twin: lint the twin, generate, three-way table, decide per level. Lower priority since 2026-11-10: most are open ground with vehicles | L, mostly compute | 13, 14 |
| 19 | ObjectiveMode and naval levels | Out of scope (owner, 2026-11-10) | |
| 20 | First delivery, shigaisen_B (section 9.1): areas and one strategy template through the `ai` layer on a scratch tree, the headless matrix against today's fallback, a local play test | M | 8, 9, the stuck, idle and coverage detectors of 10 |
| 21 | An archive writer the engine reads (the 148-byte header block and trailer kept; section 13), with a lab test that the server loads a file from it | S | |
| 22 | The engine generator as a script: a private lab instance, the patched `AIpathFinding.con`, collect the `.raw` files, clean up; run over the vanilla levels as a regression against the shipped maps | M | 21 |
| 23 | The engine generator on FHSW Ramelle (mod linked into a private instance) and the abort before the strategic maps: find it, or confirm the phase 4 writer is still needed | M | 22 |
| 24 | The meeting-area rule for flagless arenas and air arenas (section 12.4), tried on omaturi_channel_airmini and omaturi_channel_knife | M | 20 |
| 25 | Batch over the contained on-foot shortlist of section 12.3, then the air entries | M, mostly compute | 20, 24 |
| 26 | Commit the all-mods census as `surveys/census_bot_candidates.py`, replacing `candidates.csv`'s scratch script | S | 1 |

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

## 12. Follow-up 2026-11-10: every mod and the community maps, ranked

The owner's rule: any level without bots is a candidate; what makes bots
worth adding is on-foot and air play in a contained space; the big naval
levels are out. The per-level table behind this section is
`features/bot-map-generation/candidates.csv` (266 rows, one per level with no
bot data, ranked).

### 12.1 Census by mod (measured)

"Complete", "partial" and "none" are as in section 3. A partial level ships
an AI layer of which the engine refuses a part.

| Mod or pack | Levels | Complete | Partial | None | Where the levels were read |
|---|---|---|---|---|---|
| bf1942 (retail) | 23 | 17 | 2 | 4 | Published tree |
| Community maps (levels of vanilla's tree; `community-mappack-by-michaels/` and strasbourg) | 77 | 8 | 1 | 68 | Published tree; the pack's 78 archives read as a cross-check |
| XPack1 | 6 | 6 | 0 | 0 | Published tree, own levels only |
| XPack2 | 9 | 8 | 0 | 1 | Published tree, own levels only |
| FH 0.7 | 61 | 49 | 0 | 12 | 10 published, 51 from the install's archives |
| FHSW 0.81 | 140 | 54 | 3 | 83 | Published tree |
| FHSWEurope 0.84 | 274 | 257 | 3 | 14 | Published tree |
| Desert Combat 0.7 | 35 | 20 | 2 | 13 | Published tree |
| DC Final | 48 | 21 | 2 | 25 | Install's archives; no level tree published |
| Eve of Destruction 2.50 | 239 | 238 | 0 | 1 | Published tree |
| bf1918 3.4b | 134 | 109 | 2 | 23 | 133 from the local baked tree, 1 from the archives |
| bf1919 | 8 | 8 | 0 | 0 | Install's archives |
| Galactic Conquest | 23 | 0 | 1 | 22 | Install's archives; no level tree |
| Total | 1,077 | 795 | 16 | 266 | |

Not measured: bg42, FinnWars, Pirates and Interstate. They have rows in the
models registry (the service record's poses-only trees), no published level
tree, and are not installed on this machine.

The partial levels, beyond the six of section 3.2: the community map
attack_on_pearl_harbor (no `Tank0Level0Map.raw`, so nothing loads), Gazala
and Tobruk in vanilla, Desert Combat and DC Final (no `Car.raw`, the last
type), bf1918's fao_landing and priesterwald, and Galactic Conquest's
gc_dantooine.

The community pack's base mod: every level is vanilla's (repo:
`features/community-maps/README.md`, each `Menu/Init.con` says
`game.setMapId "bf1942"`). Its 78 archives are 77 levels (`shigaisen_A_001`
is a patch); the archive census here read them in place and found 9 with an
`AI.con`, which matches the nine the repo's note says show in Instant Battle.

Of the 266 levels with no bot data, 92 have a same-named level with complete
bot data in another mod: 71 of FHSW's 83 (70 in FHSWEurope, section 3.3,
plus Aberdeen in EoD), 10 of FH's 12, all 4 of vanilla's, 4 of DC Final's,
and one each in the community maps, FHSWEurope and bf1918.

### 12.2 What is out, and why

Classes assigned by rule from the level's own data (game types, control
points, soldier spawns, the vehicles its pads place, the distance between
its furthest control points), then checked by name for the novelty maps.

| Class | Levels | Why it is out |
|---|---|---|
| Race, sport and puzzle maps (jeep and kart races, rally, football, bowling, hurdles, parcours, stunts) | 34 | Nothing a strategic area can express: the goal is a lap, a goal line or a jump. Bots would drive at a flag and stop |
| 8 km or larger naval and air objective levels | 22 | Owner, 2026-11-10. Ships, submarines and carriers; mostly ObjectiveMode with no flags to take |
| ObjectiveMode only, smaller | 6 | No co-op game type and no capturable flag; a game mode would have to be designed |
| No soldier spawns | 5 | Nobody can deploy on foot; these are ship or vehicle-seat levels |

That is 67 of the 266. Of the rest:

| Class | Levels | By mod |
|---|---|---|
| Contained on-foot: flags within 600 m, at most eight land or air hulls | 30 | community 15, bf1918 7, FHSW 4, Desert Combat 3, FH 1 |
| Contained with vehicles: flags within 600 m, more hulls | 19 | FHSW 8, bf1918 6, community 5 |
| Air: at least half of six or more pads are aircraft | 6 | community 6 |
| Arena with fixed bases only, or no control point | 7 | community 4, Desert Combat 1, DC Final 1 (its Coral Sea, which belongs with the naval class), EoD 1 |
| Open ground or wide map: flags further apart | 89 | FHSW 56, community 9, bf1918 9, Desert Combat 8, vanilla 3, FH 2, XPack2 1, FHSWEurope 1 |
| Not exported, so the flag spread is unknown | 48 | DC Final 22, Galactic Conquest 18, FH 7, bf1918 1 |

FHSW's 83 are mostly the wrong shape for the owner's rule: 56 are open
ground with vehicles, 15 are out, and the 12 contained ones all have a
botted twin in FHSWEurope.

### 12.3 The ranked shortlist

Ranked by the owner's rule: contained on-foot first, then air, then arenas;
within a class, levels with no bot data in any mod before levels with a
twin, published before unpublished, capturable flags before fixed bases.
"Flags" is control points / capturable; "spread" is the distance between
the two furthest flags. All are 1024 m worlds unless said.

| # | Level | Mod | Flags | Spread | Soldier spawns | Pads | Playable on the page today | Why |
|---|---|---|---|---|---|---|---|---|
| 1 | shigaisen_B | community | 8 / 6 | 222 m | 23 | none | yes | Street fighting on foot, six flags to take in a 220 m block, no vehicle to assign. The first delivery (section 9.1) |
| 2 | shigaisen_C | community | 8 / 6 | 231 m | 17 | none | yes | The same shape; a second sample for the area rule |
| 3 | the_dungeon | community | 5 / 5 | 376 m | 12 | none | yes | Every flag capturable, indoors: the nav map's hard case |
| 4 | the_street, the_street_day2 | community | 7 / 5 | 221 m | 29 | 2 and 5 land hulls | yes | One street, many spawns, a couple of hulls to test boarding |
| 5 | shigaisen_A, shigaisen_D | community | 7 / 5 | 212 m, 304 m | 25, 27 | 4 and 7 land hulls, 3 guns | yes | The street set with light vehicles |
| 6 | dc_basrah_nights | Desert Combat | 5 / 5 | 192 m | 29 | 4 land hulls, 4 guns, all with an AI record | yes | The one small infantry level in Desert Combat without bots; modern kits |
| 7 | the_maze | community | 7 / 5 | 347 m | 20 | none | yes | A maze: the stuck and oscillation detectors' best test |
| 8 | the_corridor | community | 5 / 3 | 289 m | 8 | none | yes | A single lane; a degenerate neighbour graph |
| 9 | knife_championship | community | 7 / 3 | 280 m | 25 | no vehicles | yes | A knife arena that is still Conquest; needs bots that close and stab |
| 10 | omaturi_channel_sniper, _day2 | community | 3 / 1 | 209 m | 12 | none | yes | Two bases and one flag between them at sniping range |
| 11 | the_room | community (2048 m world) | 4 / 3 | 82 m | 17 | none | yes | One room; the smallest fight on the list |
| 12 | dc_lostvillage | Desert Combat (2048 m world) | 7 / 5 | 484 m | 50 | 2 aircraft, 4 guns | yes | A village on foot, no land hull, two aircraft (its DC Final sibling is named `_nopara`) |
| 13 | battle_of_the_vosges | bf1918 | 7 / 5 | 443 m | 20 | 14 land, 2 air, 21 guns | on the volume, no registry row | Trench infantry with fixed guns, which the garrison doctrine already mans |
| 14 | deulemont | bf1918 | 8 / 6 | 317 m | 13 | 2 land, 18 guns | baked locally, not on the volume | The tightest of bf1918's seven contained levels |
| 15 | omaturi_channel_airmini | community | 2 / 0 | 26 m | 24 | 16 aircraft | yes | A small dogfight arena; needs areas only, no search map (12.4) |
| 16 | air_attack | community (2048 m) | 2 / 0 | 1,358 m | 7 | 133 aircraft pads | yes | Two airfields and nothing but planes |
| 17 | tl_plane_training | community (2048 m) | 4 / 2 | 2,395 m | 21 | 22 aircraft, 22 land | yes | Air with two flags to take: the ordinary rule applies |
| 18 | bomberfight_big, bomberfight | community (4096 m) | 5 / 3, 3 / 1 | 2,576 m | 8 | 6 aircraft | yes | Bombers over capturable flags |
| 19 | operation_linebacker | Eve of Destruction (2048 m) | 3 / 0 | 1,150 m | 6 | 11 aircraft, 18 land, 20 guns | yes | The only EoD level without bots; today they stand on the carrier deck (repo: `features/bot-path-budget`) |
| 20 | omaturi_channel_knife | community | 2 / 0 | 129 m | 8 | none | yes | A pure knife pit; works only with the meeting-area rule (12.4) |
| 21 | knife_fight | community | 4 / 0 | 204 m | 8 | 12 land hulls | yes | The same, with a dozen land hulls in the pit |
| 22 | Battle_of_Edson_s_Ridge | FHSW | 5 / 3 | 199 m | 15 | 4 guns | yes | FHSW's smallest infantry level; FHSWEurope's twin is botted, so it is a three-arm level |
| 23 | Stalingrad_RedSquare | FHSW | 8 / 6 | 298 m | 16 | 7 guns | yes | Urban infantry; the twin's flags differ (8 against 4), so its layer cannot simply be copied |

Would need exporting first (the owner's call; not ranked): DC Final's
dc_bridge (1024 m, five flags, 20 soldier spawns, no pads) and Galactic
Conquest's six `gc_mini_*` levels (1024 m, four to six flags). Galactic
Conquest ships no bot data at all, so its vehicles' AI templates are the
open question there, and its pads could not be classified here.

Retail levels worth a line although they are open ground with tanks, because
they are the stock game's own gaps: Aberdeen, Liberation of Caen and
Invasion of the Philippines in vanilla (all three have a botted twin in EoD
or FH), and Raid on Agheila in the XPack2 tree (no twin).

Caveats on the columns. The pad classes come from each tree's
`_shared/vehicle-ai.json` (`class` and `types` of the template's AI record);
a pad whose template has no record is counted as "no AI record", which
includes kit and prop spawners as well as hulls a bot cannot use, so the
share is rough and worst on FHSW (its pads average more unrecorded
templates than recorded ones). "Playable on the page today" means the level
is in a published tree; it says nothing about whether it was play-tested.

### 12.4 The novelty maps, looked at honestly

* **Small arenas with capturable flags are the easiest and best case.**
  shigaisen_A to D, the_street, the_dungeon, the_corridor, the_maze,
  the_room, knife_championship and omaturi_channel_sniper are ordinary
  Conquest in a space of 80 to 380 m with no or few vehicles. The
  control-point rule of section 4.4 applies unchanged, only the infantry
  search map matters, and a round is short enough to judge in a few seeds.
* **Arenas with fixed bases only need one invented rule.**
  omaturi_channel_knife, knife_fight, omaturi_channel_tank and arena_tl (no
  control point at all) have nothing capturable. The strategic AI gives no
  attack value to an area whose control points are all uncapturable (repo:
  `features/bf1942-ai-spec/strategic.md`, "Ownership"), which is why EoD's
  Operation Linebacker bots stand on deck. The same document gives the way
  out: an area with no control point is owned by presence (ledger AI-74), so
  a generated "meeting" area in the middle of the arena, takeable by both
  sides, gives both sides somewhere to go, and they fight when they meet.
  That is the generator inventing an objective the author never wrote. It is
  cheap, it has to be labelled, and it is judged by play (inference; not
  built or run).
* **Air arenas need areas and nothing else.** Aircraft have no search map
  (`vehicleNumber` -1); a pilot is ordered to an area's middle at +75 m. On
  omaturi_channel_airmini, air_attack and omaturi_channel_air (two fixed
  bases each) the same meeting area works, and better: a bot in an
  aircraft's own seat is not counted for presence (ledger AI-127), so the
  area never changes hands and both sides are sent over it all round
  (inference). What limits the result is the bot pilots, which is the
  dogfight-school work (repo: `features/dogfight-school`), not the map data.
* **Race, sport and puzzle maps have nothing for a bot to do.** A lap, a
  goal or an obstacle course is not a place to take. Thirty-four levels.
* **Knives.** The page's bots have a melee path (`tests/test_bot_melee.py`);
  whether a kit with a knife and nothing else behaves on these maps, and
  what the maps' kits actually hold, was not checked.

### 12.5 How this section was measured

* Published trees: every row of `maps.json` for vanilla (which holds the
  community maps), XPack1, XPack2, FH, FHSW, FHSWEurope, Desert Combat and
  EoD, each level's `scene.json` and `pathfinding/index.json`, and each
  tree's `_shared/vehicle-ai.json`, read from mesh.bfstats.io on 2026-11-10.
  bf1918 from the local baked tree (133 levels; its `maps.json` is not on
  the volume and 5 of a sample of 20 of its scenes were).
* Install archives, chain-merged with the engine's load rules as in section
  11: vanilla, XPack1, XPack2, FH, Desert Combat, DC Final (over Desert
  Combat), EoD, Galactic Conquest, bf1918, bf1919 (over bf1918), FHSW, and
  the 78 archives of `community-mappack-by-michaels/`, read in place and not
  modified. For a level not in a published tree the control points, soldier
  spawns and pad templates were counted from its `Conquest/` (else first
  present) layer's con files.
* Community levels are the names in the registry's `community` row.
  XPack trees were cut to the packs' own archives.
* Twin: the same lower-case level name with complete bot data in a different
  mod.
* Flag spread: the largest distance between two control points of the
  level's default layer.

## 13. Follow-up 2026-11-10: the engine's own map generator, in the lab

The question: can the retail dedicated server produce the search maps
itself, with no debug executable? Verdict: **yes for the search maps on the
release Linux server**, measured on one vanilla level; **not yet for the
strategic maps** (the process aborts first); **probably not for the search
maps on the Windows release server** (static signs only, not run).

### 13.1 Static read

| Sign | Linux release server (`bf1942_lnxded.static`) | Windows release server (`BF1942_w32ded.exe` 1.61) | Source |
|---|---|---|---|
| Console words `createMaps`, `createAllSearchMaps`, `createAllMaps` beside `loadMaps` and `addSearchMap` | present | present | measured: strings of the binaries the lab runs |
| The search map generator's messages (`Local search map `, ` created `, `8Bit.raw`) | present | absent | measured |
| The strategic half's messages (`Strategic search map created for `, `Unable to load local map `) | present | present | measured |

The second corpus's decompile of a Linux 1.61 server (a lead, another
build's addresses; `features/bf1942-engine-reference/recorpus.py
createAllMaps`): `AIPathfinding::createAllMaps` calls `createAllSearchMaps`
then `createAllSearchTypes`. `createAllSearchMaps` runs, for each declared
map, `LocalMapInfo::update`, which is `LocalMap::loadRawFile`, then
`LocalMap::update` (the painter of ledger AI-93), then `saveRawFile` and
`save8BitRawFile`, with no condition on a debug or editor flag.
`createAllSearchTypes` is `LocalMap::loadRawFile`, `StrategicMap::update`,
`StrategicMap::save`. So the static read said it could work on Linux.

### 13.2 The live test (measured)

`python3 lab/lab.py status` said no lab server was running. The test did not
use the lab's install or the game install: it built a private instance
inside the lab folder (a copy of the server binary and of the rendered
settings on other ports, an `archives` folder of links to the server's
source archives, and its own file in place of the link for Kharkov's patch
archive), ran it with `docker exec` in the lab's Linux container, and
removed the instance afterwards. The lab's install, its source archives and
its runs were not touched.

The change to the level: in Kharkov's `AIpathFinding.con`, after
`ai.loadMaps`, the two lines the community tutorials use, `run
StaticObjects` and `ai.createAllMaps` (web, section 4.3).

| Run | Result |
|---|---|
| The patched script | The server wrote `bf1942/levels/Kharkov/Pathfinding/` under its working directory: nine search maps (`tank0`, `infantry1`, `car4`, levels 0 to 2, lower-case names) and nine `...8bit.raw` previews, in about two and a half minutes under full x86 emulation. It then aborted with `free(): invalid pointer` (exit 134). No strategic map was written |
| The same, with all-free maps for all nine files put in the patch archive first | The same nine files, byte-identical to the first run. So the output is the engine's own paint from terrain and statics, not a touch-up of what it loaded |

Against DICE's shipped Kharkov maps (level 0, 1,048,576 cells each):

| Map | Same file size as shipped | Cells that differ | Engine blocks, shipped free | Engine free, shipped blocked |
|---|---|---|---|---|
| `Tank0` | yes (57,888 bytes) | 588 (0.056 %) | 468 | 120 |
| `Infantry1` | yes (60,448) | 509 (0.049 %) | 438 | 71 |
| `Car4` | yes (51,232) | 383 (0.037 %) | 259 | 124 |

The repo's painter on the same level, for scale: `Tank0` 98.6 % agreement,
`Car4` 98.0 %, `Infantry1` 74.2 % (it leaves free 35 % of the cells DICE
blocks). The engine reproduces DICE's map to four parts in ten thousand
where the painter is off by a quarter of the infantry map.

What the test taught on the way:

* **The engine does not read an archive `bf42/rfa.py write_rfa` writes.**
  A rewrite of Kharkov's patch archive with unchanged contents, in that
  layout or in a compressed layout without the 148-byte block that follows
  the 8-byte header, made the server fall back to the base archive and stop
  with `template not found: AnimatedFlag`. The same contents rebuilt with
  the source archive's 148-byte block and its four trailing bytes kept
  loaded normally, including a changed file stored as a literal-only LZO
  stream. What the block must hold was not determined; the source's was
  copied.
* A numbered patch `kharkov_010.rfa` written by `write_rfa` had no effect in
  two runs. That is explained by the point above, so whether the server
  reads a patch number it has never seen is still open.
* The output folder had been created beforehand. Whether the server creates
  it was not tested.

### 13.3 What is still open

* The strategic maps. The abort comes after the last search map is saved.
  The decompile shows `createAllSearchMaps` building a temporary AI mesh
  loader when none exists and destroying it at the end, which is a
  candidate for the bad free (inference; not read in our binary). Routes to
  try: `ai.createMaps <n>` per type, a second start with the generated
  search maps in place, or the Windows server for the strategic half alone,
  whose messages it has.
* A mod level. FH and FHSW statics lack AI meshes, and the tutorials report
  freezes and streaked infantry maps on such levels (web, section 4.3).
  Kharkov has DICE's AI meshes. FHSW Ramelle in a private instance with the
  mod linked in (`lab.py setup` takes client mods) is the test that decides
  how much of phase 2 the engine can carry.
* The 588 cells. Whether they come from the 1.6 patch's statics, from
  running `StaticObjects` a second time, or from a hand edit by DICE was not
  looked at.
* Larger worlds, water maps, and the time on real hardware.

### 13.4 What it changes

* **Phase 2 has a reference and, for retail output, a better source.** For
  any level the lab can load, the engine's own search maps are obtainable
  with a script and no debug executable. The painter is no longer the only
  way to make them, and it can now be scored against the engine on every
  level instead of against whatever a mapper shipped.
* **The painter has a measured gap to close.** Kharkov's infantry map says
  the painter's flood or slope pass differs from the engine's in a way
  Bocage and El Alamein did not show.
* **Phase 4 is unchanged for now.** Until the strategic half runs, the
  strategic map writer is still needed, and the regenerate-DICE test still
  decides whether it is right.
* **The page's first delivery does not depend on any of this.** shigaisen_B
  needs strategic areas and the painted map the page already uses
  (section 9.1).

## 14. Phase A, 2026-11-10: the generator, the verifier, and shigaisen_B

(Correction, section 19: the community levels' figures in sections 14 to
18 were measured with bots holding a stand-in weapon, and every match in
them under the engine's SAI doctrine, not the page's garrison. 19.1, 19.2.)

The owner's go: generate bots for the candidates, starting with the plan of
section 9.1, with the first map tested thoroughly before any rollout. This
section is what was built and what the test found. The short version: the
generated layer turns a level where bots barely function into one where both
sides fight and take flags, and it still fails four of the twelve checks
against DICE's own layers, for reasons that are in the map the page paints
and in the level, not in the layer.

### 14.1 What is built

| File (under `tools/bf1942-models/`) | What |
|---|---|
| `sim/botgen.mjs` | The generator, version 1, for levels played on foot. One area per control point, sides and `setTakeable` from the flags, order positions on free cells, neighbours from routes on the painted infantry map, the strategy template's files. Deterministic; `--check` exits 1 when the folder is stale |
| `bot-layers/_templates/symmetric/` | The strategy template: DICE's Kharkov `Strategies.con`, `conditions.con` and `prerequisites.con`, unchanged, and `template.json` (source, and each side's list in Kharkov's order) |
| `bot-layers/bf1942/shigaisen_b/` | The generated layer as source: `AI.con`, `AI/StrategicAreas.con`, the three template files, `generated.json` |
| `bf42/ai_level.py` (`load_generated_ai`, `generated_layer_dir`, `LevelAi.generated`), `scene_layers.py` (`layer_ai`) | The bake's hook |
| `sim/botlint.mjs` | The static lint |
| `sim/detect.mjs` | The detectors over a runner trace |
| `sim/judge.mjs`, `sim/baselines/onfoot-dice.json` | The judge and the baseline it scores against |
| `sim/botbatch.mjs` | The one entry point: `baseline`, `matrix`, `level` |
| `viewer/nav-map.js` (`carveDoors`) | Doorways on the soldier's painted map (14.5) |
| `viewer/play/skirmish.js`, `viewer/play/menu-screen.js`, `extract_menu_layout.py` | Instant Battle starts a generated level with bots and tags it EXPERIMENTAL BOTS |
| `tests/test_bot_layer.py`, `tests/bot_layer_harness.mjs` | 23 tests: the area rule, the script, the bake hook, the lint, the detectors, the judge, the doorways, the tag |

### 14.2 Design decisions

* **Where a generated layer lives: `tools/bf1942-models/bot-layers/<mod
  folder, lower case>/<level, lower case>/`, tracked.** The repo has no
  per-level override folder to follow (its one override table is code,
  `bf42/cockpit_overrides.py`), and a bake's only other input is the
  install's archives, which are never modified. A tracked folder beside the
  tools is the one place a re-bake on any machine can read. The files are
  retail-format text, so the same folder is what a later archive writer
  would pack for the real server. A community level sits under `bf1942/`
  because that is the mod folder whose tree holds it.
* **How a bake finds it.** `layer_ai` asks `load_level_ai` first. Only when
  the level's own archives carry no `AI.con` does it call
  `load_generated_ai(ctx.mod, ctx.level)`, which reads the folder through
  the same parsers. A level that ships a layer is never overridden; a test
  pins both halves. `patch_scene.py --layer ai` and a full level pass
  therefore both reproduce the layer. Measured on a scratch tree: the patch
  changed `ai` and nothing else, in 0.2 s, cover values included.
* **The marker.** `scene.json` `ai.generated`: the generator's name and
  version, the template, the scope ("on foot: infantry order positions only,
  no search maps, no co-op layer"), the SHA-256 of the control points, of
  the painted infantry map and of the template it read, and of each file it
  wrote. A shipped layer has no such key. A test fails if a file under
  `bot-layers/` no longer matches its marker, so a hand edit is caught.
* **No `AIpathFinding.con`.** The page paints its own infantry map when a
  level declares none, and with no declared map the bake writes no
  `pathfinding/` folder. Search maps and the co-op layer stay out of scope.
* **The page.** `extract_menu_layout.py` adds `generatedBots: true` to a
  level's row in `menu-levels.json` when it ships no single-player scripts
  and a generated layer exists. `skirmish.js` then sends the level's bot
  count instead of 0 (the mode stays Conquest), and the row's tag reads
  EXPERIMENTAL BOTS instead of NO BOTS, the 2026-10-12 agreement
  (`features/fh-fhsw-open-issues/README.md`, "Parked"). `map.html` needed
  no change: the referee builds the strategic AI whenever `ai` has areas.
* **The template is Kharkov's, after Stalingrad's failed.** Both are DICE
  levels of the matching shape (each side starts with a fixed base and
  ground of its own). Stalingrad's set was tried first: its defensive
  strategies are gated on a `createHomogenousCondition` (`weakCond`), which
  `bf42/ai_level.py` does not parse, so the page's port sees the gate gone,
  picks `holdCentre` (aggression 0) at the first pass, and the side never
  attacks. Measured: ten seeds of the Stalingrad set on shigaisen_B took no
  flag at all at 8 a side. Stalingrad itself shows the same on the page (one
  capture a round in the baseline, a third of its flags ever changing
  hands). That is a reader gap, recorded in 14.7, not a reason to edit a
  template: Kharkov's conditions are all of the kind the reader parses.

### 14.3 Commands

From `tools/bf1942-models`. `<maps>` is a maps tree holding the baked level,
`<models>` the models tree beside it.

```bash
# generate (or --check), apply through the bake, lint
node sim/botgen.mjs --map shigaisen_b --mod bf1942 --maps <maps> --models <models>
python3 patch_scene.py --layer ai --mod bf1942 --tree <maps> shigaisen_b
node sim/botlint.mjs --map shigaisen_b --maps <maps> --models <models> --source bot-layers/bf1942/shigaisen_b

# the batch entry point
node sim/botbatch.mjs baseline --maps <maps> --models <models> --levels berlin,stalingrad,kharkov,bocage
node sim/botbatch.mjs matrix   --maps <maps> --models <models> --levels shigaisen_b      # the tree as it is
node sim/botbatch.mjs level    --maps <maps> --models <models> --mod bf1942 --levels shigaisen_b
node sim/botbatch.mjs level    --maps <maps> --models <models> --candidates ../../features/bot-map-generation/candidates.csv
```

`level` generates, applies with `patch_scene.py --layer ai`, lints, runs the
seeded matrix (seeds 1 to 10, 8 and 16 a side, 600 s, on foot), detects,
judges and writes `<out>/<level>/verdict.json`. With `--candidates` it takes
every published row of the class "contained on-foot" whose level is in the
tree. The batch was not run. `patch_scene.py` needs the level's archive in
the game folder it is pointed at; a community level whose archive is not in
the install needs `--game-dir` on a folder that links it in.

### 14.4 The bar: DICE's layers, run the same way

`sim/baselines/onfoot-dice.json`: Berlin, Stalingrad, Kharkov and Bocage
with their shipped layers and baked maps, seeds 1 to 10, 600 s,
`--no-vehicles`, 8 and 16 a side, 80 matches. The judge's rule was fixed in
`sim/judge.mjs` before shigaisen_B was scored: a rate's median over the
seeds must be no worse than the baseline's 90th percentile, the captures'
median no lower than its 10th, the share of capturable flags that ever
change hands no lower than the weakest baseline level's, each side must
capture in at least one seed, both must lose tickets in every seed, and no
bot may throw.

| Detector | 8 a side: p10 / median / p90 | 16 a side: p10 / median / p90 |
|---|---|---|
| Stuck seconds per bot-minute (MoveTo, throttle on, under 2 m in 10 s) | 0.33 / 0.93 / 1.97 | 0.21 / 0.90 / 2.19 |
| Idle share (Idle or Scout with no target) | 0.16 / 0.36 / 0.54 | 0.39 / 0.55 / 0.72 |
| Order flips A, B, A within 60 s, per bot-minute | 0.09 / 0.25 / 0.50 | 0.05 / 0.12 / 0.35 |
| Self-inflicted deaths per bot-minute | 0 / 0 / 0 | 0 / 0 / 0 |
| Spawn traps per bot-minute (dead or stuck within 10 s and 15 m of a spawn) | 0.01 / 0.07 / 0.14 | 0.00 / 0.03 / 0.08 |
| Route failures per bot-minute | 0 / 0.00 / 0.38 | 0.01 / 0.09 / 2.10 |
| No-progress redeploys per bot-minute | 0.03 / 0.10 / 0.19 | 0.02 / 0.07 / 0.14 |
| Captures a match | 1 / 4 / 8.1 | 0.9 / 3 / 8 |
| Flags that ever change hands, weakest level | 0.33 (Stalingrad) | 0.33 (Stalingrad) |

DICE's own layers are not clean on the page: Stalingrad's two city flags
never change hands in twenty rounds, Berlin's Axis wins all ten rounds at 16
a side, and half the bots are idle at 16 a side. That is the bar, as agreed.

### 14.5 shigaisen_B, ten seeds, 600 s, Conquest, on foot

Medians over the ten seeds, with the lowest and highest seed. "Today" is the
published level (no AI layer: the painted map and the nearest-flag fallback);
"generated" is the same level with the layer applied through the bake. Both
arms ran on the same viewer, doorways included.

**8 a side**

| Check | Today | Generated | Bar | Generated passes |
|---|---|---|---|---|
| Captures a match | 2 (1 to 3) | 3 (1 to 7) | at least 1 | yes |
| Captures by side, summed over the seeds | Axis 1, Allies 19 | Axis 7, Allies 22 | each side at least once | yes |
| Capturable flags that ever changed hands | 1 of 6 | 4 of 6 | at least a third | yes |
| Time to first capture, median of the seeds with one | 167 s | 170 s | (not judged) | |
| Stuck seconds per bot-minute | 11.96 (8.9 to 17.5) | 7.85 (6.5 to 10.4) | at most 1.97 | **no** |
| Idle share | 0.02 | 0.35 (0.29 to 0.43) | at most 0.54 | yes |
| Route failures per bot-minute | 15.1 (7.6 to 20.7) | 2.78 (1.5 to 3.1) | at most 0.38 | **no** |
| Redeploys per bot-minute | 0.87 | 0.57 (0.47 to 0.67) | at most 0.19 | **no** |
| Spawn traps per bot-minute | 0.42 | 0.25 (0.19 to 0.36) | at most 0.14 | **no** |
| Self-inflicted deaths | 0 | 0 | 0 | yes |
| Order flips per bot-minute | 0 | 0.39 | at most 0.50 | yes |
| Both sides lose tickets in every seed, no bot error | yes | yes | | yes |
| Winner by seed | Axis 10 of 10 | Allies 10 of 10 | (reported) | |

**16 a side**

| Check | Today | Generated | Bar | Generated passes |
|---|---|---|---|---|
| Captures a match | 2 (0 to 4) | 1.5 (1 to 4) | at least 0.9 | yes |
| Captures by side, summed over the seeds | Axis 0, Allies 21 | Axis 9, Allies 11 | each side at least once | yes |
| Capturable flags that ever changed hands | 1 of 6 | 4 of 6 | at least a third | yes |
| Time to first capture, median | 130 s | 136 s | (not judged) | |
| Stuck seconds per bot-minute | 14.01 (10.4 to 16.0) | 5.64 (4.3 to 6.9) | at most 2.19 | **no** |
| Idle share | 0.02 | 0.47 (0.37 to 0.57) | at most 0.72 | yes |
| Route failures per bot-minute | 15.2 (8.8 to 22.6) | 2.47 (1.4 to 4.4) | at most 2.10 | **no** |
| Redeploys per bot-minute | 0.92 | 0.41 (0.31 to 0.51) | at most 0.14 | **no** |
| Spawn traps per bot-minute | 0.46 | 0.15 (0.08 to 0.21) | at most 0.08 | **no** |
| Self-inflicted deaths | 0 | 0 | 0 | yes |
| Order flips per bot-minute | 0.05 | 0.16 | at most 0.35 | yes |
| Both sides lose tickets in every seed, no bot error | yes | yes | | yes |
| Winner by seed | Axis 10 of 10 | Allies 7, Axis 3 | (reported) | |

Flags that never changed hands in any seed, generated arm: minka_northeast
and windmill_west at both sizes. Close to never: centerBridge_east (9 of 10
seeds at both sizes). Today's arm: every flag but centerBridge_east.

The static lint on the generated layer: 2 errors, both windmill_west (the
flag is 17.1 m above the ground a soldier stands on, with a 5 m radius, and
the only free cells near it are a sealed pocket of two), and one warning
that matters: 12 of 23 soldier spawns stand off the main walkable ground.

**Verdict: fail at both side sizes, on stuck time, spawn traps, route
failures and redeploys.** No threshold was moved. The layer is not rolled
out on this evidence.

### 14.6 What the bots actually do, and why it fails

Route heat, 4 m cells, ten rounds summed: of the 1,061 cells of walkable
ground, today's bots never enter 74 % (8 a side) and spend 34 % of their
time on cells with no walkable ground at all; the generated layer's never
enter 58 % (48 % at 16 a side) and spend 15 to 18 % off it. Today one cell
by the centre bridge holds 16 % of all bot time; with the layer no cell
holds more than 4 %. The lanes never used are the two bases' back areas and
the ground behind minka_northeast and southBridge_east.

The recurring stuck places, generated arm (bot-seconds over ten rounds, 8
and 16 a side), and what stands there:

| Place (x, z) | Bot-seconds | What is there |
|---|---|---|
| 740, -344 and 728, -340 | 817 + 433, 1,366 + 946 | `barack_m1`: AlliedBase_Spawn5 (742, -347) is on the barracks' floor, 0.9 m above the ground; the painter stamps the whole building |
| 664, -324 | 806, 998 | `barack_m1` again, 6 m from centerBridge_east: its spawn 1 (670, -329) is inside |
| 732, -300 and 740, -300 | 447, 672 + 408 | Near the Allied base; its spawns 2 to 4 are on raised floors with no free cell within 3 m (inference: the place itself was not looked at) |
| 616, -336 and 616, -340 | 447 + 351 | The windmill: spawn 2 of its flag is on top at y 144, spawn 3 in a sealed pocket at its foot |
| 524, -284, 576, -284, 592, -284 | 496, 467, 400 | West side, by minka_south (580, -280); not looked at |

Three causes, none of them in the layer:

1. **Spawns inside buildings the painted map blocks.** Six spawns stand on
   raised floors (y 127.9 to 128.1 over ground at 127.0) inside `barack_m1`
   and similar, with no free cell within 3 m; five more are in pockets of 2
   to 17 cells. A bot spawned there has no route, pushes at a wall and is
   redeployed 12 s later, often to the same kind of spawn. This is stuck
   time, spawn traps, route failures and redeploys at once. The engine
   treats these floors as ground because its rays find the object's top and
   its AI meshes keep the doors (ledger AI-93); the painter has neither. A
   rule that freed low level faces was tried and reverted the same hour: it
   also frees the top of a one-metre sandbag wall, which `test_nav_grid.py`
   rightly refused.
2. **Flags with a 5 m capture radius.** Seven of the eight control points
   have a 5 m radius. A bot's order is "arrived" within 6 m of its point
   (`R = max(5, ...)` plus the 1 m path radius, ledger AI-70), so it can
   stop a metre outside the ring and scout there. Measured on one traced
   round: the median distance from an idle bot to its order point was 4.6
   to 6.8 m per area. This caps captures and is why centerBridge_east (the
   one 8 m flag today's bots take) is the only flag today's arm ever moves.
   It is the bots' rule, not the layer's, and DICE's levels do not show it
   because their flags are wider, so it was left alone as instructed.
3. **windmill_west cannot be taken on foot.** The flag is on top of the
   windmill. It starts Axis-owned and stays so in every round of both arms.

So the layer does its part (orders to real flags, both sides attacking, a
fight where there was a pile-up) and the level still fails on movement. The
detectors separated the arms cleanly and named the places, which is what
they are for.

### 14.7 Fixed, tried and found on the way

* **Doorways on the soldier's painted map** (`viewer/nav-map.js
  carveDoors`, INVENTION, labelled in the code). A one-metre cell is stamped
  when any collision face crosses the soldier's band inside it, so a door
  narrower than two cells is closed by its own jambs before the brush runs.
  The supply hut holding southBridge_east has a 1.25 m door and was a sealed
  room: the flag was cut off and the generator gave it no neighbour. The
  painter now keeps a quarter-cell mask of where the band's geometry lies in
  each stamped cell; a cell is a doorway when a clear strip at least 0.75 m
  wide crosses it (alone or with the stamped cell beside it), has geometry
  on both sides of the strip, and leads to free ground or another doorway on
  both ends. Only the infantry map (brush up to 1.5); a hull's map and a
  water map are untouched, and a level with a baked map never reaches the
  code. After it southBridge_east is reachable and has four neighbours. Two
  wrong versions were caught by `test_nav_grid.py` and `test_bot_ai.py`
  before anything was measured on them: one opened the cells beside any
  wall, one read the quarter-rows in the wrong order.
* **The strategy template** moved from Stalingrad's set to Kharkov's (14.2).
* **Tried and removed: rescaling the template's flag counts.** Kharkov's
  conditions count control points held (`Friendly ControlPoint 3`), so a
  rule rescaled them to the level's flag count. The page counts flags held
  plus owned areas flagged `ControlPoint`, so Kharkov's own start already
  satisfies `finalPush` there and the rescaled values changed nothing; the
  rule was deleted and the template is used unchanged.
* **Found, not fixed:** `bf42/ai_level.py` does not parse
  `aiStrategy.createHomogenousCondition`, so a prerequisite that names one
  loses that gate on the page. Stalingrad and any level using the same
  pattern are affected today. The lint treats such a name as defined when it
  is given the layer's source.
* **Found, not fixed:** the in-browser audit (`audit_behaviour.mjs`) reads
  `viewer/maps/maps.json` from the real tree, which this machine's checkout
  does not hold, so it could not be pointed at the scratch tree. A headless
  page was driven by hand instead (14.8).

### 14.8 Regression proof and the in-page check

* **Shipped layers are untouched.** The same seeded match on HEAD's viewer
  and on the working tree, 8 a side, 300 s, seed 3, every third tick traced,
  vehicles on: Bocage, Kharkov and El Alamein give the same trace SHA-256
  (`455a8c43...`, `777842fc...`, `2cb9a704...`) and the same summary
  metrics. A level with a baked map returns before the painter's object pass,
  so the doorway code cannot run for it.
* **In the page.** `serve_viewer.py` on a scratch viewer folder (below),
  headless Chromium, `map.html?map=shigaisen_B&mode=Conquest&botCount=16`:
  the page reported 8 strategic areas and `generated: botgen`, 16 bots, all
  16 moved more than 2 m in 45 s (MoveTo 10, Fire 3, Scout 2, Idle 1), no
  page error. Three 404s: `assets.json`, `pathfinding/index.json` (the level
  has no baked maps, as intended) and `models/weapon.glb`.

* **The repo's verification.** `./scripts/verify.sh --skip-e2e` (nothing
  under `ui/` or `api/` changed): 4,026 tests, OK, 136 skipped. The first
  run failed one test, `test_select_model_tests`: the new test file scans
  `bot-layers/` and had no `# watches:` line. It has one now.

### 14.9 Playing it locally

Nothing was written into `viewer/maps` or `viewer/models`. The patched level
lives in a scratch tree, and a scratch viewer folder links the real viewer's
files with its own `maps/` (the real `_shared` and `mods`, the scratch
`shigaisen_b`, and a current `maps.json`, because the remote cache's copy
predates the community levels and the page falls back to its first level
without the row).

```bash
cd tools/bf1942-models
python3 serve_viewer.py 5291 <scratch>/viewer-scratch
# then open
http://localhost:5291/map.html?map=shigaisen_B&mode=Conquest&botCount=16&botSkill=0.75&team=1&mute
```

`team=2` plays the Allies. To rebuild the scratch level from the tracked
source: fetch the published level into a scratch maps tree, then
`python3 patch_scene.py --layer ai --mod bf1942 --game-dir <a game folder
that links community-mappack-by-michaels/shigaisen_B.rfa into its levels>
--tree <scratch maps> shigaisen_b`.

### 14.10 Open, in the order that would move the result

1. Floors and interiors on the painted map: read `aiMeshes.rfa` for the
   statics that have one (the engine's own answer for `barack_m1`), or take
   the engine's generated maps of section 13 once an archive writer the
   engine reads exists. This is what stands between shigaisen_B and the bar,
   and it stands in front of every level on the shortlist that places the
   same vanilla buildings.
2. The 6 m arrival against a 5 m flag: a bots change, to be argued from the
   engine's own behaviour on a small-radius flag in the lab, not from this
   level.
3. A generator rule for a flag that cannot be reached on foot (windmill_west):
   today it gets an area with no neighbour and the lint reports it.
4. The `createHomogenousCondition` reader gap.
5. `audit_behaviour.mjs` against a tree other than the checkout's.
6. Phase B (the batch over the shortlist) should wait for item 1: the other
   contained levels place the same buildings, and the verdict would be the
   same four detectors.

## 15. Phase A2, 2026-11-10: the three causes fixed, the judge widened

The owner's goal for the session: add bots for maps without them, with tools
that verify the bots are good enough for a single-player game. Section 14
ended on a failed gate with three named causes. This section is what fixed
each, what the judge measures now, and where shigaisen_B stands. Section
14's tables are the "before"; nothing in them was re-scored.

### 15.1 What fixed each cause

| Cause (14.6) | Fix | Evidence |
|---|---|---|
| Spawns and interiors blocked on the painted map | The engine's own search maps for the level, from the lab's Linux server (`engine_search_maps.py`), kept in the layer and declared by a generated `AIpathFinding.con` | On the painted map 12 of 23 soldier spawns stood off the main walkable ground and two flags were off it. On the engine's map 22 are on it, one is within 3 m, none is off, and every flag is on it or (the windmill) beside it. Stuck time fell from 7.85 to 1.83 seconds a bot-minute at 8 a side |
| A bot stops outside a 5 m capture ring | In the bot code (`viewer/strategic-ai.js _captureRing`, `bot-decision.js`, `control-point-law.js captureStandRadius`): a soldier ordered to a flag narrower than the order's arrival distance, which their side does not hold, is sent to the flag itself and has arrived only inside the ring less a metre. Labelled INVENTION. On foot only; a pole more than about 3 m off the ground keeps the engine's order; after two route failures running a bot hands that ring back | Unit tests in `test_strategic.py` and `test_bot_ai.py`. Flags that ever change hands on shigaisen_B: 4 of 5 reachable, against 1 of 6 with no layer |
| windmill_west cannot be taken on foot | The generator marks a capturable flag whose pole is further above the ground a soldier stands on than its radius reaches: its area is kept (so the flag stays bound to it), carries no flag, no neighbour and no order position, and `setTakeable` 0 for both sides. The marker lists it, the lint says "unreachable on foot, excluded", the judge reports it apart and leaves it out of the coverage count. Bots are also kept off spawn points with no free ground within 3 m or more than 8 m above the ground (`ai.generated.botSpawnsExcluded`, honoured in `viewer/spawn-flags.js pickSpawn` for bots only; a player's list is untouched): here the spawn on top of the windmill | Lint: 0 errors. No bot respawned above 140 m in the traced round |

What the ring fix did to shipped layers (seeded traces, 8 a side, 300 s, seed
3, with vehicles and on foot): Bocage, Kharkov, Berlin and El Alamein are
byte-identical before and after. Stalingrad changed (its Railroads flag is
first taken at 64 s where it was 180 s), so the baseline was rebuilt with the
fix in place. Its bars moved little: stuck seconds p90 1.97 to 2.06 at 8 a
side and 2.19 to 1.99 at 16; redeploys p90 0.192 to 0.198 and 0.136 to 0.129;
captures and flag coverage per level unchanged.

### 15.2 The engine's maps as a step

```bash
python3 engine_search_maps.py --mod bf1942 --archive ../../community-mappack-by-michaels/shigaisen_B.rfa
```

It builds a private instance in the lab folder (links to the server's
archives, its own rebuilt copy of the level archive), starts the level in
co-op with a script layer made for the run (the level's Conquest script as
`Coop.con`, a minimal `AI.con`, an `AIpathFinding.con` declaring `Tank0` and
`Infantry1`, seeding the flood with the level's soldier spawns and calling
`ai.createAllMaps` after `run StaticObjects`), collects the maps and removes
the instance. The source archive is read, never written. Measured on
shigaisen_B: two minutes, six files, 48,960 bytes (level 0 of each map is
13,856 bytes; the page reads only those two, 27.7 KB a level). The archive
writer keeps the source's 148-byte block and trailer and stores added files
as literal-only LZO; it worked first time on a community archive.

Limits, stated: all three pyramid levels are stored, because the bake's
loader applies the engine's rule that a map with a level missing does not
load; the server aborts before the strategic maps, so the page plans on its
own coarse layer over the baked map; the lab's server source holds vanilla
and the two expansion packs only, so a mod level needs the mod's archives
linked into the instance first (not done); a level's numbered patch
archives are not merged into the run.

### 15.3 What the judge measures now

Added after the coordinator's review, each with its bar from the same DICE
runs:

| Check | Rule | DICE, 8 a side | DICE, 16 a side |
|---|---|---|---|
| Team kills per bot-minute | at most the 90th percentile | 0.061 | 0.040 |
| Enemy kills per bot-minute | at least the 10th percentile | 0.30 | 0.17 |
| Each side kills an enemy in every seed | must hold | | |
| Balance | reported per size; a level where one side wins every seed at every size is flagged, not failed (Berlin's Axis wins ten of ten at 16 a side in the baseline) | | |
| Unreachable flags | listed apart, out of the coverage denominator | | |

Two detector definitions were corrected, for the baseline and the level
alike, and the baseline rebuilt each time. An order flip (A, B, A within
60 s) is now keyed on the flag the order's point is at, so the walk into a
narrow ring and the area order on the same flag are one objective; and a
bot's history starts again with each life, so dying on the way to A,
standing up at B and going back to A is not a change of mind. The first
version counted both and scored shigaisen_B at 0.70 flips a bot-minute; a
traced round showed 53 flips of which the most common were an attacker's
objective and the area the bot had just respawned in.

The stand-in for a person (a scripted soldier holding still in a contested
ring, noticed and shot within a bounded time) was not built: the runner has
no non-bot soldier, and adding one is real work in `sim/match.mjs`. Open.

### 15.4 shigaisen_B now

Ten seeds, 600 s, Conquest, on foot; medians, with the lowest and highest
seed for the generated arm. "No layer" is the published level on the same
viewer (ring fix included).

**8 a side: every check passes.**

| Check | No layer | Generated | Bar |
|---|---|---|---|
| Captures a match | 2 | 3 (0 to 6) | at least 1 |
| Captures by side over the seeds | Axis 3, Allies 18 | Axis 10, Allies 15 | each side |
| Reachable flags that ever changed hands | | 4 of 5 | at least a third |
| Stuck seconds per bot-minute | 12.97 | 1.83 (0.72 to 2.95) | at most 2.06 |
| Route failures per bot-minute | 12.80 | 0.34 (0 to 1.32) | at most 0.38 |
| Redeploys per bot-minute | 0.87 | 0.158 (0.07 to 0.21) | at most 0.198 |
| Spawn traps per bot-minute | 0.41 | 0.108 | at most 0.143 |
| Idle share | 0.02 | 0.31 | at most 0.53 |
| Order flips per bot-minute | 0.06 | 0.006 | at most 0.32 |
| Team kills per bot-minute | 0.052 | 0.051 | at most 0.061 |
| Enemy kills per bot-minute | 1.00 | 1.09 | at least 0.30 |
| Each side kills in every seed, both lose tickets, no bot error | | yes | |
| Winner by seed | Axis 9, Allies 1 | Allies 10 | flagged |

**16 a side: one check fails.**

| Check | No layer | Generated | Bar |
|---|---|---|---|
| Captures a match | 2 | 2 (0 to 8) | at least 1 |
| Captures by side over the seeds | Axis 2, Allies 19 | Axis 11, Allies 18 | each side |
| Reachable flags that ever changed hands | | 4 of 5 | at least a third |
| Stuck seconds per bot-minute | 14.74 | 1.78 (1.06 to 3.47) | at most 1.99 |
| Route failures per bot-minute | 16.20 | 0.65 | at most 2.10 |
| Redeploys per bot-minute | 0.97 | **0.1298** (0.065 to 0.21) | at most 0.129 |
| Spawn traps per bot-minute | 0.49 | 0.068 | at most 0.079 |
| Idle share | 0.01 | 0.41 | at most 0.72 |
| Order flips per bot-minute | 0.08 | 0.007 | at most 0.38 |
| Team kills per bot-minute | 0.105 | 0.030 | at most 0.040 |
| Enemy kills per bot-minute | 1.11 | 0.61 | at least 0.17 |
| Each side kills in every seed, both lose tickets, no bot error | | yes | |
| Winner by seed | Axis 10 | Allies 10 | flagged |

**Verdict: fail, by 0.0008 redeploys a bot-minute at 16 a side. Outcome
class: better than nothing** (all four movement rates down by more than a
quarter at both sizes, captures no lower). No threshold was moved. The
layer's `verdict.json` says so, and the bake's gate (15.5) does not read it.

What is left is the level's, named:

* **Two flags sit inside huts.** The busiest stuck place at 16 a side is
  684, -288 to -292 (1,373 bot-seconds over ten rounds): the supply hut that
  holds southBridge_east, whose door is 1.25 m wide. The next are 624, -348
  and 716, -372 (by minka_northeast, which no side takes in any seed). A bot
  ordered into the ring has to thread the door; those that miss it are the
  redeploys.
* **Why the Allies win every round with the layer** (1d): not kills (456 to
  384 over ten rounds at 8 a side) and not the layer's sides, which are
  symmetric at the start (each side's flags are worth 103, so both bleed).
  The attack target Kharkov's `finalPush` picks is the enemy's `Close` flag.
  For the Allies that is minka_south, in the open, taken in 8 seeds of 10;
  for the Axis it is southBridge_east, inside the hut, taken in 5 or 6. The
  side whose target is in the open stops its own bleed first. With no layer
  the Axis wins nine or ten of ten instead, because four of the Allied
  base's five spawns are on a barracks floor the painted map blocks.
* A variant that sent bots standing at the windmill to an order position at
  its foot was run and dropped: stuck time rose from 1.83 to 2.39 at 8 a
  side and captures fell from 3 to 1.

### 15.5 The guard

`sim/botbatch.mjs level` writes `verdict.json` into the layer's folder
(verdict, outcome, the failing checks per size, the winners' split, the
unreachable flags, the generator version and input hashes).
`bf42/ai_level.py generated_layer_gate` lets a bake read a layer only when
that verdict is `pass`, or the file carries `"accepted": {"reason": "..."}`
with a non-empty reason. A layer with no verdict or a failing one is left
alone and the bake prints why. `BOT_LAYERS_UNVERIFIED=1` lets a scratch tree
take the layer for the run that judges it, and `BOT_LAYERS_OFF=1` forces the
no-layer arm; the batch sets both itself. A test covers each case. So
shigaisen_B's layer sits in the repo and no `patch_scene.py --layer ai` on a
real tree picks it up.

To take it live after a decision to accept it as it is (publishing is the
coordinator's): add an `accepted` reason to
`bot-layers/bf1942/shigaisen_b/verdict.json`, then from
`tools/bf1942-models`, with a game folder that holds the level's archive:

```bash
python3 patch_scene.py --layer ai --mod bf1942 --game-dir <game folder> shigaisen_b
python3 extract_menu_layout.py --game-dir <game folder>       # the EXPERIMENTAL BOTS row
```

### 15.6 Loose ends from phase A

* **`carveDoors` on painted maps.** The first proof used levels with baked
  maps, where it never runs. On three levels that play on a painted map
  (five seeds, the version of 14.7 against the commit before it):
  attack_on_pearl_harbor identical; dc_basrah_nights no clear change;
  FHSW's battle_of_edson_s_ridge slightly worse (median route failures 1 to
  12), because all seven cells it opened there were notches in solid
  blocks, not doors. The rule was tightened: the ground on both sides of a
  doorway must be ground the brush leaves free. Re-measured over ten seeds
  on Edson's Ridge and Basrah Nights against the commit before any doorway
  code: captures, deaths, route failures and redeploys are identical, median
  for median. The synthetic door test still passes. Whether the tightened
  rule still opens the real door it was written for was not re-checked: with
  the engine's map shigaisen_B no longer uses the painted one.
* **Instant Battle end to end.** With vanilla's menu rows regenerated into a
  scratch copy of the viewer, a headless page was driven with real clicks:
  the shigaisen_B row reads EXPERIMENTAL BOTS, and START requests
  `map.html?map=shigaisen_B&team=2&mode=Conquest&botCount=16&botSkill=0.75`.
  The navigation was intercepted there, so the level was not loaded from
  that click. That run predates the gate: `extract_menu_layout.py` now asks
  the bake's own gate (`generated_layer_live`), so with a failing verdict
  the row reads NO BOTS until the layer passes or is accepted.
* **`audit_behaviour.mjs`** has a `--viewer-dir` option (default unchanged),
  with tests. Against the scratch viewer, `--only bots,flags,spawns
  --bots-seconds 60`: 0 findings at every severity over 8 flags, 23 spawns
  and 8 bots. It ran on the phase A layer, before the engine's maps.

### 15.7 The batch: not run

The condition was that shigaisen_B passes. It does not, by a hair, so the
batch was not started. It is one command when it is wanted, with a scratch
maps tree holding the fetched levels and a game folder linking their
archives:

```bash
node sim/botbatch.mjs level --maps <scratch maps> --models <models> --mod bf1942 \
     --game-dir <game folder> --archives ../../community-mappack-by-michaels \
     --candidates ../../features/bot-map-generation/candidates.csv --out <out>
```

Per level it runs the no-layer arm, the engine's maps (about two minutes),
the generator, the bake's `ai` layer on the scratch tree, the lint, the
seeded matrix and the judge, and writes the three-way outcome (`pass`,
`better-than-nothing`, `no-better-than-nothing`) to `<out>` and the layer's
own `verdict.json`. About 13 minutes a level on this machine. Twenty
community levels (15 contained on-foot, 5 contained with vehicles) are
fetched and linked in the scratch tree, ready. Not built: the meeting-area
rule for flagless and air arenas, and engine maps for a mod's levels.

### 15.8 Open

1. The 16 a side redeploy margin on shigaisen_B: bots threading a 1.25 m hut
   door. A bot-movement question (how the page's soldier takes a doorway),
   to be argued on a DICE level with a door, not from this one.
2. The stand-in for a person in the runner (15.3).
3. Engine maps for mod levels; the strategic maps; numbered patch archives.
4. The meeting-area rule; the batch.
5. `createHomogenousCondition` in the reader (14.7).

## 16. Phase B, 2026-11-10: why the other levels had no fight

Section 15 left one level judged and nineteen fetched. The coordinator ran
three of them and all three were dead: no kill, no capture, no ticket lost,
with the layer and without. This section is the census that says why, the
generic causes fixed, and the verdict on every level that could be judged.
Six of the twenty were; fourteen are classed out before a match is run, each
with its reason. Nothing was accepted and nothing published.

### 16.1 The census

```bash
node sim/botbatch.mjs census --maps <scratch maps> --models <models> --mod bf1942 \
     --game-dir <game folder> --archives ../../community-mappack-by-michaels \
     --levels a,b,c --out <out>
```

Per level: the engine's maps if the layer has none (one level at a time, the
lab's server is shared), the generator, the bake's `ai` layer on the scratch
tree, the lint, and one match of 300 s at 8 a side, seed 1. One row a level,
also `<out>/census.json`. With the engine's maps in hand the twenty levels
take four and a half minutes; the engine's maps are two minutes a level on
top, once. "Alive" is the batch's own rule: each side kills an enemy, both
lose tickets, no bot throws.

| Level | Alive | Kills (Axis/Allies) | Captures | Idle share | Route failures a bot-minute | Spawns off | Flags off | Flags over another floor, m | Floors | Map | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|
| shigaisen_b | yes | 33/41 | 3 | 0.31 | 0.2 | 1 of 23 | 1 of 6 | 0 to 15.9 | one | engine | in |
| shigaisen_c | no | 0/0 | 0 | 1.00 | 0.0 | 15 of 17 | 6 of 6 | 4 to 4.3 | stacked | engine | stacked; a side sealed in; no flag a soldier can stand in |
| the_dungeon | no | 0/0 | 0 | 0.62 | 8.2 | 4 of 12 | 1 of 5 | 0 | one | painted | ground the page's soldier refuses |
| the_maze | yes | 19/13 | 3 | 0.39 | 2.2 | 0 of 20 | 0 of 5 | 0 to 0.3 | one | painted | in |
| the_corridor | no | 0/0 | 2 | 0.97 | 0.0 | 5 of 8 | 1 of 3 | 0 to 8.6 | stacked | painted | stacked; a side sealed in (ladders) |
| knife_championship | yes | 3/2 | 0 | 0.61 | 0.0 | 19 of 25 | 2 of 3 | 0 to 8.6 | stacked | painted | stacked (2 of 3 flags a storey up) |
| omaturi_channel_cannon | no | 0/0 | 0 | 0.99 | 0.0 | 11 of 25 | 4 of 6 | 0 | one | engine | sides do not meet on foot |
| omaturi_channel_sniper | yes | 1/1 | 3 | 0.56 | 0.0 | 0 of 12 | 0 of 1 | 0 | one | painted | in |
| omaturi_channel_sniper_day2 | no | 0/0 | 0 | 0.99 | 0.0 | 0 of 12 | 1 of 1 | 49.5 | stacked | engine | stacked (its one flag 49.5 m over the ground) |
| shigaisen_a | yes | 9/11 | 4 | 0.46 | 2.0 | 6 of 25 | 3 of 5 | 0 to 9 | stacked | engine | stacked (3 of 5 flags a storey up) |
| shigaisen_d | yes | 1/1 | 2 | 0.42 | 3.3 | 8 of 27 | 1 of 5 | 0 to 4.3 | stacked | engine | stacked (32 % of the floor) |
| the_room | no | 0/0 | 0 | 0.74 | 2.6 | 12 of 17 | 2 of 3 | 0 to 54.7 | stacked | painted | stacked; a side sealed in (ladders) |
| the_street | no | 0/0 | 0 | 0.98 | 0.2 | 9 of 29 | 5 of 5 | 4 to 11.7 | stacked | painted | stacked; no flag a soldier can stand in |
| the_street_day2 | no | 0/0 | 0 | 0.97 | 0.0 | 9 of 29 | 5 of 5 | 4 to 11.7 | stacked | engine | stacked; no flag a soldier can stand in |
| hop | yes | 29/46 | 0 | 0.28 | 1.7 | 0 of 4 | 0 of 2 | 0 to 0.1 | one | painted | in |
| shigaisen_g | yes | 33/32 | 0 | 0.31 | 0.0 | 23 of 27 | 0 of 3 | 0 | stacked | engine | stacked; both bases sealed in (ladders) |
| the_fortress | no | 0/2 | 1 | 0.77 | 7.2 | 2 of 21 | 1 of 4 | 0 to 0.2 | one | engine | attackers have no soldier spawn |
| the_street_g | no | 0/0 | 0 | 0.19 | 3.3 | 9 of 29 | 5 of 5 | 4 to 11.7 | stacked | engine | stacked; no flag a soldier can stand in |
| _o_jka__big | yes | 16/4 | 1 | 0.51 | 0.0 | 0 of 11 | 0 of 1 | 0 | one | engine | in |
| _o_jka__ | yes | 14/16 | 2 | 0.70 | 0.7 | 0 of 7 | 0 of 1 | 0.2 | one | engine | in |

"Spawns off" and "flags off" are the soldier spawns and capturable flags the
walk test (16.3) finds cut off from the main walked ground or a storey over
it. "Map" is where the layer's infantry map came from: the engine's own, or
painted from the walk test because the engine's held under half the ground.

Ten alive, ten dead. The lint (16.3) called nineteen of the twenty right
before the match ran. The one it missed is shigaisen_g: both bases are
sealed in (ladders are the only way down), the lint predicts a dead level,
and the two sides shoot each other from where they stand.

One seed overstates. Omaturi_channel_sniper is alive in the census with one
kill a side and has no fight over ten seeds (16.5).

### 16.2 The classes

| Class | Levels | What it is |
|---|---|---|
| Stacked floors | shigaisen_c, the_corridor, knife_championship, omaturi_channel_sniper_day2, shigaisen_a, shigaisen_d, the_room, the_street, the_street_day2, shigaisen_g, the_street_g | The play surface is several floors over each other. A one-bit walk map holds one floor, and retail's AI could not route these either. Classed out, not worked on |
| A side sealed in | shigaisen_c; with ladders the_corridor, the_room, shigaisen_g | No spawn of a side has a way on foot to the ground the flags are on |
| No flag a soldier can stand in | shigaisen_c, the three the_street levels, omaturi_channel_sniper_day2 | No capturable flag has a place inside its 3D radius that a soldier on the one-floor map can stand in |
| Sides never meet on foot | omaturi_channel_cannon, the_fortress | Two shores of a channel, 426 m apart with the guns between; a landing whose attackers have no soldier spawn point |
| Ground the page's soldier refuses | the_dungeon | Every usable spawn stands on terrain the page reads as too steep to climb |

Stacked is the walk test's reading: a tenth or more of the main floor has
another walked floor over or under it, or half or more of the capturable
flags stand a storey (2.5 m) over another walked floor. Both figures are
this tool's choices (INVENTION, `walkflood.mjs STACKED_SHARE`,
`STACKED_FLAGS`). Four stacked levels are alive in the census:
knife_championship, shigaisen_a, shigaisen_d and shigaisen_g. They are
classed out all the same. On shigaisen_a three of the five capturable flags
are upstairs and a bot never contests them; on shigaisen_d a third of the
floor has a second floor over it. The matrix was not run on them.

**shigaisen_c, the level the coordinator traced.** Three causes, all the
level's:

* The level sinks the vanilla city blocks 4.5 to 8.3 m into the ground. The
  engine draws its map from a cut at each mesh's lowest vertex plus 0.4 and
  2.0 m, so the doorways on its map are the buried storey's. At street level
  every opening is a window: a 0.67 m sill at the flag buildings, 0.93 m at
  both bases. The page's soldier steps 0.45 m and a bot never jumps. That is
  the Axis base's 76-cell pocket and the 712 route failures of the Allied
  bots on the main component: a route the map allows and a sill the body
  does not.
* All six capturable flags stand on a floor 4.0 to 4.3 m over the street.
  The 3D ring (16.3) now sends a bot under them; no bot can reach the place.
* The water plane 0.37 m over the street is not a cause. It is under every
  gate the page has (pose 0.4 m, firing and the medic 0.75, swimming 1.43,
  the walk map 1.5); bots wade it at full speed.

**the_dungeon.** In a traced match 13 of 16 bots never left their spawn
point: some walk forward into the ground for the whole match, some have no
route and stand. The lint flags it from the slope the page reads under
every usable spawn (`soldier-resolve.js tooSteep` takes the terrain's
normal across a lattice cell, so ground beside a terrain wall reads steep).
Three Allied bots did walk 176 m, so "no spawn a soldier leaves" would
overstate it; the lint's text was corrected to say what was measured. The
cause is in the soldier's movement on that terrain and was not isolated
further. A person playing the level on the page meets the same ground.

### 16.3 What was fixed

**(a) The capture ring from the 3D geometry** (`viewer/control-point-law.js
captureReach`, `captureStandRadius`; `strategic-ai.js _captureRing`;
`bot-decision.js fallbackRadius`; `bot-pose.js footingAt`). A capture is
measured in 3D and an order across the ground. Where the pole stands `dy`
over or under the ground a soldier stands on, the flag reaches
`sqrt(r² - dy²)` across that ground, and the ring a bot is sent into is that
less a body's metre. Under a metre of ring, or no reach at all, the engine's
order stands as before: Stalingrad's two upper-floor flags, 13.5 m up with a
5 m radius, keep it. The ground is the terrain, and the swim draft in water
deeper than a soldier wades, never the water plane. Spec:
`features/bf1942-ai-spec/strategic.md`, "The capture ring".

Measured on a copy of shigaisen_B with its three small capturable flags
lifted 4.1 m (a test level in scratch): ten seeds of 600 s gave 11 captures
before, 15 with the 3D ring, and 23 once a ring the ground cut is asked for
against its own radius instead of the order's (the last metres into a
1.86 m ring were being outbid by the Scout behaviour).

That urgency rule was first written for every ring, flat ones too, and that
version was dropped. On the real shigaisen_B it raised stuck seconds a
bot-minute from 1.78 to 2.23 at 16 a side and from 1.83 to 1.99 at 8, and it
changed Stalingrad's two traces, which moves the bar (stuck p90 at 16 a side
1.990 to 1.977, redeploys p90 0.129 to 0.140). Kept to rings the ground cut,
no DICE level reads it (16.4).

**(b) Spawn pockets, by a walk test** (`sim/walkflood.mjs`). A flood of
standing places over the real collider on quarter-metre cells, with the
page's own soldier: radius 0.39 m, height 1.8, step 0.45, slope limit 60
degrees, wading 1.5 m, and a drop of no more than 2 m (the fall that costs
no health). Every move is one the page's capsule can make. From it the
generator (version 3) reads:

* whether a spawn or a flag the map keeps in a pocket has a way out on foot.
  If it has, the cells of that way are opened in the layer's own infantry
  map and listed in `generated.json` (`walkMap.opened`, `walkMap.ways`). A
  way that needs a jump is not opened. INVENTION.
* which spawns bots are kept off (no way to the main ground, or a storey
  over another floor), and which flags are out of reach in 3D.

Cells opened: hop 31 (three ways), the_fortress 43, shigaisen_g 27,
the_street_day2 20, the_street_g 11, the_street 9, the_corridor 54,
shigaisen_d 1. No way found: 8 spawns on shigaisen_c (the sealed base), 23
on shigaisen_g, 9 on omaturi_channel_cannon, 8 each on knife_championship
and the_room. Of the levels judged in 16.5 only hop has opened cells.

The search maps needed a writer (`botgen.mjs encodeSearchMap`,
`encodePyramid`: level 0 edited, levels 1 and 2 the OR of four children). It
reproduces DICE's nine Kharkov maps byte for byte.

**(c) Route failures on the main component.** shigaisen_c's are the sills
above: level data, not bot code. Nothing was changed for them.

**(d) Arenas whose floor the engine's map does not hold.** The engine's map
of the_corridor is blocked everywhere (the floor is objects high over the
terrain), and its map holds under half of the walked ground on seven more
levels: hop 2 %, knife_championship 7 %, the_room 28 %, the_dungeon 31 %,
the_street 37 %, the_maze 39 %, omaturi_channel_sniper 44 %. Under half
(`walkflood.mjs MAP_COVER`), the layer's infantry map is painted from the
walk test's main ground instead and the engine's level 0 is kept beside it
(`Pathfinding/engine/`), so a later run decides again. INVENTION, recorded
as `walkMap.source: "walk test"` with `engineCover`.

A painted cell is free when at least half of its quarter-metre cells hold a
standing place and the four about its centre all do. The centre was added
in this phase. With half the cell alone a cell half inside a wall's reach
was free, the route ran through its centre, and bots walked into wall ends
and stayed: on the_maze (walls a quarter of a metre thick, corridors three
metres wide), three seeds of 600 s at 8 a side gave 7.1, 7.3 and 7.3 stuck
seconds a bot-minute and no capture. With the centre: 2.2, 1.4 and 1.4, and
3, 9 and 3 captures.

**(e) The lint predicts a dead level** (`sim/botlint.mjs lintWalk`). Errors,
each tagged with its class: a side holds no spawn point at the start; a
side has no spawn with a way on foot to the main ground; a side can reach
none of the flags it must take; no capturable flag is reachable in 3D;
every usable spawn of a side stands on ground the page refuses; the play
surface is stacked. `botbatch level` now lints before any match and gives a
level with a lint error the outcome `unsuitable` in seconds, with the
errors in its `verdict.json`; `--despite-lint` runs it all the same. All
fourteen classed-out levels carry that verdict, so the bake's gate stays
shut on them.

**Also.** `engine_search_maps.py` links the archive a variant level reads
(a second day keeps its terrain in the first day's archive; both day-2
levels failed without it). The comparison with the no-layer level
(`botbatch.mjs betterThanNothing`) leaves spawn traps out where the
no-layer level has no fight: on the_maze nobody is killed in twenty matches
with no layer, so its zero spawn traps read 0.011 a bot-minute with the
layer as "worse" and the outcome as no-better-than-nothing. It is the same
reasoning as `no-fight` on the other arm, and the left-out rate is named in
the verdict (`notCompared`). No bar was moved.

### 16.4 DICE levels and the baseline

No bot-code change of this phase moves a DICE trace.

| Level | With vehicles | On foot |
|---|---|---|
| Bocage | 455a8c43, identical | 02693d42, identical |
| Kharkov | 777842fc, identical | c4a1ae94, identical |
| Berlin | ba553cce, identical | a6949645, identical |
| Stalingrad | b8680e9d, identical | 46f61f8d, identical |
| El Alamein | 2cb9a704, identical | 59ad9ebb, identical |

Seed 3, 8 a side, 300 s, the committed viewer against the final one (trace
hashes, first eight digits). The baseline was rebuilt on the final code all
the same (four levels, two sizes, ten seeds, 80 matches): the file is byte
for byte the committed one, so every bar in 15.4 stands as written.

### 16.5 The verdicts

Ten seeds, 600 s, Conquest, on foot, 8 and 16 a side, the level with no
layer and with the generated one, on the six levels that lint clean and
were alive in the census. Medians; the bar in brackets.

| Level | 8 a side | 16 a side | Outcome |
|---|---|---|---|
| shigaisen_b | pass, 15 of 15 | fail: redeploys 0.1298 (0.129) | better-than-nothing |
| the_maze | fail: route failures 2.73 (0.38), redeploys 0.230 (0.198) | fail: route failures 4.22 (2.10), redeploys 0.203 (0.129) | better-than-nothing |
| hop | fail, 6 checks: stuck 3.52 (2.06), spawn traps 0.194 (0.143), route failures 2.01 (0.38), redeploys 0.250 (0.198), no capture, one side never captures | fail, 7 checks: the same and flag coverage | better-than-nothing |
| _o_jka__big | fail: idle share 0.60 (0.53) | pass, 15 of 15 | no-better-than-nothing |
| _o_jka__ | fail: idle share 0.71 (0.53), route failures 0.50 (0.38) | fail: idle share 0.77 (0.72) | no-better-than-nothing |
| omaturi_channel_sniper | fail, 5 checks | fail, 5 checks | no-fight |

No layer against generated, the rates behind the outcome:

| Level, size | Stuck seconds | Route failures | Redeploys | Idle share | Captures | Enemy kills a bot-minute |
|---|---|---|---|---|---|---|
| shigaisen_b, 8 | 12.97 to 1.83 | 12.80 to 0.34 | 0.87 to 0.16 | 0.02 to 0.31 | 2 to 3 | 1.00 to 1.09 |
| shigaisen_b, 16 | 14.74 to 1.78 | 16.20 to 0.65 | 0.97 to 0.13 | 0.01 to 0.41 | 2 to 2 | 1.11 to 0.61 |
| the_maze, 8 | 24.48 to 1.45 | 47.20 to 2.73 | 1.98 to 0.23 | 0 to 0.36 | 0 to 3 | 0 to 0.53 |
| the_maze, 16 | 24.48 to 1.26 | 47.26 to 4.22 | 1.98 to 0.20 | 0 to 0.39 | 0 to 2 | 0 to 0.43 |
| hop, 8 | 60.41 to 3.52 | 45.77 to 2.01 | 3.14 to 0.25 | 0 to 0.25 | 0 to 0 | 0 to 1.08 |
| hop, 16 | 60.41 to 2.53 | 45.97 to 4.85 | 3.14 to 0.18 | 0 to 0.22 | 0 to 0 | 0 to 0.87 |
| _o_jka__big, 8 | 1.79 to 0.30 | 0.28 to 0.00 | 0.12 to 0.03 | 0.30 to 0.60 | 3 to 2.5 | 0.64 to 0.30 |
| _o_jka__big, 16 | 1.95 to 0.76 | 0.38 to 0.40 | 0.12 to 0.05 | 0.27 to 0.63 | 3 to 3 | 0.61 to 0.25 |
| _o_jka__, 8 | 1.75 to 1.31 | 11.01 to 0.50 | 0.10 to 0.10 | 0.31 to 0.71 | 3 to 4.5 | 0.68 to 0.34 |
| _o_jka__, 16 | 0.23 to 1.24 | 14.50 to 1.85 | 0.02 to 0.11 | 0.36 to 0.77 | 2 to 1 | 0.33 to 0.20 |
| omaturi_channel_sniper, 8 | 14.11 to 3.65 | 24.75 to 0.00 | 0.28 to 0.00 | 0.47 to 0.64 | 1 to 1.5 | 0 to 0.013 |
| omaturi_channel_sniper, 16 | 6.16 to 2.29 | 27.49 to 0.01 | 0.26 to 0.00 | 0.46 to 0.70 | 1 to 1.5 | 0 to 0.009 |

Level by level:

* **shigaisen_b** is section 15.4 again to the last digit: the 3D ring and
  generator 3 change nothing on it. Its acceptance was carried by the tool.
  The Allies still win ten of ten at both sizes (15.4).
* **the_maze** has no fight at all with no layer (no kill in twenty
  matches) and a full one with it: both sides kill in every seed, 49
  captures over ten seeds at 8 a side, 13 of 15 checks at each size. What
  fails is one place. In a traced match 137 of 167 route failures are at
  396 to 398, -696 to -716, where a post and a short wall stand in the
  north half of a three-metre corridor and leave a 0.75 m band to pass
  through; bots cutting the corner from the crossing corridor walk into the
  post. The Axis wins nine of ten at both sizes.
* **hop** is two flags, both of them bases that can be taken, and four
  spawn points, on a floor of objects. With no layer every bot is stuck for
  the whole match. With the layer both sides kill in every seed (687 and
  790 kills over ten seeds at 8 a side), and nobody takes a base: one
  capture in twenty matches. The busiest stuck place is 524, -568, by the
  Axis base.
* **_o_jka__big** and **_o_jka__** already fight with no layer: the page's
  painted map is enough there, and the no-layer level fails one check
  (_o_jka__big: spawn traps, at both sizes) or two (_o_jka__: route failures
  and team kills). The layer cuts route failures, doubles the idle share
  and halves the kill rate: each level has one capturable
  flag, and Kharkov's strategies keep most of a side at home. On these two
  a generated layer is not an improvement, and the tool says so.
* **omaturi_channel_sniper** is a sniping range: the bases are 209 m apart
  on two cliffs with one flag between them, 51 m lower, with a 40 m radius. The
  Allies take the flag in every seed and the Axis bleeds; 20 kills in ten
  matches at 8 a side. Bots do not duel at that range.

### 16.6 What a layer costs

19 to 76 KB a level, median 49 KB, 922 KB for the twenty in
`tools/bf1942-models/bot-layers/bf1942/`. The fourteen classed-out layers
are kept: each holds two minutes of the lab's server and the verdict that
says why it is shut. They are 630 KB and can be deleted at no cost but that.

### 16.7 Open, and not verified

1. Nothing in this phase was looked at in a browser. The page-side change
   is bot code that the runner exercises.
2. The four stacked levels that are alive were not run through the matrix,
   and the two figures that class them are choices. shigaisen_a (two of
   five flags on the ground) is the one to argue about.
3. Whether bots walk the one-cell ways the generator opens was not isolated.
   hop is the only judged level with any.
4. the_dungeon's cause is named to the soldier's slope rule and no further.
5. the_maze's corridor post, hop's bases and shigaisen_b's hut doors are
   the same question: how the page's soldier steers past something narrow.
   It belongs on a DICE level with a door, not on these.
6. On a level with one capturable flag the Kharkov template idles half a
   side. A template chosen by flag count is the next generator question;
   the two _o_jka__ levels are the measure.
7. The census's "alive" is one seed. It cleared omaturi_channel_sniper,
   which ten seeds did not.
8. Whether retail's bots jump a sill, and what retail's AI does on a stacked
   level, were not looked at in the lab.
9. `captureTick` on the page measures a capture from the soldier's feet;
   the engine measures from the origin, a metre up. Found while reading,
   not changed.
10. From 15.8, still open: the stand-in for a person, engine maps for mod
    levels, strategic maps, numbered patch archives, the meeting-area rule,
    `createHomogenousCondition`.

## 17. Going live, 2026-11-10: shigaisen_B and The_Maze

### 17.1 The path

1. `node sim/botbatch.mjs level ...` writes the layer's `verdict.json`.
2. A layer that fails the bar and is `better-than-nothing` goes live only
   with a recorded reason: `node sim/botbatch.mjs accept --levels <level>
   --reason "<why>"`. The reason and the checks it is short of are kept in
   the verdict; a later run that fails a new check withdraws it.
3. `python3 publish_bot_layers.py --root <scratch> --game-dir <game folder>`
   stages every layer the bake's gate lets through. The community maps are in
   the vanilla tree and that tree is not on every PC, so it fetches each
   level's published `scene.json`, patches the `ai` layer into it with
   `patch_scene.py`, writes the level's `pathfinding/` folder, and sets
   `generatedBots` on the level's row of the published `menu-levels.json`.
4. `scripts/publish-mesh-delta.py maps --hash --list --root <scratch>
   --hash-manifest <scratch>/hashes-maps.json`, dry run first. It sends only
   what differs and deletes nothing. Keep the fetched originals: they are the
   rollback.
5. Look at it on play.bfstats.io: `?mod=community`, Instant Battle, the level
   carries the tag EXPERIMENTAL BOTS, START plays it with bots.

### 17.2 What is live

| Level | Outcome | Accepted short of | Published |
|---|---|---|---|
| shigaisen_B | better-than-nothing | redeploys at 16 a side, 0.1298 against 0.129 | 2026-11-10; **taken down 2026-11-11** |
| The_Maze | better-than-nothing | idle share at 8 a side, 0.547 against 0.526 | 2026-11-10, twice; again 2026-11-11 |
| Desert Combat DC_LostVillage | better-than-nothing | redeploys, flag coverage, the worse side's share of deaths no enemy caused; one-sided | 2026-11-11, after a page check |
| FHSW Tunis-1943 | better-than-nothing | enemy kills, route failures, the worse side's share of deaths no enemy caused, units never used | 2026-11-11, after a page check |

Both rows are the verdicts of 2026-11-10, which were measured with a
stand-in weapon under the wrong doctrine (19.1, 19.2). Judged again,
shigaisen_B is no better than the level with no layer and came off the page;
The_Maze was accepted again short of route failures and republished (19.4).

The_Maze's layer was then replaced by generator 5's (19.5), which the
runner prefers. Played on the page it takes as many flags and has the Axis
side killing about half its own dead ([page-matches.md](page-matches.md),
section 5): the runner under-counts team kills, and a page match is not yet
part of the gate. It is live with that fault named in its acceptance.

The_Maze was published twice on the day. The first layer (generator 3,
accepted short of route failures and redeploys at both sizes) is the one
17.3 watched. The one live now is generator 4's, with flags 3 and 4 out of
play (18.1, 18.3), accepted short of the one check above.

### 17.3 The live check found what the verdict only counted

The_Maze was watched for two and a half minutes at 8 a side. The Axis side
had 15 deaths, 4 of them Allied kills. The other 11 were the page's
no-progress redeploy, shown to the player as "<name> is no more" and a score
of -2: one side killing itself.

A traced headless match says where. Flags 3 and 4 stand at the end of long
narrow ways, 7.7 m over the ground. The walk test calls them reachable and
the lint says no flag is cut off, both by cell connectivity. A bot ordered to
flag 4 walks to (397.9, -712.2), its leg search never closes, and it is
redeployed twelve seconds later: 107 of 167 route failures in that match are
at that one place, and neither flag is taken in twenty matches.

The first reading of that, a ramp the route code cannot climb, was wrong.
On the bare map every route to both flags closes on the first plan. Every
failed leg carried an obstacle circle, most of them a teammate's: a bot
stops in the passage, each bot behind plants the 2 m circle the engine's
avoidance rule gives a still body of their own side, and in a passage three
or four cells wide that circle is the passage (18.1).

A scratch copy of the layer with areas 3 and 4 written as the generator
writes an unreachable area (measured, `botbatch matrix`, ten seeds):

| The_Maze, median | 8 a side, live | 8 a side, 3 and 4 excluded | 16 a side, live | 16 a side, 3 and 4 excluded |
|---|---|---|---|---|
| route failures a bot-minute | 2.73 | 0.27 | 4.22 | 0.92 |
| redeploys a bot-minute | 0.230 | 0.053 | 0.203 | 0.069 |
| stuck seconds a bot-minute | 1.45 | 0.17 | 1.26 | 0.14 |
| captures | 3 | 6.5 | 2 | 9 |
| winners, Axis : Allies | 9 : 1 | 7 : 3 | 9 : 1 | 7 : 3 |
| checks passed | 13 of 15 | 14 of 15 (idle 0.547 against 0.526) | 13 of 15 | 15 of 15 |

Two things follow. Connectivity of cells is not reachability for a side of
bots: the generator and the lint now run a route probe (18.1) that plans
each way with the page's own route code and counts the places one standing
teammate shuts it, and take out a flag no side has an open way to. And a
count that sits just over a bar can hide a fault a player sees at once, so
every level is watched before it is called done.

**The second watch**, the generator 4 layer, three minutes at 8 a side: the
Axis side had 2 deaths, both Allied kills; the Allies had 3, none of them an
enemy's (not looked into). The fight is slow: 3 kills in 3 minutes.

## 18. Phase C, 2026-11-10: the route probe, the judge by side, and the mods with vehicles

Three things, in the order they were asked for. The_Maze was accepted,
published and watched (section 17), and one side was seen killing itself:
the generator now asks the page's own route code whether a bot can get to a
flag, and the judge reads each movement rate by side. Then the mods the
owner named (Desert Combat, Forgotten Hope, BF1918, FHSW), judged the way
they are played, with their vehicles in. Nothing was accepted and nothing
published.

### 18.1 The route probe

`sim/routeprobe.mjs`, called by the generator (version 4) and by the lint.

**What the fault was.** Flags 3 and 4 of The_Maze were reachable by the walk
test and by the map's connectivity, and were not taken in twenty matches.
The page's own planner was run from every usable base spawn to every flag
(`viewer/nav-search.js findStrategicPath`, then each leg as
`viewer/bot-route.js extendRoute` searches it: the box, six wider tries,
the next route's box wider for each of the last three failures): on the
bare map every route to 3 and 4 closes on the first plan. A traced match
with the obstacle circles of every failed leg logged then showed where they
fail: 167 of 167 failed legs carried at least one circle, 331 of them a
teammate's, 14 a contact circle, and none failed on the bare map. A soldier
plants a circle on a body of their own side standing still in their way
(`predictObstacles`, the engine's `BBAvoid::calculateUrgency`): the two
radii summed, 2 m. A bot stops in the crossing at 397.9, -713.9 (to fire,
or beside a post), each teammate behind plants a circle on them, and in a
passage three or four cells wide that circle is the passage. The leg never
closes, widenings and all, until the no-progress redeploy.

So it is not the ramp, not the leg search on the map and not the paint. A
stricter paint was tried and dropped: with three quarters of a cell asked
for, route failures stay where they were (3.4 a bot-minute at 8 a side);
with the whole cell, 18. Narrower corridors on the map choke sooner. The
planner was left alone: the rule is the engine's, and no DICE trace argues
for changing it.

**What the probe asks.** Two things of every way from a side's usable
spawns to a flag's order position, and between neighbouring flags:

1. Does the planner close it on the bare map (`probeRoute`)? It reports the
   stage it stops at (the strategic search, or a leg) and how many failed
   plans it takes.
2. How much of it does one standing teammate shut (`chokePoints`)? For each
   point 3 m along the planned route a 2 m circle is stood on it and the
   follower's own search is run from 6 m short of it to 6 m past, widenings
   and all. A point where it does not close is a choke point.

The bar for the second is DICE's. On the shipped maps of the four baseline
levels, every side to every capturable flag, the best route has at most 4
choke points (Stalingrad's city flag, both sides; Kharkov 1; Berlin at most
1; Bocage 0): `CHOKE_MAX`. The_Maze's flags 3 and 4 have 16 to 20 from
either side, 48 to 60 m of single file. shigaisen_B's worst is 3.

A way is open when it closes and has no more choke points than that. A
side reaches a flag by an open way from one of its spawns, or from a flag
it reaches to a neighbour. Then:

| Finding | Generator | Lint |
|---|---|---|
| No side has an open way to a flag | the flag is taken out of play as an unreachable one is, `unreachableReasons` says "route probe", `routeProbe.stops` says where each side's way stops | error if such a flag is still in play |
| One side only | kept; `routeProbe.oneSided` names the side | warning that names the side |
| A side has an open way to no flag | | error, a dead level (`no-route`) |
| A way closes only after failed plans | `routeProbe.late` | warning |

INVENTION, all of it: the engine orders its bots to any area a side may
take and lets them fail. Tests: `tests/test_route_probe.py`, on a map
written by hand (a field, a passage two cells wide and a hundred metres
long, one nine cells wide, a room nothing joins). On that map too the
narrow passage closes on the bare map and is shut by the teammate.

### 18.2 The judge by side

`sim/detect.mjs sideFigures`, `sim/judge.mjs WORSE_SIDE`. A rate taken over
both sides halves a fault one side has: 16 of 19 redeploys in the traced
The_Maze match were the Axis side's.

For stuck seconds, spawn traps, route failures and redeploys the row keeps
each side's count and its rate over that side's own bot-minutes, and the
worse side's rate as a field of its own. One more field is what the
scoreboard shows: the share of a side's deaths no enemy caused (redeploys,
self deaths, team kills, over those plus enemy kills), worse side. Each is
judged like the two-side rates: the median over seeds against the DICE
runs' own worse-side p90.

| Worse side, p10 / p50 / p90 | 8 a side | 16 a side |
|---|---|---|
| Stuck seconds a bot-minute | 0.46 / 1.69 / 3.82 | 0.30 / 1.46 / 3.59 |
| Spawn traps a bot-minute | 0.013 / 0.133 / 0.212 | 0.006 / 0.030 / 0.109 |
| Route failures a bot-minute | 0 / 0 / 0.77 | 0.007 / 0.20 / 2.93 |
| Redeploys a bot-minute | 0.056 / 0.143 / 0.368 | 0.031 / 0.103 / 0.198 |
| Share of deaths no enemy caused | 0.107 / 0.231 / 0.478 | 0.105 / 0.246 / 0.406 |

Stalingrad's Axis side sets the redeploy and death-share bars at 8 a side.
The baseline was rebuilt for the new fields; no DICE trace changed, and all
281 values the file held before are byte for byte the same. A row or a
baseline without the fields reads "not measured" and does not fail, so an
old run folder can still be read.

In the trace a redeploy is its own event and spends no ticket; it is not a
kill line and `perBot.deaths` does not count it. The page's code at the
commit this was read at has no path that prints one as a death
(`bot-referee.js` calls `env.onRedeploy`, which `map.html` does not pass),
so the "is no more" lines and the score of -2 seen live are not explained
by what was read. Open.

The old layer's rows, recomputed from the run summaries where the summary
allows (redeploys, route failures and the death share; stuck time and spawn
traps by side need the trace, which is not kept), and the six judged levels
run again with the new detector:

| Level | 8 a side, worse side | 16 a side, worse side |
|---|---|---|
| The_Maze, published layer | redeploys 0.389 (0.368) fail, route failures 4.44 (0.77) fail, death share 0.43 (0.48) | redeploys 0.350 (0.198) fail, route failures 6.42 (2.93) fail, death share 0.50 (0.41) fail |
| The_Maze, generator 4 | redeploys 0.075, route failures 0.40, death share 0.17: all pass | redeploys 0.084, route failures 1.16, death share 0.19: all pass |
| shigaisen_b | all five pass (redeploys 0.188, death share 0.18) | all five pass (redeploys 0.146, death share 0.25) |
| hop | stuck 3.93 (3.82), spawn traps 0.220 (0.212), route failures 2.78 (0.77) fail | spawn traps 0.408 (0.109), route failures 6.06 (2.93), redeploys 0.209 (0.198) fail |
| _o_jka__big | all five pass | all five pass |
| _o_jka__ | all five pass (route failures 0.772 against 0.773) | route failures 3.42 (2.93), death share 0.44 (0.41) fail |
| omaturi_channel_sniper | stuck 7.32 (3.82), spawn traps 0.252 (0.212) fail | stuck 4.33, spawn traps 0.139, death share 1.0 fail |

Nothing changes in the outcomes of section 16.5 but The_Maze's.

### 18.3 The_Maze again

Generator 4 takes flags 3 and 4 out ("route probe"), which leaves three in
play. Ten seeds, 600 s, on foot; the published layer against the new one:

| | 8 a side | 16 a side |
|---|---|---|
| Route failures a bot-minute | 2.73 to 0.27 (bar 0.38) | 4.22 to 0.92 (2.10) |
| Redeploys a bot-minute | 0.230 to 0.053 (0.198) | 0.203 to 0.069 (0.129) |
| Stuck seconds a bot-minute | 1.45 to 0.17 | 1.26 to 0.14 |
| Captures a match | 3 to 6.5 | 2 to 9 |
| Enemy kills a bot-minute | 0.53 to 0.39 (floor 0.30) | 0.43 to 0.42 (0.17) |
| Winners, Axis to Allies | 9:1 to 7:3 | 9:1 to 7:3 |
| Checks failed | route failures, redeploys to idle share | route failures, redeploys to none |

**16 a side passes all twenty checks. 8 a side fails one: idle share 0.547
against 0.526.** Outcome better-than-nothing. The tool withdrew the
acceptance by its own rule (a check fails now that did not fail then); the
coordinator has since recorded a new one in the layer's `verdict.json`.

The idle share is home guards. In a traced match 59 % of alive bot time is
Scout or Idle with no target, and 71 % of that is bots ordered to their own
base, which no enemy can take: the Allies spend 55 % of their time ordered
to AlliedBase, the Axis 30 % to AxisBase. With three flags in play
Kharkov's strategies keep half a side at home. The two _o_jka__ levels
failed the same way in 16.5. It is the template's doing, not a route fault. (Correction, section 19: that is the engine's SAI doctrine, which
these matches ran and the page does not; under the page's garrison the
idle share is a quarter of it, 19.2 and 19.3.)

shigaisen_b through the probe: no flag is taken out and no way is shut. Its
layer was not rewritten; the generator would write a version of 4 and a
`routeProbe` block in `generated.json` and nothing else.

### 18.4 What a mod's level needed

**The trees.** A mod's levels are in its own maps tree and its own models
tree; the runner, the generator and `patch_scene.py --layer ai --mod <Mod>`
take them as they are, and a layer is kept under
`bot-layers/<mod, lower case>/<level>/`. Nothing had to change for that.

**The engine's own maps are not practical for a mod.** `engine_search_maps.py`
now links a mod the lab's server lacks from the game install (and every mod
its `init.con` names), and the engine does write its maps for a mod's
level. They are not usable:

| Level | Time | Infantry map free | Tank map free |
|---|---|---|---|
| Desert Combat, DC_Basrah_Nights | 2 min | 0.78 % | 81 cells |
| BF1918, baghdad | 6.3 min | 143 cells | 4 cells |
| Forgotten Hope, Pegasus | 3.1 min | 5.9 % | 4.5 % |

The flood reaches a little way from the spawns and stops: painted before
the statics load, Baghdad is 5 % and 9 % free, so it is the mod's statics
that close it. Desert Combat's infantry map also differs between two runs
(7,456 and 8,189 free cells), and three starts in a row died within six
seconds. The step is kept (a vanilla level's maps are byte for byte what
they were) and not used for the mods.

**So a mod's maps are painted from the level as baked** (generator 4, when
the layer holds no engine map):

* the infantry map from the walk test, as for an arena the engine's map
  does not hold (16.3), with the route probe on top. `walkMap.engine` is
  `none`. Where the walk flood runs out of room before the ground does (a
  wide level), no map is written and the page paints its own, as it does
  with no layer (`walkMap.source` `page painter`).
* the land vehicles' map from the page's own painter, written out as the
  layer's `Tank0` (`botgen.mjs paintedVehicleMap`), at the widest brush that
  keeps the level in one piece: DICE's 3 m first, then 2.5, 2 and 1.5, the
  one that puts as many flags and spawners on one piece of the map as any
  of them. The piece is the one with most flags on it, not the largest: a
  walled town has more open ground outside its wall than inside (Mauerfall,
  where the largest piece holds no flag at any brush). The layer's
  `AIpathFinding.con` declares the brush, so the page reads that map for its
  hulls. On DC_Basrah_Nights 3 m leaves the map in nineteen pieces with two
  flags of five and one spawner of eight on the best of them, and with
  vehicles on the two drivers sit still all match (throttle on 0 % and 4 %
  of the time, their two cars holding ten of the sixteen bots, one
  capture); at 1.5 m all five flags are on one piece, a driver covers
  206 m and the match has four captures.
* an order position for a hull in each area (`setOrderPosition Tank`): the
  free cell of that map nearest the flag, within 40 m. Without one a hull
  ordered to a flag inside a building is sent to the flag itself. Written
  only for a level that places something to crew.

All three are INVENTION and labelled so. A drive test on the collider in
the manner of the walk test was not built: the page's painter with a
narrower brush joined the levels tried, and a hull's own steering in a
street is the next limit, not the map (18.7).

**The configuration a verdict is for.** `botbatch` takes `--vehicles` on
`baseline`, `matrix`, `level` and `census`: the level's vehicles and guns
are in, the runs go to their own folders (`v8`, `v16`), each row and the
verdict say `with vehicles`, and the judge reads
`sim/baselines/vehicles-dice.json`. The marker records what a level places
(`objectSpawners`), and the bake's gate (`bf42/ai_level.py
generated_layer_gate`) opens a layer whose level places anything only on a
verdict `with vehicles`: a pass or an acceptance of on-foot matches does
not say what a player meets. `publish_bot_layers.py` reads the same gate,
so it follows with no change. A marker older than the count asks for
nothing (shigaisen_b, and The_Maze as published, both of which place
nothing).

**FHSW.** FHSW and FHSWEurope are installed on this Mac (8.7 GB and 143
level archives; 1.9 GB and 275), so their levels go through the ordinary
path. `patch_scene.py --layer ai --no-archives` exists all the same, for a
machine without them: the published `scene.json` answers whether the level
ships its own AI (an `ai` block with no `generated` marker is left alone),
the layer goes through the same gate, and the `pathfinding/` folder is
written from the layer's own maps. What it cannot write is
`ai.coverValues`, which come from the mod's object library (9 templates on
Edson's Ridge, 60 on FHSW's Pegasus); without them a bot takes low ground
for cover instead of an object. `publish_bot_layers.py` does not pass the
flag (four lines, not written: the archives are here).

### 18.5 The bar with vehicles

`sim/baselines/vehicles-dice.json`: the four levels the on-foot bar is
built on (Berlin, Stalingrad, Kharkov, Bocage), run with their vehicles in,
the same ten seeds, 600 s, 8 and 16 a side, the same statistics. They place
4, 6, 18 and 14 land and air hulls, which is the range of the mod levels
judged here, and taking the same four keeps the two bars apart by the
configuration alone.

A first set was chosen by the rule that classes a level "contained with
vehicles" in `candidates.csv` (flags within 600 m, more than 8 land and air
hulls), which gives Kharkov, Battleaxe and Wake. It was dropped before any
level was judged against it: Battleaxe's median is no capture at all and
Wake's Axis side has no route off its landing craft (route failures p90
81.8 a bot-minute at 8 a side), so two of its three levels have no fight by
this tool's own rule and its bars held nothing (captures at least 0, enemy
kills at least 0). That file is kept in scratch, not in the repo.

With vehicles the page's bots are a different thing from the same bots on
foot, on DICE's own levels:

| p10 / p50 / p90, 8 a side | With vehicles | On foot |
|---|---|---|
| Enemy kills a bot-minute | 0.062 / 0.111 / 0.335 | 0.298 / 0.596 / 1.408 |
| Captures a match | 0 / 3 / 5.1 | 1 / 4 / 8.1 |
| Stuck seconds a bot-minute (on foot) | 0 / 0.15 / 0.68 | 0.33 / 0.96 / 2.06 |
| Route failures a bot-minute | 0 / 0.026 / 0.307 | 0 / 0 / 0.382 |
| Redeploys a bot-minute | 0 / 0.010 / 0.052 | 0.034 / 0.104 / 0.198 |
| Idle share | 0.31 / 0.42 / 0.70 | 0.16 / 0.36 / 0.53 |
| Share of deaths no enemy caused, worse side | 0.12 / 0.34 / 0.76 | 0.11 / 0.23 / 0.48 |
| Mounted share of alive time | 0.57 / 0.84 / 0.90 | |

A side kills a fifth as often and is seated five sixths of the time. The
floor for captures at 8 a side is none (Stalingrad's median is 0), and
Stalingrad at 8 a side fails the tool's own "each side kills in every seed"
in two seeds of ten. So "no-fight" with vehicles is a line one of DICE's
four levels does not clear at one size; it is reported as measured.

The vehicle detectors (`sim/detect.mjs vehicleFigures`), each kept only
where the DICE runs give it a bar:

| Detector | What it is | DICE p90, 8 / 16 a side | Kept |
|---|---|---|---|
| Hull stuck | a driver with the throttle on whose hull moves under 2 m in 10 s, seconds a driving minute; and the worse side's | 3.25 / 2.15; worse side 5.03 / 3.38 | yes |
| Units never used | the share of the level's units no bot ever sat in | 0.41 / 0.22 | yes |
| Tank that never fires | seatings of 60 s or more in an armed tank seat with no shot | 0.50 / 0.31 | yes |
| Team kills from a seat | per bot-minute | 0 / 0.006 at p90 | no: one in sixty matches, no bar |
| Bots run over by their own side | | | no: the runner has no path where a hull hurts a soldier of its own side |
| Mounted share | | 0.90 / 0.83 | context only |

Two limits, stated: the trace's header gives a count of units and not
their kinds, so "never used" counts fixed guns with hulls (a level of
thirty emplaced guns fails it by construction); and an armed seat is known
only once it fires in the same trace. Both want `units: [{id, template,
kind}]` in the header (`sim/match.mjs`), not done.

**Desert Combat's own botted levels, for context** (one match each, 8 a
side, 300 s, with vehicles): DC_Basrahs_Edge 2 and 6 kills, 2 captures,
mounted share 0.75, 6 hulls destroyed; DC_DesertShield 7 and 3, 2 captures,
0.95, 18; DC's Kharkov 2 and 5, 2 captures, 0.83, 8. Most drivers cover
several hundred metres. In kills that is 0.09 to 0.13 a bot-minute, at
DICE's median with vehicles; their route failures are far past it (295,
502 and 18 in the match, 3.7, 6.3 and 0.2 a bot-minute against a p90 of
0.31). A mod's own layer would not pass this bar on route failures either.

### 18.6 The census of the mods

Every published level of Desert Combat, Forgotten Hope and BF1918 that
ships no bots and is not classed out as wide, naval or without soldier
spawns, and the twelve contained FHSW candidates: 47 levels, each once on
foot and once with vehicles (`botbatch census`, and `--vehicles`; 300 s, 8 a
side, seed 1). "Units" is what the runner places for a crew, guns included.
"Seated share" is the share of alive bot time spent in a seat, with
vehicles. Tunis is from the pass before the last (it was in the matrix
while the last one ran).

| Mod | Level | Class in candidates.csv | Units | On foot: alive, kills, captures | With vehicles: alive, kills, captures | Seated share | Map | Lint |
|---|---|---|---|---|---|---|---|---|
| DC | dc_al_khafji_docks | open ground | 18 | dead, 0/0, 0 | dead, 0/0, 0 | 0.23 | walk test | a side sealed in |
| DC | dc_basrah_nights | contained on-foot | 8 | alive, 27/39, 2 | alive, 6/3, 4 | 0.44 | walk test | clean |
| DC | dc_battle_of_73_easting | open ground | 48 | alive, 9/5, 2 | dead, 0/3, 1 | 0.38 | page painter | a side sealed in |
| DC | dc_lostvillage | contained on-foot | 6 | alive, 2/1, 0 | dead, 0/0, 0 | 0.48 | walk test | clean |
| DC | dc_medina_ridge | open ground | 40 | dead, 0/0, 0 | dead, 0/0, 0 | 0.84 | page painter | no flag standable; a side reaches no flag |
| DC | dc_oil_fields | open ground | 56 | dead, 0/0, 0 | dead, 0/0, 0 | 0.90 | page painter | no flag standable; a side reaches no flag; a side sealed in |
| DC | dc_operation_bragg | open ground | 62 | dead, 0/0, 1 | dead, 0/0, 0 | 0.88 | page painter | no flag standable; a side reaches no flag; a side sealed in |
| DC | dc_sea_rigs | contained on-foot | 18 | dead, 0/0, 0 | dead, 0/0, 0 | 0.16 | walk test | no flag standable; a side reaches no flag; a side with no spawn; stacked |
| DC | dc_urban_siege | open ground | 41 | dead, 0/0, 2 | dead, 3/0, 0 | 0.83 | page painter | clean |
| DC | dc_weapon_bunkers | arena: fixed bases only | 20 | dead, 0/0, 0 | dead, 0/0, 0 | 0.55 | walk test | a side with no spawn |
| DC | inshallah_valley | open ground | 32 | dead, 0/0, 1 | alive, 11/3, 3 | 0.73 | walk test | clean |
| FH | omaha_charlie-sector-1944 | open ground | 39 | alive, 5/5, 1 | dead, 0/0, 0 | 0.83 | walk test | a side with no spawn |
| FH | pegasus | contained on-foot | 18 | alive, 17/9, 0 | dead, 0/0, 1 | 0.53 | walk test | clean |
| FH | seelow-heights-1945 | open ground | 59 | alive, 8/2, 1 | dead, 0/0, 1 | 0.66 | page painter | a side sealed in |
| BF1918 | baghdad | contained with vehicles | 55 | dead, 1/0, 0 | dead, 0/0, 0 | 0.58 | walk test | a side reaches no flag |
| BF1918 | battle_of_cambrai | contained with vehicles | 53 | alive, 4/5, 2 | dead, 0/0, 0 | 0.77 | walk test | clean |
| BF1918 | battle_of_the_vosges | contained with vehicles | 51 | dead, 0/0, 0 | dead, 0/0, 0 | 0.00 | page painter | a side with no spawn |
| BF1918 | cantigny | contained on-foot | 54 | dead, 1/0, 0 | alive, 7/2, 0 | 0.12 | walk test | a side sealed in |
| BF1918 | carriere | contained with vehicles | 35 | alive, 9/18, 2 | dead, 0/0, 0 | 0.60 | walk test | stacked |
| BF1918 | chemin_des_dames | contained on-foot | 36 | dead, 0/0, 2 | dead, 0/0, 1 | 0.67 | walk test | clean |
| BF1918 | dawnville | contained on-foot | 14 | alive, 5/1, 1 | dead, 0/1, 0 | 0.81 | walk test | clean |
| BF1918 | deulemont | contained on-foot | 24 | dead, 0/0, 2 | dead, 0/0, 0 | 0.23 | walk test | a side sealed in |
| BF1918 | fht_meuse_argonne_offensive | open ground | 89 | alive, 1/22, 3 | dead, 0/2, 0 | 0.79 | page painter | clean |
| BF1918 | hindenburg_line | open ground | 41 | alive, 2/6, 2 | dead, 0/0, 0 | 0.70 | walk test | clean |
| BF1918 | liberation_of_roeselare | contained on-foot | 38 | alive, 2/4, 3 | dead, 0/0, 0 | 0.22 | walk test | a side sealed in |
| BF1918 | lutte_de_honneur | contained on-foot | 61 | dead, 1/0, 0 | dead, 1/0, 0 | 0.55 | walk test | clean |
| BF1918 | mauerfall | contained with vehicles | 48 | alive, 16/27, 1 | dead, 0/0, 0 | 0.67 | walk test | clean |
| BF1918 | operation_gericht | open ground | 38 | alive, 3/2, 1 | dead, 1/0, 0 | 0.60 | walk test | clean |
| BF1918 | raid_on_fort_pontisse | open ground | 62 | dead, 0/0, 4 | dead, 1/0, 2 | 0.28 | page painter | a side sealed in; stacked |
| BF1918 | roye | open ground | 71 | alive, 1/4, 1 | dead, 0/0, 0 | 0.90 | page painter | clean |
| BF1918 | saint_quentin_canal | open ground | 79 | alive, 4/5, 2 | dead, 2/0, 0 | 0.73 | page painter | clean |
| BF1918 | sanaga_river | contained with vehicles | 30 | dead, 0/10, 1 | dead, 0/0, 1 | 0.58 | walk test | clean |
| BF1918 | scimitar_hill | open ground | 39 | alive, 9/13, 2 | dead, 0/0, 1 | 0.46 | walk test | clean |
| BF1918 | somme_gasattack | contained on-foot | 22 | dead, 0/0, 0 | dead, 0/1, 0 | 0.67 | walk test | a side with no spawn |
| BF1918 | tabuaeran | open ground | 42 | dead, 0/0, 0 | dead, 0/0, 0 | 0.34 | walk test | a side sealed in |
| FHSW | battle_for_ortona-1943 | contained with vehicles | 61 | alive, 7/8, 2 | dead, 0/0, 0 | 0.91 | walk test | clean |
| FHSW | battle_of_edson_s_ridge | contained on-foot | 4 | dead, 0/0, 0 | dead, 0/0, 0 | 0.24 | walk test | clean |
| FHSW | battle_of_pavlov-1942 | contained on-foot | 13 | dead, 0/0, 0 | dead, 0/0, 0 | 0.46 | walk test | no flag standable; a side reaches no flag; stacked |
| FHSW | berlin-1945-outskirts | contained with vehicles | 46 | alive, 24/6, 1 | alive, 11/1, 0 | 0.57 | walk test | a side reaches no flag |
| FHSW | berlin-1945-streets | contained with vehicles | 29 | dead, 0/0, 1 | dead, 0/0, 0 | 0.56 | walk test | clean |
| FHSW | bizerte-1943 | contained with vehicles | 39 | alive, 9/2, 0 | dead, 0/0, 0 | 0.96 | walk test | clean |
| FHSW | monte_cassino-1944 | contained with vehicles | 38 | alive, 8/6, 2 | dead, 0/0, 0 | 0.75 | walk test | clean |
| FHSW | pegasus | contained with vehicles | 19 | alive, 3/5, 0 | alive, 3/2, 0 | 0.54 | walk test | clean |
| FHSW | stalingrad_redsquare | contained on-foot | 7 | alive, 4/1, 4 | dead, 1/0, 0 | 0.32 | walk test | clean |
| FHSW | stalingrad_urban_area-1942 | contained on-foot | 10 | dead, 0/0, 2 | dead, 0/0, 0 | 0.49 | walk test | clean |
| FHSW | tunis-1943 | contained with vehicles | 57 | alive, 7/9, 4 | alive, 5/2, 6 | 0.77 | walk test | clean |
| FHSW | warsaw_uprising | contained with vehicles | 28 | alive, 3/2, 2 | dead, 0/0, 0 | 0.80 | walk test | clean |

**On foot 25 of 47 are alive, with vehicles 6.** Lint clean and alive with
vehicles, which is what the matrix asks for: DC_Basrah_Nights,
Inshallah_Valley, FHSW's Pegasus and Tunis. All four were run (18.7).

The classes, from the table (the six alive with vehicles apart):

* **Alive on foot, no fight with vehicles** (16: Mauerfall,
  battle_of_cambrai, dawnville, DC_LostVillage, FH's Pegasus, FHSW's Ortona,
  Bizerte, Monte Cassino, Red Square and Warsaw, and six of BF1918's open
  levels). The bots take seats and nobody kills: the seated share is 0.3 to
  0.96 and a match has no kill or a handful. 18.8 has what they do there.
* **A side sealed in, with no spawn, or with no route to a flag** (14):
  BF1918's deulemont, liberation_of_roeselare, baghdad, somme_gasattack and
  tabuaeran, five of DC's wide levels, FH's Seelow Heights, and three levels
  whose published data gives a side no spawn point (battle_of_the_vosges,
  FH's Omaha Charlie, DC_Weapon_Bunkers).
* **Stacked** (4): DC_Sea_Rigs, carriere, raid_on_fort_pontisse, FHSW's
  Battle of Pavlov; classed out as in section 16.
* **No fight either way with a clean lint** (7): FHSW's Edson's Ridge has no
  contact at all in five minutes; FHSW's Berlin streets and Stalingrad urban
  area, DC_Urban_Siege, chemin_des_dames, lutte_de_honneur, sanaga_river.
  Not diagnosed further.

Of the six alive with vehicles, cantigny and FHSW's Berlin outskirts have a
lint error (a side sealed in; a side with a route to no flag) and are not
run.

Two things the census found were fixed in the walk test on the way, both
about water. A soldier wades to the depth a swimmer stands up in (1.35 m)
and no deeper, where the infantry map's own limit of 1.5 m had been used:
deeper they swim, and a swimmer's Armor takes the water-damage tick. And
the depth is now asked of a bed met from under the surface too: a bank
that shelves gently had let the flood walk on down a channel of any depth,
so FH's Pegasus canal, 5 to 7 m deep, was painted as ground and 26 of a
match's 29 deaths were bots sent across it. With both, FH's Pegasus on
foot goes from one kill to 17 and 9. Tests: `test_the_walk_test_wades_and_
does_not_swim`.

### 18.7 The verdicts with vehicles

Ten seeds, 600 s, Conquest, with the level's vehicles and guns in, 8 and 16
a side, the level with no layer and with the generated one, against
`vehicles-dice.json`. Medians; the bar in brackets.

| Level | 8 a side | 16 a side | Outcome |
|---|---|---|---|
| DC_Basrah_Nights | fails 4 of 24: enemy kills 0.060 (0.062), a side with no kill in 3 seeds, units never used 0.75 (0.41) | fails 7: no capture, enemy kills 0.019 (0.119), idle 0.634 (0.6335), death share 0.67 (0.46), units never used | no-fight |
| FHSW Pegasus | fails 8 of 24: route failures 2.5 (0.306), enemy kills 0.022 (0.062), flag coverage 0 (0.333), a side never captures, a side with no kill in some seed, a side loses no ticket in some seed, route failures, worse side 4.67 (0.549), units never used 0.684 (0.412) | fails 12 of 24: idle 0.647 (0.633), route failures 1.74 (0.546), captures 0 (1), enemy kills 0.016 (0.119), flag coverage 0 (0.333), a side never captures, a side with no kill in some seed, route failures, worse side 2.65 (1.04), death share 0.644 (0.464), hull stuck 27.37 (2.15), hull stuck, worse side 29.25 (3.38), units never used 0.553 (0.217) | no-fight |
| FHSW Tunis | fails 6 of 24: route failures 5.08 (0.306), enemy kills 0.019 (0.062), a side with no kill in some seed, a side loses no ticket in some seed, route failures, worse side 5.92 (0.549), units never used 0.754 (0.412) | fails 6 of 24: route failures 5.88 (0.546), enemy kills 0 (0.119), a side with no kill in some seed, a side loses no ticket in some seed, route failures, worse side 11.16 (1.04), units never used 0.789 (0.217) | no-fight |
| DC Inshallah_Valley | fails 2 of 24: route failures 1.43 (0.306), route failures, worse side 2.02 (0.549) | fails 7 of 24: route failures 2.08 (0.546), redeploys 0.1 (0.093), route failures, worse side 2.88 (1.04), redeploys, worse side 0.175 (0.164), death share 0.648 (0.464), hull stuck, worse side 3.95 (3.38), units never used 0.344 (0.217) | no-better-than-nothing |
| _o_jka__big (community) | fails 2: route failures 2.98 (0.31), worse side 4.77 (0.55) | fails 4: route failures 3.35 (0.55), worse side 4.50 (1.04), self deaths 0.0292 (0.0288), silent tanks 0.37 (0.31) | no-better-than-nothing |
| _o_jka__ (community) | fails 8: no kill, no capture, idle 0.87 (0.70), route failures 5.4 | fails 12 | no-fight |
| hop (community) | fails 10: stuck 2.07 (0.68), route failures 3.02 (0.31), redeploys 0.134 (0.052), spawn traps, team kills, one side never captures | fails 5: stuck 1.65 (1.36), route failures 4.38 (0.55), redeploys 0.115 (0.093), no capture | better-than-nothing |

No level passes with vehicles. Three of the four mod levels have no fight
(a side with no kill in some seed, enemy kills a tenth to a third of DICE's
floor). The fourth has one: **DC's Inshallah_Valley** has both sides
killing in every seed with the layer and without, passes 22 of 24 checks at
8 a side with the layer, and fails on route failures alone (1.43 a
bot-minute against 0.31). The tool calls it no-better-than-nothing because
its captures fall (5 a match to 4 at 8 a side, 6 to 3.5 at 16) and stuck
time on foot rises from next to nothing, while route failures fall from
13.2 to 1.4 and the kill rate doubles. What the layer changes, level by
level:

| Level, 8 a side | Route failures, no layer to generated | Enemy kills a bot-minute | Captures |
|---|---|---|---|
| DC_Basrah_Nights | 5.67 to 0.21 | 0.013 to 0.060 | 0 to 2 |
| FHSW Tunis | 16.29 to 5.08 | 0.006 to 0.019 | 1 to 4.5 |
| FHSW Pegasus | 0.867 to 2.5 | 0.044 to 0.022 | 0 to 0 |
| DC Inshallah_Valley | 13.22 to 1.43 | 0.142 to 0.318 | 5 to 4 |
| hop | 55.1 to 3.0 | 0 to 0.83 | 0 to 0 |
| _o_jka__big | 1.29 to 2.98 | 0.40 to 0.23 | 3 to 2.5 |

The three community levels are here because they place something to crew
(hop two guns, the _o_jka__ pair 10 and 22 spawners), so the gate now asks
them for a verdict with vehicles and their on-foot verdicts of 16.5 no
longer open anything. _o_jka__big fails on route failures alone at 8 a
side too, and is worse with the layer than without it. On _o_jka__
everybody is seated 99 % of the time and nobody kills, with the layer or
without.

The two FHSW layers were judged twice: once before the walk test's water
rule was corrected (18.6) and once after, on the layers as they now stand.
The outcome is the same and the figures above are the second run's.

### 18.8 What a mod's level still needs before it can go live

In the order the measurements put them:

1. **Bots that fight from a seat.** With vehicles on, three of the four
   mod levels judged have no fight, and it is not the layer: with no layer
   the same levels have none either (0.006 to 0.044 enemy kills a
   bot-minute). On DICE's four levels a seated side still kills (0.11
   a bot-minute at the median); on these the figure is 0.01 to 0.06. BF1918
   places twenty to thirty-five emplaced guns a level and the bots take
   them: on lutte_de_honneur a match's bots fire 6,473 gun rounds for one
   kill and no rifle shot at all. On Mauerfall six bots sit in one A7V that
   covers 153 m in five minutes, and every bot left on foot spends the
   whole match trying to board (Change and Avoid, 100 % of their time). The
   Change behaviour's share of alive time is 0.03 to 0.13 on DICE's levels
   with vehicles and up to 0.60 here. That is bot behaviour (when to leave
   a gun with nothing to shoot, when to stop wanting a seat), to be argued
   on DICE traces with a baseline rebuild, not a generator change.
2. **A hull's steering in a street.** FHSW's Pegasus is the measure: at 16
   a side hulls are stuck 27 s of every driving minute against a bar of
   2.2. The 1.5 m brush joins the map; the hull then has to keep to it.
   Inshallah_Valley, open ground with a 2 m brush, is at the bar (0.98 and
   2.08 s) and is the level to start from.
3. **The level's own data.** battle_of_the_vosges is published with no side
   on its bases (teams 0 and a value that is not a team), so neither side
   has a spawn; FH's Omaha Charlie and DC_Weapon_Bunkers have a side whose
   only spawns are on vehicles. Those are the `controlPoints` and `spawns`
   layers of the bake, not this feature.
4. **The wide levels.** On a 2048 m level with flags a kilometre apart the
   walk flood runs out of room, no map is written and the page paints its
   own. They are the "open ground" class and were censused, not worked on.
5. **A template by flag count** (16.7, and The_Maze's idle share).
6. **Cover values** where a level is patched with `--no-archives`.

### 18.9 Open, and not verified

1. Nothing in this phase was looked at in a browser, and no mod level was
   played.
2. The with-vehicles traces of Bocage, Kharkov, Stalingrad and El Alamein
   differ from the ones section 16.4 records (seed 3, 8 a side, 300 s). The
   committed viewer alone reproduces today's, so it is other work on
   vehicles committed since, not this phase: the one viewer edit here
   exports five constants from `bot-route.js`. The on-foot traces are byte
   for byte the same. The vehicle baseline was built on the tree as it
   stands and will move when vehicle code does; the on-foot one has not.
3. A soldier who drowns leaves no kill line in the trace, so the share of
   deaths no enemy caused does not count them. Found on FH's Pegasus (the
   canal). The walk test no longer sends anyone through water a soldier
   would swim in; the detector gap is open.
4. The redeploy line seen live ("is no more", -2) is not explained by the
   code read (18.2).
5. `CHOKE_MAX`, the brushes tried, the 40 m search for a hull's order
   position and the 3 m and 6 m of the choke test are this tool's choices;
   only the first is measured from DICE's levels.
6. The unused-unit and silent-tank detectors cannot tell a gun from a
   hull or name an armed seat that never fired (18.5).
7. Whether retail's bots queue in a corridor the same way was not looked
   at in the lab.
8. The engine's maps for a mod were tried on three levels, one per mod.
9. `publish_bot_layers.py` was read, not run, for a mod's layer.
10. From 16.7, still open: the stacked-floor figures, the stand-in for a
    person, the strategic maps, `createHomogenousCondition`.

## 19. Phase D, 2026-11-11: real kits, the page's doctrine, a bar from each mod, and a template by the flags in play

Two corrections came first, and every figure in this section is measured
after both: the community levels' bots had been holding a stand-in weapon
(19.1), and every match of sections 14 to 18 was played under the
engine's SAI doctrine where the page plays the garrison (19.2). Then the
bars were rebuilt (19.3), the two live levels judged again (19.4), the
strategy template chosen by the flags in play (19.5), each mod given a
bar of its own (19.6), and the Desert Combat levels and the community
levels with vehicles judged (19.7 to 19.9). Nothing was accepted,
published or committed here. The coordinator took shigaisen_B off the
page and recorded The_Maze's new acceptance from 19.4.

### 19.1 Sections 14 to 18 judged the community levels with a stand-in weapon

**Correction to sections 14 to 18.** Every figure those sections give for
a community level (shigaisen_B, The_Maze, hop, the two _o_jka__ levels,
omaturi_channel_sniper, the census rows of 16.1) was measured with bots
holding the runner's stand-in weapon, not their kits. The scratch
community tree's `_shared/loadouts.json` was a stale copy that held rows
for 24 levels, DICE's only; the published one holds 100. `sim/level.mjs
kitFor` deals no kit to a level with no row, and a bot with no kit fires
a generic weapon whose kills stop near 50 m. DICE's baselines and the mod
levels were not affected: their trees' loadouts have a row for every
level judged. Found by the coordinator, who also saw the live page agree
with matches run with kits, not with the stand-in ones.

What now stops it happening silently:

* **The lint** (`botlint.mjs kitsDealt`) has an error `kits`: a side whose
  row in the tree's `_shared/loadouts.json` names no kit that arms a bot.
  `botbatch level` and `census` then refuse the level (`unsuitable`)
  before a match is run.
* **The runner** says it: `summary.json` carries `botsWithoutKit`, and the
  printed summary ends with a `NO KIT` line. The trace is unchanged.
* **The detector** keeps `botsWithoutKit` on every row (from the trace
  header's bot list), and `botbatch` refuses a verdict (`unsuitable`,
  `noKit` in `verdict.json`) on matches any of whose bots had no kit, and
  refuses to build a baseline from them. That covers `matrix`, which runs
  no lint.

Checked on the real tree: The_Maze against the stale file gives the
`kits` error and a 2-a-side match prints `NO KIT: 4 of 4 bots`; against
the published file, neither. Tests: `tests/test_bot_bars.py
StandInWeaponTests`.

### 19.2 Every match before this section was played under the wrong doctrine

**Correction to sections 14 to 18.** `viewer/map.html` plays
`BOT_DOCTRINE = params.get('doctrine') || 'garrison'`; `sim/run.mjs`
defaults to `sai`, and `botbatch.mjs` passed no `--doctrine`. So both bars
and every verdict were of the engine's SAI, which a player never sees.
The garrison (`features/bot-garrison/README.md`,
`viewer/doctrine-garrison.js`) posts at most one guard a held flag and
sends everyone else to attack. Found by the coordinator.

`botbatch` now plays every match `--doctrine garrison` unless
`--doctrine sai` asks for the other on purpose (`DEFAULT_DOCTRINE`). The
run folders carry the doctrine (`v8-garrison`), so a run never resumes
from another's matches; each detector row records it (`detect.mjs
doctrineOf`, from the trace header, `sai` when the header names none); a
bar records it (`doctrine`, and in its note); `verdict.json` records it.
A bar of another doctrine than the run's, or rows of one, are refused
(`doctrineMismatch`), and an acceptance made under another doctrine is
withdrawn, not carried (`carryAccepted`). Tests: `tests/test_bot_bars.py
DoctrineTests`.

With no layer the two doctrines give the same matches to the digit
(shigaisen_B and The_Maze, all forty rows): a level with no strategic
layer gives the doctrine nothing to act on.

### 19.3 The bars under the garrison

`sim/baselines/onfoot-dice.json` and `sim/baselines/vehicles-dice.json`
rebuilt: the same four levels, 10 seeds, 600 s, 8 and 16 a side, under the
garrison, on the viewer with the merged seat fixes (230bc1d8e; the
with-vehicles bar was started after it). The SAI bars are kept in scratch.
p10 / p50 / p90, SAI then garrison:

| On foot | 8 a side | 16 a side |
|---|---|---|
| Enemy kills a bot-minute | 0.30 / 0.60 / 1.41, then 0.66 / 0.88 / 1.30 | 0.17 / 0.35 / 0.84, then 0.68 / 0.85 / 1.34 |
| Captures a match | 1 / 4 / 8.1, then 1 / 2 / 6 | 1 / 3 / 8, then 1 / 2 / 3.3 |
| Idle share | 0.16 / 0.36 / 0.53, then 0.04 / 0.08 / 0.27 | 0.39 / 0.58 / 0.72, then 0.03 / 0.07 / 0.27 |
| Route failures a bot-minute | 0 / 0 / 0.38, then 0 / 0.035 / 0.54 | 0.003 / 0.13 / 2.10, then 0.010 / 0.083 / 0.51 |
| Stuck seconds a bot-minute | p90 2.06, then 3.63 | p90 1.99, then 3.42 |
| Spawn traps a bot-minute | p90 0.143, then 0.201 | p90 0.079, then 0.143 |
| Team kills a bot-minute | p90 0.061, then 0.076 | p90 0.040, then 0.124 |

| With vehicles | 8 a side | 16 a side |
|---|---|---|
| Enemy kills a bot-minute | 0.036 / 0.121 / 0.48, then 0.18 / 0.32 / 0.64 | 0.076 / 0.158 / 0.59, then 0.38 / 0.46 / 0.74 |
| Captures a match | 0 / 2 / 4.1, then 1 / 2.5 / 7 | 1 / 2 / 4.1, then 1 / 2 / 5.1 |
| Idle share | 0.35 / 0.51 / 0.79, then 0.20 / 0.25 / 0.40 | 0.42 / 0.60 / 0.69, then 0.17 / 0.24 / 0.29 |
| Route failures a bot-minute | p90 0.16, then 0.50 | p90 0.86, then 1.62 |
| Hull stuck s a driving minute | p90 1.75, then 3.97 | p90 2.13, then 4.33 |
| Mounted share | p50 0.84, then 0.71 | p50 0.66, then 0.55 |

(The SAI with-vehicles column is the bar the merge of 230bc1d8e carried,
built by the other agent on the seat fixes; section 18.5's figures are
from before them.) Under the garrison the runner's kill rate with vehicles
lands where the coordinator's page matches do (0.32 and 0.46 at the
median; the page's DICE levels 0.22 to 0.40). The garrison's idle share is
a quarter of the SAI's: the "half a side at home" of 18.3 was the SAI's.

### 19.4 The two live levels, with kits and under the garrison

The committed layers as they were (generator 4 and 3), on foot, 10 seeds,
600 s, 8 and 16 a side, with and without the layer, against the garrison
on-foot bar. Medians; the bar in brackets.

| | The_Maze 8 | The_Maze 16 | shigaisen_B 8 | shigaisen_B 16 |
|---|---|---|---|---|
| Captures a match, layer (no layer) | 7 (0) | 6.5 (0) | **0 (2)** | **0 (2)** |
| Enemy kills a bot-minute | 0.83 (0.66) | 0.83 (0.68) | 1.81 | 1.96 |
| Route failures a bot-minute | **1.39 (0.54)** | **3.20 (0.51)** | **1.07** | **2.17** |
| Route failures, worse side | **2.61 (0.80)** | **4.15 (0.78)** | **1.24** | **3.36** |
| Spawn traps a bot-minute | 0.097 | 0.101 | **0.374 (0.201)** | **0.434 (0.143)** |
| Team kills a bot-minute | 0.057 (0.076) | 0.080 (0.124) | 0.072 | **0.309 (0.124)** |
| Idle share | 0.135 (0.27) | 0.104 (0.27) | 0.111 | 0.075 |
| Checks failed | 2 | 2 | 5 | 11 |
| Outcome | better-than-nothing | | **no-better-than-nothing** | |

With the stand-in weapon and the SAI the same layers had read: The_Maze
idle share failing at 8 a side (0.547), shigaisen_B passing at 8 a side.
With kits under the SAI (an intermediate run, not judged by): The_Maze
idle 0.53 and 0.56, kills 0.37 and 0.41; shigaisen_B captures 1 and 0.

Both verdicts are in the repo's layer folders, written by the tool with
the doctrine and the bar, the old acceptances withdrawn ("accepted on
matches under the sai doctrine"). The coordinator then took shigaisen_B
off the page and recorded a new acceptance on The_Maze, short of route
failures at both sizes.

**Where The_Maze's route failures are** (one traced match each, seed 1,
the committed layer, the garrison): 872 of 903 at 16 a side and all 177
at 8 a side are the Allies', all on foot, ordered to `center` and flag
`2`. They cluster at two places: around flag 2 (260 to 300, -520) and the
Allied base's exit (320 to 340, -760). In 71 % of them two or more
teammates stand within 6 m of the failing bot; over all on-foot
bot-seconds of the same match that is 29 %. So it is the mechanism of
18.1 (a teammate's 2 m circle shuts a passage three or four cells wide),
now with a whole side attacking through the same corridors. The route
probe already says so of one way: flag `1` from the Allies' side has 12
choke points (`routeProbe.chokes`), kept in play because the Axis reach
it openly.

Whether the probe's choke bar wants the garrison's numbers: no change was
made. `CHOKE_MAX` is a property of DICE's maps (one standing teammate on
the best route), not of a doctrine, and the maps did not change. What the
garrison changes is how many teammates stand in a passage at once, and the
probe tests one. A probe with two or three standing teammates, measured on
DICE's four levels under the garrison, is the test that would set a bar
for it. Not done.

**Why nobody takes a flag on shigaisen_B with the layer.** Each side
starts holding three flags and its base; no flag is neutral. Measured
from traced matches (8 a side, seeds 1 and 2, the garrison):

| | No layer | Committed layer | Kursk's template | One always-live attack | Layer, page-painted map |
|---|---|---|---|---|---|
| Captures a match (10 seeds, median) | 2 | 0 | 0 | 0 | 0.5 |
| Alive ticks inside an enemy-held ring, Axis / Allies | 0.17 / 0, 0.05 / 0 | 0 / 0, 0.02 / 0.01 | 0.008 / 0.025 | | |
| Axis ordered to the centre bridge, distance to it p10 / p50 | 7 / 53 m | | 52 / 89 m | | |
| Victims, where on the line own base (0) to enemy base (1) | mostly 0.4 to 0.6 | mostly 0.3 to 0.5 | 0.3 to 0.4 | | |

* With the committed layer both sides are in Kharkov's `finalPush` from
  the first pass (the page counts flags held plus owned areas flagged
  `ControlPoint`, so three flags held is six). `finalPush` weighs `Close`
  hostile areas: the Axis is ordered 66 % of the time to the Allies'
  southBridge_east and the Allies 68 % to the Axis' minka_south, the two
  flags deepest in the enemy's half. With no layer every bot of a side
  goes to the one nearest enemy flag (the page's fallback order: 100 % of
  the Axis at the centre bridge).
* So the template was tried first, and it is not the cause: Kursk's
  template (no strategy live at the start, so attack values alone pick the
  target: the Axis at the centre bridge 73 %) and a template of one attack
  strategy always live both give no capture in twenty matches.
* Nor is the layer's map: the same layer with its engine maps taken out,
  so that the page paints its own as with no layer, gives 0.5 and 0
  captures.
* What every layered run shares and the no-layer run does not: the
  garrison's posts and the strategic areas' orders. The posts hold 8 to 16
  % of a side's alive ticks (`WPPost`), not half. Attackers ordered to the
  centre bridge stop 89 m short at the median against 53 m with no layer,
  and die on their own half.

The cause is not found. Ruled out by measurement: the template, the map
and the split between targets. Not tested: the garrison's posts (no way to
turn them off from the generator or the runner without a viewer change)
and the areas' order positions. No generator change was made for it.

### 19.5 A strategy template chosen by the flags in play

**Why Kharkov's template kept half a side at home under the SAI.** One
traced match of The_Maze, 8 a side, seed 1, the SAI, stand-in weapon: the
Allies spent the whole match in Kharkov's `bridge`, the Axis 11 % of it;
the Allies' bots were ordered to their own base for 55 % of their alive
ticks, the Axis' for 30 %. Kharkov's four strategies on the page:

* `normal` (aggression 1.0, one attack, no defence) is gated on
  `constantCond`, `Crisp Equal Enemy UnitConstant 1`. The page's state
  table has no `UnitConstant` (`viewer/strategic-ai.js _updateStates`), so
  the state reads 0, the Required condition fails and `normal` scores 0 in
  every pass. On the page it is never chosen.
* `bridge` (aggression 0.5, one attack, **one defence**) is gated on
  `Friendly ControlPoint == 1`. A side holding its base alone takes it,
  and half its bots defend the one area it owns: a base nobody can take.
* `finalPush` needs three held (the page's count, 19.4), `breakOut` none.

What retail does with `UnitConstant`, from the Linux server
(`bf1942_lnxded.static`): it is value 0x2f of
`StrategyCondition::Conditional` (`operator>>` stores `0x2f` after its
string compare at 0x08488142), the last of the 48 state slots.
`SCConstant::compare` (0x08639250) reads `states[conditional]` with no
special case, and `SAI::updateStates` (0x086348c0) writes nothing at that
slot (offset 0xbc). What else, if anything, writes it was not found, so
whether `normal` is ever live in retail is open. A viewer question, not
changed.

**What DICE's levels with few flags do** (published `scene.json` `ai`
blocks; Kursk read from `Kursk_003.rfa`): Kursk, the vanilla level with
the fewest capturable flags (two), gates its attacks on the enemy's count
(`maxOneEnemyCP`, `Enemy ControlPoint <= 1`): `single` and `double`
(aggression 1.0, no defence) are live from the first pass; its one
defending strategy, `holdAndCamp`, asks for exactly two held and five
hostile areas. Kharkov, Bocage, El Alamein and Berlin (three capturable
each) mix aggression 0.65 to 1.0 with one or two defences.

**The change** (generator version 5, `botgen.mjs templateFor`): the
template is chosen by the capturable flags left in play after the walk
test and the route probe: up to three (`FEW_FLAGS`), DICE's Kursk,
unchanged, as `bot-layers/_templates/few`; more, Kharkov's as before
(`symmetric`). `generated.json` records the choice (`templateChoice`);
`--template` forces one. INVENTION: the rule and the threshold are this
tool's. Tests: `tests/test_bot_bars.py TemplateChoiceTests`.

**Measured under the garrison** (10 seeds, 600 s, with kits). The idle
share the template was meant for is gone under the garrison, so the
question became whether it still helps:

| | Kharkov's (committed) | Kursk's |
|---|---|---|
| The_Maze, on foot, 8 a side | fails route failures (1.39, bar 0.54) | **passes every check**: route failures 0.45, captures 10, kills 0.93 |
| The_Maze, 16 a side | fails route failures (3.20, bar 0.51) | fails route failures (1.49) |
| _o_jka__big, with vehicles (19.9) | fails 2 at 8 a side (self deaths, spawn traps), 3 at 16 | fails 1 at 8 a side (self deaths), 2 at 16 (idle share, self deaths) |
| shigaisen_B (five in play, so Kharkov's by the rule; Kursk's forced) | 0 captures | 0 captures |
| Inshallah_Valley (five in play; Kursk's forced, SAI runs) | 4 and 3.5 captures | 3 and 3.5; no better |

Every check Kharkov's layer passes on The_Maze, Kursk's passes too. The
coordinator asked for it to replace the committed layer through the tool;
19.12 says what was written.

Under the SAI and the stand-in weapon (before 19.1 and 19.2) Kursk's
template had cut The_Maze's idle share from 0.55 to 0.20 at 8 a side; it
is not judged by.

### 19.6 A bar from each mod's own botted levels

`botbatch baseline --vehicles --mod <Mod>` runs a mod's own shipped bot
levels the way `vehicles-dice.json` is built and writes
`sim/baselines/vehicles-<mod>.json` with the doctrine, `levelsAlive` and
`dropped`: a level with no fight by the tool's own alive checks (each side
kills in every seed, both lose tickets in every seed, no bot error) is left
out and named with the checks it failed, as 18.5 did for Battleaxe and
Wake.

**The rule** (`judge.mjs chooseBar`): a mod level's verdict is against its
own mod's bar when that bar holds at least three alive levels
(`MOD_BAR_MIN_LEVELS`); otherwise against DICE's. A vanilla or community
level is always against DICE's. The alive checks are the same three tests
under either bar. `verdict.json` says which (`bar.against`, `bar.why`)
and, when it is the mod's, keeps the verdict against DICE's beside it
(`againstDice`); a mod bar too thin to judge by is still reported
(`againstOwnMod`). The console line names the bar and prints the other.
Tests: `tests/test_bot_bars.py ModBarTests`.

**Desert Combat** (`vehicles-desertcombat.json`, the garrison, the merged
viewer): six of DC's botted levels, its two own (DC_Basrahs_Edge,
DC_DesertShield) and four of its remakes of DICE's (Kharkov, Stalingrad,
Kursk, Berlin, fetched with `getlevel2.py`). Two are dropped:
DC_Basrahs_Edge (a side with no kill in two seeds of ten at 8 a side) and
Stalingrad (a side with no kill and no ticket lost in one seed at 8 a
side). Kept: Berlin, DC_DesertShield, Kharkov, Kursk, so DC's bar judges.

**Read it as a low bar.** Three of its four levels are DICE's layouts with
DC's vehicles; the one DC original kept, DC_DesertShield, fights at 0.14
and 0.15 enemy kills a bot-minute, under half of DICE's median, and its
route failures (8 to 9 a bot-minute) set DC's route-failure bar. On the
live page, by the coordinator's page matches, DC_DesertShield fights at
0.044 with 8 of 15 deaths suicides. The bar's kill median is
DICE-like only because of the three remakes. A DC level that passes DC's
bar has not been shown to play like a DICE level.

| Garrison, with vehicles, p10 / p50 / p90 | DICE 8 | DC 8 | DICE 16 | DC 16 |
|---|---|---|---|---|
| Enemy kills a bot-minute | 0.18 / 0.32 / 0.64 | 0.09 / 0.38 / 0.53 | 0.38 / 0.46 / 0.74 | 0.14 / 0.47 / 0.90 |
| of which DC_DesertShield's median | | 0.138 | | 0.149 |
| Captures a match | 1 / 2.5 / 7 | 0 / 3 / 6 | 1 / 2 / 5.1 | 1 / 3 / 5.1 |
| Route failures a bot-minute | p90 0.50 | p90 10.3 | p90 1.62 | p90 9.0 |
| Route failures, worse side | p90 0.95 | p90 12.5 | p90 2.75 | p90 11.0 |
| Idle share | p90 0.40 | p90 0.46 | p90 0.29 | p90 0.35 |
| Units never used | p90 0.29 | p90 0.50 | p90 0.23 | p90 0.26 |
| Flag coverage, least of the levels | 0.333 | 1.0 | 0.333 | 1.0 |

On DC's bar route failures stop failing anything, and flag coverage must
be 1.0: every capturable flag taken in some seed. Per level, medians
(8 / 16 a side): enemy kills DC_Basrahs_Edge 0.063 / 0.203, DesertShield
0.138 / 0.149, Kharkov 0.414 / 0.529, Kursk 0.421 / 0.438, Stalingrad
0.354 / 0.505, Berlin 0.372 / 0.869.

An SAI build of the same bar (before 19.2, on the viewer before the
merge) is kept in scratch and not used.

### 19.7 Inshallah_Valley

Ten seeds, 600 s, with vehicles, the garrison, the merged viewer, the
generated layer (five capturable flags in play, so Kharkov's template)
against no layer. Judged against DC's own bar by the rule; DICE's beside
it.

| | 8 a side | 16 a side |
|---|---|---|
| Against DC's bar | fails 2 of 24: flag coverage 0.6 (1.0), redeploys, worse side 0.154 (0.148) | fails 1: flag coverage 0.4 (1.0) |
| Against DICE's bar | fails 5: route failures 1.15 (0.50), worse side 1.49 (0.95), redeploys 0.082 (0.074), worse side 0.154 (0.124), units never used 0.375 (0.29) | **passes all 24** |
| Captures a match, layer (no layer) | 4.5 (3.5) | **2 (7)** |
| Enemy kills a bot-minute, layer (no layer) | 0.36 (0.12) | 0.41 (0.20) |
| Route failures a bot-minute, layer (no layer) | 1.15 (12.1) | 1.36 (7.4) |
| Outcome | **no-better-than-nothing** (captures fall at 16 a side) | |

Under both bars both sides kill in every seed. It is the nearest mod level
to a pass: at 16 a side it clears every check of DICE's own bar, and the
one check of DC's it fails asks that the two bases (capturable flags here,
no fixed base) change hands, which they do in no seed with the layer or
without.

**Why captures fall.** With the layer the Outpost (434, -622) never
changes hands at 16 a side and in 8 of 10 seeds at 8, where with no layer
it does: at 16 a side Iraq's captures fall from 4 a match to 0. The generator gives the
centre flag (the Village) the value 300 and the flanks 150, as DICE's
Stalingrad does. Kharkov's strategies attack one target (`NumberOfAttacks
1`, and a second only within 0.8 of the first), so with the Village
contested the Outpost is never the target. Separated by experiment: the
same layer with the Outpost's value alone raised to 300 (all else byte for
byte the same, ten seeds): the Outpost changes hands in 9 of 10 seeds at 8
a side and 10 of 10 at 16, captures go to 5.5 and 5. It is not adopted:
kills fall (0.36 to 0.24, 0.41 to 0.26), route failures rise (1.15 to
2.14), and at 16 a side captures are still under the no-layer level's 7,
so the outcome would not change. A rule for the area values against the
template's attack count is open.

**Where the route failures are.** Under the garrison, 8 a side, ten
traced matches: 2,106 failures, 68 % of them from a seat (the US side's
Humvee_TOW 364, Iraq's T72 318 and Shilka 278 lead), clustered at the US
base (820, -560), the Village (560, -380) and Iraq's base (360, -280); on
foot, Iraq's base (320, -300). One bot-life holds 362 of them and the top
tenth of lives 53 %: hulls that fail over and over where they stand.
On the bare tank map every land-vehicle spawner but one has a route to
every flag (a Shilka at 193, -370 sits in a pocket of it); so it is where
hulls end up, not the map. Under the SAI (before 19.2), the on-foot
failures were a narrow ford south of the Small Village (depth 0.5 to 1.3
m, a few cells wide between deeper water) with teammates within 6 m at
44 % of failures against 23 % of bot-seconds; the route probe closes every
way from every spawn group on the bare map, ford included. No generator
change: the hull failures want a hull probe in the lint (a vehicle
spawner whose crew has no route on the Tank map: one of fourteen here),
not built.

### 19.8 DC_Basrah_Nights

| | 8 a side | 16 a side |
|---|---|---|
| Against DC's bar | fails 6: stuck 1.64 (1.48), idle share 0.544 (0.459), team kills 0.069 (0.055), stuck worse side, redeploys worse side 0.34 (0.15), units never used 0.75 (0.50) | fails 3: idle 0.544 (0.345), redeploys worse side 0.40 (0.23), units never used 0.75 (0.26) |
| Against DICE's bar | fails 9 | fails 7, among them enemy kills 0.363 (0.375) |
| Captures, layer (no layer) | 6 (0) | 5 (0) |
| Enemy kills a bot-minute, layer (no layer) | 0.35 (0.013) | 0.36 (0.020) |
| Outcome | **no-better-than-nothing** | |

Under the garrison it has a fight with the layer (both sides kill in every
seed), which it did not under the SAI (18.7). The level with no layer has
next to none (0.013 and 0.020 enemy kills a bot-minute, no side kills in 7
seeds of 10 at 8 a side), and the layer is "no better" than it because
stuck time and redeploys rise from the near-zero of bots that do not move
(0.15 to 1.64 stuck seconds; 0.025 to 0.12 redeploys). The judge leaves
out spawn traps against a dead no-layer level (`NEEDS_A_FIGHT`) but not
stuck time or redeploys. That is the judge's rule as it stands, reported,
not changed.

**Changed afterwards, the same day, by the coordinator**
(`botbatch.mjs betterThanNothing`, `fightOnlyWithLayer`): at a side size
where the level with no layer has no fight by the alive checks and the
layer's matches have one, the layer is better at that size once it
captures at least as much, and no movement rate decides. It is the
reasoning `NEEDS_A_FIGHT` already wrote down, taken to its end: bots that
do not move do not get stuck. Re-judged from the same matches,
DC_Basrah_Nights is better at 8 a side by that rule (no side kills in 7
seeds of 10 with no layer) and **still not at 16**, where the level with no
layer passes the alive checks on 0.020 enemy kills a bot-minute and no
capture, and the old comparison counts the layer's stuck time, redeploys
and spawn traps against it. So its outcome stands: no-better-than-nothing.
Whether a level that goes from 0.02 kills and no capture to 0.36 kills and
5 captures should be called better is a question about the rule, left for
the owner. Tests: `test_a_fight_where_the_level_with_no_layer_has_none_is_
better_than_nothing`.

**The unused units**: the level places eight. Four are fixed guns
(`Stationary_browning` on `machinegunspawner`, two at leftspawn and two at
rightspawn), four are cars (a Technical and a Humvee on the bases' scout
car spawners, a Pickup and a Lada). Only the Pickup and the Humvee were
ever seated; so of the six never used, four are the guns and two are the
Technical and the Lada. The idle share is mostly the Iraqi side Scouting
or Idle with no target, ordered to flags it holds (USspawn 12 % of all
alive ticks, centerspawn 7 %): one seed traced, not separated further.

### 19.9 hop and the _o_jka__ pair, with vehicles, kits and the garrison

The committed layers (generator 4), with the level's vehicles and guns,
10 seeds, 600 s, against the garrison with-vehicles bar.

| Level | 8 a side | 16 a side | Outcome |
|---|---|---|---|
| hop | fails 12, among them no capture, stuck 2.73 (1.20), route failures 2.44 (0.50), spawn traps 0.32 (0.095), team kills 0.073 (0.034) | fails 8, no capture, route failures 5.31 (1.62) | better-than-nothing (with no layer: no kill in any seed, 52 route failures a bot-minute) |
| _o_jka__big | fails 2: self deaths 0.063 (0.052), spawn traps 0.098 (0.095) | fails 3: idle share 0.326 (0.295), self deaths 0.095 (0.064), spawn traps 0.096 (0.095) | no-better-than-nothing (spawn traps rise against no layer) |
| _o_jka__big, Kursk's template (the generator's choice: one flag in play) | fails 1: self deaths 0.068 | fails 2: idle share 0.311, self deaths 0.082 | no-better-than-nothing (16 a side captures 4 against 4.5 with no layer) |
| _o_jka__ | no-fight: no kill, no capture | no-fight | no-fight |

hop under the SAI with the stand-in weapon read better-than-nothing (18.7),
then no-fight with kits under the SAI (a side with no kill in two seeds);
under the garrison it fights (1.34 and 0.83 enemy kills a bot-minute) and
nobody takes a base. _o_jka__big is two near-misses from a pass; its self
deaths (a bot killed by its own hand or hull) are the one check neither
template clears. Not diagnosed.

The verdicts of all three are in their layer folders, written by the tool
under the garrison; none of the three carried an acceptance.

### 19.10 Forgotten Hope's own levels have no bar

Three of Forgotten Hope's published botted levels (Operation_Goodwood,
Prokhorovka, Gold_Beach; the others are the island and carrier levels Iwo
Jima, Midway and Tarawa), run the same way: every one fails the
alive checks, so `vehicles-fh.json` holds no level (`levelsAlive` empty,
all three in `dropped`) and FH levels are judged against DICE's bar.

| Level | Enemy kills a bot-minute, 8 / 16 a side | Seeds of ten with a side that never kills, 8 / 16 | Captures, 8 / 16 |
|---|---|---|---|
| Operation_Goodwood-1944 | 0.038 / 0.065 | 3 / 1 (and a side that loses no ticket) | 2 / 2 |
| Prokhorovka-1943 | 0.050 / 0.057 | 2 / 2 | 1 / 1 |
| Gold_Beach-1944 | 0.076 / 0.113 | 6 / 0 | 1 / 2 |

So FH's own layers, played by the page's bots with vehicles, fight at an
eighth to a quarter of DICE's median (0.32 and 0.46). That is the mod's own
standard as the runner plays it, and it says the same thing the census of
18.6 did about FH's botless levels: with vehicles in, the page's bots do
not fight on FH's ground.

FHSW's bar (Falaise_Pocket, Kharkov_Winter, Operation_Nordwind,
The_Storm, Counterattack, all 1024 m and botted, fetched to the scratch
tree) was started and stopped unfinished; FHSW levels are
judged against DICE's.

### 19.11 A gun nobody can reach (BF1918 Mauerfall), evaluated

The other agent's traces showed Mauerfall's on-foot bots spending the
match trying to board a gun on a tower, and suggested the generator or
the lint mark a gun as unreachable when its seat is more than about 12 m
above the walk point behind it. Checked:

* **The case.** Section 18's Mauerfall match (seed 1, with vehicles, the
  SAI): 1,092 bot-seconds of the `Change` behaviour went to one gun (the next
  target had 13), a Maxima_M1910 at 612.5, 94.4, -578.4 (the `Turm`
  spawner), its would-be crew standing at a median 615, 78, -586, 17.7 m
  from it and 16 m below. It was never mounted.
* **A reach test instead of a height.** For every object spawner of a
  level, whether the walk flood (`walkflood.mjs walkedGround`, the same
  one the walk test runs from the soldier spawns) stands anywhere within
  4 m of it and from 2.5 m below it to 1 m above. Scratch script, not
  in the repo.
* **Mauerfall**: 6 of 64 spawners fail it: the tower Maxima, a
  `werfer16` and a `ger_flamer` on the same kind of tower (18.2 m over the
  terrain, no walked place near), a `flammenbunker` with walked ground
  20.5 m below, and two `gotha_br` bombers that spawn 110 to 125 m up
  (air spawns, not guns).
* **DICE's levels**, the same test: Kharkov 0 of 23; Berlin 1 of 10 (an
  MG42 11.4 m over the walked ground); Stalingrad 1 of 17 (a Browning
  4 m over); Bocage 2 of 24 (an MG42 9.3 m over, and the B17 on its pad);
  Omaha Beach 3 of 18 (the destroyer, two `Defgun` 1.5 m below the
  walked floor at 3 m); El Alamein 3 of 48 (the B17, a Willy and a
  Kubelwagen whose spawn the flood does not reach).

So a 12 m threshold would have marked Mauerfall's three tower guns and
none of DICE's, but by 0.6 m on Berlin's MG42, and height is not what
decides it: DICE places guns 9 to 11 m up on structures, and whether a
bot can reach one is a question of a way up (a ladder, which the page's
soldier does not climb: section 16.1), not of a number. The reach test
answers that directly, and it flags DICE's guns too, which says the page's
bots cannot reach those either; whether retail's do is not known here.

**Decision: not built into the generator.** The generator does not place
guns and cannot keep a bot from wanting a seat; the behaviour that sends
a bot to a seat with no way to it is the viewer's (`Change`, its seat
choice). The useful form is a lint warning naming the guns the walk test
cannot stand near, and a `Change` that skips a seat its bot has no route
to. Both are open; the second is a viewer change for the other agent.

### 19.12 What changed, and where it is

* `sim/botbatch.mjs`: `--doctrine` (default `garrison`) on every match,
  run folders by doctrine, `doctrineMismatch` refusals,
  `baseline --mod` (a mod's own bar, its dead levels dropped), the bar
  choice and `verdictWithBar` (`againstDice`, `againstOwnMod`),
  `noKitRefusal`, `--template`, `--mod-baseline`; an acceptance does not
  cross doctrines.
* `sim/judge.mjs`: `aliveLevels`, `chooseBar`, `MOD_BAR_MIN_LEVELS`.
* `sim/botgen.mjs`: generator version 5, `templateFor`, `FEW_FLAGS`,
  `templateChoice` in the marker.
* `sim/botlint.mjs`: `kitsDealt` and the `kits` error.
* `sim/detect.mjs`: `botsWithoutKit` and `doctrine` on every row.
* `sim/run.mjs`: `botsWithoutKit` in `summary.json` and the `NO KIT` line
  (the trace is unchanged).
* `bot-layers/_templates/few/`: DICE's Kursk strategies, unchanged.
* `sim/baselines/onfoot-dice.json`, `vehicles-dice.json` rebuilt under the
  garrison; `vehicles-desertcombat.json` new.
* Layers and verdicts written by the tool: The_Maze (generator 5, Kursk's
  template, the coordinator's acceptance carried by the tool's own rule),
  shigaisen_B, hop, _o_jka__big, _o_jka__ (verdicts only), Inshallah_Valley
  and DC_Basrah_Nights (verdicts, and a version-5 marker on unchanged
  layer files). FHSW's Pegasus and Tunis still carry section 18's SAI
  verdicts: not re-run.
* Tests: `tests/test_bot_bars.py` with `tests/bot_bars_harness.mjs`
  (templates, mod bars, the stand-in weapon, the doctrine). The scratch
  community tree's `_shared/loadouts.json` was refreshed from the
  published one, the stale copy kept beside it.

### 19.13 Open, and not verified

1. No runner verdict here was checked against a page match by this
   section: the published layers (The_Maze, shigaisen_B) were measured on
   the page by the coordinator; the rest are scratch layers, which cannot
   be on the page.
2. The page's team-kill rate is several times the runner's with kits
   (about 0.09 to 0.27 a bot-minute on the page against 0.03): the
   coordinator's finding, not chased.
3. shigaisen_B's lost captures: the template, the map and the split of
   targets are ruled out; the garrison's posts and the areas' order
   positions are not tested (19.4).
4. The_Maze's remaining route failures want a probe with more than one
   standing teammate, and a bar for it from DICE's levels under the
   garrison (19.4). Not built.
5. Area values against a template's attack count (Inshallah's Outpost,
   19.7): a rule is open.
6. The judge compares stuck time and redeploys against a no-layer level
   with no fight (DC_Basrah_Nights, 19.8); whether those belong with spawn
   traps in `NEEDS_A_FIGHT` was not decided.
7. A hull probe in the lint (a vehicle spawner whose crew has no route on
   the Tank map) and a gun-reach warning (19.11): not built.
8. `UnitConstant` in retail (19.5): what writes slot 0x2f was not found.
9. FHSW's own bar was not built (19.10).
10. The mod bars inherit the runner's vehicle behaviour; they move when
    seat or vehicle code moves, and want a rebuild with DICE's whenever it
    does.
