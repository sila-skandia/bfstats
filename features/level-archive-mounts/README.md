# Level archive mounts: what a level bake reads, the way the engine loads a level

Status: built 2026-09-30 for the Desert Combat and DC Final level audit. The
two DC trees are re-baked and patched; vanilla, XPack1, XPack2 and EoD are not
(section 7 lists what a re-bake would change there). Section 8, from the FHSW
level audit the same day, narrows section 5 to the scripts `Init.con` reaches
and orders the mod's `objects/` the engine's way; no tree is re-baked for it.

A level bake read a level as if it were one archive plus the mod's global
objects. The engine does not: every level archive of the mod chain is mounted
at its own path, a level's `Init.con` runs its own object scripts before the
mod's `objects/`, `textureManager.alternativePath` builds a list, and a child
template is found by name wherever it is declared. Each difference cost Desert
Combat something visible or playable. The engine rows are LOAD-1..LOAD-6,
SPAWN-8, SPAWNGRP-8 and SPAWNGRP-9 in the
[ledger](../bf1942-engine-reference/ledger.md).

## 1. Spawn points carried by placed objects

`_vehicle_soldier_spawn_report` looked for a spawned object's `Objects.con` by
folder name (`Objects/Vehicles/Sea/<name>/`, `Objects/<name>/`, then the
`Vehicles/Sea` files) and read `addTemplate` children from that one file. An
`addTemplate` names a template of the one namespace (SPAWN-8), so:

| Level | What carries the spawns | Groups (team) |
|---|---|---|
| DC_No_Fly_Zone_Day2, both trees | hangars, towers, radar domes an ObjectSpawner places, each adding `Opp_Airbase_Spawn` / `Coal_Airbase_Spawn` from `objects/Opp_Airbase_Spawn_group/`. `SoldierSpawns.con` is empty | 99 (1), 97 (2); 21 points each |
| DC_Weapon_Bunkers, both trees | the bunkers' `Opp_WB_Spawn` bundle | 99 (1); 35 points |
| DC_Urban_Siege, both trees | `Nimitz_Static_Heli_UrbS`, folder `objects/Nimitz` | 72, 74 (2); 73 is `setEnterOnSpawn 1` |
| DC_Operation_Bragg, both trees | the Talil buildings (`talil_spawns_iraq` / `_us`) | 8 (1), 7 (2) |
| DC's AC-130 (Gazala, El Alamein CTF, El Alamein Day 2, Operation Bragg, DC Final First Light) | `vehicles/air/AC-130`, parked | 74 (2) |
| Battle of Britain (DC Final tree; vanilla and the packs too) | `Britain_Factory` adds `Allies_Factory_Spawn` | 99 (2) |

`extract_map.TemplateIndex` indexes every `ObjectTemplate.create` block of the
objects pool once per level (about 0.2 s for DC Final's 3,400 scripts): kind,
children with their `setPosition` and yaw, and a `SpawnPoint`'s group, id,
paratrooper and enter-on-spawn words. The first declaration of a name owns it
(LOAD-1), in the engine's load order (`LevelFirst`, section 5), and
`active <name>` reopens a block. `spawn_points(root)` walks the tree by name,
composing offsets as before; output order for the old single-file cases is
unchanged (every vanilla, XPack1, XPack2 and EoD deck spawn compared equal,
old resolver against new on the same pools).

A group's side still comes from the level's `groupTeam`, then
`Bf1942/Game/GlobalSpawnGroups.con`. The carrier's own team never reaches it
(SPAWNGRP-9): Urban Siege's Nimitz groups are Desert Combat's global 72..74,
bound to the US side.

Not missing, checked against the data: DC_No_Fly_Zone (both trees) places its
airbase as `_m1` statics without the spawn bundles, and nothing places the
`_des` buildings that carry them; DC Final First Light likewise (group 70 is
`mil_wpbunker_des`, never placed; its CTF `airsupremacyspawn*` placements name
templates declared nowhere); Medina Ridge's `FlagBox` declares three
`Factory_DestSoldierSpawn` points (group 5) that no template adds. The engine
creates none of these.

## 2. Another level's files

`GeometryTemplate.file ../bf1942/levels/DC_No_Fly_Zone/standardMesh/...` is
read from under `standardMesh/`, so the engine opens that level's archive
(LOAD-4). `ArchivePool` now resolves `..` in a lookup (`rfa._key`), and
`mount_level` registers a level archive's files under their full paths only
(no basename, no `standardMesh/` tail). `extract_map.mount_level_pools` mounts
every level archive of the chain, nearest mod and newest patch first
(`chain_level_archives`), for meshes (`.sm`, `.rs`) and images. Measured over
every installed mod's global objects: the `..` resolution changes no model's
mesh (251 DC Final, 250 Desert Combat, 2 FH paths, all resolved before by
basename to the same file).

## 3. A level's own textures

`add_level` registered a level image under its full path only when its
`texture/<basename>` key was free, so a level's own copy of a texture the mod
also ships (its sky, its reskins) could never answer `alternativePath` or a
full-path shader, and the bake registered every other level before the
current one. Now every image of a level archive is registered under its full
path, the current level goes first, and every `textureManager.alternativePath`
line is kept in order (`LevelInfo.texture_alternative_paths`): the word
appends to a list the loader probes front to back (LOAD-3). What it fixed:
the skies of 15 DC levels (Basrah Nights at night, First Light at dusk, Bragg
dark, Oil Fields brown), Basrah Nights' alpha-tested lamp cones, 73 Easting's
table map and tents, Coastal Hammer's 68 `CustomTextures` reskins, the Humvee
and TOW skins of the DC Final remakes, and the theatre skins of levels that
name a theatre folder and their own (DC Final Berlin's Russian Willys).

## 4. Object scripts outside `Objects/`

`add_level_objects` takes a level's `Objects/` subtree. Al Nas runs a root
`objects.con` (its bridges, bridge huts and market stands), Twin Rivers another
and Coastal Hammer `CustomObjects/INIT` (houses, sidewalk blocks, planks, and
their meshes in `CustomMeshes/`). `extract_map.level_object_scripts` follows
the run graph from `Init.con` the way a host runs it and returns the scripts
outside `Objects/`, `Init/`, `Sound(s)/` and `Menu/` (those have readers of
their own); `add_level_objects(extra=)` registers them. Level archives are
also registered nearest mod first now, as `LevelFiles` already overlays them.

## 5. A level's templates win

`Game::load` empties the object namespace, runs the level's `Init.con` and then
every script under `objects/`, and a second `create` of a name makes nothing
(LOAD-1, LOAD-2). So a level that redeclares a mod template (DC Basrah Nights'
street lamp, Bragg's cockpits, Twin Rivers' fences, Basrah's Edge market
buildings, Kasserine Pass's interiors) is drawn with its own. `LevelFirst`
hands `build_library` and `TemplateIndex` the level's scripts first. The pool's
path rule is unchanged, so kit and pose extraction, which read level templates
behind the global ones, are unaffected. Geometry templates are not emptied per
level on a server that has run others (LOAD-2); a bake models a first load.

## 6. What was re-baked, and how it was checked

A resolution fingerprint (every mesh, shader and texture the placed objects,
sky and water resolve to, with the archive file) was taken with HEAD's code
and with this change for every level of both trees: 13 of 35 differ in
`desertcombat`, 41 of 48 in `dc_final`. With the levels the cockpit change
`64e08482` needed (the gunner sight pane), 15 and 44 levels were re-baked from
a detached worktree at `64e08482` plus this change only, one at a time, into an
on-disk staging tree, then promoted without touching files the bake does not
own (`load.webp`, the loading rows of `maps.json`) and optimised in place. The
`sounds` key of each re-baked `scene.json` was put back as it was: another
change in flight owns that layer, and HEAD's copy would have dropped Al Nas's
radio emitters that it had added. `patch_scene.py --layer spawns --all` over
both trees then wrote nothing: every layer matches the bake.

| Level (tree) | Objects placed | missingMeshes | Carried spawns |
|---|---|---|---|
| DC_No_Fly_Zone_Day2 (both) | 1541 -> 1583 | 32 -> 19 | 0 -> 42 (21 a side) |
| DC_Al_Nas / Day 2 (DC Final) | 580 -> 717 / 572 -> 711 | unchanged | unchanged |
| DC_Coastal_Hammer (DC Final) | 1392 -> 1751 | unchanged | - |
| DC_Bridge (DC Final) | 392 -> 418 | 3 -> 0 | - |
| DC_Operation_Bragg (both) | 932 -> 940 | 21 -> 17, 28 -> 24 | 0 -> 27 over three modes |
| DC_Weapon_Bunkers (both) | unchanged | unchanged | 0 -> 35 per mode |
| DC_Medina_Ridge (both) | unchanged (+125 landslide parts) | the landslide box resolves | - |

The rest of the missingMeshes are vehicle parts that ship in no archive (A-10
and SU-25 flaps, `M82Load`, `\Humvee\Humvee_Windows`). DC Final Coral Sea
now draws its own carriers' AA batteries and the jets its own spawners park
(section 5), so it lists seven such parts it did not before, and its two
aircraft deck spawns sit about 10 m from where they were, on the deck
(checked headless: the soldier stands on the Hornet between an F-16 and an
AV-8).

Spawns (`spawnteams.mjs`, the viewer's own `spawnFlags()`): every DC and DC
Final level gives both teams a flag in every mode. A headless check of No Fly
Zone Day 2, Weapon Bunkers, Urban Siege (on the Nimitz deck), Basrah Nights,
Al Nas and Coastal Hammer spawned a grounded soldier on each.

## 7. Open

* Not re-baked here, would change on their next bake: vanilla Battle of
  Britain (its own sky; the factory spawns), Kasserine Pass (102 AltTextures
  desert skins, its own interiors), Liberation of Caen (its own sky; one
  texture used to come from Battle of Britain's archive), Truk (130 of its own
  textures and the Pacific theatre skins); XPack2 Essen's paradrop (group 101
  is bound, SPAWNGRP-8) and the same Battle of Britain in XPack1/XPack2; EoD
  gains carried spawns on 7 levels (M113-Y group 81, Operation Linebacker's
  SA-2 bunkers).
* Templates declared in a level's `Sounds/*.con` (`rivermid`, `coastline`) and
  in `Init/SkyAndSun.con` (`TSun`, which Basrah Nights' lamps add as a child)
  stay out of the library; they are read by the sounds and sky readers.
* Absent from the install, not a pipeline miss: First Light's
  `utility_pole_tele_1bar` and `utility_pole_xformer`, Cornered's
  `sidewalkli_m1`.
* The model catalogue's per-level skins (`level_texture_names`) still read only
  `AltTextures/`, `Texture(s)/` and `Custom Textures/`, not `CustomTextures/`
  or `objectTexture(s)/`.

## 8. The FHSW audit: which level scripts run, and in what order

Section 5 put every `.con` of a level archive ahead of the mod's. The engine
runs only what the level's `Init.con` reaches: the level archive is mounted at
`bf1942/levels/<L>/`, outside the `objects/` listing `loadAllConFiles` walks
(LOAD-2). FHSW's Fall of Berlin ships `Objects/lightingfix/`, 16 geometry
redeclarations of FH's market stalls, stairs and temple ruin poles against
`*_fix` meshes no archive holds, and its `Objects.con` has
`rem run lightingfix/go`; the bake drew the `_fix` names and lost 125 placed
objects.
`extract_map.level_run_order` follows the run graph (comments and untaken `if`
arms dropped, `_host_lines`; each `run`/`include` resolved from the running
file, `_resolve_run`), and `LevelFirst(pool, run_order)` puts the reached
scripts first in the order they run, then the mod's `objects/`, then the
unreached level scripts, which only fill a name nothing else declares.
`LevelContext.ordered_objects` is that pool, for the library and the carried
spawns alike.

The mod's `objects/` scripts run in case-insensitive path order, not nearest
mod first (LOAD-5): one key per path, opened from the nearest mod, so a nearer
mod's redeclaration under another folder loses to a parent's path that sorts
first (FH's `Items/BritKit/Medic/` over FHSW's `MedicNo4/` for
`medic_helm_brit`, FH's `Vegetation/Common/HedgerowGold1/` over FHSW's
`Vegetation/FHT/`). `extract_models.load_order` sorts, and `build_library`
reads every pool in it, so the model, kit and pose catalogues change with it:
nearest-mod-first and the engine's order disagree on 147 FHSW templates, 22 FH,
15 XPack1, 16 XPack2, 61 DesertCombat, 79 DC_Final, 41 EoD and no vanilla one.

Checked with a resolution fingerprint (every placed static's template tree:
declaring file, geometry, whether its `.sm` resolves, and the carried spawns
per mode), HEAD against this change, on every level of vanilla (23), XPack1
(6), XPack2 (9), DesertCombat (35), DC_Final (48) and EoD (237): no level's
placed, unresolved, missing-mesh or spawn counts moved. The level-sourced
template changes are all scripts nothing runs: Kasserine Pass runs
`axisairplaneammo/go` twice and its `AlliedAirplaneAmmo/` never, DC_DustBowl
has `remrun armory_stinger_uni/...`, DC_First_Light's `air_runway_m1/`,
DC_Urban_Siege's `sidewalkI_m1/` and EoD Battle of Britain's factory ladder are
run by no line. Basrah Nights, Bragg, Twin Rivers and No Fly Zone Day 2 keep
their own templates and spawns. The FHSW levels:

| Level | Placed objects missing a mesh | Missing meshes | Templates resolved to another file |
|---|---|---|---|
| Fall_of_Berlin-1945 | 1090 -> 965 | 139 -> 124 | 9 (and 20 geometries, 15 of them `lightingfix`) |
| Seelow-Heights-1945 | 74 | 40 | 19 |
| Gold_Beach-1944, Counterattack-1950 | 0 | 0 | 9 each (`HedgerowGold1`, `Aspen_bush2`) |
| Guadalcanal | 0 | 0 | 4 (its `Objects/objects.con` is FH's copy; FHSW's `Init.con` runs `objects/go`) |
| Aberdeen, Tobruk, Bougainville, Gazaps | unchanged | unchanged | 1 to 3 |

The rest of Fall of Berlin's missing meshes (`o_*` buildings) ship in no
archive of the chain.

Three more fixes from the same audit:

* The model catalogue skipped every template whose hull is a random pick
  (`setRandomGeometries`, LOAD-6) as "no geometry": FH's `gmc`, `Bedford`,
  `Opelblitz`, `Zis5` and their ammo trucks, `M4A1ShermanRandom`,
  `PantherDKingtigerRandom`. `extract_all.has_renderable_geometry` follows the
  pick to `<name>1`, as the extractor draws it: 21 FHSW and 14 FH templates
  are admitted (`gmc.glb`, 3,123 triangles, extracted in a scratch tree).
  The engine never uses the base name when a count is set and deals variants
  round-robin across the process; `con.instance_template_name` still prefers
  the base name when it exists.
* A level's loading picture is looked up in every copy of the level down the
  mod chain (`extract_loading_assets.find_in_level_archives`): FHSW's Gold
  Beach names `../../bf1942/Levels/Gold_Beach-1944/Textures/gold.tga`, which
  only FH's copy ships. 16 FHSW levels get their own picture instead of
  `western`; every other mod's rows are unchanged.
* The two level-declared kits the audit found missing from FHSW's
  `loadouts.json` (`4Rus_TankhunterPPshArmour`, Fall of Berlin;
  `4German_AT_Haft-Hohlladung_EihGr39`, Seelow) are read since `1bdb7298`; the
  published file predates it (845 kits; a run of HEAD gives 1,204).
  `2German_AssaultSg44HEAT61` (Gazaps) and `1Rus_AssaultAVT40Spotter` (Fall of
  Berlin) are declared in no archive of the chain.

Not re-baked or re-extracted here: the FHSW levels, the catalogues and the
loading rows of every mod pick this up on their next run.
