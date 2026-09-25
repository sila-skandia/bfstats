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
| `spawns` | `soldierSpawns`, `vehicleSoldierSpawns`, `objectSpawns`; the same under `modes.*` | none | `SoldierSpawn*.con`, `ObjectSpawn*.con`, the ships' `Objects.con`, `Game/GlobalSpawnGroups.con`, the control points |
| `game` | `gameplayMode`, `combatArea`, `tickets`, `gameTypes`, `briefing`; `modes.*.gameTypes/tickets/combatArea` | none | `GameTypes/*.con`, `Init.con`, `Menu/Init.con`, the chain's `lexiconAll.dat` |
| `environment` | `waterLevel`, `fogColor`, `fogStart`, `fogEnd`, `sunDirection`, `camera`, `lighting`, `drawDistance` | none | `Init.con`, `Init/SkyAndSun.con`, `Init/Terrain.con` |
| `damage` | `damage` | `<tree>/_shared/damage.json` | `Game.rfa` MaterialManager, the projectile templates |
| `sounds` | `sounds` | new samples in `<tree>/_shared/sounds` | the level's sound scripts, the vehicles' `.ssc`, `sound.rfa` |
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
| Fog, sun, lighting, draw distance | `scene.json` | `--layer environment` |
| The MaterialManager tables, the projectile table (the proximity fuse, `timeToLive`) | `_shared/damage.json` + each `scene.json` | `--layer damage` (one level per mod is enough for the shared file) |
| Vehicle engine and weapon sounds, ambience, the flag flap | `scene.json` + new samples | `--layer sounds` |
| The strategic AI scripts, search maps, cover values | `scene.json` + `pathfinding/` | `--layer ai` |
| Anything drawn or placed: a flag's or a spawner's position, which vehicle a spawner makes, which modes a placement is in, whether a flag is drawn at all, a static, the terrain, textures, the exporter (`bf42/gltf.py`, `assemble.py`, `rs.py`) | `scene.glb` and its side files | full bake: `extract_maps_all.py --mod M` |
| An ObjectSpawner's respawn window | `scene.json` (`objectSpawns`) AND the glb (the spawner node's `extras.spawner`, which `viewer/vehicle-wrecks.js` prefers) | full bake |
| The water level | `waterLevel` AND the water mesh and depth map | full bake |

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
