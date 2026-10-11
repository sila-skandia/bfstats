# Road to Rome and Secret Weapons asset audit (2026-10-11)

Status: built and run on the two pack trees (`viewer/models/mods/{xpack1,xpack2}`,
`viewer/maps/mods/{xpack1,xpack2}`) and, where one fix reached them, vanilla's.
Nothing here is published; the file lists are at the end.

The trigger was a player's replay of a Secret Weapons round (Raid on Agheila,
`*NEW* SiMPLE | RtR+SW`, 299 s, `features/round-replay-capture`). Five defects
were reported and fixed by other sessions (loading art, a gunner's body, the
Flettner's missile sound, its HUD image, the HUD colour). This is the
adversarial pass for what else was wrong: the trees were compared with what the
installed archives define and with what the viewer's pages ask for.

## What was wrong, ranked by what a player sees

| # | Defect | Reach (before) | Fixed by |
|---|---|---|---|
| 1 | **The pack trees held only the pack's own templates.** The 2026-09-27 re-bake ran `extract_all.py --own`, so `models/mods/xpack2/` had 35 of the 134 renderable templates its chain defines (xpack1: 15 of 114). Everything that reads a hull, a weapon or a pickup from the mod's own tree found nothing: `ReplayAssets.model` (a replayed Willy, PanzerIV, flak38, AA gun, KettenKrad, Spitfire, BF109, Stuka, both stationary MGs), `replay-props.js` (the 48 mines and every grenade lying on the ground), `arms-rig.js` (a first-person weapon), `replay-hud.js`. A replay hull with no glb draws nothing, and the level's baked copy is hidden. | 99 templates a pack (xpack2: 35 of 134, xpack1: 15 of 114), and 85 distinct spawner templates unresolved across 18 of SW's levels | `extract_all.py` without `--own` into a scratch mesh root, new templates merged in (files, textures, `models.json` rows); the 9 level-local templates (Hiryu, Hornet, Ju88A, the radar towers, CDNRaft, Britain_Factory) one by one with `extract_models.py`; thumbs |
| 2 | **No first-person rigs and no `viewmodels/index.json`.** `arms-rig.js` read `models/mods/<id>/viewmodels/` only; 404 on the index, then 404 on `<Soldier>__<Weapon>.fp.glb`, then 404 on the bare weapon glb (see 1). A SW or RtR soldier carried no weapon in his own view. | no index and no rig in either pack; now 145 (xpack2) and 147 (xpack1) rigs, 261 MB and 262 MB, every soldier x item pair the loadouts deal resolves | `extract_viewmodel.py --kits ... --maps ...` straight into the tree |
| 3 | **`kits.json` held the pack's own kits only** (11 of 51 on SW, 14 of 54 on RtR): the kit page, the worn-parts table and anything that joins on a kit row had no row for the British, German, American, Japanese, Soviet and Canadian kits the inherited levels deal. | 40 kits a pack, 256+309 rules-gate findings | `extract_kits.py --maps maps.json` (the recipe's own line); 105 + 111 `.kit.glb` worn parts |
| 4 | **Alpha-0 texels drawn opaque**: the engine alpha-tests every StandardMesh (ledger SM-15), the exporter before 3f83aa8f did not. SW's `Milifence_largebarbfence_xp2` barbed wire, tank track links and sprockets (Sherman, PanzerIV), the Brit jeep's rotor, RiBro, the Ju87 fuselage drew as solid blocks. | 83 (SW) / 55 (RtR) materials in the level scenes, 32 + 12 own model files; 505 / 475 NaN-UV materials (FH's fix 01ecafce, same defect) | pack models re-exported (110 + 41 files), every pack level scene re-baked (32 + 29), vanilla's 23 scenes and 259 model files as well |
| 5 | **Malformed Vec3 placements read as the world's origin**: Essen's `essen_25` flag spawn (`544.879/33.0805/831/048`, 38 m under the terrain at 0,0), Mimoyecques' anti-tank gun pad (`907.196/56.1322.616.016`), Battle of Britain's three machine-gun pads and a bridge spawn, Tobruk's gun rotation, Market Garden... The engine reads a Vec3 argument off a stream (CON-16), and `Object.absolutePosition` is one (CON-18). | 5 objects, 17 level scripts, vanilla and both packs | `bf42/level.py` reads through `stream_vec3`; `spawns` layer patched on 6 + 4 + 4 levels, their scenes swapped (the glb carries a spawner's node) |
| 6 | **A sound `.con` with several templates kept only the last**: Baytown's `Crickets_1`..`9`, `Seagulls_1`, `BirdinTree_1`, the second coastline; Anzio's river, harbour waves and crane chains; Santo Croce's second river; Eagles Nest's four birds. Placed by name in `StaticObjects.con`, declared in one `Sounds/*.con`, never heard. | 21 (RtR) + 4 (SW) ambient emitters | `bf42/level.py` `parse_area_cons`; `sounds.areas` re-read for the four levels |
| 7 | `deployables.json` absent: a 404 on every level of both packs (neither pack has a deployable weapon; the file is the empty table) | 2 files | `extract_deployables.py` |
| 8 | 108 + 108 models without a browse thumbnail | model page cards | `shoot.mjs --thumbs` |
| 9 | `mods.json` counts stale (15/35) | the mod picker | `build_mods_manifest.py` |
| 10 | `Mp18` and `JohnsonLMG` pose glbs, `effects.glb` (PT_Guns) with opaque cut-outs | 4 + 2 + 1 files; vanilla's 10 first-person rigs and `effects.glb` | `extract_pose.py` / `extract_viewmodel.py` for those pairs, `extract_effects.py` |

## Checked and faithful (nothing to fix)

* **"1 never in range, stood in by the level"** is the Rocket Platform whose
  root (netId 2554) the recorder never saw created; its joints
  `RocketLauncherHorizontalPCO1` / `RocketLauncherVerticalPC01` are in the
  recording from the first sample and in `RocketPlatform.glb` and the level's
  scene, so `replay-standins.js` pairs them by part name. Correct.
* **Bolt rifles with no `bolt` clip** (`audit_mod.py` `bolt-rifle-no-bolt-clip`):
  vanilla's, Road to Rome's and Secret Weapons' bolt rifles fire into
  `Ub_StandReload<W>` (`returnTo`), so the cycle is the `reload` family; only FH
  fires into a state of its own. The audit now says so.
* `CommandoKnifeThrowProjectile` / `EliteKnifeThrowProjectile` have no
  geometry; the thrown knife is the `e_Throwing*Knife` trail effect, which is in
  `effects.glb`. There is no mesh to lay on the ground.
* Level-own vehicle sounds (Flettner, Greyhound, Krupp, M4A1, MunitionsPanzer,
  RocketPlatform) are not in `_shared/vehicle-sounds.json`: Raid on Agheila
  re-declares them, and `extract_vehicle_sounds.py` leaves a level's own
  objects to that level's `scene.json`, which answers for them.
* `ParashutSpawnPoint_*` (Market Garden, 61 to 143 m up) are paratroop drop
  points as authored.
* Anzio's `Seagulls_01..03` stay silent: `Seagulls_1.ssc` and `Seagulls_2.ssc`
  open a `/*` in their HIGH patch and never close it, and the engine's one
  skip flag (`BF1942.exe` 0x007f9a80, `_ssc_lines`, ledger SSC) is not reset
  until the top-level parse ends, so the rest of the file is dropped.
* Ships a few metres under the level's water and `Defgun`s a metre or three
  under the ground (`ship-off-waterline`, `spawn-buried`) are vanilla's authored
  placements: the vanilla tree reports the same 18 and 18, and a hull floats
  itself (`hull-bodies.js`).
* Samples, textures and sprites the install does not ship (`sherW2_f`,
  `ahelm2_r`, the Ju 88 `*_MESH` set) are the audit's accepted list.

## Prevention

* `audit_completeness.py` (so `audit_mod.py --audit completeness` and the
  pipeline's `completeness` gate) now has two checks:
  `chain-template-not-extracted` (what `extract_all.py` would export for the
  mod and `models.json` lacks; asks `extract_all.select_templates`, the same
  function the extractor uses) and `level-vehicle-model-not-in-tree` (a spawner
  template that vanilla's `models.json` draws and the mod's does not). The first
  would have flagged both packs the day they were built; `tests/test_audit_completeness.py`.
* `extract_all.py --own` says in its help that the result is not the recipe.
* `tests/test_level.py`, `tests/test_objective_setup.py` (typo'd vectors),
  `tests/test_sound.py` (several templates in a file).
* Ledger CON-18 (`absolutePosition` is a stream-read Vec3).

## Re-running

```bash
cd tools/bf1942-models
python3 audit_mod.py --mod xpack2 --audit completeness models data   # the census

# models: the whole chain into a scratch mesh root, then merge only what the
# tree lacks (the trees are written by several sessions at once; this never
# rewrites a file it was not asked to, and re-reads models.json at the end)
mkdir -p ~/.cache/x/mesh/models/mods/xpack2
python3 extract_all.py --mod XPack2 --level-all --configuration-all --cockpit -j 6 \
    --out ~/.cache/x/mesh/models/mods/xpack2
python3 merge_scratch_models.py --id xpack2 --scratch ~/.cache/x/mesh/models/mods/xpack2          # dry run
python3 merge_scratch_models.py --id xpack2 --scratch ~/.cache/x/mesh/models/mods/xpack2 --apply  # +--refresh-own
python3 build_mods_manifest.py                      # counts, before thumbs
node shoot.mjs --thumbs --url http://localhost:<port>/?mod=xpack2 \
    --out viewer/models/mods/xpack2/thumbs --manifest viewer/models/mods/xpack2/models.json -j 2 --skip-existing

# the level-local templates the inherited vanilla levels place (catalogue() leaves
# another mod's level objects out): by name, one subset run into the same scratch
python3 extract_models.py Hiryu Hornet Ju88A CDNRaft Britain_Factory Clacton_RadarTower \
    East_Harwick_RadarTower Felixstowe_RadarTower West_Harwick_RadarTower --mod XPack2 \
    --level-all --configuration-all --cockpit --out ~/.cache/x2/mesh/models/mods/xpack2

python3 extract_kits.py --mod XPack2 --maps viewer/maps/mods/xpack2/maps.json --out <scratch>/models/mods/xpack2
python3 extract_viewmodel.py --mod XPack2 --kits viewer/models/mods/xpack2/kits.json \
    --maps viewer/maps/mods/xpack2/maps.json --out viewer/models/mods/xpack2/viewmodels
python3 extract_deployables.py --mod XPack2 --out viewer/models/mods/xpack2

# levels: a bake into scratch, then only scene.glb (+.gz) replaced in the tree;
# scene.json is whatever the layer patches left it (other sessions patch it)
python3 extract_maps_all.py --mod XPack2 -j 6 --out ~/.cache/x/mesh/maps/mods/xpack2
python3 swap_scene_glbs.py --scratch ~/.cache/x/mesh/maps/mods/xpack2 --tree xpack2 --backup ~/.cache/x/bk --apply
python3 patch_scene.py --layer spawns --mod XPack2 --levels essen mimoyecques ...
```

The scratch root must have `models/` or `maps/` above the `--out` so
`optimise_mesh.py` hangs its `textures/` store off it; the merged glbs then name
`../../../textures/<hash>.webp`, the same relative path the tree uses
(`../../../../textures/` from a level's `scene.glb`).
