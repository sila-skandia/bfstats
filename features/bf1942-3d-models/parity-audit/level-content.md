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

### Gap 9 — `Materialmap.raw` (surface types) is never read

**Gap.** Every level ships a per-cell terrain surface-material map; the
extractor reads its declared *size* and never opens the file.

**Ground truth.** `Init/Terrain.con`, 23/23 levels:
```con
GeometryTemplate.materialMap bf1942\levels\Wake\Materialmap
GeometryTemplate.materialSize 512
```
`Materialmap.raw` is one byte per cell, dimension = `materialSize`:
65,536 B (256²) on the four 1024 m levels, 262,144 B (512²) on the sixteen
2048 m levels, 1,048,576 B (1024²) on GuadalCanal / Midway / Tobruk.

**Current state.** `bf42/level.py:517` sets `TerrainInfo.material_size`;
`grep -rn material_size tools/bf1942-models/` returns the dataclass field
(`level.py:34`) and that assignment and nothing else. The file itself is never
in `LevelFiles.read`.

**Size. M.** Reading it is trivial (raw byte grid at a known dimension); the
work is deciding what to do with it and mapping material ids to meanings —
`MaterialManager.attGroup/defGroup/damageMod` in `bf1942/Game/damage_system/*.con`
is the id table. **UNVERIFIED:** whether the engine uses the material map for
anything *visual* (my reading is that it drives footstep/impact effects,
traction and damage, not shading) — worth settling against the decompiled corpus
before building anything on it.

**Impact. Low-medium and indirect.** It is the only data that says "this is
sand, that is grass, that is concrete" — the prerequisite for correct footstep
audio, tyre dust, impact effects and a material-shaded fullscreen map.

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
