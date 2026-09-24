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

## 10. Adversarial review of section 9 (2026-09-20)

Section 9 was re-derived from the archives by a second pass. Vanilla holds:
the five extractors run from `main`'s code and from this branch's produce the
same 330 files, byte for byte, with and without `--mod bf1942`. The per-mod
counts hold too: 581 / 40 / 49 reproduced exactly, every file in each
`pack.json` on disk and every file on disk listed. Four things did not hold.

### `menu_001.rfa` — Road to Rome patches its menu and we were not reading it

`bf42/rfa.py` has known since it was written that a Refractor patch is
`<name>_001.rfa` layered over `<name>.rfa`, and `ArchivePool.add_dir`
registers patches first for `objects` and `standardMesh` everywhere. The menu
chain did not: `modmenu._archive_in` matched the exact filename and nothing
else. `XPack1/Archives/menu_001.rfa` (3,599 bytes, Jan 2004, the 1.6 patch) is
the one installed case, and it holds two files that are in **no other archive
of any installed mod**:

```
menu/Texture/Kits/Icon_assault_breda_axis_selected.dds
menu/Texture/Kits/Icon_medic_stengun_allies_selected.dds
```

`XPack1/_shared/loadouts.json` binds both by name. `_archives_in` now returns
the patch ahead of its base, so `MenuSources` for XPack1 opens
`menu_001.rfa`, `Menu.rfa`, `menu.rfa` in that order. Vanilla ships no
`menu_001.rfa` or `Font_001.rfa`, so a vanilla chain is still one archive and
its output is unchanged.

### `extract_hud_mods.py --mod bf1942` deleted the vanilla pack

`hud_dir_for("bf1942")` returns `viewer/maps/_shared/hud` — the shared tree
itself, and in a worktree a symlink into the main checkout. Running the pack
builder for `bf1942` compared the vanilla build against itself, found nothing
differing, and took the "this mod overrides nothing, remove its pack" branch:
`shutil.rmtree(out)`. Reproduced in a sandbox: 331 files in, directory gone.
The stale-file loop had the same shape, unlinking anything in `out` it had not
just written.

Now: building for `bf1942` is refused outright, building into a directory that
*is* the vanilla pack is refused, and the only files that may be removed are
the ones a previous `pack.json` in that directory claims. A directory with no
`pack.json` was not written by this script and nothing in it is touched.

### The mod did not survive the launch

`play/index.html` resolves its mod from `?mod=` alone. `START` built
`../map.html?map=…&team=…` and dropped it, so a level picked on Road to
Rome's Instant Battle screen was looked for in vanilla's tree unless
`localStorage` happened to hold the same choice. `map.html`'s new bare-map
redirect dropped it the same way, so `map.html?mod=xpack1` landed the player
on vanilla's level list. Both now carry `mod` (and so does the `game.disconnect`
word, which uses the same URL).

### `AustralianForces` flew the wrong flag on this screen

`SKIN_NATION` routed it through vanilla's `so -> rus` alias. That alias is
already switched off for the in-game HUD, because `flag_mesh_nations` sees
EoD's own `so` art and maps `so -> so` in its `hud.json`. The two flag
families are not interchangeable: `conp_so` and `conp_rus` are the same bytes
in EoD, but decoded, `icon_flag_so` is the Australian blue ensign and
`icon_flag_rus` is the Stars and Stripes. So on the 14 EoD levels with
Australians the Instant Battle screen drew a US flag beside Australia while
the ticket counter on the same level drew the Australian one. The row is now
`so`; the EoD pack gains `menu/textures/icon_flag_so.png` and goes 581 -> 582.

### Two defects left for the lead, not fixed here

**A mod's own kit photographs are never extracted.** `SPRITES` names the 15
vanilla `menu/Texture/Kits/*_selected` files and there is no glob for that
directory. EoD ships 87 kit photographs, every one under a nation
subdirectory (`Kits/NVA/assault_selected.dds`, `Kits/ARVN/medic_selected.dds`,
…) and **none** at the `Kits/` root, so the EoD pack carries no kit
photograph at all — its spawn screen shows vanilla's Wehrmacht and GI
pictures for NVA and Viet Cong kits. Secret Weapons ships six
(`Kit_AlliesAssault_Bren`, `Kit_AxisScout_G43`, …); Road to Rome ships the two
in its patch archive. Fixing it needs three things together: a glob over
`Kits/**`, the directory-qualified rename rule extended to it (87 files across
9 nations collide on basenames like `assault_selected`), and `map.html`'s
`kitPhoto()` — today a hardcoded `{jp,rus,can}` variant table — reading the
kit's own `icon` out of `loadouts.json`, which already records it.

**A team's nation is a property of the level, not of its soldier skin.**
`map.html` already gets this right: `teamNation()` tallies the level's own
control-point `flagMesh`. The Instant Battle screen instead maps
`game.setTeamSkin` through the global `SKIN_NATION`, and the two disagree on
**30 EoD team/level rows** and one vanilla one. Cross-checking every extracted
level's `scene.json` against its `Init.con`:

| level | team | skin | `SKIN_NATION` says | the level's own main base flies |
|---|---|---|---|---|
| `xa_loi_pagoda` | allied | `ARVNForces` | `brit` (South Vietnam) | `flagus_m1` (US) |
| `hidden_airfield`, `hill916`, `pushing_charly` | axis | `NVASoldier` | `ger` (NVA) | `flagjp_m1` (Viet Cong) |
| `the_bay`, `battle_of_can_tho`, `+6 more` | axis | `VietCongSoldier` | `jp` (Viet Cong) | `flagge_m1` (NVA) |
| `h_mong`, `ho_chi_minh_trail`, `laos_boundary_dispute` | axis | `PathetLaosSoldier` | (nothing) | `flagpl_m1` |
| `liberation_of_caen` (vanilla) | allied | `BritishSoldier` | `brit` | `flagcan_m1` (Canada) |

Reproduce with the script in this round's scratch, or by walking
`controlPoints[].flagMesh` per team out of each `scene.json`. Correcting it
means the menu screen deriving its two flags from the level the same way the
in-game screen does — which would also move vanilla's Caen, so it is the
lead's call, not a reviewer's.

**Where PathetLao actually lands.** The Instant Battle screen is safe: the
record carries `"flag": null` and `paintPreviewFlags` skips it, so no flag is
drawn. In-game is not: `cpNation()` falls back to `cp.team === 1 ? 'ger' :
'us'` for a code it does not know, and in EoD's repainted art `ger` is the
North Vietnamese flag. So a Pathet Lao base flies an NVA flag on the minimap
and in the ticket counter, silently, on three levels.

### The verifier keeps most of its teeth, and loses one case

Three deliberately broken models built in scratch from real vanilla exports:

* Thompson with its root scaled 2x -> **BROKEN** (`length 1.629 m vs 0.850 m
  real`).
* Willy with a `GeometryTemplate` its own part tree wants and nothing
  declares -> **BROKEN** (mesh file and geometry template unresolved).
* Sherman with every node transform zeroed — the total collapse —
  -> `origin_pile` names 26 parts.

The miss is the realistic one. Zeroing only the *body parts'* transforms
leaves 27 of them (all fourteen road wheels, `ShermanTower`, the hull hatch,
the pintle Browning) piled on the hull's own origin at y = -0.8 rather than
the scene origin. `main`'s verifier calls that **BROKEN**, exit 1; this one
calls it **ok**, exit 0. Two gates are responsible: `collapsed()` tests
`world_translation` against the *scene* origin within 1e-4, and the new
`model_size` centroid radius then drops the parts that do land there but are
authored in parent space. The centroid gate is not itself the problem — over
the four real catalogues it suppresses 0 vanilla, 0 XPack1, 0 XPack2 and 10
EoD readings, and the 10 are genuine false alarms (`BTR60CockpitExternal`
instanced five times at the hull origin, `EoD_HueyRocketPods`,
`LVT4_SprocketGuide`). The anchor is. A collapse onto a parent that is not at
the scene origin is invisible to both readings, and `main` caught this one
only by accident, through the three parts that happened to sit at zero.

Everything else about the verifier checked out: the four catalogue tallies
reproduce exactly (94/2/0 exit 0, 221/56/8 exit 1, 13/2/0 exit 0, 25/4/0 exit
0), node classification really does read the exporter's extras and not names
(the one documented exception is `is_collision`'s name fallback for older
`.glb` files; `SILHOUETTE_AUTHORED` and `MATERIALS_WITHOUT_SHADER_AUTHORED`
are name-keyed vanilla-fact tables, gated off for mods), and two of the eight
EoD verdicts were re-derived against EoD's own `.con` files: `Cammo_Raft`'s
`CammoRaftEngineModel` declares `ObjectTemplate.geometry CammoRaft_Motor_M1`
and no `GeometryTemplate.create` anywhere in the chain declares it (while its
siblings `Cammo_Hull_M1` and `USRaft_prop_M1` are declared, so the check
discriminates); `M79`'s `M79`, `remingtonMag` and `remingtonTrigger` are
likewise referenced and never declared.

## 11. A team's nation belongs to the level (2026-09-20)

Section 10's two defects left for the lead, closed.

### The rule, in one place

`viewer/map.html` already derived a side's nation correctly in-game
(`teamNation`/`cpNation`): the flag its own control points fly, read through
`hud.json`'s `flagMeshNation` table. The Instant Battle screen derived it a
different way — `game.setTeamSkin`'s soldier skin through the global
`SKIN_NATION` table — and the two disagreed wherever a mod reused a skin
across levels that fly different flags.

The flag-mesh-to-nation rule already lived in exactly one place —
`extract_hud_pack.py`'s `FLAG_MESH_NATION`/`MOD_FLAG_MESH_NATION`/
`flag_mesh_nations`, written into every pack's own `hud.json` — so nothing
new was invented for it. `extract_hud_pack.py` gained one small sibling,
`flag_mesh_nation(flag_mesh, nations)`: the single regex
(`^flag([a-z]+)_`) both sides now run.

- **`viewer/nation.js`** (new module, `three`-free): `flagMeshNation`,
  `cpNation`, `teamNation`, extracted verbatim out of `map.html` (which now
  imports them and feeds its own state — `hudPack.nations`,
  `extras.controlPoints`, the vehicle-based guess — through two four-line
  wrappers). Nothing else in `map.html` changed; every other caller of
  `cpNation`/`teamNation` is untouched.
- **`extract_menu_layout.py`** gained `load_flag_mesh_nations(mod_id)`
  (reads the mod's own already-extracted `hud.json['flagMeshNation']` —
  the identical file the page fetches, not a re-derivation of it) and
  `team_nation_from_level(gameplay, team, nations)`: the team's uncapturable
  main base first, otherwise the majority of the flags it starts holding,
  reading `bf42.level`'s `GameplayObjects` the same way
  `extract_map.py`'s `_control_point_report` does (a placement's own team
  override, the template's team-less `flag_mesh()`) so this can never
  derive a different answer than what ends up in the level's own
  `scene.json`. `level_record` tries this first and falls back to
  `SKIN_NATION` only when it answers `None` — no gameplay data, the team
  holds nothing, or every flag mesh it holds is unmapped. Each side's
  record now carries `nationSource`: `"level"` or `"skin"`.

A tie — more than one uncapturable main base, or an even split with none —
keeps the first nation encountered walking the control points in file
order, matching `viewer/nation.js`'s `Map`-tally tie-break
(`count > tally.get(best)`, strictly greater). This was a real bug caught
while cross-checking the rule against the whole corpus, not a design
choice: sorting the tie alphabetically instead picked a different nation
for one EoD level (`no_where_to_run`, below) than `map.html`'s plain
majority did. With the fix, walking every vanilla and EoD level and
comparing `team_nation_from_level`'s main-base-first answer against plain
majority finds **zero** cases where the priority rule changes the outcome
— it is kept because the task specifies it and because a future level
could need it (a lone strong main base outvoted by several minor points),
not because any installed level currently exercises the distinction. That
also means `viewer/nation.js`'s `teamNation` did not need the main-base
priority added to it: it is still the plain majority it always was, plus
the `'unknown'` fallback below.

### The Pathet Lao fallback

`flagpl_m1` (Eve of Destruction's Pathet Laos army — `h_mong`,
`ho_chi_minh_trail`, `laos_boundary_dispute`) is a real flag mesh no
installed `menu.rfa` ships art for. The old fallback chain
(`cpNation`/`teamNation`) ended in `team === 1 ? 'ger' : 'us'` regardless of
*why* it got there — a mesh this pack has no art for, or a control point
with no mesh at all (Kasserine's five flagless zones) — and in EoD's
repainted table `ger` is the North Vietnamese flag, so a Pathet Lao base
silently flew NVA colours on the minimap and the ticket counter.

`viewer/nation.js` now tells the two apart:

- **No mesh at all** (`cp.flagMesh` falsy — Kasserine): keeps the founding
  guess, `cp.team === 1 ? 'ger' : cp.team === 2 ? 'us' : null`. This is a
  real, deliberate answer for a WWII map with no flag cloth to read, not a
  placeholder — removing it would have drawn Kasserine's owned-but-flagless
  points as neutral, a regression `test_menu_layout.py`'s
  `LevelNationFromArchivesTests.test_kasserine_is_unchanged_via_the_skin_fallback`
  guards from the Python side (nothing in `map.html` reads Kasserine's
  flagless points through `cpNation`'s fallback in a way this round
  touched, but the same principle governs both).
- **A mesh that IS there but unmapped** (`flagpl_m1`): answers `'unknown'`,
  never the founding guess.

`teamNation`'s own final fallback moved from `team === 1 ? 'ger' : 'us'` to
`'unknown'` too, so a team with no flagged control points and no matching
vehicle (`nationFromVehicles`) answers honestly rather than guessing.
`'unknown'` is truthy, so it wins a majority vote outright when every flag
a team holds is unmapped (all three Pathet Lao levels), rather than falling
through to a vehicle guess or a team-number coin flip.

Every consumer of `teamNation`/`cpNation` already tolerates this without
further changes:

- **Minimap control point icons** (`drawControlPoint`): explicitly treats
  `'unknown'` the same as no nation — `conp_neutral`, the pack's own stand-in
  for a point nobody can be shown to hold, never another nation's flag.
- **The ticket counter flag** (`ticketFlagTexture`/`feedTicketVars`) and
  **the deploy screen's team flag tabs** (`deployTexture`'s
  `ChangeTeam/AxisTeamFlag`/`AlliedTeamFlag`): both build a sprite name by
  string interpolation (`flag_ticket_unknown.tga`, `icon_flag_unknown`).
  Neither name is ever in any installed pack, so `sprite()`'s plain `Map`
  lookup returns `null` and the picture leaf's `if (!img) break;` already
  skips drawing — no new code needed at either site, and no throw either
  way.
- **The Instant Battle preview flags** (`viewer/play/`): were already safe
  — a level whose extracted record has no nation carries `"flag": null` and
  `paintPreviewFlags` already skips a null flag. Unchanged.
- The four *non-flag* fallbacks that also call `teamNation`
  (`spawnSoldierUrl`'s weapon/soldier defaults, `weaponTemplateFor`,
  `soldierTemplateFor`, `stanceNation`'s icon-set choice) already OR their
  own `team === 1 ? ... : ...` default onto the result, so `'unknown'`
  degrades through them exactly the way `null` used to — none of them
  needed a change, and none of them is a flag.

### Vanilla: only Liberation of Caen's Allied side moves

```
python3 tools/bf1942-models/extract_menu_layout.py --out <dir>
```

Re-run for vanilla from `main`'s code and from this branch into two scratch
directories, `menu-levels.json` is otherwise byte-identical; the one
changed record:

| level | team | skin | was (`SKIN_NATION`) | is (the level's own flag) |
|---|---|---|---|---|
| `liberation_of_caen` | allied | `BritishSoldier` | `brit` | `can` (`flagcan_m1`, its uncapturable `Canadian_Base`) |

The pack ships `icon_flag_can`/`conp_can` (vanilla's own `NATIONS` tuple
always has, for Canada's five vanilla levels), so the corrected flag
renders. Axis is unchanged: its five points are all `flagge_m1`, no marked
main base, majority decides, and the level's own answer (`ger`) agrees with
the skin. Every other one of the 23 vanilla levels — `LevelRecordTests`'
existing assertions for `midway`/`berlin`/`el_alamein` included — is
unchanged, checked exhaustively (every level, both sides) in
`LevelNationFromArchivesTests.test_no_other_vanilla_level_moves`.

### Eve of Destruction: 13 rows move, not 30

```
python3 tools/bf1942-models/extract_menu_layout.py --mod EoD --out <dir>
```

Re-run the same way for EoD (239 levels), walked exhaustively (every level,
both sides — the script this ran is
`EodLevelNationTests.test_exactly_thirteen_eod_rows_move` in
`tests/test_menu_layout.py`):

| level | team | skin | was (`SKIN_NATION`) | is (the level's own flag) |
|---|---|---|---|---|
| `xa_loi_pagoda` | allied | `ARVNForces` | `brit` | `us` (`flagus_m1`, its uncapturable `ARVN_Base`) |
| `hidden_airfield` | axis | `NVASoldier` | `ger` | `jp` (`flagjp_m1`) |
| `hill916` | axis | `NVASoldier` | `ger` | `jp` (`flagjp_m1`) |
| `pushing_charly` | axis | `NVASoldier` | `ger` | `jp` (`flagjp_m1`) |
| `the_bay` | axis | `VietCongSoldier` | `jp` | `ger` (`flagge_m1`) |
| `battle_of_can_tho` | axis | `VietCongSoldier` | `jp` | `ger` (`flagge_m1`) |
| `dak_pek` | axis | `VietCongSoldier` | `jp` | `ger` (`flagge_m1`) |
| `ghost_town` | axis | `CivilVC_Soldier` | `jp` | `ger` (`flagge_m1`) |
| `last_man_standing` | axis | `VietCongSoldier` | `jp` | `ger` (`flagge_m1`) |
| `mono_lake` | axis | `VietCongSoldier` | `jp` | `ger` (`flagge_m1`) |
| `nui_pek` | axis | `VietCongSoldier` | `jp` | `ger` (`flagge_m1`) |
| `riverrun` | axis | `VietCongSoldier` | `jp` | `ger` (`flagge_m1`) |
| `snipers` | axis | `VietCongSoldier` | `jp` | `ger` (`flagge_m1`) |

`h_mong`, `ho_chi_minh_trail` and `laos_boundary_dispute` (Pathet Lao) do
**not** move: both the old path (`SKIN_NATION` has no `pathetlaossoldier`
row) and the new one (`flagpl_m1` unmapped) answer `None`, so
`"nation": null, "flag": null` is unchanged — the run still says so rather
than inventing a row, now via `team_nation_from_level` finding nothing
first rather than `SKIN_NATION` finding nothing at all.

`no_where_to_run` does **not** move either, but it is the one level in
either corpus where the main-base tie-break in `team_nation_from_level`
actually fires: EoD gives its axis two uncapturable bases of different
nations, `Vietcong_Base` (`flagjp_m1`) and `Vietcong_Platoon`
(`flagge_m1`). Encounter order keeps the answer `jp`, agreeing with both
`SKIN_NATION`'s existing guess for `VietCongSoldier` and with
`viewer/nation.js`'s plain-majority `teamNation` — the case that caught the
alphabetical-tie-break bug during verification (see above).

**This is 14 corrected rows total (13 EoD + Liberation of Caen), not the
30 section 10 estimated.** That estimate was explicitly a partial one
("`the_bay`, `battle_of_can_tho`, `+6 more`" — eight, where the exhaustive
walk finds ten in that direction) and was never itself reproduced by a
script; this section's numbers are the output of
`EodLevelNationTests.test_exactly_thirteen_eod_rows_move`, run against the
real, already-extracted archive tree on this machine, and are the ones to
trust. Marking the "30" UNVERIFIED per the round's own rule on claims,
rather than repeating it.

### Tests

`python3 -m unittest discover -s tests` from `tools/bf1942-models`: **1,830
green**, up from 1,794 at branch start (36 new: 9
`TeamNationFromLevelTests`, 2 `LoadFlagMeshNationsTests`, 3
`LevelNationFromArchivesTests`, 6 `EodLevelNationTests` — all against the
real installed archives — in `tests/test_menu_layout.py`, and 16 in the new
`tests/test_nation_js.py`, node-harness-driven per the existing
`hud-pack.js` pattern). `NationParityTests` in `test_nation_js.py` is the
test the round asked for explicitly: it feeds `extract_hud_pack.flag_mesh_nation`
and `extract_menu_layout.team_nation_from_level` the exact same tables and
control-point fixtures `nation_harness.mjs` feeds `viewer/nation.js`, and
asserts the two sides answer identically — `xa_loi_pagoda`,
`liberation_of_caen`, `no_where_to_run`'s tie and the Pathet Lao levels
included.

### Lead's correction at merge: silence is not "unknown"

As written, `teamNation`'s last fallback became `'unknown'`. That is right for
a side whose own flags are unmapped (Pathet Lao) and wrong for a side with no
flag evidence at all: the Americans hold no flag at the start of Omaha Beach,
Iwo Jima, Coral Sea, Midway or Truk, Kasserine Pass's zones are flagless, and
`nationFromVehicles` only ever names jp, rus or brit - so the US and German
ticket flags would have vanished from six vanilla levels. `'unknown'` now wins
only when the side's flags vote for it; no evidence keeps the founding pair
(team 1 ger, team 2 us), exactly as `main` did. Pinned by
`test_no_flag_evidence_keeps_the_founding_pair_not_unknown`.

## 12. Mod kit photographs (2026-09-20)

The first of section 10's "two defects left for the lead", closed: a mod's
own kit photographs are now extracted, packed and drawn. The second
(a team's nation is a property of the level, not of its soldier skin) is
untouched — out of this stream's scope.

### The extractor

`SPRITE_DIR_GLOBS` gains `Texture/Kits`, walked recursively rather than the
one level the other three need, because a mod's own kit art sits one
directory deeper than vanilla's: Eve of Destruction's 87 photographs are
one per nation subdirectory (`Kits/NVA/assault_selected.dds`,
`Kits/Vietcong/...`), none at the root vanilla's 15 occupy alone. Basenames
collide across those subdirectories by the dozen (`assault_selected.dds`
under eleven of them), so `dir_glob_renames` was generalized to qualify a
collision by each file's own **immediate parent directory** rather than a
name hardcoded per top-level glob entry. For the existing flat `Ammo`/
`Weapon` case those are the same name, so vanilla's manifest — and the two
rows `tests/test_extract_hud_pack.py` already asserted — are unchanged; for
`Kits/<Nation>/assault_selected.dds` it produces `nva_assault_selected`,
`vietcong_assault_selected`, and so on. `extract_sprites` skips a
glob-derived name already written by the `SPRITES` pass, so vanilla's 15
individually verified `ref` values are never clobbered by the glob's generic
ones.

Verified against the installed archives:

* Vanilla's 260-sprite manifest, extracted with `main`'s code and with this
  branch's, is byte-identical — `diff -r` on the two output directories
  finds nothing.
* Eve of Destruction gains exactly its 87 (`arvn_at_selected`,
  `nva_assault_selected`, `vietcongfemale_scout_selected`, ... down to the
  handful with no collision at all, `bean_selected`, `rambo_selected`,
  `russian_advisor_selected`), zero removed, zero existing entries changed.
* Road to Rome (`XPack1`) gains its two 1.6-patch icons,
  `icon_assault_breda_axis_selected` and `icon_medic_stengun_allies_selected`
  (reachable in the archive chain since section 10's `menu_001.rfa` fix;
  never packed until now).
* Secret Weapons (`XPack2`) gains its six own
  (`kit_alliesassault_bren`, `kit_alliesengineer_auto5`,
  `kit_alliesmedic_sten`, `kit_axisassault_g42`, `kit_axisengineer_glauncher`,
  `kit_axisscout_g43`).

`extract_hud_mods.py`'s pack counts, run against a scratch vanilla baseline
(so the diff reflects only this change, not tree drift): EoD 582 -> 669
files, XPack1 40 -> 42, XPack2 49 -> 55 — each delta is exactly the sprites
above, nothing else moved.

### The page

`viewer/kit-icon.js` is the new pure module: `kitIconCandidates(path)` takes
a `_shared/loadouts.json` `kitIcon.icon` value — the raw
`ObjectTemplate.setKitIcon` path, casing and declared extension both
untrustworthy — and returns, most specific first, the sprite keys the pack
might have filed it under (the directory-qualified name, then the bare
basename). `resolveKitIcon(path, has)` tries each in turn against a loaded
pack. Node-tested in `tests/kit_icon_harness.mjs` /
`tests/test_kit_icon_js.py` (13 cases: nested and root paths, casing,
backslashes, no-extension, degenerate input, and the resolve-against-a-pack
behaviour itself).

`map.html`'s `kitPhoto()` now resolves the row's own bound kit first —
`kitLoadout(team, role)` (already used for the weapon and health-bar art)
gives the kit template, `loadouts.kits[kit].kitIcon.icon` gives its path, and
`kitIconCandidates` gives the keys tried against `hudPack.sprites` (mod's own
pack first, vanilla's fallback beneath it, the way every other sprite on the
page already resolves). Only when the loadout, the icon field or the packed
sprite itself is missing does it fall through to the old hardcoded
`{jp, rus, can}` guess — now truly a fallback rather than the only path.

### Verified on the page

Driven through a scratch overlay (the shared `viewer/maps` tree symlinked
whole except `maps/mods/eod/_shared/hud`, which was populated with this
branch's freshly extracted, not-yet-merged EoD pack — see
`tools/bf1942-models/link_viewer_assets.sh`'s comment on why `--out` can
never point through the shared tree, and section 9's "Building and
verifying" for the pattern), `map.html?mod=eod&map=a_shau&shots` with the
page's `kitPhoto()` called directly for all five rows on both teams:

| team | scout | assault | antitank | medic | engineer |
|---|---|---|---|---|---|
| axis (Vietcong-skinned) | `vietcong_rifleman_selected` | `vietcong_assault_selected` | `vietcong_scout_selected` | `vietcong_at_selected` | `vietcong_engineer_selected` |
| allied (Special Forces) | `specialforces_rifleman_selected` | `specialforces_assault_selected` | `specialforces_scout_selected` | `specialforces_at_selected` | `specialforces_engineer_selected` |

(The antitank/medic rows resolving to the `scout`/`at`-named kit is
`kitLoadout`'s own class-label fallback when a level does not bind a kit at
that exact slot — pre-existing behaviour, unrelated to this change.) Every
sprite key above is one this branch's extraction newly added; before it,
all ten resolved to vanilla's `icon_*_axis_selected` /
`icon_*_allies_selected` — the reported bug, reproduced and now fixed.

`map.html?mod=bf1942&map=wake&shots` against the same overlay (unmodified
vanilla pack) reproduced the exact theatre variants the old hardcoded table
special-cased — `icon_assault_jap_selected`, `icon_engineer_usmarines_selected`
— but now out of the real per-kit data path rather than a `{jp, rus, can}`
lookup keyed on the caller's `nation` argument (called with `nation`
undefined in this check, to prove the fallback table was not the one
firing). Console and network were clean of anything but a pre-existing,
unrelated 404 (`_shared/effects.glb`/`effects.sounds.json`, missing for EoD
in this tree already, nothing to do with kits).

### Tests

`tools/bf1942-models/tests/test_modmenu.py`'s new `KitPhotographExtractionTests`
(4 cases, gated on the installed archives like its neighbours): a nation
collision qualifies by directory, vanilla's 15 keep their `SPRITES`-verified
`ref`, vanilla's own Kits glob adds nothing, Road to Rome's patched icons are
packed. `tests/test_kit_icon_js.py` (13 cases, above). Full suite: 1,811
green (was 1,794 at the start of this round), 0 skipped, `python3 -m
unittest discover -s tests` from `tools/bf1942-models`.

### For the lead, after merging

```bash
cd tools/bf1942-models
python3 extract_hud_pack.py                       # vanilla: unchanged, 260 sprites
python3 extract_hud_mods.py --mod EoD              # -> maps/mods/eod/_shared/hud, 669 files (was 582)
python3 extract_hud_mods.py --mod XPack1           # -> maps/mods/xpack1/_shared/hud, 42 files (was 40)
python3 extract_hud_mods.py --mod XPack2           # -> maps/mods/xpack2/_shared/hud, 55 files (was 49)
```

Only the three mod packs' `pack.json` and their new PNGs change; vanilla's
pack is untouched (confirmed by the byte-identical diff above, so a
re-extract is not required for correctness, only to pick up any drift
between rounds).

## 13. A taken point flies the taker's flag on the map (2026-09-24)

The owner: "When you cap a flag off an enemy, the flagpole shows your team
flag, but the mini map / spawn map does not. It shows the enemy flag, even
though you can spawn into it."

`drawControlPoint` picked the sprite with `cpNation(cp)`, and `cpNation`
reads the point's `flagMesh` -- the mesh the level baked for the side that
held the point when the level loaded. A capture changes `cp.team`
(`capture.js` `hoistCaptureFlag` syncs `extras.controlPoints`), never the
mesh, so Gazala's Dabir (`AXIS_village`, `flagge_m1`) went on drawing
`conp_ger` for the British who had just taken it. Two more faults of the same
kind came with it:

- `teamNation` tallied the live `cp.team`, so a side's nation could move with
  its captures: Omaha's Americans taking one German bunker counted a German
  vote and could start flying German cloth, ticket art and fallback sleeves.
- `hoistCaptureFlag` returned before syncing the map entry when the point had
  no pole (Kasserine's flagless zones), so their markers never changed hands.

The fix is one idea: a point's mesh belongs to its **founding** owner.
`hoistCaptureFlag` stamps `foundingTeam` on the entry before its first write
(and syncs the map before the pole lookup); `nation.js` gained `meshTeam(cp)`
(`foundingTeam ?? team`) and `heldNation(cp, nations, nationOf)` -- the mesh's
nation while its founding side holds the point, else the holder's own
`teamNation` -- and `teamNation` counts each mesh for the side it was made
for. `map-surfaces.js` draws `heldNation`. So a neutral El Alamein outpost the
British take flies the British flag (not the founding pair's American one),
and the pole's cloth (`flagUvCellFor`, through `teamNation`) keeps agreeing
with the map.

Verified headless on Gazala (`botCount=0`, the human on Allies standing on
Dabir): neutralised at t+15 s, captured at t+21 s, and `__mapMarks().points`
(new: the sprite each point draws) reads `conp_ger` -> `conp_neutral` ->
`conp_brit`. `tests/test_nation_js.py` covers the taken, retaken, neutralised
and untouched cases and a capture leaving both sides' nations alone.
