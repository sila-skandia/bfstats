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
is left to a jump-law probe. The tolerance clears all of those. A body put
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
Nothing broke. Two things seen: the page's `join` row (its `?team=`) is
refused while the sidecar is rejoining and not sent again, which costs nothing
here because the rejoin keeps the side; and a page that connected just before
a round ended went up on the briefing of the old level with `worldReady`
false and reloaded at the SetLevel 5 s later, as it should.

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

## Dead soldiers' bodies (2026-10-24)

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
  The room path, which has no `corpse` field, keeps the timed corpse. A seated
  death keeps the page's own slump and clock, because a seated soldier is not
  ghosted.
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
- **Open.** A seek still drops the bodies lying at that instant (the replay
  lays a body only when playback walks across the death or its arrival), and a
  body that first comes into scope after its man has respawned is not laid in
  the replay (the live page draws it). A man killed in a seat: the server
  sometimes keeps his soldier object in scope until a DestroyObject 10 s later
  (16 of 23 seated deaths in `-11-45-43` had the soldier in scope, destroyed
  between 0 and 10 s after), which neither page draws as a body; both harnesses
  leave seated deaths out. Nothing here was looked at in a browser. The tests
  run the renderers with no figures loaded, so the death clip on a loaded rig
  (`poseDeath`, `killBot`) is not re-measured.
