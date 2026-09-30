# Level archive mounts: what a level bake reads, the way the engine loads a level

Status: built 2026-09-30 for the Desert Combat and DC Final level audit. The
two DC trees are re-baked and patched; vanilla, XPack1, XPack2 and EoD are not
(section 7 lists what a re-bake would change there).

A level bake read a level as if it were one archive plus the mod's global
objects. The engine does not: every level archive of the mod chain is mounted
at its own path, a level's `Init.con` runs its own object scripts before the
mod's `objects/`, `textureManager.alternativePath` builds a list, and a child
template is found by name wherever it is declared. Each difference cost Desert
Combat something visible or playable. The engine rows are LOAD-1..LOAD-4,
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
