# Sampling against hooking the send path (2026-10-04)

## Review: sampling, and the send path (2026-10-04)

The question: the bf42plus client recorder plays cleanly and the server's does
not (tanks slide, nobody sits in a vehicle, soldiers hold no pose). Is that
because the client's is event-based and the server's sampled, and should the
server recorder hook the path the server sends clients their updates by?

**Both recorders sample.** The client recorder writes positions, turrets,
engines and bodies by walking the client's applied world at 10 Hz on its render
loop (round-replay-capture §4A, §9, §19). Only the discrete story (joins,
kills, seats, kits) comes from the event stream. Its `s` records are 0.100 to
0.112 s apart. The server holds every field any client is sent, so sampling
it can lose nothing a client recording has. Every defect below is a field the
recorder does not read yet, not a limit of sampling.

### What the server file lacks, measured

El Alamein lab round (`20261003-214603`, `replay_1791027968`) against the
Bocage client recording `replay_20260928-133433`:

| | server | client |
|---|---|---|
| `p` (seat, root, triggers) | 0 | 2,912 |
| `enterVehicle` / `exitVehicle` | 0 / 0 | 210 / 154 |
| `control` into a vehicle seat | 0 of 153 (all soldiers or free cameras) | 187 of 367 |
| `anim` state table | none | once |
| Willy front wheel `j` | 68 | 1,880 |
| lower state `Lb_RunForward` among `st` | 0 of 3,158 | 8,457 of 20,279 |

- **Nobody in a vehicle.** The viewer seats a player from `p`,
  `enterVehicle` or a `control` into a seat (`replay-recording.js` `rootOf`).
  A server file has none, and a soldier aboard is a child object, so his root
  gets a `d` and `place()` (`replay-bodies.js`) draws him nowhere. Every hull
  has an empty crew: undriven, so a wheeled vehicle's derived steering is zero
  (wheels straight through every turn), and a static gun takes no audio slot
  for its rounds. The recorder watches `BFPlayer+0x68`. The control
  object the ghost manager replicates to a client is `getVehicle()`:
  `GhostManager::updatePlayerControlObject` `0x08142210` calls BFPlayer vslot
  0x3c, `BFPlayer::getVehicle` `0x080560c0`, which returns `+0x4c`.
  `BFPlayer::setVehicle` `0x08052310` stores its int argument, likely the seat,
  at `+0x54`. The trigger flags are `+0x148/+0x149` (§14 of
  round-replay-capture). Read in the disassembly, not yet live.
- **No poses.** With no `anim` line, `bodyAt` (`replay-recording.js`) finds
  no state, so every soldier reads as standing, not firing, reloading,
  swimming or lying. The server's state indices are the client's table: mapped
  through the Bocage file's, the server's lower 915 is `Lb_Lie` and upper 91
  `Ub_StandAimPanzershreck`, on AT kits.
- **Where the soldier's replicated state lives.**
  `BFSoldierNetworkable::getNetUpdate` `0x082246e0` writes from a ring of
  0x88-byte records at `*(net+0x4c) + idx*0x88`, `idx = *(net+0x28)`, `net`
  the soldier's networkable (`IObject+0x68`): position `+0x08`, velocity
  `+0x14` (mask 2), rotation `+0x3c` (mask 4), the aim pair `+0x68`/`+0x6c`
  (masks 0x10/8, the two values `st` writes as 0 today), lower and upper
  animation state `+0x70`/`+0x74` (masks 0x20/0x40), the Armor's value
  `+0x78` (mask 0x80). The recorder reads the body's own state machines at
  `BFSoldier+0x2b4`, where no locomotion state ever appears; the ring is what
  a client is sent.
- **Wheels and suspension.** The server does not rebuild a cosmetic part's
  transform, so `j` (read from the part's absolute transform) barely moves for
  steered wheels. `RotationalBundleNetworkable::getNetUpdate` `0x082345c0`
  sends the angles from `*(net+0x50) + idx*0x2c`. Springs
  (`SpringNetworkable::getNetUpdate` `0x08239190`) are not recorded at all.
- **Timing.** The sampler is a second thread reading through
  `/proc/self/mem`, waking every 1/30 s and stamping the wall clock at the
  start of its walk, while the game thread ticks at 30 Hz. In steady motion
  over 6 m/s, 19% of its 3-tick intervals hold 2 ticks of movement (the
  client's: 4%), about 0.3 m of jitter at 10 m/s. Its gaps are 0.096 or
  0.128 s (the client's 0.100 to 0.112), and the viewer holds a sample until
  0.1 s before the next, so every long gap is a 28 ms stop. A walk can also
  straddle a tick, and a Mat4 can tear.
- **Kills named nobody (fixed).** The recorder read the player id at
  `BFPlayer+0xc`, which is the player's network id (2p+1):
  `GameEventManager::createPlayer` `0x0812d080` writes `getId()`
  (`0x080560e0`, `+0x58`) as the event's player id and `+0xc` into the field
  after it. The roster, `control`, `pickupKit` and `f` carried 453..511, the
  score events 226..255, so no kill matched a soldier. Now `+0x58`: in
  `20261004-073008-elalamein-coop-rec` the 30 roster ids are the score
  events' and 12 of 12 kills name both players. The w32ded table cites the
  same builder for its `+0x0c` and is probably the same mistake; unchecked.
- **The sliding is mostly the bots.** The angle between a hull's heading and
  its travel is as wide in a client recording of a lab bot round
  (`replay_20260927-075756`: 29% of samples over 4 m/s more than 10 degrees
  off) as in the server's (32%). The humans of Bocage drive at 8%.

### Hooking the send path

The send is `GameServer::update` `0x08132940` ->
`processGameStateAndSendPackets` `0x08139420` -> per connection
`updateGhostManager` `0x08137710` -> `getRelevantObjects(conn, viewpoint,
viewDistance + 20)` `0x08137390` -> `GhostManager::update` `0x08141c70` -> each
object's `<class>Networkable::getNetUpdate`. As a data source it is worse
than the world:

- It runs once per connected client. A bots-only server sends nothing, which
  is why the `addEventToSendQueue` hook saw nothing in the lab.
- Each stream is one client's view: the radius plus his own side, at a
  priority-scheduled 20 Hz x 1044-byte budget. A tap of it is what bf42plus
  already records.
- It is a bit-packed delta stream against acknowledged baselines. Playing it
  means writing a reader for each of the 13 networkable classes (strategy C)
  and logging the acks too.

Two variants would work. A phantom connection inside the server (infinite
radius, unlimited rate, every packet acknowledged, transmit to a file) records
a lossless "server demo", but needs a fake player and viewpoint, and playing it
needs the 13 readers or a real client fed the demo. A real spectator client
(bf42plus recording, under wine) with the relevance radius lifted for its
connection (the radius is a float argument at the call in
`updateGhostManager`) gets client fidelity for the whole map with no new
decoding, at a client process and a player slot per server, and still without
tank shells and rockets (§13 of round-replay-capture).

### Recommended

Keep the server recorder. Use the send path as its clock and its spec:

1. Sample on the game thread: detour `processGameStateAndSendPackets`, which
   runs every frame after the tick and before the send. Sample every third
   tick, stamped with the tick count. No `/proc/self/mem`, no torn reads, no
   races with the game thread.
2. Read each field where `getNetUpdate` reads it: the soldier ring (aim,
   states, velocity), the RotationalBundle ring, springs, and `getVehicle`
   `+0x4c` / `+0x54` / the triggers for `p`. Write the `anim` table once a
   file.
3. Take the 13 `getNetUpdate` functions as the checklist: a server field for
   every mask bit is parity with any client.
4. Write the velocity into `s`. The viewer can then ease between samples on a
   curve, which no client recording allows.

