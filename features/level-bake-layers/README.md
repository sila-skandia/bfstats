# The level bake in layers (Brief S, 2026-09-24)

A level bake writes `scene.glb` and `scene.json`. Most of `scene.json` is read
straight out of the level's con files and has nothing to do with the geometry,
yet until now the only way to deliver a change to it was a full re-bake: Brief P
changed five control point settings and re-baked every tree, and because the
glb's document `extras` carried the whole report, every `scene.glb` changed and
the publisher sent 2.17 GB of unchanged geometry.

Now `scene.json` is composed of named layers (`tools/bf1942-models/scene_layers.py`).
Each con-derived layer is recomputed on its own by `patch_scene.py`, which
rewrites only that layer's keys in each published `scene.json`. The glb carries
only `{"level": <name>}` in its document extras, so a con value cannot reach it,
and the bake is deterministic, so an unchanged glb is never sent.

## The layers

| Layer | `scene.json` keys (and per-mode keys under `modes.<mode>`) | Side files it writes | Reads |
|---|---|---|---|
| `controlPoints` | `controlPoints`; `modes.*.controlPoints` | none | `<mode>/ControlPoint*.con`, the placed-flag list from `objects.placedControlPoints` |
| `spawns` | `soldierSpawns`, `vehicleSoldierSpawns`, `objectSpawns`; the same under `modes.*` | none | `SoldierSpawn*.con`, `ObjectSpawn*.con`, the template of every object a spawner places and the bundles it adds, found by name wherever declared (`extract_map.TemplateIndex`: ships, DC's buildings and AC-130), `Game/GlobalSpawnGroups.con`, the control points |
| `game` | `gameplayMode`, `combatArea`, `tickets`, `gameTypes`, `briefing`; `modes.*.gameTypes/tickets/combatArea` | none | each game type's script (the level's root `<Mode>.con`, which the server runs; `GameTypes/*.con` says which exist), `Init.con`, `Menu/Init.con`, the chain's `lexiconAll.dat` |
| `environment` | `waterLevel`, `fogColor`, `fogStart`, `fogEnd`, `sunDirection`, `camera`, `lighting`, `drawDistance` | none | `Init.con`, `Init/SkyAndSun.con`, `Init/Terrain.con` |
| `damage` | `damage` | `<tree>/_shared/damage.json` | `Game.rfa` MaterialManager, the projectile templates |
| `sounds` | `sounds` | new samples in `<tree>/_shared/sounds`; `<tree>/_shared/vehicle-sounds.json` (once per run, when the tree has one) | the level's sound scripts, the vehicles' `.ssc`, `sound.rfa` |
| `ai` | `ai` | `<level>/pathfinding/` | `AI.con`, `AI/*.con`, the placed statics' cover values |
| `scene` (full bake only) | `level`, `worldSize`, `terrain`, `objects`, `skybox`, `sky`, `water`, `envmap`, `lensFlare`, `minimap` | `scene.glb`, textures, lightmaps, sky, water, minimap | everything the geometry needs |

`controlPoints` implies `spawns`: an object spawn's `controlPointIndex` is the
nearest flag within `max(60, 4 * radius)`, and a soldier spawn's `team` is the
flag whose `spawnGroupId` matches its group. `patch_scene.py` recomputes it
alongside; nothing is written if it did not move.

A change of a level's mode SET (a new `Ctf/` directory) rebuilds `modes`, so it
needs `--layer controlPoints spawns game` together; the tool refuses otherwise.

## Which change goes where

| The change | Files it reaches | Command |
|---|---|---|
| A control point setting the glb does not draw (`timeToGetControl`, `radius`, `team`, the capture law's fields) | each level's `scene.json` | `patch_scene.py --layer controlPoints --mod M --all` |
| Soldier spawn points, their groups, `OnlyForAI` / `OnlyForHuman`, ship deck spawns | `scene.json` | `--layer spawns` |
| Tickets, game types, combat area | `scene.json` | `--layer game` |
| Which files a game type's script runs (a CoOp layer composed from two directories) | `modes.<type>.*` AND the glb's per-mode node tags | full bake of the levels whose composed layer moved (the 2026-09-27 root-script change: all 6 XPack1 levels, 5 XPack2) |
| Fog, sun, lighting, draw distance | `scene.json` | `--layer environment` |
| The MaterialManager tables, the projectile table (the proximity fuse, `timeToLive`) | `_shared/damage.json` + each `scene.json` | `--layer damage` (one level per mod is enough for the shared file) |
| Vehicle engine and weapon sounds, ambience, the flag flap | `scene.json` + new samples + `_shared/vehicle-sounds.json` | `--layer sounds` |
| The strategic AI scripts, search maps, cover values | `scene.json` + `pathfinding/` | `--layer ai` |
| Anything drawn or placed: a flag's or a spawner's position, which vehicle a spawner makes, which modes a placement is in, whether a flag is drawn at all, a static, the terrain, textures, the exporter (`bf42/gltf.py`, `assemble.py`, `rs.py`) | `scene.glb` and its side files | full bake: `extract_maps_all.py --mod M` |
| The statics a mode script places beyond `StaticObjects.con` (`GameType.objects` -> `union_mode_statics`: Secret Weapons' `AdditionalStaticObjects`) | the glb (the nodes, tagged `extras.modes`) and `objects.modeStatics`; their emitters' `sounds.areas[].modes` and cover values ride the `sounds` and `ai` layers | full bake of the levels that have any: in vanilla and the two packs, XPack2's Hellendoorn, Kbely_Airfield, Mimoyecques and Telemark (`features/mode-script-statics/`) |
| An ObjectSpawner's respawn window | `scene.json` (`objectSpawns`) AND the glb (the spawner node's `extras.spawner`, which `viewer/vehicle-wrecks.js` prefers) | full bake |
| The water level | `waterLevel` AND the water mesh and depth map | full bake |
| The EffectBundles a level's own scripts declare (a ruined objective, Battle of Britain's dish scrap), or the effect bake itself (`bake_effect_library`, `bf42/effects.py`) | `<level>/effects.glb` + `effects.report.json`, `<level>/effects.sounds.json` with its samples in `_shared/sounds`, and the level's `maps.json` row (`effects`, `effectSounds`) | `extract_effects.py --mod M --levels` (seconds a level, optimises what it wrote; `features/level-effects/`). Not a scene layer: a full bake neither writes nor removes it, and `extract_maps_all.py` keeps the row keys and the files they name |
| A placed object's armour block (`extras.armor`: hit points, tiers, the after-death clock's `timeToLiveAfterDeath` words) | the placed node in `scene.glb`, and the model glbs | full bake, and the model extract; a spawned object's block rides its effects glb (`extract_effects.py`) |

Rule of thumb: if the viewer draws it, it is in the glb; if the viewer only
reads it, it is a layer.

`--mod` takes `bf1942`, `XPack1`, `XPack2` and `EoD` (parked: accepted, not run
in this brief). `--all` takes the levels that already have a `scene.json` in the
tree, so a pack's tree is never widened with the vanilla levels its archives
inherit. The old names still work: `patch_ai_extras.py` is `--layer ai`,
`extract_map.py <L> --sounds-only` is `--layer sounds` (now the whole `sounds`
block, not only `sounds.vehicles`), `extract_map.py <L> --damage-only` is
`--layer damage`.

Then publish with `scripts/publish-mesh-delta.py maps --hash`: a layer patch
often keeps a file's length (`10.0` -> `20.0`), which the size compare cannot
see.

## The mod's vehicle sound table (2026-09-27)

`sounds.vehicles` answers only for the templates the level's own spawners
place. A round replay shows whatever the server spawned: the MoonGamers Midway
recording's Elco80 and Type38 PT boats, their rafts, Kubelwagens,
`Stationary_mg42`s and a B17 had models and no sound. `<tree>/_shared/vehicle-sounds.json`
is `{"mod", "vehicles": [...]}`, one `sounds.vehicles` entry per vehicle
template of the whole mod chain (the model catalogue's land, air, sea and
emplacement templates, every template a level's ObjectSpawner names, and the
hulls those carry on spawners of their own), made by the same
`extract_map.extract_vehicle_sounds`, with the same `../_shared/sounds/x.mp3`
paths. `template` is the declared name; match it case-insensitively. A
template a level declares in its own archive (Battle of Britain's Ju88A, Coral
Sea's carriers, vanilla Caen's Pak40) is left to that level's `scene.json`,
and a pickup kit a spawner lays down (XPack2's `GermanElite_*`) is no hull.

    python3 tools/bf1942-models/extract_vehicle_sounds.py --mod bf1942   # or XPack1, XPack2

`patch_scene.py --layer sounds` refreshes it once per run when the tree has
one, and `extract_maps_all.py` writes it after its levels, so it moves with the
levels' entries: every entry of a global hull a level places equals that
level's (`tests/test_extract_vehicle_sounds.py`; 358 vanilla, 462 XPack1 and
486 XPack2 level entries compared equal on 2026-09-27). Vanilla has 64 entries
(893 KB), XPack1 73, XPack2 81; XPack2's `Jetpack`, `ParatrooperSpawner` and
`Wasserfall` have no engine or gun script.

## Timing (vanilla, 23 levels)

Measured 2026-09-24 on the workstation, a fresh bake into a scratch tree and
then each layer patched over it (`--all`, one process, levels in sequence):

| Operation | Wall time | Writes |
|---|---|---|
| Full bake, `extract_maps_all.py -j 8` | 543 s (9 min) | 1.3 GB: every glb, texture, lightmap, report |
| `--layer controlPoints` (with `spawns`) | 1.3 s | only the `scene.json` files whose keys moved |
| `--layer spawns` | 1.3 s | same |
| `--layer game` | 0.8 s | same |
| `--layer environment` | 0.8 s | same |
| `--layer damage` | 6.6 s | `_shared/damage.json` if it moved, plus the reports |
| `--layer sounds` | 7.8 s | reports; a sample that is new costs one LAME transcode (about a second) on top |
| `--layer ai` | 4.9 s | reports, `pathfinding/` files that moved |
| `--layer all` | 9.0 s | all of the above |

All eight patch runs over that fresh bake wrote nothing (0 of 23 files): the
bake and the patch agree on every layer of every vanilla level. The same bake's
23 `scene.glb` files match the live tree's byte for byte in the binary chunk
and in every glTF key except the document `extras`, which are now just the
level name. So the first full-bake publish after this change sends every glb
once (the extras shrink); after that an unchanged glb is never sent.

## How the patch stays confined

* `patch_scene.py` checks the file re-dumps to its own bytes with `indent=2`
  before touching it (all 38 vanilla and pack reports do), replaces only the
  layer's keys in place, and writes nothing when the text is unchanged.
* A control point's `visible` is `template visible and placed in the glb`. The
  placed set comes from `objects.placedControlPoints` (written by every bake
  since this change) or, for an older bake, from the entries it already marks
  visible. A flag the con newly makes visible is a new placement, and the tool
  warns that it needs a full bake.
* The full bake computes its report through the same layer functions, from the
  same pools. `tests/test_scene_layers.py` bakes Berlin twice and pins: the two
  bakes byte-identical (glb included); the glb extras hold only the level name;
  every layer patched back over the bake changes no byte; each layer, set to a
  stale value, is patched back to exactly the bake's bytes; a synthetic change
  (`AxisBase_1_Cpoint timeToGetControl 10 -> 20` in a scratch copy of the
  install, via a `Berlin_999.rfa` patch archive written by `bf42/rfa.write_rfa`)
  changes only `controlPoints` and `modes.Conquest.controlPoints`, leaves the
  file the same size, and the publisher's dry run lists only that `scene.json`.

## Determinism

Two concurrent bakes of Berlin and of Wake (separate processes, so different
`PYTHONHASHSEED`s) were byte-identical in every file, and a fresh bake of Wake
matched the live tree's `scene.glb` byte for byte. So the glb bake was already
deterministic: no timestamps, temp names or hash-ordered sets reach it (writes
go through `os.getpid()` temp names that are renamed away; archive and level
lists are sorted). The one source of glb difference between two bakes of the
same geometry was the report embedded in the glb's document extras, which is
what made Brief P's five fields a 2.17 GB publish. That is gone.

## Found while doing this

* The live vanilla tree's `ai` block is behind the code on 19 of 23 levels: it
  lacks `ai.searchTypes` (added to `bf42/ai_level.py` after the tree was last
  patched). `patch_scene.py --layer ai --mod bf1942 --all` delivers it; not run
  here, since the brief confined writes to the no-op control point patch.
* Between 298b1cd1 (2026-10-01) and the LOAD-8 fix (2026-10-06) the object
  library dropped every `/ai/` script, so `--layer ai` and any full bake wrote
  `ai.coverValues` empty (El Alamein 26 -> 0) and `extract_loadouts.py` lost
  the bots' weapon AI. Every `coverValue` and `weaponTemplate` is in such a
  script, and the engine runs them on an AI level, which the viewer's game is
  (`extract_models.load_order`). A bake or `--layer ai` patch made in that
  window needs re-running; `tests/test_ai_cover_values.py` pins the count.
