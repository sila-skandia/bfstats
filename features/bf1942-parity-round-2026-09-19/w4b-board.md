# W4-B — SCORE BOARD, and the minimap's zoom and rotating mode

Branch `w4/board-map`, worktree `bfstats-w4b-board`, port 5322. The stream was
picked up from a crashed agent: `viewer/bfmap.js` and its tests existed
uncommitted, nothing was wired, and the researcher's scoreboard page read was
lost. Both surfaces were re-derived here from the game's data and the client
(BF1942.exe, sha256 `60c9452d...cd3699`; `xref.py check` MATCH).

## 1. Minimap: zoom on N, rotating mode

### What is now true

- `N` steps the minimap through three zoom levels, wrapping 0 -> 1 -> 2 -> 0,
  eased. The closed HUD widget shows **0.659 / 0.287 / 0.125 of the whole
  map** at the three levels, centred on the player, with no stop at the map's
  edge.
- `game.setStaticMinimap 0|1` is a console word (read back with no argument),
  default 1. With 0 the art and every marker position turn about the player so
  his forward reads up and the arrow stays upright; with 1 the map is north-up
  under a turning arrow, as before.
- The open spawn map is untouched: whole map, north-up. Its open/close tilt now
  honours the same static byte (see "changed behaviour" below).

### The engine facts it rests on

| fact | evidence |
|---|---|
| `N` is `c_PIZoomMap`, non-repetitive | `Settings/Default/Controls/{Infantry,Land,Air,Common}.con`: `c_PIZoomMap IDFKeyboard IDKey_N c_CMNonRepetive` |
| three levels, `+0x48 = level + 0.5` | W4-F's read; the setter is 0x00467910 (`fld arg; fadd [0x008c4220]; fstp [ecx+0x48]`), the 0.5 read from 0x008c4220 (`0000003f`) |
| `+0x44` eases to `+0x48` at rate 6 and **snaps within 0.01** | `BfMap__animate` 0x00468fb0: `if (0.01 <= abs(+0x44 - +0x48)) ease(-6.0) else +0x44 = +0x48` |
| crop = `pow(2.3, (1-z) * [+0x44])`, 2.3 a double | ledger MMAP-1; 0x008d62a0 = `0000006066660240` |
| **the span is 1/crop of the whole texture** | `minimap_screenTransform` 0x00469360: `local_18 = cos(-[+0x64]) / (nodeWidth * crop)`, uv = centre + that times the offset from the widget's centre. Half the node's width therefore maps to 0.5/crop of uv |
| **the centre is the player, unclamped** | same function: `centre = (1-z) * ([+0x5c],[+0x60]) + z * 0.5`. `+0x5c/+0x60/+0x68` are stored together by the setter 0x00467810 (`ret 0xc`), whose only caller is the HUD frame at 0x006ada0f: position x `1.0 / worldSize` (1.0 at 0x008c53c8, size from `FUN_00442640`), v negated (`fchs`), heading by `fpatan` |
| rotation `+0x64 = (1-z) * wrapped(+0x68)`, no easing, static byte `+0x58` | ledger MMAP-2, re-read in 0x00468fb0 |
| the static byte's setter | 0x00467940: `mov [ecx+0x64],0; mov [ecx+0x58],al`; callers 0x006d563b, 0x006d5e65 |
| static is the shipped default | `game.setStaticMinimap 1` in `Settings/Default/GeneralOptions{Low,Medium,High}.con` and the `Default` and `Custom` profiles. The `skandia` profile on this machine has `0` — which is why the spawn-map reference capture shows the art tilting in |

The span and centre rows are new in this stream and **replace what the crashed
agent had written**: its module anchored level 0 to the widget's old 0.25 span
and called the absolute scale a viewer choice. The pointer transform shows the
crop is of the whole texture, so the scale is the engine's.

### How it is wired

- `viewer/bfmap.js` (pure): the counter, the ease with its snap, `crop`,
  `minimapSpan = 1/crop`, `mapCentre`, `displayRotation`, and the three draw
  helpers `minimapWindow`, `rotateAbout`, `coverRect`. 22 tests in
  `tests/test_bfmap.py` over `tests/bfmap_harness.mjs`.
- `viewer/map.html`: `KeyN` in the keydown handler after the console,
  Escape-menu and focused-control gates, beside `M`; `bfmap.update(dt)` in the
  frame loop; `drawMinimap` uses the live span (also in the repaint key) and
  `bfmap.rotation(0, cameraHeading())`; `paintMap` turns marker positions with
  `rotateAbout` and adds the turn to the two icons that show a heading (the
  player arrow, vehicle silhouettes); `drawArt` draws a turned or
  edge-overhanging window through `coverRect`. `game.setStaticMinimap` is
  registered on the console like the mouse-sensitivity words.
  `window.__bfmap` is exposed under `?shots`.

### Viewer choices (not dictated by the engine data)

- Flag plates stay upright on a turned map; only their positions turn. What
  the engine does to a flag icon's own orientation was not read.
- Past the map's edge the widget shows its backdrop. The engine samples past
  the texture; its addressing mode there was not read.
- The widget starts settled at level 0 instead of easing up from the
  constructor's 0.
- Marker sprite scale does not change with the zoom level.
- The canvas rotation is minus the engine's stored angle, so forward reads up
  (the convention the deploy transition already used).

### Changed behaviour to know about

- The default minimap now shows 0.659 of the map, not 0.25. That is level 0 of
  the engine's law; the old 0.25 sat between levels 1 and 2.
- The minimap no longer stops at the map's edge.
- The deploy open/close transition used to tilt the art by `(1-z) * heading`
  always. It now goes through `bfmap.rotation`, so under the default static
  map it is north-up throughout, and tilts only after
  `game.setStaticMinimap 0`.

### Unverified

- `BfMap__animate` also holds the rotation at 0 for the frame when `z < 0.8`
  and byte `+0xa9` of the object `playerManager` vtable `+0x18` returns is
  clear. What that byte is was not read; the viewer ignores the clause.
- The N-key increment of the level counter itself (W4-F left it open) was not
  located; the three levels and the wrap are W4-F's read, consistent with the
  `+0.5` setter.
- `BfMap__update` 0x0046a680 (the draw) is no longer defined in the shared
  Ghidra project, so the draw was not read directly; the span comes from the
  pointer inverse 0x00469360, which has to agree with the draw for a click on
  the map to land.

## 2. SCORE BOARD

### What is now true

`SCORE BOARD` on the spawn screen opens the game's board in place of the spawn
interface, and its red `DONE` gives the spawn screen back (Escape too). `Tab`
held over the live view shows the same page with `LOCK` on the button, and it
goes when the key does. The board is painted from the game's own page: plates,
icons, bitmap faces, lexicon strings and conditions.

### The page, as read from `menu/InGame`

One top-level entry: `TransformNode (0,-15) 800x800` whose first child is
`CullNode Scoreboard/SpawnScoreBoard` — entry 47 of 53, 290 nodes. There is no
second board page (the only other `Scoreboard*` groups are the map vote,
`ScoreboardMapVote/MapVoteActive`, and the in-game vote message). Dump it with
`extract_scoreboard_layout.py`; it flattens to 102 leaves:

- two panels, `Voting/scoreboard_512x470` at (10,45) and (409,45) in screen
  units: the side's name (`COL_HEADING_AXIS_TEAM` / `..ALLIED_TEAM`, Trebuchet
  MS18, black) and `Scoreboard/{Axis,Allied}RoundWon` right-aligned; a black
  and olive (0.52, 0.49, 0.30) heading strip with `COL_HEADING_PLAYER_NAME`,
  the `Menu/serverinfo/menu_icon_{score,kills,death,ping,ID}_16x16` icons and
  the side's ticket flag (`AxisTicketFlag` / `AlliedTicketFlag`); a
  `BfNewListBoxNode` on `Scoreboard/{Axis,Allied}ScoreboardList`, row height
  18, `standard6 - Latin`; scroll arrows and track under
  `Scoreboard/ShowScrollBar{Axis,Allied}`; a second strip (`TOTAL:`,
  `PLAYERS`, four icons) and the totals row
  `Scoreboard/{side}{Player,Score,Kills,Deaths,Ping}Total`.
- `Voting/scoreboard_buttonframe_780x64` (culled at end of round) with ADD
  BUDDY, DROP BUDDY, VOTE KICK, VOTE KICK (TEAM), MAP VOTE — all culled by
  `Scoreboard/GameStatusSinglePlayer`, each with a 0.5-alpha disabled twin —
  Kick / Ban under `Scoreboard/RemoteAdmin`, and the red `knappExt` button
  calling `Kit/DoneSpawnScoreboard`, labelled `RESPAWN_DONE` when
  `Scoreboard/FromSpawnScoreboard` and `SCOREBOARD_LOCK` otherwise.
- `ingame_serverIP_256x32` with `Scoreboard/ServerName`, `ServerIp`, `MapName`;
  `Voting/kick_mapmessage_long` with `Scoreboard/KickVoteActive`, multiplayer
  only.
- The deploy screen's button is one `BfButtonNode` calling
  `Kit/ScoreboardSpawnInterface` (W4-F, reconfirmed: the function name occurs
  once, in the spawn group).
- The held key: `c_PIShowScoreBoard IDFKeyboard IDKey_Tab c_CMPushAndHold` in
  the shipped `Infantry/Land/Air/Common.con`.

Tickets are not on the board. `ShowTicket` is its own top-level entry and
stays up; the board painter re-draws that group while it has the spawn chrome
hidden.

### The list box, read from the client

The rows and columns are not in the file.

- Columns: one function looks the two lists up (`AlliedScoreboardList` pushed
  at 0x006df9de, `AxisScoreboardList` at 0x006dfa30) and makes two identical
  runs of thirteen `addColumn` calls (`FUN_007d4240`, the int stored at column
  `+0x14`): 25, 150, 175, 210, 245, 280, 310, 355, 370, 385, 400, 415, 450,
  each run closed by `addColumnNoWidth` 0x007d42a0.
- List box draw, vtable 0x0093cde8 `+0x68` = 0x007d1390: cell text starts at
  `boxLeft + 10.0 + column int`; the first row's top is `boxTop + 2 x [+0x18]`
  with `+0x18 = 12.0` (ctor 0x007d1222); each row advances by the file's row
  height and the text is placed up from the row's bottom edge.
- Which column is what is **matched, not read**: `boxLeft + 10 + int` lands
  exactly one unit right of the heading strip's own label and of each of its
  five icons (asserted in `tests/test_scoreboard_layout.py`). So 25 name, 175
  score, 210 kills, 245 deaths, 280 ping, 310 ID.

### How it is wired

- `extract_scoreboard_layout.py` -> `<hud pack>/scoreboard/`
  (`scoreboard-layout.json`, 18 textures, 5 faces). A directory of its own: no
  existing manifest is rewritten. Vanilla's was extracted to scratch and copied
  into the shared tree as a new directory
  (`viewer/maps/_shared/hud/scoreboard/`, 268 KB); it is not yet published.
- `viewer/scoreboard.js` (pure): `boardRows`, `tallyFeed`, `boardVars`,
  `listGeometry`, `listFloor`, the leaf painter `paintLeaves`. 28 tests.
- `viewer/map.html`: the `#scoreboard` overlay, the pack loader, who is on the
  board, `setScoreboard(on, fromSpawn)`, the Tab and Escape hooks,
  `window.__scoreboard` under `?shots`.

### What it is fed

Only what the page has: the local player (`?name=`, default `Player`) on the
side chosen on the spawn screen (in a room, the side the server assigned), and
in a room the roster's other players by name and team. Kills and deaths are
tallied from the room's `killed` events; outside a room they are 0. Score,
ping and rounds won are always 0 — nothing tracks them. ID is the room slot,
blank outside a room. The ticket flags are the level's nations. Server name is
the room code, the address the page's host, both blank outside a room; the map
name is the level's. Single player outside a room, so the file itself culls
the multiplayer buttons.

### Viewer choices

- The spawn interface is hidden while the board opened from it is up. Inferred
  from the function pair and the `FromSpawnScoreboard` flag, not read.
- `AlphaFadeEffect` at level 0 is taken as invisible. Inferred: the faded BAN
  plate sits on ADD BUDDY's exact rect.
- Rows stop above the lower olive strip (20 rows). The engine's visible-row
  count (list data `+0x28`) was not read.
- Row text is white; sort is score, kills, fewest deaths, roster order; no
  highlight for the local player; a long name is cut at the next column.
- Text line top = row bottom - the face's line height. The draw subtracts a
  glyph metric from the row's bottom; which metric was not resolved.
- `LOCK` draws but does nothing. `Scoreboard/KickVoteActive` shows the file's
  own literal in a room.
- Tab does nothing over the spawn screen; Enter and the flag digits are
  ignored while the board stands in for it.
- Kills and deaths from the room feed count from when this client joined.

### Unverified

- What columns 0, 150 and 355..450 carry, and the row-fill code as a whole.
- In the list box draw the column int is reached through the list data's
  `+0x64`, which was not tied to the iterated column (`+0x54` vector) in the
  decompile; the one-unit match above is the corroboration.
- That Tab shows this same group: inferred from there being one board page and
  from `FromSpawnScoreboard`; the key's handler was not read.
- Not proven on the page in a room (no room server was run); the room path is
  covered under node only.
- Mods: a mod page falls back to vanilla's board. `extract_hud_mods.py` does
  not yet diff a mod's `scoreboard/` pack.

## 3. Proof

Suite: `python3 -m unittest discover -s tests` from `tools/bf1942-models` —
2,179 OK before (with the crashed agent's 17), **2,228 OK** after.

Captures (scratch, not committed), under
`/tmp/claude-1000/-home-dylan-projects-skandia-bfstats/b29687da-3eb7-4add-9356-e90bd7caa942/scratchpad/w4b/shots/`:

| file | what |
|---|---|
| `w4b-minimap-zoom{0,1,2}.png` | the widget canvas at each level, stepped by real `KeyN` presses; spans read back 0.6594 / 0.2867 / 0.1246, a fourth press wraps to 0, a press under the open console moves nothing |
| `w4b-minimap-static-heading.png`, `w4b-minimap-rotating-heading.png` | the same camera (`?cam=1250,160,-790,-2.0,-0.4`) before and after `game.setStaticMinimap 0` through the console's `executeLine` |
| `w4b-minimap-sheet.png` | the five side by side |
| `w4b-scoreboard-from-spawn{,-page}.png` | the board after a real mouse click on `#deploy-score`; rows read back as one Allied player, `fullmap` `visibility: hidden` |
| `w4b-scoreboard-done-hover.png` | the red button's mouse-over plate |
| `w4b-scoreboard-tab{,-page}.png` | Tab held over the live view after switching to Axis: `LOCK`, the player on the Axis panel; released, the board is gone; under the console Tab opens nothing |

To reproduce: serve `tools/bf1942-models/viewer` on 5322, open
`map.html?mod=bf1942&map=wake&shots&name=Skandia` under Playwright with
SwiftShader, `__warmup()`, then drive it with real `page.keyboard` /
`page.mouse` events, stepping frames with `__renderOnce(1280, 800)` (the deploy
close needs about 50 frames to land) and reading `minimap-canvas` /
`scoreboard-canvas` with `toDataURL`. `__bfmap`, `__scoreboard.rows()` and
`__console.executeLine` give the state. The two scripts used are
`w4b-minimap.mjs` and `w4b-scoreboard.mjs` in the scratch directory above.

## 4. Ledger rows to integrate

| # | Assumption | Status | Evidence |
|---|---|---|---|
| MMAP-1 | Minimap zoom (`c_PIZoomMap`, N) cycles fixed steps | **confirmed** (2026-09-21, supersedes the 2026-09-16 refutation) | Three levels. Setter 0x00467910 stores `+0x48 = arg + 0.5` (0.5 at 0x008c4220); `BfMap__animate` 0x00468fb0 eases `+0x44` to it at rate 6 and snaps within 0.01. `minimap_screenTransform` 0x00469360 maps an offset from the widget centre to uv as `offset / (nodeSize * pow(2.3, (1-z)*[+0x44]))`, so the closed widget spans 0.659 / 0.287 / 0.125 of the texture. Open: the N-key increment of the counter |
| MMAP-2 | Minimap rotation follows the player unless `game.setStaticMinimap 1` | **confirmed** (2026-09-21) | `+0x68` heading and `+0x5c/+0x60` player uv are stored by one setter 0x00467810, only caller the HUD frame 0x006ada0f (position x 1/worldSize, v negated, `fpatan`). Static byte `+0x58` set by 0x00467940, which also zeroes `+0x64` (callers 0x006d563b, 0x006d5e65). Centre = `(1-z)*player + z*0.5`, no edge clamp. Open: the `z < 0.8` / `+0xa9` hold |
| MEME-14 | The score board is one group of `menu/InGame`; its list columns are in the client | **confirmed by data** (2026-09-21) | Entry 47, `TransformNode (0,-15) 800x800` culling on `Scoreboard/SpawnScoreBoard`; `Scoreboard/FromSpawnScoreboard` swaps DONE / LOCK. Columns: two runs of thirteen `addColumn` `FUN_007d4240` (0x006dfa75..0x006dfb13, 0x006dfb33..0x006dfbd1): 25,150,175,210,245,280,310,355,370,385,400,415,450, then `addColumnNoWidth`. List box draw 0x007d1390: text at `left + 10 + int`, first row at `top + 2 x 12.0` (ctor 0x007d1222). Open: the row-fill code, the visible-row count |

Symbols: `0x00467810 BfMap__setPlayer(u, v, heading)`, `0x00467910
BfMap__setZoomLevel`, `0x00467940 BfMap__setStatic`, `0x007d4240
meme_ListBoxData__addColumn`, `0x007d1390 BfNewListBoxNode__draw` (names
descriptive, client is stripped).
