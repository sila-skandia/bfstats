# The front end's second tab: MULTIPLAY

Asked 2026-09-22. The play site's way in was Singleplayer > Instant Battle
with a small DOM panel bolted to the corner for the room server
(`viewer/play/rooms.js`, "PLAY ONLINE"). The ask: make the way in the game's
own front end — a SINGLEPLAY tab holding Instant Battle, unchanged, as the
default, and a MULTIPLAY tab laid out like the game's server browser, with
the room server's rooms in the list.

Two narrowings came with it, both the user's:

- **No filters.** "It'll be 1 server, maybe 2 at most — so just remove
  filter and show the table, and remove the filter strip in the table as
  well." The CUSTOM FILTER and CONNECTION SPEED panels and the per-column
  filter strip are not drawn.
- **CREATE GAME is: pick a map, START.** "In the real game you can select
  multiple maps by adding them to the list — but I'm not sure we support
  that. For now one map, with all defaults is enough. Just server name and
  max players looks good."

Done. Screens: `?tab=multiplay` on the play page.

## What the screen is

Everything drawn is the shipped file, painted leaf by leaf onto the same
canvas the Instant Battle screen uses. There is no CSS that resembles the
game.

| Piece | File |
|---|---|
| Tab strip — SINGLEPLAY, MULTIPLAY | `menu/MainMenuNavigation` |
| The row under it — CREATE GAME | `menu/MultiplayerNavigation` |
| The server browser | `menu/InternetMenu` |
| JOIN | `menu/InternetNavigation` |
| CREATE GAME | `menu/CreateGameMenu` + `menu/CreateGameMenuPage1` |
| START INTERNET | `menu/CreateGameNavigation` |
| Background | `menu/Background` |

`tools/bf1942-models/extract_main_menu_layout.py` flattens all of them into
`viewer/maps/_shared/hud/menu/main-menu-layout.json` (316 elements, 45
textures, 3 faces). `viewer/play/nav-strip.js` draws the two button rows,
`viewer/play/multiplay.js` the screen, `viewer/play/menu-pack.js` is the
image/font/tint cache both share with `skirmish.js`.

### Where the strip sits

`Navigation/NavigationY` is the whole strip's Y and the file holds all three
of its values — 85 one level in, 58 two, 33 three. Nothing in a page says
which level *it* is (the engine writes the variable on the way in), so the
extractor settles it at 33, which is where both of this site's screens live:
tabs at 33, the sub-row at 59, and the page's own plate from 125 down —
exactly where `menu/SkirmishMenu` and `menu/InternetMenu` both start.

### Which tab is lit

The file's own doing. Each tab carries a second, 0.6-alpha black copy of
itself gated on `Navigation/Level1/MouseClickedIndex ne <its index> and
Navigation/NavigationY lt 74`, so the strip darkens every tab but the chosen
one. That condition is the **only** place a tab's number appears, and it is
not the tab's position: SINGLEPLAY is 2 and MULTIPLAY is 1. `navSlots` reads
it out rather than counting.

## What is *not* drawn, and why

| Left out | Why |
|---|---|
| OPTIONS, CUSTOM GAME, INTRO, CREDITS tabs | The site answers for none of them. A tab that goes nowhere is worse than a tab that is not there. |
| INTERNET, LOCAL, RENT SERVER | The room server is one list, not two, and nothing here rents a server. CREATE GAME moves to the row's first slot. |
| REFRESH, STOP, APPLY/CLEAR FILTER, ADD FAVORITE, ADD SERVER | The lobby polls itself every 3 s; the rest are the filter's. |
| CUSTOM FILTER and CONNECTION SPEED panels | A handful of rooms needs no filter, and the line speed configures nothing. |
| The per-column filter strip | Same. Its going is what lets the rows start at the top of the list box the way the file puts it. |
| PunkBuster badge and tick, GameSpy logo | Neither is running here. Drawing them would be a claim, not a decoration. |
| The `?` legend button | It opens a legend for an icon column the room list has no icons for. |
| SERVER INFO drawer and its handle | The rules and player tables the engine fills from a server's own reply; the lobby carries neither. |
| GAME TYPE list, SELECTED LEVELS rotation, and the arrows between them | One room, one level, the level's own default game type. |
| The other fourteen CREATE GAME settings, and page two | Password, round time limit, tickets, friendly fire, AI skills — the dedicated server's, and `RoomServerCore` takes none of them. |
| START LOCAL | There is one room server and it is this origin. |

## What the rows are

`GET /netcode/rooms` answers `{rooms: [{code, level, mode, players, max}]}`,
polled every 3 s. Per column:

| Column | From |
|---|---|
| SERVER | `code` — a room's code is its address; that is what another player types |
| PLAYERS | `players`/`max` |
| PING | `-` — the room server is this origin |
| GAME TYPE | `mode`, which `Room.mode()` reads off the level |
| MAP | the level's `lexiconAll.dat` title, joined through `menu-levels.json` |

The column heads sort, with the file's own arrows and its own
`Headings/Flags/*` conditions. The bar under the list is the engine's
selected-server readout and carries the highlighted room's code, level and
occupancy. The footer counts are the file's `Join/NumServers` /
`Join/TotServers` / `Join/NumPlayers`.

JOIN and a row's double click go to
`map.html?room=<code>&name=<name>&map=<level>`. The level has to travel:
`map.html` sends anything that names no level straight back to the front end
(its `MENU_URL` redirect), so a bare `?room=` never gets as far as asking.
The room server's word still wins — the HELLO carries the room's level and
the page switches to it.

CREATE GAME picks a level and a six-character code and goes to the same
page; the room is made by the first client to name a code the server has no
room for.

## The player's name

`?name=`, else the last one used (`localStorage`), else `Player`. The game
keeps it in `menu/MainMenu`'s PROFILE panel, which this front end does not
draw yet — that page decodes clean, so it is a tab away when it is wanted.

## Reader work this needed

Three fixes in `bf42/meme.py` and `extract_menu_layout.py`, all of them
load-bearing for this screen and all of them verified against the shipped
archives rather than assumed. The first is a ledger row (MEME-15); the other
two are the flattener's, not the reader's.

1. **`BfTransformNodeSize`'s field order** (MEME-11's open remainder, now
   closed). It is `BfTransformNode`'s mirror: the *size* is the pair of data
   objects and the position is the pair of floats, so the floats come first
   on the wire. Read the other way round the two floats were eaten as an
   object frame and the next symbol index was garbage —
   `menu/InternetMenu` and `menu/LocalMenu` were the two pages in 236 that
   crashed the reader. Pages that read to zero leftover bytes went from 110
   to **137 of 236**, and nothing crashes.

2. **Variable transforms were not walked.** `Flattener` knew
   `TransformNode` (all floats) and nothing else, so `BfTransformNode` and
   `BfTransformNodeSize` moved no origin and set no rect — every leaf under
   one drew at the page origin. The tab strip is a `BfTransformNode` at
   `Navigation/NavigationX/Y`, so it drew at (0,0). The Instant Battle pack
   is byte-identical before and after: it has none.

3. **`AddData` / `SubData` were not evaluated.** A front-end page lays
   itself out with the engine's arithmetic nodes:
   `menu/InternetMenu` puts the selected-server bar at
   `Join/ServerListHeight + Join/ServerInfoPosY` and gives the scroll track
   `Join/ScrollbarHeight - 23`. Read as plain values each is `None`, so the
   bar collapsed to the top of the page over the INTERNET GAME heading and
   the track was zero high.

One thing is still inferred rather than read: **where
`menu/CreateGameMenuPage1` sits inside the CREATE GAME plate.** The page is
placed by `menu/CreateGameMenuPageLayer`, a `PathNode`, which `meme.py` has
no schema for. The offset used is the plate's own origin (25, 125), which
lands the page's labels at x 42 — exactly where the plate's own CREATE GAME
heading sits. Good enough to be almost certainly right, not read, so it is
recorded here and in the ledger.

## Where the code is

```
tools/bf1942-models/
  extract_main_menu_layout.py    the pack
  extract_menu_layout.py         decode_page tops, coord(), measure_rows()
  bf42/meme.py                   BfTransformNodeSize
  viewer/play/
    index.html                   the two canvases and the tab switch
    nav-strip.js                 the button rows
    multiplay.js                 the server browser and CREATE GAME
    menu-pack.js                 the shared image/font/tint cache
    skirmish.js                  + `tabs`, unchanged otherwise
  tests/
    test_main_menu_layout.py     the pack, against the installed game
    test_nav_strip.mjs           the strip, under node
```

`viewer/play/rooms.js` is gone — the DOM panel it was is now the screen.

Regenerate the pack with:

```bash
python3 tools/bf1942-models/extract_main_menu_layout.py
```

`viewer/maps` is gitignored; the pack ships to `mesh.bfstats.io` through the
`bfstats-mesh-assets` publish path like every other extracted asset.

## Still open

- The PROFILE page (`menu/MainMenu`), for setting the player's name in the
  front end instead of through `?name=`.
- A `PathNode` schema, which would settle the CREATE GAME page offset above
  and unlock the other layered pages (OPTIONS, CONTROLS, the CREDITS roll).
- `menu/LocalMenu` now decodes too (59 elements) — unused, but there if a
  LAN-ish distinction ever means something here.
