# Statics a mode script places (2026-09-27)

The dedicated server runs the level's root `<mode>.con` (ledger TKT-3), and a
mode script can create objects of its own, directly or through any file it
`run`s. The exporter read `StaticObjects.con` and the seven layer files
(`ControlPoints`, `ControlPointTemplates`, `SoldierSpawns`,
`SoldierSpawnTemplates`, `spawnPointManagerSettings`, `ObjectSpawnTemplates`,
`ObjectSpawns`) and nothing else, so anything else a mode script placed was
missing from the viewer.

In vanilla and the two packs that is four Secret Weapons levels:

| Level | File the mode scripts run | What it places | Layers that have it |
|---|---|---|---|
| Hellendoorn | `Conquest/AdditionalStaticObjects.con` | 4 `Hellendoorn_V2Orginal` (the V2s on their launch tables) | Conquest, Ctf, Tdm, CoOp |
| Kbely_Airfield | `Conquest/AdditionalStaticObjects.con` | 2 `KBely_UFOOrginal` | Conquest, Ctf, Tdm, CoOp |
| Mimoyecques | `Conquest/AdditionalStaticObjects.con` | 3 `V3_Shaft_m1` | Conquest, CoOp |
| Telemark | `AdditionalStaticObjects.con` (level root) | 2 `Telemark_TurbinesOrginal` (spinning, with a hum) | Conquest, Ctf, Tdm, CoOp |

Telemark was not on the original list: its scripts run a root-level file, so a
search for `Conquest/AdditionalStaticObjects` misses it.

## The statics differ per mode

None of the four levels' `ObjectiveMode.con` runs `AdditionalStaticObjects`.
ObjectiveMode puts a destroyable objective on the same spots instead: its
`ObjectiveMode/ObjectiveSpawners.con` places `TurbineSpawner` ObjectSpawners
that make `Hellendoorn_V2` (a `PlayerControlObject` wrapping the same
`...Orginal` geometry and a wreck), and the `DestroyTargetObjective` templates
point at them. So the statics are tagged with the layers whose game types run
the file, and ObjectiveMode has none of them. Nor does a layer no game type
loads: the four levels' CoOp scripts are composed (`SinglePlayer/` spawns,
`Conquest/` flags and vehicles), so nothing runs the `SinglePlayer/` directory
layer as a whole.

Every copy of the file the archives ship per mode directory
(`Ctf/AdditionalStaticObjects.con`, `SinglePlayer/...`, `Tdm/...`) is dead:
the scripts all run the `Conquest/` one. Mimoyecques' `SinglePlayer/` copy
even differs by 5 cm on one shaft; nothing runs it.

## How the exporter reads it

`bf42/level.py`:

* `script_objects(files, script)` walks a game type's script the way a host
  runs it. `v_arg1` is `host` (what `Game::load` 0x0805b4b0 passes), each
  `if`/`elseIf`/`else`/`endIf` arm is decided (`_host_lines`; a test on
  anything but a script argument keeps its first arm), `return` ends a file,
  and every `run`/`include` is followed with the arguments it passes. A `run`
  path is relative to the including file's directory, falling back to the
  level root (`_resolve_run`): engine-run nested scripts are written that way
  (`Sounds/Environment.con` runs `Siren.con`, `Init/Terrain.con` runs
  `TerrainSP.con`), and the `GameTypes/` fallback scripts write theirs from
  the root. The seven layer files are left to `load_gameplay_objects`, but
  their `ObjectTemplate.create` lines are recorded (`declared`). Each placement
  keeps the level-relative file it came from (`StaticInstance.source`).
* `load_game_types` stores the result on each `GameType` (`objects`,
  `declared`).
* `is_gameplay_kind` says which placements are the round's machinery rather
  than scenery: `ControlPoint`, `SpawnPoint`, `ObjectSpawner`, `FlagBase`,
  `Flag`, and every `...Objective`.

`extract_map.py`:

* `union_mode_statics(info, library)` collapses every game type's placements
  into one list, each with the layers whose game types create it (None when
  that is every layer, so the node stays untagged like a `StaticObjects.con`
  one). It drops a game type whose layer the level does not ship, a gameplay
  kind (by the chain's own declaration, else the library's template), and an
  exact repeat of a `StaticObjects.con` placement.
* `build_scene` places them right after `StaticObjects.con`, tags each node
  `extras.modes` (the viewer's `pruneToMode` already drops any tagged node,
  collision and rotating parts included), and reports
  `objects.modeStatics: {placed, files}`. `objects.placed`, and with it every
  `maps.json` row, stays the `StaticObjects.con` count.
* `discover_level_sounds` takes the mode statics too, and an emitter on one
  carries `modes` in `sounds.areas`. `viewer/page-audio.js` drops an area whose
  `modes` leaves the active mode out (`entryInMode` in `viewer/game-modes.js`),
  so Telemark's turbine hum is heard only where the turbines stand.
* The `ai` layer's cover-value table takes the mode statics' templates as well
  (a per-template table, so untagged).
* Telemark's turbines hum through a child the object library does not have:
  `Objects.rfa` adds `turbinesound` to `Telemark_TurbinesOrginal` by name, and
  only the level declares it (`Sounds/Environment.con` runs
  `turbinesound.con`: a `SimpleObject` loading `turbinesound.ssc`,
  `generator_loop.wav` fading out between 20 and 28 m). Step 3 of
  `discover_level_sounds` matched a level sound template only when it was
  placed itself, so it now also walks each placement's template tree for such
  children (`_level_sound_children`, the child's height carried). Across
  vanilla and the two packs these two turbines are the only placements with
  one, so no other level's `sounds` moves.

A level with no mode statics bakes byte-identical to before: no new key in the
report, no new node, no `modes` on any emitter.

## What the census found beyond the three trees

`features/bf1942-engine-reference/surveys/mode_script_statics.py` walks every
level each installed mod can load. In vanilla and XPack1 (their inherited
levels included) the mode scripts create only CTF flag bases (`FlagBase`, 24
and 32 placements over all their game types) and ObjectiveMode's objective
spawners (`ObjectSpawner`, 12 each), none of it scenery. XPack2 adds the
statics above: 38 placements over the game types that run the files, 11
statics once the union collapses them. Nothing else changes in those trees.

The other installs, out of the extraction scope, pick up more on their next
bake. A total over a mod counts each game type that runs the file (the union
collapses them); a per-level figure is what the bake places:

* **EoD**: 231 levels run a `Vegetation.con` from every mode script, 2.86 M
  placements over 700 runs. All scenery (`SimpleObject`) in every layer, so
  untagged: A Shau places 171 statics from `StaticObjects.con` and gains
  2,989; Khe Sanh has 1,973 and gains 1,510; Hue Imperial Palace gains none.
  EoD's jungle is mostly missing from its published levels for this reason.
* **bg42**: foliage and prop files run from the mode scripts (`bushes` 38,795
  over 9 levels, `trees` 18,810 over 4, `spruces`, `pines`, `hedges`,
  `smallplants`, `grass`, `props`, `wires`), plus `healandammo` (supply
  depots) and `ambientsounds` (area sound objects, which the sound layer
  places).
* **bf1918**: per-mode `StaticObjects` files (`SinglePlayer/` 1,478, `Ctf/`
  1,289, `Tdm/` 561), and `effects` files on 46 levels across the mods,
  placed or not by their templates' kinds.
* **FH / FHSW**: `Conquest/AdditionalStaticObjects` on 13 levels (Arnhem's
  wrecks and props among them). Their CTF scripts' flag bases resolve to no
  template in FH's library: they land in `objects.skipped` and nothing is
  placed, as in the engine.
* **FHSW** also runs layer files under other names
  (`ObjectiveMode/ControlPoints_8km`, `ObjectSpawns_8km`,
  `SoldierSpawns_8km`, `ObjectiveSpawners_8km`). Their control points, pads
  and spawns are gameplay kinds, so they are not placed as statics; the layer
  reader does not read them either.

## Not done: round machinery with no viewer counterpart

* **CTF flag bases.** Every CTF root script creates its bases inline
  (`object.create redBase` / `usbase` / `gebase` ..., `FlagBase` templates in
  `Objects/Items/Flag/Objects.con`: the `flagbase_m1` pole plus the carryable
  `flagTemplate` flag the engine hangs at `setFlagLocation 0/7.6/0`). The join
  arm often creates a plain `FlagPole` instead. Drawing only the pole would be
  half a CTF base, so they are left for a CTF feature.
* **ObjectiveMode's objectives.** `ObjectiveMode/ObjectiveSpawners.con` places
  the destroyable targets (`TurbineSpawner` -> `Hellendoorn_V2`,
  `Telemark_Turbines`, ...) through spawner templates declared in
  `ObjectiveSpawnerTemplates.con`. The viewer has no ObjectiveMode round
  (TKT-1), so the ObjectiveMode layer still shows the empty spots.

## Bake and publish (2026-09-27)

The four XPack2 levels were baked from `a3222985`, the change rebased on
main (it landed as `e81b82fb`, which differs from it only by two viewer
commits), into a scratch `--out` holding a copy of the tree's `_shared`
(`extract_maps_all.py --mod XPack2 --levels Hellendoorn Kbely_Airfield
Mimoyecques Telemark -j 4`, 3 min). Against the tree (which matched
mesh.bfstats.io byte for byte beforehand), each level changed `scene.glb` and
`scene.json` only; the other 530 files of the four level directories were
byte-identical. `_shared` gained one file, `sounds/generator_loop.mp3` (the
turbine hum, 43 KB); `damage.json` and every other shared file were unchanged.
Only those nine files were promoted, so the `maps.json` rows (with their
`loading` blocks) were never rewritten; their `objects` counts do not move.

What moved in each report: `objects.modeStatics`, and the object pass's own
totals (`parts`, `triangles`, `texturesResolved`, `collision.*` with material
76). Telemark also gained two rotating parts and one animation clip (each
turbine's `TurbineRotation`) and two `turbinesound` emitters tagged
`Conquest/Ctf/Tdm/CoOp`. No mesh or texture went missing; the one new
`unresolvedTemplates` name is `turbinesound`, which has no geometry. Nothing
else in any `scene.json` differed from the published one, so no sibling's key
was lost.

The meshes need nothing from the models tree: a level's statics are assembled
from the mod's archives into its `scene.glb` (`V2_Rocket_M1`,
`fucke_wolf_m1`, `V3_AirObjectiveTarget_m1`, `Telemark_Turbines_m1` and
`Telemark_TurbineRot_M1` all resolved from XPack2's `StandardMesh.rfa`, each
with its LOD rungs and a collision hull). `viewer/models/mods/xpack2` is the
vehicle and kit catalogue, and nothing the page loads for a level reads it.

The glbs also carry `1a561a94` (a mesh skinned by its own `.skn` ships no
LOD rungs), which landed on main while this was in progress. A bake from
before it differed here by the Sherman's three track rung meshes on all four
levels and the T95's six more on Mimoyecques, nothing else. Those meshes were
orphans: no node referenced them (a track carries a skeleton, so no rung node
was ever made for it), and the loader never builds such a mesh, so nothing
drawn changed. The other levels keep theirs until a re-bake with a visible
reason (see `features/mesh-lod-chains/README.md`).

Published with `scripts/publish-mesh-delta.py maps --hash --root <staging>`
(a staging tree of exactly the nine files): 0.33 GB in 2 min, after the
viewer code was live (`entryInMode` in the served `game-modes.js`). All nine
live files hash the same as the local ones.

Checked on mesh.bfstats.io with headless Chromium (Vulkan), `?mod=xpack2
&map=<level>[&mode=ObjectiveMode]&shots`:

| Level | Tagged statics in the scene, default (Conquest) / ObjectiveMode |
|---|---|
| Hellendoorn | 4 / 0 (the V2s stand on their launch tables; ObjectiveMode's tables are empty) |
| Kbely_Airfield | 2 / 0 |
| Mimoyecques | 3 / 0 (the shaft heads close the three roof openings; ObjectiveMode's are open) |
| Telemark | 2 / 0 (inside the turbine hall, `telemark_factory_m1`) |

Telemark's area-sound pool, once it stopped growing, held five groups in
Conquest including `turbinesound` (both emitters) and four in ObjectiveMode,
without it.

To frame a static inside a building for a picture: the level's statics are
drawn from merged copies (the placed nodes report `visible: false`), so hiding
a node does not open the wall. Push `__camera.near` past it instead (14 m put
the camera through the hall's roof).
