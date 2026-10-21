# Level side audit: the Ulsnes symptoms on every exported level

Status: built 2026-10-21. Four static audits run over every exported level of
the vanilla, XPack1, XPack2, FH, FHSW and FHSWEurope trees; every finding they
raised is fixed at its owning script and published, and a second pass over
the six trees is clean apart from accepted rows. DC, DC Final and EoD are
parked: their counts are below, nothing was re-extracted.

## Why

The owner played FHSWEurope's Ulsnes and reported a US flag beside Norway, a
Norwegian shotgun that flashed white and fired silently, Einunna Bridge's kits
on Ulsnes, bot grenades that never left the hand and officer bots firing
binoculars. Four commits fixed those (6e420f46, 1d7c979e, cbf7e297, a1809b92)
in code that serves every level. This work asks the same questions of every
other exported level, and keeps asking them on every pipeline run.

## The audits

`tools/bf1942-models/audit_sides.py`, run through `audit_mod.py --audit
loadouts armoury nations flagcloth` and in the pipeline's `v_static`. The
exported set is each tree's `maps.json` rows (FHSW and FHSWEurope: the rows
with a `loading` block). The level is read as the engine mounts it: every
archive of its name down the chain, its root `Init.con`, and the scripts that
`Init.con` runs (`extract_map.level_run_scripts`).

| Audit | Checks, per level and side | Owning script |
|---|---|---|
| `loadouts` | `loadouts.json` `levels.<level>` against `Init.con` (`game.setTeamSkin`, `game.setKit`, `beginrem` and co-op arms honoured); a kit the level's run scripts declare must be the dealt row (`levelKits`, else `kits`): its hand weapons and its `addWeaponIcon` row; each row's `weapons[].icon` is its slot's icon | `extract_loadouts.py` |
| `armoury` | every hand weapon a dealt kit puts in a hand, a rolled item's variants included: a `sounds/weapons.json` entry (or a `silent` row with its reason, accepted), a third-person `<Weapon>.glb` in the mod's or vanilla's tree with exact case (the bots' FireArms and every muzzle flash), a FireArms with a round and `extras.weapon`, the round in `_shared/damage.json`, a first-person rig, and a thrown round the bots fly | `extract_models.py`, `extract_weapon_sounds.py`, `extract_viewmodel.py`, `bot-rounds.js` |
| `nations` | the soldier's art in `soldier-icons.json` names a nation; `menu-levels.json` names the same soldier and nation; the `conp_`, `flag_ticket_`, `icon_flag_` sprites and the menu flag texture resolve through the pack (`hud-pack.js`) | `extract_menu_layout.py`, `extract_hud_mods.py` |
| `flagcloth` | a control point's baked cloth image against the level's `textureManager.alternativePath` list: where an alternative folder holds the cloth's texture, the bake must carry that file (rfa.py `engine_texture`). Remote-only levels are read from the volume's glb, JSON chunk only, cached under `~/.cache/bfstats-audit/scene-json` by the marker's sha256 | `extract_map.py` |

Play-breaking causes (`v_static` fails on them): `loadout-level-missing`,
`loadout-soldier-mismatch`, `loadout-slot-mismatch`, `level-kit-row-stale`,
`weapon-no-sound`, `weapon-no-model`, `weapon-model-case-mismatch`,
`weapon-no-firearms`, `thrown-round-not-flown`. `weapon-no-rig` is major
here: the `kits` audit's `kit-weapon-no-rig` is the play-breaking row. Accepted:
`weapon-sound-absent-from-install` (no `loadSoundScript`, or a wav no archive
ships) and `weapon-draws-nothing` (a `scold*` roll or a `Deploy_*` item whose
tree draws nothing: the models step exports nothing by design and the rig
carries the FireArms).

```bash
cd tools/bf1942-models
systemd-run --user --scope -p MemoryMax=16G \
  python3 audit_mod.py --mod fhsweurope --audit loadouts armoury nations flagcloth
```

A whole-tree pass is a few minutes (FHSWEurope 171 levels about 6 min, most of
it the first fetch of 161 remote scenes, 1.4 MB each; cached after).

## Counts, before and after

Findings that are not accepted, per tree. "Before" is the first pass
(2026-10-21 evening, with the rules as finally written); "after" the pass
after every fix below was applied and published.

| Tree | Levels | loadouts | armoury | nations | flagcloth | Before | After |
|---|---|---|---|---|---|---|---|
| vanilla | 24 | 1 (Strasbourg, no row) | 0 | 3 (Coral Sea, Liberation of Caen) | 0 | 4 | 0 |
| XPack1 | 29 | 0 | 0 | 3 (the same two) | 0 | 3 | 0 |
| XPack2 | 32 | 0 | 0 | 5 (+ Eagle's Nest, Telemark) | 0 | 5 | 0 |
| FH | 10 | 0 | 0 | 0 | 0 | 0 | 0 |
| FHSW | 140 | 0 | 0 | 3 (River Don, Stalingrad Red Square) | 0 | 3 | 0 |
| FHSWEurope | 171 | 0 | 14 (4 no glb, 7 rounds not in the table, 3 bodiless fuse rounds) | 0 | 0 | 14 | 0 |

Accepted rows, unchanged: Binoculars and grenades whose script or wav the
install lacks (vanilla, XPack1, XPack2 1 each, FH 10, FHSW 8, FHSWEurope 14),
and the scold rolls and Deploy items that draw nothing (FHSW 42, FHSWEurope
44). Beyond the hand weapons the audit reads, the damage-table repair covered
every level-declared round: 77 exported levels had rounds missing (vanilla 2,
XPack1 2, XPack2 3, FHSW 15, FHSWEurope 55), none after.

Two first-pass false positives were fixed in the audit, not the data: 550
FHSWEurope `level-kit-row-stale` rows from quoted `addWeaponIcon` arguments,
and SW's throwing knives (a thrown `bullet` is a ray for the player too).

## Root causes found and fixed

1. **The Instant Battle row read the wrong soldier** (`nations`,
   `menu-side-skin-mismatch`, `menu-side-nation-mismatch`).
   `extract_menu_layout.level_record` ran a bare regex over every
   `*/init.con` of every archive, in a plain sort that put
   `Coral_Sea_003.rfa` before `Coral_sea.rfa` ('S' < 's'). So Liberation of
   Caen took the British soldier of its `beginrem` block (the live binding is
   Canadian) and Coral Sea the base archive's US soldier over the patch's
   Marines; Eagle's Nest's Elite Germans, Telemark's commandos, FHSW's
   Hungarians at River Don and Stalingrad Red Square's Russians the same way.
   It now reads the root `Init.con` through `LevelFiles` (later archive wins)
   and `kit.parse_level_kits`, as `loadouts.json` does, and `level_archives`
   orders a patch after its base. 10 rows moved (vanilla 2, XPack1 2, XPack2
   4, FHSW 2); Liberation of Caen goes back to `can`, which corrects
   6e420f46's row.
2. **A level-declared round fell out of the mod's damage table**
   (`armoury`, `round-not-in-damage-table`). `write_damage_tables` wrote the
   mod-wide projectile table from the library of the level being baked, so
   each bake dropped every other level's own rounds (203 Hill's grenades,
   Latakia's RPG-7 rounds; 77 levels across five trees had rounds missing).
   It now merges, the baked level's rows winning. Repaired with
   `patch_scene.py --layer damage` over just those levels (seconds a level,
   FHSW's about 20 s).
3. **A weapon only a level's own copy of a stock kit carries had no glb**
   (`armoury`, `weapon-no-model`). `kit_weapon_templates` walked the census
   library, which keeps the chain's copy of a kit, so Cairo's
   `4German_SupportFG42` (`FG42Bay`, `FG42rifle_grenade`, `FG42Full_Lay`) and
   Kyoshu's `Cavalry_3Jap_AntiTankMolotov` (`Japan10KgExplosive`) were never
   modelled: a bot holding one had no fire data and its rifle grenade never
   flew. `level_kit_weapon_templates` reads each level's own kit blocks too.
   The four were re-extracted (`mod_pipeline.py reextract`), thumbnailed and
   the registry rebuilt.
4. **A bodiless fuse round was a ray for the bots** (`armoury`,
   `thrown-round-not-flown`). The exporter files a round with no drawn body
   as a `bullet` (FHSWEurope's `APLandmineT1`, `Suicidebomb`), and
   `bot-rounds.js` flew only shells and rockets, so a bot's mine never stood
   and its bomb never went off. `launchesDrawnRound` now also flies a fuse
   round and a round that carries a depot or a spawner, as `round-launch.js`
   does for the player. A thrown non-fuse bullet (SW's throwing knives) stays
   a ray, as the player's is.
5. **A community map had no loadouts row** (`loadouts`,
   `loadout-level-missing`). Strasbourg was baked by the community-map recipe,
   which never ran `extract_loadouts`; the page dealt its fallback kits there.
   Read with `--delta`, and the recipe in `features/community-maps` now has
   the step.

6. **On the live site no bot had weapon data.** Found while confirming the
   publish: the volume serves a stored model only as `glbs/<sha>.glb`, and
   every per-tree weapon url 404s there (`models/Thompson.glb`,
   `models/mods/fhsweurope/MillsGrenade.glb`, the four new glbs). The page's
   loaders resolve through the store (`glb-loader.js`), but
   `map.html` `botWeaponData` fetched the weapon glb with `pose-bases.js`
   `fetchFirst`, a plain fetch: every bot weapon's fire data came back null
   live, so the bots fired at the fallback rate and `botRounds.noteWeapon`
   was never called, which left cbf7e297's flown grenades working locally
   and nowhere else. `fetchFirst` now asks each url through `resolveGlb`
   (`tests/test_pose_bases.py`). Locally the per-tree files exist, which is
   why no local check saw it.

7. **A worn part whose geometry names another level's mesh drew nothing**
   (found by `tests/test_kit_worn_glbs_on_disk.py` in the full suite run
   after the fixes). Warring States' and Cebu's Tengu cap, and every jetpack
   kit's backpack and pickup, declare `GeometryTemplate.file
   ../bf1942/Levels/operation_kikusui_day2/standardMesh/...`; the engine
   mounts every level archive at its own path, so the mesh loads, but
   `extract_kits.part_pools` mounted only the declaring level. It now mounts
   the named level's meshes too (not its textures: the texture lookup stays
   the declaring level's). The FHSWEurope `kits` step re-ran: 27 kit rows
   moved (the caps, `Jetpack_BackPack` 0 -> 418 triangles, the jetpack
   pickups, Nikolayevka's helmets), and 58 kit files were published. The
   test's `NO_MESH` row that called Cebu's cap the mod's data is gone.
8. **A kit's stock items were asked for on levels that run their own copy**
   (`tests/test_viewmodel_rigs_on_disk.py`: `MILORGSoldier__Madsen`).
   `extract_pose.kit_pair_levels` paired the stock copy's items with every
   level the kit is on, including those whose own copy replaces them; Wolves'
   `NR_MILORG_HeavyMG` holds its own `MadsenLMG`, so `Madsen` is held
   nowhere. The stock items now go only to levels without an items copy.

FHSWEurope's and FHSW's `loadouts` came out clean: the delta-merge repair of
a1809b92 and the FH/FHSW batch re-read that followed it hold. No flag cloth
anywhere misses its level's alternative texture.

## Published

2026-10-21, `scripts/publish-mesh-delta.py textures glbs models maps --root
~/.cache/sides-publish --hash --hash-remote`, a hard-linked staging root of
exactly these files (149):

- `menu-levels.json`: vanilla, XPack1, XPack2, FHSW.
- `loadouts.json`: vanilla (Strasbourg's row).
- `_shared/damage.json` and the patched levels' `scene.json`: vanilla 2,
  XPack1 1, XPack2 2, FHSW 14, FHSWEurope 55.
- FHSWEurope models: the four weapon glbs with `.gz` and reports, their
  thumbnails, `models.json`, and `models/mods.json`; `store_glbs.py` over the
  tree, so their blobs (and 11 rig and pose blobs of the FH/FHSW loadouts
  run) and the re-hashed `models.json`, `viewmodels/index.json`,
  `poses/index.json`.
- After the full test run: the FHSWEurope `kits` step's output (58 kit files
  and `kits.json` changed of 1,984 staged, `--root ~/.cache/sides-publish2`).

Checked live with a cache-buster, sha256 against local: `loadouts.json`,
three `menu-levels.json`, FHSWEurope `damage.json`, 203 Hill's `scene.json`,
`models.json`, a thumbnail, two store blobs (`glbs/<sha>.glb`), `kits.json`
and three kit glbs. The per-tree weapon glbs are served from the store only.

## The dropped bags (2026-10-21)

FHSWEurope had 12 kit bag geometries with no glb on its exported levels
(`DRG40_kit_m1`, `Kit_AK74`, `Kit_RPG7` and `Kit_rpg7`, ...): what a dead
soldier of those kits drops. The models audit counted them as one
unclassified major row, `kit-pickup-not-exported` (18 kits.json rows). None
was a skip by the pipeline. Each was read in the install, against the level
that deals the kit (`extract_loadouts.LevelLoad`, the level's own scripts
first):

| Bag | Why retail draws nothing |
|---|---|
| `DRG40_kit_m1`, `LPG44_Kit_m1`, `VPGS41_Kit_m1` (Alaska, Seelow Heights, Orel, Pavlov) | Declared only in FHSW's `objects/Items/RussKit/!_PACK_RUS/Compressed.con` (451 KB). FHSWEurope ships its own pack at that path (333 KB) without them, and the nearer file wins, so nothing the level reads declares them (GEO-1) |
| `Kit_AK74`, `Kit_RPG7`, `Kit_rpg7`, `Kit_stg44_m1` (Latakia), `Kit_pol_wz38m` (Hell in Warsaw, Nowy Targ), `Kit_lewis_Allies`, `Kit_Allies_Medicbag` (Balikpapan) | No `GeometryTemplate.create` of the name anywhere in the chain. Latakia ships `StandardMesh/Kit_AK74.sm` and `Kit_RPG7.sm` with no template over them; the engine has no fallback to a mesh file of the name (GEO-1) |
| `Kit_nor_saboteur` (Wolves) | Declared over `Kit_nor_saboteur_m1`, a `.sm` no archive of the chain ships |
| `smoke_M18_green` (Market Garden) | Declared over `../bf1942/levels/muurola-1944/standardmesh/smoke_M18_green_m1`; Muurola ships no such mesh (only FH's Cretan Village has one, at its own level path) |

The same reading found an extractor bug the other way: a level copy of a
kit whose own bag failed to build dropped the mod's bag. 226-1936,
kyujo_incident-1945 and warring_states re-declare `Kit_Japanese_Arisaka38`,
`Kit_Japanese_ArisakaCar`, `Kit_Japanese_Type100SMG` and `Kit_US_M1Carbine`
over meshes no archive ships, and their copy wins there (LOAD-1), but
`extract_kits.bag_glb` fell back to the mod's rifle. `level_bag_glb` now
leaves such a bag empty: 11 `levelVariants` pickup rows of 9 kits went from
the mod's glb to none. No glb changed.

The check is now the `kits` audit's (`audit_play.py`, in `v_static`), per
exported level, the level's own copy's bag over the kit's, dealt and
pad-laid kits alike:

| Cause | When | Severity |
|---|---|---|
| `kit-pickup-not-built` | the level's load declares the geometry and an archive it mounts ships the mesh | blocker ("a dropped kit is invisible") |
| `kit-pickup-geometry-undeclared` | nothing the level reads declares it (GEO-1) | accepted |
| `kit-pickup-mesh-absent` | declared over a `.sm` no mounted archive ships (the chain's `standardMesh`, the level's folder, or the level a `../` path names) | accepted |

The models audit keeps only `kit-pickup-glb-missing` (a named glb not on
disk). The audit builds one level load per level with a bag finding and
releases it; holding them all was killed at the 4 GB `v_static` cap, and the
pass now peaks at 1.9 GB (`STATIC_AUDIT_GB["kits"]` 2.0).

Counts on exported levels, kits audit (rows, kit and level):

| Tree | Before: bags with no glb | Not built | Accepted after |
|---|---|---|---|
| vanilla, XPack1, XPack2, FH, FHSW | 0 | 0 | 0 |
| FHSWEurope | 12 geometries (14 rows), plus 11 variant rows drawing the mod's bag | 0 | 20: 12 undeclared, 8 mesh absent |
| Desert Combat, DC Final (parked) | 0 | 0 | 0 |
| EoD (parked) | 1 | 0 | 1 (`French_Rifleman` on Baytown, bag `Kit` declared nowhere) |

Published: FHSWEurope `kits.json` (`~/.cache/pickups-publish`, one file),
live sha256 equal to local with a cache-buster.

## Parked mods (counted, not re-extracted)

Not re-extracted (parked). Non-accepted findings, all four audits:

| Tree | Levels | Findings |
|---|---|---|
| Desert Combat | 35 | 28: 18 `weapon-no-rig` (TabukSniper and others on 2 levels), 10 `menu-side-nation-mismatch` (the pack predates 6e420f46) |
| DC Final | 48 | 59: Liberation of Caen deals the British kits where `Init.con` binds `USSoldier` and five US kits (1 soldier, 5 slots); DC_First_Light's own `US_AT3`/`Iraq_AT3` copies not dealt (2); 1 icon pairing; 34 `weapon-no-rig`; 16 menu nations |
| EoD | 239 | 712: 360 `side-soldier-no-art` (EoD's `soldier-icons.json` has no nation for its soldiers), 324 `weapon-no-rig`, Snipers' own `VC_Rifleman` copies (6), 15 icon pairings, 7 rounds not in the table |

Each needs that mod's `loadouts`, `hud`, `viewmodels` and damage re-runs when
it is unparked; the code fixes above already apply to them.

## Open

- `bot-rounds.js` and `pose-bases.js` reach the site with the next viewer
  deploy of main; until then live bots have no weapon data (item 6).
- A `scold*` item is never checked for a glb, whatever its level copy hangs
  under it (FHSW's `RandomSmokeItem5RDG22` on Battle of Stalingrad carries a
  scold LodObject that draws).
