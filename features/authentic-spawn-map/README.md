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

Layout lives in the binary `menu/InGame` MemeFile. Section 7 covers decoding it;
`tools/bf1942-models/bf42/meme.py` parses it.

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

## 7. The spawn screen, drawn from the game's own layout

The CSS approximation from section 6 is gone. `menu/InGame` in `menu.rfa` is a
serialized `dice::meme::*` node graph (`MemeFile 2.0`), and the engine's reader
was traced in BF1942.exe far enough to parse it: a symbol table, then object
frames of `u32 size, u16 name, u16 class, fields`, each node's sibling chain
serialized inside its own frame, `CullNode` / `EffectNode` gating and colouring
the siblings after them. The record layout, the primitive encodings and the
evidence are in `features/bf1942-engine-reference/ledger.md` (MEME-1..9) and
`symbols.json`; the reader is `tools/bf1942-models/bf42/meme.py`.

`extract_spawn_layout.py` flattens the `Kit/ShowKit` subtree (and the ticket
counter) into `viewer/maps/_shared/hud/spawn-layout.json`: 88 leaves in 800x600
virtual units, each with its texture or fill colour, font, alignment, locale key
resolved through `lexiconAll.dat`, colour multiplier and the `when` conditions
the game evaluates before drawing it. It also writes the four bitmap fonts those
text nodes name (`fonts/standard6`, `trebuchet_ms8`, `trebuchet_ms14`,
`trebuchet_ms14_latin`; `.dif` glyph tables via `bf42/font.py`, atlases as
white-with-alpha PNGs). `extract_hud_pack.py` gained the `knapp*` plates, the
`class_*_16x16` glyphs and the ticket-bar art.

What the data says, and the viewer now does:

- Root `800x600`, stretched to the screen (the reference capture's 100 px row
  pitch is the data's 83 at 720/600). Below a 4:3 aspect the viewer scales
  uniformly and letterboxes instead.
- Kit column at `X=30`: tab strip `Y=30` (`tab` / `tab2` by team, labels in
  `Trebuchet MS8` black), header plate `Y=57` with the 64 px flag at `(10,58)`
  and the team name centred in `Trebuchet MS14`, five rows at `Y=127+83i`, each
  a `kits_middle` plate (`kits_bottom` for the last), a black 196x17 strip under
  an olive `(0.52,0.49,0.30)` 195x15 strip, `standard6` name left and
  `ACTIVE ...` right in black, a 16 px class glyph at `(1,1)`, the 64 px kit
  photograph at `(15,0)`, and the count centred in `Trebuchet MS14 - Latin`. The
  selected row fills `(0.84,1,0.5)` at 0.4 alpha, the row under the pointer at
  0.2.
- Footer `(250,550)` on `ingame_respawn_long`, plates `knappExt` (SUICIDE, or
  CLOSE when no life waits) and `knapp3` (SCORE BOARD; RESUME, or DONE), mouse-over
  variants under the pointer, labels in `standard6` white.
- Everything is painted into one canvas from the flattened list, in the file's
  order, under the file's conditions; invisible buttons sit where the game's
  pointer regions are, so the harness selectors are unchanged.
- Show/hide is the engine's own `BfMap` open/close (`BfMap__animate`
  0x00468fb0; ledger MMAP-1/2, MEME-13): one zoom fraction z eases toward its
  target as `z += (target − z)(1 − e^(−9·dt))` — pure exponential, ~0.11 s
  time constant — and drives everything. The pane interpolates from the closed
  minimap's `(620,30) 175x175` to the spawn map's measured `(280,33) 512x512`,
  the art inside turns by `(1 − z) × cameraHeading()` (over-scaled by the
  square's cover factor so the turned texture keeps the quad covered, the
  pane's own edge staying axis-aligned as in the capture), the pane's opacity
  rides the same fraction, and the chrome pops in fully formed when z crosses
  0.7 — the capture's one-frame appearance ~0.13 s in (the chrome is plain
  `CullNode` visibility, MEME-4). Closing runs the whole thing in reverse and
  strips the chrome on the first frame. The deploy backdrop is transparent:
  the live world shows around and through the screen as it does in the game,
  the dim being the map pane's own (MEME-10).

Still approximated or absent:

- The map pane's rectangle is not in the data (the engine hot-swaps the map
  into an empty `ClipNode`); `(280,33) 512x512` is measured from the reference
  and flagged `measured` in the JSON.
- The ticket counter is decoded but not drawn: the level report carries no
  ticket counts.
- Text is drawn with nearest-neighbour glyphs; the game's are bilinear-filtered
  and read slightly softer.
- Kit counts show the game's idle value, 0.

## 8. Open items and next steps

Ranked by what a player would notice first. The engine questions behind them are
`open` rows in `features/bf1942-engine-reference/ledger.md` (MEME-10, -11, -13,
MMAP-1, -2, FONT-1), and the addresses are in `symbols.json` (`./xref.py list ui`).
The interface is data, so almost every item here is extraction or plumbing, not art.

| # | Item | State | Lead |
|---|---|---|---|
| 1 | Spawn-map pane too bright | The capture dims it heavily (black sea, faint grid); the viewer draws full-colour art | Not in the layout: `ShowMap` holds an empty `ClipNode` (ledger MEME-10). Quick route: take a multiplier from `ref_02` by comparing sea and land pixels against `InGameMap`. Proper route: decompile `0x0045d7c0`, where the map is swapped in |
| 2 | Map pane rect is measured | `(280,33) 512x512`, flagged `measured` in `spawn-layout.json` | Same function as item 1 (MEME-8) |
| 3 | ~~Ticket counters not drawn~~ | **DONE 2026-09-19.** `paintDeployChrome` draws `spawn-layout.json`'s own `tickets` group beside the spawn group, fed from `scene.json.tickets` (`Game.setNumberOfTickets`, parsed since `parity/tickets`). Wake's spawn screen shows a US flag and a blue 100 against a Japanese flag and a red 100, flags resolved per level through `teamNation`. The same group is now in `hud-layout.json` too, so `hud.js` draws it in-game with no code of its own | Round-start values only; what a live bleed would need is in [`../bf1942-3d-models/tickets-hud.md`](../bf1942-3d-models/tickets-hud.md). `Ticket/*TicketBlink` is still unfed — what threshold sets it was not read |
| 4 | HUD minimap frame chosen by the viewer | The widget's position and size are ours | No rect of its own (MEME-12), but its neighbours pin it: ticket bar `(620,4) 256x32`, grid readout `Coordinates/ShowMapCoordinates` `(627,185) 50x20` in `Style/InGameLatin11`, control-point strip `(620,207) 256x16`. So the art sits at x=620 between y=36 and y=207. Defaults: `game.setMinimapTransparency 20`, `game.setStaticMinimap 1` |
| 5 | No minimap zoom (N) or rotating mode | Not implemented | Step values and rotation source unknown (MMAP-1, MMAP-2); likely in the undefined code range `0x0046a5c0-0x0046e230` |
| 6 | ~~Mod levels draw vanilla chrome~~ | **DONE 2026-09-20.** The five extractors take `--mod` and read `menu.rfa`, `Font.rfa` and `lexiconAll.dat` through `bf42/modmenu.py`, which resolves them along `game.addModPath` nearest-child-first and merges the lexicon rather than replacing it. `extract_hud_mods.py` keeps only what differs from vanilla byte for byte, into `maps/mods/<id>/_shared/hud/` beside a `pack.json`; `viewer/hud-pack.js` resolves one path at a time against that list. See §9 | Fifteen mods are still unbuilt — only EoD, Road to Rome and Secret Weapons have level trees. `PathetLaosSoldier` (11 EoD control points, `flagpl_m1`) has no `conp_pl` in any installed `menu.rfa` and stays unmapped |
| 7 | SCORE BOARD does nothing | Button only | `Scoreboard/SpawnScoreBoard` `(0,-15) 800x800` and `ScoreboardMapVote/MapVoteActive` decode with the same `Flattener`; art is `Voting/scoreboard_512x470` and `scoreboard_buttonframe_780x64`. The viewer has no player rows, so it would be an empty board |
| 8 | Rest of the in-game HUD not drawn from data | The weapon and ammo readout is plain viewer text | `menu/InGame` declares about 50 top-level groups with rects: weapon bar `Weapon/SelectingWeapon` `(210,525) 512x64`, soldier and vehicle panels `(600,505) 233x83`, action icons at x=720 (heal, repair, reload, parachute), `Time/ShowTime`, chat, kill and status messages. Textures are under `menu/Texture/Ingame/`. Same method as the spawn screen |
| 9 | Live-state layers unused | Capture ring, friend/enemy dots, medic/engineer calls | Need round state; not feasible from level data (`features/bf1942-3d-models/minimap-and-fullmap.md` §5) |
| 10 | Two kit rows lit in the harness capture | Unverified | Believed to be the selected row plus the 0.2 mouse-over fill under the harness pointer. Confirm the hover follows the pointer and clears on leave |
| 11 | Front-end menus undecoded | 91 layout files; only `InGame` groups are used | `meme.py` reads the whole format. Nothing in the viewer needs them yet |
| 12 | Text is sharper than the game's | Nearest-neighbour glyphs; the game filters bilinearly | Cosmetic |
| 13 | Non-Conquest layouts | Only `Conquest/` is read | See the open questions in `minimap-and-fullmap.md` |

### 2026-09-19: what the spawn screen gained, and one correction

Item 3 above is closed — see its row. Two notes beside it.

**The counter belongs to both surfaces, not to the spawn screen.** `ShowTicket`
gates a top-level entry of `menu/InGame`, a *sibling* of `Kit/ShowKit` rather
than a child of it. That is why the game draws the same nine leaves over the
deploy screen and over the live world, and it is what let this be wired once:
`extract_hud_layout.py` now decodes the same top as its own `tickets` group, so
`hud.js` paints it in-game generically, while `paintDeployChrome` paints the
spawn-screen copy from `spawn-layout.json`. Decoding it twice was a free
cross-check — the two flatteners agree on all nine leaves and all nine rects,
differing only in that the HUD one classifies the two flag nodes as
`variable-picture` (they carry a `var`) where this one calls them `picture`.

**A trap for whoever feeds the next bound texture here.** `deployVars()` seeds
its table from `spawn-layout.json`'s own `variables` block — the file's sample
values. So a generic "if the variable is fed, use it" rule in `deployTexture`
must sit *below* the existing per-level cases, or `ChangeTeam/AxisTeamFlag`'s
sample (`Icon_flag_ger.tga`) beats the `icon_flag_<nation>` lookup and every
team header goes German. The live path is there now, used by the two ticket
flags, and it is ordered accordingly.

**A separate warning surface now exists.** The combat-area countdown
(`Outside/OutsideTime`, `menu/InGame` top-level entry #42, plate
`textmessBG_3line_256x64` at `(305,171)`) draws over the live world through
the same `hud.js`. It is not part of the spawn screen, but it is the first
thing in this project to use the `Ingame/text-mess/` plates, which are now in
the sprite pack — the 1- and 2-line ones with it, ready for the spawn-point
and status messages that share the widget family and are still unfed.

---

## 9. The per-mod interface pack (2026-09-20)

Item 6 above, closed. The viewer tree holds 239 Eve of Destruction levels, 6
Road to Rome and 9 Secret Weapons, and every one of them drew its spawn
screen, HUD, fonts and strings out of `Mods/bf1942`. So a Viet Cong base
raised the Japanese rising sun, the deploy screen offered a SCOUT rather than
a Sniper, and Anzio's Axis ticket counter flew the German war ensign because
Italy was not a nation the pack had ever heard of.

### The chain, not the archive

`bf42/modmenu.py` is the whole of it. `MenuSources(mod_chain(game_dir, mod))`
finds each of `menu.rfa`, `Font.rfa` and `lexiconAll.dat` along the mod's
`game.addModPath` chain — casing of both the `Archives` directory and the file
resolved case-insensitively, per the extraction skill's section 2 — and
`LayeredArchive` addresses the archives as one namespace, nearest child first.

**A one-mod chain is that one archive**, entry for entry and in its own order.
That is deliberate and it is what the whole change rests on: it makes a vanilla
extraction byte-identical to the one that came before any of this existed.

The lexicon is *merged*, not replaced. Road to Rome's `lexiconAll.dat` holds
122 records against vanilla's 1,656 and Secret Weapons' holds 374 — they are
overlays of what those games changed. Reading only the nearest file would have
left every unshipped key unresolved on the screen.

### Three rules that were really "what vanilla happens to ship"

| Was | Is |
|---|---|
| `NATIONS = us ger brit can jp rus`, hardcoded into the sprite list | `SPRITE_NATION_PREFIXES` globs `conp_*`, `baseflag_conp_*`, `icon_flag_*` and `flag_ticket_*` at the root of `menu/Texture/`, so a mod's nations arrive without the extractor learning their names. On vanilla the glob finds exactly what the list already named, so nothing changes |
| `SPRITE_DIR_RENAME`, the one `Ammo/`-vs-`Weapon/` basename collision | `dir_glob_renames` computes the set per chain. EoD files a `Molotov.dds` under both; on vanilla the rule reproduces the two hardcoded rows exactly, which `tests/test_modmenu.py` asserts |
| `find_top` matching a `menu/InGame` group on signature **and** rect | Still exact for vanilla. For a mod's own file, two relaxations and no more: signature-only when it is unique in the file (EoD moved the weapon bar), and an empty group when nothing carries the signature at all (EoD has no CTF flag icon). Anything ambiguous still fails loudly |

`SKIN_NATION` grew the mods' armies, and not one row was guessed from a name.
Each is the nation the flag on that team's own control points resolves to,
counted over every extracted level — `game.setTeamSkin` in the level's
`Init.con` against the `flagMesh` of the control points it gives that team:

```
NVASoldier        flagge_m1 x233, flagjp_m1 x16   -> ger
VietCongSoldier   flagjp_m1 x165, flagge_m1 x19   -> jp
ARVNForces        flaguk_m1 x34,  flagus_m1 x1    -> brit
AustralianForces  flagso_m1 x16                   -> rus
SpecialForces     flagus_m1 x79                   -> us
ItalianSoldier    flagit_m1 x10                   -> it
FrenchSoldier     flagfr_m1 x13 (EoD) x2 (RtR)    -> fre
PathetLaosSoldier flagpl_m1 x11                   -> nothing: no conp_pl exists
```

EoD reuses vanilla's nation *codes* and repaints the slots, which is why its
armies map onto names that look wrong and are right: EoD's own `conp_ger` is
the North Vietnamese flag, `conp_jp` the Viet Cong one, `conp_brit` South
Vietnam's and `conp_rus` Australia's.

`flagMeshNation` is corrected per pack for the same reason. Vanilla aliases
`so` to `rus` because it ships no `conp_so`; EoD ships the whole `so` set, so
`flagso_m1` stops going through the alias there. (Its `conp_so` and `conp_rus`
are the same file, so the control-point marker is unchanged either way; the
base flag and the ticket flag, which do differ, get the faithful one.)

### The pack is the difference, and nothing else

`extract_hud_mods.py` runs the five extractors for a mod into a scratch
directory — which produces a *complete* pack, every sprite and layout whether
the mod changed it or inherited it — then compares every file against
vanilla's byte for byte and keeps only what differs.

| | files of its own | identical to vanilla | sprites overridden | added | inherited | spawn-screen strings changed | its own `menu/InGame`? |
|---|---|---|---|---|---|---|---|
| Eve of Destruction | 581 | 220 | 69 | 254 | 191 | 10 | yes |
| Road to Rome | 40 | 325 | **0** | 27 | 260 | **0** | no |
| Secret Weapons | 49 | 325 | **0** | 35 | 260 | **0** | no |

Road to Rome repaints nothing at all. Its 40 files are eight nation PNGs
(France and Italy across the four flag prefixes), nineteen roster icons, its
own `hud.json` and `minimap-icons.json`, its six level thumbnails, its
background plate and its two menu flags. Because its `menu/InGame` and its
`Font.rfa` are vanilla's, `spawn-layout.json`, `hud-layout.json` and every
font file come out byte-identical and are left out of the pack entirely — the
design costs a mod that overrides nothing exactly one failed `pack.json`
request.

`minimap-icons.json` is per-mod for a different reason: it is read from the
mod's own `Objects.rfa` chain. 110 templates in vanilla, 390 in EoD, 126 in
Road to Rome, 138 in Secret Weapons.

### How the page picks

`viewer/hud-pack.js`. One rule: a pack-relative path the mod's `pack.json`
lists resolves against the mod's directory, anything else against vanilla's.
So Road to Rome's own `hud.json` sits beside vanilla's fonts and vanilla's
spawn layout without either being copied. Vanilla fetches no manifest at all,
and a mod whose pack 404s — a tree published before this — resolves everything
to vanilla's, which is exactly the behaviour this replaced.

The console font is the one asymmetry: vanilla's stays at `viewer/fonts/`,
which is baked into the image, while a mod's has to travel with the mod and so
goes in the pack under `console/`. Only five of the 18 installed mods ship a
`Font.rfa` at all, and none of the three with level trees is one of them.

### Building and verifying

```bash
cd tools/bf1942-models
python3 extract_hud_pack.py                       # vanilla, unchanged
python3 extract_hud_mods.py --mod EoD             # -> maps/mods/eod/_shared/hud
python3 extract_hud_mods.py --mod XPack1
python3 extract_hud_mods.py --mod XPack2
```

The byte-identity check that has to keep passing: extract the whole vanilla
pack from `main`'s code and from the working tree into two scratch directories
and diff them. All 330 files matched on 2026-09-20.

### Still open

* Fifteen mods have no level tree yet, so no pack has been built for them.
  `extract_hud_mods.py --mod <name>` is all it takes once one exists.
* `PathetLaosSoldier` has no flag art anywhere; the run says so rather than
  inventing a row.
* `hud.js`'s `spriteKeyFromRef` resolves a live texture path by basename, so a
  directory-qualified sprite (`ammo_molotov`, `weapon_molotov`) is reachable
  only by its qualified name. Nothing binds one today; whoever wires the ammo
  panel's icon has to key on the source directory too.
