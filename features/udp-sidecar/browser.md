# The browser side: the page plays through the sidecar

Status: the seam is in and tested, and the input path plays. A page joined this
way can spawn on a real server and drive its soldier; a second client watching
the same server confirms the movement. This file is how the two sides fit
together and how to run them.

## Two ways a browser sees the game

| | what it is | state |
|---|---|---|
| **The replay viewer** | `map.html?replay=<recording>` opens the sidecar's v5 recording, exactly as it opens a bf42plus one. Static: it renders what is in the file. | works today |
| **The play page** | `map.html?sidecar=<ws url>` joins a real server live through the sidecar, with the page's own soldier, prediction and input. | the seam is in; input is not wired |

Both use the same viewer and the same decoders. The recording is the safer
thing to look at, because it is a file; the live page is the thing the POC is
for.

## The sidecar's WebSocket, both directions

The sidecar serves one WebSocket on `127.0.0.1` (`--ws <port>`, default 17942)
and serves the monitor page at the same port.

**Sidecar to page**, one JSON record per text frame, in the bf42plus v5 shape
the replay viewer already parses: `h`, `anim`, `e` (the event stream), `o` (an
object's name), `s` (a transform batch), `st` (a state row).

**Page to sidecar**, binary frames, deliberately the room protocol's own type
bytes so the page's input path is unchanged (`viewer/netcode.js`):

| byte | message | body |
|---|---|---|
| `0x02` | input | `u32le` seq then the engine's 17-byte action (`encodeInput`) |
| `0x05` | action | JSON: `{type:'join'|'radio'|...}` |
| `0x04` | leave | empty; the sidecar leaves the server |

The sidecar owns the connection to the server, so the page's `join` does not
open anything: it asks the sidecar to spawn the page's player and carries the
page's name and team.

## The seam

`viewer/net-sidecar.js` keeps the client surface `net-room.js` reads and changes
only where the state comes from. The surface is what `netcode-render.js` draws
from: `slot`, `hello`, `vehicles`, `remoteSlots()`, `remotePlayer(slot)`,
`remoteVehicle(id)`, `teamOf`, `nameOf`, `snapCount()`, `selfPlayer()`,
`sendInput`, `action`, `radio`, `onevent`, `onsnapshot`, `join`, `close`.

`net-room.js` picks the transport from the query string, so the page is:

```
http://localhost:5273/map.html?sidecar=127.0.0.1:17942
```

The sidecar's address is all the page needs (2026-10-19). Since 2026-10-24 the
page connects first and loads nothing until the server names its level, then
loads that one (see "The join" below); `map` and `mode` in the URL are ignored
and rewritten to the server's. A full `ws://` URL still works. A server mod
the viewer has no maps for, or a level not extracted yet, is said on the
loading screen instead of loading another level.

## Running it end to end

```sh
# 1. the lab server (its own ports, started and stopped per run)
cd tools/bf1942-models
python3 lab/lab.py start lab/scenarios/sidecar-wake.json

# 2. the sidecar: it joins the lab and serves the page
# (no --names: the level's ids are computed from the install at SetLevel;
#  a --names file only fills ids the install cannot name)
node sidecar/sidecar.mjs 192.168.1.226:14568 --name sidecar \
    --out run.ndjson --review run.review.ndjson --ws 17942

# 3. the viewer (serves the page and its assets)
python3 serve_viewer.py 5273

# 4. open the page, and optionally the monitor
#    http://localhost:5273/map.html?sidecar=127.0.0.1:17942
#    http://127.0.0.1:17942/
```

The page and the sidecar are separate origins on purpose: the sidecar's
WebSocket is the boundary, and the page stays a static viewer. That is also
where the security work goes when this leaves the lab (bind 127.0.0.1 only,
check `Origin`, guard `Host`, pin the destination ports; see the README's "If it
goes further").

## What the page can and cannot do yet

| | |
|---|---|
| Render the world the sidecar decodes | yes: objects at their created positions, soldiers moving, facing, prone, firing, vehicles moving |
| Show the roster, the feed, the kills | yes, from the event stream |
| Mark the other players on the map | yes (2026-10-18): the minimap and full map read the net client's rows and the server's entities — a friendly on foot is the arrow at his drawn pose, a hull a teammate crews is his side's colour, an enemy-crewed hull is dropped, a wreck is dropped (`map-friendlies.js`, retail's rule `map-vehicle-marks.js`); the sonar scope senses the same sets (`map-sonar.js`). Before, the map read only `world.players` (the local sim's bots) and showed nobody |
| Kit glyphs on the score board | yes (2026-10-18): a remote's row draws his server-named kit's class glyph, and his skull reads his row's `alive` (`scoreboard-screen.js` `kitClassOf`) |
| Remote turrets in server-authority mode | yes (2026-10-18): the j rows land on the server's own entities (`server-entities.js` through `netcode-render.js applyJoints`), interpolated between their last two samples like the transforms (`net-sidecar.js jointsAt`, the engine's own RotationalBundle law). Before, only the replica path applied them, and authority mode has no replicas: every remote turret stood frozen at its authored angle |
| Extrapolation at the retail law | yes (2026-10-18): past the newest sample an object moves at the last pair's full velocity for up to 1.2 s, then holds (`predict` 0x08237a90 re-read in the decompile). The misread it replaces divided the velocity by 1.2 s as well, so everything slowed to 83% through every packet gap and snapped forward on the next sample — a steady source of visible jitter |
| Drive the sidecar's soldier | yes: the page's input spawns the player and walks them (verified end to end) |
| Choose a team, a kit, a spawn point | partly: the join carries them, and on vanilla Wake the values are forced (see below) |

Verified end to end on 2026-10-15: the page asked the sidecar to spawn, the
server logged `spawnEvent` and `pickupKit`, and a second client watching the same
round saw the player's soldier cover 0 m per four-second window while idle and
8.6, 24.5 and 28.6 m once forward was held.

Verified in a real browser the same day (`map.html?map=wake&sidecar=...&team=2
&kit=1&spawngroup=1&spawnpoint=0`): the page joins and its hello carries the real
server's name and level, it renders Wake Island's terrain, the minimap with the
live control points, the server's own ticket counts (100 / 100) and the deploy
screen's kit list with its live counts, two remote soldiers render from the ghost
stream, and the briefing to deploy flow runs without a frame error.

Three things a browser found that the unit tests could not, all of them about
what the page does with the feed: the room handler ignored string frames (the
sidecar's feed is JSON text, so nothing arrived and the page sat in `waiting`); a
vehicle's pose lacked the quaternion the renderer sets straight onto the group,
so a vehicle in view threw inside the render loop; and a page leaving made the
sidecar leave the server, which a reload then did.

## The join (2026-10-24)

The owner's two sessions on BF1942-AUSTRALIA (Midway co-op, 63 bots) showed two
join defects: the page loaded Aberdeen, then reloaded onto Midway a few seconds
later; and on the second run he deployed on the Enterprise and fell through it
for good. Retail connects, loads the level the server's SetLevel names, and
plays once the server's world dump is complete. The page now does the same.

**What retail shows.** Read in `BF1942.exe`:

- At the connect (`0x0069f5e0`, reached from the `+joinServer` startup and the
  menu's join), the loading screen's prompt is set to
  `LOADING_PRESS_ESCAPE_TO_CANCEL` and its title to `BRIEFING_CONNECT` + " " +
  the joined address, which is `ip` + ":" + `port` (the caller at `0x0069f9f8`
  joins them with ":"). English: "CONNECTING TO 159.196.188.2:14567".
- At the level load (`0x006c0620`, `0x006c0bd0`), the title is
  `BRIEFING_LOADING` + " " + the level's name (Setup `+0x160`): "LOADING
  MIDWAY", over the level's own picture (`setLoadPicture`).
- The connecting screen's picture is the menu's own background,
  `menu/Texture/Menu/Background.tga` in `menu.rfa`. That is an 800 x 450
  24-bit image whose green tint and vignette are in its pixels. The owner's
  retail screenshot (2026-10-24) shows it. `menu/LoadMenu` places it at x 0,
  y 85, 800 x 450 of the 800 x 600 menu space (the floats 85.0, 800.0, 450.0
  beside each `Menu/Background.tga` reference). The menu is stretched to the
  screen, so on a 16:9 screen it reads as a wide band with black bars above and
  below. The repo already had it as the hud pack's
  `_shared/hud/menu/textures/background.png`, which the play front end uses, so
  nothing new was extracted. The page draws it through `hudPaths` (a mod's own
  copy wins) at that rect (`progress.js` `backgroundRect`).
  Its mean colour on the page (32.7, 39.1, 10.9) matches the retail capture's
  band (31.7, 37.9, 10.3), so no extra tint is drawn. An earlier guess,
  LoadMenu's `Load/Pacific.tga` default, was wrong for this screen; it remains
  only the fallback when the hud pack is missing.
- No other loading-screen title or phase string was found: no "receiving" or
  "waiting for server" key is referenced from the exe. `INFO_MESSAGE_LOADING`
  ("LOADING, PLEASE WAIT") is a text node in `menu/LoadMenu` and `menu/InGame`,
  and what shows it is not known yet. Whether retail's bar moves while the dump
  arrives is not known either. Both are open for a screenshot of retail's
  screen.

**The connect screen (2026-10-27).** A join from the phone app or the tray
app opened `map.html?sidecar=…` and showed the mesh site's bar (Models, Maps,
Poses, Kits) and the flythrough panel for the seconds the game's modules took to
arrive, because `shell-playing` was only set once they had run. Now the inline
script in `map.html`'s `<head>` sets `shell-playing` and `preboot` before
`<body>` parses, and `#preboot`, the first element in `<body>`, draws this same
screen with plain HTML and CSS: the menu background at (0, 85, 800, 450) and
the loading plate with "CONNECTING TO …". When the module's overlay `begin`s
underneath, `#preboot` is removed after the overlay's 400 ms fade, so no pixel
moves. A headless run checked every frame from the first and found no bar.
Escape on the pre-boot screen goes back to the menu, the same as the overlay's
cancel.

The apps know the server's name from their list, so they put it in the link as
`?server=<name>` (`viewerUrl` in `Sidecar.kt` and in `sidecar-desktop`'s
`main.js`). The screen then reads "CONNECTING TO <name>" from the first frame.
Retail shows the address here; the name is the owner's call. A link without
`server` keeps the old behaviour: CONNECTING, then the address once the
sidecar's `server` row names it. A mod reload (`location.replace` with `mod`)
keeps the query, so the name survives it.

**How long the dump takes.** It is server-paced. On this server the sidecar's
SetLevel came at 0.35 s and DataBaseComplete at 24.85 s (run 1) and 23.56 s
(run 2). CreateObjects ran from 0.8 s to about 21 s, then the 64 CreatePlayers.
The owner's retail client took 23.2 s from ChallengeResponse to
DataBaseComplete on the same server, captured on the wire. A local level load
is much shorter on a fast machine, so the two run in parallel and the deploy
screen waits for both.

**The page's law.**

- `net-sidecar.js` gives `serverLevel()`, the level, mod and game type once
  a SetLevel (or the live snapshot's) is in, and `worldReady()`. That second
  one is false from each SetLevel until the sidecar's `server` row says
  `joined` (its Simulation event, after DataBaseComplete) or a live
  `dbComplete` arrives. It also gives `serverAddress()`, from the `server` row.
  A page that connects to a sidecar already in the round gets the SetLevel in
  the snapshot and `joined` right behind it, so it is ready at once. A rejoin
  (`rejoining`, then the new SetLevel, then `joined`) is not ready until the new
  dump is in.
- `map.html` waits on `room.sidecarLevel()` before it loads anything. Until
  then the loading screen reads "CONNECTING TO <addr>" over the menu background,
  letterboxed as retail draws it. Another mod
  is a reload into that mod before any level loads. A level not extracted fails
  on the loading screen.
- `level-load.js` adds a "server's world" step to the bar. It holds the loading
  screen on `room.serverPlayWait()`: the dump, then the models of every hull the
  dump named. The briefing, its READY and the deploy screen behind it come only
  after that. `onjoined` no longer opens the deploy screen on a sidecar page,
  because it came up under the loading picture.
- The deploy screen's commit and the resumed-life path read `worldReady` as
  the level's AND `room.netWorldReady()` (`map.html` `playReady`).
- A real SetLevel mid-session (`levelChange` with `load: true`) reloads the page
  whatever the map, so a level change goes through the same connect and loading
  path. Retail relaunches itself there (RECON-2, RECON-7). The in-place restart
  (GameStatus 1 or 2, then 3) stays in place.
- `sidecar.mjs` `remember`: a SetLevel clears the live snapshot's old world
  (players, objects, poses, flags). A level change is a new connection whose
  server never destroys the last session's objects. A page that connected after
  a rejoin used to get both worlds.

**Why the carrier spawn fell through.** It was not only timing. The page had
no collision for the carrier until the carrier came into this client's ghost
scope and its glb then loaded. The server scopes the carrier in with the very
spawn that puts the player on its deck. Run 2's spawn: the soldier 9871's first
record is at 49.491 s, and the Enterprise's (519) at 49.461 s. Before that the
camera was elsewhere and the carrier was out of scope. In server-authority mode
the level's own copy is cleared (`clearLevelVehicles`), so nothing was solid.
The server then walked him across the deck at y 32.2. The page fetched the
1.1 MB `Enterprise.glb` only at the scope entry, stood the body at once, and
gravity won the race. The reconciler takes x and z from the server, but y
re-solves against the local ground, so a body under the deck stays there. That
is the "forever". Retail has every model loaded with the level, so its deck is
solid on the same tick. Two fixes:

- `server-entities.js` `prewarm`: every hull template in the object table is
  fetched as soon as its CreateObject arrives during the dump, and only after
  the level's report is in, because a model picks its level variant from it.
  On the fake-sidecar run the Enterprise's glb was requested 5 s into the
  page's life, not at the spawn.
- `net-room.js` `deckNotReady`: a server spawn, or a resumed life, is not stood
  while a hull in scope within reach of the body (its radius, else 160 m) has no
  collider yet. It is held for at most 5 s. `__net().deckWaits` counts the held
  snapshots.

**Checked.**

- `tests/test_sidecar_join.py` replays run 2's own rows
  (`fixtures/sidecar_midway_join.ndjson.gz`) through `net-sidecar.js` and
  `server-entities.js`. It checks: no level before SetLevel, the level at
  0.325 s, ready at DataBaseComplete (23.558 s) and not before, the
  Enterprise's model asked for at 2.843 s, a deck spawn held until its glb
  lands, the mid-round snapshot, the rejoin sequence, and that the in-place
  restart is not a load.
- Headless, against a recording-fed stand-in for the sidecar that plays the
  same rows in real time, on a private viewer port:
  - "CONNECTING TO 159.196.188.2:14567" over the letterboxed menu background
    (band 113 to 713 of an 800 px tall pane), and no level request
    before the SetLevel.
  - Midway's `scene.glb` requested 0.1 s after the SetLevel, never
    Aberdeen's.
  - The bar holds at 215 of 256 px until the dump ends, and the briefing goes
    up 0.3 s after `joined`.
  - The recorded spawn taken up on the deck at the server's y 31.2.
  - With the Enterprise's glb held back 51 s, the body is held: 31 snapshots,
    `deckWaits`.
  - A page connecting to the stand-in after the dump is on the briefing in
    4.9 s.

**Open.**

- Retail's phase text and whether its bar moves during the dump: the owner's
  screenshot shows the picture but not the bar or the text. The page's own
  line under the prompt (below) is not the game's.
- The other three items of 2026-10-24 are closed in the next section.

### The open items, closed (2026-10-25)

**A body under a deck is put back on it.** Retail's control-state handler
(BF1942.exe `0x00491c90`, wire.md section 20) sets the whole body, height
included, to the server's state at the acked tick and re-runs the newer
actions. The page took x and z only and re-solved y on its own ground, so a
body that fell through a deck stayed under it. It now takes the server's
height too, once the error at the acked tick passes
`CORRECTION_Y_TOLERANCE` (`netcode-reconcile.js`, 1.5 m, the sidecar only;
`?yTol=` moves it for a measurement). It takes the server's y at the ack whole,
without the replay's vertical share, because that share is the page's own
wrong fall; a raised body's downward speed is zeroed so it does not land on
the deck at the speed of the fall. Measured on a private lab (Wake), the
vertical error at the acked tick, `__net().trace[].dy`:

| where | median | p99 | max |
|---|---|---|---|
| standing on terrain | 0 mm | 0 mm | 0 mm |
| walking and turning among statics | 0 to 6 mm | 0.14 to 0.56 m | 0.64 m |
| on the Shokaku's deck, standing and walking | 3 to 9 mm, steady | | 9 mm |
| jumping in place | 0 mm | 0.45 to 0.93 m | 0.94 m |

The jumps' large errors are whole jumps the page made a tick or more apart
from the server's (the x/z error 0, the server's soldier does jump in its
transform rows); that is the jump's timing on the wire, not a ground law, and
is left to a jump-law probe (done: "The jump, tick for tick" below). The
tolerance clears all of those. A body put
9 m under the Shokaku's deck while the server had him on it (`__teleport`):
the old law left him swimming at the sea surface (93.6 m against the
server's 107.12 m) for good; the new law had him back on the deck at the next
ack, inside 250 ms, one `__net().yTaken`. `tests/test_netcode_reconcile.py`
`HeightTests` pins the law.

The same run found why a deck spawn could fail to stand at all. In
server-authority mode the level's own carrier copy is cleared for the
server's, and `bindCarriers` then read the Shokaku's points as down whenever
it bound before the server's copy, so `spawnAtFlag` refused the spawn the
server had already made, and `standServerSpawn` cleared its wait on that one
refusal: the page sat on the free camera while the server walked the player
about on her deck (3 failures in 4 lab runs). A spawn the server made is now
stood whatever the page thinks of the flag (`world-players.js` `served`,
`spawning.js`); the body is put on the server's position straight after.
`tests/test_carried_spawn_flags.py` pins it. Four runs in a row stood.

**The world wait has no cap, says how it goes, and Escape leaves.** The hold
on the server's world is `uncapped` (`progress.js` `hold`): the 30 s cap still
applies to the level's own warm-up and the briefing art, never to the dump.
While it waits the bar's server share creeps on with the time (the dump names
no total) and, after 5 s, a line under the prompt says "RECEIVING THE SERVER'S
WORLD · n OBJECTS · s S" (`net-room.js` `serverWorldStatus`). Escape, from the
connect to the briefing, goes back to the menu, retail's
LOADING_PRESS_ESCAPE_TO_CANCEL (`overlay.cancelWith`, map.html). A server that
refuses or drops the join while the screen is up now puts its modal above the
loading screen (`#roomIssue.ri-over-load`; at z-index 10 or 15 it had been
under the screen's 20). Checked headless: the Midway join fixture played to the
page three times slower than recorded (a 71 s dump) held the screen to 73 s,
the line counting up to 623 objects; Escape on the loading screen of a live lab
page landed on `play/index.html`. `tests/test_load_briefing_js.py` pins the
uncapped hold, the line and Escape.

**The live snapshot carries the server's object table.** `sidecar.mjs`'s live
state moved to `sidecar/live-snapshot.mjs`, and `createObject` is now one of
its state events, per netId: a DestroyObject takes it out, a SetLevel clears
it with the rest of the old world, and a netId made again goes to the end. A
page joining mid-round knows every hull the server has, in scope or not, so
the prewarm asks for all of them. On the Midway fixture at 40 s, before the
Enterprise came into scope: 21 models asked for, the Enterprise among them,
against 14 without the table. Size, on the owner's four 64-player
recordings: at most 715 CreateObject rows, 77 KB, at the end of the world dump,
and 37 to 41 KB in play, against a whole snapshot of 160 to 193 KB.
`tests/test_sidecar_live_snapshot.py` pins it.

**A level change, in a browser.** A private lab on
`lab/scenarios/sidecar-levelchange.json` (Wake, then El Alamein, two-minute
Conquest rounds), the sidecar and one headless page, both ways round. At the
server's new SetLevel (the sidecar is already reconnecting through its
reconnect slot) the page reloads with the new map; it connects to a sidecar
still `rejoining` (0 players, 0 objects in the snapshot) whose snapshot already
names the new level, so "CONNECTING TO" lasts 0.2 s; "LOADING EL ALAMEIN" goes
up, the briefing comes 4 to 5 s later, after the sidecar's `joined`, and the
deploy stands the body on the new level (spawned at 1725.8, 60.1, -772.6). The
server's entities after the change are the new level's only (El Alamein:
Stationary_Browning, Sherman, M10, Willy, Spitfire and the rest; Wake on the
way back: Defgun, AA_Allies and so on, no PanzerIV), and the sidecar's
snapshot holds one SetLevel and 43 CreateObject rows, all El Alamein's.
Nothing broke. Two things seen: the page's `join` row (its `?team=`) was
refused while the sidecar was rejoining and not sent again, which cost nothing
here because the rejoin keeps the side (now held and sent at the join, next
section); and a page that connected just before
a round ended went up on the briefing of the old level with `worldReady`
false and reloaded at the SetLevel 5 s later, as it should.

### The side, a resumed life and Midway's deck (2026-10-25)

**The page's side survives a connect.** The sidecar refused a `join` row
that came before the server had a player (`connecting`, `rejoining`), and the
page sends it once, at the socket's open, so a page loaded during the
sidecar's first connect lost its `?team=`. Retail sends its side when the
server can take it. `sidecar/page-team.mjs` now holds the choice (the newest
page's word) and the session's `joined` sends it, under the old rule: only
before the player's first spawn, since a SetTeam kills whoever it moves.
Checked on a private lab (Wake co-op): the sidecar started with no server, a
page opened with `?team=1` ("page asked for team 1: held until the server has
the player"), then the server; the sidecar joined on team 2 and sent the held
SetTeam (`setTeam pid 0 team 1` 0.3 s after its CreatePlayer, "page team at
the join: sent"), and the page deployed Japanese on the Shokaku.
`tests/test_sidecar_page_team.py`.

**A resumed life never fails on the page's flags.** `resumeServerLife` gave
up when `nearestFlagIndex` found no flag, and that skipped every flag with no
points or nowhere to measure from. A life the server has is now filed under
any offered flag: his side's flags with points first, then his side's bare
ones, then the other side's; -1 only on a level that offers none (and then
`buildSpawnFlags` has already said no). A flag with no point of its own
stands the body on the server's position (`world-players.js` `servedAt`),
and the caller places it from the pose as before. The reported case, Japan on
Wake, did not reproduce on the lab with the current page: a reload with the
Japanese soldier alive on the Shokaku resumed twice ("deploy: resumed the
server's life (Jap_Assault)" at 14 s), its flag read `inactive` and the
served stand (above) took it. The fallback covers the flags it could still
miss. `tests/test_server_life_resume.py`, `tests/test_carried_spawn_flags.py`
(`bareServed`).

**Midway's deck default was a seat group that never spawns a human.** On a
private Midway co-op lab a node probe (team 2, kit 1) asked each group in turn:
72 went unanswered four times, with two bots and with none; 73, 74, 68 and 69
each spawned on the first ask; 4 (a neutral land point) went unanswered.
The server's event log showed no bot in the Enterprise. Group 72 is
`enterprise_driversoldierspawn`, three points with `setEnterOnSpawn 1`, and
such a point is on for a human only while a free seat's door is within 5 m
(SPAWN-25); the helm's is not, so the group seats bots (15 m) and no human,
and `GameServer::spawnPlayer` answers an inactive group with nothing
(SPAWNGRP-10). The page's ship ring default was the flag's first group, which
on the Enterprise is 72, so a deploy that did not click a deck ring waited on
the free camera for good. The co-op layer's groups are the conquest ones
(`modes.SinglePlayer`: 72, 73, 74 on the Enterprise, 68 and 69 on the
Fletcher, the same as Conquest), so nothing was wrong with the layer. The
owner's real-server Midway spawn (sidecar-2026-10-24-11-53-03, `createObject`
of his soldier at (2113, 31.62, 2686.05)) is exactly group 73's point on the
lab, so his page asked for 73, a ring he clicked; the run before spawned on a
land point his side held. Earlier "groups 1 to 6" tries were Wake's
flag-index numbering, which no Midway group has.

`deploy-spots.js` `shipDefault`: a ship's default is the first group with a
point the page holds active that stands its player, else the first active
one, else the first that stands its player, else the first. A clicked ring
still wins. On a sidecar page every carried point reads `inactive` (the
server's ships are not the level's bound copies), so the default there is the
first standing group: 74 on the Enterprise (the points are listed 72, 74,
73). Checked on the lab: a headless page with `?team=2` deployed on the
Enterprise flag without a click, the sidecar sent group 74, and the server
stood him on her deck at (2158.5, 37.8, -2698.5) on the next wave.
`tests/test_deploy_spots.py` (`helmFirst`, `deckDown`, `allSeats`).

Open: retail's own default selection on its spawn screen is not read; a ring
the player clicks on a group that cannot spawn him (72) is still asked for
and re-asked, as retail would, with nothing on the page to say why. (Both
closed in "The server's spawn groups" below.)

### The server's spawn groups (2026-10-25)

**The deploy screen's ship state is the server's word.** On a sidecar page
every carried point read `inactive` and `carrierDown`, because `bindCarriers`
bound them to the level's copies of the ships, which server-authority mode
stands down. A retail client does not work that state out at all: the
server's `BFSpawnPointManager` is a networkable, and per group it sends the
side, `getActive(false)` (the human's test through every point, SPAWN-5 and
SPAWN-25) and the ring's x and z, a byte of the terrain each. The client's
`getActive` is that byte. Ledger SPAWNGRP-11 has the addresses. On the wire
it is the ghost with no createObject at netId 513 (514 is the ScoreManager).
Its first send is every group at 22 bits each: 550 bits on Midway and Wake,
616 on Tobruk. After that it sends only what changed: a flag changing hands,
a ship's ring stepping a byte (16 m on a 4 km level), a ship's groups going
off when she sinks.

- `sidecar/ghost/spawn-manager.mjs` finds and decodes it
  (`body-decoder.mjs`). `ghost-writer.mjs` writes the whole table as an
  `e:'spawnGroups'` row whenever an entry moves, `[team, active, qx, qz]` by
  ordinal. `live-snapshot.mjs` keeps the newest row for a page that joins
  later.
- `viewer/server-spawn-groups.js` holds the table. The wire never names a
  group: entry i is the i-th lowest id the server holds, and that includes
  groups a script named with no point (Midway's 1, 2 and 5). `alignGroups`
  lines the entries up with the groups the level data names. A group with
  points takes an entry, and an entry with a ring must be one of those
  groups. Where the page knows a group's ring, the nearest entry wins. On
  the owner's three sessions and the lab every named group lands on its own
  entry.
- `hull-bodies.js` makes the server's word each carried point's
  `inactive`, `carrierDown` and `served` (the ring) once the table has
  arrived. `spawn-flags.js` `groupSpot` draws the served ring.
  `followServerCarriers` (called by `net-room.js` after the entity sync)
  carries every point on the server's entity of its template, at the offset
  it had on the level copy. An entity out of scope is not in the table, and
  its points stay where it was last seen.

**Retail draws only groups a human can spawn on, and has no default.** The
spawn map draws a dot, and a click selects, only for a group of the
player's side whose active byte is set (`BfMap::update`, the click in
`minimap_screenTransform`). So Midway's helm group 72 is never on a retail
screen. The selection is the map's own `BfMap+0xd4`. `BfMap::BfMap` zeroes
it, only a click writes it, and closing the screen commits it as it
stands. A player who never clicks asks for group 0 and the server refuses
him (`reSpawnPlayer`). A click stays chosen across deaths, and once it goes
stale the server refuses it until he clicks again.

- `deploy-spots.js` `flagMapSpots` now leaves out a deck group whose every
  point is off (`groupDown`). The painter and the click picker both read it,
  so the helm ring is neither drawn nor clickable. A ship whose every group
  is off draws nothing, where it used to draw one ring at the hull.
- The page still picked a group for a player who had not clicked (the
  round-open flag and, on a ship, `shipDefault`). The owner chose retail's
  rule, and the default is gone ("No spawn point until a click" below).

Checked on a private Midway co-op lab (port 14708, two bots) with a headless
page:

- The sidecar's first table had group 72 off (ring on the Enterprise's deck
  at bytes 125, 168) and 73, 74 on.
- `__deploy.flags` gave the Enterprise rings 74 and 73 only (no 72), the
  Fletcher 68 and 69, the Hatsuzuki 70 and 71, and the Shokaku 75, 76 and
  77. Every one of those flags was `inactive: false`, where all of them read
  `inactive` before.
- A deploy with no click sent 74 and the server stood the soldier on her
  deck at (2158.5, 39, -2698.5).
- Deployed on the Fletcher (default 68), boarded and driven 48 s: the
  server's rings for 68 and 69 moved with her each sample, (1815, -2474) to
  (1414, -2056) for 68, and her deck points moved with her.

The entity carry for a ship the page does not drive was not exercised live.
The lab's only free hull, a node probe in the Hatsuzuki, stalled within
seconds and was out of the page's scope. It is held by
`tests/test_deck_spawn_host.py` (`serverCarrier`: an entity 600 m off her
pad and turned 90 degrees carries both points to within 1 cm).
`tests/test_server_spawn_groups.py` covers the wire to the page: the
owner's Midway first send decoded to its last bit, the deltas, the writer
and snapshot rows, the alignment, 72 off, and a sunk Shokaku.
`tests/test_deploy_spots.py` covers the screen (`offScreen`).

Open (closed below): a land flag still took its side and offer from the page's own capture
state, not the table. The table carries them too, for example a point whose
spawns go off while it is being taken (SPAWN-22). The hull the page drives
has no server entity, so its points ride the page's own body as before.

### No spawn point until a click (2026-10-25)

The owner's decision: retail's rule exactly. Ledger SPAWNGRP-12 has the
addresses; SPAWNGRP-11 has the screen's draw and click.

**What retail does.** The selection is the spawn map's `BfMap+0xd4`. The map
and the spawn menu are built once, when the game starts, and nothing but a
click on a drawn group writes the selection. So:

- Nothing is chosen until the first click. The respawn plate's line reads
  SPAWN POINT NOT SELECTED, PLEASE SELECT ONE until a close commits a group.
- A click away from every ring keeps the selection. After a change of side
  it clears it, because the team handler zeroes the click's base
  (`BfMap+0xd8`) and the commit, not the selection.
- The close commits the selection only for a player who is not alive. The
  screen's key and its button both close it.
- A death opens the screen and leaves the selection as it was.
- A level change leaves it too. A group of the same id on the new level is
  still the chosen ring wherever that level draws it.
- A committed group that goes off stays committed. Its ring is not drawn, and
  the server refuses it. A committed group that passes to the other side is
  uncommitted, the plate says NOT SELECTED, and the screen opens once.
- The server forgets a player's group each time it stands him
  (`spawnPlayer`, `reSpawnPlayer`), so every life needs a new SpawnRequest.
  Which call of the retail client sends it after a death was not found. Its
  own copy (`player+0xc4`) survives the spawn, and the plate keeps reading
  SELECTED.

**What the page does now, in every mode.** `spawning.js` holds the
selection (`deployChoice`, `{ group, index }`), the click base and the
commit (`deployCommitted`).

- `openDeploy` selects nothing on a fresh join and touches nothing on a
  death.
- The click picks the nearest drawn ring, or keeps the base. Number keys and
  `__deploy.select(name)` pick the flag's first drawn ring, an explicit
  choice like a click.
- DONE, CLOSE, Caps Lock and the map key (`closeDeploy`) commit for a dead
  player. With nothing chosen, the commit is the free camera and no spawn row
  is sent. Escape stays a plain cancel, and it leaves a dead man's pending
  spawn waiting, because the server stands him on the group it holds.
- `deployUnchosen` is now derived from the selection. The circle is drawn
  only over the chosen group, and only where that group is drawn.
- On a server-owned spawn (a sidecar page), a death with a group committed
  asks for that group again when the screen opens, so the wave stands him
  there with no click. The page's 5 s re-ask covers a lost request as
  before.
- The solo page and a page in its own room share the rule. Neither had a
  reason of its own to differ. A solo death still waits for DONE, since there
  is no server wave to stand him.
- `forgetFlagChoice` (a level change) keeps the group and drops the commit
  and the click base, the way a change of side does. Whether retail's join
  on a new level runs the team handler was not read.

**Land flags take the server's table on a sidecar page.** With the table in,
`deployFlagIndices` offers a flag exactly when the table draws one of its
groups for the player's side: the group's side is his and its active byte
is set. `deploy-spots.js` `flagMapSpots(flag, { team, table })` gives the
flag's ring the group the table draws. For a point with two groups that is
the holder's (SPAWNGRP-4). A flag whose groups the table does not name falls
back to the page's own capture state. Off a sidecar page nothing changes.

**Scripted runs.** No URL option ever deployed without a click. The
headless checks that committed without one now click first:
`__deploy.select(name[, group])`, `__deploy.selectAny()` (the first drawn
ring), and `__deploy.ringAt(name[, group])` for a real mouse click.
`__deploy.choice`, `.committed`, `.offered` and `.served` (the table per
flag) read the state. `__respawnHud().SpawnText` reads the plate's line. The
lab probes already selected a flag. `p2_two_browser_smoke`,
`p4_snapback_smoke`, `perf/decktrace`, `perf/leakcheck`, `perf/perfbench`,
`viewer-parachute/bailcheck` and the parity round's `w4c-capture` now select
first.

**Checked on a private Wake co-op lab** (offset 160, port 14728, 12 bots),
with a probe sidecar and one headless page, using `lab/spawn_select_probe.cjs`:

- The screen opened with nothing chosen and the plate read NOT SELECTED. A
  commit sent no spawn row (the page's action log and the sidecar's both
  show none), closed the screen and stood nobody.
- Caps Lock reopened it, still empty. A mouse click on Landing_Beach's ring
  chose group 1. DONE sent `spawn` group 1, and the server stood him on the
  beach, 7 m from one of group 1's three points, with the plate at SELECTED.
- SUICIDE, then nothing touched. The screen opened on the death with group 1
  still chosen and the plate at SELECTED. The page asked for group 1 again
  3.2 s after the suicide, re-asked every 5 s, and the server stood him on
  the beach at the wave, 15.5 s after. No click.
- Japanese: a mouse click on the Shokaku's ring 75 spawned him on her deck,
  8 m from the ring, and a SUICIDE brought him back to 75 with no click.
- The table against the offer, 40 samples over 200 s while the bots
  attacked. Landing_Beach went Allied, then neutral (group 1 `team 0`,
  active), then Japanese, and South_Base went Japanese. The Allied tab's
  offer dropped each flag on the sample where the table changed, with 0
  mismatches. The page's own capture state agreed with the table on every
  sample, so this run shows the wiring, not a disagreement. The
  disagreement cases are in `tests/test_spawn_selection.py` and
  `tests/test_deploy_spots.py` (`served`).

Open: which retail client call re-sends the group after a death. The page
sends it when the death opens the screen. A retail client that sent it only
on the close would make its player press DONE after every death, and the
plate logic (SELECTED survives the spawn) argues against that. Neither was
watched on a real client.

### The jump, tick for tick (2026-10-25)

The jumping-in-place errors above (up to 0.94 m at the acked tick, dy
negative) were jumps the page took and the server refused. The page's body
jumped on any press once a contact had re-armed it; the server refuses a press
for as long as the lower body is still in its jump state, whether or not the
man has landed. Measured on a private lab (Wake, team 2, group 1) with
`lab/jump_law_probe.mjs`, replayed by `lab/jump_law_check.py` and by the
page's own `Soldier.step` (`tests/test_jump_law.py`); the law is ledger PHY-35:

- the impulse lands on the tick of the word that carries the press (PHY-1's
  arithmetic, unchanged);
- the server reads c_PIAction as a level and jumps again when the wait has run
  (held standing: every 28 ticks); the page's wire sends one word a press, as
  retail's `c_CMNonRepetive` control map does, so this never reaches it;
- the wait is the jump clip: 28 ticks after a standing, walking or turning
  jump, 26 after a running, strafing or backward one, counted from the jump
  tick. A second press 20 to 27 ticks after a standing jump is refused by the
  server, 28 and 30 are taken. Which clip follows the lower body's own
  transition table (`soldier-locomotion.js` `SoldierJumpState`), so the page
  now feeds it the word's mouse axis too (`world-soldier-tick.js`
  `lookInput`);
- the stance the gate reads is the previous word's: a press on the word that
  lets go of crouch is refused, the next word's is taken.

The page's feet against the server's at each ack, the server's position put
back each time:

| | before | after |
|---|---|---|
| one press 20..27 ticks after a jump (`re20`..`re27`) | 243 to 287 mm | 0.8 to 1.2 mm |
| held standing (`held`, `standHeld`) | 216 to 259 mm | 1.2 to 1.4 mm |
| held at a run, strafe, back, walk, turning | 181 to 332 mm | 1.0 to 2.7 mm |
| single jumps at a stand, walk, run, strafe, back, crouched | 0.2 to 1.2 mm | the same |

(Maximum vertical error per phase. Before, the same words through the page
without the wait. A refused press costs the before-page a whole jump: the
per-ack figure is under the live 0.94 m only because the harness puts the
server's position back at every ack.)

Open: the clip runs on the server's draw clock, once per server frame, so a
wait is its clip length plus a part of a frame, rounded up to the tick. The
run jump's margin is small: 4 of 6 waited 26 ticks and 2 waited 27. The page
takes 26; a press on exactly the 26th tick after a run jump can still be a
jump apart (a running start, `goHeld`: 66 mm at one ack). A jump under a roof
is not replayed (the page's statics are its own, PHY-34). The y-take
tolerance in `netcode-reconcile.js` stays at 1.5 m.

**On the live page the input path still moves jumps.** `lab/jump_page_probe.cjs`
(headless page, private lab, Wake's beach) taps Space; `MODE=apart` taps every
2.5 s, so no press can meet a wait. Vertical error at the acked tick:

| run | page fps | server ticks with no page word | median | p99 | max | acks over 50 mm |
|---|---|---|---|---|---|---|
| `apart` (control) | 45 | 45 in 15 s | 0 mm | 266 mm | 364 mm | 19 of 316 |
| `taps` (every other press inside the wait) | 9 | 83 in 19 s | 1 mm | 783 mm | 818 mm | 43 of 277 |

The control has no refused press and still misses by a third of a metre:
a server tick that runs no page word (`__net().starved`) during a jump puts the
server's arc a tick (up to 0.17 m) or more from the page's, and a press word
that arrives after the server's tick it was meant for jumps late. These are the
input path's (`input-pace.js`, the sidecar's queue), not the jump law's, and the
headless page at 9 to 45 fps starves far more than a real browser does. Fixed
the same day ([wire.md](wire.md) section 45): a steady page from 144 to 9 fps
now starves no tick, and what is left is the page's own stalls.

## A sidecar page is online, full stop

Connected to a sidecar, the page is a client of that server and nothing else;
the sidecar going away is the game dropping, never a quiet slide back into
single player (which is what it did until 2026-10-18: the sidecar died and the
player walked on in a world no server was running). The law, all in
`net-room.js`:

- the sidecar unreachable at load, or the WebSocket failing to construct:
  the SERVER modal ("CAN'T REACH THE SIDECAR"), with RETRY (a reload) and
  PLAY SOLO (the one deliberate way out);
- the socket closing mid-round: the same modal ("THE SIDECAR CONNECTION
  DROPPED"), after the room teardown;
- the sidecar losing the server for good — a kick, a ban, a close the server
  chose, its rejoin horizon spent — rides the feed as a `closed` row with
  `final` (`net-sidecar.js` `serverLeft`) and raises the same modal under the
  retail heading (KICKED FROM SERVER, BANNED FROM SERVER, DISCONNECTED FROM
  SERVER) with the server's reason text, MAIN MENU in place of RETRY, above the
  briefing and the deploy screen (wire.md section 43); a non-final loss is the
  sidecar reconnecting and plays through the level-change path, no modal;
- only a deliberate leave is silent: the page's own teardown (`__net().close`,
  `beforeunload`) or the reload that follows the server onto another level
  (`room.leaving`).

Both paths are measured headless: a page pointed at a dead port shows the
modal with `connected: false`, and a page spawned on the lab whose sidecar is
then SIGKILLed shows it within the socket's close.

**Spawning needs the level's own numbers.** `SpawnRequest` only stores the
request (`BFPlayer+0x90` = the group, `+0x80` = the second byte) and a later tick
decides, so a refused pair looks exactly like no pair at all. The values are per
level and per team, and they are in the level's data
(`viewer/maps/<level>/scene.json`: `controlPoints[].spawnGroupId` and
`soldierSpawns[]`). On vanilla Wake every control point belongs to team 2 and
only team 2 has land soldier spawns (groups 1 to 5, 17 points); team 1's only
spawns are the ship groups, 70 and up. So a join that asks for team 1 is refused
whatever group it names. Today the page takes them from the URL; reading them
from the level the page has already loaded is the next thing this needs.

## Dead soldiers' bodies (2026-10-24; seats, seeks and bodies never seen alive, 2026-10-25)

The owner, on BF1942-AUSTRALIA (Midway co-op, 63 bots): "heaps of bodies that
don't actually exist on the server". From the two sessions' recordings
(`sidecar-2026-10-24-11-45-43.ndjson`, `-11-53-03.ndjson`):

- **What the server does.** A respawn is a new soldier object (a new
  CreateObject and `control` row); the one he died in stays a ghost, still sent
  poses as it settles, until the server's DestroyObject for it. Every one of the
  169 deaths on foot in play went 9.97 to 10.07 s after its death row:
  `timeToLiveAfterDeath`, 10 s vanilla, so DIE-9's corpse time is the server's
  own. The death row (ScoreEvent 4 or 5) is followed straight away by a
  `control` row handing him his camera (all 244 deaths). Bots are back in about
  5 s, so most bodies outlive their man's next spawn. A body can also leave
  scope (ghost action 3, k:"d") and come back while it lies.
- **What the page did.** `netcode-render.js` drew one soldier per slot and took
  any alive-to-not-alive change as a death: it played a death clip where he was
  last seen and kept the body for its own 10 s. A live soldier who leaves this
  client's ghost scope (k:"d") is not dead, but he is no longer posed, so his row
  read `alive: false`. Each scope-out became a corpse that never existed: 33 in
  the first 125 s of the second session, and 22 in the second after the local
  player spawned at t 49.46, when his scope moved from the camera to his soldier.
  Separately, a respawn took the real body away early, about 5 s into its 10.
- **The fix.** `net-sidecar.js` keeps every soldier netId a man died in
  (`st.bodies`, body netId to pid: set on the death row when he is on foot,
  cleared on that object's DestroyObject) and its row carries `corpses`, each of
  his bodies the server has in scope with where its ghost lies, and `corpse`,
  the one of his latest death or null. `netcode-render.js`
  takes a row that has the field as the word on bodies: a body is drawn exactly
  while `corpse` is set, at the ghost's pose, with no clock of its own. A man with
  no `corpse` who stops being posed is hidden, which is retail's `disableObject`.
  A respawn hands the old body to `leftBodies` and the slot gets a fresh soldier.
  A body that comes into scope after its man is back gets a record of its own.
  The room path, which has no `corpse` field, keeps the timed corpse. (A
  seated death kept the page's own slump and clock until 2026-10-25: see
  "Killed in a seat" below.)
- **Checked.** `tests/test_sidecar_bodies.py` replays the first 125 s of the
  second session (`fixtures/sidecar_midway_bodies.ndjson.gz`, cut to the player
  and soldier rows) through `net-sidecar.js` and `netcode-render.js` and compares
  the bodies drawn, by netId, every 100 ms with the set the raw rows give (death
  rows, DestroyObject, scope). There are 0 mismatches over 1243 frames and 34
  deaths. Each body is drawn from its death row to its DestroyObject, and pid
  239's body 9922 lies on after his respawn at 114.85 until 120.5.
- **Two bodies of one man (2026-10-25).** The first version kept one body per
  player, so a second death inside the first body's 10 s dropped the first body
  early. It happens: in `sidecar-2026-10-24-11-45-43` eight men died again
  while their first body still lay (pid 195 three times running: bodies 7954,
  8750, 8792 at 164.74, 169.39 and 175.83, each destroyed 10 s after its own
  death; pid 226 at 144.25, 151.43 and 159.30), five more in `-13-07-56`, two
  in `-12-52-46` and `-14-21-07`. Bodies are now keyed by the soldier object,
  so each lies to its own DestroyObject. `fixtures/sidecar_midway_bodies_twice`
  (the first 190 s of that session, cut the same way, with its `simStart`) is
  the second fixture: 0 mismatches over 1893 frames and 73 deaths, with two of
  one man's bodies drawn together in 209 frames (pids 195, 218, 223, 226,
  228). The code before this change has 209 mismatches on it.
- **The replay viewer (2026-10-25).** `replay-bodies.js` drew each corpse for
  the body renderer's 10 s clock wherever the body went: a body the server
  scoped out before its destroy stayed drawn (7 such scope-outs in the first
  125 s of the second session). It now keeps the bodies on foot by soldier life
  (`lying`, `lyingBodies`) and follows the recording: hidden while the life is
  out of its replicated span (`k:"d"` to the next `k:"o"`), shown again on the
  way back in, disposed on the life's destroy (`killBot` takes `ttl: Infinity`
  and `bot-visuals.js` gained `disposeCorpse`). A body that first comes into
  scope already lying is laid when it arrives. What each kind of file carries:
  - **Sidecar recordings**: `o`/`d` for ghost scope and the destroyObject event;
    the sidecar writes a `d` beside every DestroyObject.
  - **bf42plus client recordings** (`plus` 2.0): `d` when an object leaves the
    client's registry or is disabled (`bf42plus/src/replay.cpp`
    `sampleObjects`), which is retail's scope-out, `o` when it is back, and the
    destroyObject event. In `replay_20261007-064429` 287 of 1018 bodies were
    scoped out before their destroy (157 within 0.3 s of the death) and 79 came
    back; the sidecar sessions show the same (47 of 258 in `-13-55-15`).
  - **Server recorder files**: no DestroyObject at all; `d` is the object gone
    from the world (`core.c` `write_gone`). A body there ends with its last
    span (`bodyEnd`).
  A file with no `o` rows at all keeps every body drawn, and a body whose end is
  not in the file keeps the 10 s clock. Three older replay faults showed up in
  the same comparison and are fixed: a death row on the instant a soldier was
  made (a join's world dump: 7815 in `-11-45-43`) was taken for that life's
  death and his real one drew no body (`replay-recording.js` now wants a death
  after the life began); a man spawned and killed out of scope kept his last
  life's `down` and his body was never laid (3517 in
  `replay_20261024-161456`); and a body never in scope was laid at his spawn
  point (1468 in `replay_20261007-064429`).
  `tests/test_replay_bodies.py` (`replay_bodies_harness.mjs`) plays four
  fixtures through `ReplaySoldiers` every 100 ms against the raw rows (dead, in
  scope, sampled at least once, before the first round end, deaths after the
  join's dump): the two sidecar ones, a bf42plus client file
  (`fixtures/replay_client_bodies`, the first 300 s of
  `replay_20261024-161456`) and a server recorder file
  (`fixtures/replay_server_bodies`, the first 400 s of `replay_1791115588` at
  10 Hz). All four have 0 mismatches; the code before has 311, 9, 518 and
  800. The whole of `replay_20261024-161456` (232 deaths),
  `replay_20261007-064429` (1022), `replay_20261021-202408` (45, first round),
  `replay_1791115588` (297) and the sidecar sessions `-11-53-03`, `-13-07-56`,
  `-13-55-15` and `-14-21-07` also come out at 0.
- **Killed in a seat (2026-10-25).** The old note here said 16 of 23 seated
  deaths in `-11-45-43` kept the soldier in scope to a DestroyObject up to 10 s
  later. Read again, most of those were in "scope" only because no `d` had come
  since he boarded, with no pose since; 21 of the 23 were destroyed on the
  instant of the death (their hull blew up with them), and two (8106, and 7275
  in the join's dump) lay on. Across all nine sessions the same holds: a gunner
  or a passenger shot in a hull that survives keeps his soldier object in scope,
  unposed, to a DestroyObject 10 s after the death (three Ho-Ha passengers
  killed by one Sherman shell at 104.388 in `-11-53-03`, each destroyed at
  114.413, the hull at 190.5); a man whose hull blew up with him is destroyed
  at once, or goes with the hull and no DestroyObject of his own (654 in
  `-14-21-07` was made again 4 s after its Daihatsu blew up).
  What retail draws there is ledger DIE-11: the death's ExitVehicle carries
  flag 1, which on both ends is the seat's `exitPlayer`, and that drops the
  player and never takes the soldier off the seat; `exit(bool)`, flag 0, is the
  one that moves him to the exit point. So the dead man stays in his seat,
  slumped (`Ub_DieInVehicle` on the torso, DIE-1), for as long as the server
  keeps his soldier, and a man who takes the seat after is added beside him
  (`enter` never removes the old soldier; 14 such re-entries in `-14-21-07`).
  bf42plus client files agree: the dead soldier never comes back among the
  registry's roots between his death and his destroy.
  - **The page.** `net-sidecar.js` keeps the seat of a death in a seat
    (`bodySeats`, with the hull's `gen`), and a row's `corpses` carries such a
    body as `seated` with its hull and seat while the soldier is in scope and
    that same hull stands. `netcode-render.js` hands the seat figure he was
    drawn in to `seatCorpses` and slumps it there; a body that was not drawn
    alive (scoped in later, or the page joined after) gets a seat figure of its
    own, the slump run to its end. It goes when the server lets the soldier go,
    on no clock of the page's. A death in a seat with no body in scope leaves
    nothing in the seat (it used to stay drawn at its last frame).
  - **The replay.** `replay-bodies.js` `seatOfDeath` reads the seat from what he
    controlled just before the death row, unless an ExitVehicle came after he
    got in (the sidecar writes no control row after an exit it cannot name a
    soldier for: pid 205 got out at 27.995 and died on foot at 59.988 in
    `-11-53-03`; a v4 file's own seat rows lag an exit, pid 10 in
    `replay_20261007-064429`). The body is the seat figure slumped
    (`killBot` with `seated`) and lies to `seatedEnd`: the soldier's destroy,
    never past the hull's. A sidecar file follows the soldier's ghost scope; a
    client's or a server recorder's file cannot see a seat's child, so the body
    is drawn while its hull is in scope (5823's M3A1 left the client's registry
    at 735.91 and he died in it at 743.25), and a server file, with no
    destroys, lies for the corpse clock unless the hull's hit points were gone.
    Before, the replay drew every such body on the ground at the spot he had
    boarded (174 mismatches on `sidecar_midway_bodies`).
- **A seek, and bodies never seen alive (2026-10-25).** The replay laid a body
  only when playback walked across the death or its arrival, so a seek showed
  none of the bodies lying there, and a man this client never saw alive (no
  sample of his soldier before the death row, so nowhere to play a death) left
  none when his body came into scope after he was back. `lyingBodies` now walks
  every soldier life with a death each frame and lays any body that should be
  drawn at that instant and is not: `bot-visuals.js` `layCorpse` builds the
  figure (on the ground at the recording's pose, or in the hull's seat) with
  its death held at the end of the clip. A death playback walks across is
  still the renderer's own, played; every body now lies to `bodyEndOf` (its
  destroy, else the corpse clock), not to a clock of the renderer's.
  Examples from `-13-07-56`'s first minute: 10848 died at 27.006 in the join's
  dump, its man was back at 27.066, and the body was in scope from 31.97 to
  its destroy at 33.97; 8726, 10166, 10533 and 11041 the same. None was drawn
  before.
- **Checked (2026-10-25).** Both harnesses now include seated deaths and name
  a body in a seat apart from one on the ground (`<id>s`), so a seated body
  drawn on the ground is a mismatch. `sidecar_bodies_harness.mjs`: 0
  mismatches on the three fixtures (the new one,
  `fixtures/sidecar_tobruk_unseen_bodies`, is the first 60 s of `-13-07-56`)
  and on all nine sessions whole (`-13-55-15` 15465 frames, 62 seated deaths,
  17 bodies drawn in seats; `-14-21-07` 9624 frames, 68). The code before has
  173 on `sidecar_midway_bodies` and 28 on the Tobruk fixture. Two foot-body
  faults showed up on the whole sessions and are fixed: a respawned man whose
  fresh soldier was not posed yet drew his handed-off body twice (1684 in
  `-13-55-15`), and a man who left the game kept his body drawn on a stale
  record past its destroy, and lost it on the page while the server still had
  it (pid 4 left at 955.63, his body 1515 went at 959.62 in `-14-21-07`): a
  departed man's bodies are now `orphanBodies`, held to their own destroy and
  no longer his pid's. `replay_bodies_harness.mjs` also seeks a second replay
  to 120 frames, back and forth, paused and playing, and plays three frames on
  from each, against the rows; and counts frames of bodies never seen alive
  (`unseen`). 0 mismatches and 0 seek mismatches on the five fixtures and on
  `-11-45-43`, `-11-53-03`, `-12-46-56`, `-12-52-46`, `-13-07-56`, `-13-55-15`,
  `-14-21-07`, `replay_20261024-161456`, `replay_20261007-064429`,
  `replay_20261021-202408` and `replay_1791115588` whole. The code before has
  174, 249 (seeks) on `sidecar_midway_bodies`, and seek mismatches on every
  fixture (138, 312, 100).
- **Open.** Nothing here was looked at in a browser: the harnesses run the
  renderers with no figures loaded, so neither the slumped seat figure nor a
  laid body's held death is seen on a loaded rig. That retail draws the dead
  man slumped in the seat rests on DIE-1 and DIE-11's reading, not a retail
  screen. A body laid after a seek lies where the recording has it at that
  instant and is not moved after (the sidecar sends a body's poses while it
  settles); one played from its death keeps the renderer's fall, as before.

## Joining late (2026-10-25)

Two kinds of late join reach the page, and both must end in the state a page
there from the start holds.

**The sidecar joins a round already running.** That is every real server. The
server sends the world dump (`GameServer::sendDatabase`, ledger J-12): a
createObject per networkable, then per player a createPlayer, a ScoreMsg of
type 7 and a SetTeam, DataBaseComplete, the static ghosts and GameStatus.
Kills, deaths, scores and tickets are not events: they ride the BFPlayer and
ScoreManager ghosts. Two pieces of the dump were not read:

- **Rounds.** No ProjectileNetworkable body was ever decoded, so no grenade,
  mine, pack or binocular marker had a pose on the page, whenever its pool was
  made. A pool made before the join is not a `projPool` at all: each of its
  rounds is a createObject at the origin (J-5), and a laid mine is created
  where it lies. `body-decoder.mjs` now classes a pool's ids and reads the
  body (`ghost/projectile.mjs`), the sidecar puts the class on every
  createObject row, and `net-sidecar.js` takes a round by its class as well
  as by its pool. Rebuilt from the review log of the 2026-10-24 Market Garden
  session (bf1942-australia), the page gets 69 grenade throws, an arc and a
  roll each, and the two mines that were lying when the sidecar joined.
- **When a round goes off.** The page took a round that stopped being sent
  for a round that had gone off, and blasted it. A laid mine the player walks
  away from leaves scope unexploded, so every mine would have blown up on the
  page. The server's word is the body's detonate bool (NET-14), which makes
  the retail client call `Projectile::detonate`; all 69 grenades of the
  session sent it. The session's two mines left scope six times between them
  without it and came back still lying (reset bool clear, same place), then
  each sent its detonate body. The ghost writer now writes a `detonate` row at
  the server's position (the round's last, when the body carries none) and
  stops the round's samples there (1 to 3 more bodies come after it);
  `net-server-rounds.js` blasts on that row alone.
- **A spent round scoped in is not a blast (verified 2026-10-25).** The first
  writer blasted any body with the detonate bool set it had not blasted
  before. A binocular marker's fresh pool slot comes into scope at the origin
  with both bools set, and the retail client resets a round brought into
  scope with the reset bool set before its detonate test, and `detonate`
  returns at once for a round already out (NET-14). Every Market Garden and
  Tobruk session of 2026-10-24 got one to three blasts at the map's origin
  from it: 73 rows over that session's 69 throws and 2 mines, now 71. The
  writer keeps the client's own copy of whether each round is out, and an out
  round gets no samples (61 pool slots at the origin in that session).
- **The page's own grenade is the server's (verified 2026-10-25).** With the
  rounds drawn, the local player's own grenade, mine or pack was drawn twice:
  the page's own round at the throw (`gunfire.js`), and the server's ghost of
  it a round trip later. The retail client's `FireArms::Fire` makes no round
  of a networked projectile: when the template's networkableInfo is not empty
  and the game is a client, it jumps past the barrel loop to the commit point
  (BF1942.exe `0x0053db29`..`0x0053db61`, NET-15), so the thrower sees only
  the server's round. On the lab (`lab/own_round_probe.mjs`, Wake), a node
  client's three throws all came back to it as its own pool's rounds, first
  seen 2.56 m from its soldier and about 1.0 s after the trigger (the
  grenade's `fireDelay`), each ending on a detonate body. The page's gun now
  asks `net-server-rounds.js` `fliesRound` (the template is one the server
  pools) and, when it says yes, lights the FireArms' own muzzle children and
  launches nothing; the pull's report, ammunition and hide-in-hand run as
  before. `tests/test_sidecar_own_round.py` runs the lab session through it.
- **The nametag caps.** SetLevel's settings carry `serverNameTagDistance` and
  `...Scope` (J-13). The sidecar records them on the `setLevel` row
  (`nameTags`, the lab's 100 and 300), and the name tags take them
  (`nametag-layer.js`).

**The page joins a sidecar already running.** The page is sent the live
snapshot (`sidecar/live-snapshot.mjs`). Each of last week's join fixes found
one more piece of state it dropped. `tests/test_sidecar_join_state.py` now
holds the general rule instead: replaying a session, a page joined from the
snapshot at any of twelve instants holds the same `net-sidecar.js` state as a
page fed every row from the start: roster, control, seats, objects and their
classes, rounds, poses, stances, hit points, kits, flags, tickets, joints,
engines, scores, bodies, bf42++ statics and the ghost scope. Run over the
owner's six sessions of 2026-10-20 and 2026-10-24 (up to 3 hours, 64
players), it found and the snapshot now carries:

| state | what the joining page got |
|---|---|
| an object out of scope | nothing: its k:"o" went at scope-out, so its class, side, hit points and stance went too, and a player's kit (named by its kit object) read as none. It now keeps them and a k:"d" closes it after everything else |
| a hull's engines | the last engine to change: keyed by the hull, a B17's four came as one |
| a body lying | none: a body is set by the death row, which is history. A `body` row now names it until its DestroyObject (a player alive in the world dump has no `control` row; his createPlayer names his soldier) |
| a dead man's kit | none once the server destroyed his kit object; the pickup row now carries its template |
| a pool over a shorter pool's ids | the older pool's template: pools are kept per round, newest last |
| an id a pool or a createObject took over | the old object's k:"o", which unnamed the new one |
| bf42++ server statics | none; now the create rows, moves and turns folded in |
| flags after a round restart | the old round's, where the page had cleared them |

Two page-side faults showed in the same comparison and are fixed in
`net-sidecar.js`: a createObject inherited the old object's class (a netId
that had been a gunner's seat, taken by an AichiVal, stayed `Seat`, which is
never drawn), and a destroyed hull's hit points and stance stayed on its
netId for the hull a round restart makes under it.
