# BF1942 minimap and full map: how the engine builds them

Research notes for reconstructing both map surfaces in the glTF map viewer. Everything
below was checked against files in `~/.wine/drive_c/EA Games/Battlefield 1942`, against
images that were decoded and looked at, or against the decompiled `BF1942.exe`
(sha256 `60c9452d…cd3699`, the binary `features/bf1942-engine-reference/` is pinned to).
Anything inferred is labelled.

**Headline correction to existing guidance.** The `bf1942-map-images` skill says world
position maps to the minimap as `x / worldSize`, `1 - z / worldSize`, "exact on 20 of 21
stock maps, Berlin is the exception". That is wrong in a way that matters. The art frames
the level's **active combat area**, not the world. Most levels declare no combat area (or
one equal to the world), which is why the simple rule appears to hold; but seven stock
levels and many Road to Rome / Secret Weapons levels declare a sub-world combat area, and
on all of them the simple rule silently mis-places every marker. Berlin is not a special
case, it is just the most visible one.

---

## 1. The coordinate system

### The rule

```
combat area (Init.con):  Game.setActiveCombatArea  minX  minZ  sizeX  sizeZ
                         (no such line  ->  minX=minZ=0, sizeX=sizeZ=worldSize)

u = (x - minX) / sizeX
v = 1 - (z - minZ) / sizeZ            # z inverts: image space runs top-down

pixel = (u * imageWidth, v * imageHeight)
```

`v` inverts because world `+z` runs north and image `+y` runs down. `y` (height) is not
used at all — the art is an orthographic top-down render.

The art is always square and always covers exactly that rectangle. There is no scale or
offset parameter anywhere else: `Init/Terrain.con`, `Init.con` and the HUD `.con` files
carry nothing minimap-related beyond the combat area, and the only minimap settings the
engine exposes are `game.setStaticMinimap` and `game.setMinimapTransparency` (grep of
`BF1942.exe` strings for `minimap|mapScale|mapZoom` returns exactly
`setStaticMinimap`, `setMinimapTransparency`, `setMinimapIcon`, `setMinimapIconSize`,
`minimapIcon` and the two `game.set…%d` save-format strings — nothing that frames the art).

Note the combat area is declared as **origin plus size**, not as two corners. Verified
empirically: Berlin's `1536 1536 512 512` yields `x[1536,2048] z[1536,2048]`, which is
exactly where Berlin's terrain tiles, heightmap relief and static objects are.

### Empirical confirmation

**Wake** (`worldSize 2048`, no combat area). Projected all five
`Conquest/ControlPoints.con` `absolutePosition` values onto `Textures/InGameMap.dds` under
`u = x/2048, v = 1 - z/2048`. All five land on the atoll: the beach, the airfield on the
east arm, the south base on the west arm, and the two north-base flags at the top of the V.
Independently, the 4x4 block of `Textures/Tx0Cx0R.dds` terrain tiles (which cover world
`x,z ∈ [512,1536]`) was stitched world-aligned and cropped out of the minimap at the same
rectangle: the two images are the same atoll outline, lagoon and spit, essentially pixel for
pixel. Confirmed exact.

**El Alamein** (2048, no combat area). Five control points land on the Allied base complex
at grid G5, the Axis base at B4, the north wadi and the two open bases. Confirmed exact.

**Liberation of Caen** (2048, combat area `360 460 1229 1229`) — the decisive test. The
level places five bridges (`Pegasus_Bridge_M1` plus four `stonebridge_sml_M1`) whose world
positions are known, and the minimap art shows an unmistakable river system. Rendered both
framings side by side:

| framing | where the five bridges land |
|---|---|
| `x/worldSize` | all five on dry land — one in the middle of an empty green field at grid D6 |
| combat area | all five sit squarely on water: two on the canal at D2/E2, one on the canal at D3, one on the main river at E4, one where the southern river bends at D7 |

**Berlin** (2048, combat area `1536 1536 512 512`). Under `x/worldSize` all four control
points land in the top-right corner on featureless rubble, and cropping the minimap to the
rectangle the terrain tiles cover returns flat brown texture with the grid letters `G`/`H`
on it — not the city. Under the combat-area framing, 326 `StaticObjects.con` positions trace
the city's streets and blocks exactly, the 34 `Berlin_waterwall*` objects sit precisely on
the two banks of the painted canal, and the four flags land inside the city blocks.

**Baytown** (XPack1, 2048, combat area `512 256 1280 1280`). Derived the shoreline from
`Heightmap.raw` (the `height == waterLevel` contour) and drew it over the minimap under both
framings. Under the combat-area framing the contour follows the painted surf line around the
entire island. Under `x/worldSize` it sits inland, shrunk and offset.

### Automated sweep

Two objective sweeps, both scripted against real files:

1. **Water-mask IoU, world framing**, over 280 levels across `bf1942`, `XPack1`, `XPack2`,
   `DesertCombat`, `FH`, `bf1918`. Mask A = `Heightmap.raw` sample below
   `GeometryTemplate.waterLevel`; mask B = blue-dominant minimap pixels. Every level that
   has meaningful water and declares no combat area (or one equal to the world) scores
   high: Truk 0.996, Rheinuebung-1941 0.995, falkland_islands 0.989, Adak_Island 0.976,
   Midway 0.965, bf1918 midway 0.949, bismarck_archipel 0.950, Guadalcanal 0.911,
   Battle_of_Britain 0.904, Wake 0.724, Coral Sea 0.654. No level anywhere preferred the
   terrain-tile extent over the world.

2. **World framing vs combat-area framing**, restricted to levels declaring a sub-world
   combat area. Every level with usable water prefers the combat area, never the reverse:

   | level | combat area | IoU world | IoU combat area |
   |---|---|---|---|
   | XPack1 baytown | `[512,1792]x[256,1536]` | 0.555 | **0.875** |
   | XPack2 Peenemunde | `[0,1792]x[0,1792]` | 0.556 | **0.738** |
   | XPack1 husky | `[512,1792]x[512,1792]` | 0.472 | **0.647** |
   | XPack2 Telemark | `[0,1792]x[0,1792]` | 0.205 | **0.365** |
   | XPack1 Anzio | `[512,1792]x[768,2048]` | 0.047 | **0.184** |
   | bf1942 Berlin | `[1536,2048]x[1536,2048]` | 0.007 | **0.132** |
   | bf1942 Liberation_of_Caen | `[360,1589]x[460,1689]` | 0.051 | **0.132** |

   (The absolute numbers are low where the level is mostly dry or its water is painted too
   dark for a blue-dominance test; the ordering is what matters, and it never inverts.)

### Stock levels with a sub-world combat area

These are the ones the naive rule gets wrong. `Init.con`, args are `minX minZ sizeX sizeZ`:

| mod | level | combat area | worldSize |
|---|---|---|---|
| bf1942 | Battle_of_the_Bulge | `0 0 1280 1280` | 2048 |
| bf1942 | Berlin | `1536 1536 512 512` | 2048 |
| bf1942 | Liberation_of_Caen | `360 460 1229 1229` | 2048 |
| bf1942 | Market_Garden | `256 256 1792 1792` | 2048 |
| bf1942 | Omaha_Beach | `512 512 1024 1024` | 2048 |
| bf1942 | Stalingrad | `320 52 416 416` | 1024 |
| bf1942 | Tobruk | `1024 0 2048 2048` | 4096 |
| XPack1 | Anzio, baytown, cassino, husky, Santo_Croce | various | 1024/2048 |
| XPack2 | Essen, Gothic_Line, Peenemunde, Telemark | various | 1024/2048 |

Levels declaring `0 0 worldSize worldSize` (Battle_of_Britain, Invasion_of_the_Philippines,
Kasserine_Pass, Truk, Raid_on_Agheila) are identical to declaring nothing.

### The grid is baked in

The A-H / 1-8 grid and its labels are painted into `InGameMap.dds` itself — they survive a
raw DDS decode with no overlay, and their colour varies per level (cyan on Wake, white on
Berlin, dark on Caen). There is no grid texture in `menu.rfa`. It follows that the grid cell
is `combatAreaSize / 8` on each axis, which is what the HUD's `Coordinates/MapCoordinate`
readout must be computed over. Spot-checked: Caen's Pegasus Bridge at `(999, ·, 1169)` gives
column `int(0.520*8)=4` -> `E`, row `int(0.423*8)=3` -> `4`, i.e. `E4`, and the bridge does
sit in E4 on the art. *(The readout derivation is an inference; the grid being baked is
verified.)*

### What `scene.json` already gives you

`tools/bf1942-models/extract_map.py` already writes `worldSize`, `waterLevel` and
`combatArea` per level. Watch the axis convention: `_to_gltf_vec` negates z, so
`combatArea.min = [minX, 0, -minZ]` and `combatArea.max = [maxX, 0, -maxZ]` — `min[2]` is
numerically *greater* than `max[2]`. Real values:

```json
"berlin":      { "combatArea": { "min": [1536, 0, -1536], "max": [2048, 0, -2048] } }
"omaha_beach": { "combatArea": { "min": [512,  0,  -512], "max": [1536, 0, -1536] } }
"wake":        { "combatArea": null }
```

So the viewer needs no new level metadata at all for the projection.

---

## 2. Asset inventory

### Per level

Paths are archive-relative inside `Mods/<mod>/Archives/bf1942/levels/<Level>.rfa`.
Casing varies per level (`InGameMap.dds` vs `ingamemap.dds`, `Textures` vs `Texture`) — use
the case-insensitive `LevelFiles.find()` / `ArchivePool`, never a literal path.

| entry | what it is | size | notes |
|---|---|---|---|
| `bf1942/levels/<L>/Textures/InGameMap.dds` | **the map art**, minimap and full map both | 512x512 DXT1, exactly 131,072 bytes, no mips, on every vanilla/XPack level | the only map texture a level ships; mods vary, see below |
| `bf1942/levels/<L>/Menu/thumbnail.dds` | map-list preview screenshot | 128x128, 16 KB | 4:3 art padded to square; bottom quarter is dead |
| `bf1942/levels/<L>/Menu/Briefing.dds` | briefing-screen art | 512x512, 256 KB | 17 of 23 stock levels; often ships in the `_000` patch archive |
| `bf1942/levels/<L>/Menu/init.con` | briefing/debriefing localisation keys | — | no map geometry |
| `bf1942/levels/<L>/Textures/Tx<CC>x<RR>.dds` | terrain colour tiles, 256 m each | — | not map art, but the reference signal used above |

There is **no** separate higher-resolution or differently-framed full-map texture, no
separate grid overlay, and no per-level minimap chrome. The full map and the minimap are the
same 512x512 DDS at different on-screen sizes. Verified by listing every image entry in every
vanilla level archive: the only non-terrain, non-lightmap images are the three above.

Coverage across the installed mods — 1198 of 1399 level archives ship their own
`InGameMap`; the rest inherit one from a parent mod's copy of the same level through the
`game.addModPath` search path (that is why DC_Final shows 48%: its Wake, Berlin etc. fall
back to `bf1942`).

| mod | levels | with InGameMap |
|---|---|---|
| bf1942 / XPack1 / XPack2 | 23 / 6 / 9 | 100% |
| EoD, FinnWars, GCMOD, Pirates, interstate | 237 / 70 / 30 / 33 / 13 | 100% |
| bf1918 / bg42 | 134 / 200 | 99% |
| bfheroes | 35 | 97% |
| FH / FHSW / FHSWEurope | 73 / 267 / 8 | 86% / 82% / 75% |
| DesertCombat / DC_Final / WarFront | 35 / 48 / 178 | 57% / 48% / 46% |

**Do not assume 512x512 or `.dds`.** A sweep of every `*ingamemap*` entry in all 1399 level
archives across 17 mods:

| dimensions | count |
|---|---|
| 512x512 | 1193 |
| 1024x1024 | 30 |
| 2048x2048 | 12 |
| 584x584 | 1 |

| extension | count |
|---|---|
| `.dds` | 1226 |
| `.tga` | 8 |
| authoring leftovers (`.psd`, `.xcf`, `.bmp`, `.bak`) | 10 |

So a reader must probe `.dds` then `.tga` (and skip the rest), and must take the decoded
width/height rather than hardcoding 512. The non-512 sizes are concentrated in FHSW, FH,
GCMOD and bg42. One FHSW level, `Battle_of_Abyssinia`, has an actual 3D object *named*
`ingamemap` (`Objects/ingamemap/Geometries.con`, `standardMesh/ingamemap.sm`) — a name
collision, not map art; match on the `Textures/` (or `Texture/`) parent, not the substring.

Two levels ship minimap icons of their own, both Battle of Britain:
`bf1942/levels/Battle_of_Britain/Menu/Texture/Minimap/minimap_icon_Factory_{16x16,32x32}.dds`
and `…/minimap_icon_Radar_{16x16,32x32}.dds`.

### HUD chrome and icons (all in `Mods/bf1942/Archives/menu.rfa`)

Every entry below was decoded and rendered to a contact sheet that was inspected, so the
descriptions are of the actual pixels, not of the filename. The engine's own strings say
`.tga` for all of these; the shipped files are `.dds`. The engine probes for an extension,
so a reader must do the same (`ArchivePool.resolve_ext`).

**Map chrome**

| path | size | what it looks like |
|---|---|---|
| `menu/Texture/Minimap/icon_mapbar_small.dds` | 128x128 | grey rounded frame — the minimap bezel |
| `menu/Texture/Minimap/minimap_icon_ring_32x32.dds` | 32x32 | dark disc containing a large black arrowhead — **the "you are here" player marker**, position and heading in one sprite |
| `menu/Texture/Minimap/map_circle.dds` | 16x16 | white segmented ring |
| `menu/Texture/Minimap/map_dot.dds` | 16x16 | small ring with white centre |
| `menu/Texture/scout_ring_128x128.tga` | 128x128 | faint circle (scout spotting radius) |
| `menu/Texture/Minimap/artillery_minimap_camview_128x128.dds` | 128x128 | yellow wedge — artillery camera frustum |

There is **no compass ring, no north indicator and no zoom button art** anywhere in
`menu.rfa`. Zoom is a keybind (`c_PIZoomMap`, default `N`), not a clickable control.

**Vehicle / unit icons** — `menu/Texture/Minimap/`

| file | size | depiction |
|---|---|---|
| `minimap_icon_soldier_16x16.dds` | 16x16 | white arrowhead (directional) |
| `minimap_icon_tank_16x16.dds` | 16x16 | top-down tank, hull + turret |
| `minimap_icon_apc_16x16.dds` | 16x16 | boxy vehicle |
| `minimap_icon_plane_16x16.dds` | 16x16 | top-down aircraft |
| `minimap_icon_common_16x16.dds` | 16x16 | rounded rectangle (generic vehicle) |
| `minimap_icon_stationary_16x16.dds` | 16x16 | small dot (emplacements) |
| `minimap_icon_PT_Boat.dds` | 32x32 | pointed hull |
| `minimap_icon_destoyer_32x32.dds` | 32x32 | long hull (note the misspelling, it is in the shipped filename) |
| `minimap_icon_submarine_32x32.dds` | 32x32 | slim hull |
| `minimap_icon_battleship_64x64.dds` | 64x64 | long hull |
| `minimap_icon_aircraft_carrier_64x64.dds` | 64x64 | long hull |

**Control points and flags** — `menu/Texture/`

| file | size | depiction |
|---|---|---|
| `conp_{us,ger,brit,can,jp,rus}.dds` | 16x16 | national flag on a pole — the capturable-flag icon |
| `conp_neutral.dds` | 16x16 | grey flag on a pole |
| `baseflag_conp_{us,ger,brit,can,jp,rus}.dds` | 32x32 | national flag with a red "no entry" ring — uncapturable main base |
| `icon_non_takeable_flag.dds` | 64x64 | dark disc with a crossed-out flag |
| `icon_flag_{us,ger,brit,can,jp,rus}.dds`, `icon_flag.dds`, `icon_ctf.dds` | 64x64 | large flags (CTF / world-space, not the map) |
| `menu/Texture/Minimap/Objectives/Objective{000,012,025,037,050,062,075,087,100}.dds` | 32x32 | nine-frame capture-progress ring, empty through full |
| `menu/Texture/ingame_cpbar_256x16.dds`, `menu/Texture/Ingame/cpbar/cpbar_{blue,red,gray}_cp_16x8.dds` | 256x16, 16x8 | the flag-status bar along the top of the HUD, not the map |

**Player blips** — `menu/Texture/`

| file | size | depiction |
|---|---|---|
| `icon_vehicledot_friend.dds` | 8x8 | blue disc |
| `icon_vehicledot_enemy.dds` | 8x8 | red disc |
| `icon_vehicledot_empty.dds` | 8x8 | dark ring |
| `icon_vehicledot_local.dds` | 8x8 | filled blue disc |
| `your_dot_s.dds` | 4x4 | yellow pixel |
| `other_dot_s.dds` | 4x4 | green pixel |
| `menu/Texture/Minimap/map_medic.dds` | 16x16 | red cross on white — medic request |
| `menu/Texture/Minimap/map_engineer.dds` | 16x16 | wrench — engineer request |
| `menu/Texture/Soldier/icon_{us,ger,brit,jap,rus,can,us_marine}_soldier_{standing,crouching,lying}.dds` | 64x64 | stance icons (HUD, not the map) |

The load order is confirmed in the binary: `FUN_0046e230` is the minimap class constructor
(vtable `0x008d6700`) and loads exactly this set, in this order, into consecutive member
slots.

### Which object gets which icon

`Objects.rfa` declares it. 139 statements across 110 templates:

```con
ObjectTemplate.setMinimapIcon "Minimap/minimap_icon_tank_16x16.tga"
ObjectTemplate.setMinimapIconSize 32
```

`setMinimapIcon` appears on `PlayerControlObject` templates (vehicles, emplacements, every
passenger/gunner PCO of a vehicle carries the same icon) and on `BFSoldier` templates, where
it is a national flag (`flag_ger.tga`, `flag_us.tga`, …). `setMinimapIconSize` is the draw
size in pixels and is only declared for the 32 and 64 px ship icons; the default is 16.

Distribution in vanilla: plane 21, tank 18, apc 18, aircraft_carrier 10, common 9,
destroyer 9, battleship 8, stationary 5, PT_Boat 2, submarine 2, national flags 8.

---

## 3. Minimap behaviour

**The minimap and the full map are the same picture.** `menu/InGame` (a DICE `MemeFile 2.0`
GUI tree) declares a placeholder node `MapPath` and a boolean `ShowMap`; `menu/MapPath` is a
45-byte stub holding nothing but a `NameNode`. `FUN_0045d7c0` in the binary resolves
`"MapPath"` at runtime and hot-swaps a picture node into it. The texture that node gets is
built by `FUN_0045cf00`, which concatenates `"../../"`, the level path, and the single string
`"Textures/InGameMap.tga"` at `0x008d56f8` (one xref in the whole binary). There is no second
map asset and no second map node.

**Rotation.** The minimap rotates with the player's heading by default; `Static Minimap` is a
user option that pins it north-up.

- The option exists and is saved as `game.setStaticMinimap %d`. Every shipped default
  profile (`Mods/bf1942/Settings/Default/GeneralOptions{,Low,Medium,High}.con` and
  `Settings/Profiles/{Default,Custom}/GeneralOptions.con`) sets `game.setStaticMinimap 1`
  alongside `game.setMinimapTransparency 20`. The local user profile
  (`Settings/Profiles/skandia/`) has `0` and `86`.
- The menu node is `Options/General/StaticMinimap`, localisation key
  `GENERAL_OPTIONS_MINIMAP_STATIC` (found in `menu/GeneralOptionsMenu`).
- The map's screen transform in `FUN_00469360` (a vtable override of the minimap class) is a
  full 2x2 rotation built from `cos`/`sin` of a per-instance angle at member offset `+0x64`,
  divided by a zoom scale — i.e. the engine genuinely rotates the art, it does not just spin
  a marker.
- `menu/InGame` also carries `dice::meme::RotateEffect`,
  `dice::meme::RotateAroundCoordinateEffect` and a node named `IconLookRotation`.

*Inference (not verified against the binary): that `+0x64` angle is the player's yaw, and it
is forced to zero when the static-minimap option is on. The option's name, its default, and
the existence of the rotation term together make any other reading implausible, but I did not
find the write site.*

The player's own marker is `minimap_icon_ring_32x32.dds`, a disc with an arrowhead — so in
static mode you get a north-up map with a rotating arrow, and in rotating mode the arrow
points up and the map turns underneath it.

**Zoom.** `c_PIZoomMap` is bound to `N` by default and `c_PIMap` (show/cycle the map) to `M`
— see `Mods/bf1942/Settings/Profiles/Default/Controls/{Common,Land,Air,Infantry}.con`, which
bind them identically for all four control maps. In `FUN_00469360` the transform divides by
a scale derived from `pow()` of `1.0 - <member +0x40>`, and the map centre is interpolated
toward the view centre by the same factor, which is the standard zoom-about-a-point form.
**Open**: how many discrete zoom steps there are and what the step values are. I did not
recover the write site for `+0x40`.

**Transparency.** `game.setMinimapTransparency` is an integer 0-100, default 20. Applies to
the whole map surface.

**Layout.** There is no `.con` or `.ini` anywhere that positions or sizes the map. The
position and size live inside the binary `menu/InGame` meme tree, which is not text and which
I did not decode structurally. For the viewer this does not matter — pick your own frame.

---

## 4. The full map screen

Layers drawn on top of the art, and where each layer's data comes from:

| layer | source | static or live |
|---|---|---|
| map art | `Textures/InGameMap.dds` | **static** |
| grid + A-H/1-8 labels | baked into the art | **static** |
| control point flags | `Conquest/ControlPoints.con` -> `Object.create <name>` + `Object.absolutePosition x/y/z`; team and radius from `Conquest/ControlPointTemplates.con` (`ObjectTemplate.team`, `.radius`, `.setControlPointName`, `.spawnGroupId`, `.objectSpawnerId`) | **static** (positions, round-start owner); capture state is live |
| capture progress ring | `Minimap/Objectives/Objective000…100.dds` | live only |
| soldier spawn points | `Conquest/SoldierSpawns.con` -> `Object.create <name>` + `absolutePosition` + `rotation`; grouping via `Conquest/SoldierSpawnTemplates.con` and `spawnPointManagerSettings.con` | **static** |
| vehicle spawners | `Conquest/ObjectSpawns.con` (placements) + `Conquest/ObjectSpawnTemplates.con` (`setObjectTemplate <team> <vehicle>`, `teamOnVehicle`) | **static** (spawn points and rosters); which vehicle is alive right now is live |
| vehicle icons | `ObjectTemplate.setMinimapIcon` / `setMinimapIconSize` in `Objects.rfa`, keyed by the spawned template | **static** mapping, live placement |
| combat area boundary | `Game.setActiveCombatArea` in `Init.con` — by definition the full frame of the art when declared | **static** |
| own position + heading | `minimap_icon_ring_32x32.dds` | live |
| friendly / enemy blips | `icon_vehicledot_{friend,enemy,empty,local}.dds`, `your_dot_s.dds`, `other_dot_s.dds` | live |
| medic / engineer calls | `map_medic.dds`, `map_engineer.dds` | live |
| artillery camera wedge | `artillery_minimap_camview_128x128.dds` | live |
| scout spotting ring | `scout_ring_128x128.tga` | live |

Other game modes ship their own copies of the same files — `Ctf/ControlPoints.con`,
`TDM/ControlPoints.con`, `SinglePlayer/ControlPoints.con` — so a viewer showing a non-Conquest
layout must read the matching directory.

---

## 5. Reconstructability

| layer | verdict | how |
|---|---|---|
| map art | **extractable with existing code** | `LevelFiles.find("Textures/InGameMap.dds")` then `decode_dds` and `encode_png` from `~/.claude/skills/bf1942-map-images/scripts/extract_map_images.py` — `extract_map.py` already imports both. One call per level. |
| framing / projection | **extractable, no new data needed** | `scene.json` already carries `worldSize` and `combatArea`. Fall back to `[0, worldSize]` when `combatArea` is `null`. Remember the z negation. |
| grid | **free** | baked into the art. If you want live grid-reference readout, derive it as `combatAreaSize / 8`. |
| control point flags | **extractable, needs ~40 lines** | parse `Conquest/ControlPoints.con` for `Object.create` / `Object.absolutePosition` pairs, then `Conquest/ControlPointTemplates.con` for `ObjectTemplate.team`. `scripts/extract_map_dossiers.py` in this repo already has a working parser for both. Icons: `menu/Texture/conp_<nation>.dds` for capturable, `baseflag_conp_<nation>.dds` for main bases; nation comes from `game.setTeamSkin` in `Init.con`. |
| soldier spawn points | **extractable, same parser** | `Conquest/SoldierSpawns.con` has the same `Object.create` / `absolutePosition` / `rotation` shape. 51 live lines on Wake. |
| vehicle spawners | **extractable, already done elsewhere** | `bf42.level.parse_spawn_templates` + `spawn_vehicle` already resolve `ObjectSpawns.con` against `ObjectSpawnTemplates.con`; `extract_map.py` uses them to place vehicles in the 3D scene. Reuse the same result for the map. |
| vehicle icons | **needs ~30 lines of new code** | scan `Objects.rfa` `.con` files for `ObjectTemplate.setMinimapIcon` / `setMinimapIconSize`, keyed by the enclosing `ObjectTemplate.create`. Normalise the same way `scripts/extract_hud_assets.py` does for vehicle icons (drop `Minimap/`, flatten to lowercase, probe `.dds` then `.tga`). Then decode each named icon out of `menu.rfa`. Roughly 40 unique icons in vanilla. |
| combat area outline | **free** | already in `scene.json`. |
| player arrow / rotation | **needs new code, trivial** | one sprite (`minimap_icon_ring_32x32.dds`) plus a CSS/canvas rotation. Whether the map or the arrow rotates is a viewer choice; the game defaults to arrow-rotates (static map). |
| live player / vehicle blips | **not feasible from level data** | this is round state. Either omit, or drive it from bfstats' own live server feed if the viewer ever grows one. The art is there if you want it. |
| capture progress ring | **not feasible** | live state. The nine frames are extractable if you ever want to animate a demo. |
| minimap bezel / compass | **not applicable** | there is no compass or north-indicator art in the game. The only chrome is `icon_mapbar_small.dds`, a plain grey frame. Design your own. |

### Size and format

The typical `InGameMap.dds` (1193 of 1236) is 512x512 DXT1, exactly 131,072 bytes on disk.
Re-encoded:

| format | Wake | El Alamein (worst case measured) | Berlin |
|---|---|---|---|
| PNG 512 | 99 KB | 296 KB | 219 KB |
| PNG 256 | 52 KB | 149 KB | 117 KB |
| PNG 128 | 17 KB | 41 KB | 35 KB |
| AVIF q60 512 | 9 KB | 36 KB | — |
| AVIF q60 256 | 4 KB | 10 KB | — |

**Recommendation: keep 512x512 and ship AVIF (or WebP) at q≈60, not PNG.** 512 is the source
resolution, so downscaling throws away detail for no reason once you are not using PNG. At
~25 KB average that is about **30 MB for all 1198 installed maps**, against roughly 240 MB as
512-pixel PNG — which is where the skill's "~170 MB" figure comes from. PNG is a bad fit:
this is photographic terrain, and the existing pipeline only has `encode_png`, so adding an
AVIF/WebP step (shell out to `avifenc`, which is installed, or `cwebp`, which is not) is the
single biggest size lever available. If you must stay on PNG, 256 halves it and the map is
still legible.

---

## Open questions

**Status 2026-09-15.** `MemeFile 2.0` is now decoded (`tools/bf1942-models/bf42/meme.py`;
ledger MEME-1 to MEME-13), so the "not decoded structurally" note in §3 *Layout* is
superseded. The §5 *vehicle icons* row is also built: `extract_hud_pack.py` writes
`minimap-icons.json`. Viewer next steps live in
[`../authentic-spawn-map/README.md`](../authentic-spawn-map/README.md) §8, and engine
questions in the ledger. The addresses below are recorded in `symbols.json` under `ui`.

- **Zoom steps** (ledger MMAP-1). The transform in `FUN_00469360` reads a zoom parameter at
  minimap member offset `+0x40` and scales by `pow(…)` of `1 - that`. I did not find where it
  is written, so the number of discrete steps `N` cycles through and their values are unknown.
  About 15 KB of `.text` between `0x0046a5c0` and `0x0046e230` is still undefined in Ghidra
  and is the likely home of the minimap update/draw code.
- **Rotation source** (ledger MMAP-2). Same function, member `+0x64` is the map rotation
  angle. That it is the player's yaw, and that `StaticMinimap` zeroes it, is inference from
  the option's name and default, not from a decompiled write site.
- **Minimap on-screen geometry** (ledger MEME-12, MEME-13). Decoded: the minimap has no rect
  of its own. `ShowMap` is a `CullNode` over an empty `ClipNode` that the engine fills at
  runtime. Its neighbours in `menu/InGame` bound it: ticket bar `(620,4) 256x32`, grid readout
  `(627,185) 50x20`, control-point strip `(620,207) 256x16`, in 800x600 units. Where its size
  and the small/large toggle come from is still open.
- **The 43 non-512 mod maps.** 30 levels ship a 1024x1024 map, 12 ship 2048x2048 and one
  ships 584x584. The projection is resolution-independent so this should not matter, but none
  of the 43 was individually verified against its combat area.
- **Levels with no combat area and content off-centre.** The rule is confirmed, but no stock
  level exercises the case of a level whose content sits far from the world centre *without* a
  combat area declaration. If one exists in a mod its minimap would be the same kind of mess
  Berlin looks like under the naive rule. Validating a projection against the level's own
  water mask (the sweep script pattern used here) is cheap insurance if that ever bites.
- **Non-Conquest layouts.** Only the `Conquest/` directory was examined in depth. `Ctf/`,
  `TDM/` and `SinglePlayer/` ship parallel `ControlPoints.con` files with different flag sets,
  which a mode-aware viewer would need to pick between.
