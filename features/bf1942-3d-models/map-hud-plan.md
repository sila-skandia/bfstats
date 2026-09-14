# Map HUD: 3D flags, minimap widget, fullscreen map

Design and staging for three additions to the level flythrough
(`tools/bf1942-models/viewer/map.html`):

1. 3D control-point flags standing in the world
2. a HUD minimap at the top right showing camera position and heading
3. a fullscreen map overlay showing the whole level with flags and spawns

This document covers **our code only** — what the extractor and viewer look like
today, where the features slot in, and the data contract between them. Two
sibling documents in this directory cover the rest and **may not exist yet**:

- `spawn-points.md` — how the game declares and renders control points, flags
  and spawns
- `minimap-and-fullmap.md` — where the minimap art lives and how world
  coordinates project onto it

Everything below was read, not remembered. three.js is **r169**
(`viewer/vendor/three.module.js:6`, `const REVISION = '169'`); every API named
here was checked against that file, not against memory.

---

## 1. The viewer as it stands

`map.html` is one 2264-line ES module with an importmap
(`map.html:154-156`) pointing `three` at the vendored bundle. It imports
`GLTFLoader`, `progress.js`, `mods.js`, `flight.js`, `engine-audio.js` and
`gunfire.js` (`map.html:158-165`). Nothing else is vendored:
`viewer/vendor/` holds only `loaders/GLTFLoader.js`, `controls/OrbitControls.js`,
`utils/BufferGeometryUtils.js` and the two Geist fonts — notably **no
`SkeletonUtils`**, which matters in section 3.

### 1.1 DOM and CSS

| Element | Line | Position | z-index |
|---|---|---|---|
| `#stage` | `map.html:137` (CSS 36-40) | grid row 2, `position: relative` | — |
| `canvas` | appended at `map.html:191` (CSS 41-49) | `inset: 0` | 0 |
| `#gate` ("Click to fly") | `map.html:151` (CSS 98-116) | `inset: 0`, grid-centred | 1 |
| `#hud` (key hints) | `map.html:150` (CSS 90-97) | `left: 50%; bottom: 18px` | 2 |
| `#side` (level panel) | `map.html:138-149` (CSS 54-63) | `top: 16px; left: 16px`, 260px | 3 |
| `.ld-overlay` (load card) | `createLoadOverlay(stage)` `map.html:223` | `inset: 0`, **`place-items: center`** (`progress.js:30-40`) | 6 |

`#hud`, `#gate` and `#side` are declared `position: absolute` together at
`map.html:50-53`, with `pointer-events: none` on all three and `auto` re-enabled
for `#side` (`map.html:55`). The panel look to copy is `#side`:
`background: var(--panel)` (`rgba(19,19,19,.82)`, `map.html:16`),
`1px solid var(--line)`, `backdrop-filter: blur(8px)` (`map.html:59-62`), with
section headings at 11px / `.14em` / uppercase / `--mm-accent-soft`
(`map.html:64-70`). Tokens come from `tokens.css` (`map.html:12-22`); the palette
is Neutral Depth (`tokens.css:26-63`, `features/mesh-viewer-neutral-depth/`).

**The top-right corner of `#stage` is empty.** `#side` is top-left, `#hud` is
bottom-centre, `#gate` is centred. The load overlay does cover the whole stage
while a level streams, but `map.html:223` takes the **default** `placement`, so
it is `place-items: center` and paints a 360px card in the middle; it is
`pointer-events: none` (`progress.js:36`) and `display: none` when hidden
(`progress.js:47`). Nothing has to move. The one thing to write down: if
`map.html` ever adopts `placement: 'corner'` the way `index.html` does
(`progress.js:43-46` puts that variant at `start end` with 16px padding), it
lands exactly on top of the minimap.

`map.html` has **no `@media` rules and no `is-portrait` handling** — unlike
`index.html`, which has both (`index.html:859-868`, `1254-1256`). Any new HUD
element is the first thing on this page that needs a small-viewport rule.

### 1.2 Load path — `show(entry)`

`show(entry)` at `map.html:1995-2098` is the only entry point for a level. In
order:

```
overlay.begin / step report|scene|textures      1996-2004
fetch scene.json           -> extras            2009, 2021
GLTFLoader.loadAsync scene.glb -> gltf          2011-2015
releaseGuns / dispose(currentRoot) / disposeSky / disposeSounds  2024-2029
currentRoot = gltf.scene; hide baked fx payloads; scene.add      2030-2038
bindLightmaps(currentRoot, dir)                 2041
unlightTerrain(currentRoot)                     2042
bindTerrainDetail(currentRoot, dir)             2043
setupSky(currentRoot, dir)                      2044
setupWater(currentRoot, dir)                    2045
setupSounds(extras, dir)                        2046
bindDynamicShading(currentRoot)                 2050
applyLighting(); sun.position                   2051-2059
indexScene(currentRoot)                         2060
collectTerrain(currentRoot)                     2061
aircraft = null; view = null; setPilot          2062-2066
applyFar / loadSky / applyFog / placeCamera     2067-2070
wireframe / applyVisibility                     2071-2072
#stats innerHTML                                2075-2087
```

Three hook points matter:

- **After `bindDynamicShading` (2050)** is where any per-material patching of
  new geometry must go. `bindDynamicShading` *rebuilds* every
  `MeshStandardMaterial` as a `MeshBasicMaterial` (`map.html:695-750`), so an
  `onBeforeCompile` installed before it is discarded. `bindTerrainDetail`
  already demonstrates the wrap pattern for co-existing with an existing
  compile hook (`map.html:506-508`: `const prev = mat.onBeforeCompile`).
- **`indexScene` (2060)** builds the cull list; new top-level scene children
  must exist before it runs.
- **`extras` (2021)** is the whole `scene.json`, module-global at
  `map.html:235`. Every new field is read from there.

`dispose(root)` (`map.html:424-436`) traverses `currentRoot` only. Anything
parented outside it needs its own teardown, which is why `disposeSky`
(`map.html:755-781`) and `disposeSounds` (`map.html:1137-1155`) exist.

### 1.3 Scene indexing and culling

```js
function tagCull(obj)       // map.html:1608-1614  -> userData.cullCenter/.cullRadius
function indexScene(root)   // map.html:1616-1638
function inRange(obj, cam, limit) // map.html:1640-1647
function applyVisibility()  // map.html:1649-1660, called every frame at 2155
```

`indexScene` hides collision meshes (1620), finds the single node with
`userData.kind === 'spawners'` or `name === 'spawners'` (1623-1628), then walks
**`root.children` only** (1629-1637): the spawners node's *children* are tagged
individually, water is skipped, everything else is tagged and pushed onto `cull`.
`applyVisibility` sets `obj.visible` from `inRange(obj, camera.position,
drawDistance())` unless `#entire-map` is ticked, and gates the whole spawners
group on the `#vehicles` checkbox (1655).

Consequence for any new geometry: **emit it as top-level children of the glTF
scene, one node per logical object.** A single `flags` group would get one
bounding sphere spanning the level (`tagCull` uses `Box3.setFromObject`,
1609-1611) and would therefore never cull — harmless for five flags, but it also
means a whole-level radius participating in every frame's distance test for no
benefit.

Culling is by `Object3D.visible`, which is camera-independent. That rules out
rendering a second top-down camera pass over the same scene (section 4).

### 1.4 Lighting and material binding

Four mutually exclusive passes claim the scene's meshes:

| Pass | Line | Claims | Result |
|---|---|---|---|
| `bindLightmaps` | 573-638 | nodes with `userData.lightmap` | `MeshBasicMaterial` + `lightMap` on UV1, engine combine injected at 619-631 |
| `unlightTerrain` | 450-471 | `userData.kind === 'terrain'` | `MeshBasicMaterial`, max anisotropy |
| `bindTerrainDetail` | 481-538 | same | second texture stage, modulate-2x in sRGB |
| `setupSky` / `setupWater` | 792-813 / 870-1046 | `kind: 'sky'` / `kind: 'water'` | unlit / `ShaderMaterial` |
| `bindDynamicShading` | 664-753 | anything still `MeshStandardMaterial`, minus `userData.effect` | `MeshBasicMaterial` with the fixed-function `ambient + globalAmbient + diffuse*N·L` combine, modulate-2x, evaluated in display space |

Lightmap URLs come from `userData.lightmap`, written by
`write_object_lightmaps` (`extract_map.py:129-150`) keyed on mesh stem plus
rounded position. `bindDynamicShading` sets `customProgramCacheKey`
(`map.html:714`) because three caches programs by `onBeforeCompile` source and
level constants are baked as literals — any new shader patch must do the same.

### 1.5 Camera modes

| Mode | Driven by | Camera written at |
|---|---|---|
| free fly | `fly(dt)` `map.html:401-411` + `applyLook()` 392-399 | `camera.position` directly; orientation via `camera.lookAt` |
| pilot / cockpit | `pilot(dt)` 1871-1925 → `view.update(dt)` | `camera.position.copy` / `camera.quaternion.copy` at 1923-1924 |
| pilot / chase | `VehicleCamera` `flight.js:1011-1026` | same |
| pilot / front | same rig, `FRONT` constants | same |
| pilot / fly-by | `flight.js:994-1008` — a **planted** camera in the world tracking the aircraft | same |

`CAMERA_MODES = ['cockpit', 'chase', 'front', 'flyby']` (`flight.js:726`);
`C` cycles them (`map.html:307-310` → `view.cycle()` `flight.js:875-878`).
`showView(mode)` (`map.html:1852-1858`) prints a blurb into `#hud` for 2.2 s and
falls back to `HUD_PILOT`.

**Camera world position and heading are already available with no new
plumbing:**

- position: `camera.position` (`map.html:194-195`), authoritative in all five
  modes
- heading: `camera.getWorldDirection(v)` — `Camera` overrides `Object3D`'s and
  returns the negated forward (`vendor/three.module.js:12502-12504`), i.e. the
  world-space look vector. Works in all five modes because every mode ends by
  writing `camera.quaternion`.
- free fly only: `look.yaw` / `look.pitch` (`map.html:226`) are the same
  information in Euler form.
- the flown aircraft: `aircraft.state.position` / `.velocity` /
  `.quaternion` (`map.html:1685`, `flight.js:192-220`).

The one mode that needs a branch is **fly-by**: the camera is standing on a
hillside, not in the aircraft, so a marker drawn at `camera.position` would jump
away from the player. Section 4 handles this.

### 1.6 Keybindings — the full table

Every key this page binds, with evidence:

| Key | Bound at | Meaning |
|---|---|---|
| `Escape` | `map.html:294-297` | release pointer lock / close the fly gate |
| `W` `A` `S` `D` | `FLY_KEYS` 177-180, used 404-405; `AIR_KEYS` 1686-1689, used 1877-1886 | free-fly translate / throttle + rudder |
| `Q` `E` | `FLY_KEYS` 178, used 406 | free-fly vertical |
| `Shift` (L/R) | `FLY_KEYS` 179, `isSlow()` 271-273 | slow modifier |
| `R` | 300-304 | reset the aircraft (pilot only) |
| `C` | 307-310 | cycle vehicle camera mode (pilot only) |
| `Space` | `AIR_KEYS` 1687, used 1901 | fire (pilot only) |
| arrow keys | `AIR_KEYS` 1688, used 1888-1892 | stick pitch / roll (pilot only) |
| `/` | `mods.js:99-108` (`bindSearchKey`, installed for every page with an `a.shell-search[href]`) | jump to the armoury search |
| mouse wheel | 379-384 | free-fly vertical |

Every other key is free. `keys.add(e.code)` at 299 is unconditional after the
`uiFocused()` guard at 298, so a new binding placed after line 299 inherits the
"don't steal keys from the `<select>`" rule for free.

### 1.7 Frame loop

```js
function frame(dt) {          // map.html:2145-2160
  pilot(dt) | fly(dt)+applyLook()
  guns.advance(dt)
  applyVisibility()
  advanceSim(dt)              // 1086-1093: simTime, water uTime, cloud offset
  updateAudio(dt)
  updateSky()
  renderer.render(scene, camera)
}
renderer.setAnimationLoop(() => frame(Math.min(clock.getDelta(), 0.1)));  // 2161
```

`advanceSim` (1086) is the shared animation clock — any cloth wave uniform
belongs there. A 2D-canvas HUD draw belongs after `renderer.render` at 2159.

`?shots` (2162-2261) installs `window.__renderOnce`, `__scene`, `__camera`,
`__aircraft`, `__view`, `__setView`, `__keys`, `__setFly`, `__getFire`,
`__getAudioState`. This is the page's headless-verification seam; new features
extend it rather than inventing a second one.

---

## 2. The `scene.json` contract

### 2.1 As it exists today

Written by `build_scene` in `extract_map.py:987-1007`, then extended in
`main()` at 1104-1142, and dumped at `extract_map.py:1145`. The same dict is
also embedded as the glTF `extras` (`build_scene` returns
`builder.build(roots, extras=extras)`, 1010). Read into the module-global
`extras` at `map.html:2021`.

Confirmed by reading `viewer/maps/wake/scene.json`, plus `berlin`,
`el_alamein`, `battle_of_britain` and `omaha_beach` — all five have an
identical key set:

| Key | Type | Written | Consumed |
|---|---|---|---|
| `level` | str | 988 | `#stats` 2076 |
| `worldSize` | float | 989 | `applyFar` 1562, water uniform 908, `#stats` 2077 |
| `waterLevel` | float | 990 | `groundHeight` 1775 |
| `fogColor` | `[r,g,b]` | 991 | `applyFog` 1579, `applyLighting` 1546 |
| `fogStart` / `fogEnd` | float | 992-993 | `applyFog` 1583-1584, `applyFar` 1574 |
| `sunDirection` | `[x,y,-z]` | 994 | `show` 2052-2058, `bindDynamicShading` 671 |
| `camera` | `[x,y,-z]` \| null | 995 | `placeCamera` 1937-1939 |
| `combatArea` | `{min,max}` \| null | 996-999 | **nothing** |
| `terrain` | dict | 1000 (built 797-825) | `bindTerrainDetail` 482-485, `#stats` 2078 |
| `objects` | dict (counts only) | 1001 (built 914-962) | `#stats` 2081-2084 |
| `skybox` | `[6 files]` \| null | 1002, 1115 | `loadSky` 1958 |
| `sky` | `{mesh,rotAngle,heightOffset,clouds}` | 1003, 1104-1109 | `updateSky` 1068-1073, `setupClouds` 820 |
| `water` | dict | 1004, 1116 | `setupWater` 871-930 |
| `lighting` | `{ambient,diffuse,globalAmbient,shadowColor}` | 1005 | `bindLightmaps` 580-585, `bindDynamicShading` 666-669, `applyLighting` 1522 |
| `drawDistance` | float | 1006 | `drawDistance()` 1558 |
| `envmap` | `[6 files]` | 1113 | `setupWater` 895-899 |
| `sounds` | `{ambient,areas,vehicles}` | 1137 | `setupSounds` 1157, `findEngineSpec` 1291 |

Coordinates are glTF-space: `_to_gltf_vec` (`extract_map.py:184-186`) negates Z,
matching the mirror the glb writer applies (`bf42/gltf.py:1-14`). Texture and
sound paths are **relative to the level directory**, resolved as
`${MAPS_BASE}/${dir}/${rel}` (`map.html:485`, `589`, `879`, `1128`).

Two facts the design leans on:

- **`combatArea` is already emitted and used by nothing.** Free data for the
  fullscreen map.
- **Control points, soldier spawns and object-spawn positions are nowhere in
  `scene.json`.** `objects.spawners` is a count (`extract_map.py:949`);
  `info.spawn_objects` positions exist in the extractor but are consumed only to
  place vehicle nodes in the glb (`build_scene` 937-955).

### 2.2 What the game actually declares

Read out of `Wake.rfa` to pin the shape (the sibling `spawn-points.md` owns the
full treatment):

```
Conquest/ControlPoints.con          Object.create The_beach
                                    Object.absolutePosition 1144.53/97.6689/715.047
Conquest/ControlPointTemplates.con  ObjectTemplate.create ControlPoint The_Airfield
                                    ObjectTemplate.setControlPointName The_Airfield
                                    ObjectTemplate.radius 50
                                    ObjectTemplate.team 2
                                    ObjectTemplate.spawnGroupId 2
                                    ObjectTemplate.objectSpawnerId 2
                                    ObjectTemplate.geometry flagbase_m1
                                    ObjectTemplate.addTemplate AnimatedFlag
                                    ObjectTemplate.setPosition 0/8.2/0
                                    ObjectTemplate.setTeamGeometry 1 flagJp_m1
                                    ObjectTemplate.setTeamGeometry 2 flagus_m1
Conquest/SoldierSpawns.con          Object.create AxisSpawnPoint_beach1
                                    Object.absolutePosition 1189.44/97.8155/708.1
                                    Object.rotation 0/0/1.52588e-005
Conquest/SoldierSpawnTemplates.con  ObjectTemplate.create SpawnPoint AxisSpawnPoint_beach1
                                    ObjectTemplate.setSpawnId 0
                                    ObjectTemplate.setGroup 1
```

Three gotchas for the parser, all present in Wake:

- the placement is `The_beach`, the template is `The_Beach` — **lookups must be
  case-insensitive**, as `Library.object` already is
  (`bf42/assemble.py:1342`, `key = template.name.lower()`)
- `Object.create ALLIES_north_base ` has a trailing space;
  `parse_static_objects` already takes `args.split()[0]`
  (`bf42/level.py:474-476`), so it is dropped
- the displayed name is `setControlPointName` and differs from the template
  name (`The_Beach` → `Landing_Beach`)

Teams are not on soldier spawns. They come through `setGroup` →
`spawnGroupId` on the control point that owns that group.

Placement files use exactly the `Object.create` / `absolutePosition` /
`rotation` grammar `parse_static_objects` already parses
(`bf42/level.py:468-495`), which is how `Conquest/ObjectSpawns.con` is read
today (`extract_map.py:175-177`).

### 2.3 Proposed additive fields

Rules: **additive only.** No existing key changes meaning or type. Every new
key is optional; a `scene.json` written before this lands has none of them and
must still load — which it will, because the viewer reads them with `?? []` and
`??` guards, the way `setupSounds` already no-ops on a missing `sounds`
(`map.html:1160-1161`).

```jsonc
{
  // …everything above, unchanged…

  // Which sub-directory the gameplay objects came from. Levels ship several
  // (Wake: Conquest + Ctf + SinglePlayer + TDM; Battle_of_Britain adds
  // ObjectiveMode). Conquest first, then whatever exists.
  "gameplayMode": "Conquest",

  "controlPoints": [
    {
      "name": "The_Airfield",            // Object.create name, the join key
      "template": "The_Airfield",        // ObjectTemplate name (may differ in case)
      "displayName": "The_Airfield",     // setControlPointName
      "position": [1383.75, 115.998, -775.193],   // glTF space, Z negated
      "rotation": [0.0, 0.0, 0.0],       // yaw/pitch/roll, Refractor degrees
      "team": 2,                         // ObjectTemplate.team, 0 = neutral
      "radius": 50.0,
      "spawnGroupId": 2,                 // joins soldierSpawns[].group
      "objectSpawnerId": 2,              // joins objectSpawns[].spawnerId
      "flagHeight": 8.2,                 // addTemplate AnimatedFlag setPosition Y
      "teamGeometry": { "1": "flagJp_m1", "2": "flagus_m1" },
      "node": "cp The_Airfield"          // glb node name, null if no flag was baked
    }
  ],

  "soldierSpawns": [
    {
      "name": "AxisSpawnPoint_beach1",
      "position": [1189.44, 97.8155, -708.1],
      "rotation": [0.0, 0.0, 0.0],
      "group": 1,                        // setGroup
      "spawnId": 0,                      // setSpawnId
      "team": 1                          // derived from the owning CP, null if unresolved
    }
  ],

  // Positions for the vehicles already baked under the `spawners` glb node.
  // Markers only — the geometry is not duplicated here.
  "objectSpawns": [
    {
      "name": "AirStrip_spawner",
      "template": "AirfieldSpawner",     // the ObjectSpawner template
      "vehicle": "Corsair",              // what spawn_vehicle() resolved, null if none
      "position": [1402.1, 116.0, -760.4],
      "rotation": [180.0, 0.0, 0.0],
      "team": 2,
      "spawnerId": 2                     // joins controlPoints[].objectSpawnerId
    }
  ],

  // The level's own minimap art plus the projection from world metres onto it.
  // The projection is an explicit affine so whatever `minimap-and-fullmap.md`
  // finds — offset, rotation, per-axis flip — drops in without a schema change.
  //   u = m[0]*x + m[1]*z + m[2]
  //   v = m[3]*x + m[4]*z + m[5]
  // with (x, z) in glTF world metres (Z already negated) and (u, v) in 0..1
  // with (0,0) at the image's top-left, the same convention the glb writer
  // uses for UVs (bf42/gltf.py:13).
  "minimap": {
    "image": "minimap/minimap.png",
    "pixels": [512, 512],
    "source": "Textures/Minimap.dds",    // provenance, for debugging a bad projection
    "worldToImage": [0.00048828125, 0.0, 0.0,
                     0.0, -0.00048828125, 0.0]
  }
}
```

Worked example — Wake, whose five control points are exactly the five
`Object.create` lines in `Conquest/ControlPoints.con` and whose `worldSize`
is 2048 (`viewer/maps/wake/scene.json`):

```jsonc
"gameplayMode": "Conquest",
"controlPoints": [
  { "name": "The_beach",            "template": "The_Beach",
    "displayName": "Landing_Beach", "position": [1144.53, 97.6689, -715.047],
    "rotation": [0,0,0], "team": 2, "radius": 50.0,
    "spawnGroupId": 1, "objectSpawnerId": -1, "flagHeight": 8.2,
    "teamGeometry": {"1":"flagJp_m1","2":"flagus_m1"}, "node": "cp The_beach" },
  { "name": "The_Airfield",         "template": "The_Airfield",
    "displayName": "The_Airfield",  "position": [1383.75, 115.998, -775.193],
    "rotation": [0,0,0], "team": 2, "radius": 50.0,
    "spawnGroupId": 2, "objectSpawnerId": 2, "flagHeight": 8.2,
    "teamGeometry": {"1":"flagJp_m1","2":"flagus_m1"}, "node": "cp The_Airfield" },
  { "name": "ALLIES_southbase",     "position": [995.268, 104.266, -855.697],  "…": "…" },
  { "name": "ALLIES_north_base",    "position": [1282.98, 107.51,  -1208.55],  "…": "…" },
  { "name": "ALLIES_north_village", "position": [1059.16, 109.576, -1222.77],  "…": "…" }
],
"minimap": {
  "image": "minimap/minimap.png", "pixels": [512, 512],
  "source": "Textures/Minimap.dds",
  "worldToImage": [0.00048828125, 0, 0,  0, -0.00048828125, 0]
}
```

(The identity case: `1/2048 = 0.00048828125`, and the `v` row is negative
because glTF world Z is already the negated Refractor Z while the image's V runs
downward. `minimap-and-fullmap.md` settles the real numbers.)

Also add two counters to the existing `objects` dict — `objects.controlPoints`
and `objects.soldierSpawns` — so `#stats` (`map.html:2075-2087`) and the batch
driver's per-level line (`extract_map.py:1176-1180`) can report them. Adding
keys inside `objects` is additive; nothing reads it by exhaustive key list.

Do **not** add anything to `maps.json`. Its rows are written at
`extract_map.py:1154-1162` and merged by name at `extract_maps_all.py:55-67`;
the viewer only uses `name`, `glb` and `report` from them
(`map.html:2009-2012`, `2118-2128`). A field added there would exist only for
re-extracted levels, for no gain.

### 2.4 Where it is produced

| What | File:line today | Change |
|---|---|---|
| Parse placement files | `bf42/level.py:468-495` (`parse_static_objects`) | reuse as-is; the grammar is identical |
| Parse CP templates | — | new `parse_control_point_templates` alongside `parse_spawn_templates` (`bf42/level.py:498-528`) |
| Parse spawn-point templates | — | new `parse_soldier_spawn_templates`, same shape |
| Hold them | `LevelInfo` `bf42/level.py:267-299` | new `control_points`, `control_point_templates`, `soldier_spawns`, `soldier_spawn_templates`, `gameplay_mode` fields |
| Read them | `load_level` `extract_map.py:157-181` | four more `files.find(...)` blocks; `LevelFiles.find` is already case-insensitive (`bf42/level.py:350-352`) |
| Emit them | `build_scene` `extract_map.py:987-1007` | new keys in the `extras` dict |
| Emit the minimap PNG | — | new `write_minimap(...)` beside `write_water_assets` (707) and `write_skybox` (1225), called from `main()` near 1113-1117 |

---

## 3. Where the flags go

### 3.1 What a flag actually is

From `Objects.rfa`, `Objects/Items/Flag/`:

```
Geometries.con   GeometryTemplate.create AnimatedMesh flagus_m1
                 GeometryTemplate.setSkin animations/flag.skn
                 GeometryTemplate.file flagus_m1
                 GeometryTemplate.create StandardMesh flagbase_m1
Objects.con      ObjectTemplate.create AnimatedBundle AnimatedFlag
                 ObjectTemplate.geometry flagso_m1
                 ObjectTemplate.createSkeleton animations/flag.ske
                 ObjectTemplate.setAnimationState FlagBlow
                 ObjectTemplate.loadSoundScript Sounds/flag.ssc
```

So: the **pole/base is an ordinary StandardMesh** the assembler already handles,
and the **cloth is skeletally animated** — a skinned `AnimatedMesh` driven by
`animations/flag.ske` and the `FlagBlow` state, whose clips are
`animations/Flag/FlagBlow.baf`, `FlagBlowIdle.baf`, `FlagIdle1.baf`,
`FlagIdle2.baf` (all in `animations.rfa`). The meshes themselves sit in
`standardMesh.rfa` as `flagus_m1.sm`, `flagjp_m1.sm`, `flagge_m1.sm`,
`flagso_m1.sm`, `flaguk_m1.sm`, plus `flagcan_M1.sm` in `StandardMesh_001.rfa`.
Per-team selection is `setTeamGeometry <team> <mesh>` on the ControlPoint
template.

Two facts about our pipeline decide the trade-off:

- **`assemble.py` emits no skinned primitives.** The only place that builds
  `JOINTS_0`/`WEIGHTS_0` is `extract_pose.py:296-309`, with `add_skin` at 309
  and `add_animation` at 475. `bf42/assemble.py` calls `add_animation` exactly
  once, at 1641, for baked propeller/wheel spin, flushed only from `export()`
  (`assemble.py:1671`) — **not** from `build_node`, which is the entry point
  `extract_map` uses (`extract_map.py:777-781`). The map glb therefore ships
  zero animations today.
- **`map.html` has no `AnimationMixer`.** The only one in the viewer is
  `index.html:2660-2662`. Whatever clips a map glb carried would not play.

The machinery to do it properly does exist: `bf42/gltf.py` has `add_skin` (327),
`add_animation` (368), and `Primitive.joints`/`.weights` (39-40); `Node.skin`
(51); `bf42/skin.py`, `bf42/ske.py` and `bf42/baf.py` are all read already
(`assemble.py:1019-1120`). It is a real but non-trivial port from
`extract_pose.py` into the map path, plus a mixer in the viewer.

### 3.2 The three options

**(i) Bake into `scene.glb` as ordinary static objects.**

One top-level node per control point, built through the existing
`_place_template` / `Assembler.build_node` path (`extract_map.py:772-785`,
`assemble.py:1324`), with the team's flag mesh grafted as a child at
`flagHeight`.

- *Culling*: free and correct — a per-CP root gets its own `tagCull` sphere in
  the `root.children` loop at `map.html:1629-1637`, exactly like every other
  static.
- *Lightmaps*: free — if the level shipped a lightmap keyed on `flagbase_m1` at
  that position, `write_object_lightmaps` (`extract_map.py:129-150`) already
  writes it and `bindLightmaps` (573) already binds it.
- *Shading*: free — the cloth and pole land on `MeshStandardMaterial` and are
  claimed by `bindDynamicShading` (664), so they get the same engine-true
  fixed-function combine as every vehicle beside them.
- *Per-team texturing*: an extractor decision, taken where the data is
  (`setTeamGeometry` + `ObjectTemplate.team`). The viewer never learns that
  teams exist.
- *Cloth*: static in bind pose out of the box. Animated by tagging the cloth
  node `userData.kind === "flagCloth"` and applying a vertex-shader wave in
  the viewer, driven by the `simTime` clock `advanceSim` (1086) already runs —
  the same tag-and-patch pattern `unlightTerrain` (450), `setupSky` (792) and
  `setupWater` (870) all use. No mixer, no skin, no new asset.
- *Size*: five poles and five cloths per map is a few hundred KB against a 37 MB
  Wake `scene.glb`; the meshes are also shared across levels so the cost is
  per-level duplication of tiny geometry.
- *Batch*: nothing new. `extract_maps_all.py` is unchanged.
- *Upgrade path if the cloth must really be skinned*: open. Port
  `extract_pose.py:296-309, 475` into the map path and add one
  `AnimationMixer` in `show()` plus a `mixer.update(dt)` in `frame()`.

**(ii) A separate `flags.glb` the viewer instances per control point.**

- *Its supposed advantage does not exist.* The flag **positions** have to reach
  `scene.json` regardless, so every map has to be re-extracted anyway. Shipping
  the geometry separately buys nothing in re-extraction cost.
- *Culling*: the instanced clones are created in JS and parented wherever the
  code decides; `indexScene` runs before they exist (`show` 2060), so they need
  their own `tagCull` calls and their own entry in `applyVisibility`.
- *Lightmaps*: impossible. The lightmap key is mesh-stem-plus-position
  (`write_object_lightmaps`), which a shared asset cannot carry.
- *Shading*: needs a duplicate of `bindDynamicShading`'s combine, or the flags
  render on a different lighting model from the crates beside them.
- *Cloth*: worst case here. A skinned clone needs `SkeletonUtils.clone`, which
  is **not vendored** (`viewer/vendor/` has only `loaders/GLTFLoader.js`,
  `controls/OrbitControls.js`, `utils/BufferGeometryUtils.js`) — so it is a new
  vendored dependency before any of it works.
- *Size*: the one genuine win. One shared `_shared/flags.glb` across the
  260-level mods tree saves maybe 50 MB against 16 GB already on the volume —
  0.3%.
- *Dispose*: a second teardown path alongside `disposeSky` / `disposeSounds`.

**(iii) Procedural in the viewer from `scene.json` positions.**

- *Cloth*: trivially animated — a `PlaneGeometry` with a wave in the vertex
  shader is twenty lines.
- *Everything else*: worst of the three. No lightmap, no `bindDynamicShading`,
  so the flags are lit on a different model from every neighbouring object — on
  a lightmapped Tobruk wall that difference is the whole visual point of the
  lighting work documented at `map.html:550-572` and `640-663`. Per-team
  texturing means shipping a flag texture from somewhere anyway, which is most
  of the extraction work with none of the fidelity. Culling and dispose need
  hand-written entries. And a box-and-plane pole next to a 740k-triangle
  engine-true level reads as a placeholder.

### 3.3 Recommendation: (i), bake into `scene.glb`

Because the positions force a re-extraction regardless, (ii)'s and (iii)'s only
real advantage — avoiding one — evaporates, and (i) is the only option that
reuses **all** of the existing machinery: `indexScene`/`tagCull`/
`applyVisibility` for culling, `bindLightmaps` for the bake, `bindDynamicShading`
for the fixed-function combine, `dispose` for teardown, `wireframe` for the
debug toggle, and `extract_maps_all.py` unchanged.

On the cloth specifically, and assuming the sibling confirms `FlagBlow` really
does animate: ship the mesh in bind pose and wave it in the viewer's vertex
shader. That reproduces what the animation *looks like* at zero pipeline cost,
and it is the same class of decision already taken for water (`setupWater` 870)
and clouds (`setupClouds` 819) — recreate the motion in a shader rather than
import the engine's driver. If side-by-side capture shows it is not good enough,
the skinned route is a strict extension of (i), not a rewrite: `gltf.add_skin`
(bf42/gltf.py:327) and `add_animation` (368) already exist,
`extract_pose.py:296-309` is the working precedent, and the viewer needs one
`AnimationMixer` on the pattern of `index.html:2660-2662`.

Emit shape:

```
scene root
├─ Tx00x00 …                     kind: terrain
├─ water                         kind: water
├─ sky                           kind: sky
├─ <statics…>
├─ spawners                      kind: spawners
└─ cp The_Airfield               kind: controlPoint, controlPoint: "The_Airfield",
   │                             team: 2, radius: 50            <- top-level, so tagCull
   ├─ flagbase_m1                (from Assembler.build_node, may carry userData.lightmap)
   └─ flag                       kind: flagCloth, team: 2, translation (0, 8.2, 0)
      └─ flagus_m1               bind pose
```

Viewer side, one new function called from `show()` immediately after
`bindDynamicShading(currentRoot)` at `map.html:2050` (it must run after, because
that pass rebuilds materials at 695-750 and would drop an earlier hook):

```js
function setupFlags(root) {
  root.traverse(node => {
    if (node.userData?.kind !== 'flagCloth') return;
    node.traverse(obj => {
      if (!obj.isMesh) return;
      // The cloth leaves its bind-pose bounding sphere once it waves.
      obj.frustumCulled = false;
      for (const mat of [obj.material].flat()) {
        const prev = mat.onBeforeCompile;               // bindTerrainDetail:506
        mat.onBeforeCompile = (shader, renderer) => {
          if (prev) prev(shader, renderer);
          shader.uniforms.uFlagTime = flagUniforms.uTime;
          // …displace position.x/z by sin(uFlagTime + position.y) scaled by
          //   the distance from the hoist edge, so the pole edge stays pinned…
        };
        // three caches programs by onBeforeCompile source; bindDynamicShading
        // already had to do this (map.html:714).
        mat.customProgramCacheKey = () => 'bf-flag-wave';
        mat.needsUpdate = true;
      }
    });
  });
}
```

with `flagUniforms.uTime.value = simTime` set in `advanceSim`
(`map.html:1086-1093`), beside the water and cloud clocks it already drives.

---

## 4. The HUD minimap widget

### 4.1 Technique: DOM + 2D canvas

Rejected alternatives, with the reason from our code rather than in general:

- **A second three.js render pass (scissor/viewport).** `renderer.setScissor`
  exists (`vendor/three.module.js:29188`, and it multiplies by `_pixelRatio`
  itself so it takes CSS pixels), `setScissorTest` at 29210, `setViewport` at
  several sites; the idiom is the documented one. It still fails here for two
  reasons specific to this page. First, culling: `applyVisibility`
  (`map.html:1649-1660`) sets `Object3D.visible`, which is
  camera-independent — a top-down camera would see only the donut of geometry
  within `drawDistance()` of the *player*, and forcing `optEntire` semantics to
  fix it means drawing ~1.26M triangles (524k terrain +740k objects, per
  `viewer/maps/wake/scene.json`) a second time every frame. Second, the sky and
  cloud meshes are camera-locked — `updateSky` (`map.html:1058-1084`) parks them
  at `camera.position` every frame — so a second camera elsewhere renders
  through them.
- **A WebGL quad fed by a render target.** Viable as a *one-off* top-down bake
  at load time, and worth remembering as the fallback if a level has no usable
  minimap art. But it fights the same fog/sky/culling setup, and the result is a
  render, not the game's hand-painted map.
- **DOM + 2D canvas.** ~10 draw calls per frame on a 168px canvas, zero WebGL
  state touched, works identically in every camera mode, and — decisively — it
  is the *same* renderer the fullscreen overlay needs. One
  `drawMapCanvas(ctx, rect, opts)`, two callers.

### 4.2 Placement and style

```html
<canvas id="minimap" aria-hidden="true"></canvas>
```

inside `#stage` (`map.html:137-152`), added to the `#hud, #gate, #side` rule at
`map.html:50-53` so it inherits `position: absolute; pointer-events: none`, then:

```css
#minimap {
  z-index: 3;                        /* same layer as #side; they never overlap */
  top: 16px; right: 16px;            /* mirrors #side's 16px inset, map.html:57 */
  width: 168px; height: 168px;
  background: var(--panel);          /* map.html:16 */
  border: 1px solid var(--line);
  backdrop-filter: blur(8px);        /* matches #side, map.html:62 */
}
@media (max-width: 640px) { #minimap { display: none; } }
```

The backing store is sized at `Math.min(devicePixelRatio, 2)`, matching
`renderer.setPixelRatio` (`map.html:188`), and re-sized from `resize()`
(`map.html:413-420`).

Collision check, from the CSS actually in the file: `#side` is `top/left: 16px`
(57), `#hud` is `left: 50%; bottom: 18px` (92), `#gate` is `inset: 0` with
`place-items: center` (99-102), and the load card is centred because
`map.html:223` takes `createLoadOverlay`'s default placement
(`progress.js:141`). **Nothing is at the top right. No existing element moves.**
Add a comment at the `#minimap` rule recording that `placement: 'corner'` on the
load overlay would collide, since `index.html` uses exactly that.

Visual language, straight from Neutral Depth (`tokens.css:26-63`) and the panel
conventions in `map.html:64-89` — no emoji, no flag glyphs, no new palette:

| Element | Token |
|---|---|
| plate / border | `--panel` / `--mm-rule` |
| title strip ("WAKE · 2048 m") | 10px, `.14em`, uppercase, `--mm-accent-soft` |
| control point, team 2 | `--mm-accent` `#7d8849` — filled 5px square + 1px pole tick |
| control point, team 1 | `--mm-kill-soft` `#8a3838` — same shape |
| control point, neutral | `--mm-ink-muted` `#8a8a8a`, hollow |
| soldier spawn | 2px dot, `--mm-ink-faint` |
| vehicle spawner | 3px open diamond, `--mm-ink-muted`, drawn only when `#vehicles` is ticked (`map.html:249`) |
| combat area | 1px dashed `--mm-rule-strong` |
| player | filled triangle, `--mm-ink`, plus a 40° view cone at 12% alpha |

North-up, never rotated — that is what the game's own minimap does, and it keeps
the art's text readable. Only the player triangle rotates.

### 4.3 Behaviour per camera mode

`camera.position` and `camera.getWorldDirection(v)`
(`vendor/three.module.js:12502-12504`) are correct in every mode because every
mode ends by writing them (`map.html:1923-1924` for all four pilot modes;
`camera.position` directly plus `camera.lookAt` at 392-399 for free fly). So the
default rule is: **no branch — read the camera.**

The single exception is **fly-by**. `VehicleCamera` in that mode parks the
camera on the ground and tracks the aircraft (`flight.js:994-1008`), so a marker
at `camera.position` would leave the player behind. Rule:

| Mode | Player marker | Second marker |
|---|---|---|
| free fly | `camera.position`, `camera.getWorldDirection` | — |
| cockpit / chase / front | `aircraft.state.position` and its heading (`map.html:1685`) | — |
| fly-by | `aircraft.state.position` | hollow triangle at `camera.position`, `--mm-ink-faint` |

The condition is the one the page already uses everywhere for "is someone flying
this": `optPilot.checked && aircraft` (`map.html:1430`, `2146`).

Follow window: the widget shows a square of `2 * drawDistance()` metres
(`map.html:1557-1559`) centred on the player, clamped to the world square, so
the scale changes with the level the same way the fog does (Berlin 100 m,
Battle_of_Britain 550 m). `N` is deliberately left unbound for a later
zoom cycle — see §5.

Draw from `frame()` (`map.html:2145-2160`) after `renderer.render` at 2159. If
`extras.controlPoints` is undefined (an old `scene.json`), the widget draws its
plate, the world square and the player, and logs one `console.info` naming
re-extraction — the same treatment `setupEngineAudio` gives a stale map at
`map.html:1294-1298`, which exists precisely because a missing key and a
legitimately empty one are otherwise indistinguishable
(`features/bf1942-3d-models/map-sounds.md`, "the 'only Wake' symptom").

---

## 5. The fullscreen map overlay

### 5.1 Keybinding: `M`

Free, on the evidence of the full table in §1.6: taken are `Escape`, `W` `A`
`S` `D`, `Q` `E`, `Shift`, `R`, `C`, `Space`, the four arrows, and `/`
(`mods.js:99-108`). `M` is bound by nothing on this page or in any module it
imports (`grep` over `map.html`, `mods.js`, `progress.js`, `flight.js`,
`gunfire.js`, `engine-audio.js`).

It is also the game's own key. From the vanilla install's control maps:

```
Settings/Default/Controls/Common.con:50    c_PIMap      IDFKeyboard IDKey_M  c_CMNonRepetive
Settings/Default/Controls/Common.con:51    c_PIZoomMap  IDFKeyboard IDKey_N  c_CMNonRepetive
```

identically in `Air.con:35-36`, `Infantry.con:36-37`, `Land.con:30-31` and
`Common_Japanese.con:49-50`. This is the same reasoning that put the camera
cycle on `C` (`map.html:307-308`, `c_PIToggleCameraMode IDKey_C`, present in all
five of those files at `Air.con:42`, `Common.con:57`, `Infantry.con:43`,
`Land.con:37`, `Common_Japanese.con:56`).

**Reserve `N`** for a later minimap zoom cycle (`c_PIZoomMap`). Do not bind it
in this work; just do not spend it on something else.

### 5.2 Show / hide

Add to the existing handler at `map.html:293-313`, **after** line 299 so it
inherits the `uiFocused()` guard at 298:

```js
if (e.code === 'KeyM' && !e.repeat && !e.ctrlKey && !e.metaKey) {
  setFullMap(!fullMapOpen);
}
```

and extend the `Escape` branch at 294-297 so Escape closes the map first and
only releases the pointer lock if it was already closed. That keeps Escape's
one meaning — "back out of whatever is in front of me" — and costs two lines.

`setFullMap` toggles `hidden` on the overlay and swaps `#hud`'s text the way
`showView` (`map.html:1852-1858`) and `setPilot` (1838) already do. `HUD_FLY` is
captured from the markup at `map.html:150` into 254, and `HUD_PILOT` is at 1841;
both strings gain `· M map`.

**Do not touch pointer lock and do not pause the simulation.** In the game the
world keeps running behind the map, and here free-flying with the map up is the
most useful thing it can do: WASD moves the camera and the marker moves with it.
The overlay is `pointer-events: none` and has nothing to click, so pointer lock
is not in the way. That means the feature adds exactly **zero** changes to the
input path beyond the two branches above.

### 5.3 Composition

```html
<div id="fullmap" hidden><canvas></canvas></div>
```

```css
#fullmap {
  position: absolute; inset: 0;
  z-index: 5;                                   /* over #side(3), #hud(2), #gate(1);
                                                   under .ld-overlay(6), so a map
                                                   switch still shows its progress */
  display: grid; place-items: center;
  background: rgba(9, 9, 9, .88);
  pointer-events: none;
}
#fullmap[hidden] { display: none; }
```

The canvas is sized to `min(stage - 48px)` on the map's own aspect, and drawn by
the **same** `drawMapCanvas(ctx, rect, opts)` the widget uses, with
`opts.fit = 'world'` instead of a follow window. On top of the widget's layers
it adds:

- the `combatArea` rectangle (`scene.json`, written at `extract_map.py:996-999`,
  consumed by nothing today) as a dashed `--mm-rule-strong` outline
- control-point labels from `displayName`, 10px `--mm-font-mono`, `.1em`,
  uppercase, `--mm-ink-soft`, offset 8px right of the marker with collision
  nudging
- a capture-radius ring per control point at `radius` metres, 12% alpha
- a scale bar in metres and the level name / `worldSize` as a title strip,
  matching the `#stats` panel's information (`map.html:2075-2087`)

Camera-mode behaviour is identical to the widget (§4.3) because it is the same
draw function: the aircraft is the player marker while piloting, the camera gets
a second hollow marker in fly-by. Nothing about the overlay depends on which
mode is active.

If `extras.minimap` is absent (old `scene.json`, or a level whose art the
sibling document finds unusable), the overlay still draws: a plain
`--mm-bg-mute` world square with a 128 m grid, the combat area, and every
marker. That is the Stage 2 shipping state below, and it is genuinely useful on
its own.

---

## 6. Staged implementation

Each stage ships and is verifiable alone. Stages 1 and 5 both change the
extractor's output; **run them as one re-extraction**, not two (§6.7).

### Stage 0 — parsers only, no output change

- `bf42/level.py`: `ControlPointTemplate`, `ControlPointInstance`,
  `SoldierSpawnTemplate` dataclasses beside `SpawnTemplate` (498) and
  `StaticInstance` (43); `parse_control_point_templates` and
  `parse_soldier_spawn_templates` beside `parse_spawn_templates` (498-528);
  new `LevelInfo` fields (267-299).
- `extract_map.py:157-181` (`load_level`): read
  `Conquest/ControlPoints.con`, `Conquest/ControlPointTemplates.con`,
  `Conquest/SoldierSpawns.con`, `Conquest/SoldierSpawnTemplates.con`, falling
  back across game-type directories and recording which won as
  `gameplay_mode`. Placement files go through the existing
  `parse_static_objects` (468).
- `tools/bf1942-models/tests/test_level.py`: stdlib `unittest`, one behaviour
  per method with a sentence-shaped name, per the file's existing style and
  `tests/test_extract_maps_all.py`. Cover at minimum: the `The_beach` /
  `The_Beach` case mismatch, the trailing space in
  `Object.create ALLIES_north_base `, `setControlPointName` differing from the
  template name, `objectSpawnerId -1` meaning "none", and the
  `setGroup` → `spawnGroupId` team derivation.

**Verify:** `python3 -m unittest discover -s tools/bf1942-models/tests -v`.
No shipped artefact changes; nothing can regress.

### Stage 1 — `scene.json` gains the gameplay objects

- `extract_map.py:987-1007` (`build_scene`): `controlPoints`, `soldierSpawns`,
  `objectSpawns`, `gameplayMode`; `objects.controlPoints` and
  `objects.soldierSpawns` counters into the dict built at 914-962; one more line
  on the stderr summary at 1172-1180.
- Viewer untouched.

**Verify:** `python3 extract_map.py Wake` then
`jq '.controlPoints | length'` on the result is `5`, and the five `name`s are
exactly the five `Object.create` lines in `Conquest/ControlPoints.con`; a
diff of the old and new `scene.json` shows only additions.

### Stage 2 — fullscreen map on `M`, markers only

Pure viewer, and it ships value before the art question is settled.

- `map.html`: `#fullmap` markup after 151 and CSS after 116; `drawMapCanvas`;
  the `KeyM` branch after 299; the `Escape` change at 294; the `HUD_FLY` string
  at 150 and `HUD_PILOT` at 1841; the draw call in `frame()` after 2159;
  `window.__fullmap` in the `params.has('shots')` block (2162) reporting open
  state and marker counts.

**Verify:** open Wake, press `M`, compare the five flag positions against the
game's own map — Wake's airfield, beach, south base, north base and north
village are unmistakable. Headless: `?shots` + `window.__renderOnce`, toggle via
`window.__keys` (2196) the way the flight checks already do.

### Stage 3 — minimap art

Depends on `minimap-and-fullmap.md` for the source texture and the projection.

- `extract_map.py`: `write_minimap(files, out_dir, info)` beside
  `write_water_assets` (707) and `write_skybox` (1225), called from `main()`
  near 1113-1117; emits `minimap/minimap.png` and the `minimap` block of §2.3.
- `map.html`: load it with a plain `new Image()`, **not** through `texLoader`
  (`map.html:209`) — it is a 2D-canvas source, and putting it on `texManager`
  would make the progress bar's texture phase (1971-1997) wait on it.
  `drawMapCanvas` gains the base layer under the markers.

**Verify:** flags land on the painted flag icons in the art. If they do not, the
affine in `minimap.worldToImage` is wrong and the overlay shows it immediately —
which is exactly why Stage 2 ships first.

**Asset cost:** one 256-512px PNG per level, roughly 100-200 KB. ~4 MB across
vanilla's 23 levels; ~50 MB across the mods tree, against the 16 GB
`viewer/maps/` already holds (15 GB of it under `maps/mods/`).

### Stage 4 — HUD minimap widget

- `map.html`: `#minimap` canvas, the CSS of §4.2 including the first
  `@media` rule this page has ever had, sizing from `resize()` (413), the
  fly-by marker rule of §4.3, and the draw in `frame()`.
- Reuses `drawMapCanvas` entirely; no new drawing code.

**Verify:** fly a circuit on Wake with `?shots`; the triangle tracks the
camera, the cone points where the view does, and `C` through all four vehicle
modes never moves the player marker off the aircraft.

### Stage 5 — 3D flags in the world

- `extract_map.py:914-962` (`build_scene`): after the static loop, place each
  control point through `_place_template` (772-785) and graft the team's flag
  mesh as a child at `flagHeight`; wrap each in a top-level node named
  `cp <name>` carrying `extras: {kind: "controlPoint", controlPoint, team,
  radius}`, with the cloth child carrying `{kind: "flagCloth", team}`. Write the
  resulting node name back into `controlPoints[].node`.
- `map.html`: `setupFlags(currentRoot)` immediately after
  `bindDynamicShading` at 2050 (§3.3); `flagUniforms.uTime` advanced in
  `advanceSim` (1086).

**Verify:** flags stand at the five Wake positions at the right height
(`flagHeight` 8.2 m above the base), the right team's colours face the right
way, the wireframe toggle (`map.html:1948`) reaches them, they cull with
distance like their neighbours, and the fullscreen map's markers sit under them.

### Stage 6 — real skinned cloth (only if needed)

Gated on the sibling's finding plus a side-by-side capture showing the shader
wave is visibly wrong.

- Port `extract_pose.py:296-309` (skinned primitives), `309` (`add_skin`) and
  `475` (`add_animation`) into the map path in `bf42/assemble.py`;
  `bf42/gltf.py` needs nothing (`add_skin` 327, `add_animation` 368,
  `Primitive.joints/.weights` 39-40, `Node.skin` 51 all exist).
- `map.html`: one `AnimationMixer` created in `show()` on the pattern of
  `index.html:2660-2662`, ticked in `frame()`, released in `dispose()` (424).

### 6.7 Risks

**Batch re-extraction.** Stages 1, 3 and 5 all change extractor output, so ship
them as one run. `extract_maps_all.py` handles the fan-out (`-j 8`, staging
directories, index merge at 55-67), but note that **`--skip-existing`
(147, 188-195) is a resume, not an upgrade filter**: it skips any level that
already has a `scene.glb`, so a schema change needs a full run. Vanilla is 23
levels; `viewer/maps/mods/` is 15 GB across the mod trees and is the expensive
half. Sequence the vanilla run first, verify, then the mods.

**Old `scene.json` must still load.** Every new key is optional and read with
`??`. The failure mode to design against is documented in `map-sounds.md`: for
months every map but Wake looked silent because their `scene.json` predated the
sound feature, and `setupSounds` no-ops silently on a missing key. Do the same
thing `setupEngineAudio` now does (`map.html:1294-1298`) — log one `console.info`
naming re-extraction, so a stale map, an empty map and a bug are three different
observations.

**Asset size.** Geometry growth is negligible (a pole and a cloth per control
point against 37 MB of Wake terrain and objects). The minimap PNGs add ~4 MB to
vanilla and ~50 MB to the mods tree. The real cost is the **upload**: any stage
that touches `scene.json` means re-publishing every level directory through the
`bfstats-mesh-assets` skill, not just the changed files.

**`indexScene`'s single special case.** It recognises exactly one
`spawners` node (`map.html:1623-1628`). Grouping flags under a single `flags`
node would give them one level-spanning cull sphere; per-control-point top-level
roots avoid it with no viewer change.

**Frustum culling of a waving cloth.** A vertex-displaced mesh can leave its
bounding sphere. Set `frustumCulled = false` on the cloth meshes (§3.3) — they
are two metres across and there are five of them.

**Levels with no Conquest directory.** `Battle_of_Britain.rfa` ships
`Conquest/`, `ObjectiveMode/` and `SinglePlayer/`;
`Invasion_of_the_Philippines.rfa` ships only `Conquest/`. Prefer Conquest, fall
back to the first that exists, and record the choice in `gameplayMode` so a
surprising flag layout is explainable rather than mysterious.

**Mobile.** `map.html` has no `@media` rules and no `is-portrait` class today
(verified by grep; contrast `index.html:859-868` and `1254-1256`). A 168px
widget on a 375px stage eats a fifth of it — hide it under 640px, and let the
fullscreen map, which already sizes itself to the stage, be the small-screen
answer.
