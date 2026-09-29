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
| 0x27 | SpecialGameEvent `{action}` | `action==2` means "database sent"; `action==0` is a refill: lnxded `GameServer::triggerSpecialGameEvent` (0x081591a0) sends it to the client of a player a depot resupplies, whose soldier plays `SoldierRefillAmmo.ssc` (`BFSoldier::triggerRefillAmmoSound` 0x0827ebc0, sound trigger 0x1a), every half second at the depot (12 in replay_20260927-203459); type 1 is the hit indication, which rides the control-object state to a remote client instead (ledger XHIT-6) |
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
  to a complete replay. §11 narrows this: the cut-off is ~520 m around the
  client's *current* viewpoint, and the reliable event stream still announces
  every object with its spawn transform (event 0x07). One client lacks the
  motion of distant objects, not their existence.

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
| projectiles (tank shells, bombs) | **not achievable from a single client** — see §13 | n/a, architectural ceiling |
| tickets | the client's replicated `ScoreManager`, `TeamScore +0x48` (§17) | recorded as `tk` from bf42plus `e692f14` |

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
| T1 | Does the client hold a ghost for *every* networked object on the map, or only nearby ones? | **answered — only within ~520 m of the current viewpoint**, §10, §11.1 | `coverage.py` diffs a recording against the level's `ObjectSpawns.con`. |
| T2 | Update rate versus distance | open | Log the wall-clock interval between transform changes for one vehicle at 50 m, 500 m, 1500 m. Needs a second player; the first recording had one. |
| T3 | Does a dead player's soldier object linger, and does respawn reuse the network ID? | open | Log CreatePlayer `vehicleNetworkID` and the soldier's `networkID` across a death/spawn. |
| T4 | Do a spectator (free camera, never spawned) and a playing client receive the same object set? | open | Not blocked after all (§11.1): the sampler runs on the spawn screen, where relevance follows the free camera. |
| T5 | Is the object set complete right after `DataBaseComplete`, or do ghosts trickle in afterwards? | open | Needs a recording started *before* connecting; see §10. |

T1 and T4 decide the architecture; the rest tune the sampler. T1 is now
answered, and it rules out the single-client recorder.

---

## 6. Reverse-engineering the ghost manager (host Ghidra work)

Needed for strategy C and for the `open` offsets (health, tickets, control point
state). It needs `xref.py` and the Linux server symbols, and was believed to be
host-only — **wrong as of 2026-09-15**: the Ghidra bridge was live and connected
to `BF1942.exe` in-session (`xref.py check` reported a sha256 match), and was
used to decompile real client functions for §13. Whether it is available is
apparently session-dependent; check with `xref.py check` rather than assuming
either way.

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

Implemented in bf42plus as `src/replay.cpp` (sila-skandia/bf42plus, `master`). Enable with `recordReplays=on` in `bf42plus.ini` or
`plus.recordReplays 1` in the console. Output is
`replays/replay_<yyyymmdd-hhmmss>.ndjson` in the game directory, one JSON
object per line, `t` in seconds since the file was opened. From format v3 a
file closes when a new join sequence begins (event 0x1A), when the game exits,
or when the setting is turned off. v1 and v2 closed at `GameStatus(ENDMAP)`,
which cut off the teardown the server sends after it and split one map into two
files. Flushed every 2 s, so a crash loses at most that.

| `k` | meaning | fields |
|---|---|---|
| `h` | header | `v` format version, `plus` DLL version, `start` local time, `hz` sample rate |
| `e` | game event | `e` name and per-event fields (see `replay_onEvent`). `e:"raw"` is an event whose struct is unmapped: `type`, `size` (sizeof the event class read from the engine's maker, header included) and exactly `size - 12` payload bytes as hex. `size:null` means the maker could not be read and `raw` is a fixed 48-byte prefix that may run past the end of the event. Format v1 had no `size` and always dumped 48 bytes. v3 adds `tmpl`, the template name, to object-creation events (type 7). |
| `o` | networked object first seen | `id` network ID, `gid` object-manager ID, `tmpl` template name, `tid` template ID, `team`; v3 adds `maxhp` and `crit` (the critical-damage threshold) for objects with armor |
| `s` | sample | `o` is a list of `[id, x, y, z, qx, qy, qz, qw]`, only objects whose transform moved since their last write |
| `d` | object gone | `id` |
| `p` | player state changed | `p` is a list of `[pid, team, vehicleNetId]` |
| `cp` | control point | `id`, `team`; on first sight also `name`, `tmpl`, `pos` |
| `a` | hit points (v3) | `a` is a list of `[id, hitPoints, lastHitPlayer]` for objects with armor, written whenever an object is first seen or comes back into relevance range, and whenever either value changes. Only a change in value is damage. `lastHitPlayer` is always -1 on the client: the server does not replicate it (§11.8) |
| `chat` | a line shown in the chat box (v3) | `pid`, `team`, `text`; includes the recording player's own chat, which never arrives as a ChatFragment event. `text` is the line as displayed, with the `name: ` prefix, and `t` is when it was displayed |
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

*Settled since. It is a fixed radius, the level's view distance plus 20 m
around the viewpoint, about 520 m on Wake. §11.1 measured it and §19 read it
from the server.*

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
relative to `DataBaseComplete`. (Since bf42plus `ea600c1` a file begun after
the join names its level, server and players anyway: §18.)

### 10.4 T4 is not blocked (corrected in §11.1)

This section first said the sampler could not run before spawn, because
`hook_Renderer_draw_1` dereferences `BFPlayer::getLocal()->getVehicle()` above
the call site. That was wrong: before spawning, the player's vehicle is the
free camera, so the dereference is valid and the sampler runs on the spawn
screen. Both later recordings sampled there.

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

---

## 11. The second and third recordings, checked against the server's own log

`replay_20260915-204355` (format v2: the last 40 s of a round, then the map
change) and `replay_20260915-210619` (163 s: a Sherman killed with four rockets,
a jeep driven, parked and destroyed, an SBD destroyed, two respawns). Both are
aligned with the LAN server's event log (`game.serverEventLogging 1`, written to
`mods/bf1942/logs/ev_<port>-<date>_<time>.xml`), which is ground truth. Spawn,
`setTeam`, `enterVehicle`, `exitVehicle` and the round clock agree between the
two within 30 ms, so the timings below are measured.

### 11.1 Corrections to §10

- **T4 was never blocked.** Before spawning, the player's vehicle is the free
  camera: `p` records show vehicle net id 2, and the server logs `exitVehicle
  MultiPlayerFreeCamera` when a never-spawned player leaves.
- **The relevance cut-off is ~520 m around the current viewpoint.** Objects were
  added at 518.5, 518.5 and 520.0 m and dropped at 519.9 m, from the spawn-screen
  camera and from the soldier alike. At spawn the replicated set swapped in one
  sample, so it is not "stays replicated once you have been near". Control
  points are exempt: they stayed replicated at 687 m. Wake sets
  `Game.setViewDistance 500`, the likely driver; the extra ~20 m is the
  server's own (§19).
  Confirmed on a second map (2026-09-27): Kursk sets `Game.setViewDistance 400`,
  and in `replay_20260927-140921` (a public server) an Ilyushin left the
  recording player's range at 414 m and 416 m and came back at 407 m. So the
  cut-off follows the level's view distance, the fog line the player could not
  have seen past anyway. §19 reads the rule from the server, a flat 20 m past
  it, which is 420 m on Kursk. The replay holds such an object at
  its last pose as a translucent ghost, and the followed player's card says
  when he went out of range.
- **The round did not end on a time limit.** The server runs
  `serverGameTime 0`. On the empty server every round lasted exactly 1200 s
  from `roundInit` because team 1's 200 tickets drained at one per 6 s
  (`victorytype 4`).
- **The client relaunches between maps; the server does not.** The dedicated
  server process has run since it was started. The client exits and restarts on
  every map change, which is why v2 produced a separate file after the change.

### 11.2 One client is told about every object

Event 0x07 announces all 44 objects at join, including the nine that were never
replicated to the client: the carrier, the destroyer, deck aircraft, landing
craft beside the ships and a Defgun at 592 m. Each carries its template id and
exact spawn transform. So a single recording has the complete roster and every
spawn position. What it lacks beyond ~520 m is motion.

### 11.3 Event layouts decoded (`working` unless marked)

Offsets are into the payload, after the 12-byte header. The class names and
the rows marked 2026-09-27 come from the Linux server's own event classes,
registered by id in `GameEvent::initEvents` (`0x0811bee0`), whose in-memory
layout the client's `GameClient::processEvent` (`0x004933D0`) reads at the same
offsets, checked field by field against `replay_20260927-001120` and its
server log. They correct the 2026-09-15 readings of 0x05, 0x13, 0x16, 0x29,
0x30/0x31 and 0x37. "World time" is the server's round clock
(`WorldPref::mWorldTime`), which resets to 0 at PREGAME, the log's `roundInit`.

| id | class | layout | evidence |
|---|---|---|---|
| 0x04 | SimulationEvent | `u8` running (always 1), `f32` world time | sent once per join, answering the client's DatabaseCompleteAck (`sendSimulationMsg` `0x081349a0`); 288.533 against the log's 288.56. The log offset is `roundInit + worldTime - t` |
| 0x05 | CreateMultipleObjectsEvent | `u32` template, `u16` first netId, `i32` count | 2026-09-27: a kit's networked projectile pool (`FireArms::initProjectilePool` `0x08287a80`), `count` objects from the first id, made at the spawn between the soldier and the kit. Not a weapon: US kits get GrenadeAlliesProjectile x3, Japanese GrenadeAxisProjectile x3, Scouts add BinocularsProjectile x1, engineers LandmineProjectile x9 and ExpPackProjectile x9 |
| 0x06 | DestroyObject | `u16` netId: object destroyed | every object at round end; each wreck 10.06 s after its kill |
| 0x07 | CreateObject | `u32` templateId, `u16` netId, `u8 1`, `vec3` position, `vec3` rotation in degrees | 46 of 46 decode; positions equal `ObjectSpawns.con`, rotation equals its `Object.rotation` |
| 0x09 | PlayerControlObject | `u8` playerId, `u16` netId: player now controls object | soldier at spawn, camera at death and round end |
| 0x0A | EnterVehicle | `u8` playerId, `u16` netId | server `enterVehicle` 4 ms apart. The netId is the seat's: a hull's nested PlayerControlObjects take the ids straight after its own (Sherman 532, hull gun 533; Shokaku 534, AA batteries 535..538) |
| 0x0B | ExitVehicle | `u8` playerId, `u8` flag; flag 1 during round-end teardown | server `exitVehicle` 30 ms apart |
| 0x13 | MapEvent | `u8` add, `u8` map length, `u8` mod length, `u8` GamePlayMode (1 CTF, 2 CQ, 3 TDM, 4 COOP, 5 OBJECTIVEMODE), `char[64]` map, `char[32]` mod | 2026-09-27: one per map-rotation entry at join (`sendMapList` `0x08134360`); mode 2 in 24 conquest joins, 4 in the coop one |
| 0x14 | ChallengeEvent | `char[10]` challenge, `char[16]` mod, `u8` length, `i32` xpack id (-1 vanilla), `char[8]` zeros | the client hashes `BF1942.exe` and `objects.rfa` with it (answer 0x15) |
| 0x16 | GameRulesEvent | `u8` external views, `u8` nose cam, `f32` soldier FF, `f32` ticket ratio, `u32` time limit (0 none), `u32` world time, `u8` crosshair centre point | 2026-09-27: at join, at every PREGAME (world time 0) and whenever a rule changes; not only a join snapshot |
| 0x1A | ServerInfoEvent | 3 x `{char[16], u8 length}`: map id, mod, game id | first event of every join; the client relaunches into the mod |
| 0x1B | ServerInfoEvent2 | `char[32]` server name, `u8` length | "BF1942 server1", "bfstats-lab" |
| 0x23 | PickupKit | `u8` playerId, `u16` netId: kit | server `pickupKit` in the same tick |
| 0x29 | TimerSyncEvent | `u32` time limit (0 none), `u32` world time **rounded** to the second | 2026-09-27: every 10 s (`updateConnections` `0x081391f0`); 591, 601, 611 in replay_20260926-224904 |
| 0x30 / 0x31 / 0x32 | StatsKills / StatsShots / StatsHits | `u8` rows-1, `u8` playerId, `u32[10]` template ids, `u16[10]` counts; only the first rows are real, the rest stale stack | 2026-09-27: each player's whole-round tallies at the round's end (`sendPlayerStats` `0x081534b0`): vehicles destroyed, projectiles fired and projectiles that damaged something, by template (the root vehicle's when mounted, the hand weapon's on foot). All 6 destroyed rows match the log's `destroyVehicle`; skandia's 13 Defgun shots equal his 13 Defgun presses. 0x30's 2916 in 20260915-204355 is a Sherman destroyed, not a reconnect password |
| 0x36 SetLevel | | `char[64]` level path, `char[64]` game-mode file, settings from offset 128 | `bf1942/levels/wake/`, `conquest.con`, `coop.con`; 300 = `serverNameTagDistanceScope`, 10 = `serverGameRoundStartDelay`. Bytes after each string's terminator are stale buffer contents |
| 0x37 | SessionIdEvent | `char[64]`: the server's prefix (empty) and `_ClientID_<connection>` | 2026-09-27: sent right after SetLevel; the bytes after the terminator are a stale ServerInfoEvent from the server's event pool, not mod names |
| 0x3C | HitFromPosEvent | `u8` sector the damage came from (3 bits on the wire, 45 degrees each: 0 within 22.5 of ahead, 4 behind, 1-3 and 5-7 the two sides), `u8` strength, 255 x the damage over the victim's vtable `+0x14` value (his maximum hit points), truncated | 2026-09-27: sent by `GameServer::_giveDamage` (`0x0814b870`) to the damaged player's client alone, so a recording has only its own player's hits: the HUD's hit indicator. The cos 22.5 threshold is `0x086c0b68`, the scale 255.0 `0x086c08a0`. `replay_20260927-075756` has one, `02 bf`, in the tick the recording player's SBD hit the ground (a crash has no side to confirm which of 1-3 is right). From bf42plus `9451721` it is `{"e":"hitFrom","dir","strength"}` |

Template ids are the load order of the client's templates, so they mean
nothing outside the recording: from format v4 the recorder names them at
record time (`ObjectTemplateManager::getTemplate`), for a pool's projectile, a
tally's key and a kill's weapon.

`ScoreMsg` SPAWNED leaves `weapon` and `bodypart` uninitialised (garbage in one
recording, zero in the next). The DEATH at round end is teardown, not a kill.

A number can match by coincidence: 2916 is also the Sherman's template id, and
0x30 was briefly misread as a tank event because of it. Cross-check a field
against a second source before naming it.

### 11.4 How a vehicle dies, as the client sees it

Measured three times (Sherman, Willy, SBD) against the server's `destroyVehicle`:

1. **Hits: no event, no movement.** Four rockets over 30 s left the Sherman's
   transform untouched while the player watched it smoke. Damage exists only in
   the Armor component's replicated hit points (§11.5).
2. **Destruction: still no event.** The vehicle jumps 1.5–3.3 m and tilts,
   visible in the first sample after the kill (0.07–0.18 s later).
3. **Wreck:** the same object, still replicated, for 10 s. Kill to destroy
   event measured 10.06 s all three times, so an explosion can be dated from
   its destroy event.
4. **0x06** removes the wreck.
5. **Respawn:** the spawner creates a replacement with a *new* network id via
   0x07 at the spawn point, within its `MinSpawnDelay`/`MaxSpawnDelay` (Sherman
   after 100 s, range 70–110; Willy after 20 s, range 10–30).

For the viewer: wreck models are already extracted (223 `models/*.wreck.glb`,
including `Sherman.wreck.glb` and `SBD.wreck.glb`), and each vehicle's
template sets its damage stages with `addArmorEffect`. The Sherman smokes at 50
of 100 hit points, burns at its `criticalDamage` of 12 and explodes at 0.

### 11.5 Hit points — `working` in BF1942.exe, recorded from format v3

- `IObject::queryComponent(0xc4a4, 0xc4a4)` returns the Armor component. The
  client makes that call itself at 84 sites (`call [edx+24h]`, vtable slot 9,
  where bf42plus's header declares it).
- The client has no RTTI for Armor. Its vtable (0x008DC7A8) was found by
  signature: a `queryInterface` comparing against 0xc4a4 plus float getters in
  slots 5, 7 and 11. It matches the Linux server's symbolised vtable slot for
  slot, and the offsets agree: hit points `+0x38`, max hit points `+0x3c`,
  critical damage `+0xf0`, last hit player `+0x14`.
- The recorder checks those getters' machine code once per vtable before
  reading the fields, and skips armor it cannot verify.
- Values to check a recording against: Sherman 100/12, Willy 50/6, SBD 130/20
  (max hit points / critical damage).

### 11.6 The recording player's own chat never arrives

The server logged 14 chat lines from the recording player; the client received
no ChatFragment event for any of them. From v3 the recorder takes chat from the
chat box instead (`chat` records).

### 11.7 The server event log as a companion

It holds exactly what the client stream lacks — kills and vehicle destruction
with positions, chat, ticket results — and aligns to a recording through the
events both share. For a server you run it is worth merging with the recording;
for a public server the client recording stands alone.

### 11.8 Format v3 verified

`replay_20260915-213110.ndjson`: 115 s, the Sherman destroyed with three
rockets and a jeep with one, chat markers typed throughout, the game quit at
the end. Checked against the server log, offset set by the spawn:

- **One file, closed cleanly.** It ends with an `end` record written as the
  game exited.
- **Every object creation is named** (46 of 46), including the objects the
  client never gets updates for: `Shokaku`, `Hatsuzuki`, four `Daihatsu`,
  `Zero`, `AichiVal`.
- **Hit points read correctly.** Max hit points and critical damage match the
  template files for every armored template seen: Sherman 100/12, Willy 50/6,
  SBD and SBD-T 130/20, Corsair 100/20, AA_Allies 100/12, M3A1 100/16, Defgun
  50/12, Stationary_Browning 45/0, USMarineSoldier 30/0.
- **Damage is visible hit by hit.** The Sherman went 100 → 67 → 33 → 0, each
  step matching the player's markers ("hit, not smoking" at 67, above the smoke
  threshold of 50; "smoking" at 33).
- **Zero hit points is the kill.** Hit points reached 0 in the first sample
  after the server's `destroyVehicle` (+0.04 s Sherman, +0.12 s jeep), with the
  jump in the same or next sample and the destroy event 10.03 s after the kill.
- **Repeated values are re-sightings, not damage.** All 37 `a` entries that
  repeat a value fall in the same sample as an `o` record for that object
  (relevance churn while the spawn-screen camera flew to the spawn point); the
  only real changes were the four damage steps.
- **The player's own chat is captured.** All 9 lines, displayed locally 0.07–0.60 s
  before the server logged them.

Not established:

- **`lastHitPlayer` is not replicated.** It read -1 on every object, including
  both vehicles the player destroyed. Attackers are not available from Armor on
  the client; the server event log has them.
- **Burn-down below critical damage was not exercised.** Both kills took hit
  points straight to 0.

---

## 12. Playback in the map viewer

Phase 2 has a first cut: `tools/bf1942-models/viewer/replay.js`. It plays a
recording over the level `map.html` loads:

```
map.html?replay=replays/<recording>.ndjson
map.html?replay=replays/<recording>.ndjson&serverlog=replays/<ev_log>.xml
```

or a recording (and optionally its server log) opened from disk: Open
recording, or dropped anywhere on the page, plays it on its own level
(features/round-replay-ux, "Opening a recording"). The recording's SetLevel
picks the map unless `?map=` says otherwise. `replays/` is gitignored;
recordings are data.

### What the client recording alone gives

- **Every object's life.** Created (0x07), moving (samples), damaged (`a`),
  wrecked at 0 hit points (the extracted `models/<Template>.wreck.glb`),
  removed (0x06), respawned as a new network id. Everything drawn is a function
  of the recording clock, so seeking is only setting it.
- **Out-of-range objects** as translucent ghosts at their last replicated or
  announced pose, so the ~520 m relevance radius is visible rather than
  silently missing.
- **Name tags with hit-point bars** (half health and the recorded critical
  damage colour them), a follow camera on any player, including in vehicles
  and on the spawn screen, and an event feed of joins, spawns, vehicle entries
  and exits, hits, kills, removals and chat. (Since 2026-09-27 the watching
  side is features/round-replay-ux: an orbit, first-person and free camera,
  a timeline with the round's chapters, the game's own kill and chat log,
  and this event feed as the replay log, L.)

### How the server log overlays it

`alignServerLog` proposes a clock offset from every event the two share —
spawns, vehicle entries and exits, team changes, kit pickups, and chat by its
text — and keeps the offset that lines up the most. One log holds every
connection since its map loaded; this also picks out the recording's session.
Both recordings in §11 aligned without help: v3 on 12 of 12 shared events
(mean error 0.15 s), v2 on 4 of 4 (0.01 s) from the same log file.

Aligned server events join the feed marked `server` beside the client's, and
each with a position (`vehicle_pos`, `player_location`) gets a fading ring on
the level, with a beam for vehicle kills. They add what the client cannot
know: who destroyed what, round results with tickets, and exact kill positions.
The log is read with regular expressions, not an XML parser, because it is
unterminated while its round runs.

### Measured conventions it relies on

- Position: viewer = BF1942 with z negated.
- Rotation: a recorded quaternion `(x, y, z, w)` is `(-x, -y, z, w)` in the
  viewer, fitted against the vehicles baked into `maps/wake/scene.glb` at eight
  headings (|dot| ≥ 0.998; a pitched SBD rules out the alternatives). The
  replayed Sherman sits exactly on the level's parked one.
- An object-creation event's Euler angles make the same quaternion as yaw
  about +Y then pitch about X (checked on a Defgun and a parked SBD). Roll last
  is assumed.
- Samples are written only on change, so a gap between two samples is a hold,
  then the last 0.1 s is interpolated, not a slow drift across the gap.
- A soldier's sample is his engine origin, a metre over his feet
  (`setCharacterHeight -1.00`). In `replay_20260927-075756` the recording
  player's 1149 live samples lie 1.00 m (median) over Wake's terrain and 25
  bots' 20979 the same; the recording player in the six earlier files, 1.00
  each. His shots leave his camera 0.65, 0.12 and -0.70 m over his sample
  standing, crouched and prone, the template's `setPoseCameraPos`, and the
  server's log puts a live player 1.02 m over the terrain. A soldier's creation
  event is his spawn point, on the ground (0.00 m median at 30 spawns). The
  viewer stands him on his feet (`replay-recording.js` `standOnFeet`), and
  lays a player's server-log ring on the surface under him (`replay.js`
  `restOnSurface`).
- Replay models get the page's own vehicle lighting (`bindDynamicShading`),
  and the level's baked spawner vehicles are hidden so nothing is drawn twice.

### Bugs found and fixed (2026-09-15)

- **Soldier's hand detached from the body, floating near the head.**
  `load()` cloned each cached soldier template with plain `Object3D.clone(true)`
  (`replay.js:632,636` at the time). Three.js's `SkinnedMesh.copy()` copies the
  `.skeleton` reference, not the bones, so every cloned soldier's mesh stayed
  bound to the *original* cached template's skeleton — an object never added to
  the scene and so never `updateMatrixWorld()`d, leaving its bones frozen at
  identity. Skinning error scales with a bone's distance from the bind origin,
  worst for the hand. `git blame` traced the buggy clone to `44dbd77`, unfixed
  since. Fixed by vendoring three.js r169's `examples/jsm/utils/SkeletonUtils.js`
  (`vendor/utils/SkeletonUtils.js`, same pattern as the existing
  `vendor/utils/BufferGeometryUtils.js`) and calling its `clone()` instead, which
  rebuilds a parallel bone hierarchy per instance and rebinds each SkinnedMesh to
  it.
- **Soldiers facing the wrong way.** `toViewQuaternion`'s `(x,y,z,w) ->
  (-x,-y,z,w)` conversion (§12 "Measured conventions") was fitted only against
  *vehicles* baked into `maps/wake/scene.glb`; the fit absorbs each vehicle
  model's own root-orientation convention for free. The standalone soldier glb
  was never baked into a level, so nothing calibrated it, and its root carries a
  baked 180-degree turn vehicles don't have. Measured directly from
  `replay_20260915-213110.ndjson`: at the exact spawn instant of both soldier
  lives in that recording (nid 608 and 612, t=26.89s, before any player-turned
  view could confound it), the recorded quaternion is a pure yaw of 179.7-179.8
  degrees; comparing the angle `toViewQuaternion` alone produces against
  `spawnYaw()`'s already-trusted convention (used elsewhere for the free-camera
  spawn preview) gives a delta of exactly 180.00 degrees, both times. Fixed with
  a `life.soldier`-gated `group.quaternion.multiply(SOLDIER_YAW_FLIP)` in
  `place()`, `SOLDIER_YAW_FLIP = new THREE.Quaternion(0, 1, 0, 0)` — the same
  180-degree-yaw constant `kits.html`'s `SLOT_ROTATION.head` already uses for an
  unrelated head-slot attachment. Vehicles are untouched (not gated on
  `life.soldier`).
- **Tank shells and rockets never appear, even when they visibly hit and kill.**
  Not a bug in the recorder — see §13. It is not fixable by extending the
  sampler.

### Not done

- Soldiers are a static pose: position and heading only, no animation.
- v2 recordings show no damage or wrecks from the client; kills could be
  inferred from the 10.06 s destroy delay and the jump (§11.4), but are not.
- Six expected 404s per load for templates with no wreck model.
- No minimap markers, no control-point flag colours, no upload endpoint
  (phase 4).

---

## 13. Why tank shells and rockets are invisible to a single client (2026-09-15)

> **Corrected 2026-09-27 (§14).** §13.3 misread the gate. Template vtable slot
> `+0x4C` is `getNetworkableInfo()` (`0x007EB7F0` = `lea eax,[ecx+0x24]`), not
> a geometry getter: `createProjectile` builds a projectile **locally** unless
> its template declares `networkableInfo`, and only a networked one waits for
> the server. 67 of vanilla's 73 projectile templates declare none (every
> bullet, `Tracer_Projectile`, shells, rockets, bombs), so the client really
> does fly its own and every remote player's rounds; the recordings held none
> because the sampler skips objects without a networkable. The six networked
> ones are both grenades, ExpPack, Landmine, FloatingMine and the binoculars'
> marker. What a recording needs is not the round object but the moment it is
> fired, and §14 records that for every weapon the client simulates.

Two real recordings have the recording player destroy a Sherman at point-blank
range with rockets — `replay_20260915-210619.ndjson` and
`replay_20260915-213110.ndjson`, the second cross-checked against the LAN
server's own `destroyVehicle` log entry (`player_location` ~15 m from
`vehicle_pos`, matching a point-blank shot). **Neither recording contains a
single projectile object**: not in the `o` roster (39-46 objects, all
vehicles/soldiers/statics/control points), not hiding in an unclassified raw
event dump (every raw type seen is already accounted for by §11.3's table).
The target's hit points fall and it explodes right on cue (§11.4-§11.5,
`working`) — the damage is captured perfectly — but nothing ever describes the
shell in flight. This replaces §3's old "ghosted with high priority... sampler,
optional" characterisation, which was wrong on both counts, as the next four
subsections show (`working` unless marked, from decompiling the live
`BF1942.exe` via the Ghidra bridge — see the §6 correction above — and from
`nm`/`objdump` on the fully-symbolised Linux server binary,
`bf1942_lnxded.static`).

### 13.1 `ObjectManager::getProjectileMap` is a real, general registry, not mine-only

`bf42plus/src/bf/object.cpp:7-15` is a working, bound function (vtable slot
`+0x98`, declared `object.h:285`); its only call site today is the 3D
mine-warning HUD (`renderer.cpp:314-324`), which is why its header comment
reads "a map containing all projectiles which need a mine warning icon" — a
description of that one use, not a structural restriction. The server binary
names the real picture: `dice::ref2::world::ObjectManager::addProjectile`/
`::removeProjectile` sit alongside `addPco`, `addControlPoint`,
`addSupplyDepot`, `addFlag`, `addObjectSpawner` — one general per-category
registry family, unfiltered.

### 13.2 The engine supports networked projectiles as a first-class type

`dice::ref2::world::ProjectileNetworkable` is a complete, standalone class in
the server binary implementing `init`/`getNetUpdate`/`setNetUpdate`/`predict`/
`updateStateMask` — exactly `NetworkableBase`'s shape (`object.h:166-181`). The
ghost-replication mechanism for projectiles is real and fully supported by the
engine in general. `IObject::getTeam()` (`object.cpp:83-93`) already
special-cases `CID_ProjectileTemplate` (`0x9495`) reading team from `+0x144`,
the same per-instance-field pattern used elsewhere — nothing about a
projectile's shape looks structurally different from any other `IObject` on
the wire.

### 13.3 The client gates visible-projectile creation behind an interface only the server holds

This is the actual reason. The client's `FireArms::createProjectile`
(`0x00539d40`, decompiled this session — `__thiscall`, pool bookkeeping at
`this+0x210/0x214/0x218`, calls the already-known `Projectile::resetProjectile`
`0x00541f50`) branches on whether the projectile template's geometry name is
empty:

- **Empty geometry** (invisible/"dummy" projectile): calls
  `template->createObject()` unconditionally — no server check.
- **Non-empty geometry** (a real rendered body — tank shells, bazooka rockets,
  anything with a mesh): first calls `Game::queryInterface(0x1d4c1)` and only
  proceeds if it returns non-null.

`0x1d4c1` = 120001 = `IID_IGameServer`, confirmed by reading the raw bytes at
the server binary's own symbols `dice::bf::IID_IGameServer` (`0x086b1cf8` =
120001) and `dice::bf::IID_IGameClient` (`0x086b1cfc` = 120002 — already
bf42plus's own shipped constant, `bfhook.cpp:421`, same `Game` vtable slot `+8`
pattern). A normal client connected to a remote dedicated server never holds
`IGameServer`. So for any weapon with a visible projectile body, this branch
returns null and **no `Projectile` `IObject` is ever created client-side** —
there is nothing for the sampler, the event stream, or a bitstream decoder to
ever see, because nothing was ever instantiated. This is architectural, not a
relevance/priority/timing artifact, and it fully explains both recordings'
zero-projectile result, including the self-fired, point-blank Sherman kill.

### 13.4 What this means for the recorder, and what's still open

Capturing true shell/rocket flight from a single client's ghost data is **not
achievable** for any weapon with visible projectile geometry — not a sampler
gap to close, an engine design choice to work around. Extending the sampler to
walk `ObjectManager_getProjectileMap()` (mirroring `renderer.cpp:314-324`,
~15 lines) is still cheap and correct for whatever *does* get networked
locally — mines, and possibly empty-geometry "dummy" projectile types — but it
would not have produced a shell for the Sherman scenario, and is low priority
until something that actually reaches this map is identified.

Genuinely `open`: the tracer/shell the shooter visually sees still has to come
from somewhere. `FireArms::createProjectile` being gated proves only that the
*pooled, ObjectManager-registered* path is closed; it does not show what
actually draws the visible effect. That is almost certainly a local
`EffectBundle`/particle trigger fired directly off the weapon-fire animation,
entirely decoupled from `ObjectManager` (consistent with
`bf1942-engine-reference/subsystems/projectiles-and-impacts.md`, which covers
post-impact effects but not fire-time triggering). It has not been located or
decompiled. If it is found, it could at least mark "weapon fired" at the
shooter's position and time for the *recording player's own shots* — not
other players' — as a local, non-networked signal. Also open: whether the
*server's* own authoritative projectile (created where `IGameServer` succeeds)
is ever ghost-replicated to any client under any circumstance — not observed
in either recording, not proven impossible in general (e.g. slower/longer-lived
ordnance, or a third-party observer rather than the shooter).

---

## 14. Format v4: every round, the seats, the named events (2026-09-27)

Built in bf42plus `src/replay.cpp` (sila-skandia/bf42plus), read by
`viewer/replay-recording.js`. What it adds to §9's table:

| `k` | meaning | fields |
|---|---|---|
| `f` | one round fired by any weapon the client simulates | `id` the root object the FireArms hangs under (soldier or hull), `pid` the firing player (-1 on the auto-fire path), `w` the FireArms template (`Bar1918`, `DefgunGunBarrel`), `p`/`d` the transform the engine fired along (position and +Z axis: the camera's for a `fireInCameraDof` weapon, the weapon's otherwise), `local` 1 for the recording player's own |
| `p` | player state, extended | `[pid, team, vehicle, root, seat, triggers]`: `root` the network id of the object the controlled one hangs under, `seat` the controlled id's place after it (0 the root seat), `triggers` the fire (1) and altfire (2) flags the server replicates on the BFPlayer |
| `e` | named events | `simStart` (0x04), `projPool` (0x05), `mapList` (0x13), `challenge` (0x14), `gameRules` (0x16), `serverInfo` (0x1A), `serverName` (0x1B), `clock` (0x29), `roundStats` (0x30..0x32, `stat` destroyed / fired / hit, `rows` `[{tid, tmpl, n}]`), `sessionId` (0x37); `score` kills gain `weaponName` |

**Every round (`f`).** The client fires every weapon it simulates through
`FireArms::Fire` (`0x0053D7B0`, the twin of lnxded `0x0828A090`): its own
player's from input, and every other player's -- human or bot -- from the fire
and altfire flags the server replicates on each BFPlayer. The chain, each step
read in the disassembly:

1. The server sets `BFPlayer+0x148/+0x149` from input every tick
   (`GameServer::checkPlayerTriggers` `0x0814F2C0`) and replicates them
   (`BFPlayer` networkable masks `0x4000`/`0x8000`).
2. The client's BFPlayer networkable (`setNetUpdate` `0x00407710`, at
   BFPlayer+8) writes them to `BFPlayer+0x184/+0x185` (`0x00407B9B`,
   `0x00407BAF`).
3. The multiplayer client's per-tick loop `0x004B90D0` sends
   `handleMessage(6)` / `(7)` to every player's vehicle whose networkable has
   live ghost data (`[net+0xC]`), at `0x004B915B` / `0x004B9179`.
4. `FireArms::handleMessage` (`0x0053EAD0`) calls Fire, the path the local
   player's own input takes.

The hook sits at `0x0053DCB1` (`mov edx,[ebp+264h]`, 6 bytes, checked before
patching), which all nine round-committing jumps reach through `0x0053DCAA`
after the barrel loop and which no path that fires nothing reaches: `ebp` is
the FireArms, `ebx` the firing IPlayer, `[esp+3Ch]` the Mat4 fired along
(copied at `0x0053DA29`). One record per trigger pull that commits a round, so
a multi-barrel salvo is one record.

Open, and worth a lab round each: a remote tap released between two BFPlayer
updates (50-100 ms) may fire nothing on the client (the flag is level-held),
so bolt actions, bazookas and tank guns may be undercounted -- compare the `f`
count per player with `roundStats` fired; whether the server echoes the local
player's flag back (a possible double count for `local` records); remote
rounds land about one-way latency plus a ghost interval after the server's.
The v3 input-edge `fire` record is still written as a cross-check, and a
v4 file's player presses stay in the replay's feed without firing.

---

## 15. Format v4: turrets, engines and soldiers' bodies (2026-09-27)

What the server replicates beyond a root's transform, read where the client
has applied it. Each child object with a networkable (a template declaring
`networkableInfo`) is registered with the object manager like any root, with
the root flag `0x02000000` clear, so the sampler finds them in the same walk.
Every vtable slot and code signature below was checked in the hashed
BF1942.exe before the recorder reads a field through it (`partsVerified` in
`replay.cpp`), and every read goes through `safeCopy`.

| `k` | what | fields | where it is read |
|---|---|---|---|
| `jn` | a moving part, named on first sight | `o`: `[root, part, template]`; v5 adds `x, y, z`, where it sits in its root's frame (§16) | |
| `j` | a moving part's rotation relative to its root | `o`: `[root, part, qx, qy, qz, qw]` (BF1942's frame), when it moved | a RotationalBundle (vtable `0x008FE1B0`, slot 20 `0x0057D010`): its RotationalBundleNetworkable carries the angles and `RotationalBundle::setState` `0x0057D470` makes them the relative transform every frame, so its absolute rotation against its root's is the traverse and the elevation |
| `g` | an engine | `o`: `[root, revs, throttle servo, flags, gear, engine]`, flags 1 running, 2 disabled by damage | Engine (vtable `0x008FE4A0`, slot 20 `0x0057E1D0`): running `+0x15C`, disabled `+0x15D`, throttle servo angle `+0x124` (T1 is it over `maxRotation.z`, `0x0057E296`); its PhysicsEngine at `+0x60` (vtable `0x008FDEC0`, slot 36 `0x0057BFB0`): revs `+0xA0`, gear `+0xBC` |
| `st` | a soldier's body | `o`: `[soldier, lower state, upper state, aim pitch, torso twist, held item, state bits]` | BFSoldier (vtable `0x008EB128`, slot 37 `0x00500190`): aim pitch `+0x2B0` and twist `+0x2B4` (degrees), the lower and upper animation machines' state index `+0x2E0` and `+0x324`, the held item's 1-based `itemIndex` `+0x3E8`, state bits `+0x416` |
| `anim` | the animation state table, once a file | `states`: `[index, name, flags]` | the global table `*0x009C9664` that `getCurrentStateFlags` `0x00613440` reads: states vector `+0x18`..`+0x1C`, a state's flags `+0x2C`, its name `+0x130`. The movement code's own stance test (`0x005013D6`) reads the lower state's flags: 0x20 crouching, 0x40 lying (0x08 swimming, 0x10 climbing, 0x80 jumping) |

What the replay does with them (`features/round-replay-fidelity/`): a `j`
part goes on the model's node of the same template name, after the drive's
rig has posed everything else; `g`'s revs are the engine note's and the
propeller's (`PhysicsEngine::updatePhysics` plays its sound from `|revs|`
and spins the propeller from it), and its running flag decides whether the
engine sounds at all; `st`'s lower state gives the stance, its upper state
the fire, and its item the weapon drawn in his hands.

Why an engine is not read from its propeller: the Engine derives from
RotationalBundle, but `Engine::handleUpdate` never rebuilds its transform, and
the propeller is spun locally (`0x0057C21E`..`0x0057C2CF`: `revs x 400` degrees
a tick below the 0.08 blur swap, `revs x 20` above), so a 10 Hz sample of it
aliases.

Corrections these readings make elsewhere. The addresses above, and the two
vtable corrections below, are in `bf1942-engine-reference/symbols.json`
(source `research-2026-09-27-round-replay`); `netcode.md` is left as it is:

- `subsystems/netcode.md` P-2's "no interpolation buffer": each networkable
  keeps a 16-entry history, and a RotationalBundle's `predict` (PMLinear,
  every vanilla turret) interpolates between the two records around
  `now - delay` (client `0x00559D40`). The functions P-1/P-2 name on vtable
  `0x008D8DA8` belong to the client's local-host server (its queryInterface
  answers IGameServer); the multiplayer client's remotes are ghost state plus
  the fire-flag loop of §14.
- The PhysicsEngine vtable is `0x008FDEC0`; `0x008FDF50` is its slot 36.
- `HandFireArms`' primary vtable is `0x008F97B8` (`0x008F9750` is the
  secondary table, at object `+0x2D8`).

Open: which LOD a part hangs under on a distant hull (a LodObject's
`getChild` returns only the selected LOD; the sampler reads every registered
object, so it is unaffected, but a part under an unselected LOD may stop
updating), and what byte `+0x26D` means. The aim pitch's sign and scale are
settled in §16.

Two of `st`'s state bits, read on the server (`+0x3e6` there) and matching
the recordings: `0x10` is the chute carrying him, set and cleared by
`BFSoldier::setIsParachuting` (`0x08276f90`); `0x2000` is the free fall,
cleared every tick by `BFSoldier::handleUpdate` (`0x0827239b`) and set again
while the lower state is `Lb_ParachuteFall` (`template+0x1e4`, `0x082723b7`).
replay_20260927-140921's bail-out reads `0x6000` through `Lb_ParachuteFall`,
`0x4010` from `Lb_ParachuteOpen` and `0x40` from `Lb_ParachuteHitGround`;
the replay draws the canopy off `0x10` (`round-replay-fidelity`).

A third, read from the recordings (2026-09-29): `0x20` is the weapon zoomed,
with `0x80` up while it changes. It flips on every one of the recording
player's zoom presses (52 in replay_20260928-133433, each about 0.4 s after
the key), and every other soldier carries it too, only ever with a weapon
that zooms, so the server sends it for everyone. The replay's first person
takes the weapon's zoom lens and scope from it (`round-replay-hud`).


## 16. The first v4 round, and format v5 (2026-09-27)

`replay_20260927-075756` (lab run `20260927-075736-wake-coop`, 279 s, recorder
`4fc0352`) is the first recording from a v4 recorder in the game. Every v4
record is there and the recorder refused nothing: 791 rounds in `f` from 24
shooters (100 of them the recording player's), 2586 `g`, 2605 `j`, 1507 `st`
and the state table once in `anim` (1395 states). Every vehicle round names a
FireArms that is a node in its hull's model (Daihatsu `MG42` 321, Sherman
`Browning` 246, M3A1 `Browning` 46, SBD `SBDGuns` 28 and so on), so the replay
fires each from its own gun.

The part records were wrong. The sampler keyed each part by its networkable's
id, and a child object's networkable has none: `getID()` is 0 for every part
and every engine, the root's ghost carrying its children's state. So `jn`
named one part in the file (`DefgunTurret`, the first seen) out of 35, and a
hull's parts wrote over one another under key 0. Engines had the same key,
but a `g` record also carries its root, so they still resolved per hull.

Format 5 (bf42plus after `4fc0352`) fixes the keys:

- The recorder numbers each part and engine itself, once per file, by the
  object. An address the allocator reuses for an object under another root or
  of another template gets a new number.
- `jn` adds where the part sits in its root's frame, `[root, part, template,
  x, y, z]` (BF1942's), taken at first sight.

The viewer puts a v5 part on the same-named model node nearest that position
(`replay-kinematics.js` `matchJointNodes`), so a ship's identical AA guns each
turn their own node. It takes a hull life's parts only (a respawn that reuses
a root's id brings new parts), and it puts no v4 part on a node.

A v4 file's parts are still readable per hull. The shared key made the
recorder's change test compare each part with the last part it wrote, of any
hull, so a part was left out exactly when it equalled the entry written just
before it; and its walk is the object manager's registry, so every record
lists a hull's parts together and in one order (none of the 2605 records in
`replay_20260927-075756` interleaves two hulls). A run of `k` entries is `k`
of the hull's `n` parts in order, the others copies of the entry before them,
and the run's last entry is always the hull's last part. `replay-aim.js`
`decodeKeyedParts` takes the reading that turns the parts least since the
last record, and the replay aims a gun from a decoded part only where that
part's axis carries the gun's own rounds (`f`). In that file every gun on an
aim rig that fired matched one, to 0.05-0.34 degrees at the median: the
Defgun's gun base 0.06, the two AA guns' cannons 0.16 and 0.06, the tanks'
guns 0.08-0.27, their cupola Brownings (whose mounts face aft of the gun)
0.10-0.34.

Two readings from the same file:

- Aim pitch (`st`, BFSoldier `+0x2B0`): positive is up, and it is 0.4 of the
  aim. 21 of the recording player's BAR shots left at 2.50 times the recorded
  value (2.34 to 2.68, from -14 to +30 degrees), with the same sign every time.
- Torso twist (`st`, `+0x2B4`, 2026-09-29): a third of the view's yaw off the
  soldier's own heading, turning it the other way from BF1942's yaw. Over the
  hand-weapon rounds of three recordings, each within 50 ms of its soldier's
  sample and body record, a round's yaw off the sample's is -2.93 times the
  twist at the median (135 rounds with a twist over a degree), and the pitch
  2.50 times (1,165 rounds). The replay's first person uses both
  (`round-replay-hud`).
- Both are turns in the soldier's own frame, which lying down is the slope
  (2026-09-29). A prone soldier's recorded rotation is tilted with the
  ground under him (27 degrees nose-down and 15 rolled at 35:24 of
  replay_20260928-161948), and over 1,804 prone rounds of seven recordings
  the twist and pitch are -3.00 and 2.50 of the round's turn off that tilted
  body, not off the level. On a side slope of more than 8 degrees the round
  is exactly the body frame's composition for more than half of the 480 rounds
  (the client works a remote soldier's shot out of the same replicated
  values), and 3.3 degrees off (7.3 at the 90th percentile) with the roll
  taken out. His rounds leave from his origin plus `setPoseCameraPos` along
  the body's up: 7 mm at the median over 1,098 rounds lying on more than 5
  degrees, against 12 cm straight down.
- The Engine's `+0x124` (`g`'s third field) is in the template's own units,
  since `Engine::handleUpdate`'s T1 is it over `maxRotation.z`: -4000 to 5000
  on the planes and boats here, -1 to 1 on the land hulls. The viewer does not
  use it; the revs are what the engine note and the propeller follow.

## 17. Tickets, and where a round starts (2026-09-27)

The tickets row of §3's table was `open`; it is found. The client's
`ScoreManager` is the server's replicated (`ScoreManager::getNetUpdate` /
`setNetUpdate`, a 24-bit changed-field mask): the pointer is at `0x0097A0D8`,
made by the class factory with class id `0xC4B8` at `0x004830C0` (the
factory function `0x00483040` allocates `0x104` bytes, the server's size, and
calls the constructor `0x004A1140`, vtable `0x008DAEB0`). Its `getTeamScore`
(vtable `+0x10`, `0x0049FD10`) is `this + 0x10 + team x 0x50` for team 1..2,
exactly lnxded's `0x081616C0`, and a `TeamScore`'s live count is `+0x48`
(lnxded `TeamScore::setTickets` `0x081610A0`). The HUD reads it that way at
`0x004A8C2F` and ten other places. The constructor also lays out the score
table at `+0x3C..+0x58` with `SCORE_DEFAULTS`' values (death -1, kill 3, tk
-3, capture 20, attack, defence and objective 5, objective tk -15).

From bf42plus `e692f14` the recorder writes `{"k":"tk","t","v":[team1,
team2]}` whenever either count moves, after checking the vtable slot once and
the object's vtable each sample.

A control point replicates its team and nothing else (a 4-bit signed value
through `ControlPointNetworkable::setNetUpdate` into `setTeam`), so the `cp`
records already hold all a client knows of the flags.

Where a round starts: the client is sent the game status on joining, so a
join mid-round sees PLAYING (1) with no PREGAME (3) before it
(`replay_20260927-001120` joined 277 s into its round, `roundInit` at 22.1 s
of the server log and the join at 299.5 s). `rec.roundStarted` is now the
first PLAYING after a PREGAME, and null for such a join.

The replay (`replay-round.js`, `features/round-replay-fidelity`) shows the
recorded counts; without `tk` it runs the page's own round (`round-state.js`)
from the round's start over the recorded deaths and owners, with the server's
slot count from the event log's `maxplayers`, and says it is an estimate. On
`replay_20260927-075756` that is 200 / 200 at the start, the Axis bleeding
one every 2 s while the Allies held all five points (100 of weight) until the
beach fell at 185.5 s, and 87 / 171 at the end. A join mid-round without `tk`
shows no counter.

## 18. A file begun after the join (2026-09-27)

§10.3's limit came back with the port to bf42++ v2.0 (bf42plus `d3c3df3`,
released as `v2.0-replay`). The port reads `bf42++.ini`, not `bf42plus.ini`,
so `recordReplays` was off until it was switched on in the console.
`replay_20260927-190946` began 20 s into a Tobruk round on a public server:
the join's `serverInfo`, `serverName` and `setLevel` arrived at 19:09:27-28,
the ini was written at 19:09:46.536 (`plus.recordReplays 1` saves it) and the
file opened 10 ms later. It named no level, mod or server, and 26 of its 28
players had no createPlayer and so no name.

From bf42plus `ea600c1` the recorder keeps the join's own events as they
pass, recording or not: server info (0x1A) and name (0x1B), the challenge
(0x14), the rules (0x16) and the level (0x36). A new join (0x1A) lets the last
one's go. A file that begins after them opens with them, each with `ago`, the
seconds before the file began that it arrived, and then a roster of who is
playing, `local` 1 for the recording player:

```
{"k":"e","t":0.000,"e":"setLevel","level":"bf1942/levels/Tobruk/","mode":"conquest.con","ago":18.251}
{"k":"roster","t":0.000,"p":[[pid, team, ai, "name", local], ...]}
```

The world clock (0x04) is not kept: its time is the join's. A file begun by
the join has nothing kept and records the join as before. The format stays 5,
and a reader that does not know `roster` or `ago` skips them.

For files from before `ea600c1`, the viewer recognises the level by its flags
and reads names off the chat box (`features/round-replay-ux`, "A recording
that names no level").

First seen in `replay_20260927-203459` (Midway, a public server, begun 41 s
after the join, recorded with the `v2.0-round-replay` release of `ea600c1`):
the join's events and an 11-player roster at its head, as designed.

### What the objects made before the file were missing, and bf42plus `0254e92`

That file still lacked every object the join made: CreateObject (0x07) comes
once per object, at the join for everything standing, and the sampler names
only what the server replicates within the view distance. So the carriers,
the Yamato, both Hatsuzukis, a Fletcher, eight Daihatsus and two LCVPs were
only the root ids of their turrets (`jn`/`j`) and engines (`g`), and the
PrinceOW and the Fletcher2 nothing until they came into range at 405 s. It
had no projectile pools (0x05) and no kits either: a player spawned before the
join has his soldier and kit only in his createPlayer (`vehNetId`,
`kitNetId`), and one who picked his up since did it in a PickupKit (0x23)
before the file.

From bf42plus `0254e92` the recorder holds these beside the join's events,
whether or not a file is open, and lets them go at the next join (0x1A): each
player's latest createPlayer until he leaves (0x0C); each object's
createObject until a DestroyObject (0x06) for its id; each projectile pool
until one for its first id; and each player's latest pickupKit until that kit
is destroyed or he leaves. A file begun after the join writes, after the
join's events and before the roster, the players, the objects, the pools and
the kits, in the order they came, each with `ago`:

```
{"k":"e","t":0.000,"e":"createPlayer","pid":0,"name":"...","team":1,"ai":0,"netId":1,"vehNetId":6428,"camNetId":2,"kitNetId":6432,"ago":26.006}
{"k":"e","t":0.000,"e":"createObject","tid":3427,"netId":534,"tmpl":"Shokaku","pos":[446.00,95.32,1516.00],"rot":[48.71,-0.00,0.02],"ago":116.560}
{"k":"e","t":0.000,"e":"projPool","tid":1293,"tmpl":"GrenadeAxisProjectile","netId":599,"count":3,"ago":113.365}
{"k":"e","t":0.000,"e":"pickupKit","pid":254,"netId":602,"ago":113.364}
```

A held createPlayer is the player as he joined (his side then; the roster
after it has his side as the file begins, and the viewer takes that). The
format stays 5. The viewer reads a record with `ago` as the join's, so what it
made was standing at the file's start, not spawned in it. For files from
before `0254e92`, the viewer carries a hull it sees late back to its first
trace and stands the level's own vehicle in for a root it never sees
(`features/round-replay-fidelity`, `replay-standins.js`).

Built and installed as `dsound.dll` on 2026-09-27 22:52; not yet in a real
file. Rollback to the `v2.0-round-replay` build: `cp dsound_old.dll
dsound.dll` in the game folder.

---

## 19. What the server sends one client, and how far (2026-09-28)

Read from the Linux server, and measured on the three files that begin at the
join. The owner's question: does the server send nothing for a player out of
range, and is a recording as detailed as it can be?

**The rule.** `GameServer::updateGhostManager` (lnxded `0x08137710`) calls
`getRelevantObjects(connection, viewpoint, Setup::getViewDistance() + 20.0)`
(`0x08137390`; the 20.0f at `0x086c0314`): the level's view distance plus 20 m
around the client's viewpoint, which is §11.1's unexplained ~20 m. Wake is
520 m, Bocage and Kursk 420, Berlin 120. Inside it every object is ghosted by
priority (`calculateObjectPriority` `0x0813b230`). A second loop then ghosts,
at a flat priority 0.03 (`0x3cf5c28f`) and wherever he is, the control object
of every living player (BFPlayer `+0x79`, `AIPlayer::getIsAlive`) on the
client's own side (`+0x7c`, what `BFPlayer::setTeam` writes), and of any
enemy whose `+0x13c` is set: the flag carrier (`Flag::handlePickup`
`0x08291d70`) and the tagged player (`GameServer::setTagPlayerId`
`0x0814a2a0`).

| what | own side | the other side, and empty hulls |
|---|---|---|
| position, hit points, turrets, engines, the body's states, trigger flags (so every shot, `f`) | everywhere | within the radius |
| joins and leaves, sides, spawns (0x07 carries the new soldier's spawn point), vehicle entries and exits by seat, kits, kills with the weapon, deaths, chat, radio | everywhere | everywhere |
| every object's creation with its transform, and its removal; control points; tickets; the round-end tallies | everywhere | everywhere |

Replicated share of each player's time in the world (the spawn screen left
out):

| file | own side | other side |
|---|---|---|
| `replay_20260928-133433`, Bocage, public, 34 players | 95% (spawn latency, and a player who left at 233 s) | 78% |
| `replay_20260927-140921`, Kursk, public | 99% | 90% |
| `replay_20260927-075756`, Wake, the lab | 100% | 54% |

In the Bocage file the other side's shots stop at 415 m and the own side's
reach 908 m; 30 of its 210 vehicle entries were into hulls out of range, all
recorded. Files begun mid-round read lower on their own side, but only through free
cameras the file never saw made, which it cannot tell from hulls.

**Out of range the client keeps the object.** All 256 re-sightings in the
Bocage file came back with the same object-manager id (`gid`). The sampler
reads only enabled roots, so the root drops out (`d`) while its children stay
registered: a BF109's engine ran on at zero input for six seconds after its
`d` (throttle servo down 100 a sample, revs to 0.37) and nothing changed
after that until it was back.

**What follows.**

- One recording per side covers every player for the whole round: each file
  has its own side everywhere and the other within its radius. Network ids
  are the server's, so two files merge by id: `features/round-replay-merge`
  (2026-09-29), measured on this round split by side and merged back.
- The replay draws a vehicle out of range solid while nobody has held its
  root seat since the recording last saw it and it was standing then; only
  one somebody has driven since is a ghost (`replay-recording.js`
  `poseHeld`, a drivetrain-less gun never). 89% of the Bocage file's
  out-of-range vehicle time is the former, 88% of Kursk's, 64% of the Wake
  lab round's (its bots drive the landing craft).
- Sampling: the server sends ghost state every 0.1 s (netcode P-2,
  `conn+0x18`), and the recorder samples the applied world at 10 Hz, out of
  step with it, so a sample can be the client's own zero-input step between
  two updates. Writing each object as its ghost is applied (client
  `0x0048a130` to `0x00489ed0`) would be exact. Not built.
- Beyond one client: the server's event log for servers we run (§11.7), or a
  recorder in the server itself.
