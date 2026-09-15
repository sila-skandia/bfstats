# Authentic spawn screen and minimap for the level viewer

Investigation into what BF1942 actually draws on its spawn-selection screen and HUD
minimap, so `tools/bf1942-models/viewer/map.html` can drop its hand-rolled versions.
Sources: ten frames from a real gameplay recording (Omaha-style beach round, spawn
screen visible in one frame), the archives under
`~/.wine/drive_c/EA Games/Battlefield 1942/`, and the prior deep-dive in
`features/bf1942-3d-models/minimap-and-fullmap.md` — that document is the authority on
projection math and engine behaviour (verified against the decompiled binary); this one
adds the spawn-screen chrome, the concrete gap list against `map.html`, and the plan.

## 1. What the game draws

### The spawn screen (one surface, two panes)

Left pane — the kit selector, built from `menu/Texture/Ingame/respawn/*` chrome:

- Two tabs at the top, `AXIS` / `ALLIED` (inactive grey, active tan —
  `ingame_respawn_kits_tab*_256x32.dds`).
- A team header box: the large waving national flag (`menu/Texture/icon_flag_us.dds`
  et al, 64x64) beside the team name in caps.
- Five kit rows, one per role (Scout, Assault, Anti-tank, Medic, Engineer). Each row:
  an olive header strip with the kit name left and `ACTIVE <ROLE>S` right, a small
  class glyph in a square at top-left (crosshair / MG / shell / cross / wrench), the
  kit photograph (`menu/Texture/Kits/icon_<role>_<side>_selected.dds`, 64x64 — weapon
  laid over the kit bag), and the live count as a large number. The selected row's
  body is filled olive-green; unselected rows stay dark. Row frames come from
  `ingame_respawn_kits_{top,middle,bottom}_256x128.dds`.

Right pane — the map:

- Near-black blue-tinted background; the level's `Textures/InGameMap.dds` drawn
  heavily dimmed (the landmass reads as a semi-transparent silhouette; water is
  almost indistinguishable from the backdrop).
- The grid lines and the `A..H` / `1..8` labels are visible because they are baked
  into the DDS itself — the engine paints no grid.
- Control points as small national-flag-on-pole sprites (`conp_<nation>.dds`;
  `baseflag_conp_<nation>.dds` with the red ring for uncapturable bases).
- Selectable spawn points as the white segmented ring `map_circle.dds`; the hovered /
  selected one carries the cursor and highlight. One selectable point per friendly
  spawn group, not one per `SoldierSpawns` entry.
- Vehicle spawn icons (white silhouettes from `menu/Texture/Minimap/minimap_icon_*`)
  and 8x8 vehicle dots (`icon_vehicledot_*.dds`) clustered around bases.
- No control-point names anywhere on the map. No legend.
- Footer bar (chrome `ingame_respawn_long_512x64.dds`): `SUICIDE` (dark red),
  `SCORE BOARD`, `RESUME` (olive) buttons.

### The HUD minimap (top-right)

- The same `InGameMap.dds` — there is no second map asset (verified in the binary:
  one xref to `"Textures/InGameMap.tga"`, one picture node hot-swapped into the
  `MapPath` meme node).
- Drawn translucent over the 3D world (default `game.setMinimapTransparency 20`),
  zoomed well in around the player, inside the grey bezel
  `menu/Texture/Minimap/icon_mapbar_small.dds` (128x128 nine-patch-style frame).
- The player is `minimap_icon_ring_32x32.dds` — a dark disc containing an arrowhead,
  position and heading in one sprite. Every stock profile ships
  `game.setStaticMinimap 1` (north-up map, rotating arrow); the rotating-map mode is
  a user option.
- Grid reference readout (`E 6` in the frames) in white in the lower-left corner of
  the widget.
- A row of small blue segments along the bottom edge (flag-status strip,
  `Ingame/cpbar/cpbar_{blue,red,gray}_cp_16x8.dds`).
- Same flag / vehicle / dot icons as the spawn map, at HUD scale.

### The fullscreen map overlay (M key in-game)

Same picture again, nearly fully transparent over the world, grid letters along the
top and numbers down the left (baked into the art), icons opaque on top. Our frames
07 and 09 show it mid-fade. The three surfaces differ only in size, zoom, dimming
and chrome.

## 2. Asset inventory

Everything below was verified by listing and decoding the archives on this machine.
The exhaustive tables (per-mod coverage, odd sizes, every icon with its decoded
appearance) are in `features/bf1942-3d-models/minimap-and-fullmap.md` sections 2-4;
this is the working subset for the viewer.

### Per level — `Mods/<mod>/Archives/bf1942/levels/<Level>.rfa`

| entry | what | decode |
|---|---|---|
| `bf1942/levels/<L>/Textures/InGameMap.dds` | the one map texture, grid baked in | 512x512 DXT1 on all vanilla levels; mods vary (1024/2048, sometimes `.tga`) — probe extensions, read decoded size |
| `bf1942/levels/<L>/Init.con` | `Game.setActiveCombatArea minX minZ sizeX sizeZ` (absent on most levels), `game.setTeamSkin` | text after LZO |
| `bf1942/levels/<L>/Init/Terrain.con` | `GeometryTemplate.worldSize` | text |
| `bf1942/levels/<L>/Conquest/ControlPoints.con` + `ControlPointTemplates.con` | flag positions, team, spawnGroupId | already parsed into `scene.json` |
| `bf1942/levels/<L>/Conquest/SoldierSpawns.con` | spawn positions + group | already parsed into `scene.json` |

Casing varies (`Textures` vs `Texture`); always resolve case-insensitively. Patch
archives (`<L>_003.rfa`) override; merge later-wins.

### Shared chrome and icons — `Mods/bf1942/Archives/menu.rfa` (all DXT DDS)

Map sprites:

| path | size | use |
|---|---|---|
| `menu/Texture/conp_{us,ger,brit,can,jp,rus,neutral}.dds` | 16x16 | capturable flag on the map |
| `menu/Texture/baseflag_conp_{us,ger,brit,can,jp,rus}.dds` | 32x32 | uncapturable base flag |
| `menu/Texture/Minimap/map_circle.dds` | 16x16 | selectable spawn point (white segmented ring) |
| `menu/Texture/Minimap/map_dot.dds` | 16x16 | small ring marker |
| `menu/Texture/Minimap/minimap_icon_ring_32x32.dds` | 32x32 | the player marker (disc + arrowhead) |
| `menu/Texture/Minimap/minimap_icon_{soldier,tank,apc,plane,common,stationary}_16x16.dds` | 16x16 | vehicle-class icons |
| `menu/Texture/Minimap/minimap_icon_PT_Boat.dds`, `minimap_icon_{destoyer,submarine}_32x32.dds`, `minimap_icon_{battleship,aircraft_carrier}_64x64.dds` | 32/64 | ship icons (`destoyer` misspelling is shipped) |
| `menu/Texture/icon_vehicledot_{friend,enemy,empty,local}.dds` | 8x8 | vehicle dots |
| `menu/Texture/Minimap/Objectives/Objective{000..100}.dds` | 32x32 | nine-frame capture-progress ring |
| `menu/Texture/Minimap/icon_mapbar_small.dds` | 128x128 | minimap bezel |

Spawn-screen chrome:

| path | size | use |
|---|---|---|
| `menu/Texture/Ingame/respawn/ingame_respawn_kits_{top,middle,bottom}_256x128.dds` | 256x128 | kit column panel frames |
| `menu/Texture/Ingame/respawn/ingame_respawn_kits_tab{,2,3}_256x32.dds` | 256x32 | AXIS/ALLIED tab strip |
| `menu/Texture/Ingame/respawn/ingame_respawn_{long_512x64,small_256x64}.dds` | — | footer button-bar frames |
| `menu/Texture/Kits/icon_{scout,assault,antitank,medic,engineer}_{allies,axis}_selected.dds` (+ `_jap`, `_russian`, `_canadian`, `_usmarines` variants) | 64x64 | kit photographs |
| `menu/Texture/icon_flag_{us,ger,brit,can,jp,rus}.dds` | 64x64 | team-header flag |

Icon assignment: `Objects.rfa` declares `ObjectTemplate.setMinimapIcon
"Minimap/minimap_icon_tank_16x16.tga"` and `ObjectTemplate.setMinimapIconSize <px>`
on 110 vehicle/soldier templates (paths say `.tga`, shipped files are `.dds` — probe
both). Mods override in their own `Objects.rfa` along the `game.addModPath` chain.

Layout is not in any asset: the screen geometry lives in the binary
`menu/InGame` MemeFile, which we do not parse. We restyle with CSS against the
reference frames instead.

### Mod differences

- Base game / XPack1 / XPack2: everything above, 100% InGameMap coverage.
- FHSW / FH / bg42 / GCMOD ship larger InGameMaps (1024/2048) and a few `.tga`;
  DC-family levels frequently omit InGameMap and inherit the parent mod's copy via
  the search path (DC_Final only 48% own coverage).
- Mods ship their own `menu.rfa` overrides for kit icons and sometimes map icons;
  resolution must walk `game.addModPath` nearest-child-first. Vanilla-only is fine
  for the first pass since the viewer's maps tree is currently vanilla + xpacks + eod.

## 3. Coordinate math

Already derived, verified and implemented — see
`features/bf1942-3d-models/minimap-and-fullmap.md` section 1 for the evidence.

```
combat area (Init.con):  Game.setActiveCombatArea minX minZ sizeX sizeZ
                         absent -> 0 0 worldSize worldSize
u = (x - minX) / sizeX                # Refractor coords; u,v in 0..1 top-left
v = 1 - (z - minZ) / sizeZ            # image V runs down, world +z runs north
```

The art always frames the combat area (142 of 1018 installed levels declare a
sub-world one; Berlin is `1536 1536 512 512` against a 2048 world). The grid is an
8x8 division of that same frame, baked into the art:

```
col = floor(u * 8)  -> 'A'..'H'
row = floor(v * 8) + 1  -> 1..8       # readout "E6" = col 4, row 5
```

`extract_map.py:1194` (`_world_to_image`) already emits this as a glTF-space affine
into `scene.json` (`minimap.worldToImage`, with the exporter's z negation folded in),
and `map.html:4007` (`gridRef`) already computes the readout from it. Both are
correct; nothing to change here.

## 4. Gap analysis against `map.html`

What is already right (keep):

- Real map art: `write_minimap` (`extract_map.py:1157`) decodes `InGameMap` per level
  into `maps/<level>/minimap/minimap.png`, and `loadMapArt` (`map.html:3984`) draws
  it. Projection and grid readout are correct (`map.html:3998-4013`).
- Surface architecture matches the engine: one picture, three presentations
  (`paintMap`, `map.html:4120`).
- North-up map with rotating player arrow matches the shipped default.

What is hand-rolled and does not match the game:

| # | ours | the game | where in map.html |
|---|---|---|---|
| 1 | Flags drawn as vector triangles in team colours red/blue | `conp_<nation>.dds` / `baseflag_conp_<nation>.dds` sprites; nation derivable from each CP's `flagMesh` (`flagus_m1` -> `us`), uncappable from `unableToChangeTeam` | `drawControlPoint` 4038-4077, `TEAM_FILL/TEAM_EDGE` 3978-3979 |
| 2 | Player is a hand-drawn yellow triangle | `minimap_icon_ring_32x32.dds` (dark disc + arrowhead) | `drawPlayer` 4079-4097 |
| 3 | Control-point name labels with collision placement | the game draws no names on the map at all | label block 4164-4221 |
| 4 | Spawn points: one 2 px dot per `SoldierSpawns` entry | one `map_circle.dds` ring per selectable spawn group; individual spawn entries are never shown | `opts.spawns` 4150-4162 |
| 5 | Deploy screen: fullscreen map + text header + Spawn button + pulsing yellow rings + number badges | kit-selector column left (tabs, flag header, five kit rows), dimmed map right, `map_circle` targets, SUICIDE / SCORE BOARD / RESUME footer | markup 555-575, CSS 245-301, JS 4272-4447 |
| 6 | Fullmap art at full brightness on `#0d0f10` | spawn map heavily dimmed silhouette on near-black; in-game overlay near-transparent | `drawArt` 4027-4036, `drawFullMap` 4245 |
| 7 | No vehicle icons or vehicle dots on any surface | vehicle-class silhouettes at spawner positions plus 8x8 dots | absent; vehicle positions already live in the scene (`spawnersRoot` children, 2691-2735) |
| 8 | Minimap chrome is a CSS panel; capture-ring / cpbar / bezel absent | `icon_mapbar_small` bezel, cpbar strip, translucency over the world | CSS 159-194, `drawMinimap` 4230-4243 |
| 9 | Capture radius rings and combat-area rectangle drawn | the game draws neither on the map | 4134-4148, 4169-4180 |

Data gaps feeding those:

- No extracted icon sprites: nothing pulls `menu.rfa` map/chrome textures into the
  viewer tree.
- No template-to-minimap-icon mapping: `setMinimapIcon` / `setMinimapIconSize` from
  `Objects.rfa` is not parsed anywhere in the repo (grep confirms).
- `scene.json` control points already carry `team`, `spawnGroupId`, `flagMesh`,
  `unableToChangeTeam`; soldier spawns carry `group`. Sufficient for spawn-group
  selection and nation-correct flags. No new level parsing needed.

## 5. Implementation plan

Extraction first, then the viewer. Do not restructure `viewer/maps/` — it is a
shared untracked tree written by multiple worktrees; only add files.

1. **Shared HUD sprite pack** (new, one-time): a small extractor (either a new
   `tools/bf1942-models/extract_hud_pack.py` or a flag on `extract_map.py`) that
   decodes the section-2 sprite list out of `menu.rfa` to
   `viewer/maps/_shared/hud/` as PNGs with alpha, preserving the original pixel
   sizes (they are point art; never resample). Reuse `RfaArchive` + `decode_dds`
   already imported by `extract_map.py`. Include a `hud.json` manifest naming each
   sprite. Roughly 45 files, well under 1 MB.
2. **Minimap icon mapping**: scan `Objects.rfa` (and parent-mod archives) for
   `ObjectTemplate.create` / `setMinimapIcon` / `setMinimapIconSize`, emit
   `viewer/maps/_shared/hud/minimap-icons.json`
   (`template -> {icon, size}` with the `Minimap/` prefix dropped and lowercased,
   probing `.dds`/`.tga` like `scripts/extract_hud_assets.py` does). Vanilla is 139
   statements over 110 templates; about 30 lines of parsing.
3. **Viewer: sprite layer** in `map.html`: load the pack once, replace
   `drawControlPoint` and `drawPlayer` with `ctx.drawImage` of the real sprites
   (nation from `flagMesh`, base flags from `unableToChangeTeam`); delete the label
   block, radius rings and combat-area rectangle from the authentic path; add
   vehicle icons by walking `spawnersRoot.children` through `minimap-icons.json`.
4. **Viewer: spawn screen**: rework the `#fullmap.deploy` state into the two-pane
   layout — kit column left (tabs, flag header, five rows from the respawn chrome
   PNGs and kit photos; kit choice is cosmetic for now), dimmed map right (draw art
   at reduced brightness over near-black), `map_circle.dds` targets one per friendly
   spawn group, footer bar with SUICIDE / SCORE BOARD / RESUME styling (RESUME =
   today's cancel, SUICIDE = respawn, SCORE BOARD can be a stub).
5. **Viewer: minimap chrome**: draw the `icon_mapbar_small` bezel, swap the player
   sprite, keep the grid readout, and optionally render the map translucent over the
   3D view to match the game (viewer choice; the game's default transparency is 20).
6. **Verify** with the reference frames side by side (Wake for the spawn map,
   the beach frames for the minimap), then `./scripts/verify.sh --skip-e2e` — the
   viewer has no E2E coverage, so also do a manual pass on :5273 per
   `features/bf1942-3d-models/` conventions.

Steps 1-2 are pure additions and safe to land alone; 3-5 are each independently
shippable behind the existing surfaces.

## 6. What landed

All six steps, in one change to `map.html` plus the new extractor:

- `tools/bf1942-models/extract_hud_pack.py` writes the 73-sprite pack, `hud.json`
  and `minimap-icons.json` (110 templates) into `viewer/maps/_shared/hud/`. The
  pack is uploaded to the assets volume at `maps/_shared/hud/` and served from
  `mesh.bfstats.io/maps/_shared/hud/`.
- Every map surface draws sprites only: `conp_<nation>` / `baseflag_conp_<nation>`
  / `conp_neutral` for control points (nation from `flagMesh` through the
  manifest table; Italian and French meshes fall back to their side's founding
  nation), vehicle-class silhouettes rotated to the vehicle's heading with
  `icon_vehicledot_empty` for templates with no icon, the tinted
  `minimap_icon_ring_32x32` for the player. Names, capture radii, the
  combat-area box and the per-entry spawn dots are gone.
- The HUD widget lost its CSS panel; the `icon_mapbar_small` nine-patch bezel,
  the grid readout and a `cpbar` segment per control point are painted into the
  canvas, and the art is drawn translucent over the world.
- The deploy state is the two-pane spawn screen: AXIS / ALLIED tabs, flag header
  (`icon_flag_<nation>`), five kit rows with the kit photographs (Japanese,
  Soviet and Canadian variants where the game has them), dimmed map with one
  `map_circle` per friendly spawn group, and the SUICIDE / SCORE BOARD / RESUME
  bar on the `ingame_respawn_long` chrome.

Viewer decisions the game does not dictate:

- The commit is SUICIDE, Enter, or a second click on the ring already chosen —
  the game spawns you on the next wave with no button, and the viewer has no
  waves. RESUME is the cancel; SCORE BOARD is a button in name only.
- The kit is cosmetic; the weapon in hand still follows the flag.
- A side with no flagged control point (Wake's Japanese, Iwo Jima's Americans)
  takes its nation from the vehicles it fields, and its tab lists every flag
  rather than none. `scene.json` carries no `setTeamSkin`; adding it means a
  re-extract of every level and was not worth it for two levels' headers.
- The capture-progress `objective*` frames and the `_friend`/`_enemy`/`_local`
  dots are in the pack but unused: the viewer has no capture state and no other
  players.
