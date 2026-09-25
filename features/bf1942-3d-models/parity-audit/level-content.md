# Level / world content parity gaps

Audit of what the 23 vanilla BF1942 level archives declare versus what
`tools/bf1942-models/` extracts and `viewer/map.html` draws. Investigation only —
nothing was changed.

Everything below is derived from the installed game at
`~/.wine/drive_c/EA Games/Battlefield 1942/Mods/` read through the project's own
`bf42.rfa.RfaArchive`, and from the 23 vanilla + 239 EoD `scene.json` files
already on disk under `tools/bf1942-models/viewer/maps/`.

Scratch scripts used (all reproducible, all in
`/tmp/claude-1000/-home-dylan-projects-skandia-bfstats/1d63566b-138e-4db6-b00d-a4f3727aa7e9/scratchpad/`):
`enum_level_files.py`, `paths.py`, `verbs.py` → `verbs.json`/`verbs.txt`.

---

## 0. The corpus

23 base level archives (`Aberdeen.rfa` … `Wake.rfa`; the `_000`/`_003` patch
archives overlay them and `LevelFiles` already merges them), **5,894 entries
total**.

| ext | n | | top-level dir | n |
|---|---|---|---|---|
| `.tga` | 2081 | | `ObjectLightmaps/` | 2093 |
| `.dds` | 1468 | | `Textures/` | 1283 |
| `.con` | 1282 | | `Objects/` | 484 |
| `.raw` | 404 | | `PathFinding/` | 358 |
| `.ssc` | 309 | | (level root) | 332 |
| `.rs` | 98 | | `SinglePlayer/` | 175 |
| `.sm` | 75 | | `Conquest/` | 159 |
| `.wav` | 49 | | `StandardMesh/` | 147 |
| `.pal` | 46 | | `AltTextures/` | 129 |
| `.dat` | 31 | | `Tdm/` | 123 |
| `.rcm` | 24 | | `Sounds/` | 105 |
| `.lsb` | 22 | | `Ctf/` | 91 |
| `.bak` 4, `.txt` 1 | | | `Menu/` 80, `AI/` 76, `GameTypes/` 68, `Init/` 46, `ObjectiveMode/` 10, `aiMeshes/` 6 |

### 0.1 Path-family → is it read at all

`extract_map.load_level` (`extract_map.py:163-192`) is the complete list of
level files the pipeline opens, plus terrain tiles (`LevelFiles.tiles()`),
`ObjectLightmaps/` (`index_object_lightmaps`), `Sounds/` (`discover_level_sounds`)
and `Textures/InGameMap` (`extract_map.py:1070`).

| Path family | lvls | read? | where |
|---|---|---|---|
| `Init.con` | 23 | **yes** (partial) | `extract_map.py:171`, `level.py:830` |
| `Init/Terrain.con` | 23 | **yes** (partial) | `extract_map.py:169`, `level.py:507` |
| `Init/SkyAndSun.con` | 23 | **yes** (partial) | `extract_map.py:174` |
| `StaticObjects.con` | 23 | **yes** (partial) | `extract_map.py:176`, `level.py:534` |
| `Heightmap.raw` | 23 | **yes** | `extract_map.py:189` |
| `Textures/Tx<c>x<r>.dds` | 23 (807 files) | **yes** | `level.py:423` |
| `Textures/Detail.dds` | 23 | **yes** | `terrain_report.detailTexture` |
| `Textures/ENVMAP_G_.rcm` + `env_*.dds` | 23 | **yes** | `level.py:797`, `extras.envmap` |
| `Textures/InGameMap.dds` | 23 | **yes** | `extract_map.py:1070` |
| `ObjectLightmaps/*.tga` + `palette.pal` | 23 (2093 files) | **yes** | `level.py:1021` |
| `Sounds/*.con`, `*.ssc` | 21 | **yes** | `level.py:1348` |
| `Conquest/ControlPoint{s,Templates}.con` | 22 | **yes** | `level.py:715` |
| `Conquest/SoldierSpawn{s,Templates}.con` | 23 | **yes** | `level.py:715` |
| `Conquest/ObjectSpawn{s,Templates}.con` | 23 | **yes** | `extract_map.py:183-188` |
| `Conquest/spawnPointManagerSettings.con` | 23 | **NO** | — |
| `SinglePlayer/*` (9 files each) | 19 | **NO** | mode loop stops at Conquest |
| `Tdm/*` (7 files each) | 17 | **NO** | " |
| `Ctf/*` (7 files each) | 13 | **NO** | " |
| `ObjectiveMode/*` | 1 (Truk) | **NO** | " |
| `GameTypes/{Conquest,CoOp,Tdm,Ctf}.con` | 23/19/13/12 | **NO** | — |
| `Conquest.con` / `Ctf.con` / `Tdm.con` / `CoOp.con` (root) | 23/18/13/19 | **NO** | — |
| `SinglePlayerAllied.con` / `SinglePlayerAxis.con` | 19 | **NO** | — |
| `AI/{StrategicAreas,Strategies,Conditions,Prerequisites}.con` | 19 | **NO** | — |
| `AI.con`, `AIpathFinding.con` | 19 | **NO** | — |
| `PathFinding/*.raw` (358 files) | 19 | **NO** | — |
| `aiMeshes/*` (6 files) | 2 | **NO** | — |
| `Materialmap.raw` | 23 | **NO** | size parsed, file never read |
| `Textures/LightmapShadowBits.lsb` | 22 | **NO** | documented (README "Not yet used") |
| `Textures/TerrainPalette.pal` | 22 | **NO** | — |
| `Textures/terrainDefault.dds` | **3** | yes when present | `extract_map.py:1264` |
| `StandardMesh/*.sm` + `.rs` (72 files) | 2 | **NO** | pool never fed — see Gap 2 |
| `Objects/**` (484 entries) | 5 | **yes** | `rfa.py:160`, commit `0380713` |
| `Menu/Init.con` | 23 | **NO** | — |
| `Menu/Thumbnail.dds` | 23 | **NO** (covered by a different tool) | — |
| `Menu/Texture/**` | 1 (BoB) | **NO** | — |
| `CullRadius.con` | 16 | **NO** | — |
| `Precache.con` | 20 | **NO** (benign: `Object.create` + `Object.delete` cache warmers) | — |
| `LoadCounter.dat`, `TexturePrecache.dat` | 23/8 | **NO** (benign) | — |
| `WaterShader.rs` | 21 | **NO** (benign: 49-byte empty subshader, see map-parity.md) | — |

---

## 1. TABLE A — directive coverage (the core deliverable)

Every distinct `<ns>.<verb>` across all 1,282 `.con` files in the 23 level
archives: **634 distinct verbs, 145,976 occurrences.** Classification is
`verb` present as a matched command literal anywhere in `bf42/*.py`,
`extract_map.py`, `viewer/map.html`, then hand-corrected (corrections marked †).

Reproduce: `python3 scratchpad/verbs.py` then the classifier in
`scratchpad/coverage.json`.

**Totals: 158 verbs PARSED (103,372 occurrences) · 476 verbs IGNORED (42,604 occurrences).**

### 1.1 Per-file parse rate (occurrences)

| file (normalised) | parsed | ignored | % parsed |
|---|---|---|---|
| `StaticObjects.con` | 71,345 | 13,735 | 83.9% |
| `SinglePlayer/SoldierSpawnTemplates.con` | 10,209 | 3,228 | 76.0% |
| `Conquest/ControlPointTemplates.con` | 6,829 | 3,019 | 69.3% |
| `Conquest/ObjectSpawnTemplates.con` | 3,556 | 3,240 | 52.3% |
| `Sounds/beach*.con` | 3,939 | 0 | 100% |
| `Conquest/ObjectSpawns.con` | 1,927 | 1,535 | 55.7% |
| `AI/StrategicAreas.con` | 180 | 2,301 | **7.3%** |
| `Init/SkyAndSun.con` | 943 | 1,271 | 42.6% |
| `Conquest/spawnPointManagerSettings.con` | 495 | 1,097 | 31.1% |
| `AI/Strategies.con` | 0 | 1,497 | **0%** |
| `CullRadius.con` | 0 | 1,427 | **0%** |
| `Init.con` | 650 | 492 | 56.9% |
| `Precache.con` | 0 | 1,073 | 0% (benign) |
| `Conquest.con` | 0 | 494 | **0%** |
| `AI.con` | 3 | 466 | **0.6%** |
| `Init/Terrain.con` | 230 | 236 | 49.4% |
| `Menu/Init.con` | 0 | 440 | **0%** |
| `AI/Conditions.con` | 0 | 343 | 0% |
| `AIpathFinding.con` | 0 | 318 | 0% |
| `AI/Prerequisites.con` | 0 | 301 | 0% |

### 1.2 The 30 highest-volume IGNORED directives

| n | lvls | verb | usual file | consequence |
|---|---|---|---|---|
| **8,596** | 22 | `Object.geometry.scale` | `StaticObjects.con` | per-instance size of every tree/bush lost — Gap 1 |
| **5,123** | 16 | `Object.geometry.color` | `StaticObjects.con` | per-instance tint lost — Gap 1 |
| 1,525 | 21 | `Object.setOSId` | `<mode>/ObjectSpawns.con` | flag→vehicle-spawner binding lost — Gap 7 |
| 1,342 | 4 | `GeometryTemplate.setLodDistance` | level-local `Geometries.con` | no per-object LOD chain — Gap 11 |
| 1,033 | 20 | `Object.delete` | `Precache.con` | benign |
| 847 | 23 | `ObjectTemplate.SpawnDelayAtStart` | `ObjectSpawnTemplates.con` | vehicle respawn timing |
| 752 | 19 | `aiStrategy.setStrategicObjectsModifier` | `AI/Strategies.con` | AI layer — Gap 8 |
| 733 | 17 | `objectTemplate.cullRadiusScale` | `CullRadius.con` | per-object draw distance — Gap 11 |
| 732 | 23 | `ObjectTemplate.DamageWhenLost` | `ObjectSpawnTemplates.con` | gameplay rule |
| 727 | 14 | `ObjectTemplate.setSpawnRotation` | `SoldierSpawnTemplates.con` | spawn facing (SP dirs) |
| 727 | 14 | `ObjectTemplate.setSpawnPositionOffset` | " | spawn offset |
| 723 | 14 | `ObjectTemplate.setSpawnPreventionDelay` | " | " |
| 695 | 23 | `ObjectTemplate.MinSpawnDelay` / `MaxSpawnDelay` | `ObjectSpawnTemplates.con` | vehicle respawn timing |
| 694 | 16 | `Objecttemplate.active` | `CullRadius.con` | selects the template `cullRadiusScale` applies to |
| 534 | 23 | `ObjectTemplate.hasCollisionPhysics` | `ControlPointTemplates.con` | — |
| 525 | 19 | `AIStrategicArea.setOrderPosition` | `AI/StrategicAreas.con` | tactical layout — Gap 8 |
| 504 | 19 | `AIStrategicArea.addNeighbour` | " | " |
| **495** | 23 | `spawnPointManager.groupTeam` | `spawnPointManagerSettings.con` | authoritative spawn-group team — Gap 6 |
| 495 | 23 | `spawnPointManager.groupIcon` | " | respawn-screen icon — Gap 6 |
| 483 | 11 | `ObjectTemplate.setSpawnAsParaTroper` | SP `SoldierSpawnTemplates.con` | paradrop spawns |
| 398 | 19 | `aiStrategicArea.addObjectTypeFlag` | `AI/StrategicAreas.con` | Gap 8 |
| 349 | 22 | `timeToLoseControl`, `disableIfEnemyInsideRadius`, `disableWhenLosingControl`, `loseControlWhenEnemyClose`, `loseControlWhenNotClose` (5 verbs) | `ControlPointTemplates.con` | capture rules; `timeToGetControl` *is* parsed, its four siblings are not |
| 248 | 23 | `Game.setTicketLostPerMin` | `Conquest.con` | Gap 14 |
| 246 | 23 | `Game.setNumberOfTickets` | `Conquest.con` | Gap 14 |
| 235 | 23 | `game.setKit` | `Init.con` | Gap 14 (kits.md covers the kit *models*, not the per-level assignment) |
| 185/180/179 | 19 | `aiStrategicArea.setActive` / `.create` / `.setSide` | `AI/StrategicAreas.con` | Gap 8 |
| 95/68/68 | 19 | `ai.addSearchType` / `.addSearchMap` / `.setMapSpawnPoints` | `AIpathFinding.con` | Gap 8 |
| 91 ×7 | 19 | `ObjectTemplate.setFlare*` (7 verbs) | `Init/SkyAndSun.con` | lens flare — already documented in map-parity.md |
| 47 | 23 | `game.setTeamSkin` | `Init.con` | which soldier skin each side wears on this level |
| 46 | 23 | `TextureManager.mipmaps` | `Init/SkyAndSun.con` | — |

### 1.3 `Init.con` / `Init/Terrain.con` / `Init/SkyAndSun.con` — full coverage

These three files are the level's whole render configuration. Parsed by
`level.py:830 parse_init_con` and `level.py:507 parse_terrain_con`.

| verb | lvls | status | note |
|---|---|---|---|
| `renderer.fogColorVec` | 21 | PARSED | |
| **`renderer.setFogColorVec`** | **2** | **IGNORED** † | Midway + Truk → grey default — Gap 3 |
| `renderer.fogLinearStart` / `End` | 5 | PARSED | |
| **`renderer.fogstart` / `fogend`** | **9** | **IGNORED** † | classifier false-positive; verified by hand — Gap 4 |
| `renderer.vertexFogEnable` | 23 | IGNORED | always `1`; benign |
| `renderer.{ambient,diffuse,specular,globalAmbient}Color` | 23 | PARSED | |
| `renderer.animatedMeshAmbientColor` | 22 | IGNORED | |
| `renderer.animatedMeshDiffuseFactor` | 7 | IGNORED | |
| `renderer.globalLodPercent` | 22 | IGNORED | global LOD bias |
| `shaderManager.setDefaultShaderSolidColor` | 22 | IGNORED | |
| `shaderManager.setTextureParam envmap` | 23 | IGNORED (hardcoded path instead) | |
| `Game.setViewDistance` | 23 | PARSED | |
| `renderer.setViewdistance` | 1 | PARSED | |
| `game.setActiveCombatArea` | **11** | PARSED | 12 levels declare none — Gap 15 |
| `game.setBeforeSpawnCameraPosition` | 23 (×2) | PARSED, team-2 wins | `level.py:914` overwrites; team 1's camera is discarded |
| `game.setKit` / `setTeamSkin` / `assaultTeam` / `spawnPlayers` | 23/23/10/23 | IGNORED | |
| `textureManager.alternativePath` | 23 | PARSED | |
| `TreeRenderer.billboardlightscale` | 4 | IGNORED | Gap 20 |
| `Sky.*` (initSky, setRotAngle, changeOfsSkyHeight, addCloud, changeOfsCloud{Height,Dist}, sunLightDirectionVec) | 23 | PARSED | |
| `Sky.setSun` / `Sky.setCloudFog` | 21/23 | IGNORED | |
| `Cloud.setTexScale/setSpeed/setHeight` | 23 | PARSED | |
| `Cloud.setName/setSrcBlend/setDstBlend` | 23 | IGNORED | |
| `ObjectTemplate.setFlare*` (8) / `setCorona*` (8) / `setLensFlareCount` / `initLensFlares` / `setVisibilityAngleDeg` | 19-21 | IGNORED | documented gap (map-parity.md) |
| `GeometryTemplate.{worldSize,yScale,texBaseName,texOffsetX/Y,detailTexName,waterLevel,seaFloorLevel}` | 23 | PARSED | |
| `GeometryTemplate.materialSize` | 23 | **PARSED-BUT-UNUSED** | `level.py:517` sets `TerrainInfo.material_size`; nothing reads it |
| **`GeometryTemplate.materialMap`** | **23** | **IGNORED** | `Materialmap.raw` never opened — Gap 9 |
| **`GeometryTemplate.lodDistance`** | **22** | **IGNORED** | terrain LOD ring — Gap 10 |
| **`GeometryTemplate.targetTriCount`** | **23** | **IGNORED** | terrain tessellation target (5000) — Gap 10 |
| `GeometryTemplate.waveHeight` / `waveScale` | 5 / 1 | IGNORED | Gap 17 |
| `Water.baseTex` | 16 | IGNORED | Gap 17 |
| `water.bumpTex` / `bumpTile` / `specularBumpMapFactor` / `envIntensity` | 1 (GuadalCanal) | IGNORED | Gap 17 |
| `water.envmapcolor` | 3 | IGNORED | Gap 17 |
| `water.wateShallowAlpha` (typo) | 1 (El_Alamein) | IGNORED | El Alamein loses its shallow-alpha |
| all other `water.*` (18 verbs) | 16-19 | PARSED | |
| `Terrain.ShadowAmbient` / `ShadowBorderFadeTime` / `ShadowSamplingCullY` | 23/23/20 | IGNORED | documented (rendering-technology.md) |
| `objectTemplate.createNotInGrid` | 23 | IGNORED | benign |
| `Object.setName` | 23 | IGNORED | benign |

---

## 2. TABLE B — per-level skipped / unresolved / missing

### 2.1 Vanilla (23 levels, `viewer/maps/<level>/scene.json`)

Reproduce: the aggregation snippet in §5 of this document, or
`python3 -c "import json,glob; [print(f, json.load(open(f))['objects']['missingMeshes']) for f in glob.glob('viewer/maps/*/scene.json')]"`.

| level | placed | skipped | unresolvedTemplates | missingMeshes | texturesMissing | missingTiles | combatArea |
|---|---|---|---|---|---|---|---|
| aberdeen | 193 | 0 | 0 | 0 | 1 | 0 | — |
| battle_of_britain | 626 | 5 | 1 | **26** | 1 | 0 | yes |
| battle_of_the_bulge | 1518 | 1 | 1 | 0 | 1 | 0 | yes |
| battleaxe | 418 | 2 | 0 | 0 | 1 | 0 | — |
| berlin | 325 | 1 | 1 | 0 | 2 | 0 | yes |
| bocage | 269 | 2 | 0 | 0 | 2 | 0 | — |
| coral_sea | 499 | 0 | 0 | 0 | 0 | 0 | — |
| el_alamein | 874 | 3 | 1 | 0 | 2 | 0 | — |
| gazala | 874 | 2 | 0 | 0 | 2 | 0 | — |
| guadalcanal | 917 | 8 | 6 | 0 | 2 | 0 | — |
| invasion_of_the_philippines | 823 | 7 | 4 | 0 | 1 | 0 | yes |
| iwo_jima | 508 | 2 | 1 | 0 | 2 | 0 | — |
| kasserine_pass | 1133 | 2 | 0 | 0 | 1 | 0 | yes |
| kharkov | 917 | 3 | 1 | 0 | 0 | 0 | — |
| kursk | 1440 | 5 | 3 | 0 | 0 | 0 | — |
| liberation_of_caen | 729 | 15 | 2 | **19** | 1 | 0 | yes |
| market_garden | 342 | 4 | 3 | 0 | 2 | 0 | yes |
| midway | 200 | 5 | 3 | 0 | 2 | 0 | — |
| omaha_beach | 429 | 2 | 2 | 0 | 1 | 0 | yes |
| stalingrad | 648 | 1 | 1 | 0 | 1 | 0 | yes |
| tobruk | 750 | 1 | 1 | 0 | 1 | 0 | yes |
| truk | 2699 | 4 | 0 | 0 | 2 | 0 | yes |
| wake | 736 | 4 | 3 | 0 | 1 | 0 | — |
| **total** | **17,867** | **79** | **34** | **45** | **29** (5 distinct) | **0** | **11 / 23** |

Breaking the 79 `skipped` down by cause (this matters — most are *correct*):

| cause | n | verdict |
|---|---|---|
| `AlliedAirplaneAmmo` / `AxisAirplaneAmmo` | 27 | **correct.** `Objects/Buildings/Common/AlliedAirplaneAmmo/Objects.con` has `rem ObjectTemplate.geometry Ammobox_m1` — invisible in the engine too. |
| Sound-area line objects (`Coastline` ×6, `island1-3` ×6, `CoastlineIsle1-5` ×5, `beach1/2/3/5`, `river`/`river4`/`river5`, `lake`/`lake2`/`lake3`, `Riverside`/`Riverside2`/`rivermid`) | 32 | **correct.** They are `ObjectTemplate.addLinePoint` sound emitters and are already consumed into `scene.sounds.areas`. They double-count into `unresolvedTemplates`, which is misleading noise in the report. |
| `Siren` (Battle_of_Britain — the archive also ships `sound/3khz/air-raid-siren-pitched-reverb.wav`) and `Easter` (Omaha_Beach, unidentified) | 2 | probably also sound objects — **UNVERIFIED** |
| `Pegasus_Bridge_M1`, `CoastBridge_m1`, `b17_Wreck1-3_m1`, `junkers_Wreck1-3_m1`, 5 × `*_Tombstone_m1`, `Ju88A_Repairpoint`, `PTBoat_Repair_Supply`, `ptsupply`, `AirplaneRepairpoint`, `ParatroopSpawner` | 18 | **real content loss** — see Gap 2 |

(All 34 `unresolvedTemplates` are the middle two rows — 32 sound-area emitters
plus `Siren` and `Easter`.)

The 45 `missingMeshes` are entirely Battle of Britain (26) + Liberation of Caen
(19) and every one of them is a mesh that **is present in the level's own
archive** — Gap 2.

The 5 distinct `texturesMissing` names (`texture/sherW2_f`, `texture/pf_w2_r`,
`texture/B17Win_L`, `texture/RUBBLE_5`, `texture/`) are the four already recorded
in README as shipping in no archive, plus one empty string.

### 2.2 Mods (`viewer/maps/mods/eod/`, 239 scenes)

| metric | value |
|---|---|
| scenes | 239 |
| `placed` | 282,570 |
| `skipped` | 659 |
| `unresolvedTemplates` | 377 |
| `missingMeshes` | 1 |
| `texturesMissing` | 222 |
| `missingTiles` | 12 (all `mods/eod/closefire`) |
| `gameplayMode` | `None` in **239 / 239** |
| `controlPoints` key | **absent in 239 / 239** |
| `soldierSpawns` key | **absent in 239 / 239** |
| `minimap` key | **absent in 239 / 239** |

Worst offenders by unresolved+missing: `eod/danang` (10 skipped / 9 unresolved),
`eod/ngoc_linh_mountain` (9/9), `eod/deserters_island` (9/8),
`eod/ho_chi_minh_trail` (10/8), `eod/operation_hump` (8/8).

---

## 3. Gaps

### Gap 1 — every static object's per-instance scale and tint is silently dropped

**Gap.** `Object.geometry.scale` and `Object.geometry.color`, which 47% of all
placed statics carry, never reach the parser because the command regex cannot
match a three-segment command.

**Ground truth.** `bf1942/levels/<Level>/StaticObjects.con` in 22 of 23
archives. 18,258 `Object.create` lines total; **8,596 carry
`Object.geometry.scale`** (22 levels) and **5,123 carry `Object.geometry.color`**
(16 levels). **Not one of the 8,596 scale values is 1.0**, and 8,068 of them are
non-uniform (different X/Y/Z). Per level: Kursk 1,331 of 1,458 instances (91%),
Battle of the Bulge 1,039 / 1,519, Kharkov 745 / 932, GuadalCanal 734 / 940,
Wake 531 / 747, Coral Sea 477 / 499. The top templates are foliage —
`eu_spruce2_m1` (1,298 scaled / 1,193 tinted), `eu_spruce_large_m1` (1,228 /
1,070), `pacific_palm_2_m1` (498), `afri_bush8_m1` (336 / 327). Example from
Bocage:
```con
Object.create eu_spruce2_m1
Object.absolutePosition 78.5131/92.8735/125.406
Object.rotation 150.984/0.00306194/-0.0713348
Object.geometry.scale 0.932941/0.935059/0.990118
Object.geometry.color 0.494118/0.494118/0.494118
```

**Current state.** `bf42/con.py:38`
`_COMMAND = re.compile(r"^(\w+)\.(\w+)(?:[ \t]+(.*?))?[ \t]*$")`. Verified:
`_COMMAND.match("Object.geometry.scale 0.93/0.93/0.99")` returns `None` — the
line is not merely unhandled, it never becomes a command at all.
`bf42/level.py:534 parse_static_objects` handles only `create`,
`absoluteposition`, `rotation`, `setteam`; `StaticInstance` (`level.py:44`) has
no scale or colour field. `spawn-points.md:745` notes the sub-command grammar
exists but frames it as a harmless FHSW curiosity — the 8,596-instance vanilla
scale is not recorded anywhere.

**Size. M.** Widen the regex to `^(\w+)\.([\w.]+)`, add `scale` and `color` to
`StaticInstance`, thread them into the per-instance node TRS and a vertex-colour
/ material-tint factor in `assemble.py`. The risk is that `.geometry.` is a
nested-object addressing scheme (`Object.<sub>.<cmd>`), so the parser must key on
the *tail* command, not the whole dotted string.

**Impact. Highest in this report.** Every forest in the game currently renders as
a grid of identical clones at one canonical size and one flat colour. DICE's
scatter tool wrote a unique scale and a unique green/grey multiplier per tree
specifically to break that up. This is the single largest visual difference
between the viewer and the game on Kursk, Bocage, Battle of the Bulge, Kharkov
and every Pacific island.

---

### Gap 2 — a level's own `StandardMesh/` folder is never added to the mesh pool

**Gap.** Two vanilla levels ship 72 `.sm`/`.rs` meshes inside their own archive;
the mesh `ArchivePool` is only ever built from the mod chain, so 45 of them
resolve to nothing and 18 placed objects vanish.

**Ground truth.** `Battle_of_Britain.rfa:bf1942/Levels/Battle_of_Britain/StandardMesh/`
(42 `.sm`) and `Liberation_of_Caen.rfa:Bf1942/Levels/Liberation_of_Caen/StandardMesh/`
(30 `.sm`). Confirmed present:
`Battle_of_Britain.rfa:bf1942/Levels/Battle_of_Britain/StandardMesh/Britain_Factory_M1.sm`,
`…/CoastBridge_M1.sm`, `…/RadarTower_Radar_M1.sm`, `…/Junker_Fus_M1.sm`,
`…/Radar_aa_allies_cannon_M1.sm`;
`Liberation_of_Caen.rfa:Bf1942/Levels/Liberation_of_Caen/StandardMesh/Pegasus_Full_M1.sm`,
`…/B17_Wreck1_M1.sm`, `…/pak40_barrel_M1.sm`, `…/t_stone_aa_M1.sm`.
All 45 appear verbatim in the two scenes' `objects.missingMeshes`.

**Current state.** `extract_map.py:1546-1558`:
```py
meshes, textures, objects, _game = build_pools(chain, fallbacks)   # mod chain only
…
textures.add_level(path, label=info.name)                          # textures: yes
objects.add_level_objects(path, label=f"{info.name} objects")      # templates: yes
```
There is no `meshes.add_level_*`. `bf42/rfa.py:57` `LEVEL_TEXTURE_DIRS =
("alttextures", "texture", "textures", "custom textures")` excludes
`standardmesh`, and `rfa.py:160 add_level_objects` only takes the `Objects/`
subtree. Commit `0380713` fixed the template half of exactly this problem and
left the geometry half.

**Size. S.** One method mirroring `add_level_objects` for
`Levels/<Map>/StandardMesh/` (and, for mods, `TreeMesh/`), registered into
`meshes` under `standardMesh/<basename>` and its bare basename.

**Impact. High and visible.** Liberation of Caen loses **Pegasus Bridge** — the
level's title landmark — plus three B-17 wrecks, three Ju-88 wrecks, the PAK40
and five memorial tombstones. Battle of Britain loses the Britain Factory, both
radar towers, the AA radar, the coast bridge and the Ju-88. These are not props;
on Caen the bridge is a control point objective.

---

### Gap 3 — `renderer.setFogColorVec` spelling is unhandled; Midway and Truk fog is neutral grey

**Gap.** Two levels write the `setFogColorVec` variant instead of `fogColorVec`
and fall through to the hardcoded default.

**Ground truth.** `Midway.rfa:bf1942/levels/Midway/Init.con` and
`Truk.rfa:bf1942/levels/Truk/Init.con` both contain exactly
`renderer.setFogColorVec 0.812/0.832/0.921` and neither contains
`renderer.fogColorVec`. Both are the only two levels doing this
(`verbs.json` → `renderer.setfogcolorvec`, `lvls: ["Midway","Truk"]`).

**Current state.** `bf42/level.py:849` handles `cmd == "fogcolorvec"` only.
`LevelInfo.fog_color` default is `(0.7, 0.7, 0.7)` (`level.py:337`).
`viewer/maps/midway/scene.json` and `viewer/maps/truk/scene.json` both carry
`"fogColor": [0.7, 0.7, 0.7]` against the declared pale blue 0.812/0.832/0.921.

**Size. S.** One `or` in the branch condition.

**Impact. Medium.** Both are ocean maps where the fog band *is* the horizon;
neutral grey instead of pale sky-blue makes the sea meet the sky wrong across
the whole view. Also means both maps' skybox horizon band (painted to
0.812/0.832/0.921 by DICE) no longer matches the scene fog — the seam
map-parity.md went to some trouble to close.

---

### Gap 4 — `renderer.fogstart` / `fogend` ignored; 8 levels get an invented fog range

**Gap.** The extractor parses only `fogLinearStart`/`fogLinearEnd` (5 levels)
and derives a `0.5 × viewDistance` heuristic for everything else — but 9 levels
declare the range under the `fogstart`/`fogend` names.

**Ground truth.** `Init.con`, 9 levels: Battle_of_Britain (100 / 500),
Battleaxe (110 / 400), Berlin (0 / 100), Coral_sea (300 / 500),
Invasion_of_the_Philippines (25 / 475), Kharkov (−40 / 400, which *also* declares
`fogLinearStart 120` / `fogLinearEnd 200`), Liberation_of_Caen (50 / 225),
Omaha_Beach (−50 / 290), Truk (250 / 500). Reproduce:
```
python3 -c "import sys;sys.path.insert(0,'tools/bf1942-models');from bf42.rfa import RfaArchive;…"
```
(the dump script is in `scratchpad/`; it prints every `renderer.fog*` line per level).

Declared vs what `scene.json` currently carries:

| level | declared start/end | scene.json start/end |
|---|---|---|
| Battle_of_Britain | 100 / 500 | 275 / 550 |
| Battleaxe | 110 / 400 | 200 / 400 |
| Berlin | 0 / 100 | 50 / 100 |
| Coral_sea | 300 / 500 | 250 / 500 |
| Invasion_of_the_Philippines | 25 / 475 | 250 / 500 |
| Liberation_of_Caen | 50 / 225 | 112.5 / 225 |
| Omaha_Beach | −50 / 290 | 150 / 300 |
| Truk | 250 / 500 | 190 / 380 |

**Current state.** `bf42/level.py:854-857` (`foglinearstart` / `foglinearend`
only); fallback at `extract_map.py:1449-1450`. `flythrough-fidelity-gap.md:45`
records "declare `renderer.fogLinearStart/End`: **5 / 23**" and treats the other
18 as undeclared — 9 of those 18 do declare a range, under the other name.

**Size. S**, plus one **UNVERIFIED** question: on Kharkov both spellings are
present with different values (`fogLinearStart 120 / fogLinearEnd 200` and
`fogstart -40 / fogend 400`), so the engine's precedence between the two has to
be settled before wiring `fogstart` in — the `bf1942-mod-extraction` skill's
decompiled-`BF1942.exe` corpus (§8) is the place to settle it. Note that Omaha
and Kharkov declare *negative* starts, which a naive `THREE.Fog` will not like.

**Impact. Medium.** Omaha Beach is the clearest case: the level wants fog
saturating at 290 m from essentially the camera (−50), which is the grey
Normandy murk of the opening; it currently renders with a clear 0-150 m band.
Invasion of the Philippines wants haze from 25 m; it gets 250 m.

---

### Gap 5 — only the Conquest layout is ever extracted

**Gap.** `find_gameplay_mode` returns the *first* mode directory that exists and
every vanilla level ships `Conquest/`, so the SinglePlayer, Tdm, Ctf, CoOp and
ObjectiveMode object sets — different flags, different vehicle spawns, different
soldier spawns — are never read on any level.

**Ground truth.** Per-mode `Object.create` counts across the 23 archives
(`<mode>/ObjectSpawns.con` and `<mode>/SoldierSpawns.con`):

| mode | dirs | vehicle spawn placements | soldier spawn placements |
|---|---|---|---|
| `Conquest/` | 23 | 754 | 758 |
| `SinglePlayer/` | 19 | 531 | 718 |
| `Tdm/` | 17 | 503 | 599 |
| `Ctf/` | 13 | 386 | 419 |
| `CoOp` (`GameTypes/CoOp.con` + `Coop.con`) | 19 | — | — |
| `ObjectiveMode/` | 1 (Truk, 10 files) | 7 `objectiveManager.registerObjectSpawner` | — |

That is **1,420 vehicle spawn placements and 1,736 soldier spawn placements**
that exist in the shipped archives and are never looked at. `SinglePlayer/`
additionally carries `Bots.con`, `Skirmish.con` and `SinglePlayerTweaks.con`
(19 levels each) and its own `ControlPoints.con` / `ControlPointTemplates.con`.
Concrete divergences: Battleaxe ships 34 Conquest soldier spawns and 70
SinglePlayer ones; Kursk 15 vs 28; Wake 17 vs 45; Iwo_Jima has `Tdm/` but no
`Ctf/`; Kasserine_Pass has `Ctf/` but no `Tdm/`.

**Current state.** `bf42/level.py:672`
`GAMEPLAY_MODES = ("Conquest", "ObjectiveMode", "Ctf", "Tdm", "CoOp", "SinglePlayer")`,
consumed by `level.py:675 find_gameplay_mode` (first hit wins) and
`level.py:715 load_gameplay_objects`; `extract_map.py:181` pins
`mode = info.gameplay.mode or "Conquest"` for the vehicle spawners too.
`scene.json` has a single `gameplayMode` string and single `controlPoints` /
`soldierSpawns` arrays; `viewer/map.html` never reads `gameplayMode` (0 hits).
`minimap-and-fullmap.md:448` flags this as an open question but does not
quantify it.

**Size. L.** `scene.json` needs `modes: {Conquest: {...}, Tdm: {...}}` instead of
flat arrays, `extract_map` needs a loop, and `map.html` needs a mode picker that
re-renders flags/spawns/vehicle markers. The glb is unaffected (statics are
mode-independent), so payload cost is small — it is a schema change plus UI.

**Impact. Medium-high for the map HUD, low for the flythrough.** The 3D scene is
identical across modes; the flags, spawn points and vehicle markers are not.
Today the viewer silently presents the Conquest layout as *the* layout.

---

### Gap 6 — `spawnPointManagerSettings.con` is never read; spawn-group team is inferred

**Gap.** The file that authoritatively maps a spawn group to a team and a
respawn-screen icon is not parsed; team ownership is instead back-derived by
scanning control-point templates for a matching `spawnGroupId`.

**Ground truth.** `<mode>/spawnPointManagerSettings.con`, **23 / 23 levels**,
495 `spawnPointManager.group` blocks. Example,
`Coral_sea.rfa:bf1942/Levels/Coral_sea/Conquest/spawnPointManagerSettings.con`:
```con
spawnPointManager.group 72
spawnPointManager.groupTeam 2
spawnPointManager.groupIcon test2.tga
spawnPointManager.groupEnableToChangeTeam 0
spawnPointManager.onlyForHuman 1
```
Coral Sea has **zero control points**, so every one of its spawn groups (1, 2,
72, 73, …) is unreachable by the inference path. Commands seen: `group`,
`groupTeam`, `groupIcon`, `groupStatus`, `groupEnableToChangeTeam`,
`EnableToChangeTeam`, `onlyForHuman`, `onlyForAI`,
`makeAverageGroupPositions` (10 occurrences / 4 levels).

**Current state.** No hit for `spawnpointmanager` anywhere in `bf42/*.py`,
`extract_map.py` or `viewer/map.html`. Team comes from
`bf42/level.py:701 GameplayObjects.team_of_group`, which loops control-point
templates. `spawn-points.md:162-193` documents the file and the full binding
chain but the code path was never written.

**Size. S.** A 30-line parser plus preferring its answer over the inferred one.

**Impact. Medium.** Any spawn group not owned by a control point currently has
`team: null` — carrier/ship spawns on Coral Sea, Midway, Wake, Guadalcanal, and
the `onlyForHuman` driver seats. `groupIcon` is also the only per-group art the
respawn screen has.

---

### Gap 7 — `Object.setOSId` is never parsed, so no flag owns any vehicle

**Gap.** The id that binds a vehicle spawner placement to the control point that
controls it is dropped.

**Ground truth.** `<mode>/ObjectSpawns.con`, **1,525 `Object.setOSId` lines
across 21 levels** (Conquest 526, Tdm 357, SinglePlayer 378, Ctf 264). It pairs
with `ObjectTemplate.objectSpawnerId` on the ControlPoint side, which *is*
parsed (`level.py:611`, emitted as `controlPoints[].objectSpawnerId`). Example
chain, verified on Wake in `spawn-points.md:185`:
```
ControlPoint.objectSpawnerId 2  ->  Object.setOSId 2 in ObjectSpawns.con
                                ->  ObjectSpawner template -> setObjectTemplate <team> <vehicle>
```

**Current state.** `objectSpawnerId` is emitted per control point but
`Object.setOSId` never is, so the other half of the join is missing — the
spawner nodes in `scene.objects.spawners` carry no owner. `parse_static_objects`
(`level.py:534`) has no `setosid` branch.

**Size. S.** One branch in `parse_static_objects` (which is already the parser
used for `ObjectSpawns.con` at `extract_map.py:186`) plus one field in
`StaticInstance` and the spawner report.

**Impact. Medium.** Unlocks "capture this flag and you get the Tiger" — the
single most useful thing the map HUD could say that it currently cannot. Also
makes the vehicle markers team-correct when a flag flips.

---

### Gap 8 — the entire AI / pathfinding layer is unread

**Gap.** Nothing under `AI/`, `AIpathFinding.con`, `PathFinding/` or
`aiMeshes/` is opened.

**Ground truth.**
- `AI/StrategicAreas.con` — 19 levels, **190 `aiStrategicArea.create`** blocks,
  each `create <Name> <x/z> <x/z> <radius>` plus 525 `setOrderPosition`, 504
  `addNeighbour`, 398 `addObjectTypeFlag`, 185 `setActive`, 179 `setSide`, 193
  `addAllowedVehicleGroup`, 49 `vehicleSearchRadius`, 42 `setTakeable`. Example:
  `aiStrategicArea.create Allied_EastAirfield 1534/1647 1609/1677 150`,
  `AIStrategicArea.setOrderPosition Tank 1613/1670`,
  `AIStrategicArea.addNeighbour Allied_Factory`. Parse rate of this file: **7.3%**
  (the 180 `create` lines happen to share a verb name with parsed code).
- `AI/Strategies.con` (19 levels, 1,497 occurrences, 0% parsed),
  `AI/Conditions.con` (343), `AI/Prerequisites.con` (301), `AI.con` (466).
- `AIpathFinding.con` — 19 levels, 318 occurrences: `ai.addSearchMap Tank0 0 0
  30 3.0 0.3 2.5 0 0 2`, `ai.addSearchType Tank 0 0`, `ai.setMapSpawnPoints 0
  1231/1608,438/338`, `ai.setSmoothing`.
- `PathFinding/*.raw` — **358 files across 19 levels**, a mip pyramid per vehicle
  class. Wake ships 31: `Tank0Level0Map.raw` (38,432 B) → `Level1` (14,880) →
  `Level2` (4,896), plus `Infantry1Level0-2`, `Car4Level0-2`,
  `Boat2Level0-5`, `LandingCraft3Level0-5`, and `<class>.raw` (16,392 B) /
  `<class>Info.raw` header pairs.
- `aiMeshes/` — 6 entries in 2 level archives, plus the global
  `Archives/aiMeshes.rfa` (181,367 B).

**Current state.** No reference to `strategicarea`, `pathfinding`, `aimesh` or
`aipathfinding` anywhere in `tools/bf1942-models/`. No feature doc mentions
them.

**Size. L** for the `.raw` navmesh pyramid (undocumented binary format, would
need a reverse-engineering pass against the decompiled corpus). **M** for the
`.con` half — `AI/StrategicAreas.con` alone is a ready-made named-region overlay
with positions, radii, sides and an adjacency graph, and it parses with the
existing `_commands` helper.

**Impact. Medium (strategic areas), low-but-interesting (navmesh).** The
strategic-area graph is the only machine-readable description of a level's
*tactical* structure — it is what would let the fullscreen map label "East
Airfield", draw the lane graph between objectives, and colour regions by side.
The pathfinding mips would let the viewer shade drivable/walkable ground.

---

### Gap 9 — `Materialmap.raw` (surface types) — FIXED, shipped as `terrain/materials.png`

**Gap.** Every level ships a per-cell terrain surface-material map; the
extractor read its declared *size* and never opened the file.

**Ground truth.** `Init/Terrain.con`, 23/23 levels:
```con
GeometryTemplate.materialMap bf1942\levels\Wake\Materialmap
GeometryTemplate.materialSize 512
```
`Materialmap.raw` is one byte per cell, dimension = `materialSize`:
65,536 B (256²) on the four 1024 m levels, 262,144 B (512²) on the sixteen
2048 m levels, 1,048,576 B (1024²) on GuadalCanal / Midway / Tobruk.

**Current state — FIXED.** The map is decoded and shipped as
`terrain/materials.png`; the viewer (`viewer/heightfield.js`,
`level-terrain.js`) decodes it per level and samples it nearest, so a ground
impact resolves the authored surface. Verified live on Wake: adjacent impacts
returned "Juicy grass" and "Dry sand" (`parity-gaps.md` gap M-2). Evidence:
extraction-table row Gap 9 in the
[`corpus sweep`](../../bf1942-corpus-sweep-2026-09-18/README.md) (RESOLVED
2026-09-25).

**Size. S.** Reading it was trivial (raw byte grid at a known dimension); the
id-to-meaning mapping comes from `MaterialManager.attGroup/defGroup/damageMod`
in `bf1942/Game/damage_system/*.con`.

**Impact. Realised.** It is the only data that says "this is sand, that is
grass, that is concrete", and ground impacts now name it.

---

### Gap 10 — terrain LOD directives ignored; the viewer always ships the full grid

**Gap.** `GeometryTemplate.lodDistance` and `GeometryTemplate.targetTriCount`,
which define the engine's adaptive terrain tessellation, are not parsed, and
neither the exporter nor the viewer has any terrain LOD.

**Ground truth.** `Init/Terrain.con`: `GeometryTemplate.lodDistance` in **22 of
23 levels** (Wake 500, Bocage 400, i.e. it tracks `Game.setViewDistance`);
`GeometryTemplate.targetTriCount 5000` in **23 of 23**. The heightmap is uniform
across the range: every level is 4.00 m per sample (256² on 1024 m worlds, 512²
on 2048 m, 1024² on 4096 m), so the full grid is 2 × dim² triangles.

| level | heightmap | exported terrain triangles |
|---|---|---|
| Wake | 512² @ 4 m | 524,288 (16 shipped + 48 default patches) |
| GuadalCanal / Midway / Tobruk | 1024² @ 4 m | full grid, no decimation |

**Current state.** `bf42/level.py:507 parse_terrain_con` has branches for
`worldsize`, `yscale`, `materialsize`, `waterlevel`, `seafloorlevel`,
`texbasename`, `texoffsetx/y`, `detailtexname` — and nothing for `loddistance`,
`targettricount` or `waveheight`. `viewer/map.html:1813-1814` culls *objects* by
`drawDistance` but the terrain root is a single non-culled mesh set.

**Size. M.** Emitting the two numbers is S; actually decimating distant patches
(or emitting a second half-resolution ring) is M.

**Impact. Low visually, medium on payload.** The viewer is *more* detailed than
the engine here, which is the right direction — but it means a 4096 m level
carries 2 M terrain triangles with no falloff, and map-parity.md already records
Wake going 131 k → 524 k triangles / 28.8 → 38.1 MB from the default-patch fill
alone.

#### Investigation 2026-09-25

**Census (vanilla, 23/23 levels, `Init/Terrain.con` under `GeometryTemplate.*`).**
Fetched vanilla + XPack1/XPack2 archives per `bf1942-game-archives` skill and
parsed every level's `Terrain.con` directly (script:
`scratchpad/census_terrain.py`, not committed).

| directive | levels | values | parsed today? |
|---|---|---|---|
| `create` (terrain type) | 23/23 | **`PatchTerrain`** in every single level (case varies) — `RoamTerrain` never appears in a shipped `.con` | not read (type assumed) |
| `file`, `worldSize`, `yScale`, `materialSize`, `materialMap`, `waterLevel`, `seaFloorLevel`, `texBaseName`, `texOffsetX/Y`, `detailTexName` | 23/23 each | as before | PARSED (materialSize/materialMap parsed-but-unused, Gap 9) |
| `targetTriCount` | **23/23** | `4000` (Aberdeen, GuadalCanal, Kursk, Midway — the four 1024 m/4096 m levels) or `5000` (the nineteen 2048 m levels) | IGNORED |
| `lodDistance` | **22/23** (missing only on **Coral_Sea**, not Bocage as the original ground-truth note said — corrected) | 350–600, tracking `Game.setViewDistance` closely but not exactly | IGNORED |
| `waveHeight` / `waveScale` | 5/23 (always `0`/`0.0`) / 1/23 (`0.01`, GuadalCanal) | already tracked as **Gap 17** (water), not this gap — noted here only to avoid double-counting | IGNORED, but out of scope for Gap 10 |

No other terrain-related `.con` file exists per level (no separate LOD/tessellation
file); `Init/Terrain.con` is the only source.

**Engine check.** `features/bf1942-engine-reference/` has no subsystem doc for
terrain rendering (the dedicated server, `lnxded`, does not render terrain at
all — no client-rendering code is linked into it — so it cannot answer this).
Checked the client instead (`BF1942.exe`, pre-analyzed Ghidra project,
`bf1942-ghidra` skill):

- `GeometryTemplate.targetTriCount` — string exists once in the binary
  (`0091889c`), with **two** call sites (`0x65191f`, `0x655cbf`), one next to
  the `GeometryTemplate.create PatchTerrain` string's own reference
  (`0x651794`) and one next to `GeometryTemplate.create RoamTerrain`'s
  (`0x655c63`). **Verified: the token is read by the client**, and the
  PatchTerrain-side reference means it is consulted even though every vanilla
  level uses PatchTerrain, not RoamTerrain. What exactly it drives inside
  PatchTerrain's simplification (a global triangle budget vs. a per-patch
  threshold) is **UNVERIFIED** — would need deeper RE of `0x651700`-ish to
  pin down, out of the 45-minute budget for this pass.
- `GeometryTemplate.lodDistance` — **no such string exists anywhere in
  `BF1942.exe`** (`strings -a BF1942.exe | grep -i loddistance` finds only
  `ObjectTemplate.lodDistance`, `setLodDistance`, `addLodDistance`,
  `getLodDistance`, `alphaLodDistance`, `triangleSortLodDistance` — all
  `ObjectTemplate`/`LodSelectorTemplate` object-mesh LOD, a different
  subsystem entirely (see Gap 11), not terrain). Refractor's `.con` parser
  matches directives by literal string, so a token with no registered string
  has no consumer. **Verified (by absence): `GeometryTemplate.lodDistance` is
  dead data in every level's `Terrain.con` — the retail client never reads
  it.** It most likely comes from the level-editor/authoring pipeline (its
  near-tracking of `Game.setViewDistance` suggests a designer aid), not a
  runtime knob.

**Viewer impact.** `viewer/heightfield.js` (`buildHeightfield`) and
`viewer/level-terrain.js` confirm the doc's original read: no `lod`/`patch`/
`distance` logic anywhere in the terrain path — one uniform-resolution mesh at
a fixed 4 m/sample spacing for the whole level, no falloff. So: **`lodDistance`
ignoring has zero visual or engine-parity impact** (it never affected the
original client either). **`targetTriCount` ignoring is real but payload-only**
in the direction of *more* detail, not less — consistent with the existing
doc's read.

**Recommendation.**
- **`lodDistance`: close as won't-fix.** Confirmed dead in the retail engine;
  there is nothing to reproduce. Not a parity gap.
- **`targetTriCount`: fix, Size S, `environment` bake layer.** Record the raw
  value into `scene.json` (`Init/Terrain.con` is already an `environment`-layer
  input) as informational metadata — cheap, no glb change, and documents that
  the viewer is intentionally more detailed than the engine's budget. **Do not**
  build actual terrain decimation/LOD on top of it now: that is a real geometry
  change (`scene` layer, full re-bake, size M-L per the exact approach), the
  visual direction is already correct (more detail, not less), and the payload
  cost is better addressed alongside Gap 11's broader per-object LOD work if it
  is ever prioritized, rather than as a terrain-only special case.
- Net effect on Gap 10: split into two — one won't-fix, one small metadata fix
  that does not touch geometry. Overall gap stays open (nothing shipped yet)
  but the scope shrinks from "M, terrain LOD system" to "S, one metadata field."

---

### Gap 11 — no per-object draw distance or LOD; one global cull radius for everything

**Gap.** The engine gives every object template a cull radius scale and every
geometry a 6-step LOD chain; the extractor keeps neither and the viewer uses a
single `drawDistance` sphere test against LOD 0 meshes.

**Ground truth.**
- `CullRadius.con`, **16 of 23 levels**, 718 `objectTemplate.cullRadiusScale`
  lines paired with 672 `Objecttemplate.active <Name>` selectors. Example:
  `Objecttemplate.active AxisAirplaneAmmo` / `objectTemplate.cullRadiusScale 5`.
  Parse rate of this file: **0%**.
- `GeometryTemplate.setLodDistance` — **6,115 occurrences in
  `Archives/Objects.rfa`** plus 1,342 in level-local `Geometries.con` files.
  Every mesh declares six: `setLodDistance 0 0` … `setLodDistance 5 100`
  (`Objects/Buildings/Common/AlliedAirplaneAmmo/Geometries.con`).
- `GeometryTemplate.setLodPercent` (219 in `Objects.rfa`),
  `GeometryTemplate.cullFactor` (165), `alphaLodDistance` (28),
  `textureFadeMaxDist` (65), `ObjectTemplate.lodDistance` (320).

**Current state.** `bf42/con.py:479 add_con` handles `geometrytemplate.create`,
`.file`, `.setskin` and nothing else; `cullradiusscale` appears nowhere.
`bf42/assemble.py:583` `selected_lod = min(self.lod, len(mesh.lods) - 1)` with
`lod=0` hardcoded at `extract_map.py:1561` — correct for a viewer, but it means
the other 5 LODs in every `.sm` are read and discarded, and the report already
records them (`report.mesh_lods = {"selected": 0, "available": 6}`).
`viewer/map.html:1813-1814`
`for (const obj of cull) obj.visible = entire || inRange(obj, cam, limit)` with
`limit = extras.drawDistance`.

**Size. M.** Emitting `cullRadiusScale` per template and the LOD distance list
per geometry is S. Actually exporting LOD1-2 as glTF `MSFT_lod`/extra nodes and
swapping in the viewer is M and would materially cut GPU cost on Truk (2,699
objects) and Kursk (1,440).

**Impact. Low visually, medium on performance.** The current behaviour — full
detail out to `drawDistance`, then pop to nothing — is *more* faithful than
LOD popping, so this is a perf/scale gap rather than a fidelity gap. Worth
raising if the viewer ever needs the 4096 m maps at 60 fps on a laptop.

#### Investigation 2026-09-25

Re-baked Berlin (already on disk), Kursk and Truk with a scratch instrumentation
patch on a copy of the pipeline (no repo files touched) that records, per
unique `.sm` referenced by a level's placed statics, `mesh.lods` (`stdmesh.py`
`StandardMesh.lods`) triangle counts at every level, not just the selected one.

**1a. StandardMesh internal LOD chains — real and near-universal.**

| level | placed statics | unique meshes referenced | meshes with 6 internal LODs | meshes with 1 (no chain) | Σ triangles at LOD0 | Σ triangles at lowest LOD | ratio |
|---|---|---|---|---|---|---|---|
| Berlin | 325 | 133 | 128 (96%) | 5 | 43,799 | 4,297 | 10.2x |
| Kursk | 1,455 | 200 | 196 (98%) | 4 | 43,505 | 4,220 | 10.3x |
| Truk | 2,723 | 222 | 214 (96%) | 8 | 75,023 | 6,521 | 11.5x |

Every `.sm` that ships a chain ships exactly 6 (`lods` length 6, matching the
6 `setLodDistance` lines DICE authored per geometry) — there is no level with a
partial chain. The handful with 1 LOD are simple flat props (signs, small
decals). Per-mesh LOD0-to-lowest triangle ratio is wide: heaviest vehicles seen
in Kursk's placed set — `RiBro_Body_m1` 2,209 -> 161 (13.7x), `Ju87_Fuselage_M1`
1,503 -> 123 (12.2x), `hanomag_Hull_M1` 1,673 -> 140 (12.0x) — average ratio
across meshes with a chain is **22.7x** (Kursk sample). Shipping all 6 LODs
instead of LOD0 alone roughly **triples to quadruples** the unique-geometry
buffer size (Berlin 3.68x, Kursk 3.60x, Truk 3.70x, LOD0-sum to all-6-sum) —
but that multiplier applies only to the *unique mesh pool* (tens of thousands
of triangles), since glTF nodes reference shared mesh data; it does not
multiply by placement count. Currently baked scene triangle totals at the
hardcoded LOD0 (`extract_map.py` `--lod 0`): Berlin 206,502 / 325 objects,
Kursk 4,260,596 / 1,455 objects, Truk 4,677,050 / 2,723 objects.

**1b. Con-level `LodSelector`/`DistanceSelector` — a different mechanism than 1a.**
Census of `Objects.rfa`'s 1,751 `.con` files: 151 `LodSelectorTemplate.create`
blocks — `distanceSelector` 49, `distCompareSelector2` 49, `distCompareSelector`
40 (138 distance-driven), `compareSelector` 13 (driven by an engine scalar
input like a propeller's RPM, not distance — see `bf42/con.py` `LodSelector`).
132 `addLodDistance` directives across those, range **0.5 m - 700 m**, median
**70 m**. Per `bf42/assemble.py`'s own analysis (`_lod_swap`, `select_lod_alternative`),
this is **not** a whole-object draw-distance LOD chain for placed statics — it
is the mechanism vehicles use to swap a `LodObject`'s alternatives: cockpit
exterior-vs-interior mesh, a wreck alternative (`hasDestroyedLod`), or (for
`compareSelector`) a spinning-propeller-vs-blur-disc swap keyed to an engine
scalar rather than distance. It reaches `assemble.py` already (picks which
alternative to bake) but only one alternative is ever baked — no distance
threshold reaches glTF or `scene.json` either way, so it shares Gap 11's
"nothing reaches the viewer" problem but is a distinct system from the `.sm`
LOD chain in 1a.

**1c. Per-object draw/cull distance directive — confirmed as a single
per-level constant, not a graded value.** `objectTemplate.cullRadiusScale` in
each level's `CullRadius.con` is not a per-object distance — every line in a
given level's file carries the *same* scalar: Berlin's 45 lines are all `1.0`,
Kursk's 28 and El Alamein's 45 are all `5.0`. So `cullRadiusScale` is a flat
per-level multiplier applied to whichever templates the file lists as
`Objecttemplate.active`, not a per-object graded cull distance — confirming
the gap's "one global cull radius" framing more precisely than the original
writeup: it is one global cull radius *per level*, occasionally two (Berlin
scales interiors differently — unconfirmed which subset gets `1.0` without
reading every `active` selector). No other per-object draw-distance directive
was found in the census (`objectTemplate.lodDistance`, 320 occurrences per the
original table, was checked and is a `GeometryTemplate`-side alias feeding the
same `.sm` LOD chain as 1a, not a separate knob).

**2. Engine usage — UNVERIFIED.** `features/bf1942-engine-reference/ledger.md`
and `symbols.json` (searched for `cull`, `lod`, `distanceselector`,
`comparesele`) have no entry for `objectTemplate.cullRadiusScale`,
`LodSelectorTemplate`/`addLodDistance`, or `GeometryTemplate.setLodDistance` —
none of these three mechanisms has been reverse-engineered. A Ghidra pass
(`StandardMesh_drawLod` at `0x005aeec0`, already labeled per ledger SM-5/LM-3,
is the nearest confirmed neighbor — it walks a mesh's materials per LOD but
the LOD-selection call above it was out of scope here) was not attempted
given the timebox; **whether the engine ever actually switches `.sm` LOD by
distance at all, and how `cullRadiusScale` combines with an object's bounding
radius, remain UNVERIFIED.**

**3. Current viewer cost.** The task brief's premise that `viewer/level-load.js`
and `viewer/level-statics.js` use `THREE.LOD` does not hold today: neither
file, nor any file under `tools/bf1942-models/viewer/`, references
`THREE.LOD` anywhere (grepped the whole tree). There is also no per-object
distance cull any more: the `map.html` `inRange` test the original writeup cites
is gone. The only distance limit is the camera far plane, which
`viewer/level-sky.js` `applyFar()` sets to the level's view distance (extended to
`fogEnd` when that is further). Cost: every object inside the frustum is drawn
at its full LOD0 triangle count out to the far plane, with no degradation and
no draw-call reduction as distance increases. Rough estimate for Kursk/Truk: if a real LOD chain
were implemented and, at any given camera position, roughly half the visible
objects sit far enough to use the lowest LOD (a plausible split on 1-2 km
levels, not measured), applying the measured ~10-23x per-mesh ratio to that
half implies total rendered object triangles could fall by very roughly
40-60% relative to today's flat 4.26M (Kursk) / 4.68M (Truk) LOD0-everywhere
baseline — an order-of-magnitude planning number, not a profiled result.

**4. Recommendation. Fix, Size M, `scene` bake layer (full re-bake).**
Extraction: stop hardcoding `--lod 0`; emit all `mesh.lods` (up to 6) per
unique geometry as sibling glTF meshes (or an `MSFT_lod`-style extras array)
referenced by each placement node, plus the con `setLodDistance` bands (or a
fixed viewer-chosen banding, since 1b shows the *con* distances that reach
`assemble.py` are the unrelated vehicle-part selector, not per-static
distances) as `extras.lodDistances`. Viewer: add `THREE.LOD` per placement or an instanced/level-of-detail
swap keyed to the same distance bands. This is squarely the `scene` layer per
`features/level-bake-layers/README.md` ("Anything drawn or placed... the
exporter" -> full bake) — it touches `bf42/assemble.py`'s node graph, not a
con-derived metadata field. Risks: glb geometry size grows ~3.6-3.7x for the
*unique mesh* portion of the buffer only (confirmed above, not per-instance,
so likely single-digit-MB to low tens-of-MB per level, not a multiple of the
full 30-35 MB scene.glb); actual draw-call count could rise if LOD swapping
is implemented as separate nodes rather than instanced meshes. Given the
production node's tight CPU/memory budget (`CLAUDE.md` deployment
constraints), this is asset-build-time and viewer-side work only — it does
not touch the API or any production container, so the budget arithmetic there
does not apply.

---

### Gap 12 — the default-patch terrain fill only works on the 3 levels that ship `terrainDefault.dds`

**Gap.** `map-parity.md` added a fill for patches with no shipped `Tx` tile,
using the level's `Textures/terrainDefault.dds`. Only 3 of 23 levels ship that
file, so on 10 levels the unpainted patches remain holes — and on 3 of those
they are dry land, not sea.

**Ground truth.** `Textures/terrainDefault.dds` exists in **3 archives**
(Invasion_of_the_Philippines, Omaha_Beach, Wake — `families.txt`:
`3 textures/terraindefault.dds`). Patch grid is `worldSize / 256`.
"Above water" = the patch's maximum heightmap sample exceeds
`GeometryTemplate.waterLevel + 0.5 m`, computed with the project's own
`decode_heightmap`:

| level | grid | Tx tiles shipped | default fill | unpainted | **of which dry land** |
|---|---|---|---|---|---|
| Battle_of_the_Bulge | 8×8 | 34 | 0 | 30 | **30** |
| Liberation_of_Caen | 8×8 | 36 | 0 | 28 | **28** |
| Tobruk | 16×16 | 48 | 0 | 208 | **26** |
| Battle_of_Britain | 8×8 | 52 | 0 | 12 | 0 |
| Berlin | 8×8 | 4 | 0 | 60 | 0 |
| Coral_sea | 8×8 | 16 | 0 | 48 | 0 |
| Iwo_Jima | 8×8 | 16 | 0 | 48 | 0 |
| Truk | 8×8 | 8 | 0 | 56 | 0 |
| GuadalCanal | 16×16 | 64 | 0 | 192 | 0 |
| Midway | 16×16 | 16 | 0 | 240 | 0 |
| Invasion_of_the_Philippines | 8×8 | 33 | 31 | 0 | 0 |
| Omaha_Beach / Wake | 8×8 | 16 | 48 | 0 | 0 |
| other 11 levels | — | full | 0 | 0 | 0 |

**84 patches (5.5 km²) of dry terrain across 3 levels render as void.** The
other 838 unpainted patches sit below the water plane, which is why the
Pacific maps and Berlin look fine — DICE hid their out-of-bounds under water.

**Current state.** `extract_map.py:1264-1273` (`default_image =
_load_level_dds(files, "terrainDefault")`; the `default_patches` loop is inside
`if default_image`). `scene.terrain.defaultTiles` is 31/48/48 on the three
levels that ship the art and 0 everywhere else.

**Size. S.** Fall back to the level's own `Textures/Detail.dds` (23/23 ship it),
or to the average colour of the nearest shipped `Tx` tile, when
`terrainDefault.dds` is absent.

**Impact. Medium on 3 levels, none elsewhere.** map-parity.md already documents
the mechanism and reasons from Tobruk that "the engine falls back to nothing
visible beyond the out-of-bounds line" — **that reasoning is UNVERIFIED and does
not transfer to Battle of the Bulge and Liberation of Caen**, which are inland
European maps with no sea at all, where 30 and 28 patches of forested ground
simply end. Worth settling against the engine before or instead of building the
fallback.

#### Investigation 2026-09-25

**Re-verified against real archives (not just the doc's prior numbers):**
`bf42/rfa.py` against every level `.rfa` in the restored vanilla install
confirms `Textures/terrainDefault.dds` exists in exactly the same **3**
archives claimed above — `Invasion_of_the_Philippines`, `Omaha_Beach`, `Wake`
— nothing else ships it. `extract_map.py`'s gate is now at lines ~2144-2165
(moved from the 1264-1273 cited above; logic unchanged: the whole
`default_patches` fill loop is skipped when `_load_level_dds(...,
"terrainDefault")` raises, no fallback branch exists anywhere in the file).

**What a "default patch" is.** Confirmed from `bf42/terrain.py`: the world is
tiled into `worldSize / 256m` patches; `default_patches()` returns every
`(col, row)` in that full grid that has no shipped `TxCCxRR.dds` file. It is
purely about *texture* coverage — the heightmap itself (`Heightmap`,
`heightmap.height_at`) is one continuous grid the whole 256m-patch mesh
function (`_grid_mesh`) samples from regardless of whether a Tx tile or a
default-fill exists for that patch. There is no code path, ours or evidence of
the engine's, where terrain *geometry* stops at the tile boundary — only the
material/texture assignment is data-driven per patch.

**Where the 84 dry patches actually sit — verified against real `.con`
files, not inferred.** Read `Init.con` / `Init/Terrain.con` for the three
affected levels directly out of the restored archives:

| level | `worldSize` | `game.setActiveCombatArea` (origin, size) | combat-area box (x, z) |
|---|---|---|---|
| Battle_of_the_Bulge | 2048 (8x8 patches) | `0 0 1280 1280` | x 0-1280, z 0-1280 |
| Liberation_of_Caen | 2048 (8x8 patches) | `360 460 1229 1229` | x 360-1589, z 460-1689 |
| Tobruk | 4096 (16x16 patches) | `1024 0 2048 2048` | x 1024-3072, z 0-2048 |

Every one of the "dry" unpainted patches falls **outside** the level's own
`setActiveCombatArea` box — for Battle_of_the_Bulge and Tobruk that is a
border strip against the world edge; for Liberation_of_Caen the combat area
sits inset from all four world edges (360m/459m and 460m/359m margins), so
the unpainted ring surrounds it on every side rather than only touching one
edge. This is the same "outside the box" condition the engine reference
ledger documents independently at `CA-1`/`CA-5`
(`features/bf1942-engine-reference/ledger.md:911-915`): leaving that box
already changes engine behaviour (bleed-out damage via
`GameServer::materialToGiveDamage`), so DICE had no reason to spend Tx tile
budget dressing ground players are actively punished for standing on.
**Visibility from normal viewpoints is plausible but UNVERIFIED** — these are
open inland/desert margins on rolling terrain, so they are very likely visible
at a distance from inside the combat area on all three levels, but no
line-of-sight/prop-occlusion check was done in this pass.

**How the engine textures a patch with no `terrainDefault.dds` — partially
verified via Ghidra, partially UNVERIFIED.** The client exe (`BF1942.exe`)
ships a **generic, level-independent** fallback texture at
`texture/defaultTexture.dds` inside the shared `texture.rfa` (not a per-level
file) — confirmed present: 128x128, flat mid-grey, average RGB
`(76, 72, 74)`. The literal strings `"texture/defaultTexture"` and
`"defaultTexture"` are both referenced from the client binary (xrefs at
`0x00642f09`/`0x0064316d` and `0x00697796`), consistent with a generic
"texture failed to load, substitute this" path in the texture/material
loading system. **UNVERIFIED:** tracing `PatchTerrain`'s own texture-stage
setup to confirm it calls into this same fallback for a patch with no Tx tile
and no level `terrainDefault.dds` was not completed in this pass (the
dedicated-server binary, which is fully symbolized, carries no rendering code
at all — `PatchTerrain` methods there are geometry/collision only — so this
requires client-exe-only tracing, unstarted here). What *is* fairly solid,
from the geometry argument above plus the CA-1/CA-5 evidence that the engine
already treats combat-area-exterior terrain as ordinary, walkable ground: the
real engine almost certainly renders continuous, generically-grey-textured
ground there, not a hole — contradicting map-parity.md's "nothing visible"
framing for Tobruk and confirming this doc's own skepticism about
extrapolating that framing to Battle of the Bulge/Caen.

**How the viewer renders it today — verified from code, not inferred.** When
`default_image` is `None`, the entire `Fill{col}x{row}` node-emission loop in
`extract_map.py` is skipped — **zero mesh geometry** is written for those
patches, not merely a missing-texture material. The exported glb has a literal
hole in the terrain mesh at every one of the 84 dry patches; the viewer shows
whatever scene background/sky is behind it. This is a stronger gap than
"wrong texture" — it is missing polygons — and is a self-inflicted exporter
artifact, since the heightmap data needed to build that geometry is already
available (the same data `patch_mesh` uses on the 3 levels that do ship
`terrainDefault.dds`).

**Recommendation.** Fix, Size **S**. Use the shared, engine-shipped
`texture/defaultTexture.dds` (from `texture.rfa`) as the fallback material
whenever a level's own `Textures/terrainDefault.dds` is absent, instead of
the previously-suggested `Detail.dds` or nearest-tile-average guesses — both
of those are inventions with no engine grounding, while `defaultTexture.dds`
is the one fallback texture the engine itself ships and references in its
texture-loading code. This still leaves the PatchTerrain-specific tracing as
UNVERIFIED, so treat the fix as "engine-plausible," not "engine-proven."
Bake layer: **`scene`** — this adds glb-drawn geometry and materials (Fill
mesh nodes), not a con-derived metadata field, so it needs the full re-bake
per `features/level-bake-layers/README.md`, not a `--layer` patch. Blast
radius is exactly the 3 vanilla-tree bakes with 0 `defaultTiles` today
(Battle_of_the_Bulge, Liberation_of_Caen, Tobruk) — no mod trees are
affected (no mod level was surveyed here). Because the affected ground sits
outside every one of these levels' combat areas, the value is real but
modest: it removes a visible void at the map periphery rather than fixing
anything players walk on.

---

### Gap 13 — mod coverage: 262 of 1,399 levels extracted, and all 239 mod scenes are schema-stale

**Gap.** Only one mod has been swept, and it was swept before control points,
spawn points and minimaps shipped, so every mod scene is missing four
`scene.json` keys the viewer now reads.

**Ground truth.** Base level archives per installed mod
(`find Mods -ipath "*/archives/bf1942/levels/*.rfa" | grep -viE "_[0-9]{3}\.rfa$"`):

| mod | levels | | mod | levels |
|---|---|---|---|---|
| FHSW | 267 | | DesertCombat | 35 |
| EoD | 237 | | Pirates | 33 |
| bg42 | 200 | | GCMOD | 30 |
| WarFront | 178 | | **bf1942** | **23** |
| bf1918 | 134 | | interstate | 13 |
| FH | 73 | | XPack2 | 9 |
| FinnWars | 70 | | FHSWEurope | 8 |
| DC_Final | 48 | | XPack1 | 6 |
| bfheroes | 35 | | STFHSWE | 0 |
| | | | **total** | **1,399** |

Extracted: 23 vanilla + 239 EoD = **262 (18.7%)**. `viewer/maps/maps.json` has
**23 rows, all `mod: bf1942`** — the EoD index lives in a separate
`viewer/maps/mods/eod/maps.json`.

Every one of the 239 EoD `scene.json` files lacks `controlPoints`,
`soldierSpawns`, `minimap` and `gameplayMode` (verified by set-differencing keys
against `viewer/maps/wake/scene.json`). Those keys arrived in commit `e781aa0`
"control points, spawn points and the map you read them on"; the EoD tree is
dated 12:25 and the vanilla re-extraction 14:48-14:53 on the same day.

**Current state.** `extract_maps_all.py` already has `--mod` / `-j` / a
resumable `--skip-existing` and a `maps.json` merge, so the machinery exists; it
is a re-run, not new code. `build_mods_manifest.py` builds the mod index.

**Size. S** for re-running EoD (239 levels, ~8 workers). **M** for the rest —
1,137 more levels at roughly 40-60 MB of glb each is a multi-hundred-GB output
and a storage/publishing decision, not an extraction problem.

**Impact. High for EoD** (every mod map currently shows no flags, no spawn
points and no minimap, which is the feature that shipped last), **medium for the
rest** (FHSW and bg42 together are 467 more levels than exist today).

---

### Gap 14 — game rules, tickets, kits and briefing text are never extracted

**Gap.** The per-level rule files parse at 0%.

**Ground truth.** `Conquest.con` (23 levels, 494 occurrences, **0% parsed**) —
`Game.setNumberOfTickets 1 100` (246 lines / 23 levels),
`Game.setTicketLostPerMin 1 7` (248 / 23). `Menu/Init.con` (23 levels, 440
occurrences, **0% parsed**) — `game.setLoadPicture Load/Desert.tga`,
`game.setMultiplayerBriefingObjectives MULTIPLAYER_BRIEFING_ABERDEEN`,
`game.setMultiplayerBriefingMapType MULTIPLAYER_MAP_TYPE_ASSAULT_MAP`,
`game.setAxisObjectives`, the eight debriefing strings, `game.setMapId "BF1942"`.
`Init.con` — `game.setKit 1 0 German_Scout_Desert` (235 lines / 23 levels),
`game.setTeamSkin 1 GermanDesertSoldier` (47 / 23), `game.assaultTeam 2` (10 / 10).
`GameTypes/{Conquest,CoOp,Tdm,Ctf}.con` (68 entries total) carry the `run`
dispatch and per-mode overrides. `Menu/Thumbnail.dds` in 23/23 archives.

**Current state.** None of these files is in `extract_map.load_level`
(`extract_map.py:163-192`). `game.setKit` / `setTeamSkin` are IGNORED in
`parse_init_con`. `kits.md` covers extracting the kit *models*; nothing records
which kits a given level gives each team. `Menu/Thumbnail.dds` is handled by the
separate `bf1942-map-images` skill, not by this pipeline.

**Size. S.** `Conquest.con` and `Init.con` are already read or trivially
readable; `Menu/Init.con` gives string *ids*, so surfacing the actual briefing
text also needs the localisation table from `menu.rfa`.

**Impact. Low-medium.** Pure HUD/metadata enrichment — ticket counts and bleed
rate, assault side, per-level kit loadout and team skins. It is the natural
next layer on top of the shipped map HUD.

**Investigation 2026-09-25.** Tickets, kits and team skins are done and no
longer part of this gap: `bf42/level.py:load_tickets` parses `Conquest.con`
and ships in the `game` scene layer; `extract_loadouts.py` + `bf42/kit.py`
replay `game.setKit`/`game.setTeamSkin` from `Init.con`; `bf42/roster.py` and
`extract_menu_layout.py` use the result for nation flags; the `menu.rfa`
lexicon reader (`extract_spawn_layout.load_chain_lexicon`) now exists and is
used broadly. **What remains is briefing text only.** Re-checked directly
against vanilla + XPack1/XPack2 archives (`bf1942-game-archives` skill):

- *Census.* Every one of the 23 vanilla levels' `Menu/Init.con` carries
  `game.setMultiplayerBriefingObjectives`, `game.setMultiplayerBriefingMapType`
  and `game.setMapId` (23/23 each, 410 briefing-shaped lines total across the
  file). 20 of the 23 additionally carry the single-player-only
  `setAlliedCampaign/Hints/Objectives/Skirmish` + `setAxisCampaign/Hints/
  Objectives/Skirmish` (8 verbs) and the 8 `set{Allied,Axis}Debriefing{Major,
  Minor}{Victory,Defeat}` verbs (22/23 — Aberdeen, the MP-only proving-ground
  map, has no SP campaign so ships none of these, and its
  `BRIEFING_ALLIED_OBJECTIVES_ABERDEEN`-shaped keys are genuinely absent from
  the lexicon, not just unresolved by us). No code anywhere in
  `tools/bf1942-models/` parses any of these verbs; `extract_loading_assets.py`
  only ever matches `setLoadPicture|setBackgroundMusic|setLoadMusicFilename`.
  Only the multiplayer trio (`setMultiplayerBriefingObjectives/MapType`,
  `setMapId`) matters for a server-hosted viewer — the campaign/skirmish/
  debriefing strings are single-player-mode-only text with no multiplayer
  role.
  Values are almost always localisation keys resolved through
  `menu.rfa`/`lexiconAll.dat` (21 of 23 levels), not literal text — but 2 of
  23 (**Kasserine_Pass**, **Truk**) inline the actual English sentence
  straight in the `.con` file instead of a key, so both forms must be
  handled. Resolved end-to-end examples (`load_chain_lexicon` over vanilla's
  1,656-record `lexiconAll.dat`):
  - Aberdeen: `MULTIPLAYER_BRIEFING_ABERDEEN` -> "This is a Conquest: Hybrid
    Head-on map. Your team will win if you cause your opponents' tickets to
    reach zero. ... SPECIAL: Both bases can be captured on this map."
  - Battle of Britain: `MULTIPLAYER_BRIEFING_BRITAIN` -> "The Germans have
    launched a massive bombing campaign against Britain as a prelude to
    Operation Sealion. ... while the British must defend the objectives until
    the German tickets run out."
  - `MULTIPLAYER_MAP_TYPE_ASSAULT_MAP` -> `"ASSAULT MAP"` (the map-type
    badge shown with the objectives text).
  - Truk (literal, no lexicon lookup needed): "While the unsuspecting natives
    are out snorkeling for precious seashells, both the Axis and Allied teams
    have decided to come along and ravage this tiny island. ..."
  Total English text for the multiplayer objectives string across all 23
  levels: ~6.6 KB (287 chars average) — confirms **Size S**.
- *Where it is shown.* UNVERIFIED by fresh disassembly in this pass (timeboxed;
  no Ghidra run). Circumstantial evidence points at a screen distinct from
  both the loading screen and the spawn/kit-select screen: the reverse-engineered
  patch sites `patch__skip_briefing` / `patch__skip_briefing_jmp`
  (`features/bf1942-engine-reference/symbols.json`, sourced from the bf42plus
  community patcher) sit under that ledger's "Spawn Screen Patches" section
  alongside `patch__skip_spawn_screen*`, i.e. a "skip briefing" toggle
  bf42plus ships next to its "skip spawn screen" one. The lexicon itself
  carries the screen's own chrome strings — `BRIEFING_HEADING` -> "BRIEFING",
  `BRIEFING_OBJECTIVES_HEADING` -> "OBJECTIVES", `BRIEFING_HINTS_HEADING` ->
  "HINTS", `BRIEFING_PLAY`/`BRIEFING_ABORT`/`BRIEFING_LOAD` -> "PLAY"/"ABORT"/
  "LOAD", `BRIEFING_CONNECT` -> "CONNECTING TO" — consistent with the
  well-documented vanilla client flow (connect -> a "Mission Briefing" panel
  with the objectives text and Play/Abort buttons -> the `setLoadPicture`
  loading screen -> the spawn/kit-select screen). `features/
  bf1942-engine-reference/` and `in-game-hud.md`/`authentic-spawn-map`
  docs have no existing entry for this screen. UNVERIFIED: exact ordering
  relative to the loading screen, and whether it is skippable/optional
  server-side.
- *Viewer today.* No, there is no briefing-panel surface. The viewer's only
  pre-spawn screen is the authentic loading overlay
  (`viewer/progress.js:createLoadOverlay`, driven by `viewer/level-load.js:show`
  off `entry.loading.{title,background,music,theme}` from `maps.json`); its
  `.ld-box`/`.ld-stage` markup is title + progress bar + "PRESS ESCAPE TO
  CANCEL" only, no text region. `viewer/spawning.js`/`kit-panels.js` are the
  kit-select screen, also with no objectives text.
- *Recommendation.* Extract only the multiplayer trio (skip the SP-only
  campaign/skirmish/debriefing verbs — no multiplayer role, no viewer
  surface for them). Add a `briefing` object (`objectives`, `mapType`,
  `mapId`) read from `Menu/Init.con` + the chain lexicon (reusing
  `load_chain_lexicon`, handling both the key and Kasserine/Truk's literal-text
  form) next to `tickets`/`gameTypes` in the **`game` scene-json layer**
  (`features/level-bake-layers/README.md`) — it already reads `Init.con` for
  the same per-level rules, this is one more small con file plus a lexicon
  merge already implemented elsewhere. **Size S** (~7 KB of new text across
  all 23 levels, patchable via `patch_scene.py --layer game --mod M --all`,
  no glb touched). Viewer surface: a small "MISSION BRIEFING" text panel
  added to the existing authentic loading overlay (`progress.js`'s `.ld-box`,
  shown while the progress bar runs) rather than a whole new pre-loading
  screen — cheapest integration point, and the objectives text is exactly
  the kind of flavor content players read while waiting.

**Built 2026-09-25.** Shipped as recommended. `bf42/level.py` gained
`parse_briefing`/`resolve_briefing`/`load_briefing`: the multiplayer trio
(`setMultiplayerBriefingObjectives/MapType`, `setMapId`) read from
`Menu/Init.con` via `LevelFiles.find` (case-insensitive, so `Init.con` matches),
values quoted or bare, SP-only campaign/skirmish/debriefing verbs untouched.
`scene_layers.py` resolves bare keys through the mod chain's merged
`lexiconAll.dat` (`LevelContext.lexicon`, cached; nearest mod wins) and emits a
top-level `briefing` object — `{objectives, mapType, mapId}` — owned by the
`game` layer, so `patch_scene.py --layer game --mod M --all` rewrites it with no
glb touched. Quoted text stays literal (the per-value signal; Kasserine_Pass and
Truk ship `Game.setLocalized 0` but quoted values, not the flag, decide).
Patched live: 23 vanilla + 6 XPack1 + 9 XPack2 scenes, 38/38 carrying resolved
English objectives. Viewer: the authentic loading overlay (`progress.js`) grew a
`MISSION BRIEFING` panel (heading, map-type badge, objectives text, hidden while
empty via `data-empty`), fed by a `load.briefing(...)` method on the load handle
that `level-load.js` calls with the report's `briefing` when the report lands
and clears at the start of each load. Briefing text is extracted verbatim
English — no player-name-style decoding applies. Tests: `tests/test_level.py`
(`BriefingTests`), `tests/test_scene_layers.py` (game-layer ownership +
merge), `tests/test_load_briefing_js.py` + `load_briefing_harness.mjs` (panel
markup + handle null-safety under a DOM stub).

---

### Gap 15 — the combat-area boundary is never drawn in the 3D scene, and 12 levels declare none

**Gap.** `combatArea` is parsed and emitted but only used to frame the 2D
fullscreen map; there is no out-of-bounds boundary in the flythrough, and over
half the levels do not declare one at all.

**Ground truth.** `game.setActiveCombatArea` appears in `Init.con` in **11 of 23
levels** — Battle_of_Britain `0 0 2048 2048`, Battle_of_the_Bulge `0 0 1280 1280`,
Berlin `1536 1536 512 512`, Invasion_of_the_Philippines `0 0 2048 2048`,
Kasserine_Pass, Liberation_of_Caen `360 460 1229 1229`, Market_Garden
`256 256 1792 1792`, Omaha_Beach `512 512 1024 1024`, Stalingrad `320 52 416 416`,
Tobruk `1024 0 2048 2048`, Truk. Argument order is `(x, z, width, height)` —
confirmed against Berlin, whose 4 shipped `Tx06x06..Tx07x07` tiles cover exactly
world 1536-2048 in both axes. No vanilla level declares a per-team or per-mode
combat area (no `setTeamActiveCombatArea` in the 634-verb census).

**Current state.** `bf42/level.py:910` parses it; `extract_map.py:1455-1459`
emits it; `viewer/map.html` references `extras.combatArea` at lines 2339-2343
and 2455 only — inside the minimap/fullmap art projection. Nothing draws a
boundary in the 3D scene, and the 12 levels with no combat area fall back to the
world extent.

**Size. S.** A translucent wall / ground-plane outline mesh from
`extras.combatArea`, toggled like the other overlays.

**Impact. Low.** A flythrough orientation aid. Worth noting mainly because the
data is already in `scene.json` and unused by 3D.

---

### Gap 16 — destroyable / dynamic statics: thin in vanilla, but nothing is modelled

**Gap.** No notion of an object having a destroyed state, a door, or a ladder.

**Ground truth.** `Archives/Objects.rfa` (2,788 entries, 503 distinct verbs):
`ObjectTemplate.destroyed 1` appears **34 times**, and all of them are already
*terminal* props — `Objects/MOVE_FILES/Gibb_{concret,Mroof,wood}*`,
`Wreck_{B17,Spitfire,Mustang,Corsair,aichi}*`, `scrap_metal1-3_m1`, plus
`Flak_38` and `AA_Allies` toss-parts. `ObjectTemplate.addToCollisionGroup
c_CGLadders` appears **18 times** (`bunker2Ladder`, `Ladder_5m_m1`,
`Ladder_10m`, `ladder_20m_m1`, `Woodladder_4m_m1`, `ClimbingNet_*`,
`ShipLadder01-03`, `Boat_RepairLadder_M1`). `ObjectTemplate.hitpoints` 74,
`maxHitPoints` 68. Level-local: 11 `ObjectTemplate.destroyed` lines in 2 levels
(`objects/pak40`), 4 `addToCollisionGroup c_CGLadders`. No `doorSpeed` /
`setExplosionType` verb exists in vanilla at all.

**Current state.** `bf42/con.py` parses `hitpoints`, `maxhitpoints`,
`criticaldamage`, `hplostwhilecriticaldamage` onto `ObjectTemplate` (used by the
damage inspector) but not `destroyed` or `addtocollisiongroup`; nothing in the
level path uses them.

**Size. S.** Flag `destroyed` / ladder templates in the object report.

**Impact. Low for vanilla, unknown for mods.** BF1942 statics are essentially
indestructible, so this is close to a non-gap on the 23 levels — the "ruined"
variants (`ruin_citymesh*`, `ruin_suburbhouse*`, visible in the ObjectLightmaps
inventory) are separately *placed* statics, not runtime states. Flagged mainly
so the conclusion is on record rather than assumed. **UNVERIFIED for FH/FHSW**,
which do have destructible bridges and buildings.

#### Investigation 2026-09-25

Re-checked against the restored vanilla archives (`Objects.rfa` + all 23
level archives with their official `_000`/`_003` patches layered via the
project's own `find_level_archives`/`load_level_files`) and a Ghidra pass on
`bf1942_lnxded.static` (`tools/bf1942-models/ghidra-cloud/apply_labels.py`).
Destroyed-state **LOD selectors** are no longer part of this gap — they are
now handled by `bf42/con.py`'s `LodSelector.has_destroyed_lod` /
`destroyed_alternative()` and driven in the viewer by
`viewer/vehicle-wrecks.js`. What is still open splits into two independent
halves.

**(a) Ladders.** `addToCollisionGroup c_CGLadders` is on exactly **18**
vanilla templates (confirmed by name, correcting the original list's
`ShipLadder01-03` to **01-04**): 9 free-standing statics —
`bunker2Ladder`, `Ladder_5m_m1`, `Ladder_10m`, `Boat_RepairLadder_M1`,
`ladder_10m_m1`, `ladder_20m_m1`, `ladder_5m_m1`, `repport_ladder04_m1`,
`Woodladder_4m_m1` — and 9 ship-mounted ones — `ClimbingNet_6m`,
`ClimbingNet_6mx11m`, `ClimbingNet_3m`, `ClimbingNet_3mx4m`, `ShipLadder01-04`,
`PT_Ladder` — bundled as child geometry of the Sea/Common ship templates and
the Elco80 PT boat. Three of the free-standing nine are themselves nested
child templates of a bigger bundle rather than top-level level placements:
`bunker2Ladder` under `bunker2_M1` (every Bunker2 pillbox), `Ladder_10m` under
`guardtow_M1` (every guard tower), `Boat_RepairLadder_M1` under
`dockrepair_supply`. Counting both placement styles across the 23 levels'
merged `StaticObjects.con`: **13 direct ladder-template placements in 5 of 23
levels** (Aberdeen 1, Kasserine_Pass 1, Liberation_of_Caen 3, Stalingrad 6,
Truk 2) plus **70 bunker/guard-tower/dock-repair placements — each carrying
exactly one nested ladder — across 12 of 23 levels** (Aberdeen,
Battle_of_Britain, Battle_of_the_Bulge, El_Alamein, Gazala, GuadalCanal,
Invasion_of_the_Philippines, Liberation_of_Caen, Midway, Tobruk, Truk, Wake).
Union: **14 of 23 vanilla levels (61%)** place at least one ladder-bearing
object. They sit on genuinely important routes: every guard tower in the game
(up to 12 in one level, El Alamein) and every Bunker2 pillbox is
ladder-accessed, and every ship/PT-boat carries a boarding ladder or net.

Engine mechanics (Ghidra, `bf1942_lnxded.static`, confirmed — not previously
in `features/bf1942-engine-reference/`): the collision-group test
(`BFSoldier::handleCollision` against face materials 192-195 while in
`c_CGLadders`, ledger FF-2) is one half of a fuller, named subsystem:
`BFSoldier::startClimbing` (`0x08281b20`) joins collision group 4 via
`IResponsePhysics` vt+0x30, snaps the soldier onto the ladder's plane through
`getLadderClosestPosition` (`0x08280b40`, a fixed **-0.48 m** perpendicular
standoff), and plays animation state `Ub_ClimbLadder1`.
`BFSoldier::handleClimbAction` (`0x08281080`) reads the forward/back throttle
axis each tick to drive the animation-state machine and detect ladder-top/
ladder-bottom exit. `BFSoldier::stopClimbing` (`0x08281ca0`) leaves the
collision group, tests the exit height against the ladder top, and restores
default animation state. `BFSoldier::updateClimbing` (`0x08280f10`) is a
literal no-op (`return;`) — **climbing has no coded speed constant; motion is
entirely animation-driven.** `animations.rfa`'s
`animations/AnimationStatesClimb.con` (22 `.baf` clips under
`3P_NoWeapon/`, split Lower/Upper body) confirms this: climbing is a state
machine of discrete one-rung `c_AsmPlayOnce` clips
(`Lb_ClimbLadder1`/`2`/`1B`/`2B`, 4.8 s forward / -5.6 s reversed at
`setSpeed 0.7`) alternating with looping idle holds, gated by `c_PIThrottle`
thresholds, plus dedicated start/end/exit states and a `c_SstClimbLadder`
sound trigger. Exact climb speed in m/s is **UNVERIFIED** (would need
`extract_pose.py` root-motion measurement on the `.baf` clips, out of
timebox).

Current viewer behaviour: `tools/bf1942-models/viewer/` has **zero**
ladder-aware code (case-insensitive grep for "ladder" across the whole tree
matches only unrelated LOD-ladder/dune-climbing comments), and `bf42/con.py`
does not parse `addToCollisionGroup` at all. Since collision groups are
invisible to the exporter, a placed ladder is baked as ordinary static
collision geometry like any fence or wall: **a player walks into it and is
blocked by its physical mesh, exactly as with any other static prop — it
cannot be climbed, but it is also not walked through.**

**(b) Terminal `ObjectTemplate.destroyed 1` props.** Confirmed **34** vanilla
`Objects.rfa` templates (Gibb_concret/Mroof/wood ×9, Wreck_B17/Spitfire/
Mustang/Corsair/aichi ×7, scrap_metal1-3 ×3, e_GibbPlaneSm's Planepart1-4 ×4,
Ilyushin's wing wreck ×1, AA_Allies toss-parts ×4, Flak_38 base + toss-parts
×5 — the Flak_38 file's own comment reads "Tosses from Explosions") plus
**exactly 11 level-local lines in exactly 2 levels** — Battle_of_Britain (7:
`Britain_Factory` ×2, `Ju88A` ×2, `RadarTower` ×3) and Liberation_of_Caen (4:
`Pak40` ×4) — matching the original count precisely. Grepping the same
23 levels' merged `StaticObjects.con` for all 45 template names found **zero
placements**: none of these templates is ever authored as level content: they
are spawned only at runtime as blast-thrown debris when their parent
vehicle/building/gun dies (per the "Tosses from Explosions" comment), never
placed by a level designer. No console-word ledger entry exists for
`ObjectTemplate.destroyed` itself (only for the unrelated runtime
`Armor::isDestroyed()` hitpoint predicate); the C++ spawn path for these toss
pieces was not traced — **UNVERIFIED** what triggers instantiation.
`viewer/effects.js` has a generic particle-based tumbling-debris system
(`rotationalSpeed`-driven mesh particles) for generic explosion chunks, but
grepping it for any of the 45 template names (Gibb/Wreck/scrap_metal/Toss)
finds **no references** — the specific named debris meshes are not drawn,
generically or otherwise.

**Recommendation.**
- **Ladders: Fix, Size M.** Extraction: parse
  `ObjectTemplate.addToCollisionGroup` in `bf42/con.py` (new boolean field
  alongside the existing `hasDestroyedLod`-style flags) and have
  `bf42/assemble.py` write `extras.isLadder` (plus the ladder's local up axis
  and length) onto matching placement nodes — like the existing
  `extras.spawner` field, this is glb-node metadata, so it needs the `scene`
  bake layer (full re-bake) per `features/level-bake-layers/README.md`'s
  "anything the viewer reads off a placed node" rule, not a `--layer`
  metadata-only patch. Viewer: add a climb state to the local player
  (`walking-body.js`/`soldier-resolve.js`/`local-player.js`) that detects
  proximity + a "climb" input against `isLadder` nodes, snaps the player onto
  the ladder axis, and moves them along it at a chosen fixed rate (the engine
  gives no usable coded speed to copy — animation root-motion is the honest
  source but out of scope to extract here); a plain constant rate is a
  reasonable placeholder. Worth doing: 14 of 23 levels, guard towers and
  bunkers specifically.
- **`destroyed 1` props: Won't-fix (for the level exporter).** Zero of the 45
  templates are level content — there is nothing for `extract_map.py` to
  place, so this is not a level-content gap at all; it is a real-time
  damage-effect feature (spawn N toss-part meshes when a matching vehicle/gun/
  building dies) that lives entirely in the viewer's death/explosion path, not
  in any bake layer. If wanted as a Size S viewer-only enhancement: extract
  the 45 meshes once as free-standing glbs (same pattern as `<template>.wreck.glb`)
  and have `effects.js`/`vehicle-wrecks.js` spawn 2-4 of them as tumbling
  debris on a matching parent's death — but the existing generic
  particle-based tumbling-debris system already gives comparable visual
  coverage for the untargeted case, so the marginal value is low.

---

### Gap 17 — water and wave directives beyond the main `water.*` block

**Gap.** Six water/wave directives outside the parsed set are ignored.

**Ground truth.** `Init/Terrain.con`: `Water.baseTex texture/Water` (**16
levels**), `GeometryTemplate.waveHeight 0.0` (5 levels: Coral_sea, El_Alamein,
GuadalCanal, Omaha_Beach, Wake), `GeometryTemplate.waveScale` (El_Alamein),
`water.bumpTex` / `bumpTile` / `specularBumpMapFactor` / `envIntensity`
(GuadalCanal only). `Init.con`: `water.envmapcolor 0.70/0.80/0.70`
(Battle_of_Britain, Invasion_of_the_Philippines, Liberation_of_Caen),
`water.wateShallowAlpha` — a DICE typo in El_Alamein's `Init.con` that means El
Alamein silently loses its shallow-alpha value.

**Current state.** `bf42/level.py:924 _parse_water` covers 22 `water.*` commands
under `ns == "water"` in `Init.con` only; `parse_terrain_con` (`level.py:507`)
never dispatches `water.*` or `geometrytemplate.waveheight`.

**Size. S.** Add the branches; `envmapcolor` tints the existing fresnel
reflection term the water shader already has.

**Impact. Low.** `waveHeight 0.0` everywhere it appears means no geometry change
is owed. `envmapcolor` would visibly green the reflection on three European
maps. The El Alamein typo is a one-line fix with a visible shoreline result.

#### Investigation 2026-09-25

**Re-censused against every restored vanilla + XPack1 + XPack2 `.con`**
(`bf42.rfa.RfaArchive`, case-insensitive regex over every `.con` in every
level archive — 56 vanilla + XPack2 + XPack1 levels scanned, 59 archive
entries carry a `water.*` or `GeometryTemplate.wave*` line, several counted
twice because the same level ships an alt-mode `.rfa` with an `_003` suffix).
The doc's per-level lists above were stale on several counts — corrected
numbers:

| directive | ns.cmd (lowercased) | levels | sample values | parsed today? |
|---|---|---|---|---|
| `Water.baseTex` | `water.basetex` | **32** (not 16) | `texture/Water` (always) | no |
| `water.envmapcolor` | `water.envmapcolor` | **8 distinct levels** (10 archive rows incl. `_003` dupes): Battle_of_Britain, Invasion_of_the_Philippines, Liberation_of_Caen, Anzio, baytown, Peenemunde, Raid_on_Agheila, Telemark | `0.70/0.80/0.70` on 6 of them, `0.5/0.4/0.3` on Raid_on_Agheila (desert, warm), `0.7/0.8/0.7` on Telemark | no |
| `water.wateShallowAlpha` (typo) | `water.wateshallowalpha` | **1** — El_Alamein only | `0.5` | no |
| `GeometryTemplate.waveHeight` | `geometrytemplate.waveheight` | **11** (not 5): Coral_sea, El_Alamein, GuadalCanal, Omaha_Beach, Wake, husky, Santo_Croce, Eagles_Nest, Essen, Gothic_Line, Kbely_Airfield | `0.0` on 9 of them; **nonzero on 2**: Santo_Croce `0.1`, Eagles_Nest `0.1` | no (namespace not dispatched at all — `parse_terrain_con` only handles `geometrytemplate.create`/`.file`) |
| `GeometryTemplate.waveScale` | `geometrytemplate.wavescale` | **1** — El_Alamein only | `0.01` | no |
| `Water.bumpTex`/`bumpTile`/`specularBumpMapFactor`/`envIntensity` | `water.{bumptex,bumptile,specularbumpmapfactor,envintensity}` | **1** — GuadalCanal only | `texture/normalMap`, `0.4`, `0.01`, `0.6` | no |
| `water.addBlendEnable` | `water.addblendenable` | **2** — Eagles_Nest, Essen | `0` (both) | no |

The 22-command list `_parse_water` already handles (`bf42/level.py:1669-1720`,
confirmed unchanged) covers `color`/`deepcolor`/`shallowcolor`/`texlayer1-2`/
`normalmap`/`scroll*`/`tile*`/`specular*` (except `specularbumpmapfactor`)/
`lightdirection`/`watershallowalpha`/`wateralphadepth`/`watercolordepth` — all
correctly spelled and reachable from `ns == "water"`. It is dispatched only
from `Init.con`'s `water.` namespace; nothing in `parse_terrain_con` forwards
`Terrain.con`'s `Water.*`/`GeometryTemplate.wave*` lines to it, which is why
`baseTex` and the GuadalCanal-only fields never had a chance regardless of
spelling.

**Engine verification (Ghidra-free — `strings` on both restored retail
binaries was sufficient and cheaper).** `strings -a` on
`ghidra-cloud/.work/BF1942.exe` finds an intact, contiguous property-name
table for `GeometryTemplate.PatchTerrain` (`worldSize`, `yScale`,
`waterLevel`, **`waveHeight`**, `waterTexName`, `waterTexScale`,
`seaFloorLevel`, ..., `deepColor`, `shallowColor`, `Color`,
`waterAlphaDepth`, **`waterShallowAlpha`** (correct spelling, exact case),
`waterColorDepth`, `scrollLayer1/2`, `scrollNormalmap`, `scrollDirection1/2`,
`scrollDirectionNormalmap`, `lightDirection`, `tileLayer1/2`,
`tileNormalmap`, **`addBlendEnable`**, `specularEnable`, `envMapEnable`,
**`envmapColor`**, `specularStreakFactor`, `texLayer1/2`, `normalmap`,
`renderMethod`). The same table exists verbatim in
`bf1942_lnxded.static` (dedicated server). Every currently-*parsed* command
name in `bf42/level.py` matches an entry in this table one-for-one.

Searched the same two binaries (`strings -a -n 3`, case-insensitive) for
`baseTex`, `wateShallowAlpha`, `waveScale`, `bumpTex`, `bumpTile`,
`specularBumpMapFactor`, `envIntensity` — **none of the seven strings occur in
either binary**, in any case. `setBumpTexture` does exist, but as the C++
method name `dice::ref2::geom::SkidMarkTemplate::setBumpTexture` /
`WheelTrackDB::setBumpTexture` (vehicle skid-mark/wheel-track system) — an
unrelated subsystem, not a `Water`/`PatchTerrain` property. This is strong
(not just absence-of-evidence) verification: the retail 1.6 property table is
a fixed, contiguous block of literal strings the reflection-based `.con`
setter walks linearly, and a property whose name string isn't compiled into
the binary has no way to be matched, case-insensitively or otherwise.

**Per-directive verdict:**

- **`Water.baseTex` — UNVERIFIED-turned-VERIFIED dead.** Not a live texture
  slot in retail 1.6: the string does not exist in either binary, so the
  `.con` setter never finds a match for it (Refractor's `.con` property
  dispatch is a linear name lookup with a documented "no match -> ignored,
  optionally a console warning" behaviour on this engine — level authoring
  cruft/leftover from an earlier build, not a wired feature). The real
  diffuse layers are `texLayer1`/`texLayer2`, already parsed. **Won't-fix.**
- **`water.envmapcolor` — live, verified.** `envmapColor` exists in the
  binary immediately after `envMapEnable` in the same property block, so it
  is a real, registered field of the water material and (by table position
  and name) tints the reflected environment-cube colour before it's
  composited — exactly the role the viewer's `sky.value` term plays in
  `level-sky.js`'s water fragment shader today (currently un-tinted, straight
  `textureLod(tEnv, R, 4.0).rgb`). **Implement.**
- **`water.wateShallowAlpha` typo (El_Alamein) — confirmed silently
  dropped, not applied.** Case-insensitive matching cannot rescue this: the
  typo drops a letter (`wate` vs `water`), so `wateshallowalpha` never equals
  `watershallowalpha` under any case transform, and the literal string
  `wateShallowAlpha` is absent from both binaries. El Alamein's shoreline
  really does render with the water shader's built-in default shallow alpha
  in retail, not the author's intended `0.5`. **Won't-fix as a "typo fix"** —
  honouring the misspelled value for fidelity would make our shoreline
  *more* correct-looking than the shipped game, which is the wrong kind of
  parity. If Gap 17 is closed for `envmapcolor`/`waveHeight`, note in the
  same patch that El Alamein's shallow alpha is intentionally left at the
  parser's default, with a one-line comment citing this finding, so a future
  reader doesn't "fix" the typo.
- **`GeometryTemplate.waveHeight` — live, verified, mostly inert.**
  Registered field, real vertical wave-amplitude driver for `PatchTerrain`.
  9 of 11 levels ship `0.0` (no visible effect regardless of implementation).
  Only **Santo_Croce** (XPack1, Sicily) and **Eagles_Nest** (XPack2) ship a
  nonzero `0.1`. **Implement for those 2 levels only** — low value elsewhere.
- **`GeometryTemplate.waveScale`** — not found in either binary; El_Alamein
  is the only level that ships it, and its paired `waveHeight` there is `0`
  anyway. **Won't-fix (dead + moot).**
- **`Water.bumpTex`/`bumpTile`/`specularBumpMapFactor`/`envIntensity`
  (GuadalCanal only)** — none of the four strings exist in either binary.
  Reads as an abandoned pre-retail water-bump variant left in one map's
  `Terrain.con`. **Won't-fix.**
- **`water.addBlendEnable`** — registered, real field (additive vs alpha
  blend for the water surface), but both levels that set it ship `0`
  (disabled = the engine's own default, and the viewer's water material is
  already non-additive alpha blend). **Won't-fix (no observable delta at
  today's values)** — revisit only if a future level ships `1`.

**Viewer impact if `envmapcolor` and the 2-level `waveHeight` are
implemented.** `envmapcolor` changes the *tint* of the reflection term
(`sky` in `level-sky.js`'s fragment shader) on 8 levels — most visibly on
Raid_on_Agheila (warm `0.5/0.4/0.3` vs. the shared green
`0.70/0.80/0.70` used on 6 of the others) and subtly on the rest (green cast
already close to the shader's untinted cube colour, so low-contrast but
present at grazing angles where the fresnel term dominates). `waveHeight`
would add visible vertical ripple motion to Santo_Croce and Eagles_Nest's
water surface (currently perfectly flat); everywhere else it is a no-op by
the level's own data.

**Recommendation.** Implement two live directives, drop the rest as
won't-fix (three are dead-in-engine strings, one is a typo the engine itself
never honoured, one has no observable value in the data that ships it):
1. `_parse_water`: add `envmapcolor` (parse as `_color3`, store
   `w.envmap_color`), thread it into `scene_layers.py`'s water dict and
   `extract_map.py:write_water_assets` output, and add a `uEnvColor`
   uniform in `level-sky.js` multiplying the `sky` term before the fresnel
   mix. **Size S.** Bake layer: **`environment`** (con-derived value only,
   `patch_scene.py --layer environment --mod <bf1942|xpack1|xpack2> --all`
   rewrites `scene.json`'s `water.envmapColor` field with no glb touched —
   confirmed the water mesh/material lives in the glb but its colour
   uniforms are scene.json-driven per `write_water_assets`'s already-existing
   `color`/`deepColor`/`shallowColor` fields, which this follows exactly).
2. Dispatch `geometrytemplate.waveheight` in `parse_terrain_con` into
   `info.water.wave_height` (or a new `info.terrain.wave_height`), thread
   through `scene_layers.py`/`write_water_assets`, add a `uWaveHeight`
   uniform and a small vertical sine displacement in the water vertex
   shader keyed off `uTime` and world position. **Size S**, same
   `environment` bake layer, and — because it only ever matters for 2 of 23
   vanilla+XPack levels — worth doing in the same patch as `envmapcolor`
   rather than its own pass.
3. Leave `baseTex`, the `wateShallowAlpha` typo, `waveScale`,
   `bumpTex`/`bumpTile`/`specularBumpMapFactor`/`envIntensity`, and
   `addBlendEnable` unimplemented, each with the one-line reason above (dead
   string in both binaries, or — for the typo and `addBlendEnable` — a
   verified no-op at today's shipped values).

---

### Gap 18 — vegetation: no billboard/LOD falloff, and `TreeRenderer.billboardlightscale` ignored

**Gap.** TreeMesh plants are exported as full geometry (trunk + all eight branch
angle sets + leaf sprites) at every distance, with no billboard substitution and
no per-level billboard light scale.

**Ground truth.** `TreeRenderer.billboardlightscale 0.5` in `Init.con` on 4
levels (Aberdeen, Battle_of_Britain, Kharkov, Kursk) — the engine has a distinct
billboard render path for distant trees that this scales. Kursk places 1,458
statics of which 1,331 are scaled foliage; Battle of the Bulge 1,039.

**Current state.** `bf42/treemesh.py:5-19` deliberately keeps *all* angle sets
(documented reasoning: they are complementary card subsets, not LOD
alternatives) and one leaf-sprite block. `bf42/assemble.py:648-653` marks leaf
sprites unlit and branches lit. `viewer/map.html` has no billboard or
camera-facing code for foliage (the only `sprite` hits are muzzle flashes at
lines 807/2070); trees are culled by the same global `drawDistance` as buildings.
No per-instance scale or tint (Gap 1) compounds this.

**Size. M.** A distance-based swap to a camera-facing quad per tree, driven off
the same `drawDistance`.

**Impact. Low visually (the union-of-angle-sets choice is well argued and looks
right), medium on performance** — Kursk's 1,331 trees each carry eight angle
sets of branch cards inside `drawDistance` 400.

---

## 4. Priority

Sorted by impact ÷ size.

| # | gap | size | impact | blocked by |
|---|---|---|---|---|
| 1 | **Gap 1** — `Object.geometry.scale` / `.color` dropped (8,596 + 5,123 lines, 22 levels) | M | **Very high** — every forest is identical clones | regex change in `con.py:38` is load-bearing for all `.con` parsing; needs a test pass over the mod corpus |
| 2 | **Gap 2** — level-local `StandardMesh/` not in the mesh pool (45 meshes, Pegasus Bridge) | S | **High** | — |
| 3 | **Gap 13** — re-extract EoD's 239 maps onto the current schema | S | **High** (flags/spawns/minimap missing on every mod map) | — |
| 4 | **Gap 3** — `renderer.setFogColorVec` (Midway, Truk grey fog) | S | Medium | — |
| 5 | **Gap 7** — `Object.setOSId` (1,525 lines, 21 levels) | S | Medium | — |
| 6 | **Gap 6** — `spawnPointManagerSettings.con` (495 blocks, 23 levels) | S | Medium | — |
| 7 | **Gap 4** — `renderer.fogstart` / `fogend` (8 levels wrong) | S | Medium | UNVERIFIED engine precedence vs `fogLinearStart` on Kharkov — settle against the decompiled corpus first |
| 8 | **Gap 12** — terrain fill fallback (84 dry patches on 3 levels) | S | Medium | UNVERIFIED: does the engine paint out-of-tile ground at all? |
| 9 | **Gap 17** — `Water.baseTex`, `envmapcolor`, El Alamein's `wateShallowAlpha` typo | S | Low-medium | — |
| 10 | **Gap 14** — tickets, kits, team skins, briefing (0% parse on 3 files) | S | Low-medium | briefing text needs `menu.rfa` localisation table |
| 11 | **Gap 15** — draw the combat-area boundary in 3D | S | Low | — |
| 12 | **Gap 8a** — `AI/StrategicAreas.con` → named region overlay (190 areas, 19 levels) | M | Medium | — |
| 13 | **Gap 5** — all five non-Conquest mode layouts (1,420 + 1,736 placements) | L | Medium-high for the HUD | `scene.json` schema change; viewer mode picker |
| 14 | **Gap 11** — per-object cull radius + LOD chain export | M | Medium (perf) | — |
| 15 | **Gap 18** — foliage billboard falloff | M | Medium (perf) | Gap 1 first |
| 16 | **Gap 10** — terrain LOD / decimation | M | Low-medium (payload) | — |
| 17 | **Gap 9** — `Materialmap.raw` | M | Low-medium | UNVERIFIED whether it has any visual role |
| 18 | **Gap 8b** — `PathFinding/*.raw` navmesh pyramid (358 files) | L | Low | undocumented binary format |
| 19 | **Gap 16** — destroyed-state / ladder flags | S | Low in vanilla | UNVERIFIED for FH/FHSW |

---

## 5. Already covered — not reported as gaps

Shipped, and confirmed working in the current output:

- **Fog colour, draw distance, sky mesh, cloud layer** — `flythrough-fidelity-gap.md`,
  `map-parity.md`. `Sky.*`/`Cloud.*` parse at 23/23; `Game.setViewDistance` 23/23.
  (Gaps 3 and 4 are two *specific directive spellings* this work missed, not the
  feature.)
- **Water block** — 22 of ~28 `water.*` commands parsed, depth map, shader,
  env-map fresnel. `map-parity.md`.
- **Terrain tiles, `texOffset`, detail texture, default-patch fill, lightmap
  atlas, palm fronds** — commits `874c55c`, `10970b9`, `08662ca`,
  `map-parity.md`. Object lightmaps bind at **2,069 of the 2,070** shipped
  `ObjectLightmaps/*.tga` (only Liberation of Caen loses one).
- **`textureManager.alternativePath`** — theatre repaints. `map-parity.md`.
- **Control points, flag poles and cloths, capture radius, spawn groups,
  soldier spawns** — `spawn-points.md`, commit `e781aa0`. 115 control points
  and 749 soldier spawns across the 23 vanilla scenes.
- **HUD minimap and fullscreen map, `InGameMap.dds`, world→image projection** —
  `map-hud.md`, `map-hud-plan.md`, `minimap-and-fullmap.md`.
- **Level-local `Objects/` ObjectTemplates** — commit `0380713`; 484 entries
  across 5 levels now resolve. (The *mesh* half of the same problem is Gap 2.)
- **`Type:Name` geometry references** — commit `47774e5`.
- **Level sounds: ambient bed, area line-emitters, vehicle and flag sounds** —
  `map-sounds.md`. The `Sounds/beach*.con` family parses at 100%.
- **`LightmapShadowBits.lsb` and `Terrain.ShadowAmbient`** — recorded as the one
  genuinely format-blocked item in README "Not yet used" and
  `rendering-technology.md:145-149`. Present in 22/23 archives, 167 KB - 1.17 MB.
- **The `LensFlare` / corona sun object** — `map-parity.md` records it as not
  reproduced. Confirmed: 8 `setFlare*` + 8 `setCorona*` verbs, 19-21 levels, all
  ignored.
- **Non-Conquest layouts** — `minimap-and-fullmap.md:448` already flags this as
  an open question; Gap 5 adds the counts it lacks.
- **`Object.geometry.<sub>` grammar exists** — `spawn-points.md:745` notes it in
  passing for FHSW spawn points; Gap 1 adds the vanilla scale of it.

Benign non-reads, confirmed correct and deliberately not listed as gaps:
`Precache.con` (1,033 `Object.delete` cache warmers), `LoadCounter.dat`,
`TexturePrecache.dat`, `WaterShader.rs` (49-byte empty subshader),
`objectTemplate.createNotInGrid`, `Object.setName`, and the 27 skipped
`Allied/AxisAirplaneAmmo` placements (whose `geometry` line is `rem`'d out in
`Objects.rfa` — invisible in the engine too).
