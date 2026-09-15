# Round replay capture

Goal: bf42plus records what the server tells the client during a round, writes
it to a file, and the map viewer (`tools/bf1942-models/viewer/map.html`) plays
it back on the extracted level.

This document is the research outcome for the first question: **how does the
server talk to the client, and where in that path can a recorder sit?** It is
written against the retail client `BF1942.exe` (sha256 `60c945…cd3699`, see
`features/bf1942-engine-reference/README.md`) and the current bf42plus source.

Confidence tags follow the engine-reference ladder:

| tag | meaning |
|---|---|
| `working` | bf42plus already hooks or reads this and it functions in the wild |
| `inferred` | deduced from interfaces, .con vocabulary, or the DLL author's notes; the decompiled code has not been read |
| `open` | hypothesis; must be tested on the LAN server before anything is built on it |

---

## 1. The one-paragraph model

BF1942 is a server-authoritative simulation over a custom UDP protocol on
port 14567. The client sends **only its input** (a `PlayerAction` every 33 ms).
The server runs the world and streams back the result on two logically separate
channels inside each datagram:

1. **Game events** — a reliable, ordered, sequence-numbered stream of small
   typed messages (player joined, kill, chat, team change, game status, vote,
   radio, static object create/update). bf42plus already intercepts every one of
   these on the client. `working`
2. **Object replication ("ghosts")** — an unreliable, priority-scheduled stream
   of per-object state deltas. Every networked object (soldier, vehicle, kit,
   projectile, control point, camera) has a 16-bit network ID; the server keeps
   a dirty-bit mask per object per client, sends a baseline once, then sends
   only the changed fields, compressed with the engine's `BitStream`
   quantisers. The object class itself owns the wire layout via
   `NetworkableBase::setNetUpdate`. `inferred` for the scheduling, `working`
   for the interface shape.

A replay needs both. Events give the discrete story (joins, kills, flags,
chat). Ghosts give the continuous one (where everything is, who is in what,
health). The key design choice below is that **we do not have to decode the
ghost bitstream to get the continuous story** — the client has already applied
it to the world, and bf42plus can read the world.

---

## 2. Evidence, layer by layer

### 2.1 Transport and multiplexing

`bf42plus/src/bf/gameevent.h` declares the engine's stream interface:

```cpp
class IStreamManager : public IBase {
    virtual int getStreamManagerId();
    virtual void setStreamManagerId(int);
    virtual bool processReceivedPacket(BitStream*);
    virtual void handlePacketStatus(PacketStatus&, bool&);
    virtual unsigned int transmit(BitStream*, PacketStatus&, unsigned int);
    virtual void setConnectionId(int);
    virtual int getError();
};
```

Reading: one datagram is a `BitStream`; the connection layer hands it to each
registered stream manager by ID, and `handlePacketStatus` is the ack/loss
feedback that lets a manager decide what to resend (events) or re-mark dirty
(ghosts). `GameEventManager` is one implementation (`working`). The ghost
replication manager is another; its address is not yet in `ghidra_labels.java`
(`open`, see §6 for how to find it).

Related known sites (all `working`, from bf42plus):

| address | what |
|---|---|
| `0x0040ECB0` | `Game::addPlayerInput` — client input entry |
| `0x004904F0` | `GameClient::registerPlayerAction` — bf42plus drops actions here to starve the server's 4-deep `ActionBuffer` |
| `0x004B3C90` | `GameClient::syncFunc` — unnamed sync path, worth reading |
| `0x004B4045` | call to `GameEvent::deSerialize` inside `GameEventManager::processReceivedPacket` |
| `0x004B6FFD`, `0x004B6F6C` | server ping / ping interval |
| `0x00490F00` | `GameClient::disconnect` |

### 2.2 Game events (reliable stream)

`GameEvent` is `{ vtable, sequenceNumber, nextEvent }` followed by event-specific
fields. The client pulls decoded events with
`GameEventManager::getNextRcvdEvent()` (`0x004B34B0`), which bf42plus already
hooks (`GameEventManager::getNextRcvdEvent_hook` in `gameevent.cpp`). Events are
constructed by a factory registered per ID (`GameEvent::registerEventMaker`,
`0x004A7D70`), which is also how bf42plus adds its own event types.

Known IDs and layouts (all `working`, struct sizes are `static_assert`ed):

| id | event | replay use |
|---|---|---|
| 0x01 | HUDText | ignore |
| 0x08 | CreatePlayer `{team, spawngroup, isRemote, name[32], playerID, playerNetID, vehicleNetID, cameraNetID, kitNetID, isAI}` | player roster and the **player → ghost ID link** |
| 0x0C | DestroyPlayer `{playerid}` | leave |
| 0x12 | Vote | optional |
| 0x17 | WelcomeMsg | server settings text |
| 0x1C / 0x1D | Create/UpdateStaticObject | bf42plus-only extension |
| 0x24 | GameStatus `{PLAYING, ENDGAME, PREGAME, PAUSED, ENDMAP}` | round boundaries |
| 0x27 | SpecialGameEvent `{action}` | `action==2` means "database sent"; others unknown |
| 0x28 | ChatFragment | chat |
| 0x2A | ScoreMsg `{eventid, playerid, victimpid, weapon, bodypart}` with `eventid ∈ {FLAGCAPTURE, ATTACK, DEFENCE, KILL, DEATH, DEATHNOMSG, TK, SPAWNED, OBJECTIVE, OBJECTIVETK}` | kills, deaths, spawns, captures |
| 0x34 | DataBaseComplete | end of join-time world dump |
| 0x36 | SetLevel | map name |
| 0x39 | SetTeam `{playerid, teamid}` | team switch |
| 0x3A | RadioMessage | optional |

The exe registers exactly 51 event types, read from the registration calls
themselves by `event_sizes.py` (`working`): 0x02–0x1B, 0x1E, 0x23–0x2B,
0x2F–0x37, 0x39–0x3E. That replaces an inferred list that stood here before and
was wrong in places — it claimed 0x1F–0x22, 0x2C–0x2E and 0x38, which the exe
never registers, and missed 0x3B–0x3E. 0x01, 0x1C and 0x1D are bf42plus's own.
Everything not in the table above is unnamed (`open`).
`GameClient::processEvent` (`0x004933D0`) is one big switch over them;
`0x004B4C20` handles 0x2B.

Each event's exact size is a literal in the engine's code: every maker's
`createEvent` opens with `mov ecx, sizeof(T); call GameEvent::allocate`
(`0x004A6290`). So the whole table comes out of the exe without Ghidra, and it
agrees with all 10 structs bf42plus `static_assert`s. Sizes include the 12-byte
header, so the payload is size − 12 (`working`):

| id | size | id | size | id | size | id | size | id | size | id | size |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0x02 | 16 | 0x03 | 16 | 0x04 | 17 | 0x05 | 22 | 0x06 | 14 | 0x07 | 43 |
| 0x08 | 57 | 0x09 | 15 | 0x0A | 15 | 0x0B | 14 | 0x0C | 13 | 0x0D | 50 |
| 0x0E | 14 | 0x0F | 13 | 0x10 | 13 | 0x11 | 13 | 0x12 | 29 | 0x13 | 112 |
| 0x14 | 52 | 0x15 | 135 | 0x16 | 31 | 0x17 | 84 | 0x18 | 16 | 0x19 | 119 |
| 0x1A | 63 | 0x1B | 45 | 0x1E | 14 | 0x23 | 15 | 0x24 | 51 | 0x25 | 14 |
| 0x26 | 15 | 0x27 | 13 | 0x28 | 38 | 0x29 | 20 | 0x2A | 26 | 0x2B | 149 |
| 0x2F | 14 | 0x30 | 74 | 0x31 | 74 | 0x32 | 74 | 0x33 | 12 | 0x34 | 16 |
| 0x35 | 12 | 0x36 | 158 | 0x37 | 76 | 0x39 | 14 | 0x3A | 16 | 0x3B | 16 |
| 0x3C | 14 | 0x3D | 84 | 0x3E | 13 | | | | | | |

Things the table settles on its own:

- `DataBaseComplete` (0x34) is 16 bytes, so it carries a 4-byte payload; it is
  not a bare signal.
- 0x33 and 0x35 are 12 bytes — header only. Those two *are* pure signals.
- `SetLevel` (0x36) is the largest event at 158 bytes. The phase 1 recorder's
  fixed 48-byte dump, capped by a 64-byte buffer, could never have recovered
  the map name from it.

The recorder reads the same literal at runtime and dumps each unknown event's
exact payload (format v2, §9), so layouts fill in from real traffic without
guessing where an event ends.

Join sequence, observed by the DLL author (`working`): after connect the server
replays its "database" — a CreatePlayer for every player, each followed by a
`ScoreMsg/SPAWNED` (which is why bf42plus has to suppress SPAWNED before
DataBaseComplete), then `SpecialGameEvent(2)`, then `SetLevel`, then
`DataBaseComplete`. A replay file recorded from join therefore starts with a full
roster for free.

### 2.3 Object replication (ghost stream)

`bf42plus/src/bf/object.h`:

```cpp
class NetworkableBase : public IBase {
    uint16_t networkID;
    NetworkInfo* networkInfo;      // from ObjectTemplate.networkableInfo
    float basePriority;
    void* pINetworkableObject;
    int updateIndex;
    int bsStartPosition;
public:
    virtual bool init(void* object);
    virtual uint32_t getGhostStateMask() const;
    virtual void updateStateMask(uint32_t mask);
    virtual bool getNetUpdate(BitStream&, BaseLineData*, uint32_t, int32_t, bool);  // server side: write
    virtual void setNetUpdate(BitStream&, float time, bool, BaseLineData*, bool);   // client side: read + apply
    virtual bool getBaseLine(BaseLineData&);
    virtual int getMinimumBitSize() const;
};
```

and every `IObject` carries `NetworkableBase* networkable` at `+0x68`
(`IObject::getNetworkable()`), null for purely local objects.

What this tells us (`inferred` unless noted):

- **Dirty-mask delta replication.** `getGhostStateMask`/`updateStateMask` is the
  per-object bitmask of which state groups changed since the last ack.
  `getBaseLine`/`BaseLineData` is the reference state used to delta against.
  This is the Tribes/Torque ghosting model; DICE's naming ("ghost") matches.
- **Priority scheduling.** `basePriority` comes from the template's
  `NetworkableInfo` (.con: `NetworkableInfo.createNewInfo`,
  `setBasePriority`, `setPredictionMode PMNone|PMLinear|PMCubic`,
  `setForceNetworkableId`). The server has a bandwidth budget per client and
  sends higher-priority / closer objects more often. Prediction mode is what the
  client uses to extrapolate between updates. The extraction pipeline already
  parses `.con`, so these values can be read per template if the viewer needs
  them for interpolation.
- **Per-class wire format.** `setNetUpdate` is implemented per object class
  (soldier, vehicle physics, control point, kit, projectile...). The bitstream
  layout is *not* self-describing: to decode it offline you must reimplement
  each class's reader. `BitStream` (`net.h`) exposes the quantisers they use:
  `readCompressedVector(base, scale)`, `readHighCompressedVector`,
  `readNormalVector(bits)`, `readUnitQuaternion(bits)`, `readSignedFloat(bits,
  scale)`; addresses for the basic ones are `working`, the vector ones are
  declared but not yet bound.
- **Network ID space is 16-bit** (`working`): `CreatePlayerEvent` carries
  `vehicleNetworkID`, `cameraNetworkID`, `kitNetworkID` as `uint16_t`.
- **Relevance / culling: the server withholds distant objects** (`working`, see
  §10). The hypothesis here used to be "everything, at varying rate", on the
  strength of the DLL author's note that the server "sends back the result,
  which includes every detail about every object that is being synced". The
  first recording refutes it: the client held 22 of Wake Island's 32 spawned
  objects, and the split was purely by distance. **One recording client does not
  see the whole round**, which is the single most consequential fact in this
  document — it invalidates the single-client version of strategy A as a route
  to a complete replay.

### 2.4 Client → server

`working`: one `PlayerAction` per 33 ms (30 Hz), queued by
`GameClient::registerPlayerAction` (`0x004904F0`); the server buffers up to 4 per
player. For a replay this direction is irrelevant except for one thing: the
**local player's own soldier is client-predicted**, so its position in the
client's world is the prediction, not the last server value. Acceptable; it is
corrected by the server anyway.

---

## 3. What a replay needs, and where each piece comes from

| need | source | cost |
|---|---|---|
| map, mod, server, round start/end | `SetLevel`, `GameStatus`, `WelcomeMsg` events | free (hooked) |
| roster, teams, joins/leaves | `CreatePlayer`, `SetTeam`, `DestroyPlayer` | free (hooked) |
| kills, deaths, spawns, TKs, captures, weapon | `ScoreMsg` | free (hooked) |
| chat, radio | `ChatFragment`, `RadioMessage` | free (hooked) |
| **positions and orientations of soldiers and vehicles over time** | ghost stream, already applied to `IObject` transforms | sampler (§4A) or decoder (§4C) |
| who is in which vehicle / seat | `IPlayerControlObject::getOccupingPlayer()` on each PCO, or `BFPlayer::getVehicle()` | sampler |
| control point owner and capture progress | control point objects (`ObjectManager_getControlPointVector`) | sampler; field offsets `open` |
| health, ammo, vehicle damage | ghost fields; not exposed by current bf42plus headers | decoder, or find the offsets (`open`) |
| projectiles (tank shells, bombs) | ghosted with high priority; `ObjectManager_getProjectileMap` exists | sampler, optional |
| tickets | not yet located on the client (`open`); scoreboard reads them from somewhere | find offset |

---

## 4. Capture strategies

Four options, in order of how fast they produce a playable file. The
recommendation is **A first, B alongside it, D as ground truth, C later**.

### A. World-state sampler (recommended first)

Do not touch the bitstream. After the client has processed a frame's network
input, walk the object manager and write down what changed.

- **Hook point:** the per-frame hook bf42plus already owns at `0x004670A5`
  (`install_hook_Renderer_draw_1`, `renderer.cpp`), which already iterates
  `ObjectManager_getAllRegisteredObjects()` and filters root objects with
  `flags & 0x02000000 && !(flags & 1)`. The sampler is the same loop with a
  `getNetworkable() != nullptr` filter. The game is single-threaded, so the
  world is consistent at that point.
- **Per object per sample:** `networkID` (u16), template id (u32, first time
  only, with the template name in the header), team, absolute position (3 ×
  f32), orientation (quaternion from `getAbsoluteTransformation()`), occupying
  player ID for PCOs, `isObjectDestroyed()`.
- **Rate:** 10 Hz to start (configurable). Skip an object whose transform has
  not changed since its last write.
- **Events:** the existing `getNextRcvdEvent_hook` switch gets one extra call,
  `replay_logEvent(event)`, that serialises the known structs and dumps raw
  bytes (`sizeof` is known from the factory) for unknown IDs.
- **Why it is the simplest:** ~300 lines, no new reverse engineering, uses only
  APIs the DLL already has (`IObject`, `BFPlayer`, `ObjectManager_*`,
  `IPlayerControlObject`). Playable on the first run.
- **Limits:** fidelity is whatever the server chose to send *this* client.
  Distant objects update rarely and are extrapolated by the client's prediction
  mode; that extrapolated position is what gets sampled. Health/ammo need
  offsets we do not have yet. If T1 shows distant objects are withheld entirely,
  a dedicated spectator client (see §5) is the fix.

### B. Raw datagram tap (cheap companion)

Hook `ws2_32!recvfrom` (and `sendto`) through the import table and append every
datagram with a QPC timestamp to a side file. Zero decode. This is a few dozen
lines, costs nothing at runtime, and preserves the round losslessly so that
strategy C can be developed offline against real captures instead of needing a
live server each time. Also lets `.pcap` tooling look at it. Ship it in the same
build as A.

### C. Full bitstream decode (the long game)

Hook `GameEventManager::processReceivedPacket` and the ghost manager's
equivalent, and re-read the `BitStream` with our own decoders per
`NetworkableBase` subclass. This yields *exactly* what the server sent, at the
server's rate, including health/ammo/damage, and is the only route to a compact
canonical format. It requires, per replicated class, reading `setNetUpdate` in
Ghidra and reproducing its quantiser calls. The Linux dedicated server
(`bf1942_lnxded.static`, 54,895 symbols) names every one of those classes and
methods, so the work is bounded and mechanical, but it is weeks, not days. Do
this after A proves the viewer side.

### D. Server event log (zero code, ground truth)

The LAN server can write `mods/<mod>/logs/ev_<port>-<date>_<time>.xml` when
`game.serverEventLogging 1` is set (bf1942-linux's
`patch-existing-logging.sh` enables it). It contains create/destroy player,
spawn, score, chat, radio, team, vehicle enter/exit and periodic status blocks,
many with a `player_location` parameter. It has no continuous positions, so it
cannot replace A, but it is the authoritative cross-check for the event half of
the recording and can drive a low-fidelity "dots on a map" replay immediately.

---

## 5. Tests to run on the LAN server before building

| # | question | status | how |
|---|---|---|---|
| T1 | Does the client hold a ghost for *every* networked object on the map, or only nearby ones? | **answered — only nearby ones**, §10 | `coverage.py` diffs a recording against the level's `ObjectSpawns.con`. |
| T2 | Update rate versus distance | open | Log the wall-clock interval between transform changes for one vehicle at 50 m, 500 m, 1500 m. Needs a second player; the first recording had one. |
| T3 | Does a dead player's soldier object linger, and does respawn reuse the network ID? | open | Log CreatePlayer `vehicleNetworkID` and the soldier's `networkID` across a death/spawn. |
| T4 | Do a spectator (free camera, never spawned) and a playing client receive the same object set? | blocked | The sampler does not run before spawn; see §10. Fix the frame hook first. |
| T5 | Is the object set complete right after `DataBaseComplete`, or do ghosts trickle in afterwards? | open | Needs a recording started *before* connecting; see §10. |

T1 and T4 decide the architecture; the rest tune the sampler. T1 is now
answered, and it rules out the single-client recorder.

---

## 6. Reverse-engineering the ghost manager (host Ghidra work)

Needed for strategy C and for the `open` offsets (health, tickets, control point
state). All of it happens on the host with `xref.py` and the Linux server
symbols; none of it can run in this sandbox.

1. Name the classes from the server binary:
   ```bash
   nm -C bf1942_lnxded.static | grep -iE 'ghost|networkable|streammanager|packetstatus|baseline' | sort -k3
   ```
   Expect `dice::bf::...Ghost...Manager`, per-class `getNetUpdate`/`setNetUpdate`,
   and `NetworkableInfo`.
2. In the client, `IStreamManager::processReceivedPacket` is vtable slot 5
   (`+0x14` after `IBase`). Find every vtable that has `GameEventManager`'s
   shape and a different slot-5 target; the other one is the ghost manager.
   Cross-check against the server's `processReceivedPacket` implementations.
3. `NetworkableBase::setNetUpdate` is slot 4 (`+0x10`). Its callers inside the
   ghost manager's `processReceivedPacket` show the per-packet framing (object
   ID width, update-vs-baseline flag, mask width). Record each finding with
   `./xref.py add` so it lands in `symbols.json`.
4. For health/tickets/control-point owner, decompile the scoreboard and HUD
   readers (`BfMenu` at `0x006Axxxx`, already labelled) and follow what they
   dereference.

---

## 7. Phase plan

**Phase 1 — record (bf42plus).** Setting `recordReplays` (default off) and
console command `plus.record start|stop`. On `SetLevel`, open
`replays/<server>_<map>_<yyyymmdd-hhmmss>.ndjson`; on `GameStatus(ENDMAP)` or
disconnect, close it. First line is a header (mod, map, server, template
id→name table, local player ID). Then one line per event and one line per
sample tick containing only changed objects. NDJSON is deliberately verbose:
it is readable in an editor and loads in the viewer with `JSON.parse` per line.
Also write the raw datagram tap (strategy B) next to it. Compression and a
binary frame format come when a real file is too big to upload, not before.

**Phase 2 — play (map viewer).** `map.html` already loads the level glb, drives
flag animations and has `soldier.js`. Add a replay loader that reads the NDJSON,
builds a timeline, places one instance per network ID (soldier mesh or the
vehicle glb from `models/` by template name), interpolates between samples with
a scrubber, and overlays the event feed. Control point ownership drives the
existing flag animation.

**Phase 3 — fidelity.** Run T1–T5, then either a spectator-client recorder or
strategy C for the fields the sampler cannot see.

**Phase 4 — upload.** Replay upload endpoint on the API, storage next to the
mesh assets on the PVC, a replay tab on the round report. Out of scope until a
file exists.

---

## 8. Open questions for the user

- Is the LAN server the Linux dedicated build with `bf1942_lnxded.static`
  available? Its symbols are the shortcut for everything in §6.
- Which map/mod is the test target? Vanilla keeps the template table small.
- Is a dedicated always-connected spectator client acceptable as the recording
  source, or must recording work from a normal playing client? (T4 answers
  whether it matters.)

---

## 9. Phase 1 as built (bf42plus `recordReplays`)

Implemented in bf42plus on branch `claude/wizardly-cray-kdmhan` as
`src/replay.cpp`. Enable with `recordReplays=on` in `bf42plus.ini` or
`plus.recordReplays 1` in the console. Output is
`replays/replay_<yyyymmdd-hhmmss>.ndjson` in the game directory, one JSON
object per line, `t` in seconds since the file was opened. Closed on
`GameStatus(ENDMAP)` or when the setting is turned off; flushed every 2 s so a
crash loses at most that.

| `k` | meaning | fields |
|---|---|---|
| `h` | header | `v` format version, `plus` DLL version, `start` local time, `hz` sample rate |
| `e` | game event | `e` name and per-event fields (see `replay_onEvent`). `e:"raw"` is an event whose struct is unmapped: `type`, `size` (sizeof the event class read from the engine's maker, header included) and exactly `size - 12` payload bytes as hex. `size:null` means the maker could not be read and `raw` is a fixed 48-byte prefix that may run past the end of the event. Format v1 had no `size` and always dumped 48 bytes. |
| `o` | networked object first seen | `id` network ID, `gid` object-manager ID, `tmpl` template name, `tid` template ID, `team` |
| `s` | sample | `o` is a list of `[id, x, y, z, qx, qy, qz, qw]`, only objects whose transform moved since their last write |
| `d` | object gone | `id` |
| `p` | player state changed | `p` is a list of `[pid, team, vehicleNetId]` |
| `cp` | control point | `id`, `team`; on first sight also `name`, `tmpl`, `pos` |
| `end` | file closed cleanly | |

Run `summarize.py` on a recording for the record counts, roster, event kinds and
raw dumps of unmapped events. Run `coverage.py` to answer T1 against a specific
level.

Known gaps in this cut, on purpose: no map name (it is in the 0x36 raw dump
until the struct is mapped), no health or ammo, no turret or child transforms,
and the local player's soldier is client-predicted.

---

## 10. What the first recording showed

`replay_20260915-143655.ndjson`, Wake Island, 30.1 s, one player, recorded from
a normal playing client on the LAN server. 274 lines, 24 KB. Built with
`bf42plus/tools/build-linux.sh` (MSVC under Wine; the recorder itself is
unchanged from §9).

### 10.1 T1: the server withholds distant objects — `working`

`coverage.py` matched the recording against `Wake/Conquest/ObjectSpawns.con`
(read from `Wake_003.rfa`, the patch archive the engine actually loads):

```
spawn points defined by Wake/Conquest : 32
networked objects in the recording    : 30
spawn points covered                  : 22
spawn points MISSING                  : 10

farthest covered spawn point : 555m
nearest missing spawn point  : 547m
```

The client sat at `(1396, 120, 628)` and moved at most 75 m. Every covered
spawn point is within 555 m of it; every missing one is 547 m or further, out to
the Japanese carrier and destroyer at 1115–1161 m. The boundary is that sharp.

The two farthest missing objects are team 1 and the client was team 2, so team
is a confound for *those two* — but the other eight misses are all team 2, the
client's own team, and they are missing purely on distance. Distance is the
explanation.

Consequences, in order of how much they hurt:

1. **A single playing client cannot record a complete round.** Strategy A as
   written produces a replay of what one player was near. §2.3's "everything, at
   varying rate" is wrong.
2. The viewer will show objects appearing and disappearing as the recording
   client moves, unless the format distinguishes "gone" from "no longer
   replicated to us". The `d` record currently cannot tell those apart.
3. The remaining routes to a complete round are: a spectator client that orbits
   the map (still lossy, and blocked — §10.4), several clients merged by network
   ID, or capture on the server side. This is now the open design question, and
   it should be settled before any more work goes into the viewer.

What is *not* yet established: whether the ~550 m boundary is a fixed radius, a
bandwidth-driven priority cut-off that varies with server load and player count,
or simply "the client is never told about objects it has not been near". The
recording cannot distinguish these — it is one client, stationary, 30 s. T2 with
a second player driving outward is the test that separates them.

### 10.2 Event 0x29 is a 10-second periodic counter — `inferred`

The only events in the whole recording were three of type `0x29`, at
t = 7.228, 17.228, 27.228 — exactly 10 s apart. Payloads:

```
0x29: 00000000 ea010000 0000...   -> u32[0]=0, u32[1]=490
0x29: 00000000 f4010000 0000...   -> u32[0]=0, u32[1]=500
0x29: 00000000 fe010000 0000...   -> u32[0]=0, u32[1]=510
```

`u32[1]` rises by exactly 10 per 10 s, i.e. one per second, which reads as
elapsed round time in seconds rather than a ticket count (tickets do not move
at a fixed 1/s, and would fall, not rise). The round would have started ~490 s
before recording began, which fits a session already in progress. `u32[0]` is 0
throughout and may be a team or type selector that a two-team round would
disambiguate. Everything past the first 8 bytes was zero, and that is now
explained exactly: 0x29 is a 20-byte class (§2.2), so its payload is those two
`u32`s and nothing else. The other 40 bytes of the dump were read past the end
of the event.

`0x29` was unnamed in §2.2's table. This does not yet locate tickets, which
§3 still lists as `open`.

### 10.3 Recording must start before connecting

The file contains no `createPlayer`, `setLevel` or `dbComplete`, because
`plus.recordReplays 1` was typed after joining and the join-time database dump
had already been replayed. Consequences: no player *names* (the `p` sample
carries `[pid, team, vehicleNetId]` only), and no map name.

So: set `recordReplays=1` in `bf42plus.ini` before launching, or enable it and
reconnect. T5 cannot be tested any other way either, since it is defined
relative to `DataBaseComplete`.

### 10.4 T4 is blocked by where the frame hook sits

`replay_onFrame` is called from `hook_Renderer_draw_1`, which dereferences
`BFPlayer::getLocal()->getVehicle()` a few lines above the call site. A client
that has never spawned has no vehicle, so the sampler never runs. A spectator
recorder — the obvious response to §10.1 — cannot be tested until the sampler
is called from somewhere that does not require a spawned local player.

### 10.5 Confirmed incidentally

- Control point ownership at `+0x190` and the template name at `+0x2D0` read
  correctly: all five Wake flags reported team 2 with the right names
  (`Landing_Beach`, `The_Airfield`, `South_Base`, `North_Base`, `Village`) and
  positions matching the level. Team 2 is Allies.
- `IObject::getTeam()` returns -1 for control point objects; only the `+0x190`
  read gives the owner. The `o` record's `team` field is therefore not usable
  for flags.
- Volume is not a problem. 28 of 30 objects never moved after first sight, so
  the change-detection filter did its job: 24 KB for 30 s, and almost all of
  that is the one moving soldier. A busy 64-player round will be far larger,
  but nothing here suggests the format needs compressing yet.
- The `cp` name is the raw localisation key from the template
  (`Landing_Beach`), not the localised string `renderer.cpp` displays. Better
  for a replay file; the viewer should localise at display time.
