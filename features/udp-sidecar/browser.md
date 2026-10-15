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
http://localhost:5273/map.html?sidecar=ws%3A%2F%2F127.0.0.1%3A17942
```

(the URL is percent-encoded because it carries its own `:` and `/`).

## Running it end to end

```sh
# 1. the lab server (its own ports, started and stopped per run)
cd tools/bf1942-models
python3 lab/lab.py start lab/scenarios/sidecar-wake.json

# 2. the sidecar: it joins the lab and serves the page
node sidecar/sidecar.mjs 192.168.1.226:14568 --name sidecar \
    --names sidecar/templates/wake.json \
    --out run.ndjson --review run.review.ndjson --ws 17942

# 3. the viewer (serves the page and its assets)
python3 serve_viewer.py 5273

# 4. open the page, and optionally the monitor
#    http://localhost:5273/map.html?sidecar=ws%3A%2F%2F127.0.0.1%3A17942
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
| Drive the sidecar's soldier | yes: the page's input spawns the player and walks them (verified end to end) |
| Choose a team, a kit, a spawn point | partly: the join carries them, and on vanilla Wake the values are forced (see below) |

Verified end to end on 2026-10-15: the page asked the sidecar to spawn, the
server logged `spawnEvent` and `pickupKit`, and a second client watching the same
round saw the player's soldier cover 0 m per four-second window while idle and
8.6, 24.5 and 28.6 m once forward was held.

**Spawning needs the level's own numbers.** `SpawnRequest` only stores the
request (`BFPlayer+0x90` = the group, `+0x80` = the second byte) and a later tick
decides, so a refused pair looks exactly like no pair at all. The values are per
level and per team, and they are in the level's data
(`viewer/maps/<level>/scene.json`: `controlPoints[].spawnGroupId` and
`soldierSpawns[]`). On vanilla Wake every control point belongs to team 2 and
only team 2 has land soldier spawns (groups 1 to 5, 17 points); team 1's only
spawns are the ship groups, 70 and up. So a join that asks for team 1 is refused
whatever group it names. A page for another level must read that level's data,
which is the next thing this needs.
